//! Sending the request for an AI-generated asset or a repainted photo, so it is not subject to the
//! web view's cross-origin rules, and fetching a picture an image model left at a link.
//!
//! Every request sent here is the page's, and carries [`PAGE_MARKER`] (`X-SmedCover-Page: 1`), set
//! after the page's own headers, which can neither drop it nor change it (one of that name among
//! them is left out); a `Host` the page gives is left out too, the URL's own going instead. The
//! agents' endpoint refuses any request with the marker (`mcp::server`), so the page cannot call it
//! through the app, by whatever name, address, proxy or redirect: ureq keeps a request's headers when
//! it follows a redirect (all but `Authorization`, `Cookie` and `Content-Length`), and a POST is not
//! redirected at all.

use std::io::{ErrorKind, Read};

use ::image::ImageFormat;
use serde::{Deserialize, Serialize};

pub use crate::mcp::server::PAGE_MARKER;
use crate::Res;

/// How long an AI request may take unless the caller says otherwise, and the most of a reply
/// that is read. Models that reason before answering can need several minutes.
pub const AI_TIMEOUT_SECS: u64 = 300;
pub const AI_MAX_REPLY: u64 = 4 * 1024 * 1024;
/// A reply carrying a picture (a repainted photo, as base64) is allowed to be this big.
pub const AI_MAX_IMAGE_REPLY: u64 = 64 * 1024 * 1024;

/// What came back from an AI endpoint: the status and body are handed to the web view as they
/// are, error replies included, so it can show the provider's own message.
#[derive(Serialize, Debug)]
pub struct AiReply {
    pub status: u16,
    pub text: String,
}

/// One request to an AI model as the web view builds it (see `ui/js/ai.js` and `ui/js/repaint.js`),
/// with the arguments of the command `ai_request`. `image` allows the much bigger reply a picture
/// makes; `method` "GET" asks without a body (checking a key and a model); `timeout` is in seconds.
#[derive(Deserialize, Debug, Default)]
pub struct AiRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub proxy: Option<String>,
    pub timeout: Option<u64>,
    pub image: Option<bool>,
    pub method: Option<String>,
}

fn read_capped(response: ureq::Response, cap: u64) -> Res<String> {
    let mut text = String::new();
    response
        .into_reader()
        .take(cap)
        .read_to_string(&mut text)
        .map_err(net_err)?;
    Ok(text)
}

/// A request's error as text, a wait that ran out always saying "timed out", which is what the web
/// view looks for to explain it (ai.timedOut in app.js): Windows words it "os error 10060" alone.
fn net_err<E: std::error::Error + 'static>(e: E) -> String {
    let text = e.to_string();
    let mut cause: Option<&(dyn std::error::Error + 'static)> = Some(&e);
    while let Some(c) = cause {
        let io = c.downcast_ref::<std::io::Error>();
        if io.is_some_and(|io| io.kind() == ErrorKind::TimedOut) {
            return if text.to_lowercase().contains("timed out") { text } else { format!("timed out: {text}") };
        }
        cause = c.source();
    }
    text
}

/// An agent for `url`: the timeout, and the proxy if one applies.
fn agent_for(url: &str, proxy: &str, timeout_secs: u64) -> Res<ureq::Agent> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(format!("invalid URL: {url}"));
    }
    let timeout = std::time::Duration::from_secs(timeout_secs.clamp(5, 1800));
    let mut builder = ureq::AgentBuilder::new().timeout(timeout);
    if let Some(p) = proxy_for(url, proxy) {
        builder = builder.proxy(ureq::Proxy::new(&p).map_err(|e| format!("proxy {p}: {e}"))?);
    }
    Ok(builder.build())
}

/// Whether a URL points at this machine (a local model server), which no proxy should sit in front of.
fn is_local(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.split(':').next().unwrap_or(""),
    };
    host.eq_ignore_ascii_case("localhost") || host == "::1" || host.starts_with("127.")
}

/// The proxy to use for `url`: the one given, else — for hosts that are not this machine — the
/// one in the usual environment variables.
pub fn proxy_for(url: &str, given: &str) -> Option<String> {
    if !given.trim().is_empty() {
        return Some(given.trim().to_string());
    }
    if is_local(url) {
        return None;
    }
    let names: &[&str] = if url.starts_with("https://") {
        &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    } else {
        &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"]
    };
    names
        .iter()
        .find_map(|n| std::env::var(n).ok().filter(|v| !v.trim().is_empty()))
}

