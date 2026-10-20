// Text effects: how the letters of a headline are painted. An effect belongs to a layer (the title,
// or a text layer in its headline look); "auto" leaves the choice to the current look.
//
// Three kinds, by what they can change:
//   passes    the same line of text painted several times in different colours and places — outlines,
//             shadows, echoes. The looks' own letterings are of this kind; "auto" takes the current look's.
//   mask      the letters are first painted alone on a spare canvas, which is then worked on —
//             filled with a pattern, worn away, shaded inside, cut into rows — and laid down.
//   outline   the letters' outlines are fetched as points (see outlines.js) and given real depth.
// A bend (BENDS: arched, on a circle, wave…) is apart from the lettering, and goes with any of them: the
// line is painted as it would be, on a canvas of its own, and that picture is bent (bentLine, meshWarp).
//
// Every effect is painted through paintRuns(ctx, pass, o, id): `pass(fn)` calls fn(run, x) for
// each run {t, hi} of the current line, the context being placed on that line's baseline, and `o`
// carries sizes and colours:
//   fs          type size                         amt        the layer's "strength" for the effect (1 = normal)
//   strokeAmt   outline weight (0 = none)         shadowAmt  shadow / depth
//   fillCss / hiCss / inkCss / shadowCss / hiShadowCss   the colours of plain words, highlighted words,
//                                                 the keyline and the two shadows
//   C, fill, hi the channel colour and the layer's own colours as [r, g, b] (for the looks' letterings)
//   hiPlate     the layer has plates under its highlighted words: a lettering that boxes them itself does not
//   lineW       width of the line                 unit       canvas pixels per unit
//   seed        a number that differs from line to line, for effects that scatter things
//   frame       where this line sits in its block, for effects that shape the whole block (the
//               perspective): {ox, oy, c, box} — the line's origin and slant (x' = x + c·y) in the
//               block's space, and the block {x, y, w, h} there
//   warp        the layer's own perspective, if it has one: the block's four corners moved by
//               [[dx, dy] × 4] (top left, top right, bottom right, bottom left), in block widths and heights
import { LOOKS, look, lookValues, lookState, lookParams, isFast } from "./style.js";
import { outline } from "./outlines.js";

/**
 * id -> { name: {zh, en}, kind, menu? }: `kind` how it is painted, `menu` the group it is listed under when
 * not its kind's (Extruded is drawn from outlines but looks like the layered letterings, a shadow grown
 * into depth, so it is listed with them). The order is the order of the menu: the typesetting effects, and the
 * editorial look's Underlined highlight, which marks the highlighted words and so has to be lettering.
 * (Sliced, Overprint, Double keyline and Sunlit block were once here too; what they do is their looks'
 * post effects now, for any layer. A layer that still names one is painted as "auto".)
 */
export const EFFECTS = {
  auto: { name: { zh: "自动（跟随风格）", en: "Automatic (follows the look)" }, kind: "passes" },
  cel: { name: { zh: "描边加投影", en: "Outline and shadow" }, kind: "passes" },
  plain: { name: { zh: "纯文字", en: "Plain" }, kind: "passes" },
  bluenote: { name: { zh: "纯文字（不倾斜）", en: "Plain, upright" }, kind: "passes" },
  editorial: { name: { zh: "下划线强调", en: "Underlined highlight" }, kind: "passes" },
  dots: { name: { zh: "字内网点", en: "Halftone inside" }, kind: "mask" },
  stripes: { name: { zh: "字内条纹", en: "Stripes inside" }, kind: "mask" },
  inner: { name: { zh: "内阴影", en: "Inner shadow" }, kind: "mask" },
  worn: { name: { zh: "磨损", en: "Worn" }, kind: "mask" },
  rows: { name: { zh: "逐行错位", en: "Row shift" }, kind: "mask" },
  extrude: { name: { zh: "立体挤出", en: "Extruded" }, kind: "outline", menu: "passes" },
};
/**
 * id -> { name }: the bends a headline may be given (its `bend`, how far: `bendAmt`), whatever its
 * lettering. Each is a map of WARP (taper: the layer's own perspective, `warp`, when it has one). They
 * were once outline effects themselves, painted in the house lettering (see normalizeLayer in layers.js).
 */
