//! The command line put on the PATH, for Settings → Agents' card *Command line* (`cli_status`, `cli_install`,
//! `cli_uninstall`). Every installer has the command line, `smedcover`, beside the app's own executable
//! (tauri.conf.json's `bundle.externalBin`, built by `scripts/sidecar.mjs`); this makes it a command a terminal finds.
//!
//! * **macOS**: the command is `<the app>.app/Contents/MacOS/smedcover`, and installing it is a link to it,
//!   `/usr/local/bin/smedcover` (a folder every terminal's PATH has, by `/etc/paths`), made as the user when they may
//!   write in that folder (Homebrew leaves it so on an Intel Mac), else through the system's administrator prompt
//!   (`osascript`'s `do shell script … with administrator privileges`, the paths handed to it as arguments and quoted
//!   for the shell by `quoted form of`, never put in the script's text). What is there already decides what is done:
//!   nothing ([`State::Absent`]); a link to this app's command ([`State::Installed`]); a link to another copy's — one in
//!   a bundle's `Contents/MacOS`, or beside a `smedcover-app`: the app moved, or another copy installed it
//!   ([`State::Elsewhere`]) — which installing points at this one and uninstalling removes; anything else — a file, a
//!   folder, a link to something not SmedCover's ([`State::Foreign`]) — never replaced nor removed: the card says what
//!   is there. Uninstalling removes the link, and only a link. The prompt cancelled is no error: the card says not
//!   installed, cancelled.
//! * **Windows**: the command is `smedcover.exe` in the folder the app is installed in, and installing it puts that
//!   folder on the user's own PATH (`HKCU\Environment`'s `Path`: [`path_var`]); uninstalling takes that entry out. A
//!   terminal opened after has it.
//! * **Linux**: the `.deb` and `.rpm` put it in `/usr/bin` beside `smedcover-app`, on the PATH already
//!   ([`State::Package`]). An AppImage's is inside the AppImage, mounted while it runs only ([`State::AppImage`]): the
//!   card says a package has the command.
//! * A development build installs nothing ([`State::Dev`]): one in cargo's `target/<profile>/` (its `.fingerprint`
//!   beside it, and `smedcover` built there by `cargo build -p smedcover-cli`), and on macOS any app not in a bundle.
//!   A copy of the app with no command line beside it is [`State::Missing`].
//!
//! A self-test's folder may name another folder for the link than `/usr/local/bin` (`SMEDCOVER_SELFTEST_CLI_BIN`, an
//! absolute path, read only with `SMEDCOVER_SELFTEST`): installing and uninstalling are then done there, as the user,
//! never through the prompt, and the status says `test: true`, which has the self-test go through them (macOS).

mod path_var;

use std::env;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};
use smedcover_core::{err, Res};

/// The folder the link is put in on macOS.
const LINK_DIR: &str = "/usr/local/bin";
/// The command line's name, and the app's, in the folder they share.
const CLI: &str = "smedcover";
const APP: &str = "smedcover-app";
/// A self-test's folder for the link, in place of [`LINK_DIR`].
const TEST_DIR_ENV: &str = "SMEDCOVER_SELFTEST_CLI_BIN";

/// What is at the place the command is put, and so what the card offers.
#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// Nothing there: Install.
    Absent,
    /// This app's command: Uninstall.
    Installed,
    /// Another copy's command (macOS: where the link leads): Use this copy, Uninstall.
    Elsewhere(PathBuf),
    /// Something not SmedCover's (macOS): nothing is offered.
    Foreign(Foreign),
    /// In `/usr/bin` with the package (Linux).
    Package,
    /// Inside an AppImage (Linux): nothing to install.
    AppImage,
    /// A development build: nothing to install.
    Dev,
    /// This copy of the app has no command line beside it.
    Missing,
}

/// What is in the link's place when it is not SmedCover's.
#[derive(Debug, Clone, PartialEq)]
pub enum Foreign {
    File,
    Folder,
    /// A link, and where it leads.
    Link(PathBuf),
}

