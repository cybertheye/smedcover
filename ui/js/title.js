// Title typesetting. One typed line is one line on the cover: text is never wrapped; instead the
// size is the largest at which the longest line fits the width and all lines fit the height.
import { INK } from "./cel.js";
import { paintRuns, bentLine, bendExtent } from "./textfx.js";
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

const LH = 1.16;   // line height, in sizes
/**
 * The lines' widths at size 100, and the size at which they fill `box` (times `s`), bent by `bend` ({id,
 * amt, own}, or null) when they have one: then what the bent lines reach past their block counts too
 * (`reach` at size 100: up past the first line, down past the last — a wide line between may reach past
 * them — and left and right of the widest; none for a perspective of the layer's own, `own`, which is the
 * user's to place). Leaves ctx's font at size 100.
 */
function fitLines(ctx, lines, box, font, maxFs, s = 1, bend = null) {
  ctx.font = `900 100px ${font}`;
  const widths = lines.map((l) => l.reduce((sum, a) => sum + ctx.measureText(a.t).width, 0)), widest = Math.max(...widths);
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
 * { font, fill, hi, ink, shadow, hiShadow, align, stroke, shadowAmt, maxFs, fx, fxAmt } — fx being
 * the text effect (see textfx.js) — and optionally `plate(x, y, w, h, fs)`, which paints a plate
 * under the lines, `hiPlate(x, y, w, h, fs)`, one under each highlighted word, and `skew`, the lines'
 * slant (default -0.08), and `reserve`, a height kept free under the lines (for the subtitle, see
 * subtitleFit): they fit the rest of the box, and the two are centred in it together. `bend` ({id, amt,
 * own}): each line is painted as it would be and then bent (bentLine in textfx.js), the size fitting what
 * the bent lines reach (see fitLines); `key` names what else decides how the lines look (the plates'
 * colours, say), for the bent lines kept. `hiPlate` is then given the context to paint on, sixth.
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
  if (st.onBlock) st.onBlock(ctx.getTransform ? ctx.getTransform() : null, block);   // where the block is, for the perspective's handles
  const pad = st.plate ? fs * 0.32 : 0, skew = st.skew ?? -0.08;
  if (st.plate) st.plate(reached.x - pad, reached.y - pad * 0.3, reached.w + pad * 2, reached.h + pad * 0.6, fs);
  lines.forEach((line, li) => {
    const lw = (widths[li] * fs) / 100;
    ctx.save();
    const ox = x0 + fs * 0.04 + (st.align === "center" ? (blockW - lw) / 2 : 0), oy = y0 + li * fs * LH + fs * 0.92;
    ctx.translate(ox, oy);
    if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
    const pass = (fn) => { let cx = 0; for (const a of line) { fn(a, cx); cx += ctx.measureText(a.t).width; } };
    const m = ctx.getTransform ? ctx.getTransform() : null;
    const o = {
      fs, d, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: st.fxAmt ?? 1, lineW: lw, seed: li * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow,
      C: st.C, fill: st.own, hi: st.ownHi, hiPlate: !!st.hiPlated, unit: m ? Math.hypot(m.a, m.b) : 1,
      frame: { ox, oy, c: skew, box: block }, warp: st.warp,
    };
    const paint = (c, unit) => {   // the line as it is, on c (the canvas, or the bent line's own)
      if (st.hiPlate) pass((a, x) => { if (a.hi) st.hiPlate(x - fs * 0.08, -fs * 0.86, ctx.measureText(a.t).width + fs * 0.16, fs * 1.06, fs, c); });
      paintRuns(c, pass, unit === o.unit ? o : { ...o, unit }, st.fx);
    };
    if (st.bend) bentLine(ctx, { ...o, bend: st.bend }, [JSON.stringify(line), ctx.font, st.fx, st.key || "", JSON.stringify({ ...o, frame: null, warp: null, unit: null })].join("|"), paint);
    else paint(ctx, o.unit);
    ctx.restore();
  });
  ctx.restore();
  return pad ? { x: reached.x - pad, y: reached.y - pad * 0.3, w: reached.w + pad * 2, h: reached.h + pad * 0.6 } : reached;
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
  return { x: box.x, y: box.y, w: blockW, h: tallest * k };
}
