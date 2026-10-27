//! The MCP client: revision 2025-06-18 over streamable HTTP, as the app's endpoint serves it (README_MCP.md,
//! *Protocol*). `initialize` first, the `Mcp-Session-Id` it answers with sent back with every request after it, then
//! `notifications/initialized`; `tools/list`; `tools/call` with a progress token, its progress handed on as it comes.
//! A request is sent from the caller's thread; its answer — its head, then server-sent events or JSON, whichever the
//! endpoint sends — is read on a thread of its own, while the caller watches the clock and Ctrl-C from the moment the
//! request is out: a call given up is cancelled with `notifications/cancelled`, and its connection hung up (which
//! cancels it too, where the notification could not be placed).
//!
//! It is small on purpose: rmcp's client would bring an async runtime and an HTTP stack for what is, here, a few
//! requests to 127.0.0.1.

use std::io::{self, BufRead, BufReader};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

use crate::http::{self, Request, Response, Sent};
use crate::interrupt;

/// The revision asked for.
pub const PROTOCOL: &str = "2025-06-18";
/// What the command line calls itself in `initialize`.
pub const CLIENT_NAME: &str = "smedcover-cli";
/// How often the clock and Ctrl-C are looked at while an answer is awaited.
const TICK: Duration = Duration::from_millis(100);
/// How long a notification (the one after `initialize`, a cancel) may take.
const NOTIFY_TIMEOUT: Duration = Duration::from_secs(3);
/// How long the command line waits for the app to take a cancel before it hangs up.
const CANCEL_WAIT: Duration = Duration::from_secs(1);

/// The `User-Agent` of every request.
pub fn user_agent() -> String {
    format!("{CLIENT_NAME}/{}", env!("CARGO_PKG_VERSION"))
}

/// How far a call has got, as the app says.
#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub progress: f64,
    pub total: Option<f64>,
    pub message: Option<String>,
}

/// Which limit ran out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Limit {
    /// No word from the app for the quiet time.
    Quiet,
    /// The time in all (`--timeout`).
    Total,
}

/// Why a request has no result.
#[derive(Debug, PartialEq)]
pub enum Error {
    /// The request never reached the app whole: nothing listens on the port, or the connection was refused or broken
    /// while it was being sent. Nothing was done.
    Refused(String),
    /// The app answered, but not as MCP does (the token refused, another HTTP status, an answer that could not be
    /// read).
    Unreachable(String),
    /// The endpoint refused the request in JSON-RPC's words (an unknown tool among them).
    Rpc { code: i64, message: String },
    /// Nothing came within the limits: the request was cancelled.
    TimedOut(Limit),
    /// Ctrl-C: the request was cancelled.
    Interrupted,
    /// The connection closed before the answer came: what the request did may or may not be done.
    Gone,
}

/// How long an answer is waited for: `quiet`, from the request or the last word of progress; `total`, in all.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Limits {
    pub quiet: Duration,
    pub total: Duration,
}

impl Limits {
    /// For `initialize` and `tools/list`, which the endpoint answers itself.
    pub const SETUP: Limits = Limits { quiet: Duration::from_secs(30), total: Duration::from_secs(30) };
}

/// A connection to the endpoint, after `initialize`.
pub struct Session {
    port: u16,
    token: String,
    /// The id the endpoint gave in its answer to `initialize`, sent back with every request.
    session: Option<String>,
    /// The revision agreed, for `MCP-Protocol-Version`; none before `initialize` is answered.
    protocol: Option<String>,
    next_id: u64,
    /// How many calls of tools that change something have been sent whole (so may have been carried out).
    changes_sent: usize,
}

/// What the thread reading an answer hands over.
enum Event {
    /// The answer's head came, with this session id.
    Head(Option<String>),
    Progress(Progress),
    Answer(Value),
    /// The app answered otherwise than MCP does.
    Failed(String),
    Closed,
}

