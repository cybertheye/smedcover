// Pictures from an image model. A repaint: a photo and a description of the wanted style go out, a
// new picture comes back and takes the photo's place (the original is kept). A new photo: words go
// out, perhaps with a reference picture, and the picture that comes back becomes a photo layer.
//
// Three kinds of service are spoken to, each in its own form:
//   openai    POST {base}/images/edits                       Authorization: Bearer
//             {model, prompt, images: [{image_url: data URL}], size}      -> data[0].b64_json
//             (without a picture: POST {base}/images/generations {model, prompt, size})
//   gemini    POST {base}/models/{model}:generateContent      x-goog-api-key
//             {contents: [{parts: [{text}, {inlineData}]}], generationConfig} -> candidates[0].content.parts[].inlineData
//   seedream  POST {base}/images/generations                  Authorization: Bearer   (Volcengine Ark / BytePlus)
//             {model, prompt, image: data URL, size: "WxH", response_format: "b64_json"} -> data[0].b64_json or .url
//
// The style comes from one of three sources: the current look (each look has a `repaint`
// description, see style.js), a built-in style (a Markdown file in ui/repaint-styles/), or one of
// the user's own styles — Markdown files of the same form in the app data folder repaint-styles/,
// which the user can also add to or edit outside the app (see below).
import { LOOKS } from "./style.js";

export const IMAGE_PROVIDERS = ["openai", "gemini", "seedream"];
export const IMAGE_DEFAULTS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.1-flash-image" },
  seedream: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-5-0-lite-260128" },
};
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const MAX_STYLES = 200;
const ID = /^[a-z0-9][a-z0-9-]*$/;

/** The image model settings, as stored in image-ai.json. */
export function normalizeImageAi(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const secs = Math.round(Number(a.timeout));
  let source = typeof a.source === "string" ? a.source : "look";
  if (source === "custom") source = "my:custom";   // the one custom description of before (see legacyStyles)
  // the 8-bit style's earlier names: before styles were files, and while their names were their ids
  if (source === "pixel" || source === "preset:8-bit-pixel-editorial") source = "preset:pixel-editorial";
  // a built-in style is checked against the list once that has been read (see app.js)
  // whether a built-in or own style is still there is checked once the lists are read (see app.js)
  if (!(source === "look" || /^(preset|my):[a-z0-9][a-z0-9-]*$/.test(source))) source = "look";
  return {
    provider: IMAGE_PROVIDERS.includes(a.provider) ? a.provider : "openai",
    baseUrl: str(a.baseUrl, 400), token: str(a.token, 4000), model: str(a.model, 200),
    timeout: Number.isFinite(secs) && secs > 0 ? Math.min(1800, Math.max(30, secs)) : 300,
    proxy: str(a.proxy, 300),
    source,                   // where the style comes from: "look", "preset:<id>" (a built-in style), or "my:<id>" (one of the user's)
    notes: str(a.notes, 600), // a word added to any source
  };
}
/** Whether enough is filled in to send a request. */
/**
 * The user's styles as image-ai.json kept them before they were files: [{id, name, prompt}], to be
 * written out once. Both earlier forms: a list `styles`, and before that one text `custom`.
 */
