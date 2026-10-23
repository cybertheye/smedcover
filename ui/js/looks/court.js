// court: the basketball poster
// Basketball posters and team prints: a varsity number in the team colour, halftone and outlined; the
// ball with its seams; a half court in isometric plan with its stand and net; a hoop in dotted line;
// spray paint dripping; the figure leaving speed trails; the print distressed, the wall behind it worn.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, blurred, boost, canPaint, clamp, crumple, css, dark, dotScreen, dotsFx, dripsBehind, every, fall, grain, graphicShape, gridPath, gridPen, knockWorn, layDown, lum, mapTones, mapped, mix, near, noise, objAt, openField, pad2, painters, placeShape, rand, region, ringsBehind, rounded, shapeIn, starMark, titleArea, toneTable, tonesFx, trail, upright, wear, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

/** Where the channel graphic stands on the cover, as placeShape takes it: its silhouette's middle and solid height (a move of the layer itself not counted). */
function artPlace(env, S) {
  const A = env.G && env.G.art, b = S.box;
  return A ? { cx: A.x + ((b.x0 + b.x1) / 2) * A.s, cy: A.y + ((b.y0 + b.y1) / 2) * A.s, size: (b.y1 - b.y0) * A.s } : null;
}
const BB = { orange: [236, 106, 34], seam: [40, 22, 14], royal: [38, 82, 178], navy: [14, 26, 64], paper: [236, 234, 228], ink: [24, 24, 28], white: [248, 246, 240], wood: [222, 170, 104] };
const bbGround = () => (dark ? BB.navy : BB.paper), bbInk = () => (dark ? BB.white : BB.ink);
/** The team colour: the channel's, made vivid; royal blue (gold on the navy ground) where it would be lost against the ball or the ground. */
const bbTeam = (C) => { const c = boost(C, 0.5); return near(c, BB.orange, 120) || near(c, bbGround(), 120) ? (dark ? [250, 196, 40] : BB.royal) : c; };
/** A basketball: the leather lit from the upper left, halftone in its shade, its eight seams, a shadow under it. */
function basketball(ctx, x, y, r, rot, half) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(x + r * 0.15, y + r * 1.04, r * 0.8, r * 0.13, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = css(BB.orange); ctx.fill();
  ctx.save(); ctx.clip();
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r * 1.05);
  g.addColorStop(0, "rgba(255,226,186,0.4)"); g.addColorStop(0.6, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(70,24,0,0.4)");
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  if (half > 0) { ctx.beginPath(); ctx.arc(x + r * 0.55, y + r * 0.55, r, 0, TAU); ctx.clip(); dotScreen(ctx, x + r * 2, y + r * 2, BB.seam, Math.max(5, Math.round(r * 0.08)), 0.45 * half); }
  ctx.restore();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.translate(x, y); ctx.rotate(rot); ctx.strokeStyle = css(BB.seam); ctx.lineWidth = Math.max(2, r * 0.045); ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * r * 1.32, 0, r * 0.96, 0, TAU); ctx.stroke(); }   // the two curved seams
  ctx.restore();
  ctx.strokeStyle = css(BB.seam); ctx.lineWidth = Math.max(2, r * 0.045); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.restore();
}
/**
 * A half court in isometric plan, its baseline at the back, running toward the viewer and cropped by
 * the floor: the lines come in over the first half of `amt`, the key and the circles fill in over the
 * second, and the stand with its backboard, rim and net rises with it.
 */