/// The card's status: the system, the state, this app's command line, where it is put (macOS: the link; Windows: the
/// folder put on the PATH; Linux: the command), whether the command line is there (a development build's need not be),
/// and whether a self-test's folder stands for `/usr/local/bin`.
#[derive(Debug, Clone, PartialEq)]
pub struct Status {
    pub state: State,
    pub cli: Option<PathBuf>,
    pub at: Option<PathBuf>,
    pub test: bool,
}

impl Status {
    fn new(state: State, cli: Option<PathBuf>, at: Option<PathBuf>) -> Status {
        Status { state, cli, at, test: false }
    }

    /// As the page has it: `{os, state, cli, at, there, to, what, test}`, `to` where another copy's link or one not
    /// SmedCover's leads, `what` what is there that is not SmedCover's (`file`, `folder`, `link`).
    pub fn json(&self) -> Value {
        let (state, to, what) = match &self.state {
            State::Absent => ("absent", None, None),
            State::Installed => ("installed", None, None),
            State::Elsewhere(to) => ("elsewhere", Some(to), None),
            State::Foreign(Foreign::File) => ("foreign", None, Some("file")),
            State::Foreign(Foreign::Folder) => ("foreign", None, Some("folder")),
            State::Foreign(Foreign::Link(to)) => ("foreign", Some(to), Some("link")),
            State::Package => ("package", None, None),
            State::AppImage => ("appimage", None, None),
            State::Dev => ("dev", None, None),
            State::Missing => ("missing", None, None),
        };
        let path = |p: Option<&PathBuf>| p.map(|p| p.display().to_string());
        json!({
            "os": OS, "state": state, "cli": path(self.cli.as_ref()), "at": path(self.at.as_ref()),
            "there": self.cli.as_deref().is_some_and(Path::is_file), "to": path(to), "what": what, "test": self.test,
        })
    }
}

/// The system, as the page tells the three apart.
const OS: &str = if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "linux" };

/// The folder of this app's executable: links followed on Unix (as the command line finds the app beside itself);
/// on Windows the path as the system gives it (`canonicalize` would make it `\\?\C:\…`, which is not for a PATH).
fn exe_dir() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    let exe = if cfg!(windows) { exe } else { fs::canonicalize(&exe).unwrap_or(exe) };
    exe.parent().map(Path::to_path_buf)
}

/// Whether `dir` is cargo's `target/<profile>/` (or `target/<triple>/<profile>/`): a development build's.
fn cargo_dir(dir: &Path) -> bool {
    dir.join(".fingerprint").is_dir()
}

/// Whether `dir` is a bundle's `Contents/MacOS` (`<name>.app/Contents/MacOS`).
fn bundle_dir(dir: &Path) -> bool {
    dir.file_name().is_some_and(|n| n == "MacOS")
        && dir.parent().is_some_and(|c| c.file_name().is_some_and(|n| n == "Contents") && c.parent().and_then(Path::extension).is_some_and(|e| e == "app"))
}

/// Whether `path` is, or was (the copy may have moved or gone since), a SmedCover command line: `smedcover` in a
/// bundle's `Contents/MacOS`, or beside a `smedcover-app`.
fn smedcover_cli(path: &Path) -> bool {
    path.file_name().is_some_and(|n| n == CLI) && path.parent().is_some_and(|d| bundle_dir(d) || d.join(APP).is_file())
}

