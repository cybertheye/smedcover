// cosmo: retro-futurism, a space-age collage printed in the seventies and kept in a drawer
// A deep black starfield — a fine dust of stars, four-point sparkles with long cross glints, a spiral galaxy —
// planets as if cut from old astronomy books (shaded spheres, banded or cratered, a soft terminator, one with
// Saturn's rings, the main one in the channel colour), and a rainbow of six faded bands running straight down
// the page or sweeping off it in a curve, behind some things and in front of others; if you like, an eighties
// striped sun over a range of peaks and a perspective grid, cut-paper clouds along the foot, a saucer and its
// beam, floppy disks and tapes adrift. Then the print: blacks lifted to a warm charcoal, the colours faded,
// grain, dust, scratches, a fold and worn corners. On the light ground the same collage on cream paper: the
// stars ink specks, the planets plates from a book.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, WORK, canPaint, clamp, css, dark, dkHsl, dkRgb, dotFill, fall, fast, glowBehind, grain, gridPen, inPixels, inkAs, keepOthers, keptLayer, mapped, mix, noise, objAt, openField, painters, rand, region, ringsBehind, seed, starMark, titleArea, titleOnly, upright, vignette, wash, wear } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const CM = { space: [21, 19, 23], paper: [235, 226, 206], cream: [244, 235, 213], ink: [34, 29, 33], band: [27, 24, 27], shade: [9, 7, 11], plate: [44, 34, 40] };
/** The rainbow's six bands, faded as old print has them: red, orange, yellow, green, blue, violet. */
export const CM_BANDS = [[221, 76, 62], [237, 137, 58], [241, 196, 82], [98, 165, 104], [66, 139, 193], [131, 93, 168]];
/** The title's drops, from the letters down: yellow, orange, red, pink, violet, blue. */
const CM_DROPS = [CM_BANDS[2], CM_BANDS[1], CM_BANDS[0], [212, 86, 136], CM_BANDS[5], CM_BANDS[4]];
const cmGround = () => (dark ? CM.space : CM.paper), cmInk = () => (dark ? CM.cream : CM.ink);
/** A colour as old print keeps it: its saturation down a quarter (and never loud), its lightness drawn a little toward the middle. */
export function cmFade(c, k = 1) {
  const [hh, s, l] = dkHsl(c);
  return dkRgb(hh, Math.min(0.66, s) * (1 - 0.25 * k), l + (0.52 - l) * 0.16 * k);
}
/**
 * The main planet's colours from the channel colour: a banded giant in its hue, faded, its bands lighter, paler,
 * darker and a little warmer or cooler; a grey channel colour (little saturation) gives a cratered grey moon.
 */
export function cmPlanetCols(C) {
  const [hh, s] = dkHsl(C);
  if (s < 0.14) return { kind: "rock", base: [172, 164, 152], light: [204, 196, 182], dark: [122, 114, 106] };
  const S = clamp(s, 0.34, 0.58), at = (dh, L, ds = 0) => dkRgb((hh + dh + 360) % 360, clamp(S + ds), L);
  return { kind: "bands", base: at(0, 0.54), light: at(8, 0.7, -0.1), pale: at(14, 0.82, -0.2), dark: at(-8, 0.38), deep: at(-14, 0.28, 0.04) };
}
/** The small planets, in the order they come in: Saturn and its rings, a red one, the moon, an earth, an ice giant, a banded orange one. */
const CM_PLANETS = [
  { kind: "bands", base: [222, 196, 150], light: [240, 222, 184], pale: [246, 236, 210], dark: [190, 150, 104], deep: [160, 118, 84], ring: true, size: 1.35 },
  { kind: "red", base: [198, 92, 66], light: [222, 132, 96], dark: [150, 62, 50], size: 0.75 },
  { kind: "rock", base: [176, 168, 156], light: [206, 198, 184], dark: [126, 118, 110], size: 0.85 },
  { kind: "earth", base: [60, 116, 162], light: [118, 150, 92], dark: [196, 170, 120], size: 0.9 },
  { kind: "ice", base: [106, 184, 190], light: [150, 212, 210], dark: [76, 150, 162], size: 0.8 },
  { kind: "bands", base: [222, 146, 92], light: [240, 196, 148], pale: [246, 222, 188], dark: [176, 96, 66], deep: [140, 70, 54], size: 1 },
];
/**
 * The boxes the scene would rather keep off (it is the background, and these lie over it): the title as it will be set
 * (with its subtitle), the corner tag, the channel graphic, the brand row and the logo.
 */
function cmKeep(ctx, env) {
  const T = titleArea(ctx, env), only = titleOnly(ctx, env), s = env.sub && (env.sub.ink || env.sub.box);
  const words = (only && s ? [only, s] : T ? [T] : []).map((b) => ({ x: b.x - 30, y: b.y - 30, w: b.w + 60, h: b.h + 60 })), out = [...words, ...keepOthers(env)];   // the title and its subtitle each its own box, so the room beside a short subtitle counts
  if (env.hasBrand) out.push({ x: 40, y: 40, w: env.w - 80, h: 96 });   // the brand row, and its rail out to the right
  if (env.logo) out.push({ x: env.logo.x - 20, y: env.logo.y - 20, w: env.logo.w + 40, h: env.logo.h + 40 });
  return { T, keep: out, words };
}
/** How far (x, y) lies from box b: 0 inside it. */
const cmDist = (x, y, b) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
/**
 * Where everything stands (a pure function of the cover, the look's values and the seed). Each part must keep on the
 * canvas and off the colour block (a layer over the scene, under which a part would be lost from sight), and would
 * rather keep clear of the words, the tag, the graphic, the brand row and the logo (`keep`: layers over the scene too,
 * so a part goes behind them where there is no room) and of the parts placed before it. Each part's place is found at
 * its largest size, and each takes the room of its largest size whether it is on or not, so a slider sizes and fades
 * its own part where it stands and moves nothing else. `room`: beside the words (right or left) where the beam fits
 * there at its widest, else under or over them, the whole field without a title. The beam (`x`, its top `y0` and foot
 * `y1`, width `W`, `dir` the side its sweep goes) runs the whole height: beside the words, clear of them; else behind
 * the main planet's near side, fading out over the words' span (`gap`). The main planet, as large as fits on the
 * field up to its largest, where it reaches least over the words nearest where it is wanted; the sun on the horizon
 * clear of the words where it can be, where that planet hides least of it; the galaxy, the saucer, the small planets,
 * the disks and the sparkles each at the first of their seeded places that is clear of all of it, else at the place
 * with the most room (behind the words if need be, over another part if there is no other way), brought onto the
 * canvas: none is left out.
 */
