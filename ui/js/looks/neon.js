// neon: noir pop illustration in three neon tones
// The neon pop portrait: everything reduced to a few flat tones mapped from dark to light onto a neon
// palette (the channel colour, its hot complement, a deep night), black shadows, a rim of hot light
// round the figure, a light behind it, a diagonal plane of colour, bars down the side, halftone in the
// shadows, grain like a print.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, blurred, boost, canPaint, clamp, css, current, dark, dotScreen, dotsFx, fast, glowBehind, grain, graphicShape, gridPen, hueTurn, inPixels, layDown, mapTones, mapped, mix, objAt, openField, painters, placeShape, posterize, rand, region, shapeIn, slantPath, snap, softCopy, toneTable, tonesFx, upright, values, vignette, wherePainted, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const NEON = { deep: [10, 8, 26], white: [255, 244, 250] };
/** The palette from the channel colour, turned round the wheel by Hue shift: deep, low, mid (the channel's), hot (its complement), pale. */
function neonSet(C) {
  const mid = hueTurn(boost(C, 0.75), values.shift * 360), hot = boost(hueTurn(mid, 135), 0.8);
  return { deep: NEON.deep, low: mix(NEON.deep, mid, 0.42), mid, hot, pale: mix(hot, NEON.white, 0.7) };
}
const neonStops = (N) => [[0, N.deep], [0.3, N.low], [0.56, N.mid], [0.8, N.hot], [1, N.pale]];
const neonGround = (N) => (dark ? mix(N.deep, N.mid, 0.08) : N.hot);
const neonText = (N) => (dark ? N.pale : [26, 22, 54]);   // on the hot ground a night tone just off the house ink, so the small parts' ink can be swapped on its own
export const neon = {
  id: "neon",
  art: "figure",
  repaint: (c) => `a neon noir pop illustration made from the photograph: the subject reduced to three or four flat tones — deep night shadows, ${c}, a hot complementary neon and a pale highlight — hard rim light, black shadows, halftone and print grain; still the same picture, no text.`,
  about: { zh: "霓虹波普：霓虹色的黑色电影式插画——画面按明暗映射成几层平涂的霓虹色（深夜的暗部、频道色、它的互补热色、亮部），深黑阴影，人物（频道图形或照片）带一圈热色轮廓光，身后一团背光，一块斜切的色面，侧边的竖条，阴影里的网点和印刷颗粒；色相可以整体轮转。浓烈、复古未来、有态度——适合音乐、潮流、游戏、夜生活、悬疑和人物内容。可选暗夜底或热色底。", en: "Neon: the neon noir pop illustration — the picture mapped from dark to light onto a few flat neon tones (night-dark shadows, the channel colour, its hot complement, a pale highlight), black shadows, a rim of hot light round the figure (the channel graphic, or the photo), a light behind it, a diagonal plane of colour, bars down the side, halftone in the shadows and print grain; the whole palette can be turned round the colour wheel. Intense, retro-futurist, with attitude — for music, fashion, games, nightlife, mystery and portraits. A night-dark or a hot ground." },
  name: { zh: "霓虹波普", en: "Neon pop" },
  seeded: true,
  scene: { figure: { zh: "人物剪影", en: "Figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "人物剪影", en: "Figure" } },
    { key: "rim", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "轮廓光", en: "Rim light" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "背光", en: "Backlight" } },
    { key: "split", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "斜切色面", en: "Diagonal plane" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "侧边竖条", en: "Side bars" } },
    { key: "shift", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "色相轮转", en: "Hue shift" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "阴影网点", en: "Halftone shadows" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "辉光", en: "Bloom" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "印刷颗粒", en: "Print grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "暗角", en: "Vignette" } },
    { key: "map", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片霓虹化", en: "Photo in neon" } },
    { key: "posterize", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "色阶硬度", en: "Hard tones" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base, C) => { const N = neonSet(C); return { ...base, field: css(neonGround(N)), text: css(neonText(N)), dim: css(neonText(N), 0.6), titleFill: css(neonText(N)), titleInk: css(neonGround(N)), grid: () => css(neonText(N), 0.14) }; },
  /**
   * The ground, the diagonal plane, the backlight, the bars, then the figure: a rim of hot light a little
   * off it, and its body lit from that side down into the night. A photo is mapped onto the palette
   * (Photo in neon), its tones as hard as Hard tones says; then the bloom and the halftone.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, N = neonSet(C), ground = neonGround(N), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    const size = fh * (0.55 + 0.5 * p.figure), at = [F.x0 + fw * 0.64, F.y1 - size * 0.46];
    const [cx, cy] = !env.photo && L.grid && (p.figure > 0 || p.glow > 0) ? objAt("figure", at[0], at[1], ctx) : at;   // the figure and its glow: a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    const after = () => {
      if (p.bloom > 0 && !fast && canPaint(ctx)) { const soft = softCopy(snap(ctx, "neonGlow"), 18, "neonSoft"), cv = ctx.canvas; inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.7 * p.bloom; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); }); }
      if (p.halftone > 0) wherePainted(ctx, (c) => dotScreen(c, w, h, N.deep, 8, 0.45 * p.halftone), L.base === "clear");
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable(neonStops(N), p.posterize), p.map);
      if (L.fill) after();
      return true;
    }
    if (!L.grid) return true;
    if (p.split > 0) {   // a plane of the other tone, cut on a diagonal, sweeping in from the right
      const x0 = F.x1 - fw * (0.15 + 0.6 * p.split);
      ctx.fillStyle = css(dark ? mix(N.low, N.mid, 0.4) : mix(N.hot, N.mid, 0.55)); ctx.beginPath(); ctx.moveTo(x0 + fh * 0.35, F.y0 - 10); ctx.lineTo(w + 10, F.y0 - 10); ctx.lineTo(w + 10, F.y1 + 10); ctx.lineTo(x0 - fh * 0.2, F.y1 + 10); ctx.closePath(); ctx.fill();
    }
    if (p.glow > 0) { const g = ctx.createRadialGradient(cx, cy - size * 0.2, 0, cx, cy - size * 0.2, size * 0.9); g.addColorStop(0, css(dark ? N.hot : N.pale, 0.85 * p.glow)); g.addColorStop(1, css(dark ? N.hot : N.pale, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    for (let k = 0, n = p.bars * 6; k < Math.ceil(n); k++) { ctx.fillStyle = css(dark ? N.hot : N.deep, clamp(n - k)); ctx.fillRect(F.x0 + 20 + k * 34, F.y0 + fh * (0.1 + rand(k * 2.3 + 1400) * 0.2), 10 + (k % 3) * 8, fh); }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      if (p.rim > 0) { const d = size * 0.018 * (0.5 + p.rim); blurred(ctx, size * 0.04 * p.rim, css(N.hot, 0.9 * p.rim), () => placeShape(ctx, S, [0, 0, 0], cx + d, cy - d, size)); ctx.save(); ctx.globalAlpha = Math.min(1, p.rim * 2); placeShape(ctx, S, N.pale, cx + d, cy - d * 0.7, size); ctx.restore(); }
      const x = workLike(ctx, "neon");
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in";
      const g = x.createLinearGradient(cx + size * 0.45, cy - size * 0.5, cx - size * 0.35, cy + size * 0.4);
      g.addColorStop(0, css(N.mid)); g.addColorStop(0.42, css(N.low)); g.addColorStop(1, css(N.deep));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      layDown(ctx, x);
    }
    after();
    return true;
  },
  /** The light through a noir window's blind: its slats laid across the room on the slant, each a pair of lines. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); slantPath(ctx, w, h, -0.32, 64); slantPath(ctx, w, h, -0.32, 64, 22); ctx.restore();
  },
  accent: { fill: (C) => { const N = neonSet(C); return css(dark ? mix(N.deep, N.mid, 0.22) : N.deep); }, tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny, C) { ctx.lineCap = "butt"; ctx.strokeStyle = css(neonSet(C || NEON.white).hot); ctx.lineWidth = 4; run(0, 0); } },
  /** Pale capitals glowing in the hot tone (the shadow slider), or on the hot ground night-dark ones; highlighted words in the hot tone, or a deep tone of the channel's. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, N = neonSet(o.C || NEON.white), hi = o.hi || (dark ? N.hot : mix(N.mid, N.deep, 0.45)), ink = o.fill || neonText(N), glow = Math.min(2, o.shadowAmt);   // on the hot ground, a deep tone of the channel's colour
    if (glow > 0 && !fast) { ctx.save(); ctx.shadowColor = css(dark ? N.hot : N.deep, 0.9); ctx.shadowBlur = fs * 0.2 * glow; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink (on the dark block) turns pale; objects go into the palette
  wrap: (ctx, C, p, plates) => { const N = neonSet(C); return mapped(ctx, plates ? { fill: { ink: N.pale }, stroke: { ink: N.pale } } : { fill: { ink: N.deep, light: N.pale, mid: N.mid, dark: N.low, colour: () => N.hot }, stroke: { ink: N.deep, light: N.pale, colour: () => N.hot }, line: 0.6 }); },
  sticker: painters({ line: NEON.deep, lineScale: 0.5, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw(css(NEON.deep, 0.5)); ctx.restore(); } }),
  /** The corner tag: a slab of the hot tone with deep lettering (reversed on the hot ground). */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const N = neonSet(C), slab = dark ? N.hot : N.deep, f = fs * 0.72;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.2, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(slab); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(dark ? N.deep : N.hot); spaced(ctx, str, x + f * 0.6, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  frame() {},
  image(ctx, C, unit) { ctx.shadowColor = css(neonSet(C).hot, 0.6); ctx.shadowBlur = 24 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit); vignette(ctx, w, h, NEON.deep, 0.85 * p.vignette, 0.4); },
  prompt: `Stickers for a neon noir pop illustration — bold, moody and graphic — that read at a glance:
- one strong silhouette per sticker (a face in profile, sunglasses, a hand with a cigarette, a cat, a microphone, a skull, a rose), with hard light and black shadow shapes; no realism, no fine detail;
- flat colour only: "ink" for deep shadow, the main colour for the mid tone, "white" for highlights, and one hot accent ("red" or "pink");
- the app adds a dark outline and a soft offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a neon noir illustration would show them: a few boxes and cylinders, sleek and dramatic — a jukebox, a neon sign, a phone booth, a speaker; no realism, no fine detail.
- the renderer paints faces in a deep night tone, the channel colour and a hot neon: do NOT try to draw shading or outlines yourself;
- "white" is the pale highlight, "dark" the night, and "main" the channel colour.`,
};
/** The neon pop palette from the channel colour, turned round the wheel only under that look itself (see neonSet). */
const neonOf = (E) => { const mid = hueTurn(boost(E.C, 0.75), (current === neon ? values.shift || 0 : 0) * 360), hot = boost(hueTurn(mid, 135), 0.8); return { deep: NEON.deep, low: mix(NEON.deep, mid, 0.42), mid, hot, pale: mix(hot, NEON.white, 0.7) }; };
neon.elementFx = [
  { key: "map", name: { zh: "霓虹渐变映射", en: "Neon gradient map" }, for: FX_ALL, stage: "filter",
    /** The layer mapped by lightness onto the neon tones: night, the channel colour, its hot complement, a pale highlight. */
    paint: tonesFx((E) => neonStops(neonOf(E))) },
  { key: "posterize", name: { zh: "色阶硬度", en: "Hard tones" }, for: FX_ALL, stage: "filter",
    /** The layer's colours stepping into fewer, flatter tones. */
    paint(x, B, a) { posterize(x, B, a); } },
  { key: "rim", name: { zh: "轮廓光", en: "Rim light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 20 * k }),
    /** A hot rim of light along the layer's upper left edge, as of a lamp behind it. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), N = neonOf(E), d = (2 + 6 * a) * E.k; x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 3); x.drawImage(shapeIn(src, N.pale, "fxRim"), B.x0 - d, B.y0 - d * 0.8); x.restore(); glowBehind(x, B, src, d * 2, 0.6 * a, N.hot, -d, -d * 0.8); } },
  { key: "glow", name: { zh: "背光", en: "Back light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 90 * k, t: 90 * k, r: 90 * k, b: 90 * k }),
    /** A glow of the channel colour behind the layer. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (12 + 36 * a) * E.k, 0.9 * Math.min(1, a * 2.5), neonOf(E).mid); } },
  { key: "halftone", name: { zh: "阴影网点", en: "Halftone shadow" }, for: FX_ALL, stage: "over",
    /** Dots of the night tone over the layer's shaded side. */
    paint: dotsFx({ colour: (E) => neonOf(E).deep, pitch: (E) => 7 * E.k, size: (p, a) => p * (0.1 + 0.26 * a), shade: true }) },
];
