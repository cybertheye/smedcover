// Geometry of a cover, for any pixel size and any template. Pure functions, no DOM.
//
// Everything is laid out in a "virtual" canvas whose short side is 1080–1200 units whatever the
// real pixel size, so type and line weights keep their proportions from 900x383 up to 8K.

import { FOOT, WORDS_FOOT, PLATFORM_IDS, RED_RATIOS, isRatio, wanted } from "./platforms.js";
import { LIMITS } from "./check.js";

const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;

/** Virtual canvas size for a real w x h. 16:9 -> 1920x1080, 4:3 -> 1600x1200, 1:1 -> 1200x1200. */
export function virtualSize(w, h) {
  const r = Math.max(w / h, h / w);
  const short = lerp(1200, 1080, clamp((r - 4 / 3) / (16 / 9 - 4 / 3)));
  return w >= h ? [Math.round((short * w) / h), short] : [short, Math.round((short * h) / w)];
}

// Hand-tuned reference layouts of the "stack" template (title field on top, accent strip below),
// as fractions of the virtual size. Other aspect ratios are interpolated between them.
//   el/er: y of the slanted edge at the left/right side      ax/ay/s: graphic centre and scale
//   tb: bottom of the title box                               name: category name size
const STACK_ANCHORS = [
  { a: 9 / 16, el: 0.7188, er: 0.6823, ax: 0.75, ay: 0.7969, s: 0.9, tb: 0.625, name: 120 },
  { a: 3 / 4, el: 0.7063, er: 0.6625, ax: 0.7083, ay: 0.7813, s: 0.9, tb: 0.5938, name: 120 },
  { a: 1, el: 0.6917, er: 0.6417, ax: 0.7417, ay: 0.7833, s: 0.7, tb: 0.575, name: 100 },
  { a: 4 / 3, el: 0.7, er: 0.6417, ax: 0.7438, ay: 0.775, s: 0.8, tb: 0.5667, name: 110 },
  { a: 16 / 9, el: 0.6667, er: 0.5926, ax: 0.7396, ay: 0.7315, s: 0.72, tb: 0.5139, name: 110 },
];

function interpolate(anchors, aspect) {
  const x = Math.log(aspect);
  if (aspect <= anchors[0].a) return anchors[0];
  for (let i = 1; i < anchors.length; i++) {
    const lo = anchors[i - 1], hi = anchors[i];
    if (aspect <= hi.a) {
      const t = (x - Math.log(lo.a)) / (Math.log(hi.a) - Math.log(lo.a));
      const out = {};
      for (const k of Object.keys(lo)) out[k] = lerp(lo[k], hi[k], t);
      return out;
    }
  }
  return anchors[anchors.length - 1];
}

export const TEMPLATES = ["stack", "split", "banner"];

// ---------- which way a size faces, and the layout each size is drawn in
// A profile's sizes fall into three groups by their shape: wide (landscape, 5:4 and wider), square, and tall
// (portrait, 4:5 and taller). The groups are what the scope's middle choice reaches (see adjust in layers.js),
// and what "Wide side by side, tall and square stacked" lays out (layoutByOrient).
/** The orientations a size may have, landscape to portrait. */
export const ORIENTS = ["wide", "square", "tall"];
/** Which way a size of w × h faces: "wide" (wider than 1.1 : 1, so 5:4 is), "tall" (narrower than 0.91 : 1, so 4:5 is), else "square". */
export function orientOf(w, h) {
  const r = w / h;
  return r > 1.1 ? "wide" : r < 0.91 ? "tall" : "square";
}
/** The width and height of the size keyed "1920x1080" (see sizeKey in render.js), or null for a key that is not one. */
export const sizeOfKey = (key) => { const m = /^(\d+)x(\d+)$/.exec(String(key)); return m ? [Number(m[1]), Number(m[2])] : null; };
/** The orientation of the size keyed "1920x1080"; "square" for a key that is not one. */
export const orientOfKey = (key) => { const d = sizeOfKey(key); return d ? orientOf(d[0], d[1]) : "square"; };
/** Whether the sizes keyed `a` and `b` are of one ratio (1920x1080 and 1280x720), as isRatio in platforms.js has it. */
const sameRatio = (a, b) => { const p = sizeOfKey(a), q = sizeOfKey(b); return !!p && !!q && Math.abs(p[0] / p[1] - q[0] / q[1]) < 0.01; };
/**
 * The sizes of another profile (`from`, its size keys) whose place size `key` of this one takes (`to`, this profile's
 * size keys, `key` among them), when what was kept by size there comes here — a layer's sizes and its placement per size
 * (see acrossSizes in layers.js): a size key is exact pixels, so 1920x1080 there is no size here whose 16:9 is 1280x720.
 * Itself, where it is one of them; else those there, and not here, of its ratio; else, where there are none, those
 * there facing its way (see orientOf) of a ratio no size here has; else none.
 */
