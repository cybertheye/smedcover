// Data model and persistence.
//
//   profile  a brand: name, categories, style, fonts, output sizes, and its default layer stack
//   cover    the cover being edited: category, title, subtitle, tag, and its own working copy of the layers
//   assets   pictures the user uploaded (shared by all profiles)
//   settings app-level preferences: language, active profile, export options
//
// In the desktop app everything lives in the app data directory (through the Rust side); when the
// page is opened in a plain browser it falls back to localStorage so the UI can still be developed.
import { SIZE_PRESETS } from "./presets.js";
import { platformsFor, ratioOf } from "./platforms.js";
import { TEMPLATES, LAYOUT_LIMITS } from "./layout.js";
import { LOOK_IDS, lookParams } from "./style.js";
import { normalizeLayers, normalizeScene } from "./layers.js";

const T = globalThis.__TAURI__;
export const native = !!T;
export const invoke = (cmd, args, options) => T.core.invoke(cmd, args, options);

const LS = "smedcover:";
export const files = native
  ? {
      read: (path) => invoke("app_read", { path }),
      write: (path, data) => invoke("app_write", { path, data }),
      list: (dir) => invoke("app_list", { dir }),
      remove: (path) => invoke("app_delete", { path }),
    }
  : {
      read: async (path) => localStorage.getItem(LS + path),
      write: async (path, data) => { try { localStorage.setItem(LS + path, data); } catch (e) { /* quota: ignore in browser mode */ } },
      list: async (dir) => Object.keys(localStorage).filter((k) => k.startsWith(LS + dir + "/")).map((k) => k.slice(LS.length + dir.length + 1)),
      remove: async (path) => localStorage.removeItem(LS + path),
    };

export const uid = () => Math.random().toString(36).slice(2, 10);
const str = (v, d = "") => (typeof v === "string" ? v : d);
const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : d);
const color = (v) => (/^#[0-9a-f]{6}$/i.test(str(v)) ? v.toLowerCase() : "#fcee0a");

export const DEFAULT_STYLE = { template: "stack", theme: "dark", look: "cel", lookParams: {}, lookSeed: 7, layoutAdjust: {} };
/** Looks that are gone, and what a profile that used one gets instead: its first name, or the nearest look left. */
const RETIRED = { ghibli: "vivid", bluetone: "cyano", redstreet: "negative", gilded: "glass" };

const KINDS = ["graphic", "sticker", "user"];
/** A category's graphic: a reference into the asset library, or none. Older shapes are upgraded. */
function normalizeGraphic(g) {
  if (!g || typeof g !== "object") return { kind: "none" };
  const extra = { labels: Array.isArray(g.labels) ? g.labels.map(String).slice(0, 4) : [], stamp: str(g.stamp) };
  if (g.type === "builtin") return { kind: "graphic", id: str(g.id, "camera"), ...extra };   // v1
  if (KINDS.includes(g.kind) && str(g.id)) return { kind: g.kind, id: g.id, ...extra };
  return { kind: "none" };
}
/** An output size. `label` is the description a preset of before gave it ("4:5 · Instagram"); `name` is what the user calls it. */
export const normalizeSize = (s) => ({ w: Math.round(num(s && s.w, 1920, 64, 8192)), h: Math.round(num(s && s.h, 1080, 64, 8192)), label: str(s && s.label), name: str(s && s.name).trim().slice(0, 40) });

/** Aspect ratio as text: "16:9" when it reduces to small numbers, otherwise relative to 1 ("2.35:1", "1:1.25"). */
export function ratioText(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a), g = gcd(w, h), a = w / g, b = h / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  const r = (x) => String(Math.round(x * 100) / 100);
  return w >= h ? `${r(w / h)}:1` : `1:${r(h / w)}`;
}
/**
 * Short caption for a size: the user's name if any, else the platforms its ratio is for and the ratio
 * ("B站 / YouTube · 16:9", see platformsFor), else the description it came with, else just the ratio. No pixels.
 */
