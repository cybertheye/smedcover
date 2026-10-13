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

/** Uniform scale that maps the virtual canvas onto `pixelWidth` real pixels. */
export const pixelScale = (pixelWidth, virtualWidth) => pixelWidth / virtualWidth;
