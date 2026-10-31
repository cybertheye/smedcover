//! Which proxy a request goes through, and how it was found ([`proxy_choice`]): the one given (a
//! setting), else the environment's (`HTTPS_PROXY` and the rest, with `NO_PROXY`), else the system's
//! (Windows' Internet settings in the registry, macOS's network settings), else none.
//!
//! A program started from the Dock, the Start menu or a desktop has no proxy in its environment: the
//! system's is the one a user turned on, often by a proxy client (Clash, v2rayN) setting it for them.
//! What the system's settings say is turned into plain data ([`System`]), read at most every 30 s, and
//! decided on by pure functions, tested on every platform.

use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// How the proxy of a request was found.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    /// The one given: a setting.
    Settings,
    /// `HTTPS_PROXY`, `HTTP_PROXY` or `ALL_PROXY`.
    Environment,
    /// The system's network settings.
    System,
    /// None: straight to the host.
    Direct,
}

/// The proxy a request goes through (none for [`Via::Direct`]), as ureq takes it (`http://host:port`,
/// `socks5://…`), and how it was found. `pac`: the system's proxy is given by a PAC file, which is not
/// read, so the request goes direct where a browser might not.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProxyChoice {
    pub proxy: Option<String>,
    pub via: Via,
    pub pac: bool,
}

