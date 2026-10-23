// dark deco: the Art Deco city by night, painted on black
// Gotham as the animated series of the 90s painted its backgrounds, and the deco posters after it:
// painted on black paper, so the dark is the ground and only the light is laid on — an ultramarine night,
// stepped towers lit by gold windows and floodlit from their setbacks, searchlights crossing, a moon
// barred by cloud, lavender fog between the rows, an airship, a neon blade sign; the floodlight in the
// channel's colour (the paintings' crimson); lettering as a theatre front's lit letters, tungsten lamps
// glowing warm, the highlighted words neon in the channel's colour. Gilded, black and gold.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, boost, canPaint, clamp, css, current, dkBox, dkFogBand, dkHsl, dkRgb, dkWork, every, fall, fast, grain, graphicShape, gridPath, gridPen, inPixels, inkAs, keepClear, keptLayer, lum, mapped, mix, neonTube, objAt, onLayer, openField, overlaps, painters, parseColour, placeShape, rand, region, rounded, seed, shapeIn, shapeOf, softCopy, starMark, titleArea, toneTable, tonesFx, upright, values, vignette } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { inPiece } from "../title.js";

const DK = { ink: [7, 6, 16], base: [12, 10, 28], cream: [255, 242, 214], gold: [240, 186, 88], amber: [255, 200, 108], pale: [255, 232, 168], crimson: [214, 28, 42] };
/** The night, top to horizon, at gilt g (0: Gotham's ultramarine, 1: black and gold), reddened by r toward Gotham's crimson sky. */
const dkSky = (g, r = 0) => [mix(mix([3, 3, 14], [5, 4, 3], g), [12, 2, 6], r), mix(mix([12, 11, 54], [14, 11, 8], g), [70, 6, 18], r), mix(mix([34, 30, 128], [36, 26, 16], g), [178, 18, 34], r), mix(mix([86, 64, 188], [96, 62, 30], g), [246, 70, 52], r)];
const dkFog = (g, r = 0) => mix(mix([128, 108, 226], [134, 104, 70], g), [236, 96, 96], r);
const dkMoonlight = (g) => mix([212, 210, 255], [255, 234, 198], g);
/** The channel colour as floodlight: vivid, and a blue made light enough to read as light on the night. */
export function dkSpot(C) { const c = boost(C, 0.7); return c[2] > c[0] && c[2] > c[1] ? mix(c, [236, 236, 255], clamp(0.55 - lum(c)) * 0.8) : c; }
/** Stars: pinpricks thicker toward the top, a few sparkles with four points; `n`, the last by degrees. */
function dkStars(ctx, F, bottom, n, g, k0) {
  const fw = F.x1 - F.x0, span = Math.max(1, bottom - F.y0), col = mix([196, 194, 255], [255, 236, 200], g);
  ctx.save();
  for (let i = 0; i < Math.ceil(n); i++) {
    const x = F.x0 + fw * rand(i * 1.3 + k0), y = F.y0 + span * rand(i * 2.7 + k0 + 1) ** 1.7, big = rand(i * 3.9 + k0 + 2) ** 7;
    ctx.globalAlpha = (0.3 + 0.7 * rand(i * 4.3 + k0 + 3)) * clamp(n - i);
    if (big > 0.4) starMark(ctx, x, y, 4 + big * 9, 4, col); else { ctx.fillStyle = css(col); ctx.beginPath(); ctx.arc(x, y, 0.7 + big * 3, 0, TAU); ctx.fill(); }
  }
  ctx.restore();
}
/** The moon: a halo, the disc lit from its upper left with a few soft seas, and flat bars of cloud across it, each with a lit rim. */
function dkMoon(ctx, x, y, r, g, sky, k) {
  const lt = dkMoonlight(g), halo = ctx.createRadialGradient(x, y, r * 0.9, x, y, r * 3.4);
  halo.addColorStop(0, css(lt, 0.3)); halo.addColorStop(0.35, css(lt, 0.08)); halo.addColorStop(1, css(lt, 0));
  ctx.fillStyle = halo; ctx.fillRect(x - r * 3.4, y - r * 3.4, r * 6.8, r * 6.8);
  const body = ctx.createLinearGradient(x - r, y - r, x + r, y + r); body.addColorStop(0, css(mix(lt, [255, 255, 255], 0.65))); body.addColorStop(1, css(mix(lt, sky[2], 0.3)));
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = body; ctx.fill(); ctx.clip();
  ctx.fillStyle = css(mix(lt, sky[2], 0.55), 0.2);
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.ellipse(x + (rand(k + i) - 0.45) * r * 1.3, y + (rand(k + i * 2.1 + 1) - 0.5) * r * 1.3, r * (0.12 + rand(k + i * 3.3) * 0.22), r * (0.1 + rand(k + i * 4.1) * 0.16), rand(k + i * 5.7) * 3, 0, TAU); ctx.fill(); }
  ctx.restore();
  const cl = mix(sky[1], sky[2], 0.35);
  for (let i = 0; i < 4; i++) {   // long thin bars of cloud drifting across it, tapering to points, the moon catching their upper edge
    const cy = y + r * (-0.75 + i * 0.5 + (rand(k + i * 6.1) - 0.5) * 0.2), len = r * (3 + rand(k + i * 7.3) * 3.5), th = r * (0.07 + rand(k + i * 8.9) * 0.09), cx = x + (rand(k + i * 9.7) - 0.5) * r * 3;
    const bar = (dy, colour) => { ctx.fillStyle = colour; ctx.beginPath(); ctx.moveTo(cx - len / 2, cy + dy); ctx.bezierCurveTo(cx - len * 0.2, cy - th * 1.3 + dy, cx + len * 0.1, cy - th + dy, cx + len / 2, cy + th * 0.2 + dy); ctx.bezierCurveTo(cx + len * 0.1, cy + th * 0.9 + dy, cx - len * 0.2, cy + th * 0.7 + dy, cx - len / 2, cy + dy); ctx.fill(); };
    if (Math.abs(cy - y) < r) bar(-Math.max(1.2, th * 0.35), css(lt, 0.55));
    bar(0, css(cl));
  }
}
/**
 * Searchlights: beams thrown up from behind the skyline round (sx, sy), leaning in turn one way and the
 * other so they cross; each a soft wide wedge with a brighter core, fading with its length, and the
 * glow of its lamp. Added with "lighter", so they brighten where they cross. `n`, the last by degrees.
 */
function dkBeams(ctx, F, sx, sy, n, g, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, L = Math.hypot(fw, fh) * 1.05, col = mix([168, 168, 255], [255, 236, 204], g), m = Math.ceil(n);
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < m; i++) {
    const a = clamp(n - i), x = sx + (i - (m - 1) / 2) * fw * 0.13 + (rand(k0 + i) - 0.5) * fw * 0.06, ang = -Math.PI / 2 + (i % 2 ? -1 : 1) * (0.12 + rand(k0 + i * 2.3 + 1) * 0.42), ex = Math.cos(ang), ey = Math.sin(ang);
    for (const [spread, al] of [[0.07, 0.12], [0.03, 0.22], [0.012, 0.4]]) {
      const gr = ctx.createLinearGradient(x, sy, x + ex * L, sy + ey * L); gr.addColorStop(0, css(col, al * a)); gr.addColorStop(0.45, css(col, al * a * 0.45)); gr.addColorStop(1, css(col, 0));
      const s = spread * (0.7 + rand(k0 + i * 3.7) * 0.6);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x - ey * 2, sy + ex * 2); ctx.lineTo(x + Math.cos(ang - s) * L, sy + Math.sin(ang - s) * L); ctx.lineTo(x + Math.cos(ang + s) * L, sy + Math.sin(ang + s) * L); ctx.lineTo(x + ey * 2, sy - ex * 2); ctx.fill();
    }
    const lamp = ctx.createRadialGradient(x, sy, 0, x, sy, fh * 0.07); lamp.addColorStop(0, css(col, 0.7 * a)); lamp.addColorStop(1, css(col, 0));
    ctx.fillStyle = lamp; ctx.fillRect(x - fh * 0.07, sy - fh * 0.07, fh * 0.14, fh * 0.14);
  }
  ctx.restore();
}
/**
 * A row of the city, its feet at `base`: towers of setbacks, a few of them (R.tall) rising far above the
 * rest, each crowned in one of the deco ways — a needle, a crown of stacked arches pricked with lit
 * triangles, a mast with its red light, a stepped pyramid; the side away from the night a shade lighter.
 * Windows in vertical bands, lit in runs (`lit` of them), gold; with `flood`, pilasters lit from below in
 * the floodlight's colour, fading up the face, and the tall ones' crowns washed with it. R: the row's sizes and tone.
 */
