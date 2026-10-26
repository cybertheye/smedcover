//! SmedCover's command line, `smedcover`: `profiles`, `render`, `export`, `batch`, `import`, `tools` and `call`, each
//! one or two calls of the app's own tools, the ones agents use, over MCP. It draws nothing itself: the app does, in
//! its open window when it runs, else in one started hidden for the command, which quits when it is done.
//!
//! * [`args`]: the commands and flags (clap);
//! * [`plan`]: each command's flags as its tool's arguments, checked before the app is reached;
//! * [`app`]: finding the app on the data folder (`cli.json`, `/health`), or starting it, and letting it go
//!   (`/app/done`);
//! * [`mcp`]: the MCP client (2025-06-18 over streamable HTTP), over [`http`], a small HTTP/1.1 client;
//! * [`output`]: what is printed; [`lang`]: in Chinese or English; [`paths`]: the data folder.
//!
//! Exit codes ([`exit`]): 0 done; 1 the app answered an error; 2 the command was not right; 3 the app could not be
//! reached or started, or needs setting up; 4 no answer in time; 130 interrupted.

pub mod app;
pub mod args;
pub mod http;
pub mod interrupt;
pub mod lang;
pub mod mcp;
pub mod output;
pub mod paths;
pub mod plan;

use std::ffi::OsString;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use clap::Parser;
use serde_json::{json, Value};

use crate::args::{Cli, Command};
use crate::lang::Lang;
use crate::mcp::{Limits, Session};
use crate::output::Out;
use crate::plan::Common;

include!(concat!(env!("OUT_DIR"), "/timeouts.rs"));

/// The exit codes.
pub mod exit {
    pub const OK: i32 = 0;
    /// The app answered an error (or what it answered could not be used).
    pub const TOOL: i32 = 1;
    /// The command was not right: an unknown command or flag, a value it does not take, a file not there.
    pub const USAGE: i32 = 2;
    /// The app could not be reached or started, or needs setting up first.
    pub const APP: i32 = 3;
    /// No answer in time (the command line's limit, or the app's own for the tool).
    pub const TIMEOUT: i32 = 4;
    /// Ctrl-C.
    pub const INTERRUPTED: i32 = 130;
}

/// Why a command failed, in words for the user.
#[derive(Debug, PartialEq)]
pub enum Fail {
    Usage(String),
    Tool(String),
    App(String),
    Timeout(String),
    Interrupted(String),
}

impl Fail {
    pub fn code(&self) -> i32 {
        match self {
            Fail::Usage(_) => exit::USAGE,
            Fail::Tool(_) => exit::TOOL,
            Fail::App(_) => exit::APP,
            Fail::Timeout(_) => exit::TIMEOUT,
            Fail::Interrupted(_) => exit::INTERRUPTED,
        }
    }

    /// The kind, as `--json` gives it.
    pub fn kind(&self) -> &'static str {
        match self {
            Fail::Usage(_) => "usage",
            Fail::Tool(_) => "tool",
            Fail::App(_) => "app",
            Fail::Timeout(_) => "timeout",
            Fail::Interrupted(_) => "interrupted",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Fail::Usage(m) | Fail::Tool(m) | Fail::App(m) | Fail::Timeout(m) | Fail::Interrupted(m) => m,
        }
    }
}

/// How long the app may go quiet on a tool it does not list (the endpoint's `DEFAULT_TIMEOUT`).
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
/// The longest any call may take however often it says how it gets on (the endpoint's `MAX_TIMEOUT`).
pub const MAX_CALL: Duration = Duration::from_secs(2 * 60 * 60);
/// How much longer than the app the command line waits, so that the app's own answer, which says more, comes first.
pub const GRACE: Duration = Duration::from_secs(10);
/// How the endpoint's answer begins when the page went quiet past the tool's timeout (core's `BridgeError::Timeout`).
pub const APP_TIMED_OUT: &str = "SmedCover did not answer in time";

