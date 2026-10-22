// Data model and persistence.
//
//   profile  a brand: name, categories, style, fonts, output sizes, and its default layer stack
//   cover    the cover being edited: category, title, subtitle, tag, and its own working copy of the layers
//   assets   pictures the user uploaded (shared by all profiles)
//   settings app-level preferences: language, active profile, export options
//
// In the desktop app everything lives in the app data directory (through the Rust side), and so it does on a
// SmedCover server, whose page reaches the same commands over HTTP (see HOST); when the page is opened in a
// plain browser it falls back to localStorage so the UI can still be developed.
import { SIZE_PRESETS } from "./presets.js";
import { platformsFor, ratioOf } from "./platforms.js";
import { TEMPLATES, LAYOUT_LIMITS } from "./layout.js";
import { LOOKS, LOOK_IDS, lookParams } from "./style.js";
import { normalizeLayers, normalizeScene, normalizeT, LAYOUT_PARTS, LAYOUT_RUNS, LETTERED, DEFAULT_OFF } from "./layers.js";

const T = globalThis.__TAURI__;
/**
 * Where the interface runs: "tauri", in the app (the desktop's, or one day a phone's), which answers the native
 * commands itself; "server", a page a SmedCover server sent, which sets `window.SMEDCOVER_SERVER` ({api}, where
 * its commands are, "/api" when left out) before the modules load and answers the same commands over HTTP;
 * "browser", the page on its own, with no native side at all.
 */
export const HOST = T ? "tauri" : globalThis.SMEDCOVER_SERVER ? "server" : "browser";
/** Whether this is the app itself (its windows, its dialogs, this computer's disk). */
export const native = HOST === "tauri";
/**
 * What the host can do, for the interface to offer it or say why not: `files` keeps profiles and covers as
 * files in the data folder (else in this browser's storage); `fonts` reads the fonts installed there, and their
 * files; `outlines` traces glyph outlines (the outline text effects); `cut` cuts a photo's subject out; `relay`
 * sends requests to AI services past the browser's cross-origin rules; `saveFiles` writes exports and files
 * where the user chooses on this computer (else they are downloaded); `folders` shows the data folder or picks
 * one in the system's dialogs; `pointer` moves the mouse pointer; `selftest` runs the self-test.
 */
export const CAN = Object.freeze({
  files: HOST !== "browser", fonts: HOST !== "browser", outlines: HOST !== "browser", cut: HOST !== "browser", relay: HOST !== "browser",
  saveFiles: native, folders: native, pointer: native, selftest: native,
});
/** The commands that only read: asked again, twice, after a moment, when the server cannot be reached or is briefly away (502–504). */
const READS = new Set(["app_read", "app_list", "list_system_fonts", "font_faces", "font_data", "text_outline", "cut_models"]);
/**
 * A command of the native side asked of a SmedCover server: POST <api>/invoke/<cmd>, the arguments as JSON — or a
 * binary body (a photo's bytes) as it is, with `options.headers`. The answer: JSON (a JSON content type; an empty
 * one, or 204, is null), else bytes (an ArrayBuffer: a picture, a font), as Tauri hands them back; an error answer
 * is thrown as its text, as Tauri's are. `send` is fetch and `pause` a timer (others for the tests).
 */
