//! Files outside the data folder that an agent names (see `add_photo` and `open_project` in `ui/js/tools.js`): a
//! picture to put on a cover, a project to open. Each is read whole, and only when it is what it says it is — an
//! absolute path to a regular file of the right kind, no bigger than a cap — so an agent's call can read nothing else
//! of the computer's: no folder, no file of another kind, nothing past the cap.

use std::fs;
use std::io::Read;
use std::path::Path;

use crate::{err, Res};

/// The most a picture read for an agent may weigh: as much as the photo store takes in a session.
pub const PICTURE_MAX: u64 = 64 * 1024 * 1024;
/// The most a project file may weigh (its photos travel inside it, in base64).
pub const PROJECT_MAX: u64 = 128 * 1024 * 1024;
/// What a project file's name ends with (the case aside), as the app saves one.
pub const PROJECT_SUFFIX: &str = ".smedcover.json";

/// The pictures read: the extensions a file may have and what its first bytes then show it to be — those a photo
/// can be uploaded as and the web view decodes (HEIC on macOS; AVIF, HEIC's sibling, where the web view has it).
const PICTURE_EXTS: [&str; 8] = ["png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "avif"];

/// The type of a picture by its first bytes: PNG, JPEG, GIF, WebP, or HEIC/HEIF/AVIF (an ISO media file's `ftyp`
/// box with one of their brands). None for anything else.
pub fn picture_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return Some("image/webp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        return match &bytes[8..12] {
            b"avif" | b"avis" => Some("image/avif"),
            b"heic" | b"heix" | b"hevc" | b"hevx" | b"heim" | b"heis" => Some("image/heic"),
            b"mif1" | b"msf1" => Some("image/heif"),
            _ => None,
        };
    }
    None
}

/// The file at `path`, checked: absolute, there, a regular file (a link is followed), no bigger than `max`, and read
/// no further than that (a file growing meanwhile is refused, not cut short).
fn read_capped(path: &Path, max: u64, what: &str) -> Res<Vec<u8>> {
    if !path.is_absolute() {
        return Err(format!("not an absolute path: {}", path.display()));
    }
    let meta = fs::metadata(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => format!("no such file: {}", path.display()),
        _ => format!("{}: {e}", path.display()),
    })?;
    if !meta.is_file() {
        return Err(format!("not a file: {}", path.display()));
    }
    let too_big = |n: u64| format!("{what} too big: {} is {} MB, at most {} MB", path.display(), n.div_ceil(1024 * 1024), max / (1024 * 1024));
    if meta.len() > max {
        return Err(too_big(meta.len()));
    }
    let mut bytes = Vec::with_capacity(meta.len() as usize);
    fs::File::open(path).map_err(err)?.take(max + 1).read_to_end(&mut bytes).map_err(err)?;
    if bytes.len() as u64 > max {
        return Err(too_big(bytes.len() as u64));
    }
    Ok(bytes)
}

/// A picture on this computer, for an agent's `add_photo`: its type (by its bytes) and its bytes. Only an absolute
/// path to a regular file named as a picture is (.png, .jpg, .jpeg, .webp, .gif, .heic, .heif, .avif) whose bytes are
/// one too, at most [`PICTURE_MAX`].
pub fn read_picture(path: &Path) -> Res<(&'static str, Vec<u8>)> {
    let ext = crate::image::extension(&path.to_string_lossy());
    if !PICTURE_EXTS.contains(&ext.as_str()) {
        return Err(format!("not a picture file: {} (PNG, JPEG, WebP, GIF, HEIC or AVIF)", path.display()));
    }
    let bytes = read_capped(path, PICTURE_MAX, "picture")?;
    let mime = picture_type(&bytes).ok_or_else(|| format!("not a picture: {} does not hold a PNG, JPEG, WebP, GIF, HEIC or AVIF image", path.display()))?;
    Ok((mime, bytes))
}