/// How long the app may go quiet on `tool`, as ui/tools.json has it.
pub fn tool_timeout(tool: &str) -> Duration {
    TOOL_TIMEOUTS.iter().find(|(name, _)| *name == tool).map_or(DEFAULT_TIMEOUT, |(_, ms)| Duration::from_millis(*ms))
}

/// How long a call of `tool` is waited for: as long as the app keeps working on it (its quiet time, from the last word
/// of progress, a little longer than the app's own), or in all `--timeout` when it is given.
pub fn limits(tool: &str, timeout: Option<Duration>) -> Limits {
    let quiet = tool_timeout(tool) + GRACE;
    let total = timeout.unwrap_or(MAX_CALL + GRACE);
    Limits { quiet: quiet.min(total), total }
}

/// Runs the command line with `args` (the program's name first); its exit code.
pub fn main_with(args: impl IntoIterator<Item = OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            return e.exit_code();
        }
    };
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let selftest = std::env::var_os("SMEDCOVER_SELFTEST").map(PathBuf::from);
    let data = paths::data_folder(cli.data.as_deref(), selftest.as_deref(), &cwd);
    let lang = Lang::detect(data.as_ref().map(|(d, _)| d.as_path()));
    let out = Out::new(cli.json, cli.quiet, lang);
    interrupt::install();
    match run(cli, data, &cwd, &out) {
        Ok(()) => exit::OK,
        Err(fail) => {
            out.fail(&fail);
            fail.code()
        }
    }
}

