// Text effects: how the letters of a headline are painted. An effect belongs to a layer (the title,
// or a text layer in its headline look); "auto" leaves the choice to the current look.
//
// Three kinds, by what they can change:
//   passes    the same line of text painted several times in different colours and places — outlines,
//             shadows, echoes. The looks' own letterings are of this kind; "auto" takes the current look's.
//   mask      the letters are first painted alone on a spare canvas, which is then worked on —
//             filled with a pattern, worn away, shaded inside, cut into rows — and laid down.
//   outline   the letters' outlines are fetched as points (see outlines.js), which can be moved
//             before they are filled: bent, tapered, waved, or given real depth.
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
import { LOOKS, look, lookValues, lookParams } from "./style.js";
import { outline } from "./outlines.js";

/**
 * id -> { name: {zh, en}, kind }. The order is the order of the menu: the typesetting effects, and the
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
  extrude: { name: { zh: "立体挤出", en: "Extruded" }, kind: "outline" },
  arc: { name: { zh: "拱形", en: "Arched" }, kind: "outline" },
  taper: { name: { zh: "透视收缩", en: "Tapered" }, kind: "outline" },
  wave: { name: { zh: "波浪", en: "Wave" }, kind: "outline" },
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
/** The outline of a run, placed and sized: closed polylines of [x, y] in the line's own units. Null if not to be had. */
function contours(ctx, a, at, o) {
  const glyphs = outline(ctx.font, a.t);
  if (!glyphs) return null;
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
const WARP = {
  arc: (o) => { const lift = o.fs * 0.32 * o.amt, half = Math.max(1, o.lineW / 2); return ([x, y]) => [x, y - lift * (1 - ((x - half) / half) ** 2) + lift * 0.45]; },
  taper: (o) => { const k = Math.min(0.75, 0.42 * o.amt), mid = -o.fs * 0.36; return ([x, y]) => { const s = 1 - (k * x) / Math.max(1, o.lineW); return [x, mid + (y - mid) * s]; }; },
  wave: (o) => { const lift = o.fs * 0.11 * o.amt, len = o.fs * 2.4; return ([x, y]) => [x, y + lift * Math.sin((x / len) * Math.PI * 2)]; },
};
/** The corners a block's perspective moves to, as fractions of its size: the layer's own, or the plain taper's. */
export function warpCorners(warp, amt = 1) {
  if (Array.isArray(warp) && warp.length === 4) return warp;
  const k = Math.min(0.75, 0.42 * amt) * 0.4;   // about what the plain taper does to a single line
  return [[0, 0], [0, k], [0, -k], [0, 0]];
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
  pass((a, at) => { const c = contours(ctx, a, at, o); if (!c) ready = false; runs.push([a, c]); });
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
  const warp = id === "taper" && o.warp && o.frame ? perspective(o) : WARP[id] ? WARP[id](o) : null;
  for (const [a, shapes] of runs) {
    const bent = warp ? shapes.map((pts) => pts.map(warp)) : shapes;
    if (id !== "extrude" && o.d > 0) { ctx.save(); ctx.translate(o.d, o.d); ctx.fillStyle = a.hi ? o.hiShadowCss : o.shadowCss; trace(ctx, bent); ctx.fill(); ctx.restore(); }
    trace(ctx, bent);
    if (o.strokeAmt > 0) { ctx.strokeStyle = o.inkCss; ctx.lineWidth = o.fs * 0.075 * o.strokeAmt; ctx.stroke(); }
    ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fill();
  }
}

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
