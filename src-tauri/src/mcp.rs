//! The desktop app's side of the MCP endpoint agents call (the endpoint itself is the core's,
//! `smedcover_core::mcp`): the [`McpHost`] kept as Tauri's state, the window's channel as the
//! dispatcher's [`PageSink`], and the commands the page uses — to take the calls and answer them
//! (`mcp_attach`, `mcp_reply`, `mcp_progress`) and, in Settings → Agents, to turn the endpoint on and
//! off, choose its port and see its token (`mcp_status`, `mcp_set`, `mcp_token`).
//!
//! `mcp.json` in the data folder is Rust's alone: the page asks for what it shows, and every save is
//! made under the host's one lock on its settings. The endpoint starts with the app when it is on
//! (never in self-test mode, unless `SMEDCOVER_SELFTEST_MCP=1`: then on a free port, with a new token,
//! for `selftest_mcp`), and stops when the app quits. While it runs the window keeps drawing when it
//! cannot be seen — an agent's chat window is often in front of it — and, on macOS, the app holds an
//! activity while a call is under way, so that App Nap does not slow it.
//!
//! The page is not trusted with more than the calls it is given: a file is read for it only while a
//! call in hand names that very file ([`NamedFiles`], [`may_read`]), and the app's own requests on
//! its behalf (`ai_request`, `fetch_image`) never reach the endpoint ([`not_to_the_endpoint`]), so
//! the page cannot make calls of its own to have files read.

use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use smedcover_core::mcp::bridge::{BoxFut, BridgeError, Call, CallToolResult, PageProgress, PageReply};
use smedcover_core::mcp::config::check_port;
use smedcover_core::mcp::server::VERSION;
use smedcover_core::mcp::{BindError, Dispatcher, Host, McpConfig, McpServer, PageBridge, PageSink, PageState, Running, Secret, Stats, ToolList};
use smedcover_core::{err, Res};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager, State, Webview};
use tokio::runtime::Handle;
use tokio::sync::watch;

/// How long a stop lets the connections finish the answers they are giving before it cuts them off.
const STOP_WITHIN: Duration = Duration::from_secs(2);
/// The least time between two statuses sent to the page: four a second at most.
const STATUS_EVERY: Duration = Duration::from_millis(250);

/// Told whether the endpoint runs, each time something changes.
type OnRunning = Box<dyn Fn(bool) + Send + Sync>;

/// The endpoint as the app keeps it: the dispatcher the window attaches to, the tools of the bundled
/// `tools.json` the desktop offers, the clients seen and the calls under way, the files those calls
/// name, the token (which the server reads at every request, so a new one takes over at once), and
/// the settings with what came of them.
pub struct McpHost {
    data: PathBuf,
    dispatcher: Arc<Dispatcher>,
    tools: Arc<ToolList>,
    stats: Arc<Stats>,
    named: Arc<NamedFiles>,
    token: Arc<RwLock<Secret>>,
    server: McpServer,
    runtime: Handle,
    /// `mcp.json` as saved, and the endpoint started from it: saved, started and stopped under it.
    state: Mutex<Endpoint>,
    /// One switch on, off or to another port at a time (a stop is waited for outside `state`).
    switching: tokio::sync::Mutex<()>,
    /// Changes when the endpoint or the window's page does, for the page to be told.
    news: watch::Sender<u64>,
    /// The window keeps drawing unseen while the endpoint runs (see [`keep_drawing`]).
    on_running: OnRunning,
    /// The activity held while a call is under way (macOS).
    awake: Mutex<Option<awake::Activity>>,
    /// The self-test's own endpoint (SMEDCOVER_SELFTEST_MCP): on a free port, `mcp.json` not turned on.
    selftest: bool,
}

struct Endpoint {
    cfg: McpConfig,
    running: Option<Running>,
    /// What went wrong: the port could not be had the last time the endpoint was to start, or
    /// `mcp.json` could not be read (till it is saved again).
    trouble: Option<Trouble>,
    /// Stopping, to start again elsewhere or not at all.
    switching: bool,
}

enum Trouble {
    Bind(BindError),
    Config(String),
}

/// The window's page, reached through the Tauri channel it handed over with `mcp_attach`. Sending
/// queues a script for the web view and returns: it never waits for the page, nor calls back into
/// the dispatcher. The message is written out once, not copied first (a call may carry a photo).
struct ChannelSink(Channel);

impl PageSink for ChannelSink {
    fn send(&self, msg: &Value) -> Result<(), String> {
        let text = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        self.0.send(InvokeResponseBody::Json(text)).map_err(|e| e.to_string())
    }
}

impl McpHost {
    /// The endpoint of the data folder `data`, its tools read from the app's own `tools.json`, its
    /// settings from `mcp.json`; started if it is on, a page said to be on its way, the window told to
    /// keep drawing unseen while it runs, and the page told each change. `selftest`: the app runs a
    /// self-test (see [`SelfTest`]).
    pub fn open(app: &AppHandle, data: PathBuf, selftest: Option<SelfTest>) -> Res<Arc<McpHost>> {
        let tools = match app.asset_resolver().get("tools.json".to_string()) {
            Some(asset) => String::from_utf8(asset.bytes.to_vec()).map_err(err).and_then(|text| ToolList::from_json(&text, Host::Desktop)),
            None => Err("tools.json is not among the app's files".to_string()),
        };
        let tools = Arc::new(tools.unwrap_or_else(|e| {
            eprintln!("SmedCover: the agents' tools could not be read, so the endpoint offers none: {e}");
            ToolList::empty()
        }));
        let window = app.clone();
        let runtime = tauri::async_runtime::handle().inner().clone();
        let host = McpHost::new(data, tools, selftest, runtime, Box::new(move |running| keep_drawing(&window, running)))?;
        tauri::async_runtime::spawn(host.clone().tell_page());
        Ok(host)
    }

