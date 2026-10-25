// What the looks share: colour and drawing helpers, the scene objects' placing, the module state of the current look
// (setLook, its values, the seed, the ground), the effects' machinery. A look's own file (looks/<id>.js) imports from
// here; nothing here imports a look (the registry, LOOKS, is filled by style.js). See style.js for the hooks.
import { fonts, spaced, spacedW } from "../cel.js";
import { titleBlock, titleBlockVertical } from "../title.js";

export const INK = "#07070c";
export const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
// ---------- colour helpers
/** "#rgb", "#rrggbb", "rgb(…)" or "rgba(…)" -> [r, g, b, a], or null for anything else. */
export function parseColour(v) {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1);
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const n = m[1].split(",").map(Number);
  return n.length >= 3 && n.every(Number.isFinite) ? [n[0], n[1], n[2], n[3] ?? 1] : null;
}
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
export const sat = (c) => { const hi = Math.max(c[0], c[1], c[2]), lo = Math.min(c[0], c[1], c[2]); return hi ? (hi - lo) / hi : 0; };
/** What a colour is doing in the house style: "ink", a neutral "light" / "mid" / "dark" surface, or a "colour". */
export function role(c) {
  if (sat(c) > 0.22 && Math.max(c[0], c[1], c[2]) >= 96) return "colour";   // the house greys are bluish: only bright, saturated colours count
  const l = lum(c);
  return l < 0.05 ? "ink" : l > 0.85 ? "light" : l > 0.5 ? "mid" : "dark";
}
export let fast = false;             // see setFast()
// ---------- scene objects the user may drag (see the `scene` hook in style.js, and sceneOffsets in layers.js)
export let sceneOff = {}, sceneW = 1920, sceneH = 1080, sceneK = 1, placed = [];
/** The offsets of the current look's scene objects on the cover being drawn ({ key: [dx, dy] }, fractions of its w × h; k: canvas pixels per unit). */
export function setScene(offsets, w, h, k) { sceneOff = offsets || {}; sceneW = w; sceneH = h; sceneK = k || 1; placed = []; }
/** Where the scene objects were placed in the last drawing, for the editor's handles: [{ key, x, y }] in units. */
export const scenePlaced = () => placed.slice();
/**
 * Where scene object `key` goes: (x, y), the place the layout gives it in ctx's own frame, moved by the
 * cover's offset for it (a move on the canvas, turned into ctx's frame if that is turned or scaled). The
 * place is noted for its handle. `axis` "x" or "y" keeps it to that direction (a band across the picture,
 * a beam from its top). Returns [x, y] in ctx's frame.
 */
export function objAt(key, x, y, ctx = null, axis = null) {
  const o = sceneOff[key];
  let dx = o && axis !== "y" ? o[0] * sceneW : 0, dy = o && axis !== "x" ? o[1] * sceneH : 0, vx = x + dx, vy = y + dy;
  const m = ctx && typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
  if (m) {
    const a = m.a / sceneK, b = m.b / sceneK, c = m.c / sceneK, d = m.d / sceneK, det = a * d - b * c || 1;
    [dx, dy] = [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
    vx = a * (x + dx) + c * (y + dy) + m.e / sceneK; vy = b * (x + dx) + d * (y + dy) + m.f / sceneK;
  }
  if (!placed.some((q) => q.key === key)) placed.push({ key, x: vx, y: vy });
  return [x + dx, y + dy];
}
/** Moves what ctx paints next by scene object `key`'s offset (a translate: call it within save / restore); (x, y), in ctx's frame, is where its handle goes unmoved. */
export function shift(key, x, y, ctx) { const [X, Y] = objAt(key, x, y, ctx); ctx.translate(X - x, Y - y); }
export let seed = 7;                 // see setLook(): places the things a look scatters at random
export const pad2 = (n) => String(n).padStart(2, "0");
/** Where something a look puts in the top right corner ends (at x, from the right): left of the brand logo when there is one (env.logo, see logoBox in render.js). */
export const besideLogo = (env, x) => (env.logo ? Math.min(x, env.logo.x - 28) : x);
export const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
/** A number in 0…1 that depends on `k` and on the profile's seed: the same until the seed is changed. */
export const rand = (k) => noise(k + (seed % 9973) * 0.6180339);

// ====================================================================== shared: re-mapped colours, painters, grain
/**
 * A context that re-maps the house style's colours and line weights. `m.fill` and `m.stroke` give,
 * for each job a colour does there ("ink", "light", "mid", "dark", "colour"), the [r, g, b] to use
 * instead (or a function of the original; leave a job out to keep the colour). `m.line` scales
 * every line width.
 */
export function mapped(ctx, m) {
  const swap = (v, table) => {
    const c = parseColour(v), to = c && table ? table[role(c)] : null;
    return to ? css(typeof to === "function" ? to(c) : to, c[3]) : v;
  };
  return new Proxy(ctx, {
    get(t, k) { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; },
    set(t, k, v) {
      if (k === "fillStyle") t.fillStyle = swap(v, m.fill);
      else if (k === "strokeStyle") t.strokeStyle = swap(v, m.stroke || m.fill);
      else if (k === "lineWidth" && m.line) t.lineWidth = v * m.line;
      else t[k] = v;
      return true;
    },
  });
}
/**
 * The five sticker painters for a look that keeps the house style's construction but changes its
 * materials. o: { line: [r,g,b] | null, lineScale, shadow(ctx, draw(colour), fill, p) | null, tone(fill) -> colour }
 */
export function painters(o) {
  const k = o.lineScale ?? 1, col = (fill) => (o.tone ? o.tone(fill) : fill), join = o.join || "round";
  return {
    shape(ctx, path, fill, { shadow = true, lw = 7 } = {}, p) {
      ctx.lineJoin = join; ctx.lineCap = "round";
      if (shadow && o.shadow) o.shadow(ctx, (c) => { ctx.beginPath(); path(ctx); ctx.fillStyle = c; ctx.fill(); }, fill, p);
      ctx.beginPath(); path(ctx); ctx.fillStyle = col(fill); ctx.fill();
      if (o.line) { ctx.lineWidth = lw * k; ctx.strokeStyle = css(o.line); ctx.stroke(); }
    },
    blob(ctx, paths, fill, p) {
      ctx.lineJoin = join;
      if (o.shadow) o.shadow(ctx, (c) => { for (const path of paths) { ctx.beginPath(); path(ctx); ctx.fillStyle = c; ctx.fill(); } }, fill, p);
      if (o.line) for (const path of paths) { ctx.beginPath(); path(ctx); ctx.lineWidth = 14 * k; ctx.strokeStyle = css(o.line); ctx.stroke(); }
      for (const path of paths) { ctx.beginPath(); path(ctx); ctx.fillStyle = col(fill); ctx.fill(); }
    },
    stroke(ctx, draw, color, lw = 30, p) {
      ctx.lineCap = o.cap || "round"; ctx.lineJoin = join;
      const line = (c, w) => { ctx.beginPath(); draw(ctx); ctx.strokeStyle = c; ctx.lineWidth = w; ctx.stroke(); };
      if (o.shadow) o.shadow(ctx, (c) => line(c, lw + (o.line ? 14 * k : 0)), color, p);
      if (o.line) line(css(o.line), lw + 14 * k);
      line(col(color), lw);
    },
    thin(ctx, draw, lw, color) {
      ctx.beginPath(); draw(ctx); ctx.lineWidth = lw * k; ctx.strokeStyle = col(color); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke();
    },
    word(ctx, str, x, y, size, fill, p) {
      ctx.lineJoin = join;
      if (o.shadow) o.shadow(ctx, (c) => { ctx.fillStyle = c; ctx.fillText(str, x, y); }, fill, p);
      if (o.line) { ctx.lineWidth = size * 0.2 * k; ctx.strokeStyle = css(o.line); ctx.strokeText(str, x, y); }
      ctx.fillStyle = col(fill); ctx.fillText(str, x, y);
    },
  };
}
/** fill -> the same fill, except that the house ink becomes `ink` (and colours pass through `tint`, if given). */
export const inkAs = (ink, tint) => (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(ink, c[3]) : tint && role(c) === "colour" ? css(tint(c), c[3]) : fill; };
export const WORK = {};               // small canvases the looks reuse: film grain, a blurred copy for bloom
/**
 * Grain over the whole canvas. On dark pictures (film) grey noise is laid on in overlay, which
 * darkens and lightens evenly; on light ones (paper) overlay barely shows, so there the noise is
 * multiplied in as specks instead: pass paper = true.
 */
export function grain(ctx, amount, unit, paper = false) {
  if (amount <= 0 || typeof document === "undefined" || !ctx.canvas) return;
  const key = paper ? "specks" : "grain";
  let g = WORK[key];
  if (!g) {
    g = WORK[key] = document.createElement("canvas"); g.width = g.height = 256;
    const x = g.getContext("2d"), d = x.createImageData(256, 256);
    let s = 12345;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 16) & 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = paper ? (v > 150 ? 255 : 120 + v * 0.7) : v;   // paper: mostly clean, some specks of varying depth
      d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
  }
  const pat = ctx.createPattern(g, "repeat");
  if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(Math.max(1, unit * 1.3)));   // the grain keeps its size on big exports
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = paper ? "multiply" : "overlay"; ctx.globalAlpha = Math.min(1, amount); ctx.fillStyle = pat; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
export const wash = (ctx, w, h, mode, colour, alpha) => { if (alpha <= 0) return; ctx.save(); ctx.globalCompositeOperation = mode; ctx.fillStyle = css(colour, Math.min(1, alpha)); ctx.fillRect(0, 0, w, h); ctx.restore(); };
export const grey = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return [l, l, l]; };
let columnar = 0;   // lettering set in columns (see inColumn in textfx.js): its line turned a quarter turn clockwise, upright already
export const upright = (ctx) => { if (!columnar) ctx.transform(1, 0, 0.08, 1, 0, 0); };   // undoes the house style's slant on lettering
/**
 * Runs `run` (and returns what it does) as lettering set in a column is painted (see inColumn in textfx.js): the
 * looks' letterings take no slant out of the line, a column being set upright, and what they throw off it falls
 * as the page has it (fall).
 */
export function asColumn(run) { columnar++; try { return run(); } finally { columnar--; } }
/**
 * The offset [x, y] by which lettering throws what it throws off its letters in one direction — a drop shadow, its
 * depth, a long shadow, an echo, a second ink printed off register, the shadow of its plate — given as the page has
 * it (dx, dy: down and to the right, say), in the units of the line it is drawn in. In a column the line is turned a
 * quarter turn clockwise, and the light is not: the offset is turned back, so it falls as it does off a line. (A
 * canvas's own shadow, shadowOffsetX/Y, is the page's already; and so is anything offset in pixels.)
 */
