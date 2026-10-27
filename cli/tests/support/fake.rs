//! The app, played: what the command line expects of SmedCover, as the app does it (ARCHITECTURE.md 10.7,
//! `src-tauri/src/cli.rs`), with a page played here behind the core's own endpoint. It is this test program started
//! again with `SMEDCOVER_FAKE_APP` set (by a test, or by the command line under test, which passes its environment
//! on), so no app is needed and nothing of the user's is touched.
//!
//! - It keeps its data where the app would (`smedcover_core::paths::data_dir`: a self-test's `data/`, else
//!   `SMEDCOVER_DATA`), writes `cli.json` there (`launchedBy` "cli" when started with `--cli`, else "user") once it
//!   listens and again when it is ready, and serves the core's command-line endpoint (`McpServer::with_app`): `/mcp`
//!   with the tools of `ui/tools.json` and three more for the tests (`fail_tool`, `slow_tool`, `quiet_tool`), and
//!   `/health`, `/app/show` and `/app/done`, answered here as the app answers them, every route wanting the token.
//! - Its page is `loading` till it is ready; it checks every call's arguments against the tool's schema (as the real
//!   page's `checkCall` does) and answers `get_context`, `export`, `batch_covers` (writing small files),
//!   `open_project` and `render_preview` as the app would; any other tool says back what it was asked.
//! - Told the command line is done (`/app/done`, or the end of its standard input) while it is the command line's, it
//!   says `quitting: true` in `cli.json`, is still used by any command line that finds it, and quits (taking `cli.json`
//!   away) once no call is in hand and none has come for 2 s; the user's (started
//!   without `--cli`, or shown since with `/app/show`) it goes on, and the end of its input is let be. A test's own
//!   app played (`FAKE_TEST_OWNED`) quits at its input's end whatever it is, so that a test leaves nothing running.
//!   It quits after two minutes in any case (`FAKE_LIFETIME_MS`).
//! - What it does goes into `fake-app.log` in its data folder, a line each: `<pid> <what>`.
//! - `FAKE_MODE` (commas between): `already_running` (exit 75 at once), `crash` (exit 1 at once), `needs_setup` (the
//!   first start's welcome: `needsSetup` from the first `/health`, every call refused so), `export_cancelled` (an
//!   export stops after its first file, as when it is cancelled in the window). `FAKE_CLI_JSON_MS`: how long before it
//!   writes `cli.json` (0); `FAKE_CLI_JSON_AFTER`: a file it waits for before it writes it; `FAKE_READY_MS`: how long
//!   more before it is ready (150); `FAKE_VERSION`: the version it says.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use serde_json::{json, Map, Value};
use smedcover_core::mcp::bridge::{read_result, BoxFut, BridgeError, Call, CallToolResult, PageBridge, PageState, Progress};
use smedcover_core::mcp::server::{Access, AppControl, McpServer, Stats};
use smedcover_core::mcp::{Host, Secret, ToolList};
use tokio::runtime::Handle;
use tokio_util::sync::CancellationToken;

use super::schema;

