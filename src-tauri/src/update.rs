//! Updates, for Settings → About (`update_status`, `update_check`, `update_download`, `update_cancel`,
//! `update_install`, and `update_release_page`, a release's notes in the browser): the updater's manifest read, a newer version downloaded and installed, the app started again.
//! tauri-plugin-updater does the work. It reads `latest.json` from the endpoint in tauri.conf.json (the latest release on
//! GitHub, where a tag's build puts it: `scripts/updater.mjs`), takes the entry for this system, its processor and the
//! kind of installer the app came from, and checks the package against the public key there and against the version
//! signed in it (`requireSignedVersion`: the manifest itself is not signed, so an older release's package announced as a
//! newer version is refused), as it is downloaded and again before it is installed.
//!
//! * **Where it can be updated**: an app installed from an installer. A development build (on macOS an app not in a
//!   bundle; elsewhere one the bundler did not mark with the kind of installer it is in) is not, nor, on macOS, an app
//!   run from a disk image or moved aside by App Translocation (`install::moved`), where the new one would not stay: the
//!   page says so ([`Place`]), and still says whether there is a newer version.
//! * **Installing**: the page writes what waits first; never while a call of an agent or of the command line is under
//!   way (`busy`). On macOS and Linux the package replaces the app where it is (the .app, the AppImage; a .deb or an .rpm
//!   through the system's password prompt), then the app starts again: `request_restart` goes through the run loop's
//!   exit, where `cli.json` goes and the endpoints stop, and the new app takes the data folder's lock once this one has
//!   let it go (`cli::take_or_defer`). On Windows the installer is started (passive: its progress alone, no questions)
//!   and the app exits at once, having done the same first ([`leave`]); the installer starts it again.
//! * **The proxy**: the one the page gives (one the user gave SmedCover), else the system's or the environment's.
//!
//! Refusals and failures are kinds, which the page says in its language: `network`, `notfound` (no manifest where it
//! should be), `platform` (none for this system), `signature` (not the package signed: never installed), `cancelled`,
//! `auth` (the password prompt cancelled), `busy`, `place` (with `place`), `none` (nothing found or downloaded to
//! install), `failed`. A self-test may name another manifest (`SMEDCOVER_SELFTEST_UPDATES`, a URL, read only with
//! `SMEDCOVER_SELFTEST`; an http:// one in a debug build alone): it then updates from it ([`selftest_updates`]), and is
//! not started again once the package is installed.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, Url};
use smedcover_core::paths;
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::{cli, install, mcp};

/// How long the check may take.
const CHECK_WITHIN: Duration = Duration::from_secs(30);
/// How long the download may take in all (the AppImage is 90 MB): longer, it is given up rather than waited for.
const DOWNLOAD_WITHIN: Duration = Duration::from_secs(3600);
/// How often the page is told how far the download has got, at most.
const PROGRESS_EVERY: Duration = Duration::from_millis(150);
/// The event that tells it.
const PROGRESS_EVENT: &str = "update-progress";
/// A self-test's manifest, in place of tauri.conf.json's endpoint.
const TEST_ENV: &str = "SMEDCOVER_SELFTEST_UPDATES";
/// Where the releases are, each with its notes (`/tag/v<version>`).
const RELEASES: &str = "https://github.com/cybertheye/smedcover/releases";

/// Where this copy runs, as far as updating it goes.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Place {
    /// Installed from an installer: it can be updated.
    Installed,
    /// A development build, or a copy no installer put there: nothing to update.
    Dev,
    /// macOS: run from a disk image or moved aside by App Translocation: to be moved to Applications first.
    Moved,
}

impl Place {
    fn name(self) -> &'static str {
        match self {
            Place::Installed => "installed",
            Place::Dev => "dev",
            Place::Moved => "moved",
        }
    }
}

