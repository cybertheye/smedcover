// Cel-shaded drawing kit: flat fills, heavy ink lines, screentone.
// Small math/colour helpers, a painter's-algorithm 3D renderer for convex pieces,
// 2D helpers, and the five built-in category graphics.

export const INK = "#07070c";
const H = 1080,
  TAU = Math.PI * 2;
// Font stacks used on the canvas; the app overwrites these from the active profile.
export const fonts = {
  cn: '"Noto Sans SC", sans-serif',
  en: '"Bebas Neue", sans-serif',
  mono: '"JetBrains Mono", monospace',
};
// cover: graphics drop their HUD notes so they can sit across two backgrounds.
// labels / stamp: optional texts some graphics can carry (set per category).
const celOpts = { cover: true, labels: [], stamp: "" };

// ---------- math / easing
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eOut3 = (x) => 1 - Math.pow(1 - x, 3);
const eOutExpo = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const eInOut = (x) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const eInOut5 = (x) =>
  x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
const eBack = (x) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];
const BLK = [0, 0, 0],
  WHT = [255, 255, 255];

// ---------- tiny 3D for cel objects (x right, y down, z toward viewer)
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const mul3 = (A, B) => {
  const o = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      o[r * 3 + c] =
        A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return o;
};
const ap = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
function rot(ax, ay, az) {
  // yaw (Y) then pitch (X) then roll (Z)
  const cx = Math.cos(ax),
    sx = Math.sin(ax),
    cy = Math.cos(ay),
    sy = Math.sin(ay),
    cz = Math.cos(az),
    sz = Math.sin(az);
  return mul3(
    [cz, -sz, 0, sz, cz, 0, 0, 0, 1],
    mul3([1, 0, 0, 0, cx, -sx, 0, sx, cx], [cy, 0, sy, 0, 1, 0, -sy, 0, cy]),
  );
}
const FOC = 1500;
const pj = (p, cx, cy) => {
  const s = FOC / (FOC - p[2]);
  return [cx + p[0] * s, cy + p[1] * s];
};
const LIGHT = norm3([-0.5, -0.72, 0.48]);

