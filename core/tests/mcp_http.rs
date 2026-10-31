//! The MCP endpoint over real HTTP, on 127.0.0.1 and a port the system picks (never the app's
//! 25277): raw requests in both eras of the protocol, rmcp's own client in both, and the
//! dispatcher behind it, against a page that is played here; and the command line's endpoint, its
//! own routes answered by an app played here too, and the `cli.json` it is found by.
//!
//! The endpoint wants a token unless a test says otherwise (`Endpoint::open()`, the desktop's
//! default). The token is never put in a failure's message: requests are made by helpers that do not
//! print what they send.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rmcp::model::{CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation, ProtocolVersion};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::{ClientLifecycleMode, ClientServiceExt, ServiceExt};
use serde_json::{json, Map, Value};
use smedcover_core::mcp::bridge::{
    read_result, BoxFut, BridgeError, Call, ClientTag, Dispatcher, PageBridge, PageReply, PageSink, PageState, Progress,
};
use smedcover_core::mcp::server::{BindError, McpServer, Running, Stats, MAX_BODY, REFUSED_BODY_BYTES, VERSION};
use smedcover_core::instance::{self, CliFile, LaunchedBy};
use smedcover_core::mcp::{Access, AppControl, Host, Secret, ToolList};
use tokio::runtime::Handle;
use tokio::sync::{mpsc, Notify};

const TOOLS: &str = r#"{"format": 1, "instructions": "Tools for the tests.", "tools": [
  {"name": "echo", "description": "Says its arguments back.", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": true}, "x-smedcover": {"timeoutMs": 5000}},
  {"name": "image", "description": "A picture.", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": true}},
  {"name": "slow", "description": "Says how it is getting on.", "inputSchema": {"type": "object"}, "annotations": {}},
  {"name": "hang", "description": "Waits till it is cancelled.", "inputSchema": {"type": "object"}, "annotations": {}},
  {"name": "busy", "description": "The page is busy.", "inputSchema": {"type": "object"}, "annotations": {}},
  {"name": "stale", "description": "The page no longer has it.", "inputSchema": {"type": "object"}, "annotations": {}},
  {"name": "timeout", "description": "The page went quiet.", "inputSchema": {"type": "object"}, "annotations": {}},
  {"name": "size", "description": "Says how long its data is.", "inputSchema": {"type": "object"}, "annotations": {"readOnlyHint": true}},
  {"name": "server_only", "description": "Not on the desktop.", "inputSchema": {"type": "object"}, "annotations": {}, "x-smedcover": {"hosts": ["server"]}}
]}"#;

/// A 1×1 transparent PNG.
const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const LEGACY: &str = "2025-06-18";
const MODERN: &str = "2026-07-28";

// ---- a page, played ----

/// Answers each tool after its name; keeps what it was asked, and when a hanging call let go.
#[derive(Default)]
struct FakeBridge {
    calls: Mutex<Vec<(String, Option<ClientTag>, Duration)>>,
    hanging: Notify,
    let_go: Mutex<Option<Instant>>,
    let_go_seen: Notify,
}

/// Notes when a hanging call ends, cancelled or dropped.
struct LetGo<'a>(&'a FakeBridge);

impl Drop for LetGo<'_> {
    fn drop(&mut self) {
        *self.0.let_go.lock().unwrap() = Some(Instant::now());
        self.0.let_go_seen.notify_one();
    }
}

impl PageBridge for FakeBridge {
    fn call(&self, call: Call) -> BoxFut<'_, Result<rmcp::model::CallToolResult, BridgeError>> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((call.tool.clone(), call.client.clone(), call.timeout));
            match call.tool.as_str() {
                "echo" => {
                    let args = Value::Object(call.args.clone());
                    read_result(json!({"content": [{"type": "text", "text": args.to_string()}], "structuredContent": args}))
                }
                "image" => read_result(json!({"content": [{"type": "image", "data": format!("data:image/png;base64,{PNG}"), "mimeType": "image/png"}]})),
                "slow" => {
                    for n in 1..=3 {
                        tokio::time::sleep(Duration::from_millis(30)).await;
                        if let Some(tell) = &call.progress {
                            tell(Progress { progress: f64::from(n), total: Some(3.0), message: Some(format!("step {n}")) });
                        }
                    }
                    read_result(json!({"content": [{"type": "text", "text": "done"}]}))
                }
                "hang" => {
                    let _let_go = LetGo(self);
                    self.hanging.notify_one();
                    call.cancel.cancelled().await;
                    Err(BridgeError::Cancelled)
                }
                "busy" => Err(BridgeError::Page { code: "busy".into(), message: "SmedCover is busy: exporting.".into() }),
                "stale" => Err(BridgeError::Page { code: "unknown_tool".into(), message: "no such tool".into() }),
                "timeout" => Err(BridgeError::Timeout),
                "size" => {
                    let size = call.args.get("data").and_then(Value::as_str).map_or(0, str::len);
                    read_result(json!({"content": [{"type": "text", "text": size.to_string()}]}))
                }
                other => panic!("the page was asked for {other}"),
            }
        })
    }

    fn page(&self) -> PageState {
        PageState::Ready { epoch: 1 }
    }
}

impl FakeBridge {
    fn last_call(&self) -> (String, Option<ClientTag>, Duration) {
        self.calls.lock().unwrap().last().cloned().expect("the page was called")
    }

    /// Waits for a hanging call to start.
    async fn hung(&self) {
        tokio::time::timeout(Duration::from_secs(10), self.hanging.notified()).await.expect("the call reached the page");
    }

    /// How soon after `since` the hanging call let go (it must within 5 s).
    async fn let_go_after(&self, since: Instant) -> Duration {
        let _ = tokio::time::timeout(Duration::from_secs(5), self.let_go_seen.notified()).await;
        let at = self.let_go.lock().unwrap().expect("the hanging call let go");
        at.saturating_duration_since(since)
    }
}

// ---- the endpoint ----

struct Endpoint {
    running: Running,
    bridge: Arc<FakeBridge>,
    access: Arc<RwLock<Access>>,
    stats: Arc<Stats>,
    /// How far the stats' clock runs ahead of the time.
    ahead: Arc<AtomicU64>,
    server: McpServer,
}

impl Endpoint {
    /// An endpoint that wants a token, as a server's always does.
    fn start() -> Endpoint {
        Endpoint::start_with(Access::Token(Secret::generate().unwrap()))
    }

    /// One that wants none, as the desktop's by default.
    fn open() -> Endpoint {
        Endpoint::start_with(Access::Open)
    }

    fn start_with(access: Access) -> Endpoint {
        let bridge = Arc::new(FakeBridge::default());
        let tools = Arc::new(ToolList::from_json(TOOLS, Host::Desktop).unwrap());
        let access = Arc::new(RwLock::new(access));
        let ahead = Arc::new(AtomicU64::new(0));
        let by = ahead.clone();
        let stats = Arc::new(Stats::with_clock(move || now_ms() + by.load(Ordering::SeqCst)));
        let server = McpServer::new(bridge.clone(), tools, access.clone(), stats.clone());
        let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).expect("a free port");
        Endpoint { running, bridge, access, stats, ahead, server }
    }

    /// Moves the stats' clock on by `by`, as if that long had gone by.
    fn later(&self, by: Duration) {
        self.ahead.fetch_add(by.as_millis() as u64, Ordering::SeqCst);
    }

    fn addr(&self) -> SocketAddr {
        self.running.addr()
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr())
    }

    /// The token the endpoint wants, if it wants one.
    fn token(&self) -> Option<String> {
        match &*self.access.read().unwrap() {
            Access::Token(secret) => Some(secret.expose().to_string()),
            Access::Open => None,
        }
    }

    /// Who may call from the next request on.
    fn set_access(&self, access: Access) {
        *self.access.write().unwrap() = access;
    }

    /// The headers a client of `protocol` sends with a JSON-RPC message: the token's, if one is
    /// wanted, among them.
    fn headers(&self, protocol: Option<&str>) -> Vec<(String, String)> {
        let mut headers = vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Accept".to_string(), "application/json, text/event-stream".to_string()),
        ];
        if let Some(token) = self.token() {
            headers.insert(0, ("Authorization".to_string(), format!("Bearer {token}")));
        }
        if let Some(protocol) = protocol {
            headers.push(("MCP-Protocol-Version".into(), protocol.into()));
        }
        headers
    }

    /// A JSON-RPC request from a client of the `initialize` era.
    async fn legacy(&self, id: u64, method: &str, params: Value) -> Reply {
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        http("POST", &self.url("/mcp"), self.headers(Some(LEGACY)), Some(body.to_string())).await
    }

    /// A JSON-RPC request from a client of the 2026-07-28 era, with its `_meta` and headers; `name`
    /// goes in `Mcp-Name` (for tools/call, the tool's).
    async fn modern(&self, id: u64, method: &str, mut params: Value, name: Option<&str>) -> Reply {
        params["_meta"] = modern_meta();
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let mut headers = self.headers(Some(MODERN));
        headers.push(("Mcp-Method".into(), method.into()));
        if let Some(name) = name {
            headers.push(("Mcp-Name".into(), name.into()));
        }
        http("POST", &self.url("/mcp"), headers, Some(body.to_string())).await
    }

    /// A JSON-RPC request of the older era with the headers `extra` too (a session id, a
    /// `User-Agent`).
    async fn legacy_with(&self, id: u64, method: &str, params: Value, extra: &[(&str, &str)]) -> Reply {
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params});
        let mut headers = self.headers(Some(LEGACY));
        headers.extend(extra.iter().map(|(n, v)| (n.to_string(), v.to_string())));
        http("POST", &self.url("/mcp"), headers, Some(body.to_string())).await
    }

    /// An `initialize` of the older era from the client `name`, coming with `agent` as its
    /// `User-Agent`: the session id its answer gives.
    async fn introduce(&self, name: &str, agent: &str) -> String {
        let init = json!({"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": name, "version": "1.0"}});
        let reply = self.legacy_with(1, "initialize", init, &[("User-Agent", agent)]).await;
        assert_eq!(reply.status, 200, "{}", reply.body);
        assert_eq!(reply.only()["result"]["protocolVersion"], LEGACY);
        reply.header("mcp-session-id").expect("a session id").to_string()
    }

    /// Who the page was told made a call of `echo` sent with the headers `extra`.
    async fn whose(&self, id: u64, extra: &[(&str, &str)]) -> Option<String> {
        let reply = self.legacy_with(id, "tools/call", json!({"name": "echo", "arguments": {}}), extra).await;
        assert_eq!(reply.status, 200, "{}", reply.body);
        assert_eq!(reply.only()["id"], id);
        self.bridge.last_call().1.map(|c| c.name)
    }

    /// Sends a notification of the older era; its HTTP status.
    async fn legacy_note(&self, body: String) -> u16 {
        http("POST", &self.url("/mcp"), self.headers(Some(LEGACY)), Some(body)).await.status
    }

    /// The parts of a call's result from a JSON-RPC response that should have one.
    async fn legacy_call(&self, id: u64, tool: &str, args: Value) -> Value {
        let reply = self.legacy(id, "tools/call", json!({"name": tool, "arguments": args})).await;
        assert_eq!(reply.status, 200, "tools/call {tool}: {}", reply.body);
        reply.only()
    }

    /// Opens a connection of its own and sends a POST to /mcp, with the token if `token`, the
    /// headers `extra`, a body said to be `length` bytes long and only `body` of it; the connection
    /// is left open.
    fn open_post(&self, token: bool, extra: &[(&str, &str)], length: usize, body: &[u8]) -> TcpStream {
        let mut stream = TcpStream::connect(self.addr()).unwrap();
        let mut head = format!("POST /mcp HTTP/1.1\r\nHost: {}\r\nContent-Length: {length}\r\n", self.addr());
        for (name, value) in self.headers(None) {
            if token || name != "Authorization" {
                head.push_str(&format!("{name}: {value}\r\n"));
            }
        }
        for (name, value) in extra {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body).unwrap();
        stream
    }

    /// Opens a tools/call of the older era on a connection of its own, which is left open.
    fn open_call(&self, id: u64, tool: &str) -> TcpStream {
        let body = json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool, "arguments": {}}}).to_string();
        self.open_post(true, &[("MCP-Protocol-Version", LEGACY)], body.len(), body.as_bytes())
    }

    /// Opens a tools/call of the 2026-07-28 era on a connection of its own, which is left open.
    fn open_modern_call(&self, id: u64, tool: &str, progress_token: Option<&str>) -> TcpStream {
        let mut meta = modern_meta();
        if let Some(token) = progress_token {
            meta["progressToken"] = json!(token);
        }
        let body = json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool, "arguments": {}, "_meta": meta}}).to_string();
        let extra = [("MCP-Protocol-Version", MODERN), ("Mcp-Method", "tools/call"), ("Mcp-Name", tool)];
        self.open_post(true, &extra, body.len(), body.as_bytes())
    }
}

