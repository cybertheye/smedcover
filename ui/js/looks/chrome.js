// chrome: liquid metal on black, the Y2K cyber poster
// Black (or a cool grey) with a monochrome photograph; the figure turned to liquid chrome, melting into
// drips; a holographic rainbow streak across it; a wireframe sphere and grid; RGB glitch slices; glass
// bubbles; HUD boxes, brackets and status lines; outlined stencil letters; creased paper, grain.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, bevel, blurred, boost, canPaint, clamp, crumple, css, dark, dripsBehind, fast, glassBubble, grain, graphicShape, greeked, grey, gridPen, inPixels, iridescent, layDown, mapTones, mapped, objAt, openField, pad2, painters, parseColour, placeShape, rand, region, role, rounded, shapeCells, shapeIn, shift, slideBands, snap, toneTable, tonesFx, upright, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CR = { black: [10, 10, 12], grey: [208, 208, 206], white: [238, 238, 236], ink: [34, 34, 38] };
const crGround = () => (dark ? CR.black : CR.grey), crInk = () => (dark ? CR.white : CR.ink);   // the grey ground's ink is just off the house ink, so the small parts' ink can be swapped alone
/**
 * A chrome gradient between (x0, y0) and (x1, y1): bands of sky, horizon and ground as polished metal
 * reflects them — each light band falling off softly, then cut hard by the next dark one, as a horizon is.
 */
