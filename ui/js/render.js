// drawCover(): paints one cover onto a canvas by walking its layer stack, bottom to top.
// A pure function of its options — the app calls it for the canvas, the thumbnails, exports and
// batch jobs alike.
import { INK, fonts, rgb, mixc, BLK, clamp, toneField, spaced, spacedW, para, brackets } from "./cel.js";
import { virtualSize, layout, adjustLayout } from "./layout.js";
import { drawTitle, parseTitle } from "./title.js";
import { photoRect, drawPhotoAt, sizeOf, blurChannel, pxTime } from "./photo.js";
import { drawAsset } from "./assets.js";
import { resolve, appliesTo, fillsCanvas } from "./layers.js";
import { setLook, setFast, isFast, look, lookValues, styled, layerEffects, paintEffects } from "./style.js";
import { paintRuns, warpCorners } from "./textfx.js";

export const sizeKey = (size) => `${size.w}x${size.h}`;
/** For checks of speed: while `on`, the time each layer took to paint is added up in `ms` (by id), and still runs repainted are counted. */
export const TIMING = { on: false, ms: {}, rebuilt: 0 };
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
function accentTag(ctx, str, x, y, fs, acc, ink = INK) {
  ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34;
  ctx.fillStyle = "#fff"; para(ctx, x + 8, y + 8, w, h, -fs * 0.22); ctx.fill();
  ctx.fillStyle = acc; para(ctx, x, y, w, h, -fs * 0.22); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.lineJoin = "miter"; ctx.stroke();
  ctx.fillStyle = ink; spaced(ctx, str, x + fs * 0.55, y + h * 0.5 + fs * 0.4, 3);
  return { x: x - fs * 0.22, y, w: w + fs * 0.44 + 8, h: h + 8 };
}

function drawHeader(ctx, o, w, th, C, onAccentRight, rail, onAccent = false) {
  const { profile: P, catIndex: i } = o, cat = P.categories[i], total = P.categories.length, acc = rgb(C);
  if (onAccent) th = { ...th, text: th.own || INK };   // the row sits on the colour panel: ink instead of the field's text colour
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
    ctx.fillStyle = onAccent ? INK : acc; ctx.fillRect(x, 72, cw, 34);
    ctx.fillStyle = onAccent ? acc : INK; ctx.fillText(cat.code, x + 13, 97);
    x += cw + 18;
  }
  const unit = [P.brand.unit, total > 1 ? `${pad2(i + 1)} / ${pad2(total)}` : ""].filter(Boolean).join(" ");
  if (unit) { ctx.fillStyle = onAccentRight || onAccent ? th.text : rgb(C, 0.9); ctx.font = `600 21px ${fonts.mono}, ${fonts.cn}`; x += spaced(ctx, unit, x, 97, 3); }
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
    if (show.ink) { ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.09; if (!c.onAccent) each((g, cx) => ctx.strokeText(g, cx, 0)); ctx.fillStyle = ctx.strokeStyle = show.ink; ctx.lineWidth = fs * 0.02; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); }); }
    else if (c.onAccent) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.03; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); }); }
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
    case "arc": return sample(64, (u) => 70 * Math.sin(u * Math.PI));
    default: return [at(0), at(1)];
  }
}
function strokeEdge(ctx, pts, nx, ny, sharp, C, lw = 16) {
  const run = (ox, oy) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + ox, p[1] + oy) : ctx.moveTo(p[0] + ox, p[1] + oy))); ctx.stroke(); };
  if (look().accent) return look().accent.edge(ctx, run, nx, ny, C, lookValues());
  ctx.lineCap = "butt"; ctx.lineJoin = sharp ? "miter" : "round";
  ctx.strokeStyle = INK; ctx.lineWidth = lw; run(0, 0);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; run(nx * (lw / 2 + 16), ny * (lw / 2 + 16));
}
/**
 * Paints the colour block in `shape`, fitted to the canvas, and returns the box {x,y,w,h} it covers.
 * It is an ordinary layer: moved or shrunk, its sides simply show.
 */
export function paintAccent(ctx, shape, G, C) {
  const LA = look().accent, raw = ctx;
  const acc = LA ? LA.fill(C) : rgb(C), { nx, ny } = G.edge;
  let [A, B] = [G.accent[0], G.accent[1]];
  const axis = ny ? 1 : 0;                                   // the coordinate the edge is slanted in
  if (shape === "flat") { const m = (A[axis] + B[axis]) / 2; A = [...A]; B = [...B]; A[axis] = B[axis] = m; }
  if (shape === "reverse") { A = [...A]; B = [...B]; [A[axis], B[axis]] = [B[axis], A[axis]]; }
  const inset = shape === "double" ? 52 : 0, shift = (p, d) => [p[0] - nx * d, p[1] - ny * d];
  const len = Math.hypot(B[0] - A[0], B[1] - A[1]), dx = (B[0] - A[0]) / len, dy = (B[1] - A[1]) / len;
  // the edge runs a little past both ends so its stroke is cut cleanly by the clip below
  const ext = (pts) => [[pts[0][0] - dx * 30, pts[0][1] - dy * 30], ...pts, [pts[pts.length - 1][0] + dx * 30, pts[pts.length - 1][1] + dy * 30]];
  const edge = ext(edgePoints(shape, shift(A, inset), shift(B, inset), nx, ny));
  const block = [...edge, ...G.accent.slice(2)];
  const xs = G.accent.map((p) => p[0]), ys = G.accent.map((p) => p[1]);
  const bx = Math.min(...xs), by = Math.min(...ys), bw = Math.max(...xs) - bx, bh = Math.max(...ys) - by;
  // nothing is drawn outside the block's own rectangle, plus the room the edge needs on its open side
  ctx.save();
  ctx.beginPath(); ctx.rect(bx - (nx < 0 ? 100 : 0), by - (ny < 0 ? 100 : 0), bw + (nx ? 100 : 0), bh + (ny ? 100 : 0)); ctx.clip();
  polygon(ctx, block); ctx.fillStyle = acc; ctx.fill();
  ctx.save(); polygon(ctx, block); ctx.clip();
  toneField(raw, bx - 60, by - 60, bx + bw + 60, by + bh + 60, 28, LA ? LA.tone(C) : rgb(mixc(C, BLK, 0.24)), (x, y) => (((y - by) / bh) * 1.15 - 0.4 + (x - bx) / (bw * 2.6)) * (LA ? LA.toneScale : 1));
  if (shape === "stripes") {                                 // hazard band just inside the edge
    polygon(ctx, ext([A, B]).concat(ext([shift(A, 46), shift(B, 46)]).reverse())); ctx.clip();
    ctx.fillStyle = INK;
    for (let d = -92; d < len + 92; d += 46) { polygon(ctx, [[A[0] + dx * d, A[1] + dy * d], [A[0] + dx * (d + 23), A[1] + dy * (d + 23)], shift([A[0] + dx * (d - 23), A[1] + dy * (d - 23)], 46), shift([A[0] + dx * (d - 46), A[1] + dy * (d - 46)], 46)]); ctx.fill(); }
  }
  ctx.restore();
  if (shape === "stripes") { ctx.strokeStyle = INK; ctx.lineWidth = 8; const q = ext([shift(A, 46), shift(B, 46)]); ctx.beginPath(); ctx.moveTo(...q[0]); ctx.lineTo(...q[q.length - 1]); ctx.stroke(); }
  if (shape === "double") {                                  // a detached band of the same colour, then the block
    const band = ext([A, B]);
    polygon(ctx, band.concat(ext([shift(A, 24), shift(B, 24)]).reverse())); ctx.fillStyle = acc; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 8; ctx.lineJoin = "miter"; ctx.stroke();
    ctx.lineWidth = 10; ctx.beginPath(); edge.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(band[0][0] + nx * 22, band[0][1] + ny * 22); ctx.lineTo(band[3][0] + nx * 22, band[3][1] + ny * 22); ctx.stroke();
  } else strokeEdge(raw, edge, nx, ny, ["zigzag", "steps", "chevron"].includes(shape), C);
  ctx.restore();
  return { x: bx, y: by, w: bw, h: bh };
}