/// Runs `f` off the runtime's threads.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
    tokio::task::spawn_blocking(f).await.unwrap()
}

/// The head of the answer coming on `stream` (lower case), if it comes within `wait`.
fn read_head(stream: &mut TcpStream, wait: Duration) -> Option<String> {
    stream.set_read_timeout(Some(wait)).unwrap();
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read(&mut byte) {
            Ok(1) => head.push(byte[0]),
            _ => return None,
        }
    }
    Some(String::from_utf8_lossy(&head).to_lowercase())
}

/// What else comes on `stream` till the server closes it, and whether it did within `wait`.
fn read_till_closed(stream: &mut TcpStream, wait: Duration) -> (String, bool) {
    let until = Instant::now() + wait;
    let mut text = Vec::new();
    let mut buf = [0u8; 16 * 1024];
    loop {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return (String::from_utf8_lossy(&text).into(), false);
        }
        stream.set_read_timeout(Some(left)).unwrap();
        match stream.read(&mut buf) {
            Ok(0) => return (String::from_utf8_lossy(&text).into(), true),
            Ok(n) => text.extend_from_slice(&buf[..n]),
            // reset by the server is closed too
            Err(e) if e.kind() == std::io::ErrorKind::ConnectionReset => return (String::from_utf8_lossy(&text).into(), true),
            Err(_) => return (String::from_utf8_lossy(&text).into(), false),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64
}

fn modern_meta() -> Value {
    json!({
        "io.modelcontextprotocol/protocolVersion": MODERN,
        "io.modelcontextprotocol/clientInfo": {"name": "raw-modern", "version": "0.2"},
        "io.modelcontextprotocol/clientCapabilities": {},
    })
}

// ---- raw HTTP ----

struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: String,
}

impl Reply {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    fn is_events(&self) -> bool {
        self.header("content-type").is_some_and(|t| t.starts_with("text/event-stream"))
    }

    /// The JSON-RPC messages: the body, or each event's data.
    fn messages(&self) -> Vec<Value> {
        if !self.is_events() {
            return vec![serde_json::from_str(&self.body).unwrap_or_else(|e| panic!("not JSON ({e}): {}", self.body))];
        }
        self.body
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim)
            .filter(|data| !data.is_empty())
            .map(|data| serde_json::from_str(data).unwrap())
            .collect()
    }

    /// The one message, which is the answer.
    fn only(&self) -> Value {
        let messages = self.messages();
        assert_eq!(messages.len(), 1, "{}", self.body);
        messages.into_iter().next().unwrap()
    }
}

/// One request; `headers` are not printed if it fails.
async fn http(method: &str, url: &str, headers: Vec<(String, String)>, body: Option<String>) -> Reply {
    let (method, url) = (method.to_string(), url.to_string());
    tokio::task::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
        let mut request = agent.request(&method, &url);
        for (name, value) in &headers {
            request = request.set(name, value);
        }
        let response = match body {
            Some(body) => request.send_string(&body),
            None => request.call(),
        };
        let response = match response {
            Ok(r) | Err(ureq::Error::Status(_, r)) => r,
            Err(e) => panic!("{method} {url}: no answer ({})", e.kind()),
        };
        let status = response.status();
        let headers = response.headers_names().iter().map(|n| (n.clone(), response.header(n).unwrap_or("").to_string())).collect();
        let mut body = String::new();
        response.into_reader().read_to_string(&mut body).unwrap();
        Reply { status, headers, body }
    })
    .await
    .unwrap()
}

async fn get(url: &str, headers: Vec<(String, String)>) -> Reply {
    http("GET", url, headers, None).await
}