export const fall = (dx, dy) => (columnar ? [dy, -dx] : [dx, dy]);
// ---------- the grids the looks lay on their grounds (each look's `gridLines`, see lookGrid in render.js)
/** Every `step` from `a` while below `b`. */
export const every = (a, b, step) => { const out = []; for (let v = a; v < b; v += step) out.push(v); return out; };
/** Starts a grid: ctx saved, strokes and fills in `color`, lines `lw` wide (2 at least: thinner ones drop out when a cover is seen small), no dashes. Pair with ctx.restore(). */
export function gridPen(ctx, color, lw = 2) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.setLineDash([]); ctx.lineCap = "butt"; ctx.lineJoin = "miter";
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0;
}
/** Lines down at each of `xs` from y0 to y1, and across at each of `ys` from x0 to x1, stroked as one path. */
export function gridPath(ctx, xs, ys, x0, y0, x1, y1) {
  ctx.beginPath();
  for (const x of xs) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (const y of ys) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}
/** Straight lines at angle `a` (radians) across the whole w × h, `gap` apart, one through the middle moved `off` along their normal; stroked as one path. */
export function slantPath(ctx, w, h, a, gap, off = 0) {
  const c = Math.cos(a), s = Math.sin(a), R = Math.hypot(w, h), cx = w / 2, cy = h / 2;
  ctx.beginPath();
  for (let d = -Math.ceil(R / 2 / gap) * gap + off; d <= R / 2; d += gap) { const px = cx - s * d, py = cy + c * d; ctx.moveTo(px - c * R, py - s * R); ctx.lineTo(px + c * R, py + s * R); }
  ctx.stroke();
}

// ====================================================================== shared, first written for anime: 90s cel animation, photographed on film
export const ANI = { line: [46, 36, 60], cream: [250, 244, 230], shade: [72, 62, 98], pale: [216, 211, 226] };
/**
 * Dust and scratches on a print that has been through the projector: specks of dirt (dark, mostly
 * small, a few large and ragged), bright flecks where dust sat on the negative, hairs, and long
 * scratches running down the film — pale, a little wavering, some broken off. `d` (0–1) sets how
 * many there are and how strongly they show: at 1 the print is plainly worn.
 */
export function filmDust(ctx, w, h, d) {
  const area = (w * h) / (1920 * 1080), strong = 0.35 + 0.65 * d, dirt = [24, 16, 28];
  ctx.save(); ctx.lineCap = "round";
  for (let k = 0, n = Math.round((8 + 230 * d * d + 80 * d) * area); k < n; k++) {   // specks: a blob of two or three overlapping dots
    const x = rand(k * 4.1 + 1) * w, y = rand(k * 5.7 + 2) * h, big = rand(k * 2.3 + 5), r = 0.9 + big * big * big * (4 + 5 * d);
    const light = rand(k * 1.9 + 0.5) > 0.62;
    ctx.fillStyle = light ? css(ANI.cream, (0.55 + 0.4 * rand(k + 7)) * strong) : css(dirt, (0.6 + 0.35 * rand(k + 8)) * strong);
    ctx.beginPath();
    for (let j = 0, m = r > 2.5 ? 3 : 1; j < m; j++) { const a = rand(k * 3 + j * 1.7 + 9) * TAU, o = j ? r * 0.6 : 0, rr = r * (j ? 0.55 + rand(k + j * 2.9) * 0.4 : 1); ctx.moveTo(x + Math.cos(a) * o + rr, y + Math.sin(a) * o); ctx.arc(x + Math.cos(a) * o, y + Math.sin(a) * o, rr, 0, TAU); }
    ctx.fill();
  }
  for (let k = 0, n = Math.round((0.6 + 10 * d) * Math.sqrt(area) * d); k < n; k++) {   // hairs: thin dark curls
    const x = rand(k * 6.3 + 30) * w, y = rand(k * 7.9 + 31) * h, len = 26 + rand(k * 2.7 + 32) * 90, a = rand(k * 3.1 + 33) * TAU, bend = (rand(k * 4.7 + 34) - 0.5) * 2.4;
    ctx.strokeStyle = css(dirt, (0.55 + 0.35 * rand(k + 35)) * strong); ctx.lineWidth = 1.1 + rand(k * 5.3 + 36) * 1.1;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + Math.cos(a) * len * 0.4 - Math.sin(a) * len * bend * 0.3, y + Math.sin(a) * len * 0.4 + Math.cos(a) * len * bend * 0.3, x + Math.cos(a + bend) * len * 0.7, y + Math.sin(a + bend) * len * 0.7, x + Math.cos(a + bend * 0.6) * len, y + Math.sin(a + bend * 0.6) * len);
    ctx.stroke();
  }
  for (let k = 0, n = Math.round(1 + 11 * d); k < n; k++) {   // scratches: down the film, pale, wavering a little, some only part of the way
    const x0 = rand(k * 9.1 + 7) * w, whole = rand(k * 2.1 + 40) > 0.45, y0 = whole ? 0 : rand(k * 3.3 + 41) * h * 0.7, y1 = whole ? h : y0 + h * (0.15 + rand(k * 4.4 + 42) * 0.5);
    const dark = rand(k * 5.5 + 43) > 0.8, lw = 1 + rand(k * 6.6 + 44) * (1 + 1.4 * d), sway = 1 + rand(k * 7.7 + 45) * 3;
    ctx.strokeStyle = dark ? css(dirt, (0.3 + 0.35 * rand(k + 46)) * strong) : css(ANI.cream, (0.32 + 0.45 * rand(k + 47)) * strong); ctx.lineWidth = lw;
    ctx.beginPath();
    for (let y = y0, i = 0; y <= y1 + 1; y += 40, i++) { const x = x0 + Math.sin(y / (180 + rand(k + 48) * 220) + k) * sway + (noise(k * 31 + i * 0.37) - 0.5) * 0.8; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    if (rand(k * 8.8 + 49) > 0.6) { ctx.lineWidth = lw * 0.6; ctx.beginPath(); ctx.moveTo(x0 + lw * 3, y0 + (y1 - y0) * 0.2); ctx.lineTo(x0 + lw * 3 + sway * 0.5, y0 + (y1 - y0) * 0.7); ctx.stroke(); }   // a second line beside it
  }
  ctx.restore();
}
/**
 * Beams of light slanting down through the sky from above its top edge — the "angel's ladder" of
 * painted backgrounds: long pale wedges, screened on, fading as they fall. Warmer at dusk.
 */
/** Where godRays' beams come in at the top (their source is far above it): for a look placing them as a scene object itself. */
export const raysAt = (w, h) => [w * (0.6 + rand(621) * 0.25), h * 0.06];
export function godRays(ctx, w, h, amt, dusk = 0, key = null, move = null) {
  if (amt <= 0) return;
  let [ox] = raysAt(w, h), oy = -h * 0.35;
  if (key) { const [mx, my] = objAt(key, ox, h * 0.06, ctx); oy += my - h * 0.06; ox = mx; }   // a scene object: its handle where the beams come in at the top
  if (move) { ox += move[0]; oy += move[1]; }   // moved by a look that placed them itself (painting them elsewhere than on ctx)
  const len = Math.hypot(w, h) * 1.2, c = mix([255, 248, 226], [255, 206, 150], dusk);
  ctx.save(); ctx.globalCompositeOperation = "screen";
  for (let k = 0; k < 9; k++) {
    const a = Math.PI * (0.52 + 0.3 * ((k + rand(k * 2.3 + 622) * 0.8) / 9)), half = 0.012 + rand(k * 3.7 + 623) * 0.03, s = (0.35 + 0.65 * rand(k * 4.9 + 624)) * amt;
    const g = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    g.addColorStop(0.2, css(c, 0.5 * s)); g.addColorStop(0.75, css(c, 0.12 * s)); g.addColorStop(1, css(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - half) * len, oy + Math.sin(a - half) * len); ctx.lineTo(ox + Math.cos(a + half) * len, oy + Math.sin(a + half) * len); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
/**
 * A lens flare as the animators drew it: a hot source near the top with a star of thin streaks and a
 * flat horizontal one, then a line of ghosts through the middle of the frame — rings with a brighter
 * rim, flat hexagons, a small hard dot — each in its own tint. Screened on; `amt` sets their strength.
 */
export function lensFlare(ctx, w, h, amt, key = null) {
  let sx = w * (0.7 + rand(611) * 0.2), sy = h * (0.08 + rand(612) * 0.14);
  if (key) [sx, sy] = objAt(key, sx, sy, ctx);   // a scene object: the ghosts still run through the middle
  const u = Math.min(w, h), vx = w / 2 - sx, vy = h / 2 - sy;
  ctx.save(); ctx.globalCompositeOperation = "screen";
  const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, u * 0.36);
  glow.addColorStop(0, css([255, 250, 232], 0.95 * amt)); glow.addColorStop(0.12, css([255, 228, 180], 0.55 * amt)); glow.addColorStop(1, css([255, 200, 150], 0));
  ctx.fillStyle = glow; ctx.fillRect(sx - u * 0.36, sy - u * 0.36, u * 0.72, u * 0.72);
  ctx.strokeStyle = css([255, 244, 220], 0.5 * amt); ctx.lineCap = "round";
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI + rand(613) * 0.5, r = u * (0.08 + rand(k * 2.1 + 614) * 0.14); ctx.lineWidth = 1.5 + rand(k + 615) * 1.5; ctx.beginPath(); ctx.moveTo(sx - Math.cos(a) * r, sy - Math.sin(a) * r); ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); ctx.stroke(); }
  ctx.save(); ctx.translate(sx, sy); ctx.scale(1, 0.035);   // the flat streak
  const st = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 0.45); st.addColorStop(0, css([200, 226, 255], 0.7 * amt)); st.addColorStop(1, css([200, 226, 255], 0));
  ctx.fillStyle = st; ctx.beginPath(); ctx.arc(0, 0, w * 0.45, 0, TAU); ctx.fill(); ctx.restore();
  for (const [t, r, c, kind] of [[0.45, 0.035, [255, 255, 255], "dot"], [0.75, 0.07, [150, 210, 255], "ring"], [1.05, 0.05, [255, 190, 120], "hex"], [1.35, 0.12, [190, 255, 200], "ring"], [1.6, 0.08, [220, 170, 255], "hex"], [1.9, 0.18, [255, 210, 160], "ring"]]) {
    const x = sx + vx * t, y = sy + vy * t, R = u * r;
    if (kind === "ring") {
      const g = ctx.createRadialGradient(x, y, R * 0.55, x, y, R);
      g.addColorStop(0, css(c, 0.07 * amt)); g.addColorStop(0.85, css(c, 0.4 * amt)); g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    } else if (kind === "hex") {
      ctx.fillStyle = css(c, 0.28 * amt); ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); }
      ctx.closePath(); ctx.fill();
    } else { ctx.fillStyle = css(c, 0.5 * amt); ctx.beginPath(); ctx.arc(x, y, R * 0.3, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}

// ---------- the ground the current cover is on
export let dark = true;               // whether the current cover is on a dark ground; see setLook()

// ====================================================================== shared, first written for vivid: summer illustration: a city in the clouds, in flat paint
export const TAU = Math.PI * 2;
/**
 * A colour as summer light shows it: the saturation pushed most of the way up, the hue kept, the
 * lightness kept within the range where it still reads as a colour. Greys stay grey.
 */
export function boost(c, k = 0.45) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.04) return [c[0], c[1], c[2]];
  const s = (l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo)) * (1 - k) + k, L = clamp(l, 0.3, 0.66);
  const hue = ((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const q = (1 - Math.abs(2 * L - 1)) * s, x = q * (1 - Math.abs(((hue / 60) % 2) - 1)), m = L - q / 2;
  const [R, G, B] = hue < 60 ? [q, x, 0] : hue < 120 ? [x, q, 0] : hue < 180 ? [0, q, x] : hue < 240 ? [0, x, q] : hue < 300 ? [x, 0, q] : [q, 0, x];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255];
}
/** A rectangle with round corners, as a path (added to the current one). */
export function rounded(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** A closed polygon of points [[x, y], …], as the current path. */
export const shapeOf = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };

// ====================================================================== shared, first written for the poster looks
/** Whether two colours are within `d` of each other (straight-line distance in RGB). */
export const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;
/** A star mark: four points with hollow sides (a sparkle), or five. */
export function starMark(ctx, x, y, r, points, colour) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points, q = i % 2 ? r * (points === 4 ? 0.2 : 0.45) : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
  ctx.closePath(); ctx.fillStyle = css(colour); ctx.fill();
}
/**
 * The box the title will fill, set the usual way in the layout's place, and the subtitle's under it (for
 * a look's background to keep clear of them), or null when the title is hidden or empty. A move of the
 * title layer is not counted.
 */
export function titleArea(ctx, env) {
  return withSub(titleOnly(ctx, env), env);
}
/** The box the title alone will fill (see titleArea), or null. */
export function titleOnly(ctx, env) {
  const T = titleLayer(env), base = titleBase(env);
  if (!T || !base || typeof ctx.measureText !== "function") return null;
  const face = current.titleFont ? current.titleFont(fonts) : fonts.cn, font = T.font ? `"${T.font}", ${face}` : face, s = env.sub;
  const reserve = s && !s.vertical ? s.reserve : 0, box = s && s.titleBox ? s.titleBox : columned(T) ? columnBoxOf(ctx, env, base) : base;
  if (columned(T)) return titleBlockVertical(ctx, env.cover.title, { ...box, h: box.h - Math.min(reserve, box.h * 0.5) }, font, 900, 300, !!T.rules);
  const bend = T.bend ? { id: T.bend, amt: T.bendAmt ?? 1, own: T.bend === "taper" && !!T.warp } : null;
  return titleBlock(ctx, env.cover.title, box, font, 340, reserve, bend);
}
/**
 * Whether lettering layer L is set in columns (see drawTitleVertical in title.js): when the user set it so, its
 * `vertical`; the title and the subtitle also when the look sets them so of itself (its `columns`: the woodblock
 * book's Set the title vertically), which is the look's default and not the layer's — a title the user set vertical
 * is in columns in every look.
 */
export const columned = (L) => !!L && (L.vertical === true || ((L.type === "title" || L.type === "subtitle") && !!(current.columns && current.columns(values))));
/** The box the title's columns stand in, from the box the layout gives the title: the look's own place for them (its `columnBox`), else that box. */
export const columnBoxOf = (ctx, env, box) => (current.columnBox ? current.columnBox(ctx, env, box) : box);
/** Block b and the block the subtitle's words fill (when there is one: see subtitlePlan in render.js) together. */
function withSub(b, env) {
  const s = env.sub && (env.sub.ink || env.sub.box);
  if (!b || !s) return b;
  const x = Math.min(b.x, s.x), y = Math.min(b.y, s.y);
  return { x, y, w: Math.max(b.x + b.w, s.x + s.w) - x, h: Math.max(b.y + b.h, s.y + s.h) - y };
}
/** The title layer, when it shows. */
const titleLayer = (env) => (env.cover && env.cover.layers.find((l) => l.id === "title" && l.visible)) || null;
/** The box the layout gives the title, as render.js hands it to the title's painter. */
function titleBase(env) {
  const G = env.G;
  if (!G) return null;
  const top = G.titleTop ?? (env.hasBrand ? 150 : 84);
  return { x: G.title.x, y: top, w: G.title.w, h: G.title.h + (G.title.y - top) };
}
/** The top of the channel graphic, as the layout places it, when it stands under the span x0–x1 (else Infinity), less a margin. */
export function graphicTop(env, x0, x1) {
  const A = env.G && env.G.art, on = env.graphic && env.cover && env.cover.layers.some((l) => l.id === "graphic" && l.visible);
  if (!A || !on) return Infinity;
  const half = 310 * A.s;
  return A.x + half > x0 && A.x - half < x1 ? A.y - half - 24 : Infinity;
}
export const canPaint = (ctx) => typeof document !== "undefined" && !!ctx.canvas && typeof ctx.getTransform === "function";
/**
 * A work canvas the size of ctx's, cleared, drawing with ctx's transform: for painting something whole
 * and then laying it down at once — with an alpha or a mode, or after cutting into it. One per `slot`.
 */
export function workLike(ctx, slot) {
  const cv = ctx.canvas, s = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (s.width !== cv.width || s.height !== cv.height) { s.width = cv.width; s.height = cv.height; }
  const x = s.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.shadowColor = "rgba(0,0,0,0)"; x.shadowBlur = 0;
  x.clearRect(0, 0, s.width, s.height); x.setTransform(ctx.getTransform());
  x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;   // lettering painted on it matches what was measured
  return x;
}
/** Lays a work canvas (see workLike) down on ctx, pixel for pixel. */
export function layDown(ctx, x, alpha = 1, mode = "source-over") { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = mode; ctx.drawImage(x.canvas, 0, 0); ctx.restore(); }
/**
 * What is laid over a whole picture — a look's `post` (grain, a vignette, wear), its tints and fringes over the
 * scene — on a see-through base (`clear`): paint(x) runs on a copy of ctx's canvas, each pixel's own colour made
 * all but solid first (the copy laid on itself, so a blend works on that colour rather than on nothing), and the
 * copy goes back only where the canvas holds something, as much as it does (source-atop): what is see-through stays
 * so, a soft shadow keeps its colour. Not clear, or no canvas to copy: paint(ctx) as it is. `slot`: its work canvas.
 */
export function wherePainted(ctx, paint, clear = true, slot = "painted") {
  if (!clear || !canPaint(ctx)) return paint(ctx);
  const x = workLike(ctx, slot);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 6; i++) x.drawImage(ctx.canvas, 0, 0);   // 0.3 of a colour becomes 0.88 of it, nothing stays nothing
  x.restore();
  paint(x);
  layDown(ctx, x, 1, "source-atop");
}
/**
 * Paints draw() as a soft blur of `colour`, `r` units across: a shadow cast from far off the canvas,
 * since a filter cannot be relied on. What draw() paints itself lands off the canvas.
 */
export function blurred(ctx, r, colour, draw) {
  const m = ctx.getTransform(), D = 30000;
  ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = Math.max(0.1, r * Math.hypot(m.a, m.b)); ctx.shadowOffsetX = D * m.a; ctx.shadowOffsetY = D * m.b;
  ctx.translate(-D, 0); draw(); ctx.restore();
}
/** What a look's figure is drawn from: the graphic the user put in its place for this look, else the channel graphic (see `art`). */
export const figureOf = (env) => env && (env.figure || env.graphic);
/**
 * A graphic as a flat silhouette — the figure's (see figureOf), or `g`: opaque white where it is solid,
 * its soft ground shadow and half-clear parts left out, on a canvas 1200 px square covering ±330 units;
 * `box`: its solid part, in units. Kept per look and graphic (a look's line work changes the outline a little).
 */
