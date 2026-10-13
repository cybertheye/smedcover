// Looks: how a cover is rendered. The *content* of a cover — layers, placements, sticker and
// solid specs, title text — never mentions a look, so switching look re-renders everything,
// built-in and generated assets included, without touching the data.
//
// A look is a set of hooks. Every hook is optional: what a look leaves out is drawn the house
// (cel) way, so a new look can start as a single hook and grow.
//
//   theme(base, C, p)            colours of the field, grid and plain text
//   background(ctx, env, L, p)   paints the background layer (field, grid, photo); return true if handled
//   accent                       how the colour block is painted: { fill(C), tone, edge(ctx, pts, …) }
//   runs(ctx, pass, o, p)        paints lettering made of runs (the title, free text): pass(fn) calls
//                                fn(run, x) for every run of the current line; o has the sizes and colours
//   wrap(ctx, C, p)              returns the context that graphics, solids and the small cover parts
//                                (brand row, tag, channel name, brackets) draw on — a look can re-map
//                                their colours and line work here without changing their drawing code
//   sticker                      painters for flat stickers: { shape, blob, stroke, thin, word }
//   tag(ctx, str, x, y, fs, C, p) paints the corner tag and returns its box
//   frame(ctx, env, p)           paints the frame layer (corner brackets and any interface detail)
//   plate(ctx, x, y, w, h, colour, fs, p)  paints the plate under a text layer
//   subject(ctx, half, env, p)   painted around the channel graphic, in its own space
//   seeded                       true when the look scatters things at random (the user can shuffle them)
//   titleFont(fonts)             the font stack of the title, when the look sets its own
//   faces(fonts)                 font stacks to use in place of the profile's for the whole cover: { cn?, en?, mono? }
//   titleSet(ctx, title, box, L, env, p)  sets the title itself (returns its box), or returns null to decline
//   layout(template, w, h)       the geometry of a cover, for looks that are about arrangement (see layout.js)
//   image(ctx, C, unit, p)       prepares the context for an uploaded image (its shadow or glow)
//   post(ctx, w, h, C, p, unit, hits)  painted over the finished cover (scanlines, vignette); `unit` is
//                                canvas pixels per virtual unit, `hits` where each layer ended up
//   params                       … an entry with toggle: true is shown as a checkbox (0 or 1)
//   params                       tunable numbers shown as sliders: [{ key, min, max, step, def, name: {zh, en} }];
//                                needsPhoto: true marks one that only acts on a background photo
//   prompt / solidPrompt         the "Style" section of the AI prompts for this look (see ai.js)
//
// The current look is module state, set by drawCover() from the profile before anything is drawn.

import { fonts, spaced, spacedW, brackets, toneField } from "./cel.js";
import { blockLayout } from "./layout.js";
import { drawTitleVertical } from "./title.js";

const INK = "#07070c";
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);

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
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
const sat = (c) => { const hi = Math.max(c[0], c[1], c[2]), lo = Math.min(c[0], c[1], c[2]); return hi ? (hi - lo) / hi : 0; };
/** What a colour is doing in the house style: "ink", a neutral "light" / "mid" / "dark" surface, or a "colour". */
export function role(c) {
  if (sat(c) > 0.22 && Math.max(c[0], c[1], c[2]) >= 96) return "colour";   // the house greys are bluish: only bright, saturated colours count
  const l = lum(c);
  return l < 0.05 ? "ink" : l > 0.85 ? "light" : l > 0.5 ? "mid" : "dark";
}

let fast = false;             // see setFast()
let seed = 7;                 // see setLook(): places the things a look scatters at random

// ---------- the house look: everything is drawn by the code's own defaults
const cel = {
  id: "cel",
  name: { zh: "赛璐珞", en: "Cel" },
  params: [],
};

// ---------- cyberpunk: the hard-edged graphic design of a neon city's interfaces and signage.
// Solid panels in the channel colour with black lettering, chamfered corners, a red and cyan
// colour split, torn scanlines, small technical labels. Objects are dark hardware picked out in
// lines of light. Nothing is soft: where the house style has an ink shadow, this has a colour echo.
const CY = {
  deep: [8, 8, 12],            // the field
  black: [5, 5, 8],            // lettering and outlines on colour
  glass: [[30, 32, 46], [19, 20, 31], [10, 10, 17]],   // light / mid / dark faces of an object
  red: [255, 0, 60],           // the two colours every split and echo is made of
  cyan: [0, 240, 255],
  white: [240, 246, 250],
};
const pad2 = (n) => String(n).padStart(2, "0");
/** A line of light: a faint halo, the coloured line, a pale core. `draw()` strokes the current path or text. */
function tube(ctx, draw, colour, glow, core = true) {
  const w = ctx.lineWidth, a = ctx.globalAlpha;
  ctx.strokeStyle = css(colour);
  if (glow > 0) { ctx.globalAlpha = a * 0.16 * Math.min(1.5, glow); ctx.lineWidth = w * (2 + 2.4 * glow); draw(); ctx.globalAlpha = a * 0.3 * Math.min(1.5, glow); ctx.lineWidth = w * (1.2 + 0.9 * glow); draw(); }
  ctx.globalAlpha = a; ctx.lineWidth = w * 0.8; draw();
  if (core) { ctx.strokeStyle = css(mix(colour, CY.white, 0.75), 0.9); ctx.lineWidth = Math.max(0.6, w * 0.24); draw(); }
  ctx.lineWidth = w; ctx.globalAlpha = a;
}
/**
 * The colour echo that stands in for a shadow: `draw(colour)` is run twice, nudged apart, once in
 * cyan and once in red, before the real thing is painted on top.
 */
function echo(ctx, amount, draw) {
  if (amount <= 0) return;
  for (const [dx, dy, col] of [[-amount, amount * 0.35, CY.cyan], [amount, -amount * 0.35, CY.red]]) { ctx.save(); ctx.translate(dx, dy); draw(css(col)); ctx.restore(); }
}
/** A rectangle with its lower right corner cut off. */
function chamfer(ctx, x, y, w, h, cut) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - cut); ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x, y + h); ctx.closePath();
}
const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
/** A number in 0…1 that depends on `k` and on the profile's seed: the same until the seed is changed. */
const rand = (k) => noise(k + (seed % 9973) * 0.6180339);

/**
 * A context that draws the house style's objects as dark hardware: neutral faces become dark
 * glass, ink edges become lines of light in the channel colour, ink lettering turns pale.
 * Everything else passes straight through.
 */
function neonContext(ctx, C, p) {
  let ink = false, given = null;            // `given`: the fill colour as the drawing code set it
  const fill = (v) => {
    const c = parseColour(v);
    given = c;
    if (!c) return v;
    const r = role(c);
    return r === "colour" ? v : css(r === "ink" ? CY.black : CY.glass[r === "light" ? 0 : r === "mid" ? 1 : 2], c[3]);
  };
  const stroke = (v) => {
    const c = parseColour(v);
    ink = !!c && role(c) === "ink";
    return !c ? v : ink ? css(C, c[3]) : role(c) === "colour" ? v : css(CY.white, c[3]);
  };
  const lettering = (t, a) => {
    if (!given || role(given) !== "ink") return t.fillText(...a);
    const keep = t.fillStyle;
    t.fillStyle = css(CY.white, given[3]); t.fillText(...a); t.fillStyle = keep;
  };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "stroke") return (...a) => (ink ? tube(t, () => t.stroke(...a), C, p.glow) : t.stroke(...a));
      if (k === "strokeText") return (...a) => (ink ? tube(t, () => t.strokeText(...a), C, p.glow * 0.6, false) : t.strokeText(...a));
      if (k === "strokeRect") return (...a) => (ink ? tube(t, () => t.strokeRect(...a), C, p.glow) : t.strokeRect(...a));
      if (k === "fillText") return (...a) => lettering(t, a);
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === "fillStyle") t.fillStyle = fill(v);
      else if (k === "strokeStyle") t.strokeStyle = stroke(v);
      else t[k] = v;
      return true;
    },
  });
}