// ---- the older era ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_initialize_list_and_call() {
    let e = Endpoint::start();
    let init = json!({"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "raw-legacy", "version": "0.1"}});
    let reply = http("POST", &e.url("/mcp"), e.headers(None), Some(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": init}).to_string())).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(reply.is_events(), "answers are events");
    // a session id, to recognise the client by (see a_session_id_tells_whose_requests_they_are)
    let id = reply.header("mcp-session-id").expect("a session id");
    assert!(id.len() == 22 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'), "{id}");
    assert!(reply.header("access-control-allow-origin").is_none());
    let result = &reply.only()["result"];
    assert_eq!(result["protocolVersion"], LEGACY);
    assert_eq!(result["serverInfo"]["name"], "smedcover");
    assert_eq!(result["serverInfo"]["version"], VERSION);
    assert_eq!(result["instructions"], "Tools for the tests.");
    assert!(result["capabilities"]["tools"].is_object());

    // initialized: accepted, nothing to say
    let note = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
    let reply = http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(note.to_string())).await;
    assert_eq!(reply.status, 202);

    // the tools this host offers, in order, without x-smedcover, in the older shape
    let reply = e.legacy(2, "tools/list", json!({})).await;
    let listed = reply.only();
    let names: Vec<_> = listed["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert_eq!(names, ["echo", "image", "slow", "hang", "busy", "stale", "timeout", "size"]);
    assert!(!reply.body.contains("x-smedcover"));
    assert!(listed["result"].get("resultType").is_none());
    assert_eq!(listed["result"]["tools"][0]["annotations"]["readOnlyHint"], true);

    // a call, its structured content intact
    let args = json!({"text": "Hello", "n": 2, "nested": {"list": [1, 2]}});
    let answer = e.legacy_call(3, "echo", args.clone()).await;
    assert_eq!(answer["id"], 3);
    let result = &answer["result"];
    assert_eq!(result["structuredContent"], args);
    let text: Value = serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text, args);
    assert_ne!(result["isError"], true);
    assert!(result.get("resultType").is_none());
    let (tool, client, timeout) = e.bridge.last_call();
    assert_eq!((tool.as_str(), timeout), ("echo", Duration::from_secs(5)));
    // sent without the session id, the call is recognised all the same: the client came with the
    // same User-Agent, and no other did
    assert_eq!(client, Some(ClientTag { name: "raw-legacy".into(), version: "0.1".into() }));

    // an image, its data URL's prefix taken off
    let answer = e.legacy_call(4, "image", json!({})).await;
    assert_eq!(answer["result"]["content"][0], json!({"type": "image", "data": PNG, "mimeType": "image/png"}));

    // a request with no version header is taken as 2025-03-26, and still served
    let reply = http("POST", &e.url("/mcp"), e.headers(None), Some(json!({"jsonrpc": "2.0", "id": 5, "method": "tools/list"}).to_string())).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.only()["result"]["tools"].as_array().unwrap().len(), 8);

    let stats = e.stats.snapshot();
    let seen = stats.clients.iter().find(|c| c.name.as_deref() == Some("raw-legacy")).expect("the client was seen");
    assert_eq!((seen.protocol.as_str(), seen.calls), (LEGACY, 2));
    assert_eq!(stats.in_flight, 0);
    assert_eq!(stats.last_call.as_ref().map(|c| (c.tool.as_str(), c.ok)), Some(("image", true)));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn progress_comes_as_events_before_the_result() {
    let e = Endpoint::start();
    let params = json!({"name": "slow", "arguments": {}, "_meta": {"progressToken": "p-1"}});
    let reply = e.legacy(7, "tools/call", params).await;
    assert_eq!(reply.status, 200);
    assert!(reply.is_events());
    let messages = reply.messages();
    assert_eq!(messages.len(), 5, "{}", reply.body);
    // progress 0 at once, before the page has said anything
    assert_eq!(messages[0]["method"], "notifications/progress");
    assert_eq!(messages[0]["params"], json!({"progressToken": "p-1", "progress": 0.0}));
    for (n, message) in messages[1..4].iter().enumerate() {
        assert_eq!(message["method"], "notifications/progress");
        assert_eq!(message["params"]["progressToken"], "p-1");
        assert_eq!(message["params"]["progress"], json!(n as f64 + 1.0));
        assert_eq!(message["params"]["total"], json!(3.0));
        assert_eq!(message["params"]["message"], format!("step {}", n + 1));
    }
    assert_eq!(messages[4]["id"], 7);
    assert_eq!(messages[4]["result"]["content"][0]["text"], "done");
    // without a progress token, the page's progress is not passed on
    let reply = e.legacy(8, "tools/call", json!({"name": "slow", "arguments": {}})).await;
    assert_eq!(reply.only()["result"]["content"][0]["text"], "done");
}

/// A call's answer starts at once, before the page has answered: a client that waits only so long
/// for headers (Node's `fetch`, 5 minutes) does not give up on a long call.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_long_calls_answer_starts_at_once() {
    let e = Endpoint::start();
    let mut stream = e.open_call(1, "hang");
    e.bridge.hung().await;
    let (head, stream) = blocking(move || (read_head(&mut stream, Duration::from_secs(5)), stream)).await;
    let head = head.expect("the answer started");
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("content-type: text/event-stream"), "{head}");
    assert!(e.bridge.let_go.lock().unwrap().is_none(), "the call is still in hand");
    drop(stream);
}

// ---- the 2026-07-28 era ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn modern_discover_list_and_call() {
    let e = Endpoint::start();
    let reply = e.modern(1, "server/discover", json!({}), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert!(reply.header("mcp-session-id").is_none(), "that era has no sessions, and is given no id");
    let result = &reply.only()["result"];
    assert_eq!(result["resultType"], "complete");
    let versions: Vec<_> = result["supportedVersions"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(versions, ["2025-03-26", "2025-06-18", "2025-11-25", MODERN]);
    assert_eq!(result["_meta"]["io.modelcontextprotocol/serverInfo"]["name"], "smedcover");
    assert_eq!(result["instructions"], "Tools for the tests.");

    let reply = e.modern(2, "tools/list", json!({}), None).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let result = &reply.only()["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["tools"].as_array().unwrap().len(), 8);
    assert!(result["ttlMs"].is_u64() && result["cacheScope"].is_string());

    let args = json!({"layer": "title", "text": "Hi"});
    let reply = e.modern(3, "tools/call", json!({"name": "echo", "arguments": args}), Some("echo")).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let result = &reply.only()["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["structuredContent"], args);
    let (_, client, _) = e.bridge.last_call();
    assert_eq!(client, Some(ClientTag { name: "raw-modern".into(), version: "0.2".into() }));
    let seen = e.stats.snapshot().clients.into_iter().find(|c| c.name.as_deref() == Some("raw-modern")).unwrap();
    assert_eq!((seen.protocol.as_str(), seen.calls), (MODERN, 1));
    // that era has no initialize, and is given no session id
    assert!(reply.header("mcp-session-id").is_none());
}

/// In the 2026-07-28 era a call with a progress token is told progress 0 at once, and that starts
/// its answer; one without waits for the page, its headers with its result (see server.rs).
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_long_modern_calls_answer_starts_at_once_when_it_takes_progress() {
    let e = Endpoint::start();
    let mut stream = e.open_modern_call(1, "hang", Some("p-9"));
    e.bridge.hung().await;
    let (got, stream) = blocking(move || {
        let head = read_head(&mut stream, Duration::from_secs(5));
        let mut event = Vec::new();
        let mut byte = [0u8; 1];
        while !event.ends_with(b"\n\n") && stream.read(&mut byte).is_ok_and(|n| n == 1) {
            event.push(byte[0]);
        }
        ((head, String::from_utf8_lossy(&event).to_string()), stream)
    })
    .await;
    let (head, event) = got;
    let head = head.expect("the answer started");
    assert!(head.starts_with("http/1.1 200") && head.contains("content-type: text/event-stream"), "{head}");
    // the body is chunked: the event is the line that starts with data:
    let data = event.lines().find_map(|line| line.strip_prefix("data:")).unwrap_or_else(|| panic!("{event}"));
    let data: Value = serde_json::from_str(data.trim()).unwrap_or_else(|_| panic!("{event}"));
    assert_eq!(data["method"], "notifications/progress");
    assert_eq!(data["params"]["progressToken"], "p-9");
    assert_eq!(data["params"]["progress"], json!(0.0));
    assert!(e.bridge.let_go.lock().unwrap().is_none());
    drop(stream);

    // without a progress token nothing comes before the page answers
    let mut stream = e.open_modern_call(2, "hang", None);
    e.bridge.hung().await;
    let (head, stream) = blocking(move || (read_head(&mut stream, Duration::from_millis(500)), stream)).await;
    assert_eq!(head, None, "rmcp now sends headers early: server.rs's notes and this test can say so");
    drop(stream);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn modern_headers_are_checked() {
    let e = Endpoint::start();
    let call = json!({"name": "echo", "arguments": {}});
    // Mcp-Name that is not the tool's, or none
    for name in [Some("image"), None] {
        let reply = e.modern(1, "tools/call", call.clone(), name).await;
        assert_eq!(reply.status, 400, "{}", reply.body);
        assert_eq!(reply.only()["error"]["code"], -32020);
    }
    // a revision no one knows
    let mut meta = modern_meta();
    meta["io.modelcontextprotocol/protocolVersion"] = json!("2099-01-01");
    let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {"_meta": meta}});
    let mut headers = e.headers(Some("2099-01-01"));
    headers.push(("Mcp-Method".into(), "tools/list".into()));
    let reply = http("POST", &e.url("/mcp"), headers, Some(body.to_string())).await;
    assert_eq!(reply.status, 400, "{}", reply.body);
    assert_eq!(reply.only()["error"]["code"], -32022);
    // and in the older era, a version header no one knows is a plain 400
    let reply = http("POST", &e.url("/mcp"), e.headers(Some("1999-01-01")), Some(json!({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}).to_string())).await;
    assert_eq!(reply.status, 400);
}

// ---- errors ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_pages_failures_are_tool_errors_and_unknown_tools_are_protocol_errors() {
    let e = Endpoint::start();
    let answer = e.legacy_call(1, "busy", json!({})).await;
    assert_eq!(answer["result"]["isError"], true);
    assert_eq!(answer["result"]["content"], json!([{"type": "text", "text": "SmedCover is busy: exporting."}]));
    assert!(answer["result"].get("structuredContent").is_none(), "never what the tool's output schema describes");
    // its kind, for a program to test, in _meta
    assert_eq!(answer["result"]["_meta"], json!({"smedcover/error": {"kind": "busy", "message": "SmedCover is busy: exporting."}}));
    let answer = e.legacy_call(2, "timeout", json!({})).await;
    assert_eq!(answer["result"]["isError"], true);
    let text = answer["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("did not answer in time"));
    assert_eq!(answer["result"]["_meta"]["smedcover/error"], json!({"kind": "timeout", "message": text}));
    for (id, tool) in [(3, "nope"), (4, "stale"), (5, "server_only")] {
        let answer = e.legacy_call(id, tool, json!({})).await;
        assert_eq!(answer["error"]["code"], -32602, "{tool}");
        assert_eq!(answer["error"]["message"], format!("Unknown tool: {tool}"));
    }
    let last = e.stats.snapshot().last_call.unwrap();
    assert_eq!((last.tool.as_str(), last.ok), ("stale", false), "a tool not offered never reaches the page");
}

// ---- who may call ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_token_is_wanted() {
    let e = Endpoint::start();
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    let without: Vec<_> = e.headers(Some(LEGACY)).into_iter().filter(|(n, _)| n != "Authorization").collect();
    let reply = http("POST", &e.url("/mcp"), without.clone(), Some(list.clone())).await;
    assert_eq!(reply.status, 401);
    assert!(reply.header("www-authenticate").unwrap().starts_with("Bearer"));
    let mut wrong = without.clone();
    wrong.push(("Authorization".into(), "Bearer smc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".into()));
    let reply = http("POST", &e.url("/mcp"), wrong, Some(list.clone())).await;
    assert_eq!(reply.status, 401);
    assert!(reply.header("www-authenticate").unwrap().contains("invalid_token"));
    let token = e.token().unwrap();
    assert!(!reply.body.contains(&token) && !reply.headers.iter().any(|(_, v)| v.contains(&token)), "the answer gives nothing away");
    assert_eq!(http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(list.clone())).await.status, 200);
    // a new token: the old one is turned away at once
    let old = e.headers(Some(LEGACY));
    e.set_access(Access::Token(Secret::generate().unwrap()));
    assert_eq!(http("POST", &e.url("/mcp"), old, Some(list.clone())).await.status, 401);
    assert_eq!(http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(list)).await.status, 200);
    // /health wants none
    assert_eq!(get(&e.url("/health"), vec![]).await.status, 200);
}