/// What a command is to do, its arguments checked.
enum Job {
    Profiles,
    Render { channel: String, profile: Option<String>, size: Option<String>, format: Option<&'static str>, scale: Option<u8>, target: PathBuf, dir: PathBuf },
    Export(Value),
    Batch(Value),
    Import(Value),
    Tools,
    Call { tool: String, args: Value, save_images: Option<PathBuf> },
}

fn run(cli: Cli, data: Option<(PathBuf, bool)>, cwd: &Path, out: &Out) -> Result<(), Fail> {
    let lang = out.lang;
    let timeout = cli.timeout.map(Duration::from_secs_f64);
    // everything that can be checked here is, before any app is reached or started
    let job = prepare(cli.command, cwd, lang)?;
    let (data, data_named) = data.ok_or_else(|| {
        Fail::App(lang.pick("This computer has no data folder for SmedCover: name one with --data DIR.".into(), "这台电脑上没有 SmedCover 的数据文件夹：用 --data 目录 指定一个。".into()))
    })?;
    let note = |text: &str| out.note(text);
    let mut app = app::connect(&app::Opts { data: &data, data_named, lang, quiet: out.quiet, note: &note })?;
    if !app.version.is_empty() && app.version != env!("CARGO_PKG_VERSION") {
        out.note(&lang.pick(
            format!("Note: SmedCover {} is running; this command line is {}.", app.version, env!("CARGO_PKG_VERSION")),
            format!("注意：运行中的 SmedCover 是 {}，命令行是 {}。", app.version, env!("CARGO_PKG_VERSION")),
        ));
    }
    let result = Session::open(app.port, &app.token).map_err(|e| from_mcp(e, lang, None)).and_then(|mut session| perform(job, &mut session, out, timeout));
    app.finish();
    result
}

/// The command's job, its flags checked and turned into the tool's arguments.
fn prepare(command: Command, cwd: &Path, lang: Lang) -> Result<Job, Fail> {
    let format = |flag: Option<String>| flag.as_deref().and_then(plan::format);
    let sizes = |flag: Option<String>| flag.map(|s| plan::list(&s, "--sizes", plan::MAX_SIZES, lang)).transpose();
    let out_dir = |flag: Option<PathBuf>| -> Result<Option<PathBuf>, Fail> {
        let Some(dir) = flag else {
            return Ok(None);
        };
        let dir = plan::folder(&dir, cwd, lang)?;
        fs::create_dir_all(&dir).map_err(|e| {
            Fail::Usage(lang.pick(format!("Could not make the folder {}: {e}", dir.display()), format!("建不了文件夹 {}：{e}", dir.display())))
        })?;
        Ok(Some(dir))
    };
    Ok(match command {
        Command::Profiles => Job::Profiles,
        Command::Tools => Job::Tools,
        Command::Render { channel, profile, size, size_key, format: f, scale, output } => {
            let (target, dir) = plan::render_target(&output, cwd, lang)?;
            let format = plan::render_format(f.as_deref(), &target, lang)?;
            if channel.trim().is_empty() {
                return Err(Fail::Usage(lang.pick("Name a channel.".into(), "请指定频道。".into())));
            }
            Job::Render { channel, profile, size: size.or(size_key).filter(|s| !s.trim().is_empty()), format, scale, target, dir }
        }
        Command::Export { profile, channels, sizes: z, format: f, scale, out } => {
            let channels = channels.map(|c| plan::list(&c, "--channels", plan::MAX_CHANNELS, lang)).transpose()?;
            let common = Common { profile, sizes: sizes(z)?, dir: out_dir(out)?, format: format(f), scale };
            Job::Export(plan::export_args(channels, common))
        }
        Command::Batch { csv, profile, sizes: z, format: f, scale, out } => {
            let text = read_input(&csv, cwd, lang)?;
            let text = plan::csv_text(text, lang)?;
            let common = Common { profile, sizes: sizes(z)?, dir: out_dir(out)?, format: format(f), scale };
            Job::Batch(plan::batch_args(&text, common))
        }
        Command::Import { file, into } => Job::Import(plan::import_args(&file, into.as_deref(), cwd, lang)?),
        Command::Call { tool, arguments, save_images } => {
            let text = match arguments.as_deref() {
                Some("-") => Some(read_input(Path::new("-"), cwd, lang)?),
                other => other.map(str::to_string),
            };
            let args = plan::call_args(text.as_deref(), lang)?;
            Job::Call { tool, args, save_images: save_images.map(|d| paths::absolute(&d, cwd)) }
        }
    })
}

/// A file's text, or the standard input's for `-`.
fn read_input(path: &Path, cwd: &Path, lang: Lang) -> Result<String, Fail> {
    let mut text = String::new();
    let read = if path == Path::new("-") {
        std::io::stdin().read_to_string(&mut text).map(|_| ())
    } else {
        let path = paths::absolute(path, cwd);
        fs::read_to_string(&path).map(|t| text = t)
    };
    read.map_err(|e| Fail::Usage(lang.pick(format!("Could not read {}: {e}", path.display()), format!("读不了 {}：{e}", path.display()))))?;
    Ok(text)
}

fn perform(job: Job, session: &mut Session, out: &Out, timeout: Option<Duration>) -> Result<(), Fail> {
    let lang = out.lang;
    match job {
        Job::Profiles => {
            let context = structured(call(session, out, timeout, "get_context", json!({}))?);
            if out.json {
                out.json_value(&context);
            } else {
                out.text(&output::profiles(&context, lang));
            }
        }
        Job::Render { channel, profile, size, format, scale, target, dir } => {
            let size = match size {
                Some(size) => size,
                None => plan::default_size(&structured(call(session, out, timeout, "get_context", json!({}))?), profile.as_deref(), lang)?,
            };
            let scratch = Scratch::new(&dir, lang)?;
            let args = plan::render_args(&channel, &size, profile.as_deref(), format, scale, &scratch.0);
            let result = structured(call(session, out, timeout, "export", args)?);
            stopped_part_way(&result, lang)?;
            let files = output::files(&result);
            let [file] = files.as_slice() else {
                return Err(Fail::Tool(lang.pick(
                    format!("The export wrote {} files, not one.", files.len()),
                    format!("导出写了 {} 个文件，而不是一个。", files.len()),
                )));
            };
            fs::rename(file, &target).map_err(|e| {
                Fail::Tool(lang.pick(format!("Could not move the cover to {}: {e}", target.display()), format!("没能把封面移到 {}：{e}", target.display())))
            })?;
            if out.json {
                let first = &result["files"][0];
                out.json_value(&json!({"path": target.to_string_lossy(), "channel": first["channel"], "size": first["size"], "title": first["title"]}));
            } else {
                out.text(&target.to_string_lossy());
            }
        }
        Job::Export(args) | Job::Batch(args) => {
            let tool = if args.get("csv").is_some() { "batch_covers" } else { "export" };
            let result = structured(call(session, out, timeout, tool, args)?);
            if out.json {
                out.json_value(&result);
            } else {
                let files = output::files(&result);
                out.text(&files.join("\n"));
                out.note(&output::written(files.len(), result["dir"].as_str().unwrap_or(""), lang));
            }
            stopped_part_way(&result, lang)?;
        }
        Job::Import(args) => {
            let result = structured(call(session, out, timeout, "open_project", args)?);
            if out.json {
                out.json_value(&result);
            } else {
                out.text(&output::opened(&result, lang));
            }
        }
        Job::Tools => {
            let tools = session.list_tools().map_err(|e| from_mcp(e, lang, None))?;
            if out.json {
                out.json_value(&Value::Array(tools));
            } else {
                out.text(&output::tools(&tools));
            }
        }
        Job::Call { tool, args, save_images } => {
            let result = call(session, out, timeout, &tool, args)?;
            let (text, shown) = output::call_result(&result, &tool, save_images.as_deref(), lang).map_err(|e| {
                Fail::Tool(lang.pick(format!("Could not save the images: {e}"), format!("没能保存图片：{e}")))
            })?;
            if out.json {
                out.json_value(&shown);
            } else {
                out.text(&text);
            }
        }
    }
    Ok(())
}

/// Calls `tool`, its progress on the standard error; its result, or why it has none.
fn call(session: &mut Session, out: &Out, timeout: Option<Duration>, tool: &str, args: Value) -> Result<Value, Fail> {
    let lang = out.lang;
    let limits = limits(tool, timeout);
    let answer = session.call_tool(tool, args, limits, &mut |p| out.progress(p));
    out.end_progress();
    let result = answer.map_err(|e| from_mcp(e, lang, Some((tool, limits))))?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let text = output::text_of(&result);
        let text = if text.is_empty() { lang.pick("The app answered an error.".to_string(), "App 回答了一个错误。".to_string()) } else { text };
        return Err(if text.starts_with(APP_TIMED_OUT) { Fail::Timeout(text) } else { Fail::Tool(text) });
    }
    Ok(result)
}

