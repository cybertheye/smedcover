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
//   image(ctx, C, unit, p)       prepares the context for an uploaded image (its shadow or glow)
//   post(ctx, w, h, C, p)        painted over the finished cover (scanlines, vignette)
//   params                       tunable numbers shown as sliders: [{ key, min, max, step, def, name: {zh, en} }]
//   prompt / solidPrompt         the "Style" section of the AI prompts for this look (see ai.js)
//
// The current look is module state, set by drawCover() from the profile before anything is drawn.

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

// ---------- the house look: everything is drawn by the code's own defaults
const cel = {
  id: "cel",
  name: { zh: "赛璐珞", en: "Cel" },
  params: [],
};

// ---------- cyberpunk: dark glass, neon line work, glow, scanlines, a colour split on lettering
const CY = {
  deep: [5, 6, 15],            // darkest surface
  glass: [[22, 27, 58], [14, 17, 40], [8, 9, 22]],   // light / mid / dark faces of an object
  second: [255, 43, 214],      // the second neon, next to the channel colour
  third: [25, 240, 255],
  white: [236, 250, 255],
};
/** A neon tube: a wide faint halo, the coloured line, a pale core. `draw()` strokes the current path or text. */
function tube(ctx, draw, colour, glow, core = true) {
  const w = ctx.lineWidth, a = ctx.globalAlpha;
  ctx.strokeStyle = css(colour);
  if (glow > 0) { ctx.globalAlpha = a * 0.16 * Math.min(1.5, glow); ctx.lineWidth = w * (2 + 2.4 * glow); draw(); ctx.globalAlpha = a * 0.3 * Math.min(1.5, glow); ctx.lineWidth = w * (1.2 + 0.9 * glow); draw(); }
  ctx.globalAlpha = a; ctx.lineWidth = w * 0.8; draw();
  if (core) { ctx.strokeStyle = css(mix(colour, CY.white, 0.75), 0.9); ctx.lineWidth = Math.max(0.6, w * 0.24); draw(); }
  ctx.lineWidth = w; ctx.globalAlpha = a;
}
const glassOf = (c) => mix(c, CY.deep, 0.8);                 // a dark, tinted version of a fill colour
const neonOf = (c) => (role(c) === "colour" ? c : role(c) === "ink" ? CY.third : CY.white);

/**
 * A context that draws the house style's code as neon: neutral fills become dark glass, ink lines
 * become glowing tubes in the channel colour. Everything else passes straight through.
 */
function neonContext(ctx, C, p, plates) {
  let ink = false, given = null;            // `given`: the fill colour as the drawing code set it
  const fill = (v) => {
    const c = parseColour(v);
    given = c;
    if (!c) return v;
    const r = role(c);
    return r === "colour" ? v : css(r === "ink" ? CY.deep : CY.glass[r === "light" ? 0 : r === "mid" ? 1 : 2], c[3]);
  };
  // In "plates" mode (the small parts of a cover) a solid coloured plate becomes tinted glass with
  // a thin neon rim, so that the lettering on it — ink in the house style, pale here — stays readable.
  const plate = (t, paint, rim) => {
    if (!plates || !given || role(given) !== "colour") return paint();
    const keep = t.fillStyle;
    t.fillStyle = css(glassOf(given), given[3]); paint();
    t.save(); t.strokeStyle = css(given, given[3]); t.lineWidth = 2; rim(); t.restore();
    t.fillStyle = keep;
  };
  const lettering = (t, a) => {             // ink lettering reads as pale light; coloured lettering stays neon
    if (!given || role(given) === "colour") return t.fillText(...a);
    const keep = t.fillStyle;
    t.fillStyle = css(role(given) === "ink" || plates ? CY.white : given, given[3]); t.fillText(...a); t.fillStyle = keep;
  };
  const stroke = (v) => {
    const c = parseColour(v);
    ink = !!c && role(c) === "ink";
    return !c ? v : ink ? css(C, c[3]) : role(c) === "colour" ? v : css(CY.white, c[3]);
  };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "stroke") return (...a) => (ink ? tube(t, () => t.stroke(...a), C, p.glow) : t.stroke(...a));
      if (k === "strokeText") return (...a) => (ink ? tube(t, () => t.strokeText(...a), C, p.glow * 0.6, false) : t.strokeText(...a));
      if (k === "strokeRect") return (...a) => (ink ? tube(t, () => t.strokeRect(...a), C, p.glow) : t.strokeRect(...a));
      if (k === "fillText") return (...a) => lettering(t, a);
      if (k === "fill") return (...a) => plate(t, () => t.fill(...a), () => t.stroke());
      if (k === "fillRect") return (x, y, w, h) => (Math.abs(h) <= 16 ? t.fillRect(x, y, w, h) : plate(t, () => t.fillRect(x, y, w, h), () => t.strokeRect(x, y, w, h)));
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

