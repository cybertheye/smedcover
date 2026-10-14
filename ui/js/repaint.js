// Repainting the background photo with an image model: the photo and a description of the wanted
// style go out, a new picture comes back and takes the photo's place (the original is kept).
//
// Three kinds of service are spoken to, each in its own form:
//   openai    POST {base}/images/edits                       Authorization: Bearer
//             {model, prompt, images: [{image_url: data URL}], size}      -> data[0].b64_json
//   gemini    POST {base}/models/{model}:generateContent      x-goog-api-key
//             {contents: [{parts: [{text}, {inlineData}]}], generationConfig} -> candidates[0].content.parts[].inlineData
//   seedream  POST {base}/images/generations                  Authorization: Bearer   (Volcengine Ark / BytePlus)
//             {model, prompt, image: data URL, size: "WxH", response_format: "b64_json"} -> data[0].b64_json or .url
//
// The style comes from one of three sources: the current look (each look has a `repaint`
// description, see style.js), a built-in style (a Markdown file in ui/repaint-styles/, see below),
// or one of the user's own styles — a name and a description, kept in image-ai.json, which can
// start as a copy of a built-in one.
import { LOOKS } from "./style.js";

export const IMAGE_PROVIDERS = ["openai", "gemini", "seedream"];
export const IMAGE_DEFAULTS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.1-flash-image" },
  seedream: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-5-0-lite-260128" },
};
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const MAX_STYLES = 50;
/** A user style: {id, name, prompt}. */
const normalizeStyle = (s, i) => ({ id: str(s && s.id, 40).replace(/[^\w-]/g, "") || `s${i}`, name: str(s && s.name, 40) || `#${i + 1}`, prompt: s && typeof s.prompt === "string" ? s.prompt.slice(0, 20000) : "" });

