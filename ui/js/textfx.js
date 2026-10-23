// Text effects: how the letters of a headline are painted. An effect belongs to a layer (the title,
// or a text layer in its headline look); "auto" leaves the choice to the current look.
//
// Four kinds, by what they can change:
//   passes    the same line of text painted several times in different colours and places — outlines,
//             shadows, echoes. The looks' own letterings are of this kind; "auto" takes the current look's.
//   mask      the letters are first painted alone on a spare canvas, which is then worked on —
//             filled with a pattern, worn away, shaded inside, cut into rows — and laid down.
//   outline   the letters' outlines are fetched as points (see outlines.js) and given real depth, or
//             their edges reshaped — spikes, a torn edge, scissor cuts, drips, puffed up, eaten away (SHAPED).
//   letters   each letter drawn on its own, in a face and on a scrap of paper of its own (ransom.js).
// A bend (BENDS: arched, on a circle, wave…) is apart from the lettering, and goes with any of them: the
// line is painted as it would be, on a canvas of its own, and that picture is bent (bentLine, meshWarp).
//
// Every effect is painted through paintRuns(ctx, pass, o, id): `pass(fn)` calls fn(piece, x) for
// each piece {t, hi, …} of the current line as setLine (title.js) set it — a run, or part of one where
// the script changes or punctuation is squeezed; one set larger is drawn and measured so while fn runs;
// `piece.run` {x0, x1} is where its whole run lies and `piece.first` whether it is the run's first, for
// what marks whole runs — the context being placed on that line's baseline, and `o` carries sizes and colours:
//   fs          type size                         amt        the layer's "strength" for the effect (1 = normal)
//   strokeAmt   outline weight (0 = none)         shadowAmt  shadow / depth
//   fillCss / hiCss / inkCss / shadowCss / hiShadowCss   the colours of plain words, highlighted words,
//                                                 the keyline and the two shadows
//   C, fill, hi the channel colour and the layer's own colours as [r, g, b] (for the looks' letterings)
//   hiPlate     the layer has plates (or a band, a block) under its highlighted words: a lettering that boxes them itself does not
//   lineW       width of the line                 unit       canvas pixels per unit
//   seed        a number that differs from line to line, for effects that scatter things
//   fxSeed      the layer's own seed (Reshuffle deals another), for the reshaped edges (see SHAPED)
//   ransom      the layer's settings for the ransom note (ransom.js; see ransomOf in render.js)
//   row         which line of its block this is
//   frame       where this line sits in its block, for effects that shape the whole block (the
//               perspective): {ox, oy, c, box} — the line's origin and slant (x' = x + c·y) in the
//               block's space, and the block {x, y, w, h} there
//   warp        the layer's own perspective, if it has one: the block's four corners moved by
//               [[dx, dy] × 4] (top left, top right, bottom right, bottom left), in block widths and heights
// A column (lettering set vertically, see drawTitleVertical in title.js) is painted as a line too: the line
// turned a quarter turn clockwise, so it reads downward, and painted while inColumn() is under way, which
// turns what stands upright in a column back where it stands (see below). What a lettering throws off its
// letters one way — a shadow, depth, an echo — falls as the page has it, in a column as off a line: its offset
// is given through fall() in style.js, which turns it back in a column.
import { LOOKS, look, lookValues, lookState, lookParams, isFast, INK, asColumn, fall } from "./style.js";
import { outline } from "./outlines.js";
import { ransom, ransomEpoch, hash, seeded } from "./ransom.js";

/**
 * id -> { name: {zh, en}, kind, menu?, seeded? }: `kind` how it is painted, `seeded` whether its letters are
 * drawn by the layer's seed (fxSeed), which Reshuffle deals again, `menu` the group it is listed under when
 * not its kind's (Extruded is drawn from outlines but looks like the layered letterings, a shadow grown
 * into depth, so it is listed with them). The order is the order of the menu: the typesetting effects, and the
 * editorial look's Underlined highlight, which marks the highlighted words and so has to be lettering.
 * (Sliced, Overprint, Double keyline and Sunlit block were once here too; what they do is their looks'
 * post effects now, for any layer. A layer that still names one is painted as "auto".)
 */
export const EFFECTS = {
  auto: { name: { zh: "自动（跟随风格）", en: "Automatic (follows the look)" }, kind: "passes" },
  sticker: { name: { zh: "贴纸字", en: "Sticker" }, kind: "passes" },
  cel: { name: { zh: "描边加投影", en: "Outline and shadow" }, kind: "passes" },
  plain: { name: { zh: "纯文字", en: "Plain" }, kind: "passes" },
  bluenote: { name: { zh: "纯文字（不倾斜）", en: "Plain, upright" }, kind: "passes" },
  editorial: { name: { zh: "下划线强调", en: "Underlined highlight" }, kind: "passes" },
  dots: { name: { zh: "字内网点", en: "Halftone inside" }, kind: "mask" },
  stripes: { name: { zh: "字内条纹", en: "Stripes inside" }, kind: "mask" },
  inner: { name: { zh: "内阴影", en: "Inner shadow" }, kind: "mask" },
  worn: { name: { zh: "磨损", en: "Worn" }, kind: "mask" },
  rows: { name: { zh: "逐行错位", en: "Row shift" }, kind: "mask" },
  extrude: { name: { zh: "立体挤出", en: "Extruded" }, kind: "outline", menu: "passes" },
  spiky: { name: { zh: "刺边", en: "Spiky" }, kind: "outline", seeded: true },
  torn: { name: { zh: "撕边", en: "Torn edge" }, kind: "outline", seeded: true },
  cut: { name: { zh: "手剪", en: "Scissor-cut" }, kind: "outline", seeded: true },
  melt: { name: { zh: "融化", en: "Melting" }, kind: "outline", seeded: true },
  puffy: { name: { zh: "膨胀", en: "Puffed up" }, kind: "outline" },
  eroded: { name: { zh: "侵蚀", en: "Eaten away" }, kind: "outline", seeded: true },
  ransom: { name: { zh: "剪报字", en: "Ransom note" }, kind: "letters", seeded: true },
};
/**
 * id -> { name }: the bends a headline may be given (its `bend`, how far: `bendAmt`), whatever its
 * lettering. Each is a map of WARP (taper: the layer's own perspective, `warp`, when it has one). They
 * were once outline effects themselves, painted in the house lettering (see normalizeLayer in layers.js).
 */
export const BENDS = {
  arc: { name: { zh: "拱形", en: "Arched" } },
  arcLow: { name: { zh: "下弧", en: "Arc down" } },
  circle: { name: { zh: "圆弧", en: "On a circle" } },
  shell: { name: { zh: "上拱", en: "Arched top" } },
  bulge: { name: { zh: "鼓起", en: "Bulge" } },
  pinch: { name: { zh: "收腰", en: "Pinch" } },
  fisheye: { name: { zh: "鱼眼", en: "Fisheye" } },
  rise: { name: { zh: "上扬", en: "Rise" } },
  taper: { name: { zh: "透视收缩", en: "Tapered" } },
  wave: { name: { zh: "波浪", en: "Wave" } },
  flag: { name: { zh: "旗帜", en: "Flag" } },
};

const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

