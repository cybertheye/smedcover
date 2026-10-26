// The tools an agent (an MCP client: Claude Code, Codex…) drives SmedCover with: what each is called, what it does,
// takes and answers, how it is marked (read-only, destructive…), and what the page does around it (one step of undo,
// whether it waits for the user, the hosts it is for, how long its caller waits). Pure data and helpers — no DOM —
// so Node reads it too: scripts/tools.mjs writes ui/tools.json from toolsJson(), the list the host's MCP endpoint
// serves (agent-rust-design §3.7), and the tests check it. commands.js does what each tool says; agent.js queues
// the calls and answers them (see §11 in ARCHITECTURE.md).
import { SCOPES, FORMATS, SURPRISE_LOCKS, channelIndex, sizeCaption } from "./store.js";
import { LOOK_IDS } from "./style.js";
import { EFFECTS } from "./textfx.js";
import { BEND_IDS, WEAVE_WAYS, WEAVE_MAX, BRUSH_R, CROP_PTS, isFree, resolve } from "./layers.js";
import { RULES } from "./deal.js";
import { parseTitle } from "./title.js";
import { lineCells, keysOf } from "./ransom.js";

// ---------- answers
/** The kinds of failure the page answers a call with (the reply's error.code; Rust makes -32602 of unknown_tool, isError of the rest). */
export const ERRORS = ["unknown_tool", "invalid_arguments", "not_allowed", "busy", "unavailable", "failed"];
/** A failure a command throws: `code` one of ERRORS, `message` a sentence for the agent. */
export class ToolError extends Error {
  constructor(code, message) { super(message); this.code = ERRORS.includes(code) ? code : "failed"; }
}
/**
 * A tool's answer as MCP has it (a CallToolResult): `text` (by default the structured answer as JSON) and the PNGs
 * of `images` (base64, or {data, mimeType}) as content, `structured` as structuredContent.
 */
export function toResult({ structured, images = [], text } = {}) {
  const said = text ?? (structured === undefined ? "Done." : JSON.stringify(structured));
  return {
    content: [{ type: "text", text: said }, ...images.map((d) => (typeof d === "string" ? { type: "image", data: d, mimeType: "image/png" } : { type: "image", data: d.data, mimeType: d.mimeType || "image/png" }))],
    ...(structured === undefined ? {} : { structuredContent: structured }),
  };
}
/** A tool's failure as the page answers it: {error: {code, message}} (see ERRORS). */
export const toError = (code, message) => ({ error: { code: ERRORS.includes(code) ? code : "failed", message: String(message) } });
/** Whether what a command answered is a failure (toError's), not a result. */
export const isError = (r) => !!r && typeof r === "object" && !!r.error && !r.content;

// ---------- schemas
const HEX = "^#[0-9a-fA-F]{6}$", HEX_OR_AUTO = "^(#[0-9a-fA-F]{6}|auto)$";
const said = (description) => (description ? { description } : {});   // a schema's description, when it has one
const str = (description, more = {}) => ({ type: "string", ...said(description), ...more });
const bool = (description) => ({ type: "boolean", ...said(description) });
const num = (description, minimum, maximum, more = {}) => ({ type: "number", ...said(description), minimum, maximum, ...more });
const int = (description, minimum, maximum, more = {}) => ({ type: "integer", ...said(description), minimum, maximum, ...more });
const pick = (values, description) => ({ type: "string", enum: [...values], ...said(description) });
const list = (items, description, more = {}) => ({ type: "array", items, ...said(description), ...more });
/** An object of these properties and no others; `required`, those it must have. */
const obj = (properties, required = [], description) => ({ type: "object", ...said(description), properties, ...(required.length ? { required } : {}), additionalProperties: false });
/** A tool's input: an object of these properties and no others. */
const input = (properties, required = []) => obj(properties, required);
/** An answer's shape, loose: what it has, never a promise that it has nothing else. */
const out = (properties, required = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });
const either = (...anyOf) => ({ anyOf });
const ALL = { type: "string", enum: ["all"] };

// what most tools take (inlined, no $ref: some clients do not follow one)
const PROFILE = str("The profile, by id or name. The one shown in the window when left out.");
const CHANNEL = { type: ["string", "integer"], description: "The channel, by id, name, code or number from 1. The one shown when left out." };
const LAYER = str("The layer's id, as get_cover lists it (the layout's own parts are named by their type: title, subtitle, tag, brand, …).");
const SIZE = str('A size of the profile: its pixels ("1920x1080"), its ratio ("16:9") or its name. The one on the canvas when left out.');
const SCOPE = pick(SCOPES, 'Which sizes a change of place reaches: "all" of them (the default), those facing the same way as `size` ("orient"), or `size` alone ("size").');
const POINT = { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2 };
const AT = obj({ x: num("Across, 0 the left edge, 1 the right.", -3, 3), y: num("Down, 0 the top edge, 1 the bottom.", -3, 3) }, ["x", "y"], "Where its centre goes, as shares of the canvas.");
const SIZES = either(ALL, list(str("A size: pixels, ratio or name."), "", { minItems: 1, maxItems: 80 }));
const COLOUR = (what) => str(`${what}: "#rrggbb", or "auto" for what the look gives it.`, { pattern: HEX_OR_AUTO });

// what answers are made of
const PLACE = out({ x: { type: "number" }, y: { type: "number" }, s: { type: "number" }, r: { type: "number" }, kx: { type: "number" }, ky: { type: "number" } });
const BOX = out({ id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, r: { type: "number" } });
const LAYER_OUT = out({
  id: { type: "string" }, type: { type: "string" }, kind: { type: "string", enum: ["layout", "free", "copy"] }, name: { type: "string" },
  visible: { type: "boolean" }, opacity: { type: "number" }, locked: { type: "boolean" }, included: { type: "boolean" }, removable: { type: "boolean" }, copyable: { type: "boolean" },
  place: PLACE, tunedAt: { type: "array", items: { type: "string" } }, sizes: either(ALL, { type: "array", items: { type: "string" } }),
}, ["id", "type", "kind"]);
const CHANNEL_OUT = out({ id: { type: "string" }, name: { type: "string" }, sub: { type: "string" }, code: { type: "string" }, color: { type: "string" } }, ["id"]);
const SELECTION = out({ profile: { type: "string" }, channel: { type: "string" }, size: { type: "string" }, scope: { type: "string" }, layer: { type: "string" }, layers: { type: "array", items: { type: "string" } } }, ["profile", "channel", "size", "layer"]);
const HISTORY = out({ index: { type: "integer" }, steps: { type: "integer" }, canUndo: { type: "boolean" }, canRedo: { type: "boolean" } }, ["index", "canUndo", "canRedo"]);
const WRITTEN = out({ dir: { type: "string" }, files: { type: "array", items: out({ path: { type: "string" }, channel: { type: "string" }, title: { type: "string" }, size: { type: "string" } }) }, cancelled: { type: "boolean" } }, ["dir", "files"]);
const WARNINGS = { type: "array", items: { type: "string" } };
const LAYER_DONE = out({ layer: LAYER_OUT, warnings: WARNINGS }, ["layer"]);

// ---------- the tools
const READ = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const EDIT = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const ADD = { ...EDIT, idempotentHint: false };
const GONE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
/** Writing files: new ones only (never over one, write_fresh), each call more of them. */
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const BOTH = ["desktop", "server"], DESKTOP = ["desktop"];
/**
 * Each tool: `name`, `title`, `description` (English, for the model), `inputSchema` and `outputSchema` (JSON
 * Schema), `annotations` (MCP's hints); and what only the page reads: `history` (run as one step of undo, see
 * agentStep in app.js), `busy` (what of the user's waits it: "light", a press, a drag, a dialog, typing; "strict", the
 * editor's windows and an export under way too, not Settings), `hosts` (where it is offered), `timeoutMs` (how long
 * the host waits for its answer without word from the page), `needs` (beyond the schema: {any|one|most: [names]}, at
 * least, exactly or at most one of these arguments).
 */
