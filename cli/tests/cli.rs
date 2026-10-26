//! The command line, `smedcover`, as a user runs it, against the app played here (support/fake.rs: the core's own
//! endpoint, with a page played, and the contract's routes): an app already running used and left alone, one started
//! and let go, one that finds another already running, one that needs setting up, a stale `cli.json`, a tool's error,
//! the command line's own timeout and the app's, Ctrl-C, and each command's output.
//!
//! The same program is the tests and the app they play: started with `SMEDCOVER_FAKE_APP`, it is the app (the command
//! line under test is pointed to it with `SMEDCOVER_APP`). Each test has a data folder of its own, in a temporary
//! folder, so they run side by side and never touch the user's data or app. It has its own main (`harness = false`
//! in Cargo.toml): `cargo test -p smedcover-cli --test cli -- <part of a name>` runs some.

#[path = "support/fake.rs"]
mod fake;
#[path = "support/schema.rs"]
mod schema;

use std::env;
use std::fs;
use std::io::{Read, Write};
use std::panic;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;

const CLI: &str = env!("CARGO_BIN_EXE_smedcover");

type Test = fn();

const TESTS: &[(&str, Test)] = &[
    ("uses_a_running_app_and_leaves_it_alone", uses_a_running_app_and_leaves_it_alone),
    ("starts_the_app_and_lets_it_go", starts_the_app_and_lets_it_go),
    ("uses_the_app_already_running_when_the_one_started_defers", uses_the_app_already_running_when_the_one_started_defers),
    ("an_app_that_needs_setting_up_is_exit_3", an_app_that_needs_setting_up_is_exit_3),
    ("a_stale_cli_json_is_no_app", a_stale_cli_json_is_no_app),
    ("a_tools_error_is_exit_1", a_tools_error_is_exit_1),
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
];

fn main() {
    if env::var_os(fake::ENV).is_some() {
        fake::main();
    }
    let mut filters = Vec::new();
    let mut args = env::args().skip(1);
    let mut list = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--list" => list = true,
            // libtest's flags that take a value, which cargo may pass on
            "--test-threads" | "--color" | "--format" | "--logfile" | "--skip" | "-Z" => {
                args.next();
            }
            a if a.starts_with('-') => {}
            a => filters.push(a.to_string()),
        }
    }
    let chosen: Vec<&(&str, Test)> = TESTS.iter().filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str()))).collect();
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

/// A test's own folder (removed after it), with the data folder in it.
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
        Folder { _root: root, base, data }
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
}

