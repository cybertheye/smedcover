//! SmedCover — native shell for the cover generator.
//!
//! All drawing happens in the web view (`ui/`). What the Rust side does for it is mostly in
//! `smedcover-core` (`core/`), which a server can share: the sandboxed store, exporting covers,
//! fonts and the outlines of lettering, the subject cut-out and the AI request. This is the desktop
//! app around it:
//!
//! * the data folder, found once at the start (the app data directory, or a self-test's) and kept
//!   as the [`Core`] the commands use;
//! * the commands, most of them a thin wrapper round the core's work, the slow ones run off the
//!   main thread;
//! * what only the desktop has: the system's dialogs, the file manager, the pointer, the self-test;
//! * the endpoint agents call over MCP, which the window answers ([`mcp`]);
//! * the command line's side of the app: its endpoint and `cli.json`, the launch for it
//!   (`smedcover-app --cli`), quitting when it is done, and one app for each data folder ([`cli`]);
//! * the command line put on the PATH, from Settings → Agents ([`install`]);
//! * updates, from Settings → About ([`update`]).

mod cli;
mod install;
mod mcp;
mod update;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use smedcover_core::cut::{self, CutModel};
use smedcover_core::files;
use smedcover_core::fonts::{self, FontFaces, FontInfo};
use smedcover_core::image::{encode, extension, parse_frame, safe_name, write_into, ExportMeta};
use smedcover_core::outline::Outline;
use smedcover_core::{err, net, paths, BundledFonts, Core, Res};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_dialog::DialogExt;

/// Folder given in `SMEDCOVER_SELFTEST`, if any. In that mode the app keeps its data there instead
/// of the real app data directory, exports a few covers into it through the normal code path,
/// writes `report.json` and quits — an end-to-end check of the web view / Rust bridge. (With
/// SMEDCOVER_SELFTEST_STAY it only keeps its data there: see [`selftest_stay`].)
fn selftest_root() -> Option<PathBuf> {
    std::env::var_os(paths::SELFTEST_ENV)
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

#[tauri::command]
fn selftest_dir() -> Option<String> {
    selftest_root().map(|p| p.display().to_string())
}

/// In self-test mode, whether the app is only to keep its data in the self-test's folder and otherwise run as it
/// would (SMEDCOVER_SELFTEST_STAY): no self-test, the window left open, the agents' endpoint started if it is on —
/// the app on a data folder of its own, to try something by hand (a new folder starts with the sample profile).
#[tauri::command]
fn selftest_stay() -> bool {
    selftest_root().is_some() && std::env::var_os("SMEDCOVER_SELFTEST_STAY").is_some()
}

#[tauri::command]
fn selftest_done(app: AppHandle, report: String) -> Res<()> {
    let root = selftest_root().ok_or("not in self-test mode")?;
    fs::write(root.join("report.json"), report).map_err(err)?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn app_read(core: State<'_, Arc<Core>>, path: String) -> Res<Option<String>> {
    core.read(&path)
}

#[tauri::command]
fn app_write(core: State<'_, Arc<Core>>, path: String, data: String) -> Res<()> {
    core.write(&path, &data) // a font imported (again) lets go of the file its outlines were traced from
}

#[tauri::command]
fn app_list(core: State<'_, Arc<Core>>, dir: String) -> Res<Vec<String>> {
    core.list(&dir)
}

#[tauri::command]
fn app_delete(core: State<'_, Arc<Core>>, path: String) -> Res<()> {
    core.delete(&path)
}

/// Shows a folder of the app's data (created if missing) in the system's file manager, for the
/// user to put files in or edit them (the repaint styles). Only folders inside the data root.
#[tauri::command]
fn reveal_data_dir(core: State<'_, Arc<Core>>, dir: String) -> Res<()> {
    let path = core.resolve(&dir)?;
    fs::create_dir_all(&path).map_err(err)?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener).arg(&path).spawn().map_err(err)?;
    Ok(())
}

// ---------------------------------------------------------------- image export (the work itself: smedcover_core::image)

fn frame_of<'a>(request: &'a Request<'_>) -> Res<(ExportMeta, &'a [u8])> {
    match request.body() {
        InvokeBody::Raw(body) => parse_frame(body),
        _ => Err("expected a binary body".into()),
    }
}

