// Surprise me's rules, all of them, in one place: how a hand is dealt and how one of them is kept.
//   RULES       every number it deals by — how many hands, how likely each switch, the ranges of the sliders,
//               outlines and shadows, how the user's layers are placed, how a hand is scored and kept
//   FAMILIES    what suits each family of looks (the dark ground, letterings, bends)
//   RECIPES     what suits each look: its family, what differs, its optional parts
//   dealCover   a hand, in the order it is dealt: the look and its sliders, its scene, the ground, the words
//               put back, the title on top, each layer's own choices and look effects
//   coverScore, pickHand   how the hands are scored by the cover standards (check.js), and which is kept
// What needs the cover drawn stays in app.js: surprise() deals the hands (dealHand: dealCover, then the
// user's layers placed by dealPlaces, which reads RULES.places), measures each and shows it. The user's own
// recipes (the Style tab) lie over RECIPES; what they lock, and their taste, come in through `env`. Pure:
// `R` is the random source, a function returning numbers in [0, 1).
import { LOOKS, LOOK_IDS, effectsFor, FX_TYPES } from "./style.js";
import { EFFECTS, BENDS } from "./textfx.js";
import { titleLines, lineUnits, luminance, checkCover, typeSize, LIMITS } from "./check.js";
import { PLATFORM_IDS, wanted, isRatio } from "./platforms.js";
import { ACCENT_SHAPES, LETTERED, newLayer, clipEnd, moveScene } from "./layers.js";

/**
 * Every number Surprise me deals by: change one here and the hands follow. (What suits each look is in
 * FAMILIES and RECIPES; the order a hand is dealt in, in dealCover.) Ranges are [from, to].
 */