impl Session {
    /// Says hello to the endpoint on `port` (`initialize`, `notifications/initialized`), with its token, waiting
    /// [`Limits::SETUP`] for its answer, or `timeout` (`--timeout`) if that is shorter.
    pub fn open(port: u16, token: &str, timeout: Option<Duration>) -> Result<Session, Error> {
        let mut session = Session { port, token: token.to_string(), session: None, protocol: None, next_id: 1, changes_sent: 0 };
        let params = json!({
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": CLIENT_NAME, "version": env!("CARGO_PKG_VERSION")},
        });
        let total = timeout.map_or(Limits::SETUP.total, |t| t.min(Limits::SETUP.total));
        let limits = Limits { quiet: Limits::SETUP.quiet.min(total), total };
        let result = session.request("initialize", params, limits, None)?;
        session.protocol = Some(result.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL).to_string());
        session.notify("notifications/initialized", None)?;
        Ok(session)
    }

    /// How many calls of tools that change something have been sent whole: none, and asking again does nothing twice.
    pub fn changes_sent(&self) -> usize {
        self.changes_sent
    }

    /// Every tool the endpoint lists, as it lists them, page after page.
    pub fn list_tools(&mut self) -> Result<Vec<Value>, Error> {
        let mut tools = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..100 {
            let params = cursor.as_ref().map_or_else(|| json!({}), |c| json!({"cursor": c}));
            let result = self.request("tools/list", params, Limits::SETUP, None)?;
            tools.extend(result.get("tools").and_then(Value::as_array).cloned().unwrap_or_default());
            match result.get("nextCursor").and_then(Value::as_str) {
                Some(next) if !next.is_empty() => cursor = Some(next.to_string()),
                _ => break,
            }
        }
        Ok(tools)
    }

    /// Calls `tool` with `args` (an object), telling `progress` how it gets on; its result as MCP has it
    /// (`content`, `structuredContent`, `isError`, `_meta`). A tool that fails answers a result with `isError`, not
    /// an error. `read_only`: whether the tool only reads (else it is counted among [`Session::changes_sent`] once it is
    /// sent).
    pub fn call_tool(&mut self, tool: &str, args: Value, limits: Limits, read_only: bool, progress: &mut dyn FnMut(&Progress)) -> Result<Value, Error> {
        let changes = !read_only;
        self.request_counted("tools/call", json!({"name": tool, "arguments": args}), limits, changes, Some(progress))
    }

    fn request(&mut self, method: &str, params: Value, limits: Limits, progress: Option<&mut dyn FnMut(&Progress)>) -> Result<Value, Error> {
        self.request_counted(method, params, limits, false, progress)
    }

    /// Sends a request and waits for its answer, as long as `limits` say, handing what progress comes to `progress`
    /// (a request with it names a progress token). Cancelled, and its connection hung up, on Ctrl-C or past the limits
    /// — while its head is awaited too. `changes`: the request may change something, and is counted once it is sent.
    fn request_counted(
        &mut self,
        method: &str,
        params: Value,
        limits: Limits,
        changes: bool,
        mut progress: Option<&mut dyn FnMut(&Progress)>,
    ) -> Result<Value, Error> {
        if interrupt::requested() {
            return Err(Error::Interrupted);
        }
        let id = self.next_id;
        self.next_id += 1;
        let token = format!("{CLIENT_NAME}-{id}");
        let mut params = params;
        if progress.is_some() {
            if let Value::Object(params) = &mut params {
                params.insert("_meta".into(), json!({"progressToken": token}));
            }
        }
        let body = json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}).to_string();
        let (sent, hang_up) = http::start(self.port, &self.post(body.as_bytes()), None).map_err(|e| Error::Refused(e.to_string()))?;
        if changes {
            self.changes_sent += 1;
        }
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || read_answer(sent, id, &token, &tx));
        let started = Instant::now();
        let mut quiet_until = started + limits.quiet;
        let until = started + limits.total;
        let given_up = |session: &Session, why: &str| {
            session.cancel(id, why);
            hang_up.now();
        };
        loop {
            if interrupt::requested() {
                given_up(self, "Interrupted by the user (Ctrl-C).");
                return Err(Error::Interrupted);
            }
            let now = Instant::now();
            if now >= quiet_until.min(until) {
                given_up(self, "The command line's time ran out.");
                return Err(Error::TimedOut(if until <= quiet_until { Limit::Total } else { Limit::Quiet }));
            }
            match rx.recv_timeout((quiet_until.min(until) - now).min(TICK)) {
                Ok(Event::Head(session)) => {
                    if method == "initialize" {
                        self.session = session;
                    }
                }
                Ok(Event::Progress(p)) => {
                    quiet_until = Instant::now() + limits.quiet;
                    if let Some(tell) = progress.as_deref_mut() {
                        tell(&p);
                    }
                }
                Ok(Event::Answer(message)) => return answer_of(message),
                Ok(Event::Failed(why)) => return Err(Error::Unreachable(why)),
                Ok(Event::Closed) | Err(RecvTimeoutError::Disconnected) => return Err(Error::Gone),
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    /// Sends a notification (no answer but 202).
    fn notify(&self, method: &str, params: Option<Value>) -> Result<(), Error> {
        let mut message = json!({"jsonrpc": "2.0", "method": method});
        if let Some(params) = params {
            message["params"] = params;
        }
        let body = message.to_string();
        let (status, _, text) = http::exchange(self.port, &self.post(body.as_bytes()), NOTIFY_TIMEOUT).map_err(|e| Error::Unreachable(e.to_string()))?;
        match status {
            200..=299 => Ok(()),
            _ => Err(Error::Unreachable(refusal(status, &text))),
        }
    }

    /// Tells the endpoint the request `id` is given up (it may already have ended: that is fine), waiting
    /// [`CANCEL_WAIT`] at most for it to take the word: an app that does not answer is hung up on all the same.
    fn cancel(&self, id: u64, why: &str) {
        let body = json!({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": id, "reason": why}}).to_string();
        let (port, headers) = (self.port, self.headers());
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = http::exchange(port, &Request { method: "POST", path: "/mcp", headers, body: body.as_bytes() }, NOTIFY_TIMEOUT);
            let _ = tx.send(());
        });
        let _ = rx.recv_timeout(CANCEL_WAIT);
    }

    /// A POST of `body` to `/mcp`, with the token, the session's id and the revision agreed.
    fn post<'a>(&self, body: &'a [u8]) -> Request<'a> {
        Request { method: "POST", path: "/mcp", headers: self.headers(), body }
    }

    /// The headers of a POST to `/mcp`.
    fn headers(&self) -> Vec<(&'static str, String)> {
        let mut headers = vec![
            ("Authorization", format!("Bearer {}", self.token)),
            ("Content-Type", "application/json".to_string()),
            ("Accept", "application/json, text/event-stream".to_string()),
            ("User-Agent", user_agent()),
        ];
        if let Some(protocol) = &self.protocol {
            headers.push(("MCP-Protocol-Version", protocol.clone()));
        }
        if let Some(session) = &self.session {
            headers.push(("Mcp-Session-Id", session.clone()));
        }
        headers
    }
}

