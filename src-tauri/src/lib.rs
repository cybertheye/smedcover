//! SmedCover — native shell for the cover generator.
//!
//! All drawing happens in the web view (`ui/`). This side owns the file system:
//!
//! * a small sandboxed store under the app data directory (profiles, settings, session, fonts);
//! * exporting covers: the web view sends PNG bytes in a raw, framed request body (no base64),
//!   which are converted to PNG, JPEG or WebP and written here, off the main thread;
//! * listing the fonts installed on the system.

use std::fs;
use std::io::{Cursor, ErrorKind};
use std::path::{Component, Path, PathBuf};

use image::{codecs::jpeg::JpegEncoder, ImageFormat, RgbImage};
use serde::Deserialize;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

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
    store_write(&data_root(&app)?, &path, &data)
}

#[tauri::command]
fn app_list(app: AppHandle, dir: String) -> Res<Vec<String>> {
    store_list(&data_root(&app)?, &dir)
}

#[tauri::command]
fn app_delete(app: AppHandle, path: String) -> Res<()> {
    store_delete(&data_root(&app)?, &path)
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

/// Family names of the fonts installed on this machine, sorted, without duplicates.
#[tauri::command]
async fn list_system_fonts() -> Vec<String> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut names: Vec<String> = db
        .faces()
        .filter_map(|face| face.families.first().map(|(name, _)| name.clone()))
        .filter(|name| !name.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.dedup();
    names
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
            save_image,
            pick_folder,
            write_image,
            save_text,
            list_system_fonts,
            selftest_dir,
            selftest_done
        ])
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
}
