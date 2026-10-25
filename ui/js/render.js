// drawCover(): paints one cover onto a canvas by walking its layer stack, bottom to top.
// A pure function of its options — the app calls it for the canvas, the thumbnails, exports and
// batch jobs alike.
import { INK, fonts, rgb, mixc, BLK, clamp, toneField, spaced, spacedW, para, brackets } from "./cel.js";
import { virtualSize, layout, adjustLayout, meetStandards, wordsFoot, layoutOf } from "./layout.js";
import { drawTitle, drawTitleVertical, titleBlockVertical, parseTitle, subtitleFit, subtitleColumns, setLine, passOf, hasCJK, someLetters } from "./title.js";
import { photoRect, drawPhotoAt, sizeOf, blurChannel, pxTime, setDraft, isDraft } from "./photo.js";
import { drawAsset, assetHalf, userAssets, assetExists } from "./assets.js";
import { resolve, appliesTo, inSize, isLayout, fillsCanvas, clipBase, clipEnd, sceneOffsets, headLine, frontOf, brushesFront, brushToDo, photoMap, onCanvas, inPoly, edgePoint, canWeave, opaqueBox, HEADLINES } from "./layers.js";
import { setLook, setFast, isFast, look, lookValues, noteReads, readsInto, styled, layerEffects, paintEffects, setScene, scenePlaced, wherePainted, columned, columnBoxOf, fall } from "./style.js";
import { paintRuns, warpCorners, bentLine, bendExtent, bendRest, reshaped, effectReach, inColumn } from "./textfx.js";
import { ransomEpoch } from "./ransom.js";

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
// accent plate with an offset white shadow (down and right as the page has it, see fall in style.js); (x, y) = top-left
function accentTag(ctx, str, x, y, fs, acc, ink = INK) {
  ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34, [sx, sy] = fall(8, 8);
  ctx.fillStyle = "#fff"; para(ctx, x + sx, y + sy, w, h, -fs * 0.22); ctx.fill();
  ctx.fillStyle = acc; para(ctx, x, y, w, h, -fs * 0.22); ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.lineJoin = "miter"; ctx.stroke();
  ctx.fillStyle = ink; spaced(ctx, str, x + fs * 0.55, y + h * 0.5 + fs * 0.4, 3);
  return { x: x - fs * 0.22, y, w: w + fs * 0.44 + 8, h: h + 8 };
}

/**
 * The brand row along the top: the brand name, the channel's code and, when the profile counts them
 * (brand.counter), its number ("unit 01 / 05"); at the right end the channels' colour rail (`rail`), or
 * on the colour panel the number in an ink tag. `logo`: where the brand logo at the right end begins
 * (see logoBox; 0, none), the rail standing to its left.
 */
function drawHeader(ctx, o, w, th, C, onAccentRight, rail, onAccent = false, logo = 0) {
  const { profile: P, catIndex: i } = o, cat = P.categories[i], total = P.categories.length, acc = rgb(C), counted = P.brand.counter;
  const right = logo ? logo - 36 : w - 72;   // where the rail or the number's tag ends: left of the logo
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
  const unit = counted ? [P.brand.unit, total > 1 ? `${pad2(i + 1)} / ${pad2(total)}` : ""].filter(Boolean).join(" ") : "";
  if (unit) { ctx.fillStyle = onAccentRight || onAccent ? th.text : rgb(C, 0.9); ctx.font = `600 21px ${fonts.mono}, ${fonts.cn}`; x += spaced(ctx, unit, x, 97, 3); }
  box.w = Math.max(60, x - box.x + 8);
  if (!rail || total < 2) return box;
  if (onAccentRight) {   // the right end sits on the accent panel: an ink tag with the number instead of the colour rail
    if (!counted) return box;
    const s = `${pad2(i + 1)}/${pad2(total)}`;
    ctx.font = `700 44px ${fonts.en}`;
    const tw = spacedW(ctx, s, 4) + 48;
    if (right - tw < x + 24) return box;   // no room left of the logo
    ctx.fillStyle = INK; para(ctx, right - tw, 60, tw, 58, -10); ctx.fill();
    ctx.fillStyle = acc; spaced(ctx, s, right - tw + 24, 60 + 45, 4);
    return box;
  }
  const seg = Math.min(58, Math.max(18, 420 / total), (right - x - 36) / total), bar = seg - 8;   // narrower when a logo leaves less room
  if (seg < 14) return box;
  P.categories.forEach((c, j) => {
    ctx.fillStyle = rgb(hexToRgb(c.color), j === i ? 1 : 0.35);
    ctx.fillRect(right - total * seg + 8 + j * seg, j === i ? 86 : 92, bar, j === i ? 12 : 6);
  });
  return box;
}

/** The most room the brand logo takes at the right end of the brand row, in units: its height, and its width (a wide one; at most `share` of the canvas's). */
export const LOGO = { h: 84, w: 340, share: 0.22, mid: 90 };
/**
 * Where the profile's brand logo goes on a canvas `w` units wide: its box, right-aligned `inset` from the
 * right edge (where the brand row's rail ends; a look may want it further in, `logoInset`) and centred on
 * the row, as large as LOGO lets it be; `k` scales the asset to it (drawn
 * about its centre, see drawAsset) and `ref` is it. Null when the profile has none, or it is gone.
 */
export function logoBox(P, w, inset = 72) {
  const a = P.brand.logo && userAssets.get(P.brand.logo);
  if (!a) return null;
  const iw = a.img ? a.img.naturalWidth : 600, ih = a.img ? a.img.naturalHeight : 600;
  if (!iw || !ih) return null;
  const n = 600 / Math.max(iw, ih), k = Math.min(LOGO.h / (ih * n), Math.min(LOGO.w, w * LOGO.share) / (iw * n)), bw = iw * n * k, bh = ih * n * k;
  return { x: w - inset - bw, y: LOGO.mid - bh / 2, w: bw, h: bh, k, ref: { kind: "user", id: a.id } };
}

/** A logo box that would straddle the edge of the colour panel of "split" (one too narrow to hold it, see SIDE_BARE) moved left of the edge, onto the title's column. */
export function offEdge(b, G) {
  if (!b || G.template !== "split" || G.flipped) return b;
  const [x0, y0, x1, y1] = G.edge.line, at = (y) => x0 + ((x1 - x0) * (y - y0)) / (y1 - y0 || 1), near = Math.min(at(b.y), at(b.y + b.h)), far = Math.max(at(b.y), at(b.y + b.h));
  return b.x >= far + 16 ? b : { ...b, x: near - 30 - b.w };
}
function drawCategory(ctx, cat, G, C, show) {
  const acc = rgb(C), c = G.cat;
  let x = c.x, nameW = 0, fs = c.fs, nameBox = null;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  if (show.name && cat.name) {
    const glyphs = [...cat.name];
    const widthAt = (f) => { ctx.font = `900 ${f}px ${fonts.cn}`; return glyphs.reduce((s, g) => s + ctx.measureText(g).width + 6, -6); };
    const full = widthAt(fs);
    if (full > c.maxW) fs = Math.max(36, Math.floor((fs * c.maxW) / full));
    nameW = widthAt(fs);
    nameBox = { x: x - 6, y: c.y - fs * 0.95, w: nameW + 12, h: fs * 1.12 };
    ctx.save();
    ctx.translate(x, c.y);
    if (!show.upright) ctx.transform(1, 0, -0.1, 1, 0, 0);   // slanted, but in a column (see turned)
    const each = (fn) => { let cx = 0; for (const g of glyphs) { fn(g, cx); cx += ctx.measureText(g).width + 6; } };
    // in a column it reaches off the band: lettered as off it, outlined, in the channel's colour; so where the band is too
    // slim to hold it, or it was moved off it (`off`, see the catname painter)
    const onBand = c.onAccent && !show.upright && !(show.off && show.off(nameBox));
    if (show.ink) { ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.09; if (!onBand) each((g, cx) => ctx.strokeText(g, cx, 0)); ctx.fillStyle = ctx.strokeStyle = show.ink; ctx.lineWidth = fs * 0.02; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); }); }
    else if (onBand) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.03; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); }); }
    else {
      ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.09; each((g, cx) => ctx.strokeText(g, cx, 0));
      ctx.fillStyle = ctx.strokeStyle = acc; ctx.lineWidth = fs * 0.02; each((g, cx) => { ctx.strokeText(g, cx, 0); ctx.fillText(g, cx, 0); });
    }
    ctx.restore();
  }
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
  if (look().accent) return look().accent.edge(ctx, run, nx, ny, C, lookValues(), pts);
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
  if (LA && LA.body) LA.body(raw, { x: bx, y: by, w: bw, h: bh }, nx, ny, C, lookValues());   // a surface of the look's own, inside the block
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
// {cx, cy, hw, hh, r} = centre, half-extents and rotation in virtual units (or null); a lettering's also
// `fs`, the type size it set, as large as it shows.

let probe = null;
/** The throw-away context a painting is measured on (marked, so costly effects skip it). */
const probing = () => { if (!probe) { probe = document.createElement("canvas").getContext("2d"); probe.canvas._probe = true; } return probe; };
/**
 * Where placed() puts point (x, y) of a layer it places by `box` (what its painting returns) and `tr`: a function of
 * the point, giving [x, y] on the canvas.
 */
function placedAt(box, tr) {
  const px = box.x + box.w / 2, py = box.y + box.h / 2, a = tr.r * RAD, cos = Math.cos(a), sin = Math.sin(a), sx = tr.s * tr.kx, sy = tr.s * tr.ky;
  return (x, y) => { const ix = (x - px) * sx, iy = (y - py) * sy; return [px + tr.dx + ix * cos - iy * sin, py + tr.dy + ix * sin + iy * cos]; };
}
/** The box the colour block is placed by (see placed): round its polygon. */
function accentBox(G) {
  const xs = G.accent.map((p) => p[0]), ys = G.accent.map((p) => p[1]), x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
/**
 * Draws fn(ctx) moved / scaled / stretched / rotated about the centre of the box it returns
 * ({x,y,w,h} in untransformed units), and maps that box to the canvas. The box is found first by
 * running fn on a throw-away context, so the result does not depend on any earlier frame.
 */
function placed(ctx, tr, fn, known) {
  const box = known || fn(probing());
  if (!box) return null;
  const px = box.x + box.w / 2, py = box.y + box.h / 2;
  ctx.save();
  ctx.translate(px + tr.dx, py + tr.dy); ctx.rotate(tr.r * RAD); ctx.scale(tr.s * tr.kx, tr.s * tr.ky); ctx.translate(-px, -py);
  fn(ctx);
  ctx.restore();
  // what is drawn may reach past the box it is placed by (`ink`: a bend reshaped by hand): the hit is that, carried along
  const ink = box.ink || box, sx = tr.s * tr.kx, sy = tr.s * tr.ky, a = tr.r * RAD, ix = (ink.x + ink.w / 2 - px) * sx, iy = (ink.y + ink.h / 2 - py) * sy;
  return { cx: px + tr.dx + ix * Math.cos(a) - iy * Math.sin(a), cy: py + tr.dy + ix * Math.sin(a) + iy * Math.cos(a), hw: (ink.w / 2) * sx, hh: (ink.h / 2) * sy, r: tr.r, ...(box.fs ? { fs: box.fs * sy } : {}) };   // fs: the type size a lettering set, as large as it shows
}
/** The box a layer's hit (its turned rectangle, in units) covers, in canvas pixels, kept within the canvas: where its look effects work. */
function pixelBox(hit, kx, ky, W, H) {
  const a = (hit.r || 0) * RAD, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)), ex = hit.hw * c + hit.hh * s, ey = hit.hw * s + hit.hh * c;
  const x0 = Math.max(0, Math.floor((hit.cx - ex) * kx)), y0 = Math.max(0, Math.floor((hit.cy - ey) * ky)), x1 = Math.min(W, Math.ceil((hit.cx + ex) * kx)), y1 = Math.min(H, Math.ceil((hit.cy + ey) * ky));
  return { x0, y0, x1, y1, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}
/**
 * A small part set in a column (the corner tag, the channel name, the brand row: see columned in style.js), as
 * placed() takes it: `paint(c)` paints it as a line and returns its box; it is painted so, turned a quarter turn
 * clockwise, so it reads downward, its upright letters turned back where they stand (inColumn in textfx.js) — plates
 * and keylines turning with it, the shadows thrown off them still falling down and to the right (fall in style.js).
 * It stands where its line stood: hanging from the top of that box, read
 * downward, unless it would then reach into the foot the apps lay their counts over (wordsFoot in layout.js), when
 * it rises from the box's foot instead; at its left end, or its right end in the right half of the canvas; kept on
 * the canvas, one too long for it from its top. Where it
 * meets what the layout put beside the line is the user's to change: it is placed as any layout layer is. `rules`:
 * the colour of its column rules (界行, a hairline at either side, faint, as drawTitleVertical in title.js rules
 * its columns), when it has them. Its box.
 */
const turned = (paint, env, rules = null) => (c) => {
  const b = paint(probe);   // where it stands as a line (placed() has made the probe)
  if (!b) return null;
  const w = b.h, h = b.w, on = (v, room, size) => Math.max(16, Math.min(v, room - 16 - size));   // and on the canvas, a long one from its top
  const x = on(b.x + b.w / 2 > env.w / 2 ? b.x + b.w - w : b.x, env.w, w), y = on(b.y + h <= wordsFoot(env.w, env.h) ? b.y : b.y + b.h - h, env.h, h);
  if (c === probe) return { x, y, w, h };
  if (rules) { c.save(); c.fillStyle = rules; c.globalAlpha *= 0.32; for (const at of [x, x + w]) c.fillRect(at - 0.75, y, 1.5, h); c.restore(); }
  c.save(); c.translate(x + w, y); c.rotate(Math.PI / 2); c.translate(-b.x, -b.y); inColumn(c, () => paint(c)); c.restore();
  return { x, y, w, h };
};
/** The colour of a small part's column rules (see turned): its lettering's, else the ground's text colour; null without them. */
const rulesOf = (L, env) => (L.rules ? L.ink || env.th.text : null);
/** Same for things drawn around their own centre (assets, free text); fn returns half-extents. */
function centred(ctx, cx, cy, tr, s, fn) {
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(tr.r * RAD); ctx.scale(s * tr.kx, s * tr.ky);
  const half = fn();
  ctx.restore();
  return half ? { cx, cy, hw: half.hw * s * tr.kx, hh: half.hh * s * tr.ky, r: tr.r } : null;
}