export const RULES = {
  // a run: how many hands are dealt, how long dealing them may take (ms; `least` are dealt whatever it takes),
  // the least time between two hands shown in its window (ms)
  hands: { count: 6, ms: 1500, least: 2, pace: 90 },
  // how a hand is scored (coverScore): what a red and a yellow issue costs, the rules left out (the words and
  // the sizes, the same whatever the hand); up to 1 more for the room above the contrast line (the worst title
  // measured, from the line to `contrastSpan` above it) and up to 1 for the room above the A1 line (the
  // smallest feed type size, from the line to `typeSpan` times more)
  score: { red: 10, yellow: 3, skip: ["A2", "E1"], contrastSpan: 4, typeSpan: 0.5 },
  // which hand is kept (pickHand): of those whose issues cost the least, the best three within `near` of the
  // best, by `weights`; a hand in the look the cover had scores `sameLook` less
  keep: { near: 2, weights: [3, 2, 1], sameLook: 1 },
  // the look: none of the last `recent` dealt (while others are left); the user's taste makes one from
  // `taste[0]` to `taste[1]` times as likely (tasteWeight)
  look: { recent: 4, taste: [0.25, 3] },
  // its sliders (tuneLook): within `spread` of the range either way of the default, off the very ends by
  // `ends` (unless the default is there); a part off by default comes in by `extra` (or the recipe's chance),
  // `extras` at most, to within `extraRange` of its range; a checkbox on by default stays on by `toggleOn`,
  // one off by default comes on by `toggleOff` (or the recipe's chance)
  sliders: { spread: 0.3, ends: 0.08, extra: 0.35, extras: 2, extraRange: [0.3, 0.75], toggleOn: 0.75, toggleOff: 0.3 },
  // its scene objects: by `chance` off where the layout puts them, by up to `dx` and `dy` of the canvas, in
  // steps of `step`
  scene: { chance: 0.4, dx: 0.06, dy: 0.05, step: 0.005 },
  // what the cover brings (coverContext, recipeOf): a title is long with a line wider than `long` characters
  // or `longLines` lines, short with no line wider than `short` and two lines at most; a long one is bent
  // `longBend` as often, and given a sticker's rim or depth `longRim` as often; a short one is bent
  // `shortBend` as often, `shortBendMost` at most; a channel colour darker than `black` (luminance) makes the
  // dark ground `blackDark` as likely, one brighter than `bright` moves it `brightPull` of the way to
  // certain, `brightMost` at most — neither when the user set the dark ground's chance
  cover: { long: 8, longLines: 3, short: 4, longBend: 0.3, longRim: 0.5, shortBend: 1.5, shortBendMost: 0.5, black: 0.05, blackDark: 0.6, bright: 0.6, brightPull: 0.4, brightMost: 0.95 },
  // the letterings (letterFor): a strength within `fxAmt`, a bend's within `bendAmt` (in 20ths); the
  // subtitle lettered like the title by `subtitleLikeTitle`, else keeping its look's own by `subtitleOwn` at
  // least; a text layer keeps its look's own `textOwn` times as often as the title
  letterings: { fxAmt: [0.6, 1.5], bendAmt: [0.5, 1.1], subtitleLikeTitle: 0.5, subtitleOwn: 0.85, textOwn: 0.85 },
  // each layer's own switches (by type: how likely each is on), outline and shadow (ranges, in 20ths)
  layers: {
    bg: { grid: 0.75 }, brand: { rail: 0.8 }, catname: { plate: 0.75 }, asset: { tint: 0.5 },
    title: { stroke: [0.6, 1.4], shadow: [0.5, 1.5] },
    subtitle: { plate: 0.3, stroke: [0.6, 1.2], shadow: [0.5, 1.2] },
    text: { plate: 0.35, stroke: [0.6, 1.4], shadow: [0.5, 1.5] },
  },
  // look effects on a layer but the title and subtitle (theirs are the user's): by `chance` some, by `two`
  // two of them; each from the look dealt by `ownLook`, else from another look; at `amount` (its parts at
  // `sub`), in steps of `step`
  lookFx: { chance: 0.55, two: 0.4, ownLook: 0.6, amount: [0.35, 0.85], sub: [0.2, 0.8], step: 0.05 },
  // the user's own layers (dealPlaces in app.js): `scale` times their size (within `size`), turned by up to
  // `turn` degrees; `tries` places tried for the one that covers the least of the title and the cut-out
  // subjects; one still covering more than `cover` of them made `shrink` times as large and placed again,
  // `shrinks` times at most; a hair, `margin` of the canvas, kept in from its edges
  places: { scale: [0.8, 1.25], size: [0.05, 2.5], turn: 12, tries: 12, cover: 0.25, shrink: 0.85, shrinks: 4, margin: 0.015 },
};

/**
 * The families of looks, and what goes with each:
 *   dark   the chance of the dark ground (a look on one ground only ignores it)
 *   own    the chance the title keeps the look's own lettering (`auto`)
 *   fx     the other letterings that suit, by weight
 *   bend   the chance the title is bent, and `bends`, the ways that suit, by weight
 */
export const FAMILIES = {
  // cartoon and illustration: bold letters with outlines, depth and a little bounce
  pop: { dark: 0.45, own: 0.6, fx: { sticker: 3, cel: 3, extrude: 2, stripes: 1, rows: 1 }, bend: 0.25, bends: { arc: 3, wave: 2, rise: 2, bulge: 1, flag: 1, arcLow: 1, shell: 1 } },
  // printed matter, posters and film: flat type, the marks of printing, hardly ever bent
  print: { dark: 0.4, own: 0.75, fx: { plain: 2, worn: 3, dots: 2, rows: 1, bluenote: 1, editorial: 1, ransom: 1 }, bend: 0.05, bends: { arc: 1, shell: 1 } },
  // light on the dark: neon, chrome, screens; their own glowing letters nearly always
  light: { dark: 0.85, own: 0.85, fx: { inner: 1, plain: 1 }, bend: 0.1, bends: { arc: 1, wave: 1 } },
};
/**
 * Each look's recipe: its family and what differs from it (`own`, `dark`, `fx`, `bend`, `bends` replace
 * the family's), and `params`: for a slider that is off by default (or a checkbox), the chance it is on;
 * `tune(p, R)` adjusts sliders that go together.
 */