/// A result's `structuredContent` (what the tool's `outputSchema` describes), else the result itself.
fn structured(result: Value) -> Value {
    match result {
        Value::Object(mut r) => r.remove("structuredContent").unwrap_or(Value::Object(r)),
        other => other,
    }
}

/// An export the app stopped part-way (cancelled in its window) is not done.
fn stopped_part_way(result: &Value, lang: Lang) -> Result<(), Fail> {
    if result["cancelled"] == true {
        return Err(Fail::Tool(lang.pick("The export was stopped part-way.".into(), "导出中途停下了。".into())));
    }
    Ok(())
}

/// An MCP error in the user's words; `call`, the tool called and how long it was waited for.
fn from_mcp(e: mcp::Error, lang: Lang, call: Option<(&str, Limits)>) -> Fail {
    match e {
        mcp::Error::Unreachable(why) => Fail::App(lang.pick(format!("Could not reach SmedCover: {why}"), format!("连不上 SmedCover：{why}"))),
        mcp::Error::Gone => Fail::App(lang.pick(
            "SmedCover went away before it answered; what the call changed may or may not be done.".into(),
            "SmedCover 没等回答就断开了；这次调用改的东西可能做了，也可能没做。".into(),
        )),
        mcp::Error::Rpc { code, message } => match call {
            Some((tool, _)) if code == -32602 && message.starts_with("Unknown tool") => Fail::Usage(lang.pick(
                format!("SmedCover has no tool \"{tool}\": `smedcover tools` lists them."),
                format!("SmedCover 没有工具「{tool}」：`smedcover tools` 列出全部工具。"),
            )),
            _ => Fail::Tool(message),
        },
        mcp::Error::TimedOut => {
            let secs = call.map_or(Limits::SETUP.total, |(_, l)| l.quiet.min(l.total)).as_secs_f64();
            Fail::Timeout(lang.pick(
                format!("No answer within {secs:.0} s: the call was cancelled. What it changed so far stays (undo it in the window)."),
                format!("{secs:.0} 秒内没有回答：这次调用已取消。它已经改了的留着（可以在窗口里撤销）。"),
            ))
        }
        mcp::Error::Interrupted => Fail::Interrupted(lang.pick("Interrupted: the call was cancelled.".into(), "已中断：这次调用已取消。".into())),
    }
}

