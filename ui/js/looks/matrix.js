// matrix: the phosphor terminal
// The green screen of an old terminal and the digital rain of the films: columns of glyphs (half-width katakana
// mirrored as the film set them, digits, a few signs) frozen mid-fall in depth, each with a white-hot head and a
// tail fading into the dark, the far columns smaller, dimmer and soft; terminal windows lettered from the channel's
// name and the brand; the channel graphic projected as a hologram of green scanlines; a wireframe city on a
// perspective grid; the tube's scanlines, its glow, its dark curved corners and a torn band now and then. One hue,
// from bottle green through the phosphor to a white-green. The light ground is the same screen in inverse video,
// the code dark on lit phosphor.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, WORK, blurred, canPaint, cellsOf, clamp, css, current, dark, dkHsl, dkRgb, every, fast, figureOf, glowBehind, graphicShape, gridPen, inPixels, keepClear, keepOthers, keptLayer, lum, lumOf, mapped, mix, near, objAt, onLayer, openField, overlaps, pad2, painters, parseColour, rand, region, role, rounded, seed, shapeCells, shift, slideBands, snap, softCopy, titleArea, toneTable, upright, values, vignette } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const MX_HUE = 134;   // the green of a P1 phosphor: a little toward yellow of a pure green
/**
 * The screen's colours, all of one hue — the channel colour's with Phosphor in the channel colour (a grey channel
 * gives the white of a P4 tube), else the phosphor's green: `void` (the unlit glass), `deep` (bottle green),
 * `dim`, `mid`, `phos` (the lit phosphor), `hot` and `white` (the hottest heads); for the inverse video of the light
 * ground, `paper` (the lit screen), `edge` (its darker rim) and `ink` (the code on it).
 */
export function mxRamp(C, chan = 0) {
  let h = MX_HUE, s = 1;
  if (chan && C) { const [hc, sc] = dkHsl(C); if (sc < 0.15) s = 0.08; else h = hc; }
  const at = (sat, l, dh = 0) => dkRgb((h + dh + 360) % 360, sat * s, l);
  return {
    void: at(0.7, 0.016), deep: at(0.8, 0.06), dim: at(1, 0.17), mid: at(1, 0.32), phos: at(1, 0.57), hot: at(1, 0.8), white: at(1, 0.93),
    paper: at(0.56, 0.53, -16), edge: at(0.6, 0.36, -8), ink: at(0.8, 0.07), inkSoft: at(0.9, 0.17),
  };
}
const rampOf = (C, p) => mxRamp(C, p && p.chan);
/** The one other colour on the screen, for an alert line and a status light: the channel colour, or a hot red where it would read as the phosphor. */
export function mxAlert(C, R) { const c = C || [255, 60, 90]; return near(c, R.phos, 150) || near(c, R.mid, 110) || lum(c) < 0.12 ? [255, 64, 92] : c; }
/** The ground's colour, the theme's field: the unlit glass, or the lit screen of inverse video. */
const mxField = (R) => (dark ? R.void : R.paper);
/** The code's colour on the ground: the phosphor on the glass, the dark ink on the lit screen. */
const mxInk = (R) => (dark ? R.phos : R.ink);

// ---------------------------------------------------------------- the glyphs of the rain
const KANA = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ", DIGITS = "0123456789", SIGNS = "Z:=*+<>¦.\"";
const GLYPHS = [...KANA, ...DIGITS, ...SIGNS], NK = KANA.length, NG = GLYPHS.length;
/** The glyph of a cell: in a binary column a 0 or a 1; else mostly kana, a fifth digits, a few signs (`k` its random). */
export function mxGlyph(k, binary) {
  const r = rand(k);
  if (binary) return NK + (r < 0.5 ? 0 : 1);
  return r < 0.72 ? Math.floor((r / 0.72) * NK) : r < 0.93 ? NK + Math.floor(((r - 0.72) / 0.21) * 10) : NK + 10 + Math.floor(((r - 0.93) / 0.07) * SIGNS.length);
}
/**
 * Every glyph of the rain in one colour, `px` canvas pixels tall, on one canvas (an atlas): cells `cw` × `ch` px,
 * `cols` to a row, the kana mirrored as the film has them. Kept per size and colour (a few), made again once the
 * fonts have come if they had not.
 */
function mxAtlas(px, cwPx, chPx, colour) {
  const kept = WORK.mxAtlas || (WORK.mxAtlas = new Map()), ready = typeof document === "undefined" || !document.fonts || document.fonts.check(`500 12px ${fonts.cn}`);
  const key = `${px.toFixed(1)}|${cwPx}|${chPx}|${colour.map(Math.round).join()}`;
  if (kept.has(key)) return kept.get(key);
  const cols = 11, rows = Math.ceil(NG / cols), c = document.createElement("canvas");
  c.width = cols * cwPx; c.height = rows * chPx;
  const x = c.getContext("2d");
  x.fillStyle = css(colour); x.textAlign = "center"; x.textBaseline = "middle";
  GLYPHS.forEach((g, i) => {
    const cx = ((i % cols) + 0.5) * cwPx, cy = (Math.floor(i / cols) + 0.5) * chPx;
    x.save(); x.translate(cx, cy);
    if (i < NK) { x.font = `500 ${px}px ${fonts.cn}`; x.scale(-1, 1); } else x.font = `600 ${px * 0.9}px ${fonts.mono}, ${fonts.cn}`;
    x.fillText(g, 0, 0); x.restore();
  });
  const A = { c, cw: cwPx, ch: chPx, cols, ready };
  if (ready) { kept.set(key, A); if (kept.size > 18) kept.delete(kept.keys().next().value); }
  return A;
}
/** A work canvas of the look's own, w × h px (kept per slot, let go with the look). */
function mxCanvas(slot, w, h) {
  const c = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}
/** The lengths a drop's tail may have, in rows, for a column `rows` long: eight, from short to most of the column. */
export const mxLens = (rows) => Array.from({ length: 8 }, (_, i) => 4 + Math.round(rows * (0.14 + 0.6 * (i / 7) ** 1.4)));
/** Of a drop `len` rows long, how bright the glyph `back` rows behind its head is (0–1, `flick`: one flickering in the tail), and its heat: 2 the head, 1 just behind it or flickering, 0 the tail. */
function mxLit(back, len, flick) {
  if (!back) return [1, 2];
  const b = Math.min(1, (1 - back / len) ** 1.6 * (back <= 2 ? 1 : 0.86) * (flick ? 1.8 : 1));
  return [b, back <= 2 || flick ? 1 : 0];
}
/**
 * The drops of one layer of rain over a w × h canvas, in units: glyphs `gs` tall in columns `cw` apart, rows `rh`;
 * each column on (a share `dens` of them, by the seed) holds a drop or two, each its head's row, its tail's length
 * (one of mxLens), binary or not, and which of three sets of glyphs it is made of. Pure: { cw, rh, cols, rows, lens, drops }.
 */
export function mxDropPlan(w, h, gs, dens, k0) {
  const cw = gs * 0.66, rh = gs * 1.1, cols = Math.ceil(w / cw) + 1, rows = Math.ceil(h / rh) + 1, lens = mxLens(rows), drops = [];
  for (let c = 0; c < cols; c++) {
    if (rand(k0 + c * 3.17) >= dens) continue;
    const binary = rand(k0 + c * 5.91) < 0.3, n = rand(k0 + c * 2.39) < 0.5 ? 2 : 1;
    for (let d = 0; d < n; d++) drops.push({ c, head: Math.floor(rand(k0 + c * 4.13 + d * 17.7) * (rows + 8)) - 3, li: Math.min(7, Math.floor(rand(k0 + c * 6.7 + d * 9.1) * 8)), binary, set: Math.floor(rand(k0 + c * 8.3 + d * 2.1) * 3) });
  }
  return { cw, rh, cols, rows, lens, drops };
}
/** The glyph `back` rows behind the head of a drop of glyph set `set` (see mxDropPlan). */
const mxGlyphAt = (set, li, back, binary, k0) => mxGlyph(k0 + set * 977.3 + li * 131.7 + back * 1.913, binary);
/**
 * Every glyph of one layer of rain (see mxDropPlan), from the head up its tail: calls cell(x, y, glyph, brightness
 * 0–1, heat) for each on the w × h canvas, in units — heat 2 the head, 1 the glyphs just behind it (and the odd one
 * flickering in the tail), 0 the tail. Pure.
 */
export function mxDrops(w, h, gs, dens, k0, cell) {
  const P = mxDropPlan(w, h, gs, dens, k0);
  for (const D of P.drops) {
    const len = P.lens[D.li];
    for (let back = 0; back <= len; back++) {
      const r = D.head - back;
      if (r < 0 || r >= P.rows) continue;
      const [b, heat] = mxLit(back, len, rand(k0 + D.set * 31.7 + D.li * 7.3 + back * 0.937) < 0.035);
      if (b >= 0.03) cell(D.c * P.cw, r * P.rh, mxGlyphAt(D.set, D.li, back, D.binary, k0), b, heat);
    }
  }
  return P;
}
/**
 * The drops one layer of rain is drawn with, made once: for each tail length, binary or not and glyph set, a column of
 * its glyphs from the tail's end down to the head, faded as mxDrops has them, the head white-hot (one canvas, a column
 * a drop; cells cwPx × chPx). Kept per size and colours (a few).
 */
function mxSprites(px, cwPx, chPx, lens, k0, cols) {
  const kept = WORK.mxSprites || (WORK.mxSprites = new Map()), key = `${px.toFixed(1)}|${cwPx}|${chPx}|${lens.join()}|${k0}|${cols.map((c) => c.map(Math.round).join()).join("/")}`;
  if (kept.has(key)) return kept.get(key);
  const atl = cols.map((c) => mxAtlas(px, cwPx, chPx, c)), all = [];
  for (let li = 0; li < 8; li++) for (let bin = 0; bin < 2; bin++) for (let set = 0; set < 3; set++) {   // each a canvas of its own: a small one is what each draw sends to the graphics card
    const len = lens[li], c = document.createElement("canvas"), g = c.getContext("2d");
    c.width = cwPx; c.height = (len + 1) * chPx;
    for (let back = 0; back <= len; back++) {
      const [b, heat] = mxLit(back, len, rand(k0 + set * 31.7 + li * 7.3 + back * 0.937) < 0.035), gi = mxGlyphAt(set, li, back, !!bin, k0), A = atl[heat];
      if (b < 0.03) continue;
      g.globalAlpha = b; g.drawImage(A.c, (gi % A.cols) * A.cw, Math.floor(gi / A.cols) * A.ch, A.cw, A.ch, 0, (len - back) * chPx, cwPx, chPx);
    }
    all.push(c);
  }
  const S = { all, cwPx, chPx };
  if (atl.every((A) => A.ready)) { kept.set(key, S); if (kept.size > 9) { const old = kept.keys().next().value; for (const c of kept.get(old).all) c.width = 0; kept.delete(old); } }
  return S;
}
/** The glyph size of the near rain, in units: the Glyph size slider. */
const mxGs = (w, h, p) => Math.min(w, h) * (0.017 + 0.03 * p.size);
/**
 * The digital rain over the whole w × h, painted on x (in its units): far columns small, dim and soft (painted
 * small and laid on enlarged), middle ones, the near ones sharp with white-hot heads and the glow round them; the
 * far ones come with Depth. Each drop is laid down whole from the drops made once (mxSprites). On the light ground
 * the code is dark ink and does not glow.
 */