// ---------- layer painters. Each returns the box it covers for hit-testing:
// {cx, cy, hw, hh, r} = centre, half-extents and rotation in virtual units (or null).

let probe = null;
/**
 * Draws fn(ctx) moved / scaled / stretched / rotated about the centre of the box it returns
 * ({x,y,w,h} in untransformed units), and maps that box to the canvas. The box is found first by
 * running fn on a throw-away context, so the result does not depend on any earlier frame.
 */
function placed(ctx, tr, fn, known) {
  if (!probe) { probe = document.createElement("canvas").getContext("2d"); probe.canvas._probe = true; }   // marked, so costly effects skip it
  const box = known || fn(probe);
  if (!box) return null;
  const px = box.x + box.w / 2, py = box.y + box.h / 2;
  ctx.save();
  ctx.translate(px + tr.dx, py + tr.dy); ctx.rotate(tr.r * RAD); ctx.scale(tr.s * tr.kx, tr.s * tr.ky); ctx.translate(-px, -py);
  fn(ctx);
  ctx.restore();
  return { cx: px + tr.dx, cy: py + tr.dy, hw: (box.w / 2) * tr.s * tr.kx, hh: (box.h / 2) * tr.s * tr.ky, r: tr.r };
}
/** The box a layer's hit (its turned rectangle, in units) covers, in canvas pixels, kept within the canvas: where its look effects work. */
function pixelBox(hit, kx, ky, W, H) {
  const a = (hit.r || 0) * RAD, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), ex = hit.hw * c + hit.hh * s, ey = hit.hw * s + hit.hh * c;
  const x0 = Math.max(0, Math.floor((hit.cx - ex) * kx)), y0 = Math.max(0, Math.floor((hit.cy - ey) * ky)), x1 = Math.min(W, Math.ceil((hit.cx + ex) * kx)), y1 = Math.min(H, Math.ceil((hit.cy + ey) * ky));
  return { x0, y0, x1, y1, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
/** Same for things drawn around their own centre (assets, free text); fn returns half-extents. */
function centred(ctx, cx, cy, tr, s, fn) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(tr.r * RAD); ctx.scale(s * tr.kx, s * tr.ky);
  const half = fn();
  ctx.restore();
  return half ? { cx, cy, hw: half.hw * s * tr.kx, hh: half.hh * s * tr.ky, r: tr.r } : null;
}

/** Whether a colour ([r, g, b]) is dark enough for white lettering. */
const isDark = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 < 128;
/**
 * The colours of a headline layer — the title, or text the user added — from its own choices and
 * the look: the lettering, the highlighted words, the keyline, the shadows, and the plate when it is
 * on one (its own colour, else the channel colour). Unset colours follow the look; on a plate they
 * are the ones that read against it. Also the strengths of the outline and the shadow.
 */
function headline(L, env) {
  const { th } = env, plate = L.plate ? (L.plateInk ? hexToRgb(L.plateInk) : env.C) : null;
  let fill, hi, ink, own, ownHi = L.hi ? hexToRgb(L.hi) : undefined;
  if (plate) {   // looks that paint the letters themselves are given these colours too, or they would take the channel colour: the plate's own
    const auto = isDark(plate) ? "#ffffff" : INK, other = auto === INK ? "#ffffff" : INK;
    fill = L.ink || auto; ink = isDark(hexToRgb(fill)) ? "#ffffff" : INK; own = hexToRgb(fill);
    if (L.hi) hi = L.hi; else if (L.plateInk) { hi = env.acc; ownHi = env.C; } else { hi = other; ownHi = hexToRgb(other); }
  } else {
    const accent = L.color === "accent" && !L.ink;   // a text layer of before, still in the channel colour
    fill = L.ink || (accent ? env.acc : th.titleFill); hi = L.hi || (accent ? "#ffffff" : env.acc);
    ink = th.titleInk; own = L.ink ? hexToRgb(L.ink) : accent ? env.C : undefined;
  }
  return {
    fill, hi, ink, shadow: hi, hiShadow: fill, own, ownHi,
    plate: plate && rgb(plate), stroke: clamp(L.stroke ?? 1, 0, 2), shadowAmt: clamp(L.shadow ?? 1, 0, 2),
  };
}
/** The plate a headline sits on (x, y, w, h: its box; fs: the type size). A look may draw its own. */
function drawPlate(raw, x, y, w, h, fill, fs, C) {
  if (look().plate) return look().plate(raw, x, y, w, h, fill, fs, lookValues());
  const ctx = styled(raw, C, true), k = fs / 120;
  ctx.fillStyle = INK; para(ctx, x + 10 * k, y + 10 * k, w, h, -fs * 0.14); ctx.fill();
  ctx.fillStyle = fill; para(ctx, x, y, w, h, -fs * 0.14); ctx.fill();
  ctx.lineWidth = 7 * k; ctx.strokeStyle = INK; ctx.stroke();
}
/** The face of a headline: the look's title face, or the heavy sans. */
const headFont = () => (look().titleFont ? look().titleFont(fonts) : fonts.cn);