const TOOL = (name, title, description, inputSchema, { outputSchema, annotations = EDIT, history = !annotations.readOnlyHint, busy = annotations.readOnlyHint ? "light" : "strict", hosts = BOTH, timeoutMs = annotations.readOnlyHint ? 30000 : 60000, needs = null } = {}) =>
  ({ name, title, description, inputSchema, ...(outputSchema ? { outputSchema } : {}), annotations: { title, ...annotations }, history, busy, hosts, timeoutMs, ...(needs ? { needs } : {}) });

export const TOOLS = [
  // ---- looking (read-only)
  TOOL("get_context", "Get context",
    "What SmedCover has and shows now. Call it first. Returns every profile with its look, channels (id, name, sub, code, colour) and sizes (key such as \"1920x1080\", caption, orientation, whether the Export window has it ticked) and its export folder; what the window shows (profile, channel, size, scope, selected layers); the export settings; whether undo and redo can go further; and what this host can do (cut out a photo's subject, outline text effects, text and image AI configured, write files, a window the user watches: live).",
    input({}),
    { annotations: READ, outputSchema: out({
      app: out({ version: { type: "string" }, host: { type: "string" } }),
      can: out({ cut: { type: "boolean" }, cutReady: { type: "boolean" }, cutEngine: { type: "string" }, outlines: { type: "boolean" }, textAi: { type: "boolean" }, imageAi: { type: "boolean" }, saveFiles: { type: "boolean" }, live: { type: "boolean" } }),
      profiles: { type: "array", items: out({ id: { type: "string" }, name: { type: "string" }, brand: { type: "string" }, look: { type: "string" }, theme: { type: "string" },
        channels: { type: "array", items: CHANNEL_OUT },
        sizes: { type: "array", items: out({ key: { type: "string" }, w: { type: "integer" }, h: { type: "integer" }, name: { type: "string" }, caption: { type: "string" }, orient: { type: "string" }, ticked: { type: "boolean" } }) },
        exportDir: { type: "string" } }, ["id", "channels", "sizes"]) },
      current: SELECTION,
      export: out({ format: { type: "string" }, scale: { type: "integer" }, quality: { type: "integer" }, nameTemplate: { type: "string" } }),
      history: out({ canUndo: { type: "boolean" }, canRedo: { type: "boolean" } }),
    }, ["profiles", "current"]) }),
  TOOL("get_cover", "Get a cover",
    "A channel's cover as it is now, read without switching the window: its title, subtitle and tag, the profile's look and theme, and its layers, bottom first. Each layer: id (name layers by it in other tools), type, kind (\"layout\": one of the layout's own parts, which can be hidden or left out of the cover but not removed; \"free\": a layer that was added, or of a kind from an earlier version; \"copy\": a copy of a layout part), its name as the editor shows it, visible, opacity, locked, included (a layout part on the cover or left out), removable (whether remove_layer takes it), copyable, place (x, y; s its scale, r its turn in degrees, kx and ky its stretch — for a layer that was added x, y is its centre as shares of the canvas, for a layout part or a copy of one its offset from where the layout puts it, for a linked cut-out its offset from its photo), tunedAt (sizes it was moved at alone), sizes (those it shows at, or \"all\"), and what its type has: text, font, ink, hi, plate, plateInk, hiPlateInk, hiMark (what marks the highlighted words: none, plate, circle, marker or block), fx and fxAmt (text effect), outline and shadow (their weights), bend and bendAmt, vertical, a photo's pid, fill, cut and of (the photo a cut-out is linked to), an asset's ref and tint, a solid's color, crop, weave, and clip (true: shown only within the layer below). letters: true adds each lettering layer's letterKeys (for weave's front). raw: true adds the cover as SmedCover stores it (for apply_cover_json).",
    input({ profile: PROFILE, channel: CHANNEL, letters: bool("Also list each lettering layer's letter keys."), raw: bool("Also return the cover as stored, under `raw`.") }),
    { annotations: READ, outputSchema: out({ profile: { type: "string" }, channel: { type: "string" }, title: { type: "string" }, subtitle: { type: "string" }, tag: { type: "string" }, look: { type: "string" }, theme: { type: "string" },
      layers: { type: "array", items: LAYER_OUT }, raw: { type: "object" } }, ["profile", "channel", "layers"]) }),
  TOOL("list_options", "List options",
    "The values other tools accept. Returns looks (id, name, its kinds, a line on what it is drawn like and what it is for, oneTheme when it has a single ground, seeded when it scatters things at random), text effects (id, name, kind, seeded, needsOutlines, available here), bends, fonts (bundled, imported, installed: filtered by fontQuery, at most 200 listed; latin: those listed that cannot set Chinese), the platforms and the ratios their covers use, size presets, and Surprise me's locks. look: one look alone, all of it — what it is in full, its settings (key, range, step, default: set_look's params) and its scene objects. `only` limits the answer to some of these groups (with look and no only: the looks alone).",
    input({ only: list(pick(["looks", "effects", "bends", "fonts", "platforms", "sizes", "locks"], ""), "Only these groups.", { minItems: 1, uniqueItems: true }), look: pick(LOOK_IDS, "This look alone, with its settings."), fontQuery: str("Only installed fonts whose name has this in it (case aside).", { maxLength: 80 }) }),
    { annotations: READ, outputSchema: out({ looks: { type: "array" }, effects: { type: "array" }, bends: { type: "array" }, fonts: { type: "object" }, platforms: { type: "array" }, sizes: { type: "array" }, locks: { type: "array" } }) }),
  TOOL("list_library", "List the library",
    "Pictures and assets that can be put on a cover. Returns photos (the bitmap library: pid — for add_photo's source.library —, name, kind upload/ai/repaint, when it was added), stickers and graphics (built in: id, name, group), and mine (the user's own assets: id, name, kind image/ai) — the ids for add_layer's asset. kind keeps one group; query, those whose name has the word in it; at most limit of each (default 100).",
    input({ kind: pick(["photos", "stickers", "graphics", "mine"], "Only this group."), query: str("Only those whose name has this in it (case aside).", { maxLength: 80 }), limit: int("At most this many of each group (default 100).", 1, 500) }),
    { annotations: READ, outputSchema: out({ photos: { type: "array" }, stickers: { type: "array" }, graphics: { type: "array" }, mine: { type: "array" }, more: { type: "object" } }) }),
  TOOL("render_preview", "Render a preview",
    "Draws a channel's cover as it will be exported and returns it as a PNG image, its longer side maxSide pixels (default 1024) — look at it to check a change. Drawn without switching the window. Also returns where each layer landed (boxes: id, centre x and y, width w and height h as shares of the image, r its turn in degrees) and pending (fonts or outlines still on their way: draw again in a moment if true). all: true draws every size of the profile on one contact sheet instead, each captioned (sizes: where each is on the sheet; no boxes).",
    input({ profile: PROFILE, channel: CHANNEL, size: SIZE, all: bool("Every size on one contact sheet."), maxSide: int("The image's longer side in pixels (default 1024; a sheet may be up to 1.5 times as wide).", 128, 2048) }),
    { annotations: READ, timeoutMs: 120000, outputSchema: out({
      sizes: { type: "array", items: out({ key: { type: "string" }, caption: { type: "string" }, x: { type: "integer" }, y: { type: "integer" }, w: { type: "integer" }, h: { type: "integer" } }) },
      width: { type: "integer" }, height: { type: "integer" }, boxes: { type: "array", items: BOX },
      pending: out({ fonts: { type: "boolean" }, outlines: { type: "boolean" } }),
    }, ["sizes", "width", "height"]) }),

  // ---- changing (each one step of undo)
  TOOL("set_text", "Set the words",
    "Sets the cover's title, subtitle and/or tag (at least one). Mark highlighted words with *asterisks* (\"Make *this* stand out\") and break lines with \\n, as the editor does (the tag is one line); \"\" empties one. One undo step. Returns the three as they now are.",
    input({ profile: PROFILE, channel: CHANNEL, title: str("The title.", { maxLength: 2000 }), subtitle: str("The subtitle.", { maxLength: 2000 }), tag: str("The tag, the small label in a corner (\"EP.01\").", { maxLength: 200 }) }),
    { needs: { any: ["title", "subtitle", "tag"] }, outputSchema: out({ title: { type: "string" }, subtitle: { type: "string" }, tag: { type: "string" }, warnings: WARNINGS }) }),
  TOOL("set_look", "Set the look",
    "Sets the profile's look, which every channel of it shares, and/or its settings: params (the look's own settings by key, as list_options with look lists them; a value out of range is clamped and said in warnings, an unknown key refused), theme (a dark or light ground, for looks with two), seed (where the look scatters things), resetParams (its settings back to their defaults). Not counted among the user's most used looks. One undo step. Returns the look, theme, seed and settings as they now are.",
    input({ profile: PROFILE, look: pick(LOOK_IDS, "The look's id."), params: { type: "object", description: "The look's settings to change, by key: a number, or text for a text setting.", additionalProperties: { type: ["number", "string"] } },
      theme: pick(["dark", "light"], "The ground."), seed: int("Where the look scatters things at random.", 0, 999999), resetParams: bool("Its settings back to their defaults first.") }),
    { needs: { any: ["look", "params", "theme", "seed", "resetParams"] }, outputSchema: out({ look: { type: "string" }, theme: { type: "string" }, seed: { type: "integer" }, params: { type: "object" }, warnings: WARNINGS }, ["look"]) }),
  TOOL("set_channel", "Set a channel",
    "Changes a channel of a profile: its name, the line under it (sub), its code (short, as \"VLOG\") and its colour (#rrggbb, the accent the looks draw with). One undo step. Returns the channel.",
    input({ profile: PROFILE, channel: CHANNEL, name: str("Its name.", { maxLength: 80 }), sub: str("The line under its name.", { maxLength: 120 }), code: str("Its code.", { maxLength: 40 }), color: str("Its colour, \"#rrggbb\".", { pattern: HEX }) }, ["channel"]),
    { needs: { any: ["name", "sub", "code", "color"] }, outputSchema: CHANNEL_OUT }),
  TOOL("place_layer", "Place a layer",
    "Moves, scales, turns or stretches a layer: absolute (x, y, scale, rotate, stretchX, stretchY), relative (move {dx, dy}, scaleBy, rotateBy), or reset: true for where it was put on (see reset). All are as the layer is at `size` (the one on the canvas when left out, which the window then shows): for a layer that was added x, y is its centre as shares of the canvas (0.5, 0.5 the middle); for a layout part or a copy of one, its offset from its place in the layout, likewise in shares of the canvas; for a cut-out or a cropped photo, the centre of the whole picture's frame, not of the part that shows (box says where that landed); scale is get_cover's place.s times what that size adds (a sticker is put on at 0.3, text at 0.35, a solid at 1, a layout part at 1). scope says which sizes the change reaches (all by default; the others move as far across their own canvas). A cut-out linked to a photo goes where its photo goes (move moves both; x and y are refused), its scale, turn and stretch its own. Not for bg, the frame or a locked layer, nor turning or stretching a photo that fills the canvas. One undo step. Returns its placement at `size` in the same terms, and its box there as render_preview gives boxes.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, size: SIZE, scope: SCOPE,
      x: num("Across (see above).", -3, 3), y: num("Down (see above).", -3, 3), scale: num("Its scale (see above).", 0.02, 20), rotate: num("Its turn in degrees, clockwise.", -360, 360),
      stretchX: num("Its stretch across, 1 none.", 0.05, 20), stretchY: num("Its stretch down, 1 none.", 0.05, 20),
      move: obj({ dx: num("Across, as a share of the canvas's width.", -3, 3), dy: num("Down, as a share of the canvas's height.", -3, 3) }, [], "Moves it by this much."),
      scaleBy: num("Scales it by this much.", 0.05, 20), rotateBy: num("Turns it by this many degrees.", -360, 360), reset: bool("Back to where it was put on, at the sizes scope reaches: a layout part where the layout puts it, a layer that was added in the middle at the scale it is put on at, a photo filling the canvas filling it; a linked cut-out back over its photo at every size.") }, ["layer"]),
    { annotations: { ...EDIT, idempotentHint: false }, needs: { any: ["x", "y", "scale", "rotate", "stretchX", "stretchY", "move", "scaleBy", "rotateBy", "reset"] }, outputSchema: out({ size: { type: "string" }, place: PLACE, box: { anyOf: [BOX, { type: "null" }] }, warnings: WARNINGS }, ["size", "place"]) }),
  TOOL("set_layer_effect", "Set a text effect",
    "Sets a headline's (the title's, the subtitle's or a text layer's) text effect: effect (as list_options lists them; \"auto\" lets the look decide), amount (its strength 0–2; not for the effects of kind \"passes\"), reshuffle (deals a seeded effect's letters again), outline and shadow (0–2). Effects that need glyph outlines are refused where the host has none. One undo step. Returns the layer.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, effect: pick(Object.keys(EFFECTS), "The text effect."), amount: num("Its strength.", 0, 2), reshuffle: bool("Deal its letters again (seeded effects)."), outline: num("The outline's weight.", 0, 2), shadow: num("The shadow's weight.", 0, 2) }, ["layer"]),
    { needs: { any: ["effect", "amount", "reshuffle", "outline", "shadow"] }, outputSchema: LAYER_DONE }),
  TOOL("set_layer_font", "Set a font",
    "Sets the font of a lettering layer (title, subtitle, tag, channel name, brand row, text): a family that is installed, bundled or imported (list_options fonts; matched with the case aside, near names suggested when none matches), or \"\" for the look's own; and/or vertical: true sets it in columns, false in lines. Not counted among the user's recent fonts. One undo step. Returns the layer.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, font: str("The font family, or \"\" for the look's own.", { maxLength: 80 }), vertical: bool("Set in columns.") }, ["layer"]),
    { needs: { any: ["font", "vertical"] }, outputSchema: LAYER_DONE }),
  TOOL("set_layer_bend", "Bend a headline",
    "Bends a headline (the title, the subtitle or a text layer): bend, one of list_options' bends or \"none\"; amount 0–2 (default 1). Takes away a perspective or a reshaping dragged by hand. One undo step. Returns the layer.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, bend: pick(["none", ...BEND_IDS], "The bend."), amount: num("How far.", 0, 2) }, ["layer", "bend"]),
    { outputSchema: LAYER_DONE }),
  TOOL("set_layer_color", "Set a layer's colours",
    "Sets a layer's colours, each \"#rrggbb\" or \"auto\" for what the look gives it: ink (a lettering layer's words; a photo's outline; a vector sticker's or the user's AI asset's colour over its own), hi (a headline's highlighted words), plateInk (the plate under a headline's words), hiPlateInk (the plates or marks under its highlighted words). plate puts a plate under a headline's or the channel name's words, or takes it away; tint makes a vector asset follow the channel colour (false: its own colours); color is a solid layer's colour (\"#rrggbb\"). One undo step. Returns the layer.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, ink: COLOUR("Its ink"), hi: COLOUR("The highlighted words' colour"), plate: bool("A plate under the words."), plateInk: COLOUR("The plate's colour"),
      hiPlateInk: COLOUR("The highlights' plates' or marks' colour"), tint: bool("Follow the channel colour (a vector asset)."), color: str("A solid layer's colour, \"#rrggbb\".", { pattern: HEX }) }, ["layer"]),
    { needs: { any: ["ink", "hi", "plate", "plateInk", "hiPlateInk", "tint", "color"] }, outputSchema: LAYER_DONE }),
  TOOL("show_layer", "Show or hide a layer",
    "Shows or hides a layer (visible), sets its opacity (0–1), locks it against being moved on the canvas (locked), leaves a layout part out of the cover or brings it back (included), or keeps it to some sizes (sizes: a list of sizes, or \"all\"). One undo step. Returns the layer.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, visible: bool("Shown."), opacity: num("How opaque.", 0, 1), locked: bool("Locked in place."), included: bool("A layout part on the cover (false: left out)."), sizes: SIZES }, ["layer"]),
    { needs: { any: ["visible", "opacity", "locked", "included", "sizes"] }, outputSchema: LAYER_DONE }),
  TOOL("add_layer", "Add a layer",
    "Adds a layer just above `above` (a layer id, or \"top\"; by default the top, and a copy just above what it copies): kind \"text\" (its words in text; *highlight* and \\n as in a title), \"solid\" (a block of colour the canvas's size; color, by default the channel colour), \"asset\" (a sticker, a graphic or the user's own: asset {kind, id} from list_library) or \"copy\" (a copy of layer `of`: a layout part other than bg and frame, or a layer that was added). at {x, y} puts it there at every size, as place_layer's x and y in scope all (its centre as shares of the canvas; for a copy of a layout part, its offset from where the layout puts that part): a copy of a layer tuned at some sizes leaves those tunings of its place behind. scale sets its size at every size likewise (place_layer's scale). The new layer is selected. One undo step. Returns it as get_cover lists layers.",
    input({ profile: PROFILE, channel: CHANNEL, kind: pick(["text", "solid", "asset", "copy"], "What to add."), text: str("A text layer's words.", { maxLength: 2000 }), color: str("A solid's colour, \"#rrggbb\".", { pattern: HEX }),
      asset: obj({ kind: pick(["sticker", "graphic", "user"], "Which library."), id: str("Its id, from list_library.", { maxLength: 80 }) }, ["kind", "id"], "The asset to add."),
      of: str("The layer to copy."), above: str("The layer it goes above, or \"top\"."), at: AT, scale: num("Its scale (a sticker 0.3, text 0.35, a solid 1: the canvas's size).", 0.02, 20) }, ["kind"]),
    { annotations: ADD, outputSchema: out({ layer: LAYER_OUT }, ["layer"]) }),
  TOOL("remove_layer", "Remove a layer",
    "Removes a layer that was added (a photo takes its linked cut-out with it). The layout's own parts cannot be removed: hide them with show_layer. Undoable, one step. Returns the ids removed.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER }, ["layer"]),
    { annotations: GONE, history: true, outputSchema: out({ removed: { type: "array", items: { type: "string" } } }, ["removed"]) }),
  TOOL("reorder_layer", "Reorder a layer",
    "Moves a layer in the stack: to \"top\", \"bottom\", or just above layer `above` (\"top\": the topmost), as a row dropped in the layer list — which orders the layout's own parts so in the profile's design too —; or \"up\" or \"down\" one, past the next layer of this cover, as its ▲ and ▼ do (this cover alone). One undo step. Returns its place in the stack (0 the bottom) and the layers' ids in order.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, to: pick(["top", "bottom", "up", "down"], "Where to."), above: str("The layer it goes just above, or \"top\".") }, ["layer"]),
    { annotations: { ...EDIT, idempotentHint: false }, needs: { one: ["to", "above"] }, outputSchema: out({ index: { type: "integer" }, layers: { type: "array", items: { type: "string" } }, warnings: WARNINGS }, ["index"]) }),
  TOOL("add_photo", "Add a photo",
    "Puts a photo on the cover. source is exactly one of: path (an image file on this computer, absolute: PNG, JPEG, WebP, GIF, HEIC or AVIF, at most 64 MB), url (an http(s) link to an image of those kinds, at most 64 MB; fetched through the proxy the user set for image AI), library (a pid from list_library) or data (the image in base64, or a data: URL). Prefer a path or a url: data travels whole through the conversation, at most 24 Mi characters (and the request 32 MiB in all). fill: true makes it the background, filling the canvas, as Fill the canvas does: above bg and the photos filling the canvas there already, so it shows over them; else it is placed as a print, its centre at `at` {x, y}, just above `above` (a layer id or \"top\"; by default the selected layer). A new picture joins the bitmap library. One undo step. Returns the new layer and the picture's pid.",
    input({ profile: PROFILE, channel: CHANNEL,
      source: { type: "object", description: "Where the picture comes from: exactly one of these.", properties: { path: str("An image file, absolute.", { maxLength: 4096 }), url: str("An http(s) URL.", { maxLength: 4096 }), library: str("A pid from list_library.", { maxLength: 40 }), data: str("Base64, or a data: URL (prefer path or url).", { maxLength: 25165824 }) }, minProperties: 1, maxProperties: 1, additionalProperties: false },
      at: AT, fill: bool("Fill the canvas, as the background."), name: str("Its name in the library.", { maxLength: 60 }), above: str("The layer it goes above, or \"top\".") }, ["source"]),
    { annotations: { ...ADD, openWorldHint: true }, outputSchema: out({ layer: LAYER_OUT, pid: { type: "string" } }, ["layer", "pid"]) }),
  TOOL("crop_photo", "Crop a photo",
    "Crops a photo or asset layer, as its crop window does: crop {x, y, w, h} (all four, shares of the picture: its left and top edges, its width and height) or a free shape {pts: [[u, v], …]} (3 to 64 corners in order round it, shares of the picture), or ratio (\"photo\" or w:h) for a crop of that ratio about as large as the one it has, about its middle, or reset: true for the whole picture. Not for a photo that fills the canvas. One undo step. Returns the crop as kept (null: none), and in warnings what was kept within the picture.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER,
      crop: obj({ x: num("Its left edge.", 0, 1), y: num("Its top edge.", 0, 1), w: num("Its width.", 0.02, 1), h: num("Its height.", 0.02, 1), pts: list(POINT, "A free shape's corners.", { minItems: 3, maxItems: CROP_PTS }) }, [], "The part kept: a rectangle, or a shape (pts)."),
      ratio: pick(["photo", "1:1", "4:3", "3:4", "16:9", "9:16"], "Crop to this ratio (\"photo\": the picture's own)."), reset: bool("The whole picture again.") }, ["layer"]),
    { needs: { one: ["crop", "ratio", "reset"] }, outputSchema: out({ crop: { type: ["object", "null"] }, warnings: WARNINGS }, ["crop"]) }),
  TOOL("cut_out", "Cut out a subject",
    "Cuts the subject out of a photo layer (on macOS with Vision, elsewhere with a downloaded model): a layer with the subject alone, linked to the photo, goes above the title so it can stand in front of it; a photo cut out already has its subject found again. scope keeps it to the sizes facing size's way, or to size alone (default all). The first cut-out of a photo can take a while. Answers unavailable where the host cannot cut out or the model is not downloaded (the user downloads it in Settings → AI → Cut-out). One undo step. Returns the cut-out layer's id and the sizes it shows at.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, size: SIZE, scope: SCOPE }, ["layer"]),
    { annotations: ADD, timeoutMs: 600000, outputSchema: out({ cutout: { type: "string" }, sizes: either(ALL, { type: "array", items: { type: "string" } }) }, ["cutout"]) }),
  TOOL("weave", "Weave with the lettering",
    "Weaves a cut-out (or an asset) with the lettering below it, as a magazine's subject is with its masthead. by \"head\": its head in front, ending at line (0.1–0.9 of the subject's height from its top), the rest behind; \"letters\": front gives, for each lettering layer id, \"all\", \"none\", \"alternate\" or a list of letter keys (get_cover with letters: true) to put in front, the rest behind; \"brush\": strokes [{front, r, pts}] painted in the picture's own frame (pts as shares of its width and height, r of its longer side), in place of those it has. with: the lettering layers below it that it weaves with (a first weave: the title, else the nearest below). Each way's settings are kept when another is chosen. off: true unweaves it. One undo step. Returns the weave as kept, and in warnings what will not show as it is.",
    input({ profile: PROFILE, channel: CHANNEL, layer: LAYER, off: bool("Unweave it."), by: pick(WEAVE_WAYS, "How."), with: list(str("A lettering layer's id."), "The layers it weaves with.", { maxItems: WEAVE_MAX.with, uniqueItems: true }),
      line: num("Where the head ends.", 0.1, 0.9),
      front: { type: "object", description: "By lettering layer id: the letters in front.", additionalProperties: either(pick(["all", "none", "alternate"], ""), list({ type: "string" }, "", { maxItems: WEAVE_MAX.front })) },
      strokes: list(obj({ front: bool("In front where it passes (false: behind)."), r: num("Its radius.", BRUSH_R[0], BRUSH_R[1]), pts: list(POINT, "Its points.", { minItems: 1, maxItems: WEAVE_MAX.points }) }, ["front", "r", "pts"]), "The brush strokes, in order.", { maxItems: WEAVE_MAX.strokes }) }, ["layer"]),
    { needs: { any: ["off", "by", "with", "line", "front", "strokes"] }, outputSchema: out({ weave: { type: ["object", "null"] }, warnings: WARNINGS }, ["weave"]) }),
  TOOL("surprise", "Surprise me",
    `Surprise me: deals count (default ${RULES.hands.count}) variations of the cover — look, lettering, layout — at the size on the canvas, and puts the first on the canvas. locks keeps these as they are, this time only: ${SURPRISE_LOCKS.join(", ")} (default: those set in Surprise me's window). Not counted among the user's most used looks. Returns each hand (its number, look, layout and a few words) and, by default, one contact sheet of them labelled from 1 (images: "each" for an image per hand, "none" for none). Take another with pick_hand. One undo step.`,
    input({ profile: PROFILE, channel: CHANNEL, count: int("How many hands.", 1, RULES.hands.count), locks: list(pick(SURPRISE_LOCKS, ""), "What to leave as it is.", { uniqueItems: true }), images: pick(["sheet", "each", "none"], "Which images to return (default sheet).") }),
    { annotations: ADD, timeoutMs: 120000, outputSchema: out({ hands: { type: "array", items: out({ hand: { type: "integer" }, look: { type: "string" }, lookName: { type: "string" }, layout: { type: "string" }, says: { type: "string" } }) }, kept: { type: "integer" }, locks: { type: "array", items: { type: "string" } } }, ["hands", "kept"]) }),
  TOOL("pick_hand", "Pick a hand",
    "Puts hand `hand` (from 1, as labelled) of the last surprise on the canvas instead, on the same undo step. Refused once the cover has been changed since the deal: deal again then.",
    input({ hand: int("The hand's number.", 1, RULES.hands.count) }, ["hand"]),
    { outputSchema: out({ kept: { type: "integer" }, look: { type: "string" }, lookName: { type: "string" } }, ["kept"]) }),
  TOOL("apply_cover_json", "Apply a cover",
    "A last resort: replaces the cover with `cover`, a whole cover as SmedCover stores it ({title, subtitle, tag, layers}; get_cover with raw: true gives one to start from). It is checked as a file read from disk is. Returns what was corrected (\"title\", \"layers.<id>.<field>\", \"layers\" for their order), dropped (a field or a layer it could not keep) and restored (a layout part it lacked, put back), and the photos (pids) and assets (kind:id) it names that are not here. One undo step.",
    input({ profile: PROFILE, channel: CHANNEL, cover: { type: "object", description: "The cover." } }, ["cover"]),
    { annotations: { ...GONE, idempotentHint: true }, history: true, outputSchema: out({ corrected: { type: "array", items: { type: "string" } }, dropped: { type: "array", items: { type: "string" } }, restored: { type: "array", items: { type: "string" } }, missingPhotos: { type: "array", items: { type: "string" } }, missingAssets: { type: "array", items: { type: "string" } } }, ["corrected", "dropped", "restored", "missingPhotos", "missingAssets"]) }),
  TOOL("open_project", "Open a project",
    "Opens a SmedCover project (a .smedcover.json file: a profile with its covers, photos, assets and fonts), from a file on this computer (file, an absolute path to a *.smedcover.json, at most 128 MB; preferred) or given whole (project, the object or its JSON text, at most 24 Mi characters, and the request 32 MiB in all in UTF-8: past it, the endpoint answers 413). Its profile, when it is here, takes it; else `as` says where: a new profile (\"new\", the default) or the current one (\"current\"). The window switches to its profile and channel, its cover one step of undo there. Returns the profile (created: whether it was made new) and the channel opened.",
    input({ file: str("The project file, absolute.", { maxLength: 4096 }), project: { type: ["object", "string"], description: "The project, or its JSON text.", maxLength: 25165824 }, as: pick(["new", "current"], "A new profile, or over the current one.") }),
    { annotations: GONE, history: true, needs: { one: ["file", "project"] }, outputSchema: out({ profile: out({ id: { type: "string" }, name: { type: "string" }, created: { type: "boolean" } }), channel: { type: "string" }, warnings: WARNINGS }, ["profile", "channel"]) }),

  // ---- making files
  TOOL("batch_covers", "Make covers in a batch",
    "Makes and exports a cover for each job, as importing a CSV does: jobs [{channel, title, tag?, subtitle?}] (channel by id, name, code or number) or csv (the same as text: channel, title, tag, subtitle, with or without a header row; a row with no channel is the one shown). Each starts from its channel's cover with the words replaced, at sizes (default every size of the profile), into folder dir (absolute; default the profile's export folder), in format, at scale (1–4×; default the export settings'). Writes new files and never overwrites one: a name taken gets a number. Nothing is written when a job names a channel the profile does not have. The covers in the window are not changed. Only where the host writes files. Returns the folder and each file written (cancelled: true when the call was cancelled part-way).",
    input({ profile: PROFILE, jobs: list(obj({ channel: CHANNEL, title: str("Its title.", { maxLength: 2000 }), tag: str("Its tag.", { maxLength: 200 }), subtitle: str("Its subtitle.", { maxLength: 2000 }) }, ["channel", "title"]), "The covers to make.", { minItems: 1, maxItems: 500 }),
      csv: str("The jobs as CSV text.", { maxLength: 1000000 }), sizes: SIZES, dir: str("The folder to write into, absolute.", { maxLength: 4096 }), format: pick(FORMATS, "The image format."), scale: int("The resolution, times the size's pixels.", 1, 4) }),
    { annotations: WRITE, history: false, timeoutMs: 1800000, needs: { one: ["jobs", "csv"] }, outputSchema: WRITTEN }),
  TOOL("export", "Export",
    "Writes covers to image files: channels (default the one shown; \"all\" for every channel) at sizes (default those ticked in the Export window; \"all\" for every size), into dir (an absolute folder; default the profile's export folder — pass dir when it has none), in format (png, jpeg, webp) and at scale (1–4×; default the export settings'), each named by the export name pattern. Writes new files and never overwrites one: a name taken gets a number. The folder given is not kept for the profile. Only where the host writes files. Returns the folder and each file's path (cancelled: true when the call was cancelled part-way).",
    input({ profile: PROFILE, channels: either(ALL, list(CHANNEL, "", { minItems: 1, maxItems: 200 })), sizes: SIZES, dir: str("The folder to write into, absolute.", { maxLength: 4096 }), format: pick(FORMATS, "The image format."), scale: int("The resolution, times the size's pixels.", 1, 4) }),
    { annotations: WRITE, history: false, timeoutMs: 1800000, outputSchema: WRITTEN }),

  // ---- the window the user watches (the desktop app only)
  TOOL("get_selection", "Get the selection",
    "What the window shows and has selected: the profile, the channel, the size on the canvas, the scope a change of place reaches, and the selected layer (layers: all of a group). Desktop only.",
    input({}),
    { annotations: READ, hosts: DESKTOP, outputSchema: SELECTION }),
  TOOL("select_layer", "Select a layer",
    "Selects a layer (layer; \"bg\" selects nothing) or several together (layers), and/or shows another size on the canvas (size), as the user would — to show them what you mean. Not a step of undo. Desktop only. Returns the selection.",
    input({ layer: LAYER, layers: list(str("A layer's id."), "Layers to select together.", { minItems: 1, maxItems: 100, uniqueItems: true }), size: SIZE }),
    { annotations: EDIT, history: false, hosts: DESKTOP, needs: { any: ["layer", "layers", "size"], most: ["layer", "layers"] }, outputSchema: SELECTION }),   // strict: another selection shuts the crop, weave, letter and brush windows
  TOOL("undo", "Undo",
    "Undoes the last steps (steps, default 1) of the window's history — the user's and yours alike: each change a tool made is one step. Desktop only. Returns where the history now is.",
    input({ steps: int("How many steps.", 1, 20) }),
    { annotations: { ...EDIT, idempotentHint: false }, history: false, hosts: DESKTOP, outputSchema: HISTORY }),
  TOOL("redo", "Redo",
    "Redoes steps undone (steps, default 1). Desktop only. Returns where the history now is.",
    input({ steps: int("How many steps.", 1, 20) }),
    { annotations: { ...EDIT, idempotentHint: false }, history: false, hosts: DESKTOP, outputSchema: HISTORY }),
];
/** The tools by name. */
export const TOOL_BY = Object.fromEntries(TOOLS.map((d) => [d.name, d]));

