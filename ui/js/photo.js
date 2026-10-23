// Photos: a photo layer fills the canvas (fitted to cover it, then moved / scaled by the user) or
// sits on it like a print, at its own place, size and angle (see render.js).
// The gaussian blur is applied to the photo itself, once, on a small working copy, and cached;
// after that moving or scaling the photo, or editing anything else, costs a single drawImage.
// (Canvas filters are not available in WebKit web views, hence the JS blur.)

/** For checks of speed: while `on`, time spent computing pixels in script (blurs, masks…) is added up in `ms` by kind. */
export const PIXELS = { on: false, ms: {} };
export const pxTime = (name, t0) => { if (PIXELS.on) PIXELS.ms[name] = (PIXELS.ms[name] || 0) + performance.now() - t0; };

let draft = false;   // see setDraft()
/**
 * Whether what is painted now is a draft — a frame of a slider or a layer being dragged (see render.js) —
 * whose photo copies are then drawn from the graphics card (see onCard): fast, and a hair different from
 * a still cover's, which goes on drawing them as it always has.
 */
export function setDraft(on) { draft = !!on; }
/** Whether what is painted now is a draft (see setDraft): what a draft paints is not a still cover's, nor kept as one. */
export const isDraft = () => draft;

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
    slot.im = im; slot.key = key; c.filled = (c.filled || 0) + 1;
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
    slot.im = im; slot.key = key; c.filled = (c.filled || 0) + 1;
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
/**
 * Draws `im` into the rectangle x, y, w × h, blurred by `blur` px and with `grey` of its colour taken out.
 * treat: the look's own work on the photo, { key, fn, quick? } (see treatedOf); in a draft (a slider being
 * dragged, its blur say) that would have the work done afresh each frame, its `quick` one ({ key, fn }), if
 * it has one, until the drag is let go. Or { key, fn(RGBA, w, h, cut), draw(ctx, model, x, y, w, h), cap, mask? }, a
 * look drawing the photo itself from what fn worked out of its pixels (see modelOf): the facets of the origami
 * noir, drawn as shapes, sharp at any size; with `mask` (a cut-out's), worked out of what it keeps alone; with
 * `quickCap`, in a draft that needs a model not worked out yet (a slider that changes it being dragged), on a
 * copy that size, until the drag is let go.
 */
export function drawPhotoAt(ctx, im, x, y, iw, ih, blur, hiRes, grey = 0, treat = null) {
  if (treat && treat.draw) { treat.draw(ctx, modelOf(blur > 0 ? blurred(im, blur, false) : im, im, blur, treat.key, treat.cap || 800, treat.fn, treat.mask, draft ? treat.quickCap : 0), x, y, iw, ih); return; }
  let src = blur > 0 ? blurred(im, blur, hiRes) : im;
  if (treat && treat.quick && draft && !holds(im, hiRes, `${blur}|${hiRes}|${treat.key}`)) treat = treat.quick;
  if (treat) src = treatedOf(src, im, `${blur}|${hiRes}|${treat.key}`, hiRes, treat.fn);
  ctx.imageSmoothingQuality = "high";
  if (grey < 1) ctx.drawImage(onCard(src), x, y, iw, ih);
  if (grey > 0) { ctx.save(); ctx.globalAlpha = Math.min(1, grey); ctx.drawImage(onCard(greyOf(src, im, `${blur}|${hiRes}|${treat ? treat.key : ""}`, hiRes)), x, y, iw, ih); ctx.restore(); }
}
let cards = new WeakMap(), carded = [];   // a kept copy (blurred, grey, worked by the look) -> {cv, filled}: its pixels on a canvas on the graphics card; those canvases
/**
 * What a draft draws for `src`: for one of the copies kept here, the same pixels on a canvas the web view
 * keeps on the graphics card, made once each time that copy is filled again; the picture itself is drawn as
 * it is, and outside a draft everything is. The copies are worked out on canvases held in memory (their
 * pixels are read back and written in script), and WebKit sends such a canvas to the card again each time
 * it is drawn — some milliseconds for a photo's copy, and a look may draw its photo a dozen times a frame
 * (the black-and-white film's motion trail and its pieces of collage do): its sliders were dragged at a few
 * frames a second, and the knob trailed the mouse. From the card, the same takes a fraction of a millisecond.
 * Kept until the drag or the draft ends (see dropCards).
 */
function onCard(src) {
  if (!draft || !src.filled) return src;
  let k = cards.get(src);
  if (!k || k.filled !== src.filled) {
    const cv = k ? k.cv : document.createElement("canvas");
    if (!k) carded.push(cv);
    cv.width = src.width; cv.height = src.height;
    cv.getContext("2d").drawImage(src, 0, 0);
    cards.set(src, (k = { cv, filled: src.filled }));
  }
  return k.cv;
}
/**
 * Lets the copies on the graphics card go (see onCard), as the drag or the draft they were made for ends: a
 * still cover has no use for them, and kept with the photo's own copies, as long as the photo, they held the
 * card for nothing — a layer dragged on a Retina canvas draws the copies made for its larger pixels (2400 px
 * on their longer side), some 17 MB each. The next draft makes them again, once each.
 */
