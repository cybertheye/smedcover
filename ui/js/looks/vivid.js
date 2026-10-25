// summer illustration: a city in the clouds, in flat paint
// A saturated animated illustration of a summer's day: one flat, strong azure sky; towering cumulus built of lobe upon
// lobe, each lit from above in hard-edged planes — white, a pale tint, a periwinkle shade — with a fine
// indigo line along the lower edge of every lobe; coral-red towers with brass pipes, a skyline of
// signboards and lanterns, strings of pennants. Everything in flat colour with crisp edges and fine
// lines, never a gradient. Whites are clean, lines indigo, never black.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, boost, clamp, css, eachPixel, fall, fast, grain, gridPen, lum, mapped, mix, onLayer, painters, parseColour, rand, region, ringsBehind, role, rounded, shapeOf, shift, slantPath, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";

const VV = {
  navy: [22, 34, 96],              // the title's keyline and solid shadow, the plates' lines
  line: [50, 70, 166],             // the fine line of the illustration
  cream: [255, 250, 236],          // sunlit white of lettering and plates
  butter: [255, 220, 132],         // the lower part of sunlit lettering
  sky: [20, 106, 214],
  white: [255, 255, 255], pale: [214, 226, 252], shade: [152, 184, 240],   // a cloud, from the sun into shade
  red: [246, 96, 96], redLit: [255, 150, 140], redShade: [214, 54, 74],
  gold: [234, 176, 66], goldLit: [255, 222, 130], goldShade: [186, 120, 42],
  lit: [255, 247, 228], deep: [50, 66, 146],                               // the faces of objects: warm in the sun, cool out of it
};
const TOWN = [[252, 240, 220], [246, 96, 96], [70, 140, 226], [36, 64, 160], [250, 176, 172], [244, 246, 252], [234, 176, 66]];
const PENNANTS = [[246, 96, 96], [255, 250, 236], [70, 140, 226], [234, 176, 66], [250, 176, 172]];
/**
 * A billowing cumulus, painted as the animated films paint it but flat. Its body is rows of round lobes
 * narrowing toward the top. The light comes from the upper left, and is laid on the whole cloud at
 * once: the body in periwinkle shade, then every lobe again, moved toward the light, in a pale tint,
 * and again, further, in white — so neighbouring lobes merge into broad lit masses, and a crescent of
 * shade is left on the lower right of each. An indigo line runs round the cloud, along its flat base,
 * and in short strokes where some lobes meet the shade. (x, y): the middle of its flat base; s: its
 * half-width there; tall: its height in half-widths; k (with the seed) places the lobes.
 */
