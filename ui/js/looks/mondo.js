// mondo: the screen-print odyssey — the limited-edition film and fantasy print
// After the screen-printed posters of the boutique print houses (Kilian Eng and his kind): a grand vista in four to six
// flat inks, the paper showing through, the plates a little off register; a world made of line — dense parallel
// hatching on the faces turned from the light, stipple for the gradients of the sky, crystal peaks cut into facets,
// clouds of stacked lobes, thin rules radiating from the sun; mesas stepping back in paler inks, a spire on the far
// horizon, a lone figure on the path of light for scale, a cave mouth framing it all; the title an elegant serif with
// an inline, off register in a second ink, the highlighted words in the hot ink (the channel colour). Five ink sets.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, boost, canPaint, clamp, css, dark, dkBox, dkWork, every, fall, fast, grain, graphicShape, gridPath, gridPen, inPixels, keepClear, lum, mapped, mix, objAt, openField, painters, parseColour, placeShape, rand, region, role, sat, seed, shapeIn, shapeOf, titleArea, upright, values, wear } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { inPiece } from "../title.js";

// ====================================================================== the inks
/**
 * The five ink sets, each a print's palette: `key` the line ink, `deep` and `cool` the shadow family, `lit` and `glow`
 * the light family, `paper` the cream stock of the light print and `night` the dark stock of the dark one; `sun` the
 * disc on the cream stock where the light family is too pale to read there.
 */
const MO_SETS = [
  { id: "dune", night: [20, 16, 38], key: [24, 17, 34], deep: [58, 48, 116], cool: [132, 120, 210], lit: [234, 110, 38], glow: [252, 194, 100], paper: [245, 233, 207] },
  { id: "story", night: [14, 15, 42], key: [17, 15, 38], deep: [56, 48, 132], cool: [148, 140, 230], lit: [248, 150, 34], glow: [255, 218, 128], paper: [247, 240, 224] },
  { id: "glacier", night: [8, 22, 42], key: [8, 18, 34], deep: [20, 68, 104], cool: [60, 152, 176], lit: [152, 216, 226], glow: [238, 249, 247], paper: [229, 239, 236], sun: [240, 124, 70] },
  { id: "jungle", night: [11, 27, 29], key: [12, 22, 20], deep: [24, 74, 72], cool: [80, 136, 108], lit: [210, 168, 56], glow: [244, 222, 148], paper: [238, 232, 206] },
  { id: "temple", night: [26, 8, 16], key: [22, 6, 12], deep: [118, 20, 40], cool: [200, 48, 58], lit: [242, 132, 118], glow: [253, 210, 190], paper: [246, 233, 222] },
];
/** The ink set at slider value v (0–1: the nearest of the five). */
export const moSet = (v) => MO_SETS[Math.round(clamp(Number.isFinite(v) ? v : 0) * (MO_SETS.length - 1))];
/**
 * The channel colour as the print's hot ink: saturated, its hue kept, its value kept in the band where it reads both
 * on the night stock and on the cream (and the house ink reads on it as a block); a grey gives the set's own lit ink.
 */
export function moHot(C, S) {
  if (sat(C) < 0.14 || Math.max(C[0], C[1], C[2]) - Math.min(C[0], C[1], C[2]) < 26) return S.lit;
  let c = boost(C, 0.55);
  for (let i = 0; i < 12 && lum(c) < 0.3; i++) c = mix(c, [255, 255, 255], 0.08);
  for (let i = 0; i < 12 && lum(c) > 0.62; i++) c = mix(c, [0, 0, 0], 0.08);
  return c;
}
/**
 * Every ink the picture is printed in, by the job it does, for the ink set of p and the ground (the night stock or the
 * cream): the sky's four steps from the top down to the horizon and the land's two, the far peaks, the spire, the
 * three rows of mesas (paler the further off), the path, the cave, the title. Everything is one of the set's inks or
 * two of them laid together; nothing else is printed.
 */
export function moInks(p, C, onDark = dark) {
  const S = moSet(p && p.inks), hot = moHot(C || [234, 110, 38], S);
  const I = { set: S.id, dark: onDark, key: S.key, deep: S.deep, cool: S.cool, lit: S.lit, glow: S.glow, paper: S.paper, night: S.night, hot };
  if (onDark) {
    Object.assign(I, {
      ground: S.night, sky: [S.night, mix(S.night, S.deep, 0.5), S.deep, mix(S.deep, S.cool, 0.62)], land: [mix(S.lit, S.deep, 0.28), mix(S.lit, S.deep, 0.62)],
      sun: S.glow, ring: S.lit, ray: S.glow, halo: mix(S.cool, S.glow, 0.55), star: S.glow,
      cloud: mix(S.deep, S.cool, 0.72), cloudShade: S.deep, cloudLine: S.key,
      far: S.cool, farMid: mix(S.cool, S.deep, 0.45), farShade: S.deep, farSnow: mix(S.cool, S.glow, 0.55), farLine: S.key,
      tower: S.glow, towerMid: mix(S.glow, S.cool, 0.45), towerShade: S.cool, towerLine: S.key,
      mesa: [mix(S.lit, S.cool, 0.55), mix(S.lit, S.cool, 0.22), S.lit], mesaShade: [mix(S.deep, S.cool, 0.45), mix(S.deep, S.cool, 0.15), S.deep],
      path: mix(S.glow, S.lit, 0.25), cave: S.key, caveFacet: mix(S.key, S.deep, 0.42), caveLine: mix(S.deep, S.key, 0.25), rim: S.lit, line: S.key,
      title: mix(S.glow, S.paper, 0.55), titleLine: S.key, titleShade: S.lit, text: mix(S.glow, S.paper, 0.6),
    });
  } else {
    Object.assign(I, {
      ground: S.paper, sky: [S.paper, mix(S.paper, S.glow, 0.42), S.glow, mix(S.glow, S.lit, 0.42)], land: [mix(S.lit, S.glow, 0.18), mix(S.lit, S.deep, 0.32)],
      sun: S.sun || S.lit, ring: S.sun || S.lit, ray: mix(S.lit, S.glow, 0.3), halo: mix(S.glow, S.lit, 0.35), star: S.paper,
      cloud: mix(S.paper, S.glow, 0.25), cloudShade: mix(S.glow, S.lit, 0.55), cloudLine: mix(S.lit, S.key, 0.5),
      far: mix(S.cool, S.paper, 0.5), farMid: mix(S.cool, S.paper, 0.22), farShade: S.cool, farSnow: mix(S.paper, S.cool, 0.12), farLine: mix(S.deep, S.key, 0.3),
      tower: mix(S.cool, S.paper, 0.32), towerMid: mix(S.cool, S.paper, 0.12), towerShade: S.deep, towerLine: S.key,
      mesa: [mix(S.lit, S.paper, 0.5), mix(S.lit, S.paper, 0.2), S.lit], mesaShade: [mix(S.cool, S.paper, 0.3), mix(S.cool, S.deep, 0.3), S.deep],
      path: mix(S.glow, S.paper, 0.45), cave: S.key, caveFacet: mix(S.key, S.deep, 0.5), caveLine: mix(S.deep, S.key, 0.2), rim: S.lit, line: S.key,
      title: S.deep, titleLine: S.paper, titleShade: S.lit, text: S.key,
    });
  }
  return I;
}
const moKey = (I) => `${I.set}|${I.dark ? 1 : 0}|${I.hot.map(Math.round)}`;

// ====================================================================== line work: hatching and stipple
/** A deterministic number in 0…1 for the integer cell (i, j) and salt s. */
export function moHash(i, j, s) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** Smooth value noise in 0…1 at (x, y), salt s. */
function moNoise(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = moHash(i, j, s), b = moHash(i + 1, j, s), c = moHash(i, j + 1, s), d = moHash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Pixels per unit of ctx (its scale). */
const scaleOf = (x) => { if (!canPaint(x)) return 1; const m = x.getTransform(); return Math.hypot(m.a, m.b) || 1; };
/** A tile of one horizontal line `lw` units thick in a band `gap` units tall, at R px a unit (kept). */
const MO_R = 4;
function moTile(gap, lw, colour) {
  const key = `moTile|${gap.toFixed(2)}|${lw.toFixed(2)}|${colour.map(Math.round).join()}`;
  let t = WORK[key];
  if (!t) {
    t = WORK[key] = document.createElement("canvas"); t.width = 8; t.height = Math.max(2, Math.round(gap * MO_R));
    const g = t.getContext("2d"), th = Math.max(0.5, lw * MO_R);
    g.fillStyle = css(colour); g.fillRect(0, (t.height - th) / 2, 8, th);
  }
  return t;
}
/**
 * Fills the current path of x with parallel lines at angle `ang` (radians), `gap` units apart and `lw` thick, in
 * `colour` at `alpha` — a pattern, not strokes, so a face of a thousand lines costs one fill. On a small canvas the
 * lines are set wider apart (and thicker in step), so they keep their tone instead of breaking into moiré.
 */
function moHatch(x, ang, gap, lw, colour, alpha = 1, off = 0) {
  if (alpha <= 0.01) return;
  if (!canPaint(x)) { x.fillStyle = css(colour, alpha * clamp(lw / gap)); x.fill(); return; }
  const k = scaleOf(x), f = Math.max(1, 2.3 / (gap * k)), G = Math.round(gap * f * 4) / 4, W = Math.round(lw * f * 10) / 10;
  const pat = x.createPattern(moTile(G, W, colour), "repeat");
  if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().rotateSelf((ang * 180) / Math.PI).translateSelf(0, off * G).scaleSelf(1 / MO_R));
  x.save(); x.globalAlpha *= Math.min(1, alpha); x.fillStyle = pat; x.fill(); x.restore();
}
/** A tile of scattered dots (stipple) `cover` of its area, 96 units square at R px a unit (kept). */
function moDotTile(cover, colour) {
  const q = Math.round(clamp(cover) * 20) / 20, key = `moDots|${q}|${colour.map(Math.round).join()}`;
  let t = WORK[key];
  if (!t) {
    const n = 96 * MO_R;
    t = WORK[key] = document.createElement("canvas"); t.width = t.height = n;
    const g = t.getContext("2d"), cell = 3.2 * MO_R, cols = Math.round(n / cell);
    g.fillStyle = css(colour); g.beginPath();
    for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
      const h = moHash(i, j, 77), r = cell * (0.2 + 0.35 * q);
      if (h > q * 1.25) continue;
      const cx = (i + 0.5 + (moHash(i, j, 78) - 0.5) * 0.5) * cell, cy = (j + 0.5 + (moHash(i, j, 79) - 0.5) * 0.5) * cell;
      g.moveTo(cx + r, cy); g.arc(cx, cy, r * (0.7 + 0.5 * moHash(i, j, 80)), 0, TAU);
    }
    g.fill();
  }
  return t;
}
/** Fills the current path with stipple covering `cover` of it, in `colour`. */
function moStipple(x, cover, colour, alpha = 1) {
  if (cover <= 0.02 || alpha <= 0.01) return;
  if (!canPaint(x)) { x.fillStyle = css(colour, alpha * cover * 0.5); x.fill(); return; }
  const k = scaleOf(x), f = Math.max(1, 1.6 / (3.2 * 0.5 * k)), pat = x.createPattern(moDotTile(cover, colour), "repeat");
  if (pat && pat.setTransform) pat.setTransform(new DOMMatrix().scaleSelf(f / MO_R));
  x.save(); x.globalAlpha *= Math.min(1, alpha); x.fillStyle = pat; x.fill(); x.restore();
}
/** Paints fills(x) and then lines(x) moved by the plates' misregistration `mr` [dx, dy]: the key plate off the colour plates. */
function moPrint(x, mr, fills, lines) {
  fills();
  x.save(); x.translate(mr[0], mr[1]); lines(); x.restore();
}
const poly = (x, pts) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); };
const stroke = (x, colour, lw, alpha = 1) => { x.strokeStyle = css(colour, alpha); x.lineWidth = Math.max(lw, 0.55 / scaleOf(x)); x.stroke(); };
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ====================================================================== what the look keeps
/** How many canvas sizes a part is kept for (the editor's, a draft's, the size thumbnails'); the sizes seen lately on the page, and the largest. */
const MO_KEEP = 6, MO_SEEN = new Set();
let moLargest = 0;
/** Whether what is painted on cv is worth keeping: a canvas on the page or one the size of one; an export's is painted once and let go. */
function moKeeps(cv) {
  const s = `${cv.width}x${cv.height}`;
  if (cv.isConnected) {
    if (!MO_SEEN.has(s)) { MO_SEEN.add(s); if (MO_SEEN.size > 12) MO_SEEN.delete(MO_SEEN.values().next().value); }
    moLargest = Math.max(moLargest, cv.width * cv.height);
    return true;
  }
  return MO_SEEN.has(s);
}
/**
 * A part of the print painted once and kept on a canvas covering only `box` (ctx's units), keyed on all it reads, for
 * a few canvas sizes at once, the least lately used let go first and never the largest; laid down moved by (dx, dy)
 * (a scene object dragged: the same pixels, not painted again). An export's part is painted on a canvas of its box once
 * and let go. With no canvas to keep (a stand-in context), painted straight. paint(x) draws in ctx's units.
 */
