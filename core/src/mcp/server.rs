//! The endpoint itself: an HTTP server on 127.0.0.1 with `/mcp`, MCP's streamable HTTP served by
//! rmcp, and `/health`. Each tool call goes to the [`PageBridge`]; the tools are those of the
//! [`ToolList`] the host read.
//!
//! Both eras of the protocol are served, without sessions: 2026-07-28 (`server/discover`, each
//! request carrying its own `_meta` and the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
//! headers, which rmcp checks), and the `initialize` handshake of 2025-03-26, 2025-06-18 and
//! 2025-11-25 (a request without the header is taken as 2025-03-26). Answers are server-sent
//! events: their headers go at once and a keep-alive comment every 15 s, so a call that takes long
//! (an export waiting for the user) is not cut off by a client that waits only so long for headers
//! or for bytes (Node's `fetch`, which most clients use, gives up after 5 minutes); progress the page
//! reports goes before the result. Refusals (400, 401, 403, …) are plain.
//!
//! In front of it, for every path: a `Host` that is not 127.0.0.1, localhost or [::1] is refused
//! (403: another site's name resolving to this computer), and so is an `Origin` that is not one of
//! those (403: a web page in a browser); no CORS headers are ever sent. `/mcp` also wants
//! `Authorization: Bearer <token>` (401 without it), and the header is taken off before rmcp sees
//! the request. `/health` says `{"name": "smedcover", "version", "page"}` to anyone who may reach it.
//!
//! A client of the older era that cancels a call sends `notifications/cancelled` in a request of its
//! own, which a session-less server cannot tie to the call; it is looked for here, and cancels the
//! call in hand with that JSON-RPC id if there is exactly one.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, HOST, ORIGIN, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::middleware::{from_fn, from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, DiscoverResult, Implementation, InitializeRequestParams,
    InitializeResult, ListToolsResult, PaginatedRequestParams, ProgressNotificationParam, ProtocolVersion, RequestId, ResultType,
    ServerCapabilities, ServerConfig, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::session::never::NeverSessionManager;
use rmcp::transport::streamable_http_server::{StreamableHttpServerConfig, StreamableHttpService};
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use super::bridge::{BridgeError, Call, ClientTag, PageBridge, Progress, ProgressFn};
use super::token::{self, Secret};
use super::tools::ToolList;

/// What the endpoint calls itself, and its version (the app's).
pub const SERVER_NAME: &str = "smedcover";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The protocol revisions served, oldest first: 2024-11-05's HTTP with SSE is not.
pub const PROTOCOL_VERSIONS: &[ProtocolVersion] =
    &[ProtocolVersion::V_2025_03_26, ProtocolVersion::V_2025_06_18, ProtocolVersion::V_2025_11_25, ProtocolVersion::V_2026_07_28];
/// The largest request body taken.
pub const MAX_BODY: usize = 4 * 1024 * 1024;
/// How long a client counts as seen.
pub const CLIENT_WINDOW: Duration = Duration::from_secs(10 * 60);
/// The hosts and origins the endpoint answers: this computer's loopback names.
const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

/// The endpoint, ready to be started (and started again, on another port or after being stopped).
#[derive(Clone)]
pub struct McpServer {
    bridge: Arc<dyn PageBridge>,
    tools: Arc<ToolList>,
    token: Arc<RwLock<Secret>>,
    stats: Arc<Stats>,
}

impl McpServer {
    /// An endpoint whose calls go to `bridge`, offering `tools`, for clients that show `token` (which
    /// the host may change while it runs: the next request is checked against the new one), and
    /// keeping account in `stats`.
    pub fn new(bridge: Arc<dyn PageBridge>, tools: Arc<ToolList>, token: Arc<RwLock<Secret>>, stats: Arc<Stats>) -> McpServer {
        McpServer { bridge, tools, token, stats }
    }

