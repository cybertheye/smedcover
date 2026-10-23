// a page from a Song-dynasty woodblock book
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, TAU, canPaint, clamp, css, flatFx, grain, graphicTop, grey, gridPen, knockWorn, layDown, mapped, mix, objAt, openField, painters, parseColour, rand, role, titleArea, upright, wash, wear, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout, wordsFoot } from "../layout.js";

const SONG = { paper: [236, 224, 196], ink: [30, 25, 21], red: [176, 38, 32] };
const worn = (c) => mix(mix(c, grey(c), 0.3), SONG.paper, 0.22);   // a colour as a water-based print would hold it
const NUMERALS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
const numeral = (n) => (n <= 10 ? NUMERALS[n] : n < 20 ? "十" + NUMERALS[n - 10] : String(n));
/**
 * Where the vertical title stands: the layout's box, beside the seal in the corner (which keeps it),
 * and down to the colour band or the foot of the page — columns want height, where a line wants width.
 */
function songBox(ctx, env, box) {
  // the foot of the page, above the counts and badges the apps lay over it (see wordsFoot in layout.js)
  const G = env.G, split = G.template === "split", page = Math.min(env.h - 110, wordsFoot(env.w, env.h));
  let foot = split || G.flipped ? page : Math.min(G.accent[0][1], G.accent[1][1]) - 36;
  let x = box.x, w = box.w;
  if (env.cover.tag && !G.flipped) {
    const f = G.tag.fs * 0.82;
    ctx.save(); ctx.font = `900 ${f}px ${fonts.serif}`; const seal = spacedW(ctx, env.cover.tag, 4) + f * 0.9 + 44; ctx.restore();
    x += seal; w = Math.max(200, w - seal);
  }
  // the channel name under the columns, on the page rather than the band: they end above it
  const c = G.cat, nameTop = c.y - c.fs * 0.95 - 30;
  if (foot > nameTop && c.y > box.y && c.x < x + w && c.x + c.maxW > x) foot = nameTop;
  return { x, y: box.y, w, h: Math.max(160, foot - box.y) };
}
/**
 * A made-up character `s` units across, centred at (x, y), built as a Song face builds one: thin
 * horizontals, heavier verticals, a dot or a falling stroke, in two parts side by side, two parts one
 * above the other, or one part whole. Not a real character — it only has to read as text at a glance.
 */
function fauxGlyph(ctx, x, y, s, k, t = Math.max(1.2, s * 0.085)) {
  const l = x - s / 2, top = y - s / 2, th = t * 0.72, tv = t * 1.3;
  const H = (x0, y0, len) => ctx.fillRect(l + x0 * s, top + y0 * s - th / 2, len * s, th);
  const V = (x0, y0, len) => ctx.fillRect(l + x0 * s - tv / 2, top + y0 * s, tv, len * s);
  const slant = (x0, y0, len, a) => { ctx.save(); ctx.translate(l + x0 * s, top + y0 * s); ctx.rotate(a); ctx.fillRect(0, -th * 0.7, len * s, th * 1.4); ctx.restore(); };
  const part = (x0, y0, w, h, q) => {
    if (rand(q + 0.6) > 0.55) { V(x0, y0 + h * 0.08, h * 0.84); V(x0 + w, y0 + h * 0.08, h * 0.84); H(x0, y0 + h * 0.08, w); H(x0, y0 + h * 0.92, w); }   // a box
    const n = 1 + Math.floor(rand(q) * 3);
    for (let i = 0; i < n; i++) { const a = rand(q + i * 1.9 + 0.1) * 0.15; H(x0 + w * a, y0 + h * (0.18 + (0.64 * (i + 0.5)) / n), w * (1 - a - rand(q + i * 2.3 + 0.2) * 0.2)); }
    if (rand(q + 0.3) > 0.25) V(x0 + w * (0.3 + rand(q + 0.4) * 0.4), y0, h);
    if (rand(q + 0.5) > 0.55) ctx.fillRect(l + (x0 + w * 0.5) * s - tv * 0.6, top + (y0 + h * 0.02) * s, tv * 1.2, tv * 1.4);   // a dot
  };
  const kind = rand(k);
  if (kind < 0.45) { part(0.04, 0.06, 0.26, 0.88, k + 1.1); part(0.42, 0.04, 0.54, 0.92, k + 2.2); }   // side by side
  else if (kind < 0.8) { part(0.1, 0.02, 0.8, 0.42, k + 3.3); part(0.04, 0.5, 0.92, 0.48, k + 4.4); }   // one above the other
  else { part(0.08, 0.04, 0.84, 0.66, k + 5.5); slant(0.48, 0.66, 0.42, 2.4); slant(0.5, 0.66, 0.44, 0.7); }   // whole, with falling strokes at the foot
}
/**
 * The page's own text, in the ruled columns the title leaves free: runs of large characters, one to a
 * column, broken by commentary in two small lines side by side, as the old books set their notes;
 * filled right to left and top to bottom as Text rises, the last character coming in faintly. Vermilion
 * marks (Vermilion marks): a small circle beside some of the large characters, a line down the side of
 * some runs, and comments in tiny characters along the rules — these last whether there is text or not.
 */
