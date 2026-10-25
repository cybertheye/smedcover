//! The tools an agent may call, as the page lists them in `ui/tools.json`: each with its MCP
//! definition (name, title, description, schemas, annotations) and, under `x-smedcover`, what only
//! SmedCover reads, which hosts offer it and how long the page may go quiet while it runs.
//!
//! ```json
//! {"format": 1, "instructions": "…",
//!  "tools": [{"name": "get_context", "title": "…", "description": "…",
//!             "inputSchema": {"type": "object", …}, "outputSchema": {…}, "annotations": {…},
//!             "x-smedcover": {"hosts": ["desktop", "server"], "timeoutMs": 30000}}]}
//! ```
//!
//! `x-smedcover` is taken off before a tool is shown to a client. A tool without it is offered by
//! every host, with [`DEFAULT_TIMEOUT`].

use std::collections::HashSet;
use std::time::Duration;

use rmcp::model::Tool;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::Res;

/// The version of the file's format this reads.
pub const FORMAT: u64 = 1;
/// How long the page may go without answering or saying how far it has got, unless the tool
/// says otherwise.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);
/// The longest any call may take, however often the page says it is getting on.
pub const MAX_TIMEOUT: Duration = Duration::from_secs(2 * 60 * 60);
/// The key of a tool's SmedCover-only settings.
const EXTENSION: &str = "x-smedcover";

/// Who offers the tools: the desktop app, or a server with a page in a browser.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Host {
    Desktop,
    Server,
}

impl Host {
    /// The name `x-smedcover.hosts` uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Host::Desktop => "desktop",
            Host::Server => "server",
        }
    }

    fn parse(name: &str) -> Option<Host> {
        match name {
            "desktop" => Some(Host::Desktop),
            "server" => Some(Host::Server),
            _ => None,
        }
    }
}

/// One tool this host offers.
#[derive(Clone, Debug)]
pub struct ToolEntry {
    /// The tool as a client sees it, `x-smedcover` taken off.
    pub tool: Tool,
    /// How long the page may go quiet while the tool runs (each word of progress starts it again).
    pub timeout: Duration,
    /// Every host that offers the tool, this one among them.
    pub hosts: Vec<Host>,
}

/// The tools one host offers, in the file's order, with the file's instructions and its hash.
#[derive(Clone, Debug)]
pub struct ToolList {
    instructions: Option<String>,
    tools: Vec<ToolEntry>,
    hash: String,
}

impl ToolList {
    /// The tools of a `tools.json` that `host` offers. The file is refused, saying why, if its
    /// format is not [`FORMAT`], if a name is not 1 to 128 of `A-Z a-z 0-9 _ . -` or is used twice,
    /// if an input schema is not an object's, or if `x-smedcover` names an unknown host or gives a
    /// timeout that is not a positive number of milliseconds (one over [`MAX_TIMEOUT`] is cut to it).
    pub fn from_json(text: &str, host: Host) -> Res<ToolList> {
        let file: Value = serde_json::from_str(text).map_err(|e| format!("tools.json: {e}"))?;
        let format = file.get("format").and_then(Value::as_u64);
        if format != Some(FORMAT) {
            return Err(format!("tools.json: format {} is not supported (this reads {FORMAT})", show(file.get("format"))));
        }
        let instructions = match file.get("instructions") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err("tools.json: instructions must be text".into()),
        };
        let Some(listed) = file.get("tools").and_then(Value::as_array) else {
            return Err("tools.json: no list of tools".into());
        };
        let mut names = HashSet::new();
        let mut tools = Vec::new();
        for (i, raw) in listed.iter().enumerate() {
            let entry = parse_tool(raw).map_err(|e| format!("tools.json: tool {} ({}): {e}", i + 1, show(raw.get("name"))))?;
            if !names.insert(entry.tool.name.to_string()) {
                return Err(format!("tools.json: the name {:?} is used twice", entry.tool.name));
            }
            if entry.hosts.contains(&host) {
                tools.push(entry);
            }
        }
        Ok(ToolList { instructions, tools, hash: hash(text) })
    }

    /// A list without tools, for a host that has not read its file.
    pub fn empty() -> ToolList {
        ToolList { instructions: None, tools: Vec::new(), hash: String::new() }
    }

    /// What the file tells an agent about using the tools.
    pub fn instructions(&self) -> Option<&str> {
        self.instructions.as_deref()
    }

    /// The SHA-256 of the whole file (as lower-case hex), whichever host reads it: the page sends
    /// the hash of the file it was built with, so a stale one can be told.
    pub fn hash(&self) -> &str {
        &self.hash
    }

    /// The tools, in the file's order.
    pub fn entries(&self) -> &[ToolEntry] {
        &self.tools
    }

    /// The tools as a client is shown them, in the file's order.
    pub fn tools(&self) -> Vec<Tool> {
        self.tools.iter().map(|t| t.tool.clone()).collect()
    }

    /// The tool called `name`, if this host offers it.
    pub fn get(&self, name: &str) -> Option<&ToolEntry> {
        self.tools.iter().find(|t| t.tool.name == name)
    }

    pub fn len(&self) -> usize {
        self.tools.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tools.is_empty()
    }
}

