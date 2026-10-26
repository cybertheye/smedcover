//! Finding the app, or starting it, and letting it go: the command line's side of the contract with the app.
//!
//! - While the app runs it serves its tools on a port of its own for the command line, wanting a token of its own,
//!   and says where in `cli.json` in the data folder: `{"format": 1, "pid", "port", "token", "version", "launchedBy":
//!   "user" | "cli", "ready"}`. `GET /health` there (with the token) says `{"name": "smedcover", "version", "page",
//!   "ready", "needsSetup"}`. A `cli.json` whose process is gone, whose port refuses, or whose `/health` is not
//!   SmedCover's with that token is stale: no app.
//! - With no app running, the command line starts one: `smedcover-app --cli`, beside its own executable (links
//!   followed) or `SMEDCOVER_APP`, with its standard input a pipe held open while it works (the app quits when it
//!   reaches its end: the command line gone), its output to nothing (or `logs/cli-app.log`, when the data folder has a
//!   `logs/`), the environment passed on (and `SMEDCOVER_DATA`, when a data folder was named), and out of the
//!   terminal's reach for Ctrl-C (a process group of its own), which the command line handles. It waits for `ready`
//!   (polling every 100 ms, 30 s at most).
//! - An app started so that finds another already running on the folder exits with [`ALREADY_RUNNING`]: the command
//!   line then waits for that one instead. One that quits otherwise before it is ready is waited for no longer.
//! - `needsSetup` (no profile yet: the app shows its first-run welcome): nothing can be done; exit 3.
//! - Done (or interrupted), the command line that started the app says so, `POST /app/done` (the app saves what it
//!   has to and quits, unless the user has opened its window since), lets go of its standard input and waits a moment
//!   for it to go, so that the next command does not find it on its way out. An app it did not start it leaves alone.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::http::{self, Request};
use crate::interrupt;
use crate::lang::Lang;
use crate::mcp::user_agent;
use crate::Fail;

/// The file the running app says where it is in.
pub const CLI_JSON: &str = "cli.json";
/// The version of its format this reads.
pub const FORMAT: u64 = 1;
/// The exit code of an app started with `--cli` that found another already running on its data folder.
pub const ALREADY_RUNNING: i32 = 75;
/// How long an app is waited for until it is ready.
pub const LAUNCH_WAIT: Duration = Duration::from_secs(30);
/// How often it is looked at meanwhile.
pub const POLL: Duration = Duration::from_millis(100);
/// How long `/health` may take.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
/// How long `/app/done` may take (the app saves what it has to first), and the app to go after it.
const DONE_TIMEOUT: Duration = Duration::from_secs(10);
const GONE_WAIT: Duration = Duration::from_secs(10);

/// What `cli.json` says.
#[derive(Clone, Debug, PartialEq)]
pub struct CliJson {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub version: String,
    pub launched_by: String,
    pub ready: bool,
}