/** [r, g, b] of a CSS colour as the themes and looks give them: "#rrggbb" or "rgb(r, g, b)". */
const rgbOf = (s) => (/^#[0-9a-f]{6}$/i.test(s) ? hexToRgb(s) : (String(s).match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number));
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
  // plates under the highlighted words: their own colour, else the channel colour (or, on a plate of that
  // colour already, ink or white against it); the words on them in what reads there, unless chosen
  let hiPlate = null, hiMark = null, shade = null;
  if (L.hiPlate) {
    hiPlate = L.hiPlateInk ? hexToRgb(L.hiPlateInk) : plate && plate.every((v, i) => Math.abs(v - env.C[i]) < 24) ? (isDark(plate) ? [255, 255, 255] : hexToRgb(INK)) : env.C;
    if (!L.hi) { hi = isDark(hiPlate) ? "#ffffff" : INK; ownHi = hexToRgb(hi); }
  } else if (L.hiMark) {   // another mark of them, in that colour too; through a band or on a block set off, partly on the ground, the words keep the lettering's colour
    hiMark = { kind: L.hiMark, color: rgb(L.hiPlateInk ? hexToRgb(L.hiPlateInk) : plate && plate.every((v, i) => Math.abs(v - env.C[i]) < 24) ? (isDark(plate) ? [255, 255, 255] : hexToRgb(INK)) : env.C) };
    if (L.hiMark !== "circle" && !L.hi) {   // the looks that letter the words themselves are told so too; the shadows stay as they were
      const mark = rgbOf(hiMark.color), letters = own || rgbOf(fill), near = Math.hypot(mark[0] - letters[0], mark[1] - letters[1], mark[2] - letters[2]) < 90;
      shade = hi; hi = near ? (isDark(mark) ? "#ffffff" : INK) : fill; ownHi = near ? hexToRgb(hi) : letters;   // on a mark of their own colour, the colour that reads on it
    }
  }
  return {
    fill, hi, ink, shadow: shade || hi, hiShadow: shade || fill, own, ownHi,
    plate: plate && rgb(plate), hiPlate: hiPlate && rgb(hiPlate), hiMark, stroke: clamp(L.stroke ?? 1, 0, 2), shadowAmt: clamp(L.shadow ?? 1, 0, 2),
  };
}
/**
 * A mark of a highlighted run, from x0 to x1 along its line (baseline at 0, type size fs), on c: `phase`
 * "under" (before the letters) or "over" (after them); each kind draws in one. A ring drawn round the
 * words by hand (over: a quick loop that overshoots where it began, wobbling a little), a marker's band
 * through their lower half (under: a slightly slanted stroke with uneven edges), a block of colour set
 * off down and right behind them (under). `seed` keeps each mark's wobble its own and the same every time.
 */