    /// Listens on `addr` (the host passes 127.0.0.1 and the user's port; port 0 takes any free one)
    /// and serves on `runtime` till [`Running::stop`]. The port is bound here, before it returns, so
    /// a port that cannot be had is said at once; it is never swapped for another.
    pub fn start(&self, addr: SocketAddr, runtime: &Handle) -> Result<Running, BindError> {
        let port = addr.port();
        let listener = listen(addr).map_err(|e| BindError::from_io(port, &e))?;
        let addr = listener.local_addr().map_err(|e| BindError::from_io(port, &e))?;
        let stop = CancellationToken::new();
        let app = self.router(stop.child_token());
        let listener = {
            let _runtime = runtime.enter();
            tokio::net::TcpListener::from_std(listener).map_err(|e| BindError::from_io(port, &e))?
        };
        let shutdown = stop.clone().cancelled_owned();
        let task = runtime.spawn(async move {
            let _ = axum::serve(listener, app).with_graceful_shutdown(shutdown).await;
        });
        Ok(Running { addr, stop, task: Some(task) })
    }

    /// The routes, for a host that serves them itself: `stop` ends the calls in hand when cancelled.
    pub fn router(&self, stop: CancellationToken) -> Router {
        let calls = Arc::new(InHand::default());
        let handler = Handler(Arc::new(Shared {
            bridge: self.bridge.clone(),
            tools: self.tools.clone(),
            stats: self.stats.clone(),
            calls: calls.clone(),
            info: server_info(&self.tools),
        }));
        let config = StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            // events, not JSON: see the module's notes
            .with_json_response(false)
            .with_sse_keep_alive(Some(Duration::from_secs(15)))
            .with_max_request_body_bytes(MAX_BODY)
            .with_cancellation_token(stop);
        let mcp = StreamableHttpService::new(move || Ok(handler.clone()), Arc::new(NeverSessionManager::default()), config);
        let mcp = Router::new()
            .route_service("/mcp", mcp)
            .route_layer(from_fn_with_state(calls, cancelled_notifications))
            .route_layer(from_fn_with_state(self.token.clone(), bearer));
        Router::new().route("/health", get(health)).with_state(self.bridge.clone()).merge(mcp).layer(from_fn(loopback_only))
    }
}

/// The endpoint while it listens. Dropping it stops it too, without waiting.
pub struct Running {
    addr: SocketAddr,
    stop: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl Running {
    /// The address it listens on.
    pub fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    /// The URL a client is given, `http://127.0.0.1:<port>/mcp`.
    pub fn url(&self) -> String {
        format!("http://{}/mcp", self.addr)
    }

    /// Stops listening at once and ends the calls in hand (each is cancelled, and the page told);
    /// waits up to `within` for the connections to close, then leaves them. The port is free again
    /// when it returns. `false` if it had to leave connections behind.
    pub async fn stop(mut self, within: Duration) -> bool {
        self.stop.cancel();
        let Some(mut task) = self.task.take() else {
            return true;
        };
        if tokio::time::timeout(within, &mut task).await.is_ok() {
            return true;
        }
        task.abort();
        let _ = task.await;
        false
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

/// Why the port could not be had.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BindError {
    /// Another program (or another SmedCover) listens on it.
    PortInUse(u16),
    /// The system keeps it (on Windows, ports reserved for Hyper-V, WSL or Docker), or it is a
    /// system port.
    PortForbidden(u16),
    /// Anything else, as the system said it.
    Failed { port: u16, message: String },
}

impl BindError {
    /// `port_in_use`, `port_forbidden` or `bind_failed`, for the page.
    pub fn code(&self) -> &'static str {
        match self {
            BindError::PortInUse(_) => "port_in_use",
            BindError::PortForbidden(_) => "port_forbidden",
            BindError::Failed { .. } => "bind_failed",
        }
    }

    fn from_io(port: u16, e: &io::Error) -> BindError {
        match e.kind() {
            io::ErrorKind::AddrInUse => BindError::PortInUse(port),
            // WSAEACCES (10013) on Windows; EACCES for a system port on Unix
            io::ErrorKind::PermissionDenied => BindError::PortForbidden(port),
            _ if e.raw_os_error() == Some(10013) && cfg!(windows) => BindError::PortForbidden(port),
            _ => BindError::Failed { port, message: e.to_string() },
        }
    }
}

impl fmt::Display for BindError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BindError::PortInUse(port) => {
                write!(f, "Port {port} is already in use, by another program or another SmedCover: pick another port, or close it.")
            }
            BindError::PortForbidden(port) => write!(f, "Port {port} cannot be used on this computer (the system keeps it): pick another port."),
            BindError::Failed { port, message } => write!(f, "Could not listen on port {port}: {message}"),
        }
    }
}