/// Whether `a` and `b` are one file: the same path, or the same once links are followed.
fn same_file(a: &Path, b: &Path) -> bool {
    a == b || matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// What is at `link`, for `cli`, this app's command line (macOS).
pub fn link_state(link: &Path, cli: &Path) -> State {
    let meta = match fs::symlink_metadata(link) {
        Ok(meta) => meta,
        Err(e) if e.kind() == ErrorKind::NotFound => return State::Absent,
        Err(_) => return State::Foreign(Foreign::File),   // there, but not to be looked at
    };
    if !meta.file_type().is_symlink() {
        return State::Foreign(if meta.is_dir() { Foreign::Folder } else { Foreign::File });
    }
    let Ok(to) = fs::read_link(link) else { return State::Foreign(Foreign::File) };
    let to = if to.is_relative() { link.parent().unwrap_or(Path::new("/")).join(to) } else { to };
    if same_file(&to, cli) {
        State::Installed
    } else if smedcover_cli(&to) {
        State::Elsewhere(to)
    } else {
        State::Foreign(Foreign::Link(to))
    }
}

/// The folder the link is put in on macOS, and whether the administrator prompt may be used there: a self-test's
/// own folder (`SMEDCOVER_SELFTEST_CLI_BIN`, with `SMEDCOVER_SELFTEST`), never through the prompt; else
/// `/usr/local/bin`.
fn link_dir() -> (PathBuf, bool) {
    match crate::selftest_root().and(env::var_os(TEST_DIR_ENV)).map(PathBuf::from).filter(|p| p.is_absolute()) {
        Some(dir) => (dir, false),
        None => (PathBuf::from(LINK_DIR), true),
    }
}

/// The status on this system, for this app.
pub fn status() -> Status {
    let Some(dir) = exe_dir() else { return Status::new(State::Missing, None, None) };
    let cli = dir.join(format!("{CLI}{}", env::consts::EXE_SUFFIX));
    if cfg!(target_os = "macos") {
        let (links, admin) = link_dir();
        let mut s = mac_status(&dir, &cli, &links);
        s.test = !admin;
        s
    } else if cfg!(windows) {
        let state = if cargo_dir(&dir) {
            State::Dev
        } else if !cli.is_file() {
            State::Missing
        } else if path_var::has(&dir).unwrap_or(false) {
            State::Installed
        } else {
            State::Absent
        };
        Status::new(state, Some(cli), Some(dir))
    } else {
        linux_status(&dir, &cli, env::var_os("APPIMAGE").is_some_and(|a| !a.is_empty()))
    }
}

/// macOS's status for an app whose executable is in `dir`, its command line `cli` there, the link put in `links`.
fn mac_status(dir: &Path, cli: &Path, links: &Path) -> Status {
    let link = links.join(CLI);
    let state = if !bundle_dir(dir) {
        State::Dev
    } else if !cli.is_file() {
        State::Missing
    } else {
        link_state(&link, cli)
    };
    Status::new(state, Some(cli.to_path_buf()), Some(link))
}

/// Linux's status for an app whose executable is in `dir`, its command line `cli` there, run from an AppImage or not.
fn linux_status(dir: &Path, cli: &Path, appimage: bool) -> Status {
    let state = if appimage {
        State::AppImage
    } else if cargo_dir(dir) {
        State::Dev
    } else if !cli.is_file() {
        State::Missing
    } else if dir == Path::new("/usr/bin") {
        State::Package
    } else {
        State::Dev
    };
    Status::new(state, Some(cli.to_path_buf()), Some(cli.to_path_buf()))
}

/// Installs the command line (`prompt`: the words of the administrator prompt, if one is needed): the status after,
/// and `false` when the prompt was cancelled. Refused when what is there is not SmedCover's, or there is nothing to
/// install (a development build, a package's, an AppImage's, a copy without the command line).
pub fn install(prompt: &str) -> Res<(Status, bool)> {
    let s = status();
    let done = match (&s.state, s.cli.as_deref(), s.at.as_deref()) {
        (State::Installed, ..) => true,
        (State::Absent, _, Some(dir)) if cfg!(windows) => {
            path_var::add(dir).map_err(|e| format!("Could not put {} on your PATH: {e}", dir.display()))?;
            true
        }
        (State::Absent | State::Elsewhere(_), Some(cli), Some(link)) => make_link(link, cli, link_dir().1.then_some(prompt))?,
        (State::Foreign(_), _, Some(at)) => return Err(format!("{} is not SmedCover's: it is left as it is", at.display())),
        _ => return Err("There is nothing to install from this copy of SmedCover".into()),
    };
    Ok((status(), done))
}

/// Uninstalls the command line: the status after, and `false` when the prompt was cancelled. Only SmedCover's
/// command is taken away: on macOS a link to this app's or another copy's, never anything else.
pub fn uninstall(prompt: &str) -> Res<(Status, bool)> {
    let s = status();
    let done = match (&s.state, s.cli.as_deref(), s.at.as_deref()) {
        (State::Absent, ..) => true,
        (State::Installed, _, Some(dir)) if cfg!(windows) => {
            path_var::remove(dir).map_err(|e| format!("Could not take {} off your PATH: {e}", dir.display()))?;
            true
        }
        (State::Installed | State::Elsewhere(_), Some(cli), Some(link)) => remove_link(link, cli, link_dir().1.then_some(prompt))?,
        (State::Foreign(_), _, Some(at)) => return Err(format!("{} is not SmedCover's: it is left as it is", at.display())),
        _ => return Err("There is nothing to uninstall from this copy of SmedCover".into()),
    };
    Ok((status(), done))
}

/// Puts a link to `cli` at `link`, in place of another copy's link, as the user, else (refused, or the folder not
/// there yet) through the administrator prompt when `prompt` allows one: `false` when it was cancelled. What is there
/// is looked at first, and anything not SmedCover's refused.
fn make_link(link: &Path, cli: &Path, prompt: Option<&str>) -> Res<bool> {
    let replace = match link_state(link, cli) {
        State::Installed => return Ok(true),
        State::Absent => false,
        State::Elsewhere(_) => true,
        _ => return Err(format!("{} is not SmedCover's: it is left as it is", link.display())),
    };
    let tried = (|| -> io::Result<()> {
        if replace {
            fs::remove_file(link)?;   // a link (link_state): the link itself, never where it leads
        }
        symlink(cli, link)
    })();
    match tried {
        Ok(()) => Ok(true),
        Err(e) if matches!(e.kind(), ErrorKind::PermissionDenied | ErrorKind::NotFound) && prompt.is_some() => {
            let dir = link.parent().unwrap_or(Path::new("/"));
            let script = if replace { RELINK } else { LINK };
            let done = as_admin(prompt, script, &[dir, link, cli])?;
            if done && link_state(link, cli) != State::Installed {
                return Err(format!("{} was not made", link.display()));
            }
            Ok(done)
        }
        Err(e) => Err(format!("Could not make {}: {e}", link.display())),
    }
}

/// Removes the link at `link` if it is SmedCover's (this app's `cli` or another copy's), as the user, else through
/// the administrator prompt when `prompt` allows one: `false` when it was cancelled.
fn remove_link(link: &Path, cli: &Path, prompt: Option<&str>) -> Res<bool> {
    match link_state(link, cli) {
        State::Absent => return Ok(true),
        State::Installed | State::Elsewhere(_) => {}
        _ => return Err(format!("{} is not SmedCover's: it is left as it is", link.display())),
    }
    match fs::remove_file(link) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::PermissionDenied && prompt.is_some() => {
            let done = as_admin(prompt, UNLINK, &[link])?;
            if done && fs::symlink_metadata(link).is_ok() {
                return Err(format!("{} is still there", link.display()));
            }
            Ok(done)
        }
        Err(e) => Err(format!("Could not remove {}: {e}", link.display())),
    }
}