export function legacyStyles(raw) {
  const a = raw && typeof raw === "object" ? raw : {}, out = [];
  for (const s of Array.isArray(a.styles) ? a.styles : []) {
    const id = String((s && s.id) || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "");
    if (s && typeof s.prompt === "string" && ID.test(id) && !out.some((o) => o.id === id)) out.push({ id, name: str(s.name, 60) || id, prompt: s.prompt });
  }
  if (!out.length && typeof a.custom === "string" && a.custom.trim()) out.push({ id: "custom", name: "自定义", prompt: a.custom });
  return out;
}
export const imageReady = (cfg) => (!cfg.baseUrl || /^https?:\/\//i.test(cfg.baseUrl)) && !!cfg.model && !!cfg.token;   // an empty address means the service's own

/** The full URL of the request, tolerating a base that already includes the path. `edit`: a picture goes with it. */
export function imageEndpoint(cfg, edit = true) {
  const base = (cfg.baseUrl || IMAGE_DEFAULTS[cfg.provider].baseUrl).replace(/\/+$/, "");
  if (cfg.provider === "gemini") {
    if (/:generateContent$/.test(base)) return base;
    return `${/\/v1(beta)?$/.test(base) ? base : base + "/v1beta"}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  }
  if (cfg.provider === "seedream") return /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  return base.replace(/\/images\/(edits|generations)$/, "") + (edit ? "/images/edits" : "/images/generations");
}

const round16 = (v) => Math.max(16, Math.round(v / 16) * 16);
/**
 * The size to ask for, keeping the photo's shape so its placement on the cover still fits:
 *   openai     the newer models take any size (sides divisible by 16, shape between 1:3 and 3:1,
 *              about 2.5 megapixels here); older ones only 1024x1024, 1536x1024 and 1024x1536.
 *   seedream   "WxH" of about 4 megapixels — inside the range every Seedream model accepts.
 *   gemini     nothing: the picture comes back in the shape of the one sent.
 */
export function repaintSize(cfg, w, h) {
  const r = Math.min(3, Math.max(1 / 3, w / Math.max(1, h)));
  if (cfg.provider === "openai") {
    if (/^gpt-image-1|^dall-e|^chatgpt-image/i.test(cfg.model)) return r > 1.2 ? "1536x1024" : r < 0.83 ? "1024x1536" : "1024x1024";
    const px = 2560 * 1440 * 0.68, W = round16(Math.sqrt(px * r)), H = round16(W / r);
    return `${W}x${H}`;
  }
  if (cfg.provider === "seedream") {
    const px = 3_900_000, W = Math.round(Math.sqrt(px * r)), H = Math.round(W / r);
    return `${W}x${H}`;
  }
  return null;
}

/** The shapes a Gemini image model can be asked for. */
const GEMINI_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
/** The Gemini shape nearest to w × h. */
export function geminiRatio(w, h) {
  const r = Math.log(w / Math.max(1, h)), of = (s) => { const [a, b] = s.split(":").map(Number); return Math.abs(Math.log(a / b) - r); };
  return GEMINI_RATIOS.reduce((best, s) => (of(s) < of(best) ? s : best));
}
/**
 * The HTTP request for one picture: {url, headers, body}. `image` is {mime, data} with the data in
 * base64, or null to have a picture made from the words alone. w × h is the shape wanted; with
 * `shape` a Gemini model is told it too (otherwise it follows the picture sent).
 */
export function buildImageRequest(cfg, prompt, image, w, h, { shape = false } = {}) {
  const url = imageEndpoint(cfg, !!image), dataUrl = image && `data:${image.mime};base64,${image.data}`, size = repaintSize(cfg, w, h);
  if (cfg.provider === "gemini") {
    const parts = [...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []), { text: prompt }];
    const generationConfig = { responseModalities: ["TEXT", "IMAGE"], ...(shape || !image ? { imageConfig: { aspectRatio: geminiRatio(w, h) } } : {}) };
    return { url, headers: { "content-type": "application/json", "x-goog-api-key": cfg.token }, body: { contents: [{ role: "user", parts }], generationConfig } };
  }
  const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.token}` };
  if (cfg.provider === "seedream") {
    return { url, headers, body: { model: cfg.model, prompt, ...(image ? { image: dataUrl } : {}), size, response_format: "b64_json", watermark: false } };
  }
  return { url, headers, body: { model: cfg.model, prompt, ...(image ? { images: [{ image_url: dataUrl }] } : {}), size, n: 1 } };
}

// Settings that are only wishes: a model that does not take one says so, and the request goes again without it.
const OPTIONAL = ["size", "response_format", "watermark", "n", "output_format", "sequential_image_generation", "generationConfig"];
/** The optional setting a 400 reply objects to, if it names one that `body` has; else null. */
export function refusedParam(status, text, body) {
  if (status !== 400) return null;
  const m = String(text).match(/param(?:eter)?s?:?\s*[`'"]([\w.]+)[`'"]/i) || String(text).match(/unknown (?:parameter|name|field)[^`'"\w]*[`'"]?([\w.]+)/i);
  const key = m && m[1].split(".")[0];
  return key && OPTIONAL.includes(key) && key in body ? key : null;
}

/**
 * A request that checks the key and the model without making a picture (nothing is charged):
 *   openai     GET {base}/models/{model} (and, if a compatible service has no such path, GET {base}/models)
 *   gemini     GET {base}/models/{model}
 *   seedream   a generation with an empty prompt, which is refused before anything is drawn: the
 *              refusal says whether the key was accepted.
 */
export function imageCheck(cfg, list = false) {
  const base = (cfg.baseUrl || IMAGE_DEFAULTS[cfg.provider].baseUrl).replace(/\/+$/, "");
  if (cfg.provider === "gemini") {
    const root = base.replace(/\/models\/.*$/, "");
    return { method: "GET", url: `${/\/v1(beta)?$/.test(root) ? root : root + "/v1beta"}/models/${encodeURIComponent(cfg.model)}`, headers: { "x-goog-api-key": cfg.token } };
  }
  const auth = { authorization: `Bearer ${cfg.token}` };
  if (cfg.provider === "seedream") return { method: "POST", url: imageEndpoint(cfg), headers: { "content-type": "application/json", ...auth }, body: { model: cfg.model, prompt: "" } };
  const root = base.replace(/\/images\/(edits|generations)$/, "");
  return { method: "GET", url: list ? `${root}/models` : `${root}/models/${encodeURIComponent(cfg.model)}`, headers: auth };
}
/**
 * What a check's reply means: {ok: true | false | null, key, detail}, `key` naming the message
 * (img.check.*); ok null when it cannot be told. {again: true} asks for the model list next (openai).
 */
export function readImageCheck(cfg, status, text, list = false) {
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  const said = String((j && j.error && (j.error.message || j.error.code)) || (j && j.message) || text || "").slice(0, 240);
  if (status === 401 || status === 403 || /api[_ ]?key|unauthori[sz]ed|authenticat|invalid.*key/i.test(said) && status >= 400 && status < 500 && !/prompt/i.test(said)) return { ok: false, key: "auth", detail: said };
  if (cfg.provider === "seedream") {
    if (status === 404 || /model|endpoint/i.test(said) && /not ?found|not exist|invalid|不存在/i.test(said)) return { ok: false, key: "model", detail: said };
    if (status === 400 && /prompt/i.test(said)) return { ok: true, key: "okSeedream" };
    if (status >= 200 && status < 300) return { ok: true, key: "ok" };
    return { ok: false, key: "other", detail: `HTTP ${status}: ${said}` };
  }
  if (status >= 200 && status < 300) {
    if (cfg.provider === "openai" && list) {
      const ids = (j && Array.isArray(j.data) ? j.data : []).map((m) => m && m.id);
      return ids.includes(cfg.model) ? { ok: true, key: "ok" } : { ok: false, key: "notListed" };
    }
    if (cfg.provider === "gemini" && j && Array.isArray(j.supportedGenerationMethods) && !j.supportedGenerationMethods.includes("generateContent")) return { ok: false, key: "model", detail: said };
    return { ok: true, key: "ok" };
  }
  if (status === 404) return cfg.provider === "openai" && !list ? { again: true } : list ? { ok: null, key: "noList" } : { ok: false, key: "model", detail: said };
  return { ok: false, key: "other", detail: `HTTP ${status}: ${said}` };
}

/** What came back: {image: {mime, data}}, {url} (a picture to download), or {error}. */
export function readImageReply(provider, status, text) {
  let j = null;
  try { j = JSON.parse(text); } catch (e) { /* not JSON: an error page */ }
  if (status < 200 || status >= 300 || !j) {
    const m = j && (j.error && (j.error.message || j.error.code) || j.message);
    return { error: `HTTP ${status}${m ? ": " + String(m).slice(0, 300) : text ? ": " + String(text).slice(0, 200) : ""}` };
  }
  if (provider === "gemini") {
    const c = (j.candidates || [])[0], parts = (c && c.content && c.content.parts) || [];
    const pic = parts.map((p) => p.inlineData || p.inline_data).find((d) => d && d.data);
    if (pic) return { image: { mime: pic.mimeType || pic.mime_type || "image/png", data: pic.data } };
    const said = parts.map((p) => p.text).filter(Boolean).join(" ").trim();
    const why = (c && c.finishReason) || (j.promptFeedback && j.promptFeedback.blockReason) || "";
    return { error: `no picture in the reply${why ? ` (${why})` : ""}${said ? ": " + said.slice(0, 300) : ""}` };
  }
  const d = (j.data || [])[0];
  if (d && d.b64_json) return { image: { mime: /^\/9j/.test(d.b64_json) ? "image/jpeg" : /^UklGR/.test(d.b64_json) ? "image/webp" : "image/png", data: d.b64_json } };
  if (d && d.url) return { url: d.url };
  const e = (d && d.error) || j.error;
  return { error: e ? String(e.message || e.code || e) : "no picture in the reply" };
}

// ---------- what to ask for

// ---------- built-in styles: one Markdown file each in ui/repaint-styles/, named by its id
//
//   pixel-editorial.md
//   ---
//   name.zh: 8-bit 像素编辑          required
//   name.en: 8-bit pixel editorial   required
//   about.zh: …   about.en: …        optional: shown under the menu
//   order: 10                        optional: place in the menu, low first (default 100)
//   credit: …                        optional: where it comes from, shown under the menu
//   ---
//   the prompt; <!-- comments --> in it are not sent
//
// The file name (lower-case letters, digits and hyphens) is the id that settings remember, so the
// names can change freely. A bundled app cannot list a folder: scripts/repaint-styles.mjs writes
// the list, ui/repaint-styles/index.json, before every build, and the app reads a style's prompt
// only when it is wanted.

export const STYLE_KEYS = ["name", "name.zh", "name.en", "about", "about.zh", "about.en", "description", "order", "credit"];
/**
 * A style file split into its header and its prompt: {meta, prompt, errors}. The header is the
 * lines between a first line "---" and the next "---", each "key: value".
 */
export function parseStyle(md) {
  const text = String(md).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), meta = {}, errors = [];
  let body = text;
  const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (m) {
    body = text.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const kv = line.match(/^\s*([\w.]+)\s*:\s*(.*?)\s*$/);
      if (!kv) { errors.push(`not "key: value": ${line.trim()}`); continue; }
      if (!STYLE_KEYS.includes(kv[1])) errors.push(`unknown key: ${kv[1]}`);
      meta[kv[1]] = kv[2];   // kept even when unknown, so a file rewritten by the app loses nothing
    }
  } else errors.push('no header: the file must start with a "---" line');
  return { meta, body: body.replace(/^\n+/, ""), prompt: promptOf(body), errors };
}
/** A style file's text from its header fields and its body (the prompt, comments and all). */
export function writeStyle(meta, body) {
  const keys = [...STYLE_KEYS.filter((k) => k in meta), ...Object.keys(meta).filter((k) => !STYLE_KEYS.includes(k))];
  const head = keys.map((k) => `${k}: ${String(meta[k]).replace(/[\r\n]+/g, " ").trim()}`).join("\n");
  return `---\n${head}\n---\n\n${String(body).replace(/\r\n?/g, "\n").trim()}\n`;
}
/** The names and description from a header: name.zh / name.en, falling back on name (and about on description). */
const namesOf = (meta, fallback) => {
  const name = { zh: meta["name.zh"] || meta.name || meta["name.en"] || fallback, en: meta["name.en"] || meta.name || meta["name.zh"] || fallback };
  const zh = meta["about.zh"] || meta.about || meta.description || meta["about.en"], en = meta["about.en"] || meta.about || meta.description || meta["about.zh"];
  return { name, about: zh || en ? { zh, en } : null };
};