    /// The host itself, without Tauri: `runtime` serves the endpoint, `on_running` is told whether it
    /// runs at each change. An `mcp.json` that cannot be read leaves it off, saying why (`config`),
    /// till it is saved again.
    pub fn new(data: PathBuf, tools: Arc<ToolList>, selftest: Option<SelfTest>, runtime: Handle, on_running: OnRunning) -> Res<Arc<McpHost>> {
        let (mut cfg, trouble) = match McpConfig::load(&data) {
            Ok(cfg) => (cfg, None),
            Err(e) => (McpConfig::new()?, Some(Trouble::Config(e))),
        };
        let ours = selftest == Some(SelfTest::Mcp);
        if ours {
            cfg.token = Secret::generate()?;
            cfg.save(&data)?;
        }
        let dispatcher = Arc::new(Dispatcher::new());
        dispatcher.loading(); // the window is starting: calls wait for its page
        let stats = Arc::new(Stats::new());
        let named = Arc::new(NamedFiles::default());
        let token = Arc::new(RwLock::new(cfg.token.clone()));
        let gated = Arc::new(Gated { inner: dispatcher.clone(), named: named.clone() });
        let server = McpServer::new(gated, tools.clone(), token.clone(), stats.clone());
        let start = match (ours, &trouble) {
            (true, _) => Some(0),
            (false, None) => (cfg.on && selftest.is_none_or(|s| s == SelfTest::Stay)).then_some(cfg.port),
            (false, Some(_)) => None,
        };
        let host = Arc::new(McpHost {
            data,
            dispatcher,
            tools,
            stats,
            named,
            token,
            server,
            runtime,
            state: Mutex::new(Endpoint { cfg, running: None, trouble, switching: false }),
            switching: tokio::sync::Mutex::new(()),
            news: watch::Sender::new(0),
            on_running,
            awake: Mutex::new(None),
            selftest: ours,
        });
        if let Some(port) = start {
            let mut s = host.lock();
            host.bind(&mut s, port);
        }
        host.changed();
        Ok(host)
    }

    fn lock(&self) -> MutexGuard<'_, Endpoint> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts the endpoint on `port` (0: any free one), or keeps why it could not be.
    fn bind(&self, s: &mut Endpoint, port: u16) {
        match self.server.start(SocketAddr::from(([127, 0, 0, 1], port)), &self.runtime) {
            Ok(running) => {
                s.running = Some(running);
                s.trouble = None;
            }
            Err(e) => {
                s.running = None;
                s.trouble = Some(Trouble::Bind(e));
            }
        }
    }

    /// Something the page shows changed: it is told, and the window keeps drawing unseen while the
    /// endpoint runs.
    fn changed(&self) {
        self.news.send_modify(|n| *n = n.wrapping_add(1));
        let running = self.lock().running.is_some();
        (self.on_running)(running);
    }

    /// The port the endpoint listens on, while it does.
    pub fn running_port(&self) -> Option<u16> {
        self.lock().running.as_ref().map(Running::port)
    }

    /// What Settings → Agents shows: `{on, state: "off" | "running" | "switching" | "error", port,
    /// url, error?: {code, message, detail?}, page: "none" | "loading" | "ready", tools,
    /// toolsMismatch, clients, inFlight, lastCall}`; `code` is `port_in_use`, `port_forbidden`,
    /// `bind_failed` (`detail`: the system's words) or `config` (`mcp.json` could not be read). Never
    /// the token.
    pub fn status(&self) -> Value {
        let (on, state, port, error) = {
            let s = self.lock();
            let error = s.trouble.as_ref().map(|t| match t {
                Trouble::Bind(e) => {
                    let mut error = json!({"code": e.code(), "message": e.to_string()});
                    if let BindError::Failed { message, .. } = e {
                        error["detail"] = json!(message);
                    }
                    error
                }
                Trouble::Config(why) => json!({"code": "config", "message": why}),
            });
            match (&s.running, error) {
                (Some(running), _) => (s.cfg.on, "running", running.port(), None),
                (None, _) if s.switching => (s.cfg.on, "switching", s.cfg.port, None),
                (None, Some(error)) => (s.cfg.on, "error", s.cfg.port, Some(error)),
                (None, None) => (s.cfg.on, "off", s.cfg.port, None),
            }
        };
        let mismatch = self.dispatcher.page_tools_hash().is_some_and(|h| h != self.tools.hash());
        let mut status = json!({
            "on": on, "state": state, "port": port, "url": format!("http://127.0.0.1:{port}/mcp"),
            "page": self.dispatcher.page().as_str(), "tools": self.tools.entries().len(), "toolsMismatch": mismatch,
        });
        if let Some(error) = error {
            status["error"] = error;
        }
        if let Ok(Value::Object(stats)) = serde_json::to_value(self.stats.snapshot()) {
            status.as_object_mut().expect("an object").extend(stats);
        }
        status
    }

