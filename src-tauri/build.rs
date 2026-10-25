use std::{fs, path::Path};

/// Hashes every file under `dir` but hidden ones (FNV-1a over the paths, in order, and their bytes) into `h`.
fn hash_dir(dir: &Path, h: &mut u64) {
    let Ok(read) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = read.flatten().map(|e| e.path()).filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))).collect();   // not Finder's .DS_Store and the like
    entries.sort();
    for path in entries {
        let bytes: Vec<u8> = if path.is_dir() { Vec::new() } else { fs::read(&path).unwrap_or_default() };
        for b in path.to_string_lossy().bytes().chain(bytes) {
            *h ^= b as u64;
            *h = h.wrapping_mul(0x100000001b3);
        }
        if path.is_dir() {
            hash_dir(&path, h);
        }
    }
}

fn main() {
    // What this build's interface is (`ui_build` in lib.rs): a hash of everything under ui/, made again whenever any of
    // it changes, so what one build drew (the look cards kept from one launch to the next) is told from what another
    // would draw, though both carry the same version number.
    let mut h = 0xcbf29ce484222325u64;
    hash_dir(Path::new("../ui"), &mut h);
    println!("cargo:rustc-env=SMEDCOVER_UI_BUILD={h:016x}");
    println!("cargo:rerun-if-changed=../ui");
    tauri_build::build()
}
