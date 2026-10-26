//! `mcp.json` in the data folder: whether the endpoint is on, its port, its token and whether an
//! agent must show it, `{"on": false, "port": 25277, "token": "smc_…", "requireToken": false}`.
//! Only the Rust side reads and writes it (the page asks for what it shows); it is written to a
//! temporary file that then takes its place, and on Unix only its owner may read it.
//!
//! The token is made and kept even while none is required, so that turning *Require a token* on has
//! one ready, and agents set up with it go on working whichever way the switch is.
//!
//! The temporary file's name is always the same (`mcp.json.tmp`), so a host saves from one place at
//! a time: under the lock it keeps its settings in.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::server::Access;
use super::token::Secret;
use crate::{err, Res};

/// The file's name in the data folder.
pub const FILE: &str = "mcp.json";
/// What a file that could not be read as settings is renamed to, for the curious, before it is
/// replaced.
pub const BAD_FILE: &str = "mcp.json.bad";
/// The port the endpoint listens on unless the user picks another (on 127.0.0.1 only).
pub const DEFAULT_PORT: u16 = 25277;
/// The lowest port the user may pick: those below are the system's.
pub const MIN_PORT: u16 = 1024;

/// What `mcp.json` holds. Its `Debug` does not show the token.
#[derive(Clone, Debug)]
pub struct McpConfig {
    pub on: bool,
    pub port: u16,
    pub token: Secret,
    /// Whether an agent must show the token (`requireToken`): off by default on the desktop, where any
    /// program that can reach 127.0.0.1 may then call, other accounts, containers and virtual
    /// machines among them (see `server.rs`).
    pub require_token: bool,
}

impl McpConfig {
    /// Off, on [`DEFAULT_PORT`], with a new token that is not required.
    pub fn new() -> Res<McpConfig> {
        Ok(McpConfig { on: false, port: DEFAULT_PORT, token: Secret::generate()?, require_token: false })
    }

    /// Who may call the endpoint these settings start: anyone, or only a client showing the token
    /// when it is required.
    pub fn access(&self) -> Access {
        if self.require_token {
            Access::Token(self.token.clone())
        } else {
            Access::Open
        }
    }

    /// The settings saved in the data folder `data`. A file that is not there gives
    /// [`McpConfig::new`]'s; so does one that cannot be read as settings (not UTF-8, not JSON, not
    /// an object), which is first renamed [`BAD_FILE`]. A port out of range gives [`DEFAULT_PORT`];
    /// a missing or malformed token is replaced with a new one; a missing `requireToken` is `false`,
    /// and one that is there but not a boolean is `true` (a garbled setting fails closed). Whatever
    /// had to be filled in or put right is saved at once, so the token stays
    /// the same from then on. On Unix a file others may read or write is made its owner's alone. Only
    /// a failure to read, rename or write the file is an error. Call it under the same lock as
    /// [`McpConfig::save`].
    pub fn load(data: &Path) -> Res<McpConfig> {
        let path = data.join(FILE);
        let bytes = match fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(format!("{FILE}: {e}")),
        };
        let saved: Option<Value> = bytes.as_deref().and_then(|b| serde_json::from_slice(b).ok()).filter(Value::is_object);
        let Some(saved) = saved else {
            if bytes.is_some() {
                fs::rename(&path, data.join(BAD_FILE)).map_err(|e| format!("{FILE}: {e}"))?;
            }
            let config = McpConfig::new()?;
            config.save(data)?;
            return Ok(config);
        };
        owner_only(&path).map_err(|e| format!("{FILE}: {e}"))?;
        let on = saved.get("on").and_then(Value::as_bool);
        let port = saved.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).filter(|p| check_port(*p).is_ok());
        let token = saved.get("token").and_then(Value::as_str).and_then(Secret::parse);
        // missing: not required, as by default; there but garbled: required, rather than open
        let require_token = saved.get("requireToken").map(|v| v.as_bool());
        let filled = on.is_none() || port.is_none() || token.is_none() || !matches!(require_token, Some(Some(_)));
        let require_token = require_token.is_some_and(|v| v.unwrap_or(true));
        let token = match token {
            Some(token) => token,
            None => Secret::generate()?,
        };
        let config = McpConfig { on: on.unwrap_or(false), port: port.unwrap_or(DEFAULT_PORT), token, require_token };
        if filled {
            config.save(data)?;
        }
        Ok(config)
    }

    /// Saves the settings in the data folder `data` (which is made if it is not there). The host
    /// saves under one lock: the temporary file's name is always the same.
    pub fn save(&self, data: &Path) -> Res<()> {
        fs::create_dir_all(data).map_err(|e| format!("{FILE}: {e}"))?;
        let text = serde_json::to_string_pretty(&json!({"on": self.on, "port": self.port, "token": self.token.expose(), "requireToken": self.require_token}))
            .map_err(err)?;
        write_private(&data.join(FILE), format!("{text}\n").as_bytes()).map_err(|e| format!("{FILE}: {e}"))
    }
}

/// `port` if the user may pick it ([`MIN_PORT`] to 65535); otherwise why not.
pub fn check_port(port: u16) -> Res<u16> {
    if port < MIN_PORT {
        return Err(format!("port {port} is the system's: pick one from {MIN_PORT} to 65535"));
    }
    Ok(port)
}

/// Writes `bytes` to a temporary file beside `path`, readable by its owner only on Unix, then puts
/// it in `path`'s place.
fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let tmp = temp_path(path);
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&tmp)?;
        #[cfg(unix)]
        {
            // the mode above applies to a file that is made; one left over keeps its own
            use std::os::unix::fs::PermissionsExt;
            file.set_permissions(fs::Permissions::from_mode(0o600))?;
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result
}