    /// Turns the endpoint on or off, on `port` if given (else the one saved): saved first, then
    /// started, stopped or moved (the page told it is switching meanwhile). A port that cannot be had
    /// leaves it on but in error, saying why.
    pub async fn set(&self, on: bool, port: Option<u16>) -> Res<Value> {
        let _one = self.switching.lock().await;
        if let Some(port) = port {
            check_port(port)?;
        }
        let stopping = {
            let mut s = self.lock();
            let mut cfg = s.cfg.clone();
            cfg.on = on;
            cfg.port = port.unwrap_or(cfg.port);
            cfg.save(&self.data)?;
            s.cfg = cfg;
            s.trouble = None;
            let keep = on && s.running.as_ref().is_some_and(|r| self.selftest || r.port() == s.cfg.port);
            let stopping = if keep { None } else { s.running.take() };
            s.switching = stopping.is_some();
            stopping
        };
        if let Some(running) = stopping {
            self.changed();
            running.stop(STOP_WITHIN).await;
        }
        {
            let mut s = self.lock();
            s.switching = false;
            if on && s.running.is_none() {
                let port = s.cfg.port;
                self.bind(&mut s, port);
            }
        }
        self.changed();
        Ok(self.status())
    }

    /// The token, after a new one has taken its place if `regenerate` (saved, then in force at once:
    /// a client still showing the old one is refused from its next request).
    pub fn token(&self, regenerate: bool) -> Res<String> {
        let mut s = self.lock();
        if regenerate {
            let mut cfg = s.cfg.clone();
            cfg.token = Secret::generate()?;
            cfg.save(&self.data)?;
            *self.token.write().unwrap_or_else(|e| e.into_inner()) = cfg.token.clone();
            s.cfg = cfg;
            if matches!(s.trouble, Some(Trouble::Config(_))) {
                s.trouble = None;
            }
        }
        Ok(s.cfg.token.expose().to_string())
    }

    /// The window's page is ready for calls, built with the `tools.json` whose hash is `tools_hash`.
    pub fn attach(&self, channel: Channel, tools_hash: &str) -> Value {
        let epoch = self.dispatcher.attach(Box::new(ChannelSink(channel)), tools_hash);
        self.changed();
        let status = self.status();
        json!({"epoch": epoch, "toolsMismatch": status["toolsMismatch"], "status": status})
    }

    /// The window is loading a page (again): the calls the last one had fail, and calls wait for the
    /// next.
    pub fn reloading(&self) {
        self.dispatcher.detach("the window reloaded");
        self.changed();
    }

    /// The window is gone: calls fail at once from now on.
    pub fn window_closed(&self) {
        self.dispatcher.close("SmedCover's window closed");
    }

    /// The app quits: the calls in hand fail, and the endpoint stops, its port free.
    pub async fn shut(&self) {
        let _one = self.switching.lock().await;
        self.dispatcher.close("SmedCover is quitting");
        let running = self.lock().running.take();
        if let Some(running) = running {
            running.stop(Duration::from_secs(1)).await;
        }
        self.awake.lock().unwrap_or_else(|e| e.into_inner()).take();
    }

    /// Tells the page each change of the endpoint and of the clients and calls, four times a second
    /// at most, and holds the app awake while a call is under way.
    async fn tell_page(self: Arc<Self>) {
        let mut stats = self.stats.changes();
        let mut news = self.news.subscribe();
        loop {
            tokio::select! {
                changed = stats.changed() => if changed.is_err() { return },
                changed = news.changed() => if changed.is_err() { return },
            }
            let status = self.status();
            let busy = status["inFlight"].as_u64().is_some_and(|n| n > 0);
            {
                let mut awake = self.awake.lock().unwrap_or_else(|e| e.into_inner());
                if busy && awake.is_none() {
                    *awake = awake::Activity::begin("An agent's call to SmedCover is under way");
                } else if !busy {
                    awake.take();
                }
            }
            self.dispatcher.send_status(status);
            tokio::time::sleep(STATUS_EVERY).await;
        }
    }

    /// The self-test's check of its own endpoint, as a client would make it: over HTTP, with the
    /// token, `initialize` of 2025-06-18, `tools/list`, and `get_context` and `render_preview`
    /// called through to the page; and a request with a wrong token. What it found, for the page to
    /// check and report (`mcp` in report.json).
    pub async fn selftest(&self) -> Res<Value> {
        let mut page = self.dispatcher.watch_page();
        tokio::time::timeout(Duration::from_secs(30), page.wait_for(|p| matches!(p, PageState::Ready { .. })))
            .await
            .map_err(|_| "the window's page did not attach within 30 s".to_string())?
            .map_err(err)?;
        let url = self.lock().running.as_ref().map(Running::url).ok_or("the self-test's endpoint is not running")?;
        let token = self.token.read().unwrap_or_else(|e| e.into_inner()).expose().to_string();
        let expected = self.tools.entries().len();
        let mut found = tauri::async_runtime::spawn_blocking(move || selftest_client(&url, &token)).await.map_err(err)??;
        found["expectedTools"] = json!(expected);
        let status = self.status();
        found["toolsMismatch"] = status["toolsMismatch"].clone();
        found["clientSeen"] = json!(status["clients"].as_array().is_some_and(|c| c.iter().any(|c| c["name"] == SELFTEST_CLIENT)));
        Ok(found)
    }
}

/// How the app runs a self-test, for the endpoint's sake.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SelfTest {
    /// The self-test proper: the endpoint stays off.
    Run,
    /// SMEDCOVER_SELFTEST_MCP: it starts on a free port with a new token, for `selftest_mcp`.
    Mcp,
    /// SMEDCOVER_SELFTEST_STAY: the app runs as it would on its own data folder, so the endpoint
    /// starts if it is on.
    Stay,
}

