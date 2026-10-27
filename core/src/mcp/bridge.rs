//! Handing a tool call to the page and its answer back. The endpoint sees only a [`PageBridge`];
//! the [`Dispatcher`] is the one both hosts use, sending each call down whatever reaches their page
//! (a [`PageSink`]: the desktop app's Tauri channel, a server's WebSocket) and routing the page's
//! answers and word of progress back to the call that waits for them.
//!
//! What goes to the page, one JSON message each:
//!
//! ```json
//! {"kind": "call", "id": 17, "tool": "set_text", "args": {…}, "client": {"name": "claude-code", "version": "2.3.1"}, "timeoutMs": 60000}
//! {"kind": "cancel", "id": 17}
//! {"kind": "status", "status": {…}}
//! ```
//!
//! (`client` is left out when the caller is not known.) What comes back, through the host's
//! commands: a [`PageReply`], `{"id": 17, "ok": true, "result": {"content": [Block…], "structuredContent"?, "isError"?}}`
//! or `{"id": 17, "ok": false, "error": {"code": "busy", "message": "…"}}`, where a block is
//! `{"type": "text", "text": "…"}` or `{"type": "image", "data": "<base64>", "mimeType": "image/png"}`
//! (or `image/jpeg`, `image/webp`; either may carry `annotations`); and a [`PageProgress`],
//! `{"id": 17, "progress": 3, "total"?: 10, "message"?: "…"}`. The page's error codes are
//! `unknown_tool`, `invalid_arguments`, `not_allowed`, `busy`, `unavailable` and `failed`.
//!
//! What is done to a result before it goes on (see [`read_result`]): a `data:…;base64,` prefix is
//! taken off an image's data; a text block holding `structuredContent` as JSON is added if there is
//! no text block; `structuredContent` that is not an object (MCP wants one) is dropped, its JSON kept
//! as that text; one of more than [`MAX_IMAGES`] images or [`MAX_RESULT_BYTES`] is refused.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

/// What a call resolves with, as MCP has it (re-exported for a host that wraps a [`PageBridge`]).
pub use rmcp::model::CallToolResult;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tokio::sync::{oneshot, watch, Notify};
use tokio::time::{sleep_until, Instant};
use tokio_util::sync::CancellationToken;

/// A boxed future, as a trait object's method returns one.
pub type BoxFut<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Told how a call is getting on.
pub type ProgressFn = Arc<dyn Fn(Progress) + Send + Sync>;

/// The most calls the page is given, or waited for, at once.
pub const MAX_CALLS: usize = 16;
/// The most images a result may carry.
pub const MAX_IMAGES: usize = 16;
/// The most a result's text and image data may come to.
pub const MAX_RESULT_BYTES: usize = 48 * 1024 * 1024;
/// The kinds of image a result may carry.
pub const IMAGE_TYPES: [&str; 3] = ["image/png", "image/jpeg", "image/webp"];

/// What the endpoint hands its tool calls to.
pub trait PageBridge: Send + Sync + 'static {
    /// Carries out `call` on the page; resolves once the page has answered, or it could not.
    fn call(&self, call: Call) -> BoxFut<'_, Result<CallToolResult, BridgeError>>;
    /// Whether there is a page to carry out calls.
    fn page(&self) -> PageState;
}

/// Whether there is a page to carry out calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageState {
    /// None, and none is expected (no window, no browser connected): calls fail at once.
    None,
    /// One is on its way (the window is starting or reloading): calls wait for it.
    Loading,
    /// One is ready; each page that attaches has a new epoch.
    Ready { epoch: u64 },
}

impl PageState {
    /// `"none"`, `"loading"` or `"ready"`.
    pub fn as_str(&self) -> &'static str {
        match self {
            PageState::None => "none",
            PageState::Loading => "loading",
            PageState::Ready { .. } => "ready",
        }
    }
}

/// Which client made a call, as it says.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClientTag {
    pub name: String,
    pub version: String,
}

/// How far a call has got, as the page says.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Progress {
    pub progress: f64,
    pub total: Option<f64>,
    pub message: Option<String>,
}

/// One tool call.
pub struct Call {
    pub tool: String,
    pub args: Map<String, Value>,
    pub client: Option<ClientTag>,
    /// How long the page may go without answering or saying how far it has got.
    pub timeout: Duration,
    /// Told each time the page says it has got further.
    pub progress: Option<ProgressFn>,
    /// Cancelled when the client gives up on the call.
    pub cancel: CancellationToken,
}

/// Why a call has no answer from the page, or the page's own error.
#[derive(Clone, Debug, PartialEq)]
pub enum BridgeError {
    /// There was no page to carry it out, and none was on its way or came in time.
    NotReady,
    /// The page went away (reloaded, closed) before it answered; says why.
    PageGone(String),
    /// The page went quiet for longer than the tool's timeout, or the call ran over the ceiling.
    Timeout,
    /// The client gave up on it.
    Cancelled,
    /// Already [`MAX_CALLS`] calls in hand.
    TooMany,
    /// The page's answer could not be read; says why.
    Malformed(String),
    /// The page could not do it: its code and its message.
    Page { code: String, message: String },
}