/// POSTs a JSON body to an http(s) URL with the given headers, optionally through a proxy.
#[cfg(test)]
fn post_json(
    url: &str,
    headers: &[(String, String)],
    body: &str,
    proxy: &str,
    timeout_secs: u64,
    cap: u64,
) -> Res<AiReply> {
    send(url, "POST", headers, body, proxy, timeout_secs, cap)
}

/// Sends a request — a POST with a body, or a GET (`method` "GET", the body ignored) — and returns
/// the status and the reply as they are, error replies included.
fn send(
    url: &str,
    method: &str,
    headers: &[(String, String)],
    body: &str,
    proxy: &str,
    timeout_secs: u64,
    cap: u64,
) -> Res<AiReply> {
    let agent = agent_for(url, proxy, timeout_secs)?;
    let get = method.eq_ignore_ascii_case("GET");
    let mut request = if get { agent.get(url) } else { agent.post(url) };
    for (name, value) in headers {
        // ureq would send a Host of the page's choosing as it is; the marker is the app's alone
        if name.trim().eq_ignore_ascii_case("host") || name.trim().eq_ignore_ascii_case(PAGE_MARKER) {
            continue;
        }
        request = request.set(name, value);
    }
    let request = request.set(PAGE_MARKER, "1");
    match if get { request.call() } else { request.send_string(body) } {
        Ok(response) => Ok(AiReply {
            status: response.status(),
            text: read_capped(response, cap)?,
        }),
        Err(ureq::Error::Status(status, response)) => Ok(AiReply {
            status,
            text: read_capped(response, AI_MAX_REPLY).unwrap_or_default(),
        }),
        Err(e) => Err(net_err(e)),
    }
}

/// Sends one request to an AI model: an asset to generate, or a photo to repaint. Blocks until the
/// reply is in, which can take minutes: a host waits for it off its interface thread.
pub fn ai_request(r: &AiRequest) -> Res<AiReply> {
    let cap = if r.image.unwrap_or(false) { AI_MAX_IMAGE_REPLY } else { AI_MAX_REPLY };
    send(
        &r.url,
        r.method.as_deref().unwrap_or("POST"),
        &r.headers,
        &r.body,
        r.proxy.as_deref().unwrap_or(""),
        r.timeout.unwrap_or(AI_TIMEOUT_SECS),
        cap,
    )
}

/// Downloads a picture at a link: `{mime, data}` with the bytes in base64 — one an image model left at a link
/// instead of sending it (a repaint), or one an agent's `add_photo` names (`known`). No bigger than a reply with a
/// picture inside may be ([`AI_MAX_IMAGE_REPLY`]): a reply past that is refused ("picture too big:"), never cut short.
/// With `known`, only a picture the photo store takes, told by its first bytes ([`crate::files::picture_type`]: PNG,
/// JPEG, WebP, GIF, HEIC/HEIF, AVIF) whatever the reply's `content-type` says — an SVG, a BMP or a TIFF is refused
/// ("not a picture:"); without, any `image/` type the reply says it is, else PNG, JPEG or WebP by its bytes.
pub fn fetch_image(url: &str, proxy: &str, timeout_secs: u64, known: bool) -> Res<FetchedImage> {
    fetch_capped(url, proxy, timeout_secs, known, AI_MAX_IMAGE_REPLY)
}

