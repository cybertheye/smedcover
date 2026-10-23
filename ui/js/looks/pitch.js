// pitch: the football poster
// World Cup and club posters, from Munich '72 to today: a mown pitch in stripes, its white lines seen
// from above at an angle, the net bulging, the bowl of a stadium full of people, floodlights, the
// classic black-and-white ball with halftone shading, a crowd in silhouette; posterized colour on
// photographs. Green with white lines, or canary yellow with green ones.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, besideLogo, canPaint, clamp, crumple, css, dark, dotScreen, dotsFx, grain, gridPath, gridPen, mapTones, mapped, mix, near, objAt, openField, pad2, painters, rand, rounded, titleArea, toneTable, tonesFx, upright, wherePainted } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const PT = { green: [0, 124, 62], deep: [20, 100, 52], yellow: [252, 214, 0], white: [244, 246, 236], ink: [10, 34, 20], lime: [150, 206, 64] };
const ptGround = () => (dark ? PT.deep : PT.yellow), ptLine = () => (dark ? PT.white : PT.green);
const ptHi = (C) => (near(C, ptGround(), 120) || (!dark && near(C, PT.green, 90)) ? (dark ? PT.yellow : [0, 52, 150]) : C);   // where the channel colour would not show: yellow on the grass, a deep blue on the yellow
/** The markings of a pitch (105 × 68), seen from above, huge, turned and cropped: lines come in, then (past half the slider) the extras — dashes and arcs. */
function pitchLines(ctx, env, amt) {
  const F = openField(env), u = Math.min(env.w, env.h), s = u * 0.026, a = Math.min(1, amt * 2), more = clamp(amt * 2 - 1);
  ctx.save(); ctx.translate(F.x0 + (F.x1 - F.x0) * 0.6, (F.y0 + F.y1) * 0.55); ctx.rotate(-0.42 + rand(1200) * 0.2); ctx.scale(s, s * 0.7);
  ctx.strokeStyle = css(ptLine(), 0.9 * a); ctx.fillStyle = css(ptLine(), 0.9 * a); ctx.lineWidth = 0.42;
  ctx.strokeRect(-52.5, -34, 105, 68);
  ctx.beginPath(); ctx.moveTo(0, -34); ctx.lineTo(0, 34); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 9.15, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, TAU); ctx.fill();
  for (const s2 of [-1, 1]) {
    ctx.strokeRect(s2 > 0 ? 36 : -52.5, -20.15, 16.5, 40.3); ctx.strokeRect(s2 > 0 ? 47 : -52.5, -9.15, 5.5, 18.3);
    ctx.beginPath(); ctx.arc(s2 * 41.5, 0, 0.45, 0, TAU); ctx.fill();
    if (more > 0) { ctx.save(); ctx.globalAlpha = more; ctx.beginPath(); ctx.arc(s2 * 41.5, 0, 9.15, s2 > 0 ? Math.PI - 0.93 : -0.93, s2 > 0 ? Math.PI + 0.93 : 0.93); ctx.stroke(); ctx.restore(); }
  }
  if (more > 0) { ctx.save(); ctx.globalAlpha = more; ctx.setLineDash([2.4, 1.8]); ctx.beginPath(); ctx.moveTo(-60, 40); ctx.lineTo(60, -40); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-60, -45); ctx.lineTo(-10, 45); ctx.stroke(); ctx.restore(); }
  ctx.restore();
}
/** The net, bulging away from where the ball struck it: a mesh of lines over the field, pushed out round that point. */
function goalNet(ctx, env, amt, bx, by) {
  const F = openField(env), u = Math.min(env.w, env.h), cell = u * 0.075, R2 = (u * 0.4) ** 2, push = u * 0.12 * amt;
  const at = (x, y) => { const dx = x - bx, dy = y - by, f = push * Math.exp(-(dx * dx + dy * dy) / R2), d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * f, y + (dy / d) * f * 0.6 + f * 0.3]; };
  ctx.save(); ctx.strokeStyle = css(ptLine(), 0.55 * Math.min(1, amt * 2)); ctx.lineWidth = Math.max(1.5, u * 0.0025);
  for (let x = F.x0; x <= F.x1 + cell; x += cell) { ctx.beginPath(); for (let y = F.y0 - cell; y <= F.y1 + cell; y += cell / 4) { const [px, py] = at(x, y); y === F.y0 - cell ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
  for (let y = F.y0; y <= F.y1 + cell; y += cell) { ctx.beginPath(); for (let x = F.x0 - cell; x <= F.x1 + cell; x += cell / 4) { const [px, py] = at(x, y); x === F.x0 - cell ? ctx.moveTo(px, py) : ctx.lineTo(px, py); } ctx.stroke(); }
  ctx.restore();
}
/** The bowl of a stadium seen from above at a slant: stands ribbed with stairways and stippled with people, round a dark oval of pitch; it widens with `amt`. */
function stadiumBowl(ctx, env, amt) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cx = F.x0 + fw * 0.6, cy = F.y0 + fh * 0.78, R = fw * (0.2 + 0.26 * amt), r = R * 0.62, k = 0.36, a = Math.min(1, amt * 3);
  // in tones a step off the ground, so the lettering over it still reads
  const stand = dark ? mix(PT.deep, PT.lime, 0.28) : mix(PT.yellow, PT.white, 0.45), pitch = dark ? mix(PT.deep, [0, 0, 0], 0.3) : mix(PT.yellow, PT.green, 0.22);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(stand); ctx.beginPath(); ctx.ellipse(cx, cy, R, R * k, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = css(mix(stand, PT.ink, 0.35)); ctx.lineWidth = 2;
  for (let i = 0; i < 72; i++) { const t = (i / 72) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r * k); ctx.lineTo(cx + Math.cos(t) * R, cy + Math.sin(t) * R * k); ctx.stroke(); }
  ctx.fillStyle = css(mix(stand, PT.ink, 0.55), 0.8);   // the people: specks in the stands, thicker toward the front
  for (let i = 0; i < 900; i++) { const t = rand(i * 1.3 + 1210) * TAU, q = Math.sqrt(rand(i * 2.1 + 1211)), rr = r + (R - r) * q; ctx.fillRect(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * k, 2.2, 2.2); }
  ctx.fillStyle = css(pitch); ctx.beginPath(); ctx.ellipse(cx, cy, r, r * k, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.ellipse(cx, cy, r, r * k, 0, 0, TAU); ctx.clip();   // the shadow of the stand falling across the pitch
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * k * 0.2, r * 0.95, r * k * 0.95, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.restore();
}
/** The classic ball: a black pentagon at its heart and five round it, seams, shading to one side in halftone, a shadow on the grass. */
function football(ctx, x, y, r, rot, half) {
  ctx.save(); ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(x + r * 0.2, y + r * 1.02, r * 0.9, r * 0.16, 0, 0, TAU); ctx.fill(); ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(PT.white); ctx.fill(); ctx.clip();
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = css(PT.ink); ctx.strokeStyle = css(PT.ink); ctx.lineWidth = r * 0.03;
  const pent = (R, a) => { ctx.beginPath(); for (let i = 0; i < 5; i++) { const t = a + (i * TAU) / 5; ctx.lineTo(Math.cos(t) * R, Math.sin(t) * R); } ctx.closePath(); ctx.fill(); };
  pent(r * 0.3, -Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const t = -Math.PI / 2 + (i * TAU) / 5, t2 = t + TAU / 10;
    ctx.beginPath(); ctx.moveTo(Math.cos(t) * r * 0.3, Math.sin(t) * r * 0.3); ctx.lineTo(Math.cos(t) * r * 0.62, Math.sin(t) * r * 0.62); ctx.stroke();
    ctx.save(); ctx.translate(Math.cos(t2) * r * 0.86, Math.sin(t2) * r * 0.86); ctx.rotate(t2); ctx.scale(0.5, 1); pent(r * 0.32, Math.PI); ctx.restore();
  }
  ctx.restore();
  const g = ctx.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.2, x, y, r * 1.05);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${0.18 + 0.2 * half})`); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (half > 0) { ctx.beginPath(); ctx.arc(x + r * 0.55, y + r * 0.55, r * 1.05, 0, TAU); ctx.clip(); dotScreen(ctx, x + r * 2, y + r * 2, PT.ink, 7, 0.55 * half); }
  ctx.restore();
  ctx.strokeStyle = css(PT.ink, 0.8); ctx.lineWidth = Math.max(1.5, r * 0.02); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}
export const pitch = {
  id: "pitch",
  repaint: (c) => `a retro football poster made from the photograph, in the manner of the 1972 Munich Olympics posters: the picture posterized into a few flat tones of green, yellow, violet and blue, a little screen-print texture; still the same picture, no text.`,
  about: { zh: "绿茵球场：从 1972 年慕尼黑奥运会到今天的世界杯和俱乐部海报——修剪成条纹的草坪，俯视转了个角度的白色球场线，被射门撞得鼓起的球网，坐满人的看台，球场灯光，黑白经典足球带网点阴影，前景的人群剪影；照片可以做成七十年代的分色效果。绿底白线，或浅色时的金丝雀黄底配绿线。热血、有节奏、一眼是足球——适合体育、赛事、球评、健身、团队和校园活动。", en: "Pitch: football posters from Munich '72 to today's World Cup and club posters — a pitch mown in stripes, its white lines seen from above at an angle, the net bulging where a shot struck it, the bowl of a full stadium, floodlights, the classic black-and-white ball shaded in halftone, a crowd in silhouette in front; photos can be posterized the seventies way. Green with white lines, or canary yellow with green ones. Rousing, rhythmic, plainly football — for sport, matches, commentary, fitness, teams and school events." },
  name: { zh: "绿茵球场", en: "Pitch" },
  seeded: true,
  scene: { ball: { zh: "足球", en: "Ball" } },
  params: [
    { key: "mow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "草坪条纹", en: "Mown stripes" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "球场线", en: "Pitch lines" } },
    { key: "net", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "球网", en: "Goal net" } },
    { key: "stadium", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "看台", en: "Stadium bowl" } },
    { key: "lights", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "球场灯光", en: "Floodlights" } },
    { key: "ball", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "足球", en: "Ball" } },
    { key: "crowd", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "人群剪影", en: "Crowd" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "网点", en: "Halftone" } },
    { key: "info", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "赛事信息", en: "Match details" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "皱纸", en: "Crumpled paper" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "颗粒", en: "Grain" } },
    { key: "poster", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "照片分色", en: "Photo posterized" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.2, side: 0.3, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(ptGround()), text: css(ptLine()), dim: css(ptLine(), 0.6), titleFill: css(ptLine()), titleInk: css(ptGround()), grid: () => css(ptLine(), 0.2) }),
  /**
   * The grass in mown stripes, the stadium, the pitch's lines, the net, the floodlights, the ball and
   * the crowd, in that order. A photo is posterized into the seventies' few flat tones; one filling the
   * canvas still gets the stripes, the lines and the lights over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    if (L.ground !== false) { ctx.fillStyle = css(ptGround()); ctx.fillRect(0, 0, w, h); }
    const mow = () => {
      if (p.mow <= 0) return;
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.5); ctx.fillStyle = css(dark ? [0, 0, 0] : [190, 120, 0], 0.16 * p.mow);
      for (let x = -2 * w; x < 2 * w; x += u * 0.18) ctx.fillRect(x, -2 * h, u * 0.09, 4 * h);
      ctx.restore();
    };
    const lights = () => {
      if (p.lights <= 0) return;
      ctx.save(); ctx.globalCompositeOperation = "screen";
      for (const s of [0, 1]) {
        const lx = s ? F.x1 - fw * 0.06 : F.x0 + fw * 0.06, ly = F.y0 - fh * 0.06, tx = F.x0 + fw * (s ? 0.35 : 0.75), g = ctx.createLinearGradient(lx, ly, tx, F.y1);
        g.addColorStop(0, css([255, 255, 240], 0.55 * p.lights)); g.addColorStop(1, css([255, 255, 240], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(tx - fw * 0.18, F.y1); ctx.lineTo(tx + fw * 0.18, F.y1); ctx.closePath(); ctx.fill();   // from lamps just above the top edge
      }
      ctx.restore();
    };
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, [12, 44, 30]], [0.3, [70, 64, 150]], [0.55, [30, 140, 70]], [0.8, [236, 212, 40]], [1, [246, 244, 222]]], 0.85), p.poster);
      if (L.fill) { mow(); pitchLines(ctx, env, p.lines); lights(); }
      return true;
    }
    if (!L.grid) return true;
    mow();
    if (p.stadium > 0) stadiumBowl(ctx, env, p.stadium);
    if (p.lines > 0) pitchLines(ctx, env, p.lines);
    // the ball (and where it struck the net): just past the title's end, if there is room there
    const T = canPaint(ctx) ? titleArea(ctx, env) : null, br = u * (0.05 + 0.13 * p.ball), bx0 = clamp(T ? T.x + T.w + br * 1.15 : F.x0 + fw * 0.66, F.x0 + br, F.x1 - br * 1.2), by0 = F.y0 + fh * 0.36;
    const [bx, by] = p.ball > 0 || p.net > 0 ? objAt("ball", bx0, by0, ctx) : [bx0, by0];   // a scene object, and the net where it struck with it
    if (p.net > 0) goalNet(ctx, env, p.net, bx, by);
    lights();
    if (p.halftone > 0) wherePainted(ctx, (c) => dotScreen(c, w, h, dark ? [0, 0, 0] : [150, 110, 0], 10, 0.22 * p.halftone), L.base === "clear");
    if (p.ball > 0) football(ctx, bx, by, br, rand(1201) * TAU, p.halftone);
    for (let k = 0, n = p.crowd * 22; k < Math.ceil(n); k++) {   // the crowd: heads and shoulders along the floor, some arms up
      const a = clamp(n - k), x = F.x0 + fw * (0.3 + (0.7 * (k + 0.5)) / 22) + (rand(k * 2.3 + 1220) - 0.5) * fw * 0.02, s = u * (0.05 + rand(k * 3.7 + 1221) * 0.035), y = F.y1 - s * (0.6 + rand(k * 1.9 + 1222) * 0.5);   // clear of the tag in the corner
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = css(dark ? [6, 30, 16] : PT.ink);
      ctx.beginPath(); ctx.arc(x, y - s * 0.55, s * 0.32, 0, TAU); ctx.fill();
      ctx.beginPath(); rounded(ctx, x - s * 0.6, y - s * 0.22, s * 1.2, s * 1.4, s * 0.4); ctx.fill();
      if (rand(k * 5.1 + 1223) > 0.55) { ctx.lineWidth = s * 0.22; ctx.lineCap = "round"; ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(x + s * 0.4, y - s * 0.1); ctx.lineTo(x + s * 0.75, y - s * 1.1); ctx.stroke(); }
      ctx.restore();
    }
    return true;
  },
  /** A coach's tactics board: the pitch cut into zones down and channels across in dashed lines, the halfway line and the centre circle. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color);
    ctx.setLineDash([18, 12]); gridPath(ctx, [w / 6, w / 3, (w * 2) / 3, (w * 5) / 6], [h / 5, (h * 2) / 5, (h * 3) / 5, (h * 4) / 5], 0, 0, w, h);
    ctx.setLineDash([]); ctx.lineWidth = 3; gridPath(ctx, [w / 2], [], 0, 0, 0, h);
    ctx.beginPath(); ctx.arc(w / 2, h / 2, h * 0.17, 0, TAU); ctx.moveTo(w / 2 + 6, h / 2); ctx.arc(w / 2, h / 2, 6, 0, TAU); ctx.stroke();
    ctx.restore();
  },
  accent: { fill: () => css(dark ? mix(PT.deep, PT.ink, 0.45) : PT.green), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(PT.white); ctx.lineWidth = 6; run(0, 0); } },   // the touchline
  /** Bold condensed capitals, flat; highlighted words in the channel colour (or yellow, or green, where that would not show). */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || ptHi(o.C || PT.yellow) : o.fill || ptLine()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: PT.ink, light: PT.white }, stroke: { ink: PT.ink, light: PT.white }, line: 0.7 })),
  sticker: painters({ line: PT.ink, lineScale: 0.6, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw("rgba(0,0,0,0.25)"); ctx.restore(); } }),
  /** The corner tag: a scoreboard — a black slab with the lettering in lit yellow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.7;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.2, h = f * 1.6, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, f * 0.25); ctx.fillStyle = css(PT.ink); ctx.fill();
    ctx.fillStyle = ink || css(PT.yellow); spaced(ctx, str, x + f * 0.6, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the match's details in the top corner, and a key along the foot, as on a match-day poster. */
  frame(ctx, env, p) {
    const a = p.info;
    if (a <= 0) return;
    const { w } = env, P = env.o.profile, i = env.o.catIndex, total = P.categories.length, F = openField(env), col = ptLine();
    ctx.save(); ctx.fillStyle = css(col, 0.9 * a); ctx.textBaseline = "alphabetic"; ctx.textAlign = "right";
    ctx.font = `700 20px ${fonts.en}, ${fonts.cn}`; ctx.fillText(`MATCHDAY ${pad2(i + 1)}`, besideLogo(env, w - 72), 70);
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.fillText(`${(P.brand.name || "").toUpperCase()} · ${pad2(i + 1)}/${pad2(total)} · 90'`, besideLogo(env, w - 72), 92);
    if (a > 0.4) {
      ctx.globalAlpha = Math.min(1, (a - 0.4) * 3); ctx.textAlign = "left"; ctx.font = `600 12px ${fonts.mono}, ${fonts.cn}`; const y = F.y1 - 26;
      ctx.fillRect(72, y - 18, 180, 1.5); ctx.fillText("KEY", 72, y - 24);
      ctx.beginPath(); ctx.arc(78, y, 4, 0, TAU); ctx.fill(); ctx.fillText("PLAYERS", 90, y + 4);
      ctx.fillRect(170, y - 1, 16, 2); ctx.fillText("PASS", 192, y + 4);
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 12 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 6 * unit; },
  post(ctx, w, h, C, p, unit = 1) { crumple(ctx, w, h, p.paper * 0.9); grain(ctx, p.grain * 0.7, unit, !dark); },
  prompt: `Stickers for a retro football poster — bold, sporty and simple — that read at a glance:
- one clear object per sticker (a ball, a boot, a whistle, a trophy, a goal, a scarf, a player in silhouette, a flag), graphic and a little stylised; no realism, no perspective, no fine detail;
- flat colour only: the main colour with "white", "ink" (deep green-black) and "yellow" as partners;
- the app adds a dark outline and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects from football, built as simple models from a few boxes and cylinders — a goal, a trophy, a stand, a scoreboard, a corner flag; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" deep green-black, and "main" the channel colour — use it for one to three parts.`,
};
pitch.elementFx = [
  { key: "halftone", name: { zh: "网点", en: "Halftone" }, for: FX_ALL, stage: "over",
    /** Dots of the pitch's deep green over the layer. */
    paint: dotsFx({ colour: () => PT.deep, pitch: (E) => 8 * E.k, size: (p, a) => p * (0.08 + 0.3 * a) }) },
  { key: "poster", name: { zh: "照片分色", en: "Photo posterized" }, for: FX_PHOTO, stage: "filter",
    /** The photo in four flat colours of the match poster: ink, green, yellow, white. */
    paint: tonesFx(() => [[0, PT.ink], [0.4, PT.green], [0.75, PT.yellow], [1, PT.white]], 0.75) },
];