/// What a refusal says, in a line (never the request, which holds the token).
fn refusal(status: u16, body: &[u8]) -> String {
    if status == 401 {
        return "the app refused the command line's token (HTTP 401): the cli.json it was read from is not that app's".into();
    }
    let text = String::from_utf8_lossy(body);
    let text: String = text.trim().chars().take(300).collect();
    if text.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {text}")
    }
}

/// The result of a JSON-RPC answer, or its error.
fn answer_of(message: Value) -> Result<Value, Error> {
    if let Some(error) = message.get("error") {
        return Err(Error::Rpc {
            code: error.get("code").and_then(Value::as_i64).unwrap_or(0),
            message: error.get("message").and_then(Value::as_str).unwrap_or("").to_string(),
        });
    }
    Ok(message.get("result").cloned().unwrap_or_else(|| Value::Object(Map::new())))
}

/// Reads the answer to request `id`: its head (a refusal said as one), then its events or JSON, handing over progress
/// for `token` as it comes, then the answer.
fn read_answer(sent: Sent, id: u64, token: &str, tx: &Sender<Event>) {
    let response = match sent.answer() {
        Ok(response) => response,
        Err(_) => {
            let _ = tx.send(Event::Closed);
            return;
        }
    };
    if response.status != 200 {
        let status = response.status;
        let body = response.bytes().unwrap_or_default();
        let _ = tx.send(Event::Failed(refusal(status, &body)));
        return;
    }
    let _ = tx.send(Event::Head(response.header("mcp-session-id").map(str::to_string)));
    read_messages(response, id, token, tx);
}

