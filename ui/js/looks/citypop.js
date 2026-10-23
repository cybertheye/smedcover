// city pop: the night city of the OVA years
// Late-80s and early-90s anime as the videotape kept it: a navy night, or a violet dusk, of cel-painted
// clouds; towers of lit windows, red lights winking on their tops; neon tubes and a sign by the road;
// palms; the lights doubled in black water; the figure painted as a cel, a hard shadow and a rim of neon;
// laser lines; and the smear, scanlines and tracking noise of the tape.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, WORK, boost, canPaint, clamp, css, current, fall, fast, figureOf, glowBehind, grain, graphicShape, gridPen, inPixels, inkAs, keptLayer, mapped, mix, neonTube, objAt, onLayer, openField, pad2, painters, placeShape, rand, rePlate, reflectBelow, region, rounded, seed, shapeOf, shift, starMark, vignette, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CP = { line: [16, 14, 38], cream: [255, 244, 232], pink: [255, 64, 168], cyan: [70, 232, 255], green: [96, 255, 168], amber: [255, 190, 96], red: [255, 54, 64], warm: [255, 232, 180] };
const CP_NEON = [CP.pink, CP.cyan, CP.green, CP.amber];
/** The sky, top to horizon, at dusk d (0: deep night, 1: violet dusk). */
const cpSky = (d) => [mix([6, 10, 36], [40, 28, 92], d), mix([24, 40, 116], [104, 68, 156], d), mix([66, 80, 170], [242, 140, 168], d)];
/**
 * A bank of cloud as the cel painters did a night sky: ragged lobes strung along a line, each in the body
 * tone with a crescent lit along its top (moonlight by night, the last of the sun at dusk) and a darker one
 * along its foot, the lower lobes over the higher; thin wisps trailing off either end. Flat tones, hard
 * edges. (cx, cy): its middle; len: its length; th: its thickness.
 */
