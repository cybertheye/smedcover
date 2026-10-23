// yellow: the festival poster in one bright yellow
// Theatre and film-festival posters set on a single saturated yellow: huge letters with the picture
// showing inside them, a black silhouette cut against the yellow (where it crosses the letters it turns
// yellow), a beam of light, crossing stripes, a flock of small shapes flying off; tight black type and
// small print. One colour, black and white.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, besideLogo, boost, canPaint, clamp, css, flatFx, grain, graphicShape, greeked, gridPen, inkAs, layDown, mapped, mix, near, objAt, openField, pad2, painters, placeShape, rand, rounded, titleArea, tonesFx, upright, values, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const YL = { yellow: [255, 206, 0], ink: [16, 16, 16], text: [30, 28, 26], white: [255, 255, 255], magenta: [230, 0, 126] };   // text: a near-black that is not the house ink, so the small parts' ink can be swapped on its own
const ylGround = (C) => (values.chan ? boost(C, 0.55) : YL.yellow);
/** The one accent: the channel colour, or magenta where that would vanish into the ground. */
const ylAccent = (C) => { const g = ylGround(C); return !near(C, g, 120) ? C : near(YL.magenta, g, 120) ? YL.yellow : YL.magenta; };
/**
 * The room the letters and the silhouette stand in: right of the title, down to the floor, when there
 * is a fair width of it; else under the title; the field's far half when the title is hidden.
 */
