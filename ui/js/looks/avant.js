// avant-garde image: today's design-studio poster
// The posters design studios and fashion labels post today: a black-and-white photograph (or the
// channel graphic as a figure) worked on as a designer works on it in the computer — a smear of motion,
// a glow, the picture out of focus with one sharp frame of focus, a patch gone to pixels, a panel of
// fluted glass, a band where colour comes through; hairline grid lines with small markers and
// interface labels; a big tight grotesque; the channel colour as the only accent.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, WORK, avGlow, blurred, boost, canPaint, clamp, css, dark, every, fast, fxCanvas, glowBehind, grain, graphicShape, greeked, grey, gridPath, gridPen, inPixels, mapped, mix, objAt, openField, pad2, padded, painters, parseColour, placeShape, rand, region, role, snap, softCopy, softened, titleArea, tonesFx, trail, upright, wherePainted } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const AV = { paper: [226, 226, 223], night: [11, 11, 13], ink: [14, 14, 16], white: [238, 238, 234] };
const avGround = () => (dark ? AV.night : AV.paper), avInk = () => (dark ? AV.white : AV.ink);
/** The figure without a photo: the channel graphic, large, standing in the open field, soft at its edge; a mid grey on either ground, so the lettering over it still reads. */
function avFigure(ctx, env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.55 + 0.5 * p.figure), box = { cx: F.x0 + fw * 0.62, cy: F.y1 - size * 0.46, size };
  const S = p.figure > 0 && canPaint(ctx) && graphicShape(env);
  if (S) [box.cx, box.cy] = objAt("figure", box.cx, box.cy, ctx);   // a scene object: the focus frame, glass and band follow it
  if (S) {
    const col = dark ? [128, 128, 126] : [112, 112, 114];
    blurred(ctx, size * 0.035, css(col, 0.55), () => placeShape(ctx, S, [0, 0, 0], box.cx, box.cy, size * 1.02));
    ctx.save(); ctx.globalAlpha = 0.92; placeShape(ctx, S, col, box.cx, box.cy, size); ctx.restore();
  }
  return box;
}
/** Motion: the picture smeared sideways, a few fainter and fainter copies trailing to one side. */
function avSmear(ctx, u, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const src = snap(ctx, "avSnap"), k = ctx.getTransform().a, n = fast ? 3 : 7;
  inPixels(ctx, () => { for (let i = n; i >= 1; i--) { ctx.globalAlpha = 0.26 * amt * (1 - i / (n + 1)); ctx.drawImage(src, -i * u * 0.022 * amt * k, 0); } });
}
/**
 * Out of focus, with a frame of focus: the picture drawn soft over itself, then a rectangle round the
 * figure's head drawn sharp again, with a hairline round it and ticks at its corners. The frame grows
 * with its slider; without blur there is nothing for it to show, so it waits for blur.
 */
function avFocus(ctx, env, box, blur, focus, sharp) {
  if (blur <= 0 || !sharp) return;
  const cv = ctx.canvas, soft = softCopy(sharp, 10 + 26 * blur, "avBlur"), m = ctx.getTransform(), k = m.a, u = Math.min(env.w, env.h);
  inPixels(ctx, () => { ctx.globalAlpha = Math.min(1, blur * 1.6); ctx.imageSmoothingEnabled = true; ctx.drawImage(soft, 0, 0, cv.width, cv.height); });
  if (focus <= 0) return;
  const fw = u * (0.16 + 0.26 * focus), fh = fw * 0.66, x = clamp(box.cx - fw * 0.55, 0, env.w - fw), y = clamp(box.cy - box.size * 0.3 - fh / 2, 0, env.h - fh), a = Math.min(1, focus * 3);
  inPixels(ctx, () => { ctx.globalAlpha = a; ctx.drawImage(sharp, m.e + x * k, m.f + y * k, fw * k, fh * k, m.e + x * k, m.f + y * k, fw * k, fh * k); });
  ctx.save(); ctx.strokeStyle = css(avInk(), 0.75 * a); ctx.lineWidth = 1.2; ctx.strokeRect(x, y, fw, fh);
  ctx.lineWidth = 2.4; const t = 16;
  for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + fw, y, -1, 1], [x, y + fh, 1, -1], [x + fw, y + fh, -1, -1]]) { ctx.beginPath(); ctx.moveTo(cx - sx * 6, cy + sy * t); ctx.lineTo(cx - sx * 6, cy - sy * 6); ctx.lineTo(cx + sx * t, cy - sy * 6); ctx.stroke(); }
  ctx.restore();
}
/**
 * A patch of the picture gone to large pixels — taken from `src`, the picture before the blur, so the
 * cells keep its contrast, each a step lighter or darker — its edge stepped, a few cells knocked out
 * of place, set where the title leaves room; it grows with `amt`.
 */
