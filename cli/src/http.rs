//! A small HTTP/1.1 client for the app's endpoint on 127.0.0.1, all the command line needs: one request to each
//! connection (`Connection: close`), the answer's body read by its length, in chunks or up to the close, and a handle
//! on the connection ([`HangUp`]) so that the caller can hang up while another thread is still reading the answer (a
//! call cancelled). Never through a proxy, never TLS.

use std::io::{self, BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpStream};
use std::time::Duration;

/// How long connecting may take: the app listens on this computer, so a port no one listens on refuses at once.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// How long sending a request may take.
pub const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
/// The most of a body read whole (a result carries 48 MB of images at most, as base64).
pub const MAX_BODY: u64 = 80 * 1024 * 1024;
/// The most an answer's status line and headers may come to.
const MAX_HEAD: usize = 64 * 1024;

/// A request to `127.0.0.1:<port>`.
pub struct Request<'a> {
    pub method: &'a str,
    pub path: &'a str,
    /// Besides `Host`, `Content-Length` and `Connection`, which are always sent.
    pub headers: Vec<(&'a str, String)>,
    pub body: &'a [u8],
}

/// An answer: its status and headers, its body still to be read ([`Read`]).
pub struct Response {
    pub status: u16,
    headers: Vec<(String, String)>,
    body: Body,
}

enum Body {
    Length(io::Take<BufReader<TcpStream>>),
    Chunked(Chunked<BufReader<TcpStream>>),
    Close(BufReader<TcpStream>),
}

/// The connection a request went out on, to hang up while its answer is being read elsewhere: the reading then ends,
/// and the app sees the client gone.
pub struct HangUp(TcpStream);

impl HangUp {
    pub fn now(&self) {
        let _ = self.0.shutdown(Shutdown::Both);
    }
}

/// A request sent, its answer not read yet ([`Sent::answer`]).
pub struct Sent {
    reader: BufReader<TcpStream>,
    method: String,
}

impl Sent {
    /// Reads the answer's head; its body is the caller's to read. Each read waits as long as the connection's read
    /// timeout says (none: as long as it takes, till the connection is hung up).
    pub fn answer(mut self) -> io::Result<Response> {
        let (status, headers) = read_head(&mut self.reader)?;
        let body = body_of(self.reader, &headers, status, &self.method)?;
        Ok(Response { status, headers, body })
    }
}

/// Sends `req` to the app on `port` and reads the answer's head; its body is the caller's to read. `read_timeout`:
/// how long each read may wait (`None`: as long as it takes, for an answer that comes as events).
pub fn send(port: u16, req: &Request, read_timeout: Option<Duration>) -> io::Result<(Response, HangUp)> {
    let (sent, hang_up) = start(port, req, read_timeout)?;
    Ok((sent.answer()?, hang_up))
}

/// Connects to the app on `port` and sends `req`, without waiting for the answer: it is read with [`Sent::answer`],
/// on another thread if need be, while the caller keeps the [`HangUp`]. A failure here means the request never
/// reached the app whole: nothing listens, or the connection was refused or broken while it was being sent.
pub fn start(port: u16, req: &Request, read_timeout: Option<Duration>) -> io::Result<(Sent, HangUp)> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)?;
    let _ = stream.set_nodelay(true);
    stream.set_read_timeout(read_timeout)?;
    stream.set_write_timeout(Some(WRITE_TIMEOUT))?;
    let hang_up = HangUp(stream.try_clone()?);
    let mut head = format!(
        "{} {} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Length: {}\r\nConnection: close\r\n",
        req.method,
        req.path,
        req.body.len()
    );
    for (name, value) in &req.headers {
        if value.contains(['\r', '\n']) || name.contains(['\r', '\n', ':']) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("a header that cannot be sent: {name}")));
        }
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    let mut writer = &stream;
    writer.write_all(head.as_bytes())?;
    writer.write_all(req.body)?;
    writer.flush()?;
    Ok((Sent { reader: BufReader::new(stream), method: req.method.to_string() }, hang_up))
}

/// An answer's headers, by name and value, in the order they came.
pub type Headers = Vec<(String, String)>;

/// Sends `req` and reads the whole answer: its status, its headers and its body.
pub fn exchange(port: u16, req: &Request, timeout: Duration) -> io::Result<(u16, Headers, Vec<u8>)> {
    let (response, _hang_up) = send(port, req, Some(timeout))?;
    let status = response.status;
    let headers = response.headers.clone();
    let body = response.bytes()?;
    Ok((status, headers, body))
}

