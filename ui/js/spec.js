// Stickers described as data instead of code — the form AI-generated assets take.
//
// A spec is a short list of drawing operations for the same painters the built-in stickers use
// (hard shadow, flat fill, heavy ink line), so whatever it describes comes out in the house style.
// It is plain JSON that this file validates and interprets: nothing in a spec is ever executed,
// which is why a spec written by a language model is safe to load.
//
//   { name: {zh, en}, color: "#rrggbb", ops: [ … ] }
//
// Everything is drawn in a 200 x 200 box centred on the origin (x right, y down, -100 … 100).
// Colours are "main" (the sticker's own colour, or the channel colour when tinted), a palette
// name (white, ink, red, yellow, orange, blue, green, pink) or "#rrggbb".
//
// Operations — each may also carry move: [dx, dy], turn: degrees, and mirror: true, which repeats
// the operation reflected left-to-right (a blob merges both halves into one silhouette) —
//   { op: "shape",  path, fill, shadow?: true, lw?: 7 }      closed shape: shadow, fill, ink outline
//   { op: "blob",   paths: [path, …], fill }                 overlapping shapes merged into one silhouette
//   { op: "line",   pts | curve | arc, color, lw?: 30 }      thick inked stroke
//   { op: "detail", pts | curve | arc, color?: "ink", lw?: 6 }   thin line for inner detail
//   { op: "text",   text, size, fill, x?: 0, y?: 0 }         heavy outlined lettering, centred
// Paths —
//   { poly: [[x, y], …] }   { circle: [x, y, r] }   { rrect: [x, y, w, h, r] }
//   { ellipse: [x, y, rx, ry, tiltDegrees?] }
//   { star: [points, outerR, innerR, rotation?] }
//   { curve: [["M", x, y], ["L", x, y], ["Q", cx, cy, x, y], ["C", c1x, c1y, c2x, c2y, x, y], …] }
// An open line may also be { arc: [x, y, r, fromDegrees, toDegrees] } (0 = right, 90 = down).
import { KIT, PALETTE } from "./stickers.js";

