// Title typesetting. One typed line is one line on the cover: text is never wrapped; instead the
// size is the largest at which the longest line fits the width and all lines fit the height.
import { INK } from "./cel.js";
import { paintRuns, bentLine, bendExtent, bendRest, reshaped } from "./textfx.js";
import { SUB, subtitleSize, titleFloor } from "./layout.js";

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
// (Vertical titles are set as they were: neither applies to a column.)
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
 * Draws the title into box {x,y,w,h}. `adj` is the manual {dx,dy,s}; `st` the style:
 * { font, fill, hi, ink, shadow, hiShadow, align, stroke, shadowAmt, maxFs, fx, fxAmt, fxSeed } — fx being
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
  if (st.onBlock) st.onBlock(ctx.getTransform ? ctx.getTransform() : null, block, rest);   // where the block is, for the bend's handles
  if (st.plate) st.plate(inked.x - pad, inked.y - pad * 0.3, inked.w + pad * 2, inked.h + pad * 0.6, fs);
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
      fs, d, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: st.fxAmt ?? 1, fxSeed: st.fxSeed, lineW: lw, seed: li * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow,
      C: st.C, fill: st.own, hi: st.ownHi, hiPlate: !!st.hiPlated, unit: m ? Math.hypot(m.a, m.b) : 1,
      frame: { ox, oy, c: skew, box: block }, warp: st.warp, reshape: rest ? st.reshape : undefined,
    };
    const paint = (c, unit) => {   // the line as it is, on c (the canvas, or the bent line's own)
      const marks = (phase) => { if (st.hiMark) set.runs.forEach((r, ri) => { if (r.hi) st.hiMark(r.x0, r.x1, fs, c, phase, li * 13 + ri); }); };
      const beneath = () => { if (st.hiPlate) for (const r of set.runs) if (r.hi) st.hiPlate(r.x0 - fs * 0.08, -fs * 0.86, r.x1 - r.x0 + fs * 0.16, fs * 1.06, fs, c); marks("under"); };   // under each highlighted run, whole
      const oo = unit === o.unit ? o : { ...o, unit };
      if (st.fx === "sticker") paintRuns(c, pass, { ...oo, beneath }, st.fx); else { beneath(); paintRuns(c, pass, oo, st.fx); }   // a sticker lays them on its rim, which would hide them
      marks("over");
    };
    if (st.bend) bentLine(ctx, { ...o, bend: st.bend }, [JSON.stringify(line), ctx.font, st.fx, st.key || "", JSON.stringify({ ...o, frame: null, warp: null, reshape: null, unit: null })].join("|"), paint);
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

const GAP = 1.06, PITCH = 1.32;   // a character's height and a column's pitch, in sizes
/**
 * The columns of a vertical title as units (one upright character, a sideways run, a gap), each with
 * its height at size 100, and the size at which they fill `box`. Leaves ctx's font at size 100.
 */
function fitColumns(ctx, lines, box, font, weight, maxFs) {
  ctx.font = `${weight} 100px ${font}`;
  const sideways = /[\x21-\x7e]/;
  const columns = lines.map((line) => {
    const units = [];
    for (const a of line) for (const ch of a.t) {
      const last = units[units.length - 1];
      if (ch === " " || ch === "　") units.push({ gap: true, h: 34 });
      else if (sideways.test(ch)) { if (last && last.run !== undefined && last.hi === a.hi) last.run += ch; else units.push({ run: ch, hi: a.hi }); }
      else units.push({ ch, hi: a.hi, h: 100 * GAP });
    }
    for (const u of units) if (u.run !== undefined) u.h = ctx.measureText(u.run).width + 12;
    return { units, h: units.reduce((s, u) => s + u.h, 0) };
  });
  const tallest = Math.max(...columns.map((c) => c.h));
  return { columns, tallest, fs: Math.max(8, Math.floor(Math.min(maxFs, (100 * box.h) / tallest, box.w / (columns.length * PITCH)))) };
}
/** The block drawTitleVertical would fill in `box`, without drawing it: {x, y, w, h, fs}, or null. */
export function titleBlockVertical(ctx, title, box, font, weight = 900, maxFs = 300) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save(); const { columns, tallest, fs } = fitColumns(ctx, lines, box, font, weight, maxFs); ctx.restore();
  const pitch = fs * PITCH;
  return { x: box.x, y: box.y, w: columns.length * pitch - (pitch - fs), h: (tallest * fs) / 100, fs };
}
/**
 * Sets the title vertically, as Chinese books do: each typed line is a column, read top to bottom,
 * the first column on the right. CJK characters stand upright one under another; a run of Latin
 * letters or digits lies on its side, as it does in a vertical line. The size is the largest at
 * which the longest column fits the height and all columns fit the width.
 * st: { font, weight, fill, hi, maxFs }. Returns the box it occupies, or null when there is nothing to draw.
 */
export function drawTitleVertical(ctx, title, box, st) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  const weight = st.weight || 900;
  ctx.save();
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const { columns, tallest, fs } = fitColumns(ctx, lines, box, st.font, weight, st.maxFs);
  const k = fs / 100, pitch = fs * PITCH, blockW = columns.length * pitch - (pitch - fs);
  ctx.font = `${weight} ${fs}px ${st.font}`;
  columns.forEach((col, i) => {
    const cx = box.x + blockW - fs / 2 - i * pitch;   // the first column is the rightmost
    let y = box.y;
    for (const u of col.units) {
      const h = u.h * k;
      ctx.fillStyle = u.hi ? st.hi : st.fill;
      if (u.ch) ctx.fillText(u.ch, cx, y + h / 2);
      else if (u.run !== undefined) { ctx.save(); ctx.translate(cx, y + h / 2); ctx.rotate(Math.PI / 2); ctx.fillText(u.run, 0, fs * 0.04); ctx.restore(); }
      y += h;
    }
  });
  ctx.restore();
  return { x: box.x, y: box.y, w: blockW, h: tallest * k, fs };
}
