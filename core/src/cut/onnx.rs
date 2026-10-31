//! The subject of a photo cut out on any platform: BiRefNet (MIT licence, ZhengPeng7/BiRefNet), in
//! the ONNX form published by onnx-community on Hugging Face, run by ONNX Runtime (MIT) through `ort`.
//!
//! Neither comes with the app. When the user asks for a model, the runtime library for this platform
//! (Microsoft's own release, 1.23.2, from GitHub) and the model file (from Hugging Face, or its mirror
//! hf-mirror.com, at a fixed commit of the model's repository) are downloaded into the app data folder
//! `models/`, each checked against its SHA-256, and loaded from there.
//!
//! In and out as with Vision (see `vision.rs`): the photo as encoded bytes, already upright; the
//! mask as a PNG of the photo's size in which only the alpha channel matters.

use image::{imageops::FilterType, ImageBuffer, ImageFormat, Luma, LumaA};
use ort::{session::Session, value::Tensor};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// A place a file can be downloaded from: `id` is what a user's choice of source names (`huggingface`,
/// `hf-mirror`, `github`), `host` what the user is told.
pub struct Source {
    pub id: &'static str,
    pub host: &'static str,
    pub url: &'static str,
}
/// A file to download: where from (in the order tried), how big, and its SHA-256 (hex). Whichever
/// source it comes from, it is the same file, checked against the same size and hash.
pub struct Download {
    pub sources: &'static [Source],
    pub bytes: u64,
    pub sha256: &'static str,
}
pub struct Model {
    pub id: &'static str,
    pub file: Download,
}
/// A file of a Hugging Face repository at a fixed commit (never `main`, which can move under the hash):
/// from Hugging Face, then from hf-mirror.com, which serves the same paths (and sends a visitor from outside
/// China on to Hugging Face).
macro_rules! hugging_face {
    ($repo:literal, $commit:literal, $path:literal) => {
        &[
            Source { id: "huggingface", host: "huggingface.co", url: concat!("https://huggingface.co/", $repo, "/resolve/", $commit, "/", $path) },
            Source { id: "hf-mirror", host: "hf-mirror.com", url: concat!("https://hf-mirror.com/", $repo, "/resolve/", $commit, "/", $path) },
        ]
    };
}
pub const MODELS: [Model; 2] = [
    Model { id: "birefnet-lite", file: Download { sources: hugging_face!("onnx-community/BiRefNet_lite-ONNX", "de15b22ba131738a16dff04aab8bdf8dc32e3ac1", "onnx/model.onnx"), bytes: 224_005_088, sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333" } },
    Model { id: "birefnet", file: Download { sources: hugging_face!("onnx-community/BiRefNet-ONNX", "534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67", "onnx/model.onnx"), bytes: 972_666_916, sha256: "58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c" } },
];

/// The runtime package for this platform, and the name of the library in it.
pub struct Runtime {
    pub package: Download,
    pub library: &'static str,
}
macro_rules! runtime {
    ($name:literal, $bytes:literal, $sha:literal, $lib:literal) => {
        Some(Runtime {
            package: Download {
                sources: &[Source { id: "github", host: "github.com", url: concat!("https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/", $name) }],
                bytes: $bytes,
                sha256: $sha,
            },
            library: $lib,
        })
    };
}
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-osx-x86_64-1.23.2.tgz", 11_676_322, "d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6", "libonnxruntime.1.23.2.dylib");
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-osx-arm64-1.23.2.tgz", 9_999_931, "b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856", "libonnxruntime.1.23.2.dylib");
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-win-x64-1.23.2.zip", 78_127_794, "0b38df9af21834e41e73d602d90db5cb06dbd1ca618948b8f1d66d607ac9f3cd", "onnxruntime.dll");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-win-arm64-1.23.2.zip", 78_932_411, "1cfe88b6435df3b5fb0e9f6bd7d6f5df1e887b6174de7f6e2a47bab956f3f168", "onnxruntime.dll");
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-linux-x64-1.23.2.tgz", 8_309_231, "1fa4dcaef22f6f7d5cd81b28c2800414350c10116f5fdd46a2160082551c5f9b", "libonnxruntime.so.1.23.2");
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
pub const RUNTIME: Option<Runtime> = runtime!("onnxruntime-linux-aarch64-1.23.2.tgz", 7_254_068, "7c63c73560ed76b1fac6cff8204ffe34fe180e70d6582b5332ec094810241e5c", "libonnxruntime.so.1.23.2");
#[cfg(not(any(
    all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
    all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64")),
    all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64"))
)))]
pub const RUNTIME: Option<Runtime> = None;