export function cmPlan(ctx, env, p) {
  const { w, h } = env, F0 = openField(env), u = Math.min(w, h), m = u * 0.012, gap = u * 0.02, mw = u * 0.04, { T, keep, words } = cmKeep(ctx, env);
  // the open field up to the middle of the colour block's edge (a slanted block reaches over part of the field openField gives); `inside(x, y)`: how far a point lies on the field's side of that edge, along its normal N
  const E = env.G && env.G.edge, F = { ...F0 };
  let inside = () => Infinity, N = [0, 0];
  if (E && F0.side !== "none") {
    const [ax, ay, bx0, by0] = E.line, l = Math.hypot(bx0 - ax, by0 - ay) || 1, s = (by0 - ay) * E.nx - (bx0 - ax) * E.ny >= 0 ? 1 : -1, nx = (s * (by0 - ay)) / l, ny = (-s * (bx0 - ax)) / l;
    inside = (x, y) => (x - ax) * nx + (y - ay) * ny; N = [nx, ny];
    if (F0.side === "below") F.y1 = (ay + by0) / 2; else if (F0.side === "above") F.y0 = (ay + by0) / 2; else if (F0.side === "right") F.x1 = (ax + bx0) / 2; else F.x0 = (ax + bx0) / 2;
  }
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, taken = [];
  // what a part (half-extents hx, hy; rn how far it reaches toward the block) has to spare at (x, y), on the canvas and off the block; then also from what stands already (r its own room): below 0, by how much it is out
  const spare = (x, y, hx, hy, rn = Math.abs(N[0]) * hx + Math.abs(N[1]) * hy) => Math.min(x - hx, w - x - hx, y - hy, h - y - hy, inside(x, y) - rn) - m;
  // how far a part (its room r) at (x, y) keeps clear of the words and the rest the scene would rather keep off — and, for one drawn behind the beam (`back`), of the band the beam may stand in: below 0, by how much it reaches behind them
  let band = null;
  const clearAt = (x, y, r, back = false) => Math.min(keep.length ? Math.min(...keep.map((b) => cmDist(x, y, b))) : Infinity, back && band ? cmDist(x, y, band) : Infinity) - r - m;
  // a place brought onto the canvas and off the block, where it is not
  const settle = (x, y, hx, hy) => {
    for (let i = 0; i < 2; i++) {
      x = clamp(x, hx + m, Math.max(hx + m, w - hx - m)); y = clamp(y, hy + m, Math.max(hy + m, h - hy - m));
      const d = inside(x, y) - (Math.abs(N[0]) * hx + Math.abs(N[1]) * hy) - m;
      if (d < 0) { x -= N[0] * d; y -= N[1] * d; }
    }
    return [x, y];
  };
  // the first of a part's seeded places in `box` that is clear of all of it; else (with `grid`) the place over the field with the most room — on the canvas and off the block before all, then clear of the words (behind them a part is lost from sight; the beam too, for one drawn behind it), then of the parts before it, `g` apart (over one, it still shows) (`key`: below 0, short of that)
  const seek = (k, hx, hy, r, tries, { box: [x0, y0, x1, y1] = [F.x0, F.y0, F.x1, F.y1], g = gap, grid = true, back = false } = {}) => {
    let best = null;
    const at = (x, y) => {
      const s = spare(x, y, hx, hy), v = Math.min(s, ...taken.map((q) => Math.hypot(q.x - x, q.y - y) - q.r - r - g)), c = clearAt(x, y, r, back), key = s < 0 ? s - 3e6 : c < 0 ? c - 2e6 : v < 0 ? v - 1e6 : Math.min(v, c);
      if (!best || key > best.key) best = { x, y, key };
      return key >= 0;
    };
    for (let i = 0; i < tries; i++) if (at(x0 + (x1 - x0) * (0.06 + 0.88 * rand(k + i * 7.13)), y0 + (y1 - y0) * (0.06 + 0.88 * rand(k + i * 9.71 + 0.5)))) return best;
    if (grid) for (let i = 0; i <= 24; i++) for (let j = 0; j <= 18; j++) at(F.x0 + (fw * i) / 24, F.y0 + (fh * j) / 18);
    return best;
  };
  const stand = (at, hx, hy, r) => { const [x, y] = settle(at.x, at.y, hx, hy); taken.push({ x, y, r }); return [x, y]; };
  // the beam's room, judged at its widest (so its slider does not move it): beside the words where it fits there, else under (or over) them
  const Wtop = u * 0.18, W = u * (0.08 + 0.1 * p.rainbow);
  const whole = { x0: F.x0, x1: F.x1, y0: F.y0, y1: F.y1, side: 0, at: "all" };
  const side = T ? [{ x0: T.x + T.w + mw, x1: F.x1, y0: F.y0, y1: F.y1, side: 1, at: "right" }, { x0: F.x0, x1: T.x - mw, y0: F.y0, y1: F.y1, side: -1, at: "left" }] : [];
  const level = T ? [{ x0: F.x0, x1: F.x1, y0: T.y + T.h + mw, y1: F.y1, side: 0, at: "below" }, { x0: F.x0, x1: F.x1, y0: F.y0, y1: T.y - mw, side: 0, at: "above" }] : [];
  const score = (R) => Math.min(R.x1 - R.x0, (R.y1 - R.y0) * 1.1), best = (list) => list.reduce((a, b) => (!a || score(b) > score(a) ? b : a), null);
  const wide = best(side.filter((R) => R.x1 - R.x0 >= Wtop * 1.5)), low = best(level);
  let room = !T ? whole : wide && (!low || score(wide) >= Wtop * 1.5) ? wide : low && score(low) >= u * 0.14 ? low : best([...side, ...level]);
  if (!room || score(room) < u * 0.1) room = whole;   // no room worth the name: the field
  const rw = room.x1 - room.x0, rh = room.y1 - room.y0, dir = room.side || (rand(4100) < 0.5 ? 1 : -1), beside = !!room.side;
  // beside the words the beam runs clear of them, at a seeded place in the room; under or over them, behind the main planet's near side
  let bx = beside ? (dir > 0 ? room.x0 + Math.min(rw * (0.3 + rand(4101) * 0.12), Math.max(Wtop * 0.75, rw - Wtop * 1.2)) : room.x1 - Math.min(rw * (0.3 + rand(4101) * 0.12), Math.max(Wtop * 0.75, rw - Wtop * 1.2))) : F.x0 + fw * (dir > 0 ? 0.62 + rand(4101) * 0.1 : 0.38 - rand(4101) * 0.1);
  // the main planet: where it reaches least over the words at its default size (rn), nearest where it is wanted — over the beam's far edge beside the words, toward the room's far side under them — with room there to grow; drawn at its slider's size there, up to what fits there on the canvas (R) and its largest
  const rTop = u * 0.38, want = [beside ? bx + dir * (Wtop * 0.5 + u * 0.09) : F.x0 + fw * (dir > 0 ? 0.74 : 0.26), room.y0 + rh * (0.42 + rand(4102) * 0.08)], cx = fw / 24, cy = fh / 18;
  let rn = 0, home = null, top = -Infinity;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 18; j++) rn = Math.max(rn, spare(F.x0 + cx * i, F.y0 + cy * j, 0, 0, 0));
  rn = Math.min(u * 0.292, rn);   // its default size, where that fits on the field
  const tryAt = (x, y) => { const f = spare(x, y, 0, 0, 0); if (f < rn - 0.5) return; const s = 1.5 * Math.min(0, clearAt(x, y, rn)) - 0.3 * Math.hypot(x - want[0], y - want[1]) + 0.3 * Math.min(f, rTop); if (s > top) { top = s; home = { x, y, R: Math.min(rTop, f) }; } };
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 18; j++) tryAt(F.x0 + cx * i, F.y0 + cy * j);   // rn is at most the most room of these, so one of them takes it
  for (let pass = 0; pass < 2; pass++) { const c = home, k = pass ? 0.25 : 0.5; for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryAt(c.x + cx * k * i, c.y + cy * k * j); }   // then finer about the best
  taken.push({ x: home.x, y: home.y, r: home.R });
  const planet = p.planet > 0 ? { x: home.x, y: home.y, r: Math.min(home.R, u * (0.16 + 0.22 * p.planet)) } : null;
  // under or over the words, the beam behind the planet's near side (through where it would stand, when it is not there), not behind the corner tag
  const tg = env.G && env.G.tag, beamX = (r, Wd) => {
    const x = clamp(home.x - dir * (r * 0.8 + Wd * 0.1), F.x0 + Wd * 0.6, F.x1 - Wd * 0.6);
    return tg && x + Wd / 2 > tg.x - 20 && x - Wd / 2 < tg.x + 400 ? Math.min(Math.max(x, tg.x + 400 + Wd * 0.6), F.x1 - Wd * 0.6) : x;
  };
  if (!beside) bx = beamX(planet ? planet.r : 0, W);
  const [b0, b1] = beside ? [bx, bx] : [beamX(0, Wtop), beamX(home.R, Wtop)];
  band = { x: Math.min(b0, b1) - Wtop / 2, y: F.y0 - 20, w: Math.abs(b1 - b0) + Wtop, h: fh + 40 };   // where the beam may stand, whatever the sliders: what is drawn behind it would rather keep out of it
  const beam = p.rainbow > 0 ? { x: bx, y0: F.y0 - 20, y1: F.y1 + 20, W, dir, gap: T && !beside ? [T.y - mw * 0.5, T.y + T.h + mw * 0.5] : null } : null;   // under or over the words it runs the whole height still, fading out behind them (`gap`)
  if (beam && T) {   // its sweep goes under the words when, swept all the way at its widest behind the planet at its largest, it passes clear of them; else the other way
    const ox = beside ? bx : beamX(home.R, Wtop), under = { ...beam, W: Wtop, dir: T.x + T.w / 2 < ox ? -1 : 1 }, path = cmBeamPath(under, ox, beam.y0, 1, w, F);
    const clearOf = path.pts.every(([x, y], i) => (beam.gap && y > beam.gap[0] - 70 && y < beam.gap[1] + 70) || words.every((b) => cmDist(x, y, b) > path.ws[i] / 2));
    beam.dir = clearOf ? under.dir : -under.dir;
  }
  // the sun: on the horizon, clear of the words where it can be, where the main planet hides least of it, found with both at their largest (the horizon at its highest), so no slider moves it sideways; the horizon rises with its slider
  const hzTop = F.y1 - fh * 0.26, rSun = Math.min(fw * 0.2, fh * 0.3), hidden = (x) => Math.max(0, home.R + rSun - Math.hypot(home.x - x, home.y - hzTop)) / rSun;
  let sx = F.x0 + fw * 0.5, sk = null;
  for (const t of [room.side ? (room.x0 + room.x1) / 2 : F.x0 + fw * (dir > 0 ? 0.64 : 0.36), ...[0.5, 0.3, 0.7, 0.2, 0.8].map((f) => F.x0 + fw * f)]) {
    if (inside(t, hzTop) <= 0) continue;
    const k = [clearAt(t, hzTop - rSun * 0.08, rSun) < 0 ? 1 : 0, hidden(t)];
    if (!sk || k[0] < sk[0] || (k[0] === sk[0] && k[1] < sk[1] - 0.05)) { sx = t; sk = k; }
  }
  taken.push({ x: sx, y: hzTop - rSun * 0.58, r: rSun * 0.5 });   // its upper half, at its largest
  let sun = null, hz = F.y1;
  if (p.sunset > 0) { hz = F.y1 - fh * (0.14 + 0.12 * p.sunset); const r = rSun * (0.6 + 0.4 * p.sunset); sun = { x: sx, y: hz - r * 0.08, r }; }
  // the galaxy (a tilted disc: its box from its tilt), each part found at its largest
  const ang = -0.5 + (rand(4301) - 0.5) * 0.5, GR = u * 0.2, ghx = GR * Math.hypot(Math.cos(ang), 0.42 * Math.sin(ang)), ghy = GR * Math.hypot(Math.sin(ang), 0.42 * Math.cos(ang));
  const ga = stand(seek(4300, ghx, ghy, GR * 0.6, 60, { back: true }), ghx, ghy, GR * 0.6), galaxy = p.galaxy > 0 ? { x: ga[0], y: ga[1], R: u * (0.1 + 0.1 * p.galaxy), ang } : null;
  // the saucer: in the upper part of the room if it can, else anywhere
  const US = u * 0.2, uhx = US * 0.5, uhy = US * 0.2, ur = US * 0.55, up = seek(4400, uhx, uhy, ur, 60, { box: [room.x0, room.y0, room.x1, room.y0 + rh * 0.6], grid: false });
  const ua = stand(up.key >= 0 ? up : [up, seek(4410, uhx, uhy, ur, 90)].reduce((a, b) => (b.key > a.key ? b : a)), uhx, uhy, ur), ufo = p.ufo > 0 ? { x: ua[0], y: ua[1], s: u * (0.12 + 0.08 * p.ufo) } : null;
  // the small planets and the disks: every one has its place, and the slider brings them in one after another
  const smalls = [], nP = p.planets * CM_PLANETS.length;
  CM_PLANETS.forEach((P, k) => {
    const r = u * (0.03 + rand(k * 3.3 + 4110) * 0.03) * P.size, hx = P.ring ? r * 2.15 : r, at = stand(seek(4120 + k * 131, hx, r, hx, 90, { back: k % 2 === 1 }), hx, r, hx);   // every other one behind the beam
    if (k < Math.ceil(nP)) smalls.push({ x: at[0], y: at[1], r, P, k, a: clamp(nP - k), front: k % 2 === 0 });
  });
  const disks = [], nD = p.tech * 4;
  for (let k = 0; k < 4; k++) {
    const tape = k % 3 === 2, s = u * (0.075 + rand(k * 2.7 + 4500) * 0.04), r = s * (tape ? 0.95 : 0.75), at = stand(seek(4510 + k * 97, r, r, r, 90), r, r, r);
    if (k < Math.ceil(nD)) disks.push({ x: at[0], y: at[1], s, rot: (rand(k * 3.9 + 4501) - 0.5) * 1.1, tape, col: [CM_BANDS[0], CM_BANDS[3], CM_BANDS[1], CM_BANDS[4]][k % 4], a: clamp(nD - k) });
  }
  // the sparkles over the field, off the parts
  const sparkles = [], nS = p.sparkles * 12;
  for (let k = 0; k < Math.ceil(nS); k++) {
    const r = u * (0.008 + rand(k * 2.3 + 4600) ** 2 * 0.026), at = seek(4601 + k * 53, r * 1.6, r * 1.6, r * 1.6, 24, { g: 0, grid: false }), [x, y] = settle(at.x, at.y, r * 1.6, r * 1.6);
    sparkles.push({ x, y, r, a: clamp(nS - k) });
  }
  return { F, u, room, T, keep, words, beam, planet, smalls, galaxy, ufo, disks, sparkles, sun, hz };
}
/** A slow wander of the starfield's density over the picture (0–1), by the seed: the dust thicker here, thinner there. */
const cmDrift = (x, y, w, h) => clamp(0.5 + 0.28 * Math.sin((x / w) * 5.1 + rand(4090) * 6) * Math.cos((y / h) * 4.3 + rand(4091) * 6) + 0.22 * Math.sin(((x + y) / (w + h)) * 9 + rand(4092) * 6));
/**
 * The starfield: a fine dust of square specks, gathered by colour and strength so a dozen fills paint thousands,
 * then round stars, the larger with a soft glow; mostly a warm white, some amber, blue and pink. On paper, specks of ink.
 */
