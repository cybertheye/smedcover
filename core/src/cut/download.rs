//! Fetching one file of the cut-out's ([`Download`]) into its part file: from each of its sources in
//! turn, resuming what is already there, checked against its size and SHA-256 before it is used.
//!
//! * **Resuming.** The part keeps what came, whatever stopped it (the network, a stall, a cancel); it
//!   is named by the hash it must have, so a part of another version of the file is never resumed.
//!   The bytes already there are hashed again (sha2 cannot save its state), then the rest is asked
//!   for with `Range`: a 206 for exactly the rest is appended to, a 200 (a source that ignores ranges)
//!   starts the file over, a 416 at full length is checked as it is.
//! * **Sources.** Each attempt is from one source, through the proxy chosen for it. One that fails
//!   before sending 1 MiB is left for the next; one that sent at least that is tried again, from where
//!   it stopped. The part belongs to the file, whoever sends the rest: the hash decides. At most
//!   [`STRIKES`] attempts that sent less than 1 MiB.
//! * **Errors** start with their kind: `network:`, `proxy:`, `tls:`, `http:`, `checksum:`, `disk:`, and
//!   list every attempt, with how it went (direct, or through which proxy); a cancel is `cancelled`.

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::onnx::{Download, Source};
use crate::net::{self, ProxyChoice, Via};
use crate::Res;

/// Set to stop the download that is running; it keeps what it has.
pub static CANCEL: AtomicBool = AtomicBool::new(false);

/// The most attempts that sent less than [`PROGRESS`] before giving up.
pub const STRIKES: usize = 6;
/// What an attempt must have sent for its source to be tried again rather than the next.
pub const PROGRESS: u64 = 1 << 20;

/// How long to wait: to connect, and for each read (a stall).
#[derive(Clone, Copy)]
pub struct Waits {
    pub connect: Duration,
    pub read: Duration,
}
pub const WAITS: Waits = Waits { connect: Duration::from_secs(15), read: Duration::from_secs(30) };

/// What a download is asked for: the proxy given (a setting, "" for none), the source chosen
/// (`auto`, or a source's id: `huggingface`, `hf-mirror`).
pub struct Options<'a> {
    pub proxy: &'a str,
    pub source: &'a str,
    pub waits: Waits,
}

/// A move to another source, or another try of the same one: from where, why, to where.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Retry {
    pub from: &'static str,
    pub why: String,
    pub to: &'static str,
}

/// How a file is getting on. `done` counts bytes of this file: hashed again (`checking`), there so far
/// (`downloading`), or copied (`importing`).
#[derive(Clone, Debug, Default)]
pub struct Step {
    pub phase: &'static str,
    pub done: u64,
    pub source: Option<&'static str>,
    pub via: Option<Via>,
    pub proxy: Option<String>,
    pub resumed_from: u64,
    pub retry: Option<Retry>,
}

/// The source that last sent a whole file of each kind (`model`, `runtime`) in this run: tried first
/// when the source is `auto`.
static LAST_GOOD: Mutex<Vec<(&'static str, &'static str)>> = Mutex::new(Vec::new());

/// The sources to try, in order: the one chosen alone (when the file has it), else the one that last
/// worked first, then the rest as listed.
pub fn order(d: &Download, what: &str, chosen: &str) -> Vec<&'static Source> {
    let all: Vec<&'static Source> = d.sources.iter().collect();
    if let Some(s) = all.iter().find(|s| s.id == chosen) {
        return vec![*s];
    }
    let last = LAST_GOOD.lock().ok().and_then(|l| l.iter().find(|(w, _)| *w == what).map(|(_, id)| *id));
    let mut out = all.clone();
    if let Some(i) = last.and_then(|id| out.iter().position(|s| s.id == id)) {
        let s = out.remove(i);
        out.insert(0, s);
    }
    out
}
fn remember(what: &'static str, id: &'static str) {
    if let Ok(mut l) = LAST_GOOD.lock() {
        l.retain(|(w, _)| *w != what);
        l.push((what, id));
    }
}

