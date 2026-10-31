//! The command line put on the PATH, for Settings → Agents' card *Command line* (`cli_status`, `cli_install`,
//! `cli_uninstall`). Every installer has the command line, `smedcover`, beside the app's own executable
//! (tauri.conf.json's `bundle.externalBin`, built by `scripts/sidecar.mjs`); this makes it a command a terminal finds.
//!
//! * **macOS**: the command is `<the app>.app/Contents/MacOS/smedcover`, and installing it is a link to it,
//!   `/usr/local/bin/smedcover` (a folder every terminal's PATH has, by `/etc/paths`), made as the user when they may
//!   write in that folder (Homebrew leaves it so on an Intel Mac), else through the system's administrator prompt
//!   ([`as_admin`]: `osascript` with an environment of its own, its `do shell script … with administrator privileges`
//!   running a fixed script that names every program by its path and looks again at what is there before it changes
//!   anything; the paths handed to it as arguments, quoted for the shell by `quoted form of`, never put in a script's
//!   text). What is there already decides what is done: nothing ([`State::Absent`]); a link to this app's command
//!   ([`State::Installed`]); a link to another copy's — one beside a `smedcover-app`, or in a bundle whose identifier is
//!   SmedCover's, or, gone, one that was in a bundle's `Contents/MacOS` (the app moved) — ([`State::Elsewhere`]), which
//!   installing points at this one and uninstalling removes; anything else — a file, a folder, a link to something not
//!   SmedCover's ([`State::Foreign`]) — never replaced nor removed: the card says what is there. Uninstalling removes the
//!   link, and only a link. The prompt cancelled is no error: the card says not installed, cancelled. An app run from
//!   where it will not stay — moved aside by the system's App Translocation (a download opened where it was), or a disk
//!   image's read-only volume — installs nothing ([`State::Moved`]): the link would die with it; it is to be moved to
//!   Applications first.
//! * **Windows**: the command is `smedcover.exe` in the folder the app is installed in, which holds its uninstaller and
//!   its own executable too: so installing it copies it into a folder of its own, `%LOCALAPPDATA%\com.cyven.smedcover\bin`
//!   (the app's local folder, Tauri's `app_local_data_dir`), beside an `app-path` file naming the app's executable (the
//!   command line reads it to start the app: `cli/src/app.rs`), and puts that folder on the user's own PATH
//!   (`HKCU\Environment`'s `Path`: [`path_var`]); uninstalling takes the entry out and the folder away. The app makes
//!   the copy anew as it starts when it is on the PATH and differs ([`refresh`]: an update brings a new one), and the
//!   NSIS uninstaller removes the folder (`windows/hooks.nsh`). A terminal opened after has the command.
//! * **Linux**: the `.deb` and `.rpm` put it in `/usr/bin` beside `smedcover-app`, on the PATH already
//!   ([`State::Package`]). An AppImage's is inside the AppImage, mounted while it runs only ([`State::AppImage`]): the
//!   card says a package has the command. A copy elsewhere, not a package's ([`State::Unpackaged`]), is left to the user.
//! * A development build installs nothing ([`State::Dev`]): one in cargo's `target/<profile>/` (its `.fingerprint`
//!   beside it, and `smedcover` built there by `cargo build -p smedcover-cli`), and on macOS any app not in a bundle.
//!   A copy of the app with no command line beside it is [`State::Missing`].
//!
//! Refusals and failures are kinds ([`Fail`]), which the page says in its language. A self-test's folder may name
//! another folder for the link than `/usr/local/bin` (`SMEDCOVER_SELFTEST_CLI_BIN`, an absolute path, read only with
//! `SMEDCOVER_SELFTEST`, and on macOS alone): installing and uninstalling are then done there, as the user, never through
//! the prompt, and the status says `test: true`, which has the self-test go through them.

mod path_var;

use std::env;
use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Value};

/// The folder the link is put in on macOS.
const LINK_DIR: &str = "/usr/local/bin";
/// The command line's name, and the app's, in the folder they share.
const CLI: &str = "smedcover";
const APP: &str = "smedcover-app";
/// The app's identifier (tauri.conf.json's): its bundle's `CFBundleIdentifier`, and on Windows the name of its local
/// folder, where the command line's own folder is.
const IDENTIFIER: &str = "com.cyven.smedcover";
/// The file beside Windows' copy of the command line that names the app's executable (`cli/src/app.rs`'s `APP_PATH`).
const APP_PATH: &str = "app-path";
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
    /// Run from where it will not stay (macOS: translocated, or a read-only volume): to be moved to Applications first.
    Moved,
    /// In `/usr/bin` with the package (Linux).
    Package,
    /// Inside an AppImage (Linux): nothing to install.
    AppImage,
    /// A copy not installed from a package (Linux): its command is where it is; nothing is done from here.
    Unpackaged,
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