/// [`fetch_image`], at most `cap` bytes.
fn fetch_capped(url: &str, proxy: &str, timeout_secs: u64, known: bool, cap: u64) -> Res<FetchedImage> {
    use base64::Engine;
    let agent = agent_for(url, proxy, timeout_secs)?;
    let response = agent.get(url).set(PAGE_MARKER, "1").call().map_err(net_err)?;
    let mime = response.content_type().to_ascii_lowercase();
    let mut bytes = Vec::new();
    response
        .into_reader()
        .take(cap + 1)
        .read_to_end(&mut bytes)
        .map_err(net_err)?;
    if bytes.len() as u64 > cap {
        return Err(format!("picture too big: the reply at {url} is more than {} MB", cap.div_ceil(1024 * 1024)));
    }
    let mime = if known {
        match crate::files::picture_type(&bytes) {
            Some(mime) => mime.to_string(),
            None => return Err(format!("not a picture: the link leads to no PNG, JPEG, WebP, GIF, HEIC or AVIF image (it says {})", if mime.is_empty() { "nothing of what it is" } else { mime.as_str() })),
        }
    } else if mime.starts_with("image/") {
        mime
    } else {
        match ::image::guess_format(&bytes) {
            Ok(ImageFormat::Png) => "image/png".into(),
            Ok(ImageFormat::Jpeg) => "image/jpeg".into(),
            Ok(ImageFormat::WebP) => "image/webp".into(),
            _ => return Err("the link did not lead to a picture".into()),
        }
    };
    Ok(FetchedImage {
        mime,
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[derive(Serialize)]
pub struct FetchedImage {
    pub mime: String,
    pub data: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::image::{Rgba, RgbaImage};
    use std::io::Cursor;

    fn png(img: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    /// A one-shot HTTP server on a free local port that answers with `status` and `body`, and
    /// hands back the request it received.
    fn serve_once(
        status: &'static str,
        body: &'static str,
    ) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        );
        let handle = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream);
            let (mut head, mut length) = (String::new(), 0usize);
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = v.trim().parse().unwrap();
                }
                head.push_str(&line);
            }
            let mut sent = vec![0u8; length];
            reader.read_exact(&mut sent).unwrap();
            let reply = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            reader.get_mut().write_all(reply.as_bytes()).unwrap();
            format!("{head}\n{}", String::from_utf8(sent).unwrap())
        });
        (url, handle)
    }

    #[test]
    fn post_json_sends_headers_and_body_and_returns_the_reply() {
        let (url, server) = serve_once("200 OK", r#"{"choices":[{"message":{"content":"hi"}}]}"#);
        let headers = vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("authorization".to_string(), "Bearer sk-test".to_string()),
        ];
        let reply = post_json(&url, &headers, r#"{"model":"m"}"#, "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.status, 200);
        assert_eq!(reply.text, r#"{"choices":[{"message":{"content":"hi"}}]}"#);
        let seen = server.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("post /v1/chat/completions"));
        assert!(seen.contains("authorization: bearer sk-test"));
        assert!(seen.ends_with(r#"{"model":"m"}"#));
    }

    /// A one-shot HTTP server on a free local port that answers a GET with `body` as `kind`, and
    /// hands back the request's head.
    fn serve_bytes(kind: &'static str, body: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/out.png", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                head.push_str(&line);
            }
            write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: {kind}\r\ncontent-length: {}\r\n\r\n", body.len()).unwrap();
            let _ = stream.write_all(&body);   // a client that has read its fill may have gone
            head
        });
        (url, server)
    }

    #[test]
    fn fetch_image_fetches_a_picture_and_refuses_anything_else() {
        let pic = png(&RgbaImage::from_pixel(2, 2, Rgba([255, 0, 0, 255])));
        let svg = br#"<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>"#.to_vec();
        let gif = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;".to_vec();
        // (what the reply says it is, its bytes, known: an agent's add_photo) → the type, or none
        for (kind, body, known, want) in [
            ("application/octet-stream", pic.clone(), false, Some("image/png")),   // told by the bytes when the header does not say
            ("text/html", b"<html></html>".to_vec(), false, None),
            ("image/svg+xml", svg.clone(), false, Some("image/svg+xml")),   // a repaint's link: as the reply says
            ("image/svg+xml", svg, true, None),   // an agent's: only what the photo store takes
            ("image/jpeg", pic.clone(), true, Some("image/png")),   // by its bytes, whatever the header says
            ("application/octet-stream", gif, true, Some("image/gif")),
            ("text/html", b"<html></html>".to_vec(), true, None),
        ] {
            let (url, server) = serve_bytes(kind, body);
            let got = fetch_image(&url, "", 20, known).map(|img| img.mime);
            server.join().unwrap();
            assert_eq!(got.as_deref().ok(), want, "{kind}, known {known}: {got:?}");
            if known && want.is_none() {
                assert!(got.unwrap_err().starts_with("not a picture: the link leads to no PNG"), "{kind}");
            }
        }
        let (url, server) = serve_bytes("image/png", pic.clone());
        assert!(fetch_image(&url, "", 20, false).unwrap().data.starts_with("iVBORw0KGgo"));
        server.join().unwrap();
    }

    #[test]
    fn fetch_image_refuses_a_reply_past_its_cap_rather_than_cut_it_short() {
        let pic = png(&RgbaImage::from_pixel(40, 40, Rgba([0, 90, 255, 255])));
        let cap = pic.len() as u64;
        for (known, extra) in [(false, 0usize), (true, 0), (false, 1), (true, 4096)] {
            let mut body = pic.clone();
            body.extend(std::iter::repeat_n(0u8, extra));   // a PNG with more after it: past the cap by `extra`
            let (url, server) = serve_bytes("image/png", body);
            let got = fetch_capped(&url, "", 20, known, cap).map(|img| img.mime);
            server.join().unwrap();
            if extra == 0 {
                assert_eq!(got.unwrap(), "image/png", "at the cap: taken");
            } else {
                assert!(got.as_ref().unwrap_err().starts_with("picture too big: the reply at http://127.0.0.1:"), "{got:?}");
            }
        }
    }

    /// The lines of a request's head that name `header`, in lower case.
    fn lines_of(head: &str, header: &str) -> Vec<String> {
        head.to_ascii_lowercase().lines().filter(|l| l.starts_with(&format!("{header}:"))).map(|l| l.trim().to_string()).collect()
    }

    #[test]
    fn every_request_for_the_page_carries_the_marker_and_no_host_of_its_own() {
        // the page's headers try to set the marker to something else, under another case, and to
        // send another Host: one marker goes, the app's, and the URL's Host
        let page = [
            ("content-type", "application/json"),
            ("X-SmedCover-Page", "0"),
            ("x-smedcover-page", ""),
            ("Host", "evil.example"),
            ("HOST", "127.0.0.1:1"),
            ("x-other", "kept"),
        ]
        .map(|(n, v)| (n.to_string(), v.to_string()));
        for method in ["POST", "GET"] {
            let (url, server) = serve_once("200 OK", "{}");
            let at = url.split('/').nth(2).unwrap().to_string();
            send(&url, method, &page, "{}", "", 20, AI_MAX_REPLY).unwrap();
            let head = server.join().unwrap();
            assert_eq!(lines_of(&head, PAGE_MARKER), ["x-smedcover-page: 1"], "{method}: {head}");
            assert_eq!(lines_of(&head, "host"), [format!("host: {at}")], "{method}: {head}");
            assert_eq!(lines_of(&head, "x-other"), ["x-other: kept"]);
        }
        // and without any header of the page's at all
        let (url, server) = serve_once("200 OK", "{}");
        send(&url, "POST", &[], "{}", "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(lines_of(&server.join().unwrap(), PAGE_MARKER), ["x-smedcover-page: 1"]);
        // a picture at a link too
        let (url, server) = serve_bytes("image/png", png(&RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 255]))));
        fetch_image(&url, "", 20, true).unwrap();
        assert_eq!(lines_of(&server.join().unwrap(), PAGE_MARKER), ["x-smedcover-page: 1"]);
    }

    /// ureq follows a GET's redirect with the request's headers: the marker goes along.
    #[test]
    fn the_marker_follows_a_redirect() {
        use std::io::{BufRead, BufReader, Write};
        let (to, server) = serve_once("200 OK", "{}");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let from = format!("http://{}/moved", listener.local_addr().unwrap());
        let redirecting = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            write!(stream, "HTTP/1.1 302 Found\r\nlocation: {to}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n").unwrap();
        });
        send(&from, "GET", &[], "", "", 20, AI_MAX_REPLY).unwrap();
        redirecting.join().unwrap();
        let head = server.join().unwrap();
        assert!(head.to_ascii_lowercase().starts_with("get /v1/chat/completions"), "{head}");
        assert_eq!(lines_of(&head, PAGE_MARKER), ["x-smedcover-page: 1"], "{head}");
    }

    #[test]
    fn send_can_ask_with_get() {
        let (url, server) = serve_once("200 OK", r#"{"id":"gpt-image-2"}"#);
        let reply = send(&url, "GET", &[("authorization".into(), "Bearer k".into())], "ignored", "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.text, r#"{"id":"gpt-image-2"}"#);
        let seen = server.join().unwrap().to_ascii_lowercase();
        assert!(seen.starts_with("get /v1/chat/completions"), "{seen}");
        assert!(!seen.contains("ignored"));
    }

    #[test]
    fn post_json_passes_error_replies_through() {
        let (url, server) = serve_once("401 Unauthorized", r#"{"error":{"message":"bad key"}}"#);
        let reply = post_json(&url, &[], "{}", "", 20, AI_MAX_REPLY).unwrap();
        assert_eq!(reply.status, 401);
        assert_eq!(reply.text, r#"{"error":{"message":"bad key"}}"#);
        server.join().unwrap();
    }

    /// Needs the network, so it only runs on request: `cargo test -- --ignored`.
    /// Without a key both providers must answer 401 with a JSON error, which shows that TLS,
    /// any proxy from the environment and the pass-through of error replies all work.
    #[test]
    #[ignore]
    fn live_endpoints_answer_unauthenticated_requests_with_401() {
        for url in [
            "https://api.openai.com/v1/chat/completions",
            "https://api.anthropic.com/v1/messages",
        ] {
            let headers = vec![("content-type".to_string(), "application/json".to_string())];
            let reply = post_json(url, &headers, "{}", "", 20, AI_MAX_REPLY).unwrap();
            assert_eq!(reply.status, 401, "{url}: {}", reply.text);
            assert!(reply.text.contains("error"), "{url}: {}", reply.text);
        }
    }

    #[test]
    fn post_json_gives_up_after_the_timeout() {
        // a server that accepts the connection and never answers
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/slow", listener.local_addr().unwrap());
        let started = std::time::Instant::now();
        let error = post_json(&url, &[], "{}", "", 5, AI_MAX_REPLY).unwrap_err();
        assert!(error.to_lowercase().contains("timed out"), "{error}");
        assert!(started.elapsed().as_secs() >= 4 && started.elapsed().as_secs() < 15);
        drop(listener);
    }

    #[test]
    fn a_wait_that_ran_out_says_timed_out_on_windows_too() {
        use std::io::{Error, ErrorKind};
        // what ureq hands back there: the kind is right, the words are the system's
        let windows: ureq::Error = Error::new(ErrorKind::TimedOut, "A connection attempt failed because the connected party did not properly respond after a period of time, or established connection failed because connected host has failed to respond. (os error 10060)").into();
        assert!(net_err(windows).starts_with("timed out: "));
        let unix: ureq::Error = Error::new(ErrorKind::TimedOut, "timed out reading response").into();
        assert!(!net_err(unix).contains("timed out: "));   // said once only
        let refused: ureq::Error = Error::new(ErrorKind::ConnectionRefused, "connection refused").into();
        assert!(!net_err(refused).contains("timed out"));
    }

    #[test]
    fn local_hosts_never_go_through_the_environment_proxy() {
        for url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1/x",
            "https://LOCALHOST",
            "http://[::1]:8080/v1",
            "http://user@127.0.0.1:1/x",
        ] {
            assert!(is_local(url), "{url}");
            assert_eq!(proxy_for(url, ""), None, "{url}");
        }
        for url in [
            "https://api.openai.com/v1",
            "https://localhost.example.com",
            "http://10.0.0.2:8000",
        ] {
            assert!(!is_local(url), "{url}");
        }
        // a proxy given explicitly always wins, and a bad one is an error rather than ignored
        assert_eq!(
            proxy_for("http://localhost/x", " http://127.0.0.1:7890 "),
            Some("http://127.0.0.1:7890".to_string())
        );
        assert!(
            post_json("https://example.com", &[], "{}", "nonsense://x", 20, AI_MAX_REPLY)
                .unwrap_err()
                .starts_with("proxy")
        );
    }

    #[test]
    fn post_json_refuses_other_schemes_and_reports_unreachable_hosts() {
        assert!(post_json("file:///etc/passwd", &[], "{}", "", 20, AI_MAX_REPLY).is_err());
        assert!(post_json("ftp://example.com", &[], "{}", "", 20, AI_MAX_REPLY).is_err());
        // a port nothing listens on
        let free = std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap();
        assert!(post_json(&format!("http://{free}/x"), &[], "{}", "", 20, AI_MAX_REPLY).is_err());
    }
}
