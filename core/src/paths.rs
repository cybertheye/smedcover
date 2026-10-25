//! Where things are kept on this computer: the desktop app's data folder, which a command line or
//! a server started on the same computer finds without asking the app (its `mcp.json` is there).

use std::path::PathBuf;

/// The desktop app's identifier, `identifier` in `src-tauri/tauri.conf.json`: Tauri names the app's
/// data folder after it.
pub const APP_IDENTIFIER: &str = "com.cyven.smedcover";

/// The desktop app's data folder, as Tauri's `app_data_dir()` finds it: the user's data folder
/// (`~/Library/Application Support` on macOS, `%APPDATA%` on Windows, `$XDG_DATA_HOME` or
/// `~/.local/share` on Linux) and in it a folder named after [`APP_IDENTIFIER`]. `None` if the
/// system has no data folder for the user (no home folder).
///
/// A self-test's app keeps its data elsewhere (`SMEDCOVER_SELFTEST`'s `data/`), which this does
/// not know about.
pub fn desktop_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn identifier_is_the_apps() {
        let conf = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/tauri.conf.json");
        let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(conf).unwrap()).unwrap();
        assert_eq!(conf["identifier"], APP_IDENTIFIER);
        // a folder of the app's own may move it elsewhere; the app does not use one
        assert!(conf["app"].get("appDirectoriesOverride").is_none());
    }

    #[test]
    fn desktop_data_dir_is_named_after_the_app() {
        // only the path is worked out: nothing is read from it
        let dir = desktop_data_dir().expect("a data folder");
        assert_eq!(dir.file_name().unwrap(), APP_IDENTIFIER);
        assert_eq!(dir.parent(), dirs::data_dir().as_deref());
        #[cfg(target_os = "macos")]
        assert!(dir.ends_with("Library/Application Support/com.cyven.smedcover"));
    }
}