/// Set, the program is the app played, not the tests.
pub const ENV: &str = "SMEDCOVER_FAKE_APP";
/// The exit code of an app that finds another already running on its folder.
pub const ALREADY_RUNNING: i32 = smedcover_core::instance::EXIT_ALREADY_RUNNING;
/// How long the command line's app waits, once it is to quit, for no call to have come (the app's `QUIET_FOR`).
const QUIET_FOR_MS: u64 = 2000;

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// The tools the tests add to the app's own.
const TEST_TOOLS: &str = r#"[
  {"name": "fail_tool", "description": "Fails, as the page does when it cannot do something.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 5000}},
  {"name": "slow_tool", "description": "Runs till it is cancelled.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 60000}},
  {"name": "quiet_tool", "description": "Goes quiet past its timeout.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 1000}}
]"#;

/// The app's data folder, as it finds it.
pub fn data_folder() -> PathBuf {
    smedcover_core::paths::data_dir().expect("a data folder for the app played")
}

/// Notes what the app did, in its data folder's `fake-app.log`.
pub fn log(data: &Path, what: &str) {
    let _ = fs::create_dir_all(data);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(data.join("fake-app.log")) {
        let _ = file.write_all(format!("{} {what}\n", std::process::id()).as_bytes());
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

fn millis(name: &str, default: u64) -> Duration {
    Duration::from_millis(env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default))
}

/// Whose the app is, and whether it is to quit (the app's `Lifecycle`).
struct Life {
    launched_by: &'static str,
    quitting: bool,
}

/// The app's side of the command line: `cli.json`, the routes, quitting.
struct App {
    data: PathBuf,
    token: Secret,
    version: String,
    port: Mutex<u16>,
    ready: Arc<AtomicBool>,
    needs_setup: bool,
    life: Mutex<Life>,
    stats: Arc<Stats>,
    in_hand: Arc<AtomicUsize>,
    runtime: Handle,
    /// `cli.json` is written from one place at a time.
    writing: Mutex<()>,
}

impl App {
    /// Writes `cli.json` as things are now (`quitting: true` while the app is to quit: it is still used, each request
    /// putting the quitting off).
    fn write_cli_json(&self) {
        let _one = self.writing.lock().unwrap();
        let (launched_by, quitting) = {
            let life = self.life.lock().unwrap();
            (life.launched_by, life.quitting)
        };
        let mut file = json!({
            "format": 1, "pid": std::process::id(), "port": *self.port.lock().unwrap(), "token": self.token.expose(),
            "version": self.version, "launchedBy": launched_by, "ready": self.ready.load(Ordering::SeqCst),
        });
        if quitting {
            file["quitting"] = json!(true);
        }
        let text = file.to_string();
        let tmp = self.data.join(format!("cli.json.{}.tmp", std::process::id()));
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        options.open(&tmp).and_then(|mut f| f.write_all(text.as_bytes())).expect("cli.json written");
        fs::rename(&tmp, self.data.join("cli.json")).expect("cli.json in place");
    }

    fn quit(&self, why: &str) -> ! {
        // held till the process ends: cli.json is not written again
        let _one = self.writing.lock().unwrap_or_else(|e| e.into_inner());
        let _ = fs::remove_file(self.data.join("cli.json"));
        log(&self.data, &format!("exit {why}"));
        std::process::exit(0);
    }

    /// The command line is done with the app: it quits, unless it is the user's. Whether it is quitting.
    fn finish(self: &Arc<Self>, why: &'static str) -> bool {
        let begins = {
            let mut life = self.life.lock().unwrap();
            if life.launched_by == "user" {
                return false;
            }
            let begins = !life.quitting;
            life.quitting = true;
            begins
        };
        if begins {
            // cli.json says so: another command line still uses the app, each of its requests putting the quitting off
            self.write_cli_json();
            let me = self.clone();
            self.runtime.spawn(async move { me.quit_when_idle(now_ms(), why).await });
        }
        true
    }

    /// Quits once no call is in hand and none has come for 2 s, from the last request or `since`; not once it is the
    /// user's.
    async fn quit_when_idle(&self, since: u64, why: &str) {
        loop {
            if !self.life.lock().unwrap().quitting {
                return;
            }
            let seen = self.stats.snapshot();
            let last = seen.clients.iter().map(|c| c.last_seen).chain([since]).max().unwrap_or(since);
            if self.in_hand.load(Ordering::SeqCst) == 0 && seen.in_flight == 0 && now_ms().saturating_sub(last) >= QUIET_FOR_MS {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        self.quit(why);
    }
}

/// The routes only the command line's endpoint has, as the app answers them (`CliApp`'s `AppControl`).
struct Control(Arc<App>);

impl AppControl for Control {
    fn health(&self) -> Map<String, Value> {
        let mut extra = Map::new();
        extra.insert("needsSetup".into(), json!(self.0.needs_setup));
        // the version the test asks it to say, over the core's own
        extra.insert("version".into(), json!(self.0.version));
        extra
    }

    fn show(&self) -> Value {
        log(&self.0.data, "show");
        *self.0.life.lock().unwrap() = Life { launched_by: "user", quitting: false };
        self.0.write_cli_json();
        json!({"ok": true, "launchedBy": "user"})
    }

    fn done(&self) -> Value {
        let user = self.0.life.lock().unwrap().launched_by == "user";
        log(&self.0.data, if user { "done (stays: the user's)" } else { "done" });
        let exiting = self.0.finish("done");
        json!({"ok": true, "exiting": exiting, "launchedBy": self.0.life.lock().unwrap().launched_by})
    }
}

/// Runs the app played; never returns.
pub fn main() -> ! {
    let args: Vec<String> = env::args().skip(1).collect();
    let data = data_folder();
    let mode = env::var("FAKE_MODE").unwrap_or_default();
    let has = |m: &str| mode.split(',').any(|x| x.trim() == m);
    log(&data, &format!("start {}", args.join(" ")));
    if has("already_running") {
        log(&data, &format!("exit {ALREADY_RUNNING}"));
        std::process::exit(ALREADY_RUNNING);
    }
    if has("crash") {
        log(&data, "exit 1");
        std::process::exit(1);
    }
    let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("a runtime");
    let for_cli = args.iter().any(|a| a == "--cli");
    let modes = Modes { needs_setup: has("needs_setup"), export_cancelled: has("export_cancelled") };
    runtime.block_on(serve(data, for_cli, modes))
}

#[derive(Clone, Copy)]
struct Modes {
    needs_setup: bool,
    export_cancelled: bool,
}

async fn serve(data: PathBuf, for_cli: bool, modes: Modes) -> ! {
    let mut tools: Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/tools.json"))).unwrap();
    let extra: Value = serde_json::from_str(TEST_TOOLS).unwrap();
    tools["tools"].as_array_mut().unwrap().extend(extra.as_array().unwrap().iter().cloned());
    let schemas: HashMap<String, Value> =
        tools["tools"].as_array().unwrap().iter().map(|t| (t["name"].as_str().unwrap().to_string(), t["inputSchema"].clone())).collect();
    let list = Arc::new(ToolList::from_json(&tools.to_string(), Host::Desktop).expect("the tools"));
    let secret = Secret::generate().expect("a token");
    let ready = Arc::new(AtomicBool::new(false));
    let in_hand = Arc::new(AtomicUsize::new(0));
    let stats = Arc::new(Stats::new());
    let app = Arc::new(App {
        data: data.clone(),
        token: secret.clone(),
        version: env::var("FAKE_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string()),
        port: Mutex::new(0),
        ready: ready.clone(),
        needs_setup: modes.needs_setup,
        life: Mutex::new(Life { launched_by: if for_cli { "cli" } else { "user" }, quitting: false }),
        stats: stats.clone(),
        in_hand: in_hand.clone(),
        runtime: Handle::current(),
        writing: Mutex::new(()),
    });
    let page = Arc::new(FakePage { data: data.clone(), schemas, modes, ready: ready.clone(), in_hand });
    let server = McpServer::new(page, list, Arc::new(RwLock::new(Access::Token(secret))), stats).with_app(Arc::new(Control(app.clone())));
    let routes = server.router(CancellationToken::new());
    let listener = tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.expect("a port");
    *app.port.lock().unwrap() = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                continue;
            };
            let service = TowerToHyperService::new(routes.clone());
            tokio::spawn(async move {
                let _ = hyper::server::conn::http1::Builder::new().serve_connection(TokioIo::new(stream), service).await;
            });
        }
    });
    // its standard input's end: the command line that holds it gone
    let test_owned = env::var_os("FAKE_TEST_OWNED").is_some();
    {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 256];
            let mut stdin = std::io::stdin();
            while matches!(stdin.read(&mut buf), Ok(n) if n > 0) {}
            if test_owned {
                app.quit("test-over");
            }
            let user = app.life.lock().unwrap().launched_by == "user";
            log(&app.data, if user { "stdin-eof (stays: the user's)" } else { "stdin-eof" });
            app.finish("stdin-eof");
        });
    }
    {
        let app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(millis("FAKE_CLI_JSON_MS", 0)).await;
            if let Some(go) = env::var_os("FAKE_CLI_JSON_AFTER").map(PathBuf::from) {
                let until = std::time::Instant::now() + Duration::from_secs(30);
                while !go.exists() && std::time::Instant::now() < until {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            }
            app.write_cli_json();
            log(&app.data, "listening");
            tokio::time::sleep(millis("FAKE_READY_MS", 150)).await;
            app.ready.store(true, Ordering::SeqCst);
            app.write_cli_json();
            log(&app.data, "ready");
        });
    }
    tokio::time::sleep(millis("FAKE_LIFETIME_MS", 120_000)).await;
    app.quit("lifetime")
}

