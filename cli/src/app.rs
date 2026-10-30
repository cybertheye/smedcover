//! Finding the app, or starting it, and letting it go: the command line's side of the contract with the app
//! (ARCHITECTURE.md 10.7 has the app's).
//!
//! - While the app runs it serves its tools on a port of its own for the command line, wanting a token of its own,
//!   and says where in `cli.json` in the data folder: `{"format": 1, "pid", "port", "token", "version", "launchedBy":
//!   "user" | "cli", "ready", "quitting"}`, readable by its owner alone. `GET /health` there (with the token) says `{"name":
//!   "smedcover", "version", "page", "ready", "needsSetup"}`. A `cli.json` whose process is gone, whose port refuses,
//!   or whose `/health` is not SmedCover's with that token is stale: no app. One that is not the user's own, or that
//!   others may read, is not taken at all.
//! - With no app running, the command line starts one: `smedcover-app --cli`, beside its own executable (links
//!   followed; on macOS, else in `/Applications/SmedCover.app`), or the one an `app-path` file beside it names (the
//!   copy on Windows' PATH), or `SMEDCOVER_APP`, with its standard input a pipe
//!   held open while it works (the app quits when it reaches its end: the command line gone), its output to nothing
//!   (or `logs/cli-app.log`, when the data folder has a `logs/`), the environment passed on (and `SMEDCOVER_DATA`,
//!   when a data folder was named), and out of the terminal's reach for Ctrl-C (a process group of its own), which the
//!   command line handles. It waits for `ready` (polling every 100 ms, 30 s at most).
//! - An app started so that finds another already running on the folder exits with [`ALREADY_RUNNING`]: the command
//!   line then waits for that one instead. One that quits otherwise before it is ready is waited for no longer. When
//!   the app waited for goes away before it is ready (it was quitting, or was closed), the command line starts one,
//!   once.
//! - `needsSetup` (no profile yet: the app waits on its first start's welcome): nothing can be done; exit 3.
//! - Done (or interrupted), the command line that started the app says so, `POST /app/done`, and lets go of its
//!   standard input, without waiting for the app to go. The app quits once no call has been in hand and none has come
//!   for 2 s, after saving what it has to; till then its `cli.json` says `quitting: true`, and the next command uses it
//!   as any other (each request putting the quitting off), so commands run one after another share one app. Unless
//!   the user has opened its window since: then it is theirs and stays. An app it did not start it leaves alone, and
//!   one that goes between two of its calls, before anything that changes something was sent, it reaches again once.

use std::env;
use std::fmt;
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
/// The exit code of an app started with `--cli` that found another already running on its data folder (the core's
/// `instance::EXIT_ALREADY_RUNNING`).
pub const ALREADY_RUNNING: i32 = 75;
/// How long an app is waited for until it is ready (an app started finds another quitting and waits up to 10 s for
/// it first).
pub const LAUNCH_WAIT: Duration = Duration::from_secs(30);
/// How often it is looked at meanwhile.
pub const POLL: Duration = Duration::from_millis(100);
/// Where the app is on macOS when it is not beside the command line.
pub const MAC_APP: &str = "/Applications/SmedCover.app/Contents/MacOS/smedcover-app";
/// How large `logs/cli-app.log` may grow before it is set aside as `cli-app.log.1` (one of those is kept).
pub const MAX_LOG: u64 = 1024 * 1024;
/// How long `/health` may take.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);
/// How long `/app/done` may take.
const DONE_TIMEOUT: Duration = Duration::from_secs(5);

/// What `cli.json` says. Its `Debug` does not show the token.
#[derive(Clone, PartialEq)]
pub struct CliJson {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub version: String,
    pub launched_by: String,
    pub ready: bool,
    /// The app is told the command line that started it is done, and quits once nothing has come for a moment;
    /// till then it is used as any other (each request puts its quitting off).
    pub quitting: bool,
}

impl fmt::Debug for CliJson {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CliJson")
            .field("pid", &self.pid)
            .field("port", &self.port)
            .field("token", &"…")
            .field("version", &self.version)
            .field("launched_by", &self.launched_by)
            .field("ready", &self.ready)
            .field("quitting", &self.quitting)
            .finish()
    }
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
            quitting: v.get("quitting").and_then(Value::as_bool).unwrap_or(false),
        })
    }
}