/**
 * One of the user's style files, read leniently — it may have been written by hand or come from
 * elsewhere (a skill's SKILL.md): no header, or unknown keys, are fine; the file name stands in for
 * a missing name. {id, file, order, name, about?, credit?, meta, body, prompt}
 */
export function userStyle(file, text) {
  const id = file.replace(/\.md$/, ""), { meta, body, prompt } = parseStyle(text), { name, about } = namesOf(meta, id);
  const order = Number.isFinite(Number(meta.order)) && meta.order !== undefined && meta.order !== "" ? Number(meta.order) : 100;
  const st = { id, file, order, name, meta, body, prompt };
  if (about) st.about = about;
  if (meta.credit) st.credit = meta.credit;
  return st;
}
/** An id for a style file brought in from elsewhere, from its file name, unlike any in `taken`. */
export function freeId(filename, taken) {
  const base = String(filename).replace(/\.[^.]+$/, "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "style";
  let id = ID.test(base) ? base : "style-" + base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}
/** The prompt in a style file's body: its text without <!-- comments -->, trimmed. */
export const promptOf = (md) => String(md).replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();

/**
 * The index entries for a folder's .md files: {styles: [{id, file, name, about?, credit?}], errors}.
 * `read(file)` returns a file's text. In menu order: by `order`, then by id.
 */
export function styleIndex(files, read) {
  const styles = [], errors = [];
  for (const file of files) {
    const id = file.replace(/\.md$/, "");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) { errors.push(`${file}: the file name must be lower-case letters, digits and hyphens, e.g. watercolour.md`); continue; }
    const { meta, prompt, errors: bad } = parseStyle(read(file));
    for (const e of bad) errors.push(`${file}: ${e}`);
    if (!(meta["name.zh"] && meta["name.en"]) && !meta.name) { errors.push(`${file}: name.zh and name.en are required (or one name)`); continue; }
    if (!prompt) { errors.push(`${file}: no prompt after the header`); continue; }
    const order = meta.order === undefined ? 100 : Number(meta.order);
    if (!Number.isFinite(order)) { errors.push(`${file}: order must be a number`); continue; }
    const { name, about } = namesOf(meta, id), style = { id, file, order, name };
    if (about) style.about = about;
    if (meta.credit) style.credit = meta.credit;
    styles.push(style);
  }
  styles.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { styles, errors };
}