function cpCloud(ctx, cx, cy, len, th, d, k) {
  const body = mix([18, 26, 70], [94, 64, 142], d), lit = mix([74, 108, 206], [252, 160, 184], d), deep = mix([8, 12, 40], [60, 42, 106], d), m = 9 + Math.floor(rand(k) * 9), lobes = [];
  for (let i = 0; i < m; i++) {
    const t = i / (m - 1), r = th * (0.3 + rand(k + i * 2.3 + 1) * 0.6) * (0.4 + 0.6 * Math.sin(Math.PI * (0.08 + 0.84 * t)));
    lobes.push([cx + len * (t - 0.5) + (rand(k + i * 3.1 + 2) - 0.5) * len * 0.08, cy + (rand(k + i * 4.7 + 3) - 0.5) * th * 0.5 - Math.sin(Math.PI * t) * th * 0.3, r]);
  }
  lobes.sort((a, b) => a[1] - b[1]);
  ctx.save();
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const wx = cx + s * len * (0.42 + 0.1 * i + rand(k + i * 5.1 + s) * 0.08), wy = cy + th * (rand(k + i * 6.3 + s * 2) - 0.3) * 0.6, wr = len * (0.08 + rand(k + i * 7.7 + s) * 0.1);
    ctx.fillStyle = css(i % 2 ? lit : body); ctx.beginPath(); ctx.ellipse(wx, wy, wr, th * 0.05 + 1, 0, 0, TAU); ctx.fill();
  }
  for (const [x, y, r] of lobes) {
    const rx = r * 1.9;
    ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, rx, r, 0, 0, TAU); ctx.clip();
    ctx.fillStyle = css(lit); ctx.fillRect(x - rx, y - r, rx * 2, r * 2);
    ctx.fillStyle = css(body); ctx.beginPath(); ctx.ellipse(x + rx * 0.05, y + r * 0.3, rx, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = css(deep); ctx.beginPath(); ctx.ellipse(x + rx * 0.1, y + r * 1.3, rx * 1.05, r, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
/** Stars: pinpricks thicker toward the top of the sky, a few bright ones with four points, fainter at dusk; `n` of them, the last coming in by degrees. */
function cpStars(ctx, F, bottom, n, d, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, bottom - F.y0), fade = 1 - 0.65 * d;
  ctx.save(); ctx.fillStyle = css(CP.cream);
  for (let i = 0; i < Math.ceil(n); i++) {
    const x = F.x0 + fw * rand(i * 1.7 + k0), y = F.y0 + span * rand(i * 2.9 + k0 + 1) ** 1.7, big = rand(i * 3.3 + k0 + 2) ** 6;
    ctx.globalAlpha = (0.35 + 0.65 * rand(i * 4.1 + k0 + 3)) * fade * clamp(n - i);
    if (big > 0.5) starMark(ctx, x, y, 3 + big * 6, 4, CP.cream); else { ctx.beginPath(); ctx.arc(x, y, 0.7 + big * 2.6, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
/**
 * The city at night, its feet at `base` and its tallest reaching `top`: the glow it throws on the sky, a
 * ridge of hills far off, then three rows of towers — the far row small and hazy, pricked with light; the
 * middle row tall and gridded with windows; the near row low and dark. `lit` (0–1) of the windows are
 * lit, warm white with a few pink or cyan; red lights on the tops; with `neon`, crowns banded in neon
 * tube and signboards down the near faces, one after another.
 */
function cpCity(ctx, F, top, base, lit, neon, d, k0) {
  const fw = F.x1 - F.x0, H = Math.max(10, base - top), u = Math.min(fw, F.y1 - F.y0), hz = cpSky(d)[2], glow = mix([150, 60, 170], [255, 150, 160], d);
  const g = ctx.createLinearGradient(0, base - H * 1.2, 0, base); g.addColorStop(0, css(glow, 0)); g.addColorStop(1, css(glow, 0.45));
  ctx.fillStyle = g; ctx.fillRect(F.x0, base - H * 1.2, fw, H * 1.2);
  const ph = rand(k0) * TAU;
  ctx.fillStyle = css(mix(mix([12, 16, 50], [56, 40, 104], d), hz, 0.25)); ctx.beginPath(); ctx.moveTo(F.x0 - 10, base + 2);
  for (let x = F.x0 - 10; x <= F.x1 + 30; x += 24) { const t = (x - F.x0) / fw; ctx.lineTo(x, base - H * (0.3 + 0.13 * Math.sin(t * 5.1 + ph) + 0.06 * Math.sin(t * 13.3 + ph * 2) + 0.03 * Math.sin(t * 31 + ph))); }
  ctx.lineTo(F.x1 + 30, base + 2); ctx.closePath(); ctx.fill();
  const WARM = [CP.warm, CP.warm, CP.warm, CP.warm, CP.warm, CP.warm, [255, 246, 222], [255, 246, 222], [255, 210, 140], [255, 210, 140], [255, 150, 204], [150, 228, 255]];
  const ROWS = [
    { w: [0.018, 0.03], h: [0.22, 0.38], body: mix(mix([30, 36, 96], [86, 62, 136], d), hz, 0.45), pin: true, litK: 0.7 },
    { w: [0.04, 0.06], h: [0.4, 0.6], body: mix([20, 26, 72], [52, 40, 100], d), litK: 1, crowns: true },
    { w: [0.06, 0.08], h: [0.12, 0.3], body: mix([10, 12, 36], [28, 22, 58], d), litK: 0.6, signs: true },
  ];
  ROWS.forEach((R, ri) => {
    const wins = new Map(), add = (c, x, y, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, y, w, h); }, reds = [], tubes = [];
    for (let x = F.x0 - 14, i = 0; x < F.x1 + 14; i++) {
      const kk = k0 + ri * 1000 + i * 7.3, bw = u * (R.w[0] + rand(kk) * R.w[1]), bh = H * (R.h[0] + rand(kk + 1) * R.h[1]), y0 = base - bh, kind = rand(kk + 2);
      ctx.fillStyle = css(R.body); ctx.fillRect(x, y0, bw, bh + 4);
      ctx.fillStyle = css(mix(R.body, glow, 0.18)); ctx.fillRect(x + bw * 0.74, y0, bw * 0.26, bh + 4);   // the side the city's glow catches
      let roof = y0;
      if (kind < 0.25) { ctx.fillStyle = css(R.body); ctx.fillRect(x + bw * 0.18, y0 - bh * 0.1, bw * 0.64, bh * 0.1 + 1); roof = y0 - bh * 0.1; }   // a setback
      else if (kind < 0.4) { ctx.fillStyle = css(R.body); shapeOf(ctx, [[x, y0 + 1], [x + bw, y0 + 1], [x + bw, y0 - bw * 0.45]]); ctx.fill(); }   // a slanted crown
      else if (kind < 0.55) { ctx.fillStyle = css(R.body); ctx.fillRect(x + bw * 0.48, y0 - bh * 0.22, Math.max(1.5, bw * 0.04), bh * 0.22); reds.push([x + bw * 0.5, y0 - bh * 0.22]); }   // a mast
      if (!R.pin && rand(kk + 3) < 0.6) reds.push([x + bw * 0.08, roof - 2], [x + bw * 0.92, roof - 2]);
      // the windows: a grid, the lit ones warm, a few pink or cyan; on the far row only the lit ones, as pinpricks
      const ws = R.pin ? Math.max(1.4, bw * 0.08) : bw * 0.075, wh = R.pin ? ws : ws * 0.8, cols = Math.max(1, Math.floor((bw * 0.82) / (ws * 2))), gx = (bw * 0.82 - cols * ws * 2) / 2;
      for (let r = 0, y = y0 + bw * 0.1; y < base - wh; r++, y += wh * (R.pin ? 2.6 : 2.2)) for (let q = 0; q < cols; q++) {
        const on = rand(kk * 3.7 + r * 1.31 + q * 0.173) < lit * R.litK;
        if (on) add(WARM[Math.floor(rand(kk + r * 2.9 + q * 5.3) * WARM.length)], x + bw * 0.09 + gx + q * ws * 2, y, ws, wh);
        else if (!R.pin) add(mix(R.body, [70, 80, 140], 0.22), x + bw * 0.09 + gx + q * ws * 2, y, ws, wh);
      }
      if (R.crowns && rand(kk + 4) < neon * 0.6) tubes.push(["crown", x, roof, bw, CP_NEON[Math.floor(rand(kk + 5) * 4)]]);
      if (R.signs && rand(kk + 6) < neon) tubes.push(["sign", x + (rand(kk + 7) > 0.5 ? bw * 0.06 : bw * 0.68), y0 + bh * 0.1, bw * 0.24, CP_NEON[Math.floor(rand(kk + 8) * 4)], Math.min(bh * 0.7, bw * 0.24 * (3 + rand(kk + 9) * 2)), CP_NEON[Math.floor(rand(kk + 10) * 4)]]);
      x += bw * (0.86 + rand(kk + 11) * 0.22);
    }
    for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
    for (const [x, y] of reds) { ctx.fillStyle = css(CP.red, 0.25); ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.fill(); ctx.fillStyle = css([255, 140, 140]); ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill(); }
    for (const [kind, x, y, w, c, sh, c2] of tubes) {
      if (kind === "crown") { ctx.beginPath(); ctx.moveTo(x + w * 0.06, y + w * 0.08); ctx.lineTo(x + w * 0.94, y + w * 0.08); ctx.moveTo(x + w * 0.06, y + w * 0.2); ctx.lineTo(x + w * 0.94, y + w * 0.2); neonTube(ctx, c, Math.max(1.2, w * 0.025)); continue; }
      ctx.fillStyle = css([18, 10, 32]); ctx.fillRect(x, y, w, sh);
      ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, sh - 4); neonTube(ctx, c, Math.max(1, w * 0.04));
      ctx.beginPath(); for (let q = 0, n = Math.max(2, Math.floor(sh / (w * 0.9))); q < n; q++) { const gy = y + w * 0.25 + q * w * 0.9, gw = w * 0.5; ctx.moveTo(x + w * 0.25, gy); ctx.lineTo(x + w * 0.25 + gw, gy); ctx.moveTo(x + w * 0.5, gy); ctx.lineTo(x + w * 0.5, gy + w * 0.5); }
      neonTube(ctx, c2 === c ? CP.cream : c2, Math.max(0.8, w * 0.03));
    }
  });
}
/**
 * A neon sign up on its pole, as a motel or a bar by the road has one: a rounded frame of tube in one
 * colour with an arrow off its side, a word in looping script tube in another, a line of small letters
 * under it. (x, y): its middle; s: its width; a: how strongly it shows.
 */
function cpSign(ctx, x, y, s, a, k) {
  const h = s * 0.42, c1 = CP_NEON[1 + Math.floor(rand(k) * 3)], c2 = CP.pink, lw = Math.max(1.5, s * 0.012);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css([14, 12, 30]); ctx.fillRect(x - s * 0.025, y + h * 0.5, s * 0.05, s * 1.6);
  ctx.beginPath(); rounded(ctx, x - s / 2, y - h / 2, s, h, h * 0.18); ctx.fill();
  ctx.beginPath(); rounded(ctx, x - s / 2 + lw * 2, y - h / 2 + lw * 2, s - lw * 4, h - lw * 4, h * 0.15);
  ctx.moveTo(x + s / 2, y + h * 0.12); ctx.lineTo(x + s * 0.64, y + h * 0.12); ctx.moveTo(x + s * 0.64, y + h * 0.12); ctx.lineTo(x + s * 0.59, y + h * 0.02); ctx.moveTo(x + s * 0.64, y + h * 0.12); ctx.lineTo(x + s * 0.59, y + h * 0.22);
  neonTube(ctx, c1, lw);
  const sx = x - s * 0.36, sw = s * 0.72, base = y + h * 0.08, xh = h * 0.22, n = 5 + Math.floor(rand(k + 1) * 3), step = sw / n;   // the word: a row of looped letters joined up
  ctx.beginPath(); ctx.moveTo(sx, base);
  for (let i = 0; i < n; i++) {
    const px = sx + i * step, nx = px + step, kind = Math.floor(rand(k + i * 2.3 + 2) * 3);
    if (kind === 0) { ctx.bezierCurveTo(px + step * 0.9, base - xh * 1.4, px + step * 0.1, base - xh * 2.6, px + step * 0.55, base); ctx.quadraticCurveTo(px + step * 0.8, base + xh * 0.3, nx, base); }
    else if (kind === 1) { ctx.quadraticCurveTo(px + step * 0.25, base - xh * 1.2, px + step * 0.5, base); ctx.quadraticCurveTo(px + step * 0.75, base - xh * 1.2, nx, base); }
    else { ctx.bezierCurveTo(px + step * 0.9, base - xh * 0.6, px + step * 0.4, base - xh * 1.4, px + step * 0.3, base - xh * 0.4); ctx.quadraticCurveTo(px + step * 0.4, base + xh * 0.3, nx, base); }
  }
  ctx.quadraticCurveTo(sx + sw * 0.7, base + xh * 0.9, sx + sw * 0.08, base + xh * 0.6);   // and a swash back under it
  neonTube(ctx, c2, lw * 1.3);
  ctx.beginPath(); for (let i = 0; i < 7; i++) { const lx = x - s * 0.3 + i * s * 0.088; ctx.moveTo(lx, y + h * 0.3); ctx.lineTo(lx + s * 0.05, y + h * 0.3); }
  neonTube(ctx, [120, 160, 255], lw * 0.7);
  ctx.restore();
}
/**
 * A palm: a trunk curving up from its foot (x, base), ringed, and a crown of fronds arching and drooping,
 * each a long blade notched along its lower edge, dark, the side to the sky lit. s: its height; lean: the
 * way it bends (−1 to 1).
 */
function cpPalm(ctx, x, base, s, lean, d, k) {
  const dk = mix([8, 28, 32], [24, 22, 52], d), lt = mix([34, 100, 84], [86, 66, 124], d), tk = mix([20, 22, 40], [40, 30, 60], d);
  const tx = x + lean * s * 0.22, ty = base - s, cx1 = x + lean * s * 0.02, cy1 = base - s * 0.5;
  const P = (t) => [(1 - t) ** 2 * x + 2 * (1 - t) * t * cx1 + t * t * tx, (1 - t) ** 2 * base + 2 * (1 - t) * t * cy1 + t * t * ty], wd = (t) => s * (0.026 - 0.012 * t);
  const Lf = [], Rt = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12, [px, py] = P(t), [qx, qy] = P(Math.min(1, t + 0.01)), dx = qx - px, dy = qy - py, n = Math.hypot(dx, dy) || 1, w = wd(t); Lf.push([px - (dy / n) * w, py + (dx / n) * w]); Rt.push([px + (dy / n) * w, py - (dx / n) * w]); }
  ctx.fillStyle = css(tk); shapeOf(ctx, [...Lf, ...Rt.reverse()]); ctx.fill();
  ctx.strokeStyle = css(mix(tk, lt, 0.45)); ctx.lineWidth = Math.max(1, s * 0.004); ctx.beginPath();
  for (let i = 1; i < 32; i++) { const t = i / 32, [px, py] = P(t), w = wd(t); ctx.moveTo(px - w, py); ctx.lineTo(px + w * 0.6, py + w * 0.3); }
  ctx.stroke();
  for (let i = 0, n = 10; i < n; i++) {
    const ang = Math.PI * (-1.12 + 1.24 * ((i + rand(k + i) * 0.6) / n)), len = s * (0.24 + rand(k + i * 2.1 + 1) * 0.14), droop = len * (0.3 + rand(k + i * 3.3 + 2) * 0.4), up = [], dn = [], sp = [];
    for (let j = 0; j <= 14; j++) {
      const t = j / 14, px = tx + Math.cos(ang) * len * t, py = ty + Math.sin(ang) * len * t + droop * t * t, ddx = Math.cos(ang) * len, ddy = Math.sin(ang) * len + 2 * droop * t, nn = Math.hypot(ddx, ddy) || 1;
      let nx = -ddy / nn, ny = ddx / nn;
      if (ny > 0) { nx = -nx; ny = -ny; }   // the side toward the sky
      const w = len * 0.08 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.02));
      sp.push([px, py]); up.push([px + nx * w, py + ny * w]); dn.push([px - nx * w * (j % 2 ? 1.3 : 0.35), py - ny * w * (j % 2 ? 1.3 : 0.35)]);
    }
    ctx.fillStyle = css(dk); shapeOf(ctx, [...up, ...dn.reverse()]); ctx.fill();
    ctx.fillStyle = css(lt); shapeOf(ctx, [...up, ...sp.reverse()]); ctx.fill();
  }
}
/** The neon the figure is lit by: the channel colour, bright as a tube. */
const cpRim = (C) => mix(boost(C, 0.7), [255, 255, 255], 0.22);
/**
 * The figure painted as a cel and set in the night: its graphic itself (see figureOf; or, while it cannot be
 * drawn, its silhouette) with its tones stepped as cel paint, sunk into the night's blue; a crescent of hard
 * shadow on the side away from the neon (its own shape moved toward the light leaves it) and a thin rim of
 * the neon — the channel colour — along the lit side. Painted once on a canvas of its own at `k` canvas
 * pixels to the unit, its middle at the middle, and kept while the graphic, the size, the colour and the
 * scale stay the same, so moving it costs a copy. Returns { c, hw, hh } (its half size in units).
 */
