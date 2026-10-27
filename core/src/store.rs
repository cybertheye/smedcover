//! The sandboxed store: files under the data folder (profiles, settings, session, fonts), reached by
//! relative paths only, which cannot leave it.

use std::fs;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use crate::{err, Res};

/// The data folder's files that are Rust's alone, which the page's store never reads, writes or
/// deletes: the agents' settings and token, the command line's file and its token, the folder's
/// lock (and their temporary files, `<name>.<…>`).
pub const RUST_ONLY: [&str; 3] = ["mcp.json", "cli.json", "app.lock"];

/// Resolves `rel` inside `root`, refusing absolute paths, any `..` component, and the files that are
/// Rust's alone ([`RUST_ONLY`], in any case, as a file system may not tell cases apart).
pub fn resolve(root: &Path, rel: &str) -> Res<PathBuf> {
    let rel_path = Path::new(rel);
    let safe = !rel.is_empty()
        && rel_path
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !safe {
        return Err(format!("invalid path: {rel}"));
    }
    let mut parts = rel_path.components();
    if let (Some(Component::Normal(first)), None) = (parts.next(), parts.next()) {
        let name = first.to_string_lossy().to_lowercase();
        if RUST_ONLY.iter().any(|own| name == *own || name.starts_with(&format!("{own}."))) {
            return Err(format!("not allowed: {rel} is SmedCover's own"));
        }
    }
    Ok(root.join(rel_path))
}

pub fn read(root: &Path, rel: &str) -> Res<Option<String>> {
    match fs::read_to_string(resolve(root, rel)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(err(e)),
    }
}

pub fn write(root: &Path, rel: &str, data: &str) -> Res<()> {
    let path = resolve(root, rel)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(err)?;
    }
    // write-then-rename so a crash never leaves a half-written profile behind
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, data).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

pub fn list(root: &Path, rel: &str) -> Res<Vec<String>> {
    let entries = match fs::read_dir(resolve(root, rel)?) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(err(e)),
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

pub fn delete(root: &Path, rel: &str) -> Res<()> {
    match fs::remove_file(resolve(root, rel)?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        Err(e) => Err(err(e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_rejects_escapes() {
        let root = Path::new("/data");
        assert_eq!(
            resolve(root, "profiles/a.json").unwrap(),
            root.join("profiles/a.json")
        );
        // an interior "." is dropped by Path and is harmless: it stays inside the root
        assert_eq!(resolve(root, "a/./b").unwrap(), root.join("a/b"));
        for bad in ["", "../x", "a/../../x", "a/..", "/etc/passwd", "./x"] {
            assert!(resolve(root, bad).is_err(), "{bad} should be rejected");
        }
        // Rust's own files, whatever their case, and their temporary files
        for own in ["mcp.json", "cli.json", "app.lock", "CLI.json", "Mcp.Json", "cli.json.0123456789abcdef.tmp", "mcp.json.bad", "a/../cli.json"] {
            assert!(resolve(root, own).is_err(), "{own} should be refused");
        }
        for fine in ["profiles/cli.json", "cli.json5", "my-mcp.json", "fonts/app.lock.font"] {
            assert!(resolve(root, fine).is_ok(), "{fine} is the page's");
        }
    }

    #[test]
    fn store_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        assert_eq!(read(root, "settings.json").unwrap(), None);
        assert!(list(root, "profiles").unwrap().is_empty());
        write(root, "profiles/b.json", "{\"b\":1}").unwrap();
        write(root, "profiles/a.json", "{}").unwrap();
        write(root, "profiles/a.json", "{\"a\":2}").unwrap();
        assert_eq!(
            read(root, "profiles/a.json").unwrap().as_deref(),
            Some("{\"a\":2}")
        );
        assert_eq!(list(root, "profiles").unwrap(), ["a.json", "b.json"]);
        delete(root, "profiles/a.json").unwrap();
        delete(root, "profiles/a.json").unwrap(); // deleting twice is fine
        assert_eq!(list(root, "profiles").unwrap(), ["b.json"]);
        assert!(write(root, "../outside.json", "x").is_err());
    }
}
