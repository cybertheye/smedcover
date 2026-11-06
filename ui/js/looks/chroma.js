// chroma: chromatic surrealist minimalism, fields of pure colour meeting at a horizon
// Two or three enormous flat fields of fully saturated, near-complementary colour: a cobalt sky over vermilion
// grass, molten orange over violet snow, a red field over cyan, Barragán's cadmium walls under a deep blue sky,
// pink dunes under electric blue. One field dominates, the other is a band, the colour block a third; one small
// lone object stands on the ground with a great deal of air round it, its shadow long on the grass. The ground is
// velvety, made of fine short strokes; the sky shifts gently in value toward the horizon; a risograph's grain lies
// over everything. All the rest is clean and flat. By day on the light ground, at dusk on the dark one.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, blurred, boost, canPaint, clamp, css, dark, figureOf, flatFx, graphicShape, gridPen, inkAs, keepOthers, lum, mapped, mix, near, objAt, onLayer, openField, overlaps, painters, parseColour, placeShape, rand, region, sat, seed, shapeIn, softened, titleArea, toneTable, tonesFx, upright, values } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";
import { isDraft } from "../photo.js";

/**
 * The palettes, in the order of the Palette slider (1 to 7), each by day (the light ground) and at dusk (the dark
 * one). top / sky / low: the sky at its top, its own colour and near the horizon (the shift in value toward it);
 * glow: a band of light along the horizon itself, at dusk; ground / far: the ground field and how it looks at the
 * horizon; lit / shade: its grass catching the light and in its own shadow; third: the third colour (the lone
 * object, the block where the channel colour would vanish); type / hi: the lettering on the sky and its highlighted
 * words; sun: the disc; deep / light: the darkest and lightest the world holds (wires, walls in shade; roofs, stairs).
 */
const CH = [
  { // 1 orange and violet: a molten orange sky over violet snow
    day: { top: [246, 174, 36], sky: [248, 142, 20], low: [250, 102, 18], glow: [228, 48, 104], ground: [104, 66, 172], far: [146, 108, 212], lit: [150, 116, 226], shade: [62, 34, 122], third: [72, 20, 66], type: [46, 14, 86], hi: [196, 0, 88], sun: [255, 238, 178], deep: [40, 10, 44], light: [240, 230, 252] },
    dusk: { top: [34, 16, 72], sky: [126, 34, 88], low: [232, 90, 56], glow: [255, 150, 50], ground: [40, 28, 124], far: [76, 56, 164], lit: [92, 72, 192], shade: [20, 12, 64], third: [255, 134, 42], type: [255, 238, 216], hi: [255, 156, 62], sun: [255, 228, 168], deep: [18, 6, 34], light: [218, 204, 246] } },
  { // 2 pink and electric blue: pink dunes under an electric blue
    day: { top: [8, 40, 158], sky: [10, 66, 204], low: [36, 106, 228], glow: null, ground: [230, 62, 112], far: [242, 112, 152], lit: [255, 134, 170], shade: [164, 28, 80], third: [36, 134, 86], type: [255, 255, 255], hi: [255, 152, 188], sun: [255, 240, 244], deep: [6, 18, 70], light: [255, 238, 244] },
    dusk: { top: [6, 8, 54], sky: [20, 30, 128], low: [150, 60, 170], glow: [255, 112, 150], ground: [118, 20, 72], far: [168, 44, 104], lit: [190, 64, 126], shade: [56, 6, 38], third: [255, 120, 166], type: [255, 246, 250], hi: [255, 126, 172], sun: [255, 206, 222], deep: [4, 4, 28], light: [240, 212, 232] } },
  { // 3 red and cyan: a red field over a cyan one
    day: { top: [214, 10, 18], sky: [234, 22, 28], low: [244, 60, 42], glow: null, ground: [0, 158, 212], far: [64, 190, 232], lit: [92, 214, 248], shade: [0, 92, 148], third: [255, 224, 30], type: [255, 255, 255], hi: [255, 224, 30], sun: [0, 168, 220], deep: [70, 0, 14], light: [255, 242, 236] },
    dusk: { top: [58, 2, 22], sky: [138, 8, 34], low: [236, 78, 42], glow: [255, 142, 60], ground: [0, 66, 106], far: [0, 104, 144], lit: [20, 138, 180], shade: [0, 28, 58], third: [255, 198, 40], type: [255, 244, 236], hi: [255, 206, 60], sun: [112, 222, 255], deep: [22, 0, 10], light: [240, 222, 216] } },
  { // 4 cobalt and vermilion: a cobalt sky over vermilion grass
    day: { top: [14, 82, 152], sky: [22, 108, 178], low: [50, 140, 200], glow: null, ground: [224, 22, 24], far: [236, 56, 44], lit: [255, 98, 82], shade: [146, 6, 22], third: [255, 204, 0], type: [255, 255, 255], hi: [255, 204, 0], sun: [255, 240, 212], deep: [8, 28, 66], light: [255, 244, 228] },
    dusk: { top: [12, 16, 80], sky: [30, 36, 148], low: [176, 70, 150], glow: [255, 112, 52], ground: [118, 8, 34], far: [156, 22, 50], lit: [200, 42, 68], shade: [58, 0, 20], third: [255, 150, 40], type: [255, 248, 236], hi: [255, 170, 60], sun: [255, 96, 44], deep: [6, 6, 36], light: [250, 228, 208] } },
  { // 5 Barragán: cadmium yellow and red walls against a deep blue sky
    day: { top: [28, 42, 90], sky: [42, 70, 128], low: [86, 128, 184], glow: null, ground: [242, 192, 16], far: [248, 206, 46], lit: [255, 224, 88], shade: [196, 136, 0], third: [222, 14, 14], type: [255, 255, 255], hi: [242, 192, 16], sun: [255, 238, 214], deep: [16, 20, 44], light: [248, 240, 228] },
    dusk: { top: [8, 12, 40], sky: [22, 32, 84], low: [118, 70, 120], glow: [236, 112, 60], ground: [150, 96, 10], far: [186, 122, 22], lit: [212, 152, 34], shade: [92, 52, 0], third: [178, 16, 26], type: [255, 246, 232], hi: [255, 198, 40], sun: [255, 128, 64], deep: [4, 6, 20], light: [232, 216, 198] } },
  { // 6 teal and orange: an orange sky over a teal ground
    day: { top: [232, 70, 22], sky: [240, 86, 30], low: [250, 126, 56], glow: null, ground: [30, 154, 174], far: [72, 186, 200], lit: [86, 204, 218], shade: [10, 96, 116], third: [14, 40, 50], type: [14, 38, 48], hi: [255, 244, 224], sun: [255, 228, 192], deep: [12, 28, 34], light: [255, 240, 226] },
    dusk: { top: [36, 14, 44], sky: [92, 28, 46], low: [236, 92, 40], glow: [255, 142, 50], ground: [8, 62, 78], far: [20, 98, 114], lit: [30, 128, 146], shade: [2, 28, 38], third: [255, 122, 40], type: [255, 236, 220], hi: [255, 142, 60], sun: [255, 112, 44], deep: [6, 10, 14], light: [232, 218, 208] } },
  { // 7 ultramarine: an ultramarine sky over deep blue, one orange
    day: { top: [36, 40, 178], sky: [52, 60, 214], low: [76, 94, 226], glow: null, ground: [14, 16, 108], far: [30, 36, 138], lit: [52, 60, 176], shade: [6, 6, 64], third: [255, 92, 40], type: [255, 255, 255], hi: [255, 112, 58], sun: [255, 92, 40], deep: [6, 8, 50], light: [238, 238, 255] },
    dusk: { top: [8, 8, 50], sky: [34, 38, 150], low: [86, 52, 156], glow: [255, 98, 50], ground: [8, 8, 58], far: [18, 18, 86], lit: [32, 32, 118], shade: [2, 2, 30], third: [255, 100, 44], type: [255, 246, 236], hi: [255, 122, 60], sun: [255, 92, 40], deep: [2, 2, 24], light: [222, 222, 250] } },
];
/** The palette the Palette slider names (1 to 7), as it is on the current ground: by day on the light one, at dusk on the dark. */
export const chPal = (p = values) => { const P = CH[clamp(Math.round(Number(p.palette) || 4), 1, CH.length) - 1]; return dark ? P.dusk : P.day; };
/** The palette with its ground field in the channel colour when that is set (`chan`), made vivid (deeper at dusk), its grass toned from it. */
export function chFields(C, p = values) {
  const pal = chPal(p);
  if (!p.chan) return pal;
  const g0 = boost(C, 0.6), g = dark ? mix(g0, pal.deep, 0.42) : g0;
  return { ...pal, ground: g, far: mix(g, pal.low, 0.24), lit: mix(g, [255, 255, 255], dark ? 0.16 : 0.26), shade: mix(g, pal.deep, 0.42) };
}
/**
 * The colour block: a pure field of the channel colour, made vivid (a shade deeper at dusk); the palette's third
 * where the channel colour would vanish into the sky or the ground, or is a grey, and where the ground has taken it.
 */
export function chBlock(C, p = values) {
  const pal = chPal(p);
  if (p.chan) { const g = chFields(C, p).ground; return [pal.third, pal.hi, pal.light].find((c) => !near(c, g, 90)) || pal.light; }   // the ground has the channel colour: the third, or what stands apart from it
  const c = boost(C, 0.55), lost = sat(C) < 0.15 || near(c, pal.sky, 80) || near(c, pal.ground, 80);
  return lost ? pal.third : dark ? mix(c, pal.deep, 0.16) : c;
}
/** What reads on a colour: the palette's light on a dark one, its deep on a light one. */
const onColour = (c, pal) => (lum(c) < 0.5 ? pal.light : pal.deep);
/**
 * The horizon: the ground rises from the foot of the open field F as far as `ground` says (0: none, the sky alone),
 * and the title (T, with its subtitle) stands wholly on the sky: where it reaches further down, the horizon goes
 * below it, the ground a band at least a sliver tall.
 */
