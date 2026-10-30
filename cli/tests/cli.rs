//! The command line, `smedcover`, as a user runs it, against the app played here (support/fake.rs: the core's own
//! command-line endpoint, with a page played, quitting as the app does): an app already running used and left alone,
//! one started and let go, one shown to the user meanwhile and kept, one that finds another already running, one
//! waited for that goes away, one that needs setting up, a stale `cli.json` and one that is not SmedCover's, an app
//! that takes a request and never answers, one that refuses the token, a tool's error, an export stopped part-way,
//! the command line's own timeout and the app's, Ctrl-C, and each command's output.
//!
//! The same program is the tests and the app they play: started with `SMEDCOVER_FAKE_APP`, it is the app (the command
//! line under test is pointed to it with `SMEDCOVER_APP`). Each test has a data folder of its own, in a temporary
//! folder, so they run side by side and never touch the user's data or app. It has its own main (`harness = false`
//! in Cargo.toml): `cargo test -p smedcover-cli --test cli -- <part of a name>` runs some, `--skip <part>` leaves some
//! out, `--list` lists them.

#[path = "support/fake.rs"]
mod fake;
#[path = "support/schema.rs"]
mod schema;

use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::panic;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

const CLI: &str = env!("CARGO_BIN_EXE_smedcover");

type Test = fn();

const TESTS: &[(&str, Test)] = &[
    ("uses_a_running_app_and_leaves_it_alone", uses_a_running_app_and_leaves_it_alone),
    ("starts_the_app_and_lets_it_go", starts_the_app_and_lets_it_go),
    ("an_app_shown_meanwhile_is_the_users_and_stays", an_app_shown_meanwhile_is_the_users_and_stays),
    ("uses_the_app_already_running_when_the_one_started_defers", uses_the_app_already_running_when_the_one_started_defers),
    ("starts_one_when_the_app_waited_for_goes_away", starts_one_when_the_app_waited_for_goes_away),
    ("an_app_that_needs_setting_up_is_exit_3", an_app_that_needs_setting_up_is_exit_3),
    ("a_stale_cli_json_is_no_app", a_stale_cli_json_is_no_app),
    ("commands_one_after_another_share_one_app", commands_one_after_another_share_one_app),
    ("a_health_that_is_not_smedcovers_is_no_app", a_health_that_is_not_smedcovers_is_no_app),
    ("an_app_that_refuses_the_token_is_tried_once_more_then_exit_3", an_app_that_refuses_the_token_is_tried_once_more_then_exit_3),
    ("an_answer_that_never_comes_is_still_timed", an_answer_that_never_comes_is_still_timed),
    ("a_tools_error_is_exit_1_with_its_kind", a_tools_error_is_exit_1_with_its_kind),
    ("an_export_stopped_part_way_is_exit_1_in_one_document", an_export_stopped_part_way_is_exit_1_in_one_document),
    ("the_command_lines_timeout_cancels_and_is_exit_4", the_command_lines_timeout_cancels_and_is_exit_4),
    ("the_apps_own_timeout_is_exit_4", the_apps_own_timeout_is_exit_4),
    ("an_app_that_quits_early_or_is_not_there_is_exit_3", an_app_that_quits_early_or_is_not_there_is_exit_3),
    ("usage_errors_are_exit_2_and_start_nothing", usage_errors_are_exit_2_and_start_nothing),
    ("profiles_as_text_and_json", profiles_as_text_and_json),
    ("render_puts_one_file_where_it_is_asked", render_puts_one_file_where_it_is_asked),
    ("export_and_batch_print_their_files_and_progress", export_and_batch_print_their_files_and_progress),
    ("import_opens_a_project_by_its_absolute_path", import_opens_a_project_by_its_absolute_path),
    ("tools_lists_the_apps_tools", tools_lists_the_apps_tools),
    ("call_prints_text_and_saves_or_describes_images", call_prints_text_and_saves_or_describes_images),
    ("a_self_tests_folder_is_the_apps", a_self_tests_folder_is_the_apps),
    #[cfg(unix)]
    ("ctrl_c_cancels_the_call_and_lets_the_app_go", ctrl_c_cancels_the_call_and_lets_the_app_go),
    #[cfg(unix)]
    ("ctrl_c_with_nothing_in_hand_exits_at_once", ctrl_c_with_nothing_in_hand_exits_at_once),
];

