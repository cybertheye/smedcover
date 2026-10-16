// Title typesetting. One typed line is one line on the cover: text is never wrapped; instead the
// size is the largest at which the longest line fits the width and all lines fit the height.
import { INK } from "./cel.js";
import { paintRuns } from "./textfx.js";

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
/** The lines' widths at size 100, and the size at which they fill `box` (times `s`). Leaves ctx's font at size 100. */
function fitLines(ctx, lines, box, font, maxFs, s = 1) {
  ctx.font = `900 100px ${font}`;
  const widths = lines.map((l) => l.reduce((sum, a) => sum + ctx.measureText(a.t).width, 0)), widest = Math.max(...widths);
  return { widths, widest, fs: Math.max(8, Math.floor(Math.min(maxFs, (100 * box.w) / (widest * 1.04), box.h / (lines.length * LH)) * s)) };
}
/** The block drawTitle would fill in `box`, left-aligned and unadjusted, without drawing it: {x, y, w, h}, or null. */
export function titleBlock(ctx, title, box, font, maxFs = 340) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save(); const { widest, fs } = fitLines(ctx, lines, box, font, maxFs); ctx.restore();
  const h = lines.length * fs * LH;
  return { x: box.x, y: box.y + (box.h - h) / 2, w: (widest * fs) / 100, h };
}

/**
 * Draws the title into box {x,y,w,h}. `adj` is the manual {dx,dy,s}; `st` the style:
 * { font, fill, hi, ink, shadow, hiShadow, align, stroke, shadowAmt, maxFs, fx, fxAmt } — fx being
 * the text effect (see textfx.js) — and optionally `plate(x, y, w, h, fs)`, which paints a plate
 * under the lines, and `skew`, the lines' slant (default -0.08).
 * Returns the box it occupies (for hit-testing), or null when there is nothing to draw.
 */
export function drawTitle(ctx, title, box, adj, st) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const { widths, widest, fs } = fitLines(ctx, lines, box, st.font, st.maxFs, adj.s);
  ctx.font = `900 ${fs}px ${st.font}`;
  const blockW = (widest * fs) / 100;
  const x0 = box.x + adj.dx + (st.align === "center" ? (box.w - blockW) / 2 : 0);
  const y0 = box.y + (box.h - lines.length * fs * LH) / 2 + adj.dy;
  const d = fs * 0.062 * st.shadowAmt, block = { x: x0, y: y0, w: blockW, h: lines.length * fs * LH };
  if (st.onBlock) st.onBlock(ctx.getTransform ? ctx.getTransform() : null, block);   // where the block is, for the perspective's handles
  const pad = st.plate ? fs * 0.32 : 0, skew = st.skew ?? -0.08;
  if (st.plate) st.plate(block.x - pad, block.y - pad * 0.3, block.w + pad * 2, block.h + pad * 0.6, fs);
  lines.forEach((line, li) => {
    const lw = (widths[li] * fs) / 100;
    ctx.save();
    const ox = x0 + fs * 0.04 + (st.align === "center" ? (blockW - lw) / 2 : 0), oy = y0 + li * fs * LH + fs * 0.92;
    ctx.translate(ox, oy);
    if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
    const pass = (fn) => { let cx = 0; for (const a of line) { fn(a, cx); cx += ctx.measureText(a.t).width; } };
    const m = ctx.getTransform ? ctx.getTransform() : null;
    paintRuns(ctx, pass, {
      fs, d, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: st.fxAmt ?? 1, lineW: lw, seed: li * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow,
      C: st.C, fill: st.own, hi: st.ownHi, unit: m ? Math.hypot(m.a, m.b) : 1,
      frame: { ox, oy, c: skew, box: block }, warp: st.warp,
    }, st.fx);
    ctx.restore();
  });
  ctx.restore();
  return pad ? { x: block.x - pad, y: block.y - pad * 0.3, w: block.w + pad * 2, h: block.h + pad * 0.6 } : block;
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
/** The block drawTitleVertical would fill in `box`, without drawing it: {x, y, w, h}, or null. */
export function titleBlockVertical(ctx, title, box, font, weight = 900, maxFs = 300) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  ctx.save(); const { columns, tallest, fs } = fitColumns(ctx, lines, box, font, weight, maxFs); ctx.restore();
  const pitch = fs * PITCH;
  return { x: box.x, y: box.y, w: columns.length * pitch - (pitch - fs), h: (tallest * fs) / 100 };
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