export const BENDS = {
  arc: { name: { zh: "拱形", en: "Arched" } },
  arcLow: { name: { zh: "下弧", en: "Arc down" } },
  circle: { name: { zh: "圆弧", en: "On a circle" } },
  shell: { name: { zh: "上拱", en: "Arched top" } },
  bulge: { name: { zh: "鼓起", en: "Bulge" } },
  pinch: { name: { zh: "收腰", en: "Pinch" } },
  fisheye: { name: { zh: "鱼眼", en: "Fisheye" } },
  rise: { name: { zh: "上扬", en: "Rise" } },
  taper: { name: { zh: "透视收缩", en: "Tapered" } },
  wave: { name: { zh: "波浪", en: "Wave" } },
  flag: { name: { zh: "旗帜", en: "Flag" } },
};

const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const spare = [];
/** A spare canvas the size of `like`, cleared. */
function scratch(i, like) {
  const c = spare[i] || (spare[i] = document.createElement("canvas"));
  if (c.width !== like.width || c.height !== like.height) { c.width = like.width; c.height = like.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, c.width, c.height);
  return x;
}
/** The house lettering: an offset shadow, an ink keyline, the fill. Also the base of the mask effects. */
function house(ctx, pass, o, fillToo = true) {
  const { fs, d } = o;
  if (d > 0) pass((a, x) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiShadowCss : o.shadowCss; ctx.lineWidth = fs * 0.04; ctx.strokeText(a.t, x + d, d); ctx.fillText(a.t, x + d, d); });
  if (o.strokeAmt > 0) pass((a, x) => { ctx.strokeStyle = o.inkCss; ctx.lineWidth = fs * 0.075 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
  if (fillToo) pass((a, x) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiCss : o.fillCss; ctx.lineWidth = fs * 0.018; ctx.strokeText(a.t, x, 0); ctx.fillText(a.t, x, 0); });
}

// ---------- mask effects
/** Whether a real canvas is behind the context (not the throw-away one used for measuring, and not a test double). */
const real = (ctx) => typeof document !== "undefined" && ctx.canvas && !ctx.canvas._probe && typeof ctx.getTransform === "function";
/** Paints the line's letters alone on a spare canvas, in place, and returns that canvas's context. */
function letters(ctx, pass, o, i = 0) {
  const x = scratch(i, ctx.canvas);
  x.setTransform(ctx.getTransform()); x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;
  pass((a, at) => { x.fillStyle = a.hi ? o.hiCss : o.fillCss; x.fillText(a.t, at, 0); });
  return x;
}
const lay = (ctx, from) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(from.canvas, 0, 0); ctx.restore(); };
const MASK = {
  /** Halftone inside the letters, growing toward their feet. */
  dots(ctx, x, o) {
    const fs = o.fs, pitch = fs * 0.085;
    x.globalCompositeOperation = "source-atop"; x.fillStyle = o.inkCss; x.beginPath();
    let row = 0;
    for (let y = -fs * 0.98; y < fs * 0.3; y += pitch * 0.5, row++) for (let px = -fs * 0.2 + (row % 2) * pitch * 0.5; px < o.lineW + fs * 0.2; px += pitch) {
      const r = Math.min(1, Math.max(0, (y + fs * 0.75) / (fs * 0.85))) * pitch * 0.5 * Math.min(1.4, o.amt);
      if (r > 0.6) { x.moveTo(px + r, y); x.arc(px, y, r, 0, Math.PI * 2); }
    }
    x.fill();
  },
  /** Slanted stripes inside the letters. */
  stripes(ctx, x, o) {
    const fs = o.fs, gap = fs * 0.17, wide = gap * 0.42 * Math.min(1.8, o.amt);
    x.globalCompositeOperation = "source-atop"; x.fillStyle = o.inkCss; x.beginPath();
    for (let px = -fs * 1.6; px < o.lineW + fs * 0.4; px += gap) { x.moveTo(px, fs * 0.3); x.lineTo(px + wide, fs * 0.3); x.lineTo(px + wide + fs * 1.3, -fs); x.lineTo(px + fs * 1.3, -fs); x.closePath(); }
    x.fill();
  },
  /** Bits of the letters missing, as on a print that has seen use: specks, and a scratch or two. */
  worn(ctx, x, o) {
    const fs = o.fs, n = Math.round((o.lineW / fs) * 70 * o.amt);
    x.globalCompositeOperation = "destination-out"; x.fillStyle = "#000";
    for (let k = 0; k < n; k++) {
      const px = noise(k * 1.31 + o.seed) * o.lineW, py = -fs * 0.95 + noise(k * 2.17 + o.seed) * fs * 1.2, r = fs * (0.006 + noise(k * 3.3 + o.seed) ** 3 * 0.05);
      x.beginPath(); x.ellipse(px, py, r * (1 + noise(k * 5.1) * 2), r, noise(k * 7.7) * 3, 0, Math.PI * 2); x.fill();
    }
    for (let k = 0; k < Math.round(2 * o.amt); k++) { const py = -fs * 0.85 + noise(k * 9.1 + o.seed) * fs; x.fillRect(noise(k * 4.4 + o.seed) * o.lineW * 0.6, py, o.lineW * (0.2 + noise(k * 6.6) * 0.4), Math.max(1, fs * 0.008)); }
  },
  /** A shadow falling inside the letters from their upper left edge, as if they were cut into the surface. */
  inner(ctx, x, o) {
    const d = o.fs * 0.045 * o.amt * o.unit, s = scratch(1, ctx.canvas);
    s.drawImage(x.canvas, 0, 0);
    s.globalCompositeOperation = "source-in"; s.fillStyle = o.inkCss; s.fillRect(0, 0, s.canvas.width, s.canvas.height);   // the letters, in ink
    s.globalCompositeOperation = "destination-out"; s.drawImage(x.canvas, d, d);                                          // less the letters moved down and right
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.6; x.drawImage(s.canvas, 0, 0); x.restore();
  },
};
function masked(ctx, pass, o, id) {
  if (!real(ctx)) return house(ctx, pass, o);
  if (id === "rows") {   // the keyline is part of what gets cut up
    const x = letters(ctx, () => {}, o);
    house(x, pass, o);
    const m = ctx.getTransform(), top = m.b * 0 + m.d * (-o.fs * 1.1) + m.f, foot = m.d * (o.fs * 0.4) + m.f, band = Math.max(3, o.fs * 0.1 * o.unit), W = ctx.canvas.width;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = Math.floor(Math.min(top, foot)), k = 0; y < Math.max(top, foot); y += band, k++) {
      const dx = (noise(k * 3.7 + o.seed) - 0.5) * 2 * o.fs * 0.07 * o.amt * o.unit * (noise(k * 1.9 + o.seed) > 0.45 ? 1 : 0);
      ctx.drawImage(x.canvas, 0, y, W, band, dx, y, W, band);
    }
    ctx.restore();
    return;
  }
  house(ctx, pass, o, false);                      // shadow and keyline as usual, underneath
  const x = letters(ctx, pass, o);
  MASK[id](ctx, x, o);
  lay(ctx, x);
}