function dkRow(ctx, F, top, base, R, lit, flood, spot, g, k0) {
  const fw = F.x1 - F.x0, H = Math.max(10, base - top), u = Math.min(fw, F.y1 - F.y0), wins = new Map(), lights = [], reds = [], moon = dkMoonlight(g);
  const add = (c, x, y, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, y, w, h); };
  const GOLD = [DK.amber, DK.amber, DK.amber, DK.pale, DK.pale, DK.gold, [255, 228, 190], mix(DK.amber, spot, 0.5)];
  for (let x = F.x0 - u * 0.04, i = 0; x < F.x1 + u * 0.02; i++) {
    const kk = k0 + i * 7.9, tall = rand(kk + 9) < (R.tall || 0), bw = u * (R.w[0] + rand(kk) * R.w[1]) * (tall ? 1.2 : 1), bh = H * (tall ? 0.82 + rand(kk + 1) * 0.18 : R.h[0] + rand(kk + 1) ** 1.6 * R.h[1]);
    const kind = Math.floor(rand(kk + 2) * 5), nt = R.tiers ? (tall ? 3 : 1 + Math.floor(rand(kk + 3) * 3)) : 1, side = mix(R.body, R.rim, 0.14), tiers = [];
    let y = base, tw = bw;
    for (let t = 0; t < nt; t++) { const th = nt === 1 ? bh : t === 0 ? bh * 0.6 : (bh * 0.4) / (nt - 1); tiers.push([x + (bw - tw) / 2, y - th, tw, th]); y -= th; tw *= 0.74; }
    for (const [tx, ty, w, h] of tiers) { ctx.fillStyle = css(R.body); ctx.fillRect(tx, ty, w, h + 1); ctx.fillStyle = css(side); ctx.fillRect(tx + w * 0.8, ty, w * 0.2, h + 1); }
    const [cx0, cy0, cw] = tiers[tiers.length - 1], mid = cx0 + cw / 2, tip = tall ? bw * 1.6 : bw * 0.9;
    ctx.fillStyle = css(R.body);
    if (kind === 0) { shapeOf(ctx, [[mid - cw * 0.28, cy0 + 1], [mid, cy0 - tip * (1 + rand(kk + 4))], [mid + cw * 0.28, cy0 + 1]]); ctx.fill(); }   // a needle
    else if (kind === 1) {   // a crown of stacked arches, lit triangles in each, and a needle
      let ay = cy0, aw = cw * 0.92;
      for (let j = 0; j < 4; j++) {
        const ah = aw * 0.42;
        ctx.fillStyle = css(R.body); ctx.beginPath(); ctx.moveTo(mid - aw / 2, ay + 1); ctx.lineTo(mid - aw / 2, ay - ah * 0.3); ctx.ellipse(mid, ay - ah * 0.3, aw / 2, ah * 0.7, 0, Math.PI, TAU); ctx.lineTo(mid + aw / 2, ay + 1); ctx.fill();
        if (!R.pin) for (let q = -2; q <= 2; q++) { const a = Math.PI * (1.5 + q * 0.17), tx = mid + Math.cos(a) * aw * 0.36, ty = ay - ah * 0.3 + Math.sin(a) * ah * 0.5; if (rand(kk + j * 3.1 + q) < 0.3 + lit * 0.7) lights.push([tx, ty, aw * 0.07]); }
        ay -= ah * 0.62; aw *= 0.72;
      }
      ctx.fillStyle = css(R.body); shapeOf(ctx, [[mid - aw * 0.3, ay + 2], [mid, ay - tip], [mid + aw * 0.3, ay + 2]]); ctx.fill();
    } else if (kind === 2) { ctx.fillRect(mid - cw * 0.3, cy0 - bh * 0.06, cw * 0.6, bh * 0.06 + 1); ctx.fillRect(mid - Math.max(0.8, cw * 0.035), cy0 - bh * 0.06 - tip, Math.max(1.6, cw * 0.07), tip); reds.push([mid, cy0 - bh * 0.06 - tip]); }   // a mast
    else if (kind === 3) { for (let j = 1, sw = cw; j <= 3; j++) { sw *= 0.72; ctx.fillRect(mid - sw / 2, cy0 - bw * 0.09 * j, sw, bw * 0.09 + 1); } }   // a stepped pyramid
    if (tall && !R.pin) { ctx.fillStyle = css(moon, 0.35); for (const [tx, ty, w, h] of tiers) ctx.fillRect(tx + w - Math.max(1, w * 0.02), ty, Math.max(1, w * 0.02), h); }   // the moon's edge down its far side
    // windows in vertical bands, lit in runs of a few floors; the far row only pinpricks of light
    for (const [tx, ty, w, h] of tiers) {
      const ws = Math.max(1.2, w * (R.pin ? 0.07 : 0.06)), wh = R.pin ? ws : ws * 1.3, pitch = ws * (R.pin ? 2.2 : 2.5), cols = Math.max(1, Math.floor((w * 0.72) / pitch)), gx = (w * 0.8 - cols * pitch) / 2 + (pitch - ws) / 2;
      for (let r = 0, yy = ty + w * 0.08; yy < ty + h - wh * 1.5; r++, yy += wh * (R.pin ? 2.6 : 1.75)) for (let q = 0; q < cols; q++) {
        if (rand(kk * 3.3 + Math.floor(r / 3) * 1.37 + q * 0.191) < lit * R.litK && rand(kk + r * 0.71 + q * 2.3) < 0.85) add(GOLD[Math.floor(rand(kk + Math.floor(r / 3) * 2.9 + q * 5.3) * GOLD.length)], tx + gx + q * pitch, yy, ws, wh);
      }
    }
    // floodlight: pilasters lit from the foot of each tier, fading up its face, a wash over it; a tall one's crown washed too
    if (R.flood && flood > 0 && (tall || rand(kk + 6) < flood * 0.8)) {
      const n = 3 + Math.floor(rand(kk + 7) * 3);
      tiers.forEach(([tx, ty, w, h], t) => {
        const gr = ctx.createLinearGradient(0, ty + h, 0, ty + h - h * (0.55 + 0.45 * flood)), pw = Math.max(1, w * 0.035);
        gr.addColorStop(0, css(mix(spot, [255, 255, 255], 0.3), Math.min(1, 0.4 + flood))); gr.addColorStop(0.35, css(spot, 0.55 * Math.min(1, flood * 1.5))); gr.addColorStop(1, css(spot, 0));
        ctx.fillStyle = gr;
        for (let q = 0; q <= n; q++) ctx.fillRect(tx + w * 0.8 * (q / n) - pw / 2, ty, pw, h);
        ctx.globalAlpha = 0.22; ctx.fillRect(tx, ty, w, h); ctx.globalAlpha = 1;
        if (t === tiers.length - 1 && tall) { const cg = ctx.createRadialGradient(mid, ty, 0, mid, ty, w * 1.4); cg.addColorStop(0, css(spot, 0.45 * flood)); cg.addColorStop(1, css(spot, 0)); ctx.fillStyle = cg; ctx.fillRect(mid - w * 1.4, ty - w * 1.4, w * 2.8, w * 1.4); }
      });
    }
    x += bw * (0.84 + rand(kk + 8) * 0.24);
  }
  for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
  ctx.fillStyle = css(DK.amber); ctx.beginPath();
  for (const [x, y, s] of lights) { ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.6, y + s * 0.5); ctx.lineTo(x - s * 0.6, y + s * 0.5); ctx.closePath(); }
  ctx.fill();
  for (const [x, y] of reds) { ctx.fillStyle = css(DK.crimson, 0.3); ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); ctx.fillStyle = css([255, 120, 120]); ctx.beginPath(); ctx.arc(x, y, 1.5, 0, TAU); ctx.fill(); }
}
/**
 * The great tower: a ziggurat of setbacks rising to a needle with a red beacon. Each tier black, its side
 * a shade lighter; gold windows between pilasters floodlit from the ledge below; on every ledge a gold
 * sunburst lamp throwing its light up the next tier. (cx, base): the middle of its foot; H, W: its size.
 */