export function chHorizon(F, T, ground) {
  const fh = F.y1 - F.y0;
  if (!(ground > 0)) return F.y1;
  let H = F.y1 - fh * (0.06 + 0.62 * ground);
  if (T && T.y < F.y1 && T.y + T.h > F.y0 && T.y + T.h / 2 < F.y0 + fh * 0.8) H = Math.max(H, Math.min(T.y + T.h + Math.max(24, fh * 0.04), F.y1 - fh * 0.05));
  return H;
}
/** The part of the canvas the colour block leaves open (openField), its slanted edge's nearer end taken: what stands in it is clear of the block. */
function chField(env) {
  const F = openField(env), E = env.G && env.G.edge;
  if (!E) return F;
  const [ax, ay, bx, by] = E.line;
  return F.side === "right" ? { ...F, x1: Math.min(ax, bx) } : F.side === "left" ? { ...F, x0: Math.max(ax, bx) } : F.side === "below" ? { ...F, y1: Math.min(ay, by) } : F.side === "above" ? { ...F, y0: Math.max(ay, by) } : F;
}
/** Whether box b lies wholly on the open side of the colour block's edge (env.G.edge), slanted or not. */
function chOpen(env, b) {
  const E = env.G && env.G.edge;
  if (!E) return true;
  const [ax, ay, bx, by] = E.line, l = Math.hypot(bx - ax, by - ay) || 1;
  let nx = -(by - ay) / l, ny = (bx - ax) / l;
  if (nx * E.nx + ny * E.ny < 0) { nx = -nx; ny = -ny; }
  return [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].every(([x, y]) => (x - ax) * nx + (y - ay) * ny >= 0);
}
/** Whether box b ({x, y, w, h}) keeps off every box of `keep`. */
const chFree = (b, keep) => !keep.some((k) => overlaps(b, k));
/** The area of box b that lies over box k. */
const chArea = (b, k) => Math.max(0, Math.min(b.x + b.w, k.x + k.w) - Math.max(b.x, k.x)) * Math.max(0, Math.min(b.y + b.h, k.y + k.h) - Math.max(b.y, k.y));
/**
 * What a part's box b (at its largest) would rather not do, the more pressing first: reach behind the title, the tag or
 * the graphic (P.keep) or, `hi` units high, up into the brand row (above P.top) — those lie over the scene, so it may go
 * behind them where it must — and reach over the parts placed before it (P.rooms; over one, it still shows). 0: not at all.
 */
const chWish = (P, b, hi = 0) => [P.keep.reduce((s, k) => s + chArea(b, k), 0) + Math.max(0, hi) * b.w, P.rooms.reduce((s, k) => s + chArea(b, k), 0)];
/** Whether key a falls less short than key b, wish by wish (the first that differs decides). */
const chLess = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
/**
 * A part's places, offered in the order it would rather have them, each with its `key` (how far it falls short of each
 * wish: the hard ones first — in the open field, off the block — then chWish's): offer(c) keeps the one falling least short,
 * wish by wish (`best`), and says whether c falls short of none, so no other need be tried. So a part with no room clear of
 * the words goes behind them, never out.
 */
const chPicker = () => { const q = { best: null, offer: (c) => { if (!q.best || chLess(c.key, q.best.key)) q.best = c; return c.key.every((v) => !v); } }; return q; };
/**
 * How high a thing standing at x0–x1 with its foot at `foot` may rise: up to the foot of the lowest box of `keep`
 * above it there (the title, the tag), else the top margin; null where a box stands across its foot.
 */
function chCeiling(P, x0, x1, foot, keep = P.keep) {
  let top = P.top;
  for (const b of keep) {
    if (b.x >= x1 || b.x + b.w <= x0) continue;
    if (b.y < foot && b.y + b.h > foot - 4) return null;
    if (b.y + b.h <= foot) top = Math.max(top, b.y + b.h);
  }
  return top;
}
/**
 * Where everything goes on this cover: the open field (F), the title's box (T), the horizon (H), the boxes the scene
 * would rather keep off (`keep`: the title with its subtitle, the tag, the graphic; and the brand row, above `top`) and,
 * by their sliders, the walls, the lone object, the disc, the pole and the houses. The walls keep to themselves: nothing
 * keeps clear of them, so they and their slider leave the rest where it is. The others are each found at their largest,
 * whether they are on or not, clear of `keep` and of the rooms (`rooms`) the ones before them take at their largest if
 * there is a place so, else where they reach least behind those (they lie over the scene) and then least over each other:
 * none is left out, a slider only sizes its own part where it stands, and moves nothing else (the ground's moves the
 * horizon, and what stands on it with it). `side`: where the light comes from (1, the right; -1, the left), the disc's
 * side. S: the lone object's silhouette (graphicShape), none without a figure — given whether the object is on or not,
 * for its room; env.titleArea: the title's box where there is no canvas to measure it on (a test's stand-in).
 */
export function chPlan(ctx, env, p, S = null) {
  const { w, h } = env, F = chField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, u = Math.min(w, h);
  const T = canPaint(ctx) ? titleArea(ctx, env) : env.titleArea || null, H = chHorizon(F, T, p.ground);
  const tk = T ? [{ x: T.x - 30, y: T.y - 30, w: T.w + 60, h: T.h + 60 }] : [], keep = [...tk, ...keepOthers(env)];
  const P = { w, h, F, fw, fh, u, T, H, keep, tk, env, wide: openField(env), top: Math.max(F.y0, 0) + (env.hasBrand ? 140 : 50), side: 1, depth: Math.max(0, F.y1 - H), rooms: [] };
  if (p.walls > 0) P.walls = chWallsAt(P, p.walls);   // the walls keep to themselves: nothing keeps clear of them, so their slider moves nothing else (where they cover a part, it can be dragged)
  const fig = S && chFigureAt(P, S);
  if (fig) P.rooms.push(fig.box);
  const sun = chSunAt(P);
  P.rooms.push(sun.box); P.side = sun.x >= F.x0 + fw / 2 ? 1 : -1;
  const pole = chPoleAt(P, fig);
  P.rooms.push(pole.box);
  const houses = chHousesAt(P, fig);
  // each at its slider's size where it stands
  if (p.subject > 0 && fig) { const s = fig.k * (0.06 + 0.24 * p.subject) * fig.f, wd = s * fig.aspect; P.fig = { cx: fig.cx, foot: fig.foot, s, wd, box: { x: fig.cx - wd / 2 - 14, y: fig.foot - s - 14, w: wd + 28, h: s + 28 } }; }
  if (p.sun > 0) { const r = u * (0.03 + 0.075 * p.sun), y = sun.set ? H - r * 0.3 : sun.y; P.sun = { x: sun.x, y, r, box: { x: sun.x - r - 18, y: y - r - 18, w: 2 * r + 36, h: sun.set ? r * 1.3 + 18 : 2 * r + 36 } }; }
  if (p.lines > 0) { const tall = pole.tall * (0.34 + 0.2 * Math.min(1, p.lines * 2)) / 0.54, x = pole.x; P.pole = { x, foot: pole.foot, top: pole.foot - tall, arm: tall * 0.13, d: pole.d, birds: pole.birds, box: { x: x - tall * 0.13 - 8, y: pole.foot - tall - 8, w: tall * 0.26 + 16, h: tall + 8 } }; }
  if (p.houses > 0) P.houses = { x0: houses.x0, foot: houses.foot, s: u * (0.034 + 0.03 * p.houses) * houses.f, s1: houses.s1, n: 1 + Math.round(p.houses * 4), box: houses.box };   // the box: the room of all five at their largest
  return P;
}
/**
 * The lone object, at its largest: on the ground on a third of the field, near the horizon if it can stand there clear
 * of all, else nearer, else smaller (`f`, kept at every size), else where it reaches least behind the rest; within the
 * field. `k`: its height at a slider of 1 is k × 0.3 × f.
 */
function chFigureAt(P, S) {
  const { F, fw, fh, H, depth } = P, b = S.box, aspect = clamp((b.x1 - b.x0) / Math.max(1, b.y1 - b.y0), 0.2, 4), k = Math.min(fh, P.u * 1.2) / Math.sqrt(Math.max(1, aspect)), q = chPicker();   // a wide one a little lower, so its area stays near
  for (const sc of [1, 0.8, 0.64, 0.5, 0.4]) for (const d of [0.14, 0.42, 0.72]) for (const fx of [1 / 3, 2 / 3, 0.25, 0.75, 0.42, 0.58, 0.5, 0.16, 0.84]) {
    const f = sc * (0.85 + 0.3 * d), s = k * 0.3 * f, wd = s * aspect, cx = F.x0 + fw * fx, foot = H + depth * d;
    const box = { x: cx - wd / 2 - 14, y: foot - s - 14, w: wd + 28, h: s + 28 };
    if (q.offer({ cx, foot, f, k, aspect, box, key: [Math.max(0, F.x0 + 12 - box.x) + Math.max(0, box.x + box.w - F.x1 + 12), ...chWish(P, box, P.top - box.y)] })) break;
  }
  return q.best;
}
/**
 * The disc, at its largest: in the free sky, beside the title or under it, the higher the better; else setting on the
 * horizon (`set`), half behind the ground; in the sky the block leaves open, as far as its slanted edge. Where it is clear
 * nowhere, the place it reaches least behind the words at its default size, then at larger ones.
 */