const SPLIT = [];              // two work canvases for the colour split, reused between frames
const LETTERING = ["title", "text", "tag", "catname", "brand"];   // the layers that are words
const cyber = {
  id: "cyber",
  name: { zh: "赛博朋克", en: "Cyberpunk" },
  oneTheme: true,              // always dark: the light / dark choice does not apply
  seeded: true,                // scatters things at random: the Style tab offers to shuffle them
  params: [
    { key: "split", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "色彩错位", en: "Colour split" } },
    { key: "tear", min: 0, max: 2, step: 0.05, def: 0.7, name: { zh: "信号撕裂", en: "Signal tear" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "decor", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "界面装饰", en: "Interface detail" } },
    { key: "sweep", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "扫描光带", en: "Sweep line" } },
    { key: "sweepAt", min: 0, max: 1, step: 0.01, def: 0, name: { zh: "光带位置", en: "Sweep position" } },
    { key: "glow", min: 0, max: 2, step: 0.05, def: 0.35, name: { zh: "线条光晕", en: "Line glow" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片染色", en: "Photo tint" } },
    { key: "tearClear", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "撕裂避开文字", en: "Keep tears off lettering" } },
  ],
  theme: (base, C) => ({ ...base, field: css(CY.deep), text: css(CY.white), dim: css(CY.white, 0.55), titleFill: css(CY.white), titleInk: css(CY.black), grid: () => css(C, 0.2) }),

  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(CY.deep); ctx.fillRect(0, 0, w, h);
    if (env.photo) {
      env.drawPhoto();
      if (p.photo > 0) {   // pushed toward the channel colour and into the dark, like a still on a monitor
        ctx.save();
        ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix(CY.white, C, 0.75 * p.photo)); ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = css(CY.deep, 0.42 * p.photo); ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      return true;
    }
    if (L.grid) {   // a measured sheet: a field of dots, and a registration cross wherever four big squares meet
      ctx.fillStyle = css(C, 0.34);
      for (let x = 20; x < w; x += 60) for (let y = 20; y < h; y += 60) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      ctx.strokeStyle = css(C, 0.6); ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 200; x < w; x += 240) for (let y = 200; y < h; y += 240) { ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); }
      ctx.stroke();
    }
    if (p.decor > 0.25) {   // the channel's code, enormous and barely there, running off the edge
      const str = (env.cat.code || env.cat.name || "").toUpperCase().slice(0, 6);
      if (str) {
        const fs = Math.min(w, h) * 0.62;
        ctx.save(); ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        ctx.lineWidth = 3; ctx.strokeStyle = css(C, 0.16 * p.decor); ctx.strokeText(str, w + fs * 0.06, h * 0.5 + fs * 0.36);
        ctx.restore();
      }
    }
    return true;
  },

  accent: {
    fill: (C) => css(C),                    // a solid panel
    tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** A hard black edge, a cyan hairline beside it and a broken red one beyond that. */
    edge(ctx, run, nx, ny) {
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.strokeStyle = css(CY.black); ctx.lineWidth = 12; run(0, 0);
      ctx.strokeStyle = css(CY.cyan); ctx.lineWidth = 3; run(nx * 17, ny * 17);
      ctx.strokeStyle = css(CY.red); ctx.setLineDash([70, 190]); run(nx * 26, ny * 26); ctx.setLineDash([]);
    },
  },

  /**
   * Lettering in the manner of the game's logotype: slanted, in the channel colour, with a black
   * keyline and a colour echo, and cut into three bands that sit slightly out of line.
   * Highlighted words are black on a chamfered plate.
   */
  runs(ctx, pass, o, p) {
    const fs = o.fs, C = o.C || CY.white, ink = o.fill || C, plateCol = o.hi || (o.fill && o.fill !== C ? o.fill : C);
    const g = fast ? 0 : fs * 0.03 * p.split * Math.max(0.3, o.shadowAmt), slip = fs * 0.03 * Math.min(1.5, p.split);
    ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    ctx.transform(1, 0, -0.1, 1, 0, 0);   // a harder slant than the house style's
    const all = () => {
      pass((a, x) => {
        if (!a.hi) return;
        const w = ctx.measureText(a.t).width, bx = x - fs * 0.07, by = -fs * 0.88, bw = w + fs * 0.14, bh = fs * 1.06, plate = (col) => { chamfer(ctx, bx, by, bw, bh, fs * 0.2); ctx.fillStyle = col; ctx.fill(); };
        echo(ctx, g * 1.3, plate); plate(css(plateCol));
      });
      echo(ctx, g, (col) => pass((a, x) => { if (a.hi) return; ctx.fillStyle = col; ctx.fillText(a.t, x, 0); }));
      if (o.strokeAmt > 0) pass((a, x) => { if (a.hi) return; ctx.strokeStyle = css(CY.black); ctx.lineWidth = fs * 0.07 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
      pass((a, x) => { ctx.fillStyle = a.hi ? css(CY.black) : css(ink); ctx.fillText(a.t, x, 0); });
    };
    // three bands, top to bottom, each nudged sideways, with a hairline of nothing between them
    for (const [y0, y1, dx] of [[-1.3, -0.6, slip], [-0.6, -0.27, 0], [-0.27, 0.5, -slip * 0.8]]) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e5, y0 * fs, 2e5, (y1 - y0) * fs - fs * 0.014); ctx.clip();
      ctx.translate(dx, 0); all(); ctx.restore();
    }
  },

  /** The plate under a text layer: chamfered, with a tab on its left edge and a colour echo. */
  plate(ctx, x, y, w, h, colour, fs, p) {
    const shape = (c) => { chamfer(ctx, x, y, w, h, fs * 0.34); ctx.fillStyle = c; ctx.fill(); ctx.fillRect(x - fs * 0.3, y + h / 2 - fs * 0.07, fs * 0.22, fs * 0.14); };
    echo(ctx, fast ? 0 : 6 * p.split, shape); shape(colour);
  },

  wrap: (ctx, C, p, plates) => (plates ? ctx : neonContext(ctx, C, p)),   // the small cover parts are already ink on colour

  /** The corner tag: a chamfered plate with a colour echo. Returns its box. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34, plate = (col) => { chamfer(ctx, x, y, w, h, fs * 0.42); ctx.fillStyle = col; ctx.fill(); };
    echo(ctx, fast ? 0 : 7 * p.split, plate); plate(css(C));
    ctx.fillStyle = ink || css(CY.black); spaced(ctx, str, x + fs * 0.5, y + h * 0.5 + fs * 0.4, 3);
    ctx.fillRect(x + fs * 0.18, y + h - fs * 0.2, w - fs * 0.9, Math.max(3, fs * 0.05));   // a rule under the lettering
    return { x: x - 8, y: y - 4, w: w + 16, h: h + 8 };
  },

  /**
   * The frame layer: the view through an optical implant that has just started up and is scanning.
   * Corner brackets, the rings of a lens, a sweep line, a start-up log up the right edge, a ruler
   * up the left, and along the bottom a status line, a signal meter, a row of chevrons and a code.
   * Everything hugs the edges, and `decor` brings the parts in one by one.
   */
  frame(ctx, env, p) {
    const { w, h, C } = env, d = p.decor;
    brackets(ctx, 30, 30, w - 30, h - 30, 44, css(CY.white), 3);
    if (d <= 0) return;
    const P = env.o.profile, i = env.o.catIndex, total = P.categories.length, code = (env.cat.code || "CH").toUpperCase();
    ctx.save();
    ctx.globalCompositeOperation = "difference";   // readable on the dark field and on the colour panel alike
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff";
    ctx.font = `600 15px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    spaced(ctx, [`// ${code}`, `${pad2(i + 1)}/${pad2(total)}`, `${env.o.size.w}×${env.o.size.h}`].join("   "), 92, h - 40, 2);
    if (d > 0.2) {   // a signal meter after the status line: ten cells, some lit
      const lit = 5 + Math.floor(rand(11) * 5);
      for (let k = 0; k < 10; k++) { if (k < lit) ctx.fillRect(420 + k * 13, h - 53, 9, 14); else ctx.strokeRect(421 + k * 13, h - 52, 7, 12); }
    }
    if (d > 0.3) {   // ruler ticks up the left edge
      ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0, y = h * 0.3; y < h * 0.7; y += 14, k++) { ctx.moveTo(40, y); ctx.lineTo(40 + (k % 5 ? 8 : 18), y); }
      ctx.stroke();
    }
    if (d > 0.35) {   // the start-up log, set on its side up the right edge
      ctx.save(); ctx.translate(w - 44, h * 0.72); ctx.rotate(-Math.PI / 2);
      ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`;
      spaced(ctx, `OPTICS MK.${2 + Math.floor(rand(3) * 6)} // BOOT ${pad2(Math.floor(rand(4) * 99))}.${pad2(Math.floor(rand(5) * 99))}   CALIBRATION OK   SYNC ${70 + Math.floor(rand(6) * 29)}%   SCANNING`, 0, 0, 2);
      ctx.restore();
    }
    if (d > 0.5) {   // a code block in the lower right: bars of uneven width
      let x = w - 92;
      for (let k = 0; k < 26; k++) { const bw = 2 + Math.floor(noise(k * 3.1 + i) * 3) * 2; x -= bw + 3; ctx.fillRect(x, h - 62, bw, 24); }
    }
    if (d > 0.6) {   // a row of chevrons, as on a warning strip
      for (let k = 0; k < 9; k++) { const x = w - 92 - 250 - k * 17; ctx.beginPath(); ctx.moveTo(x, h - 38); ctx.lineTo(x + 8, h - 50); ctx.lineTo(x + 14, h - 50); ctx.lineTo(x + 6, h - 38); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
    if (d > 0.4) {   // a short hazard stripe under the upper right bracket
      const x0 = w - 300, y0 = 126, sw = 228, sh = 12;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, sw, sh); ctx.clip();
      ctx.fillStyle = css(C); ctx.fillRect(x0, y0, sw, sh);
      ctx.fillStyle = css(CY.black);
      for (let x = x0 - sh; x < x0 + sw; x += 22) { ctx.beginPath(); ctx.moveTo(x, y0 + sh); ctx.lineTo(x + sh, y0); ctx.lineTo(x + sh + 10, y0); ctx.lineTo(x + 10, y0 + sh); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    if (d > 0.45) {   // the lens: two rings about the centre, broken into arcs, the outer one graduated
      const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) * 0.33, turn = rand(21) * Math.PI * 2;
      ctx.save(); ctx.strokeStyle = css(CY.cyan, 0.3 * d); ctx.lineWidth = 2;
      for (const [r, arcs] of [[R, [[0.1, 0.9], [1.2, 2.3], [2.6, 3.4], [3.9, 5.7]]], [R * 0.93, [[0.5, 1.6], [3.2, 4.6]]]]) for (const [a0, a1] of arcs) { ctx.beginPath(); ctx.arc(cx, cy, r, a0 + turn, a1 + turn); ctx.stroke(); }
      ctx.beginPath();
      for (let a = 0; a < 1.2; a += 0.04) { const c = Math.cos(a + turn + 2.6), s = Math.sin(a + turn + 2.6); ctx.moveTo(cx + c * R * 1.015, cy + s * R * 1.015); ctx.lineTo(cx + c * R * 1.04, cy + s * R * 1.04); }
      ctx.stroke(); ctx.restore();
    }
    if (p.sweep > 0) {   // the sweep: a line of light across the picture with the band it has just read above it.
      // It has sliders of its own: how strong it is (0 hides it) and where it sits (0 leaves that to chance).
      const y = h * (p.sweepAt > 0 ? p.sweepAt : 0.2 + rand(31) * 0.6), k = p.sweep / 0.7, trail = ctx.createLinearGradient(0, y - 110, 0, y);
      trail.addColorStop(0, css(CY.cyan, 0)); trail.addColorStop(1, css(CY.cyan, Math.min(0.5, 0.11 * k)));
      ctx.fillStyle = trail; ctx.fillRect(0, y - 110, w, 110);
      ctx.fillStyle = css(CY.cyan, Math.min(1, 0.85 * k)); ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = css(CY.white, Math.min(1, 0.9 * k)); ctx.fillRect(w * rand(32) * 0.7, y - 1, w * 0.12, 4);
    }
  },

  /**
   * Around the channel graphic: the scanner has locked on. A graduated ring, and a callout with
   * what it has read. Drawn in the graphic's own space (`half` are its half-extents), so it moves
   * and scales with the graphic.
   */
  subject(ctx, half, env, p) {
    if (p.decor <= 0.3) return;
    const r = Math.max(half.hw, half.hh) * 1.06, C = env.C, turn = rand(41) * 6;
    ctx.save(); ctx.lineCap = "butt";
    ctx.strokeStyle = css(CY.cyan, 0.85); ctx.lineWidth = 4;
    for (const [a0, a1] of [[0.2, 1.3], [1.9, 2.9], [3.5, 4.4], [5.0, 5.9]]) { ctx.beginPath(); ctx.arc(0, 0, r, a0 + turn, a1 + turn); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.beginPath();
    for (let a = 0; a < 1.0; a += 0.07) { const c = Math.cos(a + turn + 1.35), s = Math.sin(a + turn + 1.35); ctx.moveTo(c * r * 1.03, s * r * 1.03); ctx.lineTo(c * r * 1.09, s * r * 1.09); }
    ctx.stroke();
    // the callout: a leader from the ring up and out to a label
    const ax = r * 0.72, ay = -r * 0.72, bx = ax + 60, by = ay - 60, total = env.o.profile.categories.length;
    ctx.strokeStyle = css(CY.white, 0.95); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx + 46, by); ctx.stroke();
    ctx.font = `700 34px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const label = `[ ${(env.cat.code || "TARGET").toUpperCase()} ]`, lw = ctx.measureText(label).width + 28;
    ctx.fillStyle = css(CY.black, 0.82); ctx.fillRect(bx + 52, by - 34, lw, 76);
    ctx.fillStyle = css(CY.white); ctx.fillText(label, bx + 66, by - 2);
    ctx.font = `600 22px ${fonts.mono}, ${fonts.cn}`; ctx.fillStyle = css(CY.cyan);
    ctx.fillText(`ID ${pad2(env.o.catIndex + 1)}/${pad2(total)}  ${82 + Math.floor(rand(42) * 17)}%`, bx + 66, by + 28);
    ctx.restore();
  },

  sticker: {
    shape(ctx, path, fill, { shadow = true, lw = 7 } = {}, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 4; ctx.lineCap = "butt";
      if (shadow) echo(ctx, fast ? 0 : 6 * p.split, (col) => { ctx.beginPath(); path(ctx); ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.fill(); ctx.stroke(); });
      ctx.beginPath(); path(ctx); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw * 0.8; ctx.strokeStyle = css(CY.black); ctx.stroke();
    },
    blob(ctx, paths, fill, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 4;
      echo(ctx, fast ? 0 : 6 * p.split, (col) => { for (const path of paths) { ctx.beginPath(); path(ctx); ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.fill(); ctx.stroke(); } });
      for (const pass of [0, 1]) for (const path of paths) {   // outline of the union, then fills over the inner seams
        ctx.beginPath(); path(ctx);
        if (pass === 0) { ctx.fillStyle = ctx.strokeStyle = css(CY.black); ctx.lineWidth = 11; ctx.fill(); ctx.stroke(); }
        else { ctx.fillStyle = fill; ctx.fill(); }
      }
    },
    stroke(ctx, draw, color, lw = 30, p) {
      ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.miterLimit = 4;
      const line = (col, w) => { ctx.beginPath(); draw(ctx); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); };
      echo(ctx, fast ? 0 : 6 * p.split, (col) => line(col, lw + 10));
      line(css(CY.black), lw + 10); line(color, lw);
    },
    thin(ctx, draw, lw, color) { ctx.beginPath(); draw(ctx); ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.stroke(); },
    word(ctx, str, x, y, size, fill, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 3;
      echo(ctx, fast ? 0 : size * 0.05 * p.split, (col) => { ctx.fillStyle = col; ctx.fillText(str, x, y); });
      ctx.lineWidth = size * 0.18; ctx.strokeStyle = css(CY.black); ctx.strokeText(str, x, y);
      ctx.fillStyle = fill; ctx.fillText(str, x, y);
    },
  },

  /** An uploaded image gets a hard cyan echo where the house style has an ink shadow. */
  image(ctx, C, unit, p) { ctx.shadowColor = css(CY.cyan); ctx.shadowBlur = 0; ctx.shadowOffsetX = -10 * unit * p.split; ctx.shadowOffsetY = 5 * unit * p.split; },

  post(ctx, w, h, C, p, unit = 1, hits = []) {
    // The colour split and the signal tear, over the whole picture: red pulled one way, green and
    // blue the other, and a few horizontal bands knocked sideways. They cost several whole-canvas
    // copies, so they are left out of the frames of a drag (see setFast).
    const sh = Math.round(1.7 * p.split * unit), cv = ctx.canvas;
    if ((sh >= 1 || p.tear > 0) && !fast && cv && typeof document !== "undefined") {
      const W = cv.width, H = cv.height;
      const part = (i, tint) => {   // the picture with only some of its colour channels left
        const c = SPLIT[i] || (SPLIT[i] = document.createElement("canvas"));
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const x = c.getContext("2d");
        x.globalCompositeOperation = "copy"; x.drawImage(cv, 0, 0);
        x.globalCompositeOperation = "multiply"; x.fillStyle = tint; x.fillRect(0, 0, W, H);
        return c;
      };
      const red = part(0, "#ff0000"), rest = part(1, "#00ffff");
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "copy"; ctx.drawImage(red, sh, 0);
      ctx.globalCompositeOperation = "lighter";
      if (sh > 0) ctx.drawImage(red, 0, 0, 1, H, 0, 0, sh, H);     // the strips the shift leaves uncovered
      ctx.drawImage(rest, -sh, 0);
      if (sh > 0) ctx.drawImage(rest, W - 1, 0, 1, H, W - sh, 0, sh, H);
      // torn bands: the same two images again, inside a thin strip, pushed sideways. Where they fall
      // is random but tied to the profile's seed, so they hold still until the user shuffles them.
      const bands = Math.round(5 * Math.min(1.6, p.tear));
      // rows taken up by lettering, in canvas pixels: a tear through them makes them hard to read
      const kept = p.tearClear ? hits.filter((t) => LETTERING.includes(t.type)).map((t) => { const a = (t.r || 0) * Math.PI / 180, half = Math.abs(t.hw * Math.sin(a)) + Math.abs(t.hh * Math.cos(a)) + 10; return [(t.cy - half) * unit, (t.cy + half) * unit]; }) : [];
      const clear = (y, bh) => kept.every(([a, b]) => y + bh < a || y > b);
      for (let k = 0; k < bands; k++) {
        const bh = Math.round((5 + rand(k * 3.7 + 2) * 17) * unit), dx = Math.round((rand(k * 5.1 + 3) - 0.5) * 2 * 38 * unit * p.tear);
        let y = Math.round(rand(k * 7.3 + 1) * H);
        // a band that lands on lettering is thrown again, a fixed number of times, then given up
        for (let again = 1; again <= 16 && !clear(y, bh); again++) y = Math.round(rand(k * 7.3 + 1 + again * 13.7) * H);
        if (!clear(y, bh)) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, bh); ctx.clip();
        ctx.globalCompositeOperation = "copy"; ctx.drawImage(red, sh * 2 + dx, 0);
        ctx.globalCompositeOperation = "lighter"; ctx.drawImage(rest, -sh * 2 + dx, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    if (p.scan > 0) {
      ctx.fillStyle = css([0, 0, 0], 0.34 * p.scan);
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2.4);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.5, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, css(CY.black, 0.42));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },

  prompt: `Hard-edged cyberpunk signage — the stickers and warning labels of a neon city — that reads at a glance:
- angular, engineered shapes: chamfered corners, straight cuts, notches and bevels rather than soft curves; a strong silhouette; no realism, no perspective, no fine detail;
- flat solid colour only — never gradients, textures or transparency;
- every shape automatically gets a black outline and a red and cyan colour echo behind it: do NOT draw outlines, echoes or shadows yourself;
- 2 to 3 colours per sticker: the main colour and black ("ink") as partners, with white or one small accent; black panels, bars and stripes inside a shape are welcome.`,
  solidPrompt: `Hard-surface cyberpunk hardware — devices, machines and vehicles from a neon city — that reads at a glance on a dark cover:
- built from a few boxes and cylinders with chamfered, engineered proportions; add small technical parts (vents, antennas, armour plates, cables as thin boxes) where they help; no realism, no fine detail;
- the renderer turns every face into dark glass and draws every edge as a line of light: do NOT try to draw shading, outlines or glow yourself;
- "white" and "dark" both come out as dark surfaces, so shape and edges carry the object; use "main" for the parts that should light up in solid colour, and marks in "main" for lit details (screens, lamps, indicator strips).`,
};

// ====================================================================== shared by the looks below

/**
 * A context that re-maps the house style's colours and line weights. `m.fill` and `m.stroke` give,
 * for each job a colour does there ("ink", "light", "mid", "dark", "colour"), the [r, g, b] to use
 * instead (or a function of the original; leave a job out to keep the colour). `m.line` scales
 * every line width.
 */
function mapped(ctx, m) {
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
function painters(o) {
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
const inkAs = (ink, tint) => (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(ink, c[3]) : tint && role(c) === "colour" ? css(tint(c), c[3]) : fill; };

const WORK = {};               // small canvases the looks reuse: film grain, a blurred copy for bloom
/**
 * Grain over the whole canvas. On dark pictures (film) grey noise is laid on in overlay, which
 * darkens and lightens evenly; on light ones (paper) overlay barely shows, so there the noise is
 * multiplied in as specks instead: pass paper = true.
 */
function grain(ctx, amount, unit, paper = false) {
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
const wash = (ctx, w, h, mode, colour, alpha) => { if (alpha <= 0) return; ctx.save(); ctx.globalCompositeOperation = mode; ctx.fillStyle = css(colour, Math.min(1, alpha)); ctx.fillRect(0, 0, w, h); ctx.restore(); };
const grey = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return [l, l, l]; };
const upright = (ctx) => ctx.transform(1, 0, 0.08, 1, 0, 0);   // undoes the house style's slant on lettering

// ====================================================================== risograph: two spot inks on paper
const RISO = { paper: [242, 234, 216], blue: [30, 60, 165], pink: [255, 72, 176] };
const riso = {
  id: "riso",
  name: { zh: "孔版印刷", en: "Risograph" },
  oneTheme: true,
  params: [
    { key: "shift", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "套色错位", en: "Misregistration" } },
    { key: "dots", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "网点", en: "Halftone" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张颗粒", en: "Paper grain" } },
  ],
  theme: (base) => ({ ...base, field: css(RISO.paper), text: css(RISO.blue), dim: css(RISO.blue, 0.6), titleFill: css(RISO.blue), titleInk: css(RISO.paper), grid: () => css(RISO.blue, 0.1) }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(RISO.paper); ctx.fillRect(0, 0, w, h);
    if (env.photo) {   // the photo as a one-ink print: grey, then the blue ink in its shadows, on paper
      env.drawPhoto(1);
      wash(ctx, w, h, "screen", RISO.blue, 1); wash(ctx, w, h, "multiply", RISO.paper, 1);
    } else if (L.grid && p.dots > 0) {   // a field of halftone in the channel ink, fading down the sheet
      toneField(ctx, -30, -30, w + 30, h * 0.62, 34, css(C, 0.8), (x, y) => (1 - y / (h * 0.62)) * 0.95 * p.dots - (x / w) * 0.35);
    }
    return true;
  },
  accent: {
    fill: (C) => css(C), tone: () => css(RISO.blue, 0.85), toneScale: 0.9,
    edge(ctx, run, nx, ny, C, p) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(RISO.blue); ctx.lineWidth = 6; run(nx * 7 * p.shift, ny * 7 * p.shift); },   // printed a little off the panel's edge
  },
  /** Two inks, one printed slightly off the other, darker where they overlap. */
  runs(ctx, pass, o, p) {
    const fs = o.fs, C = o.hi || o.C || RISO.pink, main = o.fill || RISO.blue, g = fs * (0.035 * Math.max(0.3, o.shadowAmt) + 0.012 * p.shift);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? main : C); ctx.fillText(a.t, x + g, g * 0.8); });
    ctx.save(); ctx.globalCompositeOperation = "multiply";
    pass((a, x) => { ctx.fillStyle = css(a.hi ? C : main); ctx.fillText(a.t, x, 0); });
    ctx.restore();
  },
  wrap: (ctx) => mapped(ctx, { fill: { ink: RISO.blue, light: RISO.paper, mid: mix(RISO.paper, RISO.blue, 0.2), dark: mix(RISO.paper, RISO.blue, 0.8) }, stroke: { ink: RISO.blue, light: RISO.paper }, line: 0.8 }),
  sticker: painters({ line: RISO.blue, lineScale: 0.7, tone: inkAs(RISO.blue),
    shadow(ctx, draw, fill, p) { ctx.save(); ctx.translate(4 + 4 * p.shift, 4 + 4 * p.shift); ctx.globalCompositeOperation = "multiply"; draw(css(RISO.pink)); ctx.restore(); } }),
  /** The frame layer: what a printer leaves in the margins — registration marks and a strip of the inks. */
  frame(ctx, env) {
    const { w, h, C } = env;
    ctx.strokeStyle = css(RISO.blue); ctx.lineWidth = 2;
    for (const [x, y] of [[46, 46], [w - 46, 46], [46, h - 46], [w - 46, h - 46]]) { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke(); }
    [C, RISO.blue, RISO.pink].forEach((c, i) => { ctx.fillStyle = css(c); ctx.fillRect(w - 150 + i * 22, h - 54, 18, 18); });
    ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(RISO.pink); ctx.fillRect(w - 150 + 11, h - 54, 18, 18); ctx.restore();
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.85, unit, true); },
  prompt: `Risograph-printed stickers — a small press, two or three spot inks on paper — that read at a glance:
- simple, slightly naive shapes with a strong silhouette; chunky and friendly; no realism, no perspective, no fine detail;
- flat colour only; think in INKS: the main colour, a deep blue (use "ink") and a fluorescent pink ("pink"); "white" is bare paper;
- the app prints the outline in blue and a pink shadow a little off register: do NOT draw outlines or shadows yourself;
- large flat areas and clear gaps between them print best; avoid thin slivers.`,
  solidPrompt: `Objects drawn for a risograph zine: simple toy-like models built from a few boxes and cylinders, with clear exaggerated proportions; no realism, no fine detail.
- the renderer prints the faces as paper and blue ink with halftone on the shadow side: do NOT try to draw shading or outlines yourself;
- "white" is bare paper, "dark" is deep blue ink, and "main" is the channel's own ink — use it for one to three parts that should stand out.`,
};

// ====================================================================== 90s cel animation, photographed on film
const ANI = { line: [46, 36, 60], cream: [250, 244, 230], shade: [72, 62, 98], pale: [216, 211, 226] };
const muted = (c) => mix(mix(c, grey(c), 0.2), ANI.cream, 0.08);   // paint, not light: a little greyer and warmer
const anime = {
  id: "anime",
  name: { zh: "九十年代动画", en: "90s animation" },
  oneTheme: true,
  seeded: true,
  params: [
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "柔光", en: "Bloom" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "褪色", en: "Fade" } },
    { key: "dust", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "灰尘划痕", en: "Dust and scratches" } },
  ],
  theme: (base) => ({ ...base, field: css([40, 44, 86]), text: css(ANI.cream), dim: css(ANI.cream, 0.6), titleFill: css(ANI.cream), titleInk: css(ANI.line), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L) {
    const { w, h, C } = env;
    if (env.photo) { env.drawPhoto(); wash(ctx, w, h, "multiply", [255, 238, 216], 0.5); return true; }
    // a painted sky: deep above, hazy toward the horizon, with a few soft banks of cloud
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, css(mix([34, 46, 108], C, 0.06))); sky.addColorStop(0.55, css(mix([92, 132, 184], C, 0.08))); sky.addColorStop(1, css(mix([244, 208, 172], C, 0.14)));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (L.grid) for (let k = 0; k < 7; k++) {
      const cx = rand(k * 3 + 1) * w, cy = h * (0.18 + rand(k * 3 + 2) * 0.5), rx = w * (0.1 + rand(k * 3 + 3) * 0.16), ry = rx * 0.3;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, css(ANI.cream, 0.55)); g.addColorStop(0.6, css(ANI.cream, 0.22)); g.addColorStop(1, css(ANI.cream, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    return true;
  },
  accent: {
    fill: (C) => css(muted(C)), tone: (C) => css(mix(muted(C), ANI.line, 0.34)), toneScale: 0.85,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(ANI.line); ctx.lineWidth = 11; run(0, 0); ctx.strokeStyle = css(ANI.cream, 0.9); ctx.lineWidth = 3; run(nx * 15, ny * 15); },
  },
  /** A title-card logotype: pale letters, a dark keyline, a white one outside it, and a soft drop shadow. */
  runs(ctx, pass, o) {
    const fs = o.fs, C = o.hi || o.C || ANI.cream, k = Math.max(0.4, o.strokeAmt), d = fs * 0.055 * o.shadowAmt;
    ctx.lineJoin = "round";
    if (d > 0) pass((a, x) => { ctx.strokeStyle = css(ANI.line, 0.5); ctx.lineWidth = fs * 0.2 * k; ctx.strokeText(a.t, x + d, d); });
    pass((a, x) => { ctx.strokeStyle = css(ANI.cream); ctx.lineWidth = fs * 0.2 * k; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.strokeStyle = css(ANI.line); ctx.lineWidth = fs * 0.105 * k; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = a.hi ? css(mix(muted(C), ANI.cream, 0.15)) : css(o.fill || ANI.cream); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx) => mapped(ctx, { fill: { ink: ANI.line, light: ANI.cream, mid: ANI.pale, dark: ANI.shade, colour: muted }, stroke: { ink: ANI.line, colour: muted }, line: 0.85 }),
  sticker: painters({ line: ANI.line, lineScale: 0.85, tone: inkAs(ANI.line, muted), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 6); draw(css(ANI.line, 0.5)); ctx.restore(); } }),
  /** The frame layer: the rounded corners of a film gate, and a line of production credit. */
  frame(ctx, env) {
    const { w, h } = env, r = 46;
    ctx.fillStyle = "#000000";
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * r, y); ctx.arcTo(x, y, x, y + sy * r, r); ctx.lineTo(x, y); ctx.fill(); }
    const P = env.o.profile;
    ctx.font = `600 16px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(ANI.cream, 0.7);
    ctx.fillText(`© ${P.brand.name || "STUDIO"} · ${pad2(env.o.catIndex + 1)}`, w - 64, h - 44);
  },
  post(ctx, w, h, C, p, unit = 1) {
    const cv = ctx.canvas;
    if (p.bloom > 0 && !fast && cv && typeof document !== "undefined") {   // light spreading in the emulsion: a small, soft copy laid back on in screen
      const s = WORK.bloom || (WORK.bloom = document.createElement("canvas")), sw = Math.max(8, Math.round(cv.width / 14)), sh = Math.max(8, Math.round(cv.height / 14));
      if (s.width !== sw || s.height !== sh) { s.width = sw; s.height = sh; }
      const x = s.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.globalCompositeOperation = "copy"; x.drawImage(cv, 0, 0, sw, sh);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.5 * p.bloom; ctx.drawImage(s, 0, 0, cv.width, cv.height); ctx.restore();
    }
    wash(ctx, w, h, "screen", [44, 30, 56], 0.55 * p.fade);          // blacks lifted, as on an old print
    wash(ctx, w, h, "multiply", [255, 238, 214], 0.75 * p.fade);     // and the whole thing gone warm
    if (p.dust > 0) {
      for (let k = 0; k < Math.round(46 * p.dust); k++) { const r = 1 + rand(k * 2.3 + 5) * 2.4; ctx.fillStyle = rand(k + 0.5) > 0.5 ? css(ANI.cream, 0.55) : css([20, 14, 26], 0.5); ctx.beginPath(); ctx.arc(rand(k * 4.1 + 1) * w, rand(k * 5.7 + 2) * h, r, 0, Math.PI * 2); ctx.fill(); }
      for (let k = 0; k < Math.round(3 * p.dust + 0.4); k++) { const x = rand(k * 9.1 + 7) * w; ctx.fillStyle = css(ANI.cream, 0.16); ctx.fillRect(x, 0, 1.5, h); }
    }
    grain(ctx, p.grain * 0.7, unit);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, css([20, 12, 30], 0.42));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },
  prompt: `Hand-painted animation cels of the 1990s — a prop or character drawn for television — that read at a glance:
