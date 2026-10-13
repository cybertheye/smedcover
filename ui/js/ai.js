// AI-generated assets: connection settings, the request for either API style, and the prompt.
// Pure functions, no DOM and no network — app.js sends what buildRequest() returns.
//
// The model is asked for a sticker *spec* (see spec.js): data for the house painters, not code to
// run. That keeps a generated asset in the same form as the built-in ones — drawn live, sharp at
// any size, able to follow the channel colour — without ever executing what a model wrote.

export const AI_STYLES = ["openai", "anthropic"];
export const AI_DEFAULTS = { style: "openai", baseUrl: "", token: "", model: "", auth: "key", maxTokens: 4096, timeout: 300, proxy: "", notes: "" };
export const AI_PLACEHOLDER = {
  openai: { baseUrl: "https://api.openai.com/v1" },
  anthropic: { baseUrl: "https://api.anthropic.com" },
};

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export function normalizeAi(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const n = Math.round(Number(a.maxTokens)), secs = Math.round(Number(a.timeout));
  return {
    style: AI_STYLES.includes(a.style) ? a.style : "openai",
    baseUrl: str(a.baseUrl, 400), token: str(a.token, 4000), model: str(a.model, 200),
    auth: a.auth === "bearer" ? "bearer" : "key",                         // Anthropic style only
    maxTokens: Number.isFinite(n) ? Math.min(64000, Math.max(512, n)) : AI_DEFAULTS.maxTokens,
    timeout: Number.isFinite(secs) && secs > 0 ? Math.min(1800, Math.max(30, secs)) : AI_DEFAULTS.timeout,   // seconds to wait for a reply
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
    spec: { name: {"zh": "爱心", "en": "Heart"}, color: "#ff3b4f", ops: [
      {"op": "shape", "path": {"curve": [["M", 0, 82], ["C", -118, 8, -74, -96, 0, -36], ["C", 74, -96, 118, 8, 0, 82]]}, "fill": "main"},
      {"op": "detail", "pts": [[-46, -34], [-56, -14]], "color": "white", "lw": 9},
    ] },
  },
  {
    ask: "a cup of coffee",
    spec: { name: {"zh": "咖啡", "en": "Coffee"}, color: "#ff8a00", ops: [
      {"op": "line", "curve": [["M", -30, -62], ["Q", -16, -76, -30, -92]], "color": "white", "lw": 6},
      {"op": "line", "curve": [["M", 0, -62], ["Q", 14, -76, 0, -92]], "color": "white", "lw": 6},
      {"op": "line", "curve": [["M", 30, -62], ["Q", 44, -76, 30, -92]], "color": "white", "lw": 6},
      {"op": "line", "arc": [56, 20, 26, -70, 75], "color": "white", "lw": 10},
      {"op": "shape", "path": {"poly": [[-70, -36], [56, -36], [42, 82], [-56, 82]]}, "fill": "white"},
      {"op": "shape", "path": {"poly": [[-66, 0], [52, 0], [47, 42], [-61, 42]]}, "fill": "main", "shadow": false, "lw": 6},
    ] },
  },
  {
    ask: "a cat",
    spec: { name: {"zh": "猫", "en": "Cat"}, color: "#ff8a00", ops: [
      {"op": "line", "curve": [["M", 34, 74], ["Q", 92, 70, 76, 14]], "color": "main", "lw": 20},
      {"op": "shape", "path": {"ellipse": [0, 46, 50, 46]}, "fill": "main"},
      {"op": "shape", "path": {"ellipse": [0, 58, 26, 30]}, "fill": "white", "shadow": false, "lw": 5},
      {"op": "shape", "path": {"ellipse": [-20, 88, 17, 10]}, "fill": "white", "shadow": false, "lw": 5, "mirror": true},
      {"op": "shape", "path": {"poly": [[-64, -98], [-12, -62], [-62, -28]]}, "fill": "main", "mirror": true},
      {"op": "shape", "path": {"poly": [[-56, -84], [-32, -66], [-55, -48]]}, "fill": "pink", "shadow": false, "lw": 4, "mirror": true},
      {"op": "shape", "path": {"ellipse": [0, -24, 58, 44]}, "fill": "main"},
      {"op": "shape", "path": {"circle": [-24, -28, 8]}, "fill": "ink", "shadow": false, "lw": 3, "mirror": true},
      {"op": "shape", "path": {"poly": [[-7, -12], [7, -12], [0, -4]]}, "fill": "pink", "shadow": false, "lw": 4},
      {"op": "detail", "arc": [-8, -4, 8, 10, 170], "lw": 4, "mirror": true},
      {"op": "detail", "pts": [[-36, -8], [-62, -14]], "lw": 3, "mirror": true},
    ] },
  },
  {
    ask: "a car",
    spec: { name: {"zh": "小汽车", "en": "Car"}, color: "#ff3b4f", ops: [
      {"op": "blob", "paths": [{"rrect": [-94, -8, 188, 52, 20]}, {"poly": [[-52, -4], [-32, -56], [34, -56], [64, -4]]}], "fill": "main"},
      {"op": "shape", "path": {"poly": [[-38, -10], [-24, -44], [-2, -44], [-2, -10]]}, "fill": "white", "shadow": false, "lw": 5},
      {"op": "shape", "path": {"poly": [[8, -10], [8, -44], [28, -44], [48, -10]]}, "fill": "white", "shadow": false, "lw": 5},
      {"op": "detail", "pts": [[3, -6], [3, 38]], "lw": 4},
      {"op": "shape", "path": {"rrect": [78, 4, 14, 14, 5]}, "fill": "yellow", "shadow": false, "lw": 4},
      {"op": "shape", "path": {"circle": [-50, 46, 25]}, "fill": "ink", "mirror": true},
      {"op": "shape", "path": {"circle": [-50, 46, 10]}, "fill": "white", "shadow": false, "lw": 4, "mirror": true},
    ] },
  },
  {
    ask: "a burger",
    spec: { name: {"zh": "汉堡", "en": "Burger"}, color: "#f2a03d", ops: [
      {"op": "shape", "path": {"rrect": [-82, 52, 164, 36, 18]}, "fill": "main"},
      {"op": "shape", "path": {"rrect": [-90, 26, 180, 32, 14]}, "fill": "#8a5a3c", "shadow": false},
      {"op": "shape", "path": {"poly": [[-88, 12], [88, 12], [88, 26], [44, 26], [24, 46], [4, 26], [-88, 26]]}, "fill": "yellow", "shadow": false, "lw": 5},
      {"op": "shape", "path": {"curve": [["M", -94, 2], ["Q", -70, 26, -47, 8], ["Q", -23, 26, 0, 8], ["Q", 23, 26, 47, 8], ["Q", 70, 26, 94, 2], ["L", 94, -10], ["L", -94, -10]]}, "fill": "green", "shadow": false, "lw": 5},
      {"op": "shape", "path": {"curve": [["M", -86, -10], ["C", -86, -102, 86, -102, 86, -10]]}, "fill": "main"},
      {"op": "detail", "pts": [[-34, -56], [-26, -62]], "color": "white", "lw": 7},
      {"op": "detail", "pts": [[4, -70], [14, -70]], "color": "white", "lw": 7},
      {"op": "detail", "pts": [[36, -50], [44, -44]], "color": "white", "lw": 7},
    ] },
  },
  {
    ask: "a SALE badge",
    spec: { name: {"zh": "促销", "en": "Sale"}, color: "#ff3b4f", ops: [
      {"op": "shape", "path": {"star": [14, 96, 74]}, "fill": "main"},
      {"op": "text", "text": "SALE", "size": 70, "fill": "white", "turn": -6},
    ] },
  },
];