function cmStars(x, w, h, amt) {
  const area = (w * h) / (1920 * 1080), cols = dark ? [CM.cream, [255, 196, 150], [186, 204, 255], [255, 172, 196]] : [CM.ink, CM.ink, [66, 54, 64], [56, 64, 92]], buckets = new Map();
  for (let k = 0, n = Math.round((dark ? 4200 : 2200) * amt * area); k < n; k++) {
    const px = rand(k * 1.37 + 4000) * w, py = rand(k * 2.71 + 4001) * h;
    if (rand(k * 3.17 + 4002) > 0.4 + 0.6 * cmDrift(px, py, w, h)) continue;
    const c = rand(k * 5.3 + 4003), key = (c < 0.1 ? 1 : c < 0.17 ? 2 : c < 0.2 ? 3 : 0) * 3 + Math.floor(rand(k * 4.1 + 4004) * 3), s = 0.75 + rand(k * 6.7 + 4005) ** 3 * 1.4;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(px, py, s);
  }
  for (const [key, list] of buckets) { x.fillStyle = css(cols[(key / 3) | 0], [0.3, 0.55, 0.88][key % 3] * (dark ? 1 : 0.75)); for (let i = 0; i < list.length; i += 3) x.fillRect(list[i], list[i + 1], list[i + 2], list[i + 2]); }
  for (let k = 0, n = Math.round((dark ? 320 : 160) * amt * area); k < n; k++) {
    const px = rand(k * 2.13 + 4050) * w, py = rand(k * 3.07 + 4051) * h, r = 0.9 + rand(k * 4.3 + 4052) ** 4 * 2.4, c = cols[rand(k * 5.9 + 4053) < 0.25 ? 1 + Math.floor(rand(k * 6.1 + 4054) * 3) : 0];
    if (dark && r > 1.8) { const g = x.createRadialGradient(px, py, 0, px, py, r * 5); g.addColorStop(0, css(c, 0.32)); g.addColorStop(1, css(c, 0)); x.fillStyle = g; x.fillRect(px - r * 5, py - r * 5, r * 10, r * 10); }
    x.fillStyle = css(c, 0.6 + 0.4 * rand(k * 7.3 + 4055)); x.beginPath(); x.arc(px, py, r, 0, TAU); x.fill();
  }
}
/** A four-point sparkle: a small soft glow (on the night), two long glints across it fading to nothing, the star itself. */
function cmSparkle(ctx, x, y, r, col, a) {
  ctx.save(); ctx.globalAlpha = a;
  if (dark) { const g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.6); g.addColorStop(0, css(col, 0.3)); g.addColorStop(0.4, css(col, 0.08)); g.addColorStop(1, css(col, 0)); ctx.fillStyle = g; ctx.fillRect(x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2); }
  const L = r * 3.6, t = Math.max(1, r * 0.07);
  for (const across of [true, false]) {
    const g = across ? ctx.createLinearGradient(x - L, y, x + L, y) : ctx.createLinearGradient(x, y - L, x, y + L);
    g.addColorStop(0, css(col, 0)); g.addColorStop(0.5, css(col, 0.9)); g.addColorStop(1, css(col, 0));
    ctx.fillStyle = g; across ? ctx.fillRect(x - L, y - t / 2, L * 2, t) : ctx.fillRect(x - t / 2, y - L, t, L * 2);
  }
  starMark(ctx, x, y, r, 4, col);
  ctx.restore();
}
/**
 * The spiral galaxy, face on, `R` canvas pixels across its radius: a glow warm at the core and bluish out to its
 * edge, two arms of thousands of motes wound about it with lanes of dust inside them, a few pink knots; on paper
 * stippled in ink, its core dark. Kept per size, ground and seed (a few), laid down tilted and foreshortened.
 */
function cmGalaxyArt(R) {
  const kept = WORK.cmGalaxy || (WORK.cmGalaxy = new Map()), key = `${Math.round(R)}|${seed}|${dark ? 1 : 0}`;
  if (kept.has(key)) return kept.get(key);
  const S = Math.ceil(R * 2.2), c = document.createElement("canvas"); c.width = c.height = S;
  const x = c.getContext("2d"), halo = x.createRadialGradient(0, 0, 0, 0, 0, R);
  x.translate(S / 2, S / 2);
  for (const [t, col, a] of dark ? [[0, [255, 242, 222], 0.95], [0.05, [255, 214, 172], 0.75], [0.16, [234, 162, 140], 0.34], [0.42, [160, 168, 212], 0.12], [1, [140, 150, 200], 0]] : [[0, CM.ink, 0.9], [0.06, [64, 48, 52], 0.6], [0.22, [90, 78, 86], 0.2], [1, [90, 80, 90], 0]]) halo.addColorStop(t, css(col, a));
  x.fillStyle = halo; x.fillRect(-R, -R, R * 2, R * 2);
  const arm = (t, i) => i * Math.PI + t * 7.4, dot = Math.max(0.7, R / 160);
  x.lineCap = "round"; x.strokeStyle = dark ? "rgba(10,8,12,0.32)" : "rgba(235,226,206,0.5)";
  for (let i = 0; i < 2; i++) { x.lineWidth = R * 0.035; x.beginPath(); for (let t = 0.1; t <= 0.9; t += 0.02) { const a = arm(t, i) - 0.32, rr = R * (0.07 + 0.88 * t) * 0.93; x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } x.stroke(); }
  for (let k = 0, n = Math.min(5000, Math.round(R * 14)); k < n; k++) {
    const i = k % 2, t = rand(k * 1.91 + 4200) ** 0.85, g = rand(k * 2.3 + 4201) + rand(k * 3.1 + 4202) + rand(k * 4.7 + 4203) - 1.5, a = arm(t, i) + g * 0.35, rr = R * (0.07 + 0.88 * t) * (1 + g * 0.12);
    const knot = rand(k * 5.9 + 4204) < 0.035, col = !dark ? CM.ink : knot ? [255, 150, 182] : t < 0.25 ? [255, 228, 196] : rand(k * 6.1 + 4205) < 0.6 ? [206, 218, 255] : CM.cream;
    x.fillStyle = css(col, (0.25 + 0.65 * rand(k * 7.3 + 4206)) * (dark ? 1 : 0.7)); x.beginPath(); x.arc(Math.cos(a) * rr, Math.sin(a) * rr, dot * (knot ? 1.8 : 0.5 + rand(k * 8.1 + 4207) ** 3 * 1.4), 0, TAU); x.fill();
  }
  const core = x.createRadialGradient(0, 0, 0, 0, 0, R * 0.14); core.addColorStop(0, css(dark ? [255, 250, 240] : CM.ink, 0.95)); core.addColorStop(1, css(dark ? [255, 220, 180] : CM.ink, 0));
  x.fillStyle = core; x.fillRect(-R * 0.14, -R * 0.14, R * 0.28, R * 0.28);
  kept.set(key, c);
  if (kept.size > 4) { const [k0, v] = kept.entries().next().value; v.width = v.height = 0; kept.delete(k0); }
  return c;
}
/** The galaxy at (x, y), `R` units across its radius, tilted by `ang` and foreshortened to a fifth over a half; without a canvas, its glow alone. */
function cmGalaxy(ctx, x, y, R, ang, a) {
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1, 0.42);
  if (canPaint(ctx)) { const m = ctx.getTransform(), k = Math.hypot(m.a, m.b) || 1, c = cmGalaxyArt(R * k), S = c.width / k; ctx.drawImage(c, -S / 2, -S / 2, S, S); }
  else { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R); g.addColorStop(0, css(CM.cream, 0.8)); g.addColorStop(1, css(CM.cream, 0)); ctx.fillStyle = g; ctx.fillRect(-R, -R, R * 2, R * 2); }
  ctx.restore();
}
/** Bands round a gas giant: wavering strips of its tones, tilted with it, overlapping a little see-through; a storm's oval on a large one. */
function cmBanding(ctx, r, P, k0) {
  const cols = [P.light, P.base, P.pale || P.light, P.dark, P.base, P.light, P.deep || P.dark, P.pale || P.base];
  for (let yy = -r * 1.05, i = 0; yy < r * 1.05; i++) {
    const t = Math.abs(yy / r), bh = r * (0.05 + rand(k0 + i * 1.3) * 0.14) * (1 - 0.45 * t), ph = rand(k0 + i * 4.1) * TAU, f = 1.5 + rand(k0 + i * 5.3) * 2.5, amp = bh * 0.22;
    ctx.fillStyle = css(cols[Math.floor(rand(k0 + i * 2.9) * cols.length)], 0.5 + 0.5 * rand(k0 + i * 6.7)); ctx.beginPath();
    for (let s = 0; s <= 14; s++) { const xx = -r * 1.1 + (s / 14) * r * 2.2; ctx.lineTo(xx, yy + Math.sin((xx / r) * f + ph) * amp); }
    for (let s = 14; s >= 0; s--) { const xx = -r * 1.1 + (s / 14) * r * 2.2; ctx.lineTo(xx, yy + bh + Math.sin((xx / r) * f + ph + 1.3) * amp); }
    ctx.fill();
    yy += bh * (0.65 + rand(k0 + i * 7.9) * 0.45);
  }
  if (r > 60) { const sx = r * (0.1 + rand(k0 + 91) * 0.3), sy = r * (0.18 + rand(k0 + 92) * 0.2); ctx.fillStyle = css(P.deep || P.dark, 0.75); ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.17, r * 0.075, 0, 0, TAU); ctx.fill(); ctx.strokeStyle = css(P.pale || P.light, 0.6); ctx.lineWidth = r * 0.02; ctx.stroke(); }
}
/** A rocky face: soft darker seas, then craters, each a dark bowl with a lit rim toward the light, foreshortened toward the limb. */
function cmCraters(ctx, r, P, k0) {
  for (let i = 0; i < 6; i++) { const a = rand(k0 + i * 2.1) * TAU, d = r * Math.sqrt(rand(k0 + i * 3.3)) * 0.8, R = r * (0.18 + rand(k0 + i * 4.7) * 0.3), x = Math.cos(a) * d, y = Math.sin(a) * d, g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, css(P.dark, 0.5)); g.addColorStop(1, css(P.dark, 0)); ctx.fillStyle = g; ctx.fillRect(x - R, y - R, R * 2, R * 2); }
  for (let i = 0; i < 16; i++) {
    const a = rand(k0 + i * 5.1 + 30) * TAU, d = r * Math.sqrt(rand(k0 + i * 6.3 + 31)) * 0.9, x = Math.cos(a) * d, y = Math.sin(a) * d, cr = r * (0.03 + rand(k0 + i * 7.7 + 32) ** 2 * 0.12), sq = Math.sqrt(Math.max(0.05, 1 - (d / r) ** 2));
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.scale(sq, 1);
    ctx.fillStyle = css(P.dark, 0.55); ctx.beginPath(); ctx.arc(0, 0, cr, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = css(P.light, 0.7); ctx.lineWidth = Math.max(0.8, cr * 0.25); ctx.beginPath(); ctx.arc(x + cr * 0.15, y + cr * 0.15, cr * 0.95, Math.PI * 0.05, Math.PI * 0.75); ctx.stroke();
  }
}
/** Blobs of one colour gathered in clusters: an earth's continents, a red planet's dark plains, its polar cap. */
function cmBlobs(ctx, r, col, a, n, k0) {
  ctx.fillStyle = css(col, a); ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ca = rand(k0 + i * 2.7) * TAU, cd = r * Math.sqrt(rand(k0 + i * 3.1)) * 0.85;
    for (let j = 0; j < 7; j++) { const x = Math.cos(ca) * cd + (rand(k0 + i * 5 + j * 1.7) - 0.5) * r * 0.42, y = Math.sin(ca) * cd + (rand(k0 + i * 7 + j * 2.3) - 0.5) * r * 0.3, br = r * (0.05 + rand(k0 + i * 11 + j * 3.1) * 0.1); ctx.moveTo(x + br, y); ctx.arc(x, y, br, 0, TAU); }
  }
  ctx.fill();
}
/** Half a ring round a planet — the half behind it (`side` −1) or before it (1) — in bands of tan and cream, flattened as it is seen. */
function cmRing(ctx, x, y, r, side, a) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(-0.32);
  ctx.beginPath(); ctx.rect(-r * 3, side < 0 ? -r * 3 : 0, r * 6, r * 3); ctx.clip();
  ctx.scale(1, 0.27); ctx.globalAlpha = a;
  for (const [r0, r1, col, al] of [[1.3, 1.58, [204, 172, 128], 0.85], [1.62, 1.92, [234, 218, 184], 0.8], [1.98, 2.04, [236, 222, 190], 0.7], [2.1, 2.13, CM.cream, 0.5]]) { ctx.strokeStyle = css(col, al); ctx.lineWidth = (r1 - r0) * r; ctx.beginPath(); ctx.arc(0, 0, ((r0 + r1) / 2) * r, 0, TAU); ctx.stroke(); }
  ctx.restore();
}
/**
 * A planet as an old astronomy book prints it: its face (bands, craters, an earth's seas and lands, a red
 * planet's plains and cap, an ice giant's faint bands), a halftone screen over it, a soft terminator from a light
 * at the upper left, the limb a little darker; Saturn's rings behind and before it; on paper a fine line of ink round it.
 */
