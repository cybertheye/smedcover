// drawCover(): paints one cover onto a canvas by walking its layer stack, bottom to top.
// A pure function of its options — the app calls it for the canvas, the thumbnails, exports and
// batch jobs alike.
import { INK, fonts, rgb, mixc, BLK, clamp, toneField, spaced, spacedW, para, brackets } from "./cel.js";
import { virtualSize, layout } from "./layout.js";
import { drawTitle, parseTitle } from "./title.js";
import { drawPhoto } from "./photo.js";
import { drawAsset } from "./assets.js";
import { resolve } from "./layers.js";

export const sizeKey = (size) => `${size.w}x${size.h}`;
export const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  const n = m ? parseInt(m[1], 16) : 0xfcee0a;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const IDENTITY = { dx: 0, dy: 0, s: 1 };
const RAD = Math.PI / 180;
const pad2 = (n) => String(n).padStart(2, "0");

const THEMES = {
  dark: { field: "#0a0a12", text: "#ffffff", dim: "rgba(255,255,255,.5)", titleFill: "#ffffff", titleInk: INK, grid: (C) => rgb(C, 0.16) },
  light: { field: "#f3f2ec", text: INK, dim: "rgba(7,7,12,.55)", titleFill: INK, titleInk: "#ffffff", grid: () => "rgba(7,7,12,.10)" },
};

function polygon(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.closePath();
}
function grid(ctx, color, w, h) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;   // 1px lines drop out when a cover is viewed scaled down
  ctx.beginPath();
  for (let x = 20; x < w; x += 60) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
  for (let y = 20; y < h; y += 60) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
  ctx.stroke();
}
// accent plate with an offset white shadow; (x, y) = top-left
function accentTag(ctx, str, x, y, fs, acc) {
  ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34;
  ctx.fillStyle = "#fff"; para(ctx, x + 8, y + 8, w, h, -fs * 0.22); ctx.fill();
  ctx.fillStyle = acc; para(ctx, x, y, w, h, -fs * 0.22); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.lineJoin = "miter"; ctx.stroke();
  ctx.fillStyle = INK; spaced(ctx, str, x + fs * 0.55, y + h * 0.5 + fs * 0.4, 3);
  return { x: x - fs * 0.22, y, w: w + fs * 0.44 + 8, h: h + 8 };
}

function drawHeader(ctx, o, w, th, C, onAccentRight, rail) {
  const { profile: P, catIndex: i } = o, cat = P.categories[i], total = P.categories.length, acc = rgb(C);
  const box = { x: 66, y: 64, w: 0, h: 52 };
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  let x = 72;
  if (P.brand.name) {
    ctx.fillStyle = th.text; ctx.font = `700 50px ${fonts.en}, ${fonts.cn}`;
    x += spaced(ctx, P.brand.name, x, 108, 3) + 28;
  }
  if (cat.code) {
    ctx.font = `700 23px ${fonts.mono}, ${fonts.cn}`;
    const cw = ctx.measureText(cat.code).width + 26;
    ctx.fillStyle = acc; ctx.fillRect(x, 72, cw, 34);
    ctx.fillStyle = INK; ctx.fillText(cat.code, x + 13, 97);
    x += cw + 18;
  }
  const unit = [P.brand.unit, total > 1 ? `${pad2(i + 1)} / ${pad2(total)}` : ""].filter(Boolean).join(" ");
  if (unit) { ctx.fillStyle = onAccentRight ? th.text : rgb(C, 0.9); ctx.font = `600 21px ${fonts.mono}, ${fonts.cn}`; x += spaced(ctx, unit, x, 97, 3); }
  box.w = Math.max(60, x - box.x + 8);
  if (!rail || total < 2) return box;
  if (onAccentRight) {   // the right end sits on the accent panel: an ink tag instead of the colour rail
    const s = `${pad2(i + 1)}/${pad2(total)}`;
    ctx.font = `700 44px ${fonts.en}`;
    const tw = spacedW(ctx, s, 4) + 48;
    ctx.fillStyle = INK; para(ctx, w - 72 - tw, 60, tw, 58, -10); ctx.fill();
    ctx.fillStyle = acc; spaced(ctx, s, w - 72 - tw + 24, 60 + 45, 4);
    return box;
  }
  const seg = Math.min(58, Math.max(18, 420 / total)), bar = seg - 8;
  P.categories.forEach((c, j) => {
    ctx.fillStyle = rgb(hexToRgb(c.color), j === i ? 1 : 0.35);
    ctx.fillRect(w - 72 - total * seg + 8 + j * seg, j === i ? 86 : 92, bar, j === i ? 12 : 6);
  });
  return box;
}

