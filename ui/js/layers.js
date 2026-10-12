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
//   t.by   optional per-size fine-tuning in virtual pixels, keyed by "1920x1080". The category
//          graphic may also be tuned per category, keyed by "1920x1080@<category id>".

export const BOUND_TYPES = ["bg", "accent", "graphic", "brand", "title", "tag", "catname", "frame"];
export const FREE_TYPES = ["asset", "text"];
/** Shapes the colour block and its dividing edge can take ("slant" is the template's own). */
export const ACCENT_SHAPES = ["slant", "flat", "reverse", "zigzag", "wave", "steps", "torn", "chevron", "scallop", "double", "stripes"];
export const isFree = (type) => FREE_TYPES.includes(type);
/** Layers that can be grabbed on the canvas (the others are selected from the layer list only). */
export const isPickable = (layer) => layer.visible && !layer.locked && layer.type !== "accent" && layer.type !== "frame";

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
const IDENTITY_BY = { dx: 0, dy: 0, s: 1, r: 0 };

export function newLayer(type, extra = {}) {
  const free = isFree(type);
  return {
    id: free ? uid() : type, type, visible: true, locked: false, o: 1,
    t: { all: free ? { x: 0.5, y: 0.42, s: 0.35, r: 0 } : { x: 0, y: 0, s: 1, r: 0 }, by: {} },
    ...PROPS[type], ...extra,
  };
}
export const defaultLayers = () => BOUND_TYPES.map((type) => newLayer(type));

function normalizeT(raw, free) {
  const a = (raw && raw.all) || {}, by = {};
  for (const [k, v] of Object.entries((raw && raw.by) || {})) {
    if (!v || typeof v !== "object") continue;
    const e = { dx: num(v.dx, 0, -9000, 9000), dy: num(v.dy, 0, -9000, 9000), s: num(v.s, 1, 0.05, 20), r: num(v.r, 0, -360, 360) };
    if (e.dx || e.dy || e.s !== 1 || e.r) by[k] = e;
  }
  return { all: { x: num(a.x, free ? 0.5 : 0, -3, 3), y: num(a.y, free ? 0.42 : 0, -3, 3), s: num(a.s, free ? 0.35 : 1, 0.02, 20), r: num(a.r, 0, -360, 360) }, by };
}
function normalizeLayer(raw) {
  if (!raw || typeof raw !== "object" || !(raw.type in PROPS)) return null;
  const free = isFree(raw.type), base = newLayer(raw.type);
  const L = { ...base, id: free ? (typeof raw.id === "string" && raw.id ? raw.id : base.id) : raw.type,
    visible: raw.visible !== false, locked: raw.locked === true, o: num(raw.o, 1, 0, 1), t: normalizeT(raw.t, free) };
  if (typeof raw.name === "string" && raw.name) L.name = raw.name.slice(0, 60);
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
 * makes ids unique.
 */
export function normalizeLayers(raw) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const L = normalizeLayer(r);
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
 */
export function resolve(layer, vw, vh, key, catId) {
  const a = layer.t.all, b = layer.t.by[byKey(layer, key, catId)] || IDENTITY_BY;
  const r = a.r + b.r;
  if (isFree(layer.type)) return { cx: a.x * vw + b.dx, cy: a.y * vh + b.dy, s: a.s * b.s * (Math.min(vw, vh) / 1080), r };
  return { dx: a.x * vw + b.dx, dy: a.y * vh + b.dy, s: a.s * b.s, r };
}

/**
 * Applies an edit. scope "all" changes every size (fractions); scope "size" changes only `key`.
 * patch: {ddx, ddy} move in virtual px, {scale} multiply, {rot} add degrees.
 */
export function adjust(layer, { vw, vh, key, catId }, scope, patch) {
  const lim = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (scope === "all") {
    const a = layer.t.all;
    if (patch.ddx) a.x = lim(a.x + patch.ddx / vw, -3, 3);
    if (patch.ddy) a.y = lim(a.y + patch.ddy / vh, -3, 3);
    if (patch.scale) a.s = lim(a.s * patch.scale, 0.02, 20);
    if (patch.rot) a.r = lim(a.r + patch.rot, -360, 360);
    return;
  }
  const k = writeKey(layer, key, catId);
  // start a category-specific entry from the size-wide one so the graphic does not jump
  const b = (layer.t.by[k] = { ...(layer.t.by[k] || layer.t.by[key] || IDENTITY_BY) });
  if (patch.ddx) b.dx += patch.ddx;
  if (patch.ddy) b.dy += patch.ddy;
  if (patch.scale) b.s = lim(b.s * patch.scale, 0.05, 20);
  if (patch.rot) b.r = lim(b.r + patch.rot, -360, 360);
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
