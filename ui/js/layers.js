// The layer model behind the collage editor. Pure data and maths — no DOM.
//
// A cover is a stack of layers, bottom first. "Bound" layers are the parts every cover has and
// whose content comes from somewhere else (the title text, the category's graphic, …); they can be
// moved, hidden and re-ordered but not deleted. "Free" layers are assets and text the user adds.
//
// Placement works for every output size at once:
//   t.all  applies to all sizes, stored as fractions of the canvas, so a layer keeps its relative
//          position from 16:9 to 9:16.  For free layers x/y are the position of the centre; for
//          bound layers they are an offset from where the template puts the element.
//          s is the overall size, kx / ky stretch it horizontally / vertically, r is degrees.
//   t.by   optional per-size fine-tuning in virtual pixels, keyed by "1920x1080". The category
//          graphic may also be tuned per category, keyed by "1920x1080@<category id>".
//
// A free layer may carry `cats`, a list of category ids: it then exists only on covers of those
// categories. Without it the layer is on every category's cover.
//
// Any layer but the ground may carry `sizes`, a list of size keys: it then shows only at those of the profile's sizes
// (see inSize), as if left out at the others — a layout layer's room going to the rest there, as for a part left out
// (see coverAt in render.js). Without it the layer shows at every size; with an empty list, at none (all its sizes
// gone), still there to be shown again.
//
// A layout layer may be left out of a cover (`off: true`, chosen in Cover → Layout parts): it is then
// hidden, and the editor leaves it out of the layer list and of Hide layout; ticked again, it comes back
// as it was. The ground is never left out. A new design leaves out the channel name and graphic
// (DEFAULT_OFF).
// A layout layer but the ground and the corner brackets may be copied (`copy: true`, see duplicate): the copy
// is a layer of the same type under an id of its own, showing the same thing — the title's words, the
// channel's graphic, the brand row — in a style and a place of its own (placed as the layout layers are, as
// an offset from where the template puts the element). It is the user's, as a free layer is: it can be
// deleted, renamed and copied again, and the layout's order, Layout parts and Hide layout pass it by.
// A free layer may also be clipped (`clip: true`): it then shows only within the shape of the layer
// below it — the nearest one not itself clipped, its *base* (see clipBase) — as a clipping mask does:
// a photo inside the title's letters, a colour inside a silhouette. The base can be any layer but the
// ground.
//
// A layout preset (see takeLayout) is where the layout's parts stand, which of them it has and the colour block's
// layout, for every size: kept in the settings, dealt by Surprise me, put on a cover as it is.
import { ORIENTS, BY_ORIENT, orientOfKey, layoutOf, sameLayout, virtualSize, sizeOfKey, standsFor } from "./layout.js";

// the layout layers, bottom first: in the layer list, from the top, corner brackets, title, subtitle,
// brand logo, brand row, tag, channel name, channel graphic, colour block, background
export const BOUND_TYPES = ["bg", "accent", "graphic", "catname", "tag", "brand", "logo", "subtitle", "title", "frame"];
/** The layout layers a new design leaves out of the cover (see `off` above): ticked in Cover → Layout parts, they come in. */
export const DEFAULT_OFF = ["catname", "graphic"];
/**
 * Their order before (bottom first), which a design or cover the user never re-ordered still has: see
 * reorderLayout. (Files from before the logo and the subtitle get them put in above the brand row as
 * they are read.)
 */
const OLD_ORDER = ["bg", "accent", "graphic", "brand", "logo", "subtitle", "title", "tag", "catname", "frame"];
/** The layout layers but the ground and the corner brackets: those that may be copied (see `copy` above). */
export const COPYABLE = BOUND_TYPES.filter((type) => type !== "bg" && type !== "frame");
/** Whether a layer is one of the layout's own (a copy of one is not). */
export const isLayout = (layer) => BOUND_TYPES.includes(layer.type) && !layer.copy;
/** The layout layers' types in `layers`, bottom first. */
export const layoutOrder = (layers) => layers.filter(isLayout).map((l) => l.type);
/**
 * Puts the layout layers of `layers` (in place) in the order `types` (all of BOUND_TYPES, bottom first,
 * the ground first), each layer the user added going with the layout layer it lies directly above (so
 * text over the title stays over it). Returns whether anything moved.
 */
export function orderLayout(layers, types) {
  const bound = layers.filter(isLayout);
  if (types[0] !== "bg" || types.length !== bound.length || !bound.every((l) => types.includes(l.type)) || layoutOrder(layers).join() === types.join()) return false;
  const above = new Map(), lead = [];
  let under = null;
  for (const l of layers) { if (isLayout(l)) above.set((under = l.type), []); else (under ? above.get(under) : lead).push(l); }
  const byType = Object.fromEntries(bound.map((l) => [l.type, l]));
  layers.splice(0, layers.length, ...lead, ...types.flatMap((type) => [byType[type], ...above.get(type)]));
  return true;
}
/**
 * Puts the layout layers of `layers` (in place) into BOUND_TYPES' order if they stand exactly in the old
 * default order (see orderLayout). Returns whether it did. (Run once per profile, see the app: someone
 * may put them back in the old order on purpose later.)
 */
export function reorderLayout(layers) {
  return layoutOrder(layers).join() === OLD_ORDER.join() && orderLayout(layers, BOUND_TYPES);
}
export const FREE_TYPES = ["asset", "text", "photo", "solid"];
/**
 * Layers of earlier files that are read only to be turned into something else: "subject", the
 * background photo's subject cut out, is now a photo layer (see upgradeCover in app.js).
 */
export const LEGACY_TYPES = ["subject"];
/** Layers the user added: the free ones, and copies of layout layers. */
export const isAdded = (layer) => FREE_TYPES.includes(layer.type) || layer.copy === true;
/** Layers the user can delete: those they added. */
export const isRemovable = (layer) => isAdded(layer) || LEGACY_TYPES.includes(layer.type);
/**
 * The index of the layer that layer i is clipped to (see `clip` above), or -1 if it is not clipped, or
 * clipped onto nothing but the ground (which covers everything, so the clip changes nothing).
 */
export function clipBase(layers, i) {
  if (!layers[i] || !layers[i].clip) return -1;
  let j = i - 1;
  while (j >= 0 && layers[j].clip) j--;
  return j >= 0 && layers[j].type !== "bg" ? j : -1;
}
/** The index of the last layer clipped onto layer i (i itself when none is). */
export function clipEnd(layers, i) {
  if (!layers[i] || layers[i].clip || layers[i].type === "bg") return i;
  let k = i;
  while (k + 1 < layers.length && layers[k + 1].clip) k++;
  return k;
}
// ---------- the looks' scene objects, moved (see `scene` and spot() in style.js)
// A cover keeps where the user dragged each look's scene objects, per look: cover.scene = { look: { key:
// { all: [dx, dy], by: { "1920x1080": [dx, dy] } } } } — offsets from where the look's layout puts the
// object, as fractions of the canvas (so they follow when the size or the layout changes), for all sizes
// and per size, as a layer's placement is.
const OFF = 1.5;   // how far an object may be moved, in canvas widths and heights
const offset = (v) => (Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n))) ? v.map((n) => Math.max(-OFF, Math.min(OFF, Number(n)))) : null);
const moved = (v) => !!v && (Math.abs(v[0]) > 1e-4 || Math.abs(v[1]) > 1e-4);
/** A cover's scene offsets as stored, cleaned: unmoved objects and anything else dropped. */
export function normalizeScene(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [look, objs] of Object.entries(raw).slice(0, 60)) {
    if (!/^[a-z]+$/.test(look) || !objs || typeof objs !== "object") continue;
    const o = {};
    for (const [key, v] of Object.entries(objs).slice(0, 40)) {
      if (!/^[a-zA-Z]+$/.test(key) || !v || typeof v !== "object") continue;
      const all = offset(v.all), by = {};
      if (v.by && typeof v.by === "object") for (const [k, b] of Object.entries(v.by).slice(0, 60)) { const q = offset(b); if (/^\d+x\d+$/.test(k) && moved(q)) by[k] = q; }
      if (moved(all) || Object.keys(by).length) o[key] = { ...(moved(all) ? { all } : {}), ...(Object.keys(by).length ? { by } : {}) };
    }
    if (Object.keys(o).length) out[look] = o;
  }
  return out;
}
/** Where a look's scene objects are moved to on a cover at one size: { key: [dx, dy] } (fractions of the canvas). */
export function sceneOffsets(cover, look, sizeKey) {
  const objs = (cover && cover.scene && cover.scene[look]) || {}, out = {};
  for (const [key, v] of Object.entries(objs)) {
    const a = v.all || [0, 0], b = (v.by && v.by[sizeKey]) || [0, 0];
    out[key] = [a[0] + b[0], a[1] + b[1]];
  }
  return out;
}
/** The size keys a change in `scope` reaches by size: this one ("size"), each of `keys` ("orient": the sizes facing the way it does), or none ("all"). */
const scoped = (scope, sizeKey, keys) => (scope === "size" ? [sizeKey] : scope === "orient" ? keys : null);
/**
 * Moves a look's scene object by (dx, dy), fractions of the canvas: for every size (scope "all"), this one ("size"),
 * or each of `keys` ("orient": the sizes facing the way this one does, see orientOf in layout.js).
 */
export function moveScene(cover, look, key, scope, sizeKey, dx, dy, keys = [sizeKey]) {
  const objs = ((cover.scene = cover.scene || {})[look] = cover.scene[look] || {}), v = (objs[key] = objs[key] || {}), each = scoped(scope, sizeKey, keys);
  if (each) for (const k of each) { const by = (v.by = v.by || {}), b = by[k] || [0, 0]; by[k] = offset([b[0] + dx, b[1] + dy]); }
  else { const a = v.all || [0, 0]; v.all = offset([a[0] + dx, a[1] + dy]); }
  cover.scene = normalizeScene(cover.scene);
}
/** Puts a look's scene object (or all of them, key null) back where the layout puts it: for every size, this one, or each of `keys` (as moveScene). */
export function resetScene(cover, look, key, scope, sizeKey, keys = [sizeKey]) {
  const objs = cover.scene && cover.scene[look], each = scoped(scope, sizeKey, keys);
  if (!objs) return;
  for (const k of key ? [key] : Object.keys(objs)) {
    if (!objs[k]) continue;
    if (each) { if (objs[k].by) for (const s of each) delete objs[k].by[s]; } else delete objs[k];
  }
  cover.scene = normalizeScene(cover.scene);
}
/** Whether a layer is a photo that fills the canvas (the cover's background photo, or another). */
export const fillsCanvas = (L) => L.type === "photo" && L.fill && !L.of;
/** Shapes the colour block and its dividing edge can take ("slant" is the template's own). */
export const ACCENT_SHAPES = ["slant", "flat", "reverse", "zigzag", "wave", "steps", "torn", "chevron", "scallop", "double", "stripes", "arc"];
/** The text effects a headline can be given (painted in textfx.js). Absent on a layer means "auto": the look decides. */
export const TEXT_EFFECTS = ["auto", "sticker", "cel", "plain", "cyber", "riso", "anime", "bluenote", "editorial", "vivid", "dots", "stripes", "inner", "worn", "rows", "extrude", "spiky", "torn", "cut", "melt", "puffy", "eroded", "ransom"];
/**
 * The ransom note's extras a layer may turn off (torn edges, tape, letters in depth, letters cut from the
 * photo), and the ways a letter may be drawn (on a scrap of paper, in the layer's own lettering, hollow, in
 * depth, cut from the photo); see ransom.js.
 */
