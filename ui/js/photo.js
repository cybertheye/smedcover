// Photos: a photo layer fills the canvas (fitted to cover it, then moved / scaled by the user) or
// sits on it like a print, at its own place, size and angle (see render.js).
// The gaussian blur is applied to the photo itself, once, on a small working copy, and cached;
// after that moving or scaling the photo, or editing anything else, costs a single drawImage.
// (Canvas filters are not available in WebKit web views, hence the JS blur.)

/** For checks of speed: while `on`, time spent computing pixels in script (blurs, masks…) is added up in `ms` by kind. */
export const PIXELS = { on: false, ms: {} };
export const pxTime = (name, t0) => { if (PIXELS.on) PIXELS.ms[name] = (PIXELS.ms[name] || 0) + performance.now() - t0; };

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

/**
 * Gaussian blur (three box blurs) of one channel of floats, in place, edges clamped. Both passes walk
 * memory in order: the vertical one keeps a running sum per column and goes row by row.
 */
export function blurChannel(a, w, h, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma * 4 + 1) / 2 - 0.5)), inv = 1 / (2 * r + 1);
  const b = new Float32Array(a.length), acc = new Float32Array(w);
  const across = (src, dst) => {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      let q = src[o] * (r + 1);
      for (let k = 1; k <= r; k++) q += src[o + Math.min(k, w - 1)];
      for (let x = 0; x < w; x++) { dst[o + x] = q * inv; q += src[o + Math.min(x + r + 1, w - 1)] - src[o + Math.max(x - r, 0)]; }
    }
  };
  const down = (src, dst) => {
    for (let x = 0; x < w; x++) acc[x] = src[x] * (r + 1);
    for (let k = 1; k <= r; k++) { const o = Math.min(k, h - 1) * w; for (let x = 0; x < w; x++) acc[x] += src[o + x]; }
    for (let y = 0; y < h; y++) {
      const o = y * w, add = Math.min(y + r + 1, h - 1) * w, sub = Math.max(y - r, 0) * w;
      for (let x = 0; x < w; x++) { dst[o + x] = acc[x] * inv; acc[x] += src[add + x] - src[sub + x]; }
    }
  };
  for (let k = 0; k < 3; k++) { across(a, b); down(b, a); }
}

/** A picture's size, whether it is an image or a canvas. */
export const sizeOf = (im) => [im.naturalWidth || im.width, im.naturalHeight || im.height];
const cache = new WeakMap();   // per picture: one slot for previews, one for hi-res export
const slotOf = (store, im, hi) => { const s = store.get(im) || {}; store.set(im, s); return s[hi ? "hi" : "lo"] || (s[hi ? "hi" : "lo"] = { cv: document.createElement("canvas") }); };
function blurred(im, b, hi) {
  const [iw, ih] = sizeOf(im), cap = hi ? 2400 : 1100, long = Math.max(iw, ih), base = Math.min(1, cap / long);
  const sigma = (b * long * base) / 1920;      // b = radius in px on a 1920-wide rendering of the photo
  const f = Math.max(1, sigma / 1.5);          // the stronger the blur, the smaller the copy it is computed on
  const w = Math.max(8, Math.round((iw * base) / f)), h = Math.max(8, Math.round((ih * base) / f));
  const slot = slotOf(cache, im, hi);
  const key = `${b}|${w}|${h}`;
  if (slot.im !== im || slot.key !== key) {
    const t0 = performance.now(), c = slot.cv;
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(im, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h);
    gaussBlur(id.data, w, h, sigma / f);
    x.putImageData(id, 0, 0);
    slot.im = im; slot.key = key;
    pxTime("photo blur", t0);
  }
  return slot.cv;
}

const greys = new WeakMap();   // the photo (or its blurred copy) without its colour, per picture: one slot for previews, one for export
/** A grey copy of `src` (an image or canvas), computed once and kept until the photo or its blur changes. */
function greyOf(src, im, key, hi) {
  const cap = hi ? 2400 : 1100, sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, cap / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const slot = slotOf(greys, im, hi);
  if (slot.im !== im || slot.key !== key) {
    const t0 = performance.now(), c = slot.cv;
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h), d = id.data;
    for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8;
    x.putImageData(id, 0, 0);
    slot.im = im; slot.key = key;
    pxTime("grey copy", t0);
  }
  return slot.cv;
}

/** Where the photo lands on a w × h cover: it fills the cover, then is scaled by adj.s and moved by adj.dx / dy. */
export function photoRect(im, w, h, adj) {
  const [nw, nh] = sizeOf(im), k = Math.max(w / nw, h / nh) * adj.s, iw = nw * k, ih = nh * k;
  return { x: (w - iw) / 2 + adj.dx, y: (h - ih) / 2 + adj.dy, iw, ih };
}
/**
 * Draws `im` to fill a w × h (virtual) canvas. adj = {dx,dy,s}; blur in px; dim 0..1 darkens the
 * whole canvas; grey 0..1 takes that much of the colour out.
 */
export function drawPhoto(ctx, im, w, h, adj, blur, dim, hiRes, grey = 0) {
  const { x, y, iw, ih } = photoRect(im, w, h, adj);
  drawPhotoAt(ctx, im, x, y, iw, ih, blur, hiRes, grey);
  if (dim > 0) { ctx.fillStyle = `rgba(7,7,12,${dim})`; ctx.fillRect(0, 0, w, h); }
}
/** Draws `im` into the rectangle x, y, w × h, blurred by `blur` px and with `grey` of its colour taken out. */
export function drawPhotoAt(ctx, im, x, y, iw, ih, blur, hiRes, grey = 0, treat = null) {
  let src = blur > 0 ? blurred(im, blur, hiRes) : im;
  if (treat) src = treatedOf(src, im, `${blur}|${hiRes}|${treat.key}`, hiRes, treat.fn);
  ctx.imageSmoothingQuality = "high";
  if (grey < 1) ctx.drawImage(src, x, y, iw, ih);
  if (grey > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, grey); ctx.drawImage(greyOf(src, im, `${blur}|${hiRes}|${treat ? treat.key : ""}`, hiRes), x, y, iw, ih); ctx.restore(); }
}
const treated = new WeakMap();   // the photo (or its blurred copy) worked on by a look, per picture: one slot for previews, one for export
/**
 * A copy of `src` with its pixels worked on by fn(RGBA data) — a look recolouring the photo — computed once
 * on a canvas in memory and kept until the photo, its blur or `key` changes: done once, where reading the
 * whole canvas back from the graphics card would cost every redraw.
 */
function treatedOf(src, im, key, hi, fn) {
  const cap = hi ? 2400 : 1100, sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, cap / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const slot = slotOf(treated, im, hi);
  if (slot.im !== im || slot.key !== key) {
    const t0 = performance.now(), c = slot.cv;
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, w, h);
    const id = x.getImageData(0, 0, w, h);
    fn(id.data);
    x.putImageData(id, 0, 0);
    slot.im = im; slot.key = key;
    pxTime("photo worked by the look", t0);
  }
  return slot.cv;
}