/// Web pages are kept out whoever may call: with a token wanted and, as strictly, with none.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_this_computer_by_its_loopback_names() {
    for e in [Endpoint::start(), Endpoint::open()] {
        let mode = if e.token().is_some() { "token" } else { "open" };
        let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
        let with = |extra: &[(&str, &str)]| {
            let mut headers = e.headers(Some(LEGACY));
            headers.extend(extra.iter().map(|(n, v)| (n.to_string(), v.to_string())));
            headers
        };
        // another site, a sandboxed or file page, and the app's own web view (macOS and Linux, Windows)
        for origin in ["https://evil.example", "null", "http://localhost.evil.example:5173", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"] {
            let reply = http("POST", &e.url("/mcp"), with(&[("Origin", origin)]), Some(list.clone())).await;
            assert_eq!(reply.status, 403, "{mode}: {origin}");
            assert!(reply.header("access-control-allow-origin").is_none());
        }
        for origin in ["http://localhost:5173", "http://127.0.0.1", "https://[::1]:8443"] {
            assert_eq!(http("POST", &e.url("/mcp"), with(&[("Origin", origin)]), Some(list.clone())).await.status, 200, "{mode}: {origin}");
        }
        let evil_host = format!("evil.example:{}", e.addr().port());
        assert_eq!(http("POST", &e.url("/mcp"), with(&[("Host", &evil_host)]), Some(list.clone())).await.status, 403, "{mode}");
        assert_eq!(get(&e.url("/health"), vec![("Host".into(), evil_host.clone())]).await.status, 403, "{mode}");
        let localhost = format!("localhost:{}", e.addr().port());
        assert_eq!(http("POST", &e.url("/mcp"), with(&[("Host", &localhost)]), Some(list.clone())).await.status, 200, "{mode}");
        // the app's own requests for its page carry the marker, whatever its value: refused, /health too
        for marker in [("X-SmedCover-Page", "1"), ("x-smedcover-page", "0"), ("X-SMEDCOVER-PAGE", "")] {
            let reply = http("POST", &e.url("/mcp"), with(&[marker]), Some(list.clone())).await;
            assert_eq!(reply.status, 403, "{mode}: {marker:?}");
            assert!(reply.body.contains("SmedCover's own window"), "{}", reply.body);
        }
        assert_eq!(get(&e.url("/health"), vec![("X-SmedCover-Page".into(), "1".into())]).await.status, 403, "{mode}");
        // a page on a loopback origin gets no further than its browser's preflight, which is never
        // told it may (no CORS headers), and the one POST it could send without one, of text/plain,
        // is refused before anything is called
        let preflight = vec![
            ("Origin".to_string(), "http://localhost:5173".to_string()),
            ("Access-Control-Request-Method".to_string(), "POST".to_string()),
            ("Access-Control-Request-Headers".to_string(), "content-type".to_string()),
        ];
        let reply = http("OPTIONS", &e.url("/mcp"), preflight, None).await;
        assert!(!(200..300).contains(&reply.status), "{mode}: the preflight answered {}", reply.status);
        assert!(reply.headers.iter().all(|(n, _)| !n.to_ascii_lowercase().starts_with("access-control-")), "{mode}: no CORS headers");
        let calls = e.bridge.calls.lock().unwrap().len();
        let call = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "echo", "arguments": {}}}).to_string();
        let mut simple: Vec<_> = with(&[("Origin", "http://localhost:5173")]).into_iter().filter(|(n, _)| n != "Content-Type").collect();
        simple.push(("Content-Type".into(), "text/plain;charset=UTF-8".into()));
        assert_eq!(http("POST", &e.url("/mcp"), simple, Some(call)).await.status, 415, "{mode}");
        assert_eq!(e.bridge.calls.lock().unwrap().len(), calls, "{mode}: nothing was called");
    }
}

// ---- no token wanted: the desktop's default ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_access_wants_no_token() {
    let e = Endpoint::open();
    assert!(e.headers(None).iter().all(|(n, _)| n != "Authorization"), "no token is sent");
    let init = json!({"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "raw-open", "version": "0.1"}});
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": init}).to_string();
    let reply = http("POST", &e.url("/mcp"), e.headers(None), Some(body)).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.only()["result"]["serverInfo"]["name"], "smedcover");
    assert_eq!(e.legacy_note(json!({"jsonrpc": "2.0", "method": "notifications/initialized"}).to_string()).await, 202);
    assert_eq!(e.legacy(2, "tools/list", json!({})).await.only()["result"]["tools"].as_array().unwrap().len(), 8);
    let answer = e.legacy_call(3, "echo", json!({"text": "no token"})).await;
    assert_eq!(answer["result"]["structuredContent"], json!({"text": "no token"}));
    assert_eq!(e.bridge.last_call().0, "echo");
    // a header sent anyway, a token's or not, right or wrong, is not looked at
    for auth in ["Bearer smc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "Bearer whatever", "Basic dXNlcjpwYXNz", "nonsense"] {
        let mut headers = e.headers(Some(LEGACY));
        headers.push(("Authorization".into(), auth.into()));
        let call = json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "echo", "arguments": {"n": 4}}});
        let reply = http("POST", &e.url("/mcp"), headers, Some(call.to_string())).await;
        assert_eq!(reply.status, 200, "{auth}");
        assert!(reply.header("www-authenticate").is_none());
        assert_eq!(reply.only()["result"]["structuredContent"], json!({"n": 4}));
    }
    // the 2026-07-28 era too
    let reply = e.modern(5, "tools/call", json!({"name": "echo", "arguments": {"m": 1}}), Some("echo")).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.only()["result"]["structuredContent"], json!({"m": 1}));
}

