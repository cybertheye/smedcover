// constructivist: the poster as a machine
// The Soviet avant-garde as illustrators take it up today: cream paper gone a little brown; a machine (the
// channel graphic) built again out of rectangles of grey, black, bare paper and one red; great diagonal
// wedges, a disc, rays fanning from a vanishing point, a steel truss, bars and blocks, construction lines
// and dot grids, small type set as furniture; the lower part doubled in still water. Flat, hard-edged.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, boost, canPaint, cellsOf, clamp, crumple, css, dark, fall, grain, graphicShape, greeked, grey, gridPen, inkAs, keepClear, lumOf, mapped, mix, objAt, openField, overlaps, painters, rand, reflectBelow, sat, shapeCells, shapeOf, shift, slantPath, toneTable, tonesFx, upright, values, vignette, wear } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CN = { paper: [232, 223, 202], light: [244, 238, 224], night: [26, 25, 24], ink: [24, 23, 23], red: [204, 52, 38], greys: [[208, 204, 194], [164, 162, 156], [120, 120, 118], [80, 80, 82]] };
const cnGround = () => (dark ? CN.night : CN.paper), cnInk = () => (dark ? CN.paper : CN.ink);
/** The greys a photo or a layer is pressed into, by lightness (see toneTable). */
const CN_TONES = [[0, CN.ink], [0.3, CN.greys[3]], [0.5, CN.greys[2]], [0.68, CN.greys[1]], [0.84, CN.greys[0]], [1, CN.light]];
/** RGBA pixels mapped by lightness through `lut` (see toneTable), mixed in by a; alpha kept. */
function lutPixels(d, lut, a) {
  for (let i = 0, n = d.length; i < n; i += 4) {
    const j = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3;
    d[i] += (lut[j] - d[i]) * a; d[i + 1] += (lut[j + 1] - d[i + 1]) * a; d[i + 2] += (lut[j + 2] - d[i + 2]) * a;
  }
}
/** The one colour: the poster red, turned by degrees (the Channel colour slider) to the channel's, made strong enough to print. */
const cnRed = (C, p = values) => mix(CN.red, boost(C || CN.red, 0.4), clamp((p && p.chan) || 0));
/** Smooth value noise (0–1) over the plane, a cell to the unit: tones that stay put as the blocks are cut finer. */
function cnNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), v = (i, j) => rand(i * 57.13 + j * 113.71 + 5000);
  const a = v(xi, yi) + (v(xi + 1, yi) - v(xi, yi)) * sx, b = v(xi, yi + 1) + (v(xi + 1, yi + 1) - v(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}
/**
 * Cells joined into rectangles: every cell ok(i, j) allows, scanned row by row, starts a block that grows
 * to the right and then down — to a width and height of its own, at most mw × mh cells — while the cells
 * it takes are allowed, free and same(i, j, a, b) as its first. Returns [[i, j, w, h], …].
 */
export function joinCells(cols, rows, ok, same, mw, mh, k0) {
  const used = new Uint8Array(cols * rows), out = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (used[j * cols + i] || !ok(i, j)) continue;
    const tw = 1 + Math.floor(rand(i * 1.31 + j * 2.17 + k0) * mw), th = 1 + Math.floor(rand(i * 2.71 + j * 1.13 + k0 + 1) * mh), fits = (a, b) => a < cols && b < rows && !used[b * cols + a] && ok(a, b) && same(i, j, a, b);
    let bw = 1, bh = 1;
    while (bw < tw && fits(i + bw, j)) bw++;
    grow: while (bh < th) { for (let q = 0; q < bw; q++) if (!fits(i + q, j + bh)) break grow; bh++; }
    for (let b = 0; b < bh; b++) for (let q = 0; q < bw; q++) used[(j + b) * cols + i + q] = 1;
    out.push([i, j, bw, bh]);
  }
  return out;
}
/**
 * The machine, built of blocks: the shape — cov(i, j), how much of a cell it covers (0–255) — over a grid
 * of `cell` units from (x0, y0), joined into rectangles, each one flat tone: greys by a smooth field and a
 * light from the upper left, so neighbours agree; one in ten in ink, one in twelve bare paper, one in
 * eighteen red; some with a hairline round them, a row of slots or a rivet. Masts with yards rise from
 * the highest columns.
 */
