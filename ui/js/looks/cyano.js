// cyanotype: photograms glowing on Prussian blue
// The cyanotype and the blue-printed zine: Prussian blue, unevenly brushed on; things laid on the sheet
// and left white where the light could not reach them, glowing at the edges; soft airbrushed shapes;
// a coarse halftone; sparkles; hairline frames with small numbers. The channel colour is the second
// ink (the highlighted words, the tag). Deep blue ground (dark) or off-white paper printed in blue (light).
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, besideLogo, blurred, canPaint, css, dark, dotScreen, dotsFx, every, flatFx, glowBehind, grain, graphicShape, greeked, gridPath, gridPen, layDown, lum, mapped, mix, openField, pad2, painters, parseColour, placeShape, rand, region, role, sparkle, tonesFx, upright, values, wash, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CYA = { prussian: [20, 54, 132], deep: [9, 24, 74], ink: [6, 14, 46], white: [236, 244, 255], pale: [150, 194, 246], paper: [236, 230, 214] };
const cyaGround = () => (dark ? CYA.prussian : CYA.paper), cyaInk = () => (dark ? CYA.white : CYA.prussian);
export const cyano = {
  id: "cyano",
  art: "glow",
  repaint: (c) => `a cyanotype print made from a photograph: Prussian blue and white only, the lights glowing white with soft edges like a photogram, uneven brushed-on blue with darker streaks at the edges, a coarse halftone in places, paper texture; still the same picture, no text.`,
  about: { zh: "蓝晒光影：氰版蓝晒和蓝色油印小志的样子——普鲁士蓝刷得深浅不匀，频道图形像实物压在感光纸上留下的白影，边缘发光；喷枪喷出的柔和形状、粗网点、闪烁的星光、细线框和小编号；频道主色作为第二种油墨，用在强调词和角标上。可选深蓝底或米白纸底（纸上印蓝）。梦幻、安静、有手作感——适合科学、宇宙、自然、诗意与情绪向内容。", en: "Cyanotype: the cyanotype print and the blue-printed zine — Prussian blue brushed on unevenly; the channel graphic left white as if laid on the paper in the sun, glowing at its edges; soft airbrushed shapes, a coarse halftone, sparkles, hairline frames and small numbers; the channel colour as a second ink for highlighted words and the tag. Deep blue, or off-white paper printed in blue. Dreamy, quiet, handmade — for science, space, nature, poetry and mood pieces." },
  name: { zh: "蓝晒光影", en: "Cyanotype" },
  seeded: true,
  params: [
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "发光白影", en: "Glowing photogram" } },
    { key: "spray", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "喷枪柔雾", en: "Airbrush" } },
    { key: "stain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "刷涂不匀", en: "Uneven brushing" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "粗网点", en: "Coarse halftone" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "星光", en: "Sparkles" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "细线与编号", en: "Hairlines and numbers" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "颗粒", en: "Grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片蓝晒", en: "Photo as cyanotype" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.24, side: 0.33, strip: 0.12 }),
  theme: (base) => ({ ...base, field: css(cyaGround()), text: css(cyaInk()), dim: css(cyaInk(), 0.6), titleFill: css(cyaInk()), titleInk: css(cyaGround()), grid: () => css(cyaInk(), 0.18) }),
  /**
   * The blue (or the paper), brushed unevenly; soft airbrushed shapes; the channel graphic left white
   * and glowing; sparkles. A photo becomes a cyanotype: grey, its darks into Prussian blue, its lights
   * left white, and the halftone over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = cyaGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], CYA.prussian, 0.9), p.duo);
      wash(ctx, w, h, "screen", CYA.deep, p.duo * 0.5);
      if (dark) wash(ctx, w, h, "soft-light", CYA.white, p.duo * 0.25);
      dotScreen(ctx, w, h, CYA.ink, 8, 0.5 * p.halftone);
      return true;
    }
    if (!L.grid) return true;
    if (p.stain > 0) {   // brushed on unevenly: darker blotches, and streaks along the edges where the brush turned
      const deep = dark ? CYA.deep : CYA.prussian;
      for (let i = 0; i < 14; i++) {
        const x = rand(i * 3.7 + 260) * w, y = rand(i * 4.3 + 261) * h, r = u * (0.15 + rand(i * 5.1 + 262) * 0.35), g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css(deep, (dark ? 0.5 : 0.12) * p.stain)); g.addColorStop(1, css(deep, 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.save(); ctx.lineCap = "round";
      for (let i = 0; i < 40; i++) {   // brush strokes in from the edges
        const side = i % 4, t = rand(i * 2.1 + 270), len = u * (0.1 + rand(i * 3.3 + 271) * 0.3), lw = u * (0.004 + rand(i * 4.4 + 272) * 0.02);
        const [x0, y0, dx, dy] = side === 0 ? [t * w, -10, 0.15, 1] : side === 1 ? [w + 10, t * h, -1, 0.1] : side === 2 ? [t * w, h + 10, -0.1, -1] : [-10, t * h, 1, -0.15];
        ctx.strokeStyle = css(deep, (dark ? 0.6 : 0.3) * p.stain * (0.4 + rand(i + 273) * 0.6)); ctx.lineWidth = lw;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + dx * len, y0 + dy * len); ctx.stroke();
      }
      ctx.restore();
    }
    if (p.spray > 0 && canPaint(ctx)) {   // airbrushed shapes: soft-edged blobs of a lighter blue, with a fringe of spray
      const pale = dark ? CYA.pale : mix(CYA.pale, CYA.prussian, 0.25), n = Math.round(2 + 4 * p.spray);
      for (let i = 0; i < n; i++) {
        const x = rand(i * 6.1 + 280) * w, y = rand(i * 7.3 + 281) * h, r = u * (0.06 + rand(i * 8.9 + 282) * 0.14) * (0.6 + 0.6 * p.spray);
        blurred(ctx, r * 0.5, css(pale, 0.75 * p.spray), () => { ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + rand(i + 283) * 0.6), rand(i + 284) * 3, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill(); });
        ctx.fillStyle = css(pale, 0.55 * p.spray);
        for (let j = 0; j < 160 * p.spray; j++) { const a = rand(i * 31 + j * 0.37 + 285) * TAU, d = r * (0.9 + Math.pow(rand(i * 17 + j * 0.53 + 286), 2) * 0.9); ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9, 2, 2); }
      }
    }
    const S = p.glow > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the photogram: the graphic's shape left white, glowing at its edges; larger and turned a little, toward the open side
      // the photogram: the graphic's shape left light, a glow round it, a sharper core; a ghost behind the lettering, as faint as the slider says
      const F = openField(env), size = (F.y1 - F.y0) * (0.5 + 0.3 * p.glow), cx = F.x0 + (F.x1 - F.x0) * 0.62, cy = (F.y0 + F.y1) / 2, rot = (rand(290) - 0.5) * 0.5;
      const light = dark ? CYA.white : CYA.prussian, x = workLike(ctx, "cyano");
      blurred(x, size * 0.06, css(dark ? CYA.pale : CYA.prussian, 0.8), () => placeShape(x, S, [0, 0, 0], cx, cy, size, rot));
      blurred(x, size * 0.015, css(light, 0.9), () => placeShape(x, S, [0, 0, 0], cx, cy, size, rot));
      x.globalAlpha = 0.85; placeShape(x, S, dark ? mix(CYA.white, CYA.pale, 0.35) : mix(CYA.prussian, CYA.paper, 0.3), cx, cy, size, rot);
      layDown(ctx, x, (dark ? 0.35 : 0.22) + (dark ? 0.45 : 0.35) * p.glow);
    }
    if (p.stars > 0) {
      const col = dark ? CYA.white : CYA.prussian, n = Math.round(1 + 6 * p.stars);
      for (let i = 0; i < n; i++) sparkle(ctx, w * (0.06 + rand(i * 3.3 + 300) * 0.88), h * (0.08 + rand(i * 4.1 + 301) * 0.8), u * (0.012 + rand(i * 5.9 + 302) * 0.03) * (0.6 + 0.6 * p.stars), col, dark ? 1 : 0.4);
    }
    return true;
  },
  /** Blueprint paper: a fine grid every 24, a firmer one every 120. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fine = (n) => every(24, n, 24).filter((v) => v % 120);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.5; gridPath(ctx, fine(w), fine(h), 0, 0, w, h);
    ctx.globalAlpha = 1; gridPath(ctx, every(120, w, 120), every(120, h, 120), 0, 0, w, h);
    ctx.restore();
  },
  accent: {
    fill: () => css(dark ? CYA.deep : CYA.prussian),
    tone: () => css(dark ? CYA.prussian : CYA.pale, Math.min(1, 1.4 * values.halftone)), toneScale: 0.7,   // the halftone slider reaches the block too
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.setLineDash([3, 7]); ctx.strokeStyle = css(dark ? CYA.white : CYA.prussian, 0.7); ctx.lineWidth = 2; run(nx * 12, ny * 12); ctx.setLineDash([]); },
  },
  /** A serif in the light: on the blue it glows (the shadow slider sets how much); highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || cyaInk(), hi = o.hi || o.C || CYA.pale, glow = Math.min(2, o.shadowAmt);
    if (glow > 0) { ctx.save(); ctx.shadowColor = css(dark ? CYA.pale : CYA.prussian, dark ? 0.85 : 0.3); ctx.shadowBlur = fs * 0.16 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: cyaInk() }, stroke: { ink: cyaInk() } }
    : { fill: { ink: CYA.ink, light: CYA.white, mid: CYA.pale, dark: CYA.deep, colour: (c) => (lum(c) > 0.55 ? CYA.pale : mix(CYA.prussian, CYA.pale, 0.3)) }, stroke: { ink: CYA.ink, light: CYA.white }, line: 0.6 }),
  sticker: painters({ line: null, tone: (fill) => { const c = parseColour(fill); if (!c) return fill; const r = role(c); return css(r === "ink" ? CYA.ink : r === "light" ? CYA.white : r === "colour" ? (lum(c) > 0.55 ? CYA.pale : mix(CYA.prussian, CYA.pale, 0.3)) : c, c[3]); },
    shadow(ctx, draw) { ctx.save(); ctx.shadowColor = css(CYA.white, 0.7); ctx.shadowBlur = 16; draw(css(CYA.white, 0.25)); ctx.restore(); } }),
  /** The corner tag: a hairline box with the lettering, a filled square of the channel colour before it. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = spacedW(ctx, str, 4), sq = f * 0.62, w = f * 0.6 + sq + f * 0.5 + tw + f * 0.6, h = f * 1.6, top = y + (fs * 1.34 - h), line = css(cyaInk(), 0.9);
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = css(C); ctx.fillRect(x + f * 0.6, top + (h - sq) / 2, sq, sq);
    ctx.fillStyle = ink || line; spaced(ctx, str, x + f * 0.6 + sq + f * 0.5, top + h * 0.5 + f * 0.36, 4);
    for (const [cx, cy] of [[x, top], [x + w, top], [x, top + h], [x + w, top + h]]) ctx.fillRect(cx - 3, cy - 3, 6, 6);   // the corner points of a frame being measured
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: a hairline border with measured corners, a dashed box of small print, the number of the plate. */
  frame(ctx, env, p) {
    const a = p.lines;
    if (a <= 0) return;
    const { w, h } = env, col = css(cyaInk(), 0.75 * a), i = env.o.catIndex;
    ctx.save(); ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
    ctx.strokeRect(28, 28, w - 56, h - 56);
    for (const [x, y] of [[28, 28], [w - 28, 28], [28, h - 28], [w - 28, h - 28]]) { ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke(); }
    ctx.font = `italic 400 40px ${fonts.serif}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillText(pad2(i + 1), besideLogo(env, w - 60), 92);
    if (a > 0.3) {
      const bw = Math.min(300, w * 0.2), bx = w - 60 - bw, by = h - 170;
      ctx.setLineDash([4, 5]); ctx.strokeRect(bx, by, bw, 96); ctx.setLineDash([]);
      for (const [x, y] of [[bx, by], [bx + bw, by], [bx, by + 96], [bx + bw, by + 96]]) ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
      greeked(ctx, bx + 14, by + 16, bw - 28, 5, 13, css(cyaInk(), 0.55 * a), 310 + i);
    }
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left";
    spaced(ctx, `PLATE ${pad2(i + 1)} / ${(env.cat.code || "").toUpperCase()} / ${(env.o.profile.brand.name || "").toUpperCase()}`, 60, h - 44, 3);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(dark ? CYA.white : CYA.prussian, dark ? 0.6 : 0.35); ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  /** The halftone over all (lightly), and grain. */
  post(ctx, w, h, C, p, unit = 1) {
    dotScreen(ctx, w, h, dark ? CYA.deep : CYA.prussian, 7, 0.22 * p.halftone, dark ? "multiply" : "multiply");
    grain(ctx, p.grain * 0.8, unit, !dark);
  },
  prompt: `Stickers for a cyanotype zine — objects laid on light-sensitive paper, left white where they shaded it — that read at a glance:
- one clear, recognisable silhouette per sticker (a leaf, a flower, a hand, a shell, a planet, an astronaut, a bird, a key); a few inner lines are welcome as "detail"; no realism, no perspective;
- flat colour only: "white" for the object, "blue" and the main colour as accents, "ink" for a few details; the app turns colours into blues;
- the app adds a soft white glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a blueprint or a cyanotype plate would show them: a few boxes and cylinders, cleanly proportioned — a telescope, a lamp, a camera, a jar; no realism, no fine detail.
- the renderer prints faces in white, pale blue and Prussian blue: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" is Prussian blue, and "main" comes out a pale blue.`,
};
cyano.elementFx = [
  { key: "white", name: { zh: "发光白影", en: "Glowing white figure" }, for: FX_ALL, stage: "fill",
    /** The layer as the white a cyanotype leaves where light was held off. */
    paint: flatFx(() => css(CYA.white)) },
  { key: "spray", name: { zh: "喷枪柔雾", en: "Airbrush haze" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 70 * k, t: 70 * k, r: 70 * k, b: 70 * k }),
    /** A soft spray of white round the layer, a few droplets flung further. */
    paint(x, B, a, E) {
      const R = (8 + 26 * a) * E.k;
      glowBehind(x, B, region(x, B, "fxA"), R, 0.85 * Math.min(1, a * 2.5), CYA.white);
      x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = css(CYA.white, 0.7);
      for (let k = 0, n = Math.round(80 * a); k < n; k++) { const t = E.R(k * 1.7 + 51) * TAU, s = 0.5 + 0.55 * E.R(k * 2.9 + 52), px = B.x0 + B.w / 2 + Math.cos(t) * (B.w / 2 + R * s), py = B.y0 + B.h / 2 + Math.sin(t) * (B.h / 2 + R * s); x.beginPath(); x.arc(px, py, (0.6 + E.R(k + 53) * 1.6) * E.k, 0, TAU); x.fill(); }
      x.restore();
    } },
  { key: "halftone", name: { zh: "粗网点", en: "Coarse halftone" }, for: FX_ALL, stage: "over",
    /** Coarse white dots over the layer, as the screen of a cheap print. */
    paint: dotsFx({ colour: () => CYA.white, pitch: (E) => 12 * E.k, size: (p, a) => p * (0.08 + 0.3 * a), mode: "screen" }) },
  { key: "duo", name: { zh: "照片蓝晒", en: "Photo as cyanotype" }, for: FX_PHOTO, stage: "filter",
    /** The photo printed as a cyanotype: Prussian blue to white. */
    paint: tonesFx(() => [[0, CYA.ink], [0.45, CYA.prussian], [0.8, CYA.pale], [1, CYA.white]]) },
];
