//! Fonts: those installed on the system, those shipped with the interface and those the user
//! imported, found by family name to trace lettering in ([`crate::outline`]); and a system family's
//! faces handed to the web view as font files of their own.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;

use crate::{store, Res};

/// The fonts shipped with the interface, by their path in `ui/` ("fonts/NotoSansSC.ttf"): the app
/// has them among its assets, a server in its `ui/` folder.
pub trait BundledFonts: Send + Sync {
    fn get(&self, path: &str) -> Option<Vec<u8>>;
}

/// A font family installed on this machine, and whether it can set Chinese.
#[derive(Serialize)]
pub struct FontInfo {
    pub name: String,
    pub cjk: bool,
}

/// The font families installed on this machine, sorted, without duplicates. A family counts as
/// able to set Chinese when one of its faces has glyphs for a few everyday characters; a font
/// without them leaves Chinese text to whatever the system falls back to.
pub fn list_system() -> Vec<FontInfo> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    let mut found: std::collections::BTreeMap<String, bool> = std::collections::BTreeMap::new();
    for face in db.faces() {
        let Some((name, _)) = face.families.first() else { continue };
        if name.starts_with('.') {
            continue;
        }
        let known = found.get(name).copied().unwrap_or(false);
        let cjk = known
            || db
                .with_face_data(face.id, |data, index| {
                    ttf_parser::Face::parse(data, index)
                        .map(|f| "的封面".chars().all(|c| f.glyph_index(c).is_some()))
                        .unwrap_or(false)
                })
                .unwrap_or(false);
        found.insert(name.clone(), cjk);
    }
    let mut fonts: Vec<FontInfo> = found.into_iter().map(|(name, cjk)| FontInfo { name, cjk }).collect();
    fonts.sort_by_key(|f| f.name.to_lowercase());
    fonts
}

/// The fonts of one data folder's core, found by family name (see [`Fonts::file`]): the ones the
/// user imported belong to that folder.
pub(crate) struct Fonts {
    /// Font files already found (or found to be absent), by lower-cased family name.
    files: Mutex<HashMap<String, Option<Arc<(Vec<u8>, u32)>>>>,
    bundled: Arc<dyn BundledFonts>,
}

/// The fonts installed on the system, scanned once.
static SYSTEM_FONTS: OnceLock<fontdb::Database> = OnceLock::new();
/// The fonts shipped with the interface, by family name.
const BUNDLED_FONTS: [(&str, &str); 3] = [
    ("noto sans sc", "fonts/NotoSansSC.ttf"),
    ("bebas neue", "fonts/BebasNeue-Regular.ttf"),
    ("jetbrains mono", "fonts/JetBrainsMono.ttf"),
];

/// The bytes of a font the user imported: it is stored as a data URL in the data folder `data`.
fn imported_font(data: &Path, family: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    let text = store::read(data, &format!("fonts/{family}.font")).ok()??;
    let b64 = text.split_once("base64,")?.1;
    base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .ok()
}

impl Fonts {
    pub(crate) fn new(bundled: Arc<dyn BundledFonts>) -> Fonts {
        Fonts { files: Mutex::new(HashMap::new()), bundled }
    }

    /// Lets go of the file found for a family (see `file`), to be looked for again: a font imported under its name.
    pub(crate) fn forget(&self, family: &str) {
        if let Ok(mut files) = self.files.lock() {
            files.remove(&family.trim().to_lowercase());
        }
    }

    /// Finds the file behind a family name: a bundled font, one the user imported into `data`, or a
    /// system font.
    pub(crate) fn file(&self, data: &Path, family: &str) -> Option<Arc<(Vec<u8>, u32)>> {
        let key = family.trim().to_lowercase();
        if let Some(known) = self.files.lock().ok()?.get(&key) {
            return known.clone();
        }
        let bundled = BUNDLED_FONTS
            .iter()
            .find(|(name, _)| *name == key)
            .and_then(|(_, path)| self.bundled.get(path))
            .map(|bytes| (bytes, 0));
        let found = bundled
            .or_else(|| imported_font(data, family.trim()).map(|bytes| (bytes, 0)))
            .or_else(|| {
                let db = system_fonts();
                let id = db.query(&fontdb::Query {
                    families: &[fontdb::Family::Name(family.trim())],
                    weight: fontdb::Weight::BLACK,
                    ..fontdb::Query::default()
                })?;
                db.with_face_data(id, |data, index| (data.to_vec(), index))
            })
            .map(Arc::new);
        self.files.lock().ok()?.insert(key, found.clone());
        found
    }
}

