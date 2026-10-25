//! SmedCover — native shell for the cover generator.
//!
//! All drawing happens in the web view (`ui/`). This side owns the file system:
//!
//! * a small sandboxed store under the app data directory (profiles, settings, session, fonts);
//! * exporting covers: the web view sends PNG bytes in a raw, framed request body (no base64),
//!   which are converted to PNG, JPEG or WebP and written here, off the main thread;
//! * listing the fonts installed on the system;
//! * tracing lettering: the outlines of a text's glyphs, for effects that reshape the letters;
//! * sending the request for an AI-generated asset, so it is not subject to the web view's
//!   cross-origin rules.

use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, ErrorKind, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use image::{codecs::jpeg::JpegEncoder, ImageFormat, RgbImage};
use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

mod matting;
mod subject;

/// Colour put behind transparent pixels when saving JPEG (the app's dark field colour).
const MATTE: [u8; 3] = [10, 10, 18];

type Res<T> = Result<T, String>;
fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------------------------------------------------------- sandboxed app store

/// Resolves `rel` inside `root`, refusing absolute paths and any `..` component.
fn resolve(root: &Path, rel: &str) -> Res<PathBuf> {
    let rel_path = Path::new(rel);
    let safe = !rel.is_empty()
        && rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !safe {
        return Err(format!("invalid path: {rel}"));
    }
    Ok(root.join(rel_path))
}

