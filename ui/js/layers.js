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
// A free layer may also be clipped (`clip: true`): it then shows only within the shape of the layer
// below it — the nearest one not itself clipped, its *base* (see clipBase) — as a clipping mask does:
// a photo inside the title's letters, a colour inside a silhouette. The base can be any layer but the
// ground.

// the layout layers, bottom first: in the layer list, from the top, corner brackets, title, brand logo,
// brand row, tag, channel name, channel graphic, colour block, background
export const BOUND_TYPES = ["bg", "accent", "graphic", "catname", "tag", "brand", "logo", "title", "frame"];
/** The layout layers a new design leaves out of the cover (see `off` above): ticked in Cover → Layout parts, they come in. */
export const DEFAULT_OFF = ["catname", "graphic"];
/**
 * Their order before (bottom first), which a design or cover the user never re-ordered still has: see
 * reorderLayout. (Files from before the logo get it put in above the brand row as they are read.)
 */
const OLD_ORDER = ["bg", "accent", "graphic", "brand", "logo", "title", "tag", "catname", "frame"];
/** The layout layers' types in `layers`, bottom first. */
export const layoutOrder = (layers) => layers.filter((l) => BOUND_TYPES.includes(l.type)).map((l) => l.type);
/**
 * Puts the layout layers of `layers` (in place) in the order `types` (all of BOUND_TYPES, bottom first,
 * the ground first), each layer the user added going with the layout layer it lies directly above (so
 * text over the title stays over it). Returns whether anything moved.
 */