fn parse_tool(raw: &Value) -> Res<ToolEntry> {
    let Value::Object(fields) = raw else {
        return Err("not an object".into());
    };
    let mut fields: Map<String, Value> = fields.clone();
    let extension = fields.remove(EXTENSION);
    let name = fields.get("name").and_then(Value::as_str).ok_or("no name")?;
    if !valid_name(name) {
        return Err("a name is 1 to 128 of A-Z a-z 0-9 _ . -".into());
    }
    let schema = fields.get("inputSchema").ok_or("no inputSchema")?;
    if schema.get("type").and_then(Value::as_str) != Some("object") {
        return Err("inputSchema must be an object's (\"type\": \"object\")".into());
    }
    let (hosts, timeout) = parse_extension(extension.as_ref())?;
    let tool: Tool = serde_json::from_value(Value::Object(fields)).map_err(|e| e.to_string())?;
    Ok(ToolEntry { tool, timeout, hosts })
}

fn parse_extension(extension: Option<&Value>) -> Res<(Vec<Host>, Duration)> {
    let all = vec![Host::Desktop, Host::Server];
    let Some(extension) = extension else {
        return Ok((all, DEFAULT_TIMEOUT));
    };
    let Value::Object(extension) = extension else {
        return Err(format!("{EXTENSION} must be an object"));
    };
    let hosts = match extension.get("hosts") {
        None => all,
        Some(Value::Array(names)) => {
            let mut hosts = Vec::new();
            for name in names {
                let host = name.as_str().and_then(Host::parse).ok_or_else(|| format!("unknown host {}", show(Some(name))))?;
                if !hosts.contains(&host) {
                    hosts.push(host);
                }
            }
            hosts
        }
        Some(_) => return Err(format!("{EXTENSION}.hosts must be a list")),
    };
    let timeout = match extension.get("timeoutMs") {
        None => DEFAULT_TIMEOUT,
        Some(ms) => match ms.as_u64() {
            Some(ms) if ms > 0 => Duration::from_millis(ms).min(MAX_TIMEOUT),
            _ => return Err(format!("{EXTENSION}.timeoutMs must be a positive whole number of milliseconds")),
        },
    };
    Ok((hosts, timeout))
}

fn valid_name(name: &str) -> bool {
    (1..=128).contains(&name.len()) && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
}