export function graphicShape(env, g = figureOf(env)) {
  if (!g || typeof document === "undefined") return null;
  const kept = WORK.shapes || (WORK.shapes = new Map()), key = current.id + "|" + JSON.stringify(g.ref);
  if (kept.has(key)) return kept.get(key);
  const n = 1200, R = 330, c = document.createElement("canvas"); c.width = c.height = n;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.translate(n / 2, n / 2); x.scale(n / (2 * R), n / (2 * R));
  if (!g.draw(x)) return null;   // not ready (an image still loading): try again next time
  x.setTransform(1, 0, 0, 1, 0, 0);
  const d = x.getImageData(0, 0, n, n), A = d.data;
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (let i = 0, q = 0; i < A.length; i += 4, q++) {
    const a = A[i + 3], v = a > 200 ? 255 : a > 150 ? (a - 150) * 5 : 0;
    A[i] = A[i + 1] = A[i + 2] = 255; A[i + 3] = v;
    if (v) { const px = q % n, py = (q / n) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  }
  if (x1 < 0) { kept.set(key, null); return null; }   // nothing solid in it (a faint picture): kept too, so it is not drawn again each time
  x.putImageData(d, 0, 0);
  const k = (2 * R) / n, shape = { c, R, box: { x0: x0 * k - R, y0: y0 * k - R, x1: (x1 + 1) * k - R, y1: (y1 + 1) * k - R }, tints: new Map() };
  kept.set(key, shape);
  if (kept.size > 8) kept.delete(kept.keys().next().value);
  return shape;
}
/** The silhouette in one colour (kept, a few per shape). */
function tintedShape(shape, colour) {
  const key = colour.map((v) => Math.round(v)).join();
  let t = shape.tints.get(key);
  if (!t) {
    t = document.createElement("canvas"); t.width = t.height = shape.c.width;
    const x = t.getContext("2d"); x.drawImage(shape.c, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = css(colour); x.fillRect(0, 0, t.width, t.height);
    shape.tints.set(key, t);
    if (shape.tints.size > 4) shape.tints.delete(shape.tints.keys().next().value);
  }
  return t;
}
/** Paints the silhouette in `colour`, its solid part `size` units tall with its middle at (cx, cy), turned by `rot` radians. */
export function placeShape(ctx, shape, colour, cx, cy, size, rot = 0) {
  const b = shape.box, k = size / Math.max(1, b.y1 - b.y0);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tintedShape(shape, colour), -shape.R, -shape.R, 2 * shape.R, 2 * shape.R);
  ctx.restore();
}
/** The part of the canvas the colour block leaves open — where a look puts its picture — and the block's side. */
export function openField(env) {
  const { w, h } = env, E = env.G && env.G.edge;
  if (!E) return { x0: 0, y0: 0, x1: w, y1: h, side: "none" };
  const [ax, ay, bx, by] = E.line;
  if (E.ny < -0.5) return { x0: 0, y0: 0, x1: w, y1: Math.max(ay, by), side: "below" };
  if (E.ny > 0.5) return { x0: 0, y0: Math.min(ay, by), x1: w, y1: h, side: "above" };
  if (E.nx < -0.5) return { x0: 0, y0: 0, x1: Math.max(ax, bx), y1: h, side: "right" };
  return { x0: Math.min(ax, bx), y0: 0, x1: w, y1: h, side: "left" };
}
/** A halftone screen over what is there: dots of `colour` on a 45° lattice, `pitch` units apart, laid in `mode`. */
export function dotScreen(ctx, w, h, colour, pitch, alpha, mode = "multiply") {
  if (alpha <= 0 || !canPaint(ctx)) return;
  const key = `dots|${colour.join()}|${pitch}`;
  let c = WORK[key];
  if (!c) {
    c = WORK[key] = document.createElement("canvas"); c.width = c.height = pitch * 2;
    const x = c.getContext("2d"); x.fillStyle = css(colour);
    for (const [px, py] of [[0.5, 0.5], [1.5, 1.5]]) { x.beginPath(); x.arc(px * pitch, py * pitch, pitch * 0.34, 0, TAU); x.fill(); }
  }
  ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = mode; ctx.fillStyle = ctx.createPattern(c, "repeat"); ctx.fillRect(0, 0, w, h); ctx.restore();
}
/**
 * Crumpled paper: facets a shade lighter or darker and a few creases, as a grey field (128 is "no
 * change") to lay over the picture in soft light. Made at half size, kept per size and seed.
 */
function crumpled(w, h) {
  const kept = WORK.crumple || (WORK.crumple = new Map()), key = `${w | 0}|${h | 0}|${seed}`;
  if (kept.has(key)) return kept.get(key);
  const c = document.createElement("canvas"); c.width = Math.ceil(w / 2); c.height = Math.ceil(h / 2);
  const x = c.getContext("2d"), u = Math.min(w, h);
  x.scale(0.5, 0.5); x.fillStyle = "rgb(128,128,128)"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {   // facets: overlapping triangles, a little lighter or darker
    const cx = rand(i * 3.1 + 400) * w, cy = rand(i * 4.7 + 401) * h, r = u * (0.08 + rand(i * 5.3 + 402) * 0.35);
    x.fillStyle = rand(i * 1.9 + 403) > 0.5 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)";
    x.beginPath(); for (let j = 0; j < 3; j++) { const a = rand(i * 7 + j * 2.3 + 404) * TAU; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } x.fill();
  }
  x.lineCap = "round";
  for (let i = 0; i < 18; i++) {     // creases: a sharp light ridge with a soft dark valley beside it
    const a = rand(i * 2.7 + 420) * Math.PI, cx = rand(i * 3.9 + 421) * w, cy = rand(i * 5.1 + 422) * h, len = u * (0.3 + rand(i * 6.3 + 423) * 0.9);
    const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2, mid = (rand(i * 8.1 + 424) - 0.5) * u * 0.08;
    const line = (off, colour, lw) => { x.strokeStyle = colour; x.lineWidth = lw; x.beginPath(); x.moveTo(cx - dx - dy * off, cy - dy + dx * off); x.quadraticCurveTo(cx - dy * (off + mid / len), cy + dx * (off + mid / len), cx + dx - dy * off, cy + dy + dx * off); x.stroke(); };
    line(0.006, "rgba(0,0,0,0.16)", 7); line(0, "rgba(255,255,255,0.32)", 1.6);
  }
  kept.set(key, c);
  if (kept.size > 2) kept.delete(kept.keys().next().value);
  return c;
}
/** Lays crumpled paper (see crumpled) over the picture. */
export function crumple(ctx, w, h, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.min(1, amt); ctx.imageSmoothingEnabled = true; ctx.drawImage(crumpled(w, h), 0, 0, w, h); ctx.restore();
}
/** A soft dark ring round the edge of the picture. */
export function vignette(ctx, w, h, colour, alpha, inner = 0.42) {
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, css(colour, 0)); g.addColorStop(1, css(colour, Math.min(1, alpha)));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
/**
 * Greeked text: lines of thin bars the length of words, for the dense small print of a poster without
 * inventing words. (x, y): the first line's top; `lines` of `lh` pitch, `width` wide, aligned `align`.
 */
export function greeked(ctx, x, y, width, lines, lh, colour, k, align = "left") {
  ctx.fillStyle = colour;
  for (let i = 0; i < lines; i++) {
    const words = [];
    let used = 0;
    for (let j = 0; used < width * (i === lines - 1 ? 0.55 : 0.97); j++) { const ww = lh * (0.9 + rand(k + i * 13.1 + j * 1.7) * 3.2); if (used + ww > width) break; words.push(ww); used += ww + lh * 0.45; }
    let at = align === "center" ? x + (width - used) / 2 : align === "right" ? x + width - used : x;
    for (const ww of words) { ctx.fillRect(at, y + i * lh, ww, Math.max(1, lh * 0.36)); at += ww + lh * 0.45; }
  }
}
/**
 * Wear, white on clear, the canvas's size in units: soft blotches where the ink lay thin, and fine
 * specks in clusters, as the paper's tooth catches them. Kept per size and seed. See wear().
 */