export function standsFor(key, from, to) {
  if (from.includes(key)) return [key];
  const gone = from.filter((k) => !to.includes(k)), like = gone.filter((k) => sameRatio(k, key));
  if (like.length) return like;
  const way = orientOfKey(key);
  return gone.filter((k) => orientOfKey(k) === way && !to.some((x) => sameRatio(x, k)));
}
/**
 * The template and adjustments size `key` is drawn in: { template, adjust }. A profile's style has one template and
 * its adjustments (style.template, style.layoutAdjust of it), which every size follows, unless that size has a layout
 * of its own (style.layoutBy[key]: { template, adjust }, set from the Style tab with the scope at one size or one
 * orientation, see setLayoutOf). Whatever lays a cover out asks here.
 */
export function layoutOf(style, key) {
  const own = style.layoutBy && key && Object.hasOwn(style.layoutBy, key) ? style.layoutBy[key] : null;
  return own ? { template: own.template, adjust: own.adjust || {} } : { template: style.template, adjust: (style.layoutAdjust || {})[style.template] || {} };
}
/** Whether size `key` has a layout of its own (see layoutOf), rather than following the profile's. */
export const ownLayout = (style, key) => !!(style.layoutBy && key && Object.hasOwn(style.layoutBy, key));
/**
 * Puts layout `lay` ({ template, adjust }) on `style` (in place): with `keys` null, as the profile's own template and its
 * adjustments, which every size without a layout of its own follows (the other templates' adjustments kept, so a
 * template chosen again comes back as it was); else on each size of `keys` as a layout of its own.
 */
export function setLayoutOf(style, keys, lay) {
  const adjust = { ...(lay.adjust || {}) };
  if (!keys) {
    style.template = lay.template;
    const a = (style.layoutAdjust = style.layoutAdjust || {});
    if (Object.keys(adjust).length) a[lay.template] = adjust; else delete a[lay.template];
    return;
  }
  const by = (style.layoutBy = style.layoutBy || {});
  for (const k of keys) by[k] = { template: lay.template, adjust: { ...adjust } };
}
/** Size `key` follows the profile's layout again: its own is let go (see layoutOf). */
export function followLayout(style, key) {
  if (!style.layoutBy) return;
  delete style.layoutBy[key];
  if (!Object.keys(style.layoutBy).length) delete style.layoutBy;
}
/** The template each orientation is given by "Wide side by side, tall and square stacked" (layoutByOrient). */
export const BY_ORIENT = { wide: "split", square: "stack", tall: "stack" };
/**
 * "Wide side by side, tall and square stacked": every size of `sizes` ([{w, h}]) drawn in the template its
 * orientation takes (BY_ORIENT), as that template comes (no adjustments), in place. A size that the profile's own
 * template already draws so (that template, not adjusted) follows it; the others are given it as a layout of their
 * own, and every layout of their own they had before is let go. Asked for, never done of itself: a profile is drawn
 * as it was until then.
 */
export function layoutByOrient(style, sizes) {
  const plain = !Object.keys((style.layoutAdjust || {})[style.template] || {}).length, by = {};
  for (const s of sizes) {
    const template = BY_ORIENT[orientOf(s.w, s.h)];
    if (template !== style.template || !plain) by[`${s.w}x${s.h}`] = { template, adjust: {} };
  }
  if (Object.keys(by).length) style.layoutBy = by; else delete style.layoutBy;
}
/** The two layouts { template, adjust } the same: one template, and the same adjustments (in whatever order they were set). */
export function sameLayout(a, b) {
  const x = a.adjust || {}, y = b.adjust || {}, keys = Object.keys(x);
  return a.template === b.template && keys.length === Object.keys(y).length && keys.every((k) => x[k] === y[k]);
}

// ---------- the colour block's side, as a layout preset's editor moves it (see layoutEditor in app.js)
// Where the block lies is not a setting of its own: it is the template (Stack and Banner along the foot, Split down
// the right) and whether the halves are swapped (`flip`: the band on top, the panel on the left). Dragged toward
// another side, the block goes there, as one of those.
/** The sides the colour block may lie on. */
export const SIDES = ["bottom", "top", "right", "left"];
/** The side the colour block of layout `lay` ({ template, adjust }) lies on. */
export const sideOf = (lay) => (lay.template === "split" ? (lay.adjust && lay.adjust.flip ? "left" : "right") : lay.adjust && lay.adjust.flip ? "top" : "bottom");
/**
 * Layout `lay` with its colour block on `side`: along the top or the foot, a band (Stack; an old preset's slim band,
 * Banner, stays slim); down the right or the left, a panel (Split); swapped (`flip`) on top and on the left. Its
 * other adjustments go with it — how much it takes, how its edge leans, the title's box, as fractions of the picture
 * (see adjustLayout) — so the block is the same one moved. `lay` itself when it lies there already.
 */
