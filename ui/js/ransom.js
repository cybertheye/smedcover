// The ransom-note lettering (剪报字): each letter as if cut from another page — a font, a scrap of paper,
// an ink, an angle and a size of its own — yet standing where the line's own font sets it. So the size a
// line is fitted at, its bends, its highlighted words and the type size the cover standards read are those
// of any other lettering; only how each letter is drawn differs. Every letter is drawn into its cell (its
// share of the piece setLine set, in title.js), as large as the cell and the line's letters allow.
//
// How a letter is dressed follows from the layer's seed (`o.ransom.salt`: its id and the number Reshuffle
// draws), the line (`o.row`), the letter and how many times it came before in the line: the same at every
// size, and a letter typed or deleted changes the letters before it not at all (but for the line's hero,
// should the new one outdraw it), and mostly only the next letter and the same letters after it
// (neighbours never share a font, nor a paper). Faces are the bundled fonts and the system fonts that are
// installed (useRansomFaces, from app.js); a face without the letter gives way to the next.
//
// A letter may be dressed by hand (`o.ransom.edits`, the layer's `letters`, by letterKey): any of its face,
// kind, paper, ink, size, angle, lift, case, whether it is the hero, its scrap's edge and tape; dealt again
// on its own (`salt`); or locked (`lock`: the layer's seed it keeps, whatever Reshuffle deals the others).
// Besides scraps of paper, a letter may stand in depth, be cut from the cover's photo, sit on a scrap torn
// along an edge or two, or be taped down: each of these a layer may turn off (`o.ransom.off`).
import { INK, isFast, fall } from "./style.js";
import { luminance, contrastRatio } from "./check.js";
import { LETTER_KINDS as KINDS, RANSOM_EXTRAS as EXTRAS } from "./layers.js";
export { KINDS, EXTRAS };

/**
 * The faces letters may be cut from, by script, each [family, CSS weight, how often (1), italic]: the
 * bundled fonts first, then those of macOS, Windows and Linux, and free fonts often installed (faces whose
 * hairlines vanish small, less often). Only those the app finds installed are used (useRansomFaces).
 */
