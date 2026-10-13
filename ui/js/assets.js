// The asset library: built-in category graphics, the free sticker pack, and the user's own assets
// (uploaded images, and stickers generated as data — see spec.js).
// An asset is referenced as {kind: "graphic" | "sticker" | "user", id}.
import { GRAPHICS, drawGraphic, graphicRadius, rgb, INK } from "./cel.js";
import { STICKERS, STICKER_GROUPS, stickerById, drawSticker } from "./stickers.js";
import { drawSpec } from "./spec.js";
import "./graphics.js";   // registers the extra category graphics

export { GRAPHICS, STICKERS, STICKER_GROUPS };

/** The user's assets: id -> {id, name, src (data URL), img (decoded Image)} or {id, name, spec}. */
export const userAssets = new Map();
const decode = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

/** Adds (or replaces) an uploaded asset in memory. Returns the entry, or null if the image is unreadable. */
export async function putUserAsset(id, name, src) {
  if (typeof src !== "string" || !src.startsWith("data:image/")) return null;
  const img = await decode(src);
  if (!img) return null;
  const entry = { id, name: String(name || "asset").slice(0, 80), src, img };
  userAssets.set(id, entry);
  return entry;
}
/** Adds (or replaces) a generated sticker in memory. `spec` must already be normalised. */
export function putSpecAsset(id, name, spec) {
  const entry = { id, name: String(name || "AI").slice(0, 80), spec };
  userAssets.set(id, entry);
  return entry;
}
/** Stable id for an image, so importing the same picture twice does not duplicate it. */
export function assetIdFor(src) {
  let h = 2166136261;
  for (let i = 0; i < src.length; i += Math.max(1, Math.floor(src.length / 4096))) h = Math.imul(h ^ src.charCodeAt(i), 16777619);
  return "u" + (h >>> 0).toString(36) + src.length.toString(36);
}

export function assetExists(ref) {
  if (!ref) return false;
  if (ref.kind === "graphic") return GRAPHICS.some((g) => g.id === ref.id);
  if (ref.kind === "sticker") return !!stickerById(ref.id);
  return ref.kind === "user" && userAssets.has(ref.id);
}
export function assetName(ref, lang) {
  if (!ref) return "";
  if (ref.kind === "graphic") return GRAPHICS.find((g) => g.id === ref.id)?.name[lang] || ref.id;
  if (ref.kind === "sticker") return stickerById(ref.id)?.name[lang] || ref.id;
  return userAssets.get(ref.id)?.name || "?";
}
/** Whether an asset can take on the category colour. */
export const canTint = (ref) => !!ref && (ref.kind !== "user" || !!userAssets.get(ref.id)?.spec);

/**
 * Draws an asset centred on the origin so that it roughly fills a 600 x 600 box.
 *   color   category colour [r,g,b]; graphics always use it, stickers only when opts.tint
 *   opts    {tint, labels, stamp, shadow, pixelRatio}
 * Returns its half-extents {hw, hh} in the same units, or null when the asset is missing.
 */
export function drawAsset(ctx, ref, color, opts = {}) {
  if (!ref) return null;
  if (ref.kind === "graphic") {
    if (!GRAPHICS.some((g) => g.id === ref.id)) return null;
    drawGraphic(ctx, ref.id, 0, 0, 1, color, { labels: opts.labels, stamp: opts.stamp });
    const r = graphicRadius(ref.id, 1);
    return { hw: r, hh: r };
  }
  if (ref.kind === "sticker") {
    if (!stickerById(ref.id)) return null;
    ctx.save(); ctx.scale(3, 3); drawSticker(ctx, ref.id, opts.tint ? rgb(color) : null); ctx.restore();
    return { hw: 300, hh: 300 };
  }
  const a = userAssets.get(ref.id);
  if (a && a.spec) {
    ctx.save(); ctx.scale(3, 3); drawSpec(ctx, a.spec, opts.tint ? rgb(color) : null); ctx.restore();
    return { hw: 300, hh: 300 };
  }
  if (!a || !a.img.naturalWidth) return null;
  const k = 600 / Math.max(a.img.naturalWidth, a.img.naturalHeight), w = a.img.naturalWidth * k, h = a.img.naturalHeight * k;
  ctx.save();
  if (opts.shadow) {   // canvas shadows ignore the transform, so the offset is given in device pixels
    const m = ctx.getTransform(), unit = Math.hypot(m.a, m.b);
    ctx.shadowColor = INK; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 14 * unit;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(a.img, -w / 2, -h / 2, w, h);
  ctx.restore();
  return { hw: w / 2, hh: h / 2 };
}
