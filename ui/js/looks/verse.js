// verse: the comic book come to life
// Animated films that print like comic books: flat colour shaded with Ben-Day dots and hatching, an ink
// line, the colour plates out of register; towers seen from the street; focus lines; neon scribbles, a
// yellow caption box, a sound effect; the dimension glitching in bars of magenta and cyan.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, boost, canPaint, clamp, css, dark, dotFill, dotScreen, dotsFx, fall, fxCanvas, grain, graphicShape, greeked, gridPen, inPixels, inkAs, layDown, mapTones, mapped, mix, near, objAt, onLayer, openField, painters, placeShape, posterize, rand, rePlate, region, ringsBehind, shadeSide, shapeIn, shapeOf, shift, snap, starburst, toneTable, tonesFx, upright, wherePainted, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

/** A repeating tile of dots on a 45° lattice, as a fill (kept per colour and pitch). */
function dotPattern(ctx, colour, pitch) {
  const p = Math.max(2, Math.round(pitch)), key = `dotp|${colour.join()}|${p}`;
  let c = WORK[key];
  if (!c) {
    c = WORK[key] = document.createElement("canvas"); c.width = c.height = p * 2;
    const x = c.getContext("2d"); x.fillStyle = css(colour);
    for (const [a, b] of [[0.5, 0.5], [1.5, 1.5]]) { x.beginPath(); x.arc(a * p, b * p, p * 0.36, 0, TAU); x.fill(); }
  }
  return ctx.createPattern(c, "repeat");
}
const VS = { night: [26, 14, 48], paper: [248, 244, 246], ink: [24, 16, 36], magenta: [255, 40, 150], cyan: [0, 196, 255], violet: [116, 66, 230], yellow: [255, 226, 56], white: [255, 255, 255] };
const vsGround = () => (dark ? VS.night : VS.paper), vsInk = () => (dark ? VS.white : VS.ink);
/** The figure's colour: the channel's, made vivid; magenta where it would sink into the ground. */
const vsBody = (C) => { const c = boost(C, 0.6); return near(c, vsGround(), 120) ? VS.magenta : c; };
function vsPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
/**
 * Comic colour out of register: the red plate moved one way and the blue one the other, `d` units. Each
 * plate is lifted off the picture (its channel multiplied out) and laid back moved (added), so only its
 * edges show; the strip it leaves bare at the canvas's edge gets it back unmoved.
 */
function plateShift(ctx, d) {
  if (d <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "vsShift"), k = ctx.getTransform().a, W = src.width, H = src.height;
  for (const [s, keep] of [[-1, [255, 0, 0]], [1, [0, 0, 255]]]) {
    const x = workLike(ctx, "vsPlate"); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(src, 0, 0);
    x.globalCompositeOperation = "multiply"; x.fillStyle = css(keep); x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = "destination-in"; x.drawImage(src, 0, 0);
    const dx = Math.round(s * d * k), dy = Math.round(s * d * k * 0.35);
    inPixels(ctx, () => {
      ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(keep.map((v) => 255 - v)); ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter"; ctx.drawImage(x.canvas, dx, dy);
      ctx.beginPath();
      if (dx) ctx.rect(dx > 0 ? 0 : W + dx, 0, Math.abs(dx), H);
      if (dy) ctx.rect(0, dy > 0 ? 0 : H + dy, W, Math.abs(dy));
      ctx.clip(); ctx.drawImage(x.canvas, 0, 0);
    });
  }
}
/**
 * Towers seen from the street, leaning in toward a point high above the field: three on each side,
 * their floors and windows converging, a few windows lit, a rim of neon on the inner edge and a halftone
 * on the face. `amt` brings them in by degrees, the nearest (outermost) first, and raises them.
 */