function box(w, h, d, o = [0, 0, 0]) {
  const x = w / 2,
    y = h / 2,
    z = d / 2;
  return {
    v: [
      [-x, -y, -z],
      [x, -y, -z],
      [x, y, -z],
      [-x, y, -z],
      [-x, -y, z],
      [x, -y, z],
      [x, y, z],
      [-x, y, z],
    ].map((p) => [p[0] + o[0], p[1] + o[1], p[2] + o[2]]),
    f: [
      [0, 1, 2, 3],
      [4, 5, 6, 7],
      [0, 1, 5, 4],
      [2, 3, 7, 6],
      [1, 2, 6, 5],
      [0, 3, 7, 4],
    ],
  };
}
function prism(n, r, d, o = [0, 0, 0], rf = r) {
  // axis along z, front radius rf
  const v = [],
    f = [[], []];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    v.push([Math.cos(a) * rf + o[0], Math.sin(a) * rf + o[1], d / 2 + o[2]]);
  }
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    v.push([Math.cos(a) * r + o[0], Math.sin(a) * r + o[1], -d / 2 + o[2]]);
  }
  for (let i = 0; i < n; i++) {
    f[0].push(i);
    f[1].push(n + i);
    f.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
  }
  return { v, f };
}
function octa(rx, ry, rz) {
  const v = [
      [0, -ry, 0],
      [0, ry, 0],
      [rx, 0, 0],
      [0, 0, rz],
      [-rx, 0, 0],
      [0, 0, -rz],
    ],
    f = [];
  for (let i = 0; i < 4; i++) {
    const a = 2 + i,
      b = 2 + ((i + 1) % 4);
    f.push([0, a, b], [1, a, b]);
  }
  return { v, f };
}
// Painter's-algorithm cel renderer: 3 flat tone bands, screentone on the
// shadow band, heavy ink outline on every face.
function drawPieces(ctx, pieces, M, cx, cy, sc, pal, o = {}) {
  const lw = o.lw || 6,
    P = [];
  for (const pc of pieces) {
    const tv = pc.v.map((v) => {
      let p = v;
      if (pc.M) p = ap(pc.M, p);
      if (pc.off) p = [p[0] + pc.off[0], p[1] + pc.off[1], p[2] + pc.off[2]];
      p = ap(M, p);
      return [p[0] * sc, p[1] * sc, p[2] * sc];
    });
    const c = [0, 0, 0];
    for (const p of tv) {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    P.push({ pc, tv, c: c.map((x) => x / tv.length) });
  }
  P.sort((a, b) => a.c[2] - b.c[2]);
  ctx.lineJoin = "round";
  for (const { pc, tv, c } of P) {
    const faces = [];
    for (const f of pc.f) {
      let n = norm3(cross3(sub3(tv[f[1]], tv[f[0]]), sub3(tv[f[2]], tv[f[0]])));
      const fc = [0, 0, 0];
      for (const i of f) {
        fc[0] += tv[i][0];
        fc[1] += tv[i][1];
        fc[2] += tv[i][2];
      }
      fc[0] /= f.length;
      fc[1] /= f.length;
      fc[2] /= f.length;
      if (dot3(n, sub3(fc, c)) < 0) n = [-n[0], -n[1], -n[2]];
      if (dot3(n, [-fc[0], -fc[1], FOC - fc[2]]) <= 0) continue;
      faces.push({ f, n, z: fc[2] });
    }
    faces.sort((a, b) => a.z - b.z);
    const p2 = pc.pal || pal;
    for (const fa of faces) {
      const l = dot3(fa.n, LIGHT),
        band = l > 0.45 ? 0 : l > -0.05 ? 1 : 2;
      ctx.beginPath();
      fa.f.forEach((i, k) => {
        const q = pj(tv[i], cx, cy);
        k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
      });
      ctx.closePath();
      ctx.fillStyle = p2[band];
      ctx.fill();
      if (band === 2 && o.tone) {
        ctx.fillStyle = o.tone;
        ctx.fill();
      }
      ctx.lineWidth = lw;
      ctx.strokeStyle = INK;
      ctx.stroke();
    }
  }
}
// path of 3D points (already in object space) -> canvas path
function path3(ctx, pts, M, cx, cy, sc, close = true) {
  ctx.beginPath();
  pts.forEach((p, k) => {
    const r = ap(M, p),
      q = pj([r[0] * sc, r[1] * sc, r[2] * sc], cx, cy);
    k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
  });
  if (close) ctx.closePath();
}
const circ3 = (x, y, z, r, n = 32) =>
  Array.from({ length: n }, (_, i) => [
    x + Math.cos((i / n) * TAU) * r,
    y + Math.sin((i / n) * TAU) * r,
    z,
  ]);
const rect3 = (x0, y0, x1, y1, z) => [
  [x0, y0, z],
  [x1, y0, z],
  [x1, y1, z],
  [x0, y1, z],
];

// ---------- 2D helpers
const tones = new Map();
function tone(ctx, col, size = 12, r = 2.4) {
  const k = col + size + r;
  if (!tones.has(k)) {
    const c = document.createElement("canvas");
    // drawn at 4x and scaled back down, so the dots stay crisp on hi-res cover exports
    c.width = c.height = size * 4;
    const x = c.getContext("2d");
    x.scale(4, 4);
    x.fillStyle = col;
    for (const [px, py] of [
      [0, 0],
      [size, 0],
      [0, size],
      [size, size],
      [size / 2, size / 2],
    ]) {
      x.beginPath();
      x.arc(px, py, r, 0, TAU);
      x.fill();
    }
    const pat = ctx.createPattern(c, "repeat");
    pat.setTransform(new DOMMatrix().scale(0.25));
    tones.set(k, pat);
  }
  return tones.get(k);
}
function toneField(ctx, x0, y0, x1, y1, pitch, col, fn) {
  // screentone gradient, 45° lattice
  ctx.fillStyle = col;
  ctx.beginPath();
  let row = 0;
  for (let y = y0; y < y1; y += pitch * 0.5, row++)
    for (let x = x0 + (row % 2) * pitch * 0.5; x < x1; x += pitch) {
      const r = clamp(fn(x, y)) * pitch * 0.5;
      if (r > 0.7) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TAU);
      }
    }
  ctx.fill();
}
function spaced(ctx, str, x, y, sp) {
  let cx = x;
  for (const ch of str) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + sp;
  }
  return cx - x - sp;
}
function spacedW(ctx, str, sp) {
  let w = 0;
  for (const ch of str) w += ctx.measureText(ch).width + sp;
  return w - sp;
}
function para(ctx, x, y, w, h, sk) {
  ctx.beginPath();
  ctx.moveTo(x - sk, y);
  ctx.lineTo(x + w - sk, y);
  ctx.lineTo(x + w + sk, y + h);
  ctx.lineTo(x + sk, y + h);
  ctx.closePath();
}
function brackets(ctx, x0, y0, x1, y1, len, col, lw) {
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (const [x, y, dx, dy] of [
    [x0, y0, 1, 1],
    [x1, y0, -1, 1],
    [x1, y1, -1, -1],
    [x0, y1, 1, -1],
  ]) {
    ctx.moveTo(x + dx * len, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * len);
  }
  ctx.stroke();
}
const OBJ_PAL = ["#ffffff", "#cfd5e4", "#191926"];