// ---------------------------------------------------------------- the files a call names

/// What a file read for an agent is: a picture (`read_picture`) or a project (`read_project`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FileKind {
    Picture,
    Project,
}

/// The file a call asks the app to read for it, if any: `add_photo`'s `source.path` (a picture),
/// `open_project`'s `file` (a project), as the agent wrote it.
pub fn file_named(tool: &str, args: &Map<String, Value>) -> Option<(FileKind, String)> {
    let (kind, path) = match tool {
        "add_photo" => (FileKind::Picture, args.get("source")?.get("path")?),
        "open_project" => (FileKind::Project, args.get("file")?),
        _ => return None,
    };
    Some((kind, path.as_str()?.to_string()))
}

/// The files the calls in hand name, each noted while its call is in hand (from the moment the
/// endpoint takes it till it is answered, given up or cancelled).
#[derive(Default)]
pub struct NamedFiles {
    next: AtomicU64,
    held: Mutex<Vec<(u64, FileKind, String)>>,
}

/// One file noted for a call; dropping it lets the file go.
pub struct Named {
    files: Arc<NamedFiles>,
    id: u64,
}

impl NamedFiles {
    /// Notes the file call `tool` with `args` names, if it names one, till the guard is dropped.
    pub fn hold(self: &Arc<Self>, tool: &str, args: &Map<String, Value>) -> Option<Named> {
        let (kind, path) = file_named(tool, args)?;
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        lock(&self.held).push((id, kind, path));
        Some(Named { files: self.clone(), id })
    }

    /// Whether a call in hand names `path` as a file of `kind`.
    pub fn allows(&self, kind: FileKind, path: &str) -> bool {
        lock(&self.held).iter().any(|(_, k, p)| *k == kind && p == path)
    }
}

impl Drop for Named {
    fn drop(&mut self) {
        lock(&self.files.held).retain(|(id, ..)| *id != self.id);
    }
}

/// The dispatcher as the endpoint sees it: each call notes the file it names for as long as it is in
/// hand.
struct Gated {
    inner: Arc<dyn PageBridge>,
    named: Arc<NamedFiles>,
}

impl PageBridge for Gated {
    fn call(&self, call: Call) -> BoxFut<'_, Result<CallToolResult, BridgeError>> {
        let held = self.named.hold(&call.tool, &call.args);
        let inner = self.inner.clone();
        Box::pin(async move {
            let _held = held;
            inner.call(call).await
        })
    }

    fn page(&self) -> PageState {
        self.inner.page()
    }
}

/// Whether file `path` may be read for the page as a `kind`: only while a call in hand names that
/// very file as one (`add_photo`'s `source.path` a picture, `open_project`'s `file` a project), or in
/// the self-test proper (`selftest`), which calls the tools itself.
pub fn may_read(named: &NamedFiles, selftest: bool, kind: FileKind, path: &str) -> Res<()> {
    if selftest || named.allows(kind, path) {
        Ok(())
    } else {
        Err("not allowed: a file is read only for an agent's call that names it".into())
    }
}

/// [`may_read`] for the app: the files its endpoint's calls in hand name.
pub fn agent_named(app: &AppHandle, selftest: bool, kind: FileKind, path: &str) -> Res<()> {
    match app.try_state::<Arc<McpHost>>() {
        Some(host) => may_read(&host.named, selftest, kind, path),
        None => may_read(&NamedFiles::default(), selftest, kind, path),
    }
}

// ---------------------------------------------------------------- the endpoint is not the page's to call

/// Whether `url` (or a proxy given as `host:port`) leads to the agents' endpoint listening on `port`
/// of this computer: its port that one, and its host a loopback one (127.0.0.0/8, ::1, `localhost`
/// and the names under it), the unspecified address (which reaches this computer too), or a name
/// `resolve` finds to be one of those.
pub fn reaches_endpoint(url: &str, port: u16, resolve: &dyn Fn(&str, u16) -> Vec<IpAddr>) -> bool {
    let parsed = tauri::Url::parse(url).ok().filter(|u| u.host_str().is_some());
    let Some(u) = parsed.or_else(|| tauri::Url::parse(&format!("http://{url}")).ok()) else {
        return false;
    };
    if u.port_or_known_default() != Some(port) {
        return false;
    }
    let Some(host) = u.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']').trim_end_matches('.').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(ip) => this_computer(&ip),
        Err(_) => resolve(&host, port).iter().any(this_computer),
    }
}

/// Whether a connection to `ip` stays on this computer.
fn this_computer(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_loopback() || a.is_unspecified(),
        IpAddr::V6(a) => a.is_loopback() || a.is_unspecified() || a.to_ipv4_mapped().is_some_and(|v| v.is_loopback() || v.is_unspecified()),
    }
}