function songText(ctx, env, p, pitch) {
  if (p.text <= 0 && p.notes <= 0) return;
  const { w, h } = env, F = openField(env), A = titleArea(ctx, env);
  const y0 = env.hasBrand ? 112 : 74, y1 = Math.min(h - 70, F.y1 - 24), big = pitch * 0.44, small = pitch * 0.22;
  // the free stretches of each column, right to left: not under the title, nor behind the channel graphic
  const cols = [];
  for (let r = w - 64 - pitch; r - pitch > 60; r -= pitch) {
    const cx = r - pitch / 2, spans = [[y0, y1]];
    const cut = (a, b) => { for (let i = spans.length - 1; i >= 0; i--) { const [s0, s1] = spans[i]; if (b <= s0 || a >= s1) continue; spans.splice(i, 1, ...[[s0, a], [b, s1]].filter(([u, v]) => v - u > big * 1.5)); } };
    if (A && cx + pitch / 2 > A.x - 16 && cx - pitch / 2 < A.x + A.w + 16) cut(A.y - 30, A.y + A.h + 30);
    const top = graphicTop(env, cx - pitch / 2, cx + pitch / 2);
    if (top < y1) cut(top, Infinity);
    cols.push({ cx, spans });
  }
  const ink = css(SONG.ink, 0.82), red = css(SONG.red, 0.9);
  // the text: every cell is a large character or a pair of small ones; `left` of them are shown
  const cells = [];
  cols.forEach((c, ci) => c.spans.forEach(([s0, s1], si) => {
    let y = s0, k = ci * 131 + si * 17, run = 0, notes = false;
    while (true) {
      if (run <= 0) { notes = !notes && rand(k * 1.7 + 660) > 0.45; run = notes ? 4 + Math.floor(rand(k + 661) * 9) : 3 + Math.floor(rand(k + 662) * 7); k += 3.1; }
      const step = notes ? small * 1.18 : big * 1.16;
      if (y + step > s1) break;
      cells.push({ x: c.cx, y: y + step / 2, notes, k: k * 7.3 + y });
      y += step; run--;
    }
  }));
  let left = p.text * cells.length;
  ctx.save();
  for (const cell of cells) {
    if (left <= 0) break;
    ctx.globalAlpha = Math.min(1, left); left -= 1;
    ctx.fillStyle = ink;
    if (cell.notes) { fauxGlyph(ctx, cell.x + small * 0.6, cell.y, small, cell.k); fauxGlyph(ctx, cell.x - small * 0.6, cell.y, small, cell.k + 41); }
    else {
      fauxGlyph(ctx, cell.x, cell.y, big, cell.k);
      if (rand(cell.k + 663) < p.notes * 0.45) { ctx.strokeStyle = red; ctx.lineWidth = Math.max(1.5, big * 0.06); ctx.beginPath(); ctx.arc(cell.x + big * 0.66, cell.y + big * 0.32, big * 0.11, 0, TAU); ctx.stroke(); }
    }
  }
  ctx.restore();
  if (p.notes <= 0) return;
  // comments in tiny vermilion characters down the rules, and a line beside a passage
  ctx.save(); ctx.fillStyle = red;
  cols.forEach((c, ci) => {
    if (rand(ci * 5.9 + 664) > 0.55 || !c.spans.length) return;
    const [s0, s1] = c.spans[0], n = Math.floor(p.notes * (4 + rand(ci + 665) * 10)), tiny = pitch * 0.13, x = c.cx + pitch / 2 - tiny * 0.7;
    for (let i = 0; i < n && s0 + (i + 1) * tiny * 1.25 < s1; i++) fauxGlyph(ctx, x, s0 + tiny + i * tiny * 1.25, tiny, ci * 37 + i * 3.3, Math.max(1, tiny * 0.11));
    if (rand(ci * 3.7 + 666) < p.notes) ctx.fillRect(c.cx - pitch / 2 + 5, s0 + (s1 - s0) * 0.2, 2.2, (s1 - s0) * 0.18 * (0.4 + p.notes));
  });
  ctx.restore();
}
/**
 * Collectors' seals pressed on the leaf over the years, in vermilion: a square one cut in intaglio (the
 * characters left white), a square one in relief (red characters in a red frame), a round one. They come
 * in one by one as `amt` rises, each over its own stretch, a little faded; painted together, then laid
 * on in multiply, as ink on paper.
 */
