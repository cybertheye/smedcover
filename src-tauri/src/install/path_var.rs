//! The user's own PATH on Windows: the value `Path` of `HKCU\Environment`, which Windows puts after the system's in
//! every program it starts from then on. The command line is put on it by adding its folder there and taken off by
//! removing that one entry ([`path_with`], [`path_without`]: the value's other entries left as they were, in their
//! order, their spaces and their `%VARIABLES%`); the value keeps its type (`REG_EXPAND_SZ`, as Windows makes it, whose
//! `%VARIABLES%` Windows fills in, or `REG_SZ`, whose it does not), and one made new is `REG_EXPAND_SZ`. Once it is
//! written, running programs are told the environment changed (`WM_SETTINGCHANGE` with "Environment", broadcast on a
//! thread of its own, the change answered at once: each window that does not answer is waited for 1 s), so that
//! Explorer, and the terminals it opens from then on, read it again. The editing of the value is plain text, tested on
//! every system; the registry is reached only on Windows (elsewhere [`read`] and [`write`] are never called, and say so).
#![cfg_attr(not(windows), allow(dead_code))]

use std::io;
use std::path::Path;

/// The value's text and whether it is `REG_EXPAND_SZ` (else `REG_SZ`); `None` when there is no such value.
type PathValue = Option<(String, bool)>;

/// Whether the user's PATH has `dir` among its entries.
pub fn has(dir: &Path) -> io::Result<bool> {
    let dir = text_of(dir)?;
    Ok(read()?.is_some_and(|(path, expand)| path.split(';').any(|e| same_entry(e, dir, vars(expand)))))
}

/// Adds `dir` at the end of the user's PATH, unless it is there already; tells running programs when it changed.
pub fn add(dir: &Path) -> io::Result<()> {
    let dir = text_of(dir)?;
    let (path, expand) = read()?.unwrap_or((String::new(), true));
    if let Some(path) = path_with(&path, dir, vars(expand)) {
        write(&path, expand)?;
        std::thread::spawn(broadcast);
    }
    Ok(())
}

/// Takes `dir` off the user's PATH (each entry that is it), the others left as they were; the value removed once
/// nothing is left in it. Tells running programs when it changed.
pub fn remove(dir: &Path) -> io::Result<()> {
    let dir = text_of(dir)?;
    let Some((path, expand)) = read()? else { return Ok(()) };
    if let Some(path) = path_without(&path, dir, vars(expand)) {
        if path.trim_matches(|c: char| c == ';' || c.is_whitespace()).is_empty() {
            delete()?;
        } else {
            write(&path, expand)?;
        }
        std::thread::spawn(broadcast);
    }
    Ok(())
}

/// A folder as the text a PATH entry is: not one whose name Windows cannot say in UTF-16 text.
fn text_of(dir: &Path) -> io::Result<&str> {
    dir.to_str().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "the folder's name cannot be put on the PATH"))
}

/// An environment variable of this process, for the `%VARIABLES%` of an entry.
fn env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// The variables a value's entries are filled in from: this process's for a `REG_EXPAND_SZ` (`expand`), none for a
/// `REG_SZ`, whose `%NAME%` Windows leaves as it is.
fn vars(expand: bool) -> Vars<'static> {
    expand.then_some(&env)
}

/// Where an entry's `%VARIABLES%` are filled in from (`None`: they are not).
pub type Vars<'a> = Option<&'a dyn Fn(&str) -> Option<String>>;

/// `path` (a PATH value: entries split by `;`) with `dir` added at its end, or `None` when one of its entries is `dir`
/// already ([`same_entry`]).
pub fn path_with(path: &str, dir: &str, vars: Vars) -> Option<String> {
    if path.split(';').any(|e| same_entry(e, dir, vars)) {
        return None;
    }
    Some(if path.trim().is_empty() {
        dir.to_string()
    } else if path.ends_with(';') {
        format!("{path}{dir}")
    } else {
        format!("{path};{dir}")
    })
}

/// `path` without the entries that are `dir` ([`same_entry`]), the others as they were and in their order; `None` when
/// none of them is.
pub fn path_without(path: &str, dir: &str, vars: Vars) -> Option<String> {
    let kept: Vec<&str> = path.split(';').filter(|e| !same_entry(e, dir, vars)).collect();
    (kept.len() != path.split(';').count()).then(|| kept.join(";"))
}