export const RANSOM_EXTRAS = ["torn", "tape", "deep", "photo"], LETTER_KINDS = ["tile", "bare", "cut", "deep", "photo"];
/**
 * A letter's key, as the ransom note and weaving name it: its line, itself and how many times it came before in the
 * line (see letterKey in ransom.js). The letter is what lies between the first bar and the last, so it may be a bar
 * itself, or a stretch of another script set whole (see lineCells), up to 200 characters.
 */
const LETTER_KEY = /^\d{1,3}\|[^]{1,200}\|\d{1,4}$/u;
/**
 * The ransom note's letters dressed by hand, by key ("line|letter|how many times it came before"): each a
 * face {family, weight, italic}, kind, paper and ink ("#rrggbb"), turn (degrees), lift and size, case, hero,
 * edge, tape, its own seed (`salt`), and a lock: the layer's seed it was locked with and what it had then
 * that its neighbours decided ({seed, face, paper, ink, hero}). Only what is valid; those with nothing left
 * go, and at most 300 are kept. Null when none is.
 */
export function normalizeLetters(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {}, colour = (v) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined), int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  const faceOf = (f) => { const family = f && typeof f.family === "string" ? f.family.replace(/["\\;{}<>]/g, "").trim().slice(0, 60) : ""; return family ? { family, weight: int(f.weight, 100, 900) ?? 700, ...(f.italic === true ? { italic: true } : {}) } : undefined; };
  for (const [key, v] of Object.entries(raw)) {
    if (Object.keys(out).length >= 300) break;
    if (!LETTER_KEY.test(key) || !v || typeof v !== "object") continue;
    const lock = v.lock && typeof v.lock === "object" && int(v.lock.seed, 0, 999999) !== undefined
      ? Object.fromEntries(Object.entries({ seed: v.lock.seed, face: faceOf(v.lock.face), paper: colour(v.lock.paper), ink: colour(v.lock.ink), hero: typeof v.lock.hero === "boolean" ? v.lock.hero : undefined }).filter(([, x]) => x !== undefined))
      : undefined;
    const e = {
      face: faceOf(v.face),
      kind: LETTER_KINDS.includes(v.kind) ? v.kind : undefined, paper: colour(v.paper), ink: colour(v.ink),
      turn: Number.isFinite(v.turn) ? num(v.turn, 0, -45, 45) : undefined, lift: Number.isFinite(v.lift) ? num(v.lift, 0, -0.5, 0.5) : undefined, size: Number.isFinite(v.size) ? num(v.size, 1, 0.5, 1.6) : undefined,
      case: ["upper", "lower", "typed"].includes(v.case) ? v.case : undefined, hero: typeof v.hero === "boolean" ? v.hero : undefined,
      edge: v.edge === "torn" || v.edge === "cut" ? v.edge : undefined, tape: [0, 1, 2].includes(v.tape) ? v.tape : undefined,
      salt: int(v.salt, 1, 999999), lock,
    };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    if (Object.keys(e).length) out[key] = e;
  }
  return Object.keys(out).length ? out : null;
}
/** The bends a headline may be given whatever its lettering (`bend`, how far: `bendAmt`; see BENDS in textfx.js). */
export const BEND_IDS = ["arc", "arcLow", "circle", "shell", "bulge", "pinch", "fisheye", "rise", "taper", "wave", "flag"];
// Four of those were looks' letterings, offered in the menu by name; the menu no longer has them, and
// their looks have post effects doing what they did (see elementFx in looks/kit.js and each look's file). A text layer that
// chose one takes that effect instead, at a middling strength; the title keeps the name, and is painted
// as automatic. (For a day the underline was a look effect too, "editorial.underline": a layer with it
// on goes back to the menu's Underlined highlight.)
const LETTERINGS = { cyber: "cyber.sliced", riso: "riso.overprint", anime: "anime.keyline", vivid: "vivid.block" };
/**
 * Layers made of words. Each may carry `font`, a family name, and `ink`, its own colour. The title
 * and text layers are headlines alike: both also take `hi` (the highlighted words' colour), an
 * outline and a shadow, a plate and its colour `plateInk`, plates under the highlighted words alone
 * (`hiPlate`) or another mark of them (`hiMark`, one of HI_MARKS: a ring drawn round them by hand, a
 * marker's band through them, a block of colour set off behind them) and its colour `hiPlateInk`, and a
 * text effect.
 */
export const LETTERED = ["title", "subtitle", "tag", "catname", "brand", "text"];
export const HI_MARKS = ["circle", "marker", "block"];
export const isFree = (type) => FREE_TYPES.includes(type);
/** The headline layers: the title and the subtitle, and text the user adds (which only differs in carrying its words). */
export const HEADLINES = ["title", "subtitle", "text"];
/** Layers that can be grabbed on the canvas (the others are selected from the layer list only). */
/** Whether a layer is part of the cover of category `catId`. */
export const appliesTo = (layer, catId) => !layer.cats || layer.cats.includes(catId);
/** Whether a layer shows at the size keyed `key` (see `sizes` above): every layer without a list of sizes does. */
export const inSize = (layer, key) => !layer.sizes || layer.sizes.includes(key);
/**
 * Keeps layer L to the sizes of `keys` (size keys), in place; `all`: the profile's size keys, in their order, which
 * its list keeps. Kept to every one of them it carries no list, and so shows at a size added later too.
 */
export function keepTo(L, keys, all) {
  const sizes = all.filter((k) => keys.includes(k));
  if (sizes.length === all.length) delete L.sizes; else L.sizes = sizes;
}
/**
 * The sizes each of `layers` shows at kept to the profile's `all` (its size keys, in their order), in place, as
 * normalizeLayer keeps them when they are read: once a size is added or removed, a list of every size left is none,
 * and one left with none of them an empty one. Returns whether any changed.
 */
export function refitSizes(layers, all) {
  let changed = false;
  for (const L of layers) {
    if (!L.sizes) continue;
    const was = L.sizes.join();
    keepTo(L, L.sizes, all);
    if (!L.sizes || L.sizes.join() !== was) changed = true;
  }
  return changed;
}
/**
 * Layers from a cover of another profile (`from`: its size keys) put on one of this profile (`to`: its size keys), in
 * place: what each keeps by size goes to the sizes here that take the place of those there (see standsFor in
 * layout.js) — the sizes it shows at (`sizes`; with none of them here, where it showed at some there, every size rather
 * than none), and its placement per size (`t.by`, a move as far across the canvas here as it was there; a channel's own,
 * "<size>@<channel>", alike). They may be as a file has them, not yet normalized. Returns the layers.
 */
export function acrossSizes(layers, from, to) {
  for (const L of Array.isArray(layers) ? layers : []) {
    if (!L || typeof L !== "object") continue;
    if (Array.isArray(L.sizes) && L.sizes.length) {
      const keys = to.filter((k) => standsFor(k, from, to).some((s) => L.sizes.includes(s)));
      if (keys.length && keys.length < to.length) L.sizes = keys; else delete L.sizes;
    }
    const by = L.t && L.t.by;
    if (!by || typeof by !== "object") continue;
    const out = {}, tails = new Set(Object.keys(by).map((k) => k.replace(/^[^@]*/, "")));   // "" and "@<channel>"
    for (const tail of tails) for (const k of to) {
      const s = standsFor(k, from, to).find((x) => by[x + tail] && typeof by[x + tail] === "object");
      if (!s) continue;
      const e = by[s + tail], [fw, fh] = virtualSize(...sizeOfKey(s)), [tw, th] = virtualSize(...sizeOfKey(k));
      out[k + tail] = { ...e, dx: (Number(e.dx) * tw) / fw, dy: (Number(e.dy) * th) / fh };
    }
    L.t.by = out;
  }
  return layers;
}
export const isPickable = (layer) => layer.visible && !layer.locked && layer.type !== "frame";

const PROPS = {
  bg: { grid: true, base: "grid", blur: 0, dim: 0 },
  accent: { shape: "slant" },
  graphic: {},
  brand: { rail: true, vertical: false, rules: false },   // every lettered layer (LETTERED) may be set in columns, ruled or not (see normalizeLayer)
  logo: {},   // the profile's brand logo (brand.logo), at the right end of the brand row
  title: { stroke: 1, shadow: 1, plate: false, vertical: false, rules: false },
  subtitle: { stroke: 1, shadow: 1, plate: false, vertical: false, rules: false },   // the cover's subtitle (its words: cover.subtitle), under the title
  tag: { vertical: false, rules: false },
  catname: { showName: true, plate: true, vertical: false, rules: false },
  frame: {},
  asset: { ref: null, tint: false },   // + `ink`: a colour of the user's for a vector asset, over its own and the channel's; + `crop` (a free one too) and `weave`, as a photo's (see canWeave)
  /** A block of one colour, the canvas's size at scale 1 (so it can be a ground, or moved and shrunk into a band). */
  solid: { color: "#ffd60a" },
  text: { text: "", stroke: 1, shadow: 1, plate: false, vertical: false, rules: false },
  subject: { outline: 0, shadow: 0, follow: false },   // legacy, see LEGACY_TYPES
  /**
   * A photo. `pid` names its picture in the photo store (the picture, its original before an AI
   * repaint, its subject mask), so layers share pictures and the cover stays small. `fill`: it
   * covers the canvas, placed like a background (moved and scaled, not turned), instead of sitting
   * on it like a print. `of`: a layer id — this layer is *linked* to that photo layer: a passive
   * layer, the subject cut out of that (active) photo, showing its picture. Only its position is the
   * photo's (plus an offset of its own: its placement's x, y); its size, angle and stretch are its own,
   * as are its blur, dim, outline and shadow. `own` marks a cut-out placed so (those of earlier files
   * followed their photo's size too, and are set up as aligned when read). Every photo without `of` is
   * active. `feather`, `spread`: how far the edge of a cut-out fades inward, and outward. `treat`: the look's
   * treatment of photos applies. `cut`: only the subject is kept (the mask). `torn`: the outline is a margin
   * of torn paper; `dash`: a dashed line a little way out (the one or the other). + `ink`, the outline's colour.
   * + `crop`: {x, y, w, h}, fractions of the picture: only that part of it shows (of a photo not filling the
   * canvas), the rest kept, to be shown again; the photo's frame stays where it is, so what is kept does not move.
   * A free crop adds `pts`, the corners of a shape of any outline ([u, v], fractions of the picture), x, y, w, h
   * being the box round them: only what lies inside them shows (see normalizeCrop).
   * + `weave`: a cut-out woven with lettering below it, as a magazine's subject is with its masthead (see
   * normalizeWeave): {with, by, line, front}. `with`: the ids of the lettering layers it weaves with (the title,
   * the subtitle, text, copies of the first two); `by` "head": its head in front of them and the rest of it
   * behind, the head ending at `line` (a share of the height of the box round its subject, from its top, in the
   * photo's own frame, so it turns and scales with it); `by` "letters": the letters chosen in front of it, the
   * others behind (`front`: by layer id, their letterKeys, see ransom.js); `by` "brush": the lettering in front
   * where it was painted so, behind elsewhere (`strokes`, [{front, r, pts}] in order, in the photo's own frame:
   * see normalizeWeave). Each way keeps its data while another is chosen. Only a cut-out is woven; a whole photo
   * again keeps it, for when it is cut out once more. An asset weaves the same way (see canWeave), its picture the
   * box it is drawn in and its subject what it draws there.
   */
  photo: { pid: "", of: "", fill: false, blur: 0, dim: 0, treat: true, cut: false, feather: 0, spread: 0, outline: 0, torn: false, dash: false, shadow: 0 },
};
/** The layers that may carry the looks' effects (see FX_TYPES in style.js for those the effects are open to so far). */
const FX_LAYERS = ["text", "asset", "photo", "solid", "title", "subtitle"];
const OLD_COLORS = ["white", "accent", "ink", "custom"];   // how text layers were coloured before they were headlines (see normalizeLayer)

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : d);
const uid = () => "l" + Math.random().toString(36).slice(2, 9);
const IDENTITY_BY = { dx: 0, dy: 0, s: 1, r: 0, kx: 1, ky: 1 };

export function newLayer(type, extra = {}) {
  const free = isFree(type);
  return {
    id: free ? uid() : type, type, visible: true, locked: false, o: 1,
    t: { all: free ? { x: 0.5, y: type === "photo" || type === "solid" ? 0.5 : 0.42, s: type === "solid" ? 1 : type === "photo" ? (extra.fill ? 1 : 0.6) : 0.35, r: 0, kx: 1, ky: 1 } : { x: 0, y: 0, s: 1, r: 0, kx: 1, ky: 1 }, by: {} },
    ...PROPS[type], ...extra,
  };
}
/** A new design's layers: the layout layers, the channel name and graphic left out (DEFAULT_OFF). */
export const defaultLayers = () => BOUND_TYPES.map((type) => newLayer(type, DEFAULT_OFF.includes(type) ? { off: true, visible: false } : {}));

/** A placement as stored (see `t` above), every number within its range; `free`: a free layer's (a centre), else an offset from the template's place. */
export function normalizeT(raw, free) {
  const a = (raw && raw.all) || {}, by = {};
  for (const [k, v] of Object.entries((raw && raw.by) || {})) {
    if (!v || typeof v !== "object") continue;
    const e = { dx: num(v.dx, 0, -9000, 9000), dy: num(v.dy, 0, -9000, 9000), s: num(v.s, 1, 0.05, 20), r: num(v.r, 0, -360, 360), kx: num(v.kx, 1, 0.05, 20), ky: num(v.ky, 1, 0.05, 20) };
    if (e.dx || e.dy || e.s !== 1 || e.r || e.kx !== 1 || e.ky !== 1) by[k] = e;
  }
  return { all: { x: num(a.x, free ? 0.5 : 0, -3, 3), y: num(a.y, free ? 0.42 : 0, -3, 3), s: num(a.s, free ? 0.35 : 1, 0.02, 20), r: num(a.r, 0, -360, 360), kx: num(a.kx, 1, 0.05, 20), ky: num(a.ky, 1, 0.05, 20) }, by };
}
function normalizeLayer(raw, catIds, sizeKeys) {
  if (!raw || typeof raw !== "object" || !(raw.type in PROPS)) return null;
  const free = isFree(raw.type), copy = raw.copy === true && COPYABLE.includes(raw.type), base = newLayer(raw.type);
  const id = typeof raw.id === "string" && raw.id ? raw.id : "";
  // a copy never takes a layout layer's id
  const L = { ...base, id: free ? id || base.id : copy ? (id && !BOUND_TYPES.includes(id) ? id : uid()) : raw.type,
    visible: raw.visible !== false, locked: raw.locked === true, o: num(raw.o, 1, 0, 1), t: normalizeT(raw.t, free) };
  if (copy) L.copy = true;
  if (typeof raw.name === "string" && raw.name) L.name = raw.name.slice(0, 60);
  let lettered = null;
  // a headline may be given a text effect of its own, and a strength for it
  if (HEADLINES.includes(raw.type)) {
    const fx = raw.fx === "ghibli" ? "vivid" : raw.fx;   // the vivid look's lettering had another name for a day
    // a bend was once an effect of its own, painted in the house lettering: it is that lettering, bent
    const was = BEND_IDS.includes(fx) && !BEND_IDS.includes(raw.bend);
    const bend = was ? fx : raw.bend, bendAmt = was ? raw.fxAmt : raw.bendAmt;
    if (raw.type === "text" && LETTERINGS[fx]) lettered = LETTERINGS[fx];
    else if (raw.type === "text" && (!fx || fx === "auto") && raw.lookFx && Number(raw.lookFx["editorial.underline"]) > 0) L.fx = "editorial";
    else if (was) L.fx = "cel";
    else if (TEXT_EFFECTS.includes(fx) && fx !== "auto") L.fx = fx;
    if (!lettered && !was && raw.fxAmt !== undefined && num(raw.fxAmt, 1, 0, 2) !== 1) L.fxAmt = num(raw.fxAmt, 1, 0, 2);
    // the ransom note's letters, as Reshuffle last dealt them, those dressed by hand, the extras turned off: kept
    // under another effect too, so they are there again when the ransom note is
    if (Number.isInteger(raw.fxSeed) && raw.fxSeed > 0 && raw.fxSeed < 1e6) L.fxSeed = raw.fxSeed;
    const letters = normalizeLetters(raw.letters);
    if (letters) L.letters = letters;
    const off = Array.isArray(raw.ransomOff) ? RANSOM_EXTRAS.filter((k) => raw.ransomOff.includes(k)) : [];
    if (off.length) L.ransomOff = off;
    if (BEND_IDS.includes(bend)) {
      L.bend = bend;
      if (bendAmt !== undefined && num(bendAmt, 1, 0, 2) !== 1) L.bendAmt = num(bendAmt, 1, 0, 2);
      // the perspective's own corners: four [dx, dy] in block widths and heights; any other bend's handles
      // dragged: eight, along the top edge and then the bottom (see reshapeField in textfx.js)
      const pairs = (a, n) => Array.isArray(a) && a.length === n && a.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(Number(v))));
      if (bend === "taper" && pairs(raw.warp, 4)) L.warp = raw.warp.map((p) => p.map((v) => num(v, 0, -1.5, 1.5)));
      if (bend !== "taper" && pairs(raw.reshape, 8)) {
        const d = raw.reshape.map((p) => p.map((v) => num(v, 0, -1.5, 1.5)));
        if (d.some((p) => p[0] || p[1])) L.reshape = d;
      }
    }
  }
  // lettering may be set in a font of its own; without one it takes the look's
  if (LETTERED.includes(raw.type) && typeof raw.font === "string" && raw.font.trim()) L.font = raw.font.trim().replace(/["\\;{}<>]/g, "").slice(0, 80);
  // lettering may be given its own colour; without one it takes whatever the look gives it
  if (LETTERED.includes(raw.type)) for (const k of HEADLINES.includes(raw.type) ? ["ink", "hi", "plateInk", "hiPlateInk"] : ["ink"]) if (typeof raw[k] === "string" && /^#[0-9a-f]{6}$/i.test(raw[k])) L[k] = raw[k].toLowerCase();
  // lettering may be set in columns, as a Song edition is (`vertical`), its columns ruled (`rules`, meant only then):
  // the user's, which Surprise me never deals, nor a layout preset carries (see putLayout below, and columned in style.js)
  if (LETTERED.includes(raw.type)) { L.vertical = raw.vertical === true; L.rules = raw.rules === true; }
  // the looks' effects put on the layer (see layerEffects in style.js): "look.key" a strength 0–1 (0, or
  // missing: off), "look.key:sub" one of its own settings 0–1; they stay with the layer whatever the look
  if (FX_LAYERS.includes(raw.type) && raw.lookFx && typeof raw.lookFx === "object") {
    const fx = {};
    for (const [k, v] of Object.entries(raw.lookFx).slice(0, 80)) {
      if (!/^[a-z]+\.[a-zA-Z]+(:[a-zA-Z]+)?$/.test(k) || k.startsWith("editorial.underline") || v === null || v === "" || !Number.isFinite(Number(v))) continue;
      const n = num(v, 0, 0, 1);
      if (n > 0 || k.includes(":")) fx[k] = n;
    }
    for (const k of Object.keys(fx)) if (k.includes(":") && !(k.split(":")[0] in fx)) delete fx[k];   // a setting of an effect that is off
    if (Object.keys(fx).length) L.lookFx = fx;
  }
  if (lettered && !(L.lookFx && L.lookFx[lettered])) L.lookFx = { ...(L.lookFx || {}), [lettered]: 0.6 };
  if ((free || raw.type === "title") && raw.clip === true) L.clip = true;   // shown only within the layer below (see clipBase); the title may be too
  if (!free && !copy && raw.type !== "bg" && raw.off === true) { L.off = true; L.visible = false; }   // a layout layer this cover leaves out (see `off` above)
  if (free && Array.isArray(raw.cats)) {   // a layer whose categories are all gone goes with them
    const cats = [...new Set(raw.cats.filter((x) => typeof x === "string" && x && (!catIds || catIds.includes(x))))];
    if (!cats.length) return null;
    L.cats = cats;
  }
  // the sizes it shows at (see `sizes` above): size keys, each once, only the profile's (with `sizeKeys`, in their
  // order); every one of the profile's is no list at all, and none is an empty one (unlike a channel, a size gone does
  // not take the layer with it: it stays, to be shown again)
  if (raw.type !== "bg" && Array.isArray(raw.sizes)) {
    const keys = [...new Set(raw.sizes.filter((k) => typeof k === "string" && /^\d{2,5}x\d{2,5}$/.test(k)))].slice(0, 80);
    if (!sizeKeys) L.sizes = keys;
    else if (!sizeKeys.every((k) => keys.includes(k))) L.sizes = sizeKeys.filter((k) => keys.includes(k));
  }
  switch (raw.type) {
    case "bg": L.grid = true; L.base = ["look", "clear"].includes(raw.base) ? raw.base : "grid"; L.blur = num(raw.blur, 0, 0, 80); L.dim = num(raw.dim, 0, 0, 0.9); break;   // its base: the look's ground and grid, or nothing; the look's scene always on it
    case "accent": L.shape = ACCENT_SHAPES.includes(raw.shape) ? raw.shape : "slant"; break;
    case "brand": L.rail = raw.rail !== false; break;
    case "title": case "subtitle": L.stroke = num(raw.stroke, 1, 0, 2); L.shadow = num(raw.shadow, 1, 0, 2); L.plate = raw.plate === true; if (raw.hiPlate === true) L.hiPlate = true; else if (HI_MARKS.includes(raw.hiMark)) L.hiMark = raw.hiMark; break;
    case "catname": L.showName = raw.showName !== false; L.plate = raw.plate !== false; break;
    case "photo": {
      const id = (v) => (typeof v === "string" ? v.replace(/[^\w-]/g, "").slice(0, 40) : "");
      L.pid = id(raw.pid); L.of = id(raw.of); L.fill = raw.fill === true; L.treat = raw.treat !== false; L.cut = raw.cut === true;
      L.blur = num(raw.blur, 0, 0, 80); L.dim = num(raw.dim, 0, 0, 0.9); L.outline = num(raw.outline, 0, 0, 60); L.torn = raw.torn === true; L.dash = !L.torn && raw.dash === true; L.shadow = num(raw.shadow, 0, 0, 1);
      L.feather = num(raw.feather, 0, 0, 60); L.spread = num(raw.spread, 0, 0, 60);
      if (L.of && raw.own === true) L.own = true;
      const crop = normalizeCrop(raw.crop);
      if (crop) L.crop = crop;
      const weave = normalizeWeave(raw.weave);
      if (weave) L.weave = weave;
      if (!L.pid && !L.of) return null;   // nothing to show
      if (typeof raw.ink === "string" && /^#[0-9a-f]{6}$/i.test(raw.ink)) L.ink = raw.ink.toLowerCase();
      break;
    }
    case "subject":
      L.outline = num(raw.outline, 0, 0, 60); L.shadow = num(raw.shadow, 0, 0, 1); L.follow = raw.follow === true;
      if (typeof raw.ink === "string" && /^#[0-9a-f]{6}$/i.test(raw.ink)) L.ink = raw.ink.toLowerCase();
      break;
    case "asset": {
      const r = raw.ref;
      if (!r || !["graphic", "sticker", "user"].includes(r.kind) || typeof r.id !== "string") return null;
      L.ref = { kind: r.kind, id: r.id }; L.tint = raw.tint === true;
      const crop = normalizeCrop(raw.crop);
      if (crop) L.crop = crop;
      const weave = normalizeWeave(raw.weave);
      if (weave) L.weave = weave;
      if (typeof raw.ink === "string" && /^#[0-9a-f]{6}$/i.test(raw.ink)) L.ink = raw.ink.toLowerCase();
      break;
    }
    case "solid": L.color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : "#ffd60a"; break;
    case "text": {
      L.text = typeof raw.text === "string" ? raw.text : "";
      L.plate = raw.plate === true || raw.look === "plate";
      if (raw.hiPlate === true) L.hiPlate = true;   // a plate under each highlighted word
      else if (HI_MARKS.includes(raw.hiMark)) L.hiMark = raw.hiMark;   // or another mark of them
      // Older files said how a text layer looked with `look`: "title", "plain" or "plate". A plate is
      // now a setting of its own, and the lettering is the text effect — "plain" for the two that had none.
      if (!L.fx && (raw.look === "plain" || raw.look === "plate")) L.fx = "plain";
      // A plate had no outline or shadow then; a layer from before the sliders keeps it that way.
      L.stroke = num(raw.stroke, L.plate ? 0 : 1, 0, 2); L.shadow = num(raw.shadow, L.plate ? 0 : 1, 0, 2);
      // Before text layers were headlines they had one colour, `color`: white, the channel colour, ink,
      // or "custom" (`ink`, which also won beside a named one) — the plate's colour when there was a
      // plate. White is now "automatic"; the channel colour stays as color "accent" until a colour is chosen.
      if (OLD_COLORS.includes(raw.color)) {
        const hex = L.ink || { white: "#ffffff", ink: "#07070c" }[raw.color] || "";
        delete L.ink;
        if (L.plate) { if (hex) L.plateInk = L.plateInk || hex; }
        else if (hex && hex !== "#ffffff") L.ink = hex;
        else if (raw.color === "accent" && !hex) L.color = "accent";
      }
      break;
    }
  }
  return L;
}
/** The most corners a free crop keeps (see normalizeCrop). */
export const CROP_PTS = 64;
/**
 * The least of the picture a free crop keeps, as a share of its area: as much as the smallest rectangle crop keeps
 * (2% each way). A shape with less, or spread too thin along its box (see hasArea), has (almost) no area: it is not
 * kept, nor a corner dragged, moved or taken away to it.
 */
export const CROP_AREA = 0.0004;
/** A free crop's corner's number as it is kept (see normalizeCrop): within the picture, to 1e-4. */
const inCrop = (v) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
/**
 * A photo's crop (see PROPS.photo), or an asset's: a rectangle, at least 2% of the picture each way, within it; null
 * for none, or the whole picture. A free crop is a shape of any outline: its corners `pts`, in order round it, each
 * [u, v] in fractions of the picture, put within it and rounded to 1e-4 (those not a pair of numbers dropped, the
 * first 64 kept), and x, y, w, h the box round them, at least 2% each way, so whatever reads a crop's box (the frame,
 * the work canvases, the box round a subject) reads a free crop's as a rectangle's. Its corners are what decides it:
 * a box it carries is worked out again. With fewer than 3 corners it is read as the rectangle it carries; the four
 * corners of the picture in order round it are the whole picture, no crop. A shape with (almost) no area (see
 * CROP_AREA, polyArea), its corners on a line or on one point, would show nothing and leave a frame a sliver: it is
 * read as no crop too, the whole picture (as its four corners are), rather than as the sliver of a box it carries.
 * A rectangle is kept as it ever was.
 */
export function normalizeCrop(c) {
  if (!c || typeof c !== "object") return null;
  const r = (v) => Math.round(v * 1e4) / 1e4;
  const pts = (Array.isArray(c.pts) ? c.pts : []).filter((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v))).slice(0, CROP_PTS).map((p) => p.map(inCrop));
  if (pts.length >= 3) {
    if (wholePoly(pts) || !hasArea(pts)) return null;
    const box = (i) => { const lo = Math.min(...pts.map((p) => p[i])), d = Math.max(CROP_MIN, r(Math.max(...pts.map((p) => p[i])) - lo)); return [Math.min(lo, r(1 - d)), d]; };
    const [x, w] = box(0), [y, h] = box(1);
    return { x, y, w, h, pts };
  }
  const x = r(num(c.x, 0, 0, 0.98)), y = r(num(c.y, 0, 0, 0.98)), w = Math.min(r(num(c.w, 1, 0.02, 1)), r(1 - x)), h = Math.min(r(num(c.h, 1, 0.02, 1)), r(1 - y));
  return x > 1e-4 || y > 1e-4 || w < 0.9999 || h < 0.9999 ? { x, y, w, h } : null;
}
/** Whether a free crop's corners are the picture's own four, in order round it (either way): the whole picture. */
function wholePoly(pts) {
  if (pts.length !== 4) return false;
  const k = pts.map(([u, v]) => (u === 0 && v === 0 ? 0 : u === 1 && v === 0 ? 1 : u === 1 && v === 1 ? 2 : u === 0 && v === 1 ? 3 : -1));
  const step = (k[1] - k[0] + 4) % 4;
  return !k.includes(-1) && (step === 1 || step === 3) && k.every((n, i) => (k[(i + 1) % 4] - n + 4) % 4 === step);
}
/**
 * How many layers a cut-out weaves with at most, and how many letters of each it puts in front; how many brush
 * strokes it keeps, points a stroke and points in all (see normalizeWeave).
 */
export const WEAVE_MAX = { with: 24, front: 400, strokes: 300, points: 2000, total: 12000 };
/** A brush stroke's radius, in shares of the photo's longer side: the least and the most kept (see normalizeWeave). */
export const BRUSH_R = [0.001, 0.5];
/** The ways a cut-out, or an asset, weaves (see `weave` in PROPS.photo); the first when none is given. */
export const WEAVE_WAYS = ["head", "letters", "brush"];
const r4 = (v) => Math.round(v * 1e4) / 1e4;
/**
 * A cut-out's weave (see PROPS.photo) as stored, cleaned: the ids of the layers it weaves with, each once, at most
 * 24; the way, "head" unless "letters" or "brush"; where the head ends, 0.1–0.9 (0.3 when missing); the letters in
 * front of each layer it weaves with, each a letter's key once, at most 400; the brush strokes, in the order they
 * were painted, each {front, r, pts}: in front (the lettering comes in front where it passes) unless `front` is
 * false (it goes behind there again); its radius `r`, a share of the photo's longer side (0.001–0.5); its points
 * [u, v], fractions of the picture's width and height (0 its left and top edge, 1 its right and bottom; within
 * -1–2), so they are in the photo's own frame and follow it when it is moved, scaled, stretched or turned, at every
 * size. A crop changes nothing of them (the picture stays where it is in its frame: they stay on what they were
 * painted on), nor does a new picture put in its place. An asset's are fractions of the box it is drawn in, and
 * its radius a share of that box's longer side. At most 300 strokes, 2000 points a stroke and 12000 in all,
 * the first kept; each number to 4 decimals; a stroke with no point goes. `strokes` is left out when there are
 * none. Every way's data is kept whichever is chosen, so going back to one finds it as it was. The layers are not
 * looked up (each layer is read on its own): those gone, or no longer below it, are passed by when it is painted.
 * Null for no weave.
 */
export function normalizeWeave(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = (v) => (typeof v === "string" ? v.replace(/[^\w-]/g, "").slice(0, 40) : "");
  const ids = [...new Set((Array.isArray(raw.with) ? raw.with : []).map(id).filter(Boolean))].slice(0, WEAVE_MAX.with);
  const from = raw.front && typeof raw.front === "object" && !Array.isArray(raw.front) ? raw.front : {};
  const front = Object.fromEntries(ids.map((k) => [k, Object.hasOwn(from, k) && Array.isArray(from[k]) ? [...new Set(from[k].filter((x) => typeof x === "string" && LETTER_KEY.test(x)))].slice(0, WEAVE_MAX.front) : []]).filter(([, keys]) => keys.length));
  const strokes = [];
  let left = WEAVE_MAX.total;
  for (const s of Array.isArray(raw.strokes) ? raw.strokes : []) {
    if (strokes.length >= WEAVE_MAX.strokes || left <= 0) break;
    if (!s || typeof s !== "object" || !Array.isArray(s.pts)) continue;
    const pts = [];
    for (const p of s.pts) {
      if (pts.length >= Math.min(WEAVE_MAX.points, left)) break;
      if (Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1])) pts.push([r4(Math.min(2, Math.max(-1, p[0]))), r4(Math.min(2, Math.max(-1, p[1])))]);
    }
    if (!pts.length) continue;
    left -= pts.length;
    strokes.push({ front: s.front !== false, r: r4(num(s.r, 0.03, BRUSH_R[0], BRUSH_R[1])), pts });
  }
  return { with: ids, by: WEAVE_WAYS.includes(raw.by) ? raw.by : "head", line: Math.round(num(raw.line, 0.3, 0.1, 0.9) * 1000) / 1000, front, ...(strokes.length ? { strokes } : {}) };
}
/** The letters of layer `id` a weave puts in front (see `weave`): its own list, never what an object has from its prototype. */
export const frontOf = (weave, id) => (weave && weave.front && Object.hasOwn(weave.front, id) && Array.isArray(weave.front[id]) ? weave.front[id] : []);
/** How many points a weave's brush strokes have in all (see WEAVE_MAX). */
export const strokePoints = (weave) => (weave && Array.isArray(weave.strokes) ? weave.strokes.reduce((n, s) => n + s.pts.length, 0) : 0);
/** Whether a weave by the brush brings any lettering in front: a stroke in front, which a stroke behind may yet take back. */
export const brushesFront = (weave) => !!(weave && weave.by === "brush" && Array.isArray(weave.strokes) && weave.strokes.some((s) => s.front));
/**
 * Where a photo is on the canvas, as the affine map [a, b, c, d, e, f] (as DOMMatrix takes it: x = a·u + c·v + e,
 * y = b·u + d·v + f) from a point of its picture in fractions of it (u, v; see `strokes` in normalizeWeave) to the
 * canvas: the picture's rectangle `rect` ({x, y, iw, ih}) in its frame, the frame at (cx, cy), stretched by kx, ky
 * and turned r degrees about it (`at`, a photo's placement as PAINT.photo has it; none for a photo filling the
 * canvas, whose rectangle is on the canvas already). Stretching and turning are the frame's, so a picture stretched
 * stays a picture stretched: a stroke's round brush is as stretched as the photo.
 */
export function photoMap(rect, at = null) {
  const { cx = 0, cy = 0, r = 0, kx = 1, ky = 1 } = at || {}, a = (r * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  return [cos * kx * rect.iw, sin * kx * rect.iw, -sin * ky * rect.ih, cos * ky * rect.ih, cx + cos * kx * rect.x - sin * ky * rect.y, cy + sin * kx * rect.x + cos * ky * rect.y];
}
/** The canvas point of a photo's point (u, v), by its map m (see photoMap): where a stroke's point lands. */
export const onCanvas = (m, u, v) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]];
/** The photo's point [u, v] under the canvas point (x, y), by its map m (see photoMap); null when the map is flat. */
export function photoPoint(m, x, y) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  const dx = x - m[4], dy = y - m[5];
  return [(m[3] * dx - m[2] * dy) / det, (m[0] * dy - m[1] * dx) / det];
}
/**
 * How long the longer side of a picture nw × nh is on the canvas by its map m (see photoMap), a stretch evened out
 * (the mean of the two): what a brush stroke's radius is a share of, so a radius of r is r × this on the canvas.
 */
