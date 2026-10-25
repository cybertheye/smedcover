// The layer panel's 3D view: the cover taken apart, each layer a sheet of its own stacked over the one
// below it and seen at an angle, so what each layer holds, and which lies over which, can be seen.
// The view is axonometric (no perspective): each sheet is an affine image of the cover, drawn with one
// transform of a 2D context, and a point on screen maps back onto any sheet exactly.
// Maths and drawing only; the editor (app.js) keeps the state, paints the layers and handles input.

const RAD = Math.PI / 180;
/** The view it opens on: the stack spun a little, tipped back. */
export const VIEW = { yaw: -30, pitch: 58, spread: 1 };
export const LIMITS = { yaw: [-80, 80], pitch: [0, 80], spread: [0.3, 2.5] };

/**
 * The turn of the stack: spun by `yaw` about its own axis, then tipped back by `pitch` (0: face on,
 * every sheet over the one below; 90: edge on). A point (u, v) of a sheet at height z, from the cover's
 * centre, lands at (a·u + c·v, b·u + d·v − z·lift) before scaling.
 */
export function turn(yaw, pitch) {
  const cy = Math.cos(yaw * RAD), sy = Math.sin(yaw * RAD), cp = Math.cos(pitch * RAD), sp = Math.sin(pitch * RAD);
  return { a: cy, b: cp * sy, c: -sy, d: cp * cy, lift: sp };
}
/** The gap between sheets, in virtual pixels, for n sheets of a cover h tall: the stack about as tall as the cover, whatever the count. */
export const gapFor = (n, h, spread) => h * Math.min(0.3, Math.max(0.07, 1.25 / Math.max(1, n - 1))) * spread;
/**
 * Fits a w × h cover whose sheets lie between heights z0 and z1, turned by T, into `box` ({x, y, w, h}
 * on screen): {T, w, h, s, cx, cy, zMid} — the scale, and where the middle of the stack lands.
 */
