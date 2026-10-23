// risograph: two spot inks on paper
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, WORK, canPaint, clamp, css, fall, grain, gridPen, inkAs, mapped, mix, onLayer, openField, painters, rand, region, shapeIn, shapeOf, shift, wash, wear, workLike, wornTexture } from "./kit.js";
import { toneField } from "../cel.js";

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
export const riso = {
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
    const fs = o.fs, C = o.hi || o.C || RISO.pink, main = o.fill || RISO.blue, g = fs * o.shadowAmt * (0.035 + 0.012 * p.shift), [gx, gy] = fall(g, g * 0.8);   // the shadow slider is how far off the second ink is printed: 0 in register
    pass((a, x) => { ctx.fillStyle = css(a.hi ? main : C); ctx.fillText(a.t, x + gx, gy); });
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
riso.elementFx.push({ key: "overprint", name: { zh: "第二色叠印", en: "Second-ink overprint" }, for: FX_ALL, stage: "behind", reach: (B) => { const d = Math.min(B.w, B.h) * 0.09; return { r: d, b: d }; },
  /** A second impression of the layer in the riso's pink, printed off to the lower right: behind it where it shows, and a little darker where the two inks overlap (only a little: it lies over nearly all of the layer). */
  paint(x, B, a) {
    const src = region(x, B, "fxOver"), d = Math.min(B.w, B.h) * 0.08 * a, ink = shapeIn(src, RISO.pink, "fxOverInk"), alpha = Math.min(1, a * 3) * 0.9;
    onLayer(x, B, src, "multiply", alpha * 0.22, (g) => g.drawImage(ink, d, d * 0.8));
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = alpha; x.drawImage(ink, B.x0 + d, B.y0 + d * 0.8); x.restore();
  } });