/// Where the part of `d` is kept in `dir`: named by the start of its hash.
pub fn part_name(d: &Download) -> String {
    format!("{}.part", &d.sha256[..16])
}

/// One attempt's end, when it is not the whole file.
enum Stop {
    Cancelled,
    /// Writing the part failed: no source can help.
    Disk(String),
    /// This source did not give the file: `kind` as the errors' (`network`, `proxy`, `tls`, `http`,
    /// `checksum`); `restart`: what is in the part cannot be resumed, and this source is asked again
    /// for the whole file (once: it is a strike).
    Failed { kind: &'static str, why: String, restart: bool },
}

/// The part as it is: the file, open for appending, how much is there, and the hash of that much.
struct Part {
    file: File,
    have: u64,
    hash: Sha256,
}
impl Part {
    fn restart(&mut self) -> Result<(), Stop> {
        self.file.set_len(0).and_then(|_| self.file.seek(SeekFrom::Start(0)).map(|_| ())).map_err(|e| Stop::Disk(e.to_string()))?;
        self.have = 0;
        self.hash = Sha256::new();
        Ok(())
    }
}

/// Fetches `d` into `part`, telling `report` how it goes. Done when the part is whole and its hash
/// right; the caller puts it in place. `what` (`model`, `runtime`) is what last worked is kept for.
pub fn fetch(d: &Download, what: &'static str, part: &Path, opts: &Options, report: &mut dyn FnMut(Step)) -> Res<()> {
    let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(part).map_err(|e| format!("disk: {}: {e}", part.display()))?;
    let mut p = Part { file, have: 0, hash: Sha256::new() };
    let disk = |e: Stop| match e {
        Stop::Cancelled => "cancelled".to_string(),
        Stop::Disk(e) | Stop::Failed { why: e, .. } => format!("disk: {e}"),
    };
    let there = p.file.metadata().map_err(|e| format!("disk: {e}"))?.len();
    if there > d.bytes {
        p.restart().map_err(disk)?;
    } else if there > 0 {
        rehash(&mut p, there, report).map_err(disk)?;
        if p.have == d.bytes {
            if hex(&p.hash) == d.sha256 {
                report(Step { phase: "verifying", done: d.bytes, ..Step::default() });
                return Ok(());
            }
            p.restart().map_err(disk)?;
        }
    }

    let sources = order(d, what, opts.source);
    let mut attempts: Vec<(&'static str, String, &'static str, String)> = Vec::new();   // host, how it went, kind, why
    let (mut i, mut strikes) = (0, 0);
    let mut retry: Option<Retry> = None;
    while i < sources.len() && strikes < STRIKES {
        let src = sources[i];
        let choice = net::proxy_choice(src.url, opts.proxy);
        let retrying = retry.take().map(|r| Retry { to: src.host, ..r });
        report(Step { phase: "connecting", done: p.have, source: Some(src.host), via: Some(choice.via), proxy: choice.shown(), resumed_from: p.have, retry: retrying });
        let before = p.have;
        let result = attempt(d, src, &choice, &mut p, opts.waits, report);
        let result = match result {
            Ok(()) if hex(&p.hash) == d.sha256 => {
                remember(what, src.id);
                report(Step { phase: "verifying", done: d.bytes, source: Some(src.host), via: Some(choice.via), proxy: choice.shown(), ..Step::default() });
                return Ok(());
            }
            Ok(()) => Err(Stop::Failed { kind: "checksum", why: "the file sent is not the one expected (its SHA-256 differs)".into(), restart: true }),
            Err(e) => Err(e),
        };
        match result {
            Ok(()) => unreachable!(),
            Err(Stop::Cancelled) => {
                let _ = p.file.sync_all();
                return Err("cancelled".into());
            }
            Err(Stop::Disk(e)) => return Err(format!("disk: {e}")),
            Err(Stop::Failed { kind, why, restart }) => {
                let progressed = p.have >= before + PROGRESS;
                if restart {
                    p.restart().map_err(disk)?;
                }
                attempts.push((src.host, choice.describe(), kind, why.clone()));
                retry = Some(Retry { from: src.host, why: format!("{kind}: {why}"), to: src.host });
                // the same source again: one that sent something, from where it stopped; one whose part
                // could not be resumed (416), for the whole file. Else the next. A wrong file: the next.
                let again = kind != "checksum" && (progressed || restart && before > 0);
                if !progressed {
                    strikes += 1;
                }
                if !again {
                    i += 1;
                }
            }
        }
    }
    let _ = p.file.sync_all();
    Err(failure(&attempts))
}

/// The error of a download no source gave: its kind (TLS or the proxy if any attempt failed so,
/// else the last's), then every attempt.
fn failure(attempts: &[(&'static str, String, &'static str, String)]) -> String {
    let kinds: Vec<&str> = attempts.iter().map(|a| a.2).collect();
    let kind = ["tls", "proxy"].into_iter().find(|k| kinds.contains(k)).or(kinds.last().copied()).unwrap_or("network");
    let each: Vec<String> = attempts.iter().map(|(host, how, kind, why)| format!("{host} ({how}): {}", why.strip_prefix(&format!("{kind}: ")).unwrap_or(why))).collect();
    format!("{kind}: {}", if each.is_empty() { "no source to download from".to_string() } else { each.join("; ") })
}

/// Hashes the `n` bytes already in the part again, reporting as it goes; leaves the file at its end.
fn rehash(p: &mut Part, n: u64, report: &mut dyn FnMut(Step)) -> Result<(), Stop> {
    p.file.seek(SeekFrom::Start(0)).map_err(|e| Stop::Disk(e.to_string()))?;
    let (mut buf, mut done, mut last) = (vec![0u8; 1 << 20], 0u64, Instant::now());
    report(Step { phase: "checking", done: 0, ..Step::default() });
    while done < n {
        if CANCEL.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        let want = buf.len().min((n - done) as usize);
        let k = p.file.read(&mut buf[..want]).map_err(|e| Stop::Disk(e.to_string()))?;
        if k == 0 {
            break;
        }
        p.hash.update(&buf[..k]);
        done += k as u64;
        if last.elapsed() >= Duration::from_millis(200) {
            report(Step { phase: "checking", done, ..Step::default() });
            last = Instant::now();
        }
    }
    p.have = done;
    p.file.set_len(done).and_then(|_| p.file.seek(SeekFrom::Start(done)).map(|_| ())).map_err(|e| Stop::Disk(e.to_string()))
}

/// One request to one source, appending to the part. Ok once the part has every byte (its hash is
/// the caller's to check).
fn attempt(d: &Download, src: &'static Source, choice: &ProxyChoice, p: &mut Part, waits: Waits, report: &mut dyn FnMut(Step)) -> Result<(), Stop> {
    let builder = ureq::AgentBuilder::new()
        .timeout_connect(waits.connect)
        .timeout_read(waits.read)
        .tls_config(net::tls().map_err(|e| Stop::Failed { kind: "tls", why: e, restart: false })?);
    let agent = net::with_proxy(builder, choice).map_err(|e| Stop::Failed { kind: "proxy", why: e, restart: false })?.build();
    let mut request = agent.get(src.url);
    if p.have > 0 {
        request = request.set("Range", &format!("bytes={}-", p.have));
    }
    let reply = match request.call() {
        Ok(r) => r,
        Err(ureq::Error::Status(416, _)) if p.have == d.bytes => return Ok(()),
        Err(ureq::Error::Status(416, _)) => return Err(Stop::Failed { kind: "http", why: "HTTP 416 (the part asked for is not there)".into(), restart: true }),
        Err(ureq::Error::Status(code, _)) => return Err(Stop::Failed { kind: "http", why: format!("HTTP {code}"), restart: false }),
        Err(e) => return Err(Stop::Failed { kind: kind_of(&e, choice), why: short(&e), restart: false }),
    };
    match reply.status() {
        206 => {
            let range = reply.header("content-range").unwrap_or("").to_string();
            if parse_range(&range) != Some((p.have, d.bytes - 1, d.bytes)) {
                return Err(Stop::Failed { kind: "http", why: format!("sent another part of the file than asked for ({range})"), restart: false });
            }
        }
        200 => {
            if p.have > 0 {
                p.restart()?;   // the source ignores ranges: from the start
            }
            if let Some(n) = reply.header("content-length").and_then(|n| n.trim().parse::<u64>().ok()) {
                if n != d.bytes {
                    return Err(Stop::Failed { kind: "http", why: format!("would send {n} bytes, {} were expected", d.bytes), restart: false });
                }
            }
        }
        code => return Err(Stop::Failed { kind: "http", why: format!("HTTP {code}"), restart: false }),
    }
    let from = p.have;
    let step = |done| Step { phase: "downloading", done, source: Some(src.host), via: Some(choice.via), proxy: choice.shown(), resumed_from: from, retry: None };
    report(step(p.have));
    let mut body = reply.into_reader();
    let (mut buf, mut last) = (vec![0u8; 256 << 10], Instant::now());
    loop {
        if CANCEL.load(Ordering::SeqCst) {
            return Err(Stop::Cancelled);
        }
        let k = match body.read(&mut buf) {
            Ok(k) => k,
            Err(e) => {
                let _ = p.file.flush();
                return Err(Stop::Failed { kind: "network", why: net::describe(&e), restart: false });
            }
        };
        if k == 0 {
            break;
        }
        if p.have + k as u64 > d.bytes {
            return Err(Stop::Failed { kind: "http", why: format!("sent more than the {} bytes expected", d.bytes), restart: true });
        }
        p.file.write_all(&buf[..k]).map_err(|e| Stop::Disk(e.to_string()))?;
        p.hash.update(&buf[..k]);
        p.have += k as u64;
        if last.elapsed() >= Duration::from_millis(200) {
            report(step(p.have));
            last = Instant::now();
        }
    }
    p.file.flush().map_err(|e| Stop::Disk(e.to_string()))?;
    report(step(p.have));
    if p.have < d.bytes {
        return Err(Stop::Failed { kind: "network", why: format!("the connection ended at {} of {} MB", p.have >> 20, d.bytes >> 20), restart: false });
    }
    Ok(())
}

/// A request's failure, by kind: TLS; the proxy (one was in the way and could not be reached, or would
/// not connect); else the network.
fn kind_of(e: &ureq::Error, choice: &ProxyChoice) -> &'static str {
    if net::is_tls(e) {
        return "tls";
    }
    match e.kind() {
        ureq::ErrorKind::ProxyConnect | ureq::ErrorKind::ProxyUnauthorized | ureq::ErrorKind::InvalidProxyUrl => "proxy",
        ureq::ErrorKind::ConnectionFailed | ureq::ErrorKind::Dns if choice.proxy.is_some() => "proxy",
        _ => "network",
    }
}