/// Whether PATH entry `entry` names folder `dir`, as Windows would find a program there: spaces around it and quotes
/// round it aside, its `%VARIABLES%` filled in from `vars` (a `REG_EXPAND_SZ`'s; a `REG_SZ`'s are not), `/` taken for
/// `\`, a `\` at its end and a `\\?\` before it aside, letters of either case alike. An empty entry is no folder.
pub fn same_entry(entry: &str, dir: &str, vars: Vars) -> bool {
    let norm = |s: &str| {
        let s = s.trim();
        let s = s.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(s).trim();
        let s = match vars { Some(env) => expand(s, env), None => s.to_string() }.replace('/', "\\");
        let s = s.strip_prefix(r"\\?\").unwrap_or(&s).to_string();
        let s = if s.len() > 3 { s.trim_end_matches('\\') } else { &s };   // C:\ stays C:\
        s.to_lowercase()
    };
    let e = norm(entry);
    !e.is_empty() && e == norm(dir)
}

/// `s` with each `%NAME%` that `env` knows replaced by its value, as Windows expands a `REG_EXPAND_SZ`; one it does not
/// know is left as it is.
fn expand(s: &str, env: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) if j > 0 && env(&after[..j]).is_some() => {
                out.push_str(&env(&after[..j]).unwrap_or_default());
                rest = &after[j + 1..];
            }
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(windows)]
use windows_registry::{broadcast, delete, read, write};

#[cfg(windows)]
mod windows_registry {
    use std::io;

    use winreg::enums::{RegType, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE};
    use winreg::{RegKey, RegValue};

    use super::PathValue;

    const KEY: &str = "Environment";
    const VALUE: &str = "Path";

    fn key(write: bool) -> io::Result<RegKey> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if write {
            hkcu.create_subkey_with_flags(KEY, KEY_READ | KEY_WRITE).map(|(k, _)| k)
        } else {
            hkcu.open_subkey_with_flags(KEY, KEY_READ)
        }
    }

    /// The value, read as it is (not expanded); text only: one of another type, or not UTF-16 text, is refused rather
    /// than written back changed.
    pub fn read() -> io::Result<PathValue> {
        let raw = match key(false).and_then(|k| k.get_raw_value(VALUE)) {
            Ok(raw) => raw,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let expand = match raw.vtype {
            RegType::REG_EXPAND_SZ => true,
            RegType::REG_SZ => false,
            _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "the user's Path is not text")),
        };
        let mut units: Vec<u16> = raw.bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        while units.last() == Some(&0) {
            units.pop();
        }
        let text = String::from_utf16(&units).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "the user's Path is not text this can keep"))?;
        Ok(Some((text, expand)))
    }

    /// Writes `path` as the value, of the type it had (`REG_EXPAND_SZ` when `expand`), ended with a NUL as Windows
    /// writes it.
    pub fn write(path: &str, expand: bool) -> io::Result<()> {
        let bytes: Vec<u8> = path.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        let vtype = if expand { RegType::REG_EXPAND_SZ } else { RegType::REG_SZ };
        key(true)?.set_raw_value(VALUE, &RegValue { bytes: bytes.into(), vtype })
    }

    /// Removes the value.
    pub fn delete() -> io::Result<()> {
        match key(true)?.delete_value(VALUE) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        }
    }

    /// Tells every top-level window the environment changed, as the system's own settings do: Explorer reads it again,
    /// and the programs it starts from then on have the new PATH. A window that does not answer is waited for 1 s at
    /// most (`SMTO_ABORTIFHUNG`); called on a thread of its own, it holds nothing up.
    pub fn broadcast() {
        use windows_sys::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};
        let what: Vec<u16> = "Environment".encode_utf16().chain([0]).collect();
        let mut result = 0usize;
        // SAFETY: `what` is a NUL-ended UTF-16 string that outlives the call, and `result` a place for its answer.
        unsafe {
            SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, 0, what.as_ptr() as isize, SMTO_ABORTIFHUNG, 1000, &mut result);
        }
    }
}

#[cfg(not(windows))]
use elsewhere::{broadcast, delete, read, write};

/// Elsewhere than on Windows there is no such PATH (never asked: install.rs asks on Windows alone).
#[cfg(not(windows))]
mod elsewhere {
    use std::io;

    use super::PathValue;

    fn none() -> io::Error {
        io::Error::new(io::ErrorKind::Unsupported, "the user's PATH in the registry is Windows' own")
    }
    pub fn read() -> io::Result<PathValue> {
        Err(none())
    }
    pub fn write(_: &str, _: bool) -> io::Result<()> {
        Err(none())
    }
    pub fn delete() -> io::Result<()> {
        Err(none())
    }
    pub fn broadcast() {}
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(name: &str) -> Option<String> {
        match name {
            "LOCALAPPDATA" => Some(r"C:\Users\Ann\AppData\Local".into()),
            "USERPROFILE" => Some(r"C:\Users\Ann".into()),
            _ => None,
        }
    }
    const DIR: &str = r"C:\Users\Ann\AppData\Local\SmedCover";
    /// A REG_EXPAND_SZ's variables, filled in from `vars`.
    const E: Vars = Some(&vars);

