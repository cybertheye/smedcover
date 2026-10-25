//! The MCP endpoint over real HTTP, on 127.0.0.1 and a port the system picks (never the app's
//! 25277): raw requests in both eras of the protocol, rmcp's own client in both, and the
//! dispatcher behind it, against a page that is played here.
//!
//! The token is never put in a failure's message: requests are made by helpers that do not print
//! what they send.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use rmcp::model::{CallToolRequestParams, ClientCapabilities, ClientConfig, Implementation, ProtocolVersion};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::{ClientLifecycleMode, ClientServiceExt, ServiceExt};
use serde_json::{json, Map, Value};
use smedcover_core::mcp::bridge::{
    read_result, BoxFut, BridgeError, Call, ClientTag, Dispatcher, PageBridge, PageReply, PageSink, PageState, Progress,
};
use smedcover_core::mcp::server::{BindError, McpServer, Running, Stats, VERSION};
use smedcover_core::mcp::{Host, Secret, ToolList};
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
    secret: Arc<RwLock<Secret>>,
    stats: Arc<Stats>,
    server: McpServer,
}

impl Endpoint {
    fn start() -> Endpoint {
        let bridge = Arc::new(FakeBridge::default());
        let tools = Arc::new(ToolList::from_json(TOOLS, Host::Desktop).unwrap());
        let secret = Arc::new(RwLock::new(Secret::generate().unwrap()));
        let stats = Arc::new(Stats::new());
        let server = McpServer::new(bridge.clone(), tools, secret.clone(), stats.clone());
        let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).expect("a free port");
        Endpoint { running, bridge, secret, stats, server }
    }

    fn addr(&self) -> SocketAddr {
        self.running.addr()
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.addr())
    }

    fn token(&self) -> String {
        self.secret.read().unwrap().expose().to_string()
    }

    /// The headers a client of `protocol` sends with a JSON-RPC message.
    fn headers(&self, protocol: Option<&str>) -> Vec<(String, String)> {
        let mut headers = vec![
            ("Authorization".to_string(), format!("Bearer {}", self.token())),
            ("Content-Type".to_string(), "application/json".to_string()),
            ("Accept".to_string(), "application/json, text/event-stream".to_string()),
        ];
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

    /// The parts of a call's result from a JSON-RPC response that should have one.
    async fn legacy_call(&self, id: u64, tool: &str, args: Value) -> Value {
        let reply = self.legacy(id, "tools/call", json!({"name": tool, "arguments": args})).await;
        assert_eq!(reply.status, 200, "tools/call {tool}: {}", reply.body);
        reply.only()
    }

    /// Opens a tools/call on a connection of its own, which is left open.
    fn open_call(&self, id: u64, tool: &str) -> TcpStream {
        let body = json!({"jsonrpc": "2.0", "id": id, "method": "tools/call", "params": {"name": tool, "arguments": {}}}).to_string();
        let mut stream = TcpStream::connect(self.addr()).unwrap();
        let mut head = format!("POST /mcp HTTP/1.1\r\nHost: {}\r\nContent-Length: {}\r\n", self.addr(), body.len());
        for (name, value) in self.headers(Some(LEGACY)) {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str("\r\n");
        stream.write_all(head.as_bytes()).unwrap();
        stream.write_all(body.as_bytes()).unwrap();
        stream
    }
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
    assert!(reply.header("mcp-session-id").is_none(), "no sessions");
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
    assert_eq!(names, ["echo", "image", "slow", "hang", "busy", "stale", "timeout"]);
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
    // the only client of that era seen lately: its calls are taken to be its
    assert_eq!(client, Some(ClientTag { name: "raw-legacy".into(), version: "0.1".into() }));

    // an image, its data URL's prefix taken off
    let answer = e.legacy_call(4, "image", json!({})).await;
    assert_eq!(answer["result"]["content"][0], json!({"type": "image", "data": PNG, "mimeType": "image/png"}));

    // a request with no version header is taken as 2025-03-26, and still served
    let reply = http("POST", &e.url("/mcp"), e.headers(None), Some(json!({"jsonrpc": "2.0", "id": 5, "method": "tools/list"}).to_string())).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.only()["result"]["tools"].as_array().unwrap().len(), 7);

    let stats = e.stats.snapshot();
    let seen = stats.clients.iter().find(|c| c.name == "raw-legacy").expect("the client was seen");
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
    assert_eq!(messages.len(), 4, "{}", reply.body);
    for (n, message) in messages[..3].iter().enumerate() {
        assert_eq!(message["method"], "notifications/progress");
        assert_eq!(message["params"]["progressToken"], "p-1");
        assert_eq!(message["params"]["progress"], json!(n as f64 + 1.0));
        assert_eq!(message["params"]["total"], json!(3.0));
        assert_eq!(message["params"]["message"], format!("step {}", n + 1));
    }
    assert_eq!(messages[3]["id"], 7);
    assert_eq!(messages[3]["result"]["content"][0]["text"], "done");
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
    let (head, stream) = tokio::task::spawn_blocking(move || {
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut head = Vec::new();
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            match stream.read(&mut byte) {
                Ok(1) => head.push(byte[0]),
                _ => break,
            }
        }
        (String::from_utf8_lossy(&head).to_lowercase(), stream)
    })
    .await
    .unwrap();
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
    assert_eq!(result["tools"].as_array().unwrap().len(), 7);
    assert!(result["ttlMs"].is_u64() && result["cacheScope"].is_string());

    let args = json!({"layer": "title", "text": "Hi"});
    let reply = e.modern(3, "tools/call", json!({"name": "echo", "arguments": args}), Some("echo")).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let result = &reply.only()["result"];
    assert_eq!(result["resultType"], "complete");
    assert_eq!(result["structuredContent"], args);
    let (_, client, _) = e.bridge.last_call();
    assert_eq!(client, Some(ClientTag { name: "raw-modern".into(), version: "0.2".into() }));
    let seen = e.stats.snapshot().clients.into_iter().find(|c| c.name == "raw-modern").unwrap();
    assert_eq!((seen.protocol.as_str(), seen.calls), (MODERN, 1));
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
    assert!(answer["result"].get("structuredContent").is_none());
    let answer = e.legacy_call(2, "timeout", json!({})).await;
    assert_eq!(answer["result"]["isError"], true);
    assert!(answer["result"]["content"][0]["text"].as_str().unwrap().contains("did not answer in time"));
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
    let token = e.token();
    assert!(!reply.body.contains(&token) && !reply.headers.iter().any(|(_, v)| v.contains(&token)), "the answer gives nothing away");
    assert_eq!(http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(list.clone())).await.status, 200);
    // a new token: the old one is turned away at once
    let old = e.headers(Some(LEGACY));
    *e.secret.write().unwrap() = Secret::generate().unwrap();
    assert_eq!(http("POST", &e.url("/mcp"), old, Some(list.clone())).await.status, 401);
    assert_eq!(http("POST", &e.url("/mcp"), e.headers(Some(LEGACY)), Some(list)).await.status, 200);
    // /health wants none
    assert_eq!(get(&e.url("/health"), vec![]).await.status, 200);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn only_this_computer_by_its_loopback_names() {
    let e = Endpoint::start();
    let list = json!({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}).to_string();
    let with = |extra: &[(&str, &str)]| {
        let mut headers = e.headers(Some(LEGACY));
        headers.extend(extra.iter().map(|(n, v)| (n.to_string(), v.to_string())));
        headers
    };
    for origin in ["https://evil.example", "null", "http://localhost.evil.example:5173"] {
        let reply = http("POST", &e.url("/mcp"), with(&[("Origin", origin)]), Some(list.clone())).await;
        assert_eq!(reply.status, 403, "{origin}");
        assert!(reply.header("access-control-allow-origin").is_none());
    }
    for origin in ["http://localhost:5173", "http://127.0.0.1", "https://[::1]:8443"] {
        assert_eq!(http("POST", &e.url("/mcp"), with(&[("Origin", origin)]), Some(list.clone())).await.status, 200, "{origin}");
    }
    let evil_host = format!("evil.example:{}", e.addr().port());
    assert_eq!(http("POST", &e.url("/mcp"), with(&[("Host", &evil_host)]), Some(list.clone())).await.status, 403);
    assert_eq!(get(&e.url("/health"), vec![("Host".into(), evil_host.clone())]).await.status, 403);
    let localhost = format!("localhost:{}", e.addr().port());
    assert_eq!(http("POST", &e.url("/mcp"), with(&[("Host", &localhost)]), Some(list)).await.status, 200);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn get_and_delete_are_not_served() {
    let e = Endpoint::start();
    let mut headers = e.headers(Some(LEGACY));
    headers.retain(|(n, _)| n != "Accept");
    headers.push(("Accept".into(), "text/event-stream".into()));
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
    // a call in hand when it stops is cancelled, and the stop does not wait for it
    let stream = e.open_call(1, "hang");
    e.bridge.hung().await;
    let stopping = Instant::now();
    assert!(e.running.stop(Duration::from_secs(2)).await, "it stopped in time");
    assert!(stopping.elapsed() < Duration::from_secs(2));
    assert!(e.bridge.let_go_after(stopping).await < Duration::from_secs(1));
    drop(stream);
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

// ---- rmcp's own client, in both eras ----

fn rmcp_transport(e: &Endpoint) -> StreamableHttpClientTransport<reqwest::Client> {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    StreamableHttpClientTransport::with_client(client, StreamableHttpClientTransportConfig::with_uri(e.url("/mcp")).auth_header(e.token()))
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
    assert_eq!(tools.len(), 7);
    assert_eq!(tools[0].name, "echo");
    let result = client.call_tool(CallToolRequestParams::new("echo").with_arguments(args(json!({"a": [1, 2, 3]})))).await.unwrap();
    assert_eq!(result.structured_content, Some(json!({"a": [1, 2, 3]})));
    let result = client.call_tool(CallToolRequestParams::new("image")).await.unwrap();
    assert_eq!(result.content[0].as_image().map(|i| (i.data.as_str(), i.mime_type.as_str())), Some((PNG, "image/png")));
    let result = client.call_tool(CallToolRequestParams::new("busy")).await.unwrap();
    assert_eq!(result.is_error, Some(true));
    assert!(client.call_tool(CallToolRequestParams::new("nope")).await.is_err());
    assert!(e.stats.snapshot().clients.iter().any(|c| c.name == "rmcp-legacy"));
    client.cancel().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn rmcp_client_with_discover() {
    let e = Endpoint::start();
    let lifecycle = ClientLifecycleMode::Discover { preferred_versions: vec![ProtocolVersion::V_2026_07_28] };
    let client = client_config("rmcp-modern").serve_with_lifecycle(rmcp_transport(&e), lifecycle).await.expect("discover");
    assert_eq!(client.peer_info().unwrap().protocol_version, ProtocolVersion::V_2026_07_28);
    let tools = client.list_all_tools().await.unwrap();
    assert_eq!(tools.iter().map(|t| t.name.to_string()).collect::<Vec<_>>(), ["echo", "image", "slow", "hang", "busy", "stale", "timeout"]);
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
    let secret = Arc::new(RwLock::new(Secret::generate().unwrap()));
    let server = McpServer::new(dispatcher.clone(), tools, secret.clone(), Arc::new(Stats::new()));
    let running = server.start(([127, 0, 0, 1], 0).into(), &Handle::current()).unwrap();
    let url = format!("http://{}", running.addr());
    assert_eq!(serde_json::from_str::<Value>(&get(&format!("{url}/health"), vec![]).await.body).unwrap()["page"], "none");

    // the page: echoes, and tells of each cancel it is sent
    let (tx, mut rx) = mpsc::unbounded_channel();
    dispatcher.attach(Box::new(ChannelSink(tx)), "hash");
    let (cancels_tx, mut cancels) = mpsc::unbounded_channel::<(Value, Instant)>();
    let page = {
        let dispatcher = dispatcher.clone();
        tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
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
        ("Authorization".to_string(), format!("Bearer {}", secret.read().unwrap().expose())),
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
    let deadline = Instant::now() + Duration::from_secs(10);
    while dispatcher.calls() == 0 {
        assert!(Instant::now() < deadline, "the call reached the dispatcher");
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
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
