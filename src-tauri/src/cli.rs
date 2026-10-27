//! The app's side of the command line (`smedcover`, a program of its own, in `cli/`): the app
//! launched for it, the endpoint it calls and the file it finds that endpoint by, one app for each
//! data folder, and quitting once the command line is done.
//!
//! * **Launched for the command line**, `smedcover-app --cli`, when no app runs on the data folder
//!   (`launchedBy: "cli"`). On macOS its window is made but never shown, the app is an accessory (no
//!   Dock icon, no menu bar of its own; set before the event loop starts, so none shows at all) and does
//!   not take the focus from the app in front as it starts; WebKit is told not to slow the timers of a
//!   page it takes to be hidden (`_setHiddenPageDOMTimerThrottlingEnabled:` and `…AutoIncreases:` off,
//!   private settings like the occlusion one `mcp::keep_drawing` uses: without them an export there
//!   takes four to six times as long), the window keeps drawing unseen and App Nap is kept away for as
//!   long as it runs. Elsewhere its window is shown without taking the focus where the system allows
//!   (hidden is not tried there), and becomes the user's when they bring it to the front. The window is
//!   never shown with the first start's welcome in it: the command line is answered that SmedCover
//!   needs setting up. The user's endpoint for agents is not started while the app is the command
//!   line's (no agent drives a window no one sees), Ctrl-C and a closed terminal do not stop it
//!   (`instance::ignore_interrupts`), and an app whose endpoint for the command line cannot be had
//!   quits at once (1) rather than running unseen.
//! * **Quitting**: it quits once the command line says it is done (`POST /app/done`) or once its
//!   standard input, which the command line holds open, reaches its end (the command line ended,
//!   crashed or was killed); the stdin is watched from the start, the endpoint there or not. From
//!   then `cli.json` says `"quitting": true` and the app goes on taking calls: another command line
//!   that found it (before or since) uses it without saying it is done, each request of theirs putting
//!   the quitting off. The app waits till no call is in hand and neither a request nor a call has come
//!   for [`QUIET_FOR`] (from the last request showing the token, the end of the last call, or the moment
//!   it was told: [`quiet`]), then asks the
//!   page to write what waits (the event `app-quit`: its `flushWrites()`, then `app_quit`), 5 s at most,
//!   and exits — unless a request came meanwhile, when it waits again. Not if the window has been shown
//!   to the user by then (`POST /app/show`, a second launch on the folder, on macOS the app opened
//!   again from the Finder), whichever way the command line was done: the app is theirs from then on
//!   (`launchedBy: "user"`, `quitting: false`, on macOS a regular app with its Dock icon, the user's
//!   endpoint for agents started if it is on), and goes on as any other. Nothing it says on the way
//!   out may fail it ([`say`]: stderr may be a pipe no one reads).
//! * **The endpoint**: every app starts the command line's endpoint (`McpHost::start_cli`) as it
//!   starts, whatever the user's switch for agents says, and writes `cli.json`
//!   (`smedcover_core::instance`) once it listens, again whenever `ready`, `launchedBy` or `quitting`
//!   changes, and removes it as it exits (its own only).
//! * **One app for each data folder** (`smedcover_core::paths::data_dir`: a self-test's, else
//!   `SMEDCOVER_DATA`'s, else the app's own): `app.lock` is taken before anything else is done
//!   ([`single_instance`]). When another app holds it and its `cli.json` says where it listens, a
//!   launch of the user's asks that one to show its window (`POST /app/show`, with the token the file
//!   gives) and quits; one for the command line quits with `EXIT_ALREADY_RUNNING` (75), and the
//!   command line uses the app that runs, quitting or not. With no `cli.json` there, the other app is
//!   starting (it writes one once its endpoint listens) or exiting (it removed it as it exits, its
//!   endpoints then stopping within 2 s): the launch waits [`FIND_WITHIN`] at most for the file, or for
//!   the lock, which it then takes, starting as the folder's app. A data folder others may write in is
//!   said on stderr: it is to be the user's alone.

use std::ffi::OsString;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, Weak};
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};
use smedcover_core::instance::{self, AppLock, CliFile, LaunchedBy, CLI_FILE, EXIT_ALREADY_RUNNING};
use smedcover_core::mcp::server::VERSION;
use smedcover_core::mcp::{AppControl, PageState, Secret};
use smedcover_core::{err, Res};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

use crate::mcp::McpHost;

/// The argument that launches the app for the command line.
pub const CLI_ARG: &str = "--cli";
/// The event that asks the page to write what waits before the app quits; it answers `app_quit`.
const QUIT_EVENT: &str = "app-quit";
/// How long the page has to answer it.
const QUIT_WITHIN: Duration = Duration::from_secs(5);
/// How long a second launch waits for the first app's `cli.json`, or for its lock: the first may be
/// starting yet (it writes the file once its endpoint listens, within 2 s of starting as measured), or
/// exiting (from the file removed to its endpoints stopped, 2 s at most; a quitting app keeps its file
/// till then).
const FIND_WITHIN: Duration = Duration::from_secs(10);
/// How long the command line's app waits, once it is to quit, for no request to have come.
const QUIET_FOR: Duration = Duration::from_secs(2);
/// How long after the window is made an app launched for the command line takes the window brought to
/// the front for the user's doing (elsewhere than on macOS; a system may focus a new window itself).
const FOCUS_AFTER: Duration = Duration::from_secs(2);