// ---------- columns
// A column sets CJK characters, kana, hangul, full-width forms, CJK punctuation and emoji upright, one under
// another; Latin letters, digits and every other script lie on their side, as a vertical line sets them, and
// so do the brackets, quotes, dashes and ellipses, which turn with the line. Of the marks standing upright,
// 。，、 sit at the top right of their cell, as a vertical face cuts them (the ink of the horizontal one moved
// to the other side of the cell's middle, however far from it the font set it), and ？！：； in the middle
// of it, across.
const TURNS = "「」『』（）《》〈〉【】〔〕〖〗〘〙〚〛［］｛｝｟｠“”‘’—–―‒…‥⋯～〜ー－＿｜";
const UPRIGHT = /[\p{Script=Han}\p{Script=Hangul}　-ヿ㄀-ㄯ㆐-ㇿ㈀-㏿＀-￯⺀-⿟\p{Extended_Pictographic}]/u;
export const TOP_RIGHT = "。，、．｡､﹐﹒", MIDDLE = "？！：；‼⁇⁈⁉";
/** Whether a character (a grapheme) stands upright in a column, rather than lying on its side with the line. */
export const standsUp = (ch) => UPRIGHT.test(ch) && !TURNS.includes(ch);
const graphemesOf = typeof Intl !== "undefined" && Intl.Segmenter ? ((seg) => (t) => Array.from(seg.segment(t), (g) => g.segment))(new Intl.Segmenter(undefined, { granularity: "grapheme" })) : (t) => [...t];
const CANVAS = ["CanvasRenderingContext2D", "OffscreenCanvasRenderingContext2D"].map((n) => globalThis[n] && globalThis[n].prototype).filter(Boolean);
const NATIVE = new Map(CANVAS.map((P) => [P, P.measureText]));   // measureText as the canvas has it, before anything sets a piece larger (see larger in title.js)
const measureOf = (c) => { for (const [P, m] of NATIVE) if (P.isPrototypeOf(c)) return m; return c.measureText; };
const MIDS = new Map();
/** How far the middle of an em lies below (+) the baseline of c's font, as its textBaseline sets it: the middle of 国's ink; without real metrics (a test's context), 0.38 of the size above an alphabetic baseline. */
function emMid(c, measure = measureOf(c)) {
  const key = `${c.font}|${c.textBaseline}|${FONTS_SEEN}`;
  if (MIDS.has(key)) return MIDS.get(key);
  const m = measure.call(c, "国"), up = m.actualBoundingBoxAscent, down = m.actualBoundingBoxDescent, px = Number((/(\d*\.?\d+)px/.exec(c.font || "") || [])[1]) || 100;
  if (!(Number.isFinite(up) && Number.isFinite(down) && up + down > 0)) return c.textBaseline === "middle" ? 0 : -0.38 * px;   // not kept: a canvas with metrics may come in the same font
  if (MIDS.size > 200) MIDS.clear();
  MIDS.set(key, (down - up) / 2);
  return (down - up) / 2;
}
/** The middle of an em in ctx's font, below (+) its baseline: where a column's middle lies from the baseline of the line it is. */
export const emMiddle = (ctx) => emMid(ctx);
/**
 * Where an upright mark's ink goes in its cell, from where the horizontal face has it: {x, y} to move it by, given
 * where its ink's middle lies from the cell's middle (ex across, ey down). 。，、 to the top right, mirrored through
 * the middle; ？！：； to the middle across.
 */
const markShift = (ch, ex, ey) => (TOP_RIGHT.includes(ch) ? { x: -2 * ex, y: -2 * ey } : MIDDLE.includes(ch) ? { x: -ex, y: 0 } : { x: 0, y: 0 });
/**
 * Draws text `t` at (x, y) on c, with `draw` (fillText or strokeText as they were) and `measure`, as a column sets
 * it: what lies on its side as it is, each character that stands upright turned back a quarter turn about the middle
 * of its em, where it would stand (its advance's middle, the em's middle), its marks moved as markShift has it.
 */