impl std::error::Error for BindError {}

/// The port, bound. On Windows no other socket may share it (SO_EXCLUSIVEADDRUSE): without that, a
/// program that asks to reuse addresses could listen on it too and take some of the connections.
#[cfg(windows)]
fn listen(addr: SocketAddr) -> io::Result<std::net::TcpListener> {
    use socket2::{Domain, Protocol, Socket, Type};
    use std::os::windows::io::AsRawSocket;
    use windows_sys::Win32::Networking::WinSock::{setsockopt, SOCKET, SOL_SOCKET, SO_EXCLUSIVEADDRUSE};
    let socket = Socket::new(Domain::for_address(addr), Type::STREAM, Some(Protocol::TCP))?;
    let on: i32 = 1;
    // SAFETY: the socket is open for the whole call, and the option is the i32 it points to
    let failed = unsafe {
        setsockopt(socket.as_raw_socket() as SOCKET, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (&on as *const i32).cast(), std::mem::size_of::<i32>() as i32)
    };
    if failed != 0 {
        return Err(io::Error::last_os_error());
    }
    socket.bind(&addr.into())?;
    socket.listen(1024)?;
    let listener: std::net::TcpListener = socket.into();
    listener.set_nonblocking(true)?;
    Ok(listener)
}

/// The port, bound (the standard library lets a port whose last connections are closing be bound
/// again at once, so the endpoint can be stopped and started on the same port).
#[cfg(not(windows))]
fn listen(addr: SocketAddr) -> io::Result<std::net::TcpListener> {
    let listener = std::net::TcpListener::bind(addr)?;
    listener.set_nonblocking(true)?;
    Ok(listener)
}

fn server_info(tools: &ToolList) -> ServerConfig {
    let mut implementation = Implementation::new(SERVER_NAME, VERSION);
    implementation.title = Some("SmedCover".into());
    let info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build()).with_server_info(implementation);
    match tools.instructions() {
        Some(instructions) => info.with_instructions(instructions),
        None => info,
    }
}

// ---- the MCP handler ----

struct Shared {
    bridge: Arc<dyn PageBridge>,
    tools: Arc<ToolList>,
    stats: Arc<Stats>,
    calls: Arc<InHand>,
    info: ServerConfig,
}

#[derive(Clone)]
struct Handler(Arc<Shared>);

impl Handler {
    /// The client making a request, noted as seen: as its `_meta` says in the 2026-07-28 era. A
    /// client of the older era says who it is in `initialize` only, and without sessions its later
    /// requests cannot be tied to it; the one client of that era seen lately on the same revision is
    /// taken to be it, and if there are several, none is.
    fn client(&self, context: &RequestContext<RoleServer>, call: bool) -> Option<ClientTag> {
        let protocol = context.protocol_version().map(|v| v.to_string()).unwrap_or_default();
        let client = match context.meta.client_info() {
            Some(c) => ClientTag { name: c.name, version: c.version },
            None => self.0.stats.only_client_on(&protocol)?,
        };
        self.0.stats.seen(&client, &protocol, call);
        Some(client)
    }
}

impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        self.0.info.clone()
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(PROTOCOL_VERSIONS)
    }

    async fn initialize(&self, request: InitializeRequestParams, context: RequestContext<RoleServer>) -> Result<InitializeResult, McpError> {
        context.peer.set_peer_info(request.clone());
        let result = self.negotiate_initialize(&request)?;
        let client = ClientTag { name: request.client_info.name.clone(), version: request.client_info.version.clone() };
        self.0.stats.seen(&client, result.protocol_version.as_str(), false);
        Ok(result)
    }

    async fn discover(&self, context: RequestContext<RoleServer>) -> Result<DiscoverResult, McpError> {
        self.client(&context, false);
        Ok(DiscoverResult::from_server_info(PROTOCOL_VERSIONS.to_vec(), self.get_info()))
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        self.client(&context, false);
        Ok(ListToolsResult::with_all_items(self.0.tools.tools()))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.0.tools.get(name).map(|t| t.tool.clone())
    }

    async fn call_tool(&self, request: CallToolRequestParams, context: RequestContext<RoleServer>) -> Result<CallToolResponse, McpError> {
        let name = request.name.to_string();
        let unknown = || McpError::invalid_params(format!("Unknown tool: {name}"), None);
        let Some(entry) = self.0.tools.get(&name) else {
            return Err(unknown());
        };
        let client = self.client(&context, true);
        // progress the page reports goes to the client while the call runs, in order
        let (progress, mut told) = match context.meta.get_progress_token() {
            Some(token) => {
                let (tx, rx) = mpsc::unbounded_channel::<Progress>();
                let tell: ProgressFn = Arc::new(move |p| {
                    let _ = tx.send(p);
                });
                (Some(tell), Some((token, rx)))
            }
            None => (None, None),
        };
        let call = Call {
            tool: name.clone(),
            args: request.arguments.unwrap_or_default(),
            client,
            timeout: entry.timeout,
            progress,
            cancel: context.ct.clone(),
        };
        let _in_hand = self.0.calls.add(&context.id, context.ct.clone());
        let flight = self.0.stats.begin(&name);
        let answer = self.0.bridge.call(call);
        let answer = match told.as_mut() {
            None => answer.await,
            Some((token, rx)) => {
                let tell = |p: Progress| {
                    let mut note = ProgressNotificationParam::new(token.clone(), p.progress);
                    note.total = p.total;
                    note.message = p.message;
                    context.peer.notify_progress(note)
                };
                tokio::pin!(answer);
                let answer = loop {
                    tokio::select! {
                        biased;
                        Some(p) = rx.recv() => {
                            let _ = tell(p).await;
                        }
                        answer = &mut answer => break answer,
                    }
                };
                // what the page said on its way to answering goes first
                while let Ok(p) = rx.try_recv() {
                    let _ = tell(p).await;
                }
                answer
            }
        };
        match answer {
            Ok(mut result) => {
                flight.end(result.is_error != Some(true));
                result.result_type = Some(ResultType::COMPLETE);
                Ok(result.into())
            }
            Err(BridgeError::Page { code, .. }) if code == "unknown_tool" => {
                flight.end(false);
                Err(unknown())
            }
            Err(e) => {
                flight.end(false);
                Ok(CallToolResult::error(vec![ContentBlock::text(e.to_string())]).into())
            }
        }
    }
}

// ---- the calls in hand, by JSON-RPC id, for notifications/cancelled ----

#[derive(Default)]
struct InHand {
    next: AtomicU64,
    by_id: Mutex<HashMap<String, Vec<(u64, CancellationToken)>>>,
}

struct InHandGuard<'a> {
    calls: &'a InHand,
    key: String,
    n: u64,
}

impl InHand {
    fn add(&self, id: &RequestId, cancel: CancellationToken) -> InHandGuard<'_> {
        let key = serde_json::to_string(id).unwrap_or_default();
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        lock(&self.by_id).entry(key.clone()).or_default().push((n, cancel));
        InHandGuard { calls: self, key, n }
    }

    /// Cancels the call in hand with the JSON-RPC id `key`, if there is just one: two clients may use
    /// the same id, and then which is meant cannot be told.
    fn cancel(&self, key: &str) -> bool {
        let by_id = lock(&self.by_id);
        match by_id.get(key).map(Vec::as_slice) {
            Some([(_, cancel)]) => {
                cancel.cancel();
                true
            }
            _ => false,
        }
    }
}

impl Drop for InHandGuard<'_> {
    fn drop(&mut self) {
        let mut by_id = lock(&self.calls.by_id);
        if let Some(list) = by_id.get_mut(&self.key) {
            list.retain(|(n, _)| *n != self.n);
            if list.is_empty() {
                by_id.remove(&self.key);
            }
        }
    }
}

