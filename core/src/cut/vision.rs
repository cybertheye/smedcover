//! The subject of a photo, cut out: a mask from Apple's Vision framework (the same "lift subject
//! from background" the Photos app has), macOS 14 and later. Elsewhere it reports that it is not
//! available.
//!
//! The photo comes in as encoded bytes (JPEG or PNG, already upright); the mask goes back as a PNG
//! of the photo's size in which only the alpha channel matters: opaque where the subject is.

use image::{ImageBuffer, ImageFormat, LumaA};
use std::io::Cursor;

/// The mask of the photo's foreground subjects as a PNG (grey + alpha), or why there is none.
pub fn mask_png(photo: &[u8]) -> Result<Vec<u8>, String> {
    let (w, h, alpha) = mask(photo)?;
    let img: ImageBuffer<LumaA<u8>, Vec<u8>> =
        ImageBuffer::from_fn(w, h, |x, y| LumaA([255, alpha[(y * w + x) as usize]]));
    let mut out = Vec::new();
    img.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

#[cfg(not(target_os = "macos"))]
fn mask(_photo: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    Err("unsupported: the subject cut-out needs macOS 14 or later".into())
}

#[cfg(target_os = "macos")]
fn mask(photo: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    use objc2::encode::{Encoding, RefEncode};
    use objc2::rc::{autoreleasepool, Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::msg_send;
    use objc2_foundation::{NSArray, NSData, NSDictionary, NSError, NSString};
    use std::ffi::c_void;

    /// CVPixelBufferRef, as the Objective-C runtime describes it.
    #[repr(C)]
    struct CVBuffer {
        _private: [u8; 0],
    }
    unsafe impl RefEncode for CVBuffer {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Encoding::Struct("__CVBuffer", &[]));
    }
    #[link(name = "Vision", kind = "framework")]
    extern "C" {}
    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        fn CVPixelBufferLockBaseAddress(pb: *mut CVBuffer, flags: u64) -> i32;
        fn CVPixelBufferUnlockBaseAddress(pb: *mut CVBuffer, flags: u64) -> i32;
        fn CVPixelBufferGetBaseAddress(pb: *mut CVBuffer) -> *mut c_void;
        fn CVPixelBufferGetBytesPerRow(pb: *mut CVBuffer) -> usize;
        fn CVPixelBufferGetWidth(pb: *mut CVBuffer) -> usize;
        fn CVPixelBufferGetHeight(pb: *mut CVBuffer) -> usize;
        fn CVPixelBufferGetPixelFormatType(pb: *mut CVBuffer) -> u32;
    }
    const READ_ONLY: u64 = 1;
    const FLOAT32: u32 = u32::from_be_bytes(*b"L00f"); // kCVPixelFormatType_OneComponent32Float
    const BYTE: u32 = u32::from_be_bytes(*b"L008"); // kCVPixelFormatType_OneComponent8
    let why = |e: Retained<NSError>| e.localizedDescription().to_string();

    autoreleasepool(|_| unsafe {
        // VNGenerateForegroundInstanceMaskRequest is new in macOS 14: look it up instead of linking to it
        let request_class = AnyClass::get(c"VNGenerateForegroundInstanceMaskRequest")
            .ok_or("unsupported: the subject cut-out needs macOS 14 or later")?;
        let handler_class = AnyClass::get(c"VNImageRequestHandler").ok_or("unsupported: Vision is not available")?;

        let data = NSData::with_bytes(photo);
        let options = NSDictionary::<NSString, AnyObject>::new();
        let handler: Allocated<AnyObject> = msg_send![handler_class, alloc];
        let handler: Option<Retained<AnyObject>> = msg_send![handler, initWithData: &*data, options: &*options];
        let handler = handler.ok_or("the photo could not be read")?;
        let request: Retained<AnyObject> = msg_send![request_class, new];

        let requests = NSArray::from_retained_slice(&[request.clone()]);
        let done: Result<(), Retained<NSError>> = msg_send![&handler, performRequests: &*requests, error: _];
        done.map_err(why)?;

        let results: Option<Retained<NSArray<AnyObject>>> = msg_send![&request, results];
        let observation = results.and_then(|r| r.firstObject()).ok_or("no subject found in this photo")?;
        let instances: Retained<AnyObject> = msg_send![&observation, allInstances];
        let count: usize = msg_send![&instances, count];
        if count == 0 {
            return Err("no subject found in this photo".into());
        }
        let mut error: *mut NSError = std::ptr::null_mut();
        // a mask scaled to the photo's own size; owned by the autorelease pool, so not released here
        let buffer: *mut CVBuffer = msg_send![&observation,
            generateScaledMaskForImageForInstances: &*instances,
            fromRequestHandler: &*handler,
            error: &mut error];
        if buffer.is_null() {
            return Err(Retained::retain(error).map(why).unwrap_or_else(|| "the mask could not be made".into()));
        }

        if CVPixelBufferLockBaseAddress(buffer, READ_ONLY) != 0 {
            return Err("the mask could not be read".into());
        }
        let (w, h, row) = (CVPixelBufferGetWidth(buffer), CVPixelBufferGetHeight(buffer), CVPixelBufferGetBytesPerRow(buffer));
        let format = CVPixelBufferGetPixelFormatType(buffer);
        let base = CVPixelBufferGetBaseAddress(buffer) as *const u8;
        let mut alpha = Vec::with_capacity(w * h);
        let read = (|| {
            if base.is_null() {
                return Err("the mask could not be read".to_string());
            }
            for y in 0..h {
                let line = base.add(y * row);
                for x in 0..w {
                    alpha.push(match format {
                        FLOAT32 => (line.add(x * 4).cast::<f32>().read_unaligned().clamp(0.0, 1.0) * 255.0).round() as u8,
                        BYTE => *line.add(x),
                        other => return Err(format!("unexpected mask format {other:#x}")),
                    });
                }
            }
            Ok(())
        })();
        CVPixelBufferUnlockBaseAddress(buffer, READ_ONLY);
        read?;
        Ok((w as u32, h as u32, alpha))
    })
}

#[cfg(test)]
mod tests {
    /// A real photo is needed: SMEDCOVER_TEST_PHOTO=/path/to/photo.jpg cargo test -p smedcover-core cut::vision -- --ignored
    #[test]
    #[ignore]
    fn subject_mask_of_a_photo() {
        let path = std::env::var("SMEDCOVER_TEST_PHOTO").expect("set SMEDCOVER_TEST_PHOTO");
        let bytes = std::fs::read(&path).unwrap();
        let png = super::mask_png(&bytes).unwrap();
        let mask = image::load_from_memory(&png).unwrap().to_luma_alpha8();
        let photo = image::load_from_memory(&bytes).unwrap();
        assert_eq!((mask.width(), mask.height()), (photo.width(), photo.height()));
        let on = mask.pixels().filter(|p| p.0[1] > 127).count() as f64 / (mask.width() * mask.height()) as f64;
        println!("{path}: {}x{}, subject {:.1}%", mask.width(), mask.height(), on * 100.0);
        assert!(on > 0.005 && on < 0.95);
        // SMEDCOVER_TEST_OUT=/path.jpg: the photo with everything but the subject darkened, to look at
        if let Ok(out) = std::env::var("SMEDCOVER_TEST_OUT") {
            let mut view = photo.to_rgb8();
            for (p, m) in view.pixels_mut().zip(mask.pixels()) {
                let k = 0.15 + 0.85 * m.0[1] as f32 / 255.0;
                for c in p.0.iter_mut() { *c = (*c as f32 * k) as u8; }
            }
            view.save(out).unwrap();
        }
    }
}
