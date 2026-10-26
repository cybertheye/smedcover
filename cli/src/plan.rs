//! Each command's flags as the arguments of the tool it calls, by the names and shapes of `ui/tools.json`, checked
//! before the app is reached: a command that is not right ends with exit 2 and says why, and starts no app.
//!
//! | Command | Tool | Arguments |
//! |---|---|---|
//! | `profiles` | `get_context` | none |
//! | `render` | `export` (and `get_context` for the size on the canvas) | `profile`, `channels: [channel]`, `sizes: [size]`, `dir` (a folder of its own next to the file), `format`, `scale` |
//! | `export` | `export` | `profile`, `channels` (a list, or `"all"`), `sizes` (a list, or `"all"`), `dir`, `format`, `scale` |
//! | `batch` | `batch_covers` | `profile`, `csv` (the file's text), `sizes`, `dir`, `format`, `scale` |
//! | `import` | `open_project` | `file` (absolute), `as` |
//! | `call` | any | the JSON object given |

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::lang::Lang;
use crate::paths::absolute;
use crate::Fail;

/// The longest path a tool takes (`dir`, `file`: `maxLength` in ui/tools.json).
pub const MAX_PATH: usize = 4096;
/// The longest CSV `batch_covers` takes, in characters.
pub const MAX_CSV: usize = 1_000_000;
/// The most channels and sizes `export` takes.
pub const MAX_CHANNELS: usize = 200;
pub const MAX_SIZES: usize = 80;

/// The format a tool takes for `--format` (`jpg` is `jpeg`).
pub fn format(flag: &str) -> Option<&'static str> {
    match flag.to_ascii_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpeg"),
        "webp" => Some("webp"),
        _ => None,
    }
}

/// The format a file's extension says, if it says one.
pub fn format_of_file(path: &Path) -> Option<&'static str> {
    path.extension().and_then(|e| e.to_str()).and_then(format)
}

/// `render`'s format: the one asked for, else the file's extension's; refused when the two disagree.
pub fn render_format(flag: Option<&str>, target: &Path, lang: Lang) -> Result<Option<&'static str>, Fail> {
    let asked = flag.and_then(format);
    let by_name = format_of_file(target);
    match (asked, by_name) {
        (Some(a), Some(b)) if a != b => Err(Fail::Usage(lang.pick(
            format!("--format {} does not match the file's extension ({}): give one or the other, or make them agree.", flag.unwrap_or(a), target.display()),
            format!("--format {} 和文件的扩展名对不上（{}）：只给其中一个，或者让两者一致。", flag.unwrap_or(a), target.display()),
        ))),
        (Some(a), _) => Ok(Some(a)),
        (None, b) => Ok(b),
    }
}

/// A list flag (`--channels`, `--sizes`): `all`, or names separated by commas, each kept as text (the app finds a
/// channel by its id, name, code or number, and a size by its pixels, ratio or name, from text).
pub fn list(text: &str, flag: &str, most: usize, lang: Lang) -> Result<Value, Fail> {
    if text.trim().eq_ignore_ascii_case("all") {
        return Ok(json!("all"));
    }
    let items: Vec<&str> = text.split(',').map(str::trim).collect();
    if items.iter().any(|i| i.is_empty()) {
        return Err(Fail::Usage(lang.pick(
            format!("{flag} wants names separated by commas, or `all`; one of them is empty: {text:?}"),
            format!("{flag} 要用逗号隔开的名字，或者 `all`；其中有一个是空的：{text:?}"),
        )));
    }
    if items.iter().any(|i| i.eq_ignore_ascii_case("all")) {
        return Err(Fail::Usage(lang.pick(format!("{flag}: `all` goes alone."), format!("{flag}：`all` 只能单独用。"))));
    }
    if items.len() > most {
        return Err(Fail::Usage(lang.pick(format!("{flag} takes {most} at most."), format!("{flag} 最多 {most} 个。"))));
    }
    Ok(json!(items))
}

/// A folder to write into, absolute.
pub fn folder(dir: &Path, cwd: &Path, lang: Lang) -> Result<PathBuf, Fail> {
    let dir = absolute(dir, cwd);
    check_path(&dir, lang)?;
    Ok(dir)
}

fn check_path(path: &Path, lang: Lang) -> Result<(), Fail> {
    match path.to_str() {
        None => Err(Fail::Usage(lang.pick(
            format!("The path is not text the app can take: {}", path.display()),
            format!("这个路径不是 App 能接受的文字：{}", path.display()),
        ))),
        Some(p) if p.chars().count() > MAX_PATH => {
            Err(Fail::Usage(lang.pick(format!("The path is longer than {MAX_PATH} characters."), format!("路径超过 {MAX_PATH} 个字符。"))))
        }
        Some(_) => Ok(()),
    }
}

