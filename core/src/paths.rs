//! Where things are kept on this computer: the desktop app's data folder, which a command line or
//! a server started on the same computer finds without asking the app (its `mcp.json` and
//! `cli.json` are there).

use std::ffi::OsString;
use std::path::PathBuf;

/// The desktop app's identifier, `identifier` in `src-tauri/tauri.conf.json`: Tauri names the app's
/// data folder after it.
pub const APP_IDENTIFIER: &str = "com.cyven.smedcover";
/// The environment variable that puts the app in self-test mode, its data in `data/` under the
/// absolute path it gives (one that is not absolute is not looked at).
pub const SELFTEST_ENV: &str = "SMEDCOVER_SELFTEST";
/// The environment variable that gives the app another data folder than its own (the command line
/// sets it on the app it starts for `--data`); a path that is not absolute is taken from the folder
/// the app was started in.
pub const DATA_ENV: &str = "SMEDCOVER_DATA";

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

/// The data folder an app started now, in this environment, keeps its data in (the app's own rule,
/// for a command line to find it by too): a self-test's `data/` ([`SELFTEST_ENV`], an absolute path),
/// else [`DATA_ENV`]'s folder, else [`desktop_data_dir`]. `None` if there is none of them.
pub fn data_dir() -> Option<PathBuf> {
    data_dir_from(std::env::var_os(SELFTEST_ENV), std::env::var_os(DATA_ENV))
}

/// [`data_dir`] for the values `selftest` and `data` of its two variables.
pub fn data_dir_from(selftest: Option<OsString>, data: Option<OsString>) -> Option<PathBuf> {
    if let Some(root) = selftest.map(PathBuf::from).filter(|p| p.is_absolute()) {
        return Some(root.join("data"));
    }
    match data.filter(|d| !d.is_empty()).map(PathBuf::from) {
        Some(dir) if dir.is_absolute() => Some(dir),
        Some(dir) => std::path::absolute(&dir).ok().or_else(desktop_data_dir),
        None => desktop_data_dir(),
    }
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
    fn the_data_folder_is_a_self_tests_else_the_one_given_else_the_apps() {
        let own = desktop_data_dir();
        assert_eq!(data_dir_from(None, None), own);
        assert_eq!(data_dir_from(Some("/tmp/st".into()), Some("/elsewhere".into())), Some(PathBuf::from("/tmp/st/data")), "a self-test's first");
        assert_eq!(data_dir_from(Some("relative/st".into()), None), own, "a self-test's folder only when absolute");
        assert_eq!(data_dir_from(None, Some("/srv/smedcover".into())), Some(PathBuf::from("/srv/smedcover")));
        assert_eq!(data_dir_from(Some("st".into()), Some("/srv/smedcover".into())), Some(PathBuf::from("/srv/smedcover")));
        assert_eq!(data_dir_from(None, Some("".into())), own, "an empty one is not there");
        let relative = data_dir_from(None, Some("some/folder".into())).unwrap();
        assert!(relative.is_absolute() && relative.ends_with("some/folder"), "taken from the folder started in: {relative:?}");
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
