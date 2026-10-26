//! Reads how long each tool may go quiet (`x-smedcover.timeoutMs`) from `ui/tools.json`, which the endpoint takes off
//! before it lists the tools, into `$OUT_DIR/timeouts.rs`, so the command line waits for each as the endpoint does.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let tools = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("cargo sets it")).join("../ui/tools.json");
    println!("cargo:rerun-if-changed={}", tools.display());
    let text = fs::read_to_string(&tools).unwrap_or_else(|e| panic!("{}: {e}", tools.display()));
    let file: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", tools.display()));
    let mut out = String::from("/// Each tool of ui/tools.json and how long it may go quiet, in milliseconds.\npub const TOOL_TIMEOUTS: &[(&str, u64)] = &[\n");
    for tool in file["tools"].as_array().expect("tools.json lists its tools") {
        let name = tool["name"].as_str().expect("each tool has a name");
        // what the endpoint takes when a tool gives none (core/src/mcp/tools.rs, DEFAULT_TIMEOUT)
        let ms = tool["x-smedcover"]["timeoutMs"].as_u64().unwrap_or(120_000);
        out.push_str(&format!("    ({name:?}, {ms}),\n"));
    }
    out.push_str("];\n");
    let to = PathBuf::from(env::var("OUT_DIR").expect("cargo sets it")).join("timeouts.rs");
    fs::write(&to, out).unwrap_or_else(|e| panic!("{}: {e}", to.display()));
}