function columnText(c, draw, measure, t, x, y, rest) {
  const gs = graphemesOf(String(t));
  if (!gs.some(standsUp)) return draw.call(c, t, x, y, ...rest);
  const align = c.textAlign, total = measure.call(c, String(t)).width;
  let pen = x - (align === "center" ? total / 2 : align === "right" || align === "end" ? total : 0);
  c.textAlign = "left";
  try {
    for (let i = 0; i < gs.length; ) {
      if (!standsUp(gs[i])) {   // a stretch lying on its side, whole
        let j = i;
        while (j < gs.length && !standsUp(gs[j])) j++;
        const s = gs.slice(i, j).join("");
        draw.call(c, s, pen, y); pen += measure.call(c, s).width; i = j;
        continue;
      }
      const g = gs[i++], m = measure.call(c, g), w = m.width, mid = emMid(c, measure);
      let dx = -w / 2, dy = -mid;
      if ((TOP_RIGHT.includes(g) || MIDDLE.includes(g)) && Number.isFinite(m.actualBoundingBoxLeft)) {
        const s = markShift(g, (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2 - w / 2, (m.actualBoundingBoxDescent - m.actualBoundingBoxAscent) / 2 - mid);
        dx += s.x; dy += s.y;
      }
      c.save(); c.translate(pen + w / 2, y + mid); c.rotate(-Math.PI / 2); draw.call(c, g, dx, dy); c.restore();
      pen += w;
    }
  } finally { c.textAlign = align; }
}
/**
 * The polylines of an upright letter of a column (`ch`, its outline `shapes` as drawn on the line, its advance's
 * middle at `cx`, the em's middle at `cy`) turned back as columnText turns its letter: a function of a polyline.
 */
export function uprightTurn(ch, shapes, cx, cy) {
  let s = { x: 0, y: 0 };
  if (TOP_RIGHT.includes(ch) || MIDDLE.includes(ch)) {
    const pts = shapes.flat(), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (pts.length) s = markShift(ch, (Math.min(...xs) + Math.max(...xs)) / 2 - cx, (Math.min(...ys) + Math.max(...ys)) / 2 - cy);
  }
  return (pts) => pts.map(([x, y]) => { const ux = x - cx + s.x, uy = y - cy + s.y; return [cx + uy, cy - ux]; });
}
let COLUMN = 0;   // a column being painted (see inColumn)
/** Whether a column is being painted (see inColumn): the lettering's line is turned, its upright letters turned back. */
export const columnNow = () => COLUMN > 0;
/**
 * Runs `run` (and returns what it does) with text drawn on every canvas set as a column sets it (columnText): ctx's
 * line is to be turned a quarter turn clockwise, and this turns the letters that stand upright back, wherever they
 * are drawn — the looks' work canvases, the ransom note's scraps and the letters cut from the photo, the shapes a
 * weave keeps letters by — so every lettering sets a column without knowing (as `larger` in title.js sets a piece
 * larger). ctx itself is set so too when it is no canvas (a test's stand-in). Meanwhile (asColumn in style.js) the
 * looks' letterings take no slant out of the line, a column being set upright, and the shadows, depths and echoes
 * the letterings throw fall as the page has them (fall). The outline effects turn their letters' outlines themselves
 * (glyphShapes).
 */
export function inColumn(ctx, run) {
  if (COLUMN) return run();
  const kept = CANVAS.map((P) => [P, P.fillText, P.strokeText]);
  for (const [P, fill, stroke] of kept) {
    const measure = NATIVE.get(P);
    P.fillText = function (t, x, y, ...r) { return columnText(this, fill, measure, t, x, y, r); };
    P.strokeText = function (t, x, y, ...r) { return columnText(this, stroke, measure, t, x, y, r); };
  }
  const stand = ctx && !CANVAS.some((P) => P.isPrototypeOf(ctx)) && typeof ctx.fillText === "function", own = {};
  if (stand) for (const k of ["fillText", "strokeText"]) {
    const draw = ctx[k], measure = ctx.measureText;
    own[k] = Object.getOwnPropertyDescriptor(ctx, k);
    ctx[k] = function (t, x, y, ...r) { return columnText(this, draw, measure, t, x, y, r); };
  }
  COLUMN++;
  try { return asColumn(run); } finally {
    COLUMN--;
    for (const [P, fill, stroke] of kept) { P.fillText = fill; P.strokeText = stroke; }
    if (stand) for (const k of ["fillText", "strokeText"]) { if (own[k]) Object.defineProperty(ctx, k, own[k]); else delete ctx[k]; }
  }
}
/** The effects a column cannot be lettered with, painted in the look's own lettering there instead: Row shift cuts the line into level rows of the canvas, which a turned line has none of. */
export const NO_COLUMNS = ["rows"];

const spare = [];
/** A spare canvas the size of `like`, cleared. */
function scratch(i, like) {
  const c = spare[i] || (spare[i] = document.createElement("canvas"));
  if (c.width !== like.width || c.height !== like.height) { c.width = like.width; c.height = like.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, c.width, c.height);
  return x;
}
/** The house lettering: an offset shadow (down and right, see fall in style.js), an ink keyline, the fill. Also the base of the mask effects. */
function house(ctx, pass, o, fillToo = true) {
  const { fs, d } = o, [dx, dy] = fall(d, d);
  if (d > 0) pass((a, x) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiShadowCss : o.shadowCss; ctx.lineWidth = fs * 0.04; ctx.strokeText(a.t, x + dx, dy); ctx.fillText(a.t, x + dx, dy); });
  if (o.strokeAmt > 0) pass((a, x) => { ctx.strokeStyle = o.inkCss; ctx.lineWidth = fs * 0.075 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
  if (fillToo) pass((a, x) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiCss : o.fillCss; ctx.lineWidth = fs * 0.018; ctx.strokeText(a.t, x, 0); ctx.fillText(a.t, x, 0); });
}
/** Whether a CSS colour ("#rrggbb" or "rgb(…)") is near white. */
const whitish = (s) => { const h = /^#([0-9a-f]{6})$/i.exec(s || ""), c = h ? [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) : (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number); return c.length === 3 && c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 > 215; };
/**
 * Sticker lettering, as on variety shows' captions: the letters with a thin keyline (the Outline slider),
 * on a thick white rim that runs them into one cut-out — the small gaps inside and between them filled —
 * a dark line round that, and a hard shadow under it all (the Shadow slider). Strokes only, so it needs
 * no outlines and goes with any font. `o.beneath`, when given, paints what lies under the highlighted
 * words (plates, marks): on the rim, under the letters.
 */
function sticker(ctx, pass, o) {
  const { fs } = o, pale = [o.fillCss, o.hiCss].some(whitish), e1 = fs * 0.035 * Math.max(o.strokeAmt, pale ? 0.5 : 0), e2 = e1 + fs * 0.12, e3 = e2 + fs * 0.035, d = o.d * 1.3;   // pale letters keep a keyline, or they would melt into the rim
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  const ring = (half, css, [ax, ay] = [0, 0]) => pass((a, x) => { ctx.fillStyle = ctx.strokeStyle = css(a); ctx.lineWidth = half * 2; ctx.strokeText(a.t, x + ax, ay); ctx.fillText(a.t, x + ax, ay); });
  if (d > 0) ring(e3, (a) => (a.hi ? o.hiShadowCss : o.shadowCss), fall(d, d));
  ring(e3, () => INK);
  ring(e2, () => "#ffffff");
  if (o.beneath) { ctx.save(); o.beneath(); ctx.restore(); }   // the plates and marks under the highlighted words, on the rim rather than hidden by it
  if (e1 > 0) ring(e1, () => o.inkCss);
  pass((a, x) => { ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fillText(a.t, x, 0); });
  ctx.restore();
}

// ---------- mask effects
/** Whether a real canvas is behind the context (not the throw-away one used for measuring, and not a test double). */
const real = (ctx) => typeof document !== "undefined" && ctx.canvas && !ctx.canvas._probe && typeof ctx.getTransform === "function";
/** Paints the line's letters alone on a spare canvas, in place, and returns that canvas's context. */
function letters(ctx, pass, o, i = 0) {
  const x = scratch(i, ctx.canvas);
  x.setTransform(ctx.getTransform()); x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;
  pass((a, at) => { x.fillStyle = a.hi ? o.hiCss : o.fillCss; x.fillText(a.t, at, 0); });
  return x;
}
const lay = (ctx, from) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(from.canvas, 0, 0); ctx.restore(); };
const MASK = {
  /** Halftone inside the letters, growing toward their feet. */
  dots(ctx, x, o) {
    const fs = o.fs, pitch = fs * 0.085;
    x.globalCompositeOperation = "source-atop"; x.fillStyle = o.inkCss; x.beginPath();
    let row = 0;
    for (let y = -fs * 0.98; y < fs * 0.3; y += pitch * 0.5, row++) for (let px = -fs * 0.2 + (row % 2) * pitch * 0.5; px < o.lineW + fs * 0.2; px += pitch) {
      const r = Math.min(1, Math.max(0, (y + fs * 0.75) / (fs * 0.85))) * pitch * 0.5 * Math.min(1.4, o.amt);
      if (r > 0.6) { x.moveTo(px + r, y); x.arc(px, y, r, 0, Math.PI * 2); }
    }
    x.fill();
  },
  /** Slanted stripes inside the letters. */
  stripes(ctx, x, o) {
    const fs = o.fs, gap = fs * 0.17, wide = gap * 0.42 * Math.min(1.8, o.amt);
    x.globalCompositeOperation = "source-atop"; x.fillStyle = o.inkCss; x.beginPath();
    for (let px = -fs * 1.6; px < o.lineW + fs * 0.4; px += gap) { x.moveTo(px, fs * 0.3); x.lineTo(px + wide, fs * 0.3); x.lineTo(px + wide + fs * 1.3, -fs); x.lineTo(px + fs * 1.3, -fs); x.closePath(); }
    x.fill();
  },
  /** Bits of the letters missing, as on a print that has seen use: specks, and a scratch or two. */
  worn(ctx, x, o) {
    const fs = o.fs, n = Math.round((o.lineW / fs) * 70 * o.amt);
    x.globalCompositeOperation = "destination-out"; x.fillStyle = "#000";
    for (let k = 0; k < n; k++) {
      const px = noise(k * 1.31 + o.seed) * o.lineW, py = -fs * 0.95 + noise(k * 2.17 + o.seed) * fs * 1.2, r = fs * (0.006 + noise(k * 3.3 + o.seed) ** 3 * 0.05);
      x.beginPath(); x.ellipse(px, py, r * (1 + noise(k * 5.1) * 2), r, noise(k * 7.7) * 3, 0, Math.PI * 2); x.fill();
    }
    for (let k = 0; k < Math.round(2 * o.amt); k++) { const py = -fs * 0.85 + noise(k * 9.1 + o.seed) * fs; x.fillRect(noise(k * 4.4 + o.seed) * o.lineW * 0.6, py, o.lineW * (0.2 + noise(k * 6.6) * 0.4), Math.max(1, fs * 0.008)); }
  },
  /** A shadow falling inside the letters from their upper left edge, as if they were cut into the surface. */
  inner(ctx, x, o) {
    const d = o.fs * 0.045 * o.amt * o.unit, s = scratch(1, ctx.canvas);
    s.drawImage(x.canvas, 0, 0);
    s.globalCompositeOperation = "source-in"; s.fillStyle = o.inkCss; s.fillRect(0, 0, s.canvas.width, s.canvas.height);   // the letters, in ink
    s.globalCompositeOperation = "destination-out"; s.drawImage(x.canvas, d, d);                                          // less the letters moved down and right
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.6; x.drawImage(s.canvas, 0, 0); x.restore();
  },
};
function masked(ctx, pass, o, id) {
  if (!real(ctx)) return house(ctx, pass, o);
  if (id === "rows") {   // the keyline is part of what gets cut up
    const x = letters(ctx, () => {}, o);
    house(x, pass, o);
    const m = ctx.getTransform(), top = m.b * 0 + m.d * (-o.fs * 1.1) + m.f, foot = m.d * (o.fs * 0.4) + m.f, band = Math.max(3, o.fs * 0.1 * o.unit), W = ctx.canvas.width;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let y = Math.floor(Math.min(top, foot)), k = 0; y < Math.max(top, foot); y += band, k++) {
      const dx = (noise(k * 3.7 + o.seed) - 0.5) * 2 * o.fs * 0.07 * o.amt * o.unit * (noise(k * 1.9 + o.seed) > 0.45 ? 1 : 0);
      ctx.drawImage(x.canvas, 0, y, W, band, dx, y, W, band);
    }
    ctx.restore();
    return;
  }
  house(ctx, pass, o, false);                      // shadow and keyline as usual, underneath
  const x = letters(ctx, pass, o);
  MASK[id](ctx, x, o);
  lay(ctx, x);
}

// ---------- outline effects
/**
 * The outline of a run, placed and sized, letter by letter: [{ch, shapes, x0, x1, turn}] — the letter, its closed
 * polylines of [x, y] in the line's own units, and where it stands along the line; in a column (see inColumn), for a
 * letter standing upright, `turn`: what turns its polylines back upright where it stands (uprightTurn), applied
 * once they are reshaped (so a melting letter drips down the page); for one lying on its side, `lie` (see lying),
 * by which a reshaping that runs down the page (melting) sees it as the page has it. Null while it is on its way,
 * false if not to be had.
 */
function glyphShapes(ctx, a, at, o) {
  const glyphs = outline(ctx.font, a.t);
  if (!glyphs) return glyphs;
  const total = glyphs.reduce((s, g) => s + g.adv, 0), k = total > 0 ? ctx.measureText(a.t).width / (total * o.fs) : 1;   // fit the width the canvas gives the run
  const sy = a.s || 1, dy = a.dy || 0;   // a piece of Latin set larger and lower beside CJK (see setLine in title.js); the width has it already
  const out = [], step = o.fs * 0.06, chars = [...a.t], mid = COLUMN ? emMid(ctx) : 0;
  let pen = at;
  for (const [gi, g] of glyphs.entries()) {
    const shapes = [];
    for (const c of g.c) {
      const pts = [];
      for (let i = 0; i < c.length; i += 2) {
        const x = pen + c[i] * o.fs * k, y = c[i + 1] * o.fs * sy + dy, j = (i + 2) % c.length, nx = pen + c[j] * o.fs * k, ny = c[j + 1] * o.fs * sy + dy;
        pts.push([x, y]);
        const n = Math.min(24, Math.floor(Math.hypot(nx - x, ny - y) / step));   // long straight edges get points along them, so they can bend
        for (let s = 1; s < n; s++) pts.push([x + ((nx - x) * s) / n, y + ((ny - y) * s) / n]);
      }
      shapes.push(pts);
    }
    const ch = chars[gi] || "", x1 = pen + g.adv * o.fs * k, up = COLUMN && standsUp(ch);
    out.push({ ch, shapes, x0: pen, x1, turn: up ? uprightTurn(ch, shapes, (pen + x1) / 2, mid) : null, lie: COLUMN && !up ? lying((pen + x1) / 2, mid) : null });
    pen = x1;
  }
  return out;
}
/** A letter's polylines `shapes` (its own, or reshaped), turned back upright when it stands so in a column (see glyphShapes). */
const turned = (g, shapes) => (g.turn ? shapes.map(g.turn) : shapes);
/**
 * For a letter lying on its side in a column, about (cx, cy) in the line's units: {up, down}, functions of a polyline
 * — up turning it a quarter turn clockwise, as the page has it (down the column is then down), down turning it back.
 */
