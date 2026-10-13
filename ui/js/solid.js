// Solid assets described as data: small 3D objects built from boxes and cylinders, drawn with the
// same cel renderer as the built-in channel graphics — three flat tone bands, screentone on the
// shadow side, an ink line round every face, a ground shadow.
//
//   { kind: "solid", name: {zh, en}, color: "#rrggbb", view: [tilt, turn, roll],
//     parts: [ … ], marks: [ … ] }
//
// Object space: x right, y DOWN, z toward the viewer; the object sits around the origin and is
// about 400 units across. It is scaled and centred to fit when drawn, so only proportions matter.
//
// Parts (convex pieces, sorted by depth when drawn) — each has at: [x, y, z] (its centre),
// tone: "white" | "dark" | "main" | palette name | "#rrggbb", and optionally turn: [rx, ry, rz] degrees —
//   { box: [width, height, depth] }
//   { cyl: [radius, length], axis: "x" | "y" | "z", tip?: radius, sides?: 18 }
//       a cylinder along that axis; `tip` is the radius of the end facing right / up / the viewer
//       when it differs (a cone or a taper)
// Marks (flat details painted on top, on a plane facing the viewer at depth z) —
//   { rect: [x0, y0, x1, y1], z, fill, line?: width }
//   { circle: [x, y, r], z, fill, line?: width }
//   { path: [[x, y], …], z, closed?: true, fill?, line?: width }
// Mark colours: "ink", "white", "main", "shade" (a darker main), a palette name or "#rrggbb".
import { INK, OBJ_PAL, rgb, mixc, BLK, rot, box, prism, drawPieces, path3, circ3, rect3, tone, ap, pj } from "./cel.js";
import { PALETTE } from "./stickers.js";

export const SOLID_LIMITS = { parts: 30, marks: 24, points: 60 };
export const DEFAULT_VIEW = [-17, -32, 0];
const DARK = ["#3a3a4c", "#24243a", "#111119"];
const RAD = Math.PI / 180, HEX = /^#[0-9a-f]{6}$/;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class SolidError extends Error {}
const bad = (msg) => { throw new SolidError(msg); };
const nums = (v, n, what, lo, hi, opt = 0) => {
  if (!Array.isArray(v) || v.length < n || v.length > n + opt) return bad(`${what}: needs ${n} numbers`);
  return v.map((x) => (fin(x) ? lim(x, lo, hi) : bad(`${what}: not a number`)));
};
const ALIAS = { black: "dark", grey: "#9aa0b4", gray: "#9aa0b4", ink: "dark" };
function colour(v, what, allowed, fallback) {
  if (v === undefined && fallback) return fallback;
  if (typeof v === "string") {
    const c = v.trim().toLowerCase();
    if (allowed.includes(c) || HEX.test(c)) return c;
    if (c in PALETTE && c !== "ink" && c !== "white") return c;
    if (allowed.includes(ALIAS[c]) || HEX.test(ALIAS[c] || "")) return ALIAS[c];
  }
  return bad(`${what}: unknown colour ${JSON.stringify(v)}`);
}
const TONES = ["white", "dark", "main"], FILLS = ["ink", "white", "main", "shade"];

function part(raw, i) {
  const what = `parts[${i}]`;
  if (!raw || typeof raw !== "object") return bad(`${what}: not an object`);
  let out;
  if (raw.box) out = { box: nums(raw.box, 3, what + ".box", -480, 480).map((n) => Math.max(2, Math.abs(n))) };
  else if (raw.cyl) {
    const [r, len] = nums(raw.cyl, 2, what + ".cyl", -480, 480).map(Math.abs);
    out = { cyl: [lim(r, 3, 240), lim(len, 2, 480)], axis: ["x", "y", "z"].includes(raw.axis) ? raw.axis : "y" };
    if (raw.tip !== undefined) out.tip = fin(raw.tip) ? lim(Math.abs(raw.tip), 2, 240) : bad(`${what}.tip: not a number`);
    if (raw.sides !== undefined) out.sides = fin(raw.sides) ? Math.round(lim(raw.sides, 3, 28)) : bad(`${what}.sides: not a number`);
  } else return bad(`${what}: needs box or cyl`);
  out.at = raw.at === undefined ? [0, 0, 0] : nums(raw.at, 3, what + ".at", -300, 300);
  out.tone = colour(raw.tone, what + ".tone", TONES, "white");
  if (raw.turn !== undefined) out.turn = nums(raw.turn, 3, what + ".turn", -360, 360);
  return out;
}
function mark(raw, i) {
  const what = `marks[${i}]`;
  if (!raw || typeof raw !== "object") return bad(`${what}: not an object`);
  let out;
  if (raw.rect) out = { rect: nums(raw.rect, 4, what + ".rect", -300, 300) };
  else if (raw.circle) { const [x, y, r] = nums(raw.circle, 3, what + ".circle", -300, 300); out = { circle: [x, y, lim(Math.abs(r), 2, 240)] }; }
  else if (raw.path) {
    if (!Array.isArray(raw.path) || raw.path.length < 2 || raw.path.length > SOLID_LIMITS.points) return bad(`${what}.path: needs 2–${SOLID_LIMITS.points} points`);
    out = { path: raw.path.map((p, k) => nums(p, 2, `${what}.path[${k}]`, -300, 300)), closed: raw.closed !== false };
  } else return bad(`${what}: needs rect, circle or path`);
  out.z = fin(raw.z) ? lim(raw.z, -300, 300) : 0;
  if (raw.fill !== undefined) out.fill = colour(raw.fill, what + ".fill", FILLS);
  if (raw.line !== undefined) out.line = fin(raw.line) ? lim(Math.abs(raw.line), 0, 14) : bad(`${what}.line: not a number`);
  if (!out.fill && !out.line) out.line = 5;
  return out;
}

