// glass: a painting behind patterned glass
// An oil painting seen through a pane of hammered glass: a room in warm light — a window, someone
// standing against it, flowers in a vase — painted in loose strokes, then bent and broken up by the
// glass, its bumps catching glints and dark lines; frost; the corners falling away into shadow.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, blurred, boost, canPaint, cellsOf, clamp, css, dark, fast, grain, graphicShape, gridPath, gridPen, inPixels, inkAs, lumOf, mapped, mix, near, noise, objAt, openField, painters, placeShape, rand, region, rounded, sampled, seed, shapeOf, shift, snap, softCopy, softened, upright, vignette, wash, wherePainted, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

/**
 * Paints the picture over in short brush strokes of its own colours: a coarse layer over all of `box`,
 * then a finer one only where the picture changes fast, so its edges keep their drawing. Each stroke
 * runs along the edges (across the change in lightness; where the picture is flat, along a slow drift)
 * and is a shade lighter or darker than the paint it takes up. `cell`: the coarse stroke's width, units.
 */
function brushwork(ctx, box, amt, cell, slot) {
  if (amt <= 0 || fast || !canPaint(ctx)) return;
  const grids = [cell, cell * 0.5].map((c, n) => {   // both read before either is painted
    const cols = Math.max(2, Math.ceil((box.x1 - box.x0) / c)), rows = Math.max(2, Math.ceil((box.y1 - box.y0) / c));
    return { c, cols, rows, fine: n === 1, px: sampled(ctx, box.x0, box.y0, cols, rows, c, slot + n) };
  });
  ctx.save(); ctx.lineCap = "round";
  for (const { c, cols, rows, fine, px } of grids) {
    const L = new Float32Array(cols * rows);
    for (let q = 0; q < cols * rows; q++) L[q] = (px[q * 4] * 54 + px[q * 4 + 1] * 183 + px[q * 4 + 2] * 19) / 65280;
    ctx.globalAlpha = Math.min(1, amt * (fine ? 1 : 0.85)); ctx.lineWidth = c * (fine ? 0.75 : 0.95);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const q = j * cols + i;
      if (px[q * 4 + 3] < 200) continue;
      const gx = L[i < cols - 1 ? q + 1 : q] - L[i > 0 ? q - 1 : q], gy = L[j < rows - 1 ? q + cols : q] - L[j > 0 ? q - cols : q], g = Math.hypot(gx, gy);
      if (fine && g < 0.08) continue;
      const x = box.x0 + (i + 0.5 + (rand(q * 1.7 + 2000) - 0.5) * 0.9) * c, y = box.y0 + (j + 0.5 + (rand(q * 2.3 + 2001) - 0.5) * 0.9) * c;
      const a = (g > 0.03 ? Math.atan2(gy, gx) + Math.PI / 2 : 0.7 + Math.sin(x * 0.004 + y * 0.002) * 0.9) + (rand(q * 3.1 + 2002) - 0.5) * 0.45;
      const len = c * (fine ? 0.9 + rand(q * 3.7 + 2003) * 0.8 : 1.2 + rand(q * 3.7 + 2003) * 1.6), dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2, v = (rand(q * 4.3 + 2004) - 0.5) * 26;
      ctx.strokeStyle = `rgb(${(px[q * 4] + v) | 0},${(px[q * 4 + 1] + v) | 0},${(px[q * 4 + 2] + v) | 0})`;
      ctx.beginPath(); ctx.moveTo(x - dx, y - dy); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    }
  }
  ctx.restore();
}
/**
 * The picture seen through patterned glass. A field of smooth bumps (value noise in two octaves, a
 * little taller than wide, fixed to the cover so it does not move with the resolution) bends the light:
 * each pixel is read from a little way down the slope it sits on. Slopes turned to a light at the upper
 * left catch a glint, those turned away a dark line. `amp`: how far the light is bent, `cell`: the size of
 * a bump (both in units); `glint`, `shade`: 0–1; (ox, oy): the point the pattern grows from as `cell`
 * changes (units). While dragging, every other pixel is worked out.
 */