fn store_read(root: &Path, rel: &str) -> Res<Option<String>> {
    match fs::read_to_string(resolve(root, rel)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

fn store_write(root: &Path, rel: &str, data: &str) -> Res<()> {
    let path = resolve(root, rel)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    // write-then-rename so a crash never leaves a half-written profile behind
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

fn store_list(root: &Path, rel: &str) -> Res<Vec<String>> {
    let entries = match fs::read_dir(resolve(root, rel)?) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(err(e)),
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

fn store_delete(root: &Path, rel: &str) -> Res<()> {
    match fs::remove_file(resolve(root, rel)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}

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

fn data_root(app: &AppHandle) -> Res<PathBuf> {
    let dir = match selftest_root() {
        Some(root) => root.join("data"),
        None => app.path().app_data_dir().map_err(err)?,
    };
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir)
}

#[tauri::command]
fn app_read(app: AppHandle, path: String) -> Res<Option<String>> {
    store_read(&data_root(&app)?, &path)
}

#[tauri::command]
fn app_write(app: AppHandle, path: String, data: String) -> Res<()> {
    store_write(&data_root(&app)?, &path, &data)?;
    if let Some(family) = path.strip_prefix("fonts/").and_then(|p| p.strip_suffix(".font")) {
        forget_font(family); // imported (again): its outlines are traced from this file from now on
    }
    Ok(())
}

#[tauri::command]
fn app_list(app: AppHandle, dir: String) -> Res<Vec<String>> {
    store_list(&data_root(&app)?, &dir)
}

#[tauri::command]
fn app_delete(app: AppHandle, path: String) -> Res<()> {
    store_delete(&data_root(&app)?, &path)
}

/// Shows a folder of the app's data (created if missing) in the system's file manager, for the
/// user to put files in or edit them (the repaint styles). Only folders inside the data root.
#[tauri::command]
fn reveal_data_dir(app: AppHandle, dir: String) -> Res<()> {
    let path = resolve(&data_root(&app)?, &dir)?;
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

// ---------------------------------------------------------------- image export

/// Re-encodes PNG bytes as `format` ("png" | "jpeg" | "webp"). JPEG is flattened onto
/// [`MATTE`]; WebP is lossless.
fn encode(png: &[u8], format: &str, quality: u8) -> Res<Vec<u8>> {
    if format == "png" {
        return Ok(png.to_vec());
    }
    let img = image::load_from_memory_with_format(png, ImageFormat::Png).map_err(err)?;
    let mut out = Vec::new();
    match format {
        "jpeg" => {
            let rgba = img.to_rgba8();
            let mut rgb = RgbImage::new(rgba.width(), rgba.height());
            for (dst, src) in rgb.pixels_mut().zip(rgba.pixels()) {
                let a = u32::from(src[3]);
                for c in 0..3 {
                    dst[c] = ((u32::from(src[c]) * a + u32::from(MATTE[c]) * (255 - a) + 127) / 255)
                        as u8;
                }
            }
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .encode_image(&rgb)
                .map_err(err)?;
        }
        "webp" => img
            .to_rgba8()
            .write_to(&mut Cursor::new(&mut out), ImageFormat::WebP)
            .map_err(err)?,
        other => return Err(format!("unsupported format: {other}")),
    }
    Ok(out)
}

/// What accompanies the image bytes of an export request.
#[derive(Deserialize)]
struct ExportMeta {
    name: String,
    format: String,
    quality: u8,
    #[serde(default)]
    dir: String,
}

/// Splits a binary export request into its metadata and PNG bytes. The body is framed as
/// `[u32 little-endian length][JSON metadata][PNG]`, so file names and pixels travel together
/// without base64 and without relying on request headers.
fn parse_frame(body: &[u8]) -> Res<(ExportMeta, &[u8])> {
    let len = body
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("request too short")?;
    let meta = body.get(4..4 + len).ok_or("truncated metadata")?;
    let meta: ExportMeta =
        serde_json::from_slice(meta).map_err(|e| format!("invalid metadata: {e}"))?;
    Ok((meta, &body[4 + len..]))
}

fn frame_of<'a>(request: &'a Request<'_>) -> Res<(ExportMeta, &'a [u8])> {
    match request.body() {
        InvokeBody::Raw(body) => parse_frame(body),
        _ => Err("expected a binary body".into()),
    }
}

/// Keeps only the final path component, so a name can never escape the chosen folder.
fn safe_name(name: &str) -> Res<&std::ffi::OsStr> {
    Path::new(name)
        .file_name()
        .ok_or_else(|| format!("invalid file name: {name}"))
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
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
    let dir = PathBuf::from(&meta.dir);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("not a folder: {}", dir.display()));
    }
    let path = dir.join(safe_name(&meta.name)?);
    fs::write(&path, encode(png, &meta.format, meta.quality)?).map_err(err)?;
    Ok(path.display().to_string())
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
fn cut_models(app: AppHandle) -> Res<Vec<CutModel>> {
    let data = data_root(&app)?;
    Ok(matting::MODELS.iter().map(|m| CutModel { id: m.id, bytes: m.file.bytes, have: matting::have(&data, m) }).collect())
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
async fn cut_model_download(app: AppHandle, id: String, proxy: Option<String>) -> Res<()> {
    let m = matting::model(&id)?;
    let data = data_root(&app)?;
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120));
    if let Some(p) = proxy_for(m.file.url, proxy.as_deref().unwrap_or("")) {
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
fn cut_model_delete(app: AppHandle, id: String) -> Res<()> {
    matting::remove(&data_root(&app)?, matting::model(&id)?)
}
/// Cuts the subject out of a photo (raw image bytes in the body) with the model named in the header
/// `x-model`: its mask as PNG bytes, as `subject_mask` returns.
#[tauri::command(async)]
fn subject_mask_onnx(app: AppHandle, request: Request<'_>) -> Res<tauri::ipc::Response> {
    let id = request.headers().get("x-model").and_then(|v| v.to_str().ok()).ok_or("no model given")?;
    let m = matting::model(id)?;
    let data = data_root(&app)?;
    if !matting::have(&data, m) {
        return Err("model not downloaded".into());
    }
    match request.body() {
        InvokeBody::Raw(body) => Ok(tauri::ipc::Response::new(matting::mask_png(&data, m, body)?)),
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

// ---------------------------------------------------------------- fonts

/// A font family installed on this machine, and whether it can set Chinese.
#[derive(Serialize)]
struct FontInfo {
    name: String,
    cjk: bool,
}

/// The font families installed on this machine, sorted, without duplicates. A family counts as
/// able to set Chinese when one of its faces has glyphs for a few everyday characters; a font
/// without them leaves Chinese text to whatever the system falls back to.
#[tauri::command]
async fn list_system_fonts() -> Vec<FontInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        let mut found: std::collections::BTreeMap<String, bool> = std::collections::BTreeMap::new();
        for face in db.faces() {
            let Some((name, _)) = face.families.first() else { continue };
            if name.starts_with('.') {
                continue;
            }
            let known = found.get(name).copied().unwrap_or(false);
            let cjk = known
                || db
                    .with_face_data(face.id, |data, index| {
                        ttf_parser::Face::parse(data, index)
                            .map(|f| "的封面".chars().all(|c| f.glyph_index(c).is_some()))
                            .unwrap_or(false)
                    })
                    .unwrap_or(false);
            found.insert(name.clone(), cjk);
        }
        let mut fonts: Vec<FontInfo> = found.into_iter().map(|(name, cjk)| FontInfo { name, cjk }).collect();
        fonts.sort_by_key(|f| f.name.to_lowercase());
        fonts
    })
    .await
    .unwrap_or_default()
}

// ---------------------------------------------------------------- glyph outlines

/// One glyph of a traced text: how far the pen moves on (in ems), and its outline as closed
/// polylines `[x0, y0, x1, y1, …]` in ems with y pointing down, curves already flattened.
#[derive(Serialize, Debug, PartialEq)]
struct Glyph {
    adv: f32,
    c: Vec<Vec<f32>>,
}

/// A traced text. `missing` is set when some character had no glyph in any of the fonts.
#[derive(Serialize, Debug)]
struct Outline {
    glyphs: Vec<Glyph>,
    missing: bool,
}

/// Collects a glyph's outline as polylines, scaled to ems and flipped to y-down.
struct Flatten {
    k: f32,
    done: Vec<Vec<f32>>,
    cur: Vec<f32>,
    at: (f32, f32),
}

impl Flatten {
    fn push(&mut self, x: f32, y: f32) {
        self.cur.push((x * self.k * 1e4).round() / 1e4);
        self.cur.push((-y * self.k * 1e4).round() / 1e4);
        self.at = (x, y);
    }
    fn finish(&mut self) {
        if self.cur.len() >= 6 {
            self.done.push(std::mem::take(&mut self.cur));
        } else {
            self.cur.clear();
        }
    }
}

impl ttf_parser::OutlineBuilder for Flatten {
    fn move_to(&mut self, x: f32, y: f32) {
        self.finish();
        self.push(x, y);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.push(x, y);
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (x0, y0) = self.at;
        for i in 1..=6 {
            let t = i as f32 / 6.0;
            let u = 1.0 - t;
            self.push(
                u * u * x0 + 2.0 * u * t * x1 + t * t * x,
                u * u * y0 + 2.0 * u * t * y1 + t * t * y,
            );
        }
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (x0, y0) = self.at;
        for i in 1..=8 {
            let t = i as f32 / 8.0;
            let u = 1.0 - t;
            self.push(
                u * u * u * x0 + 3.0 * u * u * t * x1 + 3.0 * u * t * t * x2 + t * t * t * x,
                u * u * u * y0 + 3.0 * u * u * t * y1 + 3.0 * u * t * t * y2 + t * t * t * y,
            );
        }
    }
    fn close(&mut self) {
        self.finish();
    }
}

/// Traces `text` with the first of `fonts` (font file bytes and face index) that has each
/// character, at `weight` where a font is variable. No shaping: one glyph per character, laid
/// side by side — which is all headline lettering needs.
fn trace(text: &str, fonts: &[Arc<(Vec<u8>, u32)>], weight: f32) -> Outline {
    let faces: Vec<ttf_parser::Face> = fonts
        .iter()
        .filter_map(|f| ttf_parser::Face::parse(&f.0, f.1).ok())
        .map(|mut face| {
            if face.is_variable() {
                face.set_variation(ttf_parser::Tag::from_bytes(b"wght"), weight);
            }
            face
        })
        .collect();
    let mut glyphs = Vec::new();
    let mut missing = false;
    for ch in text.chars() {
        let found = faces
            .iter()
            .find_map(|face| face.glyph_index(ch).map(|id| (face, id)));
        match found {
            Some((face, id)) => {
                let k = 1.0 / f32::from(face.units_per_em());
                let mut flat = Flatten {
                    k,
                    done: Vec::new(),
                    cur: Vec::new(),
                    at: (0.0, 0.0),
                };
                face.outline_glyph(id, &mut flat);
                flat.finish();
                let adv = f32::from(face.glyph_hor_advance(id).unwrap_or(0)) * k;
                glyphs.push(Glyph { adv, c: flat.done });
            }
            None => {
                missing = missing || !ch.is_whitespace();
                glyphs.push(Glyph {
                    adv: 0.3,
                    c: Vec::new(),
                });
            }
        }
    }
    Outline { glyphs, missing }
}

/// Font files already found (or found to be absent), by lower-cased family name.
static FONT_FILES: OnceLock<Mutex<HashMap<String, Option<Arc<(Vec<u8>, u32)>>>>> = OnceLock::new();
/// The fonts installed on the system, scanned once.
static SYSTEM_FONTS: OnceLock<fontdb::Database> = OnceLock::new();
/// The fonts shipped with the interface, by family name.
const BUNDLED_FONTS: [(&str, &str); 3] = [
    ("noto sans sc", "fonts/NotoSansSC.ttf"),
    ("bebas neue", "fonts/BebasNeue-Regular.ttf"),
    ("jetbrains mono", "fonts/JetBrainsMono.ttf"),
];

/// The bytes of a font the user imported: it is stored as a data URL in the app data directory.
fn imported_font(app: &AppHandle, family: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let text = store_read(&data_root(app).ok()?, &format!("fonts/{family}.font")).ok()??;
    let b64 = text.split_once("base64,")?.1;
    base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()
}

/// Lets go of the file found for a family (see font_file), to be looked for again: a font imported under its name.
fn forget_font(family: &str) {
    if let Some(files) = FONT_FILES.get() {
        if let Ok(mut files) = files.lock() {
            files.remove(&family.trim().to_lowercase());
        }
    }
}

/// The fonts installed on the system (scanned the first time they are needed).
fn system_fonts() -> &'static fontdb::Database {
    SYSTEM_FONTS.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// Finds the file behind a family name: a bundled font, one the user imported, or a system font.
fn font_file(app: &AppHandle, family: &str) -> Option<Arc<(Vec<u8>, u32)>> {
    let key = family.trim().to_lowercase();
    let files = FONT_FILES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(known) = files.lock().ok()?.get(&key) {
        return known.clone();
    }
    let bundled = BUNDLED_FONTS
        .iter()
        .find(|(name, _)| *name == key)
        .and_then(|(_, path)| app.asset_resolver().get((*path).to_string()))
        .map(|asset| (asset.bytes.to_vec(), 0));
    let found = bundled
        .or_else(|| imported_font(app, family.trim()).map(|bytes| (bytes, 0)))
        .or_else(|| {
            let db = system_fonts();
            let id = db.query(&fontdb::Query {
                families: &[fontdb::Family::Name(family.trim())],
                weight: fontdb::Weight::BLACK,
                ..fontdb::Query::default()
            })?;
            db.with_face_data(id, |data, index| (data.to_vec(), index))
        })
        .map(Arc::new);
    files.lock().ok()?.insert(key, found.clone());
    found
}

/// One face of a font file as a font file of its own, for the web view to load: a collection (.ttc)
/// is cut down to the face at `index`, its table directory and the tables that points at; a single
/// font is handed back as it is. None if the file is not what it claims.
fn single_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    let u32_at = |at: usize| data.get(at..at + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    if data.get(0..4)? != b"ttcf" {
        return Some(data.to_vec());
    }
    if index >= u32_at(8)? {
        return None;
    }
    let at = u32_at(12 + 4 * index as usize)? as usize;
    let n = data.get(at + 4..at + 6).map(|b| u16::from_be_bytes([b[0], b[1]]))? as usize;
    let mut out = data.get(at..at + 12)?.to_vec();
    let (mut bodies, mut offset) = (Vec::with_capacity(n), 12 + 16 * n);
    for i in 0..n {
        let rec = at + 12 + 16 * i;
        let (start, len) = (u32_at(rec + 8)? as usize, u32_at(rec + 12)? as usize);
        bodies.push(data.get(start..start.checked_add(len)?)?);
        out.extend_from_slice(data.get(rec..rec + 8)?); // tag and checksum
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(len as u32).to_be_bytes());
        offset += (len + 3) & !3;
    }
    for body in bodies {
        out.extend_from_slice(body);
        out.resize((out.len() + 3) & !3, 0);
    }
    Some(out)
}

/// The upright faces the system has of `family`, one per weight, lightest first (all its faces if it
/// has no upright one).
fn family_faces(family: &str) -> Vec<fontdb::ID> {
    let name = family.trim();
    let mut all: Vec<&fontdb::FaceInfo> = system_fonts()
        .faces()
        .filter(|f| f.families.iter().any(|(n, _)| n == name))
        .collect();
    if all.iter().any(|f| f.style == fontdb::Style::Normal && f.stretch == fontdb::Stretch::Normal) {
        all.retain(|f| f.style == fontdb::Style::Normal && f.stretch == fontdb::Stretch::Normal);
    }
    all.sort_by_key(|f| f.weight.0);
    all.dedup_by_key(|f| f.weight.0);
    all.iter().map(|f| f.id).collect()
}

/// A few characters a font has, to try it with: those of the editor's own probe it has, or else the
/// first it has.
fn probe_text(face: &ttf_parser::Face) -> String {
    let mut out: String = "封面Aa01".chars().filter(|&ch| face.glyph_index(ch).is_some()).collect();
    if out.chars().count() >= 3 {
        return out;
    }
    if let Some(cmap) = face.tables().cmap {
        for table in cmap.subtables.into_iter().filter(|t| t.is_unicode()) {
            table.codepoints(|cp| {
                if out.chars().count() >= 8 || cp <= 0x20 {
                    return;
                }
                if let Some(ch) = char::from_u32(cp).filter(|ch| !ch.is_whitespace() && !ch.is_control()) {
                    if face.glyph_index(ch).is_some() && !out.contains(ch) {
                        out.push(ch);
                    }
                }
            });
        }
    }
    out
}

/// A system family's faces as the web view is to load them (see font_data): the weight of each — a
/// variable one's weight axis as a range, "min max" — and characters to try the family with.
#[derive(Serialize, Debug)]
struct FontFaces {
    probe: String,
    weights: Vec<String>,
}

/// WebKit sets a canvas that is not in the page — the effects' work canvases, an export — only in the
/// fonts that came with the system; one the user installed, or one macOS downloads on demand, falls
/// back to the default there. Such a family is loaded into the page from its files, where every canvas
/// finds it (see ensureFont in app.js): font_faces says what there is, font_data hands over each face.
#[tauri::command]
async fn font_faces(family: String) -> Res<FontFaces> {
    tauri::async_runtime::spawn_blocking(move || {
        let (db, ids) = (system_fonts(), family_faces(&family));
        if ids.is_empty() {
            return Err("no such font".to_string());
        }
        let mut out = FontFaces { probe: String::new(), weights: Vec::new() };
        for id in ids {
            let weight = db.face(id).map(|f| f.weight.0).unwrap_or(400).to_string();
            let range = db
                .with_face_data(id, |data, index| {
                    let face = ttf_parser::Face::parse(data, index).ok()?;
                    if out.probe.is_empty() {
                        out.probe = probe_text(&face);
                    }
                    let axis = face.variation_axes().into_iter().find(|a| a.tag == ttf_parser::Tag::from_bytes(b"wght"))?;
                    Some(format!("{} {}", axis.min_value.round(), axis.max_value.round()))
                })
                .flatten();
            out.weights.push(range.unwrap_or(weight));
        }
        Ok(out)
    })
    .await
    .map_err(err)?
}

/// Face `n` of a system family (see font_faces), as a font file of its own (see single_face).
#[tauri::command]
async fn font_data(family: String, n: usize) -> Res<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = *family_faces(&family).get(n).ok_or("no such face")?;
        system_fonts()
            .with_face_data(id, |data, index| single_face(data, index))
            .flatten()
            .map(tauri::ipc::Response::new)
            .ok_or_else(|| "unreadable font file".to_string())
    })
    .await
    .map_err(err)?
}