fn main() {
    if env::var_os(fake::ENV).is_some() {
        fake::main();
    }
    let mut filters = Vec::new();
    let mut skips = Vec::new();
    let mut args = env::args().skip(1);
    let mut list = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--list" => list = true,
            "--skip" => skips.extend(args.next()),
            // libtest's other flags that take a value, which cargo may pass on
            "--test-threads" | "--color" | "--format" | "--logfile" | "-Z" => {
                args.next();
            }
            a if a.starts_with("--skip=") => skips.push(a["--skip=".len()..].to_string()),
            a if a.starts_with('-') => {}
            a => filters.push(a.to_string()),
        }
    }
    let chosen: Vec<&(&str, Test)> = TESTS
        .iter()
        .filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str())))
        .filter(|(name, _)| !skips.iter().any(|s| name.contains(s.as_str())))
        .collect();
    if list {
        for (name, _) in &chosen {
            println!("{name}: test");
        }
        return;
    }
    println!("\nrunning {} tests", chosen.len());
    let started = Instant::now();
    let results: Vec<(&str, bool, Duration)> = thread::scope(|s| {
        let running: Vec<_> = chosen
            .iter()
            .map(|(name, test)| {
                s.spawn(move || {
                    let t = Instant::now();
                    let passed = panic::catch_unwind(*test).is_ok();
                    (*name, passed, t.elapsed())
                })
            })
            .collect();
        running.into_iter().map(|r| r.join().expect("a test's thread")).collect()
    });
    let failed: Vec<&str> = results.iter().filter(|(_, passed, _)| !passed).map(|(name, _, _)| *name).collect();
    for (name, passed, took) in &results {
        println!("test {name} ... {} ({:.1} s)", if *passed { "ok" } else { "FAILED" }, took.as_secs_f64());
    }
    println!(
        "\ntest result: {}. {} passed; {} failed; finished in {:.1} s\n",
        if failed.is_empty() { "ok" } else { "FAILED" },
        results.len() - failed.len(),
        failed.len(),
        started.elapsed().as_secs_f64()
    );
    if !failed.is_empty() {
        println!("failures:\n    {}\n", failed.join("\n    "));
        std::process::exit(101);
    }
}

// ---- helpers ----

/// A test's own folder (removed after it), with the data folder in it, the app set to English there (the command line
/// speaks the app's language before the system's).
struct Folder {
    _root: tempfile::TempDir,
    /// The folder by the path the command line, run in it, sees it by: on macOS the temporary folder is under a link
    /// (/var to /private/var), followed; on Windows it is taken as it is (canonical there is a \\?\ path).
    base: PathBuf,
    data: PathBuf,
}

impl Folder {
    fn new() -> Folder {
        let root = tempfile::tempdir().unwrap();
        let base = if cfg!(unix) { fs::canonicalize(root.path()).unwrap() } else { root.path().to_path_buf() };
        let data = base.join("data");
        fs::create_dir_all(&data).unwrap();
        let folder = Folder { _root: root, base, data };
        folder.set_lang("en");
        folder
    }

    /// The language set in the app (custom.json, as the app writes it).
    fn set_lang(&self, lang: &str) {
        fs::write(self.data.join("custom.json"), json!({"by": "app", "settings": {"lang": lang}}).to_string()).unwrap();
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.base.join(rel)
    }

    /// The app's log: what it did, a line each (`<pid> <what>`, the pid taken off).
    fn log(&self) -> Vec<String> {
        fs::read_to_string(self.data.join("fake-app.log"))
            .unwrap_or_default()
            .lines()
            .map(|l| l.split_once(' ').map_or(l, |(_, what)| what).to_string())
            .collect()
    }

    fn logged(&self, what: &str) -> bool {
        self.log().iter().any(|l| l.starts_with(what))
    }

    /// Waits up to `within` for the log to have `what`.
    fn wait_for(&self, what: &str, within: Duration) -> bool {
        let until = Instant::now() + within;
        while Instant::now() < until {
            if self.logged(what) {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        self.logged(what)
    }

    fn cli_json(&self) -> Option<Value> {
        fs::read_to_string(self.data.join("cli.json")).ok().and_then(|t| serde_json::from_str(&t).ok())
    }

    /// Writes a `cli.json` as the app does (its owner alone may read it).
    fn write_cli_json(&self, pid: u32, port: u16, token: &str, launched_by: &str) {
        let text = json!({"format": 1, "pid": pid, "port": port, "token": token, "version": env!("CARGO_PKG_VERSION"), "launchedBy": launched_by, "ready": true});
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(self.data.join("cli.json")).unwrap().write_all(text.to_string().as_bytes()).unwrap();
    }
}

/// The command line, as these tests run it: on the folder's data, pointed to the app played here.
fn smedcover(folder: &Folder, args: &[&str]) -> Command {
    let mut cmd = Command::new(CLI);
    cmd.args(args)
        .current_dir(&folder.base)
        .env(fake::ENV, "1")
        .env("SMEDCOVER_APP", env::current_exe().unwrap())
        .env("SMEDCOVER_DATA", &folder.data);
    for name in [
        "SMEDCOVER_SELFTEST",
        "SMEDCOVER_SELFTEST_STAY",
        "FAKE_MODE",
        "FAKE_CLI_JSON_MS",
        "FAKE_CLI_JSON_AFTER",
        "FAKE_READY_MS",
        "FAKE_VERSION",
        "FAKE_TEST_OWNED",
        "FAKE_LIFETIME_MS",
    ] {
        cmd.env_remove(name);
    }
    cmd
}

struct Ran {
    code: i32,
    stdout: String,
    stderr: String,
    took: Duration,
}

impl std::fmt::Debug for Ran {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "exit {} after {:.1} s\n--- stdout\n{}\n--- stderr\n{}", self.code, self.took.as_secs_f64(), self.stdout, self.stderr)
    }
}

/// Runs `cmd` to its end (60 s at most), `input` on its standard input.
fn run_with(mut cmd: Command, input: Option<&str>) -> Ran {
    let started = Instant::now();
    let mut child = cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    if let Some(input) = input {
        child.stdin.take().unwrap().write_all(input.as_bytes()).unwrap();
    }
    finish(child, started)
}

fn run(cmd: Command) -> Ran {
    run_with(cmd, None)
}

