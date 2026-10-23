// rave: the psychedelic party poster
// Club and festival posters: a dark violet night; liquid shapes of iridescent chrome; a figure in a
// holographic sheen with an eclipse halo behind; nebulae and stars; a neon perspective grid; an arch
// lined with plus marks; glass bubbles; orbits; a red-and-cyan fringe.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, bevel, blurred, boost, canPaint, clamp, css, fast, flatFx, glassBubble, grain, graphicShape, gridPen, inPixels, iridescent, layDown, mapTones, mapped, mix, objAt, openField, painters, placeShape, rainbow, rand, rePlate, rgbFringe, rounded, shift, snap, softCopy, toneTable, tonesFx, upright, wherePainted, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const RV = { night: [12, 6, 24], pink: [255, 40, 160], cyan: [40, 230, 255], violet: [140, 60, 255], white: [255, 250, 255] };
/** Where the figure stands: toward the open field's far side, as tall as the slider says. */
function rvPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 0.5 * p.figure);
  return { F, cx: F.x0 + fw * 0.66, cy: F.y0 + fh * 0.52, size };
}
/** A liquid blob: a smooth closed form of wandering radius, its iridescent sheen, a glow behind it, glossy highlights. */
function liquidBlob(ctx, cx, cy, R, k, a) {
  const pts = [];
  for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU, r = R * (0.6 + 0.55 * rand(k + i * 1.7)); pts.push([cx + Math.cos(t) * r * 1.25, cy + Math.sin(t) * r * 0.85]); }
  const path = () => { ctx.beginPath(); for (let i = 0; i <= pts.length; i++) { const p0 = pts[i % pts.length], p1 = pts[(i + 1) % pts.length], m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]; i ? ctx.quadraticCurveTo(p0[0], p0[1], m[0], m[1]) : ctx.moveTo(m[0], m[1]); } ctx.closePath(); };
  ctx.save(); ctx.globalAlpha = a;
  blurred(ctx, R * 0.25, css(rainbow(rand(k + 30)), 0.55), () => { path(); ctx.fill(); });
  path(); ctx.fillStyle = iridescent(ctx, cx - R * 1.3, cy - R, cx + R * 1.3, cy + R, rand(k + 31)); ctx.fill();
  ctx.save(); path(); ctx.clip();
  const sh = ctx.createLinearGradient(cx, cy - R, cx, cy + R); sh.addColorStop(0, "rgba(255,255,255,0.35)"); sh.addColorStop(0.5, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(10,0,30,0.45)"); ctx.fillStyle = sh; ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
  ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) { ctx.lineWidth = R * (0.03 + 0.03 * rand(k + i + 40)); ctx.beginPath(); ctx.arc(cx - R * 0.2, cy - R * 0.1, R * (0.45 + i * 0.22), Math.PI * (1.05 + rand(k + i + 41) * 0.2), Math.PI * (1.35 + rand(k + i + 42) * 0.3)); ctx.stroke(); }
  ctx.restore(); ctx.restore();
}
export const rave = {
  id: "rave",
  art: "figure",
  repaint: (c) => `a psychedelic club-night poster made from the photograph: a dark violet night, iridescent holographic chrome and liquid neon colour (${c}, hot pink, cyan, violet), glowing light, nebula clouds and stars, glossy and surreal; still the same picture, no text.`,
  about: { zh: "迷幻派对：夜店和音乐节海报的味道——深紫的夜，流动的镭射液态金属，频道图形变成一层全息彩光的身影，身后一轮日食光环；可加星云与星星、合成波霓虹网格地面、带十字标记的拱门、玻璃泡泡、环绕的光轨和红青色差。迷幻、发光、超现实——适合音乐、派对、电子、潮流、夜生活和科幻内容。只有暗夜底；自带平直的版式。", en: "Rave: club-night and festival posters — a deep violet night, flowing liquid iridescent chrome, the channel graphic as a figure in a holographic sheen with an eclipse halo behind; nebulae and stars, a neon synthwave grid floor, an arch lined with plus marks, glass bubbles, orbits and a red-and-cyan fringe if you like. Psychedelic, glowing, surreal — for music, parties, electronic, fashion, nightlife and sci-fi. Night ground only; flat layouts of its own." },
  name: { zh: "迷幻派对", en: "Psychedelic rave" },
  oneTheme: true,
  seeded: true,
  scene: { figure: { zh: "全息身影", en: "Holographic figure" }, liquid: { zh: "液态镭射", en: "Liquid chrome" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "全息身影", en: "Holographic figure" } },
    { key: "liquid", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "液态镭射", en: "Liquid chrome" } },
    { key: "halo", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "日食光环", en: "Eclipse halo" } },
    { key: "nebula", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "星云", en: "Nebula" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "霓虹网格", en: "Neon grid" } },
    { key: "arch", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "拱门", en: "Arch" } },
    { key: "bubbles", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "玻璃泡泡", en: "Bubbles" } },
    { key: "rings", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "光轨", en: "Orbits" } },
    { key: "fringe", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "色差", en: "Colour fringe" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "辉光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "颗粒", en: "Grain" } },
    { key: "neon", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片霓虹热感", en: "Photo in neon heat" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(RV.night), text: css(RV.white), dim: css(RV.white, 0.6), titleFill: css(RV.white), titleInk: css(RV.night), grid: () => css(mix(RV.violet, RV.pink, 0.5), 0.22) }),
  /**
   * The night; nebulae and stars; the grid floor; the arch with its plus marks; the eclipse halo; liquid
   * blobs; the holographic figure; orbits and bubbles; then the fringe and the glow over all of it. A
   * photo is mapped by lightness onto neon heat colours (violet, magenta, orange, a pale cyan white).
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), at = rvPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, spot = boost(C, 0.7);
    if (L.ground !== false) { ctx.fillStyle = css(RV.night); ctx.fillRect(0, 0, w, h); }
    const after = () => { if (p.fringe > 0) wherePainted(ctx, (c) => rgbFringe(c, u * 0.006 * p.fringe), L.base === "clear"); if (p.bloom > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "rvGlow"), 16, "rvSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.6 * p.bloom; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); } };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, RV.night], [0.3, [90, 20, 150]], [0.55, RV.pink], [0.78, [255, 160, 50]], [1, [210, 255, 250]]], 0.1), p.neon);
      if (L.fill) after();
      return true;
    }
    if (!L.grid) return true;
    if (p.figure > 0 || p.arch > 0 || p.halo > 0 || p.rings > 0) [at.cx, at.cy] = objAt("figure", at.cx, at.cy, ctx);   // the figure, and the arch, eclipse, orbits and floor's vanishing point round it: a scene object
    if (p.nebula > 0) {
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (let k = 0; k < 5; k++) { const x = rand(k * 3.1 + 1700) * w, y = rand(k * 4.3 + 1701) * h, r = u * (0.3 + rand(k * 5.7 + 1702) * 0.5), c = [RV.violet, RV.pink, [30, 120, 255], spot, [40, 200, 200]][k], g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(c, 0.32 * p.nebula)); g.addColorStop(1, css(c, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
      ctx.restore();
      for (let k = 0, n = Math.round(160 * p.nebula); k < n; k++) { ctx.fillStyle = css(RV.white, 0.3 + 0.7 * rand(k * 2.3 + 1703)); ctx.beginPath(); ctx.arc(rand(k * 3.1 + 1704) * w, rand(k * 4.7 + 1705) * h, 0.6 + rand(k * 5.9 + 1706) ** 3 * 2.4, 0, TAU); ctx.fill(); }
    }
    if (p.grid > 0) {   // a neon floor running to a vanishing point on the horizon
      const hz = F.y0 + fh * (0.66 - 0.12 * p.grid), vx = at.cx, a = Math.min(1, p.grid * 2.5);
      ctx.save(); ctx.strokeStyle = css(RV.pink, 0.85 * a); ctx.lineWidth = 2; ctx.shadowColor = css(RV.pink); ctx.shadowBlur = 10;
      for (let i = -14; i <= 14; i++) { ctx.beginPath(); ctx.moveTo(vx, hz); ctx.lineTo(vx + i * fw * 0.16, F.y1 + fh * 0.4); ctx.stroke(); }
      for (let j = 1; j <= 12; j++) { const t = (j / 12) ** 2.2, y = hz + (F.y1 - hz) * t; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      ctx.restore();
      const g = ctx.createLinearGradient(0, hz - fh * 0.2, 0, hz); g.addColorStop(0, css(RV.pink, 0)); g.addColorStop(1, css(RV.pink, 0.35 * a)); ctx.fillStyle = g; ctx.fillRect(0, hz - fh * 0.2, w, fh * 0.2);
    }
    if (p.arch > 0) {   // an arch round the figure, plus marks down both sides of it
      const aw = at.size * (0.9 + 0.3 * p.arch), ah = Math.min(fh * 0.92, at.size * 1.35), ax = at.cx - aw / 2, ay = F.y0 + (fh - ah) / 2, a = Math.min(1, p.arch * 3);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = css(RV.violet); ctx.lineWidth = 4; ctx.shadowColor = css(RV.violet); ctx.shadowBlur = 14;
      ctx.beginPath(); ctx.moveTo(ax, ay + ah); ctx.lineTo(ax, ay + aw / 2); ctx.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
      ctx.shadowBlur = 0; ctx.strokeStyle = css(RV.pink); ctx.lineWidth = 2.5;
      for (let y = ay + aw / 2; y < ay + ah; y += 34) for (const x of [ax - 28, ax + aw + 28]) { ctx.beginPath(); ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); ctx.stroke(); }
      ctx.restore();
    }
    if (p.halo > 0) {   // an eclipse behind the head: a glowing rim, a black disc
      const r = at.size * (0.2 + 0.18 * p.halo), hx = at.cx, hy = at.cy - at.size * 0.22;
      blurred(ctx, r * 0.25, css(mix(RV.white, spot, 0.3), Math.min(1, p.halo * 2)), () => { ctx.beginPath(); ctx.arc(hx, hy, r * 1.04, 0, TAU); ctx.fill(); });
      ctx.fillStyle = css([4, 2, 10]); ctx.beginPath(); ctx.arc(hx, hy, r, 0, TAU); ctx.fill();
    }
    ctx.save(); if (p.liquid > 0) shift("liquid", F.x0 + fw * 0.65, F.y0 + fh * 0.4, ctx);   // the blobs of liquid chrome move as one: a scene object
    for (let k = 0, n = p.liquid * 4; k < Math.ceil(n); k++) liquidBlob(ctx, F.x0 + fw * (0.35 + rand(k * 3.3 + 1710) * 0.6), F.y0 + fh * (0.15 + rand(k * 4.1 + 1711) * 0.7), u * (0.08 + 0.1 * rand(k * 5.3 + 1712)) * (0.6 + 0.6 * p.liquid), k * 13.7 + 1713, clamp(n - k));
    ctx.restore();
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { cx, cy, size } = at, x = workLike(ctx, "rave");
      blurred(ctx, size * 0.05, css(RV.cyan, 0.45), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in"; x.fillStyle = iridescent(x, cx - size * 0.5, cy - size * 0.5, cx + size * 0.5, cy + size * 0.5, rand(1720)); x.fillRect(0, 0, w, h);
      bevel(x, S, cx, cy, size, size * 0.01, RV.white, [30, 0, 60], 0.9);
      layDown(ctx, x);
    }
    for (let k = 0, n = p.rings * 3; k < Math.ceil(n); k++) {
      ctx.save(); ctx.globalAlpha = clamp(n - k) * 0.8; ctx.translate(at.cx, at.cy + at.size * 0.05); ctx.rotate(-0.35 + k * 0.28); ctx.strokeStyle = css(k === 1 ? spot : RV.white); ctx.lineWidth = 2; ctx.setLineDash(k === 2 ? [6, 9] : []);
      ctx.beginPath(); ctx.ellipse(0, 0, at.size * (0.55 + k * 0.12), at.size * (0.13 + k * 0.03), 0, 0, TAU); ctx.stroke(); ctx.restore();
    }
    for (let k = 0, n = p.bubbles * 8; k < Math.ceil(n); k++) glassBubble(ctx, F.x0 + fw * (0.3 + rand(k * 2.9 + 1730) * 0.68), F.y0 + fh * (0.08 + rand(k * 3.7 + 1731) * 0.84), u * (0.025 + rand(k * 4.9 + 1732) ** 2 * 0.08), mix(RV.cyan, spot, 0.4), clamp(n - k));
    after();
    return true;
  },
  /** A honeycomb, 48 a side. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 48, dx = s * 1.5, dy = s * Math.sqrt(3);
    gridPen(ctx, color); ctx.beginPath();
    for (let i = 0, x = 0; x < w + s; i++, x += dx) for (let y = ((i % 2) * dy) / 2; y < h + dy; y += dy) {
      for (let k = 0; k <= 6; k++) { const t = (k * Math.PI) / 3; k ? ctx.lineTo(x + Math.cos(t) * s, y + Math.sin(t) * s) : ctx.moveTo(x + s, y); }
    }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css([24, 12, 44]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny, C) { ctx.lineCap = "butt"; ctx.strokeStyle = css(boost(C || RV.pink, 0.7)); ctx.lineWidth = 4; run(0, 0); } },
  /** White capitals in a neon glow of the channel colour (the shadow slider); highlighted words in a holographic sheen. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, spot = boost(o.C || RV.pink, 0.7), glow = Math.min(2, o.shadowAmt), ink = o.fill || RV.white;
    const fillOf = (a, x) => (a.hi ? (o.hi ? css(o.hi) : iridescent(ctx, a.run ? a.run.x0 : x, -fs, a.run ? a.run.x1 : x + ctx.measureText(a.t).width, 0, 0.8)) : css(ink));   // across the whole run
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(spot, 0.9); ctx.shadowBlur = fs * 0.18 * glow * k; pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = fillOf(a, x); ctx.fillText(a.t, x, 0); });
  },
  // on the dark block the small parts' ink turns white
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: RV.white }, stroke: { ink: RV.white } } : { fill: { ink: [30, 10, 50], light: RV.white, mid: [180, 140, 255], dark: [60, 20, 100] }, stroke: { ink: RV.white, light: RV.white }, line: 0.5 }),
  sticker: painters({ line: null, shadow(ctx, draw, fill) { ctx.save(); ctx.globalAlpha = 0.7; ctx.shadowColor = fill; ctx.shadowBlur = 20; draw(fill); ctx.restore(); } }),
  /** The corner tag: a neon outline pill, white lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.62, spot = boost(C, 0.7);
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(spot); ctx.shadowBlur = 12; ctx.strokeStyle = css(spot); ctx.lineWidth = 3; ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.stroke(); ctx.restore();
    ctx.fillStyle = ink || css(RV.white); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: plus marks in the four corners. */
  frame(ctx, env) {
    const { w, h } = env;
    ctx.save(); ctx.strokeStyle = css(RV.white, 0.7); ctx.lineWidth = 2;
    for (const [x, y] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) { ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke(); }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(boost(C, 0.7), 0.7); ctx.shadowBlur = 24 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Glowing stickers for a psychedelic club-night poster — bold, shiny and surreal — that read at a glance:
- one clear, iconic object per sticker (a planet, a record, a disco ball, a butterfly, an eye, a flower, a lightning bolt, a crystal), simple; no realism, no fine detail;
- flat colour only in neon: the main colour, hot pink ("red"), cyan ("blue"), violet, with "white" for highlights;
- the app adds a soft neon glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects for a club night, built as simple models from a few boxes and cylinders — a speaker stack, a DJ deck, a light tower, a podium; no realism, no fine detail.
- the renderer paints faces in deep violet and pale neon tones: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep violet, and "main" a pale lavender.`,
};
rave.elementFx = [
  { key: "holo", name: { zh: "全息镭射", en: "Holographic sheen" }, for: FX_ALL, stage: "fill",
    /** The layer in a soap-film rainbow, a glossy arc across it. */
    paint(x, B, a, E) {
      flatFx((g) => iridescent(g, B.x0, B.y0, B.x1, B.y1, E.R(7)))(x, B, a, E);
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.7 * a; x.strokeStyle = "#fff"; x.lineCap = "round"; x.lineWidth = Math.max(1, B.h * 0.035);
      x.beginPath(); x.moveTo(B.x0 + B.w * 0.1, B.y0 + B.h * 0.3); x.quadraticCurveTo(B.x0 + B.w * 0.5, B.y0 + B.h * 0.12, B.x1 - B.w * 0.1, B.y0 + B.h * 0.32); x.stroke(); x.restore();
    } },
  { key: "halo", name: { zh: "日食光环", en: "Eclipse halo" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.5, t: B.h * 0.5, r: B.w * 0.5, b: B.h * 0.5 }),
    /** An oval ring of light hugging the layer, as round an eclipse, wider as it rises. */
    paint(x, B, a, E) {
      const s = (1.25 + 0.35 * a) / 0.9, rx = (B.w / 2) * s, ry = (B.h / 2) * s, g = x.createRadialGradient(0, 0, rx * 0.72, 0, 0, rx * 1.12);
      g.addColorStop(0, css(RV.violet, 0)); g.addColorStop(0.35, css(RV.pink, 0.9)); g.addColorStop(0.45, css(RV.white, 1)); g.addColorStop(0.6, css(RV.cyan, 0.6)); g.addColorStop(1, css(RV.violet, 0));
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 3); x.translate(B.x0 + B.w / 2, B.y0 + B.h / 2); x.scale(1, ry / rx);
      x.fillStyle = g; x.fillRect(-rx * 1.15, -rx * 1.15, rx * 2.3, rx * 2.3); x.restore();
    } },
  { key: "fringe", name: { zh: "色差", en: "Colour fringe" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.04, t: B.h * 0.04, r: B.w * 0.04, b: B.h * 0.04 }),
    /** Red spread outward and blue drawn in about the layer's middle, as a cheap lens fringes. */
    paint(x, B, a) { const s = 0.05 * a; rePlate(x, B, [[[255, 0, 0], 0, 0, 1 + s], [[0, 255, 0], 0, 0, 1], [[0, 0, 255], 0, 0, 1 - s]]); } },
  { key: "neon", name: { zh: "照片霓虹热感", en: "Photo in neon heat" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a heat image of the club: night, violet, pink, orange, white. */
    paint: tonesFx(() => [[0, RV.night], [0.3, RV.violet], [0.55, RV.pink], [0.78, [255, 170, 60]], [1, RV.white]]) },
];
