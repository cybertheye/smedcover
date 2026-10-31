// Fifteen more category graphics, built from the cel kit's convex pieces (boxes, prisms) with a few
// flat details projected onto them. Like the original five they are drawn around OC in a 1920x1080
// space and take the category colour.
import { INK, TAU, OC, OBJ_PAL, rgb, mixc, BLK, rot, box, prism, octa, drawPieces, path3, circ3, rect3, tone, groundShadow, ap, pj, registerGraphics } from "./cel.js";

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
/** The convex hull of 2D points (Andrew's monotone chain). */
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]), turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => { const h = []; for (const q of list) { while (h.length > 1 && turn(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...half(p), ...half(p.reverse())];
}
/** A piece turned by each of `turns` in order (about its own centre), then moved to `at`. */
const turned = (pc, turns, at, pal) => ({ v: pc.v.map((q) => { for (const T of turns) q = ap(T, q); return [q[0] + at[0], q[1] + at[1], q[2] + at[2]]; }), f: pc.f, ...(pal ? { pal } : {}) });
const ROLL = rot(0, 0, Math.PI / 2);   // lays an upright piece on its side, along x

// An almost finished robot of toy bricks, its right arm still on the ground among loose bricks. The cel kit sorts whole
// pieces by their centres, which a brick's studs would lose to the brick under them, so each brick is drawn before its
// studs (flat cylinders, one outline each), the robot from its feet up, and the loose bricks and the robot by depth.
function robot(ctx, t, ch) {
  const A = tint(ch.c), M = rot(-0.42, -0.6, 0), [cx, cy] = OC, U = 44, G = 4.3 * U, tn = tone(ctx, rgb(ch.c, 0.55));
  const draw = (pieces) => drawPieces(ctx, pieces, M, cx, cy, 1, OBJ_PAL, { tone: tn });
  const depth = (q) => ap(M, q)[2], at2 = (q) => pj(ap(M, q), cx, cy);
  const shape = (pts, fill, lw = 4) => {
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.stroke();
  };
  // studs standing on a surface at height y, at the points given (x, z), back ones first
  const studs = (pts, y, pal, r = 0.3 * U, h = 0.2 * U) => {
    for (const [x, z] of [...pts].sort((a, b) => depth([a[0], y, a[1]]) - depth([b[0], y, b[1]]))) {
      const ring = (yy) => Array.from({ length: 24 }, (_, i) => at2([x + Math.cos((i / 24) * TAU) * r, yy, z + Math.sin((i / 24) * TAU) * r]));
      const top = ring(y - h);
      shape(hull([...ring(y), ...top]), pal[1]); shape(top, pal[0]);
    }
  };
  const grid = (cols, rows, [x, z], yaw = 0) => {
    const R = rot(0, yaw, 0), out = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) { const q = ap(R, [(i - (cols - 1) / 2) * U, 0, (j - (rows - 1) / 2) * U]); out.push([x + q[0], z + q[2]]); }
    return out;
  };
  const mark = (pts, fill, stroke = 0) => {
    path3(ctx, pts, M, cx, cy, 1);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.stroke(); }
  };
  // a loose brick lying on the ground: cols × rows studs, turned by yaw
  const loose = (cols, rows, [x, z], yaw, pal) => ({ z: depth([x, G, z]), draw: () => {
    draw([turned(box(cols * U, 1.2 * U, rows * U), [rot(0, yaw, 0)], [x, G - 0.6 * U, z], pal)]);
    studs(grid(cols, rows, [x, z], yaw), G - 1.2 * U, pal);
  } });
  // a 1 × 2 put on the left half of a 2 × 2: the studs left bare are on the side facing us, so drawn after it
  const pile = ([x, z], yaw) => {
    const R = rot(0, yaw, 0), on = (lx, lz) => { const q = ap(R, [lx, 0, lz]); return [x + q[0], z + q[2]]; }, [ox, oz] = on(-0.5 * U, 0);
    return { z: depth([x, G, z]), draw: () => {
      draw([turned(box(2 * U, 1.2 * U, 2 * U), [R], [x, G - 0.6 * U, z], OBJ_PAL)]);
      draw([turned(box(U, 1.2 * U, 2 * U), [R], [ox, G - 1.8 * U, oz], DARK)]);
      studs([on(0.5 * U, -0.5 * U), on(0.5 * U, 0.5 * U)], G - 1.2 * U, OBJ_PAL);
      studs(grid(1, 2, [ox, oz], yaw), G - 2.4 * U, DARK);
    } };
  };
  // the arm still to go on, lying on its side: its pincer at one end, the hole for the robot's peg up
  const arm = (x, z, yaw) => ({ z: depth([x, G, z]), draw: () => {
    const turns = [ROLL, rot(0, yaw, 0)], c = [x, G - 0.5 * U, z];
    draw([turned(box(U, 2 * U, U), turns, c), turned(box(1.1 * U, 0.3 * U, 1.1 * U, [0, 1.15 * U, 0]), turns, c, DARK),
      turned(box(0.3 * U, 0.5 * U, 1.1 * U, [-0.35 * U, 1.55 * U, 0]), turns, c, DARK), turned(box(0.3 * U, 0.5 * U, 1.1 * U, [0.35 * U, 1.55 * U, 0]), turns, c, DARK)]);
    // the hole the robot's peg goes into
    const j = ap(rot(0, yaw, 0), ap(ROLL, [-0.5 * U, -0.5 * U, 0]));
    studs([[c[0] + j[0], c[2] + j[2]]], c[1] + j[1], [INK, INK], 0.28 * U, 0.02 * U);
  } });
  const body = { z: depth([0, G, 0]), draw: () => {
    const top = G - 6 * U;   // the torso's top
    // feet, a row of studs showing in front of the legs
    draw([P(box(2 * U, 0.8 * U, 3 * U), [-U, G - 0.4 * U, 0.5 * U], { pal: DARK }), P(box(2 * U, 0.8 * U, 3 * U), [U, G - 0.4 * U, 0.5 * U], { pal: DARK })]);
    studs([[-1.5 * U, 1.5 * U], [-0.5 * U, 1.5 * U], [0.5 * U, 1.5 * U], [1.5 * U, 1.5 * U]], G - 0.8 * U, DARK);
    draw([P(box(1.7 * U, 2.4 * U, 2 * U), [-U, G - 2 * U, 0]), P(box(1.7 * U, 2.4 * U, 2 * U), [U, G - 2 * U, 0])]);
    draw([P(box(4 * U, 0.4 * U, 2 * U), [0, G - 3.4 * U, 0], { pal: DARK })]);
    // the left arm, on, behind the torso; the torso; the right arm's peg, bare
    draw([P(box(U, 2 * U, U), [-2.6 * U, top + 1.15 * U, 0]), P(box(1.1 * U, 0.3 * U, 1.1 * U), [-2.6 * U, top + 2.3 * U, 0], { pal: DARK }),
      P(box(0.3 * U, 0.5 * U, 1.1 * U), [-2.95 * U, top + 2.7 * U, 0], { pal: DARK }), P(box(0.3 * U, 0.5 * U, 1.1 * U), [-2.25 * U, top + 2.7 * U, 0], { pal: DARK }),
      P(prism(14, 0.42 * U, 0.3 * U), [-2.15 * U, top + 0.6 * U, 0], { M: ALONG, pal: DARK })]);
    draw([P(box(4 * U, 2.4 * U, 2 * U), [0, top + 1.2 * U, 0], { pal: A })]);
    draw([P(prism(14, 0.26 * U, 0.5 * U), [2.25 * U, top + 0.6 * U, 0], { M: ALONG, pal: DARK })]);
    mark(rect3(-1.55 * U, top + 0.45 * U, 0.25 * U, top + 1.55 * U, U + 1), "#fff", 5);
    mark(rect3(-1.3 * U, top + 0.75 * U, -0.1 * U, top + 0.9 * U, U + 1), INK); mark(rect3(-1.3 * U, top + 1.1 * U, -0.5 * U, top + 1.25 * U, U + 1), INK);
    mark(circ3(0.95 * U, top + 0.75 * U, U + 1, 0.24 * U, 20), "#fff", 5); mark(circ3(0.95 * U, top + 1.35 * U, U + 1, 0.24 * U, 20), INK, 5);
    studs([[-1.5 * U, -0.5 * U], [-1.5 * U, 0.5 * U], [1.5 * U, -0.5 * U], [1.5 * U, 0.5 * U]], top, A);
    // neck, head and ears, its face, studs and antenna
    draw([P(box(1.2 * U, 0.4 * U, 1.2 * U), [0, top - 0.2 * U, 0], { pal: DARK })]);
    const head = top - 0.4 * U - 2 * U;
    draw([P(box(2.6 * U, 2 * U, 2 * U), [0, head + U, 0]),
      P(prism(14, 0.4 * U, 0.3 * U), [-1.45 * U, head + U, 0], { M: ALONG, pal: A }), P(prism(14, 0.4 * U, 0.3 * U), [1.45 * U, head + U, 0], { M: ALONG, pal: A })]);
    mark(rect3(-1.05 * U, head + 0.45 * U, 1.05 * U, head + 1.2 * U, U + 1), INK);
    mark(circ3(-0.5 * U, head + 0.82 * U, U + 2, 0.2 * U, 20), A[0]); mark(circ3(0.5 * U, head + 0.82 * U, U + 2, 0.2 * U, 20), A[0]);
    for (const x of [-0.4, 0, 0.4]) mark(rect3((x - 0.08) * U, head + 1.4 * U, (x + 0.08) * U, head + 1.7 * U, U + 1), INK);
    studs([[-0.6 * U, 0.5 * U], [0.6 * U, 0.5 * U], [-0.6 * U, -0.5 * U], [0.6 * U, -0.5 * U]], head, OBJ_PAL);
    draw([P(prism(8, 0.08 * U, 0.9 * U), [0, head - 0.45 * U, 0], { M: UP, pal: DARK })]);
    draw([P(octa(0.24 * U, 0.3 * U, 0.24 * U), [0, head - 1.05 * U, 0], { pal: A })]);
  } };
  groundShadow(ctx, ch.c, cy + 232, 270);
  for (const g of [body, arm(4.7 * U, 1.9 * U, 0.45), loose(2, 4, [-2.9 * U, 3.8 * U], 0.35, A), pile([4 * U, -2.3 * U], -0.3)].sort((a, b) => a.z - b.z)) g.draw();
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
  { id: "robot", draw: robot, at: 0, fit: 1, name: { zh: "积木机器人", en: "Brick robot" } },
]);
