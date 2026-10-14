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
// description, see style.js), a preset bundled here, or text the user writes or pastes.
import { LOOKS } from "./style.js";

export const IMAGE_PROVIDERS = ["openai", "gemini", "seedream"];
export const IMAGE_DEFAULTS = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "gemini-3.1-flash-image" },
  seedream: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seedream-5-0-lite-260128" },
};
export const REPAINT_SOURCES = ["look", "pixel", "custom"];
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The image model settings, as stored in image-ai.json. */
export function normalizeImageAi(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const secs = Math.round(Number(a.timeout));
  return {
    provider: IMAGE_PROVIDERS.includes(a.provider) ? a.provider : "openai",
    baseUrl: str(a.baseUrl, 400), token: str(a.token, 4000), model: str(a.model, 200),
    timeout: Number.isFinite(secs) && secs > 0 ? Math.min(1800, Math.max(30, secs)) : 300,
    proxy: str(a.proxy, 300),
    source: REPAINT_SOURCES.includes(a.source) ? a.source : "look",   // where the style comes from
    custom: typeof a.custom === "string" ? a.custom.slice(0, 20000) : "",   // the user's own description (may be long, e.g. a pasted skill)
    notes: str(a.notes, 600),                                                // a word added to any source
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
    return { url, headers, body: { model: cfg.model, prompt, image: dataUrl, size, sequential_image_generation: "disabled", response_format: "b64_json", watermark: false } };
  }
  return { url, headers, body: { model: cfg.model, prompt, images: [{ image_url: dataUrl }], size, n: 1 } };
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

/** Bundled style presets: id -> {name, prompt}. */
export const REPAINT_PRESETS = {
  // Adapted from "Abstract 8-bit Instagram Pixel Editorial" by TwentyfiveBTea
  // (https://github.com/TwentyfiveBTea/8bit-pixel-art, AGPL-3.0): its "fuse" mode, condensed into a
  // single instruction for an image model, and the 3:5 canvas replaced by the photo's own shape.
  pixel: {
    name: { zh: "8-bit 像素编辑", en: "8-bit pixel editorial" },
    prompt: `Reinterpret the attached photo as one sparse, abstract 8-bit pixel editorial artwork. This is a distillation, not a pixel filter: the photo is information to analyse, not a surface to pixelate.

1. Read the photo first: the anchor subject or relationship that must stay recognisable; its one to three largest masses and their scale; one or two axes or gestures (a horizon, path, roofline, diagonal); its rhythm and asymmetry; its quiet, open side; its colour roles — one dominant, one dark structural, one light or neutral, one or two subject midtones, at most one small accent. If one subject clearly dominates, give it nearly all the detail and keep one to three cues that identify it. If none does, keep only the strongest spatial gesture or colour relationship; do not invent a focal object.

2. Choose a boundary mode. For a clear, isolatable subject (the default): a soft-edged cluster of coarse pixel blocks on an even, matte, near-uniform paper field — warm ivory, off-white, cool white, pale grey or pale blue, whichever separates best from the subject while keeping the photo's temperature. The cluster covers roughly 8–18% of the picture, stays at least 6% from every edge, sits where the subject sits in the photo rather than centred by habit, and its perimeter breaks up in stepped erosion, gaps and a few dissolving blocks — never a clean rectangle, a sticker outline or a straight shared baseline. For a continuous scene (sea and sky, a panoramic landscape, a corridor) with nothing to isolate: carry three or four broad pixel planes to every edge, keeping the photo's main directions.

3. Pixel marks: one primary family — flat coarse masses, stepped silhouettes, segmented bars or paths, stacked bands, irregular clusters of blocks, or simplified planes — and at most two supporting ones (short lines, isolated blocks, compact dots, one accent). Work as if on a logical grid of 32–64 pixels along the short edge, enlarged with hard nearest-neighbour edges: large crisp blocks, broad grouped values, contours partly lost. No one-pixel outlines, anti-aliasing, gradients, dithering, grain, regular grids, game interface or sprites.

4. The paper field stays truly empty: no sky, ground, texture, shadows, vignette, particles, border or colour swatches. Keep the photo's colours and the order of its lights and darks; add no colour it does not have. Never keep foreground, middle ground and background as three readable layers.

5. No photographic area, no pasted panel, no before/after or split layout, no invented objects.`,
  },
};

/** Words that go with every source: what the picture is for. */
const FOR_A_COVER = "The result becomes the background of a video cover, with a title and graphics laid over it: no text, letters, numbers, logos, signatures or watermarks, no frame or border, and one single image in the same aspect ratio as the photo.";
/** Words that go with a look: keep the photo's arrangement, so its placement on the cover still holds. */
const KEEP = "Keep the photograph's composition: the same framing, the main subject in the same place and at the same size, the horizon and the large shapes where they are. Change how it is rendered, not what is where; leave out small clutter and photographic noise.";

/**
 * The prompt for a repaint.
 *   source   "look" (the current look's description, in the channel colour), a preset id, or "custom"
 */
export function repaintPrompt({ source = "look", look = "cel", color = "#ffd60a", custom = "", notes = "" } = {}) {
  let body;
  if (source === "custom") body = custom.trim();
  else if (REPAINT_PRESETS[source]) body = REPAINT_PRESETS[source].prompt;
  else {
    const L = LOOKS[look] || LOOKS.cel, how = typeof L.repaint === "function" ? L.repaint(color) : L.repaint || LOOKS.cel.repaint(color);
    body = `Repaint the attached photograph as ${how}\n\n${KEEP}`;
  }
  return [body, FOR_A_COVER, notes.trim() && `Also: ${notes.trim()}`].filter(Boolean).join("\n\n");
}
