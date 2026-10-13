// Geometry of a cover, for any pixel size and any template. Pure functions, no DOM.
//
// Everything is laid out in a "virtual" canvas whose short side is 1080–1200 units whatever the
// real pixel size, so type and line weights keep their proportions from 900x383 up to 8K.

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

/** What the user may change about a template: all optional, all as fractions so one setting suits every size. */
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

/** Uniform scale that maps the virtual canvas onto `pixelWidth` real pixels. */
export const pixelScale = (pixelWidth, virtualWidth) => pixelWidth / virtualWidth;