/// Who may call is read at every request: switched while the endpoint runs, it is in force from the
/// next request, without a restart, and a call in hand goes on.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_access_switches_while_it_runs() {
    let e = Endpoint::open();
    let (list, url) = (json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string(), e.url("/mcp"));
    let ask = |auth: Option<&str>| {
        let mut headers = e.headers(Some(LEGACY));
        headers.retain(|(n, _)| n != "Authorization");
        if let Some(auth) = auth {
            headers.push(("Authorization".to_string(), auth.to_string()));
        }
        http("POST", &url, headers, Some(list.clone()))
    };
    assert_eq!(ask(None).await.status, 200);
    let mut hanging = e.open_call(9, "hang");
    e.bridge.hung().await;
    let secret = Secret::generate().unwrap();
    let right = format!("Bearer {}", secret.expose());
    e.set_access(Access::Token(secret));
    let reply = ask(None).await;
    assert_eq!(reply.status, 401);
    assert_eq!(reply.header("www-authenticate"), Some(r#"Bearer realm="SmedCover""#));
    assert_eq!(ask(Some("Bearer smc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).await.status, 401);
    assert_eq!(ask(Some(&right)).await.status, 200);
    // open again: no token wanted, and one shown does no harm
    e.set_access(Access::Open);
    assert_eq!(ask(None).await.status, 200);
    assert_eq!(ask(Some(&right)).await.status, 200);
    // the call begun before the switches is still in hand, its answer begun
    assert!(e.bridge.let_go.lock().unwrap().is_none(), "the call in hand went on");
    let head = blocking(move || read_head(&mut hanging, Duration::from_secs(5))).await;
    assert!(head.is_some_and(|h| h.starts_with("http/1.1 200")), "the call's answer had begun");
}

/// An endpoint serving a server's tools wants a token whatever access it is given: open, it lets no
/// one in; with a token, whoever shows it.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_servers_endpoint_always_wants_a_token() {
    let tools = Arc::new(ToolList::from_json(TOOLS, Host::Server).unwrap());
    let access = Arc::new(RwLock::new(Access::Open));
    let server = McpServer::new(Arc::new(FakeBridge::default()), tools, access.clone(), Arc::new(Stats::new()));
    let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).unwrap();
    let url = format!("http://{}/mcp", running.addr());
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    let ask = |auth: Option<String>| {
        let mut headers = vec![
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Accept".to_string(), "application/json, text/event-stream".to_string()),
            ("MCP-Protocol-Version".to_string(), LEGACY.to_string()),
        ];
        headers.extend(auth.map(|a| ("Authorization".to_string(), a)));
        http("POST", &url, headers, Some(list.clone()))
    };
    let secret = Secret::generate().unwrap();
    let right = format!("Bearer {}", secret.expose());
    for auth in [None, Some("Bearer smc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string()), Some(right.clone())] {
        let reply = ask(auth).await;
        assert_eq!(reply.status, 401, "open, for a server: no one in");
        assert!(reply.header("www-authenticate").is_some_and(|c| c.starts_with("Bearer")));
    }
    *access.write().unwrap() = Access::Token(secret);
    assert_eq!(ask(None).await.status, 401);
    let reply = ask(Some(right)).await;
    assert_eq!(reply.status, 200);
    let names: Vec<_> = reply.only()["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap().to_string()).collect();
    assert!(names.contains(&"server_only".to_string()), "the server's tools: {names:?}");
    drop(running);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rmcp_client_without_a_token_when_none_is_wanted() {
    let e = Endpoint::open();
    let client = client_config("rmcp-open").serve(rmcp_transport(&e)).await.expect("initialize without a token");
    assert_eq!(client.list_all_tools().await.unwrap().len(), 8);
    let result = client.call_tool(CallToolRequestParams::new("echo").with_arguments(args(json!({"open": true})))).await.unwrap();
    assert_eq!(result.structured_content, Some(json!({"open": true})));
    client.cancel().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn get_and_delete_are_not_served() {
    let e = Endpoint::start();
    let mut headers = e.headers(Some(LEGACY));
    headers.retain(|(n, _)| n != "Accept");
    headers.push(("Accept".into(), "text/event-stream".into()));
    assert_eq!(get(&e.url("/mcp"), headers.clone()).await.status, 405);
    assert_eq!(http("DELETE", &e.url("/mcp"), headers.clone(), None).await.status, 405);
    // with a session id given out, as a client closing its session sends it, as well
    let init = json!({"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "raw-legacy", "version": "0.1"}});
    let id = e.legacy(1, "initialize", init).await.header("mcp-session-id").expect("a session id").to_string();
    headers.push(("Mcp-Session-Id".into(), id));
    assert_eq!(get(&e.url("/mcp"), headers.clone()).await.status, 405);
    assert_eq!(http("DELETE", &e.url("/mcp"), headers, None).await.status, 405);
    assert_eq!(get(&e.url("/elsewhere"), vec![]).await.status, 404);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn health_says_who_and_whether_the_page_is_ready() {
    let e = Endpoint::start();
    let reply = get(&e.url("/health"), vec![]).await;
    assert_eq!(reply.status, 200);
    assert_eq!(serde_json::from_str::<Value>(&reply.body).unwrap(), json!({"name": "smedcover", "version": VERSION, "page": "ready"}));
}

// ---- cancelling ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_client_that_hangs_up_cancels_its_call() {
    let e = Endpoint::start();
    let stream = e.open_call(1, "hang");
    e.bridge.hung().await;
    assert_eq!(e.stats.snapshot().in_flight, 1);
    let hung_up = Instant::now();
    stream.shutdown(std::net::Shutdown::Both).unwrap();
    drop(stream);
    let took = e.bridge.let_go_after(hung_up).await;
    assert!(took < Duration::from_secs(1), "the page heard after {took:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn notifications_cancelled_cancels_the_call_with_that_id() {
    let e = Endpoint::start();
    let mut stream = e.open_call(4242, "hang");
    e.bridge.hung().await;
    let sent = Instant::now();
    let note = json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 4242, "reason": "the user pressed Esc"}});
    let reply = http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(note.to_string())).await;
    assert_eq!(reply.status, 202);
    let took = e.bridge.let_go_after(sent).await;
    assert!(took < Duration::from_secs(1), "the page heard after {took:?}");
    // the call's own request is answered, and its connection let go
    let answer = tokio::task::spawn_blocking(move || {
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut text = Vec::new();
        let mut buf = [0u8; 4096];
        while let Ok(n) = stream.read(&mut buf) {
            if n == 0 {
                break;
            }
            text.extend_from_slice(&buf[..n]);
            if String::from_utf8_lossy(&text).contains("cancelled") {
                break;
            }
        }
        String::from_utf8_lossy(&text).to_string()
    })
    .await
    .unwrap();
    assert!(answer.starts_with("HTTP/1.1 200"), "{answer}");
}

// ---- starting and stopping ----

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn stopped_and_started_again_on_the_same_port() {
    let e = Endpoint::start();
    let addr = e.addr();
    assert_eq!(get(&e.url("/health"), vec![]).await.status, 200);
    // open when it stops: a connection kept alive after an answer, and one with a call in hand
    let mut idle = TcpStream::connect(addr).unwrap();
    idle.write_all(format!("GET /health HTTP/1.1\r\nHost: {addr}\r\n\r\n").as_bytes()).unwrap();
    let (head, mut idle) = blocking(move || (read_head(&mut idle, Duration::from_secs(5)), idle)).await;
    let head = head.unwrap();
    assert!(head.starts_with("http/1.1 200") && !head.contains("connection: close"), "{head}");
    let mut calling = e.open_call(1, "hang");
    e.bridge.hung().await;
    // the call is cancelled, both connections closed, and the stop waits for neither
    let stopping = Instant::now();
    assert!(e.running.stop(Duration::from_secs(2)).await, "it stopped in time");
    assert!(stopping.elapsed() < Duration::from_secs(2));
    assert!(e.bridge.let_go_after(stopping).await < Duration::from_secs(1));
    let (closed, idle_closed) = blocking(move || (read_till_closed(&mut calling, Duration::from_secs(2)).1, read_till_closed(&mut idle, Duration::from_secs(2)).1)).await;
    assert!(closed && idle_closed, "every connection is closed by the server");
    assert!(TcpStream::connect_timeout(&addr, Duration::from_secs(1)).is_err(), "nothing listens any more");
    // the same port again
    let running = e.server.start(addr, &Handle::current()).expect("the port is free again");
    assert_eq!(running.addr(), addr);
    assert_eq!(running.url(), format!("http://{addr}/mcp"));
    assert_eq!(get(&format!("http://{addr}/health"), vec![]).await.status, 200);
    drop(running);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_port_in_use_is_said_and_not_swapped() {
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = taken.local_addr().unwrap();
    let e = Endpoint::start();
    let error = e.server.start(addr, &Handle::current()).err().expect("the port is taken");
    assert_eq!(error, BindError::PortInUse(addr.port()));
    assert_eq!(error.code(), "port_in_use");
    drop(taken);
}

/// A connection whose body is still coming when the endpoint stops is closed, and the stop is clean.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_body_still_coming_is_closed_by_stop() {
    let e = Endpoint::start();
    let addr = e.addr();
    let body = json!({"jsonrpc": "2.0", "id": 9, "method": "tools/call", "params": {"name": "echo", "arguments": {}}}).to_string();
    let mut slow = e.open_post(true, &[("MCP-Protocol-Version", LEGACY)], body.len(), &body.as_bytes()[..10]);
    // the body is being waited for once the headers are in: an answer to a request behind it shows that
    assert_eq!(get(&e.url("/health"), vec![]).await.status, 200);
    let stopping = Instant::now();
    assert!(e.running.stop(Duration::from_secs(2)).await, "nothing had to be cut off");
    assert!(stopping.elapsed() < Duration::from_secs(1), "{:?}", stopping.elapsed());
    let (answer, closed) = blocking(move || read_till_closed(&mut slow, Duration::from_secs(2))).await;
    assert!(closed, "closed by the server");
    assert!(answer.is_empty() || answer.starts_with("HTTP/1.1 503"), "{answer}");
    let again = e.server.start(addr, &Handle::current()).expect("the port is free again");
    drop(again);
}

/// A connection that has not finished when the stop's wait is over is cut off: it is gone, and the
/// port free, when the stop returns. Here a request whose head stops coming half way: hyper does
/// not take it for idle, and would wait for the rest for the server's `HEADER_TIMEOUT`, 10 s.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_head_still_coming_is_cut_off() {
    let e = Endpoint::start();
    let addr = e.addr();
    let mut busy = TcpStream::connect(addr).unwrap();
    busy.write_all(format!("POST /mcp HTTP/1.1\r\nHost: {addr}\r\n").as_bytes()).unwrap();
    // time for the server to read it: a connection it has read nothing on is closed at once
    tokio::time::sleep(Duration::from_millis(200)).await;
    let stopping = Instant::now();
    assert!(!e.running.stop(Duration::from_millis(300)).await, "it had to be cut off");
    let took = stopping.elapsed();
    assert!(took >= Duration::from_millis(300) && took < Duration::from_secs(2), "{took:?}");
    let (answer, closed) = blocking(move || read_till_closed(&mut busy, Duration::from_secs(5))).await;
    assert!(closed, "closed by the server");
    assert!(answer.is_empty(), "{answer}");
    drop(e.server.start(addr, &Handle::current()).expect("the port is free again"));
}

/// The same for an answer its client stops reading. Not on Windows: there the system takes the
/// whole answer into its own buffers (a socket left at the default send buffer is sized
/// dynamically), so the server finishes writing it and the stop is clean.
#[cfg(not(windows))]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn an_answer_not_read_is_cut_off() {
    let e = Endpoint::start();
    let addr = e.addr();
    // an answer of 32 MB that its client stops reading: the server cannot finish writing it
    let data = "A".repeat(16 << 20);
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "echo", "arguments": {"data": data}}}).to_string();
    let mut busy = e.open_post(true, &[("MCP-Protocol-Version", LEGACY)], body.len(), body.as_bytes());
    let mut busy = blocking(move || {
        assert!(read_head(&mut busy, Duration::from_secs(10)).is_some_and(|h| h.starts_with("http/1.1 200")));
        let mut some = vec![0u8; 64 * 1024];
        busy.read_exact(&mut some).unwrap();
        busy
    })
    .await;
    let stopping = Instant::now();
    assert!(!e.running.stop(Duration::from_millis(300)).await, "it had to be cut off");
    let took = stopping.elapsed();
    assert!(took >= Duration::from_millis(300) && took < Duration::from_secs(2), "{took:?}");
    let (_, closed) = blocking(move || read_till_closed(&mut busy, Duration::from_secs(5))).await;
    assert!(closed, "closed by the server");
    drop(e.server.start(addr, &Handle::current()).expect("the port is free again"));
}