/** Whether a headline's highlighted words lie on something of their own (a band or a block): looks then leave out their own marks of them, as under plates. */
const bandOrBlock = (st) => !!st.hiMark && st.hiMark.kind !== "circle";
function drawMark(c, mark, x0, x1, fs, phase, seed) {
  const R = (k) => { const v = Math.sin((seed + 1) * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  c.save();
  c.fillStyle = c.strokeStyle = mark.color;
  if (mark.kind === "circle" && phase === "over") {
    const cx = (x0 + x1) / 2, cy = -fs * 0.37, rx = (x1 - x0) / 2 + fs * 0.24, ry = fs * 0.7, tilt = -0.05 + (R(1) - 0.5) * 0.04, from = -2.5 + R(2) * 0.3, turn = Math.PI * 2 + 0.55;
    c.lineWidth = fs * 0.07; c.lineCap = c.lineJoin = "round";
    c.beginPath();
    for (let i = 0; i <= 96; i++) {
      const t = i / 96, a = from + turn * t, grow = fs * (-0.04 + 0.1 * t + 0.025 * Math.sin(a * 2 + R(3) * 6));   // wider as it goes round, so the ends pass each other
      const px = Math.cos(a) * (rx + grow), py = Math.sin(a) * (ry + grow);
      c.lineTo(cx + px * Math.cos(tilt) - py * Math.sin(tilt), cy + px * Math.sin(tilt) + py * Math.cos(tilt));
    }
    c.stroke();
  } else if (mark.kind === "marker" && phase === "under") {
    const a = x0 - fs * 0.06, b = x1 + fs * 0.1, top = -fs * 0.46, foot = fs * 0.1, rise = fs * 0.04, n = Math.max(2, Math.ceil((b - a) / (fs * 0.25)));
    const y = (x, edge, k) => edge - (rise * (x - a)) / Math.max(1, b - a) + (R(k) - 0.5) * fs * 0.03;
    c.globalAlpha *= 0.9; c.beginPath();
    c.moveTo(a + fs * 0.05, y(a, top, 10));
    for (let i = 1; i <= n; i++) { const x = a + ((b - a) * i) / n; c.lineTo(x, y(x, top, 10 + i)); }
    c.lineTo(b - fs * 0.04, y(b, foot, 40));                      // the end cut on a slant, as a chisel tip leaves it
    for (let i = n - 1; i >= 0; i--) { const x = a + ((b - a) * i) / n; c.lineTo(x, y(x, foot, 41 + i)); }
    c.closePath(); c.fill();
  } else if (mark.kind === "block" && phase === "under") {
    const [dx, dy] = fall(fs * 0.1, fs * 0.1);   // down and right as the page has it, in a column too
    c.translate((x0 + x1) / 2 + dx, -fs * 0.36 + dy); c.rotate(-0.025);
    c.fillRect(-(x1 - x0) / 2 - fs * 0.08, -fs * 0.54, x1 - x0 + fs * 0.16, fs * 1.08);
  }
  c.restore();
}
/** The plate a headline sits on (x, y, w, h: its box; fs: the type size). A look may draw its own. */
function drawPlate(raw, x, y, w, h, fill, fs, C) {
  if (look().plate) return look().plate(raw, x, y, w, h, fill, fs, lookValues());
  const ctx = styled(raw, C, true), k = fs / 120, [sx, sy] = fall(10 * k, 10 * k);   // its shadow down and right as the page has it
  ctx.fillStyle = INK; para(ctx, x + sx, y + sy, w, h, -fs * 0.14); ctx.fill();

  ctx.fillStyle = fill; para(ctx, x, y, w, h, -fs * 0.14); ctx.fill();
  ctx.lineWidth = 7 * k; ctx.strokeStyle = INK; ctx.stroke();
}
/** The face of a headline: the look's title face, or the heavy sans. */
const headFont = () => (look().titleFont ? look().titleFont(fonts) : fonts.cn);
/**
 * What the ransom note (ransom.js) needs of a headline layer: its id; its seed (its id, and the number Reshuffle
 * drew); the letters dressed by hand; the extras turned off; the photo letters may be cut from — the
 * cover's background photo, else the lowest photo shown — with its id; and whether this is the editor's
 * canvas (`shown`: its letter strip shows the papers drawn there).
 */
function ransomOf(L, env) {
  if (L.fx !== "ransom") return undefined;
  const shown = env.cover.layers.filter((l) => l.type === "photo" && !l.of && !l.cut && l.visible && appliesTo(l, env.cat.id) && env.o.photos && env.o.photos.get(l.pid)?.img), P = shown.find(fillsCanvas) || shown[0];
  return { id: L.id, salt: `${L.id}:${L.fxSeed || 0}`, edits: L.letters || null, off: L.ransomOff || null, photo: P ? { img: env.o.photos.get(P.pid).img, key: P.pid } : null, shown: !!env.o.select };
}
/** A headline layer's bend, as drawTitle and bentLine take it ({id, amt, own}), or null; none in columns (see columned in style.js). */
const bendOf = (L) => (L.bend && !columned(L) ? { id: L.bend, amt: L.bendAmt ?? 1, own: L.bend === "taper" && !!L.warp } : null);
/**
 * What drawTitle and drawTitleVertical are told of headline layer L's lettering, painted on c: its face, its
 * colours (headline), its effect, its plate and the plates or marks of its highlighted words, its column rules,
 * and, while it is painted alone for a cut-out woven with it, the letters in front (env.only, see wovenFront).
 */
function lettering(c, L, env) {
  const st = headline(L, env);
  return {
    font: headFont(), fill: st.fill, ink: st.ink, hi: st.hi, shadow: st.shadow, hiShadow: st.hiShadow,
    own: st.own, ownHi: st.ownHi, hiPlated: !!st.hiPlate || bandOrBlock(st),   // for looks that paint the letters themselves
    stroke: st.stroke, shadowAmt: st.shadowAmt, C: env.C, fx: L.fx, fxAmt: L.fxAmt, fxSeed: L.fxSeed, ransom: ransomOf(L, env),
    plate: st.plate && ((x, y, w, h, fs) => drawPlate(c, x, y, w, h, st.plate, fs, env.C)), skew: st.plate ? 0 : -0.08,
    hiPlate: st.hiPlate && ((x, y, w, h, fs, on = c) => drawPlate(on, x, y, w, h, st.hiPlate, fs, env.C)),
    hiMark: st.hiMark && ((x0, x1, fs, on, phase, seed) => drawMark(on, st.hiMark, x0, x1, fs, phase, seed)),
    key: [st.hiPlate || "", JSON.stringify(st.hiMark)].join(), rules: !!L.rules, only: env.only,
  };
}
/** The box the layout gives the title: from under the brand row (or the look's own top) to its foot. */
function titleBoxOf(env) {
  const { G } = env, top = G.titleTop ?? (env.hasBrand ? 150 : 84);
  return { x: G.title.x, y: top, w: G.title.w, h: G.title.h + (G.title.y - top) };
}
/**
 * Where the subtitle goes (see subtitleFit in title.js), or null when it is hidden, left out, or has no
 * words: in the title's box, under the title, which makes room for it. When either is set in columns
 * (see columned in style.js, subtitleColumns in title.js), beside the title's columns or block, or in a
 * line under its columns; the title's columns standing where the look has them (columnBoxOf: the
 * woodblock book's by the seal, down to the band). Worked out before the layers are painted, so in the
 * faces the title is set in (a layer's own font goes first only while it is painted).
 * `hidden`: where it would go though it is hidden (the title makes no room for it then), or left out
 * while a copy of it shows (see `copy` in layers.js).
 */
function subtitlePlan(ctx, env, hidden = false) {
  const S = env.cover.layers.find((l) => (l.id === "subtitle" && (l.visible || (hidden && !l.off))) || (hidden && l.copy && l.type === "subtitle" && l.visible));
  if (!S || !parseTitle(env.cover.subtitle).length || typeof ctx.measureText !== "function") return null;
  const T = env.cover.layers.find((l) => l.id === "title" && l.visible), title = T ? env.cover.title : "", box = titleBoxOf(env);
  const face = headFont(), font = T && T.font ? `"${T.font}", ${face}` : face, cols = { title: !!T && columned(T), sub: columned(S) };
  if (cols.title || cols.sub) return subtitleColumns(ctx, title, env.cover.subtitle, cols.title ? columnBoxOf(ctx, env, box) : box, font, env.w, env.h, cols, { title: !!(T && T.rules), sub: !!S.rules }, T && !cols.title ? bendOf(T) : null);
  return subtitleFit(ctx, title, env.cover.subtitle, box, font, env.w, env.h, 340, T ? bendOf(T) : null);
}

// free text: nominal 120-unit type, centred on the origin, set like the title; while it is painted alone for a cut-out
// woven with it, only the letters in front of it (env.only, see wovenFront), with no plate, as drawTitle does. In
// columns (see columned in style.js) it is set as the title's are, at that size, the block centred on the origin.
function drawFreeText(ctx, L, env) {
  const raw = ctx;
  ctx = styled(raw, env.C, true);
  const lines = parseTitle(L.text);
  if (!lines.length) return null;
  if (columned(L)) {
    const st = lettering(raw, L, env), b = titleBlockVertical(raw, L.text, { x: 0, y: 0, w: 1e6, h: 1e6 }, st.font, 900, 120, st.rules);
    const got = drawTitleVertical(raw, L.text, { x: -b.w / 2, y: -b.h / 2, w: b.w, h: b.h }, { ...st, fs: b.fs });
    return got && { hw: Math.max(-got.x, got.x + got.w), hh: Math.max(-got.y, got.y + got.h) };
  }
  const FS = 120, LH = 1.16, st = headline(L, env);
  ctx.font = `900 ${FS}px ${headFont()}`;
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const mixed = hasCJK(lines), sets = lines.map((l) => setLine(ctx, l, mixed)), widths = sets.map((s) => s.width), bw = Math.max(...widths), bh = lines.length * FS * LH;
  const box = { x: -bw / 2, y: -bh / 2, w: bw, h: bh }, pad = st.plate ? FS * 0.32 : 0, skew = st.plate ? 0 : -0.08, bend = bendOf(L);
  // how far the lines reach once bent: the plate and the frame take it in (a perspective of its own is the user's to place)
  const ext = bend && !bend.own ? widths.map((w) => bendExtent(bend.id, bend.amt, w, FS)) : null;
  let hw = ext ? Math.max(...widths.map((w, i) => w / 2 + Math.max(ext[i].left, ext[i].right))) : bw / 2;
  let up = ext ? Math.max(...ext.map((e, i) => e.up - i * FS * LH)) : 0, down = ext ? Math.max(...ext.map((e, i) => e.down - (ext.length - 1 - i) * FS * LH)) : 0;   // a wide line between may reach past the first or the last
  const lineAt = (li) => ({ ox: -widths[li] / 2, oy: -bh / 2 + li * FS * LH + FS * (st.plate ? 0.94 : 0.9), lineW: widths[li] });
  const rest = bend && bend.id !== "taper" ? bendRest(bend, FS, skew, box, lineAt(0), lineAt(lines.length - 1)) : null;
  let left = -hw, right = hw;
  if (rest && L.reshape) for (const [x, y] of reshaped(rest, L.reshape, box)) { left = Math.min(left, x); right = Math.max(right, x); up = Math.max(up, -bh / 2 - y); down = Math.max(down, y - bh / 2); }   // the handles dragged out
  hw = Math.max(-left, right);   // the layer turns about its centre: its box stays round it
  if (raw.getTransform) env.blocks[L.id] = { m: raw.getTransform(), box, rest };   // where the block is, for the bend's handles
  if (st.plate && !env.only) drawPlate(raw, left - pad, -bh / 2 - up - pad * 0.3, right - left + pad * 2, bh + up + down + pad * 0.6, st.plate, FS, env.C);   // the plate only where the lettering went
  lines.forEach((line, li) => {
    ctx.save();
    const { ox, oy } = lineAt(li);
    ctx.translate(ox, oy);
    if (skew) ctx.transform(1, 0, skew, 1, 0, 0);
    const set = sets[li], pass = passOf(set);
    const m = raw.getTransform ? raw.getTransform() : null, unit = m ? Math.hypot(m.a, m.b) : 1;
    const o = {
      fs: FS, d: FS * 0.062 * st.shadowAmt, strokeAmt: st.stroke, shadowAmt: st.shadowAmt, amt: L.fxAmt ?? 1, ransom: ransomOf(L, env), fxSeed: L.fxSeed || 0, row: li, lineW: widths[li], seed: li * 17.3 + 3, C: env.C, unit,
      fillCss: st.fill, hiCss: st.hi, inkCss: st.ink, shadowCss: st.shadow, hiShadowCss: st.hiShadow, fill: st.own, hi: st.ownHi, hiPlate: !!st.hiPlate || bandOrBlock(st),
      frame: { ox, oy, c: skew, box }, warp: L.warp, reshape: rest ? L.reshape : undefined, only: env.only || undefined,
    };
    const some = env.only && someLetters(raw, set, li, env.only, o, L.fx);
    if (env.only && !some) return raw.restore();   // none of its letters in front
    const paint = (c, u) => {   // the line as it is, on c (the canvas, or the bent line's own)
      // the ransom note paints only those letters itself: the plates and marks of its highlighted words, kept to them
      const own = some && L.fx === "ransom", kept = (fn) => { if (!own) return fn(); c.save(); some.clip(c); fn(); c.restore(); };
      const line = (c) => {
        // under the highlighted words: plates, or a mark (and some marks over them); a sticker lays them on its rim
        const marks = (phase) => { if (st.hiMark) set.runs.forEach((r, ri) => { if (r.hi) drawMark(c, st.hiMark, r.x0, r.x1, FS, phase, li * 13 + ri); }); };
        const beneath = () => kept(() => { if (st.hiPlate) for (const r of set.runs) if (r.hi) drawPlate(c, r.x0 - FS * 0.08, -FS * 0.86, r.x1 - r.x0 + FS * 0.16, FS * 1.06, st.hiPlate, FS, env.C); marks("under"); });
        const oo = u === unit ? o : { ...o, unit: u };
        if (L.fx === "sticker") paintRuns(c, pass, { ...oo, beneath }, L.fx); else { beneath(); paintRuns(c, pass, oo, L.fx); }
        kept(() => marks("over"));
      };
      if (some && !own) some.keep(c, line); else line(c);
    };
    if (bend) bentLine(raw, { ...o, bend }, [JSON.stringify(line), raw.font, L.fx, st.hiPlate, JSON.stringify(st.hiMark), some ? JSON.stringify(some.spans) : "", JSON.stringify({ ...o, frame: null, warp: null, reshape: null, unit: null, only: null })].join("|"), paint);
    else paint(raw, unit);
    raw.restore();
  });
  const fr = effectReach(L.fx, L.fxAmt ?? 1);   // spikes, drips… past the type
  return { hw: hw + pad + fr.x * FS, hh: bh / 2 + Math.max(up + fr.up * FS, down + fr.down * FS) + pad * 0.3 };
}

/** Whether the base's grid is drawn: off only to compare drawings without it (the checks of the looks' grounds). */
export const BASE = { lines: true };
/** The grid laid on the ground (the Background's base "grid"): the look's own (`gridLines` in style.js), else lines every 60 in its colour, dark or light (th.grid). */
function lookGrid(ctx, env) {
  if (!BASE.lines) return;
  const color = env.th.grid(env.C), own = look().gridLines;
  if (own) own(ctx, env, color); else grid(ctx, color, env.w, env.h);
}
const PAINT = {
  /**
   * The Background, in three: its base — "grid", the look's ground (its `background` with nothing on it, else the
   * theme's field) and the grid on it (lookGrid); "look", the look's ground as it was before there were bases, no
   * grid drawn on it (but the theme's field and its grid where the look has no ground of its own, as cel); or
   * "clear", nothing, see-through — then what the look paints on it, its scene and its pattern (its `background`
   * with `ground: false`): with all of a look's sliders at nothing, the base is all there is. Photos are layers of
   * their own (see photo).
   */
  bg(ctx, L, tr, env) {
    const { w, h, th } = env, whole = { cx: w / 2, cy: h / 2, hw: w / 2, hh: h / 2, r: 0 }, hook = look().background, e = { ...env, photo: null }, p = lookValues();
    if (L.base !== "clear") {
      const own = !!(hook && hook(ctx, e, { ...L, grid: false }, p));
      if (!own) { ctx.fillStyle = th.field; ctx.fillRect(0, 0, w, h); }
      if (L.base === "grid" || !own) lookGrid(ctx, env);
    }
    if (hook) hook(ctx, e, { ...L, grid: true, ground: false }, p);
    return whole;
  },
  /**
   * A photo layer (see layers.js). Painted in its own frame — the whole canvas for one that fills
   * it, else a rectangle at the layer's place, size and angle — through the look's treatment of
   * photos (the same as a background photo gets: tint, duotone, black and white…), then kept to its
   * rectangle, or to its subject when it is cut out; an outline and a shadow come from that shape.
   * A linked cut-out (`of`, see layers.js) shows another layer's photo in that layer's place. A
   * cut-out is caught where its subject is — the box round its mask — rather than the whole photo.
   * A photo not filling the canvas may be cropped (`crop`, see layers.js): only that part of it shows,
   * and is caught, its frame staying where it is (so what is kept does not move); the outline and the
   * shadow follow the crop. A free crop (`pts`) keeps what lies inside its corners: the box round them is
   * the frame and the hit, and the hit carries the shape on the canvas (`poly`), where alone it is caught.
   * A cut-out woven with lettering below it (`weave`, see layers.js) lets that lettering through where it
   * comes in front (env.woven, see wovenFront): its whole picture — body, outline, torn edge, shadow — is
   * cut away there, so the lettering, painted once below, shows.
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
    // A cut-out is caught on its subject (the box round its mask), a cropped photo on what is left of it (of
    // its subject, when it is cut out too). A photo filling the canvas, itself cut, keeps the ground's way of
    // being caught. `px`, `py`: the centre of the photo's own frame, which the editor needs to turn and scale
    // a cut-out, or a crop, about what shows of it.
    const crop = !fills && L.crop, cr = crop ? { x: rect.x + crop.x * rect.iw, y: rect.y + crop.y * rect.ih, iw: crop.w * rect.iw, ih: crop.h * rect.ih } : rect, poly = crop && crop.pts;
    const mb = shownBox(mask && !fills && maskBox(mask), crop);
    if (mb) {
      const lx = rect.x + ((mb.x0 + mb.x1) / 2) * rect.iw, ly = rect.y + ((mb.y0 + mb.y1) / 2) * rect.ih, hw = ((mb.x1 - mb.x0) / 2) * rect.iw, hh = ((mb.y1 - mb.y0) / 2) * rect.ih;
      const a = bt.r * RAD, x = lx * bt.kx, y = ly * bt.ky;
      hit = { cx: bt.cx + x * Math.cos(a) - y * Math.sin(a), cy: bt.cy + x * Math.sin(a) + y * Math.cos(a), hw: hw * Math.abs(bt.kx), hh: hh * Math.abs(bt.ky), r: bt.r };
    }
    if (bt) Object.assign(hit, { px: bt.cx, py: bt.cy, pw: rect.iw, ph: rect.ih });   // the frame: its centre and size
    hit.pf = photoMap(rect, fills ? null : bt);   // where the picture is: the map from its own fractions to the canvas (the weave's brush paints by it)
    if (poly) hit.poly = poly.map(([u, v]) => onCanvas(hit.pf, u, v));   // a free crop: caught within its shape alone
    if (!M) return hit;
    const blit = (c, dx = 0, dy = 0) => { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c, dx, dy); ctx.restore(); };
    const W = ctx.canvas.width, H = ctx.canvas.height;
    // Woven with lettering: how it lets that lettering (`wo`, see wovenFront) through (see weaveCut) — the letters
    // chosen, the lettering below the line where its head ends (on the box round its subject), or where the brush put
    // it in front, both of which turn and scale with the photo (cut in its own frame, F). Told to paintRange
    // (env.letThrough), which with look effects lets it through after them, and through the image of them it keeps.
    const cutter = mask && weaveCut(L.id, F, rect, nw, nh, ctx.canvas, () => shownBox(maskBox(mask), crop));
    env.letThrough = cutter;
    const woven = mask && env.woven, letThrough = woven && cutter(woven);
    /** Lays image `img` down at (x, y) on the canvas, let through where it is woven (`own`: a work canvas, cut as it is; else a copy) — unless that waits for the look's effects. */
    const layDown = (img, x, y, own = false) => {
      if (woven && !woven.later) {
        if (!own) { const s = sheet(0, img.width, img.height, new DOMMatrix()); s.drawImage(img, 0, 0); img = s.canvas; }
        letThrough(img.getContext("2d"), x, y);
      }
      blit(img, x, y);
    };
    // While a photo is dragged, a costly one (cut out, outlined, shadowed) only slides its last image — as it was
    // before any lettering woven with it was let through, which is cut again where the lettering is now.
    const costly = L.cut || L.outline > 0 || L.shadow > 0, torn = L.torn && L.outline > 0, dashed = !torn && L.dash && L.outline > 0;
    const stamp = [W, H, L.cut, L.feather, L.spread, L.outline, torn, dashed, L.shadow, L.ink, L.blur, L.dim, L.treat, fills, rec.src && rec.src.length, mask && mask.src, look().id, env.C.join(), fills ? rect.iw.toFixed(1) : `${bt.s}|${bt.r}|${bt.kx}|${bt.ky}`, crop ? cropKey(crop) : ""].join("|");
    const at = fills ? [rect.x, rect.y] : [bt.cx, bt.cy], keep = PHOTO.slides.get(L.id);
    if (costly && isFast() && keep && keep.stamp === stamp) { layDown(keep.img, keep.bx + (at[0] - keep.at[0]) * M.a, keep.by + (at[1] - keep.at[1]) * M.d); return hit; }
    const inFrame = (c, fn) => { c.save(); frame(c); fn(c); c.restore(); };
    const treat = (c) => {   // the look paints on the whole canvas (its washes cover it); the photo itself goes in its frame
      const draw = (grey = 0, treat = null) => inFrame(c, (x) => drawPhotoAt(x, im, rect.x, rect.y, rect.iw, rect.ih, L.blur, env.hiRes, grey, treat && treat.draw && mask ? { ...treat, mask } : treat));   // treat: { key, fn(RGBA, w, h) }, the look's own recolouring of the photo itself; a look that draws the photo by its own shapes works them out of what a cut-out keeps
      if (!(L.treat && look().background && look().background(c, { ...env, photo: im, drawPhoto: draw }, { grid: false, blur: L.blur, dim: 0, fill: fills }, lookValues()))) draw();
      inFrame(c, (x) => { if (L.dim > 0) { x.fillStyle = `rgba(7,7,12,${L.dim})`; x.fillRect(rect.x, rect.y, rect.iw, rect.ih); } });
    };
    if (!costly && !mask) {   // a plain photo: straight onto the canvas, clipped to its rectangle, or its crop (no work canvas)
      ctx.save(); frame(ctx);
      if (poly) { tracePoly(ctx, poly, rect); ctx.clip("evenodd"); } else { ctx.beginPath(); ctx.rect(cr.x, cr.y, cr.iw, cr.ih); ctx.clip(); }
      ctx.setTransform(M);
      treat(ctx);
      ctx.restore();
      return hit;
    }
    // The work canvases cover only where the photo can reach — its rectangle, grown by the outline and
    // the shadow — not the whole canvas: compositing a canvas costs every pixel of it.
    const spread = L.cut && L.spread > 0 ? (L.spread * Math.max(rect.iw, rect.ih)) / 1920 : 0;   // the outward soft edge, in the frame's units
    const reach = (L.outline > 0 ? L.outline : 0) + (torn ? L.outline * 0.25 + 18 : 0) + (L.shadow > 0 ? w * 0.03 : 0) + spread * 3 + 4, k = 1 / Math.max(0.05, Math.min(Math.abs(fills ? 1 : bt.kx), Math.abs(fills ? 1 : bt.ky)));
    const corners = [[cr.x - reach * k, cr.y - reach * k], [cr.x + cr.iw + reach * k, cr.y - reach * k], [cr.x + cr.iw + reach * k, cr.y + cr.ih + reach * k], [cr.x - reach * k, cr.y + cr.ih + reach * k]].map(([x, y]) => F.transformPoint({ x, y }));
    const bx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x)))), by = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))));
    const bw = Math.min(W, Math.ceil(Math.max(...corners.map((p) => p.x)))) - bx, bh = Math.min(H, Math.ceil(Math.max(...corners.map((p) => p.y)))) - by;
    if (bw <= 0 || bh <= 0) return hit;   // nothing of it on the canvas
    const Mb = new DOMMatrix().translateSelf(-bx, -by).multiplySelf(M);
    const body = sheet(1, bw, bh, Mb);
    treat(body);
    inFrame(body, (c) => {   // kept to the photo's rectangle, or its crop, and to its subject
      c.globalCompositeOperation = "destination-in";
      if (mask) c.drawImage(L.feather > 0 ? feathered(mask, L.feather) : mask, rect.x, rect.y, rect.iw, rect.ih);
      if (!mask || crop) { c.fillStyle = "#000"; if (poly) { tracePoly(c, poly, rect); c.fill("evenodd"); } else c.fillRect(cr.x, cr.y, cr.iw, cr.ih); }
    });
    if (spread) haloBehind(body, bw, bh, spread * Math.hypot(F.a, F.b));
    if (!costly) { layDown(body.canvas, bx, by, true); return hit; }   // cut out, nothing more
    // shadow and outline from the shape, made once at the photo's scale (see silhouette())
    const out = sheet(0, bw, bh, Mb), f = rect.iw / nw, shape = cropShape(mask || plainShape(rec, nw, nh), crop);
    const sx = rect.x + (shape.at ? shape.at[0] * rect.iw : 0), sy = rect.y + (shape.at ? shape.at[1] * rect.ih : 0);   // where the shape starts: the crop's corner
    const lay = (sil, ox = 0, oy = 0, alpha = 1) => inFrame(out, (o) => { o.globalAlpha = alpha; o.drawImage(sil.c, sx - sil.p * f + ox, sy - sil.p * f + oy, sil.c.width * sil.k * f, sil.c.height * sil.k * f); });
    const tear = torn && ((colour, bare) => tornSheet(shape, L.outline / f, colour, 1 / f, seedOf(L.id), bare));   // 1 / f: photo px per cover px
    if (L.shadow > 0) { const sil = torn ? tear("#07070c", true) : silhouette(shape, 0, "#07070c"), d = w * 0.006 / Math.max(0.2, Math.abs(fills ? 1 : bt.kx)); for (let i = 1; i <= 4; i++) lay(sil, d * i, d * i * 1.2, L.shadow * 0.22); }
    if (L.outline > 0) lay(torn ? tear(L.ink || "#ffffff", false) : dashed ? dashedLine(shape, L.outline / f, L.ink || "#ffffff", 1 / f) : silhouette(shape, L.outline / f, L.ink || "#ffffff"));
    out.save(); out.setTransform(1, 0, 0, 1, 0, 0); out.drawImage(body.canvas, 0, 0); out.restore();
    if (isFast()) {   // kept for the frames to come (a copy: the work canvases are reused)
      const img = keep && keep.img.width === bw && keep.img.height === bh ? keep.img : Object.assign(document.createElement("canvas"), { width: bw, height: bh });
      const g = img.getContext("2d"); g.clearRect(0, 0, bw, bh); g.drawImage(out.canvas, 0, 0);
      PHOTO.slides.set(L.id, { stamp, img, at, bx, by });
    } else PHOTO.slides.delete(L.id);
    layDown(out.canvas, bx, by, true);
    return hit;
  },
  subject: () => null,   // a layer of earlier files, turned into a photo layer as it is read (see app.js)
  accent(ctx, L, tr, env) {
    return placed(ctx, tr, (c) => paintAccent(c, L.shape, env.G, env.C), accentBox(env.G));
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
  /** The brand row; in a column (see turned) without the channels' rail or number tag, which belong to the right end of a row. */
  brand(ctx, L, tr, env) {
    const logo = env.logo ? env.logo.x : 0, v = columned(L);
    const paint = (c) => drawHeader(styled(c, env.C, true), env.o, env.w, L.ink ? { ...env.th, text: L.ink, own: L.ink } : env.th, env.C, env.G.railOnAccent, L.rail && !v, env.G.brandOnAccent, logo);
    return placed(ctx, tr, v ? turned(paint, env, rulesOf(L, env)) : paint);
  },
  logo(ctx, L, tr, env) {
    const b = env.logo || (L.copy ? offEdge(logoBox(env.o.profile, env.w, look().logoInset), env.G) : null);   // a copy shows with the logo itself hidden
    if (!b) return null;
    return placed(ctx, tr, (c) => { c.save(); c.translate(b.x + b.w / 2, b.y + b.h / 2); c.scale(b.k, b.k); drawAsset(c, b.ref, env.C, {}); c.restore(); return b; }, b);
  },
  /**
   * The title, in the layout's box (narrower when a subtitle in columns stands beside it, see subtitlePlan), in
   * a line per typed line; or in columns (see columned in style.js), where the look has them stand.
   */
  title(ctx, L, tr, env) {
    const base = titleBoxOf(env), s = env.sub;
    env.titleBox = base;
    if (columned(L)) {   // the subtitle's line under the columns, when it has one, kept free at the foot of the box
      const box = s && s.titleBox ? s.titleBox : columnBoxOf(ctx, env, base), reserve = s && !s.vertical ? Math.min(s.reserve, box.h * 0.5) : 0;
      return placed(ctx, tr, (c) => drawTitleVertical(c, env.cover.title, { ...box, h: box.h - reserve }, { ...lettering(c, L, env), maxFs: 300 }));
    }
    return placed(ctx, tr, (c) => drawTitle(c, env.cover.title, s && s.titleBox ? s.titleBox : base, IDENTITY, {
      ...lettering(c, L, env), maxFs: 340, align: "left",
      warp: L.warp, reshape: L.reshape, bend: bendOf(L), onBlock: (m, block, rest) => { env.blocks[L.id] = { m, box: block, rest }; },
      reserve: s && !s.vertical ? s.reserve : 0,   // the subtitle's line, under it
    }));
  },
  /** The subtitle: lettered as the title is, smaller, where subtitlePlan puts it; in columns or a line as it is set. */
  subtitle(ctx, L, tr, env) {
    const s = env.sub || env.subHidden;
    if (!s) return null;
    if (columned(L)) return placed(ctx, tr, (c) => drawTitleVertical(c, env.cover.subtitle, s.box, { ...lettering(c, L, env), weight: 700, maxFs: s.fs }));
    return placed(ctx, tr, (c) => drawTitle(c, env.cover.subtitle, s.box, IDENTITY, {
      ...lettering(c, L, env), maxFs: s.fs, align: "left",
      warp: L.warp, reshape: L.reshape, bend: bendOf(L), onBlock: (m, block, rest) => { env.blocks[L.id] = { m, box: block, rest }; },
    }));
  },
  tag(ctx, L, tr, env) {
    if (!env.cover.tag) return null;
    const paint = look().tag ? (c) => look().tag(c, env.cover.tag, env.G.tag.x, env.G.tag.y, env.G.tag.fs, env.C, lookValues(), L.ink)
      : (c) => accentTag(styled(c, env.C, true), env.cover.tag, env.G.tag.x, env.G.tag.y, env.G.tag.fs, env.acc, L.ink || INK);
    return placed(ctx, tr, columned(L) ? turned(paint, env, rulesOf(L, env)) : paint);
  },
  /**
   * The channel name, and its sub-name's plate. Where the layout puts it on the colour block it is lettered in ink; where
   * it does not sit on a block shown, as both are placed — the block too slim to hold it (meetStandards lifts it above
   * the words' foot), either moved, the block hidden — in the channel's colour, outlined (drawCategory), as it is off
   * the band, to read over the field or a photo. The plate stays as it is.
   */
  catname(ctx, L, tr, env) {
    const v = columned(L), show = { name: L.showName, plate: L.plate, ink: L.ink, upright: v };
    const paint = (c) => drawCategory(styled(c, env.C, true), env.cat, env.G, env.C, show);
    if (v || !env.G.cat.onAccent) return placed(ctx, tr, v ? turned(paint, env, rulesOf(L, env)) : paint);
    const box = paint(probing()), at = box && placedAt(box, tr);   // the box placed() places it by
    const blocks = env.cover.layers.filter((l) => l.type === "accent" && l.visible && appliesTo(l, env.cat.id)).map((l) => { const to = placedAt(accentBox(env.G), env.resolve(l)); return env.G.accent.map(([x, y]) => to(x, y)); });
    show.off = (b) => !blocks.some((poly) => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].every(([x, y]) => inPoly(poly, ...at(x, y))));
    return placed(ctx, tr, paint, box);
  },
  frame(ctx, L, tr, env) {
    if (look().frame) look().frame(ctx, env, lookValues());
    else brackets(styled(ctx, env.C, true), 30, 30, env.w - 30, env.h - 30, 44, env.th.text, 3);
    return null;
  },
  /**
   * An asset (see assets.js), drawn about its place at its size, angle and stretch, in its own colours, the channel
   * colour or one of the user's. Cropped (see `crop` in layers.js), only that part shows, and is caught, the asset
   * staying where it is; cropped free, what lies inside the crop's corners, caught there alone (`poly`, as a
   * photo's). Its hit carries where the box it is drawn in is on the canvas (`pf`, as a photo's picture:
   * the weave's brush paints by it). Woven with lettering below it (`weave`, see canWeave in layers.js) it lets that
   * lettering through where it comes in front (env.woven, see wovenFront), as a cut-out does: it is drawn on a work
   * canvas round what it draws (see assetBox), and the lettering cut out of all of it there — its shadow and ink
   * lines, its colour — before it is laid down; with look effects, after them (env.letThrough, see paintRange). Its
   * head is measured on what it draws, in the box it is drawn in, so the line turns, stretches and scales with it.
   */
  asset(ctx, L, tr, env) {
    // a colour of the user's takes the channel colour's place
    const C = L.ink ? hexToRgb(L.ink) : env.C, tint = L.tint || !!L.ink, half = assetHalf(L.ref);
    if (!half) return null;
    // the box it is drawn in, in its own units, and its frame: from those units to the canvas's pixels
    const rect = { x: -half.hw, y: -half.hh, iw: 2 * half.hw, ih: 2 * half.hh }, M = ctx.getTransform ? ctx.getTransform() : null;
    const c = L.crop, x = c ? (c.x * 2 - 1) * half.hw : 0, y = c ? (c.y * 2 - 1) * half.hh : 0, w = c ? c.w * 2 * half.hw : 0, h = c ? c.h * 2 * half.hh : 0;
    const paint = (g) => centred(g, tr.cx, tr.cy, tr, tr.s, () => {
      if (c && c.pts) { tracePoly(g, c.pts, rect); g.clip("evenodd"); } else if (c) { g.beginPath(); g.rect(x, y, w, h); g.clip(); }
      return drawAsset(g, L.ref, C, { tint });
    });
    const F = M && new DOMMatrix(M).translateSelf(tr.cx, tr.cy).rotateSelf(tr.r).scaleSelf(tr.s * tr.kx, tr.s * tr.ky);
    const cutter = F && weaveCut(L.id, F, rect, rect.iw, rect.ih, ctx.canvas, () => { const b = assetBox(L.ref, C, tint); return b && shownBox(b.solid, c); });
    env.letThrough = cutter;
    const woven = cutter && env.woven && !env.woven.later ? env.woven : null, box = woven && assetBox(L.ref, C, tint);
    if (!box) paint(ctx);
    else {   // on a work canvas round what it draws (and its crop) and its glow, the lettering in front cut out of it, then laid down
      const k = c ? { x0: Math.max(box.ink.x0, c.x), y0: Math.max(box.ink.y0, c.y), x1: Math.min(box.ink.x1, c.x + c.w), y1: Math.min(box.ink.y1, c.y + c.h) } : box.ink;
      const at = [[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]].map(([u, v]) => F.transformPoint({ x: rect.x + u * rect.iw, y: rect.y + v * rect.ih }));
      const m = ASSET_GLOW_PX, bx = Math.max(0, Math.floor(Math.min(...at.map((p) => p.x)) - m)), by = Math.max(0, Math.floor(Math.min(...at.map((p) => p.y)) - m));
      const bw = Math.min(ctx.canvas.width, Math.ceil(Math.max(...at.map((p) => p.x)) + m)) - bx, bh = Math.min(ctx.canvas.height, Math.ceil(Math.max(...at.map((p) => p.y)) + m)) - by;
      if (k.x1 > k.x0 && k.y1 > k.y0 && bw > 0 && bh > 0) {   // else nothing of it is on the canvas
        const body = sheet(1, bw, bh, new DOMMatrix().translateSelf(-bx, -by).multiplySelf(M));
        paint(body);
        cutter(woven)(body, bx, by);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(body.canvas, bx, by); ctx.restore();
      }
    }
    // where it is caught: its box, or what its crop keeps of it
    const sx = tr.s * tr.kx, sy = tr.s * tr.ky, a = tr.r * RAD, ix = (x + w / 2) * sx, iy = (y + h / 2) * sy;
    const hit = c ? { cx: tr.cx + ix * Math.cos(a) - iy * Math.sin(a), cy: tr.cy + ix * Math.sin(a) + iy * Math.cos(a), hw: (w / 2) * Math.abs(sx), hh: (h / 2) * Math.abs(sy), r: tr.r, px: tr.cx, py: tr.cy }
      : { cx: tr.cx, cy: tr.cy, hw: half.hw * tr.s * tr.kx, hh: half.hh * tr.s * tr.ky, r: tr.r };
    hit.pf = photoMap({ x: rect.x * tr.s, y: rect.y * tr.s, iw: rect.iw * tr.s, ih: rect.ih * tr.s }, tr);   // the box it is drawn in, on the canvas
    if (c && c.pts) hit.poly = c.pts.map(([u, v]) => onCanvas(hit.pf, u, v));
    return hit;
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
const SPOT_DIM = 0.3;   // FOCUS: the layers not worked on, this see-through (see o.spot)
// a clipping group (see clipBase in layers.js) is painted on clipGround — the base, then each layer
// clipped onto it painted on clipOne and laid on only where the base is — and then laid down as one
let clipGround = null, clipOne = null;
/** A canvas the size of cv, cleared, its context scaled to the virtual canvas. */
function freshCanvas(c, cv, kx, ky) {
  if (c.width !== cv.width || c.height !== cv.height) { c.width = cv.width; c.height = cv.height; }
  const x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, c.width, c.height); x.scale(kx, ky);
  return x;
}
// A photo's look effects are pixel work over the whole photo — a background photo's is millions of pixels
// — so their result is kept, per layer and canvas size, for as long as nothing it is drawn from changes:
// the layer (and the photo it copies), where it is, the picture and its mask, the canvas, the style and the
// channel colour. Kept up to FX_KEPT_PX pixels in all (two background photos at a Retina 4K size); the
// least recently used goes first.
const FX_KEPT = new Map(), FX_KEPT_PX = 16e6, OBJ_IDS = new WeakMap();
let objIds = 0;
const objId = (o) => { if (!o) return 0; let n = OBJ_IDS.get(o); if (!n) OBJ_IDS.set(o, (n = ++objIds)); return n; };
/**
 * How a paint draws (see fxServes): 0 a still cover; 1 a draft, its photos from their copies on the graphics card
 * (see setDraft in photo.js), which WebKit resamples a hair otherwise; 2 a drag's frame, drawn coarser here and
 * there too (see setFast). A drag's frame is a draft.
 */