/// Where this copy runs: on macOS by its folder (a bundle's, and where that bundle is), elsewhere by the kind of
/// installer the bundler marked the executable with (none: not from an installer).
pub fn place() -> Place {
    let Some(dir) = install::exe().and_then(|e| e.parent().map(Path::to_path_buf)) else { return Place::Dev };
    if cfg!(target_os = "macos") {
        if !install::bundle_dir(&dir) {
            Place::Dev
        } else if install::moved(&dir) {
            Place::Moved
        } else {
            Place::Installed
        }
    } else if tauri::utils::platform::bundle_type().is_none() {
        Place::Dev
    } else {
        Place::Installed
    }
}

/// What the updates are at: the newer version the last check found, the package downloaded for it (checked against
/// its signature as it came), and the download under way, to cancel. Kept while the app runs, so that a page loaded
/// again finds them.
#[derive(Default)]
pub struct Updates {
    state: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    found: Option<Update>,
    package: Option<(String, Arc<Vec<u8>>)>,
    download: Option<tokio::task::AbortHandle>,
}

impl Updates {
    fn state(&self) -> MutexGuard<'_, Inner> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The status: this version, where it runs, the newer one found (`version`, `date`, `notes`), the version
    /// downloaded, and whether a download is under way.
    fn json(&self, app: &AppHandle) -> Value {
        let s = self.state();
        let found = s.found.as_ref().map(|u| json!({"version": u.version, "date": u.raw_json.get("pub_date"), "notes": u.body}));
        json!({
            "version": app.package_info().version.to_string(),
            "place": place().name(),
            "found": found,
            "downloaded": s.package.as_ref().map(|(v, _)| v),
            "downloading": s.download.is_some(),
        })
    }
}

/// A refusal or a failure, as the page takes it.
fn fail(kind: &str, message: impl ToString) -> Value {
    json!({"kind": kind, "message": message.to_string()})
}

/// The kind of an updater's error.
fn kind_of(e: &Error) -> &'static str {
    match e {
        Error::Reqwest(_) | Error::Network(_) => "network",
        Error::ReleaseNotFound => "notfound",
        Error::TargetNotFound(_) | Error::TargetsNotFound(_) => "platform",
        Error::Minisign(_) | Error::Base64(_) | Error::SignatureUtf8(_) | Error::SignedVersionMismatch { .. } | Error::MissingSignedVersion => "signature",
        Error::AuthenticationFailed => "auth",
        _ => "failed",
    }
}

/// A proxy as the user typed it, made a URL (`127.0.0.1:7890` as http's); none if empty.
fn proxy_url(proxy: Option<&str>) -> Result<Option<Url>, Value> {
    let Some(p) = proxy.map(str::trim).filter(|p| !p.is_empty()) else { return Ok(None) };
    let full = if p.contains("://") { p.to_string() } else { format!("http://{p}") };
    Url::parse(&full).map(Some).map_err(|e| fail("failed", format!("proxy {p}: {e}")))
}

/// What the app does as it exits, done before the Windows installer has it exit at once (`std::process::exit`, no run
/// loop gone through): `cli.json` removed and the endpoints stopped, as `RunEvent::Exit` does.
fn leave(app: &AppHandle) {
    if let Some(cli) = app.try_state::<Arc<cli::CliApp>>() {
        cli.remove_file();
    }
    if let Some(host) = app.try_state::<Arc<mcp::McpHost>>() {
        tauri::async_runtime::block_on(host.shut());
    }
}

/// Whether a call of an agent or of the command line is under way (the window has it, or the command line's endpoint).
fn busy(app: &AppHandle) -> bool {
    app.try_state::<Arc<mcp::McpHost>>().is_some_and(|h| h.calls_in_hand() + h.cli_stats().in_flight > 0)
}

/// The status, as the page shows it after a reload as well.
#[tauri::command]
pub fn update_status(app: AppHandle, u: State<'_, Updates>) -> Value {
    u.json(&app)
}