/**
 * What a style asks of the *shapes*. The look itself — outline, shadow, flat fill — is applied by
 * the painters, so it is described only as far as the model needs in order not to fight it.
 * A style added later brings its own entry here (and its own painters).
 */
export const STYLE_NOTES = {
  cel: `Bold cel-shaded stickers that read at a glance on a busy cover:
- big, simple, rounded shapes with a strong silhouette; chunky, friendly proportions; no realism, no perspective, no fine detail;
- flat colour only — never gradients, textures or transparency;
- every shape automatically gets a heavy near-black ink outline, and a hard offset shadow: do NOT draw outlines or shadows yourself;
- 2 to 4 colours per sticker: one main colour, white, ink, and at most one or two small accents.`,
};

/** The preset prompt: the style, how to construct a drawing, and the exact data format to answer in. */
export const systemPrompt = (style = "cel") => `You design stickers for SmedCover, an app for making video cover images. You answer with a sticker described as DATA: one JSON object that the app draws with its own painters. You never write code, SVG or prose.

# Style
${STYLE_NOTES[style] || STYLE_NOTES.cel}

# Canvas
A 200 x 200 box centred on the origin: x runs right, y runs DOWN, both from -100 to 100. The sticker is centred and fills the box: about 180 units in its larger dimension. Keep every coordinate within -100…100.

# Colours
Use "main" for the sticker's main colour: the app recolours it to match a channel, so the subject must still read when "main" is any bright colour. Other colours: "white", "ink" (near black), "red", "yellow", "orange", "blue", "green", "pink", or "#rrggbb". Set the top-level "color" to the natural colour of the subject (a "#rrggbb" value); that is what "main" means by default.

# Operations
Painted in order, later ones on top.
- {"op":"shape","path":PATH,"fill":COLOUR} — a closed shape: shadow, flat fill, ink outline. Optional "shadow": false for anything that sits ON another shape (inner panels, eyes, windows, patches), and "lw" (outline width, default 7; 4–5 for small inner shapes).
- {"op":"blob","paths":[PATH,…],"fill":COLOUR} — several overlapping shapes merged into ONE silhouette with a single outline (a car body plus its cabin, a cloud, a hand).
- {"op":"line","pts":[[x,y],…],"color":COLOUR,"lw":30} — a thick inked stroke (tails, handles, stems, check marks). lw 6–44.
- {"op":"detail","pts":[[x,y],…],"color":"ink","lw":6} — a thin plain line for inner detail (a mouth, whiskers, creases, a door seam). lw 2–14.
  Instead of "pts", a line or detail may use "curve" (see Paths) or "arc": [x,y,r,fromDegrees,toDegrees] with 0 = right and 90 = down, so [0,0,10,10,170] is a smile.
- {"op":"text","text":"…","size":80,"fill":COLOUR,"x":0,"y":0} — heavy outlined lettering centred on (x, y), at most 10 characters. Only when the subject is a word or needs a label.
Any operation may also carry:
- "mirror": true — paints it twice, the second time reflected left-to-right across the centre line (x → -x). Use it for every pair: eyes, ears, arms, legs, wheels, wings. Draw the LEFT one and mirror it.
- "move": [dx, dy] and "turn": degrees (clockwise) — to shift or rotate it.

# Paths
- {"circle":[x,y,r]}
- {"ellipse":[x,y,rx,ry]} — optional fifth number: tilt in degrees.
- {"rrect":[x,y,width,height,cornerRadius]} — x, y is the top-left corner.
- {"poly":[[x,y],…]} — a polygon, at least 3 points.
- {"star":[points,outerRadius,innerRadius]} — centred on the origin; use "move" to place it.
- {"curve":[["M",x,y],["L",x,y],["Q",cx,cy,x,y],["C",c1x,c1y,c2x,c2y,x,y],…]} — starts with exactly one "M"; closed automatically when used as a shape.

# How to design a sticker
Think it through before writing, then output only the JSON.
1. Pick the most recognisable view: animals and characters sitting and facing the viewer; vehicles from the side; objects straight on.
2. List the 4–8 parts that make the subject recognisable (a cat: ears, head, body, tail, paws, face). Leave out everything else.
3. Give each part a box inside the canvas so the whole drawing spans about 180 units and the parts overlap where they join — a head overlaps its body, ears are tucked behind the head. Parts that merely touch look broken.
4. Exaggerate what identifies the subject: a big head (about half the height) and large simple features for animals and characters; fat wheels for vehicles; clear layers for food.
5. Order: what is BEHIND first (tail, far limbs, ears), then the body, then the head, then what sits on top (face, windows, highlights, labels).
6. Faces are simple: ink circles for eyes, a small nose, an arc for the mouth, all with "shadow": false.
7. Give the body and head "main"; use white for bellies, windows and highlights so the sticker survives recolouring.
8. Use ellipses and rounded rectangles in preference to polygons for anything organic, and "mirror" for anything symmetric.
9. 8 to 16 operations is typical. Fewer, bigger shapes beat many small ones.

# Answer format
Reply with exactly one JSON object and nothing else — no code fence, no explanation:
{"name":{"zh":"中文名","en":"English name"},"color":"#rrggbb","ops":[…]}
The names are short (1–4 words). The request may be in any language.

# Examples
${EXAMPLES.map((e) => `Request: ${e.ask}\n${JSON.stringify(e.spec)}`).join("\n\n")}`;
export const SYSTEM_PROMPT = systemPrompt();

/** The two halves of a request: the preset prompt (plus the user's standing notes) and the subject. */
export function buildPrompt(target, notes = "", style = "cel") {
  const SYSTEM_PROMPT = systemPrompt(style);
  const system = notes ? `${SYSTEM_PROMPT}\n\n# Additional requirements from the user\n${notes}` : SYSTEM_PROMPT;
  return { system, user: `Request: ${String(target).trim().slice(0, 300)}` };
}
