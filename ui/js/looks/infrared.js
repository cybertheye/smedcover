// infrared: the ghost of an infrared photograph, read back by a machine
// Infrared and inverted black-and-white photography: foliage, skin and clouds glowing white, skies and still
// water gone dark, soft silver greys between; one blood-scarlet red the only colour — a tree's crown, a wash across
// the sky — bleeding softly into the greys. The lens's faults over it: bloom and red halation round the lights,
// colour fringes growing toward the edges, an anamorphic streak with a rainbow edge and prism light at its ends,
// the edges gone soft and swirled; a band of the picture dragged down into streaks (slit-scan); heavy fine grain;
// and a few small clusters of cyan monospace lines near the subject, as if a machine were reading the memory.
// The night version on the dark ground, the overexposed, inverted day (white-greys, a black sun) on the light one.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, blurred, boost, canPaint, clamp, css, dark, dkFogBand, fast, glowBehind, gpuCanvas, graphicShape, gridPen, inPixels, keepClear, keptLayer, letGoGpu, mapped, mix, objAt, openField, overlaps, painters, parseColour, placeShape, rand, reflectBelow, region, rePlate, role, seed, softCopy, titleArea, toneTable, upright, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { inPiece } from "../title.js";

/** The one red (a blood scarlet), the machine's cyan (and a deeper one that reads on the white day). */
export const IR = { red: [212, 28, 36], cyan: [112, 255, 246], sea: [18, 136, 152], white: [246, 246, 242] };
/**
 * The world on each ground. The night: a sky near black overhead, a haze of grey at the horizon, the deep below
 * the shore, foliage and clouds glowing white, the far trees grey in the haze. The day, overexposed and inverted:
 * a white-grey sky whitest at the horizon, the trees grey masses in a white fog, clouds a soft grey, the sun black.
 */
const IR_NIGHT = { sky: [[4, 4, 6], [14, 14, 17], [44, 44, 47], [92, 92, 95]], deep: [7, 7, 9], crown: [238, 238, 234], shade: [128, 128, 130], far: [138, 138, 140], trunk: [9, 9, 11], fog: [170, 170, 172], cloud: [238, 238, 234], cloudShade: [70, 70, 74], text: [240, 240, 236], ink: [10, 10, 12], data: IR.cyan, num: [200, 200, 200], redTrunk: [92, 10, 14] };
const IR_DAY = { sky: [[176, 176, 176], [214, 214, 212], [236, 236, 234], [250, 250, 248]], deep: [164, 164, 165], crown: [86, 86, 88], shade: [54, 54, 56], far: [150, 150, 151], trunk: [30, 30, 32], fog: [255, 255, 253], cloud: [186, 186, 186], cloudShade: [150, 150, 152], text: [20, 20, 22], ink: [246, 246, 242], data: IR.sea, num: [48, 48, 50], redTrunk: [140, 16, 22] };
export const irWorld = () => (dark ? IR_NIGHT : IR_DAY);
/** How red a colour is (0–1): its red standing clear of its green and blue, and bright enough to be a colour. */
export const irRedness = (r, g, b) => clamp(((r - Math.max(g, b)) / (r + 1) - 0.28) * 3) * clamp((r - 70) / 60);
/** The red's tones by lightness, for a red the photo keeps: a maroon in the shadows, the scarlet, a pale pink in the lights. */
const irRedTones = () => toneTable([[0, mix([0, 0, 0], IR.red, 0.16)], [0.3, mix([0, 0, 0], IR.red, 0.72)], [0.5, IR.red], [0.78, mix(IR.red, [255, 255, 255], 0.45)], [1, mix(IR.red, [255, 255, 255], 0.82)]]);
let IR_TONES = null;
/**
 * A photo's pixels (RGBA, in place) as an infrared photograph: its lightness taken mostly from the green and the red,
 * the blue held back, so foliage and skin glow, the sky and water go dark; green standing clear of the rest pushed
 * toward white, as leaves are in infrared, blue standing clear of it sunk; an S-curve; a faint cool silver. `amt`
 * (0–1) mixes it in; `inv` folds the shadows over into light (a partial inversion: the darks turn to their opposite,
 * the lights stay); `keep` keeps its reds, as the look's red at their own value. Alpha kept.
 */
export function irPixels(d, amt, inv = 0, keep = 0) {
  if (amt <= 0 && inv <= 0 && keep <= 0) return;
  const T = IR_TONES || (IR_TONES = irRedTones()), a = clamp(amt), b = 1 - a;
  for (let i = 0, n = d.length; i < n; i += 4) {
    if (!d[i + 3]) continue;
    const r = d[i], g = d[i + 1], bl = d[i + 2], hi = r > bl ? r : bl;
    let y = 0.44 * r + 0.78 * g - 0.22 * bl;
    const veg = g > hi ? Math.min(1, (g - hi) / 34) : 0, sky = bl > (r > g ? r : g) ? Math.min(1, (bl - (r > g ? r : g)) / 40) : 0;
    y += veg * (252 - y) * 0.78;
    y *= 1 - 0.55 * sky;
    let t = y < 0 ? 0 : y > 255 ? 1 : y / 255;
    t = t * t * (3 - 2 * t) * 0.55 + t * 0.45;
    let R = t * 251, G = t * 252, B = Math.min(255, t * 255 + 3);
    if (keep > 0) {
      const k = irRedness(r, g, bl) * keep;
      if (k > 0) { const j = ((r * 54 + g * 183 + bl * 19) >> 8) * 3; R += (T[j] - R) * k; G += (T[j + 1] - G) * k; B += (T[j + 2] - B) * k; }
    }
    R = r * b + R * a; G = g * b + G * a; B = bl * b + B * a;
    if (inv > 0) { if (R < 128) R += inv * (255 - 2 * R); if (G < 128) G += inv * (255 - 2 * G); if (B < 128) B += inv * (255 - 2 * B); }
    d[i] = R; d[i + 1] = G; d[i + 2] = B;
  }
}
/** A colour as the infrared world shows it (see irPixels): a grey of its infrared lightness, a red kept red. */
export function irGrey(c) {
  const d = new Uint8ClampedArray([c[0], c[1], c[2], 255]);
  irPixels(d, 1, 0, 1);
  return [d[0], d[1], d[2]];
}
/** A colour in the house style's roles, retold: the ink, the light and the greys kept in the look's greys, a colour through the infrared (see irGrey). */
const irTone = (fill) => { const c = parseColour(fill); return c && role(c) === "colour" ? css(irGrey(c), c[3]) : fill; };

// ---------- where the scene's parts go
/**
 * The scene laid out in the open field F, clear of `keep` (the boxes the words, the tag, the channel graphic and the
 * brand row take; T the title's): the shore the trees stand on (the horizon); the room the near trees take — beside
 * the title when there is a fair width of it, else the field's far side; the red tree in it, its crown as wide as
 * the room allows, as tall as the red's slider says; the code block (`fs` its type size) beside the crown, else on its
 * other side, under it, above it, else at the first clear place of a few, else where it reaches least behind the words;
 * the five marks round the crown, each at its own point, else at another round it (these two found by the crown at its
 * tallest, `top`); the near pines (`pines`, up to three) by turns either side of the red tree, sized by it at the red's
 * default — so the red's slider moves none of them; the sun at the first of a few places in the sky clear of the
 * words; the slit-scan band across the crowns; the ghost on the shore and up to six clouds in the sky. Each keeps clear
 * of the words if it can (behind them, where it cannot: never left out), found at its largest so its slider only sizes
 * it. Pure.
 */
