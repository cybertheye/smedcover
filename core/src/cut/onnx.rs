//! The subject of a photo cut out on any platform: BiRefNet (MIT licence, ZhengPeng7/BiRefNet), in
//! the ONNX form published by onnx-community on Hugging Face, run by ONNX Runtime (MIT) through `ort`.
//!
//! Neither comes with the app. When the user asks for a model, the runtime library for this platform
//! (Microsoft's own release, 1.23.2) and the model file are downloaded into the app data folder
//! `models/`, each checked against its SHA-256, and loaded from there.
//!
//! In and out as with Vision (see `vision.rs`): the photo as encoded bytes, already upright; the
//! mask as a PNG of the photo's size in which only the alpha channel matters.

use image::{imageops::FilterType, ImageBuffer, ImageFormat, Luma, LumaA};
use ort::{session::Session, value::Tensor};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// A file to download: where from, how big, and its SHA-256 (hex).
pub struct Download {
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}
pub struct Model {
    pub id: &'static str,
    pub file: Download,
}
pub const MODELS: [Model; 2] = [
    Model { id: "birefnet-lite", file: Download { url: "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx", bytes: 224_005_088, sha256: "5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333" } },
    Model { id: "birefnet", file: Download { url: "https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/model.onnx", bytes: 972_666_916, sha256: "58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c" } },
];

/// The runtime package for this platform, and the name of the library in it.
pub struct Runtime {
    pub package: Download,
    pub library: &'static str,
}
macro_rules! runtime {
    ($name:literal, $bytes:literal, $sha:literal, $lib:literal) => {
        Some(Runtime {
            package: Download { url: concat!("https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/", $name), bytes: $bytes, sha256: $sha },
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
fn runtime() -> Result<&'static Runtime, String> {
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
    let whole = std::fs::metadata(file(data, m)).map(|f| f.len() == m.file.bytes).unwrap_or(false);
    whole && runtime().map(|r| library(data, r).is_file()).unwrap_or(false)
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

// ---------------------------------------------------------------- downloads

/// Set to stop a download that is running.
pub static CANCEL: AtomicBool = AtomicBool::new(false);

/// Downloads what model `m` needs that is not there yet — the runtime, then the model — reporting
/// (bytes so far, bytes in all) as it goes. Every file is checked against its size and SHA-256
/// before it takes its place, so a broken or altered download leaves nothing behind.
pub fn download(agent: &ureq::Agent, data: &Path, m: &Model, progress: impl Fn(u64, u64)) -> Result<(), String> {
    CANCEL.store(false, Ordering::SeqCst);
    let r = runtime()?;
    let lib = library(data, r);
    let need_runtime = !lib.is_file();
    let need_model = std::fs::metadata(file(data, m)).map(|f| f.len() != m.file.bytes).unwrap_or(true);
    let total = if need_runtime { r.package.bytes } else { 0 } + if need_model { m.file.bytes } else { 0 };
    let mut base = 0;
    if need_runtime {
        let dir = data.join("models").join("runtime");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let package = dir.join("package.part");
        fetch(agent, &r.package, &package, |done| progress(base + done, total))?;
        let unpacked = unpack(&package, r.library, &lib);
        let _ = std::fs::remove_file(&package);
        unpacked?;
        base += r.package.bytes;
    }
    if need_model {
        let target = file(data, m);
        let part = target.with_extension("onnx.part");
        fetch(agent, &m.file, &part, |done| progress(base + done, total))?;
        std::fs::rename(&part, &target).map_err(|e| e.to_string())?;
    }
    progress(total, total);
    Ok(())
}
/// Streams `d` into `to`, checking its size and SHA-256; removes `to` if anything is wrong.
fn fetch(agent: &ureq::Agent, d: &Download, to: &Path, progress: impl Fn(u64)) -> Result<(), String> {
    let result = (|| {
        let reply = agent.get(d.url).call().map_err(|e| format!("download: {e}"))?;
        let mut reader = reply.into_reader();
        let mut out = std::fs::File::create(to).map_err(|e| e.to_string())?;
        let (mut hash, mut done, mut last, mut buf) = (Sha256::new(), 0u64, 0u64, vec![0u8; 1 << 20]);
        loop {
            if CANCEL.load(Ordering::SeqCst) {
                return Err("cancelled".to_string());
            }
            let k = reader.read(&mut buf).map_err(|e| format!("download: {e}"))?;
            if k == 0 {
                break;
            }
            out.write_all(&buf[..k]).map_err(|e| e.to_string())?;
            hash.update(&buf[..k]);
            done += k as u64;
            if done - last >= 2 << 20 {
                progress(done);
                last = done;
            }
        }
        out.flush().map_err(|e| e.to_string())?;
        if done != d.bytes {
            return Err(format!("the download is {done} bytes, {} were expected", d.bytes));
        }
        let got = format!("{:x}", hash.finalize());
        if got != d.sha256 {
            return Err(format!("the download's checksum is wrong ({got})"));
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(to);
    }
    result
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
/// Removes a model's file; the runtime goes too once no model is left.
pub fn remove(data: &Path, m: &Model) -> Result<(), String> {
    unload();
    match std::fs::remove_file(file(data, m)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
        _ => {}
    }
    if !MODELS.iter().any(|x| file(data, x).exists()) && LOADED.get().is_none() {
        let _ = std::fs::remove_dir_all(data.join("models").join("runtime"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn models_are_known_by_id() {
        assert_eq!(model("birefnet-lite").unwrap().file.bytes, 224_005_088);
        assert!(model("nope").is_err());
        assert!(file(Path::new("/d"), model("birefnet").unwrap()).ends_with("models/birefnet.onnx"));
        assert!(RUNTIME.is_some(), "a runtime package for the platform this is built on");
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

    /// Downloads the runtime and the light model for real (about 235 MB) into SMEDCOVER_TEST_DATA:
    /// SMEDCOVER_TEST_DATA=<folder> cargo test -p smedcover-core cut::onnx::tests::downloads -- --ignored
    #[test]
    #[ignore]
    fn downloads_the_runtime_and_the_light_model() {
        let data = PathBuf::from(std::env::var("SMEDCOVER_TEST_DATA").expect("SMEDCOVER_TEST_DATA"));
        let m = model("birefnet-lite").unwrap();
        let mut builder = ureq::AgentBuilder::new().timeout_read(std::time::Duration::from_secs(120));
        if let Some(p) = crate::net::proxy_for(m.file.url, "") {   // the environment's proxy, as the app uses it
            builder = builder.proxy(ureq::Proxy::new(&p).unwrap());
        }
        let agent = builder.build();
        let (seen, all) = (std::cell::Cell::new(0u64), std::cell::Cell::new(0u64));
        download(&agent, &data, m, |done, total| { assert!(done >= seen.get() && done <= total); seen.set(done); all.set(total); }).unwrap();
        assert!(have(&data, m));
        assert_eq!(seen.get(), all.get());   // all of what was missing (nothing, when both are there already)
        assert!(!data.join("models/runtime/package.part").exists());
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
