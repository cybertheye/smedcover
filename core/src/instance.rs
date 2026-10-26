//! One desktop app for each data folder, and how a command line finds the one that runs: `app.lock`
//! and `cli.json`, both in the data folder.
//!
//! `app.lock` is taken by the app as it starts, an exclusive lock on the file held for as long as it
//! runs ([`AppLock::take`]); the system lets it go when the app ends, however it ends (quit, crashed,
//! killed), so a lock that cannot be had means that another app runs on that folder now. The file
//! holds nothing and is never taken away (two apps could then lock two files of the same name). A
//! second app on the folder asks the first to show its window and quits; one started for the
//! command line (`smedcover-app --cli`) quits with [`EXIT_ALREADY_RUNNING`] instead, and the command
//! line uses the app that runs. A self-test's data folder is a folder of its own, so a self-test
//! never meets the user's app.
//!
//! `cli.json` says where the app's command-line endpoint listens and with what token (see
//! `crate::mcp::server`'s `AppControl`):
//!
//! ```json
//! {"format": 1, "pid": 12345, "port": 51234, "token": "smc_…", "version": "0.3.1", "launchedBy": "user", "ready": true}
//! ```
//!
//! `launchedBy` is `"cli"` for an app the command line started (hidden on macOS, quitting when the
//! command line is done) and `"user"` for any other, or for one the user has since shown; `ready` says
//! whether the window's page has attached, so that calls are taken. The app writes it once the
//! endpoint listens, again whenever `ready` or `launchedBy` changes, and removes it when it quits as it
//! should; it is written through a temporary file that then takes its place, and on Unix only its
//! owner may read it (it holds the token). One that is left (the app crashed or was killed) is stale:
//! [`find`] takes a file for a running app only when its process is alive (on Unix; Windows is asked
//! nothing, the endpoint telling) and its endpoint answers `/health`, with the token, as SmedCover's.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::ErrorKind;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use crate::mcp::config::write_private;
use crate::mcp::server::SERVER_NAME;
use crate::mcp::Secret;
use crate::{err, Res};

/// The lock's file in the data folder.
pub const LOCK_FILE: &str = "app.lock";
/// The command line's file in the data folder.
pub const CLI_FILE: &str = "cli.json";
/// The format of `cli.json` this is.
pub const CLI_FORMAT: u64 = 1;
/// What `smedcover-app --cli` exits with when another app already runs on its data folder (EX_TEMPFAIL):
/// the command line then reads that app's `cli.json` and uses it.
pub const EXIT_ALREADY_RUNNING: i32 = 75;

// ---------------------------------------------------------------- app.lock

/// The data folder's lock, held till it is dropped (the app keeps it for as long as it runs).
#[derive(Debug)]
pub struct AppLock {
    _file: File,
}

impl AppLock {
    /// Takes the lock on `app.lock` in the data folder `data` (both made if they are not there):
    /// `None` when another holds it, that is another app runs on that folder. An error when the file
    /// cannot be had or the system cannot lock it (a file system without locks): the app then runs
    /// without, as it did before there was a lock.
    pub fn take(data: &Path) -> Res<Option<AppLock>> {
        fs::create_dir_all(data).map_err(|e| format!("{LOCK_FILE}: {e}"))?;
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(data.join(LOCK_FILE)).map_err(|e| format!("{LOCK_FILE}: {e}"))?;
        match file.try_lock() {
            Ok(()) => Ok(Some(AppLock { _file: file })),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(e)) => Err(format!("{LOCK_FILE}: {e}")),
        }
    }
}

// ---------------------------------------------------------------- cli.json

/// Who started the app, as `cli.json` says.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchedBy {
    /// The user (or the app has since been shown to them): it goes on when the command line is done.
    User,
    /// The command line, for its own work: hidden on macOS, and quitting when the command line is done.
    Cli,
}

impl LaunchedBy {
    /// `"user"` or `"cli"`.
    pub fn as_str(self) -> &'static str {
        match self {
            LaunchedBy::User => "user",
            LaunchedBy::Cli => "cli",
        }
    }

    fn parse(text: &str) -> Option<LaunchedBy> {
        match text {
            "user" => Some(LaunchedBy::User),
            "cli" => Some(LaunchedBy::Cli),
            _ => None,
        }
    }
}

/// What `cli.json` holds (see the module's notes). Its `Debug` does not show the token.
#[derive(Clone, Debug)]
pub struct CliFile {
    /// The app's process.
    pub pid: u32,
    /// The port its command-line endpoint listens on, on 127.0.0.1.
    pub port: u16,
    /// The token the endpoint wants, as `Authorization: Bearer <token>`.
    pub token: Secret,
    /// The app's version.
    pub version: String,
    pub launched_by: LaunchedBy,
    /// Whether the window's page has attached and calls are taken.
    pub ready: bool,
}

