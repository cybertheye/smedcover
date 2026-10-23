// skies: the painted skies of anime films
// The clear skies and streets of today's anime films: deep cobalt down to a pale horizon, towering
// cumulus lit snow-white, fleecy altocumulus in rows, a contrail; a utility pole and its wires, crowded
// rooftops, the sea; sun, haze and leaves. By day, or at dusk with the windows and signs lit.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_PHOTO, TAU, WORK, avGlow, boost, canPaint, clamp, css, dark, eachPixel, fast, godRays, grain, gridPen, inPixels, inkAs, keptLayer, lensFlare, lum, mapped, mix, objAt, openField, painters, rand, raysAt, rounded, sceneOff, seed, shapeOf, shift, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

/** The offsets as a string, for the caches of what scene objects are painted into. */
const sceneKey = () => JSON.stringify(sceneOff);
const SK = { ink: [18, 28, 54], white: [255, 255, 255], wire: [24, 28, 42] };
const skSky = () => (dark ? [[18, 22, 64], [92, 66, 146], [252, 172, 128]] : [[20, 72, 180], [58, 142, 228], [182, 220, 244]]);
const skLit = () => (dark ? [255, 212, 186] : [255, 255, 255]), skShade = () => (dark ? [134, 104, 164] : [170, 188, 222]), skDeep = () => (dark ? [72, 56, 112] : [110, 130, 182]);
/**
 * A towering cumulus as the painted skies of anime films show it: rows of lobes narrowing upward over a
 * flat base. The body in shade; every lobe painted again moved toward the sun, soft at its edge, so the
 * lit masses merge and the hollows stay in shade; the higher the lobe, the brighter; the base sunk in a
 * deeper blue. (x, base): the middle of its base; s: its half-width; tall: its height in half-widths.
 */
function cumulus(ctx, x, base, s, tall, k) {
  const lobes = [], rows = Math.max(3, Math.round(3 + tall * 2.2)), lit = skLit(), shade = skShade(), deep = skDeep();
  for (let j = 0; j < rows; j++) {
    const t = j / (rows - 1), half = s * (1 - 0.6 * t) * (0.85 + rand(k + j * 1.9) * 0.3), cy = base - tall * s * (0.1 + 0.8 * t), n = Math.max(3, Math.round(3 + 5 * (1 - t))), r0 = s * (0.2 + 0.1 * (1 - t));
    for (let i = 0; i < n; i++) { const v = (i / (n - 1)) * 2 - 1; lobes.push([x + v * half * 0.82 + (rand(k + j * 7.3 + i * 2.1) - 0.5) * s * 0.2, cy + (rand(k + j * 3.1 + i * 5.7) - 0.5) * s * 0.24, r0 * (0.75 + rand(k + j * 4.3 + i) * 0.5)]); }
  }
  const big = lobes.length;
  for (let i = 0; i < 56; i++) { const [cx, cy, r] = lobes[Math.floor(rand(k + i * 9.7 + 50) * big)], a = -Math.PI * (0.05 + rand(k + i * 2.9 + 51) * 0.9); lobes.push([cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78, r * (0.22 + rand(k + i * 4.1 + 52) * 0.22)]); }   // small bumps along the top and sides
  const top = base - tall * s, bx0 = x - 1.8 * s, bx1 = x + 1.8 * s, by0 = base - tall * s * 1.35;   // the box the cloud stays in
  ctx.save(); ctx.beginPath(); ctx.rect(x - 4 * s, base - 8 * s, 8 * s, 8 * s); ctx.clip();   // the flat base
  ctx.beginPath(); for (const [cx, cy, r] of lobes) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
  ctx.fillStyle = css(shade); ctx.fill(); ctx.clip();   // the body in shade, its outline crisp
  // The light and shade inside the body are soft all through, so they are painted at a third of the size
  // and laid on enlarged within the crisp outline: a ninth of the pixels to fill.
  const small = canPaint(ctx) && (WORK.skCloud || (WORK.skCloud = document.createElement("canvas"))), m = small && ctx.getTransform();
  let b = ctx;
  if (small) {
    const sw = Math.ceil(ctx.canvas.width / 3), sh = Math.ceil(ctx.canvas.height / 3);
    if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
    b = small.getContext("2d"); b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, sw, sh); b.setTransform(m.a / 3, m.b / 3, m.c / 3, m.d / 3, m.e / 3, m.f / 3);
  }
  const g = b.createLinearGradient(0, base - tall * s * 0.45, 0, base); g.addColorStop(0, css(deep, 0)); g.addColorStop(1, css(deep, 0.9)); b.fillStyle = g; b.fillRect(bx0, by0, bx1 - bx0, base - by0);   // the base sunk in deeper blue
  b.fillStyle = css(lit, 0.85); b.beginPath();   // the small bumps along the edge, lit all together
  for (let i = big; i < lobes.length; i++) { const [cx, cy, r] = lobes[i], lr = r * 0.78; b.moveTo(cx - r * 0.2 + lr, cy - r * 0.28); b.arc(cx - r * 0.2, cy - r * 0.28, lr, 0, TAU); }
  b.fill();
  for (const [cx, cy, r] of lobes.slice(0, big)) {   // the big lobes, each in a soft light of its own
    const hf = clamp((base - cy) / Math.max(1, base - top)), lx = cx - r * 0.22, ly = cy - r * 0.32, gg = b.createRadialGradient(lx - r * 0.15, ly - r * 0.2, r * 0.05, lx, ly, r * 0.92), la = 0.55 + 0.45 * hf;
    gg.addColorStop(0, css(lit, la)); gg.addColorStop(0.8, css(lit, la * 0.82)); gg.addColorStop(1, css(lit, 0));   // broad and flat: the lit lobes run together into masses
    b.fillStyle = gg; b.beginPath(); b.arc(lx, ly, r * 0.92, 0, TAU); b.fill();
  }
  const dg = b.createLinearGradient(x - s * 0.6, top, x + s, base); dg.addColorStop(0.4, css(deep, 0)); dg.addColorStop(1, css(deep, 0.5));   // the side away from the sun in shade
  b.fillStyle = dg; b.fillRect(bx0, by0, bx1 - bx0, base - by0);
  if (small) {
    const X0 = Math.max(0, Math.floor((m.e + bx0 * m.a) / 3)), Y0 = Math.max(0, Math.floor((m.f + by0 * m.d) / 3)), X1 = Math.min(small.width, Math.ceil((m.e + bx1 * m.a) / 3)), Y1 = Math.min(small.height, Math.ceil((m.f + base * m.d) / 3));
    if (X1 > X0 && Y1 > Y0) inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(small, X0, Y0, X1 - X0, Y1 - Y0, X0 * 3, Y0 * 3, (X1 - X0) * 3, (Y1 - Y0) * 3); });
  }
  ctx.restore();
}
/**
 * Fleecy altocumulus across the upper sky: rows of little clusters of puffs, each lit from above over a
 * soft shaded underside, smaller and closer together toward the horizon, the rows broken into diagonal
 * drifts; more rows and fuller drifts as `amt` rises.
 */