/** What an agent is told of SmedCover before it calls anything (MCP's instructions). */
export const INSTRUCTIONS = [
  "SmedCover makes video cover images.",
  "A profile is a brand: its look (the style every cover of it is drawn in), its channels (each with a name, code and colour, and a cover of its own) and its output sizes (such as 1920x1080 and 1080x1920). A cover is a title, a subtitle and a tag over a stack of layers, bottom first: the layout's own parts (bg, title, subtitle, tag, brand, …), which can be moved, restyled and hidden but not removed, and layers that were added (text, photos, solid colours, stickers, graphics). One cover is drawn at every size of its profile; a change of place reaches all sizes, those facing one way, or one size (scope).",
  "On the desktop you work in the user's open window, which they watch: each change a tool makes is one step they can undo, the window switches to the profile and channel you change, and while they are in the middle of something your call waits for them (or answers busy: try again shortly). The read-only tools never switch the window.",
  "Usual flow: get_context (profiles, channels, sizes, what this host can do) → get_cover (the layers and their ids) → change things (set_text, set_look, place_layer, …, or surprise for ready-made variations) → render_preview to see the result → export. Name layers by the ids get_cover gives; sizes as \"1920x1080\", a ratio (\"16:9\") or their name; channels by id, name, code or number from 1.",
].join("\n\n");