async fn cancelled_notifications(State(calls): State<Arc<InHand>>, request: Request, next: Next) -> Response {
    if request.method() != Method::POST {
        return next.run(request).await;
    }
    let (parts, body) = request.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, MAX_BODY).await else {
        return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
    };
    if let Some(id) = cancelled_request(&bytes) {
        calls.cancel(&id);
    }
    next.run(Request::from_parts(parts, Body::from(bytes))).await
}

/// The JSON-RPC id (as JSON) of the request a `notifications/cancelled` body cancels.
fn cancelled_request(body: &[u8]) -> Option<String> {
    const METHOD: &[u8] = b"notifications/cancelled";
    if !body.windows(METHOD.len()).any(|w| w == METHOD) {
        return None;
    }
    let message: Value = serde_json::from_slice(body).ok()?;
    if message.get("method")?.as_str()? != "notifications/cancelled" || message.get("id").is_some() {
        return None;
    }
    let id = message.get("params")?.get("requestId")?;
    (id.is_string() || id.is_number()).then(|| id.to_string())
}

// ---- in front of every route ----

async fn bearer(State(token): State<Arc<RwLock<Secret>>>, mut request: Request, next: Next) -> Response {
    let given = request.headers().get(AUTHORIZATION).map(|v| v.to_str().ok().and_then(token::bearer));
    let ok = match given {
        Some(Some(given)) => token.read().unwrap_or_else(|e| e.into_inner()).matches(given),
        _ => false,
    };
    if !ok {
        let challenge = if given.is_some() { r#"Bearer realm="SmedCover", error="invalid_token""# } else { r#"Bearer realm="SmedCover""# };
        let message = "Unauthorized: SmedCover wants the token shown in its MCP settings, as Authorization: Bearer <token>";
        return refuse(request, (StatusCode::UNAUTHORIZED, [(WWW_AUTHENTICATE, challenge)], message).into_response()).await;
    }
    request.headers_mut().remove(AUTHORIZATION);
    next.run(request).await
}

async fn loopback_only(request: Request, next: Next) -> Response {
    if !host_allowed(request.headers()) {
        return refuse(request, (StatusCode::FORBIDDEN, "Forbidden: Host header is not allowed").into_response()).await;
    }
    let origin_ok = request.headers().get(ORIGIN).is_none_or(|origin| origin.to_str().is_ok_and(origin_allowed));
    if !origin_ok {
        return refuse(request, (StatusCode::FORBIDDEN, "Forbidden: Origin header is not allowed").into_response()).await;
    }
    next.run(request).await
}

/// `response`, once the request's body has been read: a connection closed on a body not read is
/// reset, and the client may then lose the answer and see only that.
async fn refuse(request: Request, response: Response) -> Response {
    let _ = axum::body::to_bytes(request.into_body(), MAX_BODY).await;
    response
}

fn is_loopback(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    LOOPBACK.iter().any(|l| l.eq_ignore_ascii_case(host))
}

fn host_allowed(headers: &HeaderMap) -> bool {
    let Some(host) = headers.get(HOST).and_then(|h| h.to_str().ok()) else {
        return false;
    };
    host.parse::<axum::http::uri::Authority>().is_ok_and(|a| is_loopback(a.host()))
}

fn origin_allowed(origin: &str) -> bool {
    let Ok(uri) = origin.parse::<Uri>() else {
        return false;
    };
    let scheme_ok = matches!(uri.scheme_str(), Some("http") | Some("https"));
    let bare = uri.path_and_query().is_none_or(|p| p.as_str() == "/" || p.as_str().is_empty());
    scheme_ok && bare && uri.host().is_some_and(is_loopback)
}

async fn health(State(bridge): State<Arc<dyn PageBridge>>) -> Json<Value> {
    Json(json!({"name": SERVER_NAME, "version": VERSION, "page": bridge.page().as_str()}))
}

// ---- what the page is told about the clients ----

/// A client seen in the last [`CLIENT_WINDOW`].
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSeen {
    pub name: String,
    pub version: String,
    /// The protocol revision it last used.
    pub protocol: String,
    /// When it was last seen, in milliseconds since 1970 (as JavaScript's `Date` takes it).
    pub last_seen: u64,
    /// The tool calls it has made (that could be told to be its).
    pub calls: u64,
}

/// The last tool call.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastCall {
    pub tool: String,
    /// When it ended, in milliseconds since 1970.
    pub at: u64,
    pub ok: bool,
}