const paintLevel = () => (isFast() ? 2 : isDraft() ? 1 : 0);
/**
 * Whether what a layer's look effects were kept as (see FX_KEPT: {from, level}) serves it now: made from the same
 * things (`from`) and painted at least as well as this paint (`level`, see paintLevel) — a still cover's serves any,
 * a draft's another draft or a drag's frame, never a still cover: the full picture painted as a slider is let go
 * would be a draft's where the canvas has the draft's pixels (a screen of pixel ratio 1, an export of that size).
 */
export const fxServes = (kept, from, level) => !!kept && kept.from === from && kept.level <= level;
const PHOTO = { sheets: [], slides: new Map() };   // the photo layers' work canvases, and their images while a photo is dragged
// The lettering a cut-out lets through (see wovenFront in paintCover) on the editor's canvas, per cut-out and canvas
// size, with what decided it: while something is dragged, a cut-out moved does not paint its lettering again. Up to
// WOVEN_PX pixels in all. Work canvases larger than an editor's canvas (an export's) are let go after use (BIG_PX).
const WOVEN = new Map(), WOVEN_PX = 16e6, BIG_PX = 5e6;
const WOVE = { one: null, base: null };   // where a woven layer clipped onto another is kept to that one's shape
// What the weave's brush puts in front (see `strokes` in layers.js): a mask in the photo's own frame, over the
// picture and a margin round it (BRUSH_PAD of it each way, for an outline or a shadow past its edge), drawn at
// about the size the photo has on the canvas (in steps of 256 px, from 256 to 4096 on its longer side) but never
// finer than the canvas shows it — the picture's longer side no longer than the canvas's: a photo drawn larger than
// the canvas shows only a part of itself there — kept per cut-out and size with the strokes it was drawn from: while
// a stroke is painted only its new points are drawn on it (see brushToDo). Up to BRUSHED_PX pixels in all, the least
// recently used going first. One larger than an editor's canvas is let go after use (an export's, drawn at the
// export's size), unless it is the editor's own: a stroke painted over a big photo on a big screen then draws only its
// new points each frame, as it does on any other.
const BRUSHED = new Map(), BRUSHED_PX = 16e6, BRUSH_PAD = 0.125;
/**
 * The brush mask of cut-out `id` (its weave's `strokes`, the picture nw × nh, iw × ih in the units of transform F,
 * which takes them to the canvas's pixels) on canvas `cv` (the one painted, by its size): {c, temp}, c a canvas over
 * the picture and its margin, opaque where the lettering comes in front; `temp`: let it go after use, which it never
 * is when `kept` (the editor's canvas, as WOVEN keeps what it lets through).
 */