/** What ui/tools.json holds (agent-rust-design §3.7): the instructions and every tool as MCP lists it, with what the host reads of it under x-smedcover. */
export function toolsJson() {
  return {
    format: 1, instructions: INSTRUCTIONS,
    tools: TOOLS.map((d) => ({ name: d.name, title: d.title, description: d.description, inputSchema: d.inputSchema, ...(d.outputSchema ? { outputSchema: d.outputSchema } : {}), annotations: d.annotations, "x-smedcover": { hosts: d.hosts, timeoutMs: d.timeoutMs } })),
  };
}
/** ui/tools.json as written, to the byte (the host hashes the file; the page says which list it answers to by the same hash). */
export const toolsText = () => JSON.stringify(toolsJson(), null, 2) + "\n";

// ---------- checking a call's arguments (a subset of JSON Schema: what the tools' schemas use)
const kindOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const fits = (v, type) => (type === "number" ? typeof v === "number" && Number.isFinite(v) : type === "integer" ? Number.isInteger(v) : kindOf(v) === type);
const shown = (v) => { const s = JSON.stringify(typeof v === "string" && v.length > 60 ? v.slice(0, 60) : v); return s === undefined ? String(v) : s.length > 60 ? s.slice(0, 57) + "…" : s; };   // a long string cut before it is quoted
const named = (path) => `"${path || "arguments"}"`;
const article = (type) => (/^[aeiou]/.test(type) ? "an " : "a ") + type;
/** How a pattern is said in a message. */
const SAYS = { [HEX]: '"#rrggbb"', [HEX_OR_AUTO]: '"#rrggbb" or "auto"' };
const same = (a, b) => a === b || (!!a && !!b && typeof a === "object" && typeof b === "object" && JSON.stringify(a) === JSON.stringify(b));   // a string never made JSON of
/**
 * How many characters (code points) string `s` has, counting no further than `most`: an astral character, two UTF-16
 * units, is one, as JSON Schema counts them; a string of millions is not spread into an array to count it.
 */
