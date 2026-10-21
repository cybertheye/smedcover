// The ransom-note lettering (剪报字): each letter as if cut from another page — a font, a scrap of paper,
// an ink, an angle and a size of its own — yet standing where the line's own font sets it. So the size a
// line is fitted at, its bends, its highlighted words and the type size the cover standards read are those
// of any other lettering; only how each letter is drawn differs. Every letter is drawn into its cell (its
// share of the piece setLine set, in title.js), as large as the cell and the line's letters allow.
//
// How a letter is dressed follows from the layer's seed (`o.fxSeed`: its id and the number Reshuffle
// draws), the line's (`o.seed`), the letter and how many times it came before in the line: the same at
// every size, and a letter typed or deleted changes the letters before it not at all (but for the line's
// hero, should the new one outdraw it), and mostly only the next letter and the same letters after it
// (neighbours never share a font, nor a paper). Faces are the bundled fonts and the system fonts that are
// installed (useRansomFaces, from app.js); a face without the letter gives way to the next.
import { INK } from "./style.js";
import { luminance, contrastRatio } from "./check.js";

/**
 * The faces letters may be cut from, by script, each [family, CSS weight, how often (1), italic]: the
 * bundled fonts first, then those of macOS, Windows and Linux, and free fonts often installed. Only those
 * the app finds installed are used (useRansomFaces).
 */
export const RANSOM_FACES = {
  latin: [
    ["Bebas Neue", 400, 1.5], ["JetBrains Mono", 800], ["Noto Sans SC", 900], ["Noto Sans SC", 300, 0.6],
    ["Georgia", 700], ["Didot", 700], ["Bodoni 72", 700], ["Impact", 400], ["Arial Black", 900], ["Futura", 700],
    ["Avenir Next Condensed", 800], ["Rockwell", 700], ["American Typewriter", 700], ["Courier New", 700],
    ["Times New Roman", 700, 1, true], ["Baskerville", 700, 0.7, true], ["Copperplate", 700, 0.7], ["Chalkduster", 400, 0.5],
    ["Marker Felt", 700, 0.6], ["Phosphate", 400, 0.7], ["Gill Sans", 700], ["Cochin", 700, 0.7], ["Optima", 800, 0.7],
    ["Hoefler Text", 900, 0.7], ["Herculanum", 400, 0.4], ["Silom", 400, 0.6], ["Trebuchet MS", 700, 0.6], ["Verdana", 700, 0.6],
    ["Segoe UI", 900], ["Cambria", 700], ["Bahnschrift", 700], ["Franklin Gothic Medium", 400], ["Stencil", 400, 0.7],
    ["Cooper Black", 400, 0.7], ["Showcard Gothic", 400, 0.6], ["Bauhaus 93", 400, 0.5], ["Bodoni MT", 700], ["Rockwell Extra Bold", 800],
    ["DejaVu Serif", 700], ["DejaVu Sans Mono", 700], ["Liberation Serif", 700], ["Ubuntu", 700], ["Noto Serif", 900],
  ],
  cjk: [
    ["Noto Sans SC", 900, 1.5], ["Noto Sans SC", 300, 0.6],
    ["PingFang SC", 600], ["Songti SC", 900], ["Songti SC", 400, 0.7], ["Hiragino Sans GB", 600], ["Heiti SC", 500, 0.6],
    ["Kaiti SC", 700], ["Yuanti SC", 700], ["Libian SC", 400], ["Hannotate SC", 700], ["Weibei SC", 700], ["HanziPen SC", 700],
    ["Wawati SC", 400, 0.7], ["Baoli SC", 400, 0.7], ["Lantinghei SC", 800], ["Xingkai SC", 700, 0.5],
    ["Microsoft YaHei", 700], ["SimSun", 400, 0.7], ["SimHei", 400], ["KaiTi", 400], ["FangSong", 400, 0.6], ["DengXian", 700],
    ["STXingkai", 400, 0.5], ["STCaiyun", 400, 0.5], ["STHupo", 400, 0.7], ["STLiti", 400, 0.7], ["STXinwei", 400], ["YouYuan", 400], ["LiSu", 400], ["FZShuTi", 400, 0.7], ["FZYaoTi", 400],
    ["Noto Serif CJK SC", 900], ["Source Han Serif SC", 900], ["WenQuanYi Zen Hei", 400], ["AR PL UKai CN", 400],
    ["LXGW WenKai", 400], ["Smiley Sans", 400], ["ZCOOL KuaiLe", 400, 0.7], ["ZCOOL QingKe HuangYou", 400], ["Ma Shan Zheng", 400, 0.5], ["ZCOOL XiaoWei", 400],
  ],
};

