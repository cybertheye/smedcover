//! The subject of a photo, cut out: its mask, a PNG of the photo's size in which only the alpha
//! channel matters, opaque where the subject is. Two ways: Apple's Vision ([`vision`], macOS 14 and
//! later, built in) and BiRefNet run by ONNX Runtime ([`onnx`], any system), whose runtime and model
//! are downloaded into the data folder first.

use std::path::Path;
use std::sync::atomic::Ordering;

use serde::Serialize;

use crate::{net, Res};

pub mod onnx;
pub mod vision;

/// A cut-out model: its id, its size, and whether it has been downloaded.
#[derive(Serialize)]
pub struct CutModel {
    pub id: &'static str,
    pub bytes: u64,
    pub have: bool,
}

/// How a download is getting on (the app sends it to the page as the event `cut-model-progress`).
#[derive(Clone, Serialize)]
pub struct CutProgress {
    pub id: String,
    pub done: u64,
    pub total: u64,
}

/// The mask of the photo's subject from Apple's Vision; elsewhere, why there is none ("unsupported: …").
pub fn vision_mask(photo: &[u8]) -> Res<Vec<u8>> {
    vision::mask_png(photo)
}

/// The cut-out models, and whether each is in the data folder `data`.
pub fn models(data: &Path) -> Vec<CutModel> {
    onnx::MODELS.iter().map(|m| CutModel { id: m.id, bytes: m.file.bytes, have: onnx::have(data, m) }).collect()
}

/// Downloads a cut-out model into the data folder, telling `progress` how far it has got; returns once
/// it is there, has failed or was cancelled ([`cancel_download`]). The wait is per read, not for the
/// whole file: a big model on a slow line takes long but is fine.
pub fn download(data: &Path, id: &str, proxy: Option<&str>, progress: impl Fn(CutProgress)) -> Res<()> {
    let m = onnx::model(id)?;
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(30))
        .timeout_read(std::time::Duration::from_secs(120));
    if let Some(p) = net::proxy_for(m.file.url, proxy.unwrap_or("")) {
        builder = builder.proxy(ureq::Proxy::new(&p).map_err(|e| format!("proxy {p}: {e}"))?);
    }
    let agent = builder.build();
    onnx::download(&agent, data, m, |done, total| {
        progress(CutProgress { id: id.to_string(), done, total });
    })
}

/// Stops the download that is running.
pub fn cancel_download() {
    onnx::CANCEL.store(true, Ordering::SeqCst);
}

/// Removes a cut-out model from the data folder (and the runtime once no model is left).
pub fn delete(data: &Path, id: &str) -> Res<()> {
    onnx::remove(data, onnx::model(id)?)
}

/// The mask of the photo's subject made with the model `id`, which must have been downloaded.
pub fn onnx_mask(data: &Path, id: &str, photo: &[u8]) -> Res<Vec<u8>> {
    let m = onnx::model(id)?;
    if !onnx::have(data, m) {
        return Err("model not downloaded".into());
    }
    onnx::mask_png(data, m, photo)
}