export function sizeCaption(s, lang = "zh") {
  if (s.name) return s.name;
  const on = platformsFor(s.w, s.h, lang);
  return on.length ? `${on.join(" / ")} · ${ratioOf(s.w, s.h)}` : s.label || ratioText(s.w, s.h);
}

/** Fills in defaults and drops anything malformed, so files from disk (or other people) are safe to use. */
export function normalizeProfile(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const seen = new Set();
  const categories = (Array.isArray(p.categories) ? p.categories : []).filter((c) => c && typeof c === "object").map((c) => {
    let id = str(c.id) || uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    return { id, name: str(c.name), sub: str(c.sub), code: str(c.code), color: color(c.color), graphic: normalizeGraphic(c.graphic) };
  });
  if (!categories.length) categories.push({ id: uid(), name: "Category", sub: "", code: "", color: "#fcee0a", graphic: { kind: "graphic", id: "camera", labels: [], stamp: "" } });
  const st = p.style && typeof p.style === "object" ? p.style : {};
  const style = { template: TEMPLATES.includes(st.template) ? st.template : "stack", theme: st.theme === "light" ? "light" : "dark",
    look: LOOK_IDS.includes(st.look) ? st.look : RETIRED[st.look] || "cel", lookParams: {},
    lookSeed: Number.isFinite(st.lookSeed) ? Math.abs(Math.round(st.lookSeed)) % 1000000 : 7 };   // places what a look scatters at random
  // what the user changed about each template: only the settings that differ from the template's own
  style.layoutAdjust = {};
  for (const tpl of TEMPLATES) {
    const raw = (st.layoutAdjust && st.layoutAdjust[tpl]) || {}, a = {};
    for (const k of Object.keys(LAYOUT_LIMITS)) if (Number.isFinite(raw[k])) a[k] = Math.min(LAYOUT_LIMITS[k][1], Math.max(LAYOUT_LIMITS[k][0], raw[k]));
    if (raw.flip === true) a.flip = true;
    if (Object.keys(a).length) style.layoutAdjust[tpl] = a;
  }
  // tuned values are kept per look, so switching away and back loses nothing
  for (const id of LOOK_IDS) { const v = lookParams(id, st.lookParams && st.lookParams[id]); if (Object.keys(v).length) style.lookParams[id] = v; }
  let sizes = (Array.isArray(p.sizes) ? p.sizes : []).map(normalizeSize);
  if (!sizes.length) sizes = SIZE_PRESETS.filter((s) => s.on).map(({ w, h }) => ({ w, h, label: "", name: "" }));
  const keys = new Set();
  sizes = sizes.filter((s) => !keys.has(s.w + "x" + s.h) && keys.add(s.w + "x" + s.h));
  const of = p.oldFonts || p.fonts || {}, oldFonts = [of.body, of.display, of.serif].some((v) => typeof v === "string" && v.trim()) ? { body: str(of.body), display: str(of.display), serif: str(of.serif) } : null;
  return {
    version: 2,
    id: str(p.id) || uid(),
    name: str(p.name) || str(p.brand && p.brand.name) || "Profile",
    // counter: the brand row shows the channel's number ("unit 01 / 05"); logo: the id of the asset (of the user's) shown at its right end
    brand: { name: str(p.brand && p.brand.name), unit: str(p.brand && p.brand.unit, "CHANNEL"), counter: !!(p.brand && p.brand.counter === true), logo: str(p.brand && p.brand.logo).replace(/[^\w-]/g, "").slice(0, 60) },
    categories, style,
    sizes,
    // a design keeps no photos: their pictures live with the cover
    design: { layers: carryFonts(normalizeLayers(p.design && p.design.layers, categories.map((x) => x.id)), oldFonts, style.look).filter((l) => l.type !== "photo" && l.type !== "subject") },
    ...(oldFonts ? { oldFonts } : {}),   // kept until the open cover has been given them too (see the app), then dropped
    ...(p.layerOrder === 2 ? { layerOrder: 2 } : {}),   // its design and covers have been given the layout layers' new default order (see loadCovers in the app)
    ...(p.tagged === true ? { tagged: true } : {}),     // its covers not yet touched have been given the default tag, once (see loadCovers)
    ...(p.lean === true ? { lean: true } : {}),         // its design and its covers not yet touched have left out the channel name and graphic, once (see loadCovers)
    ...(p.subbed === true ? { subbed: true } : {}),     // its covers not yet touched have been given the placeholder subtitle, once (see loadCovers)
  };
}

