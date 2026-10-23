// net art: the glitch poster of an old operating system
// Net art and glitch posters: dialog windows of an old operating system piling up, pixel-sorted streaks,
// datamoshed blocks, rows of garbled characters, the grey checkerboard of transparency, test-pattern
// colour bars, arrow cursors; the figure dithered into black pixels; selected words in a navy box.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, boost, canPaint, clamp, css, dark, every, fall, fast, fxCanvas, grain, graphicShape, greeked, gridPath, gridPen, inPixels, mapped, mix, objAt, openField, painters, rand, region, sampled, shapeCells, shapeIn, shift, slideBands, snap, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const NA = { white: [246, 246, 244], black: [10, 10, 12], silver: [192, 192, 192], navy: [0, 0, 128], blue: [16, 132, 208], light: [255, 255, 255], shade: [128, 128, 128], deep: [64, 64, 64], ink: [26, 26, 30] };
const naGround = () => (dark ? NA.black : NA.white), naInk = () => (dark ? NA.white : NA.ink);
const ASCII = "x√ÛH8EC#%&@$*+=<>/\\|{}[]~^ÆØ¥§¶01¿ßµ";
/** A dialog window of an old operating system: bevelled grey body, a navy title bar with a close box, then by `kind` a warning, a progress bar or a checkerboard picture, greeked lines and a button. */
function osWindow(ctx, x, y, w, h, kind, k, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(NA.silver); ctx.fillRect(x, y, w, h);
  ctx.fillStyle = css(NA.light); ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = css(NA.deep); ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  const tb = 24, g = ctx.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, css(NA.navy)); g.addColorStop(1, css(NA.blue));
  ctx.fillStyle = g; ctx.fillRect(x + 4, y + 4, w - 8, tb);
  greeked(ctx, x + 12, y + 12, w * 0.45, 1, 10, css(NA.light, 0.9), k);
  const cb = tb - 6, cx = x + w - 8 - cb, cy = y + 7;
  ctx.fillStyle = css(NA.silver); ctx.fillRect(cx, cy, cb, cb); ctx.strokeStyle = css(NA.ink); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx + 4, cy + 4); ctx.lineTo(cx + cb - 4, cy + cb - 4); ctx.moveTo(cx + cb - 4, cy + 4); ctx.lineTo(cx + 4, cy + cb - 4); ctx.stroke();
  const bx = x + 14, by = y + tb + 16, bw = w - 28;
  if (kind === 0) {   // a warning: a yellow triangle with a mark, some lines, an OK button
    ctx.fillStyle = "#ffd400"; ctx.beginPath(); ctx.moveTo(bx + 18, by); ctx.lineTo(bx + 36, by + 32); ctx.lineTo(bx, by + 32); ctx.closePath(); ctx.fill(); ctx.strokeStyle = css(NA.ink); ctx.stroke();
    ctx.fillStyle = css(NA.ink); ctx.fillRect(bx + 16.5, by + 10, 3, 12); ctx.fillRect(bx + 16.5, by + 25, 3, 3);
    greeked(ctx, bx + 50, by + 4, bw - 50, 2, 12, css(NA.ink, 0.8), k + 1);
  } else if (kind === 1) {   // a progress bar filling with blocks
    greeked(ctx, bx, by, bw, 1, 12, css(NA.ink, 0.8), k + 2);
    const py = by + 22; ctx.fillStyle = css(NA.light); ctx.fillRect(bx, py, bw, 20); ctx.strokeStyle = css(NA.shade); ctx.strokeRect(bx, py, bw, 20);
    ctx.fillStyle = css(NA.navy); for (let i = 0, n = Math.floor(((bw - 6) / 14) * (0.3 + 0.6 * rand(k + 3))); i < n; i++) ctx.fillRect(bx + 3 + i * 14, py + 3, 11, 14);
  } else {   // a picture that has not loaded: the checkerboard of transparency
    const ph = h - tb - 64;
    for (let i = 0; i * 10 < bw; i++) for (let j = 0; j * 10 < ph; j++) { ctx.fillStyle = (i + j) % 2 ? "#d8d8d8" : "#ffffff"; ctx.fillRect(bx + i * 10, by + j * 10, Math.min(10, bw - i * 10), Math.min(10, ph - j * 10)); }
  }
  const okw = 64, okx = x + w / 2 - okw / 2, oky = y + h - 34;   // the button
  ctx.fillStyle = css(NA.silver); ctx.fillRect(okx, oky, okw, 22); ctx.fillStyle = css(NA.light); ctx.fillRect(okx, oky, okw, 2); ctx.fillRect(okx, oky, 2, 22);
  ctx.fillStyle = css(NA.deep); ctx.fillRect(okx, oky + 20, okw, 2); ctx.fillRect(okx + okw - 2, oky, 2, 22);
  ctx.fillStyle = css(NA.ink); ctx.fillRect(okx + 22, oky + 9, 20, 3);
  ctx.restore();
}
/** An arrow cursor, white with a black edge. */
function cursorArrow(ctx, x, y, s) {
  ctx.beginPath(); [[0, 0], [0, 17], [4, 13], [7, 20], [10, 19], [7, 12], [12, 12]].forEach(([a, b], i) => (i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s))); ctx.closePath();
  ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = "#000"; ctx.lineWidth = Math.max(1, s * 0.9); ctx.stroke();
}
/** A 4 × 4 ordered-dither threshold (0–1) for cell (i, j). */
const bayer = (i, j) => [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5][(j % 4) * 4 + (i % 4)] / 16 + 1 / 32;
/** Where the dithered figure stands. */
function naPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
export const netart = {
  id: "netart",
  art: "figure",
  repaint: (c) => `a glitch net-art poster made from the photograph: pixel sorting, datamosh blocks, dithered one-bit areas, old operating-system dialog windows and a checkerboard of transparency, with ${c} as an accent; raw, digital and chaotic; no readable text.`,
  about: { zh: "故障网络：网络艺术和故障海报——老式操作系统的对话框一层层叠上来（警告、进度条、加载不出的图），像素排序拉出的长条、数据错位的方块、一行行乱码字符、透明背景的灰白棋盘格、测试图的彩条、鼠标箭头；频道图形抖动成黑色像素点阵；标题里强调的词像被选中一样，反白在藏青色的选框里。数字、粗粝、有点失控——适合科技、互联网文化、游戏、实验音乐和观点类内容。可选白底或黑底；自带平直的版式，色块是一块银灰色的系统面板。", en: "Net art: net-art and glitch posters — dialog windows of an old operating system piling up (a warning, a progress bar, a picture that will not load), pixel-sorted streaks, datamoshed blocks, rows of garbled characters, the grey checkerboard of transparency, test-pattern colour bars, arrow cursors; the channel graphic dithered into black pixels; highlighted words selected, white in a navy box. Digital, raw, slightly out of control — for tech, internet culture, games, experimental music and opinion. White or black ground; flat layouts of its own, the colour block a silver system panel." },
  name: { zh: "故障网络", en: "Glitch net art" },
  seeded: true,
  scene: { figure: { zh: "点阵身影", en: "Dithered figure" }, windows: { zh: "系统窗口", en: "Dialog windows" }, bars: { zh: "测试彩条", en: "Colour bars" }, cursors: { zh: "鼠标箭头", en: "Cursors" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "点阵身影", en: "Dithered figure" } },
    { key: "windows", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "系统窗口", en: "Dialog windows" } },
    { key: "sort", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "像素排序", en: "Pixel sorting" } },
    { key: "mosh", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "数据错位", en: "Datamosh" } },
    { key: "ascii", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "乱码字符", en: "Garbled characters" } },
    { key: "checker", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "透明棋盘格", en: "Transparency checks" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "测试彩条", en: "Colour bars" } },
    { key: "cursor", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "鼠标箭头", en: "Cursors" } },
    { key: "shift", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "扫描错行", en: "Scan shift" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "dither", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "照片抖动点阵", en: "Photo dithered" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(naGround()), text: css(naInk()), dim: css(naInk(), 0.6), titleFill: css(naInk()), titleInk: css(naGround()), grid: () => css(naInk(), 0.12) }),
  /**
   * The ground; colour bars, checker patches, ASCII rows; the dithered figure; dialog windows; then,
   * working on what is there, pixel sorting, datamosh and scan shift; cursors last. A photo filling the
   * canvas is dithered (Photo dithered) and goes through the same sorting, moshing and shifting.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = naPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, spot = boost(C, 0.7), ink = naInk();
    if (L.ground !== false) { ctx.fillStyle = css(naGround()); ctx.fillRect(0, 0, w, h); }
    const damage = (box) => {
      if (!canPaint(ctx)) return;
      const m = ctx.getTransform(), k = m.a;
      if (p.sort > 0) {   // a one-pixel column stretched into a streak to the right, row band by row band
        const src = snap(ctx, "naSort");
        for (let i = 0, n = Math.round(80 * p.sort); i < n; i++) {
          const y = box.y0 + (box.y1 - box.y0) * rand(i * 1.9 + 1900), bh = 2 + rand(i * 2.7 + 1901) * 12, x0 = box.x0 + (box.x1 - box.x0) * rand(i * 3.3 + 1902), len = fw * (0.05 + rand(i * 4.1 + 1903) * 0.4) * p.sort;
          inPixels(ctx, () => ctx.drawImage(src, Math.floor(m.e + x0 * k), Math.floor(m.f + y * k), 1, Math.max(1, Math.round(bh * k)), m.e + x0 * k, m.f + y * k, len * k, Math.max(1, Math.round(bh * k))));
        }
      }
      if (p.mosh > 0) {   // blocks of the picture copied a few cells off, some tinted, some flat colour
        const src = snap(ctx, "naMosh"), cell = u * 0.035;
        for (let i = 0, n = Math.round(18 * p.mosh); i < n; i++) {
          const bw = cell * (1 + Math.floor(rand(i * 2.1 + 1910) * 3)), bh = cell * (1 + Math.floor(rand(i * 2.9 + 1911) * 2)), sx = box.x0 + (box.x1 - box.x0 - bw) * rand(i * 3.7 + 1912), sy = box.y0 + (box.y1 - box.y0 - bh) * rand(i * 4.3 + 1913);
          const dx = sx + Math.round((rand(i * 5.1 + 1914) - 0.5) * 6) * cell, dy = sy + Math.round((rand(i * 5.9 + 1915) - 0.5) * 2) * cell, kind = rand(i * 6.7 + 1916);
          if (kind < 0.2) { ctx.fillStyle = css([spot, [255, 40, 160], [40, 200, 255], [250, 210, 40]][i % 4], 0.9); ctx.fillRect(dx, dy, bw, bh); }
          else { inPixels(ctx, () => ctx.drawImage(src, m.e + sx * k, m.f + sy * k, bw * k, bh * k, m.e + dx * k, m.f + dy * k, bw * k, bh * k)); if (kind < 0.45) { ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix([255, 255, 255], kind < 0.3 ? spot : [60, 80, 255], 0.7)); ctx.fillRect(dx, dy, bw, bh); ctx.restore(); } }
        }
      }
      if (p.shift > 0) {   // whole bands of the picture slid sideways
        const src = snap(ctx, "naShift");
        for (let i = 0, n = Math.round(2 + 6 * p.shift); i < n; i++) { const y = h * rand(i * 2.3 + 1920), bh = u * (0.004 + rand(i * 3.1 + 1921) * 0.03), dx = (rand(i * 3.9 + 1922) - 0.5) * u * 0.15 * p.shift; inPixels(ctx, () => ctx.drawImage(src, 0, m.f + y * k, src.width, bh * k, dx * k, m.f + y * k, src.width, bh * k)); }
      }
    };
    const dither = (x0, y0, cols, rows, cell, level, a) => {   // black square pixels where the level beats the ordered threshold
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = css(ink); ctx.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) if (level(i, j) > bayer(i, j)) ctx.rect(x0 + i * cell, y0 + j * cell, cell + 0.4, cell + 0.4);
      ctx.fill(); ctx.restore();
    };
    if (env.photo) {
      env.drawPhoto();
      if (!L.fill) return true;
      if (p.dither > 0 && canPaint(ctx)) {
        const cell = Math.max(3, u * 0.006), cols = Math.ceil(w / cell), rows = Math.ceil(h / cell), px = sampled(ctx, 0, 0, cols, rows, cell, "naPhoto");
        ctx.save(); ctx.globalAlpha = p.dither; ctx.fillStyle = css(naGround()); ctx.fillRect(0, 0, w, h); ctx.restore();
        dither(0, 0, cols, rows, cell, (i, j) => { const q = (j * cols + i) * 4, l = (px[q] * 54 + px[q + 1] * 183 + px[q + 2] * 19) / 65280; return dark ? l : 1 - l; }, p.dither);
      }
      damage({ x0: 0, y0: 0, x1: w, y1: h });
      return true;
    }
    if (!L.grid) return true;
    if (p.bars > 0) {   // test-pattern colour bars, widening
      const bars = [[235, 235, 235], [235, 235, 16], [16, 235, 235], [16, 235, 16], [235, 16, 235], [235, 16, 16], [16, 16, 235]], bw = fw * 0.04 * (0.5 + p.bars), bx = F.x0 + fw * 0.08, by = F.y0 + fh * 0.62, bh = fh * 0.3;
      ctx.save(); shift("bars", bx + bw * 3.5, by + bh * 0.4, ctx);   // a scene object
      ctx.save(); ctx.globalAlpha = Math.min(1, p.bars * 3); bars.forEach((c, i) => { ctx.fillStyle = css(c); ctx.fillRect(bx + i * bw, by, bw, bh * (0.7 + 0.3 * (i % 2))); }); ctx.restore(); ctx.restore();
    }
    for (let k = 0, n = p.checker * 5; k < Math.ceil(n); k++) {
      const cw = u * (0.06 + rand(k * 2.7 + 1930) * 0.14), ch = cw * (0.5 + rand(k * 3.3 + 1931)), x = F.x0 + fw * (0.25 + rand(k * 4.1 + 1932) * 0.7), y = F.y0 + fh * rand(k * 4.9 + 1933) * 0.85, c = 10;
      ctx.save(); ctx.globalAlpha = clamp(n - k);
      for (let i = 0; i * c < cw; i++) for (let j = 0; j * c < ch; j++) { ctx.fillStyle = (i + j) % 2 ? (dark ? "#3a3a3a" : "#cfcfcf") : (dark ? "#1c1c1c" : "#ffffff"); ctx.fillRect(x + i * c, y + j * c, Math.min(c, cw - i * c), Math.min(c, ch - j * c)); }
      ctx.restore();
    }
    if (p.ascii > 0) {   // rows of garbled characters, a few runs of them in colour
      ctx.save(); ctx.font = `600 16px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const x0 = F.x0 + fw * 0.52, y0 = F.y0 + fh * 0.06, rows = Math.round(16 * p.ascii), cols = Math.floor((F.x1 - x0 - 30) / 10);
      for (let j = 0; j < rows; j++) { let s = ""; for (let i = 0; i < cols * (0.4 + 0.6 * rand(j * 1.3 + 1940)); i++) s += ASCII[Math.floor(rand(j * 31 + i * 1.7 + 1941) * ASCII.length)]; ctx.fillStyle = rand(j * 2.9 + 1942) > 0.8 ? css(rand(j + 1943) > 0.5 ? spot : NA.blue) : css(ink, 0.75); ctx.fillText(s, x0, y0 + j * 19); }
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the figure dithered into black pixels, lit from the upper left: a scene object
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx), cell = Math.max(3, size * 0.012), x0 = cx - size * 0.75, y0 = cy - size * 0.6, cols = Math.ceil((size * 1.5) / cell), rows = Math.ceil((size * 1.2) / cell), cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
      dither(x0, y0, cols, rows, cell, (i, j) => (cov[j * cols + i] / 255) * (0.25 + 0.75 * clamp((i / cols + j / rows) * 0.8)), 1);
    }
    ctx.save(); if (p.windows > 0) shift("windows", at.cx - at.size * 0.2, F.y0 + fh * 0.2, ctx);   // the windows move as one: a scene object
    for (let k = 0, n = p.windows * 6; k < Math.ceil(n); k++) {   // dialog windows cascading down toward the figure
      const ww = u * (0.26 + rand(k * 2.3 + 1950) * 0.1), wh = ww * (0.42 + rand(k * 3.1 + 1951) * 0.2), x = at.cx - at.size * 0.2 + k * 34 - ww * 0.5 + (rand(k * 3.9 + 1952) - 0.5) * fw * 0.25, y = F.y0 + fh * 0.08 + k * 30 + rand(k * 4.7 + 1953) * fh * 0.2;
      osWindow(ctx, clamp(x, F.x0 + 10, F.x1 - ww - 10), clamp(y, F.y0 + 10, F.y1 - wh - 10), ww, wh, k % 3, k * 17 + 1954, clamp(n - k));
    }
    ctx.restore();
    damage({ x0: F.x0, y0: F.y0, x1: F.x1, y1: F.y1 });
    ctx.save(); if (p.cursor > 0) shift("cursors", F.x0 + fw * 0.62, F.y0 + fh * 0.5, ctx);   // the arrows move as one: a scene object
    for (let k = 0, n = p.cursor * 6; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); cursorArrow(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1960) * 0.65), F.y0 + fh * (0.1 + rand(k * 3.7 + 1961) * 0.8), 1.6 + rand(k + 1962) * 1.2); ctx.restore(); }
    ctx.restore();
    return true;
  },
  /** A paint program's pixel grid, zoomed in: a square point at every 24, a line round every eight. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 24;
    gridPen(ctx, color);
    gridPath(ctx, every(s * 8, w, s * 8), every(s * 8, h, s * 8), 0, 0, w, h);
    ctx.beginPath(); for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) ctx.rect(x - 2, y - 2, 4, 4); ctx.fill();
    ctx.restore();
  },
  accent: { fill: () => css(NA.silver), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(NA.light); ctx.lineWidth = 3; run(nx * 2, ny * 2); ctx.strokeStyle = css(NA.deep); ctx.lineWidth = 3; run(-nx * 2, -ny * 2); } },   // a bevelled system panel
  /** Plain capitals with a cyan and a magenta copy split off them (the shadow slider); highlighted words selected: white in a navy box. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, d = fs * 0.025 * Math.min(2, o.shadowAmt), ink = o.fill || naInk();
    if (!o.hiPlate) pass((a, x) => { if (a.hi) { ctx.fillStyle = css(o.hi || NA.navy); ctx.fillRect(x - fs * 0.03, -fs * 0.88, ctx.measureText(a.t).width + fs * 0.06, fs * 1.04); } });   // a selection box (unless the layer has plates of its own under them)
    if (d > 0) { ctx.save(); ctx.globalAlpha = 0.85; ctx.globalCompositeOperation = dark ? "screen" : "multiply"; for (const [s, c] of [[-1, [0, 220, 255]], [1, [255, 0, 170]]]) { const [dx, dy] = fall(s * d, 0); pass((a, x) => { if (!a.hi) { ctx.fillStyle = css(c); ctx.fillText(a.t, x + dx, dy); } }); } ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? (o.hiPlate ? o.hi || NA.light : NA.light) : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: NA.ink, light: NA.light, mid: NA.silver, dark: NA.deep }, stroke: { ink: NA.ink, light: NA.light }, line: 0.6 })),
  sticker: painters({ line: NA.ink, lineScale: 0.5, join: "miter", shadow(ctx, draw) { ctx.save(); ctx.translate(4, 4); draw("rgba(0,0,0,0.6)"); ctx.restore(); } }),
  /** The corner tag: a bevelled system button. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 2) + f * 1.6, h = f * 1.8, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(NA.silver); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(NA.light); ctx.fillRect(x, top, w, 3); ctx.fillRect(x, top, 3, h);
    ctx.fillStyle = css(NA.deep); ctx.fillRect(x, top + h - 3, w, 3); ctx.fillRect(x + w - 3, top, 3, h);
    ctx.fillStyle = ink || css(NA.ink); spaced(ctx, str, x + f * 0.8, top + h * 0.5 + f * 0.36, 2);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a small loading bar in the top corner, with the windows. */
  frame(ctx, env, p) {
    if (p.windows <= 0) return;
    const { w } = env, x = w - 72 - 200, y = 50;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.windows * 3);
    ctx.fillStyle = css(NA.light); ctx.fillRect(x, y, 200, 16); ctx.strokeStyle = css(NA.shade); ctx.lineWidth = 1.5; ctx.strokeRect(x, y, 200, 16);
    ctx.fillStyle = css(NA.navy); for (let i = 0; i < 9; i++) ctx.fillRect(x + 3 + i * 13, y + 3, 10, 10);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 5 * unit; ctx.shadowOffsetY = 5 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit, !dark); },
  prompt: `Icons for a glitch net-art poster — the graphics of an old computer, bold and pixel-crisp — that read at a glance:
- one clear object per sticker (a folder, a floppy disk, an hourglass, a warning sign, a globe, a mouse, a trash can, an envelope, a smiley), drawn flat and chunky like an old desktop icon; no realism, no fine detail;
- flat colour only: "white", "ink", silver greys, navy ("blue"), and the main colour as one accent;
- the app adds a black edge and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Old computer things, built as simple models from a few boxes and cylinders — a beige computer and monitor, a keyboard, a floppy drive, a modem; no realism, no fine detail.
- the renderer paints faces in silver greys with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a dark grey, and "main" the channel colour — use it for one part only.`,
};
netart.elementFx = [
  { key: "dither", name: { zh: "抖动点阵", en: "Dither" }, for: FX_ALL, stage: "fill",
    /** The layer read in square cells and printed in one-bit pixels of ink by an ordered dither: the lighter, the fewer. */
    paint(x, B, a, E) {
      const cs = Math.max(2, Math.round((fast ? 4 : 2.6) * E.k)), cols = Math.ceil(B.w / cs), rows = Math.ceil(B.h / cs), ink = naInk();
      const t = fxCanvas("fxCells", cols, rows), tg = t.getContext("2d");   // one pixel a cell, averaged as it is drawn down, so little is read back tg.globalCompositeOperation = "copy"; tg.imageSmoothingEnabled = true; tg.imageSmoothingQuality = "high";
      tg.drawImage(x.canvas, B.x0, B.y0, cols * cs, rows * cs, 0, 0, cols, rows);
      const img = tg.getImageData(0, 0, cols, rows).data;
      x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h);   // the layer fades out as its dither comes in
      x.globalCompositeOperation = "source-over"; x.fillStyle = css(ink); x.beginPath();
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4;
        if (img[q + 3] < 100) continue;
        const lum = (img[q] * 54 + img[q + 1] * 183 + img[q + 2] * 19) / 65280;   // (read back without its alpha multiplied in)
        if ((dark ? lum : 1 - lum) * 0.85 + 0.12 > bayer(i, j)) x.rect(B.x0 + i * cs, B.y0 + j * cs, cs, cs);
      }
      x.fill();
    } },
  { key: "sort", name: { zh: "像素排序", en: "Pixel sorting" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.5 }),
    /** A one-pixel column of the layer stretched into a streak to the right, band after band. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      for (let i = 0, n = Math.round(6 + 60 * a); i < n; i++) {
        const y = Math.floor(B.h * E.R(i * 1.9 + 21)), bh = Math.max(1, Math.round((2 + E.R(i * 2.7 + 22) * 10) * E.k)), sx = Math.floor(B.w * E.R(i * 3.3 + 23)), len = B.w * (0.05 + E.R(i * 4.1 + 24) * 0.45) * a;
        x.drawImage(src, sx, y, 1, Math.min(bh, B.h - y), B.x0 + sx, B.y0 + y, len, Math.min(bh, B.h - y));
      }
    } },
  { key: "mosh", name: { zh: "数据错位", en: "Datamosh" }, for: FX_ALL, stage: "filter", reach: (B) => { const c = Math.max(4, Math.min(B.w, B.h) * 0.12) * 1.5; return { l: c, t: c * 0.5, r: c, b: c * 0.5 }; },
    /** Blocks of the layer copied a few cells off, some tinted, a few in flat colour. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), cell = Math.max(4, Math.min(B.w, B.h) * 0.12), spot = boost(E.C, 0.7);
      for (let i = 0, n = Math.round(3 + 14 * a); i < n; i++) {
        const bw = cell * (1 + Math.floor(E.R(i * 2.1 + 31) * 3)), bh = cell * (1 + Math.floor(E.R(i * 2.9 + 32) * 2)), sx = (B.w - bw) * E.R(i * 3.7 + 33), sy = (B.h - bh) * E.R(i * 4.3 + 34);
        const dx = B.x0 + sx + Math.round((E.R(i * 5.1 + 35) - 0.5) * 6) * cell * 0.5, dy = B.y0 + sy + Math.round((E.R(i * 5.9 + 36) - 0.5) * 2) * cell * 0.5, kind = E.R(i * 6.7 + 37);
        if (bw >= B.w || bh >= B.h) continue;
        if (kind < 0.2) { x.globalCompositeOperation = "source-over"; x.fillStyle = css([spot, [255, 40, 160], [40, 200, 255], [250, 210, 40]][i % 4], 0.9); x.fillRect(dx, dy, bw, bh); continue; }
        x.globalCompositeOperation = "source-over"; x.drawImage(src, sx, sy, bw, bh, dx, dy, bw, bh);
        if (kind < 0.45) { x.globalCompositeOperation = "source-atop"; x.fillStyle = css(kind < 0.3 ? spot : [60, 80, 255], 0.45); x.fillRect(dx, dy, bw, bh); }
      }
    } },
  { key: "shift", name: { zh: "扫描错行", en: "Scan shift" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.11, r: B.w * 0.11 }),
    /** Whole bands of the layer slid sideways. */
    paint(x, B, a, E) { slideBands(x, B, a, E, 1, false); } },
];
netart.elementFx.push({ key: "selected", name: { zh: "反白选中", en: "Selected" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 8 * k, r: 8 * k, t: 6 * k, b: 6 * k }),
  /** As if the layer were selected on an old screen: turned white on a navy box, with a little colour fringe at its edges. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxSel"), k = E.k, pad = 6 * k * a, d = 2.5 * k * a;
    x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, a * 1.2); x.fillStyle = css(NA.light); x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2) * 0.85;
    for (const [sd, c] of [[-1, [0, 220, 255]], [1, [255, 0, 170]]]) x.drawImage(shapeIn(src, c, "fxSelFringe"), B.x0 + sd * d, B.y0);
    x.globalAlpha = Math.min(1, a * 1.6); x.fillStyle = css(NA.navy); x.fillRect(B.x0 - pad, B.y0 - pad * 0.6, B.w + pad * 2, B.h + pad * 1.2);
    x.restore();
  } });
