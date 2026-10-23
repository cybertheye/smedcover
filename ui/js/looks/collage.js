// collage: paper, scissors, glue
// The mixed-media collage poster: a black-and-white figure cut from a magazine, a big disc of colour
// behind it, pieces of coloured paper torn by hand, strips of newsprint, patches of halftone, a
// starburst, a scribble in marker, tape, a ticket and a barcode; every piece lifts a little off the
// sheet. Loud, layered, handmade.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, besideLogo, canPaint, clamp, crumple, css, cutBands, dark, dotFill, dotScreen, every, glowBehind, grain, greeked, gridPath, gridPen, inPixels, lum, mapped, mix, objAt, onLayer, openField, pad2, painters, rand, region, ringsBehind, shapeOf, snap, starburst, tonesFx, upright } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";

const CL = { paper: [238, 232, 218], night: [26, 24, 28], ink: [20, 20, 22], white: [250, 248, 242], red: [226, 52, 42], mustard: [244, 180, 30], teal: [32, 150, 142], pink: [244, 130, 172] };
const clGround = () => (dark ? CL.night : CL.paper), clInk = () => (dark ? CL.white : CL.ink);
/** The paper colours a piece is cut from: the channel colour first, then the collage's own. */
const clColours = (C) => [C, CL.red, CL.mustard, CL.ink, CL.teal, CL.pink, CL.white];
/**
 * A piece of paper torn by hand, w × h, centred on (cx, cy) and turned by `a`: every edge wanders a
 * little; a margin of bare white fibre shows where it was torn; it casts a soft shadow (`lift`).
 * `inside(ctx)`, if given, paints on the piece in its own frame (newsprint, say).
 */
function tornPiece(ctx, cx, cy, w, h, a, colour, k, lift, inside) {
  const n = 9, jag = Math.min(w, h) * 0.07, pts = [];
  const side = (x0, y0, x1, y1, s) => { for (let i = 0; i < n; i++) { const t = i / n, o = (rand(k + s * 17.3 + i * 2.1) - 0.5) * jag; pts.push([x0 + (x1 - x0) * t + (y1 !== y0 ? o : 0), y0 + (y1 - y0) * t + (x1 !== x0 ? o : 0)]); } };
  side(-w / 2, -h / 2, w / 2, -h / 2, 1); side(w / 2, -h / 2, w / 2, h / 2, 2); side(w / 2, h / 2, -w / 2, h / 2, 3); side(-w / 2, h / 2, -w / 2, -h / 2, 4);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
  shapeOf(ctx, pts);
  if (lift > 0) { ctx.shadowColor = `rgba(0,0,0,${0.32 * lift})`; ctx.shadowBlur = 6 + 12 * lift; ctx.shadowOffsetX = 3 * lift; ctx.shadowOffsetY = 6 * lift; }
  ctx.strokeStyle = css(CL.white); ctx.lineWidth = Math.max(3, Math.min(w, h) * 0.035); ctx.lineJoin = "round"; ctx.stroke();
  ctx.shadowColor = "rgba(0,0,0,0)"; ctx.fillStyle = css(colour); ctx.fill();
  if (inside) { ctx.save(); ctx.clip(); inside(ctx); ctx.restore(); }
  ctx.restore();
}
/** Where the collage gathers: round the channel graphic if it stands in the open field, else toward the field's far side. */
function clCentre(env) {
  const F = openField(env), fw = F.x1 - F.x0, A = env.G && env.G.art;
  return { F, cx: A && A.x > F.x0 + fw * 0.25 && A.x < F.x1 ? A.x : F.x0 + fw * 0.68, cy: A && A.y > F.y0 && A.y < F.y1 ? A.y : (F.y0 + F.y1) * 0.55 };
}
/**
 * The pieces of the collage, behind the title and the graphic: the disc, strips of newsprint, torn
 * paper, halftone patches, the starburst and the scribble — each coming in over its own slider, and
 * "more" meaning more pieces, one by one.
 */