/// What `export` and `batch_covers` share: `profile`, `sizes`, `dir`, `format` and `scale`, each when given.
pub struct Common {
    pub profile: Option<String>,
    pub sizes: Option<Value>,
    pub dir: Option<PathBuf>,
    pub format: Option<&'static str>,
    pub scale: Option<u8>,
}

impl Common {
    fn into_args(self, args: &mut Map<String, Value>) {
        if let Some(profile) = self.profile {
            args.insert("profile".into(), json!(profile));
        }
        if let Some(sizes) = self.sizes {
            args.insert("sizes".into(), sizes);
        }
        if let Some(dir) = self.dir {
            args.insert("dir".into(), json!(dir.to_string_lossy()));
        }
        if let Some(format) = self.format {
            args.insert("format".into(), json!(format));
        }
        if let Some(scale) = self.scale {
            args.insert("scale".into(), json!(scale));
        }
    }
}

/// `export`'s arguments.
pub fn export_args(channels: Option<Value>, common: Common) -> Value {
    let mut args = Map::new();
    if let Some(channels) = channels {
        args.insert("channels".into(), channels);
    }
    common.into_args(&mut args);
    Value::Object(args)
}

/// `batch_covers`'s arguments, the jobs as CSV text.
pub fn batch_args(csv: &str, common: Common) -> Value {
    let mut args = Map::new();
    args.insert("csv".into(), json!(csv));
    common.into_args(&mut args);
    Value::Object(args)
}

/// The CSV's text, checked: not empty, within what the tool takes; a byte-order mark taken off.
pub fn csv_text(text: String, lang: Lang) -> Result<String, Fail> {
    let text = text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text);
    if text.trim().is_empty() {
        return Err(Fail::Usage(lang.pick("The CSV is empty.".into(), "CSV 是空的。".into())));
    }
    if text.chars().count() > MAX_CSV {
        return Err(Fail::Usage(lang.pick(
            format!("The CSV is longer than the app takes at once ({MAX_CSV} characters): split it."),
            format!("CSV 太长，App 一次最多收 {MAX_CSV} 个字符：拆开分几次。"),
        )));
    }
    Ok(text)
}

/// `open_project`'s arguments: the file, absolute, and where it goes.
pub fn import_args(file: &Path, into: Option<&str>, cwd: &Path, lang: Lang) -> Result<Value, Fail> {
    let file = absolute(file, cwd);
    if !file.is_file() {
        return Err(Fail::Usage(lang.pick(format!("No such file: {}", file.display()), format!("没有这个文件：{}", file.display()))));
    }
    check_path(&file, lang)?;
    let mut args = json!({"file": file.to_string_lossy()});
    if let Some(into) = into {
        args["as"] = json!(into);
    }
    Ok(args)
}

/// `call`'s arguments: a JSON object (none given: `{}`).
pub fn call_args(text: Option<&str>, lang: Lang) -> Result<Value, Fail> {
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        return Ok(json!({}));
    };
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(args)) => Ok(Value::Object(args)),
        Ok(_) => Err(Fail::Usage(lang.pick(
            "The arguments must be a JSON object, such as {\"title\": \"Hello\"}.".into(),
            "参数必须是一个 JSON 对象，比如 {\"title\": \"你好\"}。".into(),
        ))),
        Err(e) => Err(Fail::Usage(lang.pick(format!("The arguments are not JSON: {e}"), format!("参数不是 JSON：{e}")))),
    }
}

/// `render`'s target, absolute, and the folder it goes into, which must be there.
pub fn render_target(output: &Path, cwd: &Path, lang: Lang) -> Result<(PathBuf, PathBuf), Fail> {
    let target = absolute(output, cwd);
    check_path(&target, lang)?;
    if target.file_name().is_none() || target.is_dir() {
        return Err(Fail::Usage(lang.pick(
            format!("-o wants a file to write, not a folder: {}", target.display()),
            format!("-o 要的是文件，不是文件夹：{}", target.display()),
        )));
    }
    let parent = target.parent().map(Path::to_path_buf).unwrap_or_else(|| cwd.to_path_buf());
    if !parent.is_dir() {
        return Err(Fail::Usage(lang.pick(format!("No such folder: {}", parent.display()), format!("没有这个文件夹：{}", parent.display()))));
    }
    Ok((target, parent))
}