/// A refused request's body is not waited for: at most a little of it is read, then the refusal
/// is sent and the connection closed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_refused_body_is_not_waited_for() {
    let e = Endpoint::start();
    // a mebibyte promised and just over the 64 KiB read of it sent: answered at once, the rest not
    // waited for
    let started = Instant::now();
    let mut big = e.open_post(false, &[], 1 << 20, &vec![b' '; REFUSED_BODY_BYTES + 1]);
    let (got, _) = blocking(move || {
        let head = read_head(&mut big, Duration::from_secs(5));
        (head, read_till_closed(&mut big, Duration::from_secs(5)).1)
    })
    .await;
    let head = got.expect("refused");
    assert!(head.starts_with("http/1.1 401") && head.contains("connection: close"), "{head}");
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
    // nothing of the body sent: answered when the short wait for it is over
    let started = Instant::now();
    let mut none = e.open_post(true, &[("Origin", "https://evil.example")], 1000, b"");
    let (head, closed) = blocking(move || {
        let head = read_head(&mut none, Duration::from_secs(5));
        (head, read_till_closed(&mut none, Duration::from_secs(5)).1)
    })
    .await;
    assert!(head.unwrap().starts_with("http/1.1 403"));
    assert!(closed);
    let took = started.elapsed();
    assert!(took >= Duration::from_millis(1900) && took < Duration::from_secs(4), "{took:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bodies_up_to_32_mib() {
    let e = Endpoint::start();
    // a photo's worth of base64, more than the 4 MiB rmcp takes unless told
    let data = "A".repeat(20 << 20);
    let answer = e.legacy_call(1, "size", json!({"data": data})).await;
    assert_eq!(answer["result"]["content"][0]["text"], (20 << 20).to_string());
    // over 32 MiB: refused before it is read, but for the little a refusal reads
    let started = Instant::now();
    let mut stream = e.open_post(true, &[("MCP-Protocol-Version", LEGACY)], MAX_BODY + 1, &vec![b' '; REFUSED_BODY_BYTES + 1]);
    let (head, closed) = blocking(move || {
        let head = read_head(&mut stream, Duration::from_secs(5));
        (head, read_till_closed(&mut stream, Duration::from_secs(5)).1)
    })
    .await;
    let head = head.expect("refused");
    assert!(head.starts_with("http/1.1 413") && head.contains("connection: close"), "{head}");
    assert!(closed);
    assert!(started.elapsed() < Duration::from_secs(1), "{:?}", started.elapsed());
}

