// wasteland: a quiet end of the world, painted
// The digital concept paintings of a silent wasteland after the end: loose flat strokes laid with a
// broad brush and a palette knife, nothing outlined, edges lost in haze; layered silhouettes of ruined
// blocks, a megastructure and a dead forest fading into mist, power poles with sagging wires, a plume of
// smoke, wet ground holding the sky, scattered paper; a tiny figure against it all; muted, harmonious
// grounds and one hot accent, a low sun. Dusk in olive and teal under a blood-red sun, or a misty
// snowfield in cold blue-white with an orange one. A photo is painted over in strokes of its own colours.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, boost, canPaint, clamp, css, dark, dkBox, dkWork, every, fall, fast, fxCanvas, grain, grey, gridPath, gridPen, inPixels, layDown, lum, mapped, mix, noise, objAt, openField, painters, parseColour, rand, region, role, seed, titleArea, toneTable, upright, values, vignette, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { inPiece } from "../title.js";

const WL = {
  dark: {
    sky: [[12, 26, 26], [24, 44, 40], [62, 82, 64], [176, 144, 96]], haze: [124, 122, 90], earth: [[70, 76, 56], [15, 21, 18]], near: [13, 19, 17],
    cloud: [[86, 76, 94], [150, 112, 124], [232, 168, 140]], sun: [212, 44, 32], hot: [255, 150, 90], text: [238, 228, 206], ink: [16, 18, 18], paper: [206, 196, 172],
  },
  light: {
    sky: [[118, 136, 160], [162, 178, 196], [206, 212, 220], [242, 234, 224]], haze: [228, 230, 232], earth: [[222, 228, 234], [142, 156, 176]], near: [26, 34, 46],
    cloud: [[150, 146, 174], [204, 188, 204], [250, 236, 228]], sun: [240, 92, 26], hot: [255, 168, 98], text: [32, 38, 48], ink: [24, 30, 38], paper: [246, 244, 236],
  },
};
const wl = () => (dark ? WL.dark : WL.light);
/** The one hot accent — the sun, the fire, the highlighted words: the look's red (orange on the snow), turned by `chan` toward the channel colour. */
export const wlHot = (C, p = values) => mix(wl().sun, boost(C || wl().sun, 0.6), clamp((p && p.chan) || 0));
/**
 * The colour block: the channel colour as a wall painted long ago in the foreground, greyed and sunk toward
 * the ground's earth (the dusk's olive, the snow's slate), its value brought into a narrow band about the
 * middle — dark enough to stand in front of the scene, light enough for ink.
 */
export function wlBlock(C) {
  const c = mix(mix(C, grey(C), dark ? 0.5 : 0.6), dark ? [84, 84, 62] : [96, 108, 124], 0.34), l = lum(c), t = dark ? 0.31 : 0.36;
  if (Math.abs(l - t) <= 0.04) return c;
  const to = l < t ? (dark ? [214, 202, 172] : [214, 220, 228]) : dark ? [28, 30, 26] : [34, 42, 54], goal = l < t ? t - 0.04 : t + 0.04;
  let lo = 0, hi = 1;
  for (let i = 0; i < 12; i++) { const m = (lo + hi) / 2; if ((lum(mix(c, to, m)) - goal) * (l < t ? 1 : -1) < 0) lo = m; else hi = m; }
  return mix(c, to, hi);
}
/**
 * The block's surface, painted (and kept, see wlKept) in `box`: a coat of the colour laid in broad strokes
 * along its edge, each mixed afresh, a step lighter or darker, warmer or cooler; patches where the paint has
 * flaked to the bare concrete; grime run down from its top and splashed up at its foot; the light from
 * above on its upper part, its lower part in shade; the brush's hairs through it all.
 */
function wlBoard(ctx, B, nx, ny, c) {
  const W = wl(), side = Math.abs(nx) > 0.5, along = side ? B.h : B.w, across = side ? B.w : B.h, b1 = wlBatch(), b2 = wlBatch(), b3 = wlBatch();
  const at = (u, v) => (side ? [B.x + v, B.y + u] : [B.x + u, B.y + v]), dir = (k) => (side ? (rand(k) < 0.5 ? Math.PI / 2 : -Math.PI / 2) : rand(k) < 0.5 ? 0 : Math.PI);
  const bare = mix(mix(grey(c), dark ? [92, 90, 78] : [112, 120, 130], 0.5), c, 0.4), grime = mix(c, W.near, 0.55), u0 = Math.min(along, across);
  ctx.fillStyle = css(c); ctx.fillRect(B.x, B.y, B.w, B.h);
  for (let i = 0, n = Math.round(40 + (along / Math.max(1, across)) * 6); i < Math.min(n, 140); i++) {   // the coat, stroke by stroke
    const k = 5000 + i * 7.1, len = along * (0.1 + rand(k) * 0.28), th = Math.min(across * (0.12 + rand(k + 1) * 0.2), u0 * 0.5), a = dir(k + 2), u = -len * 0.2 + (along + len * 0.2) * rand(k + 3), v = across * rand(k + 4), [x, y] = at(a === 0 || a === Math.PI / 2 ? u : u + len, v);
    b1.add(wlBreak(c, rand(k + 5), rand(k + 6), side ? 0.05 : 0.09, side ? 4 : 7), 0.92, (q) => wlStroke(q, x, y, len, th, a + (rand(k + 7) - 0.5) * 0.03, k + 8));
  }
  for (let i = 0, n = side ? 0 : 6; i < n; i++) {   // flaked to the concrete, mostly near its top: a few short strokes together, a darker lip of paint along one side (none on a tall side panel, where they would read as blotches)
    const k = 5800 + i * 13.3, pu = along * rand(k), pv = across * rand(k + 1) ** 2 * 0.8, r = u0 * (0.05 + rand(k + 2) * 0.08);
    for (let j = 0; j < 4; j++) {
      const len = r * (1 + rand(k + j * 1.7 + 3) * 1.5), th = r * (0.25 + rand(k + j * 2.1 + 4) * 0.3), [x, y] = at(pu + (rand(k + j * 2.7 + 5) - 0.5) * r * 1.5, pv + (rand(k + j * 3.1 + 6) - 0.5) * r * 0.8), a = dir(k + j + 7);
      b2.add(mix(c, W.near, 0.3), 0.5, (q) => wlStroke(q, x + 2, y + 2.5, len, th, a, k + j * 9 + 8));
      b3.add(wlBreak(bare, rand(k + j * 3.7 + 9), rand(k + j * 4.1 + 10), 0.08, 4), 0.9, (q) => wlStroke(q, x, y, len, th, a, k + j * 9 + 8));
    }
  }
  b1.fill(ctx); b2.fill(ctx); b3.fill(ctx);
  for (let i = 0, n = side ? 16 : 34; i < n; i++) {   // grime run down from the top, and splashed up at the foot
    const k = 6000 + i * 5.9, x = B.x + B.w * rand(k), top = rand(k + 1) < 0.65, l = B.h * (top ? 0.12 + rand(k + 2) ** 1.5 * 0.6 : 0.08 + rand(k + 2) * 0.18), w = 1.5 + rand(k + 3) * (top ? 5 : 10);
    b1.add(wlStep(grime, rand(k + 4), 1, 0.08), top ? 0.16 + rand(k + 5) * 0.14 : 0.22, (q) => (top ? wlTaper(q, x, B.y - 2, x + (rand(k + 6) - 0.5) * 4, B.y + l, w, w * 0.2) : wlTaper(q, x, B.y + B.h + 2, x + (rand(k + 6) - 0.5) * 20, B.y + B.h - l, w, w * 0.3)));
  }
  b1.fill(ctx);
  const g = ctx.createLinearGradient(0, B.y, 0, B.y + B.h);   // the light from above, the foot in shade
  g.addColorStop(0, css(mix(W.hot, [255, 244, 224], 0.5), dark ? 0.1 : 0.08)); g.addColorStop(0.3, css(W.hot, 0)); g.addColorStop(0.55, css(W.near, 0)); g.addColorStop(1, css(W.near, dark ? 0.34 : 0.22));
  ctx.fillStyle = g; ctx.fillRect(B.x, B.y, B.w, B.h);
  if (side) {   // a panel beside the scene: lit along the edge toward it, in shade away from it
    const e0 = nx < 0 ? B.x : B.x + B.w, e1 = nx < 0 ? B.x + B.w : B.x, h2 = ctx.createLinearGradient(e0, 0, e1, 0);
    h2.addColorStop(0, css(mix(W.hot, [255, 244, 224], 0.4), dark ? 0.16 : 0.12)); h2.addColorStop(0.2, css(W.hot, 0)); h2.addColorStop(0.55, css(W.near, 0)); h2.addColorStop(1, css(W.near, dark ? 0.32 : 0.22));
    ctx.fillStyle = h2; ctx.fillRect(B.x, B.y, B.w, B.h);
  }
  wlHairs(ctx, B, side ? Math.PI / 2 : 0, u0 * 0.45, 0.1, 0.14);
}
/**
 * Where the scene stands: the open field, its horizon, the side the title leaves free for the sun (`side`
 * 1: the right); at(t), a place across the field from the title's side; free(t), one across the room the
 * title leaves beside it (the whole field less a margin, when the title spans it), where the sun, the
 * megastructure and the figure stand; below(x, y, r), y moved down clear of the title (and the subtitle)
 * when something r across at (x, y) would stand behind it.
 */
function wlPlan(ctx, env) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), H = F.y0 + fh * ((fw > fh * 1.2 ? 0.64 : fh > fw * 1.2 ? 0.74 : 0.64) + (rand(4998) - 0.5) * 0.08);   // a little higher or lower by the seed
  const T = canPaint(ctx) ? titleArea(ctx, env) : null, right = !T || T.x + T.w / 2 < env.w * 0.55, at = (t) => (right ? F.x0 + fw * t : F.x1 - fw * t);
  const edge = T ? (right ? T.x + T.w - F.x0 : F.x1 - T.x) / fw : 0, room = edge < 0.72 ? clamp(edge, 0, 0.6) : 0.25;
  const below = (x, y, r) => (T && x + r > T.x && x - r < T.x + T.w && y - r < T.y + T.h ? Math.max(y, T.y + T.h + r * 1.15) : y);
  return { F, fw, fh, u, H, side: right ? 1 : -1, at, free: (t) => at(room + (1 - room) * t), below };
}
/** The sky's colour at height y: dark overhead, lightening down to the glow along the horizon. */
function wlSkyAt(P, y) {
  const s = wl().sky, t = clamp((y - P.F.y0) / Math.max(1, P.H - P.F.y0));
  return t < 0.42 ? mix(s[0], s[1], t / 0.42) : t < 0.8 ? mix(s[1], s[2], (t - 0.42) / 0.38) : mix(s[2], s[3], (t - 0.8) / 0.2);
}
/** What stands at height y, `depth` away (0: here, 1: as far as the sky): the near dark, gone over to the sky's colour there as it recedes. */
const wlTone = (P, y, depth) => mix(wl().near, wlSkyAt(P, y), depth);
/** A fill for a silhouette from `top` down to `base`, `depth` away: the sky's colour a shade darker at each height, its foot lost in the haze. */
function wlDepthFill(ctx, P, top, base, depth) {
  const g = ctx.createLinearGradient(0, top, 0, base);
  for (const t of [0, 0.35, 0.62]) g.addColorStop(t, css(wlTone(P, top + (base - top) * t, depth)));
  g.addColorStop(0.82, css(mix(wlTone(P, base, depth), wl().haze, 0.2 + 0.3 * depth))); g.addColorStop(1, css(mix(wlTone(P, base, depth), wl().haze, 0.55 + 0.35 * depth)));
  return g;
}
/**
 * Adds to the current path a flat stroke of a broad brush or a palette knife: a band `len` long and `th`
 * thick from (x, y) along angle `a`, its edges a little uneven, its far end cut on a slant (`cut`: how far
 * the slant runs back along it, in thicknesses, the other way when below 0, square at 0). k: its own randoms.
 */
function wlKnife(ctx, x, y, len, th, a, k, cut = 0.7) {
  const c = Math.cos(a), s = Math.sin(a), j = (q) => (rand(k + q * 1.37) - 0.5) * th * 0.45, h = th / 2;
  const pt = (t, n) => ctx.lineTo(x + c * t - s * n, y + s * t + c * n);
  ctx.moveTo(x - s * (-h + j(1)), y + c * (-h + j(1)));
  pt(len * 0.5, -h + j(2)); pt(len - Math.max(0, -cut) * th, (cut > 0 ? -h * 0.7 : -h) + j(3)); pt(len - Math.max(0, cut) * th, h + j(4)); pt(len * 0.45, h + j(5)); pt(th * 0.25, h * 0.8 + j(6));
  ctx.closePath();
}
/** Adds to the current path a dab: a rounded blob `r` across, its edge uneven, `sq` as high as wide, turned by `a` (a smooth curve through nine points at uneven distances). */
function wlDab(ctx, x, y, r, sq, a, k) {
  const c = Math.cos(a), s = Math.sin(a), q = [];
  for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU, rr = r * (0.8 + rand(k + i * 1.31) * 0.4), px = Math.cos(t) * rr, py = Math.sin(t) * rr * sq; q.push([x + c * px - s * py, y + s * px + c * py]); }
  const mid = (i) => [(q[i % 9][0] + q[(i + 1) % 9][0]) / 2, (q[i % 9][1] + q[(i + 1) % 9][1]) / 2];
  ctx.moveTo(...mid(8));
  for (let i = 0; i < 9; i++) ctx.quadraticCurveTo(q[i][0], q[i][1], ...mid(i));
  ctx.closePath();
}
/**
 * Adds to the current path a tapering stroke from (x0, y0) to (x1, y1), w0 wide at its foot and w1 at its tip,
 * bowed by `bend` (a share of its length). Wound as a rectangle is (as are the knife, the dab and the rest), so
 * strokes overlapping in one path fill each other rather than cut holes.
 */