export function orderLayout(layers, types) {
  const bound = layers.filter((l) => BOUND_TYPES.includes(l.type));
  if (types[0] !== "bg" || types.length !== bound.length || !bound.every((l) => types.includes(l.type)) || layoutOrder(layers).join() === types.join()) return false;
  const above = new Map(), lead = [];
  let under = null;
  for (const l of layers) { if (BOUND_TYPES.includes(l.type)) above.set((under = l.type), []); else (under ? above.get(under) : lead).push(l); }
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
/** Layers the user can delete: the free ones. */
export const isRemovable = (type) => FREE_TYPES.includes(type) || LEGACY_TYPES.includes(type);
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
export const TEXT_EFFECTS = ["auto", "cel", "plain", "cyber", "riso", "anime", "bluenote", "editorial", "vivid", "dots", "stripes", "inner", "worn", "rows", "extrude", "arc", "taper", "wave"];
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
 * (`hiPlate`) and their colour `hiPlateInk`, and a text effect.
 */
export const LETTERED = ["title", "tag", "catname", "brand", "text"];
export const isFree = (type) => FREE_TYPES.includes(type);
/** The headline layers: the title, and text the user adds (which only differs in carrying its words). */
export const HEADLINES = ["title", "text"];
/** Layers that can be grabbed on the canvas (the others are selected from the layer list only). */
/** Whether a layer is part of the cover of category `catId`. */
export const appliesTo = (layer, catId) => !layer.cats || layer.cats.includes(catId);
export const isPickable = (layer) => layer.visible && !layer.locked && layer.type !== "frame";

const PROPS = {
  bg: { grid: true, blur: 0, dim: 0 },
  accent: { shape: "slant" },
  graphic: {},
  brand: { rail: true },
  logo: {},   // the profile's brand logo (brand.logo), at the right end of the brand row
  title: { stroke: 1, shadow: 1, plate: false },
  tag: {},
  catname: { showName: true, plate: true },
  frame: {},
  asset: { ref: null, tint: false },   // + `ink`: a colour of the user's for a vector asset, over its own and the channel's
  /** A block of one colour, the canvas's size at scale 1 (so it can be a ground, or moved and shrunk into a band). */
  solid: { color: "#ffd60a" },
  text: { text: "", stroke: 1, shadow: 1, plate: false },
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
   * of torn paper. + `ink`, the outline's colour.
   */
  photo: { pid: "", of: "", fill: false, blur: 0, dim: 0, treat: true, cut: false, feather: 0, spread: 0, outline: 0, torn: false, shadow: 0 },
};
/** The layers that may carry the looks' effects (see FX_TYPES in style.js for those the effects are open to so far). */
const FX_LAYERS = ["text", "asset", "photo", "solid", "title"];
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

function normalizeT(raw, free) {
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
  const free = isFree(raw.type), base = newLayer(raw.type);
  const L = { ...base, id: free ? (typeof raw.id === "string" && raw.id ? raw.id : base.id) : raw.type,
    visible: raw.visible !== false, locked: raw.locked === true, o: num(raw.o, 1, 0, 1), t: normalizeT(raw.t, free) };
  if (typeof raw.name === "string" && raw.name) L.name = raw.name.slice(0, 60);
  let lettered = null;
  // a headline may be given a text effect of its own, and a strength for it
  if (raw.type === "title" || raw.type === "text") {
    const fx = raw.fx === "ghibli" ? "vivid" : raw.fx;   // the vivid look's lettering had another name for a day
    if (raw.type === "text" && LETTERINGS[fx]) lettered = LETTERINGS[fx];
    else if (raw.type === "text" && (!fx || fx === "auto") && raw.lookFx && Number(raw.lookFx["editorial.underline"]) > 0) L.fx = "editorial";
    else if (TEXT_EFFECTS.includes(fx) && fx !== "auto") L.fx = fx;
    if (!lettered && raw.fxAmt !== undefined && num(raw.fxAmt, 1, 0, 2) !== 1) L.fxAmt = num(raw.fxAmt, 1, 0, 2);
    // the perspective's own corners: four [dx, dy] in block widths and heights
    if (Array.isArray(raw.warp) && raw.warp.length === 4 && raw.warp.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => Number.isFinite(Number(v)))))
      L.warp = raw.warp.map((p) => p.map((v) => num(v, 0, -1.5, 1.5)));
  }
  // lettering may be set in a font of its own; without one it takes the look's
  if (LETTERED.includes(raw.type) && typeof raw.font === "string" && raw.font.trim()) L.font = raw.font.trim().replace(/["\\;{}<>]/g, "").slice(0, 80);
  // lettering may be given its own colour; without one it takes whatever the look gives it
  if (LETTERED.includes(raw.type)) for (const k of HEADLINES.includes(raw.type) ? ["ink", "hi", "plateInk", "hiPlateInk"] : ["ink"]) if (typeof raw[k] === "string" && /^#[0-9a-f]{6}$/i.test(raw[k])) L[k] = raw[k].toLowerCase();
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
  if (!free && raw.type !== "bg" && raw.off === true) { L.off = true; L.visible = false; }   // a layout layer this cover leaves out (see `off` above)
  if (free && Array.isArray(raw.cats)) {   // a layer whose categories are all gone goes with them
    const cats = [...new Set(raw.cats.filter((x) => typeof x === "string" && x && (!catIds || catIds.includes(x))))];
    if (!cats.length) return null;
    L.cats = cats;
  }
  switch (raw.type) {
    case "bg": L.grid = raw.grid !== false; L.blur = num(raw.blur, 0, 0, 80); L.dim = num(raw.dim, 0, 0, 0.9); break;
    case "accent": L.shape = ACCENT_SHAPES.includes(raw.shape) ? raw.shape : "slant"; break;
    case "brand": L.rail = raw.rail !== false; break;
    case "title": L.stroke = num(raw.stroke, 1, 0, 2); L.shadow = num(raw.shadow, 1, 0, 2); L.plate = raw.plate === true; if (raw.hiPlate === true) L.hiPlate = true; break;
    case "catname": L.showName = raw.showName !== false; L.plate = raw.plate !== false; break;
    case "photo": {
      const id = (v) => (typeof v === "string" ? v.replace(/[^\w-]/g, "").slice(0, 40) : "");
      L.pid = id(raw.pid); L.of = id(raw.of); L.fill = raw.fill === true; L.treat = raw.treat !== false; L.cut = raw.cut === true;
      L.blur = num(raw.blur, 0, 0, 80); L.dim = num(raw.dim, 0, 0, 0.9); L.outline = num(raw.outline, 0, 0, 60); L.torn = raw.torn === true; L.shadow = num(raw.shadow, 0, 0, 1);
      L.feather = num(raw.feather, 0, 0, 60); L.spread = num(raw.spread, 0, 0, 60);
      if (L.of && raw.own === true) L.own = true;
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
      if (typeof raw.ink === "string" && /^#[0-9a-f]{6}$/i.test(raw.ink)) L.ink = raw.ink.toLowerCase();
      break;
    }
    case "solid": L.color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color.toLowerCase() : "#ffd60a"; break;
    case "text": {
      L.text = typeof raw.text === "string" ? raw.text : "";
      L.plate = raw.plate === true || raw.look === "plate";
      if (raw.hiPlate === true) L.hiPlate = true;   // a plate under each highlighted word
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
    if (seen.has(L.id)) { if (!isFree(L.type)) continue; L.id = uid(); }
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
 * Copies the free layers of `from` (another cover's layers) into the list `into`, settings and all,
 * each under a new id (a cut-out's link goes to its photo's copy). Each copy goes above the built-in
 * layer it was above there, over the free layers already on it there, in the order they had; one above
 * a layout layer this list has not, at the top. Returns the new list and the copies, bottom first.
 */
export function copyFreeLayers(into, from) {
  const ids = new Set(into.map((l) => l.id)), renamed = new Map(), groups = [];
  let anchor = into.length ? into[0].id : "";
  for (const l of from) {
    if (!isFree(l.type)) { anchor = l.id; continue; }
    const c = JSON.parse(JSON.stringify(l));
    do c.id = uid(); while (ids.has(c.id));
    ids.add(c.id); renamed.set(l.id, c.id);
    const g = groups.at(-1);
    if (g && g.anchor === anchor) g.copies.push(c); else groups.push({ anchor, copies: [c] });
  }
  const copies = groups.flatMap((g) => g.copies);
  for (const c of copies) if (c.of) c.of = renamed.get(c.of) || "";
  const at = (id) => {   // above the layout layer and the free layers already over it
    let i = into.findIndex((l) => l.id === id);
    if (i < 0) return into.length;
    for (i++; i < into.length && isFree(into[i].type); i++);
    return i;
  };
  const out = [...into];
  groups.map((g, n) => ({ ...g, i: at(g.anchor), n })).sort((a, b) => b.i - a.i || b.n - a.n)
    .forEach((g) => out.splice(g.i, 0, ...g.copies));
  return { layers: out, copies };
}
/** Copy of a free layer, nudged so it is visibly a new one. */
export function duplicate(layer) {
  if (!isFree(layer.type)) return null;
  const c = JSON.parse(JSON.stringify(layer));
  c.id = uid(); c.t.all.x += 0.03; c.t.all.y += 0.03;
  return c;
}