/// A folder of `render`'s own beside the file it writes, which the export writes into, removed when it is done.
struct Scratch(PathBuf);

impl Scratch {
    fn new(beside: &Path, lang: Lang) -> Result<Scratch, Fail> {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
        let mut last = None;
        for n in 0..100u32 {
            let dir = beside.join(format!(".smedcover-render-{}-{stamp:x}-{n}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => return Ok(Scratch(dir)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => {
                    last = Some(e);
                    break;
                }
            }
        }
        let e = last.map_or_else(|| "no free name".to_string(), |e| e.to_string());
        Err(Fail::Usage(lang.pick(format!("Could not write into {}: {e}", beside.display()), format!("写不进 {}：{e}", beside.display()))))
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_tool_waits_as_tools_json_says() {
        assert_eq!(tool_timeout("get_context"), Duration::from_secs(30));
        assert_eq!(tool_timeout("export"), Duration::from_secs(30 * 60));
        assert_eq!(tool_timeout("cut_out"), Duration::from_secs(10 * 60));
        assert_eq!(tool_timeout("not_a_tool"), DEFAULT_TIMEOUT);
        // the table is ui/tools.json's, every tool of it
        let file: Value = serde_json::from_str(include_str!("../../ui/tools.json")).unwrap();
        assert_eq!(TOOL_TIMEOUTS.len(), file["tools"].as_array().unwrap().len());
    }

    #[test]
    fn limits() {
        let l = super::limits("export", None);
        assert_eq!(l, Limits { quiet: Duration::from_secs(1800) + GRACE, total: MAX_CALL + GRACE });
        let l = super::limits("get_context", Some(Duration::from_secs(5)));
        assert_eq!(l, Limits { quiet: Duration::from_secs(5), total: Duration::from_secs(5) });
        let l = super::limits("get_context", Some(Duration::from_secs(600)));
        assert_eq!(l.quiet, Duration::from_secs(30) + GRACE, "the app keeps its own quiet time; --timeout is the most in all");
    }

    #[test]
    fn the_core_says_a_timeout_as_this_expects() {
        let said = smedcover_core::mcp::BridgeError::Timeout.to_string();
        assert!(said.starts_with(APP_TIMED_OUT), "{said}");
        assert_eq!(MAX_CALL, smedcover_core::mcp::tools::MAX_TIMEOUT);
        assert_eq!(DEFAULT_TIMEOUT, smedcover_core::mcp::tools::DEFAULT_TIMEOUT);
    }

    #[test]
    fn errors_in_words_and_codes() {
        let unknown = mcp::Error::Rpc { code: -32602, message: "Unknown tool: nope".into() };
        let fail = from_mcp(unknown, Lang::En, Some(("nope", super::limits("nope", None))));
        assert_eq!(fail.code(), exit::USAGE);
        assert!(fail.message().contains("smedcover tools"));
        assert_eq!(from_mcp(mcp::Error::Rpc { code: -32603, message: "boom".into() }, Lang::En, None), Fail::Tool("boom".into()));
        assert_eq!(from_mcp(mcp::Error::Gone, Lang::En, None).code(), exit::APP);
        assert_eq!(from_mcp(mcp::Error::Unreachable("refused".into()), Lang::Zh, None), Fail::App("连不上 SmedCover：refused".into()));
        let timed_out = from_mcp(mcp::Error::TimedOut, Lang::En, Some(("x", Limits { quiet: Duration::from_secs(2), total: Duration::from_secs(9) })));
        assert_eq!(timed_out.code(), exit::TIMEOUT);
        assert!(timed_out.message().starts_with("No answer within 2 s"));
        assert_eq!(from_mcp(mcp::Error::Interrupted, Lang::En, None).code(), exit::INTERRUPTED);
        assert_eq!(Fail::Usage(String::new()).kind(), "usage");
    }

    #[test]
    fn structured_content_or_the_result() {
        assert_eq!(structured(json!({"content": [], "structuredContent": {"a": 1}})), json!({"a": 1}));
        assert_eq!(structured(json!({"content": []})), json!({"content": []}));
    }

    #[test]
    fn checks_a_command_before_reaching_the_app() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path();
        let job = |args: &[&str]| prepare(Cli::try_parse_from(std::iter::once("smedcover").chain(args.iter().copied())).unwrap().command, cwd, Lang::En);
        assert!(matches!(job(&["render", "1", "-o", "nowhere/x.png"]), Err(Fail::Usage(m)) if m.contains("No such folder")));
        assert!(matches!(job(&["render", "1", "-o", "x.jpg", "--format", "webp"]), Err(Fail::Usage(_))));
        assert!(matches!(job(&["render", " ", "-o", "x.png"]), Err(Fail::Usage(m)) if m.contains("channel")));
        assert!(matches!(job(&["export", "--channels", "a,,b"]), Err(Fail::Usage(_))));
        assert!(matches!(job(&["batch", "missing.csv"]), Err(Fail::Usage(m)) if m.contains("missing.csv")));
        assert!(matches!(job(&["import", "missing.smedcover.json"]), Err(Fail::Usage(_))));
        assert!(matches!(job(&["call", "set_text", "[1]"]), Err(Fail::Usage(_))));
        // --out is made when it is not there
        match job(&["export", "--out", "covers/new", "--channels", "all", "--format", "jpg"]).unwrap() {
            Job::Export(args) => {
                assert_eq!(args, json!({"channels": "all", "dir": cwd.join("covers").join("new").to_string_lossy(), "format": "jpeg"}));
                assert!(cwd.join("covers/new").is_dir());
            }
            _ => panic!("an export"),
        }
        match job(&["render", "VLOG", "--size-key", "1920x1080", "-o", "c.webp"]).unwrap() {
            Job::Render { size, format, target, dir, .. } => {
                assert_eq!((size.as_deref(), format), (Some("1920x1080"), Some("webp")));
                assert_eq!((target, dir), (cwd.join("c.webp"), cwd.to_path_buf()));
            }
            _ => panic!("a render"),
        }
        fs::write(cwd.join("jobs.csv"), "\u{feff}channel,title\nVlog,Hi\n").unwrap();
        match job(&["batch", "jobs.csv", "--sizes", "16:9,9:16", "--scale", "2"]).unwrap() {
            Job::Batch(args) => assert_eq!(args, json!({"csv": "channel,title\nVlog,Hi\n", "sizes": ["16:9", "9:16"], "scale": 2})),
            _ => panic!("a batch"),
        }
    }

    #[test]
    fn scratch_goes_when_done() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = Scratch::new(dir.path(), Lang::En).unwrap();
        let inside = scratch.0.clone();
        fs::write(inside.join("a.png"), "x").unwrap();
        assert!(inside.is_dir() && inside.starts_with(dir.path()));
        drop(scratch);
        assert!(!inside.exists());
    }
}
