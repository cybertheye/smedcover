//! The app, played: what the command line expects of SmedCover, with a page played here behind the core's own
//! endpoint. It is this test program started again with `SMEDCOVER_FAKE_APP` set (by a test, or by the command line
//! under test, which passes its environment on), so no app is needed and nothing of the user's is touched.
//!
//! - It keeps its data in `SMEDCOVER_DATA` (else `SMEDCOVER_SELFTEST`'s `data/`, as the app does), writes `cli.json`
//!   there (`launchedBy` "cli" when started with `--cli`, else "user"), and serves on a port of its own, with a token
//!   of its own: `/health`, `/app/show`, `/app/done`, and `/mcp`, which is the core's (`McpServer::router`), the
//!   tools of `ui/tools.json` and three more for the tests (`fail_tool`, `slow_tool`, `quiet_tool`).
//! - Its page checks every call's arguments against the tool's schema (as the real page's `checkCall` does) and
//!   answers `get_context`, `export`, `batch_covers` (writing small files), `open_project` and `render_preview` as the
//!   app would; any other tool says back what it was asked.
//! - It quits on `/app/done` (when the command line started it), when its standard input ends, or after two minutes.
//! - What it does goes into `fake-app.log` in its data folder, a line each: `<pid> <what>`.
//! - `FAKE_MODE` (commas between): `already_running` (exit 75 at once), `crash` (exit 1 at once), `needs_setup`.
//!   `FAKE_CLI_JSON_MS`: how long before it writes `cli.json` (0); `FAKE_READY_MS`: how long more before it is ready
//!   (150); `FAKE_VERSION`: the version it says.

use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use hyper_util::rt::TokioIo;
use hyper_util::service::TowerToHyperService;
use serde_json::{json, Value};
use smedcover_core::mcp::bridge::{read_result, BoxFut, BridgeError, Call, CallToolResult, PageBridge, PageState, Progress};
use smedcover_core::mcp::server::{Access, McpServer, Stats};
use smedcover_core::mcp::{Host, Secret, ToolList};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::schema;

