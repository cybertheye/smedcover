// Background photo: fitted to cover the canvas, then moved / scaled by the user.
// The gaussian blur is applied to the photo itself, once, on a small working copy, and cached;
// after that moving or scaling the photo, or editing anything else, costs a single drawImage.
// (Canvas filters are not available in WebKit web views, hence the JS blur.)

/** Gaussian blur approximated by three box blurs, in place on RGBA bytes (alpha untouched). */
export function gaussBlur(d, w, h, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5)), inv = 1 / (2 * r + 1);
  const a = new Float32Array(d.length), b = new Float32Array(d.length);
  a.set(d);
  const pass = (src, dst, len, cnt, step, stride) => {   // one axis: cnt lines of length len, edges clamped
    const rr = Math.min(r, len - 1), last = (len - 1) * step;
    for (let l = 0; l < cnt; l++) for (let c = 0; c < 3; c++) {
      const o = l * stride + c, first = src[o], end = src[o + last];
      let acc = first * (r + 1);
      for (let k = 1; k <= r; k++) acc += src[o + Math.min(k, len - 1) * step];
      let p = 0, i = o;
      for (; p <= rr && p < len; p++, i += step) { dst[i] = acc * inv; acc += (p + r + 1 < len ? src[i + (r + 1) * step] : end) - first; }
      for (const stop = len - r - 1; p < stop; p++, i += step) { dst[i] = acc * inv; acc += src[i + (r + 1) * step] - src[i - r * step]; }
      for (; p < len; p++, i += step) { dst[i] = acc * inv; acc += end - src[i - r * step]; }
    }
  };
  for (let k = 0; k < 3; k++) { pass(a, b, w, h, 4, w * 4); pass(b, a, h, w, w * 4, 4); }
  for (let i = 0; i < d.length; i += 4) { d[i] = a[i]; d[i + 1] = a[i + 1]; d[i + 2] = a[i + 2]; }
}

const cache = {};   // one slot for previews, one for hi-res export
function blurred(im, b, hi) {
  const cap = hi ? 2400 : 1100, long = Math.max(im.naturalWidth, im.naturalHeight), base = Math.min(1, cap / long);
  const sigma = (b * long * base) / 1920;      // b = radius in px on a 1920-wide rendering of the photo
  const f = Math.max(1, sigma / 1.5);          // the stronger the blur, the smaller the copy it is computed on
  const w = Math.max(8, Math.round((im.naturalWidth * base) / f)), h = Math.max(8, Math.round((im.naturalHeight * base) / f));
  const slot = cache[hi ? "hi" : "lo"] || (cache[hi ? "hi" : "lo"] = { cv: document.createElement("canvas") });
  const key = `${b}|${w}|${h}`;
  if (slot.im !== im || slot.key !== key) {
    const c = slot.cv;
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(im, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h);
    gaussBlur(id.data, w, h, sigma / f);
    x.putImageData(id, 0, 0);
    slot.im = im; slot.key = key;
  }
  return slot.cv;
}

const greys = {};   // the photo (or its blurred copy) without its colour: one slot for previews, one for export
/** A grey copy of `src` (an image or canvas), computed once and kept until the photo or its blur changes. */
function greyOf(src, im, key, hi) {
  const cap = hi ? 2400 : 1100, sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, cap / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const slot = greys[hi ? "hi" : "lo"] || (greys[hi ? "hi" : "lo"] = { cv: document.createElement("canvas") });
  if (slot.im !== im || slot.key !== key) {
    const c = slot.cv;
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
    x.putImageData(id, 0, 0);
    slot.im = im; slot.key = key;
  }
  return slot.cv;
}

/**
 * Draws `im` behind everything on a w x h (virtual) canvas. adj = {dx,dy,s}; blur in px; dim 0..1;
 * grey 0..1 takes that much of the colour out.
 */
export function drawPhoto(ctx, im, w, h, adj, blur, dim, hiRes, grey = 0) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight) * adj.s, iw = im.naturalWidth * k, ih = im.naturalHeight * k;
  const src = blur > 0 ? blurred(im, blur, hiRes) : im, x = (w - iw) / 2 + adj.dx, y = (h - ih) / 2 + adj.dy;
  ctx.imageSmoothingQuality = "high";
  if (grey < 1) ctx.drawImage(src, x, y, iw, ih);
  if (grey > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, grey); ctx.drawImage(greyOf(src, im, `${blur}|${hiRes}`, hiRes), x, y, iw, ih); ctx.restore(); }
  if (dim > 0) { ctx.fillStyle = `rgba(7,7,12,${dim})`; ctx.fillRect(0, 0, w, h); }
}