/// Reads the manifest, through `proxy` if given: the status after, its `found` the newer version (null: none).
#[tauri::command]
pub async fn update_check(app: AppHandle, u: State<'_, Updates>, proxy: Option<String>) -> Result<Value, Value> {
    let mut builder = app.updater_builder().timeout(CHECK_WITHIN);
    if let Some(p) = proxy_url(proxy.as_deref())? {
        builder = builder.proxy(p);
    }
    if let Some(url) = selftest_updates() {
        let url = Url::parse(&url).map_err(|e| fail("failed", format!("{TEST_ENV}: {e}")))?;
        builder = builder.endpoints(vec![url]).map_err(|e| fail(kind_of(&e), e))?;
    }
    let handle = app.clone();
    let updater = builder.on_before_exit(move || leave(&handle)).build().map_err(|e| fail(kind_of(&e), e))?;
    let found = updater.check().await.map_err(|e| fail(kind_of(&e), e))?;
    {
        let mut s = u.state();
        if s.package.as_ref().is_some_and(|(v, _)| found.as_ref().is_none_or(|f| &f.version != v)) {
            s.package = None;   // downloaded for a version no longer the one found
        }
        s.found = found;
    }
    Ok(u.json(&app))
}

/// Downloads the newer version found, telling the page how far it has got (the event `update-progress`: `version`,
/// `done`, and `total` when known), and keeps the package, checked against its signature as it came: the status after.
#[tauri::command]
pub async fn update_download(app: AppHandle, u: State<'_, Updates>) -> Result<Value, Value> {
    let task = {
        let mut s = u.state();
        if s.download.is_some() {
            return Err(fail("failed", "a download is under way"));
        }
        let Some(mut update) = s.found.clone() else { return Err(fail("none", "no newer version found")) };
        update.timeout = Some(DOWNLOAD_WITHIN);   // the check's is for the whole request: too short for a package
        let (app, version) = (app.clone(), update.version.clone());
        let task = tokio::spawn(async move {
            let (mut done, mut told) = (0u64, None::<Instant>);
            let bytes = update
                .download(
                    |chunk, total| {
                        done += chunk as u64;
                        if told.is_none_or(|t| t.elapsed() >= PROGRESS_EVERY) {
                            told = Some(Instant::now());
                            let _ = app.emit(PROGRESS_EVENT, json!({"version": version, "done": done, "total": total}));
                        }
                    },
                    || {},
                )
                .await?;
            Ok::<_, Error>((update.version, bytes))
        });
        s.download = Some(task.abort_handle());
        task
    };
    let result = task.await;
    let mut s = u.state();
    s.download = None;
    match result {
        Ok(Ok((version, bytes))) => {
            // kept only while it is still the version found (a check meanwhile may have found another)
            if s.found.as_ref().is_some_and(|f| f.version == version) {
                s.package = Some((version, Arc::new(bytes)));
            }
        }
        Ok(Err(e)) => return Err(fail(kind_of(&e), e)),
        Err(e) if e.is_cancelled() => return Err(fail("cancelled", "cancelled")),
        Err(e) => return Err(fail("failed", e)),
    }
    drop(s);
    Ok(u.json(&app))
}

/// Stops the download under way, if any (`update_download` then answers `cancelled`).
#[tauri::command]
pub fn update_cancel(u: State<'_, Updates>) {
    if let Some(task) = u.state().download.take() {
        task.abort();
    }
}

/// Installs the package downloaded, checked against its signature again, and starts the app again (on Windows the
/// installer does, the app exiting as it starts it). Refused where the app cannot be updated (`place`), while a call
/// of an agent or of the command line is under way (`busy`), and with nothing downloaded (`none`). The page has written
/// what waits before it asks.
#[tauri::command]
pub async fn update_install(app: AppHandle, u: State<'_, Updates>) -> Result<(), Value> {
    let place = place();
    if place != Place::Installed {
        return Err(json!({"kind": "place", "place": place.name(), "message": format!("this copy cannot be updated where it is ({})", place.name())}));
    }
    if busy(&app) {
        return Err(fail("busy", "a call of an agent or of the command line is under way"));
    }
    let (update, package) = {
        let s = u.state();
        match (&s.found, &s.package) {
            (Some(found), Some((version, package))) if &found.version == version => (found.clone(), package.clone()),
            _ => return Err(fail("none", "nothing downloaded to install")),
        }
    };
    tauri::async_runtime::spawn_blocking(move || update.install(package.as_slice()))
        .await
        .map_err(|e| fail("failed", e))?
        .map_err(|e| fail(kind_of(&e), e))?;
    // a self-test's app is not started again: on macOS the new one, started by the system (`open`), would not have the
    // self-test's environment, and would open the user's own data folder
    if selftest_updates().is_none() {
        app.request_restart();
    }
    Ok(())
}

