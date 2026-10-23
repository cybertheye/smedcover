// editorial: the pages of a magazine
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_PHOTO, boost, css, dark, every, grain, graphicTop, greeked, gridPath, gridPen, inkAs, mapped, mix, openField, pad2, painters, rand, shift, titleArea, tonesFx, upright, wash } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

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
export const editorial = {
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
editorial.elementFx = [
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A neutral, even black and white, as a magazine prints a portrait. */
    paint: tonesFx(() => [[0, [16, 16, 16]], [0.5, [128, 127, 125]], [1, [244, 242, 238]]]) },
  { key: "spot", name: { zh: "照片专色", en: "Photo in spot colour" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black and one spot colour, the channel's. */
    paint: tonesFx((E) => [[0, ED.ink], [0.55, boost(E.C, 0.5)], [1, ED.paper]], 0.15) },
];