// ---------- outline effects
/** The outline of a run, placed and sized: closed polylines of [x, y] in the line's own units. Null while it is on its way, false if not to be had. */
function contours(ctx, a, at, o) {
  const glyphs = outline(ctx.font, a.t);
  if (!glyphs) return glyphs;
  const total = glyphs.reduce((s, g) => s + g.adv, 0), k = total > 0 ? ctx.measureText(a.t).width / (total * o.fs) : 1;   // fit the width the canvas gives the run
  const out = [], step = o.fs * 0.06;
  let pen = at;
  for (const g of glyphs) {
    for (const c of g.c) {
      const pts = [];
      for (let i = 0; i < c.length; i += 2) {
        const x = pen + c[i] * o.fs * k, y = c[i + 1] * o.fs, j = (i + 2) % c.length, nx = pen + c[j] * o.fs * k, ny = c[j + 1] * o.fs;
        pts.push([x, y]);
        const n = Math.min(24, Math.floor(Math.hypot(nx - x, ny - y) / step));   // long straight edges get points along them, so they can bend
        for (let s = 1; s < n; s++) pts.push([x + ((nx - x) * s) / n, y + ((ny - y) * s) / n]);
      }
      out.push(pts);
    }
    pen += g.adv * o.fs * k;
  }
  return out;
}
const trace = (ctx, shapes) => { ctx.beginPath(); for (const pts of shapes) { pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); } };
/**
 * The bends of the outline effects, each a map of a point of the line ([x, y]: x from 0 at its start to
 * `lineW`, y up from the baseline, negative) made from `o`; `amt` is how far it goes. `mid` is about the
 * middle of the letters' height, `u` where along the line x is (−1 at its start, 1 at its end, and no
 * further: what a lettering throws past the ends, a glow or a shadow, keeps the ends' bend rather than
 * flying off with a curve carried on past them). The bends are applied round the line too.
 */