export const photoLong = (m, nw, nh) => Math.sqrt((Math.abs(m[0] * m[3] - m[1] * m[2]) * Math.max(nw, nh)) / Math.max(1e-9, Math.min(nw, nh)));
/**
 * The next point of a brush stroke being painted (`pts`, [u, v] in fractions of the photo, see normalizeWeave), or
 * null for none yet: the mean of the last few places the pointer was (`recent`, the newest last), which smooths a
 * hand's jitter a little, once it lies at least `gap` from the stroke's last point. `gap` is a share of the photo's
 * longer side, and `aspect` the picture's width over its height, so a gap is as long across as down.
 */
export function brushNext(pts, recent, gap, aspect = 1) {
  if (!recent.length) return null;
  const n = Math.min(3, recent.length), tail = recent.slice(-n), p = [tail.reduce((s, q) => s + q[0], 0) / n, tail.reduce((s, q) => s + q[1], 0) / n];
  const last = pts[pts.length - 1];
  if (!last) return p;
  const wx = aspect >= 1 ? 1 : aspect, wy = aspect >= 1 ? 1 / aspect : 1;   // a fraction of the width, and of the height, in shares of the longer side
  return Math.hypot((p[0] - last[0]) * wx, (p[1] - last[1]) * wy) >= gap ? p : null;
}
/**
 * What of a weave's strokes is still to be drawn onto a brush mask that has `drawn` of them ([{s, n, front, r}]: each
 * stroke object drawn, how many of its points, its way and its radius then): {from, at}, the stroke and the point of
 * it to go on from, when the mask only lacks what was added since — points at the end of the last stroke drawn,
 * strokes after it (a stroke is painted in order, over those before it, so only the last may grow); null when it
 * has to be drawn anew (a stroke changed, taken away or put in place of another, an undo).
 */