impl BridgeError {
    /// A short code for the kind of failure: the page's own code for [`BridgeError::Page`].
    pub fn code(&self) -> &str {
        match self {
            BridgeError::NotReady => "not_ready",
            BridgeError::PageGone(_) => "gone",
            BridgeError::Timeout => "timeout",
            BridgeError::Cancelled => "cancelled",
            BridgeError::TooMany => "too_many",
            BridgeError::Malformed(_) => "malformed",
            BridgeError::Page { code, .. } => code,
        }
    }
}

impl fmt::Display for BridgeError {
    /// What the agent is told.
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BridgeError::NotReady => f.write_str(
                "SmedCover's window is not ready (starting, reloading, or showing the first-start welcome). Try again in a moment.",
            ),
            BridgeError::PageGone(why) => {
                write!(f, "SmedCover's window went away before it answered ({why}); the change may or may not have been applied.")
            }
            BridgeError::Timeout => {
                f.write_str("SmedCover did not answer in time, so the call was given up; the change may or may not have been applied.")
            }
            BridgeError::Cancelled => f.write_str("The call was cancelled."),
            BridgeError::TooMany => {
                write!(f, "SmedCover is already working on {MAX_CALLS} calls; try again when one has finished.")
            }
            BridgeError::Malformed(why) => write!(f, "SmedCover's answer could not be read: {why}."),
            BridgeError::Page { message, .. } => f.write_str(message),
        }
    }
}

impl std::error::Error for BridgeError {}

/// What reaches the page: the desktop app's Tauri channel, a server's WebSocket.
///
/// [`PageSink::send`] is called with the [`Dispatcher`]'s lock on its page held, so it must hand
/// the message on and return (queue it, never wait for the page to take it) and must not call back
/// into the dispatcher.
pub trait PageSink: Send + Sync {
    /// Sends one message without waiting; fails if the page cannot be reached.
    fn send(&self, msg: &Value) -> Result<(), String>;
}

/// The page's answer to a call.
#[derive(Debug, Deserialize)]
pub struct PageReply {
    pub id: u64,
    pub ok: bool,
    #[serde(default)]
    pub result: Option<Value>,
    #[serde(default)]
    pub error: Option<PageError>,
}

/// Why the page could not do a call.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PageError {
    pub code: String,
    pub message: String,
}

/// The page's word on how far a call has got.
#[derive(Debug, Deserialize)]
pub struct PageProgress {
    pub id: u64,
    pub progress: f64,
    #[serde(default)]
    pub total: Option<f64>,
    #[serde(default)]
    pub message: Option<String>,
}

/// How long the [`Dispatcher`] waits, and for how many calls.
#[derive(Clone, Debug)]
pub struct Limits {
    /// How long a call waits for a page that is on its way ([`PageState::Loading`]) before
    /// [`BridgeError::NotReady`].
    pub ready_wait: Duration,
    /// The longest a call may take from when the page is given it, whatever its progress.
    pub ceiling: Duration,
    /// The most calls in hand at once, waiting for a page or for its answer.
    pub max_calls: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { ready_wait: Duration::from_secs(30), ceiling: super::tools::MAX_TIMEOUT, max_calls: MAX_CALLS }
    }
}

struct Pending {
    answer: oneshot::Sender<Result<CallToolResult, BridgeError>>,
    progress: Option<ProgressFn>,
    /// Woken by each word of progress, which starts the call's timeout again.
    poke: Arc<Notify>,
    /// The last progress passed on: only more is.
    last: Option<f64>,
}

struct Attached {
    sink: Box<dyn PageSink>,
    tools_hash: String,
}

/// Hands calls to the page that is attached, and its answers back. Every page that attaches gets
/// the calls made from then on; one that goes takes the calls it had with it, which fail.
pub struct Dispatcher {
    limits: Limits,
    next_id: AtomicU64,
    epochs: AtomicU64,
    calls: AtomicUsize,
    state: watch::Sender<PageState>,
    // taken before `pending` where both are
    page: Mutex<Option<Attached>>,
    pending: Mutex<HashMap<u64, Pending>>,
}

impl Default for Dispatcher {
    fn default() -> Self {
        Dispatcher::new()
    }
}

impl Dispatcher {
    /// No page, and none on its way (calls fail at once until a host says one is coming with
    /// [`Dispatcher::loading`], or one attaches), with the usual [`Limits`].
    pub fn new() -> Dispatcher {
        Dispatcher::with_limits(Limits::default())
    }