/// Refuses a request the app would send for the page (`ai_request`, `fetch_image`) to the agents'
/// endpoint itself, at `url` or through `proxy`, while it runs: with the token the page could make
/// calls of its own there, and have the files they name read. Blocking: a name may be looked up.
pub fn not_to_the_endpoint(app: &AppHandle, url: &str, proxy: Option<&str>) -> Res<()> {
    let Some(port) = app.try_state::<Arc<McpHost>>().and_then(|h| h.running_port()) else {
        return Ok(());
    };
    let lookup = |host: &str, port: u16| -> Vec<IpAddr> { (host, port).to_socket_addrs().map(|a| a.map(|a| a.ip()).collect()).unwrap_or_default() };
    let proxied = proxy.map(str::trim).filter(|p| !p.is_empty()).is_some_and(|p| reaches_endpoint(p, port, &lookup));
    if proxied || reaches_endpoint(url, port, &lookup) {
        return Err("not allowed: SmedCover's endpoint for agents is not to be called from the window".into());
    }
    Ok(())
}

// ---------------------------------------------------------------- the self-test's client

const SELFTEST_CLIENT: &str = "smedcover-selftest";

/// The self-test's client (see [`McpHost::selftest`]), on a thread of its own: each request's
/// answer, an event stream, read to its end.
fn selftest_client(url: &str, token: &str) -> Res<Value> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(150)).build();
    let mut ms = serde_json::Map::new();
    let mut post = |id: Option<u64>, method: &str, params: Value, bearer: &str| -> Res<(u16, Option<Value>)> {
        let t0 = Instant::now();
        let mut body = json!({"jsonrpc": "2.0", "method": method, "params": params});
        if let Some(id) = id {
            body["id"] = json!(id);
        }
        let request = agent
            .post(url)
            .set("Authorization", &format!("Bearer {bearer}"))
            .set("Content-Type", "application/json")
            .set("Accept", "application/json, text/event-stream")
            .set("MCP-Protocol-Version", "2025-06-18");
        let response = match request.send_string(&body.to_string()) {
            Ok(r) | Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("{method}: no answer ({e})")),
        };
        let status = response.status();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut response.into_reader(), &mut text).map_err(|e| format!("{method}: {e}"))?;
        let name = params_name(method, &body);
        ms.insert(name, json!(t0.elapsed().as_millis() as u64));
        // the answer: the body, or the data of the event that answers this request
        let answer = text
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .chain(std::iter::once(text.as_str()))
            .filter_map(|data| serde_json::from_str::<Value>(data.trim()).ok())
            .find(|m| id.is_some() && m["id"] == json!(id));
        Ok((status, answer))
    };
    let result = |method: &str, answer: Option<Value>| -> Res<Value> {
        let answer = answer.ok_or_else(|| format!("{method}: no answer to it"))?;
        if let Some(e) = answer.get("error") {
            return Err(format!("{method}: {e}"));
        }
        Ok(answer["result"].clone())
    };
    let init = json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": SELFTEST_CLIENT, "version": VERSION}});
    let (_, answer) = post(Some(1), "initialize", init, token)?;
    let init = result("initialize", answer)?;
    let (initialized, _) = post(None, "notifications/initialized", json!({}), token)?;
    let (_, answer) = post(Some(2), "tools/list", json!({}), token)?;
    let tools = result("tools/list", answer)?["tools"].as_array().map_or(0, Vec::len);
    let (_, answer) = post(Some(3), "tools/call", json!({"name": "get_context", "arguments": {}}), token)?;
    let context = result("get_context", answer)?;
    let (_, answer) = post(Some(4), "tools/call", json!({"name": "render_preview", "arguments": {"maxSide": 480}}), token)?;
    let preview = result("render_preview", answer)?;
    let (refused, _) = post(Some(5), "tools/list", json!({}), "smc_not-the-token")?;
    let png = preview["content"]
        .as_array()
        .and_then(|c| c.iter().find(|b| b["type"] == "image"))
        .and_then(|b| b["data"].as_str())
        .map(|data| base64::Engine::decode(&base64::engine::general_purpose::STANDARD, data).unwrap_or_default());
    let (width, height) = png.as_deref().map_or((0, 0), png_size);
    Ok(json!({
        "protocol": init["protocolVersion"], "server": init["serverInfo"]["name"], "initialized": initialized,
        "tools": tools,
        "context": {"isError": context["isError"], "profiles": context["structuredContent"]["profiles"].as_array().map_or(0, Vec::len)},
        "preview": {"isError": preview["isError"], "bytes": png.as_ref().map_or(0, Vec::len), "width": width, "height": height,
                    "said": [preview["structuredContent"]["width"], preview["structuredContent"]["height"]]},
        "wrongToken": refused,
        "ms": ms,
    }))
}

/// What a request's time is noted under: the tool it calls, else its method.
fn params_name(method: &str, body: &Value) -> String {
    body["params"]["name"].as_str().filter(|_| method == "tools/call").unwrap_or(method).to_string()
}

