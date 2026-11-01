// A picture turned in 3D (a photo not filling the canvas, an asset): the maths, pure (no DOM).
//
// The layer is a card. It is painted flat as ever; then it is turned about its own centre — `tiltX` degrees about its
// own across axis (its top going away for a positive turn), `tiltY` about its own up axis (its right side going away)
// — and seen through a lens: from `TILT.near / persp` times its longer side away (`persp` 0, from afar: no
// perspective). Its own axes are those of its turn in the canvas's plane (`r`), so a card turned on the canvas tips
// about its own edges, and it is turned in 3D after it was turned, scaled and stretched flat. What it comes to is a
// projective map of the canvas's plane: tiltMatrix() gives it, the painting goes through it (warp.js), and the hit is
// the box round the card as it shows, caught within its outline (tiltHit).

/**
 * The limits: `most`, the furthest each way it turns (degrees; at 90 it would be seen edge on); `persp`, the
 * perspective of a card turned before it was ever set; `near`, how near the eye is at the strongest perspective, in
 * the card's longer sides (its corners, turned toward it, stay well in front of it); `least`, the share of its size
 * the far side of what is painted may shrink to — past that (a reach outside the card, turned toward the eye) nothing
 * is drawn.
 */
export const TILT = { most: 80, persp: 0.5, near: 1.5, least: 0.15 };
/** The layers that turn in 3D. */
export const TILTS = ["photo", "asset"];
const RAD = Math.PI / 180;

/** Whether layer L may be turned in 3D: a photo not filling the canvas (a cut-out of one too), an asset. */
export const canTilt = (L) => !!L && TILTS.includes(L.type) && !(L.type === "photo" && L.fill && !L.of);
/** Layer L's turn as it shows: {x, y, p} (degrees about its across and up axes, the perspective 0–1), or null when it shows flat. */
export const tiltOf = (L) => (canTilt(L) && (L.tiltX || L.tiltY) ? { x: L.tiltX || 0, y: L.tiltY || 0, p: L.persp ?? TILT.persp } : null);

const angle = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Math.min(TILT.most, Math.max(-TILT.most, Number(v))) * 10) / 10 : 0);
/**
 * A turn as it is kept on a layer, from raw data: {tiltX, tiltY, persp}, each only when it is not the default (0, 0
 * and TILT.persp), so a flat layer carries none of them. Angles within ±TILT.most to a tenth of a degree, the
 * perspective within 0–1 to a hundredth.
 */
export function normalizeTilt(raw) {
  const out = {}, x = angle(raw && raw.tiltX), y = angle(raw && raw.tiltY);
  if (x) out.tiltX = x;
  if (y) out.tiltY = y;
  const p = raw && Number.isFinite(Number(raw.persp)) && raw.persp !== null && raw.persp !== "" ? Math.round(Math.min(1, Math.max(0, Number(raw.persp))) * 100) / 100 : TILT.persp;
  if (p !== TILT.persp) out.persp = p;
  return out;
}
/** Puts turn `t` ({tiltX, tiltY, persp}, any of them) on layer L as normalizeTilt keeps it, taking away what is now the default. Whether L changed. */
export function setTilt(L, t) {
  const was = [L.tiltX, L.tiltY, L.persp].join("|");
  const n = normalizeTilt({ tiltX: L.tiltX, tiltY: L.tiltY, persp: L.persp, ...t });
  for (const k of ["tiltX", "tiltY", "persp"]) { if (k in n) L[k] = n[k]; else delete L[k]; }
  return [L.tiltX, L.tiltY, L.persp].join("|") !== was;
}

/** 3×3 matrices, row by row, as flat arrays of nine. */
export const mul3 = (a, b) => [0, 1, 2].flatMap((i) => [0, 1, 2].map((j) => a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]));
export function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!det) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
/** Moves by (x, y). */
export const shift3 = (x, y) => [1, 0, x, 0, 1, y, 0, 0, 1];
/** Scales by (x, y). */
export const scale3 = (x, y) => [x, 0, 0, 0, y, 0, 0, 0, 1];
/** Where map m takes point (x, y): [x, y, w] (w the depth it divided by; at or below 0, behind the eye). */
export const project = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w, w]; };

/**
 * The map of a turn: the card centred at (cx, cy), turned `r` degrees in the canvas's plane, `size` its longer side;
 * turned `x` degrees about its own across axis, `y` about its own up axis, seen with perspective `p` (0–1). A 3×3
 * matrix taking a point of the flat card to where it shows (see project): the centre stays where it is, and a card
 * scaled about it maps scaled about it (the eye's distance goes with its size).
 */