/// The card's status: the state, this app's command line, where it is put (macOS: the link; Windows: the folder put on
/// the PATH; Linux: the command), and whether a self-test's folder stands for `/usr/local/bin`.
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

    /// As the page has it: `{os, state, cli, at, there, to, what, test}`, `there` whether the command line is there (a
    /// development build's need not be), `to` where another copy's link or one not SmedCover's leads, `what` what is
    /// there that is not SmedCover's (`file`, `folder`, `link`).
    pub fn json(&self) -> Value {
        let (state, to, what) = match &self.state {
            State::Absent => ("absent", None, None),
            State::Installed => ("installed", None, None),
            State::Elsewhere(to) => ("elsewhere", Some(to), None),
            State::Foreign(Foreign::File) => ("foreign", None, Some("file")),
            State::Foreign(Foreign::Folder) => ("foreign", None, Some("folder")),
            State::Foreign(Foreign::Link(to)) => ("foreign", Some(to), Some("link")),
            State::Moved => ("moved", None, None),
            State::Package => ("package", None, None),
            State::AppImage => ("appimage", None, None),
            State::Unpackaged => ("unpackaged", None, None),
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

/// Why an install or an uninstall was refused or failed, for the page to say in its language: `foreign` (something
/// not SmedCover's is there), `moved` (the app is run from where it will not stay), `nothing` (nothing to install or
/// uninstall from this copy), `changed` (what is there changed while the prompt was up), `failed` (the system's words
/// in `message`).
#[derive(Debug, Clone, PartialEq)]
pub struct Fail {
    pub kind: &'static str,
    pub message: String,
}

impl Fail {
    fn new(kind: &'static str, message: impl Into<String>) -> Fail {
        Fail { kind, message: message.into() }
    }
    fn foreign(at: &Path) -> Fail {
        Fail::new("foreign", format!("{} is not SmedCover's: it is left as it is", at.display()))
    }
    fn json(&self) -> Value {
        json!({"kind": self.kind, "message": self.message})
    }
}

/// The system, as the page tells the three apart.
const OS: &str = if cfg!(target_os = "macos") { "macos" } else if cfg!(windows) { "windows" } else { "linux" };

/// This app's executable: links followed on Unix (as the command line finds the app beside itself); on Windows the
/// path as the system gives it (`canonicalize` would make it `\\?\C:\…`, which is not for a PATH).
pub(crate) fn exe() -> Option<PathBuf> {
    let exe = env::current_exe().ok()?;
    Some(if cfg!(windows) { exe } else { fs::canonicalize(&exe).unwrap_or(exe) })
}

/// Whether `dir` is cargo's `target/<profile>/` (or `target/<triple>/<profile>/`): a development build's.
fn cargo_dir(dir: &Path) -> bool {
    dir.join(".fingerprint").is_dir()
}

/// Whether `dir` is a bundle's `Contents/MacOS` (`<name>.app/Contents/MacOS`).
pub(crate) fn bundle_dir(dir: &Path) -> bool {
    dir.file_name().is_some_and(|n| n == "MacOS")
        && dir.parent().is_some_and(|c| c.file_name().is_some_and(|n| n == "Contents") && c.parent().and_then(Path::extension).is_some_and(|e| e == "app"))
}

/// Whether the bundle whose `Contents/MacOS` is `dir` says it is SmedCover (its `Info.plist`'s `CFBundleIdentifier`,
/// as the bundler writes it, in XML).
fn smedcover_bundle(dir: &Path) -> bool {
    let Ok(plist) = fs::read_to_string(dir.with_file_name("Info.plist")) else { return false };
    let compact: String = plist.split_whitespace().collect();
    compact.contains(&format!("<key>CFBundleIdentifier</key><string>{IDENTIFIER}</string>"))
}

/// Whether `path` is, or was, a SmedCover command line: `smedcover` beside a `smedcover-app`, or in a bundle that says
/// it is SmedCover; and, no longer there (the app moved or was removed), one that was in a bundle's `Contents/MacOS`.
fn smedcover_cli(path: &Path) -> bool {
    let Some(dir) = path.parent() else { return false };
    if path.file_name().is_none_or(|n| n != CLI) {
        return false;
    }
    if fs::symlink_metadata(path).is_ok() {
        dir.join(APP).is_file() || (bundle_dir(dir) && smedcover_bundle(dir))
    } else {
        bundle_dir(dir)
    }
}

/// Whether `a` and `b` are one file: the same path, or the same once links are followed.
fn same_file(a: &Path, b: &Path) -> bool {
    a == b || matches!((fs::canonicalize(a), fs::canonicalize(b)), (Ok(x), Ok(y)) if x == y)
}

/// Where the link at `link` leads, as written (relative or not), and as a path.
fn read_link(link: &Path) -> Option<(PathBuf, PathBuf)> {
    let raw = fs::read_link(link).ok()?;
    let to = if raw.is_relative() { link.parent().unwrap_or(Path::new("/")).join(&raw) } else { raw.clone() };
    Some((raw, to))
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
    let Some((_, to)) = read_link(link) else { return State::Foreign(Foreign::File) };
    if same_file(&to, cli) {
        State::Installed
    } else if smedcover_cli(&to) {
        State::Elsewhere(to)
    } else {
        State::Foreign(Foreign::Link(to))
    }
}

/// Whether an app in `dir` is run from where it will not stay: moved aside by App Translocation (a downloaded app
/// opened where it was, run from a random folder under `/private/var/folders/…/AppTranslocation/`), or on a read-only
/// volume (a disk image).
pub(crate) fn moved(dir: &Path) -> bool {
    dir.components().any(|c| c.as_os_str() == "AppTranslocation") || read_only(dir)
}

/// Whether the volume `path` is on is mounted read-only.
#[cfg(target_os = "macos")]
fn read_only(path: &Path) -> bool {
    use std::os::unix::ffi::OsStrExt;
    let Ok(c) = std::ffi::CString::new(path.as_os_str().as_bytes()) else { return false };
    let mut fs: libc::statfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a NUL-ended path and `fs` a statfs the call fills.
    unsafe { libc::statfs(c.as_ptr(), &mut fs) == 0 && fs.f_flags & libc::MNT_RDONLY as u32 != 0 }
}

#[cfg(not(target_os = "macos"))]
fn read_only(_: &Path) -> bool {
    false
}

/// The folder the link is put in on macOS, and whether the administrator prompt may be used there: a self-test's
/// own folder (`SMEDCOVER_SELFTEST_CLI_BIN`, with `SMEDCOVER_SELFTEST`), never through the prompt; else
/// `/usr/local/bin`.
fn link_dir() -> (PathBuf, bool) {
    match test_dir() {
        Some(dir) => (dir, false),
        None => (PathBuf::from(LINK_DIR), true),
    }
}

/// A self-test's folder for the link (macOS alone: it stands for `/usr/local/bin`, which only macOS uses).
fn test_dir() -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    crate::selftest_root().and(env::var_os(TEST_DIR_ENV)).map(PathBuf::from).filter(|p| p.is_absolute())
}

/// The folder Windows' copy of the command line is put in, and put on the PATH: `bin` in the app's local folder
/// (`%LOCALAPPDATA%\com.cyven.smedcover`, Tauri's `app_local_data_dir`; the NSIS uninstaller's "delete the app's data"
/// removes it too). Not the folder the app is installed in (its uninstaller and its executable are there), nor in it
/// (the per-user install's is `%LOCALAPPDATA%\SmedCover`, which its uninstaller removes only empty).
fn win_bin() -> Option<PathBuf> {
    env::var_os("LOCALAPPDATA").filter(|d| !d.is_empty()).map(|d| PathBuf::from(d).join(IDENTIFIER).join("bin"))
}

/// The command line's file name on this system.
fn cli_name() -> String {
    format!("{CLI}{}", env::consts::EXE_SUFFIX)
}

/// The status on this system, for this app.
pub fn status() -> Status {
    let Some(exe) = exe() else { return Status::new(State::Missing, None, None) };
    let Some(dir) = exe.parent() else { return Status::new(State::Missing, None, None) };
    let cli = dir.join(cli_name());
    if cfg!(target_os = "macos") {
        let (links, admin) = link_dir();
        let mut s = mac_status(dir, &cli, &links);
        s.test = !admin;
        s
    } else if cfg!(windows) {
        win_status(dir, &cli, win_bin(), &|bin| path_var::has(bin).unwrap_or(false))
    } else {
        let appimage = in_appimage(dir, env::var_os("APPIMAGE").as_deref(), env::var_os("APPDIR").as_deref());
        linux_status(dir, &cli, appimage)
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
        match link_state(&link, cli) {
            State::Installed => State::Installed,   // uninstalled from here, wherever the app is run from
            _ if moved(dir) => State::Moved,
            other => other,
        }
    };
    Status::new(state, Some(cli.to_path_buf()), Some(link))
}

/// Windows' status for an app whose executable is in `dir`, its command line `cli` there, its own folder `bin`
/// (installed when that folder is on the user's PATH, as `on_path` says, and the copy is in it).
fn win_status(dir: &Path, cli: &Path, bin: Option<PathBuf>, on_path: &dyn Fn(&Path) -> bool) -> Status {
    let state = match &bin {
        _ if cargo_dir(dir) => State::Dev,
        _ if !cli.is_file() => State::Missing,
        None => State::Missing,
        Some(bin) if on_path(bin) && bin.join(cli.file_name().unwrap_or_default()).is_file() => State::Installed,
        Some(_) => State::Absent,
    };
    Status::new(state, Some(cli.to_path_buf()), bin)
}

/// Whether an app in `dir` runs from an AppImage: `APPIMAGE` set (the AppImage's runtime sets it, and the programs it
/// starts inherit it) and the app inside its mount (`APPDIR`, or a `/tmp/.mount_…` folder).
fn in_appimage(dir: &Path, appimage: Option<&std::ffi::OsStr>, appdir: Option<&std::ffi::OsStr>) -> bool {
    appimage.is_some_and(|a| !a.is_empty())
        && (appdir.is_some_and(|d| !d.is_empty() && dir.starts_with(d)) || dir.components().any(|c| c.as_os_str().to_string_lossy().starts_with(".mount_")))
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
        State::Unpackaged
    };
    Status::new(state, Some(cli.to_path_buf()), Some(cli.to_path_buf()))
}