export function brushToDo(drawn, strokes) {
  if (!Array.isArray(strokes) || drawn.length > strokes.length) return null;
  for (let i = 0; i < drawn.length; i++) {
    const d = drawn[i], s = strokes[i];
    if (s !== d.s || s.front !== d.front || s.r !== d.r || s.pts.length < d.n || (i < drawn.length - 1 && s.pts.length !== d.n)) return null;
  }
  const last = drawn.length - 1;
  return last >= 0 && strokes[last].pts.length > drawn[last].n ? { from: last, at: drawn[last].n } : { from: drawn.length, at: 0 };
}
/** Where a woven cut-out's head ends (see `weave`): `line` of the way down `box`, the box round its subject ({y0, y1}, fractions of the photo), as a fraction of the photo's height. An asset's alike, in the box it is drawn in. */
export const headLine = (box, line) => box.y0 + Math.min(0.9, Math.max(0.1, line)) * (box.y1 - box.y0);
/** The layers a cut-out at index i of `layers` may weave with (see `weave`): the headline layers below it, bottom first. */
export const weavable = (layers, i) => layers.slice(0, Math.max(0, i)).filter((l) => HEADLINES.includes(l.type));
/**
 * Whether layer L weaves with the lettering below it, by its `weave` (see PROPS.photo): a photo cut out, and every
 * asset — a sticker, a graphic, an image of the user's, a 3D object — which is see-through round what it draws
 * already, so it needs no cutting out (and weaves in a plain browser too). Its subject is then what it draws, its
 * picture the box it is drawn in (see assetHalf in assets.js): the head measured on that, the brush's strokes kept in it.
 */
