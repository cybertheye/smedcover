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
//! The command line's endpoint (the app's, beside the one the user turns on: see [`AppControl`] and
//! `crate::instance`) is served by [`McpServer::with_app`], with the same `/mcp`, and its own routes:
//! `GET /health`, which says whether calls are taken (`ready`: the page has attached) and whether the
//! app waits on its first start's welcome (`needsSetup`) too, `POST /app/show` and `POST /app/done`.
//! There every route wants the token, `/health` too ([`Access::Open`] lets no one in), behind the same
//! `Host`, `Origin` and [`PAGE_MARKER`] checks as the rest.
//!
//! Connections: a request's headers must come within [`HEADER_TIMEOUT`] (else the connection is
//! closed), an accepted request's body within [`BODY_TIMEOUT`] (else 408), and `/mcp` takes bodies
//! up to [`MAX_BODY`] (a tool may carry a photo as base64). A refused request's body is read, and not
//! kept, for at most [`REFUSED_BODY_BYTES`] and [`REFUSED_BODY_TIME`] (a connection closed on a
//! body not read is reset, and the client may lose the refusal), and its connection is then closed.
//! [`Running::stop`] closes every connection, the port being free again when it returns.
//!
//! Who a request comes from: a client of 2026-07-28 says so in every request's `_meta`. A client of
//! the older revisions says so only in `initialize`, once for each connection it makes, and there are
//! no sessions to tie its later requests to it; so the answer to an `initialize` carries an
//! `Mcp-Session-Id`, a new random id (128 bits, base64url) that the client sends back with each later
//! request, as those revisions have it, and that is used for nothing but telling whose a request is
//! (rmcp, without sessions, does not look at it, and `GET` and `DELETE`, which a client holding an id
//! may send, still answer 405). A request whose id is not one given out — the app started again
//! since, or the id forgotten among the [`MAX_KNOWN`] kept ([`MAX_KNOWN_EACH`] of any one client, so
//! that one connecting again and again pushes out only its own) — is served all the same, never
//! refused. It is taken to be the client that came with the same `User-Agent` on the same revision,
//! if one alone did and was seen lately; a request without an id, to that client whenever it was
//! seen. Else either is taken to be the one client of that revision seen lately (among those with
//! that `User-Agent`, if any, and never one that came only with another), else no one's, and is then
//! counted as an unidentified client's. Who each client is, as its `initialize` said, is kept for as
//! long as the [`Stats`] are (the app's lifetime), apart from whether it was seen lately, which counts
//! from its last request or the end of its last call, and lasts while it has a call under way.
//!
//! A client of the older era cancels a call with `notifications/cancelled` in a request of its own,
//! which a session-less server cannot tie to the call. It is looked for here, and cancels a call
//! only when there is no doubt which: an older-era call in hand with that JSON-RPC id on the
//! notification's protocol revision, of the same connection when the cancel carries the session id
//! the call came with, else from the same client when that can be told (as above), the only one, and
//! no call with that id on that revision (and that connection, if it can be told) ended in the last
//! [`LATE_CANCEL`] (a late cancel for that one is likelier than one for another client's). Two
//! clients' ids are their own and small, so they meet; a cancel that cannot be placed is ignored, and
//! that call runs to its end.

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
use axum::http::header::{AUTHORIZATION, CONNECTION, CONTENT_LENGTH, HOST, ORIGIN, USER_AGENT, WWW_AUTHENTICATE};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::middleware::{from_fn, from_fn_with_state, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
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
use serde_json::{json, Map, Value};
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
/// How many of the clients' `initialize`s are remembered, to recognise their later requests by:
/// past that, the one used longest ago is forgotten.
pub const MAX_KNOWN: usize = 256;
/// How many `initialize`s of any one client (by name and version) are remembered: past that, its
/// own used longest ago is forgotten.
pub const MAX_KNOWN_EACH: usize = 8;
/// How many clients are kept among those seen lately: past that, the one seen longest ago (with no
/// call under way) is forgotten.
pub const MAX_SEEN: usize = 64;
/// The most of a client's name, and of its version, that is kept.
pub const TAG_BYTES: usize = 256;
/// The header that carries a connection's session id (lower case, as header names are told apart
/// without case).
pub const SESSION_ID: &str = "mcp-session-id";
/// The most of a `User-Agent` kept and compared.
const AGENT_BYTES: usize = 256;
/// An `initialize` is looked for only in a body of up to this size.
const INITIALIZE_BYTES: usize = 1024 * 1024;
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

/// What the layer that wants the token needs: the access in force, whether an open one lets
/// anyone in, and where the token is to be found, for the refusal to say.
#[derive(Clone)]
struct Gate {
    access: Arc<RwLock<Access>>,
    open_allowed: bool,
    found_in: &'static str,
}

/// What the command line asks of the app whose endpoint it calls, besides the tools: the routes of an
/// endpoint served with [`McpServer::with_app`] (see the module's notes). Each answers at once, what
/// it asks for being done by the app in its own time.
pub trait AppControl: Send + Sync + 'static {
    /// What `/health` says besides the name, the version, the page and `ready`: `needsSetup`.
    fn health(&self) -> Map<String, Value>;
    /// `POST /app/show`: the window shown and brought to the front, and an app the command line
    /// started hidden made the user's (it goes on when the command line is done); the answer.
    fn show(&self) -> Value;
    /// `POST /app/done`: the command line that started the app is done with it, so it quits (what the
    /// page has to write written first), unless it is the user's by then; asked again, the same. The
    /// answer.
    fn done(&self) -> Value;
}

/// The endpoint, ready to be started (and started again, on another port or after being stopped).
#[derive(Clone)]
pub struct McpServer {
    bridge: Arc<dyn PageBridge>,
    tools: Arc<ToolList>,
    access: Arc<RwLock<Access>>,
    stats: Arc<Stats>,
    app: Option<Arc<dyn AppControl>>,
}

impl McpServer {
    /// An endpoint whose calls go to `bridge`, offering `tools`, to the clients `access` lets in
    /// (which the host may change while it runs, open or another token: each request is checked
    /// against it as it is then), and keeping account in `stats`. With tools read for
    /// [`Host::Server`] it wants a token whatever it is given: [`Access::Open`] then lets no one in
    /// (401), so a server cannot be opened without one.
    pub fn new(bridge: Arc<dyn PageBridge>, tools: Arc<ToolList>, access: Arc<RwLock<Access>>, stats: Arc<Stats>) -> McpServer {
        McpServer { bridge, tools, access, stats, app: None }
    }