function chSunAt(P) {
  const { H } = P, F = P.wide, fw = F.x1 - F.x0, rs = [0.3, 0.65, 1].map((a) => P.u * (0.03 + 0.075 * a)), r = rs[2], room = H - P.top, list = [];
  const out = (b) => (chOpen(P.env, b) ? 0 : 1e9) + Math.max(0, F.x0 + 1 - b.x) + Math.max(0, b.x + b.w + 1 - F.x1), at = (x, y, s = r) => ({ x: x - s - 18, y: y - s - 18, w: 2 * s + 36, h: 2 * s + 36 });
  const clear = (c) => !c.out && chWish(P, c.box, c.set ? P.top + 1 - (H - r * 1.3) : 0).every((v) => !v);   // at its largest, so at every size
  if (room > r * 2.6) for (const fy of [0.3, 0.45, 0.6, 0.18, 0.72]) for (const x of [...[0.78, 0.68, 0.86, 0.58, 0.48, 0.3, 0.2, 0.12, 0.92].map((fx) => F.x0 + fw * fx), F.x1 - r - 20, F.x0 + r + 20]) {   // the last two as near the field's edges as it fits there at its largest
    const y = P.top + r + (room - 2 * r) * fy, box = at(x, y), c = { x, y, box, out: out(box) + Math.max(0, box.y + box.h + 1 - H) };
    if (clear(c)) return c;
    list.push(c);
  }
  for (const fx of [0.74, 0.62, 0.86, 0.5, 0.38, 0.24]) {   // setting: its lower part behind the ground
    const x = F.x0 + fw * fx, box = { ...at(x, H - r * 0.3), h: r * 1.3 + 18 }, c = { x, set: true, box, out: out(box) };
    if (clear(c)) return c;
    list.push(c);
  }
  const q = chPicker();   // clear nowhere: behind the words least, size by size from its default up, then over the parts before it least at its largest
  for (const c of list) { const k = rs.map((s) => chWish(P, c.set ? { ...at(c.x, H - s * 0.3, s), h: s * 1.3 + 18 } : at(c.x, c.y, s), c.set ? P.top + 1 - (H - s * 1.3) : 0)); q.offer({ ...c, key: [c.out, ...k.map((v) => v[0]), k[2][1]] }); }
  return q.best;
}
/**
 * The pole, at its tallest: on the near ground, as tall as the sky above it allows (`tall`, its height at a slider of a
 * half and up), its arms reaching across, within the field; and its line (see chPole): the far pole `d` of the field's
 * width toward the middle, as far off as its wires keep clear of the title, the top margin and the lone object (`fig`,
 * its room) — else where they cross them least — and the birds' places on the wires (`birds`: { j the wire, t how far
 * along, k }), the first of their seeded tries that keep clear of all, else those reaching least behind it.
 */
function chPoleAt(P, fig) {
  const { F, fw, fh, H, depth } = P, want = Math.min(fh, P.u * 1.1) * 0.54, q = chPicker();
  for (const d of [0.34, 0.8]) for (const fx of [0.84, 0.74, 0.9, 0.64, 0.16, 0.28, 0.08, 0.5]) {
    const x = F.x0 + fw * fx, foot = H + depth * d, arm = want * 0.13, top = chCeiling(P, x - arm - 8, x + arm + 8, foot);
    const tall = top == null ? want : clamp(foot - top - 16, want * 0.3, want), box = { x: x - tall * 0.13 - 8, y: foot - tall - 8, w: tall * 0.26 + 16, h: tall + 8 };   // where a box stands across its foot, it stands behind it
    if (q.offer({ x, foot, tall, box, key: [Math.max(0, F.x0 - box.x) + Math.max(0, box.x + box.w - F.x1), ...chWish(P, box, P.top - box.y), tall < want * 0.8 ? want - tall : 0] })) break;
  }
  const at = { ...q.best, top: q.best.foot - q.best.tall, arm: q.best.tall * 0.13 }, { x, tall } = at, fb = fig && fig.box;
  const cross = (sp) => { let a = 0, b = 0; for (let j = 0; j <= 16; j++) { const [qx, qy] = chOnSpan(sp, j / 16); if (qy < P.top - 20 || P.tk.some((t) => qx > t.x && qx < t.x + t.w && qy < t.y + t.h)) a++; else if (fb && qx > fb.x && qx < fb.x + fb.w && qy > fb.y && qy < fb.y + fb.h) b++; } return [a, b]; };   // its points over or through the title, or above the top margin; through the lone object
  const toward = x > F.x0 + fw / 2 ? -1 : 1, edge = toward < 0 ? F.x1 + 80 : F.x0 - 80, fq = chPicker();   // the far pole toward the middle, the edge on its own side
  for (const d of [0.3, 0.2, 0.12]) {   // the far pole, small on the horizon: as far off as its spans stay clear
    const f = chFar(P, at, toward, d), fbox = { x: f.x - f.arm - 6, y: f.top - 6, w: f.arm * 2 + 12, h: f.foot - f.top + 6 }, c = [0, 1, 2].map((i) => cross(chSpan(chHang(at, i), chHang(f, i)))), [kw, kr] = chWish(P, fbox);
    if (fq.offer({ d, f, key: [Math.max(0, F.x0 + 20 - f.x) + Math.max(0, f.x - F.x1 + 20), c.reduce((s, v) => s + v[0], 0), kw, c.reduce((s, v) => s + v[1], 0), kr] })) break;
  }
  const spans = [];
  for (let i = 0; i < 3; i++) { const a = chHang(at, i); spans.push(chSpan(a, [edge, a[1] + fh * 0.1 * (1 + i * 0.12)]), chSpan(a, chHang(fq.best.f, i))); }   // off the edge, back to the far pole
  const bs = Math.max(4, tall * 0.075), tries = [];
  for (let k = 0; k < 40; k++) {
    const j = Math.floor(rand(7900 + k * 1.3) * 6), t = 0.12 + rand(7901 + k * 2.1) * 0.7, [bx, by] = chOnSpan(spans[j], t), s = bs * (j % 2 ? 1 - t * 0.55 : 1), box = { x: bx - s * 0.5, y: by - s, w: s, h: s * 1.8 };
    tries.push({ j, t, k, key: [Math.max(0, F.x0 - box.x) + Math.max(0, box.x + box.w - F.x1) + Math.max(0, -box.y), ...chWish(P, box)] });
  }
  const clear = tries.filter((c) => c.key.every((v) => !v)), rest = tries.filter((c) => !clear.includes(c)).sort((a, b) => (chLess(a.key, b.key) ? -1 : chLess(b.key, a.key) ? 1 : 0));
  return { x, foot: at.foot, tall, box: at.box, d: fq.best.d, birds: [...clear, ...rest].slice(0, 9) };
}
/** The far pole of the line from the pole `at` (x, foot, top, arm): `d` of the field's width off toward `toward`, standing small on the horizon. */
const chFar = (P, at, toward, d) => { const k = 0.34 - d * 0.5, f0 = P.H + P.depth * 0.03; return { x: at.x + toward * P.fw * d, foot: f0, top: f0 - (at.foot - at.top) * k, arm: at.arm * k }; };
/** The walls: on the ground away from the title, as wide as the slider says, as tall as the sky above them allows. */
function chWallsAt(P, amt) {
  const { F, fw, fh, H, depth } = P, ww = fw * (0.16 + 0.2 * amt) * Math.min(1, (fh * 1.6) / fw + 0.3);
  let best = null, score = 0;   // the largest that stands clear, a squat one counted less
  for (const sc of [1, 0.8, 0.62, 0.48, 0.36]) for (const d of [0.62, 0.9]) for (const fx of [0.76, 0.24, 0.66, 0.34, 0.5]) {
    const W = ww * sc, x0 = F.x0 + fw * fx - W / 2, foot = H + depth * d;
    if (x0 < F.x0 + 10 || x0 + W > F.x1 - 10) continue;
    const top = chCeiling(P, x0 - W * 0.06, x0 + W * 1.02, foot);
    if (top == null) continue;
    const ht = Math.min(W * 0.95, (foot - top - 14) / 1.1);
    if (ht < W * 0.42) continue;
    const box = { x: x0 - W * 0.08, y: foot - ht * 1.1, w: W * 1.12, h: ht * 1.1 }, s = W * ht * (ht > W * 0.7 ? 1 : 0.55);
    if (s > score && chFree(box, P.keep)) { best = { x0, foot, W, ht, box }; score = s; }
  }
  return best;
}
/**
 * The houses, all five at their largest: a little cluster along the horizon, on the side away from the lone object's
 * room, kept clear and below the title if they can be (smaller by `f`, kept at every size, where they cannot), within
 * the field but for a little off its edge; where they are clear nowhere, the place the first few reach least behind the
 * words, then more of them. `s1`: their size at a slider of 1, which spaces them, each in its own place.
 */
function chHousesAt(P, fig) {
  const { F, fw, H, depth, u } = P, s0 = u * 0.064, side = fig && fig.cx > F.x0 + fw / 2 ? -1 : 1, list = [];
  for (const sc of [1, 0.78, 0.6, 0.46]) for (const d of [0, 0.35, 0.7]) for (const fx of side > 0 ? [0.62, 0.74, 0.5, 0.86, 0.12, 0.36, 0.24] : [0.1, 0.24, 0.36, 0.5, 0.86, 0.62, 0.74]) {   // the last two only where the side it would have is crowded
    const f = sc * (1 + d * 0.8), s = s0 * f, span = s * (5 * 1.9 + 0.4), x0 = F.x0 + fw * fx - span / 2, foot = H + Math.min(depth * 0.08, s * 0.3) + depth * d;   // a little nearer, and larger, where the horizon has no room
    const box = { x: x0, y: foot - s * 1.75, w: span, h: s * 1.75 + 4 }, c = { x0, foot, f, s1: s, box, out: Math.max(0, F.x0 - s * 0.6 - x0) + Math.max(0, x0 + span - F.x1 - s * 0.6) };
    if (!c.out && chWish(P, box, P.top + 1 - box.y).every((v) => !v)) return c;   // clear at its largest, so at every size
    list.push(c);
  }
  const q = chPicker();   // clear nowhere: behind the words least with two houses, then three, then all five, then over the parts before it least
  for (const c of list) { const k = [0.25, 0.5, 1].map((a) => { const sa = u * (0.034 + 0.03 * a) * c.f, b = { x: c.x0, y: c.foot - sa * 1.75, w: c.s1 * ((1 + Math.round(a * 4)) * 1.9 + 0.4), h: sa * 1.75 + 4 }; return chWish(P, b, P.top + 1 - b.y); }); q.offer({ ...c, key: [c.out, ...k.map((v) => v[0]), k[2][1]] }); }
  return q.best;
}