struct FakePage {
    data: PathBuf,
    schemas: HashMap<String, Value>,
    modes: Modes,
    ready: Arc<AtomicBool>,
    in_hand: Arc<AtomicUsize>,
}

/// Counts a call in hand while it runs.
struct InHand<'a>(&'a AtomicUsize);

impl Drop for InHand<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn ok(structured: Value) -> Result<CallToolResult, BridgeError> {
    read_result(json!({"structuredContent": structured}))
}

fn refused(message: String) -> Result<CallToolResult, BridgeError> {
    Err(BridgeError::Page { code: "invalid_arguments".into(), message })
}

impl PageBridge for FakePage {
    fn call(&self, call: Call) -> BoxFut<'_, Result<CallToolResult, BridgeError>> {
        Box::pin(async move {
            self.in_hand.fetch_add(1, Ordering::SeqCst);
            let _in_hand = InHand(&self.in_hand);
            let args = Value::Object(call.args.clone());
            log(&self.data, &format!("call {} {args}", call.tool));
            if self.modes.needs_setup {
                return Err(BridgeError::Page {
                    code: "needs_setup".into(),
                    message: "SmedCover is not set up yet: open it once and finish its welcome, then try again.".into(),
                });
            }
            if let Some(schema) = self.schemas.get(&call.tool) {
                if let Err(why) = schema::check(schema, &args, &call.tool) {
                    log(&self.data, &format!("refused {why}"));
                    return refused(why);
                }
            }
            match call.tool.as_str() {
                "get_context" => ok(context()),
                "export" => self.export(&call).await,
                "batch_covers" => self.batch(&call).await,
                "open_project" => {
                    let file = args["file"].as_str().map(PathBuf::from).unwrap_or_default();
                    if !file.is_absolute() || !file.is_file() {
                        return refused(format!("No project file {}.", file.display()));
                    }
                    ok(json!({"profile": {"id": "p9", "name": "Imported", "created": args["as"] != "current"}, "channel": "c1", "warnings": []}))
                }
                "render_preview" => read_result(json!({"content": [{"type": "image", "data": PNG, "mimeType": "image/png"}, {"type": "text", "text": "{\"size\":\"1920x1080\"}"}]})),
                "fail_tool" => Err(BridgeError::Page { code: "busy".into(), message: "The fake page could not do it.".into() }),
                "slow_tool" => {
                    tokio::select! {
                        _ = call.cancel.cancelled() => {
                            log(&self.data, "cancelled");
                            Err(BridgeError::Cancelled)
                        }
                        _ = tokio::time::sleep(Duration::from_secs(60)) => ok(json!({})),
                    }
                }
                // what the dispatcher answers when the page goes quiet past the tool's timeout
                "quiet_tool" => {
                    tokio::time::sleep(Duration::from_millis(200)).await;
                    Err(BridgeError::Timeout)
                }
                _ => ok(json!({"tool": call.tool, "args": args})),
            }
        })
    }

    fn page(&self) -> PageState {
        if self.ready.load(Ordering::SeqCst) {
            PageState::Ready { epoch: 1 }
        } else {
            PageState::Loading
        }
    }
}

