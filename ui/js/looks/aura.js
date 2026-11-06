// aura: the Swiss gradient poster
// Contemporary Swiss-gradient posters: soft, out-of-focus aura light — big lights melting into one another on a pale
// ground, or glowing on black; a thermal camera's ramp; a rainbow smeared like a hologram — under a strong fine grain.
// On it a glass capsule with a bright rim, a ribbon of hairlines folding through space, thin orbits, a cube of light,
// motion-smeared streaks; the frame a Swiss micro-typography of tiny spaced labels, hairlines, crosshairs and an index.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, blurred, boost, canPaint, clamp, css, dark, dkBox, dkHsl, dkRgb, dkWork, fast, flatFx, glowBehind, gridPen, hueTurn, inPixels, keepClear, keepOthers, keptLayer, mapped, mix, objAt, overlaps, pad2, painters, rand, region, rounded, seed, softCopy, sparkle, titleArea, toneTable, tonesFx, trail, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { inPiece } from "../title.js";
import { blockLayout } from "../layout.js";

const W3 = [255, 255, 255];
/** The look's grotesk: Helvetica where the system has it, Arial where not; CJK in the profile's sans. */
const auFace = () => `"Helvetica Neue", Helvetica, Arial, ${fonts.cn}`;
/**
 * The palettes, each with its dark ground and its light one. A "mass" palette mixes its lights by their weight, so
 * they melt into one another (`c`, six colours, the sixth a pale light); a heat palette ("cyan", "warp", "thermal") sends how much light there
 * is through a ramp (`ramp`, from the ground up), as a thermal camera does; "band" lays the spectrum in long streaks
 * side by side. `hi`: three colours the highlighted words and the scene's light are made of; `photo`: the ramp a photo's
 * light is mapped onto (a heat palette's own ramp on the night, where it has none: see auPhotoRamp).
 */
export const AU_PALETTES = [
  { id: "dusk", name: { zh: "暮光", en: "Dusk" }, form: "mass",
    dark: { ground: [9, 8, 26], c: [[255, 86, 166], [150, 108, 255], [84, 128, 255], [255, 150, 128], [36, 46, 214], [238, 220, 255]], hi: [[255, 150, 206], [212, 184, 255], [150, 192, 255]] },
    light: { ground: [239, 235, 247], c: [[248, 120, 180], [182, 154, 244], [118, 148, 246], [255, 182, 152], [76, 92, 232], [255, 246, 252]], hi: [[218, 48, 134], [124, 70, 220], [42, 72, 218]] },
    photo: [[0, [8, 6, 24]], [0.24, [36, 40, 172]], [0.48, [120, 84, 236]], [0.68, [238, 88, 172]], [0.86, [255, 170, 150]], [1, [255, 242, 238]]] },
  { id: "electric", name: { zh: "电光蓝", en: "Electric blue" }, form: "mass",
    dark: { ground: [4, 7, 40], c: [[26, 62, 255], [168, 182, 255], [12, 30, 196], [226, 230, 255], [70, 128, 255], [236, 238, 255]], hi: [[150, 186, 255], [214, 220, 255], [90, 130, 255]] },
    light: { ground: [234, 237, 252], c: [[44, 74, 242], [166, 176, 252], [24, 44, 206], [128, 156, 255], [74, 114, 252], [250, 251, 255]], hi: [[28, 58, 228], [86, 78, 228], [18, 36, 186]] },
    photo: [[0, [2, 4, 32]], [0.32, [14, 38, 214]], [0.6, [84, 118, 255]], [0.84, [190, 202, 255]], [1, [246, 248, 255]]] },
  { id: "cyan", name: { zh: "青光", en: "Cyan glow" }, form: "cyan",
    dark: { ground: [2, 5, 10], ramp: [[0, [2, 5, 10]], [0.3, [4, 28, 92]], [0.56, [18, 90, 222]], [0.76, [0, 178, 228]], [0.91, [112, 236, 250]], [1, [232, 255, 255]]], hi: [[96, 232, 255], [64, 164, 255], [170, 250, 255]] },
    light: { ground: [232, 242, 247], ramp: [[0, [232, 242, 247]], [0.34, [150, 218, 240]], [0.64, [0, 170, 224]], [0.88, [20, 72, 204]], [1, [10, 30, 124]]], hi: [[0, 132, 196], [20, 74, 208], [0, 158, 196]] } },
  { id: "warp", name: { zh: "炽红", en: "Warp red" }, form: "warp",
    dark: { ground: [6, 3, 4], ramp: [[0, [6, 3, 4]], [0.28, [72, 0, 10]], [0.52, [204, 12, 26]], [0.7, [255, 72, 32]], [0.86, [255, 172, 92]], [1, [255, 238, 194]]], hi: [[255, 96, 52], [255, 176, 96], [255, 232, 176]] },
    light: { ground: [247, 241, 237], ramp: [[0, [247, 241, 237]], [0.32, [255, 198, 172]], [0.6, [255, 92, 62]], [0.84, [212, 22, 38]], [1, [122, 0, 22]]], hi: [[206, 22, 40], [226, 36, 62], [150, 0, 52]] } },
  { id: "thermal", name: { zh: "热成像", en: "Thermal" }, form: "thermal",
    dark: { ground: [4, 3, 12], ramp: [[0, [4, 3, 12]], [0.17, [20, 16, 112]], [0.32, [56, 42, 222]], [0.46, [150, 40, 222]], [0.58, [236, 40, 172]], [0.7, [255, 52, 52]], [0.82, [255, 150, 20]], [0.93, [255, 232, 60]], [1, [255, 255, 214]]], hi: [[255, 226, 62], [255, 124, 40], [240, 54, 164]] },
    light: { ground: [238, 236, 246], ramp: [[0, [238, 236, 246]], [0.2, [172, 182, 250]], [0.38, [72, 82, 240]], [0.52, [150, 40, 222]], [0.64, [236, 40, 172]], [0.76, [255, 62, 50]], [0.88, [255, 150, 20]], [1, [255, 216, 40]]], hi: [[214, 30, 130], [150, 30, 200], [56, 50, 222]] } },   // its highlight without orange: held dark enough to read on the pale ground, it would be brown
  { id: "holo", name: { zh: "全息虹彩", en: "Holographic" }, form: "band",
    dark: { ground: [5, 5, 9], c: [[255, 60, 76], [255, 152, 40], [255, 228, 74], [70, 222, 144], [52, 172, 255], [152, 82, 255]], hi: [[255, 92, 128], [255, 214, 84], [84, 216, 255]] },
    light: { ground: [241, 239, 245], c: [[250, 96, 112], [255, 170, 80], [250, 220, 96], [104, 214, 160], [96, 176, 250], [164, 116, 246]], hi: [[226, 38, 92], [224, 140, 14], [24, 136, 226]] },
    photo: [[0, [5, 5, 9]], [0.2, [40, 30, 160]], [0.35, [30, 140, 255]], [0.5, [40, 220, 160]], [0.63, [232, 232, 60]], [0.76, [255, 140, 30]], [0.88, [255, 52, 84]], [1, [255, 226, 255]]] },
];
/** The ramp a photo's light is mapped onto in palette P. */
export const auPhotoRamp = (P) => P.photo || P.dark.ramp;
/** The palette the look's slider picks. */
export const auPal = (p) => AU_PALETTES[clamp(Math.round((p && p.palette) || 0), 0, AU_PALETTES.length - 1)];
/** A palette's side for the ground the cover is on. */
const auSide = (P, onDark = dark) => (onDark ? P.dark : P.light);
/** The lettering's and the small parts' colour: near white on the night, near black on the pale ground. */
const auInk = (onDark = dark) => (onDark ? [250, 249, 255] : [16, 15, 28]);
/** A colour of the palette as lettering on this ground: mixed toward white till it is light enough to read on the night, toward the ink till it is dark enough on the pale ground. */
export function auLegible(c, onDark = dark) {
  const l = (x) => (0.2126 * x[0] + 0.7152 * x[1] + 0.0722 * x[2]) / 255, to = onDark ? W3 : [16, 15, 28], ok = (x) => (onDark ? l(x) >= 0.64 : l(x) <= 0.2);
  for (let t = 0; t <= 1.0001; t += 0.05) { const m = mix(c, to, t); if (ok(m)) return m; }
  return to;
}
/** A ramp's 256 steps, kept per ramp. */
const AU_LUTS = new Map();
const auLut = (stops) => { let t = AU_LUTS.get(stops); if (!t) AU_LUTS.set(stops, (t = toneTable(stops))); return t; };
/**
 * The channel colour as a light in the aura: its hue, saturated, light enough to glow on the night and a little
 * deeper on the pale ground. A grey channel colour gives the palette's own first light.
 */
export function auChan(C, onDark = dark, fallback = [255, 110, 180]) {
  const [hh, s, l] = dkHsl(C);
  if (s < 0.08) return fallback;
  return dkRgb(hh, Math.max(0.72, s), onDark ? clamp(l, 0.52, 0.66) : clamp(l, 0.44, 0.6));
}
// ====================================================================== the aura: lights computed on a coarse grid
/**
 * The lights of each form, as fractions of the cover (x, y), a radius (r, of the cover's mean side), an elongation
 * (e: rx / ry is e), an angle (a), a strength (s) and a colour of the palette (c); `room` ones are placed at the
 * cover's free room (see auPlan), away from the title. A mass palette's sixth colour is a pale light.
 */
const AU_FORMS = {
  mass: [
    { x: 0.1, y: 0.86, r: 0.62, e: 1.5, a: -0.6, s: 1, c: 4 },
    { x: 0.94, y: 0.08, r: 0.56, e: 1.3, a: 0.5, s: 1, c: 0 },
    { x: 0.48, y: 0.5, r: 0.46, e: 3.4, a: -0.62, s: 0.72, c: 2 },
    { x: 0.97, y: 0.97, r: 0.36, e: 1.2, a: 0, s: 0.9, c: 3 },
    { x: 0.26, y: 0.1, r: 0.3, e: 1.7, a: 0.9, s: 0.7, c: 1 },
    { room: 1, r: 0.3, e: 1.8, a: -0.5, s: 0.6, c: 5 },   // a pale light at the room, behind the capsule
  ],
  cyan: [{ room: 1, r: 0.4, e: 1.15, a: 0.3, s: 1.3 }, { x: 0.08, y: 0.92, r: 0.5, e: 1.8, a: -0.5, s: 0.55 }, { x: 0.86, y: 0.1, r: 0.34, e: 1.4, a: 0.5, s: 0.45 }, { x: 0.5, y: 0.5, r: 0.9, e: 1.4, a: -0.3, s: 0.16 }],
  warp: [{ room: 1, r: 0.21, e: 3.6, a: 0.95, s: 1.6 }, { x: 0.16, y: 0.8, r: 0.17, e: 2.4, a: -0.75, s: 1.3 }, { x: 0.66, y: 0.1, r: 0.14, e: 3, a: 0.35, s: 1.1 }, { x: 0.5, y: 0.5, r: 0.8, e: 1.6, a: 0.4, s: 0.05 }],
  thermal: [{ x: 0.06, y: 0.8, r: 0.27, e: 1.8, a: -0.45, s: 1.5 }, { x: 0.92, y: 0.16, r: 0.24, e: 2, a: 0.6, s: 1.4 }, { room: 1, r: 0.2, e: 1.4, a: 0.2, s: 1.2 }, { x: 0.46, y: 1.04, r: 0.3, e: 2.8, a: 0.08, s: 0.9 }, { x: 0.5, y: 0.45, r: 0.9, e: 1.5, a: -0.4, s: 0.07 }],
};
/** The angle motion smears the aura along (down and to the right, as a light passing). */
const AU_SMEAR = 0.42;
/**
 * The lights of the aura on a w × h cover in palette P, by the sliders `p` (aura: how many and how large; chan: the
 * channel's own light; smear: hard discs of light, to be smeared into streaks) and the profile's seed, `room` the
 * free room's middle, `words` the title's box (a light centred under it is dimmer, the band passes it by): { list, chan }
 * — each light { x, y, rx, ry, cs, sn, irx, iry, s, c, hard }, in cover units; for a heat palette the channel's light
 * apart (`chan`: it heats, and colours only its own hot core). None at all when the aura is 0.
 */