impl CliFile {
    /// The file as JSON, its fields in the contract's order.
    pub fn to_json(&self) -> Value {
        json!({
            "format": CLI_FORMAT, "pid": self.pid, "port": self.port, "token": self.token.expose(), "version": self.version,
            "launchedBy": self.launched_by.as_str(), "ready": self.ready,
        })
    }

    /// The file read from its JSON: `None` for another format, or a field missing or not what it should be.
    pub fn from_json(value: &Value) -> Option<CliFile> {
        if value.get("format")?.as_u64()? != CLI_FORMAT {
            return None;
        }
        Some(CliFile {
            pid: u32::try_from(value.get("pid")?.as_u64()?).ok()?,
            port: u16::try_from(value.get("port")?.as_u64()?).ok().filter(|p| *p != 0)?,
            token: Secret::parse(value.get("token")?.as_str()?)?,
            version: value.get("version")?.as_str()?.to_string(),
            launched_by: LaunchedBy::parse(value.get("launchedBy")?.as_str()?)?,
            ready: value.get("ready")?.as_bool()?,
        })
    }

    /// Saves it as `cli.json` in the data folder `data`, through a temporary file of a name that is
    /// always the same (so the app writes it from one place at a time), readable by its owner alone on
    /// Unix.
    pub fn save(&self, data: &Path) -> Res<()> {
        let text = serde_json::to_string_pretty(&self.to_json()).map_err(err)?;
        write_private(&data.join(CLI_FILE), format!("{text}\n").as_bytes()).map_err(|e| format!("{CLI_FILE}: {e}"))
    }

    /// The `cli.json` of the data folder `data`: `None` if there is none, or what is there is not one
    /// (another format, not JSON). Only a failure to read it is an error. Whether its app still runs
    /// is [`find`]'s to say.
    pub fn load(data: &Path) -> Res<Option<CliFile>> {
        match fs::read(data.join(CLI_FILE)) {
            Ok(bytes) => Ok(serde_json::from_slice::<Value>(&bytes).ok().as_ref().and_then(CliFile::from_json)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{CLI_FILE}: {e}")),
        }
    }

    /// Removes `cli.json` from the data folder `data`; none there is fine.
    pub fn remove(data: &Path) -> Res<()> {
        match fs::remove_file(data.join(CLI_FILE)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{CLI_FILE}: {e}")),
        }
    }

    /// `http://127.0.0.1:<port><path>`.
    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    /// Whether its process is alive: on Unix, whether a signal could be sent to it (none is); on
    /// Windows nothing is asked, and it is taken to be (the endpoint tells, [`CliFile::health`]).
    pub fn process_alive(&self) -> bool {
        process_alive(self.pid)
    }

    /// What its endpoint's `/health` answers, asked with the token and waited for `wait` at most:
    /// `None` when nothing listens, or what answers is not SmedCover's or refuses the token.
    pub fn health(&self, wait: Duration) -> Option<Value> {
        let agent = ureq::AgentBuilder::new().timeout(wait).build();
        let response = agent.get(&self.url("/health")).set("Authorization", &format!("Bearer {}", self.token.expose())).call().ok()?;
        // a short answer is all SmedCover's is: no more of whatever answers is read
        let body: Value = serde_json::from_reader(std::io::Read::take(response.into_reader(), 64 * 1024)).ok()?;
        (body.get("name").and_then(Value::as_str) == Some(SERVER_NAME)).then_some(body)
    }
}

/// The app running on the data folder `data`, as its `cli.json` says: `None` when there is none, or
/// the file is stale (its process gone, or its endpoint not answering `/health` as SmedCover's with
/// its token within `wait`). Blocking: the endpoint is asked over HTTP.
pub fn find(data: &Path, wait: Duration) -> Option<CliFile> {
    let file = CliFile::load(data).ok()??;
    (file.process_alive() && file.health(wait).is_some()).then_some(file)
}

#[cfg(unix)]
fn process_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else { return false };
    if pid <= 0 {
        return false;
    }
    // SAFETY: signal 0 sends nothing; it only asks whether the process is there and may be signalled
    let sent = unsafe { libc::kill(pid, 0) };
    // EPERM: there, but another user's (which our app is not, but it is there)
    sent == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn process_alive(_pid: u32) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(port: u16) -> CliFile {
        CliFile { pid: std::process::id(), port, token: Secret::generate().unwrap(), version: "0.3.1".into(), launched_by: LaunchedBy::Cli, ready: false }
    }

