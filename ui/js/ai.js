// AI-generated assets: connection settings, the request for either API style, and the prompt.
// Pure functions, no DOM and no network — app.js sends what buildRequest() returns.
//
// The model is asked for a sticker *spec* (see spec.js): data for the house painters, not code to
// run. That keeps a generated asset in the same form as the built-in ones — drawn live, sharp at
// any size, able to follow the channel colour — without ever executing what a model wrote.

import { LOOKS } from "./style.js";

export const AI_STYLES = ["openai", "anthropic"];
export const AI_DEFAULTS = { style: "openai", baseUrl: "", token: "", model: "", auth: "key", maxTokens: 4096, timeout: 300, proxy: "", notes: "", kind: "solid" };
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
    kind: a.kind === "flat" ? "flat" : "solid",                           // what the Assets tab generates
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
  const turns = Array.isArray(user) ? user : [{ role: "user", content: user }];   // a string, or the conversation so far
  const headers = { "content-type": "application/json" };
  if (cfg.style === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (cfg.token) { if (cfg.auth === "bearer") headers.authorization = "Bearer " + cfg.token; else headers["x-api-key"] = cfg.token; }
    return { url: endpoint(cfg), headers, body: { model: cfg.model, max_tokens: cfg.maxTokens, system, messages: turns } };
  }
  if (cfg.token) headers.authorization = "Bearer " + cfg.token;
  return { url: endpoint(cfg), headers, body: { model: cfg.model, messages: [{ role: "system", content: system }, ...turns] } };
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
${STYLE_NOTES[style] || (LOOKS[style] && LOOKS[style].prompt) || STYLE_NOTES.cel}

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

/** Worked examples for solid (3D) assets. Each one is a valid spec (the tests check that). */
export const SOLID_EXAMPLES = [
  {
    ask: "a camera",
    spec: { kind: "solid", name: {"zh": "相机", "en": "Camera"}, color: "#fcee0a", view: [-17, -32, 3], parts: [
      {"box": [440, 260, 150], "at": [0, 20, 0], "tone": "white"},
      {"box": [170, 62, 110], "at": [-40, -141, 0], "tone": "white"},
      {"box": [60, 26, 60], "at": [152, -123, 0], "tone": "main"},
      {"box": [84, 260, 46], "at": [-176, 20, 98], "tone": "white"},
      {"cyl": [128, 120], "axis": "z", "at": [40, 25, 135], "tone": "dark"},
      {"cyl": [104, 56], "axis": "z", "at": [40, 25, 222], "tone": "dark"},
    ], marks: [
      {"circle": [40, 25, 80], "z": 251, "fill": "ink"},
      {"circle": [40, 25, 52], "z": 252, "fill": "shade", "line": 5},
      {"circle": [18, 3, 15], "z": 253, "fill": "white"},
      {"rect": [-190, -78, -110, -44], "z": 76, "fill": "ink"},
    ] },
  },
  {
    ask: "a game controller",
    spec: { kind: "solid", name: {"zh": "游戏手柄", "en": "Gamepad"}, color: "#fcee0a", view: [-24, -22, -5], parts: [
      {"box": [400, 170, 90], "at": [0, -10, 0], "tone": "white"},
      {"box": [116, 200, 80], "at": [-178, 66, -8], "tone": "white", "turn": [0, 0, 11]},
      {"box": [116, 200, 80], "at": [178, 66, -8], "tone": "white", "turn": [0, 0, -11]},
      {"box": [70, 26, 50], "at": [-110, -104, 0], "tone": "dark"},
      {"box": [70, 26, 50], "at": [110, -104, 0], "tone": "dark"},
    ], marks: [
      {"rect": [-158, -32, -62, -2], "z": 46, "fill": "ink"},
      {"rect": [-125, -65, -95, 31], "z": 46, "fill": "ink"},
      {"circle": [110, -52, 19], "z": 46, "fill": "main", "line": 5},
      {"circle": [150, -17, 19], "z": 46, "fill": "main", "line": 5},
      {"circle": [70, -17, 19], "z": 46, "fill": "main", "line": 5},
      {"circle": [110, 18, 19], "z": 46, "fill": "main", "line": 5},
      {"rect": [-22, -30, 22, -14], "z": 46, "fill": "ink"},
    ] },
  },
  {
    ask: "a microphone",
    spec: { kind: "solid", name: {"zh": "麦克风", "en": "Microphone"}, color: "#fcee0a", view: [-13, -29, 9], parts: [
      {"cyl": [78, 34], "axis": "y", "tip": 52, "at": [0, -232, 0], "tone": "dark"},
      {"cyl": [96, 190], "axis": "y", "at": [0, -120, 0], "tone": "dark"},
      {"cyl": [102, 30], "axis": "y", "at": [0, -12, 0], "tone": "main"},
      {"cyl": [62, 120], "axis": "y", "at": [0, 62, 0], "tone": "white"},
      {"box": [26, 96, 26], "at": [0, 168, 0], "tone": "dark"},
      {"cyl": [132, 26], "axis": "y", "at": [0, 228, 0], "tone": "dark", "sides": 22},
    ], marks: [] },
  },
  {
    ask: "a robot",
    spec: { kind: "solid", name: {"zh": "机器人", "en": "Robot"}, color: "#fcee0a", view: [-14, -30, 0], parts: [
      {"box": [150, 190, 110], "at": [0, 70, 0], "tone": "white"},
      {"box": [210, 150, 130], "at": [0, -110, 0], "tone": "white"},
      {"cyl": [9, 50], "axis": "y", "at": [0, -210, 0], "tone": "dark"},
      {"cyl": [20, 20], "axis": "y", "at": [0, -244, 0], "tone": "main"},
      {"box": [44, 150, 54], "at": [-102, 60, 0], "tone": "main"},
      {"box": [44, 150, 54], "at": [102, 60, 0], "tone": "main"},
      {"box": [56, 70, 70], "at": [-42, 200, 0], "tone": "dark"},
      {"box": [56, 70, 70], "at": [42, 200, 0], "tone": "dark"},
      {"cyl": [26, 24], "axis": "x", "at": [-118, -110, 0], "tone": "dark"},
      {"cyl": [26, 24], "axis": "x", "at": [118, -110, 0], "tone": "dark"},
    ], marks: [
      {"rect": [-80, -150, 80, -80], "z": 66, "fill": "ink"},
      {"circle": [-40, -115, 17], "z": 67, "fill": "main"},
      {"circle": [40, -115, 17], "z": 67, "fill": "main"},
      {"rect": [-40, 20, 40, 70], "z": 56, "fill": "shade", "line": 5},
      {"circle": [-18, 45, 9], "z": 57, "fill": "white", "line": 4},
      {"path": [[4, 36], [30, 36]], "z": 57, "closed": false, "line": 5},
      {"path": [[4, 54], [30, 54]], "z": 57, "closed": false, "line": 5},
    ] },
  },
];

