//! The subject of a photo, cut out: its mask, a PNG of the photo's size in which only the alpha
//! channel matters, opaque where the subject is. Two ways: Apple's Vision ([`vision`], macOS 14 and
//! later, built in) and BiRefNet run by ONNX Runtime ([`onnx`], any system), whose runtime and model
//! are downloaded into the data folder first.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Mutex, MutexGuard, TryLockError};

use serde::Serialize;

use crate::{net, Res};

pub mod download;
pub mod onnx;
pub mod vision;

/// A cut-out model: its id, its size, and whether it can be used (`have`: its file and the runtime are
/// both there; `model`, `runtime`: each of them). `partial`: the bytes already in parts of what is still
/// missing, which a download resumes from. `files`: what a download fetches, with where from, for
/// fetching by hand and importing.
#[derive(Serialize)]
pub struct CutModel {
    pub id: &'static str,
    pub bytes: u64,
    pub have: bool,
    pub model: bool,
    pub runtime: bool,
    pub partial: u64,
    pub files: Vec<CutFile>,
}

/// One file a model needs: `what` it is (`model`, `runtime`: the ONNX Runtime package for this
/// system), its first source and the others (`mirrors`), its size, and how much of it is there
/// (all of it once in place, else what its part holds).
#[derive(Serialize)]
pub struct CutFile {
    pub what: &'static str,
    pub url: &'static str,
    pub mirrors: Vec<&'static str>,
    pub bytes: u64,
    pub have: u64,
}

/// How a download is getting on (the app sends it to the page as the event `cut-model-progress`):
/// `done` of `total` bytes, over all the files still missing. `phase`: `connecting` (each attempt
/// starts so), `checking` (the bytes already in a part, hashed again), `downloading`, `verifying`,
/// `unpacking` (the runtime), `importing`. `file`: `runtime` or `model`. `source`: the host asked;
/// `via`: how its proxy was found (`settings`, `environment`, `direct`), `proxy` which
/// (host:port, no credentials). `resumedFrom`: the bytes of the file there when this attempt began.
/// `retry`: on an attempt after one that failed, from where, why, and to where.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CutProgress {
    pub id: String,
    pub done: u64,
    pub total: u64,
    pub phase: &'static str,
    pub file: &'static str,
    pub source: Option<&'static str>,
    pub via: Option<net::Via>,
    pub proxy: Option<String>,
    pub resumed_from: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retry: Option<download::Retry>,
}

/// One download or import at a time, in this process: they share the parts.
static BUSY: Mutex<()> = Mutex::new(());
fn busy() -> Res<MutexGuard<'static, ()>> {
    match BUSY.try_lock() {
        Ok(g) => Ok(g),
        Err(TryLockError::Poisoned(p)) => Ok(p.into_inner()),
        Err(TryLockError::WouldBlock) => Err("busy: a cut-out model is being downloaded or imported".into()),
    }
}

/// The mask of the photo's subject from Apple's Vision; elsewhere, why there is none ("unsupported: …").
pub fn vision_mask(photo: &[u8]) -> Res<Vec<u8>> {
    vision::mask_png(photo)
}

/// The cut-out models, and what of each is in the data folder `data`.
pub fn models(data: &Path) -> Vec<CutModel> {
    let size = |p: &Path| std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let runtime = onnx::have_runtime(data);
    let rt = onnx::RUNTIME.as_ref();
    onnx::MODELS
        .iter()
        .map(|m| {
            let model = onnx::have_model(data, m);
            let mut files = Vec::new();
            if let Some(r) = rt {
                let have = if runtime { r.package.bytes } else { size(&onnx::runtime_part(data, r)).min(r.package.bytes) };
                files.push(CutFile { what: "runtime", url: r.package.sources[0].url, mirrors: r.package.sources[1..].iter().map(|s| s.url).collect(), bytes: r.package.bytes, have });
            }
            let have = if model { m.file.bytes } else { size(&onnx::model_part(data, m)).min(m.file.bytes) };
            files.push(CutFile { what: "model", url: m.file.sources[0].url, mirrors: m.file.sources[1..].iter().map(|s| s.url).collect(), bytes: m.file.bytes, have });
            let partial = files.iter().filter(|f| f.have < f.bytes).map(|f| f.have).sum();
            CutModel { id: m.id, bytes: m.file.bytes, have: model && runtime, model, runtime, partial, files }
        })
        .collect()
}

