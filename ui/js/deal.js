// Surprise me's recipes: what suits each look when a hand is dealt (see dealHand in app.js). A look keeps
// its own lettering most of the time, and when it does not, it is given a lettering of its family; it is
// bent only as often, and only in the ways, that go with it; its sliders are tuned about the values it
// was made with, and the parts it leaves out by default come in now and then. Pure: `R` is the random
// source, a function returning numbers in [0, 1).
import { LOOKS } from "./style.js";
import { EFFECTS, BENDS } from "./textfx.js";
import { titleLines, lineUnits, luminance } from "./check.js";

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
  print: { dark: 0.4, own: 0.75, fx: { plain: 2, worn: 3, dots: 2, rows: 1, bluenote: 1, editorial: 1 }, bend: 0.05, bends: { arc: 1, shell: 1 } },
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
  collage: { family: "print", own: 0.7, fx: { sticker: 2, worn: 2, rows: 2, dots: 1 }, bend: 0.15, bends: { rise: 1, flag: 1, arc: 1 } },
  yellow: { family: "print", own: 0.85, bend: 0, params: { beam: 0.3, stripes: 0.35 } },
  pitch: { family: "pop", own: 0.7, fx: { cel: 2, extrude: 2, stripes: 2, worn: 1 }, params: { net: 0.35, stadium: 0.35, crowd: 0.35 } },
  dots: { family: "light", own: 0.9, params: { smear: 0.3 } },
  neon: { family: "light", own: 0.8, fx: { cel: 1, extrude: 1, stripes: 1 }, bend: 0.15, params: { bars: 0.35, shift: 0.3 } },
  court: { family: "pop", own: 0.75, fx: { extrude: 3, cel: 2, worn: 1, stripes: 1 }, bends: { arc: 3, rise: 1 }, params: { hoop: 0.4, spray: 0.3 } },
  velvet: { family: "pop", own: 0.8, fx: { sticker: 1, extrude: 1, cel: 1 }, bends: { arc: 2, bulge: 2, wave: 1 } },
  rave: { family: "light", own: 0.85, bend: 0.35, bends: { wave: 3, flag: 2, fisheye: 2, bulge: 2, pinch: 1, circle: 1 }, params: { grid: 0.35, arch: 0.35 } },
  chrome: { family: "light", own: 0.9, bend: 0.25, bends: { arc: 2, bulge: 2, wave: 1, fisheye: 1 }, params: { echo: 0.3 } },
  netart: { family: "light", own: 0.85, fx: { rows: 2, plain: 1 }, bends: { flag: 1, wave: 1 }, params: { bars: 0.3 } },
  verse: { family: "pop", own: 0.75, fx: { sticker: 2, cel: 2, extrude: 2, stripes: 1 }, bend: 0.3, params: { sfx: 0.4 } },
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
  const lines = titleLines(title), longest = Math.max(0, ...lines.map(lineUnits));
  return { long: longest > 8 || lines.length >= 3, short: lines.length > 0 && longest <= 4 && lines.length <= 2, lum: rgb ? luminance(rgb[0], rgb[1], rgb[2]) : null };
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
  const out = baseRecipe(id, ctx.mine);
  if (ctx.long) { out.bend *= 0.3; for (const k of ["sticker", "extrude"]) if (out.fx[k]) out.fx[k] *= 0.5; }
  else if (ctx.short) out.bend = Math.min(0.5, out.bend * 1.5);
  if (ctx.lum == null || (ctx.mine && ctx.mine.dark != null)) return out;
  if (ctx.lum < 0.05) out.dark *= 0.6;
  else if (ctx.lum > 0.6) out.dark = Math.max(out.dark, Math.min(0.95, out.dark + (1 - out.dark) * 0.4));
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
  const kept = (t && t.kept) || 0, dropped = (t && t.dropped) || 0;
  return Math.min(3, Math.max(0.25, (kept + 1) / (dropped + 1)));
}
/** The look for a hand: none of the `recent` ones (while any other is left), each as likely as the user's `taste` makes it (tasteWeight). */
export function pickLook(ids, R, { recent = [], taste = {} } = {}) {
  const fresh = ids.filter((k) => !recent.includes(k)), pool = fresh.length ? fresh : ids;
  return weighted(Object.fromEntries(pool.map((k) => [k, tasteWeight(taste[k])])), R);
}
const snap = (v, d) => { const s = d.step || 0.05; return Math.min(d.max, Math.max(d.min, Math.round(v / s) * s)); };
/** How many of a look's parts that are off by default one hand may bring in. */
export const EXTRAS = 2;
/**
 * A look's sliders tuned for a hand: each about the value the look was made with (within 0.3 of the range
 * either way, likeliest near it, off the very ends unless that is where its default is); the parts that
 * are off by default come in only now and then (each by the recipe's chance, else 0.35), EXTRAS at most,
 * to between 0.3 and 0.75 of their range; a checkbox is on as likely as the recipe says, else 3 in 4 when
 * it is on by default and 3 in 10 when not. Typed words are left to the caller. Returns { key: value }.
 */
export function tuneLook(id, R, ctx = {}) {
  const L = LOOKS[id], r = recipeOf(id, ctx), out = {}, extras = [];
  for (const d of L.params) {
    if (d.text) continue;
    const o = r.params[d.key], span = d.max - d.min;
    if (d.toggle) out[d.key] = R() < (typeof o === "number" ? o : d.def > d.min ? 0.75 : 0.3) ? d.max : d.min;
    else if (d.def <= d.min) { out[d.key] = d.min; if (R() < (typeof o === "number" ? o : 0.35)) extras.push(d); }
    else out[d.key] = snap(Math.min(Math.max(d.def, d.min + span * 0.92), Math.max(Math.min(d.def, d.min + span * 0.08), d.def + span * 0.3 * (R() - R()))), d);
  }
  while (extras.length > EXTRAS) extras.splice(Math.floor(R() * extras.length), 1);
  for (const d of extras) out[d.key] = snap(d.min + (d.max - d.min) * (0.3 + 0.45 * R()), d);
  if (r.tune) r.tune(out, R);
  return out;
}
/**
 * The lettering a layer is dealt under look `id`: { fx, fxAmt, bend, bendAmt }; fx left out for the look's
 * own, bend for none, fxAmt for a lettering without a strength. `role`: "title", "subtitle" (lettered like
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
  const r = recipeOf(id, ctx), out = {}, fx = Object.fromEntries(Object.entries(r.fx).filter(([k]) => EFFECTS[k] && k !== "auto" && k !== id && can(k)));
  const choose = () => { const k = weighted(fx, R); if (k) { out.fx = k; if (EFFECTS[k].kind !== "passes") out.fxAmt = Math.round((0.6 + R() * 0.9) * 20) / 20; } };
  if (role === "subtitle") {
    if (title && title.fx && R() < 0.5) { out.fx = title.fx; if (title.fxAmt != null) out.fxAmt = title.fxAmt; }
    else if (R() >= Math.max(r.own, 0.85)) choose();
    return out;
  }
  if (R() >= (role === "text" ? r.own * 0.85 : r.own)) choose();
  if (R() < r.bend) { const b = weighted(Object.fromEntries(Object.entries(r.bends).filter(([k]) => BENDS[k] && k !== "taper")), R); if (b) { out.bend = b; out.bendAmt = Math.round((0.5 + R() * 0.6) * 20) / 20; } }
  return out;
}