function cnMachine(ctx, x0, y0, cols, rows, cell, cov, red, k0) {
  const blocks = joinCells(cols, rows, (i, j) => cov(i, j) > 110, () => true, 4, 6, k0), W = cols * cell, H = rows * cell, ink = cnInk(), fills = new Map(), lines = [], slots = [], dots = [];
  const put = (c, r) => { const key = c.map(Math.round).join(); (fills.get(key) || fills.set(key, []).get(key)).push(r); };
  for (const [i, j, bw, bh] of blocks) {
    const x = x0 + i * cell, y = y0 + j * cell, w = bw * cell, h = bh * cell, cx = x + w / 2, cy = y + h / 2, r = rand(i * 3.7 + j * 5.3 + k0 + 2);
    const v = 0.55 * cnNoise((cx - x0) / (W * 0.16), (cy - y0) / (W * 0.16)) + 0.45 * (0.5 * (cx - x0) / W + 0.5 * (cy - y0) / H);
    put(r < 0.055 ? red : r < 0.155 ? ink : r < 0.235 ? CN.light : CN.greys[Math.min(3, Math.floor(v * 4.4))], [x, y, w + 0.6, h + 0.6]);
    if (rand(i * 6.1 + j * 2.9 + k0 + 3) < 0.3) lines.push([x, y, w, h]);
    if (bw * bh >= 3 && rand(i * 4.3 + j * 7.1 + k0 + 4) < 0.28) slots.push([x, y, w, h]);
    else if (rand(i * 8.9 + j * 3.3 + k0 + 5) < 0.08) dots.push([cx, cy, Math.min(w, h) * 0.28]);
  }
  for (const [key, list] of fills) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (const [x, y, w, h] of list) ctx.rect(x, y, w, h); ctx.fill(); }
  ctx.fillStyle = css(mix(CN.ink, CN.greys[3], 0.3)); ctx.beginPath();
  for (const [x, y, w, h] of slots) { const n = Math.max(2, Math.round(w / (cell * 0.6))); for (let q = 0; q < n; q++) ctx.rect(x + (q + 0.25) * (w / n), y + h * 0.3, (w / n) * 0.5, Math.min(h * 0.25, cell * 0.3)); }
  ctx.fill();
  ctx.fillStyle = css(cnGround()); ctx.beginPath(); for (const [x, y, r] of dots) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); } ctx.fill();
  ctx.strokeStyle = css(ink, 0.55); ctx.lineWidth = Math.max(0.8, cell * 0.05); ctx.beginPath(); for (const [x, y, w, h] of lines) ctx.rect(x, y, w, h); ctx.stroke();
  const tops = [];
  for (let i = 0; i < cols; i++) { let j = 0; while (j < rows && cov(i, j) <= 110) j++; if (j < rows) tops.push([i, j]); }
  tops.sort((a, b) => a[1] - b[1]);
  const masts = [];
  for (const t of tops) { if (masts.length >= 3) break; if (masts.every((m) => Math.abs(m[0] - t[0]) > cols * 0.12)) masts.push(t); }
  ctx.strokeStyle = css(ink); ctx.fillStyle = css(ink); ctx.lineCap = "butt";
  for (const [i, j] of masts) {
    const x = x0 + (i + 0.5) * cell, y = y0 + j * cell, mh = H * (0.1 + rand(i * 2.3 + k0 + 9) * 0.12);
    ctx.lineWidth = Math.max(1, cell * 0.14); ctx.beginPath(); ctx.moveTo(x, y + 1); ctx.lineTo(x, y - mh);
    for (const f of [0.4, 0.7]) { const yw = W * 0.035 * (1.3 - f); ctx.moveTo(x - yw, y - mh * f); ctx.lineTo(x + yw, y - mh * f); }
    ctx.stroke(); ctx.fillRect(x - cell * 0.3, y - mh * 0.9, cell * 0.6, cell * 0.45);
  }
}
/** Without a graphic, a ship seen side on, in tiers: the hull, decks stepping in, the bridge, a funnel, two turrets — as cov() for cnMachine over cols × rows. */
const cnShip = (cols, rows) => (i, j) => {
  const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
  const hull = v > 0.7 && v < 0.95 && Math.abs(u - 0.5) < 0.44 - (v - 0.7) * (u > 0.5 ? 0.9 : 0.3);
  const tiers = (v > 0.55 && Math.abs(u - 0.46) < 0.26) || (v > 0.4 && Math.abs(u - 0.44) < 0.16) || (v > 0.26 && Math.abs(u - 0.43) < 0.08) || (v > 0.34 && Math.abs(u - 0.6) < 0.035);
  const turrets = v > 0.6 && v < 0.7 && (Math.abs(u - 0.17) < 0.05 || Math.abs(u - 0.76) < 0.05);
  return hull || tiers || turrets ? 255 : 0;
};
/** Rays fanning out from (vx, vy) past the edges: long thin wedges of grey, ink and red, set round by the golden angle so each new one falls in a gap; `n`, the last by degrees. */
function cnRays(ctx, F, vx, vy, n, red, k0) {
  const R = Math.hypot(F.x1 - F.x0, F.y1 - F.y0) * 1.5, cols = [CN.greys[0], cnInk(), CN.greys[1], red, CN.greys[2], CN.greys[0], cnInk()];
  for (let i = 0; i < Math.ceil(n); i++) {
    const a = TAU * ((i * 0.381966 + rand(k0)) % 1), half = (0.018 + rand(i * 2.3 + k0 + 1) * 0.05) * (0.3 + 0.7 * clamp(n - i));
    ctx.fillStyle = css(cols[i % cols.length]); shapeOf(ctx, [[vx, vy], [vx + Math.cos(a - half) * R, vy + Math.sin(a - half) * R], [vx + Math.cos(a + half) * R, vy + Math.sin(a + half) * R]]); ctx.fill();
  }
}
/**
 * The great diagonal forms, in fractions of the field: a red wedge rising from a lower corner, a black band
 * falling across, a grey corner, a thin red band climbing out, a pale wedge, a black one — `n` of them,
 * each growing out of its corner by degrees; mirrored when `flip`.
 */
