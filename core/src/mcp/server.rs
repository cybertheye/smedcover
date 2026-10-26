//! The endpoint itself: an HTTP server on 127.0.0.1 with `/mcp`, MCP's streamable HTTP served by
//! rmcp, and `/health`. Each tool call goes to the [`PageBridge`]; the tools are those of the
//! [`ToolList`] the host read.
//!
//! Both eras of the protocol are served, without sessions: 2026-07-28 (`server/discover`, each
//! request carrying its own `_meta` and the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name`
//! headers, which rmcp checks), and the `initialize` handshake of 2025-03-26, 2025-06-18 and
//! 2025-11-25 (a request without the header is taken as 2025-03-26). A JSON-RPC batch (an array,
//! which 2025-03-26 allows) is not served: rmcp refuses it.
//!
//! Answers are server-sent events, so that a long call (an export waiting for the user) is not cut
//! off by a client that waits only so long for an answer's headers (Node's `fetch`, which most
//! clients use, gives up after 5 minutes): once the headers are out, a keep-alive comment follows
//! every 15 s. When the headers go out depends on the era. In the `initialize` era rmcp sends them
//! at once. In the 2026-07-28 era it builds the answer from the handler's first message and sends
//! nothing before it, and nothing in its API sends headers sooner (a priming event needs an event
//! store, and even then comes after that first message). So a call that names a `progressToken` is
//! told progress 0 at once, which is that first message, and the page's own progress follows only
//! when it is more than that; a 2026-07-28 call without a progress token gets its headers only with
//! its result, and how long its client waits for headers is how long it may take. Refusals (400,
//! 401, 403, …) are plain.
//!
//! In front of it, for every path and whoever may call: a `Host` that is not 127.0.0.1, localhost or
//! [::1] is refused (403: another site's name resolving to this computer, DNS rebinding), and so is
//! an `Origin` that is not one of those over http(s) (403: a web page in a browser, which always sends
//! one on a POST; the app's own web view, `tauri://localhost` or `http://tauri.localhost`, among
//! them). No CORS headers are ever sent, so even a page on a loopback origin gets no further than its
//! browser's preflight: rmcp takes only `Content-Type: application/json`, which a page cannot send
//! without one. A request carrying [`PAGE_MARKER`], which the app's own requests for its page carry
//! (`crate::net`), is refused too (403): the page cannot reach the endpoint through the app, by
//! whatever name, address, proxy or redirect.
//!
//! Who may call `/mcp` is the host's [`Access`], read at every request, so a change is in force from
//! the next one. [`Access::Open`] (the desktop's default) lets every request through: any program
//! that can reach 127.0.0.1 — the user's own, and also other accounts on the computer, containers
//! (which may send any `Host`), virtual machines and WSL with mirrored networking, sandboxed apps
//! allowed the network — may then drive the window, have the app read any picture or project the
//! user can read by naming its path, write new pictures into any folder the user can write, and
//! fetch links; web pages cannot, as above. [`Access::Token`] wants `Authorization: Bearer <token>`
//! (401 without it, or with another): the desktop's when the user turns *Require a token* on (a
//! computer shared, or running containers, virtual machines or apps not trusted), and a server's
//! (`smedcover serve`) always — for an endpoint serving the tools read for [`Host::Server`],
//! [`Access::Open`] lets no one in. In both the header is taken off before rmcp sees the request.
//! `/health` says `{"name": "smedcover", "version", "page"}` to anyone who may reach it.
//!
//! Connections: a request's headers must come within [`HEADER_TIMEOUT`] (else the connection is
//! closed), an accepted request's body within [`BODY_TIMEOUT`] (else 408), and `/mcp` takes bodies
//! up to [`MAX_BODY`] (a tool may carry a photo as base64). A refused request's body is read, and not
//! kept, for at most [`REFUSED_BODY_BYTES`] and [`REFUSED_BODY_TIME`] (a connection closed on a
//! body not read is reset, and the client may lose the refusal), and its connection is then closed.
//! [`Running::stop`] closes every connection, the port being free again when it returns.
//!
//! A client of the older era cancels a call with `notifications/cancelled` in a request of its own,
//! which a session-less server cannot tie to the call. It is looked for here, and cancels a call
//! only when there is no doubt which: an older-era call in hand with that JSON-RPC id on the
//! notification's protocol revision, from the same client when that can be told, the only one, and
//! no call with that id on that revision ended in the last [`LATE_CANCEL`] (a late cancel for that
//! one is likelier than one for another client's). Two clients' ids are their own and small, so they
//! meet; a cancel that cannot be placed is ignored, and that call runs to its end.

