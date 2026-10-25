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

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use smedcover_core::mcp::bridge::{PageProgress, PageReply};
use smedcover_core::mcp::config::check_port;
use smedcover_core::mcp::server::VERSION;
use smedcover_core::mcp::{BindError, Dispatcher, Host, McpConfig, McpServer, PageBridge, PageSink, PageState, Running, Secret, Stats, ToolList};
use smedcover_core::{err, Res};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, Webview};
use tokio::sync::watch;

/// How long a stop lets the connections finish the answers they are giving before it cuts them off.
const STOP_WITHIN: Duration = Duration::from_secs(2);
/// The least time between two statuses sent to the page: four a second at most.
const STATUS_EVERY: Duration = Duration::from_millis(250);

/// The endpoint as the app keeps it: the dispatcher the window attaches to, the tools of the bundled
/// `tools.json` the desktop offers, the clients seen and the calls under way, the token (which the
/// server reads at every request, so a new one takes over at once), and the settings with what came
/// of them.
pub struct McpHost {
    app: AppHandle,
    data: PathBuf,
    dispatcher: Arc<Dispatcher>,
    tools: Arc<ToolList>,
    stats: Arc<Stats>,
    token: Arc<RwLock<Secret>>,
    server: McpServer,
    runtime: tokio::runtime::Handle,
    /// `mcp.json` as saved, and the endpoint started from it: saved, started and stopped under it.
    state: Mutex<Endpoint>,
    /// One switch on, off or to another port at a time (a stop is waited for outside `state`).
    switching: tokio::sync::Mutex<()>,
    /// Changes when the endpoint or the window's page does, for the page to be told.
    news: watch::Sender<u64>,
    /// The activity held while a call is under way (macOS).
    awake: Mutex<Option<awake::Activity>>,
    /// The self-test's own endpoint (SMEDCOVER_SELFTEST_MCP): on a free port, `mcp.json` not turned on.
    selftest: bool,
}

struct Endpoint {
    cfg: McpConfig,
    running: Option<Running>,
    /// Why the port could not be had, the last time the endpoint was to start.
    error: Option<BindError>,
}

/// The window's page, reached through the Tauri channel it handed over with `mcp_attach`. Sending
/// queues a script for the web view and returns: it never waits for the page, nor calls back into
/// the dispatcher.
struct ChannelSink(Channel<Value>);

impl PageSink for ChannelSink {
    fn send(&self, msg: &Value) -> Result<(), String> {
        self.0.send(msg.clone()).map_err(|e| e.to_string())
    }
}