/// What [`Stats`] knows at one moment.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSnapshot {
    /// The clients seen in the last [`CLIENT_WINDOW`], the latest first.
    pub clients: Vec<ClientSeen>,
    /// The tool calls under way.
    pub in_flight: usize,
    pub last_call: Option<LastCall>,
}

/// The clients seen lately and the calls under way. "Connected" can only mean "seen lately": a
/// client of the 2026-07-28 era says who it is on every request and holds no connection open.
pub struct Stats {
    inner: Mutex<StatsInner>,
    changes: watch::Sender<u64>,
}

#[derive(Default)]
struct StatsInner {
    clients: Vec<ClientSeen>,
    in_flight: usize,
    last_call: Option<LastCall>,
}

impl Default for Stats {
    fn default() -> Self {
        Stats::new()
    }
}

impl Stats {
    pub fn new() -> Stats {
        Stats { inner: Mutex::new(StatsInner::default()), changes: watch::Sender::new(0) }
    }

    /// The clients seen lately, the calls under way and the last call.
    pub fn snapshot(&self) -> StatsSnapshot {
        let mut inner = lock(&self.inner);
        prune(&mut inner.clients);
        let mut clients = inner.clients.clone();
        clients.sort_by_key(|c| std::cmp::Reverse(c.last_seen));
        StatsSnapshot { clients, in_flight: inner.in_flight, last_call: inner.last_call.clone() }
    }

    /// Changes with every change (a host passes the news on to the page, a few times a second at
    /// most).
    pub fn changes(&self) -> watch::Receiver<u64> {
        self.changes.subscribe()
    }

    fn changed(&self) {
        self.changes.send_modify(|n| *n = n.wrapping_add(1));
    }

    fn seen(&self, client: &ClientTag, protocol: &str, call: bool) {
        {
            let mut inner = lock(&self.inner);
            prune(&mut inner.clients);
            let now = now_ms();
            match inner.clients.iter_mut().find(|c| c.name == client.name && c.version == client.version) {
                Some(seen) => {
                    seen.last_seen = now;
                    if !protocol.is_empty() {
                        seen.protocol = protocol.to_string();
                    }
                    seen.calls += u64::from(call);
                }
                None => inner.clients.push(ClientSeen {
                    name: client.name.clone(),
                    version: client.version.clone(),
                    protocol: protocol.to_string(),
                    last_seen: now,
                    calls: u64::from(call),
                }),
            }
        }
        self.changed();
    }

    /// The one client seen lately that uses `protocol`, a revision of the `initialize` era.
    fn only_client_on(&self, protocol: &str) -> Option<ClientTag> {
        if !ProtocolVersion::known_up_to(&ProtocolVersion::LATEST_WITH_INITIALIZE).iter().any(|v| v.as_str() == protocol) {
            return None;
        }
        let mut inner = lock(&self.inner);
        prune(&mut inner.clients);
        let mut on = inner.clients.iter().filter(|c| c.protocol == protocol);
        match (on.next(), on.next()) {
            (Some(c), None) => Some(ClientTag { name: c.name.clone(), version: c.version.clone() }),
            _ => None,
        }
    }

    fn begin(&self, tool: &str) -> Flight<'_> {
        lock(&self.inner).in_flight += 1;
        self.changed();
        Flight { stats: self, tool: tool.to_string(), ok: false, ended: false }
    }
}

/// A call under way, counted till it ends (or is dropped, its client gone).
struct Flight<'a> {
    stats: &'a Stats,
    tool: String,
    ok: bool,
    ended: bool,
}

impl Flight<'_> {
    fn end(mut self, ok: bool) {
        self.ok = ok;
        self.ended = true;
    }
}

impl Drop for Flight<'_> {
    fn drop(&mut self) {
        {
            let mut inner = lock(&self.stats.inner);
            inner.in_flight -= 1;
            inner.last_call = Some(LastCall { tool: std::mem::take(&mut self.tool), at: now_ms(), ok: self.ended && self.ok });
        }
        self.stats.changed();
    }
}