/// A cancel is placed only where there is no doubt which call it means.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancels_that_cannot_be_placed_are_ignored() {
    let e = Endpoint::start();
    let init = json!({"protocolVersion": LEGACY, "capabilities": {}, "clientInfo": {"name": "raw-legacy", "version": "0.1"}});
    assert_eq!(e.legacy(1, "initialize", init).await.status, 200);
    let stream = e.open_call(77, "hang");
    e.bridge.hung().await;
    let note = |id: u64| json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": id}}).to_string();
    // without the token: refused before anything is looked at
    let without: Vec<_> = e.headers(Some(LEGACY)).into_iter().filter(|(n, _)| n != "Authorization").collect();
    assert_eq!(http("POST", &e.url("/mcp"), without, Some(note(77))).await.status, 401);
    // on another revision, or none (2025-03-26), or another id
    for protocol in [Some("2025-11-25"), None] {
        assert_eq!(http("POST", &e.url("/mcp"), e.headers(protocol), Some(note(77))).await.status, 202);
    }
    assert_eq!(e.legacy_note(note(78)).await, 202);
    // the 2026-07-28 era does not cancel this way
    let mut headers = e.headers(Some(MODERN));
    headers.push(("Mcp-Method".into(), "notifications/cancelled".into()));
    let _ = http("POST", &e.url("/mcp"), headers, Some(note(77))).await;
    // none of those did (a cancel placed would have let the call go well within this): it lets go
    // only after the one that is its own
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(e.bridge.let_go.lock().unwrap().is_none(), "an earlier cancel was placed");
    let placed = Instant::now();
    assert_eq!(e.legacy_note(note(77)).await, 202);
    assert!(e.bridge.let_go_after(placed).await < Duration::from_secs(1));
    assert!(e.bridge.let_go.lock().unwrap().is_some_and(|at| at >= placed));
    drop(stream);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn batches_are_not_served() {
    let e = Endpoint::start();
    let batch = json!([{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, {"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 1}}]);
    let reply = http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(batch.to_string())).await;
    assert_eq!(reply.status, 415, "{}", reply.body);
}

// ---- who a request comes from ----

/// The answer to an `initialize` carries a session id, used only to recognise the client by: a
/// request carrying it is that client's, whoever else is on the same revision with the same
/// `User-Agent`, and however long ago the client was last seen. One without it, or with an id not
/// given out (the app started again since), is served all the same and taken to be the client that
/// came with its `User-Agent`, if one alone did; else it is counted as the unidentified client's.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_session_id_tells_whose_requests_they_are() {
    let e = Endpoint::open();
    let a = e.introduce("raw-a", "raw-a/1.0").await;
    let b = e.introduce("raw-b", "raw-b/1.0").await;
    let c = e.introduce("raw-c", "node").await;
    let d = e.introduce("raw-d", "node").await;
    assert!(a != b && a != c && a != d && b != c && b != d && c != d, "each its own");
    let (a, b, c, d) = (a.as_str(), b.as_str(), c.as_str(), d.as_str());
    // by their ids, though c and d came with the same User-Agent on the same revision
    assert_eq!(e.whose(2, &[("Mcp-Session-Id", a), ("User-Agent", "raw-a/1.0")]).await.as_deref(), Some("raw-a"));
    assert_eq!(e.whose(3, &[("Mcp-Session-Id", c), ("User-Agent", "node")]).await.as_deref(), Some("raw-c"));
    assert_eq!(e.whose(4, &[("Mcp-Session-Id", d), ("User-Agent", "node")]).await.as_deref(), Some("raw-d"));
    // an id says whose a request is whatever User-Agent comes with it
    assert_eq!(e.whose(5, &[("Mcp-Session-Id", b), ("User-Agent", "something/else")]).await.as_deref(), Some("raw-b"));
    // without one, by the User-Agent when one client alone came with it
    assert_eq!(e.whose(6, &[("User-Agent", "raw-b/1.0")]).await.as_deref(), Some("raw-b"));
    // an id not given out is no refusal: served, and recognised as one without
    assert_eq!(e.whose(7, &[("Mcp-Session-Id", "from-before-a-restart"), ("User-Agent", "raw-a/1.0")]).await.as_deref(), Some("raw-a"));
    // two clients came with this User-Agent, and both were seen lately: no one's, but counted
    assert_eq!(e.whose(8, &[("Mcp-Session-Id", "from-before-a-restart"), ("User-Agent", "node")]).await, None);
    assert_eq!(e.whose(9, &[("User-Agent", "node")]).await, None);
    let shown = serde_json::to_value(e.stats.snapshot()).unwrap();
    let entry = |name: Value| shown["clients"].as_array().unwrap().iter().find(|c| c["name"] == name).cloned().unwrap_or_else(|| panic!("{shown}"));
    let unidentified = entry(Value::Null);
    assert!(unidentified["version"].is_null() && unidentified["protocol"] == LEGACY && unidentified["lastSeen"].is_u64(), "{shown}");
    assert_eq!(unidentified["calls"], 2);
    for (name, calls) in [("raw-a", 2), ("raw-b", 2), ("raw-c", 1), ("raw-d", 1)] {
        assert_eq!(entry(json!(name))["calls"], calls, "{name}: {shown}");
    }

    // eleven minutes on: no one has been seen lately, but who they are is known still
    e.later(Duration::from_secs(11 * 60));
    assert!(e.stats.snapshot().clients.is_empty());
    assert_eq!(e.whose(10, &[("Mcp-Session-Id", c), ("User-Agent", "node")]).await.as_deref(), Some("raw-c"));
    assert_eq!(e.whose(11, &[("User-Agent", "raw-b/1.0")]).await.as_deref(), Some("raw-b"));
    // with an id not given out, the User-Agent of a client not seen lately is not enough (after a
    // restart another client may have come with it since): no one's
    assert_eq!(e.whose(20, &[("Mcp-Session-Id", "from-before-a-restart"), ("User-Agent", "raw-a/1.0")]).await, None);
    // c alone of those who came with "node" is seen lately now: a request without an id is its
    assert_eq!(e.whose(12, &[("User-Agent", "node")]).await.as_deref(), Some("raw-c"));
    // seen lately again, each counted from its return
    let seen = e.stats.snapshot().clients;
    let names: Vec<_> = seen.iter().map(|c| (c.name.as_deref(), c.calls)).collect();
    assert_eq!(names.len(), 3, "{names:?}");
    assert!(names.contains(&(Some("raw-c"), 2)) && names.contains(&(Some("raw-b"), 1)) && names.contains(&(None, 1)), "{names:?}");
    // tools/list, and a ping, are its client's too, and count as seen without being calls
    e.later(Duration::from_secs(11 * 60));
    let reply = e.legacy_with(13, "tools/list", json!({}), &[("Mcp-Session-Id", d), ("User-Agent", "node")]).await;
    assert_eq!(reply.status, 200);
    let reply = e.legacy_with(14, "ping", json!({}), &[("Mcp-Session-Id", a)]).await;
    assert_eq!((reply.status, &reply.only()["result"]), (200, &json!({})));
    let seen = e.stats.snapshot().clients;
    let names: Vec<_> = seen.iter().map(|c| (c.name.as_deref(), c.calls)).collect();
    assert_eq!(names.len(), 2, "{names:?}");
    assert!(names.contains(&(Some("raw-d"), 0)) && names.contains(&(Some("raw-a"), 0)), "{names:?}");
}

/// A `notifications/cancelled` carrying a session id cancels that client's call with the id it
/// names, and not another client's call with the same id.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cancel_with_a_session_id_is_its_clients() {
    let e = Endpoint::open();
    let a = e.introduce("raw-a", "node").await;
    let b = e.introduce("raw-b", "node").await;
    let open = |session: &str| {
        let body = json!({"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "hang", "arguments": {}}}).to_string();
        e.open_post(true, &[("MCP-Protocol-Version", LEGACY), ("Mcp-Session-Id", session), ("User-Agent", "node")], body.len(), body.as_bytes())
    };
    let mut first = open(&a);
    e.bridge.hung().await;
    let mut second = open(&b);
    e.bridge.hung().await;
    let clients: Vec<_> = e.bridge.calls.lock().unwrap().iter().map(|(_, c, _)| c.as_ref().map(|c| c.name.clone())).collect();
    assert_eq!(clients, [Some("raw-a".to_string()), Some("raw-b".to_string())]);
    // eleven minutes on, both calls still running: both clients still count as seen
    e.later(Duration::from_secs(11 * 60));
    let seen: Vec<_> = e.stats.snapshot().clients.into_iter().map(|c| (c.name, c.in_flight)).collect();
    assert_eq!(seen.len(), 2, "{seen:?}");
    assert!(seen.contains(&(Some("raw-a".into()), 1)) && seen.contains(&(Some("raw-b".into()), 1)), "{seen:?}");
    // without an id the cancel could be either's: ignored
    let (note, url) = (json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": 5}}).to_string(), e.url("/mcp"));
    let send = |extra: Vec<(String, String)>| {
        let mut headers = e.headers(Some(LEGACY));
        headers.push(("User-Agent".into(), "node".into()));
        headers.extend(extra);
        http("POST", &url, headers, Some(note.clone()))
    };
    assert_eq!(send(vec![]).await.status, 202);
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(e.bridge.let_go.lock().unwrap().is_none(), "a cancel that could be either's was placed");
    // with b's id: b's call alone
    let placed = Instant::now();
    assert_eq!(send(vec![("Mcp-Session-Id".into(), b.clone())]).await.status, 202);
    assert!(e.bridge.let_go_after(placed).await < Duration::from_secs(1));
    let (answered, still, first) = blocking(move || {
        let answered = read_till(&mut second, "cancelled", Duration::from_secs(5));
        let still = read_till(&mut first, "cancelled", Duration::from_millis(500));
        (answered, still, first)
    })
    .await;
    assert!(answered.contains("cancelled"), "{answered}");
    assert!(!still.contains("cancelled") && !still.contains("\"result\""), "a's call was answered: {still}");
    drop(first);
}

/// What comes on `stream` till `words` do, it closes, or `wait` is over.
fn read_till(stream: &mut TcpStream, words: &str, wait: Duration) -> String {
    let until = Instant::now() + wait;
    let mut text = Vec::new();
    let mut buf = [0u8; 4096];
    while !String::from_utf8_lossy(&text).contains(words) {
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        stream.set_read_timeout(Some(left)).unwrap();
        match stream.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => text.extend_from_slice(&buf[..n]),
        }
    }
    String::from_utf8_lossy(&text).to_string()
}

// ---- rmcp's own client, in both eras ----

/// rmcp's client for `e`, showing its token if it wants one.
fn rmcp_transport(e: &Endpoint) -> StreamableHttpClientTransport<reqwest::Client> {
    // Built with the app, reqwest has rustls but no provider for it, which it would panic for: the one tauri-plugin-updater
    // installs (ring's). Built alone, reqwest has no TLS, and this changes nothing for it.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let config = StreamableHttpClientTransportConfig::with_uri(e.url("/mcp"));
    let config = match e.token() {
        Some(token) => config.auth_header(token),
        None => config,
    };
    StreamableHttpClientTransport::with_client(client, config)
}

fn client_config(name: &str) -> ClientConfig {
    ClientConfig::new(ClientCapabilities::default(), Implementation::new(name, "9.9"))
}

fn args(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rmcp_client_with_initialize() {
    let e = Endpoint::start();
    let client = client_config("rmcp-legacy").serve(rmcp_transport(&e)).await.expect("initialize");
    let server = client.peer_info().unwrap();
    assert_eq!(server.server_info.as_ref().map(|s| s.name.as_str()), Some("smedcover"));
    assert!(server.protocol_version.has_initialize());
    let tools = client.list_all_tools().await.unwrap();
    assert_eq!(tools.len(), 8);
    assert_eq!(tools[0].name, "echo");
    let result = client.call_tool(CallToolRequestParams::new("echo").with_arguments(args(json!({"a": [1, 2, 3]})))).await.unwrap();
    assert_eq!(result.structured_content, Some(json!({"a": [1, 2, 3]})));
    let result = client.call_tool(CallToolRequestParams::new("image")).await.unwrap();
    assert_eq!(result.content[0].as_image().map(|i| (i.data.as_str(), i.mime_type.as_str())), Some((PNG, "image/png")));
    let result = client.call_tool(CallToolRequestParams::new("busy")).await.unwrap();
    assert_eq!(result.is_error, Some(true));
    assert!(client.call_tool(CallToolRequestParams::new("nope")).await.is_err());
    // rmcp's client sends back the session id it was given: its calls are its (the unknown tool's
    // never reached the page, and is not counted)
    assert_eq!(e.bridge.last_call().1.map(|c| c.name).as_deref(), Some("rmcp-legacy"));
    let seen = e.stats.snapshot().clients;
    assert!(seen.iter().any(|c| c.name.as_deref() == Some("rmcp-legacy") && c.calls == 3), "{seen:?}");
    client.cancel().await.unwrap();
}

/// Two of rmcp's clients at once, on the same revision and with the same (no) `User-Agent`: each
/// sends back its own session id, and each call is its own client's.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rmcp_clients_are_told_apart_by_their_session_ids() {
    let e = Endpoint::open();
    let one = client_config("rmcp-one").serve(rmcp_transport(&e)).await.expect("initialize");
    let two = client_config("rmcp-two").serve(rmcp_transport(&e)).await.expect("initialize");
    for (client, name) in [(&one, "rmcp-one"), (&two, "rmcp-two"), (&one, "rmcp-one"), (&one, "rmcp-one")] {
        client.call_tool(CallToolRequestParams::new("echo").with_arguments(args(json!({"who": name})))).await.unwrap();
        assert_eq!(e.bridge.last_call().1.map(|c| c.name).as_deref(), Some(name));
    }
    let seen = e.stats.snapshot().clients;
    let calls = |name: &str| seen.iter().find(|c| c.name.as_deref() == Some(name)).map(|c| c.calls);
    assert_eq!((calls("rmcp-one"), calls("rmcp-two")), (Some(3), Some(1)), "{seen:?}");
    assert!(seen.iter().all(|c| c.name.is_some()), "none unidentified: {seen:?}");
    one.cancel().await.unwrap();
    two.cancel().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rmcp_client_with_discover() {
    let e = Endpoint::start();
    let lifecycle = ClientLifecycleMode::Discover { preferred_versions: vec![ProtocolVersion::V_2026_07_28] };
    let client = client_config("rmcp-modern").serve_with_lifecycle(rmcp_transport(&e), lifecycle).await.expect("discover");
    assert_eq!(client.peer_info().unwrap().protocol_version, ProtocolVersion::V_2026_07_28);
    let tools = client.list_all_tools().await.unwrap();
    assert_eq!(tools.iter().map(|t| t.name.to_string()).collect::<Vec<_>>(), ["echo", "image", "slow", "hang", "busy", "stale", "timeout", "size"]);
    let result = client.call_tool(CallToolRequestParams::new("echo").with_arguments(args(json!({"x": "y"})))).await.unwrap();
    assert_eq!(result.structured_content, Some(json!({"x": "y"})));
    let result = client.call_tool(CallToolRequestParams::new("timeout")).await.unwrap();
    assert_eq!(result.is_error, Some(true));
    let (_, who, _) = e.bridge.last_call();
    assert_eq!(who, Some(ClientTag { name: "rmcp-modern".into(), version: "9.9".into() }));
    client.cancel().await.unwrap();
}

// ---- the dispatcher behind the endpoint, and a page that answers ----

/// Hands what the page is sent to the page's task.
struct ChannelSink(mpsc::UnboundedSender<Value>);

impl PageSink for ChannelSink {
    fn send(&self, msg: &Value) -> Result<(), String> {
        self.0.send(msg.clone()).map_err(|e| e.to_string())
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn through_the_dispatcher_to_a_page() {
    let dispatcher = Arc::new(Dispatcher::new());
    let tools = Arc::new(ToolList::from_json(TOOLS, Host::Desktop).unwrap());
    let secret = Secret::generate().unwrap();
    let server = McpServer::new(dispatcher.clone(), tools, Arc::new(RwLock::new(Access::Token(secret.clone()))), Arc::new(Stats::new()));
    let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).unwrap();
    let url = format!("http://{}", running.addr());
    assert_eq!(serde_json::from_str::<Value>(&get(&format!("{url}/health"), vec![]).await.body).unwrap()["page"], "none");

    // the page: echoes, and tells of each cancel it is sent
    let (tx, mut rx) = mpsc::unbounded_channel();
    dispatcher.attach(Box::new(ChannelSink(tx)), "hash");
    let (cancels_tx, mut cancels) = mpsc::unbounded_channel::<(Value, Instant)>();
    let hang_seen = Arc::new(Notify::new());
    let page = {
        let hang_seen = hang_seen.clone();
        let dispatcher = dispatcher.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if msg["tool"] == "hang" {
                    hang_seen.notify_one();
                }
                match (msg["kind"].as_str(), msg["tool"].as_str()) {
                    (Some("call"), Some("echo")) => {
                        let reply = json!({"id": msg["id"], "ok": true, "result": {"structuredContent": {"asked": msg}}});
                        assert!(dispatcher.reply(serde_json::from_value::<PageReply>(reply).unwrap()));
                    }
                    (Some("cancel"), _) => {
                        let _ = cancels_tx.send((msg, Instant::now()));
                    }
                    _ => {}
                }
            }
        })
    };
    assert_eq!(serde_json::from_str::<Value>(&get(&format!("{url}/health"), vec![]).await.body).unwrap()["page"], "ready");

    let headers = vec![
        ("Authorization".to_string(), format!("Bearer {}", secret.expose())),
        ("Content-Type".to_string(), "application/json".to_string()),
        ("Accept".to_string(), "application/json, text/event-stream".to_string()),
    ];
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "echo", "arguments": {"k": 1}}});
    let reply = http("POST", &format!("{url}/mcp"), headers.clone(), Some(body.to_string())).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let result = &reply.only()["result"];
    let asked = &result["structuredContent"]["asked"];
    assert_eq!((asked["kind"].as_str(), asked["tool"].as_str()), (Some("call"), Some("echo")));
    assert_eq!(asked["args"], json!({"k": 1}));
    assert_eq!(asked["timeoutMs"], 5000);
    assert!(asked["id"].is_u64());
    assert!(result["content"][0]["text"].as_str().unwrap().contains("\"asked\""), "the structured content as text, since there was none");

    // a call the page never answers, its client hanging up: the page is told to stop
    let body = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "hang", "arguments": {}}}).to_string();
    let mut stream = TcpStream::connect(running.addr()).unwrap();
    let mut head = format!("POST /mcp HTTP/1.1\r\nHost: {}\r\nContent-Length: {}\r\n", running.addr(), body.len());
    for (name, value) in &headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    stream.write_all(format!("{head}\r\n{body}").as_bytes()).unwrap();
    tokio::time::timeout(Duration::from_secs(10), hang_seen.notified()).await.expect("the page was given the call");
    let hung_up = Instant::now();
    stream.shutdown(std::net::Shutdown::Both).unwrap();
    drop(stream);
    let (cancel, at) = tokio::time::timeout(Duration::from_secs(5), cancels.recv()).await.expect("the page was told").unwrap();
    assert!(cancel["id"].is_u64());
    assert!(at.duration_since(hung_up) < Duration::from_secs(1));
    let deadline = Instant::now() + Duration::from_secs(1);
    while dispatcher.calls() != 0 {
        assert!(Instant::now() < deadline, "the call was let go");
        tokio::time::sleep(Duration::from_millis(5)).await;
    }

    assert!(running.stop(Duration::from_secs(2)).await);
    dispatcher.close("the test is over");
    page.abort();
}