function charCount(s, most = Infinity) {
  let n = 0;
  for (let i = 0; i < s.length && n < most; i++, n++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++; }
  }
  return n;
}
/** What is wrong with the length of string `v` at `path` against minLength and maxLength, null when nothing is: its units first (at least its characters, at most twice them), counted only when they cannot tell. */
function wrongLength(schema, v, path) {
  const lo = schema.minLength, hi = schema.maxLength;
  if (hi != null && v.length > hi) {
    const n = charCount(v, 2 * hi + 1);
    if (n > hi) return `${named(path)} must be at most ${hi} characters long (it has ${n > 2 * hi ? `more than ${2 * hi}` : n}).`;
  }
  if (lo != null && v.length < 2 * lo && (v.length < lo || charCount(v, lo) < lo)) return `${named(path)} must be at least ${lo} characters long.`;
  return null;
}
/** What is wrong with value `v` at `path` against `schema`, in a sentence; null when nothing is. */
function wrong(schema, v, path) {
  if (!schema || typeof schema !== "object") return null;
  if (schema.anyOf) {
    const tries = schema.anyOf.map((s) => wrong(s, v, path));
    if (tries.some((m) => m === null)) return null;
    const near = schema.anyOf.findIndex((s) => !s.type || [].concat(s.type).some((t) => fits(v, t)));   // the one of its type says best what is wrong
    if (near >= 0 && !schema.anyOf[near].enum) return tries[near];
    return `${named(path)} must be ${schema.anyOf.map((s) => (s.enum ? s.enum.map((x) => JSON.stringify(x)).join(" or ") : [].concat(s.type || "any").map((t) => (t === "array" ? "a list" : article(t))).join(" or "))).join(", or ")}; got ${shown(v)}.`;
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => fits(v, t))) return `${named(path)} must be ${types.map((t) => (t === "array" ? "a list" : article(t))).join(" or ")}, not ${kindOf(v) === "integer" ? "a number" : article(kindOf(v))} (${shown(v)}).`;
  }
  if (schema.enum && !schema.enum.some((x) => same(x, v))) return `${named(path)} must be one of: ${schema.enum.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ")}; got ${shown(v)}.`;
  if ("const" in schema && !same(schema.const, v)) return `${named(path)} must be ${shown(schema.const)}.`;
  if (typeof v === "number") {
    if (schema.minimum != null && v < schema.minimum) return `${named(path)} must be at least ${schema.minimum} (got ${v}).`;
    if (schema.maximum != null && v > schema.maximum) return `${named(path)} must be at most ${schema.maximum} (got ${v}).`;
  }
  if (typeof v === "string") {
    const long = schema.minLength != null || schema.maxLength != null ? wrongLength(schema, v, path) : null;
    if (long) return long;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(v)) return `${named(path)} must be ${SAYS[schema.pattern] || `of the form ${schema.pattern}`}; got ${shown(v)}.`;
  }
  if (Array.isArray(v)) {
    if (schema.minItems != null && v.length < schema.minItems) return `${named(path)} must have at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"} (it has ${v.length}).`;
    if (schema.maxItems != null && v.length > schema.maxItems) return `${named(path)} must have at most ${schema.maxItems} items (it has ${v.length}).`;
    if (schema.uniqueItems) { const seen = new Set(); for (const x of v) { const k = JSON.stringify(x); if (seen.has(k)) return `${named(path)} lists ${k.length > 60 ? k.slice(0, 57) + "…" : k} twice.`; seen.add(k); } }   // in one pass, however long the list
    if (schema.items) for (let i = 0; i < v.length; i++) { const m = wrong(schema.items, v[i], `${path}[${i}]`); if (m) return m; }
  }
  if (kindOf(v) === "object") {
    const props = schema.properties || {}, keys = Object.keys(v), at = (k) => (path ? `${path}.${k}` : k);
    if (schema.maxProperties === 1 && schema.minProperties === 1 && keys.length !== 1) return `${named(path)} takes exactly one of: ${Object.keys(props).join(", ")}${keys.length ? ` (it has ${keys.join(", ")})` : ""}.`;
    if (schema.minProperties != null && keys.length < schema.minProperties) return `${named(path)} must have at least ${schema.minProperties} field${schema.minProperties === 1 ? "" : "s"}.`;
    if (schema.maxProperties != null && keys.length > schema.maxProperties) return `${named(path)} must have at most ${schema.maxProperties} field${schema.maxProperties === 1 ? "" : "s"}.`;
    for (const k of schema.required || []) if (!(k in v) || v[k] === undefined) return `${named(at(k))} is required.`;
    for (const k of keys) {
      if (Object.hasOwn(props, k)) { const m = wrong(props[k], v[k], at(k)); if (m) return m; }
      else if (schema.additionalProperties === false) return path ? `${named(path)} has no field "${k}" (it takes: ${Object.keys(props).join(", ")}).` : `Unknown argument "${k}" (this tool takes: ${Object.keys(props).join(", ") || "none"}).`;
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") { const m = wrong(schema.additionalProperties, v[k], at(k)); if (m) return m; }
    }
  }
  return null;
}
/** What is wrong with `args` against a tool's input schema, in a sentence for the agent; null when nothing is. */
export const checkArgs = (schema, args) => wrong(schema, args === undefined ? {} : args, "");
/**
 * The arguments that ask for something to be done when true (put back, deal again, unweave): false is as good as left
 * out, for what a tool needs. Every other false says something (visible: false hides a layer, plate: false takes one away).
 */
