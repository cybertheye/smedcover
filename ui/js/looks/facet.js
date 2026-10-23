// origami noir: the rain city, folded from paper
// A neo-noir night retold as flat, faceted illustration: every surface a plane of one tone, as if folded from
// paper, the shadows crushed to black; a teal world against amber lamplight and a few saturated accents. A
// city of dark towers pricked with lit windows, haze, hard shafts of light, rain in streaks, the ground wet
// and mirroring giant neon letters glowing through the mist, a craft hovering on its beam. A photo is cut into
// facets, each the mean of what it covers, graded into the night. The light ground is the same city on a
// morning of fog. Lettering is spaced capitals folded across, the highlighted words neon.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, blurred, canPaint, clamp, css, current, dark, dkFogBand, dkHsl, dkRgb, fall, fast, fxCanvas, glowBehind, grain, graphicShape, gridPen, inPixels, inkAs, keepClear, keepOthers, lum, mapped, mix, noise, objAt, onLayer, openField, overlaps, painters, placeShape, rand, region, seed, shapeOf, slantPath, titleOnly, toneTable, upright, values, vignette } from "./kit.js";
import { isDraft } from "../photo.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { inPiece } from "../title.js";

const FC = { ink: [4, 9, 11], cream: [244, 236, 220], fold: [146, 168, 170], amber: [255, 180, 92], lamp: [255, 222, 166], cyan: [120, 240, 236], red: [236, 44, 56] };
/** The sky, top to horizon, with lamplight w (0: the teal night, 1: an amber-olive glow); on the light ground a pale teal morning of fog. */
const fcSky = (w) => (dark
  ? [mix([3, 9, 12], [10, 9, 5], w), mix([8, 25, 30], [26, 22, 11], w), mix([30, 70, 74], [84, 68, 34], w)]
  : [mix([112, 144, 147], [160, 146, 118], w), mix([178, 202, 199], [208, 196, 168], w), mix([230, 237, 231], [242, 232, 210], w)]);
/** The haze and the mist, at lamplight w. */
const fcHaze = (w) => (dark ? mix([58, 112, 114], [128, 104, 58], w) : mix([238, 243, 239], [246, 238, 220], w));
/**
 * The tones of the towers, far (0) to near (1): the plane facing us, the one turned to the light, the one turned
 * from it, a crown catching the sky, the edge that catches the light. Far off the planes are close in tone, lost
 * in the haze; near they part, as folded paper's do under a lamp. On the light ground the near towers stand dark
 * against the fog.
 */
export function fcTones(depth, w) {
  const sky = fcSky(w), haze = fcHaze(w), body = dark ? mix(mix(sky[2], haze, 0.15), FC.ink, 0.25 + 0.75 * depth) : mix(sky[2], [24, 38, 42], Math.min(0.92, 0.1 + depth));
  return {
    body, lit: mix(body, haze, (dark ? 0.12 : 0.1) + 0.2 * depth), shade: mix(body, FC.ink, 0.12 + 0.45 * depth),
    top: mix(body, haze, (dark ? 0.26 : 0.2) + 0.3 * depth), rim: mix(haze, [255, 255, 255], dark ? 0.2 : 0.6), depth,
  };
}
/** The channel colour as the neon of the night: its hue, vivid and light enough to read as light; a grey gives the sign's red. */
export function fcRim(C) {
  const [h, s] = dkHsl(C);
  if (s < 0.12) return FC.red;
  let L = 0.5;
  while (L < 0.78 && lum(dkRgb(h, 0.92, L)) < 0.3) L += 0.02;
  return dkRgb(h, 0.92, L);
}
/** The colour of the tubes inside the neon letters: cyan, or a warm white when the rim is cyan itself. */
const fcTube = (rim) => { const h = dkHsl(rim)[0]; return h > 150 && h < 215 ? [255, 222, 186] : FC.cyan; };
// ---------- facets: the picture cut into flat triangles
const FC_STACK = new Uint32Array(1024);
/**
 * The Delaunay triangulation of points P ([x0, y0, x1, y1…]): triangles as indices into P, three a
 * triangle, all turning the same way. Swept from the middle outward, the hull kept as a ring, each new
 * triangle's edges flipped until no point lies inside another's circle (after Mapbox's Delaunator).
 */
export function fcDelaunay(P) {
  const n = P.length >> 1;
  if (n < 3) return new Uint32Array(0);
  const T = new Uint32Array(Math.max(2 * n - 5, 0) * 3), Hf = new Int32Array(T.length);
  const hs = Math.ceil(Math.sqrt(n)), prev = new Uint32Array(n), next = new Uint32Array(n), tri = new Uint32Array(n), hash = new Int32Array(hs).fill(-1), ids = new Uint32Array(n), dist = new Float64Array(n);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = P[2 * i], y = P[2 * i + 1]; if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; ids[i] = i; }
  const orient = (px, py, qx, qy, rx, ry) => (qy - py) * (rx - qx) - (qx - px) * (ry - qy) < 0;
  const circum = (a, b, c) => {   // [squared radius, centre x, y] of the circle through a, b and c
    const ax = P[2 * a], ay = P[2 * a + 1], dx = P[2 * b] - ax, dy = P[2 * b + 1] - ay, ex = P[2 * c] - ax, ey = P[2 * c + 1] - ay, bl = dx * dx + dy * dy, cl = ex * ex + ey * ey, d = 0.5 / (dx * ey - dy * ex);
    const x = (ey * bl - dy * cl) * d, y = (dx * cl - ex * bl) * d;
    return [x * x + y * y, ax + x, ay + y];
  };
  // the seed: the point nearest the middle, the one nearest it, and the one making the smallest circle with them
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
  let i0 = 0, i1 = 0, i2 = 0, best = Infinity;
  for (let i = 0; i < n; i++) { const d = (P[2 * i] - mx) ** 2 + (P[2 * i + 1] - my) ** 2; if (d < best) { i0 = i; best = d; } }
  best = Infinity;
  for (let i = 0; i < n; i++) { const d = (P[2 * i] - P[2 * i0]) ** 2 + (P[2 * i + 1] - P[2 * i0 + 1]) ** 2; if (i !== i0 && d > 0 && d < best) { i1 = i; best = d; } }
  best = Infinity;
  for (let i = 0; i < n; i++) { if (i === i0 || i === i1) continue; const r = circum(i0, i1, i)[0]; if (r < best) { i2 = i; best = r; } }
  if (best === Infinity) return new Uint32Array(0);   // all on one line
  if (orient(P[2 * i0], P[2 * i0 + 1], P[2 * i1], P[2 * i1 + 1], P[2 * i2], P[2 * i2 + 1])) [i1, i2] = [i2, i1];
  const [, cx, cy] = circum(i0, i1, i2);
  for (let i = 0; i < n; i++) dist[i] = (P[2 * i] - cx) ** 2 + (P[2 * i + 1] - cy) ** 2;
  ids.sort((a, b) => dist[a] - dist[b]);
  const key = (x, y) => { const dx = x - cx, dy = y - cy, p = dx / (Math.abs(dx) + Math.abs(dy) || 1); return Math.floor(((dy > 0 ? 3 - p : 1 + p) / 4) * hs) % hs; };
  let start = i0, len = 0;
  next[i0] = prev[i2] = i1; next[i1] = prev[i0] = i2; next[i2] = prev[i1] = i0;
  tri[i0] = 0; tri[i1] = 1; tri[i2] = 2;
  for (const i of [i0, i1, i2]) hash[key(P[2 * i], P[2 * i + 1])] = i;
  const link = (a, b) => { Hf[a] = b; if (b !== -1) Hf[b] = a; };
  const add = (a, b, c, ha, hb, hc) => { const t = len; T[t] = a; T[t + 1] = b; T[t + 2] = c; link(t, ha); link(t + 1, hb); link(t + 2, hc); len += 3; return t; };
  const inCircle = (a, b, c, p) => {
    const px = P[2 * p], py = P[2 * p + 1], dx = P[2 * a] - px, dy = P[2 * a + 1] - py, ex = P[2 * b] - px, ey = P[2 * b + 1] - py, fx = P[2 * c] - px, fy = P[2 * c + 1] - py;
    const ap = dx * dx + dy * dy, bp = ex * ex + ey * ey, cp = fx * fx + fy * fy;
    return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
  };
  const legalize = (a) => {   // flips edges until every triangle round the new one is Delaunay again
    let i = 0, ar = 0;
    for (;;) {
      const b = Hf[a], a0 = a - (a % 3);
      ar = a0 + ((a + 2) % 3);
      if (b === -1) { if (i === 0) break; a = FC_STACK[--i]; continue; }
      const b0 = b - (b % 3), al = a0 + ((a + 1) % 3), bl = b0 + ((b + 2) % 3), p0 = T[ar], pr = T[a], pl = T[al], p1 = T[bl];
      if (inCircle(p0, pr, pl, p1)) {
        T[a] = p1; T[b] = p0;
        const hbl = Hf[bl];
        if (hbl === -1) { let e = start; do { if (tri[e] === bl) { tri[e] = a; break; } e = prev[e]; } while (e !== start); }
        link(a, hbl); link(b, Hf[ar]); link(ar, bl);
        if (i < FC_STACK.length) FC_STACK[i++] = b0 + ((b + 1) % 3);
      } else { if (i === 0) break; a = FC_STACK[--i]; }
    }
    return ar;
  };
  add(i0, i1, i2, -1, -1, -1);
  let px = NaN, py = NaN;
  for (let k = 0; k < n; k++) {
    const i = ids[k], x = P[2 * i], y = P[2 * i + 1];
    if (Math.abs(x - px) <= 1e-9 && Math.abs(y - py) <= 1e-9) continue;
    px = x; py = y;
    if (i === i0 || i === i1 || i === i2) continue;
    let s = 0;
    for (let j = 0, kk = key(x, y); j < hs; j++) { s = hash[(kk + j) % hs]; if (s !== -1 && s !== next[s]) break; }
    s = prev[s];
    let e = s, q;
    while (((q = next[e]), !orient(x, y, P[2 * e], P[2 * e + 1], P[2 * q], P[2 * q + 1]))) { e = q; if (e === s) { e = -1; break; } }
    if (e === -1) continue;   // on the hull's edge, or a duplicate
    let t = add(e, i, next[e], -1, -1, tri[e]);
    tri[i] = legalize(t + 2); tri[e] = t;
    let m = next[e];
    while (((q = next[m]), orient(x, y, P[2 * m], P[2 * m + 1], P[2 * q], P[2 * q + 1]))) { t = add(m, i, q, tri[i], -1, tri[m]); tri[i] = legalize(t + 2); next[m] = m; m = q; }
    if (e === s) while (((q = prev[e]), orient(x, y, P[2 * q], P[2 * q + 1], P[2 * e], P[2 * e + 1]))) { t = add(q, i, e, -1, tri[e], tri[q]); legalize(t + 2); tri[q] = t; next[e] = e; e = q; }
    start = prev[i] = e; next[e] = prev[m] = i; next[i] = m;
    hash[key(x, y)] = i; hash[key(P[2 * e], P[2 * e + 1])] = e;
  }
  return T.slice(0, len);
}
const FC_EDGES = new WeakMap();   // a picture's pixels -> how sharply they turn and how light they run (see fcEdges)
/**
 * How sharply the colour (and the alpha: a cut-out's edge) of pixels `d` (w × h) turns, read on the picture at
 * half its size (each 2 × 2 block's mean, so the grain of a photo does not read as an edge): { E (ew × eh), ew,
 * eh, Q (the picture at a quarter of its size, RGBA, qw × qh), lv: [the darkest, the lightest] of its lightness,
 * but for 2% each way }. Worked out once a picture, whatever size its facets are cut.
 */
function fcEdges(d, w, h) {
  let e = FC_EDGES.get(d);
  if (e) return e;
  const ew = w >> 1, eh = h >> 1, A = new Float32Array(ew * eh * 4), E = new Uint16Array(ew * eh), hist = new Uint32Array(256), row = w * 4, ro = ew * 4;
  for (let ey = 0; ey < eh; ey++) for (let ex = 0; ex < ew; ex++) {
    const i = (2 * ey * w + 2 * ex) * 4, o = (ey * ew + ex) * 4;
    for (let c = 0; c < 4; c++) A[o + c] = (d[i + c] + d[i + 4 + c] + d[i + row + c] + d[i + row + 4 + c]) * 0.25;
    if (A[o + 3] > 127) hist[((A[o] * 54 + A[o + 1] * 183 + A[o + 2] * 19) / 256) | 0]++;
  }
  for (let ey = 1; ey < eh - 1; ey++) for (let ex = 1, o = (ey * ew + 1) * 4; ex < ew - 1; ex++, o += 4) {
    let s = 0;
    for (let c = 0; c < 4; c++) s += Math.abs(A[o + 4 + c] - A[o - 4 + c]) + Math.abs(A[o + ro + c] - A[o - ro + c]);
    E[ey * ew + ex] = s;
  }
  const qw = ew >> 1, qh = eh >> 1, Q = new Float32Array(qw * qh * 4);   // and at a quarter of its size: what a few pixels together are, grain and all averaged away
  for (let qy = 0; qy < qh; qy++) for (let qx = 0; qx < qw; qx++) { const i = (2 * qy * ew + 2 * qx) * 4, o = (qy * qw + qx) * 4; for (let c = 0; c < 4; c++) Q[o + c] = (A[i + c] + A[i + 4 + c] + A[i + ro + c] + A[i + ro + 4 + c]) * 0.25; }
  const all = hist.reduce((s, v) => s + v, 0), at = (f) => { for (let l = 0, s = 0; l < 256; l++) if ((s += hist[l]) > all * f) return l; return 255; };
  e = { E, ew, eh, Q, qw, qh, lv: all ? [at(0.02), at(0.98)] : [0, 255] };
  FC_EDGES.set(d, e);
  return e;
}
/**
 * The facets of a picture: its RGBA pixels `d` (w × h) cut into flat triangles. Points are set first on its
 * strongest turns of colour, in very small cells (an eye, a mouth, a hard edge: drawn by small facets of their
 * own), then on its lesser edges in small cells, kept by how sharp they are, then a cell apart everywhere
 * else (broad facets where the picture is flat) — see fcEdges — so the facets' sides run along the picture's
 * edges and a face keeps its features; each triangle is the mean colour of the pixels it covers (see fcMeans).
 * With `refine`, a corner is added where a facet strays most from what it covers, and the facets cut again.
 * `size` (0–1): how coarse, as a share of `unit` (the picture's longer side). The same picture and size give the
 * same facets. { pts: fractions of the picture [x, y…], tris, cols: [r, g, b, a…]
 * (a: how much of the triangle the picture covered), lv (see fcEdges) }. With `cut` (a cut-out's pixels, its
 * mask to clip what is drawn), every facet the subject reaches is whole (a: 255), its colour the subject's
 * alone: the mask, not a facet's share of it, makes the edge, and the subject has no see-through slivers.
 */