impl CliJson {
    pub fn parse(text: &str) -> Result<CliJson, String> {
        let v: Value = serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
        match v.get("format").and_then(Value::as_u64) {
            Some(FORMAT) => {}
            other => return Err(format!("format {} (this reads {FORMAT})", other.map_or("none".into(), |f| f.to_string()))),
        }
        let pid = v.get("pid").and_then(Value::as_u64).and_then(|p| u32::try_from(p).ok()).filter(|p| *p > 0).ok_or("no pid")?;
        let port = v.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).filter(|p| *p > 0).ok_or("no port")?;
        let token = v.get("token").and_then(Value::as_str).filter(|t| !t.is_empty()).ok_or("no token")?.to_string();
        Ok(CliJson {
            pid,
            port,
            token,
            version: v.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
            launched_by: v.get("launchedBy").and_then(Value::as_str).unwrap_or("").to_string(),
            ready: v.get("ready").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

/// `cli.json` in `data`: `None` when there is none, else what it says or why it cannot be read.
pub fn read_cli_json(data: &Path) -> Option<Result<CliJson, String>> {
    match fs::read_to_string(data.join(CLI_JSON)) {
        Ok(text) => Some(CliJson::parse(&text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => Some(Err(e.to_string())),
    }
}

/// What `/health` says.
#[derive(Clone, Debug, PartialEq)]
pub struct Health {
    pub version: String,
    pub page: String,
    pub ready: bool,
    pub needs_setup: bool,
}

/// Asks the app on `port` how it is, with its token; an error when it is not SmedCover answering with that token.
pub fn health(port: u16, token: &str) -> Result<Health, String> {
    let req = Request {
        method: "GET",
        path: "/health",
        headers: vec![("Authorization", format!("Bearer {token}")), ("User-Agent", user_agent())],
        body: b"",
    };
    let (status, _, body) = http::exchange(port, &req, HEALTH_TIMEOUT).map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("HTTP {status}"));
    }
    let v: Value = serde_json::from_slice(&body).map_err(|e| e.to_string())?;
    if v.get("name").and_then(Value::as_str) != Some("smedcover") {
        return Err("not SmedCover".into());
    }
    let page = v.get("page").and_then(Value::as_str).unwrap_or("").to_string();
    Ok(Health {
        version: v.get("version").and_then(Value::as_str).unwrap_or("").to_string(),
        ready: v.get("ready").and_then(Value::as_bool).unwrap_or(page == "ready"),
        needs_setup: v.get("needsSetup").and_then(Value::as_bool).unwrap_or(false),
        page,
    })
}

/// Whether the process `pid` is there. On Windows this is left to `/health`: a process gone has no port either.
pub fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let Ok(pid) = libc::pid_t::try_from(pid) else {
            return false;
        };
        if pid <= 0 {
            return false;
        }
        // SAFETY: signal 0 sends nothing; it only asks whether the process is there
        if unsafe { libc::kill(pid, 0) } == 0 {
            return true;
        }
        // there, but another user's
        std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
    }
    #[cfg(not(unix))]
    {
        pid > 0
    }
}

/// The app's executable: `SMEDCOVER_APP`, else `smedcover-app` beside this executable (a link to it followed, as
/// the one on the PATH is).
pub fn app_executable() -> Result<PathBuf, String> {
    if let Some(app) = env::var_os("SMEDCOVER_APP").filter(|a| !a.is_empty()) {
        return Ok(PathBuf::from(app));
    }
    let me = env::current_exe().map_err(|e| e.to_string())?;
    let me = fs::canonicalize(&me).unwrap_or(me);
    Ok(me.with_file_name(format!("smedcover-app{}", env::consts::EXE_SUFFIX)))
}

/// The app being worked with, and whether this command started it.
pub struct AppLink {
    pub port: u16,
    pub token: String,
    pub version: String,
    data: PathBuf,
    started: Option<Started>,
    finished: bool,
}

/// An app this command started: the process, and the pipe to its standard input, held while it works.
struct Started {
    child: Child,
    stdin: Option<ChildStdin>,
}

/// What the data folder's `cli.json` leads to.
enum Probe {
    /// No app (or a stale `cli.json`).
    None,
    /// An app, not ready yet.
    Starting,
    /// An app ready, or that needs setting up.
    Ready(CliJson, Health),
}

fn probe(data: &Path) -> Probe {
    let Some(Ok(cli)) = read_cli_json(data) else {
        return Probe::None;
    };
    if !pid_alive(cli.pid) {
        return Probe::None;
    }
    match health(cli.port, &cli.token) {
        Ok(h) if h.ready || h.needs_setup => Probe::Ready(cli, h),
        Ok(_) => Probe::Starting,
        Err(_) => Probe::None,
    }
}

/// How the app is reached: the data folder, whether it was named, how to speak and whether to say what is going on.
pub struct Opts<'a> {
    pub data: &'a Path,
    pub data_named: bool,
    pub lang: Lang,
    pub quiet: bool,
    /// Told what the command line is doing (starting the app).
    pub note: &'a dyn Fn(&str),
}