export const RECIPES = {
  cel: { family: "pop", own: 0.4 },   // its own lettering is the house outline and shadow: others are as much its own
  cyber: { family: "light", own: 0.9 },
  riso: { family: "print", own: 0.8, fx: { worn: 2, dots: 2, rows: 1 } },
  anime: { family: "pop", own: 0.75, bends: { arc: 2, wave: 1 }, params: { dusk: 0.3, leak: 0.3 }, tune: (p) => { if (p.dusk > 0) p.rays = Math.max(p.rays, 0.35); } },   // a sunset sends beams through the clouds
  bluenote: { family: "print", own: 0.75, params: { vinyl: 0.5, ring: 0.4 } },
  editorial: { family: "print", own: 0.8, bend: 0 },
  songke: { family: "print", own: 0.95, bend: 0, params: { vertical: 0.7 } },   // its own type, mostly in columns
  vivid: { family: "pop" },
  negative: { family: "print", own: 0.85, bend: 0.03, params: { beam: 0.35, threads: 0.35 } },
  cinema: { family: "print", own: 0.9, bend: 0 },
  cyano: { family: "print", own: 0.8 },
  monofilm: { family: "print", own: 0.85, bend: 0 },
  typo: { family: "print", own: 0.9, bend: 0.1, bends: { rise: 1, shell: 1, flag: 1 } },
  toon: { family: "pop", own: 0.7, params: { giant: 0.3, beam: 0.3, parade: 0.3, road: 0.3, border: 0.4 } },
  avant: { family: "print", own: 0.85, bend: 0.05, params: { mosaic: 0.3 } },
  collage: { family: "print", own: 0.6, fx: { ransom: 4, sticker: 2, worn: 2, rows: 2, dots: 1 }, bend: 0.15, bends: { rise: 1, flag: 1, arc: 1 } },   // its title on scraps of paper: the ransom note most of all
  yellow: { family: "print", own: 0.85, bend: 0, params: { beam: 0.3, stripes: 0.35 } },
  pitch: { family: "pop", own: 0.7, fx: { cel: 2, extrude: 2, stripes: 2, worn: 1 }, params: { net: 0.35, stadium: 0.35, crowd: 0.35 } },
  dots: { family: "light", own: 0.9, params: { smear: 0.3 } },
  neon: { family: "light", own: 0.8, fx: { cel: 1, extrude: 1, stripes: 1 }, bend: 0.15, params: { bars: 0.35, shift: 0.3 } },
  court: { family: "pop", own: 0.75, fx: { extrude: 3, cel: 2, worn: 1, stripes: 1 }, bends: { arc: 3, rise: 1 }, params: { hoop: 0.4, spray: 0.3 } },
  velvet: { family: "pop", own: 0.8, fx: { sticker: 1, extrude: 1, cel: 1 }, bends: { arc: 2, bulge: 2, wave: 1 } },
  rave: { family: "light", own: 0.85, bend: 0.35, bends: { wave: 3, flag: 2, fisheye: 2, bulge: 2, pinch: 1, circle: 1 }, params: { grid: 0.35, arch: 0.35 } },
  chrome: { family: "light", own: 0.9, bend: 0.25, bends: { arc: 2, bulge: 2, wave: 1, fisheye: 1 }, params: { echo: 0.3 } },
  netart: { family: "light", own: 0.85, fx: { rows: 2, plain: 1 }, bends: { flag: 1, wave: 1 }, params: { bars: 0.3 } },
  verse: { family: "pop", own: 0.75, fx: { sticker: 2, cel: 2, extrude: 2, stripes: 1, ransom: 2 }, bend: 0.3, params: { sfx: 0.4 } },
  glass: { family: "print", own: 0.85, dark: 0.6, bend: 0 },
  jelly: { family: "light", own: 0.8, fx: { sticker: 1, extrude: 1 }, bend: 0.2, bends: { bulge: 2, arc: 1, wave: 1 } },
  skies: { family: "pop", own: 0.8, dark: 0.3, fx: { cel: 2, sticker: 1 }, bend: 0.1 },
  spectrum: { family: "print", own: 0.85, bend: 0.05, params: { vortex: 0.3, road: 0.3 } },
  citypop: { family: "light", own: 0.9, bends: { arc: 1 }, params: { figure: 0.35, laser: 0.3 }, tune: (p) => { if (p.dusk > 0.4) p.stars = Math.min(p.stars, 0.2); } },   // few stars yet at dusk
  construct: { family: "print", own: 0.85, bend: 0.05, bends: { rise: 1 }, params: { water: 0.3, chan: 0.3 } },
  deco: { family: "light", own: 0.95, bend: 0, params: { red: 0.2, rain: 0.2, airship: 0.25, sign: 0.3, arch: 0.25, figure: 0.25, gilt: 0.15 }, tune: (p) => { if (p.rain > 0) p.fog = Math.max(p.fog, 0.45); } },   // rain comes with mist
};
/**
 * What a cover brings to a hand: `long` (a line of its title longer than 8 characters' width, or three
 * lines or more), `short` (no line longer than 4, two lines at most), `lum` (its channel colour's relative
 * luminance, 0 to 1). `rgb`: the channel colour [r, g, b].
 */