    #[test]
    fn an_entry_is_the_folder_however_it_is_written() {
        for e in [DIR, r"c:\users\ann\appdata\local\smedcover", r"C:\Users\Ann\AppData\Local\SmedCover\", r#""C:\Users\Ann\AppData\Local\SmedCover""#, r"  C:\Users\Ann\AppData\Local\SmedCover  ",
            r"%LOCALAPPDATA%\SmedCover", r"%USERPROFILE%\AppData\Local\SmedCover\", "C:/Users/Ann/AppData/Local/SmedCover", r"\\?\C:\Users\Ann\AppData\Local\SmedCover"] {
            assert!(same_entry(e, DIR, E), "{e}");
        }
        for e in ["", " ", r"C:\Users\Ann\AppData\Local\SmedCover2", r"C:\Users\Ann\AppData\Local", r"%NOPE%\SmedCover", r"%LOCALAPPDATA%\SmedCover\bin"] {
            assert!(!same_entry(e, DIR, E), "{e}");
        }
        assert!(same_entry(r"C:\", r"c:\", E), "a drive's root keeps its \\");
        assert!(!same_entry(r"C:", r"C:\x", E));
    }

    #[test]
    fn the_folder_is_added_once_at_the_end() {
        assert_eq!(path_with("", DIR, E).as_deref(), Some(DIR));
        assert_eq!(path_with("  ", DIR, E).as_deref(), Some(DIR));
        assert_eq!(path_with(r"%USERPROFILE%\bin", DIR, E), Some(format!(r"%USERPROFILE%\bin;{DIR}")));
        assert_eq!(path_with(r"C:\a;C:\b;", DIR, E), Some(format!(r"C:\a;C:\b;{DIR}")));   // its ; at the end kept as the one before ours
        assert_eq!(path_with(r"C:\a;;C:\b", DIR, E), Some(format!(r"C:\a;;C:\b;{DIR}")));   // an empty entry left
        assert_eq!(path_with(r"C:\a;%LOCALAPPDATA%\SmedCover;C:\b", DIR, E), None, "there already, written otherwise");
        assert_eq!(path_with(&format!(r"{}\;C:\b", DIR.to_lowercase()), DIR, E), None);
        assert_eq!(path_with("C:\\Program Files\\Ünïcode;D:\\x", DIR, E), Some(format!("C:\\Program Files\\Ünïcode;D:\\x;{DIR}")));
    }

    #[test]
    fn only_that_folder_is_taken_out() {
        assert_eq!(path_without(DIR, DIR, E).as_deref(), Some(""));
        assert_eq!(path_without(&format!(r"C:\a;{DIR};C:\b"), DIR, E).as_deref(), Some(r"C:\a;C:\b"));
        assert_eq!(path_without(&format!(r"C:\a;;{DIR}"), DIR, E).as_deref(), Some(r"C:\a;"), "the others as they were, an empty one too");
        assert_eq!(path_without(&format!(r"{DIR};%USERPROFILE%\bin; C:\c ;{DIR}\"), DIR, E).as_deref(), Some(r"%USERPROFILE%\bin; C:\c "), "every entry that is it, the others untouched");
        assert_eq!(path_without(r"C:\a;%LOCALAPPDATA%\SmedCover", DIR, E).as_deref(), Some(r"C:\a"));
        assert_eq!(path_without(r"C:\a;C:\b", DIR, E), None, "not there: nothing to write");
        assert_eq!(path_without("", DIR, E), None);
        assert_eq!(path_without(r"C:\a;C:\Users\Ann\AppData\Local\SmedCover2", DIR, E), None);
        // what is added is what is taken out, and nothing else
        for before in ["", r"C:\a", r"C:\a;", r"%USERPROFILE%\bin;C:\a"] {
            let added = path_with(before, DIR, E).unwrap();
            let back = path_without(&added, DIR, E).unwrap();
            assert_eq!(back.trim_end_matches(';'), before.trim_end_matches(';'), "{before:?}");
        }
    }

    #[test]
    fn a_reg_sz_s_variables_are_left_as_they_are() {
        // in a REG_SZ, %LOCALAPPDATA% is not filled in by Windows: such an entry is not the folder
        assert!(!same_entry(r"%LOCALAPPDATA%\SmedCover", DIR, None));
        assert!(same_entry(r"c:\users\ann\appdata\local\smedcover\", DIR, None));
        assert_eq!(path_with(r"C:\a;%LOCALAPPDATA%\SmedCover", DIR, None), Some(format!(r"C:\a;%LOCALAPPDATA%\SmedCover;{DIR}")));
        assert_eq!(path_without(r"C:\a;%LOCALAPPDATA%\SmedCover", DIR, None), None, "not it: left");
        assert_eq!(path_without(&format!(r"%LOCALAPPDATA%\SmedCover;{DIR}"), DIR, None).as_deref(), Some(r"%LOCALAPPDATA%\SmedCover"));
    }

    #[test]
    fn variables_are_filled_in_as_windows_does() {
        assert_eq!(expand(r"%LOCALAPPDATA%\x", &vars), r"C:\Users\Ann\AppData\Local\x");
        assert_eq!(expand(r"%NOPE%\x", &vars), r"%NOPE%\x");
        assert_eq!(expand("100% sure %USERPROFILE%", &vars), r"100% sure C:\Users\Ann");
        assert_eq!(expand("%%", &vars), "%%");
        assert_eq!(expand("a%", &vars), "a%");
    }
}
