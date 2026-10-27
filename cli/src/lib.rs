//! SmedCover's command line, `smedcover`: `profiles`, `render`, `export`, `batch`, `import`, `tools` and `call`, each
//! one or two calls of the app's own tools, the ones agents use, over MCP. It draws nothing itself: the app does, in
//! its open window when it runs, else in one started hidden for the command, which quits when it is done.
//!
//! * [`args`]: the commands and flags (clap);
//! * [`plan`]: each command's flags as its tool's arguments, checked before the app is reached;
//! * [`app`]: finding the app on the data folder (`cli.json`, `/health`), or starting it, and letting it go
//!   (`/app/done`);
//! * [`mcp`]: the MCP client (2025-06-18 over streamable HTTP), over [`http`], a small HTTP/1.1 client;
//! * [`output`]: what is printed; [`lang`]: in Chinese or English; [`paths`]: the data folder;
//!   [`interrupt`]: Ctrl-C.
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
use crate::mcp::{Limit, Limits, Session};
use crate::output::Out;
use crate::plan::Common;

include!(concat!(env!("OUT_DIR"), "/timeouts.rs"));

/// The exit codes.
pub mod exit {
    pub const OK: i32 = 0;
    /// The app answered an error (or what it answered could not be used).
    pub const TOOL: i32 = 1;
    /// The command was not right: an unknown command or flag, a value it does not take, a file not there, a tool the
    /// app does not have.
    pub const USAGE: i32 = 2;
    /// The app could not be reached or started, or needs setting up first.
    pub const APP: i32 = 3;
    /// No answer in time (the command line's limit, or the app's own for the tool).
    pub const TIMEOUT: i32 = 4;
    /// Ctrl-C.
    pub const INTERRUPTED: i32 = 130;
}

/// Why a command failed: its exit code, its kind (for `--json`: the app's own kind when it said one, `busy`,
/// `needs_setup`, …, else `usage`, `unreachable`, `timeout`, `interrupted`, …) and words for the user.
#[derive(Clone, Debug, PartialEq)]
pub struct Fail {
    code: i32,
    kind: String,
    message: String,
}

impl Fail {
    fn new(code: i32, kind: &str, message: impl Into<String>) -> Fail {
        Fail { code, kind: kind.to_string(), message: message.into() }
    }

    /// The command was not right (exit 2).
    pub fn usage(message: impl Into<String>) -> Fail {
        Fail::new(exit::USAGE, "usage", message)
    }

    /// The app could not be reached, started or used (exit 3).
    pub fn app(kind: &str, message: impl Into<String>) -> Fail {
        Fail::new(exit::APP, kind, message)
    }

    /// The app answered an error (exit 1).
    pub fn tool(kind: &str, message: impl Into<String>) -> Fail {
        Fail::new(exit::TOOL, kind, message)
    }

    /// No answer in time (exit 4).
    pub fn timeout(message: impl Into<String>) -> Fail {
        Fail::new(exit::TIMEOUT, "timeout", message)
    }

    /// Ctrl-C (exit 130).
    pub fn interrupted(message: impl Into<String>) -> Fail {
        Fail::new(exit::INTERRUPTED, "interrupted", message)
    }

    /// A failure of the app's own kind, as a tool's error result says it (`_meta["smedcover/error"]`): no page, the
    /// page gone, SmedCover not set up (exit 3); the app's own timeout (exit 4); any other (exit 1).
    pub fn of_kind(kind: &str, message: impl Into<String>) -> Fail {
        match kind {
            "not_ready" | "gone" | "needs_setup" => Fail::app(kind, message),
            "timeout" => Fail::timeout(message),
            _ => Fail::tool(kind, message),
        }
    }

    pub fn code(&self) -> i32 {
        self.code
    }

    pub fn kind(&self) -> &str {
        &self.kind
    }

    pub fn message(&self) -> &str {
        &self.message
    }

    /// As `--json` gives it: `{"kind", "message", "exit"}`.
    pub fn to_json(&self) -> Value {
        json!({"kind": self.kind, "message": self.message, "exit": self.code})
    }
}

/// Why a command stopped: a failure, or the app not reached before anything that changes something was sent (nothing done: it is
/// tried again, once).
enum Stop {
    Fail(Fail),
    Unreached(String),
}

impl From<Fail> for Stop {
    fn from(fail: Fail) -> Stop {
        Stop::Fail(fail)
    }
}