fn spawn(mut cmd: Command) -> Child {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap()
}

fn finish(mut child: Child, started: Instant) -> Ran {
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || {
        let mut s = String::new();
        let _ = stdout.read_to_string(&mut s);
        s
    });
    let err = thread::spawn(move || {
        let mut s = String::new();
        let _ = stderr.read_to_string(&mut s);
        s
    });
    let until = started + Duration::from_secs(60);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > until {
            let _ = child.kill();
            panic!("the command line ran for more than 60 s");
        }
        thread::sleep(Duration::from_millis(10));
    };
    Ran { code: status.code().unwrap_or(-1), stdout: out.join().unwrap(), stderr: err.join().unwrap(), took: started.elapsed() }
}

/// An app the user started (played here): `launchedBy` "user", with its standard input held so that it quits when
/// the test is over, however it ends (`FAKE_TEST_OWNED`: the app itself lets the end of a user's app's input be).
struct UserApp {
    child: Child,
    stdin: Option<ChildStdin>,
}

fn user_app(folder: &Folder, env: &[(&str, &str)]) -> UserApp {
    let mut cmd = Command::new(env::current_exe().unwrap());
    cmd.env(fake::ENV, "1").env("SMEDCOVER_DATA", &folder.data).env("FAKE_TEST_OWNED", "1").env_remove("FAKE_MODE").env_remove("SMEDCOVER_SELFTEST");
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::inherit()).spawn().unwrap();
    let stdin = child.stdin.take();
    UserApp { child, stdin }
}

impl UserApp {
    fn ready(self, folder: &Folder) -> UserApp {
        assert!(folder.wait_for("ready", Duration::from_secs(20)), "the app played got ready: {:?}", folder.log());
        self
    }

    fn alive(&mut self) -> bool {
        self.child.try_wait().unwrap().is_none()
    }

    /// Closes its standard input, and waits for it to go.
    fn close(&mut self) {
        drop(self.stdin.take());
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until && self.alive() {
            thread::sleep(Duration::from_millis(20));
        }
    }
}