const BASE = new URL("../repaint-styles/", import.meta.url);
let listing = null;
const texts = new Map();
/** The built-in styles, read once: [{id, file, name}]. Empty if the list cannot be read. */
export function loadStyles() {
  return (listing ||= fetch(new URL("index.json", BASE)).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((l) => (Array.isArray(l) ? l : [])));
}
/** A built-in style's prompt, read when it is first wanted and kept. */
export async function styleText(style) {
  if (!texts.has(style.id)) {
    const r = await fetch(new URL(encodeURIComponent(style.file), BASE));
    if (!r.ok) throw new Error(`${style.file}: HTTP ${r.status}`);
    texts.set(style.id, parseStyle(await r.text()).prompt);
  }
  return texts.get(style.id);
}

/** Words that go with every source: what the picture is for. */
const FOR_A_COVER = "The result becomes the background of a video cover, with a title and graphics laid over it: no text, letters, numbers, logos, signatures or watermarks, no frame or border, and one single image in the same aspect ratio as the photo.";
/** Words that go with a look: keep the photo's arrangement, so its placement on the cover still holds. */
const KEEP = "Keep the photograph's composition: the same framing, the main subject in the same place and at the same size, the horizon and the large shapes where they are. Change how it is rendered, not what is where; leave out small clutter and photographic noise.";