/** The image model settings, as stored in image-ai.json. */
export function normalizeImageAi(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const secs = Math.round(Number(a.timeout));
  const styles = [], seen = new Set();
  for (const s of Array.isArray(a.styles) ? a.styles.slice(0, MAX_STYLES) : []) {
    const n = normalizeStyle(s, styles.length);
    if (seen.has(n.id)) n.id += "_" + styles.length;
    seen.add(n.id); styles.push(n);
  }
  // before there were saved styles, one custom description was kept as `custom`
  if (typeof a.custom === "string" && a.custom.trim() && !styles.length) styles.push({ id: "custom", name: "自定义", prompt: a.custom.slice(0, 20000) });
  let source = typeof a.source === "string" ? a.source : "look";
  if (source === "custom") source = styles.length ? "my:" + styles[0].id : "look";
  if (source === "pixel") source = "preset:8-bit-pixel-editorial";   // the built-in style's name before styles were files
  // a built-in style is checked against the list once that has been read (see app.js)
  if (!(source === "look" || /^preset:[a-z0-9-]+$/.test(source) || (source.startsWith("my:") && styles.some((s) => "my:" + s.id === source)))) source = "look";
  return {
    provider: IMAGE_PROVIDERS.includes(a.provider) ? a.provider : "openai",
    baseUrl: str(a.baseUrl, 400), token: str(a.token, 4000), model: str(a.model, 200),
    timeout: Number.isFinite(secs) && secs > 0 ? Math.min(1800, Math.max(30, secs)) : 300,
    proxy: str(a.proxy, 300),
    source,                   // where the style comes from: "look", "preset:<id>" (a built-in style), or "my:<id>" (one of `styles`)
    styles,                   // the user's own styles (a description may be long, e.g. a pasted skill)
    notes: str(a.notes, 600), // a word added to any source
  };
}
/** Whether enough is filled in to send a request. */
export const imageReady = (cfg) => (!cfg.baseUrl || /^https?:\/\//i.test(cfg.baseUrl)) && !!cfg.model && !!cfg.token;   // an empty address means the service's own

/** The full URL of the request, tolerating a base that already includes the path. */
export function imageEndpoint(cfg) {
  const base = (cfg.baseUrl || IMAGE_DEFAULTS[cfg.provider].baseUrl).replace(/\/+$/, "");
  if (cfg.provider === "gemini") {
    if (/:generateContent$/.test(base)) return base;
    return `${/\/v1(beta)?$/.test(base) ? base : base + "/v1beta"}/models/${encodeURIComponent(cfg.model)}:generateContent`;
  }
  if (cfg.provider === "seedream") return /\/images\/generations$/.test(base) ? base : base + "/images/generations";
  return /\/images\/edits$/.test(base) ? base : base + "/images/edits";
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

/** The HTTP request for one repaint: {url, headers, body}. `image` is {mime, data} with the data in base64. */
export function buildImageRequest(cfg, prompt, image, w, h) {
  const url = imageEndpoint(cfg), dataUrl = `data:${image.mime};base64,${image.data}`, size = repaintSize(cfg, w, h);
  if (cfg.provider === "gemini") {
    return {
      url, headers: { "content-type": "application/json", "x-goog-api-key": cfg.token },
      body: { contents: [{ role: "user", parts: [{ inlineData: { mimeType: image.mime, data: image.data } }, { text: prompt }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } },
    };
  }
  const headers = { "content-type": "application/json", authorization: `Bearer ${cfg.token}` };
  if (cfg.provider === "seedream") {
    return { url, headers, body: { model: cfg.model, prompt, image: dataUrl, size, response_format: "b64_json", watermark: false } };
  }
  return { url, headers, body: { model: cfg.model, prompt, images: [{ image_url: dataUrl }], size, n: 1 } };
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
  const root = base.replace(/\/images\/edits$/, "");
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

// ---------- built-in styles: one Markdown file each in ui/repaint-styles/, named "中文名_English name.md"
//
// The file is the prompt; <!-- comments --> in it (credits, notes) are not sent. The list of files is
// ui/repaint-styles/index.json, written by scripts/repaint-styles.mjs before every build, since a
// bundled app cannot list a folder. A style's id comes from its English name and is what settings
// remember, so renaming the English half makes it a different style.

/** A style's id from its English name: "8-bit pixel editorial" -> "8-bit-pixel-editorial". */
export const styleId = (en) => en.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/**
 * The index entries for a folder's .md files: {styles: [{id, file, name: {zh, en}}], errors}.
 * `read(file)` returns a file's text, to make sure none is empty. Sorted by English name.
 */
export function styleIndex(files, read = () => "x") {
  const styles = [], errors = [], seen = new Map();
  for (const file of files) {
    const m = file.match(/^([^_]+)_(.+)\.md$/);
    if (!m || !m[1].trim() || !m[2].trim()) { errors.push(`${file}: the name must be 中文名_English name.md`); continue; }
    const name = { zh: m[1].trim(), en: m[2].trim() }, id = styleId(name.en);
    if (!id) { errors.push(`${file}: the English name needs a letter or a digit`); continue; }
    if (seen.has(id)) { errors.push(`${file}: the same id (${id}) as ${seen.get(id)}`); continue; }
    if (!promptOf(read(file))) { errors.push(`${file}: no prompt in it`); continue; }
    seen.set(id, file); styles.push({ id, file, name });
  }
  styles.sort((a, b) => a.name.en.localeCompare(b.name.en));
  return { styles, errors };
}
/** The prompt in a style file: its text without <!-- comments -->, trimmed. */
export const promptOf = (md) => String(md).replace(/<!--[\s\S]*?-->/g, "").replace(/\n{3,}/g, "\n\n").trim();

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
    texts.set(style.id, promptOf(await r.text()));
  }
  return texts.get(style.id);
}

/** Words that go with every source: what the picture is for. */
const FOR_A_COVER = "The result becomes the background of a video cover, with a title and graphics laid over it: no text, letters, numbers, logos, signatures or watermarks, no frame or border, and one single image in the same aspect ratio as the photo.";
/** Words that go with a look: keep the photo's arrangement, so its placement on the cover still holds. */
const KEEP = "Keep the photograph's composition: the same framing, the main subject in the same place and at the same size, the horizon and the large shapes where they are. Change how it is rendered, not what is where; leave out small clutter and photographic noise.";

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