const lying = (cx, cy) => ({
  up: (pts) => pts.map(([x, y]) => [cx - (y - cy), cy + (x - cx)]),
  down: (pts) => pts.map(([x, y]) => [cx + (y - cy), cy - (x - cx)]),
});
/** The outline of a run as glyphShapes has it, all its letters' polylines together. */
function contours(ctx, a, at, o) {
  const g = glyphShapes(ctx, a, at, o);
  return g ? g.flatMap((x) => turned(x, x.shapes)) : g;
}
const trace = (ctx, shapes) => { ctx.beginPath(); for (const pts of shapes) { pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); } };
/**
 * The bends of the outline effects, each a map of a point of the line ([x, y]: x from 0 at its start to
 * `lineW`, y up from the baseline, negative) made from `o`; `amt` is how far it goes. `mid` is about the
 * middle of the letters' height, `u` where along the line x is (−1 at its start, 1 at its end, and no
 * further: what a lettering throws past the ends, a glow or a shadow, keeps the ends' bend rather than
 * flying off with a curve carried on past them). The bends are applied round the line too.
 */
const mid = (o) => -o.fs * 0.36;
const along = (o) => { const half = Math.max(1, o.lineW / 2); return (x) => Math.max(-1, Math.min(1, (x - half) / half)); };
export const WARP = {
  arc: (o) => { const lift = o.fs * 0.32 * o.amt, u = along(o); return ([x, y]) => [x, y - lift * (1 - u(x) ** 2) + lift * 0.45]; },
  /** The arch the other way: the middle of the line dips. */
  arcLow: (o) => { const lift = o.fs * 0.32 * o.amt, u = along(o); return ([x, y]) => [x, y + lift * (1 - u(x) ** 2) - lift * 0.45]; },
  /** The line laid round a circle whose centre is below it: the letters fan out, wider at the top. */
  circle: (o) => {
    const span = Math.min(2.4, Math.max(0.05, 0.62 * o.amt)), half = Math.max(1, o.lineW / 2), R = Math.max(o.fs, o.lineW / span);
    const lift = R * (1 - Math.cos(Math.min(Math.PI, half / R))) * 0.45;   // the ends drop: the whole a little up, so it stays about where it was
    return ([x, y]) => { const a = (x - half) / R, r = Math.max(R * 0.2, R - y); return [half + r * Math.sin(a), R - r * Math.cos(a) - lift]; };   // nothing through the centre
  },
  /** The baseline straight, the tops of the letters arching up toward the middle. */
  shell: (o) => { const k = 0.45 * o.amt, u = along(o); return ([x, y]) => [x, y < 0 ? y * (1 + k * (1 - u(x) ** 2)) : y]; },
  /** The letters taller toward the middle of the line, above and below. */
  bulge: (o) => { const k = 0.38 * o.amt, u = along(o), m = mid(o); return ([x, y]) => [x, m + (y - m) * (1 + k * (1 - u(x) ** 2))]; },
  /** The letters shorter toward the middle of the line. */
  pinch: (o) => { const k = Math.min(0.7, 0.32 * o.amt), u = along(o), m = mid(o); return ([x, y]) => [x, m + (y - m) * (1 - k * (1 - u(x) ** 2))]; },
  /**
   * A lens over the middle of the line: what is under it larger, easing off toward its rim, which lies a
   * little past the ends of the line and the letters' height, so the ends move out only a little and the
   * letters near them are not squeezed thin. Along every ray from the middle the points keep their order
   * (the stretch along it, 1 + k(1 − s)(1 − 5s) at s = r², is at least 1 − 0.8k), so nothing folds over.
   */
  fisheye: (o) => {
    const k = Math.min(0.45, 0.4 * o.amt), half = Math.max(1, o.lineW / 2), rx = half * 1.15, m = mid(o), ry = o.fs * 1.1;
    return ([x, y]) => { const dx = x - half, dy = y - m, s = (dx / rx) ** 2 + (dy / ry) ** 2; if (s >= 1) return [x, y]; const f = 1 + k * (1 - s) ** 2; return [half + dx * f, m + dy * f]; };
  },
  /** The line climbing to the right, its upright strokes kept upright. */
  rise: (o) => { const half = Math.max(1, o.lineW / 2), slope = Math.min(0.3, (0.55 * o.fs * o.amt) / Math.max(o.fs, o.lineW)); return ([x, y]) => [x, y - slope * (x - half)]; },
  taper: (o) => { const k = Math.min(0.75, 0.42 * o.amt), mid = -o.fs * 0.36, W = Math.max(1, o.lineW); return ([x, y]) => { const s = 1 - k * Math.max(0, Math.min(1, x / W)); return [x, mid + (y - mid) * s]; }; },
  wave: (o) => { const lift = o.fs * 0.11 * o.amt, len = o.fs * 2.4; return ([x, y]) => [x, y + lift * Math.sin((x / len) * Math.PI * 2)]; },
  /** A flag on its pole at the start of the line: it waves more the further from the pole, swelling and narrowing as it goes. */
  flag: (o) => {
    const lift = o.fs * 0.14 * o.amt, len = o.fs * 3.2, m = mid(o), W = Math.max(1, o.lineW);
    return ([x, y]) => { const ramp = 0.25 + 0.75 * Math.min(1, Math.max(0, x / W)), a = (x / len) * Math.PI * 2; return [x, m + (y - m) * (1 + 0.12 * o.amt * ramp * Math.cos(a)) + lift * ramp * Math.sin(a)]; };
  },
};
/** The corners a block's perspective moves to, as fractions of its size: the layer's own, or the plain taper's. */
export function warpCorners(warp, amt = 1) {
  if (Array.isArray(warp) && warp.length === 4) return warp;
  const k = Math.min(0.75, 0.42 * amt) * 0.4;   // about what the plain taper does to a single line
  return [[0, 0], [0, k], [0, -k], [0, 0]];
}
/**
 * Whether the block's corners moved by `warp` (as warpCorners gives them) still make a quad that does not
 * fold over: every corner turning the same way, and not by too little (no edge shrunk to about a point). A
 * folded one would throw the lettering past the perspective's horizon.
 */
export function convexWarp(warp) {
  const q = warp.map(([dx, dy], i) => [[0, 1, 1, 0][i] + dx, [0, 0, 1, 1][i] + dy]);
  const turns = q.map((p, i) => { const a = q[(i + 1) % 4], b = q[(i + 2) % 4]; return (a[0] - p[0]) * (b[1] - a[1]) - (a[1] - p[1]) * (b[0] - a[0]); });
  return turns.every((t) => t > 0.1) || turns.every((t) => t < -0.1);
}
/** The projective map of the unit square onto quad q (corners in the order top left, top right, bottom right, bottom left). */
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const den = dx1 * dy2 - dx2 * dy1;
  if ((dx3 || dy3) && Math.abs(den) > 1e-9) { g = (dx3 * dy2 - dx2 * dy3) / den; h = (dx1 * dy3 - dx3 * dy1) / den; }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v) => { const w = Math.max(0.05, g * u + h * v + 1); return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
}
/** The layer's own perspective as a point map in the line's space (see `frame` and `warp` above). */
function perspective(o) {
  const { ox, oy, c, box } = o.frame, W = Math.max(1, box.w), H = Math.max(1, box.h);
  const map = squareToQuad(o.warp.map(([dx, dy], i) => [box.x + ([0, 1, 1, 0][i] + dx) * W, box.y + ([0, 0, 1, 1][i] + dy) * H]));
  return ([x, y]) => {
    const X = ox + x + c * y, Y = oy + y;                          // into the block's space
    const [X2, Y2] = map((X - box.x) / W, (Y - box.y) / H);
    const y2 = Y2 - oy;
    return [X2 - ox - c * y2, y2];                                 // and back
  };
}
// ---------- reshaped edges
/** The area of a closed polyline, signed: its sign tells which way round it runs. */
export const areaOf = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/**
 * Points along a closed polyline: about `step` apart (step() for a gap of its own each time), the corners it
 * turns (by more than 40°) kept where they are, each {x, y, nx, ny, s} — with the unit normal pointing away
 * from the ink, and how far along it lies. `side` is the sign of the area of the glyph's outer outlines: away
 * from the ink is outward round those, inward round the holes, which run the other way. The whole length is
 * the array's `len`. Null for a polyline of fewer than three points.
 */