impl McpHost {
    /// The endpoint of the data folder `data`, its tools read from the app's own `tools.json`, its
    /// settings from `mcp.json`; started if it is on, a page said to be on its way. `selftest`: the
    /// app runs a self-test (it then starts only for SMEDCOVER_SELFTEST_MCP, on a free port and with a
    /// new token).
    pub fn open(app: &AppHandle, data: PathBuf, selftest: Option<SelfTest>) -> Res<Arc<McpHost>> {
        let tools = match app.asset_resolver().get("tools.json".to_string()) {
            Some(asset) => String::from_utf8(asset.bytes.to_vec()).map_err(err).and_then(|text| ToolList::from_json(&text, Host::Desktop)),
            None => Err("tools.json is not among the app's files".to_string()),
        };
        let tools = Arc::new(tools.unwrap_or_else(|e| {
            eprintln!("SmedCover: the agents' tools could not be read, so the endpoint offers none: {e}");
            ToolList::empty()
        }));
        let mut cfg = McpConfig::load(&data)?;
        let ours = selftest == Some(SelfTest::Mcp);
        if ours {
            cfg.token = Secret::generate()?;
            cfg.save(&data)?;
        }
        let dispatcher = Arc::new(Dispatcher::new());
        dispatcher.loading();   // the window is starting: calls wait for its page
        let stats = Arc::new(Stats::new());
        let token = Arc::new(RwLock::new(cfg.token.clone()));
        let server = McpServer::new(dispatcher.clone(), tools.clone(), token.clone(), stats.clone());
        let start = if ours { Some(0) } else { (cfg.on && selftest.is_none_or(|s| s == SelfTest::Stay)).then_some(cfg.port) };
        let host = Arc::new(McpHost {
            app: app.clone(),
            data,
            dispatcher,
            tools,
            stats,
            token,
            server,
            runtime: tauri::async_runtime::handle().inner().clone(),
            state: Mutex::new(Endpoint { cfg, running: None, error: None }),
            switching: tokio::sync::Mutex::new(()),
            news: watch::Sender::new(0),
            awake: Mutex::new(None),
            selftest: ours,
        });
        if let Some(port) = start {
            let mut s = host.lock();
            host.bind(&mut s, port);
        }
        host.changed();
        tauri::async_runtime::spawn(host.clone().tell_page());
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
                s.error = None;
            }
            Err(e) => {
                s.running = None;
                s.error = Some(e);
            }
        }
    }

    /// Something the page shows changed: it is told, and the window keeps drawing unseen while the
    /// endpoint runs.
    fn changed(&self) {
        self.news.send_modify(|n| *n = n.wrapping_add(1));
        keep_drawing(&self.app, self.lock().running.is_some());
    }

    /// What Settings → Agents shows: `{on, state: "off" | "running" | "error", port, url, error?:
    /// {code, message}, page: "none" | "loading" | "ready", tools, toolsMismatch, clients, inFlight,
    /// lastCall}`. Never the token.
    pub fn status(&self) -> Value {
        let (on, state, port, error) = {
            let s = self.lock();
            match (&s.running, &s.error) {
                (Some(running), _) => (s.cfg.on, "running", running.port(), None),
                (None, Some(e)) => (s.cfg.on, "error", s.cfg.port, Some(json!({"code": e.code(), "message": e.to_string()}))),
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
    /// started, stopped or moved. A port that cannot be had leaves it on but in error, saying why.
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
            s.error = None;
            let keep = on && s.running.as_ref().is_some_and(|r| self.selftest || r.port() == s.cfg.port);
            if keep {
                None
            } else {
                s.running.take()
            }
        };
        if let Some(running) = stopping {
            running.stop(STOP_WITHIN).await;
        }
        {
            let mut s = self.lock();
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
        }
        Ok(s.cfg.token.expose().to_string())
    }

    /// The window's page is ready for calls, built with the `tools.json` whose hash is `tools_hash`.
    pub fn attach(&self, channel: Channel<Value>, tools_hash: &str) -> Value {
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

/// The window keeps drawing when it cannot be seen (`unseen`), or watches again whether it can.
///
/// WebKit stops drawing for a window that cannot be seen — on another desktop, behind a full-screen
/// app, under an agent's chat window — so a canvas read back from the graphics card (an export, a
/// preview) waits for good. So while the endpoint runs, and always in self-test mode, the web view is
/// told not to watch whether its window can be seen (the setting WebKit's own tests use). Elsewhere
/// than on macOS nothing is done.
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
/// `beginActivityWithOptions:reason:`, user-initiated); elsewhere nothing.
mod awake {
    #[cfg(target_os = "macos")]
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};

    /// `NSActivityUserInitiated`: the user asked for it (an agent's call is theirs), so neither App
    /// Nap nor idle sleep comes while it runs.
    #[cfg(target_os = "macos")]
    const USER_INITIATED: u64 = 0x00FF_FFFF | (1 << 20);

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
                let token: Option<Retained<AnyObject>> = msg_send![info, beginActivityWithOptions: USER_INITIATED, reason: text];
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
/// SHA-256 of the `tools.json` it was built with. `{epoch, toolsMismatch, status}`.
#[tauri::command]
pub fn mcp_attach(h: State<'_, Arc<McpHost>>, webview: Webview, channel: Channel<Value>, tools_hash: String) -> Res<Value> {
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
}
