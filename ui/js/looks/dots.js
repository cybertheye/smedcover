// dot matrix: pictures made of points of light
// Everything made of dots of light on black, as an LED wall or a point cloud: the figure (or the photo)
// read into a grid of dots sized by their brightness, a rolling surface of dots in depth, rainbow colour
// breaking through at the lower edges, dots smeared sideways in motion, a red-and-cyan fringe, a glow,
// columns of digits, scattered stars.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, canPaint, cellsOf, clamp, css, fast, glowBehind, grain, graphicShape, gridPen, inPixels, lumOf, mapped, mix, noise, objAt, onLayer, openField, painters, rainbow, rand, rePlate, region, rgbFringe, sampled, shapeCells, snap, softCopy, spacedCentre, upright, wherePainted } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const DM = { black: [4, 4, 6], white: [245, 245, 238] };
/** The size of a grid cell, in units: the Dot spacing slider. */
const dmCell = (p) => 9 + 22 * p.pitch;
/**
 * Draws one grid of dots: `level(i, j)` (0–1) sizes each cell's dot; its colour is `colour(i, j)` or
 * white, with rainbow breaking in toward the bottom of the picture (Rainbow), and the dot smeared
 * sideways (Smear). Batched by colour, so thousands of dots stay quick.
 */
function dotGrid(ctx, env, p, x0, y0, cols, rows, cell, level, colour) {
  const { h } = env, rx = 1 + p.smear * 4, batch = new Map();
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = level(i, j);
    if (v < 0.06) continue;
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell, r = cell * 0.36 * Math.sqrt(v);   // even at full, the dots stand apart
    let c = colour ? colour(i, j) : DM.white;
    const rb = p.rainbow > 0 ? clamp(p.rainbow * 1.8 - (1 - y / h) * 1.4 + (noise(i * 0.31 + j * 0.17) - 0.5) * 0.6) : 0;
    if (rb > 0) c = mix(c, rainbow(x / env.w * 1.4 + noise(j * 0.11) * 0.5), rb);
    const key = c.map((q) => Math.round(q / 24) * 24).join();
    (batch.get(key) || batch.set(key, []).get(key)).push(x, y, r);
  }
  for (const [key, list] of batch) {
    ctx.fillStyle = `rgb(${key})`; ctx.beginPath();
    for (let q = 0; q < list.length; q += 3) { const [x, y, r] = [list[q], list[q + 1], list[q + 2]]; ctx.moveTo(x + r * rx, y); ctx.ellipse(x, y, r * rx, r, 0, 0, TAU); }
    ctx.fill();
  }
}
export const dots = {
  id: "dots",
  art: "figure",
  repaint: (c) => `the photograph rebuilt as a point cloud of light on black: the subject made of thousands of glowing white dots sized by brightness, streaks of rainbow colour and a little horizontal motion smear, deep black everywhere else, with ${c} as an accent; no text.`,
  about: { zh: "点阵光影：一切都由黑底上的光点组成，像 LED 屏或三维点云——频道图形（有照片时是照片）被读成一格一格的光点，越亮的地方点越大；身后一片起伏的点阵曲面伸向远处，下沿透出彩虹色，光点可以横向拖成光痕，加上红青色彩错位、辉光、一列列数字和零星的星点。冷、未来感、带一点迷幻——适合科技、音乐、电子、夜景、AI 和数据类内容。", en: "Dot matrix: everything made of points of light on black, as an LED wall or a point cloud — the channel graphic (or the photo) read into a grid of dots, larger where it is brighter; a rolling surface of dots running into the distance behind, rainbow colour breaking through at the lower edges, dots smeared into streaks of motion, a red-and-cyan fringe, a glow, columns of digits and scattered stars. Cool, futuristic, a little psychedelic — for tech, music, electronic, night scenes, AI and data." },
  name: { zh: "点阵光影", en: "Dot matrix" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "点阵身影", en: "Dot figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "点阵身影", en: "Figure in dots" } },
    { key: "pitch", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "点距", en: "Dot spacing" } },
    { key: "wave", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "点阵曲面", en: "Surface of dots" } },
    { key: "rainbow", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "彩虹色散", en: "Rainbow" } },
    { key: "smear", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "横向拖影", en: "Motion smear" } },
    { key: "rgb", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "色彩错位", en: "Colour fringe" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "辉光", en: "Glow" } },
    { key: "columns", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "数字列", en: "Columns of digits" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "星点", en: "Stars" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "colour", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "保留照片色彩", en: "Photo's own colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(DM.black), text: css(DM.white), dim: css(DM.white, 0.55), titleFill: css(DM.white), titleInk: css(DM.black), grid: () => css(DM.white, 0.16) }),
  /**
   * Black; stars and columns of digits; the surface of dots; the figure (or the photo filling the canvas)
   * read into a grid of dots; then the fringe and the glow over what is there. A print photo is only
   * set on black.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cell = dmCell(p);
    if (env.photo) {
      ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h); env.drawPhoto();
      if (!L.fill || !canPaint(ctx)) return true;
      const cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), px = sampled(ctx, 0, 0, cols, rows, cell, "dmPhoto");
      ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h);
      dotGrid(ctx, env, p, 0, 0, cols, rows, cell, (i, j) => { const q = (j * cols + i) * 4; return ((px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) >> 8) / 255; },
        (i, j) => { const q = (j * cols + i) * 4, c = [px[q], px[q + 1], px[q + 2]], l = Math.max(...c) || 1; return mix(DM.white, c.map((v) => (v * 255) / l), p.colour); });
    } else {
      if (L.ground !== false) { ctx.fillStyle = css(DM.black); ctx.fillRect(0, 0, w, h); }
      if (!L.grid) return true;
      for (let k = 0, n = p.stars * 120; k < Math.ceil(n); k++) { ctx.fillStyle = css(DM.white, (0.3 + 0.7 * rand(k * 2.3 + 1300)) * clamp(n - k)); ctx.beginPath(); ctx.arc(rand(k * 3.1 + 1301) * w, rand(k * 4.7 + 1302) * h, 0.8 + rand(k * 5.9 + 1303) * 2, 0, TAU); ctx.fill(); }
      if (p.columns > 0) {   // columns of digits running down, fading as they go
        ctx.save(); ctx.font = `600 14px ${fonts.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        for (let k = 0, n = p.columns * 16; k < Math.ceil(n); k++) {
          const x = F.x0 + fw * rand(k * 2.9 + 1310), y0 = F.y0 + fh * rand(k * 3.7 + 1311) * 0.5, len = 10 + Math.floor(rand(k * 4.3 + 1312) * 26);
          for (let q = 0; q < len; q++) { ctx.fillStyle = css(DM.white, 0.75 * (1 - q / len) * clamp(n - k)); ctx.fillText(String(Math.floor(rand(k * 31 + q * 1.7) * 10)), x, y0 + q * 17); }
        }
        ctx.restore();
      }
      if (p.wave > 0) {   // a surface of dots rolling away into the distance, rows closer together toward the horizon
        const top = F.y0 + fh * 0.42, rows = 30, ph = rand(1320) * TAU;
        ctx.save(); ctx.globalAlpha = Math.min(1, p.wave * 2);
        for (let j = 0; j < rows; j++) {
          const t = j / (rows - 1), y = top + (F.y1 + fh * 0.15 - top) * t * t, step = cell * (0.5 + 1.5 * t), amp = fh * 0.14 * (0.25 + t) * p.wave, r = cell * 0.14 * (0.4 + t);
          const n = Math.ceil(w / step) + 1;
          for (let i = 0; i < n; i++) {
            const x = i * step + ((j % 2) * step) / 2, yy = y - amp * (Math.sin((x / w) * 5 + ph + j * 0.35) * 0.6 + Math.sin((x / w) * 11 - j * 0.2) * 0.4);
            const rb = p.rainbow > 0 ? clamp(p.rainbow * 1.6 - (1 - t) * 1.2) : 0, c = rb > 0 ? mix(DM.white, rainbow(x / w * 1.2 + t * 0.3), rb) : DM.white;
            ctx.fillStyle = css(c, 0.5 + 0.5 * t); ctx.beginPath(); ctx.ellipse(x, yy, r * (1 + p.smear * 6), r, 0, 0, TAU); ctx.fill();
          }
        }
        ctx.restore();
      }
      const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
      if (S) {   // the figure, read into the grid: a scene object
        const size = fh * (0.5 + 0.55 * p.figure), [cx, cy] = objAt("figure", F.x0 + fw * 0.66, F.y1 - size * 0.46, ctx), x0 = cx - size, y0 = cy - size * 0.6, cols = Math.ceil((size * 2) / cell), rows = Math.ceil((size * 1.25) / cell);
        const cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
        // lit from the upper left, and uneven, as a cloud of points is
        dotGrid(ctx, env, p, x0, y0, cols, rows, cell, (i, j) => (cov[j * cols + i] / 255) * (0.35 + 0.45 * (1 - (i / cols + j / rows) / 2) + 0.3 * noise(i * 0.37 + j * 0.61 + 7)), (i, j) => mix(DM.white, C, 0.15 * noise(i * 0.7 + j * 1.3)));
      }
    }
    if (p.rgb > 0) wherePainted(ctx, (c) => rgbFringe(c, u * 0.008 * p.rgb), L.base === "clear");   // on a see-through base, only over what is there
    if (p.glow > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "dmGlow"), 16, "dmSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.55 * p.glow; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); }
    return true;
  },
  /** The LED wall itself: its unlit points, every 16. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 16, r = 2.6;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css([12, 12, 16]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "round"; ctx.strokeStyle = css(DM.white, 0.8); ctx.lineWidth = 4; ctx.setLineDash([0.1, 12]); run(0, 0); ctx.setLineDash([]); } },   // a row of dots along the edge
  /** White capitals, a glow of the channel colour round them (the shadow slider); highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || DM.white, hi = o.hi || C, glow = Math.min(2, o.shadowAmt);
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(C, 0.6); ctx.shadowBlur = fs * 0.18 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || DM.white); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || DM.white); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink turns white, as everything on black must; objects in greys and white
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: DM.white }, stroke: { ink: DM.white } } : { fill: { ink: [30, 30, 36], light: DM.white, mid: [150, 150, 156], dark: [40, 40, 48] }, stroke: { ink: DM.white, light: DM.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow(ctx, draw, fill) { ctx.save(); ctx.globalAlpha = 0.6; ctx.shadowColor = fill; ctx.shadowBlur = 18; draw(fill); ctx.restore(); } }),
  /** The corner tag: monospaced capitals between brackets of dots. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.55;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 1.9, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(DM.white, 0.9);
    for (let q = 0; q <= 4; q++) for (const sx of [x, x + w]) { ctx.beginPath(); ctx.arc(sx, top + (h * q) / 4, 2.2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ink || css(C); spaced(ctx, str, x + f, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: a line of small spaced capitals at the foot, as the prints carry. */
  frame(ctx, env) {
    const { w, h } = env, P = env.o.profile;
    ctx.save(); ctx.fillStyle = css(DM.white, 0.55); ctx.font = `500 13px ${fonts.en}, ${fonts.cn}`; ctx.textBaseline = "alphabetic";
    spacedCentre(ctx, `© ${(P.brand.name || "STUDIO").toUpperCase()}  ALL RIGHTS RESERVED`, w / 2, h - 30, 4); ctx.restore();
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Glowing shapes for a dot-matrix poster of light on black — bold, simple and luminous — that read at a glance:
- one clear silhouette per sticker (a figure, a hand, a star, a planet, a speaker, a cube, a wave), simple; no realism, no perspective, no detail;
- flat colour only: "white" for the bright parts, the main colour for a glow, "ink" only for small dark gaps;
- the app adds a soft glow round each shape: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a point cloud of light would show them: a few boxes and cylinders, clean and geometric — a speaker, a screen, a cube, a tower; no realism, no fine detail.
- the renderer paints faces in greys and white: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a light grey.`,
};
dots.elementFx = [
  { key: "dots", name: { zh: "光点化", en: "Read into dots" }, for: FX_ALL, stage: "fill", sub: [{ key: "pitch", name: { zh: "点距", en: "Dot spacing" }, def: 0.4 }],
    /** The layer read into a grid of round points of light in its own colours, larger where it is brighter. */
    paint(x, B, a, E, o) {
      const cs = Math.max(3, (5 + 14 * o.pitch) * E.k), [d, cols, rows] = cellsOf(x, B, cs);
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4, al = d[q + 3] / 255;
        if (al < 0.25) continue;
        const l = lumOf(d, q), r = cs * 0.42 * Math.sqrt(0.15 + 0.85 * l) * Math.min(1, al * 1.3);
        x.fillStyle = `rgb(${Math.min(255, d[q] + 40)},${Math.min(255, d[q + 1] + 40)},${Math.min(255, d[q + 2] + 40)})`; x.beginPath(); x.arc(B.x0 + (i + 0.5) * cs, B.y0 + (j + 0.5) * cs, r, 0, TAU); x.fill();
      }
      x.restore();
    } },
  { key: "rainbow", name: { zh: "彩虹色散", en: "Rainbow" }, for: FX_ALL, stage: "over",
    /** Rainbow colour breaking into the layer from its foot, rising as the strength does. */
    paint(x, B, a, E) {
      onLayer(x, B, region(x, B, "fxA"), "color", Math.min(1, a * 1.2), (g) => {
        const h = g.createLinearGradient(0, 0, B.w, 0); for (let i = 0; i <= 6; i++) h.addColorStop(i / 6, css(rainbow(i / 6 + E.R(121))));
        g.fillStyle = h; g.fillRect(0, 0, B.w, B.h);
        const v = g.createLinearGradient(0, B.h * (1 - a), 0, B.h); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,1)");
        g.globalCompositeOperation = "destination-in"; g.fillStyle = v; g.fillRect(0, 0, B.w, B.h);
      });
    } },
  { key: "smear", name: { zh: "横向拖影", en: "Motion smear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.35 }),
    /** The layer's light drawn out into streaks to the right. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"); x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = 0.25 + 0.35 * a; x.drawImage(src, B.x0, B.y0, B.w * (1 + 0.35 * a), B.h); x.globalAlpha = 0.15 + 0.2 * a; x.drawImage(src, B.x0, B.y0, B.w * (1 + 0.7 * a), B.h); x.restore(); } },
  { key: "rgb", name: { zh: "色彩错位", en: "Colour split" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 8 * k, t: 4 * k, r: 8 * k, b: 4 * k }),
    /** Red and cyan a little apart on a slant, as on a screen out of alignment. */
    paint(x, B, a, E) { const d = (1 + 5 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d * 0.92, -d * 0.38], [[0, 255, 255], d * 0.92, d * 0.38]]); } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 80 * k, t: 80 * k, r: 80 * k, b: 80 * k }),
    /** A wide glow of the layer's own light, as of points on a dark screen. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (12 + 34 * a) * E.k, Math.min(1, a * 2.5), null); } },
];