export function walk(pts, step, side) {
  const n = pts.length;
  if (n < 3) return null;
  const turn = (i) => {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n], ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1], lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    return lu && lv ? Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv)))) : 0;
  };
  let corners = [];
  for (let i = 0; i < n; i++) if (turn(i) > 0.7) corners.push(i);
  if (!corners.length) corners = [0];
  const gap = typeof step === "function" ? step : () => step, out = [];
  let s0 = 0;
  for (let ci = 0; ci < corners.length; ci++) {   // corner to corner: the gaps evened out to end on the next one
    const to = corners[(ci + 1) % corners.length], piece = [pts[corners[ci]]];
    for (let i = (corners[ci] + 1) % n; ; i = (i + 1) % n) { piece.push(pts[i]); if (i === to) break; }
    const cum = [0];
    for (let i = 1; i < piece.length; i++) cum.push(cum[i - 1] + Math.hypot(piece[i][0] - piece[i - 1][0], piece[i][1] - piece[i - 1][1]));
    const L = cum[cum.length - 1];
    if (L <= 0) continue;
    const gaps = [];
    for (let t = 0; t < L; ) { const g = Math.max(1e-6, gap()); gaps.push(g); t += g; }
    if (gaps.length > 1 && gaps.reduce((a, b) => a + b, 0) - L > gaps[gaps.length - 1] / 2) gaps.pop();   // the nearer of the two counts
    const f = L / gaps.reduce((a, b) => a + b, 0);
    let t = 0, j = 1;
    for (const g of gaps) {
      while (j < cum.length - 1 && cum[j] < t) j++;
      const p = piece[j - 1], q = piece[j], u = cum[j] > cum[j - 1] ? (t - cum[j - 1]) / (cum[j] - cum[j - 1]) : 0;
      out.push({ x: p[0] + (q[0] - p[0]) * u, y: p[1] + (q[1] - p[1]) * u, s: s0 + t });
      t += g * f;
    }
    s0 += L;
  }
  if (out.length < 3) return null;
  for (let i = 0; i < out.length; i++) {
    const a = out[(i - 1 + out.length) % out.length], b = out[(i + 1) % out.length], tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    out[i].nx = (side * ty) / l; out[i].ny = (-side * tx) / l;
  }
  out.len = s0;
  return out;
}
/** Smooth noise round a loop `len` long, a bump about every `wave`, from R: a function of how far along, about −1 to 1. */
function loopNoise(R, len, wave) {
  const k = Math.max(3, Math.round(len / Math.max(1e-6, wave))), v = Array.from({ length: k }, () => R() * 2 - 1);
  return (s) => { const u = ((((s / len) * k) % k) + k) % k, i = Math.floor(u), f = u - i, e = f * f * (3 - 2 * f); return v[i % k] * (1 - e) + v[(i + 1) % k] * e; };
}
const moved = (w, d) => w.map((p, i) => { const k = d(p, i); return [p.x + p.nx * k, p.y + p.ny * k]; });
/**
 * A letter's `side` (see walk) and `k`, how heavy its strokes are, 0.4 to 1: their mean width (twice the ink over
 * the outline's length) against a bold Latin letter's. Spikes, tears, cuts, drips and puffing go by it, so the
 * many thin strokes of a Chinese character, close together, are not run into one another.
 */
export function weighOf(shapes, fs) {
  let big = 0, ink = 0, len = 0;
  for (const pts of shapes) {
    const A = areaOf(pts);
    if (Math.abs(A) > Math.abs(big)) big = A;
    ink += A;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; len += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  }
  return { side: Math.sign(big) || 1, k: len > 0 ? Math.max(0.4, Math.min(1, (2 * Math.abs(ink)) / len / (0.13 * fs))) : 1 };
}
/** Whether a point is in a letter's ink (its outlines filled by the non-zero rule). */
function inkTest(shapes) {
  const boxes = shapes.map((pts) => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]));
  return (x, y) => {
    let w = 0;
    shapes.forEach((pts, si) => {
      const b = boxes[si];
      if (y < b[1] || y > b[3] || x > b[2]) return;   // its edges all miss the ray rightward from the point
      for (let i = 0, n = pts.length; i < n; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n], side = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y0 <= y) { if (y1 > y && side > 0) w++; } else if (y1 <= y && side < 0) w--;
      }
    });
    return w !== 0;
  };
}
/**
 * The outline effects that reshape the edges of the letters: id -> { join, shape(g, R, o) }, shape taking a
 * letter as glyphShapes gives it, with `side` and `k` (see weighOf), and giving its new polylines; R its own random numbers,
 * drawn from the letter, which of its kind on the line it is, the line and the layer's fxSeed — the same every
 * time the cover is drawn, others after Reshuffle. `o.amt` is how far it goes; `join` how the keyline meets at
 * the corners; `down`, that it runs down the page, in a column too (see reshapeRun). (Puffed up needs no new
 * outline: see outlined.)
 */
export const SHAPED = {
  /**
   * Thorns along every edge, outward, of lengths and spacings of their own; shorter into the holes, and never
   * more than about half the way to the next ink, so thorns from the two sides of a gap do not meet.
   */
  spiky: { join: "miter", shape: (g, R, o) => {
    const fs = o.fs, inside = inkTest(g.shapes);
    return g.shapes.map((pts) => {
      const w = walk(pts, () => fs * (0.07 + R() * 0.08), g.side), hole = Math.sign(areaOf(pts)) !== g.side;
      if (!w) return pts;
      const out = [];
      w.forEach((p, i) => {
        const q = w[(i + 1) % w.length], l = Math.hypot(p.nx + q.nx, p.ny + q.ny) || 1, ux = (p.nx + q.nx) / l, uy = (p.ny + q.ny) / l, mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        let L = fs * 0.13 * o.amt * g.k * (0.25 + 0.75 * R() ** 0.7) * (hole ? 0.5 : 1);
        if (R() < 0.18) L *= 0.25;   // now and then a short one
        const reach = L / 0.45, by = Math.max(fs * 0.012, reach / 12);
        for (let d = by; d <= reach; d += by) if (inside(mx + ux * d, my + uy * d)) { L = Math.min(L, d * 0.45); break; }
        out.push([p.x, p.y]);
        if (L > fs * 0.008) out.push([mx + ux * L, my + uy * L]);
      });
      return out;
    });
  } },
  /** A torn paper edge: the line wanders in and out, in long waves and fine teeth. */
  torn: { join: "round", shape: (g, R, o) => g.shapes.map((pts) => {
    const fs = o.fs, w = walk(pts, fs * 0.016, g.side);
    if (!w) return pts;
    const low = loopNoise(R, w.len, fs * 0.14), A = fs * 0.035 * o.amt * g.k;
    return moved(w, (p) => A * (0.65 * low(p.s) + 0.35 * (R() * 2 - 1)));
  }) },
  /** Cut out with scissors: curves become runs of straight cuts, a little off the line, the letter laid down a little askew. */
  cut: { join: "miter", shape: (g, R, o) => {
    const fs = o.fs, tilt = (R() - 0.5) * 0.18 * o.amt, lift = (R() - 0.5) * fs * 0.06 * o.amt, cx = (g.x0 + g.x1) / 2, cy = -fs * 0.36, c = Math.cos(tilt), sn = Math.sin(tilt);
    return g.shapes.map((pts) => {
      const w = walk(pts, () => fs * (0.08 + R() * 0.12), g.side);
      return (w ? moved(w, () => (R() - 0.5) * fs * 0.035 * o.amt * g.k) : pts).map(([x, y]) => [cx + (x - cx) * c - (y - cy) * sn, cy + (x - cx) * sn + (y - cy) * c + lift]);
    });
  } },
  /** Melting: the undersides sag, and run down in drips from the lowest of them. */
  melt: { join: "round", down: true, shape: (g, R, o) => {
    const fs = o.fs, a = o.amt, walks = g.shapes.map((pts) => walk(pts, fs * 0.012, g.side)), all = walks.filter(Boolean).flat();
    if (!all.length) return g.shapes;
    const foot = Math.max(...all.map((p) => p.y)), under = all.filter((p) => p.ny > 0.8), drips = [];
    for (let k = Math.min(4, 1 + Math.floor(R() * (1 + 1.6 * a))); k > 0 && under.length; k--) {
      let p = under[Math.floor(R() * under.length)];
      for (let t = 0; t < 6 && R() < 0.7 && p.y < foot - fs * 0.12; t++) p = under[Math.floor(R() * under.length)];   // mostly from the lowest undersides
      drips.push({ x: p.x, y: p.y, w: fs * (0.03 + 0.04 * R()) * g.k, L: fs * a * (0.1 + 0.4 * R() ** 1.4) });
    }
    return walks.map((w, i) => (!w ? g.shapes[i] : w.map((p) => {
      if (p.ny <= 0.2) return [p.x, p.y];
      let dy = fs * 0.018 * a * g.k * p.ny;   // the sag
      for (const d of drips) { const u = (p.x - d.x) / d.w; if (Math.abs(u) < 1 && Math.abs(p.y - d.y) < fs * 0.07) dy += d.L * (1 - u * u) ** 2 * Math.min(1, (p.ny - 0.2) / 0.5); }
      return [p.x, p.y + dy];
    })));
  } },
  /** Eaten away: pits bitten into the edges here and there, and a fine grain all along them. */
  eroded: { join: "round", shape: (g, R, o) => g.shapes.map((pts) => {
    const fs = o.fs, w = walk(pts, fs * 0.01, g.side);
    if (!w) return pts;
    const pit = loopNoise(R, w.len, fs * 0.09);
    return moved(w, (p) => -fs * 0.045 * o.amt * g.k * Math.max(0, (pit(p.s) - 0.1) / 0.9) ** 1.4 - fs * 0.004 * o.amt * R());
  }) },
};
const SHAPES = new Map();   // reshaped runs, kept by what made them: a cover redrawn does not work them out again
/**
 * How far an effect's letters reach past the type, in type sizes at strength `amt`: {x (each side), up, down} —
 * thorns, tears, cuts, drips, puffing — for the box a lettering is caught by and drawn into (its look effects too).
 */