/// Asks where to save one cover (framed binary body, see [`parse_frame`]) and writes it.
/// `None` when the dialog is cancelled.
#[tauri::command(async)]
fn save_image(app: AppHandle, request: Request<'_>) -> Res<Option<String>> {
    let (meta, png) = frame_of(&request)?;
    let ext = extension(&meta.name);
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(safe_name(&meta.name)?.to_string_lossy())
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(err)?;
    fs::write(&path, encode(png, &meta.format, meta.quality)?).map_err(err)?;
    Ok(Some(path.display().to_string()))
}

/// Lets the user choose the folder a batch is exported into.
#[tauri::command]
async fn pick_folder(app: AppHandle) -> Res<Option<String>> {
    match app.dialog().file().blocking_pick_folder() {
        Some(dir) => Ok(Some(dir.into_path().map_err(err)?.display().to_string())),
        None => Ok(None),
    }
}

/// Writes one cover (framed binary body) into `dir`, a folder previously returned by
/// [`pick_folder`]. Runs on a worker thread, so several can be converted at once.
#[tauri::command(async)]
fn write_image(request: Request<'_>) -> Res<String> {
    let (meta, png) = frame_of(&request)?;
    Ok(write_into(&meta, png)?.display().to_string())
}

/// Cuts the subject out of a photo (raw image bytes in the body): its mask as PNG bytes, the
/// photo's size, opaque where the subject is. See `cut::vision` in the core; macOS 14 and later.
#[tauri::command(async)]
fn subject_mask(request: Request<'_>) -> Res<tauri::ipc::Response> {
    match request.body() {
        InvokeBody::Raw(body) => Ok(tauri::ipc::Response::new(cut::vision_mask(body)?)),
        _ => Err("expected a binary body".into()),
    }
}

// ---------------------------------------------------------------- the cut-out on any platform (BiRefNet: smedcover_core::cut::onnx)