/** What a style asks of a solid object's construction (see STYLE_NOTES for the idea). */
export const SOLID_STYLE_NOTES = {
  cel: `Chunky cel-shaded 3D objects, like toys or low-poly models, that read at a glance on a busy cover:
- built from a few boxes and cylinders with clear, exaggerated proportions; no realism, no fine detail;
- the renderer shades every face in three flat tones, prints screentone dots on the shadow side, inks every edge and adds a ground shadow: do NOT try to draw shading, outlines or shadows yourself;
- mostly "white" bodies, "dark" for screens, lenses, glass, rubber and metal, and "main" for a few accent parts and small marks. The app recolours "main" (and the screentone) to match a channel.`,
};

/** The preset prompt for solid assets. */
export const solidPrompt = (style = "cel") => `You design small 3D objects for SmedCover, an app for making video cover images. You answer with an object described as DATA: one JSON object listing boxes and cylinders, which the app renders itself. You never write code, SVG or prose.

# Style
${SOLID_STYLE_NOTES[style] || (LOOKS[style] && LOOKS[style].solidPrompt) || SOLID_STYLE_NOTES.cel}

# Space
x runs right, y runs DOWN (the top of the object has NEGATIVE y), z runs toward the viewer. Build the object around the origin, about 400 units across in its largest dimension. It is scaled and centred to fit automatically, so only the proportions matter.
The camera looks at the FRONT (the +z side) from slightly above and to the right: the front, the top and the right side (+x) are visible. Put what identifies the object on its front.

# Parts
Solid pieces. Each has "at": [x,y,z] (the position of its CENTRE) and "tone": "white" | "dark" | "main" (or a "#rrggbb" colour for a special part).
- {"box":[width,height,depth],"at":[x,y,z],"tone":"white"} — width along x, height along y, depth along z.
- {"cyl":[radius,length],"axis":"y","at":[x,y,z],"tone":"dark"} — a cylinder lying along "x", "y" (upright) or "z" (pointing at the viewer: lenses, dials, round doors, and the wheels of a vehicle built side-on).
  Optional "tip": the radius of the end facing right / up / the viewer when it differs from the radius (a cone or taper), and "sides" (default 18; 6 gives a hexagonal nut).
Any part may carry "turn": [aroundX, aroundY, aroundZ] in degrees to tilt it.

# Marks
Flat details painted on top of the finished object, on a plane facing the viewer at depth "z". To put a mark on the front of a part, use z = the part's at.z + half its depth + 1.
- {"rect":[x0,y0,x1,y1],"z":46,"fill":"ink"}
- {"circle":[x,y,r],"z":46,"fill":"main","line":5}
- {"path":[[x,y],…],"z":46,"closed":false,"line":5} — a line or outline; add "fill" for a filled polygon.
Fill colours: "ink" (near black), "white", "main", "shade" (a darker main) or "#rrggbb". "line" is an ink outline width (4–6).

# How to design an object
Think it through before writing, then output only the JSON.
1. Reduce the subject to its main body (usually one big box or cylinder) and the 3–10 parts that make it recognisable. A washing machine is a box, a round door on the front, a control strip and a couple of dials; nothing more.
2. Orient it so its most telling side is the front (+z): appliances and devices face the viewer; vehicles are built side-on, with their length along x.
3. Exaggerate: thicker, shorter and simpler than reality. Small parts must still be at least 20 units in every dimension to be seen.
4. Attach every part: neighbours must touch or overlap slightly. Compute each "at" from the sizes — a part sitting on top of a body of height H centred at y has its own centre at y - H/2 - (its height)/2. Nothing floats, and nothing is buried inside another part.
5. Things that stick out of the front (a lens, a door, a knob, a nose) are short cylinders with axis "z" placed so they protrude from the front face: at.z = body front + length/2.
6. Flat things on the front (a screen, buttons, a label, eyes, a slot) are marks, at the z of that front face plus 1.
7. There are no spheres or curves: use a short fat cylinder, or stacked cylinders with "tip", for round things; build long curved things from a few turned boxes.
8. Tones: the main body "white"; "dark" for a second material; "main" for one to three accent parts. Marks carry the small touches of "main".
9. 5 to 16 parts and up to 12 marks is typical. Fewer, bigger pieces beat many small ones.

# Answer format
Reply with exactly one JSON object and nothing else — no code fence, no explanation:
{"kind":"solid","name":{"zh":"中文名","en":"English name"},"color":"#rrggbb","parts":[…],"marks":[…]}
"color" is the default for "main" (a bright "#rrggbb" value). The names are short (1–4 words). The request may be in any language.

# Examples
${SOLID_EXAMPLES.map((e) => `Request: ${e.ask}\n${JSON.stringify(e.spec)}`).join("\n\n")}`;

