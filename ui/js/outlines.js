// Glyph outlines for the text effects that reshape letters.
//
// The outlines come from the native side (which can read font files: the app's, or a SmedCover
// server's); asking for them takes a moment, while drawing cannot wait. So outline() answers at once
// from a cache — null the first time, when it also sends for the outline — and tells the app when one
// has arrived, to redraw.
// Without the native side (the interface open in a plain browser) there are no outlines, and the
// effects that need them fall back to ordinary lettering.
// What arrived is kept from one launch to the next (keepOutlines, keptOutlines: written and read by the app), so
// that the start draws with the outlines at once instead of sending for them all again, the look cards and the
// 3D view drawn again as each comes.
import { CAN, invoke } from "./store.js";

/**
 * How outlines are kept from one launch to the next: in the data folder's `file`, those used last kept, at most `max`
 * characters of JSON (about as many bytes; the cache in memory holds as much). `v`, the way they are kept and traced:
 * raised when the native side traces otherwise, those kept before let go.
 */
export const OUTLINE_KEEP = Object.freeze({ file: "outlines.json", v: 1, max: 8 * 1024 * 1024 });
/**
 * The outlines by key (see keyOf), the one used last at the end; how many characters each takes as JSON, and all of
 * them; `failed`, those whose request failed (a server away for a moment): false here too, but not kept till the next
 * launch. `era` counts the fonts let go (forgetOutlines): what was sent for before is dropped as it comes.
 */
const cache = new Map(), pending = new Map(), sizes = new Map(), failed = new Set();
let arrived = () => {}, total = 0, missed = 0, unkept = false, era = 0;
/** About how many characters `glyphs` (an outline, or false) takes as JSON, with its key: a number is some 7. */
function weigh(key, glyphs) {
  let n = 16 + key.length;
  if (glyphs) for (const g of glyphs) { n += 16; for (const c of g.c) n += 2 + c.length * 7; }
  return n;
}
/** Puts an outline in the cache, as the one used last; those used longest ago go while there are more than OUTLINE_KEEP.max. */
function put(key, glyphs) {
  if (cache.has(key)) { total -= sizes.get(key); cache.delete(key); }
  const n = weigh(key, glyphs);
  cache.set(key, glyphs); sizes.set(key, n); total += n; failed.delete(key);
  for (const k of cache.keys()) { if (total <= OUTLINE_KEEP.max || k === key) break; total -= sizes.get(k); cache.delete(k); sizes.delete(k); failed.delete(k); }
}
/** The cache's key for `text` in `font`: outlines are in ems, so the size does not matter. */
const keyOf = (font, text) => font.replace(/[\d.]+px/, "px") + "\n" + text;
/** Sets what to call when an outline that was asked for has arrived. */
export const onOutlines = (fn) => { arrived = fn; };

/** "900 120px "Bebas Neue", "Noto Sans SC", sans-serif" -> { weight: 900, families: ["Bebas Neue", "Noto Sans SC"] } */
export function parseFont(font) {
  const m = /^(.*?)([\d.]+)px\s+(.*)$/.exec(String(font)), head = m ? m[1] : "", w = /\b([1-9]00)\b/.exec(head);
  const generic = ["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy"];
  return {
    weight: w ? Number(w[1]) : /\bbold\b/.test(head) ? 700 : 400,
    families: (m ? m[3] : "").split(",").map((f) => f.trim().replace(/^["']|["']$/g, "")).filter((f) => f && !generic.includes(f)),
  };
}

/**
 * The outline of `text` in the canvas font `font`: an array of glyphs {adv, c} (see the native
 * side), false when it cannot be had, or null while it is on its way.
 */
export function outline(font, text) {
  if (!CAN.outlines || !text) return false;
  const key = keyOf(font, text);
  if (cache.has(key)) { const glyphs = cache.get(key); cache.delete(key); cache.set(key, glyphs); return glyphs; }   // the one used last now
  if (!pending.has(key)) {
    const { weight, families } = parseFont(font), sent = era;
    const job = invoke("text_outline", { text, families, weight })
      .then((o) => (!o || !Array.isArray(o.glyphs) ? null : o.missing ? false : o.glyphs), () => null)   // no answer, or not one (a server's empty reply): failed
      .then((glyphs) => {
        pending.delete(key);
        if (sent === era) { put(key, glyphs || false); if (glyphs === null) failed.add(key); else unkept = true; }   // a font let go since: sent for again as it is next drawn
        arrived();
      });
    pending.set(key, job);
  }
  missed++;
  return null;
}
/** How many outlines are still on their way, and a promise for when they have all arrived. */
export const outlinesPending = () => pending.size;
export const outlinesSettled = () => Promise.all([...pending.values()]);
/**
 * How many times outline() has answered null, an outline still on its way: read before and after a drawing, it tells
 * whether that drawing went without one, to be drawn again once it comes (a sheet of the 3D view, see paintSheets in app.js).
 */
export const outlinesMissed = () => missed;
/**
 * The outlines to keep till the next launch (OUTLINE_KEEP), as the text of the file, or null when none has come since
 * they were last asked for: {v, sig, at: [[key, glyphs], …]}, the one used longest ago first. `sig` says what they were
 * traced from (the app's version, the fonts installed: see outlineSig in app.js); read back with another, they are let go.
 */
export function keepOutlines(sig) {
  if (!unkept) return null;
  unkept = false;
  return JSON.stringify({ v: OUTLINE_KEEP.v, sig, at: [...cache].filter(([k]) => !failed.has(k)) });
}
/**
 * Puts the outlines kept from the last launch (`text`, the file's, or null) in the cache, older than those there
 * already, where they were kept with `sig` and as they are kept now; a file cut short, or not as written, is let go.
 * How many were taken.
 */
export function keptOutlines(text, sig) {
  let raw = null;
  try { raw = typeof text === "string" ? JSON.parse(text) : null; } catch (e) { return 0; }
  if (!raw || raw.v !== OUTLINE_KEEP.v || raw.sig !== sig || !Array.isArray(raw.at)) { if (raw) unkept = true; return 0; }   // written over with what comes
  const now = [...cache], here = new Set(cache.keys()), fails = [...failed];
  cache.clear(); sizes.clear(); total = 0;
  let n = 0;
  for (const e of raw.at) if (Array.isArray(e) && typeof e[0] === "string" && !here.has(e[0]) && isOutline(e[1])) { put(e[0], e[1]); n++; }
  for (const [k, glyphs] of now) put(k, glyphs);
  for (const k of fails) failed.add(k);   // still not to be kept
  return n;
}
/** Whether `glyphs` is an outline as the native side gives it ([{adv, c: [[x, y, …], …]}]), or false. */
const isOutline = (glyphs) => glyphs === false || (Array.isArray(glyphs) && glyphs.every((g) => g && Number.isFinite(g.adv) && Array.isArray(g.c) && g.c.every(Array.isArray)));
/**
 * Lets go the outlines traced with font `family` (one imported again, from another file): sent for again as they are
 * next drawn, and kept anew.
 */
export function forgetOutlines(family) {
  era++;
  for (const k of [...cache.keys()]) if (parseFont(k.slice(0, k.indexOf("\n")).replace("px", "1px")).families.includes(family)) { total -= sizes.get(k); cache.delete(k); sizes.delete(k); failed.delete(k); unkept = true; }
}
/** Test hook: puts an outline in the cache as if it had arrived. */
export const primeOutline = (font, text, glyphs) => { put(keyOf(font, text), glyphs); unkept = true; };