- clean, confident shapes with a strong silhouette and slightly soft, rounded corners; appealing, simple proportions; no realism, no fine detail;
- flat cel paint only; colours are a little muted and warm, never neon; white is cream;
- every shape automatically gets a dark outline and a soft shadow: do NOT draw outlines or shadows yourself;
- give forms one flat shadow shape where it helps (a darker patch of the same colour, with "shadow": false) and one small pale highlight — the two-tone shading of a cel.`,
  solidPrompt: `Props from a 1990s animated series, built as simple models from a few boxes and cylinders with clear, appealing proportions; no realism, no fine detail.
- the renderer paints the faces in flat cel tones with a dark outline: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep violet-grey, and "main" the channel colour, slightly muted — use it for one to three parts.`,
};

// ====================================================================== jazz record sleeves of the 1950s and 60s
const BN = { paper: [238, 232, 218], ink: [18, 18, 22], night: [16, 18, 24] };
let dark = true;               // whether the current cover is on a dark ground; see setLook()
const bnInk = () => (dark ? BN.paper : BN.ink), bnGround = () => (dark ? BN.night : BN.paper);
const bluenote = {
  id: "bluenote",
  name: { zh: "蓝调唱片", en: "Record sleeve" },
  params: [
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片双色调", en: "Photo duotone" } },
    { key: "rules", min: 0, max: 1, step: 0.05, def: 1, name: { zh: "细线与编目", en: "Rules and catalogue" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "纸张颗粒", en: "Paper grain" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,   // a condensed grotesque for Latin, the heavy sans for CJK
  /** Plain rectangles in generous proportions: a deep band, a wide side panel, a slim strip. */
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.36, side: 0.38, strip: 0.15 }),
  /** The corner tag: a ruled box, nothing filled. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.8;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 0.9, h = f * 1.3;
    ctx.strokeStyle = css(bnInk()); ctx.lineWidth = 4; ctx.strokeRect(x, y + (fs * 1.34 - h), w, h);
    ctx.fillStyle = ink || css(bnInk()); spaced(ctx, str, x + f * 0.45, y + fs * 1.34 - h * 0.26, 4);
    return { x: x - 4, y: y + (fs * 1.34 - h) - 4, w: w + 8, h: h + 8 };
  },
  theme: (base) => ({ ...base, field: css(bnGround()), text: css(bnInk()), dim: css(bnInk(), 0.55), titleFill: css(bnInk()), titleInk: css(bnGround()), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(bnGround()); ctx.fillRect(0, 0, w, h);
    if (env.photo) {   // one colour and black: the photograph as it was printed on a sleeve
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], C, 0.92), p.duo);
      wash(ctx, w, h, "screen", mix([0, 0, 0], C, 0.16), p.duo);
    }
    return true;
  },
  accent: { fill: (C) => css(C), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a plain block of colour, nothing more
  /** Flat, upright, tight: the type does the work. Highlighted words take the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || o.C : o.fill || bnInk()); ctx.fillText(a.t, x, 0); });
  },
  // objects are redrawn in the sleeve's two tones; the small cover parts are already ink on colour
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: bnInk(), light: bnGround(), mid: mix(bnGround(), bnInk(), 0.2), dark: bnInk() }, stroke: { ink: bnInk(), light: bnGround() }, line: 0.5 })),
  sticker: painters({ line: null, shadow: null, tone: (fill) => inkAs(bnInk())(fill) }),
  /** The frame layer: no brackets. A rule under the masthead, one above the foot, and the catalogue number. */
  frame(ctx, env, p) {
    if (p.rules <= 0) return;
    const { w, h } = env, P = env.o.profile, ink = bnInk();
    ctx.fillStyle = css(ink, 0.9 * p.rules);
    ctx.fillRect(72, 130, w - 144, 2); ctx.fillRect(72, h - 78, w - 144, 2);
    ctx.font = `700 22px ${fonts.en}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    ctx.fillText(`${(P.brand.name || "RECORDS").toUpperCase()}  ${4000 + env.o.catIndex + 1}`, w - 72, h - 46);
    ctx.textAlign = "left"; ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`;
    ctx.strokeStyle = css(ink, 0.9 * p.rules); ctx.lineWidth = 2; ctx.strokeRect(72, h - 64, 78, 22); ctx.fillText("STEREO", 82, h - 48);
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * (dark ? 0.6 : 0.85), unit, !dark); },
  prompt: `Shapes cut from coloured paper for a 1950s jazz record sleeve — reduced, deliberate, modern:
- as few shapes as possible, each a clean geometric or freely cut form; generous, confident proportions; no realism, no perspective, no detail;
- flat colour only, and no outlines at all — the app draws none, so neighbouring shapes must differ in colour to be told apart;
- two colours and the ground: the main colour and black ("ink"), with "white" for cut-outs.`,
  solidPrompt: `Objects reduced to their essentials, as on a 1950s record sleeve: a few boxes and cylinders, plainly proportioned; no realism, no fine detail.
- the renderer draws faces in two flat tones with a thin line: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" is black, and "main" the one colour of the sleeve — use it sparingly, for the part that matters.`,
};

// ====================================================================== editorial: the pages of a magazine
const ED = { paper: [246, 243, 236], ink: [20, 20, 20], night: [18, 18, 18] };
// the serif face is one of the profile's fonts (see fonts.serif in cel.js)
const edInk = () => (dark ? ED.paper : ED.ink), edGround = () => (dark ? ED.night : ED.paper);
const editorial = {
  id: "editorial",
  name: { zh: "编辑设计", en: "Editorial" },
  params: [
    { key: "rules", min: 0, max: 1, step: 0.05, def: 1, name: { zh: "栏线与页眉", en: "Rules and folio" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "纸张颗粒", en: "Paper grain" } },
  ],
  titleFont: (f) => f.serif,
  faces: (f) => ({ cn: f.serif }),         // channel name and the like in the serif too; the small capitals stay sans
  /** A page: a shallow tinted foot, a narrower side column, a slim strip. */
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.27, side: 0.36, strip: 0.14 }),
  /** The corner tag: a kicker — small spaced capitals in the channel colour under a short rule. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 8), by = y + fs * 1.34;
    ctx.fillStyle = css(edInk()); ctx.fillRect(x, by - f * 1.5, Math.min(w, f * 2.2), 5);
    ctx.fillStyle = ink || css(C); spaced(ctx, str, x, by - f * 0.2, 8);
    return { x: x - 4, y: by - f * 1.6, w: w + 8, h: f * 1.7 };
  },
  theme: (base) => ({ ...base, field: css(edGround()), text: css(edInk()), dim: css(edInk(), 0.55), titleFill: css(edInk()), titleInk: css(edGround()), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(edGround()); ctx.fillRect(0, 0, w, h);
    if (env.photo) { env.drawPhoto(p.mono); wash(ctx, w, h, "multiply", ED.paper, 0.5 * p.mono); return true; }
    if (L.grid) {   // the issue number, very large and very quiet, where a picture would otherwise go
      const fs = Math.min(w, h) * 0.78;
      ctx.save(); ctx.font = `italic 700 ${fs}px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(C, dark ? 0.22 : 0.2);
      ctx.fillText(pad2(env.o.catIndex + 1), w - 60, h * 0.5 + fs * 0.36); ctx.restore();
    }
    return true;
  },
  accent: {
    fill: (C) => css(mix(edGround(), C, 0.2)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(edInk()); ctx.lineWidth = 4; run(0, 0); ctx.lineWidth = 1.5; run(nx * 9, ny * 9); },   // a thick-and-thin rule
  },
  /** A serif headline, upright and unadorned. Highlighted words take the channel colour and a rule beneath. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.hi || o.C;
    pass((a, x) => {
      ctx.fillStyle = css(a.hi ? C : o.fill || edInk()); ctx.fillText(a.t, x, 0);
      if (a.hi) ctx.fillRect(x, fs * 0.13, ctx.measureText(a.t).width, Math.max(2, fs * 0.035));
    });
  },
  wrap: (ctx, C, p, plates) => (plates
    ? mapped(ctx, { fill: { ink: edInk() }, stroke: { ink: edInk() } })   // lettering on the tinted panel follows the page
    : mapped(ctx, { fill: { ink: edInk(), light: edGround(), mid: mix(edGround(), edInk(), 0.12), dark: mix(edGround(), edInk(), 0.82) }, stroke: { ink: edInk(), light: edGround() }, line: 0.45 })),
  sticker: painters({ line: ED.ink, lineScale: 0.4, shadow: null, tone: (fill) => inkAs(ED.ink)(fill) }),
  /** The frame layer: a hairline border, a running head with volume and number, a folio, a column rule. */
  frame(ctx, env, p) {
    if (p.rules <= 0) return;
    const { w, h } = env, ink = edInk(), i = env.o.catIndex, a = 0.85 * p.rules;
    ctx.strokeStyle = css(ink, a); ctx.lineWidth = 1.5; ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.fillStyle = css(ink, a); ctx.fillRect(72, 128, w - 144, 3); ctx.fillRect(72, 135, w - 144, 1);
    ctx.font = `italic 400 22px ${fonts.serif}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
    ctx.fillText(`— ${pad2(i + 1)} —`, w / 2, h - 50);
    if (p.rules > 0.5) { ctx.fillStyle = css(ink, 0.28 * p.rules); ctx.fillRect(Math.round(w * 0.64), 170, 1, h - 340); }
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * (dark ? 0.6 : 0.85), unit, !dark); },
  prompt: `Spot illustrations for a magazine page — an engraved, quietly witty line drawing — that read at a glance:
- economical shapes with a clear silhouette, drawn as if with a pen: let thin lines ("detail") describe form, and keep filled areas few;
- flat colour only: black ("ink"), the paper ("white") and ONE spot of the main colour on the part that carries the idea;
- the app adds a hairline outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects drawn as plates for a magazine: a few boxes and cylinders, plainly and accurately proportioned; no cartoon exaggeration, no fine detail.
- the renderer draws faces in paper and near-black with a hairline: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" near-black, and "main" a single spot of colour — one part only.`,
};