export function coverContext(title, rgb) {
  const c = RULES.cover, lines = titleLines(title), longest = Math.max(0, ...lines.map(lineUnits));
  return { long: longest > c.long || lines.length >= c.longLines, short: lines.length > 0 && longest <= c.short && lines.length <= 2, lum: rgb ? luminance(rgb[0], rgb[1], rgb[2]) : null };
}
/**
 * A look's recipe as the table has it, its family's choices filled in: { family, dark, own, fx, bend, bends,
 * params, tune }. `mine`: what the user set for it in its place (see the Style tab; any of family, dark, own,
 * bend, fx, bends, params), which wins.
 */
export function baseRecipe(id, mine = null) {
  const r = RECIPES[id] || { family: "pop" }, m = mine || {}, family = FAMILIES[m.family] ? m.family : r.family, f = FAMILIES[family] || FAMILIES.pop;
  const t = family === r.family ? r : {};   // another family than the table's: its choices, not the table's
  return {
    family, dark: m.dark ?? t.dark ?? f.dark, own: m.own ?? t.own ?? f.own, fx: { ...(m.fx || t.fx || f.fx) },
    bend: m.bend ?? t.bend ?? f.bend, bends: { ...(m.bends || t.bends || f.bends) }, params: { ...(r.params || {}), ...(m.params || {}) }, tune: r.tune || null,
  };
}
/**
 * A look's recipe for a hand (see baseRecipe; `ctx.mine`, the user's own for it), turned to the cover (`ctx`,
 * see coverContext): a long title is bent less and less often given a lettering that takes room round the
 * letters (a sticker's rim, depth), so its type stays large; a short one is bent a little more often; a channel
 * colour near black would sink into the dark ground and a very bright one (near white, or a light yellow) into the
 * light one, so the other is likelier — unless the user set the dark ground's chance themselves.
 */
export function recipeOf(id, ctx = {}) {
  const out = baseRecipe(id, ctx.mine), c = RULES.cover;
  if (ctx.long) { out.bend *= c.longBend; for (const k of ["sticker", "extrude"]) if (out.fx[k]) out.fx[k] *= c.longRim; }
  else if (ctx.short) out.bend = Math.min(c.shortBendMost, out.bend * c.shortBend);
  if (ctx.lum == null || (ctx.mine && ctx.mine.dark != null)) return out;
  if (ctx.lum < c.black) out.dark *= c.blackDark;
  else if (ctx.lum > c.bright) out.dark = Math.max(out.dark, Math.min(c.brightMost, out.dark + (1 - out.dark) * c.brightPull));
  return out;
}
/** One key of `weights` ({key: weight}), likelier as its weight is larger; null when none weighs anything. */
export function weighted(weights, R) {
  const list = Object.entries(weights).filter(([, w]) => w > 0), total = list.reduce((s, [, w]) => s + w, 0);
  if (!total) return null;
  let at = R() * total;
  for (const [k, w] of list) { at -= w; if (at < 0) return k; }
  return list[list.length - 1][0];
}
/**
 * How much likelier the user has made a look ({kept, dropped}: how often a hand in it was kept — edited on,
 * exported — or undone at once, or another hand taken over it): (kept + 1) / (dropped + 1), within 0.25 and 3.
 */