function ylRoom(ctx, env) {
  const F = openField(env), fw = F.x1 - F.x0, T = titleArea(ctx, env), right = T ? T.x + T.w + 30 : F.x0 + fw * 0.45;
  if (F.x1 - fw * 0.03 - right >= fw * 0.22) return { x0: right, x1: F.x1 - fw * 0.03, y0: F.y0 + 24, y1: F.y1 };
  return { x0: F.x0 + fw * 0.3, x1: F.x1 - fw * 0.03, y0: Math.min(T.y + T.h + 20, F.y1 - (F.y1 - F.y0) * 0.25), y1: F.y1 };
}
/** The giant letters' arrangement: the typed word or the channel's code, in a block of rows filling the region `R`. */
function ylWord(ctx, env, p, R) {
  const word = [...((p.word || env.cat.code || env.cat.name || "A").toUpperCase())].filter((c) => c.trim()).slice(0, 8), n = word.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), rw = R.x1 - R.x0, rh = R.y1 - R.y0;
  const face = (s) => (p.serif ? `700 ${s}px ${fonts.serif}` : `900 ${s}px ${fonts.en}, ${fonts.cn}`);
  ctx.save(); ctx.font = face(100); const cw = Math.max(...word.map((c) => ctx.measureText(c).width)) / 100; ctx.restore();
  const fs = Math.min((rh * (0.55 + 0.45 * p.giant)) / (rows * 0.86), (rw * 0.98) / (cols * cw * 1.02));
  const bw = cols * cw * fs * 1.02, bh = rows * fs * 0.86;
  return { word, cols, cw, fs, bw, bh, x0: R.x0 + (rw - bw) / 2, y0: R.y0 + (rh - bh) * 0.5, font: face(fs) };
}
/** Paints the giant letters (see ylWord) in `colour`. */
function ylLetters(x, W, colour) {
  x.font = W.font; x.textAlign = "center"; x.textBaseline = "alphabetic"; x.fillStyle = css(colour);
  W.word.forEach((ch, i) => x.fillText(ch, W.x0 + ((i % W.cols) + 0.5) * W.cw * W.fs * 1.02, W.y0 + (Math.floor(i / W.cols) + 1) * W.fs * 0.86 - W.fs * 0.06));
}
export const yellow = {
  id: "yellow",
  art: "figure",
  repaint: (c) => `a festival poster made from the photograph: the subject in hard black and white set on one flat, saturated yellow, clean and graphic, a little paper grain; still the same picture, no text.`,
  about: { zh: "明黄海报：戏剧节和电影节常用的一整版明黄——巨大的白色字母里透出画面（有照片时是照片），一个黑色剪影立在标题旁的空处，穿过字母的部分反成黄色；可加一道光束、交叉的条纹、从剪影里飞散出去的小形状；紧凑的黑色标题和小字信息。只有黄、黑、白和一个点缀色。醒目、自信、一眼认出——适合活动、展演、电影、讲座、课程和品牌宣传。可以用频道色代替黄色。", en: "Yellow: the one bright yellow of theatre and film-festival posters — huge letters with the picture showing inside them (the photo, or the silhouette), a black silhouette standing on the yellow and turning yellow where it crosses the letters; a beam of light, crossing stripes and small shapes flying off if you like; tight black type and small print. Yellow, black, white and one accent. Loud, confident, recognisable at once — for events, shows, films, talks, courses and brand campaigns. The channel colour can take the yellow's place." },
  name: { zh: "明黄海报", en: "Yellow poster" },
  oneTheme: true,
  seeded: true,
  scene: { letters: { zh: "巨型字母", en: "Giant letters" }, beam: { zh: "光束", en: "Beam" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "巨型字母", en: "Giant letters" } },
    { key: "word", text: true, max: 8, def: "", name: { zh: "字母内容", en: "Their letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "figure", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "黑色剪影", en: "Black silhouette" } },
    { key: "flock", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "飞散小形", en: "Flock" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "光束", en: "Beam of light" } },
    { key: "stripes", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "交叉条纹", en: "Crossing stripes" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "小字信息", en: "Small print" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "serif", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "衬线字母", en: "Serif letters" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "用频道色代替黄色", en: "The channel colour in place of the yellow" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
    { key: "inside", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片装进字母", en: "Photo inside the letters" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.16, side: 0.28, strip: 0.1 }),
  theme: (base, C) => ({ ...base, field: css(ylGround(C)), text: css(YL.text), dim: css(YL.text, 0.6), titleFill: css(YL.text), titleInk: css(ylGround(C)), grid: () => css(YL.ink, 0.16) }),
  /**
   * The yellow, then (behind) crossing stripes and a beam, the black silhouette, the giant letters in
   * white — the silhouette turning yellow inside them — and the flock. A photo goes black and white;
   * one filling the canvas can show only inside the letters: the yellow is laid over it with the
   * letters cut out.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = ylGround(C), u = Math.min(w, h), F0 = openField(env), R = canPaint(ctx) ? ylRoom(ctx, env) : null;
    // the letters are white, so they may stand behind the black title: they take the field's far side; the black silhouette keeps to the room
    const W = p.giant > 0 && R ? ylWord(ctx, env, p, { x0: F0.x0 + (F0.x1 - F0.x0) * 0.42, x1: F0.x1 - (F0.x1 - F0.x0) * 0.04, y0: F0.y0 + 24, y1: F0.y1 }) : null;
    if (W) { const mx = W.x0 + W.bw / 2, my = W.y0 + W.bh / 2, [X, Y] = objAt("letters", mx, my, ctx); W.x0 += X - mx; W.y0 += Y - my; }   // a scene object
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (L.fill && W && p.inside > 0) { const x = workLike(ctx, "yl"); x.fillStyle = css(ground); x.fillRect(0, 0, w, h); x.globalCompositeOperation = "destination-out"; ylLetters(x, W, [0, 0, 0]); layDown(ctx, x, p.inside); }
      return true;
    }
    if (!L.grid) return true;
    const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, S = p.figure > 0 && R && graphicShape(env), b = S && S.box, aspect = b ? (b.x1 - b.x0) / Math.max(1, b.y1 - b.y0) : 1;
    // the silhouette stands on the floor in the room, as tall as the slider says and the room allows
    const size = R ? Math.min((R.y1 - R.y0) * (0.5 + 0.5 * p.figure), ((R.x1 - R.x0) * 0.85) / aspect) : fh * 0.5, fx = R ? R.x0 + (R.x1 - R.x0) * 0.42 : F.x0 + fw * 0.62, fy = F.y1 - size * 0.5;
    if (p.stripes > 0) {   // crossing stripes, pair by pair, one in the accent
      const n = p.stripes * 6, sx = W ? W.x0 + W.bw / 2 : F.x0 + fw * 0.6, sw = u * 0.022;
      for (let k = 0; k < Math.ceil(n); k++) {
        const off = (k - 2.5) * u * 0.07, col = k === 2 ? ylAccent(C) : YL.white;
        ctx.strokeStyle = css(col, clamp(n - k)); ctx.lineWidth = sw;
        ctx.beginPath(); ctx.moveTo(sx + off - fh * 0.35, F.y0 - 20); ctx.lineTo(sx - off + fh * 0.35, F.y1 + 20); ctx.stroke();
      }
    }
    if (p.beam > 0) {   // a beam from the figure's head out to the left, spreading over the floor; where it starts is a scene object
      const [ox, oy] = objAt("beam", fx, fy - size * 0.3, ctx), g = ctx.createLinearGradient(ox, 0, F.x0, 0); g.addColorStop(0, css(YL.white, 0.85 * p.beam)); g.addColorStop(1, css(YL.white, 0.25 * p.beam));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(F.x0 - 20, F.y1 - fh * (0.15 + 0.45 * p.beam)); ctx.lineTo(F.x0 - 20, F.y1); ctx.lineTo(ox, F.y1); ctx.closePath(); ctx.fill();
    }
    if (S) placeShape(ctx, S, YL.ink, fx, fy, size);
    if (W) {
      const x = workLike(ctx, "yl");
      ylLetters(x, W, YL.white);
      if (S) { x.globalCompositeOperation = "source-atop"; placeShape(x, S, ground, fx, fy, size); }   // the figure, reversed inside the letters
      layDown(ctx, x, Math.min(1, p.giant * 5));
    }
    if (S && p.flock > 0) {   // small copies flying off the figure, up and away, one by one
      for (let k = 0, n = p.flock * 16; k < Math.ceil(n); k++) {
        const t = (k + 1) / 17, ang = -1.2 + rand(k * 2.1 + 1100) * 0.9, d = size * (0.35 + t * 0.9), s = u * (0.025 + rand(k * 3.3 + 1101) * 0.025);
        ctx.save(); ctx.globalAlpha = clamp(n - k); placeShape(ctx, S, YL.ink, fx + Math.cos(ang) * d, fy - size * 0.3 + Math.sin(ang) * d, s, (rand(k * 4.7 + 1102) - 0.5) * 1.2); ctx.restore();
      }
    }
    return true;
  },
  /** Registration crosses on the yellow, every 120, a dot between them. */
  gridLines(ctx, env, color) {
    const { w, h } = env, s = 120;
    gridPen(ctx, color, 3); ctx.beginPath();
    for (let x = s / 2; x < w; x += s) for (let y = s / 2; y < h; y += s) { ctx.moveTo(x - 14, y); ctx.lineTo(x + 14, y); ctx.moveTo(x, y - 14); ctx.lineTo(x, y + 14); }
    ctx.stroke(); ctx.beginPath();
    for (let x = s; x < w; x += s) for (let y = s; y < h; y += s) { ctx.moveTo(x + 3.5, y); ctx.arc(x, y, 3.5, 0, TAU); }
    ctx.fill(); ctx.restore();
  },
  accent: { fill: () => css(YL.white), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a white band: the small parts' ink reads on it as on the yellow
  /** Tight black capitals, flat and upright; highlighted words in the accent colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    pass((a, x) => { ctx.fillStyle = css(a.hi ? o.hi || ylAccent(o.C || YL.magenta) : o.fill || YL.text); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => (plates ? ctx : mapped(ctx, { fill: { ink: YL.ink, light: YL.white, mid: mix(YL.white, YL.ink, 0.25), dark: YL.ink, colour: () => ylAccent(C) }, stroke: { ink: YL.ink, light: YL.white }, line: 0.6 })),
  sticker: painters({ line: null, shadow: null, tone: inkAs(YL.ink) }),
  /** The corner tag: a black slab, the lettering in the ground's yellow. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs * 0.86}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 0.7, h = fs * 1.16, top = y + fs * 0.1;
    ctx.fillStyle = css(YL.ink); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(ylGround(C)); spaced(ctx, str, x + fs * 0.35, top + h * 0.5 + fs * 0.31, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a block of small print in the top corner, and a row of sponsors' marks along the foot. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, i = env.o.catIndex, F = openField(env);
    ctx.save(); ctx.fillStyle = css(YL.ink, 0.85 * a); ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    const bx = besideLogo(env, w - 80) - 260;   // the block of small print
    ctx.font = `700 15px ${fonts.en}, ${fonts.cn}`; ctx.fillText(`${(P.brand.name || "").toUpperCase()}  ·  No.${pad2(i + 1)}`, bx, 70);
    greeked(ctx, bx, 86, 260, 4, 11, css(YL.ink, 0.6 * a), 1110 + i);
    if (a > 0.4) for (let k = 0; k < 6; k++) { ctx.fillStyle = css(YL.ink, 0.5 * Math.min(1, (a - 0.4) * 3)); ctx.beginPath(); rounded(ctx, w - 72 - (k + 1) * 64, F.y1 - 44, 48, 22, 5); ctx.fill(); }
    ctx.restore();
  },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit, true); },
  prompt: `Silhouettes for a one-colour festival poster on bright yellow — bold, witty, instantly read:
- one strong black silhouette per sticker (a hat, a moustache, a hand, a saxophone, a bird, a figure walking, a film camera), with at most one clever detail; no realism, no perspective, no detail;
- flat colour only: "ink" for the silhouette, "white" for small light parts, and the main colour as a single small accent;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a yellow festival poster would show them: a few boxes and cylinders, bold and plain — a film camera, a lamp, a chair, a megaphone; no realism, no fine detail.
- the renderer paints faces in black, white and grey: do NOT try to draw shading or outlines yourself;
- "white" is white, "dark" black, and "main" the accent colour — one part only.`,
};
yellow.elementFx = [
  { key: "silhouette", name: { zh: "黑色剪影", en: "Black silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer as a flat black shape, as on a yellow poster. */
    paint: flatFx(() => css(YL.ink)) },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A hard black and white. */
    paint: tonesFx(() => [[0, YL.ink], [1, YL.white]], 0.6) },
];
