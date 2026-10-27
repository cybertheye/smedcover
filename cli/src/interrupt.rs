//! Ctrl-C. While the command has nothing in hand (it is checking its arguments, reading its input), the first exits
//! at once (130). From the moment it reaches for the app ([`hold`]) the first asks it to stop: the call under way is
//! cancelled and an app it started told it is done, before it exits (130). A second, while that goes on, exits at
//! once, `render`'s scratch folder ([`scratch`]) removed first.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

static REQUESTED: AtomicBool = AtomicBool::new(false);
static HELD: AtomicBool = AtomicBool::new(false);
static SCRATCH: Mutex<Option<PathBuf>> = Mutex::new(None);

/// Listens for Ctrl-C from now on (once; a second install is ignored).
pub fn install() {
    let _ = ctrlc::set_handler(|| {
        let again = REQUESTED.swap(true, Ordering::SeqCst);
        if again || !HELD.load(Ordering::SeqCst) {
            if let Some(dir) = SCRATCH.lock().ok().and_then(|mut s| s.take()) {
                let _ = std::fs::remove_dir_all(dir);
            }
            std::process::exit(crate::exit::INTERRUPTED);
        }
    });
}

/// Whether Ctrl-C was pressed.
pub fn requested() -> bool {
    REQUESTED.load(Ordering::SeqCst)
}

/// From now on, the command has something in hand (an app, a call): the first Ctrl-C asks it to stop.
pub fn hold() {
    HELD.store(true, Ordering::SeqCst);
}

/// The folder to remove when a second Ctrl-C exits at once (`None`: none any more).
pub fn scratch(dir: Option<PathBuf>) {
    if let Ok(mut s) = SCRATCH.lock() {
        *s = dir;
    }
}