use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::header::{AUTHORIZATION, CONNECTION, CONTENT_LENGTH, HOST, ORIGIN, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::{from_fn, from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use http_body_util::BodyExt;
use hyper_util::rt::{TokioIo, TokioTimer};
use hyper_util::service::TowerToHyperService;
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
use tokio::net::{TcpListener, TcpStream};
use tokio::task::{JoinHandle, JoinSet};
use tokio_util::sync::CancellationToken;

use super::bridge::{BridgeError, Call, ClientTag, PageBridge, Progress, ProgressFn};
use super::token::{self, Secret};
use super::tools::{Host, ToolList};

/// What the endpoint calls itself, and its version (the app's).
pub const SERVER_NAME: &str = "smedcover";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// The protocol revisions served, oldest first: 2024-11-05's HTTP with SSE is not.
pub const PROTOCOL_VERSIONS: &[ProtocolVersion] =
    &[ProtocolVersion::V_2025_03_26, ProtocolVersion::V_2025_06_18, ProtocolVersion::V_2025_11_25, ProtocolVersion::V_2026_07_28];
/// The largest request body `/mcp` takes: a tool's arguments may carry a photo or a project as
/// text (the page holds those to 24 Mi characters).
pub const MAX_BODY: usize = 32 * 1024 * 1024;
/// How long a client has to send a request's headers.
pub const HEADER_TIMEOUT: Duration = Duration::from_secs(10);
/// How long a client has to send an accepted request's body.
pub const BODY_TIMEOUT: Duration = Duration::from_secs(30);
/// How much of a refused request's body is read, and for how long, before its connection is closed.
pub const REFUSED_BODY_BYTES: usize = 64 * 1024;
pub const REFUSED_BODY_TIME: Duration = Duration::from_secs(2);
/// A cancel for an id that a call on the same revision ended with this lately is not placed.
pub const LATE_CANCEL: Duration = Duration::from_secs(30);
/// How long a client counts as seen.
pub const CLIENT_WINDOW: Duration = Duration::from_secs(10 * 60);
/// The hosts and origins the endpoint answers: this computer's loopback names.
const LOOPBACK: [&str; 3] = ["127.0.0.1", "localhost", "::1"];

/// The header every request the app sends for its page carries (see `crate::net`); the endpoint
/// refuses any request that has it, whatever its value. Lower case, as HTTP/1.1 header names are
/// told apart without case.
pub const PAGE_MARKER: &str = "x-smedcover-page";

/// Who may call `/mcp` (see the module's notes). Whichever it is, the `Host`, `Origin` and
/// [`PAGE_MARKER`] checks keep web pages out. Its `Debug` does not show the token.
#[derive(Clone, Debug)]
pub enum Access {
    /// Any client that reaches it, with or without an `Authorization` header (one sent anyway is not
    /// looked at): the desktop app's default. An endpoint serving a server's tools lets no one in.
    Open,
    /// Only a client that shows this token, as `Authorization: Bearer <token>`: the desktop app's when
    /// the user turns *Require a token* on, and a server's (`smedcover serve`) always.
    Token(Secret),
}

impl Access {
    /// Whether a request whose `Authorization` header gave `given` may call: `None`, no header;
    /// `Some(None)`, one that is not `Bearer <token>`. `open_allowed`: whether [`Access::Open`] lets
    /// anyone in (the desktop's tools), or no one (a server's).
    fn lets_in(&self, given: Option<Option<&str>>, open_allowed: bool) -> bool {
        match self {
            Access::Open => open_allowed,
            Access::Token(token) => given.flatten().is_some_and(|given| token.matches(given)),
        }
    }
}

/// What the layer that wants the token needs: the access in force, and whether an open one lets
/// anyone in.
#[derive(Clone)]
struct Gate {
    access: Arc<RwLock<Access>>,
    open_allowed: bool,
}

/// The endpoint, ready to be started (and started again, on another port or after being stopped).
#[derive(Clone)]
pub struct McpServer {
    bridge: Arc<dyn PageBridge>,
    tools: Arc<ToolList>,
    access: Arc<RwLock<Access>>,
    stats: Arc<Stats>,
}

impl McpServer {
    /// An endpoint whose calls go to `bridge`, offering `tools`, to the clients `access` lets in
    /// (which the host may change while it runs, open or another token: each request is checked
    /// against it as it is then), and keeping account in `stats`. With tools read for
    /// [`Host::Server`] it wants a token whatever it is given: [`Access::Open`] then lets no one in
    /// (401), so a server cannot be opened without one.
    pub fn new(bridge: Arc<dyn PageBridge>, tools: Arc<ToolList>, access: Arc<RwLock<Access>>, stats: Arc<Stats>) -> McpServer {
        McpServer { bridge, tools, access, stats }
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
        let cut_off = CancellationToken::new();
        let task = runtime.spawn(serve(listener, app, stop.clone(), cut_off.clone()));
        Ok(Running { addr, stop, cut_off, task: Some(task) })
    }

    /// The routes, for a host that serves them itself: `stop` ends the calls in hand, and the
    /// bodies being read, when cancelled.
    pub fn router(&self, stop: CancellationToken) -> Router {
        let calls = Arc::new(InHand::default());
        let front = Front { calls: calls.clone(), stats: self.stats.clone(), stop: stop.clone() };
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
            .route_layer(from_fn_with_state(front, read_body))
            .route_layer(from_fn_with_state(Gate { access: self.access.clone(), open_allowed: self.tools.host() == Host::Desktop }, bearer));
        Router::new().route("/health", get(health)).with_state(self.bridge.clone()).merge(mcp).layer(from_fn(loopback_only))
    }
}

/// The endpoint while it listens. Dropping it stops it too, without waiting: the connections then
/// close in their own time.
pub struct Running {
    addr: SocketAddr,
    stop: CancellationToken,
    cut_off: CancellationToken,
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

    /// Stops listening at once, ends the calls in hand (each is cancelled, and the page told) and
    /// the bodies being read, and closes every connection as soon as its answer is out; one still
    /// open after `within` is cut off. When it returns no connection is left and the port is free
    /// again. `false` if a connection had to be cut off.
    pub async fn stop(mut self, within: Duration) -> bool {
        self.stop.cancel();
        let Some(mut task) = self.task.take() else {
            return true;
        };
        if tokio::time::timeout(within, &mut task).await.is_ok() {
            return true;
        }
        // the serve task cuts the connections off and returns once each is gone
        self.cut_off.cancel();
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
            // the standard library reads WSAEACCES (10013, a port Windows keeps) as this, and so
            // EACCES (a system port) on Unix
            io::ErrorKind::PermissionDenied => BindError::PortForbidden(port),
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
    use windows_sys::Win32::Networking::WinSock::{setsockopt, WSAGetLastError, SOCKET, SOL_SOCKET, SO_EXCLUSIVEADDRUSE};
    let socket = Socket::new(Domain::for_address(addr), Type::STREAM, Some(Protocol::TCP))?;
    let on: i32 = 1;
    // SAFETY: the socket is open for the whole call, and the option is the i32 it points to
    let failed = unsafe {
        setsockopt(socket.as_raw_socket() as SOCKET, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (&on as *const i32).cast(), std::mem::size_of::<i32>() as i32)
    };
    if failed != 0 {
        // Winsock says why through WSAGetLastError, not GetLastError
        // SAFETY: no arguments; it reads this thread's last Winsock error
        return Err(io::Error::from_raw_os_error(unsafe { WSAGetLastError() }));
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

/// Takes connections till `stop`, then lets each finish the answer it is giving and close, and
/// returns when the last has; once `cut_off` too, it cuts off those still open, and returns when
/// they are gone.
async fn serve(listener: TcpListener, app: Router, stop: CancellationToken, cut_off: CancellationToken) {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            _ = stop.cancelled() => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    connections.spawn(connection(stream, app.clone(), stop.clone()));
                }
                // out of file descriptors and the like: try again in a moment
                Err(_) => tokio::time::sleep(Duration::from_millis(50)).await,
            },
            Some(_) = connections.join_next(), if !connections.is_empty() => {}
        }
    }
    drop(listener);
    let all_closed = async { while connections.join_next().await.is_some() {} };
    let cut = tokio::select! {
        _ = all_closed => false,
        _ = cut_off.cancelled() => true,
    };
    if cut {
        connections.shutdown().await;
    }
}

/// Serves one connection: HTTP/1.1, its requests' headers wanted within [`HEADER_TIMEOUT`]; once
/// `stop` is cancelled it closes after the answer it is giving.
async fn connection(stream: TcpStream, app: Router, stop: CancellationToken) {
    let _ = stream.set_nodelay(true);
    let mut http = hyper::server::conn::http1::Builder::new();
    http.timer(TokioTimer::new()).header_read_timeout(HEADER_TIMEOUT);
    let conn = http.serve_connection(TokioIo::new(stream), TowerToHyperService::new(app));
    tokio::pin!(conn);
    tokio::select! {
        _ = conn.as_mut() => return,
        _ = stop.cancelled() => {}
    }
    conn.as_mut().graceful_shutdown();
    let _ = conn.await;
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
        let protocol = protocol_of(context);
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
        let protocol = protocol_of(&context);
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
        // an older-era call may be cancelled by a notification of its own (see the module's notes)
        let _in_hand = is_legacy(&protocol).then(|| self.0.calls.add(&context.id, &protocol, client.clone(), context.ct.clone()));
        let call = Call {
            tool: name.clone(),
            args: request.arguments.unwrap_or_default(),
            client,
            timeout: entry.timeout,
            progress,
            cancel: context.ct.clone(),
        };
        let flight = self.0.stats.begin(&name);
        let answer = self.0.bridge.call(call);
        let answer = match told.as_mut() {
            None => answer.await,
            Some((token, rx)) => {
                // progress 0 at once: in the 2026-07-28 era it is what sends the answer's headers
                let _ = context.peer.notify_progress(ProgressNotificationParam::new(token.clone(), 0.0)).await;
                let mut last = 0.0;
                let mut tell = |p: Progress| {
                    let more = p.progress > last;
                    if more {
                        last = p.progress;
                    }
                    let mut note = ProgressNotificationParam::new(token.clone(), p.progress);
                    note.total = p.total;
                    note.message = p.message;
                    let peer = &context.peer;
                    async move {
                        if more {
                            let _ = peer.notify_progress(note).await;
                        }
                    }
                };
                tokio::pin!(answer);
                let answer = loop {
                    tokio::select! {
                        biased;
                        Some(p) = rx.recv() => tell(p).await,
                        answer = &mut answer => break answer,
                    }
                };
                // what the page said on its way to answering goes first
                while let Ok(p) = rx.try_recv() {
                    tell(p).await;
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

// ---- the older era's calls in hand, by JSON-RPC id, for notifications/cancelled ----

#[derive(Default)]
struct InHand {
    next: AtomicU64,
    state: Mutex<InHandState>,
}

#[derive(Default)]
struct InHandState {
    /// The calls in hand by their JSON-RPC id (as JSON).
    by_id: HashMap<String, Vec<InHandCall>>,
    /// The id and revision of each call that ended in the last [`LATE_CANCEL`], and when.
    ended: VecDeque<(String, String, Instant)>,
}

struct InHandCall {
    n: u64,
    protocol: String,
    client: Option<ClientTag>,
    cancel: CancellationToken,
}

struct InHandGuard<'a> {
    calls: &'a InHand,
    key: String,
    n: u64,
}

impl InHandState {
    fn forget_old(&mut self) {
        let now = Instant::now();
        while self.ended.front().is_some_and(|(_, _, at)| now.duration_since(*at) > LATE_CANCEL) {
            self.ended.pop_front();
        }
    }
}

impl InHand {
    fn add(&self, id: &RequestId, protocol: &str, client: Option<ClientTag>, cancel: CancellationToken) -> InHandGuard<'_> {
        let key = serde_json::to_string(id).unwrap_or_default();
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        let call = InHandCall { n, protocol: protocol.to_string(), client, cancel };
        lock(&self.state).by_id.entry(key.clone()).or_default().push(call);
        InHandGuard { calls: self, key, n }
    }

    /// Cancels the call a `notifications/cancelled` for the JSON-RPC id `key` means, on `protocol`
    /// and from `client` (when that can be told), if there is no doubt which (see the module's notes).
    fn cancel(&self, key: &str, protocol: &str, client: Option<&ClientTag>) -> bool {
        if !is_legacy(protocol) {
            return false;
        }
        let mut state = lock(&self.state);
        state.forget_old();
        if state.ended.iter().any(|(k, p, _)| k == key && p == protocol) {
            return false;
        }
        let mut meant = state
            .by_id
            .get(key)
            .into_iter()
            .flatten()
            .filter(|c| c.protocol == protocol && client.is_none_or(|client| c.client.as_ref() == Some(client)));
        match (meant.next(), meant.next()) {
            (Some(call), None) => {
                call.cancel.cancel();
                true
            }
            _ => false,
        }
    }
}

impl Drop for InHandGuard<'_> {
    fn drop(&mut self) {
        let mut state = lock(&self.calls.state);
        let Some(list) = state.by_id.get_mut(&self.key) else {
            return;
        };
        let protocol = list.iter().find(|c| c.n == self.n).map(|c| c.protocol.clone());
        list.retain(|c| c.n != self.n);
        if list.is_empty() {
            state.by_id.remove(&self.key);
        }
        if let Some(protocol) = protocol {
            state.forget_old();
            state.ended.push_back((self.key.clone(), protocol, Instant::now()));
        }
    }
}

/// What the layer that reads `/mcp`'s bodies needs.
#[derive(Clone)]
struct Front {
    calls: Arc<InHand>,
    stats: Arc<Stats>,
    stop: CancellationToken,
}

/// Reads a POST's body before rmcp does, within [`BODY_TIMEOUT`] and [`MAX_BODY`] and only till the
/// endpoint stops, and looks in it for `notifications/cancelled`.
async fn read_body(State(front): State<Front>, request: Request, next: Next) -> Response {
    if request.method() != Method::POST {
        return next.run(request).await;
    }
    let too_large = || (StatusCode::PAYLOAD_TOO_LARGE, format!("Payload Too Large: SmedCover takes requests of up to {} MiB", MAX_BODY >> 20));
    let declared = request.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
    if declared.is_some_and(|length| length > MAX_BODY as u64) {
        return refuse(request, too_large().into_response()).await;
    }
    let (parts, body) = request.into_parts();
    let read = tokio::time::timeout(BODY_TIMEOUT, axum::body::to_bytes(body, MAX_BODY));
    let bytes = tokio::select! {
        read = read => match read {
            Ok(Ok(bytes)) => bytes,
            Ok(Err(e)) if is_too_large(&e) => return closing(too_large().into_response()),
            Ok(Err(_)) => return closing((StatusCode::BAD_REQUEST, "Bad Request: the body could not be read").into_response()),
            Err(_) => return closing((StatusCode::REQUEST_TIMEOUT, "Request Timeout: the body did not come in time").into_response()),
        },
        _ = front.stop.cancelled() => {
            return closing((StatusCode::SERVICE_UNAVAILABLE, "Service Unavailable: SmedCover's MCP endpoint is stopping").into_response());
        }
    };
    if let Some(id) = cancelled_request(&bytes) {
        let protocol = parts.headers.get("mcp-protocol-version").and_then(|v| v.to_str().ok()).unwrap_or("2025-03-26");
        let client = front.stats.only_client_on(protocol);
        front.calls.cancel(&id, protocol, client.as_ref());
    }
    next.run(Request::from_parts(parts, Body::from(bytes))).await
}

fn is_too_large(e: &axum::Error) -> bool {
    std::error::Error::source(e).is_some_and(|e| e.is::<http_body_util::LengthLimitError>())
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

/// Lets a request to `/mcp` through if the [`Access`] in force then does (401 if not, saying how the
/// token was missing or wrong), the `Authorization` header taken off either way.
async fn bearer(State(gate): State<Gate>, mut request: Request, next: Next) -> Response {
    let given = request.headers().get(AUTHORIZATION).map(|v| v.to_str().ok().and_then(token::bearer));
    let ok = gate.access.read().unwrap_or_else(|e| e.into_inner()).lets_in(given, gate.open_allowed);
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
    if request.headers().contains_key(PAGE_MARKER) {
        return refuse(request, (StatusCode::FORBIDDEN, "Forbidden: SmedCover's own window may not call its endpoint for agents").into_response()).await;
    }
    next.run(request).await
}

/// `response` to a request that is refused, its connection to be closed after it; first some of
/// the body is read and dropped (see the module's notes).
async fn refuse(request: Request, response: Response) -> Response {
    let mut body = request.into_body();
    let until = tokio::time::Instant::now() + REFUSED_BODY_TIME;
    let mut read = 0;
    while read <= REFUSED_BODY_BYTES {
        match tokio::time::timeout_at(until, body.frame()).await {
            Ok(Some(Ok(frame))) => read += frame.data_ref().map_or(0, |data| data.len()),
            _ => break,
        }
    }
    closing(response)
}

/// `response`, saying the connection closes after it.
fn closing(mut response: Response) -> Response {
    response.headers_mut().insert(CONNECTION, HeaderValue::from_static("close"));
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
        if !is_legacy(protocol) {
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

/// The protocol revision of a request: its `_meta`'s, else its `MCP-Protocol-Version` header's
/// (rmcp takes a request without either as 2025-03-26).
fn protocol_of(context: &RequestContext<RoleServer>) -> String {
    context.protocol_version().map(|v| v.to_string()).unwrap_or_default()
}

/// Whether `protocol` is a revision of the `initialize` era that is served.
fn is_legacy(protocol: &str) -> bool {
    PROTOCOL_VERSIONS.iter().any(|v| v.has_initialize() && v.as_str() == protocol)
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
        // the app's own web view (macOS and Linux, Windows): with no token wanted, this is what keeps
        // its page from calling the endpoint itself with fetch()
        for own in ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "ipc://localhost"] {
            assert!(!origin_allowed(own), "{own}");
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

    /// `/mcp` wants the token while the access is a token's, wants none while it is open, the one in
    /// force at each request; and rmcp is never shown the header.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_token_is_wanted_when_asked_for_and_always_taken_off() {
        let secret = Secret::generate().unwrap();
        let good = format!("Bearer {}", secret.expose());
        let access = Arc::new(RwLock::new(Access::Token(secret.clone())));
        let app = Router::new()
            .route("/mcp", get(|headers: HeaderMap| async move { format!("authorization seen: {}", headers.contains_key(AUTHORIZATION)) }))
            .route_layer(from_fn_with_state(Gate { access: access.clone(), open_allowed: true }, bearer));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let server = tokio::spawn(serve(listener, app, CancellationToken::new(), CancellationToken::new()));
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
        // open: every request through, a header sent anyway (right, wrong, of another scheme) not
        // looked at and taken off all the same
        *access.write().unwrap() = Access::Open;
        for auth in [None, Some(good.clone()), Some("Bearer smc_wrong".into()), Some("Basic dXNlcjpwYXNz".into())] {
            let (status, challenge, body) = ask(auth).await.unwrap();
            assert_eq!((status, challenge, body.as_str()), (200, None, "authorization seen: false"));
        }
        // a token again: wanted from the next request on, and a new one turns the old away
        *access.write().unwrap() = Access::Token(secret);
        assert_eq!(ask(None).await.unwrap().0, 401);
        assert_eq!(ask(Some(good.clone())).await.unwrap().0, 200);
        *access.write().unwrap() = Access::Token(Secret::generate().unwrap());
        assert_eq!(ask(Some(good)).await.unwrap().0, 401);
        server.abort();
    }

    /// For a server's tools an open access lets no one in, with a token or without; a token's lets in
    /// whoever shows it.
    #[test]
    fn a_servers_endpoint_is_never_open() {
        let secret = Secret::generate().unwrap();
        let shown = Some(Some(secret.expose()));
        for given in [None, Some(None), Some(Some("smc_whatever")), shown] {
            assert!(!Access::Open.lets_in(given, false), "{given:?}");
            assert!(Access::Open.lets_in(given, true), "the desktop's: {given:?}");
        }
        let token = Access::Token(secret.clone());
        assert!(token.lets_in(shown, false) && token.lets_in(shown, true));
        assert!(!token.lets_in(None, false) && !token.lets_in(Some(Some("smc_whatever")), true));
    }

    #[test]
    fn access_does_not_show_its_token() {
        let secret = Secret::generate().unwrap();
        let shown = format!("{:?} {:?}", Access::Token(secret.clone()), Access::Open);
        assert!(!shown.contains(secret.expose()), "{shown}");
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
        const V: &str = "2025-06-18";
        let calls = InHand::default();
        let tag = |name: &str| ClientTag { name: name.into(), version: "1".into() };
        let token = CancellationToken::new;
        let (a, b, c, d) = (token(), token(), token(), token());
        let _a = calls.add(&RequestId::Number(1), V, Some(tag("claude")), a.clone());
        let _b = calls.add(&RequestId::Number(2), V, Some(tag("claude")), b.clone());
        let c_guard = calls.add(&RequestId::Number(2), V, None, c.clone());
        let _d = calls.add(&RequestId::Number(4), "2025-11-25", None, d.clone());
        // another revision, the 2026-07-28 era, another client: not the call meant
        assert!(!calls.cancel("1", "2025-11-25", None));
        assert!(!calls.cancel("1", "2026-07-28", None));
        assert!(!calls.cancel("1", V, Some(&tag("cursor"))));
        assert!(!a.is_cancelled());
        assert!(calls.cancel("1", V, Some(&tag("claude"))));
        assert!(a.is_cancelled());
        assert!(!calls.cancel("2", V, None), "two calls have id 2: neither is cancelled");
        assert!(!b.is_cancelled() && !c.is_cancelled());
        // told whose, the one of that client's is meant
        assert!(calls.cancel("2", V, Some(&tag("claude"))));
        assert!(b.is_cancelled() && !c.is_cancelled());
        // a call with that id just ended on that revision: the cancel may be its, late
        drop(c_guard);
        let e = token();
        let _e = calls.add(&RequestId::Number(2), V, None, e.clone());
        assert!(!calls.cancel("2", V, None));
        assert!(!e.is_cancelled());
        // and on another revision the ended one is no reason to doubt
        assert!(calls.cancel("4", "2025-11-25", None));
        assert!(!calls.cancel("3", V, None));
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