function wlTaper(ctx, x0, y0, x1, y1, w0, w1, bend = 0) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, mx = (x0 + x1) / 2 + nx * L * bend, my = (y0 + y1) / 2 + ny * L * bend, wm = (w0 + w1) / 4;
  ctx.moveTo(x0 - (nx * w0) / 2, y0 - (ny * w0) / 2); ctx.quadraticCurveTo(mx - nx * wm, my - ny * wm, x1 - (nx * w1) / 2, y1 - (ny * w1) / 2);
  ctx.lineTo(x1 + (nx * w1) / 2, y1 + (ny * w1) / 2); ctx.quadraticCurveTo(mx + nx * wm, my + ny * wm, x0 + (nx * w0) / 2, y0 + (ny * w0) / 2); ctx.closePath();
}
/** Strokes gathered by colour, so thousands of them are a few dozen fills: add(colour, alpha, fn) keeps fn(ctx) (which adds to a path) for fill(ctx). */
function wlBatch() {
  const m = new Map();
  return {
    add(c, a, fn) { const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.round(a * 50) / 50}`; (m.get(key) || m.set(key, []).get(key)).push(fn); },
    fill(ctx) { for (const [key, list] of m) { ctx.fillStyle = `rgba(${key})`; ctx.beginPath(); for (const f of list) f(ctx); ctx.fill(); } m.clear(); },
  };
}
/** A colour a step lighter or darker, by one of `n` steps either side of it (so strokes fall into a few batches). */
const wlStep = (c, r, n = 2, d = 0.035) => { const v = 1 + Math.round((r - 0.5) * 2 * n) * d; return [c[0] * v, c[1] * v, c[2] * v]; };
/** A colour broken as a painter mixes it afresh for each stroke: up to `v` lighter or darker and a step of `t` warmer or cooler, by randoms r and q (in steps, so strokes still batch). */
const wlBreak = (c, r, q, v = 0.05, t = 6) => { const s = 1 + Math.round((r - 0.5) * 4.99) * v * 0.5, w = Math.round((q - 0.5) * 2.99) * t; return [c[0] * s + w, c[1] * s + w * 0.25, c[2] * s - w]; };
/**
 * Adds to the current path a stroke of a loaded flat brush: a band `len` long and `th` thick from (x, y)
 * along angle `a`, its sides wavering, its head blunt, its tail running dry into two or three ragged
 * fingers. Wound as a rectangle is. k: its own randoms.
 */
function wlStroke(ctx, x, y, len, th, a, k) {
  const c = Math.cos(a), s = Math.sin(a), h = th / 2, wv = (q) => (rand(k + q * 1.37) - 0.5) * th * 0.2, f = 2 + Math.floor(rand(k + 9) * 2), tail = len - Math.min(len * 0.3, th * (0.6 + rand(k + 8) * 0.8));
  const pt = (t, n) => ctx.lineTo(x + c * t - s * n, y + s * t + c * n);
  ctx.moveTo(x + c * len * 0.02 + s * h * 0.75, y + s * len * 0.02 - c * h * 0.75);
  for (let i = 1; i <= 3; i++) pt((tail * i) / 3, -h + wv(i));   // the top side
  for (let j = 0; j < f; j++) { const n1 = -h + (2 * h * (j + 1)) / f; pt(tail + (len - tail) * (0.6 + rand(k + 10 + j) * 0.4), n1 - (h / f) * (1.1 + rand(k + 13 + j) * 0.5)); if (j < f - 1) pt(tail + (len - tail) * rand(k + 16 + j) * 0.35, n1 + wv(17 + j)); }   // the dry tail
  for (let i = 3; i >= 1; i--) pt((tail * i) / 3, h + wv(i + 5));   // the bottom side
  pt(len * 0.02, h * 0.75); pt(-th * 0.08, 0);
  ctx.closePath();
}
/** A tile of a brush's hairs (see wlBristles), dark on clear: kept. */
function wlBristlesDark() {
  if (WORK.wlBristlesK) return WORK.wlBristlesK;
  const c = (WORK.wlBristlesK = document.createElement("canvas")); c.width = 512; c.height = 128;
  const x = c.getContext("2d"), R = wlRng(4713);
  x.lineCap = "round";
  for (let i = 0; i < 90; i++) {
    const y = R() * 128, x0 = R() * 512, len = 30 + R() ** 2 * 320, lw = 0.6 + R() ** 3 * 4;
    x.strokeStyle = `rgba(0,0,0,${0.25 + R() * 0.7})`; x.lineWidth = lw;
    for (const dx of [0, -512, 512]) { x.beginPath(); x.moveTo(x0 + dx, y); x.lineTo(x0 + dx + len, y + (R() - 0.5) * 3); x.stroke(); }
  }
  return c;
}
/** The brush's hairs in what is painted on ctx within `box`: streaks a little lighter (alpha `lt`) and darker (`dk`) running along angle `a`, the tile `span` units across; laid only onto paint (source-atop). */
function wlHairs(ctx, box, a, span, lt, dk) {
  if (!canPaint(ctx)) return;
  ctx.save(); ctx.globalCompositeOperation = "source-atop";
  for (const [tile, al] of [[wlBristles(), lt], [wlBristlesDark(), dk]]) {
    if (al <= 0) continue;
    const pat = ctx.createPattern(tile, "repeat");
    if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().rotate((a * 180) / Math.PI).scale(span / tile.height));
    ctx.globalAlpha = al; ctx.fillStyle = pat; ctx.fillRect(box.x, box.y, box.w, box.h);
  }
  ctx.restore();
}
/** Points along the polyline `pts` every `step`: [x, y, tx, ty], with the unit tangent there, smoothed over the points either side (so a jagged line is followed in its run). */
function wlAlong(pts, step) {
  const out = [];
  let d = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0);
    if (!L) continue;
    for (; d < L; d += step) out.push([x0 + ((x1 - x0) * d) / L, y0 + ((y1 - y0) * d) / L, (x1 - x0) / L, (y1 - y0) / L]);
    d -= L;
  }
  return out.map(([x, y], i) => { let tx = 0, ty = 0; for (let j = Math.max(0, i - 2); j <= Math.min(out.length - 1, i + 2); j++) { tx += out[j][2]; ty += out[j][3]; } const m = Math.hypot(tx, ty) || 1; return [x, y, tx / m, ty / m]; });
}
/** Paints paint(x) at a `f`th of ctx's pixels and lays it on enlarged: soft-edged, as paint wet into wet, for a fraction of the pixels. */
function wlSoftly(ctx, f, paint, slot = "wlSoftly") {
  if (!canPaint(ctx)) return paint(ctx);
  const cv = ctx.canvas, m = ctx.getTransform(), s = WORK[slot] || (WORK[slot] = document.createElement("canvas")), sw = Math.max(1, Math.ceil(cv.width / f)), sh = Math.max(1, Math.ceil(cv.height / f));
  if (s.width !== sw || s.height !== sh) { s.width = sw; s.height = sh; }
  const x = s.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, sw, sh); x.setTransform(m.a / f, m.b / f, m.c / f, m.d / f, m.e / f, m.f / f);
  paint(x);
  inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(s, 0, 0, sw * f, sh * f); });
  wlLetGo(ctx, slot);
}
/** How many canvas sizes a part is kept for at once (see wlKept: the editor's, still and in a draft, and the size thumbnails'); the sizes of canvases on the page seen lately, and the largest of them. */
const WL_KEEP = 6, WL_SEEN = new Set();
let wlLargest = 0;
/**
 * Whether what is painted on canvas cv is worth keeping: a canvas on the page (the editor, a size's
 * thumbnail), or one the size of one (a draft's runs, painted off the page at the editor's size). An
 * export's canvas is painted once: its parts are not kept, and the work canvases its size needed are let go.
 */
function wlKeeps(cv) {
  const s = `${cv.width}x${cv.height}`;
  if (cv.isConnected) {
    if (!WL_SEEN.has(s)) { WL_SEEN.add(s); if (WL_SEEN.size > 12) WL_SEEN.delete(WL_SEEN.values().next().value); }
    wlLargest = Math.max(wlLargest, cv.width * cv.height);
    return true;
  }
  return WL_SEEN.has(s);
}
/** Lets the work canvases WORK[slot]… go when they were sized for ctx's canvas and it is larger than any canvas on the page (an export's). */
function wlLetGo(ctx, ...slots) {
  if (!canPaint(ctx) || ctx.canvas.width * ctx.canvas.height <= wlLargest) return;
  for (const k of slots) if (WORK[k]) WORK[k].width = WORK[k].height = 0;
}
/** Lets everything the wasteland keeps go: its parts, its work canvases and tiles, the strokes effect's last results (as the look is left). */
function wlFreeAll() {
  for (const k of Object.keys(WORK)) {
    if (!k.startsWith("wl")) continue;
    const v = WORK[k];
    if (v instanceof Map) for (const e of v.values()) { if (e.c) e.c.width = e.c.height = 0; }
    else if (v && "width" in v) v.width = v.height = 0;
    delete WORK[k];
  }
  WL_FX.clear(); WL_STROKES = new WeakMap();
}
/** What the wasteland keeps, in bytes (for checks of memory). */
export function wlMemory() {
  let n = 0;
  for (const k of Object.keys(WORK)) {
    if (!k.startsWith("wl")) continue;
    const v = WORK[k];
    if (v instanceof Map) for (const e of v.values()) n += e.c ? e.c.width * e.c.height * 4 : 0;
    else if (v && "width" in v) n += v.width * v.height * 4;
  }
  for (const v of WL_FX.values()) n += v.length;
  return n;
}
/** The strokes effect's last few results (see wasteland.elementFx), by what they were painted from: at most WL_FX_KEEP's count and bytes. */
const WL_FX = new Map(), WL_FX_KEEP = [8, 16e6];
/**
 * A part of the scene painted once and kept (see keptLayer), on a canvas that covers only `box` (ctx's
 * units: { x, y, w, h }), so a part lying in a band costs only that band to keep and to lay down; it may
 * reach past the canvas (`free`), for a part that is dragged and laid down moved. Kept for a few canvas
 * sizes at once (WL_KEEP), the least lately used let go first, never the largest (the editor's); only for a
 * canvas worth keeping (see wlKeeps) — an export's is painted on a canvas of the box once and let go after
 * (`once`). paint(x, true) paints on the part's own canvas. Returns { c, x, y, once }: the canvas and where
 * its corner lies on ctx's canvas, in pixels; or null, to paint straight onto ctx (no canvas).
 */
function wlKept(ctx, slot, key, box, paint, free = false) {
  if (!canPaint(ctx)) return null;
  const cv = ctx.canvas, m = ctx.getTransform();
  const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
  let X0 = Math.floor(Math.min(...pts.map((q) => q[0]))), Y0 = Math.floor(Math.min(...pts.map((q) => q[1]))), X1 = Math.ceil(Math.max(...pts.map((q) => q[0]))), Y1 = Math.ceil(Math.max(...pts.map((q) => q[1])));
  if (!free) { X0 = Math.max(0, X0); Y0 = Math.max(0, Y0); X1 = Math.min(cv.width, X1); Y1 = Math.min(cv.height, Y1); }
  if (X1 - X0 < 1 || Y1 - Y0 < 1 || (X1 - X0) * (Y1 - Y0) > 4e7) return null;
  const size = `${cv.width}x${cv.height}`, full = `${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join()}|${X0},${Y0},${X1},${Y1}|${key}`;
  let e;
  if (wlKeeps(cv)) {
    const kept = WORK[slot] || (WORK[slot] = new Map());
    e = kept.get(size);
    if (e) { kept.delete(size); kept.set(size, e); if (e.key === full) return { c: e.c, x: X0, y: Y0, once: false }; }   // the newest again
    else {
      e = { c: document.createElement("canvas"), key: null, area: cv.width * cv.height }; kept.set(size, e);
      while (kept.size > WL_KEEP) {   // let the least lately used go, not the largest
        const big = Math.max(...[...kept.values()].map((q) => q.area)), [s0, q] = [...kept].find(([, q]) => q !== e && q.area < big) || [...kept].find(([, q]) => q !== e);
        q.c.width = q.c.height = 0; kept.delete(s0);
      }
    }
  } else e = { c: WORK.wlOnce || (WORK.wlOnce = document.createElement("canvas")), key: null, once: true };
  if (e.c.width !== X1 - X0 || e.c.height !== Y1 - Y0) { e.c.width = X1 - X0; e.c.height = Y1 - Y0; }
  const x = e.c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, e.c.width, e.c.height);
  x.setTransform(m.a, m.b, m.c, m.d, m.e - X0, m.f - Y0);
  paint(x, true); e.key = e.once ? null : full;
  return { c: e.c, x: X0, y: Y0, once: !!e.once };
}
/** Paints a part kept by wlKept (or straight onto ctx, paint(ctx, false), when it is not kept), moved by (dx, dy) in ctx's units; `free`: it may be dragged (see wlKept). */
function wlLay(ctx, slot, key, box, paint, dx = 0, dy = 0, free = false) {
  const K = wlKept(ctx, slot, key, box, paint, free);
  if (!K) { ctx.save(); ctx.translate(dx, dy); paint(ctx, false); ctx.restore(); return; }
  const m = ctx.getTransform();
  inPixels(ctx, () => ctx.drawImage(K.c, Math.round(K.x + m.a * dx + m.c * dy), Math.round(K.y + m.b * dx + m.d * dy)));
  if (K.once) K.c.width = K.c.height = 0;   // painted for a canvas not kept: let go
}
/**
 * The ground: the sky down to the horizon and the earth below it, laid in flat strokes of a loaded brush —
 * broad, long and short, overlapping, each mixed afresh from the sky's colour where it lies (a step lighter
 * or darker, warmer or cooler); knife streaks of the glow along the horizon; the earth in level strokes,
 * broad at the foot and thinner and closer toward the horizon as the ground runs away; the brush's hairs
 * through it all.
 */
function wlGround(ctx, env, P) {
  const { w, h } = env, { F, fw, fh, H } = P, W = wl(), sky = W.sky, b = wlBatch(), sh = Math.max(1, H - F.y0), band = sh / 14;
  const g = ctx.createLinearGradient(0, F.y0, 0, H); g.addColorStop(0, css(sky[0])); g.addColorStop(0.42, css(sky[1])); g.addColorStop(0.8, css(sky[2])); g.addColorStop(1, css(sky[3]));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, H + 1);
  const e = ctx.createLinearGradient(0, H, 0, Math.max(H + 1, F.y1)); e.addColorStop(0, css(mix(W.haze, W.earth[0], 0.5))); e.addColorStop(0.2, css(W.earth[0])); e.addColorStop(1, css(W.earth[1]));
  ctx.fillStyle = e; ctx.fillRect(0, H, w, h - H);
  wlSoftly(ctx, 4, (x) => {   // soft masses in the sky, a shade darker or lighter, for the air
    for (let i = 0; i < 7; i++) { const k = 4380 + i * 5.1, y = F.y0 + sh * (0.05 + rand(k) * 0.6), c = wlStep(mix(wlSkyAt(P, y), W.cloud[0], dark ? 0.3 : 0.2), rand(k + 1), 2, 0.06); x.globalAlpha = 0.45; x.fillStyle = css(c); x.beginPath(); x.ellipse(F.x0 + fw * rand(k + 2), y, fw * (0.12 + rand(k + 3) * 0.2), sh * (0.06 + rand(k + 4) * 0.1), (rand(k + 5) - 0.5) * 0.3, 0, TAU); x.fill(); }
    x.globalAlpha = 1;
  }, "wlSkySoft");
  for (let i = 0; i < 150; i++) {   // the sky, stroke over stroke: broad and short, aslant the more the higher
    const k = 4400 + i * 7.7, t = rand(k), y = F.y0 - sh * 0.04 + sh * 1.03 * t, len = fw * (0.06 + rand(k + 1) ** 1.3 * 0.3), th = sh * (0.05 + rand(k + 2) ** 1.4 * 0.15) * (1.1 - t * 0.5), back = rand(k + 3) < 0.5;
    const x = F.x0 - fw * 0.12 + fw * 1.2 * rand(k + 4), c = wlBreak(wlSkyAt(P, Math.round((y + (rand(k + 10) - 0.5) * sh * 0.22) / band) * band), rand(k + 5), rand(k + 6), dark ? 0.16 : 0.06, dark ? 6 : 4);   // the colour of a little higher or lower, so each stroke shows
    b.add(c, 0.8 + rand(k + 7) * 0.2, (q) => wlStroke(q, back ? x + len : x, y, len, th, (back ? Math.PI : 0) + (rand(k + 8) - 0.5) * (0.1 + 0.4 * (1 - t)), k + 9));
  }
  for (let i = 0; i < 24; i++) {   // the glow along the horizon: knife strokes, warm
    const k = 4420 + i * 5.1, t = rand(k) ** 0.6, y = H - sh * 0.2 * (1 - t), len = fw * (0.04 + rand(k + 1) * 0.2), th = fh * (0.006 + rand(k + 2) ** 2 * 0.018);
    b.add(wlStep(mix(sky[3], W.hot, dark ? 0.24 : 0.12), rand(k + 3), 1, 0.05), 0.35 + rand(k + 4) * 0.4, (q) => wlStroke(q, F.x0 + fw * rand(k + 5) - len * 0.3, y, len, th, (rand(k + 6) - 0.5) * 0.03, k + 7));
  }
  const eh = Math.max(1, h - H), et = (t) => mix(mix(W.haze, W.earth[0], 0.5), mix(W.earth[0], W.earth[1], clamp(t * 1.3)), clamp(t * 6));
  for (let i = 0; i < 190; i++) {   // the earth: level strokes, broad at the foot, thin toward the horizon
    const k = 4440 + i * 5.3, t = rand(k) ** 1.5, y = H + eh * t, len = fw * (0.06 + t * 0.4) * (0.5 + rand(k + 1)), th = fh * (0.003 + t * 0.04) * (0.5 + rand(k + 2)), back = rand(k + 3) < 0.5;
    const x = F.x0 - fw * 0.08 + fw * 1.1 * rand(k + 4), c = wlBreak(et(Math.round(t * 10) / 10), rand(k + 5), rand(k + 6), dark ? 0.16 : 0.07, dark ? 4 : 3);
    b.add(c, 0.7 + rand(k + 7) * 0.3, (q) => wlStroke(q, back ? x + len : x, y, len, th, (back ? Math.PI : 0) + (rand(k + 8) - 0.5) * 0.03, k + 9));
  }
  if (!dark) for (let i = 0; i < 18; i++) {   // on the snow, broad shadows of a deep blue
    const k = 4470 + i * 4.7, t = 0.12 + 0.88 * rand(k) ** 0.8, y = H + eh * t, len = fw * (0.12 + rand(k + 1) * 0.4), th = fh * (0.008 + t * 0.035) * (0.6 + rand(k + 2) * 0.8), back = rand(k + 3) < 0.5, x = F.x0 - fw * 0.05 + fw * 1.05 * rand(k + 4);
    b.add(wlStep(mix(W.near, sky[0], 0.42), rand(k + 5), 1, 0.06), 0.4 + 0.35 * t, (q) => wlStroke(q, back ? x + len : x, y, len, th * 1.3, (back ? Math.PI : 0) + (rand(k + 6) - 0.5) * 0.04, k + 7));
  }
  b.fill(ctx);
  wlHairs(ctx, { x: 0, y: H, w, h: h - H }, 0, Math.max(40, fh * 0.07), dark ? 0.045 : 0.08, dark ? 0.13 : 0.07);   // the hairs in the earth's strokes; the sky has none
}
/**
 * Clouds of lilac and mauve drifting in long layers across the sky, as the low sun lights them from below:
 * each layer broad strokes heaped along it, thickest in its middle, its top the sky's shade and its
 * underside the cloud's own colour, a soft wash under them for the air; crisp strokes of warm light along
 * the undersides, brighter the nearer the sun; a low bank heaped on the horizon by the sun, lit along its
 * top. `amt`: more layers, longer.
 */
function wlClouds(ctx, P, sx, amt) {
  const { F, fw, fh, H, u } = P, W = wl(), [shade, body, lit] = W.cloud, sky = H - F.y0, layers = [];
  for (let q = 0; q < 4; q++) {
    const grow = clamp(amt * 3 - q * 0.6), k = 4500 + q * 97;
    if (grow <= 0) continue;
    const y = F.y0 + sky * [0.56, 0.3, 0.74, 0.14][q], len = fw * (0.3 + 0.35 * rand(k)) * (0.45 + 0.55 * grow), cx = P.free(0.05 + 0.85 * rand(k + 1)), th = sky * (0.06 + 0.06 * rand(k + 2)) * (0.6 + 0.4 * grow), strokes = [];
    for (let i = 0, n = Math.round(12 + 18 * grow); i < n; i++) {
      const t = rand(k + i * 1.9), prof = Math.max(0.15, 1 - Math.abs(t - 0.5) * 1.8), x = cx + (t - 0.5) * len, sy = y + (rand(k + i * 2.3) - 0.62) * th * prof, sl = len * (0.1 + rand(k + i * 2.9) * 0.22), st = th * (0.28 + 0.4 * prof) * (0.6 + rand(k + i * 3.7) * 0.6);
      strokes.push([x - sl / 2, sy, sl, st, rand(k + i * 4.1) < 0.5, clamp((sy - (y - th * 0.6)) / th), k + i * 11]);
    }
    layers.push({ y, len, cx, th, strokes, k, grow });
  }
  const bank = amt > 0.2 ? { cx: sx + P.side * fw * 0.06, len: fw * (0.18 + 0.2 * amt), tall: Math.min(sky * 0.3, u * (0.06 + 0.06 * amt)), k: 4590 } : null;
  wlSoftly(ctx, 3, (x) => {   // a wash under each, soft, for the air
    for (const L of layers) { x.globalAlpha = Math.min(1, L.grow * 1.6) * 0.4; x.fillStyle = css(mix(wlSkyAt(P, L.y), mix(shade, body, 0.4), 0.5)); x.beginPath(); x.ellipse(L.cx, L.y, L.len * 0.55, L.th * 0.9, 0, 0, TAU); x.fill(); }
    x.globalAlpha = 1;
  }, "wlCloudSoft");
  const b = wlBatch(), top = wlBatch();
  for (const L of layers) for (const [x, y, len, th, back, low, k] of L.strokes) {   // the bodies, stroke by stroke
    b.add(wlBreak(mix(mix(wlSkyAt(P, y), shade, dark ? 0.55 : 0.45), body, Math.round(low * 3) / 5), rand(k), rand(k + 1), 0.08, 5), Math.min(1, L.grow * 1.6) * 0.92, (q) => wlStroke(q, back ? x + len : x, y, len, th, (back ? Math.PI : 0) + (rand(k + 2) - 0.5) * 0.06, k + 3));
  }
  if (bank) for (let i = 0; i < 16; i++) {   // the bank, heaped strokes, darker at its foot
    const t = rand(bank.k + i * 1.3), r = bank.tall * (0.35 + 0.65 * Math.sin(t * Math.PI) ** 0.6) * (0.6 + rand(bank.k + i * 1.7) * 0.5), cx = bank.cx - bank.len / 2 + bank.len * t, y = H - r * (0.3 + rand(bank.k + i * 2.1) * 0.5), len = r * (1.6 + rand(bank.k + i * 2.5) * 1.6);
    b.add(wlBreak(mix(mix(body, shade, 0.35), W.haze, 0.25 * (y / H)), rand(bank.k + i * 2.9), rand(bank.k + i * 3.3), 0.08, 5), Math.min(1, (amt - 0.2) * 3), (q) => wlStroke(q, cx - len / 2, y, len, r * 0.75, (rand(bank.k + i * 3.7) - 0.5) * 0.1, bank.k + i * 9));
  }
  b.fill(ctx);
  for (const L of layers) for (const [x, y, len, th, back, low, k] of L.strokes) {   // warm light along the undersides, crisp, the nearer the sun the brighter
    const near = clamp(1 - Math.abs(x + len / 2 - sx) / (fw * 0.55)) ** 1.5;
    if (low < 0.45 || rand(k + 5) > 0.3 + near * 0.6) continue;
    top.add(wlStep(mix(mix(body, wlSkyAt(P, y), 0.35), lit, 0.15 + 0.75 * near), rand(k + 6), 1, 0.06), (0.4 + 0.5 * near) * Math.min(1, L.grow * 1.6), (q) => wlStroke(q, x + len * 0.1, y + th * 0.32, len * (0.5 + rand(k + 7) * 0.5), Math.max(1.2, th * (0.14 + rand(k + 8) * 0.14)), (rand(k + 9) - 0.5) * 0.03, k + 10));
  }
  if (bank) for (let i = 0; i < 12; i++) {   // the bank's top toward the sun
    const t = i / 11, r = bank.tall * (0.35 + 0.65 * Math.sin(t * Math.PI) ** 0.6) * (0.6 + rand(bank.k + i) * 0.5), cx = bank.cx - bank.len / 2 + bank.len * t, a = -Math.PI / 2 - P.side * (0.3 + rand(bank.k + i * 2.3) * 0.6);
    top.add(wlStep(mix(body, lit, 0.7), rand(bank.k + i * 3.1), 1, 0.04), 0.75 * Math.min(1, (amt - 0.2) * 3), (c) => wlStroke(c, cx + Math.cos(a) * r * 0.6 - r * 0.3, H - r * 0.75 + Math.sin(a) * r * 0.3, r * 0.7, r * 0.18, -P.side * 0.15, bank.k + i * 7));
  }
  for (let i = 0, n = Math.round(amt * 6); i < n; i++) {   // wisps, and bars low across the sky
    const hi = i % 3 !== 0, y = hi ? F.y0 + sky * (0.08 + rand(i * 1.7 + 4560) * 0.4) : H - sky * (0.05 + rand(i * 1.7 + 4560) * 0.18), len = fw * (0.1 + rand(i * 2.3 + 4561) * 0.3), x = P.free(rand(i * 3.1 + 4563)) - len * 0.4, near = clamp(1 - Math.abs(x + len / 2 - sx) / (fw * 0.5));
    top.add(wlStep(mix(mix(shade, wlSkyAt(P, y), hi ? 0.6 : 0.45), lit, near * (hi ? 0.3 : 0.45)), rand(i * 3.7 + 4564), 1, 0.05), hi ? 0.5 : 0.7, (c) => wlStroke(c, x, y, len * 0.7, u * (0.009 + rand(i * 4.1 + 4565) * (hi ? 0.012 : 0.018)), (rand(i * 4.7 + 4566) - 0.5) * 0.05, 4567 + i * 7));
  }
  top.fill(ctx);
  wlHairs(ctx, { x: F.x0, y: F.y0, w: fw, h: H - F.y0 + fh * 0.03 }, 0, Math.max(30, fh * 0.05), 0.08, 0.12);
}
/**
 * The low sun's light: the air about it reddened and a wide glow screened over the sky (and, after the far
 * rows, over the haze in front of them); `r` the disc's radius. `onto`: on what is painted only (a
 * see-through base, where the air itself is left clear).
 */
function wlSunGlow(ctx, P, x, y, r, hot, a, reach = 1, onto = false) {
  const R = Math.max(P.fw, P.fh) * 0.6 * reach, g = ctx.createRadialGradient(x, y, r * 0.9, x, y, R), at = (q) => clamp((q - r * 0.9) / (R - r * 0.9));
  g.addColorStop(0, css(mix(hot, [255, 228, 196], 0.35), 0.95 * a)); g.addColorStop(at(r * 2.4), css(hot, 0.55 * a)); g.addColorStop(at(R * 0.3), css(hot, 0.2 * a)); g.addColorStop(1, css(hot, 0));
  const t = ctx.createRadialGradient(x, y, r, x, y, R * 0.5); t.addColorStop(0, css(hot, 0.38 * a)); t.addColorStop(1, css(hot, 0));   // the air about it reddened
  ctx.save(); if (onto) ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = t; ctx.fillRect(x - R * 0.5, y - R * 0.5, R, R); if (!onto) ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2); ctx.restore();
}
/**
 * The air about the low sun, painted: level strokes of warm light laid round it, thinning out away from
 * it, each the sky's colour there gone over to the sun's, mixed afresh. (x, y): the sun, r its radius.
 */
function wlSunAir(ctx, P, x, y, r, glow, amt) {
  const b = wlBatch();
  for (let i = 0; i < 56; i++) {
    const k = 4930 + i * 5.3, d = rand(k) ** 0.75, ang = rand(k + 1) * TAU, px = x + Math.cos(ang) * r * (1.1 + d * 7), py = y + Math.sin(ang) * r * (0.5 + d * 2.4), len = r * (1 + rand(k + 2) * 3.2), th = r * (0.08 + rand(k + 3) * 0.22);
    b.add(wlBreak(mix(wlSkyAt(P, py), glow, 0.6 * (1 - d) + 0.1), rand(k + 4), rand(k + 5), 0.1, 6), (0.55 - 0.4 * d) * amt, (q) => wlStroke(q, px - len / 2, py, len, th, (rand(k + 6) - 0.5) * 0.05, k + 7));
  }
  b.fill(ctx);
}
/** The sun's disc, flat, a little hotter at its heart, its rim soft. */
function wlSun(ctx, x, y, r, sun, a) {
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(sun, 0.3); ctx.beginPath(); ctx.arc(x, y, r * 1.1, 0, TAU); ctx.fill();
  ctx.fillStyle = css(sun); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.15, y - r * 0.2, 0, x, y, r); g.addColorStop(0, css(mix(sun, [255, 214, 160], 0.45), 0.85)); g.addColorStop(1, css(sun, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.restore();
}
/** The sun's light lying on the ground below it: a long glow down from the horizon, screened, and level strokes of it on the wet ground, broken, fewer and fainter toward the foot. */
function wlSunPath(ctx, P, x, hot, a) {
  const { F, H, fw, fh } = P, len = F.y1 - H, wd = fw * 0.08;
  ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.translate(x, H); ctx.scale(1, len / wd);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, wd); g.addColorStop(0, css(hot, 0.4 * a)); g.addColorStop(1, css(hot, 0));
  ctx.fillStyle = g; ctx.fillRect(-wd, 0, wd * 2, wd); ctx.restore();
  const b = wlBatch(), lit = mix(mix(wl().earth[0], hot, 0.55), [255, 236, 210], 0.15);
  for (let i = 0; i < 26; i++) {
    const k = 4960 + i * 3.3, t = rand(k) ** 1.3, y = H + len * (0.02 + t * 0.8), w = fw * (0.02 + 0.07 * (1 - t)) * (0.5 + rand(k + 1)), px = x + (rand(k + 2) - 0.5) * fw * 0.1 * (1 - t * 0.5);
    b.add(wlStep(lit, rand(k + 3), 1, 0.06), (0.4 - 0.3 * t) * a, (q) => wlStroke(q, px - w / 2, y, w, Math.max(1.5, fh * (0.004 + 0.008 * t)), (rand(k + 4) - 0.5) * 0.03, k + 5));
  }
  ctx.save(); ctx.globalCompositeOperation = "screen"; b.fill(ctx); ctx.restore();
}
/**
 * A row of ruined blocks standing on y = base, `depth` away, built stroke by stroke: each block upright
 * strokes side by side, overlapping, each mixed afresh from the sky's colour a shade darker (wlTone), their
 * tops running out ragged where the floors are broken, their feet a hazier stroke; floors and rods sticking
 * out of the broken ones; the edge toward the sun rimmed with its warm light; holes where the sky shows
 * through, and now and then a small warm light. `top`: how high the tallest reach.
 */
function wlRow(ctx, P, base, top, depth, sx, holes, density, k0) {
  const { F, u } = P, W = wl(), b = wlBatch(), foot = wlBatch(), over = wlBatch(), H0 = Math.max(4, base - top), lit = mix(W.hot, wlSkyAt(P, base), 0.35), q8 = H0 / 6;
  const tone = (y, d = depth) => wlTone(P, Math.round(y / q8) * q8, d), groups = 3 + Math.floor(rand(k0 + 7) * 2);
  const mass = (x) => { let e = 0.1; for (let g = 0; g < groups; g++) { const c = F.x0 + P.fw * (0.06 + 0.88 * rand(k0 + 50 + g)), wd = P.fw * (0.05 + 0.12 * rand(k0 + 60 + g)), d = (x - c) / wd; e = Math.max(e, (0.35 + 0.65 * rand(k0 + 70 + g)) * Math.exp(-d * d)); } return e; };   // a few masses, each of its own height, rubble between: not one rhythm
  for (let x = F.x0 - u * 0.03, i = 0; x < F.x1 + u * 0.02; i++) {
    const k = k0 + i * 13.7, bw = u * (0.025 + rand(k) * 0.07) * density, here = mass(x + bw / 2), bh = H0 * (0.08 + 0.92 * here) * (0.7 + rand(k + 1) * 0.3), y0 = base - bh, m = 2 + Math.floor(bw / (u * 0.012)), sw = bw / m;
    if (rand(k + 9) < 0.06 + 0.3 * (1 - here)) { x += bw * 0.6; continue; }   // a gap in the row
    const broken = rand(k + 2) < 0.6, lean = rand(k + 3) < 0.1 ? (rand(k + 4) - 0.5) * 0.1 : 0, bite = broken ? Math.floor(m * rand(k + 6)) : -1, near = clamp(1 - Math.abs(x + bw / 2 - sx) / (P.fw * 0.45));
    const toSun = x + bw / 2 < sx ? 1 : -1, face = wlBreak(tone(y0 + bh * 0.4), rand(k + 40), rand(k + 41), 0.1, 3), sideW = bw * (0.22 + rand(k + 42) * 0.14), sideX = toSun > 0 ? x + bw - sideW / 2 : x + sideW / 2;
    for (let s = 0; s < m; s++) {   // the block, upright knife strokes side by side, the broken ones' tops at a slant
      const cut = broken ? bh * (0.22 * rand(k + s * 2.1 + 5) ** 2 + (s === bite ? 0.3 : 0)) : bh * 0.02 * rand(k + s * 2.1 + 5), len = bh - cut + 2, cx = x + sw * (s + 0.5);
      b.add(wlStep(face, rand(k + s * 3.3 + 43), 1, 0.05), 1, (q) => wlKnife(q, cx, base + 2, len, sw * 1.3, -Math.PI / 2 + lean, k + s * 7 + 44, broken ? (rand(k + s * 3.7 + 58) - 0.5) * 1.2 : 0.04));
      if (rand(k + s * 4.7 + 45) < 0.5) over.add(wlBreak(face, rand(k + s * 5.1 + 46), rand(k + s * 5.3 + 47), 0.14, 4), 0.6, (q) => wlKnife(q, cx + (rand(k + s * 5.7 + 48) - 0.5) * sw, base - len * (0.2 + rand(k + s * 6.1 + 49) * 0.4), len * (0.15 + rand(k + s * 6.3 + 50) * 0.3), sw * (0.5 + rand(k + s * 6.7 + 51) * 0.6), -Math.PI / 2, k + s * 7 + 52, (rand(k + s * 6.9 + 53) - 0.5) * 0.8));   // the colour broken over its face
    }
    if (rand(k + 59) < 0.55) over.add(wlStep(mix(face, lit, 0.05 + 0.3 * near * (1 - depth * 0.5)), rand(k + 53), 1, 0.04), 0.75, (q) => wlKnife(q, sideX, base + 2, bh * (broken ? 0.7 : 0.97), sideW, -Math.PI / 2 + lean, k + 54, 0.05));   // the side toward the sun, a plane of its own
    foot.add(mix(tone(base), W.haze, 0.25), 0.8, (q) => wlKnife(q, x - bw * 0.05, base - bh * (0.06 + rand(k + 55) * 0.1), bw * 1.1, bh * (0.12 + rand(k + 56) * 0.12), 0, k + 57));   // its foot in the haze
    if (broken) for (let q = 0; q < 2; q++) { const fy = y0 + bh * (0.25 + q * 0.2 + rand(k + q * 3.7 + 21) * 0.1), out = bw * (0.1 + rand(k + q * 4.1 + 22) * 0.25), left = rand(k + q + 23) < 0.5; b.add(tone(fy), 1, (c) => wlStroke(c, left ? x + bw * 0.2 : x + bw * 0.8, fy, bw * 0.1 + out, Math.max(1, bh * 0.025), left ? Math.PI : 0, k + q * 9 + 25)); }   // floors sticking out
    if (broken && rand(k + 17) < 0.6) for (let q = 0; q < 3; q++) { const rx = x + bw * (0.2 + q * 0.25), rh = bh * (0.04 + rand(k + q * 1.3 + 18) * 0.08); b.add(tone(y0), 1, (c) => wlTaper(c, rx, y0 + bh * 0.2, rx + (rand(k + q + 19) - 0.5) * rh * 0.6, y0 - rh, Math.max(1, u * 0.002), Math.max(0.6, u * 0.001))); }   // rods of steel
    for (let q = 0; q < 3; q++) { const fy = y0 + bh * (0.2 + rand(k + q * 2.7 + 30) * 0.6); over.add(wlStep(face, q / 2, 1, 0.12), 0.45, (c) => wlKnife(c, x + bw * rand(k + q * 3.1 + 31) * 0.4, fy, bw * (0.3 + rand(k + q * 3.5 + 32) * 0.5), Math.max(1, bh * 0.018), 0, k + q * 7 + 34)); }   // floors across its face
    if (near > 0.05) {   // its edge toward the sun, rimmed, and the light along its broken top
      const ex = toSun > 0 ? x + bw * 0.97 : x + bw * 0.03, ew = Math.max(1, bw * (0.05 + rand(k + 8) * 0.05)), top0 = y0 + bh * (broken ? 0.12 : 0.03);
      over.add(wlStep(lit, rand(k + 10), 1, 0.06), (0.25 + 0.6 * near) * (1 - depth * 0.4), (c) => wlKnife(c, ex, top0, bh * (0.25 + rand(k + 10.5) * 0.45), ew, Math.PI / 2, k + 11));
      if (!broken) over.add(lit, (0.15 + 0.4 * near) * (1 - depth * 0.4), (c) => wlKnife(c, x + bw * 0.1, y0 + 1, bw * 0.8, Math.max(1, bh * 0.012), 0, k + 12));
    }
    if (holes > 0 && bw > u * 0.035) for (let q = 0, n = Math.floor(rand(k + 12) * 4 * holes); q < n; q++) {   // holes to the sky, now and then a light
      const hx = x + bw * (0.15 + rand(k + q * 2.3 + 13) * 0.6), hy = y0 + bh * (0.15 + rand(k + q * 2.9 + 14) * 0.6), hw = bw * (0.08 + rand(k + q * 3.3 + 15) * 0.16), glow = rand(k + q * 4.3 + 17) < 0.07;
      over.add(glow ? mix(W.hot, [255, 226, 170], 0.5) : wlStep(mix(wlSkyAt(P, hy), W.haze, 0.3), 0.5, 1), glow ? 0.85 : 0.75, (c) => wlKnife(c, hx, hy, hw, hw * (0.5 + rand(k + q * 3.9 + 16)), 0, k + q * 5 + 18, 0));
    }
    x += bw * (0.9 + rand(k + 20) * 0.25);
  }
  b.fill(ctx); foot.fill(ctx); over.fill(ctx);
}
/**
 * The megastructure: a colossal ruin far off — a monolith rising out of the haze, a lower tower beside it
 * joined to it by bridges, a broken stump on its other side, a slab thrust out toward the sun and snapped
 * off, masts on what is left of its crown — built of upright strokes side by side, each mixed afresh from
 * the sky's colour a shade darker, their tops running out ragged; painted a little soft, as the air softens
 * what is far; its face toward the sun caught in strokes of warm light, its edge rimmed, faint floors across
 * it for its scale. (x, base): the middle of its foot; s: its height.
 */
function wlMega(ctx, P, x, base, s, depth, k0, own = false) {
  const side = P.side, w = s * 0.1, ox = x - side * s * 0.3, top = base - s, W = wl(), qs = s / 8;
  const tone = (y, d = depth) => wlTone(P, Math.round(y / qs) * qs, d);
  wlSoftly(ctx, 1.4, (c) => {
    const b = wlBatch(), foot = wlBatch();
    const tower = (cx, hw, ht, n, k) => {   // upright strokes side by side, their tops ragged
      for (let i = 0; i < n; i++) {
        const sx = cx - hw + (2 * hw * (i + 0.5)) / n, len = ht * (0.9 + rand(k + i * 1.3) * 0.1) - (i % 2 ? s * 0.02 * rand(k + i * 1.7) : 0);
        b.add(wlBreak(tone(base - len * 0.6), rand(k + i * 2.1), rand(k + i * 2.5), 0.1, 3), 1, (q) => wlKnife(q, sx, base + 2, len, ((2 * hw) / n) * 1.35, -Math.PI / 2 + (rand(k + i * 2.9) - 0.5) * 0.01, k + i * 7, (rand(k + i * 3.1) - 0.5) * 1.4));
        foot.add(mix(tone(base), W.haze, 0.18), 0.55, (q) => wlKnife(q, sx, base + 2, ht * (0.1 + rand(k + i * 3.3) * 0.2), ((2 * hw) / n) * 1.3, -Math.PI / 2, k + i * 7 + 3));
      }
    };
    tower(x, w, s, 7, k0);   // the monolith
    tower(ox, w * 0.8, s * 0.6, 5, k0 + 100);   // the lower tower
    tower(x + side * w * 0.9, w * 0.45, s * 0.34, 3, k0 + 200);   // a broken stump
    for (const [y, th] of [[0.34, 0.022], [0.47, 0.014]]) b.add(tone(base - s * y), 1, (q) => wlKnife(q, Math.min(x, ox), base - s * y, Math.abs(x - ox), s * th, 0, k0 + y * 100));   // bridges between them
    b.add(tone(base - s * 0.66), 1, (q) => wlKnife(q, x + side * w * 0.8, base - s * 0.66, s * 0.34, s * 0.035, side > 0 ? 0.04 : Math.PI - 0.04, k0 + 20));   // a slab thrust out, its end broken
    for (const dx of [-0.6, 0.15, 0.55]) b.add(tone(top), 1, (q) => wlTaper(q, x + dx * w, top + s * 0.08, x + dx * w + s * 0.004, top - s * (0.05 + rand(k0 + dx * 10 + 30) * 0.1), s * 0.008, s * 0.002));   // masts and girders on what is left of the crown
    b.fill(c); foot.fill(c);
    c.save(); c.strokeStyle = css(tone(base - s * 0.5), 0.8); c.lineWidth = Math.max(0.8, s * 0.003); c.beginPath();   // cables hanging from the slab
    for (const t of [0.55, 0.85]) { const cx = x + side * (w + s * 0.32 * t); c.moveTo(cx, base - s * 0.64); c.quadraticCurveTo(cx + side * s * 0.01, base - s * 0.5, cx - side * s * 0.005, base - s * (0.32 + t * 0.08)); }
    c.stroke(); c.restore();
  }, "wlMegaSoft");
  const b = wlBatch(), lit = mix(W.hot, wlSkyAt(P, base - s * 0.4), 0.42), dk = tone(base - s * 0.5, depth * 0.85);
  for (let i = 0; i < 9; i++) b.add(wlStep(lit, rand(k0 + i * 4.7 + 60), 1, 0.06), 0.12 + rand(k0 + i * 1.1 + 59) * 0.1, (c) => wlStroke(c, x + side * w * (0.1 + i * 0.1), top + s * (0.12 + rand(k0 + i * 2.3 + 61) * 0.12), s * (0.3 + rand(k0 + i * 2.9 + 62) * 0.45), w * (0.1 + rand(k0 + i * 3.3 + 58) * 0.12), Math.PI / 2, k0 + i * 7 + 63));   // its face toward the sun in the light, stroke by stroke
  b.add(lit, 0.42, (c) => wlStroke(c, x + side * w * 0.95, top + s * 0.12, s * 0.75, w * 0.12, Math.PI / 2, k0 + 40));   // the edge toward the sun
  b.add(lit, 0.3, (c) => wlStroke(c, ox + side * w * 0.72, base - s * 0.58, s * 0.45, w * 0.1, Math.PI / 2, k0 + 41));
  for (let i = 0; i < 6; i++) b.add(dk, 0.25, (c) => wlStroke(c, x - w + w * 2 * rand(k0 + i * 1.7 + 50), top + s * (0.12 + rand(k0 + i * 2.3 + 51) * 0.3), s * (0.2 + rand(k0 + i * 2.9 + 52) * 0.35), w * (0.1 + rand(k0 + i * 3.1 + 53) * 0.2), Math.PI / 2, k0 + i * 7 + 54));   // upright strokes down its face
  for (let i = 0; i < 12; i++) b.add(mix(dk, wlSkyAt(P, base - s * 0.5), 0.5), 0.28, (c) => wlStroke(c, x - w * 0.9 + w * 0.3 * rand(k0 + i * 1.9 + 70), top + s * (0.16 + i * 0.06), w * (1 + rand(k0 + i * 2.1 + 71) * 0.6), Math.max(0.8, s * 0.003), 0, k0 + i * 3 + 72));   // floors, for its scale
  b.fill(ctx);
  if (own) {   // on its own canvas: its foot lost in the haze, so dragged down it has no edge there
    const g = ctx.createLinearGradient(0, base - s * 0.08, 0, base + 2); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.save(); ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = g; ctx.fillRect(x - s, base - s * 0.08, s * 2, s * 0.08 + 4); ctx.restore();
  }
}
/** A dead forest, a band of bare trunks standing on `base`, `depth` away: each a tapering stroke leaning a little, a few branches reaching up from it, scrub at their feet; all in the sky's colour a shade darker; and here and there a dark mass of conifers. */
function wlForest(ctx, P, base, tall, depth, amt, k0) {
  const { F, fw, u } = P, n = Math.round((fw / (u * 0.016)) * (0.3 + 0.7 * amt));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const k = k0 + i * 5.3, x = F.x0 + fw * rand(k), hgt = tall * (0.3 + rand(k + 1) ** 0.8 * 0.7), lean = (rand(k + 2) - 0.5) * 0.1, w = u * (0.0025 + rand(k + 3) * 0.0035), tx = x + lean * hgt, ty = base - hgt;
    wlTaper(ctx, x, base + 2, tx, ty, w, w * 0.15, (rand(k + 5) - 0.5) * 0.05);
    for (let j = 0, m = 2 + Math.floor(rand(k + 6) * 5); j < m; j++) {
      const t = 0.3 + rand(k + j * 1.7 + 7) * 0.6, bx = x + lean * hgt * t, by = base - hgt * t, side = rand(k + j * 2.3 + 8) < 0.5 ? -1 : 1, bl = hgt * (0.1 + rand(k + j * 2.9 + 9) * 0.22);
      wlTaper(ctx, bx, by, bx + side * bl * 0.65, by - bl * 0.85, w * 0.45, w * 0.08, side * 0.1);
      if (rand(k + j * 3.3 + 10) < 0.5) wlTaper(ctx, bx + side * bl * 0.35, by - bl * 0.45, bx + side * bl * 0.6, by - bl * 1.05, w * 0.22, w * 0.05);
    }
  }
  for (let i = 0; i < n * 1.2; i++) { const k = k0 + 900 + i * 3.1, x = F.x0 + fw * rand(k), r = u * (0.006 + rand(k + 1) * 0.014); wlDab(ctx, x, base - r * 0.25, r, 0.45, 0, k + 3); }   // scrub
  ctx.fillStyle = wlDepthFill(ctx, P, base - tall, base, depth); ctx.fill();
  const cb = wlBatch(), deep = wlTone(P, base - tall * 0.5, depth * (dark ? 0.75 : 0.5));   // dark masses of conifers here and there, more on the snow: each a spire of short level strokes narrowing to its tip
  for (let g = 0, gn = dark ? 2 : 3; g < gn; g++) {
    const c = F.x0 + fw * (0.05 + 0.9 * rand(k0 + 300 + g)), wd = fw * (0.04 + 0.08 * rand(k0 + 310 + g));
    for (let i = 0, m = Math.round((wd / (u * 0.011)) * (0.4 + 0.6 * amt)); i < m; i++) {
      const k = k0 + 320 + g * 97 + i * 3.7, tx = c + (rand(k) - 0.5) * wd * 2, th = tall * (0.5 + rand(k + 1) * 0.55) * (1 - Math.abs(tx - c) / (wd * 1.4)), tw = th * (0.17 + rand(k + 2) * 0.08);
      if (th < tall * 0.25) continue;
      for (let j = 0; j < 7; j++) { const f = j / 7, y = base - th * f, ww = tw * (1 - f) * (0.8 + rand(k + j + 3) * 0.4); cb.add(wlStep(deep, rand(k + j * 1.3 + 9), 1, 0.07), 1, (q) => wlKnife(q, tx - ww, y, ww * 2, th * 0.17, (rand(k + j * 1.7 + 11) - 0.5) * 0.12, k + j * 5 + 12, 0)); }
      cb.add(deep, 1, (q) => wlTaper(q, tx, base - th * 0.85, tx + (rand(k + 20) - 0.5) * 2, base - th * 1.03, tw * 0.25, 0.6));   // its tip
    }
  }
  cb.fill(ctx);
}
/**
 * Power poles in a line running off toward the horizon, from the nearest at (x0, base0) to the far ones by
 * (vx, vy): each a tapering post with crossarms and insulators, a transformer on the nearest, and wires
 * sagging from each to the next; the further, the more lost in the haze. `n` poles (the last by degrees).
 */
function wlPoles(ctx, P, x0, base0, h0, vx, vy, n, k0, sx = x0, out = true) {
  const { u } = P, b = wlBatch(), lit = wlBatch(), poles = [];
  for (let i = 0; i < Math.ceil(n); i++) {
    const t = 1 / (1 + i * 0.85), x = vx + (x0 - vx) * t, base = vy + (base0 - vy) * t, hh = h0 * t, w = Math.max(1.2, u * 0.007 * t), a = clamp(n - i), top = base - hh, c = wlTone(P, top + hh * 0.3, (1 - t) * 0.75 + 0.04);
    poles.push({ x, top, hh, w, a, c });
    b.add(c, a, (q) => wlTaper(q, x, base + 2, x + hh * 0.012, top, w * 1.25, w * 0.8));
    for (const [y, half] of [[0.04, 0.12], [0.11, 0.09]]) b.add(c, a, (q) => wlKnife(q, x - hh * half, top + hh * y, hh * half * 2, Math.max(1, w * 0.55), 0.03 * (rand(k0 + i) - 0.5), k0 + i * 7 + y * 100));
    for (const s of [-0.9, -0.3, 0.3, 0.9]) b.add(c, a, (q) => q.rect(x + s * hh * 0.1 - w * 0.25, top + hh * 0.04 - w * 0.9, w * 0.5, w * 0.9));
    if (i === 0) b.add(c, a, (q) => { q.rect(x - w * 2.8, top + hh * 0.2, w * 2.3, w * 3.4); wlKnife(q, x + w * 0.5, top + hh * 0.28, hh * 0.05, w * 0.5, 0.4, k0 + 90); });   // a transformer, a bracket
    if (i < 3) { const to = Math.sign(sx - x) || 1; lit.add(mix(wl().hot, wlSkyAt(P, top + hh * 0.4), 0.45), a * (0.6 - i * 0.15), (q) => wlTaper(q, x + to * w * 0.45, base - hh * 0.08, x + to * w * 0.35 + hh * 0.012, top + hh * 0.05, w * 0.3, w * 0.18)); }   // the sun's light down its side
  }
  b.fill(ctx); lit.fill(ctx);
  ctx.save(); ctx.lineCap = "round";
  for (let i = 0; i + 1 < poles.length; i++) {
    const A = poles[i], B = poles[i + 1];
    ctx.strokeStyle = css(B.c, Math.min(A.a, B.a)); ctx.lineWidth = Math.max(0.7, A.w * 0.2); ctx.beginPath();
    for (const [q, y] of [[-0.9, 0.04], [-0.3, 0.04], [0.3, 0.04], [0.9, 0.04], [-0.6, 0.11], [0.6, 0.11]]) {
      const ax = A.x + q * A.hh * 0.1, ay = A.top + A.hh * y, bx = B.x + q * B.hh * 0.1, by = B.top + B.hh * y, sag = (Math.abs(ax - bx) * 0.1 + A.hh * 0.025) * (0.8 + rand(k0 + i * 3 + q * 5) * 0.5);
      ctx.moveTo(ax, ay); ctx.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag * 2, bx, by);
    }
    ctx.stroke();
  }
  if (poles.length && out) {   // wires from the nearest out past the edge (`out`)
    const A = poles[0], away = Math.sign(A.x - vx) || 1;
    ctx.strokeStyle = css(A.c, A.a); ctx.lineWidth = Math.max(0.8, A.w * 0.22); ctx.beginPath();
    for (const q of [-0.9, -0.3, 0.3, 0.9]) { const ax = A.x + q * A.hh * 0.1, ay = A.top + A.hh * 0.04; ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + away * u * 0.4, ay + A.hh * 0.14, ax + away * u * 0.9, ay + A.hh * 0.06); }
    ctx.stroke();
  }
  ctx.restore();
}
/** The plume's spine at t (0 its foot, 1 its head), from its foot at (x, base), `s` tall, leaning off to `drift`: [x, y, r, spread], its centre, its half width there, how far its head has opened (a little, no more: it thins into the sky rather than spreading into a lid). */
function wlSpine(x, base, s, drift, k0, t) {
  const spread = clamp((t - 0.72) / 0.28) * 0.6;
  return [x + drift * s * (t * t + spread * 0.25) + (Math.sin(t * 6 + k0) * 0.03 + Math.sin(t * 15 + k0 * 1.7) * 0.008) * s * t, base - s * t, s * (0.05 + 0.11 * t ** 1.1) * (1 + spread * 0.6), spread];
}
/**
 * The plume's strokes (see wlSpine): [x, y, len, th, a, t] each — many, laid along its rise, more of them at its
 * foot, fewer and broader above; their place across the column wanders as it rises (a few slow waves of the
 * seed), so its edges are broken and lost, never a run of round billows.
 */
function wlBillows(x, base, s, drift, amt, k0) {
  const n = Math.round(70 + 70 * amt), out = [], sp = (t) => wlSpine(x, base, s, drift, k0, t);
  for (let i = 0; i < n; i++) {
    const t = rand(k0 + i * 1.3) ** 1.3, [mx, my, r] = sp(t), [ux, uy] = sp(Math.min(1, t + 0.03)), up = Math.atan2(uy - my, ux - mx);
    const wander = Math.sin(t * 8 + k0 * 0.7 + (i % 3) * 2.1) * 0.45 + Math.sin(t * 19 + k0 * 1.3 + (i % 5)) * 0.25, across = (wander + (rand(k0 + i * 1.7) - 0.5) * 0.9) * r;
    const len = r * (1.1 + rand(k0 + i * 2.1) * 1.3), th = r * (0.5 + rand(k0 + i * 2.3) * 0.55) * (1 - 0.25 * t), a = up + (rand(k0 + i * 2.7) - 0.5) * (0.5 + 0.6 * t);
    out.push([mx - Math.sin(up) * across, my + Math.cos(up) * across, len, th, a, t]);
  }
  return out;
}
/** The box the plume's paint takes (see wlBillows): its strokes, and the soft edge about them. */
function wlPlumeBox(x, base, s, drift, amt, k0) {
  let x0 = x, y0 = base, x1 = x, y1 = base;
  for (const [cx, cy, len, th] of wlBillows(x, base, s, drift, amt, k0)) { const e = len * 0.6 + th; x0 = Math.min(x0, cx - e); x1 = Math.max(x1, cx + e); y0 = Math.min(y0, cy - e); y1 = Math.max(y1, cy + e); }
  const m = s * 0.03;
  return { x: x0 - m, y: y0 - m, w: x1 - x0 + m * 2, h: y1 - y0 + m * 2 };
}
/**
 * A plume of smoke from a fire behind the far ruins at (x, base), `s` tall, leaning off to `drift`: a soft,
 * irregular mass of many strokes laid along its rise and run together (wet into wet), dense and dark at its
 * source, opening, paler and more see-through as it rises, its head thinning out into the sky; lit as one
 * broad soft plane on its side toward the sun (`toSun`, ±1), in shade by degrees on the other, warm at its
 * foot from the fire (whose glow is painted apart, see wlFireGlow), its foot lost in the haze; nothing
 * outlined. A few broken strokes of its own colour over it.
 */
function wlPlume(ctx, P, x, base, s, drift, amt, k0, toSun = P.side) {
  const W = wl(), sm = dark ? [mix(W.near, [44, 38, 36], 0.4), [100, 92, 88]] : [[76, 82, 96], [160, 164, 176]], fade = Math.min(1, amt * 3), list = wlBillows(x, base, s, drift, amt, k0), spine = (t) => wlSpine(x, base, s, drift, k0, t);
  const tone = (t, y) => (t < 0.5 ? mix(sm[0], sm[1], t / 0.5) : mix(sm[1], mix(wlSkyAt(P, y), W.cloud[1], 0.45), (t - 0.5) / 0.5));
  const light = mix(mix(W.cloud[2], W.hot, dark ? 0.3 : 0.15), sm[1], 0.25), shade = mix(sm[0], W.near, 0.5), [, , r0] = spine(0);
  wlSoftly(ctx, 2.5, (c) => {
    const core = (t) => { const [mx, my, r] = spine(t), w = r * (0.55 + 0.2 * Math.sin(t * 11 + k0 * 0.9) + 0.1 * Math.sin(t * 27 + k0)); return [mx, my, w]; };
    for (let i = 0; i < 20; i++) {   // its core, one soft body from the source up, its width wavering, dense below and thinning above
      const t0 = i / 20, t1 = (i + 1) / 20, [ax, ay, aw] = core(t0), [bx, by, bw] = core(t1);
      c.globalAlpha = (0.9 - 0.75 * t0) * fade; c.fillStyle = css(tone(t0, ay)); c.beginPath(); c.moveTo(ax - aw, ay + 1); c.lineTo(bx - bw, by - 1); c.lineTo(bx + bw, by - 1); c.lineTo(ax + aw, ay + 1); c.closePath(); c.fill();
    }
    const order = list.map((q, i) => i).sort((i, j) => list[j][5] - list[i][5]);   // the strokes about it, the higher behind, the dense foot over them
    for (const i of order) { const [cx, cy, len, th, a, t] = list[i]; c.globalAlpha = (0.78 - 0.55 * t) * fade; c.fillStyle = css(wlStep(tone(t, cy), rand(k0 + i * 3.1), 2, 0.04)); c.beginPath(); wlStroke(c, cx - Math.cos(a) * len * 0.5, cy - Math.sin(a) * len * 0.5, len, th, a, k0 + i * 7); c.fill(); }
    c.globalAlpha = 1; c.globalCompositeOperation = "source-atop";   // on the smoke only: the light as one broad plane across it, the shade by degrees on the other side
    for (let i = 0; i < 28; i++) {
      const t = (i + 0.5) / 28, [mx, , r] = spine(t), ya = i ? spine(i / 28)[1] : base + r0 * 3, yb = i < 27 ? spine((i + 1) / 28)[1] : base - s * 1.3;
      const g = c.createLinearGradient(mx + toSun * r * 1.4, 0, mx - toSun * r * 1.4, 0);
      g.addColorStop(0, css(light, 0.55 * fade)); g.addColorStop(0.42, css(light, 0.08 * fade)); g.addColorStop(0.55, css(shade, 0)); g.addColorStop(1, css(shade, (0.42 - 0.22 * t) * fade));
      c.fillStyle = g; c.fillRect(mx - r * 4, yb, r * 8, ya - yb + 1);
    }
    const fire = c.createRadialGradient(x, base, 0, x, base, r0 * 3.5); fire.addColorStop(0, css(W.hot, 0.4 * fade)); fire.addColorStop(1, css(W.hot, 0));   // warm at its foot from the fire
    c.fillStyle = fire; c.fillRect(x - r0 * 3.5, base - r0 * 3.5, r0 * 7, r0 * 7);
    c.globalCompositeOperation = "destination-out";   // its foot lost in the haze: dragged anywhere, it has no edge there
    const foot = c.createLinearGradient(0, base - s * 0.05, 0, base + r0 * 1.5); foot.addColorStop(0, "rgba(0,0,0,0)"); foot.addColorStop(1, "rgba(0,0,0,1)");
    c.fillStyle = foot; c.fillRect(x - s, base - s * 0.05, s * 2, s * 0.05 + r0 * 4);
    c.globalCompositeOperation = "source-over";
  }, "wlPlumeSoft");
  const b = wlBatch();
  for (let i = 0; i < 6; i++) {   // a few broken strokes of its own colour over it, along its rise
    const t = 0.12 + 0.55 * rand(k0 + i * 5.1 + 50), [mx, my, r] = spine(t), [ux, uy] = spine(Math.min(1, t + 0.04)), a = Math.atan2(uy - my, ux - mx) + (rand(k0 + i * 5.7 + 53) - 0.5) * 0.3, len = r * (0.7 + rand(k0 + i * 5.3 + 51) * 0.6), cx = mx + (rand(k0 + i * 6.3 + 56) - 0.5) * r * 0.9;
    b.add(wlBreak(tone(t, my), rand(k0 + i * 5.9 + 54), rand(k0 + i * 6.1 + 55), 0.1, 3), 0.3 * fade, (q) => wlStroke(q, cx - Math.cos(a) * len * 0.5, my - Math.sin(a) * len * 0.5, len, r * (0.12 + rand(k0 + i * 6.5 + 57) * 0.1), a, k0 + i * 11 + 58));
  }
  b.fill(ctx);
}
/** The glow of the fire at the plume's foot (x, base), the plume `s` tall: screened onto the air, in the hot accent; sparks rising from it. */
function wlFireGlow(ctx, x, base, s, hot, a) {
  const g = ctx.createRadialGradient(x, base, 0, x, base, s * 0.3); g.addColorStop(0, css(hot, 0.5 * a)); g.addColorStop(0.35, css(hot, 0.14 * a)); g.addColorStop(1, css(hot, 0));
  ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g; ctx.fillRect(x - s * 0.3, base - s * 0.3, s * 0.6, s * 0.6);
  ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = css(mix(hot, [255, 226, 160], 0.6), 0.85 * a); ctx.beginPath();
  for (let i = 0; i < 16; i++) { const k = 4980 + i * 3.7, h = rand(k + 1) ** 1.6, ex = x + (rand(k) - 0.5) * s * (0.05 + h * 0.12), ey = base - s * (0.02 + h * 0.3), r = Math.max(0.7, s * 0.0045 * (1 - h * 0.6) * (0.5 + rand(k + 2))); wlTaper(ctx, ex, ey, ex + (rand(k + 3) - 0.5) * r * 2, ey - r * 3, r, r * 0.4); }
  ctx.fill(); ctx.restore();
}
/**
 * Puddles on the ground below the horizon, wider and further apart toward the foot, each a few level
 * strokes laid together, longest in its middle, ragged at their ends; added to the current path. Returns
 * them, { x, y, w, top, bot }: where each lies, half its width, its far and near edges. `amt`: more, larger.
 */
function wlPuddles(ctx, P, amt, k0) {
  const { F, fw, H } = P, n = Math.round(3 + 12 * amt), span = Math.max(1, F.y1 - H), out = [];
  const pool = (x, y, w, hgt, k) => {
    const m = 3 + Math.floor(rand(k) * 3);
    for (let j = 0; j < m; j++) {
      const v = (j + 0.5) / m, len = w * 2 * Math.sin(v * Math.PI) ** 0.6 * (0.7 + rand(k + j * 1.3 + 1) * 0.4), th = (hgt / m) * 1.6, yy = y - hgt / 2 + hgt * v, xx = x - len / 2 + (rand(k + j * 1.7 + 2) - 0.5) * w * 0.25, back = rand(k + j * 2.1 + 3) < 0.5;
      wlStroke(ctx, back ? xx + len : xx, yy, len, th, back ? Math.PI : 0, k + j * 5 + 4);
    }
    out.push({ x, y, w, top: y - hgt / 2, bot: y + hgt / 2 });
  };
  for (let i = 0; i < n; i++) {
    const t = 0.06 + 0.9 * rand(k0 + i * 1.3) ** 0.8, y = H + span * t, w = fw * (0.04 + 0.22 * t) * (0.5 + rand(k0 + i * 2.1)) * (0.5 + amt * 0.7), x = F.x0 + fw * rand(k0 + i * 2.9), sq = 0.07 + t * 0.06;
    pool(x, y, w, w * sq * 2, k0 + i * 31);
    if (rand(k0 + i * 4.3) < 0.6) pool(x + w * (0.6 + rand(k0 + i * 4.9) * 0.4), y + span * 0.01, w * 0.5, w * (0.09 + t * 0.06), k0 + i * 31 + 17);
  }
  return out;
}
/** Paper and rubble scattered on the ground: sheets lying flat (squashed as the ground runs away), their pale faces dulled by the haze far off, and small stones. */
function wlDebris(ctx, P, amt, k0) {
  const { F, fw, H, u } = P, W = wl(), b = wlBatch(), span = Math.max(1, F.y1 - H), n = Math.round(6 + 50 * amt);
  for (let i = 0; i < n; i++) {
    const t = rand(k0 + i * 1.7) ** 0.7, x = F.x0 + fw * rand(k0 + i * 2.3), y = H + span * (0.14 + 0.84 * t), s = u * (0.004 + 0.016 * t) * (0.6 + rand(k0 + i * 2.9) * 0.8), a = rand(k0 + i * 3.1) * Math.PI, sq = 0.28 + 0.25 * t;
    if (rand(k0 + i * 3.7) < 0.4) { b.add(mix(W.earth[1], W.near, 0.5), 0.85, (c) => wlDab(c, x, y, s * 0.55, 0.55, 0, k0 + i * 4)); continue; }   // a stone
    const ca = Math.cos(a), sa = Math.sin(a), pt = (px, py) => [x + px * ca - py * sa, y + (px * sa + py * ca) * sq], face = mix(W.paper, mix(W.haze, W.earth[0], 0.5), 0.55 * (1 - t) + 0.15);
    b.add(face, 0.9, (c) => { const q = [pt(-s, -s * 0.7), pt(s, -s * 0.75), pt(s * 0.95, s * 0.7), pt(-s, s * 0.72)]; c.moveTo(...q[0]); for (const v of q.slice(1)) c.lineTo(...v); c.closePath(); });
    b.add(mix(W.earth[1], W.near, 0.5), 0.45, (c) => { const q = [pt(-s, s * 0.72), pt(s * 0.95, s * 0.7), pt(s * 0.95, s * 1.05), pt(-s, s * 1.05)]; c.moveTo(...q[0]); for (const v of q.slice(1)) c.lineTo(...v); c.closePath(); });
  }
  b.fill(ctx);
}
/** Dead grass along the foot of the field, dark against the ground and thicker toward the sides: the near edge of the picture. `amt`: more of it, taller. */
function wlScrub(ctx, P, amt, k0) {
  const { F, fw, fh, u } = P, n = Math.round(10 + 34 * amt);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const t = rand(k0 + i * 1.3), x = F.x0 + fw * (t < 0.5 ? t ** 1.7 : 1 - (1 - t) ** 1.7), y = F.y1 + fh * 0.012 - fh * 0.05 * rand(k0 + i * 1.9) ** 2, hgt = u * (0.025 + 0.06 * rand(k0 + i * 2.3)) * (0.5 + amt);
    for (let j = 0, m = 4 + Math.floor(rand(k0 + i * 2.9) * 6); j < m; j++) { const a = -Math.PI / 2 + (rand(k0 + i * 3.1 + j) - 0.5) * 1.3, l = hgt * (0.5 + rand(k0 + i * 3.7 + j) * 0.6), bx = x + (j - m / 2) * u * 0.002; wlTaper(ctx, bx, y, bx + Math.cos(a) * l, y + Math.sin(a) * l, u * 0.0032, u * 0.0006, (rand(k0 + i * 4.1 + j) - 0.5) * 0.25); }
  }
  ctx.fillStyle = css(mix(wl().near, wl().earth[1], 0.2)); ctx.fill();
}
/** A lone figure seen from behind, `s` tall, its feet at (x, y): a long coat, a hood, a pack; a rim of the sun's light down one side and the hot accent in the lamp it carries. */
function wlFigure(ctx, x, y, s, hot, toSun, a) {
  const W = wl(), body = dark ? [14, 16, 16] : [38, 44, 54], rim = mix(W.hot, [255, 240, 220], 0.3);
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.6); g.addColorStop(0, css(W.near, 0.4)); g.addColorStop(1, css(W.near, 0));   // its shadow on the ground
  ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.12); ctx.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2); ctx.restore();
  ctx.fillStyle = css(body); ctx.beginPath();
  wlTaper(ctx, x - s * 0.06, y, x - s * 0.05, y - s * 0.42, s * 0.08, s * 0.1);   // legs
  wlTaper(ctx, x + s * 0.05, y, x + s * 0.04, y - s * 0.42, s * 0.08, s * 0.1);
  ctx.moveTo(x - s * 0.17, y - s * 0.3); ctx.lineTo(x - s * 0.13, y - s * 0.78); ctx.quadraticCurveTo(x, y - s * 0.86, x + s * 0.13, y - s * 0.78); ctx.lineTo(x + s * 0.18, y - s * 0.28); ctx.closePath();   // the coat
  ctx.moveTo(x + s * 0.08, y - s * 0.86); ctx.arc(x, y - s * 0.87, s * 0.085, 0, TAU);   // the hood
  ctx.rect(x - s * 0.12 - (toSun > 0 ? 0.04 * s : 0), y - s * 0.74, s * 0.2, s * 0.24);   // the pack
  ctx.fill();
  ctx.fillStyle = css(rim, 0.55); ctx.beginPath(); wlTaper(ctx, x + toSun * s * 0.16, y - s * 0.32, x + toSun * s * 0.12, y - s * 0.76, s * 0.025, s * 0.012); ctx.fill();   // the low sun along its side
  const lamp = mix(hot, [255, 226, 170], 0.65), lx = x - toSun * s * 0.2, ly = y - s * 0.36, lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, s * 0.3);   // the lamp it carries: a small warm light
  lg.addColorStop(0, css(lamp, 0.55)); lg.addColorStop(1, css(lamp, 0)); ctx.fillStyle = lg; ctx.fillRect(lx - s * 0.3, ly - s * 0.3, s * 0.6, s * 0.6);
  ctx.fillStyle = css(mix(lamp, [255, 255, 240], 0.5)); ctx.beginPath(); ctx.arc(lx, ly, s * 0.022, 0, TAU); ctx.fill();
  ctx.restore();
}
/** Mist lying along y: a soft band thickest at y and thinning upward, with long thin strokes of the haze drawn through it. `a`: how thick; `onto`: on what is painted only (see wlSunGlow). */
function wlMist(ctx, P, y, th, a, k0, onto = false) {
  if (a <= 0) return;
  const { F, fw } = P, W = wl(), g = ctx.createLinearGradient(0, y - th, 0, y + th * 0.5);
  ctx.save(); if (onto) ctx.globalCompositeOperation = "source-atop";
  g.addColorStop(0, css(W.haze, 0)); g.addColorStop(0.7, css(W.haze, 0.75 * a)); g.addColorStop(1, css(W.haze, 0.4 * a));
  ctx.fillStyle = g; ctx.fillRect(F.x0, y - th, fw, th * 1.5);
  const b = wlBatch();
  for (let i = 0; i < 26; i++) { const len = fw * (0.1 + rand(k0 + i * 1.9) * 0.35), yy = y - th * rand(k0 + i * 2.3) ** 1.5 * 0.9; b.add(wlStep(W.haze, rand(k0 + i * 2.9), 1, 0.03), 0.35 * a, (c) => wlKnife(c, F.x0 - fw * 0.1 + fw * 1.1 * rand(k0 + i * 3.3), yy, len, th * (0.08 + rand(k0 + i * 3.9) * 0.2), (rand(k0 + i * 4.3) - 0.5) * 0.02, k0 + i * 5)); }
  b.fill(ctx); ctx.restore();
}
// ---------- the wasteland's photo, painted over in brush strokes of its own colours
/** The ramps a painted photo's lightness goes onto: the dusk's teal-black to bone, the snowfield's slate to white. */
const WL_RAMP = {
  dark: toneTable([[0, [24, 32, 32]], [0.22, [44, 54, 50]], [0.45, [86, 90, 74]], [0.68, [142, 132, 104]], [0.86, [198, 182, 146]], [1, [238, 226, 196]]]),
  light: toneTable([[0, [52, 64, 80]], [0.3, [98, 114, 132]], [0.55, [150, 164, 178]], [0.78, [202, 210, 216]], [1, [246, 245, 240]]]),
};
/** Lightness in five soft-edged steps, so a picture falls into a few planes of value, as a painter groups them. */
const WL_STEPS = (() => { const o = new Float32Array(256); for (let l = 0; l < 256; l++) { const v = l / 255; let q = 0; for (let j = 1; j < 5; j++) { const e = clamp((v - j / 5 + 0.06) / 0.12); q += (e * e * (3 - 2 * e)) / 4; } o[l] = q * 0.92 + 0.04; } return o; })();
/**
 * RGBA pixels brought into the painting's palette, mixed in by a: the lightness grouped into planes,
 * lifted out of black as haze lifts the shadows, onto the ramp, and some of the pixel's own colour kept
 * at its new lightness — more of a warm, strong one, the painting's one hot accent. Alpha kept.
 */
export function wlPixels(d, a = 1, dk = dark) {
  const lut = dk ? WL_RAMP.dark : WL_RAMP.light, lo = dk ? 0.07 : 0.2, hi = dk ? 0.94 : 0.99;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], L = (r * 54 + g * 183 + b * 19) / 65280, s = L * L * (3 - 2 * L), v0 = 0.55 * L + 0.45 * s, v = lo + (hi - lo) * (0.55 * v0 + 0.45 * WL_STEPS[(v0 * 255) | 0]), j = Math.round(v * 255) * 3;
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b, sat = mx ? (mx - mn) / mx : 0, warm = r > b ? clamp((r - b) / 120) * clamp(sat * 2.5 - 0.25) : 0;
    const keep = (dk ? 0.3 : 0.34) + 0.45 * warm, k = (v * 255) / Math.max(8, L * 255), damp = keep * (1 - 0.35 * clamp(k - 1.6));
    const R = lut[j] + (r * k - lut[j]) * damp, G = lut[j + 1] + (g * k - lut[j + 1]) * damp, B = lut[j + 2] + (b * k - lut[j + 2]) * damp;
    d[i] = r + (R - r) * a; d[i + 1] = g + (G - g) * a; d[i + 2] = b + (B - b) * a;
  }
}
/** A small PRNG (mulberry32): the photo's strokes fall the same way every time, in the preview and the export alike. */
function wlRng(s) { return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A canvas `w` × `h` holding what `src` (an image or a canvas) holds, drawn down by halves so it is averaged, not sampled. */
function wlDown(src, w, h) {
  let c = src, cw = src.naturalWidth || src.width, ch = src.naturalHeight || src.height;
  while (cw / 2 > w && ch / 2 > h) { const n = document.createElement("canvas"); n.width = Math.round(cw / 2); n.height = Math.round(ch / 2); const x = n.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, n.width, n.height); c = n; cw = n.width; ch = n.height; }
  const n = document.createElement("canvas"); n.width = w; n.height = h;
  const x = n.getContext("2d", { willReadFrequently: true }); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, w, h);
  return n;
}
/** A soft copy of canvas c at its own size: drawn down f times and up again. */
function wlSoft(c, f) {
  const s = wlDown(c, Math.max(2, Math.round(c.width / f)), Math.max(2, Math.round(c.height / f))), n = document.createElement("canvas");
  n.width = c.width; n.height = c.height;
  const x = n.getContext("2d", { willReadFrequently: true }); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(s, 0, 0, c.width, c.height);
  return n;
}
/** A box blur of a channel of floats, in place: `n` passes of radius r, across and down. */
function wlBlur(a, w, h, r, n = 2) {
  const t = new Float32Array(a.length), q = 2 * r + 1;
  for (let p = 0; p < n; p++) {
    for (let y = 0; y < h; y++) { const o = y * w; let s = 0; for (let x = -r; x <= r; x++) s += a[o + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { t[o + x] = s / q; s += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { a[y * w + x] = s / q; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
  }
}
/**
 * Which way a stroke runs at each point: along the edges, across the change in lightness (the structure
 * tensor of the picture, smoothed at r); where the picture is flat, a slow drift a little off level.
 * Returns the cosine and sine of the angle at each pixel.
 */
function wlFlow(px, w, h, r) {
  const n = w * h, L = new Float32Array(n), xx = new Float32Array(n), yy = new Float32Array(n), xy = new Float32Array(n);
  for (let i = 0, q = 0; q < n; i += 4, q++) L[q] = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722;
  wlBlur(L, w, h, 1, 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = y * w + x, gx = L[q + (x < w - 1 ? 1 : 0)] - L[q - (x > 0 ? 1 : 0)], gy = L[q + (y < h - 1 ? w : 0)] - L[q - (y > 0 ? w : 0)];
    xx[q] = gx * gx; yy[q] = gy * gy; xy[q] = gx * gy;
  }
  for (const a of [xx, yy, xy]) wlBlur(a, w, h, r, 2);
  const c = new Float32Array(n), s = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const q = y * w + x, a = xx[q], b = yy[q], d = xy[q], tr = a + b, ev = Math.sqrt((a - b) * (a - b) + 4 * d * d);
    const wgt = tr > 1e-6 ? clamp((ev / tr) * clamp(Math.sqrt(tr) / 30) * 1.6) : 0, ang = 0.5 * Math.atan2(2 * d, a - b) + Math.PI / 2;
    const drift = -0.3 + 0.55 * Math.sin(x * 0.013 + y * 0.006) * Math.cos(y * 0.009 - x * 0.003);
    const c2 = Math.cos(2 * ang) * wgt + Math.cos(2 * drift) * (1 - wgt), s2 = Math.sin(2 * ang) * wgt + Math.sin(2 * drift) * (1 - wgt), A = 0.5 * Math.atan2(s2, c2);
    c[q] = Math.cos(A); s[q] = Math.sin(A);
  }
  return { c, s };
}
/**
 * Strokes as a flat brush leaves them: a band along their points, its sides a little uneven and narrowing
 * a little toward the tail, both ends cut square across and a little aslant, crisp; down some of the broad
 * ones a hair a little lighter or darker. `f` scales them from the size they were laid out at.
 */
function wlBrush(x, list, f) {
  for (const s of list) {
    const pts = s.pts, r = s.r * f, n = pts.length / 2, a = s.a;
    x.fillStyle = `rgb(${s.c[0] | 0},${s.c[1] | 0},${s.c[2] | 0})`; x.beginPath();
    if (n === 1) { x.ellipse(pts[0] * f, pts[1] * f, r, r * 0.8, a * 3, 0, TAU); x.fill(); continue; }
    const N = [], wob = (i, q) => Math.sin(a * 91.7 + i * 2.3 + q * 5.1) * 0.07 * r;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), dx = pts[i1 * 2] - pts[i0 * 2], dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1], m = Math.hypot(dx, dy) || 1;
      N.push(-dy / m, dx / m, dx / m, dy / m, r * (1 - (i / (n - 1)) * 0.22));
    }
    const sl = (((a * 17.3) % 1) - 0.5) * r * 0.7, sh = (((a * 29.1) % 1) - 0.5) * r * 0.5, ext = r * 0.25;   // how aslant its tail and its head are cut
    const side = (i, q) => { const w = N[i * 5 + 4] + wob(i, q), o = (q ? -1 : 1) * w, e = i === n - 1 ? ext + (q ? -sl : sl) : i === 0 ? -ext * 0.4 + (q ? -sh : sh) : 0; return [pts[i * 2] * f + N[i * 5] * o + N[i * 5 + 2] * e, pts[i * 2 + 1] * f + N[i * 5 + 1] * o + N[i * 5 + 3] * e]; };
    for (let i = 0; i < n; i++) { const [px, py] = side(i, 0); (i ? x.lineTo : x.moveTo).call(x, px, py); }
    for (let i = n - 1; i >= 0; i--) { const [px, py] = side(i, 1); x.lineTo(px, py); }
    x.closePath(); x.fill();
    if (s.k < 2 && r > 3 && a < 0.6) {   // the hairs of a broad brush: a lighter or a darker streak down part of it
      const o = ((a * 7.3) % 1) * 1.2 - 0.6, v = a < 0.3 ? 1.08 : 0.93, i0 = Math.floor(((a * 13.7) % 1) * (n - 1) * 0.5), i1 = Math.max(i0 + 1, n - 1 - Math.floor(((a * 5.9) % 1) * (n - 1) * 0.4));
      x.lineWidth = Math.max(0.7, r * (0.08 + ((a * 3.1) % 1) * 0.1)); x.lineCap = "butt"; x.strokeStyle = `rgba(${(s.c[0] * v) | 0},${(s.c[1] * v) | 0},${(s.c[2] * v) | 0},0.32)`; x.beginPath();
      for (let i = i0; i <= i1; i++) { const q = o * N[i * 5 + 4]; (i > i0 ? x.lineTo : x.moveTo).call(x, pts[i * 2] * f + N[i * 5] * q, pts[i * 2 + 1] * f + N[i * 5 + 1] * q); }
      x.stroke();
    }
  }
}
/**
 * A picture (RGBA d, w × h) painted over in brush strokes of its own colours, as a painter lays them:
 * the broadest brush everywhere, then each finer one only where the painting so far is still far from
 * the picture seen at that brush's scale (Hertzmann's way), so flat parts keep broad strokes and detail
 * gets fine ones — a face stays a face. Each stroke has a length of its own, two to four times its width,
 * runs along the edges from where it starts, and is cut short where it would cross an edge seen at its own
 * brush's scale (a texture finer than the brush does not stop it), never shorter than a dab; it takes the
 * colour there, mixed afresh — a little lighter or darker, warmer or cooler, richer or greyer. Strokes are
 * laid in no order; a last pass lays short strokes a little lighter on the highlights, as a painter puts
 * the lights on last. The colours are first brought into the palette (wlPixels).
 * The strokes are laid out on one analysis image (640 on the long side), made from `src` — the photo itself,
 * whatever size its copy d is (see treatedOf) — or else from d; each cell of each brush has randoms of its
 * own, from `sd` and where it is, and the strokes are laid in an order drawn the same way: so the preview,
 * a draft and the export place the same strokes, painted at w × h. Writes into d.
 */
function wlPaintPhoto(d, w, h, dk = dark, sd = seed, src = null) {
  if (typeof document === "undefined" || w < 4 || h < 4) return wlPixels(d, 1, dk);
  const out = document.createElement("canvas"); out.width = w; out.height = h;
  const sx = out.getContext("2d", { willReadFrequently: true }), memo = src && WL_STROKES.get(src), mk = wlStrokesKey(src, dk, sd);   // a blurred copy is a canvas filled again for each blur: its fillings count
  const L = memo && memo.key === mk ? memo : wlLayStrokes(src, d, w, h, dk, sd, sx, out);
  if (src && L !== memo) WL_STROKES.set(src, L);
  sx.setTransform(1, 0, 0, 1, 0, 0); sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = "high";
  sx.globalCompositeOperation = "copy"; sx.drawImage(L.under, 0, 0, w, h); sx.globalCompositeOperation = "source-over";
  wlBrush(sx, L.all, w / L.aw); wlBrush(sx, L.lights, w / L.aw);
  const px = sx.getImageData(0, 0, w, h).data;
  for (let i = 3; i < d.length; i += 4) { const a = d[i]; d[i - 3] = px[i - 3]; d[i - 2] = px[i - 2]; d[i - 1] = px[i - 1]; d[i] = a; }   // the picture's own alpha kept
}
/** The strokes a photo is painted in, laid out once for it, its ground and seed (see wlPaintPhoto): an export or a paint at another size lays the same ones again. */
let WL_STROKES = new WeakMap();
const wlStrokesKey = (src, dk, sd) => `${dk ? 1 : 0}|${sd}|${src ? `${src.filled || 0}|${src.naturalWidth || src.width}x${src.naturalHeight || src.height}` : ""}`;
/**
 * Lays out the strokes of wlPaintPhoto on its analysis image (from `src`, or else from d, w × h, put on `out`
 * through sx). Returns { key, aw, ah, under, all, lights }: the analysis size, the underpainting there, the strokes.
 */
function wlLayStrokes(src, d, w, h, dk, sd, sx, out) {
  const src0 = src, sw = src ? src.naturalWidth || src.width : w, sh = src ? src.naturalHeight || src.height : h, s = Math.min(1, 640 / Math.max(sw, sh)), aw = Math.max(8, Math.round(sw * s)), ah = Math.max(8, Math.round(sh * s));
  if (!src) { sx.putImageData(new ImageData(d, w, h), 0, 0); src = out; }
  else if (Math.max(sw, sh) > 2560) { const k = 1280 / Math.max(sw, sh), m = document.createElement("canvas"); m.width = Math.round(sw * k); m.height = Math.round(sh * k); const x = m.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, m.width, m.height); src = m; }   // a large photo drawn down in one step first
  const small = wlDown(src, aw, ah), mx = small.getContext("2d", { willReadFrequently: true }), img = mx.getImageData(0, 0, aw, ah), sharp = img.data;
  wlPixels(sharp, 1, dk); mx.putImageData(img, 0, 0);
  const unit = Math.max(aw, ah) / 640, sizes = [18, 9, 4.5, 2.3, 1.4].map((r) => r * unit), T = [0, 14, 17, 21, 32], flow = wlFlow(sharp, aw, ah, Math.max(3, Math.round(6 * unit)));
  const P = document.createElement("canvas"); P.width = aw; P.height = ah;
  const pg = P.getContext("2d", { willReadFrequently: true }), under = wlSoft(small, sizes[0] * 0.5), all = [];
  pg.drawImage(under, 0, 0);   // the underpainting: the picture soft
  const at = (x, y) => ((y < 0 ? 0 : y >= ah ? ah - 1 : y | 0) * aw + (x < 0 ? 0 : x >= aw ? aw - 1 : x | 0)) * 4;
  const diff = (a, i, b, j) => Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2]));
  const cellR = (k, i, j) => wlRng((Math.imul(sd | 0, 7919) ^ Math.imul(k + 1, 73856093) ^ Math.imul(i + 1, 19349663) ^ Math.imul(j + 1, 83492791)) | 0);   // a cell's own randoms
  const byOrder = (p, q) => p.o - q.o;
  /** A stroke r wide starting at (cx, cy) in colour col, traced both ways along the flow for up to `half` each way while ref stays within `stop` of col. */
  const trace = (ref, cx, cy, col, r, half, stop, turn = 0) => {
    const head = [cx, cy], tail = [], step = r * 0.55, q0 = at(cx, cy) / 4, c0 = flow.c[q0] || 1, s0 = flow.s[q0] || 0, ct = Math.cos(turn), st = Math.sin(turn);
    for (const sgn of [1, -1]) {
      let px = cx, py = cy, dx = (c0 * ct - s0 * st) * sgn, dy = (s0 * ct + c0 * st) * sgn;
      for (let run = 0; run < half; run += step) {
        const nx = px + dx * step, ny = py + dy * step;
        if (nx < -r || ny < -r || nx > aw + r || ny > ah + r) break;
        const q = at(nx, ny);
        if (Math.max(Math.abs(ref[q] - col[0]), Math.abs(ref[q + 1] - col[1]), Math.abs(ref[q + 2] - col[2])) > stop) break;
        (sgn > 0 ? head : tail).push(nx, ny);
        const f = q / 4;
        let ex = flow.c[f], ey = flow.s[f];
        if (ex * dx + ey * dy < 0) { ex = -ex; ey = -ey; }
        dx = dx * 0.5 + ex * 0.5; dy = dy * 0.5 + ey * 0.5; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m; px = nx; py = ny;
      }
    }
    const pts = []; for (let i = tail.length - 2; i >= 0; i -= 2) pts.push(tail[i], tail[i + 1]); pts.push(...head);
    if (pts.length < 6) { const q0 = at(cx, cy) / 4, dx = flow.c[q0] || 1, dy = flow.s[q0] || 0; return [cx - dx * r * 0.7, cy - dy * r * 0.7, cx, cy, cx + dx * r * 0.7, cy + dy * r * 0.7]; }   // never less than a dab
    return pts;
  };
  /** The colour mixed afresh for a stroke, with randoms R: a little lighter or darker, warmer or cooler, richer or greyer, by `v` (less for the finer brushes). */
  const fresh = (R, col, v) => { const l = col[0] * 0.2126 + col[1] * 0.7152 + col[2] * 0.0722, sat = 1 + (R() - 0.5) * 0.4 * v, val = 1 + (R() - 0.5) * 0.16 * v, warm = (R() - 0.5) * 18 * v; return [(l + (col[0] - l) * sat) * val + warm, (l + (col[1] - l) * sat) * val + warm * 0.2, (l + (col[2] - l) * sat) * val - warm]; };
  sizes.forEach((r, k) => {
    const ref = wlSoft(small, Math.max(1, r * 0.5)).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aw, ah).data, cur = k ? pg.getImageData(0, 0, aw, ah).data : null, g = Math.max(1, r * (k ? 0.8 : 0.72)), list = [];
    const stop = [34, 28, 24, 22, 22][k], v = [1, 0.85, 0.65, 0.5, 0.35][k];
    for (let j = 0, y = g / 2; y < ah; j++, y += g) for (let i = 0, x = g / 2; x < aw; i++, x += g) {
      let cx = x, cy = y;
      if (k) {   // the error over the cell; the stroke starts where it is worst
        let sum = 0, worst = -1;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const px = x + (a * g) / 3, py = y + (b * g) / 3, q = at(px, py), e = diff(ref, q, cur, q); sum += e; if (e > worst) { worst = e; cx = px; cy = py; } }
        if (sum / 9 < T[k]) continue;
      }
      const R = cellR(k, i, j);   // made only for a cell that gets a stroke
      if (!k) { cx += (R() - 0.5) * g * 0.9; cy += (R() - 0.5) * g * 0.9; }
      const c0 = at(cx, cy), col = [ref[c0], ref[c0 + 1], ref[c0 + 2]];
      list.push({ pts: trace(ref, cx, cy, col, r, r * (1.5 + R() * 1.6), stop, (R() - 0.5) * 0.5 * v), r: r * (0.8 + R() * 0.3), c: fresh(R, col, v), k, a: R(), o: R() });
    }
    list.sort(byOrder);   // in no order, as a hand lays them
    wlBrush(pg, list, 1);
    for (const q of list) all.push(q);
  });
  // the lights, last: where the picture is among its brightest and brighter than what is about it
  const lum = (a, q) => a[q] * 0.2126 + a[q + 1] * 0.7152 + a[q + 2] * 0.0722, hist = new Uint32Array(256);
  for (let q = 0; q < sharp.length; q += 16) hist[lum(sharp, q) | 0]++;
  let top = 255; for (let n = 0, tot = sharp.length / 16; top > 0 && n < tot * 0.07; top--) n += hist[top];
  const lights = [], r3 = 3.2 * unit, ref3 = wlSoft(small, Math.max(1, r3 * 0.5)).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aw, ah).data, wide = wlSoft(small, Math.max(2, r3 * 5)).getContext("2d", { willReadFrequently: true }).getImageData(0, 0, aw, ah).data;
  for (let j = 0, y = r3; y < ah; j++, y += r3 * 1.4) for (let i = 0, x = r3; x < aw; i++, x += r3 * 1.4) {
    const R = cellR(9, i, j), cx = x + (R() - 0.5) * r3, cy = y + (R() - 0.5) * r3, q = at(cx, cy);
    if (lum(sharp, q) < top || lum(ref3, q) - lum(wide, q) < 10 || R() < 0.4) continue;
    const col = [ref3[q], ref3[q + 1], ref3[q + 2]].map((c) => c + (255 - c) * 0.22);
    lights.push({ pts: trace(ref3, cx, cy, col, r3, r3 * (0.8 + R()), 34), r: r3 * (0.6 + R() * 0.4), c: [col[0] * 1.02 + 4, col[1] * 1.01 + 2, col[2] * 0.99], k: 3, a: R(), o: R() });
  }
  lights.sort(byOrder);
  return { key: wlStrokesKey(src0, dk, sd), aw, ah, under, all, lights };
}
// ---------- the wasteland's lettering and surfaces
/** A tile of dry-brush streaks, white on clear: long thin bristle marks running level, a few broad. Kept. */
function wlBristles() {
  if (WORK.wlBristles) return WORK.wlBristles;
  const c = (WORK.wlBristles = document.createElement("canvas")); c.width = 512; c.height = 128;
  const x = c.getContext("2d"), R = wlRng(4711);
  x.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    const y = R() * 128, x0 = R() * 512, len = 20 + R() ** 2 * 300, lw = 0.5 + R() ** 4 * 3.5;
    x.strokeStyle = `rgba(255,255,255,${0.2 + R() * 0.7})`; x.lineWidth = lw;
    for (const dx of [0, -512, 512]) { x.beginPath(); x.moveTo(x0 + dx, y); x.lineTo(x0 + dx + len, y + (R() - 0.5) * 3); x.stroke(); }
  }
  return c;
}
/**
 * A canvas tile for the painting's support: threads of a coarse linen running both ways, uneven, with
 * the tooth of the gesso in between; grey about the middle for overlay on the dusk, near white for
 * multiply on the snow. Kept per kind.
 */
function wlCanvasTile(light) {
  const key = light ? "wlLinenL" : "wlLinenD";
  if (WORK[key]) return WORK[key];
  const n = 192, c = (WORK[key] = document.createElement("canvas")); c.width = c.height = n;
  const x = c.getContext("2d"), d = x.createImageData(n, n), R = wlRng(light ? 77 : 78), row = [], col = [];
  for (let i = 0; i < n; i++) { row.push((R() - 0.5) * 30); col.push((R() - 0.5) * 30); }
  for (let y = 0; y < n; y++) for (let xx = 0; xx < n; xx++) {
    const wy = Math.sin((y / n) * TAU * 48 + Math.sin(xx * 0.05) * 0.4), wx = Math.sin((xx / n) * TAU * 48 + Math.sin(y * 0.05) * 0.4), over = (Math.floor(xx / 4) + Math.floor(y / 4)) % 2;
    const v = (over ? wy : wx) * 18 + row[y] * 0.5 + col[xx] * 0.5 + (R() - 0.5) * 22, i = (y * n + xx) * 4;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = light ? 236 + v * 0.55 : 128 + v; d.data[i + 3] = 255;
  }
  x.putImageData(d, 0, 0);
  return c;
}
/** Lays the canvas's weave over the whole picture: overlay on the dusk, multiply on the snow; `unit`, the canvas's pixels to the cover's. */
function wlLinen(ctx, amt, unit) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const pat = ctx.createPattern(wlCanvasTile(!dark), "repeat");
  if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(Math.max(0.35, unit * 1.2)));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = dark ? "overlay" : "multiply"; ctx.globalAlpha = Math.min(1, amt * (dark ? 0.7 : 0.55)) * clamp(unit * 1.6); ctx.fillStyle = pat; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();   // as fine as the canvas is small, and fainter: a thumbnail's weave would be noise
}
/** A tile of a dry brush's skips, white on clear: short thin level dashes where the paint did not take, many in runs along a stroke, a few longer. Kept. */
function wlFlecks() {
  if (WORK.wlFlecks) return WORK.wlFlecks;
  const n = 256, c = (WORK.wlFlecks = document.createElement("canvas")); c.width = c.height = n;
  const x = c.getContext("2d"), R = wlRng(4712);
  x.fillStyle = "#fff";
  for (let i = 0; i < 300; i++) {
    const y = R() * n, x0 = R() * n, run = R() < 0.55 ? 2 + Math.floor(R() * 4) : 1;
    let xx = x0;
    for (let j = 0; j < run; j++) {
      const len = 3 + R() ** 2 * 28, th = 0.6 + R() ** 3 * 2, yy = y + (R() - 0.5) * 1.2, a = (R() - 0.5) * 0.05;
      x.globalAlpha = 0.45 + R() * 0.55;
      for (const dx of [0, -n, n]) for (const dy of [0, -n, n]) { x.beginPath(); x.ellipse(xx + len / 2 + dx, yy + dy, len / 2, th / 2, a, 0, TAU); x.fill(); }
      xx += len + 2 + R() * 8;
    }
  }
  return c;
}
/** A tile (see wlBristles, wlFlecks) as a fill, scaled so its side spans `span` of ctx's units. */
function wlTileFill(ctx, tile, span) {
  const pat = ctx.createPattern(tile, "repeat");
  if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(span / tile.height));
  return pat;
}
/**
 * Letters painted on a sign, on a work canvas the size of the line: each in its colour, the paint a little
 * uneven — lighter where the brush dragged, a soft patch thinner — its edges chipped where it has flaked
 * (flecks let into a band along the edge), a few dry flecks inside. Laid down on ctx.
 */
function wlLetters(ctx, B, fs, right, each, groups) {
  const E = dkWork(ctx, "wlLetters", B), M = dkWork(ctx, "wlChips", B), box = [-fs, -fs * 1.5, right + fs * 2, fs * 3];
  for (const [hi, col] of groups) { E.fillStyle = css(col); each((c, x) => E.fillText(c.t, x, 0), hi); }
  E.globalCompositeOperation = "source-atop";
  E.globalAlpha = 0.13; E.fillStyle = wlTileFill(E, wlBristles(), fs * 0.7); E.fillRect(...box);   // lighter where the brush dragged
  E.globalCompositeOperation = "destination-out";
  M.lineJoin = "round"; M.strokeStyle = "#fff"; M.lineWidth = fs * 0.045; each((c, x) => M.strokeText(c.t, x, 0));   // a band along every edge…
  M.globalCompositeOperation = "destination-in"; M.fillStyle = wlTileFill(M, wlFlecks(), fs * 0.6); M.fillRect(...box);   // …holding only the skips
  E.globalAlpha = 0.95; E.save(); E.setTransform(1, 0, 0, 1, 0, 0); E.drawImage(M.canvas, 0, 0); E.restore();
  E.globalAlpha = 0.45; E.fillStyle = wlTileFill(E, wlFlecks(), fs * 0.9); E.fillRect(...box);   // and the dry brush's skips inside, along the stroke
  E.globalAlpha = 1; E.globalCompositeOperation = "source-over";
  inPixels(ctx, () => ctx.drawImage(E.canvas, B.x0, B.y0));
  wlLetGo(ctx, "wlLetters", "wlChips");
}
export const wasteland = {
  id: "wasteland",
  repaint: (c) => `a digital concept painting of a quiet post-apocalyptic wasteland made from the photograph: loose flat brush and palette-knife strokes, nothing outlined, edges lost in atmospheric haze, layered silhouettes receding into mist, muted harmonious olive, teal, dun and slate tones, one hot accent — a low blood-red sun, with ${c} kept only as a small touch — wet ground holding the sky, a sense of silence; still the same place and subject, no text.`,
  about: {
    zh: "寂静荒原：末日之后那片安静的废土，按数字概念绘画的方式画出来——大笔和刮刀一笔一笔铺上去的平涂笔触，什么都不勾线，边缘都消失在雾里；废墟楼群、远处的巨构建筑和枯树林一层层退进雾霭，电线杆拉着下垂的电线，一柱浓烟斜斜升起，积水映着天空，地上散着吹落的纸张；一个小小的人影站在这一切面前。色调低沉而和谐，只留一处滚烫的点睛：一轮低垂的落日。深色是橄榄绿和青灰的黄昏、一轮血红的太阳，浅色是雾中的雪原、冷冷的蓝灰白里一轮橙色的太阳。色块是前景里一堵很久以前刷了频道色的旧墙，上沿受光、长着枯草。标题像刷在招牌上的字，干笔的毛边和笔痕，高亮字用点睛的红。安静、苍凉、满是故事——适合科幻、游戏、末日题材、纪录与人文、电影解读、旅行和情绪类内容。照片会被一笔一笔重新画过：用它自己的颜色，顺着轮廓走笔，平坦处用大笔、细节处用小笔，人脸依然认得出，颜色收进这幅画的色调里。自带平直的版式。",
    en: "Silent wasteland: the quiet world after the end, as digital concept painting shows it — flat strokes laid one by one with a broad brush and a palette knife, nothing outlined, every edge lost in haze; ruined blocks, a far-off megastructure and a dead forest receding layer by layer into the mist, power poles with sagging wires, a plume of smoke leaning in the wind, wet ground holding the sky, paper blown across it; a tiny figure facing it all. Muted, harmonious tones with one hot accent: a low sun. Dark is dusk in olive and teal under a blood-red sun, light a snowfield in fog, cold blue-white with an orange one. The colour block is a weathered wall in the foreground, painted in the channel colour long ago, the light catching its top and dead grass along it. The title is lettered as if brushed on a sign, its edges breaking into dry-brush hairs, the highlighted words in the accent's red. Quiet, desolate, full of story — for sci-fi, games, the end of the world, documentaries, film essays, travel and moody pieces. A photo is painted over stroke by stroke in its own colours, along its edges, broad where it is flat and fine where it has detail, so a face stays a face, and brought into the painting's palette. Flat layouts of its own.",
  },
  name: { zh: "寂静荒原", en: "Silent wasteland" },
  seeded: true,
  leave: wlFreeAll,   // what it keeps (its parts, work canvases, the strokes effect's results) goes as another look is chosen
  scene: { sun: { zh: "落日", en: "Low sun" }, mega: { zh: "巨构", en: "Megastructure" }, pole: { zh: "电线杆", en: "Power poles" }, plume: { zh: "烟柱", en: "Smoke plume" }, figure: { zh: "孤影", en: "Lone figure" } },
  params: [
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "落日", en: "Low sun" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "彩云", en: "Drifting clouds" } },
    { key: "mega", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "巨构", en: "Megastructure" } },
    { key: "ruins", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "废墟", en: "Ruined blocks" } },
    { key: "forest", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "枯林", en: "Dead forest" } },
    { key: "poles", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "电线杆", en: "Power poles" } },
    { key: "smoke", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "烟柱", en: "Smoke plume" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "积水倒影", en: "Wet ground" } },
    { key: "debris", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "散落纸张", en: "Scattered paper" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "孤影", en: "Lone figure" } },
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "雾霭", en: "Haze" } },
    { key: "chan", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "频道色点睛", en: "Channel colour for the accent" } },
    { key: "linen", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "画布纹理", en: "Canvas texture" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "颗粒", en: "Grain" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片重绘", en: "Photo painted" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => { const W = wl(); return { ...base, field: css(W.sky[1]), text: css(W.text), own: css(W.text), dim: css(W.text, 0.62), titleFill: css(W.text), titleInk: css(W.ink), grid: () => css(W.text, dark ? 0.08 : 0.12) }; },
  /**
   * The ground is the sky down to the horizon and the earth below, laid in long flat strokes (painted once
   * and kept). On it, or on the base's grid or nothing, each by its slider, from the back: the sun's glow
   * and disc, drifting clouds, the megastructure, the far row of ruins, the dead forest, the near ruins,
   * with mist between them; the smoke plume and its fire, the power poles, the puddles holding what stands
   * above them, scattered paper, the lone figure. Each part is painted once and kept on a canvas of its own
   * (wlKept), so a slider repaints only its part; a part dragged is laid down moved, not painted again. A
   * photo is painted over in strokes of its own colours (wlPaintPhoto, kept by drawPhotoAt's treatment, the
   * slider fading it in over the photo as it is); filling the canvas, it gets the mist at its foot.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (env.photo) {
      const a = p.photo, dk = dark, sd = seed;
      if (a < 1) env.drawPhoto();
      if (a > 0) {   // painted from the photo itself (src), the same at any size; while its blur is dragged, only brought into the palette
        ctx.save(); ctx.globalAlpha = a;
        env.drawPhoto(0, { key: `wl|${dk ? 1 : 0}|${sd}`, fn: (d, pw, ph, src) => wlPaintPhoto(d, pw, ph, dk, sd, src), quick: { key: `wl-quick|${dk ? 1 : 0}`, fn: (d) => wlPixels(d, 1, dk) } });
        ctx.restore();
      }
      if (L.fill && p.haze > 0) { const P = wlPlan(ctx, env); wlMist(ctx, P, P.F.y1, P.fh * 0.3, p.haze * 0.55, 4800); }
      return true;
    }
    const P = wlPlan(ctx, env), { F, fw, fh, u, H, side } = P, look = [dark ? 1 : 0, seed, w, h, F.x0, F.y0, F.x1, F.y1].join("|"), dd = dark ? 1 : 0.8;   // on the snow, what stands is darker against the fog
    if (L.ground !== false) wlLay(ctx, "wlGround", look, { x: 0, y: 0, w, h }, (x) => wlGround(x, env, P));
    if (!L.grid) return true;
    const sr = u * (0.034 + 0.054 * p.sun), sx0 = P.free(0.55), sun0 = [sx0, Math.min(H - sr * 0.25, P.below(sx0, H - u * 0.15, sr * 1.1))];   // above the ruins, or setting into them below the title
    const hot = wlHot(C, p), [sx, sy] = p.sun > 0 ? objAt("sun", sun0[0], sun0[1], ctx) : sun0, glow = mix(hot, wl().hot, 0.55);
    const onto = L.base === "clear";   // on a see-through base the air is left clear: light and mist only on what is painted
    if (p.sun > 0 && !onto) {
      const a = Math.min(1, p.sun * 2.5);
      wlSunGlow(ctx, P, sx, sy, sr, glow, a, 0.6 + 0.6 * p.sun); wlSunPath(ctx, P, sx, glow, a * p.sun);
      wlLay(ctx, "wlSunAir", `${look}|${p.sun}|${sun0}|${glow.map(Math.round)}`, { x: sun0[0] - sr * 12, y: sun0[1] - sr * 5, w: sr * 24, h: sr * 10 }, (x) => wlSunAir(x, P, sun0[0], sun0[1], sr, glow, a), sx - sun0[0], sy - sun0[1], true);   // the air about it, painted, moved with it
    }
    if (p.clouds > 0) wlLay(ctx, "wlClouds", `${look}|${p.clouds}|${P.free(0)}`, { x: F.x0, y: F.y0, w: fw, h: H - F.y0 + fh * 0.03 }, (x) => wlClouds(x, P, sun0[0], p.clouds));
    if (p.sun > 0) wlSun(ctx, sx, sy, sr, hot, Math.min(1, p.sun * 4));
    if (p.sun > 0 && p.clouds > 0) {   // a bar or two of cloud across the sun itself
      ctx.fillStyle = css(mix(wl().cloud[0], wlSkyAt(P, sy), 0.5), Math.min(0.9, p.clouds * 2)); ctx.beginPath();
      for (let i = 0; i < 2; i++) wlKnife(ctx, sx - sr * (2.4 + i * 0.7), sy + sr * (i ? 0.5 : -0.05), sr * (4.2 + i * 1.6), sr * (0.1 + i * 0.07), (rand(4590 + i) - 0.5) * 0.04, 4591 + i * 7);
      ctx.fill();
    }
    if (p.mega > 0) {   // a scene object, its handle half way up
      const s = fh * (0.3 + 0.45 * p.mega), mx0 = P.free(0.18), [mx, my] = objAt("mega", mx0, H - s * 0.5, ctx);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.mega * 4);
      wlLay(ctx, "wlMega", `${look}|${p.mega}|${mx0}`, { x: mx0 - s * 0.6, y: H - s * 1.25, w: s * 1.2, h: s * 1.25 + 4 }, (x, own) => wlMega(x, P, mx0, H + 2, s, 0.82 * dd, 4600, own), mx - mx0, my - (H - s * 0.5), true);
      ctx.restore();
    }
    if (p.sun > 0) wlSunGlow(ctx, P, sx, sy, sr, glow, Math.min(1, p.sun * 2.5) * 0.45, 0.45, onto);   // the sun's light in the haze in front of the far things
    if (p.smoke > 0) {   // a scene object: the plume, its handle at its foot
      const s = Math.min(fh, u * 1.25) * (0.3 + 0.5 * p.smoke), x0 = P.at(0.96), y0 = H - fh * 0.01, [px, py] = objAt("plume", x0, y0, ctx), toSun = Math.sign(sun0[0] - x0) || -side;
      if (!onto) wlFireGlow(ctx, px, py, s, hot, Math.min(1, p.smoke * 3));
      const drift = -side * 0.5 * Math.min(1, fw / fh);   // leaning less on a tall cover, where its head would hang over the title
      wlLay(ctx, "wlPlume", `${look}|${p.smoke}|${x0}|${toSun}`, wlPlumeBox(x0, y0, s, drift, p.smoke, 4740), (x) => wlPlume(x, P, x0, y0, s, drift, p.smoke, 4740, toSun), px - x0, py - y0, true);
    }
    wlMist(ctx, P, H, u * 0.16, p.haze * (dark ? 0.55 : 0.6), 4620, onto);
    if (p.ruins > 0) wlLay(ctx, "wlFar", `${look}|${p.ruins}|${sun0[0]}`, { x: F.x0, y: H - u * 0.34, w: fw, h: u * 0.34 + 4 }, (x) => wlSoftly(x, 1.25, (y) => wlRow(y, P, H + 2, H - u * (0.04 + 0.2 * p.ruins), 0.66 * dd, sun0[0], 1, 1, 4640), "wlFarSoft"));
    if (p.forest > 0) wlLay(ctx, "wlForest", `${look}|${p.forest}`, { x: F.x0, y: H - u * 0.3, w: fw, h: u * 0.34 }, (x) => wlForest(x, P, H + u * 0.02, u * (0.06 + 0.2 * p.forest), 0.5 * dd, p.forest, 4660));
    wlMist(ctx, P, H + u * 0.02, u * 0.1, p.haze * (dark ? 0.42 : 0.45), 4680, onto);
    if (p.ruins > 0.25) wlLay(ctx, "wlNear", `${look}|${p.ruins}|${sun0[0]}|${side}`, { x: F.x0, y: H - u * 0.26, w: fw, h: u * 0.34 }, (x) => {   // the near row, at the side away from the sun
      x.save(); x.beginPath(); x.rect(side > 0 ? F.x0 : F.x0 + fw * 0.62, F.y0, fw * 0.38, fh); x.clip();
      wlRow(x, P, H + u * 0.05, H - u * (0.02 + (0.16 * (p.ruins - 0.25)) / 0.75), 0.32 * dd, sun0[0], 0.6, 1.4, 4700);
      x.restore();
    });
    wlMist(ctx, P, H + u * 0.055, u * 0.08, p.haze * (dark ? 0.3 : 0.32), 4720, onto);
    const figS = u * (0.055 + 0.06 * p.figure), figX = sun0[0] - side * fw * 0.09;   // where the lone figure stands (see below)
    if (p.poles > 0) {   // a scene object: the line of poles moves with the nearest
      const b0 = F.y1 - fh * 0.04, tall = Math.min(fh, u * 1.25) * 0.72, vx = P.at(0.3), tg = env.G && env.G.tag, arm = tall * 0.14;
      let x0 = P.at(0.93);
      if (tg && x0 + arm > tg.x - 20 && x0 - arm < tg.x + 400 && b0 > tg.y - 20) x0 = vx > x0 ? tg.x + 400 + arm : tg.x - 20 - arm;   // clear of the corner tag (keepClear's box), toward the far poles
      const byFigure = p.figure > 0 && Math.abs(x0 - figX) < arm + figS * 0.5;
      if (byFigure) x0 = figX + (vx > x0 ? 1 : -1) * (arm + figS * 0.5);   // and of the lone figure, on past it (its wires out past the edge would cross it: none)
      const h0 = Math.max(tall * 0.4, b0 - P.below(x0, b0 - tall, u * 0.08)), [qx, qy] = objAt("pole", x0, b0 - h0 * 0.5, ctx);   // the nearest standing clear of the title
      wlLay(ctx, "wlPoles", `${look}|${p.poles}|${sun0[0]}|${h0}|${x0}|${byFigure}`, { x: Math.min(x0, vx) - u * 1.0, y: b0 - h0 * 1.12, w: Math.abs(x0 - vx) + u * 2, h: h0 * 1.2 }, (x) => wlPoles(x, P, x0, b0, h0, vx, H + fh * 0.01, 1 + 5 * p.poles, 4760, sun0[0], !byFigure), qx - x0, qy - (b0 - h0 * 0.5), true);
    }
    if (p.water > 0) wlWater(ctx, P, p.water, p.sun > 0 ? sx : undefined, glow, onto);
    if (p.debris > 0) wlLay(ctx, "wlDebris", `${look}|${p.debris}`, { x: F.x0, y: H, w: fw, h: F.y1 - H + 2 }, (x) => wlDebris(x, P, p.debris, 4780));
    if (p.forest > 0) wlLay(ctx, "wlScrub", `${look}|${p.forest}`, { x: F.x0, y: F.y1 - fh * 0.2, w: fw, h: fh * 0.22 }, (x) => wlScrub(x, P, p.forest, 4790));
    if (p.figure > 0) {   // a scene object, its handle at its middle
      const s = figS, x0 = figX, y0 = Math.min(F.y1 - s * 0.2, P.below(x0, H + Math.min(fh * 0.1, u * 0.14), s)), [fx, fy] = objAt("figure", x0, y0 - s * 0.5, ctx), a = Math.min(1, p.figure * 4);
      if (p.water > 0) { ctx.save(); if (onto) ctx.globalCompositeOperation = "source-atop"; ctx.translate(0, (fy + s * 0.5) * 2); ctx.scale(1, -1); wlFigure(ctx, fx, fy + s * 0.5, s, hot, side, a * 0.22); ctx.restore(); }   // and held in the wet ground (on a see-through base, only where there is ground)
      wlFigure(ctx, fx, fy + s * 0.5, s, hot, side, a);
    }
    return true;
  },
  /** A painter's squaring-up grid: squares to carry a sketch over, a diagonal across every other one. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 135, xs = every(s, w, s), ys = every(s, h, s);
    gridPen(ctx, color); gridPath(ctx, xs, ys, 0, 0, w, h);
    ctx.globalAlpha = 0.5; ctx.beginPath(); for (let x = 0; x < w; x += s * 2) for (let y = 0; y < h; y += s * 2) { ctx.moveTo(x, y); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s * 2, y + s); ctx.lineTo(x + s, y + s * 2); } ctx.stroke();
    ctx.restore();
  },
  accent: {
    fill: (C) => css(wlBlock(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** The block as a wall in the foreground, painted in the channel colour long ago (wlBoard): kept for its box, colour and ground. */
    body(ctx, B, nx, ny, C) {
      const c = wlBlock(C);
      wlLay(ctx, "wlBoard", `${dark ? 1 : 0}|${seed}|${c.map(Math.round)}|${nx},${ny}|${[B.x, B.y, B.w, B.h].map(Math.round)}`, B, (x) => wlBoard(x, B, nx, ny, c));
    },
    /**
     * Its edge as the paint leaves it: strokes along it reaching a little past it, ragged; the light from
     * above catching its lip, broken, a shade under the lip for its thickness (an edge facing down: the
     * shade only, and drips hanging from it); dead grass standing up along an edge facing the sky.
     */
    edge(ctx, run, nx, ny, C, p, pts) {
      if (!pts) return;
      const W = wl(), c = wlBlock(C), up = ny < -0.5, down = ny > 0.5, b = wlBatch(), lip = wlBatch(), grass = wlBatch(), lit = mix(mix(c, [255, 246, 226], dark ? 0.32 : 0.4), W.hot, 0.18);
      wlAlong(pts, 24).forEach(([x, y, tx, ty], i) => {
        const k = 6200 + i * 7.3, a = Math.atan2(ty, tx) + (rand(k) - 0.5) * 0.06, o = -2 + rand(k + 1) ** 2 * 9, len = 40 + rand(k + 2) * 80;
        b.add(wlBreak(c, rand(k + 3), rand(k + 4), 0.07, 5), 1, (q) => wlStroke(q, x + nx * o - tx * len * 0.3, y + ny * o - ty * len * 0.3, len, 7 + rand(k + 5) * 10, a, k + 6));
        if (!down && rand(k + 7) < (up ? 0.75 : 0.45)) { const ll = 30 + rand(k + 8) * 70, d = 2 + rand(k + 9) * 4; lip.add(wlStep(lit, rand(k + 10), 1, 0.05), up ? 0.8 : 0.45, (q) => wlStroke(q, x - nx * d - tx * ll * 0.3, y - ny * d - ty * ll * 0.3, ll, 2 + rand(k + 11) * 3.5, a, k + 12)); }
        if (rand(k + 13) < 0.7) { const ll = 40 + rand(k + 14) * 80, d = (down ? 4 : 11) + rand(k + 15) * 6; lip.add(mix(c, W.near, 0.4), 0.45, (q) => wlStroke(q, x - nx * d - tx * ll * 0.3, y - ny * d - ty * ll * 0.3, ll, 3 + rand(k + 16) * 5, a, k + 17)); }
        if (down && rand(k + 18) < 0.3) { const l = 8 + rand(k + 19) * 26, w = 2 + rand(k + 20) * 3; lip.add(wlStep(mix(c, W.near, 0.2), rand(k + 21), 1, 0.06), 0.8, (q) => wlTaper(q, x, y - 2, x + (rand(k + 22) - 0.5) * 2, y + l, w, w * 0.3)); }
        if (up && rand(k + 23) < 0.42) for (let j = 0, m = 3 + Math.floor(rand(k + 24) * 6); j < m; j++) {   // a tuft of dead grass
          const ga = -Math.PI / 2 + (rand(k + j * 1.3 + 25) - 0.5) * 1.1, gl = 14 + rand(k + j * 1.7 + 26) ** 1.4 * 70, bx = x + (j - m / 2) * 2.2;
          grass.add(wlStep(mix(W.near, c, 0.12), rand(k + j * 2.3 + 27), 1, 0.12), 0.95, (q) => wlTaper(q, bx, y + 6, bx + Math.cos(ga) * gl, y + 6 + Math.sin(ga) * gl, 3.2, 0.6, (rand(k + j * 2.9 + 28) - 0.5) * 0.3));
        }
      });
      b.fill(ctx); lip.fill(ctx); grass.fill(ctx);
    },
  },
  /**
   * Letters brushed on a sign: in the ground's ink or bone, each dragged through the bristles so its edges
   * break into hairs and its face is streaked where the dry brush skipped; a soft dark (or pale) haze behind
   * them so they read over the scene, a soft shade thrown off them (the shadow slider), a thin edge of the
   * other tone (the outline slider). The highlighted words are brushed in the hot accent, glowing a little
   * as the sun does.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    if (canPaint(ctx)) wlKeeps(ctx.canvas);   // a canvas on the page that shows the look (with its ground hidden too): its size is worth keeping for
    const W = wl(), fs = o.fs, s = Math.min(2, o.shadowAmt || 0), k = o.strokeAmt || 0, face = o.fill || W.text, light = lum(face) > 0.5;
    const chars = [];
    let cx = 0;
    pass((a, at) => { cx = at; for (const t of a.t) { const w = ctx.measureText(t).width; chars.push({ t, hi: a.hi, x: cx, s: a.s, dy: a.dy || 0 }); cx += w; } });
    const hot = o.hi || (!chars.some((c) => c.hi) ? face : (() => { const c = wlHot(o.C, p); return light ? mix(c, [255, 214, 180], clamp(0.36 - lum(c)) * 1.2) : mix(c, [40, 12, 8], clamp(lum(c) - 0.36) * 0.8); })());   // read only when a word is highlighted, so the accent's slider leaves the rest alone
    const each = (fn, only) => { for (const c of chars) if (only === undefined || c.hi === only) inPiece(c, () => fn(c, c.x)); };
    const flat = () => each((c, x) => { ctx.fillStyle = css(c.hi ? hot : face); ctx.fillText(c.t, x, 0); });
    if (!canPaint(ctx)) return flat();
    const B = fast ? null : dkBox(ctx, fs, cx);
    const mask = B && dkWork(ctx, "wlMask", B);
    if (mask) { mask.fillStyle = "#fff"; each((c, x) => mask.fillText(c.t, x, 0)); }
    /** The soft shadow of the letters (the mask laid off the canvas, its shadow thrown back): `col`, r units across, (dx, dy) off. */
    const shade = (col, r, dx = 0, dy = 0) => { if (mask) inPixels(ctx, () => { const D = B.x0 + B.w + 20; ctx.shadowColor = col; ctx.shadowBlur = r * B.k; ctx.shadowOffsetX = D + dx * B.k; ctx.shadowOffsetY = dy * B.k; ctx.drawImage(mask.canvas, B.x0 - D, B.y0); }); };
    shade(css(light ? W.ink : W.paper, light ? 0.42 : 0.5), fs * 0.16);   // the haze behind, so they read over the scene
    if (s > 0) { const [dx, dy] = fall(fs * 0.035 * s, fs * 0.05 * s); if (mask) shade(css(W.ink, 0.55), fs * 0.04, dx, dy); else { ctx.fillStyle = css(W.ink, 0.5); each((c, x) => ctx.fillText(c.t, x + dx, dy)); } }
    if (chars.some((c) => c.hi) && mask) {   // the accent glowing a little, as the sun does
      const H = dkWork(ctx, "wlGlow", B); H.fillStyle = "#fff"; each((c, x) => H.fillText(c.t, x, 0), true);
      inPixels(ctx, () => { const D = B.x0 + B.w + 20; ctx.globalCompositeOperation = "screen"; ctx.shadowColor = css(hot, 0.5); ctx.shadowBlur = fs * 0.3 * B.k; ctx.shadowOffsetX = D; ctx.drawImage(H.canvas, B.x0 - D, B.y0); });
    }
    if (k > 0) { ctx.lineJoin = "round"; ctx.strokeStyle = css(light ? W.ink : mix(W.paper, W.haze, 0.5), light ? 0.85 : 0.5); ctx.lineWidth = fs * (light ? 0.03 : 0.022) * k; each((c, x) => ctx.strokeText(c.t, x, 0)); }
    if (!B) return flat();
    wlLetters(ctx, B, fs, cx, each, [[false, face], [true, hot]]);
    wlLetGo(ctx, "wlMask", "wlGlow");
  },
  // objects are painted as the scene is: faces in the ground's muted tones, colours greyed, thin dark lines; the small parts keep the house's ink on the board
  wrap: (ctx, C, p, plates) => {
    if (plates) return ctx;
    const W = wl();
    return mapped(ctx, { fill: { ink: W.ink, light: mix(W.paper, W.haze, 0.3), mid: mix(W.near, W.haze, 0.55), dark: mix(W.near, W.haze, 0.12), colour: (c) => mix(mix(c, grey(c), 0.3), W.haze, 0.12) }, stroke: { ink: W.ink, light: W.paper }, line: 0.5 });
  },
  sticker: painters({ line: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(wl().ink, c[3]) : css(mix(mix(c, grey(c), 0.3), wl().haze, 0.1), c[3]); }, shadow(ctx, draw) { ctx.save(); ctx.translate(6, 9); draw(css(wl().ink, 0.3)); ctx.restore(); } }),
  /** The corner tag: a scrap of board brushed in bone, its ends broken into the hairs of the brush, its letters in ink beside a dab of the hot accent. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const W = wl(), f = fs * 0.62;
    ctx.font = `400 ${f * 1.15}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.9, hh = f * 1.6, top = y + (fs * 1.34 - hh), board = dark ? W.paper : mix(W.paper, W.near, 0.06);
    ctx.save();
    ctx.fillStyle = css(W.ink, 0.22); ctx.fillRect(x + 4, top + 6, w, hh);
    ctx.fillStyle = css(board); ctx.beginPath(); ctx.rect(x, top, w, hh);
    for (let i = 0; i < 14; i++) { const t = (i + 0.5) / 14, l = f * (0.15 + rand(4870 + i) * 0.5), th = hh / 14; wlKnife(ctx, x + w - f * 0.1, top + hh * t, l, th * 0.8, 0, 4871 + i * 3); wlKnife(ctx, x + f * 0.1, top + hh * t, l * 0.6, th * 0.8, Math.PI, 4872 + i * 3); }   // its ends, in hairs
    ctx.fill();
    ctx.fillStyle = css(mix(board, [0, 0, 0], 0.1), 0.55); ctx.beginPath(); for (let i = 0; i < 4; i++) wlKnife(ctx, x + w * rand(4890 + i) * 0.6, top + hh * (0.18 + i * 0.21), w * 0.4, hh * 0.035, 0, 4891 + i); ctx.fill();
    ctx.fillStyle = css(wlHot(C, p)); ctx.beginPath(); wlDab(ctx, x + f * 0.55, top + hh / 2, f * 0.16, 1, 0, 4898); ctx.fill();
    ctx.fillStyle = ink || css(W.ink); spaced(ctx, str, x + f * 1.05, top + hh * 0.5 + f * 0.42, 3);
    ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 12, h: hh + 12 };
  },
  /** The frame layer: the picture's edge as a painter leaves it, a thin border brushed round it, broken here and there. */
  frame(ctx, env) {
    const { w, h } = env, W = wl(), m = 26;
    ctx.save(); ctx.fillStyle = css(dark ? W.paper : W.near, 0.38); ctx.beginPath();
    for (const [x0, y0, len, a, k] of [[m, m, w - 2 * m, 0, 4880], [w - m, m, h - 2 * m, Math.PI / 2, 4881], [w - m, h - m, w - 2 * m, Math.PI, 4882], [m, h - m, h - 2 * m, -Math.PI / 2, 4883]]) {
      for (let i = 0, t = 0; t < len; i++) { const l = len * (0.08 + rand(k + i * 1.3) * 0.3), gap = rand(k + i * 1.9) < 0.3 ? len * 0.03 : 0; wlKnife(ctx, x0 + Math.cos(a) * t, y0 + Math.sin(a) * t, Math.min(l, len - t), 3 + rand(k + i * 2.3) * 2.5, a, k + i * 5); t += l + gap; }
    }
    ctx.fill(); ctx.restore();
  },
  /** The plate under a text layer: a broad stroke of paint, its ends ragged. */
  plate(ctx, x, y, w, h, colour, fs) {
    ctx.save(); ctx.fillStyle = css(wl().ink, 0.3); ctx.beginPath(); wlKnife(ctx, x + fs * 0.06, y + h / 2 + fs * 0.08, w, h, 0, 4890); ctx.fill(); ctx.restore();
    ctx.fillStyle = colour; ctx.beginPath(); wlKnife(ctx, x - fs * 0.05, y + h / 2, w + fs * 0.1, h, -0.008, 4891); ctx.fill();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(wl().ink, 0.35); ctx.shadowBlur = 14 * unit; ctx.shadowOffsetX = 4 * unit; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { wlLinen(ctx, p.linen, unit); grain(ctx, p.grain * (dark ? 0.6 : 0.5) * clamp(0.35 + unit * 1.1), unit, !dark); if (dark) vignette(ctx, w, h, [8, 10, 10], 0.38, 0.48); },   // the grain fainter on a thumbnail, where it would be noise
  prompt: `Objects from a quiet world after the end, as a concept painter would paint them — weathered, simple, each telling a story — that read at a glance:
- one clear object per sticker (a rusty fuel can, a bent road sign, an old radio, a storm lantern, a gas mask, a cassette tape, a worn backpack, a tin can, a crow), with a strong, simple silhouette; no realism, no fine detail;
- flat colour only, muted and weathered: olive, dun, slate and bone, with the main colour for one small hot accent;
- the app paints it loosely, without a line, and adds a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things left behind in a silent wasteland, built as simple models from a few boxes and cylinders — a rusted car, a power pole, a water tower, a road barrier, a camper van, an abandoned kiosk; no realism, no fine detail.
- the renderer paints faces in muted olive, dun and slate with a thin dark line: do NOT try to draw shading or outlines yourself;
- "white" is bone, "dark" a deep slate, and "main" the hot accent (the channel colour) — use it for one to three parts.`,
};
/**
 * The wet ground: puddles below the horizon holding the light along it — the band of the picture just above
 * the horizon mirrored into them, stretched down over the ground (a puddle near the foot shows the same
 * glow as one by the horizon, as a painter has it), softened and a little rippled, dimmed toward the
 * ground's colour — broken by level strokes of the ground across them, a pale lip along their far edge,
 * and where they lie below the sun (at sx), glints of its light. Without a canvas, the puddles in the sky's colour.
 */
