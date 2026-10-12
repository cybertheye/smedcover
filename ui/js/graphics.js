// Fifteen more category graphics, built from the cel kit's convex pieces (boxes, prisms) with a few
// flat details projected onto them. Like the original five they are drawn around OC in a 1920x1080
// space and take the category colour.
import { INK, TAU, OC, OBJ_PAL, rgb, mixc, BLK, rot, box, prism, drawPieces, path3, circ3, rect3, tone, groundShadow, registerGraphics } from "./cel.js";

const DARK = ["#3a3a4c", "#24243a", "#111119"];
const tint = (C) => [rgb(C), rgb(mixc(C, BLK, 0.26)), rgb(mixc(C, BLK, 0.56))];
const UP = rot(Math.PI / 2, 0, 0);      // turns a prism's axis (z) upright: its front faces up
const DOWN = rot(-Math.PI / 2, 0, 0);
const ALONG = rot(0, Math.PI / 2, 0);   // lays a prism along x: its front faces right
/** Positions / turns / colours a piece. */
const P = (piece, off, o = {}) => Object.assign(piece, { off }, o.M ? { M: o.M } : null, o.pal ? { pal: o.pal } : null);

/** Draws pieces under view M with a ground shadow, then lets `details` add flat marks on top. */
function build(ctx, ch, M, pieces, { ground = 300, spread = 300, details } = {}) {
  const [cx, cy] = OC;
  if (ground) groundShadow(ctx, ch.c, cy + ground, spread);
  drawPieces(ctx, pieces, M, cx, cy, 1, OBJ_PAL, { tone: tone(ctx, rgb(ch.c, 0.55)) });
  if (!details) return;
  const mark = (pts, fill, stroke = 0, close = true) => {
    path3(ctx, pts, M, cx, cy, 1, close);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); }
  };
  details(mark);
}