export function onSide(lay, side) {
  if (!SIDES.includes(side) || sideOf(lay) === side) return lay;
  const band = side === "top" || side === "bottom", adjust = { ...(lay.adjust || {}) };
  if (side === "top" || side === "left") adjust.flip = true; else delete adjust.flip;
  return { template: band ? (lay.template === "banner" ? "banner" : "stack") : "split", adjust };
}
/**
 * The side a drag of the colour block by (dx, dy) leads toward — the way it went most, across or down — or null while
 * it is still within `min` of where it began (so a press that wobbles moves nothing). In the canvas's units.
 */
export function sideToward(dx, dy, min) {
  if (Math.hypot(dx, dy) < min) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}
/** The side across the canvas from each side. */
const ACROSS = { bottom: "top", top: "bottom", right: "left", left: "right" };
/**
 * Layout `lay` ({ template, adjust }) moved as another block was dragged from side `from` to side `to`, where one change
 * reaches blocks that need not lie alike (every size: wide ones side by side, the others stacked). Toward the side
 * across, a mirror: each goes to the side across from its own — a panel on the right to the left, a band along the
 * foot to the top —, so what lay side by side still does, and what was stacked still is. Toward a side beside, a
 * turn: each goes to that side, a band there or a panel. The block dragged goes where it was dragged either way.
 */
export const sideLike = (lay, from, to) => onSide(lay, to === ACROSS[from] ? ACROSS[sideOf(lay)] : to);
/** The `size` and `slant` the colour block of layout `lay` has on a canvas of w × h (virtual units): its own, else as its template comes (see layoutValues). */
export const blockValues = (lay, w, h) => layoutValues(adjustLayout(layout(lay.template, w, h), w, h, lay.adjust || {}), w, h);
/**
 * Layout `lay` with its colour block made bigger or smaller and leaned as another was by its diamonds (see dragLayout),
 * as a share of each one's own: `own` ({ size, slant }, see blockValues), what `lay`'s block has; `was` and `now`, what
 * the block dragged had and has. Each change is measured against the dragged block's size and made in the other's, so
 * a panel made a third wider is a band made a third deeper, and an edge leaned by a tenth of its block leans the other
 * by a tenth of its own — not a panel's share of the width put on a band's height. `lean` false (the edge moved by its
 * middle): the slant left as it was. Within LAYOUT_LIMITS.
 */
export function scaleBlock(lay, own, was, now, lean = true) {
  const k = own.size / Math.max(1e-6, was.size), adjust = { ...(lay.adjust || {}) };
  adjust.size = clamp(own.size + (now.size - was.size) * k, ...LAYOUT_LIMITS.size);
  if (lean) adjust.slant = clamp(own.slant + (now.slant - was.slant) * k, ...LAYOUT_LIMITS.slant);
  return { template: lay.template, adjust };
}

/**
 * Layout for a virtual canvas of w x h. All values are in virtual units.
 *   accent   polygon of the accent-coloured region; its first two points are the dividing edge
 *   edge     the inked dividing line: [x0, y0, x1, y1] and the side its white hairline sits on
 *   title    box the title is fitted into
 *   tag      top-left corner and font size of the corner tag
 *   cat      category name block: origin, size, max width, whether it sits on the accent colour,
 *            and whether the sub-name plate goes beside (inline) or below the name
 *   art      graphic centre and scale
 */
export function layout(template, w, h) {
  const aspect = w / h;
  if (template === "split") return splitLayout(w, h, aspect);
  const p = interpolate(STACK_ANCHORS, aspect);
  let el = p.el * h, er = p.er * h, tb = p.tb * h, s = p.s, name = p.name, ay = p.ay * h;
  const banner = template === "banner";
  if (banner) {
    // same structure with a slim strip: the field (usually a photo) takes almost everything
    const strip = Math.max(170, 0.17 * Math.min(w, h) + 0.02 * h);
    const slope = (el - er) * 0.6;
    el = h - strip;
    er = el - slope;
    tb = er - 60;
    s = p.s * 0.52;
    name = 72;
    ay = el - 10;
  }
  const stripH = h - el;
  return {
    template: banner ? "banner" : "stack",
    accent: [[0, el], [w, er], [w, h], [0, h]],
    edge: { line: [0, el, w, er], nx: 0, ny: -1 },
    title: { x: 80, y: 150, w: w - 160, h: Math.max(120, tb - 150) },
    tag: { x: 84, y: el - (banner ? 96 : 70), fs: banner ? 64 : 100 },
    cat: banner
      ? { x: 84, y: el + stripH * 0.5 + name * 0.36, fs: name, maxW: w * 0.42, onAccent: true, inline: true }
      : { x: 84, y: el + 94 + name * 0.9 + Math.max(0, (stripH - 330) * 0.5), fs: name, maxW: p.ax * w - 290 * s - 130, onAccent: true, inline: false },
    art: { x: (banner ? Math.max(p.ax, 0.8) : p.ax) * w, y: ay, s },
    toneFrom: er - 20,
  };
}