export function dropCards() {
  if (!carded.length) return;
  for (const cv of carded) cv.width = cv.height = 0;
  carded = []; cards = new WeakMap();
}
const models = new WeakMap(), MODELS_KEEP = 3;   // per picture: the last few copies of its pixels read (MODELS_KEEP), each with the last few things a look worked out of them, newest first
/**
 * What fn(RGBA data, w, h, cut) makes of the pixels of `src` (the photo, or its blurred copy) — the shapes a look
 * draws the photo as — worked out on a copy `cap` px on its longer side, cut to `mask` (a cut-out's: what it
 * keeps alone; `cut` then true, the mask clipping what is drawn after), and kept: the last few copies of a picture read (a photo at two blurs, a background and its
 * cut-out, each its own), and the last few shapes worked out of each (a new `key`, a look's slider, works out only
 * the shapes again). With `quick`, shapes not worked out yet are worked out on a copy that size instead. One for
 * previews and exports alike (the preview's blurred copy is the one read), so an export draws the very shapes the
 * preview showed, only sharper.
 */
function modelOf(src, im, blur, key, cap, fn, mask = null, quick = 0) {
  const list = models.get(im) || [];
  models.set(im, list);
  if (quick) { const e0 = list.find((e) => e.blur === blur && e.cap === cap && e.mask === mask); if (!e0 || !e0.made.some((q) => q.key === key)) cap = quick; }   // not worked out yet: quickly, on the smaller copy
  let at = list.findIndex((e) => e.blur === blur && e.cap === cap && e.mask === mask), e = list[at];
  if (at > 0) { list.splice(at, 1); list.unshift(e); }   // the newest again
  if (at < 0) {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, cap / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f)), c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(src, 0, 0, w, h);
    if (mask) { x.globalCompositeOperation = "destination-in"; x.drawImage(mask, 0, 0, w, h); }
    e = { blur, cap, mask, px: x.getImageData(0, 0, w, h).data, w, h, made: [] };
    list.unshift(e);
    if (list.length > MODELS_KEEP) list.pop();
  }
  let m = e.made.find((q) => q.key === key);
  if (!m) {
    const t0 = performance.now();
    m = { key, model: fn(e.px, e.w, e.h, !!mask) };
    e.made.unshift(m);
    if (e.made.length > MODELS_KEEP) e.made.pop();
    pxTime("photo worked by the look", t0);
  } else if (e.made[0] !== m) { e.made.splice(e.made.indexOf(m), 1); e.made.unshift(m); }
  return m.model;
}
const treated = new WeakMap(), TREATED_KEEP = 3;   // the photo (or its blurred copy) worked on by a look, per picture: the last few (TREATED_KEEP) for previews, as many for export, newest first
/** The copies of `im` worked on by a look (see treatedOf), for previews or for export: [{ cv, key }], newest first. */
const treatedList = (im, hi) => { const s = treated.get(im) || {}; treated.set(im, s); return s[hi ? "hi" : "lo"] || (s[hi ? "hi" : "lo"] = []); };
/** Whether the copy of `im` worked on for `key` is kept (see treatedOf). */
const holds = (im, hi, key) => { const s = treated.get(im), l = s && s[hi ? "hi" : "lo"]; return !!l && l.some((e) => e.key === key); };
/**
 * A copy of `src` with its pixels worked on by fn(RGBA data, width, height, src) — a look recolouring the photo, or painting it over,
 * which may look at `src` itself (the photo, or its blurred copy) the same whatever size the copy is made at — computed once
 * on a canvas in memory and kept, the last few for a picture (a photo at two blurs, a background and a print of
 * it, each its own) until the photo goes: done once, where reading the whole canvas back from the graphics card
 * would cost every redraw.
 */
function treatedOf(src, im, key, hi, fn) {
  const list = treatedList(im, hi), at = list.findIndex((e) => e.key === key);
  if (at >= 0) { const e = list[at]; if (at) { list.splice(at, 1); list.unshift(e); } return e.cv; }   // the newest again
  const cap = hi ? 2400 : 1100, sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height, f = Math.min(1, cap / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
  const t0 = performance.now(), e = list.length >= TREATED_KEEP ? list.pop() : { cv: document.createElement("canvas") }, c = e.cv;   // the least lately used one's canvas, filled again
  c.width = w; c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high";
  x.drawImage(src, 0, 0, w, h);
  const id = x.getImageData(0, 0, w, h);
  fn(id.data, w, h, src);
  x.putImageData(id, 0, 0);
  e.key = key; c.filled = (c.filled || 0) + 1; list.unshift(e);
  pxTime("photo worked by the look", t0);
  return c;
}