export function tasteWeight(t) {
  const kept = (t && t.kept) || 0, dropped = (t && t.dropped) || 0, [lo, hi] = RULES.look.taste;
  return Math.min(hi, Math.max(lo, (kept + 1) / (dropped + 1)));
}
/** The look for a hand: none of the last RULES.look.recent of `recent` (while any other is left), each as likely as the user's `taste` makes it (tasteWeight). */
export function pickLook(ids, R, { recent = [], taste = {} } = {}) {
  const last = recent.slice(-RULES.look.recent), fresh = ids.filter((k) => !last.includes(k)), pool = fresh.length ? fresh : ids;
  return weighted(Object.fromEntries(pool.map((k) => [k, tasteWeight(taste[k])])), R);
}
const snap = (v, d) => { const s = d.step || 0.05; return Math.min(d.max, Math.max(d.min, Math.round(v / s) * s)); };
/** How many of a look's parts that are off by default one hand may bring in (RULES.sliders.extras). */
export const EXTRAS = RULES.sliders.extras;
/**
 * A look's sliders tuned for a hand: each about the value the look was made with (within 0.3 of the range
 * either way, likeliest near it, off the very ends unless that is where its default is); the parts that
 * are off by default come in only now and then (each by the recipe's chance, else 0.35), EXTRAS at most,
 * to between 0.3 and 0.75 of their range; a checkbox is on as likely as the recipe says, else 3 in 4 when
 * it is on by default and 3 in 10 when not. Typed words are left to the caller. Returns { key: value }.
 */
export function tuneLook(id, R, ctx = {}) {
  const L = LOOKS[id], r = recipeOf(id, ctx), out = {}, extras = [], k = RULES.sliders;
  for (const d of L.params) {
    if (d.text) continue;
    const o = r.params[d.key], span = d.max - d.min;
    if (d.toggle) out[d.key] = R() < (typeof o === "number" ? o : d.def > d.min ? k.toggleOn : k.toggleOff) ? d.max : d.min;
    else if (d.def <= d.min) { out[d.key] = d.min; if (R() < (typeof o === "number" ? o : k.extra)) extras.push(d); }
    else out[d.key] = snap(Math.min(Math.max(d.def, d.min + span * (1 - k.ends)), Math.max(Math.min(d.def, d.min + span * k.ends), d.def + span * k.spread * (R() - R()))), d);
  }
  while (extras.length > k.extras) extras.splice(Math.floor(R() * extras.length), 1);
  for (const d of extras) out[d.key] = snap(d.min + (d.max - d.min) * (k.extraRange[0] + (k.extraRange[1] - k.extraRange[0]) * R()), d);
  if (r.tune) r.tune(out, R);
  return out;
}
/**
 * The lettering a layer is dealt under look `id`: { fx, fxAmt, fxSeed, bend, bendAmt }; fx left out for the look's
 * own, bend for none, fxAmt for a lettering without a strength, fxSeed but for the ransom note (its letters as Reshuffle deals them). `role`: "title", "subtitle" (lettered like
 * the title half the time, else mostly the look's own, never bent) or "text" (a little likelier than the
 * title to letter otherwise). A lettering named after the look (cel's outline and shadow, the record
 * sleeve's, the editorial's) is its own already, so not dealt as another.
 * @param {string} id
 * @param {string} role
 * @param {() => number} R
 * @param {(fx: string) => boolean} [can] whether a lettering can be drawn here (outlines need the desktop app)
 * @param {{fx?: string, fxAmt?: number} | null} [title] what the title was dealt, for the subtitle
 * @param {{long?: boolean, short?: boolean, lum?: number | null, mine?: object}} [ctx] what the cover brings (see coverContext), and the user's own recipe for the look
 */