export function auBlobs(w, h, P, p, C, room, onDark = dark, words = null) {
  const a = clamp(p.aura || 0), D = Math.sqrt(w * h), S = auSide(P, onDark), list = [];
  let chan = null;
  if (a <= 0) return { list, chan };
  const flip = rand(9101) > 0.5, k = 0.62 + 0.5 * a, str = Math.min(1, a * 2.2), heat = !!S.ramp;
  // a light centred under the words is dimmer: the aura's brightest parts gather away from them
  const under = (x, y) => (words && x > words.x - D * 0.05 && x < words.x + words.w + D * 0.05 && y > words.y - D * 0.05 && y < words.y + words.h + D * 0.05 ? 0.55 : 1);
  const light = (x, y, r, e, ang, s, c, hard = false) => {
    const rx = r * Math.sqrt(e), ry = r / Math.sqrt(e);
    return { x, y, rx, ry, irx: 1 / rx, iry: 1 / ry, cs: Math.cos(ang), sn: Math.sin(ang), s: s * under(x, y), c, hard };
  };
  if (P.form === "band") {   // the spectrum in long soft streaks side by side, through the room and across the way to the words, so it passes them by
    const to = words ? Math.atan2(words.y + words.h / 2 - room.y, words.x + words.w / 2 - room.x) : (flip ? -1 : 1) * 0.5;
    const ang = to + Math.PI / 2 + (rand(9102) - 0.5) * 0.3, nx = -Math.sin(ang), ny = Math.cos(ang), gap = D * 0.05 * k;
    const order = [S.c[0], S.c[1], S.c[2], mix(S.c[2], W3, 0.8), S.c[3], S.c[4], S.c[5]];   // red to violet, a white core between the yellow and the green
    const off = words ? D * 0.07 : 0;   // a little further from the words than the room's middle (the normal points away from them)
    order.forEach((c, i) => { const o = (i - (order.length - 1) / 2) * gap + off, along = (rand(9103 + i * 2.1) - 0.5) * D * 0.16; list.push(light(room.x + nx * o + Math.cos(ang) * along, room.y + ny * o + Math.sin(ang) * along, D * 0.2 * k, 22, ang, (i === 3 ? 1.1 : 0.95) * str, c)); });
    list.push(light(w * (flip ? 0.08 : 0.92), h * 0.9, D * 0.36 * k, 1.6, 0.4, 0.16 * str, S.c[5]), light(w * (flip ? 0.9 : 0.1), h * 0.08, D * 0.32 * k, 1.5, -0.3, 0.14 * str, S.c[4]));
  } else {
    AU_FORMS[P.form === "mass" ? "mass" : P.form].forEach((f, i) => {
      let x = f.room ? room.x / w + (rand(9110 + i) - 0.5) * 0.08 : f.x + (rand(9111 + i * 3.1) - 0.5) * 0.16, y = f.room ? room.y / h + (rand(9120 + i) - 0.5) * 0.08 : f.y + (rand(9121 + i * 2.7) - 0.5) * 0.16;
      const mirror = flip && !f.room;
      if (mirror) x = 1 - x;
      const r = f.r * D * k * (0.88 + rand(9130 + i * 2.3) * 0.24), ang = (mirror ? -1 : 1) * f.a + (rand(9140 + i * 1.7) - 0.5) * 0.5;
      list.push(light(x * w, y * h, r, f.e, ang, f.s * str, heat ? null : S.c[f.c]));
    });
  }
  if (p.chan > 0) {   // the channel's own light, just off the room's middle
    const c = auChan(C, onDark, S.hi[0]), L = light(room.x + D * 0.12 * (flip ? 1 : -1), room.y + D * 0.08, D * (heat ? 0.22 : 0.3) * k, 1.4, 0.3, clamp(p.chan) * 1.1 * str, c);
    if (heat) chan = L; else list.push(L);
  }
  if (p.smear > 0) {   // discs of light along the smear, through the room: smeared, they are the streaks of a light passing
    for (let i = 0; i < 3; i++) {
      const t = i - 1, r = D * (0.07 + rand(9150 + i) * 0.05), c = heat ? null : mix(S.c[(i + 2) % S.c.length], W3, onDark ? 0.55 : 0.2);
      list.push(light(room.x + t * D * 0.22 * Math.cos(AU_SMEAR + 1.1) + (rand(9151 + i) - 0.5) * D * 0.1, room.y + t * D * 0.22 * Math.sin(AU_SMEAR + 1.1), r, 1, 0, clamp(p.smear) * (heat ? 1.3 : 1.15) * str, c, true));
    }
  }
  return { list, chan };
}
/**
 * The aura's colours on a grid of W × H cells over a w × h cover, and `pad` cells past each edge (so a smear has
 * something to draw from there): RGBA, row by row. F: { list, chan (see auBlobs), lut (a heat palette's ramp, see
 * auLut) or null, ground, g0 (how much the ground counts where lights mix), hot (how far a crowded light runs to white),
 * warp { a, f1, f2, p1…p4 } (the coordinates bent before the lights are read: liquid shapes), ripple (isotherms) }.
 */
export function auPixels(W, H, pad, w, h, F) {
  const TW = W + 2 * pad, TH = H + 2 * pad, out = new Uint8ClampedArray(TW * TH * 4), sx = w / W, sy = h / H;
  const { list, chan, lut, ground: G, g0, hot, warp, ripple } = F, n = list.length;
  for (let j = 0; j < TH; j++) {
    const yy = (j - pad + 0.5) * sy;
    for (let i = 0; i < TW; i++) {
      let x = (i - pad + 0.5) * sx, y = yy;
      if (warp && warp.a) {
        const dx = warp.a * (Math.sin(y * warp.f1 + warp.p1) + 0.55 * Math.sin((x + y) * warp.f2 + warp.p2)), dy = warp.a * (Math.sin(x * warp.f1 * 0.83 + warp.p3) + 0.55 * Math.sin((x - y) * warp.f2 * 1.1 + warp.p4));
        x += dx; y += dy;
      }
      let S = 0, R = 0, Gn = 0, B = 0;
      for (let q = 0; q < n; q++) {
        const b = list[q], dx = x - b.x, dy = y - b.y, u = (dx * b.cs + dy * b.sn) * b.irx, v = (dy * b.cs - dx * b.sn) * b.iry, d2 = u * u + v * v;
        if (d2 > 14) continue;
        const k = b.s * (b.hard ? Math.exp(-d2 * d2 * d2 * 0.5) : Math.exp(-d2));
        S += k;
        if (b.c) { R += b.c[0] * k; Gn += b.c[1] * k; B += b.c[2] * k; }
      }
      let r, g, bl;
      if (lut) {   // heat: how much light there is, through the ramp
        let s = S, kc = 0;
        if (chan) { const dx = x - chan.x, dy = y - chan.y, u = (dx * chan.cs + dy * chan.sn) * chan.irx, v = (dy * chan.cs - dx * chan.sn) * chan.iry, d2 = u * u + v * v; if (d2 < 14) kc = chan.s * Math.exp(-d2); }
        s += kc;   // the channel's light heats as the others do
        if (ripple) s *= 1 + ripple * Math.sin(x * 0.011 + Math.sin(y * 0.007) * 2.2) * Math.sin(y * 0.009 + x * 0.003);
        const v = 1 - Math.exp(-Math.max(0, s) * 1.15), t = Math.round(255 * v) * 3;
        r = lut[t]; g = lut[t + 1]; bl = lut[t + 2];
        if (kc > 0) {   // and its hot core takes its colour: only where it glows, so its faint edge stays in the ramp's colours (a dim channel colour on black would muddy)
          const f = (kc / (S + kc)) * clamp((v - 0.5) / 0.42) * 0.8, c = chan.c;
          r += (c[0] + (255 - c[0]) * 0.2 - r) * f; g += (c[1] + (255 - c[1]) * 0.2 - g) * f; bl += (c[2] + (255 - c[2]) * 0.2 - bl) * f;
        }
      } else {   // the lights' colours mixed by their weight, the ground where there is none: they melt into one another
        const d = g0 + S;
        r = (G[0] * g0 + R) / d; g = (G[1] * g0 + Gn) / d; bl = (G[2] * g0 + B) / d;
        if (hot) { const t = clamp((S - 1.1) / 1.8) * hot * 0.7; r += (255 - r) * t; g += (255 - g) * t; bl += (255 - bl) * t; }
      }
      const o = (j * TW + i) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = 255;
    }
  }
  return out;
}
/**
 * Keeps the title readable: within `box` (cover units) and a soft margin `feather` round it, the aura held no lighter
 * than `most` on the night (white lettering on it) and no darker than `least` on the pale ground (near-black lettering),
 * the colour kept. `d`: the grid's RGBA (TW cells a row, `pad` of them past each edge, sx × sy units a cell).
 */
