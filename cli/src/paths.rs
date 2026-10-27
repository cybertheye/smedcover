//! Which data folder the command line works on: the one the app started now would use, by the app's own rule
//! (`smedcover_core::paths::data_dir`), so that the two never disagree. In that folder the running app's `cli.json`
//! says where to reach it. And the paths the user gives, made absolute for the app.

use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

/// The desktop app's identifier, as `core/src/paths.rs` has it (and Tauri names the data folder after it).
pub const APP_IDENTIFIER: &str = "com.cyven.smedcover";

/// The desktop app's data folder, as the core finds it (`smedcover_core::paths::desktop_data_dir`, the same crate
/// and version): the user's data folder and in it one named after [`APP_IDENTIFIER`].
pub fn desktop_data_dir() -> Option<PathBuf> {
    dirs::data_dir().map(|dir| dir.join(APP_IDENTIFIER))
}

/// The data folder, as the app finds its own: a self-test's (`SMEDCOVER_SELFTEST`'s `data/`, when it is absolute);
/// else the one named (`--data`, or `SMEDCOVER_DATA`, which clap reads for it), made absolute against `cwd` (and
/// handed to the app it starts as `SMEDCOVER_DATA`); else the desktop app's. And whether it is the one named.
pub fn data_folder(named: Option<&Path>, selftest: Option<&OsStr>, cwd: &Path) -> Option<(PathBuf, bool)> {
    if let Some(root) = selftest.map(Path::new).filter(|p| p.is_absolute()) {
        return Some((root.join("data"), false));
    }
    if let Some(named) = named.filter(|p| !p.as_os_str().is_empty()) {
        return Some((absolute(named, cwd), true));
    }
    desktop_data_dir().map(|dir| (dir, false))
}

/// `path` as the user meant it: a leading `~` the home folder (a shell leaves a quoted one as it is), and made
/// absolute against `cwd` (a Windows path on a drive but not from its root, `C:covers`, against that drive's folder),
/// links not followed: the app is handed what was meant.
pub fn absolute(path: &Path, cwd: &Path) -> PathBuf {
    let path = home_expanded(path);
    if path.is_absolute() {
        return path;
    }
    if matches!(path.components().next(), Some(Component::Prefix(_))) {
        return std::path::absolute(&path).unwrap_or(path);
    }
    let mut out = cwd.to_path_buf();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `~` or `~/…` (`~\…` on Windows) with the home folder for the `~`.
fn home_expanded(path: &Path) -> PathBuf {
    let Some(text) = path.to_str() else {
        return path.to_path_buf();
    };
    let rest = if text == "~" {
        Some("")
    } else {
        text.strip_prefix("~/").or_else(|| if cfg!(windows) { text.strip_prefix("~\\") } else { None })
    };
    match (rest, dirs::home_dir()) {
        (Some(rest), Some(home)) => home.join(rest),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn the_desktop_folder_is_the_cores() {
        assert_eq!(desktop_data_dir(), smedcover_core::paths::desktop_data_dir());
        assert_eq!(APP_IDENTIFIER, smedcover_core::paths::APP_IDENTIFIER);
    }

    /// The command line and the app it starts must find the same folder: the core's rule, case by case.
    #[test]
    fn the_folder_is_the_one_the_app_finds() {
        let root = std::env::temp_dir();
        let cwd = std::env::current_dir().unwrap();
        let st = root.join("st");
        let given = root.join("given");
        let cases: [(Option<&Path>, Option<&Path>); 7] = [
            (None, None),
            (Some(&st), Some(&given)),
            (Some(Path::new("relative/st")), None),
            (None, Some(&given)),
            (Some(Path::new("st")), Some(&given)),
            (None, Some(Path::new(""))),
            (None, Some(Path::new("some/folder"))),
        ];
        for (selftest, data) in cases {
            let ours = data_folder(data, selftest.map(Path::as_os_str), &cwd).map(|(d, _)| d);
            let apps = smedcover_core::paths::data_dir_from(selftest.map(OsString::from), data.map(OsString::from));
            assert_eq!(ours, apps, "SMEDCOVER_SELFTEST={selftest:?} SMEDCOVER_DATA={data:?}");
        }
        // named, unless a self-test's comes first
        assert_eq!(data_folder(Some(&given), None, &cwd), Some((given.clone(), true)));
        assert_eq!(data_folder(Some(&given), Some(st.as_os_str()), &cwd), Some((st.join("data"), false)));
    }

    #[test]
    fn paths_as_meant() {
        let root = std::env::temp_dir();
        let cwd = root.join("work");
        assert_eq!(absolute(Path::new("d"), &cwd), cwd.join("d"));
        assert_eq!(absolute(Path::new("./d/e"), &cwd), cwd.join("d").join("e"));
        assert_eq!(absolute(&root.join("abs"), &cwd), root.join("abs"));
        let home = dirs::home_dir().unwrap();
        assert_eq!(absolute(Path::new("~"), &cwd), home);
        assert_eq!(absolute(Path::new("~/Desktop/c.png"), &cwd), home.join("Desktop/c.png"));
        // only a leading ~ alone or before a separator is the home folder
        assert_eq!(absolute(Path::new("~covers"), &cwd), cwd.join("~covers"));
        assert_eq!(absolute(Path::new("a/~/b"), &cwd), cwd.join("a/~/b"));
        #[cfg(windows)]
        {
            let on_c = absolute(Path::new("C:covers"), &cwd);
            assert!(on_c.is_absolute() && on_c.ends_with("covers"), "{on_c:?}");
            assert_eq!(absolute(Path::new(r"\covers"), Path::new(r"D:\work")), PathBuf::from(r"D:\covers"));
        }
    }
}
