// jazz record sleeves of the 1950s and 60s
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_PHOTO, TAU, boost, cellsOf, css, dark, dotScreen, fillDots, grain, greeked, gridPen, inkAs, lumOf, mapped, mix, objAt, openField, painters, rand, tonesFx, upright, wash, wear } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const BN = { paper: [238, 232, 218], ink: [18, 18, 22], night: [16, 18, 24] };
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
export const bluenote = {
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
/** A halftone of the layer itself: its own tone in dots of `ink` on `paper` (each colour, or null for none), `pitch` px apart. */
function halftoneOf(x, B, a, pitch, ink, paper) {
  const [d, cols, rows] = cellsOf(x, B, pitch);
  if (paper) { x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = a; x.fillStyle = css(paper); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore(); }
  fillDots(x, B, ink, a, "source-atop", (dot) => {   // a photo filling the canvas: some 57,000 dots (see fillDots)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; if (d[q + 3] < 60) continue; const r = pitch * 0.62 * Math.sqrt(1 - lumOf(d, q)); if (r < 0.3) continue; dot(B.x0 + (i + 0.5) * pitch, B.y0 + (j + 0.5) * pitch, r); }
  });
}
bluenote.elementFx = [
  { key: "duo", name: { zh: "照片双色调", en: "Photo duotone" }, for: FX_PHOTO, stage: "filter",
    /** The photo in two inks: black and the channel colour, the paper for its lights. */
    paint: tonesFx((E) => [[0, BN.ink], [0.62, boost(E.C, 0.4)], [1, BN.paper]], 0.1) },
  { key: "halftone", name: { zh: "照片网点", en: "Photo halftone" }, for: FX_PHOTO, stage: "over",
    /** The photo screened as a coarse sleeve print: its own tones in dots of ink on paper. */
    paint(x, B, a, E) { halftoneOf(x, B, a, 6 * E.k, BN.ink, BN.paper); } },
];