/// How the app was launched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Launch {
    /// For the command line (`--cli`).
    pub cli: bool,
}

impl Launch {
    /// From the arguments the app was given after its own path: `--cli` among them. Any other is left
    /// alone (a system may pass its own).
    pub fn from_args(args: impl IntoIterator<Item = OsString>) -> Launch {
        Launch { cli: args.into_iter().any(|a| a == CLI_ARG) }
    }

    pub fn launched_by(self) -> LaunchedBy {
        if self.cli {
            LaunchedBy::Cli
        } else {
            LaunchedBy::User
        }
    }

    /// Whether the window is made hidden: for the command line on macOS, and elsewhere too when the
    /// app will wait on its first start's welcome (`first_start`).
    pub fn hidden(self, first_start: bool) -> bool {
        self.cli && (cfg!(target_os = "macos") || first_start)
    }
}

// ---------------------------------------------------------------- one app for each data folder

/// The lock on `app.lock` in the data folder `data`, to be held for as long as the app runs (a
/// `cli.json` left there by an app that crashed is removed at once). When another app holds it, this
/// one goes no further: launched for the command line it exits with [`EXIT_ALREADY_RUNNING`];
/// launched by the user it asks the other to show its window, then exits (0, or 1 when the other
/// could not be asked, saying why on stderr). See [`take_or_defer`] for an app that is starting or
/// quitting. `None` when the folder cannot be locked at all (said on stderr): the app then runs
/// without, as it did before there was a lock.
pub fn single_instance(data: &Path, launch: Launch) -> Option<AppLock> {
    match take_or_defer(data, launch, FIND_WITHIN) {
        Taken::Lock(lock) => {
            let _ = CliFile::remove(data);
            Some(lock)
        }
        Taken::Unlocked(e) => {
            say(&format!("SmedCover: {e}; it runs without the lock that keeps a second app off its data folder"));
            None
        }
        Taken::Exit(code, why) => {
            if let Some(why) = why {
                say(&format!("SmedCover already runs on {}, but it could not be asked to show its window: {why}", data.display()));
            }
            std::process::exit(code)
        }
    }
}

/// What a launch comes to on its data folder.
#[derive(Debug)]
pub enum Taken {
    /// The folder's lock: this is the folder's app.
    Lock(AppLock),
    /// The folder cannot be locked at all (why): the app runs without.
    Unlocked(String),
    /// Another app runs on the folder: this one exits with that code (and says why, if given).
    Exit(i32, Option<String>),
}