function moLay(ctx, slot, key, box, paint, dx = 0, dy = 0, free = false) {
  if (!canPaint(ctx)) { ctx.save(); ctx.translate(dx, dy); paint(ctx); ctx.restore(); return; }
  const cv = ctx.canvas, m = ctx.getTransform();
  const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
  let X0 = Math.floor(Math.min(...pts.map((q) => q[0]))), Y0 = Math.floor(Math.min(...pts.map((q) => q[1]))), X1 = Math.ceil(Math.max(...pts.map((q) => q[0]))), Y1 = Math.ceil(Math.max(...pts.map((q) => q[1])));
  if (!free) { X0 = Math.max(0, X0); Y0 = Math.max(0, Y0); X1 = Math.min(cv.width, X1); Y1 = Math.min(cv.height, Y1); }
  if (X1 - X0 < 1 || Y1 - Y0 < 1) return;
  const size = `${cv.width}x${cv.height}`, full = `${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join()}|${X0},${Y0},${X1},${Y1}|${key}`;
  let e, once = false;
  if (moKeeps(cv) && (X1 - X0) * (Y1 - Y0) < 2.4e7) {
    const kept = WORK[slot] || (WORK[slot] = new Map());
    e = kept.get(size);
    if (e) { kept.delete(size); kept.set(size, e); }
    else {
      e = { c: document.createElement("canvas"), key: null, area: cv.width * cv.height }; kept.set(size, e);
      while (kept.size > MO_KEEP) {
        const big = Math.max(...[...kept.values()].map((q) => q.area)), [s0, q] = [...kept].find(([, q]) => q !== e && q.area < big) || [...kept].find(([, q]) => q !== e);
        q.c.width = q.c.height = 0; kept.delete(s0);
      }
    }
  } else { e = { c: WORK.moOnce || (WORK.moOnce = document.createElement("canvas")), key: null }; once = true; }
  if (e.key !== full) {
    if (e.c.width !== X1 - X0 || e.c.height !== Y1 - Y0) { e.c.width = X1 - X0; e.c.height = Y1 - Y0; }
    const x = e.c.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, e.c.width, e.c.height);
    x.setTransform(m.a, m.b, m.c, m.d, m.e - X0, m.f - Y0); x.lineJoin = "round"; x.lineCap = "round";
    paint(x); e.key = once ? null : full;
  }
  inPixels(ctx, () => ctx.drawImage(e.c, Math.round(X0 + m.a * dx + m.c * dy), Math.round(Y0 + m.b * dx + m.d * dy)));
  if (once) e.c.width = e.c.height = 0;
}
/** Lets everything the look keeps go: its parts, its tiles, its work canvases (as another look is chosen). */
export function moFreeAll() {
  for (const k of Object.keys(WORK)) {
    if (!/^mo[A-Z|]/.test(k)) continue;
    const v = WORK[k];
    if (v instanceof Map) for (const e of v.values()) { if (e.c) e.c.width = e.c.height = 0; }
    else if (v && "width" in v) v.width = v.height = 0;
    delete WORK[k];
  }
  MO_SEEN.clear(); moLargest = 0;
}
/** What the look keeps, in bytes (for checks of memory). */
export function moMemory() {
  let n = 0;
  for (const k of Object.keys(WORK)) {
    if (!/^mo[A-Z|]/.test(k)) continue;
    const v = WORK[k];
    if (v instanceof Map) for (const e of v.values()) n += e.c ? e.c.width * e.c.height * 4 : 0;
    else if (v && "width" in v) n += v.width * v.height * 4;
  }
  return n;
}

// ====================================================================== the plan: where everything stands
/** The boxes the scene keeps off: the title, the tag, the graphic (keepClear), the channel name on the field, and (for the cave) the brand row. */
function moKeepBoxes(ctx, env) {
  const out = canPaint(ctx) ? keepClear(ctx, env) : [], G = env.G, c = G && G.cat;
  if (c && !c.onAccent && env.cover && env.cover.layers && env.cover.layers.some((l) => l.id === "catname" && l.visible)) out.push({ x: c.x - 24, y: c.y - c.fs * 1.05, w: Math.min(c.maxW || 600, 900) + 48, h: c.fs * 1.4 + 24 });
  return out;
}
/**
 * Where the scene stands: the open field and its horizon (under the title's foot, leaving the land room); the side the
 * title is on (-1 left, 1 right, 0 across); the sun's place — of places along the sky the one where it stands highest
 * clear of the boxes and of a slanted block, the free side preferred, smaller where only a smaller one fits, setting
 * behind the horizon where there is no room above — found at its largest, so its slider sizes it where it stands and
 * moves nothing else (`sun0` and `sr` the disc at the slider's size, `sR` its largest there, `sunRoom` the box it may
 * fill at any size); the spire under it and the path to it, spire(a) its height at slider value a; `fig` the lone
 * figure's place; room(x0, x1, base): how high something standing at `base` across x0–x1 may rise and stay clear of
 * the boxes (null where a box stands on that ground). The boxes are a preference: the scene is the background and they
 * lie over it, so a part with no room clear of them stands behind them, never left out. `given` ({ T, keep }): the
 * title's box and the boxes to keep clear of, in place of the cover's (for checks).
 */
export function moPlan(ctx, env, p, given = null) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), T = given ? given.T : canPaint(ctx) ? titleArea(ctx, env) : null;
  const keep = given ? given.keep : moKeepBoxes(ctx, env), pad = u * 0.03;
  const across = !!T && T.w > fw * 0.84, tc = T ? T.x + T.w / 2 : F.x0 + fw * 0.3;
  const side = !T ? -1 : across ? 0 : tc < F.x0 + fw / 2 ? -1 : 1;
  // the horizon: a little below the middle, and under the title's foot where that leaves the land room
  // the part of the field no slant of the colour block reaches: where the sun and the monuments may stand
  const E = env.G && env.G.edge, In = { ...F };
  if (E && F.side === "right") In.x1 = Math.min(E.line[0], E.line[2]); else if (E && F.side === "left") In.x0 = Math.max(E.line[0], E.line[2]);
  else if (E && F.side === "below") In.y1 = Math.min(E.line[1], E.line[3]); else if (E && F.side === "above") In.y0 = Math.max(E.line[1], E.line[3]);
  const tall = fw < fh * 0.9, H = clamp(Math.max(F.y0 + fh * (tall ? 0.64 : 0.6), T ? T.y + T.h + fh * (tall ? 0.13 : 0.09) : 0), F.y0 + fh * 0.45, In.y1 - fh * (tall ? 0.19 : 0.2));
  const room = (x0, x1, base, gap = pad) => {
    let top = F.y0 + fh * 0.03;
    for (const b of keep) {
      if (b.x >= x1 || b.x + b.w <= x0) continue;
      if (b.y + b.h > base - 2) { if (b.y < base) return null; continue; }   // the box stands on this ground (or below it: nothing of it here)
      top = Math.max(top, b.y + b.h + gap);
    }
    return top < base ? top : null;
  };
  // the sun: of a few places along the sky, the one where it stands highest clear of the boxes, the free side preferred — judged at its largest (its slider at 1)
  const sr0 = u * 0.12, ideal = F.y0 + (H - F.y0) * 0.4;
  /** The disc's middle at radius r under a ceiling `top`: high in the sky where it may, hung under a box, or set half hidden where there is no room above (never over a box). */
  const sunAt = (top, r) => Math.min(H + r * 0.45, Math.max(Math.min(H - r * 0.3, Math.max(ideal, top + r * 1.25)), top + r * 1.05));
  let best = null;
  // the slanted block's edge at height y (a side block's), so what stands near it is not under it there
  const slant = E && (F.side === "right" || F.side === "left") && Math.abs(E.line[3] - E.line[1]) > 1, edgeX = (y) => (slant ? E.line[0] + ((E.line[2] - E.line[0]) * (y - E.line[1])) / (E.line[3] - E.line[1]) : F.side === "left" ? F.x0 : F.x1);
  const inside = (x, y, r) => (F.side === "left" ? x - r > edgeX(y) : F.side === "right" ? x + r < edgeX(y) : true);
  for (let i = 0; i <= 16; i++) for (const rr of [sr0, sr0 * 0.72]) {   // a smaller sun where only a smaller one has room
    const sx = F.x0 + fw * (0.08 + 0.86 * (i / 16)), top = room(sx - rr * 1.5, sx + rr * 1.5, H);
    if (top === null) continue;
    const sy = sunAt(top, rr), away = side === 0 ? 1 - Math.abs(sx - (F.x0 + fw / 2)) / fw : clamp(0.5 - (side * (sx - (F.x0 + fw / 2))) / fw);   // no room above: it sets, half hidden, never over a box
    if (!inside(sx, Math.min(sy, H), rr * 1.15)) continue;   // the disc clear of the block
    const near = Math.min(sx - F.x0, F.x1 - sx, Math.abs(edgeX(sy) - sx));
    const score = (H - sy) / (H - F.y0) + away * 0.55 - 0.5 * clamp(1 - near / (fw * 0.16)) - (rr < sr0 ? 0.12 : 0);   // not hard by the field's edge; the full size if it can
    if (!best || score > best[2]) best = [sx, top, score, rr];
  }
  // drawn at its slider's size where it stands (a smaller sun where only a smaller one fits, in step); a smaller disc under the same ceiling stays clear of what the largest kept clear of
  const [sx, sTop, , sR] = best || [F.x0 + fw * 0.5, null, 0, sr0], at = (r) => (sTop === null ? H - r * 0.3 : sunAt(sTop, r));
  const sr = sR * ((0.045 + 0.075 * p.sun) / 0.12), sy = at(sr), rs = [0.375, 0.7, 1].map((k) => sR * k), ys = rs.flatMap((r) => [at(r) - r, at(r) + r]);
  const sunRoom = { x: sx - sR, y: Math.min(...ys), w: sR * 2, h: Math.max(...ys) - Math.min(...ys) };   // where the disc may stand at any size: what comes after keeps clear of all of it, the sun on or not
  const tm = u * 0.06, tx = F.side === "right" ? Math.min(sx, edgeX(H) - tm) : F.side === "left" ? Math.max(sx, edgeX(H) + tm) : sx, inkSide = side === 0 ? 1 : -side;   // the spire under the sun (clear of the block at its foot); the free side, away from the title
  // the spire: as tall as its slider says, up to the room under the boxes where that holds a spire that reads; where it does not, at its own height behind them (they lie over it)
  const st = room(tx - u * 0.06, tx + u * 0.06, H), spire = (a) => { const th = fh * (0.18 + 0.44 * a); return st !== null && H - st > fh * 0.06 ? Math.min(th, H - st) : th; };
  const P = { F, In, fw, fh, u, T, keep, side, H, room, sun0: [sx, sy], sr, sR, sunRoom, tx, spire, inkSide, pad, mr: moShift(p) };
  // the lone figure: on the path half way to the spire, stepping toward it where a box stands there — judged at its largest, so its slider only sizes it; where no step is clear, the one reaching least behind the boxes
  const s1 = fh * 0.09, figAt = (t) => { const [x] = moPathAt(P, t); return [x, H + (F.y1 - H) * t]; };
  let fig = null;
  for (const t of [0.5, 0.4, 0.3, 0.2, 0.1]) {
    const [x, y] = figAt(t), v = keep.reduce((s, b) => s + moArea(b, { x: x - s1, y: y - s1, w: s1 * 2, h: s1 }), 0);
    if (!fig || v < fig.v) fig = { x, y, v };
    if (!v) break;
  }
  P.fig = fig;
  return P;
}
/** How much of boxes a and b overlap (an area: 0 when they do not). */
const moArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
/** The key plate's misregistration: [dx, dy] units, its direction set by the seed. */
const moShift = (p) => { const a = 0.55 + rand(5401) * 0.6, d = 4.6 * (p.misreg || 0); return [Math.cos(a) * d, Math.sin(a) * d]; };
/** The path's middle at depth t (0 the horizon, 1 the field's foot), and its half width there. */
const moPathAt = (P, t) => { const foot = P.tx + (P.F.x0 + P.fw * 0.5 - P.tx) * 0.55 - P.side * P.fw * 0.04; return [P.tx + (foot - P.tx) * t, P.fw * (0.006 + 0.2 * t * t + 0.06 * t)]; };

// ====================================================================== the ground: sky and land in stippled steps
/**
 * The sky from the top of the field to the horizon in the four steps of its inks, and the land below in two — each step
 * a flat ink, the next stippled into it across a band (dots growing and crowding until they merge), the bands
 * marbled a little by a slow noise; stars on the night stock. Worked out pixel by pixel, cell by cell (a dot's ink
 * and size from its cell's place), on the part's own canvas; at `stip` 0 the steps meet edge to edge.
 */
