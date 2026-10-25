// 90s cel animation, photographed on film
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { ANI, FX_ALL, FX_PHOTO, TAU, WORK, clamp, css, eachPixel, fall, fast, filmDust, godRays, grain, grey, gridPen, inkAs, lensFlare, mapped, mix, objAt, pad2, painters, rand, region, ringsBehind, round16, shift, vignette, wash } from "./kit.js";
import { fonts } from "../cel.js";

const muted = (c) => mix(mix(c, grey(c), 0.2), ANI.cream, 0.08);   // paint, not light: a little greyer and warmer
export const anime = {
  id: "anime",
  repaint: (c) => `a background painting from a hand-painted 1990s anime film: painted sky and clouds, gouache-like scenery, cel-flat colours slightly greyed and warm, soft bloom on the lights, light film grain, with ${c} as an accent.`,
  about: { zh: "九十年代手绘动画、再用胶片拍下来的样子：手绘天空背景（云量可调，可以转成晚霞，有穿过云层的天使光），赛璐珞颜色略灰略暖，标题是双层勾边的字，叠上手绘式的镜头光斑、漏光、胶片颗粒、柔光、褪色、灰尘划痕和暗角。比默认的赛璐珞更旧、更柔、更怀旧——适合旅行、音乐、回忆、季节与日常。", en: "A hand-painted 90s cartoon as film would have caught it: a painted sky (as cloudy as you like, or at dusk, with beams of light through it), cel colours a little grey and warm, a title with a double keyline, then a hand-drawn lens flare, a light leak, film grain, bloom, fade, dust and scratches and a vignette. Older, softer and more wistful than the default Cel — for travel, music, memories, seasons, everyday life." },
  name: { zh: "九十年代动画", en: "90s animation" },
  oneTheme: true,
  seeded: true,
  scene: { clouds: { zh: "云", en: "Clouds" }, rays: { zh: "天使光", en: "Light rays" }, leak: { zh: "漏光", en: "Light leak" }, flare: { zh: "镜头光斑", en: "Lens flare" } },
  params: [
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "云量", en: "Clouds" } },
    { key: "dusk", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "晚霞", en: "Dusk" } },
    { key: "rays", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "天使光", en: "Light rays" } },
    { key: "flare", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "镜头光斑", en: "Lens flare" } },
    { key: "leak", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "漏光", en: "Light leak" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "柔光", en: "Bloom" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "褪色", en: "Fade" } },
    { key: "dust", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "灰尘划痕", en: "Dust and scratches" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "vignette", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "暗角", en: "Vignette" } },
  ],
  theme: (base) => ({ ...base, field: css([40, 44, 86]), text: css(ANI.cream), dim: css(ANI.cream, 0.6), titleFill: css(ANI.cream), titleInk: css(ANI.line), grid: () => css(ANI.cream, 0.16) }),
  /**
   * A painted sky — deep above, hazy toward the horizon; with Dusk, violet above and rose and amber
   * below — with soft banks of cloud (more of them, one by one, as Clouds rises; lit from below at
   * dusk) and beams of light slanting down through it. A photo filling the canvas gets the beams too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, d = p.dusk;
    if (env.photo) { env.drawPhoto(); wash(ctx, w, h, "multiply", [255, 238, 216], 0.5); if (L.fill) godRays(ctx, w, h, p.rays, d, "rays"); return true; }
    if (L.ground !== false) {
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, css(mix(mix([34, 46, 108], [58, 40, 104], d), C, 0.06))); sky.addColorStop(0.55, css(mix(mix([92, 132, 184], [206, 122, 146], d), C, 0.08))); sky.addColorStop(1, css(mix(mix([244, 208, 172], [255, 172, 96], d), C, 0.14)));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    const lit = mix(ANI.cream, [255, 196, 170], d), n = p.clouds * 13;
    ctx.save(); shift("clouds", w * 0.5, h * 0.43, ctx);   // a scene object: the clouds move as one
    for (let k = 0; k < Math.ceil(n); k++) {
      const a = clamp(n - k), cx = rand(k * 3 + 1) * w, cy = h * (0.18 + rand(k * 3 + 2) * 0.5), rx = w * (0.1 + rand(k * 3 + 3) * 0.16), ry = rx * 0.3;
      ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, rx * 0.25 * d, 0, 0, 0, rx);
      g.addColorStop(0, css(lit, 0.55 * a)); g.addColorStop(0.6, css(lit, 0.22 * a)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
    godRays(ctx, w, h, p.rays, d, "rays");
    return true;
  },
  /** An animator's field guide: twelve fields one inside another about the centre, its axes, its diagonals and a ring at its heart. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h / 2;
    gridPen(ctx, color); ctx.beginPath();
    for (let f = 1; f <= 12; f++) { const hw = (w / 2) * (f / 12.4), hh = (h / 2) * (f / 12.4); ctx.rect(cx - hw, cy - hh, hw * 2, hh * 2); }
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.moveTo(0, 0); ctx.lineTo(w, h); ctx.moveTo(w, 0); ctx.lineTo(0, h);
    ctx.moveTo(cx + 14, cy); ctx.arc(cx, cy, 14, 0, TAU);
    ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: (C) => css(muted(C)), tone: (C) => css(mix(muted(C), ANI.line, 0.34)), toneScale: 0.85,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(ANI.line); ctx.lineWidth = 11; run(0, 0); ctx.strokeStyle = css(ANI.cream, 0.9); ctx.lineWidth = 3; run(nx * 15, ny * 15); },
  },
  /** A title-card logotype: pale letters, a dark keyline, a white one outside it, and a soft drop shadow. */
  runs(ctx, pass, o) {
    const fs = o.fs, C = o.hi || o.C || ANI.cream, k = Math.max(0.4, o.strokeAmt), d = fs * 0.055 * o.shadowAmt, [dx, dy] = fall(d, d);
    ctx.lineJoin = "round";
    if (d > 0) pass((a, x) => { ctx.strokeStyle = css(ANI.line, 0.5); ctx.lineWidth = fs * 0.2 * k; ctx.strokeText(a.t, x + dx, dy); });
    pass((a, x) => { ctx.strokeStyle = css(ANI.cream); ctx.lineWidth = fs * 0.2 * k; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.strokeStyle = css(ANI.line); ctx.lineWidth = fs * 0.105 * k; ctx.strokeText(a.t, x, 0); });
    pass((a, x) => { ctx.fillStyle = a.hi ? css(mix(muted(C), ANI.cream, 0.15)) : css(o.fill || ANI.cream); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx) => mapped(ctx, { fill: { ink: ANI.line, light: ANI.cream, mid: ANI.pale, dark: ANI.shade, colour: muted }, stroke: { ink: ANI.line, colour: muted }, line: 0.85 }),
  sticker: painters({ line: ANI.line, lineScale: 0.85, tone: inkAs(ANI.line, muted), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 6); draw(css(ANI.line, 0.5)); ctx.restore(); } }),
  /** The frame layer: the rounded corners of a film gate, and a line of production credit. */
  frame(ctx, env) {
    const { w, h } = env, r = 46;
    ctx.fillStyle = "#000000";
    for (const [x, y, sx, sy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sx * r, y); ctx.arcTo(x, y, x, y + sy * r, r); ctx.lineTo(x, y); ctx.fill(); }
    const P = env.o.profile;
    ctx.font = `600 16px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(ANI.cream, 0.7);
    ctx.fillText(`© ${P.brand.name || "STUDIO"} · ${pad2(env.o.catIndex + 1)}`, w - 64, h - 44);
  },
  post(ctx, w, h, C, p, unit = 1) {
    const cv = ctx.canvas;
    if (p.bloom > 0 && !fast && cv && typeof document !== "undefined") {   // light spreading in the emulsion: a small, soft copy laid back on in screen
      const s = WORK.bloom || (WORK.bloom = document.createElement("canvas")), sw = Math.max(8, Math.round(cv.width / 14)), sh = Math.max(8, Math.round(cv.height / 14));
      if (s.width !== sw || s.height !== sh) { s.width = sw; s.height = sh; }
      const x = s.getContext("2d"); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high"; x.globalCompositeOperation = "copy"; x.drawImage(cv, 0, 0, sw, sh);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.5 * p.bloom; ctx.drawImage(s, 0, 0, cv.width, cv.height); ctx.restore();
    }
    wash(ctx, w, h, "screen", [44, 30, 56], 0.55 * p.fade);          // blacks lifted, as on an old print
    wash(ctx, w, h, "multiply", [255, 238, 214], 0.75 * p.fade);     // and the whole thing gone warm
    if (p.leak > 0) {   // light that got into the camera: a red-orange glow from one side, burning to yellow at its heart
      const left = rand(640) > 0.5, [x, y] = objAt("leak", left ? w * 0.02 : w * 0.98, h * (0.25 + rand(641) * 0.5), ctx), R = Math.max(w, h) * (0.3 + 0.35 * p.leak);
      const g = ctx.createRadialGradient(x, y, 0, x, y, R);
      g.addColorStop(0, css([255, 236, 170], 0.95 * p.leak)); g.addColorStop(0.22, css([255, 132, 52], 0.78 * p.leak)); g.addColorStop(0.6, css([214, 44, 56], 0.34 * p.leak)); g.addColorStop(1, css([200, 40, 60], 0));
      const e = ctx.createLinearGradient(left ? 0 : w, 0, left ? w * 0.4 : w * 0.6, 0);   // and burnt in along that edge
      e.addColorStop(0, css([255, 96, 40], 0.75 * p.leak)); e.addColorStop(0.45, css([230, 60, 50], 0.25 * p.leak)); e.addColorStop(1, css([230, 60, 50], 0));
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = e; ctx.fillRect(0, 0, w, h); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore();
    }
    if (p.flare > 0) lensFlare(ctx, w, h, p.flare, "flare");
    if (p.dust > 0) filmDust(ctx, w, h, p.dust);
    grain(ctx, p.grain * 0.7, unit);
    vignette(ctx, w, h, [20, 12, 30], 0.84 * p.vignette, 0.45);
  },
  prompt: `Hand-painted animation cels of the 1990s — a prop or character drawn for television — that read at a glance:
- clean, confident shapes with a strong silhouette and slightly soft, rounded corners; appealing, simple proportions; no realism, no fine detail;
- flat cel paint only; colours are a little muted and warm, never neon; white is cream;
- every shape automatically gets a dark outline and a soft shadow: do NOT draw outlines or shadows yourself;
- give forms one flat shadow shape where it helps (a darker patch of the same colour, with "shadow": false) and one small pale highlight — the two-tone shading of a cel.`,
  solidPrompt: `Props from a 1990s animated series, built as simple models from a few boxes and cylinders with clear, appealing proportions; no realism, no fine detail.
- the renderer paints the faces in flat cel tones with a dark outline: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep violet-grey, and "main" the channel colour, slightly muted — use it for one to three parts.`,
};
anime.elementFx = [
  { key: "warm", name: { zh: "照片暖调", en: "Photo warmed" }, for: FX_PHOTO, stage: "filter",
    /** The photo as an old print of a painted cel: warmer, its blacks lifted. */
    paint(x, B, a) { eachPixel(x, B, a, (r, g, b, y, o) => { o[0] = Math.min(255, r * 0.96 + 18); o[1] = g * 0.9 + 14; o[2] = b * 0.76 + 16; }); } },
];
anime.elementFx.push({ key: "keyline", name: { zh: "双色描边", en: "Two-tone outline" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 16 * k, t: 16 * k, r: 24 * k, b: 24 * k }),
  /** Two outlines round the layer, as on a cel title: a dark ink line at its edge and a broad cream one outside that, with a soft shadow to the lower right. */
  paint(x, B, a, E) {
    const src = region(x, B, "fxKey"), k = E.k, line = 4 * k * a, wide = line + 9 * k * a, d = 7 * k * a;
    if (line < 0.3) return;
    ringsBehind(x, B, src, [[ANI.line, line * 0.5], [ANI.line, line], ...[1, 2, 3].map((i) => [ANI.cream, line + ((wide - line) * i) / 3])], [[ANI.line, round16(wide, d, d), 0.5 * Math.min(1, a * 3)]]);   // and the shadow under them
  } });