/** Words that go with a new photo: what the picture is for. */
const FOR_A_PHOTO = "The picture goes on a video cover, under a title and graphics: no text, letters, numbers, logos, signatures or watermarks unless the description asks for them, no frame or border, and one single image.";
/** The prompt for a new photo: the user's words, and whether a reference picture goes with them. */
export function generatePrompt({ text = "", reference = false } = {}) {
  const ask = String(text).trim();
  const body = reference
    ? `Make a new picture from the attached reference image${ask ? `: ${ask}` : ", keeping its subject and its spirit."}`
    : `Make a picture: ${ask}`;
  return `${body}\n\n${FOR_A_PHOTO}`;
}

/**
 * The prompt for a repaint.
 *   source   "look" (the current look's description, in the channel colour), or "text" with the
 *            description in `text` (a built-in style's file, or one of the user's own styles)
 */
export function repaintPrompt({ source = "look", look = "cel", color = "#ffd60a", text = "", notes = "" } = {}) {
  let body;
  if (source === "text") body = text.trim();
  else {
    const L = LOOKS[look] || LOOKS.cel, how = typeof L.repaint === "function" ? L.repaint(color) : L.repaint || LOOKS.cel.repaint(color);
    body = `Repaint the attached photograph as ${how}\n\n${KEEP}`;
  }
  return [body, FOR_A_COVER, notes.trim() && `Also: ${notes.trim()}`].filter(Boolean).join("\n\n");
}
