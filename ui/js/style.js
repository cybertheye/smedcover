// Looks: how a cover is rendered. The *content* of a cover — layers, placements, sticker and
// solid specs, title text — never mentions a look, so switching look re-renders everything,
// built-in and generated assets included, without touching the data.
//
// A look is a set of hooks. Every hook is optional: what a look leaves out is drawn the house
// (cel) way, so a new look can start as a single hook and grow.
//
//   theme(base, C, p)            colours of the field, grid and plain text
//   background(ctx, env, L, p)   paints the background layer; return true if handled. Called twice (see PAINT.bg in
//                                render.js): with L.grid false for the look's ground alone (its colour, sky, paper…),
//                                then with L.grid true and L.ground false for what stands on it, its scene and pattern,
//                                which its sliders bring in: all of them at their least, nothing. A photo is painted
//                                through it too (env.photo, L.ground left out: the ground is painted)
//   gridLines(ctx, env, color)   the grid laid on the ground when the Background's base is "grid", in the look's own
//                                manner, in `color` (the theme's grid colour); else lines every 60
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
//   repaint(colour)              how a background photo is repainted in this look (see repaint.js), the channel colour as "#rrggbb"
//   about: {zh, en}              what the look looks like and what it suits, shown under the look menu
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
//   scene: { key: {zh, en} }     the scene objects the user may drag on the canvas (the ball, the giant
//                                letters, the centre of the radiating lines…): its painters place each
//                                through objAt(key, x, y, ctx), which moves it by the cover's offset
//   art                          the key of the slider whose figure is drawn from a graphic's shape (a giant
//                                silhouette, a jelly): the channel graphic, or the one the user put in its
//                                place for this look (style.lookArt), picked under that slider
//
// The current look is module state, set by drawCover() from the profile before anything is drawn.

import { fonts, spaced, spacedW, brackets, toneField } from "./cel.js";
import { blockLayout, subtitleSize, SUB, wordsFoot } from "./layout.js";
import { drawTitleVertical, titleBlock, titleBlockVertical, parseTitle, inPiece } from "./title.js";

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
// ---------- scene objects the user may drag (see `scene` above, and sceneOffsets in layers.js)
let sceneOff = {}, sceneW = 1920, sceneH = 1080, sceneK = 1, placed = [];
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
function objAt(key, x, y, ctx = null, axis = null) {
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
function shift(key, x, y, ctx) { const [X, Y] = objAt(key, x, y, ctx); ctx.translate(X - x, Y - y); }
/** The offsets as a string, for the caches of what scene objects are painted into. */
const sceneKey = () => JSON.stringify(sceneOff);
let seed = 7;                 // see setLook(): places the things a look scatters at random

// ---------- the house look: everything is drawn by the code's own defaults
const cel = {
  id: "cel",
  repaint: (c) => `a cel-animation background painting: every surface in flat colour with two or three hard-edged tones, crisp shadows, heavy dark ink outlines around shapes, screentone dots in the shade, simplified shapes and clean bright colours, with ${c} as the leading accent colour.`,
  about: { zh: "像动画赛璐珞片那样画：粗墨线、硬边投影、两三级明暗的平涂，暗部铺网点。频道主色铺成斜切的色块，标题是带墨线和偏移投影的粗字，素材像贴纸一样带白边。明快、有冲击力，远看也认得出——适合知识、测评、开箱、日常 vlog。", en: "Drawn like animation cels: heavy ink lines, hard-edged shadows, flat colour in two or three tones, screentone in the shade. The channel colour is a slanted block, the title heavy letters with an ink line and an offset shadow, stickers have white borders. Bright and punchy, readable from afar — for explainers, reviews, unboxings, everyday vlogs." },
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
/** Where something a look puts in the top right corner ends (at x, from the right): left of the brand logo when there is one (env.logo, see logoBox in render.js). */
const besideLogo = (env, x) => (env.logo ? Math.min(x, env.logo.x - 28) : x);
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
const LETTERING = ["title", "subtitle", "text", "tag", "catname", "brand"];   // the layers that are words
const cyber = {
  id: "cyber",
  repaint: (c) => `a frame of cyberpunk concept art in the graphic language of Cyberpunk 2077: near-black shadows, hard neon light in ${c} with cyan and red edge light, sharp-edged graphic shapes, wet reflective surfaces, a little haze; bold and graphic rather than painterly, no visible interface or signage text.`,
  about: { zh: "《赛博朋克 2077》里义眼启动扫描的界面：近黑底、频道色的实色切角面板配黑字、斜体切片的标题，四角是取景框、镜头圆环和读数；红青色彩错位、信号撕裂、扫描线制造故障感，图形是用光线勾出的深色硬件。冷、硬、有速度感——适合科技、数码、游戏、夜景与城市。", en: "The interface of an optical implant starting up and scanning, after Cyberpunk 2077: near-black ground, solid chamfered panels in the channel colour with black lettering, slanted sliced headlines, viewfinder corners, lens rings and readouts; a red and cyan colour split, signal tears and scanlines for the glitch, objects as dark hardware drawn in lines of light. Cold, hard and fast — for tech, gadgets, games, night and city." },
  name: { zh: "赛博朋克", en: "Cyberpunk" },
  oneTheme: true,              // always dark: the light / dark choice does not apply
  seeded: true,                // scatters things at random: the Style tab offers to shuffle them
  scene: { sweep: { zh: "扫描光带", en: "Sweep line" } },
  params: [
    { key: "split", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "色彩错位", en: "Colour split" } },
    { key: "tear", min: 0, max: 2, step: 0.05, def: 0.7, name: { zh: "信号撕裂", en: "Signal tear" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "decor", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "界面装饰", en: "Interface detail" } },
    { key: "sweep", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "扫描光带", en: "Sweep line" } },
    { key: "glow", min: 0, max: 2, step: 0.05, def: 0.35, name: { zh: "线条光晕", en: "Line glow" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片染色", en: "Photo tint" } },
    { key: "tearClear", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "撕裂避开文字", en: "Keep tears off lettering" } },
  ],
  theme: (base, C) => ({ ...base, field: css(CY.deep), text: css(CY.white), dim: css(CY.white, 0.55), titleFill: css(CY.white), titleInk: css(CY.black), grid: () => css(C, 0.2) }),

  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (L.ground !== false) { ctx.fillStyle = css(CY.deep); ctx.fillRect(0, 0, w, h); }
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
    if (!L.grid) return true;
    if (p.decor > 0) {   // a measured sheet: a field of dots, and a registration cross wherever four big squares meet
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
  /** A HUD's measuring grid: dashed lines every 60 through the field of dots, solid ones every 240 through the registration crosses, ruler ticks along the edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, xs = every(20, w, 60), ys = every(20, h, 60);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.55; ctx.setLineDash([6, 10]); gridPath(ctx, xs, ys, 0, 0, w, h);
    ctx.globalAlpha = 1; ctx.setLineDash([]); gridPath(ctx, every(200, w, 240), every(200, h, 240), 0, 0, w, h);
    ctx.beginPath();
    xs.forEach((x, i) => { const l = i % 4 === 3 ? 28 : 12; ctx.moveTo(x, 0); ctx.lineTo(x, l); ctx.moveTo(x, h); ctx.lineTo(x, h - l); });
    ys.forEach((y, i) => { const l = i % 4 === 3 ? 28 : 12; ctx.moveTo(0, y); ctx.lineTo(l, y); ctx.moveTo(w, y); ctx.lineTo(w - l, y); });
    ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
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
      if (!o.hiPlate) pass((a, x) => {   // the highlighted words on chamfered plates (unless the layer has plates of its own under them)
        if (!a.hi || a.first === false) return;   // one plate a run, under all its pieces
        const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width };
        const bx = r.x0 - fs * 0.07, by = -fs * 0.88, bw = r.x1 - r.x0 + fs * 0.14, bh = fs * 1.06, plate = (col) => { chamfer(ctx, bx, by, bw, bh, fs * 0.2); ctx.fillStyle = col; ctx.fill(); };
        echo(ctx, g * 1.3, plate); plate(css(plateCol));
      });
      echo(ctx, g, (col) => pass((a, x) => { if (a.hi) return; ctx.fillStyle = col; ctx.fillText(a.t, x, 0); }));
      if (o.strokeAmt > 0) pass((a, x) => { if (a.hi) return; ctx.strokeStyle = css(CY.black); ctx.lineWidth = fs * 0.07 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
      pass((a, x) => { ctx.fillStyle = a.hi ? css(o.hiPlate ? o.hi || CY.black : lum(plateCol) < 0.4 ? CY.white : CY.black) : css(ink); ctx.fillText(a.t, x, 0); });   // black on the plate, white on a dark one
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
      // Where it sits is left to chance, unless it was dragged (a scene object); its slider is how strong it is (0 hides it).
      const [, y] = objAt("sweep", w / 2, h * (0.2 + rand(31) * 0.6), ctx, "y"), k = p.sweep / 0.7, trail = ctx.createLinearGradient(0, y - 110, 0, y);
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

// ---------- the grids the looks lay on their grounds (each look's `gridLines`, see lookGrid in render.js)
/** Every `step` from `a` while below `b`. */
const every = (a, b, step) => { const out = []; for (let v = a; v < b; v += step) out.push(v); return out; };
/** Starts a grid: ctx saved, strokes and fills in `color`, lines `lw` wide (2 at least: thinner ones drop out when a cover is seen small), no dashes. Pair with ctx.restore(). */
function gridPen(ctx, color, lw = 2) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw; ctx.setLineDash([]); ctx.lineCap = "butt"; ctx.lineJoin = "miter";
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0;
}
/** Lines down at each of `xs` from y0 to y1, and across at each of `ys` from x0 to x1, stroked as one path. */
function gridPath(ctx, xs, ys, x0, y0, x1, y1) {
  ctx.beginPath();
  for (const x of xs) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
  for (const y of ys) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
  ctx.stroke();
}
/** Straight lines at angle `a` (radians) across the whole w × h, `gap` apart, one through the middle moved `off` along their normal; stroked as one path. */
function slantPath(ctx, w, h, a, gap, off = 0) {
  const c = Math.cos(a), s = Math.sin(a), R = Math.hypot(w, h), cx = w / 2, cy = h / 2;
  ctx.beginPath();
  for (let d = -Math.ceil(R / 2 / gap) * gap + off; d <= R / 2; d += gap) { const px = cx - s * d, py = cy + c * d; ctx.moveTo(px - c * R, py - s * R); ctx.lineTo(px + c * R, py + s * R); }
  ctx.stroke();
}

// ====================================================================== risograph: two spot inks on paper
/**
 * The big flat forms a riso poster overprints in its inks, multiplied, so they go darker where they
 * cross: a pink disc off the field's top corner, a stack of slanted bars in blue, a half disc in the
 * channel's ink at the field's edge, a pink ring. They come in one after another as `amt` rises, each
 * growing and deepening over its own stretch of the slider; they keep to the open field.
 */
function risoShapes(ctx, env, amt) {
  if (amt <= 0) return;
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), C = env.C, at = (a, b) => clamp((amt - a) / (b - a)), ink = (r) => 0.9 * Math.min(1, r * 3);   // the ink comes in early in each stretch, the form grows through it
  ctx.save(); ctx.globalCompositeOperation = "multiply";
  shift("shapes", F.x0 + fw * 0.72, F.y0 + fh * 0.4, ctx);   // a scene object: they move as one
  let r = at(0, 0.35);
  if (r > 0) { ctx.fillStyle = css(RISO.pink, ink(r)); ctx.beginPath(); ctx.arc(F.x0 + fw * (0.8 + rand(501) * 0.08), F.y0 + fh * (0.1 + rand(502) * 0.1), u * (0.24 + 0.16 * r), 0, TAU); ctx.fill(); }
  r = at(0.25, 0.6);
  if (r > 0) {
    const x0 = F.x0 + fw * (0.6 + rand(503) * 0.06), y0 = F.y0 + fh * 0.36, bw = u * 0.05, gap = u * 0.035, len = fh * (0.25 + 0.3 * r);
    ctx.fillStyle = css(RISO.blue, ink(r));
    for (let i = 0; i < 5; i++) { const x = x0 + i * (bw + gap); shapeOf(ctx, [[x, y0], [x + bw, y0], [x + bw - len * 0.4, y0 + len], [x - len * 0.4, y0 + len]]); ctx.fill(); }
  }
  r = at(0.5, 0.82);
  if (r > 0) { const R = u * (0.18 + 0.12 * r), cx = F.x0 + fw * (0.42 + rand(504) * 0.1); ctx.fillStyle = css(C, ink(r)); ctx.beginPath(); ctx.arc(cx, F.y1, R, Math.PI, 0); ctx.closePath(); ctx.fill(); }
  r = at(0.75, 1);
  if (r > 0) { ctx.strokeStyle = css(RISO.pink, ink(r)); ctx.lineWidth = u * 0.03; ctx.beginPath(); ctx.arc(F.x0 + fw * (0.93 - rand(505) * 0.05), F.y0 + fh * 0.62, u * (0.08 + 0.06 * r), 0, TAU); ctx.stroke(); }
  ctx.restore();
}
/** A faint second impression of the whole print, (dx, dy) units further on, laid with "darken" so bare paper stays bare. */
function ghosted(ctx, dx, dy, alpha) {
  if (alpha <= 0 || !canPaint(ctx)) return;
  const m = ctx.getTransform(), x = workLike(ctx, "ghost");
  x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "darken"; ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(x.canvas, dx * m.a, dy * m.d); ctx.restore();
}
const RISO = { paper: [242, 234, 216], blue: [30, 60, 165], pink: [255, 72, 176] };
const riso = {
  id: "riso",
  repaint: (c) => `a risograph print: two or three flat spot inks (${c}, a deep blue and a fluorescent pink) on cream paper, tones made of coarse halftone dots, the inks slightly out of register, visible paper grain; no photographic tones or gradients.`,
  about: { zh: "孔版印刷（Risograph）：米色纸上两三种专色油墨叠印，叠色处变深，套色略有错位，粗网点加纸张颗粒；可以叠印几块大色块图形，也可以加上孔版机自己的痕迹——墨色不匀、滚筒条痕、重影；标题是两色错开的叠印字，图形是纸白加蓝色油墨。温暖、有手作和独立出版的味道——适合设计、阅读、生活方式、手作与小店。", en: "Risograph: two or three spot inks overprinted on cream paper, darker where they overlap, slightly out of register, coarse halftone and paper grain; big overprinted shapes if you like, and the machine's own marks — patchy ink, roller streaks, ghosting; the title is overprinted in two colours a little apart, objects are paper white and blue ink. Warm, handmade, small-press — for design, books, lifestyle, crafts, small shops." },
  name: { zh: "孔版印刷", en: "Risograph" },
  oneTheme: true,
  seeded: true,
  scene: { shapes: { zh: "叠印图形", en: "Overprinted shapes" } },
  params: [
    { key: "shift", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "套色错位", en: "Misregistration" } },
    { key: "dots", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "网点", en: "Halftone" } },
    { key: "pitch", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "网点粗细", en: "Halftone size" } },
    { key: "shapes", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "叠印图形", en: "Overprinted shapes" } },
    { key: "speckle", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "墨色不匀", en: "Patchy ink" } },
    { key: "streaks", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "滚筒条痕", en: "Roller streaks" } },
    { key: "ghost", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "重影", en: "Ghosting" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张颗粒", en: "Paper grain" } },
  ],
  theme: (base) => ({ ...base, field: css(RISO.paper), text: css(RISO.blue), dim: css(RISO.blue, 0.6), titleFill: css(RISO.blue), titleInk: css(RISO.paper), grid: () => css(RISO.blue, 0.18) }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (L.ground !== false) { ctx.fillStyle = css(RISO.paper); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {   // the photo as a one-ink print: grey, then the blue ink in its shadows, on paper
      env.drawPhoto(1);
      wash(ctx, w, h, "screen", RISO.blue, 1); wash(ctx, w, h, "multiply", RISO.paper, 1);
    } else if (L.grid && p.dots > 0) {   // a field of halftone in the channel ink, in the part the colour block leaves open: dense at its far side, fading toward the block; the size slider sets its pitch
      const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, across = F.side === "left" || F.side === "right";
      const t = F.side === "above" ? (x, y) => (F.y1 - y) / (fh * 0.62) : F.side === "right" ? (x) => (x - F.x0) / (fw * 0.62) : F.side === "left" ? (x) => (F.x1 - x) / (fw * 0.62) : (x, y) => (y - F.y0) / (fh * 0.62);
      toneField(ctx, F.x0 - 30, F.y0 - 30, F.x1 + 30, F.y1 + 30, Math.round(18 + 40 * p.pitch), css(C, 0.8), (x, y) => (1 - t(x, y)) * 0.95 * p.dots - (across ? (y - F.y0) / fh : (x - F.x0) / fw) * 0.35);
    }
    if (L.grid || L.fill) risoShapes(ctx, env, p.shapes);   // on the ground, or over a photo filling the canvas (not on a print)
    return true;
  },
  /** A coarse halftone screen at 45°, as the drum prints a flat tint of its blue. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 30, r = 2.6;
    gridPen(ctx, color); ctx.beginPath();
    for (let j = 0, y = 0; y < h + s; j++, y += s / 2) for (let x = (j % 2) * (s / 2); x < w + s; x += s) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.fill(); ctx.restore();
  },
  accent: {
    fill: (C) => css(C), tone: () => css(RISO.blue, 0.85), toneScale: 0.9,
    edge(ctx, run, nx, ny, C, p) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(RISO.blue); ctx.lineWidth = 6; run(nx * 7 * p.shift, ny * 7 * p.shift); },   // printed a little off the panel's edge
  },
  /** Two inks, one printed slightly off the other, darker where they overlap. */
  runs(ctx, pass, o, p) {
    const fs = o.fs, C = o.hi || o.C || RISO.pink, main = o.fill || RISO.blue, g = fs * o.shadowAmt * (0.035 + 0.012 * p.shift);   // the shadow slider is how far off the second ink is printed: 0 in register
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
  /**
   * What the machine does to a print: a faint second impression a drum's turn further down (ghosting),
   * lighter bands across the sheet where the drum ran short of ink, ink that took unevenly — blotches
   * and specks of bare paper in the solids — and the paper's own grain.
   */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.ghost > 0) ghosted(ctx, w * 0.012, h * 0.16, p.ghost * 0.24);
    if (p.streaks > 0) {
      ctx.save(); ctx.globalCompositeOperation = "lighten";
      for (let k = 0; k < 7; k++) softBand(ctx, 0, w, rand(k * 3.3 + 520) * h, h * (0.012 + rand(k * 4.1 + 521) * 0.05), RISO.paper, (0.35 + 0.55 * rand(k * 5.9 + 522)) * p.streaks, k * 9.1 + 523);
      ctx.restore();
    }
    wear(ctx, w, h, RISO.paper, p.speckle * 0.95);
    grain(ctx, p.grain * 0.85, unit, true);
  },
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
/**
 * Dust and scratches on a print that has been through the projector: specks of dirt (dark, mostly
 * small, a few large and ragged), bright flecks where dust sat on the negative, hairs, and long
 * scratches running down the film — pale, a little wavering, some broken off. `d` (0–1) sets how
 * many there are and how strongly they show: at 1 the print is plainly worn.
 */
function filmDust(ctx, w, h, d) {
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
const raysAt = (w, h) => [w * (0.6 + rand(621) * 0.25), h * 0.06];
function godRays(ctx, w, h, amt, dusk = 0, key = null, move = null) {
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
function lensFlare(ctx, w, h, amt, key = null) {
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
const anime = {
  id: "anime",
  repaint: (c) => `a background painting from a hand-painted 1990s anime film: painted sky and clouds, gouache-like scenery, cel-flat colours slightly greyed and warm, soft bloom on the lights, light film grain, with ${c} as an accent.`,
  about: { zh: "九十年代手绘动画、再用胶片拍下来的样子：手绘天空背景（云量可调，可以转成晚霞，有穿过云层的天使光），赛璐珞颜色略灰略暖，标题是双层勾边的字，叠上手绘式的镜头光斑、漏光、胶片颗粒、柔光、褪色、灰尘划痕和暗角。比默认的赛璐珞更旧、更柔、更怀旧——适合旅行、音乐、回忆、季节与日常。", en: "A hand-painted 90s cartoon as film would have caught it: a painted sky (as cloudy as you like, or at dusk, with beams of light through it), cel colours a little grey and warm, a title with a double keyline, then a hand-drawn lens flare, a light leak, film grain, bloom, fade, dust and scratches and a vignette. Older, softer and more wistful than the default Cel — for travel, music, memories, seasons, everyday life." },
  name: { zh: "九十年代动画", en: "90s animation" },
  oneTheme: true,
  seeded: true,
  scene: { clouds: { zh: "云", en: "Clouds" }, rays: { zh: "天使光", en: "Light rays" }, leak: { zh: "漏光", en: "Light leak" }, flare: { zh: "镜头光斑", en: "Lens flare" } },
  params: [
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "云量", en: "Clouds" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "晚霞", en: "Dusk" } },
    { key: "rays", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "天使光", en: "Light rays" } },
    { key: "flare", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "镜头光斑", en: "Lens flare" } },
    { key: "leak", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "漏光", en: "Light leak" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "柔光", en: "Bloom" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "褪色", en: "Fade" } },
    { key: "dust", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "灰尘划痕", en: "Dust and scratches" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "暗角", en: "Vignette" } },
  ],
  theme: (base) => ({ ...base, field: css([40, 44, 86]), text: css(ANI.cream), dim: css(ANI.cream, 0.6), titleFill: css(ANI.cream), titleInk: css(ANI.line), grid: () => css(ANI.cream, 0.16) }),
  /**
   * A painted sky — deep above, hazy toward the horizon; with Dusk, violet above and rose and amber
   * below — with soft banks of cloud (more of them, one by one, as Clouds rises; lit from below at
   * dusk) and beams of light slanting down through it. A photo filling the canvas gets the beams too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, d = p.dusk;
    if (env.photo) { env.drawPhoto(); wash(ctx, w, h, "multiply", [255, 238, 216], 0.5); if (L.fill) godRays(ctx, w, h, p.rays, d, "rays"); return true; }
    if (L.ground !== false) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, css(mix(mix([34, 46, 108], [58, 40, 104], d), C, 0.06))); sky.addColorStop(0.55, css(mix(mix([92, 132, 184], [206, 122, 146], d), C, 0.08))); sky.addColorStop(1, css(mix(mix([244, 208, 172], [255, 172, 96], d), C, 0.14)));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    const lit = mix(ANI.cream, [255, 196, 170], d), n = p.clouds * 13;
    ctx.save(); shift("clouds", w * 0.5, h * 0.43, ctx);   // a scene object: the clouds move as one
    for (let k = 0; k < Math.ceil(n); k++) {
      const a = clamp(n - k), cx = rand(k * 3 + 1) * w, cy = h * (0.18 + rand(k * 3 + 2) * 0.5), rx = w * (0.1 + rand(k * 3 + 3) * 0.16), ry = rx * 0.3;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, rx * 0.25 * d, 0, 0, 0, rx);
      g.addColorStop(0, css(lit, 0.55 * a)); g.addColorStop(0.6, css(lit, 0.22 * a)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    godRays(ctx, w, h, p.rays, d, "rays");
    return true;
  },
  /** An animator's field guide: twelve fields one inside another about the centre, its axes, its diagonals and a ring at its heart. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2;
    gridPen(ctx, color); ctx.beginPath();
    for (let f = 1; f <= 12; f++) { const hw = (w / 2) * (f / 12.4), hh = (h / 2) * (f / 12.4); ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2); }
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.moveTo(cx + 14, cy); ctx.arc(cx, cy, 14, 0, TAU);
    ctx.stroke(); ctx.restore();
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
    if (p.leak > 0) {   // light that got into the camera: a red-orange glow from one side, burning to yellow at its heart
      const left = rand(640) > 0.5, [x, y] = objAt("leak", left ? w * 0.02 : w * 0.98, h * (0.25 + rand(641) * 0.5), ctx), R = Math.max(w, h) * (0.3 + 0.35 * p.leak);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, css([255, 236, 170], 0.95 * p.leak)); g.addColorStop(0.22, css([255, 132, 52], 0.78 * p.leak)); g.addColorStop(0.6, css([214, 44, 56], 0.34 * p.leak)); g.addColorStop(1, css([200, 40, 60], 0));
      const e = ctx.createLinearGradient(left ? 0 : w, 0, left ? w * 0.4 : w * 0.6, 0);   // and burnt in along that edge
      e.addColorStop(0, css([255, 96, 40], 0.75 * p.leak)); e.addColorStop(0.45, css([230, 60, 50], 0.25 * p.leak)); e.addColorStop(1, css([230, 60, 50], 0));
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = e; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (p.flare > 0) lensFlare(ctx, w, h, p.flare, "flare");
    if (p.dust > 0) filmDust(ctx, w, h, p.dust);
    grain(ctx, p.grain * 0.7, unit);
    vignette(ctx, w, h, [20, 12, 30], 0.84 * p.vignette, 0.45);
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
/**
 * The record itself, sliding out of the sleeve from the open field's far edge (`amt`: how far, 0 to
 * well out): black vinyl with its grooves catching the light in two opposite wedges, a label in the
 * channel colour with a few lines of small print, the spindle hole.
 */
function record(ctx, env, amt) {
  const { C } = env, F = openField(env), R = Math.min((F.y1 - F.y0) * 0.46, (F.x1 - F.x0) * 0.4), cx0 = F.x1 + R * 1.02 - R * 1.3 * amt, ax = Math.min(cx0, F.x1 - R * 0.2);
  const [mx, cy] = objAt("record", ax, (F.y0 + F.y1) / 2, ctx), cx = cx0 + mx - ax;   // a scene object: its handle on the part that shows
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = css(dark ? [6, 6, 8] : [20, 20, 22]); ctx.fill();
  ctx.clip();
  ctx.lineWidth = 1;
  for (let r = R * 0.36; r < R * 0.97; r += R / 46) { ctx.strokeStyle = `rgba(255,255,255,${0.025 + 0.03 * rand(r)})`; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); }
  for (const a of [-0.9, Math.PI - 0.9]) {   // the sheen: two wedges of light across the grooves
    const g = ctx.createRadialGradient(cx, cy, R * 0.34, cx, cy, R);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(255,255,255,0.03)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a - 0.22, a + 0.22); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R - 1, 0, TAU); ctx.stroke();
  const lr = R * 0.33;
  ctx.fillStyle = css(C); ctx.beginPath(); ctx.arc(cx, cy, lr, 0, TAU); ctx.fill();
  ctx.strokeStyle = css(BN.ink, 0.35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, lr * 0.86, 0, TAU); ctx.stroke();
  greeked(ctx, cx - lr * 0.5, cy - lr * 0.52, lr * 1.0, 2, lr * 0.11, css(BN.ink, 0.75), 641, "center");
  greeked(ctx, cx - lr * 0.62, cy + lr * 0.28, lr * 1.24, 3, lr * 0.08, css(BN.ink, 0.6), 642, "center");
  ctx.fillStyle = css(bnGround()); ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, R * 0.022), 0, TAU); ctx.fill();
}
const bluenote = {
  id: "bluenote",
  repaint: (c) => `the photograph on a 1950s–60s jazz record sleeve: a high-contrast duotone in black and ${c}, deep shadows, coarse grain, large calm areas; still a photograph, with no drawn outlines.`,
  about: { zh: "五六十年代爵士唱片封套：大面积纯色块、紧凑的无衬线大字，没有描边、没有投影，照片处理成单色加黑并带粗网点，编目式的细线和小字；可以让黑胶唱片从封套里滑出来，再加上唱片磨出的圆痕、边角磨损和日晒褪色；自带平直的版式，可选深色或浅色底。克制、有态度、靠排版取胜——适合音乐、访谈、人物、品牌故事。", en: "Jazz record sleeves of the 50s and 60s: large flat blocks of colour, tight sans-serif headlines with no outline or shadow, photos in one colour and black through a coarse screen, catalogue rules and small print; the record can slide out of the sleeve, and the sleeve can show its years — ring wear, worn edges, sun fade; flat layouts of its own, dark or light ground. Restrained, confident, carried by the type — for music, interviews, portraits, brand stories." },
  name: { zh: "蓝调唱片", en: "Record sleeve" },
  seeded: true,
  scene: { record: { zh: "唱片露出", en: "The record" } },
  params: [
    { key: "vinyl", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "唱片露出", en: "Record sliding out" } },
    { key: "rules", min: 0, max: 1, step: 0.05, def: 1, name: { zh: "细线与编目", en: "Rules and catalogue" } },
    { key: "ring", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "圆痕磨损", en: "Ring wear" } },
    { key: "edges", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "边角磨损", en: "Worn edges" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.1, name: { zh: "日晒褪色", en: "Sun fade" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片双色调", en: "Photo duotone" } },
    { key: "halftone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "照片网点", en: "Photo halftone" } },
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
  theme: (base) => ({ ...base, field: css(bnGround()), text: css(bnInk()), dim: css(bnInk(), 0.55), titleFill: css(bnInk()), titleInk: css(bnGround()), grid: () => css(bnInk(), 0.1) }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (L.ground !== false) { ctx.fillStyle = css(bnGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {   // one colour and black: the photograph as it was printed on a sleeve, through a coarse screen
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], C, 0.92), p.duo);
      wash(ctx, w, h, "screen", mix([0, 0, 0], C, 0.16), p.duo);
      dotScreen(ctx, w, h, [255, 255, 255], 7, 0.45 * p.halftone, "soft-light");
      dotScreen(ctx, w, h, mix(BN.ink, C, 0.2), 7, 0.3 * p.halftone);
    }
    if ((L.grid || L.fill) && p.vinyl > 0) record(ctx, env, p.vinyl);
    return true;
  },
  /** The sleeve's layout grid: square modules, six down, with gutters between them. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 56, g = 18, cell = (h - 2 * m + g) / 6, cols = Math.max(1, Math.floor((w - 2 * m + g) / cell)), x0 = (w - (cols * cell - g)) / 2;
    gridPen(ctx, color); ctx.beginPath();
    for (let i = 0; i < cols; i++) for (let j = 0; j < 6; j++) ctx.rect(x0 + i * cell, m + j * cell, cell - g, cell - g);
    ctx.stroke(); ctx.restore();
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
  /**
   * A sleeve that has lived on a shelf: the sun has lifted its blacks and taken its colour; the record
   * inside has rubbed a ring through the print; its edges and corners are scuffed. On the dark sleeve
   * the wear shows pale (the board under the ink), on the light one as grime.
   */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.fade > 0) {
      wash(ctx, w, h, "screen", [64, 58, 50], 0.6 * p.fade);          // the blacks lifted
      wash(ctx, w, h, "multiply", [255, 240, 214], 0.6 * p.fade);     // gone yellow
      wash(ctx, w, h, "soft-light", [150, 146, 138], 0.5 * p.fade);   // and flatter
    }
    const scuff = dark ? mix(BN.paper, BN.night, 0.3) : [176, 164, 142], mode = dark ? "lighten" : "multiply", u = Math.min(w, h);
    if (p.ring > 0) wear(ctx, w, h, scuff, Math.min(1, p.ring * 1.2), mode, (x) => {
      const cx = w / 2 + (rand(631) - 0.5) * w * 0.08, cy = h / 2 + (rand(632) - 0.5) * h * 0.06, R = u * 0.47;
      x.strokeStyle = "#fff";
      for (const [lw, a] of [[u * 0.07, 0.35], [u * 0.045, 0.5], [u * 0.02, 0.8]]) { x.globalAlpha = a; x.lineWidth = lw; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.stroke(); }
      x.globalAlpha = 0.18; x.fillStyle = "#fff"; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill(); x.globalAlpha = 1;   // a faint rub over the whole round
    }, 0.32);
    if (p.edges > 0) wear(ctx, w, h, scuff, Math.min(1, p.edges * 1.3), mode, (x) => {
      const e = u * 0.06;
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [[0, 0, 0, e, 0, 0, w, e], [0, h, 0, h - e, 0, h - e, w, e], [0, 0, e, 0, 0, 0, e, h], [w, 0, w - e, 0, w - e, 0, e, h]]) {
        const g = x.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
      }
      for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, u * 0.16); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); x.fillStyle = g; x.fillRect(cx - u * 0.16, cy - u * 0.16, u * 0.32, u * 0.32); }
    }, 0.22);
    grain(ctx, p.grain * (dark ? 0.6 : 0.85), unit, !dark);
  },
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
/**
 * The page's text, where the column rule leaves room on the right: a large opening quotation mark in
 * the channel colour (growing and deepening with Quotation mark) and, under it, two narrow columns of
 * body text set as greeked lines, filling in paragraph by paragraph, top to bottom, as Body columns
 * rises. Nothing where the room is too narrow.
 */
function edColumns(ctx, env, p) {
  const { w, C } = env, F = openField(env), T = titleArea(ctx, env), x0 = Math.max(F.x0 + 40, Math.round(w * 0.64) + 30, T ? T.x + T.w + 60 : 0), x1 = F.x1 - 72, y0 = Math.max(F.y0, 0) + 172, y1 = Math.min(F.y1 - 44, graphicTop(env, x0, x1));
  if (x1 - x0 < 220 || y1 - y0 < 160) return;
  let top = y0;
  if (p.quote > 0) {
    const fs = 90 + 130 * p.quote;
    ctx.save(); ctx.font = `700 ${fs}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(C, 0.3 + 0.7 * p.quote);
    shift("quote", x0 + fs * 0.18, y0 + fs * 0.3, ctx);   // a scene object
    ctx.fillText("\u201C", x0 - fs * 0.06, y0 + fs * 0.62); ctx.restore();
    top = y0 + 30 + 60 * p.quote;
  }
  if (p.text <= 0) return;
  const lh = 15, gap = 26, cw = (x1 - x0 - gap) / 2, rows = Math.floor((y1 - top) / lh), ink = css(edInk(), dark ? 0.34 : 0.42);
  let left = Math.round(p.text * rows * 2);
  for (let c = 0; c < 2 && left > 0; c++) {
    let y = top, k = 0;
    while (left > 0 && y + lh <= y1) {
      const len = 3 + Math.floor(rand(c * 17 + k * 3.1 + 650) * 5), n = Math.min(len, left, Math.floor((y1 - y) / lh));
      if (n <= 0) break;
      greeked(ctx, x0 + c * (cw + gap), y, cw, n, lh, ink, 651 + c * 40 + k * 7);
      left -= n; y += (n + 0.8) * lh; k++;
    }
  }
}
const editorial = {
  id: "editorial",
  repaint: (c) => `a black-and-white magazine photograph: fine grain, deep blacks, clean highlights, a calm and considered tone; still a photograph, not a drawing.`,
  about: { zh: "杂志内页的编辑设计：衬线标题、粗细双线、细线边框、页眉页码、巨大而安静的期号数字，频道色的大引号和两栏正文，装订线阴影；照片转黑白或印成频道色的专色；自带平直的版式，可选深色或浅色底。安静、讲究、有阅读感——适合深度内容、评论、读书、文化与系列栏目。", en: "The pages of a magazine: a serif headline, thick-and-thin rules, a hairline border, running head and folio, a huge quiet issue number, a large quotation mark and two columns of body text, a gutter shadow; photos in black and white or in the channel colour as a spot ink; flat layouts of its own, dark or light ground. Quiet, considered, made to be read — for long-form, essays, books, culture, series." },
  name: { zh: "编辑设计", en: "Editorial" },
  seeded: true,
  scene: { numeral: { zh: "期号大字", en: "Issue numeral" }, quote: { zh: "引号", en: "Quotation mark" } },
  params: [
    { key: "rules", min: 0, max: 1, step: 0.05, def: 1, name: { zh: "栏线与页眉", en: "Rules and folio" } },
    { key: "numeral", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "期号大字", en: "Issue number" } },
    { key: "text", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "正文栏", en: "Body columns" } },
    { key: "quote", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "引号", en: "Quotation mark" } },
    { key: "gutter", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "装订阴影", en: "Gutter shadow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "spot", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0, name: { zh: "照片专色", en: "Photo in spot colour" } },
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
  theme: (base) => ({ ...base, field: css(edGround()), text: css(edInk()), dim: css(edInk(), 0.55), titleFill: css(edInk()), titleInk: css(edGround()), grid: () => css(edInk(), 0.11) }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (L.ground !== false) { ctx.fillStyle = css(edGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {   // black and white, or a duotone in black and the channel's colour as a spot ink: the mid-tones and lights take the ink
      env.drawPhoto(p.mono); wash(ctx, w, h, "multiply", ED.paper, 0.5 * p.mono);
      if (p.spot > 0) { wash(ctx, w, h, "multiply", mix([255, 255, 255], C, 0.85), p.spot); wash(ctx, w, h, "screen", mix([0, 0, 0], C, 0.22), p.spot); }
      return true;
    }
    if (!L.grid) return true;
    if (p.numeral > 0) {   // the issue number, very large and very quiet, where a picture would otherwise go
      const fs = Math.min(w, h) * 0.78;
      ctx.save(); ctx.font = `italic 700 ${fs}px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(C, (dark ? 0.44 : 0.4) * p.numeral);
      shift("numeral", w - 60 - fs * 0.5, h * 0.5, ctx);   // a scene object
      ctx.fillText(pad2(env.o.catIndex + 1), w - 60, h * 0.5 + fs * 0.36); ctx.restore();
    }
    edColumns(ctx, env, p);
    return true;
  },
  /** The page's grid: a baseline every 24 between the margins, and the margins and six columns in firmer rules. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 72, gut = 24, cw = (w - 2 * m - gut * 5) / 6, xs = [];
    for (let i = 0; i < 6; i++) xs.push(m + i * (cw + gut), m + i * (cw + gut) + cw);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.6; gridPath(ctx, [], every(m, h - m + 1, 24), m, 0, w - m, 0);
    ctx.globalAlpha = 1; gridPath(ctx, xs, [m, h - m], m, m, w - m, h - m);
    ctx.restore();
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
  /** The paper's grain, and, with Gutter shadow, the page as it lies in an open magazine: shaded into the binding on the left, a little light on its curve. */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.gutter > 0) {
      const gw = w * 0.16, g = ctx.createLinearGradient(0, 0, gw, 0);
      g.addColorStop(0, css([0, 0, 0], 0.55 * p.gutter)); g.addColorStop(0.18, css([0, 0, 0], 0.24 * p.gutter)); g.addColorStop(0.6, css([0, 0, 0], 0.05 * p.gutter)); g.addColorStop(1, css([0, 0, 0], 0));
      ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = g; ctx.fillRect(0, 0, gw, h);
      const l = ctx.createLinearGradient(gw * 0.3, 0, gw * 1.3, 0); l.addColorStop(0, "rgba(255,255,255,0)"); l.addColorStop(0.5, `rgba(255,255,255,${0.14 * p.gutter})`); l.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalCompositeOperation = "screen"; ctx.fillStyle = l; ctx.fillRect(gw * 0.3, 0, gw, h);
      const r = ctx.createLinearGradient(w, 0, w - w * 0.05, 0); r.addColorStop(0, css([0, 0, 0], 0.18 * p.gutter)); r.addColorStop(1, css([0, 0, 0], 0));   // the page's outer edge, turning away
      ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = r; ctx.fillRect(w * 0.95, 0, w * 0.05, h); ctx.restore();
    }
    grain(ctx, p.grain * (dark ? 0.6 : 0.85), unit, !dark);
  },
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
/**
 * Where the vertical title stands: the layout's box, beside the seal in the corner (which keeps it),
 * and down to the colour band or the foot of the page — columns want height, where a line wants width.
 */
function songBox(ctx, env, box) {
  // the foot of the page, above the counts and badges the apps lay over it (see wordsFoot in layout.js)
  const G = env.G, split = G.template === "split", page = Math.min(env.h - 110, wordsFoot(env.w, env.h));
  let foot = split || G.flipped ? page : Math.min(G.accent[0][1], G.accent[1][1]) - 36;
  let x = box.x, w = box.w;
  if (env.cover.tag && !G.flipped) {
    const f = G.tag.fs * 0.82;
    ctx.save(); ctx.font = `900 ${f}px ${fonts.serif}`; const seal = spacedW(ctx, env.cover.tag, 4) + f * 0.9 + 44; ctx.restore();
    x += seal; w = Math.max(200, w - seal);
  }
  // the channel name under the columns, on the page rather than the band: they end above it
  const c = G.cat, nameTop = c.y - c.fs * 0.95 - 30;
  if (foot > nameTop && c.y > box.y && c.x < x + w && c.x + c.maxW > x) foot = nameTop;
  return { x, y: box.y, w, h: Math.max(160, foot - box.y) };
}
/**
 * A made-up character `s` units across, centred at (x, y), built as a Song face builds one: thin
 * horizontals, heavier verticals, a dot or a falling stroke, in two parts side by side, two parts one
 * above the other, or one part whole. Not a real character — it only has to read as text at a glance.
 */
function fauxGlyph(ctx, x, y, s, k, t = Math.max(1.2, s * 0.085)) {
  const l = x - s / 2, top = y - s / 2, th = t * 0.72, tv = t * 1.3;
  const H = (x0, y0, len) => ctx.fillRect(l + x0 * s, top + y0 * s - th / 2, len * s, th);
  const V = (x0, y0, len) => ctx.fillRect(l + x0 * s - tv / 2, top + y0 * s, tv, len * s);
  const slant = (x0, y0, len, a) => { ctx.save(); ctx.translate(l + x0 * s, top + y0 * s); ctx.rotate(a); ctx.fillRect(0, -th * 0.7, len * s, th * 1.4); ctx.restore(); };
  const part = (x0, y0, w, h, q) => {
    if (rand(q + 0.6) > 0.55) { V(x0, y0 + h * 0.08, h * 0.84); V(x0 + w, y0 + h * 0.08, h * 0.84); H(x0, y0 + h * 0.08, w); H(x0, y0 + h * 0.92, w); }   // a box
    const n = 1 + Math.floor(rand(q) * 3);
    for (let i = 0; i < n; i++) { const a = rand(q + i * 1.9 + 0.1) * 0.15; H(x0 + w * a, y0 + h * (0.18 + (0.64 * (i + 0.5)) / n), w * (1 - a - rand(q + i * 2.3 + 0.2) * 0.2)); }
    if (rand(q + 0.3) > 0.25) V(x0 + w * (0.3 + rand(q + 0.4) * 0.4), y0, h);
    if (rand(q + 0.5) > 0.55) ctx.fillRect(l + (x0 + w * 0.5) * s - tv * 0.6, top + (y0 + h * 0.02) * s, tv * 1.2, tv * 1.4);   // a dot
  };
  const kind = rand(k);
  if (kind < 0.45) { part(0.04, 0.06, 0.26, 0.88, k + 1.1); part(0.42, 0.04, 0.54, 0.92, k + 2.2); }   // side by side
  else if (kind < 0.8) { part(0.1, 0.02, 0.8, 0.42, k + 3.3); part(0.04, 0.5, 0.92, 0.48, k + 4.4); }   // one above the other
  else { part(0.08, 0.04, 0.84, 0.66, k + 5.5); slant(0.48, 0.66, 0.42, 2.4); slant(0.5, 0.66, 0.44, 0.7); }   // whole, with falling strokes at the foot
}
/**
 * The page's own text, in the ruled columns the title leaves free: runs of large characters, one to a
 * column, broken by commentary in two small lines side by side, as the old books set their notes;
 * filled right to left and top to bottom as Text rises, the last character coming in faintly. Vermilion
 * marks (Vermilion marks): a small circle beside some of the large characters, a line down the side of
 * some runs, and comments in tiny characters along the rules — these last whether there is text or not.
 */
function songText(ctx, env, p, pitch) {
  if (p.text <= 0 && p.notes <= 0) return;
  const { w, h } = env, F = openField(env), T = titleLayer(env), base = titleBase(env);
  const A = !T || !base ? null : p.vertical ? withSub(titleBlockVertical(ctx, env.cover.title, env.sub && env.sub.vertical ? env.sub.titleBox : songBox(ctx, env, base), T.font ? `"${T.font}", ${fonts.serif}` : fonts.serif, 900, 300), env) : titleArea(ctx, env);
  const y0 = env.hasBrand ? 112 : 74, y1 = Math.min(h - 70, F.y1 - 24), big = pitch * 0.44, small = pitch * 0.22;
  // the free stretches of each column, right to left: not under the title, nor behind the channel graphic
  const cols = [];
  for (let r = w - 64 - pitch; r - pitch > 60; r -= pitch) {
    const cx = r - pitch / 2, spans = [[y0, y1]];
    const cut = (a, b) => { for (let i = spans.length - 1; i >= 0; i--) { const [s0, s1] = spans[i]; if (b <= s0 || a >= s1) continue; spans.splice(i, 1, ...[[s0, a], [b, s1]].filter(([u, v]) => v - u > big * 1.5)); } };
    if (A && cx + pitch / 2 > A.x - 16 && cx - pitch / 2 < A.x + A.w + 16) cut(A.y - 30, A.y + A.h + 30);
    const top = graphicTop(env, cx - pitch / 2, cx + pitch / 2);
    if (top < y1) cut(top, Infinity);
    cols.push({ cx, spans });
  }
  const ink = css(SONG.ink, 0.82), red = css(SONG.red, 0.9);
  // the text: every cell is a large character or a pair of small ones; `left` of them are shown
  const cells = [];
  cols.forEach((c, ci) => c.spans.forEach(([s0, s1], si) => {
    let y = s0, k = ci * 131 + si * 17, run = 0, notes = false;
    while (true) {
      if (run <= 0) { notes = !notes && rand(k * 1.7 + 660) > 0.45; run = notes ? 4 + Math.floor(rand(k + 661) * 9) : 3 + Math.floor(rand(k + 662) * 7); k += 3.1; }
      const step = notes ? small * 1.18 : big * 1.16;
      if (y + step > s1) break;
      cells.push({ x: c.cx, y: y + step / 2, notes, k: k * 7.3 + y });
      y += step; run--;
    }
  }));
  let left = p.text * cells.length;
  ctx.save();
  for (const cell of cells) {
    if (left <= 0) break;
    ctx.globalAlpha = Math.min(1, left); left -= 1;
    ctx.fillStyle = ink;
    if (cell.notes) { fauxGlyph(ctx, cell.x + small * 0.6, cell.y, small, cell.k); fauxGlyph(ctx, cell.x - small * 0.6, cell.y, small, cell.k + 41); }
    else {
      fauxGlyph(ctx, cell.x, cell.y, big, cell.k);
      if (rand(cell.k + 663) < p.notes * 0.45) { ctx.strokeStyle = red; ctx.lineWidth = Math.max(1.5, big * 0.06); ctx.beginPath(); ctx.arc(cell.x + big * 0.66, cell.y + big * 0.32, big * 0.11, 0, TAU); ctx.stroke(); }
    }
  }
  ctx.restore();
  if (p.notes <= 0) return;
  // comments in tiny vermilion characters down the rules, and a line beside a passage
  ctx.save(); ctx.fillStyle = red;
  cols.forEach((c, ci) => {
    if (rand(ci * 5.9 + 664) > 0.55 || !c.spans.length) return;
    const [s0, s1] = c.spans[0], n = Math.floor(p.notes * (4 + rand(ci + 665) * 10)), tiny = pitch * 0.13, x = c.cx + pitch / 2 - tiny * 0.7;
    for (let i = 0; i < n && s0 + (i + 1) * tiny * 1.25 < s1; i++) fauxGlyph(ctx, x, s0 + tiny + i * tiny * 1.25, tiny, ci * 37 + i * 3.3, Math.max(1, tiny * 0.11));
    if (rand(ci * 3.7 + 666) < p.notes) ctx.fillRect(c.cx - pitch / 2 + 5, s0 + (s1 - s0) * 0.2, 2.2, (s1 - s0) * 0.18 * (0.4 + p.notes));
  });
  ctx.restore();
}
/**
 * Collectors' seals pressed on the leaf over the years, in vermilion: a square one cut in intaglio (the
 * characters left white), a square one in relief (red characters in a red frame), a round one. They come
 * in one by one as `amt` rises, each over its own stretch, a little faded; painted together, then laid
 * on in multiply, as ink on paper.
 */
function songSeals(ctx, env, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const { w, h } = env, F = openField(env), x = workLike(ctx, "seals"), red = css(SONG.red), at = (a, b) => clamp((amt - a) / (b - a));
  const grid = (cx, cy, s, k, t) => { for (let i = 0; i < 4; i++) fauxGlyph(x, cx + (i % 2 ? -1 : 1) * s * 0.23, cy + (i < 2 ? -1 : 1) * s * 0.23, s * 0.4, k + i * 9.7, t); };
  const seals = [
    { kind: "white", key: "sealWhite", s: 92, cx: w - 102 - 70, cy: (env.logo ? Math.max(150, env.logo.y + env.logo.h + 70) : 150) + rand(671) * 60, r: at(0, 0.4) },   // under the brand logo
    { kind: "red", key: "sealRed", s: 78, cx: 64 + 60 + rand(672) * 40, cy: (F.y0 + F.y1) * 0.5 - 40 + rand(673) * 60, r: at(0.3, 0.7) },
    { kind: "round", key: "sealRound", s: 70, cx: w * (0.56 + rand(674) * 0.1), cy: F.y1 - 70 - rand(675) * 60, r: at(0.6, 1) },
  ];
  for (const [i, q] of seals.entries()) {
    if (q.r <= 0) continue;
    const [cx, cy] = objAt(q.key, q.cx, q.cy, ctx);   // each a scene object
    x.save(); x.globalAlpha = 0.85 * Math.min(1, q.r * 2); x.translate(cx, cy); x.rotate((rand(676 + i) - 0.5) * 0.08);
    const s = q.s * (0.8 + 0.2 * q.r);
    if (q.kind === "white") {
      x.fillStyle = red; x.fillRect(-s / 2, -s / 2, s, s);
      x.globalCompositeOperation = "destination-out"; x.fillStyle = "#000"; grid(0, 0, s, 680 + i * 50, s * 0.06);
    } else if (q.kind === "red") {
      x.strokeStyle = red; x.lineWidth = s * 0.07; x.strokeRect(-s / 2 + s * 0.035, -s / 2 + s * 0.035, s * 0.93, s * 0.93);
      x.fillStyle = red; grid(0, 0, s * 0.92, 690 + i * 50, s * 0.05);
    } else {
      x.strokeStyle = red; x.lineWidth = s * 0.07; x.beginPath(); x.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, TAU); x.stroke();
      x.fillStyle = red; fauxGlyph(x, 0, -s * 0.17, s * 0.34, 700 + i, s * 0.05); fauxGlyph(x, 0, s * 0.19, s * 0.34, 710 + i, s * 0.05);
    }
    x.restore();
  }
  layDown(ctx, x, 1, "multiply");
}
/**
 * Water stains: a pale brown wash in an uneven round, darker at its tide line, with a fainter ring inside
 * where it dried twice. Up to three, each coming in over its own stretch of `amt`. Multiplied in.
 */
function waterStains(ctx, w, h, amt) {
  const u = Math.min(w, h);
  ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.lineJoin = "round";
  for (const [k, a0, a1] of [[0, 0, 0.5], [1, 0.3, 0.8], [2, 0.6, 1]]) {
    const r = clamp((amt - a0) / (a1 - a0));
    if (r <= 0) continue;
    const corner = rand(k * 3.1 + 720), cx = corner < 0.5 ? w * (0.1 + rand(k + 721) * 0.8) : (rand(k + 722) > 0.5 ? w * 0.08 : w * 0.92), cy = corner < 0.5 ? (rand(k + 723) > 0.5 ? h * 0.12 : h * 0.88) : h * (0.2 + rand(k + 724) * 0.6);
    const R = u * (0.13 + rand(k * 2.3 + 725) * 0.14) * (0.75 + 0.25 * r), f = [rand(k + 726) * TAU, rand(k + 727) * TAU, rand(k + 728) * TAU];
    const edge = (q) => { ctx.beginPath(); for (let i = 0; i <= 64; i++) { const t = (i / 64) * TAU, rr = R * q * (1 + 0.16 * Math.sin(3 * t + f[0]) + 0.09 * Math.sin(7 * t + f[1]) + 0.04 * Math.sin(15 * t + f[2])); ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * 0.86); } ctx.closePath(); };
    edge(1); ctx.fillStyle = css([196, 150, 92], 0.16 * r); ctx.fill();
    ctx.strokeStyle = css([150, 104, 52], 0.12 * r); ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = css([132, 88, 40], 0.4 * r); ctx.lineWidth = 2.2; ctx.stroke();
    edge(0.78); ctx.strokeStyle = css([150, 104, 52], 0.2 * r); ctx.lineWidth = 1.6; ctx.stroke();
  }
  ctx.restore();
}
/**
 * Wormholes: small ragged holes through the leaf, dark where the page beneath shows, ringed with
 * brown, some joined into a short tunnel. More of them, one by one, as `amt` rises.
 */
function wormholes(ctx, w, h, amt) {
  const n = amt * 18;
  ctx.save();
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k), edgeward = rand(k * 2.9 + 730) < 0.6;   // most near the foot and the fore-edge, where the worms come in
    let x = edgeward ? w * (rand(k + 731) > 0.5 ? 0.03 + rand(k + 732) * 0.12 : 0.85 + rand(k + 733) * 0.12) : rand(k + 734) * w, y = edgeward ? h * (0.6 + rand(k + 735) * 0.38) : rand(k + 736) * h;
    let dir = rand(k * 3.3 + 737) * TAU;
    const len = rand(k + 738) < 0.4 ? 3 + Math.floor(rand(k + 739) * 7) : 1;
    for (let j = 0; j < len; j++) {
      const r = 3 + rand(k * 7 + j * 1.9 + 740) * 6;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU, rr = r * (0.7 + 0.5 * rand(k * 11 + j * 3 + i * 1.3 + 741)); ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); }
      ctx.closePath();
      ctx.strokeStyle = css([150, 108, 60], 0.45 * a); ctx.lineWidth = 2.6; ctx.stroke();
      ctx.fillStyle = css([52, 38, 26], 0.92 * a); ctx.fill();
      dir += (rand(k * 5 + j + 742) - 0.5) * 1.4; x += Math.cos(dir) * r * 1.5; y += Math.sin(dir) * r * 1.5;
    }
  }
  ctx.restore();
}
const songke = {
  id: "songke",
  repaint: (c) => `a woodblock illustration from an old Chinese printed book: black ink lines cut with a knife, flat areas of ink, the ground left as warm paper colour, no shading or colour except perhaps a touch of vermilion; scenery simplified into lines and masses as in Song and Ming book illustrations.`,
  about: { zh: "一页宋版古籍：宣纸底色、竖排的宋体标题、朱砂印章样式的角标、粗细双线的版框和界栏，右侧是带鱼尾的版心；界栏里可以排上正文大字和双行小注，加朱笔圈点、旁批和历代藏书印；岁月痕迹有刷印不匀、水渍、虫蛀和霉斑；图形像木刻版画；自带平直的版式。古雅、沉静、有书卷气——适合历史、国学、读书、传统手艺与节气。", en: "A leaf from a Song-dynasty printed book: paper ground, a serif title set in vertical columns, the corner tag as a vermilion seal, a thick-and-thin border and ruled columns, a centre column with fishtails at the right edge; the columns can hold the page's text, large characters and double lines of small notes, with vermilion marks and collectors' seals; the years show as uneven printing, water stains, wormholes and foxing; objects like woodcuts; flat layouts of its own. Classical, calm, bookish — for history, classics, reading, traditional crafts, the seasons." },
  name: { zh: "宋版刻本", en: "Woodblock book" },
  oneTheme: true,
  logoInset: 128,   // the brand logo stands left of the centre column (see frame)
  seeded: true,
  scene: { sealWhite: { zh: "藏书印（白文方印）", en: "Seal (white, square)" }, sealRed: { zh: "藏书印（朱文方印）", en: "Seal (red, square)" }, sealRound: { zh: "藏书印（圆印）", en: "Seal (round)" } },
  params: [
    { key: "rules", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "界栏", en: "Column rules" } },
    { key: "text", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "正文与小注", en: "Text and notes" } },
    { key: "notes", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "朱批圈点", en: "Vermilion marks" } },
    { key: "seals", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "藏书印", en: "Collectors' seals" } },
    { key: "wear", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "刷印不匀", en: "Uneven printing" } },
    { key: "aged", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "做旧", en: "Age" } },
    { key: "stain", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "水渍", en: "Water stains" } },
    { key: "worm", min: 0, max: 1, step: 0.05, def: 0.1, name: { zh: "虫蛀", en: "Wormholes" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vertical", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "标题竖排", en: "Set the title vertically" } },
  ],
  titleFont: (f) => f.serif,
  faces: (f) => ({ cn: f.serif, en: f.serif }),   // everything on the page is cut in the one face
  /** Level bands: a page has no slanted panels. */
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.25, side: 0.32, strip: 0.14 }),
  theme: (base) => ({ ...base, field: css(SONG.paper), text: css(SONG.ink), dim: css(SONG.ink, 0.6), titleFill: css(SONG.ink), titleInk: css(SONG.paper), grid: () => css(SONG.red, 0.24) }),
  background(ctx, env, L, p) {
    const { w, h } = env;
    if (L.ground !== false) { ctx.fillStyle = css(SONG.paper); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {   // as a rubbing would show it: grey, pressed into the paper
      env.drawPhoto(1); wash(ctx, w, h, "multiply", SONG.paper, 1); wash(ctx, w, h, "screen", [60, 48, 36], 0.35);
    }
    const pitch = Math.max(90, Math.round(Math.min(w, h) / 9));
    if (L.grid && p.rules > 0) {   // the ruled columns of the block, right to left, printing darker as the slider goes up
      ctx.fillStyle = css(SONG.ink, 0.6 * Math.pow(p.rules, 0.7));
      for (let x = w - 64 - pitch; x > 64; x -= pitch) ctx.fillRect(x, 58, 1 + p.rules, h - 116);
    }
    if (L.grid || L.fill) { songText(ctx, env, p, pitch); songSeals(ctx, env, p.seals); }
    return true;
  },
  /** Ruled paper in vermilion, as a fair copy is written on: the block's columns, right to left, a narrow gap between them, each cut into squares. */
  gridLines(ctx, env, color) {
    const { w, h } = env, pitch = Math.max(90, Math.round(Math.min(w, h) / 9)), top = 58, bot = h - 58, gap = 5, cols = [];
    for (let x = w - 64; x - pitch >= 64 - 1; x -= pitch) cols.push([x - pitch + gap, x - gap]);
    gridPen(ctx, color); ctx.beginPath();
    for (const [a, b] of cols) {
      ctx.moveTo(a, top); ctx.lineTo(a, bot); ctx.moveTo(b, top); ctx.lineTo(b, bot);
      for (let y = top; y <= bot + 0.5; y += b - a) { ctx.moveTo(a, y); ctx.lineTo(b, y); }
    }
    ctx.stroke(); ctx.restore();
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
    // band (or the foot of the page), and stands clear of the seal, which keeps its corner; left of
    // it, the subtitle's column (see subtitleFit).
    return drawTitleVertical(ctx, title, env.sub && env.sub.vertical ? env.sub.titleBox : songBox(ctx, env, box), { font: fonts.serif, fill: L.ink || css(SONG.ink), hi: L.hi || css(SONG.red), maxFs: 300, weight: 900, only: env.only });   // only: see wovenFront in render.js
  },
  /**
   * The subtitle, with the title in columns: in a column of its own (one per typed line), smaller, left
   * of the title's, so read after it, beginning a character lower; the title's columns move over to
   * make room. Null when the title is not vertical: the usual place, under it.
   */
  subtitleFit(ctx, title, sub, box, env, p) {
    const lines = parseTitle(sub);
    if (!p.vertical || !lines.length) return null;
    const T = titleLayer(env), face = T && T.font ? `"${T.font}", ${fonts.serif}` : fonts.serif, B = songBox(ctx, env, box);
    const full = titleBlockVertical(ctx, title, B, face, 900, 300);
    let fs = subtitleSize(full ? full.fs : Infinity, env.w, env.h), block = null, titleBox = B;
    // its columns as wide as they are set (each a pitch, less the last one's air), then the gap to the title's
    const place = () => { const cols = lines.length * fs * 1.32 - fs * 0.32, room = cols + fs * 0.8; titleBox = { ...B, x: B.x + room, w: Math.max(120, B.w - room) }; block = titleBlockVertical(ctx, title, titleBox, face, 900, 300); return cols; };
    let cols = place();
    if (block && fs > block.fs * SUB.most) { fs = block.fs * SUB.most; cols = place(); }   // smaller than the title, always
    const x = block ? block.x - fs * 0.8 - cols : B.x, down = block ? block.fs : 0;
    // the box a pitch per column wide, as drawTitleVertical sizes columns to fit it
    const sbox = { x, y: B.y + down, w: lines.length * fs * 1.32, h: Math.max(fs * 2, B.h - down) };
    return { vertical: true, fs, titleBox, box: sbox, ink: titleBlockVertical(ctx, sub, sbox, face, 700, fs), face: (f) => f.serif, weight: 700, fill: css(SONG.ink), hi: css(SONG.red) };
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
    if (p.rules <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.rules / 0.6);   // the centre column comes in with the rules, full by 0.6
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
    ctx.restore();
  },
  /** Ink that took unevenly, water stains with their tide lines, wormholes, foxing and a darkened edge, the paper's grain. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, SONG.paper, p.wear * 0.9);
    if (p.stain > 0) waterStains(ctx, w, h, p.stain);
    if (p.worm > 0) wormholes(ctx, w, h, p.worm);
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

// ====================================================================== summer illustration: a city in the clouds, in flat paint
// A saturated animated illustration of a summer's day: one flat, strong azure sky; towering cumulus built of lobe upon
// lobe, each lit from above in hard-edged planes — white, a pale tint, a periwinkle shade — with a fine
// indigo line along the lower edge of every lobe; coral-red towers with brass pipes, a skyline of
// signboards and lanterns, strings of pennants. Everything in flat colour with crisp edges and fine
// lines, never a gradient. Whites are clean, lines indigo, never black.
const VV = {
  navy: [22, 34, 96],              // the title's keyline and solid shadow, the plates' lines
  line: [50, 70, 166],             // the fine line of the illustration
  cream: [255, 250, 236],          // sunlit white of lettering and plates
  butter: [255, 220, 132],         // the lower part of sunlit lettering
  sky: [20, 106, 214],
  white: [255, 255, 255], pale: [214, 226, 252], shade: [152, 184, 240],   // a cloud, from the sun into shade
  red: [246, 96, 96], redLit: [255, 150, 140], redShade: [214, 54, 74],
  gold: [234, 176, 66], goldLit: [255, 222, 130], goldShade: [186, 120, 42],
  lit: [255, 247, 228], deep: [50, 66, 146],                               // the faces of objects: warm in the sun, cool out of it
};
const TOWN = [[252, 240, 220], [246, 96, 96], [70, 140, 226], [36, 64, 160], [250, 176, 172], [244, 246, 252], [234, 176, 66]];
const PENNANTS = [[246, 96, 96], [255, 250, 236], [70, 140, 226], [234, 176, 66], [250, 176, 172]];
const TAU = Math.PI * 2;
/**
 * A colour as summer light shows it: the saturation pushed most of the way up, the hue kept, the
 * lightness kept within the range where it still reads as a colour. Greys stay grey.
 */
function boost(c, k = 0.45) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.04) return [c[0], c[1], c[2]];
  const s = (l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo)) * (1 - k) + k, L = clamp(l, 0.3, 0.66);
  const hue = ((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  const q = (1 - Math.abs(2 * L - 1)) * s, x = q * (1 - Math.abs(((hue / 60) % 2) - 1)), m = L - q / 2;
  const [R, G, B] = hue < 60 ? [q, x, 0] : hue < 120 ? [x, q, 0] : hue < 180 ? [0, q, x] : hue < 240 ? [0, x, q] : hue < 300 ? [x, 0, q] : [q, 0, x];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255];
}
/** A rectangle with round corners, as a path (added to the current one). */
function rounded(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** A closed polygon of points [[x, y], …], as the current path. */
const shapeOf = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
/**
 * A billowing cumulus, painted as the animated films paint it but flat. Its body is rows of round lobes
 * narrowing toward the top. The light comes from the upper left, and is laid on the whole cloud at
 * once: the body in periwinkle shade, then every lobe again, moved toward the light, in a pale tint,
 * and again, further, in white — so neighbouring lobes merge into broad lit masses, and a crescent of
 * shade is left on the lower right of each. An indigo line runs round the cloud, along its flat base,
 * and in short strokes where some lobes meet the shade. (x, y): the middle of its flat base; s: its
 * half-width there; tall: its height in half-widths; k (with the seed) places the lobes.
 */
function billow(ctx, x, y, s, tall, k) {
  const lobes = [], rows = Math.max(2, Math.round(1.6 + tall * 1.7));
  for (let j = 0; j < rows; j++) {
    const t = rows === 1 ? 0 : j / (rows - 1), half = s * (1 - 0.62 * t) * (0.88 + rand(k + j * 1.9) * 0.24), cy = y - tall * s * (0.14 + 0.72 * t);
    const n = Math.max(1, Math.round(1.6 + 3.4 * (1 - t))), r0 = s * (0.26 + 0.1 * (1 - t));
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      lobes.push([x + u * half * 0.78 + (rand(k + j * 7.3 + i * 2.1) - 0.5) * s * 0.24, cy + (rand(k + j * 3.1 + i * 5.7) - 0.5) * s * 0.18, r0 * (0.66 + rand(k + j * 4.3 + i) * 0.66)]);
    }
  }
  // small lobes along the sides and the top, so the edge is broken into many bumps
  const big = lobes.length;
  for (let i = 0; i < 24; i++) {
    const [cx, cy, r] = lobes[Math.floor(rand(k + i * 9.7 + 50) * big)], a = -Math.PI * (rand(k + i * 2.9 + 51) * 1.0);
    lobes.push([cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84, r * (0.2 + rand(k + i * 4.1 + 52) * 0.16)]);
  }
  const lw = Math.max(1.5, s * 0.01);
  const body = (dx, dy, kr, grow = 0) => { ctx.beginPath(); for (const [cx, cy, r] of lobes) { const q = r * kr + grow; ctx.moveTo(cx + dx * r + q, cy + dy * r); ctx.arc(cx + dx * r, cy + dy * r, q, 0, TAU); } };
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4 * s, y - 8 * s, 8 * s, 8 * s); ctx.clip();   // the flat base
  body(0, 0, 1, lw); ctx.fillStyle = css(VV.line); ctx.fill();                  // the outline, under everything
  body(0, 0, 1); ctx.fillStyle = css(VV.shade); ctx.fill(); ctx.clip();
  body(-0.07, -0.13, 0.96); ctx.fillStyle = css(VV.pale); ctx.fill();
  body(-0.17, -0.29, 0.86); ctx.fillStyle = css(VV.white); ctx.fill();
  ctx.strokeStyle = css(VV.line); ctx.lineWidth = lw * 0.85; ctx.lineCap = "round";
  lobes.forEach(([cx, cy, r], i) => {   // short strokes where some lobes turn from the light into shade
    if (rand(k + i * 3.3 + 70) < 0.5) return;
    const a0 = Math.PI * (0.02 + rand(k + i * 1.7 + 71) * 0.2);
    ctx.beginPath(); ctx.arc(cx - r * 0.07, cy - r * 0.13, r * 0.96, a0, a0 + Math.PI * (0.3 + rand(k + i * 2.3 + 72) * 0.25)); ctx.stroke();
  });
  ctx.fillStyle = css(VV.shade); ctx.fillRect(x - 4 * s, y - s * 0.1, 8 * s, s * 0.1);   // the flat underside, in shade
  ctx.fillStyle = css(VV.line); ctx.fillRect(x - 4 * s, y - lw * 1.5, 8 * s, lw * 1.5);
  ctx.restore();
}
/**
 * A coral-red tower of the sky city, standing on the horizon at x: a cylinder in hard planes (a lit
 * strip, the body, the shaded side), ringed with bands, two of them brass; a drum and a dome on top
 * with a mast; a brass pipe climbing one side and turning into it. Fine indigo lines throughout.
 */
function skyTower(ctx, x, base, tw, th) {
  const top = base - th, l = x - tw / 2, lw = Math.max(1.6, tw * 0.025), line = css(VV.line);
  const band = (y0, y1, c, cl, cs) => { ctx.fillStyle = css(c); ctx.fillRect(l, y0, tw, y1 - y0); ctx.fillStyle = css(cl); ctx.fillRect(l + tw * 0.1, y0, tw * 0.14, y1 - y0); ctx.fillStyle = css(cs); ctx.fillRect(x + tw * 0.2, y0, tw * 0.3, y1 - y0); };
  band(top, base, VV.red, VV.redLit, VV.redShade);
  ctx.strokeStyle = line; ctx.lineWidth = lw;
  for (let i = 1; i < 8; i++) {
    const y = top + (th * i) / 8;
    if (i === 3 || i === 6) { band(y - tw * 0.05, y + tw * 0.05, VV.gold, VV.goldLit, VV.goldShade); ctx.strokeRect(l, y - tw * 0.05, tw, tw * 0.1); }
    else { ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + tw, y); ctx.stroke(); }
  }
  ctx.strokeRect(l, top, tw, th);
  // the drum, the dome, the mast
  const dw = tw * 1.18, dh = tw * 0.22, dl = x - dw / 2;
  ctx.fillStyle = css(VV.redShade); ctx.fillRect(dl, top - dh, dw, dh); ctx.fillStyle = css(VV.red); ctx.fillRect(dl, top - dh, dw * 0.6, dh); ctx.strokeRect(dl, top - dh, dw, dh);
  ctx.beginPath(); ctx.arc(x, top - dh, tw * 0.42, Math.PI, 0); ctx.closePath(); ctx.fillStyle = css(VV.gold); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, top - dh, tw * 0.42, Math.PI, Math.PI * 1.45); ctx.lineTo(x, top - dh); ctx.closePath(); ctx.fillStyle = css(VV.goldLit); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, top - dh - tw * 0.42); ctx.lineTo(x, top - dh - tw * 0.95); ctx.stroke();
  // the pipe: up the right side, turning into the tower twice
  const pw = tw * 0.16, px = x + tw / 2 + tw * 0.14, pipe = (rx, ry, rw, rh) => { ctx.fillStyle = css(VV.gold); ctx.fillRect(rx, ry, rw, rh); ctx.fillStyle = css(VV.goldLit); ctx.fillRect(rx + (rw > rh ? 0 : rw * 0.2), ry + (rw > rh ? rh * 0.2 : 0), rw > rh ? rw : rw * 0.25, rw > rh ? rh * 0.25 : rh); ctx.strokeRect(rx, ry, rw, rh); };
  pipe(px, top + th * 0.2, pw, th * 0.8);
  for (const f of [0.2, 0.62]) pipe(x + tw / 2 - lw, top + th * f, px - (x + tw / 2) + pw, pw);
}
/**
 * The sky city's street on the horizon `at(x)`: a row of houses of uneven width and height, each a
 * flat colour with a shaded side and windows, some with a tall signboard or a red lantern; fine
 * indigo lines. Their feet go below the horizon, behind the colour field. As `amt` goes up from 0
 * the row rises from behind the horizon (full by 0.3), then the houses grow taller.
 */
function skyline(ctx, w, h, amt, at0) {
  const u = Math.min(w, h), most = u * (0.07 + 0.1 * amt), sink = (1 - clamp(amt / 0.3)) * most * 1.25, at = (x) => at0(x) + sink;
  const line = css(VV.line), lw = Math.max(1.4, u * 0.0016);
  ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.lineJoin = "miter";
  for (let x = -u * 0.02, i = 0; x < w + u * 0.02; i++) {
    const bw = u * (0.045 + rand(i * 2.7 + 91) * 0.07), bh = most * (0.32 + rand(i * 3.9 + 92) * 0.68), c = TOWN[Math.floor(rand(i * 5.1 + 93) * TOWN.length)];
    const x0 = x, x1 = x + bw, top = Math.min(at(x0), at(x1)) - bh, foot = (xx) => at(xx) + u * 0.06;
    shapeOf(ctx, [[x0, foot(x0)], [x0, top], [x1, top], [x1, foot(x1)]]); ctx.fillStyle = css(c); ctx.fill();
    ctx.fillStyle = css(mix(c, VV.navy, 0.24)); ctx.fillRect(x0 + bw * 0.7, top, bw * 0.3, Math.max(at(x0), at(x1)) - top + u * 0.06);
    shapeOf(ctx, [[x0, foot(x0)], [x0, top], [x1, top], [x1, foot(x1)]]); ctx.stroke();
    ctx.fillStyle = line; ctx.fillRect(x0 - bw * 0.06, top - lw * 2, bw * 1.12, lw * 3);   // the eave
    const ws = bw * 0.14, win = lum(c) > 0.6 ? css(VV.deep) : css(VV.cream);
    for (let r = 0; top + bw * 0.22 + r * ws * 2.2 < at(x0) - ws; r++) for (let q = 0; q < 3; q++) if (rand(i * 9 + r * 3 + q) > 0.3) { ctx.fillStyle = win; ctx.fillRect(x0 + bw * (0.12 + q * 0.2), top + bw * 0.22 + r * ws * 2.2, ws, ws * 1.3); }
    if (rand(i * 4.4 + 95) > 0.45 && bh > bw * 0.5) {   // a tall signboard: a colour, a border and three strokes of lettering
      const sw = bw * 0.22, sh = Math.min(bh * 0.8, sw * 4.2), sx = x0 + (rand(i * 6.1 + 96) > 0.5 ? -sw * 0.4 : bw - sw * 0.6), sy = top + bh * 0.08, red = rand(i * 7.7 + 97) > 0.4;
      ctx.fillStyle = css(red ? VV.red : VV.cream); ctx.fillRect(sx, sy, sw, sh); ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = css(red ? VV.cream : VV.red); for (let q = 0; q < 3; q++) ctx.fillRect(sx + sw * 0.28, sy + sh * (0.12 + q * 0.28), sw * 0.44, sh * 0.16);
    }
    if (rand(i * 8.3 + 98) > 0.55) {   // a lantern under the eave
      const lr = bw * 0.1, lx = x0 + bw * (0.2 + rand(i * 2.2 + 99) * 0.6), ly = top + lr * 2.4;
      ctx.beginPath(); ctx.ellipse(lx, ly, lr, lr * 1.25, 0, 0, TAU); ctx.fillStyle = css(VV.red); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css(VV.cream); ctx.fillRect(lx - lr, ly - lr * 0.15, lr * 2, lr * 0.3);
    }
    x += bw * (0.86 + rand(i * 1.3 + 94) * 0.28);
  }
}
/**
 * Strings of pennants across the sky: a sagging line, small flags hanging from it in the city's
 * colours. `amt` (0–1) brings them in by degrees: the first string over the first half (its line
 * drawn in, its flags growing from small to full), the second over the other half.
 */
function pennants(ctx, w, top, amt) {
  const line = VV.line, step = Math.max(26, w / 60);
  for (let s = 0; s < 2; s++) {
    const r = clamp(amt * 2 - s);
    if (r <= 0) break;
    const y0 = top * (0.2 + 0.22 * s + rand(s * 7 + 101) * 0.1), y1 = y0 + (rand(s * 5 + 102) - 0.5) * top * 0.2, sag = top * (0.07 + rand(s * 3 + 103) * 0.05);
    const at = (t) => [-20 + (w + 40) * t, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1];
    ctx.beginPath(); for (let t = 0; t <= 1.0001; t += 0.02) { const [x, y] = at(t); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = css(line, Math.min(1, r * 3)); ctx.lineWidth = 1.8; ctx.stroke();
    const count = Math.ceil((w + 40) / step), wide = 0.3 + 0.4 * r, drop = step * (0.3 + 0.65 * r);
    ctx.strokeStyle = css(line);
    for (let i = 0; i < count; i++) {
      const [ax, ay] = at(i / count), [bx, by] = at((i + wide) / count), c = PENNANTS[(i + s * 2) % PENNANTS.length];
      shapeOf(ctx, [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2 + drop]]); ctx.fillStyle = css(c); ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
}
const vivid = {
  id: "vivid",
  repaint: (c) => `a saturated animated-film illustration of a city in the clouds, pushed to the bold colour of a travel poster: one flat, strong azure sky, towering billowing cumulus clouds painted in hard-edged planes of white, pale blue and periwinkle with fine indigo lines along each lobe, coral-red towers with brass pipes, signboards, lanterns and strings of pennants; every surface in flat, clean colour with crisp edges and fine lines, no gradients; bright and clear, with ${c} as an accent colour.`,
  about: { zh: "夏日的高饱和动画插画：一整块浓烈的天蓝天空，层层翻涌的巨大积云——每一团都是白、淡蓝、长春花蓝三块硬边平涂，再用细细的靛蓝线勾出轮廓；远处是珊瑚红的高塔和黄铜管道、挂着招牌和灯笼的街景，天上拉着成串的三角彩旗。全部是硬边平涂加细线，不用渐变。标题上白下暖黄，配深靛蓝勾边和实心立体投影；可加米白明信片边框，照片调得更鲜艳、更暖。饱和、明亮、细节丰富——适合旅行、城市漫步、生活、美食、节日与治愈系内容。", en: "A summer's day as a saturated animated illustration: one strong azure sky, huge billowing cumulus — every lobe in three hard-edged planes of white, pale blue and periwinkle, outlined in fine indigo — coral-red towers with brass pipes, a skyline of signboards and lanterns, strings of pennants across the sky. Flat colour and fine lines throughout, never a gradient. The title is white over warm yellow with an indigo keyline and a solid block shadow; a cream postcard border is optional, and photos are made more vivid and warmer. Saturated, bright and full of detail — for travel, city walks, everyday life, food, festivals and feel-good content." },
  name: { zh: "夏日插画", en: "Summer illustration" },
  oneTheme: true,              // always the azure sky: the light / dark choice does not apply
  seeded: true,                // clouds, towers, houses and pennants are placed at random: the Style tab offers to shuffle them
  scene: { cumulus: { zh: "积云", en: "Cumulus" }, towers: { zh: "高塔", en: "Towers" } },
  params: [
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "积云", en: "Cumulus" } },
    { key: "town", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "街景与高塔", en: "Town and towers" } },
    { key: "flags", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "彩旗", en: "Pennants" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "明信片边框", en: "Postcard border" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vivid", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "照片鲜艳度", en: "Photo vividness" } },
  ],
  theme: (base) => ({ ...base, field: css(VV.sky), text: css(VV.cream), dim: css(VV.cream, 0.72), titleFill: css(VV.cream), titleInk: css(VV.navy), grid: () => css(VV.white, 0.2) }),
  /**
   * One flat azure sky. With the background's decoration on, from the back: a tower or two of the sky
   * city, clouds massed round their feet and on both sides, the street on the horizon, and pennants.
   * The horizon is the top edge of the colour field when the field is below (it becomes the ground in
   * front), else the foot of the picture. A photo is laid over the sky and made more vivid: once more
   * over itself in soft light, its saturation pushed up, and the whole warmed as by late sun.
   */
  background(ctx, env, L, p) {
    const { w, h } = env;
    if (L.ground !== false) { ctx.fillStyle = css(VV.sky); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      if (p.vivid > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.55 * p.vivid; env.drawPhoto();
        ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.32 * p.vivid; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.4 * p.vivid; ctx.fillStyle = css([255, 190, 104]); ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      return true;
    }
    if (!L.grid) return true;
    const E = env.G && env.G.edge, line = E && E.ny < 0 && E.line;
    const at = line ? (x) => line[1] + ((line[3] - line[1]) * (x - line[0])) / (line[2] - line[0] || 1) : () => h;
    const top = line ? Math.min(line[1], line[3]) : h * 0.9, u = Math.min(w, h), c = p.clouds, t = p.town;
    const ramp = (v, a, b) => clamp((v - a) / (b - a));
    const street = u * 0.1 * t, ground = (x) => at(x) - street;      // where clouds stand: behind the houses
    const room = (x) => ground(x) - Math.max(top * 0.24, 150);        // how tall a cloud may be there: clear of the brand row
    // A cloud comes in small and grows to its full size (`grow`, 0–1) as the slider passes its stretch,
    // so turning the slider up adds clouds one after another, the great masses first.
    // The clouds move together as a scene object, the towers as another.
    const mass = (fx, k, size, tall, grow) => { if (grow <= 0) return; const x = w * fx, s = Math.min(u * size * (0.1 + 0.9 * grow), room(x) / (0.86 * tall + 0.62)); if (s > u * 0.025) { ctx.save(); shift("cumulus", w * 0.5, top * 0.55, ctx); billow(ctx, x, ground(x), s, tall, k); ctx.restore(); } };
    // far off, behind the towers
    mass(0.36 + rand(131) * 0.24, 132, 0.1, 0.9, ramp(c, 0.25, 0.5));
    mass(0.26 + rand(133) * 0.1, 134, 0.16, 1.15, ramp(c, 0.4, 0.65));
    mass(0.5 + rand(135) * 0.1, 136, 0.12, 1.05, ramp(c, 0.55, 0.8));
    mass(0.4 + rand(137) * 0.1, 138, 0.13, 1.3, ramp(c, 0.85, 1));
    // The towers rise from behind the horizon as the slider goes up: the first from 0.3, full at 0.7;
    // the second from 0.65, full at 1. Their feet are hidden by the colour field and the houses.
    const t1 = ramp(t, 0.3, 0.7), t2 = ramp(t, 0.65, 1), tx = w * (0.58 + rand(141) * 0.12), tw = u * (0.05 + 0.02 * t), th = Math.max(u * 0.1, at(tx) - top * (0.3 - 0.12 * t));
    ctx.save(); if (t1 > 0) shift("towers", tx, at(tx) - th * 0.5, ctx);
    if (t2 > 0) { const sx = tx + w * (rand(142) > 0.5 ? 0.1 : -0.1), sw = tw * 0.7, sh = th * 0.62; skyTower(ctx, sx, at(sx) + (1 - t2) * (sh + sw * 1.6), sw, sh); }
    if (t1 > 0) skyTower(ctx, tx, at(tx) + (1 - t1) * (th + tw * 1.6), tw, th);
    ctx.restore();
    // near, in front of the towers: a great mass on each side, then more toward the edges
    mass(0.06 + rand(151) * 0.2, 152, 0.34, 1.5 + rand(153) * 0.4, ramp(c, 0, 0.4));
    mass(0.72 + rand(154) * 0.2, 155, 0.31, 1.7 + rand(156) * 0.5, ramp(c, 0.08, 0.5));
    mass(0.93 + rand(158) * 0.08, 159, 0.2, 1.3, ramp(c, 0.7, 0.9));
    mass(0.61 + rand(141) * 0.12, 157, 0.17, 0.85, Math.min(ramp(c, 0.15, 0.45), t1 * 2));   // round the tower's foot
    if (t > 0) skyline(ctx, w, h, t, at);
    if (p.flags > 0) pennants(ctx, w, top, p.flags);
    return true;
  },
  /** A festival lattice across the sky: fine lines on the slant both ways, crossing into diamonds as strings of pennants do. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, 0.5, 100); slantPath(ctx, w, h, -0.5, 100); ctx.restore();
  },
  accent: {
    fill: (C) => css(boost(C)),
    tone: () => "rgba(0,0,0,0)", toneScale: 0,     // flat: no screentone
    /** The edge of a sunlit field: a band of the colour in full light just inside it, and an indigo line on it. */
    edge(ctx, run, nx, ny, C) {
      ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.strokeStyle = css(mix(boost(C), VV.cream, 0.5)); ctx.lineWidth = 24; run(-nx * 12, -ny * 12);
      ctx.strokeStyle = css(VV.navy); ctx.lineWidth = 9; run(0, 0);
    },
  },
  /**
   * Upright lettering lit from above: warm white letters (highlighted words in the channel colour, made
   * vivid) whose lower part is in a warmer, deeper tone with a hard edge between, an indigo keyline, and
   * a solid indigo block below and to the right — the letters stepped down, not a soft shadow.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, line = fs * 0.085 * o.strokeAmt, depth = fs * 0.075 * o.shadowAmt;
    const face = o.fill || VV.cream, hiFace = o.hi || boost(o.C || VV.red);
    const lower = (c) => (c === VV.cream ? VV.butter : mix(c, VV.navy, 0.22));
    ctx.lineJoin = "round";
    if (depth > 0) {
      const steps = fast ? 3 : Math.max(2, Math.min(10, Math.round(depth / (fs * 0.009))));
      ctx.fillStyle = ctx.strokeStyle = css(VV.navy); ctx.lineWidth = line;
      for (let i = steps; i >= 1; i--) { const d = (depth * i) / steps; pass((a, x) => { if (line > 0) ctx.strokeText(a.t, x + d, d); ctx.fillText(a.t, x + d, d); }); }
    }
    if (line > 0) { ctx.strokeStyle = css(VV.navy); ctx.lineWidth = line; pass((a, x) => ctx.strokeText(a.t, x, 0)); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hiFace : face); ctx.fillText(a.t, x, 0); });
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -fs * 0.3, 2e5, fs); ctx.clip();
    pass((a, x) => { ctx.fillStyle = css(lower(a.hi ? hiFace : face)); ctx.fillText(a.t, x, 0); });
    ctx.restore();
  },
  /** The plate under a text layer: a rounded card with an indigo line and a hard indigo shadow. */
  plate(ctx, x, y, w, h, colour, fs) {
    const r = Math.min(h / 2, fs * 0.3), d = fs * 0.08;
    ctx.beginPath(); rounded(ctx, x + d, y + d, w, h, r); ctx.fillStyle = css(VV.navy); ctx.fill();
    ctx.beginPath(); rounded(ctx, x, y, w, h, r); ctx.fillStyle = colour; ctx.fill();
    ctx.lineWidth = fs * 0.05; ctx.strokeStyle = css(VV.navy); ctx.stroke();
  },
  // objects are lit as the clouds are: warm cream in the sun, periwinkle in shade, indigo lines;
  // the small cover parts keep their construction and take the indigo and cream
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: VV.navy, light: VV.cream, colour: boost }, stroke: { ink: VV.navy, light: VV.cream } }
    : { fill: { ink: VV.navy, light: VV.lit, mid: VV.shade, dark: VV.deep, colour: boost }, stroke: { ink: VV.navy, light: VV.cream, colour: boost }, line: 0.9 }),
  sticker: painters({ line: VV.navy, lineScale: 0.8,
    tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const r = role(c); return css(r === "ink" ? VV.navy : r === "colour" ? boost(c) : r === "light" ? VV.cream : c, c[3]); },
    shadow(ctx, draw) { ctx.save(); ctx.translate(6, 7); draw(css(VV.navy, 0.55)); ctx.restore(); } }),
  /**
   * The corner tag: a cream pill, as the sign of a country bus stop, with an indigo line, a hard shadow,
   * and a dot of the channel colour before the lettering — it reads on the sky and on the field alike.
   */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 1.75, h = fs * 1.34, pill = (dx) => { ctx.beginPath(); rounded(ctx, x + dx, y + dx, w, h, h / 2); };
    pill(6); ctx.fillStyle = css(VV.navy); ctx.fill();
    pill(0); ctx.fillStyle = css(VV.cream); ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = css(VV.navy); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + h * 0.52, y + h / 2, fs * 0.17, 0, TAU); ctx.fillStyle = css(boost(C)); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = ink || css(VV.navy); spaced(ctx, str, x + h * 0.52 + fs * 0.42, y + h * 0.5 + fs * 0.36, 3);
    return { x: x - 6, y: y - 6, w: w + 18, h: h + 18 };
  },
  /** The frame layer: a cream postcard border with round inner corners and an indigo hairline round the picture. */
  frame(ctx, env, p) {
    const { w, h } = env, b = 40 * p.border;
    if (b < 1) return;
    const r = 12 + b * 0.8;
    ctx.beginPath(); ctx.rect(0, 0, w, h); rounded(ctx, b, b, w - 2 * b, h - 2 * b, r);
    ctx.fillStyle = css(VV.cream); ctx.fill("evenodd");
    ctx.beginPath(); rounded(ctx, b, b, w - 2 * b, h - 2 * b, r); ctx.lineWidth = 3; ctx.strokeStyle = css(VV.navy); ctx.stroke();
  },
  /** An uploaded image gets a hard indigo shadow, as stickers do. */
  image(ctx, C, unit) { ctx.shadowColor = css(VV.navy, 0.55); ctx.shadowBlur = 0; ctx.shadowOffsetX = 8 * unit; ctx.shadowOffsetY = 10 * unit; },
  /** Paper: the faint tooth of a poster or a gouache sheet. */
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.55, unit); },
  prompt: `Stickers for a saturated animated-film illustration of a sunny city in the clouds, drawn as a bold flat poster — friendly, clear and full of detail — that read at a glance:
- clean, characterful shapes with a clear silhouette (lanterns, signboards, pennants, clouds, fruit, small creatures, everyday things); simple and charming; no realism, no perspective, no fine texture;
- flat, saturated colour only — never gradients; the light comes from above: give a form one flat lit patch (a lighter tint, with "shadow": false) and one flat shaded patch (a cooler, deeper tint), with crisp edges between them;
- every shape automatically gets a deep indigo outline and a hard offset shadow: do NOT draw outlines or shadows yourself;
- 2 to 4 colours per sticker: the main colour with "white" (a warm cream), "red" (coral), "yellow" (brass) or "blue" (azure) as partners; "ink" comes out deep indigo — for small details only.`,
  solidPrompt: `Props and buildings from a saturated animated film set in a sunny city in the clouds — a tower, a kiosk, a lantern, a tram, a kettle — built as simple models from a few boxes and cylinders with friendly proportions; no realism, no fine detail.
- the renderer paints faces in the sun warm cream, faces in shade a periwinkle blue, and every edge deep indigo: do NOT try to draw shading or outlines yourself;
- "white" is warm cream, "dark" a deep indigo, and "main" the channel colour made more vivid — use it for one to three parts (a roof, a door, a body).`,
};

// ====================================================================== shared by the poster looks below
/** Whether two colours are within `d` of each other (straight-line distance in RGB). */
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;
/** A star mark: four points with hollow sides (a sparkle), or five. */
function starMark(ctx, x, y, r, points, colour) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points, q = i % 2 ? r * (points === 4 ? 0.2 : 0.45) : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
  ctx.closePath(); ctx.fillStyle = css(colour); ctx.fill();
}
/**
 * The box the title will fill, set the usual way in the layout's place, and the subtitle's under it (for
 * a look's background to keep clear of them), or null when the title is hidden or empty. A move of the
 * title layer is not counted.
 */
function titleArea(ctx, env) {
  const T = titleLayer(env), box = titleBase(env);
  if (!T || !box || typeof ctx.measureText !== "function") return null;
  const face = current.titleFont ? current.titleFont(fonts) : fonts.cn;
  const bend = T.bend ? { id: T.bend, amt: T.bendAmt ?? 1, own: T.bend === "taper" && !!T.warp } : null;
  return withSub(titleBlock(ctx, env.cover.title, box, T.font ? `"${T.font}", ${face}` : face, 340, env.sub && !env.sub.vertical ? env.sub.reserve : 0, bend), env);
}
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
function graphicTop(env, x0, x1) {
  const A = env.G && env.G.art, on = env.graphic && env.cover && env.cover.layers.some((l) => l.id === "graphic" && l.visible);
  if (!A || !on) return Infinity;
  const half = 310 * A.s;
  return A.x + half > x0 && A.x - half < x1 ? A.y - half - 24 : Infinity;
}
const canPaint = (ctx) => typeof document !== "undefined" && !!ctx.canvas && typeof ctx.getTransform === "function";
/**
 * A work canvas the size of ctx's, cleared, drawing with ctx's transform: for painting something whole
 * and then laying it down at once — with an alpha or a mode, or after cutting into it. One per `slot`.
 */
function workLike(ctx, slot) {
  const cv = ctx.canvas, s = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (s.width !== cv.width || s.height !== cv.height) { s.width = cv.width; s.height = cv.height; }
  const x = s.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.shadowColor = "rgba(0,0,0,0)"; x.shadowBlur = 0;
  x.clearRect(0, 0, s.width, s.height); x.setTransform(ctx.getTransform());
  x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;   // lettering painted on it matches what was measured
  return x;
}
/** Lays a work canvas (see workLike) down on ctx, pixel for pixel. */
function layDown(ctx, x, alpha = 1, mode = "source-over") { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = mode; ctx.drawImage(x.canvas, 0, 0); ctx.restore(); }
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
function blurred(ctx, r, colour, draw) {
  const m = ctx.getTransform(), D = 30000;
  ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = Math.max(0.1, r * Math.hypot(m.a, m.b)); ctx.shadowOffsetX = D * m.a; ctx.shadowOffsetY = D * m.b;
  ctx.translate(-D, 0); draw(); ctx.restore();
}
/** What a look's figure is drawn from: the graphic the user put in its place for this look, else the channel graphic (see `art`). */
const figureOf = (env) => env && (env.figure || env.graphic);
/**
 * A graphic as a flat silhouette — the figure's (see figureOf), or `g`: opaque white where it is solid,
 * its soft ground shadow and half-clear parts left out, on a canvas 1200 px square covering ±330 units;
 * `box`: its solid part, in units. Kept per look and graphic (a look's line work changes the outline a little).
 */
function graphicShape(env, g = figureOf(env)) {
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
function placeShape(ctx, shape, colour, cx, cy, size, rot = 0) {
  const b = shape.box, k = size / Math.max(1, b.y1 - b.y0);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot); ctx.scale(k, k); ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tintedShape(shape, colour), -shape.R, -shape.R, 2 * shape.R, 2 * shape.R);
  ctx.restore();
}
/** The part of the canvas the colour block leaves open — where a look puts its picture — and the block's side. */
function openField(env) {
  const { w, h } = env, E = env.G && env.G.edge;
  if (!E) return { x0: 0, y0: 0, x1: w, y1: h, side: "none" };
  const [ax, ay, bx, by] = E.line;
  if (E.ny < -0.5) return { x0: 0, y0: 0, x1: w, y1: Math.max(ay, by), side: "below" };
  if (E.ny > 0.5) return { x0: 0, y0: Math.min(ay, by), x1: w, y1: h, side: "above" };
  if (E.nx < -0.5) return { x0: 0, y0: 0, x1: Math.max(ax, bx), y1: h, side: "right" };
  return { x0: Math.min(ax, bx), y0: 0, x1: w, y1: h, side: "left" };
}
/** A halftone screen over what is there: dots of `colour` on a 45° lattice, `pitch` units apart, laid in `mode`. */
function dotScreen(ctx, w, h, colour, pitch, alpha, mode = "multiply") {
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
function crumple(ctx, w, h, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.min(1, amt); ctx.imageSmoothingEnabled = true; ctx.drawImage(crumpled(w, h), 0, 0, w, h); ctx.restore();
}
/** A soft dark ring round the edge of the picture. */
function vignette(ctx, w, h, colour, alpha, inner = 0.42) {
  if (alpha <= 0) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  g.addColorStop(0, css(colour, 0)); g.addColorStop(1, css(colour, Math.min(1, alpha)));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
/**
 * Greeked text: lines of thin bars the length of words, for the dense small print of a poster without
 * inventing words. (x, y): the first line's top; `lines` of `lh` pitch, `width` wide, aligned `align`.
 */
function greeked(ctx, x, y, width, lines, lh, colour, k, align = "left") {
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
function wornTexture(w, h) {
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
function wear(ctx, w, h, colour, alpha, mode = "lighten", mask = null, base = 0) {
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
/**
 * A band across the sheet about the line `y`, soft at its two sides (stacked rectangles, narrower
 * toward the middle) and, along it, stronger and weaker by turns: `colour` at `alpha` at most.
 */
function softBand(ctx, x0, x1, y, half, colour, alpha, k) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, css(colour, alpha * (0.15 + 0.85 * rand(k + i * 1.7))));
  ctx.save(); ctx.fillStyle = g; ctx.globalAlpha = 0.3;
  for (const q of [1, 0.72, 0.46, 0.22]) ctx.fillRect(x0, y - half * q, x1 - x0, half * q * 2);
  ctx.restore();
}

// ====================================================================== negative space: the red and black film poster
// Saul Bass and the Polish poster school, by way of today's minimal film posters: red, black and an
// off-white; one huge silhouette carrying the idea, cut against the ground so that the shapes between
// read as much as the shapes; a small, exact title; a few lines of credits. Flat, hard-edged, a little
// rough, as a screen print is.
const NEG = { red: [212, 30, 36], black: [16, 13, 13], cream: [242, 233, 214] };
const negSpot = (C) => (values.chan ? C : NEG.red);                       // the one colour: red, or the channel's
const negGround = (C) => (dark ? NEG.black : negSpot(C)), negInk = (C) => (dark ? negSpot(C) : NEG.black);
/** Where the giant silhouette stands: on the open field's floor, toward its far side, behind the channel graphic like its huge shadow, cropped by the floor and the edge. */
function negPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 1.05 * p.giant);
  return { F, cx: F.x0 + fw * (0.66 + rand(181) * 0.1), cy: F.y1 - size * 0.36, size, rot: (rand(182) - 0.5) * 0.24 };
}
const negative = {
  id: "negative",
  art: "giant",
  repaint: (c) => `a minimalist film poster made from a photograph: hard black-and-white with crushed blacks and clean whites, printed over a flat vermilion red, high contrast, a little screen-print roughness; the subject read as a bold silhouette; still the same picture, no text.`,
  about: { zh: "红黑负形海报：索尔·巴斯和波兰海报学派的路子——红、黑、米白三色，一个巨大的剪影承载全部意思（用的是频道图形的轮廓，被画面边缘裁切），剪影和底色互相咬合，空出来的形和画出来的形一样有分量；可加一块反色的负形分割、聚光光束、牵引的细线；标题小而精确，底部几行演职员小字，丝网印刷的粗糙质感。可选红底黑形或黑底红形，也可以用频道色代替红色。冷峻、有隐喻、一眼就懂——适合电影、书评、社会议题、悬疑与观点类内容。", en: "A red-and-black negative-space poster, after Saul Bass and the Polish poster school: red, black and off-white; one huge silhouette carries the idea (the channel graphic's outline, cropped by the edge), cut against the ground so the shapes between read as much as the shapes; optionally a reversed split, a spotlight beam, taut threads; a small exact title, a few lines of credits, the roughness of a screen print. Black on red or red on black, and the channel colour can stand in for the red. Stark, metaphorical, read at a glance — for film, books, social issues, mysteries, opinion." },
  name: { zh: "负形海报", en: "Negative space" },
  seeded: true,
  scene: { giant: { zh: "巨型剪影", en: "Giant silhouette" }, beam: { zh: "聚光光束", en: "Spotlight beam" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "巨型剪影", en: "Giant silhouette" } },
    { key: "cut", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "负形分割", en: "Reversed split" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "聚光光束", en: "Spotlight beam" } },
    { key: "threads", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "牵引细线", en: "Taut threads" } },
    { key: "print", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "丝网质感", en: "Screen-print texture" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "演职员小字", en: "Credits" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片红黑", en: "Photo in red and black" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "用频道色代替红色", en: "Channel colour for the red" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.26, side: 0.34, strip: 0.12 }),
  theme: (base, C) => ({ ...base, field: css(negGround(C)), text: css(NEG.cream), dim: css(NEG.cream, 0.6), titleFill: css(NEG.cream), titleInk: css(NEG.black), grid: () => css(negInk(C), dark ? 0.24 : 0.16) }),
  /**
   * The ground; the giant silhouette in a deeper shade of the ground (tone on tone, so the channel
   * graphic in front of it stays the thing that is read); a region of the other colour cut in along a
   * slanted edge (the reversed split), in which the silhouette turns into the ground's colour — a
   * negative, sharp where it crosses; a beam of light from above; threads drawn taut to it. A photo
   * goes hard black and white, printed over the red.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = negGround(C), ink = negInk(C), spot = negSpot(C);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      if (p.duo > 0) {
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.duo; env.drawPhoto(1); env.drawPhoto(1); ctx.restore();   // contrast, twice
        wash(ctx, w, h, "multiply", mix([255, 255, 255], spot, 0.9), p.duo);
        wash(ctx, w, h, "screen", NEG.black, p.duo * 0.6);
      }
      return true;
    }
    if (!L.grid) return true;
    const S = graphicShape(env), at0 = negPlace(env, p), F = at0.F, [gx, gy] = objAt("giant", at0.cx, at0.cy, ctx), at = { ...at0, cx: gx, cy: gy };   // a scene object, the split and threads following it
    // the reversed split: its leaning edge sweeps in from the far side as the slider goes up, across the
    // silhouette (through its middle at 0.5), so that more and more of the figure reads in reverse
    let split = null;
    if (p.cut > 0) {
      const x0 = Math.min(w + h * 0.2, at.cx + at.size * 0.55 * (1 - 2 * p.cut)), lean = h * 0.12 * (rand(183) > 0.5 ? 1 : -1);
      split = [[x0 + lean, 0], [w, 0], [w, h], [x0 - lean, h]];
      shapeOf(ctx, split); ctx.fillStyle = css(ink); ctx.fill();
    }
    if (p.beam > 0) {   // a cone of light from above, onto the silhouette, with a few brighter rays in it
      const [bx] = objAt("beam", at.cx, h * 0.1, ctx, "x"), spread = w * (0.12 + 0.2 * p.beam), g = ctx.createLinearGradient(0, 0, 0, h);   // a scene object, along the top
      g.addColorStop(0, css(NEG.cream, 0.42 * p.beam)); g.addColorStop(1, css(NEG.cream, 0));
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g;
      shapeOf(ctx, [[bx - w * 0.02, 0], [bx + w * 0.02, 0], [bx + spread, h], [bx - spread, h]]); ctx.fill();
      for (let i = 0; i < 7; i++) { const t = (i + 0.5) / 7 - 0.5, wdt = w * 0.004 * (1 + rand(i + 190) * 2); shapeOf(ctx, [[bx + t * w * 0.04 - wdt, 0], [bx + t * w * 0.04 + wdt, 0], [bx + t * spread * 2 + wdt * 4, h], [bx + t * spread * 2 - wdt * 4, h]]); ctx.fill(); }
      ctx.restore();
    }
    if (S && p.giant > 0) {
      const draw = (colour) => placeShape(ctx, S, colour, at.cx, at.cy, at.size, at.rot), shade = dark ? mix(NEG.black, spot, 0.32) : mix(spot, NEG.black, 0.3);
      if (split) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); split.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip("evenodd"); draw(shade); ctx.restore(); ctx.save(); shapeOf(ctx, split); ctx.clip(); draw(ground); ctx.restore(); }
      else draw(shade);
    }
    if (p.threads > 0) {   // threads pulled taut from the edges to the silhouette
      const n = Math.round(2 + 6 * p.threads), tx = at.cx, ty = at.cy - at.size * 0.15;
      ctx.strokeStyle = css(dark ? spot : NEG.cream, 0.5 + 0.5 * p.threads); ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const side = i % 4, t = rand(i * 2.9 + 195), ex = side === 0 ? t * w : side === 1 ? w : side === 2 ? t * w : 0, ey = side === 0 ? 0 : side === 1 ? t * h : side === 2 ? h : t * h;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx + (rand(i * 3.7 + 196) - 0.5) * at.size * 0.3, ty + (rand(i * 4.3 + 197) - 0.5) * at.size * 0.3); ctx.stroke();
      }
    }
    return true;
  },
  /** The poster's construction lines: the thirds, the two diagonals, and from each corner to the middles of the far sides. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color);
    gridPath(ctx, [w / 3, (w * 2) / 3], [h / 3, (h * 2) / 3], 0, 0, w, h);
    ctx.beginPath();
    for (const [a, b, c, d] of [[0, 0, w, h], [w, 0, 0, h], [0, 0, w, h / 2], [0, 0, w / 2, h], [w, 0, 0, h / 2], [w, 0, w / 2, h], [0, h, w, h / 2], [0, h, w / 2, 0], [w, h, 0, h / 2], [w, h, w / 2, 0]]) { ctx.moveTo(a, b); ctx.lineTo(c, d); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(dark ? negSpot(C) : NEG.black), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a flat block of the other colour
  /**
   * Upright and flat: warm off-white letters. Highlighted words are set reversed out of a bar of the
   * other colour (red on black, black on red), so they read on the ground, the block and the silhouette alike.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, bar = o.hi || (dark ? negSpot(o.C || NEG.red) : NEG.black);
    if (!o.hiPlate) pass((a, x) => {   // one bar a run (unless the layer marks them its own way)
      if (!a.hi || a.first === false) return;
      const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width };
      ctx.fillStyle = css(bar); ctx.fillRect(r.x0 - fs * 0.04, -fs * 0.86, r.x1 - r.x0 + fs * 0.08, fs * 1.02);
    });
    pass((a, x) => { ctx.fillStyle = css(o.fill || NEG.cream); ctx.fillText(a.t, x, 0); });
  },
  // objects as cut paper: black, off-white and the one colour; the small parts read on the ground and on the block
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: NEG.cream }, stroke: { ink: NEG.cream } }
    : { fill: { ink: NEG.black, light: NEG.cream, mid: mix(NEG.cream, NEG.black, 0.3), dark: NEG.black, colour: () => negSpot(C) }, stroke: { ink: NEG.black, light: NEG.cream, colour: () => negSpot(C) }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: inkAs(NEG.black) }),
  /** The corner tag: a slab of the channel colour (off-white when that would vanish into the ground), condensed lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 0.7, h = fs * 1.18, top = y + fs * 0.08, slab = near(C, negGround(C), 90) || near(C, dark ? negSpot(C) : NEG.black, 90) ? NEG.cream : C;
    ctx.fillStyle = css(slab); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(lum(slab) > 0.45 ? NEG.black : NEG.cream); spaced(ctx, str, x + fs * 0.35, top + h * 0.5 + fs * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a line of billing at the top, and the credits block at the foot — real names where there are some, the rest greeked. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, brand = (P.brand.name || "").toUpperCase(), name = (env.cat.name || env.cat.code || "").toUpperCase(), col = css(NEG.cream, 0.85 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
    ctx.font = `700 20px ${fonts.en}, ${fonts.cn}`; spacedCentre(ctx, `${brand} ${brand ? "PRESENTS" : ""}`.trim(), w / 2, 64, 6);
    const bw = Math.min(w * 0.5, 820), bx = (w - bw) / 2;
    ctx.font = `700 18px ${fonts.en}, ${fonts.cn}`; spacedCentre(ctx, `${name}  ·  ${pad2(env.o.catIndex + 1)}`, w / 2, h - 96, 4);
    greeked(ctx, bx, h - 84, bw, 3, 9, css(NEG.cream, 0.6 * a), 210 + env.o.catIndex, "center");
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; },
  /** A screen print: the paper's specks, ink a little uneven, and the grain of the paper under it. */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.print <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = "soft-light";
    for (let i = 0; i < 26; i++) {
      const x = rand(i * 3.3 + 230) * w, y = rand(i * 4.1 + 231) * h, r = Math.min(w, h) * (0.12 + rand(i * 5.9 + 232) * 0.3), g = ctx.createRadialGradient(x, y, 0, x, y, r), c = rand(i + 233) > 0.5 ? 255 : 0;
      g.addColorStop(0, `rgba(${c},${c},${c},${0.22 * p.print})`); g.addColorStop(1, `rgba(${c},${c},${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    grain(ctx, p.print * 0.8, unit, true);
    grain(ctx, p.print * 0.35, unit);
  },
  prompt: `Stickers for a minimalist film poster in the manner of Saul Bass — shapes cut from paper with scissors — that read at a glance:
- one bold silhouette per sticker, with a strong, simple outline and a clever negative shape inside it where it helps (a keyhole, a face in profile, a hand); no realism, no perspective, no detail inside the silhouette;
- flat colour only: black ("ink"), off-white ("white") and the main colour; never more than three;
- the app draws no outline and no shadow: neighbouring shapes must differ in colour to be told apart.`,
  solidPrompt: `Objects as a minimalist film poster would show them: a few boxes and cylinders cut flat as silhouettes, boldly proportioned; no realism, no fine detail.
- the renderer paints faces in black, off-white and the one colour: do NOT try to draw shading or outlines yourself;
- "white" is off-white, "dark" is black, and "main" is the poster's red — use it for one part.`,
};
/** Spaced lettering centred on x (spaced() sets from the left). */
function spacedCentre(ctx, str, x, y, gap) { const align = ctx.textAlign; ctx.textAlign = "left"; spaced(ctx, str, x - spacedW(ctx, str, gap) / 2, y, gap); ctx.textAlign = align; }

// ====================================================================== minimal film poster: a silhouette with a story in it
// The fan-made minimal movie poster: one muted colour from the channel's (ochre, dusk violet, slate,
// teal), a dark silhouette standing in it with a soft light behind, a landscape fading back in layers,
// crumpled or worn paper, a vignette, a thin spaced title and a credits block at the foot. A photo can
// go inside the silhouette, as a double exposure.
const CINE = { night: [12, 12, 15], paper: [226, 214, 190], cream: [236, 228, 210], soot: [18, 15, 14] };
const cineMute = (C) => mix(C, grey(C), 0.45);
const cineGround = (C) => (dark ? mix(cineMute(C), CINE.night, 0.72) : mix(cineMute(C), CINE.paper, 0.3));
const cineShade = (C) => (dark ? [6, 6, 8] : mix(cineGround(C), CINE.soot, 0.86));        // the silhouette
const cineText = () => (dark ? CINE.cream : CINE.soot);
/** Where the silhouette stands: on the open field's floor, a little left of the middle (clear of the channel graphic), cropped by that floor. */
function cinePlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.32 + 0.6 * p.giant);
  return { F, cx: F.x0 + fw * 0.44, cy: F.y1 - size * 0.42, size };
}
/** The ground without the silhouette: the colour, the light behind where the figure stands, the landscape in layers (`only`: "ground", the colour alone, or "scene", the light and the landscape alone). */
function cineGroundPaint(ctx, env, p, at, only = null) {
  const { w, h, C } = env, ground = cineGround(C), u = Math.min(w, h), F = at.F;
  if (only !== "scene") {
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
    const top = ctx.createLinearGradient(0, 0, 0, h);   // a little deeper at the top, as a dusk sky
    top.addColorStop(0, css(mix(ground, CINE.night, dark ? 0.45 : 0.22))); top.addColorStop(0.6, css(ground, 0));
    ctx.fillStyle = top; ctx.fillRect(0, 0, w, h);
  }
  if (only === "ground") return;
  if (p.glow > 0) {   // a soft light behind the head of the figure: a wide halo and a brighter core
    const gx = at.cx, gy = at.cy - at.size * 0.2, lit = mix(ground, CINE.cream, dark ? 0.68 : 0.75);
    for (const [r, a] of [[at.size * 1.5, 0.55], [at.size * 0.7, 0.9]]) {
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, css(lit, a * p.glow)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    }
  }
  if (p.horizon > 0) {   // three ridges fading back: the furthest nearly the sky, the nearest nearly the figure
    const floor = F.y1;
    for (let k = 0; k < 3; k++) {
      const depth = (3 - k) / 3, base = floor - u * (0.05 + 0.13 * depth) * (0.4 + 0.6 * p.horizon), amp = u * (0.02 + 0.05 * depth) * p.horizon;
      const col = mix(ground, cineShade(C), 0.22 + 0.24 * k);
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) { const t = x / w; ctx.lineTo(x, base - amp * (Math.sin(t * (3 + k) + rand(k + 240) * 6) * 0.6 + Math.sin(t * (9 + k * 3) + rand(k + 241) * 6) * 0.25 + (noise(k * 50 + Math.floor(x / 40)) - 0.5) * 0.3)); }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = css(col); ctx.fill();
    }
  }
}
const cinema = {
  id: "cinema",
  art: "giant",
  repaint: (c) => `a minimalist movie poster made from a photograph: muted, moody colour (a dusky version of ${c}), soft light from behind the subject, the subject reading as a dark silhouette, worn paper texture, a gentle vignette, cinematic and quiet; still the same picture, no text.`,
  about: { zh: "极简电影海报：从频道色里取一个沉静的颜色（赭石、暮紫、灰蓝、墨绿），一个深色剪影（频道图形的轮廓）站在画面里，身后一团柔光，远处的山峦一层层淡出去，皱纸纹理、暗角和褪色，细而疏朗的衬线标题，底部一块演职员表；有照片时可以把照片装进剪影，做成双重曝光。安静、有故事感、电影感强——适合影评、书评、人物故事、纪录片与情绪向内容。", en: "The minimal movie poster: a quiet colour drawn from the channel's (ochre, dusk violet, slate, deep green), a dark silhouette (the channel graphic's outline) standing in it with a soft light behind, ridges fading back in layers, crumpled paper, a vignette and fade, a thin spaced serif title and a credits block at the foot; with a photo, the photo can go inside the silhouette as a double exposure. Quiet, story-led, cinematic — for film and book reviews, portraits, documentaries, mood pieces." },
  name: { zh: "极简电影", en: "Minimal film poster" },
  seeded: true,
  scene: { figure: { zh: "剪影", en: "Silhouette" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "剪影", en: "Silhouette" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "背光", en: "Backlight" } },
    { key: "horizon", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "远山层次", en: "Receding ridges" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "皱纸纹理", en: "Crumpled paper" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "褪色", en: "Fade" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "暗角", en: "Vignette" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "演职员表", en: "Credits" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "颗粒", en: "Grain" } },
    { key: "inside", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片装进剪影", en: "Photo inside the silhouette" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片调色", en: "Photo toning" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base, C) => ({ ...base, field: css(cineGround(C)), text: css(cineText()), dim: css(cineText(), 0.6), titleFill: css(cineText()), titleInk: css(cineGround(C)), grid: () => css(cineText(), 0.12) }),
  /**
   * The ground, its light and ridges, and the silhouette. A photo is toned toward the ground's colour;
   * one that fills the canvas can show only inside the silhouette: the ground is painted again over
   * it, with the silhouette cut out of it.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, at0 = cinePlace(env, p), [sx, sy] = objAt("figure", at0.cx, at0.cy, ctx), at = { ...at0, cx: sx, cy: sy };   // the silhouette: a scene object
    if (env.photo) {
      ctx.fillStyle = css(cineGround(C)); ctx.fillRect(0, 0, w, h);
      env.drawPhoto(p.duo * 0.6);
      wash(ctx, w, h, "soft-light", mix(cineMute(C), CINE.cream, 0.2), p.duo * 0.7);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], cineMute(C), 0.5), p.duo * 0.55);
      const S = L.fill && p.inside > 0 && p.giant > 0 && canPaint(ctx) && graphicShape(env);
      if (S) {
        const x = workLike(ctx, "cine");
        cineGroundPaint(x, env, p, at);
        x.globalCompositeOperation = "destination-out"; placeShape(x, S, [0, 0, 0], at.cx, at.cy, at.size);
        layDown(ctx, x, p.inside);
      }
      return true;
    }
    if (L.ground !== false) cineGroundPaint(ctx, env, p, at, "ground");   // the colour and its dusk: the base; the light and the ridges stand on it
    if (!L.grid) return true;
    cineGroundPaint(ctx, env, p, at, "scene");
    const S = p.giant > 0 && graphicShape(env);
    if (S) placeShape(ctx, S, cineShade(C), at.cx, at.cy, at.size);
    return true;
  },
  /** A camera's framing chart: the frame lines of the wider screens inside the picture, the corners of its safe area, a centre cross. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2;
    gridPen(ctx, color);
    for (const [r, dash] of [[2.39, []], [2, [16, 12]]]) {
      const fw = Math.min(w, h * r), fh = fw / r, x = cx - fw / 2, y = cy - fh / 2;
      ctx.setLineDash(dash); gridPath(ctx, fw < w - 1 ? [x, x + fw] : [], fh < h - 1 ? [y, y + fh] : [], 0, 0, w, h);
    }
    ctx.setLineDash([]);
    const sx = w * 0.05, sy = h * 0.05, sw = w * 0.9, sh = h * 0.9, t = 44;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[sx, sy, 1, 1], [sx + sw, sy, -1, 1], [sx, sy + sh, 1, -1], [sx + sw, sy + sh, -1, -1]]) { ctx.moveTo(x + dx * t, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * t); }
    ctx.moveTo(cx - 26, cy); ctx.lineTo(cx + 26, cy); ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy + 26);
    ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: (C) => css(mix(cineGround(C), cineShade(C), dark ? 0.55 : 0.4)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(cineText(), 0.35); ctx.lineWidth = 1.5; run(nx * 10, ny * 10); },   // a hairline, a little off the edge
  },
  /** A serif, upright; a soft shadow under it, or on the light ground a halo of light (the shadow slider); highlighted words in the channel colour, muted. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, hi = o.hi || mix(cineMute(o.C || CINE.cream), dark ? CINE.cream : CINE.soot, dark ? 0.35 : 0.4);
    // on the dark ground a soft shadow under the letters; on the light one a halo of light behind them, so they read over the silhouette
    if (o.shadowAmt > 0) { ctx.save(); ctx.shadowColor = dark ? css(CINE.night, 0.55 * Math.min(1, o.shadowAmt)) : css(CINE.cream, 0.9 * Math.min(1, o.shadowAmt)); ctx.shadowBlur = fs * (dark ? 0.12 : 0.2); ctx.shadowOffsetY = 0; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); }); if (!dark) pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: cineText() }, stroke: { ink: cineText() } }
    : { fill: { ink: cineShade(C), light: mix(cineGround(C), CINE.cream, 0.6), mid: mix(cineGround(C), CINE.cream, 0.25), dark: cineShade(C), colour: (c) => mix(cineMute(c), cineGround(C), 0.25) }, stroke: { ink: cineShade(C), light: CINE.cream }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(CINE.soot, c[3]) : role(c) === "colour" ? css(cineMute(c), c[3]) : fill; } }),
  /** The corner tag: spaced small capitals between two hairlines, the channel colour in a short bar before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = spacedW(ctx, str, 9), w = tw + f * 1.6, by = y + fs * 1.2, col = css(cineText(), 0.85);
    ctx.fillStyle = col; ctx.fillRect(x, by - f * 1.55, w, 1.5); ctx.fillRect(x, by + f * 0.35, w, 1.5);
    ctx.fillStyle = css(mix(C, cineText(), 0.15)); ctx.fillRect(x, by - f * 0.78, f * 0.9, f * 0.3);
    ctx.fillStyle = ink || col; spaced(ctx, str, x + f * 1.6, by - f * 0.12, 9);
    return { x: x - 4, y: by - f * 1.7, w: w + 8, h: f * 2.3 };
  },
  /** The frame layer: names spaced across the top, and the credits block — the channel's name, then greeked billing — at the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, col = css(cineText(), 0.8 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.font = `400 19px ${fonts.serif}`;
    const brand = P.brand.name || "", name = env.cat.name || env.cat.code || "";
    if (brand) spacedCentre(ctx, brand.toUpperCase(), w * 0.3, 70, 5);
    if (name) spacedCentre(ctx, name.toUpperCase(), w * 0.7, 70, 5);
    const bw = Math.min(w * 0.46, 760);
    greeked(ctx, (w - bw) / 2, h - 82, bw, 4, 8, css(cineText(), 0.5 * a), 250 + env.o.catIndex, "center");
    ctx.font = `400 15px ${fonts.serif}`; spacedCentre(ctx, `— ${pad2(env.o.catIndex + 1)} —`, w / 2, h - 30, 4);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(CINE.night, 0.45); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6 * unit; },
  /** Crumpled paper, the fade of an old print, a vignette, grain. */
  post(ctx, w, h, C, p, unit = 1) {
    crumple(ctx, w, h, p.paper * 0.9);
    wash(ctx, w, h, "screen", [40, 34, 30], 0.5 * p.fade);
    wash(ctx, w, h, "multiply", [250, 236, 214], 0.6 * p.fade);
    vignette(ctx, w, h, CINE.night, 0.75 * p.vignette, 0.32);
    grain(ctx, p.grain * 0.7, unit, !dark);
  },
  prompt: `Stickers for a minimalist movie poster — quiet, reduced and a little melancholic — that read at a glance:
- one clear silhouette per sticker (a figure, a profile, a hand, a house, a tree, an object), simple and elegant, with at most one small inner shape that tells a story; no realism, no perspective, no detail;
- flat colour only, muted: the main colour (it comes out dusky), "ink" for the silhouette and "white" for a light; two or three colours in all;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a minimal movie poster would show them: a few boxes and cylinders, plainly proportioned and a little lonely; no realism, no fine detail.
- the renderer paints faces in muted tones of the poster's colour with a near-black: do NOT try to draw shading or outlines yourself;
- "white" is the light, "dark" is near-black, and "main" a muted version of the channel colour.`,
};

// ====================================================================== cyanotype: photograms glowing on Prussian blue
// The cyanotype and the blue-printed zine: Prussian blue, unevenly brushed on; things laid on the sheet
// and left white where the light could not reach them, glowing at the edges; soft airbrushed shapes;
// a coarse halftone; sparkles; hairline frames with small numbers. The channel colour is the second
// ink (the highlighted words, the tag). Deep blue ground (dark) or off-white paper printed in blue (light).
const CYA = { prussian: [20, 54, 132], deep: [9, 24, 74], ink: [6, 14, 46], white: [236, 244, 255], pale: [150, 194, 246], paper: [236, 230, 214] };
const cyaGround = () => (dark ? CYA.prussian : CYA.paper), cyaInk = () => (dark ? CYA.white : CYA.prussian);
/** A four-pointed sparkle with a glow round it. */
function sparkle(ctx, x, y, r, colour, glow) {
  if (glow > 0) blurred(ctx, r * 0.6 * glow, css(colour, 0.9), () => starMark(ctx, x, y, r, 4, colour));
  starMark(ctx, x, y, r, 4, colour);
}
const cyano = {
  id: "cyano",
  art: "glow",
  repaint: (c) => `a cyanotype print made from a photograph: Prussian blue and white only, the lights glowing white with soft edges like a photogram, uneven brushed-on blue with darker streaks at the edges, a coarse halftone in places, paper texture; still the same picture, no text.`,
  about: { zh: "蓝晒光影：氰版蓝晒和蓝色油印小志的样子——普鲁士蓝刷得深浅不匀，频道图形像实物压在感光纸上留下的白影，边缘发光；喷枪喷出的柔和形状、粗网点、闪烁的星光、细线框和小编号；频道主色作为第二种油墨，用在强调词和角标上。可选深蓝底或米白纸底（纸上印蓝）。梦幻、安静、有手作感——适合科学、宇宙、自然、诗意与情绪向内容。", en: "Cyanotype: the cyanotype print and the blue-printed zine — Prussian blue brushed on unevenly; the channel graphic left white as if laid on the paper in the sun, glowing at its edges; soft airbrushed shapes, a coarse halftone, sparkles, hairline frames and small numbers; the channel colour as a second ink for highlighted words and the tag. Deep blue, or off-white paper printed in blue. Dreamy, quiet, handmade — for science, space, nature, poetry and mood pieces." },
  name: { zh: "蓝晒光影", en: "Cyanotype" },
  seeded: true,
  params: [
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "发光白影", en: "Glowing photogram" } },
    { key: "spray", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "喷枪柔雾", en: "Airbrush" } },
    { key: "stain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "刷涂不匀", en: "Uneven brushing" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "粗网点", en: "Coarse halftone" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "星光", en: "Sparkles" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "细线与编号", en: "Hairlines and numbers" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "颗粒", en: "Grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片蓝晒", en: "Photo as cyanotype" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.24, side: 0.33, strip: 0.12 }),
  theme: (base) => ({ ...base, field: css(cyaGround()), text: css(cyaInk()), dim: css(cyaInk(), 0.6), titleFill: css(cyaInk()), titleInk: css(cyaGround()), grid: () => css(cyaInk(), 0.18) }),
  /**
   * The blue (or the paper), brushed unevenly; soft airbrushed shapes; the channel graphic left white
   * and glowing; sparkles. A photo becomes a cyanotype: grey, its darks into Prussian blue, its lights
   * left white, and the halftone over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = cyaGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], CYA.prussian, 0.9), p.duo);
      wash(ctx, w, h, "screen", CYA.deep, p.duo * 0.5);
      if (dark) wash(ctx, w, h, "soft-light", CYA.white, p.duo * 0.25);
      dotScreen(ctx, w, h, CYA.ink, 8, 0.5 * p.halftone);
      return true;
    }
    if (!L.grid) return true;
    if (p.stain > 0) {   // brushed on unevenly: darker blotches, and streaks along the edges where the brush turned
      const deep = dark ? CYA.deep : CYA.prussian;
      for (let i = 0; i < 14; i++) {
        const x = rand(i * 3.7 + 260) * w, y = rand(i * 4.3 + 261) * h, r = u * (0.15 + rand(i * 5.1 + 262) * 0.35), g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(deep, (dark ? 0.5 : 0.12) * p.stain)); g.addColorStop(1, css(deep, 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0; i < 40; i++) {   // brush strokes in from the edges
        const side = i % 4, t = rand(i * 2.1 + 270), len = u * (0.1 + rand(i * 3.3 + 271) * 0.3), lw = u * (0.004 + rand(i * 4.4 + 272) * 0.02);
        const [x0, y0, dx, dy] = side === 0 ? [t * w, -10, 0.15, 1] : side === 1 ? [w + 10, t * h, -1, 0.1] : side === 2 ? [t * w, h + 10, -0.1, -1] : [-10, t * h, 1, -0.15];
        ctx.strokeStyle = css(deep, (dark ? 0.6 : 0.3) * p.stain * (0.4 + rand(i + 273) * 0.6)); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx * len, y0 + dy * len); ctx.stroke();
      }
      ctx.restore();
    }
    if (p.spray > 0 && canPaint(ctx)) {   // airbrushed shapes: soft-edged blobs of a lighter blue, with a fringe of spray
      const pale = dark ? CYA.pale : mix(CYA.pale, CYA.prussian, 0.25), n = Math.round(2 + 4 * p.spray);
      for (let i = 0; i < n; i++) {
        const x = rand(i * 6.1 + 280) * w, y = rand(i * 7.3 + 281) * h, r = u * (0.06 + rand(i * 8.9 + 282) * 0.14) * (0.6 + 0.6 * p.spray);
        blurred(ctx, r * 0.5, css(pale, 0.75 * p.spray), () => { ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + rand(i + 283) * 0.6), rand(i + 284) * 3, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); });
        ctx.fillStyle = css(pale, 0.55 * p.spray);
        for (let j = 0; j < 160 * p.spray; j++) { const a = rand(i * 31 + j * 0.37 + 285) * TAU, d = r * (0.9 + Math.pow(rand(i * 17 + j * 0.53 + 286), 2) * 0.9); ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, 2, 2); }
      }
    }
    const S = p.glow > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the photogram: the graphic's shape left white, glowing at its edges; larger and turned a little, toward the open side
      // the photogram: the graphic's shape left light, a glow round it, a sharper core; a ghost behind the lettering, as faint as the slider says
      const F = openField(env), size = (F.y1 - F.y0) * (0.5 + 0.3 * p.glow), cx = F.x0 + (F.x1 - F.x0) * 0.62, cy = (F.y0 + F.y1) / 2, rot = (rand(290) - 0.5) * 0.5;
      const light = dark ? CYA.white : CYA.prussian, x = workLike(ctx, "cyano");
      blurred(x, size * 0.06, css(dark ? CYA.pale : CYA.prussian, 0.8), () => placeShape(x, S, [0, 0, 0], cx, cy, size, rot));
      blurred(x, size * 0.015, css(light, 0.9), () => placeShape(x, S, [0, 0, 0], cx, cy, size, rot));
      x.globalAlpha = 0.85; placeShape(x, S, dark ? mix(CYA.white, CYA.pale, 0.35) : mix(CYA.prussian, CYA.paper, 0.3), cx, cy, size, rot);
      layDown(ctx, x, (dark ? 0.35 : 0.22) + (dark ? 0.45 : 0.35) * p.glow);
    }
    if (p.stars > 0) {
      const col = dark ? CYA.white : CYA.prussian, n = Math.round(1 + 6 * p.stars);
      for (let i = 0; i < n; i++) sparkle(ctx, w * (0.06 + rand(i * 3.3 + 300) * 0.88), h * (0.08 + rand(i * 4.1 + 301) * 0.8), u * (0.012 + rand(i * 5.9 + 302) * 0.03) * (0.6 + 0.6 * p.stars), col, dark ? 1 : 0.4);
    }
    return true;
  },
  /** Blueprint paper: a fine grid every 24, a firmer one every 120. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fine = (n) => every(24, n, 24).filter((v) => v % 120);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.5; gridPath(ctx, fine(w), fine(h), 0, 0, w, h);
    ctx.globalAlpha = 1; gridPath(ctx, every(120, w, 120), every(120, h, 120), 0, 0, w, h);
    ctx.restore();
  },
  accent: {
    fill: () => css(dark ? CYA.deep : CYA.prussian),
    tone: () => css(dark ? CYA.prussian : CYA.pale, Math.min(1, 1.4 * values.halftone)), toneScale: 0.7,   // the halftone slider reaches the block too
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.setLineDash([3, 7]); ctx.strokeStyle = css(dark ? CYA.white : CYA.prussian, 0.7); ctx.lineWidth = 2; run(nx * 12, ny * 12); ctx.setLineDash([]); },
  },
  /** A serif in the light: on the blue it glows (the shadow slider sets how much); highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || cyaInk(), hi = o.hi || o.C || CYA.pale, glow = Math.min(2, o.shadowAmt);
    if (glow > 0) { ctx.save(); ctx.shadowColor = css(dark ? CYA.pale : CYA.prussian, dark ? 0.85 : 0.3); ctx.shadowBlur = fs * 0.16 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: cyaInk() }, stroke: { ink: cyaInk() } }
    : { fill: { ink: CYA.ink, light: CYA.white, mid: CYA.pale, dark: CYA.deep, colour: (c) => (lum(c) > 0.55 ? CYA.pale : mix(CYA.prussian, CYA.pale, 0.3)) }, stroke: { ink: CYA.ink, light: CYA.white }, line: 0.6 }),
  sticker: painters({ line: null, tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const r = role(c); return css(r === "ink" ? CYA.ink : r === "light" ? CYA.white : r === "colour" ? (lum(c) > 0.55 ? CYA.pale : mix(CYA.prussian, CYA.pale, 0.3)) : c, c[3]); },
    shadow(ctx, draw) { ctx.save(); ctx.shadowColor = css(CYA.white, 0.7); ctx.shadowBlur = 16; draw(css(CYA.white, 0.25)); ctx.restore(); } }),
  /** The corner tag: a hairline box with the lettering, a filled square of the channel colour before it. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = spacedW(ctx, str, 4), sq = f * 0.62, w = f * 0.6 + sq + f * 0.5 + tw + f * 0.6, h = f * 1.6, top = y + (fs * 1.34 - h), line = css(cyaInk(), 0.9);
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = css(C); ctx.fillRect(x + f * 0.6, top + (h - sq) / 2, sq, sq);
    ctx.fillStyle = ink || line; spaced(ctx, str, x + f * 0.6 + sq + f * 0.5, top + h * 0.5 + f * 0.36, 4);
    for (const [cx, cy] of [[x, top], [x + w, top], [x, top + h], [x + w, top + h]]) ctx.fillRect(cx - 3, cy - 3, 6, 6);   // the corner points of a frame being measured
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: a hairline border with measured corners, a dashed box of small print, the number of the plate. */
  frame(ctx, env, p) {
    const a = p.lines;
    if (a <= 0) return;
    const { w, h } = env, col = css(cyaInk(), 0.75 * a), i = env.o.catIndex;
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
    ctx.strokeRect(28, 28, w - 56, h - 56);
    for (const [x, y] of [[28, 28], [w - 28, 28], [28, h - 28], [w - 28, h - 28]]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke(); }
    ctx.font = `italic 400 40px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillText(pad2(i + 1), besideLogo(env, w - 60), 92);
    if (a > 0.3) {
      const bw = Math.min(300, w * 0.2), bx = w - 60 - bw, by = h - 170;
      ctx.setLineDash([4, 5]); ctx.strokeRect(bx, by, bw, 96); ctx.setLineDash([]);
      for (const [x, y] of [[bx, by], [bx + bw, by], [bx, by + 96], [bx + bw, by + 96]]) ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      greeked(ctx, bx + 14, by + 16, bw - 28, 5, 13, css(cyaInk(), 0.55 * a), 310 + i);
    }
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left";
    spaced(ctx, `PLATE ${pad2(i + 1)} / ${(env.cat.code || "").toUpperCase()} / ${(env.o.profile.brand.name || "").toUpperCase()}`, 60, h - 44, 3);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(dark ? CYA.white : CYA.prussian, dark ? 0.6 : 0.35); ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  /** The halftone over all (lightly), and grain. */
  post(ctx, w, h, C, p, unit = 1) {
    dotScreen(ctx, w, h, dark ? CYA.deep : CYA.prussian, 7, 0.22 * p.halftone, dark ? "multiply" : "multiply");
    grain(ctx, p.grain * 0.8, unit, !dark);
  },
  prompt: `Stickers for a cyanotype zine — objects laid on light-sensitive paper, left white where they shaded it — that read at a glance:
- one clear, recognisable silhouette per sticker (a leaf, a flower, a hand, a shell, a planet, an astronaut, a bird, a key); a few inner lines are welcome as "detail"; no realism, no perspective;
- flat colour only: "white" for the object, "blue" and the main colour as accents, "ink" for a few details; the app turns colours into blues;
- the app adds a soft white glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a blueprint or a cyanotype plate would show them: a few boxes and cylinders, cleanly proportioned — a telescope, a lamp, a camera, a jar; no realism, no fine detail.
- the renderer prints faces in white, pale blue and Prussian blue: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" is Prussian blue, and "main" comes out a pale blue.`,
};

// ====================================================================== monochrome film: a black-and-white editorial
// Grainy black-and-white film stills laid out as a magazine would: haze and out-of-focus light, a figure
// caught in motion, fragments of the picture cut out and set back a little off (one or two in the
// channel colour, the only colour there is), a sheet folded in four, dust, columns of small print, a
// serif title that seems to drift out of focus.
const MF = { black: [12, 12, 12], night: [22, 22, 22], paper: [226, 224, 220], white: [240, 238, 234], grey: [130, 130, 128] };
const mfGround = () => (dark ? MF.night : MF.paper), mfInk = () => (dark ? MF.white : MF.black);
const monofilm = {
  id: "monofilm",
  art: "ghost",
  repaint: (c) => `a grainy black-and-white film still made from the photograph: deep blacks, soft silver highlights, a little motion blur, heavy film grain, a dreamy cinematic haze; still the same picture, no colour, no text.`,
  about: { zh: "黑白胶片：粗颗粒的黑白电影剧照排成一本杂志——光雾和失焦的光斑，频道图形化成一道带动态残影的灰色身影，照片被裁下几块错开拼回去（其中一两块染成频道色，那是画面里唯一的颜色），纸张对折的折痕，灰尘，成栏的小字，衬线标题带一层失焦的柔光。可选黑底或灰白纸底。安静、文艺、有胶片的呼吸感——适合人物、音乐、电影、时尚、随笔与回忆。", en: "Monochrome film: grainy black-and-white stills laid out as a magazine — haze and out-of-focus light, the channel graphic as a grey figure trailing a motion blur, the photo cut into fragments set back a little off (one or two in the channel colour, the only colour there is), a sheet folded in four, dust, columns of small print, a serif title with a soft blur round it. Black or pale paper. Quiet, literary, breathing like film — for portraits, music, film, fashion, essays and memories." },
  name: { zh: "黑白胶片", en: "Monochrome film" },
  seeded: true,
  scene: { haze: { zh: "光雾", en: "Haze" } },
  params: [
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "光雾与光斑", en: "Haze and light" } },
    { key: "ghost", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "动态残影", en: "Motion ghost" } },
    { key: "fold", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "对折折痕", en: "Folds" } },
    { key: "type", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "编辑小字", en: "Small print" } },
    { key: "dust", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "灰尘划痕", en: "Dust and scratches" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "collage", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "照片拼贴", en: "Photo collage" } },
    { key: "motion", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "照片动态模糊", en: "Photo motion blur" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.22, side: 0.32, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(mfGround()), text: css(mfInk()), dim: css(mfInk(), 0.55), titleFill: css(mfInk()), titleInk: css(mfGround()), grid: () => css(mfInk(), 0.12) }),
  /**
   * The ground with its haze and out-of-focus lights, and the channel graphic as a soft grey figure in
   * motion. A photo goes black and white, smeared sideways (the motion blur), and a few pieces of it are
   * cut out and set back a little off, one tinted with the channel colour.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), ground = mfGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.motion > 0) {   // the same picture again, slid sideways and faint: a hand-held, moving shot
        ctx.save(); const n = fast ? 2 : 6;
        for (let i = 1; i <= n; i++) { ctx.globalAlpha = (0.32 * p.motion) / Math.sqrt(i); ctx.translate((u * 0.012 * p.motion * (i % 2 ? 1 : -0.6)), 0); env.drawPhoto(p.mono); }
        ctx.restore();
      }
      wash(ctx, w, h, "soft-light", [120, 120, 120], 0.4 * p.mono);
      if (L.fill && p.collage > 0) {   // pieces cut out and set back off true
        const n = Math.round(1 + 3 * p.collage), T = env.G && env.G.title, clear = (x, y, a, b) => !T || x > T.x + T.w * 0.75 || x + a < T.x || y > T.y + T.h || y + b < T.y;
        for (let i = 0; i < n; i++) {
          const rw = w * (0.12 + rand(i * 3.1 + 320) * 0.16), rh = rw * (0.62 + rand(i * 4.7 + 321) * 0.5);
          let rx = 0, ry = 0, ok = false;
          for (let t = 0; t < 10 && !ok; t++) { rx = w * (0.08 + rand(i * 5.3 + t * 11.3 + 322) * 0.84) - rw / 2; ry = h * (0.1 + rand(i * 6.1 + t * 13.7 + 323) * 0.8) - rh / 2; ok = clear(rx, ry, rw, rh); }   // clear of the title
          if (!ok) continue;
          const dx = (rand(i * 7.7 + 324) - 0.5) * u * 0.12 * p.collage, dy = (rand(i * 8.3 + 325) - 0.5) * u * 0.08 * p.collage;
          ctx.save(); ctx.beginPath(); ctx.rect(rx + dx, ry + dy, rw, rh); ctx.clip();
          ctx.translate(dx * 0.4, dy * 0.4); ctx.fillStyle = css(ground); ctx.fillRect(rx - dx, ry - dy, rw + Math.abs(dx) * 2, rh + Math.abs(dy) * 2);
          env.drawPhoto(1);
          if (i % 3 === 0) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix([255, 255, 255], C, 0.95)); ctx.fillRect(-w, -h, w * 3, h * 3); }   // the one in colour
          ctx.restore();
          ctx.strokeStyle = css(mfInk(), 0.5); ctx.lineWidth = 1.5; ctx.strokeRect(rx + dx, ry + dy, rw, rh);
        }
      }
      return true;
    }
    if (!L.grid) return true;
    if (p.haze > 0) {   // a wash of light from one side, and round out-of-focus lights
      const [lx, ly] = objAt("haze", w * (0.25 + rand(330) * 0.5), h * (0.2 + rand(331) * 0.3), ctx), lit = dark ? [190, 190, 186] : [255, 255, 255];   // where the light comes from: a scene object
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, u * 0.9);
      g.addColorStop(0, css(lit, (dark ? 0.32 : 0.55) * p.haze)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < Math.round(3 + 9 * p.haze); i++) {
        const x = rand(i * 2.3 + 335) * w, y = rand(i * 3.9 + 336) * h, r = u * (0.02 + rand(i * 5.7 + 337) * 0.07), b = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
        b.addColorStop(0, css(lit, (dark ? 0.14 : 0.3) * p.haze)); b.addColorStop(0.9, css(lit, (dark ? 0.18 : 0.35) * p.haze)); b.addColorStop(1, css(lit, 0));
        ctx.fillStyle = b; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
    const S = p.ghost > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the figure in motion: soft grey copies trailing behind, and the figure itself only a little sharper
      const F = openField(env), size = (F.y1 - F.y0) * (0.5 + 0.35 * p.ghost), cx = F.x0 + (F.x1 - F.x0) * 0.68, cy = F.y1 - size * 0.45;
      const fig = dark ? [96, 96, 94] : [70, 70, 68], trail = u * 0.035 * p.ghost, n = fast ? 3 : 8;
      for (let i = n; i >= 1; i--) blurred(ctx, size * 0.03 + trail * 0.2, css(fig, (0.5 * p.ghost) / Math.sqrt(i)), () => placeShape(ctx, S, [0, 0, 0], cx - trail * i, cy, size));
      blurred(ctx, size * 0.012, css(fig, 0.9), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
    }
    return true;
  },
  /** A contact sheet: strips of film across the sheet, frame after frame, the sprocket holes along their edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fw = 300, fh = 200, gap = 16, band = fh + 64, x0 = 36;
    gridPen(ctx, color);
    for (let y = 26; y < h; y += band + 22) {
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.moveTo(0, y + band); ctx.lineTo(w, y + band);
      for (let x = x0; x < w; x += fw + gap) rounded(ctx, x, y + 32, fw, fh, 12);
      ctx.stroke();
      ctx.beginPath(); for (let x = 14; x < w; x += 26) { ctx.rect(x, y + 9, 12, 14); ctx.rect(x, y + band - 23, 12, 14); } ctx.fill();
    }
    ctx.restore();
  },
  accent: { fill: () => css(dark ? MF.black : [28, 28, 28]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(MF.white, 0.55); ctx.lineWidth = 1.5; run(0, 0); } },
  /** A serif seen through a lens: a soft, out-of-focus copy round it (the shadow slider), then the letters; highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || mfInk(), hi = o.hi || o.C || MF.white, soft = Math.min(2, o.shadowAmt);
    if (soft > 0 && !fast) { ctx.save(); ctx.shadowColor = css(ink, 0.65); ctx.shadowBlur = fs * 0.14 * soft; ctx.globalAlpha = 0.6; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x + fs * 0.02 * soft, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: mfInk() }, stroke: { ink: mfInk() } }
    : { fill: { ink: MF.black, light: MF.white, mid: [176, 176, 172], dark: [52, 52, 50], colour: (c) => grey(c) }, stroke: { ink: MF.black, light: MF.white, colour: (c) => grey(c) }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : css(grey(c), c[3]); } }),
  /** The corner tag: a block of the channel colour — the only colour on the page — with white lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.7;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 1.1, h = f * 1.45, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(C); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(lum(C) > 0.6 ? MF.black : MF.white); spaced(ctx, str, x + f * 0.55, top + h * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a date and a name in the top corners, columns of small print, a short quotation rule. */
  frame(ctx, env, p) {
    const a = p.type;
    if (a <= 0) return;
    const { w, h } = env, i = env.o.catIndex, col = css(mfInk(), 0.8 * a), P = env.o.profile;
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic";
    ctx.font = `600 15px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.fillText(`VOL.${pad2(i + 1)}`, 60, 62);
    ctx.textAlign = "right"; ctx.fillText((P.brand.name || "").toUpperCase(), besideLogo(env, w - 60), 62);
    const cw = Math.min(240, w * 0.15);
    greeked(ctx, w - 60 - cw, h * 0.42, cw, 7, 12, css(mfInk(), 0.5 * a), 340 + i, "right");
    if (a > 0.4) greeked(ctx, w - 60 - cw, h * 0.42 + 110, cw * 0.8, 4, 12, css(mfInk(), 0.4 * a), 350 + i, "right");
    ctx.font = `italic 400 22px ${fonts.serif}`; ctx.textAlign = "right"; ctx.fillText((env.cat.name || "").slice(0, 24), w - 60, h * 0.42 - 26);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 14 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5 * unit; },
  /** The sheet folded in four, dust, grain and a faint darkening at the edges. */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.fold > 0) {
      for (const [vertical, at] of [[true, w / 2], [false, h / 2]]) {   // each fold: shade on one side, a light ridge on the other
        const s = 60, g = vertical ? ctx.createLinearGradient(at - s, 0, at + s, 0) : ctx.createLinearGradient(0, at - s, 0, at + s);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.48, `rgba(0,0,0,${0.28 * p.fold})`); g.addColorStop(0.5, `rgba(255,255,255,${0.32 * p.fold})`); g.addColorStop(0.56, `rgba(255,255,255,${0.08 * p.fold})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = g; vertical ? ctx.fillRect(at - s, 0, s * 2, h) : ctx.fillRect(0, at - s, w, s * 2); ctx.restore();
        ctx.fillStyle = `rgba(255,255,255,${0.18 * p.fold})`; vertical ? ctx.fillRect(at, 0, 1, h) : ctx.fillRect(0, at, w, 1);
      }
    }
    if (p.dust > 0) filmDust(ctx, w, h, p.dust * 0.8);
    grain(ctx, p.grain, unit);
    vignette(ctx, w, h, [0, 0, 0], dark ? 0.45 : 0.18, 0.4);
  },
  prompt: `Cut-outs for a black-and-white film magazine — reduced, elegant shapes like figures cut from a photograph — that read at a glance:
- one clear silhouette per sticker (a figure walking, a face in profile, a hand, a flower, a chair, a camera), simple and graceful; no realism, no perspective, no detail;
- flat colour only, and only greys: "ink", "white" and the main colour (it comes out as a grey);
- the app draws no outline and no shadow: neighbouring shapes must differ in tone to be told apart.`,
  solidPrompt: `Objects as a black-and-white still would show them: a few boxes and cylinders, plainly and elegantly proportioned — a camera, a lamp, a radio, a suitcase; no realism, no fine detail.
- the renderer paints faces in greys with a thin line: do NOT try to draw shading or outlines yourself;
- "white" is the light grey, "dark" is near-black, and "main" a middle grey.`,
};

// ====================================================================== experimental type: the poster made of lettering
// Swiss and experimental typographic posters: a white sheet and black type, the type itself the
// picture — cut along a slant and knocked out of line, echoed in fading layers, dissolving into dots;
// a burst of hairlines, dry-brush strokes behind, giant letters cut across, a hairline grid with small
// markers. One colour only, the channel's, on the block.
const TY = { paper: [244, 243, 240], ink: [14, 14, 14], night: [14, 14, 14] };
const tyGround = () => (dark ? TY.night : TY.paper), tyInk = () => (dark ? TY.paper : TY.ink);
const typo = {
  id: "typo",
  repaint: (c) => `a high-contrast black-and-white photograph for a Swiss typographic poster: crisp, graphic, deep blacks and clean whites, little mid-tone, generous empty space; still the same picture, no colour, no text.`,
  about: { zh: "实验字体：瑞士和实验派的文字海报——白纸黑字，文字本身就是画面：沿斜线切开错位、一层层向上叠出残影、从一侧消散成粒子；放射的细线、干笔刷痕、被斜线切开的巨型字母、带小圆点标记的细线网格；整张只有一种颜色，就是频道色的色块。可选白底黑字或黑底白字。理性、锋利、有设计感——适合设计、展览、讲座、音乐节、科技与观点类内容。", en: "Experimental type: Swiss and experimental typographic posters — black type on a white sheet, the type itself the picture: cut along a slant and knocked out of line, echoed in fading layers, dissolving into dots at one end; a burst of hairlines, dry-brush strokes, giant letters cut across, a hairline grid with small markers; one colour only, the channel's, on the block. Black on white or white on black. Rational, sharp, designed — for design, exhibitions, talks, festivals, tech and opinion." },
  name: { zh: "实验字体", en: "Experimental type" },
  seeded: true,
  scene: { letters: { zh: "巨型字母", en: "Giant letters" }, burst: { zh: "放射细线中心", en: "Centre of the radiating lines" } },
  params: [
    { key: "slice", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "标题切割错位", en: "Title cut and shifted" } },
    { key: "echo", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "标题层叠残影", en: "Title echoes" } },
    { key: "scatter", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "标题粒子消散", en: "Title dissolving" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "放射细线", en: "Burst of lines" } },
    { key: "brush", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "干笔刷痕", en: "Dry brush" } },
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "巨型字母", en: "Giant letters" } },
    { key: "letters", text: true, max: 8, def: "", name: { zh: "字母内容", en: "Their letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "细线网格", en: "Hairline grid" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白高反差", en: "Hard black and white" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.18, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(tyGround()), text: css(tyInk()), dim: css(tyInk(), 0.55), titleFill: css(tyInk()), titleInk: css(tyGround()), grid: () => css(tyInk(), 0.1) }),
  /** The sheet, a burst of hairlines, dry-brush strokes, giant letters cut across. A photo goes hard black and white. */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = tyGround(), ink = tyInk(), F = openField(env);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.mono > 0) { ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.mono; env.drawPhoto(1); env.drawPhoto(1); ctx.restore(); }
      return true;
    }
    if (!L.grid) return true;
    if (p.giant > 0) {   // the letters typed in, or the channel's code: huge, each cut along a slant and the halves pulled apart
      // up to three stand in two staggered rows, as they always did; a longer word runs in one line, stepping a
      // little down, spread wider and set no larger than lets it fit, so it still reads left to right
      const word = [...((p.letters || env.cat.code || env.cat.name || "A").toUpperCase())].filter((c) => c.trim()).slice(0, 8), n = word.length, line = n > 3, more = clamp((n - 3) / 5);
      const fw = F.x1 - F.x0, fh = F.y1 - F.y0, span = 0.42 + 0.26 * more;
      ctx.save(); ctx.font = `400 100px ${fonts.serif}`;
      shift("letters", F.x0 + fw * (0.3 - 0.06 * more + span * 0.5), F.y0 + fh * 0.72, ctx);   // a scene object: the letters move as one
      const wide = word.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) / 100;   // the word's width at size 1
      const fs = Math.min(fh * (0.5 + 0.35 * p.giant), line ? (fw * span * 1.15) / Math.max(0.1, wide) : Infinity);
      ctx.font = `400 ${fs}px ${fonts.serif}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(mix(ground, ink, 0.12 + 0.75 * p.giant));
      word.forEach((ch, i) => {
        const cx = F.x0 + fw * (0.3 - 0.06 * more + span * ((i + 0.5) / n)), cy = F.y0 + fh * (line ? 0.6 + (0.2 * i) / (n - 1) : 0.62 + (i % 2) * 0.26), a = 0.5 + rand(i + 360) * 0.6, gap = fs * 0.05 * p.giant;
        for (const side of [-1, 1]) {   // the halves either side of the cut, moved apart along it
          ctx.save(); ctx.beginPath(); const nx = Math.cos(a), ny = Math.sin(a), R = fs * 2;
          ctx.moveTo(cx - nx * R, cy - ny * R); ctx.lineTo(cx + nx * R, cy + ny * R); ctx.lineTo(cx + nx * R - side * ny * R, cy + ny * R + side * nx * R); ctx.lineTo(cx - nx * R - side * ny * R, cy - ny * R + side * nx * R); ctx.closePath(); ctx.clip();
          ctx.fillText(ch, cx + side * nx * gap, cy + fs * 0.34 + side * ny * gap); ctx.restore();
        }
        ctx.strokeStyle = css(ink, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * fs * 0.6, cy - Math.sin(a) * fs * 0.6); ctx.lineTo(cx + Math.cos(a) * fs * 0.6, cy + Math.sin(a) * fs * 0.6); ctx.stroke();
      });
      ctx.restore();
    }
    if (p.burst > 0) {   // tapering hairlines from a point, of every length
      const [bx, by] = objAt("burst", F.x0 + (F.x1 - F.x0) * 0.62, F.y0 + (F.y1 - F.y0) * 0.55, ctx), n = Math.round(40 + 260 * p.burst), R = Math.hypot(w, h);   // their centre: a scene object
      ctx.fillStyle = css(ink, 0.9);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (rand(i * 1.3 + 370) - 0.5) * 0.04, r0 = u * (0.03 + Math.pow(rand(i * 2.9 + 371), 2) * 0.35), r1 = r0 + R * (0.1 + rand(i * 4.1 + 372) * 0.9) * (0.4 + 0.6 * p.burst), wd = 0.4 + rand(i * 5.3 + 373) * 2.6;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.beginPath(); ctx.moveTo(bx + c * r0, by + s * r0); ctx.lineTo(bx + c * r1 - s * wd, by + s * r1 + c * wd); ctx.lineTo(bx + c * r1 + s * wd, by + s * r1 - c * wd); ctx.closePath(); ctx.fill();
      }
    }
    if (p.brush > 0) {   // dry-brush strokes across the field: many thin bristle lines, ragged at both ends
      const n = Math.round(2 + 6 * p.brush), col = mix(ground, ink, 0.55);
      for (let k = 0; k < n; k++) {
        const y = F.y0 + (F.y1 - F.y0) * (0.12 + (k + rand(k + 380) * 0.6) / (n + 0.6) * 0.8), x0 = F.x0 + (F.x1 - F.x0) * (0.02 + rand(k * 2.3 + 381) * 0.2), x1 = F.x1 - (F.x1 - F.x0) * (0.02 + rand(k * 3.1 + 382) * 0.25), bh = u * (0.03 + rand(k * 4.7 + 383) * 0.04), tilt = (rand(k * 5.9 + 384) - 0.5) * bh * 1.5;
        for (let j = 0; j < 46; j++) {
          const t = j / 45, yy = y + (t - 0.5) * bh, s0 = x0 + rand(k * 31 + j * 0.7 + 385) * (x1 - x0) * 0.08, s1 = x1 - rand(k * 37 + j * 0.9 + 386) * (x1 - x0) * 0.1;
          ctx.strokeStyle = css(col, (0.15 + rand(k * 41 + j * 1.1 + 387) * 0.6) * p.brush); ctx.lineWidth = 0.6 + rand(k * 43 + j * 1.3 + 388) * 2.4;
          ctx.beginPath(); ctx.moveTo(s0, yy); ctx.bezierCurveTo(s0 + (s1 - s0) * 0.33, yy + tilt, s0 + (s1 - s0) * 0.66, yy - tilt * 0.6, s1, yy + tilt * 0.3); ctx.stroke();
        }
      }
    }
    return true;
  },
  /** The Swiss grid: twelve columns with their gutters, eight fields down, a marker where the fields meet the gutters. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 60, g = 20, cw = (w - 2 * m - 11 * g) / 12, fh = (h - 2 * m) / 8, xs = [], ys = every(m, h - m + 1, fh);
    for (let i = 0; i < 12; i++) xs.push(m + i * (cw + g), m + i * (cw + g) + cw);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.6; gridPath(ctx, xs, [], 0, m, 0, h - m);
    ctx.globalAlpha = 1; gridPath(ctx, [], ys, m, 0, w - m, 0);
    ctx.beginPath(); for (let i = 1; i < 12; i++) for (const y of ys) { const x = m + i * (cw + g) - g / 2; ctx.moveTo(x + 4, y); ctx.arc(x, y, 4, 0, TAU); } ctx.fill();
    ctx.restore();
  },
  accent: { fill: (C) => css(C), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // the one colour, flat
  /**
   * The title as the picture: echoes stacked above it, fading (the echo slider); the letters cut along
   * slanted lines and each band knocked sideways (the cut slider); and the end of the line dissolving
   * into dots (the dissolve slider) — the letters painted on a work canvas, eaten away cell by cell
   * toward the end, each cell thrown out as a dot.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || tyInk(), hi = o.hi || o.C || ink;
    let right = 0;
    pass((a, x) => { right = Math.max(right, x + ctx.measureText(a.t).width); });
    const paint = (c, dx, dy, alpha = 1) => pass((a, x) => { c.globalAlpha = alpha; c.fillStyle = css(a.hi ? hi : ink); c.fillText(a.t, x + dx, dy); });
    const cuts = p.slice > 0 ? Math.round(1 + 3 * p.slice) : 0, slope = -0.06, L0 = -fs, L1 = right + fs;
    const lines = Array.from({ length: cuts }, (_, k) => -fs * 0.82 + fs * 0.86 * ((k + 0.5 + (rand(k * 3.7 + 390) - 0.5) * 0.5) / cuts));
    const letters = (c) => {
      if (p.echo > 0) for (let i = Math.round(1 + 4 * p.echo); i >= 1; i--) paint(c, 0, -i * fs * 0.11 * (0.5 + p.echo), (0.32 * p.echo) / i);
      if (!cuts) return paint(c, 0, 0);
      for (let k = 0; k <= cuts; k++) {   // band k lies between cut k-1 and cut k
        const top = k ? lines[k - 1] : -fs * 3, bot = k < cuts ? lines[k] : fs * 3, shift = (k % 2 ? 1 : -1) * fs * (0.03 + 0.09 * p.slice) * (0.6 + rand(k * 5.1 + 391) * 0.8);
        c.save(); c.beginPath(); c.moveTo(L0, top + slope * L0); c.lineTo(L1, top + slope * L1); c.lineTo(L1, bot + slope * L1); c.lineTo(L0, bot + slope * L0); c.closePath(); c.clip();
        paint(c, shift, 0); c.restore();
      }
    };
    if (!(p.scatter > 0) || fast || !canPaint(ctx)) { letters(ctx); ctx.globalAlpha = 1; return; }
    const x = workLike(ctx, "typo");
    letters(x); x.globalAlpha = 1;
    const m = ctx.getTransform(), corners = [[-fs * 0.2, -fs * 1.6], [right + fs * 0.3, -fs * 1.6], [-fs * 0.2, fs * 0.45], [right + fs * 0.3, fs * 0.45]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
    const X0 = Math.max(0, Math.floor(Math.min(...corners.map((q) => q[0])))), Y0 = Math.max(0, Math.floor(Math.min(...corners.map((q) => q[1]))));
    const X1 = Math.min(x.canvas.width, Math.ceil(Math.max(...corners.map((q) => q[0])))), Y1 = Math.min(x.canvas.height, Math.ceil(Math.max(...corners.map((q) => q[1]))));
    if (X1 - X0 > 4 && Y1 - Y0 > 4) {
      const W = X1 - X0, H = Y1 - Y0, img = x.getImageData(X0, Y0, W, H).data, k = Math.hypot(m.a, m.b), cell = Math.max(3, Math.round(fs * 0.03 * k)), start = 1 - 0.8 * p.scatter, dots = [];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      for (let gy = 0; gy < H; gy += cell) for (let gx = 0; gx < W; gx += cell) {
        const i = ((gy + (cell >> 1)) * W + gx + (cell >> 1)) * 4;
        if (i >= img.length || img[i + 3] < 110) continue;
        const t = gx / W, f = clamp((t - start) / (1 - start + 1e-6));
        const r = rand(gx * 0.173 + gy * 7.31 + 400);
        if (r >= f * f * 1.1) continue;
        x.clearRect(X0 + gx, Y0 + gy, cell, cell);
        const thrown = rand(gx * 0.31 + gy * 3.7 + 401);
        dots.push([X0 + gx + cell / 2 + thrown * f * W * 0.18, Y0 + gy + cell / 2 + (rand(gx * 0.57 + gy * 1.9 + 402) - 0.5) * f * H * 0.9, cell * (0.18 + rand(gx + gy * 0.3 + 403) * 0.32), `rgba(${img[i]},${img[i + 1]},${img[i + 2]},${img[i + 3] / 255})`]);
      }
      for (const [dx, dy, r, col] of dots) { x.fillStyle = col; x.beginPath(); x.arc(dx, dy, r, 0, TAU); x.fill(); }
      x.restore();
    }
    layDown(ctx, x);
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: tyInk() }, stroke: { ink: tyInk() } }
    : { fill: { ink: tyInk(), light: tyGround(), mid: mix(tyGround(), tyInk(), 0.2), dark: tyInk(), colour: () => C }, stroke: { ink: tyInk(), light: tyGround() }, line: 0.45 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => inkAs(tyInk())(fill) }),
  /** The corner tag: lettering reversed out of a black bar. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.72;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 0.8, h = f * 1.2, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(tyInk()); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(tyGround()); spaced(ctx, str, x + f * 0.4, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a hairline grid — a long rule across, a few verticals, small circles where they cross, a cross mark, small figures. */
  frame(ctx, env, p) {
    const a = p.grid;
    if (a <= 0) return;
    const { w, h } = env, ink = tyInk(), i = env.o.catIndex, F = openField(env);
    ctx.save(); ctx.strokeStyle = css(ink, 0.75 * a); ctx.fillStyle = css(ink, 0.85 * a); ctx.lineWidth = 1;
    const ys = [F.y0 + (F.y1 - F.y0) * 0.36], xs = [0.18, 0.47, 0.83].map((t) => F.x0 + (F.x1 - F.x0) * t);
    if (a > 0.5) ys.push(F.y0 + (F.y1 - F.y0) * 0.78);
    for (const y of ys) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 40, y); ctx.stroke(); }
    xs.forEach((x, k) => { ctx.beginPath(); ctx.moveTo(x, 40 + k * 30); ctx.lineTo(x, h - 40); ctx.stroke(); for (const y of ys) { ctx.beginPath(); ctx.arc(x, y, 4 + 3 * a, 0, TAU); (k + i) % 2 ? ctx.fill() : ctx.stroke(); } });
    ctx.lineWidth = 3; const cx = xs[1], cy = 64; ctx.beginPath(); ctx.moveTo(cx - 9, cy - 9); ctx.lineTo(cx + 9, cy + 9); ctx.moveTo(cx + 9, cy - 9); ctx.lineTo(cx - 9, cy + 9); ctx.stroke();
    ctx.font = `600 14px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    spaced(ctx, `${pad2(i + 1)}.${pad2(env.o.profile.categories.length)}`, xs[0] + 10, ys[0] - 10, 3);
    ctx.textAlign = "right"; ctx.fillText((env.cat.code || "").toUpperCase(), xs[2] - 10, ys[0] - 10);
    ctx.save(); ctx.translate(xs[2] + 22, h * 0.6); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; spaced(ctx, (env.o.profile.brand.name || "").toUpperCase(), 0, 0, 4); ctx.restore();
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit, !dark); },
  prompt: `Stickers for a Swiss typographic poster — strict, graphic and economical — that read at a glance:
- simple geometric or typographic shapes: arrows, circles, crosses, brackets, a single bold letter or numeral, an asterisk, a hand pointing; no realism, no perspective, no detail;
- flat colour only: black ("ink"), white ("white") and at most a small part in the main colour;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a Swiss poster would show them: a few boxes and cylinders in exact, rational proportions — a speaker, a chair, a lamp, a book; no realism, no fine detail.
- the renderer paints faces white, grey and black with a hairline: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" is black, and "main" is the channel colour — one part only.`,
};

// ====================================================================== animated film poster: the fan-made alternative poster
// The posters people draw for the animated films they love: one strong flat colour; the hero's
// silhouette made huge and filled with a sunset, a sun disc in it with a small figure standing there
// (a silhouette inside the silhouette); a sunburst behind; a beam from a lamp; a procession of the
// same figure, smaller and smaller; a winding road with a tiny traveller; stars; the speckle of a
// screen print and a white printer's margin. Warm, playful, a whole story in one picture.
const TOON = { ink: [24, 20, 44], night: [12, 12, 30], cream: [252, 243, 224], sun: [255, 214, 92], amber: [250, 146, 56], coral: [228, 68, 62] };
const toonGround = (C) => (dark ? mix([14, 20, 56], boost(C, 0.5), 0.07) : boost(C, 0.55));   // deep: a night sky with a touch of the channel's hue
/** Lettering on the ground: ink on a light ground, cream on a deep one. */
const toonText = (C) => (lum(toonGround(C)) > 0.55 ? TOON.ink : TOON.cream);
/** The floor the figure stands on (the colour block): the ground, deeper. */
const toonFloor = (C) => mix(toonGround(C), dark ? [0, 0, 0] : TOON.ink, dark ? 0.45 : 0.32);
/** A silhouette's flat colour: a deep tone of the ground, so it reads dark against the sun. */
const toonFigure = (C) => mix(toonGround(C), dark ? [2, 2, 8] : TOON.ink, dark ? 0.6 : 0.72);
/** Small light things on the ground (stars, the road): cream, or on a pale ground a deep tone that shows. */
const toonLight = (C) => (lum(toonGround(C)) > 0.62 ? mix(toonGround(C), TOON.ink, 0.55) : TOON.cream);
/**
 * The picture's centre: a big sun hanging in the open sky at the field's far side, above where the
 * channel graphic stands (and the title's end), so both read; the giant silhouette stands on the floor
 * in front of its lower half.
 */
function toonPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, R = Math.min(fh * (0.16 + 0.26 * p.sun), fw * 0.22), size = fh * (0.4 + 0.55 * p.giant);
  const cx = F.x1 - Math.max(R * 1.15, fw * 0.17), cy = F.y0 + fh * 0.42;
  return { F, cx, cy, R, gx: cx - R * 0.15, gy: F.y1 - size * 0.48, size };
}
/** The sun: a disc rising from the floor, a halo round it, cream going to amber and coral down it (Sunset), cut by bands of the ground in its lower half (Stripes). */
function toonSun(ctx, env, at, p) {
  if (p.sun <= 0) return;
  const { C } = env, { cx, cy, R } = at, ground = toonGround(C), a = Math.min(1, p.sun * 4);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9);
  halo.addColorStop(0, css(TOON.sun, (dark ? 0.45 : 0.3) * a)); halo.addColorStop(1, css(TOON.sun, 0));
  ctx.fillStyle = halo; ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, css(mix(TOON.cream, TOON.sun, 0.4 * p.sunset), a)); g.addColorStop(0.45, css(mix(TOON.cream, TOON.amber, p.sunset), a)); g.addColorStop(0.85, css(mix(TOON.cream, TOON.coral, p.sunset), a));
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.clip();
  if (p.stripes > 0) { ctx.fillStyle = css(ground); for (let i = 0; i < 6; i++) { const t = (i + 1) / 6, y = cy - R * 0.05 + R * 0.85 * t, th = R * 0.075 * t * p.stripes * 1.6; ctx.fillRect(cx - R, y - th / 2, R * 2, th); } }
  ctx.restore();
}
/** A sunburst behind the figure: wedges of a lighter tone fanning out from it, fading with distance. */
function toonBurst(ctx, env, at, amt) {
  if (amt <= 0) return;
  const { w, h, C } = env, ox = at.cx, oy = at.cy, R = Math.hypot(w, h), n = 28, turn = rand(802) * TAU;
  const lit = mix(toonGround(C), dark ? TOON.cream : [255, 255, 255], 0.55), g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 0.7);
  g.addColorStop(0, css(lit, 0.42 * amt)); g.addColorStop(0.5, css(lit, 0.2 * amt)); g.addColorStop(1, css(lit, 0.05 * amt));
  ctx.fillStyle = g; ctx.beginPath();
  for (let i = 0; i < n; i += 2) { const a0 = turn + (i / n) * TAU, a1 = turn + ((i + 1) / n) * TAU; ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a0) * R, oy + Math.sin(a0) * R); ctx.lineTo(ox + Math.cos(a1) * R, oy + Math.sin(a1) * R); ctx.closePath(); }
  ctx.fill();
}
/** Stars over the upper field, more and more of them, one by one: dots of different sizes and a few four-pointed sparkles. */
function toonStars(ctx, env, amt) {
  if (amt <= 0) return;
  const F = openField(env), n = amt * 48, col = toonLight(env.C);
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k), x = F.x0 + rand(k * 2.7 + 810) * (F.x1 - F.x0), y = F.y0 + rand(k * 3.1 + 811) ** 1.5 * (F.y1 - F.y0) * 0.78, big = rand(k * 4.3 + 812);
    if (big > 0.86) { ctx.save(); ctx.globalAlpha = a; starMark(ctx, x, y, 7 + (big - 0.86) * 90, 4, col); ctx.restore(); }
    else { ctx.fillStyle = css(col, (0.4 + 0.55 * big) * a); ctx.beginPath(); ctx.arc(x, y, 1.1 + big * 2.4, 0, TAU); ctx.fill(); }
  }
}
/** A street lamp hanging in from above, its beam falling on the figure: a long wedge of light, brighter near the lamp. */
function toonBeam(ctx, env, at, amt) {
  if (amt <= 0) return;
  const { C } = env, F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, side = rand(820) > 0.5 ? -1 : 1;
  const [lx, ly] = objAt("lamp", at.cx + side * Math.min(fw * 0.26, at.R * 1.4), F.y0 + fh * 0.1, ctx), spread = fh * (0.16 + 0.12 * amt);   // the lamp: a scene object
  const lit = dark ? TOON.cream : mix(toonGround(C), [255, 255, 255], 0.7), g = ctx.createLinearGradient(lx, ly, at.cx, F.y1);
  g.addColorStop(0, css(lit, 0.85 * amt)); g.addColorStop(1, css(lit, 0.32 * amt));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx - 9, ly + 6); ctx.lineTo(lx + 9, ly + 6); ctx.lineTo(at.cx + spread, F.y1); ctx.lineTo(at.cx - spread, F.y1); ctx.closePath(); ctx.fill();
  const iron = css(dark ? [34, 32, 56] : mix(toonGround(C), TOON.ink, 0.9), Math.min(1, amt * 3));   // the lamp: an arm from above, a shade, the bulb
  ctx.strokeStyle = iron; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(lx - side * 70, F.y0 - 20); ctx.quadraticCurveTo(lx - side * 70, ly - 30, lx, ly - 22); ctx.stroke();
  ctx.fillStyle = iron; ctx.beginPath(); ctx.moveTo(lx - 22, ly + 4); ctx.lineTo(lx - 10, ly - 22); ctx.lineTo(lx + 10, ly - 22); ctx.lineTo(lx + 22, ly + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(TOON.cream, Math.min(1, amt * 3)); ctx.beginPath(); ctx.arc(lx, ly + 5, 7, 0, TAU); ctx.fill();
}
/** A road winding down the field, drawn further the higher `amt` goes, a tiny traveller (the graphic) at its end. */
function toonRoad(ctx, env, at, amt, S) {
  if (amt <= 0) return;
  const F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, x0 = F.x0 + fw * 0.47, ph = rand(830) * TAU, col = toonLight(env.C), u = Math.min(env.w, env.h);
  const at_ = (t) => [x0 + Math.sin(t * 19 + ph) * fw * (0.012 + 0.075 * t), F.y0 + fh * (0.06 + 0.94 * t)];
  ctx.strokeStyle = css(col); ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
  let end = at_(0);
  for (let t = 0; t <= amt + 1e-9; t += 0.004) { end = at_(Math.min(t, amt)); t ? ctx.lineTo(...end) : ctx.moveTo(...end); }
  ctx.stroke();
  if (S) placeShape(ctx, S, col, end[0], end[1] - u * 0.026, u * 0.05);
}
/** The figure again, standing on the floor in a procession toward the giant one, each further one smaller; they come in one by one. */
function toonParade(ctx, env, at, amt, S) {
  if (amt <= 0 || !S) return;
  const n = amt * 7, col = dark ? mix(toonGround(env.C), TOON.cream, 0.4) : toonFigure(env.C);   // on the night ground a lit tone, or they would vanish
  let x = at.cx - at.R * 0.9, s = (at.F.y1 - at.F.y0) * 0.24;
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k);
    x -= s * 0.62; if (x < at.F.x0 + s * 0.3) break;
    ctx.save(); ctx.globalAlpha = a; placeShape(ctx, S, col, x, at.F.y1 - s * 0.5, s); ctx.restore();
    x -= s * 0.32; s *= 0.8;
  }
}
const toon = {
  id: "toon",
  art: "giant",
  repaint: (c) => `a fan-made alternative poster for an animated film, made from the photograph: one strong flat colour (${c}), the subject reduced to bold flat shapes and a clean silhouette, a warm sunset glow, simple graphic light, a little screen-print speckle; playful and warm; still the same picture, no text.`,
  about: { zh: "动画电影的另类海报：一整块浓烈的颜色（从频道色来），天边一轮带复古条纹的大夕阳，频道图形站在它下方，还可以在太阳前立起一个巨大的同形剪影；放射光芒、路灯投下的光柱、一列越来越小的同一个身影、一条蜿蜒的小路和路上的小旅人、星空；丝网印刷的斑驳和海报的白边。温暖、童趣、一张图讲一个故事——适合动画、亲子、旅行、成长、治愈和节日内容。可选亮色底或深色底；自带平直的版式。", en: "The alternative poster for an animated film: one strong colour (from the channel's), a big striped setting sun hanging over where the channel graphic stands, and if you like its huge silhouette in front of the sun; a sunburst, a lamp's beam, a procession of the same figure growing smaller, a winding road with a tiny traveller, stars; the speckle of a screen print and a white margin. Warm, playful, a story in one picture — for animation, family, travel, growing up, feel-good and festive content. A bright or a deep ground; flat layouts of its own." },
  name: { zh: "动画海报", en: "Animated film poster" },
  seeded: true,
  scene: { sun: { zh: "夕阳与光芒", en: "Sun and sunburst" }, giant: { zh: "巨型剪影", en: "Giant silhouette" }, lamp: { zh: "路灯光柱", en: "Street-lamp beam" } },
  params: [
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "夕阳", en: "Setting sun" } },
    { key: "sunset", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "夕阳渐变", en: "Sunset colours" } },
    { key: "stripes", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "日落条纹", en: "Sun stripes" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "放射光芒", en: "Sunburst" } },
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "巨型剪影", en: "Giant silhouette" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "路灯光柱", en: "Lamp beam" } },
    { key: "parade", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "列队身影", en: "Procession" } },
    { key: "road", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "蜿蜒小路", en: "Winding road" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "星星", en: "Stars" } },
    { key: "distress", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "丝网斑驳", en: "Screen-print wear" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "海报白边", en: "White margin" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "演职员小字", en: "Credits" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片单色", en: "Photo in one colour" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base, C) => ({ ...base, field: css(toonGround(C)), text: css(toonText(C)), dim: css(toonText(C), 0.6), titleFill: css(toonText(C)), titleInk: css(toonGround(C)), grid: () => css(toonText(C), 0.12) }),
  /**
   * The ground; a sunburst and stars; the setting sun behind where the channel graphic stands; the
   * giant silhouette against it; a lamp's beam, a winding road, a procession. A photo goes into the
   * ground's colour; one filling the canvas still gets the stars, the sun and the beam.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = toonGround(C), at = toonPlace(env, p);
    if (p.sun > 0 || p.burst > 0) [at.cx, at.cy] = objAt("sun", at.cx, at.cy, ctx);   // the sun and the rays from it: a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], ground, 0.9), p.duo);
      wash(ctx, w, h, "screen", mix([0, 0, 0], ground, 0.3), p.duo);
      if (L.fill) { toonStars(ctx, env, p.stars); toonSun(ctx, env, at, p); toonBeam(ctx, env, at, p.beam); }
      return true;
    }
    if (!L.grid) return true;
    const S = canPaint(ctx) && graphicShape(env);
    toonBurst(ctx, env, at, p.burst);
    toonStars(ctx, env, p.stars);
    toonSun(ctx, env, at, p);
    if (S && p.giant > 0) { const [gx, gy] = objAt("giant", at.gx, at.gy, ctx); placeShape(ctx, S, toonFigure(C), gx, gy, at.size); }   // the hero, huge and dark against the sun: a scene object
    toonBeam(ctx, env, at, p.beam);
    toonRoad(ctx, env, at, p.road, S);
    toonParade(ctx, env, at, p.parade, S);
    return true;
  },
  /** A sunburst's construction: rings round a point under the foot of the picture, and rays from it every 10°. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h * 1.08, R = Math.hypot(w, h), r0 = 140;
    gridPen(ctx, color); ctx.beginPath();
    for (let r = r0; r < R; r += 110) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    for (let a = 0; a < 360; a += 10) { const t = (a * Math.PI) / 180; ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); ctx.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(toonFloor(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },
  /** Bold condensed capitals, flat, with a shadow a little off in a deeper tone of the ground, as a print's second colour; highlighted words in sun yellow or coral. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || TOON.coral, ground = toonGround(C), hi = o.hi || (lum(ground) > 0.55 ? TOON.coral : TOON.sun), d = fs * 0.045 * Math.min(2, o.shadowAmt);
    if (d > 0) pass((a, x) => { ctx.fillStyle = css(mix(ground, TOON.ink, 0.55)); ctx.fillText(a.t, x + d, d); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || toonText(C)); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: toonText(C) }, stroke: { ink: toonText(C) } }
    : { fill: { ink: TOON.ink, light: TOON.cream, mid: mix(toonGround(C), TOON.cream, 0.5), dark: mix(toonGround(C), TOON.ink, 0.7), colour: (c) => boost(c, 0.4) }, stroke: { ink: TOON.ink, light: TOON.cream }, line: 0.6 }),
  sticker: painters({ line: null, tone: inkAs(TOON.ink, (c) => boost(c, 0.4)), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 8); draw(css(TOON.ink, 0.35)); ctx.restore(); } }),
  /** The corner tag: a rounded ticket — ink with cream letters on a pale ground, sun yellow with ink letters on a deep one. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66, pale = lum(toonGround(C)) > 0.55;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(pale ? TOON.ink : TOON.sun); ctx.fill();
    ctx.fillStyle = ink || css(pale ? TOON.cream : TOON.ink); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: "presents" over the top in small capitals, and the billing block at the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h, C } = env, P = env.o.profile, col = css(toonText(C), 0.85 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.font = `700 16px ${fonts.en}, ${fonts.cn}`;
    if (P.brand.name) spacedCentre(ctx, `${P.brand.name.toUpperCase()} PRESENTS`, w / 2, 44, 4);
    const bw = Math.min(w * 0.42, 700);
    greeked(ctx, (w - bw) / 2, h - 70, bw, 3, 8, css(toonText(C), 0.55 * a), 840 + env.o.catIndex, "center");
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(TOON.ink, 0.4); ctx.shadowBlur = 0; ctx.shadowOffsetX = 7 * unit; ctx.shadowOffsetY = 9 * unit; },
  /** The speckle and blotches of a screen print, paper grain, and the white margin the printer leaves. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, mix(toonGround(C), TOON.cream, 0.55), p.distress * 0.85);
    grain(ctx, 0.25 + p.distress * 0.35, unit, !dark && lum(toonGround(C)) > 0.5);
    const b = 54 * p.border;
    if (b >= 1) { ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(b, b, w - 2 * b, h - 2 * b); ctx.fillStyle = css([250, 247, 240]); ctx.fill("evenodd"); }
  },
  prompt: `Stickers for a fan-made poster of an animated film — bold, warm and playful — that read at a glance:
- one clear, characterful silhouette per sticker (a hero, an animal, a lamp, a balloon, a house, a little vehicle), simple and charming; no realism, no perspective, no fine detail;
- flat colour only: the main colour, "ink" for silhouettes and dark parts, "white" for a light; at most one small warm accent ("yellow" or "red");
- the app adds a soft offset shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Props from an animated film, built as simple models from a few boxes and cylinders with friendly, slightly exaggerated proportions — a lamp post, a little house, a toy car, a suitcase; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep ink, and "main" the channel colour made more vivid — use it for one to three parts.`,
};

// ====================================================================== avant-garde image: today's design-studio poster
// The posters design studios and fashion labels post today: a black-and-white photograph (or the
// channel graphic as a figure) worked on as a designer works on it in the computer — a smear of motion,
// a glow, the picture out of focus with one sharp frame of focus, a patch gone to pixels, a panel of
// fluted glass, a band where colour comes through; hairline grid lines with small markers and
// interface labels; a big tight grotesque; the channel colour as the only accent.
const AV = { paper: [226, 226, 223], night: [11, 11, 13], ink: [14, 14, 16], white: [238, 238, 234] };
const avGround = () => (dark ? AV.night : AV.paper), avInk = () => (dark ? AV.white : AV.ink);
/** A copy of what ctx's canvas holds now (a work canvas per slot). */
function snap(ctx, slot) { const x = workLike(ctx, slot); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0); return x.canvas; }
/** Runs draw() with ctx in canvas pixels (the clip, if any, stays). */
function inPixels(ctx, draw) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); draw(); ctx.restore(); }
/** A soft copy of `src`: drawn down small in two steps (so it does not shimmer) and kept; `f` how many times smaller. */
function softCopy(src, f, slot) {
  const mid = WORK[slot + "m"] || (WORK[slot + "m"] = document.createElement("canvas")), small = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  const mw = Math.max(4, Math.round(src.width / 3)), mh = Math.max(4, Math.round(src.height / 3)), sw = Math.max(2, Math.round(src.width / f)), sh = Math.max(2, Math.round(src.height / f));
  if (mid.width !== mw || mid.height !== mh) { mid.width = mw; mid.height = mh; }
  if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
  const m = mid.getContext("2d"), s = small.getContext("2d");
  m.imageSmoothingEnabled = s.imageSmoothingEnabled = true; m.imageSmoothingQuality = s.imageSmoothingQuality = "high";
  m.globalCompositeOperation = s.globalCompositeOperation = "copy"; m.drawImage(src, 0, 0, mw, mh); s.drawImage(mid, 0, 0, sw, sh);
  return small;
}
/** The figure without a photo: the channel graphic, large, standing in the open field, soft at its edge; a mid grey on either ground, so the lettering over it still reads. */
function avFigure(ctx, env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.55 + 0.5 * p.figure), box = { cx: F.x0 + fw * 0.62, cy: F.y1 - size * 0.46, size };
  const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
  if (S) [box.cx, box.cy] = objAt("figure", box.cx, box.cy, ctx);   // a scene object: the focus frame, glass and band follow it
  if (S) {
    const col = dark ? [128, 128, 126] : [112, 112, 114];
    blurred(ctx, size * 0.035, css(col, 0.55), () => placeShape(ctx, S, [0, 0, 0], box.cx, box.cy, size * 1.02));
    ctx.save(); ctx.globalAlpha = 0.92; placeShape(ctx, S, col, box.cx, box.cy, size); ctx.restore();
  }
  return box;
}
/** Motion: the picture smeared sideways, a few fainter and fainter copies trailing to one side. */
function avSmear(ctx, u, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "avSnap"), k = ctx.getTransform().a, n = fast ? 3 : 7;
  inPixels(ctx, () => { for (let i = n; i >= 1; i--) { ctx.globalAlpha = 0.26 * amt * (1 - i / (n + 1)); ctx.drawImage(src, -i * u * 0.022 * amt * k, 0); } });
}
/** A glow: a soft copy of the picture screened over it on the dark ground (light spills from the bright figure), lightened in on the light one (a haze). */
function avGlow(ctx, amt) {
  if (amt <= 0 || !canPaint(ctx) || fast) return;
  const soft = softCopy(snap(ctx, "avSnap"), 24, "avGlow"), cv = ctx.canvas;
  inPixels(ctx, () => { ctx.globalCompositeOperation = dark ? "screen" : "lighten"; ctx.globalAlpha = (dark ? 0.85 : 0.6) * amt; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
}
/**
 * Out of focus, with a frame of focus: the picture drawn soft over itself, then a rectangle round the
 * figure's head drawn sharp again, with a hairline round it and ticks at its corners. The frame grows
 * with its slider; without blur there is nothing for it to show, so it waits for blur.
 */
function avFocus(ctx, env, box, blur, focus, sharp) {
  if (blur <= 0 || !sharp) return;
  const cv = ctx.canvas, soft = softCopy(sharp, 10 + 26 * blur, "avBlur"), m = ctx.getTransform(), k = m.a, u = Math.min(env.w, env.h);
  inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, blur * 1.6); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
  if (focus <= 0) return;
  const fw = u * (0.16 + 0.26 * focus), fh = fw * 0.66, x = clamp(box.cx - fw * 0.55, 0, env.w - fw), y = clamp(box.cy - box.size * 0.3 - fh / 2, 0, env.h - fh), a = Math.min(1, focus * 3);
  inPixels(ctx, () => { ctx.globalAlpha = a; ctx.drawImage(sharp, m.e + x * k, m.f + y * k, fw * k, fh * k, m.e + x * k, m.f + y * k, fw * k, fh * k); });
  ctx.save(); ctx.strokeStyle = css(avInk(), 0.75 * a); ctx.lineWidth = 1.2; ctx.strokeRect(x, y, fw, fh);
  ctx.lineWidth = 2.4; const t = 16;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + fw, y, -1, 1], [x, y + fh, 1, -1], [x + fw, y + fh, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx - sx * 6, cy + sy * t); ctx.lineTo(cx - sx * 6, cy - sy * 6); ctx.lineTo(cx + sx * t, cy - sy * 6); ctx.stroke(); }
  ctx.restore();
}
/**
 * A patch of the picture gone to large pixels — taken from `src`, the picture before the blur, so the
 * cells keep its contrast, each a step lighter or darker — its edge stepped, a few cells knocked out
 * of place, set where the title leaves room; it grows with `amt`.
 */
function avMosaic(ctx, env, box, u, amt, src) {
  if (amt <= 0 || !src) return;
  const m = ctx.getTransform(), k = m.a, cell = u * 0.034, F = openField(env), T = titleArea(ctx, env);
  const W = ctx.canvas.width / k, H = ctx.canvas.height / k, fw = F.x1 - F.x0;
  let rw = u * (0.08 + 0.34 * amt), rh = rw * 0.8, cx = box.cx + box.size * 0.05, cy = box.cy - box.size * 0.15;
  // where it shows: beside the title if there is room, else under it (as large as the room allows), else over the figure
  const side = T ? F.x1 - 40 - (T.x + T.w + 40) : 0, under = T ? F.y1 - 24 - (T.y + T.h + 24) : 0;
  // (held in by the room one way, it still grows the other, so more is more)
  if (T && side >= u * 0.12) { rw = Math.min(rw, side); cx = (T.x + T.w + 40 + F.x1 - 40) / 2; cy = (F.y0 + F.y1) * 0.45; }
  else if (T && under >= u * 0.08) { rh = Math.min(rh, under); cx = F.x0 + fw * 0.3; cy = T.y + T.h + 24 + rh / 2; }   // left of the band and the figure
  const rx = clamp(cx - rw / 2, 0, W - rw), ry = clamp(cy - rh / 2, 0, H - rh), nx = Math.max(1, Math.round(rw / cell)), ny = Math.max(1, Math.round(rh / cell));
  const t = WORK.avCells || (WORK.avCells = document.createElement("canvas"));
  if (t.width !== nx || t.height !== ny) { t.width = nx; t.height = ny; }
  const x = t.getContext("2d"); x.imageSmoothingEnabled = true; x.globalCompositeOperation = "copy";
  x.drawImage(src, m.e + rx * k, m.f + ry * k, nx * cell * k, ny * cell * k, 0, 0, nx, ny);   // each cell the average of what is under it
  inPixels(ctx, () => {
    ctx.imageSmoothingEnabled = false;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const dx = (i + 0.5) / nx - 0.5, dy = (j + 0.5) / ny - 0.5;
      if (dx * dx * 4 + dy * dy * 4 > 0.7 + 0.45 * rand(i * 7.1 + j * 3.3 + 850)) continue;   // a stepped, ragged edge
      const off = rand(i * 2.9 + j * 5.7 + 851) > 0.9 ? Math.round((rand(i + j * 9 + 852) - 0.5) * 4) : 0;   // a few cells out of place
      const X = m.e + (rx + i * cell) * k, Y = m.f + (ry + j * cell) * k, D = Math.ceil(cell * k), q = rand(i * 4.1 + j * 6.7 + 853);
      ctx.drawImage(t, clamp(i + off, 0, nx - 1), j, 1, 1, X, Y, D, D);
      ctx.fillStyle = q > 0.5 ? `rgba(255,255,255,${(q - 0.5) * 0.22})` : `rgba(0,0,0,${(0.5 - q) * 0.22})`; ctx.fillRect(X, Y, D, D);   // each a step lighter or darker, so the cells read even where the picture is flat
    }
  });
}
/**
 * Fluted glass: the picture seen through a panel of narrow vertical flutes, each one squeezing a wider
 * slice of what is behind it into its own width, shaded at one edge and lit at the other. The panel
 * stands over the figure and widens with `amt` until it covers the whole picture.
 */
function avGlass(ctx, env, box, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const { w, h } = env, u = Math.min(w, h), src = snap(ctx, "avSnap"), m = ctx.getTransform(), k = m.a, pitch = u * 0.04;
  const half = (w * (0.1 + 0.95 * amt)) / 2, x0 = Math.max(0, Math.floor((box.cx - half) / pitch) * pitch), x1 = Math.min(w, Math.ceil((box.cx + half) / pitch) * pitch);
  inPixels(ctx, () => {
    for (let x = x0; x < x1; x += pitch) {
      const sw = pitch * 1.9, sx = clamp(x + pitch / 2 - sw / 2, 0, w - sw), X = m.e + x * k, P = pitch * k;
      ctx.drawImage(src, m.e + sx * k, 0, sw * k, src.height, X, 0, P, src.height);
      const g = ctx.createLinearGradient(X, 0, X + P, 0);
      g.addColorStop(0, "rgba(0,0,0,0.26)"); g.addColorStop(0.22, "rgba(255,255,255,0.08)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(0.86, "rgba(255,255,255,0.2)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = g; ctx.fillRect(X, 0, P, src.height);
    }
  });
  ctx.fillStyle = css(avInk(), 0.35); ctx.fillRect(x0, 0, 1, h); ctx.fillRect(x1 - 1, 0, 1, h);
}
/**
 * A vertical band, a clear window onto the picture as it was before the blur and the glass (`sharp`),
 * its tones mapped onto the channel colour (dark to a deep shade of it, light to the colour itself);
 * hairlines at its edges. It widens with `amt`.
 */
function avBand(ctx, env, box, amt, sharp) {
  if (amt <= 0) return;
  const { w, h, C } = env, bw = w * 0.2 * Math.pow(amt, 0.8), x = clamp(box.cx - box.size * 0.12 - bw / 2, 0, w - bw);
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, bw, h); ctx.clip();
  if (sharp) inPixels(ctx, () => ctx.drawImage(sharp, 0, 0));
  ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(C); ctx.fillRect(x, 0, bw, h);
  ctx.globalCompositeOperation = "screen"; ctx.fillStyle = css(mix([0, 0, 0], C, 0.18)); ctx.fillRect(x, 0, bw, h);
  ctx.restore();
  ctx.fillStyle = css(avInk(), 0.7); ctx.fillRect(x - 1, 0, 1.5, h); ctx.fillRect(x + bw, 0, 1.5, h);
}
const avant = {
  id: "avant",
  art: "figure",
  repaint: (c) => `a contemporary fashion and design-studio poster made from the photograph: black and white, soft and slightly out of focus, a little motion blur, fine grain, clean studio light, with one small accent of ${c}; still the same picture, no text.`,
  about: { zh: "先锋影像：今天的设计工作室和时装品牌常发的海报。黑白照片（没有照片时，频道图形化成一个柔焦的身影），像设计师在电脑里那样加工：动态拖影、辉光、焦外虚化里留一个清晰的对焦框、一块变成大像素的马赛克、一片条纹玻璃、一条透出频道色的色带；细线网格、圆点标记和界面式的小字；紧凑的大号无衬线标题；频道色是唯一的点缀。冷静、锐利、有数码时代的质感——适合设计、时尚、科技、人物、观点和品牌内容。可选浅灰底或黑底；自带平直的版式。", en: "Avant-garde image: the posters design studios and fashion labels post today. A black-and-white photograph (or, without one, the channel graphic as a soft figure) worked on as a designer would in the computer: a smear of motion, a glow, out of focus with one sharp frame of focus, a patch gone to large pixels, a panel of fluted glass, a band where the channel colour comes through; hairline grid lines, dot markers and interface-like labels; a big tight grotesque; the channel colour the only accent. Cool, sharp, digital — for design, fashion, tech, portraits, opinion and brand content. A light grey or a black ground; flat layouts of its own." },
  name: { zh: "先锋影像", en: "Avant-garde image" },
  seeded: true,
  scene: { figure: { zh: "身影", en: "Figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "身影", en: "Figure" } },
    { key: "smear", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "动态拖影", en: "Motion smear" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "辉光", en: "Glow" } },
    { key: "blur", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "焦外虚化", en: "Out of focus" } },
    { key: "focus", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "对焦框", en: "Frame of focus" } },
    { key: "mosaic", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "像素马赛克", en: "Pixel mosaic" } },
    { key: "glass", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "条纹玻璃", en: "Fluted glass" } },
    { key: "band", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "色带", en: "Colour band" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "渐隐", en: "Fade out" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "网格与标注", en: "Grid and labels" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "颗粒", en: "Grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.17, side: 0.3, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(avGround()), text: css(avInk()), dim: css(avInk(), 0.55), titleFill: css(avInk()), titleInk: css(avGround()), grid: () => css(avInk(), 0.14) }),
  /**
   * The ground (a studio backdrop, lighter in the middle) and the figure, or the photo in black and
   * white; then, in order, the motion smear, the glow, the blur with its frame of focus, the fluted
   * glass, the mosaic, the colour band (a clear window onto the picture before the blur and the glass)
   * and the fade — each working on what is there so far, so the lettering and everything above stays
   * sharp. A print photo is only turned black and white.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = avGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    let box;
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (!L.fill) return true;
      box = { cx: w * 0.55, cy: h * 0.5, size: h * 0.9 };
    } else {
      if (L.ground !== false) {   // the studio backdrop, lighter in the middle: the ground
        const g = ctx.createRadialGradient(w * 0.6, h * 0.42, 0, w * 0.6, h * 0.42, Math.hypot(w, h) * 0.6);
        g.addColorStop(0, css(dark ? [44, 44, 48] : [244, 244, 242])); g.addColorStop(1, css(ground));
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      if (!L.grid) return true;
      box = avFigure(ctx, env, p);
    }
    avSmear(ctx, u, p.smear);
    avGlow(ctx, p.glow);
    const sharp = canPaint(ctx) && (p.blur > 0 || p.band > 0 || p.mosaic > 0) ? snap(ctx, "avSharp") : null;   // the picture before the blur and the glass: the frame of focus, the mosaic and the band show it
    avFocus(ctx, env, box, p.blur, p.focus, sharp);
    avGlass(ctx, env, box, p.glass);
    avMosaic(ctx, env, box, u, p.mosaic, sharp);   // over the glass, so its cells stay square
    avBand(ctx, env, box, p.band, sharp);
    if (p.fade > 0) wherePainted(ctx, (c) => { const f = c.createLinearGradient(0, h * 0.45, 0, h); f.addColorStop(0, css(ground, 0)); f.addColorStop(1, css(ground, Math.min(1, p.fade * 1.1))); c.fillStyle = f; c.fillRect(0, 0, w, h); }, L.base === "clear");   // on a see-through base, what is there fades
    return true;
  },
  /** A layout grid as a design tool shows it: twelve columns in hairlines, and a cross at every column line on each eighth of the height. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 64, xs = every(m, w - m + 1, (w - 2 * m) / 12), ys = every(m, h - m + 1, (h - 2 * m) / 8);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.5; gridPath(ctx, xs, [], 0, 0, 0, h);
    ctx.globalAlpha = 1; ctx.beginPath(); for (const x of xs) for (const y of ys) { ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); } ctx.stroke();
    ctx.restore();
  },
  accent: { fill: () => css(dark ? [26, 26, 30] : [206, 206, 203]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(avInk(), 0.45); ctx.lineWidth = 1.5; run(0, 0); } },
  /** A big grotesque, upright and flat; highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || o.C || avInk() : o.fill || avInk()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: avInk() }, stroke: { ink: avInk() } }
    : { fill: { ink: AV.ink, light: AV.white, mid: [170, 170, 168], dark: [48, 48, 50], colour: (c) => grey(c) }, stroke: { ink: AV.ink, light: AV.white, colour: (c) => grey(c) }, line: 0.45 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "colour" ? css(grey(c), c[3]) : fill; } }),
  /** The corner tag: monospaced capitals in a hairline box, a small square of the channel colour before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.5;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2.6, h = f * 2, top = y + (fs * 1.34 - h);
    ctx.strokeStyle = css(avInk(), 0.8); ctx.lineWidth = 1.5; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = css(C); ctx.fillRect(x + f * 0.6, top + h / 2 - f * 0.3, f * 0.6, f * 0.6);
    ctx.fillStyle = ink || css(avInk()); spaced(ctx, str, x + f * 1.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: hairlines down and across, dot markers where they meet, interface labels along the foot, a few lines of small print. */
  frame(ctx, env, p) {
    const a = p.grid;
    if (a <= 0) return;
    const { w, h } = env, ink = avInk(), P = env.o.profile, i = env.o.catIndex, total = P.categories.length, xs = [64, w * 0.36, w * 0.64, w - 64], ys = [h * 0.58, h - 76];
    ctx.save(); ctx.fillStyle = css(ink, 0.28 * a);
    for (const x of xs) ctx.fillRect(Math.round(x), 0, 1, h);
    for (const y of ys) ctx.fillRect(0, Math.round(y), w, 1);
    ctx.fillStyle = css(ink, 0.85 * a);
    for (const x of xs) for (const y of ys) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill(); }
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    [(P.brand.name || "STUDIO").toUpperCase(), `VOL.${pad2(i + 1)}`, `# ${(env.cat.code || env.cat.name || "").toUpperCase()}`, `${pad2(i + 1)} / ${pad2(total)}`].forEach((t, k) => ctx.fillText(t, xs[k] + (k === 3 ? -ctx.measureText(t).width - 10 : 10), h - 48));
    greeked(ctx, xs[2] + 10, ys[0] + 14, w * 0.22, 4, 9, css(ink, 0.45 * a), 860 + i);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * (dark ? 0.75 : 0.6), unit); },
  prompt: `Graphic elements for a contemporary design-studio poster — precise, reduced, a little technical — that read at a glance:
- one clean shape per sticker (an arrow, a cross, a circle, a hand, a pair of glasses, a figure in profile, a cursor), simple and exact; no realism, no perspective, no detail;
- flat colour only: "ink" and "white", with the main colour as a single small accent (it is the only colour on the poster);
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a product shot for a design studio would show them: a few boxes and cylinders, exact and minimal — a speaker, a lamp, a camera, a chair; no realism, no fine detail.
- the renderer paints faces in greys with a hairline: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a mid grey.`,
};

// ====================================================================== shared by the looks below: reading and recolouring pixels
/** A colour turned round the colour wheel by `deg` degrees, its saturation and lightness kept. */
function hueTurn(c, deg) {
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
function toneTable(stops, hard = 0) {
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
function mapTones(ctx, lut, amt) {
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
function sampled(ctx, x0, y0, cols, rows, cell, slot) {
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
function shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell) {
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

// ====================================================================== collage: paper, scissors, glue
// The mixed-media collage poster: a black-and-white figure cut from a magazine, a big disc of colour
// behind it, pieces of coloured paper torn by hand, strips of newsprint, patches of halftone, a
// starburst, a scribble in marker, tape, a ticket and a barcode; every piece lifts a little off the
// sheet. Loud, layered, handmade.
const CL = { paper: [238, 232, 218], night: [26, 24, 28], ink: [20, 20, 22], white: [250, 248, 242], red: [226, 52, 42], mustard: [244, 180, 30], teal: [32, 150, 142], pink: [244, 130, 172] };
const clGround = () => (dark ? CL.night : CL.paper), clInk = () => (dark ? CL.white : CL.ink);
/** The paper colours a piece is cut from: the channel colour first, then the collage's own. */
const clColours = (C) => [C, CL.red, CL.mustard, CL.ink, CL.teal, CL.pink, CL.white];
/**
 * A piece of paper torn by hand, w × h, centred on (cx, cy) and turned by `a`: every edge wanders a
 * little; a margin of bare white fibre shows where it was torn; it casts a soft shadow (`lift`).
 * `inside(ctx)`, if given, paints on the piece in its own frame (newsprint, say).
 */
function tornPiece(ctx, cx, cy, w, h, a, colour, k, lift, inside) {
  const n = 9, jag = Math.min(w, h) * 0.07, pts = [];
  const side = (x0, y0, x1, y1, s) => { for (let i = 0; i < n; i++) { const t = i / n, o = (rand(k + s * 17.3 + i * 2.1) - 0.5) * jag; pts.push([x0 + (x1 - x0) * t + (y1 !== y0 ? o : 0), y0 + (y1 - y0) * t + (x1 !== x0 ? o : 0)]); } };
  side(-w / 2, -h / 2, w / 2, -h / 2, 1); side(w / 2, -h / 2, w / 2, h / 2, 2); side(w / 2, h / 2, -w / 2, h / 2, 3); side(-w / 2, h / 2, -w / 2, -h / 2, 4);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  shapeOf(ctx, pts);
  if (lift > 0) { ctx.shadowColor = `rgba(0,0,0,${0.32 * lift})`; ctx.shadowBlur = 6 + 12 * lift; ctx.shadowOffsetX = 3 * lift; ctx.shadowOffsetY = 6 * lift; }
  ctx.strokeStyle = css(CL.white); ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.035); ctx.lineJoin = "round"; ctx.stroke();
  ctx.shadowColor = "rgba(0,0,0,0)"; ctx.fillStyle = css(colour); ctx.fill();
  if (inside) { ctx.save(); ctx.clip(); inside(ctx); ctx.restore(); }
  ctx.restore();
}
/** A starburst: a spiky star, its points of uneven length. */
function starburst(ctx, cx, cy, R, n, colour, k) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) { const t = (i / (n * 2)) * TAU + rand(k) * 0.4, r = i % 2 ? R * (0.42 + rand(k + i * 1.3) * 0.12) : R * (0.78 + rand(k + i * 2.7) * 0.28); ctx.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r); }
  ctx.closePath(); ctx.fillStyle = css(colour); ctx.fill();
}
/** Where the collage gathers: round the channel graphic if it stands in the open field, else toward the field's far side. */
function clCentre(env) {
  const F = openField(env), fw = F.x1 - F.x0, A = env.G && env.G.art;
  return { F, cx: A && A.x > F.x0 + fw * 0.25 && A.x < F.x1 ? A.x : F.x0 + fw * 0.68, cy: A && A.y > F.y0 && A.y < F.y1 ? A.y : (F.y0 + F.y1) * 0.55 };
}
/**
 * The pieces of the collage, behind the title and the graphic: the disc, strips of newsprint, torn
 * paper, halftone patches, the starburst and the scribble — each coming in over its own slider, and
 * "more" meaning more pieces, one by one.
 */
function clPieces(ctx, env, p, onPhoto) {
  const { w, h, C } = env, u = Math.min(w, h), { F, cx, cy } = clCentre(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cols = clColours(C);
  if (p.disc > 0) {   // the big disc of colour behind the figure; over a photo it tints what it covers
    ctx.save(); if (onPhoto) ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = css(onPhoto ? mix([255, 255, 255], C, 0.85) : C, Math.min(1, p.disc * 3));
    const [dx, dy] = objAt("disc", cx + fw * 0.02, cy - fh * 0.06, ctx);   // each of these three a scene object
    ctx.beginPath(); ctx.arc(dx, dy, fh * (0.22 + 0.3 * p.disc), 0, TAU); ctx.fill(); ctx.restore();
  }
  if (p.burst > 0) { const [bx, by] = objAt("burst", cx - fw * 0.16, cy - fh * 0.28, ctx); starburst(ctx, bx, by, fh * (0.08 + 0.2 * p.burst), 11, mix(CL.mustard, [255, 120, 30], 0.35), 960); }
  for (let k = 0, n = p.strips * 6; k < Math.ceil(n); k++) {   // strips of newsprint, torn across
    const a = clamp(n - k), sw = fw * (0.3 + rand(k * 2.3 + 961) * 0.4), sh = u * (0.035 + rand(k * 3.1 + 962) * 0.04);
    ctx.save(); ctx.globalAlpha = a;
    tornPiece(ctx, F.x0 + fw * (0.25 + rand(k * 4.7 + 963) * 0.6), F.y0 + fh * (0.12 + rand(k * 5.3 + 964) * 0.78), sw, sh, (rand(k * 6.1 + 965) - 0.5) * 0.5, k % 3 === 2 ? CL.mustard : CL.white, k * 7 + 966, p.lift,
      (x) => greeked(x, -sw / 2 + sh * 0.25, -sh / 2 + sh * 0.2, sw - sh * 0.5, 3, sh * 0.24, css(CL.ink, 0.55), k * 11 + 967));
    ctx.restore();
  }
  for (let k = 0, n = p.torn * 10; k < Math.ceil(n); k++) {   // torn pieces of coloured paper, round the figure
    const a = clamp(n - k), r = rand(k * 1.9 + 970), pw = u * (0.07 + r * 0.17), ph = pw * (0.55 + rand(k * 2.9 + 971) * 0.9);
    const ang = rand(k * 3.7 + 972) * TAU, d = fh * (0.18 + rand(k * 4.3 + 973) * 0.36);
    ctx.save(); ctx.globalAlpha = a;
    tornPiece(ctx, clamp(cx + Math.cos(ang) * d * 1.4, F.x0 + pw * 0.3, F.x1 - pw * 0.3), clamp(cy + Math.sin(ang) * d, F.y0 + ph * 0.3, F.y1), pw, ph, (rand(k * 5.9 + 974) - 0.5) * 1.2, cols[k % cols.length], k * 9 + 975, p.lift);
    ctx.restore();
  }
  for (let k = 0, n = p.halftone * 5; k < Math.ceil(n); k++) {   // patches of a coarse halftone: discs and slabs
    const a = clamp(n - k), r = u * (0.05 + rand(k * 2.1 + 980) * 0.09), x = F.x0 + fw * (0.15 + rand(k * 3.3 + 981) * 0.8), y = F.y0 + fh * (0.1 + rand(k * 4.1 + 982) * 0.8);
    ctx.save(); ctx.beginPath(); k % 2 ? ctx.rect(x - r, y - r * 0.6, r * 2, r * 1.2) : ctx.arc(x, y, r, 0, TAU); ctx.clip();
    dotScreen(ctx, w, h, k % 3 === 1 ? CL.red : dark ? CL.white : CL.ink, 9 + (k % 3) * 3, 0.85 * a, "source-over"); ctx.restore();
  }
  if (p.scribble > 0) {   // a loop of marker, drawn further the higher the slider
    const [sx, sy] = objAt("scribble", cx - fw * 0.05, cy + fh * 0.12, ctx), R = fh * 0.16, ph = rand(990) * TAU, len = 40 * p.scribble;
    ctx.save(); ctx.strokeStyle = css(dark ? CL.white : CL.ink, 0.85); ctx.lineWidth = Math.max(2.5, u * 0.004); ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath();
    for (let t = 0; t <= len; t += 0.08) { const x = sx + R * (Math.sin(t * 0.9 + ph) * 1.6 + Math.sin(t * 5.3) * 0.32), y = sy + R * (Math.cos(t * 1.27 + ph) * 0.7 + Math.cos(t * 5.1) * 0.3); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  }
}
/** A barcode: bars of uneven width, a line of digits under them. */
function barcode(ctx, x, y, w, h, colour, k) {
  ctx.fillStyle = css(colour);
  for (let at = x, i = 0; at < x + w; i++) { const bw = 1 + Math.floor(rand(k + i * 1.7) * 4), gap = 1 + Math.floor(rand(k + i * 2.3) * 3); if (at + bw > x + w) break; ctx.fillRect(at, y, bw, h * 0.78); at += bw + gap; }
  ctx.font = `600 ${Math.round(h * 0.17)}px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(String(Math.floor(rand(k + 99) * 9e12)).padStart(13, "4"), x, y + h);
}
const collage = {
  id: "collage",
  repaint: (c) => `a mixed-media paper collage made from the photograph: the subject cut out in black and white like a magazine clipping, set on torn pieces of coloured paper (${c}, vermilion, mustard, teal), a big disc of colour behind, halftone dots, strips of newsprint, tape; tactile and handmade; no text.`,
  about: { zh: "拼贴艺术：剪报式的混合媒介拼贴——黑白人物像从杂志上剪下来，身后一个大色圆（频道色），四周是手撕的彩色纸片、一条条旧报纸、粗网点色块、爆炸星、马克笔涂鸦，再用胶带、票根和条形码钉住；每一片纸都微微翘起、投下影子，标题贴在一条条纸签上。热闹、有手作感、有态度——适合设计、潮流、艺术、观点、生活方式和年轻向内容。可选米白纸底或黑纸底。", en: "Collage: mixed media as a scrapbook would have it — a black-and-white figure cut from a magazine, a big disc of the channel colour behind, pieces of coloured paper torn by hand, strips of old newsprint, patches of coarse halftone, a starburst, a scribble in marker, held down with tape, a ticket stub and a barcode; every piece lifts a little and casts a shadow, and the title is pasted on paper labels. Loud, handmade, opinionated — for design, fashion, art, opinion, lifestyle and youth content. Cream or black paper." },
  name: { zh: "拼贴艺术", en: "Collage" },
  seeded: true,
  scene: { disc: { zh: "大色圆", en: "Colour disc" }, burst: { zh: "爆炸星", en: "Starburst" }, scribble: { zh: "马克笔涂鸦", en: "Marker scribble" } },
  params: [
    { key: "disc", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "大色圆", en: "Disc of colour" } },
    { key: "torn", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "撕纸碎片", en: "Torn paper" } },
    { key: "strips", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旧报纸条", en: "Newsprint strips" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "网点色块", en: "Halftone patches" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "爆炸星", en: "Starburst" } },
    { key: "scribble", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "马克笔涂鸦", en: "Marker scribble" } },
    { key: "lift", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "纸片立体感", en: "Paper lift" } },
    { key: "tape", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "胶带", en: "Tape" } },
    { key: "labels", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "票根与条码", en: "Ticket and barcode" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张质感", en: "Paper texture" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "slices", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "照片撕条", en: "Photo torn in strips" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  theme: (base) => ({ ...base, field: css(clGround()), text: css(clInk()), dim: css(clInk(), 0.6), titleFill: css(clInk()), titleInk: css(clGround()), grid: () => css(clInk(), 0.1) }),
  /**
   * The sheet and the pieces pasted on it (see clPieces). A photo goes black and white; one filling the
   * canvas is torn into horizontal strips, each set back a little off, with white fibre along the tears,
   * and the pieces go on over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h);
    if (L.ground !== false) { ctx.fillStyle = css(clGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (!L.fill) return true;
      if (p.slices > 0 && canPaint(ctx)) {
        const src = snap(ctx, "clSnap"), m = ctx.getTransform(), n = Math.round(3 + 6 * p.slices), edges = [0];
        for (let i = 1; i < n; i++) edges.push(h * ((i + (rand(i * 2.7 + 1000) - 0.5) * 0.6) / n));
        edges.push(h);
        ctx.fillStyle = css(clGround()); ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < n; i++) {
          const y0 = edges[i], y1 = edges[i + 1], dx = (rand(i * 3.9 + 1001) - 0.5) * u * 0.1 * p.slices, top = [], bot = [];
          for (let x = -20; x <= w + 20; x += 24) { top.push([x, y0 + (i ? (rand(i * 31 + x * 0.07) - 0.5) * 7 : -10)]); bot.push([x, y1 + (i < n - 1 ? (rand((i + 1) * 31 + x * 0.07) - 0.5) * 7 : 10)]); }
          ctx.save(); shapeOf(ctx, [...top, ...bot.reverse()]); ctx.clip();
          inPixels(ctx, () => ctx.drawImage(src, dx * m.a, 0));
          ctx.restore();
          if (i) { ctx.strokeStyle = css(CL.white, 0.9); ctx.lineWidth = 3 + 3 * p.slices; ctx.beginPath(); top.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
        }
      }
      clPieces(ctx, env, { ...p, torn: p.torn * 0.6, strips: p.strips * 0.5 }, true);
      return true;
    }
    if (!L.grid) return true;
    clPieces(ctx, env, p, false);
    return true;
  },
  /** A cutting mat under the sheet: a grid every 24, firmer every 96, and the angle guides from its corner. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fine = (n) => every(24, n, 24).filter((v) => v % 96);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.45; gridPath(ctx, fine(w), fine(h), 0, 0, w, h);
    ctx.globalAlpha = 1; gridPath(ctx, every(96, w, 96), every(96, h, 96), 0, 0, w, h);
    ctx.beginPath(); for (const a of [30, 45, 60]) { const t = (a * Math.PI) / 180; ctx.moveTo(0, h); ctx.lineTo(Math.cos(t) * w * 2, h - Math.sin(t) * w * 2); } ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  },
  accent: { fill: (C) => css(C), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(CL.white); ctx.lineWidth = 9; run(0, 0); } },   // a cut piece of paper with its white edge
  /**
   * Heavy condensed capitals pasted on paper labels (the shadow slider): each run on a strip of cream
   * paper, a little askew, lifting off the sheet; highlighted words on a strip of the channel colour.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || CL.red, hi = o.hi || C, label = Math.min(1, o.shadowAmt), ink = o.fill || (label > 0.3 ? CL.ink : clInk());
    if (label > 0) pass((a, x) => {
      if (a.first === false) return;   // one strip a run, under all its pieces
      const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width }, tw = r.x1 - r.x0, t = (rand(o.seed + r.x0 * 0.013) - 0.5) * 0.07, col = a.hi ? hi : CL.white;
      ctx.save(); ctx.globalAlpha = label; ctx.translate(r.x0 + tw / 2, -fs * 0.36); ctx.rotate(t);
      ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = fs * 0.06; ctx.shadowOffsetX = fs * 0.02; ctx.shadowOffsetY = fs * 0.04;
      ctx.fillStyle = css(col); ctx.fillRect(-tw / 2 - fs * 0.1, -fs * 0.58, tw + fs * 0.2, fs * 1.08); ctx.restore();
    });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? (label > 0.3 ? (lum(hi) > 0.55 ? CL.ink : CL.white) : hi) : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: CL.ink, light: CL.white }, stroke: { ink: CL.ink, light: CL.white }, line: 0.8 })),
  sticker: painters({ line: CL.white, lineScale: 1.2, shadow(ctx, draw) { ctx.save(); ctx.translate(4, 7); draw("rgba(0,0,0,0.28)"); ctx.restore(); } }),   // cut out with a white margin, lifting off the sheet
  /** The corner tag: a black ticket with notches cut in its ends. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.68;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.6, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.translate(x + w / 2, top + h / 2); ctx.rotate(-0.03);
    ctx.fillStyle = css(CL.ink); ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = css(clGround()); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc((s * w) / 2, 0, h * 0.16, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ink || css(CL.white); spaced(ctx, str, -w / 2 + f * 0.8, f * 0.36, 3); ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: tape holding the sheet down, a ticket stub and a barcode pasted on. */
  frame(ctx, env, p) {
    const { w, h, C } = env, u = Math.min(w, h), { F } = clCentre(env);
    for (let k = 0, n = p.tape * 4; k < Math.ceil(n); k++) {   // tape: translucent, its ends torn
      const spots = [[besideLogo(env, F.x1 - u * 0.04) - u * 0.1, F.y0 + u * 0.08, 0.6], [F.x0 + u * 0.1, F.y1 - u * 0.12, -0.5], [F.x1 - u * 0.08, F.y1 - u * 0.2, -0.75], [w * 0.5, F.y0 + u * 0.04, 0.08]];
      const [tx, ty, a] = spots[k], tw = u * 0.2, th = u * 0.055;
      ctx.save(); ctx.globalAlpha = clamp(n - k); ctx.translate(tx, ty); ctx.rotate(a);
      const pts = []; for (let i = 0; i <= 6; i++) pts.push([-tw / 2 + (rand(k * 13 + i) - 0.5) * 6, -th / 2 + (th * i) / 6]);
      for (let i = 6; i >= 0; i--) pts.push([tw / 2 + (rand(k * 17 + i) - 0.5) * 6, -th / 2 + (th * i) / 6]);
      shapeOf(ctx, pts); ctx.fillStyle = "rgba(240,232,206,0.62)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
    if (p.labels <= 0) return;
    const a = Math.min(1, p.labels * 2), P = env.o.profile, i = env.o.catIndex;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(F.x1 - u * 0.2, F.y1 - u * 0.1); ctx.rotate(-0.06);   // the barcode on a white label
    ctx.fillStyle = css(CL.white); ctx.fillRect(-10, -10, u * 0.16 + 20, u * 0.06 + 22);
    barcode(ctx, 0, 0, u * 0.16, u * 0.06, CL.ink, 1010 + i); ctx.restore();
    if (p.labels > 0.4) {   // and the ticket stub
      ctx.save(); ctx.globalAlpha = Math.min(1, (p.labels - 0.4) * 3); ctx.translate(F.x1 - u * 0.5, F.y0 + u * 0.11); ctx.rotate(0.05);   // clear of the brand line
      ctx.fillStyle = css(mix(C, CL.white, 0.15)); ctx.fillRect(0, 0, u * 0.17, u * 0.07);
      ctx.fillStyle = css(lum(C) > 0.55 ? CL.ink : CL.white); ctx.font = `700 ${u * 0.022}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(`ADMIT ONE · No.${pad2(i + 1)}`, u * 0.012, u * 0.03); ctx.font = `600 ${u * 0.012}px ${fonts.mono}`; ctx.fillText((P.brand.name || "").toUpperCase().slice(0, 24), u * 0.012, u * 0.055);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(u * 0.135, 4); ctx.lineTo(u * 0.135, u * 0.07 - 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 10 * unit; ctx.shadowOffsetX = 4 * unit; ctx.shadowOffsetY = 7 * unit; },
  /** The sheet itself: crumpled a little, its grain, and wear. */
  post(ctx, w, h, C, p, unit = 1) {
    crumple(ctx, w, h, p.paper * 0.8);
    grain(ctx, 0.2 + p.paper * 0.5, unit, !dark);
  },
  prompt: `Cut-outs for a mixed-media paper collage — bold, playful and a little rough — that read at a glance:
- one clear, characterful object per sticker (a hand, an eye, lips, a flower, a star, a camera, a cassette, a coffee cup), simple and graphic; no realism, no perspective, no fine detail;
- flat colour only: the main colour with "ink", "white", "red" or "yellow" as partners; patterns in stripes or dots are welcome;
- the app cuts every sticker out with a white margin and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as cut-outs for a paper collage: a few boxes and cylinders, bold and simple — a radio, a camera, a suitcase, a lamp; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" the channel colour — use it for one to three parts.`,
};

// ====================================================================== yellow: the festival poster in one bright yellow
// Theatre and film-festival posters set on a single saturated yellow: huge letters with the picture
// showing inside them, a black silhouette cut against the yellow (where it crosses the letters it turns
// yellow), a beam of light, crossing stripes, a flock of small shapes flying off; tight black type and
// small print. One colour, black and white.
const YL = { yellow: [255, 206, 0], ink: [16, 16, 16], text: [30, 28, 26], white: [255, 255, 255], magenta: [230, 0, 126] };   // text: a near-black that is not the house ink, so the small parts' ink can be swapped on its own
const ylGround = (C) => (values.chan ? boost(C, 0.55) : YL.yellow);
/** The one accent: the channel colour, or magenta where that would vanish into the ground. */
const ylAccent = (C) => { const g = ylGround(C); return !near(C, g, 120) ? C : near(YL.magenta, g, 120) ? YL.yellow : YL.magenta; };
/**
 * The room the letters and the silhouette stand in: right of the title, down to the floor, when there
 * is a fair width of it; else under the title; the field's far half when the title is hidden.
 */
function ylRoom(ctx, env) {
  const F = openField(env), fw = F.x1 - F.x0, T = titleArea(ctx, env), right = T ? T.x + T.w + 30 : F.x0 + fw * 0.45;
  if (F.x1 - fw * 0.03 - right >= fw * 0.22) return { x0: right, x1: F.x1 - fw * 0.03, y0: F.y0 + 24, y1: F.y1 };
  return { x0: F.x0 + fw * 0.3, x1: F.x1 - fw * 0.03, y0: Math.min(T.y + T.h + 20, F.y1 - (F.y1 - F.y0) * 0.25), y1: F.y1 };
}
/** The giant letters' arrangement: the typed word or the channel's code, in a block of rows filling the region `R`. */
function ylWord(ctx, env, p, R) {
  const word = [...((p.word || env.cat.code || env.cat.name || "A").toUpperCase())].filter((c) => c.trim()).slice(0, 8), n = word.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), rw = R.x1 - R.x0, rh = R.y1 - R.y0;
  const face = (s) => (p.serif ? `700 ${s}px ${fonts.serif}` : `900 ${s}px ${fonts.en}, ${fonts.cn}`);
  ctx.save(); ctx.font = face(100); const cw = Math.max(...word.map((c) => ctx.measureText(c).width)) / 100; ctx.restore();
  const fs = Math.min((rh * (0.55 + 0.45 * p.giant)) / (rows * 0.86), (rw * 0.98) / (cols * cw * 1.02));
  const bw = cols * cw * fs * 1.02, bh = rows * fs * 0.86;
  return { word, cols, cw, fs, bw, bh, x0: R.x0 + (rw - bw) / 2, y0: R.y0 + (rh - bh) * 0.5, font: face(fs) };
}
/** Paints the giant letters (see ylWord) in `colour`. */
function ylLetters(x, W, colour) {
  x.font = W.font; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = css(colour);
  W.word.forEach((ch, i) => x.fillText(ch, W.x0 + ((i % W.cols) + 0.5) * W.cw * W.fs * 1.02, W.y0 + (Math.floor(i / W.cols) + 1) * W.fs * 0.86 - W.fs * 0.06));
}
const yellow = {
  id: "yellow",
  art: "figure",
  repaint: (c) => `a festival poster made from the photograph: the subject in hard black and white set on one flat, saturated yellow, clean and graphic, a little paper grain; still the same picture, no text.`,
  about: { zh: "明黄海报：戏剧节和电影节常用的一整版明黄——巨大的白色字母里透出画面（有照片时是照片），一个黑色剪影立在标题旁的空处，穿过字母的部分反成黄色；可加一道光束、交叉的条纹、从剪影里飞散出去的小形状；紧凑的黑色标题和小字信息。只有黄、黑、白和一个点缀色。醒目、自信、一眼认出——适合活动、展演、电影、讲座、课程和品牌宣传。可以用频道色代替黄色。", en: "Yellow: the one bright yellow of theatre and film-festival posters — huge letters with the picture showing inside them (the photo, or the silhouette), a black silhouette standing on the yellow and turning yellow where it crosses the letters; a beam of light, crossing stripes and small shapes flying off if you like; tight black type and small print. Yellow, black, white and one accent. Loud, confident, recognisable at once — for events, shows, films, talks, courses and brand campaigns. The channel colour can take the yellow's place." },
  name: { zh: "明黄海报", en: "Yellow poster" },
  oneTheme: true,
  seeded: true,
  scene: { letters: { zh: "巨型字母", en: "Giant letters" }, beam: { zh: "光束", en: "Beam" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "巨型字母", en: "Giant letters" } },
    { key: "word", text: true, max: 8, def: "", name: { zh: "字母内容", en: "Their letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "黑色剪影", en: "Black silhouette" } },
    { key: "flock", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "飞散小形", en: "Flock" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光束", en: "Beam of light" } },
    { key: "stripes", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "交叉条纹", en: "Crossing stripes" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "小字信息", en: "Small print" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "serif", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "衬线字母", en: "Serif letters" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "用频道色代替黄色", en: "The channel colour in place of the yellow" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "inside", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片装进字母", en: "Photo inside the letters" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base, C) => ({ ...base, field: css(ylGround(C)), text: css(YL.text), dim: css(YL.text, 0.6), titleFill: css(YL.text), titleInk: css(ylGround(C)), grid: () => css(YL.ink, 0.16) }),
  /**
   * The yellow, then (behind) crossing stripes and a beam, the black silhouette, the giant letters in
   * white — the silhouette turning yellow inside them — and the flock. A photo goes black and white;
   * one filling the canvas can show only inside the letters: the yellow is laid over it with the
   * letters cut out.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = ylGround(C), u = Math.min(w, h), F0 = openField(env), R = canPaint(ctx) ? ylRoom(ctx, env) : null;
    // the letters are white, so they may stand behind the black title: they take the field's far side; the black silhouette keeps to the room
    const W = p.giant > 0 && R ? ylWord(ctx, env, p, { x0: F0.x0 + (F0.x1 - F0.x0) * 0.42, x1: F0.x1 - (F0.x1 - F0.x0) * 0.04, y0: F0.y0 + 24, y1: F0.y1 }) : null;
    if (W) { const mx = W.x0 + W.bw / 2, my = W.y0 + W.bh / 2, [X, Y] = objAt("letters", mx, my, ctx); W.x0 += X - mx; W.y0 += Y - my; }   // a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (L.fill && W && p.inside > 0) { const x = workLike(ctx, "yl"); x.fillStyle = css(ground); x.fillRect(0, 0, w, h); x.globalCompositeOperation = "destination-out"; ylLetters(x, W, [0, 0, 0]); layDown(ctx, x, p.inside); }
      return true;
    }
    if (!L.grid) return true;
    const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, S = p.figure > 0 && R && graphicShape(env), b = S && S.box, aspect = b ? (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0) : 1;
    // the silhouette stands on the floor in the room, as tall as the slider says and the room allows
    const size = R ? Math.min((R.y1 - R.y0) * (0.5 + 0.5 * p.figure), ((R.x1 - R.x0) * 0.85) / aspect) : fh * 0.5, fx = R ? R.x0 + (R.x1 - R.x0) * 0.42 : F.x0 + fw * 0.62, fy = F.y1 - size * 0.5;
    if (p.stripes > 0) {   // crossing stripes, pair by pair, one in the accent
      const n = p.stripes * 6, sx = W ? W.x0 + W.bw / 2 : F.x0 + fw * 0.6, sw = u * 0.022;
      for (let k = 0; k < Math.ceil(n); k++) {
        const off = (k - 2.5) * u * 0.07, col = k === 2 ? ylAccent(C) : YL.white;
        ctx.strokeStyle = css(col, clamp(n - k)); ctx.lineWidth = sw;
        ctx.beginPath(); ctx.moveTo(sx + off - fh * 0.35, F.y0 - 20); ctx.lineTo(sx - off + fh * 0.35, F.y1 + 20); ctx.stroke();
      }
    }
    if (p.beam > 0) {   // a beam from the figure's head out to the left, spreading over the floor; where it starts is a scene object
      const [ox, oy] = objAt("beam", fx, fy - size * 0.3, ctx), g = ctx.createLinearGradient(ox, 0, F.x0, 0); g.addColorStop(0, css(YL.white, 0.85 * p.beam)); g.addColorStop(1, css(YL.white, 0.25 * p.beam));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(F.x0 - 20, F.y1 - fh * (0.15 + 0.45 * p.beam)); ctx.lineTo(F.x0 - 20, F.y1); ctx.lineTo(ox, F.y1); ctx.closePath(); ctx.fill();
    }
    if (S) placeShape(ctx, S, YL.ink, fx, fy, size);
    if (W) {
      const x = workLike(ctx, "yl");
      ylLetters(x, W, YL.white);
      if (S) { x.globalCompositeOperation = "source-atop"; placeShape(x, S, ground, fx, fy, size); }   // the figure, reversed inside the letters
      layDown(ctx, x, Math.min(1, p.giant * 5));
    }
    if (S && p.flock > 0) {   // small copies flying off the figure, up and away, one by one
      for (let k = 0, n = p.flock * 16; k < Math.ceil(n); k++) {
        const t = (k + 1) / 17, ang = -1.2 + rand(k * 2.1 + 1100) * 0.9, d = size * (0.35 + t * 0.9), s = u * (0.025 + rand(k * 3.3 + 1101) * 0.025);
        ctx.save(); ctx.globalAlpha = clamp(n - k); placeShape(ctx, S, YL.ink, fx + Math.cos(ang) * d, fy - size * 0.3 + Math.sin(ang) * d, s, (rand(k * 4.7 + 1102) - 0.5) * 1.2); ctx.restore();
      }
    }
    return true;
  },
  /** Registration crosses on the yellow, every 120, a dot between them. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 120;
    gridPen(ctx, color, 3); ctx.beginPath();
    for (let x = s / 2; x < w; x += s) for (let y = s / 2; y < h; y += s) { ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); }
    ctx.stroke(); ctx.beginPath();
    for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) { ctx.moveTo(x + 3.5, y); ctx.arc(x, y, 3.5, 0, TAU); }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css(YL.white), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a white band: the small parts' ink reads on it as on the yellow
  /** Tight black capitals, flat and upright; highlighted words in the accent colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || ylAccent(o.C || YL.magenta) : o.fill || YL.text); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: YL.ink, light: YL.white, mid: mix(YL.white, YL.ink, 0.25), dark: YL.ink, colour: () => ylAccent(C) }, stroke: { ink: YL.ink, light: YL.white }, line: 0.6 })),
  sticker: painters({ line: null, shadow: null, tone: inkAs(YL.ink) }),
  /** The corner tag: a black slab, the lettering in the ground's yellow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs * 0.86}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 0.7, h = fs * 1.16, top = y + fs * 0.1;
    ctx.fillStyle = css(YL.ink); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(ylGround(C)); spaced(ctx, str, x + fs * 0.35, top + h * 0.5 + fs * 0.31, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a block of small print in the top corner, and a row of sponsors' marks along the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, i = env.o.catIndex, F = openField(env);
    ctx.save(); ctx.fillStyle = css(YL.ink, 0.85 * a); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    const bx = besideLogo(env, w - 80) - 260;   // the block of small print
    ctx.font = `700 15px ${fonts.en}, ${fonts.cn}`; ctx.fillText(`${(P.brand.name || "").toUpperCase()}  ·  No.${pad2(i + 1)}`, bx, 70);
    greeked(ctx, bx, 86, 260, 4, 11, css(YL.ink, 0.6 * a), 1110 + i);
    if (a > 0.4) for (let k = 0; k < 6; k++) { ctx.fillStyle = css(YL.ink, 0.5 * Math.min(1, (a - 0.4) * 3)); ctx.beginPath(); rounded(ctx, w - 72 - (k + 1) * 64, F.y1 - 44, 48, 22, 5); ctx.fill(); }
    ctx.restore();
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit, true); },
  prompt: `Silhouettes for a one-colour festival poster on bright yellow — bold, witty, instantly read:
- one strong black silhouette per sticker (a hat, a moustache, a hand, a saxophone, a bird, a figure walking, a film camera), with at most one clever detail; no realism, no perspective, no detail;
- flat colour only: "ink" for the silhouette, "white" for small light parts, and the main colour as a single small accent;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a yellow festival poster would show them: a few boxes and cylinders, bold and plain — a film camera, a lamp, a chair, a megaphone; no realism, no fine detail.
- the renderer paints faces in black, white and grey: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" black, and "main" the accent colour — one part only.`,
};

// ====================================================================== pitch: the football poster
// World Cup and club posters, from Munich '72 to today: a mown pitch in stripes, its white lines seen
// from above at an angle, the net bulging, the bowl of a stadium full of people, floodlights, the
// classic black-and-white ball with halftone shading, a crowd in silhouette; posterized colour on
// photographs. Green with white lines, or canary yellow with green ones.
const PT = { green: [0, 124, 62], deep: [20, 100, 52], yellow: [252, 214, 0], white: [244, 246, 236], ink: [10, 34, 20], lime: [150, 206, 64] };
const ptGround = () => (dark ? PT.deep : PT.yellow), ptLine = () => (dark ? PT.white : PT.green);
const ptHi = (C) => (near(C, ptGround(), 120) || (!dark && near(C, PT.green, 90)) ? (dark ? PT.yellow : [0, 52, 150]) : C);   // where the channel colour would not show: yellow on the grass, a deep blue on the yellow
/** The markings of a pitch (105 × 68), seen from above, huge, turned and cropped: lines come in, then (past half the slider) the extras — dashes and arcs. */
function pitchLines(ctx, env, amt) {
  const F = openField(env), u = Math.min(env.w, env.h), s = u * 0.026, a = Math.min(1, amt * 2), more = clamp(amt * 2 - 1);
  ctx.save(); ctx.translate(F.x0 + (F.x1 - F.x0) * 0.6, (F.y0 + F.y1) * 0.55); ctx.rotate(-0.42 + rand(1200) * 0.2); ctx.scale(s, s * 0.7);
  ctx.strokeStyle = css(ptLine(), 0.9 * a); ctx.fillStyle = css(ptLine(), 0.9 * a); ctx.lineWidth = 0.42;
  ctx.strokeRect(-52.5, -34, 105, 68);
  ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(0, 34); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 9.15, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, TAU); ctx.fill();
  for (const s2 of [-1, 1]) {
    ctx.strokeRect(s2 > 0 ? 36 : -52.5, -20.15, 16.5, 40.3); ctx.strokeRect(s2 > 0 ? 47 : -52.5, -9.15, 5.5, 18.3);
    ctx.beginPath(); ctx.arc(s2 * 41.5, 0, 0.45, 0, TAU); ctx.fill();
    if (more > 0) { ctx.save(); ctx.globalAlpha = more; ctx.beginPath(); ctx.arc(s2 * 41.5, 0, 9.15, s2 > 0 ? Math.PI - 0.93 : -0.93, s2 > 0 ? Math.PI + 0.93 : 0.93); ctx.stroke(); ctx.restore(); }
  }
  if (more > 0) { ctx.save(); ctx.globalAlpha = more; ctx.setLineDash([2.4, 1.8]); ctx.beginPath(); ctx.moveTo(-60, 40); ctx.lineTo(60, -40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-60, -45); ctx.lineTo(-10, 45); ctx.stroke(); ctx.restore(); }
  ctx.restore();
}
/** The net, bulging away from where the ball struck it: a mesh of lines over the field, pushed out round that point. */
function goalNet(ctx, env, amt, bx, by) {
  const F = openField(env), u = Math.min(env.w, env.h), cell = u * 0.075, R2 = (u * 0.4) ** 2, push = u * 0.12 * amt;
  const at = (x, y) => { const dx = x - bx, dy = y - by, f = push * Math.exp(-(dx * dx + dy * dy) / R2), d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * f, y + (dy / d) * f * 0.6 + f * 0.3]; };
  ctx.save(); ctx.strokeStyle = css(ptLine(), 0.55 * Math.min(1, amt * 2)); ctx.lineWidth = Math.max(1.5, u * 0.0025);
  for (let x = F.x0; x <= F.x1 + cell; x += cell) { ctx.beginPath(); for (let y = F.y0 - cell; y <= F.y1 + cell; y += cell / 4) { const [px, py] = at(x, y); y === F.y0 - cell ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
  for (let y = F.y0; y <= F.y1 + cell; y += cell) { ctx.beginPath(); for (let x = F.x0 - cell; x <= F.x1 + cell; x += cell / 4) { const [px, py] = at(x, y); x === F.x0 - cell ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
  ctx.restore();
}
/** The bowl of a stadium seen from above at a slant: stands ribbed with stairways and stippled with people, round a dark oval of pitch; it widens with `amt`. */
function stadiumBowl(ctx, env, amt) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cx = F.x0 + fw * 0.6, cy = F.y0 + fh * 0.78, R = fw * (0.2 + 0.26 * amt), r = R * 0.62, k = 0.36, a = Math.min(1, amt * 3);
  // in tones a step off the ground, so the lettering over it still reads
  const stand = dark ? mix(PT.deep, PT.lime, 0.28) : mix(PT.yellow, PT.white, 0.45), pitch = dark ? mix(PT.deep, [0, 0, 0], 0.3) : mix(PT.yellow, PT.green, 0.22);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(stand); ctx.beginPath(); ctx.ellipse(cx, cy, R, R * k, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = css(mix(stand, PT.ink, 0.35)); ctx.lineWidth = 2;
  for (let i = 0; i < 72; i++) { const t = (i / 72) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r * k); ctx.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * k); ctx.stroke(); }
  ctx.fillStyle = css(mix(stand, PT.ink, 0.55), 0.8);   // the people: specks in the stands, thicker toward the front
  for (let i = 0; i < 900; i++) { const t = rand(i * 1.3 + 1210) * TAU, q = Math.sqrt(rand(i * 2.1 + 1211)), rr = r + (R - r) * q; ctx.fillRect(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * k, 2.2, 2.2); }
  ctx.fillStyle = css(pitch); ctx.beginPath(); ctx.ellipse(cx, cy, r, r * k, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, r, r * k, 0, 0, TAU); ctx.clip();   // the shadow of the stand falling across the pitch
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * k * 0.2, r * 0.95, r * k * 0.95, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.restore();
}
/** The classic ball: a black pentagon at its heart and five round it, seams, shading to one side in halftone, a shadow on the grass. */
function football(ctx, x, y, r, rot, half) {
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 1.02, r * 0.9, r * 0.16, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(PT.white); ctx.fill(); ctx.clip();
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = css(PT.ink); ctx.strokeStyle = css(PT.ink); ctx.lineWidth = r * 0.03;
  const pent = (R, a) => { ctx.beginPath(); for (let i = 0; i < 5; i++) { const t = a + (i * TAU) / 5; ctx.lineTo(Math.cos(t) * R, Math.sin(t) * R); } ctx.closePath(); ctx.fill(); };
  pent(r * 0.3, -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const t = -Math.PI / 2 + (i * TAU) / 5, t2 = t + TAU / 10;
    ctx.beginPath(); ctx.moveTo(Math.cos(t) * r * 0.3, Math.sin(t) * r * 0.3); ctx.lineTo(Math.cos(t) * r * 0.62, Math.sin(t) * r * 0.62); ctx.stroke();
    ctx.save(); ctx.translate(Math.cos(t2) * r * 0.86, Math.sin(t2) * r * 0.86); ctx.rotate(t2); ctx.scale(0.5, 1); pent(r * 0.32, Math.PI); ctx.restore();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.2, x, y, r * 1.05);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${0.18 + 0.2 * half})`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (half > 0) { ctx.beginPath(); ctx.arc(x + r * 0.55, y + r * 0.55, r * 1.05, 0, TAU); ctx.clip(); dotScreen(ctx, x + r * 2, y + r * 2, PT.ink, 7, 0.55 * half); }
  ctx.restore();
  ctx.strokeStyle = css(PT.ink, 0.8); ctx.lineWidth = Math.max(1.5, r * 0.02); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}
const pitch = {
  id: "pitch",
  repaint: (c) => `a retro football poster made from the photograph, in the manner of the 1972 Munich Olympics posters: the picture posterized into a few flat tones of green, yellow, violet and blue, a little screen-print texture; still the same picture, no text.`,
  about: { zh: "绿茵球场：从 1972 年慕尼黑奥运会到今天的世界杯和俱乐部海报——修剪成条纹的草坪，俯视转了个角度的白色球场线，被射门撞得鼓起的球网，坐满人的看台，球场灯光，黑白经典足球带网点阴影，前景的人群剪影；照片可以做成七十年代的分色效果。绿底白线，或浅色时的金丝雀黄底配绿线。热血、有节奏、一眼是足球——适合体育、赛事、球评、健身、团队和校园活动。", en: "Pitch: football posters from Munich '72 to today's World Cup and club posters — a pitch mown in stripes, its white lines seen from above at an angle, the net bulging where a shot struck it, the bowl of a full stadium, floodlights, the classic black-and-white ball shaded in halftone, a crowd in silhouette in front; photos can be posterized the seventies way. Green with white lines, or canary yellow with green ones. Rousing, rhythmic, plainly football — for sport, matches, commentary, fitness, teams and school events." },
  name: { zh: "绿茵球场", en: "Pitch" },
  seeded: true,
  scene: { ball: { zh: "足球", en: "Ball" } },
  params: [
    { key: "mow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "草坪条纹", en: "Mown stripes" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "球场线", en: "Pitch lines" } },
    { key: "net", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "球网", en: "Goal net" } },
    { key: "stadium", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "看台", en: "Stadium bowl" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "球场灯光", en: "Floodlights" } },
    { key: "ball", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "足球", en: "Ball" } },
    { key: "crowd", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "人群剪影", en: "Crowd" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "网点", en: "Halftone" } },
    { key: "info", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "赛事信息", en: "Match details" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "皱纸", en: "Crumpled paper" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "颗粒", en: "Grain" } },
    { key: "poster", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片分色", en: "Photo posterized" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(ptGround()), text: css(ptLine()), dim: css(ptLine(), 0.6), titleFill: css(ptLine()), titleInk: css(ptGround()), grid: () => css(ptLine(), 0.2) }),
  /**
   * The grass in mown stripes, the stadium, the pitch's lines, the net, the floodlights, the ball and
   * the crowd, in that order. A photo is posterized into the seventies' few flat tones; one filling the
   * canvas still gets the stripes, the lines and the lights over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    if (L.ground !== false) { ctx.fillStyle = css(ptGround()); ctx.fillRect(0, 0, w, h); }
    const mow = () => {
      if (p.mow <= 0) return;
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.5); ctx.fillStyle = css(dark ? [0, 0, 0] : [190, 120, 0], 0.16 * p.mow);
      for (let x = -2 * w; x < 2 * w; x += u * 0.18) ctx.fillRect(x, -2 * h, u * 0.09, 4 * h);
      ctx.restore();
    };
    const lights = () => {
      if (p.lights <= 0) return;
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (const s of [0, 1]) {
        const lx = s ? F.x1 - fw * 0.06 : F.x0 + fw * 0.06, ly = F.y0 - fh * 0.06, tx = F.x0 + fw * (s ? 0.35 : 0.75), g = ctx.createLinearGradient(lx, ly, tx, F.y1);
        g.addColorStop(0, css([255, 255, 240], 0.55 * p.lights)); g.addColorStop(1, css([255, 255, 240], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(tx - fw * 0.18, F.y1); ctx.lineTo(tx + fw * 0.18, F.y1); ctx.closePath(); ctx.fill();   // from lamps just above the top edge
      }
      ctx.restore();
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, [12, 44, 30]], [0.3, [70, 64, 150]], [0.55, [30, 140, 70]], [0.8, [236, 212, 40]], [1, [246, 244, 222]]], 0.85), p.poster);
      if (L.fill) { mow(); pitchLines(ctx, env, p.lines); lights(); }
      return true;
    }
    if (!L.grid) return true;
    mow();
    if (p.stadium > 0) stadiumBowl(ctx, env, p.stadium);
    if (p.lines > 0) pitchLines(ctx, env, p.lines);
    // the ball (and where it struck the net): just past the title's end, if there is room there
    const T = canPaint(ctx) ? titleArea(ctx, env) : null, br = u * (0.05 + 0.13 * p.ball), bx0 = clamp(T ? T.x + T.w + br * 1.15 : F.x0 + fw * 0.66, F.x0 + br, F.x1 - br * 1.2), by0 = F.y0 + fh * 0.36;
    const [bx, by] = p.ball > 0 || p.net > 0 ? objAt("ball", bx0, by0, ctx) : [bx0, by0];   // a scene object, and the net where it struck with it
    if (p.net > 0) goalNet(ctx, env, p.net, bx, by);
    lights();
    if (p.halftone > 0) wherePainted(ctx, (c) => dotScreen(c, w, h, dark ? [0, 0, 0] : [150, 110, 0], 10, 0.22 * p.halftone), L.base === "clear");
    if (p.ball > 0) football(ctx, bx, by, br, rand(1201) * TAU, p.halftone);
    for (let k = 0, n = p.crowd * 22; k < Math.ceil(n); k++) {   // the crowd: heads and shoulders along the floor, some arms up
      const a = clamp(n - k), x = F.x0 + fw * (0.3 + (0.7 * (k + 0.5)) / 22) + (rand(k * 2.3 + 1220) - 0.5) * fw * 0.02, s = u * (0.05 + rand(k * 3.7 + 1221) * 0.035), y = F.y1 - s * (0.6 + rand(k * 1.9 + 1222) * 0.5);   // clear of the tag in the corner
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = css(dark ? [6, 30, 16] : PT.ink);
      ctx.beginPath(); ctx.arc(x, y - s * 0.55, s * 0.32, 0, TAU); ctx.fill();
      ctx.beginPath(); rounded(ctx, x - s * 0.6, y - s * 0.22, s * 1.2, s * 1.4, s * 0.4); ctx.fill();
      if (rand(k * 5.1 + 1223) > 0.55) { ctx.lineWidth = s * 0.22; ctx.lineCap = "round"; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(x + s * 0.4, y - s * 0.1); ctx.lineTo(x + s * 0.75, y - s * 1.1); ctx.stroke(); }
      ctx.restore();
    }
    return true;
  },
  /** A coach's tactics board: the pitch cut into zones down and channels across in dashed lines, the halfway line and the centre circle. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color);
    ctx.setLineDash([18, 12]); gridPath(ctx, [w / 6, w / 3, (w * 2) / 3, (w * 5) / 6], [h / 5, (h * 2) / 5, (h * 3) / 5, (h * 4) / 5], 0, 0, w, h);
    ctx.setLineDash([]); ctx.lineWidth = 3; gridPath(ctx, [w / 2], [], 0, 0, 0, h);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.17, 0, TAU); ctx.moveTo(w / 2 + 6, h / 2); ctx.arc(w / 2, h / 2, 6, 0, TAU); ctx.stroke();
    ctx.restore();
  },
  accent: { fill: () => css(dark ? mix(PT.deep, PT.ink, 0.45) : PT.green), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(PT.white); ctx.lineWidth = 6; run(0, 0); } },   // the touchline
  /** Bold condensed capitals, flat; highlighted words in the channel colour (or yellow, or green, where that would not show). */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || ptHi(o.C || PT.yellow) : o.fill || ptLine()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: PT.ink, light: PT.white }, stroke: { ink: PT.ink, light: PT.white }, line: 0.7 })),
  sticker: painters({ line: PT.ink, lineScale: 0.6, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw("rgba(0,0,0,0.25)"); ctx.restore(); } }),
  /** The corner tag: a scoreboard — a black slab with the lettering in lit yellow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.7;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.2, h = f * 1.6, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, f * 0.25); ctx.fillStyle = css(PT.ink); ctx.fill();
    ctx.fillStyle = ink || css(PT.yellow); spaced(ctx, str, x + f * 0.6, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the match's details in the top corner, and a key along the foot, as on a match-day poster. */
  frame(ctx, env, p) {
    const a = p.info;
    if (a <= 0) return;
    const { w } = env, P = env.o.profile, i = env.o.catIndex, total = P.categories.length, F = openField(env), col = ptLine();
    ctx.save(); ctx.fillStyle = css(col, 0.9 * a); ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    ctx.font = `700 20px ${fonts.en}, ${fonts.cn}`; ctx.fillText(`MATCHDAY ${pad2(i + 1)}`, besideLogo(env, w - 72), 70);
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.fillText(`${(P.brand.name || "").toUpperCase()} · ${pad2(i + 1)}/${pad2(total)} · 90'`, besideLogo(env, w - 72), 92);
    if (a > 0.4) {
      ctx.globalAlpha = Math.min(1, (a - 0.4) * 3); ctx.textAlign = "left"; ctx.font = `600 12px ${fonts.mono}, ${fonts.cn}`; const y = F.y1 - 26;
      ctx.fillRect(72, y - 18, 180, 1.5); ctx.fillText("KEY", 72, y - 24);
      ctx.beginPath(); ctx.arc(78, y, 4, 0, TAU); ctx.fill(); ctx.fillText("PLAYERS", 90, y + 4);
      ctx.fillRect(170, y - 1, 16, 2); ctx.fillText("PASS", 192, y + 4);
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 12 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6 * unit; },
  post(ctx, w, h, C, p, unit = 1) { crumple(ctx, w, h, p.paper * 0.9); grain(ctx, p.grain * 0.7, unit, !dark); },
  prompt: `Stickers for a retro football poster — bold, sporty and simple — that read at a glance:
- one clear object per sticker (a ball, a boot, a whistle, a trophy, a goal, a scarf, a player in silhouette, a flag), graphic and a little stylised; no realism, no perspective, no fine detail;
- flat colour only: the main colour with "white", "ink" (deep green-black) and "yellow" as partners;
- the app adds a dark outline and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects from football, built as simple models from a few boxes and cylinders — a goal, a trophy, a stand, a scoreboard, a corner flag; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" deep green-black, and "main" the channel colour — use it for one to three parts.`,
};

// ====================================================================== dot matrix: pictures made of points of light
// Everything made of dots of light on black, as an LED wall or a point cloud: the figure (or the photo)
// read into a grid of dots sized by their brightness, a rolling surface of dots in depth, rainbow colour
// breaking through at the lower edges, dots smeared sideways in motion, a red-and-cyan fringe, a glow,
// columns of digits, scattered stars.
const DM = { black: [4, 4, 6], white: [245, 245, 238] };
/** A rainbow colour at hue `t` (0–1). */
const rainbow = (t) => hueTurn([255, 30, 30], (((t % 1) + 1) % 1) * 360);
/** The size of a grid cell, in units: the Dot spacing slider. */
const dmCell = (p) => 9 + 22 * p.pitch;
/**
 * Draws one grid of dots: `level(i, j)` (0–1) sizes each cell's dot; its colour is `colour(i, j)` or
 * white, with rainbow breaking in toward the bottom of the picture (Rainbow), and the dot smeared
 * sideways (Smear). Batched by colour, so thousands of dots stay quick.
 */
function dotGrid(ctx, env, p, x0, y0, cols, rows, cell, level, colour) {
  const { h } = env, rx = 1 + p.smear * 4, batch = new Map();
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = level(i, j);
    if (v < 0.06) continue;
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell, r = cell * 0.36 * Math.sqrt(v);   // even at full, the dots stand apart
    let c = colour ? colour(i, j) : DM.white;
    const rb = p.rainbow > 0 ? clamp(p.rainbow * 1.8 - (1 - y / h) * 1.4 + (noise(i * 0.31 + j * 0.17) - 0.5) * 0.6) : 0;
    if (rb > 0) c = mix(c, rainbow(x / env.w * 1.4 + noise(j * 0.11) * 0.5), rb);
    const key = c.map((q) => Math.round(q / 24) * 24).join();
    (batch.get(key) || batch.set(key, []).get(key)).push(x, y, r);
  }
  for (const [key, list] of batch) {
    ctx.fillStyle = `rgb(${key})`; ctx.beginPath();
    for (let q = 0; q < list.length; q += 3) { const [x, y, r] = [list[q], list[q + 1], list[q + 2]]; ctx.moveTo(x + r * rx, y); ctx.ellipse(x, y, r * rx, r, 0, 0, TAU); }
    ctx.fill();
  }
}
/** Red and cyan copies of the picture, a little apart, lightened in: the fringe of a misaligned screen. */
function rgbFringe(ctx, d) {
  if (d <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "fringe"), k = ctx.getTransform().a;
  for (const [s, col] of [[-1, [255, 40, 60]], [1, [40, 220, 255]]]) {
    const x = workLike(ctx, "fringe" + s); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0);
    x.globalCompositeOperation = "multiply"; x.fillStyle = css(col); x.fillRect(0, 0, x.canvas.width, x.canvas.height);
    inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.drawImage(x.canvas, s * d * k, 0); });
  }
}
const dots = {
  id: "dots",
  art: "figure",
  repaint: (c) => `the photograph rebuilt as a point cloud of light on black: the subject made of thousands of glowing white dots sized by brightness, streaks of rainbow colour and a little horizontal motion smear, deep black everywhere else, with ${c} as an accent; no text.`,
  about: { zh: "点阵光影：一切都由黑底上的光点组成，像 LED 屏或三维点云——频道图形（有照片时是照片）被读成一格一格的光点，越亮的地方点越大；身后一片起伏的点阵曲面伸向远处，下沿透出彩虹色，光点可以横向拖成光痕，加上红青色彩错位、辉光、一列列数字和零星的星点。冷、未来感、带一点迷幻——适合科技、音乐、电子、夜景、AI 和数据类内容。", en: "Dot matrix: everything made of points of light on black, as an LED wall or a point cloud — the channel graphic (or the photo) read into a grid of dots, larger where it is brighter; a rolling surface of dots running into the distance behind, rainbow colour breaking through at the lower edges, dots smeared into streaks of motion, a red-and-cyan fringe, a glow, columns of digits and scattered stars. Cool, futuristic, a little psychedelic — for tech, music, electronic, night scenes, AI and data." },
  name: { zh: "点阵光影", en: "Dot matrix" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "点阵身影", en: "Dot figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "点阵身影", en: "Figure in dots" } },
    { key: "pitch", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "点距", en: "Dot spacing" } },
    { key: "wave", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "点阵曲面", en: "Surface of dots" } },
    { key: "rainbow", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "彩虹色散", en: "Rainbow" } },
    { key: "smear", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "横向拖影", en: "Motion smear" } },
    { key: "rgb", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "色彩错位", en: "Colour fringe" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "辉光", en: "Glow" } },
    { key: "columns", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "数字列", en: "Columns of digits" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "星点", en: "Stars" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "colour", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "保留照片色彩", en: "Photo's own colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(DM.black), text: css(DM.white), dim: css(DM.white, 0.55), titleFill: css(DM.white), titleInk: css(DM.black), grid: () => css(DM.white, 0.16) }),
  /**
   * Black; stars and columns of digits; the surface of dots; the figure (or the photo filling the canvas)
   * read into a grid of dots; then the fringe and the glow over what is there. A print photo is only
   * set on black.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cell = dmCell(p);
    if (env.photo) {
      ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h); env.drawPhoto();
      if (!L.fill || !canPaint(ctx)) return true;
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), px = sampled(ctx, 0, 0, cols, rows, cell, "dmPhoto");
      ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h);
      dotGrid(ctx, env, p, 0, 0, cols, rows, cell, (i, j) => { const q = (j * cols + i) * 4; return ((px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) >> 8) / 255; },
        (i, j) => { const q = (j * cols + i) * 4, c = [px[q], px[q + 1], px[q + 2]], l = Math.max(...c) || 1; return mix(DM.white, c.map((v) => (v * 255) / l), p.colour); });
    } else {
      if (L.ground !== false) { ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h); }
      if (!L.grid) return true;
      for (let k = 0, n = p.stars * 120; k < Math.ceil(n); k++) { ctx.fillStyle = css(DM.white, (0.3 + 0.7 * rand(k * 2.3 + 1300)) * clamp(n - k)); ctx.beginPath(); ctx.arc(rand(k * 3.1 + 1301) * w, rand(k * 4.7 + 1302) * h, 0.8 + rand(k * 5.9 + 1303) * 2, 0, TAU); ctx.fill(); }
      if (p.columns > 0) {   // columns of digits running down, fading as they go
        ctx.save(); ctx.font = `600 14px ${fonts.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        for (let k = 0, n = p.columns * 16; k < Math.ceil(n); k++) {
          const x = F.x0 + fw * rand(k * 2.9 + 1310), y0 = F.y0 + fh * rand(k * 3.7 + 1311) * 0.5, len = 10 + Math.floor(rand(k * 4.3 + 1312) * 26);
          for (let q = 0; q < len; q++) { ctx.fillStyle = css(DM.white, 0.75 * (1 - q / len) * clamp(n - k)); ctx.fillText(String(Math.floor(rand(k * 31 + q * 1.7) * 10)), x, y0 + q * 17); }
        }
        ctx.restore();
      }
      if (p.wave > 0) {   // a surface of dots rolling away into the distance, rows closer together toward the horizon
        const top = F.y0 + fh * 0.42, rows = 30, ph = rand(1320) * TAU;
        ctx.save(); ctx.globalAlpha = Math.min(1, p.wave * 2);
        for (let j = 0; j < rows; j++) {
          const t = j / (rows - 1), y = top + (F.y1 + fh * 0.15 - top) * t * t, step = cell * (0.5 + 1.5 * t), amp = fh * 0.14 * (0.25 + t) * p.wave, r = cell * 0.14 * (0.4 + t);
          const n = Math.ceil(w / step) + 1;
          for (let i = 0; i < n; i++) {
            const x = i * step + ((j % 2) * step) / 2, yy = y - amp * (Math.sin((x / w) * 5 + ph + j * 0.35) * 0.6 + Math.sin((x / w) * 11 - j * 0.2) * 0.4);
            const rb = p.rainbow > 0 ? clamp(p.rainbow * 1.6 - (1 - t) * 1.2) : 0, c = rb > 0 ? mix(DM.white, rainbow(x / w * 1.2 + t * 0.3), rb) : DM.white;
            ctx.fillStyle = css(c, 0.5 + 0.5 * t); ctx.beginPath(); ctx.ellipse(x, yy, r * (1 + p.smear * 6), r, 0, 0, TAU); ctx.fill();
          }
        }
        ctx.restore();
      }
      const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
      if (S) {   // the figure, read into the grid: a scene object
        const size = fh * (0.5 + 0.55 * p.figure), [cx, cy] = objAt("figure", F.x0 + fw * 0.66, F.y1 - size * 0.46, ctx), x0 = cx - size, y0 = cy - size * 0.6, cols = Math.ceil((size * 2) / cell), rows = Math.ceil((size * 1.25) / cell);
        const cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
        // lit from the upper left, and uneven, as a cloud of points is
        dotGrid(ctx, env, p, x0, y0, cols, rows, cell, (i, j) => (cov[j * cols + i] / 255) * (0.35 + 0.45 * (1 - (i / cols + j / rows) / 2) + 0.3 * noise(i * 0.37 + j * 0.61 + 7)), (i, j) => mix(DM.white, C, 0.15 * noise(i * 0.7 + j * 1.3)));
      }
    }
    if (p.rgb > 0) wherePainted(ctx, (c) => rgbFringe(c, u * 0.008 * p.rgb), L.base === "clear");   // on a see-through base, only over what is there
    if (p.glow > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "dmGlow"), 16, "dmSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.55 * p.glow; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); }
    return true;
  },
  /** The LED wall itself: its unlit points, every 16. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 16, r = 2.6;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css([12, 12, 16]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "round"; ctx.strokeStyle = css(DM.white, 0.8); ctx.lineWidth = 4; ctx.setLineDash([0.1, 12]); run(0, 0); ctx.setLineDash([]); } },   // a row of dots along the edge
  /** White capitals, a glow of the channel colour round them (the shadow slider); highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || DM.white, hi = o.hi || C, glow = Math.min(2, o.shadowAmt);
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(C, 0.6); ctx.shadowBlur = fs * 0.18 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || DM.white); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || DM.white); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink turns white, as everything on black must; objects in greys and white
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: DM.white }, stroke: { ink: DM.white } } : { fill: { ink: [30, 30, 36], light: DM.white, mid: [150, 150, 156], dark: [40, 40, 48] }, stroke: { ink: DM.white, light: DM.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow(ctx, draw, fill) { ctx.save(); ctx.globalAlpha = 0.6; ctx.shadowColor = fill; ctx.shadowBlur = 18; draw(fill); ctx.restore(); } }),
  /** The corner tag: monospaced capitals between brackets of dots. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.55;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 1.9, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(DM.white, 0.9);
    for (let q = 0; q <= 4; q++) for (const sx of [x, x + w]) { ctx.beginPath(); ctx.arc(sx, top + (h * q) / 4, 2.2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ink || css(C); spaced(ctx, str, x + f, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: a line of small spaced capitals at the foot, as the prints carry. */
  frame(ctx, env) {
    const { w, h } = env, P = env.o.profile;
    ctx.save(); ctx.fillStyle = css(DM.white, 0.55); ctx.font = `500 13px ${fonts.en}, ${fonts.cn}`; ctx.textBaseline = "alphabetic";
    spacedCentre(ctx, `© ${(P.brand.name || "STUDIO").toUpperCase()}  ALL RIGHTS RESERVED`, w / 2, h - 30, 4); ctx.restore();
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Glowing shapes for a dot-matrix poster of light on black — bold, simple and luminous — that read at a glance:
- one clear silhouette per sticker (a figure, a hand, a star, a planet, a speaker, a cube, a wave), simple; no realism, no perspective, no detail;
- flat colour only: "white" for the bright parts, the main colour for a glow, "ink" only for small dark gaps;
- the app adds a soft glow round each shape: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a point cloud of light would show them: a few boxes and cylinders, clean and geometric — a speaker, a screen, a cube, a tower; no realism, no fine detail.
- the renderer paints faces in greys and white: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a light grey.`,
};

// ====================================================================== neon: noir pop illustration in three neon tones
// The neon pop portrait: everything reduced to a few flat tones mapped from dark to light onto a neon
// palette (the channel colour, its hot complement, a deep night), black shadows, a rim of hot light
// round the figure, a light behind it, a diagonal plane of colour, bars down the side, halftone in the
// shadows, grain like a print.
const NEON = { deep: [10, 8, 26], white: [255, 244, 250] };
/** The palette from the channel colour, turned round the wheel by Hue shift: deep, low, mid (the channel's), hot (its complement), pale. */
function neonSet(C) {
  const mid = hueTurn(boost(C, 0.75), values.shift * 360), hot = boost(hueTurn(mid, 135), 0.8);
  return { deep: NEON.deep, low: mix(NEON.deep, mid, 0.42), mid, hot, pale: mix(hot, NEON.white, 0.7) };
}
const neonStops = (N) => [[0, N.deep], [0.3, N.low], [0.56, N.mid], [0.8, N.hot], [1, N.pale]];
const neonGround = (N) => (dark ? mix(N.deep, N.mid, 0.08) : N.hot);
const neonText = (N) => (dark ? N.pale : [26, 22, 54]);   // on the hot ground a night tone just off the house ink, so the small parts' ink can be swapped on its own
const neon = {
  id: "neon",
  art: "figure",
  repaint: (c) => `a neon noir pop illustration made from the photograph: the subject reduced to three or four flat tones — deep night shadows, ${c}, a hot complementary neon and a pale highlight — hard rim light, black shadows, halftone and print grain; still the same picture, no text.`,
  about: { zh: "霓虹波普：霓虹色的黑色电影式插画——画面按明暗映射成几层平涂的霓虹色（深夜的暗部、频道色、它的互补热色、亮部），深黑阴影，人物（频道图形或照片）带一圈热色轮廓光，身后一团背光，一块斜切的色面，侧边的竖条，阴影里的网点和印刷颗粒；色相可以整体轮转。浓烈、复古未来、有态度——适合音乐、潮流、游戏、夜生活、悬疑和人物内容。可选暗夜底或热色底。", en: "Neon: the neon noir pop illustration — the picture mapped from dark to light onto a few flat neon tones (night-dark shadows, the channel colour, its hot complement, a pale highlight), black shadows, a rim of hot light round the figure (the channel graphic, or the photo), a light behind it, a diagonal plane of colour, bars down the side, halftone in the shadows and print grain; the whole palette can be turned round the colour wheel. Intense, retro-futurist, with attitude — for music, fashion, games, nightlife, mystery and portraits. A night-dark or a hot ground." },
  name: { zh: "霓虹波普", en: "Neon pop" },
  seeded: true,
  scene: { figure: { zh: "人物剪影", en: "Figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "人物剪影", en: "Figure" } },
    { key: "rim", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "轮廓光", en: "Rim light" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "背光", en: "Backlight" } },
    { key: "split", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "斜切色面", en: "Diagonal plane" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "侧边竖条", en: "Side bars" } },
    { key: "shift", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "色相轮转", en: "Hue shift" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "阴影网点", en: "Halftone shadows" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "辉光", en: "Bloom" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "印刷颗粒", en: "Print grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "暗角", en: "Vignette" } },
    { key: "map", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片霓虹化", en: "Photo in neon" } },
    { key: "posterize", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "色阶硬度", en: "Hard tones" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base, C) => { const N = neonSet(C); return { ...base, field: css(neonGround(N)), text: css(neonText(N)), dim: css(neonText(N), 0.6), titleFill: css(neonText(N)), titleInk: css(neonGround(N)), grid: () => css(neonText(N), 0.14) }; },
  /**
   * The ground, the diagonal plane, the backlight, the bars, then the figure: a rim of hot light a little
   * off it, and its body lit from that side down into the night. A photo is mapped onto the palette
   * (Photo in neon), its tones as hard as Hard tones says; then the bloom and the halftone.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, N = neonSet(C), ground = neonGround(N), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    const size = fh * (0.55 + 0.5 * p.figure), at = [F.x0 + fw * 0.64, F.y1 - size * 0.46];
    const [cx, cy] = !env.photo && L.grid && (p.figure > 0 || p.glow > 0) ? objAt("figure", at[0], at[1], ctx) : at;   // the figure and its glow: a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    const after = () => {
      if (p.bloom > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "neonGlow"), 18, "neonSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.7 * p.bloom; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); }
      if (p.halftone > 0) wherePainted(ctx, (c) => dotScreen(c, w, h, N.deep, 8, 0.45 * p.halftone), L.base === "clear");
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable(neonStops(N), p.posterize), p.map);
      if (L.fill) after();
      return true;
    }
    if (!L.grid) return true;
    if (p.split > 0) {   // a plane of the other tone, cut on a diagonal, sweeping in from the right
      const x0 = F.x1 - fw * (0.15 + 0.6 * p.split);
      ctx.fillStyle = css(dark ? mix(N.low, N.mid, 0.4) : mix(N.hot, N.mid, 0.55)); ctx.beginPath(); ctx.moveTo(x0 + fh * 0.35, F.y0 - 10); ctx.lineTo(w + 10, F.y0 - 10); ctx.lineTo(w + 10, F.y1 + 10); ctx.lineTo(x0 - fh * 0.2, F.y1 + 10); ctx.closePath(); ctx.fill();
    }
    if (p.glow > 0) { const g = ctx.createRadialGradient(cx, cy - size * 0.2, 0, cx, cy - size * 0.2, size * 0.9); g.addColorStop(0, css(dark ? N.hot : N.pale, 0.85 * p.glow)); g.addColorStop(1, css(dark ? N.hot : N.pale, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    for (let k = 0, n = p.bars * 6; k < Math.ceil(n); k++) { ctx.fillStyle = css(dark ? N.hot : N.deep, clamp(n - k)); ctx.fillRect(F.x0 + 20 + k * 34, F.y0 + fh * (0.1 + rand(k * 2.3 + 1400) * 0.2), 10 + (k % 3) * 8, fh); }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      if (p.rim > 0) { const d = size * 0.018 * (0.5 + p.rim); blurred(ctx, size * 0.04 * p.rim, css(N.hot, 0.9 * p.rim), () => placeShape(ctx, S, [0, 0, 0], cx + d, cy - d, size)); ctx.save(); ctx.globalAlpha = Math.min(1, p.rim * 2); placeShape(ctx, S, N.pale, cx + d, cy - d * 0.7, size); ctx.restore(); }
      const x = workLike(ctx, "neon");
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in";
      const g = x.createLinearGradient(cx + size * 0.45, cy - size * 0.5, cx - size * 0.35, cy + size * 0.4);
      g.addColorStop(0, css(N.mid)); g.addColorStop(0.42, css(N.low)); g.addColorStop(1, css(N.deep));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      layDown(ctx, x);
    }
    after();
    return true;
  },
  /** The light through a noir window's blind: its slats laid across the room on the slant, each a pair of lines. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, -0.32, 64); slantPath(ctx, w, h, -0.32, 64, 22); ctx.restore();
  },
  accent: { fill: (C) => { const N = neonSet(C); return css(dark ? mix(N.deep, N.mid, 0.22) : N.deep); }, tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny, C) { ctx.lineCap = "butt"; ctx.strokeStyle = css(neonSet(C || NEON.white).hot); ctx.lineWidth = 4; run(0, 0); } },
  /** Pale capitals glowing in the hot tone (the shadow slider), or on the hot ground night-dark ones; highlighted words in the hot tone, or a deep tone of the channel's. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, N = neonSet(o.C || NEON.white), hi = o.hi || (dark ? N.hot : mix(N.mid, N.deep, 0.45)), ink = o.fill || neonText(N), glow = Math.min(2, o.shadowAmt);   // on the hot ground, a deep tone of the channel's colour
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(dark ? N.hot : N.deep, 0.9); ctx.shadowBlur = fs * 0.2 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink (on the dark block) turns pale; objects go into the palette
  wrap: (ctx, C, p, plates) => { const N = neonSet(C); return mapped(ctx, plates ? { fill: { ink: N.pale }, stroke: { ink: N.pale } } : { fill: { ink: N.deep, light: N.pale, mid: N.mid, dark: N.low, colour: () => N.hot }, stroke: { ink: N.deep, light: N.pale, colour: () => N.hot }, line: 0.6 }); },
  sticker: painters({ line: NEON.deep, lineScale: 0.5, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw(css(NEON.deep, 0.5)); ctx.restore(); } }),
  /** The corner tag: a slab of the hot tone with deep lettering (reversed on the hot ground). */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const N = neonSet(C), slab = dark ? N.hot : N.deep, f = fs * 0.72;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.2, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(slab); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(dark ? N.deep : N.hot); spaced(ctx, str, x + f * 0.6, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  frame() {},
  image(ctx, C, unit) { ctx.shadowColor = css(neonSet(C).hot, 0.6); ctx.shadowBlur = 24 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit); vignette(ctx, w, h, NEON.deep, 0.85 * p.vignette, 0.4); },
  prompt: `Stickers for a neon noir pop illustration — bold, moody and graphic — that read at a glance:
- one strong silhouette per sticker (a face in profile, sunglasses, a hand with a cigarette, a cat, a microphone, a skull, a rose), with hard light and black shadow shapes; no realism, no fine detail;
- flat colour only: "ink" for deep shadow, the main colour for the mid tone, "white" for highlights, and one hot accent ("red" or "pink");
- the app adds a dark outline and a soft offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a neon noir illustration would show them: a few boxes and cylinders, sleek and dramatic — a jukebox, a neon sign, a phone booth, a speaker; no realism, no fine detail.
- the renderer paints faces in a deep night tone, the channel colour and a hot neon: do NOT try to draw shading or outlines yourself;
- "white" is the pale highlight, "dark" the night, and "main" the channel colour.`,
};

// ====================================================================== shared by the looks below
/** Where the channel graphic stands on the cover, as placeShape takes it: its silhouette's middle and solid height (a move of the layer itself not counted). */
function artPlace(env, S) {
  const A = env.G && env.G.art, b = S.box;
  return A ? { cx: A.x + ((b.x0 + b.x1) / 2) * A.s, cy: A.y + ((b.y0 + b.y1) / 2) * A.s, size: (b.y1 - b.y0) * A.s } : null;
}
/**
 * On a work canvas holding a silhouette, gives it volume: copies of the shape moved down and right
 * darken all of it but its upper-left rim, copies moved up and left lighten all but its lower-right
 * one — so the light comes from the upper left. `d`: the step, in units; `a`: how strongly.
 */
function bevel(x, S, cx, cy, size, d, light, shade, a) {
  if (a <= 0) return;
  x.save(); x.globalCompositeOperation = "source-atop";
  for (let i = 1; i <= 3; i++) {
    x.globalAlpha = a * 0.28; placeShape(x, S, shade, cx + d * i, cy + d * i, size);
    x.globalAlpha = a * 0.2; placeShape(x, S, light, cx - d * i, cy - d * i, size);
  }
  x.restore();
}
/** A gradient along a line whose hues cycle like a soap film, starting at hue `turn` (0–1). */
function iridescent(ctx, x0, y0, x1, y1, turn, alpha = 1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, css(mix(rainbow(turn + i * 0.13), [255, 255, 255], 0.12), alpha));
  return g;
}
/** A glass bubble: clear in the middle, tinted toward the rim, an iridescent edge, a highlight arc and a glint. */
function glassBubble(ctx, x, y, r, tint, a = 1) {
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

// ====================================================================== court: the basketball poster
// Basketball posters and team prints: a varsity number in the team colour, halftone and outlined; the
// ball with its seams; a half court in isometric plan with its stand and net; a hoop in dotted line;
// spray paint dripping; the figure leaving speed trails; the print distressed, the wall behind it worn.
const BB = { orange: [236, 106, 34], seam: [40, 22, 14], royal: [38, 82, 178], navy: [14, 26, 64], paper: [236, 234, 228], ink: [24, 24, 28], white: [248, 246, 240], wood: [222, 170, 104] };
const bbGround = () => (dark ? BB.navy : BB.paper), bbInk = () => (dark ? BB.white : BB.ink);
/** The team colour: the channel's, made vivid; royal blue (gold on the navy ground) where it would be lost against the ball or the ground. */
const bbTeam = (C) => { const c = boost(C, 0.5); return near(c, BB.orange, 120) || near(c, bbGround(), 120) ? (dark ? [250, 196, 40] : BB.royal) : c; };
/** A basketball: the leather lit from the upper left, halftone in its shade, its eight seams, a shadow under it. */
function basketball(ctx, x, y, r, rot, half) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(x + r * 0.15, y + r * 1.04, r * 0.8, r * 0.13, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(BB.orange); ctx.fill();
  ctx.save(); ctx.clip();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, "rgba(255,226,186,0.4)"); g.addColorStop(0.6, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(70,24,0,0.4)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (half > 0) { ctx.beginPath(); ctx.arc(x + r * 0.55, y + r * 0.55, r, 0, TAU); ctx.clip(); dotScreen(ctx, x + r * 2, y + r * 2, BB.seam, Math.max(5, Math.round(r * 0.08)), 0.45 * half); }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = css(BB.seam); ctx.lineWidth = Math.max(2, r * 0.045); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 1.32, 0, r * 0.96, 0, TAU); ctx.stroke(); }   // the two curved seams
  ctx.restore();
  ctx.strokeStyle = css(BB.seam); ctx.lineWidth = Math.max(2, r * 0.045); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.restore();
}
/**
 * A half court in isometric plan, its baseline at the back, running toward the viewer and cropped by
 * the floor: the lines come in over the first half of `amt`, the key and the circles fill in over the
 * second, and the stand with its backboard, rim and net rises with it.
 */
function courtPlan(ctx, env, amt, team) {
  const F = openField(env), fh = F.y1 - F.y0, s = fh * 0.05, [ox, oy] = objAt("court", F.x1 - s * 7, F.y1 - s * 8.6, ctx), la = Math.min(1, amt * 2), fa = clamp(amt * 2 - 1);   // a scene object
  const P = (X, Y, Z = 0) => [ox + (X - Y) * 0.866 * s, oy + (X + Y) * 0.5 * s - Z * s];
  const path = (pts, close) => { ctx.beginPath(); pts.forEach(([X, Y, Z], i) => { const [x, y] = P(X, Y, Z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close) ctx.closePath(); };
  const arc = (cx, cy, r, a0, a1, z = 0) => { const out = []; for (let i = 0; i <= 40; i++) { const t = a0 + ((a1 - a0) * i) / 40; out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]); } return out; };
  const line = dark ? BB.white : BB.orange, fill2 = dark ? BB.orange : BB.navy;
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (fa > 0) {
    ctx.globalAlpha = fa;
    path([[-2.45, 0], [2.45, 0], [2.45, 5.8], [-2.45, 5.8]], true); ctx.fillStyle = css(team); ctx.fill();
    path(arc(0, 5.8, 1.8, 0, Math.PI), true); ctx.fillStyle = css(fill2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = la; ctx.strokeStyle = css(line); ctx.lineWidth = Math.max(2, s * 0.09);
  path([[-7.5, 0], [7.5, 0], [7.5, 14], [-7.5, 14]], true); ctx.stroke();
  path([[-2.45, 0], [-2.45, 5.8], [2.45, 5.8], [2.45, 0]]); ctx.stroke();
  path(arc(0, 5.8, 1.8, 0, TAU)); ctx.stroke();
  const a3 = Math.acos(6.6 / 6.75);
  path([[-6.6, 0], ...arc(0, 1.575, 6.75, Math.PI - a3, a3), [6.6, 0]]);   // the three-point line: straight in the corners, then the arc
  ctx.stroke();
  path(arc(0, 14, 1.8, Math.PI, TAU)); ctx.stroke();
  if (fa > 0) {   // the stand: a post behind the baseline, an arm, the backboard, the rim and the net
    ctx.globalAlpha = fa; ctx.strokeStyle = css(bbInk()); ctx.lineWidth = Math.max(3, s * 0.16);
    path([[0, -1.2, 0], [0, -1.2, 3.5], [0, 0.95, 3.5]]); ctx.stroke();
    path([[-0.9, 1.2, 2.9], [0.9, 1.2, 2.9], [0.9, 1.2, 3.95], [-0.9, 1.2, 3.95]], true); ctx.fillStyle = css(BB.white); ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.07); ctx.stroke();
    path([[-0.29, 1.2, 3.05], [0.29, 1.2, 3.05], [0.29, 1.2, 3.5], [-0.29, 1.2, 3.5]], true); ctx.stroke();
    ctx.strokeStyle = css(BB.orange); ctx.lineWidth = Math.max(2, s * 0.08); path(arc(0, 1.575, 0.23, 0, TAU, 3.05)); ctx.stroke();
    ctx.strokeStyle = css(bbInk(), 0.7); ctx.lineWidth = Math.max(1, s * 0.035);
    for (let i = 0; i < 10; i++) { const t0 = (i / 10) * TAU, t1 = t0 + TAU / 10; path([[Math.cos(t0) * 0.23, 1.575 + Math.sin(t0) * 0.23, 3.05], [Math.cos(t1) * 0.15, 1.575 + Math.sin(t1) * 0.15, 2.6]]); ctx.stroke(); path([[Math.cos(t1) * 0.23, 1.575 + Math.sin(t1) * 0.23, 3.05], [Math.cos(t0) * 0.15, 1.575 + Math.sin(t0) * 0.15, 2.6]]); ctx.stroke(); }
    const [bx, by] = P(-3.5, 9, 0.35);   // a ball on the floor, in the key's light
    basketball(ctx, bx, by, s * 0.38, 0.4, 0);
  }
  ctx.restore();
}
/** A hoop seen straight on, hanging from the top of the field, drawn in dotted line like a coarse halftone print. */
function hoopFront(ctx, env, amt) {
  const F = openField(env), fw = F.x1 - F.x0, W = fw * (0.14 + 0.16 * amt), [x, mid] = objAt("hoop", F.x0 + fw * 0.82, F.y0 + 14 + W * 0.45, ctx), top = mid - W * 0.45, lw = Math.max(3, W * 0.03), ink = bbInk();   // a scene object
  ctx.save(); ctx.globalAlpha = Math.min(1, amt * 3); ctx.strokeStyle = css(ink); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = lw * 1.6; ctx.strokeRect(x - W / 2, top, W, W * 0.6);
  ctx.lineWidth = lw; ctx.strokeRect(x - W * 0.16, top + W * 0.3, W * 0.32, W * 0.24);
  const ry = top + W * 0.6, rw = W * 0.26, nh = W * 0.42, bw = W * 0.16;
  ctx.fillStyle = css(ink); ctx.fillRect(x - W * 0.05, top + W * 0.54, W * 0.1, W * 0.07);
  ctx.strokeStyle = css(BB.orange); ctx.lineWidth = lw * 1.3; ctx.beginPath(); ctx.ellipse(x, ry, rw, W * 0.045, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = css(ink); ctx.lineWidth = lw * 0.75; ctx.setLineDash([lw * 0.4, lw * 0.9]);
  for (let i = 0; i <= 8; i++) {   // the net: two sets of strands crossing into diamonds as it narrows
    const t = i / 8, xa = x - rw + 2 * rw * t;
    for (const d of [-1, 1]) { const xb = x - bw + 2 * bw * clamp(t + d * 0.25); ctx.beginPath(); ctx.moveTo(xa, ry + W * 0.03); ctx.lineTo(xb, ry + nh); ctx.stroke(); }
  }
  for (let k = 1; k <= 3; k++) { const yy = ry + (nh * k) / 3.4, half = rw - (rw - bw) * (k / 3.4); ctx.beginPath(); ctx.moveTo(x - half, yy); ctx.lineTo(x + half, yy); ctx.stroke(); }
  ctx.restore();
}
/**
 * Where the varsity number and the ball go: beside the title where there is room; else toward the
 * field's far side, the number lower so it shows under the title, and the ball just below the title's
 * last line (`below`), where it is not hidden.
 */
function bbSpot(ctx, env) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, T = titleArea(ctx, env), room = T ? F.x1 - (T.x + T.w) : fw;
  if (room > fw * 0.3) return { F, cx: T ? (T.x + T.w + F.x1) / 2 : F.x0 + fw * 0.7, cy: F.y0 + fh * 0.48, room, below: null };
  return { F, cx: F.x0 + fw * 0.72, cy: F.y0 + fh * 0.58, room: fw * 0.45, below: T.y + T.h };
}
const court = {
  id: "court",
  repaint: (c) => `a basketball poster made from the photograph: a bold two-colour team print in ${c} and basketball orange, halftone dots, the subject in high contrast, a distressed screen-print texture on a worn white wall; still the same picture, no text.`,
  about: { zh: "篮球海报：校队球衣式的大号数字（团队色、网点填充、白边加橙色外描边），一颗带缝线和网点阴影的篮球坐在数字中间；可加等距视角的半场平面图（篮架、篮筐、球网一起立起来）、点线画的正面篮筐、喷漆滴流、频道图形带出的速度残影；丝网印刷的斑驳和旧墙面质感。团队色来自频道色。米白墙底或深海军蓝底；自带平直的版式，色块是木地板。", en: "Basketball poster: a varsity number in the team colour — halftone fill, a white gap and an orange outline — with the ball, seams and halftone shading, sitting in it; a half court in isometric plan with its stand, rim and net rising, a hoop in dotted line, spray paint dripping, speed trails behind the channel graphic; the distress of a screen print and a worn wall. The team colour is the channel's. A worn white wall or deep navy; flat layouts of its own, the colour block a hardwood floor." },
  name: { zh: "篮球海报", en: "Basketball poster" },
  seeded: true,
  scene: { number: { zh: "球衣号码", en: "Jersey number" }, ball: { zh: "篮球", en: "Ball" }, court: { zh: "半场平面", en: "Half court" }, hoop: { zh: "正面篮筐", en: "Hoop" } },
  params: [
    { key: "number", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "球衣号码", en: "Jersey number" } },
    { key: "jersey", text: true, max: 3, def: "", name: { zh: "号码内容", en: "The number" }, placeholder: { zh: "留空：用频道序号", en: "Empty: the channel's place" } },
    { key: "ball", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "篮球", en: "Ball" } },
    { key: "court", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "半场平面", en: "Half court" } },
    { key: "hoop", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "正面篮筐", en: "Hoop" } },
    { key: "spray", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "喷漆滴流", en: "Spray drips" } },
    { key: "motion", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "速度残影", en: "Speed trails" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "网点", en: "Halftone" } },
    { key: "distress", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "丝网斑驳", en: "Screen-print wear" } },
    { key: "wall", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旧墙面", en: "Worn wall" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "颗粒", en: "Grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片双色", en: "Photo in two colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.18, side: 0.3, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(bbGround()), text: css(bbInk()), dim: css(bbInk(), 0.6), titleFill: css(bbInk()), titleInk: css(bbGround()), grid: () => css(bbInk(), 0.1) }),
  /**
   * The ground; the half court; the dotted hoop; speed trails behind the channel graphic; then the
   * varsity number with the spray and the ball on it. A photo becomes a two-colour print (navy, the team
   * colour, white) through a halftone.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), team = bbTeam(C);
    if (L.ground !== false) { ctx.fillStyle = css(bbGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      mapTones(ctx, toneTable([[0, mix(BB.navy, team, 0.2)], [0.55, team], [1, BB.white]], 0.15), p.duo * 0.85);
      dotScreen(ctx, w, h, BB.navy, 8, 0.35 * p.halftone);
      return true;
    }
    if (!L.grid) return true;
    if (p.court > 0) courtPlan(ctx, env, p.court, team);
    if (p.hoop > 0) hoopFront(ctx, env, p.hoop);
    const S = canPaint(ctx) && graphicShape(env, env.graphic), A = S && artPlace(env, S);   // the channel graphic itself, where it stands
    if (A && p.motion > 0) {   // the figure has just passed: soft copies trailing back, and speed lines
      for (let i = 5; i >= 1; i--) blurred(ctx, A.size * 0.02, css(team, (0.5 * p.motion) / Math.sqrt(i)), () => placeShape(ctx, S, [0, 0, 0], A.cx - i * A.size * 0.1 * (0.4 + p.motion), A.cy, A.size));
      ctx.save(); ctx.strokeStyle = css(team, 0.75); ctx.lineCap = "round";
      for (let k = 0; k < Math.round(4 + 8 * p.motion); k++) { const y = A.cy + (rand(k * 2.9 + 1500) - 0.5) * A.size * 0.8, x1 = A.cx - A.size * (0.35 + rand(k * 3.3 + 1501) * 0.2), len = A.size * (0.3 + rand(k * 4.1 + 1502) * 0.7) * p.motion; ctx.lineWidth = 2 + rand(k + 1503) * 4; ctx.beginPath(); ctx.moveTo(x1 - len, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ctx.restore();
    }
    const at = bbSpot(ctx, env), fh = at.F.y1 - at.F.y0;
    if (p.number > 0 && canPaint(ctx)) {   // the varsity number: team colour through a halftone, a white gap, an orange outline; a scene object
      const [nx, ty] = objAt("number", at.cx, at.cy - fh * 0.2, ctx), ny = ty + fh * 0.2;   // its handle up from the ball's
      const str = [...((p.jersey || pad2(env.o.catIndex + 1)).toUpperCase())].filter((c) => c.trim()).slice(0, 3).join("") || "0", x = workLike(ctx, "bb");
      x.font = `900 100px ${fonts.en}, ${fonts.cn}`; const fs = Math.min(fh * (0.5 + 0.45 * p.number), (at.room * 0.9 * 100) / Math.max(1, x.measureText(str).width));
      x.font = `900 ${fs}px ${fonts.en}, ${fonts.cn}`; x.textAlign = "center"; x.textBaseline = "middle"; x.lineJoin = "round";
      x.fillStyle = css(team); x.fillText(str, nx, ny);
      if (p.halftone > 0) dotScreen(x, w, h, [0, 0, 0], Math.max(6, Math.round(fs * 0.035)), 0.75 * p.halftone, "destination-out");
      x.globalCompositeOperation = "destination-over";
      x.strokeStyle = css(BB.white); x.lineWidth = fs * 0.07; x.strokeText(str, nx, ny);
      x.strokeStyle = css(BB.orange); x.lineWidth = fs * 0.13; x.strokeText(str, nx, ny);
      layDown(ctx, x, Math.min(1, p.number * 4));
    }
    // under a long title the ball goes just below its last line, left of the channel graphic
    const br = u * (0.05 + 0.14 * p.ball), G = env.G && env.G.art, gl = G ? G.x - 300 * G.s : at.F.x1;
    const bx0 = at.below ? clamp(gl - br * 1.15, at.F.x0 + (at.F.x1 - at.F.x0) * 0.3, at.cx) : at.cx + (p.number > 0 ? br * 0.25 : 0);
    const by0 = at.below ? clamp(at.below + br * 0.75, at.cy, at.F.y1 - br * 1.15) : at.cy + (p.number > 0 ? br * 0.1 : 0);
    const [bx, by] = p.ball > 0 ? objAt("ball", bx0, by0, ctx) : [bx0, by0];   // a scene object
    if (p.spray > 0 && p.ball > 0) {   // spray paint round the ball, and drips running down from it
      ctx.save(); ctx.fillStyle = css(team, 0.85);
      for (let k = 0, n = Math.round(500 * p.spray); k < n; k++) { const a = rand(k * 1.3 + 1510) * TAU, d = br * (0.95 + rand(k * 2.1 + 1511) ** 2 * 0.7 * (0.4 + p.spray)); ctx.beginPath(); ctx.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d, 0.8 + rand(k * 3.7 + 1512) * 2.2, 0, TAU); ctx.fill(); }
      for (let k = 0, n = Math.round(3 + 5 * p.spray); k < n; k++) {
        const off = (rand(k * 4.3 + 1513) - 0.5) * br * 1.6, top = by + Math.sqrt(Math.max(0, br * br - off * off)) * 0.6, len = br * (0.3 + rand(k * 5.9 + 1514) * 1.8) * p.spray, dw = br * (0.07 + rand(k * 6.7 + 1515) * 0.09);
        ctx.beginPath(); rounded(ctx, bx + off - dw / 2, top, dw, len, dw / 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + off, top + len, dw * 0.75, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (p.ball > 0) basketball(ctx, bx, by, br, -0.5 + rand(1520) * 0.6, p.halftone);
    return true;
  },
  /** A hardwood floor: boards across, 48 wide, their butt joints staggered from row to row. */
  gridLines(ctx, env, color) {
    const { w, h } = env, b = 48;
    gridPen(ctx, color);
    gridPath(ctx, [], every(b, h, b), 0, 0, w, 0);
    ctx.beginPath();
    for (let j = 0; j * b < h; j++) for (let x = noise(j * 3.1 + 7) * 420, i = 0; x < w; i++, x += 300 + noise(j * 1.7 + i * 2.3) * 360) { ctx.moveTo(x, j * b); ctx.lineTo(x, j * b + b); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(BB.wood), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(BB.white); ctx.lineWidth = 7; run(0, 0); } },   // the hardwood floor and its boundary line
  /** Heavy condensed capitals with a second colour set off a little behind them, as on a jersey (the shadow slider); highlighted words in ball orange. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, team = bbTeam(o.C || BB.royal), d = fs * 0.05 * Math.min(2, o.shadowAmt);
    if (d > 0) pass((a, x) => { ctx.fillStyle = css(a.hi ? BB.seam : team); ctx.fillText(a.t, x + d, d); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || BB.orange : o.fill || bbInk()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: BB.ink, light: BB.white }, stroke: { ink: BB.ink, light: BB.white }, line: 0.8 })),
  sticker: painters({ line: BB.ink, lineScale: 0.7, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw("rgba(0,0,0,0.25)"); ctx.restore(); } }),
  /** The corner tag: a chenille varsity patch — team colour, a white keyline and an orange border. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.72, team = bbTeam(C);
    ctx.font = `900 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.3); ctx.fillStyle = css(BB.orange); ctx.fill();
    ctx.beginPath(); rounded(ctx, x + 5, top + 5, w - 10, h - 10, h * 0.24); ctx.fillStyle = css(BB.white); ctx.fill();
    ctx.beginPath(); rounded(ctx, x + 9, top + 9, w - 18, h - 18, h * 0.2); ctx.fillStyle = css(team); ctx.fill();
    ctx.fillStyle = ink || css(lum(team) > 0.6 ? BB.ink : BB.white); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a row of stars across the top, as on a championship shirt. */
  frame(ctx, env) {
    const { w } = env;
    for (let i = 0; i < 5; i++) starMark(ctx, w / 2 + (i - 2) * 34, 50, 9, 5, bbInk());
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 8 * unit; },
  /** The print worn through (paper or navy showing in specks), the wall behind it scuffed and creased, grain. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, bbGround(), p.distress * 0.9, dark ? "darken" : "lighten");
    if (p.wall > 0) { crumple(ctx, w, h, p.wall * 0.7); wear(ctx, w, h, dark ? [70, 80, 110] : [150, 148, 144], p.wall * 0.45, dark ? "lighten" : "multiply"); }
    grain(ctx, p.grain * 0.7, unit, !dark);
  },
  prompt: `Stickers for a basketball team print — bold, sporty, graphic — that read at a glance:
- one clear object per sticker (a ball, a sneaker, a jersey, a hoop, a trophy, a whistle, a player in silhouette, a star), simple and punchy; no realism, no perspective, no fine detail;
- flat colour only: the main colour (the team colour) with "white", "ink" and orange ("yellow" comes out gold) as partners;
- the app adds a dark outline and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects from basketball, built as simple models from a few boxes and cylinders — a hoop and backboard, a bench, a scoreboard, a ball rack, a locker; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" the team colour — use it for one to three parts.`,
};

// ====================================================================== velvet: the flocked 3D illustration
// Soft, flocked 3D illustration in a few strong colours: periwinkle sky, acid-green hills and velvet,
// red and pink; figures and objects with plush volume, lit from the upper left, fuzzy at the edge,
// sometimes checked; soft cast shadows; heavy grain like a velvety print; stars on a night gradient.
const VL = { peri: [98, 112, 218], night: [12, 16, 52], green: [118, 186, 40], moss: [36, 92, 28], red: [226, 30, 40], pink: [246, 156, 196], cream: [244, 240, 252], ink: [16, 16, 24] };
const vlGround = () => (dark ? VL.night : VL.peri);
/** The object's colour: the channel's, made vivid; acid green where it would sink into the periwinkle. */
const vlBody = (C) => { const c = boost(C, 0.6); return near(c, VL.peri, 120) || near(c, VL.night, 90) ? VL.green : c; };
/** Where the figure stands: on the hills, toward the field's far side. */
function vlPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.55 + 0.55 * p.figure);
  return { F, cx: F.x0 + fw * 0.74, cy: F.y1 - size * 0.52, size };   // big, behind the title's end and above the graphic, so it shows round them
}
const velvet = {
  id: "velvet",
  art: "figure",
  repaint: (c) => `a soft flocked 3D illustration made from the photograph: plush velvety surfaces, rounded volumes lit from the upper left, a periwinkle-blue sky and acid-green hills, ${c} as the object colour, red and pink accents, soft cast shadows, heavy fine grain; whimsical, fashion-editorial; no text.`,
  about: { zh: "绒感插画：像植绒一样毛茸茸的立体插画——长春花蓝的天空、荧光绿的绒面山丘，频道图形变成一个有体积、左上受光、边缘发毛的绒面物件（颜色来自频道色，可铺上模糊的格纹），脚下一团柔和的投影；可加暮色渐变、星星、柔光，整张覆着厚厚的细颗粒。俏皮、时髦、有手感——适合时尚、生活方式、潮玩、节日和女性向内容。可选长春花蓝底或夜空底；自带平直的版式，色块是一片绿色绒面草地。", en: "Velvet: soft flocked 3D illustration — a periwinkle sky, acid-green velvet hills, the channel graphic as a plush object with volume, lit from the upper left and fuzzy at the edge (in the channel colour, a blurred check on it if you like), a soft shadow under it; a dusk gradient, stars and a glow if you like, and heavy fine grain over everything. Playful, fashionable, tactile — for fashion, lifestyle, designer toys, festive and feminine content. A periwinkle or a night ground; flat layouts of its own, the colour block a green velvet lawn." },
  name: { zh: "绒感插画", en: "Velvet illustration" },
  seeded: true,
  scene: { figure: { zh: "绒面物件", en: "Plush figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "绒面物件", en: "Plush figure" } },
    { key: "volume", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "立体感", en: "Volume" } },
    { key: "fuzz", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "绒毛边", en: "Fuzzy edge" } },
    { key: "check", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "格纹", en: "Check" } },
    { key: "hills", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "绒面山丘", en: "Velvet hills" } },
    { key: "shadow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "投影", en: "Shadow" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "暮色渐变", en: "Dusk gradient" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "星星", en: "Stars" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "柔光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "绒面颗粒", en: "Velvet grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "暗角", en: "Vignette" } },
    { key: "tone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片绒色", en: "Photo in velvet colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.17, side: 0.3, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(vlGround()), text: css(VL.cream), dim: css(VL.cream, 0.65), titleFill: css(VL.cream), titleInk: css(vlGround()), grid: () => css(VL.cream, 0.2) }),
  /**
   * The sky (deeper toward the top at dusk), stars, velvet hills rising from the floor, then the plush
   * figure: its fuzzy halo, its soft cast shadow, and the body on a work canvas — the colour, a blurred
   * check, the light from the upper left (bevel) and a soft highlight. A photo is mapped by lightness onto
   * the velvet palette.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), ground = vlGround(), body = vlBody(C);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false && p.dusk > 0) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(dark ? [4, 6, 22] : VL.night, 0.85 * p.dusk)); g.addColorStop(0.65, css(dark ? VL.night : VL.peri, 0)); g.addColorStop(1, css(dark ? VL.peri : [170, 180, 250], 0.5 * p.dusk)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, VL.night], [0.32, VL.peri], [0.6, VL.green], [0.82, VL.pink], [1, VL.cream]], 0.3), p.tone);
      return true;
    }
    if (!L.grid) return true;
    const at = vlPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    for (let k = 0, n = p.stars * 16; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); sparkle(ctx, F.x0 + rand(k * 2.7 + 1600) * fw, F.y0 + rand(k * 3.9 + 1601) * fh * 0.55, 4 + rand(k * 5.1 + 1602) * 10, VL.cream, 1); ctx.restore(); }
    if (p.hills > 0) {   // two or three soft hills, the far ones bluer, each lit along its crest and fuzzy at the edge
      for (let k = 0; k < 3; k++) {
        const r = clamp(p.hills * 3 - k * 0.8);
        if (r <= 0) continue;
        const depth = (2 - k) / 2, top = F.y1 - fh * (0.12 + 0.3 * p.hills) * (0.55 + 0.45 * depth) * r, x0 = F.x0 - fw * 0.1 + rand(k + 1610) * fw * 0.5, x1 = x0 + fw * (0.7 + rand(k + 1611) * 0.6);
        const col = mix(VL.green, ground, 0.45 * depth), path = () => { ctx.beginPath(); ctx.moveTo(x0, F.y1 + 10); ctx.bezierCurveTo(x0 + (x1 - x0) * 0.2, top, x0 + (x1 - x0) * 0.7, top, x1, F.y1 + 10); ctx.closePath(); };
        blurred(ctx, u * 0.008, css(col, 0.9), () => { path(); ctx.fill(); });
        const g = ctx.createLinearGradient(0, top, 0, F.y1); g.addColorStop(0, css(mix(col, VL.cream, 0.18))); g.addColorStop(0.5, css(col)); g.addColorStop(1, css(mix(col, VL.moss, 0.6)));
        path(); ctx.fillStyle = g; ctx.fill();
      }
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx);   // a scene object
      if (p.shadow > 0) blurred(ctx, size * 0.05, css(mix(VL.night, ground, 0.3), 0.55 * p.shadow), () => { ctx.beginPath(); ctx.ellipse(cx + size * 0.18 * p.shadow, cy + size * 0.48, size * (0.32 + 0.25 * p.shadow), size * 0.07, 0, 0, TAU); ctx.fill(); });
      if (p.fuzz > 0) blurred(ctx, size * 0.025 * (0.4 + p.fuzz), css(body, 0.85 * p.fuzz), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size * 1.01));
      const x = workLike(ctx, "velvet");
      placeShape(x, S, body, cx, cy, size);
      if (p.check > 0) {   // a soft check in a deeper tone of the body, kept to the figure
        x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, 0.95 * p.check); x.fillStyle = css(mix(body, VL.ink, 0.62));
        const c = size * 0.11; x.translate(cx, cy); x.rotate(0.2);
        for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) if ((i + j) % 2 === 0) x.fillRect(i * c, j * c, c, c);
        x.restore();
      }
      bevel(x, S, cx, cy, size, size * 0.012, mix(body, VL.cream, 0.7), mix(body, VL.night, 0.7), p.volume);
      if (p.volume > 0) { x.save(); x.globalCompositeOperation = "source-atop"; const hl = x.createRadialGradient(cx - size * 0.15, cy - size * 0.22, 0, cx - size * 0.15, cy - size * 0.22, size * 0.45); hl.addColorStop(0, css(VL.cream, 0.4 * p.volume)); hl.addColorStop(1, css(VL.cream, 0)); x.fillStyle = hl; x.fillRect(0, 0, w, h); x.restore(); }
      layDown(ctx, x);
    }
    avGlow(ctx, p.bloom * 0.6);
    return true;
  },
  /** Quilted velvet: stitched lines on the slant both ways, a tuft where they cross. */
  gridLines(ctx, env, color) {
    const { w, h } = env, g = 110, a = Math.PI / 4, n = [-Math.sin(a), Math.cos(a)], m = [Math.sin(a), Math.cos(a)], k = Math.ceil(Math.hypot(w, h) / g);
    gridPen(ctx, color);
    ctx.setLineDash([12, 9]); slantPath(ctx, w, h, a, g); slantPath(ctx, w, h, -a, g); ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) { const x = w / 2 + (i * n[0] + j * m[0]) * g, y = h / 2 + (i * n[1] + j * m[1]) * g; if (x > -9 && x < w + 9 && y > -9 && y < h + 9) { ctx.moveTo(x + 5, y); ctx.arc(x, y, 5, 0, TAU); } }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css(VL.green), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a green velvet lawn
  /** Cream letters standing up off the page on a soft shadow (the shadow slider); highlighted words in the object colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), k = o.unit || 1, hi = o.hi || vlBody(o.C || VL.red), ink = o.fill || VL.cream;
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = css(VL.night, 0.55); ctx.shadowBlur = fs * 0.1 * s * k; ctx.shadowOffsetX = fs * 0.025 * s * k; ctx.shadowOffsetY = fs * 0.06 * s * k; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: VL.ink, light: VL.cream, mid: mix(VL.peri, VL.cream, 0.5), dark: VL.moss, colour: (c) => boost(c, 0.5) }, stroke: { ink: VL.ink, light: VL.cream }, line: 0.6 })),
  sticker: painters({ line: null, tone: inkAs(VL.ink, (c) => boost(c, 0.5)), shadow(ctx, draw) { ctx.save(); ctx.translate(5, 9); draw(css(VL.night, 0.35)); ctx.restore(); } }),
  /** The corner tag: a plush red pill with cream letters. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(VL.night, 0.45); ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(VL.red); ctx.fill(); ctx.restore();
    ctx.fillStyle = ink || css(VL.cream); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  frame() {},
  image(ctx, C, unit) { ctx.shadowColor = css(VL.night, 0.4); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 4 * unit; ctx.shadowOffsetY = 10 * unit; },
  /** Grain like velvet pile, twice over, and a soft vignette. */
  post(ctx, w, h, C, p, unit = 1) {
    grain(ctx, p.grain * 0.75, unit);
    if (p.grain > 0.5) grain(ctx, (p.grain - 0.5) * 0.8, unit * 0.6);
    vignette(ctx, w, h, VL.night, 0.7 * p.vignette, 0.4);
  },
  prompt: `Stickers for a soft flocked 3D illustration — plush, playful and fashionable — that read at a glance:
- one rounded, characterful object per sticker (a handbag, a shoe, a gift box, a flower, sunglasses, a heart, a little creature), chunky and soft; no realism, no fine detail;
- flat colour only in strong, sweet colours: the main colour, acid green ("yellow" comes out green), red, pink ("white" is cream); "ink" for small dark details;
- the app adds a soft shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Plush objects, built as simple soft models from a few boxes and cylinders — a handbag, a gift box, a shoe, a stool, a lamp; rounded and chunky, no realism, no fine detail.
- the renderer paints faces in soft velvety tones: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep moss green, and "main" the channel colour made vivid — use it for one to three parts.`,
};

// ====================================================================== rave: the psychedelic party poster
// Club and festival posters: a dark violet night; liquid shapes of iridescent chrome; a figure in a
// holographic sheen with an eclipse halo behind; nebulae and stars; a neon perspective grid; an arch
// lined with plus marks; glass bubbles; orbits; a red-and-cyan fringe.
const RV = { night: [12, 6, 24], pink: [255, 40, 160], cyan: [40, 230, 255], violet: [140, 60, 255], white: [255, 250, 255] };
/** Where the figure stands: toward the open field's far side, as tall as the slider says. */
function rvPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
/** A liquid blob: a smooth closed form of wandering radius, its iridescent sheen, a glow behind it, glossy highlights. */
function liquidBlob(ctx, cx, cy, R, k, a) {
  const pts = [];
  for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU, r = R * (0.6 + 0.55 * rand(k + i * 1.7)); pts.push([cx + Math.cos(t) * r * 1.25, cy + Math.sin(t) * r * 0.85]); }
  const path = () => { ctx.beginPath(); for (let i = 0; i <= pts.length; i++) { const p0 = pts[i % pts.length], p1 = pts[(i + 1) % pts.length], m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]; i ? ctx.quadraticCurveTo(p0[0], p0[1], m[0], m[1]) : ctx.moveTo(m[0], m[1]); } ctx.closePath(); };
  ctx.save(); ctx.globalAlpha = a;
  blurred(ctx, R * 0.25, css(rainbow(rand(k + 30)), 0.55), () => { path(); ctx.fill(); });
  path(); ctx.fillStyle = iridescent(ctx, cx - R * 1.3, cy - R, cx + R * 1.3, cy + R, rand(k + 31)); ctx.fill();
  ctx.save(); path(); ctx.clip();
  const sh = ctx.createLinearGradient(cx, cy - R, cx, cy + R); sh.addColorStop(0, "rgba(255,255,255,0.35)"); sh.addColorStop(0.5, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(10,0,30,0.45)"); ctx.fillStyle = sh; ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) { ctx.lineWidth = R * (0.03 + 0.03 * rand(k + i + 40)); ctx.beginPath(); ctx.arc(cx - R * 0.2, cy - R * 0.1, R * (0.45 + i * 0.22), Math.PI * (1.05 + rand(k + i + 41) * 0.2), Math.PI * (1.35 + rand(k + i + 42) * 0.3)); ctx.stroke(); }
  ctx.restore(); ctx.restore();
}
const rave = {
  id: "rave",
  art: "figure",
  repaint: (c) => `a psychedelic club-night poster made from the photograph: a dark violet night, iridescent holographic chrome and liquid neon colour (${c}, hot pink, cyan, violet), glowing light, nebula clouds and stars, glossy and surreal; still the same picture, no text.`,
  about: { zh: "迷幻派对：夜店和音乐节海报的味道——深紫的夜，流动的镭射液态金属，频道图形变成一层全息彩光的身影，身后一轮日食光环；可加星云与星星、合成波霓虹网格地面、带十字标记的拱门、玻璃泡泡、环绕的光轨和红青色差。迷幻、发光、超现实——适合音乐、派对、电子、潮流、夜生活和科幻内容。只有暗夜底；自带平直的版式。", en: "Rave: club-night and festival posters — a deep violet night, flowing liquid iridescent chrome, the channel graphic as a figure in a holographic sheen with an eclipse halo behind; nebulae and stars, a neon synthwave grid floor, an arch lined with plus marks, glass bubbles, orbits and a red-and-cyan fringe if you like. Psychedelic, glowing, surreal — for music, parties, electronic, fashion, nightlife and sci-fi. Night ground only; flat layouts of its own." },
  name: { zh: "迷幻派对", en: "Psychedelic rave" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "全息身影", en: "Holographic figure" }, liquid: { zh: "液态镭射", en: "Liquid chrome" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "全息身影", en: "Holographic figure" } },
    { key: "liquid", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "液态镭射", en: "Liquid chrome" } },
    { key: "halo", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "日食光环", en: "Eclipse halo" } },
    { key: "nebula", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "星云", en: "Nebula" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "霓虹网格", en: "Neon grid" } },
    { key: "arch", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "拱门", en: "Arch" } },
    { key: "bubbles", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "玻璃泡泡", en: "Bubbles" } },
    { key: "rings", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "光轨", en: "Orbits" } },
    { key: "fringe", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "色差", en: "Colour fringe" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "辉光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "颗粒", en: "Grain" } },
    { key: "neon", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片霓虹热感", en: "Photo in neon heat" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(RV.night), text: css(RV.white), dim: css(RV.white, 0.6), titleFill: css(RV.white), titleInk: css(RV.night), grid: () => css(mix(RV.violet, RV.pink, 0.5), 0.22) }),
  /**
   * The night; nebulae and stars; the grid floor; the arch with its plus marks; the eclipse halo; liquid
   * blobs; the holographic figure; orbits and bubbles; then the fringe and the glow over all of it. A
   * photo is mapped by lightness onto neon heat colours (violet, magenta, orange, a pale cyan white).
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = rvPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, spot = boost(C, 0.7);
    if (L.ground !== false) { ctx.fillStyle = css(RV.night); ctx.fillRect(0, 0, w, h); }
    const after = () => { if (p.fringe > 0) wherePainted(ctx, (c) => rgbFringe(c, u * 0.006 * p.fringe), L.base === "clear"); if (p.bloom > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "rvGlow"), 16, "rvSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.6 * p.bloom; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); } };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, RV.night], [0.3, [90, 20, 150]], [0.55, RV.pink], [0.78, [255, 160, 50]], [1, [210, 255, 250]]], 0.1), p.neon);
      if (L.fill) after();
      return true;
    }
    if (!L.grid) return true;
    if (p.figure > 0 || p.arch > 0 || p.halo > 0 || p.rings > 0) [at.cx, at.cy] = objAt("figure", at.cx, at.cy, ctx);   // the figure, and the arch, eclipse, orbits and floor's vanishing point round it: a scene object
    if (p.nebula > 0) {
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (let k = 0; k < 5; k++) { const x = rand(k * 3.1 + 1700) * w, y = rand(k * 4.3 + 1701) * h, r = u * (0.3 + rand(k * 5.7 + 1702) * 0.5), c = [RV.violet, RV.pink, [30, 120, 255], spot, [40, 200, 200]][k], g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(c, 0.32 * p.nebula)); g.addColorStop(1, css(c, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
      ctx.restore();
      for (let k = 0, n = Math.round(160 * p.nebula); k < n; k++) { ctx.fillStyle = css(RV.white, 0.3 + 0.7 * rand(k * 2.3 + 1703)); ctx.beginPath(); ctx.arc(rand(k * 3.1 + 1704) * w, rand(k * 4.7 + 1705) * h, 0.6 + rand(k * 5.9 + 1706) ** 3 * 2.4, 0, TAU); ctx.fill(); }
    }
    if (p.grid > 0) {   // a neon floor running to a vanishing point on the horizon
      const hz = F.y0 + fh * (0.66 - 0.12 * p.grid), vx = at.cx, a = Math.min(1, p.grid * 2.5);
      ctx.save(); ctx.strokeStyle = css(RV.pink, 0.85 * a); ctx.lineWidth = 2; ctx.shadowColor = css(RV.pink); ctx.shadowBlur = 10;
      for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(vx, hz); ctx.lineTo(vx + i * fw * 0.16, F.y1 + fh * 0.4); ctx.stroke(); }
      for (let j = 1; j <= 12; j++) { const t = (j / 12) ** 2.2, y = hz + (F.y1 - hz) * t; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.restore();
      const g = ctx.createLinearGradient(0, hz - fh * 0.2, 0, hz); g.addColorStop(0, css(RV.pink, 0)); g.addColorStop(1, css(RV.pink, 0.35 * a)); ctx.fillStyle = g; ctx.fillRect(0, hz - fh * 0.2, w, fh * 0.2);
    }
    if (p.arch > 0) {   // an arch round the figure, plus marks down both sides of it
      const aw = at.size * (0.9 + 0.3 * p.arch), ah = Math.min(fh * 0.92, at.size * 1.35), ax = at.cx - aw / 2, ay = F.y0 + (fh - ah) / 2, a = Math.min(1, p.arch * 3);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = css(RV.violet); ctx.lineWidth = 4; ctx.shadowColor = css(RV.violet); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax, ay + aw / 2); ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = css(RV.pink); ctx.lineWidth = 2.5;
      for (let y = ay + aw / 2; y < ay + ah; y += 34) for (const x of [ax - 28, ax + aw + 28]) { ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke(); }
      ctx.restore();
    }
    if (p.halo > 0) {   // an eclipse behind the head: a glowing rim, a black disc
      const r = at.size * (0.2 + 0.18 * p.halo), hx = at.cx, hy = at.cy - at.size * 0.22;
      blurred(ctx, r * 0.25, css(mix(RV.white, spot, 0.3), Math.min(1, p.halo * 2)), () => { ctx.beginPath(); ctx.arc(hx, hy, r * 1.04, 0, TAU); ctx.fill(); });
      ctx.fillStyle = css([4, 2, 10]); ctx.beginPath(); ctx.arc(hx, hy, r, 0, TAU); ctx.fill();
    }
    ctx.save(); if (p.liquid > 0) shift("liquid", F.x0 + fw * 0.65, F.y0 + fh * 0.4, ctx);   // the blobs of liquid chrome move as one: a scene object
    for (let k = 0, n = p.liquid * 4; k < Math.ceil(n); k++) liquidBlob(ctx, F.x0 + fw * (0.35 + rand(k * 3.3 + 1710) * 0.6), F.y0 + fh * (0.15 + rand(k * 4.1 + 1711) * 0.7), u * (0.08 + 0.1 * rand(k * 5.3 + 1712)) * (0.6 + 0.6 * p.liquid), k * 13.7 + 1713, clamp(n - k));
    ctx.restore();
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { cx, cy, size } = at, x = workLike(ctx, "rave");
      blurred(ctx, size * 0.05, css(RV.cyan, 0.45), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in"; x.fillStyle = iridescent(x, cx - size * 0.5, cy - size * 0.5, cx + size * 0.5, cy + size * 0.5, rand(1720)); x.fillRect(0, 0, w, h);
      bevel(x, S, cx, cy, size, size * 0.01, RV.white, [30, 0, 60], 0.9);
      layDown(ctx, x);
    }
    for (let k = 0, n = p.rings * 3; k < Math.ceil(n); k++) {
      ctx.save(); ctx.globalAlpha = clamp(n - k) * 0.8; ctx.translate(at.cx, at.cy + at.size * 0.05); ctx.rotate(-0.35 + k * 0.28); ctx.strokeStyle = css(k === 1 ? spot : RV.white); ctx.lineWidth = 2; ctx.setLineDash(k === 2 ? [6, 9] : []);
      ctx.beginPath(); ctx.ellipse(0, 0, at.size * (0.55 + k * 0.12), at.size * (0.13 + k * 0.03), 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    for (let k = 0, n = p.bubbles * 8; k < Math.ceil(n); k++) glassBubble(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1730) * 0.68), F.y0 + fh * (0.08 + rand(k * 3.7 + 1731) * 0.84), u * (0.025 + rand(k * 4.9 + 1732) ** 2 * 0.08), mix(RV.cyan, spot, 0.4), clamp(n - k));
    after();
    return true;
  },
  /** A honeycomb, 48 a side. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 48, dx = s * 1.5, dy = s * Math.sqrt(3);
    gridPen(ctx, color); ctx.beginPath();
    for (let i = 0, x = 0; x < w + s; i++, x += dx) for (let y = ((i % 2) * dy) / 2; y < h + dy; y += dy) {
      for (let k = 0; k <= 6; k++) { const t = (k * Math.PI) / 3; k ? ctx.lineTo(x + Math.cos(t) * s, y + Math.sin(t) * s) : ctx.moveTo(x + s, y); }
    }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css([24, 12, 44]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny, C) { ctx.lineCap = "butt"; ctx.strokeStyle = css(boost(C || RV.pink, 0.7)); ctx.lineWidth = 4; run(0, 0); } },
  /** White capitals in a neon glow of the channel colour (the shadow slider); highlighted words in a holographic sheen. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, spot = boost(o.C || RV.pink, 0.7), glow = Math.min(2, o.shadowAmt), ink = o.fill || RV.white;
    const fillOf = (a, x) => (a.hi ? (o.hi ? css(o.hi) : iridescent(ctx, a.run ? a.run.x0 : x, -fs, a.run ? a.run.x1 : x + ctx.measureText(a.t).width, 0, 0.8)) : css(ink));   // across the whole run
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(spot, 0.9); ctx.shadowBlur = fs * 0.18 * glow * k; pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); });
  },
  // on the dark block the small parts' ink turns white
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: RV.white }, stroke: { ink: RV.white } } : { fill: { ink: [30, 10, 50], light: RV.white, mid: [180, 140, 255], dark: [60, 20, 100] }, stroke: { ink: RV.white, light: RV.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow(ctx, draw, fill) { ctx.save(); ctx.globalAlpha = 0.7; ctx.shadowColor = fill; ctx.shadowBlur = 20; draw(fill); ctx.restore(); } }),
  /** The corner tag: a neon outline pill, white lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62, spot = boost(C, 0.7);
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(spot); ctx.shadowBlur = 12; ctx.strokeStyle = css(spot); ctx.lineWidth = 3; ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.stroke(); ctx.restore();
    ctx.fillStyle = ink || css(RV.white); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: plus marks in the four corners. */
  frame(ctx, env) {
    const { w, h } = env;
    ctx.save(); ctx.strokeStyle = css(RV.white, 0.7); ctx.lineWidth = 2;
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) { ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(boost(C, 0.7), 0.7); ctx.shadowBlur = 24 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Glowing stickers for a psychedelic club-night poster — bold, shiny and surreal — that read at a glance:
- one clear, iconic object per sticker (a planet, a record, a disco ball, a butterfly, an eye, a flower, a lightning bolt, a crystal), simple; no realism, no fine detail;
- flat colour only in neon: the main colour, hot pink ("red"), cyan ("blue"), violet, with "white" for highlights;
- the app adds a soft neon glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects for a club night, built as simple models from a few boxes and cylinders — a speaker stack, a DJ deck, a light tower, a podium; no realism, no fine detail.
- the renderer paints faces in deep violet and pale neon tones: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep violet, and "main" a pale lavender.`,
};

// ====================================================================== chrome: liquid metal on black, the Y2K cyber poster
// Black (or a cool grey) with a monochrome photograph; the figure turned to liquid chrome, melting into
// drips; a holographic rainbow streak across it; a wireframe sphere and grid; RGB glitch slices; glass
// bubbles; HUD boxes, brackets and status lines; outlined stencil letters; creased paper, grain.
const CR = { black: [10, 10, 12], grey: [208, 208, 206], white: [238, 238, 236], ink: [34, 34, 38] };
const crGround = () => (dark ? CR.black : CR.grey), crInk = () => (dark ? CR.white : CR.ink);   // the grey ground's ink is just off the house ink, so the small parts' ink can be swapped alone
/**
 * A chrome gradient between (x0, y0) and (x1, y1): bands of sky, horizon and ground as polished metal
 * reflects them — each light band falling off softly, then cut hard by the next dark one, as a horizon is.
 */
function chromeFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  [[0, [252, 253, 255]], [0.2, [168, 176, 192]], [0.215, [16, 18, 26]], [0.36, [92, 98, 114]], [0.375, [236, 240, 250]], [0.52, [130, 136, 152]], [0.535, [10, 12, 18]], [0.7, [70, 74, 88]], [0.715, [214, 220, 232]], [0.86, [120, 126, 140]], [0.875, [26, 28, 36]], [1, [84, 88, 100]]].forEach(([t, c]) => g.addColorStop(t, css(c)));
  return g;
}
/** Where the chrome figure stands. */
function crPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.64, cy: F.y0 + fh * 0.5, size };
}
const chrome = {
  id: "chrome",
  art: "figure",
  repaint: (c) => `a dark Y2K cyber poster made from the photograph: black-and-white with liquid chrome reflections, a holographic rainbow streak, glitch slices and fine scan lines, creased paper and grain, with one accent of ${c}; still the same picture, no text.`,
  about: { zh: "液态铬：黑底上的 Y2K 赛博海报——频道图形变成一尊液态金属，往下熔成一滴滴铬液，一道全息彩虹光横扫过去；身后线框球体和网格，几条 RGB 故障切片，玻璃泡泡，HUD 式的界面框、角标和状态小字，描边的镂空大字；皱纸和颗粒。冷、锐利、未来感——适合科技、AI、电子音乐、潮流、游戏和观点类内容。可选黑底或冷灰底；自带平直的版式。", en: "Liquid chrome: the dark Y2K cyber poster — the channel graphic as a figure of liquid metal melting into drips, a holographic rainbow streak across it; a wireframe sphere and grid behind, RGB glitch slices, glass bubbles, HUD frames, brackets and status lines, outlined stencil letters; creased paper and grain. Cold, sharp, futuristic — for tech, AI, electronic music, fashion, games and opinion. A black or a cool grey ground; flat layouts of its own." },
  name: { zh: "液态铬", en: "Liquid chrome" },
  seeded: true,
  scene: { figure: { zh: "铬身影", en: "Chrome figure" }, wire: { zh: "线框", en: "Wireframe" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "铬身影", en: "Chrome figure" } },
    { key: "drips", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "熔滴", en: "Drips" } },
    { key: "holo", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "全息彩光", en: "Holographic streak" } },
    { key: "wire", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "线框", en: "Wireframe" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "故障切片", en: "Glitch slices" } },
    { key: "hud", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "界面框", en: "HUD frames" } },
    { key: "bubbles", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "玻璃泡泡", en: "Bubbles" } },
    { key: "echo", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "描边大字", en: "Outlined letters" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "皱纸", en: "Creased paper" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "颗粒", en: "Grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(crGround()), text: css(crInk()), dim: css(crInk(), 0.6), titleFill: css(crInk()), titleInk: css(crGround()), grid: () => css(crInk(), 0.12) }),
  /**
   * The ground; outlined letters; the wireframe; the chrome figure with its drips (on a work canvas:
   * the chrome bands, then the bevel); the holographic streak; bubbles; glitch slices over all of it.
   * A photo goes black and white with more contrast, and is sliced too when it fills the canvas.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = crPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, ink = crInk();
    if (L.ground !== false) { ctx.fillStyle = css(crGround()); ctx.fillRect(0, 0, w, h); }
    const slices = () => {
      if (p.glitch <= 0 || !canPaint(ctx)) return;
      const src = snap(ctx, "crSnap"), m = ctx.getTransform(), k = m.a;
      for (let i = 0, n = Math.round(2 + 8 * p.glitch); i < n; i++) {
        const y = F.y0 + fh * rand(i * 2.7 + 1800), bh = u * (0.006 + rand(i * 3.3 + 1801) * 0.03), dx = (rand(i * 4.1 + 1802) - 0.5) * u * 0.12 * p.glitch;
        inPixels(ctx, () => ctx.drawImage(src, 0, m.f + y * k, src.width, bh * k, dx * k, m.f + y * k, src.width, bh * k));
        if (rand(i * 5.3 + 1803) > 0.55) { ctx.fillStyle = css([[255, 40, 80], [40, 220, 255], [80, 255, 120], boost(C, 0.7)][i % 4], 0.85); ctx.fillRect(F.x0 + fw * rand(i * 6.1 + 1804), y, fw * (0.05 + rand(i + 1805) * 0.2), bh * 0.6); }
      }
    };
    if (env.photo) {
      env.drawPhoto(p.mono);
      mapTones(ctx, toneTable([[0, [0, 0, 0]], [0.45, [110, 110, 112]], [1, [248, 248, 248]]], 0.1), p.mono * 0.6);
      if (L.fill) slices();
      return true;
    }
    if (!L.grid) return true;
    if (p.echo > 0) {   // the channel's code, huge, outlined, stood on end down the far side, twice
      const str = (env.cat.code || env.cat.name || "").toUpperCase().slice(0, 8);
      if (str) {
        ctx.save(); ctx.font = `900 ${fh * 0.16}px ${fonts.en}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.strokeStyle = css(ink, 0.55 * Math.min(1, p.echo * 2)); ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate(F.x1 - fh * (0.05 + i * 0.13), F.y0 + 20); ctx.rotate(Math.PI / 2); if (i === 0 || p.echo > 0.5) ctx.strokeText(str, 0, 0); ctx.restore(); }
        ctx.restore();
      }
    }
    if (p.wire > 0) {   // a wireframe sphere behind the figure, and a square of grid
      const r = at.size * (0.35 + 0.2 * p.wire), sx = at.cx - at.size * 0.3, sy = at.cy - at.size * 0.15, a = Math.min(1, p.wire * 2.5);
      ctx.save(); ctx.strokeStyle = css(ink, 0.45 * a); ctx.lineWidth = 1.2;
      shift("wire", sx, sy, ctx);   // the sphere and the square of grid: a scene object
      for (let i = 1; i < 8; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 8; ctx.beginPath(); ctx.ellipse(sx, sy + Math.sin(t) * r, Math.cos(t) * r, Math.cos(t) * r * 0.22, 0, 0, TAU); ctx.stroke(); }
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(sx, sy, Math.abs(Math.cos((i * Math.PI) / 8)) * r, r, 0, 0, TAU); ctx.stroke(); }
      const gx = at.cx + at.size * 0.2, gy = F.y0 + fh * 0.12, gs = at.size * 0.5 * p.wire;
      for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(gx + (gs * i) / 10, gy); ctx.lineTo(gx + (gs * i) / 10, gy + gs); ctx.moveTo(gx, gy + (gs * i) / 10); ctx.lineTo(gx + gs, gy + (gs * i) / 10); ctx.stroke(); }
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx), x = workLike(ctx, "chrome");   // a scene object
      if (dark) blurred(ctx, size * 0.06, "rgba(220,230,255,0.18)", () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      if (p.drips > 0) {   // drips from the lowest edge of the shape, read off a coarse grid of it
        const cell = size / 40, x0 = cx - size, y0 = cy - size * 0.6, cols = 80, rows = 50, cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
        for (let k = 0, n = Math.round(4 + 14 * p.drips); k < n; k++) {
          const i = Math.floor(rand(k * 2.3 + 1810) * cols);
          let j = rows - 1; while (j >= 0 && cov[j * cols + i] < 160) j--;
          if (j < 0) continue;
          const dx = x0 + (i + 0.5) * cell, dy = y0 + (j + 0.4) * cell, len = size * (0.05 + rand(k * 3.7 + 1811) * 0.35) * p.drips, dw = cell * (0.8 + rand(k * 4.3 + 1812) * 1.2);
          x.beginPath(); rounded(x, dx - dw / 2, dy - cell, dw, len + cell, dw / 2); x.fillStyle = "#fff"; x.fill();
          x.beginPath(); x.arc(dx, dy + len, dw * 0.7, 0, TAU); x.fill();
        }
      }
      x.globalCompositeOperation = "source-in"; x.fillStyle = chromeFill(x, cx - size * 0.25, cy - size * 0.55, cx + size * 0.15, cy + size * 0.75); x.fillRect(0, 0, w, h);
      bevel(x, S, cx, cy, size, size * 0.008, [255, 255, 255], [0, 0, 0], 0.35);
      x.save(); x.globalCompositeOperation = "source-atop"; x.strokeStyle = "rgba(255,255,255,0.85)"; x.lineCap = "round";   // two specular streaks
      for (const [o, lw] of [[-0.18, 0.035], [0.12, 0.018]]) { x.lineWidth = size * lw; x.beginPath(); x.moveTo(cx - size * 0.6, cy + size * (o - 0.25)); x.quadraticCurveTo(cx, cy + size * (o + 0.05), cx + size * 0.6, cy + size * (o - 0.3)); x.stroke(); }
      x.restore();
      if (p.holo > 0) {   // a rainbow streak smeared across the head
        x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.75 * p.holo;
        x.fillStyle = iridescent(x, cx - size * 0.5, 0, cx + size * 0.5, 0, 0.9); x.fillRect(cx - size, cy - size * 0.3, size * 2, size * 0.12 * (0.5 + p.holo)); x.restore();
      }
      layDown(ctx, x);
      if (p.holo > 0) {   // and its glow trailing off the figure
        const y = cy - size * 0.3 + size * 0.06 * (0.5 + p.holo);
        ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply"; ctx.globalAlpha = 0.6 * p.holo;
        ctx.fillStyle = iridescent(ctx, cx - size * 1.1, 0, cx + size * 0.4, 0, 0.3); ctx.beginPath(); ctx.ellipse(cx - size * 0.35, y, size * 0.75, size * 0.035 * (0.6 + p.holo), 0, 0, TAU); ctx.fill(); ctx.restore();
      }
    }
    for (let k = 0, n = p.bubbles * 6; k < Math.ceil(n); k++) glassBubble(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1820) * 0.68), F.y0 + fh * (0.1 + rand(k * 3.7 + 1821) * 0.8), u * (0.03 + rand(k * 4.9 + 1822) ** 2 * 0.09), dark ? [200, 210, 230] : [120, 130, 150], clamp(n - k));
    slices();
    return true;
  },
  /** A Y2K wireframe room: frames closing in on the centre in perspective, and lines running into it from the edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2, n = 8, inner = 0.12;
    gridPen(ctx, color); ctx.beginPath();
    for (const k of [1, 0.62, 0.4, 0.27, 0.18, inner]) ctx.rect(cx - (w / 2) * k, cy - (h / 2) * k, w * k, h * k);
    for (let i = 0; i <= n; i++) for (const [ex, ey] of [[i / n, 0], [i / n, 1], [0, i / n], [1, i / n]]) { const x = ex * w, y = ey * h; ctx.moveTo(x, y); ctx.lineTo(cx + (x - cx) * inner, cy + (y - cy) * inner); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? [20, 20, 24] : [24, 24, 28]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(CR.white, 0.6); ctx.lineWidth = 1.5; run(0, 0); } },
  /** Capitals in polished chrome (on the grey ground, dark steel), a soft dark shadow under them (the shadow slider); highlighted words in a holographic sheen. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, glow = Math.min(2, o.shadowAmt);
    // type chrome keeps to the light half of the bands (no near-black stripe to break a letter on the black ground); on the grey ground, dark steel
    const g = ctx.createLinearGradient(0, -fs * 0.9, 0, fs * 0.1), stops = dark ? [[0, [255, 255, 255]], [0.42, [196, 204, 218]], [0.5, [128, 134, 150]], [0.6, [238, 242, 250]], [1, [168, 174, 190]]] : [[0, [86, 88, 96]], [0.45, [40, 40, 46]], [0.55, [110, 112, 120]], [1, [52, 54, 60]]];
    stops.forEach(([t, c]) => g.addColorStop(t, css(c)));
    const body = o.fill ? css(o.fill) : g;
    const fillOf = (a, x) => (a.hi ? (o.hi ? css(o.hi) : iridescent(ctx, a.run ? a.run.x0 : x, -fs, a.run ? a.run.x1 : x + ctx.measureText(a.t).width, 0, 0.1)) : body);   // across the whole run
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.35)"; ctx.shadowBlur = fs * 0.12 * glow * k; pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: CR.white }, stroke: { ink: CR.white } } : { fill: { ink: [16, 16, 18], light: CR.white, mid: [150, 152, 158], dark: [50, 52, 58], colour: (c) => grey(c) }, stroke: { ink: CR.white, light: CR.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "colour" ? css(grey(c), c[3]) : fill; } }),
  /** The corner tag: monospaced capitals between HUD brackets. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.52, col = css(crInk());
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 2, top = y + (fs * 1.34 - h), t = f * 0.5;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (const [cx, cy, sx, sy] of [[x, top, 1, 1], [x + w, top, -1, 1], [x, top + h, 1, -1], [x + w, top + h, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx, cy + sy * t); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * t, cy); ctx.stroke(); }
    ctx.fillStyle = ink || col; spaced(ctx, str, x + f, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a dashed border, brackets round the figure, a status box with small print, a barcode. */
  frame(ctx, env, p) {
    const a = p.hud;
    if (a <= 0) return;
    const { w, h } = env, at = crPlace(env, p), ink = crInk(), u = Math.min(w, h), i = env.o.catIndex;
    ctx.save(); ctx.strokeStyle = css(ink, 0.5 * a); ctx.fillStyle = css(ink, 0.8 * a); ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]); ctx.strokeRect(24, 24, w - 48, h - 48); ctx.setLineDash([]);
    const bw = at.size * 0.62, bh = at.size * 0.62, t = u * 0.025;
    for (const [cx, cy, sx, sy] of [[at.cx - bw, at.cy - bh, 1, 1], [at.cx + bw, at.cy - bh, -1, 1], [at.cx - bw, at.cy + bh, 1, -1], [at.cx + bw, at.cy + bh, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx, cy + sy * t); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * t, cy); ctx.stroke(); }
    if (a > 0.3) {
      const bx = w - 72 - u * 0.24, by = 92;
      ctx.globalAlpha = Math.min(1, (a - 0.3) * 3); ctx.beginPath(); rounded(ctx, bx, by, u * 0.24, u * 0.1, 10); ctx.stroke();
      ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(`STATUS: ${pad2(i + 1)}`, bx + 14, by + 26);
      greeked(ctx, bx + 14, by + 38, u * 0.24 - 28, 3, 10, css(ink, 0.5 * a), 1830 + i);
      ctx.fillStyle = css(ink, 0.8 * a); for (let at2 = 72, k = 0; at2 < 72 + u * 0.12; k++) { const bw2 = 1 + Math.floor(rand(k * 1.7 + 1831) * 3); ctx.fillRect(at2, h - 74, bw2, 26); at2 += bw2 + 1 + Math.floor(rand(k * 2.3 + 1832) * 3); }
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { crumple(ctx, w, h, p.paper * 0.8); grain(ctx, p.grain * 0.7, unit); },
  prompt: `Shiny objects for a dark Y2K cyber poster — sleek, liquid and futuristic — that read at a glance:
- one clear object per sticker (a heart, a star, a butterfly, a rose, a cross, a lightning bolt, a pair of wings, a cube), smooth and simple; no realism, no fine detail;
- flat colour only in greys: "white", light greys, "ink" for dark parts, the main colour (it comes out grey) — the app renders them as chrome;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a Y2K cyber poster would show them: a few boxes and cylinders, sleek and exact — a phone, a speaker, a server tower, a camera; no realism, no fine detail.
- the renderer paints faces in greys and white: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a mid grey.`,
};

// ====================================================================== net art: the glitch poster of an old operating system
// Net art and glitch posters: dialog windows of an old operating system piling up, pixel-sorted streaks,
// datamoshed blocks, rows of garbled characters, the grey checkerboard of transparency, test-pattern
// colour bars, arrow cursors; the figure dithered into black pixels; selected words in a navy box.
const NA = { white: [246, 246, 244], black: [10, 10, 12], silver: [192, 192, 192], navy: [0, 0, 128], blue: [16, 132, 208], light: [255, 255, 255], shade: [128, 128, 128], deep: [64, 64, 64], ink: [26, 26, 30] };
const naGround = () => (dark ? NA.black : NA.white), naInk = () => (dark ? NA.white : NA.ink);
const ASCII = "x√ÛH8EC#%&@$*+=<>/\\|{}[]~^ÆØ¥§¶01¿ßµ";
/** A dialog window of an old operating system: bevelled grey body, a navy title bar with a close box, then by `kind` a warning, a progress bar or a checkerboard picture, greeked lines and a button. */
function osWindow(ctx, x, y, w, h, kind, k, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(NA.silver); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = css(NA.light); ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = css(NA.deep); ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  const tb = 24, g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, css(NA.navy)); g.addColorStop(1, css(NA.blue));
  ctx.fillStyle = g; ctx.fillRect(x + 4, y + 4, w - 8, tb);
  greeked(ctx, x + 12, y + 12, w * 0.45, 1, 10, css(NA.light, 0.9), k);
  const cb = tb - 6, cx = x + w - 8 - cb, cy = y + 7;
  ctx.fillStyle = css(NA.silver); ctx.fillRect(cx, cy, cb, cb); ctx.strokeStyle = css(NA.ink); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx + cb - 4, cy + cb - 4); ctx.moveTo(cx + cb - 4, cy + 4); ctx.lineTo(cx + 4, cy + cb - 4); ctx.stroke();
  const bx = x + 14, by = y + tb + 16, bw = w - 28;
  if (kind === 0) {   // a warning: a yellow triangle with a mark, some lines, an OK button
    ctx.fillStyle = "#ffd400"; ctx.beginPath(); ctx.moveTo(bx + 18, by); ctx.lineTo(bx + 36, by + 32); ctx.lineTo(bx, by + 32); ctx.closePath(); ctx.fill(); ctx.strokeStyle = css(NA.ink); ctx.stroke();
    ctx.fillStyle = css(NA.ink); ctx.fillRect(bx + 16.5, by + 10, 3, 12); ctx.fillRect(bx + 16.5, by + 25, 3, 3);
    greeked(ctx, bx + 50, by + 4, bw - 50, 2, 12, css(NA.ink, 0.8), k + 1);
  } else if (kind === 1) {   // a progress bar filling with blocks
    greeked(ctx, bx, by, bw, 1, 12, css(NA.ink, 0.8), k + 2);
    const py = by + 22; ctx.fillStyle = css(NA.light); ctx.fillRect(bx, py, bw, 20); ctx.strokeStyle = css(NA.shade); ctx.strokeRect(bx, py, bw, 20);
    ctx.fillStyle = css(NA.navy); for (let i = 0, n = Math.floor(((bw - 6) / 14) * (0.3 + 0.6 * rand(k + 3))); i < n; i++) ctx.fillRect(bx + 3 + i * 14, py + 3, 11, 14);
  } else {   // a picture that has not loaded: the checkerboard of transparency
    const ph = h - tb - 64;
    for (let i = 0; i * 10 < bw; i++) for (let j = 0; j * 10 < ph; j++) { ctx.fillStyle = (i + j) % 2 ? "#d8d8d8" : "#ffffff"; ctx.fillRect(bx + i * 10, by + j * 10, Math.min(10, bw - i * 10), Math.min(10, ph - j * 10)); }
  }
  const okw = 64, okx = x + w / 2 - okw / 2, oky = y + h - 34;   // the button
  ctx.fillStyle = css(NA.silver); ctx.fillRect(okx, oky, okw, 22); ctx.fillStyle = css(NA.light); ctx.fillRect(okx, oky, okw, 2); ctx.fillRect(okx, oky, 2, 22);
  ctx.fillStyle = css(NA.deep); ctx.fillRect(okx, oky + 20, okw, 2); ctx.fillRect(okx + okw - 2, oky, 2, 22);
  ctx.fillStyle = css(NA.ink); ctx.fillRect(okx + 22, oky + 9, 20, 3);
  ctx.restore();
}
/** An arrow cursor, white with a black edge. */
function cursorArrow(ctx, x, y, s) {
  ctx.beginPath(); [[0, 0], [0, 17], [4, 13], [7, 20], [10, 19], [7, 12], [12, 12]].forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s))); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(1, s * 0.9); ctx.stroke();
}
/** A 4 × 4 ordered-dither threshold (0–1) for cell (i, j). */
const bayer = (i, j) => [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(j % 4) * 4 + (i % 4)] / 16 + 1 / 32;
/** Where the dithered figure stands. */
function naPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
const netart = {
  id: "netart",
  art: "figure",
  repaint: (c) => `a glitch net-art poster made from the photograph: pixel sorting, datamosh blocks, dithered one-bit areas, old operating-system dialog windows and a checkerboard of transparency, with ${c} as an accent; raw, digital and chaotic; no readable text.`,
  about: { zh: "故障网络：网络艺术和故障海报——老式操作系统的对话框一层层叠上来（警告、进度条、加载不出的图），像素排序拉出的长条、数据错位的方块、一行行乱码字符、透明背景的灰白棋盘格、测试图的彩条、鼠标箭头；频道图形抖动成黑色像素点阵；标题里强调的词像被选中一样，反白在藏青色的选框里。数字、粗粝、有点失控——适合科技、互联网文化、游戏、实验音乐和观点类内容。可选白底或黑底；自带平直的版式，色块是一块银灰色的系统面板。", en: "Net art: net-art and glitch posters — dialog windows of an old operating system piling up (a warning, a progress bar, a picture that will not load), pixel-sorted streaks, datamoshed blocks, rows of garbled characters, the grey checkerboard of transparency, test-pattern colour bars, arrow cursors; the channel graphic dithered into black pixels; highlighted words selected, white in a navy box. Digital, raw, slightly out of control — for tech, internet culture, games, experimental music and opinion. White or black ground; flat layouts of its own, the colour block a silver system panel." },
  name: { zh: "故障网络", en: "Glitch net art" },
  seeded: true,
  scene: { figure: { zh: "点阵身影", en: "Dithered figure" }, windows: { zh: "系统窗口", en: "Dialog windows" }, bars: { zh: "测试彩条", en: "Colour bars" }, cursors: { zh: "鼠标箭头", en: "Cursors" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点阵身影", en: "Dithered figure" } },
    { key: "windows", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "系统窗口", en: "Dialog windows" } },
    { key: "sort", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "像素排序", en: "Pixel sorting" } },
    { key: "mosh", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "数据错位", en: "Datamosh" } },
    { key: "ascii", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "乱码字符", en: "Garbled characters" } },
    { key: "checker", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "透明棋盘格", en: "Transparency checks" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "测试彩条", en: "Colour bars" } },
    { key: "cursor", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "鼠标箭头", en: "Cursors" } },
    { key: "shift", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "扫描错行", en: "Scan shift" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "dither", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "照片抖动点阵", en: "Photo dithered" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(naGround()), text: css(naInk()), dim: css(naInk(), 0.6), titleFill: css(naInk()), titleInk: css(naGround()), grid: () => css(naInk(), 0.12) }),
  /**
   * The ground; colour bars, checker patches, ASCII rows; the dithered figure; dialog windows; then,
   * working on what is there, pixel sorting, datamosh and scan shift; cursors last. A photo filling the
   * canvas is dithered (Photo dithered) and goes through the same sorting, moshing and shifting.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = naPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, spot = boost(C, 0.7), ink = naInk();
    if (L.ground !== false) { ctx.fillStyle = css(naGround()); ctx.fillRect(0, 0, w, h); }
    const damage = (box) => {
      if (!canPaint(ctx)) return;
      const m = ctx.getTransform(), k = m.a;
      if (p.sort > 0) {   // a one-pixel column stretched into a streak to the right, row band by row band
        const src = snap(ctx, "naSort");
        for (let i = 0, n = Math.round(80 * p.sort); i < n; i++) {
          const y = box.y0 + (box.y1 - box.y0) * rand(i * 1.9 + 1900), bh = 2 + rand(i * 2.7 + 1901) * 12, x0 = box.x0 + (box.x1 - box.x0) * rand(i * 3.3 + 1902), len = fw * (0.05 + rand(i * 4.1 + 1903) * 0.4) * p.sort;
          inPixels(ctx, () => ctx.drawImage(src, Math.floor(m.e + x0 * k), Math.floor(m.f + y * k), 1, Math.max(1, Math.round(bh * k)), m.e + x0 * k, m.f + y * k, len * k, Math.max(1, Math.round(bh * k))));
        }
      }
      if (p.mosh > 0) {   // blocks of the picture copied a few cells off, some tinted, some flat colour
        const src = snap(ctx, "naMosh"), cell = u * 0.035;
        for (let i = 0, n = Math.round(18 * p.mosh); i < n; i++) {
          const bw = cell * (1 + Math.floor(rand(i * 2.1 + 1910) * 3)), bh = cell * (1 + Math.floor(rand(i * 2.9 + 1911) * 2)), sx = box.x0 + (box.x1 - box.x0 - bw) * rand(i * 3.7 + 1912), sy = box.y0 + (box.y1 - box.y0 - bh) * rand(i * 4.3 + 1913);
          const dx = sx + Math.round((rand(i * 5.1 + 1914) - 0.5) * 6) * cell, dy = sy + Math.round((rand(i * 5.9 + 1915) - 0.5) * 2) * cell, kind = rand(i * 6.7 + 1916);
          if (kind < 0.2) { ctx.fillStyle = css([spot, [255, 40, 160], [40, 200, 255], [250, 210, 40]][i % 4], 0.9); ctx.fillRect(dx, dy, bw, bh); }
          else { inPixels(ctx, () => ctx.drawImage(src, m.e + sx * k, m.f + sy * k, bw * k, bh * k, m.e + dx * k, m.f + dy * k, bw * k, bh * k)); if (kind < 0.45) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix([255, 255, 255], kind < 0.3 ? spot : [60, 80, 255], 0.7)); ctx.fillRect(dx, dy, bw, bh); ctx.restore(); } }
        }
      }
      if (p.shift > 0) {   // whole bands of the picture slid sideways
        const src = snap(ctx, "naShift");
        for (let i = 0, n = Math.round(2 + 6 * p.shift); i < n; i++) { const y = h * rand(i * 2.3 + 1920), bh = u * (0.004 + rand(i * 3.1 + 1921) * 0.03), dx = (rand(i * 3.9 + 1922) - 0.5) * u * 0.15 * p.shift; inPixels(ctx, () => ctx.drawImage(src, 0, m.f + y * k, src.width, bh * k, dx * k, m.f + y * k, src.width, bh * k)); }
      }
    };
    const dither = (x0, y0, cols, rows, cell, level, a) => {   // black square pixels where the level beats the ordered threshold
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = css(ink); ctx.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (level(i, j) > bayer(i, j)) ctx.rect(x0 + i * cell, y0 + j * cell, cell + 0.4, cell + 0.4);
      ctx.fill(); ctx.restore();
    };
    if (env.photo) {
      env.drawPhoto();
      if (!L.fill) return true;
      if (p.dither > 0 && canPaint(ctx)) {
        const cell = Math.max(3, u * 0.006), cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), px = sampled(ctx, 0, 0, cols, rows, cell, "naPhoto");
        ctx.save(); ctx.globalAlpha = p.dither; ctx.fillStyle = css(naGround()); ctx.fillRect(0, 0, w, h); ctx.restore();
        dither(0, 0, cols, rows, cell, (i, j) => { const q = (j * cols + i) * 4, l = (px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) / 65280; return dark ? l : 1 - l; }, p.dither);
      }
      damage({ x0: 0, y0: 0, x1: w, y1: h });
      return true;
    }
    if (!L.grid) return true;
    if (p.bars > 0) {   // test-pattern colour bars, widening
      const bars = [[235, 235, 235], [235, 235, 16], [16, 235, 235], [16, 235, 16], [235, 16, 235], [235, 16, 16], [16, 16, 235]], bw = fw * 0.04 * (0.5 + p.bars), bx = F.x0 + fw * 0.08, by = F.y0 + fh * 0.62, bh = fh * 0.3;
      ctx.save(); shift("bars", bx + bw * 3.5, by + bh * 0.4, ctx);   // a scene object
      ctx.save(); ctx.globalAlpha = Math.min(1, p.bars * 3); bars.forEach((c, i) => { ctx.fillStyle = css(c); ctx.fillRect(bx + i * bw, by, bw, bh * (0.7 + 0.3 * (i % 2))); }); ctx.restore(); ctx.restore();
    }
    for (let k = 0, n = p.checker * 5; k < Math.ceil(n); k++) {
      const cw = u * (0.06 + rand(k * 2.7 + 1930) * 0.14), ch = cw * (0.5 + rand(k * 3.3 + 1931)), x = F.x0 + fw * (0.25 + rand(k * 4.1 + 1932) * 0.7), y = F.y0 + fh * rand(k * 4.9 + 1933) * 0.85, c = 10;
      ctx.save(); ctx.globalAlpha = clamp(n - k);
      for (let i = 0; i * c < cw; i++) for (let j = 0; j * c < ch; j++) { ctx.fillStyle = (i + j) % 2 ? (dark ? "#3a3a3a" : "#cfcfcf") : (dark ? "#1c1c1c" : "#ffffff"); ctx.fillRect(x + i * c, y + j * c, Math.min(c, cw - i * c), Math.min(c, ch - j * c)); }
      ctx.restore();
    }
    if (p.ascii > 0) {   // rows of garbled characters, a few runs of them in colour
      ctx.save(); ctx.font = `600 16px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const x0 = F.x0 + fw * 0.52, y0 = F.y0 + fh * 0.06, rows = Math.round(16 * p.ascii), cols = Math.floor((F.x1 - x0 - 30) / 10);
      for (let j = 0; j < rows; j++) { let s = ""; for (let i = 0; i < cols * (0.4 + 0.6 * rand(j * 1.3 + 1940)); i++) s += ASCII[Math.floor(rand(j * 31 + i * 1.7 + 1941) * ASCII.length)]; ctx.fillStyle = rand(j * 2.9 + 1942) > 0.8 ? css(rand(j + 1943) > 0.5 ? spot : NA.blue) : css(ink, 0.75); ctx.fillText(s, x0, y0 + j * 19); }
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the figure dithered into black pixels, lit from the upper left: a scene object
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx), cell = Math.max(3, size * 0.012), x0 = cx - size * 0.75, y0 = cy - size * 0.6, cols = Math.ceil((size * 1.5) / cell), rows = Math.ceil((size * 1.2) / cell), cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
      dither(x0, y0, cols, rows, cell, (i, j) => (cov[j * cols + i] / 255) * (0.25 + 0.75 * clamp((i / cols + j / rows) * 0.8)), 1);
    }
    ctx.save(); if (p.windows > 0) shift("windows", at.cx - at.size * 0.2, F.y0 + fh * 0.2, ctx);   // the windows move as one: a scene object
    for (let k = 0, n = p.windows * 6; k < Math.ceil(n); k++) {   // dialog windows cascading down toward the figure
      const ww = u * (0.26 + rand(k * 2.3 + 1950) * 0.1), wh = ww * (0.42 + rand(k * 3.1 + 1951) * 0.2), x = at.cx - at.size * 0.2 + k * 34 - ww * 0.5 + (rand(k * 3.9 + 1952) - 0.5) * fw * 0.25, y = F.y0 + fh * 0.08 + k * 30 + rand(k * 4.7 + 1953) * fh * 0.2;
      osWindow(ctx, clamp(x, F.x0 + 10, F.x1 - ww - 10), clamp(y, F.y0 + 10, F.y1 - wh - 10), ww, wh, k % 3, k * 17 + 1954, clamp(n - k));
    }
    ctx.restore();
    damage({ x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 });
    ctx.save(); if (p.cursor > 0) shift("cursors", F.x0 + fw * 0.62, F.y0 + fh * 0.5, ctx);   // the arrows move as one: a scene object
    for (let k = 0, n = p.cursor * 6; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); cursorArrow(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1960) * 0.65), F.y0 + fh * (0.1 + rand(k * 3.7 + 1961) * 0.8), 1.6 + rand(k + 1962) * 1.2); ctx.restore(); }
    ctx.restore();
    return true;
  },
  /** A paint program's pixel grid, zoomed in: a square point at every 24, a line round every eight. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 24;
    gridPen(ctx, color);
    gridPath(ctx, every(s * 8, w, s * 8), every(s * 8, h, s * 8), 0, 0, w, h);
    ctx.beginPath(); for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) ctx.rect(x - 2, y - 2, 4, 4); ctx.fill();
    ctx.restore();
  },
  accent: { fill: () => css(NA.silver), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(NA.light); ctx.lineWidth = 3; run(nx * 2, ny * 2); ctx.strokeStyle = css(NA.deep); ctx.lineWidth = 3; run(-nx * 2, -ny * 2); } },   // a bevelled system panel
  /** Plain capitals with a cyan and a magenta copy split off them (the shadow slider); highlighted words selected: white in a navy box. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, d = fs * 0.025 * Math.min(2, o.shadowAmt), ink = o.fill || naInk();
    if (!o.hiPlate) pass((a, x) => { if (a.hi) { ctx.fillStyle = css(o.hi || NA.navy); ctx.fillRect(x - fs * 0.03, -fs * 0.88, ctx.measureText(a.t).width + fs * 0.06, fs * 1.04); } });   // a selection box (unless the layer has plates of its own under them)
    if (d > 0) { ctx.save(); ctx.globalAlpha = 0.85; ctx.globalCompositeOperation = dark ? "screen" : "multiply"; for (const [s, c] of [[-1, [0, 220, 255]], [1, [255, 0, 170]]]) pass((a, x) => { if (!a.hi) { ctx.fillStyle = css(c); ctx.fillText(a.t, x + s * d, 0); } }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? (o.hiPlate ? o.hi || NA.light : NA.light) : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: NA.ink, light: NA.light, mid: NA.silver, dark: NA.deep }, stroke: { ink: NA.ink, light: NA.light }, line: 0.6 })),
  sticker: painters({ line: NA.ink, lineScale: 0.5, join: "miter", shadow(ctx, draw) { ctx.save(); ctx.translate(4, 4); draw("rgba(0,0,0,0.6)"); ctx.restore(); } }),
  /** The corner tag: a bevelled system button. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 2) + f * 1.6, h = f * 1.8, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(NA.silver); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(NA.light); ctx.fillRect(x, top, w, 3); ctx.fillRect(x, top, 3, h);
    ctx.fillStyle = css(NA.deep); ctx.fillRect(x, top + h - 3, w, 3); ctx.fillRect(x + w - 3, top, 3, h);
    ctx.fillStyle = ink || css(NA.ink); spaced(ctx, str, x + f * 0.8, top + h * 0.5 + f * 0.36, 2);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a small loading bar in the top corner, with the windows. */
  frame(ctx, env, p) {
    if (p.windows <= 0) return;
    const { w } = env, x = w - 72 - 200, y = 50;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.windows * 3);
    ctx.fillStyle = css(NA.light); ctx.fillRect(x, y, 200, 16); ctx.strokeStyle = css(NA.shade); ctx.lineWidth = 1.5; ctx.strokeRect(x, y, 200, 16);
    ctx.fillStyle = css(NA.navy); for (let i = 0; i < 9; i++) ctx.fillRect(x + 3 + i * 13, y + 3, 10, 10);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 5 * unit; ctx.shadowOffsetY = 5 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit, !dark); },
  prompt: `Icons for a glitch net-art poster — the graphics of an old computer, bold and pixel-crisp — that read at a glance:
- one clear object per sticker (a folder, a floppy disk, an hourglass, a warning sign, a globe, a mouse, a trash can, an envelope, a smiley), drawn flat and chunky like an old desktop icon; no realism, no fine detail;
- flat colour only: "white", "ink", silver greys, navy ("blue"), and the main colour as one accent;
- the app adds a black edge and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Old computer things, built as simple models from a few boxes and cylinders — a beige computer and monitor, a keyboard, a floppy drive, a modem; no realism, no fine detail.
- the renderer paints faces in silver greys with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a dark grey, and "main" the channel colour — use it for one part only.`,
};

// ====================================================================== shared by the looks below: paint and glass over a picture
/**
 * Paints the picture over in short brush strokes of its own colours: a coarse layer over all of `box`,
 * then a finer one only where the picture changes fast, so its edges keep their drawing. Each stroke
 * runs along the edges (across the change in lightness; where the picture is flat, along a slow drift)
 * and is a shade lighter or darker than the paint it takes up. `cell`: the coarse stroke's width, units.
 */
function brushwork(ctx, box, amt, cell, slot) {
  if (amt <= 0 || fast || !canPaint(ctx)) return;
  const grids = [cell, cell * 0.5].map((c, n) => {   // both read before either is painted
    const cols = Math.max(2, Math.ceil((box.x1 - box.x0) / c)), rows = Math.max(2, Math.ceil((box.y1 - box.y0) / c));
    return { c, cols, rows, fine: n === 1, px: sampled(ctx, box.x0, box.y0, cols, rows, c, slot + n) };
  });
  ctx.save(); ctx.lineCap = "round";
  for (const { c, cols, rows, fine, px } of grids) {
    const L = new Float32Array(cols * rows);
    for (let q = 0; q < cols * rows; q++) L[q] = (px[q * 4] * 54 + px[q * 4 + 1] * 183 + px[q * 4 + 2] * 19) / 65280;
    ctx.globalAlpha = Math.min(1, amt * (fine ? 1 : 0.85)); ctx.lineWidth = c * (fine ? 0.75 : 0.95);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      if (px[q * 4 + 3] < 200) continue;
      const gx = L[i < cols - 1 ? q + 1 : q] - L[i > 0 ? q - 1 : q], gy = L[j < rows - 1 ? q + cols : q] - L[j > 0 ? q - cols : q], g = Math.hypot(gx, gy);
      if (fine && g < 0.08) continue;
      const x = box.x0 + (i + 0.5 + (rand(q * 1.7 + 2000) - 0.5) * 0.9) * c, y = box.y0 + (j + 0.5 + (rand(q * 2.3 + 2001) - 0.5) * 0.9) * c;
      const a = (g > 0.03 ? Math.atan2(gy, gx) + Math.PI / 2 : 0.7 + Math.sin(x * 0.004 + y * 0.002) * 0.9) + (rand(q * 3.1 + 2002) - 0.5) * 0.45;
      const len = c * (fine ? 0.9 + rand(q * 3.7 + 2003) * 0.8 : 1.2 + rand(q * 3.7 + 2003) * 1.6), dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2, v = (rand(q * 4.3 + 2004) - 0.5) * 26;
      ctx.strokeStyle = `rgb(${(px[q * 4] + v) | 0},${(px[q * 4 + 1] + v) | 0},${(px[q * 4 + 2] + v) | 0})`;
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    }
  }
  ctx.restore();
}
/** A repeating tile of dots on a 45° lattice, as a fill (kept per colour and pitch). */
function dotPattern(ctx, colour, pitch) {
  const p = Math.max(2, Math.round(pitch)), key = `dotp|${colour.join()}|${p}`;
  let c = WORK[key];
  if (!c) {
    c = WORK[key] = document.createElement("canvas"); c.width = c.height = p * 2;
    const x = c.getContext("2d"); x.fillStyle = css(colour);
    for (const [a, b] of [[0.5, 0.5], [1.5, 1.5]]) { x.beginPath(); x.arc(a * p, b * p, p * 0.36, 0, TAU); x.fill(); }
  }
  return ctx.createPattern(c, "repeat");
}
/**
 * A layer of a look painted once and kept: a canvas the size of ctx's, painted by paint(x) with ctx's
 * transform, and reused while `key` (all the painting depends on) stays the same — so a slider that does
 * not touch it costs one copy. One is kept per canvas size and slot (the main canvas, each thumbnail);
 * an export's large canvas gets none (null: paint straight onto it).
 */
function keptLayer(ctx, slot, key, paint) {
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
/**
 * The picture seen through patterned glass. A field of smooth bumps (value noise in two octaves, a
 * little taller than wide, fixed to the cover so it does not move with the resolution) bends the light:
 * each pixel is read from a little way down the slope it sits on. Slopes turned to a light at the upper
 * left catch a glint, those turned away a dark line. `amp`: how far the light is bent, `cell`: the size of
 * a bump (both in units); `glint`, `shade`: 0–1; (ox, oy): the point the pattern grows from as `cell`
 * changes (units). While dragging, every other pixel is worked out.
 */
function glassWarp(ctx, amp, cell, glint, shade, ox = 0, oy = 0) {
  if ((amp <= 0 && glint <= 0 && shade <= 0) || !canPaint(ctx)) return;
  const x = workLike(ctx, "glass"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0);
  const W = x.canvas.width, H = x.canvas.height, m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const src = x.getImageData(0, 0, W, H), out = x.createImageData(W, H);
  glassPixels(src.data, out.data, W, H, k, m.e, m.f, amp, cell, glint, shade, ox, oy);
  x.putImageData(out, 0, 0);
  inPixels(ctx, () => ctx.drawImage(x.canvas, 0, 0));
}
/**
 * glassWarp's work on pixels: `s` read, `d` written, both W × H; k pixels per unit; (e, f) the pixel
 * offset of the cover's origin (so the pattern stays fixed to the cover when only part of it is worked
 * on); the rest as glassWarp's.
 */
function glassPixels(s, d, W, H, k, e, f, amp, cell, glint, shade, ox, oy) {
  const cp = cell * k, step = Math.max(2, Math.round(cp / 8)), gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2, hgt = new Float32Array(gw * gh), sd = seed * 7.31;
  const hash = (i, j) => noise(i * 12.9898 + j * 78.233 + sd);
  const vn = (X, Y) => {
    const i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, u = fx * fx * (3 - 2 * fx), t = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), q = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * t + (a - b - c + q) * u * t;
  };
  const near1 = (X, Y) => {   // the squared distance to the nearest of the points scattered one to a cell: a dimple round each
    const i = Math.floor(X), j = Math.floor(Y);
    let best = 9;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const dx = X - (i + a + 0.15 + 0.7 * hash(i + a, j + b)), dy = Y - (j + b + 0.15 + 0.7 * hash(i + a + 71.3, j + b - 19.7)), q = dx * dx + dy * dy; if (q < best) best = q; }
    return best;
  };
  // hammered glass: a dimple per cell, each a little lens with a sharp seam where it meets the next, on a slow wobble
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const X = (i * step - e - ox * k) / cp, Y = (j * step - f - oy * k) / (cp * 1.3); hgt[j * gw + i] = 0.9 * near1(X, Y) + 0.35 * vn(X * 0.6 + 31.7, Y * 0.6 + 9.1); }
  const gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh), sl = cp / (2 * step);   // slopes, as rise per bump width
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) { const q = j * gw + i; gx[q] = (hgt[q + 1] - hgt[q - 1]) * sl; gy[q] = (hgt[q + gw] - hgt[q - gw]) * sl; }
  const A = amp * k, st = fast ? 2 : 1, G = glint * 1.4, D = shade * 1.1, R = (glint + shade) * 0.08;
  for (let py = 0; py < H; py += st) {
    const fy = py / step, j0 = fy | 0, ty = fy - j0;
    for (let px = 0; px < W; px += st) {
      const fx = px / step, i0 = fx | 0, tx = fx - i0, q = j0 * gw + i0;
      const ax = gx[q] + (gx[q + 1] - gx[q]) * tx, bx = gx[q + gw] + (gx[q + gw + 1] - gx[q + gw]) * tx, sx = ax + (bx - ax) * ty;
      const ay = gy[q] + (gy[q + 1] - gy[q]) * tx, by = gy[q + gw] + (gy[q + gw + 1] - gy[q + gw]) * tx, sy = ay + (by - ay) * ty;
      let X = (px + sx * A) | 0, Y = (py + sy * A) | 0;
      X = X < 0 ? 0 : X >= W ? W - 1 : X; Y = Y < 0 ? 0 : Y >= H ? H - 1 : Y;
      const si = (Y * W + X) * 4, lit = sx * 0.55 + sy * 0.83;   // the slope turned toward the light
      let r = s[si], g = s[si + 1], b = s[si + 2];
      let v = lit * R;   // every dimple in a little relief, then a glint on the rim facing the light, a dark line on the one away
      if (lit > 0.3) v += (lit - 0.3) * G; else if (lit < -0.4) v -= (-lit - 0.4) * D;
      if (v > 0) { v = Math.min(1, v); r += (255 - r) * v; g += (255 - g) * v; b += (255 - b) * v; }
      else if (v < 0) { v = Math.min(0.85, -v); r *= 1 - v; g *= 1 - v; b *= 1 - v; }
      for (let yy = 0; yy < st && py + yy < H; yy++) for (let xx = 0; xx < st && px + xx < W; xx++) { const di = ((py + yy) * W + px + xx) * 4; d[di] = r; d[di + 1] = g; d[di + 2] = b; d[di + 3] = s[si + 3]; }
    }
  }
}

// ====================================================================== verse: the comic book come to life
// Animated films that print like comic books: flat colour shaded with Ben-Day dots and hatching, an ink
// line, the colour plates out of register; towers seen from the street; focus lines; neon scribbles, a
// yellow caption box, a sound effect; the dimension glitching in bars of magenta and cyan.
const VS = { night: [26, 14, 48], paper: [248, 244, 246], ink: [24, 16, 36], magenta: [255, 40, 150], cyan: [0, 196, 255], violet: [116, 66, 230], yellow: [255, 226, 56], white: [255, 255, 255] };
const vsGround = () => (dark ? VS.night : VS.paper), vsInk = () => (dark ? VS.white : VS.ink);
/** The figure's colour: the channel's, made vivid; magenta where it would sink into the ground. */
const vsBody = (C) => { const c = boost(C, 0.6); return near(c, vsGround(), 120) ? VS.magenta : c; };
function vsPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
/**
 * Comic colour out of register: the red plate moved one way and the blue one the other, `d` units. Each
 * plate is lifted off the picture (its channel multiplied out) and laid back moved (added), so only its
 * edges show; the strip it leaves bare at the canvas's edge gets it back unmoved.
 */
function plateShift(ctx, d) {
  if (d <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "vsShift"), k = ctx.getTransform().a, W = src.width, H = src.height;
  for (const [s, keep] of [[-1, [255, 0, 0]], [1, [0, 0, 255]]]) {
    const x = workLike(ctx, "vsPlate"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0);
    x.globalCompositeOperation = "multiply"; x.fillStyle = css(keep); x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "destination-in"; x.drawImage(src, 0, 0);
    const dx = Math.round(s * d * k), dy = Math.round(s * d * k * 0.35);
    inPixels(ctx, () => {
      ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(keep.map((v) => 255 - v)); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter"; ctx.drawImage(x.canvas, dx, dy);
      ctx.beginPath();
      if (dx) ctx.rect(dx > 0 ? 0 : W + dx, 0, Math.abs(dx), H);
      if (dy) ctx.rect(0, dy > 0 ? 0 : H + dy, W, Math.abs(dy));
      ctx.clip(); ctx.drawImage(x.canvas, 0, 0);
    });
  }
}
/**
 * Towers seen from the street, leaning in toward a point high above the field: three on each side,
 * their floors and windows converging, a few windows lit, a rim of neon on the inner edge and a halftone
 * on the face. `amt` brings them in by degrees, the nearest (outermost) first, and raises them.
 */
function vsTowers(ctx, F, amt, tone, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, V = [F.x0 + fw * 0.52, F.y0 - fh * 1.1], base = F.y1 + 4, P = (x, t) => [x + (V[0] - x) * t, base + (V[1] - base) * t];
  const face = dark ? [58, 34, 104] : [224, 216, 238], top = dark ? [92, 56, 150] : [238, 232, 246], line = VS.ink, lit = [VS.yellow, VS.cyan, VS.magenta, [255, 170, 80]];
  ctx.save(); ctx.lineJoin = "miter";
  for (let i = 2; i >= 0; i--) for (const s of [-1, 1]) {
    const r = clamp(amt * 6 - (i * 2 + (s > 0 ? 1 : 0)));
    if (r <= 0) continue;
    const kk = k0 + i * 7 + (s > 0 ? 3 : 0), bw = fw * (0.2 - i * 0.03), xo = s < 0 ? F.x0 - fw * 0.06 + i * fw * 0.13 : F.x1 + fw * 0.06 - i * fw * 0.13, xi = xo - s * bw, t = (0.5 - i * 0.1 + rand(kk) * 0.12) * (0.3 + 0.7 * r);
    const quad = (a0, a1, t0, t1) => shapeOf(ctx, [P(xo + (xi - xo) * a0, t0), P(xo + (xi - xo) * a1, t0), P(xo + (xi - xo) * a1, t1), P(xo + (xi - xo) * a0, t1)]);
    ctx.globalAlpha = Math.min(1, r * 2.5);
    quad(0, 1, 0, t); const g = ctx.createLinearGradient(0, base, 0, P(xo, t)[1]); g.addColorStop(0, css(mix(face, VS.ink, 0.35))); g.addColorStop(1, css(top)); ctx.fillStyle = g; ctx.fill();
    if (tone > 0 && canPaint(ctx)) { ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.3 * tone; ctx.fillStyle = dotPattern(ctx, VS.ink, 7); ctx.fillRect(F.x0 - fw, F.y0 - fh, fw * 3, fh * 3); ctx.restore(); }
    const floors = 9 + Math.floor(rand(kk + 1) * 6), cols = 3 + Math.floor(rand(kk + 2) * 3), windows = new Map();
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const q = rand(kk * 31 + f * 3.7 + c * 1.3), col = q > 0.74 ? lit[Math.floor(q * 97) % lit.length] : null, key = col ? col.join() : "dark";
      (windows.get(key) || windows.set(key, { col, list: [] }).get(key)).list.push([(c + 0.18) / cols, (c + 0.82) / cols, (t * (f + 0.25)) / floors, (t * (f + 0.75)) / floors]);
    }
    for (const { col, list } of windows.values()) {
      ctx.beginPath(); for (const [a0, a1, t0, t1] of list) { const pts = [P(xo + (xi - xo) * a0, t0), P(xo + (xi - xo) * a1, t0), P(xo + (xi - xo) * a1, t1), P(xo + (xi - xo) * a0, t1)]; pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
      ctx.fillStyle = col ? css(col) : css(VS.ink, dark ? 0.6 : 0.35); ctx.fill();
    }
    quad(0, 1, 0, t); ctx.strokeStyle = css(line); ctx.lineWidth = 3; ctx.stroke();
    const [ax, ay] = P(xi, 0), [bx, by] = P(xi, t); ctx.strokeStyle = css(s < 0 ? VS.cyan : VS.magenta); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax - s * 4, ay); ctx.lineTo(bx - s * 4, by); ctx.stroke();
  }
  ctx.restore();
}
/** Neon marker scribbles: a coil, a zigzag, an arrow, a star, a scrawl of handwriting — in cyan, magenta, yellow and green. */
function scribbles(ctx, F, amt, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, cols = [VS.cyan, VS.magenta, VS.yellow, [120, 255, 140]], n = amt * 10;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let k = 0; k < Math.ceil(n); k++) {
    const x = F.x0 + fw * (0.06 + rand(k * 2.9 + k0) * 0.86), y = F.y0 + fh * (0.08 + rand(k * 3.7 + k0 + 1) * 0.84), s = Math.min(fw, fh) * (0.06 + rand(k * 4.1 + k0 + 2) * 0.08), c = cols[k % cols.length];
    ctx.globalAlpha = clamp(n - k); ctx.strokeStyle = css(c); ctx.lineWidth = 4 + rand(k + k0 + 3) * 4;
    if (dark) { ctx.shadowColor = css(c, 0.8); ctx.shadowBlur = 10; }
    ctx.beginPath();
    switch (k % 5) {
      case 0: for (let t = 0; t <= 4 * Math.PI; t += 0.2) ctx.lineTo(x + Math.cos(t) * s * 0.45 + t * s * 0.14, y + Math.sin(t) * s * 0.4); break;   // a coil
      case 1: for (let i = 0; i < 7; i++) ctx.lineTo(x + i * s * 0.32, y + (i % 2 ? -s * 0.35 : s * 0.35)); break;                                    // a zigzag
      case 2: ctx.moveTo(x, y + s * 0.5); ctx.quadraticCurveTo(x + s, y - s * 0.6, x + s * 1.8, y); ctx.moveTo(x + s * 1.45, y - s * 0.3); ctx.lineTo(x + s * 1.8, y); ctx.lineTo(x + s * 1.4, y + s * 0.22); break;   // an arrow
      case 3: for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? s * 0.22 : s * 0.55; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } break;   // a star
      default: for (let t = 0; t <= 1; t += 0.02) { const xx = x + t * s * 3, yy = y + Math.sin(t * 38) * s * 0.18 * (0.6 + rand(k * 5 + Math.floor(t * 8) + k0) * 0.8); ctx.lineTo(xx, yy); }   // handwriting
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.restore();
}
const verse = {
  id: "verse",
  art: "figure",
  repaint: (c) => `a frame of an animated film that looks printed like a comic book, made from the photograph: flat colour shaded with Ben-Day halftone dots and hatching lines, bold ink outlines, the colour plates slightly out of register with magenta and cyan fringes, neon magenta, violet and cyan light, with ${c} as an accent; still the same picture, no text.`,
  about: { zh: "漫画宇宙：把漫画印刷搬进动画电影的那种画面——平涂色块用网点和排线上阴影，粗墨线，套色故意错开；从街上仰望的楼群和亮着的窗，集中线，霓虹马克笔涂鸦，黄色旁白框和拟声字，空间撕裂般的品红、青色故障条。频道图形变成一个漫画上色的角色剪影。热闹、炫目、年轻——适合动画、游戏、潮流、音乐、青年文化和娱乐类内容。照片会被压成漫画配色、加上网点。可选纸白底或紫夜底；自带平直的版式，色块是带网点的频道色。", en: "Comic-verse: animated films that print like comic books — flat colour shaded with Ben-Day dots and hatching, a heavy ink line, the colour plates deliberately out of register; towers seen from the street with lit windows, focus lines, neon marker scribbles, a yellow caption box and a sound effect, the dimension glitching in bars of magenta and cyan. The channel graphic as a comic-coloured figure. Loud, dazzling, young — for animation, games, street fashion, music, youth culture and entertainment. A photo is pressed into comic colours with a halftone. A paper-white or violet-night ground; flat layouts of its own, the colour block the channel colour in halftone." },
  name: { zh: "漫画宇宙", en: "Comic-verse" },
  seeded: true,
  scene: { figure: { zh: "漫画身影", en: "Comic figure" }, focus: { zh: "集中线中心", en: "Centre of the focus lines" }, caption: { zh: "旁白框", en: "Caption box" }, sfx: { zh: "拟声字", en: "Sound effect" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "漫画身影", en: "Comic figure" } },
    { key: "towers", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "仰视楼群", en: "Towers from below" } },
    { key: "speed", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "集中线", en: "Focus lines" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "网点", en: "Halftone" } },
    { key: "hatch", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "排线", en: "Hatching" } },
    { key: "offset", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "套色错位", en: "Off-register" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "维度故障", en: "Dimension glitch" } },
    { key: "scribble", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "霓虹涂鸦", en: "Neon scribbles" } },
    { key: "caption", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旁白框", en: "Caption box" } },
    { key: "sfx", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "拟声字", en: "Sound effect" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "颗粒", en: "Grain" } },
    { key: "comic", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "照片漫画化", en: "Photo as comic" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(vsGround()), text: css(vsInk()), dim: css(vsInk(), 0.6), titleFill: css(vsInk()), titleInk: css(vsGround()), grid: () => css(vsInk(), 0.14) }),
  /**
   * The ground (a city glow rising on the night one); towers seen from below; focus lines; scribbles;
   * the figure (on a work canvas: an ink line round it, the flat colour, a shade cut from it and filled
   * with dots and hatching, a pale rim on the lit side); the caption box and the sound effect; glitch
   * bars; then the colour plates pulled out of register over all of it. A photo is pressed into the
   * palette, screened, glitched when it fills the canvas, and put out of register too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = vsPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    if (L.ground !== false) { ctx.fillStyle = css(vsGround()); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false && dark) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(VS.night, 0)); g.addColorStop(1, css([120, 30, 120], 0.55)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    const glitch = (box) => {
      if (p.glitch <= 0 || !canPaint(ctx)) return;
      const src = snap(ctx, "vsGlitch"), m = ctx.getTransform(), k = m.a, bw0 = box.x1 - box.x0, bh0 = box.y1 - box.y0;
      for (let i = 0, n = Math.round(2 + 10 * p.glitch); i < n; i++) {
        const y = box.y0 + bh0 * rand(i * 2.1 + 2300), bh = u * (0.01 + rand(i * 2.9 + 2301) * 0.05), x0 = box.x0 + bw0 * rand(i * 3.7 + 2302) * 0.7, bw = bw0 * (0.1 + rand(i * 4.3 + 2303) * 0.4), dx = (rand(i * 5.1 + 2304) - 0.5) * u * 0.08 * (0.5 + p.glitch);
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y, bw, bh); ctx.clip();
        inPixels(ctx, () => ctx.drawImage(src, dx * k, 0));
        ctx.globalCompositeOperation = dark ? "screen" : "multiply"; ctx.fillStyle = css(i % 2 ? VS.cyan : VS.magenta, 0.6); ctx.fillRect(x0, y, bw, bh);
        ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = css(VS.ink, 0.25); for (let yy = y; yy < y + bh; yy += 4) ctx.fillRect(x0, yy, bw, 1.4);
        ctx.restore();
      }
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable(dark ? [[0, VS.ink], [0.3, VS.violet], [0.55, VS.magenta], [0.8, [255, 176, 130]], [1, VS.white]] : [[0, VS.ink], [0.3, [74, 52, 150]], [0.56, [236, 74, 146]], [0.8, [255, 214, 196]], [1, VS.white]], 0.55), p.comic * 0.9);
      dotScreen(ctx, w, h, VS.ink, 7, 0.4 * p.halftone);
      if (L.fill) glitch({ x0: 0, y0: 0, x1: w, y1: h });
      plateShift(ctx, u * 0.012 * p.offset);
      return true;
    }
    if (!L.grid) return true;
    if (p.towers > 0) vsTowers(ctx, F, p.towers, p.halftone, 2310);
    if (p.speed > 0) {   // focus lines: thin wedges closing in on the figure from the edges
      const R = Math.hypot(fw, fh), r0 = at.size * 0.62;
      ctx.save(); ctx.fillStyle = css(vsInk(), dark ? 0.55 : 0.8); ctx.beginPath();
      shift("focus", at.cx, at.cy, ctx);   // their centre: a scene object
      for (let i = 0, n = Math.round(20 + 150 * p.speed); i < n; i++) { const a = rand(i * 1.7 + 2320) * TAU, wd = 0.002 + rand(i * 2.3 + 2321) * 0.009, r1 = r0 * (1 + rand(i * 3.1 + 2322) * 0.8); ctx.moveTo(at.cx + Math.cos(a) * r1, at.cy + Math.sin(a) * r1); ctx.lineTo(at.cx + Math.cos(a - wd) * R, at.cy + Math.sin(a - wd) * R); ctx.lineTo(at.cx + Math.cos(a + wd) * R, at.cy + Math.sin(a + wd) * R); ctx.closePath(); }
      ctx.fill(); ctx.restore();
    }
    if (p.scribble > 0) scribbles(ctx, F, p.scribble, 2330);
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, hy] = objAt("figure", at.cx, at.cy - size * 0.3, ctx), cy = hy + size * 0.3, body = vsBody(C), d = size * 0.1, x = workLike(ctx, "verse"), y = workLike(ctx, "verseShade"), o = size * 0.012;   // a scene object, its handle at the head
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; placeShape(x, S, VS.ink, cx + Math.cos(a) * o, cy + Math.sin(a) * o, size); }   // the ink line
      placeShape(x, S, body, cx, cy, size);
      // the shade: the shape less a copy moved toward the light, filled with dots and hatching
      placeShape(y, S, mix(body, VS.ink, 0.38), cx, cy, size);
      y.globalCompositeOperation = "destination-out"; placeShape(y, S, [0, 0, 0], cx - d, cy - d * 1.3, size);
      y.globalCompositeOperation = "source-atop";
      if (p.halftone > 0) { y.globalAlpha = 0.85 * p.halftone; y.fillStyle = dotPattern(y, VS.ink, Math.max(5, size * 0.02)); y.fillRect(0, 0, w, h); }
      if (p.hatch > 0) {
        y.globalAlpha = 0.8 * Math.min(1, p.hatch * 1.5); y.strokeStyle = css(VS.ink); y.lineWidth = Math.max(1.2, size * 0.004); y.beginPath();
        for (let t = -size; t < size * 1.4; t += size * (0.028 - 0.012 * p.hatch)) { y.moveTo(cx - size * 0.8 + t, cy + size * 0.7); y.lineTo(cx - size * 0.8 + t + size * 0.9, cy - size * 0.7); }
        y.stroke();
      }
      y.globalAlpha = 1; y.globalCompositeOperation = "source-over";
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(y.canvas, 0, 0); x.restore();
      const z = workLike(ctx, "verseShade");   // the lit rim: the shape less a copy moved away from the light
      placeShape(z, S, mix(body, VS.white, 0.55), cx, cy, size); z.globalCompositeOperation = "destination-out"; placeShape(z, S, [0, 0, 0], cx + d * 0.2, cy + d * 0.28, size);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(z.canvas, 0, 0); x.restore();
      layDown(ctx, x);
    }
    if (p.caption > 0) {   // a yellow caption box with a few lines of narration
      const bw = u * (0.16 + 0.14 * p.caption), bh = bw * 0.42, bx = clamp(at.cx + at.size * 0.08, F.x0 + 20, F.x1 - bw - 20), by = clamp(at.cy - at.size * 0.62, F.y0 + 20, F.y1 - bh - 20);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.caption * 4);
      shift("caption", bx + bw / 2, by + bh / 2, ctx);   // a scene object
      ctx.fillStyle = css(VS.ink); ctx.fillRect(bx + 6, by + 6, bw, bh);
      ctx.fillStyle = css(VS.yellow); ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
      greeked(ctx, bx + bw * 0.08, by + bh * 0.24, bw * 0.84, 3, bh * 0.2, css(VS.ink, 0.85), 2360);
      ctx.restore();
    }
    if (p.sfx > 0) {   // a sound effect: the channel's code (or POW) on a starburst
      const str = ((env.cat && env.cat.code) || "POW").toUpperCase().slice(0, 5) + "!", R = u * (0.07 + 0.09 * p.sfx), bx = clamp(at.cx - at.size * 0.55, F.x0 + R, F.x1 - R), by = clamp(at.cy + at.size * 0.3, F.y0 + R, F.y1 - R);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.sfx * 4);
      shift("sfx", bx, by, ctx);   // a scene object
      starburst(ctx, bx + R * 0.07, by + R * 0.09, R * 1.04, 12, VS.ink, 2350); starburst(ctx, bx, by, R, 12, VS.yellow, 2350);
      ctx.translate(bx, by); ctx.rotate(-0.18); ctx.font = `900 100px ${fonts.en}, ${fonts.cn}`;
      const fs = Math.min(R * 0.75, (R * 1.3 * 100) / Math.max(1, ctx.measureText(str).width));
      ctx.font = `900 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      ctx.lineWidth = fs * 0.14; ctx.strokeStyle = css(VS.ink); ctx.strokeText(str, 0, 0); ctx.fillStyle = css(VS.magenta); ctx.fillText(str, 0, 0);
      ctx.restore();
    }
    glitch({ x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 });
    if (p.offset > 0) wherePainted(ctx, (c) => plateShift(c, u * 0.012 * p.offset), L.base === "clear");
    return true;
  },
  /** A comic page's panels: three tiers, cut into two, three and two panels, with gutters between. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 40, g = 22, tiers = [[0.36, [0.58, 0.42]], [0.3, [0.28, 0.44, 0.28]], [0.34, [0.42, 0.58]]], H = h - 2 * m - g * 2, W = w - 2 * m;
    gridPen(ctx, color, 3); ctx.beginPath();
    let y = m;
    for (const [th, cols] of tiers) { const ph = H * th, ww = W - g * (cols.length - 1); let x = m; for (const c of cols) { ctx.rect(x, y, ww * c, ph); x += ww * c + g; } y += ph + g; }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(vsBody(C)), tone: () => css(VS.ink, 0.55), toneScale: 1, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 9; run(0, 0); ctx.strokeStyle = css(VS.cyan); ctx.lineWidth = 4; run(nx * 12, ny * 12); } },   // the channel colour in halftone, an ink edge and a cyan line out of register
  /** Comic lettering: a drop in magenta halftone and the cyan plate a little the other way (the shadow slider); highlighted words yellow with an ink line. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, d = fs * 0.07 * Math.min(2, o.shadowAmt), ink = o.fill || vsInk(), hi = o.hi || VS.yellow;
    if (d > 0) {
      ctx.save();
      ctx.fillStyle = canPaint(ctx) ? dotPattern(ctx, VS.magenta, Math.max(3, fs * 0.045)) : css(VS.magenta); pass((a, x) => ctx.fillText(a.t, x + d, d));
      ctx.globalAlpha = 0.85; ctx.fillStyle = css(VS.cyan); pass((a, x) => ctx.fillText(a.t, x - d * 0.35, -d * 0.2));
      ctx.restore();
    }
    ctx.lineJoin = "round"; ctx.strokeStyle = css(VS.ink); ctx.lineWidth = fs * 0.08;
    pass((a, x) => { if (a.hi) ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: VS.ink, light: VS.white, mid: [206, 196, 226], dark: [62, 40, 96], colour: (c) => boost(c, 0.6) }, stroke: { ink: VS.ink, light: VS.white }, line: 1.1 })),
  sticker: painters({ line: VS.ink, lineScale: 0.9, tone: inkAs(VS.ink, (c) => boost(c, 0.6)), shadow(ctx, draw) { ctx.save(); ctx.translate(8, 8); draw(css(VS.magenta, 0.85)); ctx.restore(); } }),
  /** The corner tag: a yellow caption box, an ink line and a hard shadow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `900 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(VS.ink); ctx.fillRect(x + 5, top + 5, w, h);
    ctx.fillStyle = css(VS.yellow); ctx.fillRect(x, top, w, h); ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 3; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = ink || css(VS.ink); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 10, h: h + 10 };
  },
  /** The frame layer: the border of a comic panel. */
  frame(ctx, env) { const { w, h } = env; ctx.save(); ctx.strokeStyle = css(vsInk()); ctx.lineWidth = 6; ctx.strokeRect(22, 22, w - 44, h - 44); ctx.restore(); },
  image(ctx, C, unit) { ctx.shadowColor = css(VS.magenta, 0.8); ctx.shadowBlur = 0; ctx.shadowOffsetX = 8 * unit; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit, !dark); },
  prompt: `Stickers for an animated film printed like a comic book — loud, graphic, full of energy — that read at a glance:
- one clear object per sticker (a mask, a sneaker, a spray can, a lightning bolt, a speech balloon, a skateboard, headphones, a pigeon, a star), bold and simple; no realism, no fine detail;
- flat colour only: the main colour with "pink" (hot magenta), "blue" (cyan), "yellow" and "white" as partners; "ink" for the darkest parts;
- the app adds a heavy ink outline and a magenta offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a comic-book city, built as simple models from a few boxes and cylinders — a water tower, a taxi, a subway entrance, a phone booth, a fire hydrant; no realism, no fine detail.
- the renderer paints faces in flat comic colours with a heavy ink line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep violet, and "main" the channel colour made vivid — use it for one to three parts.`,
};

// ====================================================================== glass: a painting behind patterned glass
// An oil painting seen through a pane of hammered glass: a room in warm light — a window, someone
// standing against it, flowers in a vase — painted in loose strokes, then bent and broken up by the
// glass, its bumps catching glints and dark lines; frost; the corners falling away into shadow.
const PG = { silver: [204, 206, 198], night: [24, 26, 22], light: [255, 246, 228], sky: [250, 196, 172], warm: [255, 170, 92], ink: [30, 30, 28], cream: [246, 240, 226], leaf: [62, 116, 54], vase: [236, 232, 220] };
const pgGround = () => (dark ? PG.night : PG.silver), pgInk = () => (dark ? PG.cream : PG.ink);
/** The flowers' colour: the channel's, made vivid; a rose red where it would sink into the leaves. */
const pgBloom = (C) => { const c = boost(C, 0.5); return near(c, PG.leaf, 100) ? [214, 52, 70] : c; };
/** The window: toward the field's middle, wider as its slider rises. */
function pgPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, ww = fw * (0.16 + 0.16 * p.window), wh = fh * 0.62;
  return { F, wx: F.x0 + fw * 0.58 - ww / 2, wy: F.y0 + fh * 0.1, ww, wh };
}
const glass = {
  id: "glass",
  art: "figure",
  repaint: (c) => `the photograph as an oil painting seen through a pane of textured hammered glass: loose painterly brush strokes, the whole image warped into wavy ripples and fragments, glints on the bumps of the glass and dark lines in its hollows, warm interior light, with ${c} as an accent; no text.`,
  about: { zh: "压花玻璃：隔着一块起伏的压花玻璃看一幅油画——暖光里的房间、一扇窗、窗前站着的人影（频道图形）、花瓶里的花，先用松散的油画笔触画出来，再被玻璃扭曲、打碎成一片片波纹，凸起处闪着高光、凹处是暗纹；可以再蒙一层雾面，四角暗下去。朦胧、私密、有温度——适合情感、生活、居家、回忆、艺术和电台类内容。照片也会被画成笔触、透过压花玻璃看。可选银灰底或夜色底；自带平直的版式，色块是一块磨砂玻璃。", en: "Patterned glass: an oil painting seen through a pane of hammered glass — a room in warm light, a window, someone standing against it (the channel graphic), flowers in a vase, painted in loose strokes, then bent and broken up by the glass into ripples, glints on the bumps and dark lines in the hollows; frost and darkening corners if you like. Hazy, intimate, warm — for feelings, everyday life, home, memories, art and radio. A photo is painted over and seen through the glass too. A silver or a night ground; flat layouts of its own, the colour block a pane of frosted glass." },
  name: { zh: "压花玻璃", en: "Patterned glass" },
  seeded: true,
  scene: { window: { zh: "窗与窗光", en: "Window and its light" }, figure: { zh: "窗前身影", en: "Figure at the window" }, flowers: { zh: "瓶花", en: "Flowers" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "窗前身影", en: "Figure at the window" } },
    { key: "window", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "窗光", en: "Window light" } },
    { key: "warm", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "暖光", en: "Warm light" } },
    { key: "flowers", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "瓶花", en: "Flowers" } },
    { key: "paint", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "油画笔触", en: "Brush strokes" } },
    { key: "ripple", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "波纹扭曲", en: "Ripple" } },
    { key: "scale", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "纹理大小", en: "Pattern size" } },
    { key: "glint", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "玻璃高光", en: "Glints" } },
    { key: "shade", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "玻璃暗纹", en: "Dark lines" } },
    { key: "frost", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "雾面", en: "Frost" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "暗角", en: "Dark corners" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(pgGround()), text: css(pgInk()), dim: css(pgInk(), 0.6), titleFill: css(pgInk()), titleInk: css(pgGround()), grid: () => css(pgInk(), 0.12) }),
  /**
   * The room: the wall and the floor; the window with its glow and the light it lays on the floor; the
   * figure standing against it; flowers in a vase; brush strokes over all of it; then the glass (see
   * glassWarp) and the frost. A photo is painted over, then seen through the same glass.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = pgPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, cell = u * (0.025 + 0.065 * p.scale);
    const pane = () => {
      glassWarp(ctx, u * 0.085 * p.ripple, cell, p.glint, p.shade, w / 2, h / 2);
      if (p.frost > 0 && canPaint(ctx) && !fast) {
        const soft = softCopy(snap(ctx, "pgSnap"), 12, "pgFrost"), cv = ctx.canvas;
        inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, p.frost * 0.9); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
      }
      if (p.frost > 0) wherePainted(ctx, (c) => wash(c, w, h, "screen", dark ? [60, 62, 56] : [240, 242, 236], 0.4 * p.frost), L.base === "clear");
    };
    if (env.photo) {
      env.drawPhoto();
      if (L.fill) brushwork(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.paint, u * 0.012, "pgPaint");
      pane();
      return true;
    }
    const floor = F.y0 + fh * 0.8;
    if (L.ground !== false) {   // the room's wall and floor: the ground (the glass goes over it with what stands on it)
      const wall = ctx.createLinearGradient(0, 0, 0, h);
      wall.addColorStop(0, css(dark ? [44, 50, 38] : [196, 200, 186])); wall.addColorStop(0.7, css(dark ? [30, 34, 26] : [168, 172, 156])); wall.addColorStop(1, css(dark ? [20, 22, 18] : [140, 144, 128]));
      ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, floor, 0, F.y1); g.addColorStop(0, css(dark ? [70, 46, 30] : [156, 110, 72])); g.addColorStop(1, css(dark ? [34, 22, 14] : [104, 70, 44])); ctx.fillStyle = g; ctx.fillRect(F.x0, floor, fw, F.y1 - floor + 4);
    }
    if (!L.grid) return true;
    const { ww, wh } = at, [mx, my] = p.window > 0 || p.warm > 0 ? objAt("window", at.wx + ww / 2, at.wy + wh * 0.3, ctx) : [at.wx + ww / 2, at.wy + wh * 0.3], wx = mx - ww / 2, wy = my - wh * 0.3, wa = Math.min(1, p.window * 3);   // the window and its light: a scene object
    if (p.warm > 0) {   // the window's glow on the wall round it, and the light it lays across the floor
      ctx.save(); ctx.globalCompositeOperation = "screen";
      const g = ctx.createRadialGradient(wx + ww / 2, wy + wh * 0.45, 0, wx + ww / 2, wy + wh * 0.45, Math.max(ww, wh) * 1.3); g.addColorStop(0, css(PG.warm, 0.55 * p.warm)); g.addColorStop(1, css(PG.warm, 0)); ctx.fillStyle = g; ctx.fillRect(F.x0, F.y0, fw, fh);
      ctx.fillStyle = css(PG.warm, 0.45 * p.warm * wa); shapeOf(ctx, [[wx, floor], [wx + ww, floor], [wx + ww * 0.4, F.y1], [wx - ww * 1.3, F.y1]]); ctx.fill();
      ctx.restore();
      wherePainted(ctx, (c) => wash(c, w, h, "soft-light", PG.warm, 0.3 * p.warm), L.base === "clear");
    }
    if (p.window > 0) {   // the window: a bright sky, mullions and a sill
      ctx.save(); ctx.globalAlpha = wa;
      const sky = ctx.createLinearGradient(0, wy, 0, wy + wh); sky.addColorStop(0, css(mix(PG.light, C, 0.12))); sky.addColorStop(0.55, css(mix(PG.sky, PG.light, 0.3))); sky.addColorStop(1, css(PG.sky));
      ctx.fillStyle = sky; ctx.fillRect(wx, wy, ww, wh);
      const bar = Math.max(4, ww * 0.06), fr = css(dark ? [36, 40, 30] : [120, 124, 104]);
      ctx.fillStyle = fr; ctx.fillRect(wx - bar, wy - bar, ww + bar * 2, bar); ctx.fillRect(wx - bar, wy, bar, wh); ctx.fillRect(wx + ww, wy, bar, wh);
      ctx.fillRect(wx + ww / 2 - bar / 2, wy, bar, wh); ctx.fillRect(wx, wy + wh * 0.36, ww, bar * 0.8);
      ctx.fillStyle = css(dark ? [120, 112, 96] : [232, 228, 214]); ctx.fillRect(wx - bar * 2, wy + wh, ww + bar * 4, bar * 1.2);
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // someone standing against the window, dark against the light, soft at the edge
      const size = wh * (0.5 + 0.45 * p.figure), [cx, hy] = objAt("figure", wx + ww * 0.55, Math.min(floor + size * 0.05, wy + wh + size * 0.1) - size * 0.72, ctx), cy = hy + size * 0.3, col = mix(PG.ink, dark ? [40, 30, 24] : [70, 56, 44], 0.4);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.figure * 3);
      blurred(ctx, size * 0.03, css(col, 0.7), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size * 1.02));
      placeShape(ctx, S, col, cx, cy, size);
      ctx.restore();
    }
    if (p.flowers > 0) {   // a white vase on the right, leaves, and blooms in the channel colour
      const vx = F.x0 + fw * 0.86, vy = floor - fh * 0.02, vh = fh * (0.16 + 0.08 * p.flowers), vw = vh * 0.42, bloom = pgBloom(C), n = 2 + p.flowers * 9;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.flowers * 4);
      shift("flowers", vx, vy - vh * 0.6, ctx);   // the vase and its flowers: a scene object
      ctx.beginPath(); ctx.moveTo(vx - vw * 0.3, vy - vh); ctx.bezierCurveTo(vx - vw * 0.2, vy - vh * 0.7, vx - vw * 0.75, vy - vh * 0.5, vx - vw * 0.45, vy); ctx.lineTo(vx + vw * 0.45, vy); ctx.bezierCurveTo(vx + vw * 0.75, vy - vh * 0.5, vx + vw * 0.2, vy - vh * 0.7, vx + vw * 0.3, vy - vh); ctx.closePath();
      const vg = ctx.createLinearGradient(vx - vw / 2, 0, vx + vw / 2, 0); vg.addColorStop(0, css(PG.vase)); vg.addColorStop(1, css(mix(PG.vase, PG.ink, 0.35))); ctx.fillStyle = vg; ctx.fill();
      for (let k = 0; k < Math.ceil(n); k++) {
        const a = -Math.PI / 2 + (rand(k * 2.3 + 2400) - 0.5) * 2.2, d = vh * (0.5 + rand(k * 3.1 + 2401) * 0.6), x = vx + Math.cos(a) * d, y = vy - vh + Math.sin(a) * d * 0.8, r = vh * (0.09 + rand(k * 4.7 + 2402) * 0.07);
        ctx.globalAlpha = Math.min(1, p.flowers * 4) * clamp(n - k);
        ctx.fillStyle = css(mix(PG.leaf, [20, 40, 20], rand(k + 2403) * 0.5)); ctx.beginPath(); ctx.ellipse(x + r * 1.2, y + r * 0.8, r * 1.1, r * 0.5, a + 0.8, 0, TAU); ctx.fill();
        for (let j = 0; j < 4; j++) { ctx.fillStyle = css(mix(bloom, j % 2 ? [255, 236, 236] : [60, 0, 20], 0.12 + 0.25 * (j / 4))); ctx.beginPath(); ctx.arc(x + Math.cos(j * 1.9) * r * 0.45, y + Math.sin(j * 1.9) * r * 0.4, r * (0.9 - j * 0.15), 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    }
    brushwork(ctx, { x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 }, p.paint, u * 0.013, "pgPaint");
    pane();
    return true;
  },
  /** Leaded glass: tall panes, each line of lead a pair of lines. */
  gridLines(ctx, env, color) {
    const { w, h } = env, pw = 160, ph = 240, xs = [], ys = [];
    for (let x = pw; x < w; x += pw) xs.push(x - 4, x + 4);
    for (let y = ph / 2; y < h; y += ph) ys.push(y - 4, y + 4);
    gridPen(ctx, color); gridPath(ctx, xs, ys, 0, 0, w, h); ctx.restore();
  },
  accent: { fill: () => css(dark ? [52, 56, 48] : [226, 228, 220]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; run(-nx * 3, -ny * 3); ctx.strokeStyle = css(PG.ink, 0.35); ctx.lineWidth = 2; run(nx * 2, ny * 2); } },   // a pane of frosted glass
  /** Serif letters with a soft light round them (on the night ground a warm glow, on the silver one a faint shadow: the shadow slider); highlighted words in the flowers' colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || pgInk(), hi = o.hi || pgBloom(o.C || PG.warm), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css(PG.warm, 0.55) : css(PG.ink, 0.3); ctx.shadowBlur = fs * 0.18 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: PG.ink, light: PG.cream, colour: (c) => mix(boost(c, 0.3), PG.cream, 0.1) }, stroke: { ink: PG.ink, light: PG.cream }, line: 0.6 })),
  sticker: painters({ line: null, tone: inkAs(PG.ink), shadow(ctx, draw) { ctx.save(); ctx.translate(4, 6); draw(css(PG.ink, 0.25)); ctx.restore(); } }),
  /** The corner tag: an etched glass label, frosted, with a bright edge. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6;
    ctx.font = `600 ${f}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.6, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.25); ctx.fillStyle = css(dark ? [80, 84, 76] : [250, 250, 246], 0.55); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = ink || css(pgInk()); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the dark wooden frame of the pane, with a bright line inside it. */
  frame(ctx, env) {
    const { w, h } = env;
    ctx.save(); ctx.strokeStyle = css(dark ? [12, 12, 10] : [64, 58, 46], 0.85); ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5; ctx.strokeRect(14, 14, w - 28, h - 28); ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(PG.ink, 0.35); ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { vignette(ctx, w, h, dark ? [0, 0, 0] : [44, 38, 26], 0.85 * p.vignette, 0.35); grain(ctx, 0.18, unit); },
  prompt: `Things for an intimate oil painting of a room — quiet, warm, a little blurred — that read at a glance:
- one clear object per sticker (a cup, a candle, a flower, a book, a lamp, a letter, a cat, a pair of glasses), soft and simple; no realism, no fine detail;
- flat colour only in warm, muted tones: the main colour, cream ("white"), a warm brown ("ink"), soft greens;
- the app adds a soft shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Furniture of a quiet room, built as simple models from a few boxes and cylinders — a chair, a table, a lamp, a vase, a radio; no realism, no fine detail.
- the renderer paints faces in soft warm tones: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep brown, and "main" the channel colour, softened — use it for one to three parts.`,
};

// ====================================================================== jelly: translucent toys in a machine
// Collectible creatures of clear, glowing jelly set into a machine: circuit boards with their traces and
// chips, speaker cones, coiled cables, knobs, an orange seven-segment display and columns of tiny print;
// the machinery soft behind the creature, its glow spilling out.
const JL = { steel: [170, 186, 196], night: [12, 22, 32], board: [30, 64, 86], deep: [18, 40, 58], coral: [255, 110, 72], lime: [196, 234, 44], cobalt: [40, 112, 222], cream: [238, 242, 234], amber: [255, 150, 36], ink: [14, 22, 30], trace: [236, 132, 70] };
const jlGround = () => (dark ? JL.night : JL.steel), jlInk = () => (dark ? JL.cream : JL.ink);
/** The jelly's colour: the channel's, made vivid; coral where it would sink into the board or the ground. */
const jlBody = (C) => { const c = boost(C, 0.55); return near(c, jlGround(), 110) || near(c, JL.board, 90) ? JL.coral : c; };
function jlPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.4 + 0.42 * p.figure);
  return { F, cx: F.x0 + fw * 0.64, cy: F.y0 + fh * 0.46, size };
}
/**
 * The machine's panel, which the circuit, the tiny print and the knobs are laid on, as large as `board`
 * says and whatever size the figure is. At 0.5 it is the field less a margin, its left edge where a figure
 * of the slider's default size (0.55) would reach; toward 1 it grows to the whole field, toward 0 it
 * shrinks about its middle to nothing (at 0 there is no panel: see jelly's background).
 */
function jlPanel({ F, cx }, board = 0.5) {
  const all = { x0: F.x0 + 24, y0: F.y0 + 24, x1: F.x1 - 24, y1: F.y1 - 24 }, usual = (F.y1 - F.y0) * (0.4 + 0.42 * 0.55), mid = { ...all, x0: Math.max(all.x0, cx - usual) };
  if (board >= 0.5) { const t = (board - 0.5) * 2; return Object.fromEntries(Object.keys(all).map((k) => [k, mid[k] + (all[k] - mid[k]) * t])); }
  const k = 2 * board, mx = (mid.x0 + mid.x1) / 2, my = (mid.y0 + mid.y1) / 2, hw = ((mid.x1 - mid.x0) / 2) * k, hh = ((mid.y1 - mid.y0) / 2) * k;
  return { x0: mx - hw, y0: my - hh, x1: mx + hw, y1: my + hh };
}
/** A polyline moved `o` to its left, its corners mitred. */
function offsetLine(pts, o) {
  const N = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  return pts.map((p, i) => {
    const n1 = i > 0 ? N(pts[i - 1], p) : N(p, pts[i + 1]), n2 = i < pts.length - 1 ? N(p, pts[i + 1]) : n1;
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const c = mx * n1[0] + my * n1[1] || 1;
    return [p[0] + (mx * o) / c, p[1] + (my * o) / c];
  });
}
/**
 * A circuit board's copper over `box`: buses of two to four parallel traces running straight and turning
 * through 45°, a ring pad at their ends and a via at their starts; black chips with rows of pins. `amt`
 * adds traces and chips one after another.
 */
function circuit(ctx, box, amt, colour, k0) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, g = Math.min(bw, bh) * 0.028, n = amt * 34, D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  ctx.save(); ctx.beginPath(); ctx.rect(box.x0, box.y0, bw, bh); ctx.clip();
  ctx.lineCap = "round"; ctx.lineJoin = "miter"; ctx.strokeStyle = css(colour); ctx.fillStyle = css(colour);
  for (let k = 0; k < Math.ceil(n); k++) {
    ctx.globalAlpha = clamp(n - k) * 0.85;
    let x = box.x0 + Math.round((rand(k * 2.1 + k0) * bw) / g) * g, y = box.y0 + Math.round((rand(k * 3.3 + k0 + 1) * bh) / g) * g, d = Math.floor(rand(k * 4.7 + k0 + 2) * 4);
    const pts = [[x, y]];
    for (let s = 0; s < 3; s++) {
      const len = g * (2 + Math.floor(rand(k * 7.1 + s * 1.3 + k0 + 4) * 7));
      x += D[d][0] * len; y += D[d][1] * len; pts.push([x, y]);
      if (s < 2) { const nd = (d + (rand(k * 8.3 + s + k0 + 5) > 0.5 ? 1 : 3)) % 4; x += (D[d][0] + D[nd][0]) * g; y += (D[d][1] + D[nd][1]) * g; pts.push([x, y]); d = nd; }
    }
    const lanes = 2 + Math.floor(rand(k * 9.7 + k0 + 6) * 3), lw = Math.max(1.2, g * (0.12 + rand(k * 5.9 + k0 + 3) * 0.1));
    ctx.lineWidth = lw;
    for (let b = 0; b < lanes; b++) {
      const q = offsetLine(pts, (b - (lanes - 1) / 2) * g * 0.45), e = q[q.length - 1];
      ctx.beginPath(); q.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      ctx.beginPath(); ctx.arc(e[0], e[1], g * 0.2, 0, TAU); ctx.lineWidth = lw * 1.2; ctx.stroke(); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(q[0][0], q[0][1], g * 0.12, 0, TAU); ctx.fill();
    }
  }
  for (let k = 0, m = amt * 5; k < Math.ceil(m); k++) {   // chips
    const cw = g * (3 + Math.floor(rand(k * 2.9 + k0 + 50) * 4)), ch = g * (2 + Math.floor(rand(k * 3.7 + k0 + 51) * 3)), x = box.x0 + rand(k * 4.3 + k0 + 52) * (bw - cw), y = box.y0 + rand(k * 5.1 + k0 + 53) * (bh - ch);
    ctx.globalAlpha = clamp(m - k);
    ctx.fillStyle = css(colour); for (let i = 0; i < Math.floor(cw / (g * 0.5)); i++) { ctx.fillRect(x + g * 0.3 + i * g * 0.5, y - g * 0.3, g * 0.22, ch + g * 0.6); }
    ctx.fillStyle = css(JL.ink); ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = css(JL.cream, 0.5); ctx.beginPath(); ctx.arc(x + g * 0.4, y + g * 0.4, g * 0.12, 0, TAU); ctx.fill();
    greeked(ctx, x + g * 0.8, y + ch * 0.4, cw - g * 1.6, 2, g * 0.35, css(JL.cream, 0.45), k0 + k * 7);
  }
  ctx.restore();
}
/** A speaker: its frame and four screws, the surround, the cone lit from the upper left with its rings, the dust cap. */
function speaker(ctx, x, y, r) {
  const g0 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r); g0.addColorStop(0, "#5a6470"); g0.addColorStop(1, "#1c2228");
  ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = "#9aa4ae"; for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88, r * 0.045, 0, TAU); ctx.fill(); }
  ctx.fillStyle = "#262c33"; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, TAU); ctx.fill();
  const g1 = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r * 0.72); g1.addColorStop(0, "#69737e"); g1.addColorStop(0.7, "#20262c"); g1.addColorStop(1, "#0c1014");
  ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = Math.max(1, r * 0.015); for (const q of [0.38, 0.5, 0.62]) { ctx.beginPath(); ctx.arc(x, y, r * q, 0, TAU); ctx.stroke(); }
  const g2 = ctx.createRadialGradient(x - r * 0.08, y - r * 0.1, 0, x, y, r * 0.24); g2.addColorStop(0, "#b8c0c8"); g2.addColorStop(1, "#30363c");
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fill();
}
/** A cable: a tube of `colour`, its dark side, its body and a highlight along it. */
function cable(ctx, pts, lw, colour) {
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); };
  ctx.lineCap = "round";
  path(); ctx.strokeStyle = css(mix(colour, [0, 0, 0], 0.5)); ctx.lineWidth = lw; ctx.stroke();
  path(); ctx.strokeStyle = css(colour); ctx.lineWidth = lw * 0.7; ctx.stroke();
  ctx.save(); ctx.translate(-lw * 0.15, -lw * 0.18); path(); ctx.strokeStyle = css(mix(colour, [255, 255, 255], 0.65), 0.85); ctx.lineWidth = lw * 0.16; ctx.stroke(); ctx.restore();
}
/** The segments each character of a seven-segment display lights. */
const SEGS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
/** One character of a seven-segment display, `s` tall, slanted a little; the unlit segments faintly in `off`. */
function segDigit(ctx, ch, x, y, s, on, off) {
  const w = s * 0.5, t = s * 0.1, segs = { a: [t, 0, w - t, 0], b: [w, t, w, s / 2 - t], c: [w, s / 2 + t, w, s - t], d: [t, s, w - t, s], e: [0, s / 2 + t, 0, s - t], f: [0, t, 0, s / 2 - t], g: [t, s / 2, w - t, s / 2] };
  ctx.lineCap = "round"; ctx.lineWidth = t;
  for (const [k, [x0, y0, x1, y1]] of Object.entries(segs)) {
    const lit = (SEGS[ch] || "").includes(k);
    if (!lit && !off) continue;
    ctx.strokeStyle = lit ? on : off; ctx.beginPath(); ctx.moveTo(x + x0 + (s - y0) * 0.1, y + y0); ctx.lineTo(x + x1 + (s - y1) * 0.1, y + y1); ctx.stroke();
  }
}
const jelly = {
  id: "jelly",
  art: "figure",
  repaint: (c) => `a glossy 3D designer-toy render made from the photograph: translucent jelly and clear plastic glowing from within in coral orange, lime green and cobalt blue, set into intricate retro electronics — circuit boards, speaker cones, cables, a seven-segment display — soft studio light and a shallow depth of field, with ${c} as an accent; no readable text.`,
  about: { zh: "果冻机械：潮玩海报里那种透明发光的果冻生物，嵌在一台机器里——频道图形变成一只半透明、内有气泡、表面油亮的果冻（颜色来自频道色），身后是电路板的走线和芯片、音箱喇叭、盘绕的线缆、旋钮按键、橙色的七段数码屏和一栏栏极小的说明字；背景可以虚化，让果冻跳出来，辉光溢出。可爱、精密、科技感——适合科技、潮玩、音乐、电子、游戏和产品类内容。照片会调成青橙配色。可选钢灰底或深夜底；自带平直的版式。", en: "Jelly machine: the clear, glowing jelly creatures of designer-toy posters, set into a machine — the channel graphic as translucent jelly with bubbles inside and a glossy skin (in the channel colour), behind it a circuit board's traces and chips, speaker cones, coiled cables, knobs and buttons, an orange seven-segment display and columns of tiny print; the machinery out of focus if you like, so the jelly stands out, its glow spilling over. Cute, precise, technical — for tech, designer toys, music, electronics, games and products. A photo is graded teal and orange. A steel-grey or a night ground; flat layouts of its own." },
  name: { zh: "果冻机械", en: "Jelly machine" },
  seeded: true,
  scene: { figure: { zh: "果冻身影", en: "Jelly figure" }, display: { zh: "数码屏", en: "Segment display" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "果冻身影", en: "Jelly figure" } },
    { key: "circuit", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "电路板", en: "Circuit board" } },
    { key: "board", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "电路板大小", en: "Board size" } },
    { key: "speakers", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "音箱喇叭", en: "Speakers" } },
    { key: "cables", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "线缆", en: "Cables" } },
    { key: "knobs", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旋钮按键", en: "Knobs and buttons" } },
    { key: "lcd", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "数码屏", en: "Segment display" } },
    { key: "text", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "密排小字", en: "Tiny print" } },
    { key: "blobs", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "果冻小球", en: "Jelly drops" } },
    { key: "depth", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "景深虚化", en: "Depth of field" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "辉光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "tone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片青橙调", en: "Photo teal and orange" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(jlGround()), text: css(jlInk()), dim: css(jlInk(), 0.6), titleFill: css(jlInk()), titleInk: css(jlGround()), grid: () => css(jlInk(), 0.12) }),
  /**
   * The machine's panel round the figure: tiny print, the circuit, speakers, cables, knobs; all of it
   * softened (Depth of field); then the figure's glow, the jelly itself (on a work canvas: a colour lit
   * from inside, the bevel, bubbles, a glossy highlight — laid down a little clear), jelly drops, the
   * display, and the glow spilling over. A photo is graded teal and orange.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), body = jlBody(C);
    if (L.ground !== false) { ctx.fillStyle = css(jlGround()); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(0,0,0,0.12)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, [8, 18, 28]], [0.4, [34, 104, 132]], [0.7, [244, 132, 86]], [1, [252, 246, 228]]]), p.tone);
      if (L.fill) avGlow(ctx, p.glow * 0.5);
      return true;
    }
    if (!L.grid) return true;
    const at = jlPlace(env, p), F = at.F, { cx, cy, size } = at, P = jlPanel(at, p.board), room = p.board < 0.5 ? jlPanel(at) : P, pw = P.x1 - P.x0, ph = P.y1 - P.y0;
    const board = p.board > 0;   // the panel and what is laid on it (print, circuit, knobs): none at a board size of nothing
    if (board) { ctx.beginPath(); rounded(ctx, P.x0, P.y0, pw, ph, u * 0.025); ctx.fillStyle = css(dark ? JL.deep : [204, 216, 224]); ctx.fill(); ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"; ctx.lineWidth = 2; ctx.stroke(); }   // pale on the steel ground, so dark lettering over it still reads
    if (board && p.text > 0) {   // columns of tiny print down both sides of the panel, an amber heading over each
      ctx.save(); ctx.globalAlpha = Math.min(1, p.text * 3);
      const cw = pw * 0.17, rows = Math.round(4 + 26 * p.text);
      for (const x of [P.x0 + 18, P.x1 - 18 - cw]) { ctx.fillStyle = css(JL.amber, 0.85); ctx.fillRect(x, P.y0 + 18, cw * 0.6, 6); greeked(ctx, x, P.y0 + 34, cw, rows, 8, css(dark ? JL.cream : JL.ink, 0.5), 2420 + x); }
      ctx.restore();
    }
    if (board && p.circuit > 0) circuit(ctx, P, p.circuit, dark ? JL.trace : [226, 118, 56], 2430);
    // the speakers, cables and display are the jelly's: kept within the panel of the default size even when a smaller one is drawn
    if (p.speakers > 0) {   // pairs of speakers either side of the figure, the upper ones first
      const r = size * 0.15, n = p.speakers * 6;
      for (let k = 0; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); speaker(ctx, k % 2 ? Math.min(room.x1 - r * 1.15, cx + size * 0.62) : Math.max(room.x0 + r * 1.15, cx - size * 0.62), cy - size * 0.3 + (k >> 1) * r * 2.3, r); ctx.restore(); }
    }
    if (p.cables > 0) {   // cables from under the figure, sagging out to the panel's edges
      const cols = [JL.lime, JL.cobalt, JL.coral, JL.cream, JL.lime], n = p.cables * 5;
      for (let k = 0; k < Math.ceil(n); k++) {
        const s = k % 2 ? 1 : -1, x0 = cx + s * size * (0.05 + k * 0.04), y0 = cy + size * 0.3, x1 = s > 0 ? room.x1 + 10 : room.x0 - 10, y1 = cy + size * (0.1 + rand(k * 2.7 + 2440) * 0.5);
        ctx.save(); ctx.globalAlpha = clamp(n - k); cable(ctx, [x0, y0, x0 + s * size * 0.1, y0 + size * 0.6, x1 - s * size * 0.3, y1 + size * 0.5, x1, y1], u * (0.012 + rand(k + 2441) * 0.01), cols[k]); ctx.restore();
      }
    }
    if (board && p.knobs > 0) {   // a row of knobs and buttons along the panel's foot, a small lamp beside each
      const r = u * 0.024, n = p.knobs * 8, y = P.y1 - r * 2;
      for (let k = 0; k < Math.ceil(n); k++) {
        const x = P.x0 + pw * 0.08 + k * r * 3.4, c = [JL.lime, JL.coral, JL.cream, JL.cobalt][k % 4];
        if (x > P.x1 - r * 2) break;
        ctx.save(); ctx.globalAlpha = clamp(n - k);
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.2, r * 1.05, 0, TAU); ctx.fill();
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, css(mix(c, [255, 255, 255], 0.5))); g.addColorStop(1, css(mix(c, [0, 0, 0], 0.35))); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        if (k % 2 === 0) { const a = -2.2 + rand(k + 2450) * 2.6; ctx.strokeStyle = css(JL.ink, 0.8); ctx.lineWidth = r * 0.16; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75); ctx.stroke(); }
        ctx.fillStyle = css(rand(k + 2451) > 0.4 ? JL.lime : JL.amber); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x + r * 1.5, y - r * 0.7, r * 0.16, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    if (p.depth > 0 && canPaint(ctx) && !fast) {   // the machinery out of focus behind the figure
      const soft = softCopy(snap(ctx, "jlSnap"), 4 + 12 * p.depth, "jlDepth"), cv = ctx.canvas;
      inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, p.depth * 1.4); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      ctx.save(); shift("figure", cx, cy - size * 0.3, ctx);   // a scene object (its work canvas takes the move with ctx's transform)
      if (p.glow > 0) blurred(ctx, size * 0.08, css(body, 0.65 * p.glow), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      const x = workLike(ctx, "jelly");
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in";
      const g = x.createRadialGradient(cx - size * 0.08, cy - size * 0.1, size * 0.04, cx, cy, size * 0.62);
      g.addColorStop(0, css(mix(body, [255, 250, 230], 0.55))); g.addColorStop(0.55, css(body)); g.addColorStop(1, css(mix(body, JL.ink, 0.38)));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "source-over";
      bevel(x, S, cx, cy, size, size * 0.01, mix(body, [255, 255, 255], 0.6), mix(body, JL.ink, 0.5), 0.55);
      x.save(); x.globalCompositeOperation = "source-atop";
      x.strokeStyle = "rgba(255,255,255,0.55)"; x.lineWidth = Math.max(1, size * 0.003);
      for (let k = 0; k < 16; k++) { x.beginPath(); x.arc(cx + (rand(k * 2.1 + 2460) - 0.5) * size * 0.8, cy + (rand(k * 2.9 + 2461) - 0.4) * size * 0.8, size * (0.006 + rand(k * 3.7 + 2462) ** 2 * 0.025), 0, TAU); x.stroke(); }   // bubbles
      x.fillStyle = "rgba(255,255,255,0.8)"; x.beginPath(); x.ellipse(cx - size * 0.2, cy - size * 0.28, size * 0.1, size * 0.04, -0.5, 0, TAU); x.fill();
      x.beginPath(); x.arc(cx - size * 0.06, cy - size * 0.34, size * 0.015, 0, TAU); x.fill();
      x.restore();
      layDown(ctx, x, 0.9);
      ctx.restore();
    }
    for (let k = 0, n = p.blobs * 12; k < Math.ceil(n); k++) {   // round drops of jelly scattered round the figure
      const a = rand(k * 2.3 + 2470) * TAU, d = size * (0.48 + rand(k * 3.1 + 2471) * 0.32), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.85, r = size * (0.025 + rand(k * 4.7 + 2472) * 0.045), c = [body, JL.lime, JL.cobalt][k % 3];
      ctx.save(); ctx.globalAlpha = clamp(n - k) * 0.92;
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r); g.addColorStop(0, css(mix(c, [255, 255, 255], 0.5))); g.addColorStop(0.6, css(c)); g.addColorStop(1, css(mix(c, JL.ink, 0.4)));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.42, r * 0.28, r * 0.14, -0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (p.lcd > 0) {   // the display under the figure: the channel's number and four more digits, the unlit segments faint
      const bw = size * (0.5 + 0.45 * p.lcd), bh = bw * 0.24, bx = clamp(cx - bw / 2, room.x0 + 12, room.x1 - bw - 12), by = clamp(cy + size * 0.5, room.y0 + 12, room.y1 - bh - 12), str = `${pad2(env.o ? env.o.catIndex + 1 : 1)}-${String(Math.floor(rand(2480) * 9000 + 1000))}`;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.lcd * 3);
      shift("display", bx + bw / 2, by + bh / 2, ctx);   // a scene object
      ctx.beginPath(); rounded(ctx, bx, by, bw, bh, bh * 0.15); ctx.fillStyle = "#07090b"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2; ctx.stroke();
      const s = bh * 0.62, step = (bw - bh * 0.5) / str.length;
      if (!fast) { ctx.shadowColor = css(JL.amber, 0.9); ctx.shadowBlur = 10; }
      [...str].forEach((ch, i) => segDigit(ctx, ch, bx + bh * 0.3 + i * step, by + (bh - s) / 2, s, css(JL.amber), css(JL.amber, 0.1)));
      ctx.restore();
    }
    avGlow(ctx, p.glow * 0.45);
    return true;
  },
  /** Perfboard: a ring of copper round every hole, 32 apart. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 32, r = 5;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? JL.board : JL.cobalt), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(JL.ink); ctx.lineWidth = 4; run(0, 0); ctx.strokeStyle = css(JL.lime); ctx.lineWidth = 4; run(-nx * 7, -ny * 7); } },
  /** Plain capitals with a glow of the jelly's colour round them (the shadow slider); highlighted words in glossy jelly, a pale band across their upper part. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || jlInk(), hi = o.hi || jlBody(o.C || JL.coral), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css(hi, 0.7) : css(JL.ink, 0.3); ctx.shadowBlur = fs * 0.15 * s * k; ctx.shadowOffsetY = dark ? 0 : fs * 0.04 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -fs * 0.8, 2e5, fs * 0.2); ctx.clip(); ctx.fillStyle = "rgba(255,255,255,0.45)"; pass((a, x) => { if (a.hi) ctx.fillText(a.t, x, 0); }); ctx.restore();
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: JL.ink, light: JL.cream, mid: JL.steel, dark: JL.board, colour: (c) => boost(c, 0.5) }, stroke: { ink: JL.ink, light: JL.cream }, line: 0.7 })),
  sticker: painters({ line: JL.ink, lineScale: 0.5, tone: inkAs(JL.ink, (c) => boost(c, 0.5)), shadow(ctx, draw) { ctx.save(); ctx.translate(5, 8); draw(css(JL.ink, 0.35)); ctx.restore(); } }),
  /** The corner tag: a dark display with amber monospaced letters, glowing. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 2) + f * 1.4, h = f * 1.7, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.18); ctx.fillStyle = "#07090b"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.fillStyle = ink || css(JL.amber); if (!ink) { ctx.shadowColor = css(JL.amber, 0.8); ctx.shadowBlur = 8; } spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 2); ctx.restore();
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the machine's faceplate — a rounded outline and a screw in each corner. */
  frame(ctx, env) {
    const { w, h } = env, ink = jlInk();
    ctx.save(); ctx.beginPath(); rounded(ctx, 22, 22, w - 44, h - 44, 30); ctx.strokeStyle = css(ink, 0.35); ctx.lineWidth = 2; ctx.stroke();
    for (const [x, y] of [[44, 44], [w - 44, 44], [44, h - 44], [w - 44, h - 44]]) {
      const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 9); g.addColorStop(0, "#e4e8ec"); g.addColorStop(1, "#6a747e"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#2a3036"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y + 3); ctx.lineTo(x + 5, y - 3); ctx.stroke();
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 10 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Stickers for a designer-toy poster of jelly creatures and retro electronics — cute, glossy, precise — that read at a glance:
- one clear object per sticker (a little robot, a jellyfish, an octopus, a bee, a flower, a cassette, a joystick, a battery, a game controller), rounded and chunky; no realism, no fine detail;
- flat colour only: the main colour with lime ("green"), cobalt ("blue"), coral ("red") and cream ("white") as partners; "ink" for small dark parts;
- the app adds a thin dark line and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Retro electronics, built as simple models from a few boxes and cylinders — a synthesizer, a speaker, an arcade cabinet, a radio, a robot toy; no realism, no fine detail.
- the renderer paints faces in steel greys and blues with a thin dark line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep blue-grey, and "main" the channel colour made vivid — use it for one to three parts.`,
};

// ====================================================================== skies: the painted skies of anime films
// The clear skies and streets of today's anime films: deep cobalt down to a pale horizon, towering
// cumulus lit snow-white, fleecy altocumulus in rows, a contrail; a utility pole and its wires, crowded
// rooftops, the sea; sun, haze and leaves. By day, or at dusk with the windows and signs lit.
const SK = { ink: [18, 28, 54], white: [255, 255, 255], wire: [24, 28, 42] };
const skSky = () => (dark ? [[18, 22, 64], [92, 66, 146], [252, 172, 128]] : [[20, 72, 180], [58, 142, 228], [182, 220, 244]]);
const skLit = () => (dark ? [255, 212, 186] : [255, 255, 255]), skShade = () => (dark ? [134, 104, 164] : [170, 188, 222]), skDeep = () => (dark ? [72, 56, 112] : [110, 130, 182]);
/**
 * A towering cumulus as the painted skies of anime films show it: rows of lobes narrowing upward over a
 * flat base. The body in shade; every lobe painted again moved toward the sun, soft at its edge, so the
 * lit masses merge and the hollows stay in shade; the higher the lobe, the brighter; the base sunk in a
 * deeper blue. (x, base): the middle of its base; s: its half-width; tall: its height in half-widths.
 */
function cumulus(ctx, x, base, s, tall, k) {
  const lobes = [], rows = Math.max(3, Math.round(3 + tall * 2.2)), lit = skLit(), shade = skShade(), deep = skDeep();
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1), half = s * (1 - 0.6 * t) * (0.85 + rand(k + j * 1.9) * 0.3), cy = base - tall * s * (0.1 + 0.8 * t), n = Math.max(3, Math.round(3 + 5 * (1 - t))), r0 = s * (0.2 + 0.1 * (1 - t));
    for (let i = 0; i < n; i++) { const v = (i / (n - 1)) * 2 - 1; lobes.push([x + v * half * 0.82 + (rand(k + j * 7.3 + i * 2.1) - 0.5) * s * 0.2, cy + (rand(k + j * 3.1 + i * 5.7) - 0.5) * s * 0.24, r0 * (0.75 + rand(k + j * 4.3 + i) * 0.5)]); }
  }
  const big = lobes.length;
  for (let i = 0; i < 56; i++) { const [cx, cy, r] = lobes[Math.floor(rand(k + i * 9.7 + 50) * big)], a = -Math.PI * (0.05 + rand(k + i * 2.9 + 51) * 0.9); lobes.push([cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * (0.22 + rand(k + i * 4.1 + 52) * 0.22)]); }   // small bumps along the top and sides
  const top = base - tall * s, bx0 = x - 1.8 * s, bx1 = x + 1.8 * s, by0 = base - tall * s * 1.35;   // the box the cloud stays in
  ctx.save(); ctx.beginPath(); ctx.rect(x - 4 * s, base - 8 * s, 8 * s, 8 * s); ctx.clip();   // the flat base
  ctx.beginPath(); for (const [cx, cy, r] of lobes) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
  ctx.fillStyle = css(shade); ctx.fill(); ctx.clip();   // the body in shade, its outline crisp
  // The light and shade inside the body are soft all through, so they are painted at a third of the size
  // and laid on enlarged within the crisp outline: a ninth of the pixels to fill.
  const small = canPaint(ctx) && (WORK.skCloud || (WORK.skCloud = document.createElement("canvas"))), m = small && ctx.getTransform();
  let b = ctx;
  if (small) {
    const sw = Math.ceil(ctx.canvas.width / 3), sh = Math.ceil(ctx.canvas.height / 3);
    if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
    b = small.getContext("2d"); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, sw, sh); b.setTransform(m.a / 3, m.b / 3, m.c / 3, m.d / 3, m.e / 3, m.f / 3);
  }
  const g = b.createLinearGradient(0, base - tall * s * 0.45, 0, base); g.addColorStop(0, css(deep, 0)); g.addColorStop(1, css(deep, 0.9)); b.fillStyle = g; b.fillRect(bx0, by0, bx1 - bx0, base - by0);   // the base sunk in deeper blue
  b.fillStyle = css(lit, 0.85); b.beginPath();   // the small bumps along the edge, lit all together
  for (let i = big; i < lobes.length; i++) { const [cx, cy, r] = lobes[i], lr = r * 0.78; b.moveTo(cx - r * 0.2 + lr, cy - r * 0.28); b.arc(cx - r * 0.2, cy - r * 0.28, lr, 0, TAU); }
  b.fill();
  for (const [cx, cy, r] of lobes.slice(0, big)) {   // the big lobes, each in a soft light of its own
    const hf = clamp((base - cy) / Math.max(1, base - top)), lx = cx - r * 0.22, ly = cy - r * 0.32, gg = b.createRadialGradient(lx - r * 0.15, ly - r * 0.2, r * 0.05, lx, ly, r * 0.92), la = 0.55 + 0.45 * hf;
    gg.addColorStop(0, css(lit, la)); gg.addColorStop(0.8, css(lit, la * 0.82)); gg.addColorStop(1, css(lit, 0));   // broad and flat: the lit lobes run together into masses
    b.fillStyle = gg; b.beginPath(); b.arc(lx, ly, r * 0.92, 0, TAU); b.fill();
  }
  const dg = b.createLinearGradient(x - s * 0.6, top, x + s, base); dg.addColorStop(0.4, css(deep, 0)); dg.addColorStop(1, css(deep, 0.5));   // the side away from the sun in shade
  b.fillStyle = dg; b.fillRect(bx0, by0, bx1 - bx0, base - by0);
  if (small) {
    const X0 = Math.max(0, Math.floor((m.e + bx0 * m.a) / 3)), Y0 = Math.max(0, Math.floor((m.f + by0 * m.d) / 3)), X1 = Math.min(small.width, Math.ceil((m.e + bx1 * m.a) / 3)), Y1 = Math.min(small.height, Math.ceil((m.f + base * m.d) / 3));
    if (X1 > X0 && Y1 > Y0) inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(small, X0, Y0, X1 - X0, Y1 - Y0, X0 * 3, Y0 * 3, (X1 - X0) * 3, (Y1 - Y0) * 3); });
  }
  ctx.restore();
}
/**
 * Fleecy altocumulus across the upper sky: rows of little clusters of puffs, each lit from above over a
 * soft shaded underside, smaller and closer together toward the horizon, the rows broken into diagonal
 * drifts; more rows and fuller drifts as `amt` rises.
 */
function fleece(ctx, F, horizon, amt, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, horizon - F.y0), lit = skLit(), shade = skShade(), rows = Math.round(3 + 15 * amt), s0 = Math.min(fw, span) * 0.045, under = [], over = [];
  for (let j = 0; j < rows; j++) {
    const t = j / 18, y = F.y0 + span * 0.7 * (1 - (1 - t) * (1 - t)), s = s0 * (1 - 0.7 * t), gap = s * 2.4;
    for (let x = F.x0 - s + rand(j * 3.3 + k0) * gap, i = 0; x < F.x1 + s; x += gap * (0.6 + rand(j * 7.1 + i * 1.3 + k0) * 0.9), i++) {
      const drift = 0.5 + 0.5 * Math.sin((x + y * 1.8) * 0.0035 + seed) * Math.cos(x * 0.0017 - j * 0.45 + seed * 0.3);
      if (drift < 1 - amt * 1.05) continue;
      const big = s * (0.5 + rand(j * 5.3 + i * 2.9 + k0) * 0.8) * (0.6 + 0.5 * drift), yy = y + (rand(j * 2.2 + i * 4.4 + k0) - 0.5) * s * 0.8;
      for (let q = 0, m = 2 + Math.floor(rand(j * 6.1 + i * 3.7 + k0) * 3); q < m; q++) {   // two to four puffs, the middle ones higher
        const px = x + (q - (m - 1) / 2) * big * 0.7 + (rand(i * 9.1 + q + k0) - 0.5) * big * 0.3, py = yy - Math.sin((q / Math.max(1, m - 1)) * Math.PI) * big * 0.18, r = big * (0.45 + rand(i * 8.3 + q * 1.9 + k0) * 0.3);
        under.push(px, py + r * 0.18, r, r * 0.55); over.push(px - r * 0.06, py - r * 0.1, r * 0.82, r * 0.42);
      }
    }
  }
  // one path each, so overlapping puffs do not darken; painted at a third of the size and laid on enlarged, which softens their edges as a blur would, for far less
  const small = canPaint(ctx) && (WORK.skFleece || (WORK.skFleece = document.createElement("canvas"))), m = small && ctx.getTransform(), W = small && ctx.canvas.width, H = small && ctx.canvas.height;
  let x = ctx;
  if (small) {
    const sw = Math.ceil(W / 3), sh = Math.ceil(H / 3);
    if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
    x = small.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sw, sh); x.setTransform(m.a / 3, m.b / 3, m.c / 3, m.d / 3, m.e / 3, m.f / 3);
  }
  for (const [e, style] of [[under, css(shade, 0.8)], [over, css(lit, 0.95)]]) { x.beginPath(); for (let i = 0; i < e.length; i += 4) { x.moveTo(e[i] + e[i + 2], e[i + 1]); x.ellipse(e[i], e[i + 1], e[i + 2], e[i + 3], 0, 0, TAU); } x.fillStyle = style; x.fill(); }
  if (small) inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(small, 0, 0, W, H); });
}
/**
 * The town in two rows of buildings, the far one hazier: flat faces with a shaded side, rows of windows
 * (lit warm at dusk), and on the roofs water tanks, air conditioners and aerials; signboards on the near
 * row with `signs`, glowing at dusk. Its top is at `top`; its feet below the field.
 */
function skTown(ctx, F, top, signs, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), base = F.y1 + 8, low = skSky()[2];
  const DAY = [[238, 230, 214], [216, 208, 198], [192, 216, 214], [228, 202, 180], [204, 210, 220], [182, 104, 88], [150, 170, 186]], DUSK = [[46, 50, 84], [58, 58, 94], [38, 46, 76], [66, 56, 86], [52, 44, 72]];
  const SIGN = [[226, 48, 52], [36, 92, 196], [250, 196, 40], [30, 150, 100], [240, 240, 236]];
  ctx.save(); ctx.lineCap = "butt";
  for (const far of [true, false]) {
    const rowTop = far ? top : top + (base - top) * 0.32, haze = far ? 0.38 : 0;
    for (let x = F.x0 - 12, i = 0; x < F.x1 + 12; i++) {
      const kk = k0 + (far ? 0 : 500) + i * 7.3, bw = u * (far ? 0.045 + rand(kk) * 0.05 : 0.07 + rand(kk) * 0.08), bh = (base - rowTop) * (0.5 + rand(kk + 1) * 0.5), y0 = base - bh;
      const col = mix((dark ? DUSK : DAY)[Math.floor(rand(kk + 2) * (dark ? DUSK : DAY).length)], dark ? [40, 40, 80] : low, haze);
      const fg = ctx.createLinearGradient(0, y0, 0, base); fg.addColorStop(0, css(mix(col, dark ? [130, 110, 170] : [255, 250, 240], 0.25))); fg.addColorStop(1, css(mix(col, dark ? [10, 10, 30] : [90, 100, 130], 0.3)));   // sunlit at the top, in the street's shade below
      ctx.fillStyle = fg; ctx.fillRect(x, y0, bw, bh);
      ctx.fillStyle = css(mix(col, dark ? [10, 10, 30] : [60, 70, 100], 0.25)); ctx.fillRect(x + bw * 0.78, y0, bw * 0.22, bh);
      ctx.fillStyle = css(mix(col, [0, 0, 0], 0.35)); ctx.fillRect(x - 2, y0 - 3, bw + 4, 4);
      const ws = bw * 0.12, wins = new Map();
      for (let r = 0, y = y0 + bw * 0.16; y < base - ws; r++, y += ws * 2.1) for (let q = 0; q < 3; q++) {
        const on = dark && rand(kk * 3 + r * 1.7 + q) > 0.5, c = on ? [255, 214, 140] : dark ? [24, 26, 52] : mix(col, [70, 92, 124], 0.5), key = c.join();
        (wins.get(key) || wins.set(key, []).get(key)).push(x + bw * (0.1 + q * 0.23), y);
      }
      for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 2) ctx.rect(list[q], list[q + 1], ws * 1.3, ws * 1.2); ctx.fill(); }
      if (!far && rand(kk + 11) > 0.5) { ctx.fillStyle = css(mix(col, [255, 255, 255], dark ? 0.12 : 0.45)); for (let y = y0 + bw * 0.16 + ws * 1.4; y < base; y += ws * 4.2) ctx.fillRect(x + bw * 0.04, y, bw * 0.72, Math.max(1.5, ws * 0.3)); }   // balcony rails
      const kind = rand(kk + 3), rc = css(mix(col, [0, 0, 0], 0.45));   // something on the roof
      ctx.fillStyle = rc; ctx.strokeStyle = rc; ctx.lineWidth = 2;
      if (kind < 0.3) { const tw = bw * 0.3, tx = x + bw * 0.2; ctx.fillRect(tx, y0 - tw * 1.1, tw, tw * 0.8); ctx.beginPath(); ctx.ellipse(tx + tw / 2, y0 - tw * 1.1, tw / 2, tw * 0.15, 0, 0, TAU); ctx.fill(); ctx.fillRect(tx + tw * 0.1, y0 - tw * 0.3, 2, tw * 0.3); ctx.fillRect(tx + tw * 0.85, y0 - tw * 0.3, 2, tw * 0.3); }
      else if (kind < 0.55) { for (let q = 0; q < 2; q++) ctx.fillRect(x + bw * (0.15 + q * 0.4), y0 - bw * 0.14, bw * 0.28, bw * 0.14); }
      else if (kind < 0.8) { const ax = x + bw * (0.3 + rand(kk + 4) * 0.4), ah = bw * (0.5 + rand(kk + 5) * 0.6); ctx.beginPath(); ctx.moveTo(ax, y0); ctx.lineTo(ax, y0 - ah); for (let q = 1; q <= 3; q++) { ctx.moveTo(ax - bw * 0.12 * q * 0.5, y0 - ah * (0.55 + q * 0.12)); ctx.lineTo(ax + bw * 0.12 * q * 0.5, y0 - ah * (0.55 + q * 0.12)); } ctx.stroke(); }
      else { ctx.fillStyle = css(dark ? [34, 34, 60] : [86, 98, 128]); shapeOf(ctx, [[x - bw * 0.06, y0 + 2], [x + bw * 0.5, y0 - bw * 0.32], [x + bw * 1.06, y0 + 2]]); ctx.fill(); }   // a tiled pitched roof
      if (!far && signs > 0 && rand(kk + 6) < signs * 0.9) {   // a signboard down the face
        const sw = bw * 0.22, sh = Math.min(bh * 0.7, sw * (3 + rand(kk + 7) * 2)), sx = x + (rand(kk + 8) > 0.5 ? bw * 0.05 : bw * 0.7), sy = y0 + bh * 0.08, c = SIGN[Math.floor(rand(kk + 9) * SIGN.length)];
        ctx.save(); if (dark && !fast) { ctx.shadowColor = css(c, 0.9); ctx.shadowBlur = 16; }
        ctx.fillStyle = css(dark ? mix(c, [255, 255, 255], 0.15) : c); ctx.fillRect(sx, sy, sw, sh); ctx.restore();
        ctx.fillStyle = css(lum(c) > 0.7 ? [200, 40, 40] : [255, 255, 255], 0.9); for (let q = 0; q < 3; q++) ctx.fillRect(sx + sw * 0.25, sy + sh * (0.1 + q * 0.3), sw * 0.5, sh * 0.18);
      }
      x += bw * (0.88 + rand(kk + 10) * 0.2);
    }
  }
  ctx.restore();
}
/** A utility pole standing up out of the town at x, its crossarms and insulators, a transformer; `n` wires (the last coming in by degrees) sagging away across the sky to the far edge. */
function utilityPole(ctx, F, x, n, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, s = Math.min(fw, fh) * 0.011, base = F.y1 + 10, top = F.y0 + fh * 0.06, col = css(dark ? [14, 14, 32] : SK.wire);
  const a = Math.min(1, (n - 1) / 5.5);   // the pole and its first wires come in over the first half of the slider
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.globalAlpha = a;
  shapeOf(ctx, [[x - s * 0.7, base], [x - s * 0.45, top], [x + s * 0.45, top], [x + s * 0.7, base]]); ctx.fill();
  const arms = [top + s * 3, top + s * 8, top + s * 13], ends = [];
  arms.forEach((y, a) => {
    const half = s * (7 - a * 1.2); ctx.fillRect(x - half, y, half * 2, s * 0.7);
    for (let i = 0; i < 4; i++) { const ix = x - half + s * 0.6 + (i * (half * 2 - s * 1.2)) / 3; ctx.fillRect(ix - s * 0.25, y - s * 1.1, s * 0.5, s * 1.1); ends.push([ix, y - s * 1.1]); }
  });
  ctx.beginPath(); rounded(ctx, x + s * 0.9, top + s * 16, s * 2.6, s * 4.2, s * 0.5); ctx.fill();
  for (let i = 0; i < 5; i++) ctx.fillRect(x - s * 0.9, top + s * (20 + i * 3.4), s * 1.8, s * 0.35);   // the steps
  ctx.lineCap = "round";
  for (let k = 0; k < Math.ceil(n) && k < ends.length; k++) {
    const [ix, iy] = ends[k], to = F.x0 - fw * 0.05, ty = iy + fh * (rand(k * 2.7 + k0) - 0.3) * 0.3, sag = fh * (0.05 + rand(k * 3.9 + k0) * 0.1);
    ctx.globalAlpha = clamp(n - k) * a; ctx.lineWidth = 1.3 + rand(k + k0) * 1.4;
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.quadraticCurveTo((ix + to) / 2, (iy + ty) / 2 + sag * 2, to, ty); ctx.stroke();
    if (k % 3 === 0) { ctx.beginPath(); ctx.moveTo(ix, iy); ctx.quadraticCurveTo(ix + fw * 0.06, iy + sag * 0.5, F.x1 + 10, iy + fh * 0.05); ctx.stroke(); }   // and a short run out the near side
  }
  ctx.restore();
}
/** A cluster of leaves spilling in from (x, y): dark ones underneath, sunlit ones on top toward the light; more of them and further in as `amt` rises. */
function foliage(ctx, x, y, R, amt, dirX, dirY, k0) {
  const n = Math.round(60 + 200 * amt), tones = dark ? [[10, 22, 26], [20, 40, 40], [44, 70, 56]] : [[26, 62, 40], [62, 122, 56], [168, 208, 92]];
  ctx.save();
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = css(tones[pass]); ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (Math.floor(rand(i * 1.9 + k0) * 3) !== pass) continue;
      const a = rand(i * 2.7 + k0 + 1) * Math.PI * 0.5, d = R * Math.sqrt(rand(i * 3.3 + k0 + 2)), lx = x + dirX * Math.cos(a) * d, ly = y + dirY * Math.sin(a) * d, r = R * (0.03 + rand(i * 4.1 + k0 + 3) * 0.03), t = rand(i * 5.3 + k0 + 4) * Math.PI;
      ctx.moveTo(lx + Math.cos(t) * r, ly + Math.sin(t) * r); ctx.ellipse(lx, ly, r, r * 0.45, t, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
}
const skies = {
  id: "skies",
  repaint: (c) => `a background painting from a contemporary anime film made from the photograph: a deep cobalt sky with towering sunlit cumulus and fleecy altocumulus, crisp detailed rooftops and power lines, saturated clean colour, soft haze and a little lens flare, with ${c} as an accent; still the same place, no text.`,
  about: { zh: "动画晴空：当代动画电影里那种通透的天空和街景——深钴蓝渐变到地平线的淡青，高高堆起、受光面雪白的积雨云，一排排絮状的高积云，飞机拉出的长长尾迹；前景是电线杆和交错的电线，楼顶挤满水箱、空调外机和天线的街区，招牌灯箱，远处一片海；阳光与光斑、空气感、前景枝叶。浅色是盛夏白天，深色是黄昏到入夜，窗户和灯箱亮起来。明亮、清澈、怀念——适合旅行、城市、日常、青春、音乐和治愈系内容。照片会被调得更通透鲜艳。自带平直的版式。", en: "Anime skies: the clear skies and streets of today's anime films — deep cobalt down to a pale horizon, towering cumulus with snow-white sunlit tops, rows of fleecy altocumulus, a plane's long contrail; in front, a utility pole and its crossing wires, rooftops crowded with water tanks, air conditioners and aerials, lit signs, the sea in the distance; sun and flare, haze, leaves. The light theme is a summer day, the dark one dusk into night with the windows and signs lit. Bright, clear, nostalgic — for travel, cities, everyday life, youth, music and feel-good content. A photo is made clearer and more vivid. Flat layouts of its own." },
  name: { zh: "动画晴空", en: "Anime skies" },
  seeded: true,
  scene: { sun: { zh: "阳光", en: "Sunlight" }, cumulus: { zh: "积雨云", en: "Cumulonimbus" }, contrail: { zh: "飞机云", en: "Contrails" }, pole: { zh: "电线杆", en: "Pole and wires" }, leaves: { zh: "前景枝叶", en: "Leaves" } },
  params: [
    { key: "cumulus", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "积雨云", en: "Cumulus" } },
    { key: "fleece", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "絮状云", en: "Fleecy clouds" } },
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "阳光", en: "Sunlight" } },
    { key: "contrail", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "飞机云", en: "Contrails" } },
    { key: "wires", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "电线杆", en: "Pole and wires" } },
    { key: "town", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "街区", en: "Town" } },
    { key: "signs", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "招牌灯箱", en: "Signs" } },
    { key: "sea", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "海面", en: "Sea" } },
    { key: "leaves", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "前景枝叶", en: "Leaves" } },
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "空气感", en: "Haze" } },
    { key: "vivid", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片通透", en: "Photo clarity" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(skSky()[1]), text: css(SK.white), dim: css(SK.white, 0.75), titleFill: css(SK.white), titleInk: css(SK.ink), grid: () => css(SK.white, 0.18) }),
  /**
   * The ground is the sky down to the horizon (above the town, or above the sea when there is one); over
   * it, or over the base's grid or nothing, each by its slider, from the back: the sun's rays, fleecy clouds,
   * contrails, the great cumulus standing on the horizon, haze along it, the sea, the town, the pole and its
   * wires, leaves. A photo is made clearer and more vivid; filling
   * the canvas, it gets the sun and the haze too.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, sky = skSky();
    const townTop = F.y1 - fh * 0.36 * p.town, horizon = townTop + fh * (0.03 - 0.16 * p.sea);
    const haze = (x, a) => { if (a <= 0) return; const g = x.createLinearGradient(0, horizon - fh * 0.35, 0, horizon + 4); g.addColorStop(0, css(sky[2], 0)); g.addColorStop(1, css(mix(sky[2], [255, 255, 255], 0.4), 0.75 * a)); x.fillStyle = g; x.fillRect(0, horizon - fh * 0.35, w, fh * 0.35 + 4); };
    if (env.photo) {
      env.drawPhoto();
      if (p.vivid > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.5 * p.vivid; env.drawPhoto();
        ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.3 * p.vivid; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, w, h);
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(dark ? [70, 50, 170] : [20, 110, 255], 0.6)); g.addColorStop(0.55, "rgba(128,128,128,0)"); g.addColorStop(1, css(dark ? [255, 150, 90] : [255, 200, 130], 0.5));
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.vivid; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (L.fill) { godRays(ctx, w, h, p.sun * 0.6, dark ? 1 : 0); if (p.sun > 0) lensFlare(ctx, w, h, p.sun * 0.5); }
      return true;
    }
    // the sky and all that is in it, painted once and kept until one of its sliders changes (see keptLayer):
    // the sea, the town, the pole and the leaves in front of it are cheap to paint over it again. The scene
    // objects in it (the sun, the cumulus, the contrails) are placed here, on ctx, as a kept sky would not
    // place them again; what is in the kept sky is moved by the difference
    const moveOf = (key, x0, y0, on) => { if (!on || !L.grid) return [0, 0]; const [x1, y1] = objAt(key, x0, y0, ctx); return [x1 - x0, y1 - y0]; };
    const sunMove = moveOf("sun", ...raysAt(w, h), p.sun > 0), roomC = Math.max(u * 0.1, horizon - F.y0 - fh * 0.08);
    const cuMove = moveOf("cumulus", F.x0 + fw * 0.6, horizon - roomC * 0.45, p.cumulus > 0), coMove = moveOf("contrail", F.x0 + fw * 0.45, F.y0 + fh * 0.22, p.contrail > 0);
    const rays = (x, amt) => {   // the sun's rays: soft beams, so painted at a quarter of the size and laid on enlarged
      if (amt <= 0) return;
      if (!canPaint(x)) { godRays(x, w, h, amt, dark ? 1 : 0, null, sunMove); return; }
      const small = WORK.skRays || (WORK.skRays = document.createElement("canvas")), m = x.getTransform(), W = x.canvas.width, H = x.canvas.height, sw = Math.ceil(W / 4), sh = Math.ceil(H / 4);
      if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
      const r = small.getContext("2d"); r.setTransform(1, 0, 0, 1, 0, 0); r.clearRect(0, 0, sw, sh); r.setTransform(m.a / 4, m.b / 4, m.c / 4, m.d / 4, m.e / 4, m.f / 4);
      godRays(r, w, h, amt, dark ? 1 : 0, null, sunMove);
      inPixels(x, () => { x.globalCompositeOperation = "screen"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(small, 0, 0, W, H); });
    };
    if (L.ground !== false) {   // the sky itself, down to the horizon: the ground
      const g = ctx.createLinearGradient(0, F.y0, 0, Math.max(F.y0 + 10, horizon)); g.addColorStop(0, css(sky[0])); g.addColorStop(0.55, css(sky[1])); g.addColorStop(1, css(sky[2]));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    rays(ctx, p.sun * 0.55);   // screened onto what is there: painted each time, as a kept layer on its own could not screen it
    const paintSky = (x) => {
      if (p.fleece > 0) fleece(x, F, horizon, p.fleece, 2500);
      x.save(); x.translate(coMove[0], coMove[1]);
      for (let k = 0, n = p.contrail * 2; k < Math.ceil(n); k++) {   // a plane's trail, fading out behind it
        const y0 = F.y0 + fh * (0.12 + rand(k * 2.3 + 2510) * 0.3), x1 = F.x0 + fw * (0.45 + rand(k * 3.1 + 2511) * 0.45), y1 = y0 - fh * (0.04 + rand(k * 3.7 + 2512) * 0.12), x0 = F.x0 - 20, a = clamp(n - k);
        const tr = x.createLinearGradient(x0, y0, x1, y1); tr.addColorStop(0, css(SK.white, 0)); tr.addColorStop(1, css(SK.white, 0.85 * a));
        x.save(); x.lineCap = "round"; x.strokeStyle = tr;
        x.lineWidth = u * 0.022; x.globalAlpha = 0.35; x.beginPath(); x.moveTo(x0, y0 + 6); x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + fh * 0.02, x1, y1); x.stroke();
        x.lineWidth = u * 0.006; x.globalAlpha = 1; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + fh * 0.02, x1, y1); x.stroke();
        x.fillStyle = css(SK.white, a); x.beginPath(); x.arc(x1, y1, u * 0.003, 0, TAU); x.fill(); x.restore();
      }
      x.restore();
      const ramp = (v, a, b) => clamp((v - a) / (b - a)), room = Math.max(u * 0.1, horizon - F.y0 - fh * 0.08), c = p.cumulus;
      const mass = (fx, k, size, tall, grow) => { if (grow <= 0) return; const s = Math.min(u * size * (0.15 + 0.85 * grow), room / (tall * 1.05)); if (s > u * 0.02) cumulus(x, F.x0 + fw * fx, horizon, s, tall, k); };
      x.save(); x.translate(cuMove[0], cuMove[1]);
      mass(0.5 + rand(2520) * 0.1, 2521, 0.14, 1.1, ramp(c, 0.55, 0.95));      // far off, small
      mass(0.88 + rand(2522) * 0.08, 2523, 0.16, 1.3, ramp(c, 0.7, 1));
      mass(0.15 + rand(2524) * 0.12, 2525, 0.24, 1.5, ramp(c, 0.3, 0.85));
      mass(0.68 + rand(2526) * 0.1, 2527, 0.32, 1.9, ramp(c, 0, 0.7));        // the great tower, first
      x.restore();
      haze(x, p.haze);
    };
    if (p.fleece > 0 || p.contrail > 0 || p.cumulus > 0 || p.haze > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "skSky", [dark, seed, w, h, F.x0, F.y0, F.x1, F.y1, horizon.toFixed(2), p.fleece, p.contrail, p.cumulus, p.haze, sceneKey()].join("|"), paintSky);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintSky(ctx);
    }
    if (p.sea > 0) {   // the sea from the horizon down behind the town, a sun-glitter path on it
      const sg = ctx.createLinearGradient(0, horizon, 0, F.y1); sg.addColorStop(0, css(dark ? [120, 96, 150] : [92, 158, 214])); sg.addColorStop(1, css(dark ? [34, 30, 76] : [18, 84, 166]));
      ctx.save(); ctx.globalAlpha = Math.min(1, p.sea * 4); ctx.fillStyle = sg; ctx.fillRect(0, horizon, w, F.y1 - horizon + 8);
      ctx.fillStyle = css(dark ? [255, 200, 160] : SK.white, 0.8);
      for (let k = 0, n = Math.round(160 * p.sea); k < n; k++) { const y = horizon + (F.y1 - horizon) * rand(k * 2.1 + 2530) ** 1.6, x = F.x0 + fw * (0.68 + (rand(k * 3.3 + 2531) - 0.5) * (0.12 + 0.5 * (y - horizon) / Math.max(1, F.y1 - horizon))), l = 3 + rand(k * 4.1 + 2532) * 14; ctx.fillRect(x, y, l, 1.6); }
      ctx.restore();
    }
    if (p.town > 0) skTown(ctx, F, townTop, p.signs, 2540);
    if (p.wires > 0) { ctx.save(); shift("pole", F.x0 + fw * 0.9, F.y0 + fh * 0.35, ctx); utilityPole(ctx, F, F.x0 + fw * 0.9, 1 + 11 * p.wires, 2560); ctx.restore(); }   // a scene object
    if (p.leaves > 0) {   // a scene object
      ctx.save(); shift("leaves", F.x1 - u * 0.14, F.y0 + u * 0.12, ctx);
      foliage(ctx, F.x1, F.y0, u * 0.44 * Math.sqrt(0.1 + 0.9 * p.leaves), p.leaves, -1, 1, 2570);   // a branch in from the top corner, its area growing evenly
      ctx.restore();
    }
    avGlow(ctx, p.haze * 0.3);
    return true;
  },
  /** A background painter's perspective guide: the horizon, and lines fanning out from a vanishing point on it. */
  gridLines(ctx, env, color) {
    const { w, h } = env, vx = w * 0.5, vy = h * 0.64, R = Math.hypot(w, h), r0 = 70;
    gridPen(ctx, color); ctx.beginPath();
    ctx.moveTo(0, vy); ctx.lineTo(w, vy);
    for (let a = 0; a < 360; a += 7.5) { const t = (a * Math.PI) / 180; ctx.moveTo(vx + Math.cos(t) * r0, vy + Math.sin(t) * r0); ctx.lineTo(vx + Math.cos(t) * R, vy + Math.sin(t) * R); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(boost(C, 0.4)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(SK.white, 0.9); ctx.lineWidth = 5; run(-nx * 4, -ny * 4); } },
  /** White letters with a soft shadow (by day a deep blue, at dusk a warm glow: the shadow slider); highlighted words in the channel colour, brightened. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || SK.white, hi = o.hi || mix(boost(o.C || [255, 200, 80], 0.5), SK.white, 0.25), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css([255, 140, 90], 0.6) : css(SK.ink, 0.55); ctx.shadowBlur = fs * 0.12 * s * k; ctx.shadowOffsetY = fs * 0.03 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: SK.ink, light: SK.white, mid: [200, 214, 232], dark: [40, 60, 100], colour: (c) => boost(c, 0.4) }, stroke: { ink: SK.ink, light: SK.white }, line: 0.7 })),
  sticker: painters({ line: SK.ink, lineScale: 0.6, tone: inkAs(SK.ink, (c) => boost(c, 0.4)), shadow(ctx, draw) { ctx.save(); ctx.translate(4, 6); draw(css(SK.ink, 0.25)); ctx.restore(); } }),
  /** The corner tag: a white pill, deep blue lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(SK.ink, 0.3); ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(SK.white, 0.92); ctx.fill(); ctx.restore();
    ctx.fillStyle = ink || css(SK.ink); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a thin white line round the picture, rounded, as a film still is shown. */
  frame(ctx, env) { const { w, h } = env; ctx.save(); ctx.beginPath(); rounded(ctx, 24, 24, w - 48, h - 48, 18); ctx.strokeStyle = css(SK.white, 0.6); ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); },
  image(ctx, C, unit) { ctx.shadowColor = css(SK.ink, 0.35); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, 0.12, unit); },
  prompt: `Stickers for a sunny anime-film street scene — clear, fresh and nostalgic — that read at a glance:
- one clear object per sticker (a vending machine, a bicycle, a cat, a paper plane, a cloud, a wind chime, an ice lolly, a school bag, a train), simple and friendly; no realism, no fine detail;
- flat colour only, clean and bright: the main colour with "blue" (sky), "white", "green" and "yellow" as partners; "ink" comes out deep navy — for small details only;
- the app adds a thin navy line and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a Japanese street in summer, built as simple models from a few boxes and cylinders — a vending machine, a utility pole, a bus stop, a water tank, a small shop; no realism, no fine detail.
- the renderer paints faces in clean bright tones with a thin navy line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep navy, and "main" the channel colour made vivid — use it for one to three parts.`,
};

// ====================================================================== spectrum: the stipple print that bleeds a rainbow
// A black-and-white stipple engraving on cream paper — the subject in dots and fine lines — out of which
// the spectrum runs: threads of colour streaming to the edge and turning up at a right angle, dripping
// down, ringing a dark vortex, running to the horizon, rolling in waves, stacked in blocks; a mat and frame.
const SP = { paper: [238, 233, 218], ink: [26, 24, 22], night: [14, 14, 14], white: [236, 232, 220], mat: [228, 222, 206], wood: [176, 150, 116] };
const SPEC = [[226, 62, 58], [244, 128, 44], [246, 196, 48], [120, 186, 72], [44, 160, 140], [48, 120, 200], [96, 76, 180], [190, 80, 160]];
const spGround = () => (dark ? SP.night : SP.paper), spInk = () => (dark ? SP.white : SP.ink);
/** A colour of the printed spectrum at t (0–1, wrapping). */
const spec = (t) => { const n = SPEC.length, f = (((t % 1) + 1) % 1) * n, i = Math.floor(f); return mix(SPEC[i], SPEC[(i + 1) % n], f - i); };
function spPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.36 + 0.4 * p.figure);
  return { F, cx: F.x0 + fw * 0.58, cy: F.y0 + fh * 0.42, size };
}
/**
 * The figure engraved in stipple: dots of ink thick along the edge and on the side turned from the
 * light (its lower right, read from a blurred copy of the silhouette moved that way), sparse where it
 * faces the light. `dens` (0–1) sets how dark it prints.
 */
function stippleShape(ctx, S, cx, cy, size, dens, colour, k0) {
  const cell = Math.max(2.6, size / 120), x0 = cx - size * 0.8, y0 = cy - size * 0.62, cols = Math.ceil((size * 1.6) / cell), rows = Math.ceil((size * 1.24) / cell), cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
  const R = Math.max(4, Math.round(Math.min(cols, rows) / 9)), tmp = new Float32Array(cols * rows), bl = new Float32Array(cols * rows);   // a broad box blur of the coverage, both ways: how deep inside the shape a cell is
  for (let j = 0; j < rows; j++) { let s = 0; for (let i = -R; i < cols + R; i++) { if (i + R < cols) s += cov[j * cols + Math.max(0, i + R)]; if (i - R - 1 >= 0) s -= cov[j * cols + i - R - 1]; if (i >= 0 && i < cols) tmp[j * cols + i] = s / (2 * R + 1) / 255; } }
  for (let i = 0; i < cols; i++) { let s = 0; for (let j = -R; j < rows + R; j++) { if (j + R < rows) s += tmp[Math.max(0, j + R) * cols + i]; if (j - R - 1 >= 0) s -= tmp[(j - R - 1) * cols + i]; if (j >= 0 && j < rows) bl[j * cols + i] = s / (2 * R + 1); } }
  ctx.save(); ctx.fillStyle = css(colour); ctx.beginPath();
  for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
    const q = j * cols + i, c = cov[q] / 255;
    if (c <= 0.02) continue;
    // turned from the light: the blurred shape read a little toward the lower right thins out near that edge
    const off = bl[Math.min(rows - 1, j + Math.round(R * 0.8)) * cols + Math.min(cols - 1, i + Math.round(R * 0.6))], band = 1 - Math.abs(bl[q] * 2 - 1), dir = (i / cols - 0.5) * 0.5 + (j / rows - 0.5) * 0.7;
    const tone = c * clamp((0.04 + Math.pow(1 - off, 1.3) + 0.35 * band + 0.3 * dir) * (0.45 + 0.9 * dens));
    if (rand(q * 1.37 + k0) > tone) continue;
    const x = x0 + (i + rand(q * 2.3 + k0 + 1)) * cell, y = y0 + (j + rand(q * 3.1 + k0 + 2)) * cell, r = cell * (0.25 + 0.25 * tone);
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill(); ctx.restore();
}
/**
 * Threads of the spectrum streaming from the band y0–y1 at x across to the right: each its own colour and
 * weight, close-packed; with `turn`, the upper ones bend through a rounded right angle and climb out of
 * the top, nested inside one another. `n` threads.
 */
function spectrumStream(ctx, x, y0, y1, xEnd, top, n, turn, k0) {
  ctx.save(); ctx.lineCap = "butt"; ctx.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const t = (i + rand(i * 1.3 + k0) * 0.6) / n, y = y0 + (y1 - y0) * t, xs = x + (rand(i * 2.1 + k0 + 1) - 0.3) * (y1 - y0) * 0.4, up = turn && t < 0.55, tx = xEnd - (y1 - y0) * 0.55 + (y - y0), r = Math.min(40, (y - y0) * 0.6 + 8);
    ctx.strokeStyle = css(spec(rand(i * 3.7 + k0 + 2))); ctx.lineWidth = 0.8 + rand(i * 4.3 + k0 + 3) * 2.2;
    ctx.beginPath(); ctx.moveTo(xs, y);
    if (up) { ctx.lineTo(tx - r, y); ctx.arcTo(tx, y, tx, y - r, r); ctx.lineTo(tx, top); } else ctx.lineTo(xEnd, y);
    ctx.stroke();
  }
  ctx.restore();
}
const spectrum = {
  id: "spectrum",
  art: "figure",
  repaint: (c) => `a black-and-white stipple engraving made from the photograph, fine ink dots and lines on cream paper, with streams of thin rainbow-coloured lines flowing out of it like light spectra, minimal and surreal, with ${c} among the colours; no text.`,
  about: { zh: "光谱版画：黑白点刻版画里流出彩虹——频道图形用点刻刻成一幅老式铜版画，米白纸上墨色细密；从它身上流出一束束光谱色的细线，横着拉到画边、在拐角直角折上去，或者垂直滴流下来；可加同心的光谱漩涡、汇向地平线的彩色透视线、起伏的彩色波纹、一块块彩色横纹条、雕版横线的天空，以及米白卡纸和木边画框。安静又迷幻——适合艺术、设计、音乐、哲思、科技与自然类内容。照片会被刻成一行行粗细起伏的线刻版画。可选米白纸或黑纸；自带平直的版式。", en: "Spectral engraving: rainbows running out of a black-and-white stipple print — the channel graphic engraved in stipple like an old copperplate, fine ink on cream paper; out of it stream threads of the spectrum, drawn to the edge and turned up at a right angle, or dripping down; a concentric spectral vortex, coloured perspective lines running to the horizon, rolling rainbow waves, blocks of coloured lines, a sky of engraved lines, and a cream mat in a wooden frame if you like. Quiet yet psychedelic — for art, design, music, ideas, science and nature. A photo is engraved in level lines that swell with its shadows. Cream or black paper; flat layouts of its own." },
  name: { zh: "光谱版画", en: "Spectral engraving" },
  seeded: true,
  scene: { figure: { zh: "点刻身影", en: "Stippled figure" }, vortex: { zh: "光谱漩涡", en: "Vortex" }, road: { zh: "透视光轨灭点", en: "Vanishing point of the lines" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点刻身影", en: "Stippled figure" } },
    { key: "stipple", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点刻浓淡", en: "Stipple depth" } },
    { key: "stream", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "光谱流线", en: "Spectral streams" } },
    { key: "drip", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "垂直滴流", en: "Drips" } },
    { key: "vortex", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光谱漩涡", en: "Vortex" } },
    { key: "road", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "透视光轨", en: "Perspective lines" } },
    { key: "waves", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "彩色波纹", en: "Rainbow waves" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "彩色条块", en: "Colour blocks" } },
    { key: "engrave", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "雕版横线", en: "Engraved sky" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸纹", en: "Paper" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "卡纸画框", en: "Mat and frame" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片版画", en: "Photo engraved" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(spGround()), text: css(spInk()), dim: css(spInk(), 0.6), titleFill: css(spInk()), titleInk: css(spGround()), grid: () => css(spInk(), 0.14) }),
  /**
   * The paper; an engraved sky; the vortex behind the figure; lines running to the horizon at its feet;
   * waves along the foot of the field; streams and drips (begun under the figure, so they come out of
   * it); the stippled figure; blocks of coloured lines. A photo is engraved over the paper in level lines,
   * and when it fills the canvas the streams and blocks come out of its middle.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ink = spInk();
    if (L.ground !== false) { ctx.fillStyle = css(spGround()); ctx.fillRect(0, 0, w, h); }
    const engrave = (F) => {   // fine level lines, close at the top and opening out downward
      if (p.engrave <= 0) return;
      const fh = F.y1 - F.y0, deep = F.y0 + fh * (0.2 + 0.5 * p.engrave);
      ctx.save(); ctx.fillStyle = css(ink);
      for (let y = F.y0, i = 0; y < deep; i++, y += 4.5) { ctx.globalAlpha = 0.5 * (1 - (y - F.y0) / (deep - F.y0)) * Math.min(1, p.engrave * 2); ctx.fillRect(F.x0, y, F.x1 - F.x0, 0.9 + rand(i + 2600) * 0.5); }
      ctx.restore();
    };
    const streams = (at, F) => {
      const { cx, cy, size } = at;
      if (p.stream > 0) spectrumStream(ctx, cx, cy - size * 0.2, cy + size * (0.0 + 0.25 * p.stream), F.x1 + 4, F.y0 - 4, Math.round(10 + 110 * p.stream), p.stream > 0.4, 2610);
      if (p.drip > 0) {   // threads dripping from the figure, in spectrum order across it
        ctx.save(); ctx.lineCap = "butt";
        for (let i = 0, n = Math.round(10 + 140 * p.drip); i < n; i++) { const t = i / n, x = cx - size * 0.32 + size * 0.64 * t, len = (F.y1 - cy) * (0.25 + 0.75 * rand(i * 2.7 + 2620)) * (0.3 + 0.7 * p.drip); ctx.strokeStyle = css(spec(t * 0.9 + rand(i + 2621) * 0.08)); ctx.lineWidth = 0.8 + rand(i * 3.3 + 2622) * 1.8; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy + size * 0.3 + len); ctx.stroke(); }
        ctx.restore();
      }
    };
    const bars = (at, F) => {
      for (let k = 0, n = p.bars * 6; k < Math.ceil(n); k++) {
        const bw = (F.x1 - F.x0) * (0.08 + rand(k * 2.1 + 2630) * 0.2), bh = (F.y1 - F.y0) * (0.03 + rand(k * 2.9 + 2631) * 0.1), x = clamp(at.cx + (rand(k * 3.7 + 2632) - 0.45) * at.size * 1.6, F.x0, F.x1 - bw), y = clamp(at.cy + at.size * (0.05 + rand(k * 4.3 + 2633) * 0.55), F.y0, F.y1 - bh);
        ctx.save(); ctx.globalAlpha = clamp(n - k);
        for (let yy = y, i = 0; yy < y + bh; yy += 3, i++) { ctx.fillStyle = css(spec(rand(k * 31 + i * 1.7 + 2634))); ctx.fillRect(x + (rand(k * 7 + i * 2.3 + 2635) - 0.5) * bw * 0.1, yy, bw * (0.75 + rand(k * 5 + i * 3.1 + 2636) * 0.25), 1.8); }
        ctx.restore();
      }
    };
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.mono > 0 && canPaint(ctx)) {   // the photo engraved: paper over it, then level lines swelling where it was dark and lifting a little with the tone, as a burin cuts them
        const pitch = Math.max(3, u * (fast ? 0.01 : 0.0065)), cols = Math.ceil(w / pitch) + 1, rows = Math.ceil(h / pitch), px = sampled(ctx, 0, 0, cols, rows, pitch, "spPhoto");
        ctx.save(); ctx.globalAlpha = p.mono; ctx.fillStyle = css(spGround()); ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = css(ink); ctx.beginPath();
        for (let j = 0; j < rows; j++) {
          const y = (j + 0.5) * pitch, th = [];
          for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4, l = (px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) / 65280; th.push(px[q + 3] < 128 ? 0 : clamp((dark ? l : 1 - l) * 1.1 - 0.04)); }
          const at = (i, s) => y + (th[i] - 0.5) * pitch * 0.3 + s * th[i] * pitch * 0.48;
          ctx.moveTo(0, at(0, -1));
          for (let i = 1; i < cols; i++) ctx.lineTo(i * pitch, at(i, -1));
          for (let i = cols - 1; i >= 0; i--) ctx.lineTo(i * pitch, at(i, 1));
          ctx.closePath();
        }
        ctx.fill(); ctx.restore();
      }
      if (L.fill) { const F = { x0: 0, y0: 0, x1: w, y1: h }, at = { cx: w * 0.5, cy: h * 0.48, size: h * 0.5 }; engrave(F); streams(at, F); bars(at, F); }
      return true;
    }
    if (!L.grid) return true;
    const at = spPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, { size } = at;
    if (p.figure > 0) [at.cx, at.cy] = objAt("figure", at.cx, at.cy, ctx);   // a scene object: the vortex, the lines, threads and bars go with it
    const { cx, cy } = at;
    engrave(F);
    if (p.vortex > 0) {   // rings of colour round a dark centre, the centre stippled out into the paper
      const R = size * (0.45 + 0.4 * p.vortex), [vx, vy] = objAt("vortex", cx, cy - size * 0.32, ctx);   // a scene object
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0, n = Math.round(30 + 140 * p.vortex); i < n; i++) { const t = i / n, r = R * (0.36 + 0.64 * t), a0 = rand(i * 2.3 + 2650) * TAU, len = (0.4 + rand(i * 3.1 + 2651) * 1.5) * Math.PI; ctx.strokeStyle = css(spec(rand(i * 4.7 + 2652)), 0.9 * (1 - t * 0.6)); ctx.lineWidth = 0.8 + rand(i * 5.3 + 2653) * 2; ctx.beginPath(); ctx.arc(vx, vy, r, a0, a0 + len); ctx.stroke(); }
      ctx.fillStyle = css(ink); ctx.beginPath(); ctx.arc(vx, vy, R * 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); for (let i = 0; i < 1400; i++) { const a = rand(i * 1.9 + 2654) * TAU, d = R * (0.3 + 0.08 * rand(i * 2.7 + 2655) ** 0.5), r = 0.8 + rand(i + 2656) * 0.8; ctx.moveTo(vx + Math.cos(a) * d + r, vy + Math.sin(a) * d); ctx.arc(vx + Math.cos(a) * d, vy + Math.sin(a) * d, r, 0, TAU); } ctx.fill();
      ctx.restore();
    }
    if (p.road > 0) {   // lines from the horizon at the figure's feet out to the foot of the field: the near side in colour, the far side in ink
      const [rx, vy] = objAt("road", cx, Math.min(F.y1 - fh * 0.08, cy + size * 0.5), ctx), n = Math.round(30 + 150 * p.road);   // their vanishing point: a scene object
      ctx.save(); ctx.globalAlpha = Math.min(1, p.road * 3);
      for (let i = 0; i < n; i++) { const t = i / n, xb = F.x0 - fw * 0.6 + fw * 2.2 * t, wd = 0.6 + rand(i * 2.1 + 2660) * 2.2; shapeOf(ctx, [[rx, vy], [xb - wd, F.y1 + 4], [xb + wd, F.y1 + 4]]); ctx.fillStyle = xb < rx ? css(spec(rand(i * 3.3 + 2661))) : css(ink, 0.7); ctx.fill(); }
      ctx.fillStyle = css(ink, 0.6); ctx.fillRect(F.x0, vy - 0.6, fw, 1.2);
      ctx.restore();
    }
    if (p.waves > 0) {   // bands of parallel waving lines in spectrum order along the foot of the field
      ctx.save(); ctx.lineCap = "round";
      for (let b = 0, nb = p.waves * 3; b < Math.ceil(nb); b++) {
        const m = 14 + b * 4, yb = F.y1 - fh * (0.06 + 0.13 * b), A = fh * (0.02 + 0.03 * p.waves), fr = 0.006 + rand(b * 2.3 + 2670) * 0.004, ph = rand(b * 3.1 + 2671) * TAU;
        ctx.globalAlpha = clamp(nb - b);
        for (let j = 0; j < m; j++) { ctx.strokeStyle = css(spec(j / m + b * 0.3)); ctx.lineWidth = 1.6; ctx.beginPath(); for (let x = F.x0; x <= F.x1 + 8; x += 8) { const y = yb + j * 2.6 + A * Math.sin(x * fr + ph + j * 0.06) + A * 0.4 * Math.sin(x * fr * 2.7 + ph * 1.3); x === F.x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
      }
      ctx.restore();
    }
    streams(at, F);
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      placeShape(ctx, S, spGround(), cx, cy, size);   // the paper under it, so the threads it covers start from its edge
      stippleShape(ctx, S, cx, cy, size, p.stipple, ink, 2680);
    }
    bars(at, F);
    return true;
  },
  /** An engraver's level lines across the plate, every 18, swelling gently as a burin's do. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = 9, j = 0; y < h; y += 18, j++) for (let x = 0; x <= w + 24; x += 24) { const yy = y + Math.sin(x * 0.006 + j * 0.45) * 3; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? [30, 30, 28] : SP.mat), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(spInk()); ctx.lineWidth = 2.5; run(0, 0); for (let i = 0; i < 6; i++) { ctx.strokeStyle = css(spec(i / 6)); ctx.lineWidth = 2; run(-nx * (6 + i * 3), -ny * (6 + i * 3)); } } },   // a mat with the spectrum running along its edge
  /** Ink capitals standing on a stack of offset copies in spectrum colours (the shadow slider); highlighted words filled with the spectrum. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), ink = o.fill || spInk(), n = Math.round(3 + 4 * s);
    if (s > 0) for (let i = n; i >= 1; i--) { ctx.fillStyle = css(spec(i / n)); pass((a, x) => ctx.fillText(a.t, x + fs * 0.008 * i, fs * 0.014 * i)); }
    pass((a, x) => {
      if (a.hi && !o.hi) { const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width }, g = ctx.createLinearGradient(r.x0, 0, r.x1, 0); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, css(spec(i / 7))); ctx.fillStyle = g; }   // across the whole run
      else ctx.fillStyle = css(a.hi ? o.hi : ink);
      ctx.fillText(a.t, x, 0);
    });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: SP.ink, light: SP.paper, mid: [190, 186, 176], dark: [70, 68, 64], colour: (c) => mix(grey(c), c, 0.4) }, stroke: { ink: SP.ink, light: SP.paper }, line: 0.55 })),
  sticker: painters({ line: SP.ink, lineScale: 0.45, tone: inkAs(SP.ink, (c) => mix(grey(c), c, 0.4)), shadow: null }),
  /** The corner tag: capitals in a hairline box, a little bar of the spectrum before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56, col = spInk();
    ctx.font = `600 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2.4, h = f * 1.7, top = y + (fs * 1.34 - h);
    ctx.strokeStyle = css(col, 0.85); ctx.lineWidth = 1.5; ctx.strokeRect(x, top, w, h);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = css(spec(i / 6)); ctx.fillRect(x + f * 0.5, top + h * 0.22 + (i * h * 0.56) / 6, f * 0.6, (h * 0.56) / 6); }
    ctx.fillStyle = ink || css(col); spaced(ctx, str, x + f * 1.5, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a cream mat (wider as its slider rises) with a hairline at its inner edge, in a thin wooden frame. */
  frame(ctx, env, p) {
    const { w, h } = env, b = 46 * p.border;
    if (b < 1) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(b, b, w - 2 * b, h - 2 * b); ctx.fillStyle = css(dark ? [30, 30, 28] : SP.mat); ctx.fill("evenodd");
    ctx.strokeStyle = css(spInk(), 0.7); ctx.lineWidth = 1.2; ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    ctx.strokeStyle = css(SP.wood); ctx.lineWidth = Math.max(2, b * 0.3); ctx.strokeRect(b * 0.15, b * 0.15, w - b * 0.3, h - b * 0.3);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.paper * 0.7, unit, !dark); },
  prompt: `Engraved emblems for a black-and-white stipple print — exact, old-fashioned, a little surreal — that read at a glance:
- one clear object per sticker (a cloud, a mountain, a wave, an eye, a moon, a hand, a key, a bird, a crystal), with a strong silhouette; no realism, no fine detail;
- flat colour only: mostly "ink" and "white" (cream); the main colour, if at all, as one small accent;
- the app adds a thin ink line and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as an old engraving would show them, built as simple models from a few boxes and cylinders — a telescope, a lighthouse, a globe, a lamp, a column; no realism, no fine detail.
- the renderer paints faces in cream and greys with a thin ink line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep grey, and "main" a muted version of the channel colour.`,
};

// ====================================================================== shared by the two looks below
/**
 * Water from the line y down to y1, across x0–x1: what is painted above the line mirrored into it, in thin
 * strips each slid sideways a little (more toward the foot, where the ripples are nearer), dimmed toward
 * `tint` (alpha a0 at the line, a1 at the foot). Needs a canvas; k0 places the ripples.
 */
function reflectBelow(ctx, x0, x1, y, y1, tint, a0, a1, k0) {
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
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
/** The boxes a look's furniture should keep off: the title as it will be set, the corner tag, the channel graphic. */
function keepClear(ctx, env) {
  const out = [], T = canPaint(ctx) ? titleArea(ctx, env) : null, tg = env.G && env.G.tag;
  if (T) out.push({ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 });
  if (tg) out.push({ x: tg.x - 20, y: tg.y - 20, w: 420, h: tg.fs * 1.34 + 40 });
  const A = env.G && env.G.art, on = env.graphic && env.cover && env.cover.layers.some((l) => l.id === "graphic" && l.visible);
  if (A && on) { const r = 330 * A.s; out.push({ x: A.x - r, y: A.y - r, w: r * 2, h: r * 2 }); }
  return out;
}

// ====================================================================== city pop: the night city of the OVA years
// Late-80s and early-90s anime as the videotape kept it: a navy night, or a violet dusk, of cel-painted
// clouds; towers of lit windows, red lights winking on their tops; neon tubes and a sign by the road;
// palms; the lights doubled in black water; the figure painted as a cel, a hard shadow and a rim of neon;
// laser lines; and the smear, scanlines and tracking noise of the tape.
const CP = { line: [16, 14, 38], cream: [255, 244, 232], pink: [255, 64, 168], cyan: [70, 232, 255], green: [96, 255, 168], amber: [255, 190, 96], red: [255, 54, 64], warm: [255, 232, 180] };
const CP_NEON = [CP.pink, CP.cyan, CP.green, CP.amber];
/** The sky, top to horizon, at dusk d (0: deep night, 1: violet dusk). */
const cpSky = (d) => [mix([6, 10, 36], [40, 28, 92], d), mix([24, 40, 116], [104, 68, 156], d), mix([66, 80, 170], [242, 140, 168], d)];
/** A line of neon tube along the current path, `lw` thick: a wide soft glow, a narrower one, the tube, and its white-hot core. */
function neonTube(ctx, colour, lw, a = 1) {
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [k, al] of [[5, 0.14], [2.4, 0.4], [1, 1]]) { ctx.strokeStyle = css(colour, al * a); ctx.lineWidth = lw * k; ctx.stroke(); }
  ctx.strokeStyle = css(mix(colour, [255, 255, 255], 0.7), a); ctx.lineWidth = lw * 0.4; ctx.stroke();
  ctx.restore();
}
/**
 * A bank of cloud as the cel painters did a night sky: ragged lobes strung along a line, each in the body
 * tone with a crescent lit along its top (moonlight by night, the last of the sun at dusk) and a darker one
 * along its foot, the lower lobes over the higher; thin wisps trailing off either end. Flat tones, hard
 * edges. (cx, cy): its middle; len: its length; th: its thickness.
 */
function cpCloud(ctx, cx, cy, len, th, d, k) {
  const body = mix([18, 26, 70], [94, 64, 142], d), lit = mix([74, 108, 206], [252, 160, 184], d), deep = mix([8, 12, 40], [60, 42, 106], d), m = 9 + Math.floor(rand(k) * 9), lobes = [];
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1), r = th * (0.3 + rand(k + i * 2.3 + 1) * 0.6) * (0.4 + 0.6 * Math.sin(Math.PI * (0.08 + 0.84 * t)));
    lobes.push([cx + len * (t - 0.5) + (rand(k + i * 3.1 + 2) - 0.5) * len * 0.08, cy + (rand(k + i * 4.7 + 3) - 0.5) * th * 0.5 - Math.sin(Math.PI * t) * th * 0.3, r]);
  }
  lobes.sort((a, b) => a[1] - b[1]);
  ctx.save();
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const wx = cx + s * len * (0.42 + 0.1 * i + rand(k + i * 5.1 + s) * 0.08), wy = cy + th * (rand(k + i * 6.3 + s * 2) - 0.3) * 0.6, wr = len * (0.08 + rand(k + i * 7.7 + s) * 0.1);
    ctx.fillStyle = css(i % 2 ? lit : body); ctx.beginPath(); ctx.ellipse(wx, wy, wr, th * 0.05 + 1, 0, 0, TAU); ctx.fill();
  }
  for (const [x, y, r] of lobes) {
    const rx = r * 1.9;
    ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, rx, r, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = css(lit); ctx.fillRect(x - rx, y - r, rx * 2, r * 2);
    ctx.fillStyle = css(body); ctx.beginPath(); ctx.ellipse(x + rx * 0.05, y + r * 0.3, rx, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = css(deep); ctx.beginPath(); ctx.ellipse(x + rx * 0.1, y + r * 1.3, rx * 1.05, r, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
/** Stars: pinpricks thicker toward the top of the sky, a few bright ones with four points, fainter at dusk; `n` of them, the last coming in by degrees. */
function cpStars(ctx, F, bottom, n, d, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, bottom - F.y0), fade = 1 - 0.65 * d;
  ctx.save(); ctx.fillStyle = css(CP.cream);
  for (let i = 0; i < Math.ceil(n); i++) {
    const x = F.x0 + fw * rand(i * 1.7 + k0), y = F.y0 + span * rand(i * 2.9 + k0 + 1) ** 1.7, big = rand(i * 3.3 + k0 + 2) ** 6;
    ctx.globalAlpha = (0.35 + 0.65 * rand(i * 4.1 + k0 + 3)) * fade * clamp(n - i);
    if (big > 0.5) starMark(ctx, x, y, 3 + big * 6, 4, CP.cream); else { ctx.beginPath(); ctx.arc(x, y, 0.7 + big * 2.6, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
/**
 * The city at night, its feet at `base` and its tallest reaching `top`: the glow it throws on the sky, a
 * ridge of hills far off, then three rows of towers — the far row small and hazy, pricked with light; the
 * middle row tall and gridded with windows; the near row low and dark. `lit` (0–1) of the windows are
 * lit, warm white with a few pink or cyan; red lights on the tops; with `neon`, crowns banded in neon
 * tube and signboards down the near faces, one after another.
 */
function cpCity(ctx, F, top, base, lit, neon, d, k0) {
  const fw = F.x1 - F.x0, H = Math.max(10, base - top), u = Math.min(fw, F.y1 - F.y0), hz = cpSky(d)[2], glow = mix([150, 60, 170], [255, 150, 160], d);
  const g = ctx.createLinearGradient(0, base - H * 1.2, 0, base); g.addColorStop(0, css(glow, 0)); g.addColorStop(1, css(glow, 0.45));
  ctx.fillStyle = g; ctx.fillRect(F.x0, base - H * 1.2, fw, H * 1.2);
  const ph = rand(k0) * TAU;
  ctx.fillStyle = css(mix(mix([12, 16, 50], [56, 40, 104], d), hz, 0.25)); ctx.beginPath(); ctx.moveTo(F.x0 - 10, base + 2);
  for (let x = F.x0 - 10; x <= F.x1 + 30; x += 24) { const t = (x - F.x0) / fw; ctx.lineTo(x, base - H * (0.3 + 0.13 * Math.sin(t * 5.1 + ph) + 0.06 * Math.sin(t * 13.3 + ph * 2) + 0.03 * Math.sin(t * 31 + ph))); }
  ctx.lineTo(F.x1 + 30, base + 2); ctx.closePath(); ctx.fill();
  const WARM = [CP.warm, CP.warm, CP.warm, CP.warm, CP.warm, CP.warm, [255, 246, 222], [255, 246, 222], [255, 210, 140], [255, 210, 140], [255, 150, 204], [150, 228, 255]];
  const ROWS = [
    { w: [0.018, 0.03], h: [0.22, 0.38], body: mix(mix([30, 36, 96], [86, 62, 136], d), hz, 0.45), pin: true, litK: 0.7 },
    { w: [0.04, 0.06], h: [0.4, 0.6], body: mix([20, 26, 72], [52, 40, 100], d), litK: 1, crowns: true },
    { w: [0.06, 0.08], h: [0.12, 0.3], body: mix([10, 12, 36], [28, 22, 58], d), litK: 0.6, signs: true },
  ];
  ROWS.forEach((R, ri) => {
    const wins = new Map(), add = (c, x, y, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, y, w, h); }, reds = [], tubes = [];
    for (let x = F.x0 - 14, i = 0; x < F.x1 + 14; i++) {
      const kk = k0 + ri * 1000 + i * 7.3, bw = u * (R.w[0] + rand(kk) * R.w[1]), bh = H * (R.h[0] + rand(kk + 1) * R.h[1]), y0 = base - bh, kind = rand(kk + 2);
      ctx.fillStyle = css(R.body); ctx.fillRect(x, y0, bw, bh + 4);
      ctx.fillStyle = css(mix(R.body, glow, 0.18)); ctx.fillRect(x + bw * 0.74, y0, bw * 0.26, bh + 4);   // the side the city's glow catches
      let roof = y0;
      if (kind < 0.25) { ctx.fillStyle = css(R.body); ctx.fillRect(x + bw * 0.18, y0 - bh * 0.1, bw * 0.64, bh * 0.1 + 1); roof = y0 - bh * 0.1; }   // a setback
      else if (kind < 0.4) { ctx.fillStyle = css(R.body); shapeOf(ctx, [[x, y0 + 1], [x + bw, y0 + 1], [x + bw, y0 - bw * 0.45]]); ctx.fill(); }   // a slanted crown
      else if (kind < 0.55) { ctx.fillStyle = css(R.body); ctx.fillRect(x + bw * 0.48, y0 - bh * 0.22, Math.max(1.5, bw * 0.04), bh * 0.22); reds.push([x + bw * 0.5, y0 - bh * 0.22]); }   // a mast
      if (!R.pin && rand(kk + 3) < 0.6) reds.push([x + bw * 0.08, roof - 2], [x + bw * 0.92, roof - 2]);
      // the windows: a grid, the lit ones warm, a few pink or cyan; on the far row only the lit ones, as pinpricks
      const ws = R.pin ? Math.max(1.4, bw * 0.08) : bw * 0.075, wh = R.pin ? ws : ws * 0.8, cols = Math.max(1, Math.floor((bw * 0.82) / (ws * 2))), gx = (bw * 0.82 - cols * ws * 2) / 2;
      for (let r = 0, y = y0 + bw * 0.1; y < base - wh; r++, y += wh * (R.pin ? 2.6 : 2.2)) for (let q = 0; q < cols; q++) {
        const on = rand(kk * 3.7 + r * 1.31 + q * 0.173) < lit * R.litK;
        if (on) add(WARM[Math.floor(rand(kk + r * 2.9 + q * 5.3) * WARM.length)], x + bw * 0.09 + gx + q * ws * 2, y, ws, wh);
        else if (!R.pin) add(mix(R.body, [70, 80, 140], 0.22), x + bw * 0.09 + gx + q * ws * 2, y, ws, wh);
      }
      if (R.crowns && rand(kk + 4) < neon * 0.6) tubes.push(["crown", x, roof, bw, CP_NEON[Math.floor(rand(kk + 5) * 4)]]);
      if (R.signs && rand(kk + 6) < neon) tubes.push(["sign", x + (rand(kk + 7) > 0.5 ? bw * 0.06 : bw * 0.68), y0 + bh * 0.1, bw * 0.24, CP_NEON[Math.floor(rand(kk + 8) * 4)], Math.min(bh * 0.7, bw * 0.24 * (3 + rand(kk + 9) * 2)), CP_NEON[Math.floor(rand(kk + 10) * 4)]]);
      x += bw * (0.86 + rand(kk + 11) * 0.22);
    }
    for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
    for (const [x, y] of reds) { ctx.fillStyle = css(CP.red, 0.25); ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill(); ctx.fillStyle = css([255, 140, 140]); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
    for (const [kind, x, y, w, c, sh, c2] of tubes) {
      if (kind === "crown") { ctx.beginPath(); ctx.moveTo(x + w * 0.06, y + w * 0.08); ctx.lineTo(x + w * 0.94, y + w * 0.08); ctx.moveTo(x + w * 0.06, y + w * 0.2); ctx.lineTo(x + w * 0.94, y + w * 0.2); neonTube(ctx, c, Math.max(1.2, w * 0.025)); continue; }
      ctx.fillStyle = css([18, 10, 32]); ctx.fillRect(x, y, w, sh);
      ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, sh - 4); neonTube(ctx, c, Math.max(1, w * 0.04));
      ctx.beginPath(); for (let q = 0, n = Math.max(2, Math.floor(sh / (w * 0.9))); q < n; q++) { const gy = y + w * 0.25 + q * w * 0.9, gw = w * 0.5; ctx.moveTo(x + w * 0.25, gy); ctx.lineTo(x + w * 0.25 + gw, gy); ctx.moveTo(x + w * 0.5, gy); ctx.lineTo(x + w * 0.5, gy + w * 0.5); }
      neonTube(ctx, c2 === c ? CP.cream : c2, Math.max(0.8, w * 0.03));
    }
  });
}
/**
 * A neon sign up on its pole, as a motel or a bar by the road has one: a rounded frame of tube in one
 * colour with an arrow off its side, a word in looping script tube in another, a line of small letters
 * under it. (x, y): its middle; s: its width; a: how strongly it shows.
 */
function cpSign(ctx, x, y, s, a, k) {
  const h = s * 0.42, c1 = CP_NEON[1 + Math.floor(rand(k) * 3)], c2 = CP.pink, lw = Math.max(1.5, s * 0.012);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css([14, 12, 30]); ctx.fillRect(x - s * 0.025, y + h * 0.5, s * 0.05, s * 1.6);
  ctx.beginPath(); rounded(ctx, x - s / 2, y - h / 2, s, h, h * 0.18); ctx.fill();
  ctx.beginPath(); rounded(ctx, x - s / 2 + lw * 2, y - h / 2 + lw * 2, s - lw * 4, h - lw * 4, h * 0.15);
  ctx.moveTo(x + s / 2, y + h * 0.12); ctx.lineTo(x + s * 0.64, y + h * 0.12); ctx.moveTo(x + s * 0.64, y + h * 0.12); ctx.lineTo(x + s * 0.59, y + h * 0.02); ctx.moveTo(x + s * 0.64, y + h * 0.12); ctx.lineTo(x + s * 0.59, y + h * 0.22);
  neonTube(ctx, c1, lw);
  const sx = x - s * 0.36, sw = s * 0.72, base = y + h * 0.08, xh = h * 0.22, n = 5 + Math.floor(rand(k + 1) * 3), step = sw / n;   // the word: a row of looped letters joined up
  ctx.beginPath(); ctx.moveTo(sx, base);
  for (let i = 0; i < n; i++) {
    const px = sx + i * step, nx = px + step, kind = Math.floor(rand(k + i * 2.3 + 2) * 3);
    if (kind === 0) { ctx.bezierCurveTo(px + step * 0.9, base - xh * 1.4, px + step * 0.1, base - xh * 2.6, px + step * 0.55, base); ctx.quadraticCurveTo(px + step * 0.8, base + xh * 0.3, nx, base); }
    else if (kind === 1) { ctx.quadraticCurveTo(px + step * 0.25, base - xh * 1.2, px + step * 0.5, base); ctx.quadraticCurveTo(px + step * 0.75, base - xh * 1.2, nx, base); }
    else { ctx.bezierCurveTo(px + step * 0.9, base - xh * 0.6, px + step * 0.4, base - xh * 1.4, px + step * 0.3, base - xh * 0.4); ctx.quadraticCurveTo(px + step * 0.4, base + xh * 0.3, nx, base); }
  }
  ctx.quadraticCurveTo(sx + sw * 0.7, base + xh * 0.9, sx + sw * 0.08, base + xh * 0.6);   // and a swash back under it
  neonTube(ctx, c2, lw * 1.3);
  ctx.beginPath(); for (let i = 0; i < 7; i++) { const lx = x - s * 0.3 + i * s * 0.088; ctx.moveTo(lx, y + h * 0.3); ctx.lineTo(lx + s * 0.05, y + h * 0.3); }
  neonTube(ctx, [120, 160, 255], lw * 0.7);
  ctx.restore();
}
/**
 * A palm: a trunk curving up from its foot (x, base), ringed, and a crown of fronds arching and drooping,
 * each a long blade notched along its lower edge, dark, the side to the sky lit. s: its height; lean: the
 * way it bends (−1 to 1).
 */
function cpPalm(ctx, x, base, s, lean, d, k) {
  const dk = mix([8, 28, 32], [24, 22, 52], d), lt = mix([34, 100, 84], [86, 66, 124], d), tk = mix([20, 22, 40], [40, 30, 60], d);
  const tx = x + lean * s * 0.22, ty = base - s, cx1 = x + lean * s * 0.02, cy1 = base - s * 0.5;
  const P = (t) => [(1 - t) ** 2 * x + 2 * (1 - t) * t * cx1 + t * t * tx, (1 - t) ** 2 * base + 2 * (1 - t) * t * cy1 + t * t * ty], wd = (t) => s * (0.026 - 0.012 * t);
  const Lf = [], Rt = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, [px, py] = P(t), [qx, qy] = P(Math.min(1, t + 0.01)), dx = qx - px, dy = qy - py, n = Math.hypot(dx, dy) || 1, w = wd(t); Lf.push([px - (dy / n) * w, py + (dx / n) * w]); Rt.push([px + (dy / n) * w, py - (dx / n) * w]); }
  ctx.fillStyle = css(tk); shapeOf(ctx, [...Lf, ...Rt.reverse()]); ctx.fill();
  ctx.strokeStyle = css(mix(tk, lt, 0.45)); ctx.lineWidth = Math.max(1, s * 0.004); ctx.beginPath();
  for (let i = 1; i < 32; i++) { const t = i / 32, [px, py] = P(t), w = wd(t); ctx.moveTo(px - w, py); ctx.lineTo(px + w * 0.6, py + w * 0.3); }
  ctx.stroke();
  for (let i = 0, n = 10; i < n; i++) {
    const ang = Math.PI * (-1.12 + 1.24 * ((i + rand(k + i) * 0.6) / n)), len = s * (0.24 + rand(k + i * 2.1 + 1) * 0.14), droop = len * (0.3 + rand(k + i * 3.3 + 2) * 0.4), up = [], dn = [], sp = [];
    for (let j = 0; j <= 14; j++) {
      const t = j / 14, px = tx + Math.cos(ang) * len * t, py = ty + Math.sin(ang) * len * t + droop * t * t, ddx = Math.cos(ang) * len, ddy = Math.sin(ang) * len + 2 * droop * t, nn = Math.hypot(ddx, ddy) || 1;
      let nx = -ddy / nn, ny = ddx / nn;
      if (ny > 0) { nx = -nx; ny = -ny; }   // the side toward the sky
      const w = len * 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.02));
      sp.push([px, py]); up.push([px + nx * w, py + ny * w]); dn.push([px - nx * w * (j % 2 ? 1.3 : 0.35), py - ny * w * (j % 2 ? 1.3 : 0.35)]);
    }
    ctx.fillStyle = css(dk); shapeOf(ctx, [...up, ...dn.reverse()]); ctx.fill();
    ctx.fillStyle = css(lt); shapeOf(ctx, [...up, ...sp.reverse()]); ctx.fill();
  }
}
/** The neon the figure is lit by: the channel colour, bright as a tube. */
const cpRim = (C) => mix(boost(C, 0.7), [255, 255, 255], 0.22);
/**
 * The figure painted as a cel and set in the night: its graphic itself (see figureOf; or, while it cannot be
 * drawn, its silhouette) with its tones stepped as cel paint, sunk into the night's blue; a crescent of hard
 * shadow on the side away from the neon (its own shape moved toward the light leaves it) and a thin rim of
 * the neon — the channel colour — along the lit side. Painted once on a canvas of its own at `k` canvas
 * pixels to the unit, its middle at the middle, and kept while the graphic, the size, the colour and the
 * scale stay the same, so moving it costs a copy. Returns { c, hw, hh } (its half size in units).
 */
function cpFigureImage(env, S, size, C, k) {
  const b = S.box, kk = size / Math.max(1, b.y1 - b.y0), hw = ((b.x1 - b.x0) / 2) * kk + 8, hh = size / 2 + 8, lx = 0.8, ly = -0.6;
  const key = [current.id, JSON.stringify(figureOf(env) && figureOf(env).ref), size.toFixed(1), C.map(Math.round).join(), k.toFixed(4)].join("|"), kept = WORK.cpFigure;
  if (kept && kept.key === key) return kept;
  const W = Math.max(1, Math.ceil(2 * hw * k)), H = Math.max(1, Math.ceil(2 * hh * k)), make = (slot) => { const c = WORK[slot] || (WORK[slot] = document.createElement("canvas")); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } const x = c.getContext("2d", { willReadFrequently: true }); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, W, H); x.setTransform(k, 0, 0, k, hw * k, hh * k); return x; };
  const out = WORK.cpFigureCv = document.createElement("canvas"), x = make("cpFig");
  x.save(); x.scale(kk, kk); x.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  const drawn = figureOf(env) && figureOf(env).draw(x);
  x.restore();
  if (!drawn) placeShape(x, S, [54, 60, 128], 0, 0, size);
  const img = x.getImageData(0, 0, W, H); celPixels(img.data, 1); x.putImageData(img, 0, 0);
  inPixels(x, () => { x.globalCompositeOperation = "multiply"; x.fillStyle = css([150, 154, 226]); x.fillRect(0, 0, W, H); });
  x.globalCompositeOperation = "destination-in"; placeShape(x, S, [255, 255, 255], 0, 0, size);
  const edge = (colour, d, alpha) => {   // the shape less itself moved by d along the light: a crescent on one side
    const r = make("cpRim");
    placeShape(r, S, colour, 0, 0, size); r.globalCompositeOperation = "destination-out"; placeShape(r, S, [255, 255, 255], d * lx, d * ly, size);
    inPixels(x, () => { x.globalCompositeOperation = "source-atop"; x.globalAlpha = alpha; x.drawImage(r.canvas, 0, 0); });
  };
  edge([12, 12, 44], size * 0.07, 0.6);
  edge(cpRim(C), -size * 0.014, 1);
  out.width = W; out.height = H; out.getContext("2d").drawImage(x.canvas, 0, 0);
  const made = { c: out, hw, hh, key: drawn ? key : null };   // a graphic still loading is tried again next time
  WORK.cpFigure = made;
  return made;
}
/** Lays the figure (see cpFigureImage) with its middle at (cx, cy), at `a`. */
function cpFigure(ctx, env, S, cx, cy, size, C, a) {
  const m = ctx.getTransform(), f = cpFigureImage(env, S, size, C, Math.hypot(m.a, m.b) || 1);
  ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true; ctx.drawImage(f.c, cx - f.hw, cy - f.hh, f.hw * 2, f.hh * 2); ctx.restore();
}
/** Laser lines across the field: thin beams of hot neon, some broken into runs, each at a height and tilt of its own; `n`, the last by degrees. */
function cpLasers(ctx, F, n, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh);
  for (let i = 0; i < Math.ceil(n); i++) {
    const y = F.y0 + fh * (0.12 + 0.8 * rand(i * 2.3 + k0)), tilt = (rand(i * 3.1 + k0 + 1) - 0.5) * fh * 0.05, c = i % 4 === 2 ? CP.cyan : CP.pink, lw = u * (0.0016 + rand(i * 4.7 + k0 + 2) * 0.003);
    ctx.beginPath();
    for (let x = F.x0 - 10 + fw * rand(i * 5.3 + k0 + 3) * 0.3, q = 0; x < F.x1 + 10; q++) {
      const len = fw * (0.15 + rand(i * 7.1 + q * 1.9 + k0) * 0.6), gap = fw * rand(i * 8.3 + q * 2.7 + k0) * 0.12, x1 = Math.min(F.x1 + 10, x + len);
      ctx.moveTo(x, y + (tilt * (x - F.x0)) / fw); ctx.lineTo(x1, y + (tilt * (x1 - F.x0)) / fw);
      x = x1 + gap;
    }
    neonTube(ctx, c, lw, clamp(n - i));
  }
}
/**
 * The picture as a worn videotape plays it, by `a` (0–1): the colour smeared — a red copy laid on a little
 * to the right, a blue one a little to the left, each only where it brightens —, scanlines, a band near the
 * foot slid sideways with a spray of white noise along it (the tracking), and a pale line rolling through.
 */
function vhsTape(ctx, w, h, a, unit) {
  if (a <= 0 || !canPaint(ctx)) return;
  const cv = ctx.canvas, W = cv.width, H = cv.height, k = W / w;
  if (!fast) for (const [col, dx] of [["#ff0000", (2 + 7 * a) * k], ["#0000ff", -(1 + 4 * a) * k]]) {
    const x = workLike(ctx, "vhs"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(cv, 0, 0); x.globalCompositeOperation = "multiply"; x.fillStyle = col; x.fillRect(0, 0, W, H);
    inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.globalAlpha = Math.min(1, 0.4 + a); ctx.drawImage(x.canvas, dx, 0); });
  }
  const p = Math.max(2, Math.round(3 * k)), key = `vhsLines|${p}`;
  let t = WORK[key];
  if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = 4; t.height = p; const g = t.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 4, Math.max(1, Math.round(p / 3))); }
  inPixels(ctx, () => { ctx.globalAlpha = 0.3 * a; ctx.fillStyle = ctx.createPattern(t, "repeat"); ctx.fillRect(0, 0, W, H); });
  const bh = Math.max(2, Math.round(H * (0.006 + 0.02 * a))), by = H - bh - Math.round(H * 0.006);   // the head-switching noise along the foot
  if (by + bh < H) {
    const band = WORK.vhsBand || (WORK.vhsBand = document.createElement("canvas"));
    if (band.width !== W || band.height !== bh) { band.width = W; band.height = bh; }
    const bg = band.getContext("2d"); bg.globalCompositeOperation = "copy"; bg.drawImage(cv, 0, by, W, bh, 0, 0, W, bh);
    inPixels(ctx, () => {
      ctx.drawImage(band, (4 + 30 * a) * k, by);
      ctx.fillStyle = css([255, 255, 255], 0.55 * a);
      for (let i = 0, n = Math.round(30 + 160 * a); i < n; i++) ctx.fillRect(rand(i * 1.7 + 682) * W, by + rand(i * 2.3 + 683) * bh, (2 + rand(i * 3.1 + 684) * 16) * k, Math.max(1, k));
    });
  }
  const ry = H * rand(685), rg = ctx.createLinearGradient(0, ry - 24 * k, 0, ry + 24 * k);
  rg.addColorStop(0, "rgba(255,255,255,0)"); rg.addColorStop(0.5, css([255, 255, 255], 0.07 * a)); rg.addColorStop(1, "rgba(255,255,255,0)");
  inPixels(ctx, () => { ctx.fillStyle = rg; ctx.fillRect(0, ry - 24 * k, W, 48 * k); });
}
/** For each lightness 0–255, the stepped lightness of cel paint: four flat tones, the steps a little soft so their edges do not crawl. */
const CEL_STEPS = (() => {
  const out = new Float32Array(256), th = [0.2, 0.42, 0.68], lv = [0.07, 0.27, 0.53, 0.88];
  for (let i = 0; i < 256; i++) { const t = i / 255; let v = lv[0]; th.forEach((s, j) => { const e = clamp((t - s + 0.025) / 0.05); v += (lv[j + 1] - lv[j]) * e * e * (3 - 2 * e); }); out[i] = v; }
  return out;
})();
/** RGBA pixels painted as a cel, mixed in by a: the lightness stepped, the hue kept and made a little stronger, the shadows sunk toward a night teal, the lights warmed. */
function celPixels(d, a) {
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], l = (r * 54 + g * 183 + b * 19) >> 8, q = CEL_STEPS[l], s = Math.min(3, (q * 255 + 1) / (l + 1));
    let R = r * s, G = g * s, B = b * s;
    const m = (R + G + B) / 3, sh = clamp((0.5 - q) / 0.45) * 0.55, hi = clamp((q - 0.62) / 0.3) * 0.3;
    R = m + (R - m) * 1.25; G = m + (G - m) * 1.25; B = m + (B - m) * 1.25;
    R += (22 - R) * sh + (255 - R) * hi; G += (52 - G) * sh + (232 - G) * hi; B += (92 - B) * sh + (236 - B) * hi;
    d[i] = r + (R - r) * a; d[i + 1] = g + (G - g) * a; d[i + 2] = b + (B - b) * a;
  }
}
const citypop = {
  id: "citypop",
  art: "figure",
  repaint: (c) => `a night scene from a late-1980s anime OVA made from the photograph: hand-painted cel animation, a deep navy or violet night sky with cel-shaded clouds, city lights and neon signs, hard-edged two-tone shading with teal shadows, slightly faded VHS colour, with ${c} as an accent; still the same place, no text.`,
  about: { zh: "都市夜曲：八九十年代 OVA 动画录像带里的城市夜色——深海军蓝的夜空（或暮紫的黄昏），赛璐珞手法画的云，一层层楼群亮着窗灯、楼顶闪着红色航空灯，霓虹灯管和路边的霓虹招牌，棕榈树，黑色水面里倒映的灯火；频道图形画成赛璐珞人物：硬边阴影加一道霓虹轮廓光；可加星空、激光线，以及录像带的色彩拖影、扫描线和跟踪噪点。复古、浪漫、城市流行乐的味道——适合音乐、夜生活、城市、情感、复古与动画内容。照片会被画成赛璐珞的几层平涂。只有夜色底。", en: "City pop night: the city by night on the anime videotapes of the late 80s and early 90s — a deep navy night (or a violet dusk), clouds painted as cels, rows of towers with their windows lit and red lights winking on their tops, neon tubes and a neon sign by the road, palms, the lights doubled in black water; the channel graphic as a figure painted on a cel, a hard shadow and a rim of neon; stars, laser lines, and the colour smear, scanlines and tracking noise of the tape if you like. Retro, romantic, city-pop — for music, nightlife, cities, feelings, retro and animation. A photo is painted in a few flat cel tones. Night ground only." },
  name: { zh: "都市夜曲", en: "City pop night" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "赛璐珞人物", en: "Cel figure" }, sign: { zh: "霓虹招牌", en: "Neon sign" }, palms: { zh: "棕榈", en: "Palms" }, clouds: { zh: "夜云", en: "Night clouds" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "赛璐珞人物", en: "Cel figure" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "暮色", en: "Dusk" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "夜云", en: "Night clouds" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "星空", en: "Stars" } },
    { key: "skyline", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "楼群", en: "Skyline" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "窗灯", en: "Lit windows" } },
    { key: "neon", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "霓虹灯牌", en: "Neon" } },
    { key: "palms", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "棕榈", en: "Palms" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "水面倒影", en: "Water" } },
    { key: "laser", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "激光线", en: "Laser lines" } },
    { key: "vhs", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "录像带", en: "Videotape" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "cel", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片赛璐珞化", en: "Photo as cels" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base, C, p) => ({ ...base, field: css(cpSky((p && p.dusk) || 0)[1]), text: css(CP.cream), dim: css(CP.cream, 0.6), titleFill: css(CP.cream), titleInk: css(CP.line), grid: () => css(CP.pink, 0.24) }),
  /**
   * The sky, its stars and clouds, the city (painted once and kept until one of their sliders changes);
   * then the sign, the palms, the water mirroring all of it, the figure in front, the lasers. A photo is
   * painted as cels; filling the canvas, it gets the lasers too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), d = p.dusk, sky = cpSky(d);
    if (env.photo) {
      env.drawPhoto(0, p.cel > 0 ? { key: `cel|${p.cel}`, fn: (d) => celPixels(d, p.cel) } : null);   // the photo itself painted as cels (see drawPhotoAt), not the canvas read back
      if (L.fill) cpLasers(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.laser * 8, 2700);
      return true;
    }
    const water = F.y1 - fh * 0.32 * p.water, top = water - fh * (0.12 + 0.5 * p.skyline);
    const cloudMove = L.grid && p.clouds > 0 ? objAt("clouds", F.x0 + fw * 0.5, F.y0 + fh * 0.3, ctx).map((v, i) => v - [F.x0 + fw * 0.5, F.y0 + fh * 0.3][i]) : [0, 0];   // a scene object: the clouds move as one
    if (L.ground !== false) {   // the sky itself, down to the water's line: the ground
      const g = ctx.createLinearGradient(0, F.y0, 0, water); g.addColorStop(0, css(sky[0])); g.addColorStop(0.55, css(sky[1])); g.addColorStop(1, css(sky[2]));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    const paintSky = (x) => {   // what is in the sky: kept on a layer of its own
      if (p.stars > 0) cpStars(x, F, water, p.stars * 360, d, 2710);
      if (p.clouds > 0) {   // banks of cloud, the far (lower, smaller) ones first
        const n = p.clouds * 10, banks = [];
        for (let k = 0; k < Math.ceil(n); k++) { const a = clamp(n - k), t = rand(k * 2.3 + 2720) ** 1.3, s = 1 - 0.55 * t; banks.push([F.x0 + fw * rand(k * 3.1 + 2721), F.y0 + (water - F.y0) * (0.05 + 0.8 * t), fw * (0.2 + rand(k * 4.7 + 2722) * 0.35) * s * (0.4 + 0.6 * a), fh * (0.05 + rand(k * 5.3 + 2723) * 0.04) * s * (0.4 + 0.6 * a), 2724 + k * 31]); }
        x.save(); x.translate(cloudMove[0], cloudMove[1]);
        for (const [cx, cy, len, th, k] of banks.sort((a, b) => b[1] - a[1])) cpCloud(x, cx, cy, len, th, d, k);
        x.restore();
      }
      if (p.skyline > 0) cpCity(x, F, top, water, p.lights, p.neon, d, 2760);
    };
    if (p.stars > 0 || p.clouds > 0 || p.skyline > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "cpSky", [seed, w, h, F.x0, F.y0, F.x1, F.y1, d, p.stars, p.clouds, p.skyline, p.lights, p.neon, p.water, cloudMove.map((v) => v.toFixed(2)).join()].join("|"), paintSky);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintSky(ctx);
    }
    if (p.neon > 0) { const [sx, sy] = objAt("sign", F.x0 + fw * 0.86, F.y0 + fh * 0.22, ctx); cpSign(ctx, sx, sy, u * (0.16 + 0.14 * p.neon), clamp(p.neon * 2.5), 2780); }   // a scene object
    if (p.palms > 0) {   // a scene object: up to three palms, each growing in turn
      const n = p.palms * 3, set = [[F.x0 + fw * 0.05, 1.05, 0.5], [F.x1 - fw * 0.05, 0.95, -0.6], [F.x0 + fw * 0.2, 0.62, 0.3]];
      ctx.save(); shift("palms", F.x0 + fw * 0.05, F.y1 - fh * 0.5, ctx);
      for (let k = 0; k < Math.ceil(n); k++) { const [px, s, lean] = set[k]; cpPalm(ctx, px, F.y1 + 6, fh * s * (0.3 + 0.7 * clamp(n - k)), lean, d, 2790 + k * 17); }
      ctx.restore();
    }
    if (p.water > 0) {
      reflectBelow(ctx, 0, w, water, F.y1 + 2, mix([6, 10, 34], [34, 24, 70], d), 0.3, 0.75, 2800);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.water * 3);   // glints across the water: the lights' reflections caught on the ripples
      for (let i = 0, n = Math.round(10 + 60 * p.water); i < n; i++) { const y = water + (F.y1 - water) * rand(i * 2.1 + 2810) ** 1.4, x = F.x0 + fw * rand(i * 3.3 + 2811), l = u * (0.01 + rand(i * 4.1 + 2812) * 0.05); ctx.fillStyle = css(rand(i * 5.7 + 2813) < 0.7 ? CP.warm : CP_NEON[i % 4], 0.7); ctx.fillRect(x, y, l, 1.6); }
      ctx.fillStyle = css(mix(sky[2], CP.cream, 0.4), 0.5); ctx.fillRect(F.x0, water, fw, 1.5);
      ctx.restore();
    }
    const size = Math.min(fh, fw * 0.9) * (0.35 + 0.5 * p.figure), [cx, cy] = p.figure > 0 ? objAt("figure", F.x0 + fw * 0.6, F.y1 - size * 0.48, ctx) : [0, 0];   // a scene object
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const rim = cpRim(C), g = ctx.createRadialGradient(cx, cy - size * 0.2, 0, cx, cy - size * 0.2, size * 0.8);
      g.addColorStop(0, css(mix(rim, [120, 60, 220], 0.5), 0.4 * Math.min(1, p.figure * 2))); g.addColorStop(1, css(rim, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      cpFigure(ctx, env, S, cx, cy, size, C, Math.min(1, p.figure * 5));
    }
    if (p.laser > 0) cpLasers(ctx, F, p.laser * 8, 2700);
    return true;
  },
  /** The eighties' grid floor: the horizon, lines running from the foot of the picture to a vanishing point on it, and cross lines closing up toward it. */
  gridLines(ctx, env, color) {
    const { w, h } = env, hz = h * 0.62, vx = w / 2;
    gridPen(ctx, color); ctx.beginPath();
    ctx.moveTo(0, hz); ctx.lineTo(w, hz);
    const y0 = hz + (h - hz) * 0.08;   // the lines that run to it start a little below it, where they still stand apart
    for (let i = -14; i <= 14; i++) { const x1 = vx + i * 200; ctx.moveTo(vx + (x1 - vx) * 0.08, y0); ctx.lineTo(x1, h); }
    for (let k = 3; k <= 10; k++) { const y = hz + (h - hz) * (k / 10) ** 2; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(mix([14, 14, 44], C, 0.12)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; for (const [w, a] of [[16, 0.15], [7, 0.4], [3, 1]]) { ctx.strokeStyle = css(CP.pink, a); ctx.lineWidth = w; run(0, 0); } ctx.strokeStyle = css([255, 210, 236]); ctx.lineWidth = 1.2; run(0, 0); } },   // a neon tube along the block's edge
  /** A title card of the tapes: letters graded from cream to pink, a dark outline (the outline slider), and under them a hard pink step and a deep navy drop (the shadow slider); highlighted words in the channel colour, made bright. */
  runs(ctx, pass, o) {
    const fs = o.fs, s = Math.min(2, o.shadowAmt), k = o.strokeAmt, hi = o.hi || mix(boost(o.C || CP.pink, 0.6), [255, 255, 255], 0.2);
    ctx.lineJoin = "round";
    if (s > 0) {
      pass((a, x) => { ctx.fillStyle = css(CP.line); ctx.fillText(a.t, x + fs * 0.075 * s, fs * 0.075 * s); });
      pass((a, x) => { ctx.fillStyle = css(a.hi ? CP.cyan : CP.pink); ctx.fillText(a.t, x + fs * 0.038 * s, fs * 0.038 * s); });
    }
    if (k > 0) pass((a, x) => { ctx.strokeStyle = css(CP.line); ctx.lineWidth = fs * 0.1 * k; ctx.strokeText(a.t, x, 0); });
    let grad = null;
    if (!o.fill) { grad = ctx.createLinearGradient(0, -fs * 0.72, 0, fs * 0.05); grad.addColorStop(0, css(CP.cream)); grad.addColorStop(0.55, css([255, 234, 238])); grad.addColorStop(1, css([255, 164, 208])); }
    pass((a, x) => { ctx.fillStyle = a.hi ? css(hi) : grad || css(o.fill); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink (the channel name on the dark block, the brand row) turns cream; objects go into the night's flat tones
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: CP.cream }, stroke: { ink: CP.cream } } : { fill: { ink: CP.line, light: CP.cream, mid: [172, 180, 214], dark: [46, 52, 100], colour: (c) => mix(boost(c, 0.3), [60, 40, 120], 0.15) }, stroke: { ink: CP.line, light: CP.cream }, line: 0.8 }),
  sticker: painters({ line: CP.line, lineScale: 0.7, tone: inkAs(CP.line, (c) => mix(boost(c, 0.3), [60, 40, 120], 0.15)), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 7); draw(css(CP.line, 0.85)); ctx.restore(); } }),
  /** The corner tag: cream capitals in a rounded frame of cyan neon tube. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.22); neonTube(ctx, CP.cyan, 3);
    ctx.fillStyle = ink || css(CP.cream); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 10, y: top - 10, w: w + 20, h: h + 20 };
  },
  /** The frame layer: the rounded corners of a television screen, and the tape's play display. */
  frame(ctx, env) {
    const { w, h } = env, r = 40, t = 1800 + Math.floor(rand(690) * 5200) + env.o.catIndex * 97;
    ctx.fillStyle = "#000000";
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * r, y); ctx.arcTo(x, y, x, y + sy * r, r); ctx.lineTo(x, y); ctx.fill(); }
    ctx.font = `600 18px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(CP.cream, 0.8);
    ctx.fillText(`▶ PLAY   SP ${Math.floor(t / 3600)}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}`, w - 64, h - 44);
  },
  image(ctx, C, unit) { ctx.shadowColor = css(CP.line, 0.75); ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 6 * unit; },
  post(ctx, w, h, C, p, unit = 1) { vhsTape(ctx, w, h, p.vhs, unit); grain(ctx, p.grain * 0.8, unit); vignette(ctx, w, h, [6, 4, 22], 0.5, 0.45); },
  prompt: `Animation cels from a late-1980s anime about the city at night — romantic, a little wistful — that read at a glance:
- one clear object per sticker (a cassette, a Walkman, a sports car, a payphone, a neon cocktail glass, a palm tree, a microphone, sunglasses, a vinyl record), with a strong silhouette; no realism, no fine detail;
- flat cel paint in two tones: each shape one flat colour with one hard-edged shadow shape in a darker, bluer tone of it ("shadow": false); colours are night colours — navy, violet, teal — with one neon pink or cyan;
- the app adds a dark navy line and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a city at night in a late-1980s anime, built as simple models from a few boxes and cylinders — a payphone, a jukebox, a vending machine, a sports car, a neon sign; no realism, no fine detail.
- the renderer paints faces in flat cel tones with a dark navy line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep navy, and "main" the channel colour as night shows it — use it for one to three parts.`,
};

// ====================================================================== constructivist: the poster as a machine
// The Soviet avant-garde as illustrators take it up today: cream paper gone a little brown; a machine (the
// channel graphic) built again out of rectangles of grey, black, bare paper and one red; great diagonal
// wedges, a disc, rays fanning from a vanishing point, a steel truss, bars and blocks, construction lines
// and dot grids, small type set as furniture; the lower part doubled in still water. Flat, hard-edged.
const CN = { paper: [232, 223, 202], light: [244, 238, 224], night: [26, 25, 24], ink: [24, 23, 23], red: [204, 52, 38], greys: [[208, 204, 194], [164, 162, 156], [120, 120, 118], [80, 80, 82]] };
const cnGround = () => (dark ? CN.night : CN.paper), cnInk = () => (dark ? CN.paper : CN.ink);
/** The greys a photo or a layer is pressed into, by lightness (see toneTable). */
const CN_TONES = [[0, CN.ink], [0.3, CN.greys[3]], [0.5, CN.greys[2]], [0.68, CN.greys[1]], [0.84, CN.greys[0]], [1, CN.light]];
/** RGBA pixels mapped by lightness through `lut` (see toneTable), mixed in by a; alpha kept. */
function lutPixels(d, lut, a) {
  for (let i = 0, n = d.length; i < n; i += 4) {
    const j = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3;
    d[i] += (lut[j] - d[i]) * a; d[i + 1] += (lut[j + 1] - d[i + 1]) * a; d[i + 2] += (lut[j + 2] - d[i + 2]) * a;
  }
}
/** The one colour: the poster red, turned by degrees (the Channel colour slider) to the channel's, made strong enough to print. */
const cnRed = (C, p = values) => mix(CN.red, boost(C || CN.red, 0.4), clamp((p && p.chan) || 0));
/** Smooth value noise (0–1) over the plane, a cell to the unit: tones that stay put as the blocks are cut finer. */
function cnNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), v = (i, j) => rand(i * 57.13 + j * 113.71 + 5000);
  const a = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * sx, b = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}
/**
 * Cells joined into rectangles: every cell ok(i, j) allows, scanned row by row, starts a block that grows
 * to the right and then down — to a width and height of its own, at most mw × mh cells — while the cells
 * it takes are allowed, free and same(i, j, a, b) as its first. Returns [[i, j, w, h], …].
 */
function joinCells(cols, rows, ok, same, mw, mh, k0) {
  const used = new Uint8Array(cols * rows), out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (used[j * cols + i] || !ok(i, j)) continue;
    const tw = 1 + Math.floor(rand(i * 1.31 + j * 2.17 + k0) * mw), th = 1 + Math.floor(rand(i * 2.71 + j * 1.13 + k0 + 1) * mh), fits = (a, b) => a < cols && b < rows && !used[b * cols + a] && ok(a, b) && same(i, j, a, b);
    let bw = 1, bh = 1;
    while (bw < tw && fits(i + bw, j)) bw++;
    grow: while (bh < th) { for (let q = 0; q < bw; q++) if (!fits(i + q, j + bh)) break grow; bh++; }
    for (let b = 0; b < bh; b++) for (let q = 0; q < bw; q++) used[(j + b) * cols + i + q] = 1;
    out.push([i, j, bw, bh]);
  }
  return out;
}
/**
 * The machine, built of blocks: the shape — cov(i, j), how much of a cell it covers (0–255) — over a grid
 * of `cell` units from (x0, y0), joined into rectangles, each one flat tone: greys by a smooth field and a
 * light from the upper left, so neighbours agree; one in ten in ink, one in twelve bare paper, one in
 * eighteen red; some with a hairline round them, a row of slots or a rivet. Masts with yards rise from
 * the highest columns.
 */
function cnMachine(ctx, x0, y0, cols, rows, cell, cov, red, k0) {
  const blocks = joinCells(cols, rows, (i, j) => cov(i, j) > 110, () => true, 4, 6, k0), W = cols * cell, H = rows * cell, ink = cnInk(), fills = new Map(), lines = [], slots = [], dots = [];
  const put = (c, r) => { const key = c.map(Math.round).join(); (fills.get(key) || fills.set(key, []).get(key)).push(r); };
  for (const [i, j, bw, bh] of blocks) {
    const x = x0 + i * cell, y = y0 + j * cell, w = bw * cell, h = bh * cell, cx = x + w / 2, cy = y + h / 2, r = rand(i * 3.7 + j * 5.3 + k0 + 2);
    const v = 0.55 * cnNoise((cx - x0) / (W * 0.16), (cy - y0) / (W * 0.16)) + 0.45 * (0.5 * (cx - x0) / W + 0.5 * (cy - y0) / H);
    put(r < 0.055 ? red : r < 0.155 ? ink : r < 0.235 ? CN.light : CN.greys[Math.min(3, Math.floor(v * 4.4))], [x, y, w + 0.6, h + 0.6]);
    if (rand(i * 6.1 + j * 2.9 + k0 + 3) < 0.3) lines.push([x, y, w, h]);
    if (bw * bh >= 3 && rand(i * 4.3 + j * 7.1 + k0 + 4) < 0.28) slots.push([x, y, w, h]);
    else if (rand(i * 8.9 + j * 3.3 + k0 + 5) < 0.08) dots.push([cx, cy, Math.min(w, h) * 0.28]);
  }
  for (const [key, list] of fills) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (const [x, y, w, h] of list) ctx.rect(x, y, w, h); ctx.fill(); }
  ctx.fillStyle = css(mix(CN.ink, CN.greys[3], 0.3)); ctx.beginPath();
  for (const [x, y, w, h] of slots) { const n = Math.max(2, Math.round(w / (cell * 0.6))); for (let q = 0; q < n; q++) ctx.rect(x + (q + 0.25) * (w / n), y + h * 0.3, (w / n) * 0.5, Math.min(h * 0.25, cell * 0.3)); }
  ctx.fill();
  ctx.fillStyle = css(cnGround()); ctx.beginPath(); for (const [x, y, r] of dots) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } ctx.fill();
  ctx.strokeStyle = css(ink, 0.55); ctx.lineWidth = Math.max(0.8, cell * 0.05); ctx.beginPath(); for (const [x, y, w, h] of lines) ctx.rect(x, y, w, h); ctx.stroke();
  const tops = [];
  for (let i = 0; i < cols; i++) { let j = 0; while (j < rows && cov(i, j) <= 110) j++; if (j < rows) tops.push([i, j]); }
  tops.sort((a, b) => a[1] - b[1]);
  const masts = [];
  for (const t of tops) { if (masts.length >= 3) break; if (masts.every((m) => Math.abs(m[0] - t[0]) > cols * 0.12)) masts.push(t); }
  ctx.strokeStyle = css(ink); ctx.fillStyle = css(ink); ctx.lineCap = "butt";
  for (const [i, j] of masts) {
    const x = x0 + (i + 0.5) * cell, y = y0 + j * cell, mh = H * (0.1 + rand(i * 2.3 + k0 + 9) * 0.12);
    ctx.lineWidth = Math.max(1, cell * 0.14); ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y - mh);
    for (const f of [0.4, 0.7]) { const yw = W * 0.035 * (1.3 - f); ctx.moveTo(x - yw, y - mh * f); ctx.lineTo(x + yw, y - mh * f); }
    ctx.stroke(); ctx.fillRect(x - cell * 0.3, y - mh * 0.9, cell * 0.6, cell * 0.45);
  }
}
/** Without a graphic, a ship seen side on, in tiers: the hull, decks stepping in, the bridge, a funnel, two turrets — as cov() for cnMachine over cols × rows. */
const cnShip = (cols, rows) => (i, j) => {
  const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
  const hull = v > 0.7 && v < 0.95 && Math.abs(u - 0.5) < 0.44 - (v - 0.7) * (u > 0.5 ? 0.9 : 0.3);
  const tiers = (v > 0.55 && Math.abs(u - 0.46) < 0.26) || (v > 0.4 && Math.abs(u - 0.44) < 0.16) || (v > 0.26 && Math.abs(u - 0.43) < 0.08) || (v > 0.34 && Math.abs(u - 0.6) < 0.035);
  const turrets = v > 0.6 && v < 0.7 && (Math.abs(u - 0.17) < 0.05 || Math.abs(u - 0.76) < 0.05);
  return hull || tiers || turrets ? 255 : 0;
};
/** Rays fanning out from (vx, vy) past the edges: long thin wedges of grey, ink and red, set round by the golden angle so each new one falls in a gap; `n`, the last by degrees. */
function cnRays(ctx, F, vx, vy, n, red, k0) {
  const R = Math.hypot(F.x1 - F.x0, F.y1 - F.y0) * 1.5, cols = [CN.greys[0], cnInk(), CN.greys[1], red, CN.greys[2], CN.greys[0], cnInk()];
  for (let i = 0; i < Math.ceil(n); i++) {
    const a = TAU * ((i * 0.381966 + rand(k0)) % 1), half = (0.018 + rand(i * 2.3 + k0 + 1) * 0.05) * (0.3 + 0.7 * clamp(n - i));
    ctx.fillStyle = css(cols[i % cols.length]); shapeOf(ctx, [[vx, vy], [vx + Math.cos(a - half) * R, vy + Math.sin(a - half) * R], [vx + Math.cos(a + half) * R, vy + Math.sin(a + half) * R]]); ctx.fill();
  }
}
/**
 * The great diagonal forms, in fractions of the field: a red wedge rising from a lower corner, a black band
 * falling across, a grey corner, a thin red band climbing out, a pale wedge, a black one — `n` of them,
 * each growing out of its corner by degrees; mirrored when `flip`.
 */
function cnWedges(ctx, F, n, red, flip) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, X = (t) => (flip ? F.x1 - fw * t : F.x0 + fw * t), Y = (t) => F.y0 + fh * t, ink = cnInk();
  const forms = [
    [red, [-0.02, 1.02], [[-0.02, 1.02], [0.66, 1.02], [-0.02, 0.4]]],
    [ink, [0.62, -0.02], [[0.56, -0.02], [0.68, -0.02], [0.2, 1.02], [0.08, 1.02]]],
    [CN.greys[1], [1.02, -0.02], [[1.02, -0.02], [1.02, 0.5], [0.58, -0.02]]],
    [red, [1.02, 0.18], [[0.3, 1.02], [0.37, 1.02], [1.02, 0.24], [1.02, 0.12]]],
    [CN.greys[0], [-0.02, -0.02], [[-0.02, -0.02], [0.4, -0.02], [-0.02, 0.24]]],
    [ink, [1.02, 1.02], [[0.8, 1.02], [1.02, 1.02], [1.02, 0.64]]],
  ];
  for (let i = 0; i < Math.min(forms.length, Math.ceil(n)); i++) {
    const [c, [ax, ay], pts] = forms[i], s = 0.25 + 0.75 * clamp(n - i);
    ctx.fillStyle = css(c); shapeOf(ctx, pts.map(([x, y]) => [X(ax + (x - ax) * s), Y(ay + (y - ay) * s)])); ctx.fill();
  }
}
/**
 * A steel truss in perspective, from its near end at xn (d0 deep) to its far end at xf (d1 deep), its middle
 * on the line y: the chords top and bottom and the zigzag of struts between, each a flat bar in `col` with
 * a lit edge.
 */
function cnTruss(ctx, xn, xf, y, d0, d1, col, lit) {
  const L = Math.abs(xf - xn), X = (t) => xn + (xf - xn) * t, D = (t) => d0 + (d1 - d0) * t, ts = [0];
  const bar = (ax, ay, bx, by, w) => {
    const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy) || 1, ox = ((-dy / n) * w) / 2, oy = ((dx / n) * w) / 2;
    ctx.fillStyle = css(col); shapeOf(ctx, [[ax + ox, ay + oy], [bx + ox, by + oy], [bx - ox, by - oy], [ax - ox, ay - oy]]); ctx.fill();
    ctx.strokeStyle = css(lit); ctx.lineWidth = Math.max(1, w * 0.25); ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.lineTo(bx + ox, by + oy); ctx.stroke();
  };
  for (let t = 0; t < 1;) { t = Math.min(1, t + (D(t) * 0.95) / Math.max(1, L)); ts.push(t); }
  ts.forEach((t, q) => {
    const x = X(t), w = D(t) * 0.07;
    bar(x, y - D(t) / 2, x, y + D(t) / 2, w);
    if (q) { const tp = ts[q - 1], xp = X(tp); if (q % 2) bar(xp, y - D(tp) / 2, x, y + D(t) / 2, w); else bar(xp, y + D(tp) / 2, x, y - D(t) / 2, w); }
  });
  bar(X(0), y - D(0) / 2, X(1), y - D(1) / 2, d0 * 0.1); bar(X(0), y + D(0) / 2, X(1), y + D(1) / 2, d0 * 0.1);
}
/** Bars and blocks set about the edges of the field: tall bars of ink and of red, squares of grey, stacks of short rules, a block of bare paper with a hairline round it — `n`, the last by degrees, kept off the boxes in `avoid`. */
function cnBars(ctx, F, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), ink = cnInk();
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const kind = i % 5, left = rand(i * 1.9 + k0) < 0.5, x = left ? F.x0 + fw * (0.02 + rand(i * 2.3 + k0 + 1) * 0.28) : F.x1 - fw * (0.04 + rand(i * 2.7 + k0 + 2) * 0.28), y = F.y0 + fh * (0.08 + rand(i * 3.1 + k0 + 3) * 0.8), r = rand(i * 4.3 + k0 + 4);
    const box = kind === 0 || kind === 3 ? { x, y, w: u * (0.008 + r * 0.018), h: fh * (0.14 + rand(i * 5.1 + k0 + 5) * 0.32) } : kind === 1 ? { x, y, w: u * (0.04 + r * 0.07), h: u * (0.04 + r * 0.07) } : kind === 2 ? { x, y, w: u * (0.05 + r * 0.05), h: u * 0.06 } : { x, y, w: u * (0.08 + r * 0.08), h: u * (0.05 + r * 0.06) };
    if (avoid.some((b) => overlaps(b, box))) continue;
    ctx.globalAlpha = clamp(n - i);
    if (kind === 0) { ctx.fillStyle = css(ink); ctx.fillRect(box.x, box.y, box.w, box.h); }
    else if (kind === 3) { ctx.fillStyle = css(red); ctx.fillRect(box.x, box.y, box.w * 1.4, box.h * 0.8); }
    else if (kind === 1) { ctx.fillStyle = css([CN.greys[2], ink, red, CN.greys[1]][Math.floor(r * 4)]); ctx.fillRect(box.x, box.y, box.w, box.h); }
    else if (kind === 2) { ctx.fillStyle = css(ink); for (let q = 0; q < 4; q++) ctx.fillRect(box.x, box.y + q * box.h * 0.27, box.w * (q % 2 ? 0.7 : 1), box.h * 0.12); }
    else { ctx.fillStyle = css(CN.light); ctx.fillRect(box.x, box.y, box.w, box.h); ctx.strokeStyle = css(ink); ctx.lineWidth = 1.2; ctx.strokeRect(box.x, box.y, box.w, box.h); }
  }
  ctx.restore();
}
/** Construction lines: long hairlines through the vanishing point (vx, vy), level ones, arcs about it, dot grids, crosshairs, a line of red — `n`, the last by degrees; the grids and crosshairs kept off `avoid`. */
function cnLines(ctx, F, vx, vy, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), R = Math.hypot(fw, fh), ink = cnInk();
  ctx.save(); ctx.lineCap = "butt";
  for (let i = 0; i < Math.ceil(n); i++) {
    const kind = i % 6, r1 = rand(i * 2.1 + k0), r2 = rand(i * 3.7 + k0 + 1), x = F.x0 + fw * (0.05 + 0.9 * r1), y = F.y0 + fh * (0.08 + 0.84 * r2);
    ctx.globalAlpha = clamp(n - i); ctx.strokeStyle = css(ink, 0.75); ctx.fillStyle = css(ink); ctx.lineWidth = 1.2;
    if (kind === 0) { const a = r1 * Math.PI; ctx.beginPath(); ctx.moveTo(vx - Math.cos(a) * R, vy - Math.sin(a) * R); ctx.lineTo(vx + Math.cos(a) * R, vy + Math.sin(a) * R); ctx.stroke(); }
    else if (kind === 1) { ctx.beginPath(); ctx.moveTo(F.x0, y); ctx.lineTo(F.x1, y); ctx.stroke(); }
    else if (kind === 2) { const a0 = r2 * TAU; ctx.beginPath(); ctx.arc(vx, vy, u * (0.15 + r1 * 0.4), a0, a0 + Math.PI * (0.5 + r2)); ctx.stroke(); }
    else if (kind === 3) { const s = u * 0.018, box = { x, y, w: s * 6, h: s * 4 }; if (avoid.some((b) => overlaps(b, box))) continue; ctx.beginPath(); for (let q = 0; q < 24; q++) { const dx = x + (q % 6) * s, dy = y + Math.floor(q / 6) * s; ctx.moveTo(dx + 1.8, dy); ctx.arc(dx, dy, 1.8, 0, TAU); } ctx.fill(); }
    else if (kind === 4) { const s = u * 0.03, box = { x: x - s, y: y - s, w: s * 2, h: s * 2 }; if (avoid.some((b) => overlaps(b, box))) continue; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.moveTo(x + s * 0.45, y); ctx.arc(x, y, s * 0.45, 0, TAU); ctx.stroke(); }
    else { ctx.strokeStyle = css(red); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - fw * 0.3, y + fh * 0.3); ctx.lineTo(x + fw * 0.3, y - fh * 0.3); ctx.stroke(); }
  }
  ctx.restore();
}
/**
 * Small type set as furniture, as these posters set it — greeked, not words: a block of lines, a short
 * thick rule of red over a few lines, bullets of small squares with lines beside them, a column of lines
 * turned on its side, a slab of ink with paper lines in it, an arrow. `n`, each kept off `avoid`.
 */
function cnMarks(ctx, F, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), ink = cnInk(), lh = u * 0.016, at = [[0.05, 0.6], [0.44, 0.86], [0.84, 0.08], [0.9, 0.48], [0.3, 0.05], [0.6, 0.07]];
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const [fx, fy] = at[i % at.length], x = F.x0 + fw * (fx + (rand(i * 2.3 + k0) - 0.5) * 0.06), y = F.y0 + fh * (fy + (rand(i * 3.1 + k0 + 1) - 0.5) * 0.06), kind = i % 6, bw = u * 0.2;
    const box = kind === 3 ? { x, y, w: lh * 4, h: bw } : { x, y, w: bw, h: lh * 6 };
    if (avoid.some((b) => overlaps(b, box))) continue;
    ctx.globalAlpha = clamp(n - i);
    if (kind === 0) greeked(ctx, x, y, bw, 5, lh, css(ink, 0.85), 2900 + i * 13);
    else if (kind === 1) { ctx.fillStyle = css(red); ctx.fillRect(x, y, bw * 0.35, lh * 0.9); greeked(ctx, x, y + lh * 2, bw * 0.8, 3, lh, css(ink, 0.85), 2910 + i * 13); }
    else if (kind === 2) { for (let q = 0; q < 3; q++) { ctx.fillStyle = css(q === 0 ? red : ink); ctx.fillRect(x, y + q * lh * 1.8, lh * 0.8, lh * 0.8); greeked(ctx, x + lh * 1.8, y + q * lh * 1.8 + lh * 0.2, bw * 0.6, 1, lh, css(ink, 0.85), 2920 + i * 13 + q); } }
    else if (kind === 3) { ctx.save(); ctx.translate(x, y + bw); ctx.rotate(-Math.PI / 2); greeked(ctx, 0, 0, bw, 3, lh, css(ink, 0.85), 2930 + i * 13); ctx.restore(); }
    else if (kind === 4) { ctx.fillStyle = css(ink); ctx.fillRect(x, y, bw * 0.7, lh * 4.4); greeked(ctx, x + lh, y + lh, bw * 0.7 - lh * 2, 3, lh, css(cnGround()), 2940 + i * 13); }
    else { ctx.fillStyle = css(ink); ctx.fillRect(x, y + lh * 1.2, bw * 0.5, lh * 0.7); shapeOf(ctx, [[x + bw * 0.5, y + lh * 0.2], [x + bw * 0.62, y + lh * 1.55], [x + bw * 0.5, y + lh * 2.9]]); ctx.fill(); }
  }
  ctx.restore();
}
const construct = {
  id: "construct",
  art: "machine",
  repaint: (c) => `a constructivist poster made from the photograph, in the manner of the Soviet avant-garde of the 1920s: the subject built of flat rectangles of grey, black and cream, bold diagonal wedges, a large red disc, radiating lines and thin construction lines on aged cream paper, ${c} as the one colour; still the same subject, no text.`,
  about: { zh: "构成主义：二十年代苏联先锋派海报，经今天的插画师重新演绎——微微泛黄的米色旧纸上，频道图形被拆成一块块灰、黑、纸白和一点红的矩形，像机械一样重新拼装起来，顶上竖着桅杆；巨大的斜切楔形、一轮大圆、从灭点放射出去的光线、透视的钢桁架、竖条和色块、细细的构造线和点阵、当作版面装饰的小字；下方可以倒映在平静的水面里。平涂、硬边、只有黑白灰和一种颜色（默认红色，可以换成频道色）。有力量、有秩序、工业感强——适合科技、工业、建筑、历史、军事、城市、设计与观点类内容。照片会被压成几级灰阶。可选米色纸或黑底；自带平直的版式。", en: "Constructivist: the Soviet avant-garde poster of the 1920s as illustrators take it up today — on cream paper gone a little brown, the channel graphic broken into rectangles of grey, black, bare paper and a little red and built again like a machine, masts rising from its top; great diagonal wedges, a disc, rays fanning from a vanishing point, a steel truss in perspective, bars and blocks, hairline construction lines and dot grids, small type set as furniture; the lower part can be doubled in still water. Flat and hard-edged, in black, white, greys and one colour (red, or turned to the channel colour). Strong, ordered, industrial — for technology, industry, architecture, history, the military, cities, design and opinion. A photo is pressed into a few greys. Cream paper or black; flat layouts of its own." },
  name: { zh: "构成主义", en: "Constructivist" },
  seeded: true,
  scene: { machine: { zh: "机械体", en: "Machine" }, circle: { zh: "大圆", en: "Disc" }, rays: { zh: "放射灭点", en: "Centre of the rays" }, truss: { zh: "钢桁架", en: "Steel truss" } },
  params: [
    { key: "machine", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "机械体", en: "Machine" } },
    { key: "fragment", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "块面碎度", en: "Finer blocks" } },
    { key: "wedges", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "斜切楔形", en: "Diagonal wedges" } },
    { key: "circle", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "大圆", en: "Disc" } },
    { key: "rays", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "放射线", en: "Rays" } },
    { key: "truss", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "钢桁架", en: "Steel truss" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "竖条色块", en: "Bars and blocks" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "构造线", en: "Construction lines" } },
    { key: "marks", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "版面小字", en: "Small type" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "水面倒影", en: "Water" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "旧纸", en: "Old paper" } },
    { key: "chan", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "红色换成频道色", en: "Channel colour for the red" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片灰阶", en: "Photo in greys" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(cnGround()), text: css(cnInk()), dim: css(cnInk(), 0.6), titleFill: css(cnInk()), titleInk: css(cnGround()), grid: () => css(cnInk(), 0.12) }),
  /**
   * The paper; rays from the vanishing point; the wedges; the disc; the trusses; the machine; the bars; the
   * water mirroring all that; the construction lines and the small type over it. A photo is pressed into
   * greys, and when it fills the canvas the wedges and the disc are printed over it, multiplied.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), red = cnRed(C, p), flip = rand(3000) > 0.5;
    const disc = (x) => {
      if (p.circle <= 0) return;
      const R = u * (0.08 + 0.26 * p.circle), [dx, dy] = objAt("circle", F.x0 + fw * 0.78, F.y0 + fh * 0.3, x), sd = -1, r2 = R * 0.42 * clamp((p.circle - 0.35) / 0.65), ring = clamp((p.circle - 0.55) / 0.45);   // a scene object
      x.fillStyle = css(red); x.beginPath(); x.arc(dx, dy, R, 0, TAU); x.fill();
      if (r2 > 0) { x.fillStyle = css(cnInk()); x.beginPath(); x.arc(dx + sd * R * 0.85, dy + R * 0.75, r2, 0, TAU); x.fill(); }
      if (ring > 0) { const a0 = rand(3001) * TAU; x.strokeStyle = css(cnInk(), 0.8); x.lineWidth = 1.5; x.beginPath(); x.arc(dx, dy, R * 1.16, a0, a0 + TAU * 0.7 * ring); x.stroke(); }
    };
    if (env.photo) {
      env.drawPhoto(0, p.mono > 0 ? { key: `cnGreys|${p.mono}`, fn: (d) => lutPixels(d, toneTable(CN_TONES, 0.75), p.mono) } : null);   // the photo itself pressed into greys
      if (L.fill) { ctx.save(); ctx.globalCompositeOperation = "multiply"; cnWedges(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.wedges * 6, red, flip); disc(ctx); ctx.restore(); }
      return true;
    }
    if (L.ground !== false) { ctx.fillStyle = css(cnGround()); ctx.fillRect(0, 0, w, h); }
    if (!L.grid) return true;
    let [vx, vy] = [F.x0 + fw * (flip ? 0.38 : 0.62), F.y0 + fh * 0.48];
    if (p.rays > 0) { [vx, vy] = objAt("rays", vx, vy, ctx); cnRays(ctx, F, vx, vy, p.rays * 18, red, 3010); }   // a scene object
    if (p.wedges > 0) cnWedges(ctx, F, p.wedges * 6, red, flip);
    disc(ctx);
    if (p.truss > 0) {   // a scene object: a far truss (once the slider is past half way) and a near one, each reaching further as it rises
      const xn = F.x1 + fw * 0.05, sd = -1, y = F.y0 + fh * 0.2, back = clamp((p.truss - 0.4) / 0.6);
      ctx.save(); shift("truss", xn + sd * fw * 0.1, y, ctx);
      if (back > 0) cnTruss(ctx, xn, xn + sd * fw * (0.15 + 0.6 * back), y - fh * 0.08, fh * 0.1, fh * 0.04, CN.greys[0], CN.light);
      cnTruss(ctx, xn, xn + sd * fw * (0.2 + 0.75 * p.truss), y, fh * 0.2, fh * 0.07, CN.greys[2], CN.greys[0]);
      ctx.restore();
    }
    if (p.machine > 0) {   // a scene object
      const size = Math.min(fh, fw * 0.9) * (0.35 + 0.6 * p.machine), [cx, cy] = objAt("machine", F.x0 + fw * 0.66, F.y1 - size * 0.5, ctx), cell = size * (0.07 - 0.055 * p.fragment);
      const x0 = cx - size, y0 = cy - size * 0.62, cols = Math.ceil((size * 2) / cell), rows = Math.ceil((size * 1.24) / cell), S = canPaint(ctx) && graphicShape(env);
      let cov = null;
      if (S) { const c = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell); cov = (i, j) => c[j * cols + i]; }
      else if (canPaint(ctx)) cov = cnShip(cols, rows);
      if (cov) { ctx.save(); ctx.globalAlpha = Math.min(1, p.machine * 5); cnMachine(ctx, x0, y0, cols, rows, cell, cov, red, 3020); ctx.restore(); }
    }
    const avoid = keepClear(ctx, env);
    if (p.bars > 0) cnBars(ctx, F, p.bars * 14, red, avoid, 3040);
    if (p.water > 0) {
      const wl = F.y1 - fh * 0.32 * p.water;
      reflectBelow(ctx, 0, w, wl, F.y1 + 2, cnGround(), 0.35, 0.6, 3050);
      ctx.save(); ctx.fillStyle = css(cnInk(), 0.35);   // ripples: level hairlines, closer toward the line
      for (let i = 0, n = Math.round(6 + 30 * p.water); i < n; i++) { const y = wl + (F.y1 - wl) * rand(i * 2.3 + 3051) ** 1.5, x = F.x0 + fw * rand(i * 3.1 + 3052) * 0.8; ctx.fillRect(x, y, fw * (0.05 + rand(i * 4.7 + 3053) * 0.25), 1.2); }
      ctx.fillStyle = css(cnInk(), 0.8); ctx.fillRect(F.x0, wl - 1, fw, 2);
      ctx.restore();
    }
    if (p.lines > 0) cnLines(ctx, F, vx, vy, p.lines * 14, red, avoid, 3060);
    if (p.marks > 0) cnMarks(ctx, F, p.marks * 7, red, avoid, 3070);
    return true;
  },
  /** A constructivist's sheet: a square grid turned on the slant, and a great circle across it. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, -0.21, 120); slantPath(ctx, w, h, -0.21 + Math.PI / 2, 120);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w * 0.68, h * 0.46, h * 0.4, 0, TAU); ctx.stroke();
    ctx.restore();
  },
  accent: { fill: (C) => css(cnRed(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(CN.ink); ctx.lineWidth = 12; run(0, 0); } },
  /** Upright capitals in ink (paper on black), over a copy of them printed a little off in red (the shadow slider); highlighted words in red, their copy in ink. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), ink = o.fill || cnInk(), red = cnRed(o.C), hi = o.hi || red;
    if (s > 0) pass((a, x) => { ctx.fillStyle = css(a.hi ? cnInk() : red); ctx.fillText(a.t, x + fs * 0.035 * s, fs * 0.035 * s); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: CN.ink, light: CN.light, mid: CN.greys[1], dark: CN.greys[3], colour: (c) => (sat(c) > 0.3 ? cnRed(C, p) : grey(c)) }, stroke: { ink: CN.ink, light: CN.light }, line: 0.6 })),
  sticker: painters({ line: CN.ink, lineScale: 0.45, join: "miter", tone: inkAs(CN.ink, (c) => mix(grey(c), c, 0.35)), shadow: null }),
  /** The corner tag: paper capitals on a slab of ink, a bar of red at its head. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 1.45, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(cnInk()); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(cnRed(C)); ctx.fillRect(x, top, f * 0.55, h);
    ctx.fillStyle = ink || css(cnGround()); spaced(ctx, str, x + f * 0.95, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a ruled border, a square of red at its corner. */
  frame(ctx, env) {
    const { w, h } = env, b = 26;
    ctx.save(); ctx.strokeStyle = css(cnInk(), 0.85); ctx.lineWidth = 2.5; ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    ctx.fillStyle = css(cnRed(env.C)); ctx.fillRect(b - 7, b - 7, 22, 22); ctx.restore();
  },
  image(ctx) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) {
    const a = p.paper;
    if (a <= 0) return;
    crumple(ctx, w, h, a * 0.45);
    wear(ctx, w, h, dark ? [70, 62, 52] : [128, 98, 62], 0.4 * a, dark ? "lighten" : "multiply");
    grain(ctx, a * 0.55, unit, !dark);
    ctx.save(); ctx.globalCompositeOperation = "multiply"; vignette(ctx, w, h, dark ? [0, 0, 0] : [176, 140, 92], 0.45 * a, 0.5); ctx.restore();
  },
  prompt: `Emblems for a constructivist poster of the 1920s — bold, geometric, industrial — that read at a glance:
- one clear object per sticker (a gear, a factory chimney, a ship, a megaphone, a tractor, a radio tower, a train, a hammer, a star), built from flat rectangles, triangles and circles; no realism, no fine detail;
- flat colour only: "ink" (black), greys and "white" (cream paper), with the main colour as the one strong accent;
- the app adds a thin ink line and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Industrial things as a constructivist would build them, from a few boxes and cylinders — a radio tower, a factory, a ship's bridge, a crane, a locomotive; no realism, no fine detail.
- the renderer paints faces in greys, black and cream with a thin ink line: do NOT try to draw shading or outlines yourself;
- "white" is cream paper, "dark" near-black, and "main" the poster's one colour (red, or the channel colour) — use it for one to three parts.`,
};

// ====================================================================== dark deco: the Art Deco city by night, painted on black
// Gotham as the animated series of the 90s painted its backgrounds, and the deco posters after it:
// painted on black paper, so the dark is the ground and only the light is laid on — an ultramarine night,
// stepped towers lit by gold windows and floodlit from their setbacks, searchlights crossing, a moon
// barred by cloud, lavender fog between the rows, an airship, a neon blade sign; the floodlight in the
// channel's colour (the paintings' crimson); lettering as a theatre front's lit letters, tungsten lamps
// glowing warm, the highlighted words neon in the channel's colour. Gilded, black and gold.
const DK = { ink: [7, 6, 16], base: [12, 10, 28], cream: [255, 242, 214], gold: [240, 186, 88], amber: [255, 200, 108], pale: [255, 232, 168], crimson: [214, 28, 42] };
/** The night, top to horizon, at gilt g (0: Gotham's ultramarine, 1: black and gold), reddened by r toward Gotham's crimson sky. */
const dkSky = (g, r = 0) => [mix(mix([3, 3, 14], [5, 4, 3], g), [12, 2, 6], r), mix(mix([12, 11, 54], [14, 11, 8], g), [70, 6, 18], r), mix(mix([34, 30, 128], [36, 26, 16], g), [178, 18, 34], r), mix(mix([86, 64, 188], [96, 62, 30], g), [246, 70, 52], r)];
const dkFog = (g, r = 0) => mix(mix([128, 108, 226], [134, 104, 70], g), [236, 96, 96], r);
const dkMoonlight = (g) => mix([212, 210, 255], [255, 234, 198], g);
/** The channel colour as floodlight: vivid, and a blue made light enough to read as light on the night. */
function dkSpot(C) { const c = boost(C, 0.7); return c[2] > c[0] && c[2] > c[1] ? mix(c, [236, 236, 255], clamp(0.55 - lum(c)) * 0.8) : c; }
/** Stars: pinpricks thicker toward the top, a few sparkles with four points; `n`, the last by degrees. */
function dkStars(ctx, F, bottom, n, g, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, bottom - F.y0), col = mix([196, 194, 255], [255, 236, 200], g);
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const x = F.x0 + fw * rand(i * 1.3 + k0), y = F.y0 + span * rand(i * 2.7 + k0 + 1) ** 1.7, big = rand(i * 3.9 + k0 + 2) ** 7;
    ctx.globalAlpha = (0.3 + 0.7 * rand(i * 4.3 + k0 + 3)) * clamp(n - i);
    if (big > 0.4) starMark(ctx, x, y, 4 + big * 9, 4, col); else { ctx.fillStyle = css(col); ctx.beginPath(); ctx.arc(x, y, 0.7 + big * 3, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
/** The moon: a halo, the disc lit from its upper left with a few soft seas, and flat bars of cloud across it, each with a lit rim. */
function dkMoon(ctx, x, y, r, g, sky, k) {
  const lt = dkMoonlight(g), halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.4);
  halo.addColorStop(0, css(lt, 0.3)); halo.addColorStop(0.35, css(lt, 0.08)); halo.addColorStop(1, css(lt, 0));
  ctx.fillStyle = halo; ctx.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
  const body = ctx.createLinearGradient(x - r, y - r, x + r, y + r); body.addColorStop(0, css(mix(lt, [255, 255, 255], 0.65))); body.addColorStop(1, css(mix(lt, sky[2], 0.3)));
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = body; ctx.fill(); ctx.clip();
  ctx.fillStyle = css(mix(lt, sky[2], 0.55), 0.2);
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(x + (rand(k + i) - 0.45) * r * 1.3, y + (rand(k + i * 2.1 + 1) - 0.5) * r * 1.3, r * (0.12 + rand(k + i * 3.3) * 0.22), r * (0.1 + rand(k + i * 4.1) * 0.16), rand(k + i * 5.7) * 3, 0, TAU); ctx.fill(); }
  ctx.restore();
  const cl = mix(sky[1], sky[2], 0.35);
  for (let i = 0; i < 4; i++) {   // long thin bars of cloud drifting across it, tapering to points, the moon catching their upper edge
    const cy = y + r * (-0.75 + i * 0.5 + (rand(k + i * 6.1) - 0.5) * 0.2), len = r * (3 + rand(k + i * 7.3) * 3.5), th = r * (0.07 + rand(k + i * 8.9) * 0.09), cx = x + (rand(k + i * 9.7) - 0.5) * r * 3;
    const bar = (dy, colour) => { ctx.fillStyle = colour; ctx.beginPath(); ctx.moveTo(cx - len / 2, cy + dy); ctx.bezierCurveTo(cx - len * 0.2, cy - th * 1.3 + dy, cx + len * 0.1, cy - th + dy, cx + len / 2, cy + th * 0.2 + dy); ctx.bezierCurveTo(cx + len * 0.1, cy + th * 0.9 + dy, cx - len * 0.2, cy + th * 0.7 + dy, cx - len / 2, cy + dy); ctx.fill(); };
    if (Math.abs(cy - y) < r) bar(-Math.max(1.2, th * 0.35), css(lt, 0.55));
    bar(0, css(cl));
  }
}
/**
 * Searchlights: beams thrown up from behind the skyline round (sx, sy), leaning in turn one way and the
 * other so they cross; each a soft wide wedge with a brighter core, fading with its length, and the
 * glow of its lamp. Added with "lighter", so they brighten where they cross. `n`, the last by degrees.
 */
function dkBeams(ctx, F, sx, sy, n, g, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, L = Math.hypot(fw, fh) * 1.05, col = mix([168, 168, 255], [255, 236, 204], g), m = Math.ceil(n);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < m; i++) {
    const a = clamp(n - i), x = sx + (i - (m - 1) / 2) * fw * 0.13 + (rand(k0 + i) - 0.5) * fw * 0.06, ang = -Math.PI / 2 + (i % 2 ? -1 : 1) * (0.12 + rand(k0 + i * 2.3 + 1) * 0.42), ex = Math.cos(ang), ey = Math.sin(ang);
    for (const [spread, al] of [[0.07, 0.12], [0.03, 0.22], [0.012, 0.4]]) {
      const gr = ctx.createLinearGradient(x, sy, x + ex * L, sy + ey * L); gr.addColorStop(0, css(col, al * a)); gr.addColorStop(0.45, css(col, al * a * 0.45)); gr.addColorStop(1, css(col, 0));
      const s = spread * (0.7 + rand(k0 + i * 3.7) * 0.6);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x - ey * 2, sy + ex * 2); ctx.lineTo(x + Math.cos(ang - s) * L, sy + Math.sin(ang - s) * L); ctx.lineTo(x + Math.cos(ang + s) * L, sy + Math.sin(ang + s) * L); ctx.lineTo(x + ey * 2, sy - ex * 2); ctx.fill();
    }
    const lamp = ctx.createRadialGradient(x, sy, 0, x, sy, fh * 0.07); lamp.addColorStop(0, css(col, 0.7 * a)); lamp.addColorStop(1, css(col, 0));
    ctx.fillStyle = lamp; ctx.fillRect(x - fh * 0.07, sy - fh * 0.07, fh * 0.14, fh * 0.14);
  }
  ctx.restore();
}
/** A band of fog lying at y, `th` thick either side, across x0–x1: a soft band and puffs along its top. */
function dkFogBand(ctx, x0, x1, y, th, col, a, k0) {
  if (a <= 0) return;
  const gr = ctx.createLinearGradient(0, y - th, 0, y + th); gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.55, css(col, a)); gr.addColorStop(1, css(col, a * 0.35));
  ctx.fillStyle = gr; ctx.fillRect(x0, y - th, x1 - x0, th * 2);
  for (let i = 0, n = Math.max(3, Math.round((x1 - x0) / (th * 2.2))); i < n; i++) {
    const px = x0 + (x1 - x0) * ((i + rand(k0 + i) * 0.8) / n), py = y - th * (0.2 + rand(k0 + i * 2.3) * 0.5), r = th * (0.5 + rand(k0 + i * 3.1) * 0.7);
    const pg = ctx.createRadialGradient(px, py, 0, px, py, r); pg.addColorStop(0, css(col, a * 0.5)); pg.addColorStop(1, css(col, 0));
    ctx.fillStyle = pg; ctx.fillRect(px - r, py - r, r * 2, r * 2);
  }
}
/**
 * A row of the city, its feet at `base`: towers of setbacks, a few of them (R.tall) rising far above the
 * rest, each crowned in one of the deco ways — a needle, a crown of stacked arches pricked with lit
 * triangles, a mast with its red light, a stepped pyramid; the side away from the night a shade lighter.
 * Windows in vertical bands, lit in runs (`lit` of them), gold; with `flood`, pilasters lit from below in
 * the floodlight's colour, fading up the face, and the tall ones' crowns washed with it. R: the row's sizes and tone.
 */
function dkRow(ctx, F, top, base, R, lit, flood, spot, g, k0) {
  const fw = F.x1 - F.x0, H = Math.max(10, base - top), u = Math.min(fw, F.y1 - F.y0), wins = new Map(), lights = [], reds = [], moon = dkMoonlight(g);
  const add = (c, x, y, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, y, w, h); };
  const GOLD = [DK.amber, DK.amber, DK.amber, DK.pale, DK.pale, DK.gold, [255, 228, 190], mix(DK.amber, spot, 0.5)];
  for (let x = F.x0 - u * 0.04, i = 0; x < F.x1 + u * 0.02; i++) {
    const kk = k0 + i * 7.9, tall = rand(kk + 9) < (R.tall || 0), bw = u * (R.w[0] + rand(kk) * R.w[1]) * (tall ? 1.2 : 1), bh = H * (tall ? 0.82 + rand(kk + 1) * 0.18 : R.h[0] + rand(kk + 1) ** 1.6 * R.h[1]);
    const kind = Math.floor(rand(kk + 2) * 5), nt = R.tiers ? (tall ? 3 : 1 + Math.floor(rand(kk + 3) * 3)) : 1, side = mix(R.body, R.rim, 0.14), tiers = [];
    let y = base, tw = bw;
    for (let t = 0; t < nt; t++) { const th = nt === 1 ? bh : t === 0 ? bh * 0.6 : (bh * 0.4) / (nt - 1); tiers.push([x + (bw - tw) / 2, y - th, tw, th]); y -= th; tw *= 0.74; }
    for (const [tx, ty, w, h] of tiers) { ctx.fillStyle = css(R.body); ctx.fillRect(tx, ty, w, h + 1); ctx.fillStyle = css(side); ctx.fillRect(tx + w * 0.8, ty, w * 0.2, h + 1); }
    const [cx0, cy0, cw] = tiers[tiers.length - 1], mid = cx0 + cw / 2, tip = tall ? bw * 1.6 : bw * 0.9;
    ctx.fillStyle = css(R.body);
    if (kind === 0) { shapeOf(ctx, [[mid - cw * 0.28, cy0 + 1], [mid, cy0 - tip * (1 + rand(kk + 4))], [mid + cw * 0.28, cy0 + 1]]); ctx.fill(); }   // a needle
    else if (kind === 1) {   // a crown of stacked arches, lit triangles in each, and a needle
      let ay = cy0, aw = cw * 0.92;
      for (let j = 0; j < 4; j++) {
        const ah = aw * 0.42;
        ctx.fillStyle = css(R.body); ctx.beginPath(); ctx.moveTo(mid - aw / 2, ay + 1); ctx.lineTo(mid - aw / 2, ay - ah * 0.3); ctx.ellipse(mid, ay - ah * 0.3, aw / 2, ah * 0.7, 0, Math.PI, TAU); ctx.lineTo(mid + aw / 2, ay + 1); ctx.fill();
        if (!R.pin) for (let q = -2; q <= 2; q++) { const a = Math.PI * (1.5 + q * 0.17), tx = mid + Math.cos(a) * aw * 0.36, ty = ay - ah * 0.3 + Math.sin(a) * ah * 0.5; if (rand(kk + j * 3.1 + q) < 0.3 + lit * 0.7) lights.push([tx, ty, aw * 0.07]); }
        ay -= ah * 0.62; aw *= 0.72;
      }
      ctx.fillStyle = css(R.body); shapeOf(ctx, [[mid - aw * 0.3, ay + 2], [mid, ay - tip], [mid + aw * 0.3, ay + 2]]); ctx.fill();
    } else if (kind === 2) { ctx.fillRect(mid - cw * 0.3, cy0 - bh * 0.06, cw * 0.6, bh * 0.06 + 1); ctx.fillRect(mid - Math.max(0.8, cw * 0.035), cy0 - bh * 0.06 - tip, Math.max(1.6, cw * 0.07), tip); reds.push([mid, cy0 - bh * 0.06 - tip]); }   // a mast
    else if (kind === 3) { for (let j = 1, sw = cw; j <= 3; j++) { sw *= 0.72; ctx.fillRect(mid - sw / 2, cy0 - bw * 0.09 * j, sw, bw * 0.09 + 1); } }   // a stepped pyramid
    if (tall && !R.pin) { ctx.fillStyle = css(moon, 0.35); for (const [tx, ty, w, h] of tiers) ctx.fillRect(tx + w - Math.max(1, w * 0.02), ty, Math.max(1, w * 0.02), h); }   // the moon's edge down its far side
    // windows in vertical bands, lit in runs of a few floors; the far row only pinpricks of light
    for (const [tx, ty, w, h] of tiers) {
      const ws = Math.max(1.2, w * (R.pin ? 0.07 : 0.06)), wh = R.pin ? ws : ws * 1.3, pitch = ws * (R.pin ? 2.2 : 2.5), cols = Math.max(1, Math.floor((w * 0.72) / pitch)), gx = (w * 0.8 - cols * pitch) / 2 + (pitch - ws) / 2;
      for (let r = 0, yy = ty + w * 0.08; yy < ty + h - wh * 1.5; r++, yy += wh * (R.pin ? 2.6 : 1.75)) for (let q = 0; q < cols; q++) {
        if (rand(kk * 3.3 + Math.floor(r / 3) * 1.37 + q * 0.191) < lit * R.litK && rand(kk + r * 0.71 + q * 2.3) < 0.85) add(GOLD[Math.floor(rand(kk + Math.floor(r / 3) * 2.9 + q * 5.3) * GOLD.length)], tx + gx + q * pitch, yy, ws, wh);
      }
    }
    // floodlight: pilasters lit from the foot of each tier, fading up its face, a wash over it; a tall one's crown washed too
    if (R.flood && flood > 0 && (tall || rand(kk + 6) < flood * 0.8)) {
      const n = 3 + Math.floor(rand(kk + 7) * 3);
      tiers.forEach(([tx, ty, w, h], t) => {
        const gr = ctx.createLinearGradient(0, ty + h, 0, ty + h - h * (0.55 + 0.45 * flood)), pw = Math.max(1, w * 0.035);
        gr.addColorStop(0, css(mix(spot, [255, 255, 255], 0.3), Math.min(1, 0.4 + flood))); gr.addColorStop(0.35, css(spot, 0.55 * Math.min(1, flood * 1.5))); gr.addColorStop(1, css(spot, 0));
        ctx.fillStyle = gr;
        for (let q = 0; q <= n; q++) ctx.fillRect(tx + w * 0.8 * (q / n) - pw / 2, ty, pw, h);
        ctx.globalAlpha = 0.22; ctx.fillRect(tx, ty, w, h); ctx.globalAlpha = 1;
        if (t === tiers.length - 1 && tall) { const cg = ctx.createRadialGradient(mid, ty, 0, mid, ty, w * 1.4); cg.addColorStop(0, css(spot, 0.45 * flood)); cg.addColorStop(1, css(spot, 0)); ctx.fillStyle = cg; ctx.fillRect(mid - w * 1.4, ty - w * 1.4, w * 2.8, w * 1.4); }
      });
    }
    x += bw * (0.84 + rand(kk + 8) * 0.24);
  }
  for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
  ctx.fillStyle = css(DK.amber); ctx.beginPath();
  for (const [x, y, s] of lights) { ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.6, y + s * 0.5); ctx.lineTo(x - s * 0.6, y + s * 0.5); ctx.closePath(); }
  ctx.fill();
  for (const [x, y] of reds) { ctx.fillStyle = css(DK.crimson, 0.3); ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); ctx.fillStyle = css([255, 120, 120]); ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill(); }
}
/**
 * The great tower: a ziggurat of setbacks rising to a needle with a red beacon. Each tier black, its side
 * a shade lighter; gold windows between pilasters floodlit from the ledge below; on every ledge a gold
 * sunburst lamp throwing its light up the next tier. (cx, base): the middle of its foot; H, W: its size.
 */
function dkTower(ctx, cx, base, H, W, lit, flood, spot, g, sky, k) {
  const TIERS = [[1, 0.34], [0.78, 0.2], [0.6, 0.14], [0.44, 0.1], [0.3, 0.07]], moon = dkMoonlight(g), body = mix(sky[1], [0, 0, 0], 0.72), side = mix(body, moon, 0.1), tiers = [];
  let y = base;
  for (const [wf, hf] of TIERS) { const w = W * wf, h = H * hf; tiers.push([cx - w / 2, y - h, w, h]); y -= h; }
  const top = y, wins = new Map(), add = (c, x, yy, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, yy, w, h); };
  tiers.forEach(([x, ty, w, h], i) => {
    ctx.fillStyle = css(body); ctx.fillRect(x, ty, w, h + 1);
    ctx.fillStyle = css(side); ctx.fillRect(x + w * 0.78, ty, w * 0.22, h + 1);
    ctx.fillStyle = css(moon, 0.45); ctx.fillRect(x + w - Math.max(1, w * 0.012), ty, Math.max(1, w * 0.012), h);   // the moon along its far edge
    const n = 5 + (i < 2 ? 2 : 0), bay = (w * 0.78) / n, ws = Math.max(1.2, bay * 0.24), wh = ws * 1.6;
    for (let q = 0; q < n; q++) for (let r = 0, yy = ty + h * 0.06; yy < ty + h - wh * 2; r++, yy += wh * 1.8) if (rand(k + i * 13.1 + q * 3.7 + Math.floor(r / 2) * 1.9) < lit) add(rand(k + i * 5.3 + q + r * 7.1) < 0.7 ? DK.amber : DK.pale, x + q * bay + bay * 0.5 - ws / 2, yy, ws, wh);
    if (flood > 0) {   // floodlit from this tier's foot: a wash up the face, and the pilasters bright
      const wash = ctx.createLinearGradient(0, ty + h, 0, ty + h * 0.2); wash.addColorStop(0, css(spot, 0.42 * flood)); wash.addColorStop(1, css(spot, 0));
      ctx.fillStyle = wash; ctx.fillRect(x, ty, w * 0.78, h);
      const gr = ctx.createLinearGradient(0, ty + h, 0, ty + h - h * (0.5 + 0.5 * flood)); gr.addColorStop(0, css(mix(spot, [255, 255, 255], 0.45), Math.min(1, 0.3 + flood * 1.2))); gr.addColorStop(0.3, css(spot, Math.min(1, flood * 1.3))); gr.addColorStop(1, css(spot, 0));
      ctx.fillStyle = gr; for (let q = 0; q <= n; q++) ctx.fillRect(x + q * bay - Math.max(0.8, bay * 0.07), ty, Math.max(1.6, bay * 0.14), h);
    }
  });
  for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
  // the crown and the needle
  ctx.fillStyle = css(body); shapeOf(ctx, [[cx - W * 0.1, top + 1], [cx - W * 0.1, top - H * 0.04], [cx - W * 0.03, top - H * 0.07], [cx, top - (base - top) * 0.32 - H * 0.05], [cx + W * 0.03, top - H * 0.07], [cx + W * 0.1, top - H * 0.04], [cx + W * 0.1, top + 1]]); ctx.fill();
  const tipY = top - (base - top) * 0.32 - H * 0.05, bg = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, W * 0.12);
  bg.addColorStop(0, css(DK.crimson, 0.7)); bg.addColorStop(1, css(DK.crimson, 0)); ctx.fillStyle = bg; ctx.fillRect(cx - W * 0.12, tipY - W * 0.12, W * 0.24, W * 0.24);
  ctx.fillStyle = css([255, 150, 150]); ctx.beginPath(); ctx.arc(cx, tipY, Math.max(1.5, W * 0.012), 0, TAU); ctx.fill();
  // a sunburst lamp on every ledge, its light thrown up the tier above
  for (let i = 1; i < tiers.length; i++) {
    const [x, ty, w, h] = tiers[i], ly = ty + h, R = Math.min(W * 0.13, tiers[i - 1][3] * 0.5) * (1 - i * 0.1);
    for (const lx of [x + w * 0.39, ...(i < 3 ? [x - (tiers[i - 1][2] - w) * 0.25, x + w + (tiers[i - 1][2] - w) * 0.25] : [])]) {
      const up = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 2.6); up.addColorStop(0, css(DK.amber, 0.55)); up.addColorStop(0.5, css(DK.gold, 0.14)); up.addColorStop(1, css(DK.gold, 0));
      ctx.fillStyle = up; ctx.beginPath(); ctx.arc(lx, ly, R * 2.6, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = css(DK.pale, 0.9); ctx.lineWidth = Math.max(0.8, R * 0.05); ctx.beginPath();
      for (let q = 0; q <= 8; q++) { const a = Math.PI + (q / 8) * Math.PI; ctx.moveTo(lx + Math.cos(a) * R * 0.18, ly + Math.sin(a) * R * 0.18); ctx.lineTo(lx + Math.cos(a) * R, ly + Math.sin(a) * R); }
      ctx.stroke();
      ctx.fillStyle = css([255, 248, 226]); ctx.beginPath(); ctx.arc(lx, ly, R * 0.16, Math.PI, TAU); ctx.fill();
    }
  }
}
/**
 * An airship: a cigar of a hull lit by the moon from above and by the city's glow from below, dark between,
 * its ribs showing; fins at its tail, a gondola with lit windows and a red light at its nose; it sweeps a
 * searchlight down ahead of it. (x, y): its middle; s: its length; it faces left.
 */
function dkAirship(ctx, x, y, s, g, sky, spot, a) {
  const rx = s / 2, ry = s * 0.13, lt = dkMoonlight(g), dark = mix(sky[1], [0, 0, 0], 0.55);
  ctx.save(); ctx.globalAlpha = a;
  const bc = mix([168, 168, 255], [255, 236, 204], g), gx = x - rx * 0.15, gy = y + ry * 1.3, bm = ctx.createLinearGradient(gx, gy, gx - s * 0.3, gy + s * 1.1);
  bm.addColorStop(0, css(bc, 0.35)); bm.addColorStop(1, css(bc, 0));
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = bm; shapeOf(ctx, [[gx + 2, gy], [gx - s * 0.62, gy + s * 1.1], [gx - s * 0.05, gy + s * 1.25], [gx - 2, gy]]); ctx.fill(); ctx.restore();
  ctx.fillStyle = css(dark);   // the fins, at the tail (right)
  for (const sy of [-1, 1]) { shapeOf(ctx, [[x + rx * 0.55, y + sy * ry * 0.3], [x + rx * 0.98, y + sy * ry * 1.7], [x + rx * 1.06, y + sy * ry * 1.6], [x + rx * 0.98, y + sy * ry * 0.1]]); ctx.fill(); }
  const hull = () => { ctx.beginPath(); ctx.moveTo(x - rx, y); ctx.bezierCurveTo(x - rx, y - ry * 1.35, x + rx * 0.35, y - ry * 1.2, x + rx, y - ry * 0.15); ctx.lineTo(x + rx, y + ry * 0.15); ctx.bezierCurveTo(x + rx * 0.35, y + ry * 1.2, x - rx, y + ry * 1.35, x - rx, y); ctx.closePath(); };
  const gr = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  gr.addColorStop(0, css(mix(lt, [255, 255, 255], 0.3))); gr.addColorStop(0.22, css(mix(lt, sky[2], 0.45))); gr.addColorStop(0.55, css(dark)); gr.addColorStop(0.85, css(dark)); gr.addColorStop(1, css(mix(dark, spot, 0.45)));
  ctx.fillStyle = gr; hull(); ctx.fill();
  ctx.save(); hull(); ctx.clip();
  ctx.strokeStyle = css(DK.ink, 0.45); ctx.lineWidth = Math.max(0.6, s * 0.004); ctx.beginPath();
  for (let i = 1; i < 10; i++) { const px = x - rx + (s * i) / 10; ctx.moveTo(px, y - ry * 1.3); ctx.quadraticCurveTo(px - s * 0.025, y, px, y + ry * 1.3); }
  ctx.moveTo(x - rx, y + ry * 0.1); ctx.lineTo(x + rx, y + ry * 0.1);
  ctx.stroke(); ctx.restore();
  ctx.fillStyle = css(dark); ctx.beginPath(); rounded(ctx, gx - s * 0.08, y + ry * 0.92, s * 0.16, ry * 0.42, ry * 0.18); ctx.fill();
  ctx.fillStyle = css(DK.amber); for (let i = 0; i < 6; i++) ctx.fillRect(gx - s * 0.065 + i * s * 0.022, y + ry * 1.02, s * 0.011, ry * 0.18);
  ctx.fillStyle = css([255, 110, 110]); ctx.beginPath(); ctx.arc(x - rx * 0.99, y, Math.max(1.2, s * 0.008), 0, TAU); ctx.fill();
  ctx.restore();
}
/** A blade sign standing off a wall: a black slab under a stepped crown, framed in neon tube, its letters stacked down it in neon. (x, y): the middle of its top; bw: its width. */
function dkSign(ctx, x, y, bw, word, spot, a) {
  const chars = [...word].filter((c) => c.trim()).slice(0, 8), n = Math.max(1, chars.length), fs = bw * 0.62, step = fs * 1.02, bh = n * step + bw * 0.42, lw = Math.max(1, bw * 0.035), hot = mix(spot, [255, 255, 255], 0.55);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(DK.ink); ctx.fillRect(x + bw * 0.5, y + bw * 0.4, bw * 0.4, bw * 0.08); ctx.fillRect(x + bw * 0.5, y + bh - bw * 0.5, bw * 0.4, bw * 0.08);   // the brackets to the wall
  shapeOf(ctx, [[x - bw / 2, y + bh], [x - bw / 2, y], [x - bw * 0.3, y], [x - bw * 0.3, y - bw * 0.16], [x - bw * 0.12, y - bw * 0.16], [x - bw * 0.12, y - bw * 0.32], [x + bw * 0.12, y - bw * 0.32], [x + bw * 0.12, y - bw * 0.16], [x + bw * 0.3, y - bw * 0.16], [x + bw * 0.3, y], [x + bw / 2, y], [x + bw / 2, y + bh]]); ctx.fill();
  ctx.beginPath(); ctx.rect(x - bw / 2 + lw * 2.5, y + lw * 2.5, bw - lw * 5, bh - lw * 5); neonTube(ctx, spot, lw);
  ctx.beginPath(); ctx.moveTo(x - bw * 0.1, y - bw * 0.2); ctx.lineTo(x + bw * 0.1, y - bw * 0.2); neonTube(ctx, DK.amber, lw * 0.8);
  ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  chars.forEach((c, i) => {
    const cy = y + bw * 0.22 + step * (i + 0.5);
    for (const [k, al] of [[0.3, 0.12], [0.14, 0.35]]) { ctx.strokeStyle = css(spot, al); ctx.lineWidth = fs * k; ctx.strokeText(c, x, cy); }
    ctx.fillStyle = css(hot); ctx.fillText(c, x, cy);
  });
  ctx.restore();
}
/** Rain: fine slanted streaks over the field, a few longer and brighter where they catch the light; `a` (0–1) sets how many and how heavy. */
function dkRain(ctx, F, a, g, k0) {
  if (a <= 0) return;
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), n = Math.round(60 + 900 * a), dx = 0.18, col = mix([200, 204, 255], [255, 236, 210], g);
  ctx.save(); ctx.lineCap = "round";
  for (const [al, lw, from, to] of [[0.16, 1, 0, 0.75], [0.3, 1.4, 0.75, 0.95], [0.55, 1.8, 0.95, 1]]) {
    ctx.strokeStyle = css(col, al * Math.min(1, 0.4 + a)); ctx.lineWidth = Math.max(0.6, lw * u * 0.0011); ctx.beginPath();
    for (let i = Math.floor(n * from); i < Math.floor(n * to); i++) {
      const x = F.x0 + (fw + fh * dx) * rand(k0 + i * 1.31) - fh * dx, y = F.y0 + fh * rand(k0 + i * 2.17), l = u * (0.02 + 0.06 * rand(k0 + i * 3.7)) * (1 + (i / n) * 0.6);
      ctx.moveTo(x, y); ctx.lineTo(x + l * dx, y + l);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/**
 * The proscenium: the field framed as a deco arch — a black mass round an opening whose corners step in,
 * two gold rules along its edge, a sunburst keystone at its head. The side the colour block is on stays
 * open. `amt` (0–1) thickens it.
 */
function dkArch(ctx, F, amt, gold, u) {
  if (amt <= 0) return;
  const side = F.side, open = { left: side === "left", right: side === "right", top: side === "above", bottom: side === "below" };
  const m = u * (0.012 + 0.045 * amt), mt = Math.min(m, 44), s = u * (0.012 + 0.012 * amt), n = 3;
  const path = (d) => {
    const X0 = open.left ? F.x0 - 4 : F.x0 + m + d, X1 = open.right ? F.x1 + 4 : F.x1 - m - d, Y0 = open.top ? F.y0 - 4 : F.y0 + mt + d, Y1 = open.bottom ? F.y1 + 4 : F.y1 - m - d, pts = [];
    const corner = (cx, cy, ix, iy, vfirst, on) => {
      if (!on) { pts.push([cx, cy]); return; }
      const seq = [[cx, cy + iy * n * s]];
      for (let j = 1; j <= n; j++) seq.push([cx + ix * j * s, cy + iy * (n - j + 1) * s], [cx + ix * j * s, cy + iy * (n - j) * s]);
      pts.push(...(vfirst ? seq : seq.reverse()));
    };
    corner(X0, Y0, 1, 1, true, !open.left && !open.top);
    corner(X1, Y0, -1, 1, false, !open.right && !open.top);
    corner(X1, Y1, -1, -1, true, !open.right && !open.bottom);
    corner(X0, Y1, 1, -1, false, !open.left && !open.bottom);
    return pts;
  };
  ctx.save();
  ctx.fillStyle = css(DK.ink, Math.min(1, amt * 2.5) * 0.94); ctx.beginPath(); ctx.rect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
  path(0).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill("evenodd");
  ctx.lineJoin = "miter"; ctx.strokeStyle = css(gold, Math.min(1, amt * 3));
  for (const [d, lw] of [[-u * 0.004, Math.max(1.5, u * 0.0035)], [u * 0.009, Math.max(1, u * 0.0018)]]) { shapeOf(ctx, path(d)); ctx.lineWidth = lw; ctx.stroke(); }
  if (!open.top) {   // the keystone: a half sunburst hanging from the head of the arch
    const kx = (F.x0 + F.x1) / 2, ky = F.y0 + mt - u * 0.004, R = Math.min(mt * 1.1, u * (0.02 + 0.025 * amt));
    ctx.fillStyle = css(DK.ink); ctx.beginPath(); ctx.arc(kx, ky, R, 0, Math.PI); ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.0025); ctx.beginPath(); ctx.arc(kx, ky, R, 0, Math.PI);
    for (let q = 0; q <= 10; q++) { const a = (q / 10) * Math.PI; ctx.moveTo(kx + Math.cos(a) * R * 0.25, ky + Math.sin(a) * R * 0.25); ctx.lineTo(kx + Math.cos(a) * R * 0.92, ky + Math.sin(a) * R * 0.92); }
    ctx.stroke();
  }
  ctx.restore();
}
/** For each lightness, the night's tone: the shadows crushed toward black, as on a painting done on black paper. */
const DK_CURVE = (() => {
  const out = new Uint8Array(256);
  for (let l = 0; l < 256; l++) {
    const t = clamp((l / 255 - 0.06) / 0.9), sc = t * t * (3 - 2 * t), v = 0.45 * t ** 1.5 + 0.55 * sc;
    let q = 0; for (let j = 1; j < 6; j++) { const e = clamp((v - j / 6 + 0.04) / 0.08); q += (e * e * (3 - 2 * e)) / 5; }   // six flat tones, their edges soft
    out[l] = Math.round(255 * (0.55 * q + 0.45 * v));
  }
  return out;
})();
/** The ramp a photo is painted into, by lightness: black, the deep night, ultramarine, violet, moonlight, cream (gilt: black, umber, bronze, gold, cream). */
const dkRamp = (g) => toneTable([[0, mix([2, 2, 8], [3, 2, 1], g)], [0.26, mix([10, 9, 44], [24, 15, 7], g)], [0.5, mix([34, 30, 136], [90, 56, 20], g)], [0.7, mix([96, 78, 208], [176, 116, 44], g)], [0.88, mix([190, 184, 255], [244, 200, 124], g)], [1, DK.cream]]);
/**
 * RGBA pixels painted as Gotham's night, mixed in by a: the lightness crushed and mapped onto the night's
 * ramp, while strong warm colours keep their warmth — reds turn crimson, oranges and yellows gold, as the
 * paintings keep their red planes and lit windows in a blue night. Alpha kept. With `byValue` the ramp is
 * read by the brightest channel instead, uncrushed: a picture already in the night's blues then stays
 * much as it is (a photo layer the look has graded, given the effect as well).
 */
function dkPixels(d, a, g, byValue = false) {
  const lut = dkRamp(g);
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2], l = byValue ? (r > gg ? (r > b ? r : b) : gg > b ? gg : b) : DK_CURVE[(r * 54 + gg * 183 + b * 19) >> 8], j = l * 3;
    let R = lut[j], G = lut[j + 1], B = lut[j + 2];
    const mx = r > gg ? (r > b ? r : b) : gg > b ? gg : b, mn = r < gg ? (r < b ? r : b) : gg < b ? gg : b, s = mx ? (mx - mn) / mx : 0;
    const wv = r > b ? clamp(((r - b) / (mx + 1)) * 1.6) * clamp(s * 2 - 0.25) * clamp(mx / 90) : 0;
    if (wv > 0) {
      const y = clamp((gg - b) / (r - b + 1)), k = 0.35 + (l / 255) * 1.1;
      R += (Math.min(255, (DK.crimson[0] + (DK.amber[0] - DK.crimson[0]) * y) * k) - R) * wv;
      G += (Math.min(255, (DK.crimson[1] + (DK.amber[1] - DK.crimson[1]) * y) * k) - G) * wv;
      B += (Math.min(255, (DK.crimson[2] + (DK.amber[2] - DK.crimson[2]) * y) * k) - B) * wv;
    }
    d[i] = r + (R - r) * a; d[i + 1] = gg + (G - gg) * a; d[i + 2] = b + (B - b) * a;
  }
}
/**
 * Halation: the lights bleed into the dark around them, as on film. A soft copy of the picture with only
 * its brightest parts kept (multiplied by itself twice) is laid on in screen. Left out while dragging.
 */
function dkBloom(ctx, amt) {
  if (amt <= 0 || fast || !canPaint(ctx)) return;
  const cv = ctx.canvas, soft = softCopy(cv, 10, "dkBloom"), x = soft.getContext("2d");
  x.globalCompositeOperation = "multiply"; x.drawImage(soft, 0, 0); x.drawImage(soft, 0, 0);
  inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = Math.min(1, amt * 1.4); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
}
/** The silhouette of the channel graphic, standing black against a pool of the floodlight behind it, with rims of light: the floodlight on one side, the moon on the other. */
function dkFigure(ctx, S, cx, cy, size, spot, g, a) {
  const d = size * 0.016, R = size * 0.95, gl = ctx.createRadialGradient(cx, cy - size * 0.15, 0, cx, cy - size * 0.15, R);
  gl.addColorStop(0, css(mix(spot, [255, 255, 255], 0.3), 0.75 * a)); gl.addColorStop(0.45, css(spot, 0.32 * a)); gl.addColorStop(1, css(spot, 0));
  ctx.save(); ctx.fillStyle = gl; ctx.fillRect(cx - R, cy - size * 0.15 - R, R * 2, R * 2); ctx.globalAlpha = a;
  placeShape(ctx, S, mix(spot, [255, 255, 255], 0.2), cx - d, cy - d * 0.4, size);
  placeShape(ctx, S, dkMoonlight(g), cx + d * 0.8, cy - d, size);
  placeShape(ctx, S, DK.ink, cx, cy, size);
  ctx.restore();
}
/**
 * The context the small cover parts draw on under this look — the brand row and the channel name, set by
 * the house's own code: upright, as everything deco is (a slant taken out of the lettering, a slanted
 * plate squared), and the channel's colour, wherever they use it, turned to its light: the glass of the
 * highlighted words. The channel name, which the house sets in its heaviest face with a black outline,
 * is set in the title's capitals instead, glass lit from within and glowing on the black base.
 */
function dkSmall(ctx, C) {
  const G = dkGlass(C), near = (c) => Math.abs(c[0] - C[0]) < 1.5 && Math.abs(c[1] - C[1]) < 1.5 && Math.abs(c[2] - C[2]) < 1.5;
  const lit = (v) => { const c = parseColour(v); return c && near(c) ? css(G.body, c[3]) : v; };
  let name = false, pts = [];
  /** A path of four points that is a slanted plate (top and foot level, both sides leaning alike) made upright, on the same middle. */
  const squared = (t) => {
    if (pts.length !== 4) return;
    const [a, b, c, d] = pts, lean = d[0] - a[0];
    if (Math.abs(a[1] - b[1]) > 0.01 || Math.abs(c[1] - d[1]) > 0.01 || Math.abs(c[0] - b[0] - lean) > 0.01 || Math.abs(lean) < 0.01) return;
    t.beginPath(); t.rect(a[0] + lean / 2, a[1], b[0] - a[0], d[1] - a[1]);
  };
  /** One glyph of the channel name: glass, pale at the top and its colour at the foot, glowing. */
  const glyph = (t, s, x, y) => {
    const c = parseColour(t.fillStyle) || [255, 255, 255, 1], own = !near(c) && !(Math.abs(c[0] - G.body[0]) < 1.5 && Math.abs(c[1] - G.body[1]) < 1.5 && Math.abs(c[2] - G.body[2]) < 1.5);
    const L = own ? { body: c, core: mix(c, [255, 255, 255], 0.55), glow: c } : G, fs = parseFloat((/([\d.]+)px/.exec(t.font) || [])[1]) || 60, m = t.getTransform();
    t.save();
    if (!fast) { t.shadowColor = css(L.glow, 0.75); t.shadowBlur = fs * 0.28 * Math.hypot(m.a, m.b); }
    const gr = t.createLinearGradient(0, y - fs * 0.74, 0, y); gr.addColorStop(0, css(L.core)); gr.addColorStop(0.5, css(mix(L.core, L.body, 0.55))); gr.addColorStop(1, css(L.body));
    t.fillStyle = gr; t.fillText(s, x, y);
    t.restore();
  };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "transform") return (a, b, c, d, e, f) => { if (!(a === 1 && b === 0 && d === 1 && !e && !f)) t.transform(a, b, c, d, e, f); };   // a slant: left out
      if (k === "beginPath") return () => { pts = []; t.beginPath(); };
      if (k === "moveTo" || k === "lineTo") return (x, y) => { pts.push([x, y]); t[k](x, y); };
      if (k === "fill" || k === "stroke") return (...a) => { squared(t); t[k](...a); };
      if (name && k === "strokeText") return () => {};   // the house's black outline round the name, and its thickening: not here
      if (name && k === "fillText") return (s, x, y) => glyph(t, s, x, y);
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === "font") { name = typeof v === "string" && /^900 [\d.]+px /.test(v) && v.endsWith(`px ${fonts.cn}`); t.font = name ? v.replace(/px .*$/, `px ${fonts.en}, ${fonts.cn}`) : v; }
      else if (k === "fillStyle" || k === "strokeStyle") t[k] = lit(v);
      else t[k] = v;
      return true;
    },
  });
}
/** How far the deco capitals are set apart: a share of each glyph's own width. */
const DK_TRACK = 0.09;
/** [r, g, b] -> [hue (0–360), saturation, lightness]. */
function dkHsl(c) {
  const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, hi = Math.max(r, g, b), lo = Math.min(r, g, b), l = (hi + lo) / 2, d = hi - lo;
  if (d < 0.02) return [0, 0, l];
  return [((hi === r ? ((g - b) / d) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360, l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo), l];
}
function dkRgb(h, s, l) {
  const q = (1 - Math.abs(2 * l - 1)) * s, x = q * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - q / 2;
  const [R, G, B] = h < 60 ? [q, x, 0] : h < 120 ? [x, q, 0] : h < 180 ? [0, q, x] : h < 240 ? [0, x, q] : h < 300 ? [x, 0, q] : [q, 0, x];
  return [(R + m) * 255, (G + m) * 255, (B + m) * 255];
}
/**
 * The channel colour as lit glass in the night: { body, deep, core, glow }. The hue kept (a green
 * drawn a little toward jade, so it sits with the ultramarine), the colour made luminous — a dark one
 * lifted until it reads as light — the core nearly white, the glow fully saturated. A grey gives moonlight.
 */
function dkGlass(C) {
  let [h, s0] = dkHsl(C);
  if (h > 90 && h < 170) h += (168 - h) * 0.35;
  const s = s0 < 0.12 ? 0.12 : 0.95;
  let L = 0.52;
  while (L < 0.8 && lum(dkRgb(h, s, L)) < 0.36) L += 0.02;
  return { body: dkRgb(h, s, L), deep: dkRgb(h, s, L * 0.78), core: dkRgb(h, s, 0.86), glow: dkRgb(h, 1, Math.min(0.62, L + 0.04)) };
}
/**
 * The light of the deco letters: a marquee's lamps, tungsten — a core near white, warmer toward the
 * foot, an amber rim where the light meets the letter's edge, a deeper line at the very edge, the glow
 * thrown round them. At gilt g, gold light.
 */
const dkLamp = (g) => ({
  core: mix([255, 253, 246], [255, 246, 214], g), foot: mix([255, 236, 198], [255, 220, 150], g),
  rim: mix([255, 190, 108], [238, 160, 52], g), deep: mix([186, 106, 40], [160, 96, 20], g), glow: mix([255, 206, 132], [255, 184, 70], g),
});
/** The face of a lamp-lit letter `fs` high, top to foot. */
function dkFace(ctx, fs, g) {
  const L = dkLamp(g), gr = ctx.createLinearGradient(0, -fs * 0.8, 0, fs * 0.06);
  gr.addColorStop(0, css(L.core)); gr.addColorStop(0.55, css(L.core)); gr.addColorStop(1, css(L.foot));
  return gr;
}
/** Where a line of lettering `fs` high and `right` long lies on ctx's canvas, in whole pixels, with a little room round it: { x0, y0, w, h, k (pixels per unit) }, or null when it is off the canvas. */
function dkBox(ctx, fs, right) {
  const m = ctx.getTransform(), pts = [[-fs * 0.12, -fs * 1.02], [right + fs * 0.12, -fs * 1.02], [-fs * 0.12, fs * 0.28], [right + fs * 0.12, fs * 0.28]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0])))), y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1]))));
  const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...pts.map((q) => q[0])))), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...pts.map((q) => q[1]))));
  return x1 - x0 > 2 && y1 - y0 > 2 ? { x0, y0, w: x1 - x0, h: y1 - y0, k: Math.hypot(m.a, m.b) } : null;
}
/** A work canvas the size of box B (see dkBox), cleared, drawing with ctx's transform and font, so lettering painted on it lands where it would on ctx. One per `slot`. */
function dkWork(ctx, slot, B) {
  const c = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (c.width !== B.w || c.height !== B.h) { c.width = B.w; c.height = B.h; }
  const x = c.getContext("2d"), m = ctx.getTransform();
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.shadowColor = "rgba(0,0,0,0)"; x.shadowBlur = x.shadowOffsetX = x.shadowOffsetY = 0; x.clearRect(0, 0, B.w, B.h);
  x.setTransform(m.a, m.b, m.c, m.d, m.e - B.x0, m.f - B.y0);
  x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;
  return x;
}
const deco = {
  id: "deco",
  art: "figure",
  repaint: (c) => `an Art Deco night scene painted on black paper, in the style of the background paintings of 1990s animated noir: an ultramarine and violet night, stepped skyscrapers with setbacks and spires, lit gold windows, crossing searchlight beams, lavender fog, deep crimson and ${c} floodlight on the facades, crushed black shadows, airbrushed gradients, film grain; still the same place, no text.`,
  about: { zh: "暗黑装饰：九十年代动画里哥谭市那种画在黑卡纸上的装饰艺术夜景——黑是底，只把光画上去：群青色的夜空，层层退台的摩天楼亮着金色窗灯、立柱被从退台下打上来的泛光照亮，探照灯在天上交叉，云条横过月亮，楼与楼之间浮着淡紫的夜雾；可加飞艇、竖排霓虹招牌、阶梯拱框和剪影人物。泛光、色块和高亮字用频道色（原画里的深红）；标题像剧院门脸上亮着的招牌字：字距拉开的大写字，每个字是一盏灯——中间钨丝白、边上透出琥珀色，外面一圈暖光，细细的暗边；高亮字是频道色的霓虹灯管。「鎏金」拉满变成黑金夜色。神秘、华丽、带点黑色电影的悬疑——适合城市、夜生活、悬疑推理、历史人文、电影解读、音乐与奢华品类。照片会被画成群青夜色，暖色保留为深红和金色。只有夜色底；自带平直的版式。", en: "Dark deco: the Art Deco city by night as the 90s animated series painted Gotham, on black paper — the dark is the ground and only the light is laid on: an ultramarine night, stepped skyscrapers with gold-lit windows and pilasters floodlit from their setbacks, searchlights crossing, bars of cloud across the moon, lavender fog between the rows; an airship, a neon blade sign, a stepped proscenium and a silhouette if you like. The floodlight, the colour block and the highlighted words take the channel colour (the paintings' crimson); the title is set as the lit letters of a theatre front, spaced capitals each a lamp — tungsten white at heart, amber at the rim, a warm glow round it, a fine dark keyline — the highlighted words neon tubes in the channel's colour. Turn up Gilt for black and gold. Mysterious, opulent, a little film noir — for cities, nightlife, mysteries, history, film, music and luxury. A photo is painted into the ultramarine night, its warm colours kept as crimson and gold. Night ground only; flat layouts of its own." },
  name: { zh: "暗黑装饰", en: "Dark deco" },
  oneTheme: true,
  seeded: true,
  scene: { tower: { zh: "主楼", en: "The great tower" }, moon: { zh: "月亮", en: "Moon" }, beams: { zh: "探照灯", en: "Searchlights" }, airship: { zh: "飞艇", en: "Airship" }, sign: { zh: "霓虹竖招牌", en: "Blade sign" }, figure: { zh: "剪影人物", en: "Silhouette" } },
  params: [
    { key: "tower", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "主楼", en: "The great tower" } },
    { key: "skyline", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "楼群", en: "Skyline" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "窗灯", en: "Lit windows" } },
    { key: "flood", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "泛光", en: "Floodlight" } },
    { key: "beams", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "探照灯", en: "Searchlights" } },
    { key: "moon", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "月亮与星", en: "Moon and stars" } },
    { key: "fog", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "夜雾", en: "Fog" } },
    { key: "red", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "赤红天幕", en: "Crimson sky" } },
    { key: "rain", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "夜雨", en: "Rain" } },
    { key: "airship", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "飞艇", en: "Airship" } },
    { key: "sign", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "霓虹竖招牌", en: "Blade sign" } },
    { key: "word", text: true, max: 8, def: "", name: { zh: "招牌字", en: "The sign's letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "arch", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "阶梯拱框", en: "Stepped proscenium" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "剪影人物", en: "Silhouette" } },
    { key: "gilt", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "鎏金", en: "Gilt" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "光晕", en: "Halation" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片夜色化", en: "Photo as night" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  // the channel name on the black base is set as on the field, in the channel colour
  layout: (template, w, h) => { const G = blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }); return { ...G, cat: { ...G.cat, onAccent: false } }; },
  theme: (base, C, p) => ({ ...base, field: css(dkSky((p && p.gilt) || 0, (p && p.red) || 0)[1]), text: css(DK.cream), own: css(DK.cream), dim: css(DK.cream, 0.6), titleFill: css(DK.cream), titleInk: css(DK.ink), grid: () => css(DK.gold, 0.15) }),
  /**
   * The night, its stars, the moon, the searchlights, the far and middle rows of the city with fog
   * between (painted once and kept until one of their sliders or objects changes); then the great tower,
   * fog at its foot, the near row, the sign, the airship, the silhouette, the proscenium. A photo is
   * painted into the night; filling the canvas, it gets the searchlights and the proscenium too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), g = p.gilt, sky = dkSky(g, p.red), spot = dkSpot(C), gold = mix(DK.gold, DK.pale, 0.2);
    const base = F.y1, beamAt = [F.x0 + fw * 0.55, base - fh * 0.06], fog = dkFog(g, p.red);
    if (env.photo) {
      env.drawPhoto(0, p.photo > 0 ? { key: `dk|${p.photo}|${g}`, fn: (d) => dkPixels(d, p.photo, g) } : null);   // the photo itself painted into the night (see drawPhotoAt)
      if (L.fill) {   // night falls from the top, the searchlights and the rain over it, in the proscenium
        const dk = ctx.createLinearGradient(0, 0, 0, h * 0.7); dk.addColorStop(0, css(sky[0], 0.75 * p.photo)); dk.addColorStop(1, css(sky[0], 0));
        ctx.fillStyle = dk; ctx.fillRect(0, 0, w, h * 0.7);
        if (p.red > 0) { ctx.save(); ctx.globalCompositeOperation = "color"; ctx.fillStyle = css(sky[2], 0.55 * p.red); ctx.fillRect(0, 0, w, h); ctx.restore(); }
        dkBeams(ctx, F, F.x0 + fw * 0.55, base, p.beams * 5, g, 3320);
        dkRain(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.rain, g, 3390);
        dkArch(ctx, F, p.arch, gold, u);
      }
      return true;
    }
    const mid = base - fh * (0.16 + 0.44 * p.skyline), far = base - fh * (0.22 + 0.52 * p.skyline);
    // the great tower stands beside the title when there is room, the moon beside the tower
    const T = canPaint(ctx) ? titleArea(ctx, env) : null, TW = u * (0.14 + 0.1 * p.tower), right = T ? T.x + T.w + TW * 0.7 : 0;
    const tx = Math.min(F.x1 - TW * 0.55, right < F.x1 - TW * 0.6 ? Math.max(F.x0 + fw * 0.7, right) : F.x0 + fw * 0.76), moonR = u * (0.045 + 0.075 * p.moon);
    let mx0 = Math.min(F.x1 - moonR * 1.25, tx + TW * 0.62 + moonR * 1.1);
    if (p.tower > 0 && Math.abs(mx0 - tx) < moonR + TW * 0.12) mx0 = tx - TW * 0.62 - moonR * 1.1;
    const [mx, my] = p.moon > 0 && L.grid ? objAt("moon", mx0, F.y0 + fh * 0.22, ctx) : [0, 0];   // scene objects
    const [bx, by] = p.beams > 0 && L.grid ? objAt("beams", beamAt[0], beamAt[1], ctx) : beamAt;
    if (L.ground !== false) {   // the night down to the city's foot, and the black below it: the ground
      const gr = ctx.createLinearGradient(0, F.y0, 0, base); gr.addColorStop(0, css(sky[0])); gr.addColorStop(0.45, css(sky[1])); gr.addColorStop(0.8, css(sky[2])); gr.addColorStop(1, css(mix(sky[3], spot, 0.12)));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = css(DK.ink); ctx.fillRect(0, base, w, h - base);
    }
    if (!L.grid) return true;
    if (p.moon > 0) { dkStars(ctx, F, mid, p.moon * 150, g, 3300); dkMoon(ctx, mx, my, moonR, g, sky, 3310); }
    if (p.beams > 0) dkBeams(ctx, F, bx, by, p.beams * 5, g, 3320);   // added to what is there: painted each time, as a kept layer on its own could not add them to it
    const paintBack = (x) => {   // the far and middle rows of the city with their fog: kept on a layer of their own
      dkRow(x, F, far, base, { w: [0.026, 0.03], h: [0.45, 0.55], body: mix(sky[3], sky[1], 0.5), rim: dkMoonlight(g), pin: true, litK: 0.5, tiers: true }, p.lights, 0, spot, g, 3330);
      dkFogBand(x, F.x0, F.x1, base - (base - far) * 0.32, fh * 0.12, fog, 0.8 * p.fog, 3340);
      dkRow(x, F, mid, base, { w: [0.045, 0.05], h: [0.3, 0.55], tall: 0.14, body: mix(sky[1], [0, 0, 0], 0.45 + 0.35 * p.red), rim: mix(dkMoonlight(g), spot, 0.3), litK: 0.9, tiers: true, flood: true }, p.lights, p.flood, spot, g, 3350);
      dkFogBand(x, F.x0, F.x1, base, fh * 0.1, mix(fog, spot, 0.2), 0.7 * p.fog, 3345);   // the city's foot glowing in the fog
    };
    if (p.skyline > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "dkBack", [seed, w, h, F.x0, F.y0, F.x1, F.y1, g, p.red, p.skyline, p.lights, p.flood, p.fog, C.join()].join("|"), paintBack);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintBack(ctx);
    }
    if (p.tower > 0) {   // a scene object, its handle half way up
      const TH = fh * (0.5 + 0.38 * p.tower), [cx, cy] = objAt("tower", tx, base - TH * 0.45, ctx);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.tower * 4);
      dkTower(ctx, cx, cy + TH * 0.45, TH, TW, Math.max(0.15, p.lights), p.flood, spot, g, sky, 3360);
      ctx.restore();
    }
    dkFogBand(ctx, F.x0, F.x1, base - fh * 0.04, fh * 0.07, fog, 0.55 * p.fog, 3370);
    if (p.skyline > 0) dkRow(ctx, F, base - fh * (0.06 + 0.16 * p.skyline), base, { w: [0.07, 0.07], h: [0.35, 0.65], body: DK.ink, rim: sky[2], litK: 0.3 }, p.lights, 0, spot, g, 3380);
    if (p.airship > 0) {   // a scene object: the first of a few places in the sky clear of the title
      const sz = u * (0.16 + 0.2 * p.airship), box = (x, y) => ({ x: x - sz * 0.55, y: y - sz * 0.2, w: sz * 1.1, h: sz * 0.4 }), keep = canPaint(ctx) ? [...keepClear(ctx, env), { x: 0, y: 0, w: Math.min(w, 900), h: 150 }] : [];   // and the brand row
      const at = [[0.62, 0.15], [0.5, 0.1], [0.3, 0.36], [0.72, 0.4], [0.38, 0.6]].map(([a, b]) => [F.x0 + fw * a, F.y0 + fh * b]).find(([x, y]) => !keep.some((k) => overlaps(k, box(x, y)))) || [F.x0 + fw * 0.62, F.y0 + fh * 0.15];
      const [ax, ay] = objAt("airship", at[0], at[1], ctx); dkAirship(ctx, ax, ay, sz, g, sky, spot, Math.min(1, p.airship * 4));
    }
    if (p.sign > 0) {   // a scene object: the blade sign at the field's edge, below the title when it would cross it
      const bw = u * (0.05 + 0.04 * p.sign), word = (p.word || env.cat.code || env.cat.name || "DECO").toUpperCase();
      let sx = F.x1 - bw * 1.2, sy = F.y0 + fh * 0.3;
      if (T && sx + bw > T.x && sx - bw < T.x + T.w && sy < T.y + T.h) sy = Math.min(base - fh * 0.3, T.y + T.h + bw * 0.5);
      [sx, sy] = objAt("sign", sx, sy, ctx);
      dkSign(ctx, sx, sy, bw, word, spot, Math.min(1, p.sign * 4));
    }
    if (p.figure > 0) {   // a scene object
      const S = canPaint(ctx) && graphicShape(env), size = Math.min(fh, fw * 0.7) * (0.22 + 0.36 * p.figure);
      if (S) { const [cx, cy] = objAt("figure", F.x0 + Math.max(fw * 0.12, size * 0.6), base - size * 0.42, ctx); dkFigure(ctx, S, cx, cy, size, spot, g, Math.min(1, p.figure * 4)); }
    }
    dkRain(ctx, F, p.rain, g, 3390);
    dkArch(ctx, F, p.arch, gold, u);
    return true;
  },
  /** Fine gold lines with deco nodes: pairs of pinstripes down every 160, single lines across, a diamond where they meet. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 160, xs = [], ys = every(s / 2, h, s);
    for (let x = s / 2; x < w; x += s) xs.push(x - 4, x + 4);
    gridPen(ctx, color); gridPath(ctx, xs, ys, 0, 0, w, h);
    ctx.beginPath(); for (let x = s / 2; x < w; x += s) for (const y of ys) { ctx.moveTo(x, y - 15); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 15); ctx.lineTo(x - 9, y); ctx.closePath(); } ctx.fill();
    ctx.restore();
  },
  accent: {
    fill: () => css(DK.base), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /**
     * The block as the black marble base the city stands on: a line of the floodlight along its edge, a
     * black rule, a gold one, a frieze of gold reeding, tall and short bars by turns, a gold hairline; under
     * it the floodlight's glow on the polished black, fading away from the edge.
     */
    edge(ctx, run, nx, ny, C) {
      const spot = dkSpot(C), at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      for (let i = 0; i < 8; i++) { ctx.strokeStyle = css(spot, 0.075 * (1 - i / 8)); ctx.lineWidth = 34; at(54 + i * 26); }
      // the city's lights in the polished black: streaks across the base, broken dashes stroked thick, fainter away from the edge
      for (let j = 0; j < 4; j++) {
        const dash = []; for (let q = 0; q < 24; q++) dash.push(2 + rand(3400 + j * 50 + q) * (j % 2 ? 6 : 3), 8 + rand(3401 + j * 50 + q * 1.7) ** 2 * 90);
        ctx.setLineDash(dash); ctx.lineDashOffset = rand(3402 + j) * 400; ctx.strokeStyle = css(j % 2 ? spot : DK.amber, 0.28 - j * 0.05); ctx.lineWidth = 46 - j * 8; at(62 + j * 34);
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = css(DK.ink); ctx.lineWidth = 12; at(3);
      ctx.strokeStyle = css(DK.gold); ctx.lineWidth = 3; at(11);
      ctx.setLineDash([3, 13]); ctx.lineWidth = 14; at(23); ctx.lineDashOffset = 8; ctx.lineWidth = 7; at(26.5); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.lineWidth = 1.5; at(35);
      for (const [lw, a] of [[18, 0.14], [7, 0.4], [3, 1]]) { ctx.strokeStyle = css(mix(spot, [255, 255, 255], 0.4), a); ctx.lineWidth = lw; at(-2); }
    },
  },
  /**
   * Deco capitals as the lit letters of a theatre front, set with air between them: each letter a
   * lamp — tungsten white at its heart, an amber rim where the light meets its edge — in a fine dark
   * keyline (the outline slider), throwing a warm glow round itself; a shade of the night stepped down
   * behind (the shadow slider), a soft dark round them so they stand off the sky and the searchlights.
   * The highlighted words are neon: glass in the channel's hue toned into the night, deep at the rim,
   * white-hot down the middle, throwing its colour round them.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, g = (p && p.gilt) || 0, s = Math.min(2, o.shadowAmt || 0), k = o.strokeAmt || 0;
    // a colour of the layer's own is kept: lit glass of it when it is light enough to be light, flat when it is dark (ink on a pale plate)
    const lit = (c) => lum(c) > 0.3, glass = o.hi ? (lit(o.hi) ? { body: o.hi, deep: mix(o.hi, DK.ink, 0.25), core: mix(o.hi, [255, 255, 255], 0.6), glow: o.hi } : { body: o.hi, deep: o.hi, core: o.hi, glow: null }) : dkGlass(o.C || DK.crimson);
    const bright = !o.fill || lit(o.fill);
    const lamp = !o.fill ? dkLamp(g) : bright ? { core: mix(o.fill, [255, 255, 255], 0.5), foot: mix(o.fill, [255, 255, 255], 0.3), rim: o.fill, deep: mix(o.fill, DK.ink, 0.3), glow: o.fill } : null;
    // the tracking: every glyph set apart by a share of its own width, the line drawn that much smaller so it keeps its measure;
    // each piece of the line where the line was set (Latin beside CJK larger, punctuation squeezed: see setLine in title.js)
    const chars = [], T = 1 + DK_TRACK;
    let cx = 0;
    pass((a, at) => { cx = at * T; for (const t of a.t) { const w = ctx.measureText(t).width; chars.push({ t, hi: a.hi, x: cx, s: a.s, dy: (a.dy || 0) * T }); cx += w * T; } });
    ctx.scale(1 / T, 1 / T);
    const each = (fn, only) => { for (const c of chars) if (only === undefined || c.hi === only) inPiece(c, () => fn(c, c.x)); };
    const face = lamp ? (o.fill ? css(lamp.core) : dkFace(ctx, fs, g)) : css(o.fill);
    if (!canPaint(ctx)) { each((c, x) => { ctx.fillStyle = c.hi ? css(glass.body) : face; ctx.fillText(c.t, x, 0); }); return; }   // nothing to work on: the letters plain
    ctx.lineJoin = "miter"; ctx.miterLimit = 2.5;
    const shade = mix(dkSky(g)[1], DK.ink, 0.55), B = fast ? null : dkBox(ctx, fs, cx);
    // the letters alone, white, on work canvases the size of the line: plain and highlighted apart
    const mask = (slot, hi) => { if (!B || !chars.some((c) => c.hi === hi)) return null; const M = dkWork(ctx, slot, B); M.fillStyle = "#fff"; each((c, x) => M.fillText(c.t, x, 0), hi); return M.canvas; };
    const Mp = mask("dkPlain", false), Mh = mask("dkHi", true);
    /** Only the soft shadow of mask m: `col`, r units across, dy units down (the mask itself is laid off the canvas, its shadow thrown back onto the line); `light`: screened, so it brightens. */
    const glowOf = (m, col, r, dy = 0, light = false) => { if (m) inPixels(ctx, () => { const D = B.x0 + B.w + 20; if (light) ctx.globalCompositeOperation = "screen"; ctx.shadowColor = col; ctx.shadowBlur = r * B.k; ctx.shadowOffsetX = D; ctx.shadowOffsetY = dy * B.k; ctx.drawImage(m, B.x0 - D, B.y0); }); };
    // a soft dark round the letters, the paper showing through, so they stand off whatever is behind
    for (const m of [Mp, Mh]) glowOf(m, css(DK.ink, 0.5), fs * 0.09, fs * 0.02);
    if (s > 0) {   // the shade: the letters' depth stepped down behind them, in the night's darkest blue
      const d = fs * 0.045 * s, k0 = Math.hypot(ctx.getTransform().a, ctx.getTransform().b), n = Math.max(2, Math.min(10, Math.round((d * k0) / 1.5)));
      ctx.fillStyle = css(shade);
      for (let i = n; i >= 1; i--) each((c, x) => ctx.fillText(c.t, x + (d * i) / n * 0.6, (d * i) / n));
    }
    // their light thrown round them, added to what is there rather than laid over it: the lamps' warm glow, the neon's own colour
    if (lamp) { glowOf(Mp, css(lamp.glow, 0.42), fs * 0.55, 0, true); glowOf(Mp, css(lamp.glow, 0.6), fs * 0.11, 0, true); }
    if (glass.glow) { glowOf(Mh, css(glass.glow, 0.42), fs * 0.42, 0, true); glowOf(Mh, css(glass.glow, 0.55), fs * 0.12, 0, true); }
    if (k > 0) { ctx.strokeStyle = css(mix(DK.ink, [52, 30, 12], 0.5)); ctx.lineWidth = fs * 0.04 * k; each((c, x) => ctx.strokeText(c.t, x, 0)); }   // the keyline: the dark edge of the sign
    if (!B) { each((c, x) => { ctx.fillStyle = c.hi ? css(glass.body) : face; ctx.fillText(c.t, x, 0); }); return; }
    /**
     * Letters lit from within: their face, and their colour glowing in from the rim — the shadow of all
     * that is not them, cast into them — each of `rims` [blur in type sizes, colour, alpha], the last
     * the tightest, at the very edge.
     */
    const litUp = (m, hi, fill, rims) => {
      const E = dkWork(ctx, "dkBand", B), N = dkWork(ctx, "dkMask", B), D = B.w + B.h + 50;
      E.fillStyle = fill; each((c, x) => E.fillText(c.t, x, 0), hi);
      N.setTransform(1, 0, 0, 1, 0, 0); N.fillStyle = "#000"; N.fillRect(0, 0, B.w, B.h); N.globalCompositeOperation = "destination-out"; N.drawImage(m, 0, 0);
      E.setTransform(1, 0, 0, 1, 0, 0); E.globalCompositeOperation = "source-atop"; E.shadowOffsetX = D;
      for (const [r, col, al] of rims) { E.shadowColor = css(col, al); E.shadowBlur = r * fs * B.k; E.drawImage(N.canvas, -D, 0); }
      inPixels(ctx, () => ctx.drawImage(E.canvas, B.x0, B.y0));
    };
    // the lamps: tungsten white, the amber rim only a little way in, so the strokes of a Chinese character stay light
    if (Mp) { if (lamp) litUp(Mp, false, face, [[0.07, lamp.rim, 0.75], [0.025, lamp.rim, 0.9], [0.008, lamp.deep, 0.9]]); else each((c, x) => { ctx.fillStyle = face; ctx.fillText(c.t, x, 0); }, false); }
    // the neon: white-hot down the middle, the glass's colour deep at the rim
    if (Mh) litUp(Mh, true, css(glass.core), [[0.11, glass.body, 1], [0.055, glass.body, 1], [0.014, glass.deep, 1]]);
  },
  // objects are lit as the city is: faces in the night's blues (gold when gilded), the colour turned to floodlight, fine dark lines; the small parts stay ink on the colour block
  wrap: (ctx, C, p, plates) => {
    if (plates) return dkSmall(ctx, C);
    const g = (p && p.gilt) || 0;
    return mapped(ctx, { fill: { ink: DK.ink, light: mix([206, 202, 255], DK.pale, g), mid: mix([108, 96, 206], [196, 140, 64], g), dark: mix([30, 26, 82], [52, 34, 16], g), colour: (c) => mix(dkSpot(c), [255, 255, 255], 0.08) }, stroke: { ink: DK.ink, light: DK.cream }, line: 0.6 });
  },
  sticker: painters({ line: DK.ink, lineScale: 0.55, tone: inkAs(DK.ink, (c) => dkSpot(c)), shadow(ctx, draw) { ctx.save(); ctx.translate(7, 9); draw(css(DK.ink, 0.8)); ctx.restore(); } }),
  /** The corner tag: a theatre marquee — a black box ruled in gold, a row of lit bulbs along its top and foot, its capitals in the title's lamplight. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.64;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 1.5, h = f * 1.9, top = y + (fs * 1.34 - h), n = Math.max(4, Math.round(w / (f * 0.34)));
    ctx.fillStyle = css(DK.ink); ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = css(DK.gold); ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, top + 1.5, w - 3, h - 3); ctx.lineWidth = 1.2; ctx.strokeRect(x + 7, top + 7, w - 14, h - 14);
    for (const by of [top + h * 0.12, top + h * 0.88]) for (let i = 0; i < n; i++) {
      const bx = x + (w * (i + 0.5)) / n, r = f * 0.06;
      ctx.fillStyle = css(DK.amber, 0.25); ctx.beginPath(); ctx.arc(bx, by, r * 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = css([255, 244, 214]); ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
    }
    const base = top + h * 0.5 + f * 0.36;
    ctx.save();
    if (!fast && canPaint(ctx)) { const m = ctx.getTransform(); ctx.shadowColor = css(DK.amber, 0.45); ctx.shadowBlur = f * 0.3 * Math.hypot(m.a, m.b); }
    ctx.translate(0, base); ctx.fillStyle = ink || dkFace(ctx, f, (p && p.gilt) || 0); spaced(ctx, str, x + f * 0.75, 0, 4);
    ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: gold corner pieces — two rules stepping in at the corner, a diamond where they meet. */
  frame(ctx, env) {
    const { w, h } = env, b = 30, L = 84, s = 12;
    ctx.save(); ctx.strokeStyle = css(DK.gold, 0.9); ctx.lineJoin = "miter";
    for (const [x, y, sx, sy] of [[b, b, 1, 1], [w - b, b, -1, 1], [w - b, h - b, -1, -1], [b, h - b, 1, -1]]) {
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y + sy * s * 2); ctx.lineTo(x + sx * s, y + sy * s * 2); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * s * 2, y + sy * s); ctx.lineTo(x + sx * s * 2, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + sx * 10, y + sy * L * 0.75); ctx.lineTo(x + sx * 10, y + sy * (s * 2 + 10)); ctx.moveTo(x + sx * (s * 2 + 10), y + sy * 10); ctx.lineTo(x + sx * L * 0.75, y + sy * 10); ctx.stroke();
      ctx.fillStyle = css(DK.pale); shapeOf(ctx, [[x + sx * 4, y + sy * 4 - 5], [x + sx * 4 + 5, y + sy * 4], [x + sx * 4, y + sy * 4 + 5], [x + sx * 4 - 5, y + sy * 4]]); ctx.fill();
    }
    ctx.restore();
  },
  /** The plate under a text layer: a black slab with its corners stepped in, ruled in gold. */
  plate(ctx, x, y, w, h, colour, fs) {
    const s = fs * 0.08, pts = [[x + s, y], [x + w - s, y], [x + w - s, y + s], [x + w, y + s], [x + w, y + h - s], [x + w - s, y + h - s], [x + w - s, y + h], [x + s, y + h], [x + s, y + h - s], [x, y + h - s], [x, y + s], [x + s, y + s]];
    ctx.save(); ctx.translate(fs * 0.05, fs * 0.07); shapeOf(ctx, pts); ctx.fillStyle = css(DK.ink, 0.85); ctx.fill(); ctx.restore();
    shapeOf(ctx, pts); ctx.fillStyle = colour; ctx.fill(); ctx.lineJoin = "miter"; ctx.lineWidth = fs * 0.03; ctx.strokeStyle = css(DK.gold); ctx.stroke();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(DK.ink, 0.8); ctx.shadowBlur = 0; ctx.shadowOffsetX = 7 * unit; ctx.shadowOffsetY = 9 * unit; },
  post(ctx, w, h, C, p, unit = 1) { dkBloom(ctx, p.glow); grain(ctx, p.grain * 0.75, unit); vignette(ctx, w, h, [2, 2, 8], 0.55, 0.42); },
  prompt: `Objects from Gotham by night as a 1990s animated noir painted them — Art Deco, mysterious, opulent — that read at a glance:
- one clear object per sticker (a fedora, a vintage microphone, a martini glass, a 1930s car, a gramophone, a pocket watch, a searchlight, an Art Deco lamp, a key), with a strong, elegant silhouette built of long curves and stepped geometric forms; no realism, no fine detail;
- flat colour only, as if painted on black paper: deep blues and violets for the body, one or two shapes in gold, and the main colour for one accent;
- the app adds a fine dark line and a hard dark shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from an Art Deco city at night, built as simple models from a few boxes and cylinders — a stepped skyscraper, a theatre marquee, a streamlined radio, a jukebox, a 1930s car, a lamp post; no realism, no fine detail.
- the renderer paints faces in the night's blues with a fine dark line: do NOT try to draw shading or outlines yourself;
- "white" is a pale moonlit blue, "dark" a deep indigo, and "main" the floodlight's colour (the channel colour) — use it for one to three parts.`,
};

export const LOOKS = { cel, cyber, riso, anime, bluenote, editorial, songke, vivid, negative, cinema, cyano, monofilm, typo, toon, avant, collage, yellow, pitch, dots, neon, court, velvet, rave, chrome, netart, verse, glass, jelly, skies, spectrum, citypop, construct, deco };
export const LOOK_IDS = Object.keys(LOOKS);

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
const FX_ALL = ["text", "asset", "photo", "solid"];
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
  const seed = idSeed(L.id), E = { k, seed, C: C || [255, 200, 0], R: (n) => noise(n * 0.7071 + seed * 0.013) }, m = Math.max(B.w, B.h) * 0.12 + 24 * k;   // the layer's own shadows and outlines may stand a little outside its box
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
function fxCanvas(slot, w, h) {
  let c = WORK[slot];
  if (!c) { c = WORK[slot] = document.createElement("canvas"); c.getContext("2d", { willReadFrequently: true }); }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/** A copy of what the work canvas x holds in box B (a canvas of B's size, kept per slot). */
function region(x, B, slot) {
  const c = fxCanvas(slot, B.w, B.h), g = c.getContext("2d");
  g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.drawImage(x.canvas, B.x0, B.y0, B.w, B.h, 0, 0, B.w, B.h);
  return c;
}
/** A canvas's shape in one colour (kept per slot). */
function shapeIn(src, colour, slot) {
  const c = fxCanvas(slot, src.width, src.height), g = c.getContext("2d");
  g.globalCompositeOperation = "copy"; g.drawImage(src, 0, 0); g.globalCompositeOperation = "source-in"; g.fillStyle = css(colour); g.fillRect(0, 0, c.width, c.height);
  return c;
}
/** Bands of the layer slid sideways (each first cleared, so it is not doubled); `bars` adds a thin bar of colour to some. */
function slideBands(x, B, a, E, n0, bars) {
  const src = region(x, B, "fxBands"), n = Math.round(n0 + 8 * a);
  for (let i = 0; i < n; i++) {
    const y = Math.round(B.y0 + B.h * E.R(i * 2.7 + 1)), bh = Math.max(1, Math.round(B.h * (0.015 + E.R(i * 3.3 + 2) * 0.09))), dx = Math.round((E.R(i * 4.1 + 3) - 0.5) * B.w * 0.16 * (0.3 + a));
    if (y + bh > B.y1) continue;
    x.clearRect(B.x0, y, B.w, bh); x.drawImage(src, 0, y - B.y0, B.w, bh, B.x0 + dx, y, B.w, bh);
    if (bars && E.R(i * 5.3 + 4) > 0.5) { x.fillStyle = css([[255, 40, 80], [40, 220, 255], [80, 255, 120], boost(E.C, 0.7)][i % 4], 0.85); x.fillRect(B.x0 + B.w * E.R(i * 6.1 + 5) * 0.8, y, B.w * (0.05 + E.R(i + 6) * 0.2), Math.max(1, bh * 0.6)); }
  }
}

riso.elementFx = [
  { key: "shift", name: { zh: "套色错位", en: "Misregistration" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 12 * k, t: 6 * k, r: 12 * k, b: 6 * k }),
    /** The pink plate printed a little one way and the blue the other, showing as fringes either side of the layer's own ink. */
    paint(x, B, a, E) {
      const d = (2 + 9 * a) * E.k, src = region(x, B, "fxA");
      x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2) * 0.9;
      x.drawImage(shapeIn(src, RISO.pink, "fxP"), B.x0 + d, B.y0 + d * 0.4); x.drawImage(shapeIn(src, RISO.blue, "fxQ"), B.x0 - d * 0.7, B.y0 - d * 0.3);
    } },
  { key: "dots", name: { zh: "网点", en: "Halftone" }, for: FX_ALL, stage: "over", sub: [{ key: "pitch", name: { zh: "网点粗细", en: "Halftone size" }, def: 0.4 }],
    /** The ink printed through a halftone screen at 45°: from solid, the dots shrink and the ground shows between them. */
    paint(x, B, a, E, o) {
      const p = Math.max(3, Math.round((5 + 13 * o.pitch) * E.k)), r = Math.round(p * (0.72 - 0.38 * a) * 10) / 10, key = `fxDots|${p}|${r}`;
      let t = WORK[key];
      if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = t.height = p; const g = t.getContext("2d"); g.fillStyle = "#fff"; g.beginPath(); g.arc(p / 2, p / 2, r, 0, TAU); g.fill(); }
      const pat = x.createPattern(t, "repeat");
      if (pat && pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().rotateSelf(45));
      x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "destination-in"; x.fillStyle = pat; x.fillRect(B.x0, B.y0, B.w, B.h);
    } },
  { key: "speckle", name: { zh: "墨色不匀", en: "Patchy ink" }, for: FX_ALL, stage: "over",
    /** Where the ink did not take: soft patches and clustered specks through which the ground shows. */
    paint(x, B, a, E) {
      const W = x.canvas.width, H = x.canvas.height;
      x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = Math.min(1, a * 0.95);
      x.drawImage(wornTexture(W / E.k, H / E.k), 0, 0, W, H);
    } },
  { key: "streaks", name: { zh: "滚筒条痕", en: "Roller streaks" }, for: FX_ALL, stage: "over",
    /** Pale bands across the layer where the drum ran short of ink. */
    paint(x, B, a, E) {
      x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "destination-out";
      for (let k = 0; k < 5; k++) softBand(x, B.x0, B.x1, B.y0 + E.R(k * 3.3 + 1) * B.h, B.h * (0.03 + E.R(k * 4.1 + 2) * 0.08), [0, 0, 0], (0.35 + 0.55 * E.R(k * 5.9 + 3)) * a, E.seed + k * 9.1);
    } },
  { key: "ghost", name: { zh: "重影", en: "Ghosting" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.03, b: B.h * 0.4 }),
    /** A faint second impression of the layer a drum's turn further down. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      x.globalAlpha = 0.08 + 0.3 * a; x.drawImage(src, B.x0 + B.w * 0.02, B.y0 + B.h * (0.12 + 0.25 * a));
    } },
];
chrome.elementFx = [
  { key: "chrome", name: { zh: "铬面", en: "Chrome" }, for: FX_ALL, stage: "fill",
    /** The layer's colour replaced by polished metal — horizon bands, light along its upper-left rim and shade along the other, a specular streak. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), d = Math.max(1, Math.min(B.w, B.h) * 0.012);
      x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop";
      x.globalAlpha = a; x.fillStyle = chromeFill(x, B.x0 + B.w * 0.35, B.y0 - B.h * 0.1, B.x0 + B.w * 0.6, B.y1 + B.h * 0.1); x.fillRect(B.x0, B.y0, B.w, B.h);
      const white = shapeIn(src, [255, 255, 255], "fxW"), black = shapeIn(src, [0, 0, 0], "fxK");
      for (let i = 1; i <= 2; i++) { x.globalAlpha = a * 0.36; x.drawImage(black, B.x0 + d * i * 1.5, B.y0 + d * i * 1.5); x.globalAlpha = a * 0.26; x.drawImage(white, B.x0 - d * i * 1.5, B.y0 - d * i * 1.5); }
      x.globalAlpha = 0.8 * a; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineWidth = Math.max(1, B.h * 0.03);
      x.beginPath(); x.moveTo(B.x0 + B.w * 0.08, B.y0 + B.h * 0.32); x.quadraticCurveTo(B.x0 + B.w * 0.5, B.y0 + B.h * 0.52, B.x1 - B.w * 0.08, B.y0 + B.h * 0.26); x.stroke();
    } },
  { key: "holo", name: { zh: "全息彩光", en: "Holographic streak" }, for: FX_ALL, stage: "over",
    /** A rainbow streak smeared across the layer, a fainter, wider one about it. */
    paint(x, B, a, E) {
      const y = B.y0 + B.h * (0.25 + 0.3 * E.R(5)), bh = B.h * (0.06 + 0.16 * a), turn = E.R(6);
      x.globalCompositeOperation = "source-atop";
      x.globalAlpha = 0.3 * a; x.fillStyle = iridescent(x, B.x0, 0, B.x1, 0, turn); x.fillRect(B.x0, y - bh, B.w, bh * 3);
      x.globalAlpha = 0.8 * a; x.fillRect(B.x0, y, B.w, bh);
    } },
  { key: "drips", name: { zh: "熔滴", en: "Drips" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ b: B.h * 0.65 + 14 * k }),
    /** Drops running down from the layer's lowest edges, each in the colour the layer has there, with a highlight down it (see dripsBehind). */
    paint(x, B, a, E) { dripsBehind(x, B, a, E, null, 1); } },
  { key: "glitch", name: { zh: "故障切片", en: "Glitch slices" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.11, r: B.w * 0.11 }),
    /** Slices of the layer slid sideways, a few with a bar of red, cyan, green or the channel colour. */
    paint(x, B, a, E) { slideBands(x, B, a, E, 2, true); } },
];
netart.elementFx = [
  { key: "dither", name: { zh: "抖动点阵", en: "Dither" }, for: FX_ALL, stage: "fill",
    /** The layer read in square cells and printed in one-bit pixels of ink by an ordered dither: the lighter, the fewer. */
    paint(x, B, a, E) {
      const cs = Math.max(2, Math.round((fast ? 4 : 2.6) * E.k)), cols = Math.ceil(B.w / cs), rows = Math.ceil(B.h / cs), ink = naInk();
      const t = fxCanvas("fxCells", cols, rows), tg = t.getContext("2d");   // one pixel a cell, averaged as it is drawn down, so little is read back tg.globalCompositeOperation = "copy"; tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
      tg.drawImage(x.canvas, B.x0, B.y0, cols * cs, rows * cs, 0, 0, cols, rows);
      const img = tg.getImageData(0, 0, cols, rows).data;
      x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h);   // the layer fades out as its dither comes in
      x.globalCompositeOperation = "source-over"; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4;
        if (img[q + 3] < 100) continue;
        const lum = (img[q] * 54 + img[q + 1] * 183 + img[q + 2] * 19) / 65280;   // (read back without its alpha multiplied in)
        if ((dark ? lum : 1 - lum) * 0.85 + 0.12 > bayer(i, j)) x.rect(B.x0 + i * cs, B.y0 + j * cs, cs, cs);
      }
      x.fill();
    } },
  { key: "sort", name: { zh: "像素排序", en: "Pixel sorting" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.5 }),
    /** A one-pixel column of the layer stretched into a streak to the right, band after band. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      for (let i = 0, n = Math.round(6 + 60 * a); i < n; i++) {
        const y = Math.floor(B.h * E.R(i * 1.9 + 21)), bh = Math.max(1, Math.round((2 + E.R(i * 2.7 + 22) * 10) * E.k)), sx = Math.floor(B.w * E.R(i * 3.3 + 23)), len = B.w * (0.05 + E.R(i * 4.1 + 24) * 0.45) * a;
        x.drawImage(src, sx, y, 1, Math.min(bh, B.h - y), B.x0 + sx, B.y0 + y, len, Math.min(bh, B.h - y));
      }
    } },
  { key: "mosh", name: { zh: "数据错位", en: "Datamosh" }, for: FX_ALL, stage: "filter", reach: (B) => { const c = Math.max(4, Math.min(B.w, B.h) * 0.12) * 1.5; return { l: c, t: c * 0.5, r: c, b: c * 0.5 }; },
    /** Blocks of the layer copied a few cells off, some tinted, a few in flat colour. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), cell = Math.max(4, Math.min(B.w, B.h) * 0.12), spot = boost(E.C, 0.7);
      for (let i = 0, n = Math.round(3 + 14 * a); i < n; i++) {
        const bw = cell * (1 + Math.floor(E.R(i * 2.1 + 31) * 3)), bh = cell * (1 + Math.floor(E.R(i * 2.9 + 32) * 2)), sx = (B.w - bw) * E.R(i * 3.7 + 33), sy = (B.h - bh) * E.R(i * 4.3 + 34);
        const dx = B.x0 + sx + Math.round((E.R(i * 5.1 + 35) - 0.5) * 6) * cell * 0.5, dy = B.y0 + sy + Math.round((E.R(i * 5.9 + 36) - 0.5) * 2) * cell * 0.5, kind = E.R(i * 6.7 + 37);
        if (bw >= B.w || bh >= B.h) continue;
        if (kind < 0.2) { x.globalCompositeOperation = "source-over"; x.fillStyle = css([spot, [255, 40, 160], [40, 200, 255], [250, 210, 40]][i % 4], 0.9); x.fillRect(dx, dy, bw, bh); continue; }
        x.globalCompositeOperation = "source-over"; x.drawImage(src, sx, sy, bw, bh, dx, dy, bw, bh);
        if (kind < 0.45) { x.globalCompositeOperation = "source-atop"; x.fillStyle = css(kind < 0.3 ? spot : [60, 80, 255], 0.45); x.fillRect(dx, dy, bw, bh); }
      }
    } },
  { key: "shift", name: { zh: "扫描错行", en: "Scan shift" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.11, r: B.w * 0.11 }),
    /** Whole bands of the layer slid sideways. */
    paint(x, B, a, E) { slideBands(x, B, a, E, 1, false); } },
];

// ---------- shared painters for the looks' layer effects (every one works in B, the layer's box, in canvas pixels)
const FX_PHOTO = ["photo"];
/** A copy of src softened by drawing it down `f` times smaller in two steps (so it does not sparkle): laid on enlarged, it is blurred. */
function softened(src, f, slot) {
  const g1 = Math.min(f, 4), mw = Math.max(1, Math.round(src.width / g1)), mh = Math.max(1, Math.round(src.height / g1)), sw = Math.max(1, Math.round(src.width / f)), sh = Math.max(1, Math.round(src.height / f));
  const mid = fxCanvas(slot + "m", mw, mh), small = fxCanvas(slot, sw, sh), m = mid.getContext("2d"), s = small.getContext("2d");
  for (const g of [m, s]) { g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high"; }
  m.drawImage(src, 0, 0, mw, mh); s.drawImage(mid, 0, 0, sw, sh);
  return small;
}
/** src with `pad` px of clear canvas all round it (kept per slot). */
function padded(src, pad, slot) {
  const c = fxCanvas(slot, src.width + 2 * pad, src.height + 2 * pad), g = c.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, c.width, c.height); g.drawImage(src, pad, pad);
  return c;
}
/** A glow round the layer: its shape in `colour` (the layer itself without one) spread R px out, laid behind it at `alpha`, moved by (dx, dy). */
function glowBehind(x, B, src, R, alpha, colour, dx = 0, dy = 0, mode = "destination-over") {
  if (R < 1 || alpha <= 0) return;
  const pad = Math.ceil(R * 1.6) + 2, c = padded(colour ? shapeIn(src, colour, "fxGs") : src, pad, "fxG"), soft = softened(c, Math.max(2, R / 2.2), "fxGb");
  x.save(); x.globalCompositeOperation = mode; x.globalAlpha = Math.min(1, alpha); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(soft, B.x0 - pad + dx, B.y0 - pad + dy, c.width, c.height);
  x.restore();
}
/** Paints draw(g) on a canvas of B's size, keeps it to the layer's own pixels and lays it on in `mode`: a texture never outside the layer. */
function onLayer(x, B, src, mode, alpha, draw) {
  const c = fxCanvas("fxOn", B.w, B.h), g = c.getContext("2d");
  g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, B.w, B.h);
  g.save(); draw(g); g.restore();
  g.globalCompositeOperation = "destination-in"; g.drawImage(src, 0, 0);
  x.save(); x.globalCompositeOperation = mode; x.globalAlpha = Math.min(1, alpha); x.drawImage(c, B.x0, B.y0); x.restore();
}
/** A fill of dots `p` px apart, radius r, on a lattice turned by `turn` degrees (tiles kept). */
function dotFill(g, colour, p, r, turn = 45) {
  p = Math.max(3, Math.round(p)); r = Math.max(0.4, Math.round(r * 10) / 10);
  const key = `fxDotTile|${colour.map(Math.round).join()}|${p}|${r}`;
  let t = WORK[key];
  if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = t.height = p; const c = t.getContext("2d"); c.fillStyle = css(colour); c.beginPath(); c.arc(p / 2, p / 2, r, 0, TAU); c.fill(); }
  const pat = g.createPattern(t, "repeat");
  if (pat && pat.setTransform && typeof DOMMatrix !== "undefined" && turn) pat.setTransform(new DOMMatrix().rotateSelf(turn));
  return pat;
}
/** A gradient over B's size, clear toward its upper left and solid toward its lower right: the side turned from the light. */
function shadeSide(g, w, h) { const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.42, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,1)"); return gr; }
/** Every pixel of the layer in B through f(r, g, b, y, out) — y 0 at B's top, 1 at its foot — mixed in by a; alpha kept. */
function eachPixel(x, B, a, f) {
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
const tonesFx = (stopsOf, hard = 0) => (x, B, a, E) => {
  const lut = toneTable(stopsOf(E), hard), img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], j = ((r * 54 + g * 183 + b * 19) >> 8) * 3;
    d[i] = r + (lut[j] - r) * a; d[i + 1] = g + (lut[j + 1] - g) * a; d[i + 2] = b + (lut[j + 2] - b) * a;
  }
  x.putImageData(img, B.x0, B.y0);
};
/** A painter turning the layer one flat colour or fill, its shape kept. */
const flatFx = (fillOf) => (x, B, a, E) => {
  x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip();
  x.globalCompositeOperation = "source-atop"; x.globalAlpha = a; x.fillStyle = fillOf(x, B, E); x.fillRect(B.x0, B.y0, B.w, B.h);
};
/** Knocks the ground through the layer in worn patches: the wear texture at `zoom`, shifted by the layer's own random amount. */
function knockWorn(x, B, a, E, zoom) {
  const W = x.canvas.width, H = x.canvas.height, tex = wornTexture(W / E.k, H / E.k), ox = (E.R(91) - 0.5) * W * 0.3, oy = (E.R(92) - 0.5) * H * 0.3;
  x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip();
  x.globalCompositeOperation = "destination-out"; x.globalAlpha = Math.min(1, a);
  x.drawImage(tex, ox - (W * (zoom - 1)) / 2, oy - (H * (zoom - 1)) / 2, W * zoom, H * zoom);
  x.restore();
}
/** A painter laying a halftone of colour(E) over the layer — dots `pitch(E)` px apart growing with the strength — in `mode`; with `shade`, on its shaded side only. */
const dotsFx = ({ colour, pitch, size, mode = "multiply", shade = false, turn = 45 }) => (x, B, a, E) => {
  const p = pitch(E), src = region(x, B, "fxA");
  onLayer(x, B, src, mode, 1, (g) => {
    g.fillStyle = dotFill(g, colour(E), p, size(p, a), turn); g.fillRect(0, 0, B.w, B.h);
    if (shade) { g.globalCompositeOperation = "destination-in"; g.fillStyle = shadeSide(g, B.w, B.h); g.fillRect(0, 0, B.w, B.h); }
  });
};
/** Copies of src trailing off (dx, dy) px apart, each fainter, laid in `mode` (behind the layer, or over it). */
function trail(x, B, src, n, dx, dy, alpha, mode) {
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
function rePlate(x, B, plates) {
  const src = region(x, B, "fxA"), made = plates.map(([keep], i) => plateOf(src, keep, "fxPl" + i));
  x.clearRect(B.x0, B.y0, B.w, B.h); x.save(); x.globalCompositeOperation = "lighter";
  plates.forEach(([, dx, dy, s = 1], i) => { const w = B.w * s, h = B.h * s; x.drawImage(made[i], B.x0 + (B.w - w) / 2 + dx, B.y0 + (B.h - h) / 2 + dy, w, h); });
  x.restore();
}
/** Clears B and lays src back cut in horizontal bands, band i moved by shift(i, n) px (n bands, `cuts` the band edges as fractions of B's height). */
function cutBands(x, B, src, cuts, shift) {
  x.clearRect(B.x0, B.y0, B.w, B.h);
  for (let i = 0; i < cuts.length - 1; i++) { const y0 = Math.round(cuts[i] * B.h), y1 = Math.round(cuts[i + 1] * B.h); if (y1 > y0) x.drawImage(src, 0, y0, B.w, y1 - y0, B.x0 + shift(i), B.y0 + y0, B.w, y1 - y0); }
}
/** The layer read in square cells of `cs` px, one pixel a cell (averaged as it is drawn down): [data, cols, rows]. */
function cellsOf(x, B, cs) {
  const cols = Math.max(1, Math.ceil(B.w / cs)), rows = Math.max(1, Math.ceil(B.h / cs)), t = fxCanvas("fxCells", cols, rows), tg = t.getContext("2d");
  tg.globalCompositeOperation = "copy"; tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
  tg.drawImage(x.canvas, B.x0, B.y0, cols * cs, rows * cs, 0, 0, cols, rows);
  return [tg.getImageData(0, 0, cols, rows).data, cols, rows];
}
const lumOf = (d, q) => (d[q] * 54 + d[q + 1] * 183 + d[q + 2] * 19) / 65280;
/**
 * Drops running down from the layer's lowest edges, in `colour` (or, without one, the colour of the edge
 * above each), with a highlight down it — the layer smeared downward by laying the canvas behind itself
 * 1, 2, 4, 8… px lower, cut down to drops of `width` (× the unit) and laid behind the layer.
 */
function dripsBehind(x, B, a, E, colour, width) {
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
function ringsBehind(x, B, src, rings) {
  x.save(); x.globalCompositeOperation = "destination-over";
  rings.forEach(([colour, r], n) => { const s = shapeIn(src, colour, "fxRing" + n); for (let i = 0; i < 16; i++) { const t = (i / 16) * TAU; x.drawImage(s, B.x0 + Math.cos(t) * r, B.y0 + Math.sin(t) * r); } });
  x.restore();
}
/** The layer's own colours pushed toward fewer steps (4 to a channel), mixed in by a: posterized by degrees. */
const posterize = (x, B, a) => eachPixel(x, B, a, (r, g, b, y, o) => { o[0] = Math.round(r / 85) * 85; o[1] = Math.round(g / 85) * 85; o[2] = Math.round(b / 85) * 85; });
/** A halftone of the layer itself: its own tone in dots of `ink` on `paper` (each colour, or null for none), `pitch` px apart. */
function halftoneOf(x, B, a, pitch, ink, paper) {
  const [d, cols, rows] = cellsOf(x, B, pitch);
  x.save();
  x.globalCompositeOperation = "source-atop"; x.globalAlpha = a;
  if (paper) { x.fillStyle = css(paper); x.fillRect(B.x0, B.y0, B.w, B.h); }
  x.fillStyle = css(ink); x.beginPath();
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; if (d[q + 3] < 60) continue; const r = pitch * 0.62 * Math.sqrt(1 - lumOf(d, q)); if (r < 0.3) continue; const cx = B.x0 + (i + 0.5) * pitch, cy = B.y0 + (j + 0.5) * pitch; x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, TAU); }
  x.fill(); x.restore();
}
/** A painter lighting and shading the layer's own edges, as light from the upper left would: copies of its shape a step down-right darken, a step up-left lighten. */
const bevelFx = (lightA, shadeA, step) => (x, B, a, E) => {
  const src = region(x, B, "fxA"), d = Math.max(1, Math.min(B.w, B.h) * step), white = shapeIn(src, [255, 255, 255], "fxW"), black = shapeIn(src, [0, 0, 0], "fxK");
  x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop";
  for (let i = 1; i <= 2; i++) { x.globalAlpha = a * shadeA; x.drawImage(black, B.x0 + d * i * 1.5, B.y0 + d * i * 1.5); x.globalAlpha = a * lightA; x.drawImage(white, B.x0 - d * i * 1.5, B.y0 - d * i * 1.5); }
};

// ---------- each look's effects
cel.elementFx = [
  { key: "tone", name: { zh: "网点阴影", en: "Screentone shade" }, for: FX_ALL, stage: "over",
    /** Screentone dots of ink over the side turned from the light, as a cel's shading. */
    paint: dotsFx({ colour: () => [7, 7, 12], pitch: (E) => 7 * E.k, size: (p, a) => p * (0.1 + 0.26 * a), shade: true }) },
];
cyber.elementFx = [
  { key: "split", name: { zh: "色彩错位", en: "Colour split" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 12 * k, r: 12 * k }),
    /** Red and cyan pulled apart sideways, fringing the layer's edges. */
    paint(x, B, a, E) { const d = (1.5 + 8 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d, 0], [[0, 255, 255], d, 0]]); } },
  { key: "tear", name: { zh: "信号撕裂", en: "Signal tear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.2, r: B.w * 0.2 }),
    /** A few thick bands of the layer torn sideways, a red line along the top of each, a cyan one along its foot. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), n = 1 + Math.round(4 * a), cuts = [0];
      for (let i = 0; i < n; i++) cuts.push(clamp((i + 0.3 + E.R(i * 2.3 + 41) * 0.5) / n), clamp((i + 0.55 + E.R(i * 3.1 + 42) * 0.4) / n));
      cuts.push(1); cuts.sort((p, q) => p - q);
      const off = (i) => (i % 2 ? (E.R(i * 4.7 + 43) - 0.5) * B.w * 0.28 * (0.4 + a) : 0);
      cutBands(x, B, src, cuts, off);
      for (let i = 1; i < cuts.length - 1; i += 2) { const y0 = B.y0 + cuts[i] * B.h, y1 = B.y0 + cuts[i + 1] * B.h, dx = off(i); x.fillStyle = css(CY.red, 0.85); x.fillRect(B.x0 + dx, y0, B.w, Math.max(1, E.k)); x.fillStyle = css(CY.cyan, 0.85); x.fillRect(B.x0 + dx, y1 - Math.max(1, E.k), B.w, Math.max(1, E.k)); }
    } },
  { key: "glow", name: { zh: "线条光晕", en: "Line glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 60 * k, t: 60 * k, r: 60 * k, b: 60 * k }),
    /** The neon halo of the channel colour round the layer: a tight bright one, a wide faint one. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), c = boost(E.C, 0.8), col = sat(c) < 0.2 ? CY.cyan : c; glowBehind(x, B, src, (3 + 8 * a) * E.k, Math.min(1, a * 2.5), col); glowBehind(x, B, src, (8 + 26 * a) * E.k, 0.8 * a, col); } },
  { key: "tint", name: { zh: "照片染色", en: "Photo tint" }, for: FX_PHOTO, stage: "filter",
    /** The photo pressed into the night and neon of the city: black, the channel colour, a white highlight. */
    paint: tonesFx((E) => [[0, CY.deep], [0.45, mix(boost(E.C, 0.8), CY.deep, 0.4)], [0.78, boost(E.C, 0.8)], [1, CY.white]]) },
];
anime.elementFx = [
  { key: "warm", name: { zh: "照片暖调", en: "Photo warmed" }, for: FX_PHOTO, stage: "filter",
    /** The photo as an old print of a painted cel: warmer, its blacks lifted. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { o[0] = Math.min(255, r * 0.96 + 18); o[1] = g * 0.9 + 14; o[2] = b * 0.76 + 16; }); } },
];
bluenote.elementFx = [
  { key: "duo", name: { zh: "照片双色调", en: "Photo duotone" }, for: FX_PHOTO, stage: "filter",
    /** The photo in two inks: black and the channel colour, the paper for its lights. */
    paint: tonesFx((E) => [[0, BN.ink], [0.62, boost(E.C, 0.4)], [1, BN.paper]], 0.1) },
  { key: "halftone", name: { zh: "照片网点", en: "Photo halftone" }, for: FX_PHOTO, stage: "over",
    /** The photo screened as a coarse sleeve print: its own tones in dots of ink on paper. */
    paint(x, B, a, E) { halftoneOf(x, B, a, 6 * E.k, BN.ink, BN.paper); } },
];
editorial.elementFx = [
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A neutral, even black and white, as a magazine prints a portrait. */
    paint: tonesFx(() => [[0, [16, 16, 16]], [0.5, [128, 127, 125]], [1, [244, 242, 238]]]) },
  { key: "spot", name: { zh: "照片专色", en: "Photo in spot colour" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black and one spot colour, the channel's. */
    paint: tonesFx((E) => [[0, ED.ink], [0.55, boost(E.C, 0.5)], [1, ED.paper]], 0.15) },
];
songke.elementFx = [
  { key: "wear", name: { zh: "刷印不匀", en: "Uneven printing" }, for: FX_ALL, stage: "over",
    /** Where the block took too little ink: patches and specks through which the paper shows. */
    paint(x, B, a, E) { knockWorn(x, B, a, E, 1.6); } },
  { key: "seal", name: { zh: "朱砂印色", en: "Seal-red ink" }, for: FX_ALL, stage: "fill",
    /** The layer printed in the cinnabar of a seal, the ink a little worn. */
    paint(x, B, a, E) { flatFx(() => css(SONG.red))(x, B, a, E); knockWorn(x, B, a * 0.55, E, 0.7); } },
];
vivid.elementFx = [
  { key: "vivid", name: { zh: "照片鲜艳度", en: "Photo vividness" }, for: FX_PHOTO, stage: "filter",
    /** The photo as summer light shows it: its colours pushed further from grey, and warmed. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { const l = 0.3 * r + 0.59 * g + 0.11 * b; o[0] = clamp(l + (r - l) * 1.6 + 10, 0, 255); o[1] = clamp(l + (g - l) * 1.6 + 2, 0, 255); o[2] = clamp(l + (b - l) * 1.6 - 8, 0, 255); }); } },
];
negative.elementFx = [
  { key: "silhouette", name: { zh: "红黑剪影", en: "Red-and-black silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer cut as one flat shape: black on the light ground, red on the dark. */
    paint: flatFx(() => css(dark ? NEG.red : NEG.black)) },
  { key: "print", name: { zh: "丝网质感", en: "Screen-print texture" }, for: FX_ALL, stage: "over",
    /** The ink pulled through a screen: fine specks where it did not cover. */
    paint(x, B, a, E) { knockWorn(x, B, a * 0.9, E, 0.8); } },
  { key: "duo", name: { zh: "照片红黑", en: "Photo in red and black" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black, red and cream, stepping between them. */
    paint: tonesFx(() => [[0, NEG.black], [0.5, NEG.red], [1, NEG.cream]], 0.4) },
];
cinema.elementFx = [
  { key: "silhouette", name: { zh: "剪影", en: "Silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a dark silhouette against the light, a little lighter toward its foot. */
    paint: flatFx((x, B) => { const g = x.createLinearGradient(0, B.y0, 0, B.y1); g.addColorStop(0, css(dark ? [30, 27, 26] : CINE.soot)); g.addColorStop(1, css(dark ? [72, 58, 48] : [54, 46, 40])); return g; }) },
  { key: "glow", name: { zh: "背光", en: "Back light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 70 * k, t: 90 * k, r: 70 * k, b: 60 * k }),
    /** Light from behind the layer spilling round it, warm on the dark ground. */
    paint(x, B, a, E) { const R = (10 + 30 * a) * E.k; glowBehind(x, B, region(x, B, "fxA"), R, 0.9 * Math.min(1, a * 2.5), dark ? [255, 214, 160] : [255, 240, 210], 0, -R * 0.3); } },
  { key: "grade", name: { zh: "照片调色", en: "Photo toning" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a film still: cool shadows, warm, muted lights. */
    paint: tonesFx(() => [[0, [18, 22, 28]], [0.4, [72, 74, 72]], [0.75, [196, 170, 132]], [1, [244, 232, 210]]]) },
];
cyano.elementFx = [
  { key: "white", name: { zh: "发光白影", en: "Glowing white figure" }, for: FX_ALL, stage: "fill",
    /** The layer as the white a cyanotype leaves where light was held off. */
    paint: flatFx(() => css(CYA.white)) },
  { key: "spray", name: { zh: "喷枪柔雾", en: "Airbrush haze" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 70 * k, t: 70 * k, r: 70 * k, b: 70 * k }),
    /** A soft spray of white round the layer, a few droplets flung further. */
    paint(x, B, a, E) {
      const R = (8 + 26 * a) * E.k;
      glowBehind(x, B, region(x, B, "fxA"), R, 0.85 * Math.min(1, a * 2.5), CYA.white);
      x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = css(CYA.white, 0.7);
      for (let k = 0, n = Math.round(80 * a); k < n; k++) { const t = E.R(k * 1.7 + 51) * TAU, s = 0.5 + 0.55 * E.R(k * 2.9 + 52), px = B.x0 + B.w / 2 + Math.cos(t) * (B.w / 2 + R * s), py = B.y0 + B.h / 2 + Math.sin(t) * (B.h / 2 + R * s); x.beginPath(); x.arc(px, py, (0.6 + E.R(k + 53) * 1.6) * E.k, 0, TAU); x.fill(); }
      x.restore();
    } },
  { key: "halftone", name: { zh: "粗网点", en: "Coarse halftone" }, for: FX_ALL, stage: "over",
    /** Coarse white dots over the layer, as the screen of a cheap print. */
    paint: dotsFx({ colour: () => CYA.white, pitch: (E) => 12 * E.k, size: (p, a) => p * (0.08 + 0.3 * a), mode: "screen" }) },
  { key: "duo", name: { zh: "照片蓝晒", en: "Photo as cyanotype" }, for: FX_PHOTO, stage: "filter",
    /** The photo printed as a cyanotype: Prussian blue to white. */
    paint: tonesFx(() => [[0, CYA.ink], [0.45, CYA.prussian], [0.8, CYA.pale], [1, CYA.white]]) },
];
monofilm.elementFx = [
  { key: "ghost", name: { zh: "动态残影", en: "Motion ghost" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.25, t: B.h * 0.05 }),
    /** Faint afterimages of the layer left behind as it moved, to its right. */
    paint(x, B, a, E) { trail(x, B, region(x, B, "fxA"), 3, B.w * 0.025 * (0.5 + a), -B.h * 0.008, 0.18 + 0.4 * a, "destination-over"); } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A contrasty black and white, as on a fast film. */
    paint: tonesFx(() => [[0, [8, 8, 8]], [0.35, [58, 58, 56]], [0.7, [188, 186, 182]], [1, [246, 244, 240]]]) },
  { key: "motion", name: { zh: "照片动态模糊", en: "Photo motion blur" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.06, r: B.w * 0.06 }),
    /** The photo smeared sideways, as by a panning camera. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), n = 8, step = (B.w * 0.006 + 2 * E.k) * a, c = fxCanvas("fxMo", B.w, B.h), g = c.getContext("2d");
      g.globalCompositeOperation = "source-over"; g.clearRect(0, 0, B.w, B.h);
      for (let i = 0; i <= 2 * n; i++) { g.globalAlpha = 1 / (i + 1); g.drawImage(src, (i - n) * step, 0); }
      x.save(); x.globalAlpha = Math.min(1, a * 1.4); x.drawImage(c, B.x0, B.y0); x.restore();
    } },
  { key: "collage", name: { zh: "照片拼贴", en: "Photo collage" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.04, t: B.h * 0.06, r: B.w * 0.04, b: B.h * 0.06 }),
    /** The photo cut into three prints, each a little off and turned, with a white border. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      x.clearRect(B.x0, B.y0, B.w, B.h);
      for (let i = 0; i < 3; i++) {
        const w = B.w / 3, cx = B.x0 + w * (i + 0.5), cy = B.y0 + B.h / 2, r = (E.R(i * 2.7 + 61) - 0.5) * 0.08 * a, dy = (E.R(i * 3.3 + 62) - 0.5) * B.h * 0.08 * a, bd = (2 + 8 * a) * E.k;
        x.save(); x.translate(cx, cy + dy); x.rotate(r); x.fillStyle = css(MF.white); x.fillRect(-w / 2 + bd * 0.3 - bd, -B.h / 2 - bd, w - bd * 0.6 + bd * 2, B.h + bd * 2);
        x.drawImage(src, w * i + bd * 0.3, 0, w - bd * 0.6, B.h, -w / 2 + bd * 0.3, -B.h / 2, w - bd * 0.6, B.h); x.restore();
      }
    } },
];
typo.elementFx = [
  { key: "slice", name: { zh: "切割错位", en: "Slice" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.12, r: B.w * 0.12 }),
    /** The layer cut across into bands, every other one slid the other way. */
    paint(x, B, a, E) {
      const n = 2 + Math.round(4 * a), cuts = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : i === n ? 1 : clamp((i + (E.R(i * 1.9 + 71) - 0.5) * 0.5) / n))), d = B.w * 0.05 * (0.3 + a);
      cutBands(x, B, region(x, B, "fxA"), cuts, (i) => (i % 2 ? d : -d * 0.6));
    } },
  { key: "echo", name: { zh: "层叠残影", en: "Echo" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ r: 40 * k, b: 40 * k }),
    /** Copies of the layer's shape stacked down and to the right behind it, each fainter. */
    paint(x, B, a, E) { const s = shapeIn(region(x, B, "fxA"), dark ? [236, 234, 230] : TY.ink, "fxEc"), n = 2 + Math.round(3 * a), d = (3 + 4 * a) * E.k; trail(x, B, s, n, d, d, 0.55 + 0.3 * a, "destination-over"); } },
  { key: "scatter", name: { zh: "粒子消散", en: "Particle scatter" }, for: FX_ALL, stage: "filter", reach: (B) => ({ t: B.h * 0.2, r: B.w * 0.4, b: B.h * 0.2 }),
    /** The layer's right side breaking up into square particles drifting off to the right. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), cs = Math.max(3, Math.round(Math.min(B.w, B.h) * 0.06)), cols = Math.ceil(B.w / cs), rows = Math.ceil(B.h / cs), from = 1 - 0.75 * a;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const u = i / cols, q = j * cols + i;
        if (u < from || E.R(q * 1.3 + 81) > (u - from) / (1 - from + 1e-6) * 1.4) continue;
        const sx = i * cs, sy = j * cs, f = (u - from) / (1 - from + 1e-6), s = cs * (1 - 0.5 * f * E.R(q * 2.1 + 82));
        x.clearRect(B.x0 + sx, B.y0 + sy, cs, cs);
        x.drawImage(src, sx, sy, cs, cs, B.x0 + sx + f * B.w * 0.35 * E.R(q * 2.9 + 83), B.y0 + sy + (E.R(q * 3.7 + 84) - 0.5) * cs * 4 * f, s, s);
      }
    } },
  { key: "brush", name: { zh: "干笔刷痕", en: "Dry brush" }, for: FX_ALL, stage: "over",
    /** Streaks where a dry brush skipped across the layer. */
    paint(x, B, a, E) {
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "destination-out"; x.lineCap = "round";
      for (let k = 0, n = Math.round(10 + 60 * a); k < n; k++) { const y = B.y0 + B.h * E.R(k * 1.7 + 91), x0 = B.x0 + B.w * E.R(k * 2.3 + 92) * 0.8, len = B.w * (0.1 + E.R(k * 3.1 + 93) * 0.5); x.globalAlpha = 0.5 + 0.5 * E.R(k + 94); x.lineWidth = (0.6 + E.R(k * 4.1 + 95) * 1.8) * E.k; x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + len, y + (E.R(k * 5.3 + 96) - 0.5) * 3 * E.k); x.stroke(); }
      x.restore();
    } },
  { key: "hard", name: { zh: "黑白高反差", en: "Hard black and white" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black and white, all but thresholded. */
    paint: tonesFx(() => [[0, [0, 0, 0]], [0.5, [128, 128, 128]], [1, [255, 255, 255]]], 0.85) },
];
toon.elementFx = [
  { key: "silhouette", name: { zh: "剪影", en: "Silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a silhouette in the poster's night ink. */
    paint: flatFx(() => css(TOON.ink)) },
  { key: "burst", name: { zh: "放射光芒", en: "Sunburst" }, for: FX_ALL, stage: "behind", reach: (B) => { const r = Math.hypot(B.w, B.h) * 0.6; return { l: r, t: r, r, b: r }; },
    /** Rays of sunset colour fanning out behind the layer from its middle and fading at their tips, reaching further as it rises. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, d = Math.hypot(B.w, B.h) / 2, R = d * (1.05 + 0.55 * a), n = 18, t0 = E.R(101) * TAU, g = x.createRadialGradient(cx, cy, d * 0.5, cx, cy, R);
      g.addColorStop(0, css(TOON.sun, 1)); g.addColorStop(0.55, css(TOON.sun, 0.75)); g.addColorStop(1, css(TOON.sun, 0));
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2.5) * 0.75; x.fillStyle = g; x.beginPath();
      for (let i = 0; i < n; i++) { const t = t0 + (i / n) * TAU; x.moveTo(cx, cy); x.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); x.lineTo(cx + Math.cos(t + TAU / n / 2) * R, cy + Math.sin(t + TAU / n / 2) * R); x.closePath(); }
      x.fill(); x.restore();
    } },
  { key: "distress", name: { zh: "丝网斑驳", en: "Screen-print wear" }, for: FX_ALL, stage: "over",
    /** Big worn blotches where the screen print has rubbed through. */
    paint(x, B, a, E) { knockWorn(x, B, a * 1.05, E, 2.2); } },
  { key: "duo", name: { zh: "照片单色", en: "Photo in one colour" }, for: FX_PHOTO, stage: "filter",
    /** The photo in the poster's night ink, a sunset colour and cream. */
    paint: tonesFx((E) => [[0, TOON.ink], [0.6, mix(TOON.amber, boost(E.C, 0.4), 0.3)], [1, TOON.cream]], 0.2) },
];
avant.elementFx = [
  { key: "smear", name: { zh: "动态拖影", en: "Motion smear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.3 }),
    /** Faint copies of the layer smeared off to the left. */
    paint(x, B, a, E) { trail(x, B, region(x, B, "fxA"), 6, -B.w * 0.02 * (0.3 + a), 0, 0.12 + 0.3 * a, "source-over"); } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 60 * k, t: 60 * k, r: 60 * k, b: 60 * k }),
    /** The layer's own light spilling round it. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (8 + 24 * a) * E.k, 0.95 * Math.min(1, a * 2.5), null); } },
  { key: "blur", name: { zh: "焦外虚化与对焦框", en: "Out of focus with a frame of focus" }, for: FX_ALL, stage: "filter",
    /** The layer out of focus but for a frame in its middle, kept sharp, with a hairline and ticks round it. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), pad = Math.ceil((4 + 10 * a) * E.k), soft = softened(padded(src, pad, "fxBp"), 3 + 10 * a, "fxBl");
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.globalAlpha = 1 - Math.min(1, a * 1.6); x.drawImage(src, B.x0, B.y0);
      x.globalAlpha = Math.min(1, a * 1.6); x.imageSmoothingEnabled = true; x.drawImage(soft, B.x0 - pad, B.y0 - pad, B.w + 2 * pad, B.h + 2 * pad); x.restore();
      const fw = B.w * 0.36, fh = B.h * 0.36, fx = B.x0 + (B.w - fw) / 2, fy = B.y0 + (B.h - fh) * 0.4, t = Math.min(fw, fh) * 0.18;
      x.save(); x.globalAlpha = Math.min(1, a * 3); x.drawImage(src, fx - B.x0, fy - B.y0, fw, fh, fx, fy, fw, fh);
      x.strokeStyle = css(avInk(), 0.75); x.lineWidth = Math.max(1, E.k * 0.8); x.strokeRect(fx, fy, fw, fh);
      x.lineWidth = Math.max(1.5, E.k * 1.6);
      for (const [cx, cy, sx, sy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]]) { x.beginPath(); x.moveTo(cx - sx * 4, cy + sy * t); x.lineTo(cx - sx * 4, cy - sy * 4); x.lineTo(cx + sx * t, cy - sy * 4); x.stroke(); }
      x.restore();
    } },
  { key: "mosaic", name: { zh: "像素马赛克", en: "Pixel mosaic" }, for: FX_ALL, stage: "filter",
    /** The layer gone to square pixels, larger as it rises. */
    paint(x, B, a, E) {
      const cs = Math.max(1, (1 + 22 * a) * E.k), cols = Math.max(1, Math.round(B.w / cs)), rows = Math.max(1, Math.round(B.h / cs)), t = fxCanvas("fxMos", cols, rows), g = t.getContext("2d");
      g.globalCompositeOperation = "copy"; g.imageSmoothingEnabled = true; g.drawImage(region(x, B, "fxA"), 0, 0, cols, rows);
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.imageSmoothingEnabled = false; x.drawImage(t, B.x0, B.y0, B.w, B.h); x.restore();
    } },
  { key: "glass", name: { zh: "条纹玻璃", en: "Fluted glass" }, for: FX_ALL, stage: "filter",
    /** The layer seen through a panel of narrow vertical flutes, wider as it rises, each squeezing a wider slice into itself, shaded at one edge and lit at the other. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), p = Math.max(6, B.w * 0.035), half = (B.w * (0.15 + 0.9 * a)) / 2, cx = B.w / 2, i0 = Math.max(0, Math.floor((cx - half) / p)), i1 = Math.min(Math.ceil(B.w / p), Math.ceil((cx + half) / p));
      for (let i = i0; i < i1; i++) {
        const fx = i * p, sw = p * 1.9, sx = clamp(fx + p / 2 - sw / 2, 0, B.w - sw);
        x.clearRect(B.x0 + fx, B.y0, p, B.h); x.drawImage(src, sx, 0, sw, B.h, B.x0 + fx, B.y0, p, B.h);
        const g = x.createLinearGradient(B.x0 + fx, 0, B.x0 + fx + p, 0); g.addColorStop(0, "rgba(0,0,0,0.26)"); g.addColorStop(0.22, "rgba(255,255,255,0.08)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(0.86, "rgba(255,255,255,0.2)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
        x.save(); x.globalCompositeOperation = "source-atop"; x.fillStyle = g; x.fillRect(B.x0 + fx, B.y0, p, B.h); x.restore();
      }
    } },
  { key: "band", name: { zh: "色带", en: "Colour band" }, for: FX_ALL, stage: "filter",
    /** A vertical band across the layer where it shows in the channel colour, wider as it rises. */
    paint(x, B, a, E) {
      const bw = B.w * 0.28 * Math.pow(a, 0.8), bx = B.x0 + B.w * 0.38 - bw / 2;
      x.save(); x.beginPath(); x.rect(bx, B.y0, bw, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.fillStyle = css(boost(E.C, 0.5), 0.75); x.fillRect(bx, B.y0, bw, B.h); x.restore();
      x.save(); x.fillStyle = css(avInk(), 0.6); x.fillRect(bx - 1, B.y0, Math.max(1, E.k * 0.8), B.h); x.fillRect(bx + bw, B.y0, Math.max(1, E.k * 0.8), B.h); x.restore();
    } },
  { key: "fade", name: { zh: "渐隐", en: "Fade out" }, for: FX_ALL, stage: "over",
    /** The layer fading away toward its foot. */
    paint(x, B, a) { const g = x.createLinearGradient(0, B.y0 + B.h * (1 - 0.9 * a), 0, B.y1); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${Math.min(1, a * 1.1)})`); x.globalCompositeOperation = "destination-out"; x.fillStyle = g; x.fillRect(B.x0, B.y0, B.w, B.h); } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A soft, low-contrast black and white, as a studio's fashion print. */
    paint: tonesFx(() => [[0, [26, 26, 28]], [1, [236, 236, 232]]]) },
];
collage.elementFx = [
  { key: "lift", name: { zh: "纸片立体感", en: "Paper lift" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 20 * k, r: 30 * k, b: 34 * k }),
    /** The layer as a piece of paper cut out with a white margin, lifting off the page on a soft shadow. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), r = (3 + 8 * a) * E.k;
      x.save(); x.globalAlpha = Math.min(1, a * 1.6); ringsBehind(x, B, src, [[CL.white, r * 0.5], [CL.white, r]]); x.restore();
      glowBehind(x, B, src, (4 + 8 * a) * E.k + r, 0.55 * Math.min(1, a * 1.5), [0, 0, 0], (3 + 4 * a) * E.k, (5 + 6 * a) * E.k);
    } },
  { key: "tape", name: { zh: "胶带", en: "Tape" }, for: FX_ALL, stage: "over", reach: (B) => ({ l: B.w * 0.1, t: B.h * 0.15, r: B.w * 0.1, b: B.h * 0.15 }),
    /** Strips of translucent tape across two corners, holding the layer down. */
    paint(x, B, a, E) {
      const w = Math.min(B.w, B.h) * (0.35 + 0.25 * a), h = w * 0.32;
      x.save(); x.globalAlpha = Math.min(1, a * 3);
      for (const [cx, cy, t] of [[B.x0 + B.w * 0.06, B.y0 + B.h * 0.04, -0.6], [B.x1 - B.w * 0.06, B.y1 - B.h * 0.04, -0.6]]) {
        x.save(); x.translate(cx, cy); x.rotate(t + (E.R(cx) - 0.5) * 0.3); x.fillStyle = "rgba(240,232,206,0.62)"; x.fillRect(-w / 2, -h / 2, w, h);
        x.fillStyle = "rgba(255,255,255,0.25)"; x.fillRect(-w / 2, -h / 2, w, h * 0.3);
        x.fillStyle = "rgba(0,0,0,0.06)"; for (let i = 0; i < 8; i++) x.fillRect(-w / 2 + (i / 8) * w, -h / 2, 1, h); x.restore();
      }
      x.restore();
    } },
  { key: "halftone", name: { zh: "网点色块", en: "Halftone patch" }, for: FX_ALL, stage: "over",
    /** A disc of halftone in a collage colour laid over part of the layer, larger as it rises. */
    paint(x, B, a, E) {
      const R = Math.max(B.w, B.h) * (0.18 + 0.4 * a), cx = B.w * (0.3 + 0.4 * E.R(111)), cy = B.h * (0.3 + 0.4 * E.R(112)), col = [CL.red, CL.teal, CL.mustard, CL.pink][Math.floor(E.R(113) * 4)];
      onLayer(x, B, region(x, B, "fxA"), "multiply", 1, (g) => { g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip(); g.fillStyle = dotFill(g, col, 9 * E.k, 9 * E.k * 0.36, 15); g.fillRect(0, 0, B.w, B.h); });
    } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a black-and-white cutting from a magazine. */
    paint: tonesFx(() => [[0, CL.ink], [0.55, [140, 138, 132]], [1, CL.white]], 0.1) },
  { key: "strips", name: { zh: "照片撕条", en: "Photo torn in strips" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.06, r: B.w * 0.06 }),
    /** The photo torn across into strips, each slid a little, white paper showing along the torn edges. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), n = 4, cuts = Array.from({ length: n + 1 }, (_, i) => clamp((i + (i % n ? (E.R(i * 2.3 + 117) - 0.5) * 0.4 : 0)) / n)), d = B.w * 0.045 * a, gap = (1 + 7 * a) * E.k;
      cutBands(x, B, src, cuts, (i) => (i % 2 ? d : -d * 0.5));
      x.save(); x.fillStyle = css(CL.white);
      for (let i = 1; i < n; i++) { const y = B.y0 + cuts[i] * B.h; x.beginPath(); x.moveTo(B.x0 - d, y - gap / 2); for (let t = 0; t <= 1.001; t += 0.02) x.lineTo(B.x0 - d + (B.w + 2 * d) * t, y - gap / 2 + (E.R(i * 31 + t * 50) - 0.5) * gap); for (let t = 1; t >= -0.001; t -= 0.02) x.lineTo(B.x0 - d + (B.w + 2 * d) * t, y + gap / 2 + (E.R(i * 37 + t * 50 + 7) - 0.5) * gap); x.closePath(); x.fill(); }
      x.restore();
    } },
];
yellow.elementFx = [
  { key: "silhouette", name: { zh: "黑色剪影", en: "Black silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a flat black shape, as on a yellow poster. */
    paint: flatFx(() => css(YL.ink)) },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A hard black and white. */
    paint: tonesFx(() => [[0, YL.ink], [1, YL.white]], 0.6) },
];
pitch.elementFx = [
  { key: "halftone", name: { zh: "网点", en: "Halftone" }, for: FX_ALL, stage: "over",
    /** Dots of the pitch's deep green over the layer. */
    paint: dotsFx({ colour: () => PT.deep, pitch: (E) => 8 * E.k, size: (p, a) => p * (0.08 + 0.3 * a) }) },
  { key: "poster", name: { zh: "照片分色", en: "Photo posterized" }, for: FX_PHOTO, stage: "filter",
    /** The photo in four flat colours of the match poster: ink, green, yellow, white. */
    paint: tonesFx(() => [[0, PT.ink], [0.4, PT.green], [0.75, PT.yellow], [1, PT.white]], 0.75) },
];
dots.elementFx = [
  { key: "dots", name: { zh: "光点化", en: "Read into dots" }, for: FX_ALL, stage: "fill", sub: [{ key: "pitch", name: { zh: "点距", en: "Dot spacing" }, def: 0.4 }],
    /** The layer read into a grid of round points of light in its own colours, larger where it is brighter. */
    paint(x, B, a, E, o) {
      const cs = Math.max(3, (5 + 14 * o.pitch) * E.k), [d, cols, rows] = cellsOf(x, B, cs);
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4, al = d[q + 3] / 255;
        if (al < 0.25) continue;
        const l = lumOf(d, q), r = cs * 0.42 * Math.sqrt(0.15 + 0.85 * l) * Math.min(1, al * 1.3);
        x.fillStyle = `rgb(${Math.min(255, d[q] + 40)},${Math.min(255, d[q + 1] + 40)},${Math.min(255, d[q + 2] + 40)})`; x.beginPath(); x.arc(B.x0 + (i + 0.5) * cs, B.y0 + (j + 0.5) * cs, r, 0, TAU); x.fill();
      }
      x.restore();
    } },
  { key: "rainbow", name: { zh: "彩虹色散", en: "Rainbow" }, for: FX_ALL, stage: "over",
    /** Rainbow colour breaking into the layer from its foot, rising as the strength does. */
    paint(x, B, a, E) {
      onLayer(x, B, region(x, B, "fxA"), "color", Math.min(1, a * 1.2), (g) => {
        const h = g.createLinearGradient(0, 0, B.w, 0); for (let i = 0; i <= 6; i++) h.addColorStop(i / 6, css(rainbow(i / 6 + E.R(121))));
        g.fillStyle = h; g.fillRect(0, 0, B.w, B.h);
        const v = g.createLinearGradient(0, B.h * (1 - a), 0, B.h); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,1)");
        g.globalCompositeOperation = "destination-in"; g.fillStyle = v; g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "smear", name: { zh: "横向拖影", en: "Motion smear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.35 }),
    /** The layer's light drawn out into streaks to the right. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"); x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = 0.25 + 0.35 * a; x.drawImage(src, B.x0, B.y0, B.w * (1 + 0.35 * a), B.h); x.globalAlpha = 0.15 + 0.2 * a; x.drawImage(src, B.x0, B.y0, B.w * (1 + 0.7 * a), B.h); x.restore(); } },
  { key: "rgb", name: { zh: "色彩错位", en: "Colour split" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 8 * k, t: 4 * k, r: 8 * k, b: 4 * k }),
    /** Red and cyan a little apart on a slant, as on a screen out of alignment. */
    paint(x, B, a, E) { const d = (1 + 5 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d * 0.92, -d * 0.38], [[0, 255, 255], d * 0.92, d * 0.38]]); } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 80 * k, t: 80 * k, r: 80 * k, b: 80 * k }),
    /** A wide glow of the layer's own light, as of points on a dark screen. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (12 + 34 * a) * E.k, Math.min(1, a * 2.5), null); } },
];
/** The neon pop palette from the channel colour, turned round the wheel only under that look itself (see neonSet). */
const neonOf = (E) => { const mid = hueTurn(boost(E.C, 0.75), (current === neon ? values.shift || 0 : 0) * 360), hot = boost(hueTurn(mid, 135), 0.8); return { deep: NEON.deep, low: mix(NEON.deep, mid, 0.42), mid, hot, pale: mix(hot, NEON.white, 0.7) }; };
neon.elementFx = [
  { key: "map", name: { zh: "霓虹渐变映射", en: "Neon gradient map" }, for: FX_ALL, stage: "filter",
    /** The layer mapped by lightness onto the neon tones: night, the channel colour, its hot complement, a pale highlight. */
    paint: tonesFx((E) => neonStops(neonOf(E))) },
  { key: "posterize", name: { zh: "色阶硬度", en: "Hard tones" }, for: FX_ALL, stage: "filter",
    /** The layer's colours stepping into fewer, flatter tones. */
    paint(x, B, a) { posterize(x, B, a); } },
  { key: "rim", name: { zh: "轮廓光", en: "Rim light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 20 * k }),
    /** A hot rim of light along the layer's upper left edge, as of a lamp behind it. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), N = neonOf(E), d = (2 + 6 * a) * E.k; x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 3); x.drawImage(shapeIn(src, N.pale, "fxRim"), B.x0 - d, B.y0 - d * 0.8); x.restore(); glowBehind(x, B, src, d * 2, 0.6 * a, N.hot, -d, -d * 0.8); } },
  { key: "glow", name: { zh: "背光", en: "Back light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 90 * k, t: 90 * k, r: 90 * k, b: 90 * k }),
    /** A glow of the channel colour behind the layer. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (12 + 36 * a) * E.k, 0.9 * Math.min(1, a * 2.5), neonOf(E).mid); } },
  { key: "halftone", name: { zh: "阴影网点", en: "Halftone shadow" }, for: FX_ALL, stage: "over",
    /** Dots of the night tone over the layer's shaded side. */
    paint: dotsFx({ colour: (E) => neonOf(E).deep, pitch: (E) => 7 * E.k, size: (p, a) => p * (0.1 + 0.26 * a), shade: true }) },
];
court.elementFx = [
  { key: "varsity", name: { zh: "校队描边", en: "Varsity outline" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 24 * k, t: 24 * k, r: 24 * k, b: 24 * k }),
    /** A white gap round the layer, then an outline in ball orange, as a varsity number has. */
    paint(x, B, a, E) { const r1 = (2 + 5 * a) * E.k, r2 = r1 + (3 + 9 * a) * E.k; x.save(); x.globalAlpha = Math.min(1, a * 1.6); ringsBehind(x, B, region(x, B, "fxA"), [[BB.white, r1 * 0.5], [BB.white, r1], [BB.orange, (r1 + r2) / 2], [BB.orange, r2]]); x.restore(); } },
  { key: "knockout", name: { zh: "网点挖空", en: "Halftone knock-out" }, for: FX_ALL, stage: "over",
    /** Holes of a halftone knocked out of the layer, growing as it rises. */
    paint: dotsFx({ colour: () => [0, 0, 0], pitch: (E) => 9 * E.k, size: (p, a) => p * 0.42 * a, mode: "destination-out" }) },
  { key: "spray", name: { zh: "喷漆滴流", en: "Spray drips" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 30 * k, t: 30 * k, r: 30 * k, b: B.h * 0.65 + 30 * k }),
    /** Spray paint of the team colour round the layer, and drips running from it. */
    paint(x, B, a, E) {
      const team = bbTeam(E.C);
      dripsBehind(x, B, a, E, team, 0.7);
      x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = css(team, 0.85);
      for (let k = 0, n = Math.round(260 * a); k < n; k++) { const t = E.R(k * 1.3 + 131) * TAU, s = 0.9 + E.R(k * 2.1 + 132) ** 2 * 0.25, px = B.x0 + B.w / 2 + Math.cos(t) * B.w / 2 * s, py = B.y0 + B.h / 2 + Math.sin(t) * B.h / 2 * s; x.beginPath(); x.arc(px, py, (0.6 + E.R(k * 3.7 + 133) * 1.6) * E.k, 0, TAU); x.fill(); }
      x.restore();
    } },
  { key: "trails", name: { zh: "速度残影", en: "Speed trails" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.6 }),
    /** The layer has just passed: copies of it in the team colour trailing back to the left, and speed lines. */
    paint(x, B, a, E) {
      const team = bbTeam(E.C), s = shapeIn(region(x, B, "fxA"), team, "fxTr");
      trail(x, B, s, 5, -B.w * 0.07 * (0.4 + a), 0, 0.3 + 0.4 * a, "destination-over");
      x.save(); x.globalCompositeOperation = "destination-over"; x.strokeStyle = css(team, 0.75); x.lineCap = "round";
      for (let k = 0, n = Math.round(3 + 8 * a); k < n; k++) { const y = B.y0 + B.h * (0.15 + 0.7 * E.R(k * 2.9 + 141)), len = B.w * (0.2 + E.R(k * 4.1 + 142) * 0.4) * a; x.lineWidth = (1.5 + E.R(k + 143) * 3) * E.k; x.beginPath(); x.moveTo(B.x0 - len, y); x.lineTo(B.x0 + B.w * 0.2, y); x.stroke(); }
      x.restore();
    } },
  { key: "distress", name: { zh: "丝网斑驳", en: "Screen-print wear" }, for: FX_ALL, stage: "over",
    /** The print worn through in specks and patches. */
    paint(x, B, a, E) { knockWorn(x, B, a * 0.95, E, 1.3); } },
  { key: "duo", name: { zh: "照片双色", en: "Photo in two colours" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a two-colour team print: navy, the team colour, white. */
    paint: tonesFx((E) => [[0, mix(BB.navy, bbTeam(E.C), 0.2)], [0.55, bbTeam(E.C)], [1, BB.white]], 0.15) },
];
velvet.elementFx = [
  { key: "plush", name: { zh: "绒面", en: "Velvet" }, for: FX_ALL, stage: "fill",
    /** The layer in plush: a soft sheen toward the light, its edges falling into shade, a fine pile. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      onLayer(x, B, src, "source-atop", a, (g) => {
        const hl = g.createRadialGradient(B.w * 0.35, B.h * 0.3, 0, B.w * 0.35, B.h * 0.3, Math.max(B.w, B.h) * 0.7); hl.addColorStop(0, "rgba(255,255,255,0.4)"); hl.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = hl; g.fillRect(0, 0, B.w, B.h);
        const sd = g.createLinearGradient(0, 0, B.w, B.h); sd.addColorStop(0.5, "rgba(10,10,30,0)"); sd.addColorStop(1, "rgba(10,10,30,0.35)"); g.fillStyle = sd; g.fillRect(0, 0, B.w, B.h);
        for (let k = 0, n = Math.round(B.w * B.h / (60 * E.k * E.k)); k < n; k++) { g.fillStyle = E.R(k * 0.7 + 151) > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"; g.fillRect(B.w * E.R(k * 1.3 + 152), B.h * E.R(k * 1.9 + 153), E.k, E.k); }
      });
    } },
  { key: "check", name: { zh: "格纹", en: "Check" }, for: FX_ALL, stage: "over",
    /** A soft check in a deeper tone of the layer, as on plush fabric. */
    paint(x, B, a, E) { const c = Math.max(B.w, B.h) * 0.09; onLayer(x, B, region(x, B, "fxA"), "multiply", Math.min(1, a * 0.95), (g) => { g.translate(B.w / 2, B.h / 2); g.rotate(0.2); g.fillStyle = "rgba(40,40,70,0.55)"; for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) if ((i + j) % 2 === 0) g.fillRect(i * c, j * c, c, c); }); } },
  { key: "volume", name: { zh: "立体感", en: "Volume" }, for: FX_ALL, stage: "over",
    /** Volume from a light at the upper left: the layer's rim lit there and shaded across from it. */
    paint: bevelFx(0.22, 0.3, 0.012) },
  { key: "fuzz", name: { zh: "绒毛边", en: "Fuzzy edge" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 30 * k, t: 30 * k, r: 30 * k, b: 30 * k }),
    /** A soft halo of the layer's own colour round it, as the pile of velvet catches the light. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (3 + 16 * a) * E.k, 0.9 * Math.min(1, a * 2.5), null); } },
  { key: "shadow", name: { zh: "柔和投影", en: "Soft shadow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 10 * k, r: 50 * k, b: 70 * k }),
    /** A soft shadow of the layer cast down and to the right. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (6 + 16 * a) * E.k, 0.65 * Math.min(1, a * 1.5), VL.night, (2 + 8 * a) * E.k, (5 + 16 * a) * E.k); } },
  { key: "tone", name: { zh: "照片绒色", en: "Photo in velvet colours" }, for: FX_PHOTO, stage: "filter",
    /** The photo mapped onto the velvet palette: night, periwinkle, acid green, pink, cream. */
    paint: tonesFx(() => [[0, VL.night], [0.32, VL.peri], [0.6, VL.green], [0.82, VL.pink], [1, VL.cream]], 0.3) },
];
rave.elementFx = [
  { key: "holo", name: { zh: "全息镭射", en: "Holographic sheen" }, for: FX_ALL, stage: "fill",
    /** The layer in a soap-film rainbow, a glossy arc across it. */
    paint(x, B, a, E) {
      flatFx((g) => iridescent(g, B.x0, B.y0, B.x1, B.y1, E.R(7)))(x, B, a, E);
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.7 * a; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineWidth = Math.max(1, B.h * 0.035);
      x.beginPath(); x.moveTo(B.x0 + B.w * 0.1, B.y0 + B.h * 0.3); x.quadraticCurveTo(B.x0 + B.w * 0.5, B.y0 + B.h * 0.12, B.x1 - B.w * 0.1, B.y0 + B.h * 0.32); x.stroke(); x.restore();
    } },
  { key: "halo", name: { zh: "日食光环", en: "Eclipse halo" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.5, t: B.h * 0.5, r: B.w * 0.5, b: B.h * 0.5 }),
    /** An oval ring of light hugging the layer, as round an eclipse, wider as it rises. */
    paint(x, B, a, E) {
      const s = (1.25 + 0.35 * a) / 0.9, rx = (B.w / 2) * s, ry = (B.h / 2) * s, g = x.createRadialGradient(0, 0, rx * 0.72, 0, 0, rx * 1.12);
      g.addColorStop(0, css(RV.violet, 0)); g.addColorStop(0.35, css(RV.pink, 0.9)); g.addColorStop(0.45, css(RV.white, 1)); g.addColorStop(0.6, css(RV.cyan, 0.6)); g.addColorStop(1, css(RV.violet, 0));
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 3); x.translate(B.x0 + B.w / 2, B.y0 + B.h / 2); x.scale(1, ry / rx);
      x.fillStyle = g; x.fillRect(-rx * 1.15, -rx * 1.15, rx * 2.3, rx * 2.3); x.restore();
    } },
  { key: "fringe", name: { zh: "色差", en: "Colour fringe" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.04, t: B.h * 0.04, r: B.w * 0.04, b: B.h * 0.04 }),
    /** Red spread outward and blue drawn in about the layer's middle, as a cheap lens fringes. */
    paint(x, B, a) { const s = 0.05 * a; rePlate(x, B, [[[255, 0, 0], 0, 0, 1 + s], [[0, 255, 0], 0, 0, 1], [[0, 0, 255], 0, 0, 1 - s]]); } },
  { key: "neon", name: { zh: "照片霓虹热感", en: "Photo in neon heat" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a heat image of the club: night, violet, pink, orange, white. */
    paint: tonesFx(() => [[0, RV.night], [0.3, RV.violet], [0.55, RV.pink], [0.78, [255, 170, 60]], [1, RV.white]]) },
];
chrome.elementFx.push(
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A hard silvery black and white. */
    paint: tonesFx(() => [[0, [0, 0, 0]], [0.45, [110, 110, 112]], [1, [248, 248, 248]]], 0.1) },
);
verse.elementFx = [
  { key: "comic", name: { zh: "漫画上色", en: "Comic colouring" }, for: FX_ALL, stage: "fill", reach: (B, k) => ({ l: 8 * k, t: 8 * k, r: 8 * k, b: 8 * k }),
    /** The layer coloured as a comic: its colours flattened, an ink line round it, its shaded side in dots. */
    paint(x, B, a, E) {
      posterize(x, B, a);
      const src = region(x, B, "fxA"), o = (1.5 + 3 * a) * E.k, d = Math.min(B.w, B.h) * 0.08;
      const sh = fxCanvas("fxSh", B.w, B.h), g = sh.getContext("2d");
      g.globalCompositeOperation = "copy"; g.drawImage(shapeIn(src, VS.ink, "fxShI"), 0, 0); g.globalCompositeOperation = "destination-out"; g.drawImage(src, -d, -d * 1.2);
      g.globalCompositeOperation = "source-in"; g.fillStyle = dotFill(g, VS.ink, Math.max(4, 6 * E.k), Math.max(4, 6 * E.k) * 0.32); g.fillRect(0, 0, B.w, B.h);
      x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.85 * a; x.drawImage(sh, B.x0, B.y0); x.restore();
      x.save(); x.globalAlpha = Math.min(1, a * 3); ringsBehind(x, B, src, [[VS.ink, o]]); x.restore();
    } },
  { key: "halftone", name: { zh: "网点", en: "Halftone" }, for: FX_ALL, stage: "over",
    /** Ben-Day dots of ink over the layer's shaded side. */
    paint: dotsFx({ colour: () => VS.ink, pitch: (E) => 6 * E.k, size: (p, a) => p * (0.1 + 0.25 * a), shade: true }) },
  { key: "hatch", name: { zh: "排线", en: "Hatching" }, for: FX_ALL, stage: "over",
    /** Diagonal hatching in ink over the layer's shaded side, closer as it rises. */
    paint(x, B, a, E) {
      onLayer(x, B, region(x, B, "fxA"), "multiply", Math.min(1, a * 1.4), (g) => {
        g.strokeStyle = css(VS.ink); g.lineWidth = Math.max(1, E.k * 1.1); g.beginPath();
        const step = Math.max(3, (9 - 4 * a) * E.k); for (let t = -B.h; t < B.w + B.h; t += step) { g.moveTo(t, B.h); g.lineTo(t + B.h, 0); }
        g.stroke(); g.globalCompositeOperation = "destination-in"; g.fillStyle = shadeSide(g, B.w, B.h); g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "offset", name: { zh: "套色错位", en: "Off-register" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 12 * k, t: 6 * k, r: 12 * k, b: 6 * k }),
    /** The red plate printed a little up and left, the blue a little down and right, the green in register. */
    paint(x, B, a, E) { const d = (1 + 7 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d, -d * 0.35], [[0, 255, 0], 0, 0], [[0, 0, 255], d, d * 0.35]]); } },
  { key: "glitch", name: { zh: "维度故障", en: "Dimension glitch" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.1, r: B.w * 0.1 }),
    /** Bars of the layer slipping sideways, tinted magenta and cyan, with scan lines through them. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      for (let i = 0, n = Math.round(1 + 6 * a); i < n; i++) {
        const y = B.y0 + B.h * E.R(i * 2.1 + 161) * 0.9, bh = B.h * (0.04 + E.R(i * 2.9 + 162) * 0.14), bx = B.x0 + B.w * E.R(i * 3.7 + 163) * 0.6, bw = B.w * (0.2 + E.R(i * 4.3 + 164) * 0.5), dx = (E.R(i * 5.1 + 165) - 0.5) * B.w * 0.16 * (0.5 + a);
        x.save(); x.beginPath(); x.rect(bx, y, bw, bh); x.clip(); x.clearRect(bx, y, bw, bh); x.drawImage(src, B.x0 + dx, B.y0);
        x.globalCompositeOperation = "source-atop"; x.fillStyle = css(i % 2 ? VS.cyan : VS.magenta, 0.45); x.fillRect(bx, y, bw, bh);
        x.fillStyle = css(VS.ink, 0.25); for (let yy = y; yy < y + bh; yy += 3 * E.k) x.fillRect(bx, yy, bw, Math.max(1, E.k * 0.7)); x.restore();
      }
    } },
  { key: "photo", name: { zh: "照片漫画化", en: "Photo as comic" }, for: FX_PHOTO, stage: "filter",
    /** The photo pressed into comic colours, then screened. */
    paint(x, B, a, E) {
      tonesFx(() => (dark ? [[0, VS.ink], [0.3, VS.violet], [0.55, VS.magenta], [0.8, [255, 176, 130]], [1, VS.white]] : [[0, VS.ink], [0.3, [74, 52, 150]], [0.56, [236, 74, 146]], [0.8, [255, 214, 196]], [1, VS.white]]), 0.55)(x, B, a, E);
      dotsFx({ colour: () => VS.ink, pitch: (G) => 6 * G.k, size: (p, s) => p * 0.24 * s })(x, B, a, E);
    } },
];
glass.elementFx = [
  { key: "glass", name: { zh: "压花玻璃", en: "Patterned glass" }, for: FX_ALL, stage: "filter",
    sub: [{ key: "scale", name: { zh: "纹理大小", en: "Pattern size" }, def: 0.4 }, { key: "glint", name: { zh: "玻璃高光", en: "Glints" }, def: 0.45 }, { key: "shade", name: { zh: "玻璃暗纹", en: "Dark lines" }, def: 0.4 }],
    /** The layer seen through hammered glass (see glassWarp), the pattern fixed to the cover. */
    paint(x, B, a, E, o) {
      const img = x.getImageData(B.x0, B.y0, B.w, B.h), out = x.createImageData(B.w, B.h), unit = Math.min(x.canvas.width, x.canvas.height) / E.k;
      glassPixels(img.data, out.data, B.w, B.h, E.k, -B.x0, -B.y0, unit * 0.085 * a, unit * (0.025 + 0.065 * o.scale), o.glint * Math.min(1, a * 2), o.shade * Math.min(1, a * 2), 0, 0);
      x.putImageData(out, B.x0, B.y0);
    } },
  { key: "paint", name: { zh: "油画笔触", en: "Brush strokes" }, for: FX_ALL, stage: "filter",
    /** The layer painted over in short strokes of its own colours, each across the change in lightness. */
    paint(x, B, a, E) {
      const c = Math.max(3, 12 * E.k), [d, cols, rows] = cellsOf(x, B, c);
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, a * 0.9); x.lineCap = "round"; x.lineWidth = c * 0.9;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4;
        if (d[q + 3] < 200) continue;
        const L = (ii, jj) => lumOf(d, (Math.min(rows - 1, Math.max(0, jj)) * cols + Math.min(cols - 1, Math.max(0, ii))) * 4), gx = L(i + 1, j) - L(i - 1, j), gy = L(i, j + 1) - L(i, j - 1);
        const cx = B.x0 + (i + 0.5 + (E.R(q * 1.7) - 0.5) * 0.8) * c, cy = B.y0 + (j + 0.5 + (E.R(q * 2.3) - 0.5) * 0.8) * c, t = (Math.hypot(gx, gy) > 0.03 ? Math.atan2(gy, gx) + Math.PI / 2 : 0.7) + (E.R(q * 3.1) - 0.5) * 0.5, len = c * (1.2 + E.R(q * 3.7) * 1.4), v = (E.R(q * 4.3) - 0.5) * 26;
        x.strokeStyle = `rgb(${(d[q] + v) | 0},${(d[q + 1] + v) | 0},${(d[q + 2] + v) | 0})`; x.beginPath(); x.moveTo(cx - (Math.cos(t) * len) / 2, cy - (Math.sin(t) * len) / 2); x.lineTo(cx + (Math.cos(t) * len) / 2, cy + (Math.sin(t) * len) / 2); x.stroke();
      }
      x.restore();
    } },
  { key: "frost", name: { zh: "雾面", en: "Frost" }, for: FX_ALL, stage: "filter",
    /** The layer behind frosted glass: softened, a milky haze over it. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), soft = softened(src, 4 + 8 * a, "fxFr"); x.save(); x.globalCompositeOperation = "source-atop"; x.imageSmoothingEnabled = true; x.globalAlpha = Math.min(1, a * 0.9); x.drawImage(soft, B.x0, B.y0, B.w, B.h); x.globalAlpha = 0.35 * a; x.fillStyle = css(dark ? [90, 92, 86] : [244, 246, 240]); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore(); } },
];
jelly.elementFx = [
  { key: "jelly", name: { zh: "果冻", en: "Jelly" }, for: FX_ALL, stage: "fill",
    /** The layer as clear jelly: lit from inside, its rim deeper, bubbles in it, a glossy highlight, a little see-through. */
    paint(x, B, a, E) {
      bevelFx(0.25, 0.28, 0.014)(x, B, a, E);
      const s = Math.min(B.w, B.h);
      onLayer(x, B, region(x, B, "fxA"), "source-atop", a, (g) => {
        const hl = g.createRadialGradient(B.w * 0.45, B.h * 0.45, 0, B.w * 0.5, B.h * 0.5, Math.max(B.w, B.h) * 0.6); hl.addColorStop(0, "rgba(255,250,230,0.45)"); hl.addColorStop(1, "rgba(255,250,230,0)"); g.fillStyle = hl; g.fillRect(0, 0, B.w, B.h);
        g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = Math.max(1, s * 0.006);
        for (let k = 0; k < 12; k++) { g.beginPath(); g.arc(B.w * E.R(k * 2.1 + 171), B.h * E.R(k * 2.9 + 172), s * (0.01 + E.R(k * 3.7 + 173) ** 2 * 0.05), 0, TAU); g.stroke(); }
        g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.ellipse(B.w * 0.28, B.h * 0.24, s * 0.12, s * 0.05, -0.5, 0, TAU); g.fill();
      });
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = 0.12 * a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
    } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 100 * k, t: 100 * k, r: 100 * k, b: 100 * k }),
    /** The jelly's glow, in its own colours, spilling round it. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (14 + 40 * a) * E.k, 0.9 * Math.min(1, a * 2.5), null); } },
  { key: "depth", name: { zh: "景深虚化", en: "Depth of field" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 20 * k, t: 20 * k, r: 20 * k, b: 20 * k }),
    /** The layer out of focus, as machinery behind the creature. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), pad = Math.ceil((3 + 10 * a) * E.k), soft = softened(padded(src, pad, "fxDp"), 2 + 9 * a, "fxDf");
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.globalAlpha = 1 - Math.min(1, a * 1.3); x.drawImage(src, B.x0, B.y0); x.globalAlpha = Math.min(1, a * 1.3); x.imageSmoothingEnabled = true; x.drawImage(soft, B.x0 - pad, B.y0 - pad, B.w + 2 * pad, B.h + 2 * pad); x.restore();
    } },
  { key: "tone", name: { zh: "照片青橙调", en: "Photo teal and orange" }, for: FX_PHOTO, stage: "filter",
    /** The photo graded teal and orange. */
    paint: tonesFx(() => [[0, [8, 18, 28]], [0.4, [34, 104, 132]], [0.7, [244, 132, 86]], [1, [252, 246, 228]]]) },
];
skies.elementFx = [
  { key: "vivid", name: { zh: "照片通透", en: "Photo clarity" }, for: FX_PHOTO, stage: "filter",
    /** The photo made clear and vivid as an anime sky: more colour and contrast, cobalt toward the top, the sun's warmth toward the foot. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { const l = 0.3 * r + 0.59 * g + 0.11 * b, c = (v) => clamp(128 + (l + (v - l) * 1.45 - 128) * 1.12, 0, 255), top = Math.max(0, 0.5 - y) * 2, foot = Math.max(0, y - 0.5) * 2; o[0] = clamp(c(r) - 14 * top + 12 * foot, 0, 255); o[1] = clamp(c(g) - 2 * top + 4 * foot, 0, 255); o[2] = clamp(c(b) + 22 * top - 10 * foot, 0, 255); }); } },
];
spectrum.elementFx = [
  { key: "stipple", name: { zh: "点刻", en: "Stipple" }, for: FX_ALL, stage: "fill", sub: [{ key: "depth", name: { zh: "浓淡", en: "Depth" }, def: 0.55 }],
    /** The layer engraved in stipple: dots of ink, thick where it is dark. */
    paint(x, B, a, E, o) {
      const cs = Math.max(2, 2.6 * E.k), [d, cols, rows] = cellsOf(x, B, cs), ink = spInk();
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; if (d[q + 3] < 100) continue; const tone = clamp((1 - lumOf(d, q)) * (0.45 + 0.9 * o.depth) + 0.05); if (E.R(j * cols + i + 0.5) > tone) continue; const px = B.x0 + (i + E.R(i * 1.3 + j * 2.1 + 181)) * cs, py = B.y0 + (j + E.R(i * 2.7 + j * 1.1 + 182)) * cs, r = cs * (0.26 + 0.22 * tone); x.moveTo(px + r, py); x.arc(px, py, r, 0, TAU); }
      x.fill(); x.restore();
    } },
  { key: "lines", name: { zh: "线刻", en: "Line engraving" }, for: FX_ALL, stage: "fill",
    /** The layer engraved in level lines of ink, swelling where it is dark. */
    paint(x, B, a, E) {
      const p = Math.max(3, 4.5 * E.k), [d, cols, rows] = cellsOf(x, B, p), ink = spInk();
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) {
        const y = B.y0 + (j + 0.5) * p, th = [];
        for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; th.push(d[q + 3] < 100 ? 0 : clamp((1 - lumOf(d, q)) * 1.1 - 0.04)); }
        const at = (i, s) => y + (th[i] - 0.5) * p * 0.3 + s * th[i] * p * 0.48;
        x.moveTo(B.x0, at(0, -1)); for (let i = 1; i < cols; i++) x.lineTo(B.x0 + i * p, at(i, -1)); for (let i = cols - 1; i >= 0; i--) x.lineTo(B.x0 + i * p, at(i, 1)); x.closePath();
      }
      x.fill(); x.restore();
    } },
  { key: "stream", name: { zh: "光谱流线", en: "Spectral streams" }, for: FX_ALL, stage: "behind", reach: (B) => ({ r: B.w * 1.5 }),
    /** Threads of the spectrum streaming out of the layer to the right, close-packed, each its own colour and weight. */
    paint(x, B, a, E) {
      x.save(); x.globalCompositeOperation = "destination-over"; x.lineCap = "butt";
      for (let i = 0, n = Math.round(10 + 80 * a); i < n; i++) { const y = B.y0 + B.h * (0.1 + 0.8 * (i + E.R(i * 1.3 + 191) * 0.6) / n), len = B.w * (0.3 + 1.2 * a) * (0.6 + 0.4 * E.R(i * 2.1 + 192)); x.strokeStyle = css(spec(E.R(i * 3.7 + 193))); x.lineWidth = (0.8 + E.R(i * 4.3 + 194) * 2.2) * E.k * 0.8; x.beginPath(); x.moveTo(B.x0 + B.w * 0.5, y); x.lineTo(B.x1 + len, y); x.stroke(); }
      x.restore();
    } },
  { key: "drip", name: { zh: "垂直滴流", en: "Drips" }, for: FX_ALL, stage: "behind", reach: (B) => ({ b: B.h * 1.2 }),
    /** Threads of the spectrum dripping down from the layer, in spectrum order across it. */
    paint(x, B, a, E) {
      x.save(); x.globalCompositeOperation = "destination-over"; x.lineCap = "butt";
      for (let i = 0, n = Math.round(10 + 120 * a); i < n; i++) { const t = i / n, px = B.x0 + B.w * (0.08 + 0.84 * t), len = B.h * (0.25 + 0.95 * E.R(i * 2.7 + 201)) * (0.3 + 0.7 * a); x.strokeStyle = css(spec(t * 0.9 + E.R(i + 202) * 0.08)); x.lineWidth = (0.8 + E.R(i * 3.3 + 203) * 1.8) * E.k * 0.8; x.beginPath(); x.moveTo(px, B.y1 - B.h * 0.3); x.lineTo(px, B.y1 + len); x.stroke(); }
      x.restore();
    } },
];
citypop.elementFx = [
  { key: "cel", name: { zh: "赛璐珞分色", en: "Cel tones" }, for: FX_ALL, stage: "filter",
    /** The layer painted as a cel: its lightness stepped into four flat tones, its hue kept, the shadows sunk toward a night teal, the lights warmed. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); celPixels(img.data, a); x.putImageData(img, B.x0, B.y0); } },
  { key: "neon", name: { zh: "霓虹辉光", en: "Neon glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 80 * k, t: 80 * k, r: 80 * k, b: 80 * k }),
    /** Neon light round the layer: a wide violet haze and a tight hot pink glow. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"); glowBehind(x, B, src, 32 * E.k * (0.4 + a), 0.75 * a, [120, 60, 255]); glowBehind(x, B, src, 9 * E.k * (0.5 + a), Math.min(1, a * 1.6), CP.pink); } },
  { key: "vhs", name: { zh: "录像带", en: "Videotape" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 16 * k, r: 40 * k }),
    /** The layer as a worn tape plays it: its red smeared to the right and its blue to the left, a band slid sideways, scanlines across it. */
    paint(x, B, a, E) {
      const d = (2 + 8 * a) * E.k;
      rePlate(x, B, [[[255, 0, 0], d, 0], [[0, 255, 0], 0, 0], [[0, 0, 255], -d * 0.6, 0]]);
      const src = region(x, B, "fxA"), y = Math.round(B.h * (0.2 + 0.6 * E.R(5))), bh = Math.max(1, Math.round(B.h * (0.03 + 0.06 * a)));
      if (y + bh <= B.h) { x.clearRect(B.x0, B.y0 + y, B.w, bh); x.drawImage(src, 0, y, B.w, bh, B.x0 + (6 + 22 * a) * E.k, B.y0 + y, B.w, bh); }
      const p = Math.max(2, Math.round(3 * E.k));
      onLayer(x, B, region(x, B, "fxA"), "multiply", 0.45 * a, (g) => { g.fillStyle = "rgb(40,40,80)"; for (let yy = 0; yy < B.h; yy += p) g.fillRect(0, yy, B.w, Math.max(1, p / 3)); });
    } },
];
construct.elementFx = [
  { key: "blocks", name: { zh: "块面构成", en: "Built of blocks" }, for: FX_ALL, stage: "fill", sub: [{ key: "size", name: { zh: "块面大小", en: "Block size" }, def: 0.2 }],
    /** The layer built again of rectangles: read in cells, joined into blocks of one tone each — greys by its own lightness, red where it was strongly coloured — and a hairline round some. */
    paint(x, B, a, E, o) {
      const cs = Math.max(3, (5 + 22 * o.size) * E.k), [d, cols, rows] = cellsOf(x, B, cs), red = cnRed(E.C), tones = [CN.ink, CN.greys[3], CN.greys[2], CN.greys[1], CN.greys[0], CN.light];
      const tone = (i, j) => { const q = (j * cols + i) * 4; return sat([d[q], d[q + 1], d[q + 2]]) > 0.35 && lumOf(d, q) > 0.2 ? 6 : Math.min(5, Math.floor(lumOf(d, q) * 6)); };
      const blocks = joinCells(cols, rows, (i, j) => d[(j * cols + i) * 4 + 3] > 100, (i, j, p, q) => tone(i, j) === tone(p, q), 3, 4, E.seed % 97);
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a;
      for (const [i, j, bw, bh] of blocks) { const t = tone(i, j); x.fillStyle = css(t === 6 ? red : tones[t]); x.fillRect(B.x0 + i * cs, B.y0 + j * cs, bw * cs + 0.6, bh * cs + 0.6); }
      x.strokeStyle = css(CN.ink, 0.5); x.lineWidth = Math.max(0.8, E.k * 0.8); x.beginPath();
      for (const [i, j, bw, bh] of blocks) if (E.R(i * 1.7 + j * 2.9 + 3) < 0.25) x.rect(B.x0 + i * cs, B.y0 + j * cs, bw * cs, bh * cs);
      x.stroke(); x.restore();
    } },
  { key: "greys", name: { zh: "灰阶分版", en: "Grey plates" }, for: FX_ALL, stage: "filter",
    /** The layer pressed into a few flat greys between ink and cream paper. */
    paint: tonesFx(() => CN_TONES, 0.75) },
  { key: "wedge", name: { zh: "斜切色块", en: "Diagonal wedge" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.6, r: B.w * 0.6, t: B.h * 0.6, b: B.h * 0.6 }),
    /** A band of the poster red cut on a diagonal behind the layer, a bar of ink along its edge. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, len = Math.hypot(B.w, B.h) * (0.55 + 0.5 * a), th = Math.min(B.w, B.h) * (0.2 + 0.45 * a), ang = -0.6 + (E.R(7) - 0.5) * 0.3, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const band = (o, t) => [[cx - ux * len + nx * o, cy - uy * len + ny * o], [cx + ux * len + nx * o, cy + uy * len + ny * o], [cx + ux * len + nx * (o + t), cy + uy * len + ny * (o + t)], [cx - ux * len + nx * (o + t), cy - uy * len + ny * (o + t)]];
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2);
      x.fillStyle = css(cnRed(E.C)); shapeOf(x, band(-th / 2, th)); x.fill();
      x.fillStyle = css(CN.ink); shapeOf(x, band(th / 2, th * 0.14)); x.fill();
      x.restore();
    } },
];
const DK_GILT = tonesFx(() => [[0, [26, 14, 4]], [0.28, [110, 64, 22]], [0.46, [218, 154, 64]], [0.56, [160, 102, 38]], [0.72, [238, 186, 92]], [0.88, [255, 226, 150]], [1, [255, 248, 226]]]);
deco.elementFx = [
  { key: "gilt", name: { zh: "鎏金", en: "Gilded" }, for: FX_ALL, stage: "filter",
    /** The layer in polished gold: its lightness mapped onto bronze, gold and cream, then a sheen laid across it — pale at the top, a dark band below the middle as metal reflects a horizon, bright again at the foot. */
    paint(x, B, a, E) {
      DK_GILT(x, B, a, E);
      onLayer(x, B, region(x, B, "fxA"), "soft-light", a, (g) => {
        const gr = g.createLinearGradient(0, 0, 0, B.h);
        for (const [t, c] of [[0, [255, 255, 255]], [0.4, [200, 200, 200]], [0.52, [40, 40, 40]], [0.6, [110, 110, 110]], [0.85, [235, 235, 235]], [1, [255, 255, 255]]]) gr.addColorStop(t, css(c));
        g.fillStyle = gr; g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "rim", name: { zh: "暗夜剪影", en: "Silhouette with rim light" }, for: FX_ALL, stage: "fill", reach: (B, k) => ({ l: 12 * k, t: 12 * k, r: 12 * k, b: 6 * k }),
    /** The layer turned to a black silhouette against the night, a rim of the floodlight's colour along its upper left and of moonlight along its upper right. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), d = Math.max(1.5, Math.min(B.w, B.h) * 0.01 + 1.5 * E.k), spot = dkSpot(E.C);
      x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = a; x.fillStyle = css(DK.ink); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2);
      x.drawImage(shapeIn(src, mix(spot, [255, 255, 255], 0.2), "fxRimA"), B.x0 - d, B.y0 - d * 0.5);
      x.drawImage(shapeIn(src, dkMoonlight(0), "fxRimB"), B.x0 + d, B.y0 - d * 0.6);
      x.restore();
    } },
  { key: "burst", name: { zh: "放射金芒", en: "Gold sunburst" }, for: FX_ALL, stage: "behind", reach: (B) => { const r = Math.max(B.w, B.h) * 0.8; return { l: r, t: r, r, b: r }; },
    /** Gold rays fanning out from behind the layer, as a deco sunburst: long and short wedges by turns, fading out, a pale halo at their heart. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, R = Math.max(B.w, B.h) * (0.6 + 0.65 * a), n = 32, turn = E.R(3) * TAU, al = Math.min(1, a * 2.5);
      x.save(); x.globalCompositeOperation = "destination-over";
      const gr = x.createRadialGradient(cx, cy, Math.min(B.w, B.h) * 0.25, cx, cy, R); gr.addColorStop(0, css(DK.pale, al)); gr.addColorStop(0.45, css(DK.gold, 0.7 * al)); gr.addColorStop(1, css(DK.gold, 0));
      x.fillStyle = gr; x.beginPath();
      for (let i = 0; i < n; i++) { const a0 = turn + (i / n) * TAU; x.moveTo(cx, cy); x.arc(cx, cy, R * (i % 2 ? 0.72 : 1), a0, a0 + (TAU / n) * 0.45); x.closePath(); }
      x.fill();
      const halo = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5); halo.addColorStop(0, css(DK.cream, 0.55 * al)); halo.addColorStop(1, css(DK.cream, 0));
      x.fillStyle = halo; x.fillRect(cx - R * 0.5, cy - R * 0.5, R, R);
      x.restore();
    } },
  { key: "night", name: { zh: "夜色分调", en: "Night grade" }, for: FX_PHOTO, stage: "filter",
    /** The photo painted into the ultramarine night (see dkPixels), its warm colours kept as crimson and gold. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); dkPixels(img.data, a, values.gilt || 0, current.id === "deco"); x.putImageData(img, B.x0, B.y0); } },   // under this look the photo is already in the night: read by value, so it is not crushed twice
];
// What five looks' own letterings do, as effects worked on any layer's pixels once it is painted: so they
// go with whatever text effect a text layer has, and on a sticker, a photo or a colour as well.
cyber.elementFx.push({ key: "sliced", name: { zh: "三段切片", en: "Three slices" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.h * 0.16, r: B.h * 0.16, t: B.h * 0.03, b: B.h * 0.03 }),
  /** The layer cut across in three bands — the top one slipped right, the bottom one left, a hairline of nothing between them — with a red and a cyan echo behind. */
  paint(x, B, a) {
    const src = region(x, B, "fxSlice"), slip = B.h * 0.08 * a, gap = B.h * 0.014 * a, d = B.h * 0.035 * a;
    cutBands(x, B, src, [0, 0.4, 0.66, 1], (i) => [slip, 0, -slip * 0.8][i]);
    if (gap > 0.3) for (const t of [0.4, 0.66]) x.clearRect(B.x0 - slip * 2, B.y0 + B.h * t - gap / 2, B.w + slip * 4, gap);
    const W = x.canvas.width, x0 = Math.max(0, Math.floor(B.x0 - slip * 1.2 - 2)), x1 = Math.min(W, Math.ceil(B.x1 + slip * 1.2 + 2)), P = { x0, y0: B.y0, w: x1 - x0, h: B.h }, cut = region(x, P, "fxSliceCut");
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2.5);
    for (const [dx, dy, col] of [[-d, d * 0.35, CY.cyan], [d, -d * 0.35, CY.red]]) x.drawImage(shapeIn(cut, col, "fxSliceEcho"), P.x0 + dx, P.y0 + dy);
    x.restore();
  } });
riso.elementFx.push({ key: "overprint", name: { zh: "第二色叠印", en: "Second-ink overprint" }, for: FX_ALL, stage: "behind", reach: (B) => { const d = Math.min(B.w, B.h) * 0.09; return { r: d, b: d }; },
  /** A second impression of the layer in the riso's pink, printed off to the lower right: behind it where it shows, and a little darker where the two inks overlap (only a little: it lies over nearly all of the layer). */
  paint(x, B, a) {
    const src = region(x, B, "fxOver"), d = Math.min(B.w, B.h) * 0.08 * a, ink = shapeIn(src, RISO.pink, "fxOverInk"), alpha = Math.min(1, a * 3) * 0.9;
    onLayer(x, B, src, "multiply", alpha * 0.22, (g) => g.drawImage(ink, d, d * 0.8));
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = alpha; x.drawImage(ink, B.x0 + d, B.y0 + d * 0.8); x.restore();
  } });
anime.elementFx.push({ key: "keyline", name: { zh: "双色描边", en: "Two-tone outline" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 16 * k, t: 16 * k, r: 24 * k, b: 24 * k }),
  /** Two outlines round the layer, as on a cel title: a dark ink line at its edge and a broad cream one outside that, with a soft shadow to the lower right. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxKey"), k = E.k, line = 4 * k * a, wide = line + 9 * k * a, d = 7 * k * a;
    if (line < 0.3) return;
    ringsBehind(x, B, src, [[ANI.line, line * 0.5], [ANI.line, line], ...[1, 2, 3].map((i) => [ANI.cream, line + ((wide - line) * i) / 3])]);
    const sh = shapeIn(src, ANI.line, "fxKeyShadow");
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = 0.5 * Math.min(1, a * 3);
    for (let i = 0; i < 16; i++) { const t = (i / 16) * TAU; x.drawImage(sh, B.x0 + d + Math.cos(t) * wide, B.y0 + d + Math.sin(t) * wide); }
    x.restore();
  } });
vivid.elementFx.push({ key: "block", name: { zh: "日光立体", en: "Sunlit block" }, for: FX_ALL, stage: "behind", reach: (B, k) => { const d = Math.min(B.h * 0.12, 40 * k) + 6 * k; return { l: 6 * k, t: 6 * k, r: d, b: d }; },
  /** The layer stood up as a block: a solid navy depth down to the right and a navy outline, its lower part in warmer light, as summer lettering is. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxBlock"), k = E.k, depth = Math.min(B.h * 0.12, 40 * k) * a, line = 4 * k * a;
    onLayer(x, B, src, "multiply", 0.55 * a, (g) => { const gr = g.createLinearGradient(0, B.h * 0.5, 0, B.h * 0.6); gr.addColorStop(0, css(VV.butter, 0)); gr.addColorStop(1, css(VV.butter)); g.fillStyle = gr; g.fillRect(0, 0, B.w, B.h); });
    if (line > 0.3) ringsBehind(x, B, src, [[VV.navy, line * 0.5], [VV.navy, line]]);
    const s = shapeIn(src, VV.navy, "fxBlockDepth"), steps = Math.max(2, Math.min(14, Math.round(depth / (2 * k))));
    x.save(); x.globalCompositeOperation = "destination-over";
    if (depth > 0.3) for (let i = 1; i <= steps; i++) { const t = (depth * i) / steps; x.drawImage(s, B.x0 + t, B.y0 + t); }
    x.restore();
  } });
netart.elementFx.push({ key: "selected", name: { zh: "反白选中", en: "Selected" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 8 * k, r: 8 * k, t: 6 * k, b: 6 * k }),
  /** As if the layer were selected on an old screen: turned white on a navy box, with a little colour fringe at its edges. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxSel"), k = E.k, pad = 6 * k * a, d = 2.5 * k * a;
    x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, a * 1.2); x.fillStyle = css(NA.light); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2) * 0.85;
    for (const [sd, c] of [[-1, [0, 220, 255]], [1, [255, 0, 170]]]) x.drawImage(shapeIn(src, c, "fxSelFringe"), B.x0 + sd * d, B.y0);
    x.globalAlpha = Math.min(1, a * 1.6); x.fillStyle = css(NA.navy); x.fillRect(B.x0 - pad, B.y0 - pad * 0.6, B.w + pad * 2, B.h + pad * 1.2);
    x.restore();
  } });

let current = cel, values = {};
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
  for (const d of (LOOKS[id] || cel).params) {
    const v = given && given[d.key];
    out[d.key] = d.text ? (typeof v === "string" ? [...v.trim()].slice(0, d.max).join("") : d.def) : Number.isFinite(v) ? clamp(v, d.min, d.max) : d.def;
  }
  return out;
}
/** Makes a look current. `given` are the profile's own parameter values for it. */
export function setLook(id, given, s = 7, onDark = true) { current = LOOKS[id] || cel; values = lookParams(current.id, given); seed = Number.isFinite(s) ? s : 7; dark = !!onDark; return current; }
export const look = () => current;
export const lookValues = () => values;
/** What else decides how the current look paints, besides its values: the ground it is on and the profile's seed. */
export const lookState = () => `${dark ? 1 : 0}|${seed}`;
/** The context graphics and the small cover parts should draw on under the current look. */
export const styled = (ctx, C, plates = false) => (current.wrap ? current.wrap(ctx, C, values, plates) : ctx);
export { INK, css };
/** Internals the tests reach for. */
export const __test = { toneTable, hueTurn, joinCells, celPixels, dkPixels, dkSpot };