/// Installs the command line (`prompt`: the words of the administrator prompt, if one is needed): the status after,
/// and `false` when the prompt was cancelled.
pub fn install(prompt: &str) -> Result<(Status, bool), Fail> {
    let s = status();
    let done = match (&s.state, s.cli.as_deref(), s.at.as_deref()) {
        (State::Installed, ..) if !cfg!(windows) => true,
        (State::Absent | State::Installed, Some(cli), Some(bin)) if cfg!(windows) => {
            let app = exe().ok_or_else(|| Fail::new("failed", "this app's executable is not known"))?;
            place_copy(cli, bin, &app).map_err(|e| Fail::new("failed", format!("Could not copy the command line into {}: {e}", bin.display())))?;
            path_var::add(bin).map_err(|e| Fail::new("failed", format!("Could not put {} on your PATH: {e}", bin.display())))?;
            true
        }
        (State::Absent | State::Elsewhere(_), Some(cli), Some(link)) => make_link(link, cli, link_dir().1.then_some(prompt))?,
        (State::Foreign(_), _, Some(at)) => return Err(Fail::foreign(at)),
        (State::Moved, ..) => return Err(Fail::new("moved", "Move SmedCover to Applications first, open it from there, then install")),
        _ => return Err(Fail::new("nothing", "There is nothing to install from this copy of SmedCover")),
    };
    Ok((status(), done))
}