export function fitView(T, w, h, z0, z1, box) {
  const hx = Math.abs(T.a) * w / 2 + Math.abs(T.c) * h / 2, hy = Math.abs(T.b) * w / 2 + Math.abs(T.d) * h / 2;
  const s = Math.max(1e-6, Math.min(box.w / Math.max(1e-6, 2 * hx), box.h / Math.max(1e-6, 2 * hy + (z1 - z0) * T.lift)));
  return { T, w, h, s, cx: box.x + box.w / 2, cy: box.y + box.h / 2, zMid: (z0 + z1) / 2 };
}
/** The sheet at height z as a transform from virtual cover pixels to the screen: {a, b, c, d, e, f}, as setTransform takes it. */
export function sheetAt(V, z) {
  const { T, w, h, s } = V;
  return { a: s * T.a, b: s * T.b, c: s * T.c, d: s * T.d,
    e: V.cx - s * (T.a * w / 2 + T.c * h / 2), f: V.cy - s * (T.b * w / 2 + T.d * h / 2) - s * (z - V.zMid) * T.lift };
}
/** Where screen point (x, y) lies on the sheet with transform m, in virtual cover pixels (null edge on). */
export function toSheet(m, x, y) {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-9) return null;
  const dx = x - m.e, dy = y - m.f;
  return { x: (m.d * dx - m.c * dy) / det, y: (-m.b * dx + m.a * dy) / det };
}
const at = (m, x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
/** The four corners of a w × h sheet on screen, clockwise from its top left. */
export const corners = (m, w, h) => [at(m, 0, 0), at(m, w, 0), at(m, w, h), at(m, 0, h)];
/**
 * The point labels are tied to: the sheet's rightmost corner, or the middle of its right edge when it is
 * square on. Every sheet has the same one, as height only moves a sheet up the screen.
 */
export function anchorOf(m, w, h) {
  const cs = corners(m, w, h), right = Math.max(...cs.map((p) => p.x)), on = cs.filter((p) => p.x > right - 0.5);
  return { x: right, y: on.reduce((t, p) => t + p.y, 0) / on.length };
}
/**
 * Centres for labels `size` tall that want to sit at heights `ys`, moved apart as little as will keep
 * them from overlapping and inside [top, bottom]. With more than fit, the lowest overlap.
 */
export function spreadLabels(ys, size, top, bottom) {
  const order = ys.map((_, i) => i).sort((i, j) => ys[i] - ys[j]), out = ys.slice();
  let prev = -Infinity;
  for (const i of order) prev = out[i] = Math.max(out[i], prev + size, top + size / 2);
  let next = Infinity;
  for (const i of [...order].reverse()) next = out[i] = Math.min(out[i], next - size, bottom - size / 2);
  prev = -Infinity;
  for (const i of order) prev = out[i] = Math.max(out[i], prev + size, top + size / 2);
  return out;
}
/**
 * The front-most sheet under screen point (x, y) where `solid(sheet, fx, fy)` says the layer has
 * something (fx, fy: the point across the cover, 0 to 1), or null. sheets: [{z, …}].
 */
export function sheetUnder(V, sheets, x, y, solid) {
  for (const sh of [...sheets].sort((p, q) => q.z - p.z)) {
    const p = toSheet(sheetAt(V, sh.z), x, y);
    if (p && p.x >= 0 && p.y >= 0 && p.x < V.w && p.y < V.h && solid(sh, p.x / V.w, p.y / V.h)) return sh;
  }
  return null;
}

const LABEL = { h: 20, gap: 3, pad: 7, lead: 26, font: '600 12px "Noto Sans SC", -apple-system, "Segoe UI", sans-serif' };
/** How wide the column of labels is for these names (screen pixels), the leader lines included. */
export function labelRoom(ctx, names, max = 170) {
  ctx.font = LABEL.font;
  return LABEL.lead + 12 + Math.min(max, Math.max(40, ...names.map((n) => ctx.measureText(n).width))) + LABEL.pad * 2;
}
const fit1 = (ctx, s, max) => {   // s cut short with an ellipsis to fit max pixels
  if (ctx.measureText(s).width <= max) return s;
  while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
  return s + "…";
};
/**
 * Paints the stack. o: {dpr, W, H (the canvas in CSS pixels), V (from fitView), sheets: [{id, img, box (the part of
 * img anything is painted on, as fractions of it: only that part is drawn; null: none), z, alpha, label, dim,
 * mark: "" | "sel" | "hover" | "peek"}], deco (0–1: how much of the sheets' edges and
 * labels shows; 0 while the stack is closed flat), acc (the accent colour), room (the label column's width), fast (it
 * is opening, closing or being turned: the sheets drawn with plainer filtering)}.
 */
export function drawStack(ctx, o) {
  const { dpr, V, deco } = o, { w, h } = V;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = o.fast ? "low" : "high";   // plain filtering while it moves
  const list = [...o.sheets].sort((p, q) => p.z - q.z), screen = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const outline = (cs) => { ctx.beginPath(); cs.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
  for (const sh of list) {
    const m = sheetAt(V, sh.z), cs = corners(m, w, h);
    screen();
    if (deco > 0) { ctx.globalAlpha = deco * (sh.dim ? 0.3 : 1); outline(cs); ctx.fillStyle = "rgba(255,255,255,0.035)"; ctx.fill(); }   // a pane of glass, so an all but empty layer still shows where it is
    ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
    ctx.globalAlpha = sh.alpha * (sh.dim ? 0.18 : 1);
    const b = sh.box === undefined ? { x: 0, y: 0, w: 1, h: 1 } : sh.box, iw = sh.img && sh.img.width, ih = sh.img && sh.img.height;
    if (sh.img && b) ctx.drawImage(sh.img, b.x * iw, b.y * ih, b.w * iw, b.h * ih, b.x * w, b.y * h, b.w * w, b.h * h);   // a layer with little on it costs little
    screen();
    if (deco > 0) {
      ctx.globalAlpha = deco * (sh.dim ? 0.3 : 1); outline(cs);
      ctx.setLineDash(sh.hidden ? [5, 4] : []); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (deco <= 0) { ctx.globalAlpha = 1; return; }
  // the marked sheets' edges over everything, so one far down the stack still shows where it is
  screen();
  for (const sh of list) {
    if (!sh.mark) continue;
    outline(corners(sheetAt(V, sh.z), w, h));
    ctx.globalAlpha = deco; ctx.lineWidth = sh.mark === "sel" ? 2.5 : 2; ctx.strokeStyle = sh.mark === "sel" ? o.acc : "#fff"; ctx.stroke();
  }
  // the labels, in a column right of the stack, each tied to its sheet's corner
  ctx.font = LABEL.font; ctx.textBaseline = "middle";
  const top = list.slice().reverse(), anchors = top.map((sh) => anchorOf(sheetAt(V, sh.z), w, h));
  const ys = spreadLabels(anchors.map((p) => p.y), LABEL.h + LABEL.gap, 8, o.H - 8), x0 = anchors.length ? anchors[0].x + LABEL.lead : 0;
  const maxText = Math.max(30, o.room - LABEL.lead - 12 - LABEL.pad * 2);
  top.forEach((sh, i) => {
    const p = anchors[i], y = ys[i], text = fit1(ctx, sh.label, maxText), tw = ctx.measureText(text).width, strong = !!sh.mark;
    ctx.globalAlpha = deco * (sh.dim && !strong ? 0.35 : 1);
    ctx.strokeStyle = strong ? (sh.mark === "sel" ? o.acc : "#fff") : "rgba(255,255,255,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x0 - 8, y); ctx.lineTo(x0, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
    ctx.fillStyle = "rgba(20,20,31,0.94)"; ctx.fillRect(x0, y - LABEL.h / 2, tw + LABEL.pad * 2, LABEL.h);
    ctx.strokeRect(x0 + 0.5, y - LABEL.h / 2 + 0.5, tw + LABEL.pad * 2 - 1, LABEL.h - 1);
    ctx.fillStyle = sh.mark === "sel" ? o.acc : strong ? "#fff" : sh.hidden ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.85)";
    ctx.fillText(text, x0 + LABEL.pad, y + 0.5);
  });
  ctx.globalAlpha = 1;
}