function mxRain(x, w, h, p, R) {
  const k = Math.hypot(x.getTransform().a, x.getTransform().b), cv = x.canvas, gs0 = mxGs(w, h, p), dens = 0.12 + 0.62 * p.rain;
  const tones = [dark ? R.phos : R.inkSoft, dark ? mix(R.phos, R.hot, 0.6) : mix(R.inkSoft, R.ink, 0.5), dark ? R.white : R.ink];
  const layer = (g, f, gs, d, bright, k0) => {   // one depth, painted at 1/f of the pixels on canvas g (its transform: units to its pixels)
    const px = gs * k / f, cwPx = Math.max(2, Math.round(gs * 0.66 * k / f)), chPx = Math.max(2, Math.round(gs * 1.1 * k / f)), cwU = (cwPx * f) / k, chU = (chPx * f) / k;
    const P = mxDropPlan(w, h, gs, d, k0), S = mxSprites(px, cwPx, chPx, P.lens, k0, tones);
    g.globalAlpha = Math.min(1, bright);
    for (const D of P.drops) {
      const len = P.lens[D.li];
      g.drawImage(S.all[(D.li * 2 + (D.binary ? 1 : 0)) * 3 + D.set], D.c * P.cw, (D.head - len) * P.rh, cwU, (len + 1) * chU);
    }
    g.globalAlpha = 1;
  };
  const soft = (f, gs, d, bright, k0, slot) => {   // a layer painted small, laid on enlarged: soft as a far thing is
    const sw = Math.max(1, Math.ceil(cv.width / f)), sh = Math.max(1, Math.ceil(cv.height / f)), c = mxCanvas(slot, sw, sh), g = c.getContext("2d"), m = x.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sw, sh); g.setTransform(m.a / f, m.b / f, m.c / f, m.d / f, m.e / f, m.f / f);
    layer(g, f, gs, d, bright, k0);
    inPixels(x, () => { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "low"; x.drawImage(c, 0, 0, sw, sh, 0, 0, sw * f, sh * f); });
  };
  if (p.depth > 0) {
    soft(3.2, gs0 * 0.46, dens * (0.6 + 0.6 * p.depth), (dark ? 0.32 : 0.26) * Math.min(1, p.depth * 2), 5100, "mxFar");
    soft(1.8, gs0 * 0.68, dens * (0.4 + 0.5 * p.depth), (dark ? 0.55 : 0.42) * Math.min(1, p.depth * 1.6), 5300, "mxMid");
  }
  layer(x, 1, gs0, dens * 0.72, dark ? 1 : 0.9, 5500);
  // the glow of the lit glyphs: the near columns painted again, small, laid on enlarged and added, the white-hot heads throwing the most
  if (dark) {
    const f = 6, sw = Math.ceil(cv.width / f), sh = Math.ceil(cv.height / f), c = mxCanvas("mxRainSoft", sw, sh), g = c.getContext("2d"), m = x.getTransform();
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sw, sh); g.setTransform(m.a / f, m.b / f, m.c / f, m.d / f, m.e / f, m.f / f);
    layer(g, f, gs0, dens * 0.72, 1, 5500);
    inPixels(x, () => { x.globalCompositeOperation = "lighter"; x.globalAlpha = 0.5; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "low"; x.drawImage(c, 0, 0, sw, sh, 0, 0, sw * f, sh * f); });
  }
}
/**
 * Where the rain and the city part, as boxes with how much they part there: round the title (most), the corner tag
 * and the channel graphic. Each is cut out softly (see mxCut).
 */
function mxClearings(ctx, env) {
  const T = canPaint(ctx) ? titleArea(ctx, env) : null, out = [];
  if (T) out.push({ x: T.x - 24, y: T.y - 16, w: T.w + 48, h: T.h + 32, a: 0.9 });
  for (const b of keepClear(ctx, env).slice(T ? 1 : 0)) out.push({ ...b, a: 0.7 });
  return out;
}
/**
 * Cuts each clearing (see mxClearings) out of x softly, its edge feathered `r` units: the clearings painted on a
 * canvas a sixteenth the size, softened there, and laid on enlarged (a blur of the whole would cost as much as the
 * rain itself).
 */
function mxCut(x, boxes, r) {
  if (!boxes.length || !canPaint(x)) return;
  const cv = x.canvas, f = 16, m = x.getTransform(), sw = Math.ceil(cv.width / f) + 2, sh = Math.ceil(cv.height / f) + 2, c = mxCanvas("mxCutMask", sw, sh), g = c.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, sw, sh); g.setTransform(m.a / f, m.b / f, m.c / f, m.d / f, m.e / f, m.f / f);
  g.shadowColor = "#000"; g.shadowBlur = (r * Math.hypot(m.a, m.b)) / f; g.shadowOffsetX = g.shadowOffsetY = 0;
  for (const b of boxes) { g.fillStyle = `rgba(0,0,0,${b.a})`; g.fillRect(b.x + r * 0.4, b.y + r * 0.4, b.w - r * 0.8, b.h - r * 0.8); }
  const xs = boxes.flatMap((b) => [b.x - r * 2, b.x + b.w + r * 2]).map((v) => (m.a * v + m.e) / f), ys = boxes.flatMap((b) => [b.y - r * 2, b.y + b.h + r * 2]).map((v) => (m.d * v + m.f) / f);
  const i0 = Math.max(0, Math.floor(Math.min(...xs))), j0 = Math.max(0, Math.floor(Math.min(...ys))), i1 = Math.min(sw, Math.ceil(Math.max(...xs))), j1 = Math.min(sh, Math.ceil(Math.max(...ys)));
  if (i1 > i0 && j1 > j0) inPixels(x, () => { x.globalCompositeOperation = "destination-out"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "low"; x.drawImage(c, i0, j0, i1 - i0, j1 - j0, i0 * f, j0 * f, (i1 - i0) * f, (j1 - j0) * f); });   // only where they are
}

// ---------------------------------------------------------------- the wireframe city
/**
 * A city in wireframe on a grid floor, seen down an avenue: the floor's lines running to the vanishing point
 * (vx, hz) and across it closer and closer toward the horizon, then blocks of towers on both sides of the
 * avenue and a far skyline across it, far ones first, each face filled with the glass (it hides what is behind)
 * and drawn in lines of light — edges, mullions, floors — dimmer with distance. `amt`: how much of it (the
 * floor's reach, the towers' number and height).
 */
function mxCity(x, F, vx, hz, amt, R, k0) {
  const fw = F.x1 - F.x0, G = (F.y1 - hz) * 1.25, line = dark ? R.phos : R.ink, glass = dark ? R.void : R.paper;
  const X = (wx, z) => vx + (wx * G) / z, Y = (wy, z) => hz + ((1 - wy) * G) / z;   // the eye one unit above the floor
  const a = Math.min(1, amt * 2.2), fade = (z) => clamp(1.15 - z / 46) * a;
  x.save(); x.lineCap = "butt"; x.lineJoin = "miter";
  // the floor: lines along the avenue, lines across it
  x.lineWidth = 1.3; x.beginPath();
  for (let i = -24; i <= 24; i++) { x.moveTo(X(i * 1.6, 1.05), Y(0, 1.05)); x.lineTo(X(i * 1.6, 26), Y(0, 26)); }
  x.strokeStyle = css(line, 0.4 * a); x.stroke();
  for (let z = 1.1; z < 60; z *= 1.16) { x.strokeStyle = css(line, 0.55 * fade(z) * clamp(((G * 0.14) / z - 3) / 9)); x.beginPath(); x.moveTo(F.x0 - 40, Y(0, z)); x.lineTo(F.x1 + 40, Y(0, z)); x.stroke(); }   // fading out as they crowd toward the horizon
  x.restore();
  // the towers, far first: a far skyline across the avenue, then rows down both its sides
  const blocks = [];
  for (let i = 0, n = Math.round(8 + 18 * amt); i < n; i++) { const z = 34 + rand(k0 + i * 2.3) * 22, wx = (rand(k0 + i * 3.1) - 0.5) * z * (fw / G) * 1.3, bw = 1.2 + rand(k0 + i * 4.7) * 3; blocks.push({ x0: wx - bw / 2, x1: wx + bw / 2, z0: z, z1: z + bw, hgt: (4 + rand(k0 + i * 5.3) ** 2 * 22) * (0.4 + 0.6 * amt) }); }
  const top = F.y0 + (F.y1 - F.y0) * 0.1, most = (z) => 1 + ((hz - top) * z) / G;   // no tower past the field's head
  for (const side of [-1, 1]) {
    let z = 4.5 + rand(k0 + side * 7.7) * 2;
    for (let i = 0; z < 40 && i < 40; i++) {
      const dep = 1.6 + rand(k0 + i * 2.9 + side * 31) * 2.8, inner = 1.3 + rand(k0 + i * 3.7 + side * 29) * 1.2, bw = 1.6 + rand(k0 + i * 4.1 + side * 37) * 2.6, tall = rand(k0 + i * 6.1 + side * 41);
      if (rand(k0 + i * 1.3 + side * 43) < 0.3 + 0.5 * amt) blocks.push({ x0: side < 0 ? -inner - bw : inner, x1: side < 0 ? -inner : inner + bw, z0: z, z1: z + dep, hgt: Math.min(most(z), (2 + tall ** 1.6 * 16) * (0.35 + 0.65 * amt)), side });
      z += dep + 0.3 + rand(k0 + i * 5.9 + side * 47) * 1.4;
    }
  }
  for (const b of [...blocks]) {   // tall ones stepped back once or twice near their top
    b.hgt = Math.min(b.hgt, most(b.z0));
    let t = b;
    for (let s = 0; s < 2 && t.hgt > 5 && rand(k0 + t.z0 * 7.1 + s) < 0.55; s++) {
      const ix = (t.x1 - t.x0) * 0.18, iz = (t.z1 - t.z0) * 0.18, up = Math.min(most(t.z0 + iz), t.hgt * (1.15 + 0.3 * rand(k0 + t.z0 * 2.9 + s)));
      if (up <= t.hgt + 0.5) break;
      t = { x0: t.x0 + ix, x1: t.x1 - ix, z0: t.z0 + iz, z1: t.z1 - iz, base: t.hgt, hgt: up, side: t.side }; blocks.push(t);
    }
  }
  blocks.sort((p, q) => q.z0 - p.z0);
  for (const b of blocks) {
    const al = fade(b.z0), y0 = b.base || 0, front = [[X(b.x0, b.z0), Y(y0, b.z0)], [X(b.x1, b.z0), Y(y0, b.z0)], [X(b.x1, b.z0), Y(b.hgt, b.z0)], [X(b.x0, b.z0), Y(b.hgt, b.z0)]];
    if (al <= 0.01 || front[0][0] > F.x1 + 200 || front[1][0] < F.x0 - 200) continue;
    const sx = b.side < 0 ? b.x1 : b.side > 0 ? b.x0 : null;   // the face toward the avenue
    const sideFace = sx === null ? null : [[X(sx, b.z0), Y(y0, b.z0)], [X(sx, b.z1), Y(y0, b.z1)], [X(sx, b.z1), Y(b.hgt, b.z1)], [X(sx, b.z0), Y(b.hgt, b.z0)]];
    const roof = b.hgt < 1 ? null : [[X(b.x0, b.z0), Y(b.hgt, b.z0)], [X(b.x1, b.z0), Y(b.hgt, b.z0)], [X(b.x1, b.z1), Y(b.hgt, b.z1)], [X(b.x0, b.z1), Y(b.hgt, b.z1)]];
    const poly = (pts) => { x.beginPath(); pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); };
    for (const f of [sideFace, front]) if (f) { poly(f); x.fillStyle = css(glass); x.fill(); }
    x.lineWidth = Math.max(1, 1.8 - b.z0 / 30);
    // mullions and floors: lines across each face, fewer when it is small
    const fwPx = front[1][0] - front[0][0], fhPx = front[0][1] - front[3][1], cols = Math.max(1, Math.round(fwPx / Math.max(11, fwPx / 12))), floors = Math.max(1, Math.round(fhPx / Math.max(9, fhPx / 26)));
    x.strokeStyle = css(line, 0.22 * al); x.beginPath();
    for (let i = 1; i < cols; i++) { const t = i / cols, px = front[0][0] + fwPx * t; x.moveTo(px, front[0][1]); x.lineTo(px, front[3][1]); }
    for (let j = 1; j < floors; j++) { const py = front[0][1] - fhPx * (j / floors); x.moveTo(front[0][0], py); x.lineTo(front[1][0], py); }
    if (sideFace) for (let j = 1; j < floors; j++) { const t = j / floors; x.moveTo(sideFace[0][0], sideFace[0][1] + (sideFace[3][1] - sideFace[0][1]) * t); x.lineTo(sideFace[1][0], sideFace[1][1] + (sideFace[2][1] - sideFace[1][1]) * t); }
    x.stroke();
    x.strokeStyle = css(line, 0.85 * al);
    for (const f of [sideFace, front]) if (f) { poly(f); x.stroke(); }
    if (roof && Y(b.hgt, b.z0) > hz) { poly(roof); x.stroke(); }   // seen from above: lower than the eye
    if (b.hgt > 12 && rand(k0 + b.z0 * 3.3) < 0.5) { const mx = (front[0][0] + front[1][0]) / 2, top = front[3][1]; x.beginPath(); x.moveTo(mx, top); x.lineTo(mx, top - fhPx * 0.12); x.stroke(); x.fillStyle = css(dark ? R.hot : R.ink, al); x.fillRect(mx - 1.5, top - fhPx * 0.12 - 1.5, 3, 3); }   // a mast, a light at its tip
  }
}

