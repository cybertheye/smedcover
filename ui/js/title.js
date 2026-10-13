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

/**
 * Draws the title into box {x,y,w,h}. `adj` is the manual {dx,dy,s}; `st` the style:
 * { font, fill, hi, ink, shadow, hiShadow, align, stroke, shadowAmt, maxFs, fx, fxAmt } — fx being
 * the text effect (see textfx.js).
 * Returns the box it occupies (for hit-testing), or null when there is nothing to draw.
 */
export function drawTitle(ctx, title, box, adj, st) {
  const lines = parseTitle(title);
  if (!lines.length) return null;
  const LH = 1.16;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.font = `900 100px ${st.font}`;
  const widths = lines.map((l) => l.reduce((s, a) => s + ctx.measureText(a.t).width, 0));
  const widest = Math.max(...widths);
  const fs = Math.max(8, Math.floor(Math.min(st.maxFs, (100 * box.w) / (widest * 1.04), box.h / (lines.length * LH)) * adj.s));
  ctx.font = `900 ${fs}px ${st.font}`;
  const blockW = (widest * fs) / 100;
  const x0 = box.x + adj.dx + (st.align === "center" ? (box.w - blockW) / 2 : 0);
  const y0 = box.y + (box.h - lines.length * fs * LH) / 2 + adj.dy;
  const d = fs * 0.062 * st.shadowAmt;
  lines.forEach((line, li) => {
    const lw = (widths[li] * fs) / 100;
    ctx.save();
    ctx.translate(x0 + fs * 0.04 + (st.align === "center" ? (blockW - lw) / 2 : 0), y0 + li * fs * LH + fs * 0.92);
    ctx.transform(1, 0, -0.08, 1, 0, 0);
    const pass = (fn) => { let cx = 0; for (const a of line) { fn(a, cx); cx += ctx.measureText(a.t).width; } };
    const m = ctx.getTransform ? ctx.getTransform() : null;
    paintRuns(ctx, pass, {
      fs, d, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: st.fxAmt ?? 1, lineW: lw, seed: li * 17.3 + 1,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow,
      C: st.C, fill: st.own, hi: st.ownHi, unit: m ? Math.hypot(m.a, m.b) : 1,
    }, st.fx);
    ctx.restore();
  });
  ctx.restore();
  return { x: x0, y: y0, w: blockW, h: lines.length * fs * LH };
}
export { INK };