/// The app running on the data folder, ready for calls; started first if there is none.
pub fn connect(o: &Opts) -> Result<AppLink, Fail> {
    let lang = o.lang;
    let mut started = match probe(o.data) {
        Probe::Ready(cli, h) => return ready(o, cli, h, None),
        Probe::Starting => None,
        Probe::None => {
            let s = start(o)?;
            if !o.quiet {
                (o.note)(lang.pick("Starting SmedCover…", "正在启动 SmedCover…"));
            }
            Some(s)
        }
    };
    let deadline = Instant::now() + LAUNCH_WAIT;
    loop {
        if interrupt::requested() {
            // its standard input closed as `started` goes: it quits
            return Err(Fail::Interrupted(lang.pick("Interrupted.".into(), "已中断。".into())));
        }
        if let Some(s) = started.as_mut() {
            if let Ok(Some(status)) = s.child.try_wait() {
                started = None;
                if status.code() != Some(ALREADY_RUNNING) {
                    // it quit: unless another took the folder meanwhile, there is nothing to wait for
                    return match probe(o.data) {
                        Probe::Ready(cli, h) => ready(o, cli, h, None),
                        _ => Err(Fail::App(lang.pick(
                            format!("SmedCover quit before it was ready ({status})."),
                            format!("SmedCover 没等就绪就退出了（{status}）。"),
                        ))),
                    };
                }
                // another app runs on this folder: it is the one waited for
            }
        }
        if let Probe::Ready(cli, h) = probe(o.data) {
            // the app answering is this command's only if it is the process it started
            let ours = started.take().filter(|s| s.child.id() == cli.pid);
            return ready(o, cli, h, ours);
        }
        if Instant::now() >= deadline {
            let why = match read_cli_json(o.data) {
                Some(Err(e)) => lang.pick(format!(" ({CLI_JSON}: {e})"), format!("（{CLI_JSON}：{e}）")),
                _ => String::new(),
            };
            return Err(Fail::App(lang.pick(
                format!("SmedCover was not ready within {} seconds{why}.", LAUNCH_WAIT.as_secs()),
                format!("SmedCover {} 秒内没有就绪{why}。", LAUNCH_WAIT.as_secs()),
            )));
        }
        thread::sleep(POLL);
    }
}

/// The app found ready, unless it needs setting up first.
fn ready(o: &Opts, cli: CliJson, h: Health, started: Option<Started>) -> Result<AppLink, Fail> {
    let mut link = AppLink { port: cli.port, token: cli.token, version: h.version, data: o.data.to_path_buf(), started, finished: false };
    if h.needs_setup {
        link.finish();
        return Err(Fail::App(o.lang.pick(
            "Open SmedCover once and finish setting it up, then try again.".into(),
            "请先打开 SmedCover，完成首次设置，然后再试。".into(),
        )));
    }
    Ok(link)
}

/// Starts the app for this command (see the module's notes).
fn start(o: &Opts) -> Result<Started, Fail> {
    let lang = o.lang;
    let exe = app_executable().map_err(|e| Fail::App(lang.pick(format!("Could not find the SmedCover app: {e}"), format!("找不到 SmedCover App：{e}"))))?;
    if !exe.is_file() {
        return Err(Fail::App(lang.pick(
            format!("Could not find the SmedCover app at {}. Set SMEDCOVER_APP to its executable.", exe.display()),
            format!("在 {} 找不到 SmedCover App。请把 SMEDCOVER_APP 设成它的可执行文件。", exe.display()),
        )));
    }
    let mut cmd = Command::new(&exe);
    cmd.arg("--cli").stdin(Stdio::piped());
    match log_file(o.data) {
        Some((out, err)) => cmd.stdout(out).stderr(err),
        None => cmd.stdout(Stdio::null()).stderr(Stdio::null()),
    };
    if o.data_named {
        cmd.env("SMEDCOVER_DATA", o.data);
    }
    own_group(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| {
        Fail::App(lang.pick(format!("Could not start SmedCover ({}): {e}", exe.display()), format!("启动不了 SmedCover（{}）：{e}", exe.display())))
    })?;
    let stdin = child.stdin.take();
    Ok(Started { child, stdin })
}