/// Downloads a cut-out model into the data folder (the runtime first, if it is missing), telling
/// `progress` how far it has got; returns once it is there, has failed or was cancelled
/// ([`cancel_download`], which keeps what came for the next try). `proxy`: the one given (a setting),
/// else the environment's, else none; `source`: `auto` (Hugging Face, then hf-mirror.com,
/// the one that last worked first), or one of them alone. Errors start with their kind (see
/// [`download`]); a second download while one runs is refused (`busy:`).
pub fn download(data: &Path, id: &str, proxy: Option<&str>, source: Option<&str>, progress: impl Fn(CutProgress)) -> Res<()> {
    let m = onnx::model(id)?;
    let r = onnx::runtime()?;
    let _busy = busy()?;
    download::CANCEL.store(false, Ordering::SeqCst);
    let runtime_bytes = if onnx::have_runtime(data) { 0 } else { r.package.bytes };
    let model_bytes = if onnx::have_model(data, m) { 0 } else { m.file.bytes };
    let total = runtime_bytes + model_bytes;
    let opts = download::Options { proxy: proxy.unwrap_or(""), source: source.unwrap_or("auto"), waits: download::WAITS };
    let mut last = None;
    onnx::download(data, m, &opts, &mut |file, s| {
        let base = if file == "model" { runtime_bytes } else { 0 };
        let p = CutProgress { id: id.to_string(), done: base + s.done, total, phase: s.phase, file, source: s.source, via: s.via, proxy: s.proxy, resumed_from: s.resumed_from, retry: s.retry };
        last = Some(p.clone());
        progress(p);
    })?;
    if let Some(p) = last.filter(|p| p.done < total) {
        progress(CutProgress { done: total, phase: "verifying", ..p });
    }
    Ok(())
}

/// A file brought in by hand, and what it was (`model` with its `id`, or `runtime`).
#[derive(Serialize, Debug)]
pub struct Imported {
    pub name: String,
    pub what: &'static str,
    pub id: Option<&'static str>,
}
/// A file that could not be brought in, and why (`file:`, `checksum:`, `disk:`, `cancelled`).
#[derive(Serialize, Debug)]
pub struct Refused {
    pub name: String,
    pub error: String,
}
/// What importing files did: what each was, what was refused, and what is still missing for a model
/// whose file came (`runtime`: the ONNX Runtime package was not among them and is not there).
#[derive(Serialize, Debug, Default)]
pub struct Imports {
    pub installed: Vec<Imported>,
    pub refused: Vec<Refused>,
    pub missing: Vec<&'static str>,
}

/// Brings files in by hand (downloaded in a browser, copied from another computer): each a model
/// file or this system's ONNX Runtime package, told by its size, checked against its SHA-256 as it is
/// copied, then put in place. `progress` hears of each as a download's (`phase: importing`, `id` the
/// model's or `runtime`). One at a time with downloads (`busy:`); [`cancel_download`] stops it.
pub fn import(data: &Path, files: &[std::path::PathBuf], progress: impl Fn(CutProgress)) -> Res<Imports> {
    let _busy = busy()?;
    download::CANCEL.store(false, Ordering::SeqCst);
    let mut out = Imports::default();
    for path in files {
        let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string());
        let mut report = |what: &'static str, m: Option<&'static onnx::Model>, done, total| {
            let id = m.map_or("runtime", |m| m.id).to_string();
            progress(CutProgress { id, done, total, phase: "importing", file: what, source: None, via: None, proxy: None, resumed_from: 0, retry: None });
        };
        match onnx::import(data, path, &mut report) {
            Ok((what, m)) => out.installed.push(Imported { name, what, id: m.map(|m| m.id) }),
            Err(e) if e == "cancelled" => return Err(e),
            Err(error) => out.refused.push(Refused { name, error }),
        }
    }
    if out.installed.iter().any(|i| i.what == "model") && !onnx::have_runtime(data) {
        out.missing.push("runtime");
    }
    Ok(out)
}

/// Stops the download that is running; what came is kept, and the next download resumes from it.
pub fn cancel_download() {
    download::CANCEL.store(true, Ordering::SeqCst);
}

/// Removes a cut-out model from the data folder, with what of it was downloaded (and the runtime once
/// no model is left); with `parts`, only what a download of it fetched and did not finish (its part, and
/// the runtime's while the runtime is missing), a file in place, one imported by hand too, kept.
pub fn delete(data: &Path, id: &str, parts: bool) -> Res<()> {
    let m = onnx::model(id)?;
    let _busy = busy()?;
    if parts { onnx::discard(data, m) } else { onnx::remove(data, m) }
}