export function auGuard(d, TW, TH, pad, sx, sy, box, feather, onDark, most = 0.34, least = 0.62, lut = null) {
  if (!box) return;
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2, hw = box.w / 2, hh = box.h / 2;
  // a heat palette steps down its own ramp instead (a yellow held darker would be olive): to the hottest of its colours as dark as `most`
  let cool = -1;
  if (lut && onDark) for (let t = 0; t < 256; t++) if ((0.2126 * lut[t * 3] + 0.7152 * lut[t * 3 + 1] + 0.0722 * lut[t * 3 + 2]) / 255 <= most) cool = t;
  for (let j = 0; j < TH; j++) {
    const y = (j - pad + 0.5) * sy, ey = Math.max(0, Math.abs(y - cy) - hh);
    if (ey > feather) continue;
    for (let i = 0; i < TW; i++) {
      const x = (i - pad + 0.5) * sx, ex = Math.max(0, Math.abs(x - cx) - hw), e = Math.hypot(ex, ey);
      if (e > feather) continue;
      const m = 1 - (e / feather) * (e / feather) * (3 - 2 * (e / feather)), o = (j * TW + i) * 4, l = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
      if (onDark && l > most && cool >= 0) { const q = cool * 3; d[o] += (lut[q] - d[o]) * m; d[o + 1] += (lut[q + 1] - d[o + 1]) * m; d[o + 2] += (lut[q + 2] - d[o + 2]) * m; }
      else if (onDark && l > most) { const k = 1 + ((most + (l - most) * 0.25) / l - 1) * m; d[o] *= k; d[o + 1] *= k; d[o + 2] *= k; }   // a soft knee: the light kept, much lower
      else if (!onDark && l < least) { const t = m * clamp((least - l) / Math.max(0.05, 1 - l)); d[o] += (255 - d[o]) * t; d[o + 1] += (255 - d[o + 1]) * t; d[o + 2] += (255 - d[o + 2]) * t; }
    }
  }
}
/** Canvas c's picture smeared along angle `ang` by `len` px: the average of copies laid along the line (c's own pixels, see auField's `pad`). */
function auSmearOn(c, len, ang, slot) {
  if (len < 1) return;
  const t = WORK[slot] || (WORK[slot] = document.createElement("canvas"));
  if (t.width !== c.width || t.height !== c.height) { t.width = c.width; t.height = c.height; }
  const tg = t.getContext("2d"), g = c.getContext("2d"), n = Math.max(3, Math.ceil(len / 1.1)), dx = Math.cos(ang), dy = Math.sin(ang);
  tg.globalCompositeOperation = "copy"; tg.globalAlpha = 1; tg.drawImage(c, 0, 0);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true;
  g.globalCompositeOperation = "copy"; g.globalAlpha = 1; g.drawImage(t, -dx * len / 2, -dy * len / 2);
  g.globalCompositeOperation = "source-over";
  for (let k = 1; k <= n; k++) { const o = -len / 2 + (len * k) / n; g.globalAlpha = 1 / (k + 1); g.drawImage(t, dx * o, dy * o); }
  g.restore();
}
const AU_LOW = new Map();   // the aura on its coarse grid, by all it is made of: the last few
/** The cells the aura is worked out on: a longer side of 320. */
const auGrid = (w, h) => { const cell = Math.max(w, h) / 320; return { W: Math.max(8, Math.round(w / cell)), H: Math.max(8, Math.round(h / cell)) }; };
/** The aura's key: everything it is painted from (the cover's size, palette, ground, sliders, channel colour, seed, the room and the title's box). */
function auFieldKey(env, p, plan) {
  const r = (v) => Math.round(v);
  return JSON.stringify([env.w, env.h, auPal(p).id, dark, p.aura, p.flow, p.smear, p.chan, env.C, seed, r(plan.room.x), r(plan.room.y), auGuarded(env, plan).map((b) => [b.x, b.y, b.w, b.h].map(r))]);
}
/** The aura on its coarse grid (a canvas `pad` cells larger each way), worked out, smeared and kept clear of the title (see AU_LOW). */
function auLowField(env, p, plan, key) {
  const got = AU_LOW.get(key);
  if (got) { AU_LOW.delete(key); AU_LOW.set(key, got); return got; }
  const { w, h, C } = env, P = auPal(p), S = auSide(P), { W, H } = auGrid(w, h), sx = w / W, sy = h / H, D = Math.sqrt(w * h);
  const len = clamp(p.smear) * W * 0.3, pad = Math.ceil(len / 2) + 3, TW = W + 2 * pad, TH = H + 2 * pad;
  const blobs = auBlobs(w, h, P, p, C, plan.room, dark, plan.T), f = clamp(p.flow);
  const F = {
    ...blobs, lut: S.ramp ? auLut(S.ramp) : null, ground: S.ground, g0: dark ? (P.form === "band" ? 0.16 : 0.3) : 0.5, hot: dark ? (P.form === "band" ? 0.4 : 0.55) : 0, ripple: P.form === "thermal" ? 0.32 : 0,
    warp: { a: f * 0.16 * D, f1: TAU / (0.95 * D), f2: TAU / (0.6 * D), p1: rand(9201) * TAU, p2: rand(9202) * TAU, p3: rand(9203) * TAU, p4: rand(9204) * TAU },
  };
  const c = document.createElement("canvas"); c.width = TW; c.height = TH;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.putImageData(new ImageData(auPixels(W, H, pad, w, h, F), TW, TH), 0, 0);
  if (len >= 1) auSmearOn(c, len, AU_SMEAR, "auSmearT");
  const guard = auGuarded(env, plan);
  if (guard.length) {   // the words kept readable, after the smear (which would carry light back over them)
    const img = g.getImageData(0, 0, TW, TH), u = Math.min(w, h);
    for (const b of guard) auGuard(img.data, TW, TH, pad, sx, sy, b, Math.min(u * 0.15, Math.max(u * 0.06, Math.min(b.w, b.h) * 0.8)), dark, 0.34, 0.62, F.lut);
    g.putImageData(img, 0, 0);
  }
  const e = { c, pad, W, H };
  AU_LOW.set(key, e);
  if (AU_LOW.size > 10) AU_LOW.delete(AU_LOW.keys().next().value);
  return e;
}
/** The boxes the aura is held readable under (see auGuard): the title with its subtitle, the corner tag, the brand row, where they show. */
function auGuarded(env, plan) {
  const out = plan.T ? [plan.T] : [], tg = env.G && env.G.tag, on = (id) => !!env.cover && env.cover.layers.some((l) => l.id === id && l.visible);
  if (tg && env.cover && env.cover.tag && on("tag")) out.push({ x: tg.x, y: tg.y, w: Math.min(env.w * 0.4, tg.fs * 0.46 * (String(env.cover.tag).length * 0.9 + 3)), h: tg.fs * 1.34 });
  if (on("brand")) out.push({ x: 66, y: 60, w: Math.min(env.w * 0.45, 640), h: 60 });
  return out;
}
/** A tile of faint black and white specks, laid over the aura so its long gradients do not band. */
function auDitherTile() {
  let t = WORK.auDither;
  if (t) return t;
  t = WORK.auDither = document.createElement("canvas"); t.width = t.height = 128;
  const x = t.getContext("2d"), d = x.createImageData(128, 128);
  let s = 90211;
  for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = (s >> 16) & 255, white = v & 1; d.data[i] = d.data[i + 1] = d.data[i + 2] = white ? 255 : 0; d.data[i + 3] = 1 + ((v >> 1) % 7); }
  x.putImageData(d, 0, 0);
  return t;
}
/** Paints the aura on x (a canvas the size of the cover's, in its units): the coarse grid drawn up, smooth; the smear's fine streaks; a dither. */
function auPaintField(x, env, p, plan, key) {
  const { w, h } = env, L = auLowField(env, p, plan, key), sm = clamp(p.smear), D = Math.sqrt(w * h);
  x.save(); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "low";   // bilinear: the lights are smooth already, and the high quality's resampling cost five times as much
  x.drawImage(L.c, L.pad, L.pad, L.W, L.H, 0, 0, w, h);
  if (sm > 0) {   // the fine streaks a light leaves passing, along the smear, in its lit parts only (overlay leaves the black)
    const ca = Math.cos(AU_SMEAR), sa = Math.sin(AU_SMEAR);
    x.globalCompositeOperation = "overlay"; x.lineCap = "round";
    for (let k = 0, n = Math.round(40 + 110 * sm); k < n; k++) {
      const px = rand(k * 2.3 + 9300) * w, py = rand(k * 3.1 + 9301) * h, len = D * (0.12 + rand(k * 4.7 + 9302) * 0.45), light = rand(k * 5.3 + 9303) > 0.4;
      x.strokeStyle = css(light ? W3 : [0, 0, 0], (light ? 0.1 + 0.18 * rand(k + 9304) : 0.08 + 0.12 * rand(k + 9305)) * sm); x.lineWidth = 0.7 + rand(k * 6.1 + 9306) ** 2 * 2.4;
      x.beginPath(); x.moveTo(px - ca * len / 2, py - sa * len / 2); x.lineTo(px + ca * len / 2, py + sa * len / 2); x.stroke();
    }
  }
  x.restore();
  if (canPaint(x)) inPixels(x, () => { x.globalCompositeOperation = "source-over"; x.fillStyle = x.createPattern(auDitherTile(), "repeat"); x.fillRect(0, 0, x.canvas.width, x.canvas.height); });
}
/**
 * The aura on a canvas the size of ctx's, painted with its transform: kept per canvas size (keptLayer) while all it
 * is painted from holds; on a canvas too large to keep for (an export's), painted once on a work canvas of its own,
 * let go after the cover (see auLetGo). Returns that canvas.
 */
function auField(ctx, env, p, plan) {
  const key = auFieldKey(env, p, plan), kept = keptLayer(ctx, "auField", key, (x) => auPaintField(x, env, p, plan, key));
  if (kept) return kept;
  const cv = ctx.canvas, m = ctx.getTransform(), full = `${[m.a, m.b, m.c, m.d, m.e, m.f].join()}|${key}`, c = WORK.auFieldX || (WORK.auFieldX = document.createElement("canvas"));
  if (c._key === full && c.width === cv.width && c.height === cv.height) return c;
  c.width = cv.width; c.height = cv.height;
  const x = c.getContext("2d"); x.setTransform(m); auPaintField(x, env, p, plan, key); c._key = full;
  return c;
}
// ====================================================================== where things go
/**
 * The boxes the scene and the micro-type keep off: the title as it will be set (with its subtitle), the corner tag, the
 * channel graphic (keepClear), and the brand row, its logo and the channel name where they show.
 */
function auKeep(ctx, env) {
  const out = canPaint(ctx) ? keepClear(ctx, env) : keepOthers(env), { w } = env, on = (id) => env.cover && env.cover.layers.some((l) => l.id === id && l.visible);
  if (env.hasBrand) out.push({ x: 0, y: 0, w, h: 132 });
  if (env.logo) out.push({ x: env.logo.x - 20, y: env.logo.y - 20, w: env.logo.w + 40, h: env.logo.h + 40 });
  const c = env.G && env.G.cat;
  if (c && on("catname")) out.push({ x: c.x - 16, y: c.y - c.fs * 1.1, w: (c.maxW || 600) + 32, h: c.fs * 1.5 });
  return out;
}
/** The box round the colour block where it shows (the frosted pane lies over the scene: what stands half under it is cut by its edge), or null. */
function auBlock(env) {
  const A = env.G && env.G.accent, on = env.cover && env.cover.layers.some((l) => l.type === "accent" && l.visible);
  if (!A || !on) return null;
  const xs = A.map((q) => q[0]), ys = A.map((q) => q[1]), x = Math.min(...xs), y = Math.min(...ys);
  return { x: x - 24, y: y - 24, w: Math.max(...xs) - x + 48, h: Math.max(...ys) - y + 48 };
}
/** Whether the colour block's edge, where it shows, runs through box b (with a margin): small print is kept off it. */
function auOnEdge(env, b) {
  const E = env.G && env.G.edge, on = env.cover && env.cover.layers.some((l) => l.type === "accent" && l.visible);
  if (!E || !on) return false;
  const [ax, ay, bx, by] = E.line, m = 14;
  for (let i = 0; i <= 48; i++) { const x = ax + ((bx - ax) * i) / 48, y = ay + ((by - ay) * i) / 48; if (x > b.x - m && x < b.x + b.w + m && y > b.y - m && y < b.y + b.h + m) return true; }
  return false;
}
/**
 * The first place for a box bw × bh within F (x0, y0, x1, y1) clear of `boxes`, of a 17 × 13 grid of places across F
 * (fine enough to find the strip between the words and the colour block), the nearest to `want` [x, y]: its middle
 * { x, y }, or null when none is clear.
 */