export async function httpInvoke(server, cmd, args, options = {}, send = globalThis.fetch, pause = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const raw = args instanceof ArrayBuffer || ArrayBuffer.isView(args), again = READS.has(cmd);
  const init = {
    method: "POST", credentials: "same-origin",
    headers: raw ? { ...(options.headers || {}), "content-type": "application/octet-stream" } : { "content-type": "application/json" },
    body: raw ? args : JSON.stringify(args ?? {}),
  };
  let res;
  for (let n = 0; ; n++) {
    try { res = await send(`${(server && server.api) || "/api"}/invoke/${encodeURIComponent(cmd)}`, init); }
    catch (e) { if (again && n < 2) { await pause(400 * 3 ** n); continue; } throw `${cmd}: ${(e && e.message) || e}`; }
    if (again && n < 2 && [502, 503, 504].includes(res.status)) { await pause(400 * 3 ** n); continue; }
    break;
  }
  if (!res.ok) throw await res.text();
  if (res.status === 204) return null;
  if (/json/.test(res.headers.get("content-type") || "")) { const text = await res.text(); return text ? JSON.parse(text) : null; }
  const bytes = await res.arrayBuffer();
  return bytes.byteLength ? bytes : null;
}
/** Asks the native side to run command `cmd` (see HOST): Tauri's invoke, the server's over HTTP, or nothing to ask. */
export const invoke = HOST === "tauri" ? (cmd, args, options) => T.core.invoke(cmd, args, options)
  : HOST === "server" ? (cmd, args, options) => httpInvoke(globalThis.SMEDCOVER_SERVER, cmd, args, options)
  : (cmd) => Promise.reject(`${cmd}: there is no native side in a plain browser`);

const LS = "smedcover:";
export const files = CAN.files
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

export const DEFAULT_STYLE = { template: "stack", theme: "dark", look: "cel", lookParams: {}, lookSeed: 7, layoutAdjust: {}, lookArt: {} };
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

/** A template's adjustments as kept (see adjustLayout in layout.js): each within LAYOUT_LIMITS, the halves swapped (`flip`) only when true. */
function normalizeAdjust(raw) {
  const r = raw && typeof raw === "object" ? raw : {}, a = {};
  for (const k of Object.keys(LAYOUT_LIMITS)) if (Number.isFinite(r[k])) a[k] = Math.min(LAYOUT_LIMITS[k][1], Math.max(LAYOUT_LIMITS[k][0], r[k]));
  if (r.flip === true) a.flip = true;
  return a;
}

/**
 * The layouts some sizes have of their own (see layoutOf in layout.js), as kept: { size key: { template, adjust } }, a
 * key only where `ok(key)` says it is a size, a template only one there is, its adjustments as the profile's are
 * (normalizeAdjust), 80 at most. Null when none is left.
 */