function drawCategory(ctx, cat, G, C, show) {
  const acc = rgb(C), c = G.cat;
  let x = c.x, nameW = 0, fs = c.fs;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  if (show.name && cat.name) {
    const glyphs = [...cat.name];
    const widthAt = (f) => { ctx.font = `900 ${f}px ${fonts.cn}`; return glyphs.reduce((s, g) => s + ctx.measureText(g).width + 6, -6); };
    const full = widthAt(fs);
    if (full > c.maxW) fs = Math.max(36, Math.floor((fs * c.maxW) / full));
    nameW = widthAt(fs);
    ctx.save();
    ctx.translate(x, c.y);
    ctx.transform(1, 0, -0.1, 1, 0, 0);
    const each = (fn) => { let cx = 0; for (const g of glyphs) { fn(g, cx); cx += ctx.measureText(g).width + 6; } };
    if (c.onAccent) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.03; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); }); }
    else {
      ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.09; each((g, cx) => ctx.strokeText(g, cx, 0));
      ctx.fillStyle = ctx.strokeStyle = acc; ctx.lineWidth = fs * 0.02; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); });
    }
    ctx.restore();
  }
  const nameBox = nameW ? { x: x - 6, y: c.y - fs * 0.95, w: nameW + 12, h: fs * 1.12 } : null;
  if (!show.plate || !cat.sub) return nameBox;
  const pf = c.inline ? Math.round(fs * 0.5) : 44, ph = Math.round(pf * 1.22);
  ctx.font = `700 ${pf}px ${fonts.en}, ${fonts.cn}`;
  const pw = spacedW(ctx, cat.sub, 5) + pf * 0.9;
  const px = c.inline && nameW ? x + nameW + 34 : x - 4, py = c.inline ? c.y - fs * 0.36 - ph / 2 : nameW ? c.y + 26 : c.y - ph;
  ctx.fillStyle = c.onAccent ? INK : acc; para(ctx, px, py, pw, ph, -pf * 0.18); ctx.fill();
  ctx.fillStyle = c.onAccent ? acc : INK; spaced(ctx, cat.sub, px + pf * 0.45, py + ph * 0.5 + pf * 0.38, 5);
  if (!nameBox) return { x: px, y: py, w: pw, h: ph };
  const x0 = Math.min(nameBox.x, px), y0 = Math.min(nameBox.y, py), x1 = Math.max(nameBox.x + nameBox.w, px + pw), y1 = Math.max(nameBox.y + nameBox.h, py + ph);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---------- colour block & dividing edge