// ---------------------------------------------------------------- the hologram
/**
 * Where the hologram stands, its shape `aspect` (width to height) wide: its foot on the open field's floor — or on the
 * title's head, when the title is low — at the first of a few places along it, the far side first, where at its
 * largest it keeps clear of every box of `keep` (the title, the tag, the graphic, the brand row, the logo); none clear,
 * it is made smaller and tried again, down to a third of its size; past that it stands at four fifths of its size where
 * it reaches least behind them, faint (`faint`). Found at its largest, so the slider (`amt`) only sizes it where it
 * stands, its foot kept: { size, half, cx, cy, faint, room (the box it and its emitter take at its largest, on or not) }.
 * Pure.
 */
export function mxFigurePlan(F, aspect, amt, keep, T = null) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, m = Math.min(fw, fh) * 0.04, a = Math.max(0.25, aspect), wide = (fw * 0.62) / a, top = Math.min(fh * 0.92, wide), floors = [F.y1 - m];
  if (T && T.y + T.h > F.y0 + fh * 0.6) floors.push(T.y - 28);   // a title low in the field: on its head too
  const area = (b) => keep.reduce((t, q) => t + Math.max(0, Math.min(q.x + q.w, b.x + b.w) - Math.max(q.x, b.x)) * Math.max(0, Math.min(q.y + q.h, b.y + b.h) - Math.max(q.y, b.y)), 0);
  const at = (s, foot, t) => { const size = top * s, half = (size * a) / 2, cx = clamp(F.x0 + fw * t, F.x0 + m + half, F.x1 - m - half); return { s, foot, cx, size, half, box: { x: cx - half * 0.86, y: foot - size * 0.94, w: half * 1.72, h: size * 0.88 } }; };
  const TS = [0.78, 0.9, 0.64, 0.5, 0.36, 0.22, 0.1];
  let got = null, faint = false;
  seek: for (const s of [1, 0.86, 0.74, 0.63, 0.53, 0.44, 0.36]) for (const foot of floors) for (const t of TS) {
    const q = at(s, foot, t);
    if (foot - q.size >= F.y0 + m * 0.5 && !keep.some((k) => overlaps(k, q.box))) { got = q; break seek; }
  }
  if (!got) {   // no room: behind the words where it reaches least, faint
    faint = true;
    for (const foot of floors) for (const t of TS) { const q = at(0.8, foot, t); if (foot - q.size < F.y0 + m * 0.5) continue; q.v = area(q.box); if (!got || q.v < got.v) got = q; }
  }
  const size = Math.min(fh * (0.5 + 0.42 * amt), wide) * got.s, half = (size * a) / 2;
  return { size, half, cx: got.cx, cy: got.foot - size / 2, faint, room: { x: got.cx - got.half * 1.2, y: got.foot - got.size, w: got.half * 2.4, h: got.size * 1.12 } };
}
/**
 * The channel graphic projected as a hologram: its shape read in rows (shapeCells) and drawn as scanlines of light,
 * brighter along its edges and toward the light, a few rows slipped sideways, the emitter's ring of light under it
 * and a faint cone rising from it; a glow round it all. In inverse video, dark lines and no glow.
 */
function mxHologram(ctx, S, g, cx, cy, size, a, R, k0) {
  const b = S.box, aspect = (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0), half = (size * aspect) / 2, cell = Math.max(2.4, size * 0.0085);
  const x0 = cx - half - cell * 2, y0 = cy - size / 2 - cell * 2, cols = Math.ceil((half * 2) / cell) + 4, rows = Math.ceil(size / cell) + 4, cov = shapeCells(S, cx, cy, size, x0, y0, cols, rows, cell);
  const line = dark ? R.phos : R.ink, foot = cy + size / 2, relief = mxRelief(cov, cols, rows), own = mxDrawnCells(g, S, size, cell, cols, rows);
  // each cell's light: the relief's, and the graphic's own lightness, so its drawing (a lens, a face's features) shows in the lines
  const shade = own ? relief.map((v, q) => (v < 0 ? v : clamp(v * 0.45 + own[q] * 0.75 - 0.08))) : relief;
  const P = canPaint(ctx) ? mxFigCanvas(ctx, cx - half * 1.3 - 24, cy - size * 0.64, cx + half * 1.3 + 24, foot + half * 0.3 + 24) : null, x = P ? P.x : ctx;
  if (P && !P.x) return;   // all of it off the canvas
  // the emitter: a ring of light at the foot, a cone rising faint from it
  const er = half * 0.9, cone = x.createLinearGradient(0, foot, 0, foot - size * 0.9);
  cone.addColorStop(0, css(line, 0.16 * a)); cone.addColorStop(1, css(line, 0));
  x.fillStyle = cone; x.beginPath(); x.moveTo(cx - er, foot); x.lineTo(cx - half * 1.05, foot - size * 0.9); x.lineTo(cx + half * 1.05, foot - size * 0.9); x.lineTo(cx + er, foot); x.closePath(); x.fill();
  x.lineWidth = 2; x.strokeStyle = css(line, 0.8 * a); x.beginPath(); x.ellipse(cx, foot, er, er * 0.16, 0, 0, TAU); x.stroke();
  x.lineWidth = 1; x.strokeStyle = css(line, 0.45 * a); x.beginPath(); x.ellipse(cx, foot, er * 1.18, er * 0.2, 0, 0, TAU); x.stroke();
  // slipped bands of rows
  const slips = [];
  for (let i = 0; i < 4; i++) { const j0 = Math.floor(rand(k0 + i * 3.7) * rows), n = 1 + Math.floor(rand(k0 + i * 4.3) * rows * 0.05); slips.push([j0, j0 + n, (rand(k0 + i * 5.1) - 0.5) * half * 0.22]); }
  const levels = [[], [], [], [], [], []];
  for (let j = 0; j < rows; j += 2) {   // every other row: scanlines, broken here and there
    const dx = (slips.find(([s, e]) => j >= s && j < e) || [0, 0, 0])[2], wob = Math.sin(j * 0.37 + k0) * cell * 0.25;
    for (let i = 0; i < cols; i++) {
      const v = shade[j * cols + i];
      if (v < 0 || rand(k0 + i * 0.731 + j * 1.37) < 0.05) continue;
      levels[Math.min(5, Math.floor(v * 5.99))].push(x0 + i * cell + dx + wob, y0 + j * cell);
    }
  }
  levels.forEach((list, q) => {
    if (!list.length) return;
    x.fillStyle = css(q >= 4 && dark ? (q === 5 ? R.white : R.hot) : line, (0.22 + 0.156 * q) * a); x.beginPath();
    for (let n = 0; n < list.length; n += 2) x.rect(list[n], list[n + 1], cell * 1.01, cell * 0.7);
    x.fill();
  });
  if (!P) return;
  if (dark && !fast) { const cv = x.canvas, s = softCopy(cv, 9, "mxFigSoft"); inPixels(x, () => { x.globalCompositeOperation = "lighter"; x.globalAlpha = 0.55; x.imageSmoothingEnabled = true; x.drawImage(s, 0, 0, cv.width, cv.height); }); }
  inPixels(ctx, () => { ctx.globalCompositeOperation = dark ? "lighter" : "source-over"; ctx.drawImage(x.canvas, P.px, P.py); });
}
/**
 * The light on a shape read in cells (coverage 0–255 a cell, cols × rows) taken for a relief: its coverage blurred
 * into a height, round in the middle and falling to its edge, lit from the upper left, its rim lit as a hologram's
 * edges are. 0–1 a cell, -1 where the shape is not. Pure.
 */
