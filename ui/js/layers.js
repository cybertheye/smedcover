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
/** Moves a look's scene object by (dx, dy), fractions of the canvas: for every size (scope "all") or this one ("size"). */
export function moveScene(cover, look, key, scope, sizeKey, dx, dy) {
  const objs = ((cover.scene = cover.scene || {})[look] = cover.scene[look] || {}), v = (objs[key] = objs[key] || {});
  if (scope === "size") { const by = (v.by = v.by || {}), b = by[sizeKey] || [0, 0]; by[sizeKey] = offset([b[0] + dx, b[1] + dy]); }
  else { const a = v.all || [0, 0]; v.all = offset([a[0] + dx, a[1] + dy]); }
  cover.scene = normalizeScene(cover.scene);
}
/** Puts a look's scene object (or all of them, key null) back where the layout puts it: for every size, or this one. */
export function resetScene(cover, look, key, scope, sizeKey) {
  const objs = cover.scene && cover.scene[look];
  if (!objs) return;
  for (const k of key ? [key] : Object.keys(objs)) {
    if (!objs[k]) continue;
    if (scope === "size") { if (objs[k].by) delete objs[k].by[sizeKey]; } else delete objs[k];
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
// their looks have post effects doing what they did (see elementFx in style.js). A text layer that
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
  asset: { ref: null, tint: false },   // + `ink`: a colour of the user's for a vector asset, over its own and the channel's; + `crop`, as a photo's
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
   * + `weave`: a cut-out woven with lettering below it, as a magazine's subject is with its masthead (see
   * normalizeWeave): {with, by, line, front}. `with`: the ids of the lettering layers it weaves with (the title,
   * the subtitle, text, copies of the first two); `by` "head": its head in front of them and the rest of it
   * behind, the head ending at `line` (a share of the height of the box round its subject, from its top, in the
   * photo's own frame, so it turns and scales with it); `by` "letters": the letters chosen in front of it, the
   * others behind (`front`: by layer id, their letterKeys, see ransom.js); `by` "brush": the lettering in front
   * where it was painted so, behind elsewhere (`strokes`, [{front, r, pts}] in order, in the photo's own frame:
   * see normalizeWeave). Each way keeps its data while another is chosen. Only a cut-out is woven; a whole photo
   * again keeps it, for when it is cut out once more.
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
function normalizeLayer(raw, catIds) {
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
  // structure, which Surprise me never deals on its own; a layout preset it deals brings its own (see putLayout below,
  // and columned in style.js)
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
/** A photo's crop (see PROPS.photo), at least 2% of the picture each way, within it; null for none, or the whole picture. */
export function normalizeCrop(c) {
  if (!c || typeof c !== "object") return null;
  const r = (v) => Math.round(v * 1e4) / 1e4, x = r(num(c.x, 0, 0, 0.98)), y = r(num(c.y, 0, 0, 0.98)), w = Math.min(r(num(c.w, 1, 0.02, 1)), r(1 - x)), h = Math.min(r(num(c.h, 1, 0.02, 1)), r(1 - y));
  return x > 1e-4 || y > 1e-4 || w < 0.9999 || h < 0.9999 ? { x, y, w, h } : null;
}
/**
 * How many layers a cut-out weaves with at most, and how many letters of each it puts in front; how many brush
 * strokes it keeps, points a stroke and points in all (see normalizeWeave).
 */
export const WEAVE_MAX = { with: 24, front: 400, strokes: 300, points: 2000, total: 12000 };
/** A brush stroke's radius, in shares of the photo's longer side: the least and the most kept (see normalizeWeave). */
export const BRUSH_R = [0.001, 0.5];
/** The ways a cut-out weaves (see `weave` in PROPS.photo); the first when none is given. */
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
 * painted on), nor does a new picture put in its place. At most 300 strokes, 2000 points a stroke and 12000 in all,
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
/** Where a woven cut-out's head ends (see `weave`): `line` of the way down `box`, the box round its subject ({y0, y1}, fractions of the photo), as a fraction of the photo's height. */
export const headLine = (box, line) => box.y0 + Math.min(0.9, Math.max(0.1, line)) * (box.y1 - box.y0);
/** The layers a cut-out at index i of `layers` may weave with (see `weave`): the headline layers below it, bottom first. */
export const weavable = (layers, i) => layers.slice(0, Math.max(0, i)).filter((l) => HEADLINES.includes(l.type));
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
 * Repairs a layer list: drops unknown layers, guarantees each bound layer exists exactly once
 * (missing ones are put back in their default place), keeps the background at the bottom and
 * makes ids unique. With `catIds` (the categories that exist), layers made for categories that
 * were removed are dropped too.
 */
export function normalizeLayers(raw, catIds) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const L = normalizeLayer(r, catIds);
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
 * Applies an edit. scope "all" changes every size (fractions); scope "size" changes only `key`.
 * patch: {ddx, ddy} move in virtual px, {scale} multiply, {kx, ky} stretch (multiply), {rot} add degrees.
 */
export function adjust(layer, { vw, vh, key, catId }, scope, patch) {
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
  const k = writeKey(layer, key, catId);
  // start a category-specific entry from the size-wide one so the graphic does not jump
  const b = (layer.t.by[k] = { ...(layer.t.by[k] || layer.t.by[key] || IDENTITY_BY) });
  if (patch.ddx) b.dx += patch.ddx;
  if (patch.ddy) b.dy += patch.ddy;
  if (patch.scale) b.s = lim(b.s * patch.scale, 0.05, 20);
  if (patch.rot) b.r = lim(b.r + patch.rot, -360, 360);
  if (patch.kx) b.kx = lim(b.kx * patch.kx, 0.05, 20);
  if (patch.ky) b.ky = lim(b.ky * patch.ky, 0.05, 20);
}
/** Clears placement edits: scope "size" drops this size's fine-tuning, "all" restores the default. */
export function resetPlacement(layer, scope, key, catId) {
  if (scope === "size") { delete layer.t.by[key]; if (catId) delete layer.t.by[`${key}@${catId}`]; return; }
  layer.t = newLayer(layer.type).t;
}

// ---------- layout presets: a cover's structure without its look (kept in the settings, see normalizeLayouts in store.js)
// A layout preset holds the template and its adjustments (a profile's style.template and style.layoutAdjust of it), and
// of the layout's own parts that carry words or the channel's graphic: where each stands (`t`, for every size and
// per size), whether the cover has it (`shown`: not left out, see `off` above), and for lettering which way its words
// run (`vertical` and `rules`, kept only when true). Fonts, letterings, colours and the look are not in it.
// Surprise me deals one by its chance (dealCover in deal.js), and one can be put on the canvas as it is; either way a
// part the user locked stays as it is.
/** The layout's parts a layout preset holds. */
export const LAYOUT_PARTS = ["title", "subtitle", "tag", "catname", "brand", "graphic"];
/** Which way a lettered part's words run, carried by a preset when it is so: in columns, and the rules between them. */
export const LAYOUT_RUNS = ["vertical", "rules"];
const clone = (v) => JSON.parse(JSON.stringify(v));
/**
 * The layout preset that `style` (a profile's) and `layers` (a cover's) make as they are: { template, adjust, parts:
 * { id: { t, shown, vertical?, rules? } } }, of the parts the layers have (the layout's own, by id: a copy is not one),
 * a way of running only where the words run so (true; a way they do not run is left out).
 */
export function takeLayout(style, layers) {
  const parts = {};
  for (const id of LAYOUT_PARTS) {
    const L = layers.find((l) => l.id === id);
    if (!L) continue;
    const q = { t: clone(L.t), shown: !L.off };
    for (const k of LAYOUT_RUNS) if (L[k] === true) q[k] = true;
    parts[id] = q;
  }
  return { template: style.template, adjust: { ...((style.layoutAdjust || {})[style.template] || {}) }, parts };
}
/**
 * Puts layout preset `p` (as takeLayout makes it) onto `style` and `layers` (in place): its template, with its
 * adjustments (none: the template as it comes; the other templates' are left as they are), and each part it holds
 * where it has it, on the cover or left out (one that comes back comes in shown, as Layout parts brings it; one
 * hidden by hand and kept on stays hidden), its words running as they do there (a way the preset has not is taken
 * off). A part locked stays as it is — its place, whether it shows, which way its words run — whether the preset is
 * dealt (as dealCover leaves a locked layer where it is) or put on the canvas by hand; the template, the profile's
 * and no layer's, goes on all the same.
 */
export function putLayout(style, layers, p) {
  style.template = p.template;
  const adjust = (style.layoutAdjust = style.layoutAdjust || {});
  if (p.adjust && Object.keys(p.adjust).length) adjust[p.template] = { ...p.adjust }; else delete adjust[p.template];
  for (const [id, q] of Object.entries(p.parts || {})) {
    const L = layers.find((l) => l.id === id);
    if (!L || !LAYOUT_PARTS.includes(id) || L.locked) continue;
    L.t = clone(q.t);
    if (!q.shown) { L.off = true; L.visible = false; } else if (L.off) { delete L.off; L.visible = true; }
    if (LETTERED.includes(L.type)) for (const k of LAYOUT_RUNS) L[k] = q[k] === true;   // a way the preset's words do not run is taken off
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
 * photo's copy, and its weave to the copies of the lettering it weaves with, or the layout's own; any other
 * it lets go). Each copy goes above the built-in layer it was above there, over the layers added on it
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
  // a link, and the lettering a cut-out weaves with, follow the copies; the layout's own lettering is on every cover
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