/// The outlines of `text` set in the first of `families` that has each character.
#[tauri::command]
async fn text_outline(
    app: AppHandle,
    text: String,
    families: Vec<String>,
    weight: f32,
) -> Res<Outline> {
    tauri::async_runtime::spawn_blocking(move || {
        let fonts: Vec<_> = families.iter().filter_map(|f| font_file(&app, f)).collect();
        if fonts.is_empty() {
            return Err("no usable font".to_string());
        }
        Ok(trace(&text, &fonts, weight.clamp(1.0, 1000.0)))
    })
    .await
    .map_err(err)?
}

// ---------------------------------------------------------------- AI request

/// How long an AI request may take unless the caller says otherwise, and the most of a reply
/// that is read. Models that reason before answering can need several minutes.
const AI_TIMEOUT_SECS: u64 = 300;
const AI_MAX_REPLY: u64 = 4 * 1024 * 1024;
/// A reply carrying a picture (a repainted photo, as base64) is allowed to be this big.
const AI_MAX_IMAGE_REPLY: u64 = 64 * 1024 * 1024;

/// What came back from an AI endpoint: the status and body are handed to the web view as they
/// are, error replies included, so it can show the provider's own message.
#[derive(Serialize, Debug)]
struct AiReply {
    status: u16,
    text: String,
}

