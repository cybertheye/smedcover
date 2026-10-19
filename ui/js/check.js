// The cover check: will the cover be read, seen and left uncovered on the platforms it is made for? Rule
// by rule, as docs/cover-check.zh-CN.md sets them out. Pure: the editor (app.js) paints each size and
// hands over what it found; it also turns the issues into words and fixes.
import { isRatio, wanted } from "./platforms.js";

/** Where each rule draws its lines. Those not from a standard are starting values, to be tuned on real covers. */
export const LIMITS = {
  font: { ok: 14, red: 10 },     // A1: the title's type size as a phone shows it in the feed, CSS px (phone text is rarely under 11–12 pt; a cover is only glanced at)
  line: 10, lines: 2,            // A2: per line (a CJK character counts 1, anything else ½), and lines
  contrast: { ok: 3, red: 2 },   // B1: WCAG 2.x 1.4.3, large text: at least 3:1
  picture: 0.12,                 // C1: the largest picture's share of the canvas
  covered: { some: 0.02, red: 0.15 },   // D1: the share of a part under what an app lays over the cover
};
const LH = 1.16;   // a headline's line height, in type sizes (title.js)

/** How long a line of a title reads: a CJK character (or full-width sign) 1, anything else ½. */
export const lineUnits = (s) => [...String(s).replace(/\*/g, "")].reduce((n, ch) => n + (/[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch) ? 1 : 0.5), 0);
/** The lines of a title as typed (a line per line, the asterisks gone). */
export const titleLines = (title) => String(title || "").replace(/\\n/g, "\n").split("\n").map((l) => l.replace(/\*/g, "").trim()).filter(Boolean);
/** The type size of a headline `n` lines high from its hit (half-height hh, in virtual px). */
export const typeSize = (hit, n) => (2 * hit.hh) / (Math.max(1, n) * LH);
/** The upright box round a hit (turned by r degrees): {x0, y0, x1, y1}. */
export function boxOf(hit) {
  const a = (hit.r || 0) * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const hw = c * hit.hw + s * hit.hh, hh = s * hit.hw + c * hit.hh;
  return { x0: hit.cx - hw, y0: hit.cy - hh, x1: hit.cx + hw, y1: hit.cy + hh };
}
/** The share of box a lying inside box b. */
export function overlap(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0), area = (a.x1 - a.x0) * (a.y1 - a.y0);
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0;
}
/** WCAG relative luminance of an sRGB colour (0–255 each). */
export function luminance(r, g, b) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** The WCAG contrast ratio of two luminances (1 to 21). */
export const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
/**
 * How well a title stands off what is behind it. `text` and `bg` are RGBA pixels of the same region: the
 * title painted alone, and what lies under it painted without it. The title's solid pixels fall into one
 * or two tones (a fill, and an outline or a plate); each tone is set against the background behind the
 * letters, its worst tenth rather than its average (a busy photo has dark and light), and the tone that
 * stands off best decides: a light fill lost on a light sky still reads by its dark outline. Returns the
 * contrast ratio, or null with no solid pixels.
 */
export function titleContrast(text, bg) {
  const lt = [], lb = [];
  for (let i = 0; i < text.length; i += 4) {
    if (text[i + 3] < 160) continue;
    lt.push(luminance(text[i], text[i + 1], text[i + 2])); lb.push(luminance(bg[i], bg[i + 1], bg[i + 2]));
  }
  if (lt.length < 12) return null;
  // two tones: the light and the dark half of the title's own pixels, around their mean
  const mean = lt.reduce((s, v) => s + v, 0) / lt.length, tones = [[], []];
  lt.forEach((v, i) => tones[v >= mean ? 0 : 1].push(i));
  let best = 0;
  for (const idx of tones) {
    if (idx.length < Math.max(6, lt.length * 0.15)) continue;
    const tone = idx.reduce((s, i) => s + lt[i], 0) / idx.length;
    const rs = idx.map((i) => contrastRatio(tone, lb[i])).sort((a, b) => a - b);
    best = Math.max(best, rs[Math.floor(rs.length * 0.1)]);
  }
  return best || null;
}
/**
 * The issues of a cover. o: {
 *   title: the cover's title as typed,
 *   sizes: the profile's sizes [{ key, w, h, vw, vh, on }],
 *   platforms, orient, red: what the user makes covers for (see wanted in platforms.js),
 *   seen: { [size key]: what that size painted: { title: { id, hit } | null, contrast: number | null,
 *     pictures: [{ id, hit }], unknown: true when a photo fills it with no cut-out (its subject cannot be
 *     measured), parts: [{ id, hit }] (the title, the user's words, cut-outs: what must not be covered) } }
 * }
 * Each issue: { rule, level: "red" | "yellow", ratio, size, platforms, layer, value, need, what }.
 */