function normalizeLayoutBy(raw, ok) {
  const out = {};
  for (const [k, v] of Object.entries(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}).slice(0, 80)) {
    if (ok(k) && v && typeof v === "object" && TEMPLATES.includes(v.template)) out[k] = { template: v.template, adjust: normalizeAdjust(v.adjust) };
  }
  return Object.keys(out).length ? out : null;
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
  for (const tpl of TEMPLATES) { const a = normalizeAdjust(st.layoutAdjust && st.layoutAdjust[tpl]); if (Object.keys(a).length) style.layoutAdjust[tpl] = a; }
  // tuned values are kept per look, so switching away and back loses nothing
  for (const id of LOOK_IDS) { const v = lookParams(id, st.lookParams && st.lookParams[id]); if (Object.keys(v).length) style.lookParams[id] = v; }
  // the graphic each look's figure is drawn from in place of the channel graphic (see `art` in style.js), for the looks with one
  style.lookArt = {};
  for (const id of LOOK_IDS) { const r = st.lookArt && st.lookArt[id]; if (LOOKS[id].art && r && KINDS.includes(r.kind) && str(r.id)) style.lookArt[id] = { kind: r.kind, id: str(r.id).slice(0, 80) }; }
  let sizes = (Array.isArray(p.sizes) ? p.sizes : []).map(normalizeSize);
  if (!sizes.length) sizes = SIZE_PRESETS.filter((s) => s.on).map(({ w, h }) => ({ w, h, label: "", name: "" }));
  const keys = new Set();
  sizes = sizes.filter((s) => !keys.has(s.w + "x" + s.h) && keys.add(s.w + "x" + s.h));
  // the sizes drawn in a layout of their own (see layoutOf in layout.js): only the profile's sizes, each kept as the profile's own layout is
  const by = normalizeLayoutBy(st.layoutBy, (k) => keys.has(k));
  if (by) style.layoutBy = by;
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
  const s = raw && typeof raw === "object" ? raw : {}, layouts = normalizeLayouts(s.layouts);   // the user's layout presets, for every profile (Surprise me deals them by their chances)
  return {
    lang: s.lang === "zh" || s.lang === "en" ? s.lang : "",
    profileId: str(s.profileId),
    scale: [1, 2, 3, 4].includes(Number(s.scale)) ? Number(s.scale) : 2,
    format: ["png", "jpeg", "webp"].includes(s.format) ? s.format : "png",
    quality: Math.round(num(s.quality, 92, 40, 100)),
    nameTemplate: str(s.nameTemplate) || DEFAULT_SETTINGS.nameTemplate,
    scope: ["orient", "size"].includes(s.scope) ? s.scope : "all",   // what a change of place or layout reaches: every size, those facing the way this one does (see orientOf in layout.js), or this one
    hideScene: s.hideScene === true,   // the scene objects' handles hidden on the canvas
    // how a photo's subject is cut out: "vision" (macOS), "birefnet-lite" or "birefnet" (any system, a downloaded model); "" = the system's own choice
    cutEngine: ["vision", "birefnet-lite", "birefnet"].includes(s.cutEngine) ? s.cutEngine : "",
    cutProxy: str(s.cutProxy).trim().slice(0, 300),   // a proxy for downloading the models ("" = the environment's)
    // the channel each profile was last on: {profileId: channelId} (each channel of each profile has a cover of its own)
    channels: Object.fromEntries(Object.entries(s.channels && typeof s.channels === "object" ? s.channels : {}).filter(([k, v]) => typeof v === "string" && /^[\w-]{1,60}$/.test(k)).slice(0, 200)),
    // the side columns' widths in px, as dragged (0 = the default): left and right while editing, left in Setup
    columns: Object.fromEntries(["left", "right", "setup"].map((k) => [k, Math.round(num(s.columns && s.columns[k], 0, 0, 900))])),
    recentFonts: [...new Set((Array.isArray(s.recentFonts) ? s.recentFonts : []).map((f) => str(f).replace(/["\\]/g, "").trim().slice(0, 80)).filter(Boolean))].slice(0, RECENT_FONTS),
    recipes: normalizeRecipes(s.recipes),
    layouts,
    surprise: normalizeSurprise(s.surprise, layouts.map((l) => l.id)),
  };
}
/** How many layout presets are kept at most, and how long a name may be. */
export const LAYOUTS = { most: 24, name: 40 };
/**
 * The user's layout presets, as kept in the settings for every profile (see takeLayout in layers.js): [{ id, name,
 * template, adjust, by?, parts: { part: { t, shown, vertical?, rules? } } }], LAYOUTS.most at most. An id is kept as it
 * is (Surprise me's chances name the presets by it: odds.groups.layout), one missing, taken or "keep" (the
 * option of none) made anew; a name trimmed and cut to length; a template unknown is Stack, its adjustments within
 * LAYOUT_LIMITS; the sizes drawn in a layout of their own (`by`, { size key: { template, adjust } }, kept as a profile
 * keeps them but by any size key, a preset being for every profile; left out when there is none); every part of
 * LAYOUT_PARTS there, its placement within range (per size by size keys only), one
 * missing where the template puts it and on the cover unless a new design leaves it out (DEFAULT_OFF); for a
 * lettered part, which way its words run (LAYOUT_RUNS) kept only when true (anything else, a number or a word, is
 * no way they run: left out, as putLayout reads it).
 */
export function normalizeLayouts(raw) {
  const out = [], ids = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (out.length >= LAYOUTS.most) break;
    if (!r || typeof r !== "object") continue;
    let id = typeof r.id === "string" && /^[\w-]{1,40}$/.test(r.id) ? r.id : uid();
    while (ids.has(id) || id === "keep") id = uid();
    ids.add(id);
    const parts = {};
    for (const type of LAYOUT_PARTS) {
      const q = r.parts && typeof r.parts === "object" && r.parts[type] && typeof r.parts[type] === "object" ? r.parts[type] : null, t = normalizeT(q && q.t, false);
      t.by = Object.fromEntries(Object.entries(t.by).filter(([k]) => /^\d{2,5}x\d{2,5}(@[\w-]{1,60})?$/.test(k)).slice(0, 80));
      parts[type] = { t, shown: q ? q.shown !== false : !DEFAULT_OFF.includes(type) };
      if (q && LETTERED.includes(type)) for (const k of LAYOUT_RUNS) if (q[k] === true) parts[type][k] = true;
    }
    const by = normalizeLayoutBy(r.by, (k) => /^\d{2,5}x\d{2,5}$/.test(k));   // the sizes it draws in a layout of their own
    out.push({ id, name: str(r.name).trim().slice(0, LAYOUTS.name), template: TEMPLATES.includes(r.template) ? r.template : "stack", adjust: normalizeAdjust(r.adjust), ...(by ? { by } : {}), parts });
  }
  return out;
}
/** What Surprise me may be told to leave as it is: the look (and its sliders), the dark or light ground, the letterings, where things stand. */
export const SURPRISE_LOCKS = ["look", "theme", "lettering", "places"];
/**
 * What Surprise me keeps, on this computer: the parts it is to leave alone (`locks`, see SURPRISE_LOCKS), and the
 * chances the user set in Surprise me's chances window (`odds`: { groups: {group: {option: chance}}, chances: {name:
 * chance} }, only what they set; chances between 0 and 1, names the app does not know left to oddsOf in
 * deal.js, which passes them over and makes each group add up to 1). The layout's group is named by the layout
 * presets' ids beside "keep" (the canvas's own): given the ids there are (`layouts`), a preset's that is gone is let go.
 */
export function normalizeSurprise(raw, layouts = null) {
  const r = raw && typeof raw === "object" ? raw : {}, name = (k) => typeof k === "string" && /^[a-zA-Z]{1,24}$/.test(k), locks = {};
  const preset = (k) => typeof k === "string" && (k === "keep" || (layouts ? layouts.includes(k) : /^[\w-]{1,40}$/.test(k)));
  const table = (o, n, ok = name) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k, v]) => ok(k) && Number.isFinite(v)).slice(0, n).map(([k, v]) => [k, Math.min(1, Math.max(0, v))]));
  for (const k of SURPRISE_LOCKS) if (r.locks && r.locks[k] === true) locks[k] = true;
  const o = r.odds && typeof r.odds === "object" ? r.odds : {}, groups = {};
  for (const [g, v] of Object.entries(o.groups && typeof o.groups === "object" ? o.groups : {}).slice(0, 12)) if (name(g) && v && typeof v === "object") groups[g] = g === "layout" ? table(v, LAYOUTS.most + 1, preset) : table(v, 80);
  const chances = table(o.chances, 40), odds = {};
  if (Object.keys(groups).length) odds.groups = groups;
  if (Object.keys(chances).length) odds.chances = chances;
  return { locks, odds };
}
/**
 * The user's own Surprise me recipes, by look (see baseRecipe in deal.js): only the chances they set for its
 * optional parts (`params`: {part: chance}, each between 0 and 1). The lettering, bend and ground are set for
 * every look alike (`surprise.odds`); what earlier versions kept of them by look is let go. Names the app does
 * not know are left to deal.js, which passes them over.
 */
export function normalizeRecipes(raw) {
  const out = {}, name = (k) => /^[a-zA-Z]{1,24}$/.test(k);
  for (const [look, r] of Object.entries(raw && typeof raw === "object" ? raw : {}).slice(0, 80)) {
    if (!name(look) || !r || typeof r !== "object" || !r.params || typeof r.params !== "object") continue;
    const params = Object.fromEntries(Object.entries(r.params).filter(([k, v]) => name(k) && Number.isFinite(v)).slice(0, 40).map(([k, v]) => [k, Math.min(1, Math.max(0, v))]));
    if (Object.keys(params).length) out[look] = { params };
  }
  return out;
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
  for (const r of Object.values((profile && profile.style.lookArt) || {})) if (r.kind === "user") ids.add(r.id);
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