export const canWeave = (L) => !!L && (L.type === "asset" || (L.type === "photo" && L.cut === true));
/**
 * The ids of the layers of `layers` that a weave holds together: each cut-out or asset that weaves (see canWeave) with
 * lettering below it on this cover, and that lettering. Surprise me leaves them where they are, as it leaves a layer
 * locked (see dealCover in deal.js, dealPlaces in app.js): moved apart, the weave would show nothing. A weave that
 * shows nothing already holds nothing: its layer hidden (or the lettering it weaves with), by letters with none of a layer's in front, by the brush
 * with no stroke in front.
 */
export function wovenIds(layers) {
  const out = new Set();
  layers.forEach((L, i) => {
    const w = L && L.weave;
    if (!canWeave(L) || !w || !L.visible || (w.by === "brush" && !(w.strokes || []).some((s) => s.front))) return;
    const with_ = weavable(layers, i).filter((l) => w.with.includes(l.id) && l.visible && (w.by !== "letters" || frontOf(w, l.id).length > 0));
    if (!with_.length) return;
    out.add(L.id);
    for (const l of with_) out.add(l.id);
  });
  return out;
}
/**
 * The box round what is opaque in a picture's pixels (`data`, RGBA, w × h): those whose alpha is above `min`, as
 * fractions of its size ({x0, y0, x1, y1}), or null when there are none. A cut-out's subject is measured so on its
 * mask, an asset's on what it draws (see maskBox and assetBox in render.js).
 */
export function opaqueBox(data, w, h, min = 64) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (data[(y * w + i) * 4 + 3] > min) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
}
const CROP_MIN = 0.02;
/**
 * A crop (see normalizeCrop; {x: 0, y: 0, w: 1, h: 1} for none) dragged: `handle` "move", or a side or a corner
 * ("n", "e", "se", …), by dx, dy (fractions of the picture). `ratio`: the width over the height it keeps, in
 * fractions of the picture (the picture's own shape is 1), or null for free — a corner keeps it about the
 * corner across, a side about the middle of the side across. It stays within the picture, at least 2% of it.
 */
export function dragCrop(c, handle, dx, dy, ratio = null) {
  if (handle === "move") return { ...c, x: Math.min(1 - c.w, Math.max(0, c.x + dx)), y: Math.min(1 - c.h, Math.max(0, c.y + dy)) };
  let x0 = c.x, y0 = c.y, x1 = c.x + c.w, y1 = c.y + c.h;
  const W = handle.includes("w"), E = handle.includes("e"), N = handle.includes("n"), S = handle.includes("s");
  if (W) x0 = Math.min(x1 - CROP_MIN, Math.max(0, x0 + dx));
  if (E) x1 = Math.max(x0 + CROP_MIN, Math.min(1, x1 + dx));
  if (N) y0 = Math.min(y1 - CROP_MIN, Math.max(0, y0 + dy));
  if (S) y1 = Math.max(y0 + CROP_MIN, Math.min(1, y1 + dy));
  if (!ratio) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const least = Math.max(CROP_MIN, CROP_MIN * ratio);   // the smallest width that keeps both sides at 2%
  if ((W || E) && (N || S)) {   // a corner: the size the pointer asks for each way, met halfway, from the corner across
    const ax = W ? c.x + c.w : c.x, ay = N ? c.y + c.h : c.y, roomW = W ? ax : 1 - ax, roomH = N ? ay : 1 - ay;
    const w = Math.max(least, Math.min(((x1 - x0) + (y1 - y0) * ratio) / 2, roomW, roomH * ratio)), h = w / ratio;
    return { x: W ? ax - w : ax, y: N ? ay - h : ay, w, h };
  }
  if (W || E) {   // a side: the other way follows, about the middle
    const cy = c.y + c.h / 2, room = 2 * Math.min(cy, 1 - cy), ax = W ? x1 : x0;
    const w = Math.max(least, Math.min(x1 - x0, room * ratio)), h = w / ratio;
    return { x: W ? ax - w : ax, y: cy - h / 2, w, h };
  }
  const cx = c.x + c.w / 2, room = 2 * Math.min(cx, 1 - cx), ay = N ? y1 : y0;
  const h = Math.max(least / ratio, Math.min(y1 - y0, room / ratio)), w = h * ratio;
  return { x: cx - w / 2, y: N ? ay - h : ay, w, h };
}
/**
 * A crop drawn from point a to point b (fractions of the picture: a within it), at shape `ratio` (as in dragCrop)
 * or free: from a toward b, as large as the picture lets it go that way.
 */