impl Drop for UserApp {
    fn drop(&mut self) {
        self.close();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// What a stand-in for an app answers on `/mcp`: nothing ever (the request taken, no answer's head), or 401.
#[derive(Clone, Copy)]
enum Stub {
    Stall,
    Refuse,
}

/// A stand-in on a port of its own that answers `/health` as `name` does and `/mcp` as `stub` says, with a `cli.json`
/// leading to it (this process's pid); how many `/mcp` requests came, so far. It reads a request's body before it
/// answers, as the endpoint does a refused one's: a connection closed with some of it unread is reset, and Windows then
/// drops the answer the command line has not read yet, which it would take for the app gone.
fn stub_app(folder: &Folder, name: &'static str, stub: Stub) -> Arc<AtomicUsize> {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let posts = Arc::new(AtomicUsize::new(0));
    let counted = posts.clone();
    thread::spawn(move || {
        let mut held: Vec<TcpStream> = Vec::new();
        for stream in listener.incoming().flatten() {
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            let _ = reader.read_line(&mut first);
            let mut line = String::new();
            let mut length = 0;
            while reader.read_line(&mut line).is_ok_and(|n| n > 2) {
                if let Some((header, value)) = line.split_once(':') {
                    if header.eq_ignore_ascii_case("content-length") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                }
                line.clear();
            }
            let _ = reader.by_ref().take(length).read_to_end(&mut Vec::new());
            let mut stream = stream;
            if first.starts_with("GET /health") {
                let body = json!({"name": name, "version": env!("CARGO_PKG_VERSION"), "page": "ready", "ready": true, "needsSetup": false}).to_string();
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                counted.fetch_add(1, Ordering::SeqCst);
                match stub {
                    Stub::Stall => held.push(stream),
                    Stub::Refuse => {
                        let _ = write!(stream, "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    }
                }
            }
        }
    });
    folder.write_cli_json(std::process::id(), port, "smc_stand_in", "user");
    posts
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not one JSON document ({e}): {text}"))
}

// ---- the app: found, started, let go ----

fn uses_a_running_app_and_leaves_it_alone() {
    let folder = Folder::new();
    let mut app = user_app(&folder, &[("FAKE_VERSION", "9.9.9")]).ready(&folder);
    // no app to start: the one running must be used
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("SMEDCOVER_APP", folder.path("no-such-app"));
    let ran = run(cmd);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.starts_with("Mine  (id p1)  ← shown\n"), "{ran:?}");
    assert!(ran.stderr.contains("Note: SmedCover 9.9.9 is running; this command line is"), "{ran:?}");
    assert!(!ran.stderr.contains("Starting"), "{ran:?}");
    assert!(folder.logged("call get_context"));
    // not this command's to let go
    assert!(!folder.logged("done"), "{:?}", folder.log());
    assert!(app.alive() && folder.cli_json().is_some());
    // and again, quietly
    let ran = run(smedcover(&folder, &["profiles", "--quiet"]));
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{ran:?}");
    assert!(app.alive());
}

fn starts_the_app_and_lets_it_go() {
    let folder = Folder::new();
    // the data folder named with --data alone: the app started is told it too
    let mut cmd = smedcover(&folder, &["--data", folder.data.to_str().unwrap(), "--json", "profiles"]);
    cmd.env_remove("SMEDCOVER_DATA");
    let ran = run(cmd);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["current"]["profile"], "p1");
    assert!(ran.stderr.contains("Starting SmedCover…"), "{ran:?}");
    // told it is done, it says it is quitting (the next command would still use it), and quits in its own time, once
    // nothing has come for 2 s, its cli.json with it
    assert_eq!(folder.cli_json().map(|c| c["quitting"].clone()), Some(json!(true)), "{:?}", folder.log());
    assert!(folder.wait_for("exit", Duration::from_secs(10)), "{:?}", folder.log());
    assert!(folder.cli_json().is_none());
    let log = folder.log();
    let at = |what: &str| log.iter().position(|l| l.starts_with(what)).unwrap_or_else(|| panic!("{what} in {log:?}"));
    assert!(at("start --cli") < at("ready") && at("ready") < at("call get_context") && at("call get_context") < at("done") && at("done") < at("exit done"));
    assert!(ran.took < Duration::from_secs(10), "the command does not wait for the app to go: {ran:?}");
    // the end of its input, after: nothing more
    assert!(log.iter().filter(|l| l.starts_with("exit")).count() == 1, "{log:?}");
}

fn an_app_shown_meanwhile_is_the_users_and_stays() {
    let folder = Folder::new();
    // started for the command, then shown to the user (as Finder, or a second launch, does) while a call runs
    let mut cmd = smedcover(&folder, &["--timeout", "2", "call", "slow_tool"]);
    cmd.env("FAKE_LIFETIME_MS", "7000");
    let child = spawn(cmd);
    let started = Instant::now();
    assert!(folder.wait_for("call slow_tool", Duration::from_secs(20)), "{:?}", folder.log());
    let cli = folder.cli_json().expect("its cli.json");
    let req = smedcover_cli::http::Request {
        method: "POST",
        path: "/app/show",
        headers: vec![("Authorization", format!("Bearer {}", cli["token"].as_str().unwrap()))],
        body: b"",
    };
    let (status, _, body) = smedcover_cli::http::exchange(cli["port"].as_u64().unwrap() as u16, &req, Duration::from_secs(5)).unwrap();
    assert_eq!((status, json_of(&String::from_utf8_lossy(&body))), (200, json!({"ok": true, "launchedBy": "user"})));
    let ran = finish(child, started);
    assert_eq!(ran.code, 4, "{ran:?}");
    // told it is done, it is the user's: it says so, stays, and lets the end of its input be
    assert!(folder.wait_for("stdin-eof (stays: the user's)", Duration::from_secs(5)), "{:?}", folder.log());
    assert!(folder.logged("done (stays: the user's)"), "{:?}", folder.log());
    assert_eq!(folder.cli_json().unwrap()["launchedBy"], "user");
    thread::sleep(Duration::from_millis(2500));
    assert!(!folder.logged("exit"), "it stays: {:?}", folder.log());
    // (it quits after FAKE_LIFETIME_MS, so the test leaves nothing running)
    assert!(folder.wait_for("exit lifetime", Duration::from_secs(15)), "{:?}", folder.log());
}

fn uses_the_app_already_running_when_the_one_started_defers() {
    let folder = Folder::new();
    // an app starting, its cli.json not written yet (till the test says): the command line starts one, which finds it
    // and defers (75), and then waits for the one starting
    let go = folder.path("go");
    let _app = user_app(&folder, &[("FAKE_CLI_JSON_AFTER", go.to_str().unwrap())]);
    assert!(folder.wait_for("start", Duration::from_secs(20)));
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("FAKE_MODE", "already_running");
    let started = Instant::now();
    let child = spawn(cmd);
    assert!(folder.wait_for("exit 75", Duration::from_secs(20)), "{:?}", folder.log());
    fs::write(&go, "").unwrap();
    let ran = finish(child, started);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.contains("Mine  (id p1)"), "{ran:?}");
    let log = folder.log();
    // (one more may have been started, the app it deferred to not having said where it is yet: that one defers too)
    let starts = log.iter().filter(|l| *l == "start --cli").count();
    assert!((1..=2).contains(&starts) && starts == log.iter().filter(|l| *l == "exit 75").count(), "{log:?}");
    assert!(folder.logged("call get_context"), "{log:?}");
    // the app that answered is the user's: not let go
    assert!(!folder.logged("done"), "{log:?}");
}

fn starts_one_when_the_app_waited_for_goes_away() {
    let folder = Folder::new();
    // an app that says where it is but is slow to be ready, and goes away while the command line waits for it
    let mut app = user_app(&folder, &[("FAKE_READY_MS", "20000")]);
    assert!(folder.wait_for("listening", Duration::from_secs(20)), "{:?}", folder.log());
    let started = Instant::now();
    let child = spawn(smedcover(&folder, &["profiles"]));
    thread::sleep(Duration::from_millis(600));
    app.close();
    let ran = finish(child, started);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.contains("Mine  (id p1)") && ran.stderr.contains("Starting SmedCover…"), "{ran:?}");
    assert!(ran.took < Duration::from_secs(15), "not the whole wait: {ran:?}");
    assert_eq!(folder.log().iter().filter(|l| *l == "start --cli").count(), 1, "{:?}", folder.log());
}