export function mxRelief(cov, cols, rows) {
  const n = cols * rows, hgt = new Float32Array(n), tmp = new Float32Array(n), out = new Float32Array(n), r = Math.max(2, Math.round(Math.min(cols, rows) * 0.04));
  for (let q = 0; q < n; q++) hgt[q] = cov[q] / 255;
  for (let pass = 0; pass < 2; pass++) {   // a box blur, along the rows and then down the columns, twice
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { let s = 0; for (let d = -r; d <= r; d++) s += hgt[j * cols + Math.min(cols - 1, Math.max(0, i + d))]; tmp[j * cols + i] = s / (2 * r + 1); }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { let s = 0; for (let d = -r; d <= r; d++) s += tmp[Math.min(rows - 1, Math.max(0, j + d)) * cols + i]; hgt[j * cols + i] = s / (2 * r + 1); }
  }
  const L = [-0.5, -0.62, 0.6], ln = Math.hypot(...L), k = r * 2.2;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = j * cols + i;
    if (cov[q] < 90) { out[q] = -1; continue; }
    const gx = (hgt[q + (i < cols - 1 ? 1 : 0)] - hgt[q - (i > 0 ? 1 : 0)]) * k, gy = (hgt[q + (j < rows - 1 ? cols : 0)] - hgt[q - (j > 0 ? cols : 0)]) * k;
    const lit = Math.max(0, (gx * L[0] * -1 + gy * L[1] * -1 + L[2]) / (Math.hypot(gx, gy, 1) * ln)), rim = clamp((0.78 - hgt[q]) * 2.2);
    out[q] = clamp(0.1 + 0.72 * lit + 0.5 * rim);
  }
  return out;
}
/**
 * The graphic `g` itself (its own colours, its lines), placed as the hologram's shape S is at `size`, read over the
 * hologram's cells (`cell` units, cols × rows, the shape's box two cells in from the grid's corner): its lightness a
 * cell, 0–1. Kept for the last few graphics and sizes; null while the graphic is not ready.
 */
function mxDrawnCells(g, S, size, cell, cols, rows) {
  if (!g || typeof document === "undefined") return null;
  const kept = WORK.mxCells || (WORK.mxCells = new Map()), key = `${JSON.stringify(g.ref)}|${cols}|${rows}|${cell.toFixed(3)}|${size.toFixed(2)}`;
  if (kept.has(key)) return kept.get(key);
  const f = 3, c = mxCanvas("mxCellsCv", cols * f, rows * f), x = c.getContext("2d", { willReadFrequently: true }), b = S.box, k = size / Math.max(1, b.y1 - b.y0);
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
  x.setTransform((f * k) / cell, 0, 0, (f * k) / cell, ((cell * 2 - b.x0 * k) * f) / cell, ((cell * 2 - b.y0 * k) * f) / cell);   // the shape's box two cells in from the grid's corner, as placeShape puts it
  if (!g.draw(x)) return null;
  const d = x.getImageData(0, 0, c.width, c.height).data, out = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    let s = 0, n = 0;
    for (let v = 0; v < f; v++) for (let u = 0; u < f; u++) { const q = ((j * f + v) * c.width + i * f + u) * 4, al = d[q + 3] / 255; s += lumOf(d, q) * al; n += al; }
    out[j * cols + i] = n > 0.5 ? s / n : 0;
  }
  kept.set(key, out); if (kept.size > 6) kept.delete(kept.keys().next().value);
  return out;
}
/**
 * A work canvas for the hologram covering only the box x0–x1, y0–y1 (units) of ctx's canvas, cleared, drawing with
 * ctx's transform moved to it: { x, px, py } (its corner on ctx's canvas, in pixels), x null when the box is off it.
 */
function mxFigCanvas(ctx, x0, y0, x1, y1) {
  const m = ctx.getTransform(), cv = ctx.canvas, xs = [x0, x1].map((v) => m.a * v + m.e), ys = [y0, y1].map((v) => m.d * v + m.f);
  const px = Math.max(0, Math.floor(Math.min(...xs))), py = Math.max(0, Math.floor(Math.min(...ys))), pw = Math.min(cv.width, Math.ceil(Math.max(...xs))) - px, ph = Math.min(cv.height, Math.ceil(Math.max(...ys))) - py;
  if (pw < 2 || ph < 2) return { x: null, px, py };
  const c = mxCanvas("mxFig", pw, ph), x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, pw, ph); x.setTransform(m.a, m.b, m.c, m.d, m.e - px, m.f - py);
  return { x, px, py };
}

// ---------------------------------------------------------------- terminal windows
/** The words a terminal is lettered with: the channel's code (upper case, no spaces), its name, the brand as a host. */
function mxWords(env) {
  const cat = env.cat || {}, code = String(cat.code || cat.name || "SYS").toUpperCase().replace(/\s+/g, "_").slice(0, 12) || "SYS";
  const P = env.o && env.o.profile, brand = String((P && P.brand && P.brand.name) || "node").toLowerCase().replace(/\s+/g, "-").slice(0, 16) || "node";
  return { code, low: code.toLowerCase(), name: String(cat.name || code).slice(0, 18), brand, n: env.o ? env.o.catIndex || 0 : 0 };
}
const hex = (k, d) => Math.floor(rand(k) * 16 ** d).toString(16).toUpperCase().padStart(d, "0");
/** The lines of a terminal window of kind `kind`: [text, how: "" | "alert" | "cursor" | "bar:f" (a progress bar, f done) | "dim"]. */
export function mxLines(kind, W, k) {
  const ip = `10.${Math.floor(rand(k) * 250)}.${Math.floor(rand(k + 1) * 250)}.${Math.floor(rand(k + 2) * 250)}`;
  if (kind === 0) return [[`$ ssh root@${W.brand}.net`, ""], [`connecting to ${ip} ... ok`, "dim"], [`> mount /dev/${W.low}`, ""], [`[ OK ] channel ${W.code} online`, ""], [`[ OK ] ${Math.floor(1 + rand(k + 3) * 40)} streams decrypted`, "dim"], [`!! TRACE DETECTED  ${hex(k + 4, 4)}`, "alert"], [`root@${W.low}:~# `, "cursor"]];
  if (kind === 1) {
    const src = [...`${W.code}.${W.brand}`.padEnd(48, ".")].map((c) => c.charCodeAt(0) & 255), out = [[`DUMP /dev/${W.low}`, "dim"]], base = Math.floor(rand(k + 9) * 0xfff0) * 16;
    for (let r = 0; r < 6; r++) { const b = src.slice(r * 8, r * 8 + 8); out.push([`${(base + r * 8).toString(16).toUpperCase().padStart(8, "0")}  ${b.map((v, i) => (rand(k + r * 8 + i) < 0.35 ? hex(k + r * 9 + i * 1.3, 2) : v.toString(16).toUpperCase().padStart(2, "0"))).join(" ")}  ${b.map((v) => (v > 32 && v < 127 ? String.fromCharCode(v) : ".")).join("")}`, ""]); }
    return out;
  }
  if (kind === 2) { const f = 0.35 + 0.55 * rand(k + 5); return [[`DECRYPTING ${W.name}`, ""], [`${Math.round(f * 100)}%`, `bar:${f}`], [`key  ${hex(k + 6, 8)}-${hex(k + 7, 8)}`, "dim"], [`node ${ip}`, "dim"], [`eta  00:${pad2(Math.floor(rand(k + 8) * 60))}:${pad2(Math.floor(rand(k + 9) * 60))}`, ""], [`> wake up, ${W.low}`, "cursor"]]; }
  return [["PID   USER   %CPU  COMMAND", "dim"], ...[0, 1, 2, 3].map((i) => [`${String(100 + Math.floor(rand(k + i) * 8900)).padEnd(5)} ${(i ? "root" : W.low.slice(0, 5)).padEnd(6)} ${(rand(k + i + 4) * 99).toFixed(1).padStart(4)}  ${["rain.d", `${W.low}.sys`, "trace", "sshd"][i]}`, i === 2 ? "alert" : ""]), ["load 0.98 0.42 0.17", "dim"]];
}
const MX_TITLES = (W) => [`tty1 — ${W.low}`, `/dev/${W.low}`, "DECRYPT.EXE", "ps — 80×24"];
/**
 * A terminal window at (x, y), ww × wh: the glass (or, in inverse video, the lit screen) inside a thin rule, a
 * title bar in inverse (its words cut out of the bar, three boxes for its controls), then its lines in the
 * monospaced face; a progress bar of blocks, a cursor block, an alert line in the alert colour.
 */
function mxWindow(ctx, x, y, ww, wh, kind, W, R, alert, a, k) {
  const ink = mxInk(R), glass = dark ? R.void : R.paper, bar = Math.max(14, ww * 0.052), fs = Math.max(9, ww * 0.036), lh = fs * 1.42;
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(glass, dark ? 0.93 : 1); ctx.fillRect(x, y, ww, wh);
  if (dark && !fast) { ctx.save(); ctx.shadowColor = css(R.phos, 0.5); ctx.shadowBlur = 14 * Math.hypot(ctx.getTransform().a, ctx.getTransform().b); ctx.strokeStyle = css(ink, 0.9); ctx.lineWidth = 1.6; ctx.strokeRect(x, y, ww, wh); ctx.restore(); }
  ctx.strokeStyle = css(ink, 0.9); ctx.lineWidth = 1.6; ctx.strokeRect(x, y, ww, wh);
  ctx.fillStyle = css(ink); ctx.fillRect(x, y, ww, bar);
  ctx.font = `700 ${bar * 0.6}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillStyle = css(glass);
  ctx.fillText(MX_TITLES(W)[kind % 4], x + bar * 0.45, y + bar * 0.54);
  ctx.strokeStyle = css(glass); ctx.lineWidth = 1.4;
  for (let i = 0; i < 3; i++) ctx.strokeRect(x + ww - bar * (0.95 + i * 0.9), y + bar * 0.25, bar * 0.5, bar * 0.5);
  ctx.save(); ctx.beginPath(); ctx.rect(x + 2, y + bar, ww - 4, wh - bar - 2); ctx.clip();
  ctx.font = `500 ${fs}px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic";
  let ty = y + bar + lh * 1.05;
  for (const [t, how] of mxLines(kind, W, k)) {
    if (ty > y + wh - fs * 0.3) break;
    const tx = x + fs * 0.9;
    ctx.fillStyle = how === "alert" ? css(alert) : css(ink, how === "dim" ? 0.6 : 1);
    if (how.startsWith("bar:")) {   // a bar of blocks, filled so far
      const f = parseFloat(how.slice(4)), bw = ww - fs * 6.5, n = Math.max(4, Math.floor(bw / (fs * 0.62)));
      ctx.strokeStyle = css(ink, 0.8); ctx.lineWidth = 1; ctx.strokeRect(tx, ty - fs * 0.85, bw, fs * 1.05);
      for (let i = 0; i < Math.round(n * f); i++) ctx.fillRect(tx + 2 + i * (bw - 4) / n, ty - fs * 0.85 + 2, (bw - 4) / n - 1.5, fs * 1.05 - 4);
      ctx.fillText(t, tx + bw + fs * 0.5, ty);
    } else {
      ctx.fillText(t, tx, ty);
      if (how === "cursor") ctx.fillRect(tx + ctx.measureText(t).width + fs * 0.1, ty - fs * 0.82, fs * 0.6, fs * 1.02);
    }
    ty += lh;
  }
  ctx.restore();
  ctx.restore();
}
/**
 * Where the windows go: four, each with its place whatever the slider (Terminal windows brings them in one by one: the
 * first `n` are returned), each tried at a few places in the open field — its corners first — and set at the first
 * clear of `keep` (the title, the tag, the graphic, the brand row, the logo) and of `parts` (the hologram's room) and of
 * the windows set before, smaller where it would not go; else, of all those, where it reaches least behind `keep`,
 * then least over the rest (over another, it still shows). None left out. Pure: [{x, y, w, h, kind, i}].
 */