function cpFigureImage(env, S, size, C, k) {
  const b = S.box, kk = size / Math.max(1, b.y1 - b.y0), hw = ((b.x1 - b.x0) / 2) * kk + 8, hh = size / 2 + 8, lx = 0.8, ly = -0.6;
  const key = [current.id, JSON.stringify(figureOf(env) && figureOf(env).ref), size.toFixed(1), C.map(Math.round).join(), k.toFixed(4)].join("|"), kept = WORK.cpFigure;
  if (kept && kept.key === key) return kept;
  const W = Math.max(1, Math.ceil(2 * hw * k)), H = Math.max(1, Math.ceil(2 * hh * k)), make = (slot) => { const c = WORK[slot] || (WORK[slot] = document.createElement("canvas")); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } const x = c.getContext("2d", { willReadFrequently: true }); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, W, H); x.setTransform(k, 0, 0, k, hw * k, hh * k); return x; };
  const out = WORK.cpFigureCv = document.createElement("canvas"), x = make("cpFig");
  x.save(); x.scale(kk, kk); x.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  const drawn = figureOf(env) && figureOf(env).draw(x);
  x.restore();
  if (!drawn) placeShape(x, S, [54, 60, 128], 0, 0, size);
  const img = x.getImageData(0, 0, W, H); celPixels(img.data, 1); x.putImageData(img, 0, 0);
  inPixels(x, () => { x.globalCompositeOperation = "multiply"; x.fillStyle = css([150, 154, 226]); x.fillRect(0, 0, W, H); });
  x.globalCompositeOperation = "destination-in"; placeShape(x, S, [255, 255, 255], 0, 0, size);
  const edge = (colour, d, alpha) => {   // the shape less itself moved by d along the light: a crescent on one side
    const r = make("cpRim");
    placeShape(r, S, colour, 0, 0, size); r.globalCompositeOperation = "destination-out"; placeShape(r, S, [255, 255, 255], d * lx, d * ly, size);
    inPixels(x, () => { x.globalCompositeOperation = "source-atop"; x.globalAlpha = alpha; x.drawImage(r.canvas, 0, 0); });
  };
  edge([12, 12, 44], size * 0.07, 0.6);
  edge(cpRim(C), -size * 0.014, 1);
  out.width = W; out.height = H; out.getContext("2d").drawImage(x.canvas, 0, 0);
  const made = { c: out, hw, hh, key: drawn ? key : null };   // a graphic still loading is tried again next time
  WORK.cpFigure = made;
  return made;
}
/** Lays the figure (see cpFigureImage) with its middle at (cx, cy), at `a`. */
function cpFigure(ctx, env, S, cx, cy, size, C, a) {
  const m = ctx.getTransform(), f = cpFigureImage(env, S, size, C, Math.hypot(m.a, m.b) || 1);
  ctx.save(); ctx.globalAlpha = a; ctx.imageSmoothingEnabled = true; ctx.drawImage(f.c, cx - f.hw, cy - f.hh, f.hw * 2, f.hh * 2); ctx.restore();
}
/** Laser lines across the field: thin beams of hot neon, some broken into runs, each at a height and tilt of its own; `n`, the last by degrees. */
function cpLasers(ctx, F, n, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh);
  for (let i = 0; i < Math.ceil(n); i++) {
    const y = F.y0 + fh * (0.12 + 0.8 * rand(i * 2.3 + k0)), tilt = (rand(i * 3.1 + k0 + 1) - 0.5) * fh * 0.05, c = i % 4 === 2 ? CP.cyan : CP.pink, lw = u * (0.0016 + rand(i * 4.7 + k0 + 2) * 0.003);
    ctx.beginPath();
    for (let x = F.x0 - 10 + fw * rand(i * 5.3 + k0 + 3) * 0.3, q = 0; x < F.x1 + 10; q++) {
      const len = fw * (0.15 + rand(i * 7.1 + q * 1.9 + k0) * 0.6), gap = fw * rand(i * 8.3 + q * 2.7 + k0) * 0.12, x1 = Math.min(F.x1 + 10, x + len);
      ctx.moveTo(x, y + (tilt * (x - F.x0)) / fw); ctx.lineTo(x1, y + (tilt * (x1 - F.x0)) / fw);
      x = x1 + gap;
    }
    neonTube(ctx, c, lw, clamp(n - i));
  }
}
/**
 * The picture as a worn videotape plays it, by `a` (0–1): the colour smeared — a red copy laid on a little
 * to the right, a blue one a little to the left, each only where it brightens —, scanlines, a band near the
 * foot slid sideways with a spray of white noise along it (the tracking), and a pale line rolling through.
 */