/// The models' input: 1024 × 1024, RGB scaled to 0–1 and normalised as ImageNet's (preprocessor_config.json).
const SIDE: u32 = 1024;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

pub fn model(id: &str) -> Result<&'static Model, String> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("unknown model: {id}"))
}
pub fn runtime() -> Result<&'static Runtime, String> {
    RUNTIME.as_ref().ok_or_else(|| "no ONNX Runtime for this platform".to_string())
}
/// Where a model's file is kept, under the app data folder.
pub fn file(data: &Path, m: &Model) -> PathBuf {
    data.join("models").join(format!("{}.onnx", m.id))
}
/// Where the runtime library is kept.
fn library(data: &Path, r: &Runtime) -> PathBuf {
    data.join("models").join("runtime").join(r.library)
}
/// Whether a model can be used: its file is there, whole, and so is the runtime.
pub fn have(data: &Path, m: &Model) -> bool {
    have_model(data, m) && have_runtime(data)
}

/// The runtime, loaded once per run of the app (it cannot be swapped once loaded).
static LOADED: OnceLock<Result<(), String>> = OnceLock::new();
fn load_runtime(data: &Path) -> Result<(), String> {
    LOADED
        .get_or_init(|| {
            let lib = library(data, runtime()?);
            ort::init_from(&lib).map_err(|e| format!("could not load ONNX Runtime: {e}"))?.commit();
            Ok(())
        })
        .clone()
}
/// The last model loaded: loading one takes seconds, so it is kept for the next photo.
static SESSION: Mutex<Option<(String, Session)>> = Mutex::new(None);
/// Forgets the loaded model (before its file is removed).
pub fn unload() {
    if let Ok(mut s) = SESSION.lock() {
        *s = None;
    }
}

/// The mask of the photo's subject as a PNG (grey + alpha), made with model `m`.
pub fn mask_png(data: &Path, m: &Model, photo: &[u8]) -> Result<Vec<u8>, String> {
    load_runtime(data)?;
    let rgb = image::load_from_memory(photo).map_err(|e| format!("not a picture: {e}"))?.to_rgb8();
    let (w, h) = rgb.dimensions();
    let small = image::imageops::resize(&rgb, SIDE, SIDE, FilterType::Triangle);
    let n = (SIDE * SIDE) as usize;
    let mut input = vec![0f32; 3 * n];
    for (x, y, p) in small.enumerate_pixels() {
        let i = (y * SIDE + x) as usize;
        for c in 0..3 {
            input[c * n + i] = (p[c] as f32 / 255.0 - MEAN[c]) / STD[c];
        }
    }
    let input = Tensor::from_array(([1usize, 3, SIDE as usize, SIDE as usize], input)).map_err(|e| e.to_string())?;

    let mut slot = SESSION.lock().map_err(|e| e.to_string())?;
    if slot.as_ref().map_or(true, |(id, _)| id != m.id) {
        *slot = None;   // one model in memory at a time
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
        let session = Session::builder()
            .map_err(|e| e.to_string())?
            .with_intra_threads(threads)
            .map_err(|e| e.to_string())?
            .commit_from_file(file(data, m))
            .map_err(|e| format!("could not load the model: {e}"))?;
        *slot = Some((m.id.to_string(), session));
    }
    let session = &mut slot.as_mut().ok_or("no model")?.1;
    let outputs = session.run(ort::inputs![input]).map_err(|e| e.to_string())?;
    let (_, logits) = outputs[0].try_extract_tensor::<f32>().map_err(|e| e.to_string())?;
    if logits.len() < n {
        return Err(format!("unexpected output of {} values", logits.len()));
    }
    // the last map is the finest; its values are logits
    let last = &logits[logits.len() - n..];
    let small: ImageBuffer<Luma<u8>, Vec<u8>> = ImageBuffer::from_fn(SIDE, SIDE, |x, y| {
        let v = last[(y * SIDE + x) as usize];
        Luma([(255.0 / (1.0 + (-v).exp())).round() as u8])
    });
    let mask = image::imageops::resize(&small, w, h, FilterType::Triangle);
    if !mask.pixels().any(|p| p[0] > 128) {
        return Err("no subject found".into());
    }
    let img: ImageBuffer<LumaA<u8>, Vec<u8>> = ImageBuffer::from_fn(w, h, |x, y| LumaA([255, mask.get_pixel(x, y)[0]]));
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(out)
}