function brushMask(id, strokes, nw, nh, iw, ih, F, cv, kept = false) {
  const span = Math.min(Math.max(iw * Math.hypot(F.a, F.b), ih * Math.hypot(F.c, F.d)), Math.max(cv.width, cv.height)) * (1 + 2 * BRUSH_PAD);
  const long = Math.min(4096, Math.max(256, Math.ceil(span / 256) * 256)), mw = nw >= nh ? long : Math.max(1, Math.round((long * nw) / nh)), mh = nw >= nh ? Math.max(1, Math.round((long * nh) / nw)) : long;
  const slot = `${id}@${mw}x${mh}`, temp = !kept && mw * mh > BIG_PX;
  let k = BRUSHED.get(slot), todo = k && k.strokes === strokes ? brushToDo(k.drawn, strokes) : null;
  if (!todo) {   // drawn anew
    k = k || { c: Object.assign(document.createElement("canvas"), { width: mw, height: mh }) };
    k.c.getContext("2d").clearRect(0, 0, mw, mh);
    Object.assign(k, { strokes, drawn: [] });
    todo = { from: 0, at: 0 };
  }
  const g = k.c.getContext("2d"), f = 1 / (1 + 2 * BRUSH_PAD), unit = Math.max(mw, mh) * f, at = (p) => [(p[0] + BRUSH_PAD) * f * mw, (p[1] + BRUSH_PAD) * f * mh];
  g.lineCap = g.lineJoin = "round"; g.strokeStyle = g.fillStyle = "#000";
  for (let i = todo.from; i < strokes.length; i++) {   // in order: one in front adds to what is there, one behind takes it away
    const s = strokes[i], j0 = i === todo.from ? todo.at : 0, w = s.r * unit;
    g.globalCompositeOperation = s.front ? "source-over" : "destination-out";
    if (j0 === 0) { const [x, y] = at(s.pts[0]); g.beginPath(); g.arc(x, y, w, 0, 2 * Math.PI); g.fill(); }   // where it starts: a dab, which is all a stroke of one point is
    g.beginPath(); g.moveTo(...at(s.pts[Math.max(0, j0 - 1)]));
    for (let j = Math.max(1, j0); j < s.pts.length; j++) g.lineTo(...at(s.pts[j]));
    g.lineWidth = 2 * w; g.stroke();
    k.drawn[i] = { s, n: s.pts.length, front: s.front, r: s.r };
  }
  g.globalCompositeOperation = "source-over";
  BRUSHED.delete(slot);
  if (temp) return { c: k.c, temp };
  BRUSHED.set(slot, k);
  let px = 0; for (const b of BRUSHED.values()) px += b.c.width * b.c.height;
  for (const [s0, b] of BRUSHED) { if (px <= BRUSHED_PX || BRUSHED.size <= 1) break; px -= b.c.width * b.c.height; BRUSHED.delete(s0); }
  return { c: k.c, temp };
}
/**
 * How a woven layer lets the lettering it weaves with through (see wovenFront), a cut-out's (PAINT.photo) and an
 * asset's (PAINT.asset) alike: for the weave as it is now (`wo`), a cut of work canvas `c`, whose corner is at
 * (ox, oy) on the canvas painted (`cv`) — the letters chosen, the lettering below the line where its head ends
 * (`head()`: the box round its subject, fractions of its picture; null for none, all of it then), or where the brush
 * put it in front. The line and the brush's mask are laid in the layer's own frame (F, from it to the canvas's
 * pixels; its picture `rect` there, nw × nh in shape), so they turn, stretch and scale with it. `id` names its mask.
 */
function weaveCut(id, F, rect, nw, nh, cv, head) {
  return (wo) => (c, ox, oy) => {
    const sub = wo.by === "head" && head(), brush = wo.by === "brush" && wo.strokes;
    let src = wo.c, sx = -ox, sy = -oy, s = null;
    if (sub || brush) {
      s = sheet(2, c.canvas.width, c.canvas.height, new DOMMatrix());
      s.drawImage(wo.c, -ox, -oy);
      s.setTransform(new DOMMatrix().translateSelf(-ox, -oy).multiplySelf(F));
      if (sub) {
        const y = rect.y + headLine(sub, wo.line) * rect.ih, far = 1e5;
        s.globalCompositeOperation = "destination-out"; s.fillRect(rect.x - far, y - far, rect.iw + 2 * far, far);   // the head stays in front
      } else {   // only where the brush put it in front: its mask, made in the layer's own frame, laid over the picture
        const b = brushMask(id, brush, nw, nh, rect.iw, rect.ih, F, cv, !wo.temp), pad = BRUSH_PAD;
        s.globalCompositeOperation = "destination-in"; s.drawImage(b.c, rect.x - pad * rect.iw, rect.y - pad * rect.ih, rect.iw * (1 + 2 * pad), rect.ih * (1 + 2 * pad));
        if (b.temp) b.c.width = b.c.height = 0;
      }
      src = s.canvas; sx = sy = 0;
    }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "destination-out"; c.drawImage(src, sx, sy); c.restore();
    if (s) letGo(s.canvas);
  };
}
// What an asset draws, measured (see assetBox): per asset, colour, tint, look and the fonts there are, up to
// ASSET_BOXES_MAX of them, the least recently used going first. ASSET_GLOW_PX: what a woven asset's work canvas holds
// round that, in the canvas's own pixels — the glows some looks' sticker painters throw are blurred in pixels, not in
// the asset's units (the rave's, shadowBlur 20, the widest: a blur of sigma 10, gone within 30 px), so on a small
// asset, or a thumbnail, they reach further past what it draws than the measure shows.
const ASSET_BOXES = new Map(), ASSET_BOXES_MAX = 64, ASSET_SPAN = 256, ASSET_GLOW_PX = 32;
/** What decides how lettering is drawn besides its own settings: the fonts on the page, and those that have arrived (see ransomEpoch). */
const fontState = () => `${typeof document !== "undefined" && document.fonts ? document.fonts.size : 0}/${ransomEpoch()}`;
/**
 * Where asset `ref` draws (in colour C, tinted or not, as the look draws it now; see drawAsset), as fractions of the
 * box it is drawn in (assetHalf's, about its centre; 0 to 1 across it), as a cut-out's subject is measured on its mask:
 * {ink}, round all it draws, grown by a pixel of the measure — all a woven asset's work canvas need hold (see
 * PAINT.asset) — and {solid}, round what is opaque enough to count (see maskBox): its subject, which its head is a
 * share of. Measured once, drawn ASSET_SPAN pixels across its box's longer side with as much again round it, half each
 * way (a drawing may reach past its box: a shadow, an ink line), as a still cover draws it — never as a drag's frame
 * does, which leaves things out (the cyber look's colour echo); null when it draws nothing, or is gone.
 */
function assetBox(ref, C, tint) {
  const half = assetHalf(ref);
  if (!half) return null;
  const key = [ref.kind, ref.id, objId(ref.kind === "user" ? userAssets.get(ref.id) : null), C.join(), tint ? 1 : 0, look().id, JSON.stringify(lookValues()), fontState()].join("|");
  if (ASSET_BOXES.has(key)) { const b = ASSET_BOXES.get(key); ASSET_BOXES.delete(key); ASSET_BOXES.set(key, b); return b; }
  const t0 = performance.now(), k = ASSET_SPAN / (2 * Math.max(half.hw, half.hh)), w = Math.max(2, Math.round(4 * half.hw * k)), h = Math.max(2, Math.round(4 * half.hh * k));
  const x = Object.assign(document.createElement("canvas"), { width: w, height: h }).getContext("2d", { willReadFrequently: true });
  x.translate(w / 2, h / 2); x.scale(k, k);
  const fast = isFast();
  setFast(false);
  try { drawAsset(x, ref, C, { tint }); } finally { setFast(fast); }
  const d = x.getImageData(0, 0, w, h).data, ink = opaqueBox(d, w, h, 0), solid = opaqueBox(d, w, h);
  // from the measure's fractions to the box's: the measure is twice the box, a half of it round it each way
  const inBox = (b, g = 0) => ({ x0: 2 * b.x0 - 0.5 - g, y0: 2 * b.y0 - 0.5 - g, x1: 2 * b.x1 - 0.5 + g, y1: 2 * b.y1 - 0.5 + g });
  const box = ink && { ink: inBox(ink, 2 / Math.min(w, h)), solid: inBox(solid || ink) };
  ASSET_BOXES.set(key, box);
  if (ASSET_BOXES.size > ASSET_BOXES_MAX) ASSET_BOXES.delete(ASSET_BOXES.keys().next().value);
  pxTime("asset box", t0);
  return box;
}
/** Lets go of work canvas c when it is an export's (see BIG_PX). */
const letGo = (c) => { if (c && c.width * c.height > BIG_PX) c.width = c.height = 0; };
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
  const box = opaqueBox(x.getImageData(0, 0, w, h).data, w, h);
  MASK_BOXES.set(m, box);
  pxTime("mask box", t0);
  return box;
}
/**
 * What of a photo shows, as fractions of it ({x0, y0, x1, y1}): the box round its subject (`mb`, see
 * maskBox), within its crop when it is cropped (see `crop` in layers.js); the crop when it is not cut out,
 * or nothing of the subject is left in it; null for neither.
 */