/// `logs/cli-app.log` in the data folder, for the app's output, when the folder has a `logs/`.
fn log_file(data: &Path) -> Option<(fs::File, fs::File)> {
    let dir = data.join("logs");
    if !dir.is_dir() {
        return None;
    }
    let out = fs::OpenOptions::new().create(true).append(true).open(dir.join("cli-app.log")).ok()?;
    let err = out.try_clone().ok()?;
    Some((out, err))
}

/// Keeps the terminal's Ctrl-C from the app: the command line cancels its call and lets it go itself.
#[cfg(unix)]
fn own_group(cmd: &mut Command) {
    use std::os::unix::process::CommandExt;
    cmd.process_group(0);
}

#[cfg(windows)]
fn own_group(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    cmd.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
fn own_group(_: &mut Command) {}

impl AppLink {
    /// Whether this command started the app.
    pub fn started_here(&self) -> bool {
        self.started.is_some()
    }

    /// Lets go of the app: if this command started it, says it is done, closes its standard input and waits a moment
    /// for it to go (unless the user has opened its window since: it stays). Once.
    pub fn finish(&mut self) {
        if std::mem::replace(&mut self.finished, true) {
            return;
        }
        let Some(mut started) = self.started.take() else {
            return;
        };
        let req = Request {
            method: "POST",
            path: "/app/done",
            headers: vec![("Authorization", format!("Bearer {}", self.token)), ("User-Agent", user_agent())],
            body: b"",
        };
        let _ = http::exchange(self.port, &req, DONE_TIMEOUT);
        drop(started.stdin.take());
        if read_cli_json(&self.data).and_then(Result::ok).is_some_and(|c| c.launched_by == "user") {
            return;
        }
        let until = Instant::now() + GONE_WAIT;
        while Instant::now() < until {
            match started.child.try_wait() {
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                _ => return,
            }
        }
    }
}

impl Drop for AppLink {
    fn drop(&mut self) {
        self.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_cli_json() {
        let cli = CliJson::parse(r#"{"format": 1, "pid": 12345, "port": 51234, "token": "smc_x", "version": "0.3.1", "launchedBy": "cli", "ready": true}"#).unwrap();
        assert_eq!(
            cli,
            CliJson { pid: 12345, port: 51234, token: "smc_x".into(), version: "0.3.1".into(), launched_by: "cli".into(), ready: true }
        );
        // what may be left out
        let cli = CliJson::parse(r#"{"format": 1, "pid": 1, "port": 2, "token": "t"}"#).unwrap();
        assert!(!cli.ready && cli.launched_by.is_empty());
        for (text, why) in [
            ("{", "not JSON"),
            (r#"{"format": 2, "pid": 1, "port": 2, "token": "t"}"#, "format 2"),
            (r#"{"pid": 1, "port": 2, "token": "t"}"#, "format none"),
            (r#"{"format": 1, "port": 2, "token": "t"}"#, "no pid"),
            (r#"{"format": 1, "pid": 1, "port": 70000, "token": "t"}"#, "no port"),
            (r#"{"format": 1, "pid": 1, "port": 2, "token": ""}"#, "no token"),
        ] {
            let e = CliJson::parse(text).unwrap_err();
            assert!(e.contains(why), "{text}: {e}");
        }
    }

    #[test]
    fn no_cli_json_is_no_app() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_cli_json(dir.path()).is_none());
        assert!(matches!(probe(dir.path()), Probe::None));
        fs::write(dir.path().join(CLI_JSON), "garbage").unwrap();
        assert!(matches!(read_cli_json(dir.path()), Some(Err(_))));
        assert!(matches!(probe(dir.path()), Probe::None));
    }

    #[cfg(unix)]
    #[test]
    fn tells_a_process_there_from_one_gone() {
        assert!(pid_alive(std::process::id()));
        let mut child = Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        assert!(!pid_alive(pid));
        assert!(!pid_alive(0));
        assert!(!pid_alive(u32::MAX));
    }
}