fn read_capped(response: ureq::Response, cap: u64) -> Res<String> {
    let mut text = String::new();
    response
        .into_reader()
        .take(cap)
        .read_to_string(&mut text)
        .map_err(net_err)?;
    Ok(text)
}

/// A request's error as text, a wait that ran out always saying "timed out", which is what the web
/// view looks for to explain it (ai.timedOut in app.js): Windows words it "os error 10060" alone.
fn net_err<E: std::error::Error + 'static>(e: E) -> String {
    let text = e.to_string();
    let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(&e);
    while let Some(c) = cause {
        let io = c.downcast_ref::<std::io::Error>();
        if io.is_some_and(|io| io.kind() == std::io::ErrorKind::TimedOut) {
            return if text.to_lowercase().contains("timed out") { text } else { format!("timed out: {text}") };
        }
        cause = c.source();
    }
    text
}

/// An agent for `url`: the timeout, and the proxy if one applies.
fn agent_for(url: &str, proxy: &str, timeout_secs: u64) -> Res<ureq::Agent> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("invalid URL: {url}"));
    }
    let timeout = std::time::Duration::from_secs(timeout_secs.clamp(5, 1800));
    let mut builder = ureq::AgentBuilder::new().timeout(timeout);
    if let Some(p) = proxy_for(url, proxy) {
        builder = builder.proxy(ureq::Proxy::new(&p).map_err(|e| format!("proxy {p}: {e}"))?);
    }
    Ok(builder.build())
}