function shownBox(mb, crop) {
  if (!crop) return mb || null;
  const c = { x0: crop.x, y0: crop.y, x1: crop.x + crop.w, y1: crop.y + crop.h };
  if (!mb) return c;
  const m = { x0: Math.max(mb.x0, c.x0), y0: Math.max(mb.y0, c.y0), x1: Math.min(mb.x1, c.x1), y1: Math.min(mb.y1, c.y1) };
  return m.x1 > m.x0 && m.y1 > m.y0 ? m : c;
}
const cropKey = (c) => [c.x, c.y, c.w, c.h].map((v) => v.toFixed(4)).join(",") + (c.pts ? ";" + c.pts.join(" ") : "");
/** Traces a free crop's corners (`pts`, fractions of the picture) over the picture's rectangle r ({x, y, iw, ih}) as a path of its own, to be clipped or filled even-odd. */
function tracePoly(g, pts, r) {
  g.beginPath();
  pts.forEach(([u, v], i) => (i ? g.lineTo(r.x + u * r.iw, r.y + v * r.ih) : g.moveTo(r.x + u * r.iw, r.y + v * r.ih)));
  g.closePath();
}
const CROPPED = new WeakMap();
/**
 * The part of `shape` (a mask, or a photo's plain rectangle) a crop keeps, for the outline and the shadow of a
 * cropped photo: a canvas the crop's size, its `at` where it starts in the shape (fractions); of a free crop, what
 * lies inside its corners, the rest of the box cleared, so the outline goes round the shape. The same canvas for
 * the same crop (see silhouette, which keeps its work per shape), a dozen kept per shape (copies of one photo
 * cropped each its own way).
 */
function cropShape(shape, crop) {
  if (!crop) return shape;
  const key = cropKey(crop), kept = CROPPED.get(shape) || new Map();
  CROPPED.set(shape, kept);
  if (kept.has(key)) { const c = kept.get(key); kept.delete(key); kept.set(key, c); return c; }
  const [W, H] = sizeOf(shape), x0 = Math.round(crop.x * W), y0 = Math.round(crop.y * H);
  const c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(crop.w * W)), height: Math.max(1, Math.round(crop.h * H)), at: [x0 / W, y0 / H] });
  const g = c.getContext("2d");
  g.drawImage(shape, -x0, -y0);
  if (crop.pts) { g.globalCompositeOperation = "destination-in"; tracePoly(g, crop.pts, { x: -x0, y: -y0, iw: W, ih: H }); g.fill("evenodd"); }
  kept.set(key, c);
  for (const k of kept.keys()) { if (kept.size <= 12) break; kept.delete(k); }
  return c;
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
 * The closed lines along which `F` (a w × h grid, below 0 inside) crosses 0: marching squares, each line
 * a list of [x, y] in grid units, the inside always on the same side. Where two inside corners of a cell
 * face each other across it, the cell's middle decides whether they are joined. The grid's edge must be
 * outside.
 */
export function isolines(F, w, h) {
  const next = new Map();   // a crossing (by the cell edge it is on) -> the crossing the line goes on to
  const corner = (i) => F[i] < 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = y * w + x, a = corner(i), b = corner(i + 1), c = corner(i + w + 1), d = corner(i + w);
    if (a === b && b === c && c === d) continue;
    // the cell's edges clockwise (top, right, bottom, left), each from one corner to the next; a crossing
    // where the line goes in (outside to inside) or out
    const edges = [[2 * i, a, b], [2 * (i + 1) + 1, b, c], [2 * (i + w), c, d], [2 * i + 1, d, a]];
    const cross = edges.filter(([, p, q]) => p !== q).map(([k, , q]) => ({ k, into: q }));
    const mid = F[i] + F[i + 1] + F[i + w + 1] + F[i + w] < 0;
    cross.forEach((o, j) => {
      if (o.into) return;
      // going out: on to the crossing going in that ends the outside it leaves (the inside joined across
      // the middle), or that begins the inside it leaves (the corners kept apart)
      const n = cross.length, into = cross.length === 2 ? cross[1 - j] : mid ? cross[(j + 1) % n] : cross[(j + n - 1) % n];
      next.set(o.k, into.k);
    });
  }
  const at = (k) => {
    const i = k >> 1, x = i % w, y = (i - x) / w, other = k & 1 ? i + w : i + 1, t = F[i] / (F[i] - F[other]);
    return k & 1 ? [x, y + t] : [x + t, y];
  };
  const lines = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    for (let k = start; k !== undefined && !seen.has(k); k = next.get(k)) { seen.add(k); pts.push(at(k)); }
    if (pts.length > 2) lines.push(pts);
  }
  return lines;
}
/**
 * A dashed line round `shape` (a mask, or a photo's plain rectangle): line segments of `colour`, evenly
 * spaced, along a line `grow` photo pixels out — the outer edge of the dashes where a plain outline's
 * would be, a gap between them and the shape, like the line a sticker is cut along. Their weight and
 * length follow `grow`, at least a cover pixel or two (`perCover`: photo px per cover px). Each closed
 * line has a whole number of dashes. Answers as silhouette() does, and is kept likewise.
 */