fn read_messages(response: Response, id: u64, token: &str, tx: &Sender<Event>) {
    let kind = response.header("content-type").unwrap_or("").to_ascii_lowercase();
    let mut take = |message: Value| -> bool { take_message(message, id, token, tx) };
    let answered = if kind.starts_with("text/event-stream") {
        read_events(BufReader::new(response), |data| serde_json::from_str::<Value>(data).is_ok_and(&mut take))
    } else if kind.starts_with("application/json") {
        response.bytes().and_then(|body| serde_json::from_slice::<Value>(&body).map_err(io::Error::other)).map(&mut take)
    } else {
        let _ = tx.send(Event::Failed(format!("the app answered with {kind:?}, neither JSON nor events")));
        return;
    };
    if !matches!(answered, Ok(true)) {
        let _ = tx.send(Event::Closed);
    }
}

/// Hands on one JSON-RPC message (or each of a batch); whether it was the answer.
fn take_message(message: Value, id: u64, token: &str, tx: &Sender<Event>) -> bool {
    if let Value::Array(batch) = message {
        // every message of it handed on, whichever is the answer
        let mut answered = false;
        for m in batch {
            answered |= take_message(m, id, token, tx);
        }
        return answered;
    }
    if let Some(method) = message.get("method").and_then(Value::as_str) {
        if method == "notifications/progress" {
            let params = &message["params"];
            let for_us = match &params["progressToken"] {
                Value::String(t) => t == token,
                other => other.as_u64().is_some_and(|n| n.to_string() == token),
            };
            if for_us {
                let _ = tx.send(Event::Progress(Progress {
                    progress: params["progress"].as_f64().unwrap_or(0.0),
                    total: params["total"].as_f64(),
                    message: params["message"].as_str().map(str::to_string),
                }));
            }
        }
        // the endpoint's other notifications (and any request of its own) are not for the command line
        return false;
    }
    let ours = match &message["id"] {
        Value::Number(n) => n.as_u64() == Some(id),
        Value::String(s) => s == &id.to_string(),
        _ => false,
    };
    if ours && (message.get("result").is_some() || message.get("error").is_some()) {
        let _ = tx.send(Event::Answer(message));
        return true;
    }
    false
}