fn an_app_that_needs_setting_up_is_exit_3() {
    let folder = Folder::new();
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("FAKE_MODE", "needs_setup");
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("Open SmedCover once and finish setting it up"), "{ran:?}");
    assert!(ran.stdout.is_empty());
    // said from its first /health: no tool called; it was started for this, so let go
    assert!(!folder.logged("call"), "{:?}", folder.log());
    assert!(folder.logged("done"), "{:?}", folder.log());
    assert!(folder.wait_for("exit", Duration::from_secs(10)), "{:?}", folder.log());

    // in Chinese where the app is set to it, and as JSON
    folder.set_lang("zh");
    let mut cmd = smedcover(&folder, &["--json", "profiles"]);
    cmd.env("FAKE_MODE", "needs_setup");
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("请先打开 SmedCover，完成首次设置"), "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["error"], json!({"kind": "needs_setup", "message": "请先打开 SmedCover，完成首次设置，然后再试。", "exit": 3}));
}

fn a_stale_cli_json_is_no_app() {
    let folder = Folder::new();
    // a process gone, and a port no one listens on
    let mut gone = Command::new(CLI).arg("--version").stdout(Stdio::null()).spawn().unwrap();
    let pid = gone.id();
    gone.wait().unwrap();
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    folder.write_cli_json(pid, port, "smc_stale", "user");
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stderr.contains("Starting SmedCover…") && folder.logged("start --cli"), "{ran:?}");
    assert!(folder.wait_for("exit", Duration::from_secs(10)));
    // a process that is there (this one) but not the app: its port refuses
    folder.write_cli_json(std::process::id(), port, "smc_stale", "user");
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(folder.log().iter().filter(|l| l.starts_with("start --cli")).count(), 2);
    let until = Instant::now() + Duration::from_secs(10);
    while folder.log().iter().filter(|l| l.starts_with("exit")).count() < 2 && Instant::now() < until {
        thread::sleep(Duration::from_millis(50));
    }
    assert!(folder.cli_json().is_none(), "the apps started let go, their cli.json with them: {:?}", folder.log());
}

fn commands_one_after_another_share_one_app() {
    let folder = Folder::new();
    // the first starts the app and is done with it; the second finds it quitting, and uses it all the same
    let first = run(smedcover(&folder, &["render", "1", "--size", "16:9", "-o", "a.png"]));
    assert_eq!(first.code, 0, "{first:?}");
    let second = run(smedcover(&folder, &["render", "2", "--size", "16:9", "-o", "b.png"]));
    assert_eq!(second.code, 0, "{second:?}");
    assert!(!second.stderr.contains("Starting"), "{second:?}");
    assert!(folder.path("a.png").is_file() && folder.path("b.png").is_file());
    let log = folder.log();
    assert_eq!(log.iter().filter(|l| *l == "start --cli").count(), 1, "one app for both: {log:?}");
    // the second did not start it, so did not say it was done; the app quits after both, once nothing more comes
    assert_eq!(log.iter().filter(|l| *l == "done").count(), 1, "{log:?}");
    assert!(folder.wait_for("exit done", Duration::from_secs(10)), "{:?}", folder.log());
}

fn a_health_that_is_not_smedcovers_is_no_app() {
    let folder = Folder::new();
    let posts = stub_app(&folder, "someone-else", Stub::Stall);
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(folder.logged("start --cli") && folder.logged("call get_context"), "{:?}", folder.log());
    assert_eq!(posts.load(Ordering::SeqCst), 0, "nothing asked of what is not SmedCover");
}

fn an_app_that_refuses_the_token_is_tried_once_more_then_exit_3() {
    let folder = Folder::new();
    // SmedCover's /health, but /mcp refuses the token: cli.json not that app's (after a restart, say)
    let posts = stub_app(&folder, "smedcover", Stub::Refuse);
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("SMEDCOVER_APP", folder.path("no-such-app"));
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("refused the command line's token"), "{ran:?}");
    assert_eq!(posts.load(Ordering::SeqCst), 2, "tried once more, then given up");
}

fn an_answer_that_never_comes_is_still_timed() {
    let folder = Folder::new();
    // an app that takes the request and never sends its answer's head: --timeout holds (initialize too)
    let _posts = stub_app(&folder, "smedcover", Stub::Stall);
    let ran = run(smedcover(&folder, &["--timeout", "2", "profiles"]));
    assert_eq!(ran.code, 4, "{ran:?}");
    assert!(ran.stderr.contains("No answer within --timeout 2 s"), "{ran:?}");
    assert!(ran.took < Duration::from_secs(8), "{ran:?}");
    #[cfg(unix)]
    {
        // and the first Ctrl-C
        let started = Instant::now();
        let child = spawn(smedcover(&folder, &["profiles"]));
        thread::sleep(Duration::from_millis(800));
        // SAFETY: a signal to the command line's process, which is running
        assert_eq!(unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) }, 0);
        let ran = finish(child, started);
        assert_eq!(ran.code, 130, "{ran:?}");
        assert!(ran.took < Duration::from_secs(5), "{ran:?}");
    }
}

// ---- failures ----

