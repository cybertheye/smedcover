// Surprise me's rules, all of them, in one place: how a hand is dealt.
//   RULES       every number it deals by — how many hands, the chances the user may set (`odds`, see oddsOf),
//               the ranges of the sliders, outlines and shadows, how the user's layers are placed
//   FAMILIES    what suits each family of looks (the dark ground, letterings, bends)
//   RECIPES     what suits each look: its family, what differs, its optional parts
//   dealCover   a hand, in the order it is dealt: the layout (the canvas's, or a layout preset of the user's), the
//               look and its sliders, its scene, the ground, the words put back, the title on top, each layer's own
//               choices and look effects
//   rebalance   a group's chances with one of them set, the others moved alike; moveShare, two neighbours on a
//               group's bar sharing what they have anew (the chances window); dropOption, one of them taken away (a
//               layout preset deleted); DOTS, dotsOf, withDots: the looks' chances as the window's dots
// What needs the cover drawn stays in app.js: surprise() deals the hands (dealHand: dealCover, then the
// user's layers placed by dealPlaces, which reads RULES.places) and shows each. The user's own chances
// (Surprise me's chances window) lie over RULES.odds, their recipes (the same panel, and the Style tab) over RECIPES;
// both, what they lock and the looks already dealt in the run come in through `env`. Pure: `R` is the random
// source, a function returning numbers in [0, 1).
import { LOOKS, LOOK_IDS, effectsFor, FX_TYPES, lookParams } from "./style.js";
import { EFFECTS, BENDS, NO_COLUMNS } from "./textfx.js";
import { titleLines, lineUnits, luminance } from "./check.js";
import { ACCENT_SHAPES, LETTERED, newLayer, clipEnd, moveScene, putLayout, canWeave, wovenIds } from "./layers.js";
import { DEFAULTS } from "./defaults.js";

/**
 * Every number Surprise me deals by: change one here and the hands follow. (What suits each look is in
 * FAMILIES and RECIPES; the order a hand is dealt in, in dealCover.) Ranges are [from, to].
 */