    #[test]
    fn a_second_taker_of_the_lock_is_refused_till_the_first_lets_go() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        let first = AppLock::take(&data).unwrap().expect("the folder made, and its lock taken");
        assert!(data.join(LOCK_FILE).is_file());
        assert!(AppLock::take(&data).unwrap().is_none(), "another app runs on the folder");
        assert!(AppLock::take(&data).unwrap().is_none(), "asked again, the same");
        // another folder is another lock
        let other = dir.path().join("other");
        assert!(AppLock::take(&other).unwrap().is_some());
        drop(first);
        assert!(AppLock::take(&data).unwrap().is_some(), "let go when the first goes");
        assert!(data.join(LOCK_FILE).is_file(), "the file is left");
    }

    #[test]
    fn cli_json_is_written_read_and_removed() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        assert!(CliFile::load(data).unwrap().is_none(), "none yet");
        let f = file(51234);
        f.save(data).unwrap();
        let saved: Value = serde_json::from_slice(&fs::read(data.join(CLI_FILE)).unwrap()).unwrap();
        assert_eq!(
            saved,
            json!({"format": 1, "pid": std::process::id(), "port": 51234, "token": f.token.expose(), "version": "0.3.1", "launchedBy": "cli", "ready": false})
        );
        assert!(!data.join("cli.json.tmp").exists(), "written through a temporary file, then put in place");
        let read = CliFile::load(data).unwrap().unwrap();
        assert_eq!((read.pid, read.port, read.version.as_str(), read.launched_by, read.ready), (f.pid, 51234, "0.3.1", LaunchedBy::Cli, false));
        assert!(read.token.matches(f.token.expose()));
        // rewritten as it changes
        CliFile { ready: true, launched_by: LaunchedBy::User, ..f.clone() }.save(data).unwrap();
        let read = CliFile::load(data).unwrap().unwrap();
        assert!(read.ready && read.launched_by == LaunchedBy::User);
        CliFile::remove(data).unwrap();
        assert!(!data.join(CLI_FILE).exists());
        CliFile::remove(data).unwrap();
        assert!(format!("{f:?}").find(f.token.expose()).is_none(), "its Debug hides the token");
    }

    #[test]
    fn what_is_not_a_cli_json_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let good = file(40000).to_json();
        let mut cases: Vec<Value> = vec![json!([1, 2]), json!({})];
        for (key, bad) in [("format", json!(2)), ("pid", json!(-1)), ("port", json!(0)), ("port", json!(70000)), ("token", json!("smc_short")), ("launchedBy", json!("agent")), ("ready", json!("yes")), ("version", json!(3))] {
            let mut v = good.clone();
            v[key] = bad;
            cases.push(v);
        }
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("ready");
        cases.push(missing);
        for case in cases {
            fs::write(data.join(CLI_FILE), case.to_string()).unwrap();
            assert!(CliFile::load(data).unwrap().is_none(), "{case}");
        }
        fs::write(data.join(CLI_FILE), b"{\"format\": 1, \"pid\"").unwrap();
        assert!(CliFile::load(data).unwrap().is_none(), "not JSON");
        fs::write(data.join(CLI_FILE), good.to_string()).unwrap();
        assert!(CliFile::load(data).unwrap().is_some(), "the good one");
    }

    #[cfg(unix)]
    #[test]
    fn only_its_owner_may_read_cli_json() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        // a temporary file left over, readable by all, does not pass its mode on
        fs::write(dir.path().join("cli.json.tmp"), "x").unwrap();
        fs::set_permissions(dir.path().join("cli.json.tmp"), fs::Permissions::from_mode(0o644)).unwrap();
        file(40001).save(dir.path()).unwrap();
        let mode = fs::metadata(dir.path().join(CLI_FILE)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_file_whose_endpoint_is_gone_is_stale() {
        let dir = tempfile::tempdir().unwrap();
        // a port nothing listens on: taken, then let go
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let f = file(port);
        f.save(dir.path()).unwrap();
        assert!(f.process_alive(), "this very process");
        assert!(f.health(Duration::from_secs(2)).is_none());
        assert!(find(dir.path(), Duration::from_secs(2)).is_none(), "nothing answers on its port");
        // a port where something else answers
        let other = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let f = file(other.local_addr().unwrap().port());
        f.save(dir.path()).unwrap();
        let answer = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut stream, _) = other.accept().unwrap();
            let mut buf = [0u8; 2048];
            let _ = stream.read(&mut buf);
            let body = r#"{"name": "someone-else", "version": "1"}"#;
            let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        });
        assert!(find(dir.path(), Duration::from_secs(5)).is_none(), "what answers is not SmedCover");
        answer.join().unwrap();
        assert!(find(&dir.path().join("nothing"), Duration::from_secs(1)).is_none(), "no file at all");
    }

    #[cfg(unix)]
    #[test]
    fn a_file_whose_process_is_gone_is_stale() {
        let mut child = std::process::Command::new("true").spawn().unwrap();
        let pid = child.id();
        child.wait().unwrap();
        let f = CliFile { pid, ..file(40002) };
        assert!(!f.process_alive(), "the process ended and was waited for");
        assert!(!CliFile { pid: 0, ..file(40002) }.process_alive());
        assert!(!CliFile { pid: u32::MAX, ..file(40002) }.process_alive());
    }
}