export function irPlace(F, T, keep, p, fs = 15) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(fw, fh), shore = F.y0 + fh * 0.66, sky = shore - F.y0;
  const right = T ? T.x + T.w + u * 0.03 : F.x0 + fw * 0.4;
  const room = F.x1 - right >= fw * 0.26 ? { x0: right, x1: F.x1 } : { x0: F.x0 + fw * 0.42, x1: F.x1 };
  const rw = room.x1 - room.x0, cw = Math.min(rw * 0.82, sky * 0.7), tall = (r) => Math.min(sky * (0.56 + 0.14 * r), cw * 1.02), H = tall(p.red ?? 0.7), H1 = tall(1), tx = room.x0 + rw * 0.54;
  const crownAt = (H) => ({ x: tx - cw / 2, y: shore - H - cw * 0.1, w: cw, h: cw * 0.36 }), crown = crownAt(H), top = crownAt(H1);
  const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const behind = (b) => keep.reduce((s, k) => s + area(k, b), 0);   // how much of b lies behind the words and the rest kept clear
  const past = (b, m) => Math.max(0, F.x0 + m - b.x) + Math.max(0, b.x + b.w - F.x1 + m) + Math.max(0, F.y0 + m - b.y) + Math.max(0, b.y + b.h - F.y1 + m);   // how far b reaches past the field, less a margin m
  // of boxes in the order they are wanted, the first inside the field (less m) and clear of keep (and of `also`), else the one reaching least past the field, then least behind keep, then least over `also`
  const pick = (list, m, also = []) => { let best = null, bk = null; for (const b of list) { const k = [past(b, m), behind(b), also.reduce((s, q) => s + area(q, b), 0)]; if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] || (k[1] === bk[1] && k[2] < bk[2])))) { best = b; bk = k; } if (!k[0] && !k[1] && !k[2]) break; } return best; };
  // the code block: eleven lines of nineteen characters, at the crown's right, its left, under it, over it, or anywhere clear; else where it reaches least behind the words, brought into the field
  const bw = fs * 19.5, bh = fs * 1.5 * 11, cy = top.y + top.h * 0.4;
  const at = [[top.x + top.w + fs * 1.2, cy], [top.x - bw - fs * 1.2, cy], [tx - bw * 0.25, top.y + top.h + fs * 3], [tx - bw * 0.25, top.y - bh - fs * 2]];
  for (const fy of [0.55, 0.3, 0.75]) for (const fx of [0.62, 0.8, 0.45, 0.25, 0.08]) at.push([F.x0 + fw * fx, F.y0 + fh * fy - bh / 2]);
  const da = pick(at.map(([x, y]) => ({ x, y, w: bw, h: bh })), 16), data = { x: clamp(da.x, F.x0, Math.max(F.x0, F.x1 - bw)), y: clamp(da.y, F.y0, Math.max(F.y0, F.y1 - bh)), w: bw, h: bh };
  // the marks round the crown (a dozen characters of `fs` × 0.82 each): each at its own point on it inside the field and clear of the words and the marks before it, else at the first of a few others round it so, else where it reaches least behind them
  const f2 = fs * 0.82, own = [[0.08, 1.25], [0.62, 1.55], [0.34, -0.2], [0.86, 0.55], [0.18, 0.5]], more = [[0.5, -0.7], [0.06, 1.9], [0.7, 2.2], [-0.32, 0.6], [0.92, -0.45], [0.36, 2.6]], marks = [];
  own.forEach((q, i) => { const b = pick([q, ...more, ...own.filter((_, j) => j !== i)].map(([a, v]) => ({ x: top.x + top.w * a - f2, y: top.y + top.h * v - f2 * 1.4, w: f2 * 12, h: f2 * 2 })), 0, marks); marks.push(b); });
  // the near pines, up to three beside the red tree, by turns either side of it, sized by it as it stands at the red's default (0.75): each at its own place if its crown keeps clear of the title, else on the tree's other side; within the field (its other side, else brought in, where its own would run off it); behind the title where neither is clear — never left out
  const H0 = tall(0.75), pines = [0, 1, 2].map((i) => {
    const side = i % 2 ? -1 : 1, d = cw * (0.72 + 0.32 * i + 0.2 * rand(2150 + i)), sc = 0.62 + 0.25 * rand(2151 + i * 1.3), pc = cw * sc * 0.9, ph = H0 * sc, lo = F.x0 - pc * 0.3, hi = F.x1 + pc * 0.3;
    const xs = [tx + side * d, tx - side * d].filter((x) => x >= lo && x <= hi), x = xs.find((x) => !(T && overlaps({ x: x - pc / 2, y: shore - ph, w: pc, h: pc * 0.4 }, T))) ?? (xs.length ? xs[0] : clamp(tx + side * d, lo, hi));
    return { x, H: ph, cw: pc, k: 2152 + i * 23 };
  });
  // the sun: high in the sky, clear of the words
  const sr = u * 0.09, sun = [[0.84, 0.15], [0.16, 0.13], [0.66, 0.1], [0.4, 0.08], [0.9, 0.36]].map(([a, b]) => [F.x0 + fw * a, F.y0 + fh * b]).find(([x, y]) => !keep.some((k) => overlaps(k, { x: x - sr, y: y - sr, w: sr * 2, h: sr * 2 }))) || [F.x0 + fw * 0.84, F.y0 + fh * 0.15];
  // the ghost: standing on the shore, as tall as its slider says; its place found over its sizes (so the slider only sizes it): the first of a few clear of the words at all of them, else the one reaching least behind them — never left out (the words lie over it)
  const gTop = sky * 0.75, gb = (x, gh) => ({ x: x - gh * 0.35, y: shore - gh, w: gh * 0.7, h: gh });
  let gx = null, gv = Infinity;
  for (const x0 of [room.x0 + rw * 0.16, room.x0 + rw * 0.88, F.x0 + fw * 0.12, F.x0 + fw * 0.88, F.x0 + fw * 0.5]) {
    const x = clamp(x0, F.x0 + gTop * 0.35 + 4, Math.max(F.x0 + gTop * 0.35 + 4, F.x1 - gTop * 0.35 - 4)), v = [0.45, 0.6, 0.75].reduce((s, k) => s + behind(gb(x, sky * k)), 0);   // within the field at its tallest
    if (v < gv) { gx = x; gv = v; if (!v) break; }
  }
  // the clouds: up to six in the sky, each at the first of its seeded places (found at its largest, so the slider only sizes them) clear of the words, the rest kept clear and the sun, else the one reaching least behind them — none left out; the slider brings them in one after another
  const sunBox = { x: sun[0] - sr * 2.2, y: sun[1] - sr * 2.2, w: sr * 4.4, h: sr * 4.4 }, clouds = [];
  for (let i = 0; i < 6; i++) {
    const s0 = u * (0.1 + 0.12 * rand(2100 + i * 2.9)), s = s0 * 1.3;
    let best = null;
    for (let j = 0; j < 12; j++) {   // its own place first, then others
      const cx = F.x0 + fw * (0.08 + 0.84 * rand(j ? 2400 + i * 31 + j * 7.7 : 2101 + i * 3.7)), cy = F.y0 + sky * (0.12 + 0.5 * rand(j ? 2400.5 + i * 31 + j * 7.7 : 2102 + i * 4.1));
      const box = { x: cx - s * 1.3, y: cy - s * 0.6, w: s * 2.6, h: s * 0.9 }, v = (T ? area(box, T) * 4 : 0) + behind(box) + area(box, sunBox) * 2;
      if (!best || v < best.v) best = { x: cx, y: cy, s0, v };
      if (!v) break;
    }
    clouds.push(best);
  }
  return {
    F, u, shore, room, crown, clouds, pines, data,
    marks: marks.map((b) => ({ x: b.x + f2, y: b.y + f2 * 1.4 })),   // where each mark's cross stands
    tree: { x: tx, base: shore, H, cw },
    sun: { x: sun[0], y: sun[1], r: sr },
    smear: { x0: Math.max(F.x0, tx - fw * 0.3), x1: Math.min(F.x1, tx + fw * 0.3), y: shore - sky * 0.05 },
    ghost: { x: gx, foot: shore, h: sky * (0.3 + 0.45 * (p.figure ?? 0)) },
  };
}

// ---------- the machine's lines
const IR_VERBS = ["APPLY halation(radius = soft)", "INVERT luminance(band = 0.%N)", "SMEAR rows(%N, dir = down)", "ISOLATE hue(scarlet, keep = 1)", "LOWER noise_floor(-%N dB)", "SET exposure = overflow", "SET wavelength = 850nm", "BLEED red(into = greys)"];
/**
 * The code block: up to `n` lines of a machine reading the memory back — a call, settings, a test, a loop — the channel's
 * code and the brand worked in, hexes and coordinates; the same for the same seed (`k0`) and channel. [indent, text] each.
 */