function songSeals(ctx, env, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const { w, h } = env, F = openField(env), x = workLike(ctx, "seals"), red = css(SONG.red), at = (a, b) => clamp((amt - a) / (b - a));
  const grid = (cx, cy, s, k, t) => { for (let i = 0; i < 4; i++) fauxGlyph(x, cx + (i % 2 ? -1 : 1) * s * 0.23, cy + (i < 2 ? -1 : 1) * s * 0.23, s * 0.4, k + i * 9.7, t); };
  const seals = [
    { kind: "white", key: "sealWhite", s: 92, cx: w - 102 - 70, cy: (env.logo ? Math.max(150, env.logo.y + env.logo.h + 70) : 150) + rand(671) * 60, r: at(0, 0.4) },   // under the brand logo
    { kind: "red", key: "sealRed", s: 78, cx: 64 + 60 + rand(672) * 40, cy: (F.y0 + F.y1) * 0.5 - 40 + rand(673) * 60, r: at(0.3, 0.7) },
    { kind: "round", key: "sealRound", s: 70, cx: w * (0.56 + rand(674) * 0.1), cy: F.y1 - 70 - rand(675) * 60, r: at(0.6, 1) },
  ];
  for (const [i, q] of seals.entries()) {
    if (q.r <= 0) continue;
    const [cx, cy] = objAt(q.key, q.cx, q.cy, ctx);   // each a scene object
    x.save(); x.globalAlpha = 0.85 * Math.min(1, q.r * 2); x.translate(cx, cy); x.rotate((rand(676 + i) - 0.5) * 0.08);
    const s = q.s * (0.8 + 0.2 * q.r);
    if (q.kind === "white") {
      x.fillStyle = red; x.fillRect(-s / 2, -s / 2, s, s);
      x.globalCompositeOperation = "destination-out"; x.fillStyle = "#000"; grid(0, 0, s, 680 + i * 50, s * 0.06);
    } else if (q.kind === "red") {
      x.strokeStyle = red; x.lineWidth = s * 0.07; x.strokeRect(-s / 2 + s * 0.035, -s / 2 + s * 0.035, s * 0.93, s * 0.93);
      x.fillStyle = red; grid(0, 0, s * 0.92, 690 + i * 50, s * 0.05);
    } else {
      x.strokeStyle = red; x.lineWidth = s * 0.07; x.beginPath(); x.ellipse(0, 0, s * 0.42, s * 0.5, 0, 0, TAU); x.stroke();
      x.fillStyle = red; fauxGlyph(x, 0, -s * 0.17, s * 0.34, 700 + i, s * 0.05); fauxGlyph(x, 0, s * 0.19, s * 0.34, 710 + i, s * 0.05);
    }
    x.restore();
  }
  layDown(ctx, x, 1, "multiply");
}
/**
 * Water stains: a pale brown wash in an uneven round, darker at its tide line, with a fainter ring inside
 * where it dried twice. Up to three, each coming in over its own stretch of `amt`. Multiplied in.
 */