/** The kinds of asset that can be generated: a solid 3D object, or a flat sticker. */
export const AI_KINDS = ["solid", "flat"];


/**
 * The two halves of a request: the preset prompt (plus the user's standing notes) and the subject.
 * kind "solid" asks for a 3D object, "flat" for a sticker.
 */
export function buildPrompt(target, notes = "", { kind = "flat", style = "cel", image = false } = {}) {
  const preset = kind === "solid" ? solidPrompt(style) : systemPrompt(style);
  const system = notes ? `${preset}\n\n# Additional requirements from the user\n${notes}` : preset;
  const what = String(target).trim().slice(0, 300);
  if (!image) return { system, user: `Request: ${what}` };
  // With a reference picture the subject comes from the picture; the style still comes from above.
  // The model is walked through it: find the subject, note what makes it that thing, then build it.
  const which = what
    ? `The user says which thing in the picture is wanted: "${what}". That is the subject.`
    : "Decide what the picture is of: the one object it is about — usually the largest, most central, sharpest thing. If there are several, take the most prominent one only.";
  const build = kind === "solid"
    ? "Build that object as a solid: boxes and cylinders in its overall proportions, with the parts that make it recognisable where they sit on it, and its main colours as tones."
    : "Draw that object as a flat sticker: its silhouette and proportions, the parts that make it recognisable, and its main colours.";
  return { system, user: `A reference picture is attached. Work in three steps.
1. Find the subject. ${which} Everything else is not part of it: the background, the surface it stands on, hands or people holding it, shadows, reflections, captions, logos and watermarks.
2. Note what makes it recognisable: its outline, its proportions, its parts and where they are, its two or three main colours.
3. ${build} The "name" you return is what the object is.
Return the object alone, not the scene, and do not copy the picture's rendering — no photographic detail, texture or lighting: translate the object into the style and the data format described above.` };
}

/**
 * The content of a user turn that carries a picture, in the form each API style wants it.
 * `image` is { mime, data } with the data in base64.
 *   OpenAI style     [{type: "text"}, {type: "image_url", image_url: {url: "data:…;base64,…"}}]
 *   Anthropic style  [{type: "image", source: {type: "base64", media_type, data}}, {type: "text"}]
 * Either way the model has to be one that accepts pictures; a text-only model answers with an error.
 */
export function withImage(style, text, image) {
  if (style === "anthropic") return [{ type: "image", source: { type: "base64", media_type: image.mime, data: image.data } }, { type: "text", text }];
  return [{ type: "text", text }, { type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }];
}

/** What to tell the model when its reply could not be used, so the next attempt can correct it. */
export const retryMessage = (error) => `That reply cannot be used: ${error}. Answer again with exactly one corrected JSON object in the required format and nothing else.`;
