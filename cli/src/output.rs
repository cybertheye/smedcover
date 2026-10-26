//! What the command line prints: results on the standard output, short and plain (or the tool's result as JSON with
//! `--json`), progress and notes on the standard error (none with `--quiet`), errors on the standard error always.

use std::cell::RefCell;
use std::fs;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

use crate::lang::Lang;
use crate::mcp::Progress;
use crate::Fail;

/// Where the command's words go.
pub struct Out {
    pub json: bool,
    pub quiet: bool,
    pub lang: Lang,
    /// Whether the standard error is a terminal, where progress is one line drawn over.
    tty: bool,
    /// The progress line last shown.
    last: RefCell<Option<String>>,
}

impl Out {
    pub fn new(json: bool, quiet: bool, lang: Lang) -> Out {
        Out { json, quiet, lang, tty: io::stderr().is_terminal(), last: RefCell::new(None) }
    }

    /// A result, as text: a line, or lines.
    pub fn text(&self, text: &str) {
        let text = text.trim_end_matches('\n');
        if !text.is_empty() {
            emit(&mut io::stdout().lock(), &format!("{text}\n"));
        }
    }

    /// A result, as JSON.
    pub fn json_value(&self, value: &Value) {
        let text = serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string());
        emit(&mut io::stdout().lock(), &format!("{text}\n"));
    }

    /// A note on the standard error (none with `--quiet`).
    pub fn note(&self, text: &str) {
        if !self.quiet {
            self.end_progress();
            emit(&mut io::stderr().lock(), &format!("{text}\n"));
        }
    }

    /// How a call gets on, on the standard error (none with `--quiet`): on a terminal one line drawn over, else a line
    /// each time it says something new.
    pub fn progress(&self, p: &Progress) {
        if self.quiet {
            return;
        }
        let Some(line) = progress_line(p) else {
            return;
        };
        let mut last = self.last.borrow_mut();
        if last.as_deref() == Some(line.as_str()) {
            return;
        }
        let mut err = io::stderr().lock();
        if self.tty {
            emit(&mut err, &format!("\r\x1b[2K{}", fit(&line, 100)));
        } else {
            emit(&mut err, &format!("{line}\n"));
        }
        *last = Some(line);
    }

    /// Ends the progress line, if one is drawn over.
    pub fn end_progress(&self) {
        if self.last.borrow_mut().take().is_some() && self.tty {
            emit(&mut io::stderr().lock(), "\r\x1b[2K");
        }
    }

    /// Why the command failed: on the standard error, and with `--json` as JSON on the standard output too, so that a
    /// script reading it has something to read.
    pub fn fail(&self, fail: &Fail) {
        self.end_progress();
        emit(&mut io::stderr().lock(), &format!("smedcover: {}\n", fail.message()));
        if self.json {
            self.json_value(&json!({"error": {"kind": fail.kind(), "message": fail.message(), "exit": fail.code()}}));
        }
    }
}

/// Writes all of `text`, a closed pipe (`| head`) not a failure.
fn emit(to: &mut impl Write, text: &str) {
    let _ = to.write_all(text.as_bytes()).and_then(|_| to.flush());
}

/// A word of progress as a line: what the app says, else how far of how many.
pub fn progress_line(p: &Progress) -> Option<String> {
    if let Some(message) = p.message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        return Some(message.to_string());
    }
    let n = number(p.progress);
    match p.total {
        Some(total) if total > 0.0 => Some(format!("{n} / {}", number(total))),
        _ => None,
    }
}

fn number(x: f64) -> String {
    if x.fract() == 0.0 && x.abs() < 1e15 {
        format!("{}", x as i64)
    } else {
        format!("{x:.1}")
    }
}