export function drawnCrop(a, b, ratio = null) {
  let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if (ratio) { w = Math.max(w, h * ratio); h = w / ratio; }
  const right = b.x >= a.x, down = b.y >= a.y, k = Math.min(1, (right ? 1 - a.x : a.x) / w || 1, (down ? 1 - a.y : a.y) / h || 1);
  w *= k; h *= k;
  return { x: right ? a.x : a.x - w, y: down ? a.y : a.y - h, w, h };
}
/**
 * A crop of `ratio` (as in dragCrop) as large as `c` (no larger than the picture holds), as near the middle of
 * `c` as it goes: a shape chosen keeps about what was kept.
 */
export function fitCrop(c, ratio) {
  let h = Math.sqrt((c.w * c.h) / ratio), w = h * ratio;
  const f = Math.min(1, 1 / w, 1 / h);
  w *= f; h *= f;
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
}
/**
 * The corners of crop `c` as a free crop has them (see normalizeCrop), fractions of the picture: its own, or a
 * rectangle's four from its top left round to the right; the whole picture's for none, which is where a free crop
 * starts. A copy: the window works on it and puts it back through normalizeCrop.
 */
export const cropPoly = (c) => (c && Array.isArray(c.pts) ? c.pts.map((p) => [...p]) : (({ x, y, w, h }) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]])(c || { x: 0, y: 0, w: 1, h: 1 }));
const in01 = (v) => Math.min(1, Math.max(0, v));
/** A free crop's corner i moved by dx, dy (fractions of the picture), within the picture; the others, those joined to it too, stay where they are. */
export const dragPoint = (pts, i, dx, dy) => pts.map((p, j) => (j === i ? [in01(p[0] + dx), in01(p[1] + dy)] : p));
/**
 * A corner put on a free crop's edge i (from corner i to the next) at point p, within the picture: the corners with it
 * after corner i, so it joins the two the edge joined. As they were with 64 corners already (see CROP_PTS).
 */
export const addPoint = (pts, i, p) => (pts.length >= CROP_PTS ? pts : [...pts.slice(0, i + 1), [in01(p[0]), in01(p[1])], ...pts.slice(i + 1)]);
/**
 * A free crop's corner i taken away, its two neighbours joined; as they were (the very array) when that would leave
 * fewer than three corners, or a shape with (almost) no area (see hasArea).
 */
export function dropPoint(pts, i) {
  const less = pts.filter((p, j) => j !== i);
  return pts.length <= 3 || !hasArea(less) ? pts : less;
}
/**
 * The area polygon `poly` ([[x, y], …], closed) covers, filled even-odd as a free crop is: where it crosses itself
 * twice over a place, that place is not covered, and the lobes of a shape crossed once both count (a sum of signed
 * areas would cancel them). Exact: taken in strips between the heights of its corners and of the points where its
 * edges cross, within each of which every edge's crossing of a level line moves straight and keeps its order, so the
 * length covered along the strip's middle line is its mean.
 */
export function polyArea(poly) {
  const n = poly.length, ys = poly.map((p) => p[1]);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n], [cx, cy] = poly[j], [ex, ey] = poly[(j + 1) % n];
    const rx = bx - ax, ry = by - ay, sx = ex - cx, sy = ey - cy, d = rx * sy - ry * sx;
    if (!d) continue;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / d, u = ((cx - ax) * ry - (cy - ay) * rx) / d;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ys.push(ay + t * ry);
  }
  const hs = [...new Set(ys)].sort((a, b) => a - b);
  let area = 0;
  for (let k = 0; k + 1 < hs.length; k++) {
    const y = (hs[k] + hs[k + 1]) / 2, xs = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > y !== yj > y) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) area += (xs[m + 1] - xs[m]) * (hs[k + 1] - hs[k]);
  }
  return area;
}
/**
 * Whether a free crop's corners (fractions of the picture) keep enough of it to be kept: as much of it as the
 * smallest rectangle crop (CROP_AREA), and its area over the longer side of the box round it 1% at least, so a shape
 * squeezed to a sliver along a line, however long, has (almost) no area either, while a star burst of thin spikes, a
 * crescent or a thin L has enough. Judged on the corners as they would be kept (within the picture, to 1e-4, see
 * normalizeCrop), so what the window puts on a layer by it is never then read as no crop.
 */
export function hasArea(pts) {
  const q = pts.map((p) => p.map(inCrop)), a = polyArea(q), side = (k) => Math.max(...q.map((p) => p[k])) - Math.min(...q.map((p) => p[k]));
  return a >= CROP_AREA && a / Math.max(side(0), side(1)) >= CROP_MIN / 2;
}
/** A free crop moved whole by dx, dy (fractions of the picture), as far as the box round it stays within the picture. */
export function movePoly(pts, dx, dy) {
  const lo = (k) => Math.min(...pts.map((p) => p[k])), hi = (k) => Math.max(...pts.map((p) => p[k]));
  const mx = Math.min(1 - hi(0), Math.max(-lo(0), dx)), my = Math.min(1 - hi(1), Math.max(-lo(1), dy));
  return pts.map(([u, v]) => [u + mx, v + my]);
}
/**
 * The point of polygon `poly`'s outline ([[x, y], …], closed) nearest (x, y): {i, x, y, d}, on its edge from corner i
 * to the next, d away. Where a click on an edge puts a corner of a free crop, and how near a layer cropped so is caught.
 */