export function letterFor(id, role, R, can = () => true, title = null, ctx = {}) {
  const r = recipeOf(id, ctx), out = {}, fx = Object.fromEntries(Object.entries(r.fx).filter(([k]) => EFFECTS[k] && k !== "auto" && k !== id && can(k))), w = RULES.letterings;
  const within = ([a, b]) => Math.round((a + R() * (b - a)) * 20) / 20;
  const choose = () => { const k = weighted(fx, R); if (k) { out.fx = k; if (EFFECTS[k].kind !== "passes") out.fxAmt = within(w.fxAmt); if (k === "ransom") out.fxSeed = 1 + Math.floor(R() * 999998); } };
  if (role === "subtitle") {
    if (title && title.fx && R() < w.subtitleLikeTitle) { out.fx = title.fx; if (title.fxAmt != null) out.fxAmt = title.fxAmt; }
    else if (R() >= Math.max(r.own, w.subtitleOwn)) choose();
    return out;
  }
  if (R() >= (role === "text" ? r.own * w.textOwn : r.own)) choose();
  if (R() < r.bend) { const b = weighted(Object.fromEntries(Object.entries(r.bends).filter(([k]) => BENDS[k] && k !== "taper")), R); if (b) { out.bend = b; out.bendAmt = within(w.bendAmt); } }
  return out;
}

const copyOf = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/**
 * One hand, dealt onto the profile's `style` and the `cover` as they are, in the order below — what is set
 * and how likely is in RULES, FAMILIES and RECIPES. What the cover says is left alone (the title and tag,
 * the channel and its colour, the photos, which layers exist), and so is the layout; the user's own layers
 * are placed afterwards (dealPlaces in app.js, which needs the cover drawn). env: { R, locks (the parts to
 * leave alone: look, theme, lettering, places), surprise ({recent, taste}: the looks dealt lately, the
 * user's taste), recipes (the user's own, by look), rgb (the channel colour), design (the layers of the
 * profile's design, by id, where moved words go back to), sizeKey (the size shown), can(fx) (a lettering
 * can be drawn here), canTint(ref) (an asset can be tinted) }. Returns what the cover brings (coverContext).
 */