export const SPEC_LIMITS = { ops: 40, points: 120, paths: 10, text: 10, coord: 160 };
const HEX = /^#[0-9a-f]{6}$/i;
const fin = (v) => typeof v === "number" && Number.isFinite(v);
const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class SpecError extends Error {}
const bad = (msg) => { throw new SpecError(msg); };
const coord = (v, what) => (fin(v) ? lim(v, -SPEC_LIMITS.coord, SPEC_LIMITS.coord) : bad(`${what}: not a number`));
const ALIAS = { black: "ink", grey: "#9aa0b4", gray: "#9aa0b4", purple: "#8b5cf6", brown: "#8a5a3c" };   // names models reach for
const colour = (v, what, fallback) => {
  if (v === undefined && fallback) return fallback;
  if (typeof v === "string") {
    const c = v.trim().toLowerCase(), short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
    if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
    if (c === "main" || c in PALETTE || HEX.test(c)) return c;
    if (c in ALIAS) return ALIAS[c];
  }
  return bad(`${what}: unknown colour ${JSON.stringify(v)}`);
};
const points = (v, what, min) => {
  if (!Array.isArray(v) || v.length < min || v.length > SPEC_LIMITS.points) return bad(`${what}: needs ${min}–${SPEC_LIMITS.points} points`);
  return v.map((p, i) => (Array.isArray(p) && p.length >= 2 ? [coord(p[0], `${what}[${i}]`), coord(p[1], `${what}[${i}]`)] : bad(`${what}[${i}]: not a point`)));
};
const SEG = { M: 2, L: 2, Q: 4, C: 6 };
const segments = (v, what) => {
  if (!Array.isArray(v) || v.length < 2 || v.length > SPEC_LIMITS.points) return bad(`${what}: needs 2–${SPEC_LIMITS.points} segments`);
  return v.map((s, i) => {
    if (!Array.isArray(s) || !(s[0] in SEG) || s.length !== SEG[s[0]] + 1) return bad(`${what}[${i}]: bad segment`);
    if ((i === 0) !== (s[0] === "M")) return bad(`${what}: must start with one "M" segment`);
    return [s[0], ...s.slice(1).map((n) => coord(n, `${what}[${i}]`))];
  });
};
function path(v, what) {
  if (!v || typeof v !== "object") return bad(`${what}: missing path`);
  if (v.poly) return { poly: points(v.poly, what + ".poly", 3) };
  if (v.curve) return { curve: segments(v.curve, what + ".curve") };
  const nums = (key, n, opt = 0) => {
    const a = v[key];
    if (!Array.isArray(a) || a.length < n || a.length > n + opt) return bad(`${what}.${key}: needs ${n} numbers`);
    return a.map((x) => coord(x, `${what}.${key}`));
  };
  if (v.circle) { const [x, y, r] = nums("circle", 3); return { circle: [x, y, lim(Math.abs(r), 2, 140)] }; }
  if (v.ellipse) { const [x, y, rx, ry, tilt = 0] = nums("ellipse", 4, 1); return { ellipse: [x, y, lim(Math.abs(rx), 2, 140), lim(Math.abs(ry), 2, 140), lim(tilt, -360, 360)] }; }
  if (v.rrect) { const [x, y, w, h, r] = nums("rrect", 5); const W = lim(Math.abs(w), 4, 280), H = lim(Math.abs(h), 4, 280); return { rrect: [x, y, W, H, lim(Math.abs(r), 0, Math.min(W, H) / 2)] }; }
  if (v.star) { const [n, R, r, rot = -Math.PI / 2] = nums("star", 3, 1); return { star: [Math.round(lim(n, 3, 40)), lim(Math.abs(R), 6, 140), lim(Math.abs(r), 3, 140), rot] }; }
  return bad(`${what}: unknown path`);
}
/** An open line: {pts}, {curve} or {arc}. */
function line(v, what, min = 2) {
  if (v.pts) return { pts: points(v.pts, what + ".pts", min) };
  if (v.curve) return { curve: segments(v.curve, what + ".curve") };
  if (v.arc) {
    if (!Array.isArray(v.arc) || v.arc.length !== 5) return bad(`${what}.arc: needs 5 numbers`);
    const [x, y, r, a0, a1] = v.arc.map((n) => (fin(n) ? n : bad(`${what}.arc: not a number`)));
    return { arc: [coord(x), coord(y), lim(Math.abs(r), 2, 140), lim(a0, -720, 720), lim(a1, -720, 720)] };
  }
  return bad(`${what}: needs pts, curve or arc`);
}
function op(raw, i) {
  const what = `ops[${i}]`;
  if (!raw || typeof raw !== "object") return bad(`${what}: not an object`);
  let out;
  switch (raw.op) {
    case "shape": out = { op: "shape", path: path(raw.path, what + ".path"), fill: colour(raw.fill, what + ".fill"), shadow: raw.shadow !== false, lw: fin(raw.lw) ? lim(raw.lw, 3, 14) : 7 }; break;
    case "blob": {
      if (!Array.isArray(raw.paths) || !raw.paths.length || raw.paths.length > SPEC_LIMITS.paths) return bad(`${what}.paths: needs 1–${SPEC_LIMITS.paths} paths`);
      out = { op: "blob", paths: raw.paths.map((p, k) => path(p, `${what}.paths[${k}]`)), fill: colour(raw.fill, what + ".fill") }; break;
    }
    case "line": out = { op: "line", ...line(raw, what), color: colour(raw.color, what + ".color"), lw: fin(raw.lw) ? lim(raw.lw, 6, 44) : 30 }; break;
    case "detail": out = { op: "detail", ...line(raw, what), color: colour(raw.color, what + ".color", "ink"), lw: fin(raw.lw) ? lim(raw.lw, 2, 14) : 6 }; break;
    case "text": {
      const text = typeof raw.text === "string" ? raw.text.trim() : "";
      if (!text || [...text].length > SPEC_LIMITS.text) return bad(`${what}.text: needs 1–${SPEC_LIMITS.text} characters`);
      out = { op: "text", text, size: fin(raw.size) ? lim(raw.size, 16, 220) : 80, fill: colour(raw.fill, what + ".fill"), x: fin(raw.x) ? coord(raw.x) : 0, y: fin(raw.y) ? coord(raw.y) : 0 }; break;
    }
    default: return bad(`${what}: unknown op ${JSON.stringify(raw.op)}`);
  }
  if (raw.move !== undefined) { if (!Array.isArray(raw.move) || raw.move.length !== 2) return bad(`${what}.move: needs [dx, dy]`); out.move = [coord(raw.move[0], what + ".move"), coord(raw.move[1], what + ".move")]; }
  if (raw.rotate !== undefined) { if (!fin(raw.rotate)) return bad(`${what}.rotate: not a number`); out.rotate = lim(raw.rotate, -7, 7); }   // radians (older specs)
  if (raw.turn !== undefined) { if (!fin(raw.turn)) return bad(`${what}.turn: not a number`); out.turn = lim(raw.turn, -360, 360); }
  if (raw.mirror === true) out.mirror = true;
  return out;
}