function cnWedges(ctx, F, n, red, flip) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, X = (t) => (flip ? F.x1 - fw * t : F.x0 + fw * t), Y = (t) => F.y0 + fh * t, ink = cnInk();
  const forms = [
    [red, [-0.02, 1.02], [[-0.02, 1.02], [0.66, 1.02], [-0.02, 0.4]]],
    [ink, [0.62, -0.02], [[0.56, -0.02], [0.68, -0.02], [0.2, 1.02], [0.08, 1.02]]],
    [CN.greys[1], [1.02, -0.02], [[1.02, -0.02], [1.02, 0.5], [0.58, -0.02]]],
    [red, [1.02, 0.18], [[0.3, 1.02], [0.37, 1.02], [1.02, 0.24], [1.02, 0.12]]],
    [CN.greys[0], [-0.02, -0.02], [[-0.02, -0.02], [0.4, -0.02], [-0.02, 0.24]]],
    [ink, [1.02, 1.02], [[0.8, 1.02], [1.02, 1.02], [1.02, 0.64]]],
  ];
  for (let i = 0; i < Math.min(forms.length, Math.ceil(n)); i++) {
    const [c, [ax, ay], pts] = forms[i], s = 0.25 + 0.75 * clamp(n - i);
    ctx.fillStyle = css(c); shapeOf(ctx, pts.map(([x, y]) => [X(ax + (x - ax) * s), Y(ay + (y - ay) * s)])); ctx.fill();
  }
}
/**
 * A steel truss in perspective, from its near end at xn (d0 deep) to its far end at xf (d1 deep), its middle
 * on the line y: the chords top and bottom and the zigzag of struts between, each a flat bar in `col` with
 * a lit edge.
 */