/// Uninstalls the command line: the status after, and `false` when the prompt was cancelled. Only SmedCover's
/// command is taken away: on macOS a link to this app's or another copy's, never anything else; on Windows the PATH's
/// entry and the folder's copy.
pub fn uninstall(prompt: &str) -> Result<(Status, bool), Fail> {
    let s = status();
    let done = match (&s.state, s.cli.as_deref(), s.at.as_deref()) {
        (State::Absent, _, Some(bin)) if cfg!(windows) => {
            remove_copy(bin).map_err(|e| Fail::new("failed", format!("Could not remove {}: {e}", bin.display())))?;
            true
        }
        (State::Absent, ..) => true,
        (State::Installed, _, Some(bin)) if cfg!(windows) => {
            path_var::remove(bin).map_err(|e| Fail::new("failed", format!("Could not take {} off your PATH: {e}", bin.display())))?;
            remove_copy(bin).map_err(|e| Fail::new("failed", format!("Could not remove {}: {e}", bin.display())))?;
            true
        }
        (State::Installed | State::Elsewhere(_), Some(cli), Some(link)) => remove_link(link, cli, link_dir().1.then_some(prompt))?,
        (State::Foreign(_), _, Some(at)) => return Err(Fail::foreign(at)),
        _ => return Err(Fail::new("nothing", "There is nothing to uninstall from this copy of SmedCover")),
    };
    Ok((status(), done))
}

/// Puts a link to `cli` at `link`, in place of another copy's link, as the user, else (refused, or the folder not
/// there yet) through the administrator prompt when `prompt` allows one: `false` when it was cancelled. What is there
/// is looked at first, and anything not SmedCover's refused; the prompt's script looks again before it changes anything.
fn make_link(link: &Path, cli: &Path, prompt: Option<&str>) -> Result<bool, Fail> {
    let was = match link_state(link, cli) {
        State::Installed => return Ok(true),
        State::Absent => None,
        State::Elsewhere(_) => Some(read_link(link).map(|(raw, _)| raw).ok_or_else(|| Fail::foreign(link))?),
        _ => return Err(Fail::foreign(link)),
    };
    let tried = (|| -> io::Result<()> {
        if was.is_some() {
            fs::remove_file(link)?;   // a link (link_state): the link itself, never where it leads
        }
        symlink(cli, link)
    })();
    match tried {
        Ok(()) => Ok(true),
        Err(e) if matches!(e.kind(), ErrorKind::PermissionDenied | ErrorKind::NotFound) && prompt.is_some() => {
            let dir = link.parent().unwrap_or(Path::new("/"));
            let done = match &was {
                None => as_admin(prompt, LINK, &[dir, link, cli])?,
                Some(raw) => as_admin(prompt, RELINK, &[dir, link, cli, raw])?,
            };
            if done && link_state(link, cli) != State::Installed {
                return Err(Fail::new("failed", format!("{} was not made", link.display())));
            }
            Ok(done)
        }
        Err(e) => Err(Fail::new("failed", format!("Could not make {}: {e}", link.display()))),
    }
}

