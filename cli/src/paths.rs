//! Which data folder the command line works on: the one the app uses, unless it is told another. In that folder the
//! running app's `cli.json` says where to reach it.

use std::path::{Path, PathBuf};

/// The desktop app's identifier, as `core/src/paths.rs` has it (and Tauri names the data folder after it).
pub const APP_IDENTIFIER: &str = "com.cyven.smedcover";

/// The desktop app's data folder, as the core finds it (`smedcover_core::paths::desktop_data_dir`, the same crate
/// and version): the user's data folder and in it one named after [`APP_IDENTIFIER`].
pub fn desktop_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER))
}

/// The data folder, and whether it was named (`--data` or `SMEDCOVER_DATA`, which the app it starts is then told
/// too): the one named, made absolute against `cwd`; else a self-test's (`SMEDCOVER_SELFTEST`'s `data/`, as the app
/// keeps it there, so `SMEDCOVER_SELFTEST_STAY` reaches the app of that folder); else the desktop app's.
pub fn data_folder(named: Option<&Path>, selftest: Option<&Path>, cwd: &Path) -> Option<(PathBuf, bool)> {
    if let Some(named) = named.filter(|p| !p.as_os_str().is_empty()) {
        return Some((absolute(named, cwd), true));
    }
    if let Some(root) = selftest.filter(|p| p.is_absolute()) {
        return Some((root.join("data"), false));
    }
    desktop_data_dir().map(|dir| (dir, false))
}

/// `path` made absolute against `cwd`, as given otherwise (links not followed: the app is handed what was meant).
pub fn absolute(path: &Path, cwd: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    let mut out = cwd.to_path_buf();
    for part in path.components() {
        match part {
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_desktop_folder_is_the_cores() {
        assert_eq!(desktop_data_dir(), smedcover_core::paths::desktop_data_dir());
        assert_eq!(APP_IDENTIFIER, smedcover_core::paths::APP_IDENTIFIER);
    }

    #[test]
    fn a_folder_named_wins_then_a_selftests() {
        // absolute on every system (only the paths are worked out: nothing is touched)
        let root = std::env::temp_dir();
        let cwd = root.join("work");
        let st = root.join("st");
        assert_eq!(data_folder(Some(Path::new("d")), Some(&st), &cwd), Some((cwd.join("d"), true)));
        assert_eq!(data_folder(Some(Path::new("./d/e")), None, &cwd), Some((cwd.join("d").join("e"), true)));
        assert_eq!(data_folder(Some(&root.join("abs")), None, &cwd), Some((root.join("abs"), true)));
        assert_eq!(data_folder(None, Some(&st), &cwd), Some((st.join("data"), false)));
        // an empty name is none, and a self-test's folder must be absolute, as the app has it
        assert_eq!(data_folder(Some(Path::new("")), None, &cwd), desktop_data_dir().map(|d| (d, false)));
        assert_eq!(data_folder(None, Some(Path::new("rel")), &cwd), desktop_data_dir().map(|d| (d, false)));
    }
}