/// Whether a URL points at this machine (a local model server), which no proxy should sit in front of.
fn is_local(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.split(':').next().unwrap_or(""),
    };
    host.eq_ignore_ascii_case("localhost") || host == "::1" || host.starts_with("127.")
}

/// The proxy to use for `url`: the one given, else — for hosts that are not this machine — the
/// one in the usual environment variables.
fn proxy_for(url: &str, given: &str) -> Option<String> {
    if !given.trim().is_empty() {
        return Some(given.trim().to_string());
    }
    if is_local(url) {
        return None;
    }
    let names: &[&str] = if url.starts_with("https://") {
        &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    } else {
        &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    };
    names
        .iter()
        .find_map(|n| std::env::var(n).ok().filter(|v| !v.trim().is_empty()))
}

/// POSTs a JSON body to an http(s) URL with the given headers, optionally through a proxy.
#[cfg(test)]
fn post_json(
    url: &str,
    headers: &[(String, String)],
    body: &str,
    proxy: &str,
    timeout_secs: u64,
    cap: u64,
) -> Res<AiReply> {
    send(url, "POST", headers, body, proxy, timeout_secs, cap)
}

/// Sends a request — a POST with a body, or a GET (`method` "GET", the body ignored) — and returns
/// the status and the reply as they are, error replies included.
fn send(
    url: &str,
    method: &str,
    headers: &[(String, String)],
    body: &str,
    proxy: &str,
    timeout_secs: u64,
    cap: u64,
) -> Res<AiReply> {
    let agent = agent_for(url, proxy, timeout_secs)?;
    let get = method.eq_ignore_ascii_case("GET");
    let mut request = if get { agent.get(url) } else { agent.post(url) };
    for (name, value) in headers {
        request = request.set(name, value);
    }
    match if get { request.call() } else { request.send_string(body) } {
        Ok(response) => Ok(AiReply {
            status: response.status(),
            text: read_capped(response, cap)?,
        }),
        Err(ureq::Error::Status(status, response)) => Ok(AiReply {
            status,
            text: read_capped(response, AI_MAX_REPLY).unwrap_or_default(),
        }),
        Err(e) => Err(net_err(e)),
    }
}