/// Takes the data folder's lock, or defers to the app that holds it: while that app's `cli.json`
/// says where it listens (quitting or not), a launch for the command line exits with
/// [`EXIT_ALREADY_RUNNING`] at once, and the user's asks it to show its window ([`ask_to_show`]) and
/// exits 0. While there is no `cli.json`, that app is starting (it writes one once its endpoint
/// listens) or exiting (it removed it as it exits): the launch waits for the one or the lock, trying
/// each again every 100 ms for `within` at most, and takes the lock once the other app has let it
/// go. Past `within`, it exits as above, 1 for the user's launch whose other app could not be asked.
pub fn take_or_defer(data: &Path, launch: Launch, within: Duration) -> Taken {
    let until = Instant::now() + within;
    loop {
        match AppLock::take(data) {
            Ok(Some(lock)) => return Taken::Lock(lock),
            Err(e) => return Taken::Unlocked(e),
            Ok(None) => {}
        }
        let file = CliFile::load(data).ok().flatten();
        let last = Instant::now() >= until;
        match file {
            Some(_) if launch.cli => return Taken::Exit(EXIT_ALREADY_RUNNING, None),
            Some(file) => match ask_to_show(&file) {
                Ok(()) => return Taken::Exit(0, None),
                Err(e) if last => return Taken::Exit(1, Some(e)),
                Err(_) => {}
            },
            None if last && launch.cli => return Taken::Exit(EXIT_ALREADY_RUNNING, None),
            None if last => return Taken::Exit(1, Some(format!("it has no {CLI_FILE}"))),
            None => {}
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn ask_to_show(file: &CliFile) -> Res<()> {
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(5)).build();
    agent.post(&file.url("/app/show")).set("Authorization", &format!("Bearer {}", file.token.expose())).send_string("").map_err(|e| e.to_string())?;
    Ok(())
}

/// Says on stderr when the data folder `data` may be written by others than its owner (Unix): the
/// app's lock, `cli.json` and the token in it are kept there, so it is to be the user's alone.
pub fn warn_if_shared(data: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(data).is_ok_and(|m| m.permissions().mode() & 0o022 != 0) {
            say(&format!("SmedCover: others than its owner may write in its data folder {}; it is to be the user's alone", data.display()));
        }
    }
    #[cfg(not(unix))]
    let _ = data;
}

/// Whether the data folder `data` has no profile yet (no `profiles/*.json`): the page will then wait
/// on its first start's welcome.
pub fn no_profile_yet(data: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(data.join("profiles")) else { return true };
    !entries.flatten().map(|e| e.path()).any(|p| p.extension().is_some_and(|x| x == "json") && p.is_file())
}

// ---------------------------------------------------------------- the window

/// Makes the main window from its config (`"create": false` there, so that it is made here): hidden
/// when [`Launch::hidden`] says so, and then shown only when the user asks for it; launched for the
/// command line, not taking the focus as it shows, and on macOS with WebKit's timers left as they are
/// in a page it takes to be hidden. A config that still makes it (a platform's of its own) keeps it.
pub fn make_window(app: &tauri::App, launch: Launch, first_start: bool) -> Res<()> {
    if app.get_webview_window("main").is_some() {
        return Ok(());
    }
    let conf = app.config().app.windows.iter().find(|w| w.label == "main").cloned().ok_or("SmedCover's config has no main window")?;
    let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &conf).map_err(err)?.visible(!launch.hidden(first_start));
    if launch.cli {
        window = window.focused(false);
    }
    let window = window.build().map_err(err)?;
    #[cfg(target_os = "macos")]
    if launch.cli {
        timers_unthrottled(&window);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
    Ok(())
}

/// WebKit does not slow the timers of the window's page when it takes the page to be hidden (as it
/// is, the window never shown): WKPreferences' private `_setHiddenPageDOMTimerThrottlingEnabled:` and
/// `_setHiddenPageDOMTimerThrottlingAutoIncreases:`, each sent only if the preferences answer to it.
#[cfg(target_os = "macos")]
fn timers_unthrottled(window: &tauri::WebviewWindow) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    let _ = window.with_webview(|wv| unsafe {
        // SAFETY: the web view is a WKWebView, its configuration a WKWebViewConfiguration and that one's
        // preferences a WKPreferences; a selector is sent only to an object that answers to it
        let view = wv.inner() as *mut AnyObject;
        let config: *mut AnyObject = msg_send![view, configuration];
        if config.is_null() {
            return;
        }
        let prefs: *mut AnyObject = msg_send![config, preferences];
        if prefs.is_null() {
            return;
        }
        let can: bool = msg_send![prefs, respondsToSelector: sel!(_setHiddenPageDOMTimerThrottlingEnabled:)];
        if can {
            let _: () = msg_send![prefs, _setHiddenPageDOMTimerThrottlingEnabled: false];
        }
        let can: bool = msg_send![prefs, respondsToSelector: sel!(_setHiddenPageDOMTimerThrottlingAutoIncreases:)];
        if can {
            let _: () = msg_send![prefs, _setHiddenPageDOMTimerThrottlingAutoIncreases: false];
        }
    });
}