// ---- the command line's endpoint ----

/// The app's side of the command line's routes, played: it counts what it is asked.
#[derive(Default)]
struct FakeApp {
    shown: AtomicU64,
    done: AtomicU64,
    needs_setup: AtomicBool,
    requests: AtomicU64,
}

impl AppControl for FakeApp {
    fn health(&self) -> Map<String, Value> {
        let mut extra = Map::new();
        extra.insert("needsSetup".into(), json!(self.needs_setup.load(Ordering::SeqCst)));
        extra
    }

    fn show(&self) -> Value {
        self.shown.fetch_add(1, Ordering::SeqCst);
        json!({"ok": true, "launchedBy": "user"})
    }

    fn done(&self) -> Value {
        let n = self.done.fetch_add(1, Ordering::SeqCst);
        json!({"ok": true, "exiting": true, "asked": n + 1})
    }

    fn request(&self) {
        self.requests.fetch_add(1, Ordering::SeqCst);
    }
}

/// The command line's endpoint over the test page, wanting `access`'s token (none is let in with
/// none), its own routes answered by the app played here.
fn cli_endpoint(access: Access) -> (Running, Arc<FakeApp>, Option<String>) {
    let token = match &access {
        Access::Token(secret) => Some(secret.expose().to_string()),
        Access::Open => None,
    };
    let app = Arc::new(FakeApp::default());
    let tools = Arc::new(ToolList::from_json(TOOLS, Host::Desktop).unwrap());
    let server = McpServer::new(Arc::new(FakeBridge::default()), tools, Arc::new(RwLock::new(access)), Arc::new(Stats::new())).with_app(app.clone());
    let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).expect("a free port");
    (running, app, token)
}

fn json_headers(mut headers: Vec<(String, String)>) -> Vec<(String, String)> {
    headers.push(("Content-Type".to_string(), "application/json".to_string()));
    headers.push(("Accept".to_string(), "application/json, text/event-stream".to_string()));
    headers
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_command_lines_routes_want_the_token() {
    let (running, app, token) = cli_endpoint(Access::Token(Secret::generate().unwrap()));
    let url = |path: &str| format!("http://{}{path}", running.addr());
    let auth = vec![("Authorization".to_string(), format!("Bearer {}", token.unwrap()))];
    let wrong = vec![("Authorization".to_string(), "Bearer smc_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string())];
    for (method, path) in [("GET", "/health"), ("POST", "/app/show"), ("POST", "/app/done")] {
        let none = http(method, &url(path), vec![], (method == "POST").then(String::new)).await;
        assert_eq!(none.status, 401, "{method} {path} without the token");
        assert!(none.body.contains("cli.json"), "the refusal says where the token is: {}", none.body);
        assert_eq!(http(method, &url(path), wrong.clone(), (method == "POST").then(String::new)).await.status, 401, "{method} {path} with a wrong one");
    }
    assert_eq!((app.shown.load(Ordering::SeqCst), app.done.load(Ordering::SeqCst)), (0, 0), "nothing was asked of the app");
    assert_eq!(app.requests.load(Ordering::SeqCst), 0, "a request refused is not a command line at work");
    // with it: /health says whether calls are taken and whether the app needs setting up
    let health = get(&url("/health"), auth.clone()).await;
    assert_eq!(health.status, 200);
    assert_eq!(
        serde_json::from_str::<Value>(&health.body).unwrap(),
        json!({"name": "smedcover", "version": VERSION, "page": "ready", "ready": true, "needsSetup": false})
    );
    app.needs_setup.store(true, Ordering::SeqCst);
    assert_eq!(serde_json::from_str::<Value>(&get(&url("/health"), auth.clone()).await.body).unwrap()["needsSetup"], true);
    let shown = http("POST", &url("/app/show"), auth.clone(), Some(String::new())).await;
    assert_eq!((shown.status, serde_json::from_str::<Value>(&shown.body).unwrap()), (200, json!({"ok": true, "launchedBy": "user"})));
    for n in 1..=2 {
        let done = http("POST", &url("/app/done"), auth.clone(), Some(String::new())).await;
        assert_eq!(done.status, 200);
        assert_eq!(serde_json::from_str::<Value>(&done.body).unwrap()["asked"], n, "each one reaches the app, which answers each");
    }
    assert_eq!((app.shown.load(Ordering::SeqCst), app.done.load(Ordering::SeqCst)), (1, 2));
    assert_eq!(app.requests.load(Ordering::SeqCst), 5, "each request with the token told: two /health, a show, two done");
    // only their own methods
    assert_eq!(get(&url("/app/done"), auth.clone()).await.status, 405);
    assert_eq!(http("POST", &url("/health"), auth.clone(), Some(String::new())).await.status, 405);
    // web pages are kept out, and the window's own requests
    for (name, value) in [("Origin", "https://evil.example"), ("Origin", "tauri://localhost"), ("X-SmedCover-Page", "1")] {
        let mut headers = auth.clone();
        headers.push((name.to_string(), value.to_string()));
        assert_eq!(get(&url("/health"), headers.clone()).await.status, 403, "{name}: {value}");
        assert_eq!(http("POST", &url("/app/done"), headers, Some(String::new())).await.status, 403, "{name}: {value}");
    }
    assert_eq!(app.done.load(Ordering::SeqCst), 2, "refused before the app was asked");
    // and /mcp is the endpoint's, with the token
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    let listed = http("POST", &url("/mcp"), json_headers(auth.clone()), Some(list.clone())).await;
    assert_eq!(listed.status, 200, "{}", listed.body);
    assert!(listed.only()["result"]["tools"].as_array().is_some_and(|t| !t.is_empty()));
    assert_eq!(app.requests.load(Ordering::SeqCst), 8, "and /mcp's, the two with another method (405) but the token among them");
    assert_eq!(http("POST", &url("/mcp"), json_headers(vec![]), Some(list)).await.status, 401);
    assert!(running.stop(Duration::from_secs(2)).await);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_command_lines_endpoint_lets_no_one_in_without_a_token() {
    let (running, app, _) = cli_endpoint(Access::Open);
    let url = |path: &str| format!("http://{}{path}", running.addr());
    assert_eq!(get(&url("/health"), vec![]).await.status, 401);
    assert_eq!(http("POST", &url("/app/done"), vec![("Authorization".into(), "Bearer anything".into())], Some(String::new())).await.status, 401);
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    assert_eq!(http("POST", &url("/mcp"), json_headers(vec![]), Some(list)).await.status, 401);
    assert_eq!(app.done.load(Ordering::SeqCst), 0);
    assert!(running.stop(Duration::from_secs(2)).await);
}

fn cli_file(running: &Running, token: &Secret) -> CliFile {
    CliFile { pid: std::process::id(), port: running.addr().port(), token: token.clone(), version: VERSION.into(), launched_by: LaunchedBy::Cli, ready: true, quitting: false }
}

/// A `cli.json` is taken for a running app's only while its endpoint answers `/health` as
/// SmedCover's, with its token.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_cli_json_is_found_by_its_endpoint_answering() {
    let secret = Secret::generate().unwrap();
    let (running, _app, _) = cli_endpoint(Access::Token(secret.clone()));
    let dir = tempfile::tempdir().unwrap();
    let file = cli_file(&running, &secret);
    file.save(dir.path()).unwrap();
    let data = dir.path().to_path_buf();
    let found = blocking(move || instance::find(&data, Duration::from_secs(5))).await.expect("its app runs");
    assert_eq!((found.port, found.launched_by, found.ready), (running.addr().port(), LaunchedBy::Cli, true));
    let health = blocking(move || file.health(Duration::from_secs(5))).await.unwrap();
    assert_eq!((health["name"].as_str(), health["ready"].as_bool()), (Some("smedcover"), Some(true)));
    // another token (an app's before this one, on the same port by chance): stale
    cli_file(&running, &Secret::generate().unwrap()).save(dir.path()).unwrap();
    let data = dir.path().to_path_buf();
    assert!(blocking(move || instance::find(&data, Duration::from_secs(5))).await.is_none());
    // the app gone: stale
    cli_file(&running, &secret).save(dir.path()).unwrap();
    assert!(running.stop(Duration::from_secs(2)).await);
    let data = dir.path().to_path_buf();
    assert!(blocking(move || instance::find(&data, Duration::from_secs(2))).await.is_none());
}
