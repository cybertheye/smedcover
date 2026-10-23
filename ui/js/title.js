// Title typesetting. One typed line is one line on the cover: text is never wrapped; instead the
// size is the largest at which the longest line fits the width and all lines fit the height.
import { INK } from "./cel.js";
import { paintRuns, bentLine, bendExtent, bendRest, reshaped, effectReach, inColumn, columnNow, standsUp, emMiddle } from "./textfx.js";
import { fall } from "./style.js";
import { SUB, subtitleSize, titleFloor } from "./layout.js";
import { letterCells } from "./ransom.js";

/** "a\n*b* c" -> [[{t:"a",hi:false}], [{t:"b",hi:true},{t:" c",hi:false}]]. Literal "\n" also breaks. */
export function parseTitle(title) {
  return String(title || "")
    .replace(/\\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("*").map((t, k) => ({ t, hi: k % 2 === 1 })).filter((a) => a.t));
}

// ---------- setting a line
// Two things a typesetter would do to a CJK title that the canvas does not:
// - Latin beside CJK made as tall. The title's font stack takes Latin from one font and CJK from
//   another (Bebas Neue and Noto Sans SC, say), whose capitals stand at 0.7–0.8 of the ideographs'
//   height, a size smaller to the eye. In a title with CJK in it, every run of Latin letters, digits and
//   ASCII signs is set larger, its capitals LATIN_TO_HAN of the ideographs' ink height, and moved so the
//   two are centred on each other: measured on the font itself, so a CJK font whose own Latin is already
//   matched is hardly touched.
// - CJK punctuation squeezed, as clreq has it in the Kaiming style (开明式), the tighter one a headline
//   wants. A full-width mark is half ink and half blank: within a line the marks that end a sentence,
//   。？！, keep their width, every other (，、；：, quotes, brackets) is set half; at the start of a line
//   the blank before an opening mark goes, at the end the blank after a closing one; and of two marks in a
//   row the blank between them is cut by half an em at least. Which half is blank is read from the
//   glyph's ink, since fonts differ (in Simplified Chinese ones ？！ stand left, too). A shorter line can
//   be set larger, too.
// A line is set as pieces — runs cut where the script changes or a squeeze moves what follows — each
// {t, hi, ri (its run), x, w, s (scale), dy (moved down), lt and rt (the blank given up at its start and
// end), run ({x0, x1}: where its whole run's lettering lies, the given-up blank left out), first (the
// first piece of its run)}; pass() hands them to the lettering in place of the runs, and a lettering that
// marks whole runs (a plate, a strip, a gradient across them) does it at a run's first piece, over `run`.
// A column is set by setColumn, below.
const LATIN_TO_HAN = 0.86, CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Nd}!-/:-@[-`{-~]/u;   // letters, digits, ASCII signs — not their full-width forms, which are CJK-sized already
const WIDE = /^[　-〿＀-￯]/;
const MARKS = "，。、；：？！「」『』（）《》〈〉【】〔〕〖〗“”‘’", FULL = "。？！";   // FULL: the marks that keep their width within a line
const METRICS = new Map();
let fontsSeen = 0;   // fonts that arrive later measure differently: what was measured before them is not kept
if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", () => { fontsSeen++; });
/** What setting a line needs to know of ctx's font: {ok, em, s, dy, ink: char -> {l, r, w} | null}. Not ok without real metrics (a test double). */
function metricsOf(ctx) {
  const key = `${ctx.font}|${fontsSeen}|${typeof document !== "undefined" && document.fonts ? document.fonts.size : 0}`;
  let m = METRICS.get(key);
  if (m) return m;
  const han = ctx.measureText("国"), cap = ctx.measureText("H");
  m = { ok: Number.isFinite(han.actualBoundingBoxAscent) && Number.isFinite(cap.actualBoundingBoxAscent) && han.width > 0, em: han.width, s: 1, dy: 0, ink: new Map() };
  if (m.ok) {
    const hanUp = han.actualBoundingBoxAscent, hanDown = han.actualBoundingBoxDescent, capUp = cap.actualBoundingBoxAscent, capDown = cap.actualBoundingBoxDescent;
    m.s = Math.min(1.3, Math.max(1, (LATIN_TO_HAN * (hanUp + hanDown)) / Math.max(1, capUp + capDown)));
    m.dy = Math.min(0.1, Math.max(-0.1, (m.s * (capUp - capDown) - (hanUp - hanDown)) / 2 / m.em)) * m.em;   // centre on centre
  }
  if (METRICS.size > 64) METRICS.clear();
  METRICS.set(key, m);
  return m;
}
/** A full-width punctuation mark's ink, {l, r} from its start, and its advance w; null for anything else. */
function markInk(ctx, m, ch) {
  if (!m.ok || !MARKS.includes(ch)) return null;
  if (!m.ink.has(ch)) {
    const align = ctx.textAlign; ctx.textAlign = "left";   // the ink's sides are read from where the mark starts
    const t = ctx.measureText(ch);
    ctx.textAlign = align;
    m.ink.set(ch, t.width > m.em * 0.9 ? { l: -t.actualBoundingBoxLeft, r: t.actualBoundingBoxRight, w: t.width } : null);
  }
  return m.ink.get(ch);
}
/** The characters of a string as one reads them (a letter with its accents, a keycap with its sign). */
const graphemes = typeof Intl !== "undefined" && Intl.Segmenter ? ((seg) => (t) => Array.from(seg.segment(t), (g) => g.segment))(new Intl.Segmenter(undefined, { granularity: "grapheme" })) : (t) => [...t];
export const hasCJK = (lines) => lines.some((l) => l.some((a) => CJK.test(a.t)));
/**
 * Sets one parsed line in ctx's font (see above): {pieces, width, runs: [{hi, x0, x1}]}, the runs' extents
 * for what is drawn under whole runs. `mixed`: the block has CJK in it, so Latin is matched to it.
 */
export function setLine(ctx, line, mixed) {
  const m = metricsOf(ctx);
  const runs = line.map((a) => ({ hi: a.hi, x0: Infinity, x1: -Infinity }));
  if (!m.ok) {   // as the canvas sets it
    let x = 0;
    const pieces = line.map((a, ri) => { const w = ctx.measureText(a.t).width, p = { t: a.t, hi: a.hi, ri, x, w, s: 1, dy: 0, lt: 0, rt: 0, run: runs[ri], first: true }; Object.assign(runs[ri], { x0: x, x1: x + w }); x += w; return p; });
    return { pieces, width: x, runs: runs.filter((r) => r.x1 > r.x0) };
  }
  const chars = [];
  line.forEach((a, ri) => { for (const ch of graphemes(a.t)) chars.push({ ch, hi: a.hi, ri, latin: mixed && LATIN.test(ch) && !WIDE.test(ch), kern: 0, lt: 0, rt: 0 }); });
  chars.forEach((c, i) => { if (/^\s+$/.test(c.ch) && chars[i - 1]?.latin && chars[i + 1]?.latin) c.latin = true; });   // a space inside Latin goes with it
  const ink = chars.map((c) => markInk(ctx, m, c.ch)), pad = m.em * 0.06, n = chars.length;
  // the blank a mark may give up on its blank side: at an end of the line all of it; within the line, of a
  // mark set half, up to half an em, keeping at least the blank on its ink side (so a comma stays with what
  // it follows, not with what comes next)
  const before = (i) => {
    if (!ink[i] || ink[i].l <= m.em * 0.3 || (i > 0 && FULL.includes(chars[i].ch))) return 0;
    return i === 0 ? ink[i].l - pad : Math.max(0, Math.min(m.em * 0.5, ink[i].l - Math.max(pad, ink[i].w - ink[i].r)));
  };
  const after = (i) => {
    const blank = ink[i] ? ink[i].w - ink[i].r : 0;
    if (blank <= m.em * 0.3 || (i < n - 1 && FULL.includes(chars[i].ch))) return 0;
    return i === n - 1 ? blank - pad : Math.max(0, Math.min(m.em * 0.5, blank - Math.max(pad, ink[i].l)));
  };
  if (n) { chars[0].lt = before(0); chars[n - 1].rt = after(n - 1); }                                             // an opening mark first, a closing one last
  for (let i = 1; i < n; i++) {
    const a = after(i - 1), b = before(i);
    let rt = a, lt = b;
    if (ink[i - 1] && ink[i]) {   // two in a row: at least half an em between them goes, from each blank as it has
      const right = ink[i - 1].w - ink[i - 1].r, left = ink[i].l, more = Math.max(0, Math.min(m.em * 0.5, right + left - m.em * 0.1) - a - b);
      rt += more * (right / Math.max(1e-6, right + left)); lt += more * (left / Math.max(1e-6, right + left));
    }
    chars[i - 1].rt = rt; chars[i].lt = lt; chars[i].kern = -(rt + lt);
  }
  const pieces = [];
  for (const c of chars) {
    const p = pieces[pieces.length - 1];
    if (p && p.ri === c.ri && p.latin === c.latin && !c.kern) { p.t += c.ch; p.rt = c.rt; }
    else pieces.push({ t: c.ch, hi: c.hi, ri: c.ri, latin: c.latin, kern: c.kern, lt: c.lt, rt: c.rt, run: runs[c.ri], first: !pieces.some((q) => q.ri === c.ri) });
  }
  let x = n ? -chars[0].lt : 0;
  for (const p of pieces) {
    x += p.kern; p.x = x; p.s = p.latin ? m.s : 1; p.dy = p.latin ? m.dy : 0; p.w = ctx.measureText(p.t).width * p.s; x += p.w;
    const r = runs[p.ri]; r.x0 = Math.min(r.x0, p.x + p.lt); r.x1 = Math.max(r.x1, p.x + p.w - p.rt);   // the lettering, less the blank given up
  }
  return { pieces, width: Math.max(0, x - (n ? chars[n - 1].rt : 0)), runs: runs.filter((r) => r.x1 > r.x0) };
}
/**
 * The `pass` of a set line (see textfx.js): fn(piece, x) for each piece. While a piece set larger or lower
 * is lettered, text drawn and measured on any canvas is so, so every lettering — the looks' work canvases
 * and the bent lines' too — sets it as the line was set.
 */
export function passOf(set) {
  return (fn) => { for (const p of set.pieces) inPiece(p, () => fn(p, p.x)); };
}
/** Runs `run` (and returns what it does) so text drawn and measured in it is as piece `p` ({s, dy}) is set: for a lettering that draws a piece's letters after the pass, or one by one. */
export function inPiece(p, run) {
  if ((p.s ?? 1) === 1 && !p.dy) return run();
  return larger({ s: p.s ?? 1, dy: p.dy || 0 }, run);
}
const PROTOS = ["CanvasRenderingContext2D", "OffscreenCanvasRenderingContext2D"].map((n) => globalThis[n] && globalThis[n].prototype).filter(Boolean);
/** The font `font` (a canvas font string) at `s` times its size. */
const sized = (font, s) => font.replace(/(\d*\.?\d+)px/, (_, v) => `${+v * s}px`);
/**
 * Runs `run` with fillText, strokeText and measureText on every canvas set `s` times larger, `dy` lower:
 * by the font's size, not by a transform, so what else is drawn in the line's space — a gradient across
 * the run, an outline's width, a shadow's offset — stays where and as it was.
 */
function larger({ s, dy }, run) {
  const kept = PROTOS.map((P) => [P, P.fillText, P.strokeText, P.measureText]);
  for (const [P, fill, stroke, measure] of kept) {
    P.fillText = function (t, x, y, ...r) { const f = this.font; this.font = sized(f, s); try { fill.call(this, t, x, y + dy, ...r); } finally { this.font = f; } };
    P.strokeText = function (t, x, y, ...r) { const f = this.font; this.font = sized(f, s); try { stroke.call(this, t, x, y + dy, ...r); } finally { this.font = f; } };
    P.measureText = function (t) { const f = this.font; this.font = sized(f, s); try { return measure.call(this, t); } finally { this.font = f; } };
  }
  try { return run(); } finally { for (const [P, fill, stroke, measure] of kept) { P.fillText = fill; P.strokeText = stroke; P.measureText = measure; } }
}

const SOLO = [], SOLO_PX = 5e6;   // the work canvases of a line painted for some of its letters alone (see someLetters); larger than an editor's canvas, let go after use
/** Work canvas i the size of `like` (a canvas), cleared. */
function solo(i, like) {
  const c = SOLO[i] || (SOLO[i] = document.createElement("canvas"));
  if (c.width !== like.width || c.height !== like.height) { c.width = like.width; c.height = like.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, c.width, c.height);
  return x;
}
/**
 * Some letters of a line alone (`only`, a Set of letter keys, see ransom.js: the letters of a lettering woven in
 * front of a cut-out, see weave in layers.js), of line `row` as set (`set`, setLine's, in ctx's font); `o` the
 * line's lettering as paintRuns has it (fs, d, strokeAmt, amt, shadowAmt; frame.c, the line's slant) and `fx` its
 * effect. Null when none of them is on this line; else {cells, spans, clip(c), keep(c, paint)}. keep runs
 * paint(on), the line painted in its own space, so that of it only what lies on those letters reaches c — each
 * letter whole, with what its lettering throws round it (an outline, a rim, its shadow, spikes, drips): it is cut
 * from the line as painted (kerned, effects and all) by the letters' own shapes grown that far, less the bodies of
 * the letters behind (their fill and keyline, and their shadow, painted over a neighbour's), the bodies of those in
 * front kept whole. Most looks letter upright on a slanted line (upright() in looks/kit.js): the shapes are grown both
 * slanted and upright, and the bodies taken in the frame the lettering was painted in — upright when paint() turned
 * the line upright. In a column (see inColumn in textfx.js) the shapes are grown, and the bodies taken off, along the
 * shadow as the page has it (fall in style.js: down and to the right, not with the turned line) and along the drips
 * down the page, which is along the column, as the lettering throws them there. `clip(c)` keeps what is painted on c to
 * the letters' shares of the line along it (`spans`, as far as the ends' outlines reach): where c is no canvas (one
 * only measured on, a test's), keep does that instead.
 */
export function someLetters(ctx, set, row, only, o, fx) {
  const fs = o.fs, fr = effectReach(fx, o.amt ?? 1), all = letterCells(set.pieces, (t) => ctx.measureText(t).width, row), cells = all.filter((c) => only.has(c.key));
  if (!cells.length) return null;
  const behind = all.filter((c) => !only.has(c.key) && !/^\s+$/.test(c.ch)), body = fs * (0.075 * (o.strokeAmt || 0) + 0.02), slant = (o.frame && o.frame.c) || 0;
  const out = fs * (0.6 + fr.x), up = fs * (2 + fr.up), down = fs * (1.5 + fr.down), spans = [];
  for (const c of cells) {
    const a = c === all[0] ? c.x - out : c.x, b = c === all[all.length - 1] ? c.x + c.w + out : c.x + c.w, last = spans[spans.length - 1];
    if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b); else spans.push([a, b]);
  }
  const clip = (c) => { c.beginPath(); for (const [a, b] of spans) c.rect(a, -up, b - a, up + down); c.clip(); };
  // how far a letter's lettering reaches round it, and along which offsets it throws its shadow, depth or drips: the
  // shadow as the page has it (fall), the drips down the page, which in a column is along the line
  const r = fs * (0.04 + 0.0375 * (o.strokeAmt || 0) + (fx === "sticker" ? 0.2 : 0) + Math.max(fr.x, fr.up));
  const deep = Math.max((o.d || 0) * (fx === "sticker" ? 1.3 : 1), fx === "extrude" ? fs * 0.11 * (o.amt ?? 1) * Math.max(0.3, o.shadowAmt ?? 1) : 0), drip = fr.down * fs;
  const offsets = [[0, 0]], shades = [[0, 0]], dripped = (v) => (columnNow() ? [v, 0] : [0, v]);   // shades: along the shadow alone, where a letter's body is painted again
  for (let n = Math.ceil(deep / r), i = 1; i <= n; i++) offsets.push(fall((deep * i) / n, (deep * i) / n));
  for (let n = Math.ceil(deep / body), i = 1; i <= n && deep > 0; i++) shades.push(fall((deep * i) / n, (deep * i) / n));
  for (let n = Math.ceil(drip / r), i = 1; i <= n; i++) offsets.push(dripped((drip * i) / n));
  const keep = (c, paint) => {
    const canvas = c.canvas;
    if (typeof document === "undefined" || !canvas || canvas._probe || typeof c.getTransform !== "function") { c.save(); clip(c); paint(c); c.restore(); return; }
    const m = c.getTransform(), font = c.font, line = solo(0, canvas), shape = solo(1, canvas), turn = line.transform;
    for (const x of [line, shape]) { x.setTransform(m); x.font = font; x.textAlign = "left"; x.textBaseline = "alphabetic"; x.lineJoin = x.lineCap = "round"; }
    // painted, noting whether the lettering took the line's slant out
    let upright = false;
    if (slant) line.transform = function (a, b, cc, d, e, f) { if (a === 1 && !b && d === 1 && Math.abs(cc + slant) < 1e-9) upright = true; return turn.call(this, a, b, cc, d, e, f); };
    try { paint(line); } finally { if (slant) delete line.transform; }
    const letter = (k, dx = 0, dy = 0) => { shape.font = sized(font, k.s); shape.fillText(k.ch, k.pen + dx, k.dy + dy); shape.strokeText(k.ch, k.pen + dx, k.dy + dy); };
    const framed = (straight, fn) => { shape.setTransform(m); if (straight) shape.transform(1, 0, -slant, 1, 0, 0); fn(); };
    shape.fillStyle = shape.strokeStyle = "#000"; shape.lineWidth = 2 * r;
    for (const straight of slant ? [false, true] : [false]) framed(straight, () => { for (const k of cells) if (!/^\s+$/.test(k.ch)) for (const [dx, dy] of offsets) letter(k, dx, dy); });   // grown, along its shadow
    shape.lineWidth = body;
    framed(upright, () => {
      shape.globalCompositeOperation = "destination-out"; for (const k of behind) for (const [dx, dy] of shades) letter(k, dx, dy);   // less the letters behind, and their shadows
      shape.globalCompositeOperation = "source-over"; for (const k of cells) if (!/^\s+$/.test(k.ch)) for (const [dx, dy] of shades) letter(k, dx, dy);   // those in front whole
    });
    line.setTransform(1, 0, 0, 1, 0, 0); line.globalCompositeOperation = "destination-in"; line.drawImage(shape.canvas, 0, 0);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(line.canvas, 0, 0); c.restore();
    if (canvas.width * canvas.height > SOLO_PX) for (const x of SOLO) x.width = x.height = 0;   // an export's: not kept
  };
  return { cells, spans, clip, keep };
}

const LH = 1.16;   // line height, in sizes
/**
 * The lines' widths at size 100, and the size at which they fill `box` (times `s`), bent by `bend` ({id,
 * amt, own}, or null) when they have one: then what the bent lines reach past their block counts too
 * (`reach` at size 100: up past the first line, down past the last — a wide line between may reach past
 * them — and left and right of the widest; none for a perspective of the layer's own, `own`, which is the
 * user's to place). The lines are set as setLine sets them. Leaves ctx's font at size 100.
 */
function fitLines(ctx, lines, box, font, maxFs, s = 1, bend = null) {
  ctx.font = `900 100px ${font}`;
  const mixed = hasCJK(lines), widths = lines.map((l) => setLine(ctx, l, mixed).width), widest = Math.max(...widths);
  const reach = { up: 0, down: 0, left: 0, right: 0 };
  if (bend && !bend.own) {
    const ext = widths.map((w) => bendExtent(bend.id, bend.amt, w, 100)), n = ext.length;
    reach.up = Math.max(...ext.map((e, i) => e.up - i * LH * 100)); reach.down = Math.max(...ext.map((e, i) => e.down - (n - 1 - i) * LH * 100));
    reach.left = Math.max(...ext.map((e) => e.left));
    reach.right = Math.max(...widths.map((w, i) => w + ext[i].right)) - widest;
  }
  const w100 = widest + reach.left + reach.right, h100 = lines.length * LH * 100 + reach.up + reach.down;
  return { widths, widest, reach, fs: Math.max(8, Math.floor(Math.min(maxFs, (100 * box.w) / (w100 * 1.04), (100 * box.h) / h100) * s)) };
}
/**
 * The block drawTitle would fill in `box`, left-aligned and unadjusted, without drawing it: {x, y, w, h, fs},
 * or null; with a bend, what the bent lines reach. `reserve`, `bend`: as drawTitle's.
 */
export function titleBlock(ctx, title, box, font, maxFs = 340, reserve = 0, bend = null) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  const free = Math.min(reserve, box.h * 0.5);
  ctx.save(); const { widest, fs, reach } = fitLines(ctx, lines, { ...box, h: box.h - free }, font, maxFs, 1, bend); ctx.restore();
  const k = fs / 100, h = lines.length * fs * LH + (reach.up + reach.down) * k;
  return { x: box.x, y: box.y + (box.h - free - h) / 2, w: (widest + reach.left + reach.right) * k, h, fs };
}
/**
 * Where the subtitle `sub` goes under `title` in the title's `box` (on a canvas w × h, the title set in
 * `font`): {fs, reserve, box}, or null when it has no words. Its size follows the title's as it would be
 * without it (see subtitleSize in layout.js), smaller when the box is too low for it; the title keeps
 * `reserve` free under it (drawTitle's), the two together centred in the box as the title alone was, the
 * subtitle's box a gap under the title's last line (bent, as far as it reaches: `bend`, the title's), as
 * wide as the title's box. With no title it is
 * centred in the box. The subtitle gives way first: where it would set the title below the size it
 * wants to read in the feed (titleFloor in layout.js), it is made smaller, down to SUB.min; and it stays
 * smaller than the title however small that is set (SUB.most). `ink`: the block its words fill.
 */
export function subtitleFit(ctx, title, sub, box, font, w, h, maxFs = 340, bend = null) {
  const lines = parseTitle(sub);
  if (!lines.length) return null;
  const words = parseTitle(title);
  ctx.save(); const fs0 = words.length ? fitLines(ctx, words, box, font, maxFs).fs : Infinity; ctx.restore();
  const per = lines.length * LH + SUB.gap;   // the reserve, in subtitle sizes
  let fs = subtitleSize(fs0, w, h);
  const floor = Math.min(fs0, titleFloor(w, h)), spare = box.h - floor * words.length * LH;   // what the title can spare and still read
  if (words.length && floor > 0 && fs * per > spare) fs = Math.max(Math.min(w, h) * SUB.min, spare / per);
  let reserve = fs * per;
  if (reserve > box.h * 0.45) { fs *= (box.h * 0.45) / reserve; reserve = box.h * 0.45; }
  /** The block the words fill in box b: the widest line at the size they are set at there. */
  const ink = (b) => { ctx.save(); const f = fitLines(ctx, lines, b, font, fs); ctx.restore(); const ih = lines.length * f.fs * LH; return { x: b.x, y: b.y + (b.h - ih) / 2, w: (f.widest * f.fs) / 100, h: ih }; };
  if (!words.length) { const sh = lines.length * fs * LH, b = { x: box.x, y: box.y + (box.h - sh) / 2, w: box.w, h: sh }; return { fs, reserve: 0, box: b, ink: ink(b) }; }
  let block = titleBlock(ctx, title, box, font, maxFs, reserve, bend);
  if (fs > block.fs * SUB.most) { fs = block.fs * SUB.most; reserve = fs * per; block = titleBlock(ctx, title, box, font, maxFs, reserve, bend); }   // less room taken: the title only grows
  const b = { x: box.x, y: block.y + block.h + fs * SUB.gap, w: box.w, h: lines.length * fs * LH };
  return { fs, reserve, box: b, ink: ink(b) };
}

/**
 * How line `li` of a headline is painted (set as `set`, its `pass`, its lettering `o`, the headline's style `st`;
 * `some`: someLetters' when only some of its letters are): paint(c, unit), the line as it is, on c — the canvas, a
 * bent line's own, a column's turned line — whose pixels are `unit` a unit. Under each highlighted run its plate or
 * its mark (a sticker lays them on its rim, which would hide them), then the letters, then the marks that go over them.
 */
function lineOf(set, pass, o, st, li, some) {
  const fs = o.fs;
  return (c, unit) => {
    // the ransom note paints only those letters itself: the plates and marks of its highlighted words, kept to them
    const own = some && st.fx === "ransom", kept = (fn) => { if (!own) return fn(); c.save(); some.clip(c); fn(); c.restore(); };
    const line = (c) => {
      const marks = (phase) => { if (st.hiMark) set.runs.forEach((r, ri) => { if (r.hi) st.hiMark(r.x0, r.x1, fs, c, phase, li * 13 + ri); }); };
      const beneath = () => kept(() => { if (st.hiPlate) for (const r of set.runs) if (r.hi) st.hiPlate(r.x0 - fs * 0.08, -fs * 0.86, r.x1 - r.x0 + fs * 0.16, fs * 1.06, fs, c); marks("under"); });   // under each highlighted run, whole
      const oo = unit === o.unit ? o : { ...o, unit };
      if (st.fx === "sticker") paintRuns(c, pass, { ...oo, beneath }, st.fx); else { beneath(); paintRuns(c, pass, oo, st.fx); }
      kept(() => marks("over"));
    };
    if (some && !own) some.keep(c, line); else line(c);
  };
}
/**
 * Draws the title into box {x,y,w,h}. `adj` is the manual {dx,dy,s}; `st` the style:
 * { font, fill, hi, ink, shadow, hiShadow, align, stroke, shadowAmt, maxFs, fx, fxAmt, fxSeed, ransom } — fx being
 * the text effect (see textfx.js) — and optionally `plate(x, y, w, h, fs)`, which paints a plate
 * under the lines, `hiPlate(x, y, w, h, fs)`, one under each highlighted word, and `skew`, the lines'
 * slant (default -0.08), and `reserve`, a height kept free under the lines (for the subtitle, see
 * subtitleFit): they fit the rest of the box, and the two are centred in it together. `bend` ({id, amt,
 * own}): each line is painted as it would be and then bent (bentLine in textfx.js), the size fitting what
 * the bent lines reach (see fitLines); `key` names what else decides how the lines look (the plates'
 * colours, say), for the bent lines kept. `hiPlate` is then given the context to paint on, sixth;
 * `hiMark(x0, x1, fs, c, phase, seed)` marks each highlighted run otherwise, "under" the letters and "over" them. A bend
 * other than the perspective may be reshaped by its handles (`reshape`, see reshapeField in textfx.js):
 * the size stays what the bend alone gives, the box returned too (the layer is scaled and turned about its
 * centre, which must not move under a handle dragged); the plate and the box's `ink`, what is drawn, take in
 * where the handles went. `onBlock(m, block, rest)` is told where the block is and, bent, where its handles rest.
 * `only` (a Set of letter keys, see someLetters): only those letters are painted, each line kept to them (the
 * ransom note, which paints letter by letter, is told which instead), and no plate; the box is the whole block's.
 * Returns the box it occupies (for hit-testing), or null when there is nothing to draw.
 */
export function drawTitle(ctx, title, box, adj, st) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const free = Math.min(st.reserve || 0, box.h * 0.5);
  const { widths, widest, fs, reach } = fitLines(ctx, lines, { ...box, h: box.h - free }, st.font, st.maxFs, adj.s, st.bend);
  ctx.font = `900 ${fs}px ${st.font}`;
  const k = fs / 100, blockW = (widest * fs) / 100, textH = lines.length * fs * LH;
  const fullW = blockW + (reach.left + reach.right) * k, fullH = textH + (reach.up + reach.down) * k;   // what the lines reach, bent
  const x0 = box.x + adj.dx + reach.left * k + (st.align === "center" ? (box.w - fullW) / 2 : 0);
  const y0 = box.y + (box.h - free - fullH) / 2 + adj.dy + reach.up * k;
  const d = fs * 0.062 * st.shadowAmt, block = { x: x0, y: y0, w: blockW, h: textH };
  const reached = { x: x0 - reach.left * k, y: y0 - reach.up * k, w: fullW, h: fullH };
  const pad = st.plate ? fs * 0.32 : 0, skew = st.skew ?? -0.08;
  const lineAt = (li) => ({ ox: x0 + fs * 0.04 + (st.align === "center" ? (blockW - (widths[li] * fs) / 100) / 2 : 0), oy: y0 + li * fs * LH + fs * 0.92, lineW: (widths[li] * fs) / 100 });
  const rest = st.bend && st.bend.id !== "taper" ? bendRest(st.bend, fs, skew, block, lineAt(0), lineAt(lines.length - 1)) : null;
  let inked = reached;
  if (rest && st.reshape) {   // the handles dragged out: the plate and the box drawn in take in where they went (the box placed by stays)
    const pts = reshaped(rest, st.reshape, block), xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const ax = Math.min(reached.x, ...xs), ay = Math.min(reached.y, ...ys), bx = Math.max(reached.x + reached.w, ...xs), by = Math.max(reached.y + reached.h, ...ys);
    inked = { x: ax, y: ay, w: bx - ax, h: by - ay };
  }
  const fr = effectReach(st.fx, st.fxAmt ?? 1);
  if (fr.x || fr.up || fr.down) inked = { x: inked.x - fr.x * fs, y: inked.y - fr.up * fs, w: inked.w + 2 * fr.x * fs, h: inked.h + (fr.up + fr.down) * fs };   // spikes, drips… past the type
  if (st.onBlock) st.onBlock(ctx.getTransform ? ctx.getTransform() : null, block, rest);   // where the block is, for the bend's handles
  if (st.plate && !st.only) st.plate(inked.x - pad, inked.y - pad * 0.3, inked.w + pad * 2, inked.h + pad * 0.6, fs);
  const mixed = hasCJK(lines);
  lines.forEach((line, li) => {
    const lw = (widths[li] * fs) / 100;
    ctx.save();
    const { ox, oy } = lineAt(li);
    ctx.translate(ox, oy);
    if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
    const set = setLine(ctx, line, mixed), pass = passOf(set);
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const o = {
      fs, d, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: st.fxAmt ?? 1, ransom: st.ransom, fxSeed: st.fxSeed || 0, row: li, lineW: lw, seed: li * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow,
      C: st.C, fill: st.own, hi: st.ownHi, hiPlate: !!st.hiPlated, unit: m ? Math.hypot(m.a, m.b) : 1,
      frame: { ox, oy, c: skew, box: block }, warp: st.warp, reshape: rest ? st.reshape : undefined, only: st.only || undefined,
    };
    const some = st.only && someLetters(ctx, set, li, st.only, o, st.fx);
    if (st.only && !some) return ctx.restore();   // none of its letters is to be painted
    const paint = lineOf(set, pass, o, st, li, some);   // the line as it is, on c (the canvas, or the bent line's own)
    if (st.bend) bentLine(ctx, { ...o, bend: st.bend }, [JSON.stringify(line), ctx.font, st.fx, st.key || "", some ? JSON.stringify(some.spans) : "", JSON.stringify({ ...o, frame: null, warp: null, reshape: null, unit: null, only: null })].join("|"), paint);
    else paint(ctx, o.unit);
    ctx.restore();
  });
  ctx.restore();
  const grown = (b) => (pad ? { x: b.x - pad, y: b.y - pad * 0.3, w: b.w + pad * 2, h: b.h + pad * 0.6 } : b), out = grown(reached);
  if (inked !== reached) out.ink = grown(inked);
  out.fs = fs;   // the type size set (the cover standards read it off the hit: see placed in render.js)
  return out;
}
export { INK };

// ---------- columns
// Set vertically, as Chinese books are: each typed line a column, read top to bottom, the first column on the
// right. A column is set as a line is, and painted as one (see inColumn in textfx.js): the line turned a quarter
// turn clockwise, so it reads downward, what stands upright in it turned back where it stands.
const GAP = 1.06, PITCH = 1.32, SPACE = 0.34, AIR = 0.12;   // in sizes: an upright character's cell, a column's pitch, a space, the air along a run lying on its side
/** The size of ctx's font, in units: an em, of which an upright character's cell is made. */
const pxOf = (ctx) => Number((/(\d*\.?\d+)px/.exec(ctx.font || "") || [])[1]) || 100;
/**
 * Sets one parsed line as a column, in ctx's font, as setLine sets a line: {pieces, width (how long it is, down the
 * column), runs, mid}. The pieces lie along it as along a line, from its top: each character standing upright (see
 * standsUp in textfx.js) a piece of its own, centred in a cell GAP long; a run of Latin letters, digits and signs, a
 * space inside it with it, one piece lying on its side, AIR longer than its letters, set larger beside CJK as setLine
 * sets it and moved across so its capitals' middle is the column's; a bracket, quote, dash or ellipsis, which turns
 * with the line, a piece of its own a cell long, its ink's middle moved onto the column's; a space a short gap.
 * `mid`: where the column's middle lies from the line's baseline (the middle of an em, below it: emMiddle). Every
 * piece's text is the line's, in order, so its letters have the keys they have in a line (letterKey in ransom.js),
 * however the layer is set.
 */
export function setColumn(ctx, line, mixed) {
  const m = metricsOf(ctx), em = pxOf(ctx), mid = emMiddle(ctx);
  const inkMid = (t) => { const k = ctx.measureText(t); return m.ok && Number.isFinite(k.actualBoundingBoxAscent) ? (k.actualBoundingBoxDescent - k.actualBoundingBoxAscent) / 2 : null; };
  const chars = [];
  line.forEach((a, ri) => { for (const ch of graphemes(a.t)) chars.push({ ch, hi: a.hi, ri, kind: standsUp(ch) ? "up" : /^\s+$/.test(ch) ? "space" : WIDE.test(ch) || /[\u2010-\u2027]/.test(ch) ? "mark" : "side" }); });
  chars.forEach((c, i) => { const a = chars[i - 1], b = chars[i + 1]; if (c.kind === "space" && a?.kind === "side" && b?.kind === "side" && a.ri === c.ri && b.ri === c.ri) c.kind = "side"; });   // a space inside a run on its side goes with it
  const runs = line.map((a) => ({ hi: a.hi, x0: Infinity, x1: -Infinity })), pieces = [];
  for (const c of chars) {
    const p = pieces[pieces.length - 1];
    if (p && c.kind === "side" && p.kind === "side" && p.ri === c.ri) p.t += c.ch;
    else pieces.push({ t: c.ch, hi: c.hi, ri: c.ri, kind: c.kind, run: runs[c.ri], first: !pieces.some((q) => q.ri === c.ri), s: 1, dy: 0, lt: 0, rt: 0 });
  }
  const capMid = inkMid("H");
  let y = 0;
  for (const p of pieces) {
    const w = ctx.measureText(p.t).width;
    let cell;
    if (p.kind === "up") { cell = em * GAP; p.w = w; p.x = y + (cell - w) / 2; }
    else if (p.kind === "space") { cell = em * SPACE; p.w = cell; p.x = y; }
    else if (p.kind === "mark") { cell = Math.max(w, em) * GAP; p.w = w; p.x = y + (cell - w) / 2; const k = inkMid(p.t); if (k !== null) p.dy = mid - k; }
    else { p.s = mixed && m.ok && LATIN.test(p.t) ? m.s : 1; p.w = w * p.s; cell = p.w + em * AIR; p.x = y + (em * AIR) / 2; if (capMid !== null) p.dy = mid - capMid * p.s; }
    if (p.kind !== "space") { const r = p.run; r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x + p.w); }
    y += cell;
    delete p.kind;
  }
  return { pieces, width: y, runs: runs.filter((r) => r.x1 > r.x0), mid };
}
/** How wide a block of n columns is at size fs: a pitch each, less the air beside the last one — kept, with its rules, half at either side. */
const blockWidth = (n, fs, rules) => fs * (n * PITCH - (rules ? 0 : PITCH - 1));
/**
 * The columns of `lines` set at size 100 (setColumn), and the size at which they fill `box`: the longest as high as
 * the box, all of them as wide (with their rules, `rules`, see blockWidth). Leaves ctx's font at size 100.
 */
function fitColumns(ctx, lines, box, font, weight, maxFs, rules = false) {
  ctx.font = `${weight} 100px ${font}`;
  const mixed = hasCJK(lines), sets = lines.map((l) => setColumn(ctx, l, mixed)), tallest = Math.max(...sets.map((s) => s.width));
  return { sets, tallest, fs: Math.max(8, Math.floor(Math.min(maxFs, (100 * box.h) / tallest, (100 * box.w) / blockWidth(lines.length, 100, rules)))) };
}
/** The block drawTitleVertical would fill in `box`, without drawing it: {x, y, w, h, fs}, or null. `rules`: with its column rules. */
export function titleBlockVertical(ctx, title, box, font, weight = 900, maxFs = 300, rules = false) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save(); const { tallest, fs } = fitColumns(ctx, lines, box, font, weight, maxFs, rules); ctx.restore();
  return { x: box.x, y: box.y, w: blockWidth(lines.length, fs, rules), h: (tallest * fs) / 100, fs };
}
/**
 * Sets the title in columns (see setColumn), the block at the top left of `box`, the size the largest at which the
 * longest column fits the height and all of them the width (or `st.fs`, as it is). Each column is painted as its line
 * would be (lineOf), in the headline's lettering — its effect, outline and shadow, the plates and marks of its
 * highlighted words — the line turned a quarter turn clockwise (inColumn in textfx.js), the shadows and depths it
 * throws falling down and to the right still (fall in style.js); a plate under the whole block, turned with it; with `st.rules`, hairlines between the columns and at the block's two sides, in the
 * lettering's colour and faint, as a Song edition rules its columns (界行). `st` as drawTitle's (font, fill, hi, ink,
 * shadow, hiShadow, own, ownHi, hiPlated, stroke, shadowAmt, C, fx, fxAmt, fxSeed, ransom, plate, hiPlate, hiMark,
 * only) less the bend and the slant, a column being set upright, plus `weight` (900) and `maxFs` (300). `only` (a
 * Set of letter keys, a column counted as a line, see someLetters): only those letters are painted, with no plate
 * and no rules. Returns the box it occupies (the plate's, what its effect throws past the type: spikes, drips) with
 * `fs`, the size of its characters (as the cover standards read it); or null when there is nothing to draw.
 */
export function drawTitleVertical(ctx, title, box, st) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  const weight = st.weight || 900, rules = !!st.rules;
  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const fs = st.fs || fitColumns(ctx, lines, box, st.font, weight, st.maxFs ?? 300, rules).fs;
  ctx.font = `${weight} ${fs}px ${st.font}`;
  const mixed = hasCJK(lines), sets = lines.map((l) => setColumn(ctx, l, mixed));
  const pitch = fs * PITCH, bw = blockWidth(sets.length, fs, rules), bh = Math.max(...sets.map((s) => s.width)), x0 = box.x, y0 = box.y;
  const pad = st.plate ? fs * 0.3 : 0, fr = effectReach(st.fx, st.fxAmt ?? 1), reach = fs * Math.max(fr.x, fr.up, fr.down);
  const turn = () => { ctx.translate(x0 + bw, y0); ctx.rotate(Math.PI / 2); };   // the block's own frame: x down the columns from its top, y leftward from its right side
  if (st.plate && !st.only) { ctx.save(); turn(); inColumn(ctx, () => st.plate(-pad / 2, -pad, bh + pad, bw + pad * 2, fs)); ctx.restore(); }   // its ends nearer the type, which its cells already give air; its shadow falling as off a line (fall in style.js)
  if (rules && !st.only) {   // 界行: a hairline at either side of every column
    ctx.save(); ctx.fillStyle = st.fill; ctx.globalAlpha *= 0.32;
    const lw = Math.max(1.2, fs * 0.012);
    for (let k = 0; k <= sets.length; k++) ctx.fillRect(x0 + bw - k * pitch - lw / 2, y0, lw, bh);
    ctx.restore();
  }
  sets.forEach((set, i) => {
    const across = (rules ? (pitch - fs) / 2 : 0) + fs / 2 + i * pitch - set.mid;   // the line's baseline from the block's right side: the column's middle where its em's is
    ctx.save(); turn(); ctx.translate(0, across);
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const o = {
      fs, d: fs * 0.062 * (st.shadowAmt ?? 0), strokeAmt: st.stroke ?? 0, shadowAmt: st.shadowAmt ?? 0, amt: st.fxAmt ?? 1, ransom: st.ransom, fxSeed: st.fxSeed || 0, row: i, lineW: set.width, seed: i * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow ?? st.fill, hiShadowCss: st.hiShadow ?? st.hi,
      C: st.C, fill: st.own, hi: st.ownHi, hiPlate: !!st.hiPlated, unit: m ? Math.hypot(m.a, m.b) : 1,
      frame: { ox: 0, oy: across, c: 0, box: { x: 0, y: 0, w: bh, h: bw } }, only: st.only || undefined,
    };
    inColumn(ctx, () => {
      const some = st.only && someLetters(ctx, set, i, st.only, o, st.fx);
      if (!st.only || some) lineOf(set, passOf(set), o, st, i, some)(ctx, o.unit);   // a column without any of them is left out
    });
    ctx.restore();
  });
  ctx.restore();
  const gx = pad + reach, gy = pad / 2 + reach;
  return { x: x0 - gx, y: y0 - gy, w: bw + gx * 2, h: bh + gy * 2, fs };
}
/** The block the words `lines` fill set in a line at size `fs` in box b: the widest line, as tall as they are, in the middle of b. */
function lineInk(ctx, lines, b, font, fs) {
  ctx.save(); const f = fitLines(ctx, lines, b, font, fs); ctx.restore();
  const ih = lines.length * f.fs * LH;
  return { x: b.x, y: b.y + (b.h - ih) / 2, w: (f.widest * f.fs) / 100, h: ih };
}
/**
 * Where the subtitle `sub` goes when it or the title is set in columns (both in lines: subtitleFit), in the title's
 * `box` — the one its columns stand in, when it is in columns — the two set in `font` on a canvas w × h. `cols`:
 * {title, sub}, which of them is in columns; `rules`: {title, sub}, which has its column rules; `bend`: the title's,
 * in a line. Its size follows the title's as it would be alone (subtitleSize in layout.js), and stays below it
 * (SUB.most). Both in columns: the subtitle's a gap left of the title's, so read after it, beginning a character
 * lower, the title's moving over to make room (`titleBox`). The title in a line and the subtitle in columns: the
 * subtitle's right of the title's block, from its top, the title's box narrower by them. The title in columns and the
 * subtitle in a line: its line under the columns, which keep `reserve` free at the foot of the box. Returns {fs,
 * vertical (the subtitle in columns), box (its own), ink (the block its words fill), titleBox or reserve}, or null
 * when it has no words.
 */
export function subtitleColumns(ctx, title, sub, box, font, w, h, cols, rules = {}, bend = null) {
  const lines = parseTitle(sub);
  if (!lines.length) return null;
  const words = parseTitle(title).length > 0, tr = !!rules.title, sr = !!rules.sub, across = (fs) => blockWidth(lines.length, fs, sr);
  const block = (b) => (!words ? null : cols.title ? titleBlockVertical(ctx, title, b, font, 900, 300, tr) : titleBlock(ctx, title, b, font, 340, 0, bend));
  const alone = block(box);
  let fs = subtitleSize(alone ? alone.fs : Infinity, w, h);
  if (cols.sub) {
    let titleBox = box, set = null;
    const place = () => {
      const room = across(fs) + fs * 0.8;
      titleBox = cols.title ? { ...box, x: box.x + room, w: Math.max(120, box.w - room) } : { ...box, w: Math.max(120, box.w - room) };
      set = block(titleBox);
    };
    place();
    if (set && fs > set.fs * SUB.most) { fs = set.fs * SUB.most; place(); }   // less room taken: the title only grows
    const x = !set ? box.x : cols.title ? set.x - fs * 0.8 - across(fs) : set.x + set.w + fs * 0.8;
    const y = !set ? box.y : cols.title ? box.y + set.fs : set.y;
    const sbox = { x, y, w: across(fs), h: Math.max(fs * 2, box.y + box.h - y) };
    return { vertical: true, fs, titleBox: set ? titleBox : box, box: sbox, ink: titleBlockVertical(ctx, sub, sbox, font, 700, fs, sr) };
  }
  // the subtitle's line under the title's columns
  const per = lines.length * LH + SUB.gap;
  let reserve = fs * per;
  if (reserve > box.h * 0.45) { fs *= (box.h * 0.45) / reserve; reserve = box.h * 0.45; }
  let set = block({ ...box, h: box.h - reserve });
  if (set && fs > set.fs * SUB.most) { fs = set.fs * SUB.most; reserve = fs * per; set = block({ ...box, h: box.h - reserve }); }
  const sbox = { x: box.x, y: set ? set.y + set.h + fs * SUB.gap : box.y, w: box.w, h: lines.length * fs * LH };
  return { fs, reserve, box: sbox, ink: lineInk(ctx, lines, sbox, font, fs) };
}