    pub fn with_limits(limits: Limits) -> Dispatcher {
        Dispatcher {
            limits,
            next_id: AtomicU64::new(0),
            epochs: AtomicU64::new(0),
            calls: AtomicUsize::new(0),
            state: watch::Sender::new(PageState::None),
            page: Mutex::new(None),
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// A page is ready to carry out calls, built with the `tools.json` whose hash is `tools_hash`.
    /// Returns its epoch. A page attached before it is let go, its calls failing.
    pub fn attach(&self, sink: Box<dyn PageSink>, tools_hash: &str) -> u64 {
        let mut page = lock(&self.page);
        let epoch = self.epochs.fetch_add(1, Ordering::SeqCst) + 1;
        if page.replace(Attached { sink, tools_hash: tools_hash.to_string() }).is_some() {
            self.fail_pending("another page took its place");
        }
        self.state.send_replace(PageState::Ready { epoch });
        epoch
    }

    /// The page went and another is on its way (the window reloads): its calls fail with `why`, and
    /// calls made from now wait for the next page.
    pub fn detach(&self, why: &str) {
        self.let_go(why, PageState::Loading);
    }

    /// The page went and none is expected (the window closed, the app quits): as
    /// [`Dispatcher::detach`], but the state is [`PageState::None`].
    pub fn close(&self, why: &str) {
        self.let_go(why, PageState::None);
    }

    /// A page is on its way (the window is starting): calls wait for it, as they would anyway.
    pub fn loading(&self) {
        let page = lock(&self.page);
        if page.is_none() {
            self.state.send_replace(PageState::Loading);
        }
    }

    fn let_go(&self, why: &str, state: PageState) {
        let mut page = lock(&self.page);
        page.take();
        self.state.send_replace(state);
        self.fail_pending(why);
    }

    fn fail_pending(&self, why: &str) {
        let gone: Vec<Pending> = lock(&self.pending).drain().map(|(_, p)| p).collect();
        for p in gone {
            let _ = p.answer.send(Err(BridgeError::PageGone(why.to_string())));
        }
    }

    /// The page's answer to a call. `false` if no call waits for it (it was cancelled, timed out,
    /// or belonged to a page that went).
    pub fn reply(&self, reply: PageReply) -> bool {
        let Some(p) = lock(&self.pending).remove(&reply.id) else {
            return false;
        };
        let _ = p.answer.send(read_reply(reply));
        true
    }

    /// The page's word on how far a call has got: it starts the call's timeout again, and is passed
    /// on if it is more than the last. `false` if no call waits for it.
    pub fn progress(&self, progress: PageProgress) -> bool {
        let tell = {
            let mut pending = lock(&self.pending);
            let Some(p) = pending.get_mut(&progress.id) else {
                return false;
            };
            p.poke.notify_one();
            let more = progress.progress.is_finite() && p.last.is_none_or(|last| progress.progress > last);
            if more {
                p.last = Some(progress.progress);
            }
            p.progress.clone().filter(|_| more)
        };
        if let Some(tell) = tell {
            let total = progress.total.filter(|t| t.is_finite());
            tell(Progress { progress: progress.progress, total, message: progress.message });
        }
        true
    }

    /// Sends the endpoint's status to the page, if one is attached.
    pub fn send_status(&self, status: Value) -> bool {
        let page = lock(&self.page);
        page.as_ref().is_some_and(|p| p.sink.send(&json!({"kind": "status", "status": status})).is_ok())
    }

    /// The hash of the `tools.json` the attached page was built with.
    pub fn page_tools_hash(&self) -> Option<String> {
        lock(&self.page).as_ref().map(|p| p.tools_hash.clone())
    }

    /// Whether there is a page, and each change to it.
    pub fn watch_page(&self) -> watch::Receiver<PageState> {
        self.state.subscribe()
    }

    /// The calls in hand: waiting for a page, or for its answer.
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    async fn run(&self, call: Call) -> Result<CallToolResult, BridgeError> {
        if call.cancel.is_cancelled() {
            return Err(BridgeError::Cancelled);
        }
        let _slot = Slot::take(&self.calls, self.limits.max_calls).ok_or(BridgeError::TooMany)?;
        let ready_by = Instant::now() + self.limits.ready_wait;
        let mut state = self.state.subscribe();
        let (id, answer, poke) = loop {
            // a page that is on its way is waited for; with none expected, there is no point
            let settled = async {
                state.wait_for(|s| *s != PageState::Loading).await.map(|s| matches!(*s, PageState::Ready { .. })).unwrap_or(false)
            };
            tokio::select! {
                biased;
                _ = call.cancel.cancelled() => return Err(BridgeError::Cancelled),
                ready = tokio::time::timeout_at(ready_by, settled) => {
                    if ready != Ok(true) {
                        return Err(BridgeError::NotReady);
                    }
                }
            }
            if let Some(sent) = self.send_call(&call)? {
                break sent;
            }
            // the page went between being ready and being given the call: wait for the next
        };
        let mut guard = PendingGuard { dispatcher: self, id, armed: true };
        let ceiling = Instant::now() + self.limits.ceiling;
        let mut quiet_until = Instant::now() + call.timeout;
        tokio::pin!(answer);
        loop {
            tokio::select! {
                biased;
                answer = &mut answer => {
                    guard.armed = false;
                    return answer.unwrap_or_else(|_| Err(BridgeError::PageGone("SmedCover stopped".into())));
                }
                _ = call.cancel.cancelled() => return Err(BridgeError::Cancelled),
                _ = poke.notified() => quiet_until = Instant::now() + call.timeout,
                _ = sleep_until(quiet_until.min(ceiling)) => return Err(BridgeError::Timeout),
            }
        }
    }

    /// Gives the attached page the call, and keeps it till answered; `None` if no page is attached.
    #[allow(clippy::type_complexity)]
    fn send_call(
        &self,
        call: &Call,
    ) -> Result<Option<(u64, oneshot::Receiver<Result<CallToolResult, BridgeError>>, Arc<Notify>)>, BridgeError> {
        let page = lock(&self.page);
        let Some(page) = page.as_ref() else {
            return Ok(None);
        };
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (answer, answered) = oneshot::channel();
        let poke = Arc::new(Notify::new());
        lock(&self.pending).insert(id, Pending { answer, progress: call.progress.clone(), poke: poke.clone(), last: None });
        let mut msg = json!({"kind": "call", "id": id, "tool": call.tool, "args": call.args, "timeoutMs": millis(call.timeout)});
        if let Some(client) = &call.client {
            msg["client"] = json!(client);
        }
        if page.sink.send(&msg).is_err() {
            // the page cannot be reached: it was never given the call
            lock(&self.pending).remove(&id);
            return Err(BridgeError::NotReady);
        }
        Ok(Some((id, answered, poke)))
    }

    fn cancel(&self, id: u64) {
        if lock(&self.pending).remove(&id).is_some() {
            if let Some(page) = lock(&self.page).as_ref() {
                let _ = page.sink.send(&json!({"kind": "cancel", "id": id}));
            }
        }
    }
}

impl PageBridge for Dispatcher {
    fn call(&self, call: Call) -> BoxFut<'_, Result<CallToolResult, BridgeError>> {
        Box::pin(self.run(call))
    }

    fn page(&self) -> PageState {
        *self.state.borrow()
    }
}

/// A call given to the page and not yet answered: if the caller stops waiting (cancelled, timed
/// out, or dropped), the page is told to stop and a late answer is ignored.
struct PendingGuard<'a> {
    dispatcher: &'a Dispatcher,
    id: u64,
    armed: bool,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        if self.armed {
            self.dispatcher.cancel(self.id);
        }
    }
}