export function effectReach(id, amt = 1) {
  const a = Math.max(0, amt), all = (v) => ({ x: v * a, up: v * a, down: v * a });
  return { spiky: all(0.13), torn: all(0.04), cut: all(0.08), puffy: all(0.042), melt: { x: 0.02 * a, up: 0, down: 0.55 * a } }[id] || { x: 0, up: 0, down: 0 };
}
/**
 * A run's letters reshaped by SHAPED[id] (seen: how many of each letter the line has had before it); one that runs
 * down the page (`down`) reshapes a letter lying on its side in a column as the page has it (its `lie`), so it
 * drips down the column as an upright one does.
 */
function reshapeRun(glyphs, id, o, seen, key) {
  const k = [key, id, o.fs, o.amt, o.fxSeed || 0, o.row || 0, JSON.stringify(seen)].join("|");
  if (SHAPES.has(k)) { for (const g of glyphs) seen[g.ch] = (seen[g.ch] || 0) + 1; return SHAPES.get(k); }
  const out = glyphs.flatMap((g) => {
    const n = (seen[g.ch] = (seen[g.ch] || 0) + 1);
    if (!g.shapes.length) return [];
    const lie = SHAPED[id].down && g.lie, shapes = lie ? g.shapes.map(lie.up) : g.shapes;
    const got = SHAPED[id].shape({ ...g, shapes, ...weighOf(shapes, o.fs) }, seeded(hash(`${o.fxSeed || 0}|${o.row || 0}|${g.ch}|${n}`)), o);
    return turned(g, lie ? got.map(lie.down) : got);
  });
  if (SHAPES.size > 120) SHAPES.delete(SHAPES.keys().next().value);
  SHAPES.set(k, out);
  return out;
}
function outlined(ctx, pass, o, id) {
  const runs = [], seen = {};
  let ready = true;
  pass((a, at) => {
    const g = glyphShapes(ctx, a, at, o);
    if (!g) ready = false;
    if (g === null) stopgaps++;
    runs.push([a, g && (SHAPED[id] ? reshapeRun(g, id, o, seen, [ctx.font, a.t, at, a.s || 1, a.dy || 0, ctx.measureText(a.t).width.toFixed(2), COLUMN ? "column" : ""].join("|")) : id === "puffy" ? g : g.flatMap((x) => turned(x, x.shapes)))]);
  });
  if (!ready) return house(ctx, pass, o);          // not arrived yet, or not to be had: ordinary lettering meanwhile
  ctx.lineJoin = "round";
  if (id === "puffy") {
    // Puffed up: each letter grown all round by r (less for thin strokes close together, see weighOf), every
    // corner rounded — its outline stroked that wide with round joins, under the fill; the shadows, then the
    // keylines round the grown letters, then the letters, each over all of the one before
    const key = o.strokeAmt > 0 ? o.fs * 0.075 * o.strokeAmt : 0, letters = runs.flatMap(([a, glyphs]) => glyphs.filter((g) => g.shapes.length).map((g) => [a, turned(g, g.shapes), o.fs * 0.042 * o.amt * weighOf(g.shapes, o.fs).k]));
    const each = (fn) => { for (const [a, shapes, r] of letters) { trace(ctx, shapes); fn(a, r); } };
    if (o.d > 0) { ctx.save(); ctx.translate(...fall(o.d, o.d)); each((a, r) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiShadowCss : o.shadowCss; ctx.lineWidth = 2 * r + key; ctx.fill(); ctx.stroke(); }); ctx.restore(); }
    if (key) each((a, r) => { ctx.strokeStyle = o.inkCss; ctx.lineWidth = 2 * r + key; ctx.stroke(); });
    each((a, r) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? o.hiCss : o.fillCss; ctx.lineWidth = 2 * r; ctx.stroke(); ctx.fill(); });
    return;
  }
  if (SHAPED[id]) { ctx.lineJoin = SHAPED[id].join; ctx.miterLimit = 8; }
  if (id === "extrude") {
    // Real depth: every edge of the outline is swept back into a wall. Walls facing one way are
    // lit and those facing the other shaded, and each group is filled as one shape. Back down and to the right,
    // as the page has it (fall in style.js).
    const d = o.fs * 0.11 * o.amt * Math.max(0.3, o.shadowAmt), [dx, dy] = fall(d, d * 0.85);
    for (const [a, shapes] of runs) {
      const lit = [], shade = [];
      for (const pts of shapes) for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[(i + 1) % pts.length];
        ((q[0] - p[0]) * dy - (q[1] - p[1]) * dx > 0 ? lit : shade).push([p, q, [q[0] + dx, q[1] + dy], [p[0] + dx, p[1] + dy]]);
      }
      const base = a.hi ? o.hiShadowCss : o.shadowCss;
      for (const [walls, alpha] of [[shade, 1], [lit, 0.72]]) {
        ctx.save(); ctx.globalAlpha *= alpha; ctx.fillStyle = ctx.strokeStyle = base; ctx.lineWidth = 1; trace(ctx, walls); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(dx, dy); ctx.fillStyle = ctx.strokeStyle = base; ctx.lineWidth = 1; trace(ctx, shapes); ctx.fill(); ctx.stroke(); ctx.restore();   // the back face
    }
  }
  for (const [a, bent] of runs) {
    if (id !== "extrude" && o.d > 0) { ctx.save(); ctx.translate(...fall(o.d, o.d)); ctx.fillStyle = a.hi ? o.hiShadowCss : o.shadowCss; trace(ctx, bent); ctx.fill(); ctx.restore(); }
    trace(ctx, bent);
    if (o.strokeAmt > 0) { ctx.strokeStyle = o.inkCss; ctx.lineWidth = o.fs * 0.075 * o.strokeAmt; ctx.stroke(); }
    ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fill();
  }
}

// ---------- bends
/**
 * The map of a bend over the line's points (see WARP; `o` as paintRuns', `o.amt` how far): the layer's own
 * perspective for "taper" when it has corners of its own, else the bend's. Null when there is none.
 */