export function tiltMatrix(cx, cy, r, x, y, p, size) {
  const c = Math.cos(r * RAD), s = Math.sin(r * RAD), ct = Math.cos(y * RAD), st = Math.sin(y * RAD), cp = Math.cos(x * RAD), sp = Math.sin(x * RAD);
  const k = p > 0 && size > 0 ? p / (TILT.near * size) : 0;   // one over the eye's distance
  // a point (u, v) from the centre, in the card's own axes (a, b) = (c u + s v, -s u + c v), turned about its up axis
  // then its across axis: X = a cos y, Y = b cos x + a sin y sin x, Z = b sin x - a sin y cos x (Z toward the eye)
  const Xu = ct * c, Xv = ct * s, Yu = -cp * s + st * sp * c, Yv = cp * c + st * sp * s, Zu = -sp * s - st * cp * c, Zv = sp * c - st * cp * s;
  // back into the canvas's axes, and divided by the depth (1 - Z k): nearer is larger
  const M = [c * Xu - s * Yu, c * Xv - s * Yv, 0, s * Xu + c * Yu, s * Xv + c * Yv, 0, -k * Zu, -k * Zv, 1];
  return mul3(mul3(shift3(cx, cy), M), shift3(-cx, -cy));
}

/** The four corners of a turned rectangle {cx, cy, hw, hh, r} (r in degrees), clockwise from its top left. */
export const cornersOf = (b) => {
  const a = (b.r || 0) * RAD, c = Math.cos(a), s = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.cx + i * b.hw * c - j * b.hh * s, b.cy + i * b.hw * s + j * b.hh * c]);
};

/**
 * A layer's hit (see render.js: {cx, cy, hw, hh, r}, and `poly`, a free crop's outline) as the turn `m` shows it: the
 * box round its outline, mapped, in its own turn r (so its frame and handles stay square to it), `poly` that outline,
 * and the rest as it was. Its frame's centre (`px`, `py`, the card's) maps to itself.
 */
export function tiltHit(hit, m) {
  const pts = (hit.poly && hit.poly.length >= 3 ? hit.poly : cornersOf(hit)).map(([x, y]) => project(m, x, y)).map(([x, y]) => [x, y]);
  const a = -(hit.r || 0) * RAD, c = Math.cos(a), s = Math.sin(a);
  const own = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);   // in the layer's own axes, about the canvas's origin
  const xs = own.map((p) => p[0]), ys = own.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  const { pf, ...rest } = hit;   // the picture's flat map no longer says where it is (the weave's brush does not paint on it)
  return { ...rest, cx: mx * c + my * s, cy: -mx * s + my * c, hw: (x1 - x0) / 2, hh: (y1 - y0) / 2, poly: pts };
}

/** The box {x0, y0, x1, y1} round points [[x, y], …]. */
export const boxOf = (pts) => ({ x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });
/** The part two boxes share (x1 < x0 or y1 < y0 when none). */
export const meet = (a, b) => ({ x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) });

/**
 * What of a turned card is painted flat, and where it lands: `card` its flat extent (a box, in the canvas's pixels, the
 * card and all its paint reaches), `m` the turn in those pixels, `view` the canvas ({x0, y0, x1, y1}). `from`: the part of
 * `card` worth painting — what of it the turn brings into view, so a card reaching past the canvas that is turned
 * toward it shows what lay outside (null when nothing of it shows); `to`: the box on the canvas it lands in. Where the
 * turn takes the canvas's corners back behind the eye (a card turned far, seen near), the whole card is painted.
 */
export function tiltSpan(card, m, view) {
  const corners = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  const back = inv3(m);
  let from = card;
  if (back) {
    const seen = corners(view).map(([x, y]) => project(back, x, y));
    if (seen.every((p) => p[2] > 0)) from = meet(card, boxOf(seen));   // the canvas, taken back onto the flat card
  }
  if (from.x1 <= from.x0 || from.y1 <= from.y0) return { from: null, to: null };
  const lands = corners(from).map(([x, y]) => project(m, x, y));
  const to = lands.every((p) => p[2] > TILT.least) ? meet(boxOf(lands), view) : { ...view };
  return to.x1 <= to.x0 || to.y1 <= to.y0 ? { from: null, to: null } : { from, to };
}