function courtPlan(ctx, env, amt, team) {
  const F = openField(env), fh = F.y1 - F.y0, s = fh * 0.05, [ox, oy] = objAt("court", F.x1 - s * 7, F.y1 - s * 8.6, ctx), la = Math.min(1, amt * 2), fa = clamp(amt * 2 - 1);   // a scene object
  const P = (X, Y, Z = 0) => [ox + (X - Y) * 0.866 * s, oy + (X + Y) * 0.5 * s - Z * s];
  const path = (pts, close) => { ctx.beginPath(); pts.forEach(([X, Y, Z], i) => { const [x, y] = P(X, Y, Z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); if (close) ctx.closePath(); };
  const arc = (cx, cy, r, a0, a1, z = 0) => { const out = []; for (let i = 0; i <= 40; i++) { const t = a0 + ((a1 - a0) * i) / 40; out.push([cx + Math.cos(t) * r, cy + Math.sin(t) * r, z]); } return out; };
  const line = dark ? BB.white : BB.orange, fill2 = dark ? BB.orange : BB.navy;
  ctx.save(); ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (fa > 0) {
    ctx.globalAlpha = fa;
    path([[-2.45, 0], [2.45, 0], [2.45, 5.8], [-2.45, 5.8]], true); ctx.fillStyle = css(team); ctx.fill();
    path(arc(0, 5.8, 1.8, 0, Math.PI), true); ctx.fillStyle = css(fill2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.globalAlpha = la; ctx.strokeStyle = css(line); ctx.lineWidth = Math.max(2, s * 0.09);
  path([[-7.5, 0], [7.5, 0], [7.5, 14], [-7.5, 14]], true); ctx.stroke();
  path([[-2.45, 0], [-2.45, 5.8], [2.45, 5.8], [2.45, 0]]); ctx.stroke();
  path(arc(0, 5.8, 1.8, 0, TAU)); ctx.stroke();
  const a3 = Math.acos(6.6 / 6.75);
  path([[-6.6, 0], ...arc(0, 1.575, 6.75, Math.PI - a3, a3), [6.6, 0]]);   // the three-point line: straight in the corners, then the arc
  ctx.stroke();
  path(arc(0, 14, 1.8, Math.PI, TAU)); ctx.stroke();
  if (fa > 0) {   // the stand: a post behind the baseline, an arm, the backboard, the rim and the net
    ctx.globalAlpha = fa; ctx.strokeStyle = css(bbInk()); ctx.lineWidth = Math.max(3, s * 0.16);
    path([[0, -1.2, 0], [0, -1.2, 3.5], [0, 0.95, 3.5]]); ctx.stroke();
    path([[-0.9, 1.2, 2.9], [0.9, 1.2, 2.9], [0.9, 1.2, 3.95], [-0.9, 1.2, 3.95]], true); ctx.fillStyle = css(BB.white); ctx.fill(); ctx.lineWidth = Math.max(2, s * 0.07); ctx.stroke();
    path([[-0.29, 1.2, 3.05], [0.29, 1.2, 3.05], [0.29, 1.2, 3.5], [-0.29, 1.2, 3.5]], true); ctx.stroke();
    ctx.strokeStyle = css(BB.orange); ctx.lineWidth = Math.max(2, s * 0.08); path(arc(0, 1.575, 0.23, 0, TAU, 3.05)); ctx.stroke();
    ctx.strokeStyle = css(bbInk(), 0.7); ctx.lineWidth = Math.max(1, s * 0.035);
    for (let i = 0; i < 10; i++) { const t0 = (i / 10) * TAU, t1 = t0 + TAU / 10; path([[Math.cos(t0) * 0.23, 1.575 + Math.sin(t0) * 0.23, 3.05], [Math.cos(t1) * 0.15, 1.575 + Math.sin(t1) * 0.15, 2.6]]); ctx.stroke(); path([[Math.cos(t1) * 0.23, 1.575 + Math.sin(t1) * 0.23, 3.05], [Math.cos(t0) * 0.15, 1.575 + Math.sin(t0) * 0.15, 2.6]]); ctx.stroke(); }
    const [bx, by] = P(-3.5, 9, 0.35);   // a ball on the floor, in the key's light
    basketball(ctx, bx, by, s * 0.38, 0.4, 0);
  }
  ctx.restore();
}
/** A hoop seen straight on, hanging from the top of the field, drawn in dotted line like a coarse halftone print. */
function hoopFront(ctx, env, amt) {
  const F = openField(env), fw = F.x1 - F.x0, W = fw * (0.14 + 0.16 * amt), [x, mid] = objAt("hoop", F.x0 + fw * 0.82, F.y0 + 14 + W * 0.45, ctx), top = mid - W * 0.45, lw = Math.max(3, W * 0.03), ink = bbInk();   // a scene object
  ctx.save(); ctx.globalAlpha = Math.min(1, amt * 3); ctx.strokeStyle = css(ink); ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.lineWidth = lw * 1.6; ctx.strokeRect(x - W / 2, top, W, W * 0.6);
  ctx.lineWidth = lw; ctx.strokeRect(x - W * 0.16, top + W * 0.3, W * 0.32, W * 0.24);
  const ry = top + W * 0.6, rw = W * 0.26, nh = W * 0.42, bw = W * 0.16;
  ctx.fillStyle = css(ink); ctx.fillRect(x - W * 0.05, top + W * 0.54, W * 0.1, W * 0.07);
  ctx.strokeStyle = css(BB.orange); ctx.lineWidth = lw * 1.3; ctx.beginPath(); ctx.ellipse(x, ry, rw, W * 0.045, 0, 0, TAU); ctx.stroke();
  ctx.strokeStyle = css(ink); ctx.lineWidth = lw * 0.75; ctx.setLineDash([lw * 0.4, lw * 0.9]);
  for (let i = 0; i <= 8; i++) {   // the net: two sets of strands crossing into diamonds as it narrows
    const t = i / 8, xa = x - rw + 2 * rw * t;
    for (const d of [-1, 1]) { const xb = x - bw + 2 * bw * clamp(t + d * 0.25); ctx.beginPath(); ctx.moveTo(xa, ry + W * 0.03); ctx.lineTo(xb, ry + nh); ctx.stroke(); }
  }
  for (let k = 1; k <= 3; k++) { const yy = ry + (nh * k) / 3.4, half = rw - (rw - bw) * (k / 3.4); ctx.beginPath(); ctx.moveTo(x - half, yy); ctx.lineTo(x + half, yy); ctx.stroke(); }
  ctx.restore();
}
/**
 * Where the varsity number and the ball go: beside the title where there is room; else toward the
 * field's far side, the number lower so it shows under the title, and the ball just below the title's
 * last line (`below`), where it is not hidden.
 */
function bbSpot(ctx, env) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, T = titleArea(ctx, env), room = T ? F.x1 - (T.x + T.w) : fw;
  if (room > fw * 0.3) return { F, cx: T ? (T.x + T.w + F.x1) / 2 : F.x0 + fw * 0.7, cy: F.y0 + fh * 0.48, room, below: null };
  return { F, cx: F.x0 + fw * 0.72, cy: F.y0 + fh * 0.58, room: fw * 0.45, below: T.y + T.h };
}
export const court = {
  id: "court",
  repaint: (c) => `a basketball poster made from the photograph: a bold two-colour team print in ${c} and basketball orange, halftone dots, the subject in high contrast, a distressed screen-print texture on a worn white wall; still the same picture, no text.`,
  about: { zh: "篮球海报：校队球衣式的大号数字（团队色、网点填充、白边加橙色外描边），一颗带缝线和网点阴影的篮球坐在数字中间；可加等距视角的半场平面图（篮架、篮筐、球网一起立起来）、点线画的正面篮筐、喷漆滴流、频道图形带出的速度残影；丝网印刷的斑驳和旧墙面质感。团队色来自频道色。米白墙底或深海军蓝底；自带平直的版式，色块是木地板。", en: "Basketball poster: a varsity number in the team colour — halftone fill, a white gap and an orange outline — with the ball, seams and halftone shading, sitting in it; a half court in isometric plan with its stand, rim and net rising, a hoop in dotted line, spray paint dripping, speed trails behind the channel graphic; the distress of a screen print and a worn wall. The team colour is the channel's. A worn white wall or deep navy; flat layouts of its own, the colour block a hardwood floor." },
  name: { zh: "篮球海报", en: "Basketball poster" },
  seeded: true,
  scene: { number: { zh: "球衣号码", en: "Jersey number" }, ball: { zh: "篮球", en: "Ball" }, court: { zh: "半场平面", en: "Half court" }, hoop: { zh: "正面篮筐", en: "Hoop" } },
  params: [
    { key: "number", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "球衣号码", en: "Jersey number" } },
    { key: "jersey", text: true, max: 3, def: "", name: { zh: "号码内容", en: "The number" }, placeholder: { zh: "留空：用频道序号", en: "Empty: the channel's place" } },
    { key: "ball", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "篮球", en: "Ball" } },
    { key: "court", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "半场平面", en: "Half court" } },
    { key: "hoop", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "正面篮筐", en: "Hoop" } },
    { key: "spray", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "喷漆滴流", en: "Spray drips" } },
    { key: "motion", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "速度残影", en: "Speed trails" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "网点", en: "Halftone" } },
    { key: "distress", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "丝网斑驳", en: "Screen-print wear" } },
    { key: "wall", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旧墙面", en: "Worn wall" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "颗粒", en: "Grain" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片双色", en: "Photo in two colours" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.18, side: 0.3, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(bbGround()), text: css(bbInk()), dim: css(bbInk(), 0.6), titleFill: css(bbInk()), titleInk: css(bbGround()), grid: () => css(bbInk(), 0.1) }),
  /**
   * The ground; the half court; the dotted hoop; speed trails behind the channel graphic; then the
   * varsity number with the spray and the ball on it. A photo becomes a two-colour print (navy, the team
   * colour, white) through a halftone.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), team = bbTeam(C);
    if (L.ground !== false) { ctx.fillStyle = css(bbGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      mapTones(ctx, toneTable([[0, mix(BB.navy, team, 0.2)], [0.55, team], [1, BB.white]], 0.15), p.duo * 0.85);
      dotScreen(ctx, w, h, BB.navy, 8, 0.35 * p.halftone);
      return true;
    }
    if (!L.grid) return true;
    if (p.court > 0) courtPlan(ctx, env, p.court, team);
    if (p.hoop > 0) hoopFront(ctx, env, p.hoop);
    const S = canPaint(ctx) && graphicShape(env, env.graphic), A = S && artPlace(env, S);   // the channel graphic itself, where it stands
    if (A && p.motion > 0) {   // the figure has just passed: soft copies trailing back, and speed lines
      for (let i = 5; i >= 1; i--) blurred(ctx, A.size * 0.02, css(team, (0.5 * p.motion) / Math.sqrt(i)), () => placeShape(ctx, S, [0, 0, 0], A.cx - i * A.size * 0.1 * (0.4 + p.motion), A.cy, A.size));
      ctx.save(); ctx.strokeStyle = css(team, 0.75); ctx.lineCap = "round";
      for (let k = 0; k < Math.round(4 + 8 * p.motion); k++) { const y = A.cy + (rand(k * 2.9 + 1500) - 0.5) * A.size * 0.8, x1 = A.cx - A.size * (0.35 + rand(k * 3.3 + 1501) * 0.2), len = A.size * (0.3 + rand(k * 4.1 + 1502) * 0.7) * p.motion; ctx.lineWidth = 2 + rand(k + 1503) * 4; ctx.beginPath(); ctx.moveTo(x1 - len, y); ctx.lineTo(x1, y); ctx.stroke(); }
      ctx.restore();
    }
    const at = bbSpot(ctx, env), fh = at.F.y1 - at.F.y0;
    if (p.number > 0 && canPaint(ctx)) {   // the varsity number: team colour through a halftone, a white gap, an orange outline; a scene object
      const [nx, ty] = objAt("number", at.cx, at.cy - fh * 0.2, ctx), ny = ty + fh * 0.2;   // its handle up from the ball's
      const str = [...((p.jersey || pad2(env.o.catIndex + 1)).toUpperCase())].filter((c) => c.trim()).slice(0, 3).join("") || "0", x = workLike(ctx, "bb");
      x.font = `900 100px ${fonts.en}, ${fonts.cn}`; const fs = Math.min(fh * (0.5 + 0.45 * p.number), (at.room * 0.9 * 100) / Math.max(1, x.measureText(str).width));
      x.font = `900 ${fs}px ${fonts.en}, ${fonts.cn}`; x.textAlign = "center"; x.textBaseline = "middle"; x.lineJoin = "round";
      x.fillStyle = css(team); x.fillText(str, nx, ny);
      if (p.halftone > 0) dotScreen(x, w, h, [0, 0, 0], Math.max(6, Math.round(fs * 0.035)), 0.75 * p.halftone, "destination-out");
      x.globalCompositeOperation = "destination-over";
      x.strokeStyle = css(BB.white); x.lineWidth = fs * 0.07; x.strokeText(str, nx, ny);
      x.strokeStyle = css(BB.orange); x.lineWidth = fs * 0.13; x.strokeText(str, nx, ny);
      layDown(ctx, x, Math.min(1, p.number * 4));
    }
    // under a long title the ball goes just below its last line, left of the channel graphic
    const br = u * (0.05 + 0.14 * p.ball), G = env.G && env.G.art, gl = G ? G.x - 300 * G.s : at.F.x1;
    const bx0 = at.below ? clamp(gl - br * 1.15, at.F.x0 + (at.F.x1 - at.F.x0) * 0.3, at.cx) : at.cx + (p.number > 0 ? br * 0.25 : 0);
    const by0 = at.below ? clamp(at.below + br * 0.75, at.cy, at.F.y1 - br * 1.15) : at.cy + (p.number > 0 ? br * 0.1 : 0);
    const [bx, by] = p.ball > 0 ? objAt("ball", bx0, by0, ctx) : [bx0, by0];   // a scene object
    if (p.spray > 0 && p.ball > 0) {   // spray paint round the ball, and drips running down from it
      ctx.save(); ctx.fillStyle = css(team, 0.85);
      for (let k = 0, n = Math.round(500 * p.spray); k < n; k++) { const a = rand(k * 1.3 + 1510) * TAU, d = br * (0.95 + rand(k * 2.1 + 1511) ** 2 * 0.7 * (0.4 + p.spray)); ctx.beginPath(); ctx.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d, 0.8 + rand(k * 3.7 + 1512) * 2.2, 0, TAU); ctx.fill(); }
      for (let k = 0, n = Math.round(3 + 5 * p.spray); k < n; k++) {
        const off = (rand(k * 4.3 + 1513) - 0.5) * br * 1.6, top = by + Math.sqrt(Math.max(0, br * br - off * off)) * 0.6, len = br * (0.3 + rand(k * 5.9 + 1514) * 1.8) * p.spray, dw = br * (0.07 + rand(k * 6.7 + 1515) * 0.09);
        ctx.beginPath(); rounded(ctx, bx + off - dw / 2, top, dw, len, dw / 2); ctx.fill();
        ctx.beginPath(); ctx.arc(bx + off, top + len, dw * 0.75, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    if (p.ball > 0) basketball(ctx, bx, by, br, -0.5 + rand(1520) * 0.6, p.halftone);
    return true;
  },
  /** A hardwood floor: boards across, 48 wide, their butt joints staggered from row to row. */
  gridLines(ctx, env, color) {
    const { w, h } = env, b = 48;
    gridPen(ctx, color);
    gridPath(ctx, [], every(b, h, b), 0, 0, w, 0);
    ctx.beginPath();
    for (let j = 0; j * b < h; j++) for (let x = noise(j * 3.1 + 7) * 420, i = 0; x < w; i++, x += 300 + noise(j * 1.7 + i * 2.3) * 360) { ctx.moveTo(x, j * b); ctx.lineTo(x, j * b + b); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(BB.wood), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(BB.white); ctx.lineWidth = 7; run(0, 0); } },   // the hardwood floor and its boundary line
  /** Heavy condensed capitals with a second colour set off a little behind them, as on a jersey (the shadow slider); highlighted words in ball orange. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, team = bbTeam(o.C || BB.royal), d = fs * 0.05 * Math.min(2, o.shadowAmt), [dx, dy] = fall(d, d);
    if (d > 0) pass((a, x) => { ctx.fillStyle = css(a.hi ? BB.seam : team); ctx.fillText(a.t, x + dx, dy); });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || BB.orange : o.fill || bbInk()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: BB.ink, light: BB.white }, stroke: { ink: BB.ink, light: BB.white }, line: 0.8 })),
  sticker: painters({ line: BB.ink, lineScale: 0.7, shadow(ctx, draw) { ctx.save(); ctx.translate(5, 7); draw("rgba(0,0,0,0.25)"); ctx.restore(); } }),
  /** The corner tag: a chenille varsity patch — team colour, a white keyline and an orange border. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.72, team = bbTeam(C);
    ctx.font = `900 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.3, h = f * 1.55, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.3); ctx.fillStyle = css(BB.orange); ctx.fill();
    ctx.beginPath(); rounded(ctx, x + 5, top + 5, w - 10, h - 10, h * 0.24); ctx.fillStyle = css(BB.white); ctx.fill();
    ctx.beginPath(); rounded(ctx, x + 9, top + 9, w - 18, h - 18, h * 0.2); ctx.fillStyle = css(team); ctx.fill();
    ctx.fillStyle = ink || css(lum(team) > 0.6 ? BB.ink : BB.white); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a row of stars across the top, as on a championship shirt. */
  frame(ctx, env) {
    const { w } = env;
    for (let i = 0; i < 5; i++) starMark(ctx, w / 2 + (i - 2) * 34, 50, 9, 5, bbInk());
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 8 * unit; },
  /** The print worn through (paper or navy showing in specks), the wall behind it scuffed and creased, grain. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, bbGround(), p.distress * 0.9, dark ? "darken" : "lighten");
    if (p.wall > 0) { crumple(ctx, w, h, p.wall * 0.7); wear(ctx, w, h, dark ? [70, 80, 110] : [150, 148, 144], p.wall * 0.45, dark ? "lighten" : "multiply"); }
    grain(ctx, p.grain * 0.7, unit, !dark);
  },
  prompt: `Stickers for a basketball team print — bold, sporty, graphic — that read at a glance:
- one clear object per sticker (a ball, a sneaker, a jersey, a hoop, a trophy, a whistle, a player in silhouette, a star), simple and punchy; no realism, no perspective, no fine detail;
- flat colour only: the main colour (the team colour) with "white", "ink" and orange ("yellow" comes out gold) as partners;
- the app adds a dark outline and a hard offset shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects from basketball, built as simple models from a few boxes and cylinders — a hoop and backboard, a bench, a scoreboard, a ball rack, a locker; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" the team colour — use it for one to three parts.`,
};
court.elementFx = [
  { key: "varsity", name: { zh: "校队描边", en: "Varsity outline" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 24 * k, t: 24 * k, r: 24 * k, b: 24 * k }),
    /** A white gap round the layer, then an outline in ball orange, as a varsity number has. */
    paint(x, B, a, E) { const r1 = (2 + 5 * a) * E.k, r2 = r1 + (3 + 9 * a) * E.k; x.save(); x.globalAlpha = Math.min(1, a * 1.6); ringsBehind(x, B, region(x, B, "fxA"), [[BB.white, r1 * 0.5], [BB.white, r1], [BB.orange, (r1 + r2) / 2], [BB.orange, r2]]); x.restore(); } },
  { key: "knockout", name: { zh: "网点挖空", en: "Halftone knock-out" }, for: FX_ALL, stage: "over",
    /** Holes of a halftone knocked out of the layer, growing as it rises. */
    paint: dotsFx({ colour: () => [0, 0, 0], pitch: (E) => 9 * E.k, size: (p, a) => p * 0.42 * a, mode: "destination-out" }) },
  { key: "spray", name: { zh: "喷漆滴流", en: "Spray drips" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 30 * k, t: 30 * k, r: 30 * k, b: B.h * 0.65 + 30 * k }),
    /** Spray paint of the team colour round the layer, and drips running from it. */
    paint(x, B, a, E) {
      const team = bbTeam(E.C);
      dripsBehind(x, B, a, E, team, 0.7);
      x.save(); x.globalCompositeOperation = "destination-over"; x.fillStyle = css(team, 0.85);
      for (let k = 0, n = Math.round(260 * a); k < n; k++) { const t = E.R(k * 1.3 + 131) * TAU, s = 0.9 + E.R(k * 2.1 + 132) ** 2 * 0.25, px = B.x0 + B.w / 2 + Math.cos(t) * B.w / 2 * s, py = B.y0 + B.h / 2 + Math.sin(t) * B.h / 2 * s; x.beginPath(); x.arc(px, py, (0.6 + E.R(k * 3.7 + 133) * 1.6) * E.k, 0, TAU); x.fill(); }
      x.restore();
    } },
  { key: "trails", name: { zh: "速度残影", en: "Speed trails" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.6 }),
    /** The layer has just passed: copies of it in the team colour trailing back to the left, and speed lines. */
    paint(x, B, a, E) {
      const team = bbTeam(E.C), s = shapeIn(region(x, B, "fxA"), team, "fxTr");
      trail(x, B, s, 5, -B.w * 0.07 * (0.4 + a), 0, 0.3 + 0.4 * a, "destination-over");
      x.save(); x.globalCompositeOperation = "destination-over"; x.strokeStyle = css(team, 0.75); x.lineCap = "round";
      for (let k = 0, n = Math.round(3 + 8 * a); k < n; k++) { const y = B.y0 + B.h * (0.15 + 0.7 * E.R(k * 2.9 + 141)), len = B.w * (0.2 + E.R(k * 4.1 + 142) * 0.4) * a; x.lineWidth = (1.5 + E.R(k + 143) * 3) * E.k; x.beginPath(); x.moveTo(B.x0 - len, y); x.lineTo(B.x0 + B.w * 0.2, y); x.stroke(); }
      x.restore();
    } },
  { key: "distress", name: { zh: "丝网斑驳", en: "Screen-print wear" }, for: FX_ALL, stage: "over",
    /** The print worn through in specks and patches. */
    paint(x, B, a, E) { knockWorn(x, B, a * 0.95, E, 1.3); } },
  { key: "duo", name: { zh: "照片双色", en: "Photo in two colours" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a two-colour team print: navy, the team colour, white. */
    paint: tonesFx((E) => [[0, mix(BB.navy, bbTeam(E.C), 0.2)], [0.55, bbTeam(E.C)], [1, BB.white]], 0.15) },
];