impl ProxyChoice {
    fn direct() -> Self {
        ProxyChoice { proxy: None, via: Via::Direct, pac: false }
    }
    /// The proxy as the user may be shown it: `host:port`, without its scheme or any name and password.
    pub fn shown(&self) -> Option<String> {
        self.proxy.as_deref().map(shown)
    }
    /// How the request went, for a message: "direct", "the system's proxy 127.0.0.1:7890", …
    pub fn describe(&self) -> String {
        let p = self.shown().unwrap_or_default();
        match self.via {
            Via::Settings => format!("the proxy in Settings {p}"),
            Via::Environment => format!("the environment's proxy {p}"),
            Via::System => format!("the system's proxy {p}"),
            Via::Direct if self.pac => "direct (the system's proxy is set by a PAC file, which is not read: give the proxy in Settings)".into(),
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

/// The system's proxy settings, as plain data. Each proxy is `host:port`, or already with a scheme.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct System {
    pub http: Option<String>,
    pub https: Option<String>,
    /// A SOCKS proxy, with its scheme (`socks4a://` on Windows, whose own requests speak SOCKS 4;
    /// `socks5://` on macOS).
    pub socks: Option<String>,
    /// Hosts that go direct: names, with `*` anywhere; `.example.com`; on macOS also `10.0/16`.
    pub bypass: Vec<String>,
    /// A host name without a dot goes direct (Windows' `<local>`, macOS's ExcludeSimpleHostnames).
    pub simple_direct: bool,
    /// The system takes its proxy from a PAC file (or WPAD), which is not read.
    pub pac: bool,
}

impl System {
    /// The proxy for a URL of this scheme, with its scheme, as a browser on that system would choose it.
    fn proxy(&self, https: bool) -> Option<String> {
        let (own, own_scheme) = if https { (&self.https, "http://") } else { (&self.http, "http://") };
        own.as_deref()
            .map(|p| with_scheme(p, own_scheme))
            .or_else(|| self.socks.clone())
    }
    fn bypasses(&self, host: &str) -> bool {
        (self.simple_direct && !host.contains('.') && !host.contains(':')) || self.bypass.iter().any(|p| pattern_matches(p, host))
    }
}

fn with_scheme(p: &str, scheme: &str) -> String {
    if p.contains("://") { p.to_string() } else { format!("{scheme}{p}") }
}

/// Windows' Internet settings (`HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings`):
/// `ProxyEnable`, `ProxyServer` (`host:port` for every scheme, or `http=…;https=…;socks=…`),
/// `ProxyOverride` (`;`-separated, `*` anywhere, `<local>`) and whether `AutoConfigURL` is set.
pub fn windows(enable: u32, server: &str, overrides: &str, auto_config: bool) -> Option<System> {
    let mut s = System { pac: auto_config, ..System::default() };
    if enable == 1 && !server.trim().is_empty() {
        if server.contains('=') {
            for part in server.split(';') {
                let Some((scheme, addr)) = part.split_once('=') else { continue };
                let addr = addr.trim();
                if addr.is_empty() {
                    continue;
                }
                match scheme.trim().to_ascii_lowercase().as_str() {
                    "http" => s.http = Some(addr.to_string()),
                    "https" => s.https = Some(addr.to_string()),
                    "socks" => s.socks = Some(with_scheme(addr, "socks4a://")),
                    _ => {}
                }
            }
        } else {
            s.http = Some(server.trim().to_string());
            s.https = Some(server.trim().to_string());
        }
        for o in overrides.split(';').map(str::trim).filter(|o| !o.is_empty()) {
            match o.to_ascii_lowercase().as_str() {
                "<local>" => s.simple_direct = true,
                "<-loopback>" => {}
                _ => s.bypass.push(o.to_string()),
            }
        }
    }
    (s.http.is_some() || s.https.is_some() || s.socks.is_some() || s.pac).then_some(s)
}

/// macOS's proxies (SCDynamicStoreCopyProxies, as `scutil --proxy` shows them): `num` and `text` look a
/// key up (`HTTPSEnable`, `HTTPSProxy`, `HTTPSPort`, the same for HTTP and SOCKS, `ExcludeSimpleHostnames`,
/// `ProxyAutoConfigEnable`), `exceptions` is ExceptionsList.
pub fn macos(num: impl Fn(&str) -> Option<i64>, text: impl Fn(&str) -> Option<String>, exceptions: Vec<String>) -> Option<System> {
    let one = |kind: &str| -> Option<String> {
        if num(&format!("{kind}Enable")) != Some(1) {
            return None;
        }
        let host = text(&format!("{kind}Proxy")).filter(|h| !h.trim().is_empty())?;
        Some(match num(&format!("{kind}Port")) {
            Some(port) => format!("{}:{port}", host.trim()),
            None => host.trim().to_string(),
        })
    };
    let s = System {
        http: one("HTTP"),
        https: one("HTTPS"),
        socks: one("SOCKS").map(|p| with_scheme(&p, "socks5://")),
        bypass: exceptions,
        simple_direct: num("ExcludeSimpleHostnames") == Some(1),
        pac: num("ProxyAutoConfigEnable") == Some(1) || num("ProxyAutoDiscoveryEnable") == Some(1),
    };
    (s.http.is_some() || s.https.is_some() || s.socks.is_some() || s.pac).then_some(s)
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

/// Whether a host is this machine (a local model server), which no proxy found for it should sit in front of.
pub fn is_loopback(host: &str) -> bool {
    host == "localhost" || host.ends_with(".localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

/// Whether a host is an address on a private network (a model server on the LAN), or a name without a
/// dot: with a proxy only the system names, such a host goes direct, as browsers' bypass lists usually say.
fn is_near(host: &str) -> bool {
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => v4.is_private() || v4.is_link_local() || v4.is_loopback() || v4.octets()[0] == 100 && (v4.octets()[1] & 0xc0) == 64,
        Ok(IpAddr::V6(v6)) => v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80,
        Err(_) => !host.contains('.'),
    }
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

/// A bypass pattern of the system's against a host: `*` anywhere, `.example.com` for the domain and the
/// names under it, an IPv4 range (`192.168.0.0/16`, or macOS's short `169.254/16`), else the name itself.
fn pattern_matches(pattern: &str, host: &str) -> bool {
    let p = pattern.trim().to_ascii_lowercase();
    let p = p.split_once("://").map_or(p.as_str(), |(_, r)| r).to_string();
    if p.contains('/') {
        return in_range(&p, host);
    }
    if let Some(domain) = p.strip_prefix('.') {
        return host == domain || host.ends_with(&p);
    }
    if p.contains('*') {
        return glob(&p, host);
    }
    let p = if p.matches(':').count() == 1 { p.split(':').next().unwrap_or("").to_string() } else { p };
    host == p
}

/// `*` matching any run of characters, the rest itself.
fn glob(pattern: &str, text: &str) -> bool {
    let parts: Vec<&str> = pattern.split('*').collect();
    let (first, last) = (parts[0], parts[parts.len() - 1]);
    if !text.starts_with(first) || text.len() < first.len() + last.len() || !text.ends_with(last) {
        return false;
    }
    let mut at = first.len();
    let end = text.len() - last.len();
    for mid in &parts[1..parts.len() - 1] {
        match text[at..end].find(mid) {
            Some(i) => at += i + mid.len(),
            None => return false,
        }
    }
    true
}

/// An IPv4 host within a range `a.b.c.d/n` (missing octets are 0: `169.254/16`).
fn in_range(range: &str, host: &str) -> bool {
    let Some((net, bits)) = range.split_once('/') else { return false };
    let (Ok(bits), Ok(std::net::IpAddr::V4(ip))) = (bits.parse::<u32>(), host.parse::<IpAddr>()) else { return false };
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

/// The choice for `url`, from the proxy given, the environment (`env` looks a variable up) and the
/// system's settings.
pub fn choose(url: &str, given: &str, env: &dyn Fn(&str) -> Option<String>, system: Option<&System>) -> ProxyChoice {
    if !given.trim().is_empty() {
        return ProxyChoice { proxy: Some(given.trim().to_string()), via: Via::Settings, pac: false };
    }
    let host = host_of(url);
    if is_loopback(&host) {
        return ProxyChoice::direct();
    }
    let https = url.get(..8).is_some_and(|s| s.eq_ignore_ascii_case("https://"));
    let names: &[&str] = if https { &["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] } else { &["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] };
    if let Some(p) = names.iter().find_map(|n| env(n).filter(|v| !v.trim().is_empty())) {
        let no = env("NO_PROXY").or_else(|| env("no_proxy")).unwrap_or_default();
        if no_proxy_matches(&no, &host) {
            return ProxyChoice::direct();
        }
        return ProxyChoice { proxy: Some(p.trim().to_string()), via: Via::Environment, pac: false };
    }
    if let Some(s) = system {
        if !is_near(&host) && !s.bypasses(&host) {
            if let Some(p) = s.proxy(https) {
                return ProxyChoice { proxy: Some(p), via: Via::System, pac: false };
            }
        }
        return ProxyChoice { pac: s.pac && s.http.is_none() && s.https.is_none() && s.socks.is_none(), ..ProxyChoice::direct() };
    }
    ProxyChoice::direct()
}

/// The proxy for `url`: the one given, else the environment's, else the system's, else none.
pub fn proxy_choice(url: &str, given: &str) -> ProxyChoice {
    let system = if given.trim().is_empty() { system() } else { None };
    choose(url, given, &|n| std::env::var(n).ok(), system.as_ref())
}

/// The system's proxy settings, read at most every 30 s (a proxy client turned on or off is seen soon).
pub fn system() -> Option<System> {
    static CACHE: Mutex<Option<(Instant, Option<System>)>> = Mutex::new(None);
    let mut cache = CACHE.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((at, s)) = cache.as_ref() {
        if at.elapsed() < Duration::from_secs(30) {
            return s.clone();
        }
    }
    let s = read_system();
    *cache = Some((Instant::now(), s.clone()));
    s
}

#[cfg(windows)]
fn read_system() -> Option<System> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_READ};
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Internet Settings", KEY_READ).ok()?;
    let enable: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    let server: String = key.get_value("ProxyServer").unwrap_or_default();
    let overrides: String = key.get_value("ProxyOverride").unwrap_or_default();
    let auto: String = key.get_value("AutoConfigURL").unwrap_or_default();
    windows(enable, &server, &overrides, !auto.trim().is_empty())
}

#[cfg(target_os = "macos")]
fn read_system() -> Option<System> {
    use system_configuration::core_foundation::array::CFArray;
    use system_configuration::core_foundation::base::{CFType, TCFType};
    use system_configuration::core_foundation::number::CFNumber;
    use system_configuration::core_foundation::string::CFString;
    use system_configuration::dynamic_store::SCDynamicStoreBuilder;
    let proxies = SCDynamicStoreBuilder::new("SmedCover").build()?.get_proxies()?;
    let find = |k: &str| proxies.find(CFString::new(k)).map(|v| v.clone());
    let num = |k: &str| find(k).and_then(|v| v.downcast::<CFNumber>()).and_then(|n| n.to_i64());
    let text = |k: &str| find(k).and_then(|v| v.downcast::<CFString>()).map(|s| s.to_string());
    let exceptions = find("ExceptionsList")
        .and_then(|v| v.downcast::<CFArray>())
        .map(|a| {
            a.get_all_values()
                .into_iter()
                // each item is held by the array, which outlives this
                .filter_map(|p| unsafe { CFType::wrap_under_get_rule(p as _) }.downcast::<CFString>().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    macos(num, text, exceptions)
}

/// Linux has no one place for it: the environment's, read above, is the system's.
#[cfg(not(any(windows, target_os = "macos")))]
fn read_system() -> Option<System> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |n| vars.iter().find(|(k, _)| *k == n).map(|(_, v)| v.to_string())
    }
    fn pick(url: &str, given: &str, vars: &[(&str, &str)], system: Option<&System>) -> (Option<String>, Via) {
        let c = choose(url, given, &env(vars), system);
        (c.proxy, c.via)
    }
    fn clash() -> System {
        windows(1, "127.0.0.1:7890", "localhost;127.*;10.*;172.16.*;192.168.*;*.lan;<local>", false).unwrap()
    }

    #[test]
    fn the_setting_then_the_environment_then_the_system_then_none() {
        let sys = clash();
        let url = "https://huggingface.co/x";
        assert_eq!(pick(url, " socks5://127.0.0.1:1080 ", &[("HTTPS_PROXY", "http://e:1")], Some(&sys)), (Some("socks5://127.0.0.1:1080".into()), Via::Settings));
        assert_eq!(pick(url, "", &[("HTTPS_PROXY", "http://e:1")], Some(&sys)), (Some("http://e:1".into()), Via::Environment));
        assert_eq!(pick(url, "", &[("ALL_PROXY", "socks5://e:2")], Some(&sys)), (Some("socks5://e:2".into()), Via::Environment));
        assert_eq!(pick(url, "", &[("HTTP_PROXY", "http://e:1")], Some(&sys)), (Some("http://127.0.0.1:7890".into()), Via::System), "HTTP_PROXY is not for https");
        assert_eq!(pick(url, "", &[("HTTPS_PROXY", "  ")], Some(&sys)), (Some("http://127.0.0.1:7890".into()), Via::System));
        assert_eq!(pick(url, "", &[], None), (None, Via::Direct));
        // a setting is used even for this machine; nothing found is
        assert_eq!(pick("http://localhost:11434/v1", "http://p:1", &[], None).1, Via::Settings);
        for local in ["http://localhost:11434/v1", "http://127.0.0.1/x", "https://LOCALHOST", "http://[::1]:8080/v1", "http://user@127.0.0.1:1/x", "http://a.localhost/"] {
            assert_eq!(pick(local, "", &[("HTTP_PROXY", "http://e:1"), ("HTTPS_PROXY", "http://e:1")], Some(&sys)), (None, Via::Direct), "{local}");
        }
    }

    #[test]
    fn no_proxy_sends_its_hosts_direct_and_not_on_to_the_system() {
        let sys = clash();
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
            assert_eq!(pick(url, "", &vars, Some(&sys)).1, if direct { Via::Direct } else { Via::Environment }, "{url}");
        }
        assert_eq!(pick("https://anything/", "", &[("https_proxy", "http://e:1"), ("no_proxy", "*")], None).1, Via::Direct);
    }

    #[test]
    fn windows_settings_as_proxy_clients_and_the_settings_page_write_them() {
        // Clash, v2rayN, the Settings page: one address for every scheme
        let s = clash();
        assert_eq!(s.proxy(true).as_deref(), Some("http://127.0.0.1:7890"));
        assert_eq!(s.proxy(false).as_deref(), Some("http://127.0.0.1:7890"));
        assert!(s.simple_direct);
        // off: none, whatever the address
        assert_eq!(windows(0, "127.0.0.1:7890", "", false), None);
        assert_eq!(windows(1, "  ", "", false), None);
        // per scheme, as a browser there chooses: https's own, else SOCKS (4, WinINet's), never http's
        let s = windows(1, "http=10.0.0.1:3128;https=10.0.0.1:3129;socks=10.0.0.1:1080", "", false).unwrap();
        assert_eq!(s.proxy(true).as_deref(), Some("http://10.0.0.1:3129"));
        assert_eq!(s.proxy(false).as_deref(), Some("http://10.0.0.1:3128"));
        let s = windows(1, "http=10.0.0.1:3128;socks=10.0.0.1:1080", "", false).unwrap();
        assert_eq!(s.proxy(true).as_deref(), Some("socks4a://10.0.0.1:1080"));
        let s = windows(1, "HTTP=10.0.0.1:3128", "", false).unwrap();
        assert_eq!(s.proxy(true), None);
        assert_eq!(choose("https://huggingface.co/", "", &env(&[]), Some(&s)).via, Via::Direct);
        // an address given with its scheme is kept as it is
        assert_eq!(windows(1, "socks5://127.0.0.1:7891", "", false).unwrap().proxy(true).as_deref(), Some("socks5://127.0.0.1:7891"));
        // a PAC file only: direct, and said so
        let pac = windows(0, "", "", true).unwrap();
        let c = choose("https://huggingface.co/", "", &env(&[]), Some(&pac));
        assert!(c.via == Via::Direct && c.pac && c.describe().contains("PAC"), "{c:?}");
    }

    #[test]
    fn windows_override_list() {
        let s = windows(1, "127.0.0.1:7890", "*.local; 10.*;*.example.com;exact.org;<local>;<-loopback>", false).unwrap();
        for (host, direct) in [
            ("printer.local", true),
            ("10.20.30.40", true),
            ("100.1.1.1", false),
            ("a.example.com", true),
            ("example.com", false),
            ("exact.org", true),
            ("www.exact.org", false),
            ("intranet", true),
            ("huggingface.co", false),
        ] {
            assert_eq!(s.bypasses(host), direct, "{host}");
        }
    }

    #[test]
    fn macos_settings_as_scutil_shows_them() {
        let dict: &[(&str, &str)] = &[("HTTPEnable", "1"), ("HTTPProxy", "127.0.0.1"), ("HTTPPort", "7897"), ("HTTPSEnable", "1"), ("HTTPSProxy", "127.0.0.1"), ("HTTPSPort", "7897"), ("SOCKSEnable", "1"), ("SOCKSProxy", "127.0.0.1"), ("SOCKSPort", "7897"), ("ExcludeSimpleHostnames", "1")];
        let num = |k: &str| dict.iter().find(|(n, _)| *n == k).and_then(|(_, v)| v.parse().ok());
        let text = |k: &str| dict.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        let s = macos(num, text, vec!["*.local".into(), "169.254/16".into(), "192.168.0.0/16".into(), "corp.example".into()]).unwrap();
        assert_eq!(s.proxy(true).as_deref(), Some("http://127.0.0.1:7897"));
        assert_eq!(s.socks.as_deref(), Some("socks5://127.0.0.1:7897"));
        for (host, direct) in [("printer.local", true), ("169.254.3.4", true), ("169.255.0.1", false), ("192.168.1.9", true), ("corp.example", true), ("nas", true), ("github.com", false)] {
            assert_eq!(s.bypasses(host), direct, "{host}");
        }
        // SOCKS alone serves https too; nothing on is none
        let socks_only: &[(&str, &str)] = &[("SOCKSEnable", "1"), ("SOCKSProxy", "10.0.0.2"), ("SOCKSPort", "1080"), ("HTTPSEnable", "0"), ("HTTPSProxy", "x")];
        let num = |k: &str| socks_only.iter().find(|(n, _)| *n == k).and_then(|(_, v)| v.parse().ok());
        let text = |k: &str| socks_only.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string());
        assert_eq!(macos(num, text, vec![]).unwrap().proxy(true).as_deref(), Some("socks5://10.0.0.2:1080"));
        assert_eq!(macos(|_| None, |_| None, vec![]), None);
        assert!(macos(|k| (k == "ProxyAutoConfigEnable").then_some(1), |_| None, vec![]).unwrap().pac);
    }

    #[test]
    fn with_the_system_s_proxy_the_lan_goes_direct() {
        let s = windows(1, "127.0.0.1:7890", "", false).unwrap();
        for (url, direct) in [
            ("http://192.168.1.20:11434/v1", true),
            ("http://10.0.0.5/", true),
            ("http://172.20.0.1/", true),
            ("http://169.254.1.1/", true),
            ("http://100.64.0.1/", true),
            ("http://[fd12::1]/", true),
            ("http://[fe80::1]/", true),
            ("http://nas:8080/", true),
            ("http://8.8.8.8/", false),
            ("https://api.deepseek.com/", false),
        ] {
            assert_eq!(choose(url, "", &env(&[]), Some(&s)).via == Via::Direct, direct, "{url}");
        }
        // the environment's proxy is the user's own choice: the LAN goes through it unless NO_PROXY says
        assert_eq!(pick("http://192.168.1.20/", "", &[("HTTP_PROXY", "http://e:1")], None).1, Via::Environment);
    }

    #[test]
    fn shown_without_scheme_or_credentials() {
        assert_eq!(shown("http://user:secret@127.0.0.1:7890/"), "127.0.0.1:7890");
        assert_eq!(shown("127.0.0.1:7890"), "127.0.0.1:7890");
        assert_eq!(shown("socks5://h:1"), "h:1");
        let c = ProxyChoice { proxy: Some("http://u:p@10.0.0.1:3128".into()), via: Via::System, pac: false };
        assert_eq!(c.describe(), "the system's proxy 10.0.0.1:3128");
        assert_eq!(host_of("https://User@Example.COM.:443/x?y"), "example.com");
    }

    /// What this machine's settings give, for looking at by hand:
    /// `cargo test -p smedcover-core net::proxy::tests::this_system -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn this_system() {
        eprintln!("{:#?}", read_system());
        eprintln!("{:?}", proxy_choice("https://huggingface.co/", ""));
    }
}
