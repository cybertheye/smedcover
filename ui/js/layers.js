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

export const BOUND_TYPES = ["bg", "accent", "graphic", "brand", "title", "tag", "catname", "frame"];
export const FREE_TYPES = ["asset", "text"];
/** Shapes the colour block and its dividing edge can take ("slant" is the template's own). */
export const ACCENT_SHAPES = ["slant", "flat", "reverse", "zigzag", "wave", "steps", "torn", "chevron", "scallop", "double", "stripes", "arc"];
/** The text effects a headline can be given (painted in textfx.js). Absent on a layer means "auto": the look decides. */
export const TEXT_EFFECTS = ["auto", "cel", "cyber", "riso", "anime", "bluenote", "editorial", "dots", "stripes", "inner", "worn", "rows", "extrude", "arc", "taper", "wave"];
/** Layers made of words. Each may carry `ink`, its own colour; the title also `hi`, for highlighted words. */
export const LETTERED = ["title", "tag", "catname", "brand", "text"];
export const isFree = (type) => FREE_TYPES.includes(type);
/** Layers that can be grabbed on the canvas (the others are selected from the layer list only). */
/** Whether a layer is part of the cover of category `catId`. */
export const appliesTo = (layer, catId) => !layer.cats || layer.cats.includes(catId);
export const isPickable = (layer) => layer.visible && !layer.locked && layer.type !== "frame";

const PROPS = {
  bg: { grid: true, blur: 0, dim: 0 },
  accent: { shape: "slant" },
  graphic: {},
  brand: { rail: true },
  title: { align: "left", stroke: 1, shadow: 1 },
  tag: {},
  catname: { showName: true, plate: true },
  frame: {},
  asset: { ref: null, tint: false },
  text: { text: "", look: "title", color: "white" },
};
const LOOKS = ["title", "plain", "plate"], COLORS = ["white", "accent", "ink"];

const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : d);
const uid = () => "l" + Math.random().toString(36).slice(2, 9);
const IDENTITY_BY = { dx: 0, dy: 0, s: 1, r: 0, kx: 1, ky: 1 };

export function newLayer(type, extra = {}) {
  const free = isFree(type);
  return {
    id: free ? uid() : type, type, visible: true, locked: false, o: 1,
    t: { all: free ? { x: 0.5, y: 0.42, s: 0.35, r: 0, kx: 1, ky: 1 } : { x: 0, y: 0, s: 1, r: 0, kx: 1, ky: 1 }, by: {} },
    ...PROPS[type], ...extra,
  };
}
export const defaultLayers = () => BOUND_TYPES.map((type) => newLayer(type));

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
  // a headline may be given a text effect of its own, and a strength for it
  if (raw.type === "title" || raw.type === "text") {
    if (TEXT_EFFECTS.includes(raw.fx) && raw.fx !== "auto") L.fx = raw.fx;
    if (raw.fxAmt !== undefined && num(raw.fxAmt, 1, 0, 2) !== 1) L.fxAmt = num(raw.fxAmt, 1, 0, 2);
  }
  // lettering may be given its own colour; without one it takes whatever the look gives it
  if (LETTERED.includes(raw.type)) for (const k of raw.type === "title" ? ["ink", "hi"] : ["ink"]) if (typeof raw[k] === "string" && /^#[0-9a-f]{6}$/i.test(raw[k])) L[k] = raw[k].toLowerCase();
  if (free && Array.isArray(raw.cats)) {   // a layer whose categories are all gone goes with them
    const cats = [...new Set(raw.cats.filter((x) => typeof x === "string" && x && (!catIds || catIds.includes(x))))];
    if (!cats.length) return null;
    L.cats = cats;
  }
  switch (raw.type) {
    case "bg": L.grid = raw.grid !== false; L.blur = num(raw.blur, 0, 0, 80); L.dim = num(raw.dim, 0, 0, 0.9); break;
    case "accent": L.shape = ACCENT_SHAPES.includes(raw.shape) ? raw.shape : "slant"; break;
    case "brand": L.rail = raw.rail !== false; break;
    case "title": L.align = raw.align === "center" ? "center" : "left"; L.stroke = num(raw.stroke, 1, 0, 2); L.shadow = num(raw.shadow, 1, 0, 2); break;
    case "catname": L.showName = raw.showName !== false; L.plate = raw.plate !== false; break;
    case "asset": {
      const r = raw.ref;
      if (!r || !["graphic", "sticker", "user"].includes(r.kind) || typeof r.id !== "string") return null;
      L.ref = { kind: r.kind, id: r.id }; L.tint = raw.tint === true; break;
    }
    case "text": L.text = typeof raw.text === "string" ? raw.text : ""; L.look = LOOKS.includes(raw.look) ? raw.look : "title"; L.color = COLORS.includes(raw.color) ? raw.color : "white"; break;
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
    // insert after the nearest earlier bound layer that is present
    let at = 0;
    for (let j = i - 1; j >= 0; j--) { const k = out.findIndex((l) => l.id === BOUND_TYPES[j]); if (k >= 0) { at = k + 1; break; } }
    out.splice(at, 0, newLayer(type));
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
 * Bound layers: {dx, dy} offset from the template position, s scale multiplier, r degrees.
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
/** Copy of a free layer, nudged so it is visibly a new one. */
export function duplicate(layer) {
  if (!isFree(layer.type)) return null;
  const c = JSON.parse(JSON.stringify(layer));
  c.id = uid(); c.t.all.x += 0.03; c.t.all.y += 0.03;
  return c;
}