/// `text` cut to `most` characters, with … where it was cut.
pub fn fit(text: &str, most: usize) -> String {
    if text.chars().count() <= most {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(most.saturating_sub(1)).collect();
    cut.push('…');
    cut
}

/// A description's first sentence, cut to `most` characters.
pub fn first_sentence(text: &str, most: usize) -> String {
    let text = text.trim();
    let end = [". ", "。"].iter().filter_map(|stop| text.find(stop).map(|i| i + stop.len())).min().unwrap_or(text.len());
    fit(text[..end].trim(), most)
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// `get_context`'s profiles, channels and sizes, the one shown marked.
pub fn profiles(context: &Value, lang: Lang) -> String {
    let current = &context["current"];
    let (shown_profile, shown_channel, shown_size) = (s(current, "profile"), s(current, "channel"), s(current, "size"));
    let mut out = String::new();
    let shown_mark = lang.pick("  ← shown", "  ← 当前");
    for p in context["profiles"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
        let id = s(p, "id");
        let name = Some(s(p, "name")).filter(|n| !n.is_empty()).unwrap_or(id);
        let is_shown = id == shown_profile;
        out.push_str(&format!("{name}  (id {id}){}\n", if is_shown { shown_mark } else { "" }));
        let mut about = Vec::new();
        if !s(p, "brand").is_empty() && s(p, "brand") != name {
            about.push(format!("{}{}", lang.pick("brand: ", "品牌："), s(p, "brand")));
        }
        if !s(p, "look").is_empty() {
            let theme = match s(p, "theme") {
                "dark" => lang.pick(", dark", "，深色"),
                "light" => lang.pick(", light", "，浅色"),
                _ => "",
            };
            about.push(format!("{}{}{theme}", lang.pick("look: ", "风格："), s(p, "look")));
        }
        about.push(match s(p, "exportDir") {
            "" => lang.pick("export folder: none yet", "导出文件夹：还没选").to_string(),
            dir => format!("{}{dir}", lang.pick("export folder: ", "导出文件夹：")),
        });
        out.push_str(&format!("  {}\n", about.join(lang.pick(" · ", " · "))));
        let channels = p["channels"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        out.push_str(&format!("  {}\n", lang.pick("channels:", "频道：")));
        for (n, c) in channels.iter().enumerate() {
            let cid = s(c, "id");
            let cname = Some(s(c, "name")).filter(|x| !x.is_empty()).unwrap_or(lang.pick("(no name)", "（没有名字）"));
            let mut details = vec![format!("id {cid}")];
            if !s(c, "code").is_empty() {
                details.push(format!("{}{}", lang.pick("code ", "代号 "), s(c, "code")));
            }
            if !s(c, "color").is_empty() {
                details.push(s(c, "color").to_string());
            }
            let mark = if is_shown && cid == shown_channel { shown_mark } else { "" };
            out.push_str(&format!("    {}. {cname}  {}{mark}\n", n + 1, paren(&details.join(lang.pick(", ", "，")), lang)));
        }
        let sizes = p["sizes"].as_array().map(Vec::as_slice).unwrap_or(&[]);
        out.push_str(&format!("  {}\n", lang.pick("sizes (✓ ticked in Export):", "尺寸（✓ 导出窗口里打开的）：")));
        let width = sizes.iter().map(|z| s(z, "key").chars().count()).max().unwrap_or(0);
        for z in sizes {
            let key = s(z, "key");
            let label = [s(z, "name"), s(z, "caption")].into_iter().find(|x| !x.is_empty()).unwrap_or("");
            let tick = if z["ticked"] == true { "  ✓" } else { "" };
            let mark = if is_shown && key == shown_size { shown_mark } else { "" };
            out.push_str(format!("    {key:<width$}  {label}{tick}{mark}").trim_end());
            out.push('\n');
        }
        out.push('\n');
    }
    out.trim_end().to_string()
}

fn paren(text: &str, lang: Lang) -> String {
    lang.pick(format!("({text})"), format!("（{text}）"))
}

/// The files an `export` or `batch_covers` wrote, one path a line.
pub fn files(result: &Value) -> Vec<String> {
    result["files"].as_array().map(Vec::as_slice).unwrap_or(&[]).iter().filter_map(|f| f["path"].as_str().map(str::to_string)).collect()
}

/// How many files were written, and where.
pub fn written(n: usize, dir: &str, lang: Lang) -> String {
    match (lang, n) {
        (Lang::En, 1) => format!("1 file written to {dir}"),
        (Lang::En, n) => format!("{n} files written to {dir}"),
        (Lang::Zh, n) => format!("已写入 {n} 个文件：{dir}"),
    }
}

/// What `open_project` did.
pub fn opened(result: &Value, lang: Lang) -> String {
    let profile = &result["profile"];
    let name = Some(s(profile, "name")).filter(|n| !n.is_empty()).unwrap_or(s(profile, "id"));
    let created = profile["created"] == true;
    let channel = s(result, "channel");
    let mut out = match lang {
        Lang::En => format!("Opened in the profile \"{name}\" ({}), channel {channel}", if created { "new" } else { "already here" }),
        Lang::Zh => format!("已打开到档案「{name}」（{}），频道 {channel}", if created { "新建的" } else { "原有的" }),
    };
    for warning in result["warnings"].as_array().map(Vec::as_slice).unwrap_or(&[]).iter().filter_map(Value::as_str) {
        out.push_str(&format!("\n{}{warning}", lang.pick("note: ", "注意：")));
    }
    out
}

/// The tools, one a line: its name and its description's first sentence.
pub fn tools(list: &[Value]) -> String {
    let width = list.iter().map(|t| s(t, "name").len()).max().unwrap_or(0);
    list.iter()
        .map(|t| format!("{:<width$}  {}", s(t, "name"), first_sentence(s(t, "description"), 96)).trim_end().to_string())
        .collect::<Vec<_>>()
        .join("\n")
}

/// A size in bytes as it reads.
pub fn bytes(n: usize) -> String {
    match n {
        n if n < 1024 => format!("{n} B"),
        n if n < 1024 * 1024 => format!("{:.1} KB", n as f64 / 1024.0),
        n => format!("{:.1} MB", n as f64 / (1024.0 * 1024.0)),
    }
}

/// A tool's result as `call` prints it: each text block (JSON laid out), each image saved into `save` (else said); and
/// the result with each saved image's data swapped for where it went, for `--json`.
pub fn call_result(result: &Value, tool: &str, save: Option<&Path>, lang: Lang) -> io::Result<(String, Value)> {
    let mut lines = Vec::new();
    let mut shown = result.clone();
    let mut images = 0;
    if let Some(blocks) = shown.get_mut("content").and_then(Value::as_array_mut) {
        for block in blocks {
            match block["type"].as_str() {
                Some("text") => lines.push(laid_out(s(block, "text"))),
                Some("image") => {
                    images += 1;
                    let mime = s(block, "mimeType").to_string();
                    let data = STANDARD.decode(s(block, "data").trim()).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
                    match save {
                        Some(dir) => {
                            let path = save_image(dir, tool, images, &mime, &data)?;
                            lines.push(lang.pick(
                                format!("image {images} saved: {} ({mime}, {})", path.display(), bytes(data.len())),
                                format!("图片 {images} 已保存：{}（{mime}，{}）", path.display(), bytes(data.len())),
                            ));
                            if let Value::Object(b) = block {
                                b.remove("data");
                                b.insert("saved".into(), json!(path.to_string_lossy()));
                            }
                        }
                        None => lines.push(lang.pick(
                            format!("[image {images}: {mime}, {}; --save-images DIR saves it]", bytes(data.len())),
                            format!("［图片 {images}：{mime}，{}；用 --save-images 目录 保存］", bytes(data.len())),
                        )),
                    }
                }
                Some(other) => lines.push(format!("[{other}]")),
                None => {}
            }
        }
    }
    Ok((lines.join("\n"), shown))
}

/// Text as `call` prints it: JSON laid out over lines, anything else as it is.
fn laid_out(text: &str) -> String {
    match serde_json::from_str::<Value>(text) {
        Ok(v @ (Value::Object(_) | Value::Array(_))) => serde_json::to_string_pretty(&v).unwrap_or_else(|_| text.to_string()),
        _ => text.to_string(),
    }
}

/// Saves an image into `dir` (made if it is not there) as `<tool>-<n>.<ext>`, never over a file.
fn save_image(dir: &Path, tool: &str, n: usize, mime: &str, data: &[u8]) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let ext = match mime {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        _ => "png",
    };
    let stem: String = tool.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    for k in 1..=10_000 {
        let name = if k == 1 { format!("{stem}-{n}.{ext}") } else { format!("{stem}-{n}-{k}.{ext}") };
        let path = dir.join(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(data)?;
                return Ok(path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::AlreadyExists, "no free name"))
}

/// The text of a result's text blocks, for an error.
pub fn text_of(result: &Value) -> String {
    result["content"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter(|b| b["type"] == "text")
        .map(|b| s(b, "text").trim().to_string())
        .filter(|t| !t.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> Value {
        json!({
            "profiles": [
                {"id": "p1", "name": "Mine", "brand": "Mine", "look": "night", "theme": "dark", "exportDir": "/covers",
                 "channels": [{"id": "c1", "name": "VLOG", "code": "V", "color": "#ff3366"}, {"id": "c2", "name": ""}],
                 "sizes": [{"key": "1920x1080", "caption": "YouTube 16:9", "ticked": true}, {"key": "1080x1920", "name": "Shorts"}]},
                {"id": "p2", "name": "Other", "channels": [], "sizes": []},
            ],
            "current": {"profile": "p1", "channel": "c1", "size": "1920x1080", "layer": "bg"},
        })
    }

    #[test]
    fn profiles_in_english() {
        let text = profiles(&context(), Lang::En);
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], "Mine  (id p1)  ← shown");
        assert_eq!(lines[1], "  look: night, dark · export folder: /covers");
        assert_eq!(lines[3], "    1. VLOG  (id c1, code V, #ff3366)  ← shown");
        assert_eq!(lines[4], "    2. (no name)  (id c2)");
        assert_eq!(lines[6], "    1920x1080  YouTube 16:9  ✓  ← shown");
        assert_eq!(lines[7], "    1080x1920  Shorts");
        assert!(text.contains("Other  (id p2)\n  export folder: none yet"));
        assert!(!text.ends_with('\n'));
    }

    #[test]
    fn profiles_in_chinese() {
        let text = profiles(&context(), Lang::Zh);
        assert!(text.contains("Mine  (id p1)  ← 当前"));
        assert!(text.contains("风格：night，深色 · 导出文件夹：/covers"));
        assert!(text.contains("1. VLOG  （id c1，代号 V，#ff3366）  ← 当前"));
        assert!(text.contains("尺寸（✓ 导出窗口里打开的）："));
    }

    #[test]
    fn progress_lines() {
        let p = |progress, total, message: Option<&str>| Progress { progress, total, message: message.map(str::to_string) };
        assert_eq!(progress_line(&p(3.0, Some(12.0), Some("Writing a.png (3 of 12)."))), Some("Writing a.png (3 of 12).".into()));
        assert_eq!(progress_line(&p(3.0, Some(12.0), None)), Some("3 / 12".into()));
        assert_eq!(progress_line(&p(0.5, Some(2.0), Some("  "))), Some("0.5 / 2".into()));
        assert_eq!(progress_line(&p(0.0, None, None)), None);
    }

    #[test]
    fn sentences_and_sizes() {
        assert_eq!(first_sentence("What SmedCover has and shows now. Call it first.", 96), "What SmedCover has and shows now.");
        assert_eq!(first_sentence("No stop at all", 96), "No stop at all");
        assert_eq!(first_sentence("一句话。第二句。", 96), "一句话。");
        assert_eq!(first_sentence(&"x".repeat(200), 10), format!("{}…", "x".repeat(9)));
        // a version number's dot is not a sentence's end
        assert_eq!(first_sentence("Needs 2.0 or later. Then more.", 96), "Needs 2.0 or later.");
        assert_eq!(bytes(812), "812 B");
        assert_eq!(bytes(2048), "2.0 KB");
        assert_eq!(bytes(3 * 1024 * 1024), "3.0 MB");
    }

    #[test]
    fn written_files_and_what_was_opened() {
        let result = json!({"dir": "/out", "files": [{"path": "/out/a.png", "channel": "c1"}, {"path": "/out/b.png"}, {"nopath": 1}]});
        assert_eq!(files(&result), ["/out/a.png", "/out/b.png"]);
        assert_eq!(written(1, "/out", Lang::En), "1 file written to /out");
        assert_eq!(written(2, "/out", Lang::En), "2 files written to /out");
        assert_eq!(written(2, "/out", Lang::Zh), "已写入 2 个文件：/out");
        let r = json!({"profile": {"id": "p9", "name": "Brand", "created": true}, "channel": "c1", "warnings": ["A font is missing."]});
        assert_eq!(opened(&r, Lang::En), "Opened in the profile \"Brand\" (new), channel c1\nnote: A font is missing.");
        assert_eq!(opened(&json!({"profile": {"id": "p9"}, "channel": "c2"}), Lang::Zh), "已打开到档案「p9」（原有的），频道 c2");
    }

    #[test]
    fn tools_one_a_line() {
        let list = [json!({"name": "get_context", "description": "What SmedCover has. More."}), json!({"name": "undo", "description": "Undoes."})];
        assert_eq!(tools(&list), "get_context  What SmedCover has.\nundo         Undoes.");
    }

    const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn call_prints_text_and_saves_or_describes_images() {
        let result = json!({"content": [{"type": "text", "text": "{\"ok\":true}"}, {"type": "image", "data": PNG, "mimeType": "image/png"}, {"type": "text", "text": "plain"}]});
        let (text, shown) = call_result(&result, "render_preview", None, Lang::En).unwrap();
        assert_eq!(text, "{\n  \"ok\": true\n}\n[image 1: image/png, 70 B; --save-images DIR saves it]\nplain");
        assert_eq!(shown, result);
        let dir = tempfile::tempdir().unwrap();
        let into = dir.path().join("imgs");
        let (text, shown) = call_result(&result, "render_preview", Some(&into), Lang::En).unwrap();
        let path = into.join("render_preview-1.png");
        assert_eq!(fs::read(&path).unwrap(), STANDARD.decode(PNG).unwrap());
        assert!(text.contains(&format!("image 1 saved: {} (image/png, 70 B)", path.display())));
        assert_eq!(shown["content"][1], json!({"type": "image", "mimeType": "image/png", "saved": path.to_string_lossy()}));
        // never over a file
        call_result(&result, "render_preview", Some(&into), Lang::En).unwrap();
        assert!(into.join("render_preview-1-2.png").is_file());
    }

    #[test]
    fn an_errors_text() {
        let r = json!({"isError": true, "content": [{"type": "text", "text": " No channel \"x\". "}, {"type": "image", "data": ""}]});
        assert_eq!(text_of(&r), "No channel \"x\".");
    }
}