export function mxWindowPlan(F, u, n, keep, parts = [], k0 = 6100) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, m = Math.min(fw, fh) * 0.04, out = [], spots = [[1, 0.04], [1, 0.96], [0.02, 0.96], [0.55, 0.97], [0.78, 0.5], [0.04, 0.05], [0.45, 0.04], [0.2, 0.55]];
  const used = new Set(), over = (L, b) => { const t = L.reduce((t, q) => t + Math.max(0, Math.min(q.x + q.w, b.x + b.w) - Math.max(q.x, b.x)) * Math.max(0, Math.min(q.y + q.h, b.y + b.h) - Math.max(q.y, b.y)), 0); return t < 0.5 ? 0 : t; };   // how much of b they cover (a touch is not an overlap)
  for (let i = 0; i < Math.max(4, Math.ceil(n)); i++) {
    const w0 = u * (0.3 + 0.1 * rand(k0 + i * 2.3)), tall = 0.5 + 0.16 * rand(k0 + i * 3.1), near = [...parts, ...out.map((q) => ({ x: q.x - 12, y: q.y - 12, w: q.w + 24, h: q.h + 24 }))];
    let best = null;
    for (const s0 of [1, 0.82, 0.68]) {   // smaller where it would not go
      const ww = Math.min(fw - 2 * m, w0 * s0), wh = Math.min(fh - 2 * m, ww * tall);
      for (let s = 0; s < spots.length; s++) {
        if (used.has(s)) continue;
        const [ax, ay] = spots[s], b = { x: F.x0 + m + (fw - 2 * m - ww) * ax, y: F.y0 + m + (fh - 2 * m - wh) * ay, w: ww, h: wh }, v = over(keep, b), o = over(near, b);
        if (!best || v < best.v || (v === best.v && o < best.o)) best = { b, s, v, o };
        if (!v && !o) break;
      }
      if (!best.v && !best.o) break;
    }
    used.add(best.s); out.push({ ...best.b, kind: (i + Math.floor(rand(k0 + 9) * 4)) % 4, i });
  }
  return out.slice(0, Math.ceil(n));
}

// ---------------------------------------------------------------- the photo
/**
 * RGBA pixels into the phosphor, mixed in by a: the lightness, its middle tones opened a little, mapped onto the
 * ramp from the glass to white-green (R: mxRamp's). Alpha kept. Pure.
 */
export function mxPixels(d, a, R) {
  const lut = toneTable([[0, R.void], [0.2, R.deep], [0.46, R.dim], [0.66, R.mid], [0.87, R.phos], [1, R.hot]]), b = 1 - a;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const t = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8, j = Math.round(t * 0.55 + (t * t * (765 - 2 * t)) / 65025 * 0.45) * 3;   // half the way to a smoothstep
    d[i] = d[i] * b + lut[j] * a; d[i + 1] = d[i + 1] * b + lut[j + 1] * a; d[i + 2] = d[i + 2] * b + lut[j + 2] * a;
  }
}
/** Bands of rows of RGBA pixels (w × h) slid sideways, `n` of them, placed by the seed (k0): the photo's torn signal. Pure. */
export function mxSlide(d, w, h, n, k0) {
  const row = new Uint8ClampedArray(w * 4);
  for (let i = 0; i < n; i++) {
    const y0 = Math.floor(rand(k0 + i * 2.7) * h), bh = Math.max(1, Math.round(h * (0.004 + rand(k0 + i * 3.3) * 0.03))), dx = Math.round((rand(k0 + i * 4.1) - 0.5) * w * 0.09);
    for (let y = y0; y < Math.min(h, y0 + bh); y++) {
      const o = y * w * 4; row.set(d.subarray(o, o + w * 4));
      for (let xx = 0; xx < w; xx++) { const s = clamp(xx - dx, 0, w - 1) * 4, q = o + xx * 4; d[q] = row[s]; d[q + 1] = row[s + 1]; d[q + 2] = row[s + 2]; d[q + 3] = row[s + 3]; }
    }
  }
}
const ASCII_RAMP = " .:-=+*#%@";
/**
 * The picture (RGBA pixels, w × h, already in the phosphor) rebuilt as ASCII: cells of one character, darker to
 * lighter through " .:-=+*#%@", each in its cell's own colour, on the glass; mixed in by a.
 */
function mxAscii(d, w, h, a, R) {
  if (a <= 0 || typeof document === "undefined") return;
  const cs = Math.max(5, Math.round(Math.max(w, h) / 150)), cols = Math.ceil(w / cs), rows = Math.ceil(h / cs), src = mxCanvas("mxAsciiSrc", w, h), sg = src.getContext("2d");
  sg.putImageData(new ImageData(d, w, h), 0, 0);
  const small = mxCanvas("mxAsciiCells", cols, rows), mg = small.getContext("2d", { willReadFrequently: true });
  mg.imageSmoothingEnabled = true; mg.imageSmoothingQuality = "high"; mg.globalCompositeOperation = "copy"; mg.drawImage(src, 0, 0, cols * cs, rows * cs, 0, 0, cols, rows);
  const px = mg.getImageData(0, 0, cols, rows).data, out = mxCanvas("mxAsciiOut", w, h), g = out.getContext("2d", { willReadFrequently: true });
  g.globalCompositeOperation = "source-over"; g.fillStyle = css(R.void); g.fillRect(0, 0, w, h);
  g.font = `700 ${cs * 1.18}px ${fonts.mono}`; g.textAlign = "center"; g.textBaseline = "middle";
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const q = (j * cols + i) * 4, l = lumOf(px, q), ch = ASCII_RAMP[Math.min(ASCII_RAMP.length - 1, Math.floor(l * 1.15 * ASCII_RAMP.length))];
    if (ch === " ") continue;
    g.fillStyle = `rgb(${Math.min(255, px[q] * 1.5)},${Math.min(255, px[q + 1] * 1.5)},${Math.min(255, px[q + 2] * 1.5)})`; g.fillText(ch, (i + 0.5) * cs, (j + 0.5) * cs);
  }
  const o = g.getImageData(0, 0, w, h).data, b = 1 - a;
  for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * b + o[i] * a; d[i + 1] = d[i + 1] * b + o[i + 1] * a; d[i + 2] = d[i + 2] * b + o[i + 2] * a; }
}

/**
 * The context the small cover parts draw on (the brand row, the channel name): the house's ink, which letters what
 * sits on the colour block — the dark panel, on either ground — turned to the phosphor; but ink on a chip of colour
 * (the channel's code in the brand row, a plate) stays dark, as it reads there. The field's own text colours are the
 * theme's already.
 */
function mxSmall(ctx, R) {
  let chip = false;
  const swap = (v) => { const c = parseColour(v); return c && role(c) === "ink" ? css(chip ? R.void : R.phos, c[3]) : v; };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "fillRect" || k === "fill") return (...a) => { const c = parseColour(t.fillStyle); chip = !!c && role(c) === "colour"; t[k](...a); };
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) { if (k === "fillStyle" || k === "strokeStyle") t[k] = swap(v); else t[k] = v; return true; },
  });
}
/** The boxes the hologram and the windows keep clear of where they can: the title with its subtitle, the tag and the graphic (keepClear), the brand row and its rail (mxBrandBoxes), the logo. */
function mxKeep(ctx, env) {
  const out = canPaint(ctx) ? [...keepClear(ctx, env), ...mxBrandBoxes(ctx, env)] : [];
  if (env.logo) out.push({ x: env.logo.x - 24, y: 0, w: env.w - env.logo.x + 24, h: env.logo.y + env.logo.h + 24 });
  return out;
}
/**
 * The hologram's shape and where it goes (see mxFigurePlan), clear of the words, the tag, the graphic, the brand row and
 * the logo: { S, at }, or null without a shape. Planned whether Hologram is on or not: what it would take (`at.room`)
 * the windows and the status line keep clear of either way, so turning it on or up moves neither.
 */
function mxFigureOf(ctx, env, p) {
  const S = canPaint(ctx) && graphicShape(env);
  if (!S) return null;
  const b = S.box;
  return { S, at: mxFigurePlan(mxRoom(env), (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0), p.figure, mxKeep(ctx, env), titleArea(ctx, env)) };
}
/** Where the brand row lies (see drawHeader in render.js), with a margin, when it shows: the brand's name, the channel's code on its chip, the count; and the channels' rail at its right end. [] without one. */
function mxBrandBoxes(ctx, env) {
  const P = env.o && env.o.profile;
  if (!env.hasBrand || !P || !P.brand || typeof ctx.measureText !== "function") return [];
  ctx.save();
  ctx.font = `700 50px ${fonts.en}, ${fonts.cn}`; let bw = P.brand.name ? spacedW(ctx, P.brand.name, 3) + 28 : 0;
  ctx.font = `700 23px ${fonts.mono}, ${fonts.cn}`; if (env.cat && env.cat.code) bw += ctx.measureText(env.cat.code).width + 44;
  ctx.restore();
  const out = [{ x: 40, y: 36, w: bw + 80 + (P.brand.counter ? 200 : 0), h: 110 }], n = (P.categories || []).length;
  if (n > 1) { const right = env.logo ? env.logo.x - 36 : env.w - 72, rw = n * Math.min(58, Math.max(18, 420 / n)); out.push({ x: right - rw - 20, y: 60, w: rw + 40, h: 60 }); }   // the channels' colour rail at its right end
  return out;
}
/** The part of the open field (see openField) clear of the colour block however its edge slants: where the look's furniture may stand. */
function mxRoom(env) {
  const F = openField(env), E = env.G && env.G.edge;
  if (!E) return F;
  const [ax, ay, bx, by] = E.line;
  return F.side === "right" ? { ...F, x1: Math.min(ax, bx) } : F.side === "left" ? { ...F, x0: Math.max(ax, bx) } : F.side === "below" ? { ...F, y1: Math.min(ay, by) } : F.side === "above" ? { ...F, y0: Math.max(ay, by) } : F;
}