// the letters it dresses: Latin, Greek, Cyrillic, Chinese, Japanese and Korean, and digits; a stretch of
// another script (joined, or written right to left) is set as the line sets it, whole
const LETTER = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Nd}]/u;
const OTHER = /(?![\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}])\p{L}/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const cased = (ch) => ch.toUpperCase() !== ch.toLowerCase() && [...ch.toUpperCase()].length === 1 && [...ch.toLowerCase()].length === 1;
/** A number from a string (FNV-1a). */
export function hash(s) { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0; return h; }
/** Random numbers in [0, 1) from seed n (mulberry32). */
export function seeded(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Index into `list` drawn by weight (`often(item)`), with R. */
const draw = (list, often, R) => { const total = list.reduce((s, x) => s + often(x), 0); let r = R() * total; for (let i = 0; i < list.length; i++) { r -= often(list[i]); if (r < 0) return i; } return list.length - 1; };

const rgbOf = (css) => { const h = /^#([0-9a-f]{6})$/i.exec(css || ""); if (h) return [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)); const m = String(css).match(/[\d.]+/g); return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null; };
const hex = (c) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const lum = ([r, g, b]) => luminance(r, g, b);
/** WCAG contrast of two colours [r, g, b]. */
export const contrast = (a, b) => contrastRatio(lum(a), lum(b));
const BLACK = "#151515", WHITE = "#ffffff", RED = "#d23a2b";
/**
 * The scraps of paper for a layer: the channel colour (`o.C`), black, white, newsprint and kraft, the
 * highlighted words' colour (`o.hiCss`) and a yellow — {css, rgb, often, light}. A neutral is left out
 * when the channel colour is it; a colour, when one near it is there already.
 */
export function papersFor(o) {
  const out = [];
  const add = (css, often, apart) => { const rgb = rgbOf(css); if (!rgb || out.some((p) => Math.hypot(p.rgb[0] - rgb[0], p.rgb[1] - rgb[1], p.rgb[2] - rgb[2]) < apart)) return; out.push({ css: hex(rgb), rgb, often, light: lum(rgb) > 0.4 }); };
  add(o.C ? hex(o.C) : null, 2.5, 0);
  add(BLACK, 3, 30); add(WHITE, 2, 30); add("#efe9dc", 2, 30); add("#d7bf93", 1.5, 30); add(o.hiCss, 1.2, 80); add("#f3d23b", 1, 80);
  return out;
}
/** The ink for letters on paper p: black, white, the channel colour or a red, among those that read on it (4.5 : 1), black and white likeliest. */
function inkOn(p, C, R) {
  const all = [[BLACK, 3], [WHITE, 3], [C ? hex(C) : null, 2], [RED, 1]].filter(([css]) => css).map(([css, often]) => ({ css, rgb: rgbOf(css), often }));
  const reads = all.filter((k) => contrast(k.rgb, p.rgb) >= 4.5);
  if (!reads.length) return all.reduce((a, b) => (contrast(b.rgb, p.rgb) > contrast(a.rgb, p.rgb) ? b : a)).css;
  return reads[draw(reads, (k) => k.often, R)].css;
}

/**
 * How each letter of a line is dressed (pure; ransom draws it). `cells`: [{ch, hi, whole}] in order (whole:
 * a piece in another script, set as it is). `pools`: {latin, cjk}, faces {family, weight, often, italic}.
 * `has(face, ch)`: whether a face has a letter. Returns, for each cell, null for what is not a letter or a
 * digit it dresses (spaces, marks, emoji, other scripts: drawn as the line sets them), else { face (null: the line's own), ch (its case as drawn), kind ("tile": on a scrap of paper;
 * "bare": in the layer's own colours, without one; "cut": hollow, in paper colour with an ink rim), paper,
 * ink (CSS), turn (degrees), lift (in type sizes), size (times the line's letters), hero, corners (eight
 * numbers in [-1, 1], how the scrap's corners are off square) }. One letter of a line of three or more is
 * the hero, larger, on the channel colour (unless the letter before is) — in the highlighted words when
 * there are any. A letter only one family has may stand next to another in it. `amt` (the
 * layer's strength, 0 to 2): how far letters turn and shift and how often their case is changed.
 */
export function ransomPlan(cells, pools, { salt = "", line = 0, amt = 1, papers = papersFor({}), C = null, has = () => true } = {}) {
  // each letter's own name: the letter and how many times it came before
  const seen = new Map(), names = cells.map((c) => { const n = (seen.get(c.ch) || 0) + 1; seen.set(c.ch, n); return `${salt}|${line}|${c.ch}|${n}`; });
  const dressed = (c) => !c.whole && LETTER.test(c.ch), letters = cells.map((c, i) => (dressed(c) ? i : -1)).filter((i) => i >= 0);
  const marked = letters.filter((i) => cells[i].hi), from = marked.length ? marked : letters;
  // the hero: the letter whose name draws highest, so another typed moves it only when it draws higher
  const hero = letters.length >= 3 ? from.reduce((a, b) => (hash(names[b] + "|hero") > hash(names[a] + "|hero") ? b : a)) : -1;
  const out = [];
  let prev = { family: null, paper: -1 };
  const chosen = papers.findIndex((p) => C && Math.hypot(p.rgb[0] - C[0], p.rgb[1] - C[1], p.rgb[2] - C[2]) < 40);
  cells.forEach((c, i) => {
    if (!dressed(c)) { out.push(null); return; }
    const R = seeded(hash(names[i])), isHero = i === hero, cjk = CJK.test(c.ch);
    // the face: by how often each is wanted; drawn again, from the other families, when it is the one before's
    const pool = (pools[cjk ? "cjk" : "latin"] || []).filter((f) => has(f, c.ch));
    let face = pool.length ? pool[draw(pool, (f) => f.often, R)] : null;
    if (face && face.family === prev.family) { const others = pool.filter((f) => f.family !== prev.family); if (others.length) face = others[draw(others, (f) => f.often, R)]; }
    // the kind and the paper: never the one before; the hero on the channel colour
    const r = R(), kind = isHero ? "tile" : r < 0.7 ? "tile" : r < 0.9 ? "bare" : "cut";
    let paper = -1;
    if (kind !== "bare") {
      const can = papers.map((_, k) => k).filter((k) => kind === "tile" || papers[k].light);
      paper = isHero && chosen >= 0 && chosen !== prev.paper ? chosen : can[draw(can, (k) => papers[k].often * (c.hi && k === chosen ? 2 : 1), R)];
      if (paper === prev.paper && can.length > 1) paper = can[(can.indexOf(paper) + 1) % can.length];
    }
    const ink = kind === "tile" ? inkOn(papers[paper], C, R) : null;
    const turn = (R() - 0.5) * 2 * (isHero ? 5 : 9) * amt, lift = (R() - 0.5) * 2 * 0.06 * amt;
    const size = isHero ? 1.2 : 0.88 + R() * 0.14, corners = Array.from({ length: 8 }, () => R() * 2 - 1);
    const flip = !cjk && cased(c.ch) && R() < Math.min(0.5, 0.35 * amt);
    const ch = flip ? (c.ch === c.ch.toUpperCase() ? c.ch.toLowerCase() : c.ch.toUpperCase()) : c.ch;
    out.push({ face, ch, kind, paper, ink, turn, lift, size, hero: isHero, corners });
    prev = { family: face ? face.family : null, paper };
  });
  return out;
}

// ---------- which faces are here
let POOLS = { latin: [], cjk: [] }, PENDING = new Set(), EPOCH = 0;
/**
 * The faces that are here: those of RANSOM_FACES whose family `here(family)` is true. `pending`: families
 * not yet to be had on a canvas (system fonts loaded on demand, see ensureFont in app.js), assumed to have
 * every letter until they arrive (ransomArrived), so a letter's face does not wait on them.
 */
export function useRansomFaces(here, pending = []) {
  const faces = (list) => list.filter(([family]) => here(family)).map(([family, weight, often = 1, italic = false]) => ({ family, weight, often, italic }));
  POOLS = { latin: faces(RANSOM_FACES.latin), cjk: faces(RANSOM_FACES.cjk) };
  PENDING = new Set(pending); forget();
}
/** The families still to be loaded before every letter can be drawn in its face. */
export const ransomPending = () => [...PENDING];
/** Family `family` can be drawn with now (or never will be). Whether it was still awaited. */
export function ransomArrived(family) { if (!PENDING.delete(family)) return false; forget(); return true; }
/** Changes whenever a face arrives or the faces change, so what was drawn with a stand-in is drawn again (see bentLine). */
export const ransomEpoch = () => EPOCH;
/** The faces in use, by script (for the app's report). */
export const ransomPools = () => ({ latin: POOLS.latin.map((f) => f.family), cjk: POOLS.cjk.map((f) => f.family) });

const HAS = new Map(), METRICS = new Map(), PLANS = new Map();   // the plans of the lines drawn last, by what decides them
/** Forgets what was measured and planned (fonts arrived), and tells bentLine. */
function forget() { HAS.clear(); METRICS.clear(); PLANS.clear(); EPOCH++; }
if (typeof document !== "undefined" && document.fonts && document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", forget);
let SEEN = 0;
/** Fonts added to the page (a face loaded and then added sends no "loadingdone") change what is measured too. */
function fontsNow() { const n = typeof document !== "undefined" && document.fonts ? document.fonts.size : 0; if (n !== SEEN) { SEEN = n; forget(); } }
let probeCtx = null;
const probe = () => (typeof document === "undefined" ? null : (probeCtx = probeCtx || document.createElement("canvas").getContext("2d")));
const q = (family) => `"${family.replace(/["\\]/g, "")}"`;
const faceFont = (f, px, rest = "") => `${f.italic ? "italic " : ""}${f.weight} ${px}px ${q(f.family)}${rest ? ", " + rest : ""}`;
/**
 * Whether face f has letter ch: set in it, the letter measures otherwise than in the reference font alone
 * (Noto Sans SC for CJK, JetBrains Mono for the rest: bundled, so always here). The reference fonts have
 * their own letters; with no canvas (the tests) every face has every letter.
 */
function has(f, ch) {
  const ref = CJK.test(ch) ? "Noto Sans SC" : "JetBrains Mono", x = probe();
  if (!x || f.family === ref || PENDING.has(f.family)) return true;
  const key = `${f.family}|${f.weight}|${f.italic}|${ch}`;
  if (HAS.has(key)) return HAS.get(key);
  const sig = (font) => { x.font = font; const m = x.measureText(ch); return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent].map((v) => Math.round((v || 0) * 100)).join(); };
  const yes = sig(faceFont(f, 40, q(ref))) !== sig(faceFont({ ...f, family: ref }, 40));
  if (HAS.size > 20000) HAS.clear();
  HAS.set(key, yes);
  return yes;
}
/** A letter's ink box in `font` (at size 100): {w, l, r, a, d}; from the advance alone where the canvas gives no box. */
function inkOf(ctx, font, ch) {
  const key = font + "|" + ch;
  if (METRICS.has(key)) return METRICS.get(key);
  const was = ctx.font; ctx.font = font;
  const m = ctx.measureText(ch); ctx.font = was;
  const w = m.width || 60, out = m.actualBoundingBoxAscent != null ? { w, l: m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight, a: m.actualBoundingBoxAscent, d: m.actualBoundingBoxDescent } : { w, l: 0, r: w, a: 72, d: 0 };
  if (!(out.l + out.r > 0 && out.a + out.d > 0)) Object.assign(out, { l: 0, r: w, a: 72, d: 0 });
  if (METRICS.size > 4000) METRICS.clear();
  METRICS.set(key, out);
  return out;
}
/** Grapheme clusters of a string. */
const graphemes = typeof Intl !== "undefined" && Intl.Segmenter ? ((seg) => (t) => Array.from(seg.segment(t), (g) => g.segment))(new Intl.Segmenter(undefined, { granularity: "grapheme" })) : (t) => [...t];

/**
 * Paints the current line in ransom-note letters (see the top of the file; `pass` and `o` as paintRuns'):
 * every scrap of paper first, then every letter, so no scrap hides a letter beside it; the hero last of each.
 */
export function ransom(ctx, pass, o) {
  fontsNow();
  const pieces = [];
  pass((a, x) => pieces.push([a, x]));
  const fs = o.fs, base = ctx.font, families = base.replace(/^.*?\d*\.?\d+px\s*(\/\s*\S+\s*)?/, "") || "sans-serif";
  const at100 = (s) => base.replace(/(\d*\.?\d+)px/, `${100 * s}px`);
  // the cells: each letter's share of its piece, as the line's font sets it
  const cells = [];
  for (const [a, x] of pieces) {
    // its letters one by one; a stretch of another script, from its first letter to its last, as one
    const g = graphemes(a.t), other = g.map((ch) => OTHER.test(ch)), parts = [];
    for (let i = 0; i < g.length; i++) {
      let j = i;
      if (other[i]) for (let k = i + 1; k < g.length && !LETTER.test(g[k]); k++) if (other[k]) j = k;   // through spaces and marks, to its last letter before one it dresses
      parts.push({ ch: g.slice(i, j + 1).join(""), whole: other[i] }); i = j;
    }
    const s = a.s ?? 1, ws = parts.map((p) => ctx.measureText(p.ch).width * s), sum = ws.reduce((p, w) => p + w, 0), k = a.w && sum > 0 ? a.w / sum : 1;
    let at = x;
    parts.forEach((p, i) => { cells.push({ ch: p.ch, hi: a.hi, x: at, w: ws[i] * k, s, dy: a.dy || 0, whole: p.whole }); at += ws[i] * k; });
  }
  if (!cells.length) return;
  // the line's letters, as its own font sets them: how tall, and where their middle is
  const big = inkOf(ctx, at100(1), "H"), han = inkOf(ctx, at100(1), "国"), u = fs / 100;
  const papers = papersFor(o), C = o.C || null, amt = o.amt ?? 1;
  const key = JSON.stringify([o.fxSeed ?? "", o.seed ?? 0, amt, C, o.hiCss, cells.map((c) => [c.ch, !!c.hi, !!c.whole])]);
  let plan = PLANS.get(key);
  if (!plan) {
    plan = ransomPlan(cells, POOLS, { salt: o.fxSeed ?? "", line: o.seed ?? 0, amt, papers, C, has });
    if (PLANS.size > 64) PLANS.clear();
    PLANS.set(key, plan);
  }
  const order = plan.map((_, i) => i).sort((i, j) => (plan[i] && plan[i].hero ? 1 : 0) - (plan[j] && plan[j].hero ? 1 : 0));   // the hero last, over its neighbours
  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  const d = o.d || 0, stroke = o.strokeAmt || 0;
  /** A letter in the layer's own colours: its shadow, its keyline, its fill (the house lettering, one letter). */
  const lettered = (ch, x, y, hi) => {
    if (d > 0) { ctx.fillStyle = ctx.strokeStyle = hi ? o.hiShadowCss : o.shadowCss; ctx.lineWidth = fs * 0.04; ctx.strokeText(ch, x + d, y + d); ctx.fillText(ch, x + d, y + d); }
    if (stroke > 0) { ctx.strokeStyle = o.inkCss; ctx.lineWidth = fs * 0.075 * stroke; ctx.strokeText(ch, x, y); }
    ctx.fillStyle = ctx.strokeStyle = hi ? o.hiCss : o.fillCss; ctx.lineWidth = fs * 0.018; ctx.strokeText(ch, x, y); ctx.fillText(ch, x, y);
  };
  // where and how large each letter stands: as tall as the line's letters times its size, no wider than its
  // cell (1.04 times, the hero 1.12), its middle on the line's middle
  const geo = cells.map((c, i) => {
    const p = plan[i];
    if (!p) return null;
    const ref = CJK.test(c.ch) ? han : big, tall = (ref.a + ref.d) * u * c.s, mid = -(ref.a - ref.d) / 2 * u * c.s + c.dy;
    const m = inkOf(ctx, p.face ? faceFont(p.face, 100, families) : at100(1), p.ch);
    const k = Math.min((tall * p.size) / (m.a + m.d), (c.w * (p.hero ? 1.12 : 1.04)) / (m.l + m.r));
    return { x: c.x + c.w / 2, y: mid + p.lift * fs, font: p.face ? faceFont(p.face, 100 * k, families) : at100(k), w: (m.l + m.r) * k, h: (m.a + m.d) * k, gx: -(m.r - m.l) / 2 * k, gy: (m.a - m.d) / 2 * k };
  });
  const placed = (g, p, draw) => { ctx.save(); ctx.translate(g.x, g.y); ctx.rotate((p.turn * Math.PI) / 180); ctx.font = g.font; draw(); ctx.restore(); };
  // the scraps the letters were cut from: a little larger than the letter, their corners not quite square, a shadow under each
  for (const i of order) {
    const c = cells[i], p = plan[i], g = geo[i];
    if (!p || p.kind !== "tile") continue;
    placed(g, p, () => {
      const px = fs * 0.07 * c.s, py = fs * 0.055 * c.s, j = (n) => p.corners[n] * px * 0.45, W = g.w / 2 + px, H = g.h / 2 + py;
      const quad = [[-W + j(0), -H + j(1)], [W + j(2), -H + j(3)], [W + j(4), H + j(5)], [-W + j(6), H + j(7)]];
      const path = (dx) => { ctx.beginPath(); quad.forEach(([x, y], n) => (n ? ctx.lineTo(x + dx, y + dx) : ctx.moveTo(x + dx, y + dx))); ctx.closePath(); };
      if (d > 0) { path(d * 0.6); ctx.fillStyle = "rgba(7,7,12,0.45)"; ctx.fill(); }
      path(0); ctx.fillStyle = papers[p.paper].css; ctx.fill();
    });
  }
  // the letters
  for (const i of order) {
    const c = cells[i], p = plan[i], g = geo[i];
    if (!p) {   // a space, a mark, an emoji, a piece in another script: as the line sets it
      if (/^\s+$/.test(c.ch)) continue;
      ctx.save(); ctx.font = at100(c.s * u); lettered(c.ch, c.x, c.dy, c.hi); ctx.restore();
      continue;
    }
    placed(g, p, () => {
      if (p.kind === "tile") { ctx.fillStyle = p.ink; ctx.fillText(p.ch, g.gx, g.gy); }
      else if (p.kind === "cut") {   // hollow: paper inside an ink rim
        if (d > 0) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.07; ctx.strokeText(p.ch, g.gx + d * 0.6, g.gy + d * 0.6); ctx.fillText(p.ch, g.gx + d * 0.6, g.gy + d * 0.6); }
        ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.07; ctx.strokeText(p.ch, g.gx, g.gy);
        ctx.fillStyle = papers[p.paper].css; ctx.fillText(p.ch, g.gx, g.gy);
      } else lettered(p.ch, g.gx, g.gy, c.hi);
    });
  }
  ctx.restore();
}