export function edgePoint(poly, x, y) {
  let best = null;
  poly.forEach(([ax, ay], i) => {
    const [bx, by] = poly[(i + 1) % poly.length], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l)) : 0, px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
    if (!best || d < best.d) best = { i, x: px, y: py, d };
  });
  return best;
}
/** Whether (x, y) lies inside polygon `poly` ([[x, y], …]), counted even-odd, as a free crop is painted. */
export function inPoly(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * Repairs a layer list: drops unknown layers, guarantees each bound layer exists exactly once
 * (missing ones are put back in their default place), keeps the background at the bottom and
 * makes ids unique. With `catIds` (the categories that exist), layers made for categories that
 * were removed are dropped too; with `sizeKeys` (the profile's sizes), a layer's sizes are only those.
 */
export function normalizeLayers(raw, catIds, sizeKeys) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const L = normalizeLayer(r, catIds, sizeKeys);
    if (!L) continue;
    if (seen.has(L.id)) { if (!isAdded(L)) continue; L.id = uid(); }
    seen.add(L.id); out.push(L);
  }
  BOUND_TYPES.forEach((type, i) => {
    if (seen.has(type)) return;
    // insert after the nearest earlier bound layer that is present; a new design leaves some out
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.findIndex((l) => l.id === BOUND_TYPES[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, newLayer(type, DEFAULT_OFF.includes(type) ? { off: true, visible: false } : {}));
  });
  const bg = out.findIndex((l) => l.id === "bg");
  if (bg > 0) out.unshift(out.splice(bg, 1)[0]);
  return out;
}

/** The per-size entry that applies: the category-specific one when present, else the size one. */
const byKey = (layer, key, catId) => (layer.type === "graphic" && catId && layer.t.by[`${key}@${catId}`] ? `${key}@${catId}` : key);
/** Key written when fine-tuning one size: the category graphic is tuned per category. */
export const writeKey = (layer, key, catId) => (layer.type === "graphic" && catId ? `${key}@${catId}` : key);

/**
 * Final placement of a layer on a virtual canvas of vw x vh.
 * Free layers: {cx, cy} centre, s scale (1 = a 600-unit asset on a 1080-high canvas), r degrees.
 * Layout layers: {dx, dy} offset from the template position, s scale multiplier, r degrees.
 * Both also carry kx / ky, the horizontal / vertical stretch.
 */
export function resolve(layer, vw, vh, key, catId) {
  const a = layer.t.all, b = layer.t.by[byKey(layer, key, catId)] || IDENTITY_BY;
  const r = a.r + b.r, kx = a.kx * b.kx, ky = a.ky * b.ky;
  if (isFree(layer.type)) return { cx: a.x * vw + b.dx, cy: a.y * vh + b.dy, s: a.s * b.s * (Math.min(vw, vh) / 1080), r, kx, ky };
  return { dx: a.x * vw + b.dx, dy: a.y * vh + b.dy, s: a.s * b.s, r, kx, ky };
}

/**
 * Applies an edit. scope "all" changes every size (fractions); scope "size" changes only `key`; scope "orient" changes
 * each size of `group` ([{key, vw, vh}]: the sizes facing the way this one does, see orientOf in layout.js, this one
 * among them) as "size" changes one, a move there as far across its canvas as it is across this one.
 * patch: {ddx, ddy} move in virtual px, {scale} multiply, {kx, ky} stretch (multiply), {rot} add degrees.
 */
export function adjust(layer, { vw, vh, key, catId, group }, scope, patch) {
  const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (scope === "all") {
    const a = layer.t.all;
    if (patch.ddx) a.x = lim(a.x + patch.ddx / vw, -3, 3);
    if (patch.ddy) a.y = lim(a.y + patch.ddy / vh, -3, 3);
    if (patch.scale) a.s = lim(a.s * patch.scale, 0.02, 20);
    if (patch.rot) a.r = lim(a.r + patch.rot, -360, 360);
    if (patch.kx) a.kx = lim(a.kx * patch.kx, 0.05, 20);
    if (patch.ky) a.ky = lim(a.ky * patch.ky, 0.05, 20);
    return;
  }
  for (const g of scope === "orient" && group && group.length ? group : [{ key, vw, vh }]) {
    const k = writeKey(layer, g.key, catId), fx = g.vw / vw, fy = g.vh / vh;   // 1 for this size
    // start a category-specific entry from the size-wide one so the graphic does not jump
    const b = (layer.t.by[k] = { ...(layer.t.by[k] || layer.t.by[g.key] || IDENTITY_BY) });
    if (patch.ddx) b.dx += patch.ddx * fx;
    if (patch.ddy) b.dy += patch.ddy * fy;
    if (patch.scale) b.s = lim(b.s * patch.scale, 0.05, 20);
    if (patch.rot) b.r = lim(b.r + patch.rot, -360, 360);
    if (patch.kx) b.kx = lim(b.kx * patch.kx, 0.05, 20);
    if (patch.ky) b.ky = lim(b.ky * patch.ky, 0.05, 20);
  }
}
/**
 * Clears placement edits: scope "size" drops this size's fine-tuning, "orient" that of each size of `keys` (the sizes
 * facing the way this one does), "all" restores the default.
 */
export function resetPlacement(layer, scope, key, catId, keys = [key]) {
  if (scope === "size" || scope === "orient") {
    for (const k of scope === "orient" ? keys : [key]) { delete layer.t.by[k]; if (catId) delete layer.t.by[`${k}@${catId}`]; }
    return;
  }
  layer.t = newLayer(layer.type).t;
}

// ---------- layout presets: where a cover's parts stand, without its look (kept in the settings, see normalizeLayouts in store.js)
// A layout preset holds three things, for every size: where each part of the layout it places stands (`t`, for every
// size and per size, as the layer's own), which of them the layout has (`shown`, and the sizes it leaves one out at,
// `hide`), and the colour block — the side it lies on, how much it takes, how its edge leans: a template and its
// adjustments, { template, adjust }, as layoutOf in layout.js answers for a profile. The block is kept as a profile
// keeps it, a default with sizes of their own over it (`by`), and a step between: each orientation's own (`orient`:
// wide, square, tall), which a size facing that way has unless it has one of its own, so a profile's sizes the preset
// never saw are laid out as those facing their way are. Nothing else: no fonts, letterings, colours or look, nor which
// way words run. A preset may keep sizes of its own too (`custom`), laid out in its editor beside the profile's; a
// profile takes of a preset its own sizes alone. Surprise me deals one by its chance (dealCover in deal.js), and one
// can be put on the canvas as it is; either way a part the user locked stays as it is, and the colour block locked
// keeps its layout too. A preset made now carries every part; one made before the colour block was a part has no
// entry for it, and a part a preset has no entry for is one it leaves as it is.
/** The layout's parts a layout preset places: those with words, the channel's graphic, and the colour block and its edge. */
export const LAYOUT_PARTS = ["title", "subtitle", "tag", "catname", "brand", "graphic", "accent"];
const clone = (v) => JSON.parse(JSON.stringify(v));
const layCopy = (lay) => ({ template: lay.template, adjust: { ...(lay.adjust || {}) } });
/**
 * Placement `t` (a channel graphic's) with its places for channel `catId` (see byKey) as the size's own, every
 * channel's own let go: where it stands on that channel's cover, for whichever channel's it is put on (a preset is for
 * every channel of every profile). A placement with no channel's own, as it is.
 */
export function plainPlaces(t, catId) {
  if (!Object.keys(t.by).some((k) => k.includes("@"))) return t;
  const by = Object.fromEntries(Object.entries(t.by).filter(([k]) => !k.includes("@")));
  for (const [k, v] of Object.entries(t.by)) { const [key, cat] = k.split("@"); if (cat && cat === catId) by[key] = v; }
  return { ...t, by };
}
/** The layout ({ template, adjust }) layout preset `p` draws the size keyed `key` in: the size's own, else its orientation's, else the preset's default. */
export function presetLayout(p, key) {
  const own = (p.by && p.by[key]) || (p.orient && p.orient[orientOfKey(key)]);
  return own ? { template: own.template, adjust: own.adjust || {} } : { template: p.template, adjust: p.adjust || {} };
}
/**
 * A new layout preset's colour block, { template, adjust, orient }: each orientation in the template BY_ORIENT gives it,
 * as the template comes — wide sizes side by side (Split), square and tall ones stacked (Stack, the default).
 */
export function newBlock() {
  const template = BY_ORIENT.square, orient = {};
  for (const o of ORIENTS) if (BY_ORIENT[o] !== template) orient[o] = { template: BY_ORIENT[o], adjust: {} };
  return { template, adjust: {}, orient };
}
/**
 * A new layout preset, as its editor starts it: the colour block of newBlock(), and every part of LAYOUT_PARTS in it,
 * shown at every size where the template puts it — the channel name and graphic too, which a new design leaves out
 * (DEFAULT_OFF), the graphic on the block.
 */
export const newPreset = () => ({ ...newBlock(), parts: Object.fromEntries(LAYOUT_PARTS.map((id) => [id, { t: newLayer(id).t, shown: true }])) });
/**
 * Changes layout preset `p`'s colour block, in place, where `scope` reaches from the size keyed `key` (see SCOPES in
 * the app): "size", that size, as its own; "orient", its orientation's own and each size's own facing that way; "all",
 * the default, each orientation's own and each size's own. `fn(lay, at, here)` makes of a layout ({ template, adjust })
 * what it becomes, and each gets it from what it had — `at` saying whose it is (a size key, an orientation, or null for
 * the default), `here` whether size `key` is drawn in it —, so a change lands on each as that one has it (moved to the
 * top, every size reached has its block on top; made bigger, each is bigger; and see sideLike and scaleBlock in
 * layout.js, for blocks that do not lie alike). What then comes to what it would have anyway (an orientation's own as
 * the default, a size's own as its orientation's) is let go.
 */
export function setPresetLayout(p, scope, key, fn) {
  const o = orientOfKey(key), by = { ...(p.by || {}) }, orient = { ...(p.orient || {}) };
  if (scope === "size") by[key] = layCopy(fn(presetLayout(p, key), key, true));
  else {
    if (scope !== "all" && !orient[o]) orient[o] = { template: p.template, adjust: p.adjust || {} };
    const mine = by[key] ? key : orient[o] ? o : null;   // what size `key` is drawn in
    for (const x of Object.keys(orient)) if (scope === "all" || x === o) orient[x] = layCopy(fn(orient[x], x, x === mine));
    for (const k of Object.keys(by)) if (scope === "all" || orientOfKey(k) === o) by[k] = layCopy(fn(by[k], k, k === mine));
    if (scope === "all") Object.assign(p, layCopy(fn({ template: p.template, adjust: p.adjust || {} }, null, mine === null)));
  }
  const base = { template: p.template, adjust: p.adjust || {} };
  for (const x of Object.keys(orient)) if (sameLayout(orient[x], base)) delete orient[x];
  for (const k of Object.keys(by)) if (sameLayout(by[k], orient[orientOfKey(k)] || base)) delete by[k];
  if (Object.keys(orient).length) p.orient = orient; else delete p.orient;
  if (Object.keys(by).length) p.by = by; else delete p.by;
}
/**
 * The parts of a layout preset as `layers` (a cover's) have them at the sizes keyed `keys`: { id: { t, shown, hide? } },
 * of the layout's own (by id: a copy is not one). A part counts as ticked where the cover has it — not left out, at
 * that size (`sizes`) —, whether its eye shows it or not (Hide layout, a part hidden by hand: still the layout's), `hide`
 * naming the sizes it is not at when it is at some; at none, it is not shown. Its places per size for `keys` alone, the
 * channel graphic's for channel `catId` (the cover's) as the size's own (plainPlaces), so the preset puts it there on
 * any channel's cover. `was`: the preset's parts before (in its editor), whose places and hiding at sizes other than
 * `keys` (another profile's) are kept.
 */
export function takeParts(layers, keys, was = null, catId = null) {
  const parts = {}, ours = (k) => keys.includes(k.split("@")[0]);
  for (const id of LAYOUT_PARTS) {
    const L = layers.find((l) => l.id === id);
    if (!L) continue;
    const t = id === "graphic" ? plainPlaces(clone(L.t), catId) : clone(L.t), at = L.off ? [] : keys.filter((k) => inSize(L, k)), before = was && was[id];
    if (!was) t.by = Object.fromEntries(Object.entries(t.by).filter(([k]) => ours(k)));
    const hide = [...(before && before.hide ? before.hide.filter((k) => !keys.includes(k)) : []), ...keys.filter((k) => !at.includes(k))];
    parts[id] = at.length ? { t, shown: true, ...(hide.length ? { hide } : {}) } : { t, shown: false };
  }
  return parts;
}
/**
 * The layout preset that `style` (a profile's) and `layers` (a cover's, of channel `catId`) make as they are at the
 * profile's sizes, keyed `keys`: { template, adjust, orient?, by?, parts } (see takeParts). The block: the profile's own
 * template and its adjustments the default; an orientation whose sizes are all drawn alike, and otherwise, has that as
 * its own (so another profile's sizes facing that way are drawn so too); else each size drawn otherwise has its own.
 */
export function takeLayout(style, layers, keys, catId = null) {
  const base = { template: style.template, adjust: { ...((style.layoutAdjust || {})[style.template] || {}) } }, orient = {}, by = {};
  for (const o of ORIENTS) {
    const ks = keys.filter((k) => orientOfKey(k) === o), lays = ks.map((k) => layoutOf(style, k));
    if (!ks.length) continue;
    if (lays.every((l) => sameLayout(l, lays[0]))) { if (!sameLayout(lays[0], base)) orient[o] = layCopy(lays[0]); }
    else ks.forEach((k, i) => { if (!sameLayout(lays[i], base)) by[k] = layCopy(lays[i]); });
  }
  return { ...base, ...(Object.keys(orient).length ? { orient } : {}), ...(Object.keys(by).length ? { by } : {}), parts: takeParts(layers, keys, null, catId) };
}
/**
 * Puts layout preset `p` (as normalizeLayouts keeps it) onto `style` and `layers` (in place), at the profile's sizes,
 * keyed `keys`, alone (a size of the preset's own the profile has not is passed by): its colour block — its default as
 * the profile's template and its adjustments (none: the template as it comes; the other templates' are left as they
 * are), each size it draws otherwise (by the size's own or its orientation's) given that as its own, and no size its own
 * besides —, and each part where the preset has it at those sizes: one it shows comes in at the sizes it does not hide
 * (see `sizes` above; one that was left out comes in shown, one hidden by its eye stays hidden), one it does not is left
 * out; a part the preset has no entry for (an earlier preset's colour block) is left as it is. A part locked stays as
 * it is — its place, whether it shows — whether the preset is dealt (as dealCover leaves a locked layer where it is) or
 * put on the canvas by hand; and the colour block locked keeps the profile's block as well (the template, its
 * adjustments, each size's own), the block being where that part stands as much as its place is.
 */
export function putLayout(style, layers, p, keys) {
  const block = layers.find((l) => l.id === "accent");
  if (!(block && block.locked)) {
    const base = { template: p.template, adjust: p.adjust || {} }, adjust = (style.layoutAdjust = style.layoutAdjust || {}), by = {};
    style.template = p.template;
    if (Object.keys(base.adjust).length) adjust[p.template] = { ...base.adjust }; else delete adjust[p.template];
    for (const k of keys) { const lay = presetLayout(p, k); if (!sameLayout(lay, base)) by[k] = layCopy(lay); }
    if (Object.keys(by).length) style.layoutBy = by; else delete style.layoutBy;
  }
  for (const [id, q] of Object.entries(p.parts || {})) {
    const L = layers.find((l) => l.id === id);
    if (!L || !LAYOUT_PARTS.includes(id) || L.locked) continue;
    L.t = { all: { ...q.t.all }, by: Object.fromEntries(Object.entries(q.t.by || {}).filter(([k]) => keys.includes(k.split("@")[0])).map(([k, v]) => [k, { ...v }])) };
    const at = q.shown ? keys.filter((k) => !(q.hide || []).includes(k)) : [];
    if (!at.length) { L.off = true; L.visible = false; } else { if (L.off) { delete L.off; L.visible = true; } keepTo(L, at, keys); }
  }
}

/** Inserts `layer` directly above the layer with id `aboveId` (or on top when there is none). */
export function insertAbove(layers, aboveId, layer) {
  const i = layers.findIndex((l) => l.id === aboveId);
  layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
  return layer;
}
/**
 * Index to move layer `id` to so that it passes the next layer (dir 1 = up, -1 = down) that is
 * part of category `catId`'s cover, stepping over the ones that are not; -1 when there is none.
 */
export function stepIndex(layers, id, dir, catId) {
  const from = layers.findIndex((l) => l.id === id);
  if (from < 1) return -1;
  for (let i = from + dir; i >= 1 && i < layers.length; i += dir) if (appliesTo(layers[i], catId)) return i;
  return -1;
}
/** Moves a layer to index `to`. The background never leaves the bottom and nothing goes below it. */
export function moveLayer(layers, id, to) {
  const from = layers.findIndex((l) => l.id === id);
  if (from < 0 || layers[from].type === "bg") return false;
  const target = Math.min(layers.length - 1, Math.max(1, to));
  if (target === from) return false;
  layers.splice(target, 0, layers.splice(from, 1)[0]);
  return true;
}
/**
 * Copies the layers the user added to `from` (another cover's layers: free ones and copies of layout ones,
 * see isAdded) into the list `into`, settings and all, each under a new id (a cut-out's link goes to its
 * photo's copy, and a cut-out's or an asset's weave to the copies of the lettering it weaves with, or the
 * layout's own; any other it lets go). Each copy goes above the built-in layer it was above there, over the layers added on it
 * there, in the order they had; one above
 * a layout layer this list has not, at the top. Returns the new list and the copies, bottom first.
 */
export function copyFreeLayers(into, from) {
  const ids = new Set(into.map((l) => l.id)), renamed = new Map(), groups = [];
  let anchor = into.length ? into[0].id : "";
  for (const l of from) {
    if (!isAdded(l)) { anchor = l.id; continue; }
    const c = JSON.parse(JSON.stringify(l));
    do c.id = uid(); while (ids.has(c.id));
    ids.add(c.id); renamed.set(l.id, c.id);
    const g = groups.at(-1);
    if (g && g.anchor === anchor) g.copies.push(c); else groups.push({ anchor, copies: [c] });
  }
  const copies = groups.flatMap((g) => g.copies);
  // a link, and the lettering a cut-out or an asset weaves with, follow the copies; the layout's own lettering is on every cover
  const to = (id) => renamed.get(id) || (BOUND_TYPES.includes(id) ? id : "");
  for (const c of copies) {
    if (c.of) c.of = renamed.get(c.of) || "";
    if (c.weave) c.weave = { ...c.weave, with: c.weave.with.map(to).filter(Boolean), front: Object.fromEntries(Object.entries(c.weave.front || {}).map(([k, v]) => [to(k), v]).filter(([k]) => k)) };
  }
  const at = (id) => {   // above the layout layer and the free layers already over it
    let i = into.findIndex((l) => l.id === id);
    if (i < 0) return into.length;
    for (i++; i < into.length && isAdded(into[i]); i++);
    return i;
  };
  const out = [...into];
  groups.map((g, n) => ({ ...g, i: at(g.anchor), n })).sort((a, b) => b.i - a.i || b.n - a.n)
    .forEach((g) => out.splice(g.i, 0, ...g.copies));
  return { layers: out, copies };
}
/**
 * The sizes what is made of layer L now (a cut-out of it, see the app) is for: those of `keys` (the sizes a scope
 * reaches, see adjust; null for every size) where L shows, or, where it shows at none of them, `keys` themselves.
 * `all`: the profile's size keys, in their order.
 */
export function sizesFor(L, keys, all) {
  const here = all.filter((k) => inSize(L, k)), want = keys ? here.filter((k) => keys.includes(k)) : here;
  return want.length ? want : keys || here;
}
/**
 * The photo a cut-out of photo L made now for the sizes of `keys` (a scope's; null for every size) is linked to (see
 * `of`): L, where it shows at any of them; else the photo of the same picture shown at the most of them — the copy
 * Remove the background left there (see cutAt), whose place the cut-out follows there, and which dragging it moves;
 * L when none is. `all`: the profile's size keys, in their order.
 */
export function cutFrom(layers, L, keys, all) {
  const at = (P) => (keys || all).filter((k) => inSize(P, k)).length;
  let best = L, most = at(L);
  if (!most) for (const P of layers) if (P.type === "photo" && !P.of && P.pid === L.pid && at(P) > most) { best = P; most = at(P); }
  return best;
}
/**
 * Removes photo L's background (its `cut`) at the sizes of `keys` (a scope's; null for every size), in `layers`, in
 * place. Where L shows at no other size, L itself is cut. Else L is left whole, still shown at its other sizes, and a
 * copy of it, cut and placed exactly as it is, shows at those (see `sizes`), what goes with L going with it there (see
 * showApart): it goes in above L and what is clipped onto L, which is copied onto it; L's linked cut-out is copied and
 * linked to it, so there the cut-out follows the photo shown and moves with it, as at the others with L. Nothing
 * changes at the other sizes. Returns the copy, or null (also when L shows at none of `keys`: then nothing is done). `all`: the
 * profile's size keys, in their order.
 */
export function cutAt(layers, L, keys, all) {
  const here = all.filter((k) => inSize(L, k)), there = keys ? here.filter((k) => keys.includes(k)) : here, rest = here.filter((k) => !there.includes(k));
  if (!rest.length) { L.cut = true; return null; }
  if (!there.length) return null;
  const c = showApart(layers, L, there, all);
  c.cut = true;
  return c;
}
/**
 * Shows layer X of `layers` (in place) at the sizes of `there` (size keys: some of those it shows at, not all) through a
 * copy of it, placed exactly as it is, X kept to the others (see `sizes`); returns the copy. What goes with X goes with
 * the copy at those sizes, as it goes with X: the layers clipped onto X (see clipBase), clipped onto the copy, which goes
 * in above them rather than between X and them, where it would take them over (hidden at the other sizes, a base hides
 * what is clipped onto it); a photo's linked cut-outs (see `of`), linked to the copy, so there they follow and are
 * moved with the photo that shows; and what goes with those in turn. Each such layer shown both at some of those sizes
 * and at another is split so too, by a copy of its own; one shown at those alone goes over whole (clipped onto the
 * copy, or linked to it), one at none of them stays as it is. A layout layer clipped onto X (the title may be) is copied
 * as a copy of it (see `copy`) but stays at every size it was at, its room being the layout's: where X is not shown, it
 * is not either, as its base is not. The weaves follow (see `weave`): a cut-out or an asset weaving with lettering so
 * split weaves with the lettering's copy too; one shown at those sizes alone with the copy instead, one kept to the
 * others with the lettering alone.
 */
function showApart(layers, X, there, all) {
  const side = new Map(), renamed = new Map();   // where each layer split shows now ("there": at those sizes alone; "rest"), and the id of each one's copy
  // layer D's part at the sizes of `there`: null where it shows at none of them (or is left out of the cover, see
  // `off`: a copy of it would come in), D itself where it shows at no other (it goes over whole), else a copy of it
  // there, D kept to the others but a layout layer
  const part = (D) => {
    const on = all.filter((k) => inSize(D, k)), to = on.filter((k) => there.includes(k)), left = on.filter((k) => !there.includes(k));
    if (!to.length || D.off) return null;
    if (!left.length) { side.set(D, "there"); return D; }
    const d = duplicate(D);
    if (!d) return null;   // the corner brackets are never copied
    d.t = clone(D.t);   // where D is (a copy is nudged, to show it is one)
    keepTo(d, to, all); side.set(d, "there"); renamed.set(D.id, d.id);
    if (!isLayout(D)) { keepTo(D, left, all); side.set(D, "rest"); }
    return d;
  };
  const x = part(X), todo = [[X, x]];
  while (todo.length) {
    const [D, d] = todo.shift(), group = [];
    if (!D.clip) {   // what is clipped onto D, onto d
      const i = layers.indexOf(D);
      for (const E of layers.slice(i + 1, clipEnd(layers, i) + 1)) {
        const e = part(E);
        if (!e) continue;
        if (e === E) layers.splice(layers.indexOf(E), 1); else todo.push([E, e]);
        group.push(e);
      }
    }
    if (!layers.includes(d)) layers.splice(clipEnd(layers, layers.indexOf(D)) + 1, 0, d, ...group);
    if (D.type !== "photo" || D.of) continue;
    for (const P of layers.filter((l) => l.type === "photo" && l.of === D.id)) {   // a photo's cut-outs, linked to d
      if (side.get(P) === "rest") continue;   // split already, clipped onto D
      const p = side.get(P) === "there" ? P : part(P);
      if (!p) continue;
      p.of = d.id;
      if (p !== P) todo.push([P, p]);
    }
  }
  for (const W of layers) {
    const w = W.weave;
    if (!w || !w.with.some((id) => renamed.has(id))) continue;
    const s = side.get(W), to = (id) => (!renamed.has(id) ? [id] : s === "there" ? [renamed.get(id)] : s === "rest" ? [id] : [id, renamed.get(id)]);
    W.weave = { ...w, with: w.with.flatMap(to), front: Object.fromEntries(Object.entries(w.front || {}).flatMap(([id, keys]) => to(id).map((k) => [k, [...keys]]))) };
  }
  return x;
}
/**
 * Copy of a free layer, or of a layout layer but the ground and the corner brackets (a copy of it, see `copy`
 * above; one of a layer left out of the cover comes in), nudged so it is visibly a new one.
 */
export function duplicate(layer) {
  if (!isFree(layer.type) && !COPYABLE.includes(layer.type)) return null;
  const c = JSON.parse(JSON.stringify(layer));
  c.id = uid(); c.t.all.x += 0.03; c.t.all.y += 0.03;
  if (!isFree(layer.type)) { c.copy = true; if (c.off) { delete c.off; c.visible = true; } }
  return c;
}