/// The width and height a PNG's header gives, or zeros.
fn png_size(png: &[u8]) -> (u32, u32) {
    match png.get(..24) {
        Some(head) if head.starts_with(b"\x89PNG\r\n\x1a\n") && &head[12..16] == b"IHDR" => {
            let be = |at: usize| u32::from_be_bytes([head[at], head[at + 1], head[at + 2], head[at + 3]]);
            (be(16), be(20))
        }
        _ => (0, 0),
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------- drawing unseen, App Nap

/// The window keeps drawing when it cannot be seen (`unseen`), or watches again whether it can.
///
/// WebKit stops drawing for a window that cannot be seen — on another desktop, behind a full-screen
/// app, under an agent's chat window — so a canvas read back from the graphics card (an export, a
/// preview) waits for good. So while the endpoint runs, and always in self-test mode, the web view is
/// told not to watch whether its window can be seen (the setting WebKit's own tests use). Elsewhere
/// than on macOS nothing is done (WebView2 and WebKitGTK have no such setting).
pub fn keep_drawing(app: &AppHandle, unseen: bool) {
    #[cfg(target_os = "macos")]
    {
        let watch = !(unseen || crate::selftest_root().is_some());
        for w in app.webview_windows().values() {
            let _ = w.with_webview(move |wv| unsafe {
                let view = wv.inner() as *mut objc2::runtime::AnyObject;
                let sel = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
                let can: bool = objc2::msg_send![view, respondsToSelector: sel];
                if can {
                    let _: () = objc2::msg_send![view, _setWindowOcclusionDetectionEnabled: watch];
                }
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, unseen);
}

/// An activity held with the system while an agent's call is under way: on macOS, so that App Nap
/// does not slow the app down while its window is hidden or covered (`NSProcessInfo`'s
/// `beginActivityWithOptions:reason:`, user-initiated, idle sleep still allowed); elsewhere nothing.
mod awake {
    #[cfg(target_os = "macos")]
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};

    /// `NSActivityUserInitiatedAllowingIdleSystemSleep`: the user asked for it (an agent's call is
    /// theirs), so App Nap keeps away while it runs; the Mac may still sleep when idle, however long
    /// an export goes on.
    #[cfg(target_os = "macos")]
    const USER_INITIATED_ALLOWING_SLEEP: u64 = 0x00FF_FFFF & !(1 << 20);

    #[cfg(target_os = "macos")]
    pub struct Activity(Retained<AnyObject>);

    // SAFETY: the activity is an opaque token, only handed back to NSProcessInfo, which may be used
    // from any thread
    #[cfg(target_os = "macos")]
    unsafe impl Send for Activity {}

    #[cfg(target_os = "macos")]
    impl Activity {
        pub fn begin(reason: &str) -> Option<Activity> {
            let reason = std::ffi::CString::new(reason).ok()?;
            objc2::rc::autoreleasepool(|_| unsafe {
                // SAFETY: NSProcessInfo and NSString are Foundation's; the reason is a C string that
                // lives through the call, copied by NSString
                let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
                let text: *mut AnyObject = msg_send![class!(NSString), stringWithUTF8String: reason.as_ptr()];
                if info.is_null() || text.is_null() {
                    return None;
                }
                let token: Option<Retained<AnyObject>> = msg_send![info, beginActivityWithOptions: USER_INITIATED_ALLOWING_SLEEP, reason: text];
                token.map(Activity)
            })
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for Activity {
        fn drop(&mut self) {
            objc2::rc::autoreleasepool(|_| unsafe {
                // SAFETY: the activity was begun by this process's NSProcessInfo, and is ended once
                let info: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
                if !info.is_null() {
                    let _: () = msg_send![info, endActivity: &*self.0];
                }
            });
        }
    }

    #[cfg(not(target_os = "macos"))]
    pub struct Activity;

    #[cfg(not(target_os = "macos"))]
    impl Activity {
        pub fn begin(_reason: &str) -> Option<Activity> {
            None
        }
    }
}

// ---------------------------------------------------------------- the commands

/// See [`McpHost::status`].
#[tauri::command]
pub fn mcp_status(h: State<'_, Arc<McpHost>>) -> Value {
    h.status()
}

/// Turns the endpoint on or off, on another port if given (see [`McpHost::set`]); its status after.
#[tauri::command]
pub async fn mcp_set(h: State<'_, Arc<McpHost>>, on: bool, port: Option<u16>) -> Res<Value> {
    h.set(on, port).await
}

/// The token, a new one first if `regenerate` (see [`McpHost::token`]).
#[tauri::command]
pub fn mcp_token(h: State<'_, Arc<McpHost>>, regenerate: Option<bool>) -> Res<String> {
    h.token(regenerate.unwrap_or(false))
}

/// The main window's page takes the calls from now on, through `channel`; `tools_hash` is the
/// SHA-256 of the `tools.json` it was built with (empty if it could not say). `{epoch,
/// toolsMismatch, status}`.
#[tauri::command]
pub fn mcp_attach(h: State<'_, Arc<McpHost>>, webview: Webview, channel: Channel, tools_hash: String) -> Res<Value> {
    if webview.label() != "main" {
        return Err("only SmedCover's main window takes agents' calls".into());
    }
    Ok(h.attach(channel, &tools_hash))
}

/// The page's answer to a call; whether a call waited for it. Off the main thread: an answer may
/// carry pictures of many megabytes.
#[tauri::command(async)]
pub fn mcp_reply(h: State<'_, Arc<McpHost>>, reply: PageReply) -> bool {
    h.dispatcher.reply(reply)
}

/// The page's word on how far a call has got; whether a call waited for it.
#[tauri::command]
pub fn mcp_progress(h: State<'_, Arc<McpHost>>, id: u64, progress: f64, total: Option<f64>, message: Option<String>) -> bool {
    h.dispatcher.progress(PageProgress { id, progress, total, message })
}

/// In self-test mode with SMEDCOVER_SELFTEST_MCP, the self-test's own endpoint called over HTTP (see
/// [`McpHost::selftest`]); null otherwise.
#[tauri::command]
pub async fn selftest_mcp(h: State<'_, Arc<McpHost>>) -> Res<Option<Value>> {
    if !h.selftest {
        return Ok(None);
    }
    h.selftest().await.map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{Ipv4Addr, TcpListener};
    use std::path::Path;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn png_size_reads_the_header() {
        // a 1×1 PNG, and one said to be 640×360
        let one = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        )
        .unwrap();
        assert_eq!(png_size(&one), (1, 1));
        let mut wide = one.clone();
        wide[16..20].copy_from_slice(&640u32.to_be_bytes());
        wide[20..24].copy_from_slice(&360u32.to_be_bytes());
        assert_eq!(png_size(&wide), (640, 360));
        assert_eq!(png_size(b"GIF89a"), (0, 0));
        assert_eq!(png_size(&one[..20]), (0, 0));
    }

    #[test]
    fn a_request_is_timed_by_its_tool() {
        let call = json!({"params": {"name": "render_preview"}});
        assert_eq!(params_name("tools/call", &call), "render_preview");
        assert_eq!(params_name("tools/list", &json!({"params": {}})), "tools/list");
    }

    // ---- the read gate

    fn args(v: Value) -> Map<String, Value> {
        v.as_object().cloned().unwrap()
    }

    #[test]
    fn the_file_a_call_names() {
        assert_eq!(file_named("add_photo", &args(json!({"source": {"path": "/a/b.png"}}))), Some((FileKind::Picture, "/a/b.png".into())));
        assert_eq!(file_named("open_project", &args(json!({"file": "/a/c.smedcover.json"}))), Some((FileKind::Project, "/a/c.smedcover.json".into())));
        assert_eq!(file_named("add_photo", &args(json!({"source": {"url": "https://x.example/b.png"}}))), None);
        assert_eq!(file_named("add_photo", &args(json!({"source": {"path": 7}}))), None);
        assert_eq!(file_named("open_project", &args(json!({"project": "{}"}))), None);
        // another tool's arguments name no file, whatever they hold
        assert_eq!(file_named("set_text", &args(json!({"file": "/etc/passwd", "source": {"path": "/x.png"}}))), None);
    }

    #[test]
    fn a_file_is_read_only_while_a_call_names_it_and_only_as_what_it_names() {
        let named = Arc::new(NamedFiles::default());
        let refused = |kind, path| may_read(&named, false, kind, path).is_err();
        assert!(refused(FileKind::Picture, "/a/b.png"), "no call in hand");
        let other = named.hold("render_preview", &args(json!({"maxSide": 640})));
        assert!(other.is_none());
        assert!(refused(FileKind::Picture, "/a/b.png"), "a call that names no file opens nothing");
        let photo = named.hold("add_photo", &args(json!({"source": {"path": "/a/b.png"}}))).unwrap();
        assert!(!refused(FileKind::Picture, "/a/b.png"));
        assert!(refused(FileKind::Picture, "/a/other.png"), "only the file named");
        assert!(refused(FileKind::Project, "/a/b.png"), "only as what it is named as");
        let again = named.hold("add_photo", &args(json!({"source": {"path": "/a/b.png"}}))).unwrap();
        drop(photo);
        assert!(!refused(FileKind::Picture, "/a/b.png"), "another call names it still");
        drop(again);
        assert!(refused(FileKind::Picture, "/a/b.png"), "let go with the last call naming it");
        // the self-test proper calls the tools itself
        assert!(may_read(&named, true, FileKind::Project, "/a/c.smedcover.json").is_ok());
    }

    /// A page that notes whether the picture its call names may be read while it has the call.
    struct Peek {
        named: Arc<NamedFiles>,
        seen: Mutex<Vec<bool>>,
    }

    impl PageBridge for Peek {
        fn call(&self, call: Call) -> BoxFut<'_, Result<CallToolResult, BridgeError>> {
            Box::pin(async move {
                let path = call.args["source"]["path"].as_str().unwrap_or("").to_string();
                lock(&self.seen).push(self.named.allows(FileKind::Picture, &path));
                Err(BridgeError::Cancelled)
            })
        }

        fn page(&self) -> PageState {
            PageState::Ready { epoch: 1 }
        }
    }

    fn call(tool: &str, a: Value) -> Call {
        Call { tool: tool.into(), args: args(a), client: None, timeout: Duration::from_secs(5), progress: None, cancel: CancellationToken::new() }
    }

    #[tokio::test]
    async fn the_endpoint_notes_a_calls_file_for_as_long_as_it_is_in_hand() {
        let named = Arc::new(NamedFiles::default());
        let peek = Arc::new(Peek { named: named.clone(), seen: Mutex::new(Vec::new()) });
        let gated = Gated { inner: peek.clone(), named: named.clone() };
        let _ = gated.call(call("add_photo", json!({"source": {"path": "/p/one.png"}}))).await;
        assert_eq!(*lock(&peek.seen), [true], "readable while the page has the call");
        assert!(!named.allows(FileKind::Picture, "/p/one.png"), "not once it is answered");
        // a call given up before it is answered (its future dropped) lets its file go too
        let pending = gated.call(call("add_photo", json!({"source": {"path": "/p/two.png"}})));
        assert!(named.allows(FileKind::Picture, "/p/two.png"));
        drop(pending);
        assert!(!named.allows(FileKind::Picture, "/p/two.png"));
    }

    #[test]
    fn requests_to_the_endpoint_itself_are_told() {
        let none = |_: &str, _: u16| Vec::new();
        let looped = |host: &str, _: u16| if host == "loop.example" { vec![IpAddr::V4(Ipv4Addr::LOCALHOST)] } else { vec![IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))] };
        for url in [
            "http://127.0.0.1:25277/mcp",
            "http://127.9.9.9:25277/mcp",
            "http://localhost:25277/mcp",
            "http://LOCALHOST.:25277/mcp",
            "http://api.localhost:25277/",
            "http://[::1]:25277/mcp",
            "http://[::ffff:127.0.0.1]:25277/mcp",
            "http://0.0.0.0:25277/mcp",
            "http://2130706433:25277/mcp",
            "http://127.1:25277/mcp",
            "127.0.0.1:25277",
            "localhost:25277",
            "socks5://127.0.0.1:25277",
        ] {
            assert!(reaches_endpoint(url, 25277, &none), "{url}");
        }
        assert!(reaches_endpoint("http://loop.example:25277/mcp", 25277, &looped), "a name that resolves to this computer");
        for url in [
            "http://127.0.0.1:25278/mcp",
            "http://127.0.0.1/mcp",
            "https://api.openai.com/v1/chat/completions",
            "http://elsewhere.example:25277/mcp",
            "http://192.168.1.4:25277/mcp",
            "not a url",
            "",
        ] {
            assert!(!reaches_endpoint(url, 25277, &looped), "{url}");
        }
        assert!(reaches_endpoint("http://localhost/", 80, &none), "the scheme's own port counts");
    }

    // ---- switching the endpoint, the token

    fn host(data: &Path) -> Arc<McpHost> {
        McpHost::new(data.to_path_buf(), Arc::new(ToolList::empty()), None, Handle::current(), Box::new(|_| {})).unwrap()
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn taken(port: u16) -> bool {
        TcpListener::bind(("127.0.0.1", port)).is_err()
    }

    #[tokio::test]
    async fn it_turns_on_moves_and_turns_off_saving_each() {
        let dir = tempfile::tempdir().unwrap();
        let h = host(dir.path());
        assert_eq!(h.status()["state"], "off");
        assert_eq!(h.status()["on"], false);
        let first = free_port();
        let s = h.set(true, Some(first)).await.unwrap();
        assert_eq!((s["state"].as_str(), s["port"].as_u64()), (Some("running"), Some(u64::from(first))));
        assert_eq!(s["url"], format!("http://127.0.0.1:{first}/mcp"));
        assert!(taken(first));
        let saved = McpConfig::load(dir.path()).unwrap();
        assert!(saved.on && saved.port == first);
        assert_eq!(h.running_port(), Some(first));
        // again on the same port: nothing moves
        let s = h.set(true, None).await.unwrap();
        assert_eq!(s["port"].as_u64(), Some(u64::from(first)));
        // moved: the first port free again
        let second = free_port();
        let s = h.set(true, Some(second)).await.unwrap();
        assert_eq!((s["state"].as_str(), s["port"].as_u64()), (Some("running"), Some(u64::from(second))));
        assert!(!taken(first) && taken(second));
        // off: the port free, off saved, the port kept
        let s = h.set(false, None).await.unwrap();
        assert_eq!((s["state"].as_str(), s["on"].as_bool()), (Some("off"), Some(false)));
        assert!(!taken(second));
        assert_eq!(h.running_port(), None);
        let saved = McpConfig::load(dir.path()).unwrap();
        assert!(!saved.on && saved.port == second);
        // a system port is refused before anything is saved
        assert!(h.set(true, Some(80)).await.is_err());
        assert!(!McpConfig::load(dir.path()).unwrap().on);
        // started with the app when saved on
        h.set(true, None).await.unwrap();
        h.shut().await;
        assert!(!taken(second), "the app quitting frees the port");
        let again = host(dir.path());
        assert_eq!(again.status()["state"], "running");
        again.shut().await;
    }

    #[tokio::test]
    async fn a_port_in_use_is_said_and_on_kept() {
        let dir = tempfile::tempdir().unwrap();
        let h = host(dir.path());
        let other = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = other.local_addr().unwrap().port();
        let s = h.set(true, Some(port)).await.unwrap();
        assert_eq!(s["state"], "error");
        assert_eq!(s["error"]["code"], "port_in_use");
        assert!(s["error"].get("detail").is_none());
        assert_eq!(s["on"], true);
        assert!(McpConfig::load(dir.path()).unwrap().on, "on stays saved");
        drop(other);
        let s = h.set(true, None).await.unwrap();
        assert_eq!(s["state"], "running", "the port free, it starts on asking again");
        h.shut().await;
    }

    #[tokio::test]
    async fn a_new_token_is_saved_and_in_force_at_once() {
        let dir = tempfile::tempdir().unwrap();
        let h = host(dir.path());
        let old = h.token(false).unwrap();
        assert_eq!(old, h.token(false).unwrap());
        let new = h.token(true).unwrap();
        assert_ne!(old, new);
        assert!(McpConfig::load(dir.path()).unwrap().token.matches(&new));
        let live = h.token.read().unwrap();
        assert!(live.matches(&new) && !live.matches(&old), "the server checks the new one");
        assert!(h.status().to_string().find(&new).is_none(), "the status never holds it");
    }

    #[tokio::test]
    async fn an_unreadable_mcp_json_is_said_and_left_off() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("mcp.json")).unwrap();
        let h = host(dir.path());
        let s = h.status();
        assert_eq!((s["state"].as_str(), s["on"].as_bool()), (Some("error"), Some(false)));
        assert_eq!(s["error"]["code"], "config");
        assert!(h.set(true, None).await.is_err(), "it cannot be saved either");
        assert_eq!(h.status()["error"]["code"], "config");
    }
}