// "split": title on a dark column, graphic on a slanted accent panel to the right.
function splitLayout(w, h, aspect) {
  const wide = clamp((aspect - 0.75) / (16 / 9 - 0.75));   // 0 for portrait, 1 for 16:9 and wider
  const px = lerp(0.6, 0.58, wide) * w, slant = lerp(0.05, 0.075, wide) * w;
  const panelW = w - px;
  const s = clamp(Math.min(panelW / 760, h / 1150), 0.35, 1.05);
  const name = lerp(84, 110, wide);
  return {
    template: "split",
    accent: [[px + slant, 0], [px - slant, h], [w, h], [w, 0]],
    edge: { line: [px + slant, 0, px - slant, h], nx: -1, ny: 0 },
    title: { x: 80, y: 150, w: px - slant - 150, h: Math.max(120, h - 150 - 400) },
    tag: { x: 84, y: h - 392, fs: lerp(64, 100, wide) },
    cat: { x: 84, y: h - 150, fs: name, maxW: px - slant - 170, onAccent: false, inline: false },
    art: { x: px + panelW * 0.52, y: h * 0.5, s },
    toneFrom: 0,
  };
}

/**
 * A layout built from plain rectangles, for looks whose panels are not slanted. Same shape of
 * result as layout(). `o` gives the proportions:
 *   band   height of the colour band of "stack", as a fraction of the canvas height
 *   side   width of the colour panel of "split", as a fraction of the canvas width
 *   strip  height of the thin band of "banner"
 *   top    true puts the band of "stack" at the top instead of the bottom
 */
export function blockLayout(template, w, h, o) {
  const aspect = w / h, wide = clamp((aspect - 0.75) / (16 / 9 - 0.75));
  if (template === "split") {
    const px = w * (1 - o.side * lerp(0.86, 1, wide)), panel = w - px, name = lerp(84, 110, wide);
    return {
      template: "split",
      accent: [[px, 0], [px, h], [w, h], [w, 0]],
      edge: { line: [px, 0, px, h], nx: -1, ny: 0 },
      title: { x: 80, y: 150, w: px - 160, h: Math.max(120, h - 150 - 400) },
      tag: { x: 84, y: h - 392, fs: lerp(64, 100, wide) },
      cat: { x: 84, y: h - 150, fs: name, maxW: px - 170, onAccent: false, inline: false },
      art: { x: px + panel * 0.5, y: h * 0.5, s: clamp(Math.min(panel / 760, h / 1150), 0.35, 1.05) },
      toneFrom: 0,
    };
  }
  const banner = template === "banner";
  const bandH = banner ? Math.max(150, h * o.strip) : h * o.band, el = h - bandH;
  const name = banner ? 72 : clamp(bandH * 0.3, 64, 118), tagFs = banner ? 64 : lerp(72, 96, wide);
  return {
    template: banner ? "banner" : "stack",
    accent: [[0, el], [w, el], [w, h], [0, h]],
    edge: { line: [0, el, w, el], nx: 0, ny: -1 },
    title: { x: 80, y: 150, w: w - 160, h: Math.max(120, el - 150 - tagFs * 1.34 - 70) },
    tag: { x: 84, y: el - tagFs * 1.34 - 34, fs: tagFs },
    cat: { x: 84, y: el + bandH * 0.5 + name * 0.36, fs: name, maxW: w * (banner ? 0.42 : 0.5), onAccent: true, inline: banner || bandH < 300 },
    art: { x: w * lerp(0.7, 0.77, wide), y: banner ? el - 10 : el + bandH * 0.08, s: clamp(Math.min(w * 0.42, h * 0.5) / 640, 0.3, 1) * (banner ? 0.6 : 1) },
    toneFrom: el,
  };
}