// ---------- the built-in cel graphics. Each is drawn around OC in a 1920x1080 space at a fixed
// moment (lt) of its original animation; drawGraphic() below places and scales it.
const OC = [1455, 545];
function groundShadow(ctx, C, y, rx) {
  ctx.fillStyle = rgb(mixc(C, BLK, 0.5), 0.55);
  ctx.beginPath();
  ctx.ellipse(OC[0] + 20, y, rx, rx * 0.14, 0, 0, TAU);
  ctx.fill();
}
function monoNote(ctx, str, x, y) {
  if (celOpts.cover) return;
  ctx.font = `700 26px ${fonts.mono}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(str, x, y);
}
const popAt = (lt, at = 0) =>
  lt >= at ? 1 + 0.16 * Math.exp(-(lt - at) * 9) : 1;

// camera — focus brackets locked on
function objCamera(ctx, lt, ch) {
  const [cx, cy] = OC,
    sc = 1.08 * popAt(lt);
  const M = rot(
    -0.3,
    -0.55 + 0.22 * Math.sin(lt * 1.7 + 0.6),
    0.05 * Math.sin(lt * 1.3),
  );
  groundShadow(ctx, ch.c, cy + 300, 330);
  const lens = prism(18, 128, 120, [40, 25, 135]),
    ring = prism(18, 104, 56, [40, 25, 222]);
  lens.pal = ring.pal = ["#3a3a4c", "#24243a", "#111119"];
  drawPieces(
    ctx,
    [
      box(440, 260, 150, [0, 20, 0]),
      box(170, 62, 110, [-40, -141, 0]),
      box(60, 26, 60, [152, -123, 0]),
      box(84, 260, 46, [-176, 20, 98]),
      lens,
      ring,
    ],
    M,
    cx,
    cy,
    sc,
    OBJ_PAL,
    { tone: tone(ctx, rgb(ch.c, 0.55)) },
  );
  // lens glass
  path3(ctx, circ3(40, 25, 251, 80), M, cx, cy, sc);
  ctx.fillStyle = INK;
  ctx.fill();
  path3(ctx, circ3(40, 25, 252, 52), M, cx, cy, sc);
  ctx.fillStyle = rgb(mixc(ch.c, BLK, 0.35));
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  path3(ctx, circ3(18, 3, 253, 15, 16), M, cx, cy, sc);
  ctx.fillStyle = "#fff";
  ctx.fill();
  path3(ctx, rect3(-190, -78, -110, -44, 76), M, cx, cy, sc);
  ctx.fillStyle = INK;
  ctx.fill();
  // focus brackets tighten, lock, then the shutter fires on beat 3
  const fp = eOut3(prog(lt, 0.25, 0.95)),
    hs = lerp(430, 330, fp),
    locked = lt >= 0.95;
  brackets(
    ctx,
    cx - hs,
    cy - hs * 0.8,
    cx + hs,
    cy + hs * 0.8,
    70,
    INK,
    locked ? 12 : 8,
  );
  if (locked)
    brackets(
      ctx,
      cx - hs,
      cy - hs * 0.8,
      cx + hs,
      cy + hs * 0.8,
      70,
      "#fff",
      4,
    );
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy);
  ctx.lineTo(cx + 26, cy);
  ctx.moveTo(cx, cy - 26);
  ctx.lineTo(cx, cy + 26);
  ctx.stroke();
  if (!celOpts.cover && Math.floor(Math.max(lt, 0) * 4) % 2 === 0) {
    ctx.fillStyle = "#ff2e3f";
    ctx.beginPath();
    ctx.arc(1168, 196, 13, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  monoNote(ctx, "REC", 1194, 206);
  monoNote(ctx, "1/250   F1.8   ISO 400", 1150, 1012);
  // sample meter
  for (let k = 0; k < 14 && !celOpts.cover; k++) {
    const h = 18 + hash(k * 5.3 + Math.floor(Math.max(lt, 0) * 12)) * 70;
    ctx.fillStyle = INK;
    ctx.fillRect(1640 + k * 16, 1012 - h, 10, h);
  }
  const fl = prog(lt, 1.0, 1.28);
  if (lt >= 1.0 && fl < 1) {
    ctx.fillStyle = rgb(WHT, (1 - fl) * 0.9);
    ctx.fillRect(900, 0, 1100, H);
  }
}

// print — a developed photo print over tray ripples
function objDarkroom(ctx, lt, ch) {
  const [cx, cy] = OC,
    C = ch.c,
    sc = 1.02 * popAt(lt);
  // drying line
  if (!celOpts.cover) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(300, 27);
  ctx.lineTo(980, 150);
  ctx.quadraticCurveTo(1450, 235, 1930, 120);
  ctx.lineTo(2600, -41);
  ctx.stroke();
  [
    [0.17, -1],
    [0.86, 1],
  ].forEach(([u, sgn], k) => {
    const x = lerp(980, 1930, u),
      y = (1 - u) * (1 - u) * 150 + 2 * u * (1 - u) * 235 + u * u * 120;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(0.1 * Math.sin(lt * 2.2 + k * 2) + sgn * 0.05);
    ctx.fillStyle = INK;
    ctx.fillRect(-7, -12, 14, 30);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.fillRect(-52, 14, 104, 128);
    ctx.strokeRect(-52, 14, 104, 128);
    ctx.fillStyle = k ? INK : rgb(mixc(C, BLK, 0.45));
    ctx.fillRect(-40, 26, 80, 84);
    ctx.restore();
  });
  }
  // tray ripples
  for (let k = 0; k < 3; k++) {
    const u = (Math.max(lt, 0) * 0.55 + k / 3) % 1;
    ctx.strokeStyle = rgb(mixc(C, BLK, 0.55), 1 - u);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(
      cx + 10,
      cy + 345,
      120 + u * 300,
      (120 + u * 300) * 0.15,
      0,
      0,
      TAU,
    );
    ctx.stroke();
  }
  const M = rot(
    -0.12 + 0.04 * Math.sin(lt * 2),
    -0.3 + 0.36 * Math.sin(lt * 1.4 + 0.4),
    -0.07,
  );
  drawPieces(ctx, [box(420, 540, 20)], M, cx, cy, sc, OBJ_PAL, {
    tone: tone(ctx, rgb(C, 0.55)),
  });
  // the image fades up out of blank paper
  const dv = eInOut(prog(lt, 0.1, 1.45)),
    z = 11;
  path3(ctx, rect3(-175, -235, 175, 150, z), M, cx, cy, sc);
  ctx.fillStyle = rgb(mixc(WHT, mixc(C, BLK, 0.12), dv));
  ctx.fill();
  ctx.save();
  ctx.clip();
  path3(ctx, circ3(55, -90, z, 84, 36), M, cx, cy, sc);
  ctx.fillStyle = rgb(WHT, dv);
  ctx.fill();
  path3(
    ctx,
    [
      [-175, 70, z],
      [-60, 40, z],
      [40, 78, z],
      [175, 48, z],
      [175, 150, z],
      [-175, 150, z],
    ],
    M,
    cx,
    cy,
    sc,
  );
  ctx.fillStyle = rgb([7, 7, 12], dv);
  ctx.fill();
  path3(
    ctx,
    [
      [-108, 80, z],
      [-96, -30, z],
      [-44, -30, z],
      [-30, 80, z],
    ],
    M,
    cx,
    cy,
    sc,
  );
  ctx.fill();
  path3(ctx, circ3(-70, -66, z, 30, 20), M, cx, cy, sc);
  ctx.fill();
  ctx.restore();
  path3(ctx, rect3(-175, -235, 175, 150, z), M, cx, cy, sc);
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  path3(ctx, rect3(-175, 190, -40, 206, z), M, cx, cy, sc);
  ctx.fillStyle = INK;
  ctx.fill();
  if (dv < 1) {
    const yy = lerp(-235, 150, dv);
    path3(
      ctx,
      [
        [-190, yy, z],
        [190, yy, z],
      ],
      M,
      cx,
      cy,
      sc,
      false,
    );
    ctx.strokeStyle = INK;
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  monoNote(
    ctx,
    `DEVELOPING ${String(Math.round(dv * 100)).padStart(3, "0")}%`,
    1150,
    1012,
  );
}

// probe — spinning probe, orbit ring, radar sweep
function objProbe(ctx, lt, ch) {
  const [cx, cy] = OC,
    C = ch.c,
    sc = popAt(lt),
    dk = rgb(mixc(C, BLK, 0.5)),
    T = Math.max(lt, 0);
  ctx.strokeStyle = dk;
  ctx.lineWidth = 4;
  for (const r of [170, 300, 430]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - 470, cy);
  ctx.lineTo(cx + 470, cy);
  ctx.moveTo(cx, cy - 470);
  ctx.lineTo(cx, cy + 470);
  ctx.stroke();
  const a = -1.2 + T * 3.1;
  ctx.fillStyle = rgb(mixc(C, BLK, 0.5), 0.3);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, 430, a - 0.75, a);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * 430, cy + Math.sin(a) * 430);
  ctx.stroke();
  [
    [0.4, 330],
    [2.0, 250],
    [3.6, 380],
    [5.0, 210],
  ].forEach(([th, r]) => {
    const d = (((a - th) % TAU) + TAU) % TAU,
      al = lt < 0 ? 0 : Math.exp(-d * 1.1);
    const x = cx + Math.cos(th) * r,
      y = cy + Math.sin(th) * r;
    ctx.fillStyle = rgb([7, 7, 12], al);
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgb([7, 7, 12], al * 0.8);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 11 + d * 14, 0, TAU);
    ctx.stroke();
  });
  const Mr = rot(1.15, 0, 0.38 + 0.25 * Math.sin(lt * 1.1)),
    R = 300;
  const ringPts = Array.from({ length: 65 }, (_, k) =>
    ap(Mr, [Math.cos((k / 64) * TAU) * R, Math.sin((k / 64) * TAU) * R, 0]).map(
      (v) => v * sc,
    ),
  );
  const half = (front) => {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let k = 0; k < 64; k++) {
      const p = ringPts[k],
        q = ringPts[k + 1];
      if (p[2] + q[2] > 0 !== front) continue;
      const A = pj(p, cx, cy),
        B = pj(q, cx, cy);
      ctx.moveTo(A[0], A[1]);
      ctx.lineTo(B[0], B[1]);
    }
    ctx.stroke();
    if (celOpts.cover) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  };
  const sa = T * 2.6 + 1,
    sp = ap(Mr, [Math.cos(sa) * R, Math.sin(sa) * R, 0]);
  const sat = () => {
    const b = box(46, 46, 46);
    b.pal = ["#3a3a4c", "#24243a", "#111119"];
    drawPieces(
      ctx,
      [b],
      rot(T * 2, T * 3, 0),
      cx + (sp[0] * sc * FOC) / (FOC - sp[2] * sc),
      cy + (sp[1] * sc * FOC) / (FOC - sp[2] * sc),
      sc,
      OBJ_PAL,
      { lw: 5 },
    );
  };
  half(false);
  if (sp[2] <= 0) sat();
  drawPieces(
    ctx,
    [octa(125, 285, 125)],
    rot(0.22, T * 2.3 + 0.4, 0.2),
    cx,
    cy,
    sc,
    OBJ_PAL,
    { tone: tone(ctx, rgb(C, 0.6)) },
  );
  half(true);
  if (sp[2] > 0) sat();
  monoNote(
    ctx,
    `SCANNING ${String(Math.round(prog(lt, 0, 1.8) * 100)).padStart(3, "0")}%`,
    1150,
    1012,
  );
  monoNote(ctx, "INPUT <- OUTPUT", 1640, 1012);
}

// cubes / gear share one cube of 8 blocks: exploded for "cubes", assembled inside a gear for "gear".
function cubePieces(ex) {
  const ps = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const b = box(128, 128, 128);
        b.off = [sx, sy, sz].map((s) => s * (66 + ex * 118));
        b.M = rot(ex * 0.35 * sx, ex * 0.3 * sy, ex * 0.2 * sz);
        ps.push(b);
      }
  return ps;
}
function objDeconstruct(ctx, lt, ch) {
  const [cx, cy] = OC,
    C = ch.c,
    sc = popAt(lt);
  const ex = lt < 0 ? 0 : eBack(prog(lt, 0, 0.5));
  const M = rot(-0.5, 0.65 + lt * 0.45, 0),
    ps = cubePieces(ex);
  groundShadow(ctx, C, cy + 370, 300 + ex * 90);
  const cen = (p) => {
    const r = ap(M, p.off);
    return pj([r[0] * sc, r[1] * sc, r[2] * sc], cx, cy);
  };
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.setLineDash([12, 9]);
  ctx.beginPath();
  for (const p of ps) {
    const q = cen(p);
    ctx.moveTo(cx, cy);
    ctx.lineTo(q[0], q[1]);
  }
  ctx.globalAlpha = clamp(ex);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  const core = octa(46, 46, 46);
  core.pal = ["#3a3a4c", "#191926", INK];
  drawPieces(ctx, [...ps, core], M, cx, cy, sc, OBJ_PAL, {
    tone: tone(ctx, rgb(C, 0.6)),
  });
  // optional labels (up to four) pinned onto the exploded parts
  const SPOTS = [
    [1175, 250],
    [1735, 312],
    [1168, 842],
    [1740, 800],
  ];
  const L = (celOpts.labels || [])
    .slice(0, 4)
    .map((s, k) => [s, ...SPOTS[k]]);
  L.forEach(([s, lx, ly], k) => {
    const p = eOutExpo(prog(lt, 0.45 + k * 0.18, 0.6 + k * 0.18));
    if (p <= 0) return;
    const xs = ps.map(cen),
      tgt = xs.reduce((b, q) =>
        Math.hypot(q[0] - lx, q[1] - ly) < Math.hypot(b[0] - lx, b[1] - ly)
          ? q
          : b,
      );
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lerp(lx, tgt[0], p * 0.72), lerp(ly, tgt[1], p * 0.72));
    ctx.stroke();
    ctx.save();
    ctx.translate(lx, ly);
    ctx.scale(lerp(1.5, 1, p), lerp(1.5, 1, p));
    ctx.font = `600 38px ${fonts.cn}`;
    const bw = Math.max(168, ctx.measureText(s).width + 76);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-84 + 8, -36 + 8, bw, 72);
    ctx.fillStyle = INK;
    ctx.fillRect(-84, -36, bw, 72);
    ctx.fillStyle = rgb(C);
    ctx.font = `700 22px ${fonts.mono}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("0" + (k + 1), -70, 2);
    ctx.fillStyle = "#fff";
    ctx.font = `600 38px ${fonts.cn}`;
    ctx.fillText(s, -30, 3);
    ctx.restore();
  });
}
function objForge(ctx, lt, ch) {
  const [cx, cy] = OC,
    C = ch.c,
    T = Math.max(lt, 0),
    done = lt >= 1.0;
  const ex = 1 - eInOut(prog(lt, 0.05, 1.0)),
    sc = popAt(lt, 1.0) * (lt < 0 ? 1 : 1);
  // gear
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(T * (done ? 1.6 : 0.5) + (done ? -1.1 : 0));
  ctx.beginPath();
  const N = 12;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * TAU,
      w = TAU / N;
    for (const [da, r] of [
      [0, 335],
      [w * 0.2, 390],
      [w * 0.5, 390],
      [w * 0.7, 335],
    ]) {
      const x = Math.cos(a + da) * r,
        y = Math.sin(a + da) * r;
      k || da ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = rgb(mixc(C, BLK, 0.42));
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = INK;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 262, 0, TAU);
  ctx.fillStyle = rgb(C);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  const M = rot(-0.5, 1.55 + lt * 0.45, 0);
  drawPieces(ctx, cubePieces(ex), M, cx, cy, sc, OBJ_PAL, {
    tone: tone(ctx, rgb(C, 0.6)),
  });
  const sp = prog(lt, 1.0, 1.3);
  if (done && sp < 1) {
    const e = eOut3(sp);
    ctx.lineCap = "butt";
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + 0.2,
        r1 = lerp(230, 470, e),
        r2 = r1 + lerp(150, 0, e);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 6;
      ctx.stroke();
    }
  }
  if (lt >= 1.06 && celOpts.stamp) {
    const p = eOutExpo(prog(lt, 1.06, 1.26)),
      s = lerp(2, 1, p);
    ctx.save();
    ctx.translate(1690, 835);
    ctx.rotate(-0.16);
    ctx.scale(s, s);
    ctx.globalAlpha = clamp(p * 3);
    ctx.font = `700 78px ${fonts.en}, ${fonts.cn}`;
    const sw = Math.max(300, ctx.measureText(celOpts.stamp).width + 70);
    ctx.fillStyle = INK;
    ctx.fillRect(-sw / 2, -52, sw, 104);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 5;
    ctx.strokeRect(-sw / 2 + 12, -40, sw - 24, 80);
    ctx.fillStyle = rgb(C);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(celOpts.stamp, 0, 32);
    ctx.restore();
  }
  const bp = prog(lt, 0.05, 1.0);
  if (!celOpts.cover) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 5;
    ctx.strokeRect(1150, 950, 330, 24);
    ctx.fillStyle = INK;
    ctx.fillRect(1156, 956, 318 * bp, 12);
  }
  monoNote(
    ctx,
    `ASSEMBLING ${String(Math.round(bp * 100)).padStart(3, "0")}%`,
    1150,
    1012,
  );
}