impl Response {
    /// A header's value (the first, if it came more than once); names are told apart without case.
    pub fn header(&self, name: &str) -> Option<&str> {
        header(&self.headers, name)
    }

    /// The whole body, up to [`MAX_BODY`].
    pub fn bytes(mut self) -> io::Result<Vec<u8>> {
        let mut body = Vec::new();
        (&mut self).take(MAX_BODY + 1).read_to_end(&mut body)?;
        if body.len() as u64 > MAX_BODY {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "the answer is too large"));
        }
        Ok(body)
    }
}

impl Read for Response {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match &mut self.body {
            Body::Length(r) => r.read(buf),
            Body::Chunked(r) => r.read(buf),
            Body::Close(r) => r.read(buf),
        }
    }
}

/// A header's value among `headers`, its name told apart without case.
pub fn header<'a>(headers: &'a [(String, String)], name: &str) -> Option<&'a str> {
    headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
}

/// The status line and headers, past any interim answer (100 Continue).
fn read_head(reader: &mut impl BufRead) -> io::Result<(u16, Vec<(String, String)>)> {
    let bad = |why: &str| io::Error::new(io::ErrorKind::InvalidData, format!("not an HTTP answer: {why}"));
    let mut read = 0usize;
    loop {
        let line = read_line(reader, &mut read)?;
        if line.is_empty() {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the connection closed before an answer"));
        }
        let mut parts = line.splitn(3, ' ');
        let version = parts.next().unwrap_or("");
        if !version.starts_with("HTTP/1.") {
            return Err(bad("no status line"));
        }
        let status: u16 = parts.next().and_then(|s| s.parse().ok()).ok_or_else(|| bad("no status"))?;
        let mut headers = Vec::new();
        loop {
            let line = read_line(reader, &mut read)?;
            if line.is_empty() {
                break;
            }
            let (name, value) = line.split_once(':').ok_or_else(|| bad("a header without a colon"))?;
            headers.push((name.trim().to_string(), value.trim().to_string()));
        }
        if (100..200).contains(&status) && status != 101 {
            continue;
        }
        return Ok((status, headers));
    }
}

/// One line of the head, without its line end; at most [`MAX_HEAD`] bytes for the whole head.
fn read_line(reader: &mut impl BufRead, read: &mut usize) -> io::Result<String> {
    let mut line = Vec::new();
    let n = reader.by_ref().take((MAX_HEAD - (*read).min(MAX_HEAD)) as u64 + 1).read_until(b'\n', &mut line)?;
    *read += n;
    if *read > MAX_HEAD {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "the answer's headers are too long"));
    }
    while line.last().is_some_and(|b| *b == b'\n' || *b == b'\r') {
        line.pop();
    }
    String::from_utf8(line).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "headers that are not UTF-8"))
}

fn body_of(reader: BufReader<TcpStream>, headers: &[(String, String)], status: u16, method: &str) -> io::Result<Body> {
    if method == "HEAD" || status == 204 || status == 304 {
        return Ok(Body::Length(reader.take(0)));
    }
    if header(headers, "transfer-encoding").is_some_and(|v| v.to_ascii_lowercase().contains("chunked")) {
        return Ok(Body::Chunked(Chunked::new(reader)));
    }
    match header(headers, "content-length") {
        Some(n) => {
            let n: u64 = n.trim().parse().map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "a Content-Length that is not a number"))?;
            Ok(Body::Length(reader.take(n)))
        }
        None => Ok(Body::Close(reader)),
    }
}

/// A body sent in chunks (`Transfer-Encoding: chunked`), as the endpoint sends its events.
pub struct Chunked<R> {
    inner: R,
    /// What is left of the chunk being read.
    left: u64,
    done: bool,
}

impl<R: BufRead> Chunked<R> {
    pub fn new(inner: R) -> Chunked<R> {
        Chunked { inner, left: 0, done: false }
    }

    fn line(&mut self) -> io::Result<String> {
        let mut line = String::new();
        if self.inner.by_ref().take(4096).read_line(&mut line)? == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the connection closed in the middle of an answer"));
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }
}