/// Shows the main window and brings it to the front; `was_cli`: the app was the command line's, and
/// on macOS becomes a regular app again first (its Dock icon, its menu bar).
pub fn show_window(app: &AppHandle, was_cli: bool) {
    #[cfg(target_os = "macos")]
    if was_cli {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = was_cli;
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ---------------------------------------------------------------- the endpoint, cli.json and quitting

/// The command line's side of the app, kept as Tauri's state: what its endpoint's own routes do
/// ([`AppControl`]), `cli.json`, and quitting when the command line is done.
pub struct CliApp {
    me: Weak<CliApp>,
    app: AppHandle,
    host: Arc<McpHost>,
    data: PathBuf,
    /// The endpoint's port and token, once it listens.
    endpoint: OnceLock<(u16, Secret)>,
    state: Mutex<CliState>,
    /// `cli.json` is written from one place at a time, and not again once it is removed.
    writing: Mutex<()>,
    /// Counts the page's answers to [`QUIT_EVENT`] (`app_quit`).
    flushed: watch::Sender<u64>,
    /// When the app (its window) was made.
    made: Instant,
}

struct CliState {
    life: Lifecycle,
    /// The page has attached: calls are taken.
    ready: bool,
    /// `cli.json` is removed: the app exits.
    gone: bool,
    /// When a request showing the token last reached the command line's endpoint.
    last_request: Option<Instant>,
}

/// Whether an app that is to quit may now: no call in hand, and for [`QUIET_FOR`] no request and no
/// call, counted from the last request (`last_request`), the last moment a call was seen in hand
/// (`last_busy`: a long call's end) or the moment the app was told it was to quit (`told`), whichever
/// came last.
fn quiet(now: Instant, told: Instant, last_request: Option<Instant>, last_busy: Option<Instant>, calls: usize) -> bool {
    let since = [last_request, last_busy].into_iter().flatten().fold(told, Instant::max);
    calls == 0 && now.saturating_duration_since(since) >= QUIET_FOR
}

/// Whose the app is, and whether it is to quit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Lifecycle {
    launched_by: LaunchedBy,
    /// The command line is done with the app, which is to quit.
    quitting: bool,
}

impl Lifecycle {
    fn new(launched_by: LaunchedBy) -> Lifecycle {
        Lifecycle { launched_by, quitting: false }
    }

    /// The command line is done with the app: `Some(true)`, the quitting begins now; `Some(false)`, it
    /// had begun; `None`, the app is the user's and goes on.
    fn done(&mut self) -> Option<bool> {
        if self.launched_by == LaunchedBy::User {
            return None;
        }
        let begins = !self.quitting;
        self.quitting = true;
        Some(begins)
    }

    /// The window is shown to the user: the app is theirs from now on, and no longer quitting.
    /// Whether it was the command line's.
    fn shown(&mut self) -> bool {
        let was = self.launched_by == LaunchedBy::Cli;
        *self = Lifecycle::new(LaunchedBy::User);
        was
    }

    /// Whether the app is to quit: the command line is done with it, and it is still the command
    /// line's.
    fn quitting(&self) -> bool {
        self.quitting && self.launched_by == LaunchedBy::Cli
    }
}

impl CliApp {
    /// Starts the command line's endpoint for the app (see [`McpHost::start_cli`]), writes `cli.json`
    /// and keeps it as the page comes and goes (its standard input is watched apart: [`watch_stdin`]).
    pub fn start(app: &AppHandle, host: Arc<McpHost>, data: PathBuf, launch: Launch) -> Res<Arc<CliApp>> {
        let cli = Arc::new_cyclic(|me| CliApp {
            me: me.clone(),
            app: app.clone(),
            host: host.clone(),
            data,
            endpoint: OnceLock::new(),
            state: Mutex::new(CliState { life: Lifecycle::new(launch.launched_by()), ready: false, gone: false, last_request: None }),
            writing: Mutex::new(()),
            flushed: watch::Sender::new(0),
            made: Instant::now(),
        });
        let endpoint = host.start_cli(cli.clone())?;
        let _ = cli.endpoint.set(endpoint);
        cli.write_file();
        tauri::async_runtime::spawn(cli.clone().follow_page());
        Ok(cli)
    }

    fn state(&self) -> MutexGuard<'_, CliState> {
        lock(&self.state)
    }

    pub fn launched_by(&self) -> LaunchedBy {
        self.state().life.launched_by
    }

    /// Whether the app is to quit: the command line is done with it, and it is still the command
    /// line's.
    pub fn quitting(&self) -> bool {
        self.state().life.quitting()
    }

    /// Writes `cli.json` as things are now (not once it is removed for good).
    fn write_file(&self) {
        let _one = lock(&self.writing);
        let (launched_by, ready, gone, quitting) = {
            let s = self.state();
            (s.life.launched_by, s.ready, s.gone, s.life.quitting())
        };
        let Some((port, token)) = self.endpoint.get().filter(|_| !gone) else { return };
        let file = CliFile { pid: std::process::id(), port: *port, token: token.clone(), version: VERSION.to_string(), launched_by, ready, quitting };
        if let Err(e) = file.save(&self.data) {
            say(&format!("SmedCover: {e}"));
        }
    }

    /// Removes `cli.json`, for good, if it is this app's: the app exits.
    pub fn remove_file(&self) {
        let _one = lock(&self.writing);
        self.state().gone = true;
        if let Err(e) = instance::remove_if(&self.data, std::process::id()) {
            say(&format!("SmedCover: {e}"));
        }
    }

    /// When a request showing the token last reached the command line's endpoint.
    fn last_request(&self) -> Option<Instant> {
        self.state().last_request
    }

    /// The calls in hand, either endpoint's, those the command line's is answering itself among them.
    fn calls(&self) -> usize {
        self.host.calls_in_hand() + self.host.cli_stats().in_flight
    }

    /// Keeps `ready` in `cli.json` as the page attaches, reloads and goes.
    async fn follow_page(self: Arc<Self>) {
        let mut page = self.host.watch_page();
        loop {
            let ready = matches!(*page.borrow_and_update(), PageState::Ready { .. });
            let changed = {
                let mut s = self.state();
                let changed = s.ready != ready;
                s.ready = ready;
                changed
            };
            if changed {
                self.write_file();
            }
            if page.changed().await.is_err() {
                return;
            }
        }
    }

    /// The window shown to the user, and brought to the front: an app that was the command line's is
    /// the user's from then on, and does not quit when the command line is done (`cli.json` says so).
    pub fn show_to_user(&self) {
        let (was_cli, was_quitting) = {
            let mut s = self.state();
            let quitting = s.life.quitting();
            (s.life.shown(), quitting)
        };
        if was_cli || was_quitting {
            self.host.set_for_cli(false);
            self.write_file();
        }
        let app = self.app.clone();
        let _ = self.app.run_on_main_thread(move || show_window(&app, was_cli));
    }

    /// The app is opened again while it runs (macOS: from the Finder or the Dock, which gives it the
    /// event rather than starting a second): shown to the user if it was the command line's.
    pub fn reopened(&self) {
        if self.launched_by() == LaunchedBy::Cli {
            self.show_to_user();
        }
    }

    /// The window was brought to the front (it shows elsewhere than on macOS; there the command line's is
    /// never shown but to the user): past [`FOCUS_AFTER`] from its making, the user's doing, so the app is
    /// theirs from then on.
    pub fn focused(&self) {
        if self.launched_by() == LaunchedBy::Cli && self.made.elapsed() >= FOCUS_AFTER {
            self.show_to_user();
        }
    }

    /// The command line is done with the app: it quits, unless it is the user's (see the module's
    /// notes). Whether it is quitting; asked again, the same, and the quitting begun once.
    pub fn finish(&self) -> bool {
        let done = self.state().life.done();
        if done == Some(true) {
            self.write_file(); // "quitting": true — another command line may use the app, but is not to say it is done
            if let Some(me) = self.me.upgrade() {
                tauri::async_runtime::spawn(me.quit_when_idle(Instant::now()));
            }
        }
        done.is_some()
    }

    /// Quits once it is [`quiet`] (no call in hand, and for [`QUIET_FOR`] no request and no call, since
    /// the last of either or since `told`) and the page has written what waits ([`QUIT_EVENT`], answered by `app_quit`), or
    /// [`QUIT_WITHIN`] after it was asked; a request that came meanwhile has it wait to be quiet again.
    /// Never once the app is the user's.
    async fn quit_when_idle(self: Arc<Self>, told: Instant) {
        let mut last_busy = None;
        loop {
            loop {
                if !self.quitting() {
                    return;
                }
                let calls = self.calls();
                if calls > 0 {
                    last_busy = Some(Instant::now());
                }
                if quiet(Instant::now(), told, self.last_request(), last_busy, calls) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
            if !self.quitting() {
                return;
            }
            let asked_at = Instant::now();
            let mut answered = self.flushed.subscribe();
            answered.borrow_and_update();
            let asked = self.app.get_webview_window("main").is_some() && self.app.emit_to("main", QUIT_EVENT, ()).is_ok();
            let flushed = asked && tokio::time::timeout(QUIT_WITHIN, answered.changed()).await.is_ok_and(|r| r.is_ok());
            if !self.quitting() {
                return;
            }
            if self.last_request().is_some_and(|r| r > asked_at) || self.calls() > 0 {
                continue; // another command line came meanwhile: it is waited for, and the page asked again
            }
            if asked && !flushed {
                say(&format!("SmedCover: the window did not say within {} s that it had written what waited; quitting all the same", QUIT_WITHIN.as_secs()));
            }
            self.app.exit(0);
            return;
        }
    }

    /// The page has written what waited, answering [`QUIT_EVENT`].
    pub fn flushed(&self) {
        self.flushed.send_modify(|n| *n = n.wrapping_add(1));
    }
}

impl AppControl for CliApp {
    fn health(&self) -> Map<String, Value> {
        let mut extra = Map::new();
        extra.insert("needsSetup".into(), json!(self.host.needs_setup()));
        extra
    }

    fn show(&self) -> Value {
        self.show_to_user();
        json!({"ok": true, "launchedBy": LaunchedBy::User.as_str()})
    }

    fn done(&self) -> Value {
        let exiting = self.finish();
        json!({"ok": true, "exiting": exiting, "launchedBy": self.launched_by().as_str()})
    }

    fn request(&self) {
        self.state().last_request = Some(Instant::now());
    }
}

/// Watches the standard input the command line holds open, on a thread of its own, from the app's
/// start: at its end the command line is done with the app, or gone ([`CliApp::finish`]); before the
/// command line's side is there, the app just exits. One that cannot be read is not watched (said on
/// stderr): the app then quits only when the command line says it is done.
pub fn watch_stdin(app: AppHandle) {
    let watch = move || {
        let mut stdin = std::io::stdin();
        let mut buf = [0u8; 4096];
        loop {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(_) => {}
                Err(e) if e.kind() == ErrorKind::Interrupted => {}
                Err(e) => {
                    say(&format!("SmedCover: its standard input cannot be read ({e}), so it quits only when the command line says it is done"));
                    return;
                }
            }
        }
        match app.try_state::<Arc<CliApp>>() {
            Some(cli) => {
                cli.finish();
            }
            None => app.exit(0),
        }
    };
    if let Err(e) = std::thread::Builder::new().name("smedcover-stdin".into()).spawn(watch) {
        say(&format!("SmedCover: its standard input cannot be watched ({e})"));
    }
}