function cmPlanet(ctx, x, y, r, P, k0, a = 1) {
  ctx.save(); ctx.globalAlpha = a;
  if (P.ring) cmRing(ctx, x, y, r, -1, 1);
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip();
  ctx.fillStyle = css(P.base); ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.save(); ctx.translate(x, y); ctx.rotate(P.kind === "bands" ? -0.32 + (rand(k0 + 1) - 0.5) * 0.2 : 0);
  if (P.kind === "bands") cmBanding(ctx, r, P, k0);
  else if (P.kind === "rock") cmCraters(ctx, r, P, k0);
  else if (P.kind === "earth") { cmBlobs(ctx, r, P.light, 0.9, 4, k0); cmBlobs(ctx, r * 0.9, P.dark, 0.6, 2, k0 + 50); ctx.strokeStyle = css([250, 248, 240], 0.55); ctx.lineCap = "round"; for (let i = 0; i < 7; i++) { ctx.lineWidth = r * (0.03 + rand(k0 + i + 60) * 0.04); ctx.beginPath(); ctx.arc((rand(k0 + i * 2 + 61) - 0.5) * r, (rand(k0 + i * 3 + 62) - 0.5) * r, r * (0.3 + rand(k0 + i + 63) * 0.5), rand(k0 + i + 64) * TAU, rand(k0 + i + 64) * TAU + 0.9); ctx.stroke(); } }
  else if (P.kind === "red") { cmBlobs(ctx, r, P.dark, 0.55, 3, k0); ctx.fillStyle = css(CM.cream, 0.7); ctx.beginPath(); ctx.ellipse(-r * 0.1, -r * 0.9, r * 0.34, r * 0.14, 0, 0, TAU); ctx.fill(); }
  else { for (let i = 0; i < 6; i++) { ctx.fillStyle = css(i % 2 ? P.light : P.dark, 0.18); ctx.fillRect(-r, -r + (i + rand(k0 + i)) * r * 0.32, r * 2, r * 0.12); } }
  ctx.restore();
  if (canPaint(ctx)) { ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.2 * a; ctx.fillStyle = dotFill(ctx, [120, 110, 104], 5, 1.5, 15); ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = a; }
  const lx = x - r * 0.42, ly = y - r * 0.46, g = ctx.createRadialGradient(lx, ly, r * 0.02, lx, ly, r * 1.62), sh = dark ? CM.shade : CM.plate;
  g.addColorStop(0, "rgba(255,250,236,0.3)"); g.addColorStop(0.26, "rgba(255,250,236,0)"); g.addColorStop(0.5, css(sh, 0)); g.addColorStop(0.74, css(sh, 0.6)); g.addColorStop(0.95, css(sh, 0.94));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  const limb = ctx.createRadialGradient(x, y, r * 0.72, x, y, r); limb.addColorStop(0, css(sh, 0)); limb.addColorStop(1, css(sh, 0.3)); ctx.fillStyle = limb; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
  if (!dark) { ctx.strokeStyle = css(CM.ink, 0.55); ctx.lineWidth = Math.max(1.2, r * 0.008); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke(); }
  if (P.ring) cmRing(ctx, x, y, r, 1, 1);
  ctx.restore();
}
/**
 * The beam's centreline and width along it: straight down from its top (ox, oy); or, as `bend` rises, the seventies'
 * swoop — down, then turning on an elbow into a level run out past the side `dir`, low over the foot of the field —
 * a little narrower at its source and wider toward us.
 */
export function cmBeamPath(B, ox, oy, bend, w, F) {
  const edge = B.dir > 0 ? w + B.W * 2 : -B.W * 2, low = F.y1 - (F.y1 - F.y0) * 0.13, fy = Math.max(oy + 1, B.y1 + (low - B.y1) * bend), run = Math.abs(edge - ox) * bend, s = B.dir > 0 ? 1 : -1;
  const R = Math.max(0, Math.min(B.W * 0.95, run, fy - oy)), down = fy - R - oy, arc = (Math.PI / 2) * R, L = down + arc + (run - R), pts = [], ws = [];
  for (let i = 0, n = 160; i <= n; i++) {   // down to the elbow, round a quarter circle, then level out past the side
    const d = (L * i) / n;
    if (d <= down || !L) pts.push([ox, oy + d]);
    else if (d <= down + arc) { const a = (d - down) / R; pts.push([ox + s * R * (1 - Math.cos(a)), fy - R + R * Math.sin(a)]); }
    else pts.push([ox + s * (R + d - down - arc), fy]);
    ws.push(B.W * (1 - 0.25 * bend + 0.5 * bend * (L ? d / L : 0)));
  }
  return { pts, ws };
}
/** The outline of a band of the beam: its sides `o0` and `o1` (fractions of the width, −0.5 to 0.5) along the path, as a closed polygon on ctx. */
function cmBandPath(ctx, path, o0, o1) {
  const { pts, ws } = path, n = pts.length, nrm = (i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; };
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const [nx, ny] = nrm(i), o = o0 * ws[i]; ctx.lineTo(pts[i][0] + nx * o, pts[i][1] + ny * o); }
  for (let i = n - 1; i >= 0; i--) { const [nx, ny] = nrm(i), o = o1 * ws[i]; ctx.lineTo(pts[i][0] + nx * o, pts[i][1] + ny * o); }
  ctx.closePath();
}
/**
 * The rainbow beam: six bands side by side, as printed in flat inks, a halftone screen over them. With
 * `gap` ([y0, y1]) it fades out over a short way into that span and back after it, as if passing behind the words there.
 */