#[cfg(unix)]
fn symlink(to: &Path, link: &Path) -> io::Result<()> {
    std::os::unix::fs::symlink(to, link)
}

#[cfg(not(unix))]
fn symlink(_: &Path, _: &Path) -> io::Result<()> {
    Err(io::Error::new(ErrorKind::Unsupported, "links are made on macOS alone"))
}

/// The scripts the prompt runs, with `sh`, the paths their arguments ($1, $2…): the folder made if it is not there,
/// then the link to the command line ($3) at $2 — in place of a link alone (`-L`) for [`RELINK`] — or the link at $1
/// removed if it is one.
const LINK: &str = r#"mkdir -p "$1" && ln -s "$3" "$2""#;
const RELINK: &str = r#"mkdir -p "$1" && if [ -L "$2" ]; then rm -f "$2"; fi && ln -s "$3" "$2""#;
const UNLINK: &str = r#"if [ -L "$1" ]; then rm -f "$1"; fi"#;

/// The AppleScript that runs a script with `sh` as the administrator: its arguments are the prompt's words, the
/// script, then the script's own, each quoted for the shell by `quoted form of`, so that no path (spaces, quotes, `$`
/// and all) is ever read as part of the script. Without the prompt (`prompt: None`, the tests) the same as the user.
fn applescript(prompt: bool) -> Vec<&'static str> {
    vec![
        "on run argv",
        r#"set cmd to "/bin/sh -c " & quoted form of (item 2 of argv) & " sh""#,
        "repeat with a in items 3 thru -1 of argv",
        r#"set cmd to cmd & " " & quoted form of (contents of a)"#,
        "end repeat",
        if prompt { "do shell script cmd with prompt (item 1 of argv) with administrator privileges" } else { "do shell script cmd" },
        "end run",
    ]
}

