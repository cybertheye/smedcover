//! Exporting covers: the web view sends PNG bytes in a raw, framed request body (no base64), which
//! are converted to PNG, JPEG or WebP and written here.

use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

use ::image::{codecs::jpeg::JpegEncoder, ImageFormat, RgbImage};
use serde::Deserialize;

use crate::{err, Res};

/// Colour put behind transparent pixels when saving JPEG (the app's dark field colour).
pub const MATTE: [u8; 3] = [10, 10, 18];

/// Re-encodes PNG bytes as `format` ("png" | "jpeg" | "webp"). JPEG is flattened onto
/// [`MATTE`]; WebP is lossless.
pub fn encode(png: &[u8], format: &str, quality: u8) -> Res<Vec<u8>> {
    if format == "png" {
        return Ok(png.to_vec());
    }
    let img = ::image::load_from_memory_with_format(png, ImageFormat::Png).map_err(err)?;
    let mut out = Vec::new();
    match format {
        "jpeg" => {
            let rgba = img.to_rgba8();
            let mut rgb = RgbImage::new(rgba.width(), rgba.height());
            for (dst, src) in rgb.pixels_mut().zip(rgba.pixels()) {
                let a = u32::from(src[3]);
                for c in 0..3 {
                    dst[c] = ((u32::from(src[c]) * a + u32::from(MATTE[c]) * (255 - a) + 127) / 255)
                        as u8;
                }
            }
            JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
                .encode_image(&rgb)
                .map_err(err)?;
        }
        "webp" => img
            .to_rgba8()
            .write_to(&mut Cursor::new(&mut out), ImageFormat::WebP)
            .map_err(err)?,
        other => return Err(format!("unsupported format: {other}")),
    }
    Ok(out)
}

/// What accompanies the image bytes of an export request.
#[derive(Deserialize)]
pub struct ExportMeta {
    pub name: String,
    pub format: String,
    pub quality: u8,
    #[serde(default)]
    pub dir: String,
}

/// Splits a binary export request into its metadata and PNG bytes. The body is framed as
/// `[u32 little-endian length][JSON metadata][PNG]`, so file names and pixels travel together
/// without base64 and without relying on request headers.
pub fn parse_frame(body: &[u8]) -> Res<(ExportMeta, &[u8])> {
    let len = body
        .get(..4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize)
        .ok_or("request too short")?;
    let meta = body.get(4..4 + len).ok_or("truncated metadata")?;
    let meta: ExportMeta =
        serde_json::from_slice(meta).map_err(|e| format!("invalid metadata: {e}"))?;
    Ok((meta, &body[4 + len..]))
}

/// Keeps only the final path component, so a name can never escape the chosen folder.
pub fn safe_name(name: &str) -> Res<&std::ffi::OsStr> {
    Path::new(name)
        .file_name()
        .ok_or_else(|| format!("invalid file name: {name}"))
}

pub fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Writes one cover into `meta.dir`, a folder the user picked before (`pick_folder` in the app),
/// converted to its format; where it was written. A folder that is not absolute, or not there, is refused.
pub fn write_into(meta: &ExportMeta, png: &[u8]) -> Res<PathBuf> {
    let dir = PathBuf::from(&meta.dir);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err(format!("not a folder: {}", dir.display()));
    }
    let path = dir.join(safe_name(&meta.name)?);
    fs::write(&path, encode(png, &meta.format, meta.quality)?).map_err(err)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::image::{Rgba, RgbaImage};

    fn png(img: &RgbaImage) -> Vec<u8> {
        let mut bytes = Vec::new();
        img.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)
            .unwrap();
        bytes
    }

    #[test]
    fn safe_name_strips_directories() {
        assert_eq!(safe_name("../../etc/cover.png").unwrap(), "cover.png");
        assert_eq!(
            safe_name("01-街拍日记_标题_1920x1080.png").unwrap(),
            "01-街拍日记_标题_1920x1080.png"
        );
        assert!(safe_name("..").is_err());
        assert_eq!(extension("a/b/Cover.JPG"), "jpg");
    }

    #[test]
    fn encode_png_is_passed_through() {
        let bytes = png(&RgbaImage::from_pixel(4, 3, Rgba([1, 2, 3, 255])));
        assert_eq!(encode(&bytes, "png", 90).unwrap(), bytes);
        assert!(encode(b"not a png", "jpeg", 90).is_err());
        assert!(encode(&bytes, "gif", 90).is_err());
    }

    #[test]
    fn parse_frame_splits_metadata_from_pixels() {
        let meta = r#"{"name":"01-街拍_a b.png","format":"jpeg","quality":90,"dir":"/tmp/out"}"#
            .as_bytes();
        let mut body = (meta.len() as u32).to_le_bytes().to_vec();
        body.extend_from_slice(meta);
        body.extend_from_slice(b"PIXELS");
        let (m, rest) = parse_frame(&body).unwrap();
        assert_eq!(
            (
                m.name.as_str(),
                m.format.as_str(),
                m.quality,
                m.dir.as_str()
            ),
            ("01-街拍_a b.png", "jpeg", 90, "/tmp/out")
        );
        assert_eq!(rest, b"PIXELS");
        assert!(parse_frame(b"\x01").is_err()); // no length
        assert!(parse_frame(&[200, 0, 0, 0, b'{']).is_err()); // metadata cut short
        assert!(parse_frame(&[2, 0, 0, 0, b'n', b'o']).is_err()); // not JSON
    }

    #[test]
    fn encode_jpeg_flattens_transparency_onto_the_matte() {
        let mut img = RgbaImage::from_pixel(16, 16, Rgba([255, 255, 255, 255]));
        for x in 0..8 {
            for y in 0..16 {
                img.put_pixel(x, y, Rgba([255, 0, 0, 0])); // fully transparent half
            }
        }
        let jpg = encode(&png(&img), "jpeg", 95).unwrap();
        let back = ::image::load_from_memory_with_format(&jpg, ImageFormat::Jpeg)
            .unwrap()
            .to_rgb8();
        assert_eq!((back.width(), back.height()), (16, 16));
        let dark = back.get_pixel(2, 8);
        let light = back.get_pixel(13, 8);
        assert!(
            dark.0.iter().zip(MATTE).all(|(a, b)| a.abs_diff(b) < 12),
            "{dark:?}"
        );
        assert!(light.0.iter().all(|&c| c > 240), "{light:?}");
    }

    #[test]
    fn encode_webp_is_lossless() {
        let mut img = RgbaImage::from_pixel(5, 4, Rgba([10, 200, 30, 255]));
        img.put_pixel(1, 1, Rgba([250, 1, 99, 128]));
        let webp = encode(&png(&img), "webp", 80).unwrap();
        let back = ::image::load_from_memory_with_format(&webp, ImageFormat::WebP)
            .unwrap()
            .to_rgba8();
        assert_eq!(back, img);
    }
}