/// One of the calls in hand, counted while it lives.
struct Slot<'a>(&'a AtomicUsize);

impl<'a> Slot<'a> {
    fn take(calls: &'a AtomicUsize, max: usize) -> Option<Slot<'a>> {
        calls.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| (n < max).then_some(n + 1)).ok().map(|_| Slot(calls))
    }
}

impl Drop for Slot<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // nothing here panics while holding a lock, but a poisoned map is still a sound one
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

fn millis(d: Duration) -> u64 {
    u64::try_from(d.as_millis()).unwrap_or(u64::MAX)
}

fn read_reply(reply: PageReply) -> Result<CallToolResult, BridgeError> {
    if !reply.ok {
        return match reply.error {
            Some(PageError { code, message }) => Err(BridgeError::Page { code, message }),
            None => Err(BridgeError::Malformed("it failed without saying why".into())),
        };
    }
    match reply.result {
        Some(result) => read_result(result),
        None => Err(BridgeError::Malformed("it has no result".into())),
    }
}

/// The page's result as a `CallToolResult`, with what is done to every result done (see the
/// module's notes).
pub fn read_result(result: Value) -> Result<CallToolResult, BridgeError> {
    let bad = |why: String| Err(BridgeError::Malformed(why));
    let Value::Object(mut result) = result else {
        return bad("the result is not an object".into());
    };
    let mut content = match result.remove("content") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(blocks)) => blocks,
        Some(_) => return bad("its content is not a list".into()),
    };
    let (mut images, mut bytes, mut texts) = (0, 0, 0);
    for block in content.iter_mut() {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                let Some(text) = block.get("text").and_then(Value::as_str) else {
                    return bad("a text block has no text".into());
                };
                texts += 1;
                bytes += text.len();
            }
            Some("image") => {
                images += 1;
                let Some(data) = block.get("data").and_then(Value::as_str) else {
                    return bad("an image block has no data".into());
                };
                let data = strip_data_url(data).to_string();
                bytes += data.len();
                block["data"] = Value::String(data);
                let mime = block.get("mimeType").and_then(Value::as_str).unwrap_or("none");
                if !IMAGE_TYPES.contains(&mime) {
                    return bad(format!("an image of type {mime} (PNG, JPEG or WebP only)"));
                }
            }
            other => return bad(format!("a block of type {}", other.unwrap_or("none"))),
        }
    }
    if images > MAX_IMAGES {
        return bad(format!("it has {images} images, more than {MAX_IMAGES}"));
    }
    // MCP's structured content is an object: anything else is dropped, but kept as text
    let structured = result.get("structuredContent").map(|v| (v.is_object(), v.to_string()));
    if let Some((is_object, text)) = structured {
        if !is_object {
            result.remove("structuredContent");
        } else {
            bytes += text.len();
        }
        if texts == 0 && text != "null" {
            bytes += text.len();
            content.push(json!({"type": "text", "text": text}));
        }
    }
    if bytes > MAX_RESULT_BYTES {
        return bad(format!("it is bigger than {} MB", MAX_RESULT_BYTES / (1024 * 1024)));
    }
    result.insert("content".into(), Value::Array(content));
    serde_json::from_value(Value::Object(result)).map_err(|e| BridgeError::Malformed(e.to_string()))
}