const mid = (o) => -o.fs * 0.36;
const along = (o) => { const half = Math.max(1, o.lineW / 2); return (x) => Math.max(-1, Math.min(1, (x - half) / half)); };
export const WARP = {
  arc: (o) => { const lift = o.fs * 0.32 * o.amt, u = along(o); return ([x, y]) => [x, y - lift * (1 - u(x) ** 2) + lift * 0.45]; },
  /** The arch the other way: the middle of the line dips. */
  arcLow: (o) => { const lift = o.fs * 0.32 * o.amt, u = along(o); return ([x, y]) => [x, y + lift * (1 - u(x) ** 2) - lift * 0.45]; },
  /** The line laid round a circle whose centre is below it: the letters fan out, wider at the top. */
  circle: (o) => {
    const span = Math.min(2.4, Math.max(0.05, 0.62 * o.amt)), half = Math.max(1, o.lineW / 2), R = Math.max(o.fs, o.lineW / span);
    const lift = R * (1 - Math.cos(Math.min(Math.PI, half / R))) * 0.45;   // the ends drop: the whole a little up, so it stays about where it was
    return ([x, y]) => { const a = (x - half) / R, r = Math.max(R * 0.2, R - y); return [half + r * Math.sin(a), R - r * Math.cos(a) - lift]; };   // nothing through the centre
  },
  /** The baseline straight, the tops of the letters arching up toward the middle. */
  shell: (o) => { const k = 0.45 * o.amt, u = along(o); return ([x, y]) => [x, y < 0 ? y * (1 + k * (1 - u(x) ** 2)) : y]; },
  /** The letters taller toward the middle of the line, above and below. */
  bulge: (o) => { const k = 0.38 * o.amt, u = along(o), m = mid(o); return ([x, y]) => [x, m + (y - m) * (1 + k * (1 - u(x) ** 2))]; },
  /** The letters shorter toward the middle of the line. */
  pinch: (o) => { const k = Math.min(0.7, 0.32 * o.amt), u = along(o), m = mid(o); return ([x, y]) => [x, m + (y - m) * (1 - k * (1 - u(x) ** 2))]; },
  /**
   * A lens over the middle of the line: what is under it larger, easing off toward its rim, which lies a
   * little past the ends of the line and the letters' height, so the ends move out only a little and the
   * letters near them are not squeezed thin. Along every ray from the middle the points keep their order
   * (the stretch along it, 1 + k(1 − s)(1 − 5s) at s = r², is at least 1 − 0.8k), so nothing folds over.
   */
  fisheye: (o) => {
    const k = Math.min(0.45, 0.4 * o.amt), half = Math.max(1, o.lineW / 2), rx = half * 1.15, m = mid(o), ry = o.fs * 1.1;
    return ([x, y]) => { const dx = x - half, dy = y - m, s = (dx / rx) ** 2 + (dy / ry) ** 2; if (s >= 1) return [x, y]; const f = 1 + k * (1 - s) ** 2; return [half + dx * f, m + dy * f]; };
  },
  /** The line climbing to the right, its upright strokes kept upright. */
  rise: (o) => { const half = Math.max(1, o.lineW / 2), slope = Math.min(0.3, (0.55 * o.fs * o.amt) / Math.max(o.fs, o.lineW)); return ([x, y]) => [x, y - slope * (x - half)]; },
  taper: (o) => { const k = Math.min(0.75, 0.42 * o.amt), mid = -o.fs * 0.36, W = Math.max(1, o.lineW); return ([x, y]) => { const s = 1 - k * Math.max(0, Math.min(1, x / W)); return [x, mid + (y - mid) * s]; }; },
  wave: (o) => { const lift = o.fs * 0.11 * o.amt, len = o.fs * 2.4; return ([x, y]) => [x, y + lift * Math.sin((x / len) * Math.PI * 2)]; },
  /** A flag on its pole at the start of the line: it waves more the further from the pole, swelling and narrowing as it goes. */
  flag: (o) => {
    const lift = o.fs * 0.14 * o.amt, len = o.fs * 3.2, m = mid(o), W = Math.max(1, o.lineW);
    return ([x, y]) => { const ramp = 0.25 + 0.75 * Math.min(1, Math.max(0, x / W)), a = (x / len) * Math.PI * 2; return [x, m + (y - m) * (1 + 0.12 * o.amt * ramp * Math.cos(a)) + lift * ramp * Math.sin(a)]; };
  },
};
/** The corners a block's perspective moves to, as fractions of its size: the layer's own, or the plain taper's. */
export function warpCorners(warp, amt = 1) {
  if (Array.isArray(warp) && warp.length === 4) return warp;
  const k = Math.min(0.75, 0.42 * amt) * 0.4;   // about what the plain taper does to a single line
  return [[0, 0], [0, k], [0, -k], [0, 0]];
}
/**
 * Whether the block's corners moved by `warp` (as warpCorners gives them) still make a quad that does not
 * fold over: every corner turning the same way, and not by too little (no edge shrunk to about a point). A
 * folded one would throw the lettering past the perspective's horizon.
 */
