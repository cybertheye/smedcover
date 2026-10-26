//! Ctrl-C. The first asks the command line to stop: the call under way is cancelled and the app it started told it is
//! done, before it exits (130). A second, while that goes on, exits at once.

use std::sync::atomic::{AtomicBool, Ordering};

static REQUESTED: AtomicBool = AtomicBool::new(false);

/// Listens for Ctrl-C from now on (once; a second install is ignored).
pub fn install() {
    let _ = ctrlc::set_handler(|| {
        if REQUESTED.swap(true, Ordering::SeqCst) {
            std::process::exit(crate::exit::INTERRUPTED);
        }
    });
}

/// Whether Ctrl-C was pressed.
pub fn requested() -> bool {
    REQUESTED.load(Ordering::SeqCst)
}