/// The mask of the photo's subject made with the model `id`, which must have been downloaded.
pub fn onnx_mask(data: &Path, id: &str, photo: &[u8]) -> Res<Vec<u8>> {
    let m = onnx::model(id)?;
    if !onnx::have(data, m) {
        return Err("model not downloaded".into());
    }
    onnx::mask_png(data, m, photo)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_say_what_is_there_and_what_a_part_holds() {
        let dir = tempfile::tempdir().unwrap();
        let data = dir.path();
        let r = onnx::RUNTIME.as_ref().unwrap();
        let ms = models(data);
        assert_eq!(ms.iter().map(|m| m.id).collect::<Vec<_>>(), ["birefnet-lite", "birefnet"]);
        let lite = &ms[0];
        assert!(!lite.have && !lite.model && !lite.runtime && lite.partial == 0);
        assert_eq!(lite.files.iter().map(|f| f.what).collect::<Vec<_>>(), ["runtime", "model"]);
        assert_eq!(lite.files[1].mirrors.len(), 1);
        assert!(lite.files[1].mirrors[0].starts_with("https://hf-mirror.com/"));
        assert_eq!(lite.files[0].bytes, r.package.bytes);
        // a part of the model and of the runtime
        std::fs::create_dir_all(data.join("models/runtime")).unwrap();
        std::fs::write(onnx::model_part(data, onnx::model("birefnet-lite").unwrap()), vec![0u8; 1000]).unwrap();
        std::fs::write(onnx::runtime_part(data, r), vec![0u8; 300]).unwrap();
        let lite = &models(data)[0];
        assert_eq!((lite.files[0].have, lite.files[1].have, lite.partial), (300, 1000, 1300));
        assert_eq!(models(data)[1].partial, 300, "the runtime's part counts for every model");
    }

    #[test]
    fn imports_are_told_by_size_and_checked_by_hash() {
        let _g = download::tests::SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let (data, files) = (dir.path().join("data"), dir.path().join("in"));
        std::fs::create_dir_all(&files).unwrap();
        // a file of no known size; one of the light model's size but not its bytes (sparse: no 224 MB written)
        std::fs::write(files.join("notes.txt"), b"hello").unwrap();
        let fake = files.join("model.onnx");
        std::fs::File::create(&fake).unwrap().set_len(onnx::MODELS[0].file.bytes).unwrap();
        let seen = std::cell::RefCell::new(Vec::new());
        let r = import(&data, &[files.join("notes.txt"), fake.clone(), files.join("gone.onnx")], |p| seen.borrow_mut().push((p.id, p.phase, p.done, p.total))).unwrap();
        assert!(r.installed.is_empty() && r.missing.is_empty());
        let errors: Vec<_> = r.refused.iter().map(|f| (f.name.as_str(), f.error.split(':').next().unwrap())).collect();
        assert_eq!(errors, [("notes.txt", "file"), ("model.onnx", "checksum"), ("gone.onnx", "file")]);
        assert!(r.refused[0].error.contains("is 5 bytes") && r.refused[0].error.contains("224005088"), "{}", r.refused[0].error);
        assert!(!onnx::model_part(&data, &onnx::MODELS[0]).exists(), "a refused file leaves no part");
        // a download's part is kept when an import of that file fails
        std::fs::create_dir_all(data.join("models")).unwrap();
        std::fs::write(onnx::model_part(&data, &onnx::MODELS[0]), b"half a download").unwrap();
        let r = import(&data, &[fake.clone()], |_| {}).unwrap();
        assert_eq!(r.refused.len(), 1);
        assert_eq!(std::fs::read(onnx::model_part(&data, &onnx::MODELS[0])).unwrap(), b"half a download");
        assert!(!onnx::model_part(&data, &onnx::MODELS[0]).with_extension("import").exists());
        let seen = seen.into_inner();
        assert!(seen.iter().all(|(id, phase, _, total)| id == "birefnet-lite" && *phase == "importing" && *total == onnx::MODELS[0].file.bytes));
        assert_eq!(seen.last().unwrap().2, onnx::MODELS[0].file.bytes);
    }

    /// Imports the light model and this system's runtime package from SMEDCOVER_TEST_IMPORT (a folder
    /// with model.onnx and the package as GitHub names it) into a new data folder.
    #[test]
    #[ignore]
    fn imports_real_files() {
        let _g = download::tests::SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let from = std::path::PathBuf::from(std::env::var("SMEDCOVER_TEST_IMPORT").expect("SMEDCOVER_TEST_IMPORT"));
        let dir = tempfile::tempdir().unwrap();
        let r = onnx::RUNTIME.as_ref().unwrap();
        let package = from.join(r.package.sources[0].url.rsplit('/').next().unwrap());
        let got = import(dir.path(), &[from.join("model.onnx")], |_| {}).unwrap();
        assert_eq!(got.missing, ["runtime"]);
        let got = import(dir.path(), &[package], |_| {}).unwrap();
        assert!(got.refused.is_empty() && got.missing.is_empty(), "{got:?}");
        assert!(models(dir.path())[0].have);
    }

    #[test]
    fn one_download_at_a_time() {
        let _g = download::tests::SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        let held = busy().unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(download(dir.path(), "birefnet-lite", None, None, |_| {}).unwrap_err().starts_with("busy: "));
        assert!(delete(dir.path(), "birefnet-lite", false).unwrap_err().starts_with("busy: "));
        drop(held);
        assert!(download(dir.path(), "nope", None, None, |_| {}).unwrap_err().starts_with("unknown model"));
    }
}