/// On Unix, takes away what others may do with the file at `path` (it holds the token).
fn owner_only(path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(path)?.permissions().mode();
        if mode & 0o077 != 0 {
            fs::set_permissions(path, fs::Permissions::from_mode(mode & 0o700))?;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn temp_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().join("data");
        // nothing there: off, the default port, a new token not required, saved at once
        let first = McpConfig::load(&data).unwrap();
        assert!(!first.on && !first.require_token);
        assert_eq!(first.port, DEFAULT_PORT);
        assert!(matches!(first.access(), Access::Open));
        assert!(data.join(FILE).is_file());
        let again = McpConfig::load(&data).unwrap();
        assert!(again.token.matches(first.token.expose()), "the token stays");
        // changed and saved
        let changed = McpConfig { on: true, port: 40001, token: Secret::generate().unwrap(), require_token: true };
        changed.save(&data).unwrap();
        let read = McpConfig::load(&data).unwrap();
        assert!(read.on && read.require_token);
        assert_eq!(read.port, 40001);
        assert!(read.token.matches(changed.token.expose()));
        assert!(matches!(read.access(), Access::Token(t) if t.matches(changed.token.expose())));
        let saved: Value = serde_json::from_str(&fs::read_to_string(data.join(FILE)).unwrap()).unwrap();
        assert_eq!(saved, json!({"on": true, "port": 40001, "token": changed.token.expose(), "requireToken": true}));
        assert!(!data.join("mcp.json.tmp").exists());
        // and off again, the token kept
        McpConfig { require_token: false, ..read.clone() }.save(&data).unwrap();
        let open = McpConfig::load(&data).unwrap();
        assert!(!open.require_token && open.token.matches(changed.token.expose()));
    }

    #[test]
    fn require_token_missing_is_off_and_garbled_is_on_each_saved() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let token = Secret::generate().unwrap();
        // missing: off, as by default; there but not a boolean: on, failing closed
        let garbled = [json!("yes"), json!("false"), json!(0), json!(1), Value::Null, json!([]), json!({})];
        let cases = [(None, false), (Some(json!(true)), true), (Some(json!(false)), false)].into_iter().chain(garbled.into_iter().map(|g| (Some(g), true)));
        for (given, wanted) in cases {
            let mut file = json!({"on": true, "port": 40002, "token": token.expose()});
            if let Some(given) = &given {
                file["requireToken"] = given.clone();
            }
            fs::write(data.join(FILE), file.to_string()).unwrap();
            let read = McpConfig::load(data).unwrap();
            assert_eq!(read.require_token, wanted, "{given:?}");
            assert!(read.on && read.port == 40002 && read.token.matches(token.expose()), "the rest is kept: {given:?}");
            let saved: Value = serde_json::from_slice(&fs::read(data.join(FILE)).unwrap()).unwrap();
            assert_eq!(saved["requireToken"], json!(wanted), "saved as read: {given:?}");
        }
    }

    #[test]
    fn fills_in_what_is_missing_or_wrong() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        fs::write(data.join(FILE), r#"{"on": true, "port": 80, "token": "smc_not-a-token"}"#).unwrap();
        let read = McpConfig::load(data).unwrap();
        assert!(read.on, "what was right is kept");
        assert_eq!(read.port, DEFAULT_PORT);
        assert!(Secret::parse(read.token.expose()).is_some());
        let reread = McpConfig::load(data).unwrap();
        assert!(reread.token.matches(read.token.expose()), "the new token was saved");
        // a file that is not settings at all starts over, off, the old one kept aside
        let not_utf8: &[u8] = b"{\"on\": true, \"token\": \"\xff\xfe\"}";
        for bad in [&b"{\"on\": tr"[..], b"[1, 2]", not_utf8] {
            fs::write(data.join(FILE), bad).unwrap();
            let fresh = McpConfig::load(data).unwrap();
            assert!(!fresh.on);
            assert!(!fresh.token.matches(read.token.expose()));
            assert_eq!(fs::read(data.join(BAD_FILE)).unwrap(), bad);
            let saved: Value = serde_json::from_slice(&fs::read(data.join(FILE)).unwrap()).unwrap();
            assert_eq!(saved["on"], false);
        }
    }

    #[test]
    fn ports() {
        assert!(check_port(1023).is_err());
        assert_eq!(check_port(1024), Ok(1024));
        assert_eq!(check_port(65535), Ok(65535));
        assert_eq!(check_port(DEFAULT_PORT), Ok(DEFAULT_PORT));
    }

    #[test]
    fn debug_does_not_show_the_token() {
        let config = McpConfig { require_token: true, ..McpConfig::new().unwrap() };
        assert!(!format!("{config:?} {:?}", config.access()).contains(config.token.expose()));
    }

    #[cfg(unix)]
    #[test]
    fn only_its_owner_may_read_it() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        // a temporary file left over, readable by all, does not pass its mode on
        fs::write(dir.path().join("mcp.json.tmp"), "x").unwrap();
        fs::set_permissions(dir.path().join("mcp.json.tmp"), fs::Permissions::from_mode(0o644)).unwrap();
        McpConfig::new().unwrap().save(dir.path()).unwrap();
        let mode = fs::metadata(dir.path().join(FILE)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        // one that others were let into (copied, restored from a backup) is taken back on reading,
        // though nothing in it had to be filled in
        fs::set_permissions(dir.path().join(FILE), fs::Permissions::from_mode(0o664)).unwrap();
        McpConfig::load(dir.path()).unwrap();
        let mode = fs::metadata(dir.path().join(FILE)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}
