//! SmedCover's core: the Rust side's work that is not the desktop window's own, for the desktop app
//! (`src-tauri/`) and a server to share.
//!
//! All drawing happens in the web view (`ui/`). This side owns the file system and the network:
//!
//! * a small sandboxed store under a data folder (profiles, settings, session, fonts): [`store`],
//!   reached through [`Core`];
//! * exporting covers: PNG bytes, framed with their metadata, converted to PNG, JPEG or WebP and
//!   written ([`image`]);
//! * sending the request for an AI-generated asset, so it is not subject to the web view's
//!   cross-origin rules ([`net`]).
//!
//! Everything here is synchronous: a host waits for it off its interface thread (the app on Tauri's
//! blocking pool). Errors are text, which the web view matches on ("timed out", "unsupported:",
//! "cancelled", "model not downloaded").

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub mod image;
pub mod net;
pub mod store;

pub type Res<T> = Result<T, String>;
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The core for one data folder: the app's (or a self-test's), or a server's. The host says which
/// folder it is and keeps one `Arc<Core>` for as long as it runs.
pub struct Core {
    data: PathBuf,
}

impl Core {
    /// The core for the data folder `data`, which is made if it is not there yet.
    pub fn open(data: PathBuf) -> Res<Arc<Core>> {
        fs::create_dir_all(&data).map_err(err)?;
        Ok(Arc::new(Core { data }))
    }

    /// The data folder.
    pub fn data_dir(&self) -> &Path {
        &self.data
    }

    /// `rel` inside the data folder (see [`store::resolve`]).
    pub fn resolve(&self, rel: &str) -> Res<PathBuf> {
        store::resolve(&self.data, rel)
    }

    /// A file of the store as text; `None` if it is not there.
    pub fn read(&self, rel: &str) -> Res<Option<String>> {
        store::read(&self.data, rel)
    }

    /// Writes a file of the store, and the folders it is in.
    pub fn write(&self, rel: &str, data: &str) -> Res<()> {
        store::write(&self.data, rel, data)
    }

    /// The names of the files in a folder of the store, sorted; none if it is not there.
    pub fn list(&self, rel: &str) -> Res<Vec<String>> {
        store::list(&self.data, rel)
    }

    /// Deletes a file of the store; one that is not there is fine.
    pub fn delete(&self, rel: &str) -> Res<()> {
        store::delete(&self.data, rel)
    }
}
