//! Which proxy a request goes through, and how it was found ([`proxy_choice`]): the one given (a
//! setting), else the environment's (`HTTPS_PROXY` and the rest, with `NO_PROXY`), else none. The
//! system's proxy settings (Windows', macOS's) are not read: a proxy is used only where the user gave one,
//! in Settings or in the environment SmedCover was started from.

use std::net::IpAddr;

use serde::Serialize;

/// How the proxy of a request was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    /// The one given: a setting.
    Settings,
    /// `HTTPS_PROXY`, `HTTP_PROXY` or `ALL_PROXY`.
    Environment,
    /// None: straight to the host.
    Direct,
}

/// The proxy a request goes through (none for [`Via::Direct`]), as ureq takes it (`http://host:port`,
/// `socks5://…`), and how it was found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProxyChoice {
    pub proxy: Option<String>,
    pub via: Via,
}

impl ProxyChoice {
    fn direct() -> Self {
        ProxyChoice { proxy: None, via: Via::Direct }
    }
    /// The proxy as the user may be shown it: `host:port`, without its scheme or any name and password.
    pub fn shown(&self) -> Option<String> {
        self.proxy.as_deref().map(shown)
    }
    /// How the request went, for a message: "direct", "the proxy in Settings 127.0.0.1:7890", …
    pub fn describe(&self) -> String {
        let p = self.shown().unwrap_or_default();
        match self.via {
            Via::Settings => format!("the proxy in Settings {p}"),
            Via::Environment => format!("the environment's proxy {p}"),
            Via::Direct => "direct".into(),
        }
    }
}

/// A proxy without its scheme or credentials: `http://u:p@127.0.0.1:7890/` → `127.0.0.1:7890`.
pub fn shown(proxy: &str) -> String {
    let rest = proxy.trim().split_once("://").map_or(proxy.trim(), |(_, r)| r);
    let rest = rest.rsplit_once('@').map_or(rest, |(_, r)| r);
    rest.trim_end_matches('/').to_string()
}

/// The host of an http(s) URL, lower case, without brackets, port or credentials.
pub fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map_or(url, |(_, r)| r);
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = authority.rsplit('@').next().unwrap_or("");
    let host = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.split(':').next().unwrap_or(""),
    };
    host.trim_end_matches('.').to_ascii_lowercase()
}

/// Whether a host is this machine (a local model server), which the environment's proxy should not sit in front of.
pub fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.ends_with(".localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Whether `NO_PROXY` (`no_proxy`) names the host: `*`, a name (and the names under it), `.example.com`,
/// `*.example.com`, an address, an IPv4 range `10.0.0.0/8`; a port after any of them is ignored.
fn no_proxy_matches(list: &str, host: &str) -> bool {
    list.split([',', ' ']).map(str::trim).filter(|e| !e.is_empty()).any(|e| {
        if e == "*" {
            return true;
        }
        let e = e.strip_prefix("*.").or_else(|| e.strip_prefix('.')).unwrap_or(e);
        let e = if e.starts_with('[') { e.trim_start_matches('[').split(']').next().unwrap_or("") } else if e.matches(':').count() == 1 { e.split(':').next().unwrap_or("") } else { e };
        let e = e.to_ascii_lowercase();
        if e.contains('/') {
            return in_range(&e, host);
        }
        host == e || host.ends_with(&format!(".{e}"))
    })
}

/// An IPv4 host within a range `a.b.c.d/n`.
fn in_range(range: &str, host: &str) -> bool {
    let Some((net, bits)) = range.split_once('/') else { return false };
    let (Ok(bits), Ok(IpAddr::V4(ip))) = (bits.parse::<u32>(), host.parse::<IpAddr>()) else { return false };
    let mut octets = [0u8; 4];
    for (i, o) in net.split('.').enumerate() {
        match (i < 4, o.parse::<u8>()) {
            (true, Ok(v)) => octets[i] = v,
            _ => return false,
        }
    }
    if bits > 32 {
        return false;
    }
    let mask = if bits == 0 { 0 } else { u32::MAX << (32 - bits) };
    (u32::from(ip) & mask) == (u32::from_be_bytes(octets) & mask)
}

/// The choice for `url`, from the proxy given and the environment (`env` looks a variable up).
pub fn choose(url: &str, given: &str, env: &dyn Fn(&str) -> Option<String>) -> ProxyChoice {
    if !given.trim().is_empty() {
        return ProxyChoice { proxy: Some(given.trim().to_string()), via: Via::Settings };
    }
    let host = host_of(url);
    if is_loopback(&host) {
        return ProxyChoice::direct();
    }
    let https = url.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"));
    let names: &[&str] = if https { &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] } else { &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] };
    if let Some(p) = names.iter().find_map(|n| env(n).filter(|v| !v.trim().is_empty())) {
        let no = env("NO_PROXY").or_else(|| env("no_proxy")).unwrap_or_default();
        if !no_proxy_matches(&no, &host) {
            return ProxyChoice { proxy: Some(p.trim().to_string()), via: Via::Environment };
        }
    }
    ProxyChoice::direct()
}