export const FLAGS = ["reset", "resetParams", "reshuffle", "off"];
/** What is wrong with a call of tool `def` with `args`: its schema, then what it needs of them beyond it (see TOOL). Null when nothing is. */
export function checkCall(def, args) {
  const bad = checkArgs(def.inputSchema, args);
  if (bad || !def.needs) return bad;
  const has = (k) => args && args[k] !== undefined && !(args[k] === false && FLAGS.includes(k)), n = (ks) => ks.filter(has).length, { any, one, most } = def.needs;
  if (any && !n(any)) return `Give at least one of: ${any.join(", ")}.`;
  if (one && n(one) !== 1) return `Give exactly one of: ${one.join(", ")}${n(one) ? ` (not ${one.filter(has).join(" and ")})` : ""}.`;
  if (most && n(most) > 1) return `Give at most one of: ${most.join(", ")}.`;
  return null;
}

// ---------- what the commands find things by
/** A profile's size key ("1920x1080"), as render.js's sizeKey. */
export const keyOf = (z) => `${z.w}x${z.h}`;
/**
 * The profile of `profiles` that `want` names: its id, else its name (the case and the spaces round it aside). Throws
 * a ToolError naming those there are when none does, or when the name is several profiles'.
 */
export function findProfile(profiles, want) {
  const w = String(want).trim(), byId = profiles.find((p) => p.id === w);
  if (byId) return byId;
  const hits = profiles.filter((p) => p.name.trim().toLowerCase() === w.toLowerCase());
  if (hits.length === 1) return hits[0];
  const all = profiles.map((p) => `${p.name} (id ${p.id})`).join(", ");
  throw new ToolError("invalid_arguments", hits.length ? `Several profiles are called "${w}"; name one by id: ${hits.map((p) => p.id).join(", ")}.` : `No profile "${w}"; the profiles are: ${all}.`);
}
/**
 * The index among `categories` (a profile's channels) of the channel `want` names: its id, else as a batch table names
 * one (channelIndex in store.js: name, code, number from 1). Throws a ToolError naming the channels when none does.
 */