function dkTower(ctx, cx, base, H, W, lit, flood, spot, g, sky, k) {
  const TIERS = [[1, 0.34], [0.78, 0.2], [0.6, 0.14], [0.44, 0.1], [0.3, 0.07]], moon = dkMoonlight(g), body = mix(sky[1], [0, 0, 0], 0.72), side = mix(body, moon, 0.1), tiers = [];
  let y = base;
  for (const [wf, hf] of TIERS) { const w = W * wf, h = H * hf; tiers.push([cx - w / 2, y - h, w, h]); y -= h; }
  const top = y, wins = new Map(), add = (c, x, yy, w, h) => { const key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x, yy, w, h); };
  tiers.forEach(([x, ty, w, h], i) => {
    ctx.fillStyle = css(body); ctx.fillRect(x, ty, w, h + 1);
    ctx.fillStyle = css(side); ctx.fillRect(x + w * 0.78, ty, w * 0.22, h + 1);
    ctx.fillStyle = css(moon, 0.45); ctx.fillRect(x + w - Math.max(1, w * 0.012), ty, Math.max(1, w * 0.012), h);   // the moon along its far edge
    const n = 5 + (i < 2 ? 2 : 0), bay = (w * 0.78) / n, ws = Math.max(1.2, bay * 0.24), wh = ws * 1.6;
    for (let q = 0; q < n; q++) for (let r = 0, yy = ty + h * 0.06; yy < ty + h - wh * 2; r++, yy += wh * 1.8) if (rand(k + i * 13.1 + q * 3.7 + Math.floor(r / 2) * 1.9) < lit) add(rand(k + i * 5.3 + q + r * 7.1) < 0.7 ? DK.amber : DK.pale, x + q * bay + bay * 0.5 - ws / 2, yy, ws, wh);
    if (flood > 0) {   // floodlit from this tier's foot: a wash up the face, and the pilasters bright
      const wash = ctx.createLinearGradient(0, ty + h, 0, ty + h * 0.2); wash.addColorStop(0, css(spot, 0.42 * flood)); wash.addColorStop(1, css(spot, 0));
      ctx.fillStyle = wash; ctx.fillRect(x, ty, w * 0.78, h);
      const gr = ctx.createLinearGradient(0, ty + h, 0, ty + h - h * (0.5 + 0.5 * flood)); gr.addColorStop(0, css(mix(spot, [255, 255, 255], 0.45), Math.min(1, 0.3 + flood * 1.2))); gr.addColorStop(0.3, css(spot, Math.min(1, flood * 1.3))); gr.addColorStop(1, css(spot, 0));
      ctx.fillStyle = gr; for (let q = 0; q <= n; q++) ctx.fillRect(x + q * bay - Math.max(0.8, bay * 0.07), ty, Math.max(1.6, bay * 0.14), h);
    }
  });
  for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
  // the crown and the needle
  ctx.fillStyle = css(body); shapeOf(ctx, [[cx - W * 0.1, top + 1], [cx - W * 0.1, top - H * 0.04], [cx - W * 0.03, top - H * 0.07], [cx, top - (base - top) * 0.32 - H * 0.05], [cx + W * 0.03, top - H * 0.07], [cx + W * 0.1, top - H * 0.04], [cx + W * 0.1, top + 1]]); ctx.fill();
  const tipY = top - (base - top) * 0.32 - H * 0.05, bg = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, W * 0.12);
  bg.addColorStop(0, css(DK.crimson, 0.7)); bg.addColorStop(1, css(DK.crimson, 0)); ctx.fillStyle = bg; ctx.fillRect(cx - W * 0.12, tipY - W * 0.12, W * 0.24, W * 0.24);
  ctx.fillStyle = css([255, 150, 150]); ctx.beginPath(); ctx.arc(cx, tipY, Math.max(1.5, W * 0.012), 0, TAU); ctx.fill();
  // a sunburst lamp on every ledge, its light thrown up the tier above
  for (let i = 1; i < tiers.length; i++) {
    const [x, ty, w, h] = tiers[i], ly = ty + h, R = Math.min(W * 0.13, tiers[i - 1][3] * 0.5) * (1 - i * 0.1);
    for (const lx of [x + w * 0.39, ...(i < 3 ? [x - (tiers[i - 1][2] - w) * 0.25, x + w + (tiers[i - 1][2] - w) * 0.25] : [])]) {
      const up = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 2.6); up.addColorStop(0, css(DK.amber, 0.55)); up.addColorStop(0.5, css(DK.gold, 0.14)); up.addColorStop(1, css(DK.gold, 0));
      ctx.fillStyle = up; ctx.beginPath(); ctx.arc(lx, ly, R * 2.6, Math.PI, TAU); ctx.fill();
      ctx.strokeStyle = css(DK.pale, 0.9); ctx.lineWidth = Math.max(0.8, R * 0.05); ctx.beginPath();
      for (let q = 0; q <= 8; q++) { const a = Math.PI + (q / 8) * Math.PI; ctx.moveTo(lx + Math.cos(a) * R * 0.18, ly + Math.sin(a) * R * 0.18); ctx.lineTo(lx + Math.cos(a) * R, ly + Math.sin(a) * R); }
      ctx.stroke();
      ctx.fillStyle = css([255, 248, 226]); ctx.beginPath(); ctx.arc(lx, ly, R * 0.16, Math.PI, TAU); ctx.fill();
    }
  }
}
/**
 * An airship: a cigar of a hull lit by the moon from above and by the city's glow from below, dark between,
 * its ribs showing; fins at its tail, a gondola with lit windows and a red light at its nose; it sweeps a
 * searchlight down ahead of it. (x, y): its middle; s: its length; it faces left.
 */