// ---------------------------------------------------------------- the files on disk

/// Where the part of a model's file is kept while it comes: named by the hash it must have, so a part
/// of another version of it is never resumed.
pub fn model_part(data: &Path, m: &Model) -> PathBuf {
    data.join("models").join(format!("{}.{}", m.id, super::download::part_name(&m.file)))
}
/// Where the part of the runtime package is kept while it comes.
pub fn runtime_part(data: &Path, r: &Runtime) -> PathBuf {
    data.join("models").join("runtime").join(super::download::part_name(&r.package))
}
/// Whether the runtime library is there.
pub fn have_runtime(data: &Path) -> bool {
    runtime().map(|r| library(data, r).is_file()).unwrap_or(false)
}
/// Whether a model's file is there, whole.
pub fn have_model(data: &Path, m: &Model) -> bool {
    std::fs::metadata(file(data, m)).map(|f| f.len() == m.file.bytes).unwrap_or(false)
}
/// Removes the parts no download of this version would resume (an older app's, a file of another
/// version, a library half taken out of its package).
pub fn clean_parts(data: &Path) {
    let mut keep: Vec<PathBuf> = MODELS.iter().map(|m| model_part(data, m)).collect();
    if let Some(r) = RUNTIME.as_ref() {
        keep.push(runtime_part(data, r));
    }
    for dir in [data.join("models"), data.join("models").join("runtime")] {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            let stray = path.extension().is_some_and(|x| x == "part" && !keep.contains(&path) || x == "import");   // an import a crash left
            if stray && path.is_file() {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
}
/// Downloads what model `m` needs that is not there yet — the runtime, then the model — telling
/// `report` how each goes (`runtime` or `model`, and its step). Every file is checked against its size
/// and SHA-256 before it takes its place, so a broken or altered download leaves nothing in use.
pub fn download(data: &Path, m: &Model, opts: &super::download::Options, report: &mut dyn FnMut(&'static str, super::download::Step)) -> Result<(), String> {
    use super::download::{fetch, put_in_place};
    let r = runtime()?;
    clean_parts(data);
    let disk = |e: std::io::Error| format!("disk: {e}");
    if !have_runtime(data) {
        std::fs::create_dir_all(data.join("models").join("runtime")).map_err(disk)?;
        let part = runtime_part(data, r);
        fetch(&r.package, "runtime", &part, opts, &mut |s| report("runtime", s))?;
        report("runtime", super::download::Step { phase: "unpacking", done: r.package.bytes, ..Default::default() });
        unpack(&part, r.library, &library(data, r)).map_err(|e| format!("disk: {e}"))?;
        let _ = std::fs::remove_file(&part);
    }
    if !have_model(data, m) {
        let part = model_part(data, m);
        fetch(&m.file, "model", &part, opts, &mut |s| report("model", s))?;
        put_in_place(&part, &file(data, m)).map_err(disk)?;
    }
    Ok(())
}
/// What a file brought in by hand is, told by its size: one of the models, or this system's runtime
/// package. Its hash is checked as it is copied.
pub fn identify(bytes: u64) -> Option<(&'static str, Option<&'static Model>, &'static Download)> {
    if let Some(m) = MODELS.iter().find(|m| m.file.bytes == bytes) {
        return Some(("model", Some(m), &m.file));
    }
    RUNTIME.as_ref().filter(|r| r.package.bytes == bytes).map(|r| ("runtime", None, &r.package))
}

/// Puts a file brought in by hand (one downloaded in a browser, copied from another computer) in its
/// place: identified by its size ([`identify`]), copied into its part while hashed (reporting how much),
/// checked against its SHA-256, then renamed into place (a model) or unpacked (the runtime package).
pub fn import(data: &Path, from: &Path, report: &mut dyn FnMut(&'static str, Option<&'static Model>, u64, u64)) -> Result<(&'static str, Option<&'static Model>), String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let name = from.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| from.display().to_string());
    let mut src = std::fs::File::open(from).map_err(|e| format!("file: {name}: {e}"))?;
    let bytes = src.metadata().map_err(|e| format!("file: {name}: {e}"))?.len();
    let Some((what, m, d)) = identify(bytes) else {
        let runtime = RUNTIME.as_ref().map(|r| format!(", or ONNX Runtime 1.23.2 for this system ({}, {} bytes)", r.package.sources[0].url.rsplit('/').next().unwrap_or(""), r.package.bytes)).unwrap_or_default();
        return Err(format!("file: {name} is not a cut-out file: it is {bytes} bytes; expected the light model ({} bytes), the full model ({} bytes){runtime}", MODELS[0].file.bytes, MODELS[1].file.bytes));
    };
    // copied beside the download's part, never into it: a file that turns out wrong (or a disk taken out half way)
    // must not cost a download that can be resumed
    let download_part = match m {
        Some(m) => model_part(data, m),
        None => runtime_part(data, runtime()?),
    };
    let part = download_part.with_extension("import");
    std::fs::create_dir_all(part.parent().unwrap_or(data)).map_err(|e| format!("disk: {e}"))?;
    let copied = (|| -> Result<(), String> {
        let mut out = std::fs::File::create(&part).map_err(|e| format!("disk: {e}"))?;
        let (mut hash, mut done, mut buf, mut last) = (Sha256::new(), 0u64, vec![0u8; 1 << 20], std::time::Instant::now());
        report(what, m, 0, bytes);
        loop {
            if super::download::CANCEL.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            let k = src.read(&mut buf).map_err(|e| format!("file: {name}: {e}"))?;
            if k == 0 {
                break;
            }
            out.write_all(&buf[..k]).map_err(|e| format!("disk: {e}"))?;
            hash.update(&buf[..k]);
            done += k as u64;
            if last.elapsed() >= std::time::Duration::from_millis(200) {
                report(what, m, done, bytes);
                last = std::time::Instant::now();
            }
        }
        out.sync_all().map_err(|e| format!("disk: {e}"))?;
        report(what, m, done, bytes);
        if done != d.bytes || format!("{:x}", hash.finalize()) != d.sha256 {
            return Err(format!("checksum: {name} is the size of the {} but not the file expected (its SHA-256 differs)", if what == "model" { "model" } else { "runtime package" }));
        }
        Ok(())
    })();
    if let Err(e) = copied {
        let _ = std::fs::remove_file(&part);
        return Err(e);
    }
    match m {
        Some(m) => super::download::put_in_place(&part, &file(data, m)).map_err(|e| format!("disk: {e}"))?,
        None => {
            let r = runtime()?;
            let unpacked = unpack(&part, r.library, &library(data, r));
            let _ = std::fs::remove_file(&part);
            unpacked.map_err(|e| format!("disk: {e}"))?;
        }
    }
    let _ = std::fs::remove_file(&download_part);   // what a download had of it is not wanted now
    Ok((what, m))
}

/// Takes the file named `name` (wherever it sits) out of a .tgz or .zip package into `to`.
fn unpack(package: &Path, name: &str, to: &Path) -> Result<(), String> {
    let found = if is_zip(package)? {
        let mut z = zip::ZipArchive::new(std::fs::File::open(package).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        let mut hit = false;
        for i in 0..z.len() {
            let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
            if entry.is_file() && entry.name().rsplit('/').next() == Some(name) {
                copy_to(&mut entry, to)?;
                hit = true;
                break;
            }
        }
        hit
    } else {
        let gz = flate2::read::GzDecoder::new(std::fs::File::open(package).map_err(|e| e.to_string())?);
        let mut archive = tar::Archive::new(gz);
        let mut hit = false;
        for entry in archive.entries().map_err(|e| e.to_string())? {
            let mut entry = entry.map_err(|e| e.to_string())?;
            let is_it = entry.header().entry_type().is_file() && entry.path().ok().and_then(|p| p.file_name().map(|f| f == name)).unwrap_or(false);
            if is_it {
                copy_to(&mut entry, to)?;
                hit = true;
                break;
            }
        }
        hit
    };
    if found { Ok(()) } else { Err(format!("{name} is not in the runtime package")) }
}
fn is_zip(path: &Path) -> Result<bool, String> {
    let mut head = [0u8; 2];
    std::fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).map_err(|e| e.to_string())?;
    Ok(&head == b"PK")
}
fn copy_to(from: &mut impl Read, to: &Path) -> Result<(), String> {
    let part = to.with_extension("part");
    let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
    std::io::copy(from, &mut out).map_err(|e| e.to_string())?;
    drop(out);
    std::fs::rename(&part, to).map_err(|e| e.to_string())
}
/// Removes what a download of model `m` has fetched so far and not finished: its part, and the runtime's
/// when the runtime is not there yet. Files in place stay.
pub fn discard(data: &Path, m: &Model) -> Result<(), String> {
    let mut parts = vec![model_part(data, m)];
    if !have_runtime(data) {
        parts.push(runtime_part(data, runtime()?));
    }
    for f in parts {
        match std::fs::remove_file(f) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

/// Removes a model's file and its part; the runtime goes too (and its part) once no model is left.
pub fn remove(data: &Path, m: &Model) -> Result<(), String> {
    unload();
    for f in [file(data, m), model_part(data, m)] {
        match std::fs::remove_file(f) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    if !MODELS.iter().any(|x| file(data, x).exists() || model_part(data, x).exists()) && LOADED.get().is_none() {
        let _ = std::fs::remove_dir_all(data.join("models").join("runtime"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn models_are_known_by_id() {
        assert_eq!(model("birefnet-lite").unwrap().file.bytes, 224_005_088);
        assert!(model("nope").is_err());
        assert!(file(Path::new("/d"), model("birefnet").unwrap()).ends_with("models/birefnet.onnx"));
        assert!(RUNTIME.is_some(), "a runtime package for the platform this is built on");
    }

    #[test]
    fn models_come_from_a_fixed_commit_on_hugging_face_or_its_mirror() {
        let commit = |url: &str| url.split("/resolve/").nth(1).and_then(|r| r.split('/').next()).map(str::to_string);
        for m in &MODELS {
            let ids: Vec<_> = m.file.sources.iter().map(|s| s.id).collect();
            assert_eq!(ids, ["huggingface", "hf-mirror"], "{}", m.id);
            for s in m.file.sources {
                assert!(s.url.starts_with(&format!("https://{}/", s.host)), "{}", s.url);
                let c = commit(s.url).unwrap();
                assert!(c.len() == 40 && c.bytes().all(|b| b.is_ascii_hexdigit()), "{}: a commit, never a branch", s.url);
            }
            // the mirror's path is Hugging Face's
            let path = |s: &Source| s.url.splitn(4, '/').nth(3).unwrap().to_string();
            assert_eq!(path(&m.file.sources[0]), path(&m.file.sources[1]));
        }
        let r = RUNTIME.as_ref().unwrap();
        assert!(r.package.sources.len() == 1 && r.package.sources[0].url.starts_with("https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/"));
    }

    /// Asks each source of each model, without downloading it, whether it has the file this catalog
    /// names: Hugging Face says the size and SHA-256 of what it would send (x-linked-size, x-linked-etag).
    /// A source that cannot be reached from here is only reported; one of each model's must answer.
    /// `cargo test -p smedcover-core cut::onnx::tests::sources_have -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn sources_have_the_files_named() {
        for m in &MODELS {
            let mut answered = 0;
            for s in m.file.sources {
                let builder = ureq::AgentBuilder::new().redirects(0).timeout(std::time::Duration::from_secs(20)).tls_config(crate::net::tls().unwrap());
                let agent = crate::net::with_proxy(builder, &crate::net::proxy_choice(s.url, "")).unwrap().build();
                let reply = match agent.head(s.url).call() {
                    Ok(r) => r,
                    Err(ureq::Error::Status(_, r)) => r,
                    Err(e) => {
                        eprintln!("{}: not reached: {e}", s.url);
                        continue;
                    }
                };
                answered += 1;
                if reply.header("location").is_some_and(|l| l.starts_with("https://huggingface.co/")) {
                    eprintln!("{}: sent on to Hugging Face (from outside China)", s.url);
                    continue;
                }
                assert_eq!(reply.header("x-linked-size"), Some(m.file.bytes.to_string().as_str()), "{}", s.url);
                assert_eq!(reply.header("x-linked-etag").map(|e| e.trim_matches('"')), Some(m.file.sha256), "{}", s.url);
                eprintln!("{}: has it", s.url);
            }
            assert!(answered > 0, "no source of {} answered", m.id);
        }
    }

    #[test]
    fn parts_of_another_version_are_cleaned_and_this_one_s_kept() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let rt = data.join("models/runtime");
        std::fs::create_dir_all(&rt).unwrap();
        let m = model("birefnet").unwrap();
        let keep = [model_part(data, m), runtime_part(data, RUNTIME.as_ref().unwrap())];
        let old = [data.join("models/birefnet.onnx.part"), rt.join("package.part"), rt.join("libonnxruntime.1.23.2.part"), data.join("models/birefnet.0123456789abcdef.part")];
        for f in keep.iter().chain(&old) {
            std::fs::write(f, b"x").unwrap();
        }
        std::fs::write(data.join("models/birefnet-lite.onnx"), b"m").unwrap();
        clean_parts(data);
        assert!(keep.iter().all(|f| f.exists()));
        assert!(old.iter().all(|f| !f.exists()));
        assert!(data.join("models/birefnet-lite.onnx").exists());
        assert!(model_part(data, m).file_name().unwrap().to_str().unwrap().starts_with("birefnet.58f621f00f5d7560"));
        // a crashed import's copy is cleaned too
        std::fs::write(data.join("models/birefnet.58f621f00f5d7560.import"), b"x").unwrap();
        clean_parts(data);
        assert!(!data.join("models/birefnet.58f621f00f5d7560.import").exists());
        // discarding takes the parts and leaves the files in place
        std::fs::write(file(data, m), b"imported by hand").unwrap();
        discard(data, m).unwrap();
        assert!(!keep[0].exists() && !keep[1].exists(), "the model's part and the runtime's (the runtime not there)");
        assert!(file(data, m).exists(), "a model in place stays");
        std::fs::remove_file(file(data, m)).unwrap();
        std::fs::write(&keep[0], b"x").unwrap();
        // removing a model takes its part; the runtime goes with the last
        remove(data, m).unwrap();
        assert!(!model_part(data, m).exists());
        assert!(rt.exists(), "birefnet-lite is still there");
        remove(data, model("birefnet-lite").unwrap()).unwrap();
        assert!(!rt.exists());
    }

    #[test]
    fn unpacks_one_file_from_either_kind_of_package() {
        let dir = tempfile::tempdir().unwrap();
        // a .tgz with the library two folders down, among other files
        let tgz = dir.path().join("p.tgz");
        {
            let gz = flate2::write::GzEncoder::new(std::fs::File::create(&tgz).unwrap(), flate2::Compression::fast());
            let mut t = tar::Builder::new(gz);
            for (name, body) in [("pkg/README", &b"r"[..]), ("pkg/lib/libx.so.1", &b"LIB"[..])] {
                let mut h = tar::Header::new_gnu();
                h.set_size(body.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                t.append_data(&mut h, name, body).unwrap();
            }
            t.into_inner().unwrap().finish().unwrap();
        }
        unpack(&tgz, "libx.so.1", &dir.path().join("out1")).unwrap();
        assert_eq!(std::fs::read(dir.path().join("out1")).unwrap(), b"LIB");
        assert!(unpack(&tgz, "missing.dll", &dir.path().join("out2")).is_err());
        // a .zip
        let zp = dir.path().join("p.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zp).unwrap());
            z.start_file("pkg/lib/x.dll", zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b"DLL").unwrap();
            z.finish().unwrap();
        }
        unpack(&zp, "x.dll", &dir.path().join("out3")).unwrap();
        assert_eq!(std::fs::read(dir.path().join("out3")).unwrap(), b"DLL");
    }

    /// Downloads the runtime and the light model for real (about 235 MB) into SMEDCOVER_TEST_DATA, as
    /// the app does (the proxy found as it finds it; SMEDCOVER_TEST_SOURCE: auto, huggingface, hf-mirror):
    /// SMEDCOVER_TEST_DATA=<folder> cargo test -p smedcover-core cut::onnx::tests::downloads -- --ignored --nocapture
    #[test]
    #[ignore]
    fn downloads_the_runtime_and_the_light_model() {
        let data = PathBuf::from(std::env::var("SMEDCOVER_TEST_DATA").expect("SMEDCOVER_TEST_DATA"));
        let source = std::env::var("SMEDCOVER_TEST_SOURCE").unwrap_or_else(|_| "auto".into());
        let m = model("birefnet-lite").unwrap();
        let opts = crate::cut::download::Options { proxy: "", source: &source, waits: crate::cut::download::WAITS };
        let mut last = ("", "");
        download(&data, m, &opts, &mut |what, s| {
            if (what, s.phase) != last {
                eprintln!("{what}: {} {} MB from {:?} via {:?} {:?} (resumed from {} MB) {:?}", s.phase, s.done >> 20, s.source, s.via, s.proxy, s.resumed_from >> 20, s.retry);
                last = (what, s.phase);
            }
        })
        .unwrap();
        assert!(have(&data, m));
        assert!(!model_part(&data, m).exists() && !runtime_part(&data, RUNTIME.as_ref().unwrap()).exists());
    }

    /// Needs the runtime and a model downloaded into a data folder, and a photo:
    /// SMEDCOVER_TEST_DATA=<folder with models/> SMEDCOVER_TEST_PHOTO=<photo> cargo test -p smedcover-core cut::onnx -- --ignored
    #[test]
    #[ignore]
    fn cuts_out_a_real_photo() {
        let data = PathBuf::from(std::env::var("SMEDCOVER_TEST_DATA").expect("SMEDCOVER_TEST_DATA"));
        let bytes = std::fs::read(std::env::var("SMEDCOVER_TEST_PHOTO").expect("SMEDCOVER_TEST_PHOTO")).unwrap();
        let m = model("birefnet-lite").unwrap();
        assert!(have(&data, m), "download the light model into {} first", data.display());
        let t0 = std::time::Instant::now();
        let png = mask_png(&data, m, &bytes).unwrap();
        let first = t0.elapsed();
        let mask = image::load_from_memory(&png).unwrap().to_luma_alpha8();
        let photo = image::load_from_memory(&bytes).unwrap();
        assert_eq!(mask.dimensions(), (photo.width(), photo.height()));
        let solid = mask.pixels().filter(|p| p[1] > 128).count() as f64 / (mask.width() * mask.height()) as f64;
        let t1 = std::time::Instant::now();
        mask_png(&data, m, &bytes).unwrap();
        eprintln!("subject covers {:.1}% of the photo; first run {:?} (with loading), again {:?}", solid * 100.0, first, t1.elapsed());
        assert!(solid > 0.02 && solid < 0.98);
    }
}