/// Runs `script` with `sh` and `args` through `osascript`, as the administrator when `prompt` gives the prompt's words
/// (the system asks for an administrator's password), else as the user: `false` when the prompt was cancelled
/// (AppleScript's error -128), an error with what the script or the system said otherwise.
fn as_admin(prompt: Option<&str>, script: &str, args: &[&Path]) -> Res<bool> {
    let mut cmd = Command::new("/usr/bin/osascript");
    for line in applescript(prompt.is_some()) {
        cmd.arg("-e").arg(line);
    }
    cmd.arg(prompt.unwrap_or("")).arg(script).args(args);
    let out = cmd.output().map_err(err)?;
    if out.status.success() {
        return Ok(true);
    }
    let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if said.contains("(-128)") {
        return Ok(false);
    }
    Err(if said.is_empty() { format!("osascript failed ({})", out.status) } else { said })
}

/// The status, for the card.
#[tauri::command]
pub async fn cli_status() -> Res<Value> {
    tauri::async_runtime::spawn_blocking(|| status().json()).await.map_err(err)
}

/// Installs the command line (`prompt`: the administrator prompt's words, in the page's language): the status after,
/// with `cancelled: true` when the prompt was cancelled.
#[tauri::command]
pub async fn cli_install(prompt: Option<String>) -> Res<Value> {
    tauri::async_runtime::spawn_blocking(move || answer(install(prompt.as_deref().unwrap_or(PROMPT)))).await.map_err(err)?
}

/// Uninstalls the command line (`prompt` as for [`cli_install`]): the status after, with `cancelled: true` when the
/// prompt was cancelled.
#[tauri::command]
pub async fn cli_uninstall(prompt: Option<String>) -> Res<Value> {
    tauri::async_runtime::spawn_blocking(move || answer(uninstall(prompt.as_deref().unwrap_or(PROMPT)))).await.map_err(err)?
}

/// In self-test mode, the folder that stands for `/usr/local/bin` (`SMEDCOVER_SELFTEST_CLI_BIN`), if one is given: the
/// self-test then installs and uninstalls the command line there (macOS).
#[tauri::command]
pub fn selftest_cli_bin() -> Option<String> {
    let (dir, admin) = link_dir();
    (!admin).then(|| dir.display().to_string())
}

/// The prompt's words when the page gives none.
const PROMPT: &str = "SmedCover wants to put the smedcover command in /usr/local/bin.";