function chromeFill(ctx, x0, y0, x1, y1) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  [[0, [252, 253, 255]], [0.2, [168, 176, 192]], [0.215, [16, 18, 26]], [0.36, [92, 98, 114]], [0.375, [236, 240, 250]], [0.52, [130, 136, 152]], [0.535, [10, 12, 18]], [0.7, [70, 74, 88]], [0.715, [214, 220, 232]], [0.86, [120, 126, 140]], [0.875, [26, 28, 36]], [1, [84, 88, 100]]].forEach(([t, c]) => g.addColorStop(t, css(c)));
  return g;
}
/** Where the chrome figure stands. */
function crPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.64, cy: F.y0 + fh * 0.5, size };
}
export const chrome = {
  id: "chrome",
  art: "figure",
  repaint: (c) => `a dark Y2K cyber poster made from the photograph: black-and-white with liquid chrome reflections, a holographic rainbow streak, glitch slices and fine scan lines, creased paper and grain, with one accent of ${c}; still the same picture, no text.`,
  about: { zh: "液态铬：黑底上的 Y2K 赛博海报——频道图形变成一尊液态金属，往下熔成一滴滴铬液，一道全息彩虹光横扫过去；身后线框球体和网格，几条 RGB 故障切片，玻璃泡泡，HUD 式的界面框、角标和状态小字，描边的镂空大字；皱纸和颗粒。冷、锐利、未来感——适合科技、AI、电子音乐、潮流、游戏和观点类内容。可选黑底或冷灰底；自带平直的版式。", en: "Liquid chrome: the dark Y2K cyber poster — the channel graphic as a figure of liquid metal melting into drips, a holographic rainbow streak across it; a wireframe sphere and grid behind, RGB glitch slices, glass bubbles, HUD frames, brackets and status lines, outlined stencil letters; creased paper and grain. Cold, sharp, futuristic — for tech, AI, electronic music, fashion, games and opinion. A black or a cool grey ground; flat layouts of its own." },
  name: { zh: "液态铬", en: "Liquid chrome" },
  seeded: true,
  scene: { figure: { zh: "铬身影", en: "Chrome figure" }, wire: { zh: "线框", en: "Wireframe" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "铬身影", en: "Chrome figure" } },
    { key: "drips", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "熔滴", en: "Drips" } },
    { key: "holo", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "全息彩光", en: "Holographic streak" } },
    { key: "wire", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "线框", en: "Wireframe" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "故障切片", en: "Glitch slices" } },
    { key: "hud", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "界面框", en: "HUD frames" } },
    { key: "bubbles", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "玻璃泡泡", en: "Bubbles" } },
    { key: "echo", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "描边大字", en: "Outlined letters" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "皱纸", en: "Creased paper" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "颗粒", en: "Grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(crGround()), text: css(crInk()), dim: css(crInk(), 0.6), titleFill: css(crInk()), titleInk: css(crGround()), grid: () => css(crInk(), 0.12) }),
  /**
   * The ground; outlined letters; the wireframe; the chrome figure with its drips (on a work canvas:
   * the chrome bands, then the bevel); the holographic streak; bubbles; glitch slices over all of it.
   * A photo goes black and white with more contrast, and is sliced too when it fills the canvas.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = crPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, ink = crInk();
    if (L.ground !== false) { ctx.fillStyle = css(crGround()); ctx.fillRect(0, 0, w, h); }
    const slices = () => {
      if (p.glitch <= 0 || !canPaint(ctx)) return;
      const src = snap(ctx, "crSnap"), m = ctx.getTransform(), k = m.a;
      for (let i = 0, n = Math.round(2 + 8 * p.glitch); i < n; i++) {
        const y = F.y0 + fh * rand(i * 2.7 + 1800), bh = u * (0.006 + rand(i * 3.3 + 1801) * 0.03), dx = (rand(i * 4.1 + 1802) - 0.5) * u * 0.12 * p.glitch;
        inPixels(ctx, () => ctx.drawImage(src, 0, m.f + y * k, src.width, bh * k, dx * k, m.f + y * k, src.width, bh * k));
        if (rand(i * 5.3 + 1803) > 0.55) { ctx.fillStyle = css([[255, 40, 80], [40, 220, 255], [80, 255, 120], boost(C, 0.7)][i % 4], 0.85); ctx.fillRect(F.x0 + fw * rand(i * 6.1 + 1804), y, fw * (0.05 + rand(i + 1805) * 0.2), bh * 0.6); }
      }
    };
    if (env.photo) {
      env.drawPhoto(p.mono);
      mapTones(ctx, toneTable([[0, [0, 0, 0]], [0.45, [110, 110, 112]], [1, [248, 248, 248]]], 0.1), p.mono * 0.6);
      if (L.fill) slices();
      return true;
    }
    if (!L.grid) return true;
    if (p.echo > 0) {   // the channel's code, huge, outlined, stood on end down the far side, twice
      const str = (env.cat.code || env.cat.name || "").toUpperCase().slice(0, 8);
      if (str) {
        ctx.save(); ctx.font = `900 ${fh * 0.16}px ${fonts.en}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.strokeStyle = css(ink, 0.55 * Math.min(1, p.echo * 2)); ctx.lineWidth = 2;
        for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate(F.x1 - fh * (0.05 + i * 0.13), F.y0 + 20); ctx.rotate(Math.PI / 2); if (i === 0 || p.echo > 0.5) ctx.strokeText(str, 0, 0); ctx.restore(); }
        ctx.restore();
      }
    }
    if (p.wire > 0) {   // a wireframe sphere behind the figure, and a square of grid
      const r = at.size * (0.35 + 0.2 * p.wire), sx = at.cx - at.size * 0.3, sy = at.cy - at.size * 0.15, a = Math.min(1, p.wire * 2.5);
      ctx.save(); ctx.strokeStyle = css(ink, 0.45 * a); ctx.lineWidth = 1.2;
      shift("wire", sx, sy, ctx);   // the sphere and the square of grid: a scene object
      for (let i = 1; i < 8; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 8; ctx.beginPath(); ctx.ellipse(sx, sy + Math.sin(t) * r, Math.cos(t) * r, Math.cos(t) * r * 0.22, 0, 0, TAU); ctx.stroke(); }
      for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(sx, sy, Math.abs(Math.cos((i * Math.PI) / 8)) * r, r, 0, 0, TAU); ctx.stroke(); }
      const gx = at.cx + at.size * 0.2, gy = F.y0 + fh * 0.12, gs = at.size * 0.5 * p.wire;
      for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(gx + (gs * i) / 10, gy); ctx.lineTo(gx + (gs * i) / 10, gy + gs); ctx.moveTo(gx, gy + (gs * i) / 10); ctx.lineTo(gx + gs, gy + (gs * i) / 10); ctx.stroke(); }
      ctx.restore();
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx), x = workLike(ctx, "chrome");   // a scene object
      if (dark) blurred(ctx, size * 0.06, "rgba(220,230,255,0.18)", () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      if (p.drips > 0) {   // drips from the lowest edge of the shape, read off a coarse grid of it
        const cell = size / 40, x0 = cx - size, y0 = cy - size * 0.6, cols = 80, rows = 50, cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
        for (let k = 0, n = Math.round(4 + 14 * p.drips); k < n; k++) {
          const i = Math.floor(rand(k * 2.3 + 1810) * cols);
          let j = rows - 1; while (j >= 0 && cov[j * cols + i] < 160) j--;
          if (j < 0) continue;
          const dx = x0 + (i + 0.5) * cell, dy = y0 + (j + 0.4) * cell, len = size * (0.05 + rand(k * 3.7 + 1811) * 0.35) * p.drips, dw = cell * (0.8 + rand(k * 4.3 + 1812) * 1.2);
          x.beginPath(); rounded(x, dx - dw / 2, dy - cell, dw, len + cell, dw / 2); x.fillStyle = "#fff"; x.fill();
          x.beginPath(); x.arc(dx, dy + len, dw * 0.7, 0, TAU); x.fill();
        }
      }
      x.globalCompositeOperation = "source-in"; x.fillStyle = chromeFill(x, cx - size * 0.25, cy - size * 0.55, cx + size * 0.15, cy + size * 0.75); x.fillRect(0, 0, w, h);
      bevel(x, S, cx, cy, size, size * 0.008, [255, 255, 255], [0, 0, 0], 0.35);
      x.save(); x.globalCompositeOperation = "source-atop"; x.strokeStyle = "rgba(255,255,255,0.85)"; x.lineCap = "round";   // two specular streaks
      for (const [o, lw] of [[-0.18, 0.035], [0.12, 0.018]]) { x.lineWidth = size * lw; x.beginPath(); x.moveTo(cx - size * 0.6, cy + size * (o - 0.25)); x.quadraticCurveTo(cx, cy + size * (o + 0.05), cx + size * 0.6, cy + size * (o - 0.3)); x.stroke(); }
      x.restore();
      if (p.holo > 0) {   // a rainbow streak smeared across the head
        x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.75 * p.holo;
        x.fillStyle = iridescent(x, cx - size * 0.5, 0, cx + size * 0.5, 0, 0.9); x.fillRect(cx - size, cy - size * 0.3, size * 2, size * 0.12 * (0.5 + p.holo)); x.restore();
      }
      layDown(ctx, x);
      if (p.holo > 0) {   // and its glow trailing off the figure
        const y = cy - size * 0.3 + size * 0.06 * (0.5 + p.holo);
        ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply"; ctx.globalAlpha = 0.6 * p.holo;
        ctx.fillStyle = iridescent(ctx, cx - size * 1.1, 0, cx + size * 0.4, 0, 0.3); ctx.beginPath(); ctx.ellipse(cx - size * 0.35, y, size * 0.75, size * 0.035 * (0.6 + p.holo), 0, 0, TAU); ctx.fill(); ctx.restore();
      }
    }
    for (let k = 0, n = p.bubbles * 6; k < Math.ceil(n); k++) glassBubble(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1820) * 0.68), F.y0 + fh * (0.1 + rand(k * 3.7 + 1821) * 0.8), u * (0.03 + rand(k * 4.9 + 1822) ** 2 * 0.09), dark ? [200, 210, 230] : [120, 130, 150], clamp(n - k));
    slices();
    return true;
  },
  /** A Y2K wireframe room: frames closing in on the centre in perspective, and lines running into it from the edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2, n = 8, inner = 0.12;
    gridPen(ctx, color); ctx.beginPath();
    for (const k of [1, 0.62, 0.4, 0.27, 0.18, inner]) ctx.rect(cx - (w / 2) * k, cy - (h / 2) * k, w * k, h * k);
    for (let i = 0; i <= n; i++) for (const [ex, ey] of [[i / n, 0], [i / n, 1], [0, i / n], [1, i / n]]) { const x = ex * w, y = ey * h; ctx.moveTo(x, y); ctx.lineTo(cx + (x - cx) * inner, cy + (y - cy) * inner); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? [20, 20, 24] : [24, 24, 28]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(CR.white, 0.6); ctx.lineWidth = 1.5; run(0, 0); } },
  /** Capitals in polished chrome (on the grey ground, dark steel), a soft dark shadow under them (the shadow slider); highlighted words in a holographic sheen. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, glow = Math.min(2, o.shadowAmt);
    // type chrome keeps to the light half of the bands (no near-black stripe to break a letter on the black ground); on the grey ground, dark steel
    const g = ctx.createLinearGradient(0, -fs * 0.9, 0, fs * 0.1), stops = dark ? [[0, [255, 255, 255]], [0.42, [196, 204, 218]], [0.5, [128, 134, 150]], [0.6, [238, 242, 250]], [1, [168, 174, 190]]] : [[0, [86, 88, 96]], [0.45, [40, 40, 46]], [0.55, [110, 112, 120]], [1, [52, 54, 60]]];
    stops.forEach(([t, c]) => g.addColorStop(t, css(c)));
    const body = o.fill ? css(o.fill) : g;
    const fillOf = (a, x) => (a.hi ? (o.hi ? css(o.hi) : iridescent(ctx, a.run ? a.run.x0 : x, -fs, a.run ? a.run.x1 : x + ctx.measureText(a.t).width, 0, 0.1)) : body);   // across the whole run
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.35)"; ctx.shadowBlur = fs * 0.12 * glow * k; pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: CR.white }, stroke: { ink: CR.white } } : { fill: { ink: [16, 16, 18], light: CR.white, mid: [150, 152, 158], dark: [50, 52, 58], colour: (c) => grey(c) }, stroke: { ink: CR.white, light: CR.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "colour" ? css(grey(c), c[3]) : fill; } }),
  /** The corner tag: monospaced capitals between HUD brackets. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.52, col = css(crInk());
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2, h = f * 2, top = y + (fs * 1.34 - h), t = f * 0.5;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    for (const [cx, cy, sx, sy] of [[x, top, 1, 1], [x + w, top, -1, 1], [x, top + h, 1, -1], [x + w, top + h, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx, cy + sy * t); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * t, cy); ctx.stroke(); }
    ctx.fillStyle = ink || col; spaced(ctx, str, x + f, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a dashed border, brackets round the figure, a status box with small print, a barcode. */
  frame(ctx, env, p) {
    const a = p.hud;
    if (a <= 0) return;
    const { w, h } = env, at = crPlace(env, p), ink = crInk(), u = Math.min(w, h), i = env.o.catIndex;
    ctx.save(); ctx.strokeStyle = css(ink, 0.5 * a); ctx.fillStyle = css(ink, 0.8 * a); ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]); ctx.strokeRect(24, 24, w - 48, h - 48); ctx.setLineDash([]);
    const bw = at.size * 0.62, bh = at.size * 0.62, t = u * 0.025;
    for (const [cx, cy, sx, sy] of [[at.cx - bw, at.cy - bh, 1, 1], [at.cx + bw, at.cy - bh, -1, 1], [at.cx - bw, at.cy + bh, 1, -1], [at.cx + bw, at.cy + bh, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx, cy + sy * t); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * t, cy); ctx.stroke(); }
    if (a > 0.3) {
      const bx = w - 72 - u * 0.24, by = 92;
      ctx.globalAlpha = Math.min(1, (a - 0.3) * 3); ctx.beginPath(); rounded(ctx, bx, by, u * 0.24, u * 0.1, 10); ctx.stroke();
      ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillText(`STATUS: ${pad2(i + 1)}`, bx + 14, by + 26);
      greeked(ctx, bx + 14, by + 38, u * 0.24 - 28, 3, 10, css(ink, 0.5 * a), 1830 + i);
      ctx.fillStyle = css(ink, 0.8 * a); for (let at2 = 72, k = 0; at2 < 72 + u * 0.12; k++) { const bw2 = 1 + Math.floor(rand(k * 1.7 + 1831) * 3); ctx.fillRect(at2, h - 74, bw2, 26); at2 += bw2 + 1 + Math.floor(rand(k * 2.3 + 1832) * 3); }
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { crumple(ctx, w, h, p.paper * 0.8); grain(ctx, p.grain * 0.7, unit); },
  prompt: `Shiny objects for a dark Y2K cyber poster — sleek, liquid and futuristic — that read at a glance:
- one clear object per sticker (a heart, a star, a butterfly, a rose, a cross, a lightning bolt, a pair of wings, a cube), smooth and simple; no realism, no fine detail;
- flat colour only in greys: "white", light greys, "ink" for dark parts, the main colour (it comes out grey) — the app renders them as chrome;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a Y2K cyber poster would show them: a few boxes and cylinders, sleek and exact — a phone, a speaker, a server tower, a camera; no realism, no fine detail.
- the renderer paints faces in greys and white: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a mid grey.`,
};
chrome.elementFx = [
  { key: "chrome", name: { zh: "铬面", en: "Chrome" }, for: FX_ALL, stage: "fill",
    /** The layer's colour replaced by polished metal — horizon bands, light along its upper-left rim and shade along the other, a specular streak. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), d = Math.max(1, Math.min(B.w, B.h) * 0.012);
      x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop";
      x.globalAlpha = a; x.fillStyle = chromeFill(x, B.x0 + B.w * 0.35, B.y0 - B.h * 0.1, B.x0 + B.w * 0.6, B.y1 + B.h * 0.1); x.fillRect(B.x0, B.y0, B.w, B.h);
      const white = shapeIn(src, [255, 255, 255], "fxW"), black = shapeIn(src, [0, 0, 0], "fxK");
      for (let i = 1; i <= 2; i++) { x.globalAlpha = a * 0.36; x.drawImage(black, B.x0 + d * i * 1.5, B.y0 + d * i * 1.5); x.globalAlpha = a * 0.26; x.drawImage(white, B.x0 - d * i * 1.5, B.y0 - d * i * 1.5); }
      x.globalAlpha = 0.8 * a; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineWidth = Math.max(1, B.h * 0.03);
      x.beginPath(); x.moveTo(B.x0 + B.w * 0.08, B.y0 + B.h * 0.32); x.quadraticCurveTo(B.x0 + B.w * 0.5, B.y0 + B.h * 0.52, B.x1 - B.w * 0.08, B.y0 + B.h * 0.26); x.stroke();
    } },
  { key: "holo", name: { zh: "全息彩光", en: "Holographic streak" }, for: FX_ALL, stage: "over",
    /** A rainbow streak smeared across the layer, a fainter, wider one about it. */
    paint(x, B, a, E) {
      const y = B.y0 + B.h * (0.25 + 0.3 * E.R(5)), bh = B.h * (0.06 + 0.16 * a), turn = E.R(6);
      x.globalCompositeOperation = "source-atop";
      x.globalAlpha = 0.3 * a; x.fillStyle = iridescent(x, B.x0, 0, B.x1, 0, turn); x.fillRect(B.x0, y - bh, B.w, bh * 3);
      x.globalAlpha = 0.8 * a; x.fillRect(B.x0, y, B.w, bh);
    } },
  { key: "drips", name: { zh: "熔滴", en: "Drips" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ b: B.h * 0.65 + 14 * k }),
    /** Drops running down from the layer's lowest edges, each in the colour the layer has there, with a highlight down it (see dripsBehind). */
    paint(x, B, a, E) { dripsBehind(x, B, a, E, null, 1); } },
  { key: "glitch", name: { zh: "故障切片", en: "Glitch slices" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.11, r: B.w * 0.11 }),
    /** Slices of the layer slid sideways, a few with a bar of red, cyan, green or the channel colour. */
    paint(x, B, a, E) { slideBands(x, B, a, E, 2, true); } },
];
chrome.elementFx.push(
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A hard silvery black and white. */
    paint: tonesFx(() => [[0, [0, 0, 0]], [0.45, [110, 110, 112]], [1, [248, 248, 248]]], 0.1) },
);
