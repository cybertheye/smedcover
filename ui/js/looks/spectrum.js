// spectrum: the stipple print that bleeds a rainbow
// A black-and-white stipple engraving on cream paper — the subject in dots and fine lines — out of which
// the spectrum runs: threads of colour streaming to the edge and turning up at a right angle, dripping
// down, ringing a dark vortex, running to the horizon, rolling in waves, stacked in blocks; a mat and frame.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, canPaint, cellsOf, clamp, css, dark, fall, fast, grain, graphicShape, grey, gridPen, inkAs, lumOf, mapped, mix, objAt, openField, painters, placeShape, rand, sampled, shapeCells, shapeOf, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const SP = { paper: [238, 233, 218], ink: [26, 24, 22], night: [14, 14, 14], white: [236, 232, 220], mat: [228, 222, 206], wood: [176, 150, 116] };
const SPEC = [[226, 62, 58], [244, 128, 44], [246, 196, 48], [120, 186, 72], [44, 160, 140], [48, 120, 200], [96, 76, 180], [190, 80, 160]];
const spGround = () => (dark ? SP.night : SP.paper), spInk = () => (dark ? SP.white : SP.ink);
/** A colour of the printed spectrum at t (0–1, wrapping). */
const spec = (t) => { const n = SPEC.length, f = (((t % 1) + 1) % 1) * n, i = Math.floor(f); return mix(SPEC[i], SPEC[(i + 1) % n], f - i); };
function spPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.36 + 0.4 * p.figure);
  return { F, cx: F.x0 + fw * 0.58, cy: F.y0 + fh * 0.42, size };
}
/**
 * The figure engraved in stipple: dots of ink thick along the edge and on the side turned from the
 * light (its lower right, read from a blurred copy of the silhouette moved that way), sparse where it
 * faces the light. `dens` (0–1) sets how dark it prints.
 */
function stippleShape(ctx, S, cx, cy, size, dens, colour, k0) {
  const cell = Math.max(2.6, size / 120), x0 = cx - size * 0.8, y0 = cy - size * 0.62, cols = Math.ceil((size * 1.6) / cell), rows = Math.ceil((size * 1.24) / cell), cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
  const R = Math.max(4, Math.round(Math.min(cols, rows) / 9)), tmp = new Float32Array(cols * rows), bl = new Float32Array(cols * rows);   // a broad box blur of the coverage, both ways: how deep inside the shape a cell is
  for (let j = 0; j < rows; j++) { let s = 0; for (let i = -R; i < cols + R; i++) { if (i + R < cols) s += cov[j * cols + Math.max(0, i + R)]; if (i - R - 1 >= 0) s -= cov[j * cols + i - R - 1]; if (i >= 0 && i < cols) tmp[j * cols + i] = s / (2 * R + 1) / 255; } }
  for (let i = 0; i < cols; i++) { let s = 0; for (let j = -R; j < rows + R; j++) { if (j + R < rows) s += tmp[Math.max(0, j + R) * cols + i]; if (j - R - 1 >= 0) s -= tmp[(j - R - 1) * cols + i]; if (j >= 0 && j < rows) bl[j * cols + i] = s / (2 * R + 1); } }
  ctx.save(); ctx.fillStyle = css(colour); ctx.beginPath();
  for (let j = 1; j < rows - 1; j++) for (let i = 1; i < cols - 1; i++) {
    const q = j * cols + i, c = cov[q] / 255;
    if (c <= 0.02) continue;
    // turned from the light: the blurred shape read a little toward the lower right thins out near that edge
    const off = bl[Math.min(rows - 1, j + Math.round(R * 0.8)) * cols + Math.min(cols - 1, i + Math.round(R * 0.6))], band = 1 - Math.abs(bl[q] * 2 - 1), dir = (i / cols - 0.5) * 0.5 + (j / rows - 0.5) * 0.7;
    const tone = c * clamp((0.04 + Math.pow(1 - off, 1.3) + 0.35 * band + 0.3 * dir) * (0.45 + 0.9 * dens));
    if (rand(q * 1.37 + k0) > tone) continue;
    const x = x0 + (i + rand(q * 2.3 + k0 + 1)) * cell, y = y0 + (j + rand(q * 3.1 + k0 + 2)) * cell, r = cell * (0.25 + 0.25 * tone);
    ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
  }
  ctx.fill(); ctx.restore();
}
/**
 * Threads of the spectrum streaming from the band y0–y1 at x across to the right: each its own colour and
 * weight, close-packed; with `turn`, the upper ones bend through a rounded right angle and climb out of
 * the top, nested inside one another. `n` threads.
 */
