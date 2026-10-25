// The Look sheet's card pictures (see lookCards in app.js): how each card's picture is kept in the data folder from
// one launch to the next, so that the sheet opened soon after the start shows its cards at once, not empty frames
// filling one a frame. Pure: the app draws, encodes and writes the files.

/**
 * How a card's picture is kept: in the data folder's `dir`, a file a look (`<look id>.json`, {sig, src}), `src` the
 * picture as a JPEG data URL at quality `q` (WebKit's canvas cannot encode WebP), drawn `w` px wide as every card is.
 * `v`, the way they are kept: raised when the same cover would come out otherwise on a card (the cards' width, how
 * they are drawn or kept), so that those kept before are stand-ins only, till drawn again.
 */
export const LOOKPIC = Object.freeze({ dir: "lookcards", w: 300, q: 0.8, v: 1 });

/** A fast 53-bit hash of a string (cyrb53), as hex: to tell what a card was drawn from without keeping it all. */
export function hashText(s, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * What a card's picture is kept with, by which the next launch tells whether it still shows what the card is to:
 * the hash of what it was drawn from (`want`: the cover, the size, the style, the look's own settings; see lookBase
 * and lookOwn in app.js), its size in pixels (`w` × `h`), the way it is kept (LOOKPIC.v) and the app's version and
 * build (`app`, "" where it is not known; see appBuild in store.js), a new build drawing the looks anew.
 */
export const lookPicSig = (want, w, h, app = "") => hashText(`${LOOKPIC.v}|${app}|${w}x${h}|${String(want)}`);

/** A card's file as kept: what writeLookPic wrote. */
export const writeLookPic = (sig, src) => JSON.stringify({ sig, src });
/** A card's file as read (its text, or null when there is none), checked: {sig, src}, or null for one cut short, written by hand or by another version. */
export function readLookPic(text) {
  let raw = null;
  try { raw = typeof text === "string" ? JSON.parse(text) : null; } catch (e) { return null; }
  if (!raw || typeof raw !== "object" || typeof raw.sig !== "string" || typeof raw.src !== "string") return null;
  return /^[0-9a-f]{1,16}$/.test(raw.sig) && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(raw.src) ? { sig: raw.sig, src: raw.src } : null;
}
/** The files of a listing of LOOKPIC.dir (`names`) that are no card's of the looks there are (`ids`): a look retired, a write cut short. To be removed. */
export const strayLookPics = (names, ids) => names.filter((n) => !ids.some((id) => n === id + ".json"));