function moGround(x, P, I, stip) {
  const { F, H } = P;
  if (!canPaint(x)) {
    const g = x.createLinearGradient(0, F.y0, 0, H); I.sky.forEach((c, i) => g.addColorStop(i / 3, css(c)));
    x.fillStyle = g; x.fillRect(-50, -50, 5000, H + 50);
    x.fillStyle = css(I.land[0]); x.fillRect(-50, H, 5000, 5000); return;
  }
  const cv = x.canvas, W = cv.width, Hc = cv.height, m = x.getTransform(), k = Math.abs(m.a) || 1, img = x.createImageData(W, Hc), d = img.data;
  const cell = Math.max(3.4, 2.1 / k), s0 = seed % 9973, sky = I.sky, land = I.land, rows = Math.ceil(Hc / (cell * k)) + 2, cols = Math.ceil(W / (cell * k)) + 2;
  const rowInk = new Int8Array(cols), rowOn = new Uint8Array(cols), rowCx = new Float32Array(cols), rowCy = new Float32Array(cols), rowR = new Float32Array(cols), rowStar = new Uint8Array(cols);
  const ux0 = -m.e / k, uy0 = -m.f / k, span = Math.max(1, H - F.y0), lspan = Math.max(1, F.y1 - H), star = I.dark ? 1 : 0;
  const pal = [...sky, ...land].map((c) => c.map(Math.round)), starC = I.star.map(Math.round);
  let lastRow = -1e9;
  for (let Y = 0; Y < Hc; Y++) {
    const uy = uy0 + (Y + 0.5) / k, cj = Math.floor(uy / cell);
    if (cj !== lastRow) {   // the cells of this row: each its ink, whether it holds a dot of the next one, where and how large
      lastRow = cj;
      const cy = (cj + 0.5) * cell, isSky = cy < H;
      for (let q = 0; q < cols; q++) {
        const ci = Math.floor(ux0 / cell) + q, cx = (ci + 0.5) * cell, n = moNoise(cx / 300, cy / 170, s0) + moNoise(cx / 90, cy / 60, s0 + 9) * 0.4 - 0.7;
        let v, base;
        if (isSky) { v = clamp((cy - F.y0) / span + n * 0.16) * 3; base = 0; } else { v = clamp((cy - H) / lspan * 1.15 - 0.08 + n * 0.12); base = 4; }
        const b = Math.min(isSky ? 2 : 0, Math.floor(v)), f = v - b, s = stip > 0 ? Math.max(0.09 * stip, smooth(0.5 - 0.42 * stip, 0.5 + 0.42 * stip, f)) : f < 0.5 ? 0 : 1;   // a speckle of the next ink all through, crowding into it across the band
        const h = moHash(ci, cj, s0 + 31);
        rowInk[q] = base + b; rowOn[q] = s >= 0.97 ? 2 : h < s * 1.35 ? 1 : 0;
        rowCx[q] = (ci + 0.5 + (moHash(ci, cj, s0 + 32) - 0.5) * 0.5) * cell; rowCy[q] = (cj + 0.5 + (moHash(ci, cj, s0 + 33) - 0.5) * 0.5) * cell;
        const r = cell * (0.2 + 0.42 * s); rowR[q] = r * r;
        rowStar[q] = star && isSky && moHash(ci, cj, s0 + 34) < 0.012 * (1 - clamp((cy - F.y0) / span * 1.3)) ? 1 + (moHash(ci, cj, s0 + 35) < 0.12 ? 1 : 0) : 0;
      }
    }
    const q0 = Math.floor(ux0 / cell);
    for (let X = 0, o = Y * W * 4; X < W; X++, o += 4) {
      const ux = ux0 + (X + 0.5) / k, q = Math.floor(ux / cell) - q0;
      let ink = rowInk[q];
      const on = rowOn[q];
      if (on === 2) ink++;
      else if (on === 1) { const dx = ux - rowCx[q], dy = uy - rowCy[q]; if (dx * dx + dy * dy < rowR[q]) ink++; }
      let c = pal[ink];
      if (rowStar[q]) { const dx = ux - rowCx[q], dy = uy - rowCy[q]; if (dx * dx + dy * dy < cell * cell * (rowStar[q] > 1 ? 0.16 : 0.05)) c = starC; }
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
}

// ====================================================================== the sun, its halo and its rays
/** The halo round the sun: glow ink stippled thinner and thinner away from the disc, on a canvas of its own (kept per radius, inks and scale). */
function moHalo(ctx, P, sx, sy, r, I, amt) {
  if (amt <= 0) return;
  const R = r * 3.2;
  if (!canPaint(ctx)) return;
  ctx.save(); moSkyClip(ctx, P);
  moLay(ctx, "moHalo", `${r.toFixed(1)}|${moKey(I)}|${amt.toFixed(2)}`, { x: -R, y: -R, w: 2 * R, h: 2 * R }, (x) => {
    for (const [rr, cover] of [[R, 0.12], [R * 0.72, 0.22], [R * 0.52, 0.36]]) { x.beginPath(); x.arc(0, 0, rr, 0, TAU); moStipple(x, cover * amt, I.halo); }
  }, sx, sy, true);
  ctx.restore();
}
/** Clips ctx to the sky above the horizon, less the box the title stands in. */
function moSkyClip(ctx, P) {
  const { F, H, T, u } = P;
  ctx.beginPath(); ctx.rect(F.x0, F.y0, P.fw, H - F.y0);
  if (T) { const m = u * 0.04; ctx.rect(T.x - m, T.y - m, T.w + 2 * m, T.h + 2 * m); }
  ctx.clip("evenodd");
}
/**
 * Thin rules radiating from the sun across the sky, long and short by turns, fading as they go; kept out of the box the
 * title stands in and off the land.
 */
function moRays(ctx, P, sx, sy, I, amt) {
  if (amt <= 0) return;
  const R = Math.hypot(P.fw, P.fh) * (0.5 + 0.5 * amt), n = Math.round(36 + 60 * amt);
  ctx.save(); moSkyClip(ctx, P);
  const g = ctx.createRadialGradient(sx, sy, P.sr * 1.2, sx, sy, R);
  g.addColorStop(0, css(I.ray, 0.75)); g.addColorStop(0.45, css(I.ray, 0.32)); g.addColorStop(1, css(I.ray, 0));
  ctx.strokeStyle = g; ctx.lineCap = "butt";
  for (const pass of [0, 1]) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (i % 2 !== pass) continue;
      const a = (i / n) * TAU + rand(5300) * 0.3, len = R * (pass ? 0.55 + rand(5301 + i) * 0.25 : 1), r0 = P.sr * (1.35 + (pass ? 0.4 : 0));
      ctx.moveTo(sx + Math.cos(a) * r0, sy + Math.sin(a) * r0); ctx.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    }
    ctx.lineWidth = Math.max(pass ? 0.9 : 1.4, 0.6 / scaleOf(ctx)); ctx.stroke();
  }
  ctx.restore();
}
/** The sun: a flat disc of its ink, two thin rings round it, a band of hatching across its foot, the key line off register. */
function moSun(ctx, sx, sy, r, I, p, mr) {
  moPrint(ctx, mr, () => {
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fillStyle = css(I.sun); ctx.fill();
    if (p.hatch > 0) { ctx.save(); ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.clip(); ctx.beginPath(); ctx.rect(sx - r, sy + r * 0.35, 2 * r, r); moHatch(ctx, 0, 3.4, 1.1, I.ring, 0.8 * p.hatch); ctx.restore(); }
  }, () => {
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); stroke(ctx, I.line, 1.6, 0.85);
    for (const [k, lw] of [[1.28, 1.2], [1.5, 0.8]]) { ctx.beginPath(); ctx.arc(sx, sy, r * k, 0, TAU); stroke(ctx, I.ring, lw, 0.9); }
  });
}

// ====================================================================== clouds
/**
 * A bank of cloud as the prints draw it: lobes stacked in two rows on a flat foot, filled back to front, each lobe's top
 * edge drawn as it is laid so the lobes overlap in line; the foot shaded with level hatching; a rule along its base.
 */
function moCloud(x, cx, by, bw, I, p, k, mr) {
  const n = 4 + Math.floor(rand(k) * 4), lobes = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < n - row * 2; i++) {
    const t = (i + 0.5) / (n - row * 2), r = bw * (0.1 + 0.11 * Math.sin(Math.PI * t) + rand(k + i * 2.1 + row) * 0.05) * (row ? 0.85 : 1);
    lobes.push([cx + (t - 0.5) * bw * (row ? 0.62 : 0.92), by - r * (row ? 1.15 : 0.45) - (row ? bw * 0.06 : 0), r]);
  }
  const clip = () => { x.beginPath(); x.rect(cx - bw, by - bw, bw * 2, bw); };
  x.save(); clip(); x.clip();
  moPrint(x, mr, () => {
    for (const [lx, ly, r] of lobes) { x.beginPath(); x.arc(lx, ly, r, 0, TAU); x.fillStyle = css(I.cloud); x.fill(); }
    x.beginPath(); for (const [lx, ly, r] of lobes) { x.moveTo(lx + r, ly); x.arc(lx, ly, r, 0, TAU); }
    x.save(); x.clip(); x.beginPath(); x.rect(cx - bw, by - bw * 0.09, bw * 2, bw); moHatch(x, 0, 3.2, 1.05, I.cloudShade, 0.9 * p.hatch); x.beginPath(); x.rect(cx - bw, by - bw * 0.16, bw * 2, bw * 0.07); moHatch(x, 0, 5.2, 0.8, I.cloudShade, 0.7 * p.hatch); x.restore();
  }, () => {
    for (const [lx, ly, r] of lobes) { x.beginPath(); x.arc(lx, ly, r, Math.PI * 1.06, Math.PI * 1.94); stroke(x, I.cloudLine, 1.25, 0.85); }
  });
  x.restore();
  x.save(); x.translate(mr[0], mr[1]); x.beginPath(); x.moveTo(cx - bw * 0.47, by); x.lineTo(cx + bw * 0.47, by); stroke(x, I.cloudLine, 1.2, 0.7); x.restore();
}
/** How much of box a lies behind the boxes kept clear of (an area). */
const moBehind = (P, a) => P.keep.reduce((s, b) => s + moArea(a, b), 0);
/**
 * Where the six banks of cloud stand, across the sky and low toward the horizon, each found at its largest (so the
 * slider sizes them where they stand, and brings them in one after another): of its seeded places on the field, the
 * first clear of the boxes, of the sun (where it may stand at any size) and of the banks before it (at theirs); else
 * the one reaching least behind the boxes, then least across the sun and the others — never left out. [cx, by, bw, k]:
 * its middle, its foot, its width at the slider's largest, its seed.
 */
export function moBanks(P) {
  const { F, In, fw, H, u, sunRoom: S } = P, out = [];
  for (let i = 0; i < 6; i++) {
    let best = null;
    for (let tries = 0; tries < 10; tries++) {
      const k = 5500 + i * 13.7 + tries * 3.1, bw = u * (0.2 + rand(k) * 0.22), cx = clamp(F.x0 + fw * (0.05 + rand(k + 1) * 0.9), In.x0 + bw * 0.5, In.x1 - bw * 0.5), by = F.y0 + (H - F.y0) * (0.28 + rand(k + 2) ** 0.7 * 0.66);   // on the field, off the block
      const v = moBehind(P, { x: cx - bw * 0.5, y: by - bw * 0.3, w: bw, h: bw * 0.32 });
      const crowd = (Math.abs(cx - (S.x + S.w / 2)) < bw * 0.5 + S.w / 2 && by > S.y + S.w * 0.2 && by < S.y + S.h - S.w * 0.2 ? 1 : 0)   // not straight across the disc
        + out.filter((q) => Math.abs(q[0] - cx) < (q[2] + bw) * 0.45 && Math.abs(q[1] - by) < (q[2] + bw) * 0.12).length;
      if (!best || v < best.v || (v === best.v && crowd < best.crowd)) best = { at: [cx, by, bw, k], v, crowd };
      if (!v && !crowd) break;
    }
    out.push(best.at);
  }
  return out;
}
/** The banks of cloud: as many of the six as the slider says, each where moBanks put it, as wide as the slider says there. */
function moClouds(x, P, I, p) {
  const placed = moBanks(P).slice(0, Math.round(p.clouds * 6)).sort((a, b) => a[1] - b[1]);   // the higher further off: drawn first
  for (const [cx, by, bw, k] of placed) moCloud(x, cx, by, bw * (0.7 + 0.3 * p.clouds), I, p, k, P.mr);
  moStratus(x, P, I, p);
}
/**
 * Where the eight bars of stratus lie, low over the horizon under the title: each at its seeded place, else at the
 * first of a few others clear of the boxes, else the one reaching least behind them — never left out; the slider
 * brings them in one after another. [cx, cy, len, th]: its middle, its length and thickness.
 */
export function moBars(P) {
  const { F, fw, H, u, T } = P, out = [];
  let y0 = Math.max(F.y0 + (H - F.y0) * 0.3, T ? T.y + T.h + u * 0.015 : 0);
  const y1 = H - u * 0.02;
  if (y1 - y0 < u * 0.03) y0 = F.y0 + (H - F.y0) * 0.5;
  for (let i = 0; i < 8; i++) {
    const k = 5600 + i * 9.3, len = fw * (0.14 + 0.3 * rand(k)), th = u * (0.005 + 0.011 * rand(k + 1));
    let best = null;
    for (let j = 0; j < 6; j++) {   // its own place first, then others
      const q = j ? 5700 + i * 23.1 + j * 4.3 : k + 2, cx = F.x0 + fw * (0.05 + 0.9 * rand(q)), cy = y0 + (y1 - y0) * rand(q + 1) ** 0.8;
      const v = moBehind(P, { x: cx - len / 2, y: cy - th * 1.6, w: len, h: th * 2.4 });
      if (!best || v < best.v) best = { at: [cx, cy, len, th], v };
      if (!v) break;
    }
    out.push(best.at);
  }
  return out;
}
/**
 * Long thin bars of cloud lying low over the horizon, under the title, one or two across the sun: each a lens of the
 * cloud ink, its underside ruled with level hatching, a line along its top.
 */
function moStratus(x, P, I, p) {
  for (const [cx, cy, len, th] of moBars(P).slice(0, Math.round(1 + p.clouds * 7))) {
    const lens = () => { x.beginPath(); x.moveTo(cx - len / 2, cy); x.quadraticCurveTo(cx - len * 0.22, cy - th * 1.7, cx + len * 0.05, cy - th); x.quadraticCurveTo(cx + len * 0.32, cy - th * 0.7, cx + len / 2, cy + th * 0.15); x.quadraticCurveTo(cx, cy + th * 0.75, cx - len / 2, cy); x.closePath(); };
    moPrint(x, P.mr, () => {
      lens(); x.fillStyle = css(I.cloud); x.fill();
      x.save(); lens(); x.clip(); x.beginPath(); x.rect(cx - len / 2, cy - th * 0.25, len, th * 2); moHatch(x, 0, 2.4, 0.85, I.cloudShade, 0.9 * clamp(p.hatch * 1.3)); x.restore();
    }, () => {
      x.beginPath(); x.moveTo(cx - len / 2, cy); x.quadraticCurveTo(cx - len * 0.22, cy - th * 1.7, cx + len * 0.05, cy - th); x.quadraticCurveTo(cx + len * 0.32, cy - th * 0.7, cx + len / 2, cy + th * 0.15); stroke(x, I.cloudLine, 1, 0.75);
    });
  }
}

// ====================================================================== the far peaks
/**
 * One crystal peak standing on the horizon: a crest, a keel down from it splitting the face to the light from the face
 * in shade, a facet of snow on each side near the top, lines along the facets; the shaded face hatched along its fall.
 */
