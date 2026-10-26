//! SmedCover's core: the Rust side's work that is not the desktop window's own, for the desktop app
//! (`src-tauri/`) and a server to share.
//!
//! All drawing happens in the web view (`ui/`). This side owns the file system and the network:
//!
//! * a small sandboxed store under a data folder (profiles, settings, session, fonts): [`store`],
//!   reached through [`Core`];
//! * exporting covers: PNG bytes, framed with their metadata, converted to PNG, JPEG or WebP and
//!   written ([`image`]);
//! * listing the fonts installed on the system, and handing a system family's faces to the web view
//!   ([`fonts`]);
//! * tracing lettering: the outlines of a text's glyphs, for effects that reshape the letters
//!   ([`outline`], in the fonts [`Core::text_outline`] finds);
//! * cutting the subject out of a photo, with Apple's Vision or with BiRefNet run by ONNX Runtime,
//!   whose runtime and models it downloads ([`cut`]);
//! * sending the request for an AI-generated asset, so it is not subject to the web view's
//!   cross-origin rules ([`net`]);
//! * reading a picture or a project file an agent names, and nothing else outside the data folder
//!   ([`files`]);
//! * the MCP endpoint agents call SmedCover's tools through, each call handed to the page
//!   ([`mcp`]), and the command line's endpoint beside it;
//! * one desktop app for each data folder, and the file a command line finds it by ([`instance`]);
//! * where the desktop app keeps its data, for a command line or server on the same computer
//!   ([`paths`]).
//!
//! Everything here is synchronous but the MCP endpoint, which runs on the host's Tokio runtime: a
//! host waits for the rest off its interface thread (the app on Tauri's blocking pool). Errors are
//! text, which the web view matches on ("timed out", "unsupported:", "cancelled", "model not
//! downloaded").

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub mod cut;
pub mod files;
pub mod fonts;
pub mod image;
pub mod instance;
pub mod mcp;
pub mod net;
pub mod outline;
pub mod paths;
pub mod store;

pub use fonts::BundledFonts;

pub type Res<T> = Result<T, String>;
pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The core for one data folder: the app's (or a self-test's), or a server's. The host says which
/// folder it is and keeps one `Arc<Core>` for as long as it runs.
pub struct Core {
    data: PathBuf,
    /// The fonts found by family name, the user's imported ones (in this data folder) among them.
    fonts: fonts::Fonts,
}

impl Core {
    /// The core for the data folder `data`, which is made if it is not there yet; `bundled` hands it
    /// the fonts that come with the interface.
    pub fn open(data: PathBuf, bundled: Arc<dyn BundledFonts>) -> Res<Arc<Core>> {
        fs::create_dir_all(&data).map_err(err)?;
        Ok(Arc::new(Core { data, fonts: fonts::Fonts::new(bundled) }))
    }

    /// The data folder.
    pub fn data_dir(&self) -> &Path {
        &self.data
    }

    /// `rel` inside the data folder (see [`store::resolve`]).
    pub fn resolve(&self, rel: &str) -> Res<PathBuf> {
        store::resolve(&self.data, rel)
    }

    /// A file of the store as text; `None` if it is not there.
    pub fn read(&self, rel: &str) -> Res<Option<String>> {
        store::read(&self.data, rel)
    }

    /// Writes a file of the store, and the folders it is in.
    pub fn write(&self, rel: &str, data: &str) -> Res<()> {
        store::write(&self.data, rel, data)?;
        if let Some(family) = rel.strip_prefix("fonts/").and_then(|p| p.strip_suffix(".font")) {
            self.fonts.forget(family); // imported (again): its outlines are traced from this file from now on
        }
        Ok(())
    }

    /// The names of the files in a folder of the store, sorted; none if it is not there.
    pub fn list(&self, rel: &str) -> Res<Vec<String>> {
        store::list(&self.data, rel)
    }

    /// Deletes a file of the store; one that is not there is fine.
    pub fn delete(&self, rel: &str) -> Res<()> {
        store::delete(&self.data, rel)
    }

    /// The outlines of `text` set in the first of `families` that has each character: a font shipped
    /// with the interface, one the user imported, or one installed on the system.
    pub fn text_outline(&self, text: &str, families: &[String], weight: f32) -> Res<outline::Outline> {
        let fonts: Vec<_> = families.iter().filter_map(|f| self.fonts.file(&self.data, f)).collect();
        if fonts.is_empty() {
            return Err("no usable font".to_string());
        }
        Ok(outline::trace(text, &fonts, weight.clamp(1.0, 1000.0)))
    }

    /// The cut-out models, and whether each has been downloaded into the data folder.
    pub fn cut_models(&self) -> Vec<cut::CutModel> {
        cut::models(&self.data)
    }

    /// Downloads a cut-out model into the data folder (see [`cut::download`]); blocks till it is done.
    pub fn cut_model_download(&self, id: &str, proxy: Option<&str>, progress: impl Fn(cut::CutProgress)) -> Res<()> {
        cut::download(&self.data, id, proxy, progress)
    }

    /// Removes a cut-out model from the data folder.
    pub fn cut_model_delete(&self, id: &str) -> Res<()> {
        cut::delete(&self.data, id)
    }

    /// Cuts the subject out of a photo (its encoded bytes) with the downloaded model `id`: its mask,
    /// as [`cut::vision_mask`] makes it.
    pub fn cut_onnx(&self, id: &str, photo: &[u8]) -> Res<Vec<u8>> {
        cut::onnx_mask(&self.data, id, photo)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The interface's fonts read from its folder, as a server has them.
    struct UiFolder;
    impl BundledFonts for UiFolder {
        fn get(&self, path: &str) -> Option<Vec<u8>> {
            fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui").join(path)).ok()
        }
    }

    #[test]
    fn text_outline_finds_bundled_and_imported_fonts_and_one_imported_again() {
        use base64::Engine;
        let dir = tempfile::tempdir().unwrap();
        let core = Core::open(dir.path().join("data"), Arc::new(UiFolder)).unwrap();
        assert!(core.data_dir().is_dir());
        let out = core.text_outline("Ab", &["Bebas Neue".into()], 400.0).unwrap();
        assert!(!out.missing && out.glyphs.len() == 2 && !out.glyphs[0].c.is_empty());
        // a family no one has: not bundled, not imported, not installed (and that is remembered)
        let family = "SmedCover Test Family 7f3a";
        assert_eq!(core.text_outline("A", &[family.into()], 400.0).unwrap_err(), "no usable font");
        // imported under that name, as the web view stores a font: found from then on
        let font = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/fonts/JetBrainsMono.ttf")).unwrap();
        let url = format!("data:font/ttf;base64,{}", base64::engine::general_purpose::STANDARD.encode(font));
        core.write(&format!("fonts/{family}.font"), &url).unwrap();
        let out = core.text_outline("A", &[family.into()], 400.0).unwrap();
        assert!(!out.missing && !out.glyphs[0].c.is_empty());
    }
}