function vsTowers(ctx, F, amt, tone, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, V = [F.x0 + fw * 0.52, F.y0 - fh * 1.1], base = F.y1 + 4, P = (x, t) => [x + (V[0] - x) * t, base + (V[1] - base) * t];
  const face = dark ? [58, 34, 104] : [224, 216, 238], top = dark ? [92, 56, 150] : [238, 232, 246], line = VS.ink, lit = [VS.yellow, VS.cyan, VS.magenta, [255, 170, 80]];
  ctx.save(); ctx.lineJoin = "miter";
  for (let i = 2; i >= 0; i--) for (const s of [-1, 1]) {
    const r = clamp(amt * 6 - (i * 2 + (s > 0 ? 1 : 0)));
    if (r <= 0) continue;
    const kk = k0 + i * 7 + (s > 0 ? 3 : 0), bw = fw * (0.2 - i * 0.03), xo = s < 0 ? F.x0 - fw * 0.06 + i * fw * 0.13 : F.x1 + fw * 0.06 - i * fw * 0.13, xi = xo - s * bw, t = (0.5 - i * 0.1 + rand(kk) * 0.12) * (0.3 + 0.7 * r);
    const quad = (a0, a1, t0, t1) => shapeOf(ctx, [P(xo + (xi - xo) * a0, t0), P(xo + (xi - xo) * a1, t0), P(xo + (xi - xo) * a1, t1), P(xo + (xi - xo) * a0, t1)]);
    ctx.globalAlpha = Math.min(1, r * 2.5);
    quad(0, 1, 0, t); const g = ctx.createLinearGradient(0, base, 0, P(xo, t)[1]); g.addColorStop(0, css(mix(face, VS.ink, 0.35))); g.addColorStop(1, css(top)); ctx.fillStyle = g; ctx.fill();
    if (tone > 0 && canPaint(ctx)) { ctx.save(); ctx.clip(); ctx.globalAlpha *= 0.3 * tone; ctx.fillStyle = dotPattern(ctx, VS.ink, 7); ctx.fillRect(F.x0 - fw, F.y0 - fh, fw * 3, fh * 3); ctx.restore(); }
    const floors = 9 + Math.floor(rand(kk + 1) * 6), cols = 3 + Math.floor(rand(kk + 2) * 3), windows = new Map();
    for (let f = 0; f < floors; f++) for (let c = 0; c < cols; c++) {
      const q = rand(kk * 31 + f * 3.7 + c * 1.3), col = q > 0.74 ? lit[Math.floor(q * 97) % lit.length] : null, key = col ? col.join() : "dark";
      (windows.get(key) || windows.set(key, { col, list: [] }).get(key)).list.push([(c + 0.18) / cols, (c + 0.82) / cols, (t * (f + 0.25)) / floors, (t * (f + 0.75)) / floors]);
    }
    for (const { col, list } of windows.values()) {
      ctx.beginPath(); for (const [a0, a1, t0, t1] of list) { const pts = [P(xo + (xi - xo) * a0, t0), P(xo + (xi - xo) * a1, t0), P(xo + (xi - xo) * a1, t1), P(xo + (xi - xo) * a0, t1)]; pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); }
      ctx.fillStyle = col ? css(col) : css(VS.ink, dark ? 0.6 : 0.35); ctx.fill();
    }
    quad(0, 1, 0, t); ctx.strokeStyle = css(line); ctx.lineWidth = 3; ctx.stroke();
    const [ax, ay] = P(xi, 0), [bx, by] = P(xi, t); ctx.strokeStyle = css(s < 0 ? VS.cyan : VS.magenta); ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(ax - s * 4, ay); ctx.lineTo(bx - s * 4, by); ctx.stroke();
  }
  ctx.restore();
}
/** Neon marker scribbles: a coil, a zigzag, an arrow, a star, a scrawl of handwriting — in cyan, magenta, yellow and green. */
function scribbles(ctx, F, amt, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, cols = [VS.cyan, VS.magenta, VS.yellow, [120, 255, 140]], n = amt * 10;
  ctx.save(); ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (let k = 0; k < Math.ceil(n); k++) {
    const x = F.x0 + fw * (0.06 + rand(k * 2.9 + k0) * 0.86), y = F.y0 + fh * (0.08 + rand(k * 3.7 + k0 + 1) * 0.84), s = Math.min(fw, fh) * (0.06 + rand(k * 4.1 + k0 + 2) * 0.08), c = cols[k % cols.length];
    ctx.globalAlpha = clamp(n - k); ctx.strokeStyle = css(c); ctx.lineWidth = 4 + rand(k + k0 + 3) * 4;
    if (dark) { ctx.shadowColor = css(c, 0.8); ctx.shadowBlur = 10; }
    ctx.beginPath();
    switch (k % 5) {
      case 0: for (let t = 0; t <= 4 * Math.PI; t += 0.2) ctx.lineTo(x + Math.cos(t) * s * 0.45 + t * s * 0.14, y + Math.sin(t) * s * 0.4); break;   // a coil
      case 1: for (let i = 0; i < 7; i++) ctx.lineTo(x + i * s * 0.32, y + (i % 2 ? -s * 0.35 : s * 0.35)); break;                                    // a zigzag
      case 2: ctx.moveTo(x, y + s * 0.5); ctx.quadraticCurveTo(x + s, y - s * 0.6, x + s * 1.8, y); ctx.moveTo(x + s * 1.45, y - s * 0.3); ctx.lineTo(x + s * 1.8, y); ctx.lineTo(x + s * 1.4, y + s * 0.22); break;   // an arrow
      case 3: for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? s * 0.22 : s * 0.55; ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } break;   // a star
      default: for (let t = 0; t <= 1; t += 0.02) { const xx = x + t * s * 3, yy = y + Math.sin(t * 38) * s * 0.18 * (0.6 + rand(k * 5 + Math.floor(t * 8) + k0) * 0.8); ctx.lineTo(xx, yy); }   // handwriting
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.restore();
}
export const verse = {
  id: "verse",
  art: "figure",
  repaint: (c) => `a frame of an animated film that looks printed like a comic book, made from the photograph: flat colour shaded with Ben-Day halftone dots and hatching lines, bold ink outlines, the colour plates slightly out of register with magenta and cyan fringes, neon magenta, violet and cyan light, with ${c} as an accent; still the same picture, no text.`,
  about: { zh: "漫画宇宙：把漫画印刷搬进动画电影的那种画面——平涂色块用网点和排线上阴影，粗墨线，套色故意错开；从街上仰望的楼群和亮着的窗，集中线，霓虹马克笔涂鸦，黄色旁白框和拟声字，空间撕裂般的品红、青色故障条。频道图形变成一个漫画上色的角色剪影。热闹、炫目、年轻——适合动画、游戏、潮流、音乐、青年文化和娱乐类内容。照片会被压成漫画配色、加上网点。可选纸白底或紫夜底；自带平直的版式，色块是带网点的频道色。", en: "Comic-verse: animated films that print like comic books — flat colour shaded with Ben-Day dots and hatching, a heavy ink line, the colour plates deliberately out of register; towers seen from the street with lit windows, focus lines, neon marker scribbles, a yellow caption box and a sound effect, the dimension glitching in bars of magenta and cyan. The channel graphic as a comic-coloured figure. Loud, dazzling, young — for animation, games, street fashion, music, youth culture and entertainment. A photo is pressed into comic colours with a halftone. A paper-white or violet-night ground; flat layouts of its own, the colour block the channel colour in halftone." },
  name: { zh: "漫画宇宙", en: "Comic-verse" },
  seeded: true,
  scene: { figure: { zh: "漫画身影", en: "Comic figure" }, focus: { zh: "集中线中心", en: "Centre of the focus lines" }, caption: { zh: "旁白框", en: "Caption box" }, sfx: { zh: "拟声字", en: "Sound effect" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "漫画身影", en: "Comic figure" } },
    { key: "towers", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "仰视楼群", en: "Towers from below" } },
    { key: "speed", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "集中线", en: "Focus lines" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "网点", en: "Halftone" } },
    { key: "hatch", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "排线", en: "Hatching" } },
    { key: "offset", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "套色错位", en: "Off-register" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "维度故障", en: "Dimension glitch" } },
    { key: "scribble", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "霓虹涂鸦", en: "Neon scribbles" } },
    { key: "caption", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旁白框", en: "Caption box" } },
    { key: "sfx", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "拟声字", en: "Sound effect" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "颗粒", en: "Grain" } },
    { key: "comic", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "照片漫画化", en: "Photo as comic" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(vsGround()), text: css(vsInk()), dim: css(vsInk(), 0.6), titleFill: css(vsInk()), titleInk: css(vsGround()), grid: () => css(vsInk(), 0.14) }),
  /**
   * The ground (a city glow rising on the night one); towers seen from below; focus lines; scribbles;
   * the figure (on a work canvas: an ink line round it, the flat colour, a shade cut from it and filled
   * with dots and hatching, a pale rim on the lit side); the caption box and the sound effect; glitch
   * bars; then the colour plates pulled out of register over all of it. A photo is pressed into the
   * palette, screened, glitched when it fills the canvas, and put out of register too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = vsPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    if (L.ground !== false) { ctx.fillStyle = css(vsGround()); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false && dark) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(VS.night, 0)); g.addColorStop(1, css([120, 30, 120], 0.55)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    const glitch = (box) => {
      if (p.glitch <= 0 || !canPaint(ctx)) return;
      const src = snap(ctx, "vsGlitch"), m = ctx.getTransform(), k = m.a, bw0 = box.x1 - box.x0, bh0 = box.y1 - box.y0;
      for (let i = 0, n = Math.round(2 + 10 * p.glitch); i < n; i++) {
        const y = box.y0 + bh0 * rand(i * 2.1 + 2300), bh = u * (0.01 + rand(i * 2.9 + 2301) * 0.05), x0 = box.x0 + bw0 * rand(i * 3.7 + 2302) * 0.7, bw = bw0 * (0.1 + rand(i * 4.3 + 2303) * 0.4), dx = (rand(i * 5.1 + 2304) - 0.5) * u * 0.08 * (0.5 + p.glitch);
        ctx.save(); ctx.beginPath(); ctx.rect(x0, y, bw, bh); ctx.clip();
        inPixels(ctx, () => ctx.drawImage(src, dx * k, 0));
        ctx.globalCompositeOperation = dark ? "screen" : "multiply"; ctx.fillStyle = css(i % 2 ? VS.cyan : VS.magenta, 0.6); ctx.fillRect(x0, y, bw, bh);
        ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = css(VS.ink, 0.25); for (let yy = y; yy < y + bh; yy += 4) ctx.fillRect(x0, yy, bw, 1.4);
        ctx.restore();
      }
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable(dark ? [[0, VS.ink], [0.3, VS.violet], [0.55, VS.magenta], [0.8, [255, 176, 130]], [1, VS.white]] : [[0, VS.ink], [0.3, [74, 52, 150]], [0.56, [236, 74, 146]], [0.8, [255, 214, 196]], [1, VS.white]], 0.55), p.comic * 0.9);
      dotScreen(ctx, w, h, VS.ink, 7, 0.4 * p.halftone);
      if (L.fill) glitch({ x0: 0, y0: 0, x1: w, y1: h });
      plateShift(ctx, u * 0.012 * p.offset);
      return true;
    }
    if (!L.grid) return true;
    if (p.towers > 0) vsTowers(ctx, F, p.towers, p.halftone, 2310);
    if (p.speed > 0) {   // focus lines: thin wedges closing in on the figure from the edges
      const R = Math.hypot(fw, fh), r0 = at.size * 0.62;
      ctx.save(); ctx.fillStyle = css(vsInk(), dark ? 0.55 : 0.8); ctx.beginPath();
      shift("focus", at.cx, at.cy, ctx);   // their centre: a scene object
      for (let i = 0, n = Math.round(20 + 150 * p.speed); i < n; i++) { const a = rand(i * 1.7 + 2320) * TAU, wd = 0.002 + rand(i * 2.3 + 2321) * 0.009, r1 = r0 * (1 + rand(i * 3.1 + 2322) * 0.8); ctx.moveTo(at.cx + Math.cos(a) * r1, at.cy + Math.sin(a) * r1); ctx.lineTo(at.cx + Math.cos(a - wd) * R, at.cy + Math.sin(a - wd) * R); ctx.lineTo(at.cx + Math.cos(a + wd) * R, at.cy + Math.sin(a + wd) * R); ctx.closePath(); }
      ctx.fill(); ctx.restore();
    }
    if (p.scribble > 0) scribbles(ctx, F, p.scribble, 2330);
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, hy] = objAt("figure", at.cx, at.cy - size * 0.3, ctx), cy = hy + size * 0.3, body = vsBody(C), d = size * 0.1, x = workLike(ctx, "verse"), y = workLike(ctx, "verseShade"), o = size * 0.012;   // a scene object, its handle at the head
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; placeShape(x, S, VS.ink, cx + Math.cos(a) * o, cy + Math.sin(a) * o, size); }   // the ink line
      placeShape(x, S, body, cx, cy, size);
      // the shade: the shape less a copy moved toward the light, filled with dots and hatching
      placeShape(y, S, mix(body, VS.ink, 0.38), cx, cy, size);
      y.globalCompositeOperation = "destination-out"; placeShape(y, S, [0, 0, 0], cx - d, cy - d * 1.3, size);
      y.globalCompositeOperation = "source-atop";
      if (p.halftone > 0) { y.globalAlpha = 0.85 * p.halftone; y.fillStyle = dotPattern(y, VS.ink, Math.max(5, size * 0.02)); y.fillRect(0, 0, w, h); }
      if (p.hatch > 0) {
        y.globalAlpha = 0.8 * Math.min(1, p.hatch * 1.5); y.strokeStyle = css(VS.ink); y.lineWidth = Math.max(1.2, size * 0.004); y.beginPath();
        for (let t = -size; t < size * 1.4; t += size * (0.028 - 0.012 * p.hatch)) { y.moveTo(cx - size * 0.8 + t, cy + size * 0.7); y.lineTo(cx - size * 0.8 + t + size * 0.9, cy - size * 0.7); }
        y.stroke();
      }
      y.globalAlpha = 1; y.globalCompositeOperation = "source-over";
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(y.canvas, 0, 0); x.restore();
      const z = workLike(ctx, "verseShade");   // the lit rim: the shape less a copy moved away from the light
      placeShape(z, S, mix(body, VS.white, 0.55), cx, cy, size); z.globalCompositeOperation = "destination-out"; placeShape(z, S, [0, 0, 0], cx + d * 0.2, cy + d * 0.28, size);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(z.canvas, 0, 0); x.restore();
      layDown(ctx, x);
    }
    if (p.caption > 0) {   // a yellow caption box with a few lines of narration
      const bw = u * (0.16 + 0.14 * p.caption), bh = bw * 0.42, bx = clamp(at.cx + at.size * 0.08, F.x0 + 20, F.x1 - bw - 20), by = clamp(at.cy - at.size * 0.62, F.y0 + 20, F.y1 - bh - 20);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.caption * 4);
      shift("caption", bx + bw / 2, by + bh / 2, ctx);   // a scene object
      ctx.fillStyle = css(VS.ink); ctx.fillRect(bx + 6, by + 6, bw, bh);
      ctx.fillStyle = css(VS.yellow); ctx.fillRect(bx, by, bw, bh); ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 3; ctx.strokeRect(bx, by, bw, bh);
      greeked(ctx, bx + bw * 0.08, by + bh * 0.24, bw * 0.84, 3, bh * 0.2, css(VS.ink, 0.85), 2360);
      ctx.restore();
    }
    if (p.sfx > 0) {   // a sound effect: the channel's code (or POW) on a starburst
      const str = ((env.cat && env.cat.code) || "POW").toUpperCase().slice(0, 5) + "!", R = u * (0.07 + 0.09 * p.sfx), bx = clamp(at.cx - at.size * 0.55, F.x0 + R, F.x1 - R), by = clamp(at.cy + at.size * 0.3, F.y0 + R, F.y1 - R);
      ctx.save(); ctx.globalAlpha = Math.min(1, p.sfx * 4);
      shift("sfx", bx, by, ctx);   // a scene object
      starburst(ctx, bx + R * 0.07, by + R * 0.09, R * 1.04, 12, VS.ink, 2350); starburst(ctx, bx, by, R, 12, VS.yellow, 2350);
      ctx.translate(bx, by); ctx.rotate(-0.18); ctx.font = `900 100px ${fonts.en}, ${fonts.cn}`;
      const fs = Math.min(R * 0.75, (R * 1.3 * 100) / Math.max(1, ctx.measureText(str).width));
      ctx.font = `900 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      ctx.lineWidth = fs * 0.14; ctx.strokeStyle = css(VS.ink); ctx.strokeText(str, 0, 0); ctx.fillStyle = css(VS.magenta); ctx.fillText(str, 0, 0);
      ctx.restore();
    }
    glitch({ x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 });
    if (p.offset > 0) wherePainted(ctx, (c) => plateShift(c, u * 0.012 * p.offset), L.base === "clear");
    return true;
  },
  /** A comic page's panels: three tiers, cut into two, three and two panels, with gutters between. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 40, g = 22, tiers = [[0.36, [0.58, 0.42]], [0.3, [0.28, 0.44, 0.28]], [0.34, [0.42, 0.58]]], H = h - 2 * m - g * 2, W = w - 2 * m;
    gridPen(ctx, color, 3); ctx.beginPath();
    let y = m;
    for (const [th, cols] of tiers) { const ph = H * th, ww = W - g * (cols.length - 1); let x = m; for (const c of cols) { ctx.rect(x, y, ww * c, ph); x += ww * c + g; } y += ph + g; }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(vsBody(C)), tone: () => css(VS.ink, 0.55), toneScale: 1, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 9; run(0, 0); ctx.strokeStyle = css(VS.cyan); ctx.lineWidth = 4; run(nx * 12, ny * 12); } },   // the channel colour in halftone, an ink edge and a cyan line out of register
  /** Comic lettering: a drop in magenta halftone and the cyan plate a little the other way (the shadow slider); highlighted words yellow with an ink line. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, d = fs * 0.07 * Math.min(2, o.shadowAmt), ink = o.fill || vsInk(), hi = o.hi || VS.yellow;
    if (d > 0) {
      ctx.save();
      const [mx, my] = fall(d, d), [cx, cy] = fall(-d * 0.35, -d * 0.2);   // the two inks off register as the page has them
      ctx.fillStyle = canPaint(ctx) ? dotPattern(ctx, VS.magenta, Math.max(3, fs * 0.045)) : css(VS.magenta); pass((a, x) => ctx.fillText(a.t, x + mx, my));
      ctx.globalAlpha = 0.85; ctx.fillStyle = css(VS.cyan); pass((a, x) => ctx.fillText(a.t, x + cx, cy));
      ctx.restore();
    }
    ctx.lineJoin = "round"; ctx.strokeStyle = css(VS.ink); ctx.lineWidth = fs * 0.08;
    pass((a, x) => { if (a.hi) ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: VS.ink, light: VS.white, mid: [206, 196, 226], dark: [62, 40, 96], colour: (c) => boost(c, 0.6) }, stroke: { ink: VS.ink, light: VS.white }, line: 1.1 })),
  sticker: painters({ line: VS.ink, lineScale: 0.9, tone: inkAs(VS.ink, (c) => boost(c, 0.6)), shadow(ctx, draw) { ctx.save(); ctx.translate(8, 8); draw(css(VS.magenta, 0.85)); ctx.restore(); } }),
  /** The corner tag: a yellow caption box, an ink line and a hard shadow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62;
    ctx.font = `900 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    const [sx, sy] = fall(5, 5);
    ctx.fillStyle = css(VS.ink); ctx.fillRect(x + sx, top + sy, w, h);
    ctx.fillStyle = css(VS.yellow); ctx.fillRect(x, top, w, h); ctx.strokeStyle = css(VS.ink); ctx.lineWidth = 3; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = ink || css(VS.ink); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 10, h: h + 10 };
  },
  /** The frame layer: the border of a comic panel. */
  frame(ctx, env) { const { w, h } = env; ctx.save(); ctx.strokeStyle = css(vsInk()); ctx.lineWidth = 6; ctx.strokeRect(22, 22, w - 44, h - 44); ctx.restore(); },
  image(ctx, C, unit) { ctx.shadowColor = css(VS.magenta, 0.8); ctx.shadowBlur = 0; ctx.shadowOffsetX = 8 * unit; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit, !dark); },
  prompt: `Stickers for an animated film printed like a comic book — loud, graphic, full of energy — that read at a glance:
- one clear object per sticker (a mask, a sneaker, a spray can, a lightning bolt, a speech balloon, a skateboard, headphones, a pigeon, a star), bold and simple; no realism, no fine detail;
- flat colour only: the main colour with "pink" (hot magenta), "blue" (cyan), "yellow" and "white" as partners; "ink" for the darkest parts;
- the app adds a heavy ink outline and a magenta offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a comic-book city, built as simple models from a few boxes and cylinders — a water tower, a taxi, a subway entrance, a phone booth, a fire hydrant; no realism, no fine detail.
- the renderer paints faces in flat comic colours with a heavy ink line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep violet, and "main" the channel colour made vivid — use it for one to three parts.`,
};
verse.elementFx = [
  { key: "comic", name: { zh: "漫画上色", en: "Comic colouring" }, for: FX_ALL, stage: "fill", reach: (B, k) => ({ l: 8 * k, t: 8 * k, r: 8 * k, b: 8 * k }),
    /** The layer coloured as a comic: its colours flattened, an ink line round it, its shaded side in dots. */
    paint(x, B, a, E) {
      posterize(x, B, a);
      const src = region(x, B, "fxA"), o = (1.5 + 3 * a) * E.k, d = Math.min(B.w, B.h) * 0.08;
      const sh = fxCanvas("fxSh", B.w, B.h), g = sh.getContext("2d");
      g.globalCompositeOperation = "copy"; g.drawImage(shapeIn(src, VS.ink, "fxShI"), 0, 0); g.globalCompositeOperation = "destination-out"; g.drawImage(src, -d, -d * 1.2);
      g.globalCompositeOperation = "source-in"; g.fillStyle = dotFill(g, VS.ink, Math.max(4, 6 * E.k), Math.max(4, 6 * E.k) * 0.32); g.fillRect(0, 0, B.w, B.h);
      x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.85 * a; x.drawImage(sh, B.x0, B.y0); x.restore();
      x.save(); x.globalAlpha = Math.min(1, a * 3); ringsBehind(x, B, src, [[VS.ink, o]]); x.restore();
    } },
  { key: "halftone", name: { zh: "网点", en: "Halftone" }, for: FX_ALL, stage: "over",
    /** Ben-Day dots of ink over the layer's shaded side. */
    paint: dotsFx({ colour: () => VS.ink, pitch: (E) => 6 * E.k, size: (p, a) => p * (0.1 + 0.25 * a), shade: true }) },
  { key: "hatch", name: { zh: "排线", en: "Hatching" }, for: FX_ALL, stage: "over",
    /** Diagonal hatching in ink over the layer's shaded side, closer as it rises. */
    paint(x, B, a, E) {
      onLayer(x, B, region(x, B, "fxA"), "multiply", Math.min(1, a * 1.4), (g) => {
        g.strokeStyle = css(VS.ink); g.lineWidth = Math.max(1, E.k * 1.1); g.beginPath();
        const step = Math.max(3, (9 - 4 * a) * E.k); for (let t = -B.h; t < B.w + B.h; t += step) { g.moveTo(t, B.h); g.lineTo(t + B.h, 0); }
        g.stroke(); g.globalCompositeOperation = "destination-in"; g.fillStyle = shadeSide(g, B.w, B.h); g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "offset", name: { zh: "套色错位", en: "Off-register" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 12 * k, t: 6 * k, r: 12 * k, b: 6 * k }),
    /** The red plate printed a little up and left, the blue a little down and right, the green in register. */
    paint(x, B, a, E) { const d = (1 + 7 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d, -d * 0.35], [[0, 255, 0], 0, 0], [[0, 0, 255], d, d * 0.35]]); } },
  { key: "glitch", name: { zh: "维度故障", en: "Dimension glitch" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.1, r: B.w * 0.1 }),
    /** Bars of the layer slipping sideways, tinted magenta and cyan, with scan lines through them. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      for (let i = 0, n = Math.round(1 + 6 * a); i < n; i++) {
        const y = B.y0 + B.h * E.R(i * 2.1 + 161) * 0.9, bh = B.h * (0.04 + E.R(i * 2.9 + 162) * 0.14), bx = B.x0 + B.w * E.R(i * 3.7 + 163) * 0.6, bw = B.w * (0.2 + E.R(i * 4.3 + 164) * 0.5), dx = (E.R(i * 5.1 + 165) - 0.5) * B.w * 0.16 * (0.5 + a);
        x.save(); x.beginPath(); x.rect(bx, y, bw, bh); x.clip(); x.clearRect(bx, y, bw, bh); x.drawImage(src, B.x0 + dx, B.y0);
        x.globalCompositeOperation = "source-atop"; x.fillStyle = css(i % 2 ? VS.cyan : VS.magenta, 0.45); x.fillRect(bx, y, bw, bh);
        x.fillStyle = css(VS.ink, 0.25); for (let yy = y; yy < y + bh; yy += 3 * E.k) x.fillRect(bx, yy, bw, Math.max(1, E.k * 0.7)); x.restore();
      }
    } },
  { key: "photo", name: { zh: "照片漫画化", en: "Photo as comic" }, for: FX_PHOTO, stage: "filter",
    /** The photo pressed into comic colours, then screened. */
    paint(x, B, a, E) {
      tonesFx(() => (dark ? [[0, VS.ink], [0.3, VS.violet], [0.55, VS.magenta], [0.8, [255, 176, 130]], [1, VS.white]] : [[0, VS.ink], [0.3, [74, 52, 150]], [0.56, [236, 74, 146]], [0.8, [255, 214, 196]], [1, VS.white]]), 0.55)(x, B, a, E);
      dotsFx({ colour: () => VS.ink, pitch: (G) => 6 * G.k, size: (p, s) => p * 0.24 * s })(x, B, a, E);
    } },
];