// ---------------------------------------------------------------- the fields
/** The sky's colour at height y (see chSky): the top's, its own, the light toward the horizon, the glow along it. */
function chSkyAt(P, pal, g, y) {
  const t = clamp(y / Math.max(1, P.H)), stops = chSkyStops(pal, g);
  let i = 0;
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++;
  const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
  return mix(c0, c1, clamp((t - t0) / (t1 - t0 || 1)));
}
/**
 * The sky's stops, top (0) to horizon (1): the slider `g` reaches the top's deeper colour further down and the light
 * of the horizon further up — the colours themselves pure, so a blue never goes grey on its way to an orange; at
 * dusk the light near the horizon going over to a band of glow along it. At 0, the sky's own colour alone.
 */
const chSkyStops = (pal, g) => {
  if (g <= 0) return [[0, pal.sky], [1, pal.sky]];
  const k = Math.min(1, g * 1.5), up = 0.5 * g;
  return pal.glow
    ? [[0, mix(pal.sky, pal.top, k)], [0.5 - up * 0.4, pal.sky], [1 - up, pal.sky], [1 - up * 0.3, mix(pal.sky, pal.low, k)], [1, mix(pal.low, pal.glow, k)]]
    : [[0, mix(pal.sky, pal.top, k)], [0.5 - up * 0.4, pal.sky], [1 - up, pal.sky], [1, mix(pal.sky, pal.low, k)]];
};
/** The sky from the top of the canvas down to the horizon, shifting gently in value toward it (`g`, the slider), and at dusk a band of glow along it. */
function chSky(ctx, P, pal, g) {
  const gr = ctx.createLinearGradient(0, 0, 0, Math.max(1, P.H));
  for (const [t, c] of chSkyStops(pal, g)) gr.addColorStop(t, css(c));
  ctx.fillStyle = gr; ctx.fillRect(0, 0, P.w, P.H + 2);
}
/** A smooth value noise in 0…1 (a lattice of rand(), smoothstepped between), for the wind's swathes in the grass. */
const chNoise = (x, y, k) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), r = (i, j) => rand(k + i * 57.31 + j * 131.77);
  return (r(xi, yi) * (1 - sx) + r(xi + 1, yi) * sx) * (1 - sy) + (r(xi, yi + 1) * (1 - sx) + r(xi + 1, yi + 1) * sx) * sy;
};
const BANDS = 4, TONES = 5, BLADES = [], CH_BLADE = 0.028;   // the last few blade sets worked out (chBlades), newest first; a blade's length at the foot, of the shorter side
/**
 * The grass of the ground field: short strokes in rows from the horizon down to the foot of the canvas, smaller
 * and closer toward the horizon (as the ground recedes), leaning with a wind that turns slowly across the field,
 * each a tone of five from shade to lit as the wind's swathes have it — the richer the contrast, and the more of
 * them, the higher `amt`. Returns a list per depth band and tone ([band * TONES + tone]), each [x0, y0, cx, cy, x1,
 * y1, …] in units: kept for the last few (the same cover drawn at another size, a thumbnail, finds them).
 */
export function chBlades(P, amt) {
  const { w, h, H, F, u } = P, key = [w, h, H.toFixed(2), F.y1, amt, seed].join("|"), got = BLADES.find((b) => b.key === key);
  if (got) return got.lists;
  const depth = Math.max(1, F.y1 - H), L1 = u * CH_BLADE, L0 = L1 * 0.3, dense = 0.36 + 0.56 * amt, lists = Array.from({ length: BANDS * TONES }, () => []);
  for (let y = H, row = 0; y < h + L1 * 0.3; row++) {
    const t = clamp((y - H) / depth), s = L0 + (L1 - L0) * t, band = Math.min(BANDS - 1, Math.floor(t * BANDS)), dx = (s * 0.44) / dense, dy = (s * 0.27) / dense;
    for (let x = -s + rand(row * 1.37 + 7100) * dx, i = 0; x < w + s; i++) {
      const k = row * 977.3 + i * 1.618, r1 = rand(k + 7101), r2 = rand(k * 1.3 + 7102), r3 = rand(k * 1.7 + 7103), r4 = rand(k * 2.1 + 7104);
      const swathe = chNoise(x / (w * 0.07 + 40), (y - H) / (depth * 0.3 + 20) + x / (w * 0.5), 7200), len = s * (0.5 + 0.7 * r1);
      const lean = 0.28 + (swathe - 0.5) * 0.5 + (chNoise(x / (w * 0.16 + 60), y / (depth * 0.6 + 30), 7300) - 0.5) * 0.6 + (r2 - 0.5) * 0.45;   // the wind from the left, combing the swathes further over
      const x0 = x + (r3 - 0.5) * dx, y0 = y + (r4 - 0.5) * dy * 1.6, x1 = x0 + Math.sin(lean) * len, y1 = y0 - Math.cos(lean) * len;
      const q = clamp(Math.round(2 + (swathe - 0.5) * 5 * (0.4 + 0.6 * amt) + (rand(k * 2.9 + 7105) - 0.5) * 2.6), 0, TONES - 1);
      lists[band * TONES + q].push(x0, y0, (x0 + x1) / 2 + Math.cos(lean) * len * 0.16 * (rand(k * 3.1 + 7106) - 0.3), (y0 + y1) / 2, x1, y1);
      x += dx * (0.6 + 0.8 * rand(k * 3.7 + 7107));
    }
    y += dy * (0.8 + 0.4 * rand(row * 2.3 + 7400));
  }
  BLADES.unshift({ key, lists });
  if (BLADES.length > 3) BLADES.pop();
  return lists;
}
/** The five tones of the grass at depth band b: shade to lit, toward the far colour the nearer the horizon. */
const chTones = (pal, b) => [mix(pal.shade, pal.ground, 0.15), mix(pal.shade, pal.ground, 0.58), mix(pal.ground, pal.lit, 0.12), mix(pal.ground, pal.lit, 0.5), mix(pal.ground, pal.lit, 0.85)].map((c) => mix(c, pal.far, (1 - (b + 0.5) / BANDS) * 0.5));
/**
 * The ground field, from the horizon to the foot of the canvas: the far colour at the horizon going over to the
 * ground's own, the wind's broad swathes lighter and its hollows darker, then the grass (chBlades) laid over it in
 * fine strokes, their tips breaking the line of the horizon. Painted once and kept (chLay) for the canvas's size.
 */
function chGround(ctx, P, pal, amt) {
  if (P.H >= P.h) return;
  const { w, h, H, F, u } = P, tip = u * 0.04, box = { x: 0, y: H - tip, w, h: h - H + tip }, key = [w, h, H.toFixed(2), F.y1, amt, seed, ...pal.ground, ...pal.far, ...pal.lit, ...pal.shade].join("|");
  const coarse = isDraft() && !chHolds(ctx, "chGround", key, box);   // a slider moving the ground is dragged over a coarser one, the full one painted as it is let go
  chLay(ctx, "chGround", coarse ? key + "|coarse" : key, box, (x) => {
    const depth = Math.max(1, F.y1 - H), g = x.createLinearGradient(0, H, 0, Math.max(H + 1, F.y1));
    g.addColorStop(0, css(pal.far)); g.addColorStop(0.3, css(mix(pal.far, pal.ground, 0.75))); g.addColorStop(1, css(mix(pal.ground, pal.shade, 0.14)));
    x.fillStyle = g; x.fillRect(0, H, w, h - H);
    if (amt <= 0) return;
    x.save(); x.beginPath(); x.rect(-10, H, w + 20, h - H + 10); x.clip();   // under the horizon only
    for (let i = 0, n = Math.round(6 + 10 * amt); i < n; i++) {   // the wind's swathes and hollows, broad and flattened by the distance
      const t = rand(i * 2.3 + 7500) ** 0.8, y = H + depth * t, s = (0.2 + 0.8 * t) * u * (0.22 + 0.3 * rand(i * 3.1 + 7501)), cx = rand(i * 4.7 + 7502) * w, lit = i % 3 === 0;
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, css(lit ? pal.lit : pal.shade, (lit ? 0.22 : 0.4) * amt)); gr.addColorStop(1, css(lit ? pal.lit : pal.shade, 0));
      x.save(); x.translate(cx, y); x.rotate((rand(i * 5.3 + 7503) - 0.5) * 0.25); x.scale(s * 1.9, s * 0.32); x.fillStyle = gr; x.fillRect(-1, -1, 2, 2); x.restore();
    }
    x.restore();
    const lists = chBlades(P, amt), L1 = u * CH_BLADE, step = coarse ? 18 : 6;   // a draft lays one blade in three
    x.lineCap = "round";
    for (let b = 0; b < BANDS; b++) {
      const tones = chTones(pal, b), lw = Math.max(0.5, (L1 * (0.3 + 0.7 * ((b + 0.5) / BANDS))) * 0.1) * (coarse ? 1.4 : 1), bent = b === BANDS - 1;   // only the nearest blades bend: further off a straight stroke reads the same, and costs less
      for (let q = 0; q < TONES; q++) {
        const d = lists[b * TONES + q];
        if (!d.length) continue;
        x.beginPath();
        for (let i = 0; i < d.length; i += step) { x.moveTo(d[i], d[i + 1]); if (bent) x.quadraticCurveTo(d[i + 2], d[i + 3], d[i + 4], d[i + 5]); else x.lineTo(d[i + 4], d[i + 5]); }
        x.strokeStyle = css(tones[q]); x.lineWidth = lw; x.stroke();
      }
    }
  });
}
const CH_KEEP = new Map();   // slot -> Map(canvas size -> { c, key }), the least lately used size first
/**
 * Paints paint(x) — a part of the picture, in units — once on a canvas covering only `box` (units, cut to the
 * canvas), and keeps it for the canvas's size while `key` (all it reads) holds; laid down on ctx pixel for pixel.
 * Six sizes a slot (the editor, the size thumbnails, a look card…), the least lately used let go; on a canvas over
 * 6 million pixels (an export), a turned one, or none (a test's stand-in) it is painted straight.
 */