function dkAirship(ctx, x, y, s, g, sky, spot, a) {
  const rx = s / 2, ry = s * 0.13, lt = dkMoonlight(g), dark = mix(sky[1], [0, 0, 0], 0.55);
  ctx.save(); ctx.globalAlpha = a;
  const bc = mix([168, 168, 255], [255, 236, 204], g), gx = x - rx * 0.15, gy = y + ry * 1.3, bm = ctx.createLinearGradient(gx, gy, gx - s * 0.3, gy + s * 1.1);
  bm.addColorStop(0, css(bc, 0.35)); bm.addColorStop(1, css(bc, 0));
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = bm; shapeOf(ctx, [[gx + 2, gy], [gx - s * 0.62, gy + s * 1.1], [gx - s * 0.05, gy + s * 1.25], [gx - 2, gy]]); ctx.fill(); ctx.restore();
  ctx.fillStyle = css(dark);   // the fins, at the tail (right)
  for (const sy of [-1, 1]) { shapeOf(ctx, [[x + rx * 0.55, y + sy * ry * 0.3], [x + rx * 0.98, y + sy * ry * 1.7], [x + rx * 1.06, y + sy * ry * 1.6], [x + rx * 0.98, y + sy * ry * 0.1]]); ctx.fill(); }
  const hull = () => { ctx.beginPath(); ctx.moveTo(x - rx, y); ctx.bezierCurveTo(x - rx, y - ry * 1.35, x + rx * 0.35, y - ry * 1.2, x + rx, y - ry * 0.15); ctx.lineTo(x + rx, y + ry * 0.15); ctx.bezierCurveTo(x + rx * 0.35, y + ry * 1.2, x - rx, y + ry * 1.35, x - rx, y); ctx.closePath(); };
  const gr = ctx.createLinearGradient(0, y - ry, 0, y + ry);
  gr.addColorStop(0, css(mix(lt, [255, 255, 255], 0.3))); gr.addColorStop(0.22, css(mix(lt, sky[2], 0.45))); gr.addColorStop(0.55, css(dark)); gr.addColorStop(0.85, css(dark)); gr.addColorStop(1, css(mix(dark, spot, 0.45)));
  ctx.fillStyle = gr; hull(); ctx.fill();
  ctx.save(); hull(); ctx.clip();
  ctx.strokeStyle = css(DK.ink, 0.45); ctx.lineWidth = Math.max(0.6, s * 0.004); ctx.beginPath();
  for (let i = 1; i < 10; i++) { const px = x - rx + (s * i) / 10; ctx.moveTo(px, y - ry * 1.3); ctx.quadraticCurveTo(px - s * 0.025, y, px, y + ry * 1.3); }
  ctx.moveTo(x - rx, y + ry * 0.1); ctx.lineTo(x + rx, y + ry * 0.1);
  ctx.stroke(); ctx.restore();
  ctx.fillStyle = css(dark); ctx.beginPath(); rounded(ctx, gx - s * 0.08, y + ry * 0.92, s * 0.16, ry * 0.42, ry * 0.18); ctx.fill();
  ctx.fillStyle = css(DK.amber); for (let i = 0; i < 6; i++) ctx.fillRect(gx - s * 0.065 + i * s * 0.022, y + ry * 1.02, s * 0.011, ry * 0.18);
  ctx.fillStyle = css([255, 110, 110]); ctx.beginPath(); ctx.arc(x - rx * 0.99, y, Math.max(1.2, s * 0.008), 0, TAU); ctx.fill();
  ctx.restore();
}
/** A blade sign standing off a wall: a black slab under a stepped crown, framed in neon tube, its letters stacked down it in neon. (x, y): the middle of its top; bw: its width. */
function dkSign(ctx, x, y, bw, word, spot, a) {
  const chars = [...word].filter((c) => c.trim()).slice(0, 8), n = Math.max(1, chars.length), fs = bw * 0.62, step = fs * 1.02, bh = n * step + bw * 0.42, lw = Math.max(1, bw * 0.035), hot = mix(spot, [255, 255, 255], 0.55);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(DK.ink); ctx.fillRect(x + bw * 0.5, y + bw * 0.4, bw * 0.4, bw * 0.08); ctx.fillRect(x + bw * 0.5, y + bh - bw * 0.5, bw * 0.4, bw * 0.08);   // the brackets to the wall
  shapeOf(ctx, [[x - bw / 2, y + bh], [x - bw / 2, y], [x - bw * 0.3, y], [x - bw * 0.3, y - bw * 0.16], [x - bw * 0.12, y - bw * 0.16], [x - bw * 0.12, y - bw * 0.32], [x + bw * 0.12, y - bw * 0.32], [x + bw * 0.12, y - bw * 0.16], [x + bw * 0.3, y - bw * 0.16], [x + bw * 0.3, y], [x + bw / 2, y], [x + bw / 2, y + bh]]); ctx.fill();
  ctx.beginPath(); ctx.rect(x - bw / 2 + lw * 2.5, y + lw * 2.5, bw - lw * 5, bh - lw * 5); neonTube(ctx, spot, lw);
  ctx.beginPath(); ctx.moveTo(x - bw * 0.1, y - bw * 0.2); ctx.lineTo(x + bw * 0.1, y - bw * 0.2); neonTube(ctx, DK.amber, lw * 0.8);
  ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  chars.forEach((c, i) => {
    const cy = y + bw * 0.22 + step * (i + 0.5);
    for (const [k, al] of [[0.3, 0.12], [0.14, 0.35]]) { ctx.strokeStyle = css(spot, al); ctx.lineWidth = fs * k; ctx.strokeText(c, x, cy); }
    ctx.fillStyle = css(hot); ctx.fillText(c, x, cy);
  });
  ctx.restore();
}
/** Rain: fine slanted streaks over the field, a few longer and brighter where they catch the light; `a` (0–1) sets how many and how heavy. */
function dkRain(ctx, F, a, g, k0) {
  if (a <= 0) return;
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), n = Math.round(60 + 900 * a), dx = 0.18, col = mix([200, 204, 255], [255, 236, 210], g);
  ctx.save(); ctx.lineCap = "round";
  for (const [al, lw, from, to] of [[0.16, 1, 0, 0.75], [0.3, 1.4, 0.75, 0.95], [0.55, 1.8, 0.95, 1]]) {
    ctx.strokeStyle = css(col, al * Math.min(1, 0.4 + a)); ctx.lineWidth = Math.max(0.6, lw * u * 0.0011); ctx.beginPath();
    for (let i = Math.floor(n * from); i < Math.floor(n * to); i++) {
      const x = F.x0 + (fw + fh * dx) * rand(k0 + i * 1.31) - fh * dx, y = F.y0 + fh * rand(k0 + i * 2.17), l = u * (0.02 + 0.06 * rand(k0 + i * 3.7)) * (1 + (i / n) * 0.6);
      ctx.moveTo(x, y); ctx.lineTo(x + l * dx, y + l);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/**
 * The proscenium: the field framed as a deco arch — a black mass round an opening whose corners step in,
 * two gold rules along its edge, a sunburst keystone at its head. The side the colour block is on stays
 * open. `amt` (0–1) thickens it.
 */
function dkArch(ctx, F, amt, gold, u) {
  if (amt <= 0) return;
  const side = F.side, open = { left: side === "left", right: side === "right", top: side === "above", bottom: side === "below" };
  const m = u * (0.012 + 0.045 * amt), mt = Math.min(m, 44), s = u * (0.012 + 0.012 * amt), n = 3;
  const path = (d) => {
    const X0 = open.left ? F.x0 - 4 : F.x0 + m + d, X1 = open.right ? F.x1 + 4 : F.x1 - m - d, Y0 = open.top ? F.y0 - 4 : F.y0 + mt + d, Y1 = open.bottom ? F.y1 + 4 : F.y1 - m - d, pts = [];
    const corner = (cx, cy, ix, iy, vfirst, on) => {
      if (!on) { pts.push([cx, cy]); return; }
      const seq = [[cx, cy + iy * n * s]];
      for (let j = 1; j <= n; j++) seq.push([cx + ix * j * s, cy + iy * (n - j + 1) * s], [cx + ix * j * s, cy + iy * (n - j) * s]);
      pts.push(...(vfirst ? seq : seq.reverse()));
    };
    corner(X0, Y0, 1, 1, true, !open.left && !open.top);
    corner(X1, Y0, -1, 1, false, !open.right && !open.top);
    corner(X1, Y1, -1, -1, true, !open.right && !open.bottom);
    corner(X0, Y1, 1, -1, false, !open.left && !open.bottom);
    return pts;
  };
  ctx.save();
  ctx.fillStyle = css(DK.ink, Math.min(1, amt * 2.5) * 0.94); ctx.beginPath(); ctx.rect(F.x0, F.y0, F.x1 - F.x0, F.y1 - F.y0);
  path(0).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill("evenodd");
  ctx.lineJoin = "miter"; ctx.strokeStyle = css(gold, Math.min(1, amt * 3));
  for (const [d, lw] of [[-u * 0.004, Math.max(1.5, u * 0.0035)], [u * 0.009, Math.max(1, u * 0.0018)]]) { shapeOf(ctx, path(d)); ctx.lineWidth = lw; ctx.stroke(); }
  if (!open.top) {   // the keystone: a half sunburst hanging from the head of the arch
    const kx = (F.x0 + F.x1) / 2, ky = F.y0 + mt - u * 0.004, R = Math.min(mt * 1.1, u * (0.02 + 0.025 * amt));
    ctx.fillStyle = css(DK.ink); ctx.beginPath(); ctx.arc(kx, ky, R, 0, Math.PI); ctx.fill();
    ctx.lineWidth = Math.max(1, u * 0.0025); ctx.beginPath(); ctx.arc(kx, ky, R, 0, Math.PI);
    for (let q = 0; q <= 10; q++) { const a = (q / 10) * Math.PI; ctx.moveTo(kx + Math.cos(a) * R * 0.25, ky + Math.sin(a) * R * 0.25); ctx.lineTo(kx + Math.cos(a) * R * 0.92, ky + Math.sin(a) * R * 0.92); }
    ctx.stroke();
  }
  ctx.restore();
}
/** For each lightness, the night's tone: the shadows crushed toward black, as on a painting done on black paper. */
const DK_CURVE = (() => {
  const out = new Uint8Array(256);
  for (let l = 0; l < 256; l++) {
    const t = clamp((l / 255 - 0.06) / 0.9), sc = t * t * (3 - 2 * t), v = 0.45 * t ** 1.5 + 0.55 * sc;
    let q = 0; for (let j = 1; j < 6; j++) { const e = clamp((v - j / 6 + 0.04) / 0.08); q += (e * e * (3 - 2 * e)) / 5; }   // six flat tones, their edges soft
    out[l] = Math.round(255 * (0.55 * q + 0.45 * v));
  }
  return out;
})();
/** The ramp a photo is painted into, by lightness: black, the deep night, ultramarine, violet, moonlight, cream (gilt: black, umber, bronze, gold, cream). */
const dkRamp = (g) => toneTable([[0, mix([2, 2, 8], [3, 2, 1], g)], [0.26, mix([10, 9, 44], [24, 15, 7], g)], [0.5, mix([34, 30, 136], [90, 56, 20], g)], [0.7, mix([96, 78, 208], [176, 116, 44], g)], [0.88, mix([190, 184, 255], [244, 200, 124], g)], [1, DK.cream]]);
/**
 * RGBA pixels painted as Gotham's night, mixed in by a: the lightness crushed and mapped onto the night's
 * ramp, while strong warm colours keep their warmth — reds turn crimson, oranges and yellows gold, as the
 * paintings keep their red planes and lit windows in a blue night. Alpha kept. With `byValue` the ramp is
 * read by the brightest channel instead, uncrushed: a picture already in the night's blues then stays
 * much as it is (a photo layer the look has graded, given the effect as well).
 */
export function dkPixels(d, a, g, byValue = false) {
  const lut = dkRamp(g);
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], gg = d[i + 1], b = d[i + 2], l = byValue ? (r > gg ? (r > b ? r : b) : gg > b ? gg : b) : DK_CURVE[(r * 54 + gg * 183 + b * 19) >> 8], j = l * 3;
    let R = lut[j], G = lut[j + 1], B = lut[j + 2];
    const mx = r > gg ? (r > b ? r : b) : gg > b ? gg : b, mn = r < gg ? (r < b ? r : b) : gg < b ? gg : b, s = mx ? (mx - mn) / mx : 0;
    const wv = r > b ? clamp(((r - b) / (mx + 1)) * 1.6) * clamp(s * 2 - 0.25) * clamp(mx / 90) : 0;
    if (wv > 0) {
      const y = clamp((gg - b) / (r - b + 1)), k = 0.35 + (l / 255) * 1.1;
      R += (Math.min(255, (DK.crimson[0] + (DK.amber[0] - DK.crimson[0]) * y) * k) - R) * wv;
      G += (Math.min(255, (DK.crimson[1] + (DK.amber[1] - DK.crimson[1]) * y) * k) - G) * wv;
      B += (Math.min(255, (DK.crimson[2] + (DK.amber[2] - DK.crimson[2]) * y) * k) - B) * wv;
    }
    d[i] = r + (R - r) * a; d[i + 1] = gg + (G - gg) * a; d[i + 2] = b + (B - b) * a;
  }
}
/**
 * Halation: the lights bleed into the dark around them, as on film. A soft copy of the picture with only
 * its brightest parts kept (multiplied by itself twice) is laid on in screen. Left out while dragging.
 */
function dkBloom(ctx, amt) {
  if (amt <= 0 || fast || !canPaint(ctx)) return;
  const cv = ctx.canvas, soft = softCopy(cv, 10, "dkBloom"), x = soft.getContext("2d");
  x.globalCompositeOperation = "multiply"; x.drawImage(soft, 0, 0); x.drawImage(soft, 0, 0);
  inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = Math.min(1, amt * 1.4); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
}
/** The silhouette of the channel graphic, standing black against a pool of the floodlight behind it, with rims of light: the floodlight on one side, the moon on the other. */
function dkFigure(ctx, S, cx, cy, size, spot, g, a) {
  const d = size * 0.016, R = size * 0.95, gl = ctx.createRadialGradient(cx, cy - size * 0.15, 0, cx, cy - size * 0.15, R);
  gl.addColorStop(0, css(mix(spot, [255, 255, 255], 0.3), 0.75 * a)); gl.addColorStop(0.45, css(spot, 0.32 * a)); gl.addColorStop(1, css(spot, 0));
  ctx.save(); ctx.fillStyle = gl; ctx.fillRect(cx - R, cy - size * 0.15 - R, R * 2, R * 2); ctx.globalAlpha = a;
  placeShape(ctx, S, mix(spot, [255, 255, 255], 0.2), cx - d, cy - d * 0.4, size);
  placeShape(ctx, S, dkMoonlight(g), cx + d * 0.8, cy - d, size);
  placeShape(ctx, S, DK.ink, cx, cy, size);
  ctx.restore();
}
/**
 * The context the small cover parts draw on under this look — the brand row and the channel name, set by
 * the house's own code: upright, as everything deco is (a slant taken out of the lettering, a slanted
 * plate squared), and the channel's colour, wherever they use it, turned to its light: the glass of the
 * highlighted words. The channel name, which the house sets in its heaviest face with a black outline,
 * is set in the title's capitals instead, glass lit from within and glowing on the black base.
 */