/// In self-test mode, the manifest to update from instead of the self-test (SMEDCOVER_SELFTEST_UPDATES), as Settings →
/// About does: checked, the newer version downloaded and installed, the app not started again.
#[tauri::command]
pub fn selftest_updates() -> Option<String> {
    std::env::var_os(paths::SELFTEST_ENV).and(std::env::var(TEST_ENV).ok()).filter(|u| !u.is_empty())
}

/// The page of the release of `version` (as a manifest announced it, so nothing but a version's letters), or of the
/// releases.
fn release_url(version: Option<&str>) -> Result<String, String> {
    match version {
        Some(v) if !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric() || ".+-".contains(c)) => Ok(format!("{RELEASES}/tag/v{v}")),
        Some(v) => Err(format!("not a version: {v}")),
        None => Ok(RELEASES.to_string()),
    }
}

/// The page of a release, its notes, in the system's browser (`version` as the manifest announced it); of the releases,
/// with none.
#[tauri::command]
pub fn update_release_page(version: Option<String>) -> Result<(), String> {
    let url = release_url(version.as_deref())?;
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(target_os = "windows") {
        "explorer"
    } else {
        "xdg-open"
    };
    std::process::Command::new(opener).arg(&url).spawn().map(|_| ()).map_err(|e| format!("{opener} {url}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_proxy_as_typed() {
        assert_eq!(proxy_url(None).unwrap(), None);
        assert_eq!(proxy_url(Some("  ")).unwrap(), None);
        assert_eq!(proxy_url(Some("http://127.0.0.1:7890")).unwrap().unwrap().as_str(), "http://127.0.0.1:7890/");
        assert_eq!(proxy_url(Some(" socks5://127.0.0.1:7891 ")).unwrap().unwrap().as_str(), "socks5://127.0.0.1:7891");
        assert_eq!(proxy_url(Some("127.0.0.1:7890")).unwrap().unwrap().as_str(), "http://127.0.0.1:7890/", "no scheme: http's");
        assert_eq!(proxy_url(Some("http://[::1")).unwrap_err()["kind"], "failed");
    }

    #[test]
    fn a_release_s_page() {
        assert_eq!(release_url(Some("0.6.1")).unwrap(), "https://github.com/cybertheye/smedcover/releases/tag/v0.6.1");
        assert_eq!(release_url(Some("1.0.0-beta.2+build.5")).unwrap(), "https://github.com/cybertheye/smedcover/releases/tag/v1.0.0-beta.2+build.5");
        assert_eq!(release_url(None).unwrap(), "https://github.com/cybertheye/smedcover/releases");
        for bad in ["", "0.6.1/../../x", "0.6.1 --x", "0.6.1&calc", "0.6.1\n"] {
            assert!(release_url(Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn a_test_build_is_not_updated() {
        // cargo's test binary: in target/<profile>/deps, not in a bundle, marked with no kind of installer
        assert_eq!(place(), Place::Dev);
    }

    #[test]
    fn the_updater_s_settings() {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let u = &conf["plugins"]["updater"];
        assert_eq!(u["endpoints"], json!(["https://github.com/cybertheye/smedcover/releases/latest/download/latest.json"]));
        assert!(u["endpoints"][0].as_str().unwrap().starts_with(RELEASES), "the releases the notes are on");
        assert_eq!(u["requireSignedVersion"], json!(true), "an older release's package announced as newer is refused");
        assert_eq!(u["windows"]["installMode"], json!("passive"));
        assert!(u["pubkey"].as_str().is_some_and(|k| !k.is_empty()));
    }
}