// The template gives the block as a polygon whose first two points are the dividing edge (A -> B)
// and a normal (nx, ny) pointing away from the block. A shape re-draws that edge.
const noise = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function edgePoints(shape, A, B, nx, ny) {
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const at = (u, off = 0) => [A[0] + (B[0] - A[0]) * u + nx * off, A[1] + (B[1] - A[1]) * u + ny * off];
  const sample = (n, fn) => Array.from({ length: n + 1 }, (_, i) => at(i / n, fn(i / n, i)));
  switch (shape) {
    case "zigzag": { const n = Math.max(4, Math.round(len / 90)); return sample(n, (u, i) => (i % 2 ? 22 : -22)); }
    case "wave": return sample(96, (u) => 24 * Math.sin((u * len * Math.PI * 2) / 420));
    case "steps": { const n = Math.max(3, Math.round(len / 240)), pts = []; for (let i = 0; i < n; i++) { const o = i % 2 ? -24 : 24; pts.push(at(i / n, o), at((i + 1) / n, o)); } return pts; }
    case "torn": return sample(Math.max(40, Math.round(len / 18)), (u, i) => (noise(i * 1.7) - 0.5) * 30 + (noise(Math.floor(i / 5) * 0.31) - 0.5) * 26);
    case "chevron": { const d = 110 / len; return [at(0), at(0.5 - d), at(0.5, 74), at(0.5 + d), at(1)]; }
    case "scallop": { const n = Math.max(3, Math.round(len / 150)); return sample(n * 12, (u) => 34 * Math.abs(Math.sin(u * n * Math.PI)) - 10); }
    default: return [at(0), at(1)];
  }
}
function strokeEdge(ctx, pts, nx, ny, sharp, lw = 16) {
  const run = (ox, oy) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + ox, p[1] + oy) : ctx.moveTo(p[0] + ox, p[1] + oy))); ctx.stroke(); };
  ctx.lineCap = "butt"; ctx.lineJoin = sharp ? "miter" : "round";
  ctx.strokeStyle = INK; ctx.lineWidth = lw; run(0, 0);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; run(nx * (lw / 2 + 16), ny * (lw / 2 + 16));
}
/** Paints the colour block in `shape`. Returns its bounding box as a hit entry. */
export function paintAccent(ctx, shape, G, C) {
  const acc = rgb(C), { nx, ny } = G.edge;
  let [A, B] = [G.accent[0], G.accent[1]];
  const axis = ny ? 1 : 0;                                   // the coordinate the edge is slanted in
  if (shape === "flat") { const m = (A[axis] + B[axis]) / 2; A = [...A]; B = [...B]; A[axis] = B[axis] = m; }
  if (shape === "reverse") { A = [...A]; B = [...B]; [A[axis], B[axis]] = [B[axis], A[axis]]; }
  const inset = shape === "double" ? 52 : 0, shift = (p, d) => [p[0] - nx * d, p[1] - ny * d];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]), dx = (B[0] - A[0]) / len, dy = (B[1] - A[1]) / len;
  // run the edge a little past both ends so its inked stroke leaves the canvas cleanly
  const ext = (pts) => [[pts[0][0] - dx * 20, pts[0][1] - dy * 20], ...pts, [pts[pts.length - 1][0] + dx * 20, pts[pts.length - 1][1] + dy * 20]];
  const edge = ext(edgePoints(shape, shift(A, inset), shift(B, inset), nx, ny));
  const block = [...edge, ...G.accent.slice(2)];
  const xs = G.accent.map((p) => p[0]), ys = G.accent.map((p) => p[1]);
  const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
  polygon(ctx, block); ctx.fillStyle = acc; ctx.fill();
  ctx.save(); polygon(ctx, block); ctx.clip();
  toneField(ctx, bx - 60, by - 60, bx + bw + 60, by + bh + 60, 28, rgb(mixc(C, BLK, 0.24)), (x, y) => ((y - by) / bh) * 1.15 - 0.4 + (x - bx) / (bw * 2.6));
  if (shape === "stripes") {                                 // hazard band just inside the edge
    polygon(ctx, ext([A, B]).concat(ext([shift(A, 46), shift(B, 46)]).reverse())); ctx.clip();
    ctx.fillStyle = INK;
    for (let d = -80; d < len + 80; d += 46) { polygon(ctx, [[A[0] + dx * d, A[1] + dy * d], [A[0] + dx * (d + 23), A[1] + dy * (d + 23)], shift([A[0] + dx * (d - 23), A[1] + dy * (d - 23)], 46), shift([A[0] + dx * (d - 46), A[1] + dy * (d - 46)], 46)]); ctx.fill(); }
  }
  ctx.restore();
  if (shape === "stripes") { ctx.strokeStyle = INK; ctx.lineWidth = 8; const q = ext([shift(A, 46), shift(B, 46)]); ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[q.length - 1]); ctx.stroke(); }
  if (shape === "double") {                                  // a detached band of the same colour, then the block
    const band = ext([A, B]);
    polygon(ctx, band.concat(ext([shift(A, 24), shift(B, 24)]).reverse())); ctx.fillStyle = acc; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.lineJoin = "miter"; ctx.stroke();
    ctx.lineWidth = 10; ctx.beginPath(); edge.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(band[0][0] + nx * 22, band[0][1] + ny * 22); ctx.lineTo(band[3][0] + nx * 22, band[3][1] + ny * 22); ctx.stroke();
  } else strokeEdge(ctx, edge, nx, ny, ["zigzag", "steps", "chevron"].includes(shape));
  return { cx: bx + bw / 2, cy: by + bh / 2, hw: bw / 2, hh: bh / 2, r: 0 };
}