function billow(ctx, x, y, s, tall, k) {
  const lobes = [], rows = Math.max(2, Math.round(1.6 + tall * 1.7));
  for (let j = 0; j < rows; j++) {
    const t = rows === 1 ? 0 : j / (rows - 1), half = s * (1 - 0.62 * t) * (0.88 + rand(k + j * 1.9) * 0.24), cy = y - tall * s * (0.14 + 0.72 * t);
    const n = Math.max(1, Math.round(1.6 + 3.4 * (1 - t))), r0 = s * (0.26 + 0.1 * (1 - t));
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      lobes.push([x + u * half * 0.78 + (rand(k + j * 7.3 + i * 2.1) - 0.5) * s * 0.24, cy + (rand(k + j * 3.1 + i * 5.7) - 0.5) * s * 0.18, r0 * (0.66 + rand(k + j * 4.3 + i) * 0.66)]);
    }
  }
  // small lobes along the sides and the top, so the edge is broken into many bumps
  const big = lobes.length;
  for (let i = 0; i < 24; i++) {
    const [cx, cy, r] = lobes[Math.floor(rand(k + i * 9.7 + 50) * big)], a = -Math.PI * (rand(k + i * 2.9 + 51) * 1.0);
    lobes.push([cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84, r * (0.2 + rand(k + i * 4.1 + 52) * 0.16)]);
  }
  const lw = Math.max(1.5, s * 0.01);
  const body = (dx, dy, kr, grow = 0) => { ctx.beginPath(); for (const [cx, cy, r] of lobes) { const q = r * kr + grow; ctx.moveTo(cx + dx * r + q, cy + dy * r); ctx.arc(cx + dx * r, cy + dy * r, q, 0, TAU); } };
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4 * s, y - 8 * s, 8 * s, 8 * s); ctx.clip();   // the flat base
  body(0, 0, 1, lw); ctx.fillStyle = css(VV.line); ctx.fill();                  // the outline, under everything
  body(0, 0, 1); ctx.fillStyle = css(VV.shade); ctx.fill(); ctx.clip();
  body(-0.07, -0.13, 0.96); ctx.fillStyle = css(VV.pale); ctx.fill();
  body(-0.17, -0.29, 0.86); ctx.fillStyle = css(VV.white); ctx.fill();
  ctx.strokeStyle = css(VV.line); ctx.lineWidth = lw * 0.85; ctx.lineCap = "round";
  lobes.forEach(([cx, cy, r], i) => {   // short strokes where some lobes turn from the light into shade
    if (rand(k + i * 3.3 + 70) < 0.5) return;
    const a0 = Math.PI * (0.02 + rand(k + i * 1.7 + 71) * 0.2);
    ctx.beginPath(); ctx.arc(cx - r * 0.07, cy - r * 0.13, r * 0.96, a0, a0 + Math.PI * (0.3 + rand(k + i * 2.3 + 72) * 0.25)); ctx.stroke();
  });
  ctx.fillStyle = css(VV.shade); ctx.fillRect(x - 4 * s, y - s * 0.1, 8 * s, s * 0.1);   // the flat underside, in shade
  ctx.fillStyle = css(VV.line); ctx.fillRect(x - 4 * s, y - lw * 1.5, 8 * s, lw * 1.5);
  ctx.restore();
}
/**
 * A coral-red tower of the sky city, standing on the horizon at x: a cylinder in hard planes (a lit
 * strip, the body, the shaded side), ringed with bands, two of them brass; a drum and a dome on top
 * with a mast; a brass pipe climbing one side and turning into it. Fine indigo lines throughout.
 */
function skyTower(ctx, x, base, tw, th) {
  const top = base - th, l = x - tw / 2, lw = Math.max(1.6, tw * 0.025), line = css(VV.line);
  const band = (y0, y1, c, cl, cs) => { ctx.fillStyle = css(c); ctx.fillRect(l, y0, tw, y1 - y0); ctx.fillStyle = css(cl); ctx.fillRect(l + tw * 0.1, y0, tw * 0.14, y1 - y0); ctx.fillStyle = css(cs); ctx.fillRect(x + tw * 0.2, y0, tw * 0.3, y1 - y0); };
  band(top, base, VV.red, VV.redLit, VV.redShade);
  ctx.strokeStyle = line; ctx.lineWidth = lw;
  for (let i = 1; i < 8; i++) {
    const y = top + (th * i) / 8;
    if (i === 3 || i === 6) { band(y - tw * 0.05, y + tw * 0.05, VV.gold, VV.goldLit, VV.goldShade); ctx.strokeRect(l, y - tw * 0.05, tw, tw * 0.1); }
    else { ctx.beginPath(); ctx.moveTo(l, y); ctx.lineTo(l + tw, y); ctx.stroke(); }
  }
  ctx.strokeRect(l, top, tw, th);
  // the drum, the dome, the mast
  const dw = tw * 1.18, dh = tw * 0.22, dl = x - dw / 2;
  ctx.fillStyle = css(VV.redShade); ctx.fillRect(dl, top - dh, dw, dh); ctx.fillStyle = css(VV.red); ctx.fillRect(dl, top - dh, dw * 0.6, dh); ctx.strokeRect(dl, top - dh, dw, dh);
  ctx.beginPath(); ctx.arc(x, top - dh, tw * 0.42, Math.PI, 0); ctx.closePath(); ctx.fillStyle = css(VV.gold); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(x, top - dh, tw * 0.42, Math.PI, Math.PI * 1.45); ctx.lineTo(x, top - dh); ctx.closePath(); ctx.fillStyle = css(VV.goldLit); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x, top - dh - tw * 0.42); ctx.lineTo(x, top - dh - tw * 0.95); ctx.stroke();
  // the pipe: up the right side, turning into the tower twice
  const pw = tw * 0.16, px = x + tw / 2 + tw * 0.14, pipe = (rx, ry, rw, rh) => { ctx.fillStyle = css(VV.gold); ctx.fillRect(rx, ry, rw, rh); ctx.fillStyle = css(VV.goldLit); ctx.fillRect(rx + (rw > rh ? 0 : rw * 0.2), ry + (rw > rh ? rh * 0.2 : 0), rw > rh ? rw : rw * 0.25, rw > rh ? rh * 0.25 : rh); ctx.strokeRect(rx, ry, rw, rh); };
  pipe(px, top + th * 0.2, pw, th * 0.8);
  for (const f of [0.2, 0.62]) pipe(x + tw / 2 - lw, top + th * f, px - (x + tw / 2) + pw, pw);
}
/**
 * The sky city's street on the horizon `at(x)`: a row of houses of uneven width and height, each a
 * flat colour with a shaded side and windows, some with a tall signboard or a red lantern; fine
 * indigo lines. Their feet go below the horizon, behind the colour field. As `amt` goes up from 0
 * the row rises from behind the horizon (full by 0.3), then the houses grow taller.
 */