function moPeak(x, q, P, I, p) {
  const H = q.base, A = [q.cx, H - q.h], L = [q.cx - q.wl, H + 2], R = [q.cx + q.wr, H + 2], lit = P.sun0[0] >= q.cx ? 1 : -1;
  const Lm = [q.cx - q.wl * (0.42 + rand(q.k + 5) * 0.12), H - q.h * (0.42 + rand(q.k + 6) * 0.14)], Rm = [q.cx + q.wr * (0.42 + rand(q.k + 7) * 0.12), H - q.h * (0.4 + rand(q.k + 8) * 0.14)];
  const K = [q.cx + lit * q.wl * (0.12 + rand(q.k + 9) * 0.12), H + 2], J = lerp2(A, K, 0.42 + rand(q.k + 10) * 0.12);
  const faceL = [A, Lm, L, K], faceR = [A, K, R, Rm], shade = lit > 0 ? faceL : faceR, light = lit > 0 ? faceR : faceL, far = lit > 0 ? Lm : Rm, near = lit > 0 ? Rm : Lm;
  moPrint(x, P.mr, () => {
    poly(x, light); x.fillStyle = css(I.far); x.fill();
    poly(x, shade); x.fillStyle = css(I.farShade); x.fill();
    poly(x, [A, lerp2(A, near, 0.55), J]); x.fillStyle = css(I.farSnow); x.fill();
    poly(x, [A, lerp2(A, far, 0.5), J]); x.fillStyle = css(I.farMid); x.fill();
    const slope = Math.atan2(far[1] - A[1], far[0] - A[0]);
    poly(x, shade); moHatch(x, slope, 3.6, 1.05, I.farLine, 0.75 * p.hatch, q.k);
    poly(x, [far, lit > 0 ? L : R, K, J]); moHatch(x, slope + 0.5 * lit, 4.4, 0.8, I.farLine, 0.55 * p.hatch, q.k + 1);
  }, () => {
    poly(x, [L, Lm, A, Rm, R]); stroke(x, I.farLine, 1.5);
    x.beginPath(); x.moveTo(A[0], A[1]); x.lineTo(K[0], K[1]); x.moveTo(J[0], J[1]); x.lineTo(near[0], near[1]); x.moveTo(J[0], J[1]); x.lineTo(far[0], far[1]); x.moveTo(lerp2(A, near, 0.55)[0], lerp2(A, near, 0.55)[1]); x.lineTo(J[0], J[1]); stroke(x, I.farLine, 0.9, 0.9);
  });
}
/**
 * The crystal peaks along the horizon in two ranges (the far one, then the near), every peak of each: tallest toward
 * the sun, as tall as the slider says, kept under the boxes where the room of its largest holds a peak that reads,
 * else at its own height behind them (they lie over it) — none left out; the tallest of each at the back.
 */
export function moPeaks(P, p) {
  const { F, fw, u, H, sun0 } = P, rows = [];
  for (const [row, hk, nk] of [[0, 0.3, 0.13], [1, 0.17, 0.2]]) {
    const n = Math.max(3, Math.round(fw / (u * nk))), peaks = [], base = H + (row ? 3 : 1);
    for (let i = 0; i < n + 2; i++) {
      const k = 5100 + row * 211 + i * 7.7, cx = F.x0 + fw * ((i - 0.6 + rand(k) * 0.9) / n), near = 1 - clamp(Math.abs(cx - sun0[0]) / (fw * 0.6));
      const h1 = u * hk * (0.2 + 0.8 * rand(k + 1) ** 1.4 * (0.45 + 0.55 * near)), f = 0.75 + rand(k + 2) * 0.9, hgt = h1 * (0.4 + 0.6 * p.range), wid = hgt * f + u * 0.02, w1 = h1 * f + u * 0.02;
      const top = P.room(cx - w1 * 0.25, cx + w1 * 0.25, base, u * 0.01);   // the room of its largest, so the slider only sizes it
      const hh = top !== null && base - top >= u * 0.015 ? Math.min(hgt, base - top) : hgt;
      peaks.push({ cx, h: hh, base, wl: wid * (0.75 + rand(k + 3) * 0.5), wr: wid * (0.75 + rand(k + 4) * 0.5), k });
    }
    rows.push(peaks.sort((a, b) => b.h - a.h));
  }
  return rows;
}
/** The crystal peaks along the horizon in two ranges: the far one taller and paler, nearly the sky's own ink, the near one lower in the peaks' inks (see moPeaks). */
function moRange(x, P, I, p) {
  const haze = I.sky[3], far = { ...I, far: mix(I.far, haze, 0.5), farMid: mix(I.farMid, haze, 0.5), farShade: mix(I.farShade, haze, 0.45), farSnow: mix(I.farSnow, haze, 0.4), farLine: mix(I.farLine, haze, 0.35) };
  moPeaks(P, p).forEach((peaks, row) => { for (const q of peaks) moPeak(x, q, P, row ? I : far, p); });
}

// ====================================================================== the spire, the colossus
/**
 * The spire on the far horizon: a crystal needle on a broad foot, two lesser spires at its sides, a floating ring
 * round its waist; each lit on the side toward the light and hatched on the other, slits of window down its face.
 * (tx, base): the middle of its foot; th: its height.
 */
function moTower(x, tx, base, th, I, p, lit, mr) {
  const tw = th * 0.16, spire = (cx, hh, ww) => {
    const tip = [cx, base - hh], sh = [cx - ww * 0.36, base - hh * 0.5], sh2 = [cx + ww * 0.36, base - hh * 0.5], nk = [cx - ww * 0.1, base - hh * 0.86], nk2 = [cx + ww * 0.1, base - hh * 0.86];
    return { out: [[cx - ww / 2, base + 2], sh, nk, tip, nk2, sh2, [cx + ww / 2, base + 2]], keel: [[cx + lit * ww * 0.08, base + 2], [cx + lit * ww * 0.04, base - hh * 0.5], tip], tip, sh, sh2 };
  };
  const parts = [spire(tx - tw * 1.25, th * 0.24, tw * 0.5), spire(tx + tw * 1.3, th * 0.3, tw * 0.55), spire(tx - tw * 0.62, th * 0.46, tw * 0.66), spire(tx + tw * 0.66, th * 0.56, tw * 0.62), spire(tx, th, tw)];
  for (const s of parts) {
    const left = [s.out[0], s.out[1], s.out[2], s.tip, s.keel[1], s.keel[0]], right = [s.keel[0], s.keel[1], s.tip, s.out[4], s.out[5], s.out[6]];
    const half = lit > 0 ? right : left, shadeHalf = lit > 0 ? left : right;
    moPrint(x, mr, () => {
      poly(x, s.out); x.fillStyle = css(I.towerMid); x.fill();
      poly(x, half); x.fillStyle = css(I.tower); x.fill();
      poly(x, shadeHalf); x.fillStyle = css(I.towerShade); x.fill();
      poly(x, shadeHalf); moHatch(x, Math.PI / 2 + lit * 0.08, 3, 1, I.towerLine, 0.7 * p.hatch);
    }, () => {
      poly(x, s.out); stroke(x, I.towerLine, 1.4);
      x.beginPath(); x.moveTo(...s.keel[0]); x.lineTo(...s.keel[1]); x.lineTo(...s.tip); stroke(x, I.towerLine, 0.9);
      const wx = s.keel[1][0] + lit * (s.sh2[0] - s.sh[0]) * 0.22;   // slits of window down the lit face
      x.beginPath(); for (let i = 0; i < 5; i++) { const y = base - (s.tip[1] < base ? (base - s.tip[1]) : 1) * (0.16 + i * 0.11); x.moveTo(wx, y); x.lineTo(wx, y + th * 0.025); } stroke(x, I.towerLine, 1.1, 0.8);
    });
  }
  // the ring floating round its waist: its back behind the spire is hidden by drawing it in two halves
  const ry = base - th * 0.6, rx = tw * 1.35, rh = tw * 0.24;
  moPrint(x, mr, () => {
    x.beginPath(); x.ellipse(tx, ry, rx, rh, 0, 0, Math.PI); x.ellipse(tx, ry + rh * 0.55, rx, rh, 0, Math.PI, 0, true); x.closePath(); x.fillStyle = css(I.towerShade); x.fill();
    x.beginPath(); x.ellipse(tx, ry, rx, rh, 0, 0, Math.PI); x.ellipse(tx, ry + rh * 0.55, rx, rh, 0, Math.PI, 0, true); x.closePath(); moHatch(x, 0, 2.8, 0.9, I.towerLine, 0.6 * p.hatch);
  }, () => {
    x.beginPath(); x.ellipse(tx, ry, rx, rh, 0, 0, Math.PI); stroke(x, I.towerLine, 1.3);
    x.beginPath(); x.ellipse(tx, ry + rh * 0.55, rx, rh, 0, 0, Math.PI); stroke(x, I.towerLine, 1.3);
    x.beginPath(); x.moveTo(tx - rx, ry); x.lineTo(tx - rx, ry + rh * 0.55); x.moveTo(tx + rx, ry); x.lineTo(tx + rx, ry + rh * 0.55); stroke(x, I.towerLine, 1.2);
  });
}
/**
 * Where the colossus stands on the horizon (a graphic `aspect` wide for its height, at slider value amt): of a few
 * places either side of the spire (never the spire's own: the spire stands in front of it), judged at its largest so
 * its slider only sizes it — the one with the most room under the boxes for it to read at any size, clear of the
 * spire's foot where it can be; drawn as tall as its slider says up to that room. Where no place has that room, the
 * one reaching least behind the boxes, at its own size (they lie over it). { cx, size, big }: its middle, its height,
 * and its height at its largest there (the room it keeps, on or not).
 */
export function moColossusAt(P, aspect, amt) {
  const { F, fw, fh, H } = P, In = P.In || F, want = fh * (0.12 + 0.3 * amt), least = fh * 0.12, half = Math.min((fh * 0.42 * aspect) / 2, (In.x1 - In.x0) * 0.45);
  /** The tallest it may stand at cx (on the field, off the block), narrower as it is lower, clear of the boxes (0: not as tall as its slider's least). */
  const most = (cx) => Math.min(fh * 0.42, (2 * Math.min(cx - In.x0, In.x1 - cx)) / aspect);
  const fit = (cx) => { for (let s = most(cx); s >= least; s *= 0.88) { const r = P.room(cx - (s * aspect) / 2, cx + (s * aspect) / 2, H); if (r !== null && H - r >= s) return s; } return 0; };
  let best = null;
  for (const d of [-0.17, 0.17, -0.3, 0.3, -0.45, 0.45]) {
    const m = Math.max(fw * 0.08, half), cx = clamp(P.tx + d * fw, In.x0 + m, In.x1 - m), size = fit(cx), top = most(cx), s = size || top;   // its largest kept on the field
    const v = size ? -1 : moBehind(P, { x: cx - (top * aspect) / 2, y: H - top, w: top * aspect, h: top }), on = Math.abs(cx - P.tx) < (s * aspect) / 2 + fw * 0.03 ? 1 : 0;   // how much it reaches behind the boxes; whether it stands over the spire's foot
    if (!best || v < best.v || (v === best.v && (on < best.on || (on === best.on && size > best.size + 1)))) best = { cx, size, v, on, top };
  }
  return { cx: best.cx, size: Math.min(want, best.size || best.top), big: best.size || best.top };
}
/** The channel graphic as a colossus on the horizon: its silhouette in the far ink, the side from the light hatched, a key line round it. */
function moColossus(x, S, cx, base, size, I, p, lit, mr) {
  const b = S.box, kk = size / Math.max(1, b.y1 - b.y0), cy = base - size / 2, half = ((b.x1 - b.x0) * kk) / 2;
  if (!canPaint(x)) { placeShape(x, S, I.far, cx, cy, size); return; }
  const k = scaleOf(x), d = Math.max(1.2, 0.9 / k);
  x.save(); x.translate(mr[0], mr[1]);
  for (let i = 0; i < 8; i++) placeShape(x, S, I.farLine, cx + Math.cos((i / 8) * TAU) * d, cy + Math.sin((i / 8) * TAU) * d, size);
  x.restore();
  placeShape(x, S, I.far, cx, cy, size);
  x.save(); x.globalCompositeOperation = "source-atop";
  x.beginPath(); x.rect(lit > 0 ? cx - half - 10 : cx + half * 0.05, base - size - 10, half * 0.95 + 10, size + 20); x.fillStyle = css(I.farShade); x.fill();
  x.beginPath(); x.rect(cx - half - 10, base - size - 10, half * 2 + 20, size + 20); moHatch(x, Math.PI / 2.4, 3.4, 1, I.farLine, 0.55 * p.hatch);
  x.beginPath(); x.rect(cx - half - 10, base - size * 0.18, half * 2 + 20, size * 0.2); moStipple(x, 0.5, I.farShade, 0.9);
  x.restore();
}

// ====================================================================== the land: mesas, the path, rocks
/**
 * A mesa: walls a little out of true rising from a talus to a flat top with a step in it; the face toward the light in
 * its row's lit ink with strata ruled across it, the other in shade hatched downward; the talus stippled.
 */
