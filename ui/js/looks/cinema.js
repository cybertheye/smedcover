// minimal film poster: a silhouette with a story in it
// The fan-made minimal movie poster: one muted colour from the channel's (ochre, dusk violet, slate,
// teal), a dark silhouette standing in it with a soft light behind, a landscape fading back in layers,
// crumpled or worn paper, a vignette, a thin spaced title and a credits block at the foot. A photo can
// go inside the silhouette, as a double exposure.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, canPaint, crumple, css, dark, flatFx, glowBehind, grain, graphicShape, greeked, grey, gridPath, gridPen, layDown, mapped, mix, noise, objAt, openField, pad2, painters, parseColour, placeShape, rand, region, role, spacedCentre, tonesFx, upright, vignette, wash, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CINE = { night: [12, 12, 15], paper: [226, 214, 190], cream: [236, 228, 210], soot: [18, 15, 14] };
const cineMute = (C) => mix(C, grey(C), 0.45);
const cineGround = (C) => (dark ? mix(cineMute(C), CINE.night, 0.72) : mix(cineMute(C), CINE.paper, 0.3));
const cineShade = (C) => (dark ? [6, 6, 8] : mix(cineGround(C), CINE.soot, 0.86));        // the silhouette
const cineText = () => (dark ? CINE.cream : CINE.soot);
/** Where the silhouette stands: on the open field's floor, a little left of the middle (clear of the channel graphic), cropped by that floor. */
function cinePlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.32 + 0.6 * p.giant);
  return { F, cx: F.x0 + fw * 0.44, cy: F.y1 - size * 0.42, size };
}
/** The ground without the silhouette: the colour, the light behind where the figure stands, the landscape in layers (`only`: "ground", the colour alone, or "scene", the light and the landscape alone). */
function cineGroundPaint(ctx, env, p, at, only = null) {
  const { w, h, C } = env, ground = cineGround(C), u = Math.min(w, h), F = at.F;
  if (only !== "scene") {
    ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h);
    const top = ctx.createLinearGradient(0, 0, 0, h);   // a little deeper at the top, as a dusk sky
    top.addColorStop(0, css(mix(ground, CINE.night, dark ? 0.45 : 0.22))); top.addColorStop(0.6, css(ground, 0));
    ctx.fillStyle = top; ctx.fillRect(0, 0, w, h);
  }
  if (only === "ground") return;
  if (p.glow > 0) {   // a soft light behind the head of the figure: a wide halo and a brighter core
    const gx = at.cx, gy = at.cy - at.size * 0.2, lit = mix(ground, CINE.cream, dark ? 0.68 : 0.75);
    for (const [r, a] of [[at.size * 1.5, 0.55], [at.size * 0.7, 0.9]]) {
      const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      g.addColorStop(0, css(lit, a * p.glow)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    }
  }
  if (p.horizon > 0) {   // three ridges fading back: the furthest nearly the sky, the nearest nearly the figure
    const floor = F.y1;
    for (let k = 0; k < 3; k++) {
      const depth = (3 - k) / 3, base = floor - u * (0.05 + 0.13 * depth) * (0.4 + 0.6 * p.horizon), amp = u * (0.02 + 0.05 * depth) * p.horizon;
      const col = mix(ground, cineShade(C), 0.22 + 0.24 * k);
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 20; x += 20) { const t = x / w; ctx.lineTo(x, base - amp * (Math.sin(t * (3 + k) + rand(k + 240) * 6) * 0.6 + Math.sin(t * (9 + k * 3) + rand(k + 241) * 6) * 0.25 + (noise(k * 50 + Math.floor(x / 40)) - 0.5) * 0.3)); }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = css(col); ctx.fill();
    }
  }
}
export const cinema = {
  id: "cinema",
  art: "giant",
  repaint: (c) => `a minimalist movie poster made from a photograph: muted, moody colour (a dusky version of ${c}), soft light from behind the subject, the subject reading as a dark silhouette, worn paper texture, a gentle vignette, cinematic and quiet; still the same picture, no text.`,
  about: { zh: "极简电影海报：从频道色里取一个沉静的颜色（赭石、暮紫、灰蓝、墨绿），一个深色剪影（频道图形的轮廓）站在画面里，身后一团柔光，远处的山峦一层层淡出去，皱纸纹理、暗角和褪色，细而疏朗的衬线标题，底部一块演职员表；有照片时可以把照片装进剪影，做成双重曝光。安静、有故事感、电影感强——适合影评、书评、人物故事、纪录片与情绪向内容。", en: "The minimal movie poster: a quiet colour drawn from the channel's (ochre, dusk violet, slate, deep green), a dark silhouette (the channel graphic's outline) standing in it with a soft light behind, ridges fading back in layers, crumpled paper, a vignette and fade, a thin spaced serif title and a credits block at the foot; with a photo, the photo can go inside the silhouette as a double exposure. Quiet, story-led, cinematic — for film and book reviews, portraits, documentaries, mood pieces." },
  name: { zh: "极简电影", en: "Minimal film poster" },
  seeded: true,
  scene: { figure: { zh: "剪影", en: "Silhouette" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "剪影", en: "Silhouette" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "背光", en: "Backlight" } },
    { key: "horizon", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "远山层次", en: "Receding ridges" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "皱纸纹理", en: "Crumpled paper" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "褪色", en: "Fade" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "暗角", en: "Vignette" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "演职员表", en: "Credits" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "颗粒", en: "Grain" } },
    { key: "inside", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片装进剪影", en: "Photo inside the silhouette" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片调色", en: "Photo toning" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base, C) => ({ ...base, field: css(cineGround(C)), text: css(cineText()), dim: css(cineText(), 0.6), titleFill: css(cineText()), titleInk: css(cineGround(C)), grid: () => css(cineText(), 0.12) }),
  /**
   * The ground, its light and ridges, and the silhouette. A photo is toned toward the ground's colour;
   * one that fills the canvas can show only inside the silhouette: the ground is painted again over
   * it, with the silhouette cut out of it.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, at0 = cinePlace(env, p), [sx, sy] = objAt("figure", at0.cx, at0.cy, ctx), at = { ...at0, cx: sx, cy: sy };   // the silhouette: a scene object
    if (env.photo) {
      ctx.fillStyle = css(cineGround(C)); ctx.fillRect(0, 0, w, h);
      env.drawPhoto(p.duo * 0.6);
      wash(ctx, w, h, "soft-light", mix(cineMute(C), CINE.cream, 0.2), p.duo * 0.7);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], cineMute(C), 0.5), p.duo * 0.55);
      const S = L.fill && p.inside > 0 && p.giant > 0 && canPaint(ctx) && graphicShape(env);
      if (S) {
        const x = workLike(ctx, "cine");
        cineGroundPaint(x, env, p, at);
        x.globalCompositeOperation = "destination-out"; placeShape(x, S, [0, 0, 0], at.cx, at.cy, at.size);
        layDown(ctx, x, p.inside);
      }
      return true;
    }
    if (L.ground !== false) cineGroundPaint(ctx, env, p, at, "ground");   // the colour and its dusk: the base; the light and the ridges stand on it
    if (!L.grid) return true;
    cineGroundPaint(ctx, env, p, at, "scene");
    const S = p.giant > 0 && graphicShape(env);
    if (S) placeShape(ctx, S, cineShade(C), at.cx, at.cy, at.size);
    return true;
  },
  /** A camera's framing chart: the frame lines of the wider screens inside the picture, the corners of its safe area, a centre cross. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2;
    gridPen(ctx, color);
    for (const [r, dash] of [[2.39, []], [2, [16, 12]]]) {
      const fw = Math.min(w, h * r), fh = fw / r, x = cx - fw / 2, y = cy - fh / 2;
      ctx.setLineDash(dash); gridPath(ctx, fw < w - 1 ? [x, x + fw] : [], fh < h - 1 ? [y, y + fh] : [], 0, 0, w, h);
    }
    ctx.setLineDash([]);
    const sx = w * 0.05, sy = h * 0.05, sw = w * 0.9, sh = h * 0.9, t = 44;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[sx, sy, 1, 1], [sx + sw, sy, -1, 1], [sx, sy + sh, 1, -1], [sx + sw, sy + sh, -1, -1]]) { ctx.moveTo(x + dx * t, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * t); }
    ctx.moveTo(cx - 26, cy); ctx.lineTo(cx + 26, cy); ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy + 26);
    ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: (C) => css(mix(cineGround(C), cineShade(C), dark ? 0.55 : 0.4)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(cineText(), 0.35); ctx.lineWidth = 1.5; run(nx * 10, ny * 10); },   // a hairline, a little off the edge
  },
  /** A serif, upright; a soft shadow under it, or on the light ground a halo of light (the shadow slider); highlighted words in the channel colour, muted. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, hi = o.hi || mix(cineMute(o.C || CINE.cream), dark ? CINE.cream : CINE.soot, dark ? 0.35 : 0.4);
    // on the dark ground a soft shadow under the letters; on the light one a halo of light behind them, so they read over the silhouette
    if (o.shadowAmt > 0) { ctx.save(); ctx.shadowColor = dark ? css(CINE.night, 0.55 * Math.min(1, o.shadowAmt)) : css(CINE.cream, 0.9 * Math.min(1, o.shadowAmt)); ctx.shadowBlur = fs * (dark ? 0.12 : 0.2); ctx.shadowOffsetY = 0; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); }); if (!dark) pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || cineText()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: cineText() }, stroke: { ink: cineText() } }
    : { fill: { ink: cineShade(C), light: mix(cineGround(C), CINE.cream, 0.6), mid: mix(cineGround(C), CINE.cream, 0.25), dark: cineShade(C), colour: (c) => mix(cineMute(c), cineGround(C), 0.25) }, stroke: { ink: cineShade(C), light: CINE.cream }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(CINE.soot, c[3]) : role(c) === "colour" ? css(cineMute(c), c[3]) : fill; } }),
  /** The corner tag: spaced small capitals between two hairlines, the channel colour in a short bar before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = spacedW(ctx, str, 9), w = tw + f * 1.6, by = y + fs * 1.2, col = css(cineText(), 0.85);
    ctx.fillStyle = col; ctx.fillRect(x, by - f * 1.55, w, 1.5); ctx.fillRect(x, by + f * 0.35, w, 1.5);
    ctx.fillStyle = css(mix(C, cineText(), 0.15)); ctx.fillRect(x, by - f * 0.78, f * 0.9, f * 0.3);
    ctx.fillStyle = ink || col; spaced(ctx, str, x + f * 1.6, by - f * 0.12, 9);
    return { x: x - 4, y: by - f * 1.7, w: w + 8, h: f * 2.3 };
  },
  /** The frame layer: names spaced across the top, and the credits block — the channel's name, then greeked billing — at the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, col = css(cineText(), 0.8 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.font = `400 19px ${fonts.serif}`;
    const brand = P.brand.name || "", name = env.cat.name || env.cat.code || "";
    if (brand) spacedCentre(ctx, brand.toUpperCase(), w * 0.3, 70, 5);
    if (name) spacedCentre(ctx, name.toUpperCase(), w * 0.7, 70, 5);
    const bw = Math.min(w * 0.46, 760);
    greeked(ctx, (w - bw) / 2, h - 82, bw, 4, 8, css(cineText(), 0.5 * a), 250 + env.o.catIndex, "center");
    ctx.font = `400 15px ${fonts.serif}`; spacedCentre(ctx, `— ${pad2(env.o.catIndex + 1)} —`, w / 2, h - 30, 4);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(CINE.night, 0.45); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6 * unit; },
  /** Crumpled paper, the fade of an old print, a vignette, grain. */
  post(ctx, w, h, C, p, unit = 1) {
    crumple(ctx, w, h, p.paper * 0.9);
    wash(ctx, w, h, "screen", [40, 34, 30], 0.5 * p.fade);
    wash(ctx, w, h, "multiply", [250, 236, 214], 0.6 * p.fade);
    vignette(ctx, w, h, CINE.night, 0.75 * p.vignette, 0.32);
    grain(ctx, p.grain * 0.7, unit, !dark);
  },
  prompt: `Stickers for a minimalist movie poster — quiet, reduced and a little melancholic — that read at a glance:
- one clear silhouette per sticker (a figure, a profile, a hand, a house, a tree, an object), simple and elegant, with at most one small inner shape that tells a story; no realism, no perspective, no detail;
- flat colour only, muted: the main colour (it comes out dusky), "ink" for the silhouette and "white" for a light; two or three colours in all;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a minimal movie poster would show them: a few boxes and cylinders, plainly proportioned and a little lonely; no realism, no fine detail.
- the renderer paints faces in muted tones of the poster's colour with a near-black: do NOT try to draw shading or outlines yourself;
- "white" is the light, "dark" is near-black, and "main" a muted version of the channel colour.`,
};
cinema.elementFx = [
  { key: "silhouette", name: { zh: "剪影", en: "Silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a dark silhouette against the light, a little lighter toward its foot. */
    paint: flatFx((x, B) => { const g = x.createLinearGradient(0, B.y0, 0, B.y1); g.addColorStop(0, css(dark ? [30, 27, 26] : CINE.soot)); g.addColorStop(1, css(dark ? [72, 58, 48] : [54, 46, 40])); return g; }) },
  { key: "glow", name: { zh: "背光", en: "Back light" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 70 * k, t: 90 * k, r: 70 * k, b: 60 * k }),
    /** Light from behind the layer spilling round it, warm on the dark ground. */
    paint(x, B, a, E) { const R = (10 + 30 * a) * E.k; glowBehind(x, B, region(x, B, "fxA"), R, 0.9 * Math.min(1, a * 2.5), dark ? [255, 214, 160] : [255, 240, 210], 0, -R * 0.3); } },
  { key: "grade", name: { zh: "照片调色", en: "Photo toning" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a film still: cool shadows, warm, muted lights. */
    paint: tonesFx(() => [[0, [18, 22, 28]], [0.4, [72, 74, 72]], [0.75, [196, 170, 132]], [1, [244, 232, 210]]]) },
];