export function auSpot(F, boxes, bw, bh, want) {
  if (F.x1 - F.x0 < bw || F.y1 - F.y0 < bh) return null;
  let best = null;
  for (let j = 0; j < 13; j++) for (let i = 0; i < 17; i++) {
    const x = F.x0 + bw / 2 + ((F.x1 - F.x0 - bw) * i) / 16, y = F.y0 + bh / 2 + ((F.y1 - F.y0 - bh) * j) / 12, b = { x: x - bw / 2, y: y - bh / 2, w: bw, h: bh };
    if (boxes.some((q) => overlaps(q, b))) continue;
    const d = Math.hypot(x - want[0], y - want[1]);
    if (!best || d < best.d) best = { x, y, d };
  }
  return best && { x: best.x, y: best.y };
}
/** How much of box b lies over box q: the area they share. */
const auOver = (q, b) => Math.max(0, Math.min(q.x + q.w, b.x + b.w) - Math.max(q.x, b.x)) * Math.max(0, Math.min(q.y + q.h, b.y + b.h) - Math.max(q.y, b.y));
/**
 * Where a part goes, never nowhere: of `sizes` ([bw, bh] each, largest first) and, for each, the 17 × 13 places across
 * F (see auSpot), the first size with a place clear of `hard` (the colour block: under it a part would be lost), of
 * `keep` (the words and the rest kept clear: they lie over the scene) and of `parts` (those placed before it), at the
 * clear place nearest `want`; with none, of every size, the place reaching least past F and under `hard`, then least
 * behind `keep`, then least over `parts` (over one, it still shows), then the nearest. { x, y, i (the size's index) }.
 */
export function auBest(F, sizes, hard, keep, parts, want) {
  const sum = (L, x0, y0, x1, y1) => { let s = 0; for (const q of L) { const ox = Math.min(q.x + q.w, x1) - Math.max(q.x, x0), oy = Math.min(q.y + q.h, y1) - Math.max(q.y, y0); if (ox > 0 && oy > 0) s += ox * oy; } return s < 0.5 ? 0 : s; };   // a touch is not an overlap
  let best = null;
  for (let i = 0; i < sizes.length; i++) {
    const [bw, bh] = sizes[i], nx = F.x1 - F.x0 - bw, ny = F.y1 - F.y0 - bh, past = Math.max(0, -nx) * bh + Math.max(0, -ny) * bw;   // too large for F: in its middle, past its edges by so much
    let near = null;
    for (let j = 0; j < (ny > 0 ? 13 : 1); j++) for (let k = 0; k < (nx > 0 ? 17 : 1); k++) {
      const x = nx > 0 ? F.x0 + bw / 2 + (nx * k) / 16 : (F.x0 + F.x1) / 2, y = ny > 0 ? F.y0 + bh / 2 + (ny * j) / 12 : (F.y0 + F.y1) / 2, x0 = x - bw / 2, y0 = y - bh / 2, x1 = x0 + bw, y1 = y0 + bh;
      const a = past + sum(hard, x0, y0, x1, y1);
      if (best && a > best.a) continue;   // worse already: the rest need not be counted
      const b = sum(keep, x0, y0, x1, y1);
      if (best && a === best.a && b > best.b) continue;
      const c = sum(parts, x0, y0, x1, y1), d = Math.hypot(x - want[0], y - want[1]);
      if (!a && !b && !c) { if (!near || d < near.d) near = { x, y, i, d }; continue; }
      if (!best || a < best.a || b < best.b || c < best.c || (c === best.c && d < best.d)) best = { x, y, i, a, b, c, d };   // (a and b no worse, by the skips above)
    }
    if (near) return near;
  }
  return best;
}
/** The box round a capsule `len` long and `th` thick, turned by `ang`, its middle at (x, y). */
const capsuleBox = (x, y, len, th, ang) => { const r = th / 2, hw = (len / 2 - r) * Math.abs(Math.cos(ang)) + r, hh = (len / 2 - r) * Math.abs(Math.sin(ang)) + r; return { x: x - hw, y: y - hh, w: hw * 2, h: hh * 2 }; };
const AU_WHERE = new Map();   // where the capsule and the cube stand, by all it is found from: the last few
/**
 * Where the capsule and the cube stand on a w × h cover, each at its largest (the sliders size them there: see auPlan),
 * off the colour block (`block`), clear of `keep` where it can be, the capsule as near the free room's middle as it can
 * be — as large as there is room for, lying flatter where the room is low — the cube across from it, clear of the
 * capsule's room too: { cap { x, y, ang, s (its share of its largest), box }, cube { x, y, s } }. Kept for the last few
 * covers (it is asked for twice or three times a repaint).
 */
function auWhere(F, block, keep, room, w, h) {
  const key = JSON.stringify([F, block, keep, room, w, h, seed]), got = AU_WHERE.get(key);
  if (got) return got;
  const u = Math.min(w, h), hard = block ? [block] : [], tilt = -0.5 + (rand(9401) - 0.5) * 0.3, ways = [1, 0.84, 0.7, 0.56, 0.46].flatMap((s) => [[s, tilt], [s, tilt * 0.4]]), L1 = u * 0.66;
  const ca = auBest(F, ways.map(([s, ang]) => { const b = capsuleBox(0, 0, L1 * s, L1 * s * 0.43, ang); return [b.w + 20, b.h + 20]; }), hard, keep, [], [room.x, room.y]), [cs, ang] = ways[ca.i];
  const cap = { x: ca.x, y: ca.y, ang, s: cs, box: capsuleBox(ca.x, ca.y, L1 * cs, L1 * cs * 0.43, ang) };
  const K = [1, 0.82, 0.66, 0.54, 0.44], S1 = u * 0.56, cb = auBest(F, K.map((s) => [S1 * s * 1.36 + 20, S1 * s * 1.36 + 20]), hard, keep, [cap.box], [w - ca.x, ca.y < h / 2 ? h * 0.66 : h * 0.34]);
  const out = { cap, cube: { x: cb.x, y: cb.y, s: K[cb.i] } };
  AU_WHERE.set(key, out);
  if (AU_WHERE.size > 8) AU_WHERE.delete(AU_WHERE.keys().next().value);
  return out;
}
/**
 * Where everything goes on this cover: { T (the title's box, see titleArea), keep (see auKeep), room (the free room's
 * middle, away from the title), cap (where the capsule stands, on or not: see auWhere), orb, cube, ribbon, orbit }. The
 * capsule and the cube stand where auWhere puts them at their largest — off the colour block, clear of the words, the
 * tag and the graphic where there is room and behind them where there is none, never left out — and their sliders size
 * them there; the ribbon falls and the orbits turn through where the capsule stands. Each is moved by its scene offset
 * after, so a drag moves nothing else.
 */
export function auPlan(ctx, env, p) {
  const { w, h } = env, u = Math.min(w, h), T = canPaint(ctx) ? titleArea(ctx, env) : null, keep = auKeep(ctx, env), block = auBlock(env);
  const F = { x0: 40, y0: env.hasBrand ? 136 : 40, x1: w - 40, y1: h - 40 };
  const tc = T ? [T.x + T.w / 2, T.y + T.h / 2] : [w * 0.32, h * 0.5], want = [tc[0] < w * 0.5 ? w * 0.74 : w * 0.26, tc[1] < h * 0.5 ? h * 0.62 : h * 0.38];
  const room = auSpot(F, block ? [...keep, block] : keep, u * 0.3, u * 0.3, want) || auSpot(F, keep, u * 0.3, u * 0.3, want) || auSpot(F, keep, u * 0.16, u * 0.16, want) || { x: want[0], y: want[1] };
  const { cap, cube } = auWhere(F, block, keep, room, w, h);
  const out = { T, keep, room, cap, orb: null, cube: null, ribbon: null, orbit: null };
  if (p.orb > 0) { const [x, y] = objAt("orb", cap.x, cap.y, ctx), len = u * (0.26 + 0.4 * p.orb) * cap.s; out.orb = { x, y, len, th: len * 0.43, ang: cap.ang }; }
  if (p.cube > 0) { const [x, y] = objAt("cube", cube.x, cube.y, ctx); out.cube = { x, y, s: u * (0.24 + 0.32 * p.cube) * cube.s }; }
  if (p.ribbon > 0) {   // down the whole height, through where the capsule stands; moved across only
    const [x] = objAt("ribbon", cap.x + (cap.x > w / 2 ? -1 : 1) * u * 0.06, h * 0.5, ctx, "x");
    out.ribbon = { x, wid: u * (0.08 + 0.1 * p.ribbon), amp: u * 0.13, n: Math.round(34 + 46 * p.ribbon), turns: 0.75 + rand(9410) * 0.35, ph: rand(9411), ph2: rand(9412), a: clamp(p.ribbon * 2.5) };
  }
  if (p.orbit > 0) {   // about where the capsule stands
    const [x, y] = objAt("orbit", cap.x, cap.y, ctx);
    out.orbit = { x, y, rx: Math.max(w, h) * 0.34 * (0.6 + 0.55 * p.orbit), ang: -0.2 + (rand(9420) - 0.5) * 0.16, n: p.orbit > 0.7 ? 3 : p.orbit > 0.35 ? 2 : 1, a: clamp(p.orbit * 3) };
  }
  return out;
}
// ====================================================================== the scene
/**
 * Paints draw(c) so that within the boxes `cut` (with a margin) only `keepA` of it shows: the line work breaking off round
 * the words. Clipped, not cut from a canvas of its own: outside every box (a clip a box, each laid on the last, so where
 * boxes overlap the line is out of both), then within them all at keepA.
 */
function auKnocked(ctx, cut, keepA, draw) {
  if (!cut.length) return draw(ctx);
  const grown = cut.map((b) => ({ x: b.x - 18, y: b.y - 18, w: b.w + 36, h: b.h + 36 })), F = 1e5;
  ctx.save();
  for (const b of grown) { ctx.beginPath(); ctx.rect(-F, -F, 3 * F, 3 * F); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip("evenodd"); }
  draw(ctx); ctx.restore();
  if (keepA <= 0) return;
  ctx.save(); ctx.beginPath(); for (const b of grown) ctx.rect(b.x, b.y, b.w, b.h); ctx.clip(); ctx.globalAlpha *= keepA; draw(ctx); ctx.restore();
}
/**
 * The glass capsule, a thick glass: its edge shows the aura behind it turned about its middle and magnified (the
 * refraction), its core a deeper light with a bright band through it and glitter in it, a soft rim of light inside its
 * edge, the edge itself bright where it faces the light, a long specular streak along its top; its own light round it
 * on the night, a soft shadow on the pale ground.
 */