export const RULES = {
  // a run: how many hands are dealt (all of them, each in a look of its own while there are looks left), the
  // least time between two shown in its window (ms)
  hands: { count: 6, pace: 90 },
  // the chances Surprise me's chances window shows, which the user may set (theirs lie over these, see oddsOf).
  // `groups`: of each, one option is dealt, their chances adding up to 1 — the look and the colour block's shape
  // (left empty: every one alike), how many look effects a layer but the title and subtitle is given, and
  // whether each is the look dealt's or another look's; for every look alike, the title's lettering (its own, or
  // another), its bend (none, or one) and the ground (dark or light) — left empty: what the looks' recipes give
  // on average (builtInGroup); the layout: the canvas's own (`keep`, certain until the user sets the group) or one
  // of the user's layout presets, by its id (the options come and go with them). `chances`: switches, each on by a chance of its own —
  // the brand row's rail; the plate under the channel name, the subtitle, a text layer; an asset tinted the
  // channel colour; the look's scene objects moved a little off their places; the subtitle lettered like the
  // title; a look's part that is off by default coming in, a checkbox on by default staying on, one off by
  // default coming on (each unless the look's recipe has a chance of its own for it). They are kept in defaults.json
  // (surprise.odds, see defaults.js), where the user's custom.json may change them; read from there each time
  get odds() { return DEFAULTS.surprise.odds; },
  // its sliders (tuneLook): within `spread` of the range either way of the default, off the very ends by
  // `ends` (unless the default is there); the parts off by default that come in (odds: `extra`), `extras` at
  // most, to within `extraRange` of their range
  sliders: { spread: 0.3, ends: 0.08, extras: 2, extraRange: [0.3, 0.75] },
  // its scene objects, when moved (odds: `sceneMoved`): by up to `dx` and `dy` of the canvas, in steps of `step`
  scene: { dx: 0.06, dy: 0.05, step: 0.005 },
  // what the cover brings (coverContext, recipeOf): a title is long with a line wider than `long` characters
  // or `longLines` lines, short with no line wider than `short` and two lines at most; a long one is bent
  // `longBend` as often, and given a sticker's rim or depth `longRim` as often; a short one is bent
  // `shortBend` as often, `shortBendMost` at most (never less often than the look's own); a channel colour darker than `black` (luminance) makes the
  // dark ground `blackDark` as likely, one brighter than `bright` moves it `brightPull` of the way to
  // certain, `brightMost` at most — neither when the user set the dark ground's chance
  cover: { long: 8, longLines: 3, short: 4, longBend: 0.3, longRim: 0.5, shortBend: 1.5, shortBendMost: 0.5, black: 0.05, blackDark: 0.6, bright: 0.6, brightPull: 0.4, brightMost: 0.95 },
  // the letterings (letterFor): a strength within `fxAmt`, a bend's within `bendAmt` (in 20ths); the
  // subtitle not lettered like the title (odds: `subtitleLikeTitle`) keeps its look's own by `subtitleOwn` at
  // least; a text layer keeps its look's own `textOwn` times as often as the title
  letterings: { fxAmt: [0.6, 1.5], bendAmt: [0.5, 1.1], subtitleOwn: 0.85, textOwn: 0.85 },
  // the lettered layers' outline and shadow (ranges, in 20ths)
  layers: {
    title: { stroke: [0.6, 1.4], shadow: [0.5, 1.5] },
    subtitle: { stroke: [0.6, 1.2], shadow: [0.5, 1.2] },
    text: { stroke: [0.6, 1.4], shadow: [0.5, 1.5] },
  },
  // look effects on a layer but the title and subtitle (theirs are the user's; how many, and from which look:
  // odds `lookFx`, `lookFxFrom`): at `amount` (its parts at `sub`), in steps of `step`
  lookFx: { amount: [0.35, 0.85], sub: [0.2, 0.8], step: 0.05 },
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
  pop: { dark: 0.45, own: 0.6, fx: { sticker: 3, cel: 3, extrude: 2, stripes: 1, rows: 1, puffy: 2, spiky: 1, melt: 1 }, bend: 0.25, bends: { arc: 3, wave: 2, rise: 2, bulge: 1, flag: 1, arcLow: 1, shell: 1 } },
  // printed matter, posters and film: flat type, the marks of printing, hardly ever bent
  print: { dark: 0.4, own: 0.75, fx: { plain: 2, worn: 3, dots: 2, rows: 1, bluenote: 1, editorial: 1, ransom: 1, torn: 1, cut: 1, eroded: 1 }, bend: 0.05, bends: { arc: 1, shell: 1 } },
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
  collage: { family: "print", own: 0.6, fx: { ransom: 4, sticker: 2, worn: 2, rows: 2, dots: 1, cut: 2, torn: 2 }, bend: 0.15, bends: { rise: 1, flag: 1, arc: 1 } },   // its title on scraps of paper: the ransom note most of all
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
  wasteland: { family: "print", own: 0.9, dark: 0.65, fx: { worn: 3, plain: 2, torn: 1, eroded: 1 }, bend: 0.03, bends: { arc: 1 }, params: { chan: 0.25 }, tune: (p) => { if (p.smoke > 0.6) p.haze = Math.max(p.haze, 0.45); } },   // a heavy plume hangs in a haze
  facet: { family: "light", own: 0.9, bend: 0.05, bends: { arc: 1 }, params: { blinds: 0.25, figure: 0.25, bars: 0.3 }, tune: (p) => { if (p.rain > 0.5) p.wet = Math.max(p.wet, 0.35); } },   // heavy rain leaves the street wet
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
 * params, tune }. `mine`: what the user set for its optional parts (`params`: each part's chance), which wins.
 * The dark ground, the lettering and the bend are dealt for every look alike (RULES.odds, see recipeOf); the
 * table's are what those are, on average over the looks, until the user sets them (see builtInGroup).
 */
export function baseRecipe(id, mine = null) {
  const r = RECIPES[id] || { family: "pop" }, f = FAMILIES[r.family] || FAMILIES.pop;
  return {
    family: r.family, dark: r.dark ?? f.dark, own: r.own ?? f.own, fx: { ...(r.fx || f.fx) },
    bend: r.bend ?? f.bend, bends: { ...(r.bends || f.bends) }, params: { ...(r.params || {}), ...((mine && mine.params) || {}) }, tune: r.tune || null,
  };
}
/**
 * A look's recipe for a hand: its optional parts and `tune` its own (baseRecipe; `ctx.mine`, the user's for
 * them), the dark ground, the title's lettering and its bend as the chances say for every look (`ctx.odds`, see
 * oddsOf: `own`, the look's own lettering, and `fx` the others' weights; `bend`, any, and `bends` theirs; `dark`).
 * While the user has not set them, the cover turns them (`ctx`, see coverContext): a long title is bent less and
 * less often given a lettering that takes room round the letters (a sticker's rim, depth), so its type stays
 * large; a short one is bent a little more often; a channel colour near black would sink into the dark ground
 * and a very bright one (near white, or a light yellow) into the light one, so the other is likelier. Set, they
 * are dealt as set.
 */
export function recipeOf(id, ctx = {}) {
  const r = baseRecipe(id, ctx.mine), O = ctx.odds || oddsOf(), c = RULES.cover, L = O.groups.letters, B = O.groups.bend;
  const out = { ...r, own: L.own, fx: Object.fromEntries(Object.entries(L).filter(([k, v]) => k !== "own" && v > 0)),
    bend: 1 - B.none, bends: Object.fromEntries(Object.entries(B).filter(([k, v]) => k !== "none" && v > 0)), dark: O.groups.ground.dark };
  if (ctx.long) {
    if (!O.set.bend) out.bend *= c.longBend;
    if (!O.set.letters) for (const k of ["sticker", "extrude"]) if (out.fx[k]) out.fx[k] *= c.longRim;
  } else if (ctx.short && !O.set.bend) out.bend = Math.max(out.bend, Math.min(c.shortBendMost, out.bend * c.shortBend));
  if (ctx.lum == null || O.set.ground) return out;
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
/** The options of each of RULES.odds' groups; the layout's are "keep" and the ids of `layouts`, the user's layout presets ([{id}]). */
export const ODD_OPTIONS = {
  look: () => LOOK_IDS, accent: () => ACCENT_SHAPES, lookFx: () => ["none", "one", "two"], lookFxFrom: () => ["own", "other"],
  letters: () => ["own", ...Object.keys(EFFECTS).filter((k) => k !== "auto")], bend: () => ["none", ...Object.keys(BENDS).filter((k) => k !== "taper")], ground: () => ["dark", "light"],
  layout: (layouts = []) => ["keep", ...layouts.map((l) => l.id)],
};
const unit = (v) => Math.min(1, Math.max(0, v));
/** Below this a chance is none: what sums of fractions leave over (1e-17) must not deal a look set to 0. */
const NONE = 1e-9;
/** `group`'s chances for `ids`, made to add up to 1 (a crumb below NONE is 0); null when they add up to nothing. */
function asGroup(group, ids) {
  const o = Object.fromEntries(ids.map((k) => { const v = Number(group && group[k]) || 0; return [k, v > NONE ? v : 0]; })), sum = ids.reduce((s, k) => s + o[k], 0);
  if (!(sum > 0)) return null;
  for (const k of ids) o[k] /= sum;
  return o;
}
const BUILT = {};
/**
 * What the looks' recipes (FAMILIES, RECIPES) give, on average over the looks, for a group of RULES.odds left
 * empty there: the title's lettering (`own`, the look's own, and each other one), its bend (`none`, and each),
 * the ground (over the looks that have both). Null for a group they say nothing of (every option alike).
 */
function builtInGroup(g) {
  if (!["letters", "bend", "ground"].includes(g)) return null;
  if (BUILT[g]) return BUILT[g];
  const out = {}, add = (k, v) => (out[k] = (out[k] || 0) + v);
  for (const id of LOOK_IDS) {
    const r = baseRecipe(id);
    if (g === "ground") { if (!LOOKS[id].oneTheme) { add("dark", r.dark); add("light", 1 - r.dark); } continue; }
    const [none, chance, table, ok] = g === "letters" ? ["own", 1 - r.own, r.fx, (k) => EFFECTS[k] && k !== "auto" && k !== id] : ["none", r.bend, r.bends, (k) => BENDS[k] && k !== "taper"];
    const list = Object.entries(table).filter(([k, w]) => ok(k) && w > 0), sum = list.reduce((s, [, w]) => s + w, 0);
    if (!sum) { add(none, 1); continue; }
    add(none, 1 - chance);
    for (const [k, w] of list) add(k, (chance * w) / sum);
  }
  return (BUILT[g] = out);
}
/**
 * The chances a hand is dealt by: RULES.odds with the user's over them (`mine`, as Surprise me's chances panel
 * keeps them: { groups, chances }, any part left out). Every group has each of its options (ODD_OPTIONS), their
 * chances adding up to 1: the user's when they add up to anything (an option of theirs left out, a look added
 * since, is at 0), else the rule's, else what the looks' recipes give (builtInGroup), else each alike; every
 * chance is within 0 and 1. `set`: the groups the user set ({group: true}). `layouts`: the user's layout presets
 * ([{id}]), the layout's options beside "keep" (one made since at 0, one deleted gone with its chance).
 */
export function oddsOf(mine = null, layouts = []) {
  const m = mine && typeof mine === "object" ? mine : {}, groups = {}, chances = {}, set = {};
  for (const [g, list] of Object.entries(ODD_OPTIONS)) {
    const ids = list(layouts || []), own = asGroup(m.groups && m.groups[g], ids);
    set[g] = !!own;
    groups[g] = own || asGroup(RULES.odds.groups[g], ids) || asGroup(builtInGroup(g), ids) || asGroup(Object.fromEntries(ids.map((k) => [k, 1])), ids);
  }
  for (const [k, v] of Object.entries(RULES.odds.chances)) { const u = m.chances && m.chances[k]; chances[k] = unit(Number.isFinite(u) ? u : v); }
  return { groups, chances, set };
}
/**
 * A group's chances (adding up to 1) with option `key` set to `v`: what it gained is taken from the others
 * alike, what it gave up shared alike among those of them that have a chance (all of them when none has) —
 * none going below 0 (what one has not got to give, the rest give), one at 0 left at 0. Returns a new group,
 * adding up to 1.
 */
export function rebalance(group, key, v) {
  const ids = Object.keys(group), out = asGroup(group, ids) || Object.fromEntries(ids.map((k) => [k, 1 / ids.length])), others = ids.filter((k) => k !== key);
  if (!(key in out)) return out;
  if (!others.length) return { [key]: 1 };
  out[key] = unit(v);
  const need = () => 1 - out[key] - others.reduce((s, k) => s + out[k], 0);   // what the others are to move by, together
  for (let n = 0, left = need(); Math.abs(left) > 1e-12 && n <= others.length; n++, left = need()) {
    const some = others.filter((k) => out[k] > NONE), can = left < 0 || some.length ? some : others;
    if (!can.length) break;
    const each = left / can.length;
    for (const k of can) out[k] = Math.max(0, out[k] + each);
  }
  for (const k of others) if (out[k] <= NONE) out[k] = 0;   // no crumbs: what is set to nothing deals nothing
  return out;
}
/**
 * A group's chances without option `key` (a layout preset deleted): what it had goes to the others as when its
 * slider is set to 0 (rebalance), alike to those that have a chance. Null when none of them has one: the group is
 * then to go back to the rule's (for the layout, the canvas's own, certain).
 */
export function dropOption(group, key) {
  const others = Object.keys(group || {}).filter((k) => k !== key);
  if (!others.some((k) => group[k] > NONE)) return null;
  const out = rebalance(group, key, 0);
  delete out[key];
  return out;
}
/**
 * A group's chances with what options `left` and `right` have between them shared anew: `left` given `v` of it
 * (within 0 and all of it), `right` the rest — the white divider between two neighbours on a group's bar in the chances
 * window dragged, where one of them may stand for several options (the rest of a long group, folded). The options of a
 * side keep their shares of it (alike when it had nothing); the others are left as they are. Returns a new group.
 */
export function moveShare(group, left, right, v) {
  const out = { ...group }, sum = (ks) => ks.reduce((s, k) => s + (out[k] || 0), 0), all = sum(left) + sum(right), a = Math.min(all, Math.max(0, v));
  const share = (ks, to) => { const had = sum(ks); for (const k of ks) out[k] = had > 0 ? ((out[k] || 0) * to) / had : to / ks.length; };
  share(left, a); share(right, all - a);
  for (const k of [...left, ...right]) if (out[k] <= NONE) out[k] = 0;   // no crumbs
  return out;
}
/**
 * The looks' chances as the chances window shows and sets them: a row of dots, n of them lit standing for DOTS[n]
 * times an even share (one over the number of looks) — 0, the leftmost, is off; EVEN_DOTS is each look's while the
 * user has set none. Kept as ever, a chance by look (oddsOf makes them add up to 1), so the hands are dealt as they
 * were until a dot is clicked.
 */
export const DOTS = [0, 0.25, 0.5, 1, 2, 4];
export const EVEN_DOTS = 3;
/**
 * The dots look chance `v` (as the user keeps it) shows, of `n` looks: the nearest of DOTS by ratio to v over the
 * even share — one at least for any chance (a chance between two dots on the nearer one, left as it is), none only
 * for none.
 */
export function dotsOf(v, n = LOOK_IDS.length) {
  if (!(v > NONE)) return 0;
  const at = Math.log2(v * n);
  let best = 1;
  for (let d = 2; d < DOTS.length; d++) if (Math.abs(Math.log2(DOTS[d]) - at) < Math.abs(Math.log2(DOTS[best]) - at)) best = d;
  return best;
}
/**
 * The looks' group as the user keeps it (`mine`: {look: chance}; null or adding up to nothing while they have set
 * none) with look `id` given `d` dots: DOTS[d] over the number of looks (`ids`), every other look's chance left as it
 * is — each an even share while none was set.
 */
export function withDots(mine, id, d, ids = LOOK_IDS) {
  const n = ids.length, out = asGroup(mine, ids) ? { ...mine } : Object.fromEntries(ids.map((k) => [k, 1 / n]));
  out[id] = DOTS[Math.min(DOTS.length - 1, Math.max(0, d))] / n;
  return out;
}
/**
 * The layout preset a hand is dealt in, by `group`'s chances ({keep, id: chance}: see oddsOf), of `layouts` (the
 * user's): null for the canvas's own ("keep"). While none of the presets has a chance nothing is drawn, so a hand
 * is dealt from the same random numbers as before there were any.
 */
export function pickLayout(group, layouts, R) {
  const some = (layouts || []).filter((l) => group && group[l.id] > NONE);
  if (!some.length) return null;
  const k = weighted(Object.fromEntries(Object.entries(group).filter(([, v]) => v > NONE)), R);
  return some.find((l) => l.id === k) || null;
}
/**
 * The look for a hand, by the chances of `odds` ({look: chance}): none of those in `not` (the looks dealt already
 * in this run) while one with a chance is left, and none at 0.
 */
export function pickLook(ids, R, odds = oddsOf().groups.look, not = []) {
  const w = (k) => (odds[k] > NONE ? odds[k] : 0), some = ids.filter((k) => w(k) > 0), fresh = some.filter((k) => !not.includes(k));
  return weighted(Object.fromEntries((fresh.length ? fresh : some).map((k) => [k, w(k)])), R) || ids[0];
}
const snap = (v, d) => { const s = d.step || 0.05; return Math.min(d.max, Math.max(d.min, Math.round(v / s) * s)); };
/** How likely a look's optional part `d` (a checkbox, a slider off by default) is on in a hand: by the recipe `r`, else by `odds` (see oddsOf). */
export function partChance(d, r, odds = null) {
  const o = r.params[d.key], c = (odds || oddsOf()).chances;
  return typeof o === "number" ? o : d.toggle ? (d.def > d.min ? c.toggleOn : c.toggleOff) : c.extra;
}
/** How many of a look's parts that are off by default one hand may bring in (RULES.sliders.extras). */
export const EXTRAS = RULES.sliders.extras;
/**
 * A look's sliders tuned for a hand: each about the value the look was made with (within 0.3 of the range
 * either way, likeliest near it, off the very ends unless that is where its default is); the parts that
 * are off by default come in only now and then (each by the recipe's chance, else the odds' `extra`), EXTRAS
 * at most, to between 0.3 and 0.75 of their range; a checkbox is on as likely as the recipe says, else by the
 * odds' `toggleOn` when it is on by default and `toggleOff` when not (ctx.odds: see oddsOf). Typed words are
 * left to the caller. Returns { key: value }.
 */
export function tuneLook(id, R, ctx = {}) {
  const L = LOOKS[id], r = recipeOf(id, ctx), out = {}, extras = [], k = RULES.sliders;
  for (const d of L.params) {
    if (d.text) continue;
    const span = d.max - d.min;
    if (d.toggle) out[d.key] = R() < partChance(d, r, ctx.odds) ? d.max : d.min;
    else if (d.def <= d.min) { out[d.key] = d.min; if (R() < partChance(d, r, ctx.odds)) extras.push(d); }
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
 * the title by the odds' `subtitleLikeTitle`, else mostly the look's own, never bent) or "text" (a little likelier than the
 * title to letter otherwise). A lettering named after the look (cel's outline and shadow, the record
 * sleeve's, the editorial's) is its own already, so not dealt as another.
 * @param {string} id
 * @param {string} role
 * @param {() => number} R
 * @param {(fx: string) => boolean} [can] whether a lettering can be drawn here (outlines need the desktop app)
 * @param {{fx?: string, fxAmt?: number} | null} [title] what the title was dealt, for the subtitle
 * @param {{long?: boolean, short?: boolean, lum?: number | null, mine?: object, odds?: object}} [ctx] what the cover brings (see coverContext), the user's own recipe for the look, the chances (oddsOf)
 */
export function letterFor(id, role, R, can = () => true, title = null, ctx = {}) {
  const r = recipeOf(id, ctx), out = {}, fx = Object.fromEntries(Object.entries(r.fx).filter(([k]) => EFFECTS[k] && k !== "auto" && k !== id && can(k))), w = RULES.letterings;
  const within = ([a, b]) => Math.round((a + R() * (b - a)) * 20) / 20;
  const choose = () => { const k = weighted(fx, R); if (k) { out.fx = k; if (EFFECTS[k].kind !== "passes") out.fxAmt = within(w.fxAmt); if (EFFECTS[k].seeded) out.fxSeed = 1 + Math.floor(R() * 999998); } };
  if (role === "subtitle") {
    if (title && title.fx && R() < (ctx.odds || oddsOf()).chances.subtitleLikeTitle) { out.fx = title.fx; if (title.fxAmt != null) out.fxAmt = title.fxAmt; }
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
 * the channel and its colour, the photos, which layers exist), and so is the layout — unless the odds deal one
 * of the user's layout presets, whose structure the hand then has, exactly, at each of the profile's sizes (those of
 * its own the profile has not pass by), but for a part locked, which stays as it is (the colour block locked, its layout too: see
 * putLayout in layers.js); the user's own layers
 * are placed afterwards (dealPlaces in app.js, which needs the cover drawn). env: { R, locks (the parts to
 * leave alone: look, theme, lettering, places, layout — the layout with the places too), odds (the chances, see oddsOf), not (the looks dealt already in
 * this run, which the look dealt is none of while it can be), recipes (the user's own, by look), rgb (the channel colour), design (the layers of the
 * profile's design, by id, where moved words go back to), layouts (the user's layout presets, as normalizeLayouts
 * keeps them), sizeKey (the size shown), sizes (the profile's size keys, those a preset is put on at), put (what a
 * preset's elements of the user's own are put with: see putLayout), can(fx) (a lettering can be drawn here), canTint(ref) (an asset can be
 * tinted) }. Returns what the cover brings (coverContext), `layout`: the layout dealt ("keep", or a preset's id), and
 * `placed`: the ids of the layers its elements of the user's own place (added or not), which stay where it puts them.
 */
export function dealCover(st, cover, env) {
  const { R, locks = {} } = env, O = env.odds || oddsOf(null, env.layouts), pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + R() * (b - a), chance = (p) => R() < p;
  const round = (v, step) => Math.round(v / step) * step, within = ([a, b], step = 0.05) => round(between(a, b), step);
  // 0. the layout: the canvas's as it is, or a layout preset of the user's by its chance (none while the layout, or
  // where things stand, is to stay: as when the canvas's own is certain) — its colour block at each of the profile's
  // sizes, and its parts where it has them there, on the cover or left out, but for a part locked (the block locked,
  // the block as it was); the rest of the hand is dealt on it as on any other
  const preset = locks.places || locks.layout ? null : pickLayout(O.groups.layout, env.layouts, R);
  const placed = preset ? putLayout(st, cover.layers, preset, env.sizes, env.put) : [];
  // 1. the look, by its chance — none dealt already in this run while others are left — and a new seed for its random placement
  if (!locks.look) { st.look = pickLook(LOOK_IDS, R, O.groups.look, env.not || []); st.lookSeed = Math.floor(R() * 1000000); }
  // the title's length, the channel colour and the user's own recipe for the look turn its recipe (see recipeOf)
  const ctx = { ...coverContext(cover.title, env.rgb), mine: (env.recipes || {})[st.look], odds: O };
  if (!locks.look) {
    // 2. its sliders about the values it was made with, its optional parts now and then (typed words are kept)
    const tuned = tuneLook(st.look, R, ctx);
    for (const d of LOOKS[st.look].params) if (d.text) tuned[d.key] = (st.lookParams[st.look] || {})[d.key] ?? d.def;
    if (Object.keys(tuned).length) st.lookParams[st.look] = tuned;
    // 3. its scene objects: where the layout puts them, or now and then a little off it
    const sc = RULES.scene;
    if (cover.scene) delete cover.scene[st.look];
    if (chance(O.chances.sceneMoved)) for (const key of Object.keys(LOOKS[st.look].scene || {})) moveScene(cover, st.look, key, "all", env.sizeKey, round(between(-sc.dx, sc.dx), sc.step), round(between(-sc.dy, sc.dy), sc.step));
  }
  // 4. the ground, dark or light, as the look's recipe has it
  if (!locks.theme) st.theme = chance(recipeOf(st.look, ctx).dark) ? "dark" : "light";
  // 5. words the user moved or resized go back where the rules put them (unless where things stand is to stay):
  // the layout's — title, subtitle, tag, channel name, brand row — where the layout preset dealt put them (step 0),
  // else to where the profile's design has them, the user's own text layers to a new one's size, at no size of their
  // own, to be placed afresh (dealPlaces) — but for the lettering a cut-out or an asset weaves with, which stays where
  // it is with it, as a layer locked does (see wovenIds), and the text a preset's element placed
  if (!locks.places) {
    const fresh = newLayer("text").t.all, woven = wovenIds(cover.layers);
    for (const L of cover.layers) {
      if (L.locked || woven.has(L.id) || !L.visible || !LETTERED.includes(L.type) || (preset && preset.parts[L.id] && !L.copy) || placed.includes(L.id)) continue;
      const back = env.design && env.design.get(L.id);
      if (L.type === "text") L.t = { all: { ...L.t.all, s: fresh.s, kx: fresh.kx, ky: fresh.ky }, by: {} };
      else if (back) L.t = copyOf(back.t);
    }
  }
  // 6. the title over everything else, with what is clipped into it, so nothing dealt lies over it (one clipped
  // onto another layer stays) — but for the subjects cut out of photos that stood over it, which still do, and the
  // assets woven with it (see canWeave in layers.js), which still pass in front of it and behind it
  const list = cover.layers, ti = list.findIndex((l) => l.id === "title");
  const stays = (l) => !l.clip && ((l.type === "photo" && l.cut) || (canWeave(l) && !!l.weave && l.weave.with.includes("title")));
  if (ti >= 0 && !list[ti].clip) {
    const title = list.splice(ti, clipEnd(list, ti) - ti + 1), over = [];
    for (let i = ti; i < list.length; ) if (stays(list[i])) over.push(...list.splice(i, clipEnd(list, i) - i + 1)); else i++;
    list.push(...title, ...over);
  }
  // 7. every layer's own choices: switches, outline and shadow, the letterings and bends as the look's recipe
  // has them (the subtitle after the title, lettered like it now and then), unless the letterings are to stay
  const can = env.can || (() => true), canTint = env.canTint || (() => false), Y = RULES.layers, c = O.chances;
  // whether a layer is set in columns is the user's (its `vertical` and `rules` are never dealt, but as a layout preset
  // dealt in step 0 has the title's, subtitle's, tag's and channel name's run); one that is (or that the look sets so
  // of itself, see columned in style.js)
  // is dealt no bend, nor a lettering a column cannot draw (NO_COLUMNS)
  const inColumns = (L) => L.vertical === true || ((L.type === "title" || L.type === "subtitle") && !!LOOKS[st.look].columns && !!LOOKS[st.look].columns(lookParams(st.look, st.lookParams[st.look])));
  const upright = (got) => { const g = { ...got }; delete g.bend; delete g.bendAmt; if (NO_COLUMNS.includes(g.fx)) { delete g.fx; delete g.fxAmt; delete g.fxSeed; } return g; };
  const dealFx = (L, got) => { delete L.fx; delete L.fxAmt; delete L.bend; delete L.bendAmt; delete L.warp; delete L.reshape; Object.assign(L, inColumns(L) ? upright(got) : got); };
  const lines = (L, k) => { L.stroke = within(k.stroke); L.shadow = within(k.shadow); };
  const titled = letterFor(st.look, "title", R, can, null, ctx);
  for (const L of cover.layers) {
    switch (L.type) {
      case "accent": L.shape = weighted(O.groups.accent, R) || pick(ACCENT_SHAPES); break;
      case "brand": L.rail = chance(c.rail); break;
      case "catname": L.plate = chance(c.catnamePlate); break;
      case "title": if (!locks.lettering) { lines(L, Y.title); dealFx(L, titled); } break;
      case "subtitle": if (!locks.lettering) { L.plate = chance(c.subtitlePlate); lines(L, Y.subtitle); dealFx(L, letterFor(st.look, "subtitle", R, can, titled, ctx)); } break;
      case "text": if (!locks.lettering) { L.plate = chance(c.textPlate); lines(L, Y.text); dealFx(L, letterFor(st.look, "text", R, can, null, ctx)); } break;
      case "asset": if (canTint(L.ref) && L.ref.kind !== "graphic") L.tint = chance(c.assetTint); break;
    }
    // 8. look effects on the rest: none, one or two (by their chances), each the look just dealt's or another look's
    if (FX_TYPES.includes(L.type) && L.type !== "title" && L.type !== "subtitle") {
      const F = RULES.lookFx, count = { one: 1, two: 2 }[weighted(O.groups.lookFx, R)] || 0;
      delete L.lookFx;
      if (count) {
        const fx = {}, others = LOOK_IDS.filter((k) => k !== st.look && effectsFor(k, L.type).length);
        for (let n = count; n > 0; n--) {
          const from = effectsFor(st.look, L.type).length && chance(O.groups.lookFxFrom.own) ? st.look : others.length ? pick(others) : null, list = from ? effectsFor(from, L.type).filter((e) => !(`${from}.${e.key}` in fx)) : [];
          if (!list.length) continue;
          const e = pick(list);
          fx[`${from}.${e.key}`] = within(F.amount, F.step);
          for (const s of e.sub || []) fx[`${from}.${e.key}:${s.key}`] = within(F.sub, F.step);
        }
        if (Object.keys(fx).length) L.lookFx = fx;
      }
    }
  }
  return { ...ctx, layout: preset ? preset.id : "keep", placed };
}