export function bendMap(id, o) {
  if (id === "taper" && o.warp && o.frame) return perspective(o);
  const map = WARP[id] ? WARP[id](o) : null;
  if (!map || id === "taper" || !o.reshape || !o.frame) return map;
  // the user's reshaping on top: the offset of the block's handles, at where the point was before the bend
  const { ox, oy, c, box } = o.frame, field = reshapeField(o.reshape, box);
  return ([x, y]) => { const [x2, y2] = map([x, y]), [dX, dY] = field(ox + x + c * y, oy + y); return [x2 + dX - c * dY, y2 + dY]; };
}
/**
 * The user's reshaping of a bend (`reshape`: 8 × [dx, dy], fractions of the block's size: how far each of
 * its handles was dragged — 4 along the top edge, left to right, then 4 along the bottom) as the offset it
 * gives a point (X, Y) of the block, in the block's space: along each edge a smooth curve through its four
 * (Catmull-Rom, so a handle dragged moves the edge under it exactly and its neighbours' little), between
 * the edges in proportion, and past them as at them.
 */
export function reshapeField(reshape, box) {
  const W = Math.max(1, box.w), H = Math.max(1, box.h), D = reshape.map(([dx, dy]) => [dx * W, dy * H]);
  const curve = (P, u) => {
    const s = Math.min(2, Math.floor(u * 3)), t = u * 3 - s;
    const at = (i) => (i < 0 ? [2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]] : i > 3 ? [2 * P[3][0] - P[2][0], 2 * P[3][1] - P[2][1]] : P[i]);
    const a = at(s - 1), b = at(s), c = at(s + 1), d = at(s + 2);
    return [0, 1].map((k) => 0.5 * (2 * b[k] + (c[k] - a[k]) * t + (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t + (3 * b[k] - a[k] - 3 * c[k] + d[k]) * t * t * t));
  };
  const top = D.slice(0, 4), foot = D.slice(4, 8), unit = (v) => Math.max(0, Math.min(1, v));
  return (X, Y) => { const u = unit((X - box.x) / W), v = unit((Y - box.y) / H), a = curve(top, u), b = curve(foot, u); return [a[0] + (b[0] - a[0]) * v, a[1] + (b[1] - a[1]) * v]; };
}
/**
 * Where a bend's handles lie before the user drags any (`bend` {id, amt}; the lines set at `fs`, slanted by
 * `c`, in `box`; `first` and `last` {ox, oy, lineW} the first line's and the last's): 4 along the block's
 * top edge as the first line bends it, then 4 along its bottom as the last does; in the block's space.
 * Past the ends of a line shorter than the block they keep level with its ends, rather than follow a
 * curve on round into empty space.
 */
export function bendRest(bend, fs, c, box, first, last) {
  const out = [];
  for (const [row, ln] of [[0, first], [1, last]]) {
    const map = WARP[bend.id] ? WARP[bend.id]({ fs, amt: bend.amt, lineW: ln.lineW }) : (p) => p;
    for (let i = 0; i < 4; i++) {
      const Y = box.y + row * box.h, y = Y - ln.oy, x = box.x + (i / 3) * box.w - ln.ox - c * y;   // into the line's space
      const on = Math.max(0, Math.min(ln.lineW, x)), [x2, y2] = map([on, y]);
      out.push([ln.ox + x2 + (x - on) + c * y2, ln.oy + y2]);
    }
  }
  return out;
}
/** The handles of a reshaped bend where they are now: `rest` (bendRest) moved by `reshape`, in the block's space. */
export const reshaped = (rest, reshape, box) => rest.map(([x, y], i) => { const [dx, dy] = (reshape && reshape[i]) || [0, 0]; return [x + dx * box.w, y + dy * box.h]; });
/** How far a line `lineW` wide set at `fs` reaches past its own box once bent ({up, down, left, right}, in units, never below 0): the image of the box's edge. */
export function bendExtent(id, amt, lineW, fs) {
  const map = WARP[id] && WARP[id]({ fs, amt, lineW });
  const out = { up: 0, down: 0, left: 0, right: 0 };
  if (!map) return out;
  const top = -fs * 0.92, foot = fs * 0.25, n = 40;
  const seen = (x, y) => { const [X, Y] = map([x, y]); out.up = Math.max(out.up, top - Y); out.down = Math.max(out.down, Y - foot); out.left = Math.max(out.left, -X); out.right = Math.max(out.right, X - lineW); };
  for (let i = 0; i <= n; i++) { const x = (lineW * i) / n, y = top + ((foot - top) * i) / n; seen(x, top); seen(x, foot); seen(0, y); seen(lineW, y); }
  return out;
}
/**
 * A picture bent: `src` ({data, width, height}, RGBA as getImageData gives it) shows the rectangle `rect`
 * of the line's space ({x, y, w, h}) at `k` pixels a unit; `map` takes a point of the line to where it
 * goes. Returns the bent picture likewise ({data, width, height, rect}), its rectangle the image of the
 * source's. The source is cut into triangles a cell (in pixels) across; each pixel of the result is read
 * back through the triangle it falls in to its place in the source, and sampled there between the four
 * pixels round it — colours weighted by their opacity, so edges keep no dark fringe. Every pixel written
 * once and from one place, so the triangles leave no seams. Cells with nothing in them (with a cell
 * round them, for the sampling) are passed over, and where they go does not count. A map that throws
 * the picture very far (a perspective dragged past its horizon) gets a coarser result, not a huge one.
 */
const WARP_PX = 24e6, WARP_SIDE = 8192;
export function meshWarp(src, rect, k, map, cell = 16) {
  const { data: S, width: sw, height: sh } = src;
  const nx = Math.max(1, Math.ceil(sw / cell)), ny = Math.max(1, Math.ceil(sh / cell));
  // which cells have anything in them
  const full = new Uint8Array(nx * ny);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (S[(y * sw + x) * 4 + 3]) full[((y / cell) | 0) * nx + ((x / cell) | 0)] = 1;
  const near = (i, j) => { for (let b = Math.max(0, j - 1); b <= Math.min(ny - 1, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx - 1, i + 1); a++) if (full[b * nx + a]) return true; return false; };
  // the grid's points, in the line's space before and after
  const at = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const px = Math.min(sw, i * cell), py = Math.min(sh, j * cell), lx = rect.x + px / k, ly = rect.y + py / k, [X, Y] = map([lx, ly]);
    at.push({ px, py, X, Y });
  }
  const pt = (i, j) => at[j * (nx + 1) + i];
  // the cells to bend, and where their corners go
  const cells = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!near(i, j)) continue;
    cells.push([i, j]);
    for (const p of [pt(i, j), pt(i + 1, j), pt(i, j + 1), pt(i + 1, j + 1)]) { x0 = Math.min(x0, p.X); y0 = Math.min(y0, p.Y); x1 = Math.max(x1, p.X); y1 = Math.max(y1, p.Y); }
  }
  if (!cells.length) return { data: new Uint8ClampedArray(4), width: 1, height: 1, rect: { x: rect.x, y: rect.y, w: 1 / k, h: 1 / k } };
  const spanX = Math.max(1e-6, x1 - x0), spanY = Math.max(1e-6, y1 - y0);
  const ko = Math.min(k, Math.sqrt(WARP_PX / (spanX * spanY)), WARP_SIDE / spanX, WARP_SIDE / spanY);   // the result's pixels a unit
  const W = Math.max(1, Math.ceil(spanX * ko)), H = Math.max(1, Math.ceil(spanY * ko)), D = new Uint8ClampedArray(W * H * 4);
  const sample = (sx, sy, o) => {   // between the four pixels round (sx, sy), in source pixel centres
    const fx = Math.min(sw - 1, Math.max(0, sx - 0.5)), fy = Math.min(sh - 1, Math.max(0, sy - 0.5)), ix = Math.min(sw - 2, fx | 0), iy = Math.min(sh - 2, fy | 0);
    const tx = sw > 1 ? fx - ix : 0, ty = sh > 1 ? fy - iy : 0;
    const q0 = (iy * sw + ix) * 4, q1 = q0 + (sw > 1 ? 4 : 0), q2 = q0 + (sh > 1 ? sw * 4 : 0), q3 = q2 + (sw > 1 ? 4 : 0);
    const a0 = S[q0 + 3] * (1 - tx) * (1 - ty), a1 = S[q1 + 3] * tx * (1 - ty), a2 = S[q2 + 3] * (1 - tx) * ty, a3 = S[q3 + 3] * tx * ty, a = a0 + a1 + a2 + a3;
    if (a > 0) {
      D[o] = (S[q0] * a0 + S[q1] * a1 + S[q2] * a2 + S[q3] * a3) / a;
      D[o + 1] = (S[q0 + 1] * a0 + S[q1 + 1] * a1 + S[q2 + 1] * a2 + S[q3 + 1] * a3) / a;
      D[o + 2] = (S[q0 + 2] * a0 + S[q1 + 2] * a1 + S[q2 + 2] * a2 + S[q3 + 2] * a3) / a;
      D[o + 3] = a;
    }
  };
  const tri = (A, B, C) => {
    // A, B, C: grid points; to the result's pixels
    const ax = (A.X - x0) * ko, ay = (A.Y - y0) * ko, bx = (B.X - x0) * ko, by = (B.Y - y0) * ko, cx = (C.X - x0) * ko, cy = (C.Y - y0) * ko;
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(den) < 1e-9) return;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx))), minY = Math.max(0, Math.floor(Math.min(ay, by, cy))), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
    const e = -1e-6 * Math.abs(den);
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const qx = x + 0.5, qy = y + 0.5;
      const l0 = (by - cy) * (qx - cx) + (cx - bx) * (qy - cy), l1 = (cy - ay) * (qx - cx) + (ax - cx) * (qy - cy);
      const u = den > 0 ? l0 : -l0, v = den > 0 ? l1 : -l1, w = (den > 0 ? den : -den) - u - v;
      if (u < e || v < e || w < e) continue;
      const a0 = l0 / den, a1 = l1 / den, a2 = 1 - a0 - a1;
      sample(a0 * A.px + a1 * B.px + a2 * C.px, a0 * A.py + a1 * B.py + a2 * C.py, (y * W + x) * 4);
    }
  };
  for (const [i, j] of cells) {
    const p00 = pt(i, j), p10 = pt(i + 1, j), p01 = pt(i, j + 1), p11 = pt(i + 1, j + 1);
    tri(p00, p10, p11); tri(p00, p11, p01);
  }
  return { data: D, width: W, height: H, rect: { x: x0, y: y0, w: W / ko, h: H / ko } };
}
const BENT = new Map();   // painted lines, bent: key -> {img, rect}; the newest last
let bentPx = 0;
const BENT_PX = 24e6;     // how many pixels of them are kept
/**
 * Paints a line bent (`o.bend`: {id, amt}; `o` as paintRuns' — fs, lineW, unit, and frame and warp for the
 * layer's own perspective). `paint(c, unit)` paints the line as it would be, in the line's space, on context
 * c whose pixels are `unit` a unit: on a canvas of its own, round the line with room for what a lettering
 * throws round it (glows, shadows, depth), a little finer than the canvas below so the stretched parts
 * stay sharp (coarser while something is dragged, for speed). That picture is bent (meshWarp) and laid on `ctx`. The bent picture is kept by what it
 * shows (`key`, given by the caller with whatever else decides how the line looks), so a line moved,
 * turned or the cover redrawn for another reason is laid down again without being made again.
 */