export function fcFacets(d, w, h, size, unit = Math.max(w, h), refine = false, cut = false) {
  const big = unit * (0.03 + 0.08 * size), fine = Math.max(2, big * 0.3), detail = Math.max(2, big * 0.1), P = [], { E, ew, eh, lv } = fcEdges(d, w, h);
  const g = detail * 0.43, gw = Math.ceil(w / g) + 1, gh = Math.ceil(h / g) + 1, cell = new Int32Array(gw * gh).fill(-1);   // no two points nearer than detail × 0.62: one at most a cell
  const near = (x, y, r) => {   // whether a point already lies within r of (x, y)
    const i = Math.floor(x / g), j = Math.floor(y / g), k = Math.ceil(r / g);
    for (let v = Math.max(0, j - k); v <= Math.min(gh - 1, j + k); v++) for (let u = Math.max(0, i - k); u <= Math.min(gw - 1, i + k); u++) { const c = cell[v * gw + u]; if (c >= 0 && (P[c] - x) ** 2 + (P[c + 1] - y) ** 2 < r * r) return true; }
    return false;
  };
  const put = (x, y) => { cell[Math.floor(y / g) * gw + Math.floor(x / g)] = P.length; P.push(x, y); };
  /** In cell (cx, cy) of size s: how sharp its sharpest turn is, and where. */
  const sharpest = (cx, cy, s) => {
    let e = 0, bx = 0, by = 0;
    for (let ey = Math.floor((cy * s) / 2), ey1 = Math.min(eh, Math.floor(((cy + 1) * s) / 2)); ey < ey1; ey++) for (let ex = Math.floor((cx * s) / 2), ex1 = Math.min(ew, Math.floor(((cx + 1) * s) / 2)), q = ey * ew + ex; ex < ex1; ex++, q++) if (E[q] > e) { e = E[q]; bx = ex * 2 + 1; by = ey * 2 + 1; }
    return [e, bx + 0.5, by + 0.5];
  };
  // the features: in each very small cell its sharpest turn, where it is a strong one
  for (let cy = 0; cy * detail < h; cy++) for (let cx = 0; cx * detail < w; cx++) {
    const [e, x, y] = sharpest(cx, cy, detail), v = clamp((e / 765 - 0.12) / 0.16);
    if (v > 0 && noise(cx * 4.898 + cy * 17.23 + 0.7) < v && !near(x, y, detail * 0.62)) put(x, y);
  }
  // along the edges: in each small cell the sharpest turn, kept by how sharp it is
  for (let cy = 0; cy * fine < h; cy++) for (let cx = 0; cx * fine < w; cx++) {
    const [e, x, y] = sharpest(cx, cy, fine), v = clamp((e / 765 - 0.04) / 0.14);
    if (v > 0 && noise(cx * 12.9898 + cy * 78.233 + 0.5) < v * v * (3 - 2 * v) && !near(x, y, fine * 0.62)) put(x, y);
  }
  // a cell apart everywhere, each a little off its cell's middle
  for (let cy = 0; cy * big < h; cy++) for (let cx = 0; cx * big < w; cx++) {
    const x = Math.min(w - 0.5, (cx + 0.15 + 0.7 * noise(cx * 3.17 + cy * 9.71 + 1.3)) * big), y = Math.min(h - 0.5, (cy + 0.15 + 0.7 * noise(cx * 7.13 + cy * 2.39 + 4.1)) * big);
    if (!near(x, y, big * 0.42)) put(x, y);
  }
  // a ring just outside the picture, bowed a little, so the facets reach its edges and no three of the ring lie on a line
  const m = fine * 0.5, nx = Math.max(2, Math.round(w / big)), ny = Math.max(2, Math.round(h / big));
  for (let i = 0; i <= nx; i++) { const t = i / nx, b = Math.sin(Math.PI * t) * big * 0.04; P.push(t * w, -m - b, t * w, h + m + b); }
  for (let i = 1; i < ny; i++) { const t = i / ny, b = Math.sin(Math.PI * t) * big * 0.04; P.push(-m - b, t * h, w + m + b, t * h); }
  const step = cut ? 1 : 2;   // a cut-out's every pixel read: a facet the subject only grazes is not missed
  let tris = fcDelaunay(P), cols = fcMeans(d, w, h, P, tris, step);
  for (let round = 0; refine && round < 2; round++) {   // twice: where a facet strays most from what it covers (a mouth across a cheek, an eye), read on the picture at a quarter of its size so grain does not count, a corner there, and the facets cut again
    const { Q, qw, qh } = fcEdges(d, w, h), worst = [];
    for (let t = 0, nt = tris.length / 3; t < nt; t++) {
      const q = t * 4;
      let e = 0, wx = 0, wy = 0;
      fcRaster(P, tris, t, qw, qh, 0.25, 1, (i, x, y) => { const v = Math.abs(Q[i] - cols[q]) + Math.abs(Q[i + 1] - cols[q + 1]) + Math.abs(Q[i + 2] - cols[q + 2]); if (v > e && Q[i + 3] > 127) { e = v; wx = x; wy = y; } });
      if (e > 56) worst.push([e, wx * 4 + 2, wy * 4 + 2]);
    }
    worst.sort((a, b) => b[0] - a[0]);
    let added = 0;
    for (const [, x, y] of worst) { if (added >= 700) break; if (!near(x, y, detail * 0.62)) { put(x, y); added++; } }
    if (!added) break;
    tris = fcDelaunay(P); cols = fcMeans(d, w, h, P, tris, step);
  }
  if (cut) for (let q = 3; q < cols.length; q += 4) cols[q] = cols[q] ? 255 : 0;
  let whole = true;   // every facet drawn whole (a cut-out's, a photo's): no seam between them may let what is behind show
  for (let q = 3; q < cols.length && whole; q += 4) if (cols[q] && cols[q] < 255) whole = false;
  const pts = new Float32Array(P.length);
  for (let i = 0; i < P.length; i += 2) { pts[i] = P[i] / w; pts[i + 1] = P[i + 1] / h; }
  return { pts, tris, cols, lv, whole };
}
/**
 * The pixels of a w × h picture whose middles triangle t holds (its corners in `tris`, into points P, scaled by
 * k), row by row, every `step`th each way: visit(i (the pixel's offset in RGBA), x, y) for each; how many.
 */
function fcRaster(P, tris, t, w, h, k, step, visit) {
  let ax = P[2 * tris[3 * t]] * k, ay = P[2 * tris[3 * t] + 1] * k, bx = P[2 * tris[3 * t + 1]] * k, by = P[2 * tris[3 * t + 1] + 1] * k, cx = P[2 * tris[3 * t + 2]] * k, cy = P[2 * tris[3 * t + 2] + 1] * k;
  if (ay > by) [ax, ay, bx, by] = [bx, by, ax, ay];
  if (ay > cy) [ax, ay, cx, cy] = [cx, cy, ax, ay];
  if (by > cy) [bx, by, cx, cy] = [cx, cy, bx, by];
  let n = 0, y = Math.max(0, Math.ceil(ay - 0.5));
  if (step > 1) y += y % step ? step - (y % step) : 0;
  for (const y1 = Math.min(h - 1, Math.floor(cy - 0.5)); y <= y1; y += step) {
    const mm = y + 0.5, xl = ax + ((cx - ax) * (mm - ay)) / (cy - ay || 1), xs = mm < by ? ax + ((bx - ax) * (mm - ay)) / (by - ay || 1) : bx + ((cx - bx) * (mm - by)) / (cy - by || 1);
    let x = Math.max(0, Math.ceil(Math.min(xl, xs) - 0.5));
    if (step > 1) x += x % step ? step - (x % step) : 0;
    for (let x1 = Math.min(w - 1, Math.floor(Math.max(xl, xs) - 0.5)), i = (y * w + x) * 4; x <= x1; x += step, i += 4 * step) { visit(i, x, y); n++; }
  }
  return n;
}
/** Each triangle's colour: the mean of the pixels whose middles it holds, every `step`th one each way (every other: plenty for a mean), weighed by their alpha; [r, g, b, a…], a: how much of it the picture covers. */
function fcMeans(d, w, h, P, tris, step = 2) {
  const nt = tris.length / 3, cols = new Uint8ClampedArray(nt * 4);
  for (let t = 0; t < nt; t++) {
    let r = 0, g = 0, b = 0, al = 0, n = fcRaster(P, tris, t, w, h, 1, step, (i) => { const a = d[i + 3]; r += d[i] * a; g += d[i + 1] * a; b += d[i + 2] * a; al += a; });
    if (!n) {   // too thin to hold one: the pixel at its centre
      const x = (P[2 * tris[3 * t]] + P[2 * tris[3 * t + 1]] + P[2 * tris[3 * t + 2]]) / 3, y = (P[2 * tris[3 * t] + 1] + P[2 * tris[3 * t + 1] + 1] + P[2 * tris[3 * t + 2] + 1]) / 3, i = (clamp(Math.floor(y), 0, h - 1) * w + clamp(Math.floor(x), 0, w - 1)) * 4, a = d[i + 3];
      r = d[i] * a; g = d[i + 1] * a; b = d[i + 2] * a; al = a; n = 1;
    }
    const q = t * 4, k = al || 1;
    cols[q] = r / k; cols[q + 1] = g / k; cols[q + 2] = b / k; cols[q + 3] = al / n;
  }
  return cols;
}
/** For each lightness, the night's: the blacks crushed, the darks kept apart enough that dark hair or cloth keeps a few planes, the mids brought down, the lights short of white. */
const FC_CURVE = (() => { const K = [[0, 0], [20, 4], [40, 15], [70, 33], [110, 62], [160, 124], [210, 203], [240, 237], [255, 247]], out = new Uint8Array(256); for (let l = 0, i = 0; l < 256; l++) { while (K[i + 1][0] < l) i++; const [a, x] = K[i], [b, y] = K[i + 1]; out[l] = Math.round(x + ((y - x) * (l - a)) / (b - a)); } return out; })();
const FC_TEAL = toneTable([[0, [3, 8, 10]], [0.2, [9, 25, 29]], [0.42, [28, 62, 66]], [0.64, [74, 114, 116]], [0.84, [148, 180, 178]], [1, [238, 236, 226]]]);   // its top a plain white: a highlight is not a cold pale
const FC_OLIVE = toneTable([[0, [7, 6, 4]], [0.2, [28, 26, 15]], [0.42, [76, 70, 42]], [0.64, [138, 128, 84]], [0.84, [208, 194, 146]], [1, [248, 240, 214]]]);
const FC_AMBER = toneTable([[0, [8, 5, 3]], [0.2, [46, 22, 11]], [0.42, [128, 70, 34]], [0.64, [212, 136, 72]], [0.84, [248, 196, 136]], [1, [255, 240, 216]]]);
const FC_RED = toneTable([[0, [12, 2, 3]], [0.3, [86, 10, 14]], [0.62, [182, 26, 34]], [1, [252, 118, 108]]]);
/**
 * A colour as the night grades it: its lightness spread most of the way over the picture's own range (lv,
 * see fcFacets: a dark photo is lifted, a pale one brought down), through the crushing curve, moved by `fold`
 * (a facet's own turn to the light); then onto teal (olive, by lamplight w), or amber where it was warm (skin,
 * lamps, wood; a light warm one, a highlight on skin, however little of its colour shows), or kept red where it
 * was a strong red. Out: [r, g, b] in `out`. With `byValue` the lightness
 * is read by the brightest channel: a picture already in the night's colours is not crushed again.
 */
export function fcGrade(r, g, b, w, fold, out, lv = [0, 255], byValue = false) {
  const l0 = byValue ? (r > g ? (r > b ? r : b) : g > b ? g : b) : (r * 54 + g * 183 + b * 19) >> 8, ls = clamp(6 + ((l0 - lv[0]) * 234) / Math.max(48, lv[1] - lv[0]), 0, 255), l = clamp(FC_CURVE[(l0 + (ls - l0) * 0.7) | 0] + fold * 255, 0, 255) | 0, j = l * 3;
  const mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b, s = mx ? (mx - mn) / mx : 0;
  const L4 = (mx / 255) ** 4, warm = r > b ? clamp(((r - b) / (mx + 1)) * (2.4 + 12 * L4)) * clamp(s * (3 + 20 * L4) - 0.1) : 0, red = clamp(((r - g) / (r + 1) - 0.36) * 3.5) * clamp(s * 2.4 - 0.6), jr = FC_CURVE[mx] * 3;   // a red read by its strength, not its lightness
  for (let q = 0; q < 3; q++) {
    const cool = FC_TEAL[j + q] + (FC_OLIVE[j + q] - FC_TEAL[j + q]) * w, v = cool + (FC_AMBER[j + q] - cool) * warm;
    out[q] = v + (FC_RED[jr + q] - v) * red;
  }
  return out;
}
/**
 * The facets of model M (see fcFacets) drawn into the rectangle X, Y, W × H, each graded into the night
 * (fcGrade), darker the further it lies from a key light at the upper right, and turned a little to or from
 * the light by a fold of its own; on the light ground the fog laid over them (w null: in their own colours,
 * only folded); at `a` over what is there. One path a colour, filled and edged with its own colour by a pixel,
 * so no seam shows between facets. Upright on a canvas worth keeping for (see fcStore: an editor's, a
 * thumbnail's) they are drawn once on a canvas of their own at its very pixels and kept while the place, the
 * size and the grade hold — two photos' at most a size, three pictures each — so a frame that repaints the photo
 * for something else (the rain over it) lays them down in one go. On the night the grade mixes by the
 * lamplight in a straight line, so in a draft in which the lamplight alone moves (see fcBack) the facets at its
 * two ends are kept and mixed (fcMix). A still cover keeps its own picture alone.
 */
