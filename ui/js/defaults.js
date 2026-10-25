// The app's defaults, in one file that can be changed without touching the code: defaults.json, shipped beside the
// page (ui/defaults.json), organised by module. Beside it, in the app's data folder, custom.json, laid out by the same
// modules: what the user set in the app and wants kept, written by the app, never by hand (see persistSettings and
// readCustom in app.js). Its `settings` are the user's settings themselves, only where they differ from defaults.json,
// read by readSettings in store.js; any other module it has is laid over defaults.json as the app starts (layOver).
// Every module reads a default from DEFAULTS when it needs it, never a copy taken as it loads.
//   settings  what normalizeSettings in store.js falls back to: the language, the export's resolution, format,
//             quality and file names, the scope a change reaches, the glass, the drawer, the cut-out's engine
//   profile   what a new profile starts with (store.js, presets.js): its look and ground, its sizes, the starter
//             profile's name, brand and channels
//   layout    the layout each orientation is given (layout.js)
//   surprise  Surprise me's chances, under the user's own (RULES.odds in deal.js)
//   ui        the window's numbers (app.js): the side columns' widths, the room the canvas keeps, the note on slow glass
// In the page it is fetched, as the built-in repaint styles are; under Node (the tests) read from the disk.

const FILE = new URL("../defaults.json", import.meta.url);
const NODE = FILE.protocol === "file:" && !!(globalThis.process && globalThis.process.versions && globalThis.process.versions.node);
async function shipped() {
  if (NODE) return (await import("node:fs/promises")).readFile(FILE, "utf8");
  const r = await fetch(FILE);
  if (!r.ok) throw new Error(`defaults.json: HTTP ${r.status}`);
  return r.text();
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const freeze = (v) => { if (v && typeof v === "object") { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };

/** defaults.json as read, or a word in the window that it could not be (no module can start without it). */
async function read() {
  try { return JSON.parse(await shipped()); }
  catch (e) { if (!NODE && globalThis.document && document.body) document.body.textContent = `SmedCover could not read its defaults (defaults.json): ${e.message}`; throw e; }
}
/** defaults.json as shipped, never changed: what custom.json is checked against and written beside. */
export const SHIPPED = freeze(await read());
/** The defaults in use: defaults.json with custom.json's modules besides `settings` laid over it (layOver). The one object, for as long as the page lives. */
export const DEFAULTS = clone(SHIPPED);

/** What kind of JSON value `v` is: "number" (a finite one), "string", "boolean", "array", "object", or "" for anything else (null). */
function kindOf(v) {
  if (Array.isArray(v)) return "array";
  if (v && typeof v === "object") return "object";
  if (typeof v === "number") return Number.isFinite(v) ? "number" : "";
  return typeof v === "string" || typeof v === "boolean" ? typeof v : "";
}
const SCALAR = ["number", "string", "boolean"];
/**
 * Lays `raw` (an object of custom.json's) over `into`, in place, as defaults.json has `like` there (at path `at`): a key
 * it has, with a value of the same kind, is taken — an object gone into key by key, a list taken whole (fit) —; an object
 * defaults.json leaves empty takes any key whose value is a number, text, true or false. What is not taken is noted in
 * `out`, by its path.
 */
function layInto(into, raw, like, at, out) {
  const open = !Object.keys(like).length;
  for (const [k, v] of Object.entries(raw)) {
    const path = at ? `${at}.${k}` : k;
    if (open) { if (SCALAR.includes(kindOf(v))) into[k] = v; else out.push(path); continue; }
    if (!Object.hasOwn(like, k)) { out.push(path); continue; }
    if (kindOf(like[k]) === "object" && kindOf(v) === "object") {
      if (kindOf(into[k]) !== "object") into[k] = {};
      layInto(into[k], v, like[k], path, out);
      continue;
    }
    const got = fit(v, like[k], path, out);
    if (got !== undefined) into[k] = got;
  }
}
/**
 * Value `v` as it may stand where defaults.json has `like`, or undefined (noted in `out`) when it is not of its kind.
 * A list: each item of the kind of `like`'s first (an object item keeping, key by key, what its first has), the others
 * left out.
 */
function fit(v, like, at, out) {
  const kind = kindOf(like);
  if (kind === "object" && kindOf(v) === "string" && Object.keys(like).sort().join() === "en,zh") return { zh: v, en: v };   // a name in one language, for both
  if (!kind || kindOf(v) !== kind) { out.push(at); return undefined; }
  if (kind === "object") { const o = {}; layInto(o, v, like, at, out); return o; }
  if (kind !== "array") return v;
  if (!like.length) return v.filter((x, i) => SCALAR.includes(kindOf(x)) || (out.push(`${at}[${i}]`), false));
  const items = [];
  v.forEach((x, i) => { const got = fit(x, like[0], `${at}[${i}]`, out); if (got !== undefined) items.push(got); });
  return items;
}
/**
 * Lays `custom` (custom.json as read; null or undefined: none) over defaults.json as shipped, and makes DEFAULTS that,
 * in place (the same object). Every module but `settings`, which holds the user's settings rather than defaults (only
 * where they differ from these, see readSettings in store.js), and so leaves DEFAULTS.settings as shipped, what they
 * are told apart by; nor the mark of a file the app wrote (`by`). Key by key, as deep as it goes: a value is taken only where defaults.json has that key and a value
 * of the same kind (a number for a number, text for text, true or false, a list for a list, an object for an object, see
 * layInto); anything else is let go and the default kept. Whether a value taken is within range is for whatever reads
 * it: the normalisers (normalizeProfile, oddsOf…) hold it there, as they do what the files hold. Returns the paths of
 * what was let go ("profile.sizes[1].w", "ui.colour").
 */
export function layOver(custom) {
  const out = [], next = clone(SHIPPED);
  if (custom != null) {
    if (kindOf(custom) === "object") { const { by, settings, ...rest } = custom; layInto(next, rest, SHIPPED, "", out); }
    else out.push("(custom.json)");
  }
  for (const k of Object.keys(DEFAULTS)) delete DEFAULTS[k];
  Object.assign(DEFAULTS, next);
  return out;
}