function spectrumStream(ctx, x, y0, y1, xEnd, top, n, turn, k0) {
  ctx.save(); ctx.lineCap = "butt"; ctx.lineJoin = "round";
  for (let i = 0; i < n; i++) {
    const t = (i + rand(i * 1.3 + k0) * 0.6) / n, y = y0 + (y1 - y0) * t, xs = x + (rand(i * 2.1 + k0 + 1) - 0.3) * (y1 - y0) * 0.4, up = turn && t < 0.55, tx = xEnd - (y1 - y0) * 0.55 + (y - y0), r = Math.min(40, (y - y0) * 0.6 + 8);
    ctx.strokeStyle = css(spec(rand(i * 3.7 + k0 + 2))); ctx.lineWidth = 0.8 + rand(i * 4.3 + k0 + 3) * 2.2;
    ctx.beginPath(); ctx.moveTo(xs, y);
    if (up) { ctx.lineTo(tx - r, y); ctx.arcTo(tx, y, tx, y - r, r); ctx.lineTo(tx, top); } else ctx.lineTo(xEnd, y);
    ctx.stroke();
  }
  ctx.restore();
}
export const spectrum = {
  id: "spectrum",
  art: "figure",
  repaint: (c) => `a black-and-white stipple engraving made from the photograph, fine ink dots and lines on cream paper, with streams of thin rainbow-coloured lines flowing out of it like light spectra, minimal and surreal, with ${c} among the colours; no text.`,
  about: { zh: "光谱版画：黑白点刻版画里流出彩虹——频道图形用点刻刻成一幅老式铜版画，米白纸上墨色细密；从它身上流出一束束光谱色的细线，横着拉到画边、在拐角直角折上去，或者垂直滴流下来；可加同心的光谱漩涡、汇向地平线的彩色透视线、起伏的彩色波纹、一块块彩色横纹条、雕版横线的天空，以及米白卡纸和木边画框。安静又迷幻——适合艺术、设计、音乐、哲思、科技与自然类内容。照片会被刻成一行行粗细起伏的线刻版画。可选米白纸或黑纸；自带平直的版式。", en: "Spectral engraving: rainbows running out of a black-and-white stipple print — the channel graphic engraved in stipple like an old copperplate, fine ink on cream paper; out of it stream threads of the spectrum, drawn to the edge and turned up at a right angle, or dripping down; a concentric spectral vortex, coloured perspective lines running to the horizon, rolling rainbow waves, blocks of coloured lines, a sky of engraved lines, and a cream mat in a wooden frame if you like. Quiet yet psychedelic — for art, design, music, ideas, science and nature. A photo is engraved in level lines that swell with its shadows. Cream or black paper; flat layouts of its own." },
  name: { zh: "光谱版画", en: "Spectral engraving" },
  seeded: true,
  scene: { figure: { zh: "点刻身影", en: "Stippled figure" }, vortex: { zh: "光谱漩涡", en: "Vortex" }, road: { zh: "透视光轨灭点", en: "Vanishing point of the lines" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点刻身影", en: "Stippled figure" } },
    { key: "stipple", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点刻浓淡", en: "Stipple depth" } },
    { key: "stream", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "光谱流线", en: "Spectral streams" } },
    { key: "drip", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "垂直滴流", en: "Drips" } },
    { key: "vortex", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光谱漩涡", en: "Vortex" } },
    { key: "road", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "透视光轨", en: "Perspective lines" } },
    { key: "waves", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "彩色波纹", en: "Rainbow waves" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "彩色条块", en: "Colour blocks" } },
    { key: "engrave", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "雕版横线", en: "Engraved sky" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸纹", en: "Paper" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "卡纸画框", en: "Mat and frame" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片版画", en: "Photo engraved" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(spGround()), text: css(spInk()), dim: css(spInk(), 0.6), titleFill: css(spInk()), titleInk: css(spGround()), grid: () => css(spInk(), 0.14) }),
  /**
   * The paper; an engraved sky; the vortex behind the figure; lines running to the horizon at its feet;
   * waves along the foot of the field; streams and drips (begun under the figure, so they come out of
   * it); the stippled figure; blocks of coloured lines. A photo is engraved over the paper in level lines,
   * and when it fills the canvas the streams and blocks come out of its middle.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ink = spInk();
    if (L.ground !== false) { ctx.fillStyle = css(spGround()); ctx.fillRect(0, 0, w, h); }
    const engrave = (F) => {   // fine level lines, close at the top and opening out downward
      if (p.engrave <= 0) return;
      const fh = F.y1 - F.y0, deep = F.y0 + fh * (0.2 + 0.5 * p.engrave);
      ctx.save(); ctx.fillStyle = css(ink);
      for (let y = F.y0, i = 0; y < deep; i++, y += 4.5) { ctx.globalAlpha = 0.5 * (1 - (y - F.y0) / (deep - F.y0)) * Math.min(1, p.engrave * 2); ctx.fillRect(F.x0, y, F.x1 - F.x0, 0.9 + rand(i + 2600) * 0.5); }
      ctx.restore();
    };
    const streams = (at, F) => {
      const { cx, cy, size } = at;
      if (p.stream > 0) spectrumStream(ctx, cx, cy - size * 0.2, cy + size * (0.0 + 0.25 * p.stream), F.x1 + 4, F.y0 - 4, Math.round(10 + 110 * p.stream), p.stream > 0.4, 2610);
      if (p.drip > 0) {   // threads dripping from the figure, in spectrum order across it
        ctx.save(); ctx.lineCap = "butt";
        for (let i = 0, n = Math.round(10 + 140 * p.drip); i < n; i++) { const t = i / n, x = cx - size * 0.32 + size * 0.64 * t, len = (F.y1 - cy) * (0.25 + 0.75 * rand(i * 2.7 + 2620)) * (0.3 + 0.7 * p.drip); ctx.strokeStyle = css(spec(t * 0.9 + rand(i + 2621) * 0.08)); ctx.lineWidth = 0.8 + rand(i * 3.3 + 2622) * 1.8; ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x, cy + size * 0.3 + len); ctx.stroke(); }
        ctx.restore();
      }
    };
    const bars = (at, F) => {
      for (let k = 0, n = p.bars * 6; k < Math.ceil(n); k++) {
        const bw = (F.x1 - F.x0) * (0.08 + rand(k * 2.1 + 2630) * 0.2), bh = (F.y1 - F.y0) * (0.03 + rand(k * 2.9 + 2631) * 0.1), x = clamp(at.cx + (rand(k * 3.7 + 2632) - 0.45) * at.size * 1.6, F.x0, F.x1 - bw), y = clamp(at.cy + at.size * (0.05 + rand(k * 4.3 + 2633) * 0.55), F.y0, F.y1 - bh);
        ctx.save(); ctx.globalAlpha = clamp(n - k);
        for (let yy = y, i = 0; yy < y + bh; yy += 3, i++) { ctx.fillStyle = css(spec(rand(k * 31 + i * 1.7 + 2634))); ctx.fillRect(x + (rand(k * 7 + i * 2.3 + 2635) - 0.5) * bw * 0.1, yy, bw * (0.75 + rand(k * 5 + i * 3.1 + 2636) * 0.25), 1.8); }
        ctx.restore();
      }
    };
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.mono > 0 && canPaint(ctx)) {   // the photo engraved: paper over it, then level lines swelling where it was dark and lifting a little with the tone, as a burin cuts them
        const pitch = Math.max(3, u * (fast ? 0.01 : 0.0065)), cols = Math.ceil(w / pitch) + 1, rows = Math.ceil(h / pitch), px = sampled(ctx, 0, 0, cols, rows, pitch, "spPhoto");
        ctx.save(); ctx.globalAlpha = p.mono; ctx.fillStyle = css(spGround()); ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = css(ink); ctx.beginPath();
        for (let j = 0; j < rows; j++) {
          const y = (j + 0.5) * pitch, th = [];
          for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4, l = (px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) / 65280; th.push(px[q + 3] < 128 ? 0 : clamp((dark ? l : 1 - l) * 1.1 - 0.04)); }
          const at = (i, s) => y + (th[i] - 0.5) * pitch * 0.3 + s * th[i] * pitch * 0.48;
          ctx.moveTo(0, at(0, -1));
          for (let i = 1; i < cols; i++) ctx.lineTo(i * pitch, at(i, -1));
          for (let i = cols - 1; i >= 0; i--) ctx.lineTo(i * pitch, at(i, 1));
          ctx.closePath();
        }
        ctx.fill(); ctx.restore();
      }
      if (L.fill) { const F = { x0: 0, y0: 0, x1: w, y1: h }, at = { cx: w * 0.5, cy: h * 0.48, size: h * 0.5 }; engrave(F); streams(at, F); bars(at, F); }
      return true;
    }
    if (!L.grid) return true;
    const at = spPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, { size } = at;
    if (p.figure > 0) [at.cx, at.cy] = objAt("figure", at.cx, at.cy, ctx);   // a scene object: the vortex, the lines, threads and bars go with it
    const { cx, cy } = at;
    engrave(F);
    if (p.vortex > 0) {   // rings of colour round a dark centre, the centre stippled out into the paper
      const R = size * (0.45 + 0.4 * p.vortex), [vx, vy] = objAt("vortex", cx, cy - size * 0.32, ctx);   // a scene object
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0, n = Math.round(30 + 140 * p.vortex); i < n; i++) { const t = i / n, r = R * (0.36 + 0.64 * t), a0 = rand(i * 2.3 + 2650) * TAU, len = (0.4 + rand(i * 3.1 + 2651) * 1.5) * Math.PI; ctx.strokeStyle = css(spec(rand(i * 4.7 + 2652)), 0.9 * (1 - t * 0.6)); ctx.lineWidth = 0.8 + rand(i * 5.3 + 2653) * 2; ctx.beginPath(); ctx.arc(vx, vy, r, a0, a0 + len); ctx.stroke(); }
      ctx.fillStyle = css(ink); ctx.beginPath(); ctx.arc(vx, vy, R * 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); for (let i = 0; i < 1400; i++) { const a = rand(i * 1.9 + 2654) * TAU, d = R * (0.3 + 0.08 * rand(i * 2.7 + 2655) ** 0.5), r = 0.8 + rand(i + 2656) * 0.8; ctx.moveTo(vx + Math.cos(a) * d + r, vy + Math.sin(a) * d); ctx.arc(vx + Math.cos(a) * d, vy + Math.sin(a) * d, r, 0, TAU); } ctx.fill();
      ctx.restore();
    }
    if (p.road > 0) {   // lines from the horizon at the figure's feet out to the foot of the field: the near side in colour, the far side in ink
      const [rx, vy] = objAt("road", cx, Math.min(F.y1 - fh * 0.08, cy + size * 0.5), ctx), n = Math.round(30 + 150 * p.road);   // their vanishing point: a scene object
      ctx.save(); ctx.globalAlpha = Math.min(1, p.road * 3);
      for (let i = 0; i < n; i++) { const t = i / n, xb = F.x0 - fw * 0.6 + fw * 2.2 * t, wd = 0.6 + rand(i * 2.1 + 2660) * 2.2; shapeOf(ctx, [[rx, vy], [xb - wd, F.y1 + 4], [xb + wd, F.y1 + 4]]); ctx.fillStyle = xb < rx ? css(spec(rand(i * 3.3 + 2661))) : css(ink, 0.7); ctx.fill(); }
      ctx.fillStyle = css(ink, 0.6); ctx.fillRect(F.x0, vy - 0.6, fw, 1.2);
      ctx.restore();
    }
    if (p.waves > 0) {   // bands of parallel waving lines in spectrum order along the foot of the field
      ctx.save(); ctx.lineCap = "round";
      for (let b = 0, nb = p.waves * 3; b < Math.ceil(nb); b++) {
        const m = 14 + b * 4, yb = F.y1 - fh * (0.06 + 0.13 * b), A = fh * (0.02 + 0.03 * p.waves), fr = 0.006 + rand(b * 2.3 + 2670) * 0.004, ph = rand(b * 3.1 + 2671) * TAU;
        ctx.globalAlpha = clamp(nb - b);
        for (let j = 0; j < m; j++) { ctx.strokeStyle = css(spec(j / m + b * 0.3)); ctx.lineWidth = 1.6; ctx.beginPath(); for (let x = F.x0; x <= F.x1 + 8; x += 8) { const y = yb + j * 2.6 + A * Math.sin(x * fr + ph + j * 0.06) + A * 0.4 * Math.sin(x * fr * 2.7 + ph * 1.3); x === F.x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
      }
      ctx.restore();
    }
    streams(at, F);
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      placeShape(ctx, S, spGround(), cx, cy, size);   // the paper under it, so the threads it covers start from its edge
      stippleShape(ctx, S, cx, cy, size, p.stipple, ink, 2680);
    }
    bars(at, F);
    return true;
  },
  /** An engraver's level lines across the plate, every 18, swelling gently as a burin's do. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = 9, j = 0; y < h; y += 18, j++) for (let x = 0; x <= w + 24; x += 24) { const yy = y + Math.sin(x * 0.006 + j * 0.45) * 3; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? [30, 30, 28] : SP.mat), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(spInk()); ctx.lineWidth = 2.5; run(0, 0); for (let i = 0; i < 6; i++) { ctx.strokeStyle = css(spec(i / 6)); ctx.lineWidth = 2; run(-nx * (6 + i * 3), -ny * (6 + i * 3)); } } },   // a mat with the spectrum running along its edge
  /** Ink capitals standing on a stack of offset copies in spectrum colours (the shadow slider); highlighted words filled with the spectrum. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), ink = o.fill || spInk(), n = Math.round(3 + 4 * s);
    if (s > 0) for (let i = n; i >= 1; i--) { const [dx, dy] = fall(fs * 0.008 * i, fs * 0.014 * i); ctx.fillStyle = css(spec(i / n)); pass((a, x) => ctx.fillText(a.t, x + dx, dy)); }
    pass((a, x) => {
      if (a.hi && !o.hi) { const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width }, g = ctx.createLinearGradient(r.x0, 0, r.x1, 0); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, css(spec(i / 7))); ctx.fillStyle = g; }   // across the whole run
      else ctx.fillStyle = css(a.hi ? o.hi : ink);
      ctx.fillText(a.t, x, 0);
    });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: SP.ink, light: SP.paper, mid: [190, 186, 176], dark: [70, 68, 64], colour: (c) => mix(grey(c), c, 0.4) }, stroke: { ink: SP.ink, light: SP.paper }, line: 0.55 })),
  sticker: painters({ line: SP.ink, lineScale: 0.45, tone: inkAs(SP.ink, (c) => mix(grey(c), c, 0.4)), shadow: null }),
  /** The corner tag: capitals in a hairline box, a little bar of the spectrum before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56, col = spInk();
    ctx.font = `600 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2.4, h = f * 1.7, top = y + (fs * 1.34 - h);
    ctx.strokeStyle = css(col, 0.85); ctx.lineWidth = 1.5; ctx.strokeRect(x, top, w, h);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = css(spec(i / 6)); ctx.fillRect(x + f * 0.5, top + h * 0.22 + (i * h * 0.56) / 6, f * 0.6, (h * 0.56) / 6); }
    ctx.fillStyle = ink || css(col); spaced(ctx, str, x + f * 1.5, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a cream mat (wider as its slider rises) with a hairline at its inner edge, in a thin wooden frame. */
  frame(ctx, env, p) {
    const { w, h } = env, b = 46 * p.border;
    if (b < 1) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(b, b, w - 2 * b, h - 2 * b); ctx.fillStyle = css(dark ? [30, 30, 28] : SP.mat); ctx.fill("evenodd");
    ctx.strokeStyle = css(spInk(), 0.7); ctx.lineWidth = 1.2; ctx.strokeRect(b, b, w - 2 * b, h - 2 * b);
    ctx.strokeStyle = css(SP.wood); ctx.lineWidth = Math.max(2, b * 0.3); ctx.strokeRect(b * 0.15, b * 0.15, w - b * 0.3, h - b * 0.3);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.paper * 0.7, unit, !dark); },
  prompt: `Engraved emblems for a black-and-white stipple print — exact, old-fashioned, a little surreal — that read at a glance:
- one clear object per sticker (a cloud, a mountain, a wave, an eye, a moon, a hand, a key, a bird, a crystal), with a strong silhouette; no realism, no fine detail;
- flat colour only: mostly "ink" and "white" (cream); the main colour, if at all, as one small accent;
- the app adds a thin ink line and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as an old engraving would show them, built as simple models from a few boxes and cylinders — a telescope, a lighthouse, a globe, a lamp, a column; no realism, no fine detail.
- the renderer paints faces in cream and greys with a thin ink line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep grey, and "main" a muted version of the channel colour.`,
};
spectrum.elementFx = [
  { key: "stipple", name: { zh: "点刻", en: "Stipple" }, for: FX_ALL, stage: "fill", sub: [{ key: "depth", name: { zh: "浓淡", en: "Depth" }, def: 0.55 }],
    /** The layer engraved in stipple: dots of ink, thick where it is dark. */
    paint(x, B, a, E, o) {
      const cs = Math.max(2, 2.6 * E.k), [d, cols, rows] = cellsOf(x, B, cs), ink = spInk();
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; if (d[q + 3] < 100) continue; const tone = clamp((1 - lumOf(d, q)) * (0.45 + 0.9 * o.depth) + 0.05); if (E.R(j * cols + i + 0.5) > tone) continue; const px = B.x0 + (i + E.R(i * 1.3 + j * 2.1 + 181)) * cs, py = B.y0 + (j + E.R(i * 2.7 + j * 1.1 + 182)) * cs, r = cs * (0.26 + 0.22 * tone); x.moveTo(px + r, py); x.arc(px, py, r, 0, TAU); }
      x.fill(); x.restore();
    } },
  { key: "lines", name: { zh: "线刻", en: "Line engraving" }, for: FX_ALL, stage: "fill",
    /** The layer engraved in level lines of ink, swelling where it is dark. */
    paint(x, B, a, E) {
      const p = Math.max(3, 4.5 * E.k), [d, cols, rows] = cellsOf(x, B, p), ink = spInk();
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) {
        const y = B.y0 + (j + 0.5) * p, th = [];
        for (let i = 0; i < cols; i++) { const q = (j * cols + i) * 4; th.push(d[q + 3] < 100 ? 0 : clamp((1 - lumOf(d, q)) * 1.1 - 0.04)); }
        const at = (i, s) => y + (th[i] - 0.5) * p * 0.3 + s * th[i] * p * 0.48;
        x.moveTo(B.x0, at(0, -1)); for (let i = 1; i < cols; i++) x.lineTo(B.x0 + i * p, at(i, -1)); for (let i = cols - 1; i >= 0; i--) x.lineTo(B.x0 + i * p, at(i, 1)); x.closePath();
      }
      x.fill(); x.restore();
    } },
  { key: "stream", name: { zh: "光谱流线", en: "Spectral streams" }, for: FX_ALL, stage: "behind", reach: (B) => ({ r: B.w * 1.5 }),
    /** Threads of the spectrum streaming out of the layer to the right, close-packed, each its own colour and weight. */
    paint(x, B, a, E) {
      x.save(); x.globalCompositeOperation = "destination-over"; x.lineCap = "butt";
      for (let i = 0, n = Math.round(10 + 80 * a); i < n; i++) { const y = B.y0 + B.h * (0.1 + 0.8 * (i + E.R(i * 1.3 + 191) * 0.6) / n), len = B.w * (0.3 + 1.2 * a) * (0.6 + 0.4 * E.R(i * 2.1 + 192)); x.strokeStyle = css(spec(E.R(i * 3.7 + 193))); x.lineWidth = (0.8 + E.R(i * 4.3 + 194) * 2.2) * E.k * 0.8; x.beginPath(); x.moveTo(B.x0 + B.w * 0.5, y); x.lineTo(B.x1 + len, y); x.stroke(); }
      x.restore();
    } },
  { key: "drip", name: { zh: "垂直滴流", en: "Drips" }, for: FX_ALL, stage: "behind", reach: (B) => ({ b: B.h * 1.2 }),
    /** Threads of the spectrum dripping down from the layer, in spectrum order across it. */
    paint(x, B, a, E) {
      x.save(); x.globalCompositeOperation = "destination-over"; x.lineCap = "butt";
      for (let i = 0, n = Math.round(10 + 120 * a); i < n; i++) { const t = i / n, px = B.x0 + B.w * (0.08 + 0.84 * t), len = B.h * (0.25 + 0.95 * E.R(i * 2.7 + 201)) * (0.3 + 0.7 * a); x.strokeStyle = css(spec(t * 0.9 + E.R(i + 202) * 0.08)); x.lineWidth = (0.8 + E.R(i * 3.3 + 203) * 1.8) * E.k * 0.8; x.beginPath(); x.moveTo(px, B.y1 - B.h * 0.3); x.lineTo(px, B.y1 + len); x.stroke(); }
      x.restore();
    } },
];