export function wornTexture(w, h) {
  const kept = WORK.worn || (WORK.worn = new Map()), key = `${w | 0}|${h | 0}|${seed}`;
  if (kept.has(key)) return kept.get(key);
  const c = document.createElement("canvas"); c.width = Math.ceil(w); c.height = Math.ceil(h);
  const x = c.getContext("2d"), u = Math.min(w, h), area = (w * h) / (1920 * 1080);
  for (let i = 0; i < 90; i++) {
    const cx = rand(i * 2.9 + 700) * w, cy = rand(i * 3.7 + 701) * h, r = u * (0.015 + rand(i * 4.3 + 702) ** 2 * 0.12), g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,255,255,${0.2 + rand(i * 5.1 + 703) * 0.4})`); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.fillStyle = "#fff";
  for (let i = 0, n = Math.round(4200 * area); i < n; i++) {
    const loose = rand(i * 0.53 + 717) < 0.3, cl = Math.floor(rand(i * 0.71 + 710) * 260), d = u * 0.05 * Math.sqrt(rand(i * 1.3 + 713)), a = rand(i * 1.9 + 714) * TAU;
    const px = loose ? rand(i * 2.1 + 718) * w : rand(cl * 2.3 + 711) * w + Math.cos(a) * d, py = loose ? rand(i * 2.6 + 719) * h : rand(cl * 3.1 + 712) * h + Math.sin(a) * d, r = 0.5 + rand(i * 2.7 + 715) ** 3 * 2.6;
    x.globalAlpha = 0.45 + rand(i * 3.3 + 716) * 0.55; x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
  }
  x.globalAlpha = 1;
  kept.set(key, c);
  if (kept.size > 2) kept.delete(kept.keys().next().value);
  return c;
}
/**
 * Lays the wear (see wornTexture) on in `colour`: in the paper's colour with "lighten" it is where the
 * ink did not take or has rubbed off (paper stays paper); with "multiply", grime. `mask`, if given,
 * paints in white where it may show (a ring, the edges), and how strongly; `base` adds an even rub
 * under the specks there, so the worn shape reads as a whole.
 */
export function wear(ctx, w, h, colour, alpha, mode = "lighten", mask = null, base = 0) {
  if (alpha <= 0 || !canPaint(ctx)) return;
  const x = workLike(ctx, "wear");
  x.drawImage(wornTexture(w, h), 0, 0, w, h);
  if (base > 0) { x.globalAlpha = base; x.fillStyle = "#fff"; x.fillRect(0, 0, w, h); x.globalAlpha = 1; }
  if (mask) {   // painted on a canvas of its own: a cut made shape by shape would keep only the last
    const m = workLike(ctx, "wearMask");
    mask(m);
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "destination-in"; x.drawImage(m.canvas, 0, 0); x.restore();
  }
  x.globalCompositeOperation = "source-in"; x.fillStyle = css(colour); x.fillRect(0, 0, w, h);
  layDown(ctx, x, alpha, mode);
}

// ====================================================================== shared, first written for negative: negative space: the red and black film poster
/** Spaced lettering centred on x (spaced() sets from the left). */
export function spacedCentre(ctx, str, x, y, gap) { const align = ctx.textAlign; ctx.textAlign = "left"; spaced(ctx, str, x - spacedW(ctx, str, gap) / 2, y, gap); ctx.textAlign = align; }

// ====================================================================== shared, first written for cyano: cyanotype: photograms glowing on Prussian blue
/** A four-pointed sparkle with a glow round it. */
export function sparkle(ctx, x, y, r, colour, glow) {
  if (glow > 0) blurred(ctx, r * 0.6 * glow, css(colour, 0.9), () => starMark(ctx, x, y, r, 4, colour));
  starMark(ctx, x, y, r, 4, colour);
}

// ====================================================================== shared, first written for avant: avant-garde image: today's design-studio poster
/** A copy of what ctx's canvas holds now (a work canvas per slot). */
export function snap(ctx, slot) { const x = workLike(ctx, slot); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0); return x.canvas; }
/** Runs draw() with ctx in canvas pixels (the clip, if any, stays). */
export function inPixels(ctx, draw) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); draw(); ctx.restore(); }
/** A soft copy of `src`: drawn down small in two steps (so it does not shimmer) and kept; `f` how many times smaller. */
export function softCopy(src, f, slot) {
  const mid = WORK[slot + "m"] || (WORK[slot + "m"] = document.createElement("canvas")), small = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  const mw = Math.max(4, Math.round(src.width / 3)), mh = Math.max(4, Math.round(src.height / 3)), sw = Math.max(2, Math.round(src.width / f)), sh = Math.max(2, Math.round(src.height / f));
  if (mid.width !== mw || mid.height !== mh) { mid.width = mw; mid.height = mh; }
  if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
  const m = mid.getContext("2d"), s = small.getContext("2d");
  m.imageSmoothingEnabled = s.imageSmoothingEnabled = true; m.imageSmoothingQuality = s.imageSmoothingQuality = "high";
  m.globalCompositeOperation = s.globalCompositeOperation = "copy"; m.drawImage(src, 0, 0, mw, mh); s.drawImage(mid, 0, 0, sw, sh);
  return small;
}
/** A glow: a soft copy of the picture screened over it on the dark ground (light spills from the bright figure), lightened in on the light one (a haze). */
export function avGlow(ctx, amt) {
  if (amt <= 0 || !canPaint(ctx) || fast) return;
  const soft = softCopy(snap(ctx, "avSnap"), 24, "avGlow"), cv = ctx.canvas;
  inPixels(ctx, () => { ctx.globalCompositeOperation = dark ? "screen" : "lighten"; ctx.globalAlpha = (dark ? 0.85 : 0.6) * amt; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
}

// ====================================================================== shared: reading and recolouring pixels
/** A colour turned round the colour wheel by `deg` degrees, its saturation and lightness kept. */
export function hueTurn(c, deg) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.01) return [c[0], c[1], c[2]];
  const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo), hue = ((((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + deg) % 360) + 360) % 360;
  const q = (1 - Math.abs(2 * l - 1)) * s, x = q * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - q / 2;
  const [R, G, B] = hue < 60 ? [q, x, 0] : hue < 120 ? [x, q, 0] : hue < 180 ? [0, q, x] : hue < 240 ? [0, x, q] : hue < 300 ? [x, 0, q] : [q, 0, x];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255];
}
/**
 * A table for mapTones(): 256 steps of lightness onto colour stops [[at, [r, g, b]], …] (at from 0 to 1).
 * `hard` (0–1) pulls each step toward the nearer of its two stops, so the tones posterize.
 */
export function toneTable(stops, hard = 0) {
  const lut = new Uint8ClampedArray(768);
  for (let l = 0; l < 256; l++) {
    const t = l / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, c0] = stops[k], [t1, c1] = stops[k + 1], f = clamp((t - t0) / (t1 - t0 || 1)), s = f + ((f < 0.5 ? 0 : 1) - f) * hard;
    for (let q = 0; q < 3; q++) lut[l * 3 + q] = c0[q] + (c1[q] - c0[q]) * s;
  }
  return lut;
}
/**
 * A gradient map: every pixel of what the canvas holds, by its lightness, onto `lut` (see toneTable),
 * mixed in by `amt`; alpha kept; laid back within ctx's clip only.
 */
export function mapTones(ctx, lut, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const x = workLike(ctx, "tones"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0);
  const img = x.getImageData(0, 0, x.canvas.width, x.canvas.height), d = img.data, a = Math.min(1, amt), b = 1 - a;
  for (let i = 0; i < d.length; i += 4) {
    const j = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3;
    d[i] = d[i] * b + lut[j] * a; d[i + 1] = d[i + 1] * b + lut[j + 1] * a; d[i + 2] = d[i + 2] * b + lut[j + 2] * a;
  }
  x.putImageData(img, 0, 0);
  inPixels(ctx, () => ctx.drawImage(x.canvas, 0, 0));
}
/**
 * What the canvas holds over the cells of a grid — cols × rows cells `cell` units square from (x0, y0),
 * in the canvas's units — averaged down to one RGBA pixel a cell (in two steps, so it does not alias).
 */
export function sampled(ctx, x0, y0, cols, rows, cell, slot) {
  const src = snap(ctx, slot + "Snap"), m = ctx.getTransform(), k = m.a;
  const mid = WORK[slot + "Mid"] || (WORK[slot + "Mid"] = document.createElement("canvas")), t = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (mid.width !== cols * 4 || mid.height !== rows * 4) { mid.width = cols * 4; mid.height = rows * 4; }
  if (t.width !== cols || t.height !== rows) { t.width = cols; t.height = rows; }
  const a = mid.getContext("2d"), b = t.getContext("2d", { willReadFrequently: true });
  for (const c of [a, b]) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.globalCompositeOperation = "copy"; }
  a.drawImage(src, m.e + x0 * k, m.f + y0 * k, cols * cell * k, rows * cell * k, 0, 0, cols * 4, rows * 4);
  b.drawImage(mid, 0, 0, cols, rows);
  return b.getImageData(0, 0, cols, rows).data;
}
/** The channel graphic's silhouette (see graphicShape) placed as placeShape would, read over the same kind of grid: one coverage value (0–255) a cell. */
export function shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell) {
  const t = WORK.cells || (WORK.cells = document.createElement("canvas"));
  if (t.width !== cols * 3 || t.height !== rows * 3) { t.width = cols * 3; t.height = rows * 3; }
  const x = t.getContext("2d", { willReadFrequently: true });
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, t.width, t.height);
  x.setTransform(3 / cell, 0, 0, 3 / cell, (-x0 * 3) / cell, (-y0 * 3) / cell);
  placeShape(x, S, [255, 255, 255], cx, cy, size);
  const d = x.getImageData(0, 0, t.width, t.height).data, out = new Uint8Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let s = 0;
    for (let v = 0; v < 3; v++) for (let u = 0; u < 3; u++) s += d[((j * 3 + v) * t.width + i * 3 + u) * 4 + 3];
    out[j * cols + i] = s / 9;
  }
  return out;
}

// ====================================================================== shared, first written for collage: collage: paper, scissors, glue
/** A starburst: a spiky star, its points of uneven length. */
export function starburst(ctx, cx, cy, R, n, colour, k) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const t = (i / (n * 2)) * TAU + rand(k) * 0.4, r = i % 2 ? R * (0.42 + rand(k + i * 1.3) * 0.12) : R * (0.78 + rand(k + i * 2.7) * 0.28); ctx.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
  ctx.closePath(); ctx.fillStyle = css(colour); ctx.fill();
}

// ====================================================================== shared, first written for dots: dot matrix: pictures made of points of light
/** A rainbow colour at hue `t` (0–1). */
export const rainbow = (t) => hueTurn([255, 30, 30], (((t % 1) + 1) % 1) * 360);
/** Red and cyan copies of the picture, a little apart, lightened in: the fringe of a misaligned screen. */
export function rgbFringe(ctx, d) {
  if (d <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "fringe"), k = ctx.getTransform().a;
  for (const [s, col] of [[-1, [255, 40, 60]], [1, [40, 220, 255]]]) {
    const x = workLike(ctx, "fringe" + s); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0);
    x.globalCompositeOperation = "multiply"; x.fillStyle = css(col); x.fillRect(0, 0, x.canvas.width, x.canvas.height);
    inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.drawImage(x.canvas, s * d * k, 0); });
  }
}
/**
 * On a work canvas holding a silhouette, gives it volume: copies of the shape moved down and right
 * darken all of it but its upper-left rim, copies moved up and left lighten all but its lower-right
 * one — so the light comes from the upper left. `d`: the step, in units; `a`: how strongly.
 */
export function bevel(x, S, cx, cy, size, d, light, shade, a) {
  if (a <= 0) return;
  x.save(); x.globalCompositeOperation = "source-atop";
  for (let i = 1; i <= 3; i++) {
    x.globalAlpha = a * 0.28; placeShape(x, S, shade, cx + d * i, cy + d * i, size);
    x.globalAlpha = a * 0.2; placeShape(x, S, light, cx - d * i, cy - d * i, size);
  }
  x.restore();
}
/** A gradient along a line whose hues cycle like a soap film, starting at hue `turn` (0–1). */
export function iridescent(ctx, x0, y0, x1, y1, turn, alpha = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, css(mix(rainbow(turn + i * 0.13), [255, 255, 255], 0.12), alpha));
  return g;
}
/** A glass bubble: clear in the middle, tinted toward the rim, an iridescent edge, a highlight arc and a glint. */
export function glassBubble(ctx, x, y, r, tint, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x, y, r * 0.5, x, y, r);
  g.addColorStop(0, css(tint, 0.03)); g.addColorStop(0.85, css(tint, 0.2)); g.addColorStop(1, "rgba(255,255,255,0.5)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.035); ctx.strokeStyle = iridescent(ctx, x - r, y - r, x + r, y + r, rand(x * 0.01 + y * 0.013), 0.75); ctx.stroke();
  ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = Math.max(1.5, r * 0.07);
  ctx.beginPath(); ctx.arc(x, y, r * 0.72, Math.PI * 1.08, Math.PI * 1.42); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.44, Math.max(1, r * 0.06), 0, TAU); ctx.fill();
  ctx.restore();
}

// ====================================================================== shared: paint and glass over a picture
/**
 * A layer of a look painted once and kept: a canvas the size of ctx's, painted by paint(x) with ctx's
 * transform, and reused while `key` (all the painting depends on) stays the same — so a slider that does
 * not touch it costs one copy. One is kept per canvas size and slot (the main canvas, each thumbnail);
 * an export's large canvas gets none (null: paint straight onto it).
 */
export function keptLayer(ctx, slot, key, paint) {
  const cv = ctx.canvas, m = ctx.getTransform();
  if (cv.width * cv.height > 6e6) return null;
  const kept = WORK[slot] || (WORK[slot] = new Map()), size = `${cv.width}x${cv.height}`, full = `${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join()}|${key}`;
  let e = kept.get(size);
  if (e && e.key === full) return e.c;
  if (!e) {
    e = { c: document.createElement("canvas"), key: null }; e.c.width = cv.width; e.c.height = cv.height;
    kept.set(size, e); if (kept.size > 8) kept.delete(kept.keys().next().value);
  }
  const x = e.c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, cv.width, cv.height); x.setTransform(m);
  paint(x); e.key = full;
  return e.c;
}

// ====================================================================== shared: water mirroring what stands above it
/**
 * Water from the line y down to y1, across x0–x1: what is painted above the line mirrored into it, in thin
 * strips each slid sideways a little (more toward the foot, where the ripples are nearer), dimmed toward
 * `tint` (alpha a0 at the line, a1 at the foot). Needs a canvas; k0 places the ripples.
 */
export function reflectBelow(ctx, x0, x1, y, y1, tint, a0, a1, k0) {
  if (!canPaint(ctx) || y1 - y < 2) return;
  const cv = ctx.canvas, m = ctx.getTransform(), k = Math.abs(m.d) || 1;
  const X0 = Math.max(0, Math.floor(m.e + x0 * m.a)), X1 = Math.min(cv.width, Math.ceil(m.e + x1 * m.a)), Y = Math.round(m.f + y * m.d), Y1 = Math.min(cv.height, Math.round(m.f + y1 * m.d));
  if (X1 <= X0 || Y1 <= Y || Y <= 0) return;
  const top = Math.max(0, Y - (Y1 - Y)), src = WORK.reflect || (WORK.reflect = document.createElement("canvas"));   // only the band that is mirrored is copied
  if (src.width !== X1 - X0 || src.height !== Y - top) { src.width = X1 - X0; src.height = Y - top; }
  const sg = src.getContext("2d"); sg.globalCompositeOperation = "copy"; sg.drawImage(cv, X0, top, X1 - X0, Y - top, 0, 0, X1 - X0, Y - top);
  ctx.fillStyle = css(tint); ctx.fillRect(x0, y, x1 - x0, y1 - y);   // under the strips, so where one slid aside the water shows, not what was there
  inPixels(ctx, () => {
    for (let yy = 0, row = 0; yy < Y1 - Y; row++) {
      const t = yy / (Y1 - Y), sh = Math.max(1, Math.round((1.5 + 4 * t) * k)), from = Y - yy - sh - top;
      if (from < 0) break;
      ctx.drawImage(src, 0, from, X1 - X0, sh, X0 + (noise(row * 0.731 + k0) - 0.5) * (2 + 26 * t) * k, Y + yy, X1 - X0, sh);
      yy += sh;
    }
  });
  const g = ctx.createLinearGradient(0, y, 0, y1); g.addColorStop(0, css(tint, a0)); g.addColorStop(1, css(tint, a1));
  ctx.fillStyle = g; ctx.fillRect(x0, y, x1 - x0, y1 - y);
}
/** Whether two boxes { x, y, w, h } overlap. */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** The boxes a look's furniture should keep off: the title as it will be set, the corner tag, the channel graphic. */
export function keepClear(ctx, env) {
  const T = canPaint(ctx) ? titleArea(ctx, env) : null;
  return [...(T ? [{ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }] : []), ...keepOthers(env)];
}
/** Of the boxes keepClear keeps off, the corner tag's and the channel graphic's. */
export function keepOthers(env) {
  const out = [], tg = env.G && env.G.tag;
  if (tg) out.push({ x: tg.x - 20, y: tg.y - 20, w: 420, h: tg.fs * 1.34 + 40 });
  const A = env.G && env.G.art, on = env.graphic && env.cover && env.cover.layers.some((l) => l.id === "graphic" && l.visible);
  if (A && on) { const r = 330 * A.s; out.push({ x: A.x - r, y: A.y - r, w: r * 2, h: r * 2 }); }
  return out;
}

// ====================================================================== shared, first written for citypop: city pop: the night city of the OVA years
/** A line of neon tube along the current path, `lw` thick: a wide soft glow, a narrower one, the tube, and its white-hot core. */
export function neonTube(ctx, colour, lw, a = 1) {
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [k, al] of [[5, 0.14], [2.4, 0.4], [1, 1]]) { ctx.strokeStyle = css(colour, al * a); ctx.lineWidth = lw * k; ctx.stroke(); }
  ctx.strokeStyle = css(mix(colour, [255, 255, 255], 0.7), a); ctx.lineWidth = lw * 0.4; ctx.stroke();
  ctx.restore();
}

// ====================================================================== shared, first written for deco: dark deco: the Art Deco city by night, painted on black
/** A band of fog lying at y, `th` thick either side, across x0–x1: a soft band and puffs along its top. */
export function dkFogBand(ctx, x0, x1, y, th, col, a, k0) {
  if (a <= 0) return;
  const gr = ctx.createLinearGradient(0, y - th, 0, y + th); gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.55, css(col, a)); gr.addColorStop(1, css(col, a * 0.35));
  ctx.fillStyle = gr; ctx.fillRect(x0, y - th, x1 - x0, th * 2);
  for (let i = 0, n = Math.max(3, Math.round((x1 - x0) / (th * 2.2))); i < n; i++) {
    const px = x0 + (x1 - x0) * ((i + rand(k0 + i) * 0.8) / n), py = y - th * (0.2 + rand(k0 + i * 2.3) * 0.5), r = th * (0.5 + rand(k0 + i * 3.1) * 0.7);
    const pg = ctx.createRadialGradient(px, py, 0, px, py, r); pg.addColorStop(0, css(col, a * 0.5)); pg.addColorStop(1, css(col, 0));
    ctx.fillStyle = pg; ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
}
/** [r, g, b] -> [hue (0–360), saturation, lightness]. */
export function dkHsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.02) return [0, 0, l];
  return [((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360, l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo), l];
}
export function dkRgb(h, s, l) {
  const q = (1 - Math.abs(2 * l - 1)) * s, x = q * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - q / 2;
  const [R, G, B] = h < 60 ? [q, x, 0] : h < 120 ? [x, q, 0] : h < 180 ? [0, q, x] : h < 240 ? [0, x, q] : h < 300 ? [x, 0, q] : [q, 0, x];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255];
}
/** Where a line of lettering `fs` high and `right` long lies on ctx's canvas, in whole pixels, with a little room round it: { x0, y0, w, h, k (pixels per unit) }, or null when it is off the canvas. */
export function dkBox(ctx, fs, right) {
  const m = ctx.getTransform(), pts = [[-fs * 0.12, -fs * 1.02], [right + fs * 0.12, -fs * 1.02], [-fs * 0.12, fs * 0.28], [right + fs * 0.12, fs * 0.28]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0])))), y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1]))));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((q) => q[0])))), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((q) => q[1]))));
  return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, w: x1 - x0, h: y1 - y0, k: Math.hypot(m.a, m.b) } : null;
}
/** A work canvas the size of box B (see dkBox), cleared, drawing with ctx's transform and font, so lettering painted on it lands where it would on ctx. One per `slot`. */
export function dkWork(ctx, slot, B) {
  const c = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (c.width !== B.w || c.height !== B.h) { c.width = B.w; c.height = B.h; }
  const x = c.getContext("2d"), m = ctx.getTransform();
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.shadowColor = "rgba(0,0,0,0)"; x.shadowBlur = x.shadowOffsetX = x.shadowOffsetY = 0; x.clearRect(0, 0, B.w, B.h);
  x.setTransform(m.a, m.b, m.c, m.d, m.e - B.x0, m.f - B.y0);
  x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;
  return x;
}

// ====================================================================== the registry
export const LOOKS = {};   // every look by its id: style.js puts each look's object in

// ====================================================================== effects for the user's own layers
// A look's *material* effects — how one thing is drawn or printed, depending only on its own shape and
// pixels — can be put on a single layer the user added. Each look lists its own as `elementFx`:
//   { key, name: {zh, en}, for: [layer types], stage, sub?: [{ key, name, def }], paint(x, B, amt, E, opt) }
// `stage` places it in the order every layer's effects are painted in: "fill" (the colour inside the
// outline replaced) → "over" (texture laid inside it) → "filter" (the pixels worked on) → "behind"
// (painted outside the outline). paint() works on the layer's own work canvas in canvas pixels, within
// the layer's box B { x0, y0, x1, y1, w, h }; amt is 0–1 (0: off); E = { k: pixels per unit, R(n): the
// layer's own random numbers, seed, C: the channel colour }; opt holds its sub-settings.
// A layer keeps its effects itself, `L.lookFx = { "look.key": amount, "look.key:sub": value }`, whatever
// look the cover is in: one borrowed from another look stays with the layer when the look changes.
/** The order every layer's effects are painted in. */
export const FX_STAGES = ["fill", "over", "filter", "behind"];
/** The layer types the effects are open to: the user's own, and the title and subtitle, which take what a text layer takes. */
export const FX_TYPES = ["text", "asset", "photo", "solid", "title", "subtitle"];
export const FX_ALL = ["text", "asset", "photo", "solid"];
const fxType = (type) => (type === "title" || type === "subtitle" ? "text" : type);
/** The effects a look opens to a type of layer. */
export const effectsFor = (look, type) => ((LOOKS[look] && LOOKS[look].elementFx) || []).filter((e) => e.for.includes(fxType(type)) && FX_TYPES.includes(type));
/** A layer's effects that are on and apply to it, in the order they are painted: [{ id, look, fx, amt, opt }]. */
export function layerEffects(L) {
  const all = L && L.lookFx, out = [];
  if (!all || !FX_TYPES.includes(L.type)) return out;
  for (const [id, amt] of Object.entries(all)) {
    if (id.includes(":") || !(amt > 0)) continue;
    const [look, key] = id.split("."), fx = ((LOOKS[look] && LOOKS[look].elementFx) || []).find((e) => e.key === key);
    if (!fx || !fx.for.includes(fxType(L.type))) continue;
    const opt = {};
    for (const s of fx.sub || []) { const v = all[`${id}:${s.key}`]; opt[s.key] = Number.isFinite(v) ? clamp(v) : s.def; }
    out.push({ id, look, fx, amt: clamp(amt), opt });
  }
  return out.sort((a, b) => FX_STAGES.indexOf(a.fx.stage) - FX_STAGES.indexOf(b.fx.stage) || (a.id < b.id ? -1 : 1));
}
/** Time spent in each layer effect (ms by id), with the drawing finished before and after each: for the timing self-test; off otherwise. */
export const FX_TIMING = { on: false, ms: {} };
/** A seed from a layer's id: the same layer gets the same scatter in every size, the preview and the export. */
const idSeed = (id) => { let h = 7; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return (h >>> 0) % 100003; };
/**
 * Paints a layer's effects (see layerEffects) on the work canvas it was painted on, stage by stage,
 * each within the layer's box B (canvas pixels). `k`: canvas pixels per unit; `C`: the channel colour.
 * Returns the box the layer and its effects may have reached (each effect says how far past B it
 * paints, `reach`), so only that need be laid down — or null when nothing was painted.
 */
export function paintEffects(x, B, list, L, k, C) {
  if (!list.length || !canPaint(x) || B.w < 2 || B.h < 2) return null;
  const seed = idSeed(L.id), E = { k, seed, C: C || [255, 200, 0], R: (n) => noise(n * 0.7071 + seed * 0.013), type: fxType(L.type) }, m = Math.max(B.w, B.h) * 0.12 + 24 * k;   // the layer's own shadows and outlines may stand a little outside its box
  const out = { l: m, t: m, r: m, b: m };
  const flush = () => x.getImageData(0, 0, 1, 1);
  if (FX_TIMING.on) flush();
  for (const e of list) {
    const t0 = FX_TIMING.on ? performance.now() : 0;
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    try { e.fx.paint(x, B, e.amt, E, e.opt); } finally { x.restore(); }
    if (FX_TIMING.on) { flush(); FX_TIMING.ms[e.id] = (FX_TIMING.ms[e.id] || 0) + performance.now() - t0; }
    const g = e.fx.reach ? e.fx.reach(B, k) : null;
    if (g) for (const s of ["l", "t", "r", "b"]) out[s] = Math.max(out[s], m + (g[s] || 0));
  }
  const W = x.canvas.width, H = x.canvas.height, x0 = Math.max(0, Math.floor(B.x0 - out.l)), y0 = Math.max(0, Math.floor(B.y0 - out.t)), x1 = Math.min(W, Math.ceil(B.x1 + out.r)), y1 = Math.min(H, Math.ceil(B.y1 + out.b));
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
/**
 * A work canvas for the effects, kept per slot and sized w × h, held in memory rather than on the
 * graphics card (as the layer's own canvas is, see render.js): copying from it, reading it back and
 * drawing it onto itself then cost no round trip to the card — which in the app's web view is what
 * made effects slow.
 */
export function fxCanvas(slot, w, h) {
  let c = WORK[slot];
  if (!c) { c = WORK[slot] = document.createElement("canvas"); c.getContext("2d", { willReadFrequently: true }); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/**
 * Many round dots in `colour` (a halftone: tens of thousands) laid on x as one shape would be, at alpha `a` in the way
 * `op` says; `each(dot)` calls dot(cx, cy, r) for every dot, in x's pixels, the dots of box B (a dot reaching past it,
 * as it did drawn as a path, is laid whole, within the canvas). They are worked out here, pixel by pixel (dotCover),
 * not drawn as paths: on a canvas held in memory (fxCanvas, as a layer's work canvas is) macOS's own drawing took some
 * 60 µs a dot however they were batched — 57,000 dots, the halftone of a photo filling the canvas, 3 to 15 s at every
 * size, a thumbnail's and a look card's too — where this takes 10 ms at a thumbnail's size and some 150 ms at the
 * canvas's.
 */
export function fillDots(x, B, colour, a, op, each) {
  const dots = [];
  each((cx, cy, r) => { if (r > 0 && Number.isFinite(cx) && Number.isFinite(cy)) dots.push(cx, cy, r); });   // one not a number: that dot alone left out, as a path would
  if (!dots.length) return;
  const G = dotsBox(B, dots, x.canvas.width, x.canvas.height);
  if (!G) return;
  if (!DOTS.img || DOTS.img.width !== G.w || DOTS.img.height !== G.h) { DOTS.cover = new Float32Array(G.w * G.h); DOTS.img = new ImageData(G.w, G.h); } else DOTS.img.data.fill(0);
  const A = dotCover(G, dots, DOTS.cover), d = DOTS.img.data;
  for (let q = 0, o = 0; q < A.length; q++, o += 4) { const al = A[q]; if (al > 0) { d[o] = colour[0]; d[o + 1] = colour[1]; d[o + 2] = colour[2]; d[o + 3] = al * 255; } }
  const c = fxCanvas("fxDots", G.w, G.h);
  c.getContext("2d").putImageData(DOTS.img, 0, 0);
  x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = op; x.globalAlpha = a; x.drawImage(c, G.x0, G.y0); x.restore();
}
/** fillDots' cover of each pixel and the picture made of it, kept for the next of the same width and height. */
const DOTS = { cover: null, img: null };
/**
 * The box the dots (`dots`: [cx, cy, r, …]) are worked out in: box B, grown to take every dot whole, within a canvas
 * W × H; whole pixels, {x0, y0, w, h}, or null when it has no room.
 */
export function dotsBox(B, dots, W, H) {
  let x0 = B.x0, y0 = B.y0, x1 = B.x0 + B.w, y1 = B.y0 + B.h;
  for (let k = 0; k < dots.length; k += 3) { const r = dots[k + 2] + 1; x0 = Math.min(x0, dots[k] - r); y0 = Math.min(y0, dots[k + 1] - r); x1 = Math.max(x1, dots[k] + r); y1 = Math.max(y1, dots[k + 1] + r); }
  x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
  return x1 > x0 && y1 > y0 ? { x0, y0, w: x1 - x0, h: y1 - y0 } : null;
}
/**
 * How much of each pixel of box G ({x0, y0, w, h}) the dots ([cx, cy, r, …]) cover, 0 to 1, row by row (in `into`, a
 * Float32Array of G's size, when given). A dot's edge is softened over a pixel, as a canvas would, its radius taken a
 * little in so that what it covers in all is its area (softened so, a dot of radius r covers π(r² + 1/12), or one under
 * half a pixel π(r + ½)³ / 3); one of less than a pixel's area has it shared out among the four pixels round it, so a
 * halftone too fine to show as dots gives the tone it would. Where dots overlap, the pixel is covered as by one over the other, never less than by either.
 */
export function dotCover(G, dots, into = null) {
  const { w, h } = G, A = into && into.length === w * h ? into.fill(0) : new Float32Array(w * h);
  const add = (i, j, c) => { if (i >= 0 && j >= 0 && i < w && j < h && c > 0) { const q = j * w + i; A[q] += Math.min(1, c) * (1 - A[q]); } };
  for (let k = 0; k < dots.length; k += 3) {
    const px = dots[k] - G.x0, py = dots[k + 1] - G.y0, r = dots[k + 2];
    if (r * r * Math.PI < 1) { const fx = px - 0.5, fy = py - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fy), u = fx - i0, v = fy - j0, s = Math.PI * r * r; add(i0, j0, (1 - u) * (1 - v) * s); add(i0 + 1, j0, u * (1 - v) * s); add(i0, j0 + 1, (1 - u) * v * s); add(i0 + 1, j0 + 1, u * v * s); continue; }
    const re = r * r >= 1 / 3 ? Math.sqrt(r * r - 1 / 12) : Math.cbrt(3 * r * r) - 0.5, x0 = Math.max(0, Math.floor(px - re - 0.5)), x1 = Math.min(w - 1, Math.ceil(px + re + 0.5)), y0 = Math.max(0, Math.floor(py - re - 0.5)), y1 = Math.min(h - 1, Math.ceil(py + re + 0.5));
    for (let j = y0; j <= y1; j++) { const dy = j + 0.5 - py; for (let i = x0; i <= x1; i++) { const dx = i + 0.5 - px, c = re + 0.5 - Math.sqrt(dx * dx + dy * dy); if (c > 0) { const q = j * w + i; A[q] += (c > 1 ? 1 : c) * (1 - A[q]); } } }
  }
  return A;
}
/** A copy of what the work canvas x holds in box B (a canvas of B's size, kept per slot). */
export function region(x, B, slot) {
  const c = fxCanvas(slot, B.w, B.h), g = c.getContext("2d");
  g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.drawImage(x.canvas, B.x0, B.y0, B.w, B.h, 0, 0, B.w, B.h);
  return c;
}
/** A canvas's shape in one colour (kept per slot). */
export function shapeIn(src, colour, slot) {
  const c = fxCanvas(slot, src.width, src.height), g = c.getContext("2d");
  g.globalCompositeOperation = "copy"; g.drawImage(src, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = css(colour); g.fillRect(0, 0, c.width, c.height);
  return c;
}
/** Bands of the layer slid sideways (each first cleared, so it is not doubled); `bars` adds a thin bar of colour to some. */
export function slideBands(x, B, a, E, n0, bars) {
  const src = region(x, B, "fxBands"), n = Math.round(n0 + 8 * a);
  for (let i = 0; i < n; i++) {
    const y = Math.round(B.y0 + B.h * E.R(i * 2.7 + 1)), bh = Math.max(1, Math.round(B.h * (0.015 + E.R(i * 3.3 + 2) * 0.09))), dx = Math.round((E.R(i * 4.1 + 3) - 0.5) * B.w * 0.16 * (0.3 + a));
    if (y + bh > B.y1) continue;
    x.clearRect(B.x0, y, B.w, bh); x.drawImage(src, 0, y - B.y0, B.w, bh, B.x0 + dx, y, B.w, bh);
    if (bars && E.R(i * 5.3 + 4) > 0.5) { x.fillStyle = css([[255, 40, 80], [40, 220, 255], [80, 255, 120], boost(E.C, 0.7)][i % 4], 0.85); x.fillRect(B.x0 + B.w * E.R(i * 6.1 + 5) * 0.8, y, B.w * (0.05 + E.R(i + 6) * 0.2), Math.max(1, bh * 0.6)); }
  }
}
// ---------- shared painters for the looks' layer effects (every one works in B, the layer's box, in canvas pixels)
export const FX_PHOTO = ["photo"];
/** A copy of src softened by drawing it down `f` times smaller in two steps (so it does not sparkle): laid on enlarged, it is blurred. */
export function softened(src, f, slot) {
  const g1 = Math.min(f, 4), mw = Math.max(1, Math.round(src.width / g1)), mh = Math.max(1, Math.round(src.height / g1)), sw = Math.max(1, Math.round(src.width / f)), sh = Math.max(1, Math.round(src.height / f));
  const mid = fxCanvas(slot + "m", mw, mh), small = fxCanvas(slot, sw, sh), m = mid.getContext("2d"), s = small.getContext("2d");
  for (const g of [m, s]) { g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; }
  m.drawImage(src, 0, 0, mw, mh); s.drawImage(mid, 0, 0, sw, sh);
  return small;
}
/** src with `pad` px of clear canvas all round it (kept per slot). */
export function padded(src, pad, slot) {
  const c = fxCanvas(slot, src.width + 2 * pad, src.height + 2 * pad), g = c.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, c.width, c.height); g.drawImage(src, pad, pad);
  return c;
}
/** A glow round the layer: its shape in `colour` (the layer itself without one) spread R px out, laid behind it at `alpha`, moved by (dx, dy). */
export function glowBehind(x, B, src, R, alpha, colour, dx = 0, dy = 0, mode = "destination-over") {
  if (R < 1 || alpha <= 0) return;
  const pad = Math.ceil(R * 1.6) + 2, c = padded(colour ? shapeIn(src, colour, "fxGs") : src, pad, "fxG"), soft = softened(c, Math.max(2, R / 2.2), "fxGb");
  x.save(); x.globalCompositeOperation = mode; x.globalAlpha = Math.min(1, alpha); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(soft, B.x0 - pad + dx, B.y0 - pad + dy, c.width, c.height);
  x.restore();
}
/** Paints draw(g) on a canvas of B's size, keeps it to the layer's own pixels and lays it on in `mode`: a texture never outside the layer. */
export function onLayer(x, B, src, mode, alpha, draw) {
  const c = fxCanvas("fxOn", B.w, B.h), g = c.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, B.w, B.h);
  g.save(); draw(g); g.restore();
  g.globalCompositeOperation = "destination-in"; g.drawImage(src, 0, 0);
  x.save(); x.globalCompositeOperation = mode; x.globalAlpha = Math.min(1, alpha); x.drawImage(c, B.x0, B.y0); x.restore();
}
/** A fill of dots `p` px apart, radius r, on a lattice turned by `turn` degrees (tiles kept). */
export function dotFill(g, colour, p, r, turn = 45) {
  p = Math.max(3, Math.round(p)); r = Math.max(0.4, Math.round(r * 10) / 10);
  const key = `fxDotTile|${colour.map(Math.round).join()}|${p}|${r}`;
  let t = WORK[key];
  if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = t.height = p; const c = t.getContext("2d"); c.fillStyle = css(colour); c.beginPath(); c.arc(p / 2, p / 2, r, 0, TAU); c.fill(); }
  const pat = g.createPattern(t, "repeat");
  if (pat && pat.setTransform && typeof DOMMatrix !== "undefined" && turn) pat.setTransform(new DOMMatrix().rotateSelf(turn));
  return pat;
}
/** A gradient over B's size, clear toward its upper left and solid toward its lower right: the side turned from the light. */
export function shadeSide(g, w, h) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.42, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)"); return gr; }
/** Every pixel of the layer in B through f(r, g, b, y, out) — y 0 at B's top, 1 at its foot — mixed in by a; alpha kept. */
export function eachPixel(x, B, a, f) {
  const img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data, b = 1 - a, o = [0, 0, 0];
  for (let row = 0, i = 0; row < B.h; row++) {
    const y = row / B.h;
    for (let col = 0; col < B.w; col++, i += 4) {
      if (!d[i + 3]) continue;
      f(d[i], d[i + 1], d[i + 2], y, o);
      d[i] = d[i] * b + o[0] * a; d[i + 1] = d[i + 1] * b + o[1] * a; d[i + 2] = d[i + 2] * b + o[2] * a;
    }
  }
  x.putImageData(img, B.x0, B.y0);
}
/**
 * A painter mapping the layer by lightness onto colour stops (see toneTable), stepping between them with
 * `hard`. Written out rather than through eachPixel: on a background photo it is millions of pixels.
 */
export const tonesFx = (stopsOf, hard = 0) => (x, B, a, E) => {
  const lut = toneTable(stopsOf(E), hard), img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], j = ((r * 54 + g * 183 + b * 19) >> 8) * 3;
    d[i] = r + (lut[j] - r) * a; d[i + 1] = g + (lut[j + 1] - g) * a; d[i + 2] = b + (lut[j + 2] - b) * a;
  }
  x.putImageData(img, B.x0, B.y0);
};
/** A painter turning the layer one flat colour or fill, its shape kept. */
export const flatFx = (fillOf) => (x, B, a, E) => {
  x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip();
  x.globalCompositeOperation = "source-atop"; x.globalAlpha = a; x.fillStyle = fillOf(x, B, E); x.fillRect(B.x0, B.y0, B.w, B.h);
};
/** Knocks the ground through the layer in worn patches: the wear texture at `zoom`, shifted by the layer's own random amount. */
export function knockWorn(x, B, a, E, zoom) {
  const W = x.canvas.width, H = x.canvas.height, tex = wornTexture(W / E.k, H / E.k), ox = (E.R(91) - 0.5) * W * 0.3, oy = (E.R(92) - 0.5) * H * 0.3;
  x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip();
  x.globalCompositeOperation = "destination-out"; x.globalAlpha = Math.min(1, a);
  x.drawImage(tex, ox - (W * (zoom - 1)) / 2, oy - (H * (zoom - 1)) / 2, W * zoom, H * zoom);
  x.restore();
}
/** A painter laying a halftone of colour(E) over the layer — dots `pitch(E)` px apart growing with the strength — in `mode`; with `shade`, on its shaded side only. */
export const dotsFx = ({ colour, pitch, size, mode = "multiply", shade = false, turn = 45 }) => (x, B, a, E) => {
  const p = pitch(E), src = region(x, B, "fxA");
  onLayer(x, B, src, mode, 1, (g) => {
    g.fillStyle = dotFill(g, colour(E), p, size(p, a), turn); g.fillRect(0, 0, B.w, B.h);
    if (shade) { g.globalCompositeOperation = "destination-in"; g.fillStyle = shadeSide(g, B.w, B.h); g.fillRect(0, 0, B.w, B.h); }
  });
};
/** Copies of src trailing off (dx, dy) px apart, each fainter, laid in `mode` (behind the layer, or over it). */
export function trail(x, B, src, n, dx, dy, alpha, mode) {
  x.save(); x.globalCompositeOperation = mode;
  for (let i = n; i >= 1; i--) { x.globalAlpha = Math.min(1, alpha * (1 - i / (n + 1))); x.drawImage(src, B.x0 + dx * i, B.y0 + dy * i); }
  x.restore();
}
/** The layer in one channel's worth of colour: src multiplied by `keep`, its shape kept (a canvas per slot). */
function plateOf(src, keep, slot) {
  const c = fxCanvas(slot, src.width, src.height), g = c.getContext("2d");
  g.globalCompositeOperation = "copy"; g.drawImage(src, 0, 0); g.globalCompositeOperation = "multiply"; g.fillStyle = css(keep); g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "destination-in"; g.drawImage(src, 0, 0);
  return c;
}
/**
 * The layer taken apart into plates and laid back added together, each moved: `plates` is
 * [[colour kept, dx, dy, scale about the middle]…], covering red, green and blue between them.
 */
export function rePlate(x, B, plates) {
  const src = region(x, B, "fxA"), made = plates.map(([keep], i) => plateOf(src, keep, "fxPl" + i));
  x.clearRect(B.x0, B.y0, B.w, B.h); x.save(); x.globalCompositeOperation = "lighter";
  plates.forEach(([, dx, dy, s = 1], i) => { const w = B.w * s, h = B.h * s; x.drawImage(made[i], B.x0 + (B.w - w) / 2 + dx, B.y0 + (B.h - h) / 2 + dy, w, h); });
  x.restore();
}
/** Clears B and lays src back cut in horizontal bands, band i moved by shift(i, n) px (n bands, `cuts` the band edges as fractions of B's height). */
export function cutBands(x, B, src, cuts, shift) {
  x.clearRect(B.x0, B.y0, B.w, B.h);
  for (let i = 0; i < cuts.length - 1; i++) { const y0 = Math.round(cuts[i] * B.h), y1 = Math.round(cuts[i + 1] * B.h); if (y1 > y0) x.drawImage(src, 0, y0, B.w, y1 - y0, B.x0 + shift(i), B.y0 + y0, B.w, y1 - y0); }
}
/** The layer read in square cells of `cs` px, one pixel a cell (averaged as it is drawn down): [data, cols, rows]. */
export function cellsOf(x, B, cs) {
  const cols = Math.max(1, Math.ceil(B.w / cs)), rows = Math.max(1, Math.ceil(B.h / cs)), t = fxCanvas("fxCells", cols, rows), tg = t.getContext("2d");
  tg.globalCompositeOperation = "copy"; tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
  tg.drawImage(x.canvas, B.x0, B.y0, cols * cs, rows * cs, 0, 0, cols, rows);
  return [tg.getImageData(0, 0, cols, rows).data, cols, rows];
}
export const lumOf = (d, q) => (d[q] * 54 + d[q + 1] * 183 + d[q + 2] * 19) / 65280;
/**
 * Drops running down from the layer's lowest edges, in `colour` (or, without one, the colour of the edge
 * above each), with a highlight down it — the layer smeared downward by laying the canvas behind itself
 * 1, 2, 4, 8… px lower, cut down to drops of `width` (× the unit) and laid behind the layer.
 */
export function dripsBehind(x, B, a, E, colour, width) {
  const len = B.h * 0.6 * a + 10 * E.k, H = Math.ceil(B.h + len), src = region(x, B, "fxA"), c = fxCanvas("fxDrip", B.w, H), g = c.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, B.w, H); g.drawImage(colour ? shapeIn(src, colour, "fxDs") : src, 0, 0);
  g.globalCompositeOperation = "destination-over";
  for (let d = 1; d < len; d *= 2) g.drawImage(c, 0, d);
  g.globalCompositeOperation = "destination-in"; g.fillStyle = "#fff"; g.beginPath();
  const n = 3 + 14 * a, hl = [];
  for (let k = 0; k < Math.ceil(n); k++) {
    const cx = B.w * E.R(k * 2.3 + 11), dw = Math.max(2, (3 + E.R(k * 3.7 + 12) * 7) * E.k * width) * (k < Math.floor(n) ? 1 : clamp(n - k)), top = B.h * (0.2 + 0.3 * E.R(k * 5.1 + 14)), bottom = B.h + len * (0.15 + 0.85 * E.R(k * 4.3 + 13)) - dw;
    rounded(g, cx - dw / 2, top, dw, bottom - top, dw / 2); g.moveTo(cx + dw * 0.68, bottom); g.arc(cx, bottom, dw * 0.68, 0, TAU);
    hl.push([cx - dw * 0.18, top, dw * 0.2, bottom - top]);
  }
  g.fill();
  g.globalCompositeOperation = "source-atop"; g.fillStyle = "rgba(255,255,255,0.45)";
  for (const [hx, ht, hw, hh] of hl) g.fillRect(hx, ht, hw, hh);
  x.save(); x.globalCompositeOperation = "destination-over"; x.drawImage(c, B.x0, B.y0); x.restore();
}
/** Rings of colour round the layer, behind it: [[colour, distance in px]…], the first nearest. */
export function ringsBehind(x, B, src, rings) {
  x.save(); x.globalCompositeOperation = "destination-over";
  rings.forEach(([colour, r], n) => { const s = shapeIn(src, colour, "fxRing" + n); for (let i = 0; i < 16; i++) { const t = (i / 16) * TAU; x.drawImage(s, B.x0 + Math.cos(t) * r, B.y0 + Math.sin(t) * r); } });
  x.restore();
}
/** The layer's own colours pushed toward fewer steps (4 to a channel), mixed in by a: posterized by degrees. */
export const posterize = (x, B, a) => eachPixel(x, B, a, (r, g, b, y, o) => { o[0] = Math.round(r / 85) * 85; o[1] = Math.round(g / 85) * 85; o[2] = Math.round(b / 85) * 85; });
/** A painter lighting and shading the layer's own edges, as light from the upper left would: copies of its shape a step down-right darken, a step up-left lighten. */
export const bevelFx = (lightA, shadeA, step) => (x, B, a, E) => {
  const src = region(x, B, "fxA"), d = Math.max(1, Math.min(B.w, B.h) * step), white = shapeIn(src, [255, 255, 255], "fxW"), black = shapeIn(src, [0, 0, 0], "fxK");
  x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop";
  for (let i = 1; i <= 2; i++) { x.globalAlpha = a * shadeA; x.drawImage(black, B.x0 + d * i * 1.5, B.y0 + d * i * 1.5); x.globalAlpha = a * lightA; x.drawImage(white, B.x0 - d * i * 1.5, B.y0 - d * i * 1.5); }
};

// ====================================================================== the current look and its values
export let current = null, values = {};   // the house look (cel) until setLook(): see houseLook()
/** Makes `l` current before any setLook(): style.js hands over the house look (cel), whose file this one cannot import. */
export function houseLook(l) { current = l; }
/**
 * Fast mode leaves out effects that cost whole-canvas work. drawCover() turns it on for the frames
 * of a drag, so a moving layer stays smooth; the full picture returns when the drag ends.
 */
export function setFast(on) { fast = !!on; }
/** Whether a drag is in progress (costly finishing can be lighter meanwhile). */
export const isFast = () => fast;
/** Default parameter values of a look, overridden by `given` where that holds a number in range. */
export function lookParams(id, given) {
  const out = {};
  for (const d of (LOOKS[id] || LOOKS.cel).params) {
    const v = given && given[d.key];
    out[d.key] = d.text ? (typeof v === "string" ? [...v.trim()].slice(0, d.max).join("") : d.def) : Number.isFinite(v) ? clamp(v, d.min, d.max) : d.def;
  }
  return out;
}
/** Makes a look current. `given` are the profile's own parameter values for it. */
export function setLook(id, given, s = 7, onDark = true) { const was = current; current = LOOKS[id] || LOOKS.cel; values = lookParams(current.id, given); seed = Number.isFinite(s) ? s : 7; dark = !!onDark; if (was !== current && was && was.leave) was.leave(); return current; }
export const look = () => current;
export const lookValues = () => values;
let reads = null;   // see readsInto()
/**
 * From now until setLook() is called again, notes which of the current look's values are read: each read
 * is added to the set last named by readsInto() (none: not noted). A painter can only paint otherwise for
 * another value of a setting by reading it, so what did not read it cannot have changed: while a look's
 * slider is dragged, a layer that did not read its setting is kept as painted (see o.draft in render.js).
 * Every way to the values goes through `values` (lookValues() hands out the same), so every read is seen;
 * a copy made of them all (a cache's key) reads them all.
 */
export function noteReads() { const own = values; values = new Proxy(own, { get: (o, k) => { if (reads && typeof k === "string") reads.add(k); return o[k]; } }); }
/** Where reads of the look's values are noted from now on (null: nowhere); returns where they were. */
export function readsInto(set) { const was = reads; reads = set; return was; }
/** What else decides how the current look paints, besides its values: the ground it is on and the profile's seed. */
export const lookState = () => `${dark ? 1 : 0}|${seed}`;
/** The context graphics and the small cover parts should draw on under the current look. */
export const styled = (ctx, C, plates = false) => (current.wrap ? current.wrap(ctx, C, values, plates) : ctx);