fn prune(clients: &mut Vec<ClientSeen>) {
    let window = u64::try_from(CLIENT_WINDOW.as_millis()).unwrap_or(u64::MAX);
    let since = now_ms().saturating_sub(window);
    clients.retain(|c| c.last_seen >= since);
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX)).unwrap_or(0)
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_and_origins() {
        let host = |h: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(HOST, h.parse().unwrap());
            host_allowed(&headers)
        };
        for good in ["127.0.0.1:25277", "localhost:25277", "LOCALHOST", "[::1]:8080", "127.0.0.1"] {
            assert!(host(good), "{good}");
        }
        for bad in ["evil.example", "evil.example:25277", "127.0.0.1.evil.example", "192.168.1.2:25277", "localhost.evil:1"] {
            assert!(!host(bad), "{bad}");
        }
        assert!(!host_allowed(&HeaderMap::new()), "no Host");
        for good in ["http://127.0.0.1:5173", "http://localhost", "https://localhost:8443", "http://[::1]:3000"] {
            assert!(origin_allowed(good), "{good}");
        }
        for bad in ["null", "https://evil.example", "http://localhost.evil.example", "file://", "chrome-extension://abc", "http://127.0.0.1.nip.io", ""] {
            assert!(!origin_allowed(bad), "{bad}");
        }
    }

    #[test]
    fn an_older_clients_calls_are_its_if_it_is_the_only_one() {
        let stats = Stats::new();
        let tag = |name: &str| ClientTag { name: name.into(), version: "1".into() };
        assert_eq!(stats.only_client_on("2025-06-18"), None);
        stats.seen(&tag("claude-code"), "2025-06-18", false);
        stats.seen(&tag("modern"), "2026-07-28", false);
        assert_eq!(stats.only_client_on("2025-06-18"), Some(tag("claude-code")));
        assert_eq!(stats.only_client_on("2025-11-25"), None, "another revision");
        assert_eq!(stats.only_client_on("2026-07-28"), None, "that era says who it is");
        stats.seen(&tag("cursor"), "2025-06-18", false);
        assert_eq!(stats.only_client_on("2025-06-18"), None, "two of them: neither");
    }

    /// `/mcp` wants the token, and rmcp is not shown it.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_token_is_wanted_and_then_taken_off() {
        let secret = Secret::generate().unwrap();
        let good = format!("Bearer {}", secret.expose());
        let token = Arc::new(RwLock::new(secret));
        let app = Router::new()
            .route("/mcp", get(|headers: HeaderMap| async move { format!("authorization seen: {}", headers.contains_key(AUTHORIZATION)) }))
            .route_layer(from_fn_with_state(token.clone(), bearer));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let ask = |auth: Option<String>| {
            let url = url.clone();
            tokio::task::spawn_blocking(move || {
                let request = ureq::get(&url);
                let request = match auth {
                    Some(auth) => request.set("Authorization", &auth),
                    None => request,
                };
                match request.call() {
                    Ok(r) => (r.status(), r.header("www-authenticate").map(String::from), r.into_string().unwrap()),
                    Err(ureq::Error::Status(code, r)) => (code, r.header("www-authenticate").map(String::from), r.into_string().unwrap()),
                    Err(e) => panic!("no answer: {}", e.kind()),
                }
            })
        };
        let (status, _, body) = ask(Some(good.clone())).await.unwrap();
        assert_eq!((status, body.as_str()), (200, "authorization seen: false"));
        let (status, challenge, body) = ask(None).await.unwrap();
        assert_eq!(status, 401);
        assert_eq!(challenge.as_deref(), Some(r#"Bearer realm="SmedCover""#));
        assert!(!body.contains(&good[7..]));
        let (status, challenge, _) = ask(Some("Bearer smc_wrong".into())).await.unwrap();
        assert_eq!(status, 401);
        assert!(challenge.unwrap().contains(r#"error="invalid_token""#));
        let (status, _, _) = ask(Some(good[7..].to_string())).await.unwrap();
        assert_eq!(status, 401, "the token without the scheme");
        // a new token: the old one is turned away from the next request on
        *token.write().unwrap() = Secret::generate().unwrap();
        assert_eq!(ask(Some(good)).await.unwrap().0, 401);
        server.abort();
    }

    #[test]
    fn cancelled_notifications_are_found() {
        let note = |id: Value| json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": id, "reason": "user"}}).to_string();
        assert_eq!(cancelled_request(note(json!(7)).as_bytes()).as_deref(), Some("7"));
        assert_eq!(cancelled_request(note(json!("a-1")).as_bytes()).as_deref(), Some("\"a-1\""));
        assert_eq!(cancelled_request(note(json!(null)).as_bytes()), None);
        assert_eq!(cancelled_request(br#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"x"}}"#), None);
        // the words in a call's arguments are not a notification
        let call = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "set_text", "arguments": {"text": "notifications/cancelled"}}});
        assert_eq!(cancelled_request(call.to_string().as_bytes()), None);
        // ids written by different kinds of client match those rmcp parses
        assert_eq!(serde_json::to_string(&RequestId::Number(7)).unwrap(), "7");
        assert_eq!(serde_json::to_string(&RequestId::String("a-1".into())).unwrap(), "\"a-1\"");
    }

    #[test]
    fn a_cancel_names_one_call_or_none() {
        let calls = InHand::default();
        let (a, b, c) = (CancellationToken::new(), CancellationToken::new(), CancellationToken::new());
        let _a = calls.add(&RequestId::Number(1), a.clone());
        let _b = calls.add(&RequestId::Number(2), b.clone());
        let c_guard = calls.add(&RequestId::Number(2), c.clone());
        assert!(calls.cancel("1"));
        assert!(a.is_cancelled());
        assert!(!calls.cancel("2"), "two calls have id 2: neither is cancelled");
        assert!(!b.is_cancelled() && !c.is_cancelled());
        drop(c_guard);
        assert!(calls.cancel("2"));
        assert!(b.is_cancelled());
        assert!(!calls.cancel("3"));
    }

    #[test]
    fn stats_count_calls_and_forget_old_clients() {
        let stats = Stats::new();
        let changes = stats.changes();
        let client = ClientTag { name: "codex".into(), version: "1.0".into() };
        stats.seen(&client, "2025-06-18", false);
        stats.seen(&client, "2025-06-18", true);
        let flight = stats.begin("get_context");
        assert_eq!(stats.snapshot().in_flight, 1);
        flight.end(true);
        drop(stats.begin("export")); // its client went away
        let snapshot = stats.snapshot();
        assert_eq!(snapshot.in_flight, 0);
        assert_eq!(snapshot.clients.len(), 1);
        assert_eq!(snapshot.clients[0].calls, 1);
        assert_eq!(snapshot.clients[0].protocol, "2025-06-18");
        assert_eq!(snapshot.last_call.as_ref().map(|c| (c.tool.as_str(), c.ok)), Some(("export", false)));
        assert!(changes.has_changed().unwrap());
        let shown = serde_json::to_value(&snapshot).unwrap();
        assert!(shown["clients"][0]["lastSeen"].is_u64() && shown["inFlight"] == 0 && shown["lastCall"]["tool"] == "export");
        // seen eleven minutes ago: forgotten
        lock(&stats.inner).clients[0].last_seen -= 11 * 60 * 1000;
        assert!(stats.snapshot().clients.is_empty());
    }

    #[test]
    fn bind_errors_say_what_to_do() {
        let in_use = BindError::from_io(25277, &io::Error::from(io::ErrorKind::AddrInUse));
        assert_eq!((in_use.code(), in_use.clone()), ("port_in_use", BindError::PortInUse(25277)));
        assert!(in_use.to_string().contains("pick another port"));
        let forbidden = BindError::from_io(25277, &io::Error::from(io::ErrorKind::PermissionDenied));
        assert_eq!(forbidden.code(), "port_forbidden");
        let other = BindError::from_io(1, &io::Error::from(io::ErrorKind::AddrNotAvailable));
        assert_eq!(other.code(), "bind_failed");
    }
}