/// Set, the program is the app played, not the tests.
pub const ENV: &str = "SMEDCOVER_FAKE_APP";
/// The exit code of an app that finds another already running on its folder (the command line's `ALREADY_RUNNING`).
pub const ALREADY_RUNNING: i32 = 75;
/// How long it runs at most.
const LIFETIME: Duration = Duration::from_secs(120);

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/// The tools the tests add to the app's own.
const TEST_TOOLS: &str = r#"[
  {"name": "fail_tool", "description": "Fails, as the page does when it cannot do something.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 5000}},
  {"name": "slow_tool", "description": "Runs till it is cancelled.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 60000}},
  {"name": "quiet_tool", "description": "Goes quiet past its timeout.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"timeoutMs": 1000}}
]"#;

/// The app's data folder, as it finds it.
pub fn data_folder() -> PathBuf {
    match env::var_os("SMEDCOVER_DATA").filter(|d| !d.is_empty()) {
        Some(data) => PathBuf::from(data),
        None => PathBuf::from(env::var_os("SMEDCOVER_SELFTEST").expect("a data folder for the app played")).join("data"),
    }
}

/// Notes what the app did, in its data folder's `fake-app.log`.
pub fn log(data: &Path, what: &str) {
    let _ = fs::create_dir_all(data);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(data.join("fake-app.log")) {
        let _ = file.write_all(format!("{} {what}\n", std::process::id()).as_bytes());
    }
}

struct App {
    data: PathBuf,
    token: String,
    version: String,
    port: Mutex<u16>,
    ready: AtomicBool,
    needs_setup: bool,
    launched_by: Mutex<String>,
    done: Notify,
    /// Whether `/app/done` came (the standard input's end may come before its quitting does).
    done_asked: AtomicBool,
}

impl App {
    fn allowed(&self, headers: &HeaderMap) -> bool {
        headers.get("authorization").and_then(|v| v.to_str().ok()) == Some(format!("Bearer {}", self.token).as_str())
    }

    fn write_cli_json(&self) {
        let text = json!({
            "format": 1, "pid": std::process::id(), "port": *self.port.lock().unwrap(), "token": self.token,
            "version": self.version, "launchedBy": *self.launched_by.lock().unwrap(), "ready": self.ready.load(Ordering::SeqCst),
        })
        .to_string();
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
        let _ = fs::remove_file(self.data.join("cli.json"));
        log(&self.data, &format!("exit {why}"));
        std::process::exit(0);
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
    let needs_setup = has("needs_setup");
    runtime.block_on(serve(data, for_cli, needs_setup))
}

fn millis(name: &str, default: u64) -> Duration {
    Duration::from_millis(env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default))
}

async fn serve(data: PathBuf, for_cli: bool, needs_setup: bool) -> ! {
    let mut tools: Value = serde_json::from_str(include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/../ui/tools.json"))).unwrap();
    let extra: Value = serde_json::from_str(TEST_TOOLS).unwrap();
    tools["tools"].as_array_mut().unwrap().extend(extra.as_array().unwrap().iter().cloned());
    let schemas: HashMap<String, Value> =
        tools["tools"].as_array().unwrap().iter().map(|t| (t["name"].as_str().unwrap().to_string(), t["inputSchema"].clone())).collect();
    let list = Arc::new(ToolList::from_json(&tools.to_string(), Host::Desktop).expect("the tools"));
    let secret = Secret::generate().expect("a token");
    let app = Arc::new(App {
        data: data.clone(),
        token: secret.expose().to_string(),
        version: env::var("FAKE_VERSION").unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string()),
        port: Mutex::new(0),
        ready: AtomicBool::new(false),
        needs_setup,
        launched_by: Mutex::new(if for_cli { "cli" } else { "user" }.to_string()),
        done: Notify::new(),
        done_asked: AtomicBool::new(false),
    });
    let page = Arc::new(FakePage { data: data.clone(), schemas, needs_setup });
    let server = McpServer::new(page, list, Arc::new(RwLock::new(Access::Token(secret))), Arc::new(Stats::new()));
    let routes = Router::new()
        .route("/health", get(health))
        .route("/app/show", post(show))
        .route("/app/done", post(done))
        .with_state(app.clone())
        .fallback_service(server.router(CancellationToken::new()));
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
    // its standard input's end: the command line that holds it gone (a user's app played here quits so too, so that a
    // test that fails leaves nothing running)
    let ended = Arc::new(Notify::new());
    let tell = ended.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 256];
        let mut stdin = std::io::stdin();
        while matches!(stdin.read(&mut buf), Ok(n) if n > 0) {}
        tell.notify_one();
    });
    let starting = {
        let app = app.clone();
        async move {
            tokio::time::sleep(millis("FAKE_CLI_JSON_MS", 0)).await;
            app.write_cli_json();
            log(&app.data, "listening");
            tokio::time::sleep(millis("FAKE_READY_MS", 150)).await;
            app.ready.store(true, Ordering::SeqCst);
            app.write_cli_json();
            log(&app.data, "ready");
            std::future::pending::<()>().await;
        }
    };
    tokio::select! {
        _ = starting => unreachable!(),
        _ = app.done.notified() => app.quit("done"),
        _ = ended.notified() => app.quit(if app.done_asked.load(Ordering::SeqCst) { "done" } else { "stdin-eof" }),
        _ = tokio::time::sleep(LIFETIME) => app.quit("lifetime"),
    }
}

async fn health(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.allowed(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let ready = app.ready.load(Ordering::SeqCst);
    Json(json!({"name": "smedcover", "version": app.version, "page": if ready { "ready" } else { "loading" }, "ready": ready, "needsSetup": app.needs_setup && ready}))
        .into_response()
}

async fn show(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.allowed(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    log(&app.data, "show");
    *app.launched_by.lock().unwrap() = "user".into();
    app.write_cli_json();
    Json(json!({})).into_response()
}

async fn done(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.allowed(&headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if app.launched_by.lock().unwrap().as_str() == "cli" {
        log(&app.data, "done");
        app.done_asked.store(true, Ordering::SeqCst);
        let quit = app.clone();
        tokio::spawn(async move {
            // the answer goes out first
            tokio::time::sleep(Duration::from_millis(50)).await;
            quit.done.notify_one();
        });
    } else {
        log(&app.data, "done (stays: the user's)");
    }
    Json(json!({})).into_response()
}

struct FakePage {
    data: PathBuf,
    schemas: HashMap<String, Value>,
    needs_setup: bool,
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
            let args = Value::Object(call.args.clone());
            log(&self.data, &format!("call {} {args}", call.tool));
            if self.needs_setup {
                return Err(BridgeError::NotReady);
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
                "fail_tool" => Err(BridgeError::Page { code: "failed".into(), message: "The fake page could not do it.".into() }),
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
        PageState::Ready { epoch: 1 }
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
            if call.cancel.is_cancelled() {
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