export function findChannel(categories, want) {
  const w = String(want).trim();
  let i = categories.findIndex((c) => c.id === w);
  if (i < 0) i = channelIndex(w, categories);
  if (i < 0) throw new ToolError("invalid_arguments", `No channel "${w}" in this profile; its channels are: ${categories.map((c, n) => `${n + 1}. ${c.name || c.code || "—"} (id ${c.id})`).join(", ")}.`);
  return i;
}
/**
 * The size of `sizes` (a profile's) that `want` names: its pixels ("1920x1080", also with × or *), its ratio ("16:9",
 * "2.35:1": within 1%), or its name — the user's, the one it came with, or its caption in either language — the
 * case and the spaces aside. Throws a ToolError naming the sizes when none does, or when several do.
 */
export function findSize(sizes, want) {
  const w = String(want).trim(), all = () => sizes.map((z) => (z.name ? `${keyOf(z)} (${z.name})` : keyOf(z))).join(", ");
  const px = /^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/i.exec(w), ratio = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(w), name = w.toLowerCase();
  const hits = px ? sizes.filter((z) => z.w === Number(px[1]) && z.h === Number(px[2]))
    : ratio ? sizes.filter((z) => Number(ratio[2]) > 0 && Math.abs(z.w / z.h / (Number(ratio[1]) / Number(ratio[2])) - 1) < 0.01)
    : sizes.filter((z) => [z.name, z.label, sizeCaption(z, "zh"), sizeCaption(z, "en")].some((s) => s && s.trim().toLowerCase() === name));
  if (hits.length === 1) return hits[0];
  if (hits.length) throw new ToolError("invalid_arguments", `"${w}" is several of the profile's sizes (${hits.map(keyOf).join(", ")}); name one by its pixels.`);
  throw new ToolError("invalid_arguments", `The profile has no size "${w}"; its sizes are: ${all()}.`);
}
/**
 * Ids said for a message: the first `most` of them, then how many more ("bg, title, … and 9 more").
 */
export const idsSaid = (ids, most = 12) => (ids.length > most ? `${ids.slice(0, most).join(", ")} … and ${ids.length - most} more` : ids.join(", "));
/** The edit distance between two short strings (Levenshtein's), for names that are near one another. */
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
/**
 * Of `names`, those nearest `want` (a font asked for that is not there), at most `most`: those with it in their name, or
 * whose name it has in it, first (the shorter first), then those a few letters from it, the case and spaces aside.
 */
export function nearNames(want, names, most = 5) {
  const fold = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim(), w = fold(want), seen = new Set(), out = [];
  if (!w) return [];
  const put = (n) => { if (!seen.has(n) && out.length < most) { seen.add(n); out.push(n); } };
  for (const n of names.filter((n) => fold(n).includes(w) || w.includes(fold(n))).sort((a, b) => a.length - b.length)) put(n);
  const room = Math.max(2, Math.round(w.length / 3));
  for (const [n] of names.map((n) => [n, distance(fold(n), w)]).filter(([, d]) => d <= room).sort((a, b) => a[1] - b[1])) put(n);
  return out;
}
/**
 * Layer L's placement at the size `fr` ({vw, vh, key, catId}: its virtual canvas, as frame() in app.js gives it) in
 * place_layer's terms: x and y as shares of the canvas — a layer that was added, its centre; a layout part, a copy of
 * one or a linked cut-out, its offset (from where the layout puts it, or from its photo) —, s its scale (its own and
 * the size's together, the canvas's height left out), r its turn in degrees, kx and ky its stretch.
 */
export function placeAt(L, { vw, vh, key, catId }) {
  const p = resolve(L, vw, vh, key, catId), k = isFree(L.type) ? Math.min(vw, vh) / 1080 : 1;
  return { x: (isFree(L.type) ? p.cx : p.dx) / vw, y: (isFree(L.type) ? p.cy : p.dy) / vh, s: p.s / k, r: p.r, kx: p.kx, ky: p.ky };
}
/**
 * What place_layer's arguments `a` come to for layer L at size `fr` (see placeAt): `patch`, the edit adjust() in
 * layers.js applies in any scope ({ddx, ddy} in virtual pixels, scale, rot, kx, ky: factors and degrees, only those
 * that change anything), and `want`, the placement each argument given asks for at that size (x, y, s, r, kx, ky).
 * Absolute ones (x, y, scale, rotate, stretchX, stretchY) are reached from where it is now, relative ones (move {dx,
 * dy}, scaleBy, rotateBy) added to it; giving both kinds of one is the caller's to refuse.
 */
