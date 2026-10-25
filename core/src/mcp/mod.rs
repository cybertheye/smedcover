//! The MCP endpoint: agents (Claude Code, Codex, …) call SmedCover's tools over MCP's streamable
//! HTTP, and every call is handed to the page, where the tools are carried out, and its answer
//! handed back. The desktop app and a server share all of it; each brings its own page.
//!
//! * [`tools`]: the tools, read from the page's `tools.json`;
//! * [`token`]: the bearer token an agent shows;
//! * [`config`]: `mcp.json`, whether the endpoint is on, its port and its token;
//! * [`bridge`]: each call handed to the page and its answer back;
//! * [`server`]: the HTTP server, `/mcp` and `/health` on 127.0.0.1.
//!
//! A host reads its `tools.json` into a [`ToolList`] and `mcp.json` into an [`McpConfig`], keeps a
//! [`Dispatcher`] its page attaches to, and starts an [`McpServer`] on the port when the endpoint is
//! on; [`Running::stop`] ends it.

pub mod bridge;
pub mod config;
pub mod server;
pub mod token;
pub mod tools;

pub use bridge::{BridgeError, Call, Dispatcher, PageBridge, PageSink, PageState};
pub use config::McpConfig;
pub use server::{BindError, McpServer, Running, Stats, StatsSnapshot};
pub use token::Secret;
pub use tools::{Host, ToolList};