export function dealCover(st, cover, env) {
  const { R, locks = {} } = env, pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + R() * (b - a), chance = (p) => R() < p;
  const round = (v, step) => Math.round(v / step) * step, within = ([a, b], step = 0.05) => round(between(a, b), step);
  // 1. the look — none of the last few dealt, those the user keeps likelier — and a new seed for its random placement
  if (!locks.look) { st.look = pickLook(LOOK_IDS, R, env.surprise || {}); st.lookSeed = Math.floor(R() * 1000000); }
  // the title's length, the channel colour and the user's own recipe for the look turn its recipe (see recipeOf)
  const ctx = { ...coverContext(cover.title, env.rgb), mine: (env.recipes || {})[st.look] };
  if (!locks.look) {
    // 2. its sliders about the values it was made with, its optional parts now and then (typed words are kept)
    const tuned = tuneLook(st.look, R, ctx);
    for (const d of LOOKS[st.look].params) if (d.text) tuned[d.key] = (st.lookParams[st.look] || {})[d.key] ?? d.def;
    if (Object.keys(tuned).length) st.lookParams[st.look] = tuned;
    // 3. its scene objects: where the layout puts them, or now and then a little off it
    const sc = RULES.scene;
    if (cover.scene) delete cover.scene[st.look];
    if (chance(sc.chance)) for (const key of Object.keys(LOOKS[st.look].scene || {})) moveScene(cover, st.look, key, "all", env.sizeKey, round(between(-sc.dx, sc.dx), sc.step), round(between(-sc.dy, sc.dy), sc.step));
  }
  // 4. the ground, dark or light, as the look's recipe has it
  if (!locks.theme) st.theme = chance(recipeOf(st.look, ctx).dark) ? "dark" : "light";
  // 5. words the user moved or resized go back where the rules put them (unless where things stand is to stay):
  // the layout's — title, subtitle, tag, channel name, brand row — to where the profile's design has them, the
  // user's own text layers to a new one's size, at no size of their own, to be placed afresh (dealPlaces)
  if (!locks.places) {
    const fresh = newLayer("text").t.all;
    for (const L of cover.layers) {
      if (L.locked || !L.visible || !LETTERED.includes(L.type)) continue;
      if (L.type === "text") L.t = { all: { ...L.t.all, s: fresh.s, kx: fresh.kx, ky: fresh.ky }, by: {} };
      else if (env.design && env.design.has(L.id)) L.t = copyOf(env.design.get(L.id).t);
    }
  }
  // 6. the title over everything else, with what is clipped into it, so nothing dealt lies over it (one clipped
  // onto another layer stays) — but for the subjects cut out of photos that stood over it, which still do
  const list = cover.layers, ti = list.findIndex((l) => l.id === "title");
  if (ti >= 0 && !list[ti].clip) {
    const title = list.splice(ti, clipEnd(list, ti) - ti + 1), over = [];
    for (let i = ti; i < list.length; ) if (list[i].type === "photo" && list[i].cut && !list[i].clip) over.push(...list.splice(i, clipEnd(list, i) - i + 1)); else i++;
    list.push(...title, ...over);
  }
  // 7. every layer's own choices: switches, outline and shadow, the letterings and bends as the look's recipe
  // has them (the subtitle after the title, lettered like it now and then), unless the letterings are to stay
  const can = env.can || (() => true), canTint = env.canTint || (() => false), Y = RULES.layers;
  const dealFx = (L, got) => { delete L.fx; delete L.fxAmt; delete L.bend; delete L.bendAmt; delete L.warp; delete L.reshape; Object.assign(L, got); };
  const lines = (L, k) => { L.stroke = within(k.stroke); L.shadow = within(k.shadow); };
  const titled = letterFor(st.look, "title", R, can, null, ctx);
  for (const L of cover.layers) {
    switch (L.type) {
      case "bg": L.grid = chance(Y.bg.grid); break;
      case "accent": L.shape = pick(ACCENT_SHAPES); break;
      case "brand": L.rail = chance(Y.brand.rail); break;
      case "catname": L.plate = chance(Y.catname.plate); break;
      case "title": if (!locks.lettering) { lines(L, Y.title); dealFx(L, titled); } break;
      case "subtitle": if (!locks.lettering) { L.plate = chance(Y.subtitle.plate); lines(L, Y.subtitle); dealFx(L, letterFor(st.look, "subtitle", R, can, titled, ctx)); } break;
      case "text": if (!locks.lettering) { L.plate = chance(Y.text.plate); lines(L, Y.text); dealFx(L, letterFor(st.look, "text", R, can, null, ctx)); } break;
      case "asset": if (canTint(L.ref) && L.ref.kind !== "graphic") L.tint = chance(Y.asset.tint); break;
    }
    // 8. look effects on the rest: one or two, mostly the look just dealt's, now and then another look's
    if (FX_TYPES.includes(L.type) && L.type !== "title" && L.type !== "subtitle") {
      const F = RULES.lookFx;
      delete L.lookFx;
      if (chance(F.chance)) {
        const fx = {}, others = LOOK_IDS.filter((k) => k !== st.look && effectsFor(k, L.type).length);
        for (let n = chance(F.two) ? 2 : 1; n > 0; n--) {
          const from = effectsFor(st.look, L.type).length && chance(F.ownLook) ? st.look : others.length ? pick(others) : null, list = from ? effectsFor(from, L.type).filter((e) => !(`${from}.${e.key}` in fx)) : [];
          if (!list.length) continue;
          const e = pick(list);
          fx[`${from}.${e.key}`] = within(F.amount, F.step);
          for (const s of e.sub || []) fx[`${from}.${e.key}:${s.key}`] = within(F.sub, F.step);
        }
        if (Object.keys(fx).length) L.lookFx = fx;
      }
    }
  }
  return ctx;
}