function skyline(ctx, w, h, amt, at0) {
  const u = Math.min(w, h), most = u * (0.07 + 0.1 * amt), sink = (1 - clamp(amt / 0.3)) * most * 1.25, at = (x) => at0(x) + sink;
  const line = css(VV.line), lw = Math.max(1.4, u * 0.0016);
  ctx.lineWidth = lw; ctx.strokeStyle = line; ctx.lineJoin = "miter";
  for (let x = -u * 0.02, i = 0; x < w + u * 0.02; i++) {
    const bw = u * (0.045 + rand(i * 2.7 + 91) * 0.07), bh = most * (0.32 + rand(i * 3.9 + 92) * 0.68), c = TOWN[Math.floor(rand(i * 5.1 + 93) * TOWN.length)];
    const x0 = x, x1 = x + bw, top = Math.min(at(x0), at(x1)) - bh, foot = (xx) => at(xx) + u * 0.06;
    shapeOf(ctx, [[x0, foot(x0)], [x0, top], [x1, top], [x1, foot(x1)]]); ctx.fillStyle = css(c); ctx.fill();
    ctx.fillStyle = css(mix(c, VV.navy, 0.24)); ctx.fillRect(x0 + bw * 0.7, top, bw * 0.3, Math.max(at(x0), at(x1)) - top + u * 0.06);
    shapeOf(ctx, [[x0, foot(x0)], [x0, top], [x1, top], [x1, foot(x1)]]); ctx.stroke();
    ctx.fillStyle = line; ctx.fillRect(x0 - bw * 0.06, top - lw * 2, bw * 1.12, lw * 3);   // the eave
    const ws = bw * 0.14, win = lum(c) > 0.6 ? css(VV.deep) : css(VV.cream);
    for (let r = 0; top + bw * 0.22 + r * ws * 2.2 < at(x0) - ws; r++) for (let q = 0; q < 3; q++) if (rand(i * 9 + r * 3 + q) > 0.3) { ctx.fillStyle = win; ctx.fillRect(x0 + bw * (0.12 + q * 0.2), top + bw * 0.22 + r * ws * 2.2, ws, ws * 1.3); }
    if (rand(i * 4.4 + 95) > 0.45 && bh > bw * 0.5) {   // a tall signboard: a colour, a border and three strokes of lettering
      const sw = bw * 0.22, sh = Math.min(bh * 0.8, sw * 4.2), sx = x0 + (rand(i * 6.1 + 96) > 0.5 ? -sw * 0.4 : bw - sw * 0.6), sy = top + bh * 0.08, red = rand(i * 7.7 + 97) > 0.4;
      ctx.fillStyle = css(red ? VV.red : VV.cream); ctx.fillRect(sx, sy, sw, sh); ctx.strokeRect(sx, sy, sw, sh);
      ctx.fillStyle = css(red ? VV.cream : VV.red); for (let q = 0; q < 3; q++) ctx.fillRect(sx + sw * 0.28, sy + sh * (0.12 + q * 0.28), sw * 0.44, sh * 0.16);
    }
    if (rand(i * 8.3 + 98) > 0.55) {   // a lantern under the eave
      const lr = bw * 0.1, lx = x0 + bw * (0.2 + rand(i * 2.2 + 99) * 0.6), ly = top + lr * 2.4;
      ctx.beginPath(); ctx.ellipse(lx, ly, lr, lr * 1.25, 0, 0, TAU); ctx.fillStyle = css(VV.red); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css(VV.cream); ctx.fillRect(lx - lr, ly - lr * 0.15, lr * 2, lr * 0.3);
    }
    x += bw * (0.86 + rand(i * 1.3 + 94) * 0.28);
  }
}
/**
 * Strings of pennants across the sky: a sagging line, small flags hanging from it in the city's
 * colours. `amt` (0–1) brings them in by degrees: the first string over the first half (its line
 * drawn in, its flags growing from small to full), the second over the other half.
 */