const paint = (o) => (o.op === "line" || o.op === "detail" ? "color" : "fill");
const NEUTRAL = new Set(["white", "ink", "#ffffff", "#000000", PALETTE.white.toLowerCase(), PALETTE.ink.toLowerCase()]);
/**
 * A sticker must be able to follow the channel colour, so some part of it has to be painted
 * "main". When a model used none, its dominant colour is promoted: the one given as the sticker's
 * own colour if it is used, else the colour that fills the most shapes (white and ink never count).
 */
function withMain(spec, hasOwnColour) {
  if (spec.ops.some((o) => o[paint(o)] === "main")) return spec;
  const hex = (c) => (PALETTE[c] || c).toLowerCase(), weight = new Map();
  for (const o of spec.ops) {
    const c = o[paint(o)];
    if (NEUTRAL.has(c) || NEUTRAL.has(hex(c))) continue;
    weight.set(c, (weight.get(c) || 0) + (o.op === "shape" || o.op === "blob" ? 3 : 1));
  }
  if (!weight.size) return spec;                               // only white and ink: nothing to recolour
  const own = hasOwnColour && [...weight.keys()].find((c) => hex(c) === spec.color);
  const pick = own || [...weight.entries()].sort((a, b) => b[1] - a[1])[0][0];
  for (const o of spec.ops) if (o[paint(o)] === pick) o[paint(o)] = "main";
  spec.color = hex(pick);
  return spec;
}

/**
 * Checks a spec and returns a clean copy with every field present and every number in range.
 * Returns {spec} or {error}: anything unexpected is refused, never guessed at.
 */
export function normalizeSpec(raw) {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) bad("not an object");
    if (!Array.isArray(raw.ops) || !raw.ops.length) bad("ops: missing");
    if (raw.ops.length > SPEC_LIMITS.ops) bad(`ops: more than ${SPEC_LIMITS.ops}`);
    const n = raw.name, text = (v) => (typeof v === "string" ? v.trim().slice(0, 40) : "");
    const zh = text(n && typeof n === "object" ? n.zh : n), en = text(n && typeof n === "object" ? n.en : n);
    const spec = { name: { zh: zh || en || "AI", en: en || zh || "AI" }, color: HEX.test(raw.color) ? raw.color.toLowerCase() : PALETTE.yellow, ops: raw.ops.map(op) };
    return { spec: withMain(spec, HEX.test(raw.color)) };
  } catch (e) {
    if (e instanceof SpecError) return { error: e.message };
    throw e;
  }
}

/**
 * Finds the JSON object in a model's reply (which may wrap it in a code fence or add a sentence)
 * and validates it. Returns {spec} or {error}.
 */
export function parseSpec(text) {
  const s = String(text || ""), from = s.indexOf("{"), to = s.lastIndexOf("}");
  if (from < 0 || to <= from) return { error: "no JSON object in the reply" };
  let raw;
  try { raw = JSON.parse(s.slice(from, to + 1)); } catch (e) { return { error: "the reply is not valid JSON" }; }
  return normalizeSpec(raw);
}