function moMesa(x, x0, x1, base, top, lit, ink, shadeInk, I, p, k, mr) {
  const w = x1 - x0, hh = base - top, kind = rand(k + 9), st = rand(k) < 0.5, out = [];
  if (kind < 0.62) {   // a mesa: walls a little out of true, a talus at their foot, a flat top with a step in it, the top's edge broken
    // the cliff stands on its talus, an apron of scree curving out to the foot
    const tl = x0 + w * (0.19 + rand(k + 1) * 0.08), tr = x1 - w * (0.19 + rand(k + 2) * 0.08), step = top + hh * (0.07 + rand(k + 3) * 0.08), cliff = 0.42 + rand(k + 7) * 0.14;
    out.push([x0, base + 2], [x0 + w * 0.07, base - hh * 0.07], [x0 + w * 0.13, base - hh * 0.2], [tl - w * 0.035, top + hh * cliff], [tl - w * 0.01, top + hh * 0.3], [tl, top + hh * 0.08], [tl + w * 0.02, top]);
    for (let i = 1, n = 5; i < n; i++) { const tx0 = tl + (tr - tl) * (i / n), up = st && i >= 3 ? step : top; out.push([tx0, up + (i % 2 ? hh * 0.012 : 0)]); }
    out.push([tr, st ? step : top], [tr + w * 0.012, top + hh * 0.12], [tr + w * 0.02, top + hh * (cliff - 0.04)], [x1 - w * 0.13, base - hh * 0.22], [x1 - w * 0.07, base - hh * 0.08], [x1, base + 2]);
  } else {   // a butte or a hoodoo: narrower, a cap of harder rock on a waisted stem
    const c = (x0 + x1) / 2, cw = w * 0.32, sw = w * 0.2;
    out.push([x0, base + 2], [c - w * 0.3, base - hh * 0.25], [c - sw, top + hh * 0.42], [c - sw * 0.85, top + hh * 0.2], [c - cw, top + hh * 0.14], [c - cw * 0.9, top + hh * 0.03], [c - cw * 0.2, top], [c + cw * 0.5, top + hh * 0.015], [c + cw, top + hh * 0.11], [c + sw * 0.9, top + hh * 0.2], [c + sw, top + hh * 0.44], [c + w * 0.3, base - hh * 0.24], [x1, base + 2]);
  }
  const split = lit > 0 ? x0 + w * (0.6 + rand(k + 4) * 0.12) : x0 + w * (0.28 + rand(k + 5) * 0.12);
  const edge = lit > 0 ? x0 - 4 : x1 + 4, litBox = lit > 0 ? [split, x1 + 4] : [x0 - 4, split], shadeFace = [[split, top - 4], [split + lit * w * 0.05, base + 4], [edge, base + 4], [edge, top - 4]];
  moPrint(x, mr, () => {
    poly(x, out); x.fillStyle = css(ink); x.fill();
    x.save(); poly(x, out); x.clip();
    poly(x, shadeFace); x.fillStyle = css(shadeInk); x.fill();
    moHatch(x, Math.PI / 2, 2.7, 1.05, I.line, 0.7 * p.hatch, k);   // the face in shade, hatched down its fall
    x.beginPath(); x.rect(x0 - 4, base - hh * 0.42, w + 8, hh * 0.42 + 4); x.save(); poly(x, shadeFace); x.clip(); x.beginPath(); x.rect(x0 - 4, base - hh * 0.42, w + 8, hh * 0.42 + 4); moHatch(x, Math.PI / 2 - 0.55 * lit, 3.2, 0.95, I.line, 0.55 * p.hatch, k + 1); x.restore();   // crossed toward its foot
    x.beginPath(); x.rect(x0 - 4, top + hh * 0.06, w + 8, hh * 0.05); moHatch(x, 0, 2.2, 0.8, shadeInk, 0.8 * p.hatch);   // the cap's shadow under the rim
    x.beginPath(); x.rect(x0 - 4, base - hh * 0.2, w + 8, hh * 0.2 + 4); moStipple(x, 0.45, shadeInk, p.hatch);
    x.restore();
  }, () => {
    poly(x, out); stroke(x, I.line, 1.5);
    x.beginPath(); x.moveTo(split, top + 1); x.lineTo(split + lit * w * 0.05, base); stroke(x, I.line, 1);
    x.save(); poly(x, out); x.clip(); x.beginPath();
    for (let i = 1, n = 4 + Math.floor(rand(k + 6) * 5); i <= n; i++) {   // strata across the lit face, some broken off
      const y = top + hh * 0.12 + hh * 0.66 * (i / (n + 1)) ** 1.15, j = (rand(k + i * 1.7) - 0.5) * hh * 0.03, a0 = litBox[0] + (rand(k + i * 2.3) < 0.3 ? w * 0.2 * rand(k + i) : 0);
      x.moveTo(a0, y + j); x.lineTo(litBox[1], y - j);
    }
    stroke(x, I.line, 0.85, 0.6 * clamp(p.hatch * 1.4)); x.restore();
  });
}
/** A boulder in the foreground: a few facets, lit and shaded, a key line, its shadow on the ground away from the light. */
function moRock(x, cx, base, r, ink, shadeInk, I, p, lit, k, mr) {
  // a cluster of crystal shards in the cool inks, struck into the warm ground: each a pointed prism leaning a little, a face to the light, a face in shade
  const n = 2 + Math.floor(rand(k) * 3), s = lit > 0 ? 1 : -1, shards = [];
  for (let i = 0; i < n; i++) {
    const kk = k + i * 3.3, hh = r * (i ? 0.9 + rand(kk) * 1.2 : 1.8 + rand(kk) * 1.4), bw = r * (0.35 + rand(kk + 1) * 0.35), lean = (rand(kk + 2) - 0.5) * 0.9 + (i ? (i % 2 ? -0.35 : 0.35) : 0), bx = cx + (i ? (i % 2 ? -1 : 1) * r * (0.35 + rand(kk + 3) * 0.4) : 0);
    const tip = [bx + Math.sin(lean) * hh, base - Math.cos(lean) * hh], sh = (t) => [bx + Math.sin(lean) * hh * t, base - Math.cos(lean) * hh * t];
    const [ux, uy] = sh(0.78), L = [bx - bw, base + 1], R = [bx + bw, base + 1], UL = [ux - bw * 0.95, uy], UR = [ux + bw * 0.95, uy], M = [bx + s * bw * 0.1, base + 1], UM = [ux + s * bw * 0.1, uy];
    shards.push({ out: [L, UL, tip, UR, R], lit: s > 0 ? [M, UM, tip, UR, R] : [L, UL, tip, UM, M], shade: s > 0 ? [L, UL, tip, UM, M] : [M, UM, tip, UR, R], keel: [M, UM, tip], cap: [UL, tip, UR, UM] });
  }
  shards.sort((a, b) => a.keel[2][1] - b.keel[2][1]);   // the tallest behind
  x.beginPath(); x.ellipse(cx - s * r * 1.1, base + r * 0.04, r * 1.9, r * 0.22, 0, 0, TAU); x.fillStyle = css(shadeInk, 0.85); x.fill();
  for (const q of shards) moPrint(x, mr, () => {
    poly(x, q.lit); x.fillStyle = css(ink); x.fill();
    poly(x, q.cap); x.fillStyle = css(mix(ink, I.glow, 0.4)); x.fill();
    poly(x, q.shade); x.fillStyle = css(shadeInk); x.fill(); moHatch(x, Math.PI / 2.3, 2.4, 0.85, I.line, 0.75 * p.hatch, k);
  }, () => { poly(x, q.out); stroke(x, I.line, 1.25); x.beginPath(); x.moveTo(...q.keel[0]); x.lineTo(...q.keel[1]); x.lineTo(...q.keel[2]); x.moveTo(...q.cap[0]); x.lineTo(...q.cap[3]); x.lineTo(...q.cap[2]); stroke(x, I.line, 0.85); });
}
/**
 * The land: the path of light running from the foot of the field to the spire's foot (a lit band, stippled at its
 * edges), the ground ruled with level strata closer together toward the horizon, three rows of mesas on either side of
 * the path (paler the further, kept off the path and under the boxes where there is room; see moMesas), boulders by
 * the path (moRocks).
 */
function moLand(x, P, I, p) {
  const { F, fw, u, H } = P, a = p.land, lspan = F.y1 - H, vx = P.tx, sd = seed % 9973, crack = mix(I.land[1], I.key, 0.55);
  const cols = 56, rows = 22, at = (s, v) => [vx + s * fw * 1.15 * v, H + lspan * v];
  const pt = (i, j) => { const v = (j / rows) ** 2.1, dv = ((j + 1) / rows) ** 2.1 - v; return at(((i - cols / 2) / (cols / 2)) * 1.6 + (moHash(i, j, 61 + sd) - 0.5) * 0.035, v + (moHash(i, j, 62 + sd) - 0.5) * dv * 0.5); };
  if (a > 0) moPrint(x, P.mr, () => {   // slabs of the ground a shade darker or lighter here and there, mottling it as dried mud is
    for (const [ink, salt, n] of [[mix(I.land[0], I.land[1], 0.55), 65, 0.16], [mix(I.land[0], I.path, 0.35), 66, 0.07]]) {
      x.beginPath();
      for (let j = 3; j < rows; j++) for (let i = 0; i < cols; i++) if (moHash(i, j, salt + sd) < n) { const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]; q.forEach((c, m) => (m ? x.lineTo(...c) : x.moveTo(...c))); x.closePath(); }
      x.fillStyle = css(ink); x.globalAlpha = Math.min(1, a * 3); x.fill(); x.globalAlpha = 1;
    }
  }, () => {});
  if (a > 0) moPrint(x, P.mr, () => {   // the path of light, its edges stippled into the ground
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.05) { const [c, hw] = moPathAt(P, t); pts.push([c - hw, H + lspan * t], [c + hw, H + lspan * t]); }
    const left = pts.filter((_, i) => i % 2 === 0), right = pts.filter((_, i) => i % 2 === 1).reverse();
    x.beginPath(); [...left, ...right].forEach((q, i) => (i ? x.lineTo(...q) : x.moveTo(...q))); x.closePath(); x.fillStyle = css(I.path); x.globalAlpha = Math.min(1, a * 2.5); x.fill();
    const wide = [...left.map(([px, py], i) => [px - (fw * 0.035 * i) / left.length, py]), ...right.map(([px, py], i) => [px + (fw * 0.035 * (right.length - 1 - i)) / right.length, py])];
    poly(x, wide); moStipple(x, 0.42, I.path, 1); x.globalAlpha = 1;
  }, () => {
    // the ground cracked into slabs running off to the spire's foot: rows closer and closer toward the horizon, their seams broken here and there
    x.beginPath();
    for (let j = 2; j <= rows; j++) for (let i = 0; i < cols; i++) {
      const A = pt(i, j), B = pt(i + 1, j), C = pt(i, j + 1);
      if (moHash(i, j, 63 + sd) < 0.84) { x.moveTo(...A); x.lineTo(...B); }
      if (j < rows && moHash(i, j, 64 + sd) < 0.72) { x.moveTo(...A); x.lineTo(...C); }
    }
    stroke(x, crack, 1.05, 0.8 * clamp(p.hatch * 1.4) * Math.min(1, a * 3));
  });
  if (a <= 0) return;
  for (const q of moMesas(P, p)) moMesa(x, q.x0, q.x1, q.base, q.top, q.cx < P.sun0[0] ? 1 : -1, I.mesa[q.r], I.mesaShade[q.r], I, p, q.k, P.mr);
  for (const [cx, base, r, k] of moRocks(P).slice(0, Math.round(2 + 7 * a))) moRock(x, cx, base, r, I.far, I.farShade, I, p, cx < P.sun0[0] ? 1 : -1, k, P.mr);
}
/**
 * The mesas, row by row from the back, each side of the path (the near row only toward the field's sides): each at
 * its seeded place, the slider bringing them in one by one and sizing them there; judged at its widest (whether it
 * keeps off the path, and its room), kept under the boxes where that room holds a mesa that reads, else at its own
 * height behind them (they lie over it) — none left out. { x0, x1, cx, base, top, r, k }.
 */
export function moMesas(P, p) {
  const { F, fw, u, H } = P, a = p.land, lspan = F.y1 - H, out = [];
  [[0.02, 0.11, 0.13], [0.12, 0.17, 0.2], [0.36, 0.3, 0.3]].forEach(([d, hf, wf], r) => {
    if (r === 2 && a < 0.3) return;
    const base = H + lspan * d, [pc, phw] = moPathAt(P, d), n = Math.max(2, Math.round(fw / (u * wf * 1.9)));
    for (let i = 0; i < n; i++) {
      const k = 5800 + r * 101 + i * 11.3, w1 = u * wf * (0.7 + rand(k) * 0.6), w = w1 * (0.6 + 0.4 * a), cx = F.x0 + fw * ((i + 0.15 + rand(k + 1) * 0.7) / n);
      if (cx + w1 / 2 > pc - phw * 1.5 - u * 0.03 && cx - w1 / 2 < pc + phw * 1.5 + u * 0.03) continue;   // off the path (a place on it is none)
      if (r === 2 && cx > F.x0 + fw * 0.22 && cx < F.x1 - fw * 0.22) continue;
      if (rand(k + 2) > 0.4 + 0.55 * a) continue;
      const top0 = base - u * hf * (0.5 + rand(k + 3) * 0.6) * (0.5 + 0.5 * a), room = P.room(cx - w1 / 2, cx + w1 / 2, base, u * (r < 2 ? 0.012 : 0.03));
      out.push({ x0: cx - w / 2, x1: cx + w / 2, cx, base, top: room !== null && base - room >= u * hf * 0.28 ? Math.max(top0, room) : top0, r, k });
    }
  });
  return out;
}
/**
 * The nine boulders by the path, the slider bringing them in one by one: each at its seeded place beside the path,
 * else on the path's other side or at one of two others, the first on the field clear of the boxes, else the one
 * reaching least behind them — never left out. [cx, base, r, k].
 */
export function moRocks(P) {
  const { F, H, u } = P, lspan = F.y1 - H, out = [];
  for (let i = 0; i < 9; i++) {
    const k = 6100 + i * 5.3, s0 = rand(k + 1) < 0.5 ? -1 : 1;
    let best = null;
    for (const [q, sgn] of [[k, s0], [k, -s0], [6200 + i * 7.1, s0], [6200 + i * 7.1, -s0]]) {
      const t = 0.45 + rand(q) * 0.5, [pc, phw] = moPathAt(P, t), r = u * (0.012 + 0.02 * rand(k + 2)) * (0.5 + t), c0 = pc + sgn * (phw * (1.15 + rand(k + 3) * 1.4) + r), base = H + lspan * t;
      const cx = clamp(c0, P.In.x0 + r * 1.4, P.In.x1 - r * 1.4), off = Math.abs(cx - c0) > 0.5 ? 1e12 : 0;   // on the field, off the block (brought in from past its edge only where no other place is)
      const v = off + (P.room(cx - r * 1.4, cx + r * 1.4, base) === null || P.keep.some((b) => cx > b.x && cx < b.x + b.w && base > b.y && base - r < b.y + b.h) ? 1 + moBehind(P, { x: cx - r * 1.4, y: base - r * 3, w: r * 2.8, h: r * 3 }) : 0);
      if (!best || v < best.v) best = { at: [cx, base, r, k], v };
      if (!v) break;
    }
    out.push(best.at);
  }
  return out;
}
/** The lone figure on the path, seen from behind, facing the spire: a hooded cloak in the hot ink, a staff, a long shadow toward us. */
function moFigure(ctx, fx, fy, s, I, mr) {
  moPrint(ctx, mr, () => {
    ctx.fillStyle = css(I.key, 0.55); ctx.beginPath(); ctx.moveTo(fx - s * 0.12, fy); ctx.lineTo(fx + s * 0.12, fy); ctx.lineTo(fx + s * 0.55, fy + s * 0.9); ctx.lineTo(fx + s * 0.1, fy + s * 0.95); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(I.hot); poly(ctx, [[fx - s * 0.17, fy], [fx - s * 0.12, fy - s * 0.55], [fx - s * 0.06, fy - s * 0.76], [fx, fy - s * 0.86], [fx + s * 0.07, fy - s * 0.74], [fx + s * 0.13, fy - s * 0.52], [fx + s * 0.19, fy]]); ctx.fill();
  }, () => {
    poly(ctx, [[fx - s * 0.17, fy], [fx - s * 0.12, fy - s * 0.55], [fx - s * 0.06, fy - s * 0.76], [fx, fy - s * 0.86], [fx + s * 0.07, fy - s * 0.74], [fx + s * 0.13, fy - s * 0.52], [fx + s * 0.19, fy]]); stroke(ctx, I.key, Math.max(1, s * 0.03));
    ctx.beginPath(); ctx.moveTo(fx + s * 0.02, fy - s * 0.72); ctx.lineTo(fx + s * 0.04, fy - s * 0.1); stroke(ctx, I.key, Math.max(0.8, s * 0.02), 0.8);
    ctx.beginPath(); ctx.moveTo(fx + s * 0.26, fy + s * 0.02); ctx.lineTo(fx + s * 0.22, fy - s * 1.02); stroke(ctx, I.key, Math.max(1, s * 0.035));
  });
}