function cmBeam(ctx, path, a, gap = null) {
  const fade = 70, fill = (c, al) => {
    if (!gap) return css(c, al);
    const g = ctx.createLinearGradient(0, gap[0] - fade, 0, gap[1] + fade), L = gap[1] - gap[0] + fade * 2;
    g.addColorStop(0, css(c, al)); g.addColorStop(fade / L, css(c, 0)); g.addColorStop(1 - fade / L, css(c, 0)); g.addColorStop(1, css(c, al));
    return g;
  };
  ctx.save(); ctx.globalAlpha = a;
  CM_BANDS.forEach((c, i) => { cmBandPath(ctx, path, -0.5 + i / 6 - (i ? 0.004 : 0), -0.5 + (i + 1) / 6); ctx.fillStyle = fill(c, 1); ctx.fill(); });
  if (canPaint(ctx)) {   // the screen, kept off the span it fades out over
    const xs = path.pts.map((q) => q[0]), ys = path.pts.map((q) => q[1]), m = Math.max(...path.ws), x0 = Math.min(...xs) - m, y0 = Math.min(...ys) - m, x1 = Math.max(...xs) + m, y1 = Math.max(...ys) + m;
    ctx.save(); cmBandPath(ctx, path, -0.5, 0.5); ctx.clip();
    if (gap) { ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, gap[0] - y0); ctx.rect(x0, gap[1], x1 - x0, y1 - gap[1]); ctx.clip(); }
    ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.22 * a; ctx.fillStyle = dotFill(ctx, [150, 140, 132], 5, 1.4, 15); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
  }
  ctx.restore();
}
/** A ridge of peaks across F at `base`, up to `amp` high: points for a polygon, jagged, its peaks sharp. */
function cmRidge(F, base, amp, n, k0) {
  const fw = F.x1 - F.x0, step = fw / n, pts = [[F.x0 - 40, base], [F.x0 - 40, base - amp * 0.2]];
  for (let i = 0; i <= n; i++) {
    const px = F.x0 + step * (i + (rand(k0 + i * 2.3) - 0.5) * 0.6), ph = amp * (0.35 + 0.65 * rand(k0 + i * 3.7));
    pts.push([px - step * (0.45 + rand(k0 + i * 4.1) * 0.1), base - amp * (0.06 + rand(k0 + i * 5.3) * 0.2)]);
    pts.push([px - step * 0.22, base - ph * (0.55 + rand(k0 + i * 6.1) * 0.25)], [px - step * 0.12, base - ph * (0.72 + rand(k0 + i * 6.9) * 0.1)], [px, base - ph], [px + step * 0.14, base - ph * (0.62 + rand(k0 + i * 7.7) * 0.2)]);
  }
  pts.push([F.x1 + 40, base - amp * 0.2], [F.x1 + 40, base]);
  return pts;
}
/** The eighties sunset behind the beam: a glow over the horizon, the sun in bands of yellow to rose cut by gaps that widen toward its foot. */
function cmSun(ctx, P, amt) {
  const { F, hz, sun } = P, fw = F.x1 - F.x0, fh = F.y1 - F.y0;
  ctx.save(); ctx.globalAlpha = Math.min(1, amt * 4);
  const glow = ctx.createLinearGradient(0, hz - fh * 0.42, 0, hz); glow.addColorStop(0, css([214, 80, 110], 0)); glow.addColorStop(1, css(dark ? [214, 90, 96] : [236, 150, 120], dark ? 0.42 : 0.32));
  ctx.fillStyle = glow; ctx.fillRect(F.x0, hz - fh * 0.42, fw, fh * 0.42);
  if (sun) {
    const { x, y, r } = sun;
    ctx.save(); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.clip(); ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 1.02);
    for (let k = 0, at = y + r * 0.02; k < 8 && at < y + r; k++) { const gap = r * (0.025 + 0.02 * k), band = r * (0.12 - 0.01 * k); ctx.rect(x - r, at + gap, r * 2, band); at += gap + band; }
    ctx.clip();
    const g = ctx.createLinearGradient(0, y - r, 0, y + r); g.addColorStop(0, css([250, 222, 120])); g.addColorStop(0.45, css([242, 150, 72])); g.addColorStop(1, css([212, 74, 112]));
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.restore();
  }
  ctx.restore();
}
/** Before the beam: two ranges of peaks on the horizon, and a floor of perspective grid running to the sun. */
function cmRange(ctx, P, amt, k0) {
  const { F, hz, sun } = P, fw = F.x1 - F.x0, fh = F.y1 - F.y0, vx = sun ? sun.x : (F.x0 + F.x1) / 2;
  ctx.save(); ctx.globalAlpha = Math.min(1, amt * 4);
  for (const [base, amp, n, col, k] of [[hz, fh * 0.15 * (0.6 + 0.4 * amt), 5, dark ? [88, 52, 76] : [178, 150, 160], 0], [hz + 2, fh * 0.085 * (0.6 + 0.4 * amt), 8, dark ? [40, 28, 40] : [112, 92, 106], 40]]) {
    const pts = cmRidge(F, base, amp, n, k0 + k);
    ctx.fillStyle = css(col); ctx.beginPath(); pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill();
  }
  const floor = ctx.createLinearGradient(0, hz, 0, F.y1); floor.addColorStop(0, css(dark ? [74, 34, 52] : [214, 176, 170])); floor.addColorStop(1, css(dark ? [26, 16, 26] : [190, 150, 148]));
  ctx.fillStyle = floor; ctx.fillRect(F.x0, hz, fw, F.y1 - hz + 2);
  ctx.strokeStyle = css(dark ? [236, 104, 100] : [150, 56, 60], 0.75); ctx.lineWidth = 1.6; ctx.beginPath();
  for (let i = -18; i <= 18; i++) { const x1 = vx + i * fw * 0.11; ctx.moveTo(vx + (x1 - vx) * 0.06, hz + (F.y1 - hz) * 0.02); ctx.lineTo(x1, F.y1 + 4); }
  for (let j = 1; j <= 10; j++) { const y = hz + (F.y1 - hz) * (j / 10) ** 2.1; ctx.moveTo(F.x0, y); ctx.lineTo(F.x1, y); }
  ctx.stroke();
  ctx.restore();
}
/** Cut-paper clouds along the foot of F: three rows of scalloped paper, each a little bluer behind, a soft shade at its foot and a shadow under its edge. */
function cmClouds(ctx, F, amt, k0) {
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0, a = Math.min(1, amt * 4);
  ctx.save(); ctx.globalAlpha = a;
  for (let row = 0; row < 3; row++) {
    const base = F.y1 - fh * (0.02 + (0.16 - row * 0.05) * (0.4 + 0.6 * amt)), R = fh * (0.06 + 0.02 * (2 - row)) * (0.55 + 0.45 * amt), path = () => {
      ctx.beginPath(); ctx.moveTo(F.x0 - R, F.y1 + 10);
      for (let x = F.x0 - R, i = 0; x < F.x1 + R * 2; i++) { const r = R * (0.6 + rand(k0 + row * 50 + i * 1.7) * 0.7), y = base - rand(k0 + row * 50 + i * 2.9) * R * 0.5; ctx.arc(x + r * 0.7, y, r, Math.PI, 0); x += r * 1.3; }
      ctx.lineTo(F.x1 + R * 2, F.y1 + 10); ctx.closePath();
    };
    const tint = [[184, 200, 220], [206, 216, 228], [236, 236, 232]][row], shade = mix(tint, [118, 140, 170], 0.45);
    ctx.save(); ctx.translate(0, R * 0.1); path(); ctx.fillStyle = css([0, 0, 0], dark ? 0.35 : 0.14); ctx.fill(); ctx.restore();
    const g = ctx.createLinearGradient(0, base - R * 1.2, 0, base + R * 1.4); g.addColorStop(0, css(mix(tint, [255, 255, 250], 0.6))); g.addColorStop(0.5, css(tint)); g.addColorStop(1, css(shade));
    path(); ctx.fillStyle = g; ctx.fill();
    if (!dark) { ctx.strokeStyle = css(CM.ink, 0.25); ctx.lineWidth = 1.2; ctx.stroke(); }
  }
  ctx.restore();
}
/** A flying saucer at (x, y), `s` across: its beam of pale light down to `foot`, the hull lit from above, a ring of lamps, a glass dome. */
function cmUfo(ctx, x, y, s, foot, a) {
  ctx.save(); ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(0, y, 0, foot); g.addColorStop(0, css([216, 244, 232], dark ? 0.6 : 0.5)); g.addColorStop(1, css([216, 244, 232], dark ? 0.12 : 0.08));
  if (dark) ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(x - s * 0.16, y + s * 0.08); ctx.lineTo(x + s * 0.16, y + s * 0.08); ctx.lineTo(x + s * 0.42, foot); ctx.lineTo(x - s * 0.42, foot); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = css([54, 62, 64]); ctx.beginPath(); ctx.ellipse(x, y + s * 0.06, s * 0.24, s * 0.07, 0, 0, TAU); ctx.fill();
  const hull = ctx.createLinearGradient(0, y - s * 0.11, 0, y + s * 0.07); hull.addColorStop(0, css([214, 222, 214])); hull.addColorStop(0.5, css([146, 160, 156])); hull.addColorStop(1, css([70, 80, 82]));
  ctx.fillStyle = hull; ctx.beginPath(); ctx.ellipse(x, y, s * 0.5, s * 0.105, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = css([236, 240, 230], 0.7); ctx.lineWidth = Math.max(1, s * 0.008); ctx.beginPath(); ctx.ellipse(x, y - s * 0.012, s * 0.46, s * 0.07, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  for (let i = 0; i < 9; i++) { const t = Math.PI * (0.12 + (0.76 * i) / 8); ctx.fillStyle = css(i % 2 ? [255, 222, 150] : CM_BANDS[(i / 2) | 0], 0.95); ctx.beginPath(); ctx.arc(x + Math.cos(t) * s * 0.4, y + Math.sin(t) * s * 0.06, s * 0.014, 0, TAU); ctx.fill(); }
  const dome = ctx.createLinearGradient(0, y - s * 0.22, 0, y - s * 0.04); dome.addColorStop(0, css([214, 240, 236], 0.95)); dome.addColorStop(1, css([96, 146, 150], 0.95));
  ctx.fillStyle = dome; ctx.beginPath(); ctx.ellipse(x, y - s * 0.06, s * 0.17, s * 0.13, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.ellipse(x - s * 0.06, y - s * 0.13, s * 0.04, s * 0.018, -0.4, 0, TAU); ctx.fill();
  ctx.restore();
}
/** A floppy disk adrift — its body in a faded colour, a metal shutter with its slot, a label striped in the rainbow, the write-protect notch — or a cassette tape: a label banded across, two reels in a window, its foot. Each with a small shadow, as cut out. */
function cmDisk(ctx, D) {
  const { x, y, s, rot, col, tape, a } = D, body = cmFade(col, 0.6);
  ctx.save(); ctx.globalAlpha = a; ctx.translate(x, y); ctx.rotate(rot);
  const W = tape ? s * 1.56 : s, H = s, shape = () => { ctx.beginPath(); if (tape) { ctx.roundRect ? ctx.roundRect(-W / 2, -H / 2, W, H, s * 0.06) : ctx.rect(-W / 2, -H / 2, W, H); } else { ctx.moveTo(-W / 2, -H / 2); ctx.lineTo(W / 2 - s * 0.07, -H / 2); ctx.lineTo(W / 2, -H / 2 + s * 0.07); ctx.lineTo(W / 2, H / 2); ctx.lineTo(-W / 2, H / 2); ctx.closePath(); } };
  ctx.save(); ctx.translate(s * 0.03, s * 0.05); shape(); ctx.fillStyle = css([0, 0, 0], dark ? 0.4 : 0.18); ctx.fill(); ctx.restore();
  shape(); ctx.fillStyle = css(tape ? CM.band : body); ctx.fill();
  const lab = (lx, ly, lw, lh) => { ctx.fillStyle = css(CM.cream); ctx.fillRect(lx, ly, lw, lh); for (let i = 0; i < 4; i++) { ctx.fillStyle = css(CM_BANDS[[0, 1, 2, 4][i]]); ctx.fillRect(lx, ly + lh * (0.28 + i * 0.12), lw, lh * 0.12); } };
  if (tape) {
    lab(-W * 0.42, -H * 0.4, W * 0.84, H * 0.52);
    ctx.fillStyle = css([40, 36, 40]); ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-W * 0.24, -H * 0.2, W * 0.48, H * 0.2, H * 0.08) : ctx.rect(-W * 0.24, -H * 0.2, W * 0.48, H * 0.2); ctx.fill();
    for (const sx of [-1, 1]) { ctx.fillStyle = css(CM.cream); ctx.beginPath(); ctx.arc(sx * W * 0.15, -H * 0.1, H * 0.075, 0, TAU); ctx.fill(); ctx.fillStyle = css(CM.band); ctx.beginPath(); ctx.arc(sx * W * 0.15, -H * 0.1, H * 0.03, 0, TAU); ctx.fill(); }
    ctx.fillStyle = css([58, 52, 56]); ctx.beginPath(); ctx.moveTo(-W * 0.3, H / 2); ctx.lineTo(-W * 0.24, H * 0.24); ctx.lineTo(W * 0.24, H * 0.24); ctx.lineTo(W * 0.3, H / 2); ctx.closePath(); ctx.fill();
  } else {
    const sh = ctx.createLinearGradient(0, -H / 2, 0, -H * 0.1); sh.addColorStop(0, css([214, 214, 208])); sh.addColorStop(1, css([156, 156, 152]));
    ctx.fillStyle = sh; ctx.fillRect(-W * 0.2, -H / 2, W * 0.46, H * 0.38);
    ctx.fillStyle = css([40, 38, 42]); ctx.fillRect(W * 0.08, -H * 0.42, W * 0.09, H * 0.22);
    lab(-W * 0.38, -H * 0.02, W * 0.76, H * 0.46);
    ctx.fillStyle = css([30, 28, 32]); ctx.fillRect(-W * 0.45, H * 0.36, W * 0.07, H * 0.08);
  }
  ctx.restore();
}
/**
 * A blotchy unevenness of the print, as a grey field (128 is no change) at a quarter of the canvas's size, laid on in
 * soft light: ink a little heavier here and thinner there. Kept per size and seed.
 */
function cmMottle(w, h) {
  const kept = WORK.cmMottle || (WORK.cmMottle = new Map()), key = `${w | 0}|${h | 0}|${seed}`;
  if (kept.has(key)) return kept.get(key);
  const c = document.createElement("canvas"); c.width = Math.ceil(w / 4); c.height = Math.ceil(h / 4);
  const x = c.getContext("2d"), u = Math.min(w, h);
  x.scale(0.25, 0.25); x.fillStyle = "rgb(128,128,128)"; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 120; i++) {
    const cx = rand(i * 2.9 + 4700) * w, cy = rand(i * 3.7 + 4701) * h, r = u * (0.05 + rand(i * 4.3 + 4702) ** 2 * 0.3), g = x.createRadialGradient(cx, cy, 0, cx, cy, r), v = rand(i * 5.1 + 4703) > 0.5 ? 255 : 0;
    g.addColorStop(0, `rgba(${v},${v},${v},${0.06 + rand(i * 6.1 + 4704) * 0.08})`); g.addColorStop(1, `rgba(${v},${v},${v},0)`); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  kept.set(key, c);
  if (kept.size > 3) { const [k0, v] = kept.entries().next().value; v.width = v.height = 0; kept.delete(k0); }
  return c;
}
/**
 * The marks of a poster kept in a drawer, by `a` (0–1): its edges darkened, the fold across it (a soft valley, a light
 * ridge, ink cracked off along it), fine scratches, dust; ink rubbed away at the edges and worn off the corners.
 */
function cmWorn(ctx, w, h, a) {
  const u = Math.min(w, h), area = (w * h) / (1920 * 1080), paperC = dark ? [214, 204, 186] : [250, 246, 234], dirt = dark ? [8, 6, 6] : [96, 76, 60];
  vignette(ctx, w, h, dark ? [8, 5, 4] : [120, 92, 62], (dark ? 0.55 : 0.24) * a, 0.42);   // the edges darkened, as paper browns there
  ctx.save(); ctx.lineCap = "round";
  const folds = a > 0.25 ? (a > 0.65 ? 2 : 1) : 0;
  for (let f = 0; f < folds; f++) {   // a vertical fold first, then one across, as a poster is folded in four
    const v = f === 0, at = (v ? w : h) * (0.5 + (rand(4800 + f) - 0.5) * 0.08), len = v ? h : w, s = Math.min(1, (a - (f ? 0.65 : 0.25)) * 4);
    const line = (off, col, al, lw) => { ctx.strokeStyle = css(col, al * s); ctx.lineWidth = lw; ctx.beginPath(); for (let t = 0, i = 0; t <= len; t += 60, i++) { const q = at + off + (noise(i * 0.37 + f * 9) - 0.5) * 2; v ? ctx.lineTo(q, t) : ctx.lineTo(t, q); } ctx.stroke(); };
    line(3, dirt, dark ? 0.5 : 0.12, 7); line(-1, paperC, dark ? 0.16 : 0.5, 1.6);
    ctx.fillStyle = css(paperC, (dark ? 0.55 : 0.4) * s);
    for (let i = 0, n = Math.round(len / 9); i < n; i++) if (rand(i * 1.7 + 4810 + f * 300) < 0.45) { const t = rand(i * 2.3 + 4811 + f * 300) * len, q = at + (rand(i * 3.1 + 4812) - 0.5) * 5, l = 1 + rand(i * 4.3 + 4813) * 5; v ? ctx.fillRect(q, t, 1.2, l) : ctx.fillRect(t, q, l, 1.2); }
  }
  for (let k = 0, n = Math.round(2 + 9 * a); k < n; k++) {   // scratches: hairlines a little curved, pale on the night, dark on paper
    const x0 = rand(k * 3.1 + 4830) * w, y0 = rand(k * 4.3 + 4831) * h, ang = rand(k * 5.7 + 4832) * TAU, l = u * (0.08 + rand(k * 6.1 + 4833) * 0.3), bend = (rand(k * 7.3 + 4834) - 0.5) * l * 0.3;
    ctx.strokeStyle = css(dark ? paperC : dirt, (0.12 + 0.22 * rand(k + 4835)) * a); ctx.lineWidth = 0.8 + rand(k * 8.9 + 4836) * 0.9;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + Math.cos(ang) * l * 0.5 - Math.sin(ang) * bend, y0 + Math.sin(ang) * l * 0.5 + Math.cos(ang) * bend, x0 + Math.cos(ang) * l, y0 + Math.sin(ang) * l); ctx.stroke();
  }
  for (let k = 0, n = Math.round((30 + 160 * a) * area); k < n; k++) {   // dust: specks of dirt and flecks where the ink came away
    const light = rand(k * 1.9 + 4850) < 0.55, r = 0.6 + rand(k * 2.3 + 4851) ** 3 * 2.6;
    ctx.fillStyle = css(light ? paperC : dirt, (0.3 + 0.5 * rand(k * 3.7 + 4852)) * Math.min(1, a * 1.5)); ctx.beginPath(); ctx.arc(rand(k * 4.1 + 4853) * w, rand(k * 5.3 + 4854) * h, r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // the ink rubbed away along the edges, most at the corners (the shared wear, kept to a frame); on paper, grime there
  if (canPaint(ctx)) wear(ctx, w, h, dark ? paperC : [150, 124, 96], (dark ? 0.75 : 0.32) * a, "source-over", (m) => {
    const e = u * 0.06;
    for (const [x0, y0, x1, y1] of [[0, 0, 0, e], [0, h, 0, h - e]]) { const g = m.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); m.fillStyle = g; m.fillRect(0, Math.min(y0, y1), w, e); }
    for (const [x0, x1] of [[0, e], [w, w - e]]) { const g = m.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); m.fillStyle = g; m.fillRect(Math.min(x0, x1), 0, e, h); }
    for (const [cx, cy] of [[0, 0], [w, 0], [0, h], [w, h]]) { const r = u * 0.16, g = m.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); m.fillStyle = g; m.fillRect(cx - r, cy - r, r * 2, r * 2); }
  }, 0.08);
}
/** The marks of cmWorn, painted once on a canvas of their own (see keptLayer) per canvas size, ground, seed and age, and laid on in one go. */
function cmWear(ctx, w, h, a) {
  const paint = (x) => cmWorn(x, w, h, a), kept = canPaint(ctx) && keptLayer(ctx, "cmWear", [seed, w, h, dark ? 1 : 0, a].join("|"), paint);
  if (kept) inPixels(ctx, () => ctx.drawImage(kept, 0, 0)); else paint(ctx);
}
/** The photo graded as an old colour print: its colour a fifth faded, then each channel through a curve of its own — blacks lifted to a cool charcoal, warm mids, the lights to cream. */
const CM_CURVE = (() => {
  const lo = [22, 28, 32], hi = [250, 236, 206], mid = [12, -3, -8], lut = new Uint8ClampedArray(768);
  for (let c = 0; c < 3; c++) for (let v = 0; v < 256; v++) { const t = v / 255, s = t + (t * t * (3 - 2 * t) - t) * 0.3; lut[c * 256 + v] = lo[c] + (hi[c] - lo[c]) * s + mid[c] * 4 * s * (1 - s); }
  return lut;
})();
/**
 * A photo's pixels as an old colour print (see CM_CURVE), mixed in by `amt`; alpha kept. With `border` (a print
 * on the collage, not a photo filling the canvas; w, h its size): a margin of cream paper round it, wider as it
 * rises, its corners rounded and clear, a fine line of a darker cream where the picture starts.
 */