/** What the user may change about a template: all optional, all as fractions so one setting suits every size (or every size of a layout of its own, see layoutOf). */
export const LAYOUT_LIMITS = { size: [0.08, 0.8], slant: [-0.3, 0.3], tw: [0.3, 1], th: [0.3, 1] };
/**
 * A template's layout as the user has adjusted it.
 *   size   how much of the canvas the colour panel takes: its height for "stack" and "banner",
 *          its width for "split"
 *   slant  how far the dividing edge leans, as a fraction of the canvas height (or width for "split");
 *          0 is level
 *   tw/th  the title's box, as fractions of the width and height the template gives it
 *   flip   swaps the two halves: the panel goes on top (or on the left) and the title below (or right)
 * `G` is the template's own layout (see layout()); a new object of the same shape is returned, with
 *   railOnAccent   the right end of the brand row sits on the colour panel
 *   brandOnAccent  the brand row as a whole sits on the colour panel
 *   titleTop       where the title's box starts, when that is not just under the brand row
 *   flipped        whether the halves are swapped
 */
export function adjustLayout(G, w, h, a = {}) {
  const g = { ...G, accent: G.accent.map((p) => [...p]), edge: { ...G.edge }, title: { ...G.title }, tag: { ...G.tag }, cat: { ...G.cat }, art: { ...G.art } };
  const split = g.template === "split", A = g.accent[0], B = g.accent[1];
  g.railOnAccent = split; g.brandOnAccent = false; g.flipped = false;
  if (a.size == null && a.slant == null) { /* the edge stays exactly where the template put it */ }
  else if (split) {
    const px0 = (A[0] + B[0]) / 2, sl0 = (A[0] - B[0]) / 2;
    const px = a.size != null ? w * (1 - a.size) : px0, sl = a.slant != null ? (a.slant * w) / 2 : sl0, dx = px - px0;
    A[0] = px + sl; B[0] = px - sl;
    g.title.w = Math.max(200, g.title.w + dx - (sl - sl0));
    g.cat.maxW = Math.max(120, g.cat.maxW + dx);
    g.art.x += dx / 2; g.art.s = clamp(g.art.s * clamp((w - px) / Math.max(1, w - px0), 0.5, 1.7), 0.25, 1.3);
  } else {
    const mid0 = (A[1] + B[1]) / 2, sl0 = A[1] - B[1];
    const mid = a.size != null ? h * (1 - a.size) : mid0, sl = a.slant != null ? a.slant * h : sl0, dy = mid - mid0, dl = mid + sl / 2 - A[1];
    A[1] = mid + sl / 2; B[1] = mid - sl / 2;
    g.title.h = Math.max(120, g.title.h + dy - Math.max(0, sl - sl0) / 2);
    g.tag.y += dl; g.cat.y = Math.min(h - 40, g.cat.y + dy / 2 + (dl - dy) / 2); g.art.y += dy; g.toneFrom += dy;
  }
  g.edge.line = [A[0], A[1], B[0], B[1]];
  if (a.tw != null) g.title.w *= clamp(a.tw, ...LAYOUT_LIMITS.tw);
  if (a.th != null) g.title.h *= clamp(a.th, ...LAYOUT_LIMITS.th);
  if (!a.flip) return g;

  g.flipped = true; g.brandOnAccent = true; g.railOnAccent = !split;
  if (split) {   // the panel on the left, the title to its right
    const xa = w - A[0], xb = w - B[0], right = Math.max(xa, xb);
    g.accent = [[xa, 0], [xb, h], [0, h], [0, 0]];
    g.edge = { line: [xa, 0, xb, h], nx: 1, ny: 0 };
    g.title.x = right + 80; g.title.w = Math.max(200, Math.min(g.title.w, w - right - 160));
    g.tag.x = right + 84; g.cat.x = right + 84; g.cat.maxW = Math.max(120, w - right - 170);
    g.art.x = w - g.art.x;
    return g;
  }
  // the band on top, holding the brand row; the title below it
  const ya = h - A[1], yb = h - B[1], bottom = Math.max(ya, yb), top = Math.min(ya, yb), banner = g.template === "banner";
  g.accent = [[0, ya], [w, yb], [w, 0], [0, 0]];
  g.edge = { line: [0, ya, w, yb], nx: 0, ny: 1 };
  g.titleTop = bottom + 56;
  const tagH = g.tag.fs * 1.34;
  if (!banner && top > 300) {   // room for the channel name on the band, under the brand row
    g.cat = { ...g.cat, y: top - 64, onAccent: true, inline: true };
    g.tag.y = h - 76 - tagH;
    g.title = { ...g.title, y: g.titleTop, h: Math.max(120, (h - g.titleTop - tagH - 150) * (a.th != null ? clamp(a.th, ...LAYOUT_LIMITS.th) : 1)) };
  } else {                      // a shallow band: the channel name goes to the foot of the field
    g.cat = { ...g.cat, y: h - 78, onAccent: false, inline: true };
    g.tag.y = h - 78 - g.cat.fs - tagH - 36;
    g.title = { ...g.title, y: g.titleTop, h: Math.max(120, (g.tag.y - g.titleTop - 50) * (a.th != null ? clamp(a.th, ...LAYOUT_LIMITS.th) : 1)) };
  }
  g.art.y = banner ? bottom + 10 : h - g.art.y;
  g.toneFrom = 0;
  return g;
}

