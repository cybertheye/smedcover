// AI-generated assets: connection settings, the request for either API style, and the prompt.
// Pure functions, no DOM and no network — app.js sends what buildRequest() returns.
//
// The model is asked for a sticker *spec* (see spec.js): data for the house painters, not code to
// run. That keeps a generated asset in the same form as the built-in ones — drawn live, sharp at
// any size, able to follow the channel colour — without ever executing what a model wrote.

export const AI_STYLES = ["openai", "anthropic"];
export const AI_DEFAULTS = { style: "openai", baseUrl: "", token: "", model: "", auth: "key", maxTokens: 4096, proxy: "", notes: "" };
export const AI_PLACEHOLDER = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  anthropic: { baseUrl: "https://api.anthropic.com" },
};

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function normalizeAi(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const n = Math.round(Number(a.maxTokens));
  return {
    style: AI_STYLES.includes(a.style) ? a.style : "openai",
    baseUrl: str(a.baseUrl, 400), token: str(a.token, 4000), model: str(a.model, 200),
    auth: a.auth === "bearer" ? "bearer" : "key",                         // Anthropic style only
    maxTokens: Number.isFinite(n) ? Math.min(64000, Math.max(512, n)) : AI_DEFAULTS.maxTokens,
    proxy: str(a.proxy, 300),                                             // optional, e.g. http://127.0.0.1:7890
    notes: str(a.notes, 2000),
  };
}
/** Whether enough is filled in to send a request. A token is optional: local servers need none. */
export const aiReady = (cfg) => /^https?:\/\//i.test(cfg.baseUrl) && !!cfg.model;

/** Full URL of the chat endpoint for a base URL, tolerating a base that already includes the path. */
export function endpoint(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.style === "anthropic") return /\/messages$/.test(base) ? base : /\/v1$/.test(base) ? base + "/messages" : base + "/v1/messages";
  return /\/chat\/completions$/.test(base) ? base : base + "/chat/completions";
}

/**
 * The HTTP request for one generation: {url, headers, body}.
 *   OpenAI style     POST {base}/chat/completions, Authorization: Bearer, system + user messages.
 *                    No sampling or length parameters are sent: models differ in which they accept.
 *   Anthropic style  POST {base}/v1/messages, x-api-key (or Authorization: Bearer for gateways that
 *                    issue auth tokens), anthropic-version, a top-level system prompt and the
 *                    required max_tokens.
 */
export function buildRequest(cfg, system, user) {
  const headers = { "content-type": "application/json" };
  if (cfg.style === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (cfg.token) { if (cfg.auth === "bearer") headers.authorization = "Bearer " + cfg.token; else headers["x-api-key"] = cfg.token; }
    return { url: endpoint(cfg), headers, body: { model: cfg.model, max_tokens: cfg.maxTokens, system, messages: [{ role: "user", content: user }] } };
  }
  if (cfg.token) headers.authorization = "Bearer " + cfg.token;
  return { url: endpoint(cfg), headers, body: { model: cfg.model, messages: [{ role: "system", content: system }, { role: "user", content: user }] } };
}

/**
 * Reads a reply. Returns {text} or {error, truncated?}; `status` is the HTTP status, `raw` the body text.
 */
