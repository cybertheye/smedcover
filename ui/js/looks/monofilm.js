// monochrome film: a black-and-white editorial
// Grainy black-and-white film stills laid out as a magazine would: haze and out-of-focus light, a figure
// caught in motion, fragments of the picture cut out and set back a little off (one or two in the
// channel colour, the only colour there is), a sheet folded in four, dust, columns of small print, a
// serif title that seems to drift out of focus.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, besideLogo, blurred, canPaint, css, dark, fall, fast, filmDust, gpuCanvas, grain, graphicShape, greeked, grey, gridPen, letGoGpu, lum, mapped, mix, objAt, onGpu, openField, pad2, painters, parseColour, placeShape, rand, region, rounded, tonesFx, trail, upright, vignette, wash } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const MF = { black: [12, 12, 12], night: [22, 22, 22], paper: [226, 224, 220], white: [240, 238, 234], grey: [130, 130, 128] };
const mfGround = () => (dark ? MF.night : MF.paper), mfInk = () => (dark ? MF.white : MF.black);
export const monofilm = {
  id: "monofilm",
  art: "ghost",
  repaint: (c) => `a grainy black-and-white film still made from the photograph: deep blacks, soft silver highlights, a little motion blur, heavy film grain, a dreamy cinematic haze; still the same picture, no colour, no text.`,
  about: { zh: "黑白胶片：粗颗粒的黑白电影剧照排成一本杂志——光雾和失焦的光斑，频道图形化成一道带动态残影的灰色身影，照片被裁下几块错开拼回去（其中一两块染成频道色，那是画面里唯一的颜色），纸张对折的折痕，灰尘，成栏的小字，衬线标题带一层失焦的柔光。可选黑底或灰白纸底。安静、文艺、有胶片的呼吸感——适合人物、音乐、电影、时尚、随笔与回忆。", en: "Monochrome film: grainy black-and-white stills laid out as a magazine — haze and out-of-focus light, the channel graphic as a grey figure trailing a motion blur, the photo cut into fragments set back a little off (one or two in the channel colour, the only colour there is), a sheet folded in four, dust, columns of small print, a serif title with a soft blur round it. Black or pale paper. Quiet, literary, breathing like film — for portraits, music, film, fashion, essays and memories." },
  name: { zh: "黑白胶片", en: "Monochrome film" },
  seeded: true,
  scene: { haze: { zh: "光雾", en: "Haze" } },
  params: [
    { key: "haze", min: 0, max: 1, step: 0.05, def: 0.55, name: { zh: "光雾与光斑", en: "Haze and light" } },
    { key: "ghost", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "动态残影", en: "Motion ghost" } },
    { key: "fold", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "对折折痕", en: "Folds" } },
    { key: "type", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "编辑小字", en: "Small print" } },
    { key: "dust", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "灰尘划痕", en: "Dust and scratches" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "胶片颗粒", en: "Film grain" } },
    { key: "collage", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "照片拼贴", en: "Photo collage" } },
    { key: "motion", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "照片动态模糊", en: "Photo motion blur" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白照片", en: "Black-and-white photo" } },
  ],
  titleFont: (f) => f.serif,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.22, side: 0.32, strip: 0.11 }),
  theme: (base) => ({ ...base, field: css(mfGround()), text: css(mfInk()), dim: css(mfInk(), 0.55), titleFill: css(mfInk()), titleInk: css(mfGround()), grid: () => css(mfInk(), 0.12) }),
  /**
   * The ground with its haze and out-of-focus lights, and the channel graphic as a soft grey figure in
   * motion. A photo goes black and white, smeared sideways (the motion blur), and a few pieces of it are
   * cut out and set back a little off, one tinted with the channel colour.
   */
  background(ctx, env, L, p) {
    const { w, h, C } = env, u = Math.min(w, h), ground = mfGround();
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.motion > 0) {   // the same picture again, slid sideways and faint: a hand-held, moving shot
        ctx.save(); const n = fast ? 2 : 6;
        for (let i = 1; i <= n; i++) { ctx.globalAlpha = (0.32 * p.motion) / Math.sqrt(i); ctx.translate((u * 0.012 * p.motion * (i % 2 ? 1 : -0.6)), 0); env.drawPhoto(p.mono); }
        ctx.restore();
      }
      wash(ctx, w, h, "soft-light", [120, 120, 120], 0.4 * p.mono);
      if (L.fill && p.collage > 0) {   // pieces cut out and set back off true
        const n = Math.round(1 + 3 * p.collage), T = env.G && env.G.title, clear = (x, y, a, b) => !T || x > T.x + T.w * 0.75 || x + a < T.x || y > T.y + T.h || y + b < T.y;
        for (let i = 0; i < n; i++) {
          const rw = w * (0.12 + rand(i * 3.1 + 320) * 0.16), rh = rw * (0.62 + rand(i * 4.7 + 321) * 0.5);
          let rx = 0, ry = 0, ok = false;
          for (let t = 0; t < 10 && !ok; t++) { rx = w * (0.08 + rand(i * 5.3 + t * 11.3 + 322) * 0.84) - rw / 2; ry = h * (0.1 + rand(i * 6.1 + t * 13.7 + 323) * 0.8) - rh / 2; ok = clear(rx, ry, rw, rh); }   // clear of the title
          if (!ok) continue;
          const dx = (rand(i * 7.7 + 324) - 0.5) * u * 0.12 * p.collage, dy = (rand(i * 8.3 + 325) - 0.5) * u * 0.08 * p.collage;
          ctx.save(); ctx.beginPath(); ctx.rect(rx + dx, ry + dy, rw, rh); ctx.clip();
          ctx.translate(dx * 0.4, dy * 0.4); ctx.fillStyle = css(ground); ctx.fillRect(rx - dx, ry - dy, rw + Math.abs(dx) * 2, rh + Math.abs(dy) * 2);
          env.drawPhoto(1);
          if (i % 3 === 0) { ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix([255, 255, 255], C, 0.95)); ctx.fillRect(-w, -h, w * 3, h * 3); }   // the one in colour
          ctx.restore();
          ctx.strokeStyle = css(mfInk(), 0.5); ctx.lineWidth = 1.5; ctx.strokeRect(rx + dx, ry + dy, rw, rh);
        }
      }
      return true;
    }
    if (!L.grid) return true;
    if (p.haze > 0) {   // a wash of light from one side, and round out-of-focus lights
      const [lx, ly] = objAt("haze", w * (0.25 + rand(330) * 0.5), h * (0.2 + rand(331) * 0.3), ctx), lit = dark ? [190, 190, 186] : [255, 255, 255];   // where the light comes from: a scene object
      const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, u * 0.9);
      g.addColorStop(0, css(lit, (dark ? 0.32 : 0.55) * p.haze)); g.addColorStop(1, css(lit, 0));
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < Math.round(3 + 9 * p.haze); i++) {
        const x = rand(i * 2.3 + 335) * w, y = rand(i * 3.9 + 336) * h, r = u * (0.02 + rand(i * 5.7 + 337) * 0.07), b = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
        b.addColorStop(0, css(lit, (dark ? 0.14 : 0.3) * p.haze)); b.addColorStop(0.9, css(lit, (dark ? 0.18 : 0.35) * p.haze)); b.addColorStop(1, css(lit, 0));
        ctx.fillStyle = b; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      }
    }
    const S = p.ghost > 0 && canPaint(ctx) && graphicShape(env);
    if (S) {   // the figure in motion: soft grey copies trailing behind, and the figure itself only a little sharper
      const F = openField(env), size = (F.y1 - F.y0) * (0.5 + 0.35 * p.ghost), cx = F.x0 + (F.x1 - F.x0) * 0.68, cy = F.y1 - size * 0.45;
      const fig = dark ? [96, 96, 94] : [70, 70, 68], trail = u * 0.035 * p.ghost, n = fast ? 3 : 8;
      for (let i = n; i >= 1; i--) blurred(ctx, size * 0.03 + trail * 0.2, css(fig, (0.5 * p.ghost) / Math.sqrt(i)), () => placeShape(ctx, S, [0, 0, 0], cx - trail * i, cy, size));
      blurred(ctx, size * 0.012, css(fig, 0.9), () => placeShape(ctx, S, [0, 0, 0], cx, cy, size));
    }
    return true;
  },
  /** A contact sheet: strips of film across the sheet, frame after frame, the sprocket holes along their edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, fw = 300, fh = 200, gap = 16, band = fh + 64, x0 = 36;
    gridPen(ctx, color);
    for (let y = 26; y < h; y += band + 22) {
      ctx.beginPath();
      ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.moveTo(0, y + band); ctx.lineTo(w, y + band);
      for (let x = x0; x < w; x += fw + gap) rounded(ctx, x, y + 32, fw, fh, 12);
      ctx.stroke();
      ctx.beginPath(); for (let x = 14; x < w; x += 26) { ctx.rect(x, y + 9, 12, 14); ctx.rect(x, y + band - 23, 12, 14); } ctx.fill();
    }
    ctx.restore();
  },
  accent: { fill: () => css(dark ? MF.black : [28, 28, 28]), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge(ctx, run) { ctx.lineCap = "butt"; ctx.strokeStyle = css(MF.white, 0.55); ctx.lineWidth = 1.5; run(0, 0); } },
  /** A serif seen through a lens: a soft, out-of-focus copy round it (the shadow slider), then the letters; highlighted words in the channel colour. */
  runs(ctx, pass, o) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || mfInk(), hi = o.hi || o.C || MF.white, soft = Math.min(2, o.shadowAmt);
    if (soft > 0 && !fast) { const [sx, sy] = fall(fs * 0.02 * soft, 0); ctx.save(); ctx.shadowColor = css(ink, 0.65); ctx.shadowBlur = fs * 0.14 * soft; ctx.globalAlpha = 0.6; pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x + sx, sy); }); ctx.restore(); }
    pass((a, x) => { ctx.fillStyle = css(a.hi ? hi : ink); ctx.fillText(a.t, x, 0); });
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: mfInk() }, stroke: { ink: mfInk() } }
    : { fill: { ink: MF.black, light: MF.white, mid: [176, 176, 172], dark: [52, 52, 50], colour: (c) => grey(c) }, stroke: { ink: MF.black, light: MF.white, colour: (c) => grey(c) }, line: 0.5 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => { const c = parseColour(fill); return !c ? fill : css(grey(c), c[3]); } }),
  /** The corner tag: a block of the channel colour — the only colour on the page — with white lettering. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.7;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 4) + f * 1.1, h = f * 1.45, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(C); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(lum(C) > 0.6 ? MF.black : MF.white); spaced(ctx, str, x + f * 0.55, top + h * 0.5 + f * 0.36, 4);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a date and a name in the top corners, columns of small print, a short quotation rule. */
  frame(ctx, env, p) {
    const a = p.type;
    if (a <= 0) return;
    const { w, h } = env, i = env.o.catIndex, col = css(mfInk(), 0.8 * a), P = env.o.profile;
    ctx.save(); ctx.fillStyle = col; ctx.textBaseline = "alphabetic";
    ctx.font = `600 15px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.fillText(`VOL.${pad2(i + 1)}`, 60, 62);
    ctx.textAlign = "right"; ctx.fillText((P.brand.name || "").toUpperCase(), besideLogo(env, w - 60), 62);
    const cw = Math.min(240, w * 0.15);
    greeked(ctx, w - 60 - cw, h * 0.42, cw, 7, 12, css(mfInk(), 0.5 * a), 340 + i, "right");
    if (a > 0.4) greeked(ctx, w - 60 - cw, h * 0.42 + 110, cw * 0.8, 4, 12, css(mfInk(), 0.4 * a), 350 + i, "right");
    ctx.font = `italic 400 22px ${fonts.serif}`; ctx.textAlign = "right"; ctx.fillText((env.cat.name || "").slice(0, 24), w - 60, h * 0.42 - 26);
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 14 * unit; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 5 * unit; },
  /** The sheet folded in four, dust, grain and a faint darkening at the edges. */
  post(ctx, w, h, C, p, unit = 1) {
    if (p.fold > 0) {
      for (const [vertical, at] of [[true, w / 2], [false, h / 2]]) {   // each fold: shade on one side, a light ridge on the other
        const s = 60, g = vertical ? ctx.createLinearGradient(at - s, 0, at + s, 0) : ctx.createLinearGradient(0, at - s, 0, at + s);
        g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(0.48, `rgba(0,0,0,${0.28 * p.fold})`); g.addColorStop(0.5, `rgba(255,255,255,${0.32 * p.fold})`); g.addColorStop(0.56, `rgba(255,255,255,${0.08 * p.fold})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.fillStyle = g; vertical ? ctx.fillRect(at - s, 0, s * 2, h) : ctx.fillRect(0, at - s, w, s * 2); ctx.restore();
        ctx.fillStyle = `rgba(255,255,255,${0.18 * p.fold})`; vertical ? ctx.fillRect(at, 0, 1, h) : ctx.fillRect(0, at, w, 1);
      }
    }
    if (p.dust > 0) filmDust(ctx, w, h, p.dust * 0.8);
    grain(ctx, p.grain, unit);
    vignette(ctx, w, h, [0, 0, 0], dark ? 0.45 : 0.18, 0.4);
  },
  prompt: `Cut-outs for a black-and-white film magazine — reduced, elegant shapes like figures cut from a photograph — that read at a glance:
- one clear silhouette per sticker (a figure walking, a face in profile, a hand, a flower, a chair, a camera), simple and graceful; no realism, no perspective, no detail;
- flat colour only, and only greys: "ink", "white" and the main colour (it comes out as a grey);
- the app draws no outline and no shadow: neighbouring shapes must differ in tone to be told apart.`,
  solidPrompt: `Objects as a black-and-white still would show them: a few boxes and cylinders, plainly and elegantly proportioned — a camera, a lamp, a radio, a suitcase; no realism, no fine detail.
- the renderer paints faces in greys with a thin line: do NOT try to draw shading or outlines yourself;
- "white" is the light grey, "dark" is near-black, and "main" a middle grey.`,
};
monofilm.elementFx = [
  { key: "ghost", name: { zh: "动态残影", en: "Motion ghost" }, for: FX_ALL, stage: "filter", reach: (B) => ({ r: B.w * 0.25, t: B.h * 0.05 }),
    /** Faint afterimages of the layer left behind as it moved, to its right. */
    paint(x, B, a, E) { trail(x, B, region(x, B, "fxA"), 3, B.w * 0.025 * (0.5 + a), -B.h * 0.008, 0.18 + 0.4 * a, "destination-over"); } },
  { key: "mono", name: { zh: "黑白照片", en: "Black-and-white photo" }, for: FX_PHOTO, stage: "filter",
    /** A contrasty black and white, as on a fast film. */
    paint: tonesFx(() => [[0, [8, 8, 8]], [0.35, [58, 58, 56]], [0.7, [188, 186, 182]], [1, [246, 244, 240]]]) },
  { key: "motion", name: { zh: "照片动态模糊", en: "Photo motion blur" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.06, r: B.w * 0.06 }),
    /** The photo smeared sideways, as by a panning camera. */
    paint(x, B, a, E) {
      // the 17 copies laid on a canvas of the graphics card's, the photo taken there once (see copiesBehind)
      const src = onGpu(x.canvas, "fxMoSrc", B), n = 8, step = (B.w * 0.006 + 2 * E.k) * a, c = gpuCanvas("fxMo", B.w, B.h), g = c.getContext("2d");
      g.globalCompositeOperation = "source-over"; g.clearRect(0, 0, B.w, B.h);
      for (let i = 0; i <= 2 * n; i++) { g.globalAlpha = 1 / (i + 1); g.drawImage(src, (i - n) * step, 0); }
      x.save(); x.globalAlpha = Math.min(1, a * 1.4); x.drawImage(c, B.x0, B.y0); x.restore();
      letGoGpu(B.w * B.h);
    } },
  { key: "collage", name: { zh: "照片拼贴", en: "Photo collage" }, for: FX_PHOTO, stage: "filter", reach: (B) => ({ l: B.w * 0.04, t: B.h * 0.06, r: B.w * 0.04, b: B.h * 0.06 }),
    /** The photo cut into three prints, each a little off and turned, with a white border. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA");
      x.clearRect(B.x0, B.y0, B.w, B.h);
      for (let i = 0; i < 3; i++) {
        const w = B.w / 3, cx = B.x0 + w * (i + 0.5), cy = B.y0 + B.h / 2, r = (E.R(i * 2.7 + 61) - 0.5) * 0.08 * a, dy = (E.R(i * 3.3 + 62) - 0.5) * B.h * 0.08 * a, bd = (2 + 8 * a) * E.k;
        x.save(); x.translate(cx, cy + dy); x.rotate(r); x.fillStyle = css(MF.white); x.fillRect(-w / 2 + bd * 0.3 - bd, -B.h / 2 - bd, w - bd * 0.6 + bd * 2, B.h + bd * 2);
        x.drawImage(src, w * i + bd * 0.3, 0, w - bd * 0.6, B.h, -w / 2 + bd * 0.3, -B.h / 2, w - bd * 0.6, B.h); x.restore();
      }
    } },
];
