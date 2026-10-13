// Glyph outlines for the text effects that reshape letters.
//
// The outlines come from the native side (which can read font files); asking for them takes a
// moment, while drawing cannot wait. So outline() answers at once from a cache — null the first
// time, when it also sends for the outline — and tells the app when one has arrived, to redraw.
// Without the native side (the interface open in a plain browser) there are no outlines, and the
// effects that need them fall back to ordinary lettering.
import { native, invoke } from "./store.js";

const cache = new Map(), pending = new Map();
let arrived = () => {};
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
  if (!native || !text) return false;
  const key = font.replace(/[\d.]+px/, "px") + "\n" + text;   // outlines are in ems: the size does not matter
  if (cache.has(key)) return cache.get(key);
  if (!pending.has(key)) {
    const { weight, families } = parseFont(font);
    const job = invoke("text_outline", { text, families, weight })
      .then((o) => (o.missing ? false : o.glyphs), () => false)
      .then((glyphs) => {
        if (cache.size > 400) cache.delete(cache.keys().next().value);
        cache.set(key, glyphs); pending.delete(key); arrived();
      });
    pending.set(key, job);
  }
  return null;
}
/** How many outlines are still on their way, and a promise for when they have all arrived. */
export const outlinesPending = () => pending.size;
export const outlinesSettled = () => Promise.all([...pending.values()]);
/** Test hook: puts an outline in the cache as if it had arrived. */
export const primeOutline = (font, text, glyphs) => cache.set(font.replace(/[\d.]+px/, "px") + "\n" + text, glyphs);