const DASHED = new WeakMap();
function dashedLine(shape, grow, colour, perCover) {
  const max = isFast() ? 512 : 1024, key = `${grow.toFixed(1)}|${colour}|${max}|${perCover.toFixed(4)}`, cache = DASHED.get(shape) || new Map();
  DASHED.set(shape, cache);
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now(), [W, H] = sizeOf(shape), K = Math.min(1, max / Math.max(W, H));
  const g = grow * K, u = K / perCover, wt = Math.max(2 * u, g * 0.32), r = Math.max(g - wt / 2, wt / 2 + u);   // the dashes' weight; how far out their middle runs
  const p = Math.ceil(r + wt) + 4, cw = Math.ceil(W * K) + 2 * p, ch = Math.ceil(H * K) + 2 * p;
  const c = Object.assign(document.createElement("canvas"), { width: cw, height: ch }), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(shape, p, p, W * K, H * K);
  const A = x.getImageData(0, 0, cw, ch).data, inside = new Uint8Array(cw * ch);
  for (let i = 0; i < inside.length; i++) inside[i] = A[i * 4 + 3] > 127 ? 1 : 0;
  const D = distanceField(inside, cw, ch), F = new Float32Array(cw * ch);
  for (let i = 0; i < F.length; i++) F[i] = Math.sqrt(D[i]) - r;
  x.clearRect(0, 0, cw, ch);
  x.strokeStyle = colour; x.lineWidth = wt; x.lineCap = "butt"; x.lineJoin = "round";
  const period = wt * 4.6 + 4 * u, on = 0.62;   // a dash and the gap after it
  for (const raw of isolines(F, cw, ch)) {
    const n0 = raw.length, pts = raw.map((q, i) => { const a = raw[(i + n0 - 1) % n0], b = raw[(i + 1) % n0]; return [(a[0] + 2 * q[0] + b[0]) / 4 + 0.5, (a[1] + 2 * q[1] + b[1]) / 4 + 0.5]; });   // smoothed, onto the pixels' centres
    let len = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; len += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    if (len < period * 2) continue;   // a speck or a pinhole: too small for dashes
    const each = len / Math.round(len / period);
    x.setLineDash([each * on, each * (1 - on)]);
    x.beginPath(); pts.forEach(([X, Y], i) => (i ? x.lineTo(X, Y) : x.moveTo(X, Y))); x.closePath(); x.stroke();
  }
  const sheet = { c, p: p / K, k: 1 / K };
  if (cache.size > 24) cache.clear();
  cache.set(key, sheet);
  pxTime("dashed outline (script)", t0);
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
 *   o.handles  false: the layer selected outlined without its square handles, with the layout's diamonds alone
 *              (a layout preset's colour block, see layoutEditor in app.js)
 *   o.live     {ids} while those layers are being dragged: the layers that do not move are cached
 *              in this object between frames (editor only; drop the object when the drag ends)
 *   o.draft    true while a slider is dragged (editor only): photos are drawn from their copies on the
 *              graphics card, as in a frame of o.live (see setDraft in photo.js); {key} while it is a
 *              look's slider for its value `key`: the layers that did not read that value when last
 *              painted (see noteReads in style.js) are cached in this object between frames, as o.live
 *              caches those not dragged (drop the object when the drag ends)
 *   o.picked   ids of the layers in a group selection, outlined without handles (editor only)
 *   o.spot     ids of the layers kept bright, every other one dimmed (the editor's FOCUS); a clipping
 *              group is dimmed or not as a whole
 *   o.only     index of the one layer to paint, on its own (the layer panel's 3D view): as if shown, in
 *              its base's shape when clipped onto one; the rest of the cover still sets the scene for it
 * Leaves cv._hits behind: one entry per drawn layer, bottom first, for pointer hit-testing.
 */
export function drawCover(cv, o) {
  // A look may set the whole cover in faces of its own. The font table is shared, so it is put
  // back however the drawing ends; so is the way a drag's frame or a draft draws (see setFast,
  // setDraft), not to be left to a thumbnail or an export after a frame that failed.
  const L = setLook(o.profile.style.look), swap = L.faces ? L.faces(fonts) : null, keep = swap ? { ...fonts } : null;
  if (swap) Object.assign(fonts, swap);
  try { paintCover(cv, o); } finally { if (keep) Object.assign(fonts, keep); setFast(false); setDraft(false); }
}
/**
 * The cover as it is at the size keyed `key`: a layer kept to other sizes (`sizes`, see layers.js) is not on it — hidden,
 * and a layout layer left out (`off`), so the layout gives its room to the others there as for a part left out (see
 * partsOf), and whatever asks which layers show (the background photo, the brand row, what lettering a cut-out weaves
 * with, the hits) passes it by. The same cover, unchanged, when every layer shows at that size; else a shallow copy,
 * each layer that shows the same object, by the same index.
 */
export function coverAt(cover, key) {
  if (cover.layers.every((l) => inSize(l, key))) return cover;
  return { ...cover, layers: cover.layers.map((l) => (inSize(l, key) ? l : { ...l, visible: false, ...(isLayout(l) && l.type !== "bg" ? { off: true } : {}) })) };
}
/** Which of the layout's parts that take room a cover has (see meetStandards): those not left out of it, a graphic only when its channel has one, a subtitle and a tag only with words. */
export const partsOf = (cover, cat) => {
  const on = (type) => cover.layers.some((l) => l.id === type && !l.off);   // the layout's own (a copy has an id of its own)
  return { catname: on("catname"), graphic: on("graphic") && !!cat.graphic && cat.graphic.kind !== "none", subtitle: on("subtitle") && parseTitle(cover.subtitle).length > 0, tag: on("tag") && !!cover.tag };
};
/**
 * The geometry of a cover of w × h (virtual units) in look `L` drawn in layout `lay` ({ template, adjust }, see layoutOf
 * in layout.js): the look's own layout of the template (L.layout) or the template's, adjusted (adjustLayout), and held
 * to the cover standards (meetStandards) for a cover that has `parts` (see partsOf). What a cover is drawn on, and what
 * the Style tab's sliders start from.
 */
export const coverLayout = (L, lay, w, h, parts) => meetStandards(adjustLayout(L.layout ? L.layout(lay.template, w, h) : layout(lay.template, w, h), w, h, lay.adjust), w, h, lay.adjust, parts);
/** The graphic a look's figure is drawn from in the channel graphic's place, as env.graphic is given: null when there is none, or it has gone from the library. */
function figureArt(style, look, C) {
  const ref = style.lookArt && style.lookArt[look];
  return ref && assetExists(ref) ? { ref, draw: (c) => drawAsset(c, ref, C, { tint: true }) } : null;
}
function paintCover(cv, o) {
  const P = o.profile, cat = P.categories[o.catIndex];
  const [w, h] = virtualSize(o.size.w, o.size.h), key = sizeKey(o.size), cover = coverAt(o.cover, key);   // the layers kept to other sizes left out of it
  cv.width = Math.max(1, Math.round(o.pixelW));
  cv.height = Math.max(1, Math.round((o.pixelW * o.size.h) / o.size.w));
  const ctx = cv.getContext("2d"), kx = cv.width / w, ky = cv.height / h;
  ctx.scale(kx, ky);
  const C = hexToRgb(cat.color);
  // the cover's background photo: the lowest photo that fills the canvas (looks and themes ask whether there is one)
  const main = cover.layers.find((l) => fillsCanvas(l) && l.visible && appliesTo(l, cat.id)), mainRec = main && o.photos && o.photos.get(main.pid);
  const photo = (mainRec && mainRec.img) || null;
  const L0 = setLook(P.style.look, P.style.lookParams && P.style.lookParams[P.style.look], P.style.lookSeed, !!photo || P.style.theme !== "light");   // everything below is drawn under this look
  // a look's slider dragged (o.draft.key): which of its values each layer reads is noted, and what is read
  // before the layers (the theme, the layout) in `global` (see the runs below)
  const noted = !o.live && o.draft && o.draft.key ? o.draft : null;
  if (noted) { noteReads(); readsInto((noted.global = new Set())); }
  setScene(sceneOffsets(cover, L0.id, key), w, h, kx);   // where the user dragged its scene objects on this cover
  const base = photo ? THEMES.dark : THEMES[P.style.theme] || THEMES.dark;
  const G = coverLayout(L0, layoutOf(P.style, key), w, h, partsOf(cover, cat));   // in the layout this size is drawn in: the profile's, or its own
  const env = {
    blocks: {},   // id -> {m, box}: the transform and box of each lettered block painted (see cv._blocks)
    o, w, h, cover, cat, C, acc: rgb(C), style: P.style, photo, key, hiRes: cv.width > w,
    G,
    th: L0.theme ? L0.theme(base, C, lookValues()) : base,
    hasBrand: cover.layers.some((l) => (l.id === "brand" || (l.id === "logo" && logoBox(P, w))) && l.visible),
    logo: cover.layers.some((l) => l.id === "logo" && l.visible) ? offEdge(logoBox(P, w, L0.logoInset), G) : null,   // where the brand logo goes, when there is one (the brand row's rail makes way for it)
    resolve: (l) => resolve(l, w, h, key, cat.id),   // where another layer is (a photo's copy follows its original)
    // the channel graphic, for a look that uses its shape (a giant silhouette, a glowing photogram): draw(ctx) paints it about 0, 0 at scale 1
    graphic: cat.graphic && cat.graphic.kind !== "none" ? { ref: cat.graphic, draw: (c) => drawAsset(c, cat.graphic, C, { tint: true, labels: cat.graphic.labels, stamp: cat.graphic.stamp }) } : null,
    // the graphic the user put in the channel graphic's place for this look's figure (see `art` in style.js), when it is still in the library
    figure: figureArt(P.style, L0.id, C),
  };
  env.sub = subtitlePlan(ctx, env);
  // where a hidden one would go, for when it is painted on its own (the 3D view); the title makes no room for it
  env.subHidden = env.sub || subtitlePlan(ctx, env, true);
  cv._virtual = [w, h];
  cv._layout = env.G;   // for the editor's layout handles
  // FOCUS: how see-through a layer not kept bright is painted
  const dimmed = (from, to) => (o.spot && !cover.layers.slice(from, to + 1).some((l) => o.spot.includes(l.id)) ? SPOT_DIM : 1);
  /**
   * Weaving (see `weave` in layers.js): what of the lettering a cut-out, or an asset (layer i, see canWeave), weaves
   * with comes in front of it. Each layer it weaves with that lies below it and shows on this cover is painted alone
   * in the canvas's own space, as in a clipping group (as if not dimmed: FOCUS dims the lettering itself) — all of it
   * (by the head, by the brush), or in letter mode only its letters in front (env.only) — onto one canvas, which the
   * cut-out lets through (see PAINT.photo, PAINT.asset): the lettering is painted once, below, and seen through the
   * subject. {c, key, by, line, strokes}, or null when nothing is woven (by the brush, also while no stroke puts
   * anything in front). Worked out before the cut-out is painted (the layers' own work canvases serve for it); kept,
   * and while something is dragged used again for as long as what decides it (`key`) is the same.
   */
  const wovenFront = (i) => {
    const X = cover.layers[i], wv = canWeave(X) && X.weave, rec = wv && X.type === "photo" && o.photos && o.photos.get((X.of ? cover.layers.find((l) => l.id === X.of) || {} : X).pid);
    if (!wv || !(X.type === "asset" ? assetHalf(X.ref) : rec && rec.mask) || (wv.by === "brush" && !brushesFront(wv))) return null;   // an asset gone, a subject not yet cut out
    const list = [];
    for (let j = 0; j < i; j++) {
      const l = cover.layers[j], b = clipBase(cover.layers, j);   // a hidden base hides what is clipped onto it
      if (HEADLINES.includes(l.type) && wv.with.includes(l.id) && l.visible && appliesTo(l, cat.id) && (b < 0 || cover.layers[b].visible) && (wv.by !== "letters" || frontOf(wv, l.id).length)) list.push(j);
    }
    if (!list.length) return null;
    const wkey = [cv.width, cv.height, key, cat.id, wv.by === "letters", JSON.stringify(P.style), JSON.stringify(lookValues()), C.join(), main ? main.pid : "", cover.title, cover.subtitle, JSON.stringify(env.sub), JSON.stringify(G), env.hasBrand, fontState(),
      ...list.map((j) => { const l = cover.layers[j], b = clipBase(cover.layers, j); return JSON.stringify([l, resolve(l, w, h, key, cat.id), wv.by === "letters" ? frontOf(wv, l.id) : 0, b >= 0 ? [cover.layers[b], resolve(cover.layers[b], w, h, key, cat.id)] : 0]); })].join("|");
    // kept on the editor's canvas only (a thumbnail, a hand of Surprise me, an export make their own, let go after)
    const editor = !!(o.select || o.live), slot = `${X.id}@${cv.width}x${cv.height}`, kept = editor ? WOVEN.get(slot) : null;
    const out = (c) => ({ c, key: wkey, by: wv.by, line: wv.line, strokes: wv.strokes, temp: !editor });   // the way, the head line and the strokes as they are now: not what decided the lettering
    if (kept && kept.key === wkey && isFast()) { WOVEN.delete(slot); WOVEN.set(slot, kept); return out(kept.c); }
    const canvas = kept ? kept.c : document.createElement("canvas"), g = freshCanvas(canvas, cv, kx, ky);
    // each at full strength, its base too: what of it is in front takes the subject's place there wholly
    const strong = (l, fn) => { const was = l.o; l.o = 1; try { fn(); } finally { l.o = was; } };
    for (const j of list) {
      const l = cover.layers[j], b = clipBase(cover.layers, j);
      env.only = wv.by === "letters" ? new Set(frontOf(wv, l.id)) : null;
      try {
        if (b < 0) { strong(l, () => paintRange(g, j, j + 1, true)); continue; }
        // clipped onto a layer below: only where that one is
        const one = freshCanvas(WOVE.one = WOVE.one || document.createElement("canvas"), cv, kx, ky);
        strong(l, () => paintRange(one, j, j + 1, true));
        env.only = null;
        strong(cover.layers[b], () => paintRange(freshCanvas(WOVE.base = WOVE.base || document.createElement("canvas"), cv, kx, ky), b, b + 1, true));
        one.setTransform(1, 0, 0, 1, 0, 0); one.globalCompositeOperation = "destination-in"; one.drawImage(WOVE.base, 0, 0); one.globalCompositeOperation = "source-over";
        g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(WOVE.one, 0, 0); g.restore();
        letGo(WOVE.one); letGo(WOVE.base);
      } finally { env.only = null; }
    }
    if (editor) {
      WOVEN.delete(slot); WOVEN.set(slot, { c: canvas, key: wkey });
      let px = 0; for (const k of WOVEN.values()) px += k.c.width * k.c.height;
      for (const [s0, k] of WOVEN) { if (px <= WOVEN_PX || WOVEN.size <= 1) break; px -= k.c.width * k.c.height; WOVEN.delete(s0); }
    }
    return out(canvas);
  };
  const moved = new Set();   // the layers repainted every frame of a drag (see below): what they paint is not kept
  /** Paints layers [from, to) onto `c` (a context already scaled to the virtual canvas) and returns their hits. `whole`: inside a clipping group, which is dimmed as one. */
  const paintRange = (c, from, to, whole = false) => {
    const hits = [];
    for (let i = from; i < to; i++) {
      const L = cover.layers[i], end = Math.min(to - 1, clipEnd(cover.layers, i));
      if (end > i) {   // a clipping group: the base, and the layers clipped onto it shown only where it is
        if (L.visible && appliesTo(L, cat.id)) {
          const g = freshCanvas(clipGround = clipGround || document.createElement("canvas"), cv, kx, ky);
          hits.push(...paintRange(g, i, i + 1, true));
          for (let j = i + 1; j <= end; j++) {
            const one = freshCanvas(clipOne = clipOne || document.createElement("canvas"), cv, kx, ky), got = paintRange(one, j, j + 1, true);
            if (!got.length) continue;
            hits.push(...got);
            g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-atop"; g.drawImage(clipOne, 0, 0); g.restore();
          }
          c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = whole ? 1 : dimmed(i, end); c.drawImage(clipGround, 0, 0); c.restore();
        }   // a hidden base hides what is clipped onto it
        i = end;
        continue;
      }
      if (!L.visible || !appliesTo(L, cat.id)) continue;
      const tr = resolve(L, w, h, key, cat.id), dim = whole ? 1 : dimmed(i, i);
      // a layer set in a font of its own: that font goes first in every face while the layer is painted
      const faces = L.font ? { ...fonts } : null;
      if (faces) for (const k of ["cn", "en", "serif"]) fonts[k] = `"${L.font}", ${faces[k]}`;
      let hit, woven = null;
      const t0 = TIMING.on ? performance.now() : 0, mine = noted && new Set(), above = noted && readsInto(mine);
      try {
      const fx = layerEffects(L);
      woven = L.weave && canWeave(L) ? wovenFront(i) : null;
      // a cut-out or an asset lets its woven lettering through as it is painted, or with look effects after them (see PAINT.photo)
      env.woven = woven && { ...woven, later: fx.length > 0 }; env.letThrough = null;
      let from = null, slot = null, kept = null;
      if (fx.length && (L.type === "photo" || (L.type === "asset" && L.weave))) {
        // kept as painted before any lettering woven with it is let through, so the weave is not part of what decides it;
        // one made while nothing was dragged serves the frames of a drag too, one made in a draft never a still cover
        // (see fxServes). A woven asset's too (the lettering under it dragged repaints it), by the asset it draws and the
        // fonts there are (a word sticker painted before its face arrived is not kept past it); one not woven is
        // repainted only as it moves itself
        const base = L.of ? cover.layers.find((l) => l.id === L.of) : L, rec = base && o.photos && o.photos.get(base.pid);
        slot = `${L.id}@${cv.width}x${cv.height}`;
        from = [kx, ky, key, objId(rec && rec.img), objId(rec && rec.mask && rec.mask.img), C, main ? main.pid : "",
          JSON.stringify(P.style), JSON.stringify(tr), JSON.stringify({ ...L, weave: null }), L.of ? JSON.stringify(base) : "",
          L.type === "asset" ? `${L.ref.kind === "user" ? objId(userAssets.get(L.ref.id)) : ""}/${fontState()}` : ""].join("|");
        kept = FX_KEPT.get(slot);
        if (!fxServes(kept, from, paintLevel())) kept = null;
      }
      if (kept) {
        FX_KEPT.delete(slot); FX_KEPT.set(slot, kept);   // the newest again
        let img = kept.img;
        if (woven && kept.cut) { const s = sheet(3, img.width, img.height, new DOMMatrix()); s.drawImage(img, 0, 0); kept.cut(woven)(s, kept.got.x0, kept.got.y0); img = s.canvas; }
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = L.o * dim; c.drawImage(img, kept.got.x0, kept.got.y0); c.restore();
        if (img !== kept.img) letGo(img);
        hit = kept.hit;
      } else if (L.o < 1 || dim < 1 || fx.length) {   // paint the layer on its own — its look effects added to it there — then blend it in as a whole
        // a layer with effects gets a canvas held in memory: the effects read it back and copy from it, which
        // on a canvas kept on the graphics card means a round trip each time (see fxCanvas in looks/kit.js)
        if (fx.length && !fxScratch) { fxScratch = document.createElement("canvas"); fxScratch.getContext("2d", { willReadFrequently: true }); }
        const scr = fx.length ? fxScratch : (scratch = scratch || document.createElement("canvas"));
        if (scr.width !== cv.width || scr.height !== cv.height) { scr.width = cv.width; scr.height = cv.height; }
        const sx = scr.getContext("2d");
        sx.setTransform(1, 0, 0, 1, 0, 0); sx.globalAlpha = 1; sx.globalCompositeOperation = "source-over"; sx.clearRect(0, 0, cv.width, cv.height); sx.scale(kx, ky);
        hit = PAINT[L.type](sx, L, tr, env);
        // with effects, only the box the layer and its effects reached is laid down
        const got = hit && fx.length ? paintEffects(sx, pixelBox(hit, kx, ky, cv.width, cv.height), fx, L, kx, env.C) : null, cut = env.letThrough;
        // kept before the woven lettering is let through; not while the layer moves (it is dragged, or with what it
        // weaves with): every frame would make a copy only to be thrown away
        if (from && got && got.w > 0 && got.h > 0 && !moved.has(i)) {
          const img = document.createElement("canvas"); img.width = got.w; img.height = got.h;
          img.getContext("2d").drawImage(scr, got.x0, got.y0, got.w, got.h, 0, 0, got.w, got.h);
          FX_KEPT.delete(slot); FX_KEPT.set(slot, { from, level: paintLevel(), img, got, hit, cut });
          let px = 0; for (const k of FX_KEPT.values()) px += k.got.w * k.got.h;
          for (const [s0, k] of FX_KEPT) { if (px <= FX_KEPT_PX || FX_KEPT.size <= 1) break; px -= k.got.w * k.got.h; FX_KEPT.delete(s0); }
        }
        if (woven && cut && fx.length) cut(woven)(sx, 0, 0);   // the lettering woven in front, through its effects too
        c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = L.o * dim;
        if (got && got.w > 0 && got.h > 0) c.drawImage(scr, got.x0, got.y0, got.w, got.h, got.x0, got.y0, got.w, got.h); else c.drawImage(scr, 0, 0);
        c.restore();
      } else hit = PAINT[L.type](c, L, tr, env);
      } finally {
        if (woven && woven.temp) woven.c.width = woven.c.height = 0; env.woven = env.letThrough = null; if (faces) Object.assign(fonts, faces); if (TIMING.on) TIMING.ms[L.id] = (TIMING.ms[L.id] || 0) + performance.now() - t0;
        if (noted) {   // what this layer read, each time it was painted this frame; a layer painted inside another (woven lettering) counts for that one too
          readsInto(above);
          if (above) for (const k of mine) above.add(k);
          const was = noted.reads.get(L.id);
          if (was && was.frame === noted.frame) for (const k of mine) was.keys.add(k); else noted.reads.set(L.id, { frame: noted.frame, keys: mine });
        }
      }
      c.globalAlpha = 1; c.setLineDash([]);
      if (hit) hits.push({ id: L.id, type: L.type, ...hit });
    }
    return hits;
  };
  if (o.only != null) {   // one layer on its own: no look painted over it all, no selection
    cv._hits = paintAlone(ctx, cover.layers, o.only, paintRange, kx, ky, cv);
    cv._scene = []; cv._blocks = { k: kx }; cv._titleBox = null;
    return;
  }
  const n = cover.layers.length, moving = o.live ? (o.live.ids || [o.live.id]).map((id) => cover.layers.findIndex((l) => l.id === id)).filter((i) => i >= 0) : [];
  if (noted) {
    // A look's slider is dragged: the layers that read its setting when last painted are painted again each
    // frame, as dragged layers are, and the rest kept (what is read nowhere but in `post` keeps them all).
    // In the first frame, or when the setting decides what comes before the layers, all are painted again.
    readsInto(null);
    noted.frame = (noted.frame || 0) + 1;
    const first = !noted.reads;
    if (first) noted.reads = new Map();
    for (let i = 0; i < n; i++) {
      const r = noted.reads.get(cover.layers[i].id);
      if (first || noted.global.has(noted.key) || (r && r.keys.has(noted.key))) moving.push(i);
    }
  }
  // a clipping group moves as one: dragging its base or a layer clipped onto it repaints them all
  const groups = () => {
    for (const i of [...moving]) {
      let b = i;
      while (b > 0 && cover.layers[b].clip) b--;
      const e = clipEnd(cover.layers, b);   // b itself when nothing is clipped onto it, or it is the ground
      if (e > b) for (let k = b; k <= e; k++) if (!moving.includes(k)) moving.push(k);
    }
  };
  groups();
  // a cut-out or an asset woven with lettering that moves (or whose base does) lets it through where it now is: it is repainted
  // with it, and so is its own group
  for (const i of [...moving]) cover.layers.forEach((l, k) => { if (k > i && l.weave && canWeave(l) && l.weave.with.includes(cover.layers[i].id) && !moving.includes(k)) moving.push(k); });
  groups();
  for (const i of moving) moved.add(i);
  setFast(!noted && moving.length > 0); setDraft(moving.length > 0 || !!o.draft);   // a drag's frames are drawn coarser here and there; a draft's photos, faster
  let scene = null;   // in a frame that keeps runs of layers: the scene objects placed, those of a kept run as it placed them
  if (!moving.length && !noted) cv._hits = paintRange(ctx, 0, n);
  else {
    // Layers are being dragged (or read a look's setting being dragged). The cover is cut into runs of
    // layers that move and runs that do not; each still run is painted once into an image kept in o.live
    // (o.draft), and each frame only blits those and repaints the moving runs. (Dragging the background
    // photo moves it and its cut-out copy above the title: the four layers between them stay one image.)
    const live = o.live || noted, still = new Set(moving), runs = [];
    scene = scenePlaced();   // what was placed before the layers; each run's own are added below, in order (a still run's, kept with it)
    for (let i = 0; i < n; i++) {
      const mv = still.has(i), last = runs[runs.length - 1];
      if (last && last.moving === mv) last.to = i + 1; else runs.push({ from: i, to: i + 1, moving: mv });
    }
    // a draft's kept runs hold for this cover at this size and for the look's other values as they are: the cover as
    // given (o.cover), whose identity holds from frame to frame, not as drawn at this size (coverAt), a copy each time
    // a layer is kept to other sizes
    const stamp = `${cv.width}x${cv.height}|${n}|${[...still].sort((a, b) => a - b).join(",")}|${o.spot ? o.spot.join(",") : ""}` + (noted ? `|${objId(o.cover)}|${key}|${o.catIndex}|${JSON.stringify({ ...lookValues(), [noted.key]: null })}` : "");
    if (live.stamp !== stamp) {
      live.stamp = stamp; if (TIMING.on) TIMING.rebuilt++;
      live.runs = runs.map((r) => {
        if (r.moving) return null;
        const img = document.createElement("canvas");
        img.width = cv.width; img.height = cv.height;
        const c = img.getContext("2d"), at = scenePlaced().length;
        c.scale(kx, ky);
        const hits = paintRange(c, r.from, r.to);
        return { img, hits, scene: scenePlaced().slice(at) };
      });
    }
    const hits = [];
    runs.forEach((r, i) => {
      if (r.moving) { const at = scenePlaced().length; hits.push(...paintRange(ctx, r.from, r.to)); scene.push(...scenePlaced().slice(at)); return; }
      const kept = live.runs[i];
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kept.img, 0, 0); ctx.restore();
      hits.push(...kept.hits); scene.push(...kept.scene);
    });
    cv._hits = hits;
  }
  const atPost = scenePlaced().length;
  if (L0.post && cover.layers[0].visible) {   // not over a hidden background; over a see-through base only where something is painted
    const post = (x) => L0.post(x, w, h, C, lookValues(), kx, cv._hits);
    ctx.save(); wherePainted(ctx, post, cover.layers[0].base === "clear", "post"); ctx.restore();
  }
  setFast(false); setDraft(false);
  // where the look's scene objects were placed, for their handles: a run of layers kept between frames (a drag that does
  // not repaint the ground, a draft that repaints only what reads its setting) gives those it placed as it was painted;
  // each where it was first placed, bottom up, as a still cover places it (see objAt in looks/kit.js)
  const shown = new Set();
  cv._scene = (scene ? scene.concat(scenePlaced().slice(atPost)) : scenePlaced()).filter((q) => L0.scene && L0.scene[q.key] && !shown.has(q.key) && shown.add(q.key));   // only what the look offers to drag
  cv._titleBox = env.titleBox || (noted && cv._titleBox) || null;
  // where lettered blocks are, for the perspective's handles; a drag paints only some layers, so what is not repainted is kept
  cv._blocks = { ...(o.live || noted ? cv._blocks : null), ...env.blocks, k: kx };
  if (o.brush) brushOverlay(ctx, cv, cover, o, C, kx, ky);   // painting with the weave's brush: no frame, no handles
  else if (o.picked && o.picked.length > 1) {
    for (const hit of cv._hits) if (o.picked.includes(hit.id) && showsFrame(hit)) drawSelection(ctx, hit, kx, false);
  } else if (o.select) {
    const hit = cv._hits.find((x) => x.id === o.select);
    if (hit && showsFrame(hit)) drawSelection(ctx, hit, kx, o.handles !== false);
    drawLayoutHandles(ctx, cv, cover.layers.find((l) => l.id === o.select), kx, rgb(C));
    if (o.select === "bg" && o.sceneHandles !== false) drawSceneHandles(ctx, cv._scene, kx);
  }
}
/**
 * While the weave's brush paints on cut-out `o.brush` (see brushOpen in app.js), or on an asset: where it puts the
 * lettering in front, laid over the canvas in the channel colour — clearer (about a third) over the subject (what an
 * asset draws), where it counts, fainter off it, where painting changes nothing, so a stroke that misses shows. From
 * the brush mask the cut-out is cut by (the same size: the same mask), mapped by where the picture is (the hit's `pf`).
 */
function brushOverlay(ctx, cv, cover, o, C, kx, ky) {
  const L = cover.layers.find((l) => l.id === o.brush), hit = L && cv._hits && cv._hits.find((h) => h.id === L.id);
  if (!hit || !hit.pf || !canWeave(L) || !L.weave || !brushesFront({ ...L.weave, by: "brush" })) return;
  // the picture's size, and its subject laid on `s` (a sheet in its fractions, its own transform `t` with them)
  let nw, nh, subject;
  if (L.type === "asset") {   // what it draws, drawn again in the box it is drawn in, the sheet kept to that
    const half = assetHalf(L.ref);
    if (!half) return;
    nw = 2 * half.hw; nh = 2 * half.hh;
    subject = (s, t) => {
      const g = sheet(1, s.canvas.width, s.canvas.height, t.translate(0.5, 0.5).scale(1 / nw, 1 / nh));
      drawAsset(g, L.ref, L.ink ? hexToRgb(L.ink) : C, { tint: L.tint || !!L.ink });
      s.save(); s.setTransform(1, 0, 0, 1, 0, 0); s.drawImage(g.canvas, 0, 0); s.restore();
    };
  } else {
    const base = L.of ? cover.layers.find((l) => l.id === L.of) : L, rec = base && o.photos && o.photos.get(base.pid), mask = rec && rec.mask && rec.mask.img;
    if (!mask) return;
    [nw, nh] = sizeOf(rec.img);
    subject = (s) => s.drawImage(mask, 0, 0, 1, 1);
  }
  const pad = BRUSH_PAD, m = new DOMMatrix([kx, 0, 0, ky, 0, 0]).multiplySelf(new DOMMatrix(hit.pf));   // the picture's fractions to the canvas's pixels
  const corners = [[-pad, -pad], [1 + pad, -pad], [1 + pad, 1 + pad], [-pad, 1 + pad]].map(([u, v]) => { const p = m.transformPoint({ x: u, y: v }); return [p.x, p.y]; });
  const bx = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])))), by = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
  const bw = Math.min(cv.width, Math.ceil(Math.max(...corners.map((p) => p[0])))) - bx, bh = Math.min(cv.height, Math.ceil(Math.max(...corners.map((p) => p[1])))) - by;
  if (bw <= 0 || bh <= 0) return;
  const t = new DOMMatrix().translateSelf(-bx, -by).multiplySelf(m), b = brushMask(L.id, L.weave.strokes, nw, nh, 1, 1, m, cv, true), s = sheet(2, bw, bh, t);
  s.drawImage(b.c, -pad, -pad, 1 + 2 * pad, 1 + 2 * pad);
  s.globalCompositeOperation = "source-in"; s.fillStyle = rgb(C); s.fillRect(-pad, -pad, 1 + 2 * pad, 1 + 2 * pad);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.15; ctx.drawImage(s.canvas, bx, by);
  s.globalCompositeOperation = "destination-in"; subject(s, t);   // on the subject, and what the crop keeps of it
  const crop = !(L.fill && !L.of) && L.crop;   // a photo filling the canvas ignores its crop, as PAINT.photo does
  if (crop) { s.fillStyle = "#000"; if (crop.pts) { tracePoly(s, crop.pts, { x: 0, y: 0, iw: 1, ih: 1 }); s.fill("evenodd"); } else s.fillRect(crop.x, crop.y, crop.w, crop.h); }
  ctx.globalAlpha = 0.24; ctx.drawImage(s.canvas, bx, by);   // over the faint one: about 0.35 in all
  ctx.restore();
  if (b.temp) b.c.width = b.c.height = 0;
}
/**
 * Paints layer i of `layers` alone onto `ctx` (see o.only) with the cover's paintRange, shown even when
 * hidden; a layer clipped onto a base is kept to the base's shape, the base itself not painted. Returns
 * its hits. The cover's scene (its main photo, its theme) was set up from what is really shown.
 */
