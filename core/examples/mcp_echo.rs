//! The MCP endpoint with a page played by this program, for trying a client against it:
//! `cargo run -p smedcover-core --example mcp_echo -- [port] [seconds]`. It serves the tools of
//! `tests/fixtures/tools.json` on 127.0.0.1 (port 0, the default, takes a free one; never pick the
//! app's 25277 while the app may be running), each call answered with what it was asked, and
//! `render_preview` with a 1×1 PNG. It stops after `seconds` (300 unless told).
//!
//! It wants a token, as a server always does ([`Access::Token`]). The token is not printed: the
//! header that carries it is written to a file only its owner may read, whose path is printed, for
//! `curl -H @<file>`.

use std::fs;
use std::io::Write;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use serde_json::json;
use smedcover_core::mcp::bridge::{read_result, BoxFut, BridgeError, Call, PageBridge, PageState};
use smedcover_core::mcp::server::{Access, McpServer, Stats};
use smedcover_core::mcp::{Host, Secret, ToolList};

const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

struct EchoPage;

impl PageBridge for EchoPage {
    fn call(&self, call: Call) -> BoxFut<'_, Result<rmcp::model::CallToolResult, BridgeError>> {
        Box::pin(async move {
            let asked = json!({"tool": call.tool, "args": call.args, "client": call.client});
            if call.tool == "render_preview" {
                return read_result(json!({"content": [{"type": "image", "data": PNG, "mimeType": "image/png"}]}));
            }
            read_result(json!({"structuredContent": asked}))
        })
    }

    fn page(&self) -> PageState {
        PageState::Ready { epoch: 1 }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() {
    let mut args = std::env::args().skip(1);
    let port: u16 = args.next().map(|p| p.parse().expect("a port")).unwrap_or(0);
    let seconds: u64 = args.next().map(|s| s.parse().expect("a number of seconds")).unwrap_or(300);
    let tools = ToolList::from_json(include_str!("../tests/fixtures/tools.json"), Host::Desktop).expect("the fixture");
    let secret = Secret::generate().expect("a token");
    let header_file = std::env::temp_dir().join(format!("smedcover-mcp-echo-{}.header", std::process::id()));
    write_private(&header_file, &format!("Authorization: Bearer {}\n", secret.expose()));
    let server = McpServer::new(Arc::new(EchoPage), Arc::new(tools), Arc::new(RwLock::new(Access::Token(secret))), Arc::new(Stats::new()));
    let running = server.start(([127, 0, 0, 1], port).into(), &tokio::runtime::Handle::current()).unwrap_or_else(|e| panic!("{e}"));
    println!("{}", running.url());
    println!("{}", header_file.display());
    tokio::time::sleep(Duration::from_secs(seconds)).await;
    running.stop(Duration::from_secs(2)).await;
    let _ = fs::remove_file(&header_file);
}

fn write_private(path: &std::path::Path, text: &str) {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).and_then(|mut f| f.write_all(text.as_bytes())).expect("the header file");
}