fn answer(r: Res<(Status, bool)>) -> Res<Value> {
    let (s, done) = r?;
    let mut v = s.json();
    v["cancelled"] = json!(!done);
    Ok(v)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// A copy of the app in `root`: `<name>.app/Contents/MacOS/` with `smedcover-app` and `smedcover`; its folder and
    /// its command line.
    fn bundle(root: &Path, name: &str) -> (PathBuf, PathBuf) {
        let dir = root.join(format!("{name}.app/Contents/MacOS"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(APP), "app").unwrap();
        fs::write(dir.join(CLI), "cli").unwrap();
        (dir.clone(), dir.join(CLI))
    }

    #[test]
    fn what_is_at_the_link_decides_what_is_done() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let (dir, cli) = bundle(root, "Smed Cover's \"copy\" $HOME");
        let (_, other) = bundle(root, "Older");
        let bin = root.join("bin");
        fs::create_dir(&bin).unwrap();
        let link = bin.join(CLI);
        let at = |s: &Status| s.state.clone();
        assert_eq!(at(&mac_status(&dir, &cli, &bin)), State::Absent);
        // this app's command: installed (the link as made, or relative, or to the bundle by another path)
        symlink(&cli, &link).unwrap();
        assert_eq!(at(&mac_status(&dir, &cli, &bin)), State::Installed);
        fs::remove_file(&link).unwrap();
        symlink(Path::new("../Smed Cover's \"copy\" $HOME.app/Contents/MacOS/smedcover"), &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Installed, "a relative link");
        fs::remove_file(&link).unwrap();
        // another copy's, there or gone (the app moved): another copy
        symlink(&other, &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(other.clone()));
        fs::remove_file(&link).unwrap();
        let gone = root.join("Downloads/SmedCover.app/Contents/MacOS/smedcover");
        symlink(&gone, &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(gone));
        fs::remove_file(&link).unwrap();
        let built = root.join("target/release");
        fs::create_dir_all(&built).unwrap();
        fs::write(built.join(APP), "app").unwrap();
        symlink(&built.join(CLI), &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(built.join(CLI)), "beside a smedcover-app");
        fs::remove_file(&link).unwrap();
        // anything else: not SmedCover's
        let brew = root.join("Cellar/smedcover/1.0/bin/smedcover");
        symlink(&brew, &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Foreign(Foreign::Link(brew)));
        fs::remove_file(&link).unwrap();
        symlink(&root.join("Other.app/Contents/MacOS/other"), &link).unwrap();
        assert!(matches!(link_state(&link, &cli), State::Foreign(Foreign::Link(_))), "another app's");
        fs::remove_file(&link).unwrap();
        fs::write(&link, "#!/bin/sh\n").unwrap();
        assert_eq!(link_state(&link, &cli), State::Foreign(Foreign::File));
        fs::remove_file(&link).unwrap();
        fs::create_dir(&link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Foreign(Foreign::Folder));
        fs::remove_dir(&link).unwrap();
        // not a bundle (a development build), or a bundle without the command line
        assert_eq!(at(&mac_status(&root.join("target/debug"), &root.join("target/debug/smedcover"), &bin)), State::Dev);
        fs::remove_file(&cli).unwrap();
        assert_eq!(at(&mac_status(&dir, &cli, &bin)), State::Missing);
    }

    #[test]
    fn installing_and_uninstalling_touch_only_smedcover_s_link() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let (_, cli) = bundle(root, "SmedCover");
        let (_, other) = bundle(root, "Older");
        let bin = root.join("bin");
        fs::create_dir(&bin).unwrap();
        let link = bin.join(CLI);
        // nothing there: made; made again: nothing to do; removed; removed again: nothing to do
        assert_eq!(make_link(&link, &cli, None), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        assert_eq!(make_link(&link, &cli, None), Ok(true));
        assert_eq!(remove_link(&link, &cli, None), Ok(true));
        assert!(fs::symlink_metadata(&link).is_err());
        assert_eq!(remove_link(&link, &cli, None), Ok(true));
        // another copy's: pointed at this one; or removed
        symlink(&other, &link).unwrap();
        assert_eq!(make_link(&link, &cli, None), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        assert!(other.is_file(), "the other copy's command left as it was");
        fs::remove_file(&link).unwrap();
        symlink(&other, &link).unwrap();
        assert_eq!(remove_link(&link, &cli, None), Ok(true));
        assert!(fs::symlink_metadata(&link).is_err() && other.is_file());
        // a file, a folder, a link not SmedCover's: refused, left as they were
        fs::write(&link, "mine").unwrap();
        assert!(make_link(&link, &cli, None).is_err());
        assert!(remove_link(&link, &cli, None).is_err());
        assert_eq!(fs::read_to_string(&link).unwrap(), "mine");
        fs::remove_file(&link).unwrap();
        let theirs = root.join("theirs");
        fs::write(&theirs, "theirs").unwrap();
        symlink(&theirs, &link).unwrap();
        assert!(make_link(&link, &cli, None).is_err());
        assert!(remove_link(&link, &cli, None).is_err());
        assert_eq!(fs::read_link(&link).unwrap(), theirs);
        fs::remove_file(&link).unwrap();
        // a folder that is not there, and no prompt allowed: an error, nothing made
        let none = root.join("no/such/bin/smedcover");
        assert!(make_link(&none, &cli, None).is_err());
        assert!(!none.parent().unwrap().exists());
        // a folder this user may not write in, and no prompt allowed: an error, the link left (unless the tests run
        // as root, whom the folder's mode does not stop)
        use std::os::unix::fs::PermissionsExt;
        symlink(&other, &link).unwrap();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o555)).unwrap();
        let root_here = fs::write(bin.join("probe"), "").is_ok();
        let refused = make_link(&link, &cli, None);
        let kept = fs::read_link(&link).ok();
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        if !root_here {
            assert!(refused.is_err(), "{refused:?}");
            assert_eq!(kept, Some(other.clone()));
        }
    }

    #[test]
    fn linux_says_the_package_s_or_the_appimage_s() {
        let tmp = tempfile::tempdir().unwrap();
        let usr = Path::new("/usr/bin");
        assert_eq!(linux_status(usr, &usr.join(CLI), true).state, State::AppImage);
        let dev = tmp.path().join("target/release");
        fs::create_dir_all(dev.join(".fingerprint")).unwrap();
        assert_eq!(linux_status(&dev, &dev.join(CLI), false).state, State::Dev);
        let opt = tmp.path().join("opt");
        fs::create_dir_all(&opt).unwrap();
        assert_eq!(linux_status(&opt, &opt.join(CLI), false).state, State::Missing);
        fs::write(opt.join(CLI), "cli").unwrap();
        assert_eq!(linux_status(&opt, &opt.join(CLI), false).state, State::Dev, "not a package's: nothing to do from here");
    }

    #[test]
    fn the_status_as_the_page_reads_it() {
        let s = Status::new(State::Elsewhere("/Users/a/Old.app/Contents/MacOS/smedcover".into()), Some("/Applications/SmedCover.app/Contents/MacOS/smedcover".into()), Some("/usr/local/bin/smedcover".into()));
        let v = s.json();
        assert_eq!(v["state"], "elsewhere");
        assert_eq!(v["to"], "/Users/a/Old.app/Contents/MacOS/smedcover");
        assert_eq!(v["at"], "/usr/local/bin/smedcover");
        assert_eq!(v["what"], Value::Null);
        assert_eq!(v["test"], false);
        let v = Status::new(State::Foreign(Foreign::Link("/opt/x".into())), None, None).json();
        assert_eq!((v["state"].as_str(), v["what"].as_str(), v["to"].as_str()), (Some("foreign"), Some("link"), Some("/opt/x")));
        let mut v = answer(Ok((Status::new(State::Absent, None, None), false))).unwrap();
        assert_eq!(v["cancelled"], true);
        v = answer(Ok((Status::new(State::Installed, None, None), true))).unwrap();
        assert_eq!(v["cancelled"], false);
    }

    /// The prompt's AppleScript, run without the prompt (as the user, in a folder of the test's), takes any path as it
    /// is: spaces, quotes of both kinds, `$`, a backslash, `;`, Chinese.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_prompt_s_script_takes_any_path() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join(r#"It's "a" $NOT_SET_X \ `true`; 封面"#);
        let (_, cli) = bundle(&root, r#"Smed "Cover" 's $(true)"#);
        let (_, other) = bundle(&root, "Older");
        let bin = root.join("new bin; true");
        let link = bin.join(CLI);
        assert_eq!(as_admin(None, LINK, &[&bin, &link, &cli]), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        fs::remove_file(&link).unwrap();
        symlink(&other, &link).unwrap();
        assert_eq!(as_admin(None, RELINK, &[&bin, &link, &cli]), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        assert_eq!(as_admin(None, UNLINK, &[&link]), Ok(true));
        assert!(fs::symlink_metadata(&link).is_err());
        fs::write(&link, "mine").unwrap();
        assert_eq!(as_admin(None, UNLINK, &[&link]), Ok(true), "not a link: left");
        assert_eq!(fs::read_to_string(&link).unwrap(), "mine");
        assert!(as_admin(None, LINK, &[&bin, &link, &cli]).is_err(), "a file there: ln says so");
        assert_eq!(fs::read_to_string(&link).unwrap(), "mine");
    }
}