export function cmGrade(d, amt, w = 0, h = 0, border = 0) {
  const a = clamp(amt);
  if (a > 0) for (let i = 0, n = d.length; i < n; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], l = (r * 77 + g * 150 + b * 29) >> 8;
    d[i] = r + (CM_CURVE[(l + (r - l) * 0.8) | 0] - r) * a; d[i + 1] = g + (CM_CURVE[256 + ((l + (g - l) * 0.8) | 0)] - g) * a; d[i + 2] = b + (CM_CURVE[512 + ((l + (b - l) * 0.8) | 0)] - b) * a;
  }
  if (border > 0 && w > 16 && h > 16) {
    const m = Math.max(3, Math.round(Math.min(w, h) * (0.02 + 0.04 * clamp(border)))), rr = m * 1.3, line = Math.max(1, Math.round(m * 0.06));
    for (let y = 0; y < h; y++) {
      const edgeRow = y < m || y >= h - m;
      for (let x = 0; x < w; x++) {
        if (!edgeRow && x >= m && x < w - m) { x = w - m - 1; continue; }   // the picture: left as it is
        const q = (y * w + x) * 4, cx = x < rr ? rr - x : x >= w - rr ? x - (w - 1 - rr) : 0, cy = y < rr ? rr - y : y >= h - rr ? y - (h - 1 - rr) : 0;
        if (cx > 0 && cy > 0 && cx * cx + cy * cy > rr * rr) { d[q + 3] = 0; continue; }   // the rounded corner: clear
        const inner = x >= m - line && x < w - m + line && y >= m - line && y < h - m + line, v = (noise(x * 0.37 + y * 1.91) - 0.5) * 7;
        d[q] = (inner ? 212 : 241) + v; d[q + 1] = (inner ? 202 : 232) + v; d[q + 2] = (inner ? 184 : 212) + v; d[q + 3] = 255;
      }
    }
  }
  return d;
}
/** What the look keeps (the starfield, the galaxies, the mottle, its work canvases) let go, as another look is chosen. */
export function cmFreeAll() {
  for (const k of Object.keys(WORK)) {
    if (!k.startsWith("cm")) continue;
    const v = WORK[k];
    if (v instanceof Map) for (const e of v.values()) { const c = e && e.c ? e.c : e; if (c && "width" in c) c.width = c.height = 0; }
    else if (v && "width" in v) v.width = v.height = 0;
    delete WORK[k];
  }
}
export const cosmo = {
  id: "cosmo",
  repaint: (c) => `a retro-futurist space collage made from the photograph, as a 1970s poster printed on old paper and kept in a drawer: a deep black starfield with a fine dust of stars and four-point sparkles, shaded planets cut from old astronomy books (one ringed), a faded rainbow beam of six bands (red, orange, yellow, green, blue, violet) and touches of ${c}; blacks lifted to a warm charcoal, faded colours, fine grain, dust and a fold; still the same picture, no text.`,
  about: { zh: "复古未来：七十年代印出来、在抽屉里放了几十年的太空拼贴海报——深黑的星空里撒满细细的星尘，几颗带长十字光芒的四角星，一团旋涡星系；行星像从旧天文书上剪下来的，有条纹、有环形山、有柔和的明暗交界线，其中一颗带着土星环，主行星用频道色；一道六色褪色彩虹（红、橙、黄、绿、蓝、紫）笔直地穿过画面，或者弯成一道弧扫出画外，在一些东西后面、另一些东西前面。可加八十年代的条纹落日、山脉和透视网格，剪纸云，飞碟和它的光束，漂浮的软盘和磁带。印刷的痕迹：黑色泛成暖炭灰，颜色褪了，细颗粒、灰尘、划痕、一道折痕和磨旧的角。标题是厚重的大写字，下面叠着几层彩虹色的错位投影；强调词是彩虹渐变。照片调成老彩色照片，也可以做成带白边的相片贴在拼贴里。浅色是米白旧纸上的同一幅拼贴，星星成了墨点，行星像书里的插图版。怀旧、梦幻、有一点科幻——适合音乐、科技怀旧、游戏、播客、电台、科普和生活方式内容。自带平直的版式。", en: "Retro-futurism: a space-age collage printed in the seventies and kept in a drawer for decades — a deep black starfield dusted with fine stars, a few four-point sparkles with long cross glints, a spiral galaxy; planets as if cut from old astronomy books, banded or cratered with a soft terminator, one with Saturn's rings, the main one in the channel colour; a faded rainbow of six bands (red, orange, yellow, green, blue, violet) running straight down the page or sweeping off it in a curve, behind some things and in front of others. An eighties striped sunset over mountains and a perspective grid, cut-paper clouds, a flying saucer and its beam, floppy disks and tapes adrift if you like. The print shows its age: blacks lifted to a warm charcoal, faded colours, fine grain, dust, scratches, a fold and worn corners. The title is chunky capitals over stacked drops in the rainbow's colours; highlighted words in a rainbow. A photo is graded as an old colour print, and a print on the collage can have a paper border. The light ground is the same collage on cream paper, the stars ink specks, the planets plates from a book. Nostalgic, dreamy, a little sci-fi — for music, tech nostalgia, games, podcasts, radio, popular science and lifestyle. Flat layouts of its own." },
  name: { zh: "复古未来", en: "Retro-futurism" },
  seeded: true,
  scene: { planet: { zh: "主行星", en: "Main planet" }, beam: { zh: "彩虹光带", en: "Rainbow beam" }, galaxy: { zh: "旋涡星系", en: "Spiral galaxy" }, ufo: { zh: "飞碟", en: "Flying saucer" } },
  params: [
    { key: "stars", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "星尘", en: "Stardust" } },
    { key: "sparkles", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "十字星芒", en: "Sparkles" } },
    { key: "planet", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "主行星", en: "Main planet" } },
    { key: "planets", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "更多行星", en: "More planets" } },
    { key: "galaxy", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "旋涡星系", en: "Spiral galaxy" } },
    { key: "rainbow", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "彩虹光带", en: "Rainbow beam" } },
    { key: "bend", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光带弯曲", en: "Beam sweep" } },
    { key: "sunset", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "落日与山", en: "Sunset and peaks" } },
    { key: "clouds", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "剪纸云", en: "Paper clouds" } },
    { key: "ufo", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "飞碟", en: "Flying saucer" } },
    { key: "tech", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "软盘与磁带", en: "Floppies and tapes" } },
    { key: "age", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "旧印刷", en: "Age of the print" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "颗粒", en: "Grain" } },
    { key: "prints", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "照片白边", en: "Prints with a paper border" } },
    { key: "grade", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片旧冲印", en: "Photo as an old print" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(cmGround()), text: css(cmInk()), own: css(CM.cream), dim: css(cmInk(), 0.6), titleFill: css(cmInk()), titleInk: css(cmGround()), grid: () => css(cmInk(), dark ? 0.15 : 0.13) }),
  /**
   * The space (or the paper), then by their sliders, back to front: the starfield (kept per canvas size), the
   * galaxy, the small planets behind the beam, the sun, the beam, the peaks and the grid floor, the main planet
   * and the small planets before the beam, the disks, the saucer, the clouds, the sparkles (see cmPlan for where).
   * A photo is graded as an old colour print; one on the collage (not filling the canvas) gets a paper border.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (env.photo) {
      const g = p.grade, b = L.fill ? 0 : p.prints;
      env.drawPhoto(0, g > 0 || b > 0 ? { key: `cm|${g}|${b}`, fn: (d, pw, ph) => cmGrade(d, g, pw, ph, b) } : null);
      return true;
    }
    if (L.ground !== false) { ctx.fillStyle = css(cmGround()); ctx.fillRect(0, 0, w, h); }
    if (!L.grid) return true;
    const P = cmPlan(ctx, env, p), { F } = P, at = (key, x, y) => objAt(key, x, y, ctx);
    if (p.stars > 0) {
      const paint = (x) => cmStars(x, w, h, p.stars), kept = canPaint(ctx) && keptLayer(ctx, "cmStars", [seed, w, h, dark ? 1 : 0, p.stars].join("|"), paint);
      if (kept) inPixels(ctx, () => ctx.drawImage(kept, 0, 0)); else paint(ctx);
    }
    if (P.galaxy) { const [gx, gy] = at("galaxy", P.galaxy.x, P.galaxy.y); cmGalaxy(ctx, gx, gy, P.galaxy.R, P.galaxy.ang, Math.min(1, p.galaxy * 4)); }
    for (const s of P.smalls) if (!s.front) cmPlanet(ctx, s.x, s.y, s.r, s.P, 4900 + s.k * 37, s.a);
    if (p.sunset > 0) cmSun(ctx, P, p.sunset);
    if (P.beam) {
      const B = P.beam, hy = Math.max(B.y0, F.y0) + (F.y1 - F.y0) * 0.1, [bx, by] = at("beam", B.x, hy), oy = B.y0 + (by - hy), path = cmBeamPath(B, bx, oy, p.bend, w, F);
      cmBeam(ctx, path, Math.min(1, p.rainbow * 4), B.gap && oy < B.gap[0] ? B.gap : null);
      if (oy > F.y0 + 10) cmSparkle(ctx, bx, oy, B.W * 0.32, dark ? [255, 214, 186] : CM.ink, Math.min(1, p.rainbow * 4));   // its source, a star, when it lies on the picture
    }
    if (p.sunset > 0) cmRange(ctx, P, p.sunset, 4950);
    if (P.planet) { const [px, py] = at("planet", P.planet.x, P.planet.y); cmPlanet(ctx, px, py, P.planet.r, cmPlanetCols(C), 4990, Math.min(1, p.planet * 4)); }
    for (const s of P.smalls) if (s.front) cmPlanet(ctx, s.x, s.y, s.r, s.P, 4900 + s.k * 37, s.a);
    for (const D of P.disks) cmDisk(ctx, D);
    if (P.ufo) { const [ux, uy] = at("ufo", P.ufo.x, P.ufo.y); cmUfo(ctx, ux, uy, P.ufo.s, p.sunset > 0 ? P.hz + (F.y1 - P.hz) * 0.3 : F.y1, Math.min(1, p.ufo * 4)); }
    if (p.clouds > 0) cmClouds(ctx, F, p.clouds, 5100);
    for (const s of P.sparkles) cmSparkle(ctx, s.x, s.y, s.r, dark ? [255, 246, 226] : CM.ink, s.a);
    return true;
  },
  /** A star chart's graticule: parallels round a pole far below the picture, meridians from it, and the ecliptic dashed across. */
  gridLines(ctx, env, color) {
    const { w, h } = env, cx = w / 2, cy = h * 1.9, far = Math.hypot(cx, cy), span = Math.atan2(cx + 40, cy - h);
    gridPen(ctx, color); ctx.beginPath();
    for (let r = cy - h - 30; r < far + 90; r += 90) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
    for (let a = -span; a <= span; a += Math.PI / 36) { const s = Math.sin(a), c = -Math.cos(a); ctx.moveTo(cx + s * (cy - h - 40), cy + c * (cy - h - 40)); ctx.lineTo(cx + s * (far + 40), cy + c * (far + 40)); }
    ctx.stroke();
    ctx.setLineDash([10, 12]); ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 0; x <= w; x += 24) { const y = h * 0.56 + Math.sin((x / w) * Math.PI * 1.3 + 0.4) * h * 0.14; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: () => css(dark ? [38, 34, 37] : CM.band), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** The block as a band of black paper with the seventies' six stripes along its edge (a cream hairline at the very edge), following whatever shape the edge has. */
    edge(ctx, run, nx, ny) {
      const bw = 7.5, at = (d) => run(-nx * d, -ny * d);
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      CM_BANDS.forEach((c, i) => { ctx.strokeStyle = css(c); ctx.lineWidth = bw + 0.6; at(6 + bw * (i + 0.5)); });
      ctx.strokeStyle = css(CM.cream, 0.75); ctx.lineWidth = 2; at(1);
    },
  },
  /**
   * Chunky capitals in cream (charcoal on paper) over five drops stacked down in the rainbow's colours — yellow,
   * orange, red, pink, violet — the deeper the shadow slider, the further they step; a keyline of the ground round
   * the letters (the outline slider) parts them from the drops. Highlighted words are striped in the rainbow over
   * drops of cream (or charcoal). At no shadow: plain cream type.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, s = Math.min(2, o.shadowAmt ?? 1), kl = o.strokeAmt || 0, face = o.fill || cmInk(), solid = dark ? CM.cream : CM.ink;
    ctx.lineJoin = "round";
    if (s > 0) {
      const st = fs * 0.028 * s;
      for (let i = 5; i >= 1; i--) {
        const [dx, dy] = fall(st * 0.12 * i, st * i), col = CM_DROPS[i - 1], hiCol = mix(solid, cmGround(), (i - 1) * 0.12);
        pass((a, x) => { ctx.fillStyle = css(a.hi && !o.hi ? hiCol : col); ctx.fillText(a.t, x + dx, dy); });
      }
    }
    if (kl > 0) pass((a, x) => { ctx.strokeStyle = css(dark ? CM.shade : CM.paper); ctx.lineWidth = fs * 0.05 * kl; ctx.strokeText(a.t, x, 0); });
    let band = null;
    const stripes = () => { if (band) return band; band = ctx.createLinearGradient(0, -fs * 0.74, 0, fs * 0.04); CM_BANDS.forEach((c, i) => { band.addColorStop(i / 6, css(c)); band.addColorStop((i + 1) / 6 - 0.001, css(c)); }); return band; };
    pass((a, x) => { ctx.fillStyle = a.hi ? (o.hi ? css(o.hi) : stripes()) : css(face); ctx.fillText(a.t, x, 0); });
  },
  // the small parts' ink on the black band turns cream (their ink outlines stay ink: off the band they keep the channel name legible on paper); objects go into the faded palette, their ink a warm charcoal
  wrap: (ctx, C, p, plates) => mapped(ctx, plates ? { fill: { ink: CM.cream }, stroke: {} } : { fill: { ink: CM.ink, light: CM.cream, mid: [200, 190, 174], dark: [72, 62, 66], colour: (c) => cmFade(c) }, stroke: { ink: CM.ink, light: CM.cream }, line: 0.85 }),
  sticker: painters({ line: CM.cream, lineScale: 0.55, tone: inkAs(CM.ink, (c) => cmFade(c)), shadow(ctx, draw) { ctx.save(); ctx.translate(3, 5); draw(css([0, 0, 0], dark ? 0.38 : 0.2)); ctx.restore(); } }),   // cut out with a thin cream margin, a small shadow under it
  /** The corner tag: a label of cream (charcoal on paper), the six stripes down its left end, the words spaced. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.6;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const sw = f * 0.12, bar = sw * 6, w = spacedW(ctx, str, 3) + f * 1.2 + bar, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(dark ? CM.cream : CM.band); ctx.fillRect(x, top, w, h);
    CM_BANDS.forEach((c, i) => { ctx.fillStyle = css(c); ctx.fillRect(x + i * sw, top, sw + 0.5, h); });
    ctx.fillStyle = ink || css(dark ? CM.ink : CM.cream); spaced(ctx, str, x + bar + f * 0.6, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a hairline inset round the picture, and a printer's colour bar — the six inks in small squares — down the left margin. */
  frame(ctx, env) {
    const { w, h } = env, i = 26, s = 11;
    ctx.save(); ctx.strokeStyle = css(cmInk(), 0.4); ctx.lineWidth = 2; ctx.strokeRect(i, i, w - i * 2, h - i * 2);
    CM_BANDS.forEach((c, k) => { ctx.fillStyle = css(c); ctx.fillRect(i + 7, h / 2 + (k - 3) * (s + 4), s, s); });
    ctx.restore();
  },
  /** The plate under a text layer: a slip of paper cut for the words, the six stripes down its left end, a small shadow. */
  plate(ctx, x, y, w, h, colour, fs) {
    const [sx, sy] = fall(fs * 0.03, fs * 0.05), sw = Math.max(2, fs * 0.035);
    ctx.save(); ctx.fillStyle = css([0, 0, 0], dark ? 0.45 : 0.18); ctx.fillRect(x + sx, y + sy, w, h);
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    CM_BANDS.forEach((c, k) => { ctx.fillStyle = css(c); ctx.fillRect(x + k * sw, y, sw + 0.4, h); });
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = css([0, 0, 0], dark ? 0.42 : 0.22); ctx.shadowBlur = 8 * unit; ctx.shadowOffsetX = 3 * unit; ctx.shadowOffsetY = 5 * unit; },
  /**
   * The print's age over everything, by *Age of the print*: the blacks lifted to a warm charcoal and every colour
   * paled (on paper the sheet yellowed instead), the ink a little uneven (cmMottle, kept per size), the wear of a
   * poster kept folded and its darkened edges (cmWear, kept per size); then the grain (specks on paper).
   */
  post(ctx, w, h, C, p, unit = 1) {
    const a = p.age;
    if (a > 0) {
      wash(ctx, w, h, dark ? "screen" : "multiply", dark ? [60, 48, 40] : [250, 236, 208], (dark ? 0.62 : 0.8) * a);   // the blacks lifted to a warm charcoal, the colours a little paler; on paper the sheet yellowed
      if (canPaint(ctx) && !fast) { ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = Math.min(1, a * 1.1); ctx.imageSmoothingEnabled = true; ctx.drawImage(cmMottle(w, h), 0, 0, w, h); ctx.restore(); }
      cmWear(ctx, w, h, a);
    }
    grain(ctx, p.grain * (dark ? 0.75 : 0.55), unit, !dark);
  },
  leave: cmFreeAll,   // what it keeps (each size's starfield and wear, the galaxies, the mottle) goes as another look is chosen
  prompt: `Cut-outs for a retro-futurist space collage — a 1970s poster found in a drawer, nostalgic and dreamy — that read at a glance:
- one clear object per sticker (a ringed planet, a rocket, an astronaut's helmet, a flying saucer, a floppy disk, a cassette tape, a home computer, a rainbow, a crescent moon, a shooting star), simple and iconic; no realism, no fine detail;
- flat colour only, in faded seventies colours: tomato red, orange, mustard yellow, sage green, sky blue and violet, with "ink" (a warm charcoal) and "white" (cream) as partners; the main colour for one part;
- the app cuts every sticker out with a thin cream margin and a small shadow, and fades the colours as old print: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Things from the space age as the seventies dreamt it, built as simple models from a few boxes and cylinders — a home computer and its monitor, a cassette deck, a rocket on its pad, a satellite dish, a lunar lander, a jukebox; no realism, no fine detail.
- the renderer paints faces in cream, a warm charcoal and faded old-print colours: do NOT try to draw shading or outlines yourself;
- "white" is cream, "dark" a warm charcoal, and "main" the channel colour, faded as old print — use it for one to three parts.`,
};
/** Seven directions round a circle, unevenly: offsets r px out that grow a shape into a margin cut by straight snips of the scissors, not drawn round. */
const cmSnips = (r, R) => Array.from({ length: 7 }, (_, i) => { const t = ((i + 0.15 + R(i * 3.1 + 70) * 0.7) / 7) * TAU, k = 0.85 + 0.3 * R(i * 4.7 + 71); return [Math.cos(t) * r * k, Math.sin(t) * r * k]; });
cosmo.elementFx = [
  { key: "stack", name: { zh: "彩虹叠影", en: "Rainbow stack" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ r: 16 * k, b: 80 * k }),
    /** Copies of the layer's shape stepped down behind it in the rainbow's colours — yellow, orange, red, pink, violet — as the title's drops. */
    paint(x, B, a, E) {
      const st = Math.min(14 * E.k, Math.max(E.k, Math.min(B.h, B.w) * 0.03)) * (0.35 + 0.65 * a), src = region(x, B, "fxA");
      ringsBehind(x, B, src, [], CM_DROPS.slice(0, 5).map((c, i) => [c, [[st * 0.12 * (i + 1), st * (i + 1)]], 1]));
    } },
  { key: "vintage", name: { zh: "旧冲印", en: "Vintage print" }, for: ["photo", "asset"], stage: "filter",
    /** The layer graded as an old colour print: faded, the blacks lifted, the lights to cream (see cmGrade). */
    paint(x, B, a) { const img = x.getImageData(B.x0, B.y0, B.w, B.h); cmGrade(img.data, a); x.putImageData(img, B.x0, B.y0); } },
  { key: "cutout", name: { zh: "剪纸边", en: "Cut-paper edge" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 26 * k, t: 26 * k, r: 32 * k, b: 36 * k }),
    /** The layer cut out of a sheet with scissors: a margin of yellowed paper round it in straight snips, a small soft shadow under it. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), r = (2.5 + 7 * a) * E.k;
      ringsBehind(x, B, src, [], [[[240, 231, 210], cmSnips(r, E.R), 1], [[240, 231, 210], cmSnips(r * 0.55, (n) => E.R(n + 40)), 1]]);
      glowBehind(x, B, src, (3 + 5 * a) * E.k + r, 0.5 * Math.min(1, a * 1.6), [0, 0, 0], (2 + 3 * a) * E.k, (3 + 5 * a) * E.k);
    } },
];