fn hash(text: &str) -> String {
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// A value as it reads in a message.
fn show(value: Option<&Value>) -> String {
    match value {
        None => "none".into(),
        Some(Value::String(s)) => format!("{s:?}"),
        Some(v) => v.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn file(tools: Value) -> String {
        json!({"format": 1, "instructions": "Look first.", "tools": tools}).to_string()
    }

    fn tool(name: &str, extension: Option<Value>) -> Value {
        let mut t = json!({
            "name": name, "title": "A tool", "description": "Does a thing.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": {"readOnlyHint": true},
        });
        if let Some(x) = extension {
            t["x-smedcover"] = x;
        }
        t
    }

    #[test]
    fn reads_the_fixture() {
        let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tools.json")).unwrap();
        let desktop = ToolList::from_json(&text, Host::Desktop).unwrap();
        let server = ToolList::from_json(&text, Host::Server).unwrap();
        assert!(desktop.instructions().is_some_and(|s| !s.is_empty()));
        assert!(desktop.len() > server.len(), "the fixture has a desktop-only tool");
        assert_eq!(desktop.hash(), server.hash());
        assert_eq!(desktop.hash().len(), 64);
    }

    #[test]
    fn keeps_order_strips_the_extension_and_reads_it() {
        let text = file(json!([
            tool("b_tool", Some(json!({"hosts": ["desktop", "server"], "timeoutMs": 30000}))),
            tool("a_tool", None),
            tool("c.tool-2", Some(json!({"timeoutMs": 99_999_999_999u64}))),
        ]));
        let list = ToolList::from_json(&text, Host::Server).unwrap();
        let names: Vec<_> = list.tools().iter().map(|t| t.name.to_string()).collect();
        assert_eq!(names, ["b_tool", "a_tool", "c.tool-2"]);
        assert_eq!(list.get("b_tool").unwrap().timeout, Duration::from_secs(30));
        assert_eq!(list.get("a_tool").unwrap().timeout, DEFAULT_TIMEOUT);
        assert_eq!(list.get("c.tool-2").unwrap().timeout, MAX_TIMEOUT);
        assert_eq!(list.get("a_tool").unwrap().hosts, [Host::Desktop, Host::Server]);
        assert!(list.get("nope").is_none());
        // what a client is shown has no trace of x-smedcover, and the rest as written
        let shown = serde_json::to_value(list.tools()).unwrap();
        assert!(!shown.to_string().contains("x-smedcover"));
        assert_eq!(shown[0]["inputSchema"]["additionalProperties"], false);
        assert_eq!(shown[0]["annotations"]["readOnlyHint"], true);
        assert_eq!(shown[0]["title"], "A tool");
        assert_eq!(list.instructions(), Some("Look first."));
    }

    #[test]
    fn filters_by_host() {
        let text = file(json!([
            tool("both", None),
            tool("desk", Some(json!({"hosts": ["desktop"]}))),
            tool("serv", Some(json!({"hosts": ["server"]}))),
            tool("none", Some(json!({"hosts": []}))),
        ]));
        let names = |host| -> Vec<String> {
            ToolList::from_json(&text, host).unwrap().tools().iter().map(|t| t.name.to_string()).collect()
        };
        assert_eq!(names(Host::Desktop), ["both", "desk"]);
        assert_eq!(names(Host::Server), ["both", "serv"]);
    }

    #[test]
    fn hash_is_the_files_sha256() {
        let text = file(json!([tool("a", None)]));
        let list = ToolList::from_json(&text, Host::Desktop).unwrap();
        assert_eq!(list.hash(), hash(&text));
        // one more space is another file
        assert_ne!(ToolList::from_json(&format!("{text} "), Host::Desktop).unwrap().hash(), list.hash());
        assert_eq!(hash(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }

    #[test]
    fn refuses_what_is_wrong() {
        let refused = |text: String, why: &str| {
            let e = ToolList::from_json(&text, Host::Desktop).unwrap_err();
            assert!(e.contains(why), "{e:?} should say {why:?}");
        };
        refused("not json".into(), "tools.json");
        refused(json!({"format": 2, "tools": []}).to_string(), "format 2");
        refused(json!({"tools": []}).to_string(), "format none");
        refused(json!({"format": 1}).to_string(), "no list of tools");
        refused(file(json!([tool("a", None), tool("a", None)])), "used twice");
        refused(file(json!([tool("", None)])), "1 to 128");
        refused(file(json!([tool("has space", None)])), "1 to 128");
        refused(file(json!([tool(&"x".repeat(129), None)])), "1 to 128");
        refused(file(json!([tool("ok", Some(json!({"hosts": ["phone"]})))])), "unknown host \"phone\"");
        refused(file(json!([tool("ok", Some(json!({"timeoutMs": 0})))])), "timeoutMs");
        refused(file(json!([tool("ok", Some(json!({"timeoutMs": "60s"})))])), "timeoutMs");
        let mut untyped = tool("ok", None);
        untyped["inputSchema"] = json!({"type": "string"});
        refused(file(json!([untyped])), "tool 1 (\"ok\"): inputSchema");
        let mut unnamed = tool("ok", None);
        unnamed.as_object_mut().unwrap().remove("name");
        refused(file(json!([unnamed])), "no name");
        // a name of 128 is fine, and so are dots and dashes
        assert!(ToolList::from_json(&file(json!([tool(&"x".repeat(128), None), tool("a.b-c_d", None)])), Host::Desktop).is_ok());
    }
}