export function irLines(code, brand, n = 11, k0 = 0) {
  const R = (i) => rand(k0 + i * 1.913), num = (i, a, b) => (a + R(i) * (b - a)).toFixed(2), hex = (i) => Math.floor(R(i) * 0xffffff).toString(16).toUpperCase().padStart(6, "0"), N = (i) => String(10 + Math.floor(R(i) * 89));
  const verb = (i) => IR_VERBS[Math.floor(R(i) * IR_VERBS.length) % IR_VERBS.length].replace("%N", N(i + 50));
  const tag = String(code || "IR").toUpperCase().replace(/\s+/g, "_").slice(0, 10), who = String(brand || "unknown").replace(/"/g, "").slice(0, 16);
  const all = [
    [0, `recall(memory = 0x${hex(1)})`],
    [1, verb(2)],
    [1, `READ channel["${tag}"] -> buffer`],
    [1, `IF signal.decay > 0.${N(3)} THEN`],
    [2, verb(4)],
    [2, verb(5)],
    [1, "END IF"],
    [1, `TRACE subject @ ${num(6, 120, 980)} / ${num(7, 120, 980)}`],
    [1, `BIND source = "${who}"`],
    [1, `FOR each frame IN buffer DO`],
    [2, verb(8)],
    [1, "RETURN ghost_frame"],
    [0, "END"],
  ];
  return all.slice(0, Math.max(0, Math.min(all.length, n)));
}
/** A timecode and a frame's coordinates, as the machine stamps them. */
const irStamp = (k0) => `${String(Math.floor(rand(k0) * 24)).padStart(2, "0")}:${String(Math.floor(rand(k0 + 1) * 60)).padStart(2, "0")}:${String(Math.floor(rand(k0 + 2) * 60)).padStart(2, "0")}:${String(Math.floor(rand(k0 + 3) * 24)).padStart(2, "0")}`;

// ---------- painting the scene
/** The ground: the sky from overhead to the haze at the horizon (the shore, at 0.66 of the open field), and the deep below it. */
function irGround(ctx, w, h, F) {
  const W = irWorld(), s = F.y0 + (F.y1 - F.y0) * 0.66, t = (y) => clamp(y / h, 0, 1), g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, css(W.sky[0])); g.addColorStop(t(s * 0.42), css(W.sky[1])); g.addColorStop(t(s * 0.86), css(W.sky[2])); g.addColorStop(t(s), css(W.sky[3]));
  g.addColorStop(t(s + (h - s) * 0.12), css(mix(W.sky[3], W.deep, 0.7))); g.addColorStop(1, css(W.deep));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
/** A soft mass of `col` round (x, y), `r` across: a radial gradient, solid at heart (`a`), gone at its rim. */
function irBlob(ctx, x, y, r, col, a, core = 0.45) {
  if (r <= 0.5 || a <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, css(col, a)); g.addColorStop(core, css(col, a * 0.85)); g.addColorStop(1, css(col, 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** A cloud: a cumulus — puffs heaped toward its middle over a flat foot at cy; glowing white in the night's sky, a soft grey in the day's. */
function irCloud(ctx, cx, cy, s, a, k0) {
  const W = irWorld(), puffs = [];
  for (let i = 0; i < 26; i++) {
    const t = rand(k0 + i * 1.7), hump = Math.sin(Math.PI * t), r = s * (0.12 + 0.26 * hump) * (0.7 + 0.5 * rand(k0 + i * 3.1)), lift = hump * s * 0.62 * (0.35 + 0.65 * rand(k0 + i * 2.3));
    puffs.push([cx + (t - 0.5) * s * 2.6, Math.min(cy - r * 0.35, cy - lift), r]);
  }
  ctx.save();
  for (const [x, y, r] of puffs) irBlob(ctx, x, y + r * 0.32, r * 0.95, W.cloudShade, 0.5 * a, 0.45);   // the undersides in shade
  ctx.globalCompositeOperation = dark ? "screen" : "multiply";
  for (const [x, y, r] of puffs) irBlob(ctx, x, y - r * 0.08, r * 0.86, W.cloud, (dark ? 0.62 : 0.4) * a, 0.55);   // lit above
  ctx.restore();
}
/**
 * An umbrella pine, as the stone pines of the references stand: a slender trunk with a slight lean, forking below a
 * broad, flat canopy into limbs that spread out under it, each holding a clump of foliage — flattened masses, their
 * undersides in shade (`shade`), their tops lit (`crown`): glowing white in the night, a grey mass in the day's fog.
 * `lite`: fewer masses, for the far rows. `a` its strength.
 */
function irPine(ctx, x, base, H, cw, crown, shade, trunk, a, k0, lite = false) {
  if (a <= 0 || H < 4) return;
  const R = (i) => rand(k0 + i * 1.37), lean = (R(0) - 0.5) * cw * 0.22, ch = cw * 0.3, top = base - H, under = top + ch * 0.85;
  const fx = x + lean * 0.7, fy = under + (base - under) * 0.16, tw = Math.max(1.2, cw * 0.034);
  ctx.save(); ctx.globalAlpha = a;
  ctx.fillStyle = css(trunk); ctx.beginPath();   // the trunk: tapering, a slight S
  ctx.moveTo(x - tw * 0.75, base); ctx.bezierCurveTo(x - tw * 0.6 + lean * 0.1, base - (base - fy) * 0.45, fx - tw * 0.5 - lean * 0.15, fy + (base - fy) * 0.3, fx - tw * 0.4, fy);
  ctx.lineTo(fx + tw * 0.4, fy); ctx.bezierCurveTo(fx + tw * 0.5 - lean * 0.15, fy + (base - fy) * 0.3, x + tw * 0.6 + lean * 0.1, base - (base - fy) * 0.45, x + tw * 0.75, base); ctx.closePath(); ctx.fill();
  const n = lite ? 3 : 4 + Math.floor(R(1) * 3), clumps = [];
  ctx.strokeStyle = css(trunk); ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {   // the limbs, out from the fork to the clumps along the canopy
    const t = (i + 0.5) / n, e = Math.abs(t - 0.5) * 2, ex = x + lean + (t - 0.5) * cw * 0.84 + (R(2 + i) - 0.5) * cw * 0.07, ey = under - ch * (0.12 + 0.3 * (1 - e)) + (R(10 + i) - 0.5) * ch * 0.14;
    clumps.push([ex, ey, cw * (0.22 + 0.14 * R(20 + i)) * (1 - 0.3 * e), i]);
    ctx.lineWidth = tw * (0.8 - 0.35 * e); ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx + (ex - fx) * 0.3, fy - (fy - ey) * 0.8, ex, ey + ch * 0.18); ctx.stroke();
  }
  const m = lite ? [3, 5] : [8, 13];
  for (const [cx, cy, cwid, i] of clumps) {   // each clump: a flattened mass, in shade beneath, lit above
    const hh = cwid * 0.4;
    for (let j = 0; j < m[0]; j++) irBlob(ctx, cx + (R(30 + i * 17 + j) - 0.5) * cwid * 0.85, cy + hh * (0.18 + (R(31 + i * 17 + j) - 0.5) * 0.35), hh * (0.42 + 0.3 * R(32 + i * 17 + j)), shade, 0.85, 0.55);
    for (let j = 0; j < m[1]; j++) { const u = R(40 + i * 19 + j) - 0.5; irBlob(ctx, cx + u * cwid, cy - hh * 0.12 + (R(41 + i * 19 + j) - 0.62) * hh * 0.55 * (1 - Math.abs(u)), hh * (0.3 + 0.32 * R(42 + i * 19 + j)), crown, 0.95, 0.6); }
  }
  ctx.restore();
}
/**
 * The far shore: a tree line along the horizon — rounded masses run together, low — with a few small pines standing
 * up out of it, all in the haze's own tone (in the night's infrared the far foliage glows pale too). `n` how many.
 */
function irFarRow(ctx, F, shore, sky, n, a, k0) {
  const W = irWorld(), fw = F.x1 - F.x0, line = mix(W.far, W.sky[3], 0.35);
  ctx.save(); ctx.globalAlpha = a * clamp(n / 6);
  for (let i = 0, m = Math.round(10 + n * 3); i < m; i++) {   // the tree line, a band of soft masses
    const x = F.x0 + fw * ((i + rand(k0 + i * 0.7) * 0.8) / m), r = sky * (0.035 + 0.05 * rand(k0 + i * 1.9) ** 2);
    irBlob(ctx, x, shore - r * 0.5, r * 1.3, line, 0.8, 0.5);
  }
  ctx.restore();
  for (let i = 0, m = n * 0.32; i < Math.ceil(m); i++) {   // pines standing up out of it, some nearer than others, all lost in the haze
    const x = F.x0 + fw * ((i + rand(k0 + i * 1.1) * 0.9) / Math.max(1, m)), H = sky * (0.12 + 0.16 * rand(k0 + i * 2.7)), cw = H * (1 + 0.5 * rand(k0 + i * 3.9)), c = mix(W.far, W.sky[3], 0.25 + 0.35 * rand(k0 + i * 4.4));
    irPine(ctx, x, shore + 2, H, cw, c, mix(c, W.sky[3], 0.35), mix(c, W.sky[3], 0.3), a * clamp(m - i) * (0.4 + 0.4 * rand(k0 + i * 5.2)), k0 + i * 17.3, true);
  }
}
/** The flare's source, behind what stands in the sky: the sun in the night, a halo round it; in the inverted day a black sun in a grey ring. */
function irSun(ctx, x, y, r, a) {
  if (a <= 0) return;
  ctx.save();
  if (dark) { ctx.globalCompositeOperation = "screen"; irBlob(ctx, x, y, r * 3.2, [210, 214, 220], 0.32 * a, 0.1); irBlob(ctx, x, y, r * 0.9, [255, 255, 255], 0.95 * a, 0.35); }
  else { irBlob(ctx, x, y, r * 2.8, [110, 110, 112], 0.22 * a, 0.15); irBlob(ctx, x, y, r * 0.95, [16, 16, 18], 0.95 * a, 0.7); irBlob(ctx, x, y, r * 0.5, [60, 60, 62], 0.6 * a, 0.3); }
  ctx.restore();
}
/**
 * The anamorphic flare over everything: a long thin streak across the picture through its source with a rainbow along
 * its edges, a soft band of haze about it, and prism light at its ends — patches of the spectrum, striated, as when a
 * prism is held to the lens. F: the span it runs in. `a` its strength. `home`: where its source stands undragged.
 */
function irStreak(ctx, F, x, y, r, a, k0, home = x) {
  if (a <= 0) return;
  const fw = F.x1 - F.x0, L = fw * (0.45 + 0.4 * a);
  ctx.save();
  ctx.globalCompositeOperation = dark ? "screen" : "source-over";
  const band = (h, col, al, dy = 0) => { ctx.save(); ctx.translate(x, y + dy); ctx.scale(1, h / L); const g = ctx.createRadialGradient(0, 0, 0, 0, 0, L); g.addColorStop(0, css(col, al)); g.addColorStop(0.55, css(col, al * 0.5)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.fillRect(-L, -L, L * 2, L * 2); ctx.restore(); };
  band(r * 0.9, dark ? [190, 205, 230] : [90, 90, 96], 0.3 * Math.min(1, a * 1.5));   // the haze about it
  band(Math.max(2, r * 0.07), dark ? [236, 242, 255] : [40, 40, 46], Math.min(1, a * 1.8));   // the streak
  band(Math.max(1, r * 0.022), [255, 255, 255], dark ? Math.min(1, a * 2) : 0);   // its white-hot core
  // the rainbow along its edges, the spectrum running out from the source each way
  for (const s of [-1, 1]) {
    const g = ctx.createLinearGradient(x, 0, x + s * L, 0);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, css([[255, 60, 60], [255, 170, 40], [240, 240, 60], [60, 230, 120], [40, 200, 255], [120, 90, 255], [255, 60, 200]][i], (dark ? 0.55 : 0.42) * a * (1 - i / 7)));
    ctx.fillStyle = g; ctx.fillRect(Math.min(x, x + s * L), y - r * 0.13, L, Math.max(1, r * 0.035)); ctx.fillRect(Math.min(x, x + s * L), y + r * 0.1, L, Math.max(1, r * 0.03));
  }
  ctx.restore();
  // prism light along the streak, either side of the source (see irPrismAt): striated patches of the spectrum,
  // painted small and laid on large, so they are soft
  for (const q of irPrismAt(F, x, home, r, a, k0)) irPrism(ctx, q.x - q.w / 2, y - q.h * 0.55, q.w, q.h, q.a, q.k);
}
/**
 * The prism light's two patches along the flare's streak through x (its source `r` across, `a` its strength): one each
 * side, at the first of a few shares of the streak's length out from the source that lies inside F and clear of the
 * source's glow, else the first inside F (over the glow), else over the source itself; brought inside F wherever it would
 * pass its edge — never left out. The share is found with the streak at its longest from `home`, where the source stands
 * undragged, so neither the slider nor a drag moves a patch along it: the slider stretches the streak, and the patches
 * with it. { x, w, h, a, k } each. Pure.
 */
export function irPrismAt(F, x, home, r, a, k0) {
  const fw = F.x1 - F.x0, L1 = fw * 0.85, L = fw * (0.45 + 0.4 * a);
  return [[-1, 0], [1, 1]].map(([s, k]) => {
    const pw = fw * (0.07 + 0.04 * rand(k0 + k + 2)), ph = r * (1.5 + rand(k0 + k + 4)), ts = [0.5, 0.68, 0.34, 0.85, 0.22, 0.12], inF = (t) => { const q = home + s * L1 * t; return q - pw / 2 >= F.x0 && q + pw / 2 <= F.x1; };
    const t = ts.find((t) => inF(t) && L1 * t > r * 3 + pw / 2) ?? ts.find(inF) ?? 0;
    return { x: clamp(x + s * L * t, F.x0 + pw / 2, Math.max(F.x0 + pw / 2, F.x1 - pw / 2)), w: pw, h: ph, a: Math.min(1, a * (1.3 - 0.4 * k)), k: k0 + k * 31 };
  });
}
/** A patch of prism light in the box x, y, w × h: thin upright streaks of the spectrum, left to right, strongest in the middle. */
function irPrism(ctx, x, y, w, h, a, k0) {
  if (a <= 0 || w < 2 || h < 2) return;
  const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1, pw = Math.max(4, Math.round((w * k) / 3)), ph = Math.max(4, Math.round((h * k) / 3));
  const c = canPaint(ctx) ? gpuCanvas("irPrism", pw, ph) : null, g = c && c.getContext("2d");
  const paint = (x2, X, Y, Wd, Hd) => {
    for (let i = 0, n = 34; i < n; i++) {
      const t = i / n, sx = X + Wd * t, sw = Wd / n * (0.4 + 0.8 * rand(k0 + i * 1.3)), sh = Hd * (0.35 + 0.65 * rand(k0 + i * 2.9)), sy = Y + (Hd - sh) * rand(k0 + i * 4.1), al = a * (0.25 + 0.75 * rand(k0 + i * 5.7)) * Math.sin(Math.PI * t);
      const gr = x2.createLinearGradient(0, sy, 0, sy + sh), col = [[255, 50, 50], [255, 160, 40], [250, 240, 70], [70, 240, 120], [50, 200, 255], [110, 90, 255]][Math.min(5, Math.floor(t * 6))];
      gr.addColorStop(0, css(col, 0)); gr.addColorStop(0.5, css(col, al)); gr.addColorStop(1, css(col, 0));
      x2.fillStyle = gr; x2.fillRect(sx, sy, sw, sh);
    }
  };
  if (!g) { ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply"; paint(ctx, x, y, w, h); ctx.restore(); return; }
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.clearRect(0, 0, pw, ph);
  paint(g, 0, 0, pw, ph);
  ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply"; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  if (!dark) { g.globalCompositeOperation = "destination-over"; g.fillStyle = "#fff"; g.fillRect(0, 0, pw, ph); }   // on the white day, multiplied: white where there is no light
  ctx.drawImage(c, x, y, w, h); ctx.restore();
}
/**
 * Slit-scan: what ctx's canvas holds along the line y, from x0 to x1 (units), dragged down into streaks: each run of
 * a few pixels across takes the colour of the line and pulls it down as far as its own length (`len` at most),
 * thinning out toward its end. Painted on ctx (the line read first). `a` its strength.
 */
function irSmear(ctx, x0, x1, y, len, a, k0) {
  if (a <= 0 || len < 2 || !canPaint(ctx)) return;
  const m = ctx.getTransform(), cv = ctx.canvas, k = Math.hypot(m.a, m.b) || 1;
  const X0 = clamp(Math.round(m.e + x0 * m.a), 0, cv.width), X1 = clamp(Math.round(m.e + x1 * m.a), 0, cv.width), Y = Math.round(m.f + y * m.d), rh = Math.max(1, Math.round(k * 1.5));
  if (X1 - X0 < 2 || Y < 0 || Y + rh > cv.height) return;
  const row = gpuCanvas("irRow", X1 - X0, rh), rg = row.getContext("2d");   // on the graphics card: drawn from hundreds of times
  rg.globalCompositeOperation = "copy"; rg.drawImage(cv, X0, Y, X1 - X0, rh, 0, 0, X1 - X0, rh);
  const L = len * k;
  inPixels(ctx, () => {
    ctx.imageSmoothingEnabled = false;
    for (let x = X0, i = 0; x < X1; i++) {
      const sw = Math.min(X1 - x, Math.max(1, Math.round((1 + rand(k0 + i * 1.7) ** 2 * 12) * k))), r = rand(k0 + i * 2.9), l = L * (0.12 + 0.88 * r * r) * (0.5 + 0.5 * Math.sin(Math.PI * clamp((x - X0) / (X1 - X0)))), al = a * (0.55 + 0.45 * rand(k0 + i * 3.3));
      for (const [f, q] of [[0.45, 1], [0.75, 0.55], [1, 0.28]]) { ctx.globalAlpha = Math.min(1, al * q); ctx.drawImage(row, x - X0, 0, sw, rh, x, Y, sw, Math.max(1, l * f)); }
      x += sw;
    }
  });
}
/**
 * The lens: its edges gone soft and swirled — a soft copy of what ctx's canvas holds, turned a little each way about
 * the middle, laid over the edges and not the middle (`soft`: false leaves that out) — and darkened (the night) or
 * burnt out to white (the day).
 */
function irLens(ctx, w, h, a, soft = true) {
  if (a <= 0) return;
  if (canPaint(ctx) && soft) {   // worked at half the canvas's size, as soft as it is
    const cv = ctx.canvas, W = cv.width, H = cv.height, sw = Math.max(2, Math.round(W / 2)), sh = Math.max(2, Math.round(H / 2)), blur = softCopy(cv, 7, "irSoft"), c = gpuCanvas("irSoftW", sw, sh), x = c.getContext("2d");
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "copy"; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
    x.translate(sw / 2, sh / 2); x.rotate(0.014 * a); x.drawImage(blur, -sw / 2, -sh / 2, sw, sh); x.globalCompositeOperation = "source-over"; x.rotate(-0.028 * a); x.globalAlpha = 0.5; x.drawImage(blur, -sw / 2, -sh / 2, sw, sh);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = "destination-in";
    const g = x.createRadialGradient(sw / 2, sh / 2, Math.min(sw, sh) * 0.3, sw / 2, sh / 2, Math.hypot(sw, sh) * 0.52); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${Math.min(1, 0.35 + 0.65 * a)})`);
    x.fillStyle = g; x.fillRect(0, 0, sw, sh);
    inPixels(ctx, () => { ctx.imageSmoothingEnabled = true; ctx.drawImage(c, 0, 0, W, H); });
  }
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  g.addColorStop(0, css(dark ? [0, 0, 0] : [255, 255, 255], 0)); g.addColorStop(1, css(dark ? [0, 0, 0] : [255, 255, 255], (dark ? 0.85 : 0.4) * a));
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
/**
 * The machine's lines: the code block (`D`, see irPlace: its box) in the cyan, line by line as `a` grows, glowing a
 * little; the five marks round the crown (`marks`, see irPlace: where each cross stands), coordinates, a timecode and
 * a hex with small crosses, in the greys (one in the red).
 */
function irData(ctx, env, D, marks, a, k0) {
  if (a <= 0) return;
  const W = irWorld(), fs = D.h / (1.5 * 11), lines = irLines(env.cat && (env.cat.code || env.cat.name), env.o && env.o.profile && env.o.profile.brand && env.o.profile.brand.name, Math.ceil(a * 11), k0);
  const [X, Y] = objAt("data", D.x, D.y, ctx);
  ctx.save(); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.font = `400 ${fs}px ${fonts.mono}`;
  if (!fast && canPaint(ctx)) { const m = ctx.getTransform(); ctx.shadowColor = css(W.data, dark ? 0.75 : 0.3); ctx.shadowBlur = fs * 0.5 * Math.hypot(m.a, m.b); }
  ctx.fillStyle = css(W.data, (dark ? 0.92 : 0.95) * clamp(a * 3));
  lines.forEach(([ind, t], i) => ctx.fillText(t, X + ind * fs * 1.25, Y + fs * (1 + i * 1.5)));
  ctx.restore();
  if (a < 0.3) return;
  const b = clamp((a - 0.3) * 3), f2 = fs * 0.82, R = (i) => rand(k0 + 40 + i * 2.3);
  ctx.save(); ctx.font = `500 ${f2}px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineWidth = Math.max(1, fs * 0.08);
  marks.forEach(({ x, y }, i) => {
    const red = i === 1, col = red ? IR.red : W.num;
    ctx.strokeStyle = ctx.fillStyle = css(col, 0.85 * b);
    ctx.beginPath(); ctx.moveTo(x - f2 * 0.5, y); ctx.lineTo(x + f2 * 0.5, y); ctx.moveTo(x, y - f2 * 0.5); ctx.lineTo(x, y + f2 * 0.5); ctx.stroke();
    ctx.fillText(i === 4 ? irStamp(k0 + 9) : i === 2 ? `#${Math.floor(R(i) * 0xffffff).toString(16).toUpperCase().padStart(6, "0")}` : `${(100 + R(i) * 900).toFixed(2)} / ${(100 + R(i + 9) * 900).toFixed(2)}`, x + f2 * 0.8, y - f2 * 0.35);
  });
  ctx.restore();
}
/** How tall the ghost of figure S stands at `size`: that tall, less for a wide figure (kept to 0.9 of it across). */
const irGhostH = (S, size) => { const b = S.box, aspect = (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0); return Math.min(size, (size * 0.9) / Math.max(0.4, aspect)); };
/** The ghost: the figure's silhouette (S) standing on the shore, glowing — white with a glow in the night, white out of a grey shadow in the day — split red and cyan at its edges. */
function irGhost(ctx, S, cx, foot, size, a) {
  if (!S || a <= 0) return;
  const hgt = irGhostH(S, size), cy = foot - hgt / 2, d = hgt * 0.009;
  ctx.save(); ctx.globalAlpha = a;
  blurred(ctx, hgt * 0.06, css(dark ? [255, 255, 255] : [60, 60, 62], dark ? 0.55 : 0.4), () => placeShape(ctx, S, [0, 0, 0], cx, cy, hgt));
  ctx.globalAlpha = a * 0.8; placeShape(ctx, S, IR.red, cx - d * 2, cy, hgt); placeShape(ctx, S, [40, 220, 255], cx + d * 2, cy, hgt);
  ctx.globalAlpha = a * 0.92; placeShape(ctx, S, mix(IR.white, [255, 255, 255], 0.5), cx, cy, hgt);
  ctx.restore();
}
/** The red tree with its red bleeding into the sky round it: the crown's own soft glow, and (`wash`) great soft masses of the red spreading up and out. */
function irRedTree(ctx, P, a, wash, k0) {
  const W = irWorld(), { x, base, H, cw } = P.tree, cr = P.crown, cx = cr.x + cr.w / 2, cy = cr.y + cr.h / 2;
  if (wash > 0) {   // the wash: the red spread about the crown and up across the sky, the night's red light, the day's red stain
    ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply";
    for (let i = 0; i < 7; i++) {
      const ang = -Math.PI / 2 + (rand(k0 + i * 1.7) - 0.5) * 2.6, d = cw * (0.2 + 0.9 * rand(k0 + i * 2.9)) * (0.5 + wash), r = P.u * (0.18 + 0.22 * rand(k0 + i * 3.3)) * (0.6 + 0.9 * wash);
      irBlob(ctx, cx + Math.cos(ang) * d, cy + Math.sin(ang) * d * 0.8, r, dark ? mix(IR.red, [0, 0, 0], 0.15) : IR.red, (dark ? 0.5 : 0.42) * Math.min(1, wash * 1.6), 0.2);
    }
    ctx.restore();
  }
  if (a <= 0) return;
  irBlob(ctx, cx, cy, cw * 0.85, IR.red, 0.22 * a, 0.1);   // its own glow, bleeding into the greys
  irPine(ctx, x, base, H, cw, IR.red, mix(IR.red, [0, 0, 0], 0.32), W.redTrunk, Math.min(1, a * 3), k0 + 7);
}

/** What the look keeps that it painted: its kept layers and work canvases, by slot. */
const IR_SLOTS = ["irBack", "irSoft", "irSoftm", "irBloom", "irBloomm", "irHalo", "irHalom", "irFr0", "irFr1", "irGrain"], IR_GPU = ["irSoftW", "irRow", "irPrism"];
/** Lets go everything the look keeps (see `leave`), as another look is chosen: its kept scenes and work canvases. */
export function irFreeAll() {
  for (const s of IR_SLOTS) {
    const v = WORK[s];
    if (v instanceof Map) for (const e of v.values()) { if (e && e.c) e.c.width = e.c.height = 0; }
    else if (v && typeof v === "object" && "width" in v) v.width = v.height = 0;
    delete WORK[s];
  }
  if (typeof document !== "undefined") for (const s of IR_GPU) gpuCanvas(s, 0, 0);
}
/** After painting on a canvas larger than any on the page (an export), its work canvases are let go: kept, they would hold that much memory for nothing. */
const irLetGo = (ctx) => {
  const cv = ctx && ctx.canvas, px = cv ? cv.width * cv.height : 0;
  if (px <= 6e6) return;
  for (const s of IR_SLOTS.slice(1)) { const v = WORK[s]; if (v && "width" in v && s !== "irGrain") v.width = v.height = 0; }
  letGoGpu(px);
};

/** Bloom and halation: a soft copy of the picture, its brightest parts kept, screened over it; in the night a wider glow of the red about the lights too, as film's back layer throws it. */
function irBloom(ctx, a) {
  if (a <= 0) return;
  const cv = ctx.canvas, soft = softCopy(cv, 10, "irBloom"), x = soft.getContext("2d");
  x.globalCompositeOperation = "multiply"; x.drawImage(soft, 0, 0); if (!dark) x.drawImage(soft, 0, 0);
  inPixels(ctx, () => {
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.globalCompositeOperation = dark ? "screen" : "lighten"; ctx.globalAlpha = Math.min(1, a * (dark ? 0.9 : 0.4)); ctx.drawImage(soft, 0, 0, cv.width, cv.height);
    if (dark) {
      const wide = softCopy(soft, 3, "irHalo"), g = wide.getContext("2d");
      g.globalCompositeOperation = "multiply"; g.fillStyle = css(IR.red); g.fillRect(0, 0, wide.width, wide.height);
      ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = Math.min(1, a * 0.7); ctx.drawImage(wide, -cv.width * 0.02, -cv.height * 0.02, cv.width * 1.04, cv.height * 1.04);
    }
  });
}
/** Chromatic aberration: the red drawn a little larger about the middle and the green and blue a little smaller, lightened in, so bright edges fringe red one side, cyan the other, more toward the edges. */
function irFringe(ctx, a) {
  if (a <= 0) return;
  const cv = ctx.canvas, W = cv.width, H = cv.height, s = 0.0065 * a;
  // each plate copied from the canvas as it is: the red laid back first changes only the red, which the cyan plate leaves out
  [[1 + s, [255, 0, 0]], [1 - s, [0, 255, 255]]].forEach(([k, col], i) => {
    const x = workLike(ctx, "irFr" + i); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(cv, 0, 0);
    x.globalCompositeOperation = "multiply"; x.fillStyle = css(col); x.fillRect(0, 0, W, H);
    inPixels(ctx, () => { ctx.globalCompositeOperation = "lighten"; ctx.imageSmoothingEnabled = true; ctx.drawImage(x.canvas, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); });
  });
}
/** Heavy, fine film grain (noise about a mid grey, near gaussian): overlaid; in the night lifting the blacks a little into noise, in the day speckling the whites. */
function irGrain(ctx, a, unit) {
  if (a <= 0 || typeof document === "undefined" || !ctx.canvas) return;
  let t = WORK.irGrain;
  if (!t) {
    t = WORK.irGrain = document.createElement("canvas"); t.width = t.height = 256;
    const x = t.getContext("2d"), d = x.createImageData(256, 256);
    let s = 90127;
    const next = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return ((s >> 16) & 255) / 255; };
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + ((next() + next() + next()) / 3 - 0.5) * 2 * 150; d.data[i] = d.data[i + 1] = d.data[i + 2] = clamp(v, 0, 255); d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
  }
  const pat = ctx.createPattern(t, "repeat");
  if (!pat) return;
  if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(Math.max(1, unit * 1.05)));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = pat;
  ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = Math.min(1, a * 0.85); ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (!dark) { ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = Math.min(1, a * 0.2); ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }   // the whites, which overlay leaves alone, speckled
  ctx.restore();
}

/** A canvas font at a light weight (300): its weight replaced, or one put in front; "" for none. */
export const irThin = (font) => (!font ? "" : /\b[1-9]00\b/.test(font) ? font.replace(/\b[1-9]00\b/, "300") : /\bbold(er)?\b/.test(font) ? font.replace(/\bbold(er)?\b/, "300") : `300 ${font}`);
/**
 * The lettering's letters (`chars`: {t, hi, x, w, s, dy}, each where the heavy weight set it, `w` wide), at the light
 * weight ctx's font has now, each in the middle of its place: a soft dark round them (a soft light in the day), the
 * red's glow round the highlighted ones, the split — a red copy one side, a cyan one the other, `s` apart in hundredths
 * of the type size — and the letters, `ink`, the highlighted ones `hi`.
 */
function irLetter(ctx, chars, fs, s, ink, hi) {
  const each = (fn, only) => { for (const c of chars) if (only === undefined || !!c.hi === only) inPiece(c, () => { const lw = ctx.measureText(c.t).width || c.w; fn(c, c.x + (c.w - lw) / 2); }); };
  if (!canPaint(ctx)) { each((c, x) => { ctx.fillStyle = css(c.hi ? hi : ink); ctx.fillText(c.t, x, 0); }); return; }
  if (!fast) for (const [r, al] of [[0.18, 0.55], [0.05, 0.5]]) blurred(ctx, fs * r, css(dark ? [0, 0, 0] : [255, 255, 255], dark ? al : al + 0.1), () => each((c, x) => ctx.fillText(c.t, x, 0)));   // a soft dark round them, and a tighter one at their edge
  if (!fast && chars.some((c) => c.hi)) { ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "source-over"; blurred(ctx, fs * 0.22, css(hi, dark ? 0.55 : 0.25), () => each((c, x) => ctx.fillText(c.t, x, 0), true)); ctx.restore(); }
  if (s > 0) {
    const d = fs * 0.012 * s;
    ctx.save(); ctx.globalCompositeOperation = dark ? "screen" : "multiply";
    ctx.fillStyle = css(dark ? [255, 40, 50] : [255, 120, 120], dark ? 0.9 : 0.8); each((c, x) => ctx.fillText(c.t, x - d, 0));
    ctx.fillStyle = css(dark ? [40, 225, 255] : [110, 230, 255], dark ? 0.85 : 0.8); each((c, x) => ctx.fillText(c.t, x + d, 0));
    ctx.restore();
  }
  each((c, x) => { ctx.fillStyle = css(c.hi ? hi : ink); ctx.fillText(c.t, x, 0); });
}
/** The open field (see openField), to the near side of a slanted block's edge: the room the scene can count on. */
function irField(env) {
  const F = openField(env), E = env.G && env.G.edge;
  if (!E) return F;
  const [ax, ay, bx, by] = E.line;
  return F.side === "below" ? { ...F, y1: Math.min(ay, by) } : F.side === "above" ? { ...F, y0: Math.max(ay, by) } : F.side === "right" ? { ...F, x1: Math.min(ax, bx) } : F.side === "left" ? { ...F, x0: Math.max(ax, bx) } : F;
}
/** The scene's parts that are on (any slider of the scene above nothing). */
const irAny = (p) => p.trees > 0 || p.red > 0 || p.wash > 0 || p.clouds > 0 || p.water > 0 || p.fog > 0 || p.figure > 0 || p.flare > 0 || p.slit > 0 || p.lens > 0;
/** What is kept clear of the scene's parts: the words, the tag, the graphic (keepClear), the brand row and the frame's readout in the top corner. */
const irKeep = (ctx, env) => (canPaint(ctx) ? [...keepClear(ctx, env), { x: 0, y: 0, w: Math.min(env.w, 900), h: env.hasBrand === false ? 0 : 150 }, { x: env.w - 600, y: 0, w: 600, h: 110 }] : []);
/** The type size of the machine's lines on a cover w × h. */
const irFs = (w, h) => Math.max(11, Math.min(w, h) * 0.0135);

export const infrared = {
  id: "infrared",
  art: "figure",
  repaint: (c) => `the photograph as an infrared black-and-white photograph: foliage, skin and clouds glowing white, the sky and water dark, soft silver greys, a partly inverted ghostly feel; one blood-scarlet red as the only colour (${c} where it suits), bleeding softly into the greys; bloom and halation round the lights, red and cyan colour fringes on bright edges, an anamorphic lens streak with a rainbow edge, soft swirled edges, heavy fine grain; still the same picture, no text.`,
  about: {
    zh: "红外残影：红外与反相黑白摄影里的世界，被一台机器重新读出来的记忆——树叶、皮肤和云发着白光，天空和静水沉成深色，中间是柔和的银灰；只有一种颜色，血一样的猩红，落在一棵树的树冠上、或一片晕染过天空的红雾里，柔柔地渗进灰色。镜头的毛病都在上面：亮处的辉光和泛红的光晕，越往边缘越明显的红青色差，一道带彩虹边的横向拉丝光斑，两端是棱镜折出的彩虹光，画面四周发软、微微旋开；一条画面被拉成竖直的拉丝错帧；很重很细的颗粒；主体旁边几小簇青色的等宽代码和坐标，像机器在读这段记忆，频道代号和品牌名就写在里面。没有照片时，是一片起雾的湖岸：伞一样的松树，树冠发白光，其中一棵是红的，静水倒映着天光，低低的雾，发光的云；可以加一个由频道图形变成的白色幽灵身影。有照片时，照片会被调成红外黑白（主要取绿色通道，草木和皮肤变白、天空变暗），留下照片里的红，可以把暗部翻成亮部做局部反相，再加红雾、拉丝和光斑。标题是细的无衬线字，带一点红青错位；高亮字是那一抹红。深色底是夜里的版本，浅色底是曝光过度、反过来的白昼，太阳是黑的。安静、诡异、像梦又像故障——适合情绪、记忆、悬疑、科幻、音乐、摄影和艺术类内容。自带平直的版式。",
    en: "Infrared ghost: the world of infrared and inverted black-and-white photography, as a memory read back by a machine — foliage, skin and clouds glowing white, the sky and still water gone dark, soft silver greys between; one colour only, a blood-scarlet red, in a tree's crown or a wash across the sky, bleeding softly into the greys. The lens's faults over it all: bloom and a red halation round the lights, red and cyan fringes growing toward the edges, an anamorphic streak with a rainbow edge and prism light at its ends, the edges gone soft and swirled; a band of the picture dragged down into streaks (slit-scan); heavy fine grain; a few small clusters of cyan monospace code and coordinates beside the subject, as if a machine were reading it, the channel's code and the brand written into them. Without a photo, a misty lakeshore: umbrella pines with glowing white crowns, one of them red, still water mirroring the bright sky, low fog, glowing clouds, and a white ghost made from the channel graphic if you like. With a photo, it is graded into infrared black and white (mostly from the green: plants and skin go white, the sky dark), its own reds kept, its shadows folded over into light if you like (a partial inversion), with the red wash, the smear and the flare over it. The title is a thin grotesk with a slight red and cyan split; the highlighted words take the red. The dark ground is the night version; the light one the overexposed, inverted day, its sun black. Quiet, uncanny, dreamlike and glitched — for mood, memory, mystery, science fiction, music, photography and art. Flat layouts of its own.",
  },
  name: { zh: "红外残影", en: "Infrared ghost" },
  seeded: true,
  leave: irFreeAll,   // its kept layers and work canvases go as another look is chosen
  scene: { red: { zh: "一抹红（红树与红雾）", en: "The red (tree and wash)" }, flare: { zh: "横向光斑", en: "Lens flare" }, smear: { zh: "拉丝错帧", en: "Slit-scan smear" }, data: { zh: "数据代码", en: "Data readout" }, figure: { zh: "幽灵身影", en: "Ghost figure" } },
  params: [
    { key: "trees", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "伞松树影", en: "Umbrella pines" } },
    { key: "red", min: 0, max: 1, step: 0.05, def: 0.75, name: { zh: "一抹红", en: "The red" } },
    { key: "wash", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "红雾晕染", en: "Red wash" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "发光的云", en: "Glowing clouds" } },
    { key: "water", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "静水倒影", en: "Still water" } },
    { key: "fog", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "低雾", en: "Low fog" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "幽灵身影", en: "Ghost figure" } },
    { key: "flare", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "横向光斑与棱镜光", en: "Flare streak and prism light" } },
    { key: "slit", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "拉丝错帧", en: "Slit-scan smear" } },
    { key: "data", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "数据代码", en: "Data readout" } },
    { key: "lens", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "镜头色散与柔边", en: "Lens fringes and soft edges" } },
    { key: "bloom", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "辉光", en: "Bloom" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "颗粒", en: "Grain" } },
    { key: "ir", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片红外化", en: "Photo in infrared" } },
    { key: "invert", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0, name: { zh: "照片局部反相", en: "Photo partly inverted" } },
  ],
  titleFont: (f) => f.cn,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => { const W = irWorld(); return { ...base, field: css(W.sky[1]), text: css(W.text), own: css(W.text), dim: css(W.text, 0.6), titleFill: css(W.text), titleInk: css(W.ink), grid: () => css(W.text, dark ? 0.24 : 0.28) }; },   // dotted lines: stronger than a solid grid's
  /**
   * The ground: the sky to the haze at the horizon and the deep below. Then the scene, painted once and kept while
   * nothing it reads changes (keptLayer; with the ground as it was painted under it, so the water mirrors it): the
   * clouds, the sun, the red wash, the far row in the haze, the fog, the near pines, the red tree, the ghost; the
   * still water mirroring it all; fog along the shore; the slit-scan smear; the flare streak and prism light; the
   * lens's soft edges and its vignette. The machine's lines over it, each time. A photo is graded into infrared, its
   * reds kept; filling the canvas, it takes the red wash (as a colour, so its lights stay white), the flare, the
   * smear, the lens and the lines too.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, F = irField(env), can = canPaint(ctx), fs = irFs(w, h);
    const T = can ? titleArea(ctx, env) : null, keep = irKeep(ctx, env), P = irPlace(F, T, keep, p, fs);
    // the scene objects: the red (its tree and its wash; the code block and the smear's line follow it), the flare's
    // source, the smear's line, the code block (placed in irData), the ghost (below)
    const c0 = [P.crown.x + P.crown.w / 2, P.crown.y + P.crown.h / 2], [rx, ry] = p.red > 0 || p.wash > 0 ? objAt("red", c0[0], c0[1], ctx) : c0, mx = rx - c0[0], my = ry - c0[1];
    if (mx || my) {
      P.tree = { ...P.tree, x: P.tree.x + mx, base: P.tree.base + my }; P.crown = { ...P.crown, x: P.crown.x + mx, y: P.crown.y + my };
      P.smear = { x0: P.smear.x0 + mx, x1: P.smear.x1 + mx, y: P.smear.y + my }; P.data = { ...P.data, x: P.data.x + mx, y: P.data.y + my };
      P.marks = P.marks.map((m) => ({ x: m.x + mx, y: m.y + my })); P.pines = P.pines.map((q) => ({ ...q, x: q.x + mx }));   // the marks and the near pines with it (each placed undragged)
    }
    const [fx, fy] = p.flare > 0 ? objAt("flare", P.sun.x, P.sun.y, ctx) : [P.sun.x, P.sun.y];
    const sm = P.smear, half = (sm.x1 - sm.x0) / 2, [smx, smy] = p.slit > 0 ? objAt("smear", sm.x0 + half, sm.y, ctx) : [sm.x0 + half, sm.y];
    const smearOn = (c, to) => irSmear(c, smx - half, smx + half, smy, (to - smy) * (0.25 + 0.6 * p.slit), Math.min(1, p.slit * 2.2), 2210);
    if (env.photo) {
      env.drawPhoto(0, p.ir > 0 || p.invert > 0 ? { key: `ir|${p.ir}|${p.invert}|${p.red}`, fn: (d) => irPixels(d, p.ir, p.invert, p.red) } : null);   // the photo itself in infrared (see drawPhotoAt), its reds kept
      if (L.fill) {
        if (p.wash > 0) {   // the red laid on as a colour: its lights stay white, its darks dark, the tones between turn red
          ctx.save(); ctx.globalCompositeOperation = "color";
          for (let i = 0; i < 5; i++) { const a = rand(2300 + i * 1.7) * TAU, d = P.u * 0.3 * rand(2301 + i * 2.3) * (0.4 + p.wash), r = P.u * (0.3 + 0.25 * rand(2302 + i * 3.1)) * (0.5 + 0.9 * p.wash); irBlob(ctx, rx + Math.cos(a) * d, ry + Math.sin(a) * d * 0.7, r, IR.red, Math.min(1, p.wash * 1.6), 0.3); }
          ctx.restore();
        }
        irSun(ctx, fx, fy, P.sun.r, p.flare * 0.6);
        smearOn(ctx, h);
        irStreak(ctx, { x0: 0, y0: 0, x1: w, y1: h }, fx, fy, P.sun.r, p.flare, 2250, P.sun.x);
        irLens(ctx, w, h, p.lens, !fast);
        irData(ctx, env, P.data, P.marks, p.data, 2270);
        irLetGo(ctx);
      }
      return true;
    }
    if (L.ground !== false) irGround(ctx, w, h, F);
    if (!L.grid) return true;
    if (irAny(p)) {
      const W = irWorld(), fw = F.x1 - F.x0, sky = P.shore - F.y0, S = p.figure > 0 && can && graphicShape(env);
      // the ghost (a scene object): its handle at its middle, moved as dragged; dragged down into the water, it stands in it, painted over it (unmirrored)
      let G = null;
      if (S) { const gh = irGhostH(S, P.ghost.h), [gx, gy] = objAt("figure", P.ghost.x, P.ghost.foot - gh / 2, ctx); G = { ...P.ghost, x: gx, foot: gy + gh / 2 }; }
      const wet = !!G && p.water > 0 && G.foot > P.shore + 1;
      const n = p.trees > 0 ? 1 + p.trees * 2 : 0, near = P.pines.slice(0, Math.ceil(n)).map((q, i) => [q.x, q.H, q.cw, clamp(n - i), q.k]);   // the near pines beside the red one, where irPlace put them, one by one
      const scene = (x) => {
        if (L.base !== "clear" && x !== ctx) inPixels(x, () => x.drawImage(ctx.canvas, 0, 0));   // the ground as painted under it, for the water to mirror
        if (p.clouds > 0) for (let i = 0, n = 2 + p.clouds * 4; i < Math.ceil(n); i++) { const c = P.clouds[i]; irCloud(x, c.x, c.y, c.s0 * (0.7 + 0.6 * p.clouds), clamp(n - i), 2103 + i * 19); }   // the clouds, one by one, where irPlace put them
        irSun(x, fx, fy, P.sun.r, p.flare);
        if (p.wash > 0) irRedTree(x, P, 0, p.wash, 2120);   // the wash first: it lies in the sky, behind the trees
        if (p.trees > 0) irFarRow(x, F, P.shore, sky, 6 + 18 * p.trees * (fw / 1920), 0.85, 2130);
        if (p.fog > 0) dkFogBand(x, F.x0, F.x1, P.shore - sky * 0.08, sky * 0.1, W.fog, 0.55 * p.fog, 2140);
        for (const [tx, H, cw, a, k] of near) irPine(x, tx, P.tree.base, H, cw, W.crown, W.shade, W.trunk, a, k);
        if (p.red > 0) irRedTree(x, P, p.red, 0, 2120);
        if (G && !wet) irGhost(x, S, G.x, G.foot, G.h, Math.min(1, p.figure * 4));
        if (p.water > 0) reflectBelow(x, F.x0, F.x1, P.shore, P.shore + (F.y1 - P.shore) * (0.35 + 0.65 * p.water), W.deep, dark ? 0.3 : 0.25, dark ? 0.82 : 0.7, 2160);
        if (wet) irGhost(x, S, G.x, G.foot, G.h, Math.min(1, p.figure * 4));
        if (p.fog > 0) dkFogBand(x, F.x0, F.x1, P.shore + 2, sky * 0.07, W.fog, 0.5 * p.fog, 2170);
        smearOn(x, F.y1);
        irStreak(x, F, fx, fy, P.sun.r, p.flare, 2180, P.sun.x);
        irLens(x, w, h, p.lens);
      };
      const key = [seed, dark ? 1 : 0, L.base, w, h, F.x0, F.y0, F.x1, F.y1, T ? [T.x, T.y, T.w, T.h].map(Math.round).join(",") : "", (env.C || []).join(), ["trees", "red", "wash", "clouds", "water", "fog", "figure", "flare", "slit", "lens"].map((k) => p[k]).join(), rx, ry, fx, fy, smx, smy, G ? `${G.x},${G.foot},${JSON.stringify(figureRef(env))}` : ""].join("|");
      const kept = can ? keptLayer(ctx, "irBack", key, scene) : null;
      if (kept) inPixels(ctx, () => ctx.drawImage(kept, 0, 0)); else scene(ctx);
    }
    irData(ctx, env, P.data, P.marks, p.data, 2190);
    irLetGo(ctx);
    return true;
  },
  /** Fine dotted lines every 120, a small cross where they meet: the grid of a viewfinder. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 120;
    gridPen(ctx, color, 2); ctx.setLineDash([2, 10]); ctx.beginPath();
    for (let x = s; x < w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = s; y < h; y += s) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.beginPath();
    for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) { ctx.moveTo(x - 7, y); ctx.lineTo(x + 7, y); ctx.moveTo(x, y - 7); ctx.lineTo(x, y + 7); }
    ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: () => css(dark ? [19, 19, 22] : [224, 224, 222]), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** A frosted band: the light of the picture coming through toward its edge, dimming away from it. */
    body(ctx, box, nx, ny) {
      const W = irWorld(), at = (n, lo, hi) => (n > 0.5 ? hi : n < -0.5 ? lo : (lo + hi) / 2);
      const g = ctx.createLinearGradient(at(nx, box.x, box.x + box.w), at(ny, box.y, box.y + box.h), at(-nx, box.x, box.x + box.w), at(-ny, box.y, box.y + box.h));
      g.addColorStop(0, css(dark ? W.crown : [255, 255, 255], dark ? 0.12 : 0.55)); g.addColorStop(0.4, css(dark ? W.crown : [255, 255, 255], 0)); g.addColorStop(1, css([0, 0, 0], dark ? 0.25 : 0.05));
      ctx.fillStyle = g; ctx.fillRect(box.x, box.y, box.w, box.h);
    },
    /** Its edge: a hairline of light in the channel colour, glowing, split red and cyan either side, and a row of fine ticks inside it, as a sensor's ruler. */
    edge(ctx, run, nx, ny, C) {
      const at = (d) => run(-nx * d, -ny * d), c = dark ? mix(boost(C || IR.red, 0.6), [255, 255, 255], 0.25) : mix(boost(C || IR.red, 0.6), [0, 0, 0], 0.2);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      for (const [lw, al] of [[22, 0.07], [9, 0.18]]) { ctx.strokeStyle = css(c, al); ctx.lineWidth = lw; at(0); }
      ctx.lineWidth = 1.6; ctx.strokeStyle = css(IR.red, 0.85); at(-2.2); ctx.strokeStyle = css([40, 220, 255], 0.75); at(2.2);
      ctx.strokeStyle = css(c); ctx.lineWidth = 2.2; at(0);
      ctx.setLineDash([1.5, 22.5]); ctx.strokeStyle = css(dark ? IR_NIGHT.text : IR_DAY.text, 0.35); ctx.lineWidth = 10; at(9); ctx.setLineDash([1.5, 118.5]); ctx.lineWidth = 18; at(13); ctx.setLineDash([]);
    },
  },
  /**
   * A thin grotesk, its letters spread a little apart (each set at a light weight in the place its heavy weight
   * took, so the line keeps its measure), split red and cyan either side (the shadow slider spreads them further), a
   * soft dark (in the day a soft light) round them so they hold over the picture; the highlighted words in the red.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const W = irWorld(), fs = o.fs, s = Math.min(2, o.shadowAmt ?? 1), ink = o.fill || W.text, hi = o.hi || IR.red;
    const font = typeof ctx.font === "string" ? ctx.font : "", thin = irThin(font), chars = [];
    pass((a, x) => { let cx = x; for (const t of a.t) { const wd = ctx.measureText(t).width || 0; chars.push({ t, hi: a.hi, x: cx, w: wd, s: a.s, dy: a.dy }); cx += wd; } });
    if (thin) ctx.font = thin;
    try { irLetter(ctx, chars, fs, s, ink, hi); } finally { if (thin) ctx.font = font; }
  },
  // the graphics through the infrared: their colours to greys of their infrared lightness, a red kept red; on the night's dark block the small parts' ink turns white
  wrap: (ctx, C, p, plates) => (plates
    ? (dark ? mapped(ctx, { fill: { ink: IR_NIGHT.text }, stroke: { ink: IR_NIGHT.text } }) : ctx)
    : mapped(ctx, { fill: { ink: [12, 12, 14], light: IR.white, mid: [150, 150, 150], dark: [54, 54, 58], colour: (c) => irGrey(c) }, stroke: { ink: [12, 12, 14], light: IR.white }, line: 0.7 })),
  sticker: painters({ line: null, tone: irTone, shadow(ctx, draw) { ctx.save(); ctx.shadowColor = dark ? "rgba(255,255,255,0.55)" : "rgba(40,40,44,0.35)"; ctx.shadowBlur = 22; draw(dark ? "rgba(255,255,255,0.35)" : "rgba(40,40,44,0.2)"); ctx.restore(); } }),
  /** The corner tag: a frosted chip, a fine border, a red REC light, the tag in monospace capitals. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const W = irWorld(), f = fs * 0.5, label = String(str).toUpperCase();
    ctx.font = `500 ${f}px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, label, 3) + f * 2.6, h = f * 2, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(dark ? [8, 8, 10] : [255, 255, 255], dark ? 0.5 : 0.6); ctx.fillRect(x, top, w, h);
    ctx.strokeStyle = css(W.text, 0.55); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, top + 0.75, w - 1.5, h - 1.5);
    const r = f * 0.24;
    ctx.save(); if (!fast && canPaint(ctx)) { const m = ctx.getTransform(); ctx.shadowColor = css(IR.red, 0.9); ctx.shadowBlur = f * 0.6 * Math.hypot(m.a, m.b); }
    ctx.fillStyle = css(IR.red); ctx.fillRect(x + f * 0.7, top + h / 2 - r, r * 2, r * 2); ctx.restore();
    ctx.fillStyle = ink || css(W.text); spaced(ctx, label, x + f * 1.6, top + h / 2 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a viewfinder — fine corner marks, the sensor's readout in the top corner, a timecode and the frame's number at the foot. */
  frame(ctx, env) {
    const { w, h } = env, W = irWorld(), b = 34, L = 40, f = 15, code = String((env.cat && (env.cat.code || env.cat.name)) || "IR").toUpperCase().slice(0, 10), i = (env.o && env.o.catIndex) || 0;
    ctx.save(); ctx.strokeStyle = css(W.text, 0.6); ctx.lineWidth = 2; ctx.lineCap = "butt";
    for (const [x, y, sx, sy] of [[b, b, 1, 1], [w - b, b, -1, 1], [w - b, h - b, -1, -1], [b, h - b, 1, -1]]) { ctx.beginPath(); ctx.moveTo(x, y + sy * L); ctx.lineTo(x, y); ctx.lineTo(x + sx * L, y); ctx.stroke(); }
    ctx.font = `500 ${f}px ${fonts.mono}`; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(W.text, 0.62); ctx.textAlign = "right";
    const right = (env.logo ? Math.min(w - b - 14, env.logo.x - 28) : w - b - 14);
    ctx.fillText(`IR 850NM  ISO 6400  CH.${code}`, right, b + 30);
    ctx.fillText(`${irStamp(seed + i * 7)}  F${String(1 + Math.floor(rand(seed + i) * 9998)).padStart(4, "0")}`, w - b - 14, h - b - 14);
    ctx.fillStyle = css(IR.red, 0.9); ctx.fillRect(right - ctx.measureText(`IR 850NM  ISO 6400  CH.${code}`).width - f * 1.1, b + 30 - f * 0.62, f * 0.55, f * 0.55);
    ctx.restore();
  },
  /** The plate under a text layer: a frosted slab, a fine border. */
  plate(ctx, x, y, w, h, colour) {
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(irWorld().text, 0.4); ctx.lineWidth = 1.5; ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  },
  image(ctx, C, unit) { ctx.shadowColor = dark ? "rgba(255,255,255,0.4)" : "rgba(30,30,34,0.3)"; ctx.shadowBlur = 26 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; },
  /** Over the finished cover: bloom and the red halation, the lens's colour fringes (left out while dragging), and the grain. */
  post(ctx, w, h, C, p, unit = 1) {
    if (canPaint(ctx) && !fast) { irBloom(ctx, p.bloom); irFringe(ctx, p.lens); }
    irGrain(ctx, p.grain, unit);
    irLetGo(ctx);
  },
  prompt: `Objects as an infrared black-and-white photograph shows them — ghostly, quiet, a little uncanny — that read at a glance:
- one clear object per sticker (a pine tree, a leaf, a moth, a camera, an eye, a film strip, a flower, a moon, a cassette, a hand), with a simple, strong silhouette; no realism, no fine detail;
- flat colour only: white and light greys for what glows (leaves, skin, clouds), dark greys for the rest, and the main colour, a single blood red, for one small part at most;
- the app turns every colour to the infrared greys and adds a soft glow: do NOT draw outlines, shadows or glows yourself.`,
  solidPrompt: `Things from a misty infrared landscape or a memory read back by a machine, built as simple models from a few boxes and cylinders — an old camera, a film projector, a lantern, a bench, a radio, a monitor; no realism, no fine detail.
- the renderer paints faces in silver greys and white: do NOT try to draw shading or outlines yourself;
- "white" is a glowing white, "dark" a deep grey, and "main" the one red — use it for one part only.`,
};
/** The figure's reference (for the kept scene's key): the graphic it is drawn from. */
const figureRef = (env) => { const g = env.figure || env.graphic; return g ? g.ref : null; };