/// A project file on this computer, for an agent's `open_project`: its text. Only an absolute path to a regular file
/// whose name ends with `.smedcover.json` is, at most [`PROJECT_MAX`], in UTF-8 (a byte-order mark left out, as the
/// web view's file reader leaves it out).
pub fn read_project(path: &Path) -> Res<String> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !name.ends_with(PROJECT_SUFFIX) || name.len() == PROJECT_SUFFIX.len() {
        return Err(format!("not a project file: {} (its name ends with {PROJECT_SUFFIX})", path.display()));
    }
    let bytes = read_capped(path, PROJECT_MAX, "project")?;
    let text = String::from_utf8(bytes).map_err(|_| format!("not UTF-8 text: {}", path.display()))?;
    Ok(text.strip_prefix('\u{feff}').map(str::to_string).unwrap_or(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

    #[test]
    fn picture_type_reads_the_first_bytes() {
        assert_eq!(picture_type(PNG), Some("image/png"));
        assert_eq!(picture_type(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]), Some("image/jpeg"));
        assert_eq!(picture_type(b"GIF89a\x01\x00"), Some("image/gif"));
        assert_eq!(picture_type(b"RIFF\x24\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(picture_type(b"\0\0\0\x18ftypheic\0\0\0\0"), Some("image/heic"));
        assert_eq!(picture_type(b"\0\0\0\x18ftypmif1\0\0\0\0"), Some("image/heif"));
        assert_eq!(picture_type(b"\0\0\0\x1cftypavif\0\0\0\0"), Some("image/avif"));
        assert_eq!(picture_type(b"\0\0\0\x18ftypisom\0\0\0\0"), None, "a video");
        assert_eq!(picture_type(b"%PDF-1.7"), None);
        assert_eq!(picture_type(b""), None);
    }

    #[test]
    fn read_picture_takes_a_picture_file_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let at = |n: &str| dir.path().join(n);
        fs::write(at("photo.PNG"), PNG).unwrap();
        assert_eq!(read_picture(&at("photo.PNG")).unwrap(), ("image/png", PNG.to_vec()));
        // named as one kind, another inside: the bytes say what it is
        fs::write(at("photo.jpg"), PNG).unwrap();
        assert_eq!(read_picture(&at("photo.jpg")).unwrap().0, "image/png");
        // not named as a picture, or not one inside, a folder, not there, not absolute
        fs::write(at("notes.txt"), PNG).unwrap();
        assert!(read_picture(&at("notes.txt")).unwrap_err().starts_with("not a picture file:"));
        fs::write(at("fake.png"), b"hello, world").unwrap();
        assert!(read_picture(&at("fake.png")).unwrap_err().starts_with("not a picture:"));
        fs::create_dir(at("folder.png")).unwrap();
        assert!(read_picture(&at("folder.png")).unwrap_err().starts_with("not a file:"));
        assert!(read_picture(&at("gone.png")).unwrap_err().starts_with("no such file:"));
        assert!(read_picture(Path::new("photo.png")).unwrap_err().starts_with("not an absolute path:"));
        assert!(read_picture(Path::new("../photo.png")).unwrap_err().starts_with("not an absolute path:"));
        // past the cap: refused before it is read
        let big = fs::File::create(at("big.png")).unwrap();
        big.set_len(PICTURE_MAX + 1).unwrap();
        assert!(read_picture(&at("big.png")).unwrap_err().starts_with("picture too big:"));
    }

    #[cfg(unix)]
    #[test]
    fn read_picture_follows_a_link_to_a_picture_only() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.png"), PNG).unwrap();
        std::os::unix::fs::symlink(dir.path().join("a.png"), dir.path().join("link.png")).unwrap();
        assert_eq!(read_picture(&dir.path().join("link.png")).unwrap().0, "image/png");
        std::os::unix::fs::symlink(dir.path(), dir.path().join("dir.png")).unwrap();
        assert!(read_picture(&dir.path().join("dir.png")).unwrap_err().starts_with("not a file:"));
    }

    #[test]
    fn read_project_takes_a_project_file_and_nothing_else() {
        let dir = tempfile::tempdir().unwrap();
        let at = |n: &str| dir.path().join(n);
        fs::write(at("Cover.SmedCover.json"), "\u{feff}{\"kind\":\"project\"}").unwrap();
        assert_eq!(read_project(&at("Cover.SmedCover.json")).unwrap(), "{\"kind\":\"project\"}", "the byte-order mark left out");
        fs::write(at("settings.json"), "{}").unwrap();
        assert!(read_project(&at("settings.json")).unwrap_err().starts_with("not a project file:"));
        fs::write(at(".smedcover.json"), "{}").unwrap();
        assert!(read_project(&at(".smedcover.json")).unwrap_err().starts_with("not a project file:"), "a name of nothing but the ending");
        fs::write(at("bad.smedcover.json"), [0xFF, 0xFE, 0x00]).unwrap();
        assert!(read_project(&at("bad.smedcover.json")).unwrap_err().starts_with("not UTF-8 text:"));
        fs::create_dir(at("dir.smedcover.json")).unwrap();
        assert!(read_project(&at("dir.smedcover.json")).unwrap_err().starts_with("not a file:"));
        assert!(read_project(Path::new("a.smedcover.json")).unwrap_err().starts_with("not an absolute path:"));
        assert!(read_project(&at("gone.smedcover.json")).unwrap_err().starts_with("no such file:"));
        let big = fs::File::create(at("big.smedcover.json")).unwrap();
        big.set_len(PROJECT_MAX + 1).unwrap();
        assert!(read_project(&at("big.smedcover.json")).unwrap_err().starts_with("project too big:"));
    }
}
