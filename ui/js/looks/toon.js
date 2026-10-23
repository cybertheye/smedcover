// animated film poster: the fan-made alternative poster
// The posters people draw for the animated films they love: one strong flat colour; the hero's
// silhouette made huge and filled with a sunset, a sun disc in it with a small figure standing there
// (a silhouette inside the silhouette); a sunburst behind; a beam from a lamp; a procession of the
// same figure, smaller and smaller; a winding road with a tiny traveller; stars; the speckle of a
// screen print and a white printer's margin. Warm, playful, a whole story in one picture.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, boost, canPaint, clamp, css, dark, fall, flatFx, grain, graphicShape, greeked, gridPen, inkAs, knockWorn, lum, mapped, mix, objAt, openField, painters, placeShape, rand, rounded, spacedCentre, starMark, tonesFx, upright, wash, wear } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const TOON = { ink: [24, 20, 44], night: [12, 12, 30], cream: [252, 243, 224], sun: [255, 214, 92], amber: [250, 146, 56], coral: [228, 68, 62] };
const toonGround = (C) => (dark ? mix([14, 20, 56], boost(C, 0.5), 0.07) : boost(C, 0.55));   // deep: a night sky with a touch of the channel's hue
/** Lettering on the ground: ink on a light ground, cream on a deep one. */
const toonText = (C) => (lum(toonGround(C)) > 0.55 ? TOON.ink : TOON.cream);
/** The floor the figure stands on (the colour block): the ground, deeper. */
const toonFloor = (C) => mix(toonGround(C), dark ? [0, 0, 0] : TOON.ink, dark ? 0.45 : 0.32);
/** A silhouette's flat colour: a deep tone of the ground, so it reads dark against the sun. */
const toonFigure = (C) => mix(toonGround(C), dark ? [2, 2, 8] : TOON.ink, dark ? 0.6 : 0.72);
/** Small light things on the ground (stars, the road): cream, or on a pale ground a deep tone that shows. */
const toonLight = (C) => (lum(toonGround(C)) > 0.62 ? mix(toonGround(C), TOON.ink, 0.55) : TOON.cream);
/**
 * The picture's centre: a big sun hanging in the open sky at the field's far side, above where the
 * channel graphic stands (and the title's end), so both read; the giant silhouette stands on the floor
 * in front of its lower half.
 */
function toonPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, R = Math.min(fh * (0.16 + 0.26 * p.sun), fw * 0.22), size = fh * (0.4 + 0.55 * p.giant);
  const cx = F.x1 - Math.max(R * 1.15, fw * 0.17), cy = F.y0 + fh * 0.42;
  return { F, cx, cy, R, gx: cx - R * 0.15, gy: F.y1 - size * 0.48, size };
}
/** The sun: a disc rising from the floor, a halo round it, cream going to amber and coral down it (Sunset), cut by bands of the ground in its lower half (Stripes). */
function toonSun(ctx, env, at, p) {
  if (p.sun <= 0) return;
  const { C } = env, { cx, cy, R } = at, ground = toonGround(C), a = Math.min(1, p.sun * 4);
  const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.9);
  halo.addColorStop(0, css(TOON.sun, (dark ? 0.45 : 0.3) * a)); halo.addColorStop(1, css(TOON.sun, 0));
  ctx.fillStyle = halo; ctx.fillRect(cx - R * 2, cy - R * 2, R * 4, R * 4);
  const g = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  g.addColorStop(0, css(mix(TOON.cream, TOON.sun, 0.4 * p.sunset), a)); g.addColorStop(0.45, css(mix(TOON.cream, TOON.amber, p.sunset), a)); g.addColorStop(0.85, css(mix(TOON.cream, TOON.coral, p.sunset), a));
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fillStyle = g; ctx.fill(); ctx.clip();
  if (p.stripes > 0) { ctx.fillStyle = css(ground); for (let i = 0; i < 6; i++) { const t = (i + 1) / 6, y = cy - R * 0.05 + R * 0.85 * t, th = R * 0.075 * t * p.stripes * 1.6; ctx.fillRect(cx - R, y - th / 2, R * 2, th); } }
  ctx.restore();
}
/** A sunburst behind the figure: wedges of a lighter tone fanning out from it, fading with distance. */
function toonBurst(ctx, env, at, amt) {
  if (amt <= 0) return;
  const { w, h, C } = env, ox = at.cx, oy = at.cy, R = Math.hypot(w, h), n = 28, turn = rand(802) * TAU;
  const lit = mix(toonGround(C), dark ? TOON.cream : [255, 255, 255], 0.55), g = ctx.createRadialGradient(ox, oy, 0, ox, oy, R * 0.7);
  g.addColorStop(0, css(lit, 0.42 * amt)); g.addColorStop(0.5, css(lit, 0.2 * amt)); g.addColorStop(1, css(lit, 0.05 * amt));
  ctx.fillStyle = g; ctx.beginPath();
  for (let i = 0; i < n; i += 2) { const a0 = turn + (i / n) * TAU, a1 = turn + ((i + 1) / n) * TAU; ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a0) * R, oy + Math.sin(a0) * R); ctx.lineTo(ox + Math.cos(a1) * R, oy + Math.sin(a1) * R); ctx.closePath(); }
  ctx.fill();
}
/** Stars over the upper field, more and more of them, one by one: dots of different sizes and a few four-pointed sparkles. */
function toonStars(ctx, env, amt) {
  if (amt <= 0) return;
  const F = openField(env), n = amt * 48, col = toonLight(env.C);
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k), x = F.x0 + rand(k * 2.7 + 810) * (F.x1 - F.x0), y = F.y0 + rand(k * 3.1 + 811) ** 1.5 * (F.y1 - F.y0) * 0.78, big = rand(k * 4.3 + 812);
    if (big > 0.86) { ctx.save(); ctx.globalAlpha = a; starMark(ctx, x, y, 7 + (big - 0.86) * 90, 4, col); ctx.restore(); }
    else { ctx.fillStyle = css(col, (0.4 + 0.55 * big) * a); ctx.beginPath(); ctx.arc(x, y, 1.1 + big * 2.4, 0, TAU); ctx.fill(); }
  }
}
/** A street lamp hanging in from above, its beam falling on the figure: a long wedge of light, brighter near the lamp. */
function toonBeam(ctx, env, at, amt) {
  if (amt <= 0) return;
  const { C } = env, F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, side = rand(820) > 0.5 ? -1 : 1;
  const [lx, ly] = objAt("lamp", at.cx + side * Math.min(fw * 0.26, at.R * 1.4), F.y0 + fh * 0.1, ctx), spread = fh * (0.16 + 0.12 * amt);   // the lamp: a scene object
  const lit = dark ? TOON.cream : mix(toonGround(C), [255, 255, 255], 0.7), g = ctx.createLinearGradient(lx, ly, at.cx, F.y1);
  g.addColorStop(0, css(lit, 0.85 * amt)); g.addColorStop(1, css(lit, 0.32 * amt));
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx - 9, ly + 6); ctx.lineTo(lx + 9, ly + 6); ctx.lineTo(at.cx + spread, F.y1); ctx.lineTo(at.cx - spread, F.y1); ctx.closePath(); ctx.fill();
  const iron = css(dark ? [34, 32, 56] : mix(toonGround(C), TOON.ink, 0.9), Math.min(1, amt * 3));   // the lamp: an arm from above, a shade, the bulb
  ctx.strokeStyle = iron; ctx.lineWidth = 6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(lx - side * 70, F.y0 - 20); ctx.quadraticCurveTo(lx - side * 70, ly - 30, lx, ly - 22); ctx.stroke();
  ctx.fillStyle = iron; ctx.beginPath(); ctx.moveTo(lx - 22, ly + 4); ctx.lineTo(lx - 10, ly - 22); ctx.lineTo(lx + 10, ly - 22); ctx.lineTo(lx + 22, ly + 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(TOON.cream, Math.min(1, amt * 3)); ctx.beginPath(); ctx.arc(lx, ly + 5, 7, 0, TAU); ctx.fill();
}
/** A road winding down the field, drawn further the higher `amt` goes, a tiny traveller (the graphic) at its end. */
function toonRoad(ctx, env, at, amt, S) {
  if (amt <= 0) return;
  const F = at.F, fw = F.x1 - F.x0, fh = F.y1 - F.y0, x0 = F.x0 + fw * 0.47, ph = rand(830) * TAU, col = toonLight(env.C), u = Math.min(env.w, env.h);
  const at_ = (t) => [x0 + Math.sin(t * 19 + ph) * fw * (0.012 + 0.075 * t), F.y0 + fh * (0.06 + 0.94 * t)];
  ctx.strokeStyle = css(col); ctx.lineWidth = 7; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
  let end = at_(0);
  for (let t = 0; t <= amt + 1e-9; t += 0.004) { end = at_(Math.min(t, amt)); t ? ctx.lineTo(...end) : ctx.moveTo(...end); }
  ctx.stroke();
  if (S) placeShape(ctx, S, col, end[0], end[1] - u * 0.026, u * 0.05);
}
/** The figure again, standing on the floor in a procession toward the giant one, each further one smaller; they come in one by one. */
function toonParade(ctx, env, at, amt, S) {
  if (amt <= 0 || !S) return;
  const n = amt * 7, col = dark ? mix(toonGround(env.C), TOON.cream, 0.4) : toonFigure(env.C);   // on the night ground a lit tone, or they would vanish
  let x = at.cx - at.R * 0.9, s = (at.F.y1 - at.F.y0) * 0.24;
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k);
    x -= s * 0.62; if (x < at.F.x0 + s * 0.3) break;
    ctx.save(); ctx.globalAlpha = a; placeShape(ctx, S, col, x, at.F.y1 - s * 0.5, s); ctx.restore();
    x -= s * 0.32; s *= 0.8;
  }
}
export const toon = {
  id: "toon",
  art: "giant",
  repaint: (c) => `a fan-made alternative poster for an animated film, made from the photograph: one strong flat colour (${c}), the subject reduced to bold flat shapes and a clean silhouette, a warm sunset glow, simple graphic light, a little screen-print speckle; playful and warm; still the same picture, no text.`,
  about: { zh: "动画电影的另类海报：一整块浓烈的颜色（从频道色来），天边一轮带复古条纹的大夕阳，频道图形站在它下方，还可以在太阳前立起一个巨大的同形剪影；放射光芒、路灯投下的光柱、一列越来越小的同一个身影、一条蜿蜒的小路和路上的小旅人、星空；丝网印刷的斑驳和海报的白边。温暖、童趣、一张图讲一个故事——适合动画、亲子、旅行、成长、治愈和节日内容。可选亮色底或深色底；自带平直的版式。", en: "The alternative poster for an animated film: one strong colour (from the channel's), a big striped setting sun hanging over where the channel graphic stands, and if you like its huge silhouette in front of the sun; a sunburst, a lamp's beam, a procession of the same figure growing smaller, a winding road with a tiny traveller, stars; the speckle of a screen print and a white margin. Warm, playful, a story in one picture — for animation, family, travel, growing up, feel-good and festive content. A bright or a deep ground; flat layouts of its own." },
  name: { zh: "动画海报", en: "Animated film poster" },
  seeded: true,
  scene: { sun: { zh: "夕阳与光芒", en: "Sun and sunburst" }, giant: { zh: "巨型剪影", en: "Giant silhouette" }, lamp: { zh: "路灯光柱", en: "Street-lamp beam" } },
  params: [
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "夕阳", en: "Setting sun" } },
    { key: "sunset", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "夕阳渐变", en: "Sunset colours" } },
    { key: "stripes", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "日落条纹", en: "Sun stripes" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "放射光芒", en: "Sunburst" } },
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "巨型剪影", en: "Giant silhouette" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "路灯光柱", en: "Lamp beam" } },
    { key: "parade", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "列队身影", en: "Procession" } },
    { key: "road", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "蜿蜒小路", en: "Winding road" } },
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "星星", en: "Stars" } },
    { key: "distress", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "丝网斑驳", en: "Screen-print wear" } },
    { key: "border", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "海报白边", en: "White margin" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "演职员小字", en: "Credits" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片单色", en: "Photo in one colour" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base, C) => ({ ...base, field: css(toonGround(C)), text: css(toonText(C)), dim: css(toonText(C), 0.6), titleFill: css(toonText(C)), titleInk: css(toonGround(C)), grid: () => css(toonText(C), 0.12) }),
  /**
   * The ground; a sunburst and stars; the setting sun behind where the channel graphic stands; the
   * giant silhouette against it; a lamp's beam, a winding road, a procession. A photo goes into the
   * ground's colour; one filling the canvas still gets the stars, the sun and the beam.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = toonGround(C), at = toonPlace(env, p);
    if (p.sun > 0 || p.burst > 0) [at.cx, at.cy] = objAt("sun", at.cx, at.cy, ctx);   // the sun and the rays from it: a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      wash(ctx, w, h, "multiply", mix([255, 255, 255], ground, 0.9), p.duo);
      wash(ctx, w, h, "screen", mix([0, 0, 0], ground, 0.3), p.duo);
      if (L.fill) { toonStars(ctx, env, p.stars); toonSun(ctx, env, at, p); toonBeam(ctx, env, at, p.beam); }
      return true;
    }
    if (!L.grid) return true;
    const S = canPaint(ctx) && graphicShape(env);
    toonBurst(ctx, env, at, p.burst);
    toonStars(ctx, env, p.stars);
    toonSun(ctx, env, at, p);
    if (S && p.giant > 0) { const [gx, gy] = objAt("giant", at.gx, at.gy, ctx); placeShape(ctx, S, toonFigure(C), gx, gy, at.size); }   // the hero, huge and dark against the sun: a scene object
    toonBeam(ctx, env, at, p.beam);
    toonRoad(ctx, env, at, p.road, S);
    toonParade(ctx, env, at, p.parade, S);
    return true;
  },
  /** A sunburst's construction: rings round a point under the foot of the picture, and rays from it every 10°. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h * 1.08, R = Math.hypot(w, h), r0 = 140;
    gridPen(ctx, color); ctx.beginPath();
    for (let r = r0; r < R; r += 110) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    for (let a = 0; a < 360; a += 10) { const t = (a * Math.PI) / 180; ctx.moveTo(cx + Math.cos(t) * r0, cy + Math.sin(t) * r0); ctx.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(toonFloor(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },
  /** Bold condensed capitals, flat, with a shadow a little off in a deeper tone of the ground, as a print's second colour; highlighted words in sun yellow or coral. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || TOON.coral, ground = toonGround(C), hi = o.hi || (lum(ground) > 0.55 ? TOON.coral : TOON.sun), d = fs * 0.045 * Math.min(2, o.shadowAmt), [dx, dy] = fall(d, d);
    if (d > 0) pass((a, x) => { ctx.fillStyle = css(mix(ground, TOON.ink, 0.55)); ctx.fillText(a.t, x + dx, dy); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : o.fill || toonText(C)); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: toonText(C) }, stroke: { ink: toonText(C) } }
    : { fill: { ink: TOON.ink, light: TOON.cream, mid: mix(toonGround(C), TOON.cream, 0.5), dark: mix(toonGround(C), TOON.ink, 0.7), colour: (c) => boost(c, 0.4) }, stroke: { ink: TOON.ink, light: TOON.cream }, line: 0.6 }),
  sticker: painters({ line: null, tone: inkAs(TOON.ink, (c) => boost(c, 0.4)), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 8); draw(css(TOON.ink, 0.35)); ctx.restore(); } }),
  /** The corner tag: a rounded ticket — ink with cream letters on a pale ground, sun yellow with ink letters on a deep one. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.66, pale = lum(toonGround(C)) > 0.55;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fillStyle = css(pale ? TOON.ink : TOON.sun); ctx.fill();
    ctx.fillStyle = ink || css(pale ? TOON.cream : TOON.ink); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: "presents" over the top in small capitals, and the billing block at the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h, C } = env, P = env.o.profile, col = css(toonText(C), 0.85 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.font = `700 16px ${fonts.en}, ${fonts.cn}`;
    if (P.brand.name) spacedCentre(ctx, `${P.brand.name.toUpperCase()} PRESENTS`, w / 2, 44, 4);
    const bw = Math.min(w * 0.42, 700);
    greeked(ctx, (w - bw) / 2, h - 70, bw, 3, 8, css(toonText(C), 0.55 * a), 840 + env.o.catIndex, "center");
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(TOON.ink, 0.4); ctx.shadowBlur = 0; ctx.shadowOffsetX = 7 * unit; ctx.shadowOffsetY = 9 * unit; },
  /** The speckle and blotches of a screen print, paper grain, and the white margin the printer leaves. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, mix(toonGround(C), TOON.cream, 0.55), p.distress * 0.85);
    grain(ctx, 0.25 + p.distress * 0.35, unit, !dark && lum(toonGround(C)) > 0.5);
    const b = 54 * p.border;
    if (b >= 1) { ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.rect(b, b, w - 2 * b, h - 2 * b); ctx.fillStyle = css([250, 247, 240]); ctx.fill("evenodd"); }
  },
  prompt: `Stickers for a fan-made poster of an animated film — bold, warm and playful — that read at a glance:
- one clear, characterful silhouette per sticker (a hero, an animal, a lamp, a balloon, a house, a little vehicle), simple and charming; no realism, no perspective, no fine detail;
- flat colour only: the main colour, "ink" for silhouettes and dark parts, "white" for a light; at most one small warm accent ("yellow" or "red");
- the app adds a soft offset shadow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Props from an animated film, built as simple models from a few boxes and cylinders with friendly, slightly exaggerated proportions — a lamp post, a little house, a toy car, a suitcase; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep ink, and "main" the channel colour made more vivid — use it for one to three parts.`,
};
toon.elementFx = [
  { key: "silhouette", name: { zh: "剪影", en: "Silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a silhouette in the poster's night ink. */
    paint: flatFx(() => css(TOON.ink)) },
  { key: "burst", name: { zh: "放射光芒", en: "Sunburst" }, for: FX_ALL, stage: "behind", reach: (B) => { const r = Math.hypot(B.w, B.h) * 0.6; return { l: r, t: r, r, b: r }; },
    /** Rays of sunset colour fanning out behind the layer from its middle and fading at their tips, reaching further as it rises. */
    paint(x, B, a, E) {
      const cx = B.x0 + B.w / 2, cy = B.y0 + B.h / 2, d = Math.hypot(B.w, B.h) / 2, R = d * (1.05 + 0.55 * a), n = 18, t0 = E.R(101) * TAU, g = x.createRadialGradient(cx, cy, d * 0.5, cx, cy, R);
      g.addColorStop(0, css(TOON.sun, 1)); g.addColorStop(0.55, css(TOON.sun, 0.75)); g.addColorStop(1, css(TOON.sun, 0));
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2.5) * 0.75; x.fillStyle = g; x.beginPath();
      for (let i = 0; i < n; i++) { const t = t0 + (i / n) * TAU; x.moveTo(cx, cy); x.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R); x.lineTo(cx + Math.cos(t + TAU / n / 2) * R, cy + Math.sin(t + TAU / n / 2) * R); x.closePath(); }
      x.fill(); x.restore();
    } },
  { key: "distress", name: { zh: "丝网斑驳", en: "Screen-print wear" }, for: FX_ALL, stage: "over",
    /** Big worn blotches where the screen print has rubbed through. */
    paint(x, B, a, E) { knockWorn(x, B, a * 1.05, E, 2.2); } },
  { key: "duo", name: { zh: "照片单色", en: "Photo in one colour" }, for: FX_PHOTO, stage: "filter",
    /** The photo in the poster's night ink, a sunset colour and cream. */
    paint: tonesFx((E) => [[0, TOON.ink], [0.6, mix(TOON.amber, boost(E.C, 0.4), 0.3)], [1, TOON.cream]], 0.2) },
];