/// The cut-out models: each one's id, its size, and whether it has been downloaded.
#[tauri::command]
fn cut_models(core: State<'_, Arc<Core>>) -> Res<Vec<CutModel>> {
    Ok(core.cut_models())
}
/// Downloads a cut-out model into the app data folder, telling the page how far it has got with the
/// event `cut-model-progress` (see `cut::download`).
#[tauri::command]
async fn cut_model_download(app: AppHandle, core: State<'_, Arc<Core>>, id: String, proxy: Option<String>) -> Res<()> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        core.cut_model_download(&id, proxy.as_deref(), |progress| {
            let _ = app.emit("cut-model-progress", progress);
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cut_model_cancel() {
    cut::cancel_download();
}
#[tauri::command]
fn cut_model_delete(core: State<'_, Arc<Core>>, id: String) -> Res<()> {
    core.cut_model_delete(&id)
}
/// Cuts the subject out of a photo (raw image bytes in the body) with the model named in the header
/// `x-model`: its mask as PNG bytes, as `subject_mask` returns.
#[tauri::command(async)]
fn subject_mask_onnx(core: State<'_, Arc<Core>>, request: Request<'_>) -> Res<tauri::ipc::Response> {
    let id = request.headers().get("x-model").and_then(|v| v.to_str().ok()).ok_or("no model given")?;
    match request.body() {
        InvokeBody::Raw(body) => Ok(tauri::ipc::Response::new(core.cut_onnx(id, body)?)),
        _ => Err("expected a binary body".into()),
    }
}

/// Asks where to save a text file (project, profile, CSV template) and writes it.
#[tauri::command]
async fn save_text(app: AppHandle, name: String, text: String) -> Res<Option<String>> {
    let ext = extension(&name);
    let Some(target) = app
        .dialog()
        .file()
        .set_file_name(safe_name(&name)?.to_string_lossy())
        .add_filter(ext.to_uppercase(), &[ext.as_str()])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let path = target.into_path().map_err(err)?;
    fs::write(&path, text).map_err(err)?;
    Ok(Some(path.display().to_string()))
}

// ---------------------------------------------------------------- fonts and glyph outlines (the work itself: smedcover_core::fonts, outline)

/// The fonts shipped with the interface, as the app has them: among its assets.
struct AssetFonts(AppHandle);

impl BundledFonts for AssetFonts {
    fn get(&self, path: &str) -> Option<Vec<u8>> {
        self.0.asset_resolver().get(path.to_string()).map(|asset| asset.bytes.to_vec())
    }
}

/// See `fonts::list_system`.
#[tauri::command]
async fn list_system_fonts() -> Vec<FontInfo> {
    tauri::async_runtime::spawn_blocking(fonts::list_system)
        .await
        .unwrap_or_default()
}

/// A system family's faces, for the web view to load it from its files (see `fonts::faces`).
#[tauri::command]
async fn font_faces(family: String) -> Res<FontFaces> {
    tauri::async_runtime::spawn_blocking(move || fonts::faces(&family))
        .await
        .map_err(err)?
}

/// Face `n` of a system family (see font_faces), as a font file of its own (see `fonts::face_data`).
#[tauri::command]
async fn font_data(family: String, n: usize) -> Res<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || fonts::face_data(&family, n).map(tauri::ipc::Response::new))
        .await
        .map_err(err)?
}

/// The outlines of `text` set in the first of `families` that has each character.
#[tauri::command]
async fn text_outline(
    core: State<'_, Arc<Core>>,
    text: String,
    families: Vec<String>,
    weight: f32,
) -> Res<Outline> {
    let core = core.inner().clone();
    tauri::async_runtime::spawn_blocking(move || core.text_outline(&text, &families, weight))
        .await
        .map_err(err)?
}

// ---------------------------------------------------------------- AI request (the work itself: smedcover_core::net)

/// See `net::fetch_image`; `known` (an agent's `add_photo`): only a picture the photo store takes, by its bytes.
/// Never to the agents' endpoint (see `mcp::not_to_the_endpoint`).
#[tauri::command]
async fn fetch_image(app: AppHandle, url: String, proxy: Option<String>, timeout: Option<u64>, known: Option<bool>) -> Res<net::FetchedImage> {
    tauri::async_runtime::spawn_blocking(move || {
        mcp::not_to_the_endpoint(&app, &url, proxy.as_deref())?;
        net::fetch_image(&url, proxy.as_deref().unwrap_or(""), timeout.unwrap_or(net::AI_TIMEOUT_SECS), known.unwrap_or(false))
    })
    .await
    .map_err(err)?
}

/// Sends one request to an AI model: an asset to generate, or a photo to repaint. The web view builds
/// the request (see `ui/js/ai.js` and `ui/js/repaint.js`); sending it from here avoids the
/// cross-origin limits a web view has. `image` allows the much bigger reply a picture makes; `method`
/// "GET" asks without a body (checking a key and a model). Never to the agents' endpoint (see
/// `mcp::not_to_the_endpoint`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn ai_request(
    app: AppHandle,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
    proxy: Option<String>,
    timeout: Option<u64>,
    image: Option<bool>,
    method: Option<String>,
) -> Res<net::AiReply> {
    let request = net::AiRequest { url, headers, body, proxy, timeout, image, method };
    // a reply can take minutes: wait for it on the blocking pool, not on a runtime worker
    tauri::async_runtime::spawn_blocking(move || {
        mcp::not_to_the_endpoint(&app, &request.url, request.proxy.as_deref())?;
        net::ai_request(&request)
    })
    .await
    .map_err(err)?
}