// ---------- public graphic library
export const GRAPHICS = [
  { id: "camera", draw: objCamera, at: 1.6, fit: 1, name: { zh: "相机", en: "Camera" } },
  { id: "print", draw: objDarkroom, at: 1.7, fit: 1, name: { zh: "相纸", en: "Photo print" } },
  { id: "probe", draw: objProbe, at: 1.3, fit: 1, name: { zh: "探针", en: "Probe" } },
  { id: "cubes", draw: objDeconstruct, at: 1.6, fit: 1, name: { zh: "方块", en: "Cubes" }, labels: true },
  { id: "gear", draw: objForge, at: 1.6, fit: 0.8, name: { zh: "齿轮", en: "Gear" }, stamp: true },
];
const BY_ID = new Map(GRAPHICS.map((g) => [g.id, g]));
export const graphicRadius = (id, s) => 290 * s * (BY_ID.get(id)?.fit ?? 1);

/** Draws a built-in graphic centred on (cx, cy). `color` is the accent as [r,g,b]. */
export function drawGraphic(ctx, id, cx, cy, s, color, opts = {}) {
  const g = BY_ID.get(id);
  if (!g) return;
  celOpts.labels = opts.labels || [];
  celOpts.stamp = opts.stamp || "";
  const k = s * g.fit;
  ctx.save();
  ctx.translate(cx - OC[0] * k, cy - OC[1] * k);
  ctx.scale(k, k);
  g.draw(ctx, g.at, { c: color });
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

/** Adds graphics to the library (see graphics.js). Each: {id, draw(ctx, t, {c}), at, fit, name:{zh,en}}. */
export function registerGraphics(list) {
  for (const g of list) if (!BY_ID.has(g.id)) { GRAPHICS.push(g); BY_ID.set(g.id, g); }
}

export { clamp, lerp, rgb, mixc, BLK, WHT, tone, toneField, spaced, spacedW, para, brackets };
// building blocks for graphics defined in other modules
export { TAU, OC, OBJ_PAL, rot, box, prism, octa, drawPieces, path3, circ3, rect3, groundShadow };