function gamepad(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.42, -0.38, -0.08), [
    P(box(400, 170, 90), [0, -10, 0]),
    P(box(116, 200, 80), [-178, 66, -8], { M: rot(0, 0, 0.2) }), P(box(116, 200, 80), [178, 66, -8], { M: rot(0, 0, -0.2) }),
    P(box(70, 26, 50), [-110, -104, 0], { pal: DARK }), P(box(70, 26, 50), [110, -104, 0], { pal: DARK }),
  ], { ground: 290, spread: 320, details: (m) => {
    m(rect3(-158, -32, -62, -2, 46), INK); m(rect3(-125, -65, -95, 31, 46), INK);
    for (const [x, y] of [[110, -52], [150, -17], [70, -17], [110, 18]]) m(circ3(x, y, 46, 19, 20), A[0], 5);
    m(rect3(-22, -30, 22, -14, 46), INK);
  } });
}
function book(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.3, -0.62, 0.1), [
    P(box(310, 410, 14), [0, 0, -36], { pal: A }), P(box(292, 392, 58), [8, 0, 0]),
    P(box(16, 410, 86), [-155, 0, 0], { pal: A }), P(box(310, 410, 14), [0, 0, 36], { pal: A }),
  ], { ground: 300, spread: 290, details: (m) => {
    m(rect3(-95, -135, 105, -75, 44), "#fff", 5); m(rect3(-95, -45, 40, -25, 44), INK); m(rect3(-95, 120, 105, 150, 44), INK);
  } });
}
function mic(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.22, -0.5, 0.16), [
    P(prism(18, 78, 34, [0, 0, 0], 52), [0, -232, 0], { M: UP, pal: DARK }), P(prism(18, 96, 190), [0, -120, 0], { M: UP, pal: DARK }),
    P(prism(18, 102, 30), [0, -12, 0], { M: UP, pal: A }), P(prism(18, 62, 120), [0, 62, 0], { M: UP }),
    P(box(26, 96, 26), [0, 168, 0], { pal: DARK }), P(prism(22, 132, 26), [0, 228, 0], { M: UP, pal: DARK }),
  ], { ground: 300, spread: 260 });
}
function headphones(ctx, t, ch) {
  const A = tint(ch.c), band = [];
  for (let i = 0; i < 11; i++) { const a = Math.PI * (1.04 + (0.92 * i) / 10); band.push(P(box(74, 28, 64), [Math.cos(a) * 196, Math.sin(a) * 196 - 20, 0], { M: rot(0, 0, a + Math.PI / 2), pal: A })); }
  build(ctx, ch, rot(-0.12, -0.6, 0), [
    ...band,
    P(prism(20, 98, 74), [-212, 70, 0], { M: ALONG, pal: DARK }), P(prism(20, 98, 74), [212, 70, 0], { M: ALONG, pal: DARK }),
    P(prism(20, 82, 30), [-160, 70, 0], { M: ALONG }), P(prism(20, 82, 30), [160, 70, 0], { M: ALONG }),
  ], { ground: 300, spread: 300 });
}
function monitor(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.18, -0.5, 0.03), [
    P(box(480, 300, 36), [0, -60, 0], { pal: DARK }), P(box(54, 90, 30), [0, 130, -8]), P(box(230, 22, 130), [0, 186, 0]),
  ], { ground: 300, spread: 300, details: (m) => {
    m(rect3(-218, -190, 218, 70, 19), A[1], 5);
    [[-190, -160, 60], [-190, -125, 150], [-150, -90, 110], [-150, -55, 190], [-190, -20, 90], [-190, 15, 140]].forEach(([x, y, w], i) => m(rect3(x, y, x + w, y + 16, 19), i % 3 === 1 ? A[0] : "#fff"));
  } });
}
function phone(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.2, -0.55, 0.14), [P(box(240, 460, 32), [0, 0, 0])], { ground: 300, spread: 240, details: (m) => {
    m(rect3(-102, -206, 102, 206, 17), INK); m(rect3(-90, -170, 90, 170, 17), A[1]); m(rect3(-34, -200, 34, -184, 17), "#fff");
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) m(rect3(-72 + c * 54, -140 + r * 62, -36 + c * 54, -104 + r * 62, 17), (r + c) % 3 ? "#fff" : A[0], 4);
    m(rect3(-40, 180, 40, 190, 17), "#fff");
  } });
}
function clapper(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.2, -0.45, -0.04), [
    P(box(420, 270, 30), [0, 62, 0], { pal: DARK }), P(box(420, 58, 34), [0, -104, 0]),
    P(box(420, 58, 34), [-14, -176, 0], { M: rot(0, 0, -0.26) }),
  ], { ground: 300, spread: 300, details: (m) => {
    for (let k = 0; k < 5; k++) { const x = -190 + k * 88; m([[x, -131, 18], [x + 44, -131, 18], [x + 22, -77, 18], [x - 22, -77, 18]], INK); }
    m(rect3(-180, -20, 180, -8, 16), "#fff"); m(rect3(-180, 40, 180, 52, 16), "#fff"); m(rect3(-60, -20, -48, 170, 16), "#fff");
    m(circ3(120, 115, 16, 34, 24), A[0], 5);
  } });
}
function pot(ctx, t, ch) {
  const A = tint(ch.c), [cx, cy] = OC;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const x of [-70, 0, 70]) for (const [w, col] of [[18, INK], [8, "#fff"]]) {
    ctx.beginPath(); ctx.moveTo(cx + x, cy - 170); ctx.bezierCurveTo(cx + x + 34, cy - 210, cx + x - 34, cy - 250, cx + x, cy - 292);
    ctx.lineWidth = w; ctx.strokeStyle = col; ctx.stroke();
  }
  build(ctx, ch, rot(-0.4, -0.4, 0), [
    P(box(74, 30, 54), [-212, -20, 0], { pal: DARK }), P(box(74, 30, 54), [212, -20, 0], { pal: DARK }),
    P(prism(22, 176, 200), [0, 70, 0], { M: UP }), P(prism(22, 190, 28), [0, -38, 0], { M: UP, pal: A }),
    P(prism(22, 168, 22, [0, 0, 0], 120), [0, -64, 0], { M: UP }), P(prism(14, 36, 40), [0, -96, 0], { M: UP, pal: A }),
  ], { ground: 290, spread: 300 });
}
function suitcase(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.2, -0.6, 0.06), [
    P(box(28, 80, 22), [-62, -140, 0], { pal: DARK }), P(box(28, 80, 22), [62, -140, 0], { pal: DARK }), P(box(156, 26, 24), [0, -186, 0], { pal: DARK }),
    P(box(390, 310, 136), [0, 45, 0], { pal: A }),
    P(prism(14, 28, 26), [-135, 214, 40], { pal: DARK }), P(prism(14, 28, 26), [135, 214, 40], { pal: DARK }),
  ], { ground: 300, spread: 300, details: (m) => {
    m(rect3(-118, -110, -88, 200, 69), "#fff", 5); m(rect3(88, -110, 118, 200, 69), "#fff", 5);
    m(rect3(-40, -20, 40, 30, 69), "#fff", 5);
  } });
}
function barbell(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.28, -0.55, -0.24), [
    P(prism(12, 22, 330), [0, 0, 0], { M: ALONG }),
    P(prism(18, 116, 52), [-146, 0, 0], { M: ALONG, pal: A }), P(prism(18, 116, 52), [146, 0, 0], { M: ALONG, pal: A }),
    P(prism(18, 84, 46), [-200, 0, 0], { M: ALONG, pal: DARK }), P(prism(18, 84, 46), [200, 0, 0], { M: ALONG, pal: DARK }),
  ], { ground: 290, spread: 300 });
}
function rocket(ctx, t, ch) {
  const A = tint(ch.c), FIRE = ["#ffd60a", "#ff8a00", "#c2410c"];
  build(ctx, ch, rot(-0.15, -0.45, 0.48), [
    P(prism(12, 46, 120, [0, 0, 0], 4), [0, 246, 0], { M: DOWN, pal: FIRE }), P(prism(14, 62, 40), [0, 170, 0], { M: UP, pal: DARK }),
    P(box(92, 120, 20), [-124, 118, 0], { pal: A }), P(box(92, 120, 20), [124, 118, 0], { pal: A }), P(box(20, 120, 92), [0, 118, 100], { pal: A }),
    P(prism(18, 92, 270), [0, 20, 0], { M: UP }), P(prism(18, 92, 160, [0, 0, 0], 5), [0, -195, 0], { M: UP, pal: A }),
  ], { ground: 0, details: (m) => { m(circ3(0, -30, 94, 38, 24), A[0], 7); m(circ3(0, -30, 95, 20, 20), "#fff"); } });
}
function house(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.3, -0.62, 0), [
    P(box(54, 120, 54), [96, -196, -50], { pal: DARK }),
    P(box(350, 230, 290), [0, 95, 0]), P(prism(3, 246, 330), [0, -143, 0], { M: rot(0, 0, -Math.PI / 2), pal: A }),
  ], { ground: 300, spread: 310, details: (m) => {
    m(rect3(-52, 60, 32, 210, 146), A[0], 6); m(circ3(16, 140, 147, 8, 12), INK);
    m(rect3(70, 30, 150, 110, 146), INK); m(rect3(78, 38, 106, 102, 146), "#fff"); m(rect3(114, 38, 142, 102, 146), "#fff");
  } });
}
function car(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.22, -0.6, 0), [
    P(prism(18, 60, 44), [-150, 122, -98], { pal: DARK }), P(prism(18, 60, 44), [150, 122, -98], { pal: DARK }),
    P(box(480, 116, 200), [0, 62, 0], { pal: A }), P(box(262, 104, 180), [-24, -48, 0]),
    P(prism(18, 60, 44), [-150, 122, 98], { pal: DARK }), P(prism(18, 60, 44), [150, 122, 98], { pal: DARK }),
  ], { ground: 300, spread: 330, details: (m) => {
    m(rect3(-138, -86, -34, -10, 91), INK); m(rect3(-14, -86, 92, -10, 91), INK);
    m(rect3(196, 30, 236, 54, 101), "#fff", 5); m(rect3(-70, 44, -30, 56, 101), INK);
    m(circ3(-150, 122, 121, 24, 16), "#cfd5e4", 5); m(circ3(150, 122, 121, 24, 16), "#cfd5e4", 5);
  } });
}
function chart(ctx, t, ch) {
  const A = tint(ch.c), M = rot(-0.3, -0.55, 0), hs = [120, 210, 160, 320];
  build(ctx, ch, M, [
    P(box(540, 22, 150), [0, 171, 0], { pal: DARK }),
    ...hs.map((h, i) => P(box(84, h, 84), [-186 + i * 124, 160 - h / 2, 0], { pal: i % 2 ? OBJ_PAL : A })),
  ], { ground: 300, spread: 330 });
  const [cx, cy] = OC, line = hs.map((h, i) => [-186 + i * 124, 160 - h - 70, 0]);
  for (const [w, col] of [[20, INK], [9, "#fff"]]) { path3(ctx, line, M, cx, cy, 1, false); ctx.lineWidth = w; ctx.strokeStyle = col; ctx.lineJoin = ctx.lineCap = "round"; ctx.stroke(); }
  path3(ctx, [[150, -262, 0], [222, -252, 0], [198, -186, 0]], M, cx, cy, 1); ctx.fillStyle = "#fff"; ctx.fill(); ctx.lineWidth = 7; ctx.strokeStyle = INK; ctx.stroke();
}
function pencil(ctx, t, ch) {
  const A = tint(ch.c);
  build(ctx, ch, rot(-0.3, -0.35, -0.62), [
    P(prism(6, 58, 56), [-252, 0, 0], { M: ALONG, pal: ["#ff9db8", "#e56a8c", "#8f2f4d"] }), P(prism(6, 64, 44), [-202, 0, 0], { M: ALONG, pal: DARK }),
    P(prism(6, 60, 340), [-10, 0, 0], { M: ALONG, pal: A }),
    P(prism(6, 60, 96, [0, 0, 0], 20), [208, 0, 0], { M: ALONG }), P(prism(6, 20, 40, [0, 0, 0], 2), [276, 0, 0], { M: ALONG, pal: DARK }),
  ], { ground: 0 });
}