/// `cli.json` in `data`: `None` when there is none, else what it says or why it cannot be taken.
pub fn read_cli_json(data: &Path) -> Option<Result<CliJson, String>> {
    let path = data.join(CLI_JSON);
    match fs::read_to_string(&path) {
        Ok(text) => Some(private(&path).and_then(|()| CliJson::parse(&text))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => Some(Err(e.to_string())),
    }
}

/// On Unix, a `cli.json` is taken only when it is the user's own and no one else may read or change it, as the app
/// writes it (it holds the token): one that is not could be another's, set to lead the command line elsewhere.
#[cfg(unix)]
fn private(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    // SAFETY: no arguments; it reads the process's effective user id
    let me = unsafe { libc::geteuid() };
    if meta.uid() != me {
        return Err("it is not this user's own".into());
    }
    if meta.mode() & 0o077 != 0 {
        return Err(format!("others may read or change it (mode {:o})", meta.mode() & 0o777));
    }
    Ok(())
}

#[cfg(not(unix))]
fn private(_: &Path) -> Result<(), String> {
    Ok(())
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

/// The app's executable: `SMEDCOVER_APP`, else the one an [`APP_PATH`] file beside this executable names, else
/// `smedcover-app` beside this executable (a link to it followed, as the one on the PATH is), else, on macOS, the one
/// in `/Applications`.
pub fn app_executable() -> Result<PathBuf, String> {
    let me = env::current_exe().map_err(|e| e.to_string())?;
    let me = fs::canonicalize(&me).unwrap_or(me);
    Ok(app_executable_for(&me, env::var_os("SMEDCOVER_APP"), cfg!(target_os = "macos").then_some(Path::new(MAC_APP))))
}

/// The file beside a copy of the command line that names the app's executable (its whole path, as text): the copy
/// Settings → Agents puts on the PATH on Windows, in a folder of its own (the app's `install.rs`), which has no app
/// beside it.
pub const APP_PATH: &str = "app-path";

/// [`app_executable`] for the command line at `me` (links followed), `SMEDCOVER_APP` as `from_env`, and the place the
/// app is looked for last (`/Applications` on macOS): an `app-path` file beside `me` is taken as it names the app, there
/// or not (the error then says where it was looked for).
fn app_executable_for(me: &Path, from_env: Option<std::ffi::OsString>, last: Option<&Path>) -> PathBuf {
    if let Some(app) = from_env.filter(|a| !a.is_empty()) {
        return PathBuf::from(app);
    }
    if let Ok(named) = fs::read_to_string(me.with_file_name(APP_PATH)) {
        if !named.trim().is_empty() {
            return PathBuf::from(named.trim());
        }
    }
    let beside = me.with_file_name(format!("smedcover-app{}", env::consts::EXE_SUFFIX));
    match last {
        Some(last) if !beside.is_file() && last.is_file() => last.to_path_buf(),
        _ => beside,
    }
}

/// The app being worked with, and whether this command started it.
pub struct AppLink {
    pub port: u16,
    pub token: String,
    pub version: String,
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

fn interrupted(lang: Lang) -> Fail {
    Fail::interrupted(lang.pick("Interrupted.", "已中断。"))
}

/// The app running on the data folder, ready for calls; started first if there is none.
pub fn connect(o: &Opts) -> Result<AppLink, Fail> {
    let lang = o.lang;
    if interrupt::requested() {
        return Err(interrupted(lang));
    }
    let mut started = match probe(o.data) {
        Probe::Ready(cli, h) => return ready(o, cli, h, None),
        Probe::Starting => None,
        Probe::None => Some(start(o)?),
    };
    // one more start, when the app waited for goes away before it is ready
    let mut restarted = false;
    let mut deadline = Instant::now() + LAUNCH_WAIT;
    loop {
        if interrupt::requested() {
            // its standard input closed as `started` goes: it quits
            return Err(interrupted(lang));
        }
        if let Some(s) = started.as_mut() {
            if let Ok(Some(status)) = s.child.try_wait() {
                started = None;
                if status.code() != Some(ALREADY_RUNNING) {
                    // it quit: unless another took the folder meanwhile, there is nothing to wait for
                    return match probe(o.data) {
                        Probe::Ready(cli, h) => ready(o, cli, h, None),
                        _ => Err(Fail::app(
                            "quit",
                            lang.pick(format!("SmedCover quit before it was ready ({status})."), format!("SmedCover 没等就绪就退出了（{status}）。")),
                        )),
                    };
                }
                // another app runs on this folder: it is the one waited for
            }
        }
        match probe(o.data) {
            Probe::Ready(cli, h) => {
                // the app answering is this command's only if it is the process it started
                let ours = started.take().filter(|s| s.child.id() == cli.pid);
                return ready(o, cli, h, ours);
            }
            Probe::None if started.is_none() && !restarted => {
                // the app waited for is gone (or, having taken the folder, has not said where it is yet: the app
                // started now waits for it, then takes the folder once it has gone)
                restarted = true;
                if interrupt::requested() {
                    return Err(interrupted(lang));
                }
                started = Some(start(o)?);
                deadline = Instant::now() + LAUNCH_WAIT;
            }
            _ => {}
        }
        if Instant::now() >= deadline {
            let why = match read_cli_json(o.data) {
                Some(Err(e)) => lang.pick(format!(" ({CLI_JSON}: {e})"), format!("（{CLI_JSON}：{e}）")),
                _ => String::new(),
            };
            return Err(Fail::app(
                "not_ready",
                lang.pick(
                    format!("SmedCover was not ready within {} seconds{why}.", LAUNCH_WAIT.as_secs()),
                    format!("SmedCover {} 秒内没有就绪{why}。", LAUNCH_WAIT.as_secs()),
                ),
            ));
        }
        thread::sleep(POLL);
    }
}

/// The app found ready, unless it needs setting up first.
fn ready(o: &Opts, cli: CliJson, h: Health, started: Option<Started>) -> Result<AppLink, Fail> {
    let mut link = AppLink { port: cli.port, token: cli.token, version: h.version, started, finished: false };
    if h.needs_setup {
        link.finish();
        return Err(needs_setup(o.lang));
    }
    Ok(link)
}

/// What the command line says when the app waits on its first start's welcome.
pub fn needs_setup(lang: Lang) -> Fail {
    Fail::app(
        "needs_setup",
        lang.pick("Open SmedCover once and finish setting it up, then try again.", "请先打开 SmedCover，完成首次设置，然后再试。"),
    )
}

/// Starts the app for this command (see the module's notes).
fn start(o: &Opts) -> Result<Started, Fail> {
    let lang = o.lang;
    let exe = app_executable()
        .map_err(|e| Fail::app("no_app", lang.pick(format!("Could not find the SmedCover app: {e}"), format!("找不到 SmedCover App：{e}"))))?;
    if !exe.is_file() {
        return Err(Fail::app(
            "no_app",
            lang.pick(
                format!("Could not find the SmedCover app at {}. Set SMEDCOVER_APP to its executable.", exe.display()),
                format!("在 {} 找不到 SmedCover App。请把 SMEDCOVER_APP 设成它的可执行文件。", exe.display()),
            ),
        ));
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
    keep_own_handles();
    let mut child = cmd.spawn().map_err(|e| {
        Fail::app("no_app", lang.pick(format!("Could not start SmedCover ({}): {e}", exe.display()), format!("启动不了 SmedCover（{}）：{e}", exe.display())))
    })?;
    let stdin = child.stdin.take();
    if !o.quiet {
        (o.note)(lang.pick("Starting SmedCover…", "正在启动 SmedCover…"));
    }
    Ok(Started { child, stdin })
}

/// `logs/cli-app.log` in the data folder, for the app's output, when the folder has a `logs/`; one grown past
/// [`MAX_LOG`] set aside as `cli-app.log.1` first.
fn log_file(data: &Path) -> Option<(fs::File, fs::File)> {
    let dir = data.join("logs");
    if !dir.is_dir() {
        return None;
    }
    let log = dir.join("cli-app.log");
    if fs::metadata(&log).is_ok_and(|m| m.len() > MAX_LOG) {
        let _ = fs::rename(&log, dir.join("cli-app.log.1"));
    }
    let out = fs::OpenOptions::new().create(true).append(true).open(&log).ok()?;
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

/// On Windows a process started is handed every handle of this one that may be inherited (the standard library starts
/// it so), this command line's own standard input, output and error among them, which it was itself handed so: the app
/// would hold the pipe a script reads the command's output from till the app quits, and the script, waiting for that
/// pipe's end, would wait for the app rather than for the command — for good, if the user has opened the app's window
/// meanwhile. They are made this process's alone first; the app is given its own, as `start` sets them, all the same.
#[cfg(windows)]
fn keep_own_handles() {
    use windows_sys::Win32::Foundation::{SetHandleInformation, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
    for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        // SAFETY: GetStdHandle takes no pointer, and SetHandleInformation is given a handle of this process's (one that
        // cannot be changed so, a console's on an old system, is left as it is)
        unsafe {
            let handle = GetStdHandle(which);
            if !handle.is_null() && handle != INVALID_HANDLE_VALUE {
                SetHandleInformation(handle, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }
}

#[cfg(not(windows))]
fn keep_own_handles() {}

impl AppLink {
    /// Whether this command started the app.
    pub fn started_here(&self) -> bool {
        self.started.is_some()
    }

    /// Lets go of the app: if this command started it, says it is done and closes its standard input. The app quits in
    /// its own time, having saved what it has to (`quitting: true` in its `cli.json` till then), or stays, if the user
    /// has opened its window since (`/app/done` then answers `exiting: false`). Once. Whether the app is quitting.
    pub fn finish(&mut self) -> bool {
        if std::mem::replace(&mut self.finished, true) {
            return false;
        }
        let Some(mut started) = self.started.take() else {
            return false;
        };
        let req = Request {
            method: "POST",
            path: "/app/done",
            headers: vec![("Authorization", format!("Bearer {}", self.token)), ("User-Agent", user_agent())],
            body: b"",
        };
        let exiting = http::exchange(self.port, &req, DONE_TIMEOUT)
            .ok()
            .and_then(|(status, _, body)| (status == 200).then(|| serde_json::from_slice::<Value>(&body).ok()).flatten())
            .and_then(|answer| answer.get("exiting").and_then(Value::as_bool))
            // not told: its standard input's end tells it
            .unwrap_or(true);
        drop(started.stdin.take());
        exiting
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
            CliJson { pid: 12345, port: 51234, token: "smc_x".into(), version: "0.3.1".into(), launched_by: "cli".into(), ready: true, quitting: false }
        );
        assert!(!format!("{cli:?}").contains("smc_x"), "its Debug hides the token");
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

    fn private_file(dir: &Path, text: &str) {
        let path = dir.join(CLI_JSON);
        fs::write(&path, text).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    #[test]
    fn no_cli_json_is_no_app() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_cli_json(dir.path()).is_none());
        assert!(matches!(probe(dir.path()), Probe::None));
        private_file(dir.path(), "garbage");
        assert!(matches!(read_cli_json(dir.path()), Some(Err(_))));
        assert!(matches!(probe(dir.path()), Probe::None));
    }

    #[cfg(unix)]
    #[test]
    fn a_cli_json_others_may_read_is_not_taken() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        private_file(dir.path(), r#"{"format": 1, "pid": 1, "port": 2, "token": "t"}"#);
        assert!(matches!(read_cli_json(dir.path()), Some(Ok(_))));
        fs::set_permissions(dir.path().join(CLI_JSON), fs::Permissions::from_mode(0o644)).unwrap();
        let refused = read_cli_json(dir.path()).unwrap().unwrap_err();
        assert!(refused.contains("others may read") && refused.contains("644"), "{refused}");
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

    #[test]
    fn the_log_is_set_aside_when_it_grows() {
        let dir = tempfile::tempdir().unwrap();
        assert!(log_file(dir.path()).is_none(), "no logs/: no log");
        let logs = dir.path().join("logs");
        fs::create_dir(&logs).unwrap();
        fs::write(logs.join("cli-app.log"), vec![b'x'; MAX_LOG as usize + 1]).unwrap();
        let (mut out, _) = log_file(dir.path()).unwrap();
        std::io::Write::write_all(&mut out, b"new").unwrap();
        assert_eq!(fs::read(logs.join("cli-app.log")).unwrap(), b"new");
        assert_eq!(fs::metadata(logs.join("cli-app.log.1")).unwrap().len(), MAX_LOG + 1);
    }

    #[test]
    fn the_app_is_found_by_the_environment_the_app_path_file_beside_or_its_place() {
        let dir = tempfile::tempdir().unwrap();
        let exe = |name: &str| format!("{name}{}", env::consts::EXE_SUFFIX);
        let me = dir.path().join(exe("smedcover"));
        let beside = dir.path().join(exe("smedcover-app"));
        let last = dir.path().join("Applications/SmedCover.app/Contents/MacOS/smedcover-app");
        fs::create_dir_all(last.parent().unwrap()).unwrap();
        fs::write(&last, "app").unwrap();
        // nothing beside it: the last place (macOS's /Applications), else beside it, there or not
        assert_eq!(app_executable_for(&me, None, Some(&last)), last);
        assert_eq!(app_executable_for(&me, None, None), beside);
        fs::write(&beside, "app").unwrap();
        assert_eq!(app_executable_for(&me, None, Some(&last)), beside, "the app beside it first");
        // an app-path file beside it (Windows' copy on the PATH) names the app, there or not; empty, it names none
        let named = dir.path().join("Program Files/SmedCover/smedcover-app.exe");
        fs::write(dir.path().join(APP_PATH), format!("{}\r\n", named.display())).unwrap();
        assert_eq!(app_executable_for(&me, None, Some(&last)), named);
        fs::write(dir.path().join(APP_PATH), "  \n").unwrap();
        assert_eq!(app_executable_for(&me, None, Some(&last)), beside);
        // SMEDCOVER_APP before all (an empty one is none)
        assert_eq!(app_executable_for(&me, Some("/x/app".into()), Some(&last)), PathBuf::from("/x/app"));
        assert_eq!(app_executable_for(&me, Some("".into()), Some(&last)), beside);
    }
}