export function placePatch(L, fr, a) {
  const now = placeAt(L, fr), patch = {}, want = {}, m = a.move || {};
  const to = (k, abs, rel, plus) => (abs !== undefined ? (want[k] = abs) : rel !== undefined ? (want[k] = plus(now[k], rel)) : undefined);
  const add = (v, d) => v + d, times = (v, f) => v * f;
  const x = to("x", a.x, m.dx, add), y = to("y", a.y, m.dy, add), s = to("s", a.scale, a.scaleBy, times), r = to("r", a.rotate, a.rotateBy, add);
  const kx = to("kx", a.stretchX, undefined, times), ky = to("ky", a.stretchY, undefined, times);
  if (x !== undefined && x !== now.x) patch.ddx = (x - now.x) * fr.vw;
  if (y !== undefined && y !== now.y) patch.ddy = (y - now.y) * fr.vh;
  if (s !== undefined && s !== now.s) patch.scale = s / now.s;
  if (r !== undefined && r !== now.r) patch.rot = r - now.r;
  if (kx !== undefined && kx !== now.kx) patch.kx = kx / now.kx;
  if (ky !== undefined && ky !== now.ky) patch.ky = ky / now.ky;
  return { patch, want };
}
/** The keys of the letters of `words` (a title's, a text layer's), as the weave and the ransom note name them (see weaveLetters in app.js): spaces left out. */
export const letterKeysOf = (words) => parseTitle(String(words || "")).flatMap((runs, row) => { const cells = lineCells(runs); return keysOf(cells, row).filter((k, i) => !/^\s+$/.test(cells[i].ch)); });
/** The width to draw size `z` at for its longer side to be `side` pixels (drawCover rounds the height from it). */
export const widthFor = (z, side) => (z.w >= z.h ? side : (side * z.w) / z.h);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
/**
 * Where each layer landed on a drawing (a canvas's _hits: {id, type, cx, cy, hw, hh, r} in its virtual pixels; `virtual`,
 * [vw, vh]): {id, x, y, w, h, r}, its centre and its size as shares of the image, its turn in degrees; the ground and
 * pieces without an id left out, a layer painted in several pieces once.
 */
export function boxesOf(hits, [vw, vh]) {
  const seen = new Set(), out = [];
  for (const h of hits || []) {
    if (!h || !h.id || h.type === "bg" || seen.has(h.id) || ![h.cx, h.cy, h.hw, h.hh].every(Number.isFinite)) continue;
    seen.add(h.id);
    out.push({ id: h.id, x: r4(h.cx / vw), y: r4(h.cy / vh), w: r4((2 * h.hw) / vw), h: r4((2 * h.hh) / vh), r: Math.round((h.r || 0) * 10) / 10 });
  }
  return out;
}
/**
 * A contact sheet of `sizes` ([{w, h}]): each drawn at one height, in rows as wide as fit within `side` × 1.5, a caption
 * of `cap` pixels under each, `gap` between them — the height the tallest that lets the sheet fit that square, from
 * side / 2 down. So many that they do not fit a pixel high with their captions: the gaps and captions halved till they
 * do (a caller draws no caption too small to read), so the sheet stays within the square for any profile's sizes (at
 * most 80, none past 128:1). Returns {width, height, tile: the drawings' height, tiles: [{x, y, w, h}] (the drawings,
 * in order), gap, cap}.
 */
export function sheetPlan(sizes, side, { gap = 16, cap = 30 } = {}) {
  const most = Math.round(side * 1.5);
  const flow = (th) => {
    const tiles = [];
    let x = gap, y = gap, width = 0;
    for (const z of sizes) {
      const w = Math.max(1, Math.round((th * z.w) / z.h));
      if (x > gap && x + w + gap > most) { x = gap; y += th + cap + gap; }
      tiles.push({ x, y, w, h: th });
      x += w + gap; width = Math.max(width, x);
    }
    return { width, height: y + th + cap + gap, tile: th, tiles, gap, cap };
  };
  for (let th = Math.round(side / 2); th >= 1; th = th > 24 ? Math.floor(th * 0.92) : th - 1) { const p = flow(th); if (p.width <= most && p.height <= most) return p; }
  return gap > 0 || cap > 0 ? sheetPlan(sizes, side, { gap: gap >> 1, cap: cap >> 1 }) : flow(1);
}
/**
 * The type of a picture by its first bytes (a Uint8Array, or an ArrayBuffer): PNG, JPEG, GIF, WebP, or HEIC/HEIF/AVIF
 * (an ISO media file's ftyp box with one of their brands), as picture_type in core/src/files.rs tells them; null for
 * anything else.
 */
export function imageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), at = (i, s) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (at(0, "\x89PNG\r\n\x1a\n")) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(4, "ftyp")) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    return ["avif", "avis"].includes(brand) ? "image/avif" : ["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand) ? "image/heic" : ["mif1", "msf1"].includes(brand) ? "image/heif" : null;
  }
  return null;
}
/** Whether a and b, as JSON has them, hold the same, their keys in whatever order. */
const alike = (a, b) => a === b || (!!a && !!b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)
  && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => Object.hasOwn(b, k) && alike(a[k], b[k])));
/**
 * What checking a cover given whole (apply_cover_json's `raw`) made of it (`fixed`: channelCover's), for the agent:
 * `corrected`, each field given that was kept otherwise ("title", "layers.<id>.<field>"; "layers" for the order of those
 * kept); `dropped`, each field and layer given that was not kept ("scene", "layers.<id>.<field>", "layers.<id>", a
 * layer without an id by its place, "layers[3]"); `restored`, each layer kept that was not given (a layout part put
 * back); a field not given that was filled in is none of these. `missingPhotos`, the pids of its photo layers not
 * hasPhoto(pid); `missingAssets`, its asset layers' refs ("sticker:burst") not hasAsset(ref).
 */
export function coverDiff(raw, fixed, { hasPhoto = () => true, hasAsset = () => true } = {}) {
  const r = raw && typeof raw === "object" ? raw : {}, corrected = [], dropped = [], restored = [];
  for (const k of Object.keys(r)) if (k !== "layers") (Object.hasOwn(fixed, k) ? (alike(r[k], fixed[k]) ? null : corrected) : dropped)?.push(k);
  const given = Array.isArray(r.layers) ? r.layers : [], kept = new Map(fixed.layers.map((L) => [L.id, L])), matched = new Set();
  if (r.layers !== undefined && !Array.isArray(r.layers)) corrected.push("layers");
  given.forEach((g, i) => {
    const id = g && typeof g === "object" && typeof g.id === "string" ? g.id : null, L = id !== null && !matched.has(id) ? kept.get(id) : null;
    if (!L) return dropped.push(id !== null ? `layers.${id}` : `layers[${i}]`);
    matched.add(id);
    for (const k of Object.keys(g)) (Object.hasOwn(L, k) ? (alike(g[k], L[k]) ? null : corrected) : dropped)?.push(`layers.${id}.${k}`);
  });
  for (const L of fixed.layers) if (!matched.has(L.id)) restored.push(`layers.${L.id}`);
  const order = (ls) => ls.map((l) => l && l.id).filter((id) => matched.has(id)).join("\n");
  if (order(given.filter((g, i) => given.findIndex((x) => x && x.id === g?.id) === i)) !== order(fixed.layers)) corrected.push("layers");
  const missingPhotos = [...new Set(fixed.layers.filter((L) => L.type === "photo" && L.pid && !hasPhoto(L.pid)).map((L) => L.pid))];
  const missingAssets = [...new Set(fixed.layers.filter((L) => L.type === "asset" && L.ref && !hasAsset(L.ref)).map((L) => `${L.ref.kind}:${L.ref.id}`))];
  return { corrected, dropped, restored, missingPhotos, missingAssets };
}