/** Checks a solid spec and returns a clean copy: {spec} or {error}. Nothing in it is ever executed. */
export function normalizeSolid(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("not an object");
    if (!Array.isArray(raw.parts) || !raw.parts.length) bad("parts: missing");
    if (raw.parts.length > SOLID_LIMITS.parts) bad(`parts: more than ${SOLID_LIMITS.parts}`);
    const marks = raw.marks === undefined ? [] : Array.isArray(raw.marks) ? raw.marks : bad("marks: not a list");
    if (marks.length > SOLID_LIMITS.marks) bad(`marks: more than ${SOLID_LIMITS.marks}`);
    const n = raw.name, text = (v) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
    const zh = text(n && typeof n === "object" ? n.zh : n), en = text(n && typeof n === "object" ? n.en : n);
    const color = typeof raw.color === "string" && HEX.test(raw.color.toLowerCase()) ? raw.color.toLowerCase() : PALETTE.yellow.toLowerCase();
    let view = DEFAULT_VIEW;
    if (raw.view !== undefined) { const v = nums(raw.view, 2, "view", -180, 180, 1); view = [lim(v[0], -60, 60), lim(v[1], -75, 75), lim(v[2] || 0, -30, 30)]; }
    return { spec: { kind: "solid", name: { zh: zh || en || "AI", en: en || zh || "AI" }, color, view, parts: raw.parts.map(part), marks: marks.map(mark) } };
  } catch (e) {
    if (e instanceof SolidError) return { error: e.message };
    throw e;
  }
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const bands = (C) => [rgb(C), rgb(mixc(C, BLK, 0.26)), rgb(mixc(C, BLK, 0.56))];
const AXIS = { x: rot(0, Math.PI / 2, 0), y: rot(Math.PI / 2, 0, 0) };   // turns a prism's own axis (z) to face right / up
const mul = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]; return o; };

/** The renderer's pieces for a normalised spec, with `C` ([r,g,b]) as the main colour. */
function pieces(spec, C) {
  return spec.parts.map((p) => {
    const pc = p.box ? box(p.box[0], p.box[1], p.box[2]) : prism(p.sides || 18, p.cyl[0], p.cyl[1], [0, 0, 0], p.tip ?? p.cyl[0]);
    let M = p.cyl && AXIS[p.axis] ? AXIS[p.axis] : null;
    if (p.turn) { const T = rot(p.turn[0] * RAD, p.turn[1] * RAD, p.turn[2] * RAD); M = M ? mul(T, M) : T; }
    if (M) pc.M = M;
    pc.off = p.at;
    pc.pal = p.tone === "white" ? OBJ_PAL : p.tone === "dark" ? DARK : bands(p.tone === "main" ? C : hexRgb(PALETTE[p.tone] || p.tone));
    return pc;
  });
}
/** Where the object lands on the canvas at scale 1: {x0, y0, x1, y1}. */
function bounds(list, M) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pc of list) for (let v of pc.v) {
    if (pc.M) v = ap(pc.M, v);
    const q = pj(ap(M, [v[0] + pc.off[0], v[1] + pc.off[1], v[2] + pc.off[2]]), 0, 0);
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  return { x0, y0, x1, y1 };
}

/**
 * Draws a normalised solid spec centred on the origin in a 200-unit box (like a sticker), fitted
 * to it whatever size the object was described at. `tint` overrides its main colour.
 */
export function drawSolid(ctx, spec, tint) {
  const main = tint || spec.color, m = /^rgba?\(([^)]+)\)/.exec(main);
  const C = m ? m[1].split(",").slice(0, 3).map(Number) : hexRgb(main);
  const M = rot(spec.view[0] * RAD, spec.view[1] * RAD, spec.view[2] * RAD), list = pieces(spec, C);
  const b = bounds(list, M), w = b.x1 - b.x0, h = b.y1 - b.y0;
  const k = Math.min(12, 520 / Math.max(w, h * 1.12, 1)), cx = (-(b.x0 + b.x1) / 2) * k, cy = (-(b.y0 + b.y1) / 2) * k - 14;
  const shade = rgb(mixc(C, BLK, 0.35)), fills = { ink: INK, white: "#ffffff", main: rgb(C), shade };
  ctx.save();
  ctx.scale(1 / 3, 1 / 3);                                       // drawn at the channel graphics' own scale: a 600-unit box
  ctx.fillStyle = rgb(mixc(C, BLK, 0.5), 0.55);                  // ground shadow
  ctx.beginPath(); ctx.ellipse(cx + ((b.x0 + b.x1) / 2) * k + 18, cy + b.y1 * k + 26, (w * k) / 2 * 0.92, (w * k) / 2 * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  let dots = null;
  try { dots = tone(ctx, rgb(C, 0.55)); } catch (e) { /* no canvas to make the pattern on (tests): plain shadow tone */ }
  drawPieces(ctx, list, M, cx, cy, k, OBJ_PAL, dots ? { tone: dots } : {});
  for (const mk of spec.marks) {
    const pts = mk.rect ? rect3(mk.rect[0], mk.rect[1], mk.rect[2], mk.rect[3], mk.z) : mk.circle ? circ3(mk.circle[0], mk.circle[1], mk.z, mk.circle[2], 28) : mk.path.map(([x, y]) => [x, y, mk.z]);
    path3(ctx, pts, M, cx, cy, k, mk.path ? mk.closed : true);
    if (mk.fill) { ctx.fillStyle = fills[mk.fill] || PALETTE[mk.fill] || mk.fill; ctx.fill(); }
    if (mk.line) { ctx.lineWidth = mk.line; ctx.strokeStyle = INK; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke(); }
  }
  ctx.restore();
}