export function bentLine(ctx, o, key, paint) {
  const map = bendMap(o.bend.id, { ...o, amt: o.bend.amt });
  if (!map || !real(ctx)) return paint(ctx, o.unit);
  const fs = o.fs, P = fs * 0.75, rect = { x: -P, y: -fs * 1.25 - P, w: o.lineW + 2 * P, h: fs * 1.7 + 2 * P };
  // finer than the canvas below on screen, as fine on an export; coarser while something is dragged
  const k = Math.min(o.unit * (isFast() ? 0.6 : o.unit >= 1.6 ? 1 : 1.5), 4096 / rect.w, 4096 / rect.h);
  const id = [key, look().id, JSON.stringify(lookValues()), lookState(), isFast() ? 1 : 0, o.bend.id, o.bend.amt, JSON.stringify(o.warp || null), JSON.stringify(o.reshape || null), o.frame ? [o.frame.ox, o.frame.oy, o.frame.c, o.frame.box.x, o.frame.box.y, o.frame.box.w, o.frame.box.h].map((v) => Math.round(v * 10)).join() : "", o.lineW.toFixed(1), fs, k.toFixed(3), FONTS_SEEN, ransomEpoch()].join("|");
  let got = BENT.get(id);
  if (got) { BENT.delete(id); BENT.set(id, got); }
  else {
    const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.ceil(rect.w * k)), height: Math.max(1, Math.ceil(rect.h * k)) });
    const x = c.getContext("2d", { willReadFrequently: true });
    for (const p of ["font", "textAlign", "textBaseline", "lineJoin", "lineCap", "miterLimit", "letterSpacing"]) if (p in ctx) try { x[p] = ctx[p]; } catch (e) { /* not settable here */ }
    x.setTransform(k, 0, 0, k, -rect.x * k, -rect.y * k);
    const before = stopgaps;
    paint(x, k);
    const bent = meshWarp(x.getImageData(0, 0, c.width, c.height), rect, k, map, Math.max(6, Math.round(fs * k / 9)));
    const out = Object.assign(document.createElement("canvas"), { width: bent.width, height: bent.height });
    out.getContext("2d").putImageData(new ImageData(bent.data, bent.width, bent.height), 0, 0);
    got = { img: out, rect: bent.rect };
    if (stopgaps === before) {   // a line painted while its outlines were on their way is not kept: they will be drawn when they arrive
      BENT.set(id, got); bentPx += bent.width * bent.height;
      for (const [kk, v] of BENT) { if (bentPx <= BENT_PX || BENT.size <= 1) break; bentPx -= v.img.width * v.img.height; BENT.delete(kk); }
    }
  }
  ctx.drawImage(got.img, got.rect.x, got.rect.y, got.rect.w, got.rect.h);
}
/** Fonts that arrive later change how a line looks: a bent line painted before is not kept past them. */
let FONTS_SEEN = 0;
/** How many times an outline effect has stood in ordinary lettering for outlines still on their way (see outlined). */
let stopgaps = 0;
if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { FONTS_SEEN++; });

// Which effects draw the title's outline and shadow (its two sliders): the plain letterings of the
// flat looks have neither, the overprint only an offset second colour, everything built on the
// house lettering both. A look id stands for its own lettering, which "auto" uses.
const BOTH = { stroke: true, shadow: true }, NONE = { stroke: false, shadow: false };
const USES = { cel: BOTH, sticker: BOTH, plain: NONE, cyber: BOTH, riso: { stroke: false, shadow: true }, anime: BOTH, bluenote: NONE, editorial: NONE, songke: NONE, vivid: BOTH, negative: NONE, cinema: { stroke: false, shadow: true }, cyano: { stroke: false, shadow: true }, monofilm: { stroke: false, shadow: true }, typo: NONE, toon: { stroke: false, shadow: true }, avant: NONE, collage: { stroke: false, shadow: true }, yellow: NONE, pitch: NONE, dots: { stroke: false, shadow: true }, neon: { stroke: false, shadow: true }, court: { stroke: false, shadow: true }, velvet: { stroke: false, shadow: true }, rave: { stroke: false, shadow: true }, chrome: { stroke: false, shadow: true }, netart: { stroke: false, shadow: true }, verse: { stroke: false, shadow: true }, glass: { stroke: false, shadow: true }, jelly: { stroke: false, shadow: true }, skies: { stroke: false, shadow: true }, spectrum: { stroke: false, shadow: true }, citypop: BOTH, construct: { stroke: false, shadow: true }, deco: BOTH, wasteland: BOTH, ransom: BOTH };
/** { id, stroke, shadow } for effect `id` under the current look; id is the effect actually painted. */
export function effectUses(id = "auto") {
  const fx = EFFECTS[id] && id !== "auto" ? id : look().runs ? look().id : "cel";
  return { id: fx, ...(USES[fx] || BOTH) };
}

/** Paints the current line with effect `id`. See the top of the file for `pass` and `o`. */
export function paintRuns(ctx, pass, o, id = "auto") {
  const fx = EFFECTS[id] && !(COLUMN && NO_COLUMNS.includes(id)) ? id : "auto";
  if (fx === "auto") return look().runs ? look().runs(ctx, pass, o, lookValues()) : house(ctx, pass, o);
  if (fx === "cel") return house(ctx, pass, o);
  if (fx === "sticker") return sticker(ctx, pass, o);
  if (fx === "plain") return pass((a, x) => { ctx.fillStyle = a.hi ? o.hiCss : o.fillCss; ctx.fillText(a.t, x, 0); });
  if (fx === "ransom") return real(ctx) ? ransom(ctx, pass, o) : house(ctx, pass, o);   // not letter by letter on a canvas only measured on
  if (EFFECTS[fx].kind === "passes") return LOOKS[fx].runs(ctx, pass, o, lookParams(fx));   // another look's lettering, at its default settings
  return EFFECTS[fx].kind === "mask" ? masked(ctx, pass, o, fx) : outlined(ctx, pass, o, fx);
}