export function readReply(style, status, raw) {
  let json = null;
  try { json = JSON.parse(raw); } catch (e) { /* not JSON: reported below */ }
  if (status < 200 || status >= 300) {
    const e = json && json.error;
    const msg = (e && (typeof e === "string" ? e : e.message)) || (json && json.message) || String(raw || "").slice(0, 300) || "no response body";
    return { error: `HTTP ${status}: ${msg}` };
  }
  if (!json) return { error: "the server did not return JSON" };
  let text = "", truncated = false;
  if (style === "anthropic") {
    text = (Array.isArray(json.content) ? json.content : []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
    truncated = json.stop_reason === "max_tokens";
  } else {
    const c = json.choices && json.choices[0], m = c && c.message && c.message.content;
    text = Array.isArray(m) ? m.filter((p) => p && p.type === "text").map((p) => p.text).join("") : typeof m === "string" ? m : "";
    truncated = !!c && c.finish_reason === "length";
  }
  if (!text) return { error: truncated ? "the reply was cut off before any text" : "the reply contains no text", truncated };
  return { text, truncated };
}

/** Worked examples shown to the model. Each one is a valid spec (the tests check that). */
export const EXAMPLES = [
  {
    ask: "a heart",
    spec: { name: { zh: "爱心", en: "Heart" }, color: "#ff3b4f", ops: [
      { op: "shape", path: { curve: [["M", 0, 82], ["C", -118, 8, -74, -96, 0, -36], ["C", 74, -96, 118, 8, 0, 82]] }, fill: "main" },
      { op: "detail", pts: [[-46, -34], [-56, -14]], color: "white", lw: 9 },
    ] },
  },
  {
    ask: "a cup of coffee",
    spec: { name: { zh: "咖啡", en: "Coffee" }, color: "#ff8a00", ops: [
      { op: "line", curve: [["M", -30, -62], ["Q", -16, -76, -30, -92]], color: "white", lw: 6 },
      { op: "line", curve: [["M", 0, -62], ["Q", 14, -76, 0, -92]], color: "white", lw: 6 },
      { op: "line", curve: [["M", 30, -62], ["Q", 44, -76, 30, -92]], color: "white", lw: 6 },
      { op: "line", curve: [["M", 62, -4], ["Q", 96, 20, 60, 46]], color: "white", lw: 10 },
      { op: "shape", path: { poly: [[-70, -36], [56, -36], [42, 82], [-56, 82]] }, fill: "white" },
      { op: "shape", path: { poly: [[-66, 0], [52, 0], [47, 42], [-61, 42]] }, fill: "main", shadow: false, lw: 6 },
    ] },
  },
  {
    ask: "a cloud",
    spec: { name: { zh: "云朵", en: "Cloud" }, color: "#3a86ff", ops: [
      { op: "blob", paths: [{ circle: [-44, 6, 40] }, { circle: [-6, -24, 50] }, { circle: [46, 4, 38] }, { rrect: [-78, 6, 156, 44, 22] }], fill: "white" },
      { op: "detail", curve: [["M", -30, 26], ["Q", 0, 38, 30, 26]], color: "main", lw: 6 },
    ] },
  },
  {
    ask: "a SALE badge",
    spec: { name: { zh: "促销", en: "Sale" }, color: "#ff3b4f", ops: [
      { op: "shape", path: { star: [14, 96, 74] }, fill: "main" },
      { op: "text", text: "SALE", size: 70, fill: "white", rotate: -0.1 },
    ] },
  },
];

/** The preset style prompt: what the house style is, and the exact data format to answer in. */
export const SYSTEM_PROMPT = `You design stickers for SmedCover, an app for making video cover images. You answer with a sticker described as DATA: one JSON object that the app draws with its own painters. You never write code, SVG or prose.

# House style
Bold cel-shaded stickers that read at a glance on a busy cover:
- a few big, simple shapes with a strong silhouette; no fine detail, no realism, no perspective;
- flat colour only — never gradients, textures or transparency;
- a heavy near-black ink outline and a hard offset shadow, which the painters add for you;
- 2 to 4 colours per sticker: one main colour, white, ink, and at most one extra accent;
- friendly, chunky proportions; rounded where it helps.

# Canvas
A 200 x 200 box centred on the origin: x runs right, y runs DOWN, both from -100 to 100. Fill the box: the sticker should span about 170–190 units in its larger dimension and be centred. Keep every coordinate within -100…100.

# Colours
Use "main" for the sticker's main colour: the app may recolour it to match a channel, so the subject must still read when "main" is any bright colour. Other colours: "white", "ink" (near black), "red", "yellow", "orange", "blue", "green", "pink", or "#rrggbb". Set the top-level "color" to the natural colour of the subject (a "#rrggbb" value); that is what "main" means by default.

# Operations
Painted in order, later ones on top. Each may also carry "move": [dx, dy] and "rotate": radians.
- {"op":"shape","path":PATH,"fill":COLOUR}  — a closed shape: shadow, flat fill, ink outline. Optional "shadow": false for shapes that sit on top of another shape (inner panels, eyes, highlights), and "lw" (outline width, default 7; use 5–6 for small inner shapes).
- {"op":"blob","paths":[PATH,…],"fill":COLOUR} — several overlapping shapes merged into ONE silhouette with a single outline (clouds, a body made of circles, a mug with its base).
- {"op":"line","pts":[[x,y],…],"color":COLOUR,"lw":30} — a thick inked stroke (check marks, handles, stems). "curve" may be used instead of "pts". lw 6–44.
- {"op":"detail","pts":[[x,y],…],"color":"ink","lw":6} — a thin plain line for inner detail (creases, facets, a smile). "curve" may be used instead of "pts". lw 2–14.
- {"op":"text","text":"…","size":80,"fill":COLOUR,"x":0,"y":0} — heavy outlined lettering centred on (x, y), at most 10 characters. Only when the subject is a word or needs a label.

# Paths
- {"poly":[[x,y],…]} — a polygon, at least 3 points.
- {"circle":[x,y,r]}
- {"rrect":[x,y,width,height,cornerRadius]} — x, y is the top-left corner.
- {"star":[points,outerRadius,innerRadius]} — centred on the origin; use "move" to place it.
- {"curve":[["M",x,y],["L",x,y],["Q",cx,cy,x,y],["C",c1x,c1y,c2x,c2y,x,y],…]} — starts with exactly one "M"; closed automatically when used as a shape.

# How to build a sticker
1. Draw things that sit BEHIND first (handles, steam, legs), then the main body, then what sits on top.
2. Give the main body "main"; use white for secondary parts and highlights so the sticker survives recolouring.
3. Inner shapes get "shadow": false.
4. Use at most 12 operations. Fewer, bigger shapes look better.

# Answer format
Reply with exactly one JSON object and nothing else — no code fence, no explanation:
{"name":{"zh":"中文名","en":"English name"},"color":"#rrggbb","ops":[…]}
The names are short (1–4 words). The request may be in any language.

# Examples
${EXAMPLES.map((e) => `Request: ${e.ask}\n${JSON.stringify(e.spec)}`).join("\n\n")}`;

/** The two halves of a request: the preset prompt (plus the user's standing notes) and the subject. */
export function buildPrompt(target, notes = "") {
  const system = notes ? `${SYSTEM_PROMPT}\n\n# Additional requirements from the user\n${notes}` : SYSTEM_PROMPT;
  return { system, user: `Request: ${String(target).trim().slice(0, 300)}` };
}