/// Removes the link at `link` if it is SmedCover's (this app's `cli` or another copy's), as the user, else through
/// the administrator prompt when `prompt` allows one: `false` when it was cancelled.
fn remove_link(link: &Path, cli: &Path, prompt: Option<&str>) -> Result<bool, Fail> {
    match link_state(link, cli) {
        State::Absent => return Ok(true),
        State::Installed | State::Elsewhere(_) => {}
        _ => return Err(Fail::foreign(link)),
    }
    let raw = read_link(link).map(|(raw, _)| raw).ok_or_else(|| Fail::foreign(link))?;
    match fs::remove_file(link) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::PermissionDenied && prompt.is_some() => {
            let done = as_admin(prompt, UNLINK, &[link, &raw])?;
            if done && fs::symlink_metadata(link).is_ok() {
                return Err(Fail::new("failed", format!("{} is still there", link.display())));
            }
            Ok(done)
        }
        Err(e) => Err(Fail::new("failed", format!("Could not remove {}: {e}", link.display()))),
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

/// What each script the prompt runs begins with: the system's own folders alone on the PATH, files made readable by
/// all but writable by their owner (root) alone.
const SAFE: &str = "PATH=/usr/bin:/bin:/usr/sbin:/sbin; export PATH; umask 022";
/// The scripts the prompt runs with `/bin/sh`, the paths their arguments, every program named by its path. [`LINK`]:
/// the folder `$1` made if it is not there, then a link at `$2` to the command line `$3`, only if nothing is there
/// (`-e` or `-L`). [`RELINK`]: the link at `$2` replaced by one to `$3` only if it still leads where it did, `$4`
/// (`readlink`, as written). [`UNLINK`]: the link at `$1` removed only if it still leads to `$2`. Any other finding is
/// said on stderr, and nothing done.
const LINK: &str = r#"/bin/mkdir -p "$1" || exit 1
if [ -e "$2" ] || [ -L "$2" ]; then echo "changed: $2 is there already" >&2; exit 1; fi
exec /bin/ln -s "$3" "$2""#;
const RELINK: &str = r#"/bin/mkdir -p "$1" || exit 1
if [ ! -L "$2" ] || [ "$(/usr/bin/readlink "$2")" != "$4" ]; then echo "changed: $2 is not the link it was" >&2; exit 1; fi
/bin/rm -f "$2" || exit 1
exec /bin/ln -s "$3" "$2""#;
const UNLINK: &str = r#"if [ ! -L "$1" ] || [ "$(/usr/bin/readlink "$1")" != "$2" ]; then echo "changed: $1 is not the link it was" >&2; exit 1; fi
exec /bin/rm -f "$1""#;

/// The AppleScript that runs a script with `/bin/sh` as the administrator: its arguments are the prompt's words, the
/// script (after [`SAFE`]), then the script's own, each quoted for the shell by `quoted form of`, so that no path
/// (spaces, quotes, `$` and all) is ever read as part of the script. Without the prompt (`prompt: false`, the tests) the
/// same as the user.
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

/// Runs `script` with `/bin/sh` and `args` through `osascript`, as the administrator when `prompt` gives the prompt's
/// words (the system asks for an administrator's password), else as the user: `false` when the prompt was cancelled
/// (AppleScript's error -128), a [`Fail`] with what the script or the system said otherwise (`changed` when the script
/// found what is there changed). `osascript` gets no environment of this app's but the system's PATH (the app started by
/// a command line has the terminal's): a shell started as root through it would otherwise take its PATH, and with it a
/// program of the same name planted in a folder the user may write in, and the functions bash imports from the
/// environment (`BASH_FUNC_…`), and `ENV` and `BASH_ENV`.
fn as_admin(prompt: Option<&str>, script: &str, args: &[&Path]) -> Result<bool, Fail> {
    let mut cmd = osascript(prompt, script, args);
    let out = cmd.output().map_err(|e| Fail::new("failed", e.to_string()))?;
    if out.status.success() {
        return Ok(true);
    }
    let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if said.contains("(-128)") {
        return Ok(false);
    }
    if said.contains("changed: ") {
        return Err(Fail::new("changed", said));
    }
    Err(Fail::new("failed", if said.is_empty() { format!("osascript failed ({})", out.status) } else { said }))
}

/// The `osascript` command [`as_admin`] runs: its environment cleared but for the system's PATH, `--` before the
/// arguments (the prompt's words may begin with `-`).
fn osascript(prompt: Option<&str>, script: &str, args: &[&Path]) -> Command {
    let mut cmd = Command::new("/usr/bin/osascript");
    cmd.env_clear().env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
    for line in applescript(prompt.is_some()) {
        cmd.arg("-e").arg(line);
    }
    cmd.arg("--").arg(prompt.unwrap_or("")).arg(format!("{SAFE}\n{script}")).args(args);
    cmd
}

/// Puts a copy of the command line `cli` in `bin` (Windows' folder on the PATH), with an [`APP_PATH`] file naming the
/// app's executable `app` beside it: each written only when it is not there or differs (the copy through a temporary
/// file renamed over it). Whether anything was written.
fn place_copy(cli: &Path, bin: &Path, app: &Path) -> io::Result<bool> {
    fs::create_dir_all(bin)?;
    let mut wrote = false;
    let copy = bin.join(cli.file_name().unwrap_or_default());
    if !same_bytes(cli, &copy) {
        let part = bin.join(format!(".{CLI}.part"));
        fs::copy(cli, &part)?;
        if let Err(e) = fs::rename(&part, &copy) {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
        wrote = true;
    }
    let named = app.display().to_string();
    if fs::read_to_string(bin.join(APP_PATH)).ok().as_deref().map(str::trim) != Some(named.as_str()) {
        fs::write(bin.join(APP_PATH), &named)?;
        wrote = true;
    }
    Ok(wrote)
}

/// Whether two files hold the same bytes (`false` when either cannot be read).
fn same_bytes(a: &Path, b: &Path) -> bool {
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(x), Ok(y)) if x.len() == y.len() => matches!((fs::read(a), fs::read(b)), (Ok(x), Ok(y)) if x == y),
        _ => false,
    }
}

/// Takes the copy and its [`APP_PATH`] out of `bin`, then the folder if nothing else is in it.
fn remove_copy(bin: &Path) -> io::Result<()> {
    for name in [cli_name(), APP_PATH.to_string()] {
        match fs::remove_file(bin.join(name)) {
            Err(e) if e.kind() != ErrorKind::NotFound => return Err(e),
            _ => {}
        }
    }
    let _ = fs::remove_dir(bin);   // not when something else is in it
    Ok(())
}

/// On Windows, as the app starts: when its folder is on the user's PATH, the copy there made anew if it is not this
/// app's command line (an update brought another) and its `app-path` this app's, so that the command a terminal finds
/// is this app's. Nothing for a development build, or elsewhere than on Windows.
pub fn refresh() {
    if !cfg!(windows) {
        return;
    }
    let (Some(app), Some(bin)) = (exe(), win_bin()) else { return };
    let Some(dir) = app.parent() else { return };
    let cli = dir.join(cli_name());
    if cargo_dir(dir) || !cli.is_file() || !path_var::has(&bin).unwrap_or(false) {
        return;
    }
    let _ = place_copy(&cli, &bin, &app);   // in use (a command running): next time
}