// ====================================================================== a page from a Song-dynasty woodblock book
const SONG = { paper: [236, 224, 196], ink: [30, 25, 21], red: [176, 38, 32] };
const worn = (c) => mix(mix(c, grey(c), 0.3), SONG.paper, 0.22);   // a colour as a water-based print would hold it
const NUMERALS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const numeral = (n) => (n <= 10 ? NUMERALS[n] : n < 20 ? "十" + NUMERALS[n - 10] : String(n));
const songke = {
  id: "songke",
  name: { zh: "宋版刻本", en: "Woodblock book" },
  oneTheme: true,
  seeded: true,
  params: [
    { key: "rules", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "界栏", en: "Column rules" } },
    { key: "aged", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "做旧", en: "Age" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vertical", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "标题竖排", en: "Set the title vertically" } },
  ],
  titleFont: (f) => f.serif,
  faces: (f) => ({ cn: f.serif, en: f.serif }),   // everything on the page is cut in the one face
  /** Level bands: a page has no slanted panels. */
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.25, side: 0.32, strip: 0.14 }),
  theme: (base) => ({ ...base, field: css(SONG.paper), text: css(SONG.ink), dim: css(SONG.ink, 0.6), titleFill: css(SONG.ink), titleInk: css(SONG.paper), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h } = env;
    ctx.fillStyle = css(SONG.paper); ctx.fillRect(0, 0, w, h);
    if (env.photo) {   // as a rubbing would show it: grey, pressed into the paper
      env.drawPhoto(1); wash(ctx, w, h, "multiply", SONG.paper, 1); wash(ctx, w, h, "screen", [60, 48, 36], 0.35);
    }
    if (L.grid && p.rules > 0) {   // the ruled columns of the block, right to left
      const pitch = Math.max(90, Math.round(Math.min(w, h) / 9));
      ctx.fillStyle = css(SONG.ink, 0.3 * p.rules);
      for (let x = w - 64 - pitch; x > 64; x -= pitch) ctx.fillRect(x, 58, 1.5, h - 116);
    }
    return true;
  },
  accent: {
    fill: (C) => css(mix(SONG.paper, worn(C), 0.78)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(SONG.ink); ctx.lineWidth = 5; run(0, 0); ctx.lineWidth = 1.5; run(nx * 10, ny * 10); },   // a thick-and-thin border, as round the block
  },
  /**
   * The title, set as a book sets it: in columns, top to bottom, the first column on the right.
   * Each typed line is a column. Returns the box it takes, or null to leave it to the usual setting.
   */
  titleSet(ctx, title, box, L, env, p) {
    if (!p.vertical) return null;
    // Columns want height, where a line wants width: the title takes the field down to the colour
    // band (or the foot of the page), and stands clear of the seal, which keeps its corner.
    const G = env.G, split = G.template === "split", foot = split || G.flipped ? env.h - 110 : Math.min(G.accent[0][1], G.accent[1][1]) - 36;
    let x = box.x, w = box.w;
    if (env.cover.tag && !G.flipped) {
      const f = G.tag.fs * 0.82;
      ctx.save(); ctx.font = `900 ${f}px ${fonts.serif}`; const seal = spacedW(ctx, env.cover.tag, 4) + f * 0.9 + 44; ctx.restore();
      x += seal; w = Math.max(200, w - seal);
    }
    return drawTitleVertical(ctx, title, { x, y: box.y, w, h: Math.max(160, foot - box.y) }, { font: fonts.serif, fill: L.ink || css(SONG.ink), hi: L.hi || css(SONG.red), maxFs: 300, weight: 900 });
  },
  /** Horizontal lettering (the title when not vertical, text layers): plain ink, highlighted words in vermilion. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || SONG.red : o.fill || SONG.ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates
    ? mapped(ctx, { fill: { ink: SONG.ink, light: SONG.paper, colour: worn }, stroke: { ink: SONG.ink, light: SONG.paper } })
    : mapped(ctx, { fill: { ink: SONG.ink, light: SONG.paper, mid: mix(SONG.paper, SONG.ink, 0.16), dark: mix(SONG.paper, SONG.ink, 0.86), colour: worn }, stroke: { ink: SONG.ink, light: SONG.paper }, line: 0.8 })),
  sticker: painters({ line: SONG.ink, lineScale: 0.8, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(SONG.ink, c[3]) : role(c) === "colour" ? css(worn(c), c[3]) : css(SONG.paper, c[3]); } }),
  /** The corner tag: a seal, cut in relief and pressed in vermilion — a little worn at the edges. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.82;
    ctx.font = `900 ${f}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 0.9, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(SONG.red); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(SONG.paper);
    for (let k = 0; k < 16; k++) { const side = k % 4, t = rand(k * 2.3 + 60), s = 2 + rand(k * 3.1 + 61) * 5; ctx.fillRect(side < 2 ? x + t * w : side === 2 ? x - 1 : x + w - s + 1, side === 0 ? top - 1 : side === 1 ? top + h - s + 1 : top + t * h, side < 2 ? s * 2 : s, side < 2 ? s : s * 2); }
    ctx.strokeStyle = css(SONG.paper); ctx.lineWidth = 2.5; ctx.strokeRect(x + 7, top + 7, w - 14, h - 14);
    ctx.fillStyle = ink || css(SONG.paper); spaced(ctx, str, x + f * 0.45, top + h * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The plate under a text layer: a ruled label, as pasted on a book's cover. */
  plate(ctx, x, y, w, h, colour) {
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(SONG.ink); ctx.lineWidth = 5; ctx.strokeRect(x, y, w, h); ctx.lineWidth = 1.5; ctx.strokeRect(x + 9, y + 9, w - 18, h - 18);
  },
  /**
   * The frame layer: the border of the block (a thick rule with a thin one inside it), and at the
   * right edge the block's centre column, with its fishtails, the book's name and the leaf number.
   */
  frame(ctx, env, p) {
    const { w, h } = env, ink = css(SONG.ink);
    ctx.strokeStyle = ink; ctx.lineWidth = 7; ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.lineWidth = 1.5; ctx.strokeRect(46, 46, w - 92, h - 92);
    if (p.rules <= 0.3) return;
    const cw = 56, x0 = w - 46 - cw, tail = (y, dir) => { ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + cw, y); ctx.lineTo(x0 + cw, y + dir * 46); ctx.lineTo(x0 + cw / 2, y + dir * 24); ctx.lineTo(x0, y + dir * 46); ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = css(SONG.paper); ctx.fillRect(x0, 46, cw, h - 92);
    ctx.fillStyle = ink; ctx.fillRect(x0, 46, 1.5, h - 92);
    tail(h * 0.2, 1); tail(h * 0.8, -1);
    ctx.fillRect(x0, h * 0.2 - 6, cw, 3); ctx.fillRect(x0, h * 0.8 + 3, cw, 3);
    const P = env.o.profile, name = [...(P.brand.name || "")].slice(0, 12);
    ctx.font = `700 24px ${fonts.serif}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = ink;
    const room = h * 0.6 - 150, step = Math.min(30, room / Math.max(1, name.length));
    name.forEach((ch, k) => ctx.fillText(ch, x0 + cw / 2, h * 0.2 + 76 + k * step));
    ctx.font = `700 22px ${fonts.serif}`;
    [...numeral(env.o.catIndex + 1)].forEach((ch, k) => ctx.fillText(ch, x0 + cw / 2, h * 0.8 - 96 + k * 26));
  },
  post(ctx, w, h, C, p, unit = 1) {
    if (p.aged > 0) {   // foxing: a few faint brown blooms, and the sheet gone darker toward its edges
      for (let k = 0; k < Math.round(9 * p.aged); k++) {
        const x = rand(k * 4.1 + 70) * w, y = rand(k * 5.3 + 71) * h, r = (40 + rand(k * 6.7 + 72) * 170), g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css([120, 82, 40], 0.16 * p.aged)); g.addColorStop(1, css([120, 82, 40], 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      v.addColorStop(0, css([110, 80, 44], 0)); v.addColorStop(1, css([110, 80, 44], 0.34 * p.aged));
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    }
    grain(ctx, p.grain * 0.85, unit, true);
  },
  prompt: `Woodcut illustrations from an old Chinese printed book — cut in a block, printed in black — that read at a glance:
- drawn in LINE: confident black contours and a few short hatching or pattern lines ("detail") describe the form; filled black areas are few and deliberate (hair, a roof, a shadow);
- flat and frontal or in simple three-quarter view, with the plain, slightly stiff charm of a carved block; no realism, no perspective, no gradients;
- the paper is the main colour of every sticker: use "white" for bodies, "ink" for solids and lines, and the main colour only for one small printed accent (a seal, a sash, a flower);
- the app adds the black outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a woodblock illustration would show them: a few boxes and cylinders in plain, slightly formal proportions; no realism, no fine detail.
- the renderer prints faces as paper and black with a black line: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" is solid black ink, and "main" a muted printed colour — use it for one part only.`,
};

export const LOOKS = { cel, cyber, riso, anime, bluenote, editorial, songke };
export const LOOK_IDS = Object.keys(LOOKS);

let current = cel, values = {};
/**
 * Fast mode leaves out effects that cost whole-canvas work. drawCover() turns it on for the frames
 * of a drag, so a moving layer stays smooth; the full picture returns when the drag ends.
 */
export function setFast(on) { fast = !!on; }
/** Default parameter values of a look, overridden by `given` where that holds a number in range. */
export function lookParams(id, given) {
  const out = {};
  for (const d of (LOOKS[id] || cel).params) { const v = given && given[d.key]; out[d.key] = Number.isFinite(v) ? clamp(v, d.min, d.max) : d.def; }
  return out;
}
/** Makes a look current. `given` are the profile's own parameter values for it. */
export function setLook(id, given, s = 7, onDark = true) { current = LOOKS[id] || cel; values = lookParams(current.id, given); seed = Number.isFinite(s) ? s : 7; dark = !!onDark; return current; }
export const look = () => current;
export const lookValues = () => values;
/** The context graphics and the small cover parts should draw on under the current look. */
export const styled = (ctx, C, plates = false) => (current.wrap ? current.wrap(ctx, C, values, plates) : ctx);
export { INK, css };