/// Says `text` on stderr, a failure to (a pipe no one reads any more) not failing the app as
/// `eprintln!` would.
pub fn say(text: &str) {
    let _ = writeln!(std::io::stderr(), "{text}");
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------------------------------------------------------------- the commands

/// The page has written what waited ([`QUIT_EVENT`]): the app exits, if it is still to quit and no
/// command line came meanwhile (see [`CliApp::quit_when_idle`]).
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    if let Some(cli) = app.try_state::<Arc<CliApp>>() {
        cli.flushed();
    }
}

/// The page waits on its first start's welcome (`needed`), or no longer: the command line's calls are
/// answered at once meanwhile that SmedCover needs setting up, and the window of an app launched for
/// the command line, shown elsewhere than on macOS, is hidden with the welcome in it.
#[tauri::command]
pub fn app_needs_setup(app: AppHandle, needed: bool) {
    if let Some(host) = app.try_state::<Arc<McpHost>>() {
        host.set_needs_setup(needed);
    }
    let for_cli = app.try_state::<Arc<CliApp>>().is_some_and(|cli| cli.launched_by() == LaunchedBy::Cli);
    if needed && for_cli && !cfg!(target_os = "macos") {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}

/// The self-test's client of the command line's endpoint.
const SELFTEST_CLI_CLIENT: &str = "smedcover-selftest-cli";

/// In self-test mode, the command line's endpoint called over HTTP as the command line calls it, once
/// the page has attached (see `cliTest` in app.js); null otherwise. What it found: `file`, what
/// `cli.json` holds (its keys, its mode on Unix, whether its pid and port are this app's and endpoint's
/// and its token one, its version, `launchedBy`, `ready`, `quitting`); `health`, the statuses `/health` answers
/// without the token, with a wrong one and with it (and its answer then), and with it and the page's
/// marker or a web page's `Origin`; `show`, what `/app/show` answers without the token; `done`,
/// `/app/done` twice with it (an app the user started goes on); `mcp`, `/mcp` without the token, and
/// with it `initialize`, `tools/list` and `get_context`, whether its client is among those Settings →
/// Agents shows, and the calls the command line's own stats count it.
#[tauri::command]
pub async fn selftest_cli(host: State<'_, Arc<McpHost>>, cli: State<'_, Arc<CliApp>>) -> Res<Option<Value>> {
    if crate::selftest_root().is_none() {
        return Ok(None);
    }
    let mut page = host.watch_page();
    tokio::time::timeout(Duration::from_secs(30), page.wait_for(|p| matches!(p, PageState::Ready { .. })))
        .await
        .map_err(|_| "the window's page did not attach within 30 s".to_string())?
        .map_err(err)?;
    let port = cli.endpoint.get().map(|(port, _)| *port).ok_or("the command line's endpoint is not running")?;
    let data = cli.data.clone();
    let mut found = tauri::async_runtime::spawn_blocking(move || selftest_client(&data, port)).await.map_err(err)??;
    let clients = host.status()["clients"].as_array().cloned().unwrap_or_default();
    found["mcp"]["shownInAgents"] = json!(clients.iter().any(|c| c["name"] == SELFTEST_CLI_CLIENT));
    found["mcp"]["counted"] = json!(host.cli_stats().clients.iter().find(|c| c.name.as_deref() == Some(SELFTEST_CLI_CLIENT)).map(|c| c.calls));
    Ok(Some(found))
}

/// [`selftest_cli`]'s requests, on a thread of its own.
fn selftest_client(data: &Path, port: u16) -> Res<Value> {
    let path = data.join(CLI_FILE);
    let raw: Value = serde_json::from_slice(&std::fs::read(&path).map_err(|e| format!("{CLI_FILE}: {e}"))?).map_err(|e| format!("{CLI_FILE}: {e}"))?;
    let keys: Vec<String> = raw.as_object().map(|o| o.keys().cloned().collect()).unwrap_or_default();
    #[cfg(unix)]
    let mode = {
        use std::os::unix::fs::PermissionsExt;
        Some(std::fs::metadata(&path).map_err(err)?.permissions().mode() & 0o777)
    };
    #[cfg(not(unix))]
    let mode: Option<u32> = None;
    let file = CliFile::from_json(&raw).ok_or("cli.json is not of the contract's shape")?;
    let bearer = format!("Bearer {}", file.token.expose());
    let token = file.token.expose().to_string();
    let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(30)).build();
    let url = |path: &str| format!("http://127.0.0.1:{port}{path}");
    let ask = |method: &str, path: &str, headers: &[(&str, &str)]| -> Res<(u16, Value)> {
        let mut request = agent.request(method, &url(path));
        for (name, value) in headers {
            request = request.set(name, value);
        }
        let sent = if method == "POST" { request.send_string("") } else { request.call() };
        let response = match sent {
            Ok(r) | Err(ureq::Error::Status(_, r)) => r,
            Err(e) => return Err(format!("{method} {path}: no answer ({e})")),
        };
        let status = response.status();
        let body = response.into_string().ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);
        Ok((status, body))
    };
    let auth = ("Authorization", bearer.as_str());
    let (right, body) = ask("GET", "/health", &[auth])?;
    let health = json!({
        "none": ask("GET", "/health", &[])?.0,
        "wrong": ask("GET", "/health", &[("Authorization", "Bearer smc_not-the-token")])?.0,
        "right": right, "body": body,
        "marker": ask("GET", "/health", &[auth, ("X-SmedCover-Page", "1")])?.0,
        "origin": ask("GET", "/health", &[auth, ("Origin", "tauri://localhost")])?.0,
    });
    let show = json!({"none": ask("POST", "/app/show", &[])?.0});
    let mut done = Vec::new();
    for _ in 0..2 {
        let (status, body) = ask("POST", "/app/done", &[auth])?;
        done.push(json!({"status": status, "body": body}));
    }
    let mcp = url("/mcp");
    let none = crate::mcp::post(&agent, &mcp, Some(1), "tools/list", json!({}), None, None)?.status;
    let hello = json!({"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": SELFTEST_CLI_CLIENT, "version": VERSION}});
    let init = crate::mcp::post(&agent, &mcp, Some(1), "initialize", hello, Some(&token), None)?;
    let session = init.session.clone();
    let result = |what: &str, posted: crate::mcp::Posted| -> Res<Value> {
        let answer = posted.answer.ok_or_else(|| format!("{what}: no answer to it (HTTP {})", posted.status))?;
        match answer.get("error") {
            Some(e) => Err(format!("{what}: {e}")),
            None => Ok(answer["result"].clone()),
        }
    };
    result("initialize", init)?;
    let s = session.as_deref();
    crate::mcp::post(&agent, &mcp, None, "notifications/initialized", json!({}), Some(&token), s)?;
    let tools = result("tools/list", crate::mcp::post(&agent, &mcp, Some(2), "tools/list", json!({}), Some(&token), s)?)?["tools"].as_array().map_or(0, Vec::len);
    let context = result("get_context", crate::mcp::post(&agent, &mcp, Some(3), "tools/call", json!({"name": "get_context", "arguments": {}}), Some(&token), s)?)?;
    Ok(json!({
        "file": {
            "keys": keys, "mode": mode, "format": raw["format"], "pid": file.pid == std::process::id(), "port": file.port == port,
            "token": token.starts_with(smedcover_core::mcp::token::PREFIX), "version": file.version, "launchedBy": file.launched_by.as_str(), "ready": file.ready,
            "quitting": file.quitting,
        },
        "health": health, "show": show, "done": done,
        "mcp": {"none": none, "tools": tools, "context": {"isError": context["isError"], "profiles": context["structuredContent"]["profiles"].as_array().map_or(0, Vec::len)}},
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn the_command_lines_launch_is_told_by_its_argument() {
        assert!(Launch::from_args(args(&["--cli"])).cli);
        assert!(Launch::from_args(args(&["-psn_0_12345", "--cli"])).cli, "among others");
        assert!(!Launch::from_args(args(&[])).cli);
        assert!(!Launch::from_args(args(&["--cli=1", "cli", "--CLI"])).cli, "only as it is spelled");
        assert_eq!(Launch { cli: true }.launched_by(), LaunchedBy::Cli);
        assert_eq!(Launch { cli: false }.launched_by(), LaunchedBy::User);
    }

    #[test]
    fn the_window_is_hidden_for_the_command_line_on_macos_and_with_the_welcome_everywhere() {
        let (cli, user) = (Launch { cli: true }, Launch { cli: false });
        assert!(!user.hidden(false) && !user.hidden(true), "the user's launch always shows it");
        assert!(cli.hidden(true), "never with the welcome in it");
        assert_eq!(cli.hidden(false), cfg!(target_os = "macos"));
    }

    #[test]
    fn done_quits_the_command_lines_app_once_and_never_the_users() {
        let mut life = Lifecycle::new(LaunchedBy::Cli);
        assert!(!life.quitting());
        assert_eq!(life.done(), Some(true), "the quitting begins");
        assert!(life.quitting());
        assert_eq!(life.done(), Some(false), "asked again: quitting still, not begun again");
        assert!(life.quitting());
        // shown to the user meanwhile: theirs, and no longer quitting
        assert!(life.shown(), "it was the command line's");
        assert_eq!(life, Lifecycle::new(LaunchedBy::User));
        assert!(!life.quitting());
        assert_eq!(life.done(), None, "the user's goes on");
        assert!(!life.quitting());
        assert!(!life.shown(), "shown again: it was the user's already");
        // one the user started is never the command line's to quit
        let mut theirs = Lifecycle::new(LaunchedBy::User);
        assert_eq!((theirs.done(), theirs.done(), theirs.quitting()), (None, None, false));
    }

    /// A second launch on a folder whose app is starting or exiting (its lock held, no cli.json) waits
    /// for the lock and takes it; one whose app runs and says where, quitting or not, defers to it; one
    /// past its wait gives up.
    #[test]
    fn a_launch_takes_the_lock_or_defers_to_the_app_that_holds_it() {
        let (cli, user) = (Launch { cli: true }, Launch { cli: false });
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path().to_path_buf();
        // the folder free: its lock
        let first = match take_or_defer(&data, cli, Duration::from_millis(100)) {
            Taken::Lock(lock) => lock,
            other => panic!("{other:?}"),
        };
        // held, with no cli.json, never let go: given up after the wait
        let t0 = Instant::now();
        assert!(matches!(take_or_defer(&data, cli, Duration::from_millis(300)), Taken::Exit(EXIT_ALREADY_RUNNING, None)));
        assert!(t0.elapsed() >= Duration::from_millis(300), "it waited");
        assert!(matches!(take_or_defer(&data, user, Duration::from_millis(200)), Taken::Exit(1, Some(_))));
        // held, the other exiting: let go in a moment, and taken
        let quitting = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            drop(first);
        });
        let second = match take_or_defer(&data, cli, Duration::from_secs(5)) {
            Taken::Lock(lock) => lock,
            other => panic!("{other:?}"),
        };
        quitting.join().unwrap();
        // held by an app whose cli.json says where it listens (quitting: it is usable all the same): the
        // command line's launch defers at once
        let port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        let file = CliFile { pid: std::process::id(), port, token: Secret::generate().unwrap(), version: VERSION.into(), launched_by: LaunchedBy::User, ready: true, quitting: true };
        file.save(&data).unwrap();
        let t0 = Instant::now();
        assert!(matches!(take_or_defer(&data, cli, Duration::from_secs(5)), Taken::Exit(EXIT_ALREADY_RUNNING, None)));
        assert!(t0.elapsed() < Duration::from_secs(1));
        // the user's asks it to show its window: nothing answers on that port, so it gives up after its wait
        assert!(matches!(take_or_defer(&data, user, Duration::from_millis(300)), Taken::Exit(1, Some(_))));
        drop(second);
    }

    /// The quiet an app that is to quit waits for: no call in hand, and 2 s with no request, counted from
    /// the last request or from when it was told, whichever came later.
    #[test]
    fn the_quiet_before_quitting() {
        let told = Instant::now();
        let s = |n: u64| Duration::from_millis(n);
        assert!(!quiet(told, told, None, None, 0), "not at once");
        assert!(!quiet(told + s(1999), told, None, None, 0));
        assert!(quiet(told + s(2000), told, None, None, 0), "2 s after it was told, no request since");
        // a request before it was told counts from when it was told
        assert!(quiet(told + s(2000), told, Some(told - s(500)), None, 0));
        // one after puts it off, from that request
        assert!(!quiet(told + s(3000), told, Some(told + s(1500)), None, 0));
        assert!(quiet(told + s(3500), told, Some(told + s(1500)), None, 0));
        // a call in hand, however long ago the last request
        assert!(!quiet(told + s(60_000), told, Some(told), Some(told + s(59_900)), 1));
        assert!(!quiet(told + s(60_000), told, None, None, 3));
        // a long call (its request long before) ended: 2 s from its end
        assert!(!quiet(told + s(61_000), told, Some(told), Some(told + s(60_000)), 0), "1 s after the call ended");
        assert!(quiet(told + s(62_000), told, Some(told), Some(told + s(60_000)), 0));
        // a clock that seems to go back (an Instant does not, but saturating) is not quiet
        assert!(!quiet(told, told + s(10), None, None, 0));
    }

    /// The command line done (by /app/done, or by its standard input's end: the same `finish`) quits
    /// its app once, the user shown the window meanwhile keeps it, and the user's app never quits for
    /// the command line, however it says it is done.
    #[test]
    fn done_and_stdins_end_are_the_same_and_the_users_app_stays() {
        for _how in ["/app/done", "stdin's end"] {
            let mut life = Lifecycle::new(LaunchedBy::Cli);
            assert_eq!(life.done(), Some(true));
            assert!(life.quitting());
            // the other way of saying it as well (the command line closes its stdin after /app/done)
            assert_eq!(life.done(), Some(false), "begun once");
            assert!(life.shown(), "shown while it waited to quit");
            assert!(!life.quitting(), "the quitting put off for good");
            assert_eq!(life.done(), None);
        }
        let mut theirs = Lifecycle::new(LaunchedBy::User);
        assert_eq!((theirs.done(), theirs.quitting()), (None, false));
    }

    #[test]
    fn a_folder_with_no_profile_file_has_none_yet() {
        let dir = tempfile::tempdir().unwrap();
        assert!(no_profile_yet(dir.path()), "no profiles folder");
        std::fs::create_dir(dir.path().join("profiles")).unwrap();
        assert!(no_profile_yet(dir.path()), "an empty one");
        std::fs::write(dir.path().join("profiles/notes.txt"), "x").unwrap();
        std::fs::create_dir(dir.path().join("profiles/old.json")).unwrap();
        assert!(no_profile_yet(dir.path()), "nothing that is a profile's file");
        std::fs::write(dir.path().join("profiles/p1.json"), "{}").unwrap();
        assert!(!no_profile_yet(dir.path()));
    }
}