export function convexWarp(warp) {
  const q = warp.map(([dx, dy], i) => [[0, 1, 1, 0][i] + dx, [0, 0, 1, 1][i] + dy]);
  const turns = q.map((p, i) => { const a = q[(i + 1) % 4], b = q[(i + 2) % 4]; return (a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0]); });
  return turns.every((t) => t > 0.1) || turns.every((t) => t < -0.1);
}
/** The projective map of the unit square onto quad q (corners in the order top left, top right, bottom right, bottom left). */
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((dx3 || dy3) && Math.abs(den) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v) => { const w = Math.max(0.05, g * u + h * v + 1); return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
}
/** The layer's own perspective as a point map in the line's space (see `frame` and `warp` above). */
function perspective(o) {
  const { ox, oy, c, box } = o.frame, W = Math.max(1, box.w), H = Math.max(1, box.h);
  const map = squareToQuad(o.warp.map(([dx, dy], i) => [box.x + ([0, 1, 1, 0][i] + dx) * W, box.y + ([0, 0, 1, 1][i] + dy) * H]));
  return ([x, y]) => {
    const X = ox + x + c * y, Y = oy + y;                          // into the block's space
    const [X2, Y2] = map((X - box.x) / W, (Y - box.y) / H);
    const y2 = Y2 - oy;
    return [X2 - ox - c * y2, y2];                                 // and back
  };
}
function outlined(ctx, pass, o, id) {
  const runs = [];
  let ready = true;
  pass((a, at) => { const c = contours(ctx, a, at, o); if (!c) ready = false; if (c === null) stopgaps++; runs.push([a, c]); });
  if (!ready) return house(ctx, pass, o);          // not arrived yet, or not to be had: ordinary lettering meanwhile
  ctx.lineJoin = "round";
  if (id === "extrude") {
    // Real depth: every edge of the outline is swept back into a wall. Walls facing one way are
    // lit and those facing the other shaded, and each group is filled as one shape.
    const d = o.fs * 0.11 * o.amt * Math.max(0.3, o.shadowAmt), dx = d, dy = d * 0.85;
    for (const [a, shapes] of runs) {
      const lit = [], shade = [];
      for (const pts of shapes) for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        ((q[0] - p[0]) * dy - (q[1] - p[1]) * dx > 0 ? lit : shade).push([p, q, [q[0] + dx, q[1] + dy], [p[0] + dx, p[1] + dy]]);
      }
      const base = a.hi ? o.hiShadowCss : o.shadowCss;
      for (const [walls, alpha] of [[shade, 1], [lit, 0.72]]) {
        ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = ctx.strokeStyle = base; ctx.lineWidth = 1; trace(ctx, walls); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(dx, dy); ctx.fillStyle = ctx.strokeStyle = base; ctx.lineWidth = 1; trace(ctx, shapes); ctx.fill(); ctx.stroke(); ctx.restore();   // the back face
    }
  }
  for (const [a, bent] of runs) {
    if (id !== "extrude" && o.d > 0) { ctx.save(); ctx.translate(o.d, o.d); ctx.fillStyle = a.hi ? o.hiShadowCss : o.shadowCss; trace(ctx, bent); ctx.fill(); ctx.restore(); }
    trace(ctx, bent);
    if (o.strokeAmt > 0) { ctx.strokeStyle = o.inkCss; ctx.lineWidth = o.fs * 0.075 * o.strokeAmt; ctx.stroke(); }
    ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fill();
  }
}

// ---------- bends
/**
 * The map of a bend over the line's points (see WARP; `o` as paintRuns', `o.amt` how far): the layer's own
 * perspective for "taper" when it has corners of its own, else the bend's. Null when there is none.
 */