/// The status, for the card.
#[tauri::command]
pub async fn cli_status() -> Result<Value, Value> {
    tauri::async_runtime::spawn_blocking(|| status().json()).await.map_err(|e| Fail::new("failed", e.to_string()).json())
}

/// Installs the command line (`prompt`: the administrator prompt's words, in the page's language): the status after,
/// with `cancelled: true` when the prompt was cancelled; refused or failed, `{kind, message}` ([`Fail`]).
#[tauri::command]
pub async fn cli_install(prompt: Option<String>) -> Result<Value, Value> {
    let r = tauri::async_runtime::spawn_blocking(move || install(prompt.as_deref().unwrap_or(PROMPT))).await;
    answer(r.map_err(|e| Fail::new("failed", e.to_string())).and_then(|r| r))
}

/// Uninstalls the command line (`prompt` as for [`cli_install`]): the status after, with `cancelled: true` when the
/// prompt was cancelled; refused or failed, `{kind, message}`.
#[tauri::command]
pub async fn cli_uninstall(prompt: Option<String>) -> Result<Value, Value> {
    let r = tauri::async_runtime::spawn_blocking(move || uninstall(prompt.as_deref().unwrap_or(PROMPT))).await;
    answer(r.map_err(|e| Fail::new("failed", e.to_string())).and_then(|r| r))
}

/// In self-test mode on macOS, the folder that stands for `/usr/local/bin` (`SMEDCOVER_SELFTEST_CLI_BIN`), if one is
/// given: the self-test then installs and uninstalls the command line there. None elsewhere.
#[tauri::command]
pub fn selftest_cli_bin() -> Option<String> {
    test_dir().map(|d| d.display().to_string())
}

/// The prompt's words when the page gives none.
const PROMPT: &str = "SmedCover wants to put the smedcover command in /usr/local/bin.";

fn answer(r: Result<(Status, bool), Fail>) -> Result<Value, Value> {
    let (s, done) = r.map_err(|f| f.json())?;
    let mut v = s.json();
    v["cancelled"] = json!(!done);
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identifier_is_the_app_s() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"], IDENTIFIER);
    }

    #[test]
    fn windows_copy_is_made_refreshed_and_taken_away() {
        let tmp = tempfile::tempdir().unwrap();
        let install = tmp.path().join("Program Files/SmedCover");
        fs::create_dir_all(&install).unwrap();
        let cli = install.join(cli_name());
        fs::write(&cli, "v1").unwrap();
        fs::write(install.join("uninstall.exe"), "x").unwrap();
        let app = install.join("smedcover-app.exe");
        let bin = tmp.path().join("Local").join(IDENTIFIER).join("bin");
        // made, with app-path; again, nothing written
        assert!(place_copy(&cli, &bin, &app).unwrap());
        assert_eq!(fs::read_to_string(bin.join(cli_name())).unwrap(), "v1");
        assert_eq!(fs::read_to_string(bin.join(APP_PATH)).unwrap(), app.display().to_string());
        assert!(!place_copy(&cli, &bin, &app).unwrap());
        assert!(!bin.join("uninstall.exe").exists(), "only the command line, not the install folder's other programs");
        // an update: the copy made anew; the app moved: app-path anew
        fs::write(&cli, "v2!").unwrap();
        assert!(place_copy(&cli, &bin, &app).unwrap());
        assert_eq!(fs::read_to_string(bin.join(cli_name())).unwrap(), "v2!");
        let moved = tmp.path().join("Other/smedcover-app.exe");
        assert!(place_copy(&cli, &bin, &moved).unwrap());
        assert_eq!(fs::read_to_string(bin.join(APP_PATH)).unwrap(), moved.display().to_string());
        assert_eq!(fs::read_dir(&bin).unwrap().count(), 2, "no temporary file left");
        // the status: on the PATH and the copy there, installed; else not
        let yes = |_: &Path| true;
        let no = |_: &Path| false;
        assert_eq!(win_status(&install, &cli, Some(bin.clone()), &yes).state, State::Installed);
        assert_eq!(win_status(&install, &cli, Some(bin.clone()), &no).state, State::Absent);
        assert_eq!(win_status(&install, &cli, None, &yes).state, State::Missing, "no LOCALAPPDATA");
        assert_eq!(win_status(&install, &install.join("nope.exe"), Some(bin.clone()), &yes).state, State::Missing);
        let dev = tmp.path().join("target/release");
        fs::create_dir_all(dev.join(".fingerprint")).unwrap();
        assert_eq!(win_status(&dev, &dev.join(cli_name()), Some(bin.clone()), &yes).state, State::Dev);
        // taken away: the copy and app-path, then the folder; another file left with its folder
        remove_copy(&bin).unwrap();
        assert!(!bin.exists());
        remove_copy(&bin).unwrap();
        assert_eq!(win_status(&install, &cli, Some(bin.clone()), &yes).state, State::Absent, "on the PATH, the copy gone: installed again by Install");
        place_copy(&cli, &bin, &app).unwrap();
        fs::write(bin.join("mine.txt"), "x").unwrap();
        remove_copy(&bin).unwrap();
        assert!(bin.join("mine.txt").is_file() && !bin.join(cli_name()).exists());
    }

    #[test]
    fn linux_says_the_package_s_the_appimage_s_or_neither() {
        let tmp = tempfile::tempdir().unwrap();
        let usr = Path::new("/usr/bin");
        let mount = Path::new("/tmp/.mount_SmedCoXyZ/usr/bin");
        // an AppImage: APPIMAGE set and the app inside its mount; APPIMAGE inherited by an app outside it is not one
        assert!(in_appimage(mount, Some("/home/a/SmedCover.AppImage".as_ref()), Some("/tmp/.mount_SmedCoXyZ".as_ref())));
        assert!(in_appimage(mount, Some("/home/a/SmedCover.AppImage".as_ref()), None));
        assert!(!in_appimage(usr, Some("/home/a/SmedCover.AppImage".as_ref()), Some("/tmp/.mount_SmedCoXyZ".as_ref())));
        assert!(!in_appimage(mount, None, Some("/tmp/.mount_SmedCoXyZ".as_ref())));
        assert!(!in_appimage(mount, Some("".as_ref()), None));
        assert_eq!(linux_status(mount, &mount.join(CLI), true).state, State::AppImage);
        let dev = tmp.path().join("target/release");
        fs::create_dir_all(dev.join(".fingerprint")).unwrap();
        assert_eq!(linux_status(&dev, &dev.join(CLI), false).state, State::Dev);
        let opt = tmp.path().join("opt");
        fs::create_dir_all(&opt).unwrap();
        assert_eq!(linux_status(&opt, &opt.join(CLI), false).state, State::Missing);
        fs::write(opt.join(CLI), "cli").unwrap();
        assert_eq!(linux_status(&opt, &opt.join(CLI), false).state, State::Unpackaged, "not a package's: left to the user");
    }

    #[test]
    fn the_status_and_a_failure_as_the_page_reads_them() {
        let s = Status::new(State::Elsewhere("/Users/a/Old.app/Contents/MacOS/smedcover".into()), Some("/Applications/SmedCover.app/Contents/MacOS/smedcover".into()), Some("/usr/local/bin/smedcover".into()));
        let v = s.json();
        assert_eq!(v["state"], "elsewhere");
        assert_eq!(v["to"], "/Users/a/Old.app/Contents/MacOS/smedcover");
        assert_eq!(v["at"], "/usr/local/bin/smedcover");
        assert_eq!(v["what"], Value::Null);
        assert_eq!(v["test"], false);
        let v = Status::new(State::Foreign(Foreign::Link("/opt/x".into())), None, None).json();
        assert_eq!((v["state"].as_str(), v["what"].as_str(), v["to"].as_str()), (Some("foreign"), Some("link"), Some("/opt/x")));
        assert_eq!(Status::new(State::Moved, None, None).json()["state"], "moved");
        assert_eq!(Status::new(State::Unpackaged, None, None).json()["state"], "unpackaged");
        assert_eq!(answer(Ok((Status::new(State::Absent, None, None), false))).unwrap()["cancelled"], true);
        assert_eq!(answer(Ok((Status::new(State::Installed, None, None), true))).unwrap()["cancelled"], false);
        let e = answer(Err(Fail::foreign(Path::new("/usr/local/bin/smedcover")))).unwrap_err();
        assert_eq!(e["kind"], "foreign");
        assert!(e["message"].as_str().unwrap().contains("/usr/local/bin/smedcover"));
    }
}