function auOrb(ctx, O, field, S, onDark, w, h) {
  const { x, y, len, th, ang } = O, r = th / 2, hi = S.hi, path = (c, i = 0) => { c.beginPath(); rounded(c, -len / 2 + i, -r + i, len - 2 * i, th - 2 * i, r - i); };
  const deep = boost(mix(hi[2], [6, 4, 30], onDark ? 0.3 : 0.12), 0.7), band = mix(hi[2], W3, onDark ? 0.5 : 0.6);
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const glow = (colour, a, dy) => {   // an oval of soft light round it (a gradient: a shadow blur this wide is dear)
    const R = (len + th) * 0.62, g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, css(colour, a)); g.addColorStop(0.5, css(colour, a * 0.55)); g.addColorStop(1, css(colour, 0));
    ctx.save(); ctx.translate(0, dy); ctx.scale(1, (th * 2) / (len + th)); ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, 2 * R); ctx.restore();
  };
  if (onDark) glow(hi[0], 0.4, 0); else glow(mix(hi[2], [20, 10, 40], 0.4), 0.24, th * 0.16);
  ctx.save(); path(ctx); ctx.clip();
  if (field) { ctx.save(); ctx.rotate(-ang + Math.PI); ctx.scale(1.6, 1.6); ctx.translate(-x, -y); ctx.imageSmoothingEnabled = true; ctx.drawImage(field, 0, 0, w, h); ctx.restore(); }
  else { ctx.fillStyle = css(hi[0]); ctx.fillRect(-len / 2, -r, len, th); }
  ctx.fillStyle = css(hi[0], onDark ? 0.28 : 0.22); ctx.fillRect(-len / 2, -r, len, th);   // the glass's own tint, strongest at its edge
  const core = ctx.createLinearGradient(0, -r, 0, r);   // the core: deep, a bright band low through it
  core.addColorStop(0, css(deep, 0.92)); core.addColorStop(0.42, css(mix(deep, band, 0.35), 0.92)); core.addColorStop(0.64, css(band, 0.95)); core.addColorStop(0.82, css(mix(band, deep, 0.5), 0.9)); core.addColorStop(1, css(deep, 0.85));
  blurred(ctx, th * 0.06, css(deep, 0.5), () => { path(ctx, th * 0.15); ctx.fill(); });
  ctx.fillStyle = core; path(ctx, th * 0.15); ctx.fill();
  ctx.fillStyle = "#fff";
  for (let k = 0; k < 110; k++) {   // glitter, thickest along the bright band
    const gx = (rand(k * 2.7 + 9500) - 0.5) * (len - th * 0.75), gy = (rand(k * 3.3 + 9501) + rand(k * 4.1 + 9502) - 1) * r * 0.5 + r * 0.22, gr = th * (0.003 + rand(k * 5.9 + 9503) ** 3 * 0.01);
    ctx.globalAlpha = 0.35 + 0.6 * rand(k + 9504); ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const [lw, c, a] of [[th * 0.4, W3, onDark ? 0.1 : 0.2], [th * 0.2, hi[0], onDark ? 0.45 : 0.35], [th * 0.07, mix(hi[0], W3, 0.5), 0.6], [th * 0.025, W3, 0.7]]) { ctx.lineWidth = lw; ctx.strokeStyle = css(c, a); path(ctx); ctx.stroke(); }   // the rim, soft inside the edge
  ctx.restore();
  const edge = ctx.createLinearGradient(-len / 2, -r, len / 2, r);   // the edge, bright toward the light
  edge.addColorStop(0, css(W3, 0.95)); edge.addColorStop(0.5, css(W3, onDark ? 0.4 : 0.55)); edge.addColorStop(1, css(onDark ? W3 : hi[2], onDark ? 0.2 : 0.5));
  ctx.lineWidth = Math.max(1.2, th * 0.009); ctx.strokeStyle = edge; path(ctx); ctx.stroke();
  ctx.lineCap = "round";
  const streak = () => { ctx.beginPath(); ctx.moveTo(-len / 2 + r * 0.95, -r * 0.62); ctx.quadraticCurveTo(-len * 0.05, -r * 0.86, len / 2 - r * 1.3, -r * 0.68); };
  blurred(ctx, th * 0.05, css(W3, 0.75), () => { ctx.lineWidth = th * 0.06; streak(); ctx.stroke(); });
  ctx.strokeStyle = css(W3, 0.92); ctx.lineWidth = th * 0.034; streak(); ctx.stroke();
  ctx.strokeStyle = css(mix(hi[0], W3, 0.3), 0.75); ctx.lineWidth = th * 0.024; ctx.beginPath(); ctx.arc(len / 2 - r, 0, r * 0.8, 0.25, 1.2); ctx.stroke();   // light caught low in the far end
  ctx.fillStyle = css(W3, 0.9); ctx.beginPath(); ctx.arc(-len / 2 + r * 0.62, -r * 0.42, th * 0.022, 0, TAU); ctx.fill();   // a glint
  ctx.restore();
}
/** A ribbon of hairlines down the cover, turning as it falls: where it turns edge-on its lines crowd into a bright fold. */
function auRibbon(ctx, R, h, S, onDark) {
  const m = 96;
  const k = ctx.getTransform().a || 1;
  ctx.save(); ctx.globalCompositeOperation = onDark ? "lighter" : "multiply"; ctx.lineWidth = Math.max(1.4, 1 / k); ctx.lineJoin = "round";
  ctx.strokeStyle = onDark ? css(W3, (0.13 + 0.09 * R.a) * R.a) : css(mix(S.hi[2], [10, 10, 40], 0.3), (0.16 + 0.12 * R.a) * R.a);
  for (let s = 0; s < R.n; s++) {
    const f = (s / (R.n - 1)) * 2 - 1;
    ctx.beginPath();
    for (let i = 0; i <= m; i++) {
      const t = i / m, ph = TAU * (t * R.turns + R.ph), c = Math.cos(ph), sn = Math.sin(ph), bend = R.amp * Math.sin(TAU * (t * 0.8 + R.ph2)) + R.amp * 0.4 * Math.sin(TAU * (t * 1.9 + R.ph));
      const px = R.x + bend + f * R.wid * c, py = -h * 0.08 + t * h * 1.16 + f * R.wid * sn * 0.3;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();
}
/** The orbits: thin ellipses about (x, y), each with a sparkle on it; `part` "back" (their far halves), "front" or both. */
function auOrbits(ctx, Or, ink, spot, part) {
  ctx.save(); ctx.lineCap = "round";
  for (let k = 0; k < Or.n; k++) {
    const rx = Or.rx * (1 - k * 0.2), ry = rx * (0.2 + k * 0.05), a = Or.ang + k * 0.24, from = part === "front" ? 0 : Math.PI, to = part === "back" ? TAU : part === "front" ? Math.PI : Math.PI * 3;
    ctx.save(); ctx.translate(Or.x, Or.y); ctx.rotate(a);
    ctx.strokeStyle = css(k === 1 ? spot : ink, (k === 2 ? 0.5 : 0.78) * Or.a); ctx.lineWidth = k === 2 ? 1.3 : 1.8; ctx.setLineDash(k === 2 ? [3, 9] : []);
    ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, from, to); ctx.stroke(); ctx.setLineDash([]);
    if (part !== "back") { const t = 0.3 + rand(9430 + k) * 0.5 + (k % 2) * 1.2, sx = Math.cos(t * Math.PI) * rx, sy = Math.sin(t * Math.PI) * ry; ctx.globalAlpha = Or.a; sparkle(ctx, sx, Math.abs(sy), 9 + 5 * (k === 0), ink, 1); ctx.globalAlpha = 1; }
    ctx.restore();
  }
  ctx.restore();
}
/** A plus mark, `r` each way. */
const auCross = (ctx, x, y, r) => { ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); };
/**
 * A cube of light: its three faces seen from above and to the left, the top lit, the front fading down into the
 * ground, the side deeper — painted on a coarse canvas and drawn up, so every edge is soft; plus marks crisp at its
 * top corners.
 */