function glassWarp(ctx, amp, cell, glint, shade, ox = 0, oy = 0) {
  if ((amp <= 0 && glint <= 0 && shade <= 0) || !canPaint(ctx)) return;
  const x = workLike(ctx, "glass"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(ctx.canvas, 0, 0);
  const W = x.canvas.width, H = x.canvas.height, m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1;
  const src = x.getImageData(0, 0, W, H), out = x.createImageData(W, H);
  glassPixels(src.data, out.data, W, H, k, m.e, m.f, amp, cell, glint, shade, ox, oy);
  x.putImageData(out, 0, 0);
  inPixels(ctx, () => ctx.drawImage(x.canvas, 0, 0));
}
/**
 * glassWarp's work on pixels: `s` read, `d` written, both W × H; k pixels per unit; (e, f) the pixel
 * offset of the cover's origin (so the pattern stays fixed to the cover when only part of it is worked
 * on); the rest as glassWarp's.
 */
function glassPixels(s, d, W, H, k, e, f, amp, cell, glint, shade, ox, oy) {
  const cp = cell * k, step = Math.max(2, Math.round(cp / 8)), gw = Math.ceil(W / step) + 2, gh = Math.ceil(H / step) + 2, hgt = new Float32Array(gw * gh), sd = seed * 7.31;
  const hash = (i, j) => noise(i * 12.9898 + j * 78.233 + sd);
  const vn = (X, Y) => {
    const i = Math.floor(X), j = Math.floor(Y), fx = X - i, fy = Y - j, u = fx * fx * (3 - 2 * fx), t = fy * fy * (3 - 2 * fy);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), q = hash(i + 1, j + 1);
    return a + (b - a) * u + (c - a) * t + (a - b - c + q) * u * t;
  };
  const near1 = (X, Y) => {   // the squared distance to the nearest of the points scattered one to a cell: a dimple round each
    const i = Math.floor(X), j = Math.floor(Y);
    let best = 9;
    for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const dx = X - (i + a + 0.15 + 0.7 * hash(i + a, j + b)), dy = Y - (j + b + 0.15 + 0.7 * hash(i + a + 71.3, j + b - 19.7)), q = dx * dx + dy * dy; if (q < best) best = q; }
    return best;
  };
  // hammered glass: a dimple per cell, each a little lens with a sharp seam where it meets the next, on a slow wobble
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const X = (i * step - e - ox * k) / cp, Y = (j * step - f - oy * k) / (cp * 1.3); hgt[j * gw + i] = 0.9 * near1(X, Y) + 0.35 * vn(X * 0.6 + 31.7, Y * 0.6 + 9.1); }
  const gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh), sl = cp / (2 * step);   // slopes, as rise per bump width
  for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) { const q = j * gw + i; gx[q] = (hgt[q + 1] - hgt[q - 1]) * sl; gy[q] = (hgt[q + gw] - hgt[q - gw]) * sl; }
  const A = amp * k, st = fast ? 2 : 1, G = glint * 1.4, D = shade * 1.1, R = (glint + shade) * 0.08;
  for (let py = 0; py < H; py += st) {
    const fy = py / step, j0 = fy | 0, ty = fy - j0;
    for (let px = 0; px < W; px += st) {
      const fx = px / step, i0 = fx | 0, tx = fx - i0, q = j0 * gw + i0;
      const ax = gx[q] + (gx[q + 1] - gx[q]) * tx, bx = gx[q + gw] + (gx[q + gw + 1] - gx[q + gw]) * tx, sx = ax + (bx - ax) * ty;
      const ay = gy[q] + (gy[q + 1] - gy[q]) * tx, by = gy[q + gw] + (gy[q + gw + 1] - gy[q + gw]) * tx, sy = ay + (by - ay) * ty;
      let X = (px + sx * A) | 0, Y = (py + sy * A) | 0;
      X = X < 0 ? 0 : X >= W ? W - 1 : X; Y = Y < 0 ? 0 : Y >= H ? H - 1 : Y;
      const si = (Y * W + X) * 4, lit = sx * 0.55 + sy * 0.83;   // the slope turned toward the light
      let r = s[si], g = s[si + 1], b = s[si + 2];
      let v = lit * R;   // every dimple in a little relief, then a glint on the rim facing the light, a dark line on the one away
      if (lit > 0.3) v += (lit - 0.3) * G; else if (lit < -0.4) v -= (-lit - 0.4) * D;
      if (v > 0) { v = Math.min(1, v); r += (255 - r) * v; g += (255 - g) * v; b += (255 - b) * v; }
      else if (v < 0) { v = Math.min(0.85, -v); r *= 1 - v; g *= 1 - v; b *= 1 - v; }
      for (let yy = 0; yy < st && py + yy < H; yy++) for (let xx = 0; xx < st && px + xx < W; xx++) { const di = ((py + yy) * W + px + xx) * 4; d[di] = r; d[di + 1] = g; d[di + 2] = b; d[di + 3] = s[si + 3]; }
    }
  }
}
const PG = { silver: [204, 206, 198], night: [24, 26, 22], light: [255, 246, 228], sky: [250, 196, 172], warm: [255, 170, 92], ink: [30, 30, 28], cream: [246, 240, 226], leaf: [62, 116, 54], vase: [236, 232, 220] };
const pgGround = () => (dark ? PG.night : PG.silver), pgInk = () => (dark ? PG.cream : PG.ink);
/** The flowers' colour: the channel's, made vivid; a rose red where it would sink into the leaves. */
const pgBloom = (C) => { const c = boost(C, 0.5); return near(c, PG.leaf, 100) ? [214, 52, 70] : c; };
/** The window: toward the field's middle, wider as its slider rises. */
function pgPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, ww = fw * (0.16 + 0.16 * p.window), wh = fh * 0.62;
  return { F, wx: F.x0 + fw * 0.58 - ww / 2, wy: F.y0 + fh * 0.1, ww, wh };
}
export const glass = {
  id: "glass",
  art: "figure",
  repaint: (c) => `the photograph as an oil painting seen through a pane of textured hammered glass: loose painterly brush strokes, the whole image warped into wavy ripples and fragments, glints on the bumps of the glass and dark lines in its hollows, warm interior light, with ${c} as an accent; no text.`,
  about: { zh: "压花玻璃：隔着一块起伏的压花玻璃看一幅油画——暖光里的房间、一扇窗、窗前站着的人影（频道图形）、花瓶里的花，先用松散的油画笔触画出来，再被玻璃扭曲、打碎成一片片波纹，凸起处闪着高光、凹处是暗纹；可以再蒙一层雾面，四角暗下去。朦胧、私密、有温度——适合情感、生活、居家、回忆、艺术和电台类内容。照片也会被画成笔触、透过压花玻璃看。可选银灰底或夜色底；自带平直的版式，色块是一块磨砂玻璃。", en: "Patterned glass: an oil painting seen through a pane of hammered glass — a room in warm light, a window, someone standing against it (the channel graphic), flowers in a vase, painted in loose strokes, then bent and broken up by the glass into ripples, glints on the bumps and dark lines in the hollows; frost and darkening corners if you like. Hazy, intimate, warm — for feelings, everyday life, home, memories, art and radio. A photo is painted over and seen through the glass too. A silver or a night ground; flat layouts of its own, the colour block a pane of frosted glass." },
  name: { zh: "压花玻璃", en: "Patterned glass" },
  seeded: true,
  scene: { window: { zh: "窗与窗光", en: "Window and its light" }, figure: { zh: "窗前身影", en: "Figure at the window" }, flowers: { zh: "瓶花", en: "Flowers" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "窗前身影", en: "Figure at the window" } },
    { key: "window", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "窗光", en: "Window light" } },
    { key: "warm", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "暖光", en: "Warm light" } },
    { key: "flowers", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "瓶花", en: "Flowers" } },
    { key: "paint", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "油画笔触", en: "Brush strokes" } },
    { key: "ripple", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "波纹扭曲", en: "Ripple" } },
    { key: "scale", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "纹理大小", en: "Pattern size" } },
    { key: "glint", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "玻璃高光", en: "Glints" } },
    { key: "shade", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "玻璃暗纹", en: "Dark lines" } },
    { key: "frost", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "雾面", en: "Frost" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "暗角", en: "Dark corners" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(pgGround()), text: css(pgInk()), dim: css(pgInk(), 0.6), titleFill: css(pgInk()), titleInk: css(pgGround()), grid: () => css(pgInk(), 0.12) }),
  /**
   * The room: the wall and the floor; the window with its glow and the light it lays on the floor; the
   * figure standing against it; flowers in a vase; brush strokes over all of it; then the glass (see
   * glassWarp) and the frost. A photo is painted over, then seen through the same glass.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = pgPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, cell = u * (0.025 + 0.065 * p.scale);
    const pane = () => {
      glassWarp(ctx, u * 0.085 * p.ripple, cell, p.glint, p.shade, w / 2, h / 2);
      if (p.frost > 0 && canPaint(ctx) && !fast) {
        const soft = softCopy(snap(ctx, "pgSnap"), 12, "pgFrost"), cv = ctx.canvas;
        inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, p.frost * 0.9); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
      }
      if (p.frost > 0) wherePainted(ctx, (c) => wash(c, w, h, "screen", dark ? [60, 62, 56] : [240, 242, 236], 0.4 * p.frost), L.base === "clear");
    };
    if (env.photo) {
      env.drawPhoto();
      if (L.fill) brushwork(ctx, { x0: 0, y0: 0, x1: w, y1: h }, p.paint, u * 0.012, "pgPaint");
      pane();
      return true;
    }
    const floor = F.y0 + fh * 0.8;
    if (L.ground !== false) {   // the room's wall and floor: the ground (the glass goes over it with what stands on it)
      const wall = ctx.createLinearGradient(0, 0, 0, h);
      wall.addColorStop(0, css(dark ? [44, 50, 38] : [196, 200, 186])); wall.addColorStop(0.7, css(dark ? [30, 34, 26] : [168, 172, 156])); wall.addColorStop(1, css(dark ? [20, 22, 18] : [140, 144, 128]));
      ctx.fillStyle = wall; ctx.fillRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, floor, 0, F.y1); g.addColorStop(0, css(dark ? [70, 46, 30] : [156, 110, 72])); g.addColorStop(1, css(dark ? [34, 22, 14] : [104, 70, 44])); ctx.fillStyle = g; ctx.fillRect(F.x0, floor, fw, F.y1 - floor + 4);
    }
    if (!L.grid) return true;
    const { ww, wh } = at, [mx, my] = p.window > 0 || p.warm > 0 ? objAt("window", at.wx + ww / 2, at.wy + wh * 0.3, ctx) : [at.wx + ww / 2, at.wy + wh * 0.3], wx = mx - ww / 2, wy = my - wh * 0.3, wa = Math.min(1, p.window * 3);   // the window and its light: a scene object
    if (p.warm > 0) {   // the window's glow on the wall round it, and the light it lays across the floor
      ctx.save(); ctx.globalCompositeOperation = "screen";
      const g = ctx.createRadialGradient(wx + ww / 2, wy + wh * 0.45, 0, wx + ww / 2, wy + wh * 0.45, Math.max(ww, wh) * 1.3); g.addColorStop(0, css(PG.warm, 0.55 * p.warm)); g.addColorStop(1, css(PG.warm, 0)); ctx.fillStyle = g; ctx.fillRect(F.x0, F.y0, fw, fh);
      ctx.fillStyle = css(PG.warm, 0.45 * p.warm * wa); shapeOf(ctx, [[wx, floor], [wx + ww, floor], [wx + ww * 0.4, F.y1], [wx - ww * 1.3, F.y1]]); ctx.fill();
      ctx.restore();
      wherePainted(ctx, (c) => wash(c, w, h, "soft-light", PG.warm, 0.3 * p.warm), L.base === "clear");
    }
    if (p.window > 0) {   // the window: a bright sky, mullions and a sill
      ctx.save(); ctx.globalAlpha = wa;
      const sky = ctx.createLinearGradient(0, wy, 0, wy + wh); sky.addColorStop(0, css(mix(PG.light, C, 0.12))); sky.addColorStop(0.55, css(mix(PG.sky, PG.light, 0.3))); sky.addColorStop(1, css(PG.sky));
      ctx.fillStyle = sky; ctx.fillRect(wx, wy, ww, wh);
      const bar = Math.max(4, ww * 0.06), fr = css(dark ? [36, 40, 30] : [120, 124, 104]);
      ctx.fillStyle = fr; ctx.fillRect(wx - bar, wy - bar, ww + bar * 2, bar); ctx.fillRect(wx - bar, wy, bar, wh); ctx.fillRect(wx + ww, wy, bar, wh);
      ctx.fillRect(wx + ww / 2 - bar / 2, wy, bar, wh); ctx.fillRect(wx, wy + wh * 0.36, ww, bar * 0.8);
      ctx.fillStyle = css(dark ? [120, 112, 96] : [232, 228, 214]); ctx.fillRect(wx - bar * 2, wy + wh, ww + bar * 4, bar * 1.2);
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // someone standing against the window, dark against the light, soft at the edge
      const size = wh * (0.5 + 0.45 * p.figure), [cx, hy] = objAt("figure", wx + ww * 0.55, Math.min(floor + size * 0.05, wy + wh + size * 0.1) - size * 0.72, ctx), cy = hy + size * 0.3, col = mix(PG.ink, dark ? [40, 30, 24] : [70, 56, 44], 0.4);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.figure * 3);
      blurred(ctx, size * 0.03, css(col, 0.7), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size * 1.02));
      placeShape(ctx, S, col, cx, cy, size);
      ctx.restore();
    }
    if (p.flowers > 0) {   // a white vase on the right, leaves, and blooms in the channel colour
      const vx = F.x0 + fw * 0.86, vy = floor - fh * 0.02, vh = fh * (0.16 + 0.08 * p.flowers), vw = vh * 0.42, bloom = pgBloom(C), n = 2 + p.flowers * 9;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.flowers * 4);
      shift("flowers", vx, vy - vh * 0.6, ctx);   // the vase and its flowers: a scene object
      ctx.beginPath(); ctx.moveTo(vx - vw * 0.3, vy - vh); ctx.bezierCurveTo(vx - vw * 0.2, vy - vh * 0.7, vx - vw * 0.75, vy - vh * 0.5, vx - vw * 0.45, vy); ctx.lineTo(vx + vw * 0.45, vy); ctx.bezierCurveTo(vx + vw * 0.75, vy - vh * 0.5, vx + vw * 0.2, vy - vh * 0.7, vx + vw * 0.3, vy - vh); ctx.closePath();
      const vg = ctx.createLinearGradient(vx - vw / 2, 0, vx + vw / 2, 0); vg.addColorStop(0, css(PG.vase)); vg.addColorStop(1, css(mix(PG.vase, PG.ink, 0.35))); ctx.fillStyle = vg; ctx.fill();
      for (let k = 0; k < Math.ceil(n); k++) {
        const a = -Math.PI / 2 + (rand(k * 2.3 + 2400) - 0.5) * 2.2, d = vh * (0.5 + rand(k * 3.1 + 2401) * 0.6), x = vx + Math.cos(a) * d, y = vy - vh + Math.sin(a) * d * 0.8, r = vh * (0.09 + rand(k * 4.7 + 2402) * 0.07);
        ctx.globalAlpha = Math.min(1, p.flowers * 4) * clamp(n - k);
        ctx.fillStyle = css(mix(PG.leaf, [20, 40, 20], rand(k + 2403) * 0.5)); ctx.beginPath(); ctx.ellipse(x + r * 1.2, y + r * 0.8, r * 1.1, r * 0.5, a + 0.8, 0, TAU); ctx.fill();
        for (let j = 0; j < 4; j++) { ctx.fillStyle = css(mix(bloom, j % 2 ? [255, 236, 236] : [60, 0, 20], 0.12 + 0.25 * (j / 4))); ctx.beginPath(); ctx.arc(x + Math.cos(j * 1.9) * r * 0.45, y + Math.sin(j * 1.9) * r * 0.4, r * (0.9 - j * 0.15), 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    }
    brushwork(ctx, { x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 }, p.paint, u * 0.013, "pgPaint");
    pane();
    return true;
  },
  /** Leaded glass: tall panes, each line of lead a pair of lines. */
  gridLines(ctx, env, color) {
    const { w, h } = env, pw = 160, ph = 240, xs = [], ys = [];
    for (let x = pw; x < w; x += pw) xs.push(x - 4, x + 4);
    for (let y = ph / 2; y < h; y += ph) ys.push(y - 4, y + 4);
    gridPen(ctx, color); gridPath(ctx, xs, ys, 0, 0, w, h); ctx.restore();
  },
  accent: { fill: () => css(dark ? [52, 56, 48] : [226, 228, 220]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2; run(-nx * 3, -ny * 3); ctx.strokeStyle = css(PG.ink, 0.35); ctx.lineWidth = 2; run(nx * 2, ny * 2); } },   // a pane of frosted glass
  /** Serif letters with a soft light round them (on the night ground a warm glow, on the silver one a faint shadow: the shadow slider); highlighted words in the flowers' colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || pgInk(), hi = o.hi || pgBloom(o.C || PG.warm), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css(PG.warm, 0.55) : css(PG.ink, 0.3); ctx.shadowBlur = fs * 0.18 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: PG.ink, light: PG.cream, colour: (c) => mix(boost(c, 0.3), PG.cream, 0.1) }, stroke: { ink: PG.ink, light: PG.cream }, line: 0.6 })),
  sticker: painters({ line: null, tone: inkAs(PG.ink), shadow(ctx, draw) { ctx.save(); ctx.translate(4, 6); draw(css(PG.ink, 0.25)); ctx.restore(); } }),
  /** The corner tag: an etched glass label, frosted, with a bright edge. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6;
    ctx.font = `600 ${f}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.4, h = f * 1.6, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.25); ctx.fillStyle = css(dark ? [80, 84, 76] : [250, 250, 246], 0.55); ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = ink || css(pgInk()); spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the dark wooden frame of the pane, with a bright line inside it. */
  frame(ctx, env) {
    const { w, h } = env;
    ctx.save(); ctx.strokeStyle = css(dark ? [12, 12, 10] : [64, 58, 46], 0.85); ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5; ctx.strokeRect(14, 14, w - 28, h - 28); ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(PG.ink, 0.35); ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { vignette(ctx, w, h, dark ? [0, 0, 0] : [44, 38, 26], 0.85 * p.vignette, 0.35); grain(ctx, 0.18, unit); },
  prompt: `Things for an intimate oil painting of a room — quiet, warm, a little blurred — that read at a glance:
- one clear object per sticker (a cup, a candle, a flower, a book, a lamp, a letter, a cat, a pair of glasses), soft and simple; no realism, no fine detail;
- flat colour only in warm, muted tones: the main colour, cream ("white"), a warm brown ("ink"), soft greens;
- the app adds a soft shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Furniture of a quiet room, built as simple models from a few boxes and cylinders — a chair, a table, a lamp, a vase, a radio; no realism, no fine detail.
- the renderer paints faces in soft warm tones: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep brown, and "main" the channel colour, softened — use it for one to three parts.`,
};
glass.elementFx = [
  { key: "glass", name: { zh: "压花玻璃", en: "Patterned glass" }, for: FX_ALL, stage: "filter",
    sub: [{ key: "scale", name: { zh: "纹理大小", en: "Pattern size" }, def: 0.4 }, { key: "glint", name: { zh: "玻璃高光", en: "Glints" }, def: 0.45 }, { key: "shade", name: { zh: "玻璃暗纹", en: "Dark lines" }, def: 0.4 }],
    /** The layer seen through hammered glass (see glassWarp), the pattern fixed to the cover. */
    paint(x, B, a, E, o) {
      const img = x.getImageData(B.x0, B.y0, B.w, B.h), out = x.createImageData(B.w, B.h), unit = Math.min(x.canvas.width, x.canvas.height) / E.k;
      glassPixels(img.data, out.data, B.w, B.h, E.k, -B.x0, -B.y0, unit * 0.085 * a, unit * (0.025 + 0.065 * o.scale), o.glint * Math.min(1, a * 2), o.shade * Math.min(1, a * 2), 0, 0);
      x.putImageData(out, B.x0, B.y0);
    } },
  { key: "paint", name: { zh: "油画笔触", en: "Brush strokes" }, for: FX_ALL, stage: "filter",
    /** The layer painted over in short strokes of its own colours, each across the change in lightness. */
    paint(x, B, a, E) {
      const c = Math.max(3, 12 * E.k), [d, cols, rows] = cellsOf(x, B, c);
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, a * 0.9); x.lineCap = "round"; x.lineWidth = c * 0.9;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4;
        if (d[q + 3] < 200) continue;
        const L = (ii, jj) => lumOf(d, (Math.min(rows - 1, Math.max(0, jj)) * cols + Math.min(cols - 1, Math.max(0, ii))) * 4), gx = L(i + 1, j) - L(i - 1, j), gy = L(i, j + 1) - L(i, j - 1);
        const cx = B.x0 + (i + 0.5 + (E.R(q * 1.7) - 0.5) * 0.8) * c, cy = B.y0 + (j + 0.5 + (E.R(q * 2.3) - 0.5) * 0.8) * c, t = (Math.hypot(gx, gy) > 0.03 ? Math.atan2(gy, gx) + Math.PI / 2 : 0.7) + (E.R(q * 3.1) - 0.5) * 0.5, len = c * (1.2 + E.R(q * 3.7) * 1.4), v = (E.R(q * 4.3) - 0.5) * 26;
        x.strokeStyle = `rgb(${(d[q] + v) | 0},${(d[q + 1] + v) | 0},${(d[q + 2] + v) | 0})`; x.beginPath(); x.moveTo(cx - (Math.cos(t) * len) / 2, cy - (Math.sin(t) * len) / 2); x.lineTo(cx + (Math.cos(t) * len) / 2, cy + (Math.sin(t) * len) / 2); x.stroke();
      }
      x.restore();
    } },
  { key: "frost", name: { zh: "雾面", en: "Frost" }, for: FX_ALL, stage: "filter",
    /** The layer behind frosted glass: softened, a milky haze over it. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), soft = softened(src, 4 + 8 * a, "fxFr"); x.save(); x.globalCompositeOperation = "source-atop"; x.imageSmoothingEnabled = true; x.globalAlpha = Math.min(1, a * 0.9); x.drawImage(soft, B.x0, B.y0, B.w, B.h); x.globalAlpha = 0.35 * a; x.fillStyle = css(dark ? [90, 92, 86] : [244, 246, 240]); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore(); } },
];