// ====================================================================== the cave mouth
/**
 * The inner edge of the cave mouth's rock at slider value a, all round the open field (not on the colour block's side),
 * thick at the corners and thin toward the middle of each side: each point steps back toward the field's edge until
 * it is clear of every box (the title, the tag, the graphic, the channel name, the brand row) and of what stands in
 * the vista (`avoid`: the room the sun, the colossus, the spire and the figure keep at their largest, on or not, so
 * no other slider moves the rock). From every third point of the overhang where it is thick enough, a stalactite (the
 * overhang there stepping back far enough to leave it room to read), wherever there is rock left to hang it from,
 * shortened to the room under it where its tip would reach into a box (only a stub too short to read is left off).
 * { inner, tips }.
 */
export function moCaveEdge(P, a, env, avoid) {
  const { F, u, keep } = P, words = [...keep, ...(env.hasBrand ? [{ x: 0, y: 0, w: env.w, h: 124 }] : [])], boxes = [...words, ...avoid];
  const within = (bs) => (q) => bs.some((b) => q[0] > b.x && q[0] < b.x + b.w && q[1] > b.y && q[1] < b.y + b.h), inBox = within(boxes), inWords = within(words);
  const shut = { bottom: F.side === "below", right: F.side === "right", top: F.side === "above", left: F.side === "left" };   // the block's side: no rock there
  const T0 = u * (0.05 + 0.17 * a), inner = [], tips = [];
  const sides = [
    ["bottom", [F.x0, F.y1], [F.x1, F.y1], [0, -1], 1.15, 26], ["right", [F.x1, F.y1], [F.x1, F.y0], [-1, 0], 1, 16],
    ["top", [F.x1, F.y0], [F.x0, F.y0], [0, 1], 0.8, 26], ["left", [F.x0, F.y0], [F.x0, F.y1], [1, 0], 1, 16],
  ];
  for (const [name, A, B, [nx, ny], kk, n] of sides) {
    for (let i = 0; i < n; i++) {
      const t = i / n, ex = A[0] + (B[0] - A[0]) * t, ey = A[1] + (B[1] - A[1]) * t, k = 6300 + inner.length * 3.1;
      if (shut[name]) { inner.push([ex - nx * 6, ey - ny * 6]); continue; }
      const corner = Math.max(0, 1 - t / 0.38, 1 - (1 - t) / 0.38) ** 1.3, jag = i % 2 ? 0.78 + rand(k) * 0.2 : 1 + rand(k + 1) * 0.35, th0 = T0 * kk * (0.16 + 0.84 * corner) * jag;
      const spike = name === "top" && th0 > T0 * 0.2 && i % 3 === 1, l0 = spike ? T0 * (0.5 + rand(k + 2) * 1.1) * (0.4 + corner) : 0, need = Math.min(l0, T0 * 0.3);   // a stalactite's slot: the overhang where it is thick enough
      const back = (inB) => { let d = th0; while (d > 0 && (inB([ex + nx * d, ey + ny * d]) || (spike && inWords([ex + nx * (d + need), ey + ny * (d + need)])))) d -= T0 * 0.12; return Math.max(d, -6); };   // stepped back clear of the boxes (at a stalactite's slot, far enough to leave it room to read)
      let th = back(inBox);
      if (spike && th <= 2) th = back(inWords);   // no rock left there to hang a stalactite from: the rock in front of what stands in the vista, clear of the words still
      inner.push([ex + nx * th, ey + ny * th]);
      if (spike && th > 2) {   // a stalactite: a spike hanging from the overhang, wherever there is rock left to hang it from
        const w0 = T0 * 0.09, least = Math.max(4, T0 * 0.05), fit = (inB) => { let l = l0; while (l > least && inB([ex + nx * (th + l), ey + ny * (th + l)])) l -= T0 * 0.05; return l; };
        let l = fit(inBox);   // shortened to the room under it
        if (l <= least) l = fit(inWords);   // no room clear of what stands in the vista: it hangs in front of it, clear of the words still
        if (l > least) { const tip = [ex + nx * (th + l), ey + ny * (th + l)]; inner.push([ex - w0 + nx * th, ey + ny * th], tip, [ex + w0 * 0.6 + nx * th, ey + ny * th]); tips.push(tip); }
      }
    }
  }
  return { inner, tips };
}
/**
 * The room the parts standing in the vista keep, for the cave mouth to step back from: each at its largest, whether its
 * slider has it on or not (so none of them moves the rock) — the sun where it may stand at any size, the colossus (`col`
 * from moColossusAt, for a graphic `aspect` wide; none without a graphic), the spire, the lone figure.
 */
export function moAvoid(P, col, aspect) {
  const { H, u, fh, sR, sunRoom: S, fig } = P, th = P.spire(1), s = fh * 0.09, out = [{ x: S.x - sR * 0.7, y: S.y - sR * 0.7, w: S.w + sR * 1.4, h: S.h + sR * 1.4 }];
  if (col) { const half = (col.big * aspect) / 2 + 12; out.push({ x: col.cx - half, y: H - col.big - 12, w: half * 2, h: col.big }); }
  out.push({ x: P.tx - th * 0.07, y: H - th - u * 0.02, w: th * 0.14, h: th * 0.36 + u * 0.02 }, { x: P.tx - th * 0.22, y: H - th * 0.66, w: th * 0.44, h: th * 0.66 });   // the spire: its needle, then its ring and the lesser spires
  out.push({ x: fig.x - s * 0.6, y: fig.y - s * 1.2, w: s * 1.4, h: s * 1.5 });
  return out;
}
/**
 * The cave mouth the vista is seen from: rock in the key ink all round the open field (not on the colour block's side),
 * thick at the corners and thin toward the middle of each side, so the opening is a ragged oval; a ledge along the
 * foot, walls at the sides, an overhang along the top with stalactites hanging from it (moCaveEdge). Its inner edge is
 * broken into crystal facets a shade lighter, hatched in turns, a second ring of broader facets behind them, and a rim
 * of the lit ink along it where the vista lights it.
 */
function moCave(x, P, I, p, env, avoid) {
  const { F, fw, fh, u } = P, { inner } = moCaveEdge(P, p.cave, env, avoid);
  const W = env.w, H0 = env.h, outer = [[-60, -60], [W + 60, -60], [W + 60, H0 + 60], [-60, H0 + 60]];
  const shape = () => { x.beginPath(); outer.forEach((q, i) => (i ? x.lineTo(...q) : x.moveTo(...q))); x.closePath(); inner.forEach((q, i) => (i ? x.lineTo(...q) : x.moveTo(...q))); x.closePath(); };
  const ox = F.x0 + fw / 2, oy = F.y0 + fh * 0.5;   // the opening's middle: the rock lies away from it
  const facets = [];
  for (let i = 0; i < inner.length; i++) {
    const q0 = inner[i], q1 = inner[(i + 1) % inner.length], dx = q1[0] - q0[0], dy = q1[1] - q0[1], l = Math.hypot(dx, dy);
    if (l < 1) continue;
    let nx = dy / l, ny = -dx / l;
    const mx = (q0[0] + q1[0]) / 2, my = (q0[1] + q1[1]) / 2;
    if (nx * (mx - ox) + ny * (my - oy) < 0) { nx = -nx; ny = -ny; }
    const d = u * (0.022 + 0.04 * rand(6600 + i)), d2 = d * (2.2 + rand(6601 + i) * 1.4);
    facets.push({ q0, q1, mid: [mx + nx * d, my + ny * d], deep: [mx + nx * d2 + dx * 0.35, my + ny * d2 + dy * 0.35], back: [q0[0] + nx * d2 * 0.8, q0[1] + ny * d2 * 0.8], ang: Math.atan2(dy, dx), i });
  }
  moPrint(x, P.mr, () => {
    shape(); x.fillStyle = css(I.cave); x.fill("evenodd");
    x.save(); shape(); x.clip("evenodd");
    for (const f of facets) {   // broad facets behind, then the strip along the edge
      poly(x, [f.q0, f.deep, f.back]); x.fillStyle = css(mix(I.caveFacet, I.cave, 0.55)); x.fill();
      if (f.i % 3 === 0) { poly(x, [f.q0, f.deep, f.back]); moHatch(x, f.ang + 1.1, 3.4, 0.9, I.caveLine, 0.6 * p.hatch); }
    }
    for (const f of facets) {
      poly(x, [f.q0, f.q1, f.mid]); x.fillStyle = css(f.i % 2 ? I.caveFacet : mix(I.caveFacet, I.cave, 0.3)); x.fill();
      if (f.i % 2) { poly(x, [f.q1, f.mid, f.deep]); moHatch(x, f.ang + 0.7, 2.6, 0.9, I.caveLine, 0.85 * p.hatch); }
    }
    x.restore();
  }, () => {
    x.save(); shape(); x.clip("evenodd");
    x.beginPath(); for (const f of facets) { x.moveTo(...f.q0); x.lineTo(...f.mid); x.lineTo(...f.q1); x.moveTo(...f.mid); x.lineTo(...f.deep); } stroke(x, I.caveLine, 0.9, 0.9);
    x.restore();
    x.beginPath(); inner.forEach((q, i) => (i ? x.lineTo(...q) : x.moveTo(...q))); x.closePath(); stroke(x, I.rim, 1.9, 0.95);
  });
}

// ====================================================================== the photo as a screen print
/**
 * RGBA pixels printed in the set's five inks, mixed in by a: the lightness stretched over what the picture holds (its
 * darkest and lightest in a hundred kept), then cut into five steps — key, deep, cool, lit, glow — each step dithered
 * into the next by a screen of its own instead of an edge: cross-hatching in the deepest shadows, a single hatch in the
 * shade, a finer one in the half-tones, stipple in the lights; the screens `amt` strong (0: the steps meet hard), their
 * lines a 180th of the picture apart, so the preview and the export are the same print. Alpha kept.
 */
export function moPixels(d, w, h, I, a = 1, amt = 1) {
  if (a <= 0) return;
  const n = w * h, hist = new Uint32Array(256);
  for (let i = 0, o = 0; i < n; i++, o += 4) if (d[o + 3]) hist[(d[o] * 54 + d[o + 1] * 183 + d[o + 2] * 19) >> 8]++;
  let tot = 0; for (let i = 0; i < 256; i++) tot += hist[i];
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > tot * 0.01) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > tot * 0.01) { hi = i; break; } }
  if (hi - lo < 24) { lo = Math.max(0, lo - 12); hi = Math.min(255, hi + 12); }
  // for each lightness: its step, and, near a cut, which cut and how far past it (the screen decides there)
  const cuts = [0.2, 0.38, 0.58, 0.8], band = 0.085 * amt, stepOf = new Uint8Array(256), cutOf = new Int8Array(256), past = new Float32Array(256);
  for (let v = 0; v < 256; v++) {
    const l = clamp((v - lo) / (hi - lo));
    let k = 0;
    while (k < 4 && l > cuts[k]) k++;
    stepOf[v] = k; cutOf[v] = -1;
    for (let c = Math.max(0, k - 1); c <= Math.min(3, k); c++) if (Math.abs(l - cuts[c]) <= band && band > 0) { cutOf[v] = c; past[v] = (l - cuts[c]) / (2 * band); break; }
  }
  const inks = [I.key, I.deep, I.cool, I.lit, I.glow].map((c) => c.map(Math.round)), R = new Uint8Array(5), G = new Uint8Array(5), B = new Uint8Array(5);
  inks.forEach((c, i) => { R[i] = c[0]; G[i] = c[1]; B[i] = c[2]; });
  const gap = Math.max(3, Math.max(w, h) / 180), cs = Math.SQRT1_2 / gap, b2 = 1 - a, f = (u) => { const t = u - Math.floor(u); return t < 0.5 ? 1 - 2 * t : 2 * t - 1; };
  for (let y = 0, o = 0; y < h; y++) {
    for (let x = 0; x < w; x++, o += 4) {
      if (!d[o + 3]) continue;
      const r = d[o], g = d[o + 1], b = d[o + 2], v = (r * 54 + g * 183 + b * 19) >> 8, c = cutOf[v];
      let ink = stepOf[v];
      if (c >= 0) {   // the screen's value s (0 on its line or dot, 1 between): past the cut by more than s - ½ of the band, the lighter ink
        const u1 = (x + y) * cs, u2 = (x - y) * cs;
        const s = c === 0 ? Math.min(f(u1), f(u2))   // cross-hatch
          : c === 1 ? f(u1)   // hatch
          : c === 2 ? f((x * 0.94 + y * 0.34) * cs * 1.4)   // a finer hatch, at a lower angle
          : Math.min(1, Math.hypot(1 - f(u1 * 1.5), 1 - f(u2 * 1.5)) * 0.72);   // stipple: round dots on a lattice
        ink = past[v] + (s - 0.5) > 0 ? c + 1 : c;
      }
      d[o] = r * b2 + R[ink] * a; d[o + 1] = g * b2 + G[ink] * a; d[o + 2] = b * b2 + B[ink] * a;
    }
  }
}