/// Image data without the `data:…;base64,` in front a page may leave on it.
fn strip_data_url(data: &str) -> &str {
    match data.strip_prefix("data:").and_then(|rest| rest.split_once(',')) {
        Some((head, body)) if head.ends_with(";base64") => body,
        _ => data,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A page that keeps what it is sent, and can be made unreachable.
    #[derive(Clone, Default)]
    struct FakeSink {
        sent: Arc<Mutex<Vec<Value>>>,
        broken: Arc<std::sync::atomic::AtomicBool>,
    }

    impl PageSink for FakeSink {
        fn send(&self, msg: &Value) -> Result<(), String> {
            if self.broken.load(Ordering::SeqCst) {
                return Err("gone".into());
            }
            self.sent.lock().unwrap().push(msg.clone());
            Ok(())
        }
    }

    impl FakeSink {
        fn sent(&self) -> Vec<Value> {
            self.sent.lock().unwrap().clone()
        }
        fn of_kind(&self, kind: &str) -> Vec<Value> {
            self.sent().into_iter().filter(|m| m["kind"] == kind).collect()
        }
        fn call_ids(&self) -> Vec<u64> {
            self.of_kind("call").iter().map(|m| m["id"].as_u64().unwrap()).collect()
        }
        fn last_id(&self) -> u64 {
            *self.call_ids().last().expect("a call was sent")
        }
    }

    fn call(tool: &str, timeout: Duration) -> Call {
        let mut args = Map::new();
        args.insert("n".into(), json!(1));
        Call {
            tool: tool.into(),
            args,
            client: Some(ClientTag { name: "test-client".into(), version: "1.0".into() }),
            timeout,
            progress: None,
            cancel: CancellationToken::new(),
        }
    }

    fn ok_reply(id: u64, text: &str) -> PageReply {
        serde_json::from_value(json!({"id": id, "ok": true, "result": {"content": [{"type": "text", "text": text}]}})).unwrap()
    }

    fn text_of(result: &CallToolResult) -> String {
        result.content[0].as_text().unwrap().text.clone()
    }

    fn attached() -> (Arc<Dispatcher>, FakeSink) {
        let d = Arc::new(Dispatcher::new());
        let sink = FakeSink::default();
        d.attach(Box::new(sink.clone()), "hash");
        (d, sink)
    }

    fn spawn_call(d: &Arc<Dispatcher>, c: Call) -> tokio::task::JoinHandle<Result<CallToolResult, BridgeError>> {
        let d = d.clone();
        tokio::spawn(async move { d.call(c).await })
    }

    /// Lets the spawned calls run till they wait (the clock is paused, so no time passes).
    async fn settle() {
        for _ in 0..10 {
            tokio::task::yield_now().await;
        }
    }

    const MINUTE: Duration = Duration::from_secs(60);

    /// Whether `took` is `expected`, give or take the timer's millisecond.
    fn about(took: Duration, expected: Duration) -> bool {
        took >= expected && took < expected + Duration::from_millis(5)
    }

    #[tokio::test(start_paused = true)]
    async fn answers_go_to_their_calls() {
        let (d, sink) = attached();
        assert_eq!(d.page(), PageState::Ready { epoch: 1 });
        assert_eq!(d.page_tools_hash().as_deref(), Some("hash"));
        let a = spawn_call(&d, call("first", MINUTE));
        settle().await;
        let mut second = call("second", Duration::from_millis(1500));
        second.client = None;
        let b = spawn_call(&d, second);
        settle().await;
        let calls = sink.of_kind("call");
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0]["tool"], "first");
        assert_eq!(calls[0]["args"], json!({"n": 1}));
        assert_eq!(calls[0]["client"], json!({"name": "test-client", "version": "1.0"}));
        assert_eq!(calls[0]["timeoutMs"], 60000);
        assert!(calls[1].get("client").is_none(), "an unknown client is left out");
        assert_eq!(calls[1]["timeoutMs"], 1500);
        let (ida, idb) = (calls[0]["id"].as_u64().unwrap(), calls[1]["id"].as_u64().unwrap());
        assert_ne!(ida, idb);
        assert_eq!(d.calls(), 2);
        // answered the other way round
        assert!(d.reply(ok_reply(idb, "to second")));
        assert!(d.reply(ok_reply(ida, "to first")));
        assert_eq!(text_of(&a.await.unwrap().unwrap()), "to first");
        assert_eq!(text_of(&b.await.unwrap().unwrap()), "to second");
        assert_eq!(d.calls(), 0);
        // answered twice, or never asked
        assert!(!d.reply(ok_reply(ida, "again")));
        assert!(!d.reply(ok_reply(999, "who?")));
        assert!(sink.of_kind("cancel").is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn the_pages_error_comes_back_as_its_own() {
        let (d, sink) = attached();
        let task = spawn_call(&d, call("set_text", MINUTE));
        settle().await;
        let reply = json!({"id": sink.last_id(), "ok": false, "error": {"code": "busy", "message": "SmedCover is busy: exporting."}});
        assert!(d.reply(serde_json::from_value(reply).unwrap()));
        let e = task.await.unwrap().unwrap_err();
        assert_eq!(e, BridgeError::Page { code: "busy".into(), message: "SmedCover is busy: exporting.".into() });
        assert_eq!(e.code(), "busy");
        assert_eq!(e.to_string(), "SmedCover is busy: exporting.");
    }

    #[tokio::test(start_paused = true)]
    async fn detach_fails_what_the_page_had() {
        let (d, sink) = attached();
        let task = spawn_call(&d, call("export", MINUTE));
        settle().await;
        let id = sink.last_id();
        d.detach("the window reloaded");
        assert_eq!(d.page(), PageState::Loading);
        assert_eq!(d.page_tools_hash(), None);
        let e = task.await.unwrap().unwrap_err();
        assert_eq!(e, BridgeError::PageGone("the window reloaded".into()));
        assert!(e.to_string().contains("may or may not have been applied"));
        // the old page's answer is no one's
        assert!(!d.reply(ok_reply(id, "late")));
        // a new page has a new epoch; closing leaves none
        assert_eq!(d.attach(Box::new(FakeSink::default()), "hash"), 2);
        d.close("the window closed");
        assert_eq!(d.page(), PageState::None);
    }

    #[tokio::test(start_paused = true)]
    async fn a_page_attaching_again_fails_what_the_last_had() {
        let (d, _sink) = attached();
        let task = spawn_call(&d, call("export", MINUTE));
        settle().await;
        let next = FakeSink::default();
        assert_eq!(d.attach(Box::new(next.clone()), "other"), 2);
        assert!(matches!(task.await.unwrap(), Err(BridgeError::PageGone(_))));
        assert_eq!(d.page_tools_hash().as_deref(), Some("other"));
    }

    #[tokio::test(start_paused = true)]
    async fn calls_wait_for_the_page() {
        let d = Arc::new(Dispatcher::new());
        assert_eq!(d.page(), PageState::None);
        d.loading();
        assert_eq!(d.page(), PageState::Loading);
        let started = Instant::now();
        let task = spawn_call(&d, call("get_context", MINUTE));
        tokio::time::sleep(Duration::from_secs(5)).await;
        assert!(!task.is_finished(), "it waits for a page");
        let sink = FakeSink::default();
        d.attach(Box::new(sink.clone()), "hash");
        settle().await;
        assert!(d.reply(ok_reply(sink.last_id(), "ready now")));
        assert_eq!(text_of(&task.await.unwrap().unwrap()), "ready now");
        assert!(started.elapsed() < Duration::from_secs(6));
        // with none coming, it gives up after 30 s
        d.detach("the window reloaded");
        let started = Instant::now();
        let e = spawn_call(&d, call("get_context", MINUTE)).await.unwrap().unwrap_err();
        assert_eq!(e, BridgeError::NotReady);
        assert!(about(started.elapsed(), Duration::from_secs(30)), "{:?}", started.elapsed());
        assert!(e.to_string().contains("not ready"));
        assert_eq!(d.calls(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn with_no_page_on_its_way_calls_fail_at_once() {
        let d = Arc::new(Dispatcher::new());
        let started = Instant::now();
        assert_eq!(spawn_call(&d, call("get_context", MINUTE)).await.unwrap().unwrap_err(), BridgeError::NotReady);
        assert_eq!(started.elapsed(), Duration::ZERO);
        // one on its way that is then given up on: the calls waiting for it fail then
        d.loading();
        let task = spawn_call(&d, call("get_context", MINUTE));
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(!task.is_finished());
        d.close("the window closed");
        assert_eq!(task.await.unwrap().unwrap_err(), BridgeError::NotReady);
        assert!(about(started.elapsed(), Duration::from_secs(3)), "{:?}", started.elapsed());
    }

    #[tokio::test(start_paused = true)]
    async fn a_page_that_cannot_be_reached_is_not_ready() {
        let (d, sink) = attached();
        sink.broken.store(true, Ordering::SeqCst);
        assert_eq!(spawn_call(&d, call("get_context", MINUTE)).await.unwrap().unwrap_err(), BridgeError::NotReady);
        assert_eq!(d.calls(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn quiet_too_long_times_out_and_progress_starts_the_wait_again() {
        let (d, sink) = attached();
        // no word from the page: given up after the tool's timeout, and the page told
        let started = Instant::now();
        let e = spawn_call(&d, call("set_text", Duration::from_secs(10))).await.unwrap().unwrap_err();
        assert_eq!(e, BridgeError::Timeout);
        assert!(about(started.elapsed(), Duration::from_secs(10)), "{:?}", started.elapsed());
        let id = sink.last_id();
        assert_eq!(sink.of_kind("cancel"), [json!({"kind": "cancel", "id": id})]);
        assert!(!d.reply(ok_reply(id, "late")), "a late answer is ignored");
        // word of progress every 8 s keeps a 10 s timeout from running out
        let started = Instant::now();
        let task = spawn_call(&d, call("export", Duration::from_secs(10)));
        settle().await;
        let id = sink.last_id();
        for n in 1..=3 {
            tokio::time::sleep(Duration::from_secs(8)).await;
            assert!(!task.is_finished());
            // the same number again still counts as word from the page
            assert!(d.progress(PageProgress { id, progress: 1.0, total: None, message: Some(format!("{n}")) }));
        }
        tokio::time::sleep(Duration::from_secs(8)).await;
        assert!(d.reply(ok_reply(id, "exported")));
        assert_eq!(text_of(&task.await.unwrap().unwrap()), "exported");
        assert!(about(started.elapsed(), Duration::from_secs(32)), "{:?}", started.elapsed());
    }

    #[tokio::test(start_paused = true)]
    async fn no_call_runs_past_the_ceiling() {
        let d = Arc::new(Dispatcher::with_limits(Limits { ceiling: Duration::from_secs(30), ..Limits::default() }));
        let sink = FakeSink::default();
        d.attach(Box::new(sink.clone()), "hash");
        let task = tokio::spawn({
            let d = d.clone();
            async move {
                let started = Instant::now();
                let e = d.call(call("export", Duration::from_secs(10))).await.unwrap_err();
                (e, started.elapsed())
            }
        });
        settle().await;
        let id = sink.last_id();
        let mut n = 0.0;
        while !task.is_finished() {
            tokio::time::sleep(Duration::from_secs(5)).await;
            n += 1.0;
            d.progress(PageProgress { id, progress: n, total: None, message: None });
        }
        let (e, took) = task.await.unwrap();
        assert_eq!(e, BridgeError::Timeout);
        assert!(about(took, Duration::from_secs(30)), "{took:?}");
    }

    #[tokio::test(start_paused = true)]
    async fn cancelling_tells_the_page() {
        let (d, sink) = attached();
        let c = call("cut_out", MINUTE);
        let cancel = c.cancel.clone();
        let task = spawn_call(&d, c);
        settle().await;
        let id = sink.last_id();
        cancel.cancel();
        assert_eq!(task.await.unwrap().unwrap_err(), BridgeError::Cancelled);
        assert_eq!(sink.of_kind("cancel"), [json!({"kind": "cancel", "id": id})]);
        assert!(!d.reply(ok_reply(id, "late")));
        assert!(!d.progress(PageProgress { id, progress: 1.0, total: None, message: None }));
        // a call dropped by its caller (the client hung up) is cancelled too
        let task = spawn_call(&d, call("cut_out", MINUTE));
        settle().await;
        let id = sink.last_id();
        task.abort();
        let _ = task.await;
        assert_eq!(sink.of_kind("cancel").last(), Some(&json!({"kind": "cancel", "id": id})));
        assert_eq!(d.calls(), 0);
        // cancelled before it starts: the page never hears of it
        let c = call("cut_out", MINUTE);
        c.cancel.cancel();
        let before = sink.sent().len();
        assert_eq!(d.call(c).await.unwrap_err(), BridgeError::Cancelled);
        assert_eq!(sink.sent().len(), before);
    }

    #[tokio::test(start_paused = true)]
    async fn at_most_sixteen_calls() {
        let (d, sink) = attached();
        let tasks: Vec<_> = (0..MAX_CALLS).map(|_| spawn_call(&d, call("render_preview", MINUTE))).collect();
        settle().await;
        assert_eq!(d.calls(), MAX_CALLS);
        let e = spawn_call(&d, call("render_preview", MINUTE)).await.unwrap().unwrap_err();
        assert_eq!(e, BridgeError::TooMany);
        assert!(e.to_string().contains("16"));
        assert_eq!(sink.call_ids().len(), MAX_CALLS, "the 17th never reached the page");
        // one answered: room for another
        let first = sink.call_ids()[0];
        assert!(d.reply(ok_reply(first, "done")));
        settle().await;
        let more = spawn_call(&d, call("render_preview", MINUTE));
        settle().await;
        assert!(d.reply(ok_reply(sink.last_id(), "fits")));
        assert_eq!(text_of(&more.await.unwrap().unwrap()), "fits");
        // calls waiting for a page count too
        d.detach("the window reloaded");
        for t in tasks {
            let _ = t.await;
        }
        let waiting: Vec<_> = (0..MAX_CALLS).map(|_| spawn_call(&d, call("render_preview", MINUTE))).collect();
        settle().await;
        assert_eq!(spawn_call(&d, call("render_preview", MINUTE)).await.unwrap().unwrap_err(), BridgeError::TooMany);
        for t in waiting {
            t.abort();
        }
    }

    #[tokio::test(start_paused = true)]
    async fn progress_is_passed_on_only_when_it_grows() {
        let (d, sink) = attached();
        let told = Arc::new(Mutex::new(Vec::new()));
        let mut c = call("export", MINUTE);
        let keep = told.clone();
        c.progress = Some(Arc::new(move |p: Progress| keep.lock().unwrap().push(p)));
        let task = spawn_call(&d, c);
        settle().await;
        let id = sink.last_id();
        for (p, total) in [(0.0, Some(3.0)), (0.0, Some(3.0)), (1.0, Some(3.0)), (0.5, None), (f64::NAN, None), (2.0, Some(f64::INFINITY))] {
            assert!(d.progress(PageProgress { id, progress: p, total, message: Some("working".into()) }));
        }
        let told: Vec<_> = told.lock().unwrap().iter().map(|p| (p.progress, p.total)).collect();
        assert_eq!(told, [(0.0, Some(3.0)), (1.0, Some(3.0)), (2.0, None)]);
        assert!(!d.progress(PageProgress { id: id + 100, progress: 9.0, total: None, message: None }));
        assert!(d.reply(ok_reply(id, "done")));
        task.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn status_reaches_the_page_when_there_is_one() {
        let d = Dispatcher::new();
        assert!(!d.send_status(json!({"on": true})));
        let sink = FakeSink::default();
        d.attach(Box::new(sink.clone()), "hash");
        assert!(d.send_status(json!({"on": true})));
        assert_eq!(sink.sent(), [json!({"kind": "status", "status": {"on": true}})]);
        let mut watch = d.watch_page();
        d.detach("bye");
        assert!(watch.has_changed().unwrap());
        assert_eq!(*watch.borrow_and_update(), PageState::Loading);
    }

    #[test]
    fn results_are_tidied_and_checked() {
        // a data URL's prefix comes off; the text and the structured content stay as they are
        let png = "iVBORw0KGgo=";
        let r = read_result(json!({
            "content": [{"type": "image", "data": format!("data:image/png;base64,{png}"), "mimeType": "image/png"}, {"type": "text", "text": "a cover"}],
            "structuredContent": {"layers": 3},
        }))
        .unwrap();
        assert_eq!(r.content[0].as_image().unwrap().data, png);
        assert_eq!(r.content.len(), 2, "there was a text block, so none is added");
        assert_eq!(r.structured_content, Some(json!({"layers": 3})));
        assert_eq!(r.is_error, None);
        // structured content and no text: its JSON is added as text
        let r = read_result(json!({"structuredContent": {"profile": "Mine", "layers": 2}})).unwrap();
        let text: Value = serde_json::from_str(&r.content[0].as_text().unwrap().text).unwrap();
        assert_eq!(text, json!({"profile": "Mine", "layers": 2}));
        // an error the tool ran into stays one
        let r = read_result(json!({"content": [{"type": "text", "text": "no such layer"}], "isError": true})).unwrap();
        assert_eq!(r.is_error, Some(true));
        // structured content that is not an object is dropped, its JSON kept as text if there is none
        for (structured, text) in [(json!([1, 2]), Some("[1,2]")), (json!("hi"), Some("\"hi\"")), (json!(7), Some("7")), (json!(null), None)] {
            let r = read_result(json!({"structuredContent": structured})).unwrap();
            assert_eq!(r.structured_content, None, "{structured}");
            assert_eq!(r.content.first().and_then(|c| c.as_text()).map(|t| t.text.as_str()), text);
        }
        let r = read_result(json!({"content": [{"type": "text", "text": "two"}], "structuredContent": [1, 2]})).unwrap();
        assert_eq!((r.structured_content, r.content.len()), (None, 1));
        // data that only looks like a data URL is left alone
        assert_eq!(strip_data_url("data:image/png,abc"), "data:image/png,abc");
        assert_eq!(strip_data_url("abc"), "abc");
        // what is refused
        let refused = |v: Value, why: &str| match read_result(v) {
            Err(BridgeError::Malformed(m)) => assert!(m.contains(why), "{m:?} should say {why:?}"),
            other => panic!("{other:?} should be refused for {why:?}"),
        };
        refused(json!([]), "not an object");
        refused(json!({"content": "hi"}), "not a list");
        refused(json!({"content": [{"type": "audio", "data": "x", "mimeType": "audio/wav"}]}), "type audio");
        refused(json!({"content": [{"type": "image", "data": "x", "mimeType": "image/gif"}]}), "image/gif");
        refused(json!({"content": [{"type": "image", "mimeType": "image/png"}]}), "no data");
        refused(json!({"content": [{"type": "text"}]}), "no text");
        let many: Vec<_> = (0..17).map(|_| json!({"type": "image", "data": png, "mimeType": "image/png"})).collect();
        refused(json!({"content": many}), "more than 16");
        let big = "A".repeat(MAX_RESULT_BYTES + 1);
        refused(json!({"content": [{"type": "image", "data": big, "mimeType": "image/webp"}]}), "48 MB");
        refused(json!({"content": [], "resultType": "task"}), "complete");
        // replies without what they should have
        let reply = |v: Value| read_reply(serde_json::from_value(v).unwrap());
        assert!(matches!(reply(json!({"id": 1, "ok": true})), Err(BridgeError::Malformed(_))));
        assert!(matches!(reply(json!({"id": 1, "ok": false})), Err(BridgeError::Malformed(_))));
    }
}