infrared.elementFx = [
  { key: "infrared", name: { zh: "红外分调", en: "Infrared grade" }, for: FX_PHOTO, stage: "filter",
    /** The photo as an infrared black and white (see irPixels): foliage and skin glowing, the sky dark, its reds kept. */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); irPixels(img.data, a, 0, 0.9); x.putImageData(img, B.x0, B.y0); } },
  { key: "split", name: { zh: "红青错位", en: "Red and cyan split" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: B.w * 0.02 + 6 * k, r: B.w * 0.02 + 6 * k }),
    /** The layer taken apart into its red, green and blue and laid back added, the red moved one way and the blue the other. */
    paint(x, B, a, E) { const d = Math.max(1, (B.w * 0.006 + 2.5 * E.k) * (0.4 + a)); rePlate(x, B, [[[255, 0, 0], -d, 0], [[0, 255, 0], 0, 0], [[0, 0, 255], d, 0]]); } },
  { key: "smear", name: { zh: "拉丝错帧", en: "Slit-scan smear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ b: B.h * 0.7 }),
    /** A line across the layer dragged down into streaks past its foot (see irSmear), at a height of the layer's own. */
    paint(x, B, a, E) {
      const y = B.y0 + B.h * (0.35 + 0.35 * E.R(3)), len = (B.y1 - y) + B.h * 0.6 * a;
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); irSmear(x, B.x0, B.x1, y, len, Math.min(1, 0.5 + a), 5000 + E.seed % 997); x.restore();
    } },
  { key: "halo", name: { zh: "辉光晕染", en: "Glow and halation" }, for: FX_ALL, stage: "behind", reach: (B, k) => { const r = 60 * k + Math.min(B.w, B.h) * 0.12; return { l: r, t: r, r, b: r }; },
    /** A white glow round the layer and a wider one of the red beyond it, as the lights of the infrared throw them. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), R = (18 * E.k + Math.min(B.w, B.h) * 0.04) * (0.5 + a);
      glowBehind(x, B, src, R * 2.2, 0.55 * a, IR.red);
      glowBehind(x, B, src, R, Math.min(1, a * 1.3), [255, 255, 255]);
    } },
];