// ---------------------------------------------------------------- keeping and letting go
const MX_SLOTS = ["mxFar", "mxMid", "mxCellsCv", "mxCutMask", "mxRainSoft", "mxRainSoftm", "mxFig", "mxFigSoft", "mxFigSoftm", "mxCityGlow", "mxCityGlowm", "mxAsciiSrc", "mxAsciiCells", "mxAsciiOut", "mxTear", "mxBloom", "mxBloomm", "mxRainKeptBig", "mxCityKeptBig"];
/** Lets go all the look keeps: its kept layers (rain, city), its glyph atlases, its work canvases, its scanline tiles. */
export function mxFreeAll() {
  for (const k of ["mxRainKept", "mxCityKept"]) { const m = WORK[k]; if (m) { for (const e of m.values()) e.c.width = e.c.height = 0; delete WORK[k]; } }
  if (WORK.mxAtlas) { for (const A of WORK.mxAtlas.values()) A.c.width = A.c.height = 0; delete WORK.mxAtlas; }
  if (WORK.mxSprites) { for (const S of WORK.mxSprites.values()) for (const c of S.all) c.width = c.height = 0; delete WORK.mxSprites; }
  delete WORK.mxCells;
  for (const k of [...MX_SLOTS, ...Object.keys(WORK).filter((s) => s.startsWith("mxScan|"))]) if (WORK[k]) { WORK[k].width = WORK[k].height = 0; delete WORK[k]; }
}
/** What the look keeps, in pixels (for the checks): kept layers, atlases, work canvases. */
export function mxMemory() {
  const px = (c) => (c ? c.width * c.height : 0);
  let n = 0;
  for (const k of ["mxRainKept", "mxCityKept"]) if (WORK[k]) for (const e of WORK[k].values()) n += px(e.c);
  if (WORK.mxAtlas) for (const A of WORK.mxAtlas.values()) n += px(A.c);
  if (WORK.mxSprites) for (const S of WORK.mxSprites.values()) for (const c of S.all) n += px(c);
  for (const k of [...MX_SLOTS, ...Object.keys(WORK).filter((s) => s.startsWith("mxScan|"))]) n += px(WORK[k]);
  return n;
}
/** A kept layer (see keptLayer), or, past its size (an export), painted on a work canvas of the look's own. */
function mxLayer(ctx, slot, key, paint) {
  const kept = keptLayer(ctx, slot, key, paint);
  if (kept) return kept;
  const cv = ctx.canvas, c = mxCanvas(slot + "Big", cv.width, cv.height), x = c.getContext("2d");
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, c.width, c.height); x.setTransform(ctx.getTransform());
  paint(x);
  return c;
}
/** Lets the export's work canvases go (see mxLayer). */
function mxLetGoBig() { for (const k of ["mxRainKeptBig", "mxCityKeptBig"]) if (WORK[k]) { WORK[k].width = WORK[k].height = 0; delete WORK[k]; } }
/** A scanline tile: `px` rows tall, the last third dark. */
function mxScanTile(px, colour) {
  const key = `mxScan|${px}|${colour.join()}`;
  let t = WORK[key];
  if (!t) { t = WORK[key] = document.createElement("canvas"); t.width = 4; t.height = px; const g = t.getContext("2d"); g.fillStyle = css(colour); g.fillRect(0, Math.round(px * 0.55), 4, Math.max(1, Math.round(px * 0.45))); }
  return t;
}