#[cfg(all(test, unix))]
mod unix_tests {
    use super::*;

    /// A copy of the app in `root`: `<name>.app/Contents/MacOS/` with `smedcover-app` and `smedcover`, and its
    /// `Info.plist`; its folder and its command line.
    fn bundle(root: &Path, name: &str) -> (PathBuf, PathBuf) {
        let dir = root.join(format!("{name}.app/Contents/MacOS"));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(APP), "app").unwrap();
        fs::write(dir.join(CLI), "cli").unwrap();
        fs::write(dir.with_file_name("Info.plist"), format!("<plist><dict>\n  <key>CFBundleIdentifier</key>\n  <string>{IDENTIFIER}</string>\n</dict></plist>")).unwrap();
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
        // another copy's: there (beside its smedcover-app, or in a bundle saying it is SmedCover), or gone (the app moved)
        symlink(&other, &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(other.clone()));
        fs::remove_file(other.with_file_name(APP)).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(other.clone()), "its Info.plist says so");
        fs::write(other.with_file_name("../Info.plist"), "<plist><dict><key>CFBundleIdentifier</key><string>com.other.app</string></dict></plist>").unwrap();
        assert_eq!(link_state(&link, &cli), State::Foreign(Foreign::Link(other.clone())), "another app's smedcover");
        fs::remove_file(&link).unwrap();
        let gone = root.join("Downloads/SmedCover.app/Contents/MacOS/smedcover");
        symlink(&gone, &link).unwrap();
        assert_eq!(link_state(&link, &cli), State::Elsewhere(gone));
        fs::remove_file(&link).unwrap();
        let built = root.join("target/release");
        fs::create_dir_all(&built).unwrap();
        fs::write(built.join(APP), "app").unwrap();
        fs::write(built.join(CLI), "cli").unwrap();
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
        // run from where it will not stay: moved (but uninstalled from there when it is the link's)
        let (tdir, tcli) = bundle(&root.join("private/var/folders/x/T/AppTranslocation/ABCD-1234/d"), "SmedCover");
        assert_eq!(at(&mac_status(&tdir, &tcli, &bin)), State::Moved);
        symlink(&tcli, &link).unwrap();
        assert_eq!(at(&mac_status(&tdir, &tcli, &bin)), State::Installed);
        fs::remove_file(&link).unwrap();
        // not a bundle (a development build), or a bundle without the command line
        assert_eq!(at(&mac_status(&root.join("target/debug"), &root.join("target/debug/smedcover"), &bin)), State::Dev);
        fs::remove_file(&cli).unwrap();
        assert_eq!(at(&mac_status(&dir, &cli, &bin)), State::Missing);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_read_only_volume_is_told() {
        assert!(read_only(Path::new("/System")), "the sealed system volume is mounted read-only");
        assert!(!read_only(&std::env::temp_dir()));
        assert!(!moved(&std::env::temp_dir()));
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
        assert_eq!(make_link(&link, &cli, None).unwrap_err().kind, "foreign");
        assert_eq!(remove_link(&link, &cli, None).unwrap_err().kind, "foreign");
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
        assert_eq!(make_link(&none, &cli, None).unwrap_err().kind, "failed");
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

    /// The prompt's AppleScript, run without the prompt (as the user, in a folder of the test's), takes any path as it
    /// is: spaces, quotes of both kinds, `$`, a backslash, `;`, Chinese, a leading `-`; and its scripts look again at
    /// what is there before they change anything.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_prompt_s_script_takes_any_path_and_looks_again() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().join(r#"It's "a" $NOT_SET_X \ `true`; 封面"#);
        let (_, cli) = bundle(&root, r#"-Smed "Cover" 's $(true)"#);
        let (_, other) = bundle(&root, "Older");
        let bin = root.join("new bin; true");
        let link = bin.join(CLI);
        assert_eq!(as_admin(None, LINK, &[&bin, &link, &cli]), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        // something there: LINK makes nothing
        assert_eq!(as_admin(None, LINK, &[&bin, &link, &other]).unwrap_err().kind, "changed");
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        // RELINK and UNLINK only on the link that was: another one, or a file, left
        assert_eq!(as_admin(None, RELINK, &[&bin, &link, &other, &other]).unwrap_err().kind, "changed");
        assert_eq!(as_admin(None, UNLINK, &[&link, &other]).unwrap_err().kind, "changed");
        assert_eq!(fs::read_link(&link).unwrap(), cli);
        assert_eq!(as_admin(None, RELINK, &[&bin, &link, &other, &cli]), Ok(true));
        assert_eq!(fs::read_link(&link).unwrap(), other);
        assert_eq!(as_admin(None, UNLINK, &[&link, &other]), Ok(true));
        assert!(fs::symlink_metadata(&link).is_err());
        fs::write(&link, "mine").unwrap();
        assert_eq!(as_admin(None, UNLINK, &[&link, &cli]).unwrap_err().kind, "changed", "not a link: left");
        assert_eq!(fs::read_to_string(&link).unwrap(), "mine");
        // the files the folder made has: readable by all, writable by their owner alone
        use std::os::unix::fs::PermissionsExt;
        let made = root.join("made by the script");
        fs::remove_file(&link).unwrap();
        assert_eq!(as_admin(None, LINK, &[&made, &made.join(CLI), &cli]), Ok(true));
        assert_eq!(fs::metadata(&made).unwrap().permissions().mode() & 0o777, 0o755);
    }

    /// The shell `osascript` runs takes nothing of this process's environment: not a program planted first on its
    /// PATH, nor a function bash would import (`BASH_FUNC_ln%%`), nor `BASH_ENV`; the real `ln` makes the link. (The
    /// environment is this test's own while it runs: what it plants names `ln` alone, which nothing else here runs.)
    #[cfg(target_os = "macos")]
    #[test]
    fn the_prompt_s_shell_takes_nothing_of_the_app_s_environment() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let (_, cli) = bundle(root, "SmedCover");
        let planted = root.join("planted");
        fs::create_dir(&planted).unwrap();
        let marks = root.join("marks");
        fs::create_dir(&marks).unwrap();
        use std::os::unix::fs::PermissionsExt;
        let fake = planted.join("ln");
        fs::write(&fake, format!("#!/bin/sh\necho ran > '{}/fake-ln'\n", marks.display())).unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let rc = root.join("rc.sh");
        fs::write(&rc, format!("echo ran > '{}/bash-env'\n", marks.display())).unwrap();
        let path = env::var_os("PATH").unwrap_or_default();
        let planted_path = env::join_paths(std::iter::once(planted.clone()).chain(env::split_paths(&path))).unwrap();
        env::set_var("PATH", &planted_path);
        env::set_var("BASH_FUNC_ln%%", format!("() {{ echo ran > '{}/function'; }}", marks.display()));
        env::set_var("BASH_ENV", &rc);
        env::set_var("ENV", &rc);
        let bin = root.join("bin");
        let made = as_admin(None, LINK, &[&bin, &bin.join(CLI), &cli]);
        env::set_var("PATH", &path);
        env::remove_var("BASH_FUNC_ln%%");
        env::remove_var("BASH_ENV");
        env::remove_var("ENV");
        assert_eq!(made, Ok(true));
        assert_eq!(fs::read_link(bin.join(CLI)).unwrap(), cli, "the real ln made the link");
        assert_eq!(fs::read_dir(&marks).unwrap().count(), 0, "nothing planted ran");
        // and the shell the command runs has the system's PATH alone
        let cmd = osascript(None, "", &[]);
        let envs: Vec<_> = cmd.get_envs().map(|(k, v)| (k.to_os_string(), v.map(|v| v.to_os_string()))).collect();
        assert_eq!(envs, vec![("PATH".into(), Some("/usr/bin:/bin:/usr/sbin:/sbin".into()))]);
    }
}