// ====================================================================== lettering
/**
 * Paints the letters of `each` with the film title's inline: filled, then (on a work canvas the size of the line, so it
 * stays inside them) a band in from their edge in the inline's ink, and in from that the fill again, leaving a fine
 * line set in from the edge. Too small to hold one (under 40 units), they are only filled.
 */
function moInline(ctx, B, fs, each, fill, line, only) {
  const E = dkWork(ctx, "moLetters", B);
  E.fillStyle = css(fill); each((c, x) => E.fillText(c.t, x, 0), only);
  if (fs >= 40) {
    E.globalCompositeOperation = "source-atop"; E.lineJoin = "round";
    E.strokeStyle = css(line); E.lineWidth = fs * 0.078; each((c, x) => E.strokeText(c.t, x, 0), only);
    E.strokeStyle = css(fill); E.lineWidth = fs * 0.046; each((c, x) => E.strokeText(c.t, x, 0), only);
  }
  inPixels(ctx, () => ctx.drawImage(E.canvas, B.x0, B.y0));
}

// ====================================================================== the look
export const mondo = {
  id: "mondo",
  art: "colossus",
  seeded: true,
  leave: moFreeAll,   // what it keeps (its parts, its tiles) goes as another look is chosen
  repaint: (c) => `a limited-edition screen-printed poster made from the photograph, in the manner of boutique film and fantasy prints: four to six flat inks only (burnt orange, indigo, cream and black, with ${c} as the hot ink), the paper showing through, the ink plates slightly off register; dense parallel hatching in the shadows following the forms, stipple for the gradients, crisp black key lines; still the same picture, no text.`,
  about: { zh: "丝网奇境：限量丝网版画式的电影与奇幻海报（Kilian Eng 一路的画风）——只用四到六种平涂油墨，纸色透出来，几块版之间微微错位；整个世界由线画成：背光的一面排满随光转向的平行排线，天空的渐变用点刻一层层过渡，远山切成水晶般的棱面，云朵是一层层堆起来的圆瓣、底下排线打影，太阳放射出细细的直线；平顶山一排排往后退、越远墨色越浅，地平线上立着一座尖塔，光路上走着一个很小的人，洞口的岩壁把整个远景框起来；可以把频道图形变成地平线上的巨像，加一圈装饰艺术风的细双线边框。标题用优雅的衬线字，字里留一道细内线，第二块版错开一点印出投影，高亮字是热色（频道色）。五套油墨可选：沙丘的焦橙与靛蓝、永恒故事的金与紫、冰川的青与白、丛林的青绿与金、神庙的绯红与玫瑰。深色底是夜色纸上印浅色墨，浅色底是奶白纸上印深色墨。宏大、神秘、细节密到想凑近看——适合电影、游戏、奇幻与科幻、旅行、历史、音乐专辑与任何想要史诗感的封面。照片会被印成同一套油墨，暗部排线、亮部点刻。", en: "Screen-print odyssey: the limited-edition screen-printed film and fantasy print (after Kilian Eng and his kind) — four to six flat inks only, the paper showing through, the plates a little off register; a world made of line: dense parallel hatching on every face turned from the light, the sky's gradient stippled step by step, far peaks cut into crystal facets, clouds of stacked lobes hatched beneath, thin rules radiating from the sun; mesas stepping back in paler and paler inks, a spire on the far horizon, a lone figure on the path of light for scale, the rock of a cave mouth framing it all; the channel graphic as a colossus on the horizon and an Art Deco border of fine double rules if you like. The title is an elegant serif with a fine inline, a second plate printed off register as its shadow, the highlighted words in the hot ink (the channel colour). Five ink sets: Dune's burnt orange and indigo, the NeverEnding gold and violet, glacier teal and white, jungle teal and gold, temple crimson and rose. The dark ground is light inks on a night stock, the light one dark inks on cream. Epic, mysterious, detailed enough to lean in to — for films, games, fantasy and sci-fi, travel, history, albums and any cover that wants to feel like a saga. A photo is printed in the same inks, hatched in its shadows and stippled in its lights." },
  name: { zh: "丝网奇境", en: "Screen-print odyssey" },
  scene: { sun: { zh: "太阳", en: "Sun" }, tower: { zh: "尖塔", en: "Spire" }, figure: { zh: "孤独旅人", en: "Lone figure" }, colossus: { zh: "巨像", en: "Colossus" } },
  params: [
    { key: "inks", min: 0, max: 1, step: 0.25, def: 0, name: { zh: "油墨（沙丘·永恒故事·冰川·丛林·神庙）", en: "Inks (dune, story, glacier, jungle, temple)" } },
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "太阳", en: "Sun" } },
    { key: "rays", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "放射细线", en: "Radiating rules" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "堆云", en: "Clouds" } },
    { key: "range", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "水晶远山", en: "Crystal peaks" } },
    { key: "land", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "平顶山与光路", en: "Mesas and the path" } },
    { key: "tower", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "尖塔", en: "Spire" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "孤独旅人", en: "Lone figure" } },
    { key: "cave", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "洞口岩壁", en: "Cave mouth" } },
    { key: "colossus", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "巨像", en: "Colossus" } },
    { key: "hatch", min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "排线与点刻", en: "Hatching and stipple" } },
    { key: "misreg", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "套色错位", en: "Misregistration" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "装饰边框", en: "Ornate border" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "纸纹与墨点", en: "Paper and ink" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片印成丝网", en: "Photo as a screen print" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.27, strip: 0.1 }),
  theme: (base, C, p) => {
    const I = moInks(p, C), on = lum(I.hot) > 0.42 ? I.key : I.paper;
    return { ...base, field: css(I.ground), text: css(I.text), own: css(on), dim: css(I.text, 0.62), titleFill: css(I.title), titleInk: css(I.titleLine), grid: () => css(I.dark ? I.glow : I.key, I.dark ? 0.12 : 0.1) };
  },
  /**
   * The ground (the sky stippled down to the horizon in four steps, the land in two), then on it, from the back, each by
   * its slider: the sun's halo, its radiating rules and its disc, the clouds and the crystal peaks, the colossus and the
   * spire on the horizon, the land (the path of light, the mesas, boulders), the lone figure, the cave mouth. Each part
   * is painted once and kept on a canvas of its box (moLay); a part dragged is laid down moved. A photo is printed in the
   * inks (moPixels, kept by drawPhotoAt's treatment, faded in over the photo by its slider).
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, I = moInks(p, C), ik = moKey(I);
    if (env.photo) {
      const a = p.photo, hatch = p.hatch;
      if (a < 1) env.drawPhoto();
      if (a > 0) { ctx.save(); ctx.globalAlpha = a; env.drawPhoto(0, { key: `mo|${ik}|${hatch}`, fn: (d, pw, ph) => moPixels(d, pw, ph, I, 1, hatch) }); ctx.restore(); }
      return true;
    }
    const P = moPlan(ctx, env, p), { F, fw, fh, u, H } = P, at = [seed, w, h, F.x0, F.y0, F.x1, F.y1, H.toFixed(1)].join("|"), mr = P.mr;
    if (L.ground !== false) moLay(ctx, "moGround", `${at}|${ik}|${p.hatch}`, { x: 0, y: 0, w, h }, (x) => moGround(x, P, I, p.hatch));
    if (!L.grid) return true;
    const boxes = P.keep.map((b) => [b.x, b.y, b.w, b.h].map(Math.round).join(",")).join(";"), lit = `${P.sun0[0].toFixed(0)}`;
    const [sx, sy] = p.sun > 0 || p.rays > 0 ? objAt("sun", P.sun0[0], P.sun0[1], ctx) : P.sun0;
    if (p.sun > 0) moHalo(ctx, P, sx, sy, P.sr, I, Math.min(1, p.sun * 2) * clamp(p.hatch * 1.4));
    moRays(ctx, { ...P }, sx, sy, I, p.rays);
    if (p.sun > 0) { ctx.save(); ctx.beginPath(); ctx.rect(-50, -50, w + 100, H + 50); ctx.clip(); ctx.globalAlpha = Math.min(1, p.sun * 4); moSun(ctx, sx, sy, P.sr, I, p, mr); ctx.restore(); }   // a sun that sets goes behind the land
    if (p.clouds > 0 || p.range > 0) moLay(ctx, "moFar", `${at}|${ik}|${p.clouds}|${p.range}|${p.hatch}|${p.misreg}|${lit}|${boxes}`, { x: F.x0 - 20, y: F.y0 - 10, w: fw + 40, h: H - F.y0 + 14 }, (x) => {
      x.save(); x.beginPath(); x.rect(F.x0 - 20, F.y0 - 10, fw + 40, H - F.y0 + 12); x.clip();
      if (p.clouds > 0) moClouds(x, P, I, p);
      if (p.range > 0) moRange(x, P, I, p);
      x.restore();
    });
    const inkSide = P.sun0[0] >= P.tx ? 1 : -1, S = canPaint(ctx) ? graphicShape(env) : null, aspect = S ? (S.box.x1 - S.box.x0) / Math.max(1, S.box.y1 - S.box.y0) : 0, col = S ? moColossusAt(P, aspect, p.colossus) : null;
    if (col && p.colossus > 0) {   // a scene object: the channel graphic as a monument on the horizon, beside the spire (behind it)
      const { cx: cx0, size } = col, [cx, cy] = objAt("colossus", cx0, H - size / 2, ctx), half = (size * aspect) / 2 + 12;
      moLay(ctx, "moColossus", `${ik}|${p.colossus}|${p.hatch}|${p.misreg}|${size.toFixed(1)}|${inkSide}|${JSON.stringify(figureRef(env))}`, { x: cx0 - half, y: H - size - 12, w: half * 2, h: size + 24 }, (x) => moColossus(x, S, cx0, H, size, I, p, cx0 < P.sun0[0] ? 1 : -1, mr), cx - cx0, cy - (H - size / 2), true);
    }
    if (p.tower > 0) {   // a scene object, its handle half way up
      const th = P.spire(p.tower), tl = P.F.x0 + fw / 2 < P.tx ? -1 : 1;   // lit on the side toward the field's middle
      const [cx, cy] = objAt("tower", P.tx, H - th / 2, ctx), half = th * 0.36;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.tower * 4);
      moLay(ctx, "moTower", `${ik}|${th.toFixed(1)}|${p.hatch}|${p.misreg}|${seed}|${tl}`, { x: P.tx - half, y: H - th - 8, w: half * 2, h: th + 12 }, (x) => moTower(x, P.tx, H, th, I, p, tl, mr), cx - P.tx, cy - (H - th / 2), true);
      ctx.restore();
    }
    if (p.land > 0) moLay(ctx, "moLand", `${at}|${ik}|${p.land}|${p.hatch}|${p.misreg}|${lit}|${P.tx.toFixed(0)}|${boxes}`, { x: F.x0 - 10, y: H - u * 0.4, w: fw + 20, h: F.y1 - H + u * 0.4 + 4 }, (x) => { x.save(); x.beginPath(); x.rect(F.x0, H - u * 0.5, fw, F.y1 - H + u * 0.5); x.clip(); moLand(x, P, I, p); x.restore(); });
    if (p.figure > 0) {   // a scene object, its handle at its middle: where moPlan put it, on the path
      const s = fh * (0.03 + 0.06 * p.figure), { x: px, y: py } = P.fig, [fx, fy] = objAt("figure", px, py - s * 0.45, ctx);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.figure * 4); moFigure(ctx, fx, fy + s * 0.45, s, I, mr); ctx.restore();
    }
    const avoid = moAvoid(P, col, aspect);   // what the cave mouth steps back from besides the boxes: the room the sun, the monuments and the figure keep, where they stand unmoved
    if (p.cave > 0) moLay(ctx, "moCave", `${at}|${ik}|${p.cave}|${p.hatch}|${p.misreg}|${boxes}|${avoid.map((b) => [b.x, b.y, b.w, b.h].map(Math.round).join(",")).join(";")}|${env.hasBrand ? 1 : 0}`, { x: 0, y: 0, w, h }, (x) => moCave(x, P, I, p, env, avoid));
    return true;
  },
  /** A printer's registration sheet: fine rules every 80, a target (a circle and its cross) every fourth crossing. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 80;
    gridPen(ctx, color); gridPath(ctx, every(s / 2, w, s), every(s / 2, h, s), 0, 0, w, h);
    ctx.lineWidth = 2.5; ctx.beginPath();
    for (let x = s / 2; x < w; x += s * 4) for (let y = s / 2; y < h; y += s * 4) { ctx.moveTo(x + 13, y); ctx.arc(x, y, 13, 0, TAU); ctx.moveTo(x - 22, y); ctx.lineTo(x + 22, y); ctx.moveTo(x, y - 22); ctx.lineTo(x, y + 22); }
    ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: (C) => css(moInks(values, C).hot), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** The block as a panel of the hot ink: hatched along the edge, the hatching thinning away from it, stippled where it ends. */
    body(ctx, B, nx, ny, C) {
      const I = moInks(values, C), shade = mix(I.hot, I.key, 0.4), d = Math.min(B.w, B.h) * 0.4;
      ctx.save();
      for (const [t0, t1, gap] of [[0, 0.33, 3.2], [0.33, 0.66, 5], [0.66, 1, 7.5]]) {
        ctx.beginPath();
        if (ny) ctx.rect(B.x, ny < 0 ? B.y + d * t0 : B.y + B.h - d * t1, B.w, d * (t1 - t0)); else ctx.rect(nx < 0 ? B.x + d * t0 : B.x + B.w - d * t1, B.y, d * (t1 - t0), B.h);
        moHatch(ctx, -Math.PI / 4, gap, 1.1, shade, 0.45 * clamp((values.hatch ?? 0.75) * 1.4));
      }
      ctx.beginPath(); if (ny) ctx.rect(B.x, ny < 0 ? B.y + d : B.y + B.h - d * 1.25, B.w, d * 0.25); else ctx.rect(nx < 0 ? B.x + d : B.x + B.w - d * 1.25, B.y, d * 0.25, B.h);
      moStipple(ctx, 0.35, shade, 0.5 * clamp((values.hatch ?? 0.75) * 1.4));
      ctx.restore();
    },
    /** Its edge: a key rule along it and a fine rule of the paper inside, as a print's border. */
    edge(ctx, run, nx, ny, C) {
      const I = moInks(values, C), at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.strokeStyle = css(I.key); ctx.lineWidth = 7; at(2);
      ctx.strokeStyle = css(I.dark ? I.glow : I.paper); ctx.lineWidth = 2; at(12);
      ctx.strokeStyle = css(I.key); ctx.lineWidth = 1.5; at(17);
    },
  },
  /**
   * The film title of a screen print: the letters in their ink with a fine inline set in from their edge (moInline), a
   * key line round them (the outline slider), and their shadow a second plate printed off register in the lit ink (the
   * shadow slider). The highlighted words in the hot ink, inline and all.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const I = moInks(p, o.C), fs = o.fs, s = Math.min(2, o.shadowAmt || 0), k = o.strokeAmt || 0, face = o.fill || I.title, light = lum(face) > 0.45;
    let hot = o.hi || I.hot;
    if (!o.hi && !I.dark) for (let i = 0; i < 10 && lum(hot) > 0.34; i++) hot = mix(hot, [42, 20, 12], 0.1);   // on the cream, the hot ink deep enough to read (its hue kept)
    const line = o.fill ? (light ? I.key : I.paper) : I.titleLine;
    const chars = [];
    let cx = 0;
    pass((a, at) => { cx = at; for (const t of a.t) { const w = ctx.measureText(t).width; chars.push({ t, hi: a.hi, x: cx, s: a.s, dy: a.dy || 0 }); cx += w; } });
    const each = (fn, only) => { for (const c of chars) if (only === undefined || c.hi === only) inPiece(c, () => fn(c, c.x)); };
    ctx.lineJoin = "round";
    if (s > 0) { const [dx, dy] = fall(fs * 0.04 * s, fs * 0.045 * s); ctx.fillStyle = css(I.titleShade, 0.95); each((c, x) => ctx.fillText(c.t, x + dx, dy)); }   // the second plate, off register
    if (k > 0) { ctx.strokeStyle = css(I.dark ? I.key : line); ctx.lineWidth = fs * 0.07 * k; each((c, x) => ctx.strokeText(c.t, x, 0)); }
    const B = !fast && canPaint(ctx) ? dkBox(ctx, fs, cx) : null;
    if (!B) { each((c, x) => { ctx.fillStyle = css(c.hi ? hot : face); ctx.fillText(c.t, x, 0); }); return; }
    if (chars.some((c) => !c.hi)) moInline(ctx, B, fs, each, face, line, false);
    if (chars.some((c) => c.hi)) moInline(ctx, B, fs, each, hot, light ? I.key : line, true);
  },
  // objects printed in the inks: faces in the set's light, mid and dark inks, colours to the nearest of the lit and hot inks, fine key lines; the small parts as they are
  wrap: (ctx, C, p, plates) => {
    if (plates) return ctx;
    const I = moInks(p, C), near = (c) => { const a = Math.hypot(c[0] - I.lit[0], c[1] - I.lit[1], c[2] - I.lit[2]), b = Math.hypot(c[0] - I.hot[0], c[1] - I.hot[1], c[2] - I.hot[2]), q = Math.hypot(c[0] - I.cool[0], c[1] - I.cool[1], c[2] - I.cool[2]); return a <= b && a <= q ? I.lit : b <= q ? I.hot : I.cool; };
    return mapped(ctx, { fill: { ink: I.key, light: I.dark ? I.glow : I.paper, mid: I.cool, dark: I.deep, colour: near }, stroke: { ink: I.key, light: I.dark ? I.glow : I.paper }, line: 0.6 });
  },
  sticker: painters({ line: [24, 17, 34], lineScale: 0.45, tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const I = moInks(values, [234, 110, 38]); const r = role(c); return css(r === "ink" ? I.key : r === "light" ? I.paper : r === "mid" ? I.cool : r === "dark" ? I.deep : mix(c, I.lit, 0.35), c[3]); }, shadow(ctx, draw) { ctx.save(); ctx.translate(...fall(6, 7)); draw(css(moInks(values, [234, 110, 38]).deep, 0.9)); ctx.restore(); } }),
  /** The corner tag: a cartouche with its corners cut, in the key ink, a fine rule of the lit ink inside it, its capitals spaced in the glow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const I = moInks(p, C), f = fs * 0.66;
    ctx.font = `700 ${f}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 5) + f * 1.6, hh = f * 1.7, top = y + (fs * 1.34 - hh), c = f * 0.32;
    const cut = (d) => [[x + c + d, top + d], [x + w - c - d, top + d], [x + w - d, top + c + d], [x + w - d, top + hh - c - d], [x + w - c - d, top + hh - d], [x + c + d, top + hh - d], [x + d, top + hh - c - d], [x + d, top + c + d]];
    ctx.save(); ctx.translate(...fall(4, 5)); shapeOf(ctx, cut(0)); ctx.fillStyle = css(I.lit); ctx.fill(); ctx.restore();   // the lit plate off register behind it
    ctx.save();
    shapeOf(ctx, cut(0)); ctx.fillStyle = css(I.dark ? I.key : I.deep); ctx.fill();
    shapeOf(ctx, cut(5)); ctx.strokeStyle = css(I.lit); ctx.lineWidth = 1.6; ctx.lineJoin = "miter"; ctx.stroke();
    ctx.fillStyle = ink || css(I.dark ? I.glow : I.paper); spaced(ctx, str, x + f * 0.8, top + hh * 0.5 + f * 0.34, 5);
    ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 14, h: hh + 14 };
  },
  /** The frame layer: an Art Deco border of fine double rules round the print, stepped in at each corner, a ring and a diamond in the corner, a small sun at the head. */
  frame(ctx, env, p) {
    const a = p.border;
    if (a <= 0) return;
    const { w, h } = env, I = moInks(p, env.C), col = I.dark ? I.glow : I.key, b = 22, g = 7, s = 18 + 16 * a;
    ctx.save(); ctx.globalAlpha = Math.min(1, a * 2.5); ctx.strokeStyle = css(col, 0.9); ctx.lineJoin = "miter"; ctx.lineCap = "butt";
    const rect = (d, step) => {
      const X0 = b + d, Y0 = b + d, X1 = w - b - d, Y1 = h - b - d, st = step;
      ctx.beginPath();
      ctx.moveTo(X0 + st, Y0); ctx.lineTo(X1 - st, Y0); ctx.lineTo(X1 - st, Y0 + st); ctx.lineTo(X1, Y0 + st); ctx.lineTo(X1, Y1 - st); ctx.lineTo(X1 - st, Y1 - st); ctx.lineTo(X1 - st, Y1);
      ctx.lineTo(X0 + st, Y1); ctx.lineTo(X0 + st, Y1 - st); ctx.lineTo(X0, Y1 - st); ctx.lineTo(X0, Y0 + st); ctx.lineTo(X0 + st, Y0 + st); ctx.closePath();
    };
    const r = 5 + 4 * a, suns = a > 0.35 ? [b, h - b] : [];
    ctx.save();
    if (suns.length) { ctx.beginPath(); ctx.rect(-10, -10, w + 20, h + 20); for (const cy of suns) ctx.rect(w / 2 + r * 4.2, cy - 16, -r * 8.4, 32); ctx.clip("evenodd"); }   // the rules broken where the suns sit
    rect(0, s); ctx.lineWidth = 2.4; ctx.stroke();
    rect(g, s - g); ctx.lineWidth = 1.1; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = css(col, 0.9);
    for (const [cx, cy] of [[b + s / 2, b + s / 2], [w - b - s / 2, b + s / 2], [w - b - s / 2, h - b - s / 2], [b + s / 2, h - b - s / 2]]) {
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.3, 0, TAU); ctx.lineWidth = 1.4; ctx.stroke();
      shapeOf(ctx, [[cx, cy - s * 0.16], [cx + s * 0.16, cy], [cx, cy + s * 0.16], [cx - s * 0.16, cy]]); ctx.fill();
    }
    for (const cy of suns) {   // a small sun at the head and the foot of the border, rays and all
      const cx = w / 2;
      ctx.fillStyle = css(col, 0.9); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
      ctx.beginPath(); for (let i = 0; i < 12; i++) { const t = (i / 12) * TAU; ctx.moveTo(cx + Math.cos(t) * r * 1.5, cy + Math.sin(t) * r * 1.5); ctx.lineTo(cx + Math.cos(t) * r * (i % 2 ? 2.1 : 2.8), cy + Math.sin(t) * r * (i % 2 ? 2.1 : 2.8)); }
      ctx.lineWidth = 1.2; ctx.stroke();
    }
    ctx.restore();
  },
  /** The plate under a text layer: a slab of the deep ink with its corners cut, a fine rule of the lit ink inside, the lit plate off register behind. */
  plate(ctx, x, y, w, h, colour, fs) {
    const I = moInks(values, [234, 110, 38]), c = Math.min(h * 0.3, fs * 0.25), pts = (d) => [[x + c + d, y + d], [x + w - c - d, y + d], [x + w - d, y + c + d], [x + w - d, y + h - c - d], [x + w - c - d, y + h - d], [x + c + d, y + h - d], [x + d, y + h - c - d], [x + d, y + c + d]];
    ctx.save(); ctx.translate(...fall(fs * 0.05, fs * 0.06)); shapeOf(ctx, pts(0)); ctx.fillStyle = css(I.lit, 0.9); ctx.fill(); ctx.restore();
    shapeOf(ctx, pts(0)); ctx.fillStyle = colour; ctx.fill();
    shapeOf(ctx, pts(fs * 0.07)); ctx.lineWidth = Math.max(1, fs * 0.018); ctx.strokeStyle = css(I.dark ? I.glow : I.key, 0.8); ctx.lineJoin = "miter"; ctx.stroke();
  },
  image(ctx, C, unit) { const I = moInks(values, C); ctx.shadowColor = css(I.deep, 0.95); ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 7 * unit; },
  /** The paper: its grain, and specks where the ink did not take (the paper's own colour through the solids). */
  post(ctx, w, h, C, p, unit = 1) {
    const a = p.paper;
    if (a <= 0) return;
    const I = moInks(p, C);
    grain(ctx, a * (dark ? 0.45 : 0.4) * clamp(0.35 + unit * 1.1), unit, !dark);
    wear(ctx, w, h, I.dark ? mix(I.night, I.glow, 0.25) : I.paper, a * 0.32, "lighten");
  },
  prompt: `Objects from a limited-edition screen-printed fantasy or film poster — epic, mysterious, finely drawn — that read at a glance:
- one clear object per sticker (a crystal, an ancient key, a lantern, a compass, a sword in stone, a starship, a moon, a temple door, a winged statue, a skull, a spire), with a strong, elegant silhouette and a few clear facets; no realism, no gradients;
- flat colour only, as if printed in four to six inks: an indigo or violet for shadows, a burnt orange or gold for the lit side, cream for highlights, and the main colour for one hot accent;
- the app adds fine dark key lines and an off-register shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from an epic fantasy or sci-fi landscape, built as simple models from a few boxes and cylinders — a monolith, a stepped temple, an obelisk, a gate, a watchtower, a rover, a lantern on a post; no realism, no fine detail.
- the renderer paints faces in flat inks with fine dark lines: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep indigo, and "main" the hot ink (the channel colour) — use it for one to three parts.`,
};
/** The graphic the colossus is drawn from, as a key (the figure put in its place, or the channel graphic). */
const figureRef = (env) => (env.figure ? env.figure.ref : env.graphic ? env.graphic.ref : null);