const cyber = {
  id: "cyber",
  name: { zh: "赛博朋克", en: "Cyberpunk" },
  params: [
    { key: "glow", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "霓虹光晕", en: "Neon glow" } },
    { key: "split", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "色彩错位", en: "Colour split" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "氛围光", en: "Haze" } },
    { key: "photo", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "照片染色", en: "Photo tint" } },
  ],
  theme: (base, C) => ({ ...base, field: css(CY.deep), text: css(CY.white), dim: css(CY.white, 0.55), titleFill: css(CY.white), titleInk: css(CY.deep), grid: () => css(C, 0.22) }),

  background(ctx, env, L, p) {
    const { w, h, C } = env;
    // deep field with two pools of light: the channel colour low on one side, the second neon high on the other
    ctx.fillStyle = css(CY.deep); ctx.fillRect(0, 0, w, h);
    if (env.photo) {
      env.drawPhoto();
      if (p.photo > 0) {   // duotone wash: shadows toward violet, lights toward the channel colour
        const g = ctx.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, css(CY.second, 0.85 * p.photo)); g.addColorStop(1, css(C, 0.85 * p.photo));
        ctx.save(); ctx.globalCompositeOperation = "overlay"; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css([40, 30, 96], 0.72 * p.photo); ctx.fillRect(0, 0, w, h); ctx.restore();
      }
    }
    if (p.haze > 0) {
      const R = Math.max(w, h);
      for (const [x, y, col, a] of [[w * 0.12, h * 0.98, C, 0.34], [w * 0.92, h * 0.04, CY.second, 0.26]]) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, R * 0.75);
        g.addColorStop(0, css(col, a * p.haze)); g.addColorStop(1, css(col, 0));
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
    }
    if (L.grid && !env.photo) {   // a faint sheet of grid, and a floor grid running to a horizon
      ctx.strokeStyle = css(C, 0.07); ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 20; x < w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 20; y < h; y += 60) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      const hz = h * 0.56;
      ctx.save(); ctx.beginPath(); ctx.rect(0, hz, w, h - hz); ctx.clip();
      ctx.strokeStyle = css(C, 0.34); ctx.lineWidth = 2; ctx.beginPath();
      for (let i = -14; i <= 14; i++) { ctx.moveTo(w / 2 + i * w * 0.03, hz); ctx.lineTo(w / 2 + i * w * 0.24, h); }
      for (let k = 0, y = hz; y < h; k++, y = hz + (h - hz) * (1 - Math.pow(0.8, k))) { ctx.moveTo(0, y); ctx.lineTo(w, y); if (k > 40) break; }
      ctx.stroke(); ctx.restore();
      const fade = ctx.createLinearGradient(0, hz, 0, hz + (h - hz) * 0.5);
      fade.addColorStop(0, css(CY.deep, 1)); fade.addColorStop(1, css(CY.deep, 0));
      ctx.fillStyle = fade; ctx.fillRect(0, hz - 2, w, (h - hz) * 0.5 + 2);
    }
    return true;
  },

  accent: {
    fill: (C) => css(mix(C, CY.deep, 0.84)),
    tone: (C) => css(C, 0.5),               // the screentone becomes sparse neon dots
    toneScale: 0.5,
    /** The dividing edge as a neon tube, with a thinner second line beside it. */
    edge(ctx, run, nx, ny, C, p) {
      ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.lineWidth = 9; tube(ctx, () => run(0, 0), C, p.glow);
      ctx.lineWidth = 3; ctx.strokeStyle = css(CY.second, 0.9); run(nx * 22, ny * 22);
    },
  },

  runs(ctx, pass, o, p) {
    const fs = o.fs, g = fs * 0.022 * p.split, C = o.C, colourOf = (a) => (a.hi ? C : o.second || CY.second);
    ctx.lineJoin = "round";
    if (g > 0) {   // the colour split: the same letters printed slightly apart in two neons
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      pass((a, x) => { ctx.fillStyle = css(CY.third, 0.75); ctx.fillText(a.t, x - g, 0); ctx.fillStyle = css(CY.second, 0.75); ctx.fillText(a.t, x + g, g * 0.35); });
      ctx.restore();
    }
    // the glow, then the letter itself: plain words are pale with a coloured rim, highlighted words are solid neon.
    // The glow is layered strokes, widest and faintest first: canvas shadow blur differs between web views.
    const rim = fs * 0.05 * Math.max(0.4, o.strokeAmt);
    for (const [k, alpha] of [[7, 0.05], [5, 0.08], [3.4, 0.13], [2.1, 0.22]]) {
      if (p.glow <= 0) break;
      pass((a, x) => { ctx.strokeStyle = css(colourOf(a), alpha * Math.min(1.6, p.glow)); ctx.lineWidth = rim * (1 + (k - 1) * p.glow); ctx.strokeText(a.t, x, 0); });
    }
    pass((a, x) => { ctx.strokeStyle = css(colourOf(a)); ctx.lineWidth = rim; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = a.hi ? css(mix(C, CY.white, 0.3)) : css(CY.white); ctx.fillText(a.t, x, 0); });
  },

  wrap: (ctx, C, p, plates) => neonContext(ctx, C, p, plates),

  sticker: {
    shape(ctx, path, fill, { lw = 7 } = {}, p) {
      const c = parseColour(fill) || CY.white, n = neonOf(c);
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); path(ctx); ctx.fillStyle = css(glassOf(n)); ctx.fill();
      ctx.lineWidth = lw * 0.85; tube(ctx, () => ctx.stroke(), n, p.glow);
    },
    blob(ctx, paths, fill, p) {
      const c = parseColour(fill) || CY.white, n = neonOf(c);
      // outline of the union: every path stroked, then every path filled over the inner seams
      ctx.lineJoin = "round";
      for (const pass of [0, 1]) for (const path of paths) {
        ctx.beginPath(); path(ctx);
        if (pass === 0) { ctx.lineWidth = 12; tube(ctx, () => ctx.stroke(), n, p.glow, false); }
        else { ctx.fillStyle = css(glassOf(n)); ctx.fill(); }
      }
    },
    stroke(ctx, draw, color, lw = 30, p) {
      const n = neonOf(parseColour(color) || CY.white);
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); draw(ctx); ctx.lineWidth = lw * 0.5; tube(ctx, () => ctx.stroke(), n, p.glow);
    },
    thin(ctx, draw, lw, color) {
      const c = parseColour(color) || CY.white;
      ctx.beginPath(); draw(ctx); ctx.lineWidth = lw * 0.8; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = css(role(c) === "colour" ? c : CY.white, 0.9); ctx.stroke();
    },
    word(ctx, str, x, y, size, fill, p) {
      const n = neonOf(parseColour(fill) || CY.white), tone = role(n) === "colour" ? n : CY.third;
      ctx.lineJoin = "round"; ctx.lineWidth = size * 0.1;
      tube(ctx, () => ctx.strokeText(str, x, y), tone, p.glow, false);
      ctx.fillStyle = css(CY.white); ctx.fillText(str, x, y);
    },
  },

  image(ctx, C, unit, p) { ctx.shadowColor = css(C, 0.9); ctx.shadowBlur = 26 * unit * p.glow; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; },

  post(ctx, w, h, C, p) {
    if (p.scan > 0) {
      ctx.fillStyle = css([0, 0, 0], 0.34 * p.scan);
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2.4);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, css([3, 2, 12], 0.5 + 0.2 * p.haze));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },

  prompt: `Hard-edged cyberpunk signage that reads at a glance on a dark cover:
- angular, engineered shapes: chamfered corners, straight cuts, notches and bevels rather than soft curves; a strong silhouette; no realism, no perspective, no fine detail;
- every shape is drawn as dark glass with a glowing neon outline in its fill colour: do NOT draw outlines, glows or shadows yourself, and do not rely on large light areas — "white" comes out as a pale outline, not a white surface;
- think in line work: a few well-placed inner lines and small accents do more than filled areas;
- 2 to 3 colours per sticker: the main colour plus one contrasting neon (pink or blue) for small accents.`,
  solidPrompt: `Hard-surface cyberpunk hardware — devices, machines and vehicles from a neon city — that reads at a glance on a dark cover:
- built from a few boxes and cylinders with chamfered, engineered proportions; add small technical parts (vents, antennas, armour plates, cables as thin boxes) where they help; no realism, no fine detail;
- the renderer turns every face into dark glass, draws every edge as a glowing neon line and scatters screentone on the shadow side: do NOT try to draw shading, outlines or glow yourself;
- "white" and "dark" both come out as dark surfaces, so shape and edges carry the object; use "main" for the parts that should light up in solid colour, and marks in "main" for lit details (screens, lamps, indicator strips).`,
};

export const LOOKS = { cel, cyber };
export const LOOK_IDS = Object.keys(LOOKS);

let current = cel, values = {};
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