/** Where chLay keeps a part on ctx's canvas: the canvas's size, the part's box there in pixels and the whole key; null where it paints straight. */
function chAt(ctx, box, key) {
  const m = canPaint(ctx) ? ctx.getTransform() : null, cv = m && ctx.canvas;
  if (!m || cv.width * cv.height > 6e6 || m.b || m.c) return null;
  const X0 = Math.max(0, Math.floor(m.e + box.x * m.a)), Y0 = Math.max(0, Math.floor(m.f + box.y * m.d));
  const X1 = Math.min(cv.width, Math.ceil(m.e + (box.x + box.w) * m.a)), Y1 = Math.min(cv.height, Math.ceil(m.f + (box.y + box.h) * m.d));
  return { m, X0, Y0, X1, Y1, sk: `${cv.width}x${cv.height}`, full: `${[m.a, m.d, m.e, m.f].map((v) => +v.toFixed(4))}|${X0},${Y0},${X1},${Y1}|${key}` };
}
/** Whether chLay holds the part `key` for ctx's canvas already. */
const chHolds = (ctx, slot, key, box) => { const a = chAt(ctx, box, key), e = a && CH_KEEP.get(slot) && CH_KEEP.get(slot).get(a.sk); return !!e && e.key === a.full; };
function chLay(ctx, slot, key, box, paint) {
  const at = chAt(ctx, box, key);
  if (!at) return paint(ctx);
  const { m, X0, Y0, X1, Y1, sk, full } = at;
  if (X1 <= X0 || Y1 <= Y0) return;
  const sizes = CH_KEEP.get(slot) || new Map();
  CH_KEEP.set(slot, sizes);
  let e = sizes.get(sk);
  if (e) sizes.delete(sk);
  else { e = { c: document.createElement("canvas"), key: null }; if (sizes.size >= 6) { const [k0, old] = sizes.entries().next().value; old.c.width = old.c.height = 0; sizes.delete(k0); } }
  sizes.set(sk, e);   // the newest
  if (e.key !== full) {
    e.c.width = X1 - X0; e.c.height = Y1 - Y0;
    const x = e.c.getContext("2d"); x.setTransform(m.a, 0, 0, m.d, m.e - X0, m.f - Y0);
    paint(x); e.key = full;
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(e.c, X0, Y0); ctx.restore();
}
/** Lets go everything the look keeps: its parts' canvases, the blades, its grain tile, its work canvases. */
export function chFreeAll() {
  for (const sizes of CH_KEEP.values()) for (const e of sizes.values()) e.c.width = e.c.height = 0;
  CH_KEEP.clear(); BLADES.length = 0;
  for (const k of ["chTooth"]) if (WORK[k]) { WORK[k].width = WORK[k].height = 0; delete WORK[k]; }
}

// ---------------------------------------------------------------- what stands in the fields
/**
 * Layered mountains behind the horizon, stepping back in value: the far ridge nearest the sky's colour, each
 * nearer one darker, each a profile of a few slow waves and a finer break. They rise where the sky is free and stay
 * low under the title (a valley opens beneath it). `amt`: one ridge, two, three, each coming in by degrees.
 */
function chHills(ctx, P, pal, g, amt) {
  const { w, H, F, u } = P, room = H - P.top, T = P.tk[0], n = Math.ceil(amt * 3), key = [w, P.h, H.toFixed(2), F.y0, room.toFixed(1), T ? [T.x, T.y, T.w, T.h].map(Math.round) : 0, amt, g, seed, ...pal.sky, ...pal.low, ...pal.deep, ...pal.ground].join("|");
  if (room < u * 0.05) return;
  chLay(ctx, "chHills", key, { x: 0, y: P.top, w, h: H - P.top + 2 }, (x) => {
    const base = chSkyAt(P, pal, g, H - room * 0.25), low = mix(pal.deep, mix(pal.ground, pal.sky, 0.5), 0.22);
    for (let i = 0; i < n; i++) {
      const a = clamp(amt * 3 - i), f = (i + 1) / 4, ph = rand(7600 + i * 3.1) * TAU, q = rand(7601 + i * 2.7) * TAU, fr = 1.3 + rand(7602 + i) * 1.6;
      const peak = Math.min(room * (0.62 - 0.14 * i) * (0.55 + 0.45 * amt), T ? Math.max(0, H - (T.y + T.h * 0.4)) : Infinity), ramp = Math.max(80, w * 0.12);   // never above the title's upper part; low under it, rising beyond it
      x.fillStyle = css(mix(base, low, 0.28 + 0.26 * i + 0.12 * f), a);
      x.beginPath(); x.moveTo(-10, H + 2);
      for (let px = -10; px <= w + 10; px += 6) {
        const tx = px / w, wave = 0.55 + 0.25 * Math.sin(tx * TAU * fr + ph) + 0.14 * Math.sin(tx * TAU * fr * 2.7 + q) + 0.06 * (rand(7610 + i * 911 + Math.round(px / 6)) - 0.5);
        let want = peak * clamp(wave, 0.08, 1);
        if (T) { const lim = Math.max(0, H - (T.y + T.h) - 10), e = px < T.x ? (T.x - px) / ramp : px > T.x + T.w ? (px - T.x - T.w) / ramp : 0, s = clamp(e); want = Math.min(want, lim + (want - lim) * s * s * (3 - 2 * s)); }
        x.lineTo(px, H - Math.max(0, want));
      }
      x.lineTo(w + 10, H + 2); x.closePath(); x.fill();
    }
  });
}
/** A gabled house seen at its corner: the gable end, the long side going back, a snowy or pale roof, a chimney, dark windows; `lit`, one of them lit warm. */
function chHouse(ctx, x, foot, s, wall, roof, lit, face, k) {
  const bw = s * (0.85 + 0.3 * rand(k)), bh = s * (0.62 + 0.25 * rand(k + 1)), rh = bw * 0.48, sw = s * (0.7 + 0.6 * rand(k + 2)) * face, gx = face > 0 ? x : x + Math.abs(sw);
  const side = mix(wall, [0, 0, 0], 0.14), top = foot - bh, ridge = top - rh;
  ctx.fillStyle = css(side); ctx.fillRect(Math.min(gx + (face > 0 ? bw : 0), gx + (face > 0 ? bw : 0) + sw), top, Math.abs(sw), bh);   // the long side going back
  ctx.fillStyle = css(roof); ctx.beginPath();   // its roof, a slab from the ridge down to the eave
  const ex = gx + (face > 0 ? bw : 0);
  ctx.moveTo(gx + bw / 2, ridge); ctx.lineTo(gx + bw / 2 + sw, ridge); ctx.lineTo(ex + sw + face * s * 0.06, top + s * 0.02); ctx.lineTo(ex + face * s * 0.06, top + s * 0.02); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(wall); ctx.beginPath(); ctx.moveTo(gx, foot); ctx.lineTo(gx, top); ctx.lineTo(gx + bw / 2, ridge); ctx.lineTo(gx + bw, top); ctx.lineTo(gx + bw, foot); ctx.closePath(); ctx.fill();   // the gable end
  ctx.fillStyle = css(roof); ctx.beginPath(); const t = s * 0.07;   // snow along the gable's edges
  ctx.moveTo(gx - s * 0.06, top + t * 0.4); ctx.lineTo(gx + bw / 2, ridge - t); ctx.lineTo(gx + bw + s * 0.06, top + t * 0.4); ctx.lineTo(gx + bw + s * 0.06 - t, top + t * 1.3); ctx.lineTo(gx + bw / 2, ridge + t * 0.6); ctx.lineTo(gx - s * 0.06 + t, top + t * 1.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = css(mix(wall, [0, 0, 0], 0.3)); ctx.fillRect(gx + bw / 2 + sw * 0.62 - s * 0.04, ridge - s * 0.16, s * 0.08, s * 0.2);   // the chimney
  const win = s * 0.12, wy = top + bh * 0.34;
  ctx.fillStyle = css(mix(wall, roof, 0.18)); ctx.fillRect(gx + bw * 0.5 - win / 2, wy, win, win * 1.15);
  if (Math.abs(sw) > s * 0.8) ctx.fillRect(Math.min(ex, ex + sw) + Math.abs(sw) * 0.45, wy, win, win * 1.15);
  if (lit) { ctx.fillStyle = css(lit); ctx.fillRect(gx + bw * 0.5 - win / 2, wy, win, win * 1.15); }
}
/** The row of houses (chHousesAt): dark walls, pale roofs, one window lit; the first `n`, each `s` in size in its own place (spaced as at their largest, `s1`). */
function chHouses(ctx, P, pal, at) {
  const { x0, foot, s, s1, n } = at, wall = mix(pal.deep, pal.ground, dark ? 0.3 : 0.38), roof = mix(pal.light, pal.far, dark ? 0.35 : 0.2), one = Math.floor(rand(7700) * n);
  let x = x0 + s1 * 0.2;
  for (let i = 0; i < n; i++) {
    const k = 7701 + i * 7.3, sc = 0.8 + 0.4 * rand(k + 5), face = rand(k + 6) < 0.5 ? 1 : -1, f = foot + s1 * 0.12 * rand(k + 7);
    chHouse(ctx, x, f, s * sc, wall, roof, i === one ? [255, 214, 112] : null, face, k);
    x += s1 * sc * (1.55 + 0.5 * rand(k + 8));
  }
}
/**
 * Walls after Barragán, in hard-edged flat planes: a tall wall in the palette's third colour with a doorway onto the
 * sky, a slab standing out from it toward the light, a low wall before it, a white stair climbing the low wall to the
 * slab, the light catching every tread and a crisp stepped shadow under the flight; each casting a hard shadow across
 * the ground, away from the light.
 */
function chWalls(ctx, P, pal, g, at) {
  const { x0, foot, W, ht } = at, side = P.side, A = pal.third, B = mix(pal.third, pal.light, 0.55), lowC = mix(pal.ground, pal.third, 0.35), stair = pal.light;
  const shadeOf = (c, k = 0.34) => mix(c, pal.deep, k), mir = (x) => (side > 0 ? x : 2 * x0 + W - x);   // laid out for light from the right, mirrored for light from the left
  const poly = (pts, c) => { ctx.fillStyle = css(c); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(mir(x), y) : ctx.moveTo(mir(x), y))); ctx.closePath(); ctx.fill(); };
  const bx = x0, bw = W * 0.7, top = foot - ht, sx = x0 + W * 0.68, sw = W * 0.14, stop = foot - ht * 1.1, lh = ht * 0.4, lx = x0 - W * 0.04, lw = W * 0.56;
  poly([[bx - ht * 0.5, foot + ht * 0.1], [bx + bw - ht * 0.5, foot + ht * 0.1], [bx + bw, foot], [bx, foot]], shadeOf(pal.ground, 0.45));   // the shadows on the ground
  poly([[bx, top], [bx + bw, top], [bx + bw, foot], [bx, foot]], A);   // the tall wall
  const dx = bx + bw * 0.14, dw = bw * 0.13, dt = top + ht * 0.14, db = top + ht * 0.52;
  poly([[dx, dt], [dx + dw, dt], [dx + dw, db], [dx, db]], chSkyAt(P, pal, g, (dt + db) / 2));   // its doorway onto the sky
  poly([[dx, dt], [dx + dw * 0.28, dt], [dx + dw * 0.28, db], [dx, db]], shadeOf(A, 0.28));   // the reveal in shade
  poly([[sx, stop], [sx + sw, stop], [sx + sw, foot], [sx, foot]], B);   // the slab toward the light
  poly([[sx, stop], [sx + sw * 0.22, stop], [sx + sw * 0.22, foot], [sx, foot]], shadeOf(B, 0.2));   // its edge turned away
  poly([[lx, foot - lh], [lx + lw, foot - lh], [lx + lw, foot], [lx, foot]], lowC);   // the low wall
  const n = 7, sx0 = lx + lw * 0.32, sx1 = sx, sy0 = foot, sy1 = foot - ht * 0.72, tw = (sx1 - sx0) / n, th = (sy0 - sy1) / n, flight = [[sx0, foot]];
  for (let i = 0; i < n; i++) { flight.push([sx0 + tw * i, sy0 - th * (i + 1)], [sx0 + tw * (i + 1), sy0 - th * (i + 1)]); }
  flight.push([sx1, foot]);
  const shadow = flight.map(([x, y], i) => (i === 0 || i === flight.length - 1 ? [x, y] : [x - tw * 0.7, y + th * 1.6]));
  poly(shadow, shadeOf(lowC, 0.3));   // the flight's shadow, stepped, down the low wall
  poly(flight, stair);   // the stair
  for (let i = 0; i < n; i++) poly([[sx0 + tw * i, sy0 - th * (i + 1)], [sx0 + tw * (i + 0.24), sy0 - th * (i + 1)], [sx0 + tw * (i + 0.24), sy0 - th * i], [sx0 + tw * i, sy0 - th * i]], shadeOf(stair, 0.1));   // the risers a shade off the treads
}
/** ctx with its half-clear fills left out — a graphic's own soft ground shadow — for the lone object, which casts a shadow of its own. */
const chSolid = (ctx) => new Proxy(ctx, {
  get(t, k) { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; },
  set(t, k, v) { if (k === "fillStyle" && typeof v === "string") { const c = parseColour(v); if (c && c[3] < 0.6) v = "rgba(0,0,0,0)"; } t[k] = v; return true; },
});
/**
 * The lone object: the channel graphic (or the figure put in its place) as it is drawn, its colours in the palette's
 * world (the look's wrap), small, standing on the ground; its shadow laid along the ground away from the light, long
 * and flattened, soft at the edge, darkest at its foot; a few blades of grass across its foot.
 */