mondo.elementFx = [
  { key: "print", name: { zh: "丝网分色", en: "Screen-print inks" }, for: FX_PHOTO, stage: "filter",
    /** The photo printed in the look's five inks, hatched in its shadows and stippled in its lights (see moPixels). */
    paint(x, B, a, E) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); moPixels(img.data, B.w, B.h, moInks(values, E.C, true), a, values.hatch ?? 0.75); x.putImageData(img, B.x0, B.y0); } },
  { key: "hatch", name: { zh: "排线雕刻", en: "Hatch engraving" }, for: FX_ALL, stage: "filter",
    /** Lines of the key ink laid into the layer by its own lightness: none in its lights, a hatch in its half-tones, crossed in its shadows — an engraver's line. */
    paint(x, B, a, E) {
      const img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data, key = moInks(values, E.C, dark).key, gap = Math.max(3, 4.2 * E.k), cs = Math.SQRT1_2 / gap;
      for (let y = 0, o = 0; y < B.h; y++) for (let xx = 0; xx < B.w; xx++, o += 4) {
        if (!d[o + 3]) continue;
        const l = (d[o] * 54 + d[o + 1] * 183 + d[o + 2] * 19) / 65280, X = xx + B.x0, Y = y + B.y0, u1 = (X + Y) * cs, t1 = Math.abs((u1 - Math.floor(u1)) * 2 - 1);
        let ink = t1 < (1 - l) * 0.9 - 0.15;
        if (!ink && l < 0.4) { const u2 = (X - Y) * cs, t2 = Math.abs((u2 - Math.floor(u2)) * 2 - 1); ink = t2 < (0.4 - l) * 1.6; }
        if (ink) { d[o] += (key[0] - d[o]) * a; d[o + 1] += (key[1] - d[o + 1]) * a; d[o + 2] += (key[2] - d[o + 2]) * a; }
      }
      x.putImageData(img, B.x0, B.y0);
    } },
  { key: "misreg", name: { zh: "套色错位", en: "Off register" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 14 * k, t: 14 * k, r: 14 * k, b: 14 * k }),
    /** The layer printed twice more behind itself, off register: once in the hot ink down to one side, once in the deep ink up to the other. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), I = moInks(values, E.C, dark), d = (3 + 9 * a) * E.k;
      x.save(); x.globalCompositeOperation = "destination-over";
      x.drawImage(shapeIn(src, I.hot, "fxMoA"), B.x0 + d, B.y0 + d * 0.8);
      x.globalAlpha = 0.9; x.drawImage(shapeIn(src, I.deep, "fxMoB"), B.x0 - d * 0.6, B.y0 - d * 0.5);
      x.restore();
    } },
];
