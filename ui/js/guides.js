// The layout guide: columns, rows or a grid laid over the editor's canvas to line things up by, as Figma's layout
// guides are. Only seen in the editor: never painted on a cover, a thumbnail or an export. Kept on this computer
// (settings.guide, see normalizeSettings in store.js), for every profile and every size; its numbers are the cover's
// own pixels, as a frame's are in Figma, so 20 px of gutter is 20 of the size's pixels whatever size is shown.
// Pure functions, no DOM: what a guide is (normalizeGuide, newGuide), where its columns, rows or lines fall on a cover
// of w × h pixels (guideSpans, gridLines), where a layer dragged comes to rest by them (snapTargets, snapAxis), and how
// they are painted on a canvas of their own (paintGuides): laid over the cover, but cut away where the layers above
// its ground paint, so it shows over the ground and under every other layer.

import { DEFAULTS } from "./defaults.js";

/** What a guide lays down: columns (across), rows (down), or a grid of square cells. */
export const GUIDE_KINDS = ["columns", "rows", "grid"];
/**
 * Where columns (rows) stand: stretched across the cover, the margin at either side and the width worked out
 * (Figma's Stretch, width Auto); or each of a width of its own, from the left (top), centred, or from the right
 * (bottom), the margin then the offset from that side.
 */
export const GUIDE_ALIGNS = ["stretch", "start", "center", "end"];
/** How many guides at most, one over another. */
export const GUIDES_MOST = 8;
/** Each number's range: count of columns or rows; width, margin (offset), gutter and grid size in the cover's pixels. */
export const GUIDE_LIMITS = { count: [1, 48], width: [1, 4000], margin: [0, 4000], gutter: [0, 2000], size: [2, 2000] };
/** How near (in pixels of the screen) a dragged layer's edge or centre has to come to a guide's to rest on it. */
export const SNAP_PX = 6;
/** A guide as the app ships one when defaults.json says nothing of it (layout.guide there): Figma's columns, six of them. */
const BUILT_IN = { kind: "columns", count: 6, align: "stretch", width: 100, margin: 0, gutter: 20, size: 10, color: "#FF0000", opacity: 0.1 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const HEX = /^#[0-9a-f]{6}$/i;
/** A number of `raw` held to [lo, hi], whole when `whole`; `d` when it is none. */
function numIn(raw, [lo, hi], d, whole = true) {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return d;
  const v = clamp(n, lo, hi);
  return whole ? Math.round(v) : v;
}

/** One guide with every field there and within range, its fields of `d` where `raw` has none of its own (or one not of its kind). */
export function normalizeGuide(raw, d = BUILT_IN) {
  const g = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const L = GUIDE_LIMITS, pick = (v, list, dv) => (list.includes(v) ? v : dv);
  const color = typeof g.color === "string" && HEX.test(g.color.trim()) ? g.color.trim().toUpperCase() : d.color;
  return {
    kind: pick(g.kind, GUIDE_KINDS, d.kind),
    count: numIn(g.count, L.count, d.count),
    align: pick(g.align, GUIDE_ALIGNS, d.align),
    width: numIn(g.width, L.width, d.width),
    margin: numIn(g.margin, L.margin, d.margin),
    gutter: numIn(g.gutter, L.gutter, d.gutter),
    size: numIn(g.size, L.size, d.size),
    color,
    opacity: Math.round(numIn(g.opacity, [0, 1], d.opacity, false) * 100) / 100,
    shown: g.shown !== false,   // its eye: hidden, it stays in the list
  };
}
/** What a new guide is: defaults.json's (layout.guide), held to range, over the built-in one. */
export const guideDefaults = () => normalizeGuide(DEFAULTS.layout && DEFAULTS.layout.guide, normalizeGuide(BUILT_IN));
/** A new guide, shown. */
export const newGuide = () => ({ ...guideDefaults(), shown: true });
/**
 * settings.guide as kept: {on, list}, `on` whether the guide is shown over the canvas (⌃G) and `list` the guides, at
 * most GUIDES_MOST. Shown with no guide to show it is not on (turned on again, it starts with a new one: see the app).
 */
export function normalizeGuides(raw) {
  const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}, d = guideDefaults();
  const list = (Array.isArray(s.list) ? s.list : []).slice(0, GUIDES_MOST).map((g) => normalizeGuide(g, d));
  return { on: s.on === true && list.length > 0, list };
}

/** The width of each column (height of each row) a stretched guide gives along `len` pixels: what is left of it after the margins and gutters, shared (0 where nothing is left). */
export const autoWidth = (g, len) => Math.max(0, (len - 2 * g.margin - (g.count - 1) * g.gutter) / g.count);
/**
 * Where the columns (rows) of guide `g` lie along a side of `len` pixels: [from, to] each, left to right (top to
 * bottom), the part on the cover of each one that reaches it; none where they have no width.
 */
export function guideSpans(g, len) {
  const n = g.count, gut = g.gutter;
  let w = g.width, x0;
  if (g.align === "stretch") { w = autoWidth(g, len); x0 = g.margin; }
  else {
    const all = n * w + (n - 1) * gut;
    x0 = g.align === "start" ? g.margin : g.align === "end" ? len - g.margin - all : (len - all) / 2;
  }
  const out = [];
  if (!(w > 0)) return out;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, x0 + i * (w + gut)), b = Math.min(len, x0 + i * (w + gut) + w);
    if (b > a) out.push([a, b]);
  }
  return out;
}
/** The lines of a grid of `size` along a side of `len` pixels: 0, size, 2 × size… up to `len` (a few thousand at most). */
export function gridLines(size, len) {
  const out = [];
  if (!(size > 0)) return out;
  for (let i = 0, x = 0; x <= len + 1e-6 && i < 5000; i++, x = i * size) out.push(x);
  return out;
}

