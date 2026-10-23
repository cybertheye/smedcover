// negative space: the red and black film poster
// Saul Bass and the Polish poster school, by way of today's minimal film posters: red, black and an
// off-white; one huge silhouette carrying the idea, cut against the ground so that the shapes between
// read as much as the shapes; a small, exact title; a few lines of credits. Flat, hard-edged, a little
// rough, as a screen print is.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, css, dark, flatFx, grain, graphicShape, greeked, gridPath, gridPen, inkAs, knockWorn, lum, mapped, mix, near, objAt, openField, pad2, painters, placeShape, rand, shapeOf, spacedCentre, tonesFx, upright, values, wash } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const NEG = { red: [212, 30, 36], black: [16, 13, 13], cream: [242, 233, 214] };
const negSpot = (C) => (values.chan ? C : NEG.red);                       // the one colour: red, or the channel's
const negGround = (C) => (dark ? NEG.black : negSpot(C)), negInk = (C) => (dark ? negSpot(C) : NEG.black);
/** Where the giant silhouette stands: on the open field's floor, toward its far side, behind the channel graphic like its huge shadow, cropped by the floor and the edge. */
function negPlace(env, p) {
  const F = openField(env), fw = F.x1 - F.x0, fh = F.y1 - F.y0, size = fh * (0.45 + 1.05 * p.giant);
  return { F, cx: F.x0 + fw * (0.66 + rand(181) * 0.1), cy: F.y1 - size * 0.36, size, rot: (rand(182) - 0.5) * 0.24 };
}
export const negative = {
  id: "negative",
  art: "giant",
  repaint: (c) => `a minimalist film poster made from a photograph: hard black-and-white with crushed blacks and clean whites, printed over a flat vermilion red, high contrast, a little screen-print roughness; the subject read as a bold silhouette; still the same picture, no text.`,
  about: { zh: "红黑负形海报：索尔·巴斯和波兰海报学派的路子——红、黑、米白三色，一个巨大的剪影承载全部意思（用的是频道图形的轮廓，被画面边缘裁切），剪影和底色互相咬合，空出来的形和画出来的形一样有分量；可加一块反色的负形分割、聚光光束、牵引的细线；标题小而精确，底部几行演职员小字，丝网印刷的粗糙质感。可选红底黑形或黑底红形，也可以用频道色代替红色。冷峻、有隐喻、一眼就懂——适合电影、书评、社会议题、悬疑与观点类内容。", en: "A red-and-black negative-space poster, after Saul Bass and the Polish poster school: red, black and off-white; one huge silhouette carries the idea (the channel graphic's outline, cropped by the edge), cut against the ground so the shapes between read as much as the shapes; optionally a reversed split, a spotlight beam, taut threads; a small exact title, a few lines of credits, the roughness of a screen print. Black on red or red on black, and the channel colour can stand in for the red. Stark, metaphorical, read at a glance — for film, books, social issues, mysteries, opinion." },
  name: { zh: "负形海报", en: "Negative space" },
  seeded: true,
  scene: { giant: { zh: "巨型剪影", en: "Giant silhouette" }, beam: { zh: "聚光光束", en: "Spotlight beam" } },
  params: [
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "巨型剪影", en: "Giant silhouette" } },
    { key: "cut", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "负形分割", en: "Reversed split" } },
    { key: "beam", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "聚光光束", en: "Spotlight beam" } },
    { key: "threads", min: 0, max: 1, step: 0.05, def: 0, name: { zh: "牵引细线", en: "Taut threads" } },
    { key: "print", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "丝网质感", en: "Screen-print texture" } },
    { key: "credits", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "演职员小字", en: "Credits" } },
    { key: "duo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.85, name: { zh: "照片红黑", en: "Photo in red and black" } },
    { key: "chan", toggle: true, min: 0, max: 1, step: 1, def: 0, name: { zh: "用频道色代替红色", en: "Channel colour for the red" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.26, side: 0.34, strip: 0.12 }),
  theme: (base, C) => ({ ...base, field: css(negGround(C)), text: css(NEG.cream), dim: css(NEG.cream, 0.6), titleFill: css(NEG.cream), titleInk: css(NEG.black), grid: () => css(negInk(C), dark ? 0.24 : 0.16) }),
  /**
   * The ground; the giant silhouette in a deeper shade of the ground (tone on tone, so the channel
   * graphic in front of it stays the thing that is read); a region of the other colour cut in along a
   * slanted edge (the reversed split), in which the silhouette turns into the ground's colour — a
   * negative, sharp where it crosses; a beam of light from above; threads drawn taut to it. A photo
   * goes hard black and white, printed over the red.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, ground = negGround(C), ink = negInk(C), spot = negSpot(C);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.duo);
      if (p.duo > 0) {
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.duo; env.drawPhoto(1); env.drawPhoto(1); ctx.restore();   // contrast, twice
        wash(ctx, w, h, "multiply", mix([255, 255, 255], spot, 0.9), p.duo);
        wash(ctx, w, h, "screen", NEG.black, p.duo * 0.6);
      }
      return true;
    }
    if (!L.grid) return true;
    const S = graphicShape(env), at0 = negPlace(env, p), F = at0.F, [gx, gy] = objAt("giant", at0.cx, at0.cy, ctx), at = { ...at0, cx: gx, cy: gy };   // a scene object, the split and threads following it
    // the reversed split: its leaning edge sweeps in from the far side as the slider goes up, across the
    // silhouette (through its middle at 0.5), so that more and more of the figure reads in reverse
    let split = null;
    if (p.cut > 0) {
      const x0 = Math.min(w + h * 0.2, at.cx + at.size * 0.55 * (1 - 2 * p.cut)), lean = h * 0.12 * (rand(183) > 0.5 ? 1 : -1);
      split = [[x0 + lean, 0], [w, 0], [w, h], [x0 - lean, h]];
      shapeOf(ctx, split); ctx.fillStyle = css(ink); ctx.fill();
    }
    if (p.beam > 0) {   // a cone of light from above, onto the silhouette, with a few brighter rays in it
      const [bx] = objAt("beam", at.cx, h * 0.1, ctx, "x"), spread = w * (0.12 + 0.2 * p.beam), g = ctx.createLinearGradient(0, 0, 0, h);   // a scene object, along the top
      g.addColorStop(0, css(NEG.cream, 0.42 * p.beam)); g.addColorStop(1, css(NEG.cream, 0));
      ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.fillStyle = g;
      shapeOf(ctx, [[bx - w * 0.02, 0], [bx + w * 0.02, 0], [bx + spread, h], [bx - spread, h]]); ctx.fill();
      for (let i = 0; i < 7; i++) { const t = (i + 0.5) / 7 - 0.5, wdt = w * 0.004 * (1 + rand(i + 190) * 2); shapeOf(ctx, [[bx + t * w * 0.04 - wdt, 0], [bx + t * w * 0.04 + wdt, 0], [bx + t * spread * 2 + wdt * 4, h], [bx + t * spread * 2 - wdt * 4, h]]); ctx.fill(); }
      ctx.restore();
    }
    if (S && p.giant > 0) {
      const draw = (colour) => placeShape(ctx, S, colour, at.cx, at.cy, at.size, at.rot), shade = dark ? mix(NEG.black, spot, 0.32) : mix(spot, NEG.black, 0.3);
      if (split) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); split.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.clip("evenodd"); draw(shade); ctx.restore(); ctx.save(); shapeOf(ctx, split); ctx.clip(); draw(ground); ctx.restore(); }
      else draw(shade);
    }
    if (p.threads > 0) {   // threads pulled taut from the edges to the silhouette
      const n = Math.round(2 + 6 * p.threads), tx = at.cx, ty = at.cy - at.size * 0.15;
      ctx.strokeStyle = css(dark ? spot : NEG.cream, 0.5 + 0.5 * p.threads); ctx.lineWidth = 2;
      for (let i = 0; i < n; i++) {
        const side = i % 4, t = rand(i * 2.9 + 195), ex = side === 0 ? t * w : side === 1 ? w : side === 2 ? t * w : 0, ey = side === 0 ? 0 : side === 1 ? t * h : side === 2 ? h : t * h;
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(tx + (rand(i * 3.7 + 196) - 0.5) * at.size * 0.3, ty + (rand(i * 4.3 + 197) - 0.5) * at.size * 0.3); ctx.stroke();
      }
    }
    return true;
  },
  /** The poster's construction lines: the thirds, the two diagonals, and from each corner to the middles of the far sides. */
  gridLines(ctx, env, color) {
    const { w, h } = env;
    gridPen(ctx, color);
    gridPath(ctx, [w / 3, (w * 2) / 3], [h / 3, (h * 2) / 3], 0, 0, w, h);
    ctx.beginPath();
    for (const [a, b, c, d] of [[0, 0, w, h], [w, 0, 0, h], [0, 0, w, h / 2], [0, 0, w / 2, h], [w, 0, 0, h / 2], [w, 0, w / 2, h], [0, h, w, h / 2], [0, h, w / 2, 0], [w, h, 0, h / 2], [w, h, w / 2, 0]]) { ctx.moveTo(a, b); ctx.lineTo(c, d); }
    ctx.stroke(); ctx.restore();
  },
  accent: { fill: (C) => css(dark ? negSpot(C) : NEG.black), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // a flat block of the other colour
  /**
   * Upright and flat: warm off-white letters. Highlighted words are set reversed out of a bar of the
   * other colour (red on black, black on red), so they read on the ground, the block and the silhouette alike.
   */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, bar = o.hi || (dark ? negSpot(o.C || NEG.red) : NEG.black);
    if (!o.hiPlate) pass((a, x) => {   // one bar a run (unless the layer marks them its own way)
      if (!a.hi || a.first === false) return;
      const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width };
      ctx.fillStyle = css(bar); ctx.fillRect(r.x0 - fs * 0.04, -fs * 0.86, r.x1 - r.x0 + fs * 0.08, fs * 1.02);
    });
    pass((a, x) => { ctx.fillStyle = css(o.fill || NEG.cream); ctx.fillText(a.t, x, 0); });
  },
  // objects as cut paper: black, off-white and the one colour; the small parts read on the ground and on the block
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: NEG.cream }, stroke: { ink: NEG.cream } }
    : { fill: { ink: NEG.black, light: NEG.cream, mid: mix(NEG.cream, NEG.black, 0.3), dark: NEG.black, colour: () => negSpot(C) }, stroke: { ink: NEG.black, light: NEG.cream, colour: () => negSpot(C) }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: inkAs(NEG.black) }),
  /** The corner tag: a slab of the channel colour (off-white when that would vanish into the ground), condensed lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 0.7, h = fs * 1.18, top = y + fs * 0.08, slab = near(C, negGround(C), 90) || near(C, dark ? negSpot(C) : NEG.black, 90) ? NEG.cream : C;
    ctx.fillStyle = css(slab); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(lum(slab) > 0.45 ? NEG.black : NEG.cream); spaced(ctx, str, x + fs * 0.35, top + h * 0.5 + fs * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a line of billing at the top, and the credits block at the foot — real names where there are some, the rest greeked. */
  frame(ctx, env, p) {
    const a = p.credits;
    if (a <= 0) return;
    const { w, h } = env, P = env.o.profile, brand = (P.brand.name || "").toUpperCase(), name = (env.cat.name || env.cat.code || "").toUpperCase(), col = css(NEG.cream, 0.85 * a);
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
    ctx.font = `700 20px ${fonts.en}, ${fonts.cn}`; spacedCentre(ctx, `${brand} ${brand ? "PRESENTS" : ""}`.trim(), w / 2, 64, 6);
    const bw = Math.min(w * 0.5, 820), bx = (w - bw) / 2;
    ctx.font = `700 18px ${fonts.en}, ${fonts.cn}`; spacedCentre(ctx, `${name}  ·  ${pad2(env.o.catIndex + 1)}`, w / 2, h - 96, 4);
    greeked(ctx, bx, h - 84, bw, 3, 9, css(NEG.cream, 0.6 * a), 210 + env.o.catIndex, "center");
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; },
  /** A screen print: the paper's specks, ink a little uneven, and the grain of the paper under it. */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.print <= 0) return;
    ctx.save(); ctx.globalCompositeOperation = "soft-light";
    for (let i = 0; i < 26; i++) {
      const x = rand(i * 3.3 + 230) * w, y = rand(i * 4.1 + 231) * h, r = Math.min(w, h) * (0.12 + rand(i * 5.9 + 232) * 0.3), g = ctx.createRadialGradient(x, y, 0, x, y, r), c = rand(i + 233) > 0.5 ? 255 : 0;
      g.addColorStop(0, `rgba(${c},${c},${c},${0.22 * p.print})`); g.addColorStop(1, `rgba(${c},${c},${c},0)`);
      ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    grain(ctx, p.print * 0.8, unit, true);
    grain(ctx, p.print * 0.35, unit);
  },
  prompt: `Stickers for a minimalist film poster in the manner of Saul Bass — shapes cut from paper with scissors — that read at a glance:
- one bold silhouette per sticker, with a strong, simple outline and a clever negative shape inside it where it helps (a keyhole, a face in profile, a hand); no realism, no perspective, no detail inside the silhouette;
- flat colour only: black ("ink"), off-white ("white") and the main colour; never more than three;
- the app draws no outline and no shadow: neighbouring shapes must differ in colour to be told apart.`,
  solidPrompt: `Objects as a minimalist film poster would show them: a few boxes and cylinders cut flat as silhouettes, boldly proportioned; no realism, no fine detail.
- the renderer paints faces in black, off-white and the one colour: do NOT try to draw shading or outlines yourself;
- "white" is off-white, "dark" is black, and "main" is the poster's red — use it for one part.`,
};
negative.elementFx = [
  { key: "silhouette", name: { zh: "红黑剪影", en: "Red-and-black silhouette" }, for: FX_ALL, stage: "fill",
    /** The layer cut as one flat shape: black on the light ground, red on the dark. */
    paint: flatFx(() => css(dark ? NEG.red : NEG.black)) },
  { key: "print", name: { zh: "丝网质感", en: "Screen-print texture" }, for: FX_ALL, stage: "over",
    /** The ink pulled through a screen: fine specks where it did not cover. */
    paint(x, B, a, E) { knockWorn(x, B, a * 0.9, E, 0.8); } },
  { key: "duo", name: { zh: "照片红黑", en: "Photo in red and black" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black, red and cream, stepping between them. */
    paint: tonesFx(() => [[0, NEG.black], [0.5, NEG.red], [1, NEG.cream]], 0.4) },
];