/// The fonts installed on the system (scanned the first time they are needed).
fn system_fonts() -> &'static fontdb::Database {
    SYSTEM_FONTS.get_or_init(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        db
    })
}

/// One face of a font file as a font file of its own, for the web view to load: a collection (.ttc)
/// is cut down to the face at `index`, its table directory and the tables that points at; a single
/// font is handed back as it is. None if the file is not what it claims.
fn single_face(data: &[u8], index: u32) -> Option<Vec<u8>> {
    let u32_at = |at: usize| data.get(at..at + 4).map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]));
    if data.get(0..4)? != b"ttcf" {
        return Some(data.to_vec());
    }
    if index >= u32_at(8)? {
        return None;
    }
    let at = u32_at(12 + 4 * index as usize)? as usize;
    let n = data.get(at + 4..at + 6).map(|b| u16::from_be_bytes([b[0], b[1]]))? as usize;
    let mut out = data.get(at..at + 12)?.to_vec();
    let (mut bodies, mut offset) = (Vec::with_capacity(n), 12 + 16 * n);
    for i in 0..n {
        let rec = at + 12 + 16 * i;
        let (start, len) = (u32_at(rec + 8)? as usize, u32_at(rec + 12)? as usize);
        bodies.push(data.get(start..start.checked_add(len)?)?);
        out.extend_from_slice(data.get(rec..rec + 8)?); // tag and checksum
        out.extend_from_slice(&(offset as u32).to_be_bytes());
        out.extend_from_slice(&(len as u32).to_be_bytes());
        offset += (len + 3) & !3;
    }
    for body in bodies {
        out.extend_from_slice(body);
        out.resize((out.len() + 3) & !3, 0);
    }
    Some(out)
}

/// The upright faces the system has of `family`, one per weight, lightest first (all its faces if it
/// has no upright one).
fn family_faces(family: &str) -> Vec<fontdb::ID> {
    let name = family.trim();
    let mut all: Vec<&fontdb::FaceInfo> = system_fonts()
        .faces()
        .filter(|f| f.families.iter().any(|(n, _)| n == name))
        .collect();
    if all.iter().any(|f| f.style == fontdb::Style::Normal && f.stretch == fontdb::Stretch::Normal) {
        all.retain(|f| f.style == fontdb::Style::Normal && f.stretch == fontdb::Stretch::Normal);
    }
    all.sort_by_key(|f| f.weight.0);
    all.dedup_by_key(|f| f.weight.0);
    all.iter().map(|f| f.id).collect()
}

/// A few characters a font has, to try it with: those of the editor's own probe it has, or else the
/// first it has.
fn probe_text(face: &ttf_parser::Face) -> String {
    let mut out: String = "封面Aa01".chars().filter(|&ch| face.glyph_index(ch).is_some()).collect();
    if out.chars().count() >= 3 {
        return out;
    }
    if let Some(cmap) = face.tables().cmap {
        for table in cmap.subtables.into_iter().filter(|t| t.is_unicode()) {
            table.codepoints(|cp| {
                if out.chars().count() >= 8 || cp <= 0x20 {
                    return;
                }
                if let Some(ch) = char::from_u32(cp).filter(|ch| !ch.is_whitespace() && !ch.is_control()) {
                    if face.glyph_index(ch).is_some() && !out.contains(ch) {
                        out.push(ch);
                    }
                }
            });
        }
    }
    out
}

/// A system family's faces as the web view is to load them (see [`face_data`]): the weight of each — a
/// variable one's weight axis as a range, "min max" — and characters to try the family with.
#[derive(Serialize, Debug)]
pub struct FontFaces {
    pub probe: String,
    pub weights: Vec<String>,
}

/// The faces the system has of `family` (the command `font_faces`).
///
/// WebKit sets a canvas that is not in the page — the effects' work canvases, an export — only in the
/// fonts that came with the system; one the user installed, or one macOS downloads on demand, falls
/// back to the default there. Such a family is loaded into the page from its files, where every canvas
/// finds it (see ensureFont in app.js): font_faces says what there is, font_data hands over each face.
pub fn faces(family: &str) -> Res<FontFaces> {
    let (db, ids) = (system_fonts(), family_faces(family));
    if ids.is_empty() {
        return Err("no such font".to_string());
    }
    let mut out = FontFaces { probe: String::new(), weights: Vec::new() };
    for id in ids {
        let weight = db.face(id).map(|f| f.weight.0).unwrap_or(400).to_string();
        let range = db
            .with_face_data(id, |data, index| {
                let face = ttf_parser::Face::parse(data, index).ok()?;
                if out.probe.is_empty() {
                    out.probe = probe_text(&face);
                }
                let axis = face.variation_axes().into_iter().find(|a| a.tag == ttf_parser::Tag::from_bytes(b"wght"))?;
                Some(format!("{} {}", axis.min_value.round(), axis.max_value.round()))
            })
            .flatten();
        out.weights.push(range.unwrap_or(weight));
    }
    Ok(out)
}