export function bendMap(id, o) {
  if (id === "taper" && o.warp && o.frame) return perspective(o);
  return WARP[id] ? WARP[id](o) : null;
}
/** How far a line `lineW` wide set at `fs` reaches past its own box once bent ({up, down, left, right}, in units, never below 0): the image of the box's edge. */
export function bendExtent(id, amt, lineW, fs) {
  const map = WARP[id] && WARP[id]({ fs, amt, lineW });
  const out = { up: 0, down: 0, left: 0, right: 0 };
  if (!map) return out;
  const top = -fs * 0.92, foot = fs * 0.25, n = 40;
  const seen = (x, y) => { const [X, Y] = map([x, y]); out.up = Math.max(out.up, top - Y); out.down = Math.max(out.down, Y - foot); out.left = Math.max(out.left, -X); out.right = Math.max(out.right, X - lineW); };
  for (let i = 0; i <= n; i++) { const x = (lineW * i) / n, y = top + ((foot - top) * i) / n; seen(x, top); seen(x, foot); seen(0, y); seen(lineW, y); }
  return out;
}
/**
 * A picture bent: `src` ({data, width, height}, RGBA as getImageData gives it) shows the rectangle `rect`
 * of the line's space ({x, y, w, h}) at `k` pixels a unit; `map` takes a point of the line to where it
 * goes. Returns the bent picture likewise ({data, width, height, rect}), its rectangle the image of the
 * source's. The source is cut into triangles a cell (in pixels) across; each pixel of the result is read
 * back through the triangle it falls in to its place in the source, and sampled there between the four
 * pixels round it — colours weighted by their opacity, so edges keep no dark fringe. Every pixel written
 * once and from one place, so the triangles leave no seams. Cells with nothing in them (with a cell
 * round them, for the sampling) are passed over, and where they go does not count. A map that throws
 * the picture very far (a perspective dragged past its horizon) gets a coarser result, not a huge one.
 */