fn a_tools_error_is_exit_1_with_its_kind() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["call", "fail_tool"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(ran.stderr.trim(), "smedcover: The fake page could not do it.");
    let ran = run(smedcover(&folder, &["--json", "call", "fail_tool", "{}"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["error"], json!({"kind": "busy", "message": "The fake page could not do it.", "exit": 1}));
    // arguments the tool does not take: the page's refusal, said as it says it
    let ran = run(smedcover(&folder, &["--json", "call", "set_text", r#"{"titel": "x"}"#]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert!(ran.stderr.contains("titel is not an argument it takes"), "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["error"]["kind"], "invalid_arguments");
    // a tool the app does not have: the command was not right
    let ran = run(smedcover(&folder, &["call", "no_such_tool"]));
    assert_eq!(ran.code, 2, "{ran:?}");
    assert!(ran.stderr.contains("SmedCover has no tool \"no_such_tool\""), "{ran:?}");
}

fn an_export_stopped_part_way_is_exit_1_in_one_document() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[("FAKE_MODE", "export_cancelled")]).ready(&folder);
    let ran = run(smedcover(&folder, &["--json", "export", "--channels", "all", "--out", "covers"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    let said = json_of(&ran.stdout);
    assert_eq!((said["files"].as_array().unwrap().len(), said["cancelled"].as_bool()), (1, Some(true)), "{said}");
    assert_eq!(said["error"]["kind"], "cancelled");
    let ran = run(smedcover(&folder, &["export", "--channels", "all", "--out", "covers"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(ran.stdout.lines().count(), 1, "the file it wrote: {ran:?}");
    assert!(ran.stderr.contains("1 file written to") && ran.stderr.contains("stopped part-way"), "{ran:?}");
}

fn the_command_lines_timeout_cancels_and_is_exit_4() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["--timeout", "1", "call", "slow_tool"]));
    assert_eq!(ran.code, 4, "{ran:?}");
    assert!(ran.stderr.contains("No answer within --timeout 1 s: the call was cancelled"), "{ran:?}");
    assert!(ran.took < Duration::from_secs(10), "{ran:?}");
    // the app was told: the call let go of
    assert!(folder.wait_for("cancelled", Duration::from_secs(5)), "{:?}", folder.log());
}

fn the_apps_own_timeout_is_exit_4() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["--json", "call", "quiet_tool"]));
    assert_eq!(ran.code, 4, "{ran:?}");
    assert!(ran.stderr.contains("SmedCover did not answer in time"), "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["error"]["kind"], "timeout");
}

fn an_app_that_quits_early_or_is_not_there_is_exit_3() {
    let folder = Folder::new();
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("FAKE_MODE", "crash");
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("SmedCover quit before it was ready"), "{ran:?}");
    assert!(ran.took < Duration::from_secs(10), "not waited for the full 30 s: {ran:?}");

    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("SMEDCOVER_APP", folder.path("no-such-app"));
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("Could not find the SmedCover app at"), "{ran:?}");
}

fn usage_errors_are_exit_2_and_start_nothing() {
    let folder = Folder::new();
    fs::write(folder.path("not-an-object.json"), "[1, 2]").unwrap();
    fs::write(folder.path("latin1.csv"), b"Vlog,Caf\xe9\n").unwrap();
    for args in [
        vec!["render", "1"],
        vec!["render", "1", "-o", "nowhere/x.png"],
        vec!["render", "1", "-o", "x.png", "--format", "gif"],
        vec!["render", "1", "-o", "x.png", "--format", "jpg"],
        vec!["render", "1", "-o", "x.png", "--size", "16:9", "--size-key", "1920x1080"],
        vec!["export", "--scale", "9"],
        vec!["export", "--channels", "1,,2"],
        vec!["export", "--sizes", "all,16:9"],
        vec!["batch", "missing.csv"],
        vec!["batch", "latin1.csv"],
        vec!["import", "missing.smedcover.json"],
        vec!["import", "x", "--as", "elsewhere"],
        vec!["call", "set_text", "not json"],
        vec!["call", "set_text", "[1, 2]"],
        vec!["--timeout", "-1", "profiles"],
        vec!["frobnicate"],
        vec![],
    ] {
        let ran = run(smedcover(&folder, &args));
        assert_eq!(ran.code, 2, "{args:?}: {ran:?}");
        assert!(!ran.stderr.trim().is_empty(), "{args:?} says why");
    }
    let ran = run(smedcover(&folder, &["batch", "latin1.csv"]));
    assert!(ran.stderr.contains("CSV UTF-8"), "{ran:?}");
    // a CSV on the standard input that is empty
    let ran = run_with(smedcover(&folder, &["batch", "-"]), Some("  \n"));
    assert_eq!(ran.code, 2, "{ran:?}");
    assert!(folder.log().is_empty(), "no app started: {:?}", folder.log());
    // with --json, one document all the same (but clap's own refusals, before anything, print none)
    let ran = run(smedcover(&folder, &["--json", "call", "set_text", "[1]"]));
    assert_eq!((ran.code, json_of(&ran.stdout)["error"]["kind"].as_str()), (2, Some("usage")), "{ran:?}");
    // help and the version are not failures
    let ran = run(smedcover(&folder, &["--help"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.contains("Exit codes:") && ran.stdout.contains("render"), "{ran:?}");
    let ran = run(smedcover(&folder, &["--version"]));
    assert_eq!(ran.stdout.trim(), format!("smedcover {}", env!("CARGO_PKG_VERSION")));
}

// ---- each command ----

fn profiles_as_text_and_json() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.contains("    1. VLOG  (id c1, code V, #ff3366)  ← shown\n"), "{ran:?}");
    assert!(ran.stdout.contains("    1920x1080  YouTube 16:9  ✓  ← shown\n"), "{ran:?}");
    assert!(ran.stdout.contains("Other  (id p2)\n"), "{ran:?}");
    let ran = run(smedcover(&folder, &["profiles", "--json"]));
    assert_eq!(json_of(&ran.stdout), fake::context());
}

fn render_puts_one_file_where_it_is_asked() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    fs::create_dir_all(folder.path("out")).unwrap();
    let ran = run(smedcover(&folder, &["render", "VLOG", "--size", "16:9", "-o", "out/cover.png"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    let target = folder.path("out").join("cover.png");
    assert_eq!(ran.stdout.trim(), target.to_string_lossy());
    assert_eq!(fs::read_to_string(&target).unwrap(), "fake cover VLOG 16:9");
    // nothing else left beside it
    let names: Vec<_> = fs::read_dir(folder.path("out")).unwrap().map(|e| e.unwrap().file_name()).collect();
    assert_eq!(names, ["cover.png"]);
    // the export was of that channel at that size into a folder beside it, in the file's format
    let call = folder.log().into_iter().find(|l| l.starts_with("call export")).unwrap();
    let args = json_of(call.trim_start_matches("call export "));
    assert_eq!((args["channels"].clone(), args["sizes"].clone(), args["format"].clone()), (json!(["VLOG"]), json!(["16:9"]), json!("png")));
    assert!(Path::new(args["dir"].as_str().unwrap()).starts_with(folder.path("out")));

    // no size: the one on the canvas; the file there is replaced; --json
    fs::write(folder.path("c.jpg"), "old").unwrap();
    let ran = run(smedcover(&folder, &["--json", "render", "2", "-o", "c.jpg", "--scale", "2"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    let said = json_of(&ran.stdout);
    assert_eq!((said["path"].as_str(), said["size"].as_str()), (Some(folder.path("c.jpg").to_str().unwrap()), Some("1920x1080")));
    assert_eq!(fs::read_to_string(folder.path("c.jpg")).unwrap(), "fake cover 2 1920x1080");
    let call = folder.log().into_iter().rfind(|l| l.starts_with("call export")).unwrap();
    let args = json_of(call.trim_start_matches("call export "));
    assert_eq!((args["format"].as_str(), args["scale"].as_i64()), (Some("jpeg"), Some(2)));
}

fn export_and_batch_print_their_files_and_progress() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["export", "--channels", "all", "--sizes", "16:9,9:16", "--out", "covers", "--format", "webp"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    let files: Vec<&str> = ran.stdout.lines().collect();
    assert_eq!(files.len(), 4, "{ran:?}");
    assert!(files.iter().all(|f| Path::new(f).is_file() && f.ends_with(".webp") && Path::new(f).starts_with(folder.path("covers"))));
    // progress and the count on the standard error, not mixed with the files
    assert!(ran.stderr.contains("Writing c1_16-9.webp (1 of 4).") && ran.stderr.contains("Writing c2_9-16.webp (4 of 4)."), "{ran:?}");
    assert!(ran.stderr.contains(&format!("4 files written to {}", folder.path("covers").display())), "{ran:?}");

    let ran = run(smedcover(&folder, &["export", "--quiet", "--json"]));
    assert_eq!((ran.code, ran.stderr.as_str()), (0, ""), "{ran:?}");
    let said = json_of(&ran.stdout);
    assert_eq!(said["files"].as_array().unwrap().len(), 1);

    fs::write(folder.path("jobs.csv"), "channel,title,tag,subtitle\nVlog,First,EP.01,\nTravel,Second,,\n").unwrap();
    let ran = run(smedcover(&folder, &["batch", "jobs.csv", "--sizes", "16:9", "--out", "batch", "--profile", "Mine"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(ran.stdout.lines().count(), 2, "{ran:?}");
    assert!(ran.stderr.contains("2 files written to"), "{ran:?}");
    let call = folder.log().into_iter().find(|l| l.starts_with("call batch_covers")).unwrap();
    let args = json_of(call.trim_start_matches("call batch_covers "));
    assert_eq!(args["csv"], "channel,title,tag,subtitle\nVlog,First,EP.01,\nTravel,Second,,\n");
    assert_eq!(args["profile"], "Mine");
    // the CSV on the standard input
    let ran = run_with(smedcover(&folder, &["batch", "-", "--out", "batch2"]), Some("Vlog,Third\n"));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(ran.stdout.lines().count(), 2, "every size of the profile: {ran:?}");
}

fn import_opens_a_project_by_its_absolute_path() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    fs::write(folder.path("brand.smedcover.json"), "{}").unwrap();
    let ran = run(smedcover(&folder, &["import", "brand.smedcover.json", "--as", "current"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(ran.stdout.trim(), "Opened in the profile \"Imported\" (already here), channel c1");
    let call = folder.log().into_iter().find(|l| l.starts_with("call open_project")).unwrap();
    let args = json_of(call.trim_start_matches("call open_project "));
    assert_eq!(args, json!({"file": folder.path("brand.smedcover.json").to_string_lossy(), "as": "current"}));
    let ran = run(smedcover(&folder, &["import", "brand.smedcover.json", "--json"]));
    assert_eq!(json_of(&ran.stdout)["profile"]["created"], true);
}

fn tools_lists_the_apps_tools() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["tools"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    let listed: Vec<&str> = ran.stdout.lines().map(|l| l.split_whitespace().next().unwrap()).collect();
    let app_tools: Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/tools.json"))).unwrap();
    for tool in app_tools["tools"].as_array().unwrap() {
        assert!(listed.contains(&tool["name"].as_str().unwrap()), "{} in {listed:?}", tool["name"]);
    }
    assert!(ran.stdout.contains("get_context") && ran.stdout.lines().any(|l| l.starts_with("export ") && l.contains("Writes covers to image files")), "{ran:?}");
    let ran = run(smedcover(&folder, &["tools", "--json"]));
    let all = json_of(&ran.stdout);
    let export = all.as_array().unwrap().iter().find(|t| t["name"] == "export").unwrap();
    assert!(export["inputSchema"]["properties"]["channels"].is_object());
}

fn call_prints_text_and_saves_or_describes_images() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["call", "set_text", r#"{"title": "Hi"}"#]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(json_of(&ran.stdout), json!({"tool": "set_text", "args": {"title": "Hi"}}));
    // the arguments from the standard input
    let ran = run_with(smedcover(&folder, &["call", "set_text", "-"]), Some(r#"{"tag": "EP.02"}"#));
    assert_eq!(json_of(&ran.stdout)["args"], json!({"tag": "EP.02"}));
    let ran = run(smedcover(&folder, &["call", "render_preview"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.starts_with("[image 1: image/png, 70 B; --save-images DIR saves it]\n{\n  \"size\": \"1920x1080\"\n}"), "{ran:?}");
    let ran = run(smedcover(&folder, &["call", "render_preview", "--save-images", "shots"]));
    let saved = folder.path("shots").join("render_preview-1.png");
    assert!(ran.stdout.contains(&format!("image 1 saved: {}", saved.display())), "{ran:?}");
    assert!(fs::read(&saved).unwrap().starts_with(b"\x89PNG"));
    let ran = run(smedcover(&folder, &["call", "render_preview", "--json"]));
    let result = json_of(&ran.stdout);
    assert_eq!(result["content"][0]["type"], "image");
    assert!(result["content"][0]["data"].as_str().is_some_and(|d| !d.is_empty()));
}

fn a_self_tests_folder_is_the_apps() {
    // SMEDCOVER_SELFTEST=<folder> keeps the app's data in <folder>/data, and the command line looks there too, before
    // SMEDCOVER_DATA, as the app does
    let folder = Folder::new();
    let root = folder.path("selftest");
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("SMEDCOVER_SELFTEST", &root);
    let ran = run(cmd);
    assert_eq!(ran.code, 0, "{ran:?}");
    let log = |name: &str| fs::read_to_string(root.join("data").join(name)).unwrap_or_default();
    let until = Instant::now() + Duration::from_secs(10);
    while !log("fake-app.log").contains("exit done") && Instant::now() < until {
        thread::sleep(Duration::from_millis(50));
    }
    let said = log("fake-app.log");
    assert!(said.contains("start --cli") && said.contains("call get_context") && said.contains("exit done"), "{said}");
    assert!(folder.log().is_empty(), "nothing in SMEDCOVER_DATA's folder");
}

#[cfg(unix)]
fn ctrl_c_cancels_the_call_and_lets_the_app_go() {
    let folder = Folder::new();
    let started = Instant::now();
    let child = spawn(smedcover(&folder, &["call", "slow_tool"]));
    assert!(folder.wait_for("call slow_tool", Duration::from_secs(20)), "{:?}", folder.log());
    // SAFETY: a signal to the command line's process, which is running
    assert_eq!(unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) }, 0);
    let ran = finish(child, started);
    assert_eq!(ran.code, 130, "{ran:?}");
    assert!(ran.stderr.contains("Interrupted: the call was cancelled."), "{ran:?}");
    // the app played was started for it: the call cancelled, then the app let go
    assert!(folder.wait_for("exit", Duration::from_secs(10)), "{:?}", folder.log());
    let log = folder.log();
    let at = |what: &str| log.iter().position(|l| l.starts_with(what)).unwrap_or_else(|| panic!("{what} in {log:?}"));
    assert!(at("cancelled") < at("exit") && at("done") < at("exit"), "{log:?}");
}

#[cfg(unix)]
fn ctrl_c_with_nothing_in_hand_exits_at_once() {
    // reading the CSV from the standard input, before any app is reached: the first Ctrl-C exits, and starts nothing
    let folder = Folder::new();
    let started = Instant::now();
    let mut cmd = smedcover(&folder, &["batch", "-", "--out", "o"]);
    let mut child = cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let stdin = child.stdin.take();
    thread::sleep(Duration::from_millis(500));
    // SAFETY: a signal to the command line's process, which is running
    assert_eq!(unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) }, 0);
    let ran = finish(child, started);
    drop(stdin);
    // 130 from its handler; or, on a machine so busy the signal came before the handler was there, ended by it (-1
    // here): either way at once, the input still open (a Ctrl-C swallowed would leave it waiting for it)
    assert!(ran.code == 130 || ran.code == -1, "{ran:?}");
    assert!(ran.took < Duration::from_secs(3), "{ran:?}");
    thread::sleep(Duration::from_millis(300));
    assert!(folder.log().is_empty(), "no app started: {:?}", folder.log());
}