/// Face `n` of a system family (see [`faces`]), as a font file of its own (see single_face): the
/// command `font_data`.
pub fn face_data(family: &str, n: usize) -> Res<Vec<u8>> {
    let id = *family_faces(family).get(n).ok_or("no such face")?;
    system_fonts()
        .with_face_data(id, |data, index| single_face(data, index))
        .flatten()
        .ok_or_else(|| "unreadable font file".to_string())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;

    pub(crate) fn bundled(name: &str) -> Arc<(Vec<u8>, u32)> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../ui/fonts")
            .join(name);
        Arc::new((fs::read(path).unwrap(), 0))
    }

    #[test]
    fn single_face_cuts_a_face_out_of_a_collection() {
        let fonts = [bundled("BebasNeue-Regular.ttf"), bundled("JetBrainsMono.ttf")];
        // a collection of the two: its header, both table directories, then every table, the directories pointing into it
        let u32_at = |d: &[u8], at: usize| u32::from_be_bytes([d[at], d[at + 1], d[at + 2], d[at + 3]]) as usize;
        let tables = |d: &[u8]| (u16::from_be_bytes([d[4], d[5]]) as usize, 12 + 16 * u16::from_be_bytes([d[4], d[5]]) as usize);
        let mut ttc = b"ttcf\x00\x01\x00\x00\x00\x00\x00\x02".to_vec();
        let dirs: Vec<usize> = fonts.iter().map(|f| tables(&f.0).1).collect();
        let (mut at, mut data_at) = (20, 20 + dirs.iter().sum::<usize>());
        for d in &dirs {
            ttc.extend_from_slice(&(at as u32).to_be_bytes());
            at += d;
        }
        let mut bodies = Vec::new();
        for f in &fonts {
            let (n, _) = tables(&f.0);
            ttc.extend_from_slice(&f.0[0..12]);
            for i in 0..n {
                let rec = 12 + 16 * i;
                let (start, len) = (u32_at(&f.0, rec + 8), u32_at(&f.0, rec + 12));
                ttc.extend_from_slice(&f.0[rec..rec + 8]);
                ttc.extend_from_slice(&(data_at as u32).to_be_bytes());
                ttc.extend_from_slice(&(len as u32).to_be_bytes());
                bodies.extend_from_slice(&f.0[start..start + len]);
                bodies.resize((bodies.len() + 3) & !3, 0);
                data_at = 20 + dirs.iter().sum::<usize>() + bodies.len();
            }
        }
        ttc.extend_from_slice(&bodies);
        for (i, f) in fonts.iter().enumerate() {
            let face = single_face(&ttc, i as u32).unwrap();
            assert_eq!(&face[0..4], &f.0[0..4]);
            let (a, b) = (ttf_parser::Face::parse(&face, 0).unwrap(), ttf_parser::Face::parse(&f.0, 0).unwrap());
            assert_eq!(a.number_of_glyphs(), b.number_of_glyphs());
            assert_eq!(a.glyph_index('A'), b.glyph_index('A'));
            assert_eq!(a.glyph_hor_advance(a.glyph_index('A').unwrap()), b.glyph_hor_advance(b.glyph_index('A').unwrap()));
        }
        assert!(single_face(&ttc, 2).is_none());
        assert!(single_face(&ttc[..30], 1).is_none()); // cut short
        assert_eq!(single_face(&fonts[0].0, 0).unwrap(), fonts[0].0); // one font: as it is
    }

    #[test]
    fn probe_text_is_what_the_font_has() {
        let face = |name: &str| bundled(name);
        let (mono, cjk) = (face("JetBrainsMono.ttf"), face("NotoSansSC.ttf"));
        assert_eq!(probe_text(&ttf_parser::Face::parse(&mono.0, 0).unwrap()), "Aa01"); // no Chinese in it
        assert_eq!(probe_text(&ttf_parser::Face::parse(&cjk.0, 0).unwrap()), "封面Aa01");
    }
}