const WARP_PX = 24e6, WARP_SIDE = 8192;
export function meshWarp(src, rect, k, map, cell = 16) {
  const { data: S, width: sw, height: sh } = src;
  const nx = Math.max(1, Math.ceil(sw / cell)), ny = Math.max(1, Math.ceil(sh / cell));
  // which cells have anything in them
  const full = new Uint8Array(nx * ny);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (S[(y * sw + x) * 4 + 3]) full[((y / cell) | 0) * nx + ((x / cell) | 0)] = 1;
  const near = (i, j) => { for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) if (full[b * nx + a]) return true; return false; };
  // the grid's points, in the line's space before and after
  const at = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const px = Math.min(sw, i * cell), py = Math.min(sh, j * cell), lx = rect.x + px / k, ly = rect.y + py / k, [X, Y] = map([lx, ly]);
    at.push({ px, py, X, Y });
  }
  const pt = (i, j) => at[j * (nx + 1) + i];
  // the cells to bend, and where their corners go
  const cells = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!near(i, j)) continue;
    cells.push([i, j]);
    for (const p of [pt(i, j), pt(i + 1, j), pt(i, j + 1), pt(i + 1, j + 1)]) { x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X); y1 = Math.max(y1, p.Y); }
  }
  if (!cells.length) return { data: new Uint8ClampedArray(4), width: 1, height: 1, rect: { x: rect.x, y: rect.y, w: 1 / k, h: 1 / k } };
  const spanX = Math.max(1e-6, x1 - x0), spanY = Math.max(1e-6, y1 - y0);
  const ko = Math.min(k, Math.sqrt(WARP_PX / (spanX * spanY)), WARP_SIDE / spanX, WARP_SIDE / spanY);   // the result's pixels a unit
  const W = Math.max(1, Math.ceil(spanX * ko)), H = Math.max(1, Math.ceil(spanY * ko)), D = new Uint8ClampedArray(W * H * 4);
  const sample = (sx, sy, o) => {   // between the four pixels round (sx, sy), in source pixel centres
    const fx = Math.min(sw - 1, Math.max(0, sx - 0.5)), fy = Math.min(sh - 1, Math.max(0, sy - 0.5)), ix = Math.min(sw - 2, fx | 0), iy = Math.min(sh - 2, fy | 0);
    const tx = sw > 1 ? fx - ix : 0, ty = sh > 1 ? fy - iy : 0;
    const q0 = (iy * sw + ix) * 4, q1 = q0 + (sw > 1 ? 4 : 0), q2 = q0 + (sh > 1 ? sw * 4 : 0), q3 = q2 + (sw > 1 ? 4 : 0);
    const a0 = S[q0 + 3] * (1 - tx) * (1 - ty), a1 = S[q1 + 3] * tx * (1 - ty), a2 = S[q2 + 3] * (1 - tx) * ty, a3 = S[q3 + 3] * tx * ty, a = a0 + a1 + a2 + a3;
    if (a > 0) {
      D[o] = (S[q0] * a0 + S[q1] * a1 + S[q2] * a2 + S[q3] * a3) / a;
      D[o + 1] = (S[q0 + 1] * a0 + S[q1 + 1] * a1 + S[q2 + 1] * a2 + S[q3 + 1] * a3) / a;
      D[o + 2] = (S[q0 + 2] * a0 + S[q1 + 2] * a1 + S[q2 + 2] * a2 + S[q3 + 2] * a3) / a;
      D[o + 3] = a;
    }
  };
  const tri = (A, B, C) => {
    // A, B, C: grid points; to the result's pixels
    const ax = (A.X - x0) * ko, ay = (A.Y - y0) * ko, bx = (B.X - x0) * ko, by = (B.Y - y0) * ko, cx = (C.X - x0) * ko, cy = (C.Y - y0) * ko;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const e = -1e-6 * Math.abs(den);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const l0 = (by - cy) * (qx - cx) + (cx - bx) * (qy - cy), l1 = (cy - ay) * (qx - cx) + (ax - cx) * (qy - cy);
      const u = den > 0 ? l0 : -l0, v = den > 0 ? l1 : -l1, w = (den > 0 ? den : -den) - u - v;
      if (u < e || v < e || w < e) continue;
      const a0 = l0 / den, a1 = l1 / den, a2 = 1 - a0 - a1;
      sample(a0 * A.px + a1 * B.px + a2 * C.px, a0 * A.py + a1 * B.py + a2 * C.py, (y * W + x) * 4);
    }
  };
  for (const [i, j] of cells) {
    const p00 = pt(i, j), p10 = pt(i + 1, j), p01 = pt(i, j + 1), p11 = pt(i + 1, j + 1);
    tri(p00, p10, p11); tri(p00, p11, p01);
  }
  return { data: D, width: W, height: H, rect: { x: x0, y: y0, w: W / ko, h: H / ko } };
}
const BENT = new Map();   // painted lines, bent: key -> {img, rect}; the newest last
let bentPx = 0;
const BENT_PX = 24e6;     // how many pixels of them are kept
/**
 * Paints a line bent (`o.bend`: {id, amt}; `o` as paintRuns' — fs, lineW, unit, and frame and warp for the
 * layer's own perspective). `paint(c, unit)` paints the line as it would be, in the line's space, on context
 * c whose pixels are `unit` a unit: on a canvas of its own, round the line with room for what a lettering
 * throws round it (glows, shadows, depth), a little finer than the canvas below so the stretched parts
 * stay sharp (coarser while something is dragged, for speed). That picture is bent (meshWarp) and laid on `ctx`. The bent picture is kept by what it
 * shows (`key`, given by the caller with whatever else decides how the line looks), so a line moved,
 * turned or the cover redrawn for another reason is laid down again without being made again.
 */