function cnTruss(ctx, xn, xf, y, d0, d1, col, lit) {
  const L = Math.abs(xf - xn), X = (t) => xn + (xf - xn) * t, D = (t) => d0 + (d1 - d0) * t, ts = [0];
  const bar = (ax, ay, bx, by, w) => {
    const dx = bx - ax, dy = by - ay, n = Math.hypot(dx, dy) || 1, ox = ((-dy / n) * w) / 2, oy = ((dx / n) * w) / 2;
    ctx.fillStyle = css(col); shapeOf(ctx, [[ax + ox, ay + oy], [bx + ox, by + oy], [bx - ox, by - oy], [ax - ox, ay - oy]]); ctx.fill();
    ctx.strokeStyle = css(lit); ctx.lineWidth = Math.max(1, w * 0.25); ctx.beginPath(); ctx.moveTo(ax + ox, ay + oy); ctx.lineTo(bx + ox, by + oy); ctx.stroke();
  };
  for (let t = 0; t < 1;) { t = Math.min(1, t + (D(t) * 0.95) / Math.max(1, L)); ts.push(t); }
  ts.forEach((t, q) => {
    const x = X(t), w = D(t) * 0.07;
    bar(x, y - D(t) / 2, x, y + D(t) / 2, w);
    if (q) { const tp = ts[q - 1], xp = X(tp); if (q % 2) bar(xp, y - D(tp) / 2, x, y + D(t) / 2, w); else bar(xp, y + D(tp) / 2, x, y - D(t) / 2, w); }
  });
  bar(X(0), y - D(0) / 2, X(1), y - D(1) / 2, d0 * 0.1); bar(X(0), y + D(0) / 2, X(1), y + D(1) / 2, d0 * 0.1);
}
/** Bars and blocks set about the edges of the field: tall bars of ink and of red, squares of grey, stacks of short rules, a block of bare paper with a hairline round it — `n`, the last by degrees, kept off the boxes in `avoid`. */
function cnBars(ctx, F, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), ink = cnInk();
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const kind = i % 5, left = rand(i * 1.9 + k0) < 0.5, x = left ? F.x0 + fw * (0.02 + rand(i * 2.3 + k0 + 1) * 0.28) : F.x1 - fw * (0.04 + rand(i * 2.7 + k0 + 2) * 0.28), y = F.y0 + fh * (0.08 + rand(i * 3.1 + k0 + 3) * 0.8), r = rand(i * 4.3 + k0 + 4);
    const box = kind === 0 || kind === 3 ? { x, y, w: u * (0.008 + r * 0.018), h: fh * (0.14 + rand(i * 5.1 + k0 + 5) * 0.32) } : kind === 1 ? { x, y, w: u * (0.04 + r * 0.07), h: u * (0.04 + r * 0.07) } : kind === 2 ? { x, y, w: u * (0.05 + r * 0.05), h: u * 0.06 } : { x, y, w: u * (0.08 + r * 0.08), h: u * (0.05 + r * 0.06) };
    if (avoid.some((b) => overlaps(b, box))) continue;
    ctx.globalAlpha = clamp(n - i);
    if (kind === 0) { ctx.fillStyle = css(ink); ctx.fillRect(box.x, box.y, box.w, box.h); }
    else if (kind === 3) { ctx.fillStyle = css(red); ctx.fillRect(box.x, box.y, box.w * 1.4, box.h * 0.8); }
    else if (kind === 1) { ctx.fillStyle = css([CN.greys[2], ink, red, CN.greys[1]][Math.floor(r * 4)]); ctx.fillRect(box.x, box.y, box.w, box.h); }
    else if (kind === 2) { ctx.fillStyle = css(ink); for (let q = 0; q < 4; q++) ctx.fillRect(box.x, box.y + q * box.h * 0.27, box.w * (q % 2 ? 0.7 : 1), box.h * 0.12); }
    else { ctx.fillStyle = css(CN.light); ctx.fillRect(box.x, box.y, box.w, box.h); ctx.strokeStyle = css(ink); ctx.lineWidth = 1.2; ctx.strokeRect(box.x, box.y, box.w, box.h); }
  }
  ctx.restore();
}
/** Construction lines: long hairlines through the vanishing point (vx, vy), level ones, arcs about it, dot grids, crosshairs, a line of red — `n`, the last by degrees; the grids and crosshairs kept off `avoid`. */
function cnLines(ctx, F, vx, vy, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), R = Math.hypot(fw, fh), ink = cnInk();
  ctx.save(); ctx.lineCap = "butt";
  for (let i = 0; i < Math.ceil(n); i++) {
    const kind = i % 6, r1 = rand(i * 2.1 + k0), r2 = rand(i * 3.7 + k0 + 1), x = F.x0 + fw * (0.05 + 0.9 * r1), y = F.y0 + fh * (0.08 + 0.84 * r2);
    ctx.globalAlpha = clamp(n - i); ctx.strokeStyle = css(ink, 0.75); ctx.fillStyle = css(ink); ctx.lineWidth = 1.2;
    if (kind === 0) { const a = r1 * Math.PI; ctx.beginPath(); ctx.moveTo(vx - Math.cos(a) * R, vy - Math.sin(a) * R); ctx.lineTo(vx + Math.cos(a) * R, vy + Math.sin(a) * R); ctx.stroke(); }
    else if (kind === 1) { ctx.beginPath(); ctx.moveTo(F.x0, y); ctx.lineTo(F.x1, y); ctx.stroke(); }
    else if (kind === 2) { const a0 = r2 * TAU; ctx.beginPath(); ctx.arc(vx, vy, u * (0.15 + r1 * 0.4), a0, a0 + Math.PI * (0.5 + r2)); ctx.stroke(); }
    else if (kind === 3) { const s = u * 0.018, box = { x, y, w: s * 6, h: s * 4 }; if (avoid.some((b) => overlaps(b, box))) continue; ctx.beginPath(); for (let q = 0; q < 24; q++) { const dx = x + (q % 6) * s, dy = y + Math.floor(q / 6) * s; ctx.moveTo(dx + 1.8, dy); ctx.arc(dx, dy, 1.8, 0, TAU); } ctx.fill(); }
    else if (kind === 4) { const s = u * 0.03, box = { x: x - s, y: y - s, w: s * 2, h: s * 2 }; if (avoid.some((b) => overlaps(b, box))) continue; ctx.beginPath(); ctx.moveTo(x - s, y); ctx.lineTo(x + s, y); ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); ctx.moveTo(x + s * 0.45, y); ctx.arc(x, y, s * 0.45, 0, TAU); ctx.stroke(); }
    else { ctx.strokeStyle = css(red); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - fw * 0.3, y + fh * 0.3); ctx.lineTo(x + fw * 0.3, y - fh * 0.3); ctx.stroke(); }
  }
  ctx.restore();
}
/**
 * Small type set as furniture, as these posters set it — greeked, not words: a block of lines, a short
 * thick rule of red over a few lines, bullets of small squares with lines beside them, a column of lines
 * turned on its side, a slab of ink with paper lines in it, an arrow. `n`, each kept off `avoid`.
 */