    /// The command line's endpoint: as this one, with `/health`, `/app/show` and `/app/done` answered
    /// by `app`, and every route wanting the token ([`Access::Open`] lets no one in).
    pub fn with_app(mut self, app: Arc<dyn AppControl>) -> McpServer {
        self.app = Some(app);
        self
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
        let gate = match self.app {
            None => Gate { access: self.access.clone(), open_allowed: self.tools.host() == Host::Desktop, found_in: "shown in its MCP settings" },
            Some(_) => Gate { access: self.access.clone(), open_allowed: false, found_in: "in its data folder's cli.json" },
        };
        let mcp = Router::new()
            .route_service("/mcp", mcp)
            .route_layer(from_fn_with_state(front, read_body))
            .route_layer(from_fn_with_state(gate.clone(), bearer));
        let rest = match &self.app {
            None => Router::new().route("/health", get(health)).with_state(self.bridge.clone()),
            Some(app) => Router::new()
                .route("/health", get(app_health))
                .route("/app/show", post(app_show))
                .route("/app/done", post(app_done))
                .with_state(AppRoutes { bridge: self.bridge.clone(), app: app.clone() })
                .route_layer(from_fn_with_state(gate, bearer)),
        };
        rest.merge(mcp).layer(from_fn(loopback_only))
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
    /// The client making a request, noted as seen (`None`, counted as an unidentified client's, when
    /// it cannot be told): as its `_meta` says in the 2026-07-28 era. A client of the older era says
    /// who it is in `initialize` only, and its later requests are recognised by the session id its
    /// answer gave it, else by its `User-Agent`, else as the one client of its revision seen lately
    /// (see the module's notes).
    fn client(&self, context: &RequestContext<RoleServer>, call: bool) -> Option<ClientTag> {
        let protocol = protocol_of(context);
        let client = match context.meta.client_info() {
            Some(c) => Some(client_tag(&c.name, &c.version)),
            None => {
                let caller = caller_of(context);
                self.0.stats.recognise(caller.session.as_deref(), caller.agent.as_deref(), &protocol)
            }
        };
        self.0.stats.seen(client.as_ref(), &protocol, call);
        client
    }
}

/// Who a request to `/mcp` says it comes from in its headers, noted by [`read_body`] in the
/// request's extensions (which rmcp hands the handler with the rest of the request's parts): the
/// session id it carries, its `User-Agent`, and for an `initialize` the new session id its answer
/// is to give.
#[derive(Clone, Debug, Default)]
struct Caller {
    session: Option<String>,
    agent: Option<String>,
    new_session: Option<String>,
}

impl Caller {
    fn of(headers: &HeaderMap) -> Caller {
        let text = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::trim).filter(|v| !v.is_empty());
        Caller {
            session: text(SESSION_ID).map(String::from),
            agent: text(USER_AGENT.as_str()).map(|a| cut(a, AGENT_BYTES)),
            new_session: None,
        }
    }
}

/// What [`read_body`] noted of the request a handler answers (nothing for a request it did not see).
fn caller_of(context: &RequestContext<RoleServer>) -> Caller {
    context.extensions.get::<axum::http::request::Parts>().and_then(|p| p.extensions.get::<Caller>()).cloned().unwrap_or_default()
}

/// A new session id, 128 random bits in base64url (none if the system's random source fails: the
/// client is then recognised as one without an id is).
fn new_session_id() -> Option<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).ok()?;
    Some(URL_SAFE_NO_PAD.encode(bytes))
}

impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        self.0.info.clone()
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(PROTOCOL_VERSIONS)
    }

    /// The client is introduced: by the session id its answer carries (see [`read_body`]) and the
    /// `User-Agent` it came with, on the revision agreed.
    async fn initialize(&self, request: InitializeRequestParams, context: RequestContext<RoleServer>) -> Result<InitializeResult, McpError> {
        context.peer.set_peer_info(request.clone());
        let result = self.negotiate_initialize(&request)?;
        let client = client_tag(&request.client_info.name, &request.client_info.version);
        let (caller, protocol) = (caller_of(&context), result.protocol_version.as_str());
        self.0.stats.introduce(caller.new_session.as_deref(), &client, caller.agent.as_deref(), protocol);
        self.0.stats.seen(Some(&client), protocol, false);
        Ok(result)
    }

    async fn ping(&self, context: RequestContext<RoleServer>) -> Result<(), McpError> {
        self.client(&context, false);
        Ok(())
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
        let _in_hand = is_legacy(&protocol).then(|| self.0.calls.add(&context.id, &protocol, client.clone(), caller_of(&context).session, context.ct.clone()));
        let call = Call {
            tool: name.clone(),
            args: request.arguments.unwrap_or_default(),
            client,
            timeout: entry.timeout,
            progress,
            cancel: context.ct.clone(),
        };
        let flight = self.0.stats.begin(&name, call.client.clone(), &protocol);
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
    /// The calls that ended in the last [`LATE_CANCEL`].
    ended: VecDeque<Ended>,
}

struct InHandCall {
    n: u64,
    protocol: String,
    client: Option<ClientTag>,
    /// The session id its request carried.
    session: Option<String>,
    cancel: CancellationToken,
}

/// A call that ended lately: its JSON-RPC id (as JSON), revision and session id, and when.
struct Ended {
    key: String,
    protocol: String,
    session: Option<String>,
    at: Instant,
}

struct InHandGuard<'a> {
    calls: &'a InHand,
    key: String,
    n: u64,
}

impl InHandState {
    fn forget_old(&mut self) {
        let now = Instant::now();
        while self.ended.front().is_some_and(|e| now.duration_since(e.at) > LATE_CANCEL) {
            self.ended.pop_front();
        }
    }
}