// ---------- layer painters. Each returns the box it covers for hit-testing:
// {cx, cy, hw, hh, r} = centre, half-extents and rotation in virtual units (or null).

/** Runs `fn` moved / scaled / rotated about the pivot (px, py); maps the local box it returns to the canvas. */
function placed(ctx, px, py, tr, fn) {
  const a = tr.r * RAD;
  ctx.save();
  ctx.translate(px + tr.dx, py + tr.dy); ctx.rotate(a); ctx.scale(tr.s, tr.s); ctx.translate(-px, -py);
  const box = fn();
  ctx.restore();
  if (!box) return null;
  const lx = box.x + box.w / 2 - px, ly = box.y + box.h / 2 - py;
  return { cx: px + tr.dx + (lx * Math.cos(a) - ly * Math.sin(a)) * tr.s, cy: py + tr.dy + (lx * Math.sin(a) + ly * Math.cos(a)) * tr.s, hw: (box.w / 2) * tr.s, hh: (box.h / 2) * tr.s, r: tr.r };
}
/** Same for things drawn around their own centre (assets, free text). */
function centred(ctx, cx, cy, s, r, fn) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(r * RAD); ctx.scale(s, s);
  const half = fn();
  ctx.restore();
  return half ? { cx, cy, hw: half.hw * s, hh: half.hh * s, r } : null;
}