function auCube(ctx, Q, S, onDark, ink) {
  const { x, y, s } = Q, d = s * 0.34, x0 = x - (s + d) / 2, y0 = y - (s + d) / 2 + d, pad = s * 0.3, cell = s / 20, bw = s + d + 2 * pad, bx = x0 - pad, by = y0 - d - pad;
  const n = Math.max(4, Math.ceil(bw / cell)), c = WORK.auCube || (WORK.auCube = document.createElement("canvas"));
  if (c.width !== n || c.height !== n) { c.width = c.height = n; }
  const g = c.getContext("2d"), k = n / bw, [lt, md, dp] = S.hi, top = mix(lt, W3, 0.35);
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, n, n); g.setTransform(k, 0, 0, k, -bx * k, -by * k);
  const face = (pts, fill) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.closePath(); g.fillStyle = fill; g.fill(); };
  const fg = g.createLinearGradient(0, y0, 0, y0 + s); fg.addColorStop(0, css(md, 0.95)); fg.addColorStop(0.55, css(dp, 0.75)); fg.addColorStop(1, css(dp, 0.05));
  const sg = g.createLinearGradient(0, y0 - d, 0, y0 + s); sg.addColorStop(0, css(mix(md, dp, 0.5), 0.8)); sg.addColorStop(1, css(dp, 0));
  face([[x0 + d, y0 - d], [x0 + s + d, y0 - d], [x0 + s + d, y0 + s - d], [x0 + d, y0 + s - d]], css(dp, 0.25));   // the far walls, through it
  face([[x0 + s, y0], [x0 + s + d, y0 - d], [x0 + s + d, y0 + s - d], [x0 + s, y0 + s]], sg);
  face([[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s]], fg);
  face([[x0, y0], [x0 + d, y0 - d], [x0 + s + d, y0 - d], [x0 + s, y0]], css(top, 0.92));
  ctx.save(); ctx.globalCompositeOperation = onDark ? "screen" : "source-over"; ctx.globalAlpha = onDark ? 1 : 0.88; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, bx, by, bw, bw); ctx.restore();
  ctx.save(); ctx.strokeStyle = css(ink, 0.9); ctx.lineWidth = 1.6; ctx.beginPath();
  for (const [px, py] of [[x0, y0], [x0 + s, y0], [x0 + d, y0 - d], [x0 + s + d, y0 - d]]) auCross(ctx, px, py, Math.max(9, s * 0.03));
  ctx.stroke(); ctx.restore();
}
/** The scene's key: the aura's (the capsule shows it), the plan and the sliders that shape the objects. */
const auSceneKey = (fieldKey, plan, p) => JSON.stringify([fieldKey, plan.orb, plan.cube, plan.ribbon, plan.orbit, plan.keep.map((b) => [b.x, b.y, b.w, b.h].map(Math.round))]);
/** Paints the scene on x: the cube, the ribbon, the orbits' far halves, the capsule, their near halves. */
function auPaintScene(x, env, p, plan, field) {
  const P = auPal(p), S = auSide(P), ink = auInk(), spot = auChan(env.C, dark, S.hi[0]), words = plan.T ? [plan.T] : [];
  if (plan.cube) auCube(x, plan.cube, S, dark, ink);
  if (plan.ribbon) auKnocked(x, words, 0.14, (c) => auRibbon(c, plan.ribbon, env.h, S, dark));
  const cut = plan.keep;
  if (plan.orbit) auKnocked(x, cut, 0, (c) => auOrbits(c, plan.orbit, ink, spot, plan.orb ? "back" : "all"));
  if (plan.orb) auOrb(x, plan.orb, field, S, dark, env.w, env.h);
  if (plan.orbit && plan.orb) auKnocked(x, cut, 0, (c) => auOrbits(c, plan.orbit, ink, spot, "front"));
}
// ====================================================================== the photo
/** The photo's lightness spread over its own range (the 2nd to the 98th percentile) and mapped onto a ramp (`lut`, see auLut): a thermal image of its light; mixed in by `amt`. */
export function auThermal(d, lut, amt = 1) {
  const hist = new Uint32Array(256), n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) hist[(d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const span = Math.max(24, hi - lo), map = new Uint8Array(256);
  for (let v = 0; v < 256; v++) { const t = clamp((v - lo) / span); map[v] = Math.round(255 * (t * t * (3 - 2 * t) * 0.35 + t * 0.65)); }
  const a = clamp(amt), b = 1 - a;
  for (let i = 0; i < d.length; i += 4) {
    const j = map[(d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8] * 3;
    d[i] = d[i] * b + lut[j] * a; d[i + 1] = d[i + 1] * b + lut[j + 1] * a; d[i + 2] = d[i + 2] * b + lut[j + 2] * a;
  }
}
/** A box blur of RGBA data in place, `r` px each way, twice (near enough a Gaussian). */
function auBlur(d, w, h, r) {
  if (r < 1) return;
  const t = new Float32Array(Math.max(w, h) * 4);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) blurLine(d, y * w * 4, 4, w, r, t);
    for (let x = 0; x < w; x++) blurLine(d, x * 4, w * 4, h, r, t);
  }
}
function blurLine(d, start, step, n, r, t) {
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) t[i * 4 + c] = d[start + i * step + c];
  for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += t[clamp(i, 0, n - 1) * 4 + c];
    for (let i = 0; i < n; i++) { d[start + i * step + c] = s / (2 * r + 1); s += t[Math.min(n - 1, i + r + 1) * 4 + c] - t[Math.max(0, i - r) * 4 + c]; }
  }
}
/** The photo blurred and set in two of the palette's colours, its shadows deep and its lights pale: a blurred duotone. */
export function auDuotone(d, w, h, P, onDark = dark) {
  auBlur(d, w, h, Math.max(1, Math.round(Math.max(w, h) * 0.006)));
  // its shadows deep, its middle the palette's most saturated light, its lights pale: most of it a colour white lettering reads on
  const S = auSide(P, true), sat = boost(S.hi[2], 0.8), lo = mix(sat, [0, 0, 0], onDark ? 0.62 : 0.45), hi = mix(S.hi[0], W3, 0.25);
  auThermal(d, toneTable([[0, lo], [0.62, sat], [1, hi]]), 1);
}
/** Light spilling from the picture: a soft copy of what ctx holds screened over it. */
function auBloom(ctx, amt) {
  const soft = softCopy(ctx.canvas, 22, "auBloom"), cv = ctx.canvas;
  inPixels(ctx, () => { ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.7 * amt; ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
}
/** What ctx holds smeared along the look's angle, laid over it: the picture as a light passing. */
function auPhotoSmear(ctx, amt) {
  const src = softCopy(ctx.canvas, 3, "auSmearS"), len = src.width * 0.12 * amt, cv = ctx.canvas;
  auSmearOn(src, len, AU_SMEAR, "auSmearP");
  inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.85 * amt; ctx.drawImage(src, 0, 0, cv.width, cv.height); ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.25 * amt; ctx.drawImage(src, 0, 0, cv.width, cv.height); });
}
// ====================================================================== grain, and letting go
/**
 * A tile of film grain: noise about the middle grey, its spread triangular (most of it near the middle, a few strong
 * specks), skewed for the ground — on the night (`lift`) it reaches far above the middle and little below, so laid in
 * hard light it grains the blacks and leaves white lettering clean; on the pale ground the other way, flecking it dark.
 * 256 px drawn `sc` times as large, kept per scale — so it is laid unscaled (a pattern drawn scaled is resampled pixel
 * by pixel as it is laid: three times the cost).
 */
function auGrainTile(sc = 1, lift = true) {
  const slot = lift ? "auGrain" : "auGrainK";
  let t = WORK[slot];
  if (!t) {
    t = WORK[slot] = document.createElement("canvas"); t.width = t.height = 256;
    const x = t.getContext("2d"), d = x.createImageData(256, 256);
    let s = 4411;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff; const a = (s >> 16) & 255; s = (s * 1103515245 + 12345) & 0x7fffffff; const b = (s >> 16) & 255;
      const v = (a + b - 255) * 0.55, up = lift ? v > 0 : v < 0;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 128 + v * (up ? 1 : 0.28); d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
  }
  const n = Math.round(256 * sc);
  if (n <= 256) return t;
  const kept = WORK[slot + "S"] || (WORK[slot + "S"] = document.createElement("canvas"));
  if (kept.width !== n || kept._of !== t) { kept.width = kept.height = n; kept._of = t; const g = kept.getContext("2d"); g.imageSmoothingEnabled = true; g.drawImage(t, 0, 0, n, n); }
  return kept;
}
/**
 * Fine film grain over the whole cover, in one pass: the grey noise laid in hard light, which darkens where it is below
 * the middle grey and screens where it is above — so the blacks are grained too (overlay would leave them black), and
 * the pale ground flecked dark.
 */