/**
 * How well a cover meets the standards (check.js), to choose between the hands. o: { title, sizes, seen } as
 * for checkCover; each size is held to every platform that uses its ratio, for landscape and portrait videos
 * alike. `cost`: RULES.score.red for each red issue, `yellow` for each yellow one (not those of `skip`);
 * `score`, higher is better: less the cost, up to 1 more for the room above the contrast line (the worst
 * title measured) and up to 1 for the room above the A1 line (the smallest feed type size). Returns
 * { score, cost, issues }.
 */
export function coverScore(o) {
  const all = { ...o, platforms: PLATFORM_IDS, red: "3:4" }, found = new Map(), contrasts = [], feeds = [], n = titleLines(o.title).length, k = RULES.score;
  for (const orient of ["h", "v"]) {
    for (const i of checkCover({ ...all, orient })) {   // once a rule, size and layer (and badge), at its worst: A1 comes once from each orientation's feeds
      const key = [i.rule, i.size, i.layer, i.rule === "D1" ? i.what : ""].join("|");
      if (!k.skip.includes(i.rule) && (!found.has(key) || (i.level === "red" && found.get(key).level !== "red"))) found.set(key, i);
    }
    for (const { ratio, uses } of wanted({ ...all, orient })) {
      const size = o.sizes.find((s) => s.on !== false && isRatio(s.w, s.h, ratio)), seen = size && o.seen[size.key];
      if (!seen) continue;
      const feed = Math.min(...uses.map((u) => u.feed || Infinity));
      if (seen.title && n && feed < Infinity) feeds.push((typeSize(seen.title.hit, n) * feed) / size.vw);
    }
  }
  for (const seen of Object.values(o.seen)) if (Number.isFinite(seen.contrast)) contrasts.push(seen.contrast);   // wherever it was measured
  const issues = [...found.values()], room = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0), cost = issues.reduce((sum, i) => sum + (i.level === "red" ? k.red : k.yellow), 0);
  let score = -cost;
  if (contrasts.length) score += room((Math.min(...contrasts) - LIMITS.contrast.ok) / k.contrastSpan);
  if (feeds.length) score += room((Math.min(...feeds) / LIMITS.font.ok - 1) / k.typeSpan);
  return { score, cost, issues };
}
/**
 * Which of several hands to keep: `hands` [{ score, cost }] (see coverScore). Only those whose issues cost
 * the least are in the running, so one with a problem is never kept while one without is there; of those,
 * one of the best that score within `near` of the best, the better likelier (RULES.keep.weights), so the best
 * is not always the one. `r` is a random number in [0, 1). Returns an index, or -1 with no hands.
 */
export function pickHand(hands, r, near = RULES.keep.near) {
  const ok = hands.map((h, i) => [Number.isFinite(h.score) ? h.score : -Infinity, i, Number.isFinite(h.cost) ? h.cost : Infinity]);
  if (!ok.length) return -1;
  const least = Math.min(...ok.map((h) => h[2])), fair = ok.filter((h) => h[2] === least), best = Math.max(...fair.map((h) => h[0]));
  const pool = fair.filter(([s]) => s >= best - near || s === best).sort((a, b) => b[0] - a[0]).slice(0, RULES.keep.weights.length);
  const weights = RULES.keep.weights.slice(0, pool.length), total = weights.reduce((a, b) => a + b, 0);
  let at = r * total;
  for (let k = 0; k < pool.length; k++) { at -= weights[k]; if (at < 0) return pool[k][1]; }
  return pool[pool.length - 1][1];
}