function wlWater(ctx, P, amt, sx, hot, onto = false) {
  const { F, fw, fh, H } = P, W = wl(), tint = mix(wlSkyAt(P, H - fh * 0.1), W.earth[1], 0.4);
  if (!canPaint(ctx)) { ctx.save(); if (onto) ctx.globalCompositeOperation = "source-atop"; ctx.fillStyle = css(tint); ctx.beginPath(); wlPuddles(ctx, P, amt, 4800); ctx.fill(); ctx.restore(); return; }
  const m = ctx.getTransform(), cv = ctx.canvas, Y = m.f + H * m.d, band = Math.max(4, Math.round(fh * 0.22 * m.d)), below = Math.max(4, Math.round((F.y1 - H) * m.d)), R = workLike(ctx, "wlWater");
  const half = WORK.wlWaterSoft || (WORK.wlWaterSoft = document.createElement("canvas")), hw = Math.max(2, Math.round(cv.width / 3)), hb = Math.max(2, Math.round(band / 3));
  if (half.width !== hw || half.height !== hb) { half.width = hw; half.height = hb; }
  const g = half.getContext("2d"); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "copy"; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
  g.drawImage(cv, 0, Math.max(0, Y - band), cv.width, band, 0, 0, hw, hb);   // the band above the horizon, softened
  R.save(); R.setTransform(1, 0, 0, 1, 0, 0); R.imageSmoothingEnabled = true;
  for (let i = 0; i < 5; i++) { R.save(); R.translate((noise(i * 0.73 + seed) - 0.5) * 8 * m.a, Y); R.scale(1, -1); R.globalAlpha = i ? 0.35 : 1; R.drawImage(half, 0, -below - 1, cv.width, below); R.restore(); }   // mirrored, stretched down, a little rippled
  R.restore();
  R.globalCompositeOperation = "destination-in"; R.fillStyle = "#000"; R.beginPath(); const pools = wlPuddles(R, P, amt, 4800); R.fill();
  const dim = R.createLinearGradient(0, H, 0, F.y1); dim.addColorStop(0, css(tint, dark ? 0.22 : 0.14)); dim.addColorStop(1, css(mix(tint, W.earth[1], 0.6), dark ? 0.72 : 0.45));   // dimmer toward the foot, where it holds the higher, darker sky
  R.globalCompositeOperation = "source-atop"; R.fillStyle = dim; R.fillRect(F.x0, H, fw, F.y1 - H + fh);
  R.globalCompositeOperation = "source-over";
  layDown(ctx, R, 1, onto ? "source-atop" : "source-over");   // on a see-through base only onto what is painted: no puddle without ground under it
  wlLetGo(ctx, "wlWater", "wlWaterSoft");
  const span = Math.max(1, F.y1 - H), b = wlBatch(), lip = mix(W.sky[3], W.haze, 0.4), shine = mix(hot, [255, 240, 214], 0.45), earth = (y) => { const t = Math.round(((y - H) / span) * 8) / 8; return mix(mix(W.haze, W.earth[0], 0.5), mix(W.earth[0], W.earth[1], clamp(t * 1.3)), clamp(t * 6)); };   // the ground's own colour there (see wlGround)
  pools.forEach((q, i) => {
    const k = 4900 + i * 17.3, hgt = q.bot - q.top;
    for (let j = 0, n = Math.floor(rand(k) * 3); j < n; j++) { const y = q.top + hgt * (0.3 + rand(k + j * 1.3 + 1) * 0.5), len = q.w * (0.15 + rand(k + j * 1.7 + 2) * 0.3), x = q.x - q.w + q.w * 2 * rand(k + j * 2.1 + 3) - len / 2; b.add(wlStep(earth(y), rand(k + j * 2.5 + 4), 1, 0.06), 0.65, (c) => wlStroke(c, x, y, len, Math.max(2, hgt * (0.14 + rand(k + j * 2.9 + 5) * 0.16)), (rand(k + j * 3.3 + 6) - 0.5) * 0.04, k + j * 7 + 7)); }   // the ground breaking through
    for (let j = 0; j < 2; j++) { const len = q.w * (0.1 + rand(k + j * 3.7 + 8) * 0.25), x = q.x - q.w * 0.9 + q.w * 1.6 * rand(k + j * 4.1 + 9); b.add(lip, 0.4, (c) => wlStroke(c, x, q.top + hgt * 0.1, len, Math.max(1.5, hgt * 0.1), (rand(k + j * 4.5 + 10.5) - 0.5) * 0.06, k + j * 7 + 10)); }   // the pale lip along its far edge, here and there
    if (sx !== undefined && Math.abs(q.x - sx) < q.w * 0.8) for (let j = 0, n = 1 + Math.floor(rand(k + 11) * 2); j < n; j++) {   // the sun's light caught in it
      const y = q.top + hgt * (0.25 + rand(k + j * 1.9 + 12) * 0.5), len = Math.min(q.w * (0.05 + rand(k + j * 2.3 + 13) * 0.12), fw * 0.035), x = sx + (rand(k + j * 2.7 + 14) - 0.5) * Math.min(q.w, fw * 0.04) - len / 2;
      b.add(shine, 0.5 + rand(k + j * 3.1 + 15) * 0.35, (c) => wlStroke(c, x, y, len, Math.max(1, Math.min(hgt * 0.08, fh * 0.004)), 0, k + j * 7 + 17));
    }
  });
  ctx.save(); if (onto) ctx.globalCompositeOperation = "source-atop"; b.fill(ctx); ctx.restore();
}
wasteland.elementFx = [
  { key: "strokes", name: { zh: "笔触重绘", en: "Painted in strokes" }, for: FX_PHOTO, stage: "filter",
    /**
     * The photo painted over in brush strokes of its own colours (see wlPaintPhoto), its outline kept; what is see-through round it lends the strokes its own mean colour, so its edge takes no black. While dragging, only brought into the palette. Photos only: the work is kept for them (FX_KEPT in render.js), as it is not for a layer painted again with each change.
     * Its last results are kept here too, by what they were painted from (the pixels, their size, the ground, the seed, how much), for the editor and the size thumbnails at once (WL_FX_KEEP): a look's slider let go has the layer's effects worked again (FX_KEPT keys them on the whole style), and finds them here when what this one reads is the same.
     */
    paint(x, B, a, E) {
      const img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data;
      if (fast) { wlPixels(d, a); x.putImageData(img, B.x0, B.y0); return; }
      const u = new Uint32Array(d.buffer, d.byteOffset, d.length >> 2);
      let hsh = 2166136261; for (let i = 0; i < u.length; i++) hsh = Math.imul(hsh ^ u[i], 16777619);
      const key = `${hsh >>> 0}|${B.w}x${B.h}|${dark ? 1 : 0}|${E.seed}|${a}`, got = WL_FX.get(key);
      if (got) { WL_FX.delete(key); WL_FX.set(key, got); d.set(got); x.putImageData(img, B.x0, B.y0); return; }
      const o = new Uint8ClampedArray(d);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
      if (n) for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 128) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
      wlPaintPhoto(d, B.w, B.h, dark, E.seed);
      for (let i = 0; i < d.length; i += 4) { d[i] = o[i] + (d[i] - o[i]) * a; d[i + 1] = o[i + 1] + (d[i + 1] - o[i + 1]) * a; d[i + 2] = o[i + 2] + (d[i + 2] - o[i + 2]) * a; d[i + 3] = o[i + 3]; }
      if (wlLargest && x.canvas.width * x.canvas.height <= wlLargest) {   // the least lately used let go past WL_FX_KEEP results or bytes: the editor's and the size thumbnails' fit together
        WL_FX.set(key, new Uint8ClampedArray(d));
        let bytes = 0; for (const v of WL_FX.values()) bytes += v.length;
        for (const [k0, v] of WL_FX) { if (WL_FX.size <= 1 || (WL_FX.size <= WL_FX_KEEP[0] && bytes <= WL_FX_KEEP[1])) break; bytes -= v.length; WL_FX.delete(k0); }
      }   // only the size of a canvas on the page that has shown the look: an export's, or one while the editor shows another look, is painted once
      x.putImageData(img, B.x0, B.y0);
    } },
  { key: "dry", name: { zh: "干笔毛边", en: "Dry-brush edge" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.h * 0.1 }),
    /** As the look's title is brushed: the layer dragged once more to the right through the bristles, so its edges break into hairs, and streaked where the brush skipped. */
    paint(x, B, a) {
      const src = region(x, B, "fxA"), T = fxCanvas("fxWlDry", B.w, B.h), t = T.getContext("2d"), span = Math.max(8, Math.min(B.h, B.w) * 0.5), fill = (g, s) => { const p = g.createPattern(wlBristles(), "repeat"); if (p && p.setTransform && typeof DOMMatrix !== "undefined") p.setTransform(new DOMMatrix().scale(s / 128)); return p; };
      t.globalCompositeOperation = "copy"; t.globalAlpha = 1; t.drawImage(src, span * 0.06 * a, 0); t.globalCompositeOperation = "source-over"; t.drawImage(src, span * 0.11 * a, 0);
      t.globalCompositeOperation = "destination-in"; t.fillStyle = fill(t, span); t.fillRect(0, 0, B.w, B.h);
      x.save(); x.globalCompositeOperation = "destination-over"; x.drawImage(T, B.x0, B.y0); x.restore();
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w + span, B.h); x.clip(); x.translate(B.x0, B.y0);
      x.globalCompositeOperation = "destination-out"; x.globalAlpha = 0.32 * a; x.fillStyle = fill(x, span * 0.8); x.fillRect(0, 0, B.w + span, B.h);
      x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.18 * a; x.fillStyle = fill(x, span * 1.3); x.fillRect(0, 0, B.w + span, B.h);
      x.restore();
    } },
  { key: "mist", name: { zh: "雾中隐没", en: "Lost in haze" }, for: FX_ALL, stage: "over",
    /** The layer sinking into the mist toward its foot: the haze's colour laid over its lower part, its very foot fading away. */
    paint(x, B, a) {
      const W = wl(), g = x.createLinearGradient(0, B.y0 + B.h * (1 - 0.8 * a), 0, B.y1), f = x.createLinearGradient(0, B.y1 - B.h * 0.3 * a, 0, B.y1);
      g.addColorStop(0, css(W.haze, 0)); g.addColorStop(1, css(W.haze, 0.92 * a)); f.addColorStop(0, "rgba(0,0,0,0)"); f.addColorStop(1, `rgba(0,0,0,${0.85 * a})`);
      x.globalCompositeOperation = "source-atop"; x.fillStyle = g; x.fillRect(B.x0, B.y0, B.w, B.h);
      x.globalCompositeOperation = "destination-out"; x.fillStyle = f; x.fillRect(B.x0, B.y0, B.w, B.h);
    } },
  { key: "sun", name: { zh: "落日在后", en: "Low sun behind" }, for: FX_ALL, stage: "behind", reach: (B) => { const r = Math.max(B.w, B.h) * 0.9; return { l: r, t: r, r, b: r }; },
    /** A low sun behind the layer, a little up and to one side: its glow wide about it (fading out within the room the effect has, see reach), the hot disc, a bar of cloud across it. */
    paint(x, B, a, E) {
      const hot = wlHot(E.C), side = E.R(3) < 0.5 ? -1 : 1, R = Math.min(B.w, B.h) * (0.35 + 0.25 * a), cx = B.x0 + B.w / 2 + side * B.w * 0.22, cy = B.y0 + B.h * 0.38, al = Math.min(1, a * 2.5);
      const room = Math.max(B.w, B.h) * 0.9, G = Math.max(R * 1.2, Math.min(R * 3.2, cx - B.x0 + room, B.x0 + B.w + room - cx, cy - B.y0 + room, B.y0 + B.h + room - cy));
      x.save(); x.globalCompositeOperation = "destination-over";
      x.fillStyle = css(mix(wl().cloud[0], wl().sky[2], 0.4), 0.8 * al); x.beginPath(); wlKnife(x, cx - R * 2, cy + R * 0.35, R * 3.6, R * 0.16, 0, E.seed + 1); x.fill();
      x.fillStyle = css(hot, al); x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
      const g = x.createRadialGradient(cx, cy, R, cx, cy, G); g.addColorStop(0, css(mix(hot, wl().hot, 0.5), 0.5 * al)); g.addColorStop(1, css(wl().hot, 0));
      x.fillStyle = g; x.fillRect(cx - G, cy - G, G * 2, G * 2);
      x.restore();
    } },
  { key: "grade", name: { zh: "荒原色调", en: "Wasteland grade" }, for: FX_PHOTO, stage: "filter",
    /** The photo brought into the painting's palette (see wlPixels), without the strokes. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); wlPixels(img.data, a); x.putImageData(img, B.x0, B.y0); } },
];