function clPieces(ctx, env, p, onPhoto) {
  const { w, h, C } = env, u = Math.min(w, h), { F, cx, cy } = clCentre(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, cols = clColours(C);
  if (p.disc > 0) {   // the big disc of colour behind the figure; over a photo it tints what it covers
    ctx.save(); if (onPhoto) ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = css(onPhoto ? mix([255, 255, 255], C, 0.85) : C, Math.min(1, p.disc * 3));
    const [dx, dy] = objAt("disc", cx + fw * 0.02, cy - fh * 0.06, ctx);   // each of these three a scene object
    ctx.beginPath(); ctx.arc(dx, dy, fh * (0.22 + 0.3 * p.disc), 0, TAU); ctx.fill(); ctx.restore();
  }
  if (p.burst > 0) { const [bx, by] = objAt("burst", cx - fw * 0.16, cy - fh * 0.28, ctx); starburst(ctx, bx, by, fh * (0.08 + 0.2 * p.burst), 11, mix(CL.mustard, [255, 120, 30], 0.35), 960); }
  for (let k = 0, n = p.strips * 6; k < Math.ceil(n); k++) {   // strips of newsprint, torn across
    const a = clamp(n - k), sw = fw * (0.3 + rand(k * 2.3 + 961) * 0.4), sh = u * (0.035 + rand(k * 3.1 + 962) * 0.04);
    ctx.save(); ctx.globalAlpha = a;
    tornPiece(ctx, F.x0 + fw * (0.25 + rand(k * 4.7 + 963) * 0.6), F.y0 + fh * (0.12 + rand(k * 5.3 + 964) * 0.78), sw, sh, (rand(k * 6.1 + 965) - 0.5) * 0.5, k % 3 === 2 ? CL.mustard : CL.white, k * 7 + 966, p.lift,
      (x) => greeked(x, -sw / 2 + sh * 0.25, -sh / 2 + sh * 0.2, sw - sh * 0.5, 3, sh * 0.24, css(CL.ink, 0.55), k * 11 + 967));
    ctx.restore();
  }
  for (let k = 0, n = p.torn * 10; k < Math.ceil(n); k++) {   // torn pieces of coloured paper, round the figure
    const a = clamp(n - k), r = rand(k * 1.9 + 970), pw = u * (0.07 + r * 0.17), ph = pw * (0.55 + rand(k * 2.9 + 971) * 0.9);
    const ang = rand(k * 3.7 + 972) * TAU, d = fh * (0.18 + rand(k * 4.3 + 973) * 0.36);
    ctx.save(); ctx.globalAlpha = a;
    tornPiece(ctx, clamp(cx + Math.cos(ang) * d * 1.4, F.x0 + pw * 0.3, F.x1 - pw * 0.3), clamp(cy + Math.sin(ang) * d, F.y0 + ph * 0.3, F.y1), pw, ph, (rand(k * 5.9 + 974) - 0.5) * 1.2, cols[k % cols.length], k * 9 + 975, p.lift);
    ctx.restore();
  }
  for (let k = 0, n = p.halftone * 5; k < Math.ceil(n); k++) {   // patches of a coarse halftone: discs and slabs
    const a = clamp(n - k), r = u * (0.05 + rand(k * 2.1 + 980) * 0.09), x = F.x0 + fw * (0.15 + rand(k * 3.3 + 981) * 0.8), y = F.y0 + fh * (0.1 + rand(k * 4.1 + 982) * 0.8);
    ctx.save(); ctx.beginPath(); k % 2 ? ctx.rect(x - r, y - r * 0.6, r * 2, r * 1.2) : ctx.arc(x, y, r, 0, TAU); ctx.clip();
    dotScreen(ctx, w, h, k % 3 === 1 ? CL.red : dark ? CL.white : CL.ink, 9 + (k % 3) * 3, 0.85 * a, "source-over"); ctx.restore();
  }
  if (p.scribble > 0) {   // a loop of marker, drawn further the higher the slider
    const [sx, sy] = objAt("scribble", cx - fw * 0.05, cy + fh * 0.12, ctx), R = fh * 0.16, ph = rand(990) * TAU, len = 40 * p.scribble;
    ctx.save(); ctx.strokeStyle = css(dark ? CL.white : CL.ink, 0.85); ctx.lineWidth = Math.max(2.5, u * 0.004); ctx.lineCap = ctx.lineJoin = "round"; ctx.beginPath();
    for (let t = 0; t <= len; t += 0.08) { const x = sx + R * (Math.sin(t * 0.9 + ph) * 1.6 + Math.sin(t * 5.3) * 0.32), y = sy + R * (Math.cos(t * 1.27 + ph) * 0.7 + Math.cos(t * 5.1) * 0.3); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  }
}
/** A barcode: bars of uneven width, a line of digits under them. */
function barcode(ctx, x, y, w, h, colour, k) {
  ctx.fillStyle = css(colour);
  for (let at = x, i = 0; at < x + w; i++) { const bw = 1 + Math.floor(rand(k + i * 1.7) * 4), gap = 1 + Math.floor(rand(k + i * 2.3) * 3); if (at + bw > x + w) break; ctx.fillRect(at, y, bw, h * 0.78); at += bw + gap; }
  ctx.font = `600 ${Math.round(h * 0.17)}px ${fonts.mono}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  ctx.fillText(String(Math.floor(rand(k + 99) * 9e12)).padStart(13, "4"), x, y + h);
}
export const collage = {
  id: "collage",
  repaint: (c) => `a mixed-media paper collage made from the photograph: the subject cut out in black and white like a magazine clipping, set on torn pieces of coloured paper (${c}, vermilion, mustard, teal), a big disc of colour behind, halftone dots, strips of newsprint, tape; tactile and handmade; no text.`,
  about: { zh: "拼贴艺术：剪报式的混合媒介拼贴——黑白人物像从杂志上剪下来，身后一个大色圆（频道色），四周是手撕的彩色纸片、一条条旧报纸、粗网点色块、爆炸星、马克笔涂鸦，再用胶带、票根和条形码钉住；每一片纸都微微翘起、投下影子，标题贴在一条条纸签上。热闹、有手作感、有态度——适合设计、潮流、艺术、观点、生活方式和年轻向内容。可选米白纸底或黑纸底。", en: "Collage: mixed media as a scrapbook would have it — a black-and-white figure cut from a magazine, a big disc of the channel colour behind, pieces of coloured paper torn by hand, strips of old newsprint, patches of coarse halftone, a starburst, a scribble in marker, held down with tape, a ticket stub and a barcode; every piece lifts a little and casts a shadow, and the title is pasted on paper labels. Loud, handmade, opinionated — for design, fashion, art, opinion, lifestyle and youth content. Cream or black paper." },
  name: { zh: "拼贴艺术", en: "Collage" },
  seeded: true,
  scene: { disc: { zh: "大色圆", en: "Colour disc" }, burst: { zh: "爆炸星", en: "Starburst" }, scribble: { zh: "马克笔涂鸦", en: "Marker scribble" } },
  params: [
    { key: "disc", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "大色圆", en: "Disc of colour" } },
    { key: "torn", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "撕纸碎片", en: "Torn paper" } },
    { key: "strips", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "旧报纸条", en: "Newsprint strips" } },
    { key: "halftone", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "网点色块", en: "Halftone patches" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "爆炸星", en: "Starburst" } },
    { key: "scribble", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "马克笔涂鸦", en: "Marker scribble" } },
    { key: "lift", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "纸片立体感", en: "Paper lift" } },
    { key: "tape", min: 0, max: 1, step: 0.05, def: 0.4, name: { zh: "胶带", en: "Tape" } },
    { key: "labels", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "票根与条码", en: "Ticket and barcode" } },
    { key: "paper", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "纸张质感", en: "Paper texture" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "slices", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "照片撕条", en: "Photo torn in strips" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  theme: (base) => ({ ...base, field: css(clGround()), text: css(clInk()), dim: css(clInk(), 0.6), titleFill: css(clInk()), titleInk: css(clGround()), grid: () => css(clInk(), 0.1) }),
  /**
   * The sheet and the pieces pasted on it (see clPieces). A photo goes black and white; one filling the
   * canvas is torn into horizontal strips, each set back a little off, with white fibre along the tears,
   * and the pieces go on over it.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h);
    if (L.ground !== false) { ctx.fillStyle = css(clGround()); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (!L.fill) return true;
      if (p.slices > 0 && canPaint(ctx)) {
        const src = snap(ctx, "clSnap"), m = ctx.getTransform(), n = Math.round(3 + 6 * p.slices), edges = [0];
        for (let i = 1; i < n; i++) edges.push(h * ((i + (rand(i * 2.7 + 1000) - 0.5) * 0.6) / n));
        edges.push(h);
        ctx.fillStyle = css(clGround()); ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < n; i++) {
          const y0 = edges[i], y1 = edges[i + 1], dx = (rand(i * 3.9 + 1001) - 0.5) * u * 0.1 * p.slices, top = [], bot = [];
          for (let x = -20; x <= w + 20; x += 24) { top.push([x, y0 + (i ? (rand(i * 31 + x * 0.07) - 0.5) * 7 : -10)]); bot.push([x, y1 + (i < n - 1 ? (rand((i + 1) * 31 + x * 0.07) - 0.5) * 7 : 10)]); }
          ctx.save(); shapeOf(ctx, [...top, ...bot.reverse()]); ctx.clip();
          inPixels(ctx, () => ctx.drawImage(src, dx * m.a, 0));
          ctx.restore();
          if (i) { ctx.strokeStyle = css(CL.white, 0.9); ctx.lineWidth = 3 + 3 * p.slices; ctx.beginPath(); top.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
        }
      }
      clPieces(ctx, env, { ...p, torn: p.torn * 0.6, strips: p.strips * 0.5 }, true);
      return true;
    }
    if (!L.grid) return true;
    clPieces(ctx, env, p, false);
    return true;
  },
  /** A cutting mat under the sheet: a grid every 24, firmer every 96, and the angle guides from its corner. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fine = (n) => every(24, n, 24).filter((v) => v % 96);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.45; gridPath(ctx, fine(w), fine(h), 0, 0, w, h);
    ctx.globalAlpha = 1; gridPath(ctx, every(96, w, 96), every(96, h, 96), 0, 0, w, h);
    ctx.beginPath(); for (const a of [30, 45, 60]) { const t = (a * Math.PI) / 180; ctx.moveTo(0, h); ctx.lineTo(Math.cos(t) * w * 2, h - Math.sin(t) * w * 2); } ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  },
  accent: { fill: (C) => css(C), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.lineJoin = "round"; ctx.strokeStyle = css(CL.white); ctx.lineWidth = 9; run(0, 0); } },   // a cut piece of paper with its white edge
  /**
   * Heavy condensed capitals pasted on paper labels (the shadow slider): each run on a strip of cream
   * paper, a little askew, lifting off the sheet; highlighted words on a strip of the channel colour.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, C = o.C || CL.red, hi = o.hi || C, label = Math.min(1, o.shadowAmt), ink = o.fill || (label > 0.3 ? CL.ink : clInk());
    if (label > 0) pass((a, x) => {
      if (a.first === false) return;   // one strip a run, under all its pieces
      const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width }, tw = r.x1 - r.x0, t = (rand(o.seed + r.x0 * 0.013) - 0.5) * 0.07, col = a.hi ? hi : CL.white;
      ctx.save(); ctx.globalAlpha = label; ctx.translate(r.x0 + tw / 2, -fs * 0.36); ctx.rotate(t);
      ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = fs * 0.06; ctx.shadowOffsetX = fs * 0.02; ctx.shadowOffsetY = fs * 0.04;
      ctx.fillStyle = css(col); ctx.fillRect(-tw / 2 - fs * 0.1, -fs * 0.58, tw + fs * 0.2, fs * 1.08); ctx.restore();
    });
    pass((a, x) => { ctx.fillStyle = css(a.hi ? (label > 0.3 ? (lum(hi) > 0.55 ? CL.ink : CL.white) : hi) : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: CL.ink, light: CL.white }, stroke: { ink: CL.ink, light: CL.white }, line: 0.8 })),
  sticker: painters({ line: CL.white, lineScale: 1.2, shadow(ctx, draw) { ctx.save(); ctx.translate(4, 7); draw("rgba(0,0,0,0.28)"); ctx.restore(); } }),   // cut out with a white margin, lifting off the sheet
  /** The corner tag: a black ticket with notches cut in its ends. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.68;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 1.6, h = f * 1.5, top = y + (fs * 1.34 - h);
    ctx.save(); ctx.translate(x + w / 2, top + h / 2); ctx.rotate(-0.03);
    ctx.fillStyle = css(CL.ink); ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = css(clGround()); for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc((s * w) / 2, 0, h * 0.16, 0, TAU); ctx.fill(); }
    ctx.fillStyle = ink || css(CL.white); spaced(ctx, str, -w / 2 + f * 0.8, f * 0.36, 3); ctx.restore();
    return { x: x - 6, y: top - 6, w: w + 12, h: h + 12 };
  },
  /** The frame layer: tape holding the sheet down, a ticket stub and a barcode pasted on. */
  frame(ctx, env, p) {
    const { w, h, C } = env, u = Math.min(w, h), { F } = clCentre(env);
    for (let k = 0, n = p.tape * 4; k < Math.ceil(n); k++) {   // tape: translucent, its ends torn
      const spots = [[besideLogo(env, F.x1 - u * 0.04) - u * 0.1, F.y0 + u * 0.08, 0.6], [F.x0 + u * 0.1, F.y1 - u * 0.12, -0.5], [F.x1 - u * 0.08, F.y1 - u * 0.2, -0.75], [w * 0.5, F.y0 + u * 0.04, 0.08]];
      const [tx, ty, a] = spots[k], tw = u * 0.2, th = u * 0.055;
      ctx.save(); ctx.globalAlpha = clamp(n - k); ctx.translate(tx, ty); ctx.rotate(a);
      const pts = []; for (let i = 0; i <= 6; i++) pts.push([-tw / 2 + (rand(k * 13 + i) - 0.5) * 6, -th / 2 + (th * i) / 6]);
      for (let i = 6; i >= 0; i--) pts.push([tw / 2 + (rand(k * 17 + i) - 0.5) * 6, -th / 2 + (th * i) / 6]);
      shapeOf(ctx, pts); ctx.fillStyle = "rgba(240,232,206,0.62)"; ctx.fill(); ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
    }
    if (p.labels <= 0) return;
    const a = Math.min(1, p.labels * 2), P = env.o.profile, i = env.o.catIndex;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(F.x1 - u * 0.2, F.y1 - u * 0.1); ctx.rotate(-0.06);   // the barcode on a white label
    ctx.fillStyle = css(CL.white); ctx.fillRect(-10, -10, u * 0.16 + 20, u * 0.06 + 22);
    barcode(ctx, 0, 0, u * 0.16, u * 0.06, CL.ink, 1010 + i); ctx.restore();
    if (p.labels > 0.4) {   // and the ticket stub
      ctx.save(); ctx.globalAlpha = Math.min(1, (p.labels - 0.4) * 3); ctx.translate(F.x1 - u * 0.5, F.y0 + u * 0.11); ctx.rotate(0.05);   // clear of the brand line
      ctx.fillStyle = css(mix(C, CL.white, 0.15)); ctx.fillRect(0, 0, u * 0.17, u * 0.07);
      ctx.fillStyle = css(lum(C) > 0.55 ? CL.ink : CL.white); ctx.font = `700 ${u * 0.022}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      ctx.fillText(`ADMIT ONE · No.${pad2(i + 1)}`, u * 0.012, u * 0.03); ctx.font = `600 ${u * 0.012}px ${fonts.mono}`; ctx.fillText((P.brand.name || "").toUpperCase().slice(0, 24), u * 0.012, u * 0.055);
      ctx.setLineDash([3, 4]); ctx.strokeStyle = ctx.fillStyle; ctx.beginPath(); ctx.moveTo(u * 0.135, 4); ctx.lineTo(u * 0.135, u * 0.07 - 4); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.3)"; ctx.shadowBlur = 10 * unit; ctx.shadowOffsetX = 4 * unit; ctx.shadowOffsetY = 7 * unit; },
  /** The sheet itself: crumpled a little, its grain, and wear. */
  post(ctx, w, h, C, p, unit = 1) {
    crumple(ctx, w, h, p.paper * 0.8);
    grain(ctx, 0.2 + p.paper * 0.5, unit, !dark);
  },
  prompt: `Cut-outs for a mixed-media paper collage — bold, playful and a little rough — that read at a glance:
- one clear, characterful object per sticker (a hand, an eye, lips, a flower, a star, a camera, a cassette, a coffee cup), simple and graphic; no realism, no perspective, no fine detail;
- flat colour only: the main colour with "ink", "white", "red" or "yellow" as partners; patterns in stripes or dots are welcome;
- the app cuts every sticker out with a white margin and a soft shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as cut-outs for a paper collage: a few boxes and cylinders, bold and simple — a radio, a camera, a suitcase, a lamp; no realism, no fine detail.
- the renderer paints faces in flat tones with a dark line: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" the channel colour — use it for one to three parts.`,
};
collage.elementFx = [
  { key: "lift", name: { zh: "纸片立体感", en: "Paper lift" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 20 * k, t: 20 * k, r: 30 * k, b: 34 * k }),
    /** The layer as a piece of paper cut out with a white margin, lifting off the page on a soft shadow. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), r = (3 + 8 * a) * E.k;
      x.save(); x.globalAlpha = Math.min(1, a * 1.6); ringsBehind(x, B, src, [[CL.white, r * 0.5], [CL.white, r]]); x.restore();
      glowBehind(x, B, src, (4 + 8 * a) * E.k + r, 0.55 * Math.min(1, a * 1.5), [0, 0, 0], (3 + 4 * a) * E.k, (5 + 6 * a) * E.k);
    } },
  { key: "tape", name: { zh: "胶带", en: "Tape" }, for: FX_ALL, stage: "over", reach: (B) => ({ l: B.w * 0.1, t: B.h * 0.15, r: B.w * 0.1, b: B.h * 0.15 }),
    /** Strips of translucent tape across two corners, holding the layer down. */
    paint(x, B, a, E) {
      const w = Math.min(B.w, B.h) * (0.35 + 0.25 * a), h = w * 0.32;
      x.save(); x.globalAlpha = Math.min(1, a * 3);
      for (const [cx, cy, t] of [[B.x0 + B.w * 0.06, B.y0 + B.h * 0.04, -0.6], [B.x1 - B.w * 0.06, B.y1 - B.h * 0.04, -0.6]]) {
        x.save(); x.translate(cx, cy); x.rotate(t + (E.R(cx) - 0.5) * 0.3); x.fillStyle = "rgba(240,232,206,0.62)"; x.fillRect(-w / 2, -h / 2, w, h);
        x.fillStyle = "rgba(255,255,255,0.25)"; x.fillRect(-w / 2, -h / 2, w, h * 0.3);
        x.fillStyle = "rgba(0,0,0,0.06)"; for (let i = 0; i < 8; i++) x.fillRect(-w / 2 + (i / 8) * w, -h / 2, 1, h); x.restore();
      }
      x.restore();
    } },
  { key: "halftone", name: { zh: "网点色块", en: "Halftone patch" }, for: FX_ALL, stage: "over",
    /** A disc of halftone in a collage colour laid over part of the layer, larger as it rises. */
    paint(x, B, a, E) {
      const R = Math.max(B.w, B.h) * (0.18 + 0.4 * a), cx = B.w * (0.3 + 0.4 * E.R(111)), cy = B.h * (0.3 + 0.4 * E.R(112)), col = [CL.red, CL.teal, CL.mustard, CL.pink][Math.floor(E.R(113) * 4)];
      onLayer(x, B, region(x, B, "fxA"), "multiply", 1, (g) => { g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip(); g.fillStyle = dotFill(g, col, 9 * E.k, 9 * E.k * 0.36, 15); g.fillRect(0, 0, B.w, B.h); });
    } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** The photo as a black-and-white cutting from a magazine. */
    paint: tonesFx(() => [[0, CL.ink], [0.55, [140, 138, 132]], [1, CL.white]], 0.1) },
  { key: "strips", name: { zh: "照片撕条", en: "Photo torn in strips" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.06, r: B.w * 0.06 }),
    /** The photo torn across into strips, each slid a little, white paper showing along the torn edges. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), n = 4, cuts = Array.from({ length: n + 1 }, (_, i) => clamp((i + (i % n ? (E.R(i * 2.3 + 117) - 0.5) * 0.4 : 0)) / n)), d = B.w * 0.045 * a, gap = (1 + 7 * a) * E.k;
      cutBands(x, B, src, cuts, (i) => (i % 2 ? d : -d * 0.5));
      x.save(); x.fillStyle = css(CL.white);
      for (let i = 1; i < n; i++) { const y = B.y0 + cuts[i] * B.h; x.beginPath(); x.moveTo(B.x0 - d, y - gap / 2); for (let t = 0; t <= 1.001; t += 0.02) x.lineTo(B.x0 - d + (B.w + 2 * d) * t, y - gap / 2 + (E.R(i * 31 + t * 50) - 0.5) * gap); for (let t = 1; t >= -0.001; t -= 0.02) x.lineTo(B.x0 - d + (B.w + 2 * d) * t, y + gap / 2 + (E.R(i * 37 + t * 50 + 7) - 0.5) * gap); x.closePath(); x.fill(); }
      x.restore();
    } },
];
