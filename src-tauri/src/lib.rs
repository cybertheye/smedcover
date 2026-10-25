//! SmedCover — native shell for the cover generator.
//!
//! All drawing happens in the web view (`ui/`). What the Rust side does for it is mostly in
//! `smedcover-core` (`core/`), which a server can share: the sandboxed store, exporting covers,
//! fonts and the outlines of lettering, and the AI request. This is the desktop app around it:
//!
//! * the data folder, found once at the start (the app data directory, or a self-test's) and kept
//!   as the [`Core`] the commands use;
//! * the commands, most of them a thin wrapper round the core's work, the slow ones run off the
//!   main thread;
//! * what only the desktop has: the system's dialogs, the file manager, the pointer, the self-test.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use smedcover_core::fonts::{self, FontFaces, FontInfo};
use smedcover_core::image::{encode, extension, parse_frame, safe_name, write_into, ExportMeta};
use smedcover_core::outline::Outline;
use smedcover_core::{err, net, BundledFonts, Core, Res};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

mod matting;
mod subject;

/// Folder given in `SMEDCOVER_SELFTEST`, if any. In that mode the app keeps its data there instead
/// of the real app data directory, exports a few covers into it through the normal code path,
/// writes `report.json` and quits — an end-to-end check of the web view / Rust bridge.
fn selftest_root() -> Option<PathBuf> {
    std::env::var_os("SMEDCOVER_SELFTEST")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
}

#[tauri::command]
fn selftest_dir() -> Option<String> {
    selftest_root().map(|p| p.display().to_string())
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
/// photo's size, opaque where the subject is. See `subject.rs`; macOS 14 and later.
#[tauri::command(async)]
fn subject_mask(request: Request<'_>) -> Res<tauri::ipc::Response> {
    match request.body() {
        InvokeBody::Raw(body) => Ok(tauri::ipc::Response::new(subject::mask_png(body)?)),
        _ => Err("expected a binary body".into()),
    }
}

// ---------------------------------------------------------------- the cut-out on any platform (BiRefNet, see matting.rs)

/// A cut-out model: its id, its size, and whether it has been downloaded.
#[derive(Serialize)]
struct CutModel {
    id: &'static str,
    bytes: u64,
    have: bool,
}
#[tauri::command]
fn cut_models(core: State<'_, Arc<Core>>) -> Res<Vec<CutModel>> {
    let data = core.data_dir();
    Ok(matting::MODELS.iter().map(|m| CutModel { id: m.id, bytes: m.file.bytes, have: matting::have(data, m) }).collect())
}
/// How a download is getting on, sent as the event `cut-model-progress`.
#[derive(Clone, Serialize)]
struct CutProgress {
    id: String,
    done: u64,
    total: u64,
}
/// Downloads a cut-out model into the app data folder, telling the page how far it has got.
/// The wait is per read, not for the whole file: a big model on a slow line takes long but is fine.
#[tauri::command]
async fn cut_model_download(app: AppHandle, core: State<'_, Arc<Core>>, id: String, proxy: Option<String>) -> Res<()> {
    let m = matting::model(&id)?;
    let data = core.data_dir().to_path_buf();
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120));
    if let Some(p) = net::proxy_for(m.file.url, proxy.as_deref().unwrap_or("")) {
        builder = builder.proxy(ureq::Proxy::new(&p).map_err(|e| format!("proxy {p}: {e}"))?);
    }
    let agent = builder.build();
    tauri::async_runtime::spawn_blocking(move || {
        matting::download(&agent, &data, m, |done, total| {
            let _ = app.emit("cut-model-progress", CutProgress { id: id.clone(), done, total });
        })
    })
    .await
    .map_err(err)?
}
#[tauri::command]
fn cut_model_cancel() {
    matting::CANCEL.store(true, std::sync::atomic::Ordering::SeqCst);
}
#[tauri::command]
fn cut_model_delete(core: State<'_, Arc<Core>>, id: String) -> Res<()> {
    matting::remove(core.data_dir(), matting::model(&id)?)
}
/// Cuts the subject out of a photo (raw image bytes in the body) with the model named in the header
/// `x-model`: its mask as PNG bytes, as `subject_mask` returns.
#[tauri::command(async)]
fn subject_mask_onnx(core: State<'_, Arc<Core>>, request: Request<'_>) -> Res<tauri::ipc::Response> {
    let id = request.headers().get("x-model").and_then(|v| v.to_str().ok()).ok_or("no model given")?;
    let m = matting::model(id)?;
    let data = core.data_dir();
    if !matting::have(data, m) {
        return Err("model not downloaded".into());
    }
    match request.body() {
        InvokeBody::Raw(body) => Ok(tauri::ipc::Response::new(matting::mask_png(data, m, body)?)),
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

/// See `net::fetch_image`.
#[tauri::command]
async fn fetch_image(url: String, proxy: Option<String>, timeout: Option<u64>) -> Res<net::FetchedImage> {
    tauri::async_runtime::spawn_blocking(move || {
        net::fetch_image(&url, proxy.as_deref().unwrap_or(""), timeout.unwrap_or(net::AI_TIMEOUT_SECS))
    })
    .await
    .map_err(err)?
}

/// Sends one request to an AI model: an asset to generate, or a photo to repaint. The web view builds
/// the request (see `ui/js/ai.js` and `ui/js/repaint.js`); sending it from here avoids the
/// cross-origin limits a web view has. `image` allows the much bigger reply a picture makes; `method`
/// "GET" asks without a body (checking a key and a model).
#[tauri::command]
async fn ai_request(
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
    tauri::async_runtime::spawn_blocking(move || net::ai_request(&request))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
            text_outline,
            font_faces,
            font_data,
            selftest_dir,
            selftest_ai,
            selftest_looks,
            selftest_done
        ])
        .setup(|app| {
            // The data folder, found once for every command: a self-test keeps its data in its own.
            let data = match selftest_root() {
                Some(root) => root.join("data"),
                None => app.path().app_data_dir()?,
            };
            app.manage(Core::open(data, Arc::new(AssetFonts(app.handle().clone())))?);
            // A self-test's window may open off screen — on another desktop, behind a full-screen app —
            // and WebKit then stops drawing for it: a canvas read back (an export, a PNG) waits for good,
            // every process idle. So in self-test mode the web view is told not to watch whether its window
            // can be seen (the setting WebKit's own tests use), and keeps drawing unseen.
            #[cfg(target_os = "macos")]
            if selftest_root().is_some() {
                use tauri::Manager;
                for w in app.webview_windows().values() {
                    let _ = w.with_webview(|wv| unsafe {
                        let view = wv.inner() as *mut objc2::runtime::AnyObject;
                        let sel = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
                        let can: bool = objc2::msg_send![view, respondsToSelector: sel];
                        if can {
                            let _: () = objc2::msg_send![view, _setWindowOcclusionDetectionEnabled: false];
                        }
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SmedCover");
}
