// jelly: translucent toys in a machine
// Collectible creatures of clear, glowing jelly set into a machine: circuit boards with their traces and
// chips, speaker cones, coiled cables, knobs, an orange seven-segment display and columns of tiny print;
// the machinery soft behind the creature, its glow spilling out.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, avGlow, bevel, bevelFx, blurred, boost, canPaint, clamp, css, dark, fast, glowBehind, grain, graphicShape, greeked, gridPen, inPixels, inkAs, layDown, mapTones, mapped, mix, near, onLayer, openField, pad2, padded, painters, placeShape, rand, region, rounded, shift, snap, softCopy, softened, toneTable, tonesFx, upright, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const JL = { steel: [170, 186, 196], night: [12, 22, 32], board: [30, 64, 86], deep: [18, 40, 58], coral: [255, 110, 72], lime: [196, 234, 44], cobalt: [40, 112, 222], cream: [238, 242, 234], amber: [255, 150, 36], ink: [14, 22, 30], trace: [236, 132, 70] };
const jlGround = () => (dark ? JL.night : JL.steel), jlInk = () => (dark ? JL.cream : JL.ink);
/** The jelly's colour: the channel's, made vivid; coral where it would sink into the board or the ground. */
const jlBody = (C) => { const c = boost(C, 0.55); return near(c, jlGround(), 110) || near(c, JL.board, 90) ? JL.coral : c; };
function jlPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.4 + 0.42 * p.figure);
  return { F, cx: F.x0 + fw * 0.64, cy: F.y0 + fh * 0.46, size };
}
/**
 * The machine's panel, which the circuit, the tiny print and the knobs are laid on, as large as `board`
 * says and whatever size the figure is. At 0.5 it is the field less a margin, its left edge where a figure
 * of the slider's default size (0.55) would reach; toward 1 it grows to the whole field, toward 0 it
 * shrinks about its middle to nothing (at 0 there is no panel: see jelly's background).
 */
function jlPanel({ F, cx }, board = 0.5) {
  const all = { x0: F.x0 + 24, y0: F.y0 + 24, x1: F.x1 - 24, y1: F.y1 - 24 }, usual = (F.y1 - F.y0) * (0.4 + 0.42 * 0.55), mid = { ...all, x0: Math.max(all.x0, cx - usual) };
  if (board >= 0.5) { const t = (board - 0.5) * 2; return Object.fromEntries(Object.keys(all).map((k) => [k, mid[k] + (all[k] - mid[k]) * t])); }
  const k = 2 * board, mx = (mid.x0 + mid.x1) / 2, my = (mid.y0 + mid.y1) / 2, hw = ((mid.x1 - mid.x0) / 2) * k, hh = ((mid.y1 - mid.y0) / 2) * k;
  return { x0: mx - hw, y0: my - hh, x1: mx + hw, y1: my + hh };
}
/** A polyline moved `o` to its left, its corners mitred. */
function offsetLine(pts, o) {
  const N = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  return pts.map((p, i) => {
    const n1 = i > 0 ? N(pts[i - 1], p) : N(p, pts[i + 1]), n2 = i < pts.length - 1 ? N(p, pts[i + 1]) : n1;
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const c = mx * n1[0] + my * n1[1] || 1;
    return [p[0] + (mx * o) / c, p[1] + (my * o) / c];
  });
}
/**
 * A circuit board's copper over `box`: buses of two to four parallel traces running straight and turning
 * through 45°, a ring pad at their ends and a via at their starts; black chips with rows of pins. `amt`
 * adds traces and chips one after another.
 */