// free text: nominal 120-unit type, centred on the origin, set like the title
function drawFreeText(ctx, L, env) {
  const raw = ctx;
  ctx = styled(raw, env.C, true);
  const lines = parseTitle(L.text);
  if (!lines.length) return null;
  const FS = 120, LH = 1.16, st = headline(L, env);
  ctx.font = `900 ${FS}px ${headFont()}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const widths = lines.map((l) => l.reduce((s, a) => s + ctx.measureText(a.t).width, 0)), bw = Math.max(...widths), bh = lines.length * FS * LH;
  const box = { x: -bw / 2, y: -bh / 2, w: bw, h: bh }, pad = st.plate ? FS * 0.32 : 0, skew = st.plate ? 0 : -0.08;
  if (raw.getTransform) env.blocks[L.id] = { m: raw.getTransform(), box };   // where the block is, for the perspective's handles
  if (st.plate) drawPlate(raw, -bw / 2 - pad, -bh / 2 - pad * 0.3, bw + pad * 2, bh + pad * 0.6, st.plate, FS, env.C);
  lines.forEach((line, li) => {
    ctx.save();
    const ox = -widths[li] / 2, oy = -bh / 2 + li * FS * LH + FS * (st.plate ? 0.94 : 0.9);
    ctx.translate(ox, oy);
    if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
    const pass = (fn) => { let cx = 0; for (const a of line) { fn(a, cx); cx += ctx.measureText(a.t).width; } };
    const m = raw.getTransform ? raw.getTransform() : null, unit = m ? Math.hypot(m.a, m.b) : 1;
    paintRuns(raw, pass, {
      fs: FS, d: FS * 0.062 * st.shadowAmt, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: L.fxAmt ?? 1, lineW: widths[li], seed: li * 17.3 + 3, C: env.C, unit,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow, fill: st.own, hi: st.ownHi,
      frame: { ox, oy, c: skew, box }, warp: L.warp,
    }, L.fx);
    raw.restore();
  });
  return { hw: bw / 2 + pad, hh: bh / 2 + pad * 0.3 };
}

const PAINT = {
  /** The ground: the look's field (or the theme's), and its grid. Photos are layers of their own (see photo). */
  bg(ctx, L, tr, env) {
    const { w, h, th } = env;
    const whole = { cx: w / 2, cy: h / 2, hw: w / 2, hh: h / 2, r: 0 };
    if (look().background && look().background(ctx, { ...env, photo: null }, L, lookValues())) return whole;
    ctx.fillStyle = th.field; ctx.fillRect(0, 0, w, h);
    if (L.grid) grid(ctx, th.grid(env.C), w, h);
    return whole;
  },
  /**
   * A photo layer (see layers.js). Painted in its own frame — the whole canvas for one that fills
   * it, else a rectangle at the layer's place, size and angle — through the look's treatment of
   * photos (the same as a background photo gets: tint, duotone, black and white…), then kept to its
   * rectangle, or to its subject when it is cut out; an outline and a shadow come from that shape.
   * A linked cut-out (`of`, see layers.js) shows another layer's photo in that layer's place. A
   * cut-out is caught where its subject is — the box round its mask — rather than the whole photo.
   */
  photo(ctx, L, tr, env) {
    const base = L.of ? env.cover.layers.find((l) => l.id === L.of && l.type === "photo" && !l.of) : L;
    const rec = base && env.o.photos && env.o.photos.get(base.pid), im = rec && rec.img;
    if (!im) return null;
    const mask = L.cut ? rec.mask && rec.mask.img : null;
    if (L.cut && !mask) return null;                     // cut out, but not yet: nothing to show
    const [nw, nh] = sizeOf(im), { w, h } = env, M = ctx.getTransform ? ctx.getTransform() : null;
    // the frame: where the photo's rectangle is, in the frame's units
    let frame, rect, hit, bt = null, F = M && new DOMMatrix(M);   // F: the frame's transform, to find where the photo lands on the canvas
    const fills = base.fill && !L.of;   // placed as a background: covers the canvas, moved and scaled, not turned
    if (fills) {
      const a = base.t.all, b = base.t.by[env.key] || { dx: 0, dy: 0, s: 1 };
      rect = photoRect(im, w, h, { dx: (a.x - 0.5) * w + b.dx, dy: (a.y - 0.5) * h + b.dy, s: a.s * b.s });
      frame = () => null;
      // `covers`: it still covers the whole canvas (scaled down or moved aside, it no longer does, and shows a frame)
      hit = { cx: rect.x + rect.iw / 2, cy: rect.y + rect.ih / 2, hw: rect.iw / 2, hh: rect.ih / 2, r: 0, fill: true,
        covers: rect.x <= 0.5 && rect.y <= 0.5 && rect.x + rect.iw >= w - 0.5 && rect.y + rect.ih >= h - 0.5 };
    } else {
      let iw, ih;
      if (L.of) {
        // A linked cut-out sits where its photo is — the centre of that photo's rectangle, plus an offset of
        // its own (x, y of its placement, fractions of the canvas) — at a size, angle and stretch of its own.
        // Its size is counted as its photo's is: against the canvas it covers for one that fills it, else as a print.
        const a = L.t.all, b = L.t.by[env.key] || IDENTITY_BY, ba = base.t.all, bb = base.t.by[env.key] || IDENTITY_BY;
        const o = base.fill ? { cx: w / 2 + (ba.x - 0.5) * w + bb.dx, cy: h / 2 + (ba.y - 0.5) * h + bb.dy } : env.resolve(base);
        bt = { cx: o.cx + a.x * w + b.dx, cy: o.cy + a.y * h + b.dy, s: a.s * b.s, r: a.r + b.r, kx: a.kx * b.kx, ky: a.ky * b.ky };
        if (base.fill) { const k0 = Math.max(w / nw, h / nh) * bt.s; iw = nw * k0; ih = nh * k0; }
        else { const long = 1000 * bt.s * (Math.min(w, h) / 1080); iw = nw >= nh ? long : (long * nw) / nh; ih = nw >= nh ? (long * nh) / nw : long; }
      } else {
        bt = tr;
        const long = 1000 * bt.s; iw = nw >= nh ? long : (long * nw) / nh; ih = nw >= nh ? (long * nh) / nw : long;
      }
      rect = { x: -iw / 2, y: -ih / 2, iw, ih };
      frame = (c) => { c.translate(bt.cx, bt.cy); c.rotate(bt.r * RAD); c.scale(bt.kx, bt.ky); };
      if (F) F.translateSelf(bt.cx, bt.cy).rotateSelf(bt.r).scaleSelf(bt.kx, bt.ky);
      hit = { cx: bt.cx, cy: bt.cy, hw: (iw / 2) * bt.kx, hh: (ih / 2) * bt.ky, r: bt.r };
    }
    // A cut-out is caught on its subject (the box round its mask). A photo filling the canvas, itself cut,
    // keeps the ground's way of being caught. `px`, `py`: the centre of the photo's own frame, which the
    // editor needs to turn and scale a cut-out about its subject.
    const mb = mask && !fills && maskBox(mask);
    if (mb) {
      const lx = rect.x + ((mb.x0 + mb.x1) / 2) * rect.iw, ly = rect.y + ((mb.y0 + mb.y1) / 2) * rect.ih, hw = ((mb.x1 - mb.x0) / 2) * rect.iw, hh = ((mb.y1 - mb.y0) / 2) * rect.ih;
      const a = bt.r * RAD, x = lx * bt.kx, y = ly * bt.ky;
      hit = { cx: bt.cx + x * Math.cos(a) - y * Math.sin(a), cy: bt.cy + x * Math.sin(a) + y * Math.cos(a), hw: hw * Math.abs(bt.kx), hh: hh * Math.abs(bt.ky), r: bt.r };
    }
    if (bt) Object.assign(hit, { px: bt.cx, py: bt.cy, pw: rect.iw, ph: rect.ih });   // the frame: its centre and size
    if (!M) return hit;
    const blit = (c, dx = 0, dy = 0) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, dx, dy); ctx.restore(); };
    const W = ctx.canvas.width, H = ctx.canvas.height;
    // While a photo is dragged, a costly one (cut out, outlined, shadowed) only slides its last image.
    const costly = L.cut || L.outline > 0 || L.shadow > 0, torn = L.torn && L.outline > 0;
    const stamp = [W, H, L.cut, L.feather, L.spread, L.outline, torn, L.shadow, L.ink, L.blur, L.dim, L.treat, fills, rec.src && rec.src.length, mask && mask.src, look().id, env.C.join(), fills ? rect.iw.toFixed(1) : `${bt.s}|${bt.r}|${bt.kx}|${bt.ky}`].join("|");
    const at = fills ? [rect.x, rect.y] : [bt.cx, bt.cy], keep = PHOTO.slides.get(L.id);
    if (costly && isFast() && keep && keep.stamp === stamp) { blit(keep.img, keep.bx + (at[0] - keep.at[0]) * M.a, keep.by + (at[1] - keep.at[1]) * M.d); return hit; }
    const inFrame = (c, fn) => { c.save(); frame(c); fn(c); c.restore(); };
    const treat = (c) => {   // the look paints on the whole canvas (its washes cover it); the photo itself goes in its frame
      const draw = (grey = 0) => inFrame(c, (x) => drawPhotoAt(x, im, rect.x, rect.y, rect.iw, rect.ih, L.blur, env.hiRes, grey));
      if (!(L.treat && look().background && look().background(c, { ...env, photo: im, drawPhoto: draw }, { grid: false, blur: L.blur, dim: 0, fill: fills }, lookValues()))) draw();
      inFrame(c, (x) => { if (L.dim > 0) { x.fillStyle = `rgba(7,7,12,${L.dim})`; x.fillRect(rect.x, rect.y, rect.iw, rect.ih); } });
    };
    if (!costly && !mask) {   // a plain photo: straight onto the canvas, clipped to its rectangle (no work canvas)
      ctx.save(); frame(ctx); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.iw, rect.ih); ctx.clip(); ctx.setTransform(M);
      treat(ctx);
      ctx.restore();
      return hit;
    }
    // The work canvases cover only where the photo can reach — its rectangle, grown by the outline and
    // the shadow — not the whole canvas: compositing a canvas costs every pixel of it.
    const spread = L.cut && L.spread > 0 ? (L.spread * Math.max(rect.iw, rect.ih)) / 1920 : 0;   // the outward soft edge, in the frame's units
    const reach = (L.outline > 0 ? L.outline : 0) + (torn ? L.outline * 0.25 + 18 : 0) + (L.shadow > 0 ? w * 0.03 : 0) + spread * 3 + 4, k = 1 / Math.max(0.05, Math.min(Math.abs(fills ? 1 : bt.kx), Math.abs(fills ? 1 : bt.ky)));
    const corners = [[rect.x - reach * k, rect.y - reach * k], [rect.x + rect.iw + reach * k, rect.y - reach * k], [rect.x + rect.iw + reach * k, rect.y + rect.ih + reach * k], [rect.x - reach * k, rect.y + rect.ih + reach * k]].map(([x, y]) => F.transformPoint({ x, y }));
    const bx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)))), by = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    const bw = Math.min(W, Math.ceil(Math.max(...corners.map((p) => p.x)))) - bx, bh = Math.min(H, Math.ceil(Math.max(...corners.map((p) => p.y)))) - by;
    if (bw <= 0 || bh <= 0) return hit;   // nothing of it on the canvas
    const Mb = new DOMMatrix().translateSelf(-bx, -by).multiplySelf(M);
    const body = sheet(1, bw, bh, Mb);
    treat(body);
    inFrame(body, (c) => {   // kept to the photo's rectangle, or to its subject
      c.globalCompositeOperation = "destination-in";
      if (mask) c.drawImage(L.feather > 0 ? feathered(mask, L.feather) : mask, rect.x, rect.y, rect.iw, rect.ih); else { c.fillStyle = "#000"; c.fillRect(rect.x, rect.y, rect.iw, rect.ih); }
    });
    if (spread) haloBehind(body, bw, bh, spread * Math.hypot(F.a, F.b));
    if (!costly) { blit(body.canvas, bx, by); return hit; }   // cut out, nothing more
    // shadow and outline from the shape, made once at the photo's scale (see silhouette())
    const out = sheet(0, bw, bh, Mb), f = rect.iw / nw, shape = mask || plainShape(rec, nw, nh);
    const lay = (sil, ox = 0, oy = 0, alpha = 1) => inFrame(out, (o) => { o.globalAlpha = alpha; o.drawImage(sil.c, rect.x - sil.p * f + ox, rect.y - sil.p * f + oy, sil.c.width * sil.k * f, sil.c.height * sil.k * f); });
    const tear = torn && ((colour, bare) => tornSheet(shape, L.outline / f, colour, 1 / f, seedOf(L.id), bare));   // 1 / f: photo px per cover px
    if (L.shadow > 0) { const sil = torn ? tear("#07070c", true) : silhouette(shape, 0, "#07070c"), d = w * 0.006 / Math.max(0.2, Math.abs(fills ? 1 : bt.kx)); for (let i = 1; i <= 4; i++) lay(sil, d * i, d * i * 1.2, L.shadow * 0.22); }
    if (L.outline > 0) lay(torn ? tear(L.ink || "#ffffff", false) : silhouette(shape, L.outline / f, L.ink || "#ffffff"));
    out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.drawImage(body.canvas, 0, 0); out.restore();
    blit(out.canvas, bx, by);
    if (isFast()) {   // kept for the frames to come (a copy: the work canvases are reused)
      const img = keep && keep.img.width === bw && keep.img.height === bh ? keep.img : Object.assign(document.createElement("canvas"), { width: bw, height: bh });
      const g = img.getContext("2d"); g.clearRect(0, 0, bw, bh); g.drawImage(out.canvas, 0, 0);
      PHOTO.slides.set(L.id, { stamp, img, at, bx, by });
    } else PHOTO.slides.delete(L.id);
    return hit;
  },
  subject: () => null,   // a layer of earlier files, turned into a photo layer as it is read (see app.js)
  accent(ctx, L, tr, env) {
    const xs = env.G.accent.map((p) => p[0]), ys = env.G.accent.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
    return placed(ctx, tr, (c) => paintAccent(c, L.shape, env.G, env.C), { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
  },
  graphic(ctx, L, tr, env) {
    const g = env.cat.graphic;
    if (!g || g.kind === "none") return null;
    return centred(ctx, env.G.art.x + tr.dx, env.G.art.y + tr.dy, tr, env.G.art.s * tr.s, () => {
      const half = drawAsset(ctx, g, env.C, { tint: true, labels: g.labels, stamp: g.stamp });
      if (half && look().subject) look().subject(ctx, half, env, lookValues());
      return half;
    });
  },
  brand(ctx, L, tr, env) {
    return placed(ctx, tr, (c) => drawHeader(styled(c, env.C, true), env.o, env.w, L.ink ? { ...env.th, text: L.ink, own: L.ink } : env.th, env.C, env.G.railOnAccent, L.rail, env.G.brandOnAccent));
  },
  title(ctx, L, tr, env) {
    const { G } = env, top = G.titleTop ?? (env.hasBrand ? 150 : 84);
    const box = { x: G.title.x, y: top, w: G.title.w, h: G.title.h + (G.title.y - top) };
    env.titleBox = box;
    const own = look().titleSet;   // a look may set the title itself (vertically, say); null from it means "the usual way"
    const st = headline(L, env);
    return placed(ctx, tr, (c) => (own && own(c, env.cover.title, box, L, env, lookValues())) || drawTitle(c, env.cover.title, box, IDENTITY, {
      font: headFont(), maxFs: 340, align: "left", fill: st.fill, ink: st.ink, hi: st.hi, shadow: st.shadow, hiShadow: st.hiShadow,
      own: st.own, ownHi: st.ownHi,   // for looks that paint the letters themselves
      stroke: st.stroke, shadowAmt: st.shadowAmt, C: env.C, fx: L.fx, fxAmt: L.fxAmt,
      plate: st.plate && ((x, y, w, h, fs) => drawPlate(c, x, y, w, h, st.plate, fs, env.C)), skew: st.plate ? 0 : -0.08,
      warp: L.warp, onBlock: (m, block) => { env.blocks[L.id] = { m, box: block }; },
    }));
  },
  tag(ctx, L, tr, env) {
    if (!env.cover.tag) return null;
    if (look().tag) return placed(ctx, tr, (c) => look().tag(c, env.cover.tag, env.G.tag.x, env.G.tag.y, env.G.tag.fs, env.C, lookValues(), L.ink));
    return placed(ctx, tr, (c) => accentTag(styled(c, env.C, true), env.cover.tag, env.G.tag.x, env.G.tag.y, env.G.tag.fs, env.acc, L.ink || INK));
  },
  catname(ctx, L, tr, env) {
    return placed(ctx, tr, (c) => drawCategory(styled(c, env.C, true), env.cat, env.G, env.C, { name: L.showName, plate: L.plate, ink: L.ink }));
  },
  frame(ctx, L, tr, env) {
    if (look().frame) look().frame(ctx, env, lookValues());
    else brackets(styled(ctx, env.C, true), 30, 30, env.w - 30, env.h - 30, 44, env.th.text, 3);
    return null;
  },
  asset(ctx, L, tr, env) {
    // a colour of the user's takes the channel colour's place
    return centred(ctx, tr.cx, tr.cy, tr, tr.s, () => drawAsset(ctx, L.ref, L.ink ? hexToRgb(L.ink) : env.C, { tint: L.tint || !!L.ink }));
  },
  /** One colour, the canvas's size at scale 1 (free layers are scaled against a 1080-high canvas). */
  solid(ctx, L, tr, env) {
    const u = Math.min(env.w, env.h) / 1080, w = env.w / u, h = env.h / u;
    return centred(ctx, tr.cx, tr.cy, tr, tr.s, () => { ctx.fillStyle = L.color; ctx.fillRect(-w / 2, -h / 2, w, h); return { hw: w / 2, hh: h / 2 }; });
  },
  text(ctx, L, tr, env) {
    return centred(ctx, tr.cx, tr.cy, tr, tr.s, () => drawFreeText(ctx, L, env));
  },
};

/**
 * The grab handles of a selected layer, in its own rotated frame (origin at the layer's centre):
 * four corners (resize), four sides (stretch) and one above the top (rotate). `u` = virtual units
 * per screen pixel, so handles keep the same size on screen.
 */
export function handles(hit, u) {
  const hw = hit.hw + 6 * u, hh = hit.hh + 6 * u;
  const corners = [{ id: "nw", lx: -hw, ly: -hh }, { id: "ne", lx: hw, ly: -hh }, { id: "se", lx: hw, ly: hh }, { id: "sw", lx: -hw, ly: hh }];
  if (hit.fill) return corners;   // a photo placed to fill the canvas is scaled, never stretched or turned
  return [...corners,
    { id: "n", lx: 0, ly: -hh }, { id: "e", lx: hw, ly: 0 }, { id: "s", lx: 0, ly: hh }, { id: "w", lx: -hw, ly: 0 },
    { id: "rot", lx: 0, ly: -hh - 34 * u },
  ];
}
/** Whether a hit shows a frame when selected: not the ground, nor a photo that still covers the whole canvas (its frame is off it). */
export const showsFrame = (hit) => hit.type !== "bg" && !(hit.fill && hit.covers);
function drawSelection(ctx, hit, k, withHandles = true) {
  const u = 1 / k, hs = handles(hit, u), hw = hit.hw + 6 * u, hh = hit.hh + 6 * u;
  ctx.save();
  ctx.translate(hit.cx, hit.cy); ctx.rotate(hit.r * RAD);
  ctx.lineWidth = 4 * u; ctx.strokeStyle = "rgba(7,7,12,.9)"; ctx.setLineDash([]); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.lineWidth = 2 * u; ctx.strokeStyle = "#ffffff"; ctx.setLineDash([10 * u, 7 * u]); ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  ctx.setLineDash([]);
  if (!withHandles) return ctx.restore();
  if (!hit.fill) { ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, -hh - 34 * u); ctx.stroke(); }   // the turning knob's stem
  for (const h of hs) {
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = INK; ctx.lineWidth = 2 * u;
    ctx.beginPath();
    if (h.id === "rot") ctx.arc(h.lx, h.ly, 8 * u, 0, Math.PI * 2);
    else { const a = h.id.length === 2 ? 6.5 * u : 5 * u; ctx.rect(h.lx - a, h.ly - a, a * 2, a * 2); }
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

let scratch = null, fxScratch = null;
const PHOTO = { sheets: [], slides: new Map() };   // the photo layers' work canvases, and their images while a photo is dragged
/** Work canvas i of the photo layers, w × h, cleared, with the transform `m`. */
function sheet(i, w, h, m) {
  const c = PHOTO.sheets[i] || (PHOTO.sheets[i] = document.createElement("canvas"));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.globalAlpha = 1; x.clearRect(0, 0, w, h);
  x.setTransform(m);
  return x;
}
const IDENTITY_BY = { dx: 0, dy: 0, s: 1, r: 0, kx: 1, ky: 1 };
const FEATHERS = new WeakMap(), ALPHAS = new WeakMap();
/**
 * A mask's alpha, read back from it once (at most 1024 px on its longer side): {w, h, a, box}, a in 0–1,
 * box [x0, y0, x1, y1] the part where there is any.
 */
function alphaOf(m) {
  let A = ALPHAS.get(m);
  if (A) return A;
  const t0 = performance.now(), [W, H] = sizeOf(m), k = Math.min(1, 1024 / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const x = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d", { willReadFrequently: true });
  x.drawImage(m, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, a = new Float32Array(w * h), box = [w, h, 0, 0];
  for (let i = 0; i < a.length; i++) {
    if (!(a[i] = d[i * 4 + 3] / 255)) continue;
    const px = i % w, py = (i - px) / w;
    if (px < box[0]) box[0] = px;
    if (px >= box[2]) box[2] = px + 1;
    if (py < box[1]) box[1] = py;
    box[3] = py + 1;
  }
  ALPHAS.set(m, (A = { w, h, a, box }));
  pxTime("soften in: read the mask (once)", t0);
  return A;
}
/**
 * Part of alpha `A` made smaller, `fx` times across and `fy` down: the w × h pixels from (x0, y0) of that
 * smaller copy, each the average of the pixels it covers.
 */
function shrinkAlpha(A, fx, fy, x0, y0, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.min(A.h - 1, Math.floor((y0 + y) * fy)), yb = Math.min(A.h, Math.max(ya + 1, Math.floor((y0 + y + 1) * fy)));
    for (let x = 0; x < w; x++) {
      const xa = Math.min(A.w - 1, Math.floor((x0 + x) * fx)), xb = Math.min(A.w, Math.max(xa + 1, Math.floor((x0 + x + 1) * fx)));
      let s = 0;
      for (let j = ya; j < yb; j++) for (let i = xa, o = j * A.w; i < xb; i++) s += A.a[o + i];
      out[y * w + x] = s / ((yb - ya) * (xb - xa));
    }
  }
  return out;
}
/**
 * A mask with its edge softened inward by `px` (px on a 1920-wide rendering of the photo, as a photo's
 * blur): its alpha blurred, then only what was inside kept, so the edge fades into the subject and none of
 * the background comes back. The alpha is read from the mask once, and only the part around the subject is
 * worked on. The softer the edge, the smaller the copy it is worked out on (a soft edge has no detail to
 * keep): small enough that the blur there is six pixels wide each way, which three box blurs make exactly —
 * or, while a slider or the layer is dragged, one pixel, a coarser edge that costs a fraction (unless the
 * finished one is already there). Kept per mask and amount.
 */
function feathered(m, px) {
  const slot = FEATHERS.get(m) || new Map(), fast = isFast();
  FEATHERS.set(m, slot);
  if (slot.has(px)) return slot.get(px);
  if (fast && slot.has(px + "~")) return slot.get(px + "~");
  const t0 = performance.now(), A = alphaOf(m), sigma = Math.max(0.5, (px * Math.max(A.w, A.h)) / 1920);
  const f = Math.max(1, sigma / (fast ? Math.SQRT2 : Math.sqrt(42))), w = Math.max(1, Math.round(A.w / f)), h = Math.max(1, Math.round(A.h / f));
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h });
  if (A.box[2] > A.box[0]) {
    const pad = Math.ceil(3 * sigma) + 2, [bx0, by0, bx1, by1] = A.box;   // past this, the blur reaches nothing
    const x0 = Math.max(0, Math.floor((bx0 - pad) / f)), y0 = Math.max(0, Math.floor((by0 - pad) / f));
    const sw = Math.min(w, Math.ceil((bx1 + pad) / f)) - x0, sh = Math.min(h, Math.ceil((by1 + pad) / f)) - y0;
    const a = shrinkAlpha(A, A.w / w, A.h / h, x0, y0, sw, sh);
    blurChannel(a, sw, sh, sigma / f);
    const x = c.getContext("2d"), id = x.createImageData(sw, sh), d = id.data;
    for (let i = 0; i < a.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = Math.max(0, Math.min(255, (a[i] - 0.5) * 510)); }
    x.putImageData(id, x0, y0);
  }
  if (slot.size > 24) slot.clear();
  slot.set(fast ? px + "~" : px, c);
  pxTime("soften in: worked out (script)", t0);
  return c;
}
/**
 * The outward soft edge of a cut-out: a blurred copy of what is on work canvas `c` (w × h device px),
 * drawn behind it — the subject's own colours fading outward, none of the background. Blurred on the GPU:
 * the picture is made smaller (by up to half), then halved again and again (each halving averages its
 * pixels), then made larger again the same steps back (each smoothing), so nothing is read back and no pixel
 * is touched in script. How much smaller in all sets how wide the blur: about 2.3 × `sigma`; the first step
 * takes what is left over from the halvings, so the width follows the slider smoothly.
 */
function haloBehind(c, w, h, sigma) {
  const t0 = performance.now(), F = Math.max(2, sigma * 2.3), n = Math.min(10, Math.floor(Math.log2(F))), first = F / 2 ** n;
  const steps = (first > 1.05 ? [first] : []).concat(Array(n).fill(2)), mips = PHOTO.mips || (PHOTO.mips = []), sizes = [];
  let src = c.canvas, sw = w, sh = h, k = 1;
  steps.forEach((s, i) => {
    k *= s;
    const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(h / k)), m = mips[i] || (mips[i] = document.createElement("canvas"));
    if (m.width !== nw || m.height !== nh) { m.width = nw; m.height = nh; }
    const x = m.getContext("2d");
    x.clearRect(0, 0, nw, nh); x.drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
    sizes.push([nw, nh]); src = m; sw = nw; sh = nh;
  });
  for (let i = steps.length - 2; i >= 0; i--) {   // back up, a step at a time, into the larger canvases
    const m = mips[i], [nw, nh] = sizes[i], x = m.getContext("2d");
    x.clearRect(0, 0, nw, nh); x.drawImage(src, 0, 0, sw, sh, 0, 0, nw, nh);
    src = m; sw = nw; sh = nh;
  }
  c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "destination-over"; c.drawImage(src, 0, 0, sw, sh, 0, 0, w, h); c.restore();
  pxTime("soften out (GPU)", t0);
}
const MASK_BOXES = new WeakMap();
/** The box round what is opaque in a mask, as fractions of its size ({x0, y0, x1, y1}), or null. Kept per mask. */
function maskBox(m) {
  if (MASK_BOXES.has(m)) return MASK_BOXES.get(m);
  const t0 = performance.now(), [W, H] = sizeOf(m), k = Math.min(1, 256 / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(m, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 64) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const box = x1 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  MASK_BOXES.set(m, box);
  pxTime("mask box", t0);
  return box;
}
/** An opaque rectangle the size of a photo, for the outline of one that is not cut out. Kept on its record. */
function plainShape(rec, w, h) {
  if (!rec.plain || rec.plain.width !== w || rec.plain.height !== h) {
    const c = rec.plain = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
  }
  return rec.plain;
}
/**
 * The silhouette of `shape` (a mask, or a photo's plain rectangle), grown by `grow` photo pixels and
 * filled with `colour`, at the photo's scale (at most 1024 px across): {c, p, k} — the canvas, its
 * margin in photo pixels, and photo pixels per canvas pixel. Kept per shape, one per size and
 * colour, so a frame only lays it down.
 */
const SILS = new WeakMap();
function silhouette(shape, grow, colour) {
  const max = isFast() ? 512 : 1024;   // while a slider or the layer is dragged, a coarser one is made (and kept) for each step
  const key = `${grow.toFixed(1)}|${colour}|${max}`, cache = SILS.get(shape) || new Map();
  SILS.set(shape, cache);
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now(), [W, H] = sizeOf(shape), K = Math.min(1, max / Math.max(W, H));
  const g = grow * K, p = Math.ceil(g) + 2, c = document.createElement("canvas");
  c.width = Math.ceil(W * K) + 2 * p; c.height = Math.ceil(H * K) + 2 * p;
  const x = c.getContext("2d"), n = g > 0 ? Math.min(48, 16 + Math.round(g)) : 1;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; x.drawImage(shape, p + Math.cos(a) * g, p + Math.sin(a) * g, W * K, H * K); }
  if (g > 0) x.drawImage(shape, p, p, W * K, H * K);
  x.globalCompositeOperation = "source-in"; x.fillStyle = colour; x.fillRect(0, 0, c.width, c.height);
  const sil = { c, p: p / K, k: 1 / K };
  if (cache.size > 48) cache.clear();
  cache.set(key, sil);
  pxTime("silhouette (canvas, not script)", t0);
  return sil;
}
/** A number from a layer's id, so each photo tears its own way and keeps it. */
const seedOf = (id) => { let h = 7; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return (h >>> 0) % 100003; };
/** Value noise, 0–1: smooth between random values at the whole numbers of a grid. */
function hashed(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hashed(xi, yi, s), b = hashed(xi + 1, yi, s), c = hashed(xi, yi + 1, s), d = hashed(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** Fractal noise, about −1…1: `n` octaves of value noise, each twice as fine and half as strong. */
function fbm(x, y, s, n) { let sum = 0, amp = 1, norm = 0; for (let i = 0; i < n; i++) { sum += (vnoise(x, y, s + i * 17) - 0.5) * amp; norm += amp * 0.5; amp *= 0.5; x *= 2.03; y *= 2.03; } return sum / norm; }
/**
 * The squared distance from each pixel to the nearest one that is inside (a w × h grid, 0 inside),
 * exactly: Felzenszwalb and Huttenlocher's transform, down the columns and then along the rows.
 */
function distanceField(inside, w, h) {
  const BIG = 1e20, D = new Float64Array(w * h), n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len) => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = inside[y * w + x] ? 0 : BIG; pass(h); for (let y = 0; y < h; y++) D[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = D[y * w + x]; pass(w); for (let x = 0; x < w; x++) D[y * w + x] = d[x]; }
  return D;
}
/**
 * Torn paper: `shape` (a mask, or a photo's plain rectangle) mounted on a sheet of `colour` whose edge,
 * about `grow` photo pixels out, has been torn by hand. The tear wanders in and out at every scale,
 * as a coastline does — slow bites, smaller jags along them, and teeth; the rim just inside it is
 * lighter, the paper's core showing where the surface came away, with a faint line where it lifted;
 * loose fibres stand out past it; the sheet has a faint tooth; and it throws a soft shadow a little
 * down and to the right. The tear's grain is set in cover pixels (`perCover`: photo px per cover px),
 * so it is as fine on a large photo as on a small one; how far it wanders follows `grow`: never nearer
 * the shape than about a third of it, nor further out than about a sixth more. `seed` makes each layer tear its own way. `bare`: the torn
 * shape alone, flat in `colour` (for a cast shadow). Answers as silhouette() does, and is kept likewise.
 */
const TORN = new WeakMap();
function tornSheet(shape, grow, colour, perCover, seed, bare) {
  const max = isFast() ? 512 : 1024, key = `${grow.toFixed(1)}|${colour}|${max}|${perCover.toFixed(4)}|${seed}|${bare ? 1 : 0}`, cache = TORN.get(shape) || new Map();
  TORN.set(shape, cache);
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now(), [W, H] = sizeOf(shape), K = Math.min(1, max / Math.max(W, H));
  const g = grow * K, u = K / perCover, p = Math.ceil(g * 1.22 + 16 * u) + 4;   // the border and one cover pixel in this canvas's pixels; its margin
  const cw = Math.ceil(W * K) + 2 * p, ch = Math.ceil(H * K) + 2 * p;
  const c = Object.assign(document.createElement("canvas"), { width: cw, height: ch }), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(shape, p, p, W * K, H * K);
  const A = x.getImageData(0, 0, cw, ch).data, inside = new Uint8Array(cw * ch);
  for (let i = 0; i < inside.length; i++) inside[i] = A[i * 4 + 3] > 127 ? 1 : 0;
  const D = distanceField(inside, cw, ch);
  const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(colour.slice(i, i + 2), 16)), core = [r0 + (255 - r0) * 0.86, g0 + (255 - g0) * 0.86, b0 + (255 - b0) * 0.86];
  const out = x.createImageData(cw, ch), o = out.data, far = g * 1.15 + 3 * u + 1, rim = 1.8 * u + g * 0.1, fringe = 1.8 * u + g * 0.05;
  const big = 1 / Math.max(40, 110 * u), mid = 1 / (22 * u), fine = 1 / (4.5 * u), fibre = 1 / (1.2 * u), tooth = 1 / (1.6 * u);
  for (let y = 0, i = 0; y < ch; y++) for (let X = 0; X < cw; X++, i++) {
    const d2 = D[i];
    if (d2 > (far + fringe) * (far + fringe)) continue;
    let a = 1, r = r0, gg = g0, b = b0;
    if (d2 > 0) {
      const d = Math.sqrt(d2);
      // where the tear runs here: slow bites (a share of the border), jags along them, and teeth (in cover pixels)
      const R = clamp(g * (0.72 + 0.4 * fbm(X * big, y * big, seed, 3)) + (0.13 * g + 1.5 * u) * fbm(X * mid, y * mid, seed + 50, 2) + 1.5 * u * (vnoise(X * fine, y * fine, seed + 90) * 2 - 1), g * 0.3 + 0.6 * u, far - 1);
      if (d > R + fringe) continue;
      if (d > R - 0.5) {   // the edge itself, smoothed over a pixel, and the loose fibres past it
        const edge = Math.max(0, R + 0.5 - d), f = Math.pow(Math.max(0, 1 - (d - R) / fringe), 1.6) * (vnoise(X * fibre, y * fibre, seed + 130) > 0.45 ? 0.85 : 0.25);
        a = Math.max(Math.min(1, edge), f);
      }
      if (!bare) {
        const rw = rim * (0.25 + 1.5 * vnoise(X * mid * 0.6, y * mid * 0.6, seed + 210));   // the tear runs slantwise through the sheet: a band of its core, wider and narrower
        if (d > R - rw) [r, gg, b] = core;                                    // the torn rim: the core of the paper
        else if (d > R - rw - 0.9 * u) { r *= 0.86; gg *= 0.86; b *= 0.86; } // where the surface lifted from it
        else { const k = 1 - 0.035 * vnoise(X * tooth, y * tooth, seed + 170) - 0.02 * vnoise(X * tooth * 0.2, y * tooth * 0.2, seed + 190); r *= k; gg *= k; b *= k; }   // the sheet's tooth
      }
    }
    o[i * 4] = r; o[i * 4 + 1] = gg; o[i * 4 + 2] = b; o[i * 4 + 3] = a * 255;
  }
  x.putImageData(out, 0, 0);
  if (!bare) {   // the soft shadow it throws, under it
    const s = Object.assign(document.createElement("canvas"), { width: cw, height: ch }), y = s.getContext("2d");
    y.shadowColor = "rgba(20,14,10,0.34)"; y.shadowBlur = 5 * u; y.shadowOffsetX = 1.2 * u; y.shadowOffsetY = 2.2 * u;
    y.drawImage(c, 0, 0);
    x.clearRect(0, 0, cw, ch); x.drawImage(s, 0, 0);
  }
  const sheet = { c, p: p / K, k: 1 / K };
  if (cache.size > 24) cache.clear();
  cache.set(key, sheet);
  pxTime("torn paper (script)", t0);
  return sheet;
}
/**
 * Paints a cover.
 *   cv         target canvas (resized here)
 *   o.profile  brand, categories, style (see store.js)
 *   o.catIndex which category
 *   o.size     {w, h} in real pixels; o.pixelW the width actually rendered (previews are smaller)
 *   o.cover    {title, tag, layers}
 *   o.photos   the photo store: Map pid -> {img, mask: {img} | null, …} (see app.js)
 *   o.select   id of the layer to outline (editor only)
 *   o.live     {ids} while those layers are being dragged: the layers that do not move are cached
 *              in this object between frames (editor only; drop the object when the drag ends)
 *   o.picked   ids of the layers in a group selection, outlined without handles (editor only)
 * Leaves cv._hits behind: one entry per drawn layer, bottom first, for pointer hit-testing.
 */
export function drawCover(cv, o) {
  // A look may set the whole cover in faces of its own. The font table is shared, so it is put
  // back however the drawing ends.
  const L = setLook(o.profile.style.look), swap = L.faces ? L.faces(fonts) : null, keep = swap ? { ...fonts } : null;
  if (swap) Object.assign(fonts, swap);
  try { paintCover(cv, o); } finally { if (keep) Object.assign(fonts, keep); }
}
function paintCover(cv, o) {
  const { profile: P, cover } = o, cat = P.categories[o.catIndex];
  const [w, h] = virtualSize(o.size.w, o.size.h), key = sizeKey(o.size);
  cv.width = Math.max(1, Math.round(o.pixelW));
  cv.height = Math.max(1, Math.round((o.pixelW * o.size.h) / o.size.w));
  const ctx = cv.getContext("2d"), kx = cv.width / w, ky = cv.height / h;
  ctx.scale(kx, ky);
  const C = hexToRgb(cat.color);
  // the cover's background photo: the lowest photo that fills the canvas (looks and themes ask whether there is one)
  const main = cover.layers.find((l) => fillsCanvas(l) && l.visible && appliesTo(l, cat.id)), mainRec = main && o.photos && o.photos.get(main.pid);
  const photo = (mainRec && mainRec.img) || null;
  const L0 = setLook(P.style.look, P.style.lookParams && P.style.lookParams[P.style.look], P.style.lookSeed, !!photo || P.style.theme !== "light");   // everything below is drawn under this look
  const base = photo ? THEMES.dark : THEMES[P.style.theme] || THEMES.dark;
  const env = {
    blocks: {},   // id -> {m, box}: the transform and box of each lettered block painted (see cv._blocks)
    o, w, h, cover, cat, C, acc: rgb(C), style: P.style, photo, key, hiRes: cv.width > w,
    G: adjustLayout(L0.layout ? L0.layout(P.style.template, w, h) : layout(P.style.template, w, h), w, h, (P.style.layoutAdjust || {})[P.style.template]),
    th: L0.theme ? L0.theme(base, C, lookValues()) : base,
    hasBrand: cover.layers.some((l) => l.type === "brand" && l.visible),
    resolve: (l) => resolve(l, w, h, key, cat.id),   // where another layer is (a photo's copy follows its original)
    // the channel graphic, for a look that uses its shape (a giant silhouette, a glowing photogram): draw(ctx) paints it about 0, 0 at scale 1
    graphic: cat.graphic && cat.graphic.kind !== "none" ? { ref: cat.graphic, draw: (c) => drawAsset(c, cat.graphic, C, { tint: true, labels: cat.graphic.labels, stamp: cat.graphic.stamp }) } : null,
  };
  cv._virtual = [w, h];
  cv._layout = env.G;   // for the editor's layout handles
  /** Paints layers [from, to) onto `c` (a context already scaled to the virtual canvas) and returns their hits. */
  const paintRange = (c, from, to) => {
    const hits = [];
    for (let i = from; i < to; i++) {
      const L = cover.layers[i];
      if (!L.visible || !appliesTo(L, cat.id)) continue;
      const tr = resolve(L, w, h, key, cat.id);
      // a layer set in a font of its own: that font goes first in every face while the layer is painted
      const faces = L.font ? { ...fonts } : null;
      if (faces) for (const k of ["cn", "en", "serif"]) fonts[k] = `"${L.font}", ${faces[k]}`;
      let hit;
      const t0 = TIMING.on ? performance.now() : 0;
      try {
      const fx = layerEffects(L);
      if (L.o < 1 || fx.length) {   // paint the layer on its own — its look effects added to it there — then blend it in as a whole
        // a layer with effects gets a canvas held in memory: the effects read it back and copy from it, which
        // on a canvas kept on the graphics card means a round trip each time (see fxCanvas in style.js)
        if (fx.length && !fxScratch) { fxScratch = document.createElement("canvas"); fxScratch.getContext("2d", { willReadFrequently: true }); }
        const scr = fx.length ? fxScratch : (scratch = scratch || document.createElement("canvas"));
        if (scr.width !== cv.width || scr.height !== cv.height) { scr.width = cv.width; scr.height = cv.height; }
        const sx = scr.getContext("2d");
        sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalAlpha = 1; sx.globalCompositeOperation = "source-over"; sx.clearRect(0, 0, cv.width, cv.height); sx.scale(kx, ky);
        hit = PAINT[L.type](sx, L, tr, env);
        // with effects, only the box the layer and its effects reached is laid down
        const got = hit && fx.length ? paintEffects(sx, pixelBox(hit, kx, ky, cv.width, cv.height), fx, L, kx, env.C) : null;
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = L.o;
        if (got && got.w > 0 && got.h > 0) c.drawImage(scr, got.x0, got.y0, got.w, got.h, got.x0, got.y0, got.w, got.h); else c.drawImage(scr, 0, 0);
        c.restore();
      } else hit = PAINT[L.type](c, L, tr, env);
      } finally { if (faces) Object.assign(fonts, faces); if (TIMING.on) TIMING.ms[L.id] = (TIMING.ms[L.id] || 0) + performance.now() - t0; }
      c.globalAlpha = 1; c.setLineDash([]);
      if (hit) hits.push({ id: L.id, type: L.type, ...hit });
    }
    return hits;
  };
  const n = cover.layers.length, moving = o.live ? (o.live.ids || [o.live.id]).map((id) => cover.layers.findIndex((l) => l.id === id)).filter((i) => i >= 0) : [];
  setFast(moving.length > 0);
  if (!moving.length) cv._hits = paintRange(ctx, 0, n);
  else {
    // Layers are being dragged. The cover is cut into runs of layers that move and runs that do
    // not; each still run is painted once into an image kept in o.live, and each frame only blits
    // those and repaints the moving runs. (Dragging the background photo moves it and its cut-out copy
    // above the title: the four layers between them stay one image.)
    const live = o.live, still = new Set(moving), runs = [];
    for (let i = 0; i < n; i++) {
      const mv = still.has(i), last = runs[runs.length - 1];
      if (last && last.moving === mv) last.to = i + 1; else runs.push({ from: i, to: i + 1, moving: mv });
    }
    const stamp = `${cv.width}x${cv.height}|${n}|${[...still].sort((a, b) => a - b).join(",")}`;
    if (live.stamp !== stamp) {
      live.stamp = stamp; if (TIMING.on) TIMING.rebuilt++;
      live.runs = runs.map((r) => {
        if (r.moving) return null;
        const img = document.createElement("canvas");
        img.width = cv.width; img.height = cv.height;
        const c = img.getContext("2d");
        c.scale(kx, ky);
        return { img, hits: paintRange(c, r.from, r.to) };
      });
    }
    const hits = [];
    runs.forEach((r, i) => {
      if (r.moving) { hits.push(...paintRange(ctx, r.from, r.to)); return; }
      const kept = live.runs[i];
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept.img, 0, 0); ctx.restore();
      hits.push(...kept.hits);
    });
    cv._hits = hits;
  }
  if (L0.post && cover.layers[0].visible) { ctx.save(); L0.post(ctx, w, h, C, lookValues(), kx, cv._hits); ctx.restore(); }   // not over a transparent background
  setFast(false);
  cv._titleBox = env.titleBox || null;
  // where lettered blocks are, for the perspective's handles; a drag paints only some layers, so what is not repainted is kept
  cv._blocks = { ...(o.live ? cv._blocks : null), ...env.blocks, k: kx };
  if (o.picked && o.picked.length > 1) {
    for (const hit of cv._hits) if (o.picked.includes(hit.id) && showsFrame(hit)) drawSelection(ctx, hit, kx, false);
  } else if (o.select) {
    const hit = cv._hits.find((x) => x.id === o.select);
    if (hit && showsFrame(hit)) drawSelection(ctx, hit, kx);
    drawLayoutHandles(ctx, cv, cover.layers.find((l) => l.id === o.select), kx, rgb(C));
  }
}

/**
 * The hits whose (turned) boxes lie wholly inside the rectangle {x0, y0, x1, y1}, bottom first, among
 * those `accept` lets through. Wholly, not partly: on a cover the big layers (title, colour block,
 * graphic) reach nearly everywhere, and a rectangle round two stickers would always catch them too.
 */
export function hitsIn(hits, m, accept = () => true) {
  const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
  return hits.filter((h) => {
    if (!accept(h)) return false;
    const a = (h.r || 0) * RAD, ex = Math.abs(h.hw * Math.cos(a)) + Math.abs(h.hh * Math.sin(a)), ey = Math.abs(h.hw * Math.sin(a)) + Math.abs(h.hh * Math.cos(a));
    return h.cx - ex >= x0 && h.cx + ex <= x1 && h.cy - ey >= y0 && h.cy + ey <= y1;
  });
}

/**
 * The handles that adjust the layout itself, for the selected layer: on the colour block, the two
 * ends and the middle of its dividing edge. (The title's box is set with sliders in the Style tab.)
 * Positions are in virtual units. The block's handles are offered only while the block sits where
 * the template puts it — once moved or turned as a layer, its edge is no longer the template's.
 */
/**
 * The four corner handles of a lettered block in the perspective effect: [{id: "w0".."w3", x, y}]
 * in virtual pixels, where the block's corners are now. Dragging one moves that corner (see app.js).
 */
export function warpHandles(cv, layer) {
  const b = cv._blocks && cv._blocks[layer.id];
  if (!b || !b.m) return [];
  const { box } = b, k = cv._blocks.k || 1;
  return warpCorners(layer.warp, layer.fxAmt ?? 1).map(([dx, dy], i) => {
    const p = b.m.transformPoint({ x: box.x + ([0, 1, 1, 0][i] + dx) * box.w, y: box.y + ([0, 0, 1, 1][i] + dy) * box.h });
    return { id: "w" + i, x: p.x / k, y: p.y / k };
  });
}
export function layoutHandles(cv, layer) {
  const warp = layer && (layer.type === "title" || layer.type === "text") && layer.fx === "taper" ? warpHandles(cv, layer) : [];
  return [...warp, ...templateHandles(cv, layer)];
}
function templateHandles(cv, layer) {
  const G = cv._layout;
  if (!G || !layer) return [];
  if (layer.type === "accent") {
    const a = layer.t.all, moved = a.x || a.y || a.r || a.s !== 1 || a.kx !== 1 || a.ky !== 1 || Object.keys(layer.t.by).length;
    if (moved) return [];
    const [x0, y0, x1, y1] = G.edge.line;
    return [{ id: "a", x: x0, y: y0 }, { id: "b", x: x1, y: y1 }, { id: "m", x: (x0 + x1) / 2, y: (y0 + y1) / 2 }];
  }
  return [];   // the title's box is set in Style → Adjust the layout, not on the canvas
}
function drawLayoutHandles(ctx, cv, layer, k, colour) {
  const hs = layoutHandles(cv, layer), u = 1 / k;
  if (!hs.length) return;
  ctx.save();
  for (const hnd of hs) {   // diamonds, to tell them from a layer's own square handles
    ctx.beginPath(); ctx.moveTo(hnd.x, hnd.y - 10 * u); ctx.lineTo(hnd.x + 10 * u, hnd.y); ctx.lineTo(hnd.x, hnd.y + 10 * u); ctx.lineTo(hnd.x - 10 * u, hnd.y); ctx.closePath();
    ctx.fillStyle = colour; ctx.fill(); ctx.lineWidth = 2.5 * u; ctx.strokeStyle = INK; ctx.stroke();
  }
  ctx.restore();
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