// ---------------------------------------------------------------- files an agent names (the rules: smedcover_core::files)

/// Whether the self-test proper runs, which calls the agents' tools itself (not SMEDCOVER_SELFTEST_STAY).
fn selftest_calls_tools() -> bool {
    selftest_root().is_some() && !selftest_stay()
}

/// A picture on this computer for an agent's `add_photo` (see `files::read_picture`): its bytes, as they are. Only
/// while a call in hand names this very picture (see `mcp::may_read`).
#[tauri::command]
async fn read_picture(app: AppHandle, path: String) -> Res<tauri::ipc::Response> {
    mcp::agent_named(&app, selftest_calls_tools(), mcp::FileKind::Picture, &path)?;
    tauri::async_runtime::spawn_blocking(move || files::read_picture(Path::new(&path)).map(|(_, bytes)| tauri::ipc::Response::new(bytes)))
        .await
        .map_err(err)?
}

/// A project file on this computer for an agent's `open_project` (see `files::read_project`): its text. Only while a
/// call in hand names this very file (see `mcp::may_read`).
#[tauri::command]
async fn read_project(app: AppHandle, path: String) -> Res<String> {
    mcp::agent_named(&app, selftest_calls_tools(), mcp::FileKind::Project, &path)?;
    tauri::async_runtime::spawn_blocking(move || files::read_project(Path::new(&path)))
        .await
        .map_err(err)?
}

/// In self-test mode, a real photo to cut the subject out of (SMEDCOVER_SELFTEST_PHOTO), as a data URL.
#[tauri::command]
fn selftest_photo() -> Option<String> {
    use base64::Engine;
    selftest_root()?;
    let bytes = fs::read(std::env::var("SMEDCOVER_SELFTEST_PHOTO").ok()?).ok()?;
    let mime = if bytes.starts_with(b"\x89PNG") { "image/png" } else { "image/jpeg" };
    Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// In self-test mode, a folder that already holds downloaded cut-out models (SMEDCOVER_SELFTEST_MODELS,
/// the `models` folder of a data folder), linked into the self-test's data folder. Whether there is one.
#[tauri::command]
fn selftest_models(core: State<'_, Arc<Core>>) -> Res<bool> {
    selftest_root().ok_or("not in self-test mode")?;
    let Some(from) = std::env::var_os("SMEDCOVER_SELFTEST_MODELS") else { return Ok(false) };
    let to = core.data_dir().join("models");
    if !to.exists() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(&from, &to).map_err(err)?;
        #[cfg(not(unix))]
        return Err("SMEDCOVER_SELFTEST_MODELS needs a Unix system".into());
    }
    Ok(true)
}

/// Moves the pointer to (x, y), logical pixels in the window's content: the editor shows where a
/// scene object's handle is by taking the pointer there.
#[tauri::command]
fn move_pointer(window: tauri::Window, x: f64, y: f64) -> Result<(), String> {
    window.set_cursor_position(tauri::LogicalPosition::new(x, y)).map_err(|e| e.to_string())
}

/// In self-test mode, whether to time dragging each layer of the cover in the data folder instead
/// (SMEDCOVER_SELFTEST_DRAG): a check of how smooth dragging is on a real cover.
#[tauri::command]
fn selftest_drag() -> bool {
    selftest_root().is_some() && std::env::var_os("SMEDCOVER_SELFTEST_DRAG").is_some()
}

/// In self-test mode, whether to time how soon things show after the start instead (SMEDCOVER_SELFTEST_PERF): the
/// start's steps, the 3D view and the Look sheet's cards, opened at once.
#[tauri::command]
fn selftest_perf() -> bool {
    selftest_root().is_some() && std::env::var_os("SMEDCOVER_SELFTEST_PERF").is_some()
}

