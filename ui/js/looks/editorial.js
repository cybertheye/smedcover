// editorial: the pages of a magazine
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_PHOTO, boost, css, dark, every, grain, greeked, gridPath, gridPen, inkAs, keepOthers, mapped, mix, openField, pad2, painters, rand, shift, titleArea, tonesFx, upright, wash } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const ED = { paper: [246, 243, 236], ink: [20, 20, 20], night: [18, 18, 18] };
// the serif face is one of the profile's fonts (see fonts.serif in cel.js)
const edInk = () => (dark ? ED.paper : ED.ink), edGround = () => (dark ? ED.night : ED.paper);
/**
 * Where the page's text stands, { x0, x1, y0, y1 } (a pure function of the cover, so no slider moves it): beside the
 * words where the column rule leaves room on the right (past the rule and the title, as it always stood); where that
 * is too narrow (a long title, Split, a square or tall page), under the words, else over them — each in the open field
 * and off the colour block (where its edge leans too), the corner tag, the graphic, the logo and the channel name on
 * the field cut out of it the way that leaves the text the most. Where none of these is clear at 220 × 160, the one of
 * them at that size reaching least behind the words and the rest (they lie over the text: it is never left out).
 */
export function edRoom(ctx, env) {
  const { w } = env, F = openField(env), E = env.G && env.G.edge, c = env.G && env.G.cat, T = titleArea(ctx, env), MW = 220, MH = 160;
  const x0 = F.x0 + 40, x1 = F.x1 - 72, y0 = Math.max(F.y0, 0) + 172, y1 = F.y1 - 44, lo = Math.max(F.y0, 0) + 16, [ax, ay, bx, by] = E ? E.line : [0, 0, 1, 0];
  const yAt = (x) => ay + ((by - ay) * (x - ax)) / (bx - ax || 1), xAt = (y) => ax + ((bx - ax) * (y - ay)) / (by - ay || 1);
  // a room kept off the colour block over its own span (an edge that leans met at its nearer end), as far from it as from the field's sides
  const fit = (r) => (F.side === "below" ? { ...r, y1: Math.min(r.y1, yAt(r.x0) - 44, yAt(r.x1) - 44) } : F.side === "above" ? { ...r, y0: Math.max(r.y0, yAt(r.x0) + 172, yAt(r.x1) + 172) } : F.side === "right" ? { ...r, x1: Math.min(r.x1, xAt(r.y0) - 72, xAt(r.y1) - 72) } : F.side === "left" ? { ...r, x0: Math.max(r.x0, xAt(r.y0) + 40, xAt(r.y1) + 40) } : r);
  const words = T ? [{ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }] : [], others = keepOthers(env), L = env.cover && env.cover.layers && env.cover.layers.find((l) => l.id === "catname" && l.visible), k = env.cat;
  if (env.logo) others.push({ x: env.logo.x - 20, y: env.logo.y - 20, w: env.logo.w + 40, h: env.logo.h + 40 });
  if (c && !c.onAccent && L) {   // the channel name on the field and its plate (under it, or inline beside it), as wide as their characters can set
    const name = L.showName !== false && k && k.name ? [...k.name].length * (c.fs + 6) : 0, sub = L.plate !== false && k && k.sub ? [...k.sub].length * (c.inline ? c.fs * 0.4 : 34) + 60 : 0, nw = Math.min(c.maxW || 600, k ? name : 900);
    others.push({ x: c.x - 24, y: c.y - c.fs * 1.05, w: (c.inline ? nw + (sub && 34 + sub) : Math.max(nw, sub)) + 48, h: c.fs * 1.4 + 24 + (sub && !c.inline ? 80 : 0) });
  }
  const size = (r) => Math.max(0, r.x1 - r.x0) * Math.max(0, r.y1 - r.y0), big = (r) => r.x1 - r.x0 >= MW && r.y1 - r.y0 >= MH;
  const use = (r) => Math.min(r.x1 - r.x0, 866) * (r.y1 - r.y0 - 90);   // what the text can fill: two columns of 420 at most, under the mark's room
  const meet = (r, b) => Math.max(0, Math.min(r.x1, b.x + b.w) - Math.max(r.x0, b.x)) * Math.max(0, Math.min(r.y1, b.y + b.h) - Math.max(r.y0, b.y));
  const behind = (r) => [...words, ...others].reduce((s, b) => s + meet(r, b), 0) / Math.max(1, size(r));
  // room r with the boxes of `bs` it meets cut out of it, each on whichever side leaves the best (big enough first, then the most for the text); `fall`: or left in where cutting leaves too little, the best then reaching least behind them
  const cut = (r, bs, fall = false) => {
    const i = bs.findIndex((b) => meet(r, b)), b = bs[i], rest = bs.slice(i + 1);
    const better = (a, q) => (big(q) !== big(a) ? (big(q) ? q : a) : fall && behind(q) !== behind(a) ? (behind(q) < behind(a) ? q : a) : use(q) > use(a) ? q : a);
    return i < 0 ? r : [...(fall ? [r] : []), { ...r, x1: Math.min(r.x1, b.x) }, { ...r, x0: Math.max(r.x0, b.x + b.w) }, { ...r, y1: Math.min(r.y1, b.y) }, { ...r, y0: Math.max(r.y0, b.y + b.h) }].map((q) => cut(q, rest, fall)).reduce(better);
  };
  const beside = { x0: Math.max(x0, Math.round(w * 0.64) + 30, T ? T.x + T.w + 60 : 0), x1, y0, y1 };
  const under = T && { x0: Math.max(x0, T.x), x1, y0: T.y + T.h + 40, y1 }, over = T && { x0: Math.max(x0, T.x), x1, y0, y1: T.y - 40 };
  const rooms = [beside, under, over].filter(Boolean).map(fit), clear = rooms.map((r) => cut(r, others)).find(big);
  if (clear) return clear;
  // nothing clear: each at its least size, reaching behind the words (and behind the rest, where cutting them out leaves too little); the one reaching least behind them
  const [b, u, o] = rooms, at = [{ ...b, x0: Math.max(F.x0 + 16, Math.min(b.x0, b.x1 - MW)) }, ...(T ? [{ ...u, y0: Math.max(lo, Math.min(u.y0, u.y1 - MH)) }, { ...o, y1: Math.max(o.y1, o.y0 + MH) }] : [])].map((r) => cut(fit(r), others, true));
  const key = (r) => (big(r) ? behind(r) : 10 - Math.max(0, use(r)) / 1e7);
  return at.reduce((a, r) => (key(r) < key(a) ? r : a));
}
/**
 * The page's text in its room (see edRoom): a large opening quotation mark in the channel colour (growing and
 * deepening with Quotation mark) at its head and, under the room the mark takes at its largest (on or not, so it moves
 * nothing), two narrow columns of body text set as greeked lines, filling in paragraph by paragraph, top to bottom, as
 * Body columns rises, the rows cut to the room.
 */
function edColumns(ctx, env, p) {
  if (p.quote <= 0 && p.text <= 0) return;
  const { C } = env, { x0, x1, y0, y1 } = edRoom(ctx, env), top = y0 + 90;
  if (p.quote > 0) {
    const fs = 90 + 130 * p.quote;
    ctx.save(); ctx.font = `700 ${fs}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(C, 0.3 + 0.7 * p.quote);
    shift("quote", x0 + fs * 0.18, y0 + fs * 0.3, ctx);   // a scene object
    ctx.fillText("\u201C", x0 - fs * 0.06, y0 + fs * 0.62); ctx.restore();
  }
  if (p.text <= 0) return;
  const lh = 15, gap = 26, cw = Math.min(420, (x1 - x0 - gap) / 2), rows = Math.floor((y1 - top) / lh), ink = css(edInk(), dark ? 0.34 : 0.42);
  let left = Math.ceil(p.text * rows * 2);   // a line at least, once it is on
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
