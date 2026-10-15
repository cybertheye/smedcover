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
const RISO = { paper: [242, 234, 216], blue: [30, 60, 165], pink: [255, 72, 176] };
const riso = {
  id: "riso",
  repaint: (c) => `a risograph print: two or three flat spot inks (${c}, a deep blue and a fluorescent pink) on cream paper, tones made of coarse halftone dots, the inks slightly out of register, visible paper grain; no photographic tones or gradients.`,
  about: { zh: "孔版印刷（Risograph）：米色纸上两三种专色油墨叠印，叠色处变深，套色略有错位，粗网点加纸张颗粒；标题是两色错开的叠印字，图形是纸白加蓝色油墨。温暖、有手作和独立出版的味道——适合设计、阅读、生活方式、手作与小店。", en: "Risograph: two or three spot inks overprinted on cream paper, darker where they overlap, slightly out of register, coarse halftone and paper grain; the title is overprinted in two colours a little apart, objects are paper white and blue ink. Warm, handmade, small-press — for design, books, lifestyle, crafts, small shops." },
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
  repaint: (c) => `a background painting from a hand-painted 1990s anime film: painted sky and clouds, gouache-like scenery, cel-flat colours slightly greyed and warm, soft bloom on the lights, light film grain, with ${c} as an accent.`,
  about: { zh: "九十年代手绘动画、再用胶片拍下来的样子：手绘天空背景，赛璐珞颜色略灰略暖，标题是双层勾边的字，叠上胶片颗粒、柔光、褪色和灰尘划痕。比默认的赛璐珞更旧、更柔、更怀旧——适合旅行、音乐、回忆、季节与日常。", en: "A hand-painted 90s cartoon as film would have caught it: a painted sky, cel colours a little grey and warm, a title with a double keyline, then film grain, bloom, fade, dust and scratches. Older, softer and more wistful than the default Cel — for travel, music, memories, seasons, everyday life." },
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
  repaint: (c) => `the photograph on a 1950s–60s jazz record sleeve: a high-contrast duotone in black and ${c}, deep shadows, coarse grain, large calm areas; still a photograph, with no drawn outlines.`,
  about: { zh: "五六十年代爵士唱片封套：大面积纯色块、紧凑的无衬线大字，没有描边、没有投影，照片处理成单色加黑，编目式的细线和小字；自带平直的版式，可选深色或浅色底。克制、有态度、靠排版取胜——适合音乐、访谈、人物、品牌故事。", en: "Jazz record sleeves of the 50s and 60s: large flat blocks of colour, tight sans-serif headlines with no outline or shadow, photos in one colour and black, catalogue rules and small print; flat layouts of its own, dark or light ground. Restrained, confident, carried by the type — for music, interviews, portraits, brand stories." },
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
  repaint: (c) => `a black-and-white magazine photograph: fine grain, deep blacks, clean highlights, a calm and considered tone; still a photograph, not a drawing.`,
  about: { zh: "杂志内页的编辑设计：衬线标题、粗细双线、细线边框、页眉页码、巨大而安静的期号数字，照片转黑白；自带平直的版式，可选深色或浅色底。安静、讲究、有阅读感——适合深度内容、评论、读书、文化与系列栏目。", en: "The pages of a magazine: a serif headline, thick-and-thin rules, a hairline border, running head and folio, a huge quiet issue number, black-and-white photos; flat layouts of its own, dark or light ground. Quiet, considered, made to be read — for long-form, essays, books, culture, series." },
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
  repaint: (c) => `a woodblock illustration from an old Chinese printed book: black ink lines cut with a knife, flat areas of ink, the ground left as warm paper colour, no shading or colour except perhaps a touch of vermilion; scenery simplified into lines and masses as in Song and Ming book illustrations.`,
  about: { zh: "一页宋版古籍：宣纸底色、竖排的宋体标题、朱砂印章样式的角标、粗细双线的版框和界栏，右侧是带鱼尾的版心，图形像木刻版画，可调做旧与纸张颗粒；自带平直的版式。古雅、沉静、有书卷气——适合历史、国学、读书、传统手艺与节气。", en: "A leaf from a Song-dynasty printed book: paper ground, a serif title set in vertical columns, the corner tag as a vermilion seal, a thick-and-thin border and ruled columns, a centre column with fishtails at the right edge, objects like woodcuts, adjustable age and grain; flat layouts of its own. Classical, calm, bookish — for history, classics, reading, traditional crafts, the seasons." },
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

// ====================================================================== vivid illustration: a city in the clouds, in flat paint
// A saturated animated illustration: one flat, strong azure sky; towering cumulus built of lobe upon
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
 * indigo lines. Their feet go below the horizon, behind the colour field.
 */
function skyline(ctx, w, h, amt, at) {
  const u = Math.min(w, h), most = u * (0.05 + 0.12 * amt), line = css(VV.line), lw = Math.max(1.4, u * 0.0016);
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
    if (rand(i * 4.4 + 95) > 0.45) {   // a tall signboard: a colour, a border and three strokes of lettering
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
/** Strings of pennants across the sky: a sagging line, small flags hanging from it in the city's colours. */
function pennants(ctx, w, top, n) {
  const line = css(VV.line), step = Math.max(26, w / 60);
  for (let s = 0; s < n; s++) {
    const y0 = top * (0.2 + 0.22 * s + rand(s * 7 + 101) * 0.1), y1 = y0 + (rand(s * 5 + 102) - 0.5) * top * 0.2, sag = top * (0.07 + rand(s * 3 + 103) * 0.05);
    const at = (t) => [-20 + (w + 40) * t, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1];
    ctx.beginPath(); for (let t = 0; t <= 1.0001; t += 0.02) { const [x, y] = at(t); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = line; ctx.lineWidth = 1.8; ctx.stroke();
    const count = Math.ceil((w + 40) / step);
    for (let i = 0; i < count; i++) {
      const [ax, ay] = at(i / count), [bx, by] = at((i + 0.7) / count), c = PENNANTS[(i + s * 2) % PENNANTS.length];
      shapeOf(ctx, [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2 + step * 0.95]]); ctx.fillStyle = css(c); ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
}
const vivid = {
  id: "vivid",
  repaint: (c) => `a saturated animated-film illustration of a city in the clouds, pushed to the bold colour of a travel poster: one flat, strong azure sky, towering billowing cumulus clouds painted in hard-edged planes of white, pale blue and periwinkle with fine indigo lines along each lobe, coral-red towers with brass pipes, signboards, lanterns and strings of pennants; every surface in flat, clean colour with crisp edges and fine lines, no gradients; bright and clear, with ${c} as an accent colour.`,
  about: { zh: "高饱和的动画插画：一整块浓烈的天蓝天空，层层翻涌的巨大积云——每一团都是白、淡蓝、长春花蓝三块硬边平涂，再用细细的靛蓝线勾出轮廓；远处是珊瑚红的高塔和黄铜管道、挂着招牌和灯笼的街景，天上拉着成串的三角彩旗。全部是硬边平涂加细线，不用渐变。标题上白下暖黄，配深靛蓝勾边和实心立体投影；可加米白明信片边框，照片调得更鲜艳、更暖。饱和、明亮、细节丰富——适合旅行、城市漫步、生活、美食、节日与治愈系内容。", en: "A saturated animated illustration: one strong azure sky, huge billowing cumulus — every lobe in three hard-edged planes of white, pale blue and periwinkle, outlined in fine indigo — coral-red towers with brass pipes, a skyline of signboards and lanterns, strings of pennants across the sky. Flat colour and fine lines throughout, never a gradient. The title is white over warm yellow with an indigo keyline and a solid block shadow; a cream postcard border is optional, and photos are made more vivid and warmer. Saturated, bright and full of detail — for travel, city walks, everyday life, food, festivals and feel-good content." },
  name: { zh: "高饱和插画", en: "Vivid illustration" },
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
    const street = t > 0 ? u * (0.03 + 0.07 * t) : 0, ground = (x) => at(x) - street;   // where clouds stand: behind the houses
    const room = (x) => ground(x) - Math.max(top * 0.24, 150);                             // how tall a cloud may be there: clear of the brand row
    const mass = (fx, k, size, tall) => { const x = w * fx, s = Math.min(u * size, room(x) / (0.86 * tall + 0.62)); if (s > u * 0.03) billow(ctx, x, ground(x), s, tall, k); };
    if (c > 0.55) mass(0.36 + rand(131) * 0.24, 132, 0.06 + 0.03 * c, 0.9);              // a small one, far off
    if (t > 0.45) {   // the towers, behind the nearer clouds
      const tx = w * (0.58 + rand(141) * 0.12), tw = u * (0.05 + 0.02 * t), th = Math.max(u * 0.1, at(tx) - top * (0.3 - 0.12 * t));
      skyTower(ctx, tx, at(tx), tw, th);
      if (t > 0.75) { const sx = tx + w * (rand(142) > 0.5 ? 0.1 : -0.1), sw = tw * 0.7; skyTower(ctx, sx, at(sx), sw, th * 0.62); }
    }
    if (c > 0) {
      mass(0.06 + rand(151) * 0.2, 152, 0.17 + 0.17 * c, 1.5 + rand(153) * 0.4);          // a great mass on one side…
      mass(0.72 + rand(154) * 0.2, 155, 0.15 + 0.16 * c, 1.7 + rand(156) * 0.5);          // …and on the other
      if (t > 0.45) mass(0.61 + rand(141) * 0.12, 157, 0.1 + 0.07 * c, 0.85);             // clouds round the tower's foot
    }
    if (t > 0) skyline(ctx, w, h, t, at);
    if (p.flags > 0) pennants(ctx, w, top, p.flags > 0.6 ? 2 : 1);
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

// ====================================================================== blue retro: halftone, glitch and collage in electric blue
// The blue of a cyanotype and of a photocopier's toner, with black and off-white: photographs as coarse
// halftone in one blue, a sprayed grain thinning across the sheet, thin technical drawing (concentric
// rings, a crosshair, crop marks, a barcode), small monospaced data, star marks, a sliced glitch. On an
// electric blue ground (dark) or on off-white paper printed in blue (light).
const BT = { klein: [28, 44, 226], azure: [70, 146, 238], ice: [172, 208, 255], navy: [8, 12, 46], cream: [238, 234, 222] };
const btInk = () => (dark ? BT.cream : BT.klein), btGround = () => (dark ? BT.klein : BT.cream), btDeep = () => (dark ? BT.navy : BT.klein);
/**
 * A field of fine dots, dense near (fx, fy) and thinning out from it — the grain of an airbrush or a
 * spray can — drawn once per size, seed and colour and kept.
 */
function stipple(ctx, w, h, colour, amt, fx, fy) {
  if (amt <= 0 || typeof document === "undefined" || !ctx.canvas) return;
  const key = [Math.round(w), Math.round(h), colour.join(), Math.round(amt * 20), seed, Math.round(fx), Math.round(fy)].join("|");
  const kept = WORK.stipple || (WORK.stipple = new Map());
  let c = kept.get(key);
  if (!c) {
    c = document.createElement("canvas"); c.width = Math.round(w); c.height = Math.round(h);
    const x = c.getContext("2d"); x.fillStyle = css(colour);
    let s = ((seed + 1) * 7919) >>> 0;
    const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296, R = Math.hypot(w, h) * 0.8, n = Math.round(((w * h) / 20) * amt);
    for (let i = 0; i < n; i++) { const px = next() * w, py = next() * h, d = Math.hypot(px - fx, py - fy) / R; if (next() < Math.pow(Math.max(0, 1 - d), 2.4)) x.fillRect(px, py, 2.2, 2.2); }
    kept.set(key, c);
    if (kept.size > 8) kept.delete(kept.keys().next().value);
  }
  ctx.drawImage(c, 0, 0, w, h);
}
/** A halftone screen laid over what is there: dots of `colour` on a diagonal grid, multiplied in. */
function dotScreen(ctx, w, h, colour, alpha, pitch = 9) {
  if (alpha <= 0 || typeof document === "undefined" || !ctx.canvas) return;
  const key = `${colour.join()}|${pitch}`;
  let c = WORK.dots;
  if (!c || c._key !== key) {
    c = WORK.dots = document.createElement("canvas"); c.width = c.height = pitch * 2; c._key = key;
    const x = c.getContext("2d"); x.fillStyle = css(colour);
    for (const [px, py] of [[0.5, 0.5], [1.5, 1.5]]) { x.beginPath(); x.arc(px * pitch, py * pitch, pitch * 0.36, 0, TAU); x.fill(); }
  }
  ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = ctx.createPattern(c, "repeat"); ctx.fillRect(0, 0, w, h); ctx.restore();
}
/** A star mark: four points with hollow sides (a sparkle), or five. */
function starMark(ctx, x, y, r, points, colour) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / points, q = i % 2 ? r * (points === 4 ? 0.2 : 0.45) : r; ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q); }
  ctx.closePath(); ctx.fillStyle = css(colour); ctx.fill();
}
/** The technical drawing over the ground: concentric rings about a point, a crosshair through it, graduations, small figures. */
function rings(ctx, w, h, a, ink) {
  const cx = w * (0.58 + rand(111) * 0.24), cy = h * (0.38 + rand(112) * 0.24), R = Math.min(w, h) * 0.5;
  ctx.save(); ctx.strokeStyle = css(ink, 0.5 * a); ctx.fillStyle = css(ink, 0.8 * a); ctx.lineWidth = 1.5;
  for (const k of [0.22, 0.42, 0.64, 0.88, 1.16]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke();
  ctx.beginPath(); for (let d = 0; d < 360; d += 5) { const t = (d * Math.PI) / 180, q = d % 30 ? 8 : 18; ctx.moveTo(cx + Math.cos(t) * R * 0.88, cy + Math.sin(t) * R * 0.88); ctx.lineTo(cx + Math.cos(t) * (R * 0.88 + q), cy + Math.sin(t) * (R * 0.88 + q)); } ctx.stroke();
  ctx.lineWidth = 2.4; ctx.strokeStyle = css(ink, 0.9 * a);
  ctx.beginPath(); ctx.arc(cx, cy, 13, 0, TAU); ctx.moveTo(cx - 28, cy); ctx.lineTo(cx + 28, cy); ctx.moveTo(cx, cy - 28); ctx.lineTo(cx, cy + 28); ctx.stroke();
  ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  [0, 90, 180, 270].forEach((d, i) => { const t = (d * Math.PI) / 180; ctx.fillText(String(d).padStart(3, "0"), cx + Math.cos(t) * R * 0.64 + 6, cy + Math.sin(t) * R * 0.64 - 6); });
  ctx.restore();
}
/** Sliced glitch: a few thin bands of the finished picture moved sideways, clear of the lettering. */
function slices(ctx, amt, unit, hits, k0) {
  const cv = ctx.canvas;
  if (amt <= 0 || fast || !cv || typeof document === "undefined") return;
  const W = cv.width, H = cv.height, kept = hits.filter((t) => LETTERING.includes(t.type)).map((t) => { const a = ((t.r || 0) * Math.PI) / 180, half = Math.abs(t.hw * Math.sin(a)) + Math.abs(t.hh * Math.cos(a)) + 10; return [(t.cy - half) * unit, (t.cy + half) * unit]; });
  const clear = (y, bh) => kept.every(([a, b]) => y + bh < a || y > b), band = WORK.band || (WORK.band = document.createElement("canvas"));
  for (let k = 0; k < Math.round(5 * amt); k++) {
    const bh = Math.round((6 + rand(k * 3.7 + k0) * 26) * unit), dx = Math.round((rand(k * 5.1 + k0 + 1) - 0.5) * 2 * 46 * unit * amt);
    let y = Math.round(rand(k * 7.3 + k0 + 2) * H);
    for (let again = 1; again <= 12 && !clear(y, bh); again++) y = Math.round(rand(k * 7.3 + k0 + 2 + again * 13.7) * H);
    if (!clear(y, bh) || bh < 1) continue;
    if (band.width !== W || band.height !== bh) { band.width = W; band.height = bh; }
    const b = band.getContext("2d"); b.globalCompositeOperation = "copy"; b.drawImage(cv, 0, y, W, bh, 0, 0, W, bh);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(band, dx, y); ctx.restore();
  }
}
const bluetone = {
  id: "bluetone",
  repaint: (c) => `a retro blue poster made from a photograph: the photo as a coarse halftone print in one electric cobalt blue with black and off-white, high contrast, sprayed grain, a few sliced glitch offsets, thin technical lines; the look of a cyanotype or a photocopied zine; still the same picture, no text.`,
  about: { zh: "蓝调复古的做旧海报：电光蓝、黑和米白三色，照片变成单一蓝色的粗网点印刷，喷枪颗粒从画面一角弥漫开，细线画的同心圆、准星、裁切标记和条形码，等宽的小字和编号，星形符号，几道故障切片；标题用衬线字，带一层错位的影子和一道横向切开的错位。可选电光蓝底或米白纸底。冷静、疏离、有亚文化和科幻感——适合音乐、电影、科技、情绪向和实验性内容。", en: "A worn retro poster in blue: electric blue, black and off-white; photos as coarse halftone in a single blue; sprayed grain spreading from a corner; thin technical drawing — concentric rings, a crosshair, crop marks, a barcode — with small monospaced data and star marks, and a few sliced glitches. The title is a serif with a misregistered shadow and one horizontal slice knocked sideways. An electric blue ground or off-white paper. Cool, distant, subcultural and a little sci-fi — for music, film, tech, mood pieces and experiments." },
  name: { zh: "蓝调复古", en: "Blue retro" },
  seeded: true,
  params: [
    { key: "dots", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "网点与喷砂", en: "Halftone and spray" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "故障切片", en: "Glitch slices" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "技术线条", en: "Technical lines" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "颗粒", en: "Grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片单色", en: "Photo in blue" } },
  ],
  titleFont: (f) => f.serif,
  theme: (base) => ({ ...base, field: css(btGround()), text: css(btInk()), dim: css(btInk(), 0.6), titleFill: css(btInk()), titleInk: css(btDeep()), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The ground (electric blue, or paper), sprayed from below with the deep blue, with the technical
   * drawing and a few star marks over it. A photo goes into one blue: grey, multiplied into the blue,
   * its blacks lifted to navy, and a halftone screen laid over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env;
    ctx.fillStyle = css(btGround()); ctx.fillRect(0, 0, w, h);
    if (env.photo) {
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], dark ? BT.azure : BT.klein, 0.92), p.duo);
      wash(ctx, w, h, "screen", mix([0, 0, 0], [16, 22, 92], 1), p.duo * 0.8);
      dotScreen(ctx, w, h, BT.navy, 0.45 * p.dots);
      return true;
    }
    if (!L.grid) return true;
    stipple(ctx, w, h, btDeep(), p.dots, w * (0.2 + rand(121) * 0.6), h * 1.08);
    if (p.lines > 0) rings(ctx, w, h, p.lines, btInk());
    for (let i = 0; i < 3; i++) starMark(ctx, w * (0.08 + rand(i * 3.3 + 125) * 0.84), h * (0.12 + rand(i * 4.1 + 126) * 0.5), 14 + rand(i * 5.9 + 127) * 26, 4, dark ? BT.cream : BT.klein);
    starMark(ctx, w * (0.15 + rand(128) * 0.7), h * (0.2 + rand(129) * 0.45), 30 + rand(130) * 30, 5, dark ? BT.ice : BT.azure);
    return true;
  },
  accent: {
    fill: () => css(btDeep()),
    tone: () => css(dark ? BT.klein : BT.azure), toneScale: 0.95,    // a halftone across the block
    /** An off-white hairline on the edge, a dashed one beside it: the edge of a printed panel. */
    edge(ctx, run, nx, ny) {
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.strokeStyle = css(BT.cream); ctx.lineWidth = 3; run(0, 0);
      ctx.setLineDash([16, 10]); ctx.lineWidth = 2; run(nx * 14, ny * 14); ctx.setLineDash([]);
    },
  },
  /**
   * Upright lettering with a misregistered shadow — the same letters in a second blue, a little to the
   * right and below — and one horizontal slice through the line knocked sideways, as by a glitch.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || btInk(), hi = o.hi || (dark ? BT.ice : BT.navy), echoCol = dark ? BT.navy : BT.azure;
    const d = fs * 0.05 * o.shadowAmt, g = fast ? 0 : fs * 0.08 * (p.glitch ?? 0.5);
    const paint = (dx) => {
      if (d > 0) pass((a, x) => { ctx.fillStyle = css(echoCol); ctx.fillText(a.t, x + dx + d, d * 0.6); });
      pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x + dx, 0); });
    };
    if (!g) return paint(0);
    const y0 = -fs * 0.6, y1 = -fs * 0.46;
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -1e5, 2e5, 1e5 + y0); ctx.rect(-1e5, y1, 2e5, 1e5); ctx.clip(); paint(0); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, y0, 2e5, y1 - y0); ctx.clip(); paint(g); ctx.restore();
  },
  /** The plate under a text layer: a flat panel with a hairline frame printed a little off it. */
  plate(ctx, x, y, w, h, colour, fs) {
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(btInk()); ctx.lineWidth = Math.max(1.5, fs * 0.02); ctx.strokeRect(x + fs * 0.08, y + fs * 0.08, w, h);
  },
  // objects are printed in the blues; the small cover parts keep their construction, in off-white
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: BT.cream }, stroke: { ink: BT.cream } }
    : { fill: { ink: BT.navy, light: BT.cream, mid: BT.ice, dark: BT.klein, colour: (c) => (lum(c) > 0.55 ? BT.ice : BT.azure) }, stroke: { ink: BT.navy, light: BT.cream }, line: 0.7 }),
  sticker: painters({ line: BT.navy, lineScale: 0.45, join: "miter",
    tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const r = role(c); return css(r === "ink" ? BT.navy : r === "light" ? BT.cream : r === "colour" ? (lum(c) > 0.55 ? BT.ice : BT.azure) : c, c[3]); },
    shadow(ctx, draw) { ctx.save(); ctx.translate(-5, 4); draw(css(dark ? BT.navy : BT.azure, 0.9)); ctx.restore(); } }),
  /** The corner tag: an off-white label with a hairline, three square bullets and monospaced lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.72;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const sq = f * 0.42, step = sq * 1.5, tw = spacedW(ctx, str, 4), w = f * 0.9 + step * 3 + f * 0.3 + tw, h = f * 1.7, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(BT.cream); ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = css(BT.navy); ctx.lineWidth = 2; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = css(BT.navy); for (let i = 0; i < 3; i++) ctx.fillRect(x + f * 0.45 + i * step, top + h / 2 - sq / 2, sq, sq);
    ctx.fillStyle = ink || css(BT.navy); spaced(ctx, str, x + f * 0.45 + step * 3 + f * 0.3, top + h * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: crop marks in the corners, a line of data at the foot, a barcode, the archive's name up the right edge. */
  frame(ctx, env, p) {
    const a = p.lines;
    if (a <= 0) return;
    const { w, h } = env, ink = btInk(), P = env.o.profile, i = env.o.catIndex, total = P.categories.length, code = (env.cat.code || "CH").toUpperCase();
    ctx.save(); ctx.strokeStyle = css(ink, 0.9 * a); ctx.fillStyle = css(ink, 0.9 * a); ctx.lineWidth = 1.6;
    for (const [x, y, sx, sy] of [[30, 30, 1, 1], [w - 30, 30, -1, 1], [30, h - 30, 1, -1], [w - 30, h - 30, -1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * 32); ctx.lineTo(x, y); ctx.lineTo(x + sx * 32, y); ctx.stroke(); }
    ctx.font = `600 14px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    spaced(ctx, `${env.o.size.w}×${env.o.size.h}  //  ${code}  //  ${pad2(i + 1)}.${pad2(total)}`, 72, h - 44, 2);
    let x = w - 72;
    for (let k = 0; k < 30; k++) { const bw = 1.5 + Math.floor(noise(k * 2.9 + i) * 3) * 1.5; x -= bw + 2.5; ctx.fillRect(x, h - 76, bw, 26); }
    ctx.font = `600 11px ${fonts.mono}, ${fonts.cn}`;
    spaced(ctx, `4 ${String(7210 + i * 37).padStart(6, "0")} ${pad2(total)}`, x, h - 38, 2);   // the figures under the bars, from their left end
    ctx.save(); ctx.translate(w - 44, h * 0.62); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`;
    spaced(ctx, `${(P.brand.name || "ARCHIVE").toUpperCase()} ARCHIVE — NO.${pad2(i + 1)} — OBSERVATION SERIES`, 0, 0, 3);
    ctx.restore(); ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(dark ? BT.navy : BT.azure, 0.9); ctx.shadowBlur = 0; ctx.shadowOffsetX = -7 * unit; ctx.shadowOffsetY = 5 * unit; },
  post(ctx, w, h, C, p, unit = 1, hits = []) {
    slices(ctx, p.glitch, unit, hits, 160);
    grain(ctx, p.grain * (dark ? 0.85 : 0.9), unit, !dark);
  },
  prompt: `Stickers for a retro blue zine — cut from a cyanotype or a photocopy, printed in one electric blue with black and off-white — that read at a glance:
- graphic, slightly cold shapes with a strong silhouette: stars, sparkles, planets, an astronaut's helmet, eyes, hands, flowers, arrows, technical symbols; no realism, no perspective, no fine texture;
- flat colour only, and only the blues: the main colour, "blue", "white" (off-white paper) and "ink" (near-black navy); the app turns any other colour into a blue;
- the app adds a thin navy outline and a misregistered blue shadow: do NOT draw outlines or shadows yourself;
- pattern inside a shape is welcome as a few "detail" lines (rings, grids, crosshairs).`,
  solidPrompt: `Objects as a retro sci-fi zine would show them: a few boxes and cylinders in clean, technical proportions — a radio, a camera, a satellite, a monitor; no realism, no fine detail.
- the renderer prints faces in off-white, pale blue and electric blue with a thin navy line: do NOT try to draw shading or outlines yourself;
- "white" is off-white, "dark" is electric blue, and "main" comes out a lighter blue — use it for screens, lenses and lit parts.`,
};

// ====================================================================== red street: music posters and street fashion in red, black and white
// A red ground, heavy condensed black lettering set tight and big, photographs in black and white or in
// red, a giant word in a deeper red cropped by the edge, small editorial print in the margins, a black
// panel, and film grain over all. Loud, rhythmic, with attitude.
const RS = { red: [232, 56, 36], deep: [186, 26, 20], black: [18, 12, 12], cream: [246, 238, 226], yellow: [255, 198, 26] };
const redstreet = {
  id: "redstreet",
  repaint: (c) => `a street-fashion and music poster photograph in red: high contrast, the colours pushed into reds and blacks with warm off-white highlights, a little motion blur and coarse film grain, a stage-light feel; still a photograph, no text.`,
  about: { zh: "红色潮流：街头文化 × 音乐现场 × 时尚大片。大面积朱红底，紧凑的黑色压缩粗体大字（英文用窄体），照片转成黑白或红调，画面一侧压着一个被裁切的深红巨字，页边是细小的编辑式小字和一条黑线，黑色色块，整张叠上胶片颗粒和暗角；自带平直的版式。冲击、有节奏、有态度——适合音乐、潮流服饰、街头品牌、活动海报与人物专访。", en: "Red street: street culture × live music × fashion shoot. A vermilion ground, heavy condensed black lettering set tight and big, photos in black and white or in red, a giant word in deeper red cropped by the edge, small editorial print in the margins with a black rule, a black panel, film grain and a vignette over all; flat layouts of its own. Loud, rhythmic, with attitude — for music, streetwear, street brands, event posters and interviews." },
  name: { zh: "红色潮流", en: "Red street" },
  oneTheme: true,
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "巨字", en: "Giant word" } },
    { key: "micro", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "小字排版", en: "Small print" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "照片红调", en: "Photo in red" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,   // the condensed face for Latin, the heavy sans for CJK
  /**
   * Flat bands and panels, as a poster grid has them. In the stacked layout the title takes the whole
   * red field down to the black panel — the lettering is the picture — and the tag moves onto the
   * panel, above the channel's name.
   */
  layout(template, w, h) {
    const g = blockLayout(template, w, h, { band: 0.34, side: 0.36, strip: 0.13 });
    if (g.template !== "stack") return g;
    const el = g.accent[0][1], tagH = g.tag.fs * 1.34;
    g.title = { ...g.title, h: Math.max(120, el - g.title.y - 44) };
    g.tag = { ...g.tag, y: el + 30 };
    g.cat = { ...g.cat, y: Math.min(h - 70, el + 30 + tagH + 22 + g.cat.fs * 0.82), inline: true };
    return g;
  },
  theme: (base) => ({ ...base, field: css(RS.red), text: css(RS.black), dim: css(RS.black, 0.6), titleFill: css(RS.black), titleInk: css(RS.cream), grid: () => "rgba(0,0,0,0)" }),
  /**
   * The red ground, and on it the channel's code in a deeper red, enormous, running off the right and
   * the foot. A photo goes into black and white, its contrast raised, and then into red: the whites
   * stay warm off-white, the greys turn red, the blacks a deep oxblood.
   */
  background(ctx, env, L, p) {
    const { w, h } = env;
    ctx.fillStyle = css(RS.red); ctx.fillRect(0, 0, w, h);
    if (env.photo) {
      env.drawPhoto(1);
      ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.7; env.drawPhoto(1); ctx.restore();
      wash(ctx, w, h, "multiply", mix([255, 246, 236], [255, 70, 44], p.duo), 1);
      wash(ctx, w, h, "screen", mix([10, 8, 8], [74, 10, 8], p.duo), 1);
      return true;
    }
    if (!L.grid || p.giant <= 0) return true;
    const str = (env.cat.code || env.cat.name || "").toUpperCase().slice(0, 6);
    if (!str) return true;
    const fs = h * (0.95 + 0.45 * p.giant);
    ctx.save(); ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
    ctx.fillStyle = css(RS.deep, 0.3 + 0.6 * p.giant); ctx.fillText(str, w + fs * 0.06, h + fs * 0.1);
    ctx.restore();
    return true;
  },
  accent: { fill: () => css(RS.black), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a black panel, nothing more
  /** Upright, heavy, tight, no outline and no shadow: black, highlighted words in warm white. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || RS.cream : o.fill || RS.black); ctx.fillText(a.t, x, 0); });
  },
  plate(ctx, x, y, w, h, colour) { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); },
  // objects in red, black and warm white with one yellow; the small cover parts read on red and on the black panel
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: RS.cream, colour: RS.yellow }, stroke: { ink: RS.cream } }
    : { fill: { ink: RS.black, light: RS.cream, mid: [242, 162, 142], dark: RS.black, colour: RS.yellow }, stroke: { ink: RS.black, light: RS.cream, colour: RS.yellow }, line: 0.8 }),
  sticker: painters({ line: null, tone: inkAs(RS.black), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 7); draw(css(RS.black)); ctx.restore(); } }),
  /** The corner tag: a warm-white slab with black condensed lettering — it reads on the red and on the black panel. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 2) + fs * 0.7, h = fs * 1.2, top = y + fs * 0.07;
    ctx.fillStyle = css(RS.cream); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(RS.black); spaced(ctx, str, x + fs * 0.35, top + h * 0.5 + fs * 0.36, 2);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: no brackets — small print, flush right up top, and a line of it up the left edge. */
  frame(ctx, env, p) {
    const a = p.micro;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, i = env.o.catIndex, total = P.categories.length;
    ctx.save(); ctx.fillStyle = css(RS.black, a); ctx.font = `700 15px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    [`VOL.${pad2(i + 1)}`, (env.cat.name || env.cat.code || "").toUpperCase(), `${pad2(i + 1)} / ${pad2(total)}`].forEach((t, k) => ctx.fillText(t, w - 64, 160 + k * 21));
    ctx.fillRect(w - 64 - 120, 160 + 3 * 21 - 8, 120, 3);
    ctx.translate(48, h * 0.62); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; ctx.font = `700 14px ${fonts.mono}, ${fonts.cn}`;
    spaced(ctx, `${(P.brand.name || "").toUpperCase()} ✱ ${(env.cat.code || "").toUpperCase()} ✱ ${env.o.size.w}×${env.o.size.h}`, 0, 0, 3);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(RS.black); ctx.shadowBlur = 0; ctx.shadowOffsetX = 9 * unit; ctx.shadowOffsetY = 9 * unit; },
  /** Film grain, and the corners gone a little darker, as under a stage light. */
  post(ctx, w, h, C, p, unit = 1) {
    grain(ctx, p.grain, unit);
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, css([70, 8, 6], 0.38));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },
  prompt: `Stickers for a red street-culture and music poster — bold, graphic and a little rough, as if cut from a flyer — that read at a glance:
- strong, simple shapes with attitude: arrows, asterisks, stars, lightning, hands, records, speakers, crowns, eyes, flames; chunky and graphic; no realism, no perspective, no fine detail;
- flat colour only: black ("ink"), warm white ("white"), and the main colour; one small spot of "yellow" is welcome;
- the app adds a hard black offset shadow and no outline: do NOT draw outlines or shadows yourself; neighbouring shapes must differ in colour.`,
  solidPrompt: `Objects from a music and street-fashion poster: a few boxes and cylinders, boldly proportioned — a speaker, a turntable, a microphone, a sneaker box, a boombox; no realism, no fine detail.
- the renderer paints faces in warm white, a pale red and black: do NOT try to draw shading or outlines yourself;
- "white" is warm white, "dark" is black, and "main" comes out yellow — use it for one small part that should shout.`,
};

export const LOOKS = { cel, cyber, riso, anime, bluenote, editorial, songke, vivid, bluetone, redstreet };
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