registerGraphics([
  { id: "gamepad", draw: gamepad, at: 0, fit: 1, name: { zh: "手柄", en: "Gamepad" } },
  { id: "book", draw: book, at: 0, fit: 1, name: { zh: "书", en: "Book" } },
  { id: "mic", draw: mic, at: 0, fit: 1, name: { zh: "麦克风", en: "Microphone" } },
  { id: "headphones", draw: headphones, at: 0, fit: 1, name: { zh: "耳机", en: "Headphones" } },
  { id: "monitor", draw: monitor, at: 0, fit: 1, name: { zh: "显示器", en: "Monitor" } },
  { id: "phone", draw: phone, at: 0, fit: 1, name: { zh: "手机", en: "Phone" } },
  { id: "clapper", draw: clapper, at: 0, fit: 1, name: { zh: "场记板", en: "Clapperboard" } },
  { id: "pot", draw: pot, at: 0, fit: 1, name: { zh: "汤锅", en: "Cooking pot" } },
  { id: "suitcase", draw: suitcase, at: 0, fit: 1, name: { zh: "行李箱", en: "Suitcase" } },
  { id: "barbell", draw: barbell, at: 0, fit: 1, name: { zh: "杠铃", en: "Barbell" } },
  { id: "rocket", draw: rocket, at: 0, fit: 0.9, name: { zh: "火箭", en: "Rocket" } },
  { id: "house", draw: house, at: 0, fit: 0.8, name: { zh: "房子", en: "House" } },
  { id: "car", draw: car, at: 0, fit: 1, name: { zh: "汽车", en: "Car" } },
  { id: "chart", draw: chart, at: 0, fit: 0.9, name: { zh: "柱状图", en: "Bar chart" } },
  { id: "pencil", draw: pencil, at: 0, fit: 1, name: { zh: "铅笔", en: "Pencil" } },
]);