function fleece(ctx, F, horizon, amt, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, horizon - F.y0), lit = skLit(), shade = skShade(), rows = Math.round(3 + 15 * amt), s0 = Math.min(fw, span) * 0.045, under = [], over = [];
  for (let j = 0; j < rows; j++) {
    const t = j / 18, y = F.y0 + span * 0.7 * (1 - (1 - t) * (1 - t)), s = s0 * (1 - 0.7 * t), gap = s * 2.4;
    for (let x = F.x0 - s + rand(j * 3.3 + k0) * gap, i = 0; x < F.x1 + s; x += gap * (0.6 + rand(j * 7.1 + i * 1.3 + k0) * 0.9), i++) {
      const drift = 0.5 + 0.5 * Math.sin((x + y * 1.8) * 0.0035 + seed) * Math.cos(x * 0.0017 - j * 0.45 + seed * 0.3);
      if (drift < 1 - amt * 1.05) continue;
      const big = s * (0.5 + rand(j * 5.3 + i * 2.9 + k0) * 0.8) * (0.6 + 0.5 * drift), yy = y + (rand(j * 2.2 + i * 4.4 + k0) - 0.5) * s * 0.8;
      for (let q = 0, m = 2 + Math.floor(rand(j * 6.1 + i * 3.7 + k0) * 3); q < m; q++) {   // two to four puffs, the middle ones higher
        const px = x + (q - (m - 1) / 2) * big * 0.7 + (rand(i * 9.1 + q + k0) - 0.5) * big * 0.3, py = yy - Math.sin((q / Math.max(1, m - 1)) * Math.PI) * big * 0.18, r = big * (0.45 + rand(i * 8.3 + q * 1.9 + k0) * 0.3);
        under.push(px, py + r * 0.18, r, r * 0.55); over.push(px - r * 0.06, py - r * 0.1, r * 0.82, r * 0.42);
      }
    }
  }
  // one path each, so overlapping puffs do not darken; painted at a third of the size and laid on enlarged, which softens their edges as a blur would, for far less
  const small = canPaint(ctx) && (WORK.skFleece || (WORK.skFleece = document.createElement("canvas"))), m = small && ctx.getTransform(), W = small && ctx.canvas.width, H = small && ctx.canvas.height;
  let x = ctx;
  if (small) {
    const sw = Math.ceil(W / 3), sh = Math.ceil(H / 3);
    if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
    x = small.getContext("2d"); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sw, sh); x.setTransform(m.a / 3, m.b / 3, m.c / 3, m.d / 3, m.e / 3, m.f / 3);
  }
  for (const [e, style] of [[under, css(shade, 0.8)], [over, css(lit, 0.95)]]) { x.beginPath(); for (let i = 0; i < e.length; i += 4) { x.moveTo(e[i] + e[i + 2], e[i + 1]); x.ellipse(e[i], e[i + 1], e[i + 2], e[i + 3], 0, 0, TAU); } x.fillStyle = style; x.fill(); }
  if (small) inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(small, 0, 0, W, H); });
}
/**
 * The town in two rows of buildings, the far one hazier: flat faces with a shaded side, rows of windows
 * (lit warm at dusk), and on the roofs water tanks, air conditioners and aerials; signboards on the near
 * row with `signs`, glowing at dusk. Its top is at `top`; its feet below the field.
 */