/** The `size` and `slant` an adjusted layout `G` currently has (see adjustLayout), read back from its geometry. */
export function layoutValues(G, w, h) {
  const [A, B] = G.accent;
  if (G.template === "split") {
    const a = G.flipped ? w - A[0] : A[0], b = G.flipped ? w - B[0] : B[0];
    return { size: (w - (a + b) / 2) / w, slant: (a - b) / w };
  }
  const a = G.flipped ? h - A[1] : A[1], b = G.flipped ? h - B[1] : B[1];
  return { size: (h - (a + b) / 2) / h, slant: (a - b) / h };
}
/**
 * The adjustment that results from dragging a layout handle to the virtual point (x, y).
 *   "a" / "b"  an end of the dividing edge (changes its lean)     "m"  its middle (moves it)
 *   "tw" / "th"  the right / bottom side of the title's box, `box` being that box as drawn
 */
export function dragLayout(G, w, h, adj, handle, x, y, box) {
  const lim = (k, v) => clamp(v, ...LAYOUT_LIMITS[k]), out = { ...adj };
  if (handle === "tw" || handle === "th") {
    const k = handle, now = adj[k] ?? 1, have = k === "tw" ? box.w : box.h, want = k === "tw" ? x - box.x : y - box.y;
    out[k] = lim(k, (now * want) / Math.max(1, have));
    return out;
  }
  const split = G.template === "split", span = split ? w : h, v = layoutValues(G, w, h);
  const at = split ? (G.flipped ? w - x : x) : G.flipped ? h - y : y;          // the pointer, in the unflipped template
  let a = span * (1 - v.size) + (v.slant * span) / 2, b = a - v.slant * span;   // the two ends of the edge there
  if (handle === "a") a = at; else if (handle === "b") b = at; else { const d = at - (a + b) / 2; a += d; b += d; }
  out.size = lim("size", (span - (a + b) / 2) / span); out.slant = lim("slant", (a - b) / span);
  return out;
}

/** The narrowest any app's feed shows a cover of w × h, in CSS pixels, whichever platforms and video it is for; null when no platform wants that ratio or reads it in its feed. */
export function feedOf(w, h) {
  let min = 0;
  for (const orient of ["h", "v"]) for (const red of RED_RATIOS) for (const r of wanted({ platforms: PLATFORM_IDS, orient, red })) {
    if (isRatio(w, h, r.ratio)) for (const u of r.uses) if (u.feed && (!min || u.feed < min)) min = u.feed;
  }
  return min || null;
}
/** Whether some app lays its badges over the foot of a cover of w × h (see the zones in platforms.js). */
export function badged(w, h) {
  for (const orient of ["h", "v"]) for (const r of wanted({ platforms: PLATFORM_IDS, orient, red: RED_RATIOS[0] })) {
    if (isRatio(w, h, r.ratio) && r.uses.some((u) => u.zones && u.zones.length)) return true;
  }
  return false;
}
/** How far down a cover of w × h words may go, in its units: above the apps' badges on a landscape cover, else above the bottom 14% (WORDS_FOOT), where the apps' counts lie. */
export const wordsFoot = (w, h) => (badged(w, h) ? FOOT - 0.015 : WORDS_FOOT) * h;
/** Half the side of the box a channel graphic is drawn in at scale 1 (see drawAsset in assets.js). */
export const ART_HALF = 300;
/** How slim the colour block along the foot may get when there is no channel name on it, as a share of the canvas height. */
export const BAND_MIN = 0.16;
/** How wide the colour panel of "split" is when there is no graphic on it, as a share of the canvas width: on a portrait cover, and on a 16:9 one. */
export const SIDE_BARE = [0.13, 0.25];
/**
 * The subtitle under the title (see subtitleFit in title.js): its type size `share` of the title's, kept
 * between `min` and `max` of the canvas's shorter side but never above `most` of the title's as it is set
 * in the end; the gap above it, in its own sizes.
 */
