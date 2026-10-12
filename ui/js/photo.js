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

/** Draws `im` behind everything on a w x h (virtual) canvas. adj = {dx,dy,s}; blur in px; dim 0..1. */
export function drawPhoto(ctx, im, w, h, adj, blur, dim, hiRes) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight) * adj.s, iw = im.naturalWidth * k, ih = im.naturalHeight * k;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(blur > 0 ? blurred(im, blur, hiRes) : im, (w - iw) / 2 + adj.dx, (h - ih) / 2 + adj.dy, iw, ih);
  if (dim > 0) { ctx.fillStyle = `rgba(7,7,12,${dim})`; ctx.fillRect(0, 0, w, h); }
}