const trace = (segs) => (c) => {
  for (const s of segs) {
    if (s[0] === "M") c.moveTo(s[1], s[2]);
    else if (s[0] === "L") c.lineTo(s[1], s[2]);
    else if (s[0] === "Q") c.quadraticCurveTo(s[1], s[2], s[3], s[4]);
    else c.bezierCurveTo(s[1], s[2], s[3], s[4], s[5], s[6]);
  }
};
const RAD = Math.PI / 180;
const ellipse = (x, y, rx, ry, tilt = 0) => (c) => {
  const t = tilt * RAD;
  c.moveTo(x + rx * Math.cos(t), y + rx * Math.sin(t)); c.ellipse(x, y, rx, ry, t, 0, Math.PI * 2); c.closePath();
};
function builder(p) {
  if (p.poly) return KIT.poly(p.poly);
  if (p.circle) return KIT.circle(...p.circle);
  if (p.ellipse) return ellipse(...p.ellipse);
  if (p.rrect) return KIT.rrect(...p.rrect);
  if (p.star) return KIT.star(...p.star);
  return KIT.curve(trace(p.curve));
}
const open = (o) => (o.pts ? KIT.pathLine(o.pts) : o.arc ? (c) => c.arc(o.arc[0], o.arc[1], o.arc[2], o.arc[3] * RAD, o.arc[4] * RAD, o.arc[4] < o.arc[3]) : trace(o.curve));

// ---------- mirroring: the same operation reflected across the vertical centre line (x -> -x).
// The geometry is reflected rather than the canvas, so shadows still fall to the lower right.
const flipSeg = (s) => [s[0], ...s.slice(1).map((n, i) => (i % 2 ? n : -n))];
function flipPath(p) {
  if (p.poly) return { poly: p.poly.map(([x, y]) => [-x, y]) };
  if (p.circle) return { circle: [-p.circle[0], p.circle[1], p.circle[2]] };
  if (p.ellipse) return { ellipse: [-p.ellipse[0], p.ellipse[1], p.ellipse[2], p.ellipse[3], -(p.ellipse[4] || 0)] };
  if (p.rrect) return { rrect: [-(p.rrect[0] + p.rrect[2]), p.rrect[1], p.rrect[2], p.rrect[3], p.rrect[4]] };
  if (p.star) return { star: [p.star[0], p.star[1], p.star[2], Math.PI - p.star[3]] };
  return { curve: p.curve.map(flipSeg) };
}
function flipOp(o) {
  const f = { ...o };
  if (o.path) f.path = flipPath(o.path);
  if (o.paths) f.paths = o.paths.map(flipPath);
  if (o.pts) f.pts = o.pts.map(([x, y]) => [-x, y]);
  if (o.curve) f.curve = o.curve.map(flipSeg);
  if (o.arc) f.arc = [-o.arc[0], o.arc[1], o.arc[2], 180 - o.arc[3], 180 - o.arc[4]];
  if (o.op === "text") f.x = -o.x;
  if (o.move) f.move = [-o.move[0], o.move[1]];
  if (o.turn) f.turn = -o.turn;
  if (o.rotate) f.rotate = -o.rotate;
  return f;
}

/** Draws a normalised spec centred on the origin in its 200-unit box. `tint` overrides its main colour. */
export function drawSpec(ctx, spec, tint) {
  const main = tint || spec.color, col = (v) => (v === "main" ? main : PALETTE[v] || v);
  ctx.save();
  const placed = (o, fn) => {
    ctx.save();
    if (o.move) ctx.translate(o.move[0], o.move[1]);
    if (o.rotate || o.turn) ctx.rotate((o.rotate || 0) + (o.turn || 0) * RAD);
    fn(o);
    ctx.restore();
  };
  const one = (o) => {
    if (o.op === "shape") KIT.shape(ctx, builder(o.path), col(o.fill), { shadow: o.shadow, lw: o.lw });
    else if (o.op === "line") KIT.stroke(ctx, open(o), col(o.color), o.lw);
    else if (o.op === "detail") { ctx.beginPath(); open(o)(ctx); ctx.lineWidth = o.lw; ctx.strokeStyle = col(o.color); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); }
    else KIT.word(ctx, o.text, o.size, col(o.fill), o.x, o.y);
  };
  for (const o of spec.ops) {
    // a mirrored blob is still one silhouette: both halves go into the same merge
    const blob = (b) => KIT.blob(ctx, b.paths.map(builder), col(b.fill));
    if (o.op === "blob" && o.mirror && !(o.move || o.turn || o.rotate)) blob({ ...o, paths: [...o.paths, ...o.paths.map(flipPath)] });
    else if (o.op === "blob") { placed(o, blob); if (o.mirror) placed(flipOp(o), blob); }
    else { placed(o, one); if (o.mirror) placed(flipOp(o), one); }
  }
  ctx.restore();
}