function avMosaic(ctx, env, box, u, amt, src) {
  if (amt <= 0 || !src) return;
  const m = ctx.getTransform(), k = m.a, cell = u * 0.034, F = openField(env), T = titleArea(ctx, env);
  const W = ctx.canvas.width / k, H = ctx.canvas.height / k, fw = F.x1 - F.x0;
  let rw = u * (0.08 + 0.34 * amt), rh = rw * 0.8, cx = box.cx + box.size * 0.05, cy = box.cy - box.size * 0.15;
  // where it shows: beside the title if there is room, else under it (as large as the room allows), else over the figure
  const side = T ? F.x1 - 40 - (T.x + T.w + 40) : 0, under = T ? F.y1 - 24 - (T.y + T.h + 24) : 0;
  // (held in by the room one way, it still grows the other, so more is more)
  if (T && side >= u * 0.12) { rw = Math.min(rw, side); cx = (T.x + T.w + 40 + F.x1 - 40) / 2; cy = (F.y0 + F.y1) * 0.45; }
  else if (T && under >= u * 0.08) { rh = Math.min(rh, under); cx = F.x0 + fw * 0.3; cy = T.y + T.h + 24 + rh / 2; }   // left of the band and the figure
  const rx = clamp(cx - rw / 2, 0, W - rw), ry = clamp(cy - rh / 2, 0, H - rh), nx = Math.max(1, Math.round(rw / cell)), ny = Math.max(1, Math.round(rh / cell));
  const t = WORK.avCells || (WORK.avCells = document.createElement("canvas"));
  if (t.width !== nx || t.height !== ny) { t.width = nx; t.height = ny; }
  const x = t.getContext("2d"); x.imageSmoothingEnabled = true; x.globalCompositeOperation = "copy";
  x.drawImage(src, m.e + rx * k, m.f + ry * k, nx * cell * k, ny * cell * k, 0, 0, nx, ny);   // each cell the average of what is under it
  inPixels(ctx, () => {
    ctx.imageSmoothingEnabled = false;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const dx = (i + 0.5) / nx - 0.5, dy = (j + 0.5) / ny - 0.5;
      if (dx * dx * 4 + dy * dy * 4 > 0.7 + 0.45 * rand(i * 7.1 + j * 3.3 + 850)) continue;   // a stepped, ragged edge
      const off = rand(i * 2.9 + j * 5.7 + 851) > 0.9 ? Math.round((rand(i + j * 9 + 852) - 0.5) * 4) : 0;   // a few cells out of place
      const X = m.e + (rx + i * cell) * k, Y = m.f + (ry + j * cell) * k, D = Math.ceil(cell * k), q = rand(i * 4.1 + j * 6.7 + 853);
      ctx.drawImage(t, clamp(i + off, 0, nx - 1), j, 1, 1, X, Y, D, D);
      ctx.fillStyle = q > 0.5 ? `rgba(255,255,255,${(q - 0.5) * 0.22})` : `rgba(0,0,0,${(0.5 - q) * 0.22})`; ctx.fillRect(X, Y, D, D);   // each a step lighter or darker, so the cells read even where the picture is flat
    }
  });
}
/**
 * Fluted glass: the picture seen through a panel of narrow vertical flutes, each one squeezing a wider
 * slice of what is behind it into its own width, shaded at one edge and lit at the other. The panel
 * stands over the figure and widens with `amt` until it covers the whole picture.
 */