function dkSmall(ctx, C) {
  const G = dkGlass(C), near = (c) => Math.abs(c[0] - C[0]) < 1.5 && Math.abs(c[1] - C[1]) < 1.5 && Math.abs(c[2] - C[2]) < 1.5;
  const lit = (v) => { const c = parseColour(v); return c && near(c) ? css(G.body, c[3]) : v; };
  let name = false, pts = [];
  /** A path of four points that is a slanted plate (top and foot level, both sides leaning alike) made upright, on the same middle. */
  const squared = (t) => {
    if (pts.length !== 4) return;
    const [a, b, c, d] = pts, lean = d[0] - a[0];
    if (Math.abs(a[1] - b[1]) > 0.01 || Math.abs(c[1] - d[1]) > 0.01 || Math.abs(c[0] - b[0] - lean) > 0.01 || Math.abs(lean) < 0.01) return;
    t.beginPath(); t.rect(a[0] + lean / 2, a[1], b[0] - a[0], d[1] - a[1]);
  };
  /** One glyph of the channel name: glass, pale at the top and its colour at the foot, glowing. */
  const glyph = (t, s, x, y) => {
    const c = parseColour(t.fillStyle) || [255, 255, 255, 1], own = !near(c) && !(Math.abs(c[0] - G.body[0]) < 1.5 && Math.abs(c[1] - G.body[1]) < 1.5 && Math.abs(c[2] - G.body[2]) < 1.5);
    const L = own ? { body: c, core: mix(c, [255, 255, 255], 0.55), glow: c } : G, fs = parseFloat((/([\d.]+)px/.exec(t.font) || [])[1]) || 60, m = t.getTransform();
    t.save();
    if (!fast) { t.shadowColor = css(L.glow, 0.75); t.shadowBlur = fs * 0.28 * Math.hypot(m.a, m.b); }
    const gr = t.createLinearGradient(0, y - fs * 0.74, 0, y); gr.addColorStop(0, css(L.core)); gr.addColorStop(0.5, css(mix(L.core, L.body, 0.55))); gr.addColorStop(1, css(L.body));
    t.fillStyle = gr; t.fillText(s, x, y);
    t.restore();
  };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "transform") return (a, b, c, d, e, f) => { if (!(a === 1 && b === 0 && d === 1 && !e && !f)) t.transform(a, b, c, d, e, f); };   // a slant: left out
      if (k === "beginPath") return () => { pts = []; t.beginPath(); };
      if (k === "moveTo" || k === "lineTo") return (x, y) => { pts.push([x, y]); t[k](x, y); };
      if (k === "fill" || k === "stroke") return (...a) => { squared(t); t[k](...a); };
      if (name && k === "strokeText") return () => {};   // the house's black outline round the name, and its thickening: not here
      if (name && k === "fillText") return (s, x, y) => glyph(t, s, x, y);
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === "font") { name = typeof v === "string" && /^900 [\d.]+px /.test(v) && v.endsWith(`px ${fonts.cn}`); t.font = name ? v.replace(/px .*$/, `px ${fonts.en}, ${fonts.cn}`) : v; }
      else if (k === "fillStyle" || k === "strokeStyle") t[k] = lit(v);
      else t[k] = v;
      return true;
    },
  });
}
/** How far the deco capitals are set apart: a share of each glyph's own width. */
const DK_TRACK = 0.09;
/**
 * The channel colour as lit glass in the night: { body, deep, core, glow }. The hue kept (a green
 * drawn a little toward jade, so it sits with the ultramarine), the colour made luminous — a dark one
 * lifted until it reads as light — the core nearly white, the glow fully saturated. A grey gives moonlight.
 */
function dkGlass(C) {
  let [h, s0] = dkHsl(C);
  if (h > 90 && h < 170) h += (168 - h) * 0.35;
  const s = s0 < 0.12 ? 0.12 : 0.95;
  let L = 0.52;
  while (L < 0.8 && lum(dkRgb(h, s, L)) < 0.36) L += 0.02;
  return { body: dkRgb(h, s, L), deep: dkRgb(h, s, L * 0.78), core: dkRgb(h, s, 0.86), glow: dkRgb(h, 1, Math.min(0.62, L + 0.04)) };
}
/**
 * The light of the deco letters: a marquee's lamps, tungsten — a core near white, warmer toward the
 * foot, an amber rim where the light meets the letter's edge, a deeper line at the very edge, the glow
 * thrown round them. At gilt g, gold light.
 */