function waterStains(ctx, w, h, amt) {
  const u = Math.min(w, h);
  ctx.save(); ctx.globalCompositeOperation = "multiply"; ctx.lineJoin = "round";
  for (const [k, a0, a1] of [[0, 0, 0.5], [1, 0.3, 0.8], [2, 0.6, 1]]) {
    const r = clamp((amt - a0) / (a1 - a0));
    if (r <= 0) continue;
    const corner = rand(k * 3.1 + 720), cx = corner < 0.5 ? w * (0.1 + rand(k + 721) * 0.8) : (rand(k + 722) > 0.5 ? w * 0.08 : w * 0.92), cy = corner < 0.5 ? (rand(k + 723) > 0.5 ? h * 0.12 : h * 0.88) : h * (0.2 + rand(k + 724) * 0.6);
    const R = u * (0.13 + rand(k * 2.3 + 725) * 0.14) * (0.75 + 0.25 * r), f = [rand(k + 726) * TAU, rand(k + 727) * TAU, rand(k + 728) * TAU];
    const edge = (q) => { ctx.beginPath(); for (let i = 0; i <= 64; i++) { const t = (i / 64) * TAU, rr = R * q * (1 + 0.16 * Math.sin(3 * t + f[0]) + 0.09 * Math.sin(7 * t + f[1]) + 0.04 * Math.sin(15 * t + f[2])); ctx.lineTo(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr * 0.86); } ctx.closePath(); };
    edge(1); ctx.fillStyle = css([196, 150, 92], 0.16 * r); ctx.fill();
    ctx.strokeStyle = css([150, 104, 52], 0.12 * r); ctx.lineWidth = 9; ctx.stroke();
    ctx.strokeStyle = css([132, 88, 40], 0.4 * r); ctx.lineWidth = 2.2; ctx.stroke();
    edge(0.78); ctx.strokeStyle = css([150, 104, 52], 0.2 * r); ctx.lineWidth = 1.6; ctx.stroke();
  }
  ctx.restore();
}
/**
 * Wormholes: small ragged holes through the leaf, dark where the page beneath shows, ringed with
 * brown, some joined into a short tunnel. More of them, one by one, as `amt` rises.
 */
