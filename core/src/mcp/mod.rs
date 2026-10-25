//! The MCP endpoint: agents (Claude Code, Codex, …) call SmedCover's tools over MCP's streamable
//! HTTP, and every call is handed to the page, where the tools are carried out, and its answer
//! handed back. The desktop app and a server share all of it; each brings its own page.
//!
//! * [`tools`]: the tools, read from the page's `tools.json`;
//! * [`token`]: the bearer token an agent shows;
//! * [`config`]: `mcp.json`, whether the endpoint is on, its port and its token;
//! * [`bridge`]: each call handed to the page and its answer back.

pub mod bridge;
pub mod config;
pub mod token;
pub mod tools;

pub use bridge::{BridgeError, Call, Dispatcher, PageBridge, PageSink, PageState};
pub use config::McpConfig;
pub use token::Secret;
pub use tools::{Host, ToolList};