const dkLamp = (g) => ({
  core: mix([255, 253, 246], [255, 246, 214], g), foot: mix([255, 236, 198], [255, 220, 150], g),
  rim: mix([255, 190, 108], [238, 160, 52], g), deep: mix([186, 106, 40], [160, 96, 20], g), glow: mix([255, 206, 132], [255, 184, 70], g),
});
/** The face of a lamp-lit letter `fs` high, top to foot. */
function dkFace(ctx, fs, g) {
  const L = dkLamp(g), gr = ctx.createLinearGradient(0, -fs * 0.8, 0, fs * 0.06);
  gr.addColorStop(0, css(L.core)); gr.addColorStop(0.55, css(L.core)); gr.addColorStop(1, css(L.foot));
  return gr;
}
export const deco = {
  id: "deco",
  art: "figure",
  repaint: (c) => `an Art Deco night scene painted on black paper, in the style of the background paintings of 1990s animated noir: an ultramarine and violet night, stepped skyscrapers with setbacks and spires, lit gold windows, crossing searchlight beams, lavender fog, deep crimson and ${c} floodlight on the facades, crushed black shadows, airbrushed gradients, film grain; still the same place, no text.`,
  about: { zh: "暗黑装饰：九十年代动画里哥谭市那种画在黑卡纸上的装饰艺术夜景——黑是底，只把光画上去：群青色的夜空，层层退台的摩天楼亮着金色窗灯、立柱被从退台下打上来的泛光照亮，探照灯在天上交叉，云条横过月亮，楼与楼之间浮着淡紫的夜雾；可加飞艇、竖排霓虹招牌、阶梯拱框和剪影人物。泛光、色块和高亮字用频道色（原画里的深红）；标题像剧院门脸上亮着的招牌字：字距拉开的大写字，每个字是一盏灯——中间钨丝白、边上透出琥珀色，外面一圈暖光，细细的暗边；高亮字是频道色的霓虹灯管。「鎏金」拉满变成黑金夜色。神秘、华丽、带点黑色电影的悬疑——适合城市、夜生活、悬疑推理、历史人文、电影解读、音乐与奢华品类。照片会被画成群青夜色，暖色保留为深红和金色。只有夜色底；自带平直的版式。", en: "Dark deco: the Art Deco city by night as the 90s animated series painted Gotham, on black paper — the dark is the ground and only the light is laid on: an ultramarine night, stepped skyscrapers with gold-lit windows and pilasters floodlit from their setbacks, searchlights crossing, bars of cloud across the moon, lavender fog between the rows; an airship, a neon blade sign, a stepped proscenium and a silhouette if you like. The floodlight, the colour block and the highlighted words take the channel colour (the paintings' crimson); the title is set as the lit letters of a theatre front, spaced capitals each a lamp — tungsten white at heart, amber at the rim, a warm glow round it, a fine dark keyline — the highlighted words neon tubes in the channel's colour. Turn up Gilt for black and gold. Mysterious, opulent, a little film noir — for cities, nightlife, mysteries, history, film, music and luxury. A photo is painted into the ultramarine night, its warm colours kept as crimson and gold. Night ground only; flat layouts of its own." },
  name: { zh: "暗黑装饰", en: "Dark deco" },
  oneTheme: true,
  seeded: true,
  scene: { tower: { zh: "主楼", en: "The great tower" }, moon: { zh: "月亮", en: "Moon" }, beams: { zh: "探照灯", en: "Searchlights" }, airship: { zh: "飞艇", en: "Airship" }, sign: { zh: "霓虹竖招牌", en: "Blade sign" }, figure: { zh: "剪影人物", en: "Silhouette" } },
  params: [
    { key: "tower", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "主楼", en: "The great tower" } },
    { key: "skyline", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "楼群", en: "Skyline" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "窗灯", en: "Lit windows" } },
    { key: "flood", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "泛光", en: "Floodlight" } },
    { key: "beams", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "探照灯", en: "Searchlights" } },
    { key: "moon", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "月亮与星", en: "Moon and stars" } },
    { key: "fog", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "夜雾", en: "Fog" } },
    { key: "red", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "赤红天幕", en: "Crimson sky" } },
    { key: "rain", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "夜雨", en: "Rain" } },
    { key: "airship", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "飞艇", en: "Airship" } },
    { key: "sign", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "霓虹竖招牌", en: "Blade sign" } },
    { key: "word", text: true, max: 8, def: "", name: { zh: "招牌字", en: "The sign's letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "arch", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "阶梯拱框", en: "Stepped proscenium" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "剪影人物", en: "Silhouette" } },
    { key: "gilt", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "鎏金", en: "Gilt" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "光晕", en: "Halation" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片夜色化", en: "Photo as night" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  // the channel name on the black base is set as on the field, in the channel colour
  layout: (template, w, h) => { const G = blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }); return { ...G, cat: { ...G.cat, onAccent: false } }; },
  theme: (base, C, p) => ({ ...base, field: css(dkSky((p && p.gilt) || 0, (p && p.red) || 0)[1]), text: css(DK.cream), own: css(DK.cream), dim: css(DK.cream, 0.6), titleFill: css(DK.cream), titleInk: css(DK.ink), grid: () => css(DK.gold, 0.15) }),
  /**
   * The night, its stars, the moon, the searchlights, the far and middle rows of the city with fog
   * between (painted once and kept until one of their sliders or objects changes); then the great tower,
   * fog at its foot, the near row, the sign, the airship, the silhouette, the proscenium. A photo is
   * painted into the night; filling the canvas, it gets the searchlights and the proscenium too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), g = p.gilt, sky = dkSky(g, p.red), spot = dkSpot(C), gold = mix(DK.gold, DK.pale, 0.2);
    const base = F.y1, beamAt = [F.x0 + fw * 0.55, base - fh * 0.06], fog = dkFog(g, p.red);
    if (env.photo) {
      env.drawPhoto(0, p.photo > 0 ? { key: `dk|${p.photo}|${g}`, fn: (d) => dkPixels(d, p.photo, g) } : null);   // the photo itself painted into the night (see drawPhotoAt)
      if (L.fill) {   // night falls from the top, the searchlights and the rain over it, in the proscenium
        const dk = ctx.createLinearGradient(0, 0, 0, h * 0.7); dk.addColorStop(0, css(sky[0], 0.75 * p.photo)); dk.addColorStop(1, css(sky[0], 0));
        ctx.fillStyle = dk; ctx.fillRect(0, 0, w, h * 0.7);
        if (p.red > 0) { ctx.save(); ctx.globalCompositeOperation = "color"; ctx.fillStyle = css(sky[2], 0.55 * p.red); ctx.fillRect(0, 0, w, h); ctx.restore(); }
        dkBeams(ctx, F, F.x0 + fw * 0.55, base, p.beams * 5, g, 3320);
        dkRain(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.rain, g, 3390);
        dkArch(ctx, F, p.arch, gold, u);
      }
      return true;
    }
    const mid = base - fh * (0.16 + 0.44 * p.skyline), far = base - fh * (0.22 + 0.52 * p.skyline);
    // the great tower stands beside the title when there is room, the moon beside the tower
    const T = canPaint(ctx) ? titleArea(ctx, env) : null, TW = u * (0.14 + 0.1 * p.tower), right = T ? T.x + T.w + TW * 0.7 : 0;
    const tx = Math.min(F.x1 - TW * 0.55, right < F.x1 - TW * 0.6 ? Math.max(F.x0 + fw * 0.7, right) : F.x0 + fw * 0.76), moonR = u * (0.045 + 0.075 * p.moon);
    let mx0 = Math.min(F.x1 - moonR * 1.25, tx + TW * 0.62 + moonR * 1.1);
    if (p.tower > 0 && Math.abs(mx0 - tx) < moonR + TW * 0.12) mx0 = tx - TW * 0.62 - moonR * 1.1;
    const [mx, my] = p.moon > 0 && L.grid ? objAt("moon", mx0, F.y0 + fh * 0.22, ctx) : [0, 0];   // scene objects
    const [bx, by] = p.beams > 0 && L.grid ? objAt("beams", beamAt[0], beamAt[1], ctx) : beamAt;
    if (L.ground !== false) {   // the night down to the city's foot, and the black below it: the ground
      const gr = ctx.createLinearGradient(0, F.y0, 0, base); gr.addColorStop(0, css(sky[0])); gr.addColorStop(0.45, css(sky[1])); gr.addColorStop(0.8, css(sky[2])); gr.addColorStop(1, css(mix(sky[3], spot, 0.12)));
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = css(DK.ink); ctx.fillRect(0, base, w, h - base);
    }
    if (!L.grid) return true;
    if (p.moon > 0) { dkStars(ctx, F, mid, p.moon * 150, g, 3300); dkMoon(ctx, mx, my, moonR, g, sky, 3310); }
    if (p.beams > 0) dkBeams(ctx, F, bx, by, p.beams * 5, g, 3320);   // added to what is there: painted each time, as a kept layer on its own could not add them to it
    const paintBack = (x) => {   // the far and middle rows of the city with their fog: kept on a layer of their own
      dkRow(x, F, far, base, { w: [0.026, 0.03], h: [0.45, 0.55], body: mix(sky[3], sky[1], 0.5), rim: dkMoonlight(g), pin: true, litK: 0.5, tiers: true }, p.lights, 0, spot, g, 3330);
      dkFogBand(x, F.x0, F.x1, base - (base - far) * 0.32, fh * 0.12, fog, 0.8 * p.fog, 3340);
      dkRow(x, F, mid, base, { w: [0.045, 0.05], h: [0.3, 0.55], tall: 0.14, body: mix(sky[1], [0, 0, 0], 0.45 + 0.35 * p.red), rim: mix(dkMoonlight(g), spot, 0.3), litK: 0.9, tiers: true, flood: true }, p.lights, p.flood, spot, g, 3350);
      dkFogBand(x, F.x0, F.x1, base, fh * 0.1, mix(fog, spot, 0.2), 0.7 * p.fog, 3345);   // the city's foot glowing in the fog
    };
    if (p.skyline > 0) {
      const kept = canPaint(ctx) && keptLayer(ctx, "dkBack", [seed, w, h, F.x0, F.y0, F.x1, F.y1, g, p.red, p.skyline, p.lights, p.flood, p.fog, C.join()].join("|"), paintBack);
      if (kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept, 0, 0); ctx.restore(); } else paintBack(ctx);
    }
    if (p.tower > 0) {   // a scene object, its handle half way up
      const TH = fh * (0.5 + 0.38 * p.tower), [cx, cy] = objAt("tower", tx, base - TH * 0.45, ctx);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.tower * 4);
      dkTower(ctx, cx, cy + TH * 0.45, TH, TW, Math.max(0.15, p.lights), p.flood, spot, g, sky, 3360);
      ctx.restore();
    }
    dkFogBand(ctx, F.x0, F.x1, base - fh * 0.04, fh * 0.07, fog, 0.55 * p.fog, 3370);
    if (p.skyline > 0) dkRow(ctx, F, base - fh * (0.06 + 0.16 * p.skyline), base, { w: [0.07, 0.07], h: [0.35, 0.65], body: DK.ink, rim: sky[2], litK: 0.3 }, p.lights, 0, spot, g, 3380);
    if (p.airship > 0) {   // a scene object: the first of a few places in the sky clear of the title
      const sz = u * (0.16 + 0.2 * p.airship), box = (x, y) => ({ x: x - sz * 0.55, y: y - sz * 0.2, w: sz * 1.1, h: sz * 0.4 }), keep = canPaint(ctx) ? [...keepClear(ctx, env), { x: 0, y: 0, w: Math.min(w, 900), h: 150 }] : [];   // and the brand row
      const at = [[0.62, 0.15], [0.5, 0.1], [0.3, 0.36], [0.72, 0.4], [0.38, 0.6]].map(([a, b]) => [F.x0 + fw * a, F.y0 + fh * b]).find(([x, y]) => !keep.some((k) => overlaps(k, box(x, y)))) || [F.x0 + fw * 0.62, F.y0 + fh * 0.15];
      const [ax, ay] = objAt("airship", at[0], at[1], ctx); dkAirship(ctx, ax, ay, sz, g, sky, spot, Math.min(1, p.airship * 4));
    }
    if (p.sign > 0) {   // a scene object: the blade sign at the field's edge, below the title when it would cross it
      const bw = u * (0.05 + 0.04 * p.sign), word = (p.word || env.cat.code || env.cat.name || "DECO").toUpperCase();
      let sx = F.x1 - bw * 1.2, sy = F.y0 + fh * 0.3;
      if (T && sx + bw > T.x && sx - bw < T.x + T.w && sy < T.y + T.h) sy = Math.min(base - fh * 0.3, T.y + T.h + bw * 0.5);
      [sx, sy] = objAt("sign", sx, sy, ctx);
      dkSign(ctx, sx, sy, bw, word, spot, Math.min(1, p.sign * 4));
    }
    if (p.figure > 0) {   // a scene object
      const S = canPaint(ctx) && graphicShape(env), size = Math.min(fh, fw * 0.7) * (0.22 + 0.36 * p.figure);
      if (S) { const [cx, cy] = objAt("figure", F.x0 + Math.max(fw * 0.12, size * 0.6), base - size * 0.42, ctx); dkFigure(ctx, S, cx, cy, size, spot, g, Math.min(1, p.figure * 4)); }
    }
    dkRain(ctx, F, p.rain, g, 3390);
    dkArch(ctx, F, p.arch, gold, u);
    return true;
  },
  /** Fine gold lines with deco nodes: pairs of pinstripes down every 160, single lines across, a diamond where they meet. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 160, xs = [], ys = every(s / 2, h, s);
    for (let x = s / 2; x < w; x += s) xs.push(x - 4, x + 4);
    gridPen(ctx, color); gridPath(ctx, xs, ys, 0, 0, w, h);
    ctx.beginPath(); for (let x = s / 2; x < w; x += s) for (const y of ys) { ctx.moveTo(x, y - 15); ctx.lineTo(x + 9, y); ctx.lineTo(x, y + 15); ctx.lineTo(x - 9, y); ctx.closePath(); } ctx.fill();
    ctx.restore();
  },
  accent: {
    fill: () => css(DK.base), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /**
     * The block as the black marble base the city stands on: a line of the floodlight along its edge, a
     * black rule, a gold one, a frieze of gold reeding, tall and short bars by turns, a gold hairline; under
     * it the floodlight's glow on the polished black, fading away from the edge.
     */
    edge(ctx, run, nx, ny, C) {
      const spot = dkSpot(C), at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      for (let i = 0; i < 8; i++) { ctx.strokeStyle = css(spot, 0.075 * (1 - i / 8)); ctx.lineWidth = 34; at(54 + i * 26); }
      // the city's lights in the polished black: streaks across the base, broken dashes stroked thick, fainter away from the edge
      for (let j = 0; j < 4; j++) {
        const dash = []; for (let q = 0; q < 24; q++) dash.push(2 + rand(3400 + j * 50 + q) * (j % 2 ? 6 : 3), 8 + rand(3401 + j * 50 + q * 1.7) ** 2 * 90);
        ctx.setLineDash(dash); ctx.lineDashOffset = rand(3402 + j) * 400; ctx.strokeStyle = css(j % 2 ? spot : DK.amber, 0.28 - j * 0.05); ctx.lineWidth = 46 - j * 8; at(62 + j * 34);
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.strokeStyle = css(DK.ink); ctx.lineWidth = 12; at(3);
      ctx.strokeStyle = css(DK.gold); ctx.lineWidth = 3; at(11);
      ctx.setLineDash([3, 13]); ctx.lineWidth = 14; at(23); ctx.lineDashOffset = 8; ctx.lineWidth = 7; at(26.5); ctx.setLineDash([]); ctx.lineDashOffset = 0;
      ctx.lineWidth = 1.5; at(35);
      for (const [lw, a] of [[18, 0.14], [7, 0.4], [3, 1]]) { ctx.strokeStyle = css(mix(spot, [255, 255, 255], 0.4), a); ctx.lineWidth = lw; at(-2); }
    },
  },
  /**
   * Deco capitals as the lit letters of a theatre front, set with air between them: each letter a
   * lamp — tungsten white at its heart, an amber rim where the light meets its edge — in a fine dark
   * keyline (the outline slider), throwing a warm glow round itself; a shade of the night stepped down
   * behind (the shadow slider), a soft dark round them so they stand off the sky and the searchlights.
   * The highlighted words are neon: glass in the channel's hue toned into the night, deep at the rim,
   * white-hot down the middle, throwing its colour round them.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, g = (p && p.gilt) || 0, s = Math.min(2, o.shadowAmt || 0), k = o.strokeAmt || 0;
    // a colour of the layer's own is kept: lit glass of it when it is light enough to be light, flat when it is dark (ink on a pale plate)
    const lit = (c) => lum(c) > 0.3, glass = o.hi ? (lit(o.hi) ? { body: o.hi, deep: mix(o.hi, DK.ink, 0.25), core: mix(o.hi, [255, 255, 255], 0.6), glow: o.hi } : { body: o.hi, deep: o.hi, core: o.hi, glow: null }) : dkGlass(o.C || DK.crimson);
    const bright = !o.fill || lit(o.fill);
    const lamp = !o.fill ? dkLamp(g) : bright ? { core: mix(o.fill, [255, 255, 255], 0.5), foot: mix(o.fill, [255, 255, 255], 0.3), rim: o.fill, deep: mix(o.fill, DK.ink, 0.3), glow: o.fill } : null;
    // the tracking: every glyph set apart by a share of its own width, the line drawn that much smaller so it keeps its measure;
    // each piece of the line where the line was set (Latin beside CJK larger, punctuation squeezed: see setLine in title.js)
    const chars = [], T = 1 + DK_TRACK;
    let cx = 0;
    pass((a, at) => { cx = at * T; for (const t of a.t) { const w = ctx.measureText(t).width; chars.push({ t, hi: a.hi, x: cx, s: a.s, dy: (a.dy || 0) * T }); cx += w * T; } });
    ctx.scale(1 / T, 1 / T);
    const each = (fn, only) => { for (const c of chars) if (only === undefined || c.hi === only) inPiece(c, () => fn(c, c.x)); };
    const face = lamp ? (o.fill ? css(lamp.core) : dkFace(ctx, fs, g)) : css(o.fill);
    if (!canPaint(ctx)) { each((c, x) => { ctx.fillStyle = c.hi ? css(glass.body) : face; ctx.fillText(c.t, x, 0); }); return; }   // nothing to work on: the letters plain
    ctx.lineJoin = "miter"; ctx.miterLimit = 2.5;
    const shade = mix(dkSky(g)[1], DK.ink, 0.55), B = fast ? null : dkBox(ctx, fs, cx);
    // the letters alone, white, on work canvases the size of the line: plain and highlighted apart
    const mask = (slot, hi) => { if (!B || !chars.some((c) => c.hi === hi)) return null; const M = dkWork(ctx, slot, B); M.fillStyle = "#fff"; each((c, x) => M.fillText(c.t, x, 0), hi); return M.canvas; };
    const Mp = mask("dkPlain", false), Mh = mask("dkHi", true);
    /** Only the soft shadow of mask m: `col`, r units across, dy units down (the mask itself is laid off the canvas, its shadow thrown back onto the line); `light`: screened, so it brightens. */
    const glowOf = (m, col, r, dy = 0, light = false) => { if (m) inPixels(ctx, () => { const D = B.x0 + B.w + 20; if (light) ctx.globalCompositeOperation = "screen"; ctx.shadowColor = col; ctx.shadowBlur = r * B.k; ctx.shadowOffsetX = D; ctx.shadowOffsetY = dy * B.k; ctx.drawImage(m, B.x0 - D, B.y0); }); };
    // a soft dark round the letters, the paper showing through, so they stand off whatever is behind
    for (const m of [Mp, Mh]) glowOf(m, css(DK.ink, 0.5), fs * 0.09, fs * 0.02);
    if (s > 0) {   // the shade: the letters' depth stepped down behind them, in the night's darkest blue
      const d = fs * 0.045 * s, k0 = Math.hypot(ctx.getTransform().a, ctx.getTransform().b), n = Math.max(2, Math.min(10, Math.round((d * k0) / 1.5)));
      ctx.fillStyle = css(shade);
      for (let i = n; i >= 1; i--) { const [dx, dy] = fall((d * i) / n * 0.6, (d * i) / n); each((c, x) => ctx.fillText(c.t, x + dx, dy)); }
    }
    // their light thrown round them, added to what is there rather than laid over it: the lamps' warm glow, the neon's own colour
    if (lamp) { glowOf(Mp, css(lamp.glow, 0.42), fs * 0.55, 0, true); glowOf(Mp, css(lamp.glow, 0.6), fs * 0.11, 0, true); }
    if (glass.glow) { glowOf(Mh, css(glass.glow, 0.42), fs * 0.42, 0, true); glowOf(Mh, css(glass.glow, 0.55), fs * 0.12, 0, true); }
    if (k > 0) { ctx.strokeStyle = css(mix(DK.ink, [52, 30, 12], 0.5)); ctx.lineWidth = fs * 0.04 * k; each((c, x) => ctx.strokeText(c.t, x, 0)); }   // the keyline: the dark edge of the sign
    if (!B) { each((c, x) => { ctx.fillStyle = c.hi ? css(glass.body) : face; ctx.fillText(c.t, x, 0); }); return; }
    /**
     * Letters lit from within: their face, and their colour glowing in from the rim — the shadow of all
     * that is not them, cast into them — each of `rims` [blur in type sizes, colour, alpha], the last
     * the tightest, at the very edge.
     */
    const litUp = (m, hi, fill, rims) => {
      const E = dkWork(ctx, "dkBand", B), N = dkWork(ctx, "dkMask", B), D = B.w + B.h + 50;
      E.fillStyle = fill; each((c, x) => E.fillText(c.t, x, 0), hi);
      N.setTransform(1, 0, 0, 1, 0, 0); N.fillStyle = "#000"; N.fillRect(0, 0, B.w, B.h); N.globalCompositeOperation = "destination-out"; N.drawImage(m, 0, 0);
      E.setTransform(1, 0, 0, 1, 0, 0); E.globalCompositeOperation = "source-atop"; E.shadowOffsetX = D;
      for (const [r, col, al] of rims) { E.shadowColor = css(col, al); E.shadowBlur = r * fs * B.k; E.drawImage(N.canvas, -D, 0); }
      inPixels(ctx, () => ctx.drawImage(E.canvas, B.x0, B.y0));
    };
    // the lamps: tungsten white, the amber rim only a little way in, so the strokes of a Chinese character stay light
    if (Mp) { if (lamp) litUp(Mp, false, face, [[0.07, lamp.rim, 0.75], [0.025, lamp.rim, 0.9], [0.008, lamp.deep, 0.9]]); else each((c, x) => { ctx.fillStyle = face; ctx.fillText(c.t, x, 0); }, false); }
    // the neon: white-hot down the middle, the glass's colour deep at the rim
    if (Mh) litUp(Mh, true, css(glass.core), [[0.11, glass.body, 1], [0.055, glass.body, 1], [0.014, glass.deep, 1]]);
  },
  // objects are lit as the city is: faces in the night's blues (gold when gilded), the colour turned to floodlight, fine dark lines; the small parts stay ink on the colour block
  wrap: (ctx, C, p, plates) => {
    if (plates) return dkSmall(ctx, C);
    const g = (p && p.gilt) || 0;
    return mapped(ctx, { fill: { ink: DK.ink, light: mix([206, 202, 255], DK.pale, g), mid: mix([108, 96, 206], [196, 140, 64], g), dark: mix([30, 26, 82], [52, 34, 16], g), colour: (c) => mix(dkSpot(c), [255, 255, 255], 0.08) }, stroke: { ink: DK.ink, light: DK.cream }, line: 0.6 });
  },
  sticker: painters({ line: DK.ink, lineScale: 0.55, tone: inkAs(DK.ink, (c) => dkSpot(c)), shadow(ctx, draw) { ctx.save(); ctx.translate(7, 9); draw(css(DK.ink, 0.8)); ctx.restore(); } }),
  /** The corner tag: a theatre marquee — a black box ruled in gold, a row of lit bulbs along its top and foot, its capitals in the title's lamplight. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.64;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 1.5, h = f * 1.9, top = y + (fs * 1.34 - h), n = Math.max(4, Math.round(w / (f * 0.34)));
    ctx.fillStyle = css(DK.ink); ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = css(DK.gold); ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, top + 1.5, w - 3, h - 3); ctx.lineWidth = 1.2; ctx.strokeRect(x + 7, top + 7, w - 14, h - 14);
    for (const by of [top + h * 0.12, top + h * 0.88]) for (let i = 0; i < n; i++) {
      const bx = x + (w * (i + 0.5)) / n, r = f * 0.06;
      ctx.fillStyle = css(DK.amber, 0.25); ctx.beginPath(); ctx.arc(bx, by, r * 2.4, 0, TAU); ctx.fill();
      ctx.fillStyle = css([255, 244, 214]); ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
    }
    const base = top + h * 0.5 + f * 0.36;
    ctx.save();
    if (!fast && canPaint(ctx)) { const m = ctx.getTransform(); ctx.shadowColor = css(DK.amber, 0.45); ctx.shadowBlur = f * 0.3 * Math.hypot(m.a, m.b); }
    ctx.translate(0, base); ctx.fillStyle = ink || dkFace(ctx, f, (p && p.gilt) || 0); spaced(ctx, str, x + f * 0.75, 0, 4);
    ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: gold corner pieces — two rules stepping in at the corner, a diamond where they meet. */
  frame(ctx, env) {
    const { w, h } = env, b = 30, L = 84, s = 12;
    ctx.save(); ctx.strokeStyle = css(DK.gold, 0.9); ctx.lineJoin = "miter";
    for (const [x, y, sx, sy] of [[b, b, 1, 1], [w - b, b, -1, 1], [w - b, h - b, -1, -1], [b, h - b, 1, -1]]) {
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y + sy * s * 2); ctx.lineTo(x + sx * s, y + sy * s * 2); ctx.lineTo(x + sx * s, y + sy * s); ctx.lineTo(x + sx * s * 2, y + sy * s); ctx.lineTo(x + sx * s * 2, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x + sx * 10, y + sy * L * 0.75); ctx.lineTo(x + sx * 10, y + sy * (s * 2 + 10)); ctx.moveTo(x + sx * (s * 2 + 10), y + sy * 10); ctx.lineTo(x + sx * L * 0.75, y + sy * 10); ctx.stroke();
      ctx.fillStyle = css(DK.pale); shapeOf(ctx, [[x + sx * 4, y + sy * 4 - 5], [x + sx * 4 + 5, y + sy * 4], [x + sx * 4, y + sy * 4 + 5], [x + sx * 4 - 5, y + sy * 4]]); ctx.fill();
    }
    ctx.restore();
  },
  /** The plate under a text layer: a black slab with its corners stepped in, ruled in gold. */
  plate(ctx, x, y, w, h, colour, fs) {
    const s = fs * 0.08, pts = [[x + s, y], [x + w - s, y], [x + w - s, y + s], [x + w, y + s], [x + w, y + h - s], [x + w - s, y + h - s], [x + w - s, y + h], [x + s, y + h], [x + s, y + h - s], [x, y + h - s], [x, y + s], [x + s, y + s]];
    ctx.save(); ctx.translate(...fall(fs * 0.05, fs * 0.07)); shapeOf(ctx, pts); ctx.fillStyle = css(DK.ink, 0.85); ctx.fill(); ctx.restore();

    shapeOf(ctx, pts); ctx.fillStyle = colour; ctx.fill(); ctx.lineJoin = "miter"; ctx.lineWidth = fs * 0.03; ctx.strokeStyle = css(DK.gold); ctx.stroke();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(DK.ink, 0.8); ctx.shadowBlur = 0; ctx.shadowOffsetX = 7 * unit; ctx.shadowOffsetY = 9 * unit; },
  post(ctx, w, h, C, p, unit = 1) { dkBloom(ctx, p.glow); grain(ctx, p.grain * 0.75, unit); vignette(ctx, w, h, [2, 2, 8], 0.55, 0.42); },
  prompt: `Objects from Gotham by night as a 1990s animated noir painted them — Art Deco, mysterious, opulent — that read at a glance:
- one clear object per sticker (a fedora, a vintage microphone, a martini glass, a 1930s car, a gramophone, a pocket watch, a searchlight, an Art Deco lamp, a key), with a strong, elegant silhouette built of long curves and stepped geometric forms; no realism, no fine detail;
- flat colour only, as if painted on black paper: deep blues and violets for the body, one or two shapes in gold, and the main colour for one accent;
- the app adds a fine dark line and a hard dark shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from an Art Deco city at night, built as simple models from a few boxes and cylinders — a stepped skyscraper, a theatre marquee, a streamlined radio, a jukebox, a 1930s car, a lamp post; no realism, no fine detail.
- the renderer paints faces in the night's blues with a fine dark line: do NOT try to draw shading or outlines yourself;
- "white" is a pale moonlit blue, "dark" a deep indigo, and "main" the floodlight's colour (the channel colour) — use it for one to three parts.`,
};
const DK_GILT = tonesFx(() => [[0, [26, 14, 4]], [0.28, [110, 64, 22]], [0.46, [218, 154, 64]], [0.56, [160, 102, 38]], [0.72, [238, 186, 92]], [0.88, [255, 226, 150]], [1, [255, 248, 226]]]);
deco.elementFx = [
  { key: "gilt", name: { zh: "鎏金", en: "Gilded" }, for: FX_ALL, stage: "filter",
    /** The layer in polished gold: its lightness mapped onto bronze, gold and cream, then a sheen laid across it — pale at the top, a dark band below the middle as metal reflects a horizon, bright again at the foot. */
    paint(x, B, a, E) {
      DK_GILT(x, B, a, E);
      onLayer(x, B, region(x, B, "fxA"), "soft-light", a, (g) => {
        const gr = g.createLinearGradient(0, 0, 0, B.h);
        for (const [t, c] of [[0, [255, 255, 255]], [0.4, [200, 200, 200]], [0.52, [40, 40, 40]], [0.6, [110, 110, 110]], [0.85, [235, 235, 235]], [1, [255, 255, 255]]]) gr.addColorStop(t, css(c));
        g.fillStyle = gr; g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "rim", name: { zh: "暗夜剪影", en: "Silhouette with rim light" }, for: FX_ALL, stage: "fill", reach: (B, k) => ({ l: 12 * k, t: 12 * k, r: 12 * k, b: 6 * k }),
    /** The layer turned to a black silhouette against the night, a rim of the floodlight's colour along its upper left and of moonlight along its upper right. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), d = Math.max(1.5, Math.min(B.w, B.h) * 0.01 + 1.5 * E.k), spot = dkSpot(E.C);
      x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = a; x.fillStyle = css(DK.ink); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2);
      x.drawImage(shapeIn(src, mix(spot, [255, 255, 255], 0.2), "fxRimA"), B.x0 - d, B.y0 - d * 0.5);
      x.drawImage(shapeIn(src, dkMoonlight(0), "fxRimB"), B.x0 + d, B.y0 - d * 0.6);
      x.restore();
    } },
  { key: "burst", name: { zh: "放射金芒", en: "Gold sunburst" }, for: FX_ALL, stage: "behind", reach: (B) => { const r = Math.max(B.w, B.h) * 0.8; return { l: r, t: r, r, b: r }; },
    /** Gold rays fanning out from behind the layer, as a deco sunburst: long and short wedges by turns, fading out, a pale halo at their heart. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, R = Math.max(B.w, B.h) * (0.6 + 0.65 * a), n = 32, turn = E.R(3) * TAU, al = Math.min(1, a * 2.5);
      x.save(); x.globalCompositeOperation = "destination-over";
      const gr = x.createRadialGradient(cx, cy, Math.min(B.w, B.h) * 0.25, cx, cy, R); gr.addColorStop(0, css(DK.pale, al)); gr.addColorStop(0.45, css(DK.gold, 0.7 * al)); gr.addColorStop(1, css(DK.gold, 0));
      x.fillStyle = gr; x.beginPath();
      for (let i = 0; i < n; i++) { const a0 = turn + (i / n) * TAU; x.moveTo(cx, cy); x.arc(cx, cy, R * (i % 2 ? 0.72 : 1), a0, a0 + (TAU / n) * 0.45); x.closePath(); }
      x.fill();
      const halo = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5); halo.addColorStop(0, css(DK.cream, 0.55 * al)); halo.addColorStop(1, css(DK.cream, 0));
      x.fillStyle = halo; x.fillRect(cx - R * 0.5, cy - R * 0.5, R, R);
      x.restore();
    } },
  { key: "night", name: { zh: "夜色分调", en: "Night grade" }, for: FX_PHOTO, stage: "filter",
    /** The photo painted into the ultramarine night (see dkPixels), its warm colours kept as crimson and gold. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); dkPixels(img.data, a, values.gilt || 0, current.id === "deco"); x.putImageData(img, B.x0, B.y0); } },   // under this look the photo is already in the night: read by value, so it is not crushed twice
];
