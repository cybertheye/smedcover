// velvet: the flocked 3D illustration
// Soft, flocked 3D illustration in a few strong colours: periwinkle sky, acid-green hills and velvet,
// red and pink; figures and objects with plush volume, lit from the upper left, fuzzy at the edge,
// sometimes checked; soft cast shadows; heavy grain like a velvety print; stars on a night gradient.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, avGlow, bevel, bevelFx, blurred, boost, canPaint, clamp, css, dark, fast, glowBehind, grain, graphicShape, gridPen, inkAs, layDown, mapTones, mapped, mix, near, objAt, onLayer, openField, painters, placeShape, rand, region, rounded, slantPath, sparkle, toneTable, tonesFx, upright, vignette, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const VL = { peri: [98, 112, 218], night: [12, 16, 52], green: [118, 186, 40], moss: [36, 92, 28], red: [226, 30, 40], pink: [246, 156, 196], cream: [244, 240, 252], ink: [16, 16, 24] };
const vlGround = () => (dark ? VL.night : VL.peri);
/** The object's colour: the channel's, made vivid; acid green where it would sink into the periwinkle. */
const vlBody = (C) => { const c = boost(C, 0.6); return near(c, VL.peri, 120) || near(c, VL.night, 90) ? VL.green : c; };
/** Where the figure stands: on the hills, toward the field's far side. */
function vlPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.55 + 0.55 * p.figure);
  return { F, cx: F.x0 + fw * 0.74, cy: F.y1 - size * 0.52, size };   // big, behind the title's end and above the graphic, so it shows round them
}
export const velvet = {
  id: "velvet",
  art: "figure",
  repaint: (c) => `a soft flocked 3D illustration made from the photograph: plush velvety surfaces, rounded volumes lit from the upper left, a periwinkle-blue sky and acid-green hills, ${c} as the object colour, red and pink accents, soft cast shadows, heavy fine grain; whimsical, fashion-editorial; no text.`,
  about: { zh: "绒感插画：像植绒一样毛茸茸的立体插画——长春花蓝的天空、荧光绿的绒面山丘，频道图形变成一个有体积、左上受光、边缘发毛的绒面物件（颜色来自频道色，可铺上模糊的格纹），脚下一团柔和的投影；可加暮色渐变、星星、柔光，整张覆着厚厚的细颗粒。俏皮、时髦、有手感——适合时尚、生活方式、潮玩、节日和女性向内容。可选长春花蓝底或夜空底；自带平直的版式，色块是一片绿色绒面草地。", en: "Velvet: soft flocked 3D illustration — a periwinkle sky, acid-green velvet hills, the channel graphic as a plush object with volume, lit from the upper left and fuzzy at the edge (in the channel colour, a blurred check on it if you like), a soft shadow under it; a dusk gradient, stars and a glow if you like, and heavy fine grain over everything. Playful, fashionable, tactile — for fashion, lifestyle, designer toys, festive and feminine content. A periwinkle or a night ground; flat layouts of its own, the colour block a green velvet lawn." },
  name: { zh: "绒感插画", en: "Velvet illustration" },
  seeded: true,
  scene: { figure: { zh: "绒面物件", en: "Plush figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "绒面物件", en: "Plush figure" } },
    { key: "volume", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "立体感", en: "Volume" } },
    { key: "fuzz", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "绒毛边", en: "Fuzzy edge" } },
    { key: "check", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "格纹", en: "Check" } },
    { key: "hills", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "绒面山丘", en: "Velvet hills" } },
    { key: "shadow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "投影", en: "Shadow" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "暮色渐变", en: "Dusk gradient" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "星星", en: "Stars" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "柔光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "绒面颗粒", en: "Velvet grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "暗角", en: "Vignette" } },
    { key: "tone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片绒色", en: "Photo in velvet colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.17, side: 0.3, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(vlGround()), text: css(VL.cream), dim: css(VL.cream, 0.65), titleFill: css(VL.cream), titleInk: css(vlGround()), grid: () => css(VL.cream, 0.2) }),
  /**
   * The sky (deeper toward the top at dusk), stars, velvet hills rising from the floor, then the plush
   * figure: its fuzzy halo, its soft cast shadow, and the body on a work canvas — the colour, a blurred
   * check, the light from the upper left (bevel) and a soft highlight. A photo is mapped by lightness onto
   * the velvet palette.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), ground = vlGround(), body = vlBody(C);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false && p.dusk > 0) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, css(dark ? [4, 6, 22] : VL.night, 0.85 * p.dusk)); g.addColorStop(0.65, css(dark ? VL.night : VL.peri, 0)); g.addColorStop(1, css(dark ? VL.peri : [170, 180, 250], 0.5 * p.dusk)); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, VL.night], [0.32, VL.peri], [0.6, VL.green], [0.82, VL.pink], [1, VL.cream]], 0.3), p.tone);
      return true;
    }
    if (!L.grid) return true;
    const at = vlPlace(env, p), F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    for (let k = 0, n = p.stars * 16; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); sparkle(ctx, F.x0 + rand(k * 2.7 + 1600) * fw, F.y0 + rand(k * 3.9 + 1601) * fh * 0.55, 4 + rand(k * 5.1 + 1602) * 10, VL.cream, 1); ctx.restore(); }
    if (p.hills > 0) {   // two or three soft hills, the far ones bluer, each lit along its crest and fuzzy at the edge
      for (let k = 0; k < 3; k++) {
        const r = clamp(p.hills * 3 - k * 0.8);
        if (r <= 0) continue;
        const depth = (2 - k) / 2, top = F.y1 - fh * (0.12 + 0.3 * p.hills) * (0.55 + 0.45 * depth) * r, x0 = F.x0 - fw * 0.1 + rand(k + 1610) * fw * 0.5, x1 = x0 + fw * (0.7 + rand(k + 1611) * 0.6);
        const col = mix(VL.green, ground, 0.45 * depth), path = () => { ctx.beginPath(); ctx.moveTo(x0, F.y1 + 10); ctx.bezierCurveTo(x0 + (x1 - x0) * 0.2, top, x0 + (x1 - x0) * 0.7, top, x1, F.y1 + 10); ctx.closePath(); };
        blurred(ctx, u * 0.008, css(col, 0.9), () => { path(); ctx.fill(); });
        const g = ctx.createLinearGradient(0, top, 0, F.y1); g.addColorStop(0, css(mix(col, VL.cream, 0.18))); g.addColorStop(0.5, css(col)); g.addColorStop(1, css(mix(col, VL.moss, 0.6)));
        path(); ctx.fillStyle = g; ctx.fill();
      }
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      const { size } = at, [cx, cy] = objAt("figure", at.cx, at.cy, ctx);   // a scene object
      if (p.shadow > 0) blurred(ctx, size * 0.05, css(mix(VL.night, ground, 0.3), 0.55 * p.shadow), () => { ctx.beginPath(); ctx.ellipse(cx + size * 0.18 * p.shadow, cy + size * 0.48, size * (0.32 + 0.25 * p.shadow), size * 0.07, 0, 0, TAU); ctx.fill(); });
      if (p.fuzz > 0) blurred(ctx, size * 0.025 * (0.4 + p.fuzz), css(body, 0.85 * p.fuzz), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size * 1.01));
      const x = workLike(ctx, "velvet");
      placeShape(x, S, body, cx, cy, size);
      if (p.check > 0) {   // a soft check in a deeper tone of the body, kept to the figure
        x.save(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = Math.min(1, 0.95 * p.check); x.fillStyle = css(mix(body, VL.ink, 0.62));
        const c = size * 0.11; x.translate(cx, cy); x.rotate(0.2);
        for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) if ((i + j) % 2 === 0) x.fillRect(i * c, j * c, c, c);
        x.restore();
      }
      bevel(x, S, cx, cy, size, size * 0.012, mix(body, VL.cream, 0.7), mix(body, VL.night, 0.7), p.volume);
      if (p.volume > 0) { x.save(); x.globalCompositeOperation = "source-atop"; const hl = x.createRadialGradient(cx - size * 0.15, cy - size * 0.22, 0, cx - size * 0.15, cy - size * 0.22, size * 0.45); hl.addColorStop(0, css(VL.cream, 0.4 * p.volume)); hl.addColorStop(1, css(VL.cream, 0)); x.fillStyle = hl; x.fillRect(0, 0, w, h); x.restore(); }
      layDown(ctx, x);
    }
    avGlow(ctx, p.bloom * 0.6);
    return true;
  },
  /** Quilted velvet: stitched lines on the slant both ways, a tuft where they cross. */
  gridLines(ctx, env, color) {
    const { w, h } = env, g = 110, a = Math.PI / 4, n = [-Math.sin(a), Math.cos(a)], m = [Math.sin(a), Math.cos(a)], k = Math.ceil(Math.hypot(w, h) / g);
    gridPen(ctx, color);
    ctx.setLineDash([12, 9]); slantPath(ctx, w, h, a, g); slantPath(ctx, w, h, -a, g); ctx.setLineDash([]);
    ctx.beginPath();
    for (let i = -k; i <= k; i++) for (let j = -k; j <= k; j++) { const x = w / 2 + (i * n[0] + j * m[0]) * g, y = h / 2 + (i * n[1] + j * m[1]) * g; if (x > -9 && x < w + 9 && y > -9 && y < h + 9) { ctx.moveTo(x + 5, y); ctx.arc(x, y, 5, 0, TAU); } }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css(VL.green), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a green velvet lawn
  /** Cream letters standing up off the page on a soft shadow (the shadow slider); highlighted words in the object colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt), k = o.unit || 1, hi = o.hi || vlBody(o.C || VL.red), ink = o.fill || VL.cream;
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = css(VL.night, 0.55); ctx.shadowBlur = fs * 0.1 * s * k; ctx.shadowOffsetX = fs * 0.025 * s * k; ctx.shadowOffsetY = fs * 0.06 * s * k; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: VL.ink, light: VL.cream, mid: mix(VL.peri, VL.cream, 0.5), dark: VL.moss, colour: (c) => boost(c, 0.5) }, stroke: { ink: VL.ink, light: VL.cream }, line: 0.6 })),
  sticker: painters({ line: null, tone: inkAs(VL.ink, (c) => boost(c, 0.5)), shadow(ctx, draw) { ctx.save(); ctx.translate(5, 9); draw(css(VL.night, 0.35)); ctx.restore(); } }),
  /** The corner tag: a plush red pill with cream letters. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.shadowColor = css(VL.night, 0.45); ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(VL.red); ctx.fill(); ctx.restore();
    ctx.fillStyle = ink || css(VL.cream); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  frame() {},
  image(ctx, C, unit) { ctx.shadowColor = css(VL.night, 0.4); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 4 * unit; ctx.shadowOffsetY = 10 * unit; },
  /** Grain like velvet pile, twice over, and a soft vignette. */
  post(ctx, w, h, C, p, unit = 1) {
    grain(ctx, p.grain * 0.75, unit);
    if (p.grain > 0.5) grain(ctx, (p.grain - 0.5) * 0.8, unit * 0.6);
    vignette(ctx, w, h, VL.night, 0.7 * p.vignette, 0.4);
  },
  prompt: `Stickers for a soft flocked 3D illustration — plush, playful and fashionable — that read at a glance:
- one rounded, characterful object per sticker (a handbag, a shoe, a gift box, a flower, sunglasses, a heart, a little creature), chunky and soft; no realism, no fine detail;
- flat colour only in strong, sweet colours: the main colour, acid green ("yellow" comes out green), red, pink ("white" is cream); "ink" for small dark details;
- the app adds a soft shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Plush objects, built as simple soft models from a few boxes and cylinders — a handbag, a gift box, a shoe, a stool, a lamp; rounded and chunky, no realism, no fine detail.
- the renderer paints faces in soft velvety tones: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep moss green, and "main" the channel colour made vivid — use it for one to three parts.`,
};
velvet.elementFx = [
  { key: "plush", name: { zh: "绒面", en: "Velvet" }, for: FX_ALL, stage: "fill",
    /** The layer in plush: a soft sheen toward the light, its edges falling into shade, a fine pile. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      onLayer(x, B, src, "source-atop", a, (g) => {
        const hl = g.createRadialGradient(B.w * 0.35, B.h * 0.3, 0, B.w * 0.35, B.h * 0.3, Math.max(B.w, B.h) * 0.7); hl.addColorStop(0, "rgba(255,255,255,0.4)"); hl.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = hl; g.fillRect(0, 0, B.w, B.h);
        const sd = g.createLinearGradient(0, 0, B.w, B.h); sd.addColorStop(0.5, "rgba(10,10,30,0)"); sd.addColorStop(1, "rgba(10,10,30,0.35)"); g.fillStyle = sd; g.fillRect(0, 0, B.w, B.h);
        for (let k = 0, n = Math.round(B.w * B.h / (60 * E.k * E.k)); k < n; k++) { g.fillStyle = E.R(k * 0.7 + 151) > 0.5 ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"; g.fillRect(B.w * E.R(k * 1.3 + 152), B.h * E.R(k * 1.9 + 153), E.k, E.k); }
      });
    } },
  { key: "check", name: { zh: "格纹", en: "Check" }, for: FX_ALL, stage: "over",
    /** A soft check in a deeper tone of the layer, as on plush fabric. */
    paint(x, B, a, E) { const c = Math.max(B.w, B.h) * 0.09; onLayer(x, B, region(x, B, "fxA"), "multiply", Math.min(1, a * 0.95), (g) => { g.translate(B.w / 2, B.h / 2); g.rotate(0.2); g.fillStyle = "rgba(40,40,70,0.55)"; for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) if ((i + j) % 2 === 0) g.fillRect(i * c, j * c, c, c); }); } },
  { key: "volume", name: { zh: "立体感", en: "Volume" }, for: FX_ALL, stage: "over",
    /** Volume from a light at the upper left: the layer's rim lit there and shaded across from it. */
    paint: bevelFx(0.22, 0.3, 0.012) },
  { key: "fuzz", name: { zh: "绒毛边", en: "Fuzzy edge" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 30 * k, t: 30 * k, r: 30 * k, b: 30 * k }),
    /** A soft halo of the layer's own colour round it, as the pile of velvet catches the light. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (3 + 16 * a) * E.k, 0.9 * Math.min(1, a * 2.5), null); } },
  { key: "shadow", name: { zh: "柔和投影", en: "Soft shadow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 10 * k, r: 50 * k, b: 70 * k }),
    /** A soft shadow of the layer cast down and to the right. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (6 + 16 * a) * E.k, 0.65 * Math.min(1, a * 1.5), VL.night, (2 + 8 * a) * E.k, (5 + 16 * a) * E.k); } },
  { key: "tone", name: { zh: "照片绒色", en: "Photo in velvet colours" }, for: FX_PHOTO, stage: "filter",
    /** The photo mapped onto the velvet palette: night, periwinkle, acid green, pink, cream. */
    paint: tonesFx(() => [[0, VL.night], [0.32, VL.peri], [0.6, VL.green], [0.82, VL.pink], [1, VL.cream]], 0.3) },
];
