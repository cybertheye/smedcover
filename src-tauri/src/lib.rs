//! SmedCover — native shell for the cover generator.
//!
//! All drawing happens in the web view (`ui/`). This side owns the file system:
//!
//! * a small sandboxed store under the app data directory (profiles, settings, session, fonts);
//! * exporting covers: the web view sends PNG bytes in a raw, framed request body (no base64),
//!   which are converted to PNG, JPEG or WebP and written here, off the main thread;
//! * listing the fonts installed on the system;
//! * sending the request for an AI-generated asset, so it is not subject to the web view's
//!   cross-origin rules.

use std::fs;
use std::io::{Cursor, ErrorKind, Read};
use std::path::{Component, Path, PathBuf};

use image::{codecs::jpeg::JpegEncoder, ImageFormat, RgbImage};
use serde::{Deserialize, Serialize};
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

// ---------------------------------------------------------------- AI request

/// How long an AI request may take unless the caller says otherwise, and the most of a reply
/// that is read. Models that reason before answering can need several minutes.
const AI_TIMEOUT_SECS: u64 = 300;
const AI_MAX_REPLY: u64 = 4 * 1024 * 1024;

/// What came back from an AI endpoint: the status and body are handed to the web view as they
/// are, error replies included, so it can show the provider's own message.
#[derive(Serialize, Debug)]
struct AiReply {
    status: u16,
    text: String,
}

fn read_capped(response: ureq::Response) -> Res<String> {
    let mut text = String::new();
    response
        .into_reader()
        .take(AI_MAX_REPLY)
        .read_to_string(&mut text)
        .map_err(err)?;
    Ok(text)
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
fn post_json(
    url: &str,
    headers: &[(String, String)],
    body: &str,
    proxy: &str,
    timeout_secs: u64,
) -> Res<AiReply> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("invalid URL: {url}"));
    }
    let timeout = std::time::Duration::from_secs(timeout_secs.clamp(5, 1800));
    let mut builder = ureq::AgentBuilder::new().timeout(timeout);
    if let Some(p) = proxy_for(url, proxy) {
        builder = builder.proxy(ureq::Proxy::new(&p).map_err(|e| format!("proxy {p}: {e}"))?);
    }
    let agent = builder.build();
    let mut request = agent.post(url);
    for (name, value) in headers {
        request = request.set(name, value);
    }
    match request.send_string(body) {
        Ok(response) => Ok(AiReply {
            status: response.status(),
            text: read_capped(response)?,
        }),
        Err(ureq::Error::Status(status, response)) => Ok(AiReply {
            status,
            text: read_capped(response).unwrap_or_default(),
        }),
        Err(e) => Err(err(e)),
    }
}

/// Sends one request for an AI-generated asset. The web view builds the request (see `ui/js/ai.js`);
/// sending it from here avoids the cross-origin limits a web view has.
#[tauri::command]
async fn ai_request(
    url: String,
    headers: Vec<(String, String)>,
    body: String,
    proxy: Option<String>,
    timeout: Option<u64>,
) -> Res<AiReply> {
    // a reply can take minutes: wait for it on the blocking pool, not on a runtime worker
    tauri::async_runtime::spawn_blocking(move || {
        post_json(
            &url,
            &headers,
            &body,
            proxy.as_deref().unwrap_or(""),
            timeout.unwrap_or(AI_TIMEOUT_SECS),
        )
    })
    .await
    .map_err(err)?
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
            save_image,
            pick_folder,
            write_image,
            save_text,
            list_system_fonts,
            ai_request,
            selftest_dir,
            selftest_ai,
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
        let reply = post_json(&url, &headers, r#"{"model":"m"}"#, "", 20).unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.text, r#"{"choices":[{"message":{"content":"hi"}}]}"#);
        let seen = server.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("post /v1/chat/completions"));
        assert!(seen.contains("authorization: bearer sk-test"));
        assert!(seen.ends_with(r#"{"model":"m"}"#));
    }

    #[test]
    fn post_json_passes_error_replies_through() {
        let (url, server) = serve_once("401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);
        let reply = post_json(&url, &[], "{}", "", 20).unwrap();
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
            let reply = post_json(url, &headers, "{}", "", 20).unwrap();
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
        let error = post_json(&url, &[], "{}", "", 5).unwrap_err();
        assert!(error.to_lowercase().contains("timed out"), "{error}");
        assert!(started.elapsed().as_secs() >= 4 && started.elapsed().as_secs() < 15);
        drop(listener);
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
            post_json("https://example.com", &[], "{}", "nonsense://x", 20)
                .unwrap_err()
                .starts_with("proxy")
        );
    }

    #[test]
    fn post_json_refuses_other_schemes_and_reports_unreachable_hosts() {
        assert!(post_json("file:///etc/passwd", &[], "{}", "", 20).is_err());
        assert!(post_json("ftp://example.com", &[], "{}", "", 20).is_err());
        // a port nothing listens on
        let free = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert!(post_json(&format!("http://{free}/x"), &[], "{}", "", 20).is_err());
    }
}