/// Downloads a picture an image model left at a link instead of sending it: `{mime, data}` with the
/// bytes in base64. Only pictures are accepted, and no bigger than a reply with one inside may be.
fn get_image(url: &str, proxy: &str, timeout_secs: u64) -> Res<FetchedImage> {
    use base64::Engine;
    let agent = agent_for(url, proxy, timeout_secs)?;
    let response = agent.get(url).call().map_err(net_err)?;
    let mime = response.content_type().to_ascii_lowercase();
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(AI_MAX_IMAGE_REPLY)
        .read_to_end(&mut bytes)
        .map_err(net_err)?;
    let mime = if mime.starts_with("image/") {
        mime
    } else {
        match image::guess_format(&bytes) {
            Ok(ImageFormat::Png) => "image/png".into(),
            Ok(ImageFormat::Jpeg) => "image/jpeg".into(),
            Ok(ImageFormat::WebP) => "image/webp".into(),
            _ => return Err("the link did not lead to a picture".into()),
        }
    };
    Ok(FetchedImage {
        mime,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[derive(Serialize)]
struct FetchedImage {
    mime: String,
    data: String,
}

/// See `get_image`.
#[tauri::command]
async fn fetch_image(url: String, proxy: Option<String>, timeout: Option<u64>) -> Res<FetchedImage> {
    tauri::async_runtime::spawn_blocking(move || {
        get_image(&url, proxy.as_deref().unwrap_or(""), timeout.unwrap_or(AI_TIMEOUT_SECS))
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
) -> Res<AiReply> {
    let cap = if image.unwrap_or(false) { AI_MAX_IMAGE_REPLY } else { AI_MAX_REPLY };
    // a reply can take minutes: wait for it on the blocking pool, not on a runtime worker
    tauri::async_runtime::spawn_blocking(move || {
        send(
            &url,
            method.as_deref().unwrap_or("POST"),
            &headers,
            &body,
            proxy.as_deref().unwrap_or(""),
            timeout.unwrap_or(AI_TIMEOUT_SECS),
            cap,
        )
    })
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
fn selftest_models(app: AppHandle) -> Res<bool> {
    selftest_root().ok_or("not in self-test mode")?;
    let Some(from) = std::env::var_os("SMEDCOVER_SELFTEST_MODELS") else { return Ok(false) };
    let to = data_root(&app)?.join("models");
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

/// In self-test mode, whether to call the agent tools too (SMEDCOVER_SELFTEST_AGENT): the page's dispatcher answers
/// the read-only tools, the selection, undo and redo as an agent's calls, and reports under `agent`.
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
            selftest_agent,
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
            #[cfg(not(target_os = "macos"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SmedCover");
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn png(img: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/data");
        assert_eq!(
            resolve(root, "profiles/a.json").unwrap(),
            root.join("profiles/a.json")
        );
        // an interior "." is dropped by Path and is harmless: it stays inside the root
        assert_eq!(resolve(root, "a/./b").unwrap(), root.join("a/b"));
        for bad in ["", "../x", "a/../../x", "a/..", "/etc/passwd", "./x"] {
            assert!(resolve(root, bad).is_err(), "{bad} should be rejected");
        }
    }

    #[test]
    fn store_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(store_read(root, "settings.json").unwrap(), None);
        assert!(store_list(root, "profiles").unwrap().is_empty());
        store_write(root, "profiles/b.json", "{\"b\":1}").unwrap();
        store_write(root, "profiles/a.json", "{}").unwrap();
        store_write(root, "profiles/a.json", "{\"a\":2}").unwrap();
        assert_eq!(
            store_read(root, "profiles/a.json").unwrap().as_deref(),
            Some("{\"a\":2}")
        );
        assert_eq!(store_list(root, "profiles").unwrap(), ["a.json", "b.json"]);
        store_delete(root, "profiles/a.json").unwrap();
        store_delete(root, "profiles/a.json").unwrap(); // deleting twice is fine
        assert_eq!(store_list(root, "profiles").unwrap(), ["b.json"]);
        assert!(store_write(root, "../outside.json", "x").is_err());
    }

    #[test]
    fn safe_name_strips_directories() {
        assert_eq!(safe_name("../../etc/cover.png").unwrap(), "cover.png");
        assert_eq!(
            safe_name("01-街拍日记_标题_1920x1080.png").unwrap(),
            "01-街拍日记_标题_1920x1080.png"
        );
        assert!(safe_name("..").is_err());
        assert_eq!(extension("a/b/Cover.JPG"), "jpg");
    }

    #[test]
    fn encode_png_is_passed_through() {
        let bytes = png(&RgbaImage::from_pixel(4, 3, Rgba([1, 2, 3, 255])));
        assert_eq!(encode(&bytes, "png", 90).unwrap(), bytes);
        assert!(encode(b"not a png", "jpeg", 90).is_err());
        assert!(encode(&bytes, "gif", 90).is_err());
    }

    #[test]
    fn parse_frame_splits_metadata_from_pixels() {
        let meta = r#"{"name":"01-街拍_a b.png","format":"jpeg","quality":90,"dir":"/tmp/out"}"#
            .as_bytes();
        let mut body = (meta.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(meta);
        body.extend_from_slice(b"PIXELS");
        let (m, rest) = parse_frame(&body).unwrap();
        assert_eq!(
            (
                m.name.as_str(),
                m.format.as_str(),
                m.quality,
                m.dir.as_str()
            ),
            ("01-街拍_a b.png", "jpeg", 90, "/tmp/out")
        );
        assert_eq!(rest, b"PIXELS");
        assert!(parse_frame(b"\x01").is_err()); // no length
        assert!(parse_frame(&[200, 0, 0, 0, b'{']).is_err()); // metadata cut short
        assert!(parse_frame(&[2, 0, 0, 0, b'n', b'o']).is_err()); // not JSON
    }

    #[test]
    fn encode_jpeg_flattens_transparency_onto_the_matte() {
        let mut img = RgbaImage::from_pixel(16, 16, Rgba([255, 255, 255, 255]));
        for x in 0..8 {
            for y in 0..16 {
                img.put_pixel(x, y, Rgba([255, 0, 0, 0])); // fully transparent half
            }
        }
        let jpg = encode(&png(&img), "jpeg", 95).unwrap();
        let back = image::load_from_memory_with_format(&jpg, ImageFormat::Jpeg)
            .unwrap()
            .to_rgb8();
        assert_eq!((back.width(), back.height()), (16, 16));
        let dark = back.get_pixel(2, 8);
        let light = back.get_pixel(13, 8);
        assert!(
            dark.0.iter().zip(MATTE).all(|(a, b)| a.abs_diff(b) < 12),
            "{dark:?}"
        );
        assert!(light.0.iter().all(|&c| c > 240), "{light:?}");
    }

    #[test]
    fn encode_webp_is_lossless() {
        let mut img = RgbaImage::from_pixel(5, 4, Rgba([10, 200, 30, 255]));
        img.put_pixel(1, 1, Rgba([250, 1, 99, 128]));
        let webp = encode(&png(&img), "webp", 80).unwrap();
        let back = image::load_from_memory_with_format(&webp, ImageFormat::WebP)
            .unwrap()
            .to_rgba8();
        assert_eq!(back, img);
    }

    /// A one-shot HTTP server on a free local port that answers with `status` and `body`, and
    /// hands back the request it received.
    fn serve_once(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let (mut head, mut length) = (String::new(), 0usize);
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
                head.push_str(&line);
            }
            let mut sent = vec![0u8; length];
            reader.read_exact(&mut sent).unwrap();
            let reply = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            reader.get_mut().write_all(reply.as_bytes()).unwrap();
            format!("{head}\n{}", String::from_utf8(sent).unwrap())
        });
        (url, handle)
    }

    #[test]
    fn post_json_sends_headers_and_body_and_returns_the_reply() {
        let (url, server) = serve_once("200 OK", r#"{"choices":[{"message":{"content":"hi"}}]}"#);
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("authorization".to_string(), "Bearer sk-test".to_string()),
        ];
        let reply = post_json(&url, &headers, r#"{"model":"m"}"#, "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.text, r#"{"choices":[{"message":{"content":"hi"}}]}"#);
        let seen = server.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("post /v1/chat/completions"));
        assert!(seen.contains("authorization: bearer sk-test"));
        assert!(seen.ends_with(r#"{"model":"m"}"#));
    }

    #[test]
    fn get_image_fetches_a_picture_and_refuses_anything_else() {
        use std::io::{BufRead, BufReader, Write};
        let pic = png(&RgbaImage::from_pixel(2, 2, Rgba([255, 0, 0, 255])));
        for (kind, body, ok) in [("application/octet-stream", pic.clone(), true), ("text/html", b"<html></html>".to_vec(), false)] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/out.png", listener.local_addr().unwrap());
            let server = std::thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: {kind}\r\ncontent-length: {}\r\n\r\n", body.len()).unwrap();
                stream.write_all(&body).unwrap();
            });
            let got = get_image(&url, "", 20);
            server.join().unwrap();
            assert_eq!(got.is_ok(), ok, "{kind}");
            if let Ok(img) = got {
                assert_eq!(img.mime, "image/png");   // told by the bytes when the header does not say
                assert!(img.data.starts_with("iVBORw0KGgo"));
            }
        }
    }

    #[test]
    fn send_can_ask_with_get() {
        let (url, server) = serve_once("200 OK", r#"{"id":"gpt-image-2"}"#);
        let reply = send(&url, "GET", &[("authorization".into(), "Bearer k".into())], "ignored", "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.text, r#"{"id":"gpt-image-2"}"#);
        let seen = server.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("get /v1/chat/completions"), "{seen}");
        assert!(!seen.contains("ignored"));
    }

    #[test]
    fn post_json_passes_error_replies_through() {
        let (url, server) = serve_once("401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);
        let reply = post_json(&url, &[], "{}", "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.status, 401);
        assert_eq!(reply.text, r#"{"error":{"message":"bad key"}}"#);
        server.join().unwrap();
    }

    /// Needs the network, so it only runs on request: `cargo test -- --ignored`.
    /// Without a key both providers must answer 401 with a JSON error, which shows that TLS,
    /// any proxy from the environment and the pass-through of error replies all work.
    #[test]
    #[ignore]
    fn live_endpoints_answer_unauthenticated_requests_with_401() {
        for url in [
            "https://api.openai.com/v1/chat/completions",
            "https://api.anthropic.com/v1/messages",
        ] {
            let headers = vec![("content-type".to_string(), "application/json".to_string())];
            let reply = post_json(url, &headers, "{}", "", 20, AI_MAX_REPLY).unwrap();
            assert_eq!(reply.status, 401, "{url}: {}", reply.text);
            assert!(reply.text.contains("error"), "{url}: {}", reply.text);
        }
    }

    #[test]
    fn post_json_gives_up_after_the_timeout() {
        // a server that accepts the connection and never answers
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/slow", listener.local_addr().unwrap());
        let started = std::time::Instant::now();
        let error = post_json(&url, &[], "{}", "", 5, AI_MAX_REPLY).unwrap_err();
        assert!(error.to_lowercase().contains("timed out"), "{error}");
        assert!(started.elapsed().as_secs() >= 4 && started.elapsed().as_secs() < 15);
        drop(listener);
    }

    #[test]
    fn a_wait_that_ran_out_says_timed_out_on_windows_too() {
        use std::io::{Error, ErrorKind};
        // what ureq hands back there: the kind is right, the words are the system's
        let windows: ureq::Error = Error::new(ErrorKind::TimedOut, "A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond. (os error 10060)").into();
        assert!(net_err(windows).starts_with("timed out: "));
        let unix: ureq::Error = Error::new(ErrorKind::TimedOut, "timed out reading response").into();
        assert!(!net_err(unix).contains("timed out: "));   // said once only
        let refused: ureq::Error = Error::new(ErrorKind::ConnectionRefused, "connection refused").into();
        assert!(!net_err(refused).contains("timed out"));
    }

    #[test]
    fn local_hosts_never_go_through_the_environment_proxy() {
        for url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1/x",
            "https://LOCALHOST",
            "http://[::1]:8080/v1",
            "http://user@127.0.0.1:1/x",
        ] {
            assert!(is_local(url), "{url}");
            assert_eq!(proxy_for(url, ""), None, "{url}");
        }
        for url in [
            "https://api.openai.com/v1",
            "https://localhost.example.com",
            "http://10.0.0.2:8000",
        ] {
            assert!(!is_local(url), "{url}");
        }
        // a proxy given explicitly always wins, and a bad one is an error rather than ignored
        assert_eq!(
            proxy_for("http://localhost/x", " http://127.0.0.1:7890 "),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert!(
            post_json("https://example.com", &[], "{}", "nonsense://x", 20, AI_MAX_REPLY)
                .unwrap_err()
                .starts_with("proxy")
        );
    }

    #[test]
    fn post_json_refuses_other_schemes_and_reports_unreachable_hosts() {
        assert!(post_json("file:///etc/passwd", &[], "{}", "", 20, AI_MAX_REPLY).is_err());
        assert!(post_json("ftp://example.com", &[], "{}", "", 20, AI_MAX_REPLY).is_err());
        // a port nothing listens on
        let free = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert!(post_json(&format!("http://{free}/x"), &[], "{}", "", 20, AI_MAX_REPLY).is_err());
    }

    fn bundled(name: &str) -> Arc<(Vec<u8>, u32)> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../ui/fonts")
            .join(name);
        Arc::new((fs::read(path).unwrap(), 0))
    }

    #[test]
    fn single_face_cuts_a_face_out_of_a_collection() {
        let fonts = [bundled("BebasNeue-Regular.ttf"), bundled("JetBrainsMono.ttf")];
        // a collection of the two: its header, both table directories, then every table, the directories pointing into it
        let u32_at = |d: &[u8], at: usize| u32::from_be_bytes([d[at], d[at + 1], d[at + 2], d[at + 3]]) as usize;
        let tables = |d: &[u8]| (u16::from_be_bytes([d[4], d[5]]) as usize, 12 + 16 * u16::from_be_bytes([d[4], d[5]]) as usize);
        let mut ttc = b"ttcf\x00\x01\x00\x00\x00\x00\x00\x02".to_vec();
        let dirs: Vec<usize> = fonts.iter().map(|f| tables(&f.0).1).collect();
        let (mut at, mut data_at) = (20, 20 + dirs.iter().sum::<usize>());
        for d in &dirs {
            ttc.extend_from_slice(&(at as u32).to_be_bytes());
            at += d;
        }
        let mut bodies = Vec::new();
        for f in &fonts {
            let (n, _) = tables(&f.0);
            ttc.extend_from_slice(&f.0[0..12]);
            for i in 0..n {
                let rec = 12 + 16 * i;
                let (start, len) = (u32_at(&f.0, rec + 8), u32_at(&f.0, rec + 12));
                ttc.extend_from_slice(&f.0[rec..rec + 8]);
                ttc.extend_from_slice(&(data_at as u32).to_be_bytes());
                ttc.extend_from_slice(&(len as u32).to_be_bytes());
                bodies.extend_from_slice(&f.0[start..start + len]);
                bodies.resize((bodies.len() + 3) & !3, 0);
                data_at = 20 + dirs.iter().sum::<usize>() + bodies.len();
            }
        }
        ttc.extend_from_slice(&bodies);
        for (i, f) in fonts.iter().enumerate() {
            let face = single_face(&ttc, i as u32).unwrap();
            assert_eq!(&face[0..4], &f.0[0..4]);
            let (a, b) = (ttf_parser::Face::parse(&face, 0).unwrap(), ttf_parser::Face::parse(&f.0, 0).unwrap());
            assert_eq!(a.number_of_glyphs(), b.number_of_glyphs());
            assert_eq!(a.glyph_index('A'), b.glyph_index('A'));
            assert_eq!(a.glyph_hor_advance(a.glyph_index('A').unwrap()), b.glyph_hor_advance(b.glyph_index('A').unwrap()));
        }
        assert!(single_face(&ttc, 2).is_none());
        assert!(single_face(&ttc[..30], 1).is_none()); // cut short
        assert_eq!(single_face(&fonts[0].0, 0).unwrap(), fonts[0].0); // one font: as it is
    }

    #[test]
    fn probe_text_is_what_the_font_has() {
        let face = |name: &str| bundled(name);
        let (mono, cjk) = (face("JetBrainsMono.ttf"), face("NotoSansSC.ttf"));
        assert_eq!(probe_text(&ttf_parser::Face::parse(&mono.0, 0).unwrap()), "Aa01"); // no Chinese in it
        assert_eq!(probe_text(&ttf_parser::Face::parse(&cjk.0, 0).unwrap()), "封面Aa01");
    }

    #[test]
    fn trace_gives_closed_outlines_in_ems() {
        let out = trace("Ab 1", &[bundled("BebasNeue-Regular.ttf")], 400.0);
        assert!(!out.missing);
        assert_eq!(out.glyphs.len(), 4);
        assert!(out.glyphs[2].c.is_empty() && out.glyphs[2].adv > 0.05); // the space: no outline, some advance
        for g in [&out.glyphs[0], &out.glyphs[1], &out.glyphs[3]] {
            assert!(g.adv > 0.2 && g.adv < 1.2, "advance {}", g.adv);
            assert!(!g.c.is_empty());
            for contour in &g.c {
                assert!(contour.len() >= 6 && contour.len() % 2 == 0);
                for (i, v) in contour.iter().enumerate() {
                    // within the em box, and above the baseline (y points down, so negative) for capitals
                    assert!(v.is_finite() && *v > -1.5 && *v < 1.5, "coordinate {v}");
                    if i % 2 == 1 {
                        assert!(*v <= 0.05, "a capital dips below the baseline: {v}");
                    }
                }
            }
        }
        assert_eq!(out.glyphs[0].c.len(), 2); // "A": the outside and the counter
    }

    #[test]
    fn trace_falls_back_between_fonts_and_follows_the_weight() {
        let fonts = [bundled("BebasNeue-Regular.ttf"), bundled("NotoSansSC.ttf")];
        let out = trace("A夜", &fonts, 900.0);
        assert!(!out.missing);
        assert!(!out.glyphs[1].c.is_empty()); // the CJK glyph came from the second font
        assert!((out.glyphs[1].adv - 1.0).abs() < 0.05); // full width
                                                         // a variable font is heavier at 900 than at 100: its strokes reach further
        let reach = |weight: f32| {
            let g = &trace("夜", &fonts[1..], weight).glyphs[0];
            let xs: Vec<f32> =
                g.c.iter()
                    .flat_map(|c| c.iter().step_by(2).copied())
                    .collect();
            let area: f32 =
                g.c.iter()
                    .map(|c| {
                        let n = c.len() / 2;
                        (0..n)
                            .map(|i| {
                                let j = (i + 1) % n;
                                c[2 * i] * c[2 * j + 1] - c[2 * j] * c[2 * i + 1]
                            })
                            .sum::<f32>()
                            / 2.0
                    })
                    .sum();
            (xs.len(), area.abs())
        };
        assert!(
            reach(900.0).1 > reach(100.0).1 * 1.5,
            "{:?} vs {:?}",
            reach(900.0),
            reach(100.0)
        );
        // a character no font has
        let none = trace("A\u{10FFFF}", &fonts[..1], 400.0);
        assert!(none.missing && none.glyphs.len() == 2);
    }
}