function fcPaint(ctx, M, X, Y, W, H, w, a) {
  if (!M || a <= 0 || !M.tris.length) return;
  const m = canPaint(ctx) ? ctx.getTransform() : null, E = m && !m.b && !m.c && m.a > 0 && m.d > 0 && w !== null && fcStore(ctx.canvas);
  if (E) {
    const [f0, g0, f1, g1] = fcExtent(M), x0 = m.a * X + m.e, y0 = m.d * Y + m.f, bx = Math.floor(Math.max(0, x0 + m.a * W * f0)), by = Math.floor(Math.max(0, y0 + m.d * H * g0)), bw = Math.min(ctx.canvas.width, Math.ceil(x0 + m.a * W * f1)) - bx, bh = Math.min(ctx.canvas.height, Math.ceil(y0 + m.d * H * g1)) - by;   // only as large as what they cover (a cut-out's subject)
    if (bw <= 0 || bh <= 0) return;
    let kept = E.facets.get(M);
    if (kept) E.facets.delete(M);
    else {
      kept = { list: [] };
      while (E.facets.size >= 2) { const [old, k] = E.facets.entries().next().value; k.list.forEach((q) => fcSpare(E, q.c)); E.facets.delete(old); }   // the least lately drawn photo's let go, its canvases spared
    }
    E.facets.set(M, kept);
    const rest = [x0 - bx, y0 - by, m.a * W, m.d * H, bw, bh, dark].join("|");
    if (kept.rest !== rest || !isDraft() || !dark || a < 1) Object.assign(kept, { rest, ends: false });
    else if (kept.w !== w) kept.ends = true;
    kept.w = w;
    const at = (lw) => {   // the facets at lamplight lw, drawn once
      const key = `${rest}|${lw}`, i = kept.list.findIndex((q) => q.key === key);
      if (i >= 0) { const e = kept.list.splice(i, 1)[0]; kept.list.push(e); return e.c; }
      const e = { c: kept.list.length >= 3 ? kept.list.shift().c : fcCanvas(E), key };
      e.c.width = bw; e.c.height = bh;
      const g = e.c.getContext("2d");
      g.setTransform(m.a, 0, 0, m.d, x0 - bx - m.a * X, y0 - by - m.d * Y);
      fcFill(g, M, X, Y, W, H, lw, true);
      kept.list.push(e);
      return e.c;
    };
    const lay = (c, al) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= al; ctx.drawImage(c, bx, by); ctx.restore(); };
    if (kept.ends) lay(fcMix(E, "mixFacets", at(0), at(1), w), 1);
    else {
      lay(at(w), a);
      if (!isDraft()) { kept.list = kept.list.filter((q) => q.key === `${rest}|${w}` || (fcSpare(E, q.c), false)); fcLoose(E, "mixFacets"); }
    }
    return;
  }
  ctx.save(); ctx.globalAlpha *= a; fcFill(ctx, M, X, Y, W, H, w, a >= 1); ctx.restore();
}
/** How far model M's facets that show reach (those a cut-out's subject covers, see fcFacets): [x0, y0, x1, y1], fractions of the picture, worked out once. */
const fcExtent = (M) => M.box || (M.box = (() => {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let t = 0, nt = M.tris.length / 3; t < nt; t++) {
    if (M.cols[4 * t + 3] < 6) continue;
    for (let v = 0; v < 3; v++) { const q = M.tris[3 * t + v], x = M.pts[2 * q], y = M.pts[2 * q + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < x0 ? [0, 0, 0, 0] : [clamp(x0), clamp(y0), clamp(x1), clamp(y1)];
})());
/**
 * Fills the facets (see fcPaint) on ctx as they are, `seam`: edged by a pixel. Facets all whole (M.whole) lie on
 * their mean colour, so where two meet nothing behind shows through (what a cut-out keeps is its mask's to say).
 */
function fcFill(ctx, M, X, Y, W, H, w, seam) {
  const { pts, tris, cols } = M, groups = new Map(), c = [0, 0, 0], FOG = fcHaze(w || 0), sum = [0, 0, 0, 0];
  for (let t = 0, nt = tris.length / 3; t < nt; t++) {
    const q = t * 4;
    if (cols[q + 3] < 6) continue;
    const i = tris[3 * t], j = tris[3 * t + 1], k = tris[3 * t + 2], mx = (pts[2 * i] + pts[2 * j] + pts[2 * k]) / 3, my = (pts[2 * i + 1] + pts[2 * j + 1] + pts[2 * k + 1]) / 3;
    const lk = clamp(0.62 * mx - 0.38 * my + 0.38), turn = (noise(mx * 123.9 + my * 53.7) - 0.5) * 0.05;   // the key light from the upper right, falling off across; each facet's own turn
    if (w === null) for (let v = 0; v < 3; v++) c[v] = clamp(cols[q + v] * (1 + turn * 3), 0, 255);   // its own colours, only folded
    else {
      fcGrade(cols[q], cols[q + 1], cols[q + 2], w, turn - 0.07 * (1 - lk) ** 1.5, c, M.lv);
      if (!dark) { const f = 0.14 + 0.16 * (1 - lum(c)); for (let v = 0; v < 3; v++) c[v] += (FOG[v] - c[v]) * f; }   // a morning's fog over it, thickest in the shadows
    }
    const key = `${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.round(cols[q + 3] / 32) / 8}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(t);
    sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3]++;
  }
  if (M.whole && sum[3]) { ctx.fillStyle = css(sum.slice(0, 3).map((v) => v / sum[3])); ctx.fillRect(X, Y, W, H); }
  const m = canPaint(ctx) ? ctx.getTransform() : null, lw = seam && m ? 1 / Math.max(0.01, Math.hypot(m.a, m.b)) : 0;
  ctx.lineJoin = "round"; ctx.lineWidth = lw;
  for (const [key, list] of groups) {
    ctx.beginPath();
    for (const t of list) { for (let v = 0; v < 3; v++) { const p = tris[3 * t + v]; ctx[v ? "lineTo" : "moveTo"](X + pts[2 * p] * W, Y + pts[2 * p + 1] * H); } ctx.closePath(); }
    ctx.fillStyle = ctx.strokeStyle = `rgba(${key})`; ctx.fill();
    if (lw) ctx.stroke();
  }
}
// ---------- what the look keeps between frames
/** The sizes of canvases on the page seen lately (an editor, a size's thumbnail), and the area of the largest of them. */
const FC_SEEN = new Set();
let fcLargest = 0;
/**
 * Whether what is painted on canvas cv is worth keeping: a canvas on the page, or one the size of one (a
 * draft's runs, painted off the page at the editor's size). An export's canvas, or another off the page, is
 * painted straight and keeps nothing.
 */
function fcKeeps(cv) {
  const s = `${cv.width}x${cv.height}`;
  if (cv.isConnected) {
    if (FC_SEEN.has(s)) FC_SEEN.delete(s);
    FC_SEEN.add(s);
    if (FC_SEEN.size > 12) FC_SEEN.delete(FC_SEEN.values().next().value);
    fcLargest = Math.max(...[...FC_SEEN].map((k) => k.split("x").reduce((a, b) => a * b, 1)));
  }
  return FC_SEEN.has(s) && cv.width * cv.height <= 6e6;
}
const FC_SIZES = new Map();   // per canvas size kept: what was painted on it and kept (see fcStore), the least lately used first
/**
 * What is kept for the size of canvas cv: { layers (the city behind, see fcLayer), back, sign, fig (their
 * states), facets (a photo's, see fcPaint), work (canvases), pool (spare ones) }, or null for a canvas not worth
 * keeping (see fcKeeps). At most two large sizes (the editor's, and the one before as its window is resized) and
 * eight small ones (the sizes' thumbnails) are kept, the least lately used let go: a thumbnail never pushes the
 * editor out, nor a resized window's every width stay.
 */
function fcStore(cv) {
  if (!fcKeeps(cv)) return null;
  const s = `${cv.width}x${cv.height}`;
  let e = FC_SIZES.get(s);
  if (e) FC_SIZES.delete(s);
  else e = { area: cv.width * cv.height, layers: {}, facets: new Map(), work: {}, pool: [], back: {}, sign: {}, fig: {} };
  FC_SIZES.set(s, e);
  const large = (q) => q.area * 8 >= fcLargest;
  for (const [k, q] of FC_SIZES) {
    if (q === e) continue;
    if ([...FC_SIZES.values()].filter((v) => large(v) === large(q)).length > (large(q) ? 2 : 8)) { fcDrop(q); FC_SIZES.delete(k); }
  }
  return e;
}
/** Lets go every canvas a store (see fcStore) holds. */
function fcDrop(e) {
  const free = (c) => { if (c) c.width = c.height = 0; };
  for (const l of Object.values(e.layers)) free(l.c);
  for (const k of e.facets.values()) for (const q of k.list) free(q.c);
  for (const c of Object.values(e.work)) free(c);
  e.pool.forEach(free);
  e.layers = {}; e.facets.clear(); e.work = {}; e.pool = []; e.back = {}; e.sign = {}; e.fig = {};
}
/** A spare canvas of store E (one let go of earlier, see fcSpare), else a new one: a slider that makes a new picture each frame does not make a new canvas each frame. */
const fcCanvas = (E) => E.pool.pop() || document.createElement("canvas");
/** Gives canvas c back to store E to be used again in a draft (past two spare, or in a still cover, it is let go). */
function fcSpare(E, c) { if (isDraft() && E.pool.length < 2) E.pool.push(c); else c.width = c.height = 0; }
/**
 * A layer kept in store E (see fcStore): a canvas the size of ctx's, painted by paint(x) with ctx's transform,
 * and reused while `key` (all the painting depends on) holds — so a slider that does not touch it costs one
 * copy. One per `slot`.
 */
function fcLayer(ctx, E, slot, key, paint) {
  const cv = ctx.canvas, m = ctx.getTransform(), full = `${[m.a, m.b, m.c, m.d, m.e, m.f].map((v) => +v.toFixed(4)).join()}|${key}`;
  const e = E.layers[slot] || (E.layers[slot] = { c: fcCanvas(E), key: null });
  if (e.key === full && e.c.width === cv.width && e.c.height === cv.height) return e.c;
  if (e.c.width !== cv.width || e.c.height !== cv.height) { e.c.width = cv.width; e.c.height = cv.height; }
  const x = e.c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, cv.width, cv.height); x.setTransform(m);
  paint(x); e.key = full;
  return e.c;
}
/** Lets layer `slot` of store E go. */
function fcUnlayer(E, slot) { const e = E.layers[slot]; if (e) { e.c.width = e.c.height = 0; delete E.layers[slot]; } }
/**
 * Two pictures of the same shapes, a at lamplight 0 and b at 1, mixed at w: (1 − w) of a and w of b added up,
 * on canvas `slot` of store E. Their colours mix by the lamplight in a straight line and their alpha is the same,
 * so this is the picture at w to a level — where laying b over a would lay what is see-through (haze, a soft
 * edge) twice.
 */
function fcMix(E, slot, a, b, w) {
  const c = E.work[slot] || (E.work[slot] = document.createElement("canvas"));
  if (c.width !== a.width || c.height !== a.height) { c.width = a.width; c.height = a.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "copy"; x.globalAlpha = 1 - w; x.drawImage(a, 0, 0);
  x.globalCompositeOperation = "lighter"; x.globalAlpha = w; x.drawImage(b, 0, 0);
  x.globalCompositeOperation = "source-over"; x.globalAlpha = 1;
  return c;
}
/** Lets work canvas `slot` of store E go. */
function fcLoose(E, slot) { const c = E.work[slot]; if (c) { c.width = c.height = 0; delete E.work[slot]; } }
/** The work canvases (see fcBox) the look uses on canvases it does not keep for: let go once such a canvas, larger than any on the page (an export's), is painted. */
const FC_WORK = ["fcSign", "fcSignK", "fcFloor", "fcFloorM", "fcFloorM2", "fcFigure", "fcFx", "fcFacets", "fcTubes"];
function fcLetGo(ctx) {
  if (!canPaint(ctx) || ctx.canvas.width * ctx.canvas.height <= fcLargest) return;
  for (const k of FC_WORK) if (WORK[k]) WORK[k].width = WORK[k].height = 0;
}
/** Lets everything the look keeps go (as another look is chosen): every size's store, the work canvases. */
export function fcFreeAll() {
  for (const e of FC_SIZES.values()) fcDrop(e);
  FC_SIZES.clear(); FC_SEEN.clear(); fcLargest = 0;
  for (const k of FC_WORK) if (WORK[k]) { WORK[k].width = WORK[k].height = 0; delete WORK[k]; }
}
/** What the look keeps, in bytes (for checks of memory): { sizes, bytes, parts: { city, facets, own (a size's other canvases), spare, work (shared) } }. */
export function fcMemory() {
  const px = (c) => (c ? c.width * c.height * 4 : 0), parts = { city: 0, facets: 0, own: 0, spare: 0, work: 0 };
  for (const e of FC_SIZES.values()) {
    for (const l of Object.values(e.layers)) parts.city += px(l.c);
    for (const k of e.facets.values()) for (const q of k.list) parts.facets += px(q.c);
    for (const c of Object.values(e.work)) parts.own += px(c);
    for (const c of e.pool) parts.spare += px(c);
  }
  for (const k of FC_WORK) parts.work += px(WORK[k]);
  return { sizes: FC_SIZES.size, bytes: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}
// ---------- the city
/**
 * A work canvas for the box x0, y0 – x1, y1 (in ctx's units) as it covers ctx's canvas, its corner cleared to the
 * box's size, drawing with ctx's transform, so what is painted on it lands where it would on ctx: { x (its
 * context), bx, by (where it goes), bw, bh (how much of it is the box) }, or null when the box is off the canvas.
 * One per `slot` of `home` (WORK, or a size's store, see fcStore), grown a little ahead and shrunk only when far
 * too large, so a box that changes size with a slider does not make a canvas every frame; lay it down with fcBoxDown.
 */
function fcBox(ctx, slot, x0, y0, x1, y1, home = WORK) {
  const m = ctx.getTransform(), P = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([u, v]) => [m.a * u + m.c * v + m.e, m.b * u + m.d * v + m.f]);
  const bx = Math.max(0, Math.floor(Math.min(...P.map((q) => q[0])))), by = Math.max(0, Math.floor(Math.min(...P.map((q) => q[1]))));
  const bw = Math.min(ctx.canvas.width, Math.ceil(Math.max(...P.map((q) => q[0])))) - bx, bh = Math.min(ctx.canvas.height, Math.ceil(Math.max(...P.map((q) => q[1])))) - by;
  if (bw <= 0 || bh <= 0) return null;
  const c = fcWork(slot, bw, bh, home), x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, bw, bh);
  x.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by); x.font = ctx.font; x.textAlign = ctx.textAlign; x.textBaseline = ctx.textBaseline;
  return { x, bx, by, bw, bh };
}
/** The work canvas `slot` of `home`, at least w × h: grown a little ahead, shrunk only when over three times as large. */
function fcWork(slot, w, h, home = WORK) {
  const c = home[slot] || (home[slot] = document.createElement("canvas"));
  if (c.width < w || c.height < h || c.width * c.height > 3 * w * h) { c.width = Math.ceil((w * 1.15) / 32) * 32; c.height = Math.ceil((h * 1.15) / 32) * 32; }
  return c;
}
/** Lays a work canvas from fcBox down on ctx where it belongs, at `a`. */
function fcBoxDown(ctx, B, a = 1) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(B.x.canvas, 0, 0, B.bw, B.bh, B.bx, B.by, B.bw, B.bh); ctx.restore(); }
/** The ground: the sky from its top down to the glow of the horizon, cut into broad planes a shade lighter or darker, as folded paper is; on the light ground the sun low and warm in the fog. */
function fcGround(ctx, w, h, sky, k0) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(sky[0])); g.addColorStop(0.55, css(sky[1])); g.addColorStop(1, css(sky[2]));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  const P = [-40, -40, w + 40, -40, -40, h + 40, w + 40, h + 40];
  for (let i = 0; i < 28; i++) P.push(-40 + (w + 80) * rand(k0 + i * 2.1), -40 + (h + 80) * rand(k0 + i * 1.3 + 0.5));
  const T = fcDelaunay(P), sets = [[255, 0.035], [255, 0.016], [0, 0.05], [0, 0.11]];
  sets.forEach(([v, a], s) => {
    ctx.beginPath();
    for (let t = 0; t < T.length; t += 3) if (Math.floor(rand(k0 + 90 + t * 0.37) * sets.length) === s) { for (let q = 0; q < 3; q++) ctx[q ? "lineTo" : "moveTo"](P[2 * T[t + q]], P[2 * T[t + q] + 1]); ctx.closePath(); }
    ctx.fillStyle = `rgba(${v},${v},${v},${dark ? a : a * 0.7})`; ctx.fill();
  });
  if (!dark) { const r = Math.max(w, h) * 0.5, gl = ctx.createRadialGradient(w * 0.76, h * 0.62, 0, w * 0.76, h * 0.62, r); gl.addColorStop(0, "rgba(255,204,146,0.32)"); gl.addColorStop(1, "rgba(255,204,146,0)"); ctx.fillStyle = gl; ctx.fillRect(0, 0, w, h); }   // the sun low and warm in the fog
}
/**
 * A row of the city, its feet at `base`, its tallest reaching `top`: towers folded from paper, each a box seen
 * at a corner — the plane facing us and its side, the one turned to the light (at R.lx) lit, the other in shade,
 * the lit ones warmed the nearer they stand to the neon (R.glow) — the planes parting the nearer the row
 * (R.depth), and on the near ones a chamfered corner catching the light and a fold across the face. Crowns fold
 * as roofs do — cut at a slant, chamfered, a gable, stepped back to a mast with its red light, drawn up to a
 * spire — each plane lit or in shade as it turns. Some of them lit (R.share): on a grid of windows of the city's
 * own scale, whatever the tower's size, a few clusters of offices lit late, each in one light, a lone window
 * here and there, now and then a slit of light up an edge — more of them the more `lit` — set on whole pixels so
 * that they stay crisp however small; on the near row a few lamps glow. R: the row's sizes ({ w, h, tall }),
 * tones (see fcTones), and `low`, [x0, x1, y]: a span where no tower, crown and all, rises above y.
 */
function fcRow(ctx, F, top, base, R, lit, k0) {
  const fw = F.x1 - F.x0, H = Math.max(8, base - top), u = Math.min(fw, F.y1 - F.y0), wins = new Map(), glows = [], reds = [], d = R.depth;
  if (!(u > 1)) return;
  const m = canPaint(ctx) && ctx.getTransform(), on = !!m && !m.b && !m.c && m.a > 0 && m.d > 0, px = on ? 1 / m.a : 0;   // px: a pixel, in units
  const sx = (v) => (on ? (Math.round(v * m.a + m.e) - m.e) / m.a : v), sy = (v) => (on ? (Math.round(v * m.d + m.f) - m.f) / m.d : v);
  const add = (c, x, y, w, h) => { const x0 = sx(x), y0 = sy(y), key = c.map(Math.round).join(); (wins.get(key) || wins.set(key, []).get(key)).push(x0, y0, Math.max(px, sx(x + w) - x0), Math.max(px, sy(y + h) - y0)); };   // a window, on whole pixels, a pixel at least
  const poly = (c, pts) => { ctx.fillStyle = typeof c === "string" ? c : css(c); shapeOf(ctx, pts); ctx.fill(); };
  const LIT = dark ? [FC.amber, FC.amber, FC.amber, FC.lamp, FC.lamp, [255, 240, 214], [255, 206, 140], FC.cyan] : [FC.amber, FC.amber, [255, 198, 108], FC.lamp, [250, 160, 66]], k = lit * R.litK * (dark ? 1 : 0.7);
  for (let x = F.x0 - u * 0.03, i = 0; x < F.x1; i++) {
    const kk = k0 + i * 7.3, tall = rand(kk + 9) < (R.tall || 0), bw = u * (R.w[0] + rand(kk) * R.w[1]) * (tall ? 1.15 : 1), low = R.low && x + bw > R.low[0] && x < R.low[1];   // under the neon letters: low enough that the word reads
    const bh = Math.min(H * (tall ? 0.9 + rand(kk + 1) * 0.1 : R.h[0] + rand(kk + 1) ** 1.4 * R.h[1]), low ? base - R.low[2] : Infinity), next = x + bw * (0.72 + rand(kk + 8) * 0.4);
    const kind = low ? -1 : Math.floor(rand(kk + 2) * 5), sw = bw * (0.16 + rand(kk + 3) * 0.16), y = base - bh, r = bw * (0.25 + rand(kk + 4) * 0.4), sl = sw * 0.32, t0 = y + 0.5, t1 = y + sl + 0.5;   // sl: the side's top falling away
    const cx = x + bw / 2, s = rand(kk + 14) < 0.5 ? 1 : -1, P = (v, yy) => [cx + s * v, yy], a0 = -bw / 2, a2 = bw / 2;   // seen from its left (s = 1) or its right: the face from a0, the side out to a2
    const ch = d > 0.5 && rand(kk + 15) < 0.6 ? bw * 0.07 : 0, fe = bw - sw - ch, a1 = a0 + fe, a3 = a1 + ch;   // the face to a1, a chamfered corner to a3, the side
    const toLight = (R.lx - cx) * s > 0, warm = R.glow ? d * (dark ? 0.24 : 0.14) * clamp(1 - Math.abs(R.lx - cx) / (fw * 0.4)) ** 2 : 0, lt = (c) => (warm > 0 ? mix(c, R.glow, warm) : c);
    const face = toLight ? R.body : lt(R.lit), side = toLight ? lt(R.lit) : R.shade, crown = lt(R.top), dim = mix(face, R.shade, 0.6);
    poly(face, [P(a0, y), P(a1, y), P(a1, base + 1), P(a0, base + 1)]);
    if (ch) poly(crown, [P(a1, y), P(a3, y + sl * 0.3), P(a3, base + 1), P(a1, base + 1)]);
    poly(side, [P(a3, y + (ch ? sl * 0.3 : 0)), P(a2, y + sl), P(a2, base + 1), P(a3, base + 1)]);
    if (rand(kk + 12) < 0.15 + 0.5 * d) poly(mix(face, side, 0.35), [P(a0, y), P(a1, y), P(rand(kk + 16) < 0.5 ? a0 : a1, y + Math.min(bh, fe * (0.5 + 1.4 * rand(kk + 13))))]);   // a fold across the face
    if (kind === 0) {   // a roof cut at a slant, the side's top a plane of its own
      poly(face, [P(a0, t0), P(a1, y - r), P(a1, t0)]);
      poly(crown, [P(a1, y - r), P(a2, y - r * 0.55 + sl), P(a2, t1), P(a1, t0)]);
    } else if (kind === 1) {   // a chamfered crown, its corners folded down: the one turned to the light lit
      const c0 = a0 + fe * 0.2, c1 = a1 - fe * 0.2, yt = y - r * 0.5;
      poly(face, [P(c0, t0), P(c0, yt), P(c1, yt), P(c1, t0)]);
      poly(toLight ? dim : crown, [P(a0, t0), P(c0, yt), P(c0, t0)]);
      poly(toLight ? crown : dim, [P(c1, yt), P(a1, t0), P(c1, t0)]);
      poly(toLight ? mix(crown, side, 0.4) : R.shade, [P(c1, yt), P(a2, t1), P(a1, t0)]);
    } else if (kind === 2) {   // stepped back twice to a mast and its red light, each step a box of its own, its ledge catching the sky
      let b0 = a0 + fe * 0.1, b1 = a1 - fe * 0.08, yy = y;
      for (let st = 0; st < 2; st++) {
        const th = r * (0.55 - 0.15 * st), bs = sw * (0.6 - 0.2 * st), lg = Math.max(px, th * 0.1);
        poly(face, [P(b0, yy - th), P(b1, yy - th), P(b1, yy + 0.5), P(b0, yy + 0.5)]);
        poly(side, [P(b1, yy - th), P(b1 + bs, yy - th + bs * 0.32), P(b1 + bs, yy + 0.5), P(b1, yy + 0.5)]);
        poly(crown, [P(b0, yy - th), P(b1, yy - th), P(b1, yy - th + lg), P(b0, yy - th + lg)]);
        yy -= th; const w2 = (b1 - b0) * 0.2; b0 += w2; b1 -= w2;
      }
      const mh = r * (1 + rand(kk + 5)), mx = (b0 + b1) / 2, mw = Math.max(px * 1.2, bw * 0.024) / 2;
      poly(face, [P(mx - mw, yy - mh), P(mx + mw, yy - mh), P(mx + mw, yy + 0.5), P(mx - mw, yy + 0.5)]);
      reds.push(P(mx, yy - mh));
    } else if (kind === 3 && tall) {   // drawn up to a spire, folded down its middle
      const ap = a0 + fe * 0.6, yt = y - r * 2.4;
      poly(toLight ? face : crown, [P(a0 + fe * 0.18, t0), P(ap, yt), P(ap, t0)]);
      poly(toLight ? crown : dim, [P(ap, yt), P(a1, t0), P(ap, t0)]);
      poly(toLight ? mix(crown, side, 0.4) : R.shade, [P(ap, yt), P(a2, t1), P(a1, t0)]);
      reds.push(P(ap, yt));
    } else if (kind === 4) {   // a gable, its ridge running back over the side
      const ap = a0 + fe * 0.5, yt = y - r * 0.6;
      poly(toLight ? dim : crown, [P(a0, t0), P(ap, yt), P(ap, t0)]);
      poly(toLight ? crown : face, [P(ap, yt), P(a1, t0), P(ap, t0)]);
      poly(toLight ? mix(crown, side, 0.3) : R.shade, [P(ap, yt), P(ap + sw, yt + sl), P(a2, t1), P(a1, t0)]);
    }
    if (toLight) poly(css(R.rim, (dark ? 0.3 : 0.4) * (0.5 + d)), [P(a3, y + (ch ? sl * 0.3 : 0)), P(a3 + Math.max(px, bw * 0.012), y + (ch ? sl * 0.3 : 0)), P(a3 + Math.max(px, bw * 0.012), base), P(a3, base)]);   // the edge turned to the light catching it
    if (k > 0 && rand(kk + 11) < R.share) {   // its lit windows, on the face (none where the next tower stands in front)
      const fx = s > 0 ? x : x + bw - fe, cw = Math.max(px, u * (R.pin ? 0.0032 : 0.0052)), chh = Math.max(px, cw * (R.pin ? 1 : 1.5)), sxp = Math.max(cw + 2 * px, cw * 2.7), syp = Math.max(chh + 2 * px, chh * 2.3);
      const cols = Math.floor((fe * 0.84) / sxp), rows = Math.floor((bh * 0.92 - fe * 0.1) / syp), gx = (fe - cols * sxp) / 2 + (sxp - cw) / 2, top = y + Math.max(fe * 0.1, bh * 0.05);
      const win = (q, r, c) => { const wx = fx + gx + q * sxp; if (wx + cw <= next) add(c, wx, top + r * syp, cw, chh); return wx; };
      if (cols > 0 && rows > 0) {
        for (let c = 0, nc = Math.round(k * (R.pin ? 4 : 5.5) * (0.4 + rand(kk + 17))); c < nc; c++) {   // a cluster of offices lit late, all in one light
          const c0 = Math.floor(rand(kk + c * 3.1 + 21) * cols), r0 = Math.floor(rand(kk + c * 4.7 + 22) * rows), cn = 1 + Math.floor(rand(kk + c * 1.9 + 23) * Math.min(cols, 4)), rn = 1 + Math.floor(rand(kk + c * 2.3 + 24) * 3), col = LIT[Math.floor(rand(kk + c * 5.3 + 25) * LIT.length)];
          for (let q = c0; q < Math.min(cols, c0 + cn); q++) for (let r = r0; r < Math.min(rows, r0 + rn); r++) if (rand(kk + q * 7.7 + r * 3.3 + c * 1.3) < 0.72) {
            const wx = win(q, r, col);
            if (d > 0.5 && glows.length < 10 && rand(kk + q * 2.9 + r * 1.7) < 0.04) glows.push([wx + cw / 2, top + r * syp + chh / 2, col]);
          }
        }
        for (let i2 = 0, n2 = Math.round(k * 9 * rand(kk + 26)); i2 < n2; i2++) win(Math.floor(rand(kk + i2 * 6.1 + 27) * cols), Math.floor(rand(kk + i2 * 4.3 + 28) * rows), LIT[Math.floor(rand(kk + i2 * 2.7 + 29) * LIT.length)]);   // a lone window
      }
      if (!R.pin && rand(kk + 30) < 0.22 * k) { const sh = bh * (0.2 + 0.4 * rand(kk + 31)), sy0 = y + (bh - sh) * rand(kk + 32), ex = s > 0 ? x + fe - cw * 1.6 : x + bw - fe + cw * 0.6; if (ex + cw <= next) add(rand(kk + 33) < 0.5 ? FC.lamp : FC.cyan, ex, sy0, cw, sh); }   // a slit of light up its edge
    }
    x = next;
  }
  for (const [x, y, c] of glows) { const r = u * 0.022, g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, css(c, dark ? 0.2 : 0.32)); g.addColorStop(1, css(c, 0)); ctx.fillStyle = g; ctx.fillRect(x - r, y - r, 2 * r, 2 * r); }   // a lamp glowing in the haze
  for (const [key, list] of wins) { ctx.fillStyle = `rgb(${key})`; ctx.beginPath(); for (let q = 0; q < list.length; q += 4) ctx.rect(list[q], list[q + 1], list[q + 2], list[q + 3]); ctx.fill(); }
  for (const [x, y] of reds) { ctx.fillStyle = css(FC.red, 0.28); ctx.beginPath(); ctx.arc(x, y, Math.max(2, u * 0.006), 0, TAU); ctx.fill(); ctx.fillStyle = css([255, 120, 116]); ctx.beginPath(); ctx.arc(x, y, Math.max(0.9, u * 0.0018), 0, TAU); ctx.fill(); }
}
/**
 * The boxes the look's furniture keeps off: the title and its subtitle each its own (so the room beside a short
 * subtitle is room), the corner tag and the channel graphic (see keepClear).
 */
function fcKeep(ctx, env) {
  if (!canPaint(ctx)) return [];
  const s = env.sub && (env.sub.ink || env.sub.box);
  return [titleOnly(ctx, env), s].filter(Boolean).map((b) => ({ x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 })).concat(keepOthers(env));
}
/**
 * Where the neon stands: { x (its middle), y (its foot), H (a letter's height), W, T (the word's width and
 * height), down (stacked down a tower), box (what it takes, its glow's margin and all) }, or null when there is
 * no room for it. Across the skyline first: H tall at most and no wider than 0.6 of the field, its foot a little
 * above the street (behind the near towers' tops), the tallest that fits at the first of a few heights, as near
 * 0.66 across as the room clear of what `keep` holds (see fcKeep) lets it. Where the room is narrow, stacked down
 * the side of a tower, as a blade sign is, its letters a little apart (see fcLetters), as near the right as it can
 * be — when its letters so stand a fifth taller than they would across, or there is no room across at all.
 * Never behind the words, never sunk among the towers.
 */
export function fcSignAt(ctx, F, base, H, word, keep) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, m = fh * 0.03, per = fcLetters(ctx, 0, 100, word).total / 100;   // per: the word's width for each unit of its height
  if (!(per > 0)) return null;
  const boxes = keep.map((k) => ({ x: k.x - m, y: k.y - m, w: k.w + 2 * m, h: k.h + 2 * m }));
  /** Of the places a box `need` wide reaching from y0 to y1 keeps clear of them, the middle nearest t across; or null. */
  const free = (y0, y1, need, t) => {
    let room = [[F.x0 + m, F.x1 - m]];
    for (const b of boxes) if (b.y < y1 && b.y + b.h > y0) room = room.flatMap(([a, c]) => [[a, Math.min(c, b.x)], [Math.max(a, b.x + b.w), c]]);
    let at = null;
    for (const [a, c] of room) if (c - a >= need) { const x = clamp(F.x0 + fw * t, a + need / 2, c - need / 2); if (at === null || Math.abs(x - F.x0 - fw * t) < Math.abs(at - F.x0 - fw * t)) at = x; }
    return at;
  };
  let across = null, down = null;
  for (let h = Math.min(H, (fw * 0.6) / Math.max(0.3, per)); h >= Math.max(fh * 0.06, H * 0.22) && !across; h *= 0.94) {
    for (const f of [0.22, 0.15, 0.3, 0.09]) {   // its foot this far above the street: about the skyline's height first
      const y = base - fh * f, need = h * per + h * 0.3, x = y - h * 1.15 < F.y0 + m ? null : free(y - h * 1.15, y, need, 0.66);
      if (x !== null) { across = { x, y, H: h, W: h * per, T: h, down: false, box: { x: x - need / 2, y: y - h * 1.15, w: need, h: h * 1.15 } }; break; }
    }
  }
  const V = fcLetters(ctx, 0, 100, word, true), vw = V.W / 100, vt = V.T / 100;   // the column's width and height for each unit of a letter's
  for (let h = Math.min(H, (fh * 0.62) / vt); h >= fh * 0.045 && !down; h *= 0.94) {
    if (across && h < across.H * 1.2) break;
    const pad = h * 0.18, need = h * vw + 2 * pad + h * 0.24;
    for (const f of [0.12, 0.2, 0.06, 0.28]) {
      const y = base - fh * f, top = y - h * vt - pad - h * 0.12, x = top < F.y0 + m ? null : free(top, y + pad, need, 0.86);
      if (x !== null) { down = { x, y, H: h, W: h * vw, T: h * vt, down: true, box: { x: x - need / 2, y: top, w: need, h: y + pad - top } }; break; }
    }
  }
  return down || across;
}
/** A string split into what is read as one character each (an emoji with its joiners, a letter with its accents). */
const fcGraphemes = (s) => (typeof Intl !== "undefined" && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map((g) => g.segment) : [...s]);
/** Whether a character is drawn as a solid tube (a CJK character, an emoji: a face the display type does not cut) rather than as a sign of glass with a tube within. */
const fcSolid = (c) => /\p{Extended_Pictographic}/u.test(c) || !/^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{N}\p{P}\p{S}\p{M}]+$/u.test(c);
/** The neon's word: `text` in capitals, eight characters at most — its whole words while they fit, else the first word's first eight. */
export function fcWord(text) {
  const out = [];
  let n = 0;
  for (const w of String(text).toUpperCase().trim().split(/\s+/).filter(Boolean)) { const g = fcGraphemes(w).length; if (out.length && n + g > 8) break; out.push(w); n += g + 1; }
  return fcGraphemes(out.join(" ")).slice(0, 8).join("").trim();
}
/**
 * The neon letters' places: the word's characters (eight at most) side by side, H tall, their middle at cx, a
 * space a wider gap; or, `down`, stacked one under another, each centred on cx, a little apart, a space a wider
 * gap, the last one's foot at 0: { chars ("" for a space), xs (each one's left), ws (its width), ys (its foot,
 * from the word's), fonts (each one's: the display face for letters, the CJK face, heavier, for a solid one),
 * solid (see fcSolid), total, W, T (the word's width and height) }.
 */
export function fcLetters(ctx, cx, H, word, down = false) {
  const gap = H * 0.12, latin = `400 ${H / 0.7}px ${fonts.en}, ${fonts.cn}`, heavy = `700 ${H / 0.86}px ${fonts.cn}, ${fonts.en}`, chars = [], ws = [], fts = [], solid = [], xs = [], ys = [];
  ctx.save();
  for (const c of fcGraphemes(word).slice(0, 8)) {
    if (!c.trim()) { chars.push(""); ws.push(H * 0.22); fts.push(latin); solid.push(false); continue; }
    const s = fcSolid(c);
    ctx.font = s ? heavy : latin;
    chars.push(c); ws.push(ctx.measureText(c).width); fts.push(s ? heavy : latin); solid.push(s);
  }
  ctx.restore();
  const total = ws.reduce((s, v) => s + v, 0) + gap * Math.max(0, chars.length - 1);
  if (!down) {
    for (let i = 0, x = cx - total / 2; i < chars.length; i++) { xs.push(x); ys.push(0); x += ws[i] + gap; }
    return { chars, xs, ws, ys, fonts: fts, solid, total, W: total, T: H };
  }
  let y = 0, W = 0;
  chars.forEach((c, i) => { y += c ? H : H * 0.3; xs.push(cx - ws[i] / 2); ys.push(y); y += H * 0.2; if (c) W = Math.max(W, ws[i]); });
  const T = Math.max(H, y - H * 0.2);
  for (let i = 0; i < ys.length; i++) ys[i] -= T;
  return { chars, xs, ws, ys, fonts: fts, solid, total, W, T };
}
/**
 * Giant neon letters on the skyline, the word's characters side by side, their foot at (cx, y), H tall — or,
 * `down`, stacked down a blade, a slab of dark glass framed by a tube, as a sign hung on a tower's side is: a
 * letter a sign of dark glass, a tube of `tube` running round just inside its outline, lit along its outer half,
 * and its outline a tube of `rim` with a white-hot core, glowing, here and there a gap in a tube and a stretch
 * burnt out; a CJK character (or an emoji) a solid tube of `rim` along its own strokes, its core white-hot, as
 * such signs are bent. Behind them a halo of the rim's colour lights the mist. On the light ground the glass is
 * dark and the tubes deeper, a sign seen by day, so the letters still read against the fog. They are set on whole
 * pixels, painted on a canvas of their own and kept in store E (see fcStore) while they stay as they are, so a
 * slider that changes the towers behind or before them, or moves them (the street rising), lays them down in one go.
 */
function fcSign(ctx, cx, y, H, word, rim, tube, a, k0, E = null, down = false) {
  const m = canPaint(ctx) && ctx.getTransform(), on = !!m && !m.b && !m.c && m.a > 0 && m.d > 0;
  if (on) { cx += (Math.round(m.a * cx + m.e) - (m.a * cx + m.e)) / m.a; y += (Math.round(m.d * y + m.f) - (m.d * y + m.f)) / m.d; }
  const { chars, xs, ws, ys, fonts: fts, solid, W, T } = fcLetters(ctx, cx, H, word, down);
  if (!chars.some(Boolean) || a <= 0) return;
  if (!dark) { rim = mix(rim, [36, 28, 20], 0.12); tube = mix(tube, [0, 70, 80], 0.3); }
  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round"; ctx.lineCap = "round";
  const core = (c) => mix(c, [255, 255, 255], dark ? 0.7 : 0.55);
  /** fn(c, x, i, b) on each character (`which`: true the solid ones, false the others, else all), in its own face on o; b: its foot. */
  const each = (o, fn, which) => chars.forEach((c, i) => { if (!c || (which !== undefined && solid[i] !== which)) return; if (o.font !== fts[i]) o.font = fts[i]; fn(c, xs[i], i, y + ys[i]); });
  const R = down ? T * 0.75 : Math.max(W, H) * 0.85, sq = down ? Math.max(0.35, (W + H) / T) : 1, halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R);   // a blade's halo an upright oval
  halo.addColorStop(0, css(rim, (dark ? 0.24 : 0.12) * a)); halo.addColorStop(0.5, css(rim, (dark ? 0.07 : 0.03) * a)); halo.addColorStop(1, css(rim, 0));
  ctx.save(); ctx.translate(cx, y - T * 0.5); ctx.scale(sq, 1); ctx.fillStyle = halo; ctx.fillRect(-R, -R, R * 2, R * 2); ctx.restore();   // the whole of it: no edge where the halo is cut
  const cv = ctx.canvas, key = on && [word, H, rim, tube, a, dark, k0, seed, fonts.en, fonts.cn, m.a, m.d, down].join(), at = on && [m.a * cx + m.e, m.d * y + m.f];   // `at`: where it stands, in whole pixels
  const ext = [cx - W / 2 - H * 0.3, y - T - H * 0.35, cx + W / 2 + H * 0.3, y + H * 0.3], ex = on && [m.a * ext[0] + m.e, m.d * ext[1] + m.f, m.a * ext[2] + m.e, m.d * ext[3] + m.f], whole = on && ex[0] >= 0 && ex[1] >= 0 && ex[2] <= cv.width && ex[3] <= cv.height;
  const kept = on && E && E.sign;
  if (kept && kept.key === key && ((kept.at[0] === at[0] && kept.at[1] === at[1]) || (kept.whole && whole))) {   // as kept: laid down where it stands now
    const { L } = kept;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L.x.canvas, 0, 0, L.bw, L.bh, L.bx + at[0] - kept.at[0], L.by + at[1] - kept.at[1], L.bw, L.bh); ctx.restore(); return;
  }
  const L = kept && fcBox(ctx, "sign", ...ext, E.work), o = L ? L.x : ctx;   // where the letters are painted: a canvas kept, else straight on
  if (L) { o.lineJoin = o.lineCap = "round"; kept.key = null; }
  if (down) {   // the blade: dark glass, a tube round its edge
    const pd = H * 0.18, bx = cx - W / 2 - pd, by = y - T - pd, bw = W + 2 * pd, bh = T + 2 * pd;
    o.fillStyle = css(dark ? mix(FC.ink, tube, 0.1) : [22, 34, 38], 0.92 * a); o.fillRect(bx, by, bw, bh);
    for (const [lw, c, al] of [[0.06, rim, 0.25], [0.022, tube, 1], [0.008, core(tube), 1]]) { o.strokeStyle = css(c, al * a); o.lineWidth = H * lw; o.strokeRect(bx + H * 0.05, by + H * 0.05, bw - H * 0.1, bh - H * 0.1); }
  }
  for (const [k, al] of [[0.2, 0.06], [0.09, 0.15]]) { o.strokeStyle = css(rim, al * a * (dark ? 1 : 0.9)); o.lineWidth = H * k; each(o, (c, x, i, b) => o.strokeText(c, x, b)); }   // the rim's glow
  o.fillStyle = css(dark ? mix(FC.ink, tube, 0.2) : mix([22, 34, 38], tube, 0.12), (dark ? 0.72 : 0.88) * a); each(o, (c, x, i, b) => o.fillText(c, x, b), false);   // the glass
  const box = [cx - W / 2 - H * 0.1, y - T - H * 0.15, cx + W / 2 + H * 0.1, y + H * 0.1], B = canPaint(ctx) && solid.includes(false) && fcBox(ctx, "fcSign", ...box), K = B && fcBox(ctx, "fcSignK", ...box);
  if (B && K) {   // the tube inside the outline, on a canvas of its own: the letters, less g in from their edge, kept within g + t of it (K); its outer half lighter
    const x = B.x, g = H * 0.05, t = H * 0.042, band = (q, w, col) => { q.strokeStyle = css(col); q.lineWidth = 2 * w; each(q, (c, xx, i, b) => q.strokeText(c, xx, b), false); };
    x.lineJoin = x.lineCap = K.x.lineJoin = K.x.lineCap = "round";
    x.fillStyle = css(tube); each(x, (c, xx, i, b) => x.fillText(c, xx, b), false);
    x.globalCompositeOperation = "destination-out"; band(x, g, [0, 0, 0]);
    band(K.x, g + t, [0, 0, 0]);
    x.globalCompositeOperation = "destination-in"; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(K.x.canvas, 0, 0, K.bw, K.bh, 0, 0, K.bw, K.bh); x.restore();
    x.globalCompositeOperation = "source-atop"; band(x, g + t * 0.5, core(tube));   // its outer half catching the light
    each(x, (c, xx, i, b) => {   // a gap in the tube, and now and then a stretch gone dark
      x.globalCompositeOperation = "destination-out";
      x.fillRect(xx + ws[i] * rand(k0 + i * 5.1), b - H * (0.1 + 0.8 * rand(k0 + i * 2.7)), ws[i] * 0.12, t * 0.5);
      x.globalCompositeOperation = "source-atop";
      if (rand(k0 + i * 3.7) < 0.25) { x.fillStyle = css(FC.ink, 0.7); x.fillRect(xx - 1, b - H * (0.25 + rand(k0 + i) * 0.5), ws[i] + 2, H * (0.12 + 0.2 * rand(k0 + i * 1.9))); }
    }, false);
    x.globalCompositeOperation = "source-over";
    if (L) { o.save(); o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = a; o.drawImage(B.x.canvas, 0, 0, B.bw, B.bh, B.bx - L.bx, B.by - L.by, B.bw, B.bh); o.restore(); } else fcBoxDown(ctx, B, a);
  } else if (!canPaint(ctx)) { ctx.fillStyle = css(tube, a); each(ctx, (c, x, i, b) => ctx.fillText(c, x, b), false); }
  o.strokeStyle = css(rim, a); o.lineWidth = H * 0.034; each(o, (c, x, i, b) => o.strokeText(c, x, b), false);   // the outline's tube, its core
  o.strokeStyle = css(core(rim), a); o.lineWidth = H * 0.011; each(o, (c, x, i, b) => o.strokeText(c, x, b), false);
  if (solid.includes(true)) {   // a solid one: a CJK character's strokes a tube of the rim's colour, a white-hot core along their middles (cut on a canvas of its own: the glyph less its edge); an emoji as it is, glowing
    const emo = (c) => /\p{Extended_Pictographic}/u.test(c), Q = canPaint(ctx) && fcBox(ctx, "fcSignK", ...box);
    if (!dark) { o.strokeStyle = css([22, 34, 38], 0.9 * a); o.lineWidth = H * 0.11; each(o, (c, x, i, b) => { if (!emo(c)) o.strokeText(c, x, b); }, true); }   // by day a dark edge round the tube, as the glass round the others'
    o.strokeStyle = o.fillStyle = css(rim, a); o.lineWidth = H * 0.045; each(o, (c, x, i, b) => { if (!emo(c)) { o.strokeText(c, x, b); o.fillText(c, x, b); } }, true);
    if (Q) {
      const q = Q.x;
      q.lineJoin = q.lineCap = "round"; q.fillStyle = css(core(rim)); each(q, (c, xx, i, b) => { if (!emo(c)) q.fillText(c, xx, b); }, true);
      q.globalCompositeOperation = "destination-out"; q.strokeStyle = "#000"; q.lineWidth = H * 0.05; each(q, (c, xx, i, b) => { if (!emo(c)) q.strokeText(c, xx, b); }, true); q.globalCompositeOperation = "source-over";
      if (L) { o.save(); o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = a; o.drawImage(Q.x.canvas, 0, 0, Q.bw, Q.bh, Q.bx - L.bx, Q.by - L.by, Q.bw, Q.bh); o.restore(); } else fcBoxDown(ctx, Q, a);
    }
    o.save(); o.globalAlpha = a; each(o, (c, x, i, b) => { if (emo(c)) o.fillText(c, x, b); }, true); o.restore();
  }
  if (L) { fcBoxDown(ctx, L); Object.assign(kept, { key, L, at, whole }); }
  ctx.restore();
}
/**
 * The tower a blade sign hangs on (see fcSign), folded as the others are (see fcRow): its face from x0 to x1, lit
 * by the sign (`glow`), a fold across it, its side in shade, a chamfered crown catching the sky, from the street
 * (base) up to `top`; tones R (see fcTones).
 */
function fcHanger(ctx, x0, x1, top, base, R, glow) {
  const fe = x1 - x0, sw = fe * 0.3, sl = sw * 0.32, ch = fe * 0.14, face = mix(R.lit, glow, dark ? 0.12 : 0.05), poly = (c, pts) => { ctx.fillStyle = typeof c === "string" ? c : css(c); shapeOf(ctx, pts); ctx.fill(); };
  poly(face, [[x0, top + ch], [x0 + ch, top], [x1, top], [x1, base + 1], [x0, base + 1]]);
  poly(mix(face, R.shade, 0.3), [[x0, top + ch], [x1, top + ch + fe * 0.9], [x1, top + ch + fe * 1.6]]);   // a fold across the face
  poly(R.top, [[x0, top + ch], [x0 + ch, top], [x0 + ch, top + ch * 0.4]]);
  poly(R.shade, [[x1, top], [x1 + sw, top + sl], [x1 + sw, base + 1], [x1, base + 1]]);
  poly(css(R.rim, dark ? 0.25 : 0.35), [[x1, top], [x1 + Math.max(1, fe * 0.012), top], [x1 + Math.max(1, fe * 0.012), base], [x1, base]]);   // the edge catching the light
}
/**
 * Shafts of light falling through the haze from above, at a slant: n flat wedges widening as they fall, hard at
 * their sides and fading only toward their ends, each with a narrower, brighter core — light through a high
 * window. Laid on as they are: the light is near white, so screened on the night it would differ by a level or
 * two, and a blend over so much of the picture is dearer. (sx, F.y0): where the window would be; `col`:
 * the light.
 */
function fcShafts(ctx, F, sx, n, a, col, k0) {
  if (a <= 0) return;
  const fh = F.y1 - F.y0, fw = F.x1 - F.x0, L = Math.hypot(fw, fh), ang = 0.42 + (rand(k0) - 0.5) * 0.1, dx = -Math.sin(ang), dy = Math.cos(ang), nx = dy, ny = -dx, m = Math.ceil(n);
  const A = (Math.min(1, a * 2.5) * 0.13 + a * 0.12) * (dark ? 1 : 0.85);
  ctx.save();
  for (let i = 0; i < m; i++) {
    const off = (i - (m - 1) / 2) * fw * 0.08 + (rand(k0 + i * 2.3) - 0.5) * fw * 0.025, bw = fw * (0.02 + rand(k0 + i * 3.1) * 0.035), len = L * (0.6 + 0.35 * rand(k0 + i * 5.9));
    const x0 = sx + nx * off, y0 = F.y0 - fh * 0.08 + ny * off, x1 = x0 + dx * len, y1 = y0 + dy * len, al = A * (0.7 + 0.3 * rand(k0 + i * 4.7)) * clamp(n - i);
    for (const [k, f] of [[1, 0.6], [0.4, 1]]) {   // the wedge, and its core
      const w0 = (bw * k) / 2, w1 = bw * k * 1.3, g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, css(col, al * f)); g.addColorStop(0.5, css(col, al * f * 0.85)); g.addColorStop(1, css(col, 0));
      ctx.fillStyle = g; shapeOf(ctx, [[x0 - nx * w0, y0 - ny * w0], [x0 + nx * w0, y0 + ny * w0], [x1 + nx * w1, y1 + ny * w1], [x1 - nx * w1, y1 - ny * w1]]); ctx.fill();
    }
  }
  ctx.restore();
}
/**
 * A craft hovering, a long low wedge folded of a few planes — its back catching the sky, its flank dark, the
 * glass of its cabin, its belly darker — an amber lamp at its nose, a red one at its tail, a row of small
 * lights along its flank; it throws a cone of light down on the street. (x, y): its middle; s: its length;
 * facing left.
 */
function fcCraft(ctx, x, y, s, a) {
  const back = dark ? [86, 120, 122] : [110, 126, 128], flank = dark ? [20, 34, 38] : [46, 60, 64], belly = dark ? [6, 12, 14] : [28, 38, 42], glass = dark ? [12, 40, 46] : [70, 96, 100], lamp = FC.lamp;
  const P = (u, v) => [x + u * s, y + v * s];
  ctx.save(); ctx.globalAlpha = a;
  const [bx, by] = P(-0.08, 0.08), beam = ctx.createLinearGradient(bx, by, bx - s * 0.3, by + s * 3);
  beam.addColorStop(0, css(lamp, dark ? 0.42 : 0.45)); beam.addColorStop(0.35, css(lamp, dark ? 0.14 : 0.18)); beam.addColorStop(1, css(lamp, 0));
  ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "source-over"; ctx.fillStyle = beam; shapeOf(ctx, [[bx - s * 0.05, by], [bx - s * 0.95, by + s * 3.1], [bx + s * 0.45, by + s * 3.1], [bx + s * 0.05, by]]); ctx.fill(); ctx.restore();
  ctx.fillStyle = css(belly); shapeOf(ctx, [P(-0.5, 0.02), P(-0.3, 0.085), P(0.3, 0.09), P(0.48, 0.05), P(0.5, -0.02)]); ctx.fill();
  ctx.fillStyle = css(flank); shapeOf(ctx, [P(-0.5, 0.02), P(-0.32, -0.05), P(0.36, -0.06), P(0.5, -0.02), P(0.48, 0.05)]); ctx.fill();
  ctx.fillStyle = css(back); shapeOf(ctx, [P(-0.32, -0.05), P(-0.13, -0.12), P(0.2, -0.12), P(0.36, -0.06)]); ctx.fill();
  ctx.fillStyle = css(glass); shapeOf(ctx, [P(-0.2, -0.075), P(-0.08, -0.115), P(0.12, -0.115), P(0.16, -0.075)]); ctx.fill();
  ctx.fillStyle = css(mix(back, [255, 255, 255], 0.35)); shapeOf(ctx, [P(-0.32, -0.05), P(-0.13, -0.12), P(-0.11, -0.115), P(-0.29, -0.047)]); ctx.fill();   // the light along the hood's edge
  ctx.fillStyle = css(FC.cyan, 0.9); for (let i = 0; i < 6; i++) ctx.fillRect(x + s * (-0.2 + i * 0.075), y + s * 0.005, s * 0.03, s * 0.014);
  for (const [u, v, c, r] of [[-0.49, 0.0, lamp, 0.1], [0.49, -0.01, FC.red, 0.06]]) {
    const [lx, ly] = P(u, v), gl = ctx.createRadialGradient(lx, ly, 0, lx, ly, s * r);
    gl.addColorStop(0, css(c, 0.85)); gl.addColorStop(1, css(c, 0));
    ctx.fillStyle = gl; ctx.fillRect(lx - s * r, ly - s * r, s * r * 2, s * r * 2);
    ctx.fillStyle = css(mix(c, [255, 255, 255], 0.6)); ctx.beginPath(); ctx.arc(lx, ly, Math.max(1, s * 0.011), 0, TAU); ctx.fill();
  }
  ctx.restore();
}
/**
 * The street wet with rain, from y down to the field's foot: what stands above mirrored in it and drawn out
 * downward, as lights are on wet asphalt — on the night its lights alone (the copy multiplied by itself twice,
 * so the haze sinks into the dark, and screened on), on the fog the towers darkening it — cut by the ripples
 * into bands, each slid a little aside; the neon letters' tubes (S: { cx, H, word, a, down }) running down it in long
 * streaks of their colours, and a few lamps' in amber; gaps of bare street between the bands breaking it all
 * into flat pieces, nearer and wider toward the foot; a few broad planes fanning from the horizon, as a folded
 * sheet's; the sheen along the wet edge.
 */
function fcFloor(ctx, F, y, a, rim, tube, S, k0) {
  const fw = F.x1 - F.x0, d = F.y1 - y, u = Math.min(fw, F.y1 - F.y0), al = Math.min(1, a * 2.5), y1 = F.y1 + 2;
  if (d < 2) return;
  const g = ctx.createLinearGradient(0, y, 0, F.y1);
  g.addColorStop(0, css(dark ? [10, 26, 30] : [206, 216, 212])); g.addColorStop(1, css(dark ? [4, 11, 13] : [170, 186, 184]));
  ctx.fillStyle = g; ctx.fillRect(F.x0, y, fw, y1 - y);
  const cuts = [0];   // where the ripples cut: nearer, wider apart
  for (let t = 0, b = 0; t < 1; b++) { t = Math.min(1, t + (0.07 + 0.1 * t) * (0.7 + 0.6 * rand(k0 + b * 1.9))); cuts.push(t); }
  const Bx = canPaint(ctx) && fcBox(ctx, "fcFloor", F.x0, y, F.x1, y1), o = Bx ? Bx.x : ctx;   // the mirror (and on the night the streaks) painted apart and laid on at once: one blend rather than one a band
  if (Bx) {   // the mirror: a copy of what is above, drawn out downward by `st`
    const cv = ctx.canvas, m = ctx.getTransform(), st = 3.6, X0 = Math.max(0, Math.floor(m.e + F.x0 * m.a)), X1 = Math.min(cv.width, Math.ceil(m.e + F.x1 * m.a)), Y = Math.round(m.f + y * m.d), D = Math.round(d * m.d), Sh = Math.min(Y, Math.ceil(D / st));
    if (X1 > X0 && Sh > 1 && m.a > 0 && m.d > 0 && !m.b && !m.c) {
      const [src, src2] = ["fcFloorM", "fcFloorM2"].map((k) => fcWork(k, X1 - X0, Sh));
      const sg = src.getContext("2d"); sg.setTransform(1, 0, 0, -1, 0, Sh); sg.globalCompositeOperation = "copy"; sg.drawImage(cv, X0, Y - Sh, X1 - X0, Sh, 0, 0, X1 - X0, Sh); sg.setTransform(1, 0, 0, 1, 0, 0);   // upside down: its first row the one just above the line
      if (dark) {   // cubed: the haze sinks into the dark, the lights stay (the canvas read once: reading it stalls the frame)
        const g2 = src2.getContext("2d"), all = [0, 0, X1 - X0, Sh, 0, 0, X1 - X0, Sh]; g2.globalCompositeOperation = "copy"; g2.drawImage(src, ...all);
        sg.globalCompositeOperation = "multiply"; sg.drawImage(src2, ...all); sg.drawImage(src2, ...all);
      }
      inPixels(o, () => {
        for (let i = 0; i + 1 < cuts.length; i++) {
          const o0 = cuts[i] * D, o1 = cuts[i + 1] * D, f0 = o0 / st, fh = Math.min(Sh - f0, (o1 - o0) / st);
          if (fh <= 0) break;
          o.globalAlpha = (dark ? 1 : 0.5) * al * (1 - 0.5 * cuts[i]);
          o.drawImage(src, 0, f0, X1 - X0, fh, X0 - Bx.bx + (rand(k0 + i * 2.9) - 0.5) * u * m.a * (0.004 + 0.012 * cuts[i]), Y + o0 - Bx.by, X1 - X0, fh * st);
        }
      });
    }
    if (!dark) { ctx.save(); ctx.globalCompositeOperation = "multiply"; fcBoxDown(ctx, Bx); ctx.restore(); }   // on the fog the towers darken it
  }
  const q = dark ? o : ctx;   // where the streaks go
  q.save(); if (q === ctx) q.globalCompositeOperation = dark ? "screen" : "source-over";
  const streak = (x, w, len, c, a0) => { const gr = q.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, css(c, a0)); gr.addColorStop(0.6, css(c, a0 * 0.45)); gr.addColorStop(1, css(c, 0)); q.fillStyle = gr; q.fillRect(x, y, w, len); };
  if (S) {   // under the neon letters, each tube's colour running down (under a blade, its frame's and its middle's)
    const { chars, xs, ws, W } = fcLetters(ctx, S.cx, S.H, S.word, S.down), A = (dark ? 0.6 : 0.45) * al * S.a, lo = dark ? rim : mix(rim, [36, 28, 20], 0.12), tu = dark ? tube : mix(tube, [0, 70, 80], 0.3);
    if (S.down) { const bw = W + S.H * 0.36, x = S.cx - bw / 2, len = d * 0.85; streak(x + bw * 0.3, bw * 0.4, len, tu, A * 0.55); streak(x, bw * 0.08, len * 0.9, lo, A); streak(x + bw * 0.92, bw * 0.08, len * 0.85, lo, A); }
    else xs.forEach((x, i) => {
      if (!chars[i]) return;
      const w = ws[i], len = d * (0.75 + 0.25 * rand(k0 + i * 3.1));
      streak(x + w * 0.3, w * 0.4, len, tu, A * 0.55);
      streak(x, w * 0.1, len * 0.9, lo, A); streak(x + w * 0.9, w * 0.1, len * 0.85, lo, A);
    });
  }
  for (let i = 0; i < 6; i++) streak(F.x0 + fw * rand(k0 + i * 4.3), u * (0.003 + 0.004 * rand(k0 + i * 1.1)), d * (0.3 + 0.5 * rand(k0 + i * 2.2)), FC.amber, (dark ? 0.4 : 0.3) * al);   // street lamps
  q.restore();
  if (Bx && dark) { ctx.save(); ctx.globalCompositeOperation = "screen"; fcBoxDown(ctx, Bx); ctx.restore(); }
  ctx.save(); ctx.globalAlpha = dark ? 1 : 0.5; ctx.fillStyle = g; ctx.beginPath();   // the gaps, the ripples' troughs: the bare street, broken (on the light ground, softly)
  for (let i = 1; i + 1 < cuts.length; i++) {
    const gh = d * (cuts[i + 1] - cuts[i]) * (dark ? 0.18 : 0.12), at = y + d * cuts[i];
    for (let x = F.x0, j = 0; x < F.x1; j++) { const l = fw * (0.015 + 0.06 * rand(k0 + i * 7.1 + j * 1.3)), h = gh * (0.5 + rand(k0 + i * 3.3 + j * 2.1)); if (rand(k0 + i * 1.7 + j * 4.9) < 0.65) ctx.rect(x, at - h * 0.5 + gh * (rand(k0 + i + j * 0.7) - 0.5), l, h); x += l; }
  }
  ctx.fill(); ctx.restore();
  const vx = F.x0 + fw * (0.4 + 0.2 * rand(k0));
  for (let i = 0, n = 7; i < n; i++) {   // the sheet's planes, fanning from the horizon
    const xa = F.x0 - fw * 0.6 + (fw * 2.2 * (i + rand(k0 + i * 1.7) * 0.6)) / n, xb = F.x0 - fw * 0.6 + (fw * 2.2 * (i + 1)) / n;
    ctx.fillStyle = i % 2 ? `rgba(255,255,255,${dark ? 0.02 : 0.07})` : `rgba(0,0,0,${dark ? 0.1 : 0.035})`; shapeOf(ctx, [[vx, y], [xa, y1], [xb, y1]]); ctx.fill();
  }
  ctx.fillStyle = css(mix(fcHaze(0), [255, 255, 255], 0.3), (dark ? 0.35 : 0.6) * al); ctx.fillRect(F.x0, y, fw, Math.max(1, u * 0.0015));
}
/** Rain: fine slanted streaks over the field, a few longer and brighter, nearer; `a` (0–1) how many and how heavy. */
function fcRain(ctx, F, a, k0) {
  if (a <= 0) return;
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), n = Math.round(80 + 1100 * a), dx = 0.1, col = dark ? [196, 228, 226] : [60, 78, 82];
  ctx.save(); ctx.lineCap = "butt";
  for (const [al, lw, from, to] of [[0.13, 1, 0, 0.72], [0.24, 1.5, 0.72, 0.94], [0.42, 2.1, 0.94, 1]]) {
    ctx.strokeStyle = css(col, al * Math.min(1, 0.35 + a)); ctx.lineWidth = Math.max(0.6, lw * u * 0.001); ctx.beginPath();
    for (let i = Math.floor(n * from); i < Math.floor(n * to); i++) {
      const x = F.x0 + (fw + fh * dx) * rand(k0 + i * 1.31) - fh * dx, y = F.y0 + fh * rand(k0 + i * 2.17), l = u * (0.025 + 0.07 * rand(k0 + i * 3.7)) * (1 + (i / n) * 0.8);
      ctx.moveTo(x, y); ctx.lineTo(x + l * dx, y + l);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/** Light through venetian blinds: slanted bars of it across the field from one side, hard-edged, fading out at their ends; laid on as they are, as the shafts are. */
function fcBlinds(ctx, F, a, col, k0) {
  if (a <= 0) return;
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, n = 9, pitch = fh * 0.075, th = pitch * (0.38 + 0.2 * a), x0 = F.x0 - fw * 0.05, len = fw * (0.45 + 0.4 * a), y0 = F.y0 + fh * (0.12 + 0.1 * rand(k0)), sl = 0.32;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const y = y0 + i * pitch, gr = ctx.createLinearGradient(x0, 0, x0 + len, 0), al = a * 0.2 * (0.6 + 0.4 * rand(k0 + i));
    gr.addColorStop(0, css(col, al)); gr.addColorStop(0.7, css(col, al * 0.7)); gr.addColorStop(1, css(col, 0));
    ctx.fillStyle = gr; shapeOf(ctx, [[x0, y], [x0 + len, y + len * sl], [x0 + len, y + len * sl + th], [x0, y + th]]); ctx.fill();
  }
  ctx.restore();
}
/** Letterbox bars: black across the top and the foot, `a` of the way to a wide screen's. */
function fcBars(ctx, w, h, a) {
  if (a <= 0) return;
  const b = h * 0.12 * a;
  ctx.fillStyle = css(FC.ink); ctx.fillRect(0, 0, w, b); ctx.fillRect(0, h - b, w, b);
}
/**
 * How the channel graphic is folded: as a sheet is for an origami base, by creases running straight from a point
 * a little above its middle out past its edge, at angles of their own, into seven broad planes, every other one
 * folded the other way (a valley between two mountains); each plane lit by how it turns to a light from the upper
 * left. [{ a0, a1 (its angles), lit (0–1) }], kept per silhouette.
 */
function fcFold(S) {
  if (S.fold) return S.fold;
  const n = 7, A = [...Array(n).keys()].map((i) => ((i + 0.5 * (noise(41.3 + i * 7.1) - 0.5)) / n) * TAU - Math.PI / 2), L = [-0.45, -0.6, 0.66], out = [];
  for (let i = 0; i < n; i++) {
    const a0 = A[i], a1 = i + 1 < n ? A[i + 1] : A[0] + TAU, mid = (a0 + a1) / 2, tilt = i % 2 ? 0.6 : -0.4, nx = Math.cos(mid) * tilt, ny = Math.sin(mid) * tilt;
    out.push({ a0, a1, lit: clamp((nx * L[0] + ny * L[1] + L[2]) / (Math.hypot(nx, ny, 1) * Math.hypot(...L))) });
  }
  return (S.fold = out);
}
/**
 * The folded figure (see fcFold) standing with its middle at (cx, cy), `size` units tall: its planes in four
 * tones, from the night's deep teal on the side turned away to warm paper on the side the light falls on (the same
 * whatever the lamplight, so the figure kept serves a dragged lamplight too), cut to the silhouette, a fine rim of
 * the neon `rim` along its right edge; at `a`. Set on whole
 * pixels, painted on a canvas only as large as the figure (fcBox) and kept in store E (see fcStore) while it stays
 * as it is, so a slider that does not change it, or moves it, lays it down in one go.
 */
function fcFigure(ctx, S, cx, cy, size, rim, a, E = null) {
  const cv = ctx.canvas, m0 = ctx.getTransform(), on = !m0.b && !m0.c && m0.a > 0 && m0.d > 0;
  if (on) { cx += (Math.round(m0.a * cx + m0.e) - (m0.a * cx + m0.e)) / m0.a; cy += (Math.round(m0.d * cy + m0.f) - (m0.d * cy + m0.f)) / m0.d; }
  const b = S.box, k = size / Math.max(1, b.y1 - b.y0), hw = ((b.x1 - b.x0) / 2) * k + size * 0.04, box = [cx - hw, cy - size * 0.54, cx + hw, cy + size * 0.54];
  const key = [size, rim, m0.a, m0.d].join(), at = [m0.a * cx + m0.e, m0.d * cy + m0.f];
  const whole = on && m0.a * box[0] + m0.e >= 0 && m0.d * box[1] + m0.f >= 0 && m0.a * box[2] + m0.e <= cv.width && m0.d * box[3] + m0.f <= cv.height;
  const kept = on && E && E.fig;
  if (kept && kept.S === S && kept.key === key && ((kept.at[0] === at[0] && kept.at[1] === at[1]) || (kept.whole && whole))) {   // as kept: laid down where it stands now
    const K = kept.B;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= a; ctx.drawImage(K.x.canvas, 0, 0, K.bw, K.bh, K.bx + at[0] - kept.at[0], K.by + at[1] - kept.at[1], K.bw, K.bh); ctx.restore();
    return;
  }
  const B = kept ? fcBox(ctx, "fig", ...box, E.work) : fcBox(ctx, "fcFigure", ...box);
  if (!B) return;
  if (kept) kept.key = null;
  const x = B.x, ramp = [[12, 28, 32], [40, 76, 80], [120, 148, 146], [236, 226, 204]], ox = cx + size * 0.03, oy = cy - size * 0.08, R = size * 1.5, at2 = (q) => [ox + Math.cos(q) * R, oy + Math.sin(q) * R];
  x.lineJoin = "round"; x.lineWidth = Math.max(0.5, size * 0.002);
  for (const f of fcFold(S)) {   // each plane a wedge from the middle out past the edge, in one of four tones: paper in the light, two greys of the turn, the shade
    x.fillStyle = x.strokeStyle = css(ramp[Math.round(clamp((f.lit - 0.35) / 0.55) * 3)]);
    shapeOf(x, [[ox, oy], at2(f.a0), at2((f.a0 + f.a1) / 2), at2(f.a1)]); x.fill(); x.stroke();
  }
  x.globalCompositeOperation = "destination-in"; placeShape(x, S, [255, 255, 255], cx, cy, size);
  x.globalCompositeOperation = "destination-over"; placeShape(x, S, rim, cx + size * 0.005, cy - size * 0.003, size);   // the neon's rim along its edge, fine
  x.globalCompositeOperation = "source-over";
  fcBoxDown(ctx, B, a);
  if (kept) Object.assign(kept, { S, key, B, at, whole });
}
/**
 * The city behind (back(w) paints it at lamplight w), kept in store E (see fcStore, fcLayer) under `key` and the
 * lamplight: [[a canvas, how many pixels lower to lay it]]. Every colour in it is mixed by the lamplight in a
 * straight line, so in a draft in which the lamplight alone has moved since (its slider dragged) its two ends
 * are painted once and mixed at w (fcMix) — the same picture to a level, haze and all. All of it stands on the
 * street, whose line `by` (in whole pixels) the key leaves out: in a draft in which the street alone has moved,
 * what was painted is laid down as much lower or higher (what the canvas's edge cut off comes back as the slider
 * is let go). A still cover is painted at its lamplight, where it stands, and keeps that picture alone.
 */
function fcBack(ctx, E, key, w, by, back) {
  const st = E.back;
  if (st.key !== key || !isDraft()) Object.assign(st, { key, ends: false, by });
  else if (st.w !== w) st.ends = true;
  st.w = w;
  const dy = by - st.by, at = (lw) => (x) => { if (!dy) return back(lw)(x); const m = x.getTransform(); x.setTransform(m.a, m.b, m.c, m.d, m.e, m.f - dy); back(lw)(x); x.setTransform(m); };   // painted as if the street had not moved, to be laid down where it has
  if (st.ends) return [[fcMix(E, "mixBack", fcLayer(ctx, E, "back0", `${key}|${st.by}`, at(0)), fcLayer(ctx, E, "back1", `${key}|${st.by}`, at(1)), w), dy]];
  if (!isDraft()) { fcUnlayer(E, "back0"); fcUnlayer(E, "back1"); fcLoose(E, "mixBack"); }
  return [[fcLayer(ctx, E, "back", `${key}|${w}|${st.by}`, at(w)), dy]];
}
/** How far the folded capitals are set apart: a share of each glyph's own width. */
const FC_TRACK = 0.16;
export const facet = {
  id: "facet",
  art: "figure",
  repaint: (c) => `the photograph retold as a faceted low-poly illustration of a neo-noir film still: every surface built of hard-edged flat planes like folded paper, each facet one flat tone, crushed near-black shadows, a teal and cyan night against warm amber lamplight, ${c} neon glowing through haze and rain, diagonal shafts of light, a wide cinematic frame, quiet and moody; still the same subject, no text.`,
  about: {
    zh: "折面夜雨：把一部雨夜的新黑色电影，重新画成折纸般的低多边形平面插画——每个面都是一块平涂的硬边色块，像纸折出来的；阴影压成近乎纯黑，冷的青蓝世界里亮着暖琥珀色的灯，再点缀几处饱和的颜色。纸折出来的楼群，每栋一个受光面、一个背光面，亮着细小的窗格灯，层层雾霭，斜劈下来的硬边光柱，细密的雨丝，积水的街面把灯光倒映成被涟漪切开的竖条；雾里亮着巨大的霓虹字（频道色的灯管描边，里面贴着一根青色灯管），一架飞行器悬停着投下光束；可加百叶窗的光栅、折纸人物和宽银幕黑边。标题是字距拉开的电影片名式大写，每个字像被斜着折了一下——受光的一半是纸白，背光的一半偏冷灰；高亮字是频道色的霓虹灯管字。「暖光」把青色夜晚调向琥珀和橄榄色的室内灯光。安静、冷峻、有电影感——适合科幻、悬疑、城市、科技、影评、深夜与情绪类内容。照片会被切成一块块三角棱面，每块取它覆盖处的平均色，再调进夜色。浅色底是同一座城淡青色的雾晨，近处的楼在雾前显得深，几盏灯是暖的。自带平直的版式。",
    en: "Origami noir: a rain-soaked neo-noir film retold as faceted, low-poly flat illustration — every surface a hard-edged plane of one flat tone, as if folded from paper; shadows crushed to near black, a teal and cyan world against warm amber lamplight, a few saturated accents. A city of towers folded from paper, each a plane in light and a plane in shade, pricked with tiny lit windows, layers of haze, hard diagonal shafts of light, fine rain, the wet street mirroring the lights in streaks broken by the ripples; giant neon letters glowing through the mist (a tube of the channel colour round each, a cyan tube within), a craft hovering on its beam; venetian-blind light, a folded-paper figure and letterbox bars if you like. The title is set in widely spaced capitals as a film's titles are, each letter folded across — paper white where the light falls, a cool grey in the fold; the highlighted words are neon tubes in the channel colour. Lamplight turns the teal night to the amber and olive of a lit interior. Quiet, cool, cinematic — for science fiction, mystery, cities, technology, film, late nights and mood. A photo is cut into triangular facets, each the mean colour of what it covers, and graded into the night. The light ground is the same city on a pale teal morning of fog, the near towers dark against it, a few lamps warm. Flat layouts of its own.",
  },
  name: { zh: "折面夜雨", en: "Origami noir" },
  seeded: true,
  leave: fcFreeAll,   // what it keeps (each size's city, letters, figure and facets, its work canvases) goes as another look is chosen
  scene: { sign: { zh: "霓虹字", en: "Neon letters" }, craft: { zh: "飞行器", en: "Hover craft" }, shafts: { zh: "光柱", en: "Light shafts" }, figure: { zh: "折纸人物", en: "Folded figure" } },
  params: [
    { key: "towers", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "楼群", en: "Towers" } },
    { key: "windows", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "窗格灯", en: "Lit windows" } },
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "雾霭", en: "Haze" } },
    { key: "neon", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "霓虹字", en: "Neon letters" } },
    { key: "word", text: true, max: 8, def: "", name: { zh: "霓虹字内容", en: "The neon's letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "shafts", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "光柱", en: "Light shafts" } },
    { key: "rain", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "雨丝", en: "Rain" } },
    { key: "wet", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "积水倒影", en: "Wet ground" } },
    { key: "craft", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "飞行器", en: "Hover craft" } },
    { key: "blinds", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "百叶窗光", en: "Blind light" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "折纸人物", en: "Folded figure" } },
    { key: "warm", min: 0, max: 1, step: 0.05, def: 0.1, name: { zh: "暖光", en: "Lamplight" } },
    { key: "bars", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "宽银幕黑边", en: "Letterbox bars" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "facet", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "棱面大小", en: "Facet size" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片折面化", en: "Photo in facets" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.14, side: 0.28, strip: 0.1 }),
  theme: (base) => (dark
    ? { ...base, field: css(fcSky(0)[1]), text: css(FC.cream), own: css(FC.cream), dim: css(FC.cream, 0.6), titleFill: css(FC.cream), titleInk: css(FC.ink), grid: () => css([120, 196, 192], 0.13) }
    : { ...base, field: css(fcSky(0)[1]), text: css([16, 28, 32]), own: css([16, 28, 32]), dim: css([16, 28, 32], 0.6), titleFill: css([16, 28, 32]), titleInk: css([236, 240, 236]), grid: () => css([16, 40, 44], 0.12) }),
  /**
   * The sky in planes; the far towers, haze, the neon letters and the near towers with their mist (painted once
   * and kept until one of their sliders or the letters' place changes, see fcBack); then the shafts of light, the craft,
   * the wet ground mirroring it all, the blinds' light, the folded figure, the rain and the bars. A photo is
   * cut into facets and graded into the night; filling the canvas, it gets the shafts, the rain and the bars too.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), light = dark ? FC.lamp : [255, 255, 250];
    const shaftsAt = (y) => (p.shafts > 0 ? objAt("shafts", F.x0 + fw * 0.82, y, ctx, "x")[0] : 0);
    if (env.photo) {
      const a = p.photo, wm = p.warm;
      if (a < 1) env.drawPhoto(0, null);
      if (a > 0) env.drawPhoto(0, { key: `fc|${p.facet}`, cap: 1100, quickCap: 720, fn: (d, W, H, cut) => fcFacets(d, W, H, p.facet, undefined, Math.max(W, H) > 900, cut), draw: (x, M, X, Y, W, H) => fcPaint(x, M, X, Y, W, H, wm, a) });   // the photo itself in facets (see drawPhotoAt): cut from a copy 1100 px long and refined; while a slider makes new ones (its size dragged), from one 720 px long, unrefined
      if (L.fill) {   // light falling across it, the rain and the bars over it
        const all = { x0: 0, y0: 0, x1: w, y1: h };
        fcShafts(ctx, all, shaftsAt(F.y0), 1 + p.shafts * 3, p.shafts, light, 3560);
        fcRain(ctx, all, p.rain, 3590);
        fcBars(ctx, w, h, p.bars);
      }
      return true;
    }
    const wm = p.warm, rim = fcRim(C), tube = fcTube(rim), mt = canPaint(ctx) && ctx.getTransform(), up = mt && !mt.b && !mt.c && mt.d > 0, E = up && fcStore(ctx.canvas);   // E: what is kept for this canvas, if anything
    const base = up ? (Math.round((F.y1 - fh * 0.3 * p.wet) * mt.d + mt.f) - mt.f) / mt.d : F.y1 - fh * 0.3 * p.wet;   // the street's line, on whole pixels (see fcBack)
    if (L.ground !== false) fcGround(ctx, w, h, fcSky(wm), 3500);
    if (!L.grid) return true;
    const word = fcWord(p.word || env.cat.code || env.cat.name || "NOIR"), keep = fcKeep(ctx, env);
    const S0 = p.neon > 0 && word ? fcSignAt(ctx, F, base, fh * (0.16 + 0.22 * p.neon), word, keep) : null, [sx, sy] = S0 ? objAt("sign", S0.x, S0.y, ctx) : [0, 0], sH = S0 ? S0.H : 0, sA = S0 ? 1 : 0, sW = S0 ? S0.W : 0, sD = !!S0 && S0.down;   // a scene object, its foot behind the near towers (stacked down a blade: on a tower of its own)
    const pd = sH * 0.18, hw = (sW + 2 * pd) * 1.2;   // a blade's margin; half its tower's face
    const far = base - fh * (0.24 + 0.5 * p.towers), near = base - fh * (0.1 + 0.48 * p.towers), lx = sH > 0 ? sx : F.x0 + fw * 0.7, glow = sH > 0 ? rim : null;   // the light the towers turn to
    const back = (lw) => (x) => {   // the city behind, its haze and the neon letters at lamplight lw: kept on a layer of their own (see fcBack)
      const haze = fcHaze(lw);
      if (p.towers > 0) fcRow(x, F, far, base, { w: [0.045, 0.07], h: [0.25, 0.75], tall: 0.15, pin: true, share: 0.45, litK: 0.5, lx, glow, ...fcTones(0.1, lw) }, p.windows, 3510);
      if (p.haze > 0) {   // the city's own glow in the haze, rising behind the near towers, and a deep band of it lying across between the rows
        const gl = x.createLinearGradient(0, base, 0, far); gl.addColorStop(0, css(haze, 0.5 * p.haze)); gl.addColorStop(1, css(haze, 0));
        x.fillStyle = gl; x.fillRect(F.x0, far, F.x1 - F.x0, base - far);
        dkFogBand(x, F.x0, F.x1, base - (base - far) * 0.5, fh * 0.2, haze, 0.55 * p.haze, 3520);
      }
      if (sH > 0) {   // the neon letters (a blade on its tower), mist across their foot
        if (sD) fcHanger(x, sx - hw, sx + hw, sy - S0.T - pd - sH * 0.9, base, fcTones(0.5, lw), rim);
        fcSign(x, sx, sy, sH, word, rim, tube, Math.min(1, p.neon * 3) * (dark ? 1 : 0.8) * sA, 3530, E, sD);
        dkFogBand(x, F.x0, F.x1, sy - sH * 0.12, sH * 0.4, haze, 0.5 * p.haze, 3525);
      }
      if (p.towers > 0) fcRow(x, F, near, base, { w: [0.085, 0.13], h: [0.12, 0.88], tall: 0.14, share: 0.6, litK: 0.9, low: sH > 0 && (sD ? [sx - hw, sx + hw * 1.6, sy + pd] : [sx - sW / 2, sx + sW / 2, sy - sH * 0.15]), lx, glow, ...fcTones(0.8, lw) }, p.windows, 3540);
      dkFogBand(x, F.x0, F.x1, base, fh * 0.08, haze, 0.5 * p.haze, 3550);
    };
    if (p.towers > 0 || p.neon > 0 || p.haze > 0) {
      const kept = E && fcBack(ctx, E, [seed, dark, w, h, F.x0, F.y0, F.x1, F.y1, p.towers, p.windows, p.haze, p.neon, word, C.join(), sx.toFixed(1), (sy - base).toFixed(1), sH.toFixed(1), sA, sD, fonts.en, fonts.cn].join("|"), wm, Math.round(base * mt.d + mt.f), back);
      if (kept) for (const [img, dy] of kept) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(img, 0, dy); ctx.restore(); }
      else back(wm)(ctx);
    }
    if (p.shafts > 0) fcShafts(ctx, F, shaftsAt(F.y0), 1 + p.shafts * 3, p.shafts, light, 3560);   // a scene object, along the top
    if (p.craft > 0) {   // a scene object: the first of a few places in the sky clear of the title
      const s = u * (0.1 + 0.12 * p.craft), box = (x, y) => ({ x: x - s * 0.6, y: y - s * 0.3, w: s * 1.2, h: s * 0.5 }), keep = canPaint(ctx) ? [...keepClear(ctx, env), { x: 0, y: 0, w: Math.min(w, 900), h: 150 }] : [];
      const at = [[0.4, 0.2], [0.55, 0.12], [0.3, 0.32], [0.8, 0.14], [0.45, 0.45]].map(([a, b]) => [F.x0 + fw * a, F.y0 + fh * b]).find(([x, y]) => !keep.some((k) => overlaps(k, box(x, y)))) || [F.x0 + fw * 0.4, F.y0 + fh * 0.2];
      const [cx, cy] = objAt("craft", at[0], at[1], ctx);
      fcCraft(ctx, cx, cy, s, Math.min(1, p.craft * 4));
    }
    if (p.wet > 0) fcFloor(ctx, F, base, p.wet, rim, tube, sH > 0 ? { cx: sx, H: sH, word, a: Math.min(1, p.neon * 3) * sA, down: sD } : null, 3570);
    fcBlinds(ctx, F, p.blinds, light, 3580);
    if (p.figure > 0) {   // a scene object: on the street, or nearer on the wet street, at the first of its places clear of the words, the tag, the channel graphic and the neon, smaller if need be (to 0.4 of its size), else left out
      const S = canPaint(ctx) && graphicShape(env), size0 = Math.min(fh, fw * 0.7) * (0.25 + 0.4 * p.figure);
      if (S) {
        const b = S.box, half = ((b.x1 - b.x0) / Math.max(1, b.y1 - b.y0)) * 0.5 + 0.04, sb = S0 && { ...S0.box, x: S0.box.x + sx - S0.x, y: S0.box.y + sy - S0.y };   // half its width, for each unit of its height (see fcFigure)
        const clear = sb ? [...keep, sb] : keep, box = (x, foot, size) => ({ x: x - size * half, y: foot - size * 1.04, w: size * half * 2, h: size * 1.08 });
        const xs = [0.84, 0.62, 0.42, 0.2, 0.92, ...[...Array(24).keys()].map((i) => 0.96 - i * 0.04)].map((t) => F.x0 + fw * t), feet = [base, base + (F.y1 - base) * 0.7];
        const fits = ([x, foot], size) => x - size * half >= F.x0 && x + size * half <= F.x1 && !clear.some((k) => overlaps(k, box(x, foot, size)));
        let size = size0, at;
        while (size >= size0 * 0.4 && (at = feet.flatMap((foot) => xs.map((x) => [x, foot])).find((q) => fits(q, size))) === undefined) size *= 0.88;
        if (at !== undefined) {
          const [cx, cy] = objAt("figure", at[0], at[1] - size * 0.5, ctx);
          fcFigure(ctx, S, cx, cy, size, rim, Math.min(1, p.figure * 4), E);
        }
      }
    }
    fcRain(ctx, F, p.rain, 3590);
    fcBars(ctx, w, h, p.bars);
    fcLetGo(ctx);
    return true;
  },
  /** A triangle lattice, as a folded sheet's creases: lines across, and lines running each way at sixty degrees. */
  gridLines(ctx, env, color) {
    const { w, h } = env, r = 104;
    gridPen(ctx, color);
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) slantPath(ctx, w, h, a, r);
    ctx.restore();
  },
  accent: {
    fill: () => css(dark ? [8, 18, 21] : [200, 210, 207]), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** The block as a slab of wet street: the city's lights mirrored in it in broken streaks, and along its edge a tube of the neon, glowing. */
    edge(ctx, run, nx, ny, C) {
      const rim = fcRim(C), at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      for (let j = 0; j < 3; j++) {   // each light a thin streak down the wet street, fading by steps
        const dash = []; for (let q = 0; q < 16; q++) dash.push(1.5 + rand(3600 + j * 50 + q) * 3.5, 40 + rand(3601 + j * 50 + q * 1.7) ** 1.5 * 240);
        ctx.setLineDash(dash); ctx.lineDashOffset = rand(3602 + j) * 400; ctx.strokeStyle = css(j === 1 ? rim : j ? FC.cyan : FC.amber, dark ? 0.3 : 0.32);
        for (let q = 0; q < 4; q++) { ctx.globalAlpha = 1 - q * 0.28; ctx.lineWidth = 26; at(16 + q * 26 + j * 6); }
        ctx.globalAlpha = 1;
      }
      ctx.setLineDash([]); ctx.lineDashOffset = 0;
      for (const [lw, a] of [[30, 0.07], [14, 0.16], [6, 0.4]]) { ctx.strokeStyle = css(rim, dark ? a : a * 0.6); ctx.lineWidth = lw; at(0); }
      ctx.strokeStyle = css(rim); ctx.lineWidth = 3; at(0);
      ctx.strokeStyle = css(mix(rim, [255, 255, 255], 0.65)); ctx.lineWidth = 1.1; at(0);
    },
  },
  /**
   * Capitals set wide, as a film's titles are, each letter folded across: the part above the fold lit, the
   * part below a cooler shade (on the light ground, two shades of the night's ink), a dark keyline (the
   * outline slider) and a hard drop behind (the shadow slider), a soft dark round them so they hold over the
   * city. The highlighted words are neon: tubes of the channel colour round a pale body, glowing.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt || 0), k = o.strokeAmt || 0, T = 1 + FC_TRACK;
    const rim = o.hi || fcRim(o.C || FC.red), core = o.hi ? mix(o.hi, [255, 255, 255], 0.6) : mix(fcTube(rim), [255, 255, 255], 0.4);
    const lit = o.fill || (dark ? FC.cream : [50, 70, 74]), shade = o.fill ? mix(o.fill, FC.ink, 0.3) : dark ? FC.fold : [14, 24, 28];
    const chars = [];
    let cx = 0;
    pass((a, at) => { cx = at * T; for (const t of a.t) { const w = ctx.measureText(t).width; chars.push({ t, hi: a.hi, x: cx, w, s: a.s, dy: (a.dy || 0) * T }); cx += w * T; } });
    ctx.scale(1 / T, 1 / T);
    const each = (fn, only) => { for (const c of chars) if (only === undefined || c.hi === only) inPiece(c, () => fn(c, c.x)); };
    if (!canPaint(ctx)) { each((c, x) => { ctx.fillStyle = css(c.hi ? rim : lit); ctx.fillText(c.t, x, 0); }); return; }   // nothing to work on: the letters plain
    ctx.lineJoin = "round";
    if (!fast) {   // a soft dark round the letters, so they hold over the lights; the neon's own glow
      blurred(ctx, fs * 0.12, css(dark ? FC.ink : [236, 240, 236], dark ? 0.6 : 0.5), () => each((c, x) => ctx.fillText(c.t, x, 0)));
      if (chars.some((c) => c.hi)) { ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "source-over"; blurred(ctx, fs * 0.3, css(rim, dark ? 0.75 : 0.55), () => each((c, x) => ctx.fillText(c.t, x, 0), true)); ctx.restore(); }
    }
    if (s > 0) { const [dx, dy] = fall(fs * 0.03 * s, fs * 0.045 * s); ctx.fillStyle = css(dark ? FC.ink : [150, 168, 168], dark ? 0.9 : 0.8); each((c, x) => ctx.fillText(c.t, x + dx, dy)); }
    if (k > 0) { ctx.strokeStyle = css(dark ? FC.ink : [236, 240, 236]); ctx.lineWidth = fs * 0.05 * k; each((c, x) => ctx.strokeText(c.t, x, 0)); }
    // the folded letters: each lit, then the part below its fold in shade
    each((c, x) => { ctx.fillStyle = css(lit); ctx.fillText(c.t, x, 0); }, false);
    ctx.fillStyle = css(shade);
    chars.forEach((c, i) => {
      if (c.hi) return;
      const z = fs * (c.s || 1), j = rand(3620 + i * 1.7) - 0.5, l = -z * (0.3 + 0.12 * j), r = -z * (0.66 + 0.1 * j), pad = z * 0.2;
      ctx.save(); ctx.beginPath(); ctx.moveTo(c.x - pad, l + (r - l) * (-pad / (c.w || 1))); ctx.lineTo(c.x + c.w + pad, r + (r - l) * (pad / (c.w || 1))); ctx.lineTo(c.x + c.w + pad, z * 0.4); ctx.lineTo(c.x - pad, z * 0.4); ctx.closePath(); ctx.clip();
      inPiece(c, () => ctx.fillText(c.t, c.x, 0));
      ctx.restore();
    });
    // the neon: glow, the pale body, the tube round it; on the fog, as a sign seen by day, a dark edge round the tube and a white-hot core within
    for (const [lw, a] of [[0.12, 0.14], [0.06, 0.3]]) { ctx.strokeStyle = css(rim, dark ? a : a * 0.5); ctx.lineWidth = fs * lw; each((c, x) => ctx.strokeText(c.t, x, 0), true); }
    if (dark) {
      ctx.fillStyle = css(core); each((c, x) => ctx.fillText(c.t, x, 0), true);
      ctx.strokeStyle = css(rim); ctx.lineWidth = fs * 0.03; each((c, x) => ctx.strokeText(c.t, x, 0), true);
    } else {   // by day: letters of dark glass, a dark edge round them, the tube along it lit and its core white-hot
      ctx.strokeStyle = css(FC.ink, 0.9); ctx.lineWidth = fs * 0.1; each((c, x) => ctx.strokeText(c.t, x, 0), true);
      ctx.fillStyle = css(mix([22, 34, 38], rim, 0.14)); each((c, x) => ctx.fillText(c.t, x, 0), true);
      ctx.strokeStyle = css(rim); ctx.lineWidth = fs * 0.05; each((c, x) => ctx.strokeText(c.t, x, 0), true);
      ctx.strokeStyle = css(mix(rim, [255, 255, 255], 0.72)); ctx.lineWidth = fs * 0.016; each((c, x) => ctx.strokeText(c.t, x, 0), true);
    }
  },
  // objects are folded of the night's planes: faces in teal greys, the colour as neon, a fine dark line; on the night the small parts' ink is paper
  wrap: (ctx, C, p, plates) => (plates
    ? (dark ? mapped(ctx, { fill: { ink: FC.cream }, stroke: { ink: FC.cream } }) : ctx)
    : mapped(ctx, { fill: { ink: FC.ink, light: dark ? [204, 220, 214] : [238, 240, 234], mid: dark ? [80, 120, 120] : [150, 168, 166], dark: dark ? [16, 36, 40] : [62, 80, 84], colour: (c) => fcRim(c) }, stroke: { ink: FC.ink, light: FC.cream }, line: 0.7 })),
  sticker: painters({ line: FC.ink, lineScale: 0.6, tone: inkAs(FC.ink, (c) => fcRim(c)), shadow(ctx, draw) { ctx.save(); ctx.translate(6, 8); draw(css(FC.ink, 0.8)); ctx.restore(); } }),
  /** The corner tag: a slab with its corner folded over, spaced capitals, a line of the neon along its foot. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6, rim = fcRim(C);
    ctx.font = `400 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 6) + f * 1.3, h = f * 1.5, top = y + (fs * 1.34 - h), c = h * 0.32, slab = dark ? [10, 24, 28] : [228, 234, 230];
    ctx.fillStyle = css(slab); shapeOf(ctx, [[x, top], [x + w - c, top], [x + w, top + c], [x + w, top + h], [x, top + h]]); ctx.fill();
    ctx.fillStyle = css(dark ? [70, 108, 110] : [176, 190, 188]); shapeOf(ctx, [[x + w - c, top], [x + w - c, top + c], [x + w, top + c]]); ctx.fill();   // the corner, folded back
    ctx.fillStyle = css(rim); ctx.fillRect(x, top + h - 3, w, 3);
    ctx.fillStyle = ink || css(dark ? FC.cream : [16, 28, 32]); spaced(ctx, str, x + f * 0.65, top + h * 0.5 + f * 0.36, 6);
    return { x: x - 8, y: top - 8, w: w + 16, h: h + 16 };
  },
  /** The frame layer: a fine bracket at each corner, a small folded triangle in its angle. */
  frame(ctx, env) {
    const { w, h } = env, b = 30, L = 64, s = 14, col = dark ? [214, 228, 222] : [24, 38, 42];
    ctx.save(); ctx.strokeStyle = css(col, 0.75); ctx.lineWidth = 2; ctx.lineJoin = "miter"; ctx.fillStyle = css(col, 0.5);
    for (const [x, y, sx, sy] of [[b, b, 1, 1], [w - b, b, -1, 1], [w - b, h - b, -1, -1], [b, h - b, 1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke();
      shapeOf(ctx, [[x + sx * 6, y + sy * 6], [x + sx * (6 + s), y + sy * 6], [x + sx * 6, y + sy * (6 + s)]]); ctx.fill();
    }
    ctx.restore();
  },
  /** The plate under a text layer: a slab with its corner folded over. */
  plate(ctx, x, y, w, h, colour, fs) {
    const c = Math.min(h * 0.45, fs * 0.3);
    ctx.save(); ctx.translate(...fall(fs * 0.04, fs * 0.06)); shapeOf(ctx, [[x, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h]]); ctx.fillStyle = css(FC.ink, dark ? 0.8 : 0.3); ctx.fill(); ctx.restore();
    shapeOf(ctx, [[x, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h]]); ctx.fillStyle = colour; ctx.fill();
    shapeOf(ctx, [[x + w - c, y], [x + w - c, y + c], [x + w, y + c]]); ctx.fillStyle = css(dark ? [255, 255, 255] : [0, 0, 0], 0.22); ctx.fill();
  },
  image(ctx, C, unit) { ctx.shadowColor = css(FC.ink, dark ? 0.8 : 0.35); ctx.shadowBlur = 0; ctx.shadowOffsetX = 6 * unit; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * (dark ? 0.8 : 0.4) * (0.35 + 0.65 * clamp(unit)), unit); vignette(ctx, w, h, dark ? [1, 5, 7] : [70, 90, 94], dark ? 0.55 : 0.2, 0.4); },   // the grain as fine on a thumbnail as on the cover
  prompt: `Objects from a rain-soaked neo-noir city at night, as a faceted low-poly illustration — quiet, cool, cinematic — that read at a glance:
- one clear object per sticker (a trench coat, a fedora, a rotary phone, an umbrella, a paper crane, a desk lamp, a ceiling fan, a noodle bowl, a hover car, a neon sign, a camera), with a strong, angular silhouette built of hard-edged flat planes, as if folded from paper; no realism, no fine detail;
- flat colour only: each facet one tone, deep teal and slate for the shadowed planes, a warm amber for one lit plane, and the main colour for one accent, as neon;
- the app adds a fine dark line and a hard dark shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from a neo-noir city at night, built as simple models from a few boxes and wedges — a tower with a slanted roof, a hovering car, a street lamp, a vending machine, a neon sign box, an umbrella; no realism, no fine detail.
- the renderer paints faces in the night's teal greys with a fine dark line, every face one flat tone, as folded paper: do NOT try to draw shading or outlines yourself;
- "white" is a pale teal paper, "dark" a deep teal near black, and "main" the neon (the channel colour) — use it for one to three parts.`,
};
/** How much pixel i of RGBA data d is of lettering's neon: vivid and bright (a tube, its glow), 0–1. */
function fcNeon(d, i) {
  const r = d[i], g = d[i + 1], b = d[i + 2], mx = r > g ? (r > b ? r : b) : g > b ? g : b, mn = r < g ? (r < b ? r : b) : g < b ? g : b;
  return clamp(((mx - mn) / (mx || 1) - 0.45) * 4) * clamp((mx - 115) / 64);
}
/**
 * Where lettering's neon is, on the w × h canvas src, as a canvas of the same size whose alpha says how much (kept
 * in slot fcTubes): its vivid, bright pixels (fcNeon), and a white-hot core within a tube — a bright pixel with neon
 * within r pixels on either side of it, across or up and down.
 */
function fcNeonMask(src, w, h, r) {
  const id = src.getContext("2d").getImageData(0, 0, w, h), d = id.data, n = new Float32Array(w * h);
  for (let p = 0, i = 0; p < n.length; p++, i += 4) if (d[i + 3]) n[p] = fcNeon(d, i);
  const near = (p, x, y, dx, dy) => { for (let j = 1; j <= r; j++) { const u = x + dx * j, v = y + dy * j; if (u < 0 || v < 0 || u >= w || v >= h) return false; if (n[p + (dy * w + dx) * j] > 0.5) return true; } return false; };
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const i = p * 4, a = n[p];
    d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = 255 * (a < 0.5 && d[i + 3] && Math.max(d[i], d[i + 1], d[i + 2]) > 190 && ((near(p, x, y, -1, 0) && near(p, x, y, 1, 0)) || (near(p, x, y, 0, -1) && near(p, x, y, 0, 1))) ? 1 : a);
  }
  const c = fxCanvas("fcTubes", w, h);
  c.getContext("2d").putImageData(id, 0, 0);
  return c;
}
facet.elementFx = [
  { key: "facets", name: { zh: "折纸棱面", en: "Folded facets" }, for: FX_ALL, stage: "fill", sub: [{ key: "size", name: { zh: "棱面大小", en: "Facet size" }, def: 0.3 }],
    /**
     * The layer cut into flat triangles, each the mean of the colours it covers and turned a little to or from the
     * light (see fcFacets): folded of paper, its outline kept. Worked out on a copy of the layer at a size of its
     * own (a share of its size in units, 720 px at most on its longer side), so the preview and an export cut the
     * same facets; a long, low layer (a line of text) cut finer, by its height. On lettering its neon (see
     * fcNeonMask: the tubes, their glow, a white-hot core) is left out of the facets, of their colours and of where
     * they lie, so the layer shows there as it was painted: the facets fill the letters, the tubes stay crisp, the
     * glow its own, and no facet tinted by a tube spikes out of it.
     */
    paint(x, B, a, E, o) {
      const src = region(x, B, "fxA"), uw = B.w / E.k, uh = B.h / E.k, f = Math.min(0.6, 720 / Math.max(uw, uh)), aw = Math.max(8, Math.round(uw * f)), ah = Math.max(8, Math.round(uh * f));
      const A = WORK.fcFx || (WORK.fcFx = document.createElement("canvas"));
      if (A.width !== aw || A.height !== ah) { A.width = aw; A.height = ah; }
      const ax = A.getContext("2d", { willReadFrequently: true });
      ax.setTransform(1, 0, 0, 1, 0, 0); ax.globalCompositeOperation = "copy"; ax.imageSmoothingQuality = "high"; ax.drawImage(src, 0, 0, B.w, B.h, 0, 0, aw, ah); ax.globalCompositeOperation = "source-over";
      const text = E.type === "text", d = ax.getImageData(0, 0, aw, ah).data;
      if (text) for (let i = 0; i < d.length; i += 4) d[i + 3] *= 1 - fcNeon(d, i);   // the neon no part of the facets' colours
      const M = fcFacets(d, aw, ah, o.size, Math.min(Math.max(aw, ah), Math.min(aw, ah) * 2)), g = fxCanvas("fcFacets", B.w, B.h).getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.clearRect(0, 0, B.w, B.h);
      fcPaint(g, M, 0, 0, B.w, B.h, null, 1);
      g.globalCompositeOperation = "destination-in"; g.drawImage(src, 0, 0);
      if (text) { g.globalCompositeOperation = "destination-out"; g.drawImage(fcNeonMask(src, B.w, B.h, Math.max(2, Math.ceil(E.k * 2.5))), 0, 0); }   // nor where it is: there the layer as painted
      g.globalCompositeOperation = "source-over";
      x.save(); x.globalAlpha = a; x.drawImage(g.canvas, B.x0, B.y0); x.restore();
      fcLetGo(x);   // on a canvas larger than any on the page (an export), its canvases let go
    } },
  { key: "neon", name: { zh: "霓虹描边", en: "Neon outline" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 70 * k, t: 70 * k, r: 70 * k, b: 70 * k }),
    /** A tube of the neon round the layer, as the sign's letters have: a wide haze of the channel colour, a tight bright line, a pale core. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), rim = fcRim(E.C); glowBehind(x, B, src, 28 * E.k * (0.4 + a), 0.7 * a, rim); glowBehind(x, B, src, 4 * E.k * (0.6 + a), Math.min(1, a * 2.5), rim); glowBehind(x, B, src, 1.4 * E.k, Math.min(1, a * 2.5), mix(rim, [255, 255, 255], 0.6)); } },
  { key: "blinds", name: { zh: "百叶窗光", en: "Blind light" }, for: FX_ALL, stage: "over",
    /** Light through venetian blinds across the layer: slanted bars of lamplight on it and only on it, screened on. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), pitch = Math.max(6, Math.min(B.w, B.h) * 0.11), th = pitch * (0.32 + 0.22 * a);
      onLayer(x, B, src, "screen", Math.min(1, a * 1.4), (g) => {
        g.fillStyle = css(FC.lamp, 0.5); g.beginPath();
        for (let y = -B.w * 0.4 + E.R(3) * pitch; y < B.h; y += pitch) { g.moveTo(0, y); g.lineTo(B.w, y + B.w * 0.32); g.lineTo(B.w, y + B.w * 0.32 + th); g.lineTo(0, y + th); g.closePath(); }
        g.fill();
      });
    } },
  { key: "night", name: { zh: "雨夜分调", en: "Rain-night grade" }, for: FX_PHOTO, stage: "filter",
    /** The photo graded into the night as the look grades its facets (see fcGrade): the blacks crushed, teal and amber, a strong red kept. */
    paint(x, B, a) {   // under this look the photo is in the night already: read by value, so it is not crushed twice
      const img = x.getImageData(B.x0, B.y0, B.w, B.h), d = img.data, c = [0, 0, 0], own = current.id === "facet", w = own ? values.warm || 0 : 0.1;
      for (let i = 0, n = d.length; i < n; i += 4) {
        if (!d[i + 3]) continue;
        fcGrade(d[i], d[i + 1], d[i + 2], w, 0, c, undefined, own);
        d[i] += (c[0] - d[i]) * a; d[i + 1] += (c[1] - d[i + 1]) * a; d[i + 2] += (c[2] - d[i + 2]) * a;
      }
      x.putImageData(img, B.x0, B.y0);
    } },
];