/// The proxy for `url`: the one given, else the environment's, else none.
pub fn proxy_choice(url: &str, given: &str) -> ProxyChoice {
    choose(url, given, &|n| std::env::var(n).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |n| vars.iter().find(|(k, _)| *k == n).map(|(_, v)| v.to_string())
    }
    fn pick(url: &str, given: &str, vars: &[(&str, &str)]) -> (Option<String>, Via) {
        let c = choose(url, given, &env(vars));
        (c.proxy, c.via)
    }

    #[test]
    fn the_setting_then_the_environment_then_none() {
        let url = "https://huggingface.co/x";
        assert_eq!(pick(url, " socks5://127.0.0.1:1080 ", &[("HTTPS_PROXY", "http://e:1")]), (Some("socks5://127.0.0.1:1080".into()), Via::Settings));
        assert_eq!(pick(url, "", &[("HTTPS_PROXY", "http://e:1")]), (Some("http://e:1".into()), Via::Environment));
        assert_eq!(pick(url, "", &[("ALL_PROXY", "socks5://e:2")]), (Some("socks5://e:2".into()), Via::Environment));
        assert_eq!(pick(url, "", &[("HTTP_PROXY", "http://e:1")]), (None, Via::Direct), "HTTP_PROXY is not for https");
        assert_eq!(pick(url, "", &[("HTTPS_PROXY", "  ")]), (None, Via::Direct));
        assert_eq!(pick(url, "", &[]), (None, Via::Direct), "nothing given: direct, whatever the system's settings say");
        // a setting is used even for this machine; the environment's is not
        assert_eq!(pick("http://localhost:11434/v1", "http://p:1", &[]).1, Via::Settings);
        for local in ["http://localhost:11434/v1", "http://127.0.0.1/x", "https://LOCALHOST", "http://[::1]:8080/v1", "http://user@127.0.0.1:1/x", "http://a.localhost/"] {
            assert_eq!(pick(local, "", &[("HTTP_PROXY", "http://e:1"), ("HTTPS_PROXY", "http://e:1")]), (None, Via::Direct), "{local}");
        }
        // the LAN goes through the environment's proxy unless NO_PROXY says
        assert_eq!(pick("http://192.168.1.20/", "", &[("HTTP_PROXY", "http://e:1")]).1, Via::Environment);
    }

    #[test]
    fn no_proxy_sends_its_hosts_direct() {
        let vars = [("HTTPS_PROXY", "http://e:1"), ("NO_PROXY", "example.com, .corp.net,10.0.0.0/8,*.internal,[fd00::1],host:8080")];
        for (url, direct) in [
            ("https://example.com/", true),
            ("https://api.example.com/", true),
            ("https://notexample.com/", false),
            ("https://corp.net/", true),
            ("https://a.b.corp.net/", true),
            ("https://10.1.2.3/", true),
            ("https://11.1.2.3/", false),
            ("https://x.internal/", true),
            ("https://[fd00::1]/", true),
            ("https://host/", true),
            ("https://huggingface.co/", false),
        ] {
            assert_eq!(pick(url, "", &vars).1, if direct { Via::Direct } else { Via::Environment }, "{url}");
        }
        assert_eq!(pick("https://anything/", "", &[("https_proxy", "http://e:1"), ("no_proxy", "*")]).1, Via::Direct);
    }

    #[test]
    fn shown_without_scheme_or_credentials() {
        assert_eq!(shown("http://user:secret@127.0.0.1:7890/"), "127.0.0.1:7890");
        assert_eq!(shown("127.0.0.1:7890"), "127.0.0.1:7890");
        assert_eq!(shown("socks5://h:1"), "h:1");
        let c = ProxyChoice { proxy: Some("http://u:p@10.0.0.1:3128".into()), via: Via::Environment };
        assert_eq!(c.describe(), "the environment's proxy 10.0.0.1:3128");
        assert_eq!(ProxyChoice::direct().describe(), "direct");
        assert_eq!(host_of("https://User@Example.COM.:443/x?y"), "example.com");
    }
}