function cnMarks(ctx, F, n, red, avoid, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), ink = cnInk(), lh = u * 0.016, at = [[0.05, 0.6], [0.44, 0.86], [0.84, 0.08], [0.9, 0.48], [0.3, 0.05], [0.6, 0.07]];
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const [fx, fy] = at[i % at.length], x = F.x0 + fw * (fx + (rand(i * 2.3 + k0) - 0.5) * 0.06), y = F.y0 + fh * (fy + (rand(i * 3.1 + k0 + 1) - 0.5) * 0.06), kind = i % 6, bw = u * 0.2;
    const box = kind === 3 ? { x, y, w: lh * 4, h: bw } : { x, y, w: bw, h: lh * 6 };
    if (avoid.some((b) => overlaps(b, box))) continue;
    ctx.globalAlpha = clamp(n - i);
    if (kind === 0) greeked(ctx, x, y, bw, 5, lh, css(ink, 0.85), 2900 + i * 13);
    else if (kind === 1) { ctx.fillStyle = css(red); ctx.fillRect(x, y, bw * 0.35, lh * 0.9); greeked(ctx, x, y + lh * 2, bw * 0.8, 3, lh, css(ink, 0.85), 2910 + i * 13); }
    else if (kind === 2) { for (let q = 0; q < 3; q++) { ctx.fillStyle = css(q === 0 ? red : ink); ctx.fillRect(x, y + q * lh * 1.8, lh * 0.8, lh * 0.8); greeked(ctx, x + lh * 1.8, y + q * lh * 1.8 + lh * 0.2, bw * 0.6, 1, lh, css(ink, 0.85), 2920 + i * 13 + q); } }
    else if (kind === 3) { ctx.save(); ctx.translate(x, y + bw); ctx.rotate(-Math.PI / 2); greeked(ctx, 0, 0, bw, 3, lh, css(ink, 0.85), 2930 + i * 13); ctx.restore(); }
    else if (kind === 4) { ctx.fillStyle = css(ink); ctx.fillRect(x, y, bw * 0.7, lh * 4.4); greeked(ctx, x + lh, y + lh, bw * 0.7 - lh * 2, 3, lh, css(cnGround()), 2940 + i * 13); }
    else { ctx.fillStyle = css(ink); ctx.fillRect(x, y + lh * 1.2, bw * 0.5, lh * 0.7); shapeOf(ctx, [[x + bw * 0.5, y + lh * 0.2], [x + bw * 0.62, y + lh * 1.55], [x + bw * 0.5, y + lh * 2.9]]); ctx.fill(); }
  }
  ctx.restore();
}
export const construct = {
  id: "construct",
  art: "machine",
  repaint: (c) => `a constructivist poster made from the photograph, in the manner of the Soviet avant-garde of the 1920s: the subject built of flat rectangles of grey, black and cream, bold diagonal wedges, a large red disc, radiating lines and thin construction lines on aged cream paper, ${c} as the one colour; still the same subject, no text.`,
  about: { zh: "构成主义：二十年代苏联先锋派海报，经今天的插画师重新演绎——微微泛黄的米色旧纸上，频道图形被拆成一块块灰、黑、纸白和一点红的矩形，像机械一样重新拼装起来，顶上竖着桅杆；巨大的斜切楔形、一轮大圆、从灭点放射出去的光线、透视的钢桁架、竖条和色块、细细的构造线和点阵、当作版面装饰的小字；下方可以倒映在平静的水面里。平涂、硬边、只有黑白灰和一种颜色（默认红色，可以换成频道色）。有力量、有秩序、工业感强——适合科技、工业、建筑、历史、军事、城市、设计与观点类内容。照片会被压成几级灰阶。可选米色纸或黑底；自带平直的版式。", en: "Constructivist: the Soviet avant-garde poster of the 1920s as illustrators take it up today — on cream paper gone a little brown, the channel graphic broken into rectangles of grey, black, bare paper and a little red and built again like a machine, masts rising from its top; great diagonal wedges, a disc, rays fanning from a vanishing point, a steel truss in perspective, bars and blocks, hairline construction lines and dot grids, small type set as furniture; the lower part can be doubled in still water. Flat and hard-edged, in black, white, greys and one colour (red, or turned to the channel colour). Strong, ordered, industrial — for technology, industry, architecture, history, the military, cities, design and opinion. A photo is pressed into a few greys. Cream paper or black; flat layouts of its own." },
  name: { zh: "构成主义", en: "Constructivist" },
  seeded: true,
  scene: { machine: { zh: "机械体", en: "Machine" }, circle: { zh: "大圆", en: "Disc" }, rays: { zh: "放射灭点", en: "Centre of the rays" }, truss: { zh: "钢桁架", en: "Steel truss" } },
  params: [
    { key: "machine", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "机械体", en: "Machine" } },
    { key: "fragment", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "块面碎度", en: "Finer blocks" } },
    { key: "wedges", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "斜切楔形", en: "Diagonal wedges" } },
    { key: "circle", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "大圆", en: "Disc" } },
    { key: "rays", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "放射线", en: "Rays" } },
    { key: "truss", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "钢桁架", en: "Steel truss" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "竖条色块", en: "Bars and blocks" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "构造线", en: "Construction lines" } },
    { key: "marks", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "版面小字", en: "Small type" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "水面倒影", en: "Water" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "旧纸", en: "Old paper" } },
    { key: "chan", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "红色换成频道色", en: "Channel colour for the red" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片灰阶", en: "Photo in greys" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(cnGround()), text: css(cnInk()), dim: css(cnInk(), 0.6), titleFill: css(cnInk()), titleInk: css(cnGround()), grid: () => css(cnInk(), 0.12) }),
  /**
   * The paper; rays from the vanishing point; the wedges; the disc; the trusses; the machine; the bars; the
   * water mirroring all that; the construction lines and the small type over it. A photo is pressed into
   * greys, and when it fills the canvas the wedges and the disc are printed over it, multiplied.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), red = cnRed(C, p), flip = rand(3000) > 0.5;
    const disc = (x) => {
      if (p.circle <= 0) return;
      const R = u * (0.08 + 0.26 * p.circle), [dx, dy] = objAt("circle", F.x0 + fw * 0.78, F.y0 + fh * 0.3, x), sd = -1, r2 = R * 0.42 * clamp((p.circle - 0.35) / 0.65), ring = clamp((p.circle - 0.55) / 0.45);   // a scene object
      x.fillStyle = css(red); x.beginPath(); x.arc(dx, dy, R, 0, TAU); x.fill();
      if (r2 > 0) { x.fillStyle = css(cnInk()); x.beginPath(); x.arc(dx + sd * R * 0.85, dy + R * 0.75, r2, 0, TAU); x.fill(); }
      if (ring > 0) { const a0 = rand(3001) * TAU; x.strokeStyle = css(cnInk(), 0.8); x.lineWidth = 1.5; x.beginPath(); x.arc(dx, dy, R * 1.16, a0, a0 + TAU * 0.7 * ring); x.stroke(); }
    };
    if (env.photo) {
      env.drawPhoto(0, p.mono > 0 ? { key: `cnGreys|${p.mono}`, fn: (d) => lutPixels(d, toneTable(CN_TONES, 0.75), p.mono) } : null);   // the photo itself pressed into greys
      if (L.fill) { ctx.save(); ctx.globalCompositeOperation = "multiply"; cnWedges(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.wedges * 6, red, flip); disc(ctx); ctx.restore(); }
      return true;
    }
    if (L.ground !== false) { ctx.fillStyle = css(cnGround()); ctx.fillRect(0, 0, w, h); }
    if (!L.grid) return true;
    let [vx, vy] = [F.x0 + fw * (flip ? 0.38 : 0.62), F.y0 + fh * 0.48];
    if (p.rays > 0) { [vx, vy] = objAt("rays", vx, vy, ctx); cnRays(ctx, F, vx, vy, p.rays * 18, red, 3010); }   // a scene object
    if (p.wedges > 0) cnWedges(ctx, F, p.wedges * 6, red, flip);
    disc(ctx);
    if (p.truss > 0) {   // a scene object: a far truss (once the slider is past half way) and a near one, each reaching further as it rises
      const xn = F.x1 + fw * 0.05, sd = -1, y = F.y0 + fh * 0.2, back = clamp((p.truss - 0.4) / 0.6);
      ctx.save(); shift("truss", xn + sd * fw * 0.1, y, ctx);
      if (back > 0) cnTruss(ctx, xn, xn + sd * fw * (0.15 + 0.6 * back), y - fh * 0.08, fh * 0.1, fh * 0.04, CN.greys[0], CN.light);
      cnTruss(ctx, xn, xn + sd * fw * (0.2 + 0.75 * p.truss), y, fh * 0.2, fh * 0.07, CN.greys[2], CN.greys[0]);
      ctx.restore();
    }
    if (p.machine > 0) {   // a scene object
      const size = Math.min(fh, fw * 0.9) * (0.35 + 0.6 * p.machine), [cx, cy] = objAt("machine", F.x0 + fw * 0.66, F.y1 - size * 0.5, ctx), cell = size * (0.07 - 0.055 * p.fragment);
      const x0 = cx - size, y0 = cy - size * 0.62, cols = Math.ceil((size * 2) / cell), rows = Math.ceil((size * 1.24) / cell), S = canPaint(ctx) && graphicShape(env);
      let cov = null;
      if (S) { const c = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell); cov = (i, j) => c[j * cols + i]; }
      else if (canPaint(ctx)) cov = cnShip(cols, rows);
      if (cov) { ctx.save(); ctx.globalAlpha = Math.min(1, p.machine * 5); cnMachine(ctx, x0, y0, cols, rows, cell, cov, red, 3020); ctx.restore(); }
    }
    const avoid = keepClear(ctx, env);
    if (p.bars > 0) cnBars(ctx, F, p.bars * 14, red, avoid, 3040);
    if (p.water > 0) {
      const wl = F.y1 - fh * 0.32 * p.water;
      reflectBelow(ctx, 0, w, wl, F.y1 + 2, cnGround(), 0.35, 0.6, 3050);
      ctx.save(); ctx.fillStyle = css(cnInk(), 0.35);   // ripples: level hairlines, closer toward the line
      for (let i = 0, n = Math.round(6 + 30 * p.water); i < n; i++) { const y = wl + (F.y1 - wl) * rand(i * 2.3 + 3051) ** 1.5, x = F.x0 + fw * rand(i * 3.1 + 3052) * 0.8; ctx.fillRect(x, y, fw * (0.05 + rand(i * 4.7 + 3053) * 0.25), 1.2); }
      ctx.fillStyle = css(cnInk(), 0.8); ctx.fillRect(F.x0, wl - 1, fw, 2);
      ctx.restore();
    }
    if (p.lines > 0) cnLines(ctx, F, vx, vy, p.lines * 14, red, avoid, 3060);
    if (p.marks > 0) cnMarks(ctx, F, p.marks * 7, red, avoid, 3070);
    return true;
  },
  /** A constructivist's sheet: a square grid turned on the slant, and a great circle across it. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, -0.21, 120); slantPath(ctx, w, h, -0.21 + Math.PI / 2, 120);
    ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(w * 0.68, h * 0.46, h * 0.4, 0, TAU); ctx.stroke();
    ctx.restore();
  },
  accent: { fill: (C) => css(cnRed(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(CN.ink); ctx.lineWidth = 12; run(0, 0); } },
  /** Upright capitals in ink (paper on black), over a copy of them printed a little off in red (the shadow slider); highlighted words in red, their copy in ink. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), ink = o.fill || cnInk(), red = cnRed(o.C), hi = o.hi || red;
    const [dx, dy] = fall(fs * 0.035 * s, fs * 0.035 * s);
    if (s > 0) pass((a, x) => { ctx.fillStyle = css(a.hi ? cnInk() : red); ctx.fillText(a.t, x + dx, dy); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: CN.ink, light: CN.light, mid: CN.greys[1], dark: CN.greys[3], colour: (c) => (sat(c) > 0.3 ? cnRed(C, p) : grey(c)) }, stroke: { ink: CN.ink, light: CN.light }, line: 0.6 })),
  sticker: painters({ line: CN.ink, lineScale: 0.45, join: "miter", tone: inkAs(CN.ink, (c) => mix(grey(c), c, 0.35)), shadow: null }),
  /** The corner tag: paper capitals on a slab of ink, a bar of red at its head. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 1.45, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(cnInk()); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(cnRed(C)); ctx.fillRect(x, top, f * 0.55, h);
    ctx.fillStyle = ink || css(cnGround()); spaced(ctx, str, x + f * 0.95, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a ruled border, a square of red at its corner. */
  frame(ctx, env) {
    const { w, h } = env, b = 26;
    ctx.save(); ctx.strokeStyle = css(cnInk(), 0.85); ctx.lineWidth = 2.5; ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    ctx.fillStyle = css(cnRed(env.C)); ctx.fillRect(b - 7, b - 7, 22, 22); ctx.restore();
  },
  image(ctx) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) {
    const a = p.paper;
    if (a <= 0) return;
    crumple(ctx, w, h, a * 0.45);
    wear(ctx, w, h, dark ? [70, 62, 52] : [128, 98, 62], 0.4 * a, dark ? "lighten" : "multiply");
    grain(ctx, a * 0.55, unit, !dark);
    ctx.save(); ctx.globalCompositeOperation = "multiply"; vignette(ctx, w, h, dark ? [0, 0, 0] : [176, 140, 92], 0.45 * a, 0.5); ctx.restore();
  },
  prompt: `Emblems for a constructivist poster of the 1920s — bold, geometric, industrial — that read at a glance:
- one clear object per sticker (a gear, a factory chimney, a ship, a megaphone, a tractor, a radio tower, a train, a hammer, a star), built from flat rectangles, triangles and circles; no realism, no fine detail;
- flat colour only: "ink" (black), greys and "white" (cream paper), with the main colour as the one strong accent;
- the app adds a thin ink line and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Industrial things as a constructivist would build them, from a few boxes and cylinders — a radio tower, a factory, a ship's bridge, a crane, a locomotive; no realism, no fine detail.
- the renderer paints faces in greys, black and cream with a thin ink line: do NOT try to draw shading or outlines yourself;
- "white" is cream paper, "dark" near-black, and "main" the poster's one colour (red, or the channel colour) — use it for one to three parts.`,
};
construct.elementFx = [
  { key: "blocks", name: { zh: "块面构成", en: "Built of blocks" }, for: FX_ALL, stage: "fill", sub: [{ key: "size", name: { zh: "块面大小", en: "Block size" }, def: 0.2 }],
    /** The layer built again of rectangles: read in cells, joined into blocks of one tone each — greys by its own lightness, red where it was strongly coloured — and a hairline round some. */
    paint(x, B, a, E, o) {
      const cs = Math.max(3, (5 + 22 * o.size) * E.k), [d, cols, rows] = cellsOf(x, B, cs), red = cnRed(E.C), tones = [CN.ink, CN.greys[3], CN.greys[2], CN.greys[1], CN.greys[0], CN.light];
      const tone = (i, j) => { const q = (j * cols + i) * 4; return sat([d[q], d[q + 1], d[q + 2]]) > 0.35 && lumOf(d, q) > 0.2 ? 6 : Math.min(5, Math.floor(lumOf(d, q) * 6)); };
      const blocks = joinCells(cols, rows, (i, j) => d[(j * cols + i) * 4 + 3] > 100, (i, j, p, q) => tone(i, j) === tone(p, q), 3, 4, E.seed % 97);
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a;
      for (const [i, j, bw, bh] of blocks) { const t = tone(i, j); x.fillStyle = css(t === 6 ? red : tones[t]); x.fillRect(B.x0 + i * cs, B.y0 + j * cs, bw * cs + 0.6, bh * cs + 0.6); }
      x.strokeStyle = css(CN.ink, 0.5); x.lineWidth = Math.max(0.8, E.k * 0.8); x.beginPath();
      for (const [i, j, bw, bh] of blocks) if (E.R(i * 1.7 + j * 2.9 + 3) < 0.25) x.rect(B.x0 + i * cs, B.y0 + j * cs, bw * cs, bh * cs);
      x.stroke(); x.restore();
    } },
  { key: "greys", name: { zh: "灰阶分版", en: "Grey plates" }, for: FX_ALL, stage: "filter",
    /** The layer pressed into a few flat greys between ink and cream paper. */
    paint: tonesFx(() => CN_TONES, 0.75) },
  { key: "wedge", name: { zh: "斜切色块", en: "Diagonal wedge" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.6, r: B.w * 0.6, t: B.h * 0.6, b: B.h * 0.6 }),
    /** A band of the poster red cut on a diagonal behind the layer, a bar of ink along its edge. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, len = Math.hypot(B.w, B.h) * (0.55 + 0.5 * a), th = Math.min(B.w, B.h) * (0.2 + 0.45 * a), ang = -0.6 + (E.R(7) - 0.5) * 0.3, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const band = (o, t) => [[cx - ux * len + nx * o, cy - uy * len + ny * o], [cx + ux * len + nx * o, cy + uy * len + ny * o], [cx + ux * len + nx * (o + t), cy + uy * len + ny * (o + t)], [cx - ux * len + nx * (o + t), cy - uy * len + ny * (o + t)]];
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2);
      x.fillStyle = css(cnRed(E.C)); shapeOf(x, band(-th / 2, th)); x.fill();
      x.fillStyle = css(CN.ink); shapeOf(x, band(th / 2, th * 0.14)); x.fill();
      x.restore();
    } },
];