function pennants(ctx, w, top, amt) {
  const line = VV.line, step = Math.max(26, w / 60);
  for (let s = 0; s < 2; s++) {
    const r = clamp(amt * 2 - s);
    if (r <= 0) break;
    const y0 = top * (0.2 + 0.22 * s + rand(s * 7 + 101) * 0.1), y1 = y0 + (rand(s * 5 + 102) - 0.5) * top * 0.2, sag = top * (0.07 + rand(s * 3 + 103) * 0.05);
    const at = (t) => [-20 + (w + 40) * t, (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1];
    ctx.beginPath(); for (let t = 0; t <= 1.0001; t += 0.02) { const [x, y] = at(t); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.strokeStyle = css(line, Math.min(1, r * 3)); ctx.lineWidth = 1.8; ctx.stroke();
    const count = Math.ceil((w + 40) / step), wide = 0.3 + 0.4 * r, drop = step * (0.3 + 0.65 * r);
    ctx.strokeStyle = css(line);
    for (let i = 0; i < count; i++) {
      const [ax, ay] = at(i / count), [bx, by] = at((i + wide) / count), c = PENNANTS[(i + s * 2) % PENNANTS.length];
      shapeOf(ctx, [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2 + drop]]); ctx.fillStyle = css(c); ctx.fill(); ctx.lineWidth = 1.4; ctx.stroke();
    }
  }
}
export const vivid = {
  id: "vivid",
  repaint: (c) => `a saturated animated-film illustration of a city in the clouds, pushed to the bold colour of a travel poster: one flat, strong azure sky, towering billowing cumulus clouds painted in hard-edged planes of white, pale blue and periwinkle with fine indigo lines along each lobe, coral-red towers with brass pipes, signboards, lanterns and strings of pennants; every surface in flat, clean colour with crisp edges and fine lines, no gradients; bright and clear, with ${c} as an accent colour.`,
  about: { zh: "夏日的高饱和动画插画：一整块浓烈的天蓝天空，层层翻涌的巨大积云——每一团都是白、淡蓝、长春花蓝三块硬边平涂，再用细细的靛蓝线勾出轮廓；远处是珊瑚红的高塔和黄铜管道、挂着招牌和灯笼的街景，天上拉着成串的三角彩旗。全部是硬边平涂加细线，不用渐变。标题上白下暖黄，配深靛蓝勾边和实心立体投影；可加米白明信片边框，照片调得更鲜艳、更暖。饱和、明亮、细节丰富——适合旅行、城市漫步、生活、美食、节日与治愈系内容。", en: "A summer's day as a saturated animated illustration: one strong azure sky, huge billowing cumulus — every lobe in three hard-edged planes of white, pale blue and periwinkle, outlined in fine indigo — coral-red towers with brass pipes, a skyline of signboards and lanterns, strings of pennants across the sky. Flat colour and fine lines throughout, never a gradient. The title is white over warm yellow with an indigo keyline and a solid block shadow; a cream postcard border is optional, and photos are made more vivid and warmer. Saturated, bright and full of detail — for travel, city walks, everyday life, food, festivals and feel-good content." },
  name: { zh: "夏日插画", en: "Summer illustration" },
  oneTheme: true,              // always the azure sky: the light / dark choice does not apply
  seeded: true,                // clouds, towers, houses and pennants are placed at random: the Style tab offers to shuffle them
  scene: { cumulus: { zh: "积云", en: "Cumulus" }, towers: { zh: "高塔", en: "Towers" } },
  params: [
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "积云", en: "Cumulus" } },
    { key: "town", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "街景与高塔", en: "Town and towers" } },
    { key: "flags", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "彩旗", en: "Pennants" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "明信片边框", en: "Postcard border" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vivid", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "照片鲜艳度", en: "Photo vividness" } },
  ],
  theme: (base) => ({ ...base, field: css(VV.sky), text: css(VV.cream), dim: css(VV.cream, 0.72), titleFill: css(VV.cream), titleInk: css(VV.navy), grid: () => css(VV.white, 0.2) }),
  /**
   * One flat azure sky. With the background's decoration on, from the back: a tower or two of the sky
   * city, clouds massed round their feet and on both sides, the street on the horizon, and pennants.
   * The horizon is the top edge of the colour field when the field is below (it becomes the ground in
   * front), else the foot of the picture. A photo is laid over the sky and made more vivid: once more
   * over itself in soft light, its saturation pushed up, and the whole warmed as by late sun.
   */
  background(ctx, env, L, p) {
    const { w, h } = env;
    if (L.ground !== false) { ctx.fillStyle = css(VV.sky); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      if (p.vivid > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.55 * p.vivid; env.drawPhoto();
        ctx.globalCompositeOperation = "saturation"; ctx.globalAlpha = 0.32 * p.vivid; ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = 0.4 * p.vivid; ctx.fillStyle = css([255, 190, 104]); ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      return true;
    }
    if (!L.grid) return true;
    const E = env.G && env.G.edge, line = E && E.ny < 0 && E.line;
    const at = line ? (x) => line[1] + ((line[3] - line[1]) * (x - line[0])) / (line[2] - line[0] || 1) : () => h;
    const top = line ? Math.min(line[1], line[3]) : h * 0.9, u = Math.min(w, h), c = p.clouds, t = p.town;
    const ramp = (v, a, b) => clamp((v - a) / (b - a));
    const street = u * 0.1 * t, ground = (x) => at(x) - street;      // where clouds stand: behind the houses
    const room = (x) => ground(x) - Math.max(top * 0.24, 150);        // how tall a cloud may be there: clear of the brand row
    // A cloud comes in small and grows to its full size (`grow`, 0–1) as the slider passes its stretch,
    // so turning the slider up adds clouds one after another, the great masses first.
    // The clouds move together as a scene object, the towers as another.
    const mass = (fx, k, size, tall, grow) => { if (grow <= 0) return; const x = w * fx, s = Math.min(u * size * (0.1 + 0.9 * grow), room(x) / (0.86 * tall + 0.62)); if (s > u * 0.025) { ctx.save(); shift("cumulus", w * 0.5, top * 0.55, ctx); billow(ctx, x, ground(x), s, tall, k); ctx.restore(); } };
    // far off, behind the towers
    mass(0.36 + rand(131) * 0.24, 132, 0.1, 0.9, ramp(c, 0.25, 0.5));
    mass(0.26 + rand(133) * 0.1, 134, 0.16, 1.15, ramp(c, 0.4, 0.65));
    mass(0.5 + rand(135) * 0.1, 136, 0.12, 1.05, ramp(c, 0.55, 0.8));
    mass(0.4 + rand(137) * 0.1, 138, 0.13, 1.3, ramp(c, 0.85, 1));
    // The towers rise from behind the horizon as the slider goes up: the first from 0.3, full at 0.7;
    // the second from 0.65, full at 1. Their feet are hidden by the colour field and the houses.
    const t1 = ramp(t, 0.3, 0.7), t2 = ramp(t, 0.65, 1), tx = w * (0.58 + rand(141) * 0.12), tw = u * (0.05 + 0.02 * t), th = Math.max(u * 0.1, at(tx) - top * (0.3 - 0.12 * t));
    ctx.save(); if (t1 > 0) shift("towers", tx, at(tx) - th * 0.5, ctx);
    if (t2 > 0) { const sx = tx + w * (rand(142) > 0.5 ? 0.1 : -0.1), sw = tw * 0.7, sh = th * 0.62; skyTower(ctx, sx, at(sx) + (1 - t2) * (sh + sw * 1.6), sw, sh); }
    if (t1 > 0) skyTower(ctx, tx, at(tx) + (1 - t1) * (th + tw * 1.6), tw, th);
    ctx.restore();
    // near, in front of the towers: a great mass on each side, then more toward the edges
    mass(0.06 + rand(151) * 0.2, 152, 0.34, 1.5 + rand(153) * 0.4, ramp(c, 0, 0.4));
    mass(0.72 + rand(154) * 0.2, 155, 0.31, 1.7 + rand(156) * 0.5, ramp(c, 0.08, 0.5));
    mass(0.93 + rand(158) * 0.08, 159, 0.2, 1.3, ramp(c, 0.7, 0.9));
    mass(0.61 + rand(141) * 0.12, 157, 0.17, 0.85, Math.min(ramp(c, 0.15, 0.45), t1 * 2));   // round the tower's foot
    if (t > 0) skyline(ctx, w, h, t, at);
    if (p.flags > 0) pennants(ctx, w, top, p.flags);
    return true;
  },
  /** A festival lattice across the sky: fine lines on the slant both ways, crossing into diamonds as strings of pennants do. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, 0.5, 100); slantPath(ctx, w, h, -0.5, 100); ctx.restore();
  },
  accent: {
    fill: (C) => css(boost(C)),
    tone: () => "rgba(0,0,0,0)", toneScale: 0,     // flat: no screentone
    /** The edge of a sunlit field: a band of the colour in full light just inside it, and an indigo line on it. */
    edge(ctx, run, nx, ny, C) {
      ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.strokeStyle = css(mix(boost(C), VV.cream, 0.5)); ctx.lineWidth = 24; run(-nx * 12, -ny * 12);
      ctx.strokeStyle = css(VV.navy); ctx.lineWidth = 9; run(0, 0);
    },
  },
  /**
   * Upright lettering lit from above: warm white letters (highlighted words in the channel colour, made
   * vivid) whose lower part is in a warmer, deeper tone with a hard edge between, an indigo keyline, and
   * a solid indigo block below and to the right — the letters stepped down, not a soft shadow.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, line = fs * 0.085 * o.strokeAmt, depth = fs * 0.075 * o.shadowAmt;
    const face = o.fill || VV.cream, hiFace = o.hi || boost(o.C || VV.red);
    const lower = (c) => (c === VV.cream ? VV.butter : mix(c, VV.navy, 0.22));
    ctx.lineJoin = "round";
    if (depth > 0) {
      const steps = fast ? 3 : Math.max(2, Math.min(10, Math.round(depth / (fs * 0.009))));
      ctx.fillStyle = ctx.strokeStyle = css(VV.navy); ctx.lineWidth = line;
      for (let i = steps; i >= 1; i--) { const [dx, dy] = fall((depth * i) / steps, (depth * i) / steps); pass((a, x) => { if (line > 0) ctx.strokeText(a.t, x + dx, dy); ctx.fillText(a.t, x + dx, dy); }); }
    }
    if (line > 0) { ctx.strokeStyle = css(VV.navy); ctx.lineWidth = line; pass((a, x) => ctx.strokeText(a.t, x, 0)); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hiFace : face); ctx.fillText(a.t, x, 0); });
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -fs * 0.3, 2e5, fs); ctx.clip();
    pass((a, x) => { ctx.fillStyle = css(lower(a.hi ? hiFace : face)); ctx.fillText(a.t, x, 0); });
    ctx.restore();
  },
  /** The plate under a text layer: a rounded card with an indigo line and a hard indigo shadow. */
  plate(ctx, x, y, w, h, colour, fs) {
    const r = Math.min(h / 2, fs * 0.3), [dx, dy] = fall(fs * 0.08, fs * 0.08);
    ctx.beginPath(); rounded(ctx, x + dx, y + dy, w, h, r); ctx.fillStyle = css(VV.navy); ctx.fill();
    ctx.beginPath(); rounded(ctx, x, y, w, h, r); ctx.fillStyle = colour; ctx.fill();
    ctx.lineWidth = fs * 0.05; ctx.strokeStyle = css(VV.navy); ctx.stroke();
  },
  // objects are lit as the clouds are: warm cream in the sun, periwinkle in shade, indigo lines;
  // the small cover parts keep their construction and take the indigo and cream
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: VV.navy, light: VV.cream, colour: boost }, stroke: { ink: VV.navy, light: VV.cream } }
    : { fill: { ink: VV.navy, light: VV.lit, mid: VV.shade, dark: VV.deep, colour: boost }, stroke: { ink: VV.navy, light: VV.cream, colour: boost }, line: 0.9 }),
  sticker: painters({ line: VV.navy, lineScale: 0.8,
    tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const r = role(c); return css(r === "ink" ? VV.navy : r === "colour" ? boost(c) : r === "light" ? VV.cream : c, c[3]); },
    shadow(ctx, draw) { ctx.save(); ctx.translate(6, 7); draw(css(VV.navy, 0.55)); ctx.restore(); } }),
  /**
   * The corner tag: a cream pill, as the sign of a country bus stop, with an indigo line, a hard shadow,
   * and a dot of the channel colour before the lettering — it reads on the sky and on the field alike.
   */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 1.75, h = fs * 1.34, pill = ([dx, dy]) => { ctx.beginPath(); rounded(ctx, x + dx, y + dy, w, h, h / 2); };
    pill(fall(6, 6)); ctx.fillStyle = css(VV.navy); ctx.fill();
    pill([0, 0]); ctx.fillStyle = css(VV.cream); ctx.fill(); ctx.lineWidth = 4.5; ctx.strokeStyle = css(VV.navy); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + h * 0.52, y + h / 2, fs * 0.17, 0, TAU); ctx.fillStyle = css(boost(C)); ctx.fill(); ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = ink || css(VV.navy); spaced(ctx, str, x + h * 0.52 + fs * 0.42, y + h * 0.5 + fs * 0.36, 3);
    return { x: x - 6, y: y - 6, w: w + 18, h: h + 18 };
  },
  /** The frame layer: a cream postcard border with round inner corners and an indigo hairline round the picture. */
  frame(ctx, env, p) {
    const { w, h } = env, b = 40 * p.border;
    if (b < 1) return;
    const r = 12 + b * 0.8;
    ctx.beginPath(); ctx.rect(0, 0, w, h); rounded(ctx, b, b, w - 2 * b, h - 2 * b, r);
    ctx.fillStyle = css(VV.cream); ctx.fill("evenodd");
    ctx.beginPath(); rounded(ctx, b, b, w - 2 * b, h - 2 * b, r); ctx.lineWidth = 3; ctx.strokeStyle = css(VV.navy); ctx.stroke();
  },
  /** An uploaded image gets a hard indigo shadow, as stickers do. */
  image(ctx, C, unit) { ctx.shadowColor = css(VV.navy, 0.55); ctx.shadowBlur = 0; ctx.shadowOffsetX = 8 * unit; ctx.shadowOffsetY = 10 * unit; },
  /** Paper: the faint tooth of a poster or a gouache sheet. */
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.55, unit); },
  prompt: `Stickers for a saturated animated-film illustration of a sunny city in the clouds, drawn as a bold flat poster — friendly, clear and full of detail — that read at a glance:
- clean, characterful shapes with a clear silhouette (lanterns, signboards, pennants, clouds, fruit, small creatures, everyday things); simple and charming; no realism, no perspective, no fine texture;
- flat, saturated colour only — never gradients; the light comes from above: give a form one flat lit patch (a lighter tint, with "shadow": false) and one flat shaded patch (a cooler, deeper tint), with crisp edges between them;
- every shape automatically gets a deep indigo outline and a hard offset shadow: do NOT draw outlines or shadows yourself;
- 2 to 4 colours per sticker: the main colour with "white" (a warm cream), "red" (coral), "yellow" (brass) or "blue" (azure) as partners; "ink" comes out deep indigo — for small details only.`,
  solidPrompt: `Props and buildings from a saturated animated film set in a sunny city in the clouds — a tower, a kiosk, a lantern, a tram, a kettle — built as simple models from a few boxes and cylinders with friendly proportions; no realism, no fine detail.
- the renderer paints faces in the sun warm cream, faces in shade a periwinkle blue, and every edge deep indigo: do NOT try to draw shading or outlines yourself;
- "white" is warm cream, "dark" a deep indigo, and "main" the channel colour made more vivid — use it for one to three parts (a roof, a door, a body).`,
};
vivid.elementFx = [
  { key: "vivid", name: { zh: "照片鲜艳度", en: "Photo vividness" }, for: FX_PHOTO, stage: "filter",
    /** The photo as summer light shows it: its colours pushed further from grey, and warmed. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { const l = 0.3 * r + 0.59 * g + 0.11 * b; o[0] = clamp(l + (r - l) * 1.6 + 10, 0, 255); o[1] = clamp(l + (g - l) * 1.6 + 2, 0, 255); o[2] = clamp(l + (b - l) * 1.6 - 8, 0, 255); }); } },
];
vivid.elementFx.push({ key: "block", name: { zh: "日光立体", en: "Sunlit block" }, for: FX_ALL, stage: "behind", reach: (B, k) => { const d = Math.min(B.h * 0.12, 40 * k) + 6 * k; return { l: 6 * k, t: 6 * k, r: d, b: d }; },
  /** The layer stood up as a block: a solid navy depth down to the right and a navy outline, its lower part in warmer light, as summer lettering is. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxBlock"), k = E.k, depth = Math.min(B.h * 0.12, 40 * k) * a, line = 4 * k * a;
    onLayer(x, B, src, "multiply", 0.55 * a, (g) => { const gr = g.createLinearGradient(0, B.h * 0.5, 0, B.h * 0.6); gr.addColorStop(0, css(VV.butter, 0)); gr.addColorStop(1, css(VV.butter)); g.fillStyle = gr; g.fillRect(0, 0, B.w, B.h); });
    const steps = Math.max(2, Math.min(14, Math.round(depth / (2 * k))));
    ringsBehind(x, B, src, line > 0.3 ? [[VV.navy, line * 0.5], [VV.navy, line]] : [], depth > 0.3 ? [[VV.navy, Array.from({ length: steps }, (_, i) => [(depth * (i + 1)) / steps, (depth * (i + 1)) / steps]), x.globalAlpha]] : []);   // the outline, and the depth under it
  } });