function auGrain(ctx, amount, unit) {
  if (amount <= 0 || !canPaint(ctx)) return;
  const pt = ctx.createPattern(auGrainTile(Math.round(Math.max(1, unit * 1.05) * 8) / 8, dark), "repeat");   // the grain keeps its size on big exports
  inPixels(ctx, () => { ctx.globalCompositeOperation = "hard-light"; ctx.globalAlpha = Math.min(1, amount * (dark ? 0.55 : 0.45)); ctx.fillStyle = pt; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); });
}
/** Every work canvas the look keeps (keptLayer's maps among them). */
const AU_WORK = ["auField", "auScene", "auFieldX", "auCube", "auSmearT", "auSmearP", "auSmearS", "auSmearSm", "auBloom", "auBloomm", "auPaneSoft", "auPaneSoftm", "auDither", "auGrain", "auGrainS", "auGrainK", "auGrainKS", "auLine"];
/** The work canvases sized to an export's canvas, or a share of it (larger than any kept for), let go once it is painted. */
function auLetGo(ctx) {
  if (!canPaint(ctx) || ctx.canvas.width * ctx.canvas.height <= 6e6) return;
  for (const k of ["auFieldX", "auBloomm", "auPaneSoftm", "auSmearS", "auSmearSm", "auSmearP"]) if (WORK[k] && !(WORK[k] instanceof Map)) WORK[k].width = WORK[k].height = 0;
}
/** Lets go everything the look keeps (as another look is chosen). */
export function auFreeAll() {
  for (const e of AU_LOW.values()) e.c.width = e.c.height = 0;
  AU_LOW.clear(); AU_WHERE.clear();
  for (const k of AU_WORK) {
    const v = WORK[k];
    if (!v) continue;
    if (v instanceof Map) for (const e of v.values()) e.c.width = e.c.height = 0;
    else v.width = v.height = 0;
    delete WORK[k];
  }
}
/** What the look keeps, in bytes (for checks): the coarse grids and every work canvas. */
export function auMemory() {
  let bytes = 0;
  for (const e of AU_LOW.values()) bytes += e.c.width * e.c.height * 4;
  for (const k of AU_WORK) { const v = WORK[k]; if (!v) continue; if (v instanceof Map) for (const e of v.values()) bytes += e.c.width * e.c.height * 4; else bytes += v.width * v.height * 4; }
  return bytes;
}
// ====================================================================== the look
const AU_TRACK = 1.36;   // the spaced capitals: each glyph set apart by this share of its width, the line drawn that much smaller
export const aura = {
  id: "aura",
  repaint: (c) => `a contemporary Swiss gradient poster made from the photograph: the subject as a thermal-camera image of its light (deep blue, violet, magenta, red, orange, yellow) glowing softly on black, out-of-focus aura light melting around it, a little motion blur, a heavy fine film grain, with ${c} among the colours; still the same picture, no text.`,
  about: {
    zh: "光晕渐变：当代瑞士渐变海报——大团失焦的光晕在画面里相互交融（浅白紫底上的粉、淡紫、矢车菊蓝和电光蓝，或黑底上发光的饱和色），可换电光蓝、黑底青光、黑底炽红、热成像（蓝→紫→品红→红→橙→黄）和全息虹彩几套调色，频道色化作其中一团光；一枚折射着光晕、边缘高光的玻璃胶囊，一条由许多细白线折叠成的半透明线带，几道细细的轨道椭圆和星芒，动态拖影把光拉成光带，还可加一个发光的光立方；整张覆着细密的胶片颗粒。边框是瑞士式的微排版：四角十字准星、字距很开的小标签、细线、带圆点的引线和一个小小的编号。标题是白色（浅底为近黑）的无衬线体，可设成宽字距；强调词以调色板的渐变发光。照片会变成热成像般的光谱图并带柔和光晕，或模糊的双色调。深浅两种底色——适合音乐、设计、科技、艺术、播客和潮流内容。",
    en: "Aura gradient: the contemporary Swiss gradient poster — big out-of-focus lights melting into one another (pink, lilac, cornflower and electric blue on a pale white-lilac ground, or saturated and glowing on black), with palettes for electric blue, cyan on black, warp red on black, a thermal camera's ramp (blue, violet, magenta, red, orange, yellow) and a holographic rainbow, the channel colour one of the lights; a glass capsule refracting the aura with a bright rim, a translucent ribbon of fine white lines folding through space, thin orbits with a sparkle, a motion smear drawing the lights into streaks and a cube of light if you like; a strong fine film grain over all of it. The frame is Swiss micro-typography: crosshairs in the corners, tiny widely spaced labels, hairlines, a leader with a dot and a small index number. The title is a white grotesk (near black on the pale ground), widely spaced if you like; highlighted words glow in a gradient of the palette. A photo becomes a thermal image of its light with a soft glow, or a blurred duotone. Dark and light grounds — for music, design, tech, art, podcasts and fashion.",
  },
  name: { zh: "光晕渐变", en: "Aura gradient" },
  seeded: true,
  scene: { orb: { zh: "玻璃胶囊", en: "Glass capsule" }, ribbon: { zh: "细线光带", en: "Line ribbon" }, orbit: { zh: "轨道线", en: "Orbits" }, cube: { zh: "光立方", en: "Cube of light" } },
  params: [
    { key: "palette", min: 0, max: 5, step: 1, def: 0, name: { zh: "调色（暮光·电光蓝·青光·炽红·热成像·虹彩）", en: "Palette (dusk, electric, cyan, warp, thermal, holo)" } },
    { key: "aura", min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "光晕", en: "Aura light" } },
    { key: "flow", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "液态流动", en: "Liquid flow" } },
    { key: "smear", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "动态拖影", en: "Motion smear" } },
    { key: "chan", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "频道色光", en: "Channel-colour light" } },
    { key: "orb", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "玻璃胶囊", en: "Glass capsule" } },
    { key: "ribbon", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "细线光带", en: "Line ribbon" } },
    { key: "orbit", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "轨道线", en: "Orbits" } },
    { key: "cube", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光立方", en: "Cube of light" } },
    { key: "details", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "瑞士微排版", en: "Swiss details" } },
    { key: "spaced", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "标题宽字距", en: "Widely spaced title" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "thermal", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片热成像", en: "Photo in thermal" } },
    { key: "glow", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "照片光晕", en: "Photo glow" } },
    { key: "duo", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "照片改为模糊双色", en: "Photo as a blurred duotone" } },
  ],
  titleFont: () => auFace(),
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.3, strip: 0.1 }),
  leave: auFreeAll,   // the aura's grids, each size's aura and scene, the work canvases go as another look is chosen
  theme: (base, C, p) => { const g = auSide(auPal(p)).ground, ink = auInk(); return { ...base, field: css(g), text: css(ink), own: css(ink), dim: css(ink, 0.6), titleFill: css(ink), titleInk: css(g), grid: () => css(ink, dark ? 0.09 : 0.075) }; },
  /**
   * The ground: the aura, worked out on a coarse grid and drawn up smooth (kept while what it is painted from holds),
   * held readable under the title. Then the scene: a cube of light, a ribbon of hairlines, orbits, the glass capsule.
   * A photo is mapped onto the palette's thermal ramp (or blurred into a duotone), with a soft glow and the smear.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, P = auPal(p), S = auSide(P);
    if (env.photo) {
      const duo = p.duo > 0;
      if (duo) env.drawPhoto(0, { key: `auDuo|${P.id}|${dark ? 1 : 0}`, fn: (d, pw, ph) => auDuotone(d, pw, ph, P, dark) });
      else if (p.thermal > 0) { const amt = Math.round(p.thermal * 20) / 20; env.drawPhoto(0, { key: `auHeat|${P.id}|${amt}`, fn: (d) => auThermal(d, auLut(auPhotoRamp(P)), amt) }); }
      else env.drawPhoto();
      if (!fast && canPaint(ctx)) { if (p.glow > 0) auBloom(ctx, p.glow); if (p.smear > 0) auPhotoSmear(ctx, p.smear); }
      return true;
    }
    if (L.ground !== false) {   // the ground: its colour and the aura on it
      ctx.fillStyle = css(S.ground); ctx.fillRect(0, 0, w, h);
      if (canPaint(ctx) && p.aura > 0) { const plan = auPlan(ctx, env, p), c = auField(ctx, env, p, plan); inPixels(ctx, () => ctx.drawImage(c, 0, 0)); }
    }
    if (!L.grid) return true;
    if (!(p.orb > 0 || p.ribbon > 0 || p.orbit > 0 || p.cube > 0)) return true;
    const plan = auPlan(ctx, env, p);   // its objects' handles are noted, painted or not
    if (!canPaint(ctx)) return true;   // nothing to paint on: the parts that need a canvas are left out
    const field = plan.orb ? auField(ctx, env, p, plan) : null, fk = auFieldKey(env, p, plan);
    const kept = keptLayer(ctx, "auScene", auSceneKey(fk, plan, p), (x) => auPaintScene(x, env, p, plan, field));
    if (kept) inPixels(ctx, () => ctx.drawImage(kept, 0, 0));
    else auPaintScene(ctx, env, p, plan, field);
    return true;
  },
  /** A Swiss modular grid: hairlines every 120, a small plus at every crossing. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 120;
    gridPen(ctx, color, 2); ctx.beginPath();
    for (let x = s; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = s; y < h; y += s) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.lineWidth = 3; ctx.beginPath();
    for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) auCross(ctx, x, y, 9);
    ctx.stroke(); ctx.restore();
  },
  /** The colour block is a pane of frosted glass: what lies behind it softened, a milky wash, the channel colour's light low in it, a hairline edge. */
  accent: {
    fill: () => "rgba(0,0,0,0)", tone: () => "rgba(0,0,0,0)", toneScale: 0,
    body(ctx, box, nx, ny, C, p) {
      const S = auSide(auPal(p)), spot = mix(auChan(C, dark, S.hi[0]), S.hi[0], 0.45), R = Math.max(box.w, box.h);   // the channel colour's light, taken toward the palette's so it glows rather than muddies
      if (canPaint(ctx)) {   // what lies behind, softened: drawn up over the pane's own box only (laying it over the whole canvas, clipped, cost as much as the canvas)
        const soft = softCopy(ctx.canvas, 10, "auPaneSoft"), cv = ctx.canvas, m = ctx.getTransform(), f = soft.width / cv.width;
        const pts = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
        const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[0])))), y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q[1])))), x1 = Math.min(cv.width, Math.ceil(Math.max(...pts.map((q) => q[0])))), y1 = Math.min(cv.height, Math.ceil(Math.max(...pts.map((q) => q[1]))));
        if (x1 > x0 && y1 > y0) inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, x0 * f, y0 * f, (x1 - x0) * f, (y1 - y0) * f, x0, y0, x1 - x0, y1 - y0); });
      }
      if (dark) { ctx.fillStyle = css(S.ground, 0.32); ctx.fillRect(box.x, box.y, box.w, box.h); }   // smoked glass on the night, milky on the pale ground
      ctx.fillStyle = css(W3, dark ? 0.04 : 0.34); ctx.fillRect(box.x, box.y, box.w, box.h);
      const g = ctx.createRadialGradient(box.x + box.w * 0.78, box.y + box.h * 0.9, 0, box.x + box.w * 0.78, box.y + box.h * 0.9, R * 0.75);
      g.addColorStop(0, css(spot, dark ? 0.5 : 0.36)); g.addColorStop(1, css(spot, 0));
      ctx.fillStyle = g; ctx.fillRect(box.x, box.y, box.w, box.h);
    },
    edge(ctx, run, nx, ny, C) { ctx.lineCap = "butt"; ctx.strokeStyle = css(auInk(), 0.85); ctx.lineWidth = 2; run(0, 0); ctx.strokeStyle = css(auChan(C), 0.9); ctx.lineWidth = 2; run(-nx * 9, -ny * 9); },
  },
  /**
   * A white grotesk on the night, near black on the pale ground, upright; a soft halo of the ground behind it (the shadow
   * slider) so it holds over the light; highlighted words in a gradient of the palette, glowing on the night. Widely
   * spaced, each glyph is set apart and the line drawn that much smaller, in a lighter weight.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, S = auSide(auPal(p)), ink = o.fill || auInk(), s = Math.min(2, o.shadowAmt || 0), T = p && p.spaced ? AU_TRACK : 1, glowOn = canPaint(ctx) && !fast;
    let chars = null;
    if (T > 1) {   // tracked: the glyphs in a lighter weight, one even gap between every two, the line as long as it was set (drawn 1/T as large, T times as long)
      chars = []; let L0 = 0, x0 = null;
      pass((a, at) => { if (x0 === null) x0 = at; for (const t of a.t) { L0 += ctx.measureText(t).width; chars.push({ t, hi: a.hi, s: a.s, dy: (a.dy || 0) * T, of: a.run || null }); } });
      ctx.scale(1 / T, 1 / T);
      ctx.font = ctx.font.replace(/\b(900|800|700|bold|bolder)\b/, "500");
      let L1 = 0;
      for (const c of chars) inPiece(c, () => { c.w = ctx.measureText(c.t).width; L1 += c.w; });
      const g = Math.max(0, (L0 * T - L1) / Math.max(1, chars.length - 1)), runs = new Map();
      let cx = (x0 || 0) * T;
      for (const c of chars) { c.x = cx; cx += c.w + g; if (c.of) { const r = runs.get(c.of) || { x0: c.x, x1: c.x }; r.x1 = c.x + c.w; runs.set(c.of, r); } }
      for (const c of chars) c.run = c.of ? runs.get(c.of) : null;   // a highlighted run's gradient across the run as tracked
    }
    const each = (fn, only) => {
      if (chars) { for (const c of chars) if (only === undefined || !!c.hi === only) inPiece(c, () => fn(c, c.x)); }
      else pass((a, x) => { if (only === undefined || !!a.hi === only) fn(a, x); });
    };
    const hiFill = (a, x) => {
      if (o.hi) return css(o.hi);
      const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width }, g = ctx.createLinearGradient(r.x0, 0, r.x1, 0);
      S.hi.forEach((c, i) => g.addColorStop(i / (S.hi.length - 1), css(auLegible(c))));
      return g;
    };
    // what the letters throw round them, each as one soft shadow of the line's letters painted on a canvas of its own (a shadow letter by letter, tracked, cost a blur a letter)
    let len = 0;
    if (glowOn) each((a, x) => { len = Math.max(len, x + ctx.measureText(a.t).width); });
    const B = glowOn ? dkBox(ctx, fs, len) : null;
    const halo = (only, colour, r, mode) => {
      if (!B) return;
      const M = dkWork(ctx, "auLine", B);
      M.fillStyle = "#fff"; let any = false;
      each((a, x) => { M.fillText(a.t, x, 0); any = true; }, only);
      if (!any) return;
      inPixels(ctx, () => { const D = B.x0 + B.w + 40; ctx.globalCompositeOperation = mode; ctx.shadowColor = colour; ctx.shadowBlur = r * B.k; ctx.shadowOffsetX = D; ctx.drawImage(M.canvas, B.x0 - D, B.y0); });
    };
    if (s > 0) halo(undefined, css(dark ? mix(S.ground, [0, 0, 0], 0.4) : W3, dark ? 0.5 : 0.6), fs * 0.13 * s, "source-over");   // a soft halo of the ground, so they hold over the light
    if (dark) halo(true, css(o.hi || S.hi[1], 0.7), fs * 0.3, "screen");   // the highlighted words glow
    each((a, x) => { ctx.fillStyle = css(ink); ctx.fillText(a.t, x, 0); }, false);
    each((a, x) => { ctx.fillStyle = hiFill(a, x); ctx.fillText(a.t, x, 0); }, true);
  },
  // the small parts in the lettering's colour (they stand on glass or on the ground); graphics in the palette's light
  wrap: (ctx, C, p, plates) => {
    const ink = auInk(), S = auSide(auPal(p));
    return plates ? mapped(ctx, { fill: { ink }, stroke: { ink } })
      : mapped(ctx, { fill: { ink: dark ? [18, 16, 40] : [24, 22, 44], light: W3, mid: mix(W3, S.hi[1], 0.45), dark: mix(S.ground, S.hi[2], 0.35), colour: (c) => (dark ? boost(c, 0.6) : c) }, stroke: { ink: dark ? [18, 16, 40] : [24, 22, 44], light: W3 }, line: 0.6 });
  },
  sticker: painters({ line: null, shadow(ctx, draw, fill) { ctx.save(); ctx.globalAlpha = dark ? 0.6 : 0.3; ctx.shadowColor = dark ? fill : "rgba(60,40,120,0.6)"; ctx.shadowBlur = 26; draw(dark ? fill : "rgba(60,40,120,0.25)"); ctx.restore(); } }),
  /** The corner tag: spaced capitals in a hairline pill of frosted glass, a dot of the channel colour before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.46, col = auInk();
    ctx.font = `500 ${f}px ${auFace()}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, f * 0.22) + f * 2.7, h = f * 2.1, top = y + (fs * 1.34 - h);
    ctx.fillStyle = dark ? css(auSide(auPal(p)).ground, 0.42) : css(W3, 0.5); ctx.beginPath(); rounded(ctx, x, top, w, h, h / 2); ctx.fill();   // smoked glass on the night, milky on the pale ground: it reads on any light
    ctx.strokeStyle = css(col, 0.85); ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = css(auChan(C)); ctx.beginPath(); ctx.arc(x + f * 1.02, top + h / 2, f * 0.26, 0, TAU); ctx.fill();
    ctx.fillStyle = ink || css(col); spaced(ctx, str, x + f * 1.7, top + h * 0.5 + f * 0.36, f * 0.22);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /**
   * The frame layer: Swiss micro-typography, more of it as its slider rises — plus marks in the corners; a small
   * index (the channel's number) in the corner; a column of spaced labels and values between hairlines, a dot at its
   * head; a leader from the glass capsule to its label; a line of small capitals up the edge. Each at the first of its
   * places clear of the words, the tag, the graphic, the brand row, the panel's edge and one another, else at the one
   * reaching least over them, on the canvas: none left out (they are marks over the picture).
   */
  frame(ctx, env, p) {
    const a = p.details;
    if (a <= 0) return;
    const { w, h, C } = env, u = Math.min(w, h), k = clamp(u / 1080, 0.7, 1.35), ink = auInk(), P = auPal(p), o = env.o || {}, prof = o.profile || { brand: {}, categories: [] }, i = o.catIndex || 0, cat = env.cat || {};
    const keep = auKeep(ctx, env), fade = (t) => clamp((a - t) / 0.12), m = 36;
    ctx.save(); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    ctx.strokeStyle = css(ink, 0.8 * fade(0)); ctx.lineWidth = 1.6; ctx.beginPath();
    for (const [x, y] of [[m, m], [w - m, m], [m, h - m], [w - m, h - m]]) auCross(ctx, x, y, 10 * k);
    ctx.stroke();
    const on = (b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w && b.y + b.h <= h, taken = [];
    const free = (b) => on(b) && !auOnEdge(env, b) && !keep.some((q) => overlaps(q, b)) && !taken.some((q) => overlaps(q, b));
    // how much a place reaches over what it would rather keep clear of (off the canvas worst of all); of a piece's places the first free one, else the one reaching least
    const cost = (b) => (on(b) ? 0 : 1e12) + (auOnEdge(env, b) ? b.w * b.h * 0.5 : 0) + [...keep, ...taken].reduce((t, q) => t + auOver(q, b), 0);
    const pick = (list, box = (q) => q) => list.find((q) => free(box(q))) || list.reduce((best, q) => (cost(box(q)) < cost(box(best)) ? q : best));
    if (fade(0.15) > 0) {   // the index: a dot and the channel's number
      const f = 40 * k, s = pad2(i + 1);
      ctx.font = `400 ${f}px ${auFace()}`;
      const tw = ctx.measureText(s).width + f * 0.42, b = { x: w - 62 - tw, y: h - 58 - f * 0.78, w: tw, h: f * 0.86 };
      ctx.globalAlpha = fade(0.15); ctx.fillStyle = css(ink); ctx.fillText(s, b.x + f * 0.42, h - 58);
      ctx.beginPath(); ctx.arc(b.x + f * 0.13, h - 58 - f * 0.11, f * 0.13, 0, TAU); ctx.fill(); taken.push(b);
    }
    const small = 12.5 * k, lead = 19 * k, sp = small * 0.24;
    ctx.font = `500 ${small}px ${auFace()}`;
    if (fade(0.3) > 0) {   // the column of labels and values
      const size = o.size ? `${o.size.w} × ${o.size.h}` : `${w} × ${h}`, total = (prof.categories || []).length || 1, hue = Math.round(dkHsl(C)[0]);
      const rows = [[(prof.brand && prof.brand.name) || "AURA", ""], ["CHANNEL", cat.name || cat.code || "—"], ["N°", `${pad2(i + 1)} / ${pad2(total)}`], ["PALETTE", P.name.en], ["HUE", `${hue}°`], ["FORMAT", size]].map(([l, v]) => [String(l).toUpperCase(), String(v).toUpperCase()]);
      const lw = Math.max(...rows.map(([l]) => spacedW(ctx, l, sp))) + 26 * k, vw = Math.max(...rows.map(([, v]) => spacedW(ctx, v, sp))), bw = lw + vw, bh = rows.length * lead + lead * 0.9;
      const top = env.hasBrand ? 156 : 64;
      const box = ([x, y]) => ({ x: x - 4, y: y - 4, w: bw + 8, h: bh + 8 }), [x, y] = pick([[w - 64 - bw, top], [w - 64 - bw, h - 64 - bh], [64, h - 64 - bh], [64, top], [w - 64 - bw, (h - bh) / 2]], box);
      ctx.globalAlpha = fade(0.3); ctx.fillStyle = css(ink, 0.88); ctx.strokeStyle = css(ink, 0.6); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x + small * 0.9, y + 0.5); ctx.lineTo(x + bw, y + 0.5); ctx.moveTo(x, y + bh); ctx.lineTo(x + bw, y + bh); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + small * 0.3, y + 0.5, small * 0.3, 0, TAU); ctx.fill();
      rows.forEach(([l, v], r) => { const yy = y + lead * (r + 1.15); ctx.fillStyle = css(ink, r ? 0.62 : 0.95); spaced(ctx, l, x, yy, sp); ctx.fillStyle = css(ink, 0.95); spaced(ctx, v, x + lw, yy, sp); });
      taken.push(box([x, y]));
    }
    if (fade(0.5) > 0 && p.orb > 0 && !env.photo) {   // a leader from the capsule to its label (a background photo covers the capsule)
      const plan = auPlan(ctx, env, p), O = plan.orb;
      if (O) {
        const label = `FIG. ${pad2(i + 1)} — ${String(cat.name || cat.code || P.name.en).toUpperCase()}`, lw = spacedW(ctx, label, sp), len = u * 0.12;
        const sides = [O.x < w / 2 ? 1 : -1, O.x < w / 2 ? -1 : 1].map((side) => {
          const r = O.th / 2, ax = side * (O.len / 2 - r) * 0.55, ex = O.x + ax * Math.cos(O.ang) + r * Math.sin(O.ang), ey = O.y + ax * Math.sin(O.ang) - r * Math.cos(O.ang), lx = ex + side * len;   // a point on its upper rim
          return { ex, ey, lx, b: { x: side > 0 ? lx + 8 : lx - 8 - lw, y: ey - len * 0.45 - small * 0.75, w: lw, h: small * 1.5 } };
        }), { ex, ey, lx, b } = pick(sides, (q) => q.b);
        ctx.globalAlpha = fade(0.5); ctx.strokeStyle = css(ink, 0.75); ctx.fillStyle = css(ink); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(lx, ey - len * 0.45); ctx.stroke();
        ctx.beginPath(); ctx.arc(ex, ey, 4.2 * k, 0, TAU); ctx.fill();
        spaced(ctx, label, b.x, ey - len * 0.45 + small * 0.36, sp);
        taken.push(b);
      }
    }
    if (fade(0.65) > 0) {   // a line of small capitals up the left edge (where the edge is long enough for it)
      const line = [(prof.brand && prof.brand.name) || "", cat.name || "", P.name.en, `${seed % 1000}`].filter(Boolean).join("  —  ").toUpperCase(), lw = spacedW(ctx, line, sp * 1.6);
      if (lw < h * 0.6) { ctx.save(); ctx.globalAlpha = fade(0.65) * 0.8; ctx.fillStyle = css(ink); ctx.translate(18 + small, (h + lw) / 2); ctx.rotate(-Math.PI / 2); spaced(ctx, line, 0, 0, sp * 1.6); ctx.restore(); }
    }
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = dark ? css(auChan(C), 0.55) : "rgba(60,40,120,0.22)"; ctx.shadowBlur = 30 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = dark ? 0 : 10 * unit; },
  post(ctx, w, h, C, p, unit = 1) { auGrain(ctx, p.grain * clamp(0.4 + unit * 0.8), unit); auLetGo(ctx); },   // the grain fainter on a thumbnail, where it would be noise
  prompt: `Stickers for a contemporary Swiss gradient poster — soft, luminous, minimal — that read at a glance:
- one clear, simple object per sticker (a glass sphere, a capsule, a planet, a hand, an eye, a crystal, a soundwave, a flower), its form smooth and rounded; no realism, no fine detail;
- flat colour only, in soft luminous tones: the main colour, pink, lilac and electric blue, with "white" for highlights;
- the app adds a soft glow and no outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects for a Swiss gradient poster, built as simple models from a few boxes and cylinders — a speaker, a lamp, a pedestal, a monitor, a glass block; clean and minimal, no realism, no fine detail.
- the renderer paints faces in pale lilac, white and a deep night blue: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" a deep night blue, and "main" the channel colour as a soft light.`,
};
aura.elementFx = [
  { key: "thermal", name: { zh: "热成像", en: "Thermal map" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a thermal camera sees it: by its lightness, black, blue, violet, magenta, red, orange, yellow. */
    paint: tonesFx(() => auPhotoRamp(AU_PALETTES[4])) },
  { key: "aurafill", name: { zh: "光晕填色", en: "Aura fill" }, for: FX_ALL, stage: "fill",
    /** The layer filled with an aura of the channel colour: it and its two neighbours on the colour wheel, melting across it, a soft light at its upper corner. */
    paint(x, B, a, E) {
      const c0 = auChan(E.C, true), c1 = hueTurn(c0, -48), c2 = hueTurn(c0, 52);
      flatFx((g) => { const gr = g.createLinearGradient(B.x0, B.y1, B.x1, B.y0); gr.addColorStop(0, css(c1)); gr.addColorStop(0.5, css(c0)); gr.addColorStop(1, css(c2)); return gr; })(x, B, a, E);
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.globalAlpha = 0.55 * a;
      const R = Math.max(B.w, B.h) * 0.6, g = x.createRadialGradient(B.x0 + B.w * 0.22, B.y0 + B.h * 0.1, 0, B.x0 + B.w * 0.22, B.y0 + B.h * 0.1, R); g.addColorStop(0, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = g; x.fillRect(B.x0, B.y0, B.w, B.h); x.restore();
    } },
  { key: "glow", name: { zh: "光晕辉光", en: "Aura glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 90 * k, t: 90 * k, r: 90 * k, b: 90 * k }),
    /** Aura light round the layer: a wide haze of the channel colour's neighbour, a tighter glow of the colour itself. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), c0 = auChan(E.C, true); glowBehind(x, B, src, 36 * E.k * (0.4 + a), 0.7 * a, hueTurn(c0, 40)); glowBehind(x, B, src, 12 * E.k * (0.5 + a), Math.min(1, a * 1.5), c0); } },
  { key: "smear", name: { zh: "动态拖影", en: "Motion smear" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.w * 0.5, t: B.h * 0.3 }),
    /** The layer as a light passing: copies of it trailing back up and to the left, fading. */
    paint(x, B, a, E) { const n = Math.round(6 + 12 * a); trail(x, B, region(x, B, "fxA"), n, -B.w * 0.028 * (0.3 + a), -B.w * 0.012 * (0.3 + a), 0.25 + 0.35 * a, "destination-over"); } },
];