impl<R: BufRead> Read for Chunked<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if self.done || buf.is_empty() {
            return Ok(0);
        }
        if self.left == 0 {
            let line = self.line()?;
            let size = line.split(';').next().unwrap_or("").trim();
            let size = u64::from_str_radix(size, 16)
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, format!("a chunk's size that is not one: {size:?}")))?;
            if size == 0 {
                // the trailers, up to the empty line that ends them
                while !self.line()?.is_empty() {}
                self.done = true;
                return Ok(0);
            }
            self.left = size;
        }
        let most = buf.len().min(usize::try_from(self.left).unwrap_or(usize::MAX));
        let n = self.inner.read(&mut buf[..most])?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "the connection closed in the middle of a chunk"));
        }
        self.left -= n as u64;
        if self.left == 0 && !self.line()?.is_empty() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "a chunk longer than it said"));
        }
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use std::net::TcpListener;
    use std::thread;

    fn unchunk(raw: &str) -> io::Result<String> {
        let mut out = String::new();
        Chunked::new(Cursor::new(raw.as_bytes().to_vec())).read_to_string(&mut out)?;
        Ok(out)
    }

    #[test]
    fn reads_chunks() {
        assert_eq!(unchunk("5\r\nhello\r\n7;ext=1\r\n, world\r\n0\r\n\r\n").unwrap(), "hello, world");
        assert_eq!(unchunk("0\r\nTrailer: x\r\n\r\n").unwrap(), "");
        // a chunk split however the reads fall
        let mut r = Chunked::new(BufReader::with_capacity(2, Cursor::new(b"A\r\n0123456789\r\n0\r\n\r\n".to_vec())));
        let mut out = Vec::new();
        let mut buf = [0u8; 3];
        loop {
            let n = r.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n]);
        }
        assert_eq!(out, b"0123456789");
    }

    #[test]
    fn refuses_broken_chunks() {
        assert!(unchunk("zz\r\nhello\r\n").is_err());
        assert!(unchunk("5\r\nhel").is_err(), "cut off");
        assert!(unchunk("3\r\nhello\r\n0\r\n\r\n").is_err(), "longer than it said");
    }

    /// Serves one connection with `answer`, handing back what it was sent.
    fn serve_once(answer: &'static [u8]) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut head = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                head.push_str(&line);
                if line == "\r\n" {
                    break;
                }
            }
            let length: usize = head
                .lines()
                .find_map(|l| l.strip_prefix("Content-Length: "))
                .map_or(0, |n| n.trim().parse().unwrap());
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            stream.write_all(answer).unwrap();
            head + &String::from_utf8(body).unwrap()
        });
        (port, handle)
    }

    #[test]
    fn sends_a_request_and_reads_each_kind_of_body() {
        let (port, sent) = serve_once(b"HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 5\r\n\r\nhelloEXTRA");
        let req = Request { method: "POST", path: "/x", headers: vec![("Authorization", "Bearer t".into())], body: b"{\"a\":1}" };
        let (status, headers, body) = exchange(port, &req, Duration::from_secs(5)).unwrap();
        assert_eq!(status, 200);
        assert_eq!(header(&headers, "content-type"), Some("text/plain"));
        assert_eq!(body, b"hello");
        let sent = sent.join().unwrap();
        assert!(sent.starts_with("POST /x HTTP/1.1\r\n"), "{sent}");
        assert!(sent.contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert!(sent.contains("Content-Length: 7\r\n") && sent.contains("Connection: close\r\n") && sent.contains("Authorization: Bearer t\r\n"));
        assert!(sent.ends_with("\r\n\r\n{\"a\":1}"));

        let (port, _) = serve_once(b"HTTP/1.1 200 OK\r\ntransfer-encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n");
        let (_, _, body) = exchange(port, &Request { method: "GET", path: "/", headers: vec![], body: b"" }, Duration::from_secs(5)).unwrap();
        assert_eq!(body, b"abc");

        let (port, _) = serve_once(b"HTTP/1.1 404 Not Found\r\n\r\nuntil the close");
        let (status, _, body) = exchange(port, &Request { method: "GET", path: "/", headers: vec![], body: b"" }, Duration::from_secs(5)).unwrap();
        assert_eq!((status, body.as_slice()), (404, b"until the close".as_slice()));
    }

    #[test]
    fn refuses_a_header_that_would_split_the_request() {
        let req = Request { method: "GET", path: "/", headers: vec![("X", "a\r\nInjected: 1".into())], body: b"" };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert_eq!(send(port, &req, None).err().unwrap().kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn a_port_no_one_listens_on_refuses() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        // the listener is dropped: nothing listens there now
        assert!(exchange(port, &Request { method: "GET", path: "/", headers: vec![], body: b"" }, Duration::from_secs(2)).is_err());
    }
}