export const SUB = { share: 0.4, min: 0.04, max: 0.068, gap: 0.3, most: 0.75 };   // most: never more than this share of the title as set
/** The type size the title wants on a cover of w × h for its words to read in the narrowest feed showing it (A1), in units; 0 when no feed shows it. */
export function titleFloor(w, h) { const feed = feedOf(w, h); return feed ? LIMITS.font.ok * 1.04 * (w / feed) : 0; }
/** The subtitle's type size under a title set at `titleFs`, on a canvas of w × h. */
export const subtitleSize = (titleFs, w, h) => { const m = Math.min(w, h); return Math.min(m * SUB.max, Math.max(m * SUB.min, titleFs * SUB.share)); };
/**
 * A layout held to the cover standards (docs/cover-check.zh-CN.md), whatever the look's template:
 * a new object of the same shape. `adj` is what the user changed about the template (see adjustLayout):
 * a colour block they moved or tilted stays where they put it.
 *   D1  On a cover the apps lay badges over (16:9, 4:3; badged()) nothing with words in it, nor the
 *       graphic, reaches down to them (FOOT, platforms.js): the channel name keeps its sub-name beside it
 *       and moves up, the colour block it stands on growing to hold it when too shallow; on any cover
 *       they stay a little off the bottom edge.
 *   A1  The title's box holds two lines at the type size the narrowest feed showing this ratio needs
 *       (LIMITS.font), the colour block giving way while it still holds the channel name.
 *   C1  On "stack", the block along the foot, the graphic, the cover's picture until a photo comes, takes at least LIMITS.picture
 *       of the canvas (a little more: a graphic does not fill its box); the title's box gives way to it,
 *       narrower on a landscape cover, shorter on the others, and so does the channel name.
 * And the tag stays clear of the channel name below it, the title of the tag (when there is one: `tag` in
 * `parts`), and the title's box above the words' foot (wordsFoot).
 * `parts` says which of the parts that take room the cover has (Cover → Layout parts): `catname`, `graphic`
 * (false: left out, or a channel with no graphic). The room of one left out goes to the others: without a
 * channel name the block along the foot slims down (to BAND_MIN, the tag on its edge still above the foot),
 * or the tag drops to the name's place at the foot of the column; without a graphic the title keeps its
 * whole box, and the panel of "split" narrows to a band down the side (SIDE_BARE), the title's column
 * taking the room. `subtitle`: the cover has a subtitle, which takes a line of the title's box (see
 * subtitleFit in title.js): A1 asks room for it too.
 */