/// An error without the URL ureq starts it with (a CDN's, after a redirect, is long and signed).
fn short(e: &ureq::Error) -> String {
    let text = net::describe(e);
    let (prefix, rest) = match text.strip_prefix("tls: ") {
        Some(rest) => ("tls: ", rest),
        None => ("", text.as_str()),
    };
    let rest = if rest.starts_with("http") { rest.split_once(": ").map_or(rest, |(_, r)| r) } else { rest };
    format!("{prefix}{rest}")
}

/// `bytes start-end/total` → (start, end, total).
fn parse_range(value: &str) -> Option<(u64, u64, u64)> {
    let rest = value.trim().strip_prefix("bytes")?.trim_start();
    let (span, total) = rest.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    Some((start.trim().parse().ok()?, end.trim().parse().ok()?, total.trim().parse().ok()?))
}

fn hex(h: &Sha256) -> String {
    format!("{:x}", h.clone().finalize())
}

/// Puts a finished file in place. On Windows an antivirus often holds a file just written: tried again
/// for two seconds.
pub fn put_in_place(from: &Path, to: &Path) -> std::io::Result<()> {
    let mut tries = 0;
    loop {
        match std::fs::rename(from, to) {
            Ok(()) => return Ok(()),
            Err(e) if cfg!(windows) && tries < 10 && (e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(32)) => {
                tries += 1;
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex as StdMutex};

    /// How the stand-in answers one request, given the start of the range asked for.
    pub enum Answer {
        /// The file from the range's start (206), or whole (200) without one; `cut` stops after so many bytes.
        File { cut: Option<u64> },
        /// The whole file whatever the range (a source that ignores ranges).
        Whole,
        /// Other bytes than the file's, of its length.
        Wrong,
        /// A status with an empty body.
        Status(u16),
        /// A 206 for another range than asked.
        BadRange,
        /// Closes the connection at once.
        Hang,
        /// The file from the range's start, waiting half a second after `at` bytes.
        Pause { at: u64 },
    }

    /// A stand-in HTTP server for `body`: each request is answered as `plan` says for its number (from 0)
    /// and the range asked for; the requests' ranges are kept.
    pub fn stand_in(body: Arc<Vec<u8>>, plan: impl Fn(usize, Option<u64>) -> Answer + Send + 'static) -> (String, Arc<StdMutex<Vec<Option<u64>>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/file", listener.local_addr().unwrap());
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let kept = seen.clone();
        std::thread::spawn(move || {
            for (n, stream) in listener.incoming().enumerate() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut range = None;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(v) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                        range = v.trim().trim_end_matches('-').parse::<u64>().ok();
                    }
                }
                kept.lock().unwrap().push(range);
                let len = body.len() as u64;
                let _ = match plan(n, range) {
                    Answer::File { cut } => {
                        let from = range.unwrap_or(0);
                        let head = if range.is_some() {
                            format!("HTTP/1.1 206 Partial Content\r\ncontent-range: bytes {from}-{}/{len}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", len - 1, len - from)
                        } else {
                            format!("HTTP/1.1 200 OK\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n")
                        };
                        let end = cut.map_or(len, |c| (from + c).min(len));
                        stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&body[from as usize..end as usize]))
                    }
                    Answer::Whole => stream.write_all(format!("HTTP/1.1 200 OK\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n").as_bytes()).and_then(|_| stream.write_all(&body)),
                    Answer::Wrong => stream.write_all(format!("HTTP/1.1 200 OK\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n").as_bytes()).and_then(|_| stream.write_all(&vec![7u8; len as usize])),
                    Answer::Status(code) => stream.write_all(format!("HTTP/1.1 {code} X\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").as_bytes()),
                    Answer::BadRange => stream.write_all(format!("HTTP/1.1 206 Partial Content\r\ncontent-range: bytes 0-{}/{len}\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n", len - 1).as_bytes()).and_then(|_| stream.write_all(&body)),
                    Answer::Hang => Ok(()),
                    Answer::Pause { at } => {
                        let from = range.unwrap_or(0);
                        let mid = (from + at).min(len) as usize;
                        let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n");
                        stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(&body[..mid])).and_then(|_| stream.flush()).and_then(|_| {
                            std::thread::sleep(Duration::from_millis(500));
                            stream.write_all(&body[mid..])
                        })
                    }
                };
                let _ = stream.flush();
            }
        });
        (url, seen)
    }

    /// A file of `n` bytes to download, with its hash, from the stand-ins at `urls` (ids `a`, `b`, …).
    pub fn catalog(body: &[u8], urls: &[String]) -> &'static Download {
        let ids = ["a", "b", "c"];
        let sources: Vec<Source> = urls.iter().enumerate().map(|(i, u)| Source { id: ids[i], host: Box::leak(format!("host-{}", ids[i]).into_boxed_str()), url: Box::leak(u.clone().into_boxed_str()) }).collect();
        let sha = format!("{:x}", Sha256::digest(body));
        Box::leak(Box::new(Download { sources: Box::leak(sources.into_boxed_slice()), bytes: body.len() as u64, sha256: Box::leak(sha.into_boxed_str()) }))
    }

    pub fn body(n: usize) -> Arc<Vec<u8>> {
        Arc::new((0..n).map(|i| (i * 31 % 251) as u8).collect())
    }

    pub const QUICK: Waits = Waits { connect: Duration::from_secs(2), read: Duration::from_secs(2) };
    /// Tests share CANCEL and LAST_GOOD: one at a time.
    pub static SERIAL: StdMutex<()> = StdMutex::new(());

    fn run(d: &Download, part: &Path, source: &str) -> (Res<()>, Vec<Step>) {
        let mut steps = Vec::new();
        let r = fetch(d, "test", part, &Options { proxy: "", source, waits: QUICK }, &mut |s| steps.push(s));
        (r, steps)
    }

    fn setup() -> std::sync::MutexGuard<'static, ()> {
        let g = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        CANCEL.store(false, Ordering::SeqCst);
        LAST_GOOD.lock().unwrap().clear();
        g
    }

    const MB: usize = 1 << 20;

    #[test]
    fn a_whole_file_from_the_first_source() {
        let _g = setup();
        let b = body(3 * MB + 5);
        let (url, seen) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[url]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        let (r, steps) = run(d, &part, "auto");
        r.unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), *b);
        assert_eq!(*seen.lock().unwrap(), [None]);
        assert_eq!(steps[0].phase, "connecting");
        assert_eq!((steps[0].source, steps[0].via, steps[0].resumed_from), (Some("host-a"), Some(Via::Direct), 0));
        assert_eq!(steps.last().unwrap().phase, "verifying");
        assert!(steps.iter().any(|s| s.phase == "downloading"));
    }

    #[test]
    fn resumes_a_part_asking_for_the_rest() {
        let _g = setup();
        let b = body(2 * MB + 77);
        let (url, seen) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[url]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        std::fs::write(&part, &b[..MB + 3]).unwrap();
        let (r, steps) = run(d, &part, "auto");
        r.unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), *b);
        assert_eq!(*seen.lock().unwrap(), [Some(MB as u64 + 3)]);
        assert_eq!(steps[0].phase, "checking");
        let connecting = steps.iter().find(|s| s.phase == "connecting").unwrap();
        assert_eq!(connecting.resumed_from, MB as u64 + 3);
    }

    #[test]
    fn a_source_that_ignores_ranges_starts_over() {
        let _g = setup();
        let b = body(MB + 1);
        let (url, seen) = stand_in(b.clone(), |_, _| Answer::Whole);
        let d = catalog(&b, &[url]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        std::fs::write(&part, &b[..1000]).unwrap();
        run(d, &part, "auto").0.unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), *b);
        assert_eq!(*seen.lock().unwrap(), [Some(1000)]);
    }

    #[test]
    fn a_whole_part_is_checked_without_asking() {
        let _g = setup();
        let b = body(4000);
        let d = catalog(&b, &["http://127.0.0.1:9/never".to_string()]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        std::fs::write(&part, &*b).unwrap();
        let (r, steps) = run(d, &part, "auto");
        r.unwrap();
        assert!(!steps.iter().any(|s| s.phase == "connecting"));
        // a whole part with the wrong bytes is started over
        std::fs::write(&part, vec![1u8; 4000]).unwrap();
        let (url, seen) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[url]);
        run(d, &part, "auto").0.unwrap();
        assert_eq!(*seen.lock().unwrap(), [None]);
        assert_eq!(std::fs::read(&part).unwrap(), *b);
    }

    #[test]
    fn a_416_starts_over_on_the_same_source() {
        let _g = setup();
        let b = body(5000);
        // the source will not send the rest of the part: asked again for the whole file
        let (url, seen) = stand_in(b.clone(), |n, _| if n == 0 { Answer::Status(416) } else { Answer::File { cut: None } });
        let d = catalog(&b, &[url]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        std::fs::write(&part, &b[..4000]).unwrap();
        run(d, &part, "auto").0.unwrap();
        assert_eq!(*seen.lock().unwrap(), [Some(4000), None]);
        assert_eq!(std::fs::read(&part).unwrap(), *b);
    }

    #[test]
    fn a_connection_cut_part_way_is_resumed_on_the_same_source_then_the_next() {
        let _g = setup();
        let b = body(5 * MB);
        // a: cuts after 2 MB, then after 0; b: the rest
        let (a, seen_a) = stand_in(b.clone(), |n, _| Answer::File { cut: Some(if n == 0 { 2 * MB as u64 } else { 0 }) });
        let (bb, seen_b) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[a, bb]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        let (r, steps) = run(d, &part, "auto");
        r.unwrap();
        assert_eq!(std::fs::read(&part).unwrap(), *b);
        assert_eq!(*seen_a.lock().unwrap(), [None, Some(2 * MB as u64)]);
        assert_eq!(*seen_b.lock().unwrap(), [Some(2 * MB as u64)]);
        let moves: Vec<_> = steps.iter().filter_map(|s| s.retry.clone()).map(|r| (r.from, r.to)).collect();
        assert_eq!(moves, [("host-a", "host-a"), ("host-a", "host-b")]);
        // b worked: tried first next time
        assert_eq!(order(d, "test", "auto")[0].id, "b");
    }

    #[test]
    fn a_refused_or_missing_source_moves_to_the_next() {
        let _g = setup();
        let b = body(1000);
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let (b404, _) = stand_in(b.clone(), |_, _| Answer::Status(404));
        let (good, _) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[format!("http://{free}/x"), b404, good]);
        let dir = tempfile::tempdir().unwrap();
        let (r, steps) = run(d, &dir.path().join(part_name(d)), "auto");
        r.unwrap();
        let tried: Vec<_> = steps.iter().filter(|s| s.phase == "connecting").map(|s| s.source.unwrap()).collect();
        assert_eq!(tried, ["host-a", "host-b", "host-c"]);
        assert!(steps.iter().find(|s| s.source == Some("host-c") && s.phase == "connecting").unwrap().retry.as_ref().unwrap().why.contains("HTTP 404"));
    }

    #[test]
    fn a_connection_closed_without_an_answer_moves_to_the_next() {
        let _g = setup();
        let b = body(1000);
        let (hang, _) = stand_in(b.clone(), |_, _| Answer::Hang);
        let (good, _) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[hang, good]);
        let dir = tempfile::tempdir().unwrap();
        let (r, steps) = run(d, &dir.path().join("p.part"), "auto");
        r.unwrap();
        assert!(steps.iter().any(|s| s.retry.as_ref().is_some_and(|r| r.from == "host-a" && r.to == "host-b" && r.why.starts_with("network: "))));
    }

    #[test]
    fn when_every_source_fails_the_error_lists_them_all() {
        let _g = setup();
        let b = body(1000);
        let free = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let (b403, _) = stand_in(b.clone(), |_, _| Answer::Status(403));
        let d = catalog(&b, &[format!("http://{free}/x"), b403]);
        let dir = tempfile::tempdir().unwrap();
        let e = run(d, &dir.path().join(part_name(d)), "auto").0.unwrap_err();
        assert!(e.starts_with("http: host-a (direct): "), "{e}");
        assert!(e.contains("; host-b (direct): HTTP 403"), "{e}");
        assert!(!e.contains("http://127.0.0.1"), "no URL in it: {e}");
    }

    #[test]
    fn a_wrong_checksum_tries_the_next_source_from_the_start() {
        let _g = setup();
        let b = body(3000);
        let (bad, _) = stand_in(b.clone(), |_, _| Answer::Wrong);
        let (good, seen) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[bad.clone(), good]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        run(d, &part, "auto").0.unwrap();
        assert_eq!(*seen.lock().unwrap(), [None]);
        // only the bad one: a checksum error, and the part gone to nothing
        let d = catalog(&b, &[bad]);
        let part = dir.path().join("only-bad.part");
        let e = run(d, &part, "auto").0.unwrap_err();
        assert!(e.starts_with("checksum: host-a (direct): "), "{e}");
        assert_eq!(std::fs::metadata(&part).unwrap().len(), 0);
    }

    #[test]
    fn another_range_than_asked_moves_to_the_next_and_keeps_the_part() {
        let _g = setup();
        let b = body(MB + 10);
        let (bad, _) = stand_in(b.clone(), |_, _| Answer::BadRange);
        let (good, seen) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[bad, good]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        std::fs::write(&part, &b[..500]).unwrap();
        run(d, &part, "auto").0.unwrap();
        assert_eq!(*seen.lock().unwrap(), [Some(500)]);
        assert_eq!(std::fs::read(&part).unwrap(), *b);
    }

    #[test]
    fn a_source_chosen_is_the_only_one_tried() {
        let _g = setup();
        let b = body(100);
        let (a, seen_a) = stand_in(b.clone(), |_, _| Answer::Status(500));
        let (bb, _) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        let d = catalog(&b, &[a, bb]);
        let dir = tempfile::tempdir().unwrap();
        run(d, &dir.path().join("1.part"), "b").0.unwrap();
        assert!(seen_a.lock().unwrap().is_empty());
        assert!(run(d, &dir.path().join("2.part"), "a").0.unwrap_err().starts_with("http: host-a"));
        // a choice the file has no source for (the runtime, GitHub's only) is no choice
        assert_eq!(order(d, "x", "hf-mirror").len(), 2);
    }

    #[test]
    fn a_cancel_keeps_the_part() {
        let _g = setup();
        let b = body(4 * MB);
        let (url, _) = stand_in(b.clone(), |_, _| Answer::Pause { at: MB as u64 });
        let d = catalog(&b, &[url]);
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join(part_name(d));
        let mut steps = 0;
        let r = fetch(d, "test", &part, &Options { proxy: "", source: "auto", waits: QUICK }, &mut |s| {
            steps += 1;
            if s.phase == "downloading" && s.done >= MB as u64 {
                CANCEL.store(true, Ordering::SeqCst);
            }
        });
        CANCEL.store(false, Ordering::SeqCst);
        assert_eq!(r.unwrap_err(), "cancelled");
        let kept = std::fs::read(&part).unwrap();
        assert!(!kept.is_empty() && kept.len() < b.len());
        assert_eq!(kept[..], b[..kept.len()]);
    }

    #[test]
    fn a_source_that_never_answers_is_left_after_the_wait() {
        let _g = setup();
        let b = body(100);
        let (good, _) = stand_in(b.clone(), |_, _| Answer::File { cut: None });
        // accepts and says nothing
        let silent = TcpListener::bind("127.0.0.1:0").unwrap();
        let at = silent.local_addr().unwrap();
        let d = catalog(&b, &[format!("http://{at}/x"), good]);
        let dir = tempfile::tempdir().unwrap();
        let t = Instant::now();
        let (r, steps) = run(d, &dir.path().join("p.part"), "auto");
        r.unwrap();
        assert!(t.elapsed() < Duration::from_secs(6));
        let why = &steps.iter().filter_map(|s| s.retry.clone()).next().unwrap().why;
        assert!(why.starts_with("network: ") && why.contains("timed out"), "{why}");
        drop(silent);
    }

    #[test]
    fn ranges_are_read() {
        assert_eq!(parse_range("bytes 100-199/200"), Some((100, 199, 200)));
        assert_eq!(parse_range(" bytes 0-0/1 "), Some((0, 0, 1)));
        assert_eq!(parse_range("bytes */200"), None);
        assert_eq!(parse_range(""), None);
    }
}
