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
//   image(ctx, C, unit, p)       prepares the context for an uploaded image (its shadow or glow)
//   post(ctx, w, h, C, p)        painted over the finished cover (scanlines, vignette)
//   params                       tunable numbers shown as sliders: [{ key, min, max, step, def, name: {zh, en} }]
//   prompt / solidPrompt         the "Style" section of the AI prompts for this look (see ai.js)
//
// The current look is module state, set by drawCover() from the profile before anything is drawn.

import { fonts, spaced, spacedW, brackets } from "./cel.js";

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
const cyber = {
  id: "cyber",
  name: { zh: "赛博朋克", en: "Cyberpunk" },
  oneTheme: true,              // always dark: the light / dark choice does not apply
  params: [
    { key: "split", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "色彩错位", en: "Colour split" } },
    { key: "tear", min: 0, max: 2, step: 0.05, def: 0.7, name: { zh: "信号撕裂", en: "Signal tear" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "decor", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "界面装饰", en: "Interface detail" } },
    { key: "glow", min: 0, max: 2, step: 0.05, def: 0.35, name: { zh: "线条光晕", en: "Line glow" } },
    { key: "photo", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片染色", en: "Photo tint" } },
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
    if (L.grid) {   // a measured sheet: hairlines, and a registration cross wherever four big squares meet
      ctx.strokeStyle = css(CY.white, 0.045); ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 20; x < w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 20; y < h; y += 60) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = css(C, 0.55); ctx.lineWidth = 2; ctx.beginPath();
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

  /** Lettering: white with a black keyline and a colour echo; highlighted words are black on a chamfered plate. */
  runs(ctx, pass, o, p) {
    const fs = o.fs, C = o.C, g = fast ? 0 : fs * 0.03 * p.split * Math.max(0.3, o.shadowAmt);
    ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    pass((a, x) => {
      if (!a.hi) return;
      const w = ctx.measureText(a.t).width, bx = x - fs * 0.07, by = -fs * 0.88, bw = w + fs * 0.14, bh = fs * 1.06, plate = (col) => { chamfer(ctx, bx, by, bw, bh, fs * 0.2); ctx.fillStyle = col; ctx.fill(); };
      echo(ctx, g * 1.3, plate); plate(css(o.second || C));
    });
    echo(ctx, g, (col) => pass((a, x) => { if (a.hi) return; ctx.fillStyle = col; ctx.fillText(a.t, x, 0); }));
    if (o.strokeAmt > 0) pass((a, x) => { if (a.hi) return; ctx.strokeStyle = css(CY.black); ctx.lineWidth = fs * 0.07 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = a.hi ? css(CY.black) : css(CY.white); ctx.fillText(a.t, x, 0); });
  },

  wrap: (ctx, C, p, plates) => (plates ? ctx : neonContext(ctx, C, p)),   // the small cover parts are already ink on colour

  /** The corner tag: a chamfered plate with a colour echo. Returns its box. */
  tag(ctx, str, x, y, fs, C, p) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34, plate = (col) => { chamfer(ctx, x, y, w, h, fs * 0.42); ctx.fillStyle = col; ctx.fill(); };
    echo(ctx, fast ? 0 : 7 * p.split, plate); plate(css(C));
    ctx.fillStyle = css(CY.black); spaced(ctx, str, x + fs * 0.5, y + h * 0.5 + fs * 0.4, 3);
    ctx.fillRect(x + fs * 0.18, y + h - fs * 0.2, w - fs * 0.9, Math.max(3, fs * 0.05));   // a rule under the lettering
    return { x: x - 8, y: y - 4, w: w + 16, h: h + 8 };
  },

  /** The frame layer: corner brackets plus the small print of an interface — a status line, ticks, a stripe, a code. */
  frame(ctx, env, p) {
    const { w, h, C } = env, d = p.decor;
    brackets(ctx, 30, 30, w - 30, h - 30, 44, css(CY.white), 3);
    if (d <= 0) return;
    const P = env.o.profile, i = env.o.catIndex, total = P.categories.length;
    ctx.save();
    ctx.globalCompositeOperation = "difference";   // readable on the dark field and on the colour panel alike
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff";
    ctx.font = `600 15px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const line = [`// ${(env.cat.code || "CH").toUpperCase()}`, `${pad2(i + 1)}/${pad2(total)}`, `${env.o.size.w}×${env.o.size.h}`, "SIGNAL OK"].join("   ");
    spaced(ctx, line, 92, h - 40, 2);
    if (d > 0.3) {   // ruler ticks up the left edge
      ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0, y = h * 0.3; y < h * 0.7; y += 14, k++) { ctx.moveTo(40, y); ctx.lineTo(40 + (k % 5 ? 8 : 18), y); }
      ctx.stroke();
    }
    if (d > 0.5) {   // a code block in the lower right: bars of uneven width
      let x = w - 92;
      for (let k = 0; k < 26; k++) { const bw = 2 + Math.floor(noise(k * 3.1 + i) * 3) * 2; x -= bw + 3; ctx.fillRect(x, h - 62, bw, 24); }
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

  post(ctx, w, h, C, p, unit = 1) {
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
      // torn bands: the same two images again, inside a thin strip, pushed sideways; placed by a
      // fixed pattern so they do not jump about from one frame to the next
      const bands = Math.round(5 * Math.min(1.6, p.tear));
      for (let k = 0; k < bands; k++) {
        const y = Math.round(noise(k * 7.3 + 1) * H), bh = Math.round((5 + noise(k * 3.7 + 2) * 17) * unit), dx = Math.round((noise(k * 5.1 + 3) - 0.5) * 2 * 38 * unit * p.tear);
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

export const LOOKS = { cel, cyber };
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
export function setLook(id, given) { current = LOOKS[id] || cel; values = lookParams(current.id, given); return current; }
export const look = () => current;
export const lookValues = () => values;
/** The context graphics and the small cover parts should draw on under the current look. */
export const styled = (ctx, C, plates = false) => (current.wrap ? current.wrap(ctx, C, values, plates) : ctx);
export { INK, css };