/// The command line, as these tests run it: on the folder's data, pointed to the app played here, in English.
fn smedcover(folder: &Folder, args: &[&str]) -> Command {
    let mut cmd = Command::new(CLI);
    cmd.args(args)
        .current_dir(&folder.base)
        .env(fake::ENV, "1")
        .env("SMEDCOVER_APP", env::current_exe().unwrap())
        .env("SMEDCOVER_DATA", &folder.data)
        .env("LANG", "en_US.UTF-8");
    for name in ["SMEDCOVER_SELFTEST", "SMEDCOVER_SELFTEST_STAY", "LC_ALL", "LC_MESSAGES", "FAKE_MODE", "FAKE_CLI_JSON_MS", "FAKE_CLI_JSON_AFTER", "FAKE_READY_MS", "FAKE_VERSION"] {
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
/// the test is over, however it ends.
struct UserApp {
    child: Child,
    stdin: Option<ChildStdin>,
}

fn user_app(folder: &Folder, env: &[(&str, &str)]) -> UserApp {
    let mut cmd = Command::new(env::current_exe().unwrap());
    cmd.env(fake::ENV, "1").env("SMEDCOVER_DATA", &folder.data).env_remove("FAKE_MODE");
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
}

impl Drop for UserApp {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let until = Instant::now() + Duration::from_secs(5);
        while Instant::now() < until && self.alive() {
            thread::sleep(Duration::from_millis(20));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn json_of(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|e| panic!("not JSON ({e}): {text}"))
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
    let log = folder.log();
    let at = |what: &str| log.iter().position(|l| l.starts_with(what)).unwrap_or_else(|| panic!("{what} in {log:?}"));
    assert!(at("start --cli") < at("ready") && at("ready") < at("call get_context") && at("call get_context") < at("done") && at("done") < at("exit"));
    // gone when the command is: cli.json taken away
    assert!(folder.cli_json().is_none(), "{log:?}");
    assert!(ran.took < Duration::from_secs(15), "{ran:?}");
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
    let child = cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    assert!(folder.wait_for("exit 75", Duration::from_secs(20)), "{:?}", folder.log());
    fs::write(&go, "").unwrap();
    let ran = finish(child, started);
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stdout.contains("Mine  (id p1)"), "{ran:?}");
    let log = folder.log();
    assert!(log.iter().any(|l| l == "start --cli") && log.iter().any(|l| l == "exit 75"), "{log:?}");
    assert!(folder.logged("call get_context"));
    // the app that answered is the user's: not let go
    assert!(!folder.logged("done"), "{log:?}");
}

fn an_app_that_needs_setting_up_is_exit_3() {
    let folder = Folder::new();
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("FAKE_MODE", "needs_setup");
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("Open SmedCover once and finish setting it up"), "{ran:?}");
    assert!(ran.stdout.is_empty());
    // it was started for this: let go
    assert!(folder.logged("done") && folder.logged("exit"), "{:?}", folder.log());
    assert!(!folder.logged("call"), "no tool called");

    // in Chinese where the locale is
    let mut cmd = smedcover(&folder, &["--json", "profiles"]);
    cmd.env("FAKE_MODE", "needs_setup").env("LANG", "zh_CN.UTF-8");
    let ran = run(cmd);
    assert_eq!(ran.code, 3, "{ran:?}");
    assert!(ran.stderr.contains("请先打开 SmedCover，完成首次设置"), "{ran:?}");
    let error = json_of(&ran.stdout);
    assert_eq!((error["error"]["kind"].as_str(), error["error"]["exit"].as_i64()), (Some("app"), Some(3)));

    // and where the app is set to Chinese, whatever the locale
    fs::write(folder.data.join("custom.json"), r#"{"settings": {"lang": "zh"}}"#).unwrap();
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env("FAKE_MODE", "needs_setup");
    let ran = run(cmd);
    assert!(ran.stderr.contains("请先打开 SmedCover"), "{ran:?}");
}

fn a_stale_cli_json_is_no_app() {
    let folder = Folder::new();
    // a process gone, and a port no one listens on
    let mut gone = Command::new(CLI).arg("--version").stdout(Stdio::null()).spawn().unwrap();
    let pid = gone.id();
    gone.wait().unwrap();
    let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let stale = |pid: u32| {
        let text = format!(r#"{{"format": 1, "pid": {pid}, "port": {port}, "token": "smc_stale", "version": "0.0.1", "launchedBy": "user", "ready": true}}"#);
        fs::write(folder.data.join("cli.json"), text).unwrap();
    };
    stale(pid);
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert!(ran.stderr.contains("Starting SmedCover…") && folder.logged("start --cli"), "{ran:?}");
    // a process that is there (this one) but not the app: its port refuses
    stale(std::process::id());
    let ran = run(smedcover(&folder, &["profiles"]));
    assert_eq!(ran.code, 0, "{ran:?}");
    assert_eq!(folder.log().iter().filter(|l| l.starts_with("start --cli")).count(), 2);
    assert!(folder.cli_json().is_none(), "the app started let go, its cli.json with it");
}

// ---- failures ----

fn a_tools_error_is_exit_1() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["call", "fail_tool"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(ran.stderr.trim(), "smedcover: The fake page could not do it.");
    let ran = run(smedcover(&folder, &["--json", "call", "fail_tool", "{}"]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert_eq!(json_of(&ran.stdout)["error"]["kind"], "tool");
    // arguments the tool does not take: the page's refusal, said as it says it
    let ran = run(smedcover(&folder, &["call", "set_text", r#"{"titel": "x"}"#]));
    assert_eq!(ran.code, 1, "{ran:?}");
    assert!(ran.stderr.contains("titel is not an argument it takes"), "{ran:?}");
    // a tool the app does not have: the command was not right
    let ran = run(smedcover(&folder, &["call", "no_such_tool"]));
    assert_eq!(ran.code, 2, "{ran:?}");
    assert!(ran.stderr.contains("SmedCover has no tool \"no_such_tool\""), "{ran:?}");
}

fn the_command_lines_timeout_cancels_and_is_exit_4() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["--timeout", "1", "call", "slow_tool"]));
    assert_eq!(ran.code, 4, "{ran:?}");
    assert!(ran.stderr.contains("No answer within 1 s: the call was cancelled"), "{ran:?}");
    assert!(ran.took < Duration::from_secs(10), "{ran:?}");
    // the app was told: the call let go of
    assert!(folder.wait_for("cancelled", Duration::from_secs(5)), "{:?}", folder.log());
}

fn the_apps_own_timeout_is_exit_4() {
    let folder = Folder::new();
    let _app = user_app(&folder, &[]).ready(&folder);
    let ran = run(smedcover(&folder, &["call", "quiet_tool"]));
    assert_eq!(ran.code, 4, "{ran:?}");
    assert!(ran.stderr.contains("SmedCover did not answer in time"), "{ran:?}");
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
    // a CSV on the standard input that is empty
    let ran = run_with(smedcover(&folder, &["batch", "-"]), Some("  \n"));
    assert_eq!(ran.code, 2, "{ran:?}");
    assert!(folder.log().is_empty(), "no app started: {:?}", folder.log());
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
    assert_eq!((args["channels"].clone(), args["sizes"].clone(), args["format"].clone()), (serde_json::json!(["VLOG"]), serde_json::json!(["16:9"]), serde_json::json!("png")));
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
    assert_eq!(args, serde_json::json!({"file": folder.path("brand.smedcover.json").to_string_lossy(), "as": "current"}));
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
    assert_eq!(json_of(&ran.stdout), serde_json::json!({"tool": "set_text", "args": {"title": "Hi"}}));
    // the arguments from the standard input
    let ran = run_with(smedcover(&folder, &["call", "set_text", "-"]), Some(r#"{"tag": "EP.02"}"#));
    assert_eq!(json_of(&ran.stdout)["args"], serde_json::json!({"tag": "EP.02"}));
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
    // SMEDCOVER_SELFTEST=<folder> keeps the app's data in <folder>/data, and the command line looks there too
    let folder = Folder::new();
    let root = folder.path("selftest");
    let mut cmd = smedcover(&folder, &["profiles"]);
    cmd.env_remove("SMEDCOVER_DATA").env("SMEDCOVER_SELFTEST", &root);
    let ran = run(cmd);
    assert_eq!(ran.code, 0, "{ran:?}");
    let log = fs::read_to_string(root.join("data").join("fake-app.log")).unwrap();
    assert!(log.contains("start --cli") && log.contains("call get_context") && log.contains("exit done"), "{log}");
}

#[cfg(unix)]
fn ctrl_c_cancels_the_call_and_lets_the_app_go() {
    let folder = Folder::new();
    let started = Instant::now();
    let child = smedcover(&folder, &["call", "slow_tool"]).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    assert!(folder.wait_for("call slow_tool", Duration::from_secs(20)), "{:?}", folder.log());
    // SAFETY: a signal to the command line's process, which is running
    assert_eq!(unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGINT) }, 0);
    let ran = finish(child, started);
    assert_eq!(ran.code, 130, "{ran:?}");
    assert!(ran.stderr.contains("Interrupted: the call was cancelled."), "{ran:?}");
    // the app played was started for it: the call cancelled, then the app let go
    let log = folder.log();
    let at = |what: &str| log.iter().position(|l| l.starts_with(what)).unwrap_or_else(|| panic!("{what} in {log:?}"));
    assert!(at("cancelled") < at("exit") && at("done") < at("exit"), "{log:?}");
}