function chFigure(ctx, P, pal, S, g, at, p) {
  const { cx, foot, s } = at, cy = foot - s / 2, side = P.side, onGround = P.depth > 1 && foot > P.H;
  if (onGround) {
    const sh = mix(pal.ground, pal.deep, 0.62);
    ctx.save(); ctx.translate(cx, foot); ctx.transform(1, 0, side * 1.05, -0.2, 0, 0); ctx.translate(-cx, -foot);
    blurred(ctx, s * 0.025, css(sh, 0.78), () => placeShape(ctx, S, [0, 0, 0], cx, cy, s));
    ctx.restore();
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, css(sh, 0.7)); gr.addColorStop(1, css(sh, 0));
    ctx.save(); ctx.translate(cx - side * at.wd * 0.12, foot); ctx.scale(at.wd * 0.62, s * 0.05); ctx.fillStyle = gr; ctx.fillRect(-1, -1, 2, 2); ctx.restore();
  }
  const b = S.box, k = s / Math.max(1, b.y1 - b.y0);   // its solid part `s` tall, as the silhouette is placed
  ctx.save(); ctx.translate(cx, cy); ctx.scale(k, k); ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2); g.draw(chSolid(ctx)); ctx.restore();
  if (onGround && p.grass > 0) {   // grass across its foot
    const tones = chTones(pal, Math.min(BANDS - 1, Math.floor(clamp((foot - P.H) / P.depth) * BANDS))), L = s * 0.05;
    ctx.save(); ctx.lineCap = "round"; ctx.lineWidth = Math.max(0.5, L * 0.12);
    for (let q = 1; q < TONES; q++) {
      ctx.strokeStyle = css(tones[q]); ctx.beginPath();
      for (let i = 0; i < 14; i++) { const k = 7800 + q * 31 + i * 1.7, bx = cx + (rand(k) - 0.5) * at.wd * 1.1, by = foot + L * (0.1 + 0.5 * rand(k + 1)), a = 0.28 + (rand(k + 2) - 0.5) * 0.7, l = L * (0.6 + rand(k + 3)); ctx.moveTo(bx, by); ctx.lineTo(bx + Math.sin(a) * l, by - Math.cos(a) * l); }
      ctx.stroke();
    }
    ctx.restore();
  }
}
/** A bird perched on a wire at (x, y), `s` long, facing `face`: an upright body, a round head, a beak, a long tail hanging below the wire. */
function chBird(ctx, x, y, s, face, colour) {
  ctx.fillStyle = css(colour);
  ctx.beginPath(); ctx.ellipse(x + face * s * 0.04, y - s * 0.3, s * 0.2, s * 0.36, face * 0.22, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(x + face * s * 0.14, y - s * 0.72, s * 0.16, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x + face * s * 0.26, y - s * 0.78); ctx.lineTo(x + face * s * 0.42, y - s * 0.68); ctx.lineTo(x + face * s * 0.25, y - s * 0.64); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - face * s * 0.14, y - s * 0.12); ctx.lineTo(x - face * s * 0.3, y + s * 0.66); ctx.lineTo(x - face * s * 0.2, y + s * 0.7); ctx.lineTo(x + face * s * 0.08, y - s * 0.04); ctx.fill();
}
/** Where wire `i` meets the pole (chPoleAt): the two arms' ends and its head. */
const chHang = (at, i) => [[at.x - at.arm * 0.86, at.top + (at.foot - at.top) * 0.05], [at.x + at.arm * 0.86, at.top + (at.foot - at.top) * 0.05], [at.x, at.top]][i];
/** A wire from a to b, sagging, as a quadratic's three points. */
const chSpan = (a, b) => [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + Math.abs(b[0] - a[0]) * 0.055], b];
const chOnSpan = ([a, c, b], t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
/** A pole of the line at (x, foot), `tall` high, its arms `arm` either side: the shaft, two arms, the insulators. */
function chPost(ctx, x, foot, tall, arm) {
  const pw = Math.max(1.2, tall * 0.016), top = foot - tall, ya = top + tall * 0.05;
  ctx.fillRect(x - pw / 2, top, pw, tall);
  ctx.fillRect(x - arm, ya, arm * 2, pw * 0.75); ctx.fillRect(x - arm * 0.55, ya + tall * 0.06, arm * 1.1, pw * 0.6);
  for (const ix of [-0.86, -0.3, 0.3, 0.86]) ctx.fillRect(x + arm * ix - pw * 0.2, ya - pw * 0.7, pw * 0.4, pw * 0.75);
}
/**
 * The power line: the near pole `at` (as drawn: chPoleAt's, sized and dragged), its wires running off the edge beside
 * it and back to the far pole standing small on the horizon `at.d` of the field off toward the middle, and the birds
 * sitting along them, each in its place (`at.birds`, found in chPoleAt): `amt` up to a half brings in the wires one by
 * one, past it the birds land one by one. In the deep colour; the birds in the third colour by day, dark at dusk.
 */
function chPole(ctx, P, pal, at, amt) {
  const { x, foot, top, arm } = at, tall = foot - top, pw = Math.max(1.5, tall * 0.016), wires = Math.min(3, 1 + Math.floor(amt * 6)), birds = Math.round(clamp((amt - 0.45) / 0.55) * 9), deep = css(pal.deep);
  const toward = x > P.F.x0 + P.fw / 2 ? -1 : 1, edge = toward < 0 ? P.F.x1 + 80 : P.F.x0 - 80, far = chFar(P, at, toward, at.d);   // the far pole toward the middle, the edge on its own side
  const spans = [];   // { q: a quadratic's points, back: running back to the far pole (smaller birds the further along) }, two a wire
  for (let i = 0; i < 3; i++) { const a = chHang(at, i); spans.push({ q: chSpan(a, [edge, a[1] + P.fh * 0.1 * (1 + i * 0.12)]), back: false }, { q: chSpan(a, chHang(far, i)), back: true }); }
  ctx.save(); ctx.strokeStyle = deep; ctx.lineWidth = Math.max(1, pw * 0.22); ctx.lineCap = "round";
  ctx.beginPath(); for (const { q: [a, c, b] } of spans.slice(0, wires * 2)) { ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]); } ctx.stroke();
  ctx.fillStyle = deep;
  chPost(ctx, far.x, far.foot, far.foot - far.top, far.arm);
  chPost(ctx, x, foot, tall, arm);
  const bs = Math.max(4, tall * 0.075), colour = dark ? mix(pal.deep, pal.sky, 0.15) : pal.third;
  for (const { j, t, k } of at.birds.slice(0, birds)) {   // (the birds land once all three wires are up)
    const sp = spans[j], [bx, by] = chOnSpan(sp.q, t);
    chBird(ctx, bx, by, bs * (sp.back ? 1 - t * 0.55 : 1), rand(7902 + k) < 0.5 ? 1 : -1, colour);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- the photo, the grain
/** The photo's tones onto the palette, by its lightness: the deep in its blacks, the darker field in its shadows, the lighter in its middle tones, the light in its highlights. */
export const chStops = (pal) => { const [a, b] = lum(pal.sky) < lum(pal.ground) ? [pal.sky, pal.ground] : [pal.ground, pal.sky]; return [[0, mix(pal.deep, a, 0.3)], [0.32, a], [0.64, b], [1, pal.light]]; };
/** RGBA pixels posterised into the palette (chStops), stepped hard between its fields; alpha kept. */
export function chTritone(d, pal) {
  const lut = toneTable(chStops(pal), 0.55);
  for (let i = 0; i < d.length; i += 4) { const j = ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8) * 3; d[i] = lut[j]; d[i + 1] = lut[j + 1]; d[i + 2] = lut[j + 2]; }
}
/** The paper's tooth: a tile of fine mottle at a few pixels' scale, ink taking more and less, with specks; grey round 128, to lay on in overlay. */
function chTooth() {
  let t = WORK.chTooth;
  if (t) return t;
  const n = 192, c = 64, lat = new Float32Array(c * c);
  let s = 40961;
  const next = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 8) / 8388608; };
  for (let i = 0; i < lat.length; i++) lat[i] = next();
  t = WORK.chTooth = document.createElement("canvas"); t.width = t.height = n;
  const x = t.getContext("2d"), img = x.createImageData(n, n), d = img.data, at = (i, j) => lat[((j + c) % c) * c + ((i + c) % c)];
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const gx = px / 2, gy = py / 2, i = Math.floor(gx), j = Math.floor(gy), fx = gx - i, fy = gy - j;
    const m = (at(i, j) * (1 - fx) + at(i + 1, j) * fx) * (1 - fy) + (at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx) * fy, r = next();
    const v = 128 + (m - 0.5) * 76 + (r - 0.5) * 56 + (r > 0.99 ? 60 : r < 0.008 ? -70 : 0), o = (py * n + px) * 4;
    d[o] = d[o + 1] = d[o + 2] = clamp(v, 0, 255); d[o + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return t;
}
/** The tooth laid over the canvas in overlay (strong but fine: its size kept on big exports). */
function chGrain(ctx, amt, unit) {
  if (amt <= 0 || !canPaint(ctx) || typeof document === "undefined") return;
  const pat = ctx.createPattern(chTooth(), "repeat");
  if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(Math.max(1, unit * 1.1)));
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = "overlay"; ctx.globalAlpha = Math.min(1, amt); ctx.fillStyle = pat; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
}