/// Reads server-sent events, handing each event's data to `on_data` until it says that was the last wanted (`true`)
/// or the stream ends (`false`). Comments (the keep-alives) and the other fields are passed over.
pub fn read_events(mut reader: impl BufRead, mut on_data: impl FnMut(&str) -> bool) -> io::Result<bool> {
    let mut data = String::new();
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            // an event not ended by an empty line is not dispatched
            return Ok(false);
        }
        let l = line.strip_suffix('\n').unwrap_or(&line);
        let l = l.strip_suffix('\r').unwrap_or(l);
        if l.is_empty() {
            if !data.is_empty() && on_data(&data) {
                return Ok(true);
            }
            data.clear();
            continue;
        }
        if l.starts_with(':') {
            continue;
        }
        let (field, value) = match l.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (l, ""),
        };
        if field == "data" {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read, Write};
    use std::net::TcpListener;

    fn events(text: &str) -> (Vec<String>, bool) {
        let mut seen = Vec::new();
        let ended = read_events(Cursor::new(text.as_bytes().to_vec()), |d| {
            seen.push(d.to_string());
            d == "last"
        })
        .unwrap();
        (seen, ended)
    }

    #[test]
    fn reads_events() {
        let (seen, ended) = events(": keep-alive\n\nevent: message\nid: 0\ndata: {\"a\":1}\n\ndata:two\r\ndata: lines\r\n\r\nretry: 3000\n\n");
        assert_eq!(seen, ["{\"a\":1}", "two\nlines"]);
        assert!(!ended);
        let (seen, ended) = events("data: first\n\ndata: last\n\ndata: never\n\n");
        assert_eq!(seen, ["first", "last"]);
        assert!(ended);
        // cut off before its empty line: not an event
        assert_eq!(events("data: half").0, Vec::<String>::new());
    }

    fn taken(message: Value) -> (bool, Vec<Event>) {
        let (tx, rx) = mpsc::channel();
        let answered = take_message(message, 3, "smedcover-cli-3", &tx);
        drop(tx);
        (answered, rx.iter().collect())
    }

    #[test]
    fn hands_on_progress_for_its_token_and_its_own_answer() {
        let (answered, got) = taken(json!({"jsonrpc": "2.0", "method": "notifications/progress",
            "params": {"progressToken": "smedcover-cli-3", "progress": 2, "total": 5, "message": "Writing a.png (2 of 5)."}}));
        assert!(!answered);
        match got.as_slice() {
            [Event::Progress(p)] => assert_eq!(p, &Progress { progress: 2.0, total: Some(5.0), message: Some("Writing a.png (2 of 5).".into()) }),
            _ => panic!("one word of progress"),
        }
        // another token's, a log message, an answer to another request: none of them
        for other in [
            json!({"method": "notifications/progress", "params": {"progressToken": "other", "progress": 1}}),
            json!({"method": "notifications/message", "params": {"level": "info", "data": "x"}}),
            json!({"jsonrpc": "2.0", "id": 2, "result": {}}),
        ] {
            let (answered, got) = taken(other);
            assert!(!answered && got.is_empty());
        }
        let (answered, got) = taken(json!({"jsonrpc": "2.0", "id": 3, "result": {"content": []}}));
        assert!(answered && matches!(got.as_slice(), [Event::Answer(_)]));
        // in a batch too
        let (answered, got) = taken(json!([{"method": "notifications/progress", "params": {"progressToken": "smedcover-cli-3", "progress": 1}}, {"id": 3, "error": {"code": -32602, "message": "no"}}]));
        assert!(answered && got.len() == 2);
    }

    #[test]
    fn reads_an_answer_or_its_error() {
        assert_eq!(answer_of(json!({"id": 1, "result": {"tools": []}})), Ok(json!({"tools": []})));
        assert_eq!(
            answer_of(json!({"id": 1, "error": {"code": -32602, "message": "Unknown tool: nope"}})),
            Err(Error::Rpc { code: -32602, message: "Unknown tool: nope".into() })
        );
    }

    #[test]
    fn a_refusal_never_says_more_than_a_line() {
        assert!(refusal(401, b"whatever").starts_with("the app refused the command line's token (HTTP 401)"));
        assert_eq!(refusal(403, b"  Forbidden: Host header is not allowed\n"), "HTTP 403: Forbidden: Host header is not allowed");
        assert_eq!(refusal(500, b""), "HTTP 500");
        assert_eq!(refusal(500, "x".repeat(1000).as_bytes()).len(), "HTTP 500: ".len() + 300);
    }

    #[test]
    fn a_port_no_one_listens_on_is_refused_and_nothing_counted() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(matches!(Session::open(port, "t", None), Err(Error::Refused(_))));
    }

    /// An endpoint that takes the request and never answers it: the limits still hold while its head is awaited.
    #[test]
    fn the_limits_hold_while_the_head_is_awaited() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let mut held = Vec::new();
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut buf = [0u8; 4096];
                let _ = stream.read(&mut buf);
                if buf.starts_with(b"POST /mcp") && String::from_utf8_lossy(&buf).contains("notifications/") {
                    let _ = stream.write_all(b"HTTP/1.1 202 Accepted\r\nContent-Length: 0\r\n\r\n");
                } else {
                    held.push(stream);
                }
            }
        });
        let mut session = Session { port, token: "t".into(), session: None, protocol: None, next_id: 1, changes_sent: 0 };
        let started = Instant::now();
        let limits = Limits { quiet: Duration::from_secs(30), total: Duration::from_millis(400) };
        let got = session.call_tool("get_context", json!({}), limits, true, &mut |_| {});
        assert_eq!(got, Err(Error::TimedOut(Limit::Total)));
        assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
        assert_eq!(session.changes_sent(), 0, "a read is not counted");
        let limits = Limits { quiet: Duration::from_millis(300), total: Duration::from_secs(30) };
        assert_eq!(session.call_tool("export", json!({}), limits, false, &mut |_| {}), Err(Error::TimedOut(Limit::Quiet)));
        assert_eq!(session.changes_sent(), 1, "a change, sent whole, is");
    }
}