/**
 * Profiles used to choose fonts for the whole brand (`fonts.body`, `.display`, `.serif`). Fonts now
 * belong to layers. This gives the layers of an older profile the fonts it had chosen, where a
 * layer has none of its own: the body font to the title, channel name and text layers, the display
 * font to the tag and brand row, and the serif to the title when the look in use was a serif one.
 */
export function carryFonts(layers, old, lookId) {
  if (!old) return layers;
  const serifLook = ["editorial", "songke"].includes(lookId);
  for (const L of layers) {
    if (L.font) continue;
    const f = L.type === "title" ? (serifLook && old.serif) || old.body : ["catname", "text"].includes(L.type) ? old.body : ["tag", "brand"].includes(L.type) ? old.display : "";
    if (f) L.font = f;
  }
  return layers;
}

/** A cover with every field present. New covers start from the profile's default layer stack. */
export function normalizeCover(raw, profile) {
  const c = raw && typeof raw === "object" ? raw : {};
  const ids = profile.categories.map((x) => x.id), scene = normalizeScene(c.scene);   // where the looks' scene objects were dragged
  return {
    catId: ids.includes(c.catId) ? c.catId : ids[0],
    title: str(c.title), subtitle: str(c.subtitle), tag: str(c.tag),
    layers: normalizeLayers(Array.isArray(c.layers) ? c.layers : JSON.parse(JSON.stringify(profile.design.layers)), ids),
    ...(Object.keys(scene).length ? { scene } : {}),
  };
}