/**
 * Flat layouts of its own (blockLayout): on a wide cover the title's box leaves the sky's far third open — the air the
 * lone object, the disc and what stands on the horizon have round them — less so as the cover nears a square; in a
 * square or a tall one the sky has its room above the horizon already, and in the side panel's layout beside it.
 */
export function chLayout(template, w, h) {
  const G = blockLayout(template, w, h, { band: 0.15, side: 0.28, strip: 0.1 });
  if (G.template !== "split") { const k = 1 - 0.34 * clamp((w / h - 1) / (16 / 9 - 1)); G.title = { ...G.title, w: Math.round(G.title.w * k) }; }
  return G;
}
export const chroma = {
  id: "chroma",
  art: "subject",
  repaint: (c) => `a surreal chromatic minimalist picture made from the photograph: two or three enormous flat fields of fully saturated, near-complementary colour meeting at a level horizon (a cobalt blue sky over vermilion grass, or a molten orange sky over violet snow), velvety grass of fine short strokes, the subject small and alone with a great deal of air round it and a long soft shadow on the ground, ${c} as one of the fields or a small accent, quiet and cinematic, fine risograph grain; still the same picture, no text.`,
  about: {
    zh: "纯色旷野：超现实的色彩极简主义——两三块巨大的、饱和到极点的纯色在一条地平线上相遇：钴蓝的天空压着朱红的草地，熔金般的橙色天空下是紫色的雪原，红色的地上站着青色的东西，巴拉甘式的镉黄与正红墙面衬着深蓝的天，粉色的沙丘顶着电光蓝。一块颜色占据大半，另一块只是一条带子，色块是第三种颜色，干干净净、边缘利落。一个小小的东西孤零零地立在地上，四周留着大片的空，影子长长地拖在草上——就是频道图形本来的样子（也可以换成别的图形），颜色收进这套配色。地面不是死平的：细短笔触织成的绒草，被风吹出明暗的纹路，草尖刺破地平线；天空朝地平线方向轻轻地变亮；整张画面盖着一层细而有力的孔版纸纹。其余一切都是干净的平面。可加一轮扁平的太阳或月亮、电线与停在上面的小鸟、地平线上一排亮着一扇窗的远处小屋、一层层往后退的山影、巴拉甘式的墙和楼梯（硬边的平面、利落的斜影）。七套配色（1 橙紫、2 粉配电光蓝、3 红青、4 钴蓝配朱红、5 巴拉甘黄红蓝、6 青橙、7 群青配一点橙）；可以把频道色用作地面。浅色是白天，深色是同一个世界的黄昏与夜晚：深蓝、紫、地平线上一道发光的橙。标题是干净的粗黑体，平涂，颜色挑在天空上最醒目的那一种，高亮字用第三种颜色。照片会被压成这套配色的三个色调。安静、电影感、超现实——适合音乐、旅行、生活方式、品牌、艺术、情绪与概念类内容。自带平直的版式。",
    en: "Chroma field: chromatic surrealist minimalism — two or three enormous fields of fully saturated colour meeting at a horizon: a cobalt sky over vermilion grass, a molten orange sky over violet snow, a red ground under something cyan, Barragán's cadmium yellow and red walls against a deep blue sky, pink dunes under electric blue. One field takes most of the picture, the other is a band, and the colour block is a third, clean, its edge crisp. One small object stands alone on the ground with a great deal of air round it, its shadow long on the grass: the channel graphic as it is drawn (or another you choose), its colours brought into the palette. The ground is not dead flat: velvety grass of fine short strokes, combed light and dark by the wind, its tips breaking the horizon; the sky lightens gently toward the horizon; a fine but strong risograph grain lies over all. Everything else is clean and flat. A flat sun or moon, power lines with small birds on them, a row of distant houses with one lit window, mountain ridges stepping back in value, and Barragán walls and a stair (hard-edged planes, crisp diagonal shadows) if you like. Seven palettes (1 orange and violet, 2 pink and electric blue, 3 red and cyan, 4 cobalt and vermilion, 5 Barragán's yellow, red and blue, 6 teal and orange, 7 ultramarine with one orange); the channel colour can take the ground. The light ground is daylight; the dark one is the same world at dusk and night — deep blues, violet, a glowing orange horizon. The title is a clean heavy grotesk, flat, in the colour that reads best on the sky, its highlighted words in the third colour. A photo is posterised into the palette's three tones. Quiet, cinematic, surreal — for music, travel, lifestyle, brands, art, moods and ideas. Flat layouts of its own.",
  },
  name: { zh: "纯色旷野", en: "Chroma field" },
  seeded: true,
  leave: chFreeAll,   // what it keeps (the ground and the ridges per canvas size, the blades, the grain tile) goes as another look is chosen
  scene: { subject: { zh: "孤立之物", en: "Lone object" }, sun: { zh: "日轮", en: "Sun disc" }, pole: { zh: "电线杆", en: "Power pole" }, walls: { zh: "巴拉甘墙", en: "Barragán walls" } },
  params: [
    { key: "palette", min: 1, max: 7, step: 1, def: 4, name: { zh: "配色（1–7）", en: "Palette (1–7)" } },
    { key: "ground", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "地面", en: "Ground" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "天际渐亮", en: "Light toward the horizon" } },
    { key: "grass", min: 0, max: 1, step: 0.05, def: 0.65, name: { zh: "绒草笔触", en: "Velvet grass" } },
    { key: "subject", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "孤立之物", en: "Lone object" } },
    { key: "sun", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "日轮", en: "Sun disc" } },
    { key: "lines", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "电线与小鸟", en: "Power lines and birds" } },
    { key: "houses", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "远处小屋", en: "Distant houses" } },
    { key: "hills", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "层叠山影", en: "Mountain layers" } },
    { key: "walls", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "巴拉甘墙与梯", en: "Barragán walls" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "孔版颗粒", en: "Risograph grain" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "地面用频道色", en: "The channel colour for the ground" } },
    { key: "tritone", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "照片三色调", en: "Photo in three tones" } },
  ],
  titleFont: (f) => f.cn,   // a clean heavy grotesk, for Latin and CJK alike
  layout: chLayout,
  theme: (base, C, p) => { const pal = chPal(p), own = onColour(chBlock(C, p), pal); return { ...base, field: css(pal.sky), text: css(pal.type), own: css(own), dim: css(pal.type, 0.62), titleFill: css(pal.type), titleInk: css(pal.sky), grid: () => css(pal.type, 0.16) }; },
  /**
   * The ground: the sky shifting toward the horizon, the ground field below it in its grass (painted once and kept).
   * On it, from the back, each by its slider: the disc, the mountain ridges (the ground laid again over their foot),
   * the houses, the walls, the lone object with its shadow, the pole with its wires and birds (the nearer of the
   * object and the pole in front). A photo is posterised into the palette, the slider fading it in over the photo.
   */
  background(ctx, env, L, p) {
    const { C } = env;
    if (env.photo) {
      const a = p.tritone, pal = chPal(p), sd = dark ? 1 : 0;
      if (a < 1) env.drawPhoto();
      if (a > 0) { ctx.save(); ctx.globalAlpha = a; env.drawPhoto(0, { key: `ch|${Math.round(p.palette)}|${sd}`, fn: (d) => chTritone(d, pal) }); ctx.restore(); }
      return true;
    }
    const S = L.grid ? graphicShape(env) : null, P = chPlan(ctx, env, p, S), pal = chFields(C, p), onto = L.base === "clear";   // the silhouette whether the object is on or not: its room is kept either way
    if (L.ground !== false) { chSky(ctx, P, pal, p.glow); chGround(ctx, P, pal, p.grass); }
    if (!L.grid) return true;
    let again = false;   // whether the ground goes over what stands behind its horizon
    if (P.sun) {
      const [sx, sy] = objAt("sun", P.sun.x, P.sun.y, ctx), r = P.sun.r;
      ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, P.w + 20, P.H + 10); ctx.clip(); ctx.fillStyle = css(pal.sun); ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill(); ctx.restore();
      again = sy + r > P.H - P.u * 0.04;
    }
    if (p.hills > 0) { ctx.save(); ctx.beginPath(); ctx.rect(-10, -10, P.w + 20, P.H + 11); ctx.clip(); chHills(ctx, P, pal, p.glow, p.hills); ctx.restore(); again = true; }
    if (again && !onto) chGround(ctx, P, pal, p.grass);
    if (P.houses) chHouses(ctx, P, pal, P.houses);
    if (P.walls) { ctx.save(); const [X, Y] = objAt("walls", P.walls.x0 + P.walls.W / 2, P.walls.foot - P.walls.ht / 2, ctx); ctx.translate(X - (P.walls.x0 + P.walls.W / 2), Y - (P.walls.foot - P.walls.ht / 2)); chWalls(ctx, P, pal, p.glow, P.walls); ctx.restore(); }
    const fig = P.fig && S ? (() => { const [X, Y] = objAt("subject", P.fig.cx, P.fig.foot - P.fig.s / 2, ctx); return { ...P.fig, cx: X, foot: Y + P.fig.s / 2 }; })() : null;
    const pole = P.pole ? (() => { const [X, Y] = objAt("pole", P.pole.x, (P.pole.top + P.pole.foot) / 2, ctx), dy = Y - (P.pole.top + P.pole.foot) / 2; return { ...P.pole, x: X, top: P.pole.top + dy, foot: P.pole.foot + dy }; })() : null;
    const figure = () => fig && chFigure(ctx, P, pal, S, figureOf(env), fig, p), wires = () => pole && chPole(ctx, P, pal, pole, p.lines);
    if (pole && fig && pole.foot < fig.foot) { wires(); figure(); } else { figure(); wires(); }
    return true;
  },
  /** A perspective grid: the ground's lines running to a point on the horizon, level ones closing up toward it, the sky squared off above. */
  gridLines(ctx, env, color) {
    const P = chPlan(ctx, env, values), { w, h, H } = P, vx = w / 2;
    gridPen(ctx, color); ctx.beginPath();
    for (let x = 120; x < w; x += 120) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = H - 120; y > 0; y -= 120) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.moveTo(0, H); ctx.lineTo(w, H);
    if (h > H) {
      for (let i = -14; i <= 14; i++) { ctx.moveTo(vx + i * 6, H); ctx.lineTo(vx + i * w * 0.16, h + (h - H)); }
      for (let j = 1; j <= 9; j++) { const y = H + (h - H) * (j / 9) ** 2; ctx.moveTo(0, y); ctx.lineTo(w, y); }
    }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(chBlock(C)), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a pure field of its own colour, its edge crisp
  /** A clean heavy grotesk, flat and upright, in the colour that reads on the sky; the highlighted words in the third colour. */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const pal = chPal(p), face = css(o.fill || pal.type);
    let hi = null;
    pass((a, x) => { ctx.fillStyle = a.hi ? hi || (hi = css(o.hi || pal.hi)) : face; ctx.fillText(a.t, x, 0); });
  },
  // the graphics in the palette's world: the house ink to its deep, the lights to its light, colours made vivid, lines a little finer; the small parts on the block in what reads on it
  wrap: (ctx, C, p, plates) => {
    const pal = chPal(p);
    if (plates) { const on = onColour(chBlock(C, p), pal); return mapped(ctx, { fill: { ink: on }, stroke: { ink: on } }); }
    const shade = (f) => (c) => (c[3] < 0.6 ? pal.deep : typeof f === "function" ? f(c) : f);   // a half-clear fill (a ground shadow) in the deep
    return mapped(ctx, { fill: { ink: pal.deep, light: shade(pal.light), mid: shade(mix(pal.light, pal.sky, 0.35)), dark: shade(mix(pal.deep, pal.sky, 0.3)), colour: shade((c) => boost(c, 0.6)) }, stroke: { ink: pal.deep, light: pal.light }, line: 0.6 });
  },
  sticker: painters({ line: null, tone: (fill) => inkAs(chPal().deep, (c) => boost(c, 0.55))(fill), shadow(ctx, draw) { const pal = chPal(); ctx.save(); ctx.translate(-12, 10); draw(css(pal.deep, 0.26)); ctx.restore(); } }),
  /** The corner tag: a flat block of the highlight colour, its letters spaced, in what reads on it. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const pal = chPal(p), f = fs * 0.5, bg = pal.hi;
    ctx.font = `800 ${f}px ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 1.4, hh = f * 1.75, top = y + (fs * 1.34 - hh);
    ctx.fillStyle = css(bg); ctx.fillRect(x, top, w, hh);
    ctx.fillStyle = ink || css(onColour(bg, pal)); spaced(ctx, str, x + f * 0.7, top + hh * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: hh + 8 };
  },
  /** The frame layer: a print's crop marks in the four corners, fine. */
  frame(ctx, env) {
    const { w, h } = env, pal = chPal(), m = 22, l = 26;
    ctx.save(); ctx.strokeStyle = css(pal.type, 0.55); ctx.lineWidth = 2; ctx.lineCap = "butt"; ctx.beginPath();
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [w - m, m, -1, 1], [m, h - m, 1, -1], [w - m, h - m, -1, -1]]) { ctx.moveTo(x + sx * 8, y); ctx.lineTo(x + sx * (8 + l), y); ctx.moveTo(x, y + sy * 8); ctx.lineTo(x, y + sy * (8 + l)); }
    ctx.stroke(); ctx.restore();
  },
  /** The plate under a text layer: a flat block, its edge crisp. */
  plate(ctx, x, y, w, h, colour) { ctx.fillStyle = colour; ctx.fillRect(x, y, w, h); },
  /** An uploaded image stands in the field: a soft shadow cast low and away from the light. */
  image(ctx, C, unit) { ctx.shadowColor = css(chPal().deep, 0.38); ctx.shadowBlur = 18 * unit; ctx.shadowOffsetX = -12 * unit; ctx.shadowOffsetY = 12 * unit; },
  post(ctx, w, h, C, p, unit = 1) { chGrain(ctx, p.grain * 0.78 * clamp(0.4 + unit), unit); },   // fainter on a thumbnail, where it would only be noise
  prompt: `Objects for a surreal colour-field picture — one small, lone, iconic thing standing in an enormous field of pure colour:
- one clear object per sticker (a cactus, a rubber duck, a chair, a radio, a door, a ladder, a lemon, a red ball, a bird, a telephone), simple and smooth, with a strong silhouette; no realism, no fine detail, no ground or scenery of its own;
- flat colour only, fully saturated: the main colour, one complementary colour and "white" for a small highlight; never muddy or grey;
- the app adds no outline and lays a soft cast shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects standing alone in a field of pure colour, built as simple models from a few boxes and cylinders — a doorway, a wall with a stair, a bench, a mailbox, a lamp post, a small house; no realism, no fine detail.
- the renderer paints faces in flat saturated colour with crisp shade: do NOT try to draw shading or outlines yourself;
- "white" is a warm white, "dark" the deep of the sky, and "main" the channel colour — use it for one or two parts.`,
};
chroma.elementFx = [
  { key: "tritone", name: { zh: "照片三色调", en: "Photo in three tones" }, for: FX_PHOTO, stage: "filter",
    /** The photo posterised into the palette: its blacks to the deep, its shadows to the darker field, its middle tones to the lighter, its highlights to the light. */
    paint: tonesFx(() => chStops(chPal()), 0.55) },
  { key: "cast", name: { zh: "地上投影", en: "Cast shadow" }, for: FX_ALL, stage: "behind", reach: (B) => ({ l: B.h * 1.12, b: B.h * 0.26 }),
    /** The layer standing on the field: its shadow laid along the ground from its foot, away from the light at the upper right — flattened, leaning, soft at its edge. */
    paint(x, B, a) {
      const pal = chPal(), src = region(x, B, "fxA"), shape = shapeIn(src, pal.deep, "fxChCast"), soft = softened(shape, Math.max(2, Math.min(B.w, B.h) * 0.02), "fxChSoft");
      x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, 0.62 * a); x.imageSmoothingEnabled = true;
      x.transform(1, 0, 1.05, -0.24, B.x0 - 1.05 * B.h, B.y1 + 0.24 * B.h);   // (u, v) of the layer -> its height above its foot laid down to the left and a little nearer, the foot where it is
      x.drawImage(soft, 0, 0, B.w, B.h);
      x.restore();
    } },
  { key: "flat", name: { zh: "纯色剪影", en: "Flat colour" }, for: FX_ALL, stage: "fill",
    /** The layer as one flat field of the palette's third colour, its shape kept. */
    paint: flatFx(() => css(chPal().third)) },
  { key: "tooth", name: { zh: "孔版颗粒", en: "Risograph tooth" }, for: FX_ALL, stage: "over",
    /** The paper's tooth inside the layer: ink taking more and less in a fine mottle. */
    paint(x, B, a, E) {
      if (typeof document === "undefined") return;
      const src = region(x, B, "fxA");
      onLayer(x, B, src, "overlay", Math.min(1, a * 0.5), (g) => { const pat = g.createPattern(chTooth(), "repeat"); if (pat.setTransform && typeof DOMMatrix !== "undefined") pat.setTransform(new DOMMatrix().scale(Math.max(1, E.k * 1.1))); g.fillStyle = pat; g.fillRect(0, 0, B.w, B.h); });
    } },
];