/// In self-test mode, whether a data folder with no profile starts as a first start does (SMEDCOVER_SELFTEST_WELCOME,
/// with SMEDCOVER_SELFTEST_STAY): the welcome asks for one, and no sample profile is made; the app waits on it as it
/// would on the user's own data folder, the command line told that SmedCover needs setting up.
#[tauri::command]
fn selftest_welcome() -> bool {
    selftest_root().is_some() && std::env::var_os("SMEDCOVER_SELFTEST_WELCOME").is_some()
}

/// In self-test mode, whether to call the agent tools too (SMEDCOVER_SELFTEST_AGENT): the page's dispatcher answers
/// every tool as an agent's calls, writing a picture, a project and exports into the self-test folder, and reports
/// under `agent`.
#[tauri::command]
fn selftest_agent() -> bool {
    selftest_root().is_some() && std::env::var_os("SMEDCOVER_SELFTEST_AGENT").is_some()
}

/// What this build's interface is: a hash of `ui/` as it was built (build.rs). The look cards' pictures kept from
/// one launch to the next carry it, so a build that draws otherwise does not take another's for its own. Under
/// `tauri dev` (cfg `dev`, set by tauri-build) the interface is served from its folder as it is edited, without
/// building again: its hash is made then, each time the page asks (once a load: an edit reloads it), of the files'
/// names, sizes and times there (see ui_stamp).
/// A debug build made with `tauri build --debug` has its interface built in, as a release has.
#[tauri::command]
fn ui_build() -> String {
    if cfg!(dev) {
        let mut h = 0xcbf29ce484222325u64;
        ui_stamp(Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui")), &mut h);
        format!("dev-{h:016x}")
    } else {
        env!("SMEDCOVER_UI_BUILD").to_string()
    }
}

/// Hashes the names, sizes and times of the files under `dir` but hidden ones (FNV-1a, in order) into `h`: what a
/// debug build's interface is (see ui_build), changed by any edit, without reading the files.
fn ui_stamp(dir: &Path, h: &mut u64) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = read.flatten().map(|e| e.path()).filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))).collect();
    entries.sort();
    for path in entries {
        let meta = fs::metadata(&path).ok();
        let time = meta.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_nanos());
        let len = meta.as_ref().map_or(0, |m| m.len());
        for b in path.to_string_lossy().bytes().chain(len.to_le_bytes()).chain(time.to_le_bytes()) {
            *h ^= b as u64;
            *h = h.wrapping_mul(0x100000001b3);
        }
        if path.is_dir() {
            ui_stamp(&path, h);
        }
    }
}

/// In self-test mode, the looks to go through, comma-separated (SMEDCOVER_SELFTEST_LOOKS), when only
/// some are to be checked — the new ones, say; all of them otherwise.
#[tauri::command]
fn selftest_looks() -> Option<String> {
    selftest_root()?;
    std::env::var("SMEDCOVER_SELFTEST_LOOKS").ok().filter(|s| !s.trim().is_empty())
}

/// In self-test mode, the URL of a stand-in AI endpoint to exercise `ai_request` against.
#[tauri::command]
fn selftest_ai() -> Option<String> {
    selftest_root()?;
    std::env::var("SMEDCOVER_SELFTEST_AI").ok()
}