impl InHand {
    fn add(&self, id: &RequestId, protocol: &str, client: Option<ClientTag>, session: Option<String>, cancel: CancellationToken) -> InHandGuard<'_> {
        let key = serde_json::to_string(id).unwrap_or_default();
        let n = self.next.fetch_add(1, Ordering::SeqCst);
        let call = InHandCall { n, protocol: protocol.to_string(), client, session, cancel };
        lock(&self.state).by_id.entry(key.clone()).or_default().push(call);
        InHandGuard { calls: self, key, n }
    }

    /// Cancels the call a `notifications/cancelled` for the JSON-RPC id `key` means, on `protocol`,
    /// carrying the session id `session` and from `client` (when they can be told), if there is no
    /// doubt which (see the module's notes). A cancel carrying the session id a call came with is
    /// that connection's, whoever else's calls have the same JSON-RPC id, and even when the id is not
    /// one given out; one without, or with an id no call in hand came with, is placed among the calls
    /// that came without one, by its client.
    fn cancel(&self, key: &str, protocol: &str, client: Option<&ClientTag>, session: Option<&str>) -> bool {
        if !is_legacy(protocol) {
            return false;
        }
        let mut state = lock(&self.state);
        state.forget_old();
        // a call of the same connection (or of one that cannot be told) ended with that id lately:
        // the cancel may be its, late
        let same = |s: &Option<String>| session.is_none() || s.is_none() || s.as_deref() == session;
        if state.ended.iter().any(|e| e.key == key && e.protocol == protocol && same(&e.session)) {
            return false;
        }
        let calls: Vec<&InHandCall> = state.by_id.get(key).into_iter().flatten().filter(|c| c.protocol == protocol).collect();
        let by_session: Vec<&InHandCall> = calls.iter().copied().filter(|c| session.is_some() && c.session.as_deref() == session).collect();
        let meant: Vec<&InHandCall> = if by_session.is_empty() {
            let theirs = |c: &&InHandCall| client.is_none_or(|client| c.client.as_ref() == Some(client));
            calls.into_iter().filter(|c| session.is_none() || c.session.is_none()).filter(theirs).collect()
        } else {
            by_session
        };
        match meant[..] {
            [call] => {
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
        let ended = list.iter().find(|c| c.n == self.n).map(|c| (c.protocol.clone(), c.session.clone()));
        list.retain(|c| c.n != self.n);
        if list.is_empty() {
            state.by_id.remove(&self.key);
        }
        if let Some((protocol, session)) = ended {
            state.forget_old();
            state.ended.push_back(Ended { key: self.key.clone(), protocol, session, at: Instant::now() });
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
/// endpoint stops, and looks in it for `notifications/cancelled`; notes who the request says it
/// comes from ([`Caller`]) for the handler, and gives the answer to an `initialize` that rmcp lets
/// through a new session id, which the handler introduces the client by (see the module's notes).
/// The `Mcp-Session-Id` a request carries is left for rmcp, which without sessions does not look at
/// it.
async fn read_body(State(front): State<Front>, request: Request, next: Next) -> Response {
    if request.method() != Method::POST {
        return next.run(request).await;
    }
    let too_large = || (StatusCode::PAYLOAD_TOO_LARGE, format!("Payload Too Large: SmedCover takes requests of up to {} MiB", MAX_BODY >> 20));
    let declared = request.headers().get(CONTENT_LENGTH).and_then(|v| v.to_str().ok()?.parse::<u64>().ok());
    if declared.is_some_and(|length| length > MAX_BODY as u64) {
        return refuse(request, too_large().into_response()).await;
    }
    let (mut parts, body) = request.into_parts();
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
    let mut caller = Caller::of(&parts.headers);
    if is_initialize(&bytes) {
        caller.new_session = new_session_id();
    }
    if let Some(id) = cancelled_request(&bytes) {
        let protocol = parts.headers.get("mcp-protocol-version").and_then(|v| v.to_str().ok()).unwrap_or("2025-03-26");
        let client = front.stats.recognise(caller.session.as_deref(), caller.agent.as_deref(), protocol);
        front.calls.cancel(&id, protocol, client.as_ref(), caller.session.as_deref());
    }
    let new_session = caller.new_session.clone();
    parts.extensions.insert(caller);
    let mut response = next.run(Request::from_parts(parts, Body::from(bytes))).await;
    if let Some(id) = new_session.filter(|_| response.status().is_success()) {
        if let Ok(id) = HeaderValue::from_str(&id) {
            response.headers_mut().insert(HeaderName::from_static(SESSION_ID), id);
        }
    }
    response
}

/// Whether a body is an `initialize` request: one small enough, naming the method, read as JSON.
fn is_initialize(body: &[u8]) -> bool {
    const METHOD: &[u8] = b"\"initialize\"";
    if body.len() > INITIALIZE_BYTES || !body.windows(METHOD.len()).any(|w| w == METHOD) {
        return false;
    }
    serde_json::from_slice::<Value>(body).is_ok_and(|m| m.get("method").and_then(Value::as_str) == Some("initialize") && m.get("id").is_some())
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
        let message = format!("Unauthorized: SmedCover wants the token {}, as Authorization: Bearer <token>", gate.found_in);
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

/// What the command line's routes need: the page, and the app that answers them.
#[derive(Clone)]
struct AppRoutes {
    bridge: Arc<dyn PageBridge>,
    app: Arc<dyn AppControl>,
}

/// The command line's `/health`: the endpoint's, with `ready` (the page has attached: calls are taken)
/// and what the app adds (`needsSetup`).
async fn app_health(State(routes): State<AppRoutes>) -> Json<Value> {
    let page = routes.bridge.page();
    let mut answer = json!({"name": SERVER_NAME, "version": VERSION, "page": page.as_str(), "ready": matches!(page, super::PageState::Ready { .. })});
    answer.as_object_mut().expect("an object").extend(routes.app.health());
    Json(answer)
}

async fn app_show(State(routes): State<AppRoutes>) -> Json<Value> {
    Json(routes.app.show())
}

async fn app_done(State(routes): State<AppRoutes>) -> Json<Value> {
    Json(routes.app.done())
}

// ---- what the page is told about the clients ----

/// A client seen in the last [`CLIENT_WINDOW`]: its last request, or the end of its last call, came
/// that lately, or it has a call under way. The requests that could not be told to be any client's
/// are counted as one more, the unidentified client, whose name and version are `None` (null, for
/// the page).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSeen {
    /// The name and version it gave (each [`TAG_BYTES`] at most); both `None` for the unidentified
    /// client.
    pub name: Option<String>,
    pub version: Option<String>,
    /// The protocol revision it last used.
    pub protocol: String,
    /// When it was last seen, in milliseconds since 1970 (as JavaScript's `Date` takes it).
    pub last_seen: u64,
    /// The tool calls it has made (that could be told to be its; the unidentified client's, those
    /// that could not be told to be anyone's), counted from when it was first seen, or seen again
    /// after the window.
    pub calls: u64,
    /// Its calls under way: while it has one it counts as seen, however long ago it last asked.
    pub in_flight: usize,
}

impl ClientSeen {
    /// Whether this is `client`'s entry (`None`: the unidentified client's).
    fn is(&self, client: Option<&ClientTag>) -> bool {
        match client {
            Some(c) => self.name.as_deref() == Some(c.name.as_str()) && self.version.as_deref() == Some(c.version.as_str()),
            None => self.name.is_none(),
        }
    }

    /// The client, unless this is the unidentified one.
    fn tag(&self) -> Option<ClientTag> {
        Some(ClientTag { name: self.name.clone()?, version: self.version.clone()? })
    }
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
    /// The clients seen in the last [`CLIENT_WINDOW`] or with a call under way, the latest first: the
    /// unidentified client among them when requests that could not be told to be anyone's came in
    /// that time.
    pub clients: Vec<ClientSeen>,
    /// The tool calls under way.
    pub in_flight: usize,
    pub last_call: Option<LastCall>,
}

/// The clients seen lately and the calls under way, and who the clients of the older era are, to
/// recognise their requests by. "Connected" can only mean "seen lately": a client of the 2026-07-28
/// era says who it is on every request and holds no connection open.
pub struct Stats {
    inner: Mutex<StatsInner>,
    changes: watch::Sender<u64>,
    /// The time, in milliseconds since 1970.
    clock: Box<dyn Fn() -> u64 + Send + Sync>,
}

#[derive(Default)]
struct StatsInner {
    /// The clients seen in the last [`CLIENT_WINDOW`] or with a call under way (and those seen
    /// before, till they are pruned), [`MAX_SEEN`] at most.
    clients: Vec<ClientSeen>,
    /// The clients introduced by their `initialize`, [`MAX_KNOWN`] at most and [`MAX_KNOWN_EACH`] of
    /// any one client, the one used last at the back.
    known: VecDeque<Known>,
    in_flight: usize,
    last_call: Option<LastCall>,
}

/// A client as its `initialize` introduced it: the session id its answer gave it, the `User-Agent`
/// it came with and the revision agreed. It is used only to recognise the client's later requests,
/// and kept apart from whether the client was seen lately ([`ClientSeen`]), so that a client not
/// seen for a while is still known when it comes back.
struct Known {
    session: Option<String>,
    client: ClientTag,
    agent: Option<String>,
    protocol: String,
}

impl Default for Stats {
    fn default() -> Self {
        Stats::new()
    }
}

impl Stats {
    pub fn new() -> Stats {
        Stats::with_clock(now_ms)
    }

    /// Stats that tell the time by `clock`, in milliseconds since 1970: a test's may run ahead, to
    /// see what is forgotten as time goes by and what is not.
    pub fn with_clock(clock: impl Fn() -> u64 + Send + Sync + 'static) -> Stats {
        Stats { inner: Mutex::new(StatsInner::default()), changes: watch::Sender::new(0), clock: Box::new(clock) }
    }

    /// The clients seen lately, the calls under way and the last call.
    pub fn snapshot(&self) -> StatsSnapshot {
        let now = (self.clock)();
        let mut inner = lock(&self.inner);
        prune(&mut inner.clients, now);
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

    /// `client` seen now (`None`: the unidentified client), on `protocol`, making a call if `call`.
    fn seen(&self, client: Option<&ClientTag>, protocol: &str, call: bool) {
        let now = (self.clock)();
        seen_at(&mut lock(&self.inner), client, protocol, now).calls += u64::from(call);
        self.changed();
    }

    /// `client` introduced by an `initialize` on `protocol`, which came with `agent` as its
    /// `User-Agent` and whose answer gives it `session`. When [`MAX_KNOWN_EACH`] of that client are
    /// already known, its own used longest ago is forgotten (a client that connects again and again,
    /// for each call or to see that the endpoint is there, never pushes the others out); else, when
    /// [`MAX_KNOWN`] are, the one of all used longest ago.
    fn introduce(&self, session: Option<&str>, client: &ClientTag, agent: Option<&str>, protocol: &str) {
        let mut inner = lock(&self.inner);
        let known = &mut inner.known;
        if known.iter().filter(|k| k.client == *client).count() >= MAX_KNOWN_EACH {
            if let Some(at) = known.iter().position(|k| k.client == *client) {
                known.remove(at);
            }
        } else if known.len() >= MAX_KNOWN {
            known.pop_front();
        }
        known.push_back(Known { session: session.map(String::from), client: client.clone(), agent: agent.map(String::from), protocol: protocol.to_string() });
    }

    /// The client that a request of `protocol` which does not say who it is comes from, as the
    /// session id it carries (`session`) and its `User-Agent` (`agent`) tell: the client that id
    /// was given to; else, on a revision of the `initialize` era, the client introduced on that
    /// revision with that `User-Agent`, if one alone was (and, when the request carries an id not
    /// given out, as one does from before the app started again, was seen lately too: another client
    /// may have come with the same `User-Agent` since); else the one client of that revision seen
    /// lately (among those introduced with that `User-Agent`, if there are any, and never one
    /// introduced only with another); else none.
    fn recognise(&self, session: Option<&str>, agent: Option<&str>, protocol: &str) -> Option<ClientTag> {
        let now = (self.clock)();
        let mut inner = lock(&self.inner);
        let inner = &mut *inner;
        if let Some(at) = session.and_then(|id| inner.known.iter().position(|k| k.session.as_deref() == Some(id))) {
            let client = inner.known[at].client.clone();
            used(&mut inner.known, at);
            return Some(client);
        }
        if !is_legacy(protocol) {
            return None;
        }
        prune(&mut inner.clients, now);
        let mut by_agent: Vec<ClientTag> = Vec::new();
        if agent.is_some() {
            for known in inner.known.iter().filter(|k| k.agent.as_deref() == agent && k.protocol == protocol) {
                if !by_agent.contains(&known.client) {
                    by_agent.push(known.client.clone());
                }
            }
        }
        if let [client] = &by_agent[..] {
            if session.is_none() || inner.clients.iter().any(|c| c.is(Some(client))) {
                let client = client.clone();
                if let Some(at) = inner.known.iter().rposition(|k| k.client == client && k.agent.as_deref() == agent && k.protocol == protocol) {
                    used(&mut inner.known, at);
                }
                return Some(client);
            }
        }
        // introduced, and only ever with another User-Agent than the request's
        let elsewhere = |c: &ClientTag| {
            let mut own = inner.known.iter().filter(|k| k.client == *c).peekable();
            agent.is_some() && own.peek().is_some() && own.all(|k| k.agent.is_some() && k.agent.as_deref() != agent)
        };
        let mut on = inner
            .clients
            .iter()
            .filter(|c| c.protocol == protocol)
            .filter_map(ClientSeen::tag)
            .filter(|c| by_agent.is_empty() || by_agent.contains(c))
            .filter(|c| !elsewhere(c));
        match (on.next(), on.next()) {
            (Some(c), None) => Some(c),
            _ => None,
        }
    }

    /// A call of `tool` begun, by `client` (`None`: one that could not be told) on `protocol`: the
    /// client counts as seen till it ends.
    fn begin(&self, tool: &str, client: Option<ClientTag>, protocol: &str) -> Flight<'_> {
        {
            let now = (self.clock)();
            let mut inner = lock(&self.inner);
            inner.in_flight += 1;
            seen_at(&mut inner, client.as_ref(), protocol, now).in_flight += 1;
        }
        self.changed();
        Flight { stats: self, tool: tool.to_string(), client, protocol: protocol.to_string(), ok: false, ended: false }
    }
}

/// The client `name` and `version` say, each cut to [`TAG_BYTES`]: they are kept for as long as the
/// app runs.
fn client_tag(name: &str, version: &str) -> ClientTag {
    ClientTag { name: cut(name, TAG_BYTES), version: cut(version, TAG_BYTES) }
}

/// The first `most` bytes of `text` at most, never cutting a character.
fn cut(text: &str, most: usize) -> String {
    let mut end = text.len().min(most);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

/// The known client at `at` used: the last to be forgotten.
fn used(known: &mut VecDeque<Known>, at: usize) {
    if let Some(entry) = known.remove(at) {
        known.push_back(entry);
    }
}

/// `client`'s entry among those seen lately (`None`: the unidentified client's), seen at `now` on
/// `protocol`: made if there is none, when [`MAX_SEEN`] are already there the one seen longest ago
/// with no call under way forgotten first.
fn seen_at<'a>(inner: &'a mut StatsInner, client: Option<&ClientTag>, protocol: &str, now: u64) -> &'a mut ClientSeen {
    prune(&mut inner.clients, now);
    let clients = &mut inner.clients;
    let at = match clients.iter().position(|c| c.is(client)) {
        Some(at) => at,
        None => {
            if clients.len() >= MAX_SEEN {
                if let Some(oldest) = clients.iter().enumerate().filter(|(_, c)| c.in_flight == 0).min_by_key(|(_, c)| c.last_seen).map(|(i, _)| i) {
                    clients.remove(oldest);
                }
            }
            clients.push(ClientSeen {
                name: client.map(|c| c.name.clone()),
                version: client.map(|c| c.version.clone()),
                protocol: protocol.to_string(),
                last_seen: now,
                calls: 0,
                in_flight: 0,
            });
            clients.len() - 1
        }
    };
    let seen = &mut clients[at];
    seen.last_seen = now;
    if !protocol.is_empty() {
        seen.protocol = protocol.to_string();
    }
    seen
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

/// A call under way, counted till it ends (or is dropped, its client gone); its client counts as seen
/// while it runs, and is seen again as it ends.
struct Flight<'a> {
    stats: &'a Stats,
    tool: String,
    client: Option<ClientTag>,
    protocol: String,
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
            let now = (self.stats.clock)();
            let mut inner = lock(&self.stats.inner);
            inner.in_flight -= 1;
            inner.last_call = Some(LastCall { tool: std::mem::take(&mut self.tool), at: now, ok: self.ended && self.ok });
            let seen = seen_at(&mut inner, self.client.as_ref(), &self.protocol, now);
            seen.in_flight = seen.in_flight.saturating_sub(1);
        }
        self.stats.changed();
    }
}

/// Forgets the clients not seen in the [`CLIENT_WINDOW`] before `now` and with no call under way
/// (who they are stays known).
fn prune(clients: &mut Vec<ClientSeen>, now: u64) {
    let window = u64::try_from(CLIENT_WINDOW.as_millis()).unwrap_or(u64::MAX);
    let since = now.saturating_sub(window);
    clients.retain(|c| c.in_flight > 0 || c.last_seen >= since);
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

    fn tag(name: &str) -> ClientTag {
        ClientTag { name: name.into(), version: "1".into() }
    }

    /// Stats whose clock is moved on by hand, from the time it is now.
    fn stats_with_clock() -> (Stats, Arc<AtomicU64>) {
        let ahead = Arc::new(AtomicU64::new(0));
        let by = ahead.clone();
        (Stats::with_clock(move || now_ms() + by.load(Ordering::SeqCst)), ahead)
    }

    const MINUTE: u64 = 60 * 1000;

    /// What an `initialize` does to the stats: the client introduced, and seen.
    fn initialize(stats: &Stats, session: Option<&str>, client: &ClientTag, agent: Option<&str>, protocol: &str) {
        stats.introduce(session, client, agent, protocol);
        stats.seen(Some(client), protocol, false);
    }

    #[test]
    fn an_older_clients_calls_are_its_if_it_is_the_only_one() {
        let stats = Stats::new();
        let recognise = |protocol: &str| stats.recognise(None, None, protocol);
        assert_eq!(recognise("2025-06-18"), None);
        stats.seen(Some(&tag("claude-code")), "2025-06-18", false);
        stats.seen(Some(&tag("modern")), "2026-07-28", false);
        assert_eq!(recognise("2025-06-18"), Some(tag("claude-code")));
        assert_eq!(recognise("2025-11-25"), None, "another revision");
        assert_eq!(recognise("2026-07-28"), None, "that era says who it is");
        // requests no one could be told to have made are no client to take them to be
        stats.seen(None, "2025-11-25", true);
        assert_eq!(recognise("2025-11-25"), None);
        stats.seen(Some(&tag("cursor")), "2025-06-18", false);
        assert_eq!(recognise("2025-06-18"), None, "two of them: neither");
    }

    /// A request carrying the session id an `initialize` gave is that client's, whoever else is on its
    /// revision with its `User-Agent`, and after it has not been seen for longer than the window.
    #[test]
    fn a_session_id_says_whose_a_request_is() {
        const V: &str = "2025-06-18";
        let (stats, ahead) = stats_with_clock();
        initialize(&stats, Some("id-claude"), &tag("claude-code"), Some("node"), V);
        initialize(&stats, Some("id-cursor"), &tag("cursor"), Some("node"), V);
        assert_eq!(stats.recognise(Some("id-claude"), Some("node"), V), Some(tag("claude-code")));
        assert_eq!(stats.recognise(Some("id-cursor"), Some("node"), V), Some(tag("cursor")));
        // the same User-Agent and revision, two clients: without an id, neither
        assert_eq!(stats.recognise(None, Some("node"), V), None);
        assert_eq!(stats.recognise(Some("not-ours"), Some("node"), V), None);
        // an id says who it is whatever revision the request says
        assert_eq!(stats.recognise(Some("id-cursor"), None, "2025-03-26"), Some(tag("cursor")));
        // eleven minutes on: neither is seen lately any more, but both are still known
        ahead.store(11 * MINUTE, Ordering::SeqCst);
        assert!(stats.snapshot().clients.is_empty());
        let client = stats.recognise(Some("id-claude"), Some("node"), V);
        assert_eq!(client, Some(tag("claude-code")));
        stats.seen(client.as_ref(), V, true);
        let seen = stats.snapshot().clients;
        assert_eq!(seen.len(), 1);
        assert_eq!((seen[0].name.as_deref(), seen[0].calls, seen[0].last_seen >= now_ms() + 10 * MINUTE), (Some("claude-code"), 1, true));
    }

    /// Without an id, a request is the client's that came with its `User-Agent` on its revision, if
    /// one alone did, even when it has not been seen lately; with an id not given out, only if it was
    /// seen lately too; with several, the one of them seen lately; with none, the one client of that
    /// revision seen lately.
    #[test]
    fn a_user_agent_says_whose_a_request_is_when_one_client_alone_came_with_it() {
        const V: &str = "2025-06-18";
        let (stats, ahead) = stats_with_clock();
        initialize(&stats, Some("a"), &tag("claude-code"), Some("claude-cli/2.1"), V);
        initialize(&stats, Some("b"), &tag("hermes"), Some("python-httpx/0.28"), V);
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), Some(tag("hermes")));
        assert_eq!(stats.recognise(Some("from-before-a-restart"), Some("claude-cli/2.1"), V), Some(tag("claude-code")), "seen lately");
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), "2025-11-25"), None, "another revision");
        assert_eq!(stats.recognise(None, Some("curl/8"), V), None, "an agent no one came with, and two clients seen lately");
        assert_eq!(stats.recognise(None, None, V), None);
        ahead.store(30 * MINUTE, Ordering::SeqCst);
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), Some(tag("hermes")), "known still, long after");
        // an id from before the app started again, and a User-Agent another client came with long
        // ago: that client may be another with the same User-Agent, so no one's
        assert_eq!(stats.recognise(Some("from-before-a-restart"), Some("python-httpx/0.28"), V), None);
        // another client with Hermes's User-Agent: of the two, the one seen lately
        initialize(&stats, Some("c"), &tag("other-python"), Some("python-httpx/0.28"), V);
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), Some(tag("other-python")));
        stats.seen(Some(&tag("hermes")), V, false);
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), None, "both seen lately");
        // the same client introduced again with the same User-Agent is still one client
        ahead.store(60 * MINUTE, Ordering::SeqCst);
        initialize(&stats, Some("a2"), &tag("claude-code"), Some("claude-cli/2.1"), V);
        assert_eq!(stats.recognise(None, Some("claude-cli/2.1"), V), Some(tag("claude-code")));
    }

    /// The one client of a revision seen lately is not taken to have made a request that came with a
    /// User-Agent it never came with; without a User-Agent, or when who it is was not kept, it is.
    #[test]
    fn the_one_client_seen_lately_is_not_one_with_another_user_agent() {
        const V: &str = "2025-06-18";
        let stats = Stats::new();
        initialize(&stats, Some("a"), &tag("claude-code"), Some("claude-cli/2.1"), V);
        assert_eq!(stats.recognise(None, Some("curl/8"), V), None);
        assert_eq!(stats.recognise(Some("not-ours"), Some("curl/8"), V), None);
        assert_eq!(stats.recognise(None, None, V), Some(tag("claude-code")), "no User-Agent to tell by");
        // introduced once without a User-Agent: that one could be it
        stats.introduce(Some("b"), &tag("claude-code"), None, "2025-11-25");
        assert_eq!(stats.recognise(None, Some("curl/8"), V), Some(tag("claude-code")));
        // seen on a revision, but who it is not kept (forgotten): it may be anyone's
        stats.seen(Some(&tag("cursor")), "2025-03-26", false);
        assert_eq!(stats.recognise(None, Some("curl/8"), "2025-03-26"), Some(tag("cursor")));
    }

    /// The requests that cannot be told to be anyone's are counted as the unidentified client's,
    /// shown to the page with a null name; a client counts as seen while it has a call under way,
    /// however long, and is seen again as the call ends.
    #[test]
    fn requests_no_one_can_be_told_to_have_made_are_counted() {
        let (stats, ahead) = stats_with_clock();
        stats.seen(None, "2025-06-18", true);
        stats.seen(None, "2025-11-25", false);
        drop(stats.begin("export", None, "2025-11-25"));
        let snapshot = stats.snapshot();
        assert_eq!(snapshot.clients.len(), 1);
        let unidentified = &snapshot.clients[0];
        assert_eq!((unidentified.name.as_deref(), unidentified.version.as_deref()), (None, None));
        assert_eq!((unidentified.protocol.as_str(), unidentified.calls, unidentified.in_flight), ("2025-11-25", 1, 0));
        let shown = serde_json::to_value(&snapshot).unwrap();
        assert!(shown["clients"][0]["name"].is_null() && shown["clients"][0]["version"].is_null(), "{shown}");
        assert_eq!((&shown["clients"][0]["calls"], &shown["clients"][0]["inFlight"]), (&json!(1), &json!(0)));
        // a call begun twelve minutes ago: its client is still seen while it runs, and as it ends
        stats.seen(Some(&tag("codex")), "2025-06-18", true);
        let flight = stats.begin("export", Some(tag("codex")), "2025-06-18");
        ahead.store(12 * MINUTE, Ordering::SeqCst);
        let running = stats.snapshot().clients;
        assert_eq!(running.iter().map(|c| (c.name.as_deref(), c.calls, c.in_flight)).collect::<Vec<_>>(), [(Some("codex"), 1, 1)]);
        assert!(running[0].last_seen < now_ms() + 2 * MINUTE, "last seen as the call began");
        flight.end(true);
        let seen = stats.snapshot().clients;
        assert_eq!(seen.iter().map(|c| (c.name.as_deref(), c.calls, c.in_flight)).collect::<Vec<_>>(), [(Some("codex"), 1, 0)]);
        assert_eq!(stats.snapshot().last_call.map(|c| c.at), Some(seen[0].last_seen));
        // and forgotten once the window is over after that
        ahead.store(23 * MINUTE, Ordering::SeqCst);
        assert!(stats.snapshot().clients.is_empty());
    }

    /// No more than [`MAX_SEEN`] clients are kept among those seen lately: the one seen longest ago
    /// goes first, unless it has a call under way.
    #[test]
    fn those_seen_lately_stay_bounded() {
        const V: &str = "2025-06-18";
        let (stats, ahead) = stats_with_clock();
        stats.seen(Some(&tag("busy")), V, true);
        let flight = stats.begin("export", Some(tag("busy")), V);
        for n in 0..MAX_SEEN + 10 {
            ahead.store(n as u64 + 1, Ordering::SeqCst);
            stats.seen(Some(&tag(&format!("client-{n}"))), V, false);
        }
        let seen = stats.snapshot().clients;
        assert_eq!(seen.len(), MAX_SEEN);
        assert!(seen.iter().any(|c| c.name.as_deref() == Some("busy")), "the one with a call under way is kept");
        assert!(!seen.iter().any(|c| c.name.as_deref() == Some("client-10")), "the ones seen longest ago go");
        assert!(seen.iter().any(|c| c.name.as_deref() == Some("client-11")));
        drop(flight);
    }

    /// A client's name and version are kept cut short, never in the middle of a character.
    #[test]
    fn names_and_versions_are_kept_short() {
        assert_eq!(cut("abc", 2), "ab");
        assert_eq!(cut("abc", 9), "abc");
        assert_eq!(cut("ééé", 3), "é", "a character is never cut");
        let long = client_tag(&"名".repeat(200), &"v".repeat(1000));
        assert!(long.name.len() <= TAG_BYTES && long.name.chars().all(|c| c == '名') && long.name.len() > TAG_BYTES - 3);
        assert_eq!(long.version.len(), TAG_BYTES);
    }

    /// No more than [`MAX_KNOWN`] clients' `initialize`s are kept: the one whose id was used longest
    /// ago goes first.
    #[test]
    fn what_is_known_stays_bounded() {
        const V: &str = "2025-06-18";
        let stats = Stats::new();
        let id = |n: usize| format!("id-{n}");
        for n in 0..MAX_KNOWN {
            stats.introduce(Some(&id(n)), &tag(&format!("client-{n}")), None, V);
        }
        // the first used again: the second is now the one used longest ago
        assert_eq!(stats.recognise(Some(&id(0)), None, V), Some(tag("client-0")));
        for n in MAX_KNOWN..MAX_KNOWN + 40 {
            stats.introduce(Some(&id(n)), &tag(&format!("client-{n}")), None, V);
        }
        assert_eq!(lock(&stats.inner).known.len(), MAX_KNOWN);
        assert_eq!(stats.recognise(Some(&id(0)), None, V), Some(tag("client-0")));
        for n in 1..=40 {
            assert_eq!(stats.recognise(Some(&id(n)), None, V), None, "{n} is forgotten");
        }
        assert_eq!(stats.recognise(Some(&id(41)), None, V), Some(tag("client-41")));
        assert_eq!(stats.recognise(Some(&id(MAX_KNOWN + 39)), None, V), Some(tag(&format!("client-{}", MAX_KNOWN + 39))));
    }

    /// A client that connects again and again (for each call, or to see that the endpoint is there)
    /// keeps no more than [`MAX_KNOWN_EACH`] of its `initialize`s, its own used longest ago going
    /// first, and pushes no other client's out once it has that many.
    #[test]
    fn a_client_connecting_again_and_again_pushes_out_only_its_own() {
        const V: &str = "2025-06-18";
        let stats = Stats::new();
        for n in 0..MAX_KNOWN - 1 {
            stats.introduce(Some(&format!("id-{n}")), &tag(&format!("client-{n}")), Some("node"), V);
        }
        for n in 0..100 {
            stats.introduce(Some(&format!("again-{n}")), &tag("health-check"), Some("node"), V);
        }
        let known = lock(&stats.inner).known.len();
        assert_eq!(known, MAX_KNOWN);
        // the table had room for one: it took MAX_KNOWN_EACH - 1 of the others' to make room, no more
        for n in 0..MAX_KNOWN_EACH - 1 {
            assert_eq!(stats.recognise(Some(&format!("id-{n}")), None, V), None, "{n}");
        }
        for n in MAX_KNOWN_EACH - 1..MAX_KNOWN - 1 {
            assert_eq!(stats.recognise(Some(&format!("id-{n}")), None, V), Some(tag(&format!("client-{n}"))), "{n}");
        }
        // its own: only its last MAX_KNOWN_EACH
        assert_eq!(stats.recognise(Some(&format!("again-{}", 99 - MAX_KNOWN_EACH)), None, V), None);
        assert_eq!(stats.recognise(Some(&format!("again-{}", 100 - MAX_KNOWN_EACH)), None, V), Some(tag("health-check")));
        assert_eq!(stats.recognise(Some("again-99"), None, V), Some(tag("health-check")));
    }

    /// A client recognised by its User-Agent alone is used, as one recognised by its id is: the last to
    /// be forgotten.
    #[test]
    fn a_client_recognised_by_its_user_agent_is_the_last_to_be_forgotten() {
        const V: &str = "2025-06-18";
        let stats = Stats::new();
        stats.introduce(Some("first"), &tag("hermes"), Some("python-httpx/0.28"), V);
        for n in 1..MAX_KNOWN {
            stats.introduce(Some(&format!("id-{n}")), &tag(&format!("client-{n}")), Some("node"), V);
        }
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), Some(tag("hermes")));
        for n in 0..10 {
            stats.introduce(Some(&format!("more-{n}")), &tag(&format!("more-{n}")), Some("node"), V);
        }
        assert_eq!(stats.recognise(None, Some("python-httpx/0.28"), V), Some(tag("hermes")), "still known");
        assert_eq!(stats.recognise(Some("first"), None, V), Some(tag("hermes")));
        assert_eq!(stats.recognise(Some("id-1"), None, V), None, "the others used longest ago went instead");
    }

    #[test]
    fn initialize_requests_are_told() {
        let init = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}});
        assert!(is_initialize(init.to_string().as_bytes()));
        assert!(is_initialize(br#"{"jsonrpc":"2.0","id":"a","method" : "initialize","params":{}}"#));
        assert!(!is_initialize(br#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#));
        assert!(!is_initialize(br#"{"jsonrpc":"2.0","method":"initialize"}"#), "a notification is no request");
        let call = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "set_text", "arguments": {"text": "initialize"}}});
        assert!(!is_initialize(call.to_string().as_bytes()));
        assert!(!is_initialize(b"[]") && !is_initialize(b"not json \"initialize\""));
    }

    #[test]
    fn session_ids_are_new_each_time_and_fit_in_a_header() {
        let (a, b) = (new_session_id().unwrap(), new_session_id().unwrap());
        assert_ne!(a, b);
        assert_eq!(a.len(), 22);
        assert!(a.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'), "{a}");
        assert!(HeaderValue::from_str(&a).is_ok());
    }

    #[test]
    fn a_caller_is_read_from_the_headers() {
        let mut headers = HeaderMap::new();
        assert!(Caller::of(&headers).session.is_none() && Caller::of(&headers).agent.is_none());
        headers.insert(SESSION_ID, HeaderValue::from_static(" abc "));
        headers.insert(USER_AGENT, HeaderValue::from_str(&"x".repeat(1000)).unwrap());
        let caller = Caller::of(&headers);
        assert_eq!(caller.session.as_deref(), Some("abc"));
        assert_eq!(caller.agent.map(|a| a.len()), Some(AGENT_BYTES));
        headers.insert(SESSION_ID, HeaderValue::from_static(""));
        assert!(Caller::of(&headers).session.is_none());
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
            .route_layer(from_fn_with_state(Gate { access: access.clone(), open_allowed: true, found_in: "shown in its MCP settings" }, bearer));
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
        let _a = calls.add(&RequestId::Number(1), V, Some(tag("claude")), None, a.clone());
        let _b = calls.add(&RequestId::Number(2), V, Some(tag("claude")), None, b.clone());
        let c_guard = calls.add(&RequestId::Number(2), V, None, None, c.clone());
        let _d = calls.add(&RequestId::Number(4), "2025-11-25", None, None, d.clone());
        // another revision, the 2026-07-28 era, another client: not the call meant
        assert!(!calls.cancel("1", "2025-11-25", None, None));
        assert!(!calls.cancel("1", "2026-07-28", None, None));
        assert!(!calls.cancel("1", V, Some(&tag("cursor")), None));
        assert!(!a.is_cancelled());
        assert!(calls.cancel("1", V, Some(&tag("claude")), None));
        assert!(a.is_cancelled());
        assert!(!calls.cancel("2", V, None, None), "two calls have id 2: neither is cancelled");
        assert!(!b.is_cancelled() && !c.is_cancelled());
        // told whose, the one of that client's is meant
        assert!(calls.cancel("2", V, Some(&tag("claude")), None));
        assert!(b.is_cancelled() && !c.is_cancelled());
        // a call with that id just ended on that revision: the cancel may be its, late
        drop(c_guard);
        let e = token();
        let _e = calls.add(&RequestId::Number(2), V, None, None, e.clone());
        assert!(!calls.cancel("2", V, None, None));
        assert!(!e.is_cancelled());
        // and on another revision the ended one is no reason to doubt
        assert!(calls.cancel("4", "2025-11-25", None, None));
        assert!(!calls.cancel("3", V, None, None));
    }

    /// A cancel carrying the session id a call came with is that connection's, though another
    /// connection of the same client has a call with the same JSON-RPC id; one carrying an id no call
    /// came with is placed among the calls that came without one.
    #[test]
    fn a_cancel_with_a_session_id_is_that_connections() {
        const V: &str = "2025-06-18";
        let calls = InHand::default();
        let claude = ClientTag { name: "claude-code".into(), version: "2.1".into() };
        let token = CancellationToken::new;
        let (one, two, bare) = (token(), token(), token());
        let one_guard = calls.add(&RequestId::Number(5), V, Some(claude.clone()), Some("window-1".into()), one.clone());
        let _two = calls.add(&RequestId::Number(5), V, Some(claude.clone()), Some("window-2".into()), two.clone());
        // the same client in both windows: by the client alone, either
        assert!(!calls.cancel("5", V, Some(&claude), None));
        // an id no call came with: among those that came without one, none
        assert!(!calls.cancel("5", V, Some(&claude), Some("not-ours")));
        assert!(!one.is_cancelled() && !two.is_cancelled());
        assert!(calls.cancel("5", V, Some(&claude), Some("window-2")));
        assert!(two.is_cancelled() && !one.is_cancelled());
        // window 2's call with id 5 ended lately: a late cancel of its is no doubt for window 1's
        let _bare = calls.add(&RequestId::Number(6), V, None, None, bare.clone());
        drop(_two);
        assert!(calls.cancel("5", V, Some(&claude), Some("window-1")));
        assert!(one.is_cancelled());
        // a call of a connection that cannot be told ended with that id: any cancel may be its
        drop(one_guard);
        drop(_bare);
        let (again, late) = (token(), token());
        let _again = calls.add(&RequestId::Number(6), V, None, Some("window-3".into()), again.clone());
        assert!(!calls.cancel("6", V, None, Some("window-3")));
        let _late = calls.add(&RequestId::Number(7), V, None, None, late.clone());
        assert!(calls.cancel("7", V, None, Some("window-4")), "an id no call came with: the one that came without");
        assert!(late.is_cancelled() && !again.is_cancelled());
    }

    #[test]
    fn stats_count_calls_and_forget_old_clients() {
        let stats = Stats::new();
        let changes = stats.changes();
        let client = ClientTag { name: "codex".into(), version: "1.0".into() };
        stats.seen(Some(&client), "2025-06-18", false);
        stats.seen(Some(&client), "2025-06-18", true);
        let flight = stats.begin("get_context", Some(client.clone()), "2025-06-18");
        assert_eq!(stats.snapshot().in_flight, 1);
        flight.end(true);
        drop(stats.begin("export", Some(client.clone()), "2025-06-18")); // its client went away
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