export function checkCover(o) {
  const out = [], lines = titleLines(o.title);
  const longest = Math.max(0, ...lines.map(lineUnits));
  if (lines.length > LIMITS.lines || longest > LIMITS.line) out.push({ rule: "A2", level: "yellow", ratio: null, size: null, platforms: [], layer: "title", value: longest, need: LIMITS.line, what: lines.length });
  for (const { ratio, uses } of wanted(o)) {
    const platforms = [...new Set(uses.map((u) => u.platform))];
    const size = o.sizes.find((s) => s.on !== false && isRatio(s.w, s.h, ratio));
    if (!size) { out.push({ rule: "E1", level: "red", ratio, size: null, platforms, layer: null, value: 0, need: 0, what: uses[0].px }); continue; }
    const seen = o.seen[size.key];
    if (!seen) continue;
    const base = { ratio, size: size.key };
    // A1: the title's type as big as the smallest feed it shows in makes it
    const feeds = uses.filter((u) => u.feed), feed = feeds.length ? Math.min(...feeds.map((u) => u.feed)) : 0;
    if (seen.title && feed && lines.length) {
      const px = (typeSize(seen.title.hit, lines.length) * feed) / size.vw;
      if (px < LIMITS.font.ok) out.push({ ...base, rule: "A1", level: px < LIMITS.font.red ? "red" : "yellow", platforms: feeds.filter((u) => u.feed === feed).map((u) => u.platform), layer: seen.title.id, value: px, need: LIMITS.font.ok, what: feed });
    }
    // B1: the title against what is behind it
    if (seen.title && seen.contrast != null && seen.contrast < LIMITS.contrast.ok)
      out.push({ ...base, rule: "B1", level: seen.contrast < LIMITS.contrast.red ? "red" : "yellow", platforms, layer: seen.title.id, value: seen.contrast, need: LIMITS.contrast.ok, what: null });
    // C1: something to look at, big enough
    if (!seen.unknown && seen.pictures.length) {
      const area = (h) => (4 * h.hw * h.hh) / (size.vw * size.vh), top = seen.pictures.reduce((a, b) => (area(b.hit) > area(a.hit) ? b : a));
      if (area(top.hit) < LIMITS.picture) out.push({ ...base, rule: "C1", level: "yellow", platforms, layer: top.id, value: area(top.hit), need: LIMITS.picture, what: null });
    }
    // D1: nothing that matters under what the apps lay over the cover
    for (const u of uses) for (const z of u.zones || []) {
      const zone = { x0: z.x0 * size.vw, y0: z.y0 * size.vh, x1: z.x1 * size.vw, y1: z.y1 * size.vh };
      for (const p of seen.parts) {
        const share = overlap(boxOf(p.hit), zone);
        if (share <= LIMITS.covered.some) continue;
        const was = out.find((x) => x.rule === "D1" && x.size === size.key && x.layer === p.id && x.what === z.what);
        if (was) { if (!was.platforms.includes(u.platform)) was.platforms.push(u.platform); continue; }
        out.push({ ...base, rule: "D1", level: share > LIMITS.covered.red ? "red" : "yellow", platforms: [u.platform], layer: p.id, value: share, need: LIMITS.covered.some, what: z.what, zone });
      }
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "red" ? -1 : 1));
}
/** How far to move box b, the least way, to clear `zone` while staying inside a vw × vh canvas: {dx, dy}, or null. */
export function moveOut(b, zone, vw, vh, gap = 8) {
  const tries = [
    { dx: 0, dy: zone.y0 - gap - b.y1 }, { dx: 0, dy: zone.y1 + gap - b.y0 },
    { dx: zone.x0 - gap - b.x1, dy: 0 }, { dx: zone.x1 + gap - b.x0, dy: 0 },
  ].filter((m) => b.x0 + m.dx >= 0 && b.x1 + m.dx <= vw && b.y0 + m.dy >= 0 && b.y1 + m.dy <= vh);
  return tries.length ? tries.reduce((a, c) => (Math.hypot(c.dx, c.dy) < Math.hypot(a.dx, a.dy) ? c : a)) : null;
}
