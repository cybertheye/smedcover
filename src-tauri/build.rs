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
    without_sidecar();
    tauri_build::build()
}

/// Hands tauri-build the configuration without `bundle.externalBin`. The command line, `smedcover`, is in the installers
/// beside the app (tauri.conf.json's `bundle.externalBin`): `scripts/sidecar.mjs`, run before `tauri build`, builds it
/// into `binaries/smedcover-<target triple>`, which the bundler takes from there itself. tauri-build would copy that
/// file too, into `target/<profile>/` for `tauri dev`, and that cannot be: plain cargo (`cargo test --workspace`, `cargo
/// build`) has no such file, and tauri-build fails without it; `target/<profile>/smedcover` is where cargo puts the
/// command line it builds, which a copy of another build's would replace (the command line's tests run that file); and
/// tauri-build refuses a sidecar of this package's name (`smedcover`). So it is not told of it: `TAURI_CONFIG`, which it
/// merges into the configuration as a JSON merge patch (`tauri build --config`'s, when given), is given one that takes
/// `externalBin` out, the rest of it as it was. The app finds the command line beside its executable either way
/// (install.rs). A `TAURI_CONFIG` that is not a JSON object is left for tauri-build to refuse.
fn without_sidecar() {
    let mut patch = match std::env::var("TAURI_CONFIG") {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(&text) {
            Ok(v) if v.is_object() => v,
            _ => return,
        },
        Err(_) => serde_json::json!({}),
    };
    if !patch["bundle"].is_object() {
        patch["bundle"] = serde_json::json!({});
    }
    patch["bundle"]["externalBin"] = serde_json::Value::Null;
    std::env::set_var("TAURI_CONFIG", patch.to_string());
}