function skTown(ctx, F, top, signs, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), base = F.y1 + 8, low = skSky()[2];
  const DAY = [[238, 230, 214], [216, 208, 198], [192, 216, 214], [228, 202, 180], [204, 210, 220], [182, 104, 88], [150, 170, 186]], DUSK = [[46, 50, 84], [58, 58, 94], [38, 46, 76], [66, 56, 86], [52, 44, 72]];
  const SIGN = [[226, 48, 52], [36, 92, 196], [250, 196, 40], [30, 150, 100], [240, 240, 236]];
  ctx.save(); ctx.lineCap = "butt";
  for (const far of [true, false]) {
    const rowTop = far ? top : top + (base - top) * 0.32, haze = far ? 0.38 : 0;
    for (let x = F.x0 - 12, i = 0; x < F.x1 + 12; i++) {
      const kk = k0 + (far ? 0 : 500) + i * 7.3, bw = u * (far ? 0.045 + rand(kk) * 0.05 : 0.07 + rand(kk) * 0.08), bh = (base - rowTop) * (0.5 + rand(kk + 1) * 0.5), y0 = base - bh;
      const col = mix((dark ? DUSK : DAY)[Math.floor(rand(kk + 2) * (dark ? DUSK : DAY).length)], dark ? [40, 40, 80] : low, haze);
      const fg = ctx.createLinearGradient(0, y0, 0, base); fg.addColorStop(0, css(mix(col, dark ? [130, 110, 170] : [255, 250, 240], 0.25))); fg.addColorStop(1, css(mix(col, dark ? [10, 10, 30] : [90, 100, 130], 0.3)));   // sunlit at the top, in the street's shade below
      ctx.fillStyle = fg; ctx.fillRect(x, y0, bw, bh);
      ctx.fillStyle = css(mix(col, dark ? [10, 10, 30] : [60, 70, 100], 0.25)); ctx.fillRect(x + bw * 0.78, y0, bw * 0.22, bh);
      ctx.fillStyle = css(mix(col, [0, 0, 0], 0.35)); ctx.fillRect(x - 2, y0 - 3, bw + 4, 4);
      const ws = bw * 0.12, wins = new Map();
      for (let r = 0, y = y0 + bw * 0.16; y < base - ws; r++, y += ws * 2.1) for (let q = 0; q < 3; q++) {
        const on = dark && rand(kk * 3 + r * 1.7 + q) > 0.5, c = on ? [255, 214, 140] : dark ? [24, 26, 52] : mix(col, [70, 92, 124], 0.5), key = c.join();
        (wins.get(key) || wins.set(key, []).get(key)).push(x + bw * (0.1 + q * 0.23), y);
      }
      for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 2) ctx.rect(list[q], list[q + 1], ws * 1.3, ws * 1.2); ctx.fill(); }
      if (!far && rand(kk + 11) > 0.5) { ctx.fillStyle = css(mix(col, [255, 255, 255], dark ? 0.12 : 0.45)); for (let y = y0 + bw * 0.16 + ws * 1.4; y < base; y += ws * 4.2) ctx.fillRect(x + bw * 0.04, y, bw * 0.72, Math.max(1.5, ws * 0.3)); }   // balcony rails
      const kind = rand(kk + 3), rc = css(mix(col, [0, 0, 0], 0.45));   // something on the roof
      ctx.fillStyle = rc; ctx.strokeStyle = rc; ctx.lineWidth = 2;
      if (kind < 0.3) { const tw = bw * 0.3, tx = x + bw * 0.2; ctx.fillRect(tx, y0 - tw * 1.1, tw, tw * 0.8); ctx.beginPath(); ctx.ellipse(tx + tw / 2, y0 - tw * 1.1, tw / 2, tw * 0.15, 0, 0, TAU); ctx.fill(); ctx.fillRect(tx + tw * 0.1, y0 - tw * 0.3, 2, tw * 0.3); ctx.fillRect(tx + tw * 0.85, y0 - tw * 0.3, 2, tw * 0.3); }
      else if (kind < 0.55) { for (let q = 0; q < 2; q++) ctx.fillRect(x + bw * (0.15 + q * 0.4), y0 - bw * 0.14, bw * 0.28, bw * 0.14); }
      else if (kind < 0.8) { const ax = x + bw * (0.3 + rand(kk + 4) * 0.4), ah = bw * (0.5 + rand(kk + 5) * 0.6); ctx.beginPath(); ctx.moveTo(ax, y0); ctx.lineTo(ax, y0 - ah); for (let q = 1; q <= 3; q++) { ctx.moveTo(ax - bw * 0.12 * q * 0.5, y0 - ah * (0.55 + q * 0.12)); ctx.lineTo(ax + bw * 0.12 * q * 0.5, y0 - ah * (0.55 + q * 0.12)); } ctx.stroke(); }
      else { ctx.fillStyle = css(dark ? [34, 34, 60] : [86, 98, 128]); shapeOf(ctx, [[x - bw * 0.06, y0 + 2], [x + bw * 0.5, y0 - bw * 0.32], [x + bw * 1.06, y0 + 2]]); ctx.fill(); }   // a tiled pitched roof
      if (!far && signs > 0 && rand(kk + 6) < signs * 0.9) {   // a signboard down the face
        const sw = bw * 0.22, sh = Math.min(bh * 0.7, sw * (3 + rand(kk + 7) * 2)), sx = x + (rand(kk + 8) > 0.5 ? bw * 0.05 : bw * 0.7), sy = y0 + bh * 0.08, c = SIGN[Math.floor(rand(kk + 9) * SIGN.length)];
        ctx.save(); if (dark && !fast) { ctx.shadowColor = css(c, 0.9); ctx.shadowBlur = 16; }
        ctx.fillStyle = css(dark ? mix(c, [255, 255, 255], 0.15) : c); ctx.fillRect(sx, sy, sw, sh); ctx.restore();
        ctx.fillStyle = css(lum(c) > 0.7 ? [200, 40, 40] : [255, 255, 255], 0.9); for (let q = 0; q < 3; q++) ctx.fillRect(sx + sw * 0.25, sy + sh * (0.1 + q * 0.3), sw * 0.5, sh * 0.18);
      }
      x += bw * (0.88 + rand(kk + 10) * 0.2);
    }
  }
  ctx.restore();
}
/** A utility pole standing up out of the town at x, its crossarms and insulators, a transformer; `n` wires (the last coming in by degrees) sagging away across the sky to the far edge. */
function utilityPole(ctx, F, x, n, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, s = Math.min(fw, fh) * 0.011, base = F.y1 + 10, top = F.y0 + fh * 0.06, col = css(dark ? [14, 14, 32] : SK.wire);
  const a = Math.min(1, (n - 1) / 5.5);   // the pole and its first wires come in over the first half of the slider
  ctx.save(); ctx.fillStyle = col; ctx.strokeStyle = col; ctx.globalAlpha = a;
  shapeOf(ctx, [[x - s * 0.7, base], [x - s * 0.45, top], [x + s * 0.45, top], [x + s * 0.7, base]]); ctx.fill();
  const arms = [top + s * 3, top + s * 8, top + s * 13], ends = [];
  arms.forEach((y, a) => {
    const half = s * (7 - a * 1.2); ctx.fillRect(x - half, y, half * 2, s * 0.7);
    for (let i = 0; i < 4; i++) { const ix = x - half + s * 0.6 + (i * (half * 2 - s * 1.2)) / 3; ctx.fillRect(ix - s * 0.25, y - s * 1.1, s * 0.5, s * 1.1); ends.push([ix, y - s * 1.1]); }
  });
  ctx.beginPath(); rounded(ctx, x + s * 0.9, top + s * 16, s * 2.6, s * 4.2, s * 0.5); ctx.fill();
  for (let i = 0; i < 5; i++) ctx.fillRect(x - s * 0.9, top + s * (20 + i * 3.4), s * 1.8, s * 0.35);   // the steps
  ctx.lineCap = "round";
  for (let k = 0; k < Math.ceil(n) && k < ends.length; k++) {
    const [ix, iy] = ends[k], to = F.x0 - fw * 0.05, ty = iy + fh * (rand(k * 2.7 + k0) - 0.3) * 0.3, sag = fh * (0.05 + rand(k * 3.9 + k0) * 0.1);
    ctx.globalAlpha = clamp(n - k) * a; ctx.lineWidth = 1.3 + rand(k + k0) * 1.4;
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.quadraticCurveTo((ix + to) / 2, (iy + ty) / 2 + sag * 2, to, ty); ctx.stroke();
    if (k % 3 === 0) { ctx.beginPath(); ctx.moveTo(ix, iy); ctx.quadraticCurveTo(ix + fw * 0.06, iy + sag * 0.5, F.x1 + 10, iy + fh * 0.05); ctx.stroke(); }   // and a short run out the near side
  }
  ctx.restore();
}
/** A cluster of leaves spilling in from (x, y): dark ones underneath, sunlit ones on top toward the light; more of them and further in as `amt` rises. */
function foliage(ctx, x, y, R, amt, dirX, dirY, k0) {
  const n = Math.round(60 + 200 * amt), tones = dark ? [[10, 22, 26], [20, 40, 40], [44, 70, 56]] : [[26, 62, 40], [62, 122, 56], [168, 208, 92]];
  ctx.save();
  for (let pass = 0; pass < 3; pass++) {
    ctx.fillStyle = css(tones[pass]); ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (Math.floor(rand(i * 1.9 + k0) * 3) !== pass) continue;
      const a = rand(i * 2.7 + k0 + 1) * Math.PI * 0.5, d = R * Math.sqrt(rand(i * 3.3 + k0 + 2)), lx = x + dirX * Math.cos(a) * d, ly = y + dirY * Math.sin(a) * d, r = R * (0.03 + rand(i * 4.1 + k0 + 3) * 0.03), t = rand(i * 5.3 + k0 + 4) * Math.PI;
      ctx.moveTo(lx + Math.cos(t) * r, ly + Math.sin(t) * r); ctx.ellipse(lx, ly, r, r * 0.45, t, 0, TAU);
    }
    ctx.fill();
  }
  ctx.restore();
}
export const skies = {
  id: "skies",
  repaint: (c) => `a background painting from a contemporary anime film made from the photograph: a deep cobalt sky with towering sunlit cumulus and fleecy altocumulus, crisp detailed rooftops and power lines, saturated clean colour, soft haze and a little lens flare, with ${c} as an accent; still the same place, no text.`,
  about: { zh: "动画晴空：当代动画电影里那种通透的天空和街景——深钴蓝渐变到地平线的淡青，高高堆起、受光面雪白的积雨云，一排排絮状的高积云，飞机拉出的长长尾迹；前景是电线杆和交错的电线，楼顶挤满水箱、空调外机和天线的街区，招牌灯箱，远处一片海；阳光与光斑、空气感、前景枝叶。浅色是盛夏白天，深色是黄昏到入夜，窗户和灯箱亮起来。明亮、清澈、怀念——适合旅行、城市、日常、青春、音乐和治愈系内容。照片会被调得更通透鲜艳。自带平直的版式。", en: "Anime skies: the clear skies and streets of today's anime films — deep cobalt down to a pale horizon, towering cumulus with snow-white sunlit tops, rows of fleecy altocumulus, a plane's long contrail; in front, a utility pole and its crossing wires, rooftops crowded with water tanks, air conditioners and aerials, lit signs, the sea in the distance; sun and flare, haze, leaves. The light theme is a summer day, the dark one dusk into night with the windows and signs lit. Bright, clear, nostalgic — for travel, cities, everyday life, youth, music and feel-good content. A photo is made clearer and more vivid. Flat layouts of its own." },
  name: { zh: "动画晴空", en: "Anime skies" },
  seeded: true,
  scene: { sun: { zh: "阳光", en: "Sunlight" }, cumulus: { zh: "积雨云", en: "Cumulonimbus" }, contrail: { zh: "飞机云", en: "Contrails" }, pole: { zh: "电线杆", en: "Pole and wires" }, leaves: { zh: "前景枝叶", en: "Leaves" } },
  params: [
    { key: "cumulus", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "积雨云", en: "Cumulus" } },
    { key: "fleece", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "絮状云", en: "Fleecy clouds" } },
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "阳光", en: "Sunlight" } },
    { key: "contrail", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "飞机云", en: "Contrails" } },
    { key: "wires", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "电线杆", en: "Pole and wires" } },
    { key: "town", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "街区", en: "Town" } },
    { key: "signs", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "招牌灯箱", en: "Signs" } },
    { key: "sea", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "海面", en: "Sea" } },
    { key: "leaves", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "前景枝叶", en: "Leaves" } },
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "空气感", en: "Haze" } },
    { key: "vivid", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片通透", en: "Photo clarity" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(skSky()[1]), text: css(SK.white), dim: css(SK.white, 0.75), titleFill: css(SK.white), titleInk: css(SK.ink), grid: () => css(SK.white, 0.18) }),
  /**
   * The ground is the sky down to the horizon (above the town, or above the sea when there is one); over
   * it, or over the base's grid or nothing, each by its slider, from the back: the sun's rays, fleecy clouds,
   * contrails, the great cumulus standing on the horizon, haze along it, the sea, the town, the pole and its
   * wires, leaves. A photo is made clearer and more vivid; filling
   * the canvas, it gets the sun and the haze too.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, sky = skSky();
    const townTop = F.y1 - fh * 0.36 * p.town, horizon = townTop + fh * (0.03 - 0.16 * p.sea);
    const haze = (x, a) => { if (a <= 0) return; const g = x.createLinearGradient(0, horizon - fh * 0.35, 0, horizon + 4); g.addColorStop(0, css(sky[2], 0)); g.addColorStop(1, css(mix(sky[2], [255, 255, 255], 0.4), 0.75 * a)); x.fillStyle = g; x.fillRect(0, horizon - fh * 0.35, w, fh * 0.35 + 4); };
    if (env.photo) {
      env.drawPhoto();
      if (p.vivid > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.5 * p.vivid; env.drawPhoto();
        ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.3 * p.vivid; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, w, h);
        const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(dark ? [70, 50, 170] : [20, 110, 255], 0.6)); g.addColorStop(0.55, "rgba(128,128,128,0)"); g.addColorStop(1, css(dark ? [255, 150, 90] : [255, 200, 130], 0.5));
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.vivid; ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (L.fill) { godRays(ctx, w, h, p.sun * 0.6, dark ? 1 : 0); if (p.sun > 0) lensFlare(ctx, w, h, p.sun * 0.5); }
      return true;
    }
    // the sky and all that is in it, painted once and kept until one of its sliders changes (see keptLayer):
    // the sea, the town, the pole and the leaves in front of it are cheap to paint over it again. The scene
    // objects in it (the sun, the cumulus, the contrails) are placed here, on ctx, as a kept sky would not
    // place them again; what is in the kept sky is moved by the difference
    const moveOf = (key, x0, y0, on) => { if (!on || !L.grid) return [0, 0]; const [x1, y1] = objAt(key, x0, y0, ctx); return [x1 - x0, y1 - y0]; };
    const sunMove = moveOf("sun", ...raysAt(w, h), p.sun > 0), roomC = Math.max(u * 0.1, horizon - F.y0 - fh * 0.08);
    const cuMove = moveOf("cumulus", F.x0 + fw * 0.6, horizon - roomC * 0.45, p.cumulus > 0), coMove = moveOf("contrail", F.x0 + fw * 0.45, F.y0 + fh * 0.22, p.contrail > 0);
    const rays = (x, amt) => {   // the sun's rays: soft beams, so painted at a quarter of the size and laid on enlarged
      if (amt <= 0) return;
      if (!canPaint(x)) { godRays(x, w, h, amt, dark ? 1 : 0, null, sunMove); return; }
      const small = WORK.skRays || (WORK.skRays = document.createElement("canvas")), m = x.getTransform(), W = x.canvas.width, H = x.canvas.height, sw = Math.ceil(W / 4), sh = Math.ceil(H / 4);
      if (small.width !== sw || small.height !== sh) { small.width = sw; small.height = sh; }
      const r = small.getContext("2d"); r.setTransform(1, 0, 0, 1, 0, 0); r.clearRect(0, 0, sw, sh); r.setTransform(m.a / 4, m.b / 4, m.c / 4, m.d / 4, m.e / 4, m.f / 4);
      godRays(r, w, h, amt, dark ? 1 : 0, null, sunMove);
      inPixels(x, () => { x.globalCompositeOperation = "screen"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.drawImage(small, 0, 0, W, H); });
    };
    if (L.ground !== false) {   // the sky itself, down to the horizon: the ground
      const g = ctx.createLinearGradient(0, F.y0, 0, Math.max(F.y0 + 10, horizon)); g.addColorStop(0, css(sky[0])); g.addColorStop(0.55, css(sky[1])); g.addColorStop(1, css(sky[2]));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    rays(ctx, p.sun * 0.55);   // screened onto what is there: painted each time, as a kept layer on its own could not screen it
    const paintSky = (x) => {
      if (p.fleece > 0) fleece(x, F, horizon, p.fleece, 2500);
      x.save(); x.translate(coMove[0], coMove[1]);
      for (let k = 0, n = p.contrail * 2; k < Math.ceil(n); k++) {   // a plane's trail, fading out behind it
        const y0 = F.y0 + fh * (0.12 + rand(k * 2.3 + 2510) * 0.3), x1 = F.x0 + fw * (0.45 + rand(k * 3.1 + 2511) * 0.45), y1 = y0 - fh * (0.04 + rand(k * 3.7 + 2512) * 0.12), x0 = F.x0 - 20, a = clamp(n - k);
        const tr = x.createLinearGradient(x0, y0, x1, y1); tr.addColorStop(0, css(SK.white, 0)); tr.addColorStop(1, css(SK.white, 0.85 * a));
        x.save(); x.lineCap = "round"; x.strokeStyle = tr;
        x.lineWidth = u * 0.022; x.globalAlpha = 0.35; x.beginPath(); x.moveTo(x0, y0 + 6); x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + fh * 0.02, x1, y1); x.stroke();
        x.lineWidth = u * 0.006; x.globalAlpha = 1; x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + fh * 0.02, x1, y1); x.stroke();
        x.fillStyle = css(SK.white, a); x.beginPath(); x.arc(x1, y1, u * 0.003, 0, TAU); x.fill(); x.restore();
      }
      x.restore();
      const ramp = (v, a, b) => clamp((v - a) / (b - a)), room = Math.max(u * 0.1, horizon - F.y0 - fh * 0.08), c = p.cumulus;
      const mass = (fx, k, size, tall, grow) => { if (grow <= 0) return; const s = Math.min(u * size * (0.15 + 0.85 * grow), room / (tall * 1.05)); if (s > u * 0.02) cumulus(x, F.x0 + fw * fx, horizon, s, tall, k); };
      x.save(); x.translate(cuMove[0], cuMove[1]);
      mass(0.5 + rand(2520) * 0.1, 2521, 0.14, 1.1, ramp(c, 0.55, 0.95));      // far off, small
      mass(0.88 + rand(2522) * 0.08, 2523, 0.16, 1.3, ramp(c, 0.7, 1));
      mass(0.15 + rand(2524) * 0.12, 2525, 0.24, 1.5, ramp(c, 0.3, 0.85));
      mass(0.68 + rand(2526) * 0.1, 2527, 0.32, 1.9, ramp(c, 0, 0.7));        // the great tower, first
      x.restore();
      haze(x, p.haze);
    };
    if (p.fleece > 0 || p.contrail > 0 || p.cumulus > 0 || p.haze > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "skSky", [dark, seed, w, h, F.x0, F.y0, F.x1, F.y1, horizon.toFixed(2), p.fleece, p.contrail, p.cumulus, p.haze, sceneKey()].join("|"), paintSky);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintSky(ctx);
    }
    if (p.sea > 0) {   // the sea from the horizon down behind the town, a sun-glitter path on it
      const sg = ctx.createLinearGradient(0, horizon, 0, F.y1); sg.addColorStop(0, css(dark ? [120, 96, 150] : [92, 158, 214])); sg.addColorStop(1, css(dark ? [34, 30, 76] : [18, 84, 166]));
      ctx.save(); ctx.globalAlpha = Math.min(1, p.sea * 4); ctx.fillStyle = sg; ctx.fillRect(0, horizon, w, F.y1 - horizon + 8);
      ctx.fillStyle = css(dark ? [255, 200, 160] : SK.white, 0.8);
      for (let k = 0, n = Math.round(160 * p.sea); k < n; k++) { const y = horizon + (F.y1 - horizon) * rand(k * 2.1 + 2530) ** 1.6, x = F.x0 + fw * (0.68 + (rand(k * 3.3 + 2531) - 0.5) * (0.12 + 0.5 * (y - horizon) / Math.max(1, F.y1 - horizon))), l = 3 + rand(k * 4.1 + 2532) * 14; ctx.fillRect(x, y, l, 1.6); }
      ctx.restore();
    }
    if (p.town > 0) skTown(ctx, F, townTop, p.signs, 2540);
    if (p.wires > 0) { ctx.save(); shift("pole", F.x0 + fw * 0.9, F.y0 + fh * 0.35, ctx); utilityPole(ctx, F, F.x0 + fw * 0.9, 1 + 11 * p.wires, 2560); ctx.restore(); }   // a scene object
    if (p.leaves > 0) {   // a scene object
      ctx.save(); shift("leaves", F.x1 - u * 0.14, F.y0 + u * 0.12, ctx);
      foliage(ctx, F.x1, F.y0, u * 0.44 * Math.sqrt(0.1 + 0.9 * p.leaves), p.leaves, -1, 1, 2570);   // a branch in from the top corner, its area growing evenly
      ctx.restore();
    }
    avGlow(ctx, p.haze * 0.3);
    return true;
  },
  /** A background painter's perspective guide: the horizon, and lines fanning out from a vanishing point on it. */
  gridLines(ctx, env, color) {
    const { w, h } = env, vx = w * 0.5, vy = h * 0.64, R = Math.hypot(w, h), r0 = 70;
    gridPen(ctx, color); ctx.beginPath();
    ctx.moveTo(0, vy); ctx.lineTo(w, vy);
    for (let a = 0; a < 360; a += 7.5) { const t = (a * Math.PI) / 180; ctx.moveTo(vx + Math.cos(t) * r0, vy + Math.sin(t) * r0); ctx.lineTo(vx + Math.cos(t) * R, vy + Math.sin(t) * R); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(boost(C, 0.4)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(SK.white, 0.9); ctx.lineWidth = 5; run(-nx * 4, -ny * 4); } },
  /** White letters with a soft shadow (by day a deep blue, at dusk a warm glow: the shadow slider); highlighted words in the channel colour, brightened. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || SK.white, hi = o.hi || mix(boost(o.C || [255, 200, 80], 0.5), SK.white, 0.25), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css([255, 140, 90], 0.6) : css(SK.ink, 0.55); ctx.shadowBlur = fs * 0.12 * s * k; ctx.shadowOffsetY = fs * 0.03 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: SK.ink, light: SK.white, mid: [200, 214, 232], dark: [40, 60, 100], colour: (c) => boost(c, 0.4) }, stroke: { ink: SK.ink, light: SK.white }, line: 0.7 })),
  sticker: painters({ line: SK.ink, lineScale: 0.6, tone: inkAs(SK.ink, (c) => boost(c, 0.4)), shadow(ctx, draw) { ctx.save(); ctx.translate(4, 6); draw(css(SK.ink, 0.25)); ctx.restore(); } }),
  /** The corner tag: a white pill, deep blue lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(SK.ink, 0.3); ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(SK.white, 0.92); ctx.fill(); ctx.restore();
    ctx.fillStyle = ink || css(SK.ink); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a thin white line round the picture, rounded, as a film still is shown. */
  frame(ctx, env) { const { w, h } = env; ctx.save(); ctx.beginPath(); rounded(ctx, 24, 24, w - 48, h - 48, 18); ctx.strokeStyle = css(SK.white, 0.6); ctx.lineWidth = 2; ctx.stroke(); ctx.restore(); },
  image(ctx, C, unit) { ctx.shadowColor = css(SK.ink, 0.35); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, 0.12, unit); },
  prompt: `Stickers for a sunny anime-film street scene — clear, fresh and nostalgic — that read at a glance:
- one clear object per sticker (a vending machine, a bicycle, a cat, a paper plane, a cloud, a wind chime, an ice lolly, a school bag, a train), simple and friendly; no realism, no fine detail;
- flat colour only, clean and bright: the main colour with "blue" (sky), "white", "green" and "yellow" as partners; "ink" comes out deep navy — for small details only;
- the app adds a thin navy line and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a Japanese street in summer, built as simple models from a few boxes and cylinders — a vending machine, a utility pole, a bus stop, a water tank, a small shop; no realism, no fine detail.
- the renderer paints faces in clean bright tones with a thin navy line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep navy, and "main" the channel colour made vivid — use it for one to three parts.`,
};
skies.elementFx = [
  { key: "vivid", name: { zh: "照片通透", en: "Photo clarity" }, for: FX_PHOTO, stage: "filter",
    /** The photo made clear and vivid as an anime sky: more colour and contrast, cobalt toward the top, the sun's warmth toward the foot. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { const l = 0.3 * r + 0.59 * g + 0.11 * b, c = (v) => clamp(128 + (l + (v - l) * 1.45 - 128) * 1.12, 0, 255), top = Math.max(0, 0.5 - y) * 2, foot = Math.max(0, y - 0.5) * 2; o[0] = clamp(c(r) - 14 * top + 12 * foot, 0, 255); o[1] = clamp(c(g) - 2 * top + 4 * foot, 0, 255); o[2] = clamp(c(b) + 22 * top - 10 * foot, 0, 255); }); } },
];