export const matrix = {
  id: "matrix",
  art: "figure",
  repaint: (c) => `the photograph as seen on an old green phosphor terminal: the whole picture in one glowing green from near-black bottle green to white-green highlights, CRT scanlines, a soft bloom on the brights, a few horizontal signal-tear slices, columns of falling green code (katakana and digits) over its shadows; dark, digital, cinematic; still the same picture, no readable text.`,
  about: {
    zh: "荧绿终端：老式终端荧光屏和电影里的“数码雨”——黑底上一列列下落的字符（镜像的半角片假名、数字和少量符号），每列有一个白热的头和渐暗的尾巴，远处的列更小、更暗、更虚，形成纵深；可加几扇终端窗口（细细的绿线框、反白的标题栏、十六进制转储、进度条、闪烁的光标块，文字取自频道名和品牌），频道图形化成一层绿色扫描线的全息投影，还有透视网格地面上的线框城市；显像管的扫描线、荧光辉光、弯曲屏幕的暗角和偶尔撕裂的横向信号带。只有一种绿色，从墨绿到荧光绿再到白绿；告警行用频道色。标题是等宽字，发出绿光，强调词像被选中一样反白在绿色块里。浅色是同一块屏幕的反色显示：深色代码印在亮起的荧光绿上。照片会变成荧光绿单色，代码雨落在它的暗部，也可以变成字符画。冷、神秘、技术感——适合科技、编程、安全、AI、科幻、游戏和数据类内容。自带平直的版式。",
    en: "Phosphor terminal: the green screen of an old terminal and the films' digital rain — columns of glyphs (mirrored half-width katakana, digits, a few signs) falling on black, each with a white-hot head and a tail fading into the dark, the far columns smaller, dimmer and soft, so the rain has depth; terminal windows if you like (thin green rules, title bars in inverse, hex dumps, progress bars, a blinking cursor block, lettered from the channel's name and the brand), the channel graphic projected as a hologram of green scanlines, a wireframe city on a perspective grid; the tube's scanlines, its phosphor glow, the dark corners of a curved screen and a torn band of signal now and then. One green only, from bottle green through the phosphor to white-green; an alert line in the channel colour. The title is set monospaced and glows; highlighted words are selected, cut out of a block of green. The light ground is the same screen in inverse video, the code dark on lit phosphor. A photo turns to green phosphor with the rain falling over its shadows, or into ASCII. Cool, mysterious, technical — for tech, code, security, AI, science fiction, games and data. Flat layouts of its own.",
  },
  name: { zh: "荧绿终端", en: "Phosphor terminal" },
  seeded: true,
  scene: { figure: { zh: "全息投影", en: "Hologram" }, windows: { zh: "终端窗口", en: "Terminal windows" }, city: { zh: "城市消失点", en: "The city's vanishing point" } },
  params: [
    { key: "rain", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "数码雨", en: "Digital rain" } },
    { key: "size", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "字符大小", en: "Glyph size" } },
    { key: "depth", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "纵深", en: "Depth" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "全息投影", en: "Hologram" } },
    { key: "windows", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "终端窗口", en: "Terminal windows" } },
    { key: "city", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "线框城市", en: "Wireframe city" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "荧光辉光", en: "Phosphor glow" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "glitch", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "信号撕裂", en: "Signal tears" } },
    { key: "curve", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "显像管暗角", en: "Curved screen" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "荧光用频道色", en: "Phosphor in the channel colour" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.9, name: { zh: "照片荧光单色", en: "Photo in phosphor" } },
    { key: "ascii", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0, name: { zh: "照片字符画", en: "Photo as ASCII" } },
  ],
  titleFont: (f) => `${f.mono}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  leave: mxFreeAll,   // the rain and the city it keeps for each size, its atlases and work canvases go as another look is chosen
  theme: (base, C, p) => { const R = rampOf(C, p), ink = mxInk(R); return { ...base, field: css(mxField(R)), text: css(ink), own: css(R.phos), dim: css(ink, 0.6), titleFill: css(ink), titleInk: css(mxField(R)), grid: () => css(ink, 0.13) }; },
  /**
   * The glass (a little lighter toward its middle, as a tube glows) or the lit screen; then the city on its grid
   * and the rain, each painted once and kept until what they read changes, parting round the title, the tag and
   * the graphic; the hologram; the terminal windows. A photo is turned to phosphor (and ASCII, and torn); filling
   * the canvas, the rain falls over its shadows.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, R = rampOf(C, p), u = Math.min(w, h), F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0;
    let clearings = [];
    const rainKey = () => [seed, w, h, dark, p.rain, p.size, p.depth, R.phos.join(), JSON.stringify(clearings)].join("|");
    const rain = (x) => { mxRain(x, w, h, p, R); mxCut(x, clearings, u * 0.05); };
    if (env.photo) {
      const sd = seed, n = Math.round(p.glitch * 7);
      env.drawPhoto(0, p.photo > 0 || p.ascii > 0 || n > 0 ? { key: `mx|${p.photo}|${p.ascii}|${n}|${sd}|${R.phos.join()}`, fn: (d, pw, ph) => { if (p.photo > 0) mxPixels(d, p.photo, R); mxAscii(d, pw, ph, p.ascii, R); if (n) mxSlide(d, pw, ph, n, 6400 + sd % 97); } } : null);
      if (L.fill && canPaint(ctx)) {   // the glass darkened behind the words, as a terminal's text stands on the dark
        clearings = mxClearings(ctx, env);
        const T = clearings.find((b) => b.a > 0.8);
        if (T) blurred(ctx, u * 0.06, css(R.void, 0.62), () => ctx.fillRect(T.x, T.y, T.w, T.h));
      }
      if (L.fill && p.rain > 0 && canPaint(ctx)) {   // the rain falls over its shadows: lighter than the photo only where it is dark
        const kept = mxLayer(ctx, "mxRainKept", rainKey(), rain);
        inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.globalAlpha = Math.min(1, 0.4 + p.rain); ctx.drawImage(kept, 0, 0); });
        mxLetGoBig();
      }
      return true;
    }
    if (L.ground !== false) {
      if (dark) { const g = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.6); g.addColorStop(0, css(mix(R.void, R.deep, 0.5))); g.addColorStop(1, css(R.void)); ctx.fillStyle = g; }
      else { const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.hypot(w, h) * 0.62); g.addColorStop(0, css(mix(R.paper, R.hot, 0.18))); g.addColorStop(0.6, css(R.paper)); g.addColorStop(1, css(R.edge)); ctx.fillStyle = g; }
      ctx.fillRect(0, 0, w, h);
    }
    if (!L.grid) return true;
    const paints = canPaint(ctx);
    if (paints && (p.rain > 0 || p.city > 0)) clearings = mxClearings(ctx, env);
    if (p.city > 0) {   // the city's vanishing point: a scene object
      const [vx, hz] = objAt("city", F.x0 + fw * 0.62, F.y0 + fh * (0.6 - 0.08 * p.city), ctx);
      const paint = (x) => {
        mxCity(x, F, vx, hz, p.city, R, 6200);
        if (dark && canPaint(x)) { const s = softCopy(x.canvas, 6, "mxCityGlow"); inPixels(x, () => { x.globalCompositeOperation = "lighter"; x.globalAlpha = 0.6; x.imageSmoothingEnabled = true; x.drawImage(s, 0, 0, x.canvas.width, x.canvas.height); }); }
        mxCut(x, clearings.map((b) => ({ ...b, a: b.a * 0.75 })), u * 0.05);
      };
      if (paints) { const kept = mxLayer(ctx, "mxCityKept", [seed, w, h, dark, F.x0, F.y0, F.x1, F.y1, vx.toFixed(1), hz.toFixed(1), p.city, R.phos.join(), JSON.stringify(clearings)].join("|"), paint); inPixels(ctx, () => ctx.drawImage(kept, 0, 0)); }
      else mxCity(ctx, F, vx, hz, p.city, R, 6200);
    }
    if (p.rain > 0 && paints) { const kept = mxLayer(ctx, "mxRainKept", rainKey(), rain); inPixels(ctx, () => ctx.drawImage(kept, 0, 0)); }
    mxLetGoBig();
    const plan = paints && (p.figure > 0 || p.windows > 0) ? mxFigureOf(ctx, env, p) : null, room = mxRoom(env);
    if (plan && p.figure > 0) {   // the hologram: a scene object, its handle at its middle
      const { S, at } = plan, [cx, cy] = objAt("figure", at.cx, at.cy, ctx);
      mxHologram(ctx, S, figureOf(env), cx, cy, at.size, Math.min(1, p.figure * 3) * (at.faint ? 0.55 : 1), R, 6300);
    }
    if (p.windows > 0) {   // the windows move as one: a scene object; clear of the hologram's room where they can be (where it stands undragged, at its largest, on or not)
      const wins = mxWindowPlan(room, u, p.windows * 4, mxKeep(ctx, env), plan ? [plan.at.room] : []), W = mxWords(env), alert = dark ? mxAlert(C, R) : mix(mxAlert(C, R), R.ink, 0.62);   // on the lit screen, darkened so it reads
      if (wins.length) {
        ctx.save(); shift("windows", wins[0].x + wins[0].w / 2, wins[0].y + wins[0].h / 2, ctx);
        for (const b of wins) mxWindow(ctx, b.x, b.y, b.w, b.h, b.kind, W, R, alert, clamp(p.windows * 4 - b.i), 6500 + b.i * 31);
        ctx.restore();
      }
    }
    return true;
  },
  /** The terminal's character cells: a row every 32, and a tick at every column on it, 16 apart. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color); ctx.beginPath();
    for (const y of every(32, h, 32)) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.beginPath();
    for (const y of every(32, h, 32)) for (let x = 16; x < w; x += 16) ctx.rect(x - 1, y - 6, 2, 6);
    ctx.fill(); ctx.restore();
  },
  accent: {
    fill: (C) => css(mix(rampOf(C, values).void, [0, 0, 0], 0.3)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** The block as a terminal panel: a rule of light along its edge and a hairline within it, a glow off it on the glass. */
    edge(ctx, run, nx, ny, C, p) {
      const R = rampOf(C, p), at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      if (dark) for (const [lw, al] of [[22, 0.08], [10, 0.18]]) { ctx.strokeStyle = css(R.phos, al); ctx.lineWidth = lw; at(1); }
      ctx.strokeStyle = css(R.phos); ctx.lineWidth = 3.5; at(1);
      ctx.strokeStyle = css(R.phos, 0.55); ctx.lineWidth = 1.2; at(12);
      ctx.setLineDash([2, 6]); ctx.strokeStyle = css(R.phos, 0.4); ctx.lineWidth = 6; at(22); ctx.setLineDash([]);
    },
    /** Inside it, faint lines of a log scrolling past, as on a terminal left running. */
    body(ctx, box, nx, ny, C, p) {
      const R = rampOf(C, p), fs = 13, lh = 21;
      ctx.save(); ctx.font = `500 ${fs}px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(R.phos, 0.11);
      for (let y = box.y + 44, i = 0; y < box.y + box.h - 8; y += lh, i++) {
        let s = `${hex(7000 + i * 1.3, 4)}:${hex(7001 + i * 2.1, 4)}  `;
        while (s.length * fs * 0.6 < box.w - 60) s += rand(7002 + i * 3.3 + s.length * 0.7) < 0.2 ? "  " : GLYPHS[Math.floor(rand(7003 + i * 1.9 + s.length * 1.1) * NG)];
        ctx.fillText(s, box.x + 30, y);
      }
      ctx.restore();
    },
  },
  /**
   * Monospaced capitals lit as phosphor: a pale core in a wide glow and a tight one (the shadow slider). Highlighted
   * words are selected: a block of the phosphor behind them, the letters cut out of it in the glass's black. In
   * inverse video, dark letters on the lit screen, the selection a dark block with the screen's green in it.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const R = rampOf(o.C, p), fs = o.fs, k = o.unit || 1, glow = Math.min(2, o.shadowAmt ?? 1);
    const ink = o.fill || (dark ? mix(R.phos, R.hot, 0.35) : R.ink), sel = o.hi || (dark ? R.phos : R.ink), cut = dark ? R.void : R.paper, halo = o.fill || R.phos;
    const plain = (a, x) => { if (!a.hi || o.hiPlate) { ctx.fillStyle = css(a.hi ? o.hi || ink : ink); ctx.fillText(a.t, x, 0); } };
    if (!o.hiPlate) pass((a, x) => {   // the selection: a block round the run, its light thrown round it
      if (!a.hi || (a.run && !a.first)) return;
      const x0 = a.run ? a.run.x0 : x, x1 = a.run ? a.run.x1 : x + ctx.measureText(a.t).width;
      ctx.save();
      if (dark && glow > 0 && !fast) { ctx.shadowColor = css(R.phos, 0.6); ctx.shadowBlur = fs * 0.22 * glow * k; }
      ctx.fillStyle = css(sel); ctx.fillRect(x0 - fs * 0.06, -fs * 0.9, x1 - x0 + fs * 0.12, fs * 1.14);
      ctx.restore();
    });
    if (dark && !fast) {   // a soft dark round the letters, so they stand off the rain and a lit photo; then their glow, wide and faint, then close
      ctx.save(); ctx.shadowColor = css(R.void, 0.85); ctx.shadowBlur = fs * 0.14 * k; pass(plain); ctx.restore();
      if (glow > 0) for (const [r, al] of [[0.42, 0.45], [0.1, 0.7]]) { ctx.save(); ctx.shadowColor = css(halo, al); ctx.shadowBlur = fs * r * glow * k; pass(plain); ctx.restore(); }
    }
    pass(plain);
    if (!o.hiPlate) pass((a, x) => { if (a.hi) { ctx.fillStyle = css(o.hi && !near(o.hi, sel, 60) ? o.hi : cut); ctx.fillText(a.t, x, 0); } });
  },
  // graphics and the small parts in the one green: lines of light on the glass, faces in its darks and its lit greens
  wrap: (ctx, C, p, plates) => {
    const R = rampOf(C, p);
    if (plates) return mxSmall(ctx, R);
    return dark ? mapped(ctx, { fill: { ink: R.deep, light: R.hot, mid: R.mid, dark: R.dim, colour: (c) => mix(R.phos, R.hot, clamp(lum(c) - 0.4)) }, stroke: { ink: R.phos, light: R.hot, colour: () => R.phos }, line: 0.6 })
      : mapped(ctx, { fill: { ink: R.ink, light: mix(R.paper, R.hot, 0.6), mid: R.edge, dark: R.inkSoft, colour: () => R.inkSoft }, stroke: { ink: R.ink, light: R.paper, colour: () => R.ink }, line: 0.6 });
  },
  sticker: painters({
    line: null,
    tone: (fill) => { const c = parseColour(fill), R = rampOf(null, values); if (!c) return fill; const l = lum(c); return css(dark ? (l < 0.08 ? R.deep : l < 0.3 ? R.mid : l < 0.7 ? R.phos : R.hot) : (l < 0.25 ? R.ink : l < 0.6 ? R.inkSoft : R.hot), c[3]); },
    shadow(ctx, draw, fill) { if (!dark || fast) return; ctx.save(); ctx.globalAlpha = 0.65; ctx.shadowColor = css(rampOf(null, values).phos); ctx.shadowBlur = 18; draw(fill); ctx.restore(); },
  }),
  /** The corner tag: a prompt in a thin frame, its words after a ">" and a cursor block after them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const R = rampOf(C, p), f = fs * 0.56, fg = ink || css(mxInk(R)), label = `> ${str}`;
    ctx.font = `700 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const tw = spacedW(ctx, label, 2), w = tw + f * 2.1, h = f * 1.9, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(mxField(R), 0.85); ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = fg; ctx.lineWidth = 2; ctx.strokeRect(x + 1, top + 1, w - 2, h - 2);
    ctx.fillStyle = fg; spaced(ctx, label, x + f * 0.55, top + h * 0.5 + f * 0.36, 2);
    ctx.fillRect(x + f * 0.55 + tw + f * 0.2, top + h * 0.24, f * 0.5, h * 0.54);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /**
   * The frame layer: the corners of the screen marked, and a status line — the channel's node, a load bar, a clock —
   * at the foot of the open field on the left, else on its right, else at its head, wherever it is clear of the words,
   * the tag, the graphic and the brand row, then of the hologram's room (on or not); else where it reaches least over
   * them. Never left out.
   */
  frame(ctx, env, p) {
    const { w, h, C } = env, R = rampOf(C, p), ink = mxInk(R), W = mxWords(env), m = 26, L = 46, room = mxRoom(env);
    ctx.save(); ctx.strokeStyle = css(ink, 0.7); ctx.lineWidth = 2; ctx.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); }
    ctx.stroke();
    ctx.font = `500 14px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(ink, 0.62);
    const f = 0.3 + 0.6 * rand(7100 + W.n), bar = "█".repeat(Math.round(f * 8)) + "░".repeat(8 - Math.round(f * 8));
    const text = `${W.code}.SYS  NODE ${pad2(W.n + 1)}  ${bar} ${Math.round(f * 100)}%  ${pad2(Math.floor(rand(7101) * 24))}:${pad2(Math.floor(rand(7102) * 60))}:${pad2(Math.floor(rand(7103) * 60))}`;
    const tw = ctx.measureText(text).width || 300, T = canPaint(ctx) ? titleArea(ctx, env) : null, fig = mxFigureOf(ctx, env, p), keep = [...(T ? [T] : []), ...keepOthers(env), ...mxBrandBoxes(ctx, env)];
    const over = (boxes, [x, y]) => boxes.reduce((t, q) => t + Math.max(0, Math.min(q.x + q.w, x + tw + 8) - Math.max(q.x, x - 8)) * Math.max(0, Math.min(q.y + q.h, y + 8) - Math.max(q.y, y - 18)), 0), holo = fig ? [fig.at.room] : [];   // the hologram, its emitter's ring
    const spots = [[room.x0 + m + 30, room.y1 - m - 8], [room.x1 - m - 30 - tw, room.y1 - m - 8], [room.x1 - m - 30 - tw, room.y0 + m + 22]].filter(([x], i) => !i || x >= room.x0).map((q) => [q, over(keep, q), over(holo, q)]);
    const [at] = spots.find(([, a, b]) => a < 0.5 && b < 0.5) || spots.reduce((s, q) => (q[1] < s[1] || (q[1] === s[1] && q[2] < s[2]) ? q : s));
    ctx.fillText(text, at[0], at[1]);
    ctx.restore();
  },
  /** The plate under a text layer: a terminal's box, a rule of light inside its edge. */
  plate(ctx, x, y, w, h, colour, fs, p) {
    const R = rampOf(null, p);
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(mxInk(R), 0.85); ctx.lineWidth = Math.max(1.5, fs * 0.025); ctx.strokeRect(x + fs * 0.06, y + fs * 0.06, w - fs * 0.12, h - fs * 0.12);
  },
  image(ctx, C, unit) { if (!dark) return; ctx.shadowColor = css(rampOf(C, values).phos, 0.55); ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  /**
   * The tube over the whole picture: torn bands of signal slid sideways (each at the first of its rows clear of the
   * lettering, else at the one crossing least of it: as many as the slider says), the phosphor's glow on what is bright,
   * scanlines, and the dark corners of a curved screen. The tears and the glow are left out while dragging.
   */
  post(ctx, w, h, C, p, unit = 1, hits = []) {
    const R = rampOf(C, p), cv = ctx.canvas, paints = canPaint(ctx);
    if (p.glitch > 0 && paints && !fast) {
      const src = snap(ctx, "mxTear"), W = cv.width, H = cv.height, n = Math.round(1 + 6 * p.glitch);
      const words = hits.filter((t) => ["title", "subtitle", "text", "tag", "catname", "brand"].includes(t.type)).map((t) => { const a = ((t.r || 0) * Math.PI) / 180, half = Math.abs(t.hw * Math.sin(a)) + Math.abs(t.hh * Math.cos(a)) + 10; return [(t.cy - half) * unit, (t.cy + half) * unit]; });
      const cross = (y, bh) => words.reduce((t, [a, b]) => t + (y + bh < a || y > b ? 0 : Math.min(y + bh, b) - Math.max(y, a) + 1), 0);   // how many of its rows run through lettering
      inPixels(ctx, () => {
        for (let i = 0; i < n; i++) {
          const bh = Math.max(2, Math.round((3 + rand(8000 + i * 3.7) ** 2 * 26) * unit)), dx = Math.round((rand(8001 + i * 5.1) - 0.5) * 90 * unit * (0.4 + p.glitch));
          const at = (q) => Math.round((0.06 + 0.86 * rand(q)) * H);   // not along the foot, where the status line runs
          let y = at(8002 + i * 7.3), c = cross(y, bh);
          for (let again = 1; again <= 12 && c > 0; again++) { const q = at(8002 + i * 7.3 + again * 13.7), v = cross(q, bh); if (v < c) { y = q; c = v; } }   // crowded with lettering: across as little of it as it can
          ctx.drawImage(src, 0, y, W, bh, dx, y, W, bh);
          ctx.drawImage(src, dx > 0 ? 0 : W - 1, y, 1, bh, dx > 0 ? 0 : W + dx, y, Math.abs(dx), bh);   // what the slide left bare: its edge smeared across it
          ctx.globalCompositeOperation = dark ? "lighter" : "multiply"; ctx.fillStyle = css(dark ? R.dim : R.paper, dark ? 0.25 : 0.8); ctx.fillRect(0, y, W, bh); ctx.globalCompositeOperation = "source-over";   // the band a little lit, as a signal that slipped is
        }
      });
    }
    if (p.glow > 0 && paints && !fast && dark) {   // halation: only the brightest kept (the soft copy multiplied by itself), added back
      const soft = softCopy(cv, 9, "mxBloom"), x = soft.getContext("2d");
      x.globalCompositeOperation = "multiply"; x.drawImage(soft, 0, 0);
      inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = Math.min(1, p.glow * 1.3); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
    }
    if (p.scan > 0 && paints) {   // a dark row every few pixels, as many to the cover at any size
      const px = Math.max(2, Math.round(3.2 * unit)), tile = mxScanTile(px, dark ? [0, 0, 0] : R.ink);
      inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, p.scan * (dark ? 0.85 : 0.32)); ctx.globalCompositeOperation = dark ? "source-over" : "multiply"; ctx.fillStyle = ctx.createPattern(tile, "repeat"); ctx.fillRect(0, 0, cv.width, cv.height); });
    }
    if (p.curve > 0) {   // the tube's curve: the picture darkening toward its corners, the corners rounded off into the dark
      const shade = dark ? R.void : R.ink, r = Math.min(w, h) * (0.05 + 0.1 * p.curve);
      vignette(ctx, w, h, shade, (dark ? 0.75 : 0.4) * p.curve, 0.36);
      const d = r * 0.9, al = (dark ? 0.6 : 0.35) * p.curve;   // the glass darkening into its edges, the corners most, where two edges meet
      for (const [x0, y0, x1, y1, gx0, gy0, gx1, gy1] of [[0, 0, w, d, 0, 0, 0, d], [0, h - d, w, h, 0, h, 0, h - d], [0, 0, d, h, 0, 0, d, 0], [w - d, 0, w, h, w, 0, w - d, 0]]) {
        const g = ctx.createLinearGradient(gx0, gy0, gx1, gy1); g.addColorStop(0, css(shade, al)); g.addColorStop(1, css(shade, 0));
        ctx.fillStyle = g; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      ctx.beginPath(); ctx.rect(-10, -10, w + 20, h + 20); rounded(ctx, 0, 0, w, h, r);   // its rounded corners
      ctx.fillStyle = css(shade, Math.min(1, p.curve * 2.5)); ctx.fill("evenodd");
    }
  },
  prompt: `Glowing icons for a green phosphor-terminal poster — the digital rain, hackers and old screens — that read at a glance:
- one clear object per sticker (a skull, a key, a padlock, an eye, a floppy disk, a terminal window, a pill, a chip, a satellite dish, a rabbit), bold and simple, like a symbol on a screen; no realism, no fine detail;
- flat colour only, all of it greens: "ink" for the darkest parts, the main colour and "white" for the lit parts (the app turns every colour into the one phosphor green, by its lightness);
- the app adds a green glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects for a green-screen terminal poster, built as simple models from a few boxes and cylinders — an old CRT monitor and keyboard, a server rack, a phone booth, a satellite dish, a mainframe; no realism, no fine detail.
- the renderer paints faces in dark and lit greens with lines of green light: do NOT try to draw shading or outlines yourself;
- "white" is a pale green, "dark" a deep bottle green, and "main" the phosphor green — use it for one to three parts.`,
};
matrix.elementFx = [
  { key: "phosphor", name: { zh: "荧光绿", en: "Phosphor" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 40 * k, t: 40 * k, r: 40 * k, b: 40 * k }),
    /** The layer in the one green by its lightness, from the glass to white-green, glowing on the screen. */
    paint(x, B, a, E) {
      const R = mxRamp(E.C, current && current.id === "matrix" ? values.chan : 0), img = x.getImageData(B.x0, B.y0, B.w, B.h);   // under this look, its own phosphor
      mxPixels(img.data, a, R); x.putImageData(img, B.x0, B.y0);
      glowBehind(x, B, region(x, B, "fxA"), (10 + 16 * a) * E.k, Math.min(1, a * 1.4) * 0.8, R.phos);
    } },
  { key: "scanglitch", name: { zh: "扫描撕裂", en: "Scanline tear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.12, r: B.w * 0.12 }),
    /** Dark rows across the layer as on a tube, and bands of it slid sideways. */
    paint(x, B, a, E) {
      slideBands(x, B, a, E, 2, false);
      onLayer(x, B, region(x, B, "fxA"), "source-over", Math.min(1, 0.25 + 0.5 * a), (g) => { const px = Math.max(2, Math.round(3.2 * E.k)); g.fillStyle = "#000"; for (let y = 0; y < B.h; y += px) g.fillRect(0, y + Math.round(px * 0.55), B.w, Math.max(1, Math.round(px * 0.45))); });
    } },
  { key: "ascii", name: { zh: "字符画", en: "ASCII" }, for: FX_ALL, stage: "fill", sub: [{ key: "cell", name: { zh: "字符大小", en: "Character size" }, def: 0.35 }],
    /** The layer rebuilt in characters, darker to lighter through " .:-=+*#%@", each in the layer's own colour there, lit a little. */
    paint(x, B, a, E, o) {
      const cs = Math.max(4, (5 + 14 * o.cell) * E.k), [d, cols, rows] = cellsOf(x, B, cs);
      x.save(); x.globalCompositeOperation = "destination-out"; x.globalAlpha = a; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
      x.save(); x.globalAlpha = a; x.font = `700 ${cs * 1.2}px ${fonts.mono}`; x.textAlign = "center"; x.textBaseline = "middle";
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const q = (j * cols + i) * 4, al = d[q + 3] / 255;
        if (al < 0.25) continue;
        const ch = ASCII_RAMP[Math.max(1, Math.min(ASCII_RAMP.length - 1, Math.floor(lumOf(d, q) * 1.1 * ASCII_RAMP.length)))];
        x.fillStyle = `rgb(${Math.min(255, d[q] + 30)},${Math.min(255, d[q + 1] + 30)},${Math.min(255, d[q + 2] + 30)})`; x.fillText(ch, B.x0 + (i + 0.5) * cs, B.y0 + (j + 0.5) * cs);
      }
      x.restore();
    } },
  { key: "rain", name: { zh: "代码雨", en: "Code rain" }, for: FX_ALL, stage: "over",
    /** Columns of the falling code over the layer, inside its own shape: bright heads, fading tails. */
    paint(x, B, a, E) {
      const R = mxRamp(E.C, 0), gs = Math.max(6, Math.min(B.w, B.h) * 0.06), col = dark ? R.hot : R.ink;
      onLayer(x, B, region(x, B, "fxA"), dark ? "lighter" : "multiply", Math.min(1, a * 1.3), (g) => {
        g.font = `600 ${gs}px ${fonts.cn}`; g.textAlign = "left"; g.textBaseline = "top";
        mxDrops(B.w, B.h, gs, 0.25 + 0.5 * a, 5700 + E.seed % 101, (cx, cy, gi, b, heat) => { g.fillStyle = css(heat === 2 ? col : dark ? R.phos : R.inkSoft, b); g.fillText(GLYPHS[gi], cx, cy); });
      });
    } },
];