export const RANSOM_FACES = {
  latin: [
    ["Bebas Neue", 400, 1.5], ["JetBrains Mono", 800], ["Noto Sans SC", 900], ["Noto Sans SC", 300, 0.6],
    ["Georgia", 700], ["Didot", 700, 0.5], ["Bodoni 72", 700, 0.5], ["Impact", 400], ["Arial Black", 900], ["Futura", 700],
    ["Avenir Next Condensed", 800], ["Rockwell", 700], ["American Typewriter", 700], ["Courier New", 700],
    ["Times New Roman", 700, 1, true], ["Baskerville", 700, 0.7, true], ["Copperplate", 700, 0.7], ["Chalkduster", 400, 0.5],
    ["Marker Felt", 700, 0.6], ["Phosphate", 400, 0.7], ["Gill Sans", 700], ["Cochin", 700, 0.7], ["Optima", 800, 0.7],
    ["Hoefler Text", 900, 0.7], ["Silom", 400, 0.6], ["Trebuchet MS", 700, 0.6], ["Verdana", 700, 0.6],
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
/** Whether a letter has an upper and a lower case, one character each. */
export const cased = (ch) => ch.toUpperCase() !== ch.toLowerCase() && [...ch.toUpperCase()].length === 1 && [...ch.toLowerCase()].length === 1;
/** Whether a letter is set in the Chinese faces. */
export const isCJK = (ch) => CJK.test(ch);
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
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < d;
/** WCAG contrast of two colours [r, g, b]. */
export const contrast = (a, b) => contrastRatio(lum(a), lum(b));
const BLACK = "#151515", WHITE = "#ffffff", RED = "#d23a2b";
/** A paper of colour css: {css, rgb, often, light}. */
const paperOf = (css, often = 1) => { const rgb = rgbOf(css); return rgb && { css: hex(rgb), rgb, often, light: lum(rgb) > 0.4 }; };
/**
 * The scraps of paper for a layer: the channel colour (`o.C`), black, white, newsprint and kraft, the
 * highlighted words' colour (`o.hiCss`) and a yellow — {css, rgb, often, light}. A neutral is left out
 * when the channel colour is it; a colour, when one near it is there already.
 */
export function papersFor(o) {
  const out = [];
  const add = (css, often, apart) => { const p = paperOf(css, often); if (p && !out.some((q) => near(q.rgb, p.rgb, apart))) out.push(p); };
  add(o.C ? hex(o.C) : null, 2.5, 0);
  add(BLACK, 3, 30); add(WHITE, 2, 30); add("#efe9dc", 2, 30); add("#d7bf93", 1.5, 30); add(o.hiCss, 1.2, 80); add("#f3d23b", 1, 80);
  return out;
}
/** The inks a letter may take: black, white, the channel colour, a red — [{css, rgb, often}]. */
export const inksFor = (C) => [[BLACK, 3], [WHITE, 3], [C ? hex(C) : null, 2], [RED, 1]].filter(([css]) => css).map(([css, often]) => ({ css, rgb: rgbOf(css), often }));
/** The ink for letters on paper p: among the inks that read on it (4.5 : 1), black and white likeliest; the one that reads best when none does. */
function inkOn(p, C, R) {
  const all = inksFor(C), reads = all.filter((k) => contrast(k.rgb, p.rgb) >= 4.5);
  if (!reads.length) return all.reduce((a, b) => (contrast(b.rgb, p.rgb) > contrast(a.rgb, p.rgb) ? b : a)).css;
  return reads[draw(reads, (k) => k.often, R)].css;
}
/** The key a letter is dressed by hand under: its line, itself and how many times it came before in the line. */
export const letterKey = (row, ch, n) => `${row}|${ch}|${n}`;
/** The keys of the cells of line `row` (see lineCells), in order: each letter's, counted as letterKey counts them. */
export function keysOf(cells, row) {
  const seen = new Map();
  return cells.map((c) => { const n = (seen.get(c.ch) || 0) + 1; seen.set(c.ch, n); return letterKey(row, c.ch, n); });
}

/**
 * How each letter of a line is dressed (pure; ransom draws it). `cells`: [{ch, hi, whole}] in order (whole:
 * a stretch of another script, set as it is). `pools`: {latin, cjk}, faces {family, weight, often, italic}.
 * `has(face, ch)`: whether a face has a letter. `edits`: the letters dressed by hand, by letterKey (see the
 * top of the file); `off`: the extras turned off; `photo`: whether there is a photo to cut letters from.
 * Returns, for each cell, null for what is not a letter or a digit it dresses (spaces, marks, emoji, other
 * scripts: drawn as the line sets them), else { key, face (null: the line's own), ch (its case as drawn),
 * kind (KINDS), paper ({css, rgb, light}: the scrap's, the hollow letter's inside, the face of one in depth),
 * ink (CSS), turn (degrees), lift (in type sizes), size (times the line's letters), hero, corners (eight
 * numbers in [-1, 1], how the scrap's corners are off square), edge ("cut" or "torn"), tape (0: none, 1:
 * across the top, 2: across a corner), tear (a seed for the torn edge, the tape's slant and where a photo
 * letter is cut from), locked, edited }. One letter of a line of three or more is the hero, larger, on the
 * channel colour (unless the letter before is) — in the highlighted words when there are any — or the
 * letters made heroes by hand are. A letter only one family has may stand next to another in it. `amt`
 * (the layer's strength, 0 to 2): how far letters turn and shift and how often their case is changed.
 *
 * Each value is drawn from a stream of its own (the letter's name and the value's), so what is set by hand
 * changes nothing else of the letter but what follows from it (a kind's paper, a paper's ink, a hero's size
 * and angle), and of the letters after it mostly the next one's face and paper, which keep clear of it. A
 * lock ({seed, face, paper, ink, hero}) keeps the letter's name under the layer's seed of then, and what
 * depended on its neighbours as it was, so it stays as it was whatever is dealt round it; the letter before
 * it keeps clear of its face and paper instead.
 */
export function ransomPlan(cells, pools, { salt = "", row = 0, amt = 1, papers = papersFor({}), C = null, has = () => true, edits = null, off = [], photo = false } = {}) {
  const E = edits || {}, can = { torn: !off.includes("torn"), tape: !off.includes("tape"), deep: !off.includes("deep"), photo: photo && !off.includes("photo") };
  const lockOf = (e) => (e && e.lock && Number.isInteger(e.lock.seed) ? e.lock : null);
  // each letter's own key and name: the letter and how many times it came before; a locked one under the seed it was locked with
  const keys = keysOf(cells, row);
  const names = keys.map((k) => { const e = E[k], lk = lockOf(e); return `${lk ? salt.replace(/:\d*$/, "") + ":" + lk.seed : salt}|${k}${e && e.salt ? "|" + e.salt : ""}`; });
  const dressed = (c) => !c.whole && LETTER.test(c.ch), letters = cells.map((c, i) => (dressed(c) ? i : -1)).filter((i) => i >= 0);
  // the hero: those made heroes by hand (or locked as one), else the letter whose name draws highest (in the highlighted words when
  // there are any; not one made no hero), so another typed moves it only when it draws higher
  const heroSet = (i) => { const e = E[keys[i]] || {}, lk = lockOf(e); return e.hero ?? (lk ? lk.hero : undefined); };
  const byHand = letters.filter((i) => heroSet(i) === true), free = letters.filter((i) => heroSet(i) !== false);
  const marked = free.filter((i) => cells[i].hi), from = marked.length ? marked : free;
  const heroes = new Set(byHand.length ? byHand : letters.length >= 3 && from.length ? [from.reduce((a, b) => (hash(names[b] + "|hero") > hash(names[a] + "|hero") ? b : a))] : []);
  const chosen = papers.find((p) => C && near(p.rgb, C, 40)), same = (a, b) => !!a && !!b && a.css === b.css;
  // what a locked letter keeps, for the letter before it to keep clear of (it cannot give way itself)
  const ahead = letters.map((i, n) => { const lk = lockOf(E[keys[letters[n + 1]]]); return [i, lk ? { family: lk.face && lk.face.family, paper: lk.paper } : null]; });
  const aheadOf = new Map(ahead);
  const out = [];
  let prev = { family: null, paper: null };
  cells.forEach((c, i) => {
    if (!dressed(c)) { out.push(null); return; }
    const e = E[keys[i]] || {}, lk = lockOf(e), isHero = heroes.has(i), cjk = CJK.test(c.ch), R = (what) => seeded(hash(`${names[i]}|${what}`));
    // the face: by how often each is wanted; drawn again, from the other families, when it is the one before's
    const pool = (pools[cjk ? "cjk" : "latin"] || []).filter((f) => has(f, c.ch));
    let face = pool.length ? pool[draw(pool, (f) => f.often, R("face"))] : null;
    if (face && face.family === prev.family) { const others = pool.filter((f) => f.family !== prev.family); if (others.length) face = others[draw(others, (f) => f.often, R("face2"))]; }
    const next = aheadOf.get(i);   // a locked letter after it: its family and paper are kept clear of too
    if (face && next && face.family === next.family) { const others = pool.filter((f) => f.family !== prev.family && f.family !== next.family); if (others.length) face = others[draw(others, (f) => f.often, R("face3"))]; }
    // the kind; the papers for a scrap and for a hollow letter (light), never the one before; the hero on the channel colour
    const r = R("kind")(), drawn = isHero ? "tile" : r < 0.62 ? "tile" : r < 0.8 ? "bare" : r < 0.88 ? "cut" : r < 0.96 ? (can.deep ? "deep" : "tile") : can.photo ? "photo" : "tile";
    const pick = (list, what) => {
      let k = draw(list, (p) => p.often * (c.hi && p === chosen ? 2 : 1), R(what));
      if (same(list[k], prev.paper) && list.length > 1) k = (k + 1) % list.length;
      return list[k];
    };
    const anyPaper = isHero && chosen && !same(chosen, prev.paper) ? chosen : pick(papers, "paper"), lightPaper = pick(papers.filter((p) => p.light), "light");
    const turn = (R("turn")() - 0.5) * 2 * (isHero ? 5 : 9) * amt, lift = (R("lift")() - 0.5) * 2 * 0.06 * amt, size = isHero ? 1.2 : 0.88 + R("size")() * 0.14;
    const corner = R("corners"), corners = Array.from({ length: 8 }, () => corner() * 2 - 1);
    const flip = !cjk && cased(c.ch) && R("case")() < Math.min(0.5, 0.35 * amt);
    const edge = can.torn && R("edge")() < 0.3 ? "torn" : "cut", taped = R("tape")(), tear = Math.floor(R("tear")() * 1e9);
    // then what a lock keeps, and what was set by hand
    const kind = KINDS.includes(e.kind) && (e.kind !== "photo" || photo) ? e.kind : drawn;
    const paperCss = e.paper || (lk && lk.paper);
    let paper = paperCss ? papers.find((q) => q.css === paperCss) || paperOf(paperCss) : kind === "cut" ? lightPaper : anyPaper;
    if (!paperCss && next && paper.css === next.paper) {   // not the paper of the locked letter after it, nor the one before's
      const list = kind === "cut" ? papers.filter((q) => q.light) : papers, k = list.indexOf(paper);
      paper = list.map((_, n) => list[(k + 1 + n) % list.length]).find((q) => q.css !== next.paper && !same(q, prev.paper)) || paper;
    }
    const caseOf = e.case === "upper" ? c.ch.toUpperCase() : e.case === "lower" ? c.ch.toLowerCase() : e.case === "typed" ? c.ch : null;
    const lockedFace = lk && lk.face ? { often: 1, italic: false, ...lk.face } : null;
    const d = {
      key: keys[i], face: e.face ? { often: 1, italic: false, ...e.face } : lockedFace || face, kind, paper,
      ink: e.ink || (lk && lk.ink && !e.paper ? lk.ink : inkOn(paper, C, R("ink"))),
      turn: e.turn ?? turn, lift: e.lift ?? lift, size: e.size ?? size, hero: isHero, corners,
      ch: caseOf ?? (flip ? (c.ch === c.ch.toUpperCase() ? c.ch.toLowerCase() : c.ch.toUpperCase()) : c.ch),
      edge: e.edge === "torn" || e.edge === "cut" ? e.edge : edge, tape: [0, 1, 2].includes(e.tape) ? e.tape : can.tape && taped < 0.14 ? (taped < 0.07 ? 1 : 2) : 0,
      tear, locked: !!lk, edited: Object.keys(e).some((k) => k !== "lock"),
    };
    out.push(d);
    prev = { family: d.face ? d.face.family : null, paper: kind === "bare" || kind === "photo" ? null : d.paper };
  });
  return out;
}
/**
 * The cells of a line, from its pieces ([{t, hi}], as setLine sets them or parseTitle reads them): each
 * letter one, a stretch of another script one from its first letter to its last (`whole`). Each cell has its
 * piece (`at`) and its text.
 */
export function lineCells(pieces) {
  const cells = [];
  pieces.forEach((a, at) => {
    const g = graphemes(a.t), other = g.map((ch) => OTHER.test(ch));
    for (let i = 0; i < g.length; i++) {
      let j = i;
      if (other[i]) for (let k = i + 1; k < g.length && !LETTER.test(g[k]); k++) if (other[k]) j = k;   // through spaces and marks, to its last letter before one it dresses
      cells.push({ ch: g.slice(i, j + 1).join(""), hi: !!a.hi, whole: other[i], at }); i = j;
    }
  });
  return cells;
}
/**
 * The cells of line `row` where they lie along it: [{ch, key, x, w, pen, s, dy}]. The line is given as its pieces ({t,
 * x, w, s, dy}, as setLine sets them); each cell is its share of its piece (x, w), as the ransom note measures it
 * (`measure(text)`: its width in the line's font), set as its piece is (larger by s, lower by dy); `pen`: where its
 * letter begins as the piece's text is set, kerned with the letters before it in the piece.
 */
export function letterCells(pieces, measure, row) {
  const cells = lineCells(pieces), names = keysOf(cells, row), widths = cells.map((c) => measure(c.ch) * (pieces[c.at].s ?? 1));
  const sums = pieces.map(() => 0), pens = pieces.map((p) => p.x), before = pieces.map(() => "");
  cells.forEach((c, i) => { sums[c.at] += widths[i]; });
  return cells.map((c, i) => {
    const p = pieces[c.at], w = widths[i] * (p.w && sums[c.at] > 0 ? p.w / sums[c.at] : 1), x = pens[c.at], pen = p.x + (before[c.at] ? measure(before[c.at]) * (p.s ?? 1) : 0);
    pens[c.at] += w; before[c.at] += c.ch;
    return { ch: c.ch, key: names[i], x, w, pen, s: p.s ?? 1, dy: p.dy || 0 };
  });
}
/**
 * Where the letters `keys` (a Set of letter keys) of line `row` lie along it (see letterCells): [[x0, x1]], a run
 * of them side by side one. The line's first and last cells reach `out` past its ends (what a lettering throws
 * there: an outline, a shadow).
 */
export function letterSpans(pieces, measure, row, keys, out = 0) {
  const cells = letterCells(pieces, measure, row), spans = [];
  cells.forEach((c, i) => {
    if (!keys.has(c.key)) return;
    const a = i === 0 ? c.x - out : c.x, b = i === cells.length - 1 ? c.x + c.w + out : c.x + c.w, last = spans[spans.length - 1];
    if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b); else spans.push([a, b]);
  });
  return spans;
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
/** The faces in use, by script: {latin, cjk}, each [{family, weight, often, italic}]. */
export const ransomPools = () => POOLS;

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
/** A face as a canvas (and CSS) font at `px`, then the families `rest`. */
export const faceFont = (f, px, rest = "") => `${f.italic ? "italic " : ""}${f.weight} ${px}px ${q(f.family)}${rest ? ", " + rest : ""}`;
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
/** Whether face f has letter ch (see has), for the editor's list of faces. */
export const faceHas = (f, ch) => has(f, ch);
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

// ---------- what the editor shows
const SHOWN = new Map();   // layer id -> {papers, C}: what its letters were last drawn with on the editor's canvas
/** The papers and the channel colour a layer's letters were last drawn with on the editor's canvas, for its letter strip; null before they were. */
export const ransomShown = (id) => SHOWN.get(id) || null;
/**
 * Each line of a layer's words (`lines`, as parseTitle reads them) as the ransom note dresses it: [{row,
 * cells, plan}]. `r`: the layer's ransom settings as render.js gives them ({id, salt, edits, off, photo});
 * `amt`, its strength. The papers and channel colour are those it was last drawn with, else `before`
 * ({papers, C}).
 */
export function ransomLetters(lines, r, amt = 1, before = { papers: papersFor({}), C: null }) {
  const shown = SHOWN.get(r.id) || before;
  return lines.map((runs, row) => {
    const cells = lineCells(runs);
    return { row, cells, plan: ransomPlan(cells, POOLS, { salt: r.salt, row, amt, papers: shown.papers, C: shown.C, has, edits: r.edits, off: r.off || [], photo: !!r.photo }) };
  });
}

// ---------- drawing
const PHOTO_LETTERS = new WeakMap();   // photo -> letters cut from it, by letter, face, size and resolution; the newest last
/** The scrap's outline about its letter: its four corners a little off square, and the sides it was torn along jagged, `grow` larger (the paper's torn fibres). */
function scrap(p, W, H, j, grow = 0, tooth = 0) {
  const quad = [[-W + j(0), -H + j(1)], [W + j(2), -H + j(3)], [W + j(4), H + j(5)], [-W + j(6), H + j(7)]].map(([x, y]) => [x * (1 + grow / W), y * (1 + grow / H)]);
  if (p.edge !== "torn") return quad;
  const R = seeded(p.tear), sides = [0, 1, 2, 3].filter(() => R() < 0.45);
  if (!sides.length) sides.push(Math.floor(R() * 4));
  const T = seeded(p.tear + (grow ? 7 : 0)), out = [];
  quad.forEach((a, s) => {
    const b = quad[(s + 1) % 4];
    out.push(a);
    if (!sides.includes(s)) return;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(3, Math.round(len / tooth)), nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    for (let k = 1; k < n; k++) { const t = k / n, dev = (T() - 0.35) * tooth * 0.9; out.push([a[0] + (b[0] - a[0]) * t + nx * dev, a[1] + (b[1] - a[1]) * t + ny * dev]); }
  });
  return out;
}
/** A strip of tape over a scrap W × H about its letter: across the top (1) or a corner (2), its ends cut in teeth. */
function tape(ctx, p, W, H, fs) {
  const R = seeded(p.tear + 13), long = p.tape === 1 ? Math.max(W * 1.5, fs * 0.4) : fs * 0.42, thick = fs * 0.15;
  ctx.save();
  if (p.tape === 1) { ctx.translate((R() - 0.5) * W * 0.4, -H); ctx.rotate(((R() - 0.5) * 24 * Math.PI) / 180); }
  else { const s = R() < 0.5 ? -1 : 1; ctx.translate(s * W * 0.85, -H * 0.85); ctx.rotate((s * (38 + R() * 14) * Math.PI) / 180); }
  const a = long / 2, b = thick / 2, teeth = 3, pts = [];
  for (let k = 0; k <= teeth; k++) pts.push([-a + (k % 2 ? thick * 0.12 : 0), -b + (thick * k) / teeth]);
  for (let k = 0; k <= teeth; k++) pts.push([a - (k % 2 ? thick * 0.12 : 0), b - (thick * k) / teeth]);
  ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fillStyle = "rgba(238,229,201,0.68)"; ctx.fill();
  ctx.strokeStyle = "rgba(120,110,80,0.25)"; ctx.lineWidth = fs * 0.006; ctx.stroke();
  ctx.restore();
}

/**
 * Paints the current line in ransom-note letters (see the top of the file; `pass` and `o` as paintRuns',
 * `o.ransom` the layer's settings, `o.row` the line): every scrap of paper first, then every letter, then
 * the tape, so no scrap hides a letter beside it; the hero last of each. A letter in depth is a stack of
 * fewer copies while something is dragged; one cut from the photo is kept (PHOTO_LETTERS) until it changes.
 * `o.only` (a Set of letter keys): only those letters are painted, each whole, scrap and tape too (the letters
 * a cut-out is woven with in front of it, see weave in layers.js), the others where they are, unpainted.
 */
export function ransom(ctx, pass, o) {
  fontsNow();
  const r = o.ransom || {}, pieces = [];
  pass((a, x) => pieces.push([a, x]));
  const fs = o.fs, base = ctx.font, families = base.replace(/^.*?\d*\.?\d+px\s*(\/\s*\S+\s*)?/, "") || "sans-serif";
  const at100 = (s) => base.replace(/(\d*\.?\d+)px/, `${100 * s}px`);
  // the cells: each letter's share of its piece, as the line's font sets it
  const cells = lineCells(pieces.map(([a]) => a)), widths = cells.map((c) => ctx.measureText(c.ch).width * (pieces[c.at][0].s ?? 1));
  const sums = pieces.map(() => 0), pens = pieces.map(([, x]) => x);
  cells.forEach((c, i) => { sums[c.at] += widths[i]; });
  cells.forEach((c, i) => { const [a] = pieces[c.at], w = widths[i] * (a.w && sums[c.at] > 0 ? a.w / sums[c.at] : 1); Object.assign(c, { x: pens[c.at], w, s: a.s ?? 1, dy: a.dy || 0 }); pens[c.at] += w; });
  if (!cells.length) return;
  // the line's letters, as its own font sets them: how tall, and where their middle is
  const big = inkOf(ctx, at100(1), "H"), han = inkOf(ctx, at100(1), "国"), u = fs / 100;
  const papers = papersFor(o), C = o.C || null, amt = o.amt ?? 1, row = o.row ?? 0, photo = r.photo && typeof document !== "undefined" ? r.photo : null;
  if (r.shown && r.id) SHOWN.set(r.id, { papers, C });
  const key = JSON.stringify([r.salt ?? "", row, amt, C, o.hiCss, r.edits || null, r.off || null, !!photo, cells.map((c) => [c.ch, c.hi, c.whole])]);
  let plan = PLANS.get(key);
  if (!plan) {
    plan = ransomPlan(cells, POOLS, { salt: r.salt ?? "", row, amt, papers, C, has, edits: r.edits, off: r.off || [], photo: !!photo });
    if (PLANS.size > 64) PLANS.clear();
    PLANS.set(key, plan);
  }
  const only = o.only ? keysOf(cells, row).map((k) => o.only.has(k)) : null;
  const order = plan.map((_, i) => i).filter((i) => !only || only[i]).sort((i, j) => (plan[i] && plan[i].hero ? 1 : 0) - (plan[j] && plan[j].hero ? 1 : 0));   // the hero last, over its neighbours
  ctx.save();
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.lineJoin = "round";
  // the shadows fall down and to the right as the page has it, in a column too (fall in style.js): `[sx, sy]` the way
  const d = o.d || 0, stroke = o.strokeAmt || 0, [sx, sy] = fall(1, 1);
  /** A letter in the layer's own colours: its shadow, its keyline, its fill (the house lettering, one letter). */
  const lettered = (ch, x, y, hi) => {
    if (d > 0) { ctx.fillStyle = ctx.strokeStyle = hi ? o.hiShadowCss : o.shadowCss; ctx.lineWidth = fs * 0.04; ctx.strokeText(ch, x + d * sx, y + d * sy); ctx.fillText(ch, x + d * sx, y + d * sy); }
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
    const g = { x: c.x + c.w / 2, y: mid + p.lift * fs, font: p.face ? faceFont(p.face, 100 * k, families) : at100(k), w: (m.l + m.r) * k, h: (m.a + m.d) * k, gx: -(m.r - m.l) / 2 * k, gy: (m.a - m.d) / 2 * k };
    const px = fs * 0.07 * c.s, py = fs * 0.055 * c.s;
    return Object.assign(g, { W: g.w / 2 + px, H: g.h / 2 + py, j: (n) => p.corners[n] * px * 0.45, tooth: fs * 0.035 * c.s });
  });
  const placed = (g, p, paint) => { ctx.save(); ctx.translate(g.x, g.y); ctx.rotate((p.turn * Math.PI) / 180); ctx.font = g.font; paint(); ctx.restore(); };
  const path = (pts, dx = 0) => { ctx.beginPath(); pts.forEach(([x, y], n) => (n ? ctx.lineTo(x + dx * sx, y + dx * sy) : ctx.moveTo(x + dx * sx, y + dx * sy))); ctx.closePath(); };
  // the scraps the letters were cut from: a little larger than the letter, their corners not quite square, a shadow under each; a torn
  // side shows the paper's lighter fibres
  for (const i of order) {
    const p = plan[i], g = geo[i];
    if (!p || p.kind !== "tile") continue;
    placed(g, p, () => {
      const outline = scrap(p, g.W, g.H, g.j, 0, g.tooth);
      if (d > 0) { path(outline, d * 0.6); ctx.fillStyle = "rgba(7,7,12,0.45)"; ctx.fill(); }
      if (p.edge === "torn") { path(scrap(p, g.W, g.H, g.j, fs * 0.02, g.tooth)); ctx.fillStyle = hex(p.paper.light ? mix(p.paper.rgb, [120, 110, 90], 0.12) : mix(p.paper.rgb, [255, 255, 255], 0.78)); ctx.fill(); }
      path(outline); ctx.fillStyle = p.paper.css; ctx.fill();
    });
  }
  // the letters
  for (const i of order) {
    const c = cells[i], p = plan[i], g = geo[i];
    if (!p) {   // a space, a mark, an emoji, a stretch of another script: as the line sets it
      if (/^\s+$/.test(c.ch)) continue;
      ctx.save(); ctx.font = at100(c.s * u); lettered(c.ch, c.x, c.dy, c.hi); ctx.restore();
      continue;
    }
    placed(g, p, () => {
      if (p.kind === "tile") { ctx.fillStyle = p.ink; ctx.fillText(p.ch, g.gx, g.gy); }
      else if (p.kind === "cut") {   // hollow: paper inside an ink rim
        if (d > 0) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.07; ctx.strokeText(p.ch, g.gx + d * 0.6 * sx, g.gy + d * 0.6 * sy); ctx.fillText(p.ch, g.gx + d * 0.6 * sx, g.gy + d * 0.6 * sy); }
        ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.07; ctx.strokeText(p.ch, g.gx, g.gy);
        ctx.fillStyle = p.paper.css; ctx.fillText(p.ch, g.gx, g.gy);
      } else if (p.kind === "deep") {   // in depth: the letter laid back down and to the right, darker as it goes, its face in paper colour on an ink rim
        const m = ctx.getTransform ? ctx.getTransform() : { a: 1, b: 0 }, unit = Math.hypot(m.a, m.b) || 1, depth = fs * 0.1 * c.s;
        const side = p.paper.light ? mix(p.paper.rgb, rgbOf(INK), 0.55) : C && !near(C, p.paper.rgb, 60) ? C : [90, 90, 96], steps = Math.max(3, Math.min(isFast() ? 8 : 40, Math.ceil((depth * unit) / 1.2)));
        const [bx, by] = fall(depth * 0.62, depth * 0.78);
        for (let t = steps; t >= 1; t--) { ctx.fillStyle = hex(mix(side, rgbOf(INK), 0.45 * (t / steps))); ctx.fillText(p.ch, g.gx + bx * (t / steps), g.gy + by * (t / steps)); }
        ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.03; ctx.strokeText(p.ch, g.gx, g.gy);
        ctx.fillStyle = p.paper.css; ctx.fillText(p.ch, g.gx, g.gy);
      } else if (p.kind === "photo" && photo && ctx.getTransform) {   // cut from the cover's photo, on a white rim and an ink line
        const m = ctx.getTransform(), unit = Math.hypot(m.a, m.b) || 1, W = g.w + fs * 0.2, H = g.h + fs * 0.2, pw = Math.max(1, Math.min(2048, Math.ceil(W * unit))), ph = Math.max(1, Math.min(2048, Math.ceil(H * unit)));
        const id = [p.key, p.tear, g.font, p.ch, W.toFixed(1), H.toFixed(1), pw, ph].join("|"), cuts = PHOTO_LETTERS.get(photo.img) || new Map();
        PHOTO_LETTERS.set(photo.img, cuts);
        let cut = cuts.get(id);
        if (!cut) {   // the letter at the canvas's resolution, the photo laid in where it is
          cut = Object.assign(document.createElement("canvas"), { width: pw, height: ph });
          const x = cut.getContext("2d"), img = photo.img, iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, R = seeded(p.tear + 29);
          x.setTransform(pw / W, 0, 0, ph / H, pw / 2, ph / 2); x.font = g.font; x.textAlign = "left"; x.textBaseline = "alphabetic";
          x.fillStyle = "#000"; x.fillText(p.ch, g.gx, g.gy);
          const sw = Math.min(iw, ih * (W / H)) / (1.5 + R() * 1.5), sh = sw * (H / W), sx = (iw - sw) * (0.2 + R() * 0.6), sy = (ih - sh) * (0.2 + R() * 0.6);
          x.globalCompositeOperation = "source-in"; x.drawImage(img, sx, sy, sw, sh, -W / 2, -H / 2, W, H);
          if (cuts.size >= 48) cuts.delete(cuts.keys().next().value);
          cuts.set(id, cut);
        }
        if (d > 0) { ctx.fillStyle = ctx.strokeStyle = "rgba(7,7,12,0.5)"; ctx.lineWidth = fs * 0.11; ctx.strokeText(p.ch, g.gx + d * 0.6 * sx, g.gy + d * 0.6 * sy); }
        ctx.strokeStyle = INK; ctx.lineWidth = fs * 0.11; ctx.strokeText(p.ch, g.gx, g.gy);   // an ink line round the rim, so a letter cut from the photo stands off the same photo behind it
        ctx.strokeStyle = WHITE; ctx.lineWidth = fs * 0.08; ctx.strokeText(p.ch, g.gx, g.gy);
        ctx.drawImage(cut, -W / 2, -H / 2, W, H);
      } else lettered(p.ch, g.gx, g.gy, c.hi);
    });
  }
  // the tape over the scraps that have it
  for (const i of order) {
    const p = plan[i], g = geo[i];
    if (p && p.kind === "tile" && p.tape) placed(g, p, () => tape(ctx, p, g.W, g.H, fs));
  }
  ctx.restore();
}