export const DEFAULT_SETTINGS = { lang: "", profileId: "", scale: 2, format: "png", quality: 92, nameTemplate: "{n}-{channel}_{title}_{size}", scope: "all", recentFonts: [] };
export const RECENT_FONTS = 6;
/** Puts a font at the head of the recently used ones. */
export const useFont = (recent, family) => [family, ...recent.filter((f) => f !== family)].slice(0, RECENT_FONTS);
export function normalizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    lang: s.lang === "zh" || s.lang === "en" ? s.lang : "",
    profileId: str(s.profileId),
    scale: [1, 2, 3, 4].includes(Number(s.scale)) ? Number(s.scale) : 2,
    format: ["png", "jpeg", "webp"].includes(s.format) ? s.format : "png",
    quality: Math.round(num(s.quality, 92, 40, 100)),
    nameTemplate: str(s.nameTemplate) || DEFAULT_SETTINGS.nameTemplate,
    scope: s.scope === "size" ? "size" : "all",
    hideScene: s.hideScene === true,   // the scene objects' handles hidden on the canvas
    // how a photo's subject is cut out: "vision" (macOS), "birefnet-lite" or "birefnet" (any system, a downloaded model); "" = the system's own choice
    cutEngine: ["vision", "birefnet-lite", "birefnet"].includes(s.cutEngine) ? s.cutEngine : "",
    cutProxy: str(s.cutProxy).trim().slice(0, 300),   // a proxy for downloading the models ("" = the environment's)
    // the channel each profile was last on: {profileId: channelId} (each channel of each profile has a cover of its own)
    channels: Object.fromEntries(Object.entries(s.channels && typeof s.channels === "object" ? s.channels : {}).filter(([k, v]) => typeof v === "string" && /^[\w-]{1,60}$/.test(k)).slice(0, 200)),
    // the side columns' widths in px, as dragged (0 = the default): left and right while editing, left in Setup
    columns: Object.fromEntries(["left", "right", "setup"].map((k) => [k, Math.round(num(s.columns && s.columns[k], 0, 0, 900))])),
    recentFonts: [...new Set((Array.isArray(s.recentFonts) ? s.recentFonts : []).map((f) => str(f).replace(/["\\]/g, "").trim().slice(0, 80)).filter(Boolean))].slice(0, RECENT_FONTS),
  };
}

const parse = (text) => { try { return text ? JSON.parse(text) : null; } catch (e) { return null; } };
export const readJson = async (path) => parse(await files.read(path));
export const writeJson = (path, value) => files.write(path, JSON.stringify(value, null, 2));

export async function loadProfiles() {
  const out = [];
  for (const name of await files.list("profiles")) {
    if (!name.endsWith(".json")) continue;
    const raw = await readJson("profiles/" + name);
    if (raw) out.push(normalizeProfile(raw));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export const saveProfile = (p) => writeJson(`profiles/${p.id}.json`, p);

/**
 * The user's assets as stored: [{id, name, src}] for images, [{id, name, spec}] for generated
 * stickers; either may carry `folder`, the id of the folder it is filed in (see normalizeFolders).
 */
export async function loadAssetRecords() {
  const out = [];
  for (const name of await files.list("assets")) {
    if (!name.endsWith(".json")) continue;
    const raw = await readJson("assets/" + name);
    const folder = raw && typeof raw.folder === "string" ? raw.folder.slice(0, 40) : "";
    if (raw && typeof raw.id === "string" && typeof raw.src === "string") out.push({ id: raw.id, name: str(raw.name, "asset"), src: raw.src, folder });
    else if (raw && typeof raw.id === "string" && raw.spec && typeof raw.spec === "object") out.push({ id: raw.id, name: str(raw.name, "AI"), spec: raw.spec, folder });
  }
  return out;
}
export const saveAssetRecord = (a) => files.write(`assets/${a.id}.json`, JSON.stringify({ id: a.id, name: a.name, ...(a.spec ? { spec: a.spec } : { src: a.src }), ...(a.folder ? { folder: a.folder } : {}) }));
/** The folders "My assets" are filed in, as kept in asset-folders.json: [{id, name}], in order, ids unique. */
export function normalizeFolders(raw) {
  const out = [];
  for (const f of Array.isArray(raw) ? raw : []) {
    const id = f && typeof f.id === "string" ? f.id.replace(/[^\w-]/g, "").slice(0, 40) : "";
    if (id && !out.some((o) => o.id === id)) out.push({ id, name: str(f.name, "").slice(0, 40) || id });
  }
  return out.slice(0, 200);
}
export const deleteAssetRecord = (id) => files.remove(`assets/${id}.json`);

/** Ids of the uploaded assets a profile and/or cover refer to (so they can travel with an export). */
export function usedUserAssets(profile, cover) {
  const ids = new Set();
  for (const c of profile ? profile.categories : []) if (c.graphic.kind === "user") ids.add(c.graphic.id);
  if (profile && profile.brand.logo) ids.add(profile.brand.logo);
  for (const L of [...(profile ? profile.design.layers : []), ...(cover ? cover.layers : [])]) if (L.type === "asset" && L.ref.kind === "user") ids.add(L.ref.id);
  return [...ids];
}
export const deleteProfile = (p) => files.remove(`profiles/${p.id}.json`);

/** File name for an exported cover, from the user's template. Characters unsafe in file names are dropped. */
export function exportName(template, { index, cat, title, size, scale, ext }) {
  const clean = (s) => String(s).replace(/\\n|[\n\r]+/g, " ").replace(/[*\\/:?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const base = String(template || DEFAULT_SETTINGS.nameTemplate)
    .replace(/\{n\}/g, String(index + 1).padStart(2, "0"))
    .replace(/\{(channel|category)\}/g, clean(cat.name) || "cover")
    .replace(/\{code\}/g, clean(cat.code))
    .replace(/\{title\}/g, clean(title).slice(0, 32) || "untitled")
    .replace(/\{size\}/g, `${size.w}x${size.h}`)
    .replace(/\{w\}/g, size.w).replace(/\{h\}/g, size.h);
  return `${clean(base) || "cover"}${scale > 1 ? "@" + scale + "x" : ""}.${ext}`;
}
