//! `mcp.json` in the data folder: whether the endpoint is on, its port, and its token,
//! `{"on": false, "port": 25277, "token": "smc_…"}`. Only the Rust side reads and writes it (the
//! page asks for what it shows); it is written to a temporary file that then takes its place, and on
//! Unix only its owner may read it.

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::token::Secret;
use crate::{err, Res};

/// The file's name in the data folder.
pub const FILE: &str = "mcp.json";
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
}

impl McpConfig {
    /// Off, on [`DEFAULT_PORT`], with a new token.
    pub fn new() -> Res<McpConfig> {
        Ok(McpConfig { on: false, port: DEFAULT_PORT, token: Secret::generate()? })
    }

    /// The settings saved in the data folder `data`. A file that is not there, or that cannot be
    /// read as settings, gives [`McpConfig::new`]'s; a port out of range gives [`DEFAULT_PORT`]; a
    /// missing or malformed token is replaced with a new one. Whatever had to be filled in is saved
    /// at once, so the token stays the same from then on. Only a failure to read or write the file
    /// is an error.
    pub fn load(data: &Path) -> Res<McpConfig> {
        let path = data.join(FILE);
        let text = match fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => return Err(format!("{FILE}: {e}")),
        };
        let saved: Option<Value> = text.as_deref().and_then(|t| serde_json::from_str(t).ok()).filter(Value::is_object);
        let Some(saved) = saved else {
            let config = McpConfig::new()?;
            config.save(data)?;
            return Ok(config);
        };
        let on = saved.get("on").and_then(Value::as_bool);
        let port = saved.get("port").and_then(Value::as_u64).and_then(|p| u16::try_from(p).ok()).filter(|p| check_port(*p).is_ok());
        let token = saved.get("token").and_then(Value::as_str).and_then(Secret::parse);
        let filled = on.is_none() || port.is_none() || token.is_none();
        let token = match token {
            Some(token) => token,
            None => Secret::generate()?,
        };
        let config = McpConfig { on: on.unwrap_or(false), port: port.unwrap_or(DEFAULT_PORT), token };
        if filled {
            config.save(data)?;
        }
        Ok(config)
    }

    /// Saves the settings in the data folder `data` (which is made if it is not there).
    pub fn save(&self, data: &Path) -> Res<()> {
        fs::create_dir_all(data).map_err(|e| format!("{FILE}: {e}"))?;
        let text = serde_json::to_string_pretty(&json!({"on": self.on, "port": self.port, "token": self.token.expose()})).map_err(err)?;
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
        // nothing there: off, the default port, a new token, saved at once
        let first = McpConfig::load(&data).unwrap();
        assert!(!first.on);
        assert_eq!(first.port, DEFAULT_PORT);
        assert!(data.join(FILE).is_file());
        let again = McpConfig::load(&data).unwrap();
        assert!(again.token.matches(first.token.expose()), "the token stays");
        // changed and saved
        let changed = McpConfig { on: true, port: 40001, token: Secret::generate().unwrap() };
        changed.save(&data).unwrap();
        let read = McpConfig::load(&data).unwrap();
        assert!(read.on);
        assert_eq!(read.port, 40001);
        assert!(read.token.matches(changed.token.expose()));
        let saved: Value = serde_json::from_str(&fs::read_to_string(data.join(FILE)).unwrap()).unwrap();
        assert_eq!(saved, json!({"on": true, "port": 40001, "token": changed.token.expose()}));
        assert!(!data.join("mcp.json.tmp").exists());
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
        // a file that is not settings at all starts over, off
        fs::write(data.join(FILE), "{\"on\": tr").unwrap();
        let fresh = McpConfig::load(data).unwrap();
        assert!(!fresh.on);
        assert!(!fresh.token.matches(read.token.expose()));
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
        let config = McpConfig::new().unwrap();
        assert!(!format!("{config:?}").contains(config.token.expose()));
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
    }
}