/// The profiles the app played has, `p1` shown.
pub fn context() -> Value {
    json!({
        "app": {"version": env!("CARGO_PKG_VERSION"), "host": "desktop"},
        "profiles": [
            {"id": "p1", "name": "Mine", "brand": "Mine", "look": "night", "theme": "dark", "exportDir": "",
             "channels": [{"id": "c1", "name": "VLOG", "code": "V", "color": "#ff3366"}, {"id": "c2", "name": "Travel", "code": "T", "color": "#22aa88"}],
             "sizes": [{"key": "1920x1080", "w": 1920, "h": 1080, "caption": "YouTube 16:9", "orient": "wide", "ticked": true},
                       {"key": "1080x1920", "w": 1080, "h": 1920, "caption": "Shorts 9:16", "orient": "tall", "ticked": false}]},
            {"id": "p2", "name": "Other", "channels": [{"id": "o1", "name": "News"}], "sizes": [{"key": "1280x720", "w": 1280, "h": 720}]}
        ],
        "current": {"profile": "p1", "channel": "c1", "size": "1920x1080", "scope": "all", "layer": "bg", "layers": ["bg"]},
    })
}

/// A name or size as it may stand in a file's name.
fn safe(text: &str) -> String {
    text.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

impl FakePage {
    /// The folder a call writes into: its `dir`, else the profile's (here, one in the data folder).
    fn dir_of(&self, call: &Call) -> PathBuf {
        let dir = call.args.get("dir").and_then(Value::as_str).map(PathBuf::from).unwrap_or_else(|| self.data.join("exports"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Writes the files of an export or a batch, telling how it gets on; stopped part-way when it is cancelled.
    async fn write(&self, call: &Call, dir: &Path, jobs: Vec<(String, String, String)>) -> Result<CallToolResult, BridgeError> {
        let ext = match call.args.get("format").and_then(Value::as_str) {
            Some("jpeg") => "jpg",
            Some("webp") => "webp",
            _ => "png",
        };
        let total = jobs.len();
        let mut files = Vec::new();
        for (i, (channel, title, size)) in jobs.into_iter().enumerate() {
            if call.cancel.is_cancelled() || (self.modes.export_cancelled && i == 1) {
                return ok(json!({"dir": dir.to_string_lossy(), "files": files, "cancelled": true}));
            }
            let name = format!("{}_{}.{ext}", safe(&channel), safe(&size));
            let path = dir.join(&name);
            fs::write(&path, format!("fake cover {channel} {size}")).unwrap();
            if let Some(tell) = &call.progress {
                tell(Progress { progress: (i + 1) as f64, total: Some(total as f64), message: Some(format!("Writing {name} ({} of {total}).", i + 1)) });
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
            files.push(json!({"path": path.to_string_lossy(), "channel": channel, "title": title, "size": size}));
        }
        ok(json!({"dir": dir.to_string_lossy(), "files": files}))
    }

    fn sizes_of(call: &Call, default: &[&str]) -> Vec<String> {
        match call.args.get("sizes") {
            Some(Value::String(_)) => vec!["1920x1080".into(), "1080x1920".into()],
            Some(Value::Array(sizes)) => sizes.iter().filter_map(Value::as_str).map(str::to_string).collect(),
            _ => default.iter().map(|s| s.to_string()).collect(),
        }
    }

    async fn export(&self, call: &Call) -> Result<CallToolResult, BridgeError> {
        let channels: Vec<String> = match call.args.get("channels") {
            Some(Value::String(_)) => vec!["c1".into(), "c2".into()],
            Some(Value::Array(channels)) => channels.iter().map(|c| c.as_str().map_or_else(|| c.to_string(), str::to_string)).collect(),
            _ => vec!["c1".into()],
        };
        let sizes = Self::sizes_of(call, &["1920x1080"]);
        let jobs = channels.iter().flat_map(|c| sizes.iter().map(move |z| (c.clone(), "A title".to_string(), z.clone()))).collect();
        let dir = self.dir_of(call);
        self.write(call, &dir, jobs).await
    }

    async fn batch(&self, call: &Call) -> Result<CallToolResult, BridgeError> {
        let csv = call.args.get("csv").and_then(Value::as_str).unwrap_or("");
        let rows: Vec<(String, String)> = csv
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with("channel,"))
            .map(|l| {
                let mut cells = l.split(',');
                (cells.next().unwrap_or("").to_string(), cells.next().unwrap_or("").to_string())
            })
            .collect();
        if rows.is_empty() {
            return refused("No rows in the CSV.".into());
        }
        let sizes = Self::sizes_of(call, &["1920x1080", "1080x1920"]);
        let jobs = rows
            .iter()
            .enumerate()
            .flat_map(|(n, (c, t))| sizes.iter().map(move |z| (format!("{}-{c}", n + 1), t.clone(), z.clone())))
            .collect();
        let dir = self.dir_of(call);
        self.write(call, &dir, jobs).await
    }
}