function circuit(ctx, box, amt, colour, k0) {
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0, g = Math.min(bw, bh) * 0.028, n = amt * 34, D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  ctx.save(); ctx.beginPath(); ctx.rect(box.x0, box.y0, bw, bh); ctx.clip();
  ctx.lineCap = "round"; ctx.lineJoin = "miter"; ctx.strokeStyle = css(colour); ctx.fillStyle = css(colour);
  for (let k = 0; k < Math.ceil(n); k++) {
    ctx.globalAlpha = clamp(n - k) * 0.85;
    let x = box.x0 + Math.round((rand(k * 2.1 + k0) * bw) / g) * g, y = box.y0 + Math.round((rand(k * 3.3 + k0 + 1) * bh) / g) * g, d = Math.floor(rand(k * 4.7 + k0 + 2) * 4);
    const pts = [[x, y]];
    for (let s = 0; s < 3; s++) {
      const len = g * (2 + Math.floor(rand(k * 7.1 + s * 1.3 + k0 + 4) * 7));
      x += D[d][0] * len; y += D[d][1] * len; pts.push([x, y]);
      if (s < 2) { const nd = (d + (rand(k * 8.3 + s + k0 + 5) > 0.5 ? 1 : 3)) % 4; x += (D[d][0] + D[nd][0]) * g; y += (D[d][1] + D[nd][1]) * g; pts.push([x, y]); d = nd; }
    }
    const lanes = 2 + Math.floor(rand(k * 9.7 + k0 + 6) * 3), lw = Math.max(1.2, g * (0.12 + rand(k * 5.9 + k0 + 3) * 0.1));
    ctx.lineWidth = lw;
    for (let b = 0; b < lanes; b++) {
      const q = offsetLine(pts, (b - (lanes - 1) / 2) * g * 0.45), e = q[q.length - 1];
      ctx.beginPath(); q.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.stroke();
      ctx.beginPath(); ctx.arc(e[0], e[1], g * 0.2, 0, TAU); ctx.lineWidth = lw * 1.2; ctx.stroke(); ctx.lineWidth = lw;
      ctx.beginPath(); ctx.arc(q[0][0], q[0][1], g * 0.12, 0, TAU); ctx.fill();
    }
  }
  for (let k = 0, m = amt * 5; k < Math.ceil(m); k++) {   // chips
    const cw = g * (3 + Math.floor(rand(k * 2.9 + k0 + 50) * 4)), ch = g * (2 + Math.floor(rand(k * 3.7 + k0 + 51) * 3)), x = box.x0 + rand(k * 4.3 + k0 + 52) * (bw - cw), y = box.y0 + rand(k * 5.1 + k0 + 53) * (bh - ch);
    ctx.globalAlpha = clamp(m - k);
    ctx.fillStyle = css(colour); for (let i = 0; i < Math.floor(cw / (g * 0.5)); i++) { ctx.fillRect(x + g * 0.3 + i * g * 0.5, y - g * 0.3, g * 0.22, ch + g * 0.6); }
    ctx.fillStyle = css(JL.ink); ctx.fillRect(x, y, cw, ch);
    ctx.fillStyle = css(JL.cream, 0.5); ctx.beginPath(); ctx.arc(x + g * 0.4, y + g * 0.4, g * 0.12, 0, TAU); ctx.fill();
    greeked(ctx, x + g * 0.8, y + ch * 0.4, cw - g * 1.6, 2, g * 0.35, css(JL.cream, 0.45), k0 + k * 7);
  }
  ctx.restore();
}
/** A speaker: its frame and four screws, the surround, the cone lit from the upper left with its rings, the dust cap. */
function speaker(ctx, x, y, r) {
  const g0 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r); g0.addColorStop(0, "#5a6470"); g0.addColorStop(1, "#1c2228");
  ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.fillStyle = "#9aa4ae"; for (let i = 0; i < 4; i++) { const a = Math.PI / 4 + (i * Math.PI) / 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88, r * 0.045, 0, TAU); ctx.fill(); }
  ctx.fillStyle = "#262c33"; ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, TAU); ctx.fill();
  const g1 = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.05, x, y, r * 0.72); g1.addColorStop(0, "#69737e"); g1.addColorStop(0.7, "#20262c"); g1.addColorStop(1, "#0c1014");
  ctx.fillStyle = g1; ctx.beginPath(); ctx.arc(x, y, r * 0.7, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = Math.max(1, r * 0.015); for (const q of [0.38, 0.5, 0.62]) { ctx.beginPath(); ctx.arc(x, y, r * q, 0, TAU); ctx.stroke(); }
  const g2 = ctx.createRadialGradient(x - r * 0.08, y - r * 0.1, 0, x, y, r * 0.24); g2.addColorStop(0, "#b8c0c8"); g2.addColorStop(1, "#30363c");
  ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(x, y, r * 0.24, 0, TAU); ctx.fill();
}
/** A cable: a tube of `colour`, its dark side, its body and a highlight along it. */
function cable(ctx, pts, lw, colour) {
  const path = () => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.bezierCurveTo(pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]); };
  ctx.lineCap = "round";
  path(); ctx.strokeStyle = css(mix(colour, [0, 0, 0], 0.5)); ctx.lineWidth = lw; ctx.stroke();
  path(); ctx.strokeStyle = css(colour); ctx.lineWidth = lw * 0.7; ctx.stroke();
  ctx.save(); ctx.translate(-lw * 0.15, -lw * 0.18); path(); ctx.strokeStyle = css(mix(colour, [255, 255, 255], 0.65), 0.85); ctx.lineWidth = lw * 0.16; ctx.stroke(); ctx.restore();
}
/** The segments each character of a seven-segment display lights. */
const SEGS = { 0: "abcdef", 1: "bc", 2: "abdeg", 3: "abcdg", 4: "bcfg", 5: "acdfg", 6: "acdefg", 7: "abc", 8: "abcdefg", 9: "abcdfg", "-": "g" };
/** One character of a seven-segment display, `s` tall, slanted a little; the unlit segments faintly in `off`. */
function segDigit(ctx, ch, x, y, s, on, off) {
  const w = s * 0.5, t = s * 0.1, segs = { a: [t, 0, w - t, 0], b: [w, t, w, s / 2 - t], c: [w, s / 2 + t, w, s - t], d: [t, s, w - t, s], e: [0, s / 2 + t, 0, s - t], f: [0, t, 0, s / 2 - t], g: [t, s / 2, w - t, s / 2] };
  ctx.lineCap = "round"; ctx.lineWidth = t;
  for (const [k, [x0, y0, x1, y1]] of Object.entries(segs)) {
    const lit = (SEGS[ch] || "").includes(k);
    if (!lit && !off) continue;
    ctx.strokeStyle = lit ? on : off; ctx.beginPath(); ctx.moveTo(x + x0 + (s - y0) * 0.1, y + y0); ctx.lineTo(x + x1 + (s - y1) * 0.1, y + y1); ctx.stroke();
  }
}
export const jelly = {
  id: "jelly",
  art: "figure",
  repaint: (c) => `a glossy 3D designer-toy render made from the photograph: translucent jelly and clear plastic glowing from within in coral orange, lime green and cobalt blue, set into intricate retro electronics — circuit boards, speaker cones, cables, a seven-segment display — soft studio light and a shallow depth of field, with ${c} as an accent; no readable text.`,
  about: { zh: "果冻机械：潮玩海报里那种透明发光的果冻生物，嵌在一台机器里——频道图形变成一只半透明、内有气泡、表面油亮的果冻（颜色来自频道色），身后是电路板的走线和芯片、音箱喇叭、盘绕的线缆、旋钮按键、橙色的七段数码屏和一栏栏极小的说明字；背景可以虚化，让果冻跳出来，辉光溢出。可爱、精密、科技感——适合科技、潮玩、音乐、电子、游戏和产品类内容。照片会调成青橙配色。可选钢灰底或深夜底；自带平直的版式。", en: "Jelly machine: the clear, glowing jelly creatures of designer-toy posters, set into a machine — the channel graphic as translucent jelly with bubbles inside and a glossy skin (in the channel colour), behind it a circuit board's traces and chips, speaker cones, coiled cables, knobs and buttons, an orange seven-segment display and columns of tiny print; the machinery out of focus if you like, so the jelly stands out, its glow spilling over. Cute, precise, technical — for tech, designer toys, music, electronics, games and products. A photo is graded teal and orange. A steel-grey or a night ground; flat layouts of its own." },
  name: { zh: "果冻机械", en: "Jelly machine" },
  seeded: true,
  scene: { figure: { zh: "果冻身影", en: "Jelly figure" }, display: { zh: "数码屏", en: "Segment display" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "果冻身影", en: "Jelly figure" } },
    { key: "circuit", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "电路板", en: "Circuit board" } },
    { key: "board", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "电路板大小", en: "Board size" } },
    { key: "speakers", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "音箱喇叭", en: "Speakers" } },
    { key: "cables", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "线缆", en: "Cables" } },
    { key: "knobs", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旋钮按键", en: "Knobs and buttons" } },
    { key: "lcd", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "数码屏", en: "Segment display" } },
    { key: "text", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "密排小字", en: "Tiny print" } },
    { key: "blobs", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "果冻小球", en: "Jelly drops" } },
    { key: "depth", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "景深虚化", en: "Depth of field" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "辉光", en: "Glow" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "颗粒", en: "Grain" } },
    { key: "tone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片青橙调", en: "Photo teal and orange" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(jlGround()), text: css(jlInk()), dim: css(jlInk(), 0.6), titleFill: css(jlInk()), titleInk: css(jlGround()), grid: () => css(jlInk(), 0.12) }),
  /**
   * The machine's panel round the figure: tiny print, the circuit, speakers, cables, knobs; all of it
   * softened (Depth of field); then the figure's glow, the jelly itself (on a work canvas: a colour lit
   * from inside, the bevel, bubbles, a glossy highlight — laid down a little clear), jelly drops, the
   * display, and the glow spilling over. A photo is graded teal and orange.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), body = jlBody(C);
    if (L.ground !== false) { ctx.fillStyle = css(jlGround()); ctx.fillRect(0, 0, w, h); }
    if (L.ground !== false) { const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, "rgba(255,255,255,0.12)"); g.addColorStop(1, "rgba(0,0,0,0.12)"); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      mapTones(ctx, toneTable([[0, [8, 18, 28]], [0.4, [34, 104, 132]], [0.7, [244, 132, 86]], [1, [252, 246, 228]]]), p.tone);
      if (L.fill) avGlow(ctx, p.glow * 0.5);
      return true;
    }
    if (!L.grid) return true;
    const at = jlPlace(env, p), F = at.F, { cx, cy, size } = at, P = jlPanel(at, p.board), room = p.board < 0.5 ? jlPanel(at) : P, pw = P.x1 - P.x0, ph = P.y1 - P.y0;
    const board = p.board > 0;   // the panel and what is laid on it (print, circuit, knobs): none at a board size of nothing
    if (board) { ctx.beginPath(); rounded(ctx, P.x0, P.y0, pw, ph, u * 0.025); ctx.fillStyle = css(dark ? JL.deep : [204, 216, 224]); ctx.fill(); ctx.strokeStyle = dark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.18)"; ctx.lineWidth = 2; ctx.stroke(); }   // pale on the steel ground, so dark lettering over it still reads
    if (board && p.text > 0) {   // columns of tiny print down both sides of the panel, an amber heading over each
      ctx.save(); ctx.globalAlpha = Math.min(1, p.text * 3);
      const cw = pw * 0.17, rows = Math.round(4 + 26 * p.text);
      for (const x of [P.x0 + 18, P.x1 - 18 - cw]) { ctx.fillStyle = css(JL.amber, 0.85); ctx.fillRect(x, P.y0 + 18, cw * 0.6, 6); greeked(ctx, x, P.y0 + 34, cw, rows, 8, css(dark ? JL.cream : JL.ink, 0.5), 2420 + x); }
      ctx.restore();
    }
    if (board && p.circuit > 0) circuit(ctx, P, p.circuit, dark ? JL.trace : [226, 118, 56], 2430);
    // the speakers, cables and display are the jelly's: kept within the panel of the default size even when a smaller one is drawn
    if (p.speakers > 0) {   // pairs of speakers either side of the figure, the upper ones first
      const r = size * 0.15, n = p.speakers * 6;
      for (let k = 0; k < Math.ceil(n); k++) { ctx.save(); ctx.globalAlpha = clamp(n - k); speaker(ctx, k % 2 ? Math.min(room.x1 - r * 1.15, cx + size * 0.62) : Math.max(room.x0 + r * 1.15, cx - size * 0.62), cy - size * 0.3 + (k >> 1) * r * 2.3, r); ctx.restore(); }
    }
    if (p.cables > 0) {   // cables from under the figure, sagging out to the panel's edges
      const cols = [JL.lime, JL.cobalt, JL.coral, JL.cream, JL.lime], n = p.cables * 5;
      for (let k = 0; k < Math.ceil(n); k++) {
        const s = k % 2 ? 1 : -1, x0 = cx + s * size * (0.05 + k * 0.04), y0 = cy + size * 0.3, x1 = s > 0 ? room.x1 + 10 : room.x0 - 10, y1 = cy + size * (0.1 + rand(k * 2.7 + 2440) * 0.5);
        ctx.save(); ctx.globalAlpha = clamp(n - k); cable(ctx, [x0, y0, x0 + s * size * 0.1, y0 + size * 0.6, x1 - s * size * 0.3, y1 + size * 0.5, x1, y1], u * (0.012 + rand(k + 2441) * 0.01), cols[k]); ctx.restore();
      }
    }
    if (board && p.knobs > 0) {   // a row of knobs and buttons along the panel's foot, a small lamp beside each
      const r = u * 0.024, n = p.knobs * 8, y = P.y1 - r * 2;
      for (let k = 0; k < Math.ceil(n); k++) {
        const x = P.x0 + pw * 0.08 + k * r * 3.4, c = [JL.lime, JL.coral, JL.cream, JL.cobalt][k % 4];
        if (x > P.x1 - r * 2) break;
        ctx.save(); ctx.globalAlpha = clamp(n - k);
        ctx.fillStyle = "rgba(0,0,0,0.35)"; ctx.beginPath(); ctx.arc(x + r * 0.15, y + r * 0.2, r * 1.05, 0, TAU); ctx.fill();
        const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, css(mix(c, [255, 255, 255], 0.5))); g.addColorStop(1, css(mix(c, [0, 0, 0], 0.35))); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        if (k % 2 === 0) { const a = -2.2 + rand(k + 2450) * 2.6; ctx.strokeStyle = css(JL.ink, 0.8); ctx.lineWidth = r * 0.16; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.75); ctx.stroke(); }
        ctx.fillStyle = css(rand(k + 2451) > 0.4 ? JL.lime : JL.amber); ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(x + r * 1.5, y - r * 0.7, r * 0.16, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
    if (p.depth > 0 && canPaint(ctx) && !fast) {   // the machinery out of focus behind the figure
      const soft = softCopy(snap(ctx, "jlSnap"), 4 + 12 * p.depth, "jlDepth"), cv = ctx.canvas;
      inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, p.depth * 1.4); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
    }
    const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {
      ctx.save(); shift("figure", cx, cy - size * 0.3, ctx);   // a scene object (its work canvas takes the move with ctx's transform)
      if (p.glow > 0) blurred(ctx, size * 0.08, css(body, 0.65 * p.glow), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
      const x = workLike(ctx, "jelly");
      placeShape(x, S, [255, 255, 255], cx, cy, size);
      x.globalCompositeOperation = "source-in";
      const g = x.createRadialGradient(cx - size * 0.08, cy - size * 0.1, size * 0.04, cx, cy, size * 0.62);
      g.addColorStop(0, css(mix(body, [255, 250, 230], 0.55))); g.addColorStop(0.55, css(body)); g.addColorStop(1, css(mix(body, JL.ink, 0.38)));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = "source-over";
      bevel(x, S, cx, cy, size, size * 0.01, mix(body, [255, 255, 255], 0.6), mix(body, JL.ink, 0.5), 0.55);
      x.save(); x.globalCompositeOperation = "source-atop";
      x.strokeStyle = "rgba(255,255,255,0.55)"; x.lineWidth = Math.max(1, size * 0.003);
      for (let k = 0; k < 16; k++) { x.beginPath(); x.arc(cx + (rand(k * 2.1 + 2460) - 0.5) * size * 0.8, cy + (rand(k * 2.9 + 2461) - 0.4) * size * 0.8, size * (0.006 + rand(k * 3.7 + 2462) ** 2 * 0.025), 0, TAU); x.stroke(); }   // bubbles
      x.fillStyle = "rgba(255,255,255,0.8)"; x.beginPath(); x.ellipse(cx - size * 0.2, cy - size * 0.28, size * 0.1, size * 0.04, -0.5, 0, TAU); x.fill();
      x.beginPath(); x.arc(cx - size * 0.06, cy - size * 0.34, size * 0.015, 0, TAU); x.fill();
      x.restore();
      layDown(ctx, x, 0.9);
      ctx.restore();
    }
    for (let k = 0, n = p.blobs * 12; k < Math.ceil(n); k++) {   // round drops of jelly scattered round the figure
      const a = rand(k * 2.3 + 2470) * TAU, d = size * (0.48 + rand(k * 3.1 + 2471) * 0.32), x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.85, r = size * (0.025 + rand(k * 4.7 + 2472) * 0.045), c = [body, JL.lime, JL.cobalt][k % 3];
      ctx.save(); ctx.globalAlpha = clamp(n - k) * 0.92;
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, r * 0.1, x, y, r); g.addColorStop(0, css(mix(c, [255, 255, 255], 0.5))); g.addColorStop(0.6, css(c)); g.addColorStop(1, css(mix(c, JL.ink, 0.4)));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.ellipse(x - r * 0.35, y - r * 0.42, r * 0.28, r * 0.14, -0.6, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (p.lcd > 0) {   // the display under the figure: the channel's number and four more digits, the unlit segments faint
      const bw = size * (0.5 + 0.45 * p.lcd), bh = bw * 0.24, bx = clamp(cx - bw / 2, room.x0 + 12, room.x1 - bw - 12), by = clamp(cy + size * 0.5, room.y0 + 12, room.y1 - bh - 12), str = `${pad2(env.o ? env.o.catIndex + 1 : 1)}-${String(Math.floor(rand(2480) * 9000 + 1000))}`;
      ctx.save(); ctx.globalAlpha = Math.min(1, p.lcd * 3);
      shift("display", bx + bw / 2, by + bh / 2, ctx);   // a scene object
      ctx.beginPath(); rounded(ctx, bx, by, bw, bh, bh * 0.15); ctx.fillStyle = "#07090b"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2; ctx.stroke();
      const s = bh * 0.62, step = (bw - bh * 0.5) / str.length;
      if (!fast) { ctx.shadowColor = css(JL.amber, 0.9); ctx.shadowBlur = 10; }
      [...str].forEach((ch, i) => segDigit(ctx, ch, bx + bh * 0.3 + i * step, by + (bh - s) / 2, s, css(JL.amber), css(JL.amber, 0.1)));
      ctx.restore();
    }
    avGlow(ctx, p.glow * 0.45);
    return true;
  },
  /** Perfboard: a ring of copper round every hole, 32 apart. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 32, r = 5;
    gridPen(ctx, color); ctx.beginPath();
    for (let y = s / 2; y < h; y += s) for (let x = s / 2; x < w; x += s) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: () => css(dark ? JL.board : JL.cobalt), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(JL.ink); ctx.lineWidth = 4; run(0, 0); ctx.strokeStyle = css(JL.lime); ctx.lineWidth = 4; run(-nx * 7, -ny * 7); } },
  /** Plain capitals with a glow of the jelly's colour round them (the shadow slider); highlighted words in glossy jelly, a pale band across their upper part. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, k = o.unit || 1, s = Math.min(2, o.shadowAmt), ink = o.fill || jlInk(), hi = o.hi || jlBody(o.C || JL.coral), paint = (a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); };
    if (s > 0 && !fast) { ctx.save(); ctx.shadowColor = dark ? css(hi, 0.7) : css(JL.ink, 0.3); ctx.shadowBlur = fs * 0.15 * s * k; ctx.shadowOffsetY = dark ? 0 : fs * 0.04 * s * k; pass(paint); ctx.restore(); }
    pass(paint);
    ctx.save(); ctx.beginPath(); ctx.rect(-1e5, -fs * 0.8, 2e5, fs * 0.2); ctx.clip(); ctx.fillStyle = "rgba(255,255,255,0.45)"; pass((a, x) => { if (a.hi) ctx.fillText(a.t, x, 0); }); ctx.restore();
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: JL.ink, light: JL.cream, mid: JL.steel, dark: JL.board, colour: (c) => boost(c, 0.5) }, stroke: { ink: JL.ink, light: JL.cream }, line: 0.7 })),
  sticker: painters({ line: JL.ink, lineScale: 0.5, tone: inkAs(JL.ink, (c) => boost(c, 0.5)), shadow(ctx, draw) { ctx.save(); ctx.translate(5, 8); draw(css(JL.ink, 0.35)); ctx.restore(); } }),
  /** The corner tag: a dark display with amber monospaced letters, glowing. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.56;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 2) + f * 1.4, h = f * 1.7, top = y + (fs * 1.34 - h);
    ctx.beginPath(); rounded(ctx, x, top, w, h, h * 0.18); ctx.fillStyle = "#07090b"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.save(); ctx.fillStyle = ink || css(JL.amber); if (!ink) { ctx.shadowColor = css(JL.amber, 0.8); ctx.shadowBlur = 8; } spaced(ctx, str, x + f * 0.7, top + h * 0.5 + f * 0.36, 2); ctx.restore();
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: the machine's faceplate — a rounded outline and a screw in each corner. */
  frame(ctx, env) {
    const { w, h } = env, ink = jlInk();
    ctx.save(); ctx.beginPath(); rounded(ctx, 22, 22, w - 44, h - 44, 30); ctx.strokeStyle = css(ink, 0.35); ctx.lineWidth = 2; ctx.stroke();
    for (const [x, y] of [[44, 44], [w - 44, 44], [44, h - 44], [w - 44, h - 44]]) {
      const g = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, 9); g.addColorStop(0, "#e4e8ec"); g.addColorStop(1, "#6a747e"); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#2a3036"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 5, y + 3); ctx.lineTo(x + 5, y - 3); ctx.stroke();
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 10 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.6, unit); },
  prompt: `Stickers for a designer-toy poster of jelly creatures and retro electronics — cute, glossy, precise — that read at a glance:
- one clear object per sticker (a little robot, a jellyfish, an octopus, a bee, a flower, a cassette, a joystick, a battery, a game controller), rounded and chunky; no realism, no fine detail;
- flat colour only: the main colour with lime ("green"), cobalt ("blue"), coral ("red") and cream ("white") as partners; "ink" for small dark parts;
- the app adds a thin dark line and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Retro electronics, built as simple models from a few boxes and cylinders — a synthesizer, a speaker, an arcade cabinet, a radio, a robot toy; no realism, no fine detail.
- the renderer paints faces in steel greys and blues with a thin dark line: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a deep blue-grey, and "main" the channel colour made vivid — use it for one to three parts.`,
};
jelly.elementFx = [
  { key: "jelly", name: { zh: "果冻", en: "Jelly" }, for: FX_ALL, stage: "fill",
    /** The layer as clear jelly: lit from inside, its rim deeper, bubbles in it, a glossy highlight, a little see-through. */
    paint(x, B, a, E) {
      bevelFx(0.25, 0.28, 0.014)(x, B, a, E);
      const s = Math.min(B.w, B.h);
      onLayer(x, B, region(x, B, "fxA"), "source-atop", a, (g) => {
        const hl = g.createRadialGradient(B.w * 0.45, B.h * 0.45, 0, B.w * 0.5, B.h * 0.5, Math.max(B.w, B.h) * 0.6); hl.addColorStop(0, "rgba(255,250,230,0.45)"); hl.addColorStop(1, "rgba(255,250,230,0)"); g.fillStyle = hl; g.fillRect(0, 0, B.w, B.h);
        g.strokeStyle = "rgba(255,255,255,0.6)"; g.lineWidth = Math.max(1, s * 0.006);
        for (let k = 0; k < 12; k++) { g.beginPath(); g.arc(B.w * E.R(k * 2.1 + 171), B.h * E.R(k * 2.9 + 172), s * (0.01 + E.R(k * 3.7 + 173) ** 2 * 0.05), 0, TAU); g.stroke(); }
        g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.ellipse(B.w * 0.28, B.h * 0.24, s * 0.12, s * 0.05, -0.5, 0, TAU); g.fill();
      });
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = 0.12 * a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
    } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 100 * k, t: 100 * k, r: 100 * k, b: 100 * k }),
    /** The jelly's glow, in its own colours, spilling round it. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (14 + 40 * a) * E.k, 0.9 * Math.min(1, a * 2.5), null); } },
  { key: "depth", name: { zh: "景深虚化", en: "Depth of field" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 20 * k, t: 20 * k, r: 20 * k, b: 20 * k }),
    /** The layer out of focus, as machinery behind the creature. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), pad = Math.ceil((3 + 10 * a) * E.k), soft = softened(padded(src, pad, "fxDp"), 2 + 9 * a, "fxDf");
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.globalAlpha = 1 - Math.min(1, a * 1.3); x.drawImage(src, B.x0, B.y0); x.globalAlpha = Math.min(1, a * 1.3); x.imageSmoothingEnabled = true; x.drawImage(soft, B.x0 - pad, B.y0 - pad, B.w + 2 * pad, B.h + 2 * pad); x.restore();
    } },
  { key: "tone", name: { zh: "照片青橙调", en: "Photo teal and orange" }, for: FX_PHOTO, stage: "filter",
    /** The photo graded teal and orange. */
    paint: tonesFx(() => [[0, [8, 18, 28]], [0.4, [34, 104, 132]], [0.7, [244, 132, 86]], [1, [252, 246, 228]]]) },
];
