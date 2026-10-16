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
//
// The current look is module state, set by drawCover() from the profile before anything is drawn.

import { fonts, spaced, spacedW, brackets, toneField } from "./cel.js";
import { blockLayout } from "./layout.js";
import { drawTitleVertical, titleBlock, titleBlockVertical } from "./title.js";

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
  repaint: (c) => `a frame of cyberpunk concept art in the graphic language of Cyberpunk 2077: near-black shadows, hard neon light in ${c} with cyan and red edge light, sharp-edged graphic shapes, wet reflective surfaces, a little haze; bold and graphic rather than painterly, no visible interface or signage text.`,
  about: { zh: "《赛博朋克 2077》里义眼启动扫描的界面：近黑底、频道色的实色切角面板配黑字、斜体切片的标题，四角是取景框、镜头圆环和读数；红青色彩错位、信号撕裂、扫描线制造故障感，图形是用光线勾出的深色硬件。冷、硬、有速度感——适合科技、数码、游戏、夜景与城市。", en: "The interface of an optical implant starting up and scanning, after Cyberpunk 2077: near-black ground, solid chamfered panels in the channel colour with black lettering, slanted sliced headlines, viewfinder corners, lens rings and readouts; a red and cyan colour split, signal tears and scanlines for the glitch, objects as dark hardware drawn in lines of light. Cold, hard and fast — for tech, gadgets, games, night and city." },
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
  theme: (base) => ({ ...base, field: css(RISO.paper), text: css(RISO.blue), dim: css(RISO.blue, 0.6), titleFill: css(RISO.blue), titleInk: css(RISO.paper), grid: () => css(RISO.blue, 0.1) }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(RISO.paper); ctx.fillRect(0, 0, w, h);
    if (env.photo) {   // the photo as a one-ink print: grey, then the blue ink in its shadows, on paper
      env.drawPhoto(1);
      wash(ctx, w, h, "screen", RISO.blue, 1); wash(ctx, w, h, "multiply", RISO.paper, 1);
    } else if (L.grid && p.dots > 0) {   // a field of halftone in the channel ink, fading down the sheet; the size slider sets its pitch
      toneField(ctx, -30, -30, w + 30, h * 0.62, Math.round(18 + 40 * p.pitch), css(C, 0.8), (x, y) => (1 - y / (h * 0.62)) * 0.95 * p.dots - (x / w) * 0.35);
    }
    if (L.grid || L.fill) risoShapes(ctx, env, p.shapes);   // on the ground, or over a photo filling the canvas (not on a print)
    return true;
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
function godRays(ctx, w, h, amt, dusk = 0) {
  if (amt <= 0) return;
  const ox = w * (0.6 + rand(621) * 0.25), oy = -h * 0.35, len = Math.hypot(w, h) * 1.2, c = mix([255, 248, 226], [255, 206, 150], dusk);
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
function lensFlare(ctx, w, h, amt) {
  const sx = w * (0.7 + rand(611) * 0.2), sy = h * (0.08 + rand(612) * 0.14), u = Math.min(w, h), vx = w / 2 - sx, vy = h / 2 - sy;
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
  theme: (base) => ({ ...base, field: css([40, 44, 86]), text: css(ANI.cream), dim: css(ANI.cream, 0.6), titleFill: css(ANI.cream), titleInk: css(ANI.line), grid: () => "rgba(0,0,0,0)" }),
  /**
   * A painted sky — deep above, hazy toward the horizon; with Dusk, violet above and rose and amber
   * below — with soft banks of cloud (more of them, one by one, as Clouds rises; lit from below at
   * dusk) and beams of light slanting down through it. A photo filling the canvas gets the beams too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, d = p.dusk;
    if (env.photo) { env.drawPhoto(); wash(ctx, w, h, "multiply", [255, 238, 216], 0.5); if (L.fill) godRays(ctx, w, h, p.rays, d); return true; }
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, css(mix(mix([34, 46, 108], [58, 40, 104], d), C, 0.06))); sky.addColorStop(0.55, css(mix(mix([92, 132, 184], [206, 122, 146], d), C, 0.08))); sky.addColorStop(1, css(mix(mix([244, 208, 172], [255, 172, 96], d), C, 0.14)));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    if (!L.grid) return true;
    const lit = mix(ANI.cream, [255, 196, 170], d), n = p.clouds * 13;
    for (let k = 0; k < Math.ceil(n); k++) {
      const a = clamp(n - k), cx = rand(k * 3 + 1) * w, cy = h * (0.18 + rand(k * 3 + 2) * 0.5), rx = w * (0.1 + rand(k * 3 + 3) * 0.16), ry = rx * 0.3;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, rx * 0.25 * d, 0, 0, 0, rx);
      g.addColorStop(0, css(lit, 0.55 * a)); g.addColorStop(0.6, css(lit, 0.22 * a)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    godRays(ctx, w, h, p.rays, d);
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
    if (p.leak > 0) {   // light that got into the camera: a red-orange glow from one side, burning to yellow at its heart
      const left = rand(640) > 0.5, x = left ? w * 0.02 : w * 0.98, y = h * (0.25 + rand(641) * 0.5), R = Math.max(w, h) * (0.3 + 0.35 * p.leak);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, css([255, 236, 170], 0.95 * p.leak)); g.addColorStop(0.22, css([255, 132, 52], 0.78 * p.leak)); g.addColorStop(0.6, css([214, 44, 56], 0.34 * p.leak)); g.addColorStop(1, css([200, 40, 60], 0));
      const e = ctx.createLinearGradient(left ? 0 : w, 0, left ? w * 0.4 : w * 0.6, 0);   // and burnt in along that edge
      e.addColorStop(0, css([255, 96, 40], 0.75 * p.leak)); e.addColorStop(0.45, css([230, 60, 50], 0.25 * p.leak)); e.addColorStop(1, css([230, 60, 50], 0));
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = e; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (p.flare > 0) lensFlare(ctx, w, h, p.flare);
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
  const { C } = env, F = openField(env), R = Math.min((F.y1 - F.y0) * 0.46, (F.x1 - F.x0) * 0.4), cx = F.x1 + R * 1.02 - R * 1.3 * amt, cy = (F.y0 + F.y1) / 2;
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
  theme: (base) => ({ ...base, field: css(bnGround()), text: css(bnInk()), dim: css(bnInk(), 0.55), titleFill: css(bnInk()), titleInk: css(bnGround()), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(bnGround()); ctx.fillRect(0, 0, w, h);
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
  theme: (base) => ({ ...base, field: css(edGround()), text: css(edInk()), dim: css(edInk(), 0.55), titleFill: css(edInk()), titleInk: css(edGround()), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    ctx.fillStyle = css(edGround()); ctx.fillRect(0, 0, w, h);
    if (env.photo) {   // black and white, or a duotone in black and the channel's colour as a spot ink: the mid-tones and lights take the ink
      env.drawPhoto(p.mono); wash(ctx, w, h, "multiply", ED.paper, 0.5 * p.mono);
      if (p.spot > 0) { wash(ctx, w, h, "multiply", mix([255, 255, 255], C, 0.85), p.spot); wash(ctx, w, h, "screen", mix([0, 0, 0], C, 0.22), p.spot); }
      return true;
    }
    if (!L.grid) return true;
    if (p.numeral > 0) {   // the issue number, very large and very quiet, where a picture would otherwise go
      const fs = Math.min(w, h) * 0.78;
      ctx.save(); ctx.font = `italic 700 ${fs}px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(C, (dark ? 0.44 : 0.4) * p.numeral);
      ctx.fillText(pad2(env.o.catIndex + 1), w - 60, h * 0.5 + fs * 0.36); ctx.restore();
    }
    edColumns(ctx, env, p);
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
  const G = env.G, split = G.template === "split", foot = split || G.flipped ? env.h - 110 : Math.min(G.accent[0][1], G.accent[1][1]) - 36;
  let x = box.x, w = box.w;
  if (env.cover.tag && !G.flipped) {
    const f = G.tag.fs * 0.82;
    ctx.save(); ctx.font = `900 ${f}px ${fonts.serif}`; const seal = spacedW(ctx, env.cover.tag, 4) + f * 0.9 + 44; ctx.restore();
    x += seal; w = Math.max(200, w - seal);
  }
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
  const A = !T || !base ? null : p.vertical ? titleBlockVertical(ctx, env.cover.title, songBox(ctx, env, base), T.font ? `"${T.font}", ${fonts.serif}` : fonts.serif, 900, 300) : titleArea(ctx, env);
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
    { kind: "white", s: 92, cx: w - 102 - 70, cy: 150 + rand(671) * 60, r: at(0, 0.4) },
    { kind: "red", s: 78, cx: 64 + 60 + rand(672) * 40, cy: (F.y0 + F.y1) * 0.5 - 40 + rand(673) * 60, r: at(0.3, 0.7) },
    { kind: "round", s: 70, cx: w * (0.56 + rand(674) * 0.1), cy: F.y1 - 70 - rand(675) * 60, r: at(0.6, 1) },
  ];
  for (const [i, q] of seals.entries()) {
    if (q.r <= 0) continue;
    x.save(); x.globalAlpha = 0.85 * Math.min(1, q.r * 2); x.translate(q.cx, q.cy); x.rotate((rand(676 + i) - 0.5) * 0.08);
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
  seeded: true,
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
  theme: (base) => ({ ...base, field: css(SONG.paper), text: css(SONG.ink), dim: css(SONG.ink, 0.6), titleFill: css(SONG.ink), titleInk: css(SONG.paper), grid: () => "rgba(0,0,0,0)" }),
  background(ctx, env, L, p) {
    const { w, h } = env;
    ctx.fillStyle = css(SONG.paper); ctx.fillRect(0, 0, w, h);
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
    return drawTitleVertical(ctx, title, songBox(ctx, env, box), { font: fonts.serif, fill: L.ink || css(SONG.ink), hi: L.hi || css(SONG.red), maxFs: 300, weight: 900 });
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
  params: [
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "积云", en: "Cumulus" } },
    { key: "town", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "街景与高塔", en: "Town and towers" } },
    { key: "flags", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "彩旗", en: "Pennants" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "明信片边框", en: "Postcard border" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vivid", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "照片鲜艳度", en: "Photo vividness" } },
  ],
  theme: (base) => ({ ...base, field: css(VV.sky), text: css(VV.cream), dim: css(VV.cream, 0.72), titleFill: css(VV.cream), titleInk: css(VV.navy), grid: () => "rgba(0,0,0,0)" }),
  /**
   * One flat azure sky. With the background's decoration on, from the back: a tower or two of the sky
   * city, clouds massed round their feet and on both sides, the street on the horizon, and pennants.
   * The horizon is the top edge of the colour field when the field is below (it becomes the ground in
   * front), else the foot of the picture. A photo is laid over the sky and made more vivid: once more
   * over itself in soft light, its saturation pushed up, and the whole warmed as by late sun.
   */
  background(ctx, env, L, p) {
    const { w, h } = env;
    ctx.fillStyle = css(VV.sky); ctx.fillRect(0, 0, w, h);
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
    const mass = (fx, k, size, tall, grow) => { if (grow <= 0) return; const x = w * fx, s = Math.min(u * size * (0.1 + 0.9 * grow), room(x) / (0.86 * tall + 0.62)); if (s > u * 0.025) billow(ctx, x, ground(x), s, tall, k); };
    // far off, behind the towers
    mass(0.36 + rand(131) * 0.24, 132, 0.1, 0.9, ramp(c, 0.25, 0.5));
    mass(0.26 + rand(133) * 0.1, 134, 0.16, 1.15, ramp(c, 0.4, 0.65));
    mass(0.5 + rand(135) * 0.1, 136, 0.12, 1.05, ramp(c, 0.55, 0.8));
    mass(0.4 + rand(137) * 0.1, 138, 0.13, 1.3, ramp(c, 0.85, 1));
    // The towers rise from behind the horizon as the slider goes up: the first from 0.3, full at 0.7;
    // the second from 0.65, full at 1. Their feet are hidden by the colour field and the houses.
    const t1 = ramp(t, 0.3, 0.7), t2 = ramp(t, 0.65, 1), tx = w * (0.58 + rand(141) * 0.12), tw = u * (0.05 + 0.02 * t), th = Math.max(u * 0.1, at(tx) - top * (0.3 - 0.12 * t));
    if (t2 > 0) { const sx = tx + w * (rand(142) > 0.5 ? 0.1 : -0.1), sw = tw * 0.7, sh = th * 0.62; skyTower(ctx, sx, at(sx) + (1 - t2) * (sh + sw * 1.6), sw, sh); }
    if (t1 > 0) skyTower(ctx, tx, at(tx) + (1 - t1) * (th + tw * 1.6), tw, th);
    // near, in front of the towers: a great mass on each side, then more toward the edges
    mass(0.06 + rand(151) * 0.2, 152, 0.34, 1.5 + rand(153) * 0.4, ramp(c, 0, 0.4));
    mass(0.72 + rand(154) * 0.2, 155, 0.31, 1.7 + rand(156) * 0.5, ramp(c, 0.08, 0.5));
    mass(0.93 + rand(158) * 0.08, 159, 0.2, 1.3, ramp(c, 0.7, 0.9));
    mass(0.61 + rand(141) * 0.12, 157, 0.17, 0.85, Math.min(ramp(c, 0.15, 0.45), t1 * 2));   // round the tower's foot
    if (t > 0) skyline(ctx, w, h, t, at);
    if (p.flags > 0) pennants(ctx, w, top, p.flags);
    return true;
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
 * The box the title will fill, set the usual way in the layout's place (for a look's background to
 * keep clear of it), or null when it is hidden or empty. A move of the title layer is not counted.
 */
function titleArea(ctx, env) {
  const T = titleLayer(env), box = titleBase(env);
  if (!T || !box || typeof ctx.measureText !== "function") return null;
  const face = current.titleFont ? current.titleFont(fonts) : fonts.cn;
  return titleBlock(ctx, env.cover.title, box, T.font ? `"${T.font}", ${face}` : face);
}
/** The title layer, when it shows. */
const titleLayer = (env) => (env.cover && env.cover.layers.find((l) => l.type === "title" && l.visible)) || null;
/** The box the layout gives the title, as render.js hands it to the title's painter. */
function titleBase(env) {
  const G = env.G;
  if (!G) return null;
  const top = G.titleTop ?? (env.hasBrand ? 150 : 84);
  return { x: G.title.x, y: top, w: G.title.w, h: G.title.h + (G.title.y - top) };
}
/** The top of the channel graphic, as the layout places it, when it stands under the span x0–x1 (else Infinity), less a margin. */
function graphicTop(env, x0, x1) {
  const A = env.G && env.G.art, on = env.graphic && env.cover && env.cover.layers.some((l) => l.type === "graphic" && l.visible);
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
 * Paints draw() as a soft blur of `colour`, `r` units across: a shadow cast from far off the canvas,
 * since a filter cannot be relied on. What draw() paints itself lands off the canvas.
 */
function blurred(ctx, r, colour, draw) {
  const m = ctx.getTransform(), D = 30000;
  ctx.save(); ctx.shadowColor = colour; ctx.shadowBlur = Math.max(0.1, r * Math.hypot(m.a, m.b)); ctx.shadowOffsetX = D * m.a; ctx.shadowOffsetY = D * m.b;
  ctx.translate(-D, 0); draw(); ctx.restore();
}
/**
 * The channel graphic as a flat silhouette: opaque white where it is solid, its soft ground shadow and
 * half-clear parts left out, on a canvas 1200 px square covering ±330 units; `box`: its solid part, in
 * units. Kept per look and graphic (a look's line work changes the outline a little).
 */
function graphicShape(env) {
  const g = env && env.graphic;
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
  if (x1 < 0) return null;
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
  repaint: (c) => `a minimalist film poster made from a photograph: hard black-and-white with crushed blacks and clean whites, printed over a flat vermilion red, high contrast, a little screen-print roughness; the subject read as a bold silhouette; still the same picture, no text.`,
  about: { zh: "红黑负形海报：索尔·巴斯和波兰海报学派的路子——红、黑、米白三色，一个巨大的剪影承载全部意思（用的是频道图形的轮廓，被画面边缘裁切），剪影和底色互相咬合，空出来的形和画出来的形一样有分量；可加一块反色的负形分割、聚光光束、牵引的细线；标题小而精确，底部几行演职员小字，丝网印刷的粗糙质感。可选红底黑形或黑底红形，也可以用频道色代替红色。冷峻、有隐喻、一眼就懂——适合电影、书评、社会议题、悬疑与观点类内容。", en: "A red-and-black negative-space poster, after Saul Bass and the Polish poster school: red, black and off-white; one huge silhouette carries the idea (the channel graphic's outline, cropped by the edge), cut against the ground so the shapes between read as much as the shapes; optionally a reversed split, a spotlight beam, taut threads; a small exact title, a few lines of credits, the roughness of a screen print. Black on red or red on black, and the channel colour can stand in for the red. Stark, metaphorical, read at a glance — for film, books, social issues, mysteries, opinion." },
  name: { zh: "负形海报", en: "Negative space" },
  seeded: true,
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
  theme: (base, C) => ({ ...base, field: css(negGround(C)), text: css(NEG.cream), dim: css(NEG.cream, 0.6), titleFill: css(NEG.cream), titleInk: css(NEG.black), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground; the giant silhouette in a deeper shade of the ground (tone on tone, so the channel
   * graphic in front of it stays the thing that is read); a region of the other colour cut in along a
   * slanted edge (the reversed split), in which the silhouette turns into the ground's colour — a
   * negative, sharp where it crosses; a beam of light from above; threads drawn taut to it. A photo
   * goes hard black and white, printed over the red.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = negGround(C), ink = negInk(C), spot = negSpot(C);
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
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
    const S = graphicShape(env), at = negPlace(env, p), F = at.F;
    // the reversed split: its leaning edge sweeps in from the far side as the slider goes up, across the
    // silhouette (through its middle at 0.5), so that more and more of the figure reads in reverse
    let split = null;
    if (p.cut > 0) {
      const x0 = Math.min(w + h * 0.2, at.cx + at.size * 0.55 * (1 - 2 * p.cut)), lean = h * 0.12 * (rand(183) > 0.5 ? 1 : -1);
      split = [[x0 + lean, 0], [w, 0], [w, h], [x0 - lean, h]];
      shapeOf(ctx, split); ctx.fillStyle = css(ink); ctx.fill();
    }
    if (p.beam > 0) {   // a cone of light from above, onto the silhouette, with a few brighter rays in it
      const bx = at.cx, spread = w * (0.12 + 0.2 * p.beam), g = ctx.createLinearGradient(0, 0, 0, h);
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
  accent: { fill: (C) => css(dark ? negSpot(C) : NEG.black), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a flat block of the other colour
  /**
   * Upright and flat: warm off-white letters. Highlighted words are set reversed out of a bar of the
   * other colour (red on black, black on red), so they read on the ground, the block and the silhouette alike.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, bar = o.hi || (dark ? negSpot(o.C || NEG.red) : NEG.black);
    pass((a, x) => { if (a.hi) { ctx.fillStyle = css(bar); ctx.fillRect(x - fs * 0.04, -fs * 0.86, ctx.measureText(a.t).width + fs * 0.08, fs * 1.02); } });
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
/** The ground without the silhouette: the colour, the light behind where the figure stands, the landscape in layers. */
function cineGroundPaint(ctx, env, p, at) {
  const { w, h, C } = env, ground = cineGround(C), u = Math.min(w, h), F = at.F;
  ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
  const top = ctx.createLinearGradient(0, 0, 0, h);   // a little deeper at the top, as a dusk sky
  top.addColorStop(0, css(mix(ground, CINE.night, dark ? 0.45 : 0.22))); top.addColorStop(0.6, css(ground, 0));
  ctx.fillStyle = top; ctx.fillRect(0, 0, w, h);
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
  repaint: (c) => `a minimalist movie poster made from a photograph: muted, moody colour (a dusky version of ${c}), soft light from behind the subject, the subject reading as a dark silhouette, worn paper texture, a gentle vignette, cinematic and quiet; still the same picture, no text.`,
  about: { zh: "极简电影海报：从频道色里取一个沉静的颜色（赭石、暮紫、灰蓝、墨绿），一个深色剪影（频道图形的轮廓）站在画面里，身后一团柔光，远处的山峦一层层淡出去，皱纸纹理、暗角和褪色，细而疏朗的衬线标题，底部一块演职员表；有照片时可以把照片装进剪影，做成双重曝光。安静、有故事感、电影感强——适合影评、书评、人物故事、纪录片与情绪向内容。", en: "The minimal movie poster: a quiet colour drawn from the channel's (ochre, dusk violet, slate, deep green), a dark silhouette (the channel graphic's outline) standing in it with a soft light behind, ridges fading back in layers, crumpled paper, a vignette and fade, a thin spaced serif title and a credits block at the foot; with a photo, the photo can go inside the silhouette as a double exposure. Quiet, story-led, cinematic — for film and book reviews, portraits, documentaries, mood pieces." },
  name: { zh: "极简电影", en: "Minimal film poster" },
  seeded: true,
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
  theme: (base, C) => ({ ...base, field: css(cineGround(C)), text: css(cineText()), dim: css(cineText(), 0.6), titleFill: css(cineText()), titleInk: css(cineGround(C)), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground, its light and ridges, and the silhouette. A photo is toned toward the ground's colour;
   * one that fills the canvas can show only inside the silhouette: the ground is painted again over
   * it, with the silhouette cut out of it.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, at = cinePlace(env, p);
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
    cineGroundPaint(ctx, env, p, at);
    if (!L.grid) return true;
    const S = p.giant > 0 && graphicShape(env);
    if (S) placeShape(ctx, S, cineShade(C), at.cx, at.cy, at.size);
    return true;
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
  theme: (base) => ({ ...base, field: css(cyaGround()), text: css(cyaInk()), dim: css(cyaInk(), 0.6), titleFill: css(cyaInk()), titleInk: css(cyaGround()), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The blue (or the paper), brushed unevenly; soft airbrushed shapes; the channel graphic left white
   * and glowing; sparkles. A photo becomes a cyanotype: grey, its darks into Prussian blue, its lights
   * left white, and the halftone over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = cyaGround();
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
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
    ctx.font = `italic 400 40px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillText(pad2(i + 1), w - 60, 92);
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
  repaint: (c) => `a grainy black-and-white film still made from the photograph: deep blacks, soft silver highlights, a little motion blur, heavy film grain, a dreamy cinematic haze; still the same picture, no colour, no text.`,
  about: { zh: "黑白胶片：粗颗粒的黑白电影剧照排成一本杂志——光雾和失焦的光斑，频道图形化成一道带动态残影的灰色身影，照片被裁下几块错开拼回去（其中一两块染成频道色，那是画面里唯一的颜色），纸张对折的折痕，灰尘，成栏的小字，衬线标题带一层失焦的柔光。可选黑底或灰白纸底。安静、文艺、有胶片的呼吸感——适合人物、音乐、电影、时尚、随笔与回忆。", en: "Monochrome film: grainy black-and-white stills laid out as a magazine — haze and out-of-focus light, the channel graphic as a grey figure trailing a motion blur, the photo cut into fragments set back a little off (one or two in the channel colour, the only colour there is), a sheet folded in four, dust, columns of small print, a serif title with a soft blur round it. Black or pale paper. Quiet, literary, breathing like film — for portraits, music, film, fashion, essays and memories." },
  name: { zh: "黑白胶片", en: "Monochrome film" },
  seeded: true,
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
  theme: (base) => ({ ...base, field: css(mfGround()), text: css(mfInk()), dim: css(mfInk(), 0.55), titleFill: css(mfInk()), titleInk: css(mfGround()), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground with its haze and out-of-focus lights, and the channel graphic as a soft grey figure in
   * motion. A photo goes black and white, smeared sideways (the motion blur), and a few pieces of it are
   * cut out and set back a little off, one tinted with the channel colour.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), ground = mfGround();
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
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
      const lx = w * (0.25 + rand(330) * 0.5), ly = h * (0.2 + rand(331) * 0.3), lit = dark ? [190, 190, 186] : [255, 255, 255];
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
    ctx.textAlign = "right"; ctx.fillText((P.brand.name || "").toUpperCase(), w - 60, 62);
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
  theme: (base) => ({ ...base, field: css(tyGround()), text: css(tyInk()), dim: css(tyInk(), 0.55), titleFill: css(tyInk()), titleInk: css(tyGround()), grid: () => "rgba(0,0,0,0)" }),
  /** The sheet, a burst of hairlines, dry-brush strokes, giant letters cut across. A photo goes hard black and white. */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = tyGround(), ink = tyInk(), F = openField(env);
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
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
      const bx = F.x0 + (F.x1 - F.x0) * 0.62, by = F.y0 + (F.y1 - F.y0) * 0.55, n = Math.round(40 + 260 * p.burst), R = Math.hypot(w, h);
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
  const lx = at.cx + side * Math.min(fw * 0.26, at.R * 1.4), ly = F.y0 + fh * 0.1, spread = fh * (0.16 + 0.12 * amt);
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
  repaint: (c) => `a fan-made alternative poster for an animated film, made from the photograph: one strong flat colour (${c}), the subject reduced to bold flat shapes and a clean silhouette, a warm sunset glow, simple graphic light, a little screen-print speckle; playful and warm; still the same picture, no text.`,
  about: { zh: "动画电影的另类海报：一整块浓烈的颜色（从频道色来），天边一轮带复古条纹的大夕阳，频道图形站在它下方，还可以在太阳前立起一个巨大的同形剪影；放射光芒、路灯投下的光柱、一列越来越小的同一个身影、一条蜿蜒的小路和路上的小旅人、星空；丝网印刷的斑驳和海报的白边。温暖、童趣、一张图讲一个故事——适合动画、亲子、旅行、成长、治愈和节日内容。可选亮色底或深色底；自带平直的版式。", en: "The alternative poster for an animated film: one strong colour (from the channel's), a big striped setting sun hanging over where the channel graphic stands, and if you like its huge silhouette in front of the sun; a sunburst, a lamp's beam, a procession of the same figure growing smaller, a winding road with a tiny traveller, stars; the speckle of a screen print and a white margin. Warm, playful, a story in one picture — for animation, family, travel, growing up, feel-good and festive content. A bright or a deep ground; flat layouts of its own." },
  name: { zh: "动画海报", en: "Animated film poster" },
  seeded: true,
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
  theme: (base, C) => ({ ...base, field: css(toonGround(C)), text: css(toonText(C)), dim: css(toonText(C), 0.6), titleFill: css(toonText(C)), titleInk: css(toonGround(C)), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground; a sunburst and stars; the setting sun behind where the channel graphic stands; the
   * giant silhouette against it; a lamp's beam, a winding road, a procession. A photo goes into the
   * ground's colour; one filling the canvas still gets the stars, the sun and the beam.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = toonGround(C), at = toonPlace(env, p);
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
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
    if (S && p.giant > 0) placeShape(ctx, S, toonFigure(C), at.gx, at.gy, at.size);   // the hero, huge and dark against the sun
    toonBeam(ctx, env, at, p.beam);
    toonRoad(ctx, env, at, p.road, S);
    toonParade(ctx, env, at, p.parade, S);
    return true;
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
  repaint: (c) => `a contemporary fashion and design-studio poster made from the photograph: black and white, soft and slightly out of focus, a little motion blur, fine grain, clean studio light, with one small accent of ${c}; still the same picture, no text.`,
  about: { zh: "先锋影像：今天的设计工作室和时装品牌常发的海报。黑白照片（没有照片时，频道图形化成一个柔焦的身影），像设计师在电脑里那样加工：动态拖影、辉光、焦外虚化里留一个清晰的对焦框、一块变成大像素的马赛克、一片条纹玻璃、一条透出频道色的色带；细线网格、圆点标记和界面式的小字；紧凑的大号无衬线标题；频道色是唯一的点缀。冷静、锐利、有数码时代的质感——适合设计、时尚、科技、人物、观点和品牌内容。可选浅灰底或黑底；自带平直的版式。", en: "Avant-garde image: the posters design studios and fashion labels post today. A black-and-white photograph (or, without one, the channel graphic as a soft figure) worked on as a designer would in the computer: a smear of motion, a glow, out of focus with one sharp frame of focus, a patch gone to large pixels, a panel of fluted glass, a band where the channel colour comes through; hairline grid lines, dot markers and interface-like labels; a big tight grotesque; the channel colour the only accent. Cool, sharp, digital — for design, fashion, tech, portraits, opinion and brand content. A light grey or a black ground; flat layouts of its own." },
  name: { zh: "先锋影像", en: "Avant-garde image" },
  seeded: true,
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
  theme: (base) => ({ ...base, field: css(avGround()), text: css(avInk()), dim: css(avInk(), 0.55), titleFill: css(avInk()), titleInk: css(avGround()), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground (a studio backdrop, lighter in the middle) and the figure, or the photo in black and
   * white; then, in order, the motion smear, the glow, the blur with its frame of focus, the fluted
   * glass, the mosaic, the colour band (a clear window onto the picture before the blur and the glass)
   * and the fade — each working on what is there so far, so the lettering and everything above stays
   * sharp. A print photo is only turned black and white.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = avGround();
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
    let box;
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (!L.fill) return true;
      box = { cx: w * 0.55, cy: h * 0.5, size: h * 0.9 };
    } else {
      if (!L.grid) return true;
      const g = ctx.createRadialGradient(w * 0.6, h * 0.42, 0, w * 0.6, h * 0.42, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, css(dark ? [44, 44, 48] : [244, 244, 242])); g.addColorStop(1, css(ground));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      box = avFigure(ctx, env, p);
    }
    avSmear(ctx, u, p.smear);
    avGlow(ctx, p.glow);
    const sharp = canPaint(ctx) && (p.blur > 0 || p.band > 0 || p.mosaic > 0) ? snap(ctx, "avSharp") : null;   // the picture before the blur and the glass: the frame of focus, the mosaic and the band show it
    avFocus(ctx, env, box, p.blur, p.focus, sharp);
    avGlass(ctx, env, box, p.glass);
    avMosaic(ctx, env, box, u, p.mosaic, sharp);   // over the glass, so its cells stay square
    avBand(ctx, env, box, p.band, sharp);
    if (p.fade > 0) { const f = ctx.createLinearGradient(0, h * 0.45, 0, h); f.addColorStop(0, css(ground, 0)); f.addColorStop(1, css(ground, Math.min(1, p.fade * 1.1))); ctx.fillStyle = f; ctx.fillRect(0, 0, w, h); }
    return true;
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

export const LOOKS = { cel, cyber, riso, anime, bluenote, editorial, songke, vivid, negative, cinema, cyano, monofilm, typo, toon, avant };
export const LOOK_IDS = Object.keys(LOOKS);

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
/** The context graphics and the small cover parts should draw on under the current look. */
export const styled = (ctx, C, plates = false) => (current.wrap ? current.wrap(ctx, C, values, plates) : ctx);
export { INK, css };