/// `render`'s `export` arguments: that one channel at that one size, into `dir`.
pub fn render_args(channel: &str, size: &str, profile: Option<&str>, format: Option<&'static str>, scale: Option<u8>, dir: &Path) -> Value {
    let common = Common { profile: profile.map(str::to_string), sizes: Some(json!([size])), dir: Some(dir.to_path_buf()), format, scale };
    export_args(Some(json!([channel])), common)
}

/// The size `render` makes when none is named: the one on the canvas when the profile is the one shown, else the
/// profile's first ticked in Export, else its first. `context` is `get_context`'s answer; `profile`, as `--profile`
/// names it (by id, else by name, as the app finds it).
pub fn default_size(context: &Value, profile: Option<&str>, lang: Lang) -> Result<String, Fail> {
    let profiles = context["profiles"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let current = &context["current"];
    let shown = current["profile"].as_str().unwrap_or("");
    let found = match profile {
        None => profiles.iter().find(|p| p["id"] == shown),
        Some(want) => {
            let want = want.trim();
            profiles.iter().find(|p| p["id"] == want).or_else(|| {
                let named: Vec<&Value> = profiles
                    .iter()
                    .filter(|p| p["name"].as_str().is_some_and(|n| n.trim().to_lowercase() == want.to_lowercase()))
                    .collect();
                (named.len() == 1).then(|| named[0])
            })
        }
    };
    let Some(found) = found else {
        let all: Vec<String> = profiles.iter().map(|p| format!("{} (id {})", p["name"].as_str().unwrap_or(""), p["id"].as_str().unwrap_or(""))).collect();
        return Err(Fail::Tool(lang.pick(
            format!("No profile \"{}\"; the profiles are: {}.", profile.unwrap_or(shown), all.join(", ")),
            format!("没有档案「{}」；现有的档案：{}。", profile.unwrap_or(shown), all.join("、")),
        )));
    };
    if found["id"] == shown {
        if let Some(size) = current["size"].as_str().filter(|s| !s.is_empty()) {
            return Ok(size.to_string());
        }
    }
    let sizes = found["sizes"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    sizes
        .iter()
        .find(|z| z["ticked"] == true)
        .or_else(|| sizes.first())
        .and_then(|z| z["key"].as_str())
        .map(str::to_string)
        .ok_or_else(|| Fail::Tool(lang.pick("The profile has no sizes.".into(), "这个档案没有尺寸。".into())))
}

#[cfg(test)]
mod tests {
    use super::*;

    const EN: Lang = Lang::En;

    fn usage(r: Result<impl std::fmt::Debug, Fail>) -> String {
        match r {
            Err(Fail::Usage(m)) => m,
            other => panic!("a usage error, not {other:?}"),
        }
    }

    #[test]
    fn formats() {
        assert_eq!(format("JPG"), Some("jpeg"));
        assert_eq!(format("webp"), Some("webp"));
        assert_eq!(format("gif"), None);
        assert_eq!(format_of_file(Path::new("a/b.Jpeg")), Some("jpeg"));
        assert_eq!(format_of_file(Path::new("cover")), None);
        assert_eq!(render_format(None, Path::new("x.png"), EN).unwrap(), Some("png"));
        assert_eq!(render_format(Some("webp"), Path::new("x"), EN).unwrap(), Some("webp"));
        assert_eq!(render_format(Some("jpg"), Path::new("x.jpeg"), EN).unwrap(), Some("jpeg"));
        assert_eq!(render_format(None, Path::new("x.cover"), EN).unwrap(), None);
        assert!(usage(render_format(Some("png"), Path::new("x.jpg"), EN)).contains("--format png"));
    }

    #[test]
    fn lists() {
        assert_eq!(list("all", "--channels", 10, EN).unwrap(), json!("all"));
        assert_eq!(list(" ALL ", "--channels", 10, EN).unwrap(), json!("all"));
        // numbers stay text: the app reads a channel's number from it
        assert_eq!(list("1, VLOG ,c3", "--channels", 10, EN).unwrap(), json!(["1", "VLOG", "c3"]));
        assert_eq!(list("16:9", "--sizes", 10, EN).unwrap(), json!(["16:9"]));
        assert!(usage(list("a,,b", "--sizes", 10, EN)).contains("empty"));
        assert!(usage(list("a,all", "--sizes", 10, EN)).contains("alone"));
        assert!(usage(list("a,b,c", "--sizes", 2, EN)).contains("2 at most"));
        assert!(usage(list("", "--sizes", 2, Lang::Zh)).contains("空"));
    }

    fn cwd() -> PathBuf {
        std::env::temp_dir().join("work")
    }

    #[test]
    fn export_and_batch_arguments_have_the_tools_names() {
        let common = Common { profile: Some("Mine".into()), sizes: Some(json!("all")), dir: Some(cwd().join("out")), format: Some("jpeg"), scale: Some(2) };
        let args = export_args(Some(json!(["1", "2"])), common);
        assert_eq!(args, json!({"profile": "Mine", "channels": ["1", "2"], "sizes": "all", "dir": cwd().join("out").to_string_lossy(), "format": "jpeg", "scale": 2}));
        // nothing given: nothing sent, the app's defaults
        let none = Common { profile: None, sizes: None, dir: None, format: None, scale: None };
        assert_eq!(export_args(None, none), json!({}));
        let common = Common { profile: None, sizes: Some(json!(["16:9"])), dir: None, format: None, scale: None };
        assert_eq!(batch_args("Vlog,Hi\n", common), json!({"csv": "Vlog,Hi\n", "sizes": ["16:9"]}));
    }

    #[test]
    fn csv() {
        assert_eq!(csv_text("\u{feff}channel,title\nA,B\n".into(), EN).unwrap(), "channel,title\nA,B\n");
        assert!(usage(csv_text(" \n".into(), EN)).contains("empty"));
        assert!(usage(csv_text("x".repeat(MAX_CSV + 1), EN)).contains("split"));
    }

    #[test]
    fn import_wants_a_file_and_makes_it_absolute() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("p.smedcover.json");
        std::fs::write(&file, "{}").unwrap();
        let args = import_args(Path::new("p.smedcover.json"), Some("current"), dir.path(), EN).unwrap();
        assert_eq!(args, json!({"file": file.to_string_lossy(), "as": "current"}));
        assert_eq!(import_args(&file, None, &cwd(), EN).unwrap(), json!({"file": file.to_string_lossy()}));
        assert!(usage(import_args(Path::new("missing.smedcover.json"), None, dir.path(), EN)).contains("No such file"));
        assert!(usage(import_args(dir.path(), None, dir.path(), EN)).contains("No such file"));
    }

    #[test]
    fn call_arguments_are_an_object() {
        assert_eq!(call_args(None, EN).unwrap(), json!({}));
        assert_eq!(call_args(Some("  "), EN).unwrap(), json!({}));
        assert_eq!(call_args(Some(r#"{"title": "x"}"#), EN).unwrap(), json!({"title": "x"}));
        assert!(usage(call_args(Some("[1]"), EN)).contains("object"));
        assert!(usage(call_args(Some("{title"), EN)).contains("not JSON"));
    }

    #[test]
    fn render_writes_one_channel_at_one_size_into_its_folder() {
        let dir = tempfile::tempdir().unwrap();
        let (target, parent) = render_target(Path::new("cover.png"), dir.path(), EN).unwrap();
        assert_eq!((target, parent.clone()), (dir.path().join("cover.png"), dir.path().to_path_buf()));
        assert!(usage(render_target(Path::new("no/such/cover.png"), dir.path(), EN)).contains("No such folder"));
        assert!(usage(render_target(dir.path(), dir.path(), EN)).contains("not a folder"));
        let args = render_args("VLOG", "16:9", Some("p1"), Some("png"), None, &parent.join(".tmp"));
        assert_eq!(args, json!({"profile": "p1", "channels": ["VLOG"], "sizes": ["16:9"], "dir": parent.join(".tmp").to_string_lossy(), "format": "png"}));
    }

    #[test]
    fn the_size_render_makes_unless_told() {
        let context = json!({
            "profiles": [
                {"id": "p1", "name": "Mine", "channels": [], "sizes": [{"key": "1920x1080"}, {"key": "1080x1920", "ticked": true}]},
                {"id": "p2", "name": "Other", "channels": [], "sizes": [{"key": "1280x720"}]},
                {"id": "p3", "name": "Empty", "channels": [], "sizes": []},
            ],
            "current": {"profile": "p1", "channel": "c1", "size": "1920x1080", "layer": "bg"},
        });
        assert_eq!(default_size(&context, None, EN).unwrap(), "1920x1080");
        assert_eq!(default_size(&context, Some("p1"), EN).unwrap(), "1920x1080");
        assert_eq!(default_size(&context, Some("other"), EN).unwrap(), "1280x720");
        let mut not_shown = context.clone();
        not_shown["current"]["profile"] = json!("p2");
        assert_eq!(default_size(&not_shown, Some("Mine"), EN).unwrap(), "1080x1920", "the first ticked");
        assert!(matches!(default_size(&context, Some("nope"), EN), Err(Fail::Tool(m)) if m.contains("Mine (id p1)")));
        assert!(matches!(default_size(&context, Some("p3"), EN), Err(Fail::Tool(m)) if m.contains("no sizes")));
    }
}