/// The data folder (`paths::data_dir`, which a command line finds it by too): a self-test's own (`data/` in its
/// folder), else SMEDCOVER_DATA's (the command line's `--data`), else the app data directory, as Tauri's
/// `app_data_dir()` finds it (`paths::desktop_data_dir`, the same folder). Worked out before Tauri starts, so that the
/// folder's lock is taken first. `None` if the system has none for the user.
fn data_folder() -> Option<PathBuf> {
    paths::data_dir()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch = cli::Launch::from_args(std::env::args_os().skip(1));
    // launched for the command line, Ctrl-C in its terminal and the terminal closing do not stop the app: the command
    // line ends it
    if launch.cli {
        smedcover_core::instance::ignore_interrupts();
    }
    let data = data_folder();
    // one app for each data folder: a second one goes no further (see cli::single_instance); the lock is held till the
    // process ends
    let _lock = data.as_deref().and_then(|d| cli::single_instance(d, launch));
    if let Some(data) = data.as_deref() {
        cli::warn_if_shared(data);
    }
    // on Windows, the command line's copy on the user's PATH made this app's, if it is installed (see install.rs)
    if cfg!(windows) {
        std::thread::spawn(install::refresh);
    }
    // whether the page will wait on the first start's welcome (a self-test's folder gets the sample profile instead)
    let first_start = data.as_deref().is_some_and(cli::no_profile_yet) && (selftest_root().is_none() || selftest_welcome());
    let builder = tauri::Builder::default();
    // launched for the command line, the app does not take the focus from the one in front as it starts
    #[cfg(target_os = "macos")]
    let builder = builder.activate_ignoring_other_apps(!launch.cli);
    #[allow(unused_mut)]
    let mut app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::Updates::default())
        .invoke_handler(tauri::generate_handler![
            app_read,
            app_write,
            app_list,
            app_delete,
            reveal_data_dir,
            subject_mask,
            subject_mask_onnx,
            cut_models,
            cut_model_download,
            cut_model_cancel,
            cut_model_delete,
            selftest_models,
            selftest_drag,
            selftest_perf,
            selftest_agent,
            selftest_stay,
            selftest_welcome,
            cli::selftest_cli,
            cli::app_quit,
            cli::app_needs_setup,
            install::cli_status,
            install::cli_install,
            install::cli_uninstall,
            install::selftest_cli_bin,
            update::update_status,
            update::update_check,
            update::update_download,
            update::update_cancel,
            update::update_install,
            update::update_release_page,
            update::selftest_updates,
            mcp::selftest_mcp,
            mcp::mcp_status,
            mcp::mcp_set,
            mcp::mcp_require_token,
            mcp::mcp_token,
            mcp::mcp_attach,
            mcp::mcp_reply,
            mcp::mcp_progress,
            ui_build,
            move_pointer,
            selftest_photo,
            save_image,
            pick_folder,
            write_image,
            save_text,
            list_system_fonts,
            ai_request,
            fetch_image,
            read_picture,
            read_project,
            text_outline,
            font_faces,
            font_data,
            selftest_dir,
            selftest_ai,
            selftest_looks,
            selftest_done
        ])
        .setup(move |app| {
            // launched for the command line, its standard input watched from the start: at its end the app quits
            if launch.cli {
                cli::watch_stdin(app.handle().clone());
            }
            // The main window, made here so that a launch for the command line can leave it hidden (cli::make_window).
            cli::make_window(app, launch, first_start)?;
            // The data folder, found once for every command: a self-test keeps its data in its own.
            let data = match data.clone() {
                Some(data) => Ok(data),
                None => app.path().app_data_dir().map_err(err),
            };
            let core = data.and_then(|d| {
                Core::open(d.clone(), Arc::new(AssetFonts(app.handle().clone()))).map_err(|e| format!("{}: {e}", d.display()))
            });
            let core = match core {
                Ok(core) => core,
                // launched for the command line: said on stderr, the window not to be shown
                Err(e) if launch.cli => {
                    cli::say(&format!("SmedCover cannot open its data folder: {e}"));
                    app.handle().exit(1);
                    return Ok(());
                }
                // nothing could be kept: said, then the app quits (an error out of setup would end it with no word,
                // the window already up); the dialog's own way, for waiting on it here would hold the main thread
                Err(e) => {
                    let h = app.handle().clone();
                    app.dialog()
                        .message(format!("SmedCover 打不开它的数据文件夹，只能退出。\nSmedCover cannot open its data folder and has to quit.\n\n{e}"))
                        .kind(tauri_plugin_dialog::MessageDialogKind::Error)
                        .title("SmedCover")
                        .show(move |_| h.exit(1));
                    return Ok(());
                }
            };
            // A self-test's window may open off screen — on another desktop, behind a full-screen app — and must
            // keep drawing there (see mcp::keep_drawing).
            if selftest_root().is_some() {
                mcp::keep_drawing(app.handle(), false);
            }
            // The endpoint agents call: started now if it is on, its calls waiting for the window's page.
            let selftest = selftest_root().map(|_| {
                if std::env::var_os("SMEDCOVER_SELFTEST_STAY").is_some() {
                    mcp::SelfTest::Stay
                } else if std::env::var_os("SMEDCOVER_SELFTEST_MCP").is_some() {
                    mcp::SelfTest::Mcp
                } else {
                    mcp::SelfTest::Run
                }
            });
            // Either endpoint missing, an app launched for the command line, which no one sees, has nothing to do: it
            // quits (1) rather than hold the folder unseen.
            let host = match mcp::McpHost::open(app.handle(), core.data_dir().to_path_buf(), selftest, launch.cli) {
                Ok(host) => Some(host),
                Err(e) => {
                    cli::say(&format!("SmedCover: the agents' endpoint cannot be had: {e}"));
                    None
                }
            };
            if let Some(host) = host {
                host.set_needs_setup(first_start);
                // and the command line's, whatever the user's switch says, with the cli.json it is found by
                match cli::CliApp::start(app.handle(), host.clone(), core.data_dir().to_path_buf(), launch) {
                    Ok(cli) => {
                        app.manage(cli);
                    }
                    Err(e) if launch.cli => {
                        cli::say(&format!("SmedCover: the command line's endpoint cannot be had: {e}"));
                        app.handle().exit(1);
                    }
                    Err(e) => cli::say(&format!("SmedCover: the command line's endpoint cannot be had: {e}")),
                }
                app.manage(host);
            } else if launch.cli {
                app.handle().exit(1);
            }
            app.manage(core);
            Ok(())
        })
        // a page loading in the main window (a reload) takes the calls the last one had with it
        .on_page_load(|webview, payload| {
            if matches!(payload.event(), tauri::webview::PageLoadEvent::Started) && webview.label() == "main" {
                if let Some(host) = webview.try_state::<Arc<mcp::McpHost>>() {
                    host.reloading();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building SmedCover");
    // launched for the command line, an accessory on macOS: no Dock icon and no menu bar, set before the event loop starts
    // so that none shows at all (the app becomes a regular one if the user is shown its window)
    #[cfg(target_os = "macos")]
    if launch.cli {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    }
    app.run(move |app, event| match event {
        RunEvent::WindowEvent { label, event: WindowEvent::Destroyed, .. } if label == "main" => {
            if let Some(host) = app.try_state::<Arc<mcp::McpHost>>() {
                host.window_closed();
            }
        }
        // the command line's window brought to the front by the user (it shows elsewhere than on macOS): it is theirs
        RunEvent::WindowEvent { label, event: WindowEvent::Focused(true), .. } if label == "main" => {
            if let Some(cli) = app.try_state::<Arc<cli::CliApp>>() {
                cli.focused();
            }
        }
        // opened again from the Finder or the Dock while it runs: the command line's app is shown to the user (and the
        // window of one whose command line's side is not there yet)
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => match app.try_state::<Arc<cli::CliApp>>() {
            Some(cli) => cli.reopened(),
            None if launch.cli => cli::show_window(app, true),
            None => {}
        },
        // cli.json goes, and the endpoints stop with the app, their ports free
        RunEvent::Exit => {
            if let Some(cli) = app.try_state::<Arc<cli::CliApp>>() {
                cli.remove_file();
            }
            if let Some(host) = app.try_state::<Arc<mcp::McpHost>>() {
                tauri::async_runtime::block_on(host.shut());
            }
        }
        _ => {}
    });
}