export function bentLine(ctx, o, key, paint) {
  const map = bendMap(o.bend.id, { ...o, amt: o.bend.amt });
  if (!map || !real(ctx)) return paint(ctx, o.unit);
  const fs = o.fs, P = fs * 0.75, rect = { x: -P, y: -fs * 1.25 - P, w: o.lineW + 2 * P, h: fs * 1.7 + 2 * P };
  // finer than the canvas below on screen, as fine on an export; coarser while something is dragged
  const k = Math.min(o.unit * (isFast() ? 0.6 : o.unit >= 1.6 ? 1 : 1.5), 4096 / rect.w, 4096 / rect.h);
  const id = [key, look().id, JSON.stringify(lookValues()), lookState(), isFast() ? 1 : 0, o.bend.id, o.bend.amt, JSON.stringify(o.warp || null), o.frame ? [o.frame.ox, o.frame.oy, o.frame.c, o.frame.box.x, o.frame.box.y, o.frame.box.w, o.frame.box.h].map((v) => Math.round(v * 10)).join() : "", o.lineW.toFixed(1), fs, k.toFixed(3), FONTS_SEEN].join("|");
  let got = BENT.get(id);
  if (got) { BENT.delete(id); BENT.set(id, got); }
  else {
    const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.ceil(rect.w * k)), height: Math.max(1, Math.ceil(rect.h * k)) });
    const x = c.getContext("2d", { willReadFrequently: true });
    for (const p of ["font", "textAlign", "textBaseline", "lineJoin", "lineCap", "miterLimit", "letterSpacing"]) if (p in ctx) try { x[p] = ctx[p]; } catch (e) { /* not settable here */ }
    x.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    const before = stopgaps;
    paint(x, k);
    const bent = meshWarp(x.getImageData(0, 0, c.width, c.height), rect, k, map, Math.max(6, Math.round(fs * k / 9)));
    const out = Object.assign(document.createElement("canvas"), { width: bent.width, height: bent.height });
    out.getContext("2d").putImageData(new ImageData(bent.data, bent.width, bent.height), 0, 0);
    got = { img: out, rect: bent.rect };
    if (stopgaps === before) {   // a line painted while its outlines were on their way is not kept: they will be drawn when they arrive
      BENT.set(id, got); bentPx += bent.width * bent.height;
      for (const [kk, v] of BENT) { if (bentPx <= BENT_PX || BENT.size <= 1) break; bentPx -= v.img.width * v.img.height; BENT.delete(kk); }
    }
  }
  ctx.drawImage(got.img, got.rect.x, got.rect.y, got.rect.w, got.rect.h);
}
/** Fonts that arrive later change how a line looks: a bent line painted before is not kept past them. */
let FONTS_SEEN = 0;
/** How many times an outline effect has stood in ordinary lettering for outlines still on their way (see outlined). */
let stopgaps = 0;
if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { FONTS_SEEN++; });

// Which effects draw the title's outline and shadow (its two sliders): the plain letterings of the
// flat looks have neither, the overprint only an offset second colour, everything built on the
// house lettering both. A look id stands for its own lettering, which "auto" uses.
const BOTH = { stroke: true, shadow: true }, NONE = { stroke: false, shadow: false };
const USES = { cel: BOTH, plain: NONE, cyber: BOTH, riso: { stroke: false, shadow: true }, anime: BOTH, bluenote: NONE, editorial: NONE, songke: NONE, vivid: BOTH, negative: NONE, cinema: { stroke: false, shadow: true }, cyano: { stroke: false, shadow: true }, monofilm: { stroke: false, shadow: true }, typo: NONE, toon: { stroke: false, shadow: true }, avant: NONE, collage: { stroke: false, shadow: true }, yellow: NONE, pitch: NONE, dots: { stroke: false, shadow: true }, neon: { stroke: false, shadow: true }, court: { stroke: false, shadow: true }, velvet: { stroke: false, shadow: true }, rave: { stroke: false, shadow: true }, chrome: { stroke: false, shadow: true }, netart: { stroke: false, shadow: true }, verse: { stroke: false, shadow: true }, glass: { stroke: false, shadow: true }, jelly: { stroke: false, shadow: true }, skies: { stroke: false, shadow: true }, spectrum: { stroke: false, shadow: true }, citypop: BOTH, construct: { stroke: false, shadow: true }, deco: BOTH };
/** { id, stroke, shadow } for effect `id` under the current look; id is the effect actually painted. */
export function effectUses(id = "auto") {
  const fx = EFFECTS[id] && id !== "auto" ? id : look().runs ? look().id : "cel";
  return { id: fx, ...(USES[fx] || BOTH) };
}

/** Paints the current line with effect `id`. See the top of the file for `pass` and `o`. */
export function paintRuns(ctx, pass, o, id = "auto") {
  const fx = EFFECTS[id] ? id : "auto";
  if (fx === "auto") return look().runs ? look().runs(ctx, pass, o, lookValues()) : house(ctx, pass, o);
  if (fx === "cel") return house(ctx, pass, o);
  if (fx === "plain") return pass((a, x) => { ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fillText(a.t, x, 0); });
  if (EFFECTS[fx].kind === "passes") return LOOKS[fx].runs(ctx, pass, o, lookParams(fx));   // another look's lettering, at its default settings
  return EFFECTS[fx].kind === "mask" ? masked(ctx, pass, o, fx) : outlined(ctx, pass, o, fx);
}