// free text: nominal 120-unit type, centred on the origin
function drawFreeText(ctx, L, env) {
  const lines = parseTitle(L.text);
  if (!lines.length) return null;
  const FS = 120, LH = 1.16, plate = L.look === "plate";
  ctx.font = plate ? `700 ${FS}px ${fonts.en}, ${fonts.cn}` : `900 ${FS}px ${fonts.cn}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const widths = lines.map((l) => l.reduce((s, a) => s + ctx.measureText(a.t).width, 0)), bw = Math.max(...widths), bh = lines.length * FS * LH;
  const fill = { white: "#ffffff", accent: env.acc, ink: INK }[L.color], pad = plate ? FS * 0.32 : 0;
  if (plate) {
    ctx.fillStyle = INK; para(ctx, -bw / 2 - pad + 10, -bh / 2 - pad * 0.3 + 10, bw + pad * 2, bh + pad * 0.6, -FS * 0.14); ctx.fill();
    ctx.fillStyle = fill; para(ctx, -bw / 2 - pad, -bh / 2 - pad * 0.3, bw + pad * 2, bh + pad * 0.6, -FS * 0.14); ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = INK; ctx.stroke();
  }
  const textFill = plate ? (L.color === "ink" ? env.acc : INK) : fill, d = FS * 0.062;
  lines.forEach((line, li) => {
    ctx.save();
    ctx.translate(-widths[li] / 2, -bh / 2 + li * FS * LH + FS * (plate ? 0.94 : 0.9));
    if (!plate) ctx.transform(1, 0, -0.08, 1, 0, 0);
    const pass = (fn) => { let cx = 0; for (const a of line) { fn(a, cx); cx += ctx.measureText(a.t).width; } };
    if (L.look === "title") {
      pass((a, cx) => { ctx.fillStyle = ctx.strokeStyle = a.hi ? "#ffffff" : L.color === "accent" ? "#ffffff" : env.acc; ctx.lineWidth = FS * 0.04; ctx.strokeText(a.t, cx + d, d); ctx.fillText(a.t, cx + d, d); });
      pass((a, cx) => { ctx.strokeStyle = L.color === "ink" ? "#ffffff" : INK; ctx.lineWidth = FS * 0.075; ctx.strokeText(a.t, cx, 0); });
    }
    pass((a, cx) => { ctx.fillStyle = a.hi && !plate ? (L.color === "accent" ? "#ffffff" : env.acc) : textFill; ctx.fillText(a.t, cx, 0); });
    ctx.restore();
  });
  return { hw: bw / 2 + pad, hh: bh / 2 + pad * 0.3 };
}

const PAINT = {
  bg(ctx, L, tr, env) {
    const { w, h, th } = env;
    ctx.fillStyle = th.field; ctx.fillRect(0, 0, w, h);
    if (L.grid && !env.photo) grid(ctx, th.grid(env.C), w, h);
    if (env.photo) drawPhoto(ctx, env.photo, w, h, { dx: tr.dx, dy: tr.dy, s: tr.s }, L.blur, L.dim, env.hiRes);
    return { cx: w / 2, cy: h / 2, hw: w / 2, hh: h / 2, r: 0 };
  },
  accent(ctx, L, tr, env) {
    return paintAccent(ctx, L.shape, env.G, env.C);
  },
  graphic(ctx, L, tr, env) {
    const g = env.cat.graphic;
    if (!g || g.kind === "none") return null;
    return centred(ctx, env.G.art.x + tr.dx, env.G.art.y + tr.dy, env.G.art.s * tr.s, tr.r, () =>
      drawAsset(ctx, g, env.C, { tint: true, labels: g.labels, stamp: g.stamp, shadow: env.style.imageShadow }));
  },
  brand(ctx, L, tr, env) {
    return placed(ctx, 72, 90, tr, () => drawHeader(ctx, env.o, env.w, env.th, env.C, env.G.template === "split", L.rail));
  },
  title(ctx, L, tr, env) {
    const { G, th } = env, top = env.hasBrand ? 150 : 84;
    const box = { x: G.title.x, y: top, w: G.title.w, h: G.title.h + (G.title.y - top) };
    return placed(ctx, box.x + box.w / 2, box.y + box.h / 2, tr, () => drawTitle(ctx, env.cover.title, box, IDENTITY, {
      font: fonts.cn, maxFs: 340, align: L.align, fill: th.titleFill, ink: th.titleInk, hi: env.acc, shadow: env.acc, hiShadow: th.titleFill,
      stroke: clamp(L.stroke, 0, 2), shadowAmt: clamp(L.shadow, 0, 2),
    }));
  },
  tag(ctx, L, tr, env) {
    if (!env.cover.tag) return null;
    return placed(ctx, env.G.tag.x, env.G.tag.y, tr, () => accentTag(ctx, env.cover.tag, env.G.tag.x, env.G.tag.y, env.G.tag.fs, env.acc));
  },
  catname(ctx, L, tr, env) {
    return placed(ctx, env.G.cat.x, env.G.cat.y, tr, () => drawCategory(ctx, env.cat, env.G, env.C, { name: L.showName, plate: L.plate }));
  },
  frame(ctx, L, tr, env) {
    brackets(ctx, 30, 30, env.w - 30, env.h - 30, 44, env.th.text, 3);
    return null;
  },
  asset(ctx, L, tr, env) {
    return centred(ctx, tr.cx, tr.cy, tr.s, tr.r, () => drawAsset(ctx, L.ref, env.C, { tint: L.tint, shadow: env.style.imageShadow }));
  },
  text(ctx, L, tr, env) {
    return centred(ctx, tr.cx, tr.cy, tr.s, tr.r, () => drawFreeText(ctx, L, env));
  },
};

function drawSelection(ctx, hit, k) {
  const u = 1 / k;   // one device pixel in virtual units
  ctx.save();
  ctx.translate(hit.cx, hit.cy); ctx.rotate(hit.r * RAD);
  const hw = hit.hw + 6 * u, hh = hit.hh + 6 * u;
  ctx.lineWidth = 4 * u; ctx.strokeStyle = "rgba(7,7,12,.9)"; ctx.setLineDash([]); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.lineWidth = 2 * u; ctx.strokeStyle = "#ffffff"; ctx.setLineDash([10 * u, 7 * u]); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.setLineDash([]);
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ctx.fillStyle = "#ffffff"; ctx.fillRect(sx * hw - 6 * u, sy * hh - 6 * u, 12 * u, 12 * u); ctx.strokeStyle = INK; ctx.lineWidth = 2 * u; ctx.strokeRect(sx * hw - 6 * u, sy * hh - 6 * u, 12 * u, 12 * u); }
  ctx.restore();
}

let scratch = null;
/**
 * Paints a cover.
 *   cv         target canvas (resized here)
 *   o.profile  brand, categories, style (see store.js)
 *   o.catIndex which category
 *   o.size     {w, h} in real pixels; o.pixelW the width actually rendered (previews are smaller)
 *   o.cover    {title, tag, layers}
 *   o.photo    decoded background Image or null
 *   o.select   id of the layer to outline (editor only)
 * Leaves cv._hits behind: one entry per drawn layer, bottom first, for pointer hit-testing.
 */
export function drawCover(cv, o) {
  const { profile: P, cover } = o, cat = P.categories[o.catIndex];
  const [w, h] = virtualSize(o.size.w, o.size.h), key = sizeKey(o.size);
  cv.width = Math.max(1, Math.round(o.pixelW));
  cv.height = Math.max(1, Math.round((o.pixelW * o.size.h) / o.size.w));
  const ctx = cv.getContext("2d"), kx = cv.width / w, ky = cv.height / h;
  ctx.scale(kx, ky);
  const C = hexToRgb(cat.color);
  const env = {
    o, w, h, cover, cat, C, acc: rgb(C), style: P.style, photo: o.photo || null, hiRes: cv.width > w,
    G: layout(P.style.template, w, h),
    th: o.photo ? THEMES.dark : THEMES[P.style.theme] || THEMES.dark,
    hasBrand: cover.layers.some((l) => l.type === "brand" && l.visible),
  };
  cv._virtual = [w, h];
  cv._hits = [];
  for (const L of cover.layers) {
    if (!L.visible) continue;
    const tr = resolve(L, w, h, key, cat.id);
    let hit;
    if (L.o < 1) {   // paint the layer on its own, then blend it in as a whole
      scratch = scratch || document.createElement("canvas");
      scratch.width = cv.width; scratch.height = cv.height;
      const sx = scratch.getContext("2d");
      sx.scale(kx, ky);
      hit = PAINT[L.type](sx, L, tr, env);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = L.o; ctx.drawImage(scratch, 0, 0); ctx.restore();
    } else hit = PAINT[L.type](ctx, L, tr, env);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    if (hit) cv._hits.push({ id: L.id, type: L.type, ...hit });
  }
  if (o.select) { const hit = cv._hits.find((x) => x.id === o.select); if (hit && hit.type !== "bg") drawSelection(ctx, hit, kx); }
}

/** Topmost hit (from cv._hits) containing the virtual point (x, y) for which accept(hit) is true. */
export function hitAt(hits, x, y, accept = () => true, margin = 12) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const t = hits[i];
    if (!accept(t)) continue;
    const a = -t.r * RAD, dx = x - t.cx, dy = y - t.cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= t.hw + margin && Math.abs(ly) <= t.hh + margin) return t;
  }
  return null;
}