function vhsTape(ctx, w, h, a, unit) {
  if (a <= 0 || !canPaint(ctx)) return;
  const cv = ctx.canvas, W = cv.width, H = cv.height, k = W / w;
  if (!fast) for (const [col, dx] of [["#ff0000", (2 + 7 * a) * k], ["#0000ff", -(1 + 4 * a) * k]]) {
    const x = workLike(ctx, "vhs"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(cv, 0, 0); x.globalCompositeOperation = "multiply"; x.fillStyle = col; x.fillRect(0, 0, W, H);
    inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.globalAlpha = Math.min(1, 0.4 + a); ctx.drawImage(x.canvas, dx, 0); });
  }
  const p = Math.max(2, Math.round(3 * k)), key = `vhsLines|${p}`;
  let t = WORK[key];
  if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = 4; t.height = p; const g = t.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, 4, Math.max(1, Math.round(p / 3))); }
  inPixels(ctx, () => { ctx.globalAlpha = 0.3 * a; ctx.fillStyle = ctx.createPattern(t, "repeat"); ctx.fillRect(0, 0, W, H); });
  const bh = Math.max(2, Math.round(H * (0.006 + 0.02 * a))), by = H - bh - Math.round(H * 0.006);   // the head-switching noise along the foot
  if (by + bh < H) {
    const band = WORK.vhsBand || (WORK.vhsBand = document.createElement("canvas"));
    if (band.width !== W || band.height !== bh) { band.width = W; band.height = bh; }
    const bg = band.getContext("2d"); bg.globalCompositeOperation = "copy"; bg.drawImage(cv, 0, by, W, bh, 0, 0, W, bh);
    inPixels(ctx, () => {
      ctx.drawImage(band, (4 + 30 * a) * k, by);
      ctx.fillStyle = css([255, 255, 255], 0.55 * a);
      for (let i = 0, n = Math.round(30 + 160 * a); i < n; i++) ctx.fillRect(rand(i * 1.7 + 682) * W, by + rand(i * 2.3 + 683) * bh, (2 + rand(i * 3.1 + 684) * 16) * k, Math.max(1, k));
    });
  }
  const ry = H * rand(685), rg = ctx.createLinearGradient(0, ry - 24 * k, 0, ry + 24 * k);
  rg.addColorStop(0, "rgba(255,255,255,0)"); rg.addColorStop(0.5, css([255, 255, 255], 0.07 * a)); rg.addColorStop(1, "rgba(255,255,255,0)");
  inPixels(ctx, () => { ctx.fillStyle = rg; ctx.fillRect(0, ry - 24 * k, W, 48 * k); });
}
/** For each lightness 0–255, the stepped lightness of cel paint: four flat tones, the steps a little soft so their edges do not crawl. */
const CEL_STEPS = (() => {
  const out = new Float32Array(256), th = [0.2, 0.42, 0.68], lv = [0.07, 0.27, 0.53, 0.88];
  for (let i = 0; i < 256; i++) { const t = i / 255; let v = lv[0]; th.forEach((s, j) => { const e = clamp((t - s + 0.025) / 0.05); v += (lv[j + 1] - lv[j]) * e * e * (3 - 2 * e); }); out[i] = v; }
  return out;
})();
/** RGBA pixels painted as a cel, mixed in by a: the lightness stepped, the hue kept and made a little stronger, the shadows sunk toward a night teal, the lights warmed. */
export function celPixels(d, a) {
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2], l = (r * 54 + g * 183 + b * 19) >> 8, q = CEL_STEPS[l], s = Math.min(3, (q * 255 + 1) / (l + 1));
    let R = r * s, G = g * s, B = b * s;
    const m = (R + G + B) / 3, sh = clamp((0.5 - q) / 0.45) * 0.55, hi = clamp((q - 0.62) / 0.3) * 0.3;
    R = m + (R - m) * 1.25; G = m + (G - m) * 1.25; B = m + (B - m) * 1.25;
    R += (22 - R) * sh + (255 - R) * hi; G += (52 - G) * sh + (232 - G) * hi; B += (92 - B) * sh + (236 - B) * hi;
    d[i] = r + (R - r) * a; d[i + 1] = g + (G - g) * a; d[i + 2] = b + (B - b) * a;
  }
}
export const citypop = {
  id: "citypop",
  art: "figure",
  repaint: (c) => `a night scene from a late-1980s anime OVA made from the photograph: hand-painted cel animation, a deep navy or violet night sky with cel-shaded clouds, city lights and neon signs, hard-edged two-tone shading with teal shadows, slightly faded VHS colour, with ${c} as an accent; still the same place, no text.`,
  about: { zh: "都市夜曲：八九十年代 OVA 动画录像带里的城市夜色——深海军蓝的夜空（或暮紫的黄昏），赛璐珞手法画的云，一层层楼群亮着窗灯、楼顶闪着红色航空灯，霓虹灯管和路边的霓虹招牌，棕榈树，黑色水面里倒映的灯火；频道图形画成赛璐珞人物：硬边阴影加一道霓虹轮廓光；可加星空、激光线，以及录像带的色彩拖影、扫描线和跟踪噪点。复古、浪漫、城市流行乐的味道——适合音乐、夜生活、城市、情感、复古与动画内容。照片会被画成赛璐珞的几层平涂。只有夜色底。", en: "City pop night: the city by night on the anime videotapes of the late 80s and early 90s — a deep navy night (or a violet dusk), clouds painted as cels, rows of towers with their windows lit and red lights winking on their tops, neon tubes and a neon sign by the road, palms, the lights doubled in black water; the channel graphic as a figure painted on a cel, a hard shadow and a rim of neon; stars, laser lines, and the colour smear, scanlines and tracking noise of the tape if you like. Retro, romantic, city-pop — for music, nightlife, cities, feelings, retro and animation. A photo is painted in a few flat cel tones. Night ground only." },
  name: { zh: "都市夜曲", en: "City pop night" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "赛璐珞人物", en: "Cel figure" }, sign: { zh: "霓虹招牌", en: "Neon sign" }, palms: { zh: "棕榈", en: "Palms" }, clouds: { zh: "夜云", en: "Night clouds" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "赛璐珞人物", en: "Cel figure" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "暮色", en: "Dusk" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "夜云", en: "Night clouds" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "星空", en: "Stars" } },
    { key: "skyline", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "楼群", en: "Skyline" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "窗灯", en: "Lit windows" } },
    { key: "neon", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "霓虹灯牌", en: "Neon" } },
    { key: "palms", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "棕榈", en: "Palms" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "水面倒影", en: "Water" } },
    { key: "laser", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "激光线", en: "Laser lines" } },
    { key: "vhs", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "录像带", en: "Videotape" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "cel", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片赛璐珞化", en: "Photo as cels" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base, C, p) => ({ ...base, field: css(cpSky((p && p.dusk) || 0)[1]), text: css(CP.cream), dim: css(CP.cream, 0.6), titleFill: css(CP.cream), titleInk: css(CP.line), grid: () => css(CP.pink, 0.24) }),
  /**
   * The sky, its stars and clouds, the city (painted once and kept until one of their sliders changes);
   * then the sign, the palms, the water mirroring all of it, the figure in front, the lasers. A photo is
   * painted as cels; filling the canvas, it gets the lasers too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), d = p.dusk, sky = cpSky(d);
    if (env.photo) {
      env.drawPhoto(0, p.cel > 0 ? { key: `cel|${p.cel}`, fn: (d) => celPixels(d, p.cel) } : null);   // the photo itself painted as cels (see drawPhotoAt), not the canvas read back
      if (L.fill) cpLasers(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.laser * 8, 2700);
      return true;
    }
    const water = F.y1 - fh * 0.32 * p.water, top = water - fh * (0.12 + 0.5 * p.skyline);
    const cloudMove = L.grid && p.clouds > 0 ? objAt("clouds", F.x0 + fw * 0.5, F.y0 + fh * 0.3, ctx).map((v, i) => v - [F.x0 + fw * 0.5, F.y0 + fh * 0.3][i]) : [0, 0];   // a scene object: the clouds move as one
    if (L.ground !== false) {   // the sky itself, down to the water's line: the ground
      const g = ctx.createLinearGradient(0, F.y0, 0, water); g.addColorStop(0, css(sky[0])); g.addColorStop(0.55, css(sky[1])); g.addColorStop(1, css(sky[2]));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    const paintSky = (x) => {   // what is in the sky: kept on a layer of its own
      if (p.stars > 0) cpStars(x, F, water, p.stars * 360, d, 2710);
      if (p.clouds > 0) {   // banks of cloud, the far (lower, smaller) ones first
        const n = p.clouds * 10, banks = [];
        for (let k = 0; k < Math.ceil(n); k++) { const a = clamp(n - k), t = rand(k * 2.3 + 2720) ** 1.3, s = 1 - 0.55 * t; banks.push([F.x0 + fw * rand(k * 3.1 + 2721), F.y0 + (water - F.y0) * (0.05 + 0.8 * t), fw * (0.2 + rand(k * 4.7 + 2722) * 0.35) * s * (0.4 + 0.6 * a), fh * (0.05 + rand(k * 5.3 + 2723) * 0.04) * s * (0.4 + 0.6 * a), 2724 + k * 31]); }
        x.save(); x.translate(cloudMove[0], cloudMove[1]);
        for (const [cx, cy, len, th, k] of banks.sort((a, b) => b[1] - a[1])) cpCloud(x, cx, cy, len, th, d, k);
        x.restore();
      }
      if (p.skyline > 0) cpCity(x, F, top, water, p.lights, p.neon, d, 2760);
    };
    if (p.stars > 0 || p.clouds > 0 || p.skyline > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "cpSky", [seed, w, h, F.x0, F.y0, F.x1, F.y1, d, p.stars, p.clouds, p.skyline, p.lights, p.neon, p.water, cloudMove.map((v) => v.toFixed(2)).join()].join("|"), paintSky);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintSky(ctx);
    }
    if (p.neon > 0) { const [sx, sy] = objAt("sign", F.x0 + fw * 0.86, F.y0 + fh * 0.22, ctx); cpSign(ctx, sx, sy, u * (0.16 + 0.14 * p.neon), clamp(p.neon * 2.5), 2780); }   // a scene object
    if (p.palms > 0) {   // a scene object: up to three palms, each growing in turn
      const n = p.palms * 3, set = [[F.x0 + fw * 0.05, 1.05, 0.5], [F.x1 - fw * 0.05, 0.95, -0.6], [F.x0 + fw * 0.2, 0.62, 0.3]];
      ctx.save(); shift("palms", F.x0 + fw * 0.05, F.y1 - fh * 0.5, ctx);
      for (let k = 0; k < Math.ceil(n); k++) { const [px, s, lean] = set[k]; cpPalm(ctx, px, F.y1 + 6, fh * s * (0.3 + 0.7 * clamp(n - k)), lean, d, 2790 + k * 17); }
      ctx.restore();
    }
    if (p.water > 0) {
      reflectBelow(ctx, 0, w, water, F.y1 + 2, mix([6, 10, 34], [34, 24, 70], d), 0.3, 0.75, 2800);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.water * 3);   // glints across the water: the lights' reflections caught on the ripples
      for (let i = 0, n = Math.round(10 + 60 * p.water); i < n; i++) { const y = water + (F.y1 - water) * rand(i * 2.1 + 2810) ** 1.4, x = F.x0 + fw * rand(i * 3.3 + 2811), l = u * (0.01 + rand(i * 4.1 + 2812) * 0.05); ctx.fillStyle = css(rand(i * 5.7 + 2813) < 0.7 ? CP.warm : CP_NEON[i % 4], 0.7); ctx.fillRect(x, y, l, 1.6); }
      ctx.fillStyle = css(mix(sky[2], CP.cream, 0.4), 0.5); ctx.fillRect(F.x0, water, fw, 1.5);
      ctx.restore();
    }
    const size = Math.min(fh, fw * 0.9) * (0.35 + 0.5 * p.figure), [cx, cy] = p.figure > 0 ? objAt("figure", F.x0 + fw * 0.6, F.y1 - size * 0.48, ctx) : [0, 0];   // a scene object
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const rim = cpRim(C), g = ctx.createRadialGradient(cx, cy - size * 0.2, 0, cx, cy - size * 0.2, size * 0.8);
      g.addColorStop(0, css(mix(rim, [120, 60, 220], 0.5), 0.4 * Math.min(1, p.figure * 2))); g.addColorStop(1, css(rim, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      cpFigure(ctx, env, S, cx, cy, size, C, Math.min(1, p.figure * 5));
    }
    if (p.laser > 0) cpLasers(ctx, F, p.laser * 8, 2700);
    return true;
  },
  /** The eighties' grid floor: the horizon, lines running from the foot of the picture to a vanishing point on it, and cross lines closing up toward it. */
  gridLines(ctx, env, color) {
    const { w, h } = env, hz = h * 0.62, vx = w / 2;
    gridPen(ctx, color); ctx.beginPath();
    ctx.moveTo(0, hz); ctx.lineTo(w, hz);
    const y0 = hz + (h - hz) * 0.08;   // the lines that run to it start a little below it, where they still stand apart
    for (let i = -14; i <= 14; i++) { const x1 = vx + i * 200; ctx.moveTo(vx + (x1 - vx) * 0.08, y0); ctx.lineTo(x1, h); }
    for (let k = 3; k <= 10; k++) { const y = hz + (h - hz) * (k / 10) ** 2; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(mix([14, 14, 44], C, 0.12)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; for (const [w, a] of [[16, 0.15], [7, 0.4], [3, 1]]) { ctx.strokeStyle = css(CP.pink, a); ctx.lineWidth = w; run(0, 0); } ctx.strokeStyle = css([255, 210, 236]); ctx.lineWidth = 1.2; run(0, 0); } },   // a neon tube along the block's edge
  /** A title card of the tapes: letters graded from cream to pink, a dark outline (the outline slider), and under them a hard pink step and a deep navy drop (the shadow slider); highlighted words in the channel colour, made bright. */
  runs(ctx, pass, o) {
    const fs = o.fs, s = Math.min(2, o.shadowAmt), k = o.strokeAmt, hi = o.hi || mix(boost(o.C || CP.pink, 0.6), [255, 255, 255], 0.2);
    ctx.lineJoin = "round";
    if (s > 0) {
      const [fx, fy] = fall(fs * 0.075 * s, fs * 0.075 * s), [nx, ny] = fall(fs * 0.038 * s, fs * 0.038 * s);
      pass((a, x) => { ctx.fillStyle = css(CP.line); ctx.fillText(a.t, x + fx, fy); });
      pass((a, x) => { ctx.fillStyle = css(a.hi ? CP.cyan : CP.pink); ctx.fillText(a.t, x + nx, ny); });
    }
    if (k > 0) pass((a, x) => { ctx.strokeStyle = css(CP.line); ctx.lineWidth = fs * 0.1 * k; ctx.strokeText(a.t, x, 0); });
    let grad = null;
    if (!o.fill) { grad = ctx.createLinearGradient(0, -fs * 0.72, 0, fs * 0.05); grad.addColorStop(0, css(CP.cream)); grad.addColorStop(0.55, css([255, 234, 238])); grad.addColorStop(1, css([255, 164, 208])); }
    pass((a, x) => { ctx.fillStyle = a.hi ? css(hi) : grad || css(o.fill); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink (the channel name on the dark block, the brand row) turns cream; objects go into the night's flat tones
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: CP.cream }, stroke: { ink: CP.cream } } : { fill: { ink: CP.line, light: CP.cream, mid: [172, 180, 214], dark: [46, 52, 100], colour: (c) => mix(boost(c, 0.3), [60, 40, 120], 0.15) }, stroke: { ink: CP.line, light: CP.cream }, line: 0.8 }),
  sticker: painters({ line: CP.line, lineScale: 0.7, tone: inkAs(CP.line, (c) => mix(boost(c, 0.3), [60, 40, 120], 0.15)), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 7); draw(css(CP.line, 0.85)); ctx.restore(); } }),
  /** The corner tag: cream capitals in a rounded frame of cyan neon tube. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.22); neonTube(ctx, CP.cyan, 3);
    ctx.fillStyle = ink || css(CP.cream); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 10, y: top - 10, w: w + 20, h: h + 20 };
  },
  /** The frame layer: the rounded corners of a television screen, and the tape's play display. */
  frame(ctx, env) {
    const { w, h } = env, r = 40, t = 1800 + Math.floor(rand(690) * 5200) + env.o.catIndex * 97;
    ctx.fillStyle = "#000000";
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * r, y); ctx.arcTo(x, y, x, y + sy * r, r); ctx.lineTo(x, y); ctx.fill(); }
    ctx.font = `600 18px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(CP.cream, 0.8);
    ctx.fillText(`▶ PLAY   SP ${Math.floor(t / 3600)}:${pad2(Math.floor(t / 60) % 60)}:${pad2(t % 60)}`, w - 64, h - 44);
  },
  image(ctx, C, unit) { ctx.shadowColor = css(CP.line, 0.75); ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 6 * unit; },
  post(ctx, w, h, C, p, unit = 1) { vhsTape(ctx, w, h, p.vhs, unit); grain(ctx, p.grain * 0.8, unit); vignette(ctx, w, h, [6, 4, 22], 0.5, 0.45); },
  prompt: `Animation cels from a late-1980s anime about the city at night — romantic, a little wistful — that read at a glance:
- one clear object per sticker (a cassette, a Walkman, a sports car, a payphone, a neon cocktail glass, a palm tree, a microphone, sunglasses, a vinyl record), with a strong silhouette; no realism, no fine detail;
- flat cel paint in two tones: each shape one flat colour with one hard-edged shadow shape in a darker, bluer tone of it ("shadow": false); colours are night colours — navy, violet, teal — with one neon pink or cyan;
- the app adds a dark navy line and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a city at night in a late-1980s anime, built as simple models from a few boxes and cylinders — a payphone, a jukebox, a vending machine, a sports car, a neon sign; no realism, no fine detail.
- the renderer paints faces in flat cel tones with a dark navy line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep navy, and "main" the channel colour as night shows it — use it for one to three parts.`,
};
citypop.elementFx = [
  { key: "cel", name: { zh: "赛璐珞分色", en: "Cel tones" }, for: FX_ALL, stage: "filter",
    /** The layer painted as a cel: its lightness stepped into four flat tones, its hue kept, the shadows sunk toward a night teal, the lights warmed. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); celPixels(img.data, a); x.putImageData(img, B.x0, B.y0); } },
  { key: "neon", name: { zh: "霓虹辉光", en: "Neon glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 80 * k, t: 80 * k, r: 80 * k, b: 80 * k }),
    /** Neon light round the layer: a wide violet haze and a tight hot pink glow. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"); glowBehind(x, B, src, 32 * E.k * (0.4 + a), 0.75 * a, [120, 60, 255]); glowBehind(x, B, src, 9 * E.k * (0.5 + a), Math.min(1, a * 1.6), CP.pink); } },
  { key: "vhs", name: { zh: "录像带", en: "Videotape" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 16 * k, r: 40 * k }),
    /** The layer as a worn tape plays it: its red smeared to the right and its blue to the left, a band slid sideways, scanlines across it. */
    paint(x, B, a, E) {
      const d = (2 + 8 * a) * E.k;
      rePlate(x, B, [[[255, 0, 0], d, 0], [[0, 255, 0], 0, 0], [[0, 0, 255], -d * 0.6, 0]]);
      const src = region(x, B, "fxA"), y = Math.round(B.h * (0.2 + 0.6 * E.R(5))), bh = Math.max(1, Math.round(B.h * (0.03 + 0.06 * a)));
      if (y + bh <= B.h) { x.clearRect(B.x0, B.y0 + y, B.w, bh); x.drawImage(src, 0, y, B.w, bh, B.x0 + (6 + 22 * a) * E.k, B.y0 + y, B.w, bh); }
      const p = Math.max(2, Math.round(3 * E.k));
      onLayer(x, B, region(x, B, "fxA"), "multiply", 0.45 * a, (g) => { g.fillStyle = "rgb(40,40,80)"; for (let yy = 0; yy < B.h; yy += p) g.fillRect(0, yy, B.w, Math.max(1, p / 3)); });
    } },
];