function paintAlone(ctx, layers, i, paintRange, kx, ky, cv) {
  const L = layers[i], b = clipBase(layers, i), B = b >= 0 ? layers[b] : null, shown = [L.visible, B && B.visible];
  L.visible = true;
  if (B) B.visible = true;
  try {
    if (!B) return paintRange(ctx, i, i + 1);
    const g = freshCanvas(clipGround = clipGround || document.createElement("canvas"), cv, kx, ky);
    paintRange(g, b, b + 1);
    const one = freshCanvas(clipOne = clipOne || document.createElement("canvas"), cv, kx, ky), hits = paintRange(one, i, i + 1);
    one.setTransform(1, 0, 0, 1, 0, 0); one.globalCompositeOperation = "destination-in"; one.drawImage(clipGround, 0, 0); one.globalCompositeOperation = "source-over";
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(clipOne, 0, 0); ctx.restore();
    return hits;
  } finally { L.visible = shown[0]; if (B) B.visible = shown[1]; }
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
  return warpCorners(layer.warp, layer.bendAmt ?? 1).map(([dx, dy], i) => {
    const p = b.m.transformPoint({ x: box.x + ([0, 1, 1, 0][i] + dx) * box.w, y: box.y + ([0, 0, 1, 1][i] + dy) * box.h });
    return { id: "w" + i, x: p.x / k, y: p.y / k };
  });
}
/** A bend's handles, but the perspective's (see warpHandles): 4 along the top of its lettering and 4 along its bottom, where the bend and the user's reshaping put them. */
export function reshapeHandles(cv, layer) {
  const b = cv._blocks && cv._blocks[layer.id];
  if (!b || !b.m || !b.rest) return [];
  const k = cv._blocks.k || 1;
  return reshaped(b.rest, layer.reshape, b.box).map(([x, y], i) => { const p = b.m.transformPoint({ x, y }); return { id: "e" + i, x: p.x / k, y: p.y / k }; });
}
export function layoutHandles(cv, layer) {
  const headline = layer && ["title", "subtitle", "text"].includes(layer.type) && layer.bend && !layer.locked && !columned(layer);   // in columns, no bend
  const warp = !headline ? [] : layer.bend === "taper" ? warpHandles(cv, layer) : reshapeHandles(cv, layer);
  return [...warp, ...templateHandles(cv, layer)];
}
function templateHandles(cv, layer) {
  const G = cv._layout;
  if (!G || !layer || layer.off) return [];   // a block left out (at this size, see coverAt) has no edge to drag
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

/**
 * The handles of the look's scene objects, with the ground selected: a white ring and dot edged in black,
 * which read on any ground (the channel colour would vanish on a ground of that colour).
 */
function drawSceneHandles(ctx, list, k) {
  if (!list || !list.length) return;
  const u = 1 / k;
  ctx.save();
  for (const s of list) {
    ctx.beginPath(); ctx.arc(s.x, s.y, 11 * u, 0, Math.PI * 2); ctx.fillStyle = "rgba(7,7,12,0.45)"; ctx.fill();
    ctx.lineWidth = 6 * u; ctx.strokeStyle = "rgba(0,0,0,0.9)"; ctx.stroke();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = "#ffffff"; ctx.stroke();
    ctx.beginPath(); ctx.arc(s.x, s.y, 4 * u, 0, Math.PI * 2); ctx.fillStyle = "#ffffff"; ctx.fill();
    ctx.lineWidth = 1.5 * u; ctx.strokeStyle = "#000000"; ctx.stroke();
  }
  ctx.restore();
}
/** The scene object's handle at virtual point (x, y) (k: canvas pixels per unit, for the handles' size on screen), or null. */
export const sceneHandleAt = (cv, x, y, k) => (cv._scene || []).find((s) => Math.hypot(x - s.x, y - s.y) <= 14 * k) || null;   // (the editor asks only while they show)
/**
 * Topmost hit (from cv._hits) containing the virtual point (x, y) for which accept(hit) is true: within its box, and
 * for a layer cropped free (`poly`), within its shape too, or as near its outline as the box's margin.
 */
export function hitAt(hits, x, y, accept = () => true, margin = 12) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const t = hits[i];
    if (!accept(t)) continue;
    const a = -t.r * RAD, dx = x - t.cx, dy = y - t.cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= t.hw + margin && Math.abs(ly) <= t.hh + margin && (!t.poly || inPoly(t.poly, x, y) || edgePoint(t.poly, x, y).d <= margin)) return t;
  }
  return null;
}
