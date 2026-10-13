// Data model and persistence.
//
//   profile  a brand: name, categories, style, fonts, output sizes, and its default layer stack
//   cover    the cover being edited: category, title, tag, and its own working copy of the layers
//   assets   pictures the user uploaded (shared by all profiles)
//   settings app-level preferences: language, active profile, export options
//
// In the desktop app everything lives in the app data directory (through the Rust side); when the
// page is opened in a plain browser it falls back to localStorage so the UI can still be developed.
import { SIZE_PRESETS } from "./presets.js";
import { TEMPLATES } from "./layout.js";
import { LOOK_IDS, lookParams } from "./style.js";
import { normalizeLayers } from "./layers.js";

const T = globalThis.__TAURI__;
export const native = !!T;
export const invoke = (cmd, args) => T.core.invoke(cmd, args);

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
const bool = (v, d) => (typeof v === "boolean" ? v : d);
const num = (v, d, lo, hi) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Number(v))) : d);
const color = (v) => (/^#[0-9a-f]{6}$/i.test(str(v)) ? v.toLowerCase() : "#fcee0a");

export const DEFAULT_STYLE = { template: "stack", theme: "dark", imageShadow: true, look: "cel", lookParams: {} };

const KINDS = ["graphic", "sticker", "user"];
/** A category's graphic: a reference into the asset library, or none. Older shapes are upgraded. */
function normalizeGraphic(g) {
  if (!g || typeof g !== "object") return { kind: "none" };
  const extra = { labels: Array.isArray(g.labels) ? g.labels.map(String).slice(0, 4) : [], stamp: str(g.stamp) };
  if (g.type === "builtin") return { kind: "graphic", id: str(g.id, "camera"), ...extra };   // v1
  if (KINDS.includes(g.kind) && str(g.id)) return { kind: g.kind, id: g.id, ...extra };
  return { kind: "none" };
}
/** An output size. `label` is the preset's own description ("16:9 · YouTube"); `name` is what the user calls it. */
export const normalizeSize = (s) => ({ w: Math.round(num(s && s.w, 1920, 64, 8192)), h: Math.round(num(s && s.h, 1080, 64, 8192)), label: str(s && s.label), name: str(s && s.name).trim().slice(0, 40) });

/** Aspect ratio as text: "16:9" when it reduces to small numbers, otherwise relative to 1 ("2.35:1", "1:1.25"). */
export function ratioText(w, h) {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a), g = gcd(w, h), a = w / g, b = h / g;
  if (a <= 32 && b <= 32) return `${a}:${b}`;
  const r = (x) => String(Math.round(x * 100) / 100);
  return w >= h ? `${r(w / h)}:1` : `1:${r(h / w)}`;
}
/** Short caption for a size: the user's name if any, else the preset's ratio and use, else just the ratio. No pixels. */
export const sizeCaption = (s) => s.name || s.label || ratioText(s.w, s.h);

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
  const style = { template: TEMPLATES.includes(st.template) ? st.template : "stack", theme: st.theme === "light" ? "light" : "dark", imageShadow: bool(st.imageShadow, true),
    look: LOOK_IDS.includes(st.look) ? st.look : "cel", lookParams: {} };
  // tuned values are kept per look, so switching away and back loses nothing
  for (const id of LOOK_IDS) { const v = lookParams(id, st.lookParams && st.lookParams[id]); if (Object.keys(v).length) style.lookParams[id] = v; }
  let sizes = (Array.isArray(p.sizes) ? p.sizes : []).map(normalizeSize);
  if (!sizes.length) sizes = SIZE_PRESETS.filter((s) => s.on).map(({ w, h, label }) => ({ w, h, label }));
  const keys = new Set();
  sizes = sizes.filter((s) => !keys.has(s.w + "x" + s.h) && keys.add(s.w + "x" + s.h));
  return {
    version: 2,
    id: str(p.id) || uid(),
    name: str(p.name) || str(p.brand && p.brand.name) || "Profile",
    brand: { name: str(p.brand && p.brand.name), unit: str(p.brand && p.brand.unit, "CHANNEL") },
    categories, style,
    fonts: { body: str(p.fonts && p.fonts.body), display: str(p.fonts && p.fonts.display) },
    sizes,
    design: { layers: normalizeLayers(p.design && p.design.layers, categories.map((x) => x.id)) },
  };
}

/** A cover with every field present. New covers start from the profile's default layer stack. */
export function normalizeCover(raw, profile) {
  const c = raw && typeof raw === "object" ? raw : {};
  const ids = profile.categories.map((x) => x.id);
  return {
    catId: ids.includes(c.catId) ? c.catId : ids[0],
    title: str(c.title), tag: str(c.tag),
    layers: normalizeLayers(Array.isArray(c.layers) ? c.layers : JSON.parse(JSON.stringify(profile.design.layers)), ids),
  };
}

export const DEFAULT_SETTINGS = { lang: "", profileId: "", scale: 2, format: "png", quality: 92, nameTemplate: "{n}-{channel}_{title}_{size}", scope: "all" };
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

/** The user's assets as stored: [{id, name, src}] for images, [{id, name, spec}] for generated stickers. */
export async function loadAssetRecords() {
  const out = [];
  for (const name of await files.list("assets")) {
    if (!name.endsWith(".json")) continue;
    const raw = await readJson("assets/" + name);
    if (raw && typeof raw.id === "string" && typeof raw.src === "string") out.push({ id: raw.id, name: str(raw.name, "asset"), src: raw.src });
    else if (raw && typeof raw.id === "string" && raw.spec && typeof raw.spec === "object") out.push({ id: raw.id, name: str(raw.name, "AI"), spec: raw.spec });
  }
  return out;
}
export const saveAssetRecord = (a) => files.write(`assets/${a.id}.json`, JSON.stringify(a.spec ? { id: a.id, name: a.name, spec: a.spec } : { id: a.id, name: a.name, src: a.src }));
export const deleteAssetRecord = (id) => files.remove(`assets/${id}.json`);

/** Ids of the uploaded assets a profile and/or cover refer to (so they can travel with an export). */
export function usedUserAssets(profile, cover) {
  const ids = new Set();
  for (const c of profile ? profile.categories : []) if (c.graphic.kind === "user") ids.add(c.graphic.id);
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