function avGlass(ctx, env, box, amt) {
  if (amt <= 0 || !canPaint(ctx)) return;
  const { w, h } = env, u = Math.min(w, h), src = snap(ctx, "avSnap"), m = ctx.getTransform(), k = m.a, pitch = u * 0.04;
  const half = (w * (0.1 + 0.95 * amt)) / 2, x0 = Math.max(0, Math.floor((box.cx - half) / pitch) * pitch), x1 = Math.min(w, Math.ceil((box.cx + half) / pitch) * pitch);
  inPixels(ctx, () => {
    for (let x = x0; x < x1; x += pitch) {
      const sw = pitch * 1.9, sx = clamp(x + pitch / 2 - sw / 2, 0, w - sw), X = m.e + x * k, P = pitch * k;
      ctx.drawImage(src, m.e + sx * k, 0, sw * k, src.height, X, 0, P, src.height);
      const g = ctx.createLinearGradient(X, 0, X + P, 0);
      g.addColorStop(0, "rgba(0,0,0,0.26)"); g.addColorStop(0.22, "rgba(255,255,255,0.08)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(0.86, "rgba(255,255,255,0.2)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
      ctx.fillStyle = g; ctx.fillRect(X, 0, P, src.height);
    }
  });
  ctx.fillStyle = css(avInk(), 0.35); ctx.fillRect(x0, 0, 1, h); ctx.fillRect(x1 - 1, 0, 1, h);
}
/**
 * A vertical band, a clear window onto the picture as it was before the blur and the glass (`sharp`),
 * its tones mapped onto the channel colour (dark to a deep shade of it, light to the colour itself);
 * hairlines at its edges. It widens with `amt`.
 */
function avBand(ctx, env, box, amt, sharp) {
  if (amt <= 0) return;
  const { w, h, C } = env, bw = w * 0.2 * Math.pow(amt, 0.8), x = clamp(box.cx - box.size * 0.12 - bw / 2, 0, w - bw);
  ctx.save(); ctx.beginPath(); ctx.rect(x, 0, bw, h); ctx.clip();
  if (sharp) inPixels(ctx, () => ctx.drawImage(sharp, 0, 0));
  ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(C); ctx.fillRect(x, 0, bw, h);
  ctx.globalCompositeOperation = "screen"; ctx.fillStyle = css(mix([0, 0, 0], C, 0.18)); ctx.fillRect(x, 0, bw, h);
  ctx.restore();
  ctx.fillStyle = css(avInk(), 0.7); ctx.fillRect(x - 1, 0, 1.5, h); ctx.fillRect(x + bw, 0, 1.5, h);
}
export const avant = {
  id: "avant",
  art: "figure",
  repaint: (c) => `a contemporary fashion and design-studio poster made from the photograph: black and white, soft and slightly out of focus, a little motion blur, fine grain, clean studio light, with one small accent of ${c}; still the same picture, no text.`,
  about: { zh: "先锋影像：今天的设计工作室和时装品牌常发的海报。黑白照片（没有照片时，频道图形化成一个柔焦的身影），像设计师在电脑里那样加工：动态拖影、辉光、焦外虚化里留一个清晰的对焦框、一块变成大像素的马赛克、一片条纹玻璃、一条透出频道色的色带；细线网格、圆点标记和界面式的小字；紧凑的大号无衬线标题；频道色是唯一的点缀。冷静、锐利、有数码时代的质感——适合设计、时尚、科技、人物、观点和品牌内容。可选浅灰底或黑底；自带平直的版式。", en: "Avant-garde image: the posters design studios and fashion labels post today. A black-and-white photograph (or, without one, the channel graphic as a soft figure) worked on as a designer would in the computer: a smear of motion, a glow, out of focus with one sharp frame of focus, a patch gone to large pixels, a panel of fluted glass, a band where the channel colour comes through; hairline grid lines, dot markers and interface-like labels; a big tight grotesque; the channel colour the only accent. Cool, sharp, digital — for design, fashion, tech, portraits, opinion and brand content. A light grey or a black ground; flat layouts of its own." },
  name: { zh: "先锋影像", en: "Avant-garde image" },
  seeded: true,
  scene: { figure: { zh: "身影", en: "Figure" } },
  params: [
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "身影", en: "Figure" } },
    { key: "smear", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "动态拖影", en: "Motion smear" } },
    { key: "glow", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "辉光", en: "Glow" } },
    { key: "blur", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "焦外虚化", en: "Out of focus" } },
    { key: "focus", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "对焦框", en: "Frame of focus" } },
    { key: "mosaic", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "像素马赛克", en: "Pixel mosaic" } },
    { key: "glass", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "条纹玻璃", en: "Fluted glass" } },
    { key: "band", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "色带", en: "Colour band" } },
    { key: "fade", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "渐隐", en: "Fade out" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "网格与标注", en: "Grid and labels" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "颗粒", en: "Grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.17, side: 0.3, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(avGround()), text: css(avInk()), dim: css(avInk(), 0.55), titleFill: css(avInk()), titleInk: css(avGround()), grid: () => css(avInk(), 0.14) }),
  /**
   * The ground (a studio backdrop, lighter in the middle) and the figure, or the photo in black and
   * white; then, in order, the motion smear, the glow, the blur with its frame of focus, the fluted
   * glass, the mosaic, the colour band (a clear window onto the picture before the blur and the glass)
   * and the fade — each working on what is there so far, so the lettering and everything above stays
   * sharp. A print photo is only turned black and white.
   */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = avGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    let box;
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (!L.fill) return true;
      box = { cx: w * 0.55, cy: h * 0.5, size: h * 0.9 };
    } else {
      if (L.ground !== false) {   // the studio backdrop, lighter in the middle: the ground
        const g = ctx.createRadialGradient(w * 0.6, h * 0.42, 0, w * 0.6, h * 0.42, Math.hypot(w, h) * 0.6);
        g.addColorStop(0, css(dark ? [44, 44, 48] : [244, 244, 242])); g.addColorStop(1, css(ground));
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      if (!L.grid) return true;
      box = avFigure(ctx, env, p);
    }
    avSmear(ctx, u, p.smear);
    avGlow(ctx, p.glow);
    const sharp = canPaint(ctx) && (p.blur > 0 || p.band > 0 || p.mosaic > 0) ? snap(ctx, "avSharp") : null;   // the picture before the blur and the glass: the frame of focus, the mosaic and the band show it
    avFocus(ctx, env, box, p.blur, p.focus, sharp);
    avGlass(ctx, env, box, p.glass);
    avMosaic(ctx, env, box, u, p.mosaic, sharp);   // over the glass, so its cells stay square
    avBand(ctx, env, box, p.band, sharp);
    if (p.fade > 0) wherePainted(ctx, (c) => { const f = c.createLinearGradient(0, h * 0.45, 0, h); f.addColorStop(0, css(ground, 0)); f.addColorStop(1, css(ground, Math.min(1, p.fade * 1.1))); c.fillStyle = f; c.fillRect(0, 0, w, h); }, L.base === "clear");   // on a see-through base, what is there fades
    return true;
  },
  /** A layout grid as a design tool shows it: twelve columns in hairlines, and a cross at every column line on each eighth of the height. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 64, xs = every(m, w - m + 1, (w - 2 * m) / 12), ys = every(m, h - m + 1, (h - 2 * m) / 8);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.5; gridPath(ctx, xs, [], 0, 0, 0, h);
    ctx.globalAlpha = 1; ctx.beginPath(); for (const x of xs) for (const y of ys) { ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); } ctx.stroke();
    ctx.restore();
  },
  accent: { fill: () => css(dark ? [26, 26, 30] : [206, 206, 203]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(avInk(), 0.45); ctx.lineWidth = 1.5; run(0, 0); } },
  /** A big grotesque, upright and flat; highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || o.C || avInk() : o.fill || avInk()); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: avInk() }, stroke: { ink: avInk() } }
    : { fill: { ink: AV.ink, light: AV.white, mid: [170, 170, 168], dark: [48, 48, 50], colour: (c) => grey(c) }, stroke: { ink: AV.ink, light: AV.white, colour: (c) => grey(c) }, line: 0.45 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : role(c) === "colour" ? css(grey(c), c[3]) : fill; } }),
  /** The corner tag: monospaced capitals in a hairline box, a small square of the channel colour before them. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.5;
    ctx.font = `600 ${f}px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 2.6, h = f * 2, top = y + (fs * 1.34 - h);
    ctx.strokeStyle = css(avInk(), 0.8); ctx.lineWidth = 1.5; ctx.strokeRect(x, top, w, h);
    ctx.fillStyle = css(C); ctx.fillRect(x + f * 0.6, top + h / 2 - f * 0.3, f * 0.6, f * 0.6);
    ctx.fillStyle = ink || css(avInk()); spaced(ctx, str, x + f * 1.7, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: hairlines down and across, dot markers where they meet, interface labels along the foot, a few lines of small print. */
  frame(ctx, env, p) {
    const a = p.grid;
    if (a <= 0) return;
    const { w, h } = env, ink = avInk(), P = env.o.profile, i = env.o.catIndex, total = P.categories.length, xs = [64, w * 0.36, w * 0.64, w - 64], ys = [h * 0.58, h - 76];
    ctx.save(); ctx.fillStyle = css(ink, 0.28 * a);
    for (const x of xs) ctx.fillRect(Math.round(x), 0, 1, h);
    for (const y of ys) ctx.fillRect(0, Math.round(y), w, 1);
    ctx.fillStyle = css(ink, 0.85 * a);
    for (const x of xs) for (const y of ys) { ctx.beginPath(); ctx.arc(x, y, 3.5, 0, TAU); ctx.fill(); }
    ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    [(P.brand.name || "STUDIO").toUpperCase(), `VOL.${pad2(i + 1)}`, `# ${(env.cat.code || env.cat.name || "").toUpperCase()}`, `${pad2(i + 1)} / ${pad2(total)}`].forEach((t, k) => ctx.fillText(t, xs[k] + (k === 3 ? -ctx.measureText(t).width - 10 : 10), h - 48));
    greeked(ctx, xs[2] + 10, ys[0] + 14, w * 0.22, 4, 9, css(ink, 0.45 * a), 860 + i);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 20 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 8 * unit; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * (dark ? 0.75 : 0.6), unit); },
  prompt: `Graphic elements for a contemporary design-studio poster — precise, reduced, a little technical — that read at a glance:
- one clean shape per sticker (an arrow, a cross, a circle, a hand, a pair of glasses, a figure in profile, a cursor), simple and exact; no realism, no perspective, no detail;
- flat colour only: "ink" and "white", with the main colour as a single small accent (it is the only colour on the poster);
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a product shot for a design studio would show them: a few boxes and cylinders, exact and minimal — a speaker, a lamp, a camera, a chair; no realism, no fine detail.
- the renderer paints faces in greys with a hairline: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" near-black, and "main" a mid grey.`,
};
avant.elementFx = [
  { key: "smear", name: { zh: "动态拖影", en: "Motion smear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.3 }),
    /** Faint copies of the layer smeared off to the left. */
    paint(x, B, a, E) { trail(x, B, region(x, B, "fxA"), 6, -B.w * 0.02 * (0.3 + a), 0, 0.12 + 0.3 * a, "source-over"); } },
  { key: "glow", name: { zh: "辉光", en: "Glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 60 * k, t: 60 * k, r: 60 * k, b: 60 * k }),
    /** The layer's own light spilling round it. */
    paint(x, B, a, E) { glowBehind(x, B, region(x, B, "fxA"), (8 + 24 * a) * E.k, 0.95 * Math.min(1, a * 2.5), null); } },
  { key: "blur", name: { zh: "焦外虚化与对焦框", en: "Out of focus with a frame of focus" }, for: FX_ALL, stage: "filter",
    /** The layer out of focus but for a frame in its middle, kept sharp, with a hairline and ticks round it. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), pad = Math.ceil((4 + 10 * a) * E.k), soft = softened(padded(src, pad, "fxBp"), 3 + 10 * a, "fxBl");
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.globalAlpha = 1 - Math.min(1, a * 1.6); x.drawImage(src, B.x0, B.y0);
      x.globalAlpha = Math.min(1, a * 1.6); x.imageSmoothingEnabled = true; x.drawImage(soft, B.x0 - pad, B.y0 - pad, B.w + 2 * pad, B.h + 2 * pad); x.restore();
      const fw = B.w * 0.36, fh = B.h * 0.36, fx = B.x0 + (B.w - fw) / 2, fy = B.y0 + (B.h - fh) * 0.4, t = Math.min(fw, fh) * 0.18;
      x.save(); x.globalAlpha = Math.min(1, a * 3); x.drawImage(src, fx - B.x0, fy - B.y0, fw, fh, fx, fy, fw, fh);
      x.strokeStyle = css(avInk(), 0.75); x.lineWidth = Math.max(1, E.k * 0.8); x.strokeRect(fx, fy, fw, fh);
      x.lineWidth = Math.max(1.5, E.k * 1.6);
      for (const [cx, cy, sx, sy] of [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]]) { x.beginPath(); x.moveTo(cx - sx * 4, cy + sy * t); x.lineTo(cx - sx * 4, cy - sy * 4); x.lineTo(cx + sx * t, cy - sy * 4); x.stroke(); }
      x.restore();
    } },
  { key: "mosaic", name: { zh: "像素马赛克", en: "Pixel mosaic" }, for: FX_ALL, stage: "filter",
    /** The layer gone to square pixels, larger as it rises. */
    paint(x, B, a, E) {
      const cs = Math.max(1, (1 + 22 * a) * E.k), cols = Math.max(1, Math.round(B.w / cs)), rows = Math.max(1, Math.round(B.h / cs)), t = fxCanvas("fxMos", cols, rows), g = t.getContext("2d");
      g.globalCompositeOperation = "copy"; g.imageSmoothingEnabled = true; g.drawImage(region(x, B, "fxA"), 0, 0, cols, rows);
      x.save(); x.clearRect(B.x0, B.y0, B.w, B.h); x.imageSmoothingEnabled = false; x.drawImage(t, B.x0, B.y0, B.w, B.h); x.restore();
    } },
  { key: "glass", name: { zh: "条纹玻璃", en: "Fluted glass" }, for: FX_ALL, stage: "filter",
    /** The layer seen through a panel of narrow vertical flutes, wider as it rises, each squeezing a wider slice into itself, shaded at one edge and lit at the other. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), p = Math.max(6, B.w * 0.035), half = (B.w * (0.15 + 0.9 * a)) / 2, cx = B.w / 2, i0 = Math.max(0, Math.floor((cx - half) / p)), i1 = Math.min(Math.ceil(B.w / p), Math.ceil((cx + half) / p));
      for (let i = i0; i < i1; i++) {
        const fx = i * p, sw = p * 1.9, sx = clamp(fx + p / 2 - sw / 2, 0, B.w - sw);
        x.clearRect(B.x0 + fx, B.y0, p, B.h); x.drawImage(src, sx, 0, sw, B.h, B.x0 + fx, B.y0, p, B.h);
        const g = x.createLinearGradient(B.x0 + fx, 0, B.x0 + fx + p, 0); g.addColorStop(0, "rgba(0,0,0,0.26)"); g.addColorStop(0.22, "rgba(255,255,255,0.08)"); g.addColorStop(0.55, "rgba(255,255,255,0)"); g.addColorStop(0.86, "rgba(255,255,255,0.2)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
        x.save(); x.globalCompositeOperation = "source-atop"; x.fillStyle = g; x.fillRect(B.x0 + fx, B.y0, p, B.h); x.restore();
      }
    } },
  { key: "band", name: { zh: "色带", en: "Colour band" }, for: FX_ALL, stage: "filter",
    /** A vertical band across the layer where it shows in the channel colour, wider as it rises. */
    paint(x, B, a, E) {
      const bw = B.w * 0.28 * Math.pow(a, 0.8), bx = B.x0 + B.w * 0.38 - bw / 2;
      x.save(); x.beginPath(); x.rect(bx, B.y0, bw, B.h); x.clip(); x.globalCompositeOperation = "source-atop"; x.fillStyle = css(boost(E.C, 0.5), 0.75); x.fillRect(bx, B.y0, bw, B.h); x.restore();
      x.save(); x.fillStyle = css(avInk(), 0.6); x.fillRect(bx - 1, B.y0, Math.max(1, E.k * 0.8), B.h); x.fillRect(bx + bw, B.y0, Math.max(1, E.k * 0.8), B.h); x.restore();
    } },
  { key: "fade", name: { zh: "渐隐", en: "Fade out" }, for: FX_ALL, stage: "over",
    /** The layer fading away toward its foot. */
    paint(x, B, a) { const g = x.createLinearGradient(0, B.y0 + B.h * (1 - 0.9 * a), 0, B.y1); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${Math.min(1, a * 1.1)})`); x.globalCompositeOperation = "destination-out"; x.fillStyle = g; x.fillRect(B.x0, B.y0, B.w, B.h); } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A soft, low-contrast black and white, as a studio's fashion print. */
    paint: tonesFx(() => [[0, [26, 26, 28]], [1, [236, 236, 232]]]) },
];