/// How long the app may go quiet on a tool it does not list in the table built in (one newer than this command line):
/// as long as any call may take, the app's own wait for it being the one that counts.
pub const UNKNOWN_TOOL_TIMEOUT: Duration = MAX_CALL;
/// The longest any call may take however often it says how it gets on (the endpoint's `MAX_TIMEOUT`).
pub const MAX_CALL: Duration = Duration::from_secs(2 * 60 * 60);
/// How much longer than the app the command line waits, so that the app's own answer, which says more, comes first.
pub const GRACE: Duration = Duration::from_secs(10);

/// How long the app may go quiet on `tool`, as ui/tools.json has it when this was built.
pub fn tool_timeout(tool: &str) -> Duration {
    TOOL_TIMEOUTS.iter().find(|(name, _, _)| *name == tool).map_or(UNKNOWN_TOOL_TIMEOUT, |(_, ms, _)| Duration::from_millis(*ms))
}

/// Whether `tool` only reads, as ui/tools.json says (`readOnlyHint`); one it does not list is taken to change something.
pub fn read_only(tool: &str) -> bool {
    TOOL_TIMEOUTS.iter().any(|(name, _, read_only)| *name == tool && *read_only)
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
    interrupt::install();
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(e) => {
            let _ = e.print();
            return e.exit_code();
        }
    };
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let selftest = std::env::var_os("SMEDCOVER_SELFTEST");
    let data = paths::data_folder(cli.data.as_deref(), selftest.as_deref(), &cwd);
    let lang = Lang::detect(data.as_ref().map(|(d, _)| d.as_path()));
    let out = Out::new(cli.json, cli.quiet, lang);
    if cli.data.as_ref().is_some_and(|d| !d.as_os_str().is_empty()) && data.as_ref().is_some_and(|(_, named)| !named) {
        out.note(lang.pick(
            "Note: SMEDCOVER_SELFTEST names the data folder, as it does the app's: --data (SMEDCOVER_DATA) is not used.",
            "注意：SMEDCOVER_SELFTEST 指定了数据文件夹（App 也用它），--data（SMEDCOVER_DATA）不起作用。",
        ));
    }
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
        Fail::app(
            "no_data_folder",
            lang.pick("This computer has no data folder for SmedCover: name one with --data DIR.", "这台电脑上没有 SmedCover 的数据文件夹：用 --data 目录 指定一个。"),
        )
    })?;
    // from here Ctrl-C stops the command in its own time: the call cancelled, the app let go
    interrupt::hold();
    if interrupt::requested() {
        return Err(Fail::interrupted(lang.pick("Interrupted.", "已中断。")));
    }
    let note = |text: &str| out.note(text);
    let opts = app::Opts { data: &data, data_named, lang, quiet: out.quiet, note: &note };
    let mut tried_again = false;
    loop {
        let mut app = app::connect(&opts)?;
        if !tried_again && !app.version.is_empty() && app.version != env!("CARGO_PKG_VERSION") {
            out.note(&lang.pick(
                format!("Note: SmedCover {} is running; this command line is {}.", app.version, env!("CARGO_PKG_VERSION")),
                format!("注意：运行中的 SmedCover 是 {}，命令行是 {}。", app.version, env!("CARGO_PKG_VERSION")),
            ));
        }
        let stopped = match Session::open(app.port, &app.token, timeout) {
            Ok(mut session) => perform(&job, &mut session, out, timeout),
            Err(e) => Err(opening(e, lang, timeout)),
        };
        app.finish();
        match stopped {
            Ok(()) => return Ok(()),
            Err(Stop::Fail(fail)) => return Err(fail),
            // the app went away (or was not the one cli.json said) before anything was asked of it: once more
            Err(Stop::Unreached(_)) if !tried_again => tried_again = true,
            Err(Stop::Unreached(why)) => return Err(unreachable(&why, lang)),
        }
    }
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
        fs::create_dir_all(&dir)
            .map_err(|e| Fail::usage(lang.pick(format!("Could not make the folder {}: {e}", dir.display()), format!("建不了文件夹 {}：{e}", dir.display()))))?;
        Ok(Some(dir))
    };
    Ok(match command {
        Command::Profiles => Job::Profiles,
        Command::Tools => Job::Tools,
        Command::Render { channel, profile, size, size_key, format: f, scale, output } => {
            let (target, dir) = plan::render_target(&output, cwd, lang)?;
            let format = plan::render_format(f.as_deref(), &target, lang)?;
            if channel.trim().is_empty() {
                return Err(Fail::usage(lang.pick("Name a channel.", "请指定频道。")));
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

/// A file's text, or the standard input's for `-`; text that is not UTF-8 refused, saying how to save it.
fn read_input(path: &Path, cwd: &Path, lang: Lang) -> Result<String, Fail> {
    let named = if path == Path::new("-") { None } else { Some(paths::absolute(path, cwd)) };
    let mut bytes = Vec::new();
    let read = match &named {
        None => std::io::stdin().read_to_end(&mut bytes).map(|_| ()),
        Some(path) => fs::read(path).map(|b| bytes = b),
    };
    let shown = named.as_deref().unwrap_or(Path::new("-")).display().to_string();
    read.map_err(|e| Fail::usage(lang.pick(format!("Could not read {shown}: {e}"), format!("读不了 {shown}：{e}"))))?;
    String::from_utf8(bytes).map_err(|_| {
        Fail::usage(lang.pick(
            format!("{shown} is not UTF-8 text: save it as \"CSV UTF-8\" (in Excel: Save As → CSV UTF-8; in Numbers: Export To → CSV, Unicode UTF-8)."),
            format!("{shown} 不是 UTF-8 文字：请另存为「CSV UTF-8」（Excel：另存为 → CSV UTF-8；Numbers：导出为 → CSV，Unicode UTF-8）。"),
        ))
    })
}

fn perform(job: &Job, session: &mut Session, out: &Out, timeout: Option<Duration>) -> Result<(), Stop> {
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
                Some(size) => size.clone(),
                None => plan::default_size(&structured(call(session, out, timeout, "get_context", json!({}))?), profile.as_deref(), lang)?,
            };
            let scratch = Scratch::new(dir, lang)?;
            let args = plan::render_args(channel, &size, profile.as_deref(), *format, *scale, &scratch.0);
            let result = structured(call(session, out, timeout, "export", args)?);
            stopped_part_way(&result, out)?;
            let files = output::files(&result);
            let [file] = files.as_slice() else {
                return Err(Fail::tool(
                    "malformed",
                    lang.pick(format!("The export wrote {} files, not one.", files.len()), format!("导出写了 {} 个文件，而不是一个。", files.len())),
                )
                .into());
            };
            let file = scratch.inside(Path::new(file)).ok_or_else(|| {
                Fail::tool(
                    "malformed",
                    lang.pick(
                        format!("The export said it wrote {file}, which is not in the folder it was given: it is left where it is."),
                        format!("导出说它写了 {file}，不在给它的文件夹里：没有动它。"),
                    ),
                )
            })?;
            fs::rename(&file, target).map_err(|e| {
                Fail::tool("failed", lang.pick(format!("Could not move the cover to {}: {e}", target.display()), format!("没能把封面移到 {}：{e}", target.display())))
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
            let result = structured(call(session, out, timeout, tool, args.clone())?);
            if out.json {
                // stopped part-way, the one document says so too, with the files written
                match stopped_part_way(&result, out) {
                    Ok(()) => out.json_value(&result),
                    Err(fail) => {
                        let mut said = result.clone();
                        said["error"] = fail.to_json();
                        out.json_value(&said);
                        return Err(fail.into());
                    }
                }
            } else {
                let files = output::files(&result);
                out.text(&files.join("\n"));
                out.note(&output::written(files.len(), result["dir"].as_str().unwrap_or(""), lang));
                stopped_part_way(&result, out)?;
            }
        }
        Job::Import(args) => {
            let result = structured(call(session, out, timeout, "open_project", args.clone())?);
            if out.json {
                out.json_value(&result);
            } else {
                out.text(&output::opened(&result, lang));
            }
        }
        Job::Tools => {
            let tools = session.list_tools().map_err(|e| from_mcp(e, lang, None, session.changes_sent()))?;
            if out.json {
                out.json_value(&Value::Array(tools));
            } else {
                out.text(&output::tools(&tools));
            }
        }
        Job::Call { tool, args, save_images } => {
            let result = call(session, out, timeout, tool, args.clone())?;
            let (text, shown) = output::call_result(&result, tool, save_images.as_deref(), lang)
                .map_err(|e| Fail::tool("failed", lang.pick(format!("Could not save the images: {e}"), format!("没能保存图片：{e}"))))?;
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
fn call(session: &mut Session, out: &Out, timeout: Option<Duration>, tool: &str, args: Value) -> Result<Value, Stop> {
    let lang = out.lang;
    let limits = limits(tool, timeout);
    let answer = session.call_tool(tool, args, limits, read_only(tool), &mut |p| out.progress(p));
    out.end_progress();
    let result = answer.map_err(|e| from_mcp(e, lang, Some((tool, limits)), session.changes_sent()))?;
    if result.get("isError").and_then(Value::as_bool) == Some(true) {
        let text = output::text_of(&result);
        let text = if text.is_empty() { lang.pick("The app answered an error.", "App 回答了一个错误。").to_string() } else { text };
        return Err(Fail::of_kind(output::error_kind(&result).unwrap_or("failed"), text).into());
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
fn stopped_part_way(result: &Value, out: &Out) -> Result<(), Fail> {
    if result["cancelled"] == true {
        return Err(Fail::tool("cancelled", out.lang.pick("The export was stopped part-way.", "导出中途停下了。")));
    }
    Ok(())
}

fn unreachable(why: &str, lang: Lang) -> Fail {
    Fail::app("unreachable", lang.pick(format!("Could not reach SmedCover: {why}"), format!("连不上 SmedCover：{why}")))
}

/// Why the session could not be opened: before any call, so the app is tried again, unless it is Ctrl-C or the time.
fn opening(e: mcp::Error, lang: Lang, timeout: Option<Duration>) -> Stop {
    match e {
        mcp::Error::Interrupted | mcp::Error::TimedOut(_) => {
            let total = timeout.map_or(Limits::SETUP.total, |t| t.min(Limits::SETUP.total));
            from_mcp(e, lang, Some(("initialize", Limits { quiet: Limits::SETUP.quiet.min(total), total })), 0)
        }
        mcp::Error::Rpc { message, .. } => Stop::Unreached(message),
        mcp::Error::Gone => Stop::Unreached(lang.pick("it went away", "它断开了").into()),
        mcp::Error::Refused(why) | mcp::Error::Unreachable(why) => Stop::Unreached(why),
    }
}

/// An MCP error in the user's words; `call`, the tool called and how long it was waited for; `sent`, how many calls of
/// tools that change something had been sent (none: the app not reached is tried again).
fn from_mcp(e: mcp::Error, lang: Lang, call: Option<(&str, Limits)>, sent: usize) -> Stop {
    match e {
        // nothing that changes anything sent yet: tried again (the reads done are only done again); once a change is sent, never
        mcp::Error::Refused(why) | mcp::Error::Unreachable(why) if sent == 0 => Stop::Unreached(why),
        mcp::Error::Refused(why) | mcp::Error::Unreachable(why) => Stop::Fail(unreachable(&why, lang)),
        mcp::Error::Gone => Stop::Fail(Fail::app(
            "gone",
            lang.pick(
                "SmedCover went away before it answered; what the call changed may or may not be done.",
                "SmedCover 没等回答就断开了；这次调用改的东西可能做了，也可能没做。",
            ),
        )),
        mcp::Error::Rpc { code, message } => Stop::Fail(match call {
            Some((tool, _)) if code == -32602 && message.starts_with("Unknown tool") => Fail::usage(lang.pick(
                format!("SmedCover has no tool \"{tool}\": `smedcover tools` lists them."),
                format!("SmedCover 没有工具「{tool}」：`smedcover tools` 列出全部工具。"),
            )),
            _ => Fail::tool("rpc", message),
        }),
        mcp::Error::TimedOut(limit) => {
            let l = call.map_or(Limits::SETUP, |(_, l)| l);
            Stop::Fail(Fail::timeout(match limit {
                Limit::Total => lang.pick(
                    format!("No answer within --timeout {:.0} s: the call was cancelled. What it changed so far stays (undo it in the window).", l.total.as_secs_f64()),
                    format!("--timeout 的 {:.0} 秒内没有回答：这次调用已取消。它已经改了的留着（可以在窗口里撤销）。", l.total.as_secs_f64()),
                ),
                Limit::Quiet => lang.pick(
                    format!("No word from SmedCover for {:.0} s: the call was cancelled. What it changed so far stays (undo it in the window).", l.quiet.as_secs_f64()),
                    format!("SmedCover {:.0} 秒没有动静：这次调用已取消。它已经改了的留着（可以在窗口里撤销）。", l.quiet.as_secs_f64()),
                ),
            }))
        }
        mcp::Error::Interrupted => Stop::Fail(Fail::interrupted(lang.pick("Interrupted: the call was cancelled.", "已中断：这次调用已取消。"))),
    }
}

/// A folder of `render`'s own beside the file it writes, which the export writes into, removed when it is done (and
/// by a second Ctrl-C, which exits at once).
struct Scratch(PathBuf);

impl Scratch {
    fn new(beside: &Path, lang: Lang) -> Result<Scratch, Fail> {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
        let mut last = None;
        for n in 0..100u32 {
            let dir = beside.join(format!(".smedcover-render-{}-{stamp:x}-{n}", std::process::id()));
            match fs::create_dir(&dir) {
                Ok(()) => {
                    interrupt::scratch(Some(dir.clone()));
                    return Ok(Scratch(dir));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => {
                    last = Some(e);
                    break;
                }
            }
        }
        let e = last.map_or_else(|| "no free name".to_string(), |e| e.to_string());
        Err(Fail::usage(lang.pick(format!("Could not write into {}: {e}", beside.display()), format!("写不进 {}：{e}", beside.display()))))
    }

    /// `file` if it is a file of this folder's own (not a link, not elsewhere), as the export was asked to write.
    fn inside(&self, file: &Path) -> Option<PathBuf> {
        let meta = fs::symlink_metadata(file).ok()?;
        let parent = fs::canonicalize(file.parent()?).ok()?;
        (meta.is_file() && parent == fs::canonicalize(&self.0).ok()?).then(|| file.to_path_buf())
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        interrupt::scratch(None);
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
        // one newer than this command line: the app's own wait is the one that counts
        assert_eq!(tool_timeout("not_a_tool"), MAX_CALL);
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
    fn as_the_core_has_it() {
        assert_eq!(MAX_CALL, smedcover_core::mcp::tools::MAX_TIMEOUT);
        assert_eq!(app::ALREADY_RUNNING, smedcover_core::instance::EXIT_ALREADY_RUNNING);
        assert_eq!(app::CLI_JSON, smedcover_core::instance::CLI_FILE);
        assert_eq!(app::FORMAT, smedcover_core::instance::CLI_FORMAT);
        assert_eq!(smedcover_core::mcp::server::ERROR_META, "smedcover/error");
    }

    #[test]
    fn each_kind_its_exit_code() {
        for (kind, code) in [
            ("not_ready", exit::APP),
            ("gone", exit::APP),
            ("needs_setup", exit::APP),
            ("timeout", exit::TIMEOUT),
            ("busy", exit::TOOL),
            ("invalid_arguments", exit::TOOL),
            ("not_allowed", exit::TOOL),
            ("unavailable", exit::TOOL),
            ("failed", exit::TOOL),
            ("cancelled", exit::TOOL),
            ("too_many", exit::TOOL),
            ("malformed", exit::TOOL),
        ] {
            let f = Fail::of_kind(kind, "x");
            assert_eq!((f.code(), f.kind()), (code, kind), "{kind}");
        }
        // every kind the core gives is one of those
        use smedcover_core::mcp::server::error_kind;
        use smedcover_core::mcp::BridgeError;
        for e in [BridgeError::NotReady, BridgeError::PageGone("x".into()), BridgeError::Timeout, BridgeError::Cancelled, BridgeError::TooMany, BridgeError::Malformed("x".into())] {
            assert!(["not_ready", "gone", "timeout", "cancelled", "too_many", "malformed"].contains(&error_kind(&e)), "{e:?}");
        }
        assert_eq!(Fail::usage("x").to_json(), json!({"kind": "usage", "message": "x", "exit": 2}));
    }

    fn failed(stop: Stop) -> Fail {
        match stop {
            Stop::Fail(f) => f,
            Stop::Unreached(why) => panic!("tried again: {why}"),
        }
    }

    #[test]
    fn errors_in_words_and_codes() {
        let unknown = mcp::Error::Rpc { code: -32602, message: "Unknown tool: nope".into() };
        let fail = failed(from_mcp(unknown, Lang::En, Some(("nope", super::limits("nope", None))), 1));
        assert_eq!(fail.code(), exit::USAGE);
        assert!(fail.message().contains("smedcover tools"));
        assert_eq!(failed(from_mcp(mcp::Error::Rpc { code: -32603, message: "boom".into() }, Lang::En, None, 1)).code(), exit::TOOL);
        assert_eq!(failed(from_mcp(mcp::Error::Gone, Lang::En, None, 1)).kind(), "gone");
        assert_eq!(failed(from_mcp(mcp::Error::Unreachable("refused".into()), Lang::Zh, None, 1)).message(), "连不上 SmedCover：refused");
        let l = Limits { quiet: Duration::from_secs(2), total: Duration::from_secs(9) };
        let quiet = failed(from_mcp(mcp::Error::TimedOut(Limit::Quiet), Lang::En, Some(("x", l)), 1));
        assert_eq!(quiet.code(), exit::TIMEOUT);
        assert!(quiet.message().starts_with("No word from SmedCover for 2 s"), "{}", quiet.message());
        let total = failed(from_mcp(mcp::Error::TimedOut(Limit::Total), Lang::En, Some(("x", l)), 1));
        assert!(total.message().starts_with("No answer within --timeout 9 s"), "{}", total.message());
        assert_eq!(failed(from_mcp(mcp::Error::Interrupted, Lang::En, None, 0)).code(), exit::INTERRUPTED);
    }

    #[test]
    fn only_a_failure_before_any_call_is_tried_again() {
        // nothing sent yet: the app not reached is tried again
        assert!(matches!(from_mcp(mcp::Error::Refused("refused".into()), Lang::En, Some(("x", Limits::SETUP)), 0), Stop::Unreached(_)));
        assert!(matches!(opening(mcp::Error::Unreachable("401".into()), Lang::En, None), Stop::Unreached(_)));
        assert!(matches!(opening(mcp::Error::Rpc { code: -32600, message: "no".into() }, Lang::En, None), Stop::Unreached(_)));
        // a call sent: never, whatever came of it
        assert!(matches!(from_mcp(mcp::Error::Refused("refused".into()), Lang::En, Some(("x", Limits::SETUP)), 1), Stop::Fail(_)));
        assert!(matches!(from_mcp(mcp::Error::Gone, Lang::En, Some(("x", Limits::SETUP)), 1), Stop::Fail(_)));
        assert!(matches!(opening(mcp::Error::Interrupted, Lang::En, None), Stop::Fail(_)));
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
        let usage = |args: &[&str]| match job(args) {
            Err(f) if f.code() == exit::USAGE => f.message().to_string(),
            Err(f) => panic!("{args:?}: {f:?}"),
            Ok(_) => panic!("{args:?} should be refused"),
        };
        assert!(usage(&["render", "1", "-o", "nowhere/x.png"]).contains("No such folder"));
        usage(&["render", "1", "-o", "x.jpg", "--format", "webp"]);
        assert!(usage(&["render", " ", "-o", "x.png"]).contains("channel"));
        usage(&["export", "--channels", "a,,b"]);
        assert!(usage(&["batch", "missing.csv"]).contains("missing.csv"));
        usage(&["import", "missing.smedcover.json"]);
        usage(&["call", "set_text", "[1]"]);
        // a CSV that is not UTF-8 (one saved as GBK, or Latin-1)
        fs::write(cwd.join("gbk.csv"), b"\xc6\xb5\xb5\xc0,\xb1\xea\xcc\xe2\n").unwrap();
        assert!(usage(&["batch", "gbk.csv"]).contains("CSV UTF-8"));
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
    fn scratch_goes_when_done_and_takes_only_its_own() {
        let dir = tempfile::tempdir().unwrap();
        let scratch = Scratch::new(dir.path(), Lang::En).unwrap();
        let inside = scratch.0.clone();
        fs::write(inside.join("a.png"), "x").unwrap();
        fs::write(dir.path().join("elsewhere.png"), "x").unwrap();
        assert!(inside.is_dir() && inside.starts_with(dir.path()));
        assert!(scratch.inside(&inside.join("a.png")).is_some());
        assert!(scratch.inside(&dir.path().join("elsewhere.png")).is_none(), "not in it");
        assert!(scratch.inside(&inside.join("..").join("elsewhere.png")).is_none(), "not in it, by another way");
        assert!(scratch.inside(&inside.join("missing.png")).is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("elsewhere.png"), inside.join("link.png")).unwrap();
            assert!(scratch.inside(&inside.join("link.png")).is_none(), "a link to elsewhere");
        }
        drop(scratch);
        assert!(!inside.exists());
    }
}