/**
 * What a dragged layer may come to rest on, along each axis, from the guides of `list` that are shown, on a cover of
 * w × h pixels, in units of `fx` (`fy`) to its pixel (the canvas's virtual ones, see virtualSize in layout.js):
 * {x: {edge, mid}, y: {edge, mid}}, `edge` the columns' (rows') sides and the grid's lines, which an edge or the
 * centre of the layer rests on, and `mid` the columns' (rows') middles, which its centre does. A grid of cells under
 * `cellMin` pixels of the cover is not drawn (see paintGuides), and nothing rests on it either.
 */
export function snapTargets(list, w, h, fx = 1, fy = 1, cellMin = 0) {
  const x = { edge: [], mid: [] }, y = { edge: [], mid: [] };
  for (const g of list || []) {
    if (!g.shown) continue;
    if (g.kind === "grid") {
      if (g.size < cellMin) continue;
      for (const v of gridLines(g.size, w)) x.edge.push(v * fx);
      for (const v of gridLines(g.size, h)) y.edge.push(v * fy);
      continue;
    }
    const [axis, len, f] = g.kind === "columns" ? [x, w, fx] : [y, h, fy];
    for (const [a, b] of guideSpans(g, len)) { axis.edge.push(a * f, b * f); axis.mid.push(((a + b) / 2) * f); }
  }
  return { x, y };
}
/**
 * A drag along one axis by `d`, of a layer that spanned lo…hi as it began, brought to rest on what `t` has (one axis of
 * snapTargets) where its near edge, far edge or centre comes within `tol` of it — the nearest of them — or left as it
 * is: {d, at}, the move and the line it rests on (null for none).
 */
export function snapAxis(lo, hi, d, t, tol) {
  let best = null;
  const near = (anchor, list) => {
    for (const v of list) { const e = v - anchor; if (Math.abs(e) <= tol && (!best || Math.abs(e) < Math.abs(best.e))) best = { e, at: v }; }
  };
  const mid = (lo + hi) / 2 + d;
  near(lo + d, t.edge); near(hi + d, t.edge); near(mid, t.edge); near(mid, t.mid);
  return best ? { d: d + best.e, at: best.at } : { d, at: null };
}

/** `hex` (#RRGGBB) at `alpha`, as a canvas takes a colour. */
function rgba(hex, alpha) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
/** A grid finer than this many pixels of the screen a cell is not painted (nor snapped to): as in Figma zoomed out, it would only grey the cover. */
export const GRID_FINEST = 4;
/**
 * Paints the guides of `list` that are shown over the whole of `ctx`'s canvas, W × H device pixels standing for a cover
 * of w × h: columns and rows as bands of their colour, a grid as lines one device pixel wide, each guide over the one
 * before it (where they overlap, as in Figma, they add up). Then, given `under` (a canvas or image laid over the whole
 * of it: the layers above the cover's ground painted alone), the guides are cut away wherever it paints, as much as it
 * does, so they lie under those layers and show only over the ground (and through what is see-through). Then `hot`,
 * the lines a drag has come to rest on ({x: [], y: []} in the cover's pixels), over all of it, at full strength in the
 * colour of the first guide shown, a pixel of the screen wide (`dpr` device pixels).
 */
export function paintGuides(ctx, list, w, h, W, H, hot = null, dpr = 1, under = null) {
  ctx.clearRect(0, 0, W, H);
  const kx = W / w, ky = H / h, shown = (list || []).filter((g) => g.shown);
  let painted = false;
  for (const g of shown) {
    ctx.fillStyle = rgba(g.color, g.opacity);
    if (g.kind === "grid") {
      if ((g.size * Math.min(kx, ky)) / dpr < GRID_FINEST) continue;
      for (const v of gridLines(g.size, w)) ctx.fillRect(Math.min(W - 1, Math.round(v * kx)), 0, 1, H);
      for (const v of gridLines(g.size, h)) ctx.fillRect(0, Math.min(H - 1, Math.round(v * ky)), W, 1);
      painted = true;
      continue;
    }
    const across = g.kind === "columns", k = across ? kx : ky;
    for (const [a, b] of guideSpans(g, across ? w : h)) {
      const p = Math.round(a * k), q = Math.max(p + 1, Math.round(b * k));   // whole device pixels: crisp edges, and never thinner than one
      if (across) ctx.fillRect(p, 0, q - p, H); else ctx.fillRect(0, p, W, q - p);
      painted = true;
    }
  }
  if (painted && under) { ctx.globalCompositeOperation = "destination-out"; ctx.drawImage(under, 0, 0, W, H); ctx.globalCompositeOperation = "source-over"; }
  if (!hot || !shown.length) return;
  const lw = Math.max(1, Math.round(dpr)), at = (v, k, n) => clamp(Math.round(v * k - lw / 2), 0, n - lw);
  ctx.fillStyle = rgba(shown[0].color, 0.9);
  for (const v of hot.x || []) ctx.fillRect(at(v, kx, W), 0, lw, H);
  for (const v of hot.y || []) ctx.fillRect(0, at(v, ky, H), W, lw);
}