export function meetStandards(G, w, h, adj = {}, parts = {}) {
  const g = { ...G, accent: G.accent.map((p) => [...p]), edge: { ...G.edge, line: [...G.edge.line] }, title: { ...G.title }, tag: { ...G.tag }, cat: { ...G.cat }, art: { ...G.art } };
  const badges = badged(w, h), wide = w / h > 1.25, onBlock = g.template !== "split" && !g.flipped;   // the colour block along the foot, the channel name on it
  const own = adj.size == null && adj.slant == null;   // the block where the template puts it, free to move
  const foot = badges ? (FOOT - 0.015) * h : h * 0.97, words = wordsFoot(w, h);   // where the graphic may reach down to; and the words
  const named = parts.catname !== false, pictured = parts.graphic !== false;
  // the title's box tall enough for two lines that read in the feed (A1), and the subtitle under them
  const fsA = titleFloor(w, h), need = fsA ? 2 * 1.16 * fsA + (parts.subtitle ? subtitleSize(fsA, w, h) * (1.16 + SUB.gap) : 0) : 0;
  let grown = 0;   // how much taller the title's box got from the block slimming down (see below)
  const catTop = () => g.cat.y - g.cat.fs * 0.95, catFoot = () => g.cat.y + (g.cat.inline ? g.cat.fs * 0.17 : 80), R = () => ART_HALF * g.art.s, tagH = g.tag.fs * 1.34;
  // the channel name above the words' foot, on a block that reaches up far enough to hold it
  if (named && catFoot() > words) { g.cat.inline = true; if (catFoot() > words) g.cat.y = words - g.cat.fs * 0.17; }
  if (onBlock && own) {
    const [x0, y0, x1, y1] = g.edge.line, edgeAt = (x) => y0 + ((y1 - y0) * (x - x0)) / (x1 - x0 || 1);
    // the block moved down by d (up, d < 0), and what stands on it or above it with it
    const shift = (d) => { g.accent[0][1] += d; g.accent[1][1] += d; g.edge.line[1] += d; g.edge.line[3] += d; g.toneFrom += d; g.tag.y += d; g.art.y += d; };
    if (named) {
      const d = Math.max(edgeAt(g.cat.x), edgeAt(g.cat.x + Math.min(g.cat.maxW, w / 2))) - (catTop() - g.cat.fs * 0.3);
      if (d > 0) { shift(-d); g.title.h = Math.max(120, g.title.h - d); }   // the block grows upward
      // the title's box tall enough for two lines that read in the feed: the block lowered as far as it can
      const room = Math.min(...[g.cat.x, g.cat.x + Math.min(g.cat.maxW, w / 2)].map((x) => catTop() - g.cat.fs * 0.3 - edgeAt(x)));
      const down = Math.min(need - g.title.h, room);
      if (down > 0) { shift(down); g.title.h += down; }
    } else {   // nothing on the block but the tag at its edge (if any): it slims down, the title's box taking the room
      const down = Math.min(parts.tag === false ? Infinity : words - (g.tag.y + tagH), h * (1 - BAND_MIN) - Math.max(y0, y1));
      if (down > 0) { shift(down); g.title.h += down; grown = down; }
    }
  }
  if (g.template === "split" && !g.flipped && own && !pictured) {   // nothing on the panel: it narrows, the title's column widens
    const [A, B] = g.accent, side = lerp(SIDE_BARE[0], SIDE_BARE[1], clamp((w / h - 0.75) / (16 / 9 - 0.75))), dx = w * (1 - side) - (A[0] + B[0]) / 2;
    if (dx > 0) { A[0] += dx; B[0] += dx; g.edge.line[0] += dx; g.edge.line[2] += dx; g.title.w += dx; g.cat.maxW += dx; g.art.x += dx; }
  }
  // without the channel name at the foot of the column under the tag, the tag takes its place, the title's box the room
  if (!named && !onBlock && g.tag.y < g.cat.y) {
    const drop = Math.min(words, catFoot()) - g.tag.fs * 0.12 - (g.tag.y + tagH), clear = g.title.y + g.title.h <= g.tag.y;   // a little off it: some looks' tags reach below their box
    if (drop > 0) { g.tag.y += drop; if (clear) g.title.h += drop; }
  }
  // the tag above the words' foot and clear of the channel name (they share the left margin), the title clear of the tag
  if (g.tag.y + tagH > words) g.tag.y = words - tagH;
  if (named && g.tag.y < g.cat.y && g.tag.y + tagH > catTop() - 16) g.tag.y = catTop() - 16 - tagH;
  if (parts.tag !== false && g.tag.y > g.title.y && g.title.y + g.title.h > g.tag.y - 30) g.title.h = Math.max(120, g.tag.y - 30 - g.title.y);
  if (g.title.y + g.title.h > words) g.title.h = Math.max(120, words - g.title.y);   // and the title's words above their foot, tag or none
  if (!pictured) return g;
  // the graphic: big enough to look at, above the foot, inside the canvas
  if (g.template === "stack" && onBlock) g.art.s = Math.max(g.art.s, Math.sqrt((LIMITS.picture + 0.015) * w * h) / (2 * ART_HALF));
  if (g.art.y + R() > foot) g.art.y = foot - R();
  if (g.art.y - R() < h * 0.02 && 2 * R() < foot - h * 0.02) g.art.y = h * 0.02 + R();
  if (2 * R() < w * 0.96) g.art.x = clamp(g.art.x, R() + w * 0.02, w - R() - w * 0.02);
  // on a landscape cover it first moves over to the right to leave the title its room; then what it
  // would still cover gives way: the title's box, the channel name
  const box = () => ({ x0: g.art.x - R(), y0: g.art.y - R(), x1: g.art.x + R(), y1: g.art.y + R() });
  const meets = (x0, y0, x1, y1, a = box()) => x0 < a.x1 && x1 > a.x0 && y0 < a.y1 && y1 > a.y0;
  const overTitle = () => meets(g.title.x, g.title.y, g.title.x + g.title.w, g.title.y + g.title.h);
  if (wide && overTitle()) g.art.x = Math.max(g.art.x, w * 0.96 - R());
  const art = box();
  if (overTitle() && grown > 0) g.title.h = Math.max(g.title.h - grown, Math.min(g.title.h, need), art.y0 - 40 - g.title.y);   // the room the block gave goes back first (but what A1 asks), before the title narrows
  if (overTitle()) {
    if (wide && art.x0 - 40 - g.title.x >= w * 0.4) g.title.w = art.x0 - 40 - g.title.x;
    else if (art.y0 - 40 - g.title.y >= 120) g.title.h = art.y0 - 40 - g.title.y;
  }
  if (named && meets(g.cat.x, catTop(), g.cat.x + g.cat.maxW, catFoot())) g.cat.maxW = Math.max(120, Math.min(g.cat.maxW, art.x0 - 30 - g.cat.x));
  return g;
}

/** Uniform scale that maps the virtual canvas onto `pixelWidth` real pixels. */
export const pixelScale = (pixelWidth, virtualWidth) => pixelWidth / virtualWidth;