function wormholes(ctx, w, h, amt) {
  const n = amt * 18;
  ctx.save();
  for (let k = 0; k < Math.ceil(n); k++) {
    const a = clamp(n - k), edgeward = rand(k * 2.9 + 730) < 0.6;   // most near the foot and the fore-edge, where the worms come in
    let x = edgeward ? w * (rand(k + 731) > 0.5 ? 0.03 + rand(k + 732) * 0.12 : 0.85 + rand(k + 733) * 0.12) : rand(k + 734) * w, y = edgeward ? h * (0.6 + rand(k + 735) * 0.38) : rand(k + 736) * h;
    let dir = rand(k * 3.3 + 737) * TAU;
    const len = rand(k + 738) < 0.4 ? 3 + Math.floor(rand(k + 739) * 7) : 1;
    for (let j = 0; j < len; j++) {
      const r = 3 + rand(k * 7 + j * 1.9 + 740) * 6;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) { const t = (i / 9) * TAU, rr = r * (0.7 + 0.5 * rand(k * 11 + j * 3 + i * 1.3 + 741)); ctx.lineTo(x + Math.cos(t) * rr, y + Math.sin(t) * rr); }
      ctx.closePath();
      ctx.strokeStyle = css([150, 108, 60], 0.45 * a); ctx.lineWidth = 2.6; ctx.stroke();
      ctx.fillStyle = css([52, 38, 26], 0.92 * a); ctx.fill();
      dir += (rand(k * 5 + j + 742) - 0.5) * 1.4; x += Math.cos(dir) * r * 1.5; y += Math.sin(dir) * r * 1.5;
    }
  }
  ctx.restore();
}
export const songke = {
  id: "songke",
  repaint: (c) => `a woodblock illustration from an old Chinese printed book: black ink lines cut with a knife, flat areas of ink, the ground left as warm paper colour, no shading or colour except perhaps a touch of vermilion; scenery simplified into lines and masses as in Song and Ming book illustrations.`,
  about: { zh: "一页宋版古籍：宣纸底色、竖排的宋体标题、朱砂印章样式的角标、粗细双线的版框和界栏，右侧是带鱼尾的版心；界栏里可以排上正文大字和双行小注，加朱笔圈点、旁批和历代藏书印；岁月痕迹有刷印不匀、水渍、虫蛀和霉斑；图形像木刻版画；自带平直的版式。古雅、沉静、有书卷气——适合历史、国学、读书、传统手艺与节气。", en: "A leaf from a Song-dynasty printed book: paper ground, a serif title set in vertical columns, the corner tag as a vermilion seal, a thick-and-thin border and ruled columns, a centre column with fishtails at the right edge; the columns can hold the page's text, large characters and double lines of small notes, with vermilion marks and collectors' seals; the years show as uneven printing, water stains, wormholes and foxing; objects like woodcuts; flat layouts of its own. Classical, calm, bookish — for history, classics, reading, traditional crafts, the seasons." },
  name: { zh: "宋版刻本", en: "Woodblock book" },
  oneTheme: true,
  logoInset: 128,   // the brand logo stands left of the centre column (see frame)
  seeded: true,
  scene: { sealWhite: { zh: "藏书印（白文方印）", en: "Seal (white, square)" }, sealRed: { zh: "藏书印（朱文方印）", en: "Seal (red, square)" }, sealRound: { zh: "藏书印（圆印）", en: "Seal (round)" } },
  params: [
    { key: "rules", min: 0, max: 1, step: 0.05, def: 0.8, name: { zh: "界栏", en: "Column rules" } },
    { key: "text", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "正文与小注", en: "Text and notes" } },
    { key: "notes", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "朱批圈点", en: "Vermilion marks" } },
    { key: "seals", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "藏书印", en: "Collectors' seals" } },
    { key: "wear", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "刷印不匀", en: "Uneven printing" } },
    { key: "aged", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "做旧", en: "Age" } },
    { key: "stain", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "水渍", en: "Water stains" } },
    { key: "worm", min: 0, max: 1, step: 0.05, def: 0.1, name: { zh: "虫蛀", en: "Wormholes" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "vertical", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "标题竖排", en: "Set the title vertically" } },
  ],
  titleFont: (f) => f.serif,
  faces: (f) => ({ cn: f.serif, en: f.serif }),   // everything on the page is cut in the one face
  /** Level bands: a page has no slanted panels. */
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.25, side: 0.32, strip: 0.14 }),
  theme: (base) => ({ ...base, field: css(SONG.paper), text: css(SONG.ink), dim: css(SONG.ink, 0.6), titleFill: css(SONG.ink), titleInk: css(SONG.paper), grid: () => css(SONG.red, 0.24) }),
  background(ctx, env, L, p) {
    const { w, h } = env;
    if (L.ground !== false) { ctx.fillStyle = css(SONG.paper); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {   // as a rubbing would show it: grey, pressed into the paper
      env.drawPhoto(1); wash(ctx, w, h, "multiply", SONG.paper, 1); wash(ctx, w, h, "screen", [60, 48, 36], 0.35);
    }
    const pitch = Math.max(90, Math.round(Math.min(w, h) / 9));
    if (L.grid && p.rules > 0) {   // the ruled columns of the block, right to left, printing darker as the slider goes up
      ctx.fillStyle = css(SONG.ink, 0.6 * Math.pow(p.rules, 0.7));
      for (let x = w - 64 - pitch; x > 64; x -= pitch) ctx.fillRect(x, 58, 1 + p.rules, h - 116);
    }
    if (L.grid || L.fill) { songText(ctx, env, p, pitch); songSeals(ctx, env, p.seals); }
    return true;
  },
  /** Ruled paper in vermilion, as a fair copy is written on: the block's columns, right to left, a narrow gap between them, each cut into squares. */
  gridLines(ctx, env, color) {
    const { w, h } = env, pitch = Math.max(90, Math.round(Math.min(w, h) / 9)), top = 58, bot = h - 58, gap = 5, cols = [];
    for (let x = w - 64; x - pitch >= 64 - 1; x -= pitch) cols.push([x - pitch + gap, x - gap]);
    gridPen(ctx, color); ctx.beginPath();
    for (const [a, b] of cols) {
      ctx.moveTo(a, top); ctx.lineTo(a, bot); ctx.moveTo(b, top); ctx.lineTo(b, bot);
      for (let y = top; y <= bot + 0.5; y += b - a) { ctx.moveTo(a, y); ctx.lineTo(b, y); }
    }
    ctx.stroke(); ctx.restore();
  },
  accent: {
    fill: (C) => css(mix(SONG.paper, worn(C), 0.78)), tone: () => "rgba(0,0,0,0)", toneScale: 0,
    edge(ctx, run, nx, ny) { ctx.lineCap = "butt"; ctx.strokeStyle = css(SONG.ink); ctx.lineWidth = 5; run(0, 0); ctx.lineWidth = 1.5; run(nx * 10, ny * 10); },   // a thick-and-thin border, as round the block
  },
  /**
   * The title set as a book sets it, in columns, top to bottom, the first column on the right (Set the title
   * vertically): each typed line a column, the subtitle a column of its own left of the title's, smaller, so
   * read after it (see subtitleColumns in title.js). This is the look's own default: a title or subtitle the
   * user sets vertical (its `vertical`, see columned) is in columns whatever the switch says.
   */
  columns: (p) => !!p.vertical,
  /**
   * Where the title's columns stand: columns want height, where a line wants width, so the title takes the
   * field down to the colour band (or the foot of the page), and stands clear of the seal, which keeps its corner.
   */
  columnBox: (ctx, env, box) => songBox(ctx, env, box),
  /** Lettering (the title, in columns or not, text layers): plain ink, highlighted words in vermilion. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || SONG.red : o.fill || SONG.ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates
    ? mapped(ctx, { fill: { ink: SONG.ink, light: SONG.paper, colour: worn }, stroke: { ink: SONG.ink, light: SONG.paper } })
    : mapped(ctx, { fill: { ink: SONG.ink, light: SONG.paper, mid: mix(SONG.paper, SONG.ink, 0.16), dark: mix(SONG.paper, SONG.ink, 0.86), colour: worn }, stroke: { ink: SONG.ink, light: SONG.paper }, line: 0.8 })),
  sticker: painters({ line: SONG.ink, lineScale: 0.8, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "ink" ? css(SONG.ink, c[3]) : role(c) === "colour" ? css(worn(c), c[3]) : css(SONG.paper, c[3]); } }),
  /** The corner tag: a seal, cut in relief and pressed in vermilion — a little worn at the edges. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.82;
    ctx.font = `900 ${f}px ${fonts.serif}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 0.9, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(SONG.red); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = css(SONG.paper);
    for (let k = 0; k < 16; k++) { const side = k % 4, t = rand(k * 2.3 + 60), s = 2 + rand(k * 3.1 + 61) * 5; ctx.fillRect(side < 2 ? x + t * w : side === 2 ? x - 1 : x + w - s + 1, side === 0 ? top - 1 : side === 1 ? top + h - s + 1 : top + t * h, side < 2 ? s * 2 : s, side < 2 ? s : s * 2); }
    ctx.strokeStyle = css(SONG.paper); ctx.lineWidth = 2.5; ctx.strokeRect(x + 7, top + 7, w - 14, h - 14);
    ctx.fillStyle = ink || css(SONG.paper); spaced(ctx, str, x + f * 0.45, top + h * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The plate under a text layer: a ruled label, as pasted on a book's cover. */
  plate(ctx, x, y, w, h, colour) {
    ctx.fillStyle = colour; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = css(SONG.ink); ctx.lineWidth = 5; ctx.strokeRect(x, y, w, h); ctx.lineWidth = 1.5; ctx.strokeRect(x + 9, y + 9, w - 18, h - 18);
  },
  /**
   * The frame layer: the border of the block (a thick rule with a thin one inside it), and at the
   * right edge the block's centre column, with its fishtails, the book's name and the leaf number.
   */
  frame(ctx, env, p) {
    const { w, h } = env, ink = css(SONG.ink);
    ctx.strokeStyle = ink; ctx.lineWidth = 7; ctx.strokeRect(34, 34, w - 68, h - 68);
    ctx.lineWidth = 1.5; ctx.strokeRect(46, 46, w - 92, h - 92);
    if (p.rules <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, p.rules / 0.6);   // the centre column comes in with the rules, full by 0.6
    const cw = 56, x0 = w - 46 - cw, tail = (y, dir) => { ctx.fillStyle = ink; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + cw, y); ctx.lineTo(x0 + cw, y + dir * 46); ctx.lineTo(x0 + cw / 2, y + dir * 24); ctx.lineTo(x0, y + dir * 46); ctx.closePath(); ctx.fill(); };
    ctx.fillStyle = css(SONG.paper); ctx.fillRect(x0, 46, cw, h - 92);
    ctx.fillStyle = ink; ctx.fillRect(x0, 46, 1.5, h - 92);
    tail(h * 0.2, 1); tail(h * 0.8, -1);
    ctx.fillRect(x0, h * 0.2 - 6, cw, 3); ctx.fillRect(x0, h * 0.8 + 3, cw, 3);
    const P = env.o.profile, name = [...(P.brand.name || "")].slice(0, 12);
    ctx.font = `700 24px ${fonts.serif}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = ink;
    const room = h * 0.6 - 150, step = Math.min(30, room / Math.max(1, name.length));
    name.forEach((ch, k) => ctx.fillText(ch, x0 + cw / 2, h * 0.2 + 76 + k * step));
    ctx.font = `700 22px ${fonts.serif}`;
    [...numeral(env.o.catIndex + 1)].forEach((ch, k) => ctx.fillText(ch, x0 + cw / 2, h * 0.8 - 96 + k * 26));
    ctx.restore();
  },
  /** Ink that took unevenly, water stains with their tide lines, wormholes, foxing and a darkened edge, the paper's grain. */
  post(ctx, w, h, C, p, unit = 1) {
    wear(ctx, w, h, SONG.paper, p.wear * 0.9);
    if (p.stain > 0) waterStains(ctx, w, h, p.stain);
    if (p.worm > 0) wormholes(ctx, w, h, p.worm);
    if (p.aged > 0) {   // foxing: a few faint brown blooms, and the sheet gone darker toward its edges
      for (let k = 0; k < Math.round(9 * p.aged); k++) {
        const x = rand(k * 4.1 + 70) * w, y = rand(k * 5.3 + 71) * h, r = (40 + rand(k * 6.7 + 72) * 170), g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, css([120, 82, 40], 0.16 * p.aged)); g.addColorStop(1, css([120, 82, 40], 0));
        ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      v.addColorStop(0, css([110, 80, 44], 0)); v.addColorStop(1, css([110, 80, 44], 0.34 * p.aged));
      ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    }
    grain(ctx, p.grain * 0.85, unit, true);
  },
  prompt: `Woodcut illustrations from an old Chinese printed book — cut in a block, printed in black — that read at a glance:
- drawn in LINE: confident black contours and a few short hatching or pattern lines ("detail") describe the form; filled black areas are few and deliberate (hair, a roof, a shadow);
- flat and frontal or in simple three-quarter view, with the plain, slightly stiff charm of a carved block; no realism, no perspective, no gradients;
- the paper is the main colour of every sticker: use "white" for bodies, "ink" for solids and lines, and the main colour only for one small printed accent (a seal, a sash, a flower);
- the app adds the black outline: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a woodblock illustration would show them: a few boxes and cylinders in plain, slightly formal proportions; no realism, no fine detail.
- the renderer prints faces as paper and black with a black line: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" is solid black ink, and "main" a muted printed colour — use it for one part only.`,
};
songke.elementFx = [
  { key: "wear", name: { zh: "刷印不匀", en: "Uneven printing" }, for: FX_ALL, stage: "over",
    /** Where the block took too little ink: patches and specks through which the paper shows. */
    paint(x, B, a, E) { knockWorn(x, B, a, E, 1.6); } },
  { key: "seal", name: { zh: "朱砂印色", en: "Seal-red ink" }, for: FX_ALL, stage: "fill",
    /** The layer printed in the cinnabar of a seal, the ink a little worn. */
    paint(x, B, a, E) { flatFx(() => css(SONG.red))(x, B, a, E); knockWorn(x, B, a * 0.55, E, 0.7); } },
];
