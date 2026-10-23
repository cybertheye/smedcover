// cyberpunk
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, boost, clamp, css, cutBands, every, fall, fast, glowBehind, gridPath, gridPen, lum, mix, noise, objAt, pad2, parseColour, rand, rePlate, region, role, sat, shapeIn, tonesFx } from "./kit.js";
import { brackets, fonts, spaced, spacedW } from "../cel.js";

// ---------- cyberpunk: the hard-edged graphic design of a neon city's interfaces and signage.
// Solid panels in the channel colour with black lettering, chamfered corners, a red and cyan
// colour split, torn scanlines, small technical labels. Objects are dark hardware picked out in
// lines of light. Nothing is soft: where the house style has an ink shadow, this has a colour echo.
const CY = {
  deep: [8, 8, 12],            // the field
  black: [5, 5, 8],            // lettering and outlines on colour
  glass: [[30, 32, 46], [19, 20, 31], [10, 10, 17]],   // light / mid / dark faces of an object
  red: [255, 0, 60],           // the two colours every split and echo is made of
  cyan: [0, 240, 255],
  white: [240, 246, 250],
};
/** A line of light: a faint halo, the coloured line, a pale core. `draw()` strokes the current path or text. */
function tube(ctx, draw, colour, glow, core = true) {
  const w = ctx.lineWidth, a = ctx.globalAlpha;
  ctx.strokeStyle = css(colour);
  if (glow > 0) { ctx.globalAlpha = a * 0.16 * Math.min(1.5, glow); ctx.lineWidth = w * (2 + 2.4 * glow); draw(); ctx.globalAlpha = a * 0.3 * Math.min(1.5, glow); ctx.lineWidth = w * (1.2 + 0.9 * glow); draw(); }
  ctx.globalAlpha = a; ctx.lineWidth = w * 0.8; draw();
  if (core) { ctx.strokeStyle = css(mix(colour, CY.white, 0.75), 0.9); ctx.lineWidth = Math.max(0.6, w * 0.24); draw(); }
  ctx.lineWidth = w; ctx.globalAlpha = a;
}
/**
 * The colour echo that stands in for a shadow: `draw(colour)` is run twice, nudged apart, once in
 * cyan and once in red, before the real thing is painted on top; nudged as the page has it (fall).
 */
function echo(ctx, amount, draw) {
  if (amount <= 0) return;
  for (const [dx, dy, col] of [[-amount, amount * 0.35, CY.cyan], [amount, -amount * 0.35, CY.red]]) { ctx.save(); ctx.translate(...fall(dx, dy)); draw(css(col)); ctx.restore(); }
}
/** A rectangle with its lower right corner cut off. */
function chamfer(ctx, x, y, w, h, cut) {
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h - cut); ctx.lineTo(x + w - cut, y + h); ctx.lineTo(x, y + h); ctx.closePath();
}
/**
 * A context that draws the house style's objects as dark hardware: neutral faces become dark
 * glass, ink edges become lines of light in the channel colour, ink lettering turns pale.
 * Everything else passes straight through.
 */
function neonContext(ctx, C, p) {
  let ink = false, given = null;            // `given`: the fill colour as the drawing code set it
  const fill = (v) => {
    const c = parseColour(v);
    given = c;
    if (!c) return v;
    const r = role(c);
    return r === "colour" ? v : css(r === "ink" ? CY.black : CY.glass[r === "light" ? 0 : r === "mid" ? 1 : 2], c[3]);
  };
  const stroke = (v) => {
    const c = parseColour(v);
    ink = !!c && role(c) === "ink";
    return !c ? v : ink ? css(C, c[3]) : role(c) === "colour" ? v : css(CY.white, c[3]);
  };
  const lettering = (t, a) => {
    if (!given || role(given) !== "ink") return t.fillText(...a);
    const keep = t.fillStyle;
    t.fillStyle = css(CY.white, given[3]); t.fillText(...a); t.fillStyle = keep;
  };
  return new Proxy(ctx, {
    get(t, k) {
      if (k === "stroke") return (...a) => (ink ? tube(t, () => t.stroke(...a), C, p.glow) : t.stroke(...a));
      if (k === "strokeText") return (...a) => (ink ? tube(t, () => t.strokeText(...a), C, p.glow * 0.6, false) : t.strokeText(...a));
      if (k === "strokeRect") return (...a) => (ink ? tube(t, () => t.strokeRect(...a), C, p.glow) : t.strokeRect(...a));
      if (k === "fillText") return (...a) => lettering(t, a);
      const v = t[k];
      return typeof v === "function" ? v.bind(t) : v;
    },
    set(t, k, v) {
      if (k === "fillStyle") t.fillStyle = fill(v);
      else if (k === "strokeStyle") t.strokeStyle = stroke(v);
      else t[k] = v;
      return true;
    },
  });
}
const SPLIT = [];              // two work canvases for the colour split, reused between frames
const LETTERING = ["title", "subtitle", "text", "tag", "catname", "brand"];   // the layers that are words
export const cyber = {
  id: "cyber",
  repaint: (c) => `a frame of cyberpunk concept art in the graphic language of Cyberpunk 2077: near-black shadows, hard neon light in ${c} with cyan and red edge light, sharp-edged graphic shapes, wet reflective surfaces, a little haze; bold and graphic rather than painterly, no visible interface or signage text.`,
  about: { zh: "《赛博朋克 2077》里义眼启动扫描的界面：近黑底、频道色的实色切角面板配黑字、斜体切片的标题，四角是取景框、镜头圆环和读数；红青色彩错位、信号撕裂、扫描线制造故障感，图形是用光线勾出的深色硬件。冷、硬、有速度感——适合科技、数码、游戏、夜景与城市。", en: "The interface of an optical implant starting up and scanning, after Cyberpunk 2077: near-black ground, solid chamfered panels in the channel colour with black lettering, slanted sliced headlines, viewfinder corners, lens rings and readouts; a red and cyan colour split, signal tears and scanlines for the glitch, objects as dark hardware drawn in lines of light. Cold, hard and fast — for tech, gadgets, games, night and city." },
  name: { zh: "赛博朋克", en: "Cyberpunk" },
  oneTheme: true,              // always dark: the light / dark choice does not apply
  seeded: true,                // scatters things at random: the Style tab offers to shuffle them
  scene: { sweep: { zh: "扫描光带", en: "Sweep line" } },
  params: [
    { key: "split", min: 0, max: 2, step: 0.05, def: 1, name: { zh: "色彩错位", en: "Colour split" } },
    { key: "tear", min: 0, max: 2, step: 0.05, def: 0.7, name: { zh: "信号撕裂", en: "Signal tear" } },
    { key: "scan", min: 0, max: 1, step: 0.05, def: 0.2, name: { zh: "扫描线", en: "Scanlines" } },
    { key: "decor", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "界面装饰", en: "Interface detail" } },
    { key: "sweep", min: 0, max: 1, step: 0.05, def: 0.7, name: { zh: "扫描光带", en: "Sweep line" } },
    { key: "glow", min: 0, max: 2, step: 0.05, def: 0.35, name: { zh: "线条光晕", en: "Line glow" } },
    { key: "photo", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "照片染色", en: "Photo tint" } },
    { key: "tearClear", toggle: true, min: 0, max: 1, step: 1, def: 1, name: { zh: "撕裂避开文字", en: "Keep tears off lettering" } },
  ],
  theme: (base, C) => ({ ...base, field: css(CY.deep), text: css(CY.white), dim: css(CY.white, 0.55), titleFill: css(CY.white), titleInk: css(CY.black), grid: () => css(C, 0.2) }),

  background(ctx, env, L, p) {
    const { w, h, C } = env;
    if (L.ground !== false) { ctx.fillStyle = css(CY.deep); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto();
      if (p.photo > 0) {   // pushed toward the channel colour and into the dark, like a still on a monitor
        ctx.save();
        ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = css(mix(CY.white, C, 0.75 * p.photo)); ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = css(CY.deep, 0.42 * p.photo); ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      return true;
    }
    if (!L.grid) return true;
    if (p.decor > 0) {   // a measured sheet: a field of dots, and a registration cross wherever four big squares meet
      ctx.fillStyle = css(C, 0.34);
      for (let x = 20; x < w; x += 60) for (let y = 20; y < h; y += 60) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      ctx.strokeStyle = css(C, 0.6); ctx.lineWidth = 2; ctx.beginPath();
      for (let x = 200; x < w; x += 240) for (let y = 200; y < h; y += 240) { ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); }
      ctx.stroke();
    }
    if (p.decor > 0.25) {   // the channel's code, enormous and barely there, running off the edge
      const str = (env.cat.code || env.cat.name || "").toUpperCase().slice(0, 6);
      if (str) {
        const fs = Math.min(w, h) * 0.62;
        ctx.save(); ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "right"; ctx.textBaseline = "alphabetic";
        ctx.lineWidth = 3; ctx.strokeStyle = css(C, 0.16 * p.decor); ctx.strokeText(str, w + fs * 0.06, h * 0.5 + fs * 0.36);
        ctx.restore();
      }
    }
    return true;
  },
  /** A HUD's measuring grid: dashed lines every 60 through the field of dots, solid ones every 240 through the registration crosses, ruler ticks along the edges. */
  gridLines(ctx, env, color) {
    const { w, h } = env, xs = every(20, w, 60), ys = every(20, h, 60);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.55; ctx.setLineDash([6, 10]); gridPath(ctx, xs, ys, 0, 0, w, h);
    ctx.globalAlpha = 1; ctx.setLineDash([]); gridPath(ctx, every(200, w, 240), every(200, h, 240), 0, 0, w, h);
    ctx.beginPath();
    xs.forEach((x, i) => { const l = i % 4 === 3 ? 28 : 12; ctx.moveTo(x, 0); ctx.lineTo(x, l); ctx.moveTo(x, h); ctx.lineTo(x, h - l); });
    ys.forEach((y, i) => { const l = i % 4 === 3 ? 28 : 12; ctx.moveTo(0, y); ctx.lineTo(l, y); ctx.moveTo(w, y); ctx.lineTo(w - l, y); });
    ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
  },

  accent: {
    fill: (C) => css(C),                    // a solid panel
    tone: () => "rgba(0,0,0,0)", toneScale: 0,
    /** A hard black edge, a cyan hairline beside it and a broken red one beyond that. */
    edge(ctx, run, nx, ny) {
      ctx.lineCap = "butt"; ctx.lineJoin = "miter";
      ctx.strokeStyle = css(CY.black); ctx.lineWidth = 12; run(0, 0);
      ctx.strokeStyle = css(CY.cyan); ctx.lineWidth = 3; run(nx * 17, ny * 17);
      ctx.strokeStyle = css(CY.red); ctx.setLineDash([70, 190]); run(nx * 26, ny * 26); ctx.setLineDash([]);
    },
  },

  /**
   * Lettering in the manner of the game's logotype: slanted, in the channel colour, with a black
   * keyline and a colour echo, and cut into three bands that sit slightly out of line.
   * Highlighted words are black on a chamfered plate.
   */
  runs(ctx, pass, o, p) {
    const fs = o.fs, C = o.C || CY.white, ink = o.fill || C, plateCol = o.hi || (o.fill && o.fill !== C ? o.fill : C);
    const g = fast ? 0 : fs * 0.03 * p.split * Math.max(0.3, o.shadowAmt), slip = fs * 0.03 * Math.min(1.5, p.split);
    ctx.lineJoin = "miter"; ctx.miterLimit = 3;
    ctx.transform(1, 0, -0.1, 1, 0, 0);   // a harder slant than the house style's
    const all = () => {
      if (!o.hiPlate) pass((a, x) => {   // the highlighted words on chamfered plates (unless the layer has plates of its own under them)
        if (!a.hi || a.first === false) return;   // one plate a run, under all its pieces
        const r = a.run || { x0: x, x1: x + ctx.measureText(a.t).width };
        const bx = r.x0 - fs * 0.07, by = -fs * 0.88, bw = r.x1 - r.x0 + fs * 0.14, bh = fs * 1.06, plate = (col) => { chamfer(ctx, bx, by, bw, bh, fs * 0.2); ctx.fillStyle = col; ctx.fill(); };
        echo(ctx, g * 1.3, plate); plate(css(plateCol));
      });
      echo(ctx, g, (col) => pass((a, x) => { if (a.hi) return; ctx.fillStyle = col; ctx.fillText(a.t, x, 0); }));
      if (o.strokeAmt > 0) pass((a, x) => { if (a.hi) return; ctx.strokeStyle = css(CY.black); ctx.lineWidth = fs * 0.07 * o.strokeAmt; ctx.strokeText(a.t, x, 0); });
      pass((a, x) => { ctx.fillStyle = a.hi ? css(o.hiPlate ? o.hi || CY.black : lum(plateCol) < 0.4 ? CY.white : CY.black) : css(ink); ctx.fillText(a.t, x, 0); });   // black on the plate, white on a dark one
    };
    // three bands, top to bottom, each nudged sideways, with a hairline of nothing between them
    for (const [y0, y1, dx] of [[-1.3, -0.6, slip], [-0.6, -0.27, 0], [-0.27, 0.5, -slip * 0.8]]) {
      ctx.save(); ctx.beginPath(); ctx.rect(-1e5, y0 * fs, 2e5, (y1 - y0) * fs - fs * 0.014); ctx.clip();
      ctx.translate(dx, 0); all(); ctx.restore();
    }
  },

  /** The plate under a text layer: chamfered, with a tab on its left edge and a colour echo. */
  plate(ctx, x, y, w, h, colour, fs, p) {
    const shape = (c) => { chamfer(ctx, x, y, w, h, fs * 0.34); ctx.fillStyle = c; ctx.fill(); ctx.fillRect(x - fs * 0.3, y + h / 2 - fs * 0.07, fs * 0.22, fs * 0.14); };
    echo(ctx, fast ? 0 : 6 * p.split, shape); shape(colour);
  },

  wrap: (ctx, C, p, plates) => (plates ? ctx : neonContext(ctx, C, p)),   // the small cover parts are already ink on colour

  /** The corner tag: a chamfered plate with a colour echo. Returns its box. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    ctx.font = `700 ${fs}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + fs * 1.1, h = fs * 1.34, plate = (col) => { chamfer(ctx, x, y, w, h, fs * 0.42); ctx.fillStyle = col; ctx.fill(); };
    echo(ctx, fast ? 0 : 7 * p.split, plate); plate(css(C));
    ctx.fillStyle = ink || css(CY.black); spaced(ctx, str, x + fs * 0.5, y + h * 0.5 + fs * 0.4, 3);
    ctx.fillRect(x + fs * 0.18, y + h - fs * 0.2, w - fs * 0.9, Math.max(3, fs * 0.05));   // a rule under the lettering
    return { x: x - 8, y: y - 4, w: w + 16, h: h + 8 };
  },

  /**
   * The frame layer: the view through an optical implant that has just started up and is scanning.
   * Corner brackets, the rings of a lens, a sweep line, a start-up log up the right edge, a ruler
   * up the left, and along the bottom a status line, a signal meter, a row of chevrons and a code.
   * Everything hugs the edges, and `decor` brings the parts in one by one.
   */
  frame(ctx, env, p) {
    const { w, h, C } = env, d = p.decor;
    brackets(ctx, 30, 30, w - 30, h - 30, 44, css(CY.white), 3);
    if (d <= 0) return;
    const P = env.o.profile, i = env.o.catIndex, total = P.categories.length, code = (env.cat.code || "CH").toUpperCase();
    ctx.save();
    ctx.globalCompositeOperation = "difference";   // readable on the dark field and on the colour panel alike
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = "#ffffff";
    ctx.font = `600 15px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    spaced(ctx, [`// ${code}`, `${pad2(i + 1)}/${pad2(total)}`, `${env.o.size.w}×${env.o.size.h}`].join("   "), 92, h - 40, 2);
    if (d > 0.2) {   // a signal meter after the status line: ten cells, some lit
      const lit = 5 + Math.floor(rand(11) * 5);
      for (let k = 0; k < 10; k++) { if (k < lit) ctx.fillRect(420 + k * 13, h - 53, 9, 14); else ctx.strokeRect(421 + k * 13, h - 52, 7, 12); }
    }
    if (d > 0.3) {   // ruler ticks up the left edge
      ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0, y = h * 0.3; y < h * 0.7; y += 14, k++) { ctx.moveTo(40, y); ctx.lineTo(40 + (k % 5 ? 8 : 18), y); }
      ctx.stroke();
    }
    if (d > 0.35) {   // the start-up log, set on its side up the right edge
      ctx.save(); ctx.translate(w - 44, h * 0.72); ctx.rotate(-Math.PI / 2);
      ctx.font = `600 13px ${fonts.mono}, ${fonts.cn}`;
      spaced(ctx, `OPTICS MK.${2 + Math.floor(rand(3) * 6)} // BOOT ${pad2(Math.floor(rand(4) * 99))}.${pad2(Math.floor(rand(5) * 99))}   CALIBRATION OK   SYNC ${70 + Math.floor(rand(6) * 29)}%   SCANNING`, 0, 0, 2);
      ctx.restore();
    }
    if (d > 0.5) {   // a code block in the lower right: bars of uneven width
      let x = w - 92;
      for (let k = 0; k < 26; k++) { const bw = 2 + Math.floor(noise(k * 3.1 + i) * 3) * 2; x -= bw + 3; ctx.fillRect(x, h - 62, bw, 24); }
    }
    if (d > 0.6) {   // a row of chevrons, as on a warning strip
      for (let k = 0; k < 9; k++) { const x = w - 92 - 250 - k * 17; ctx.beginPath(); ctx.moveTo(x, h - 38); ctx.lineTo(x + 8, h - 50); ctx.lineTo(x + 14, h - 50); ctx.lineTo(x + 6, h - 38); ctx.closePath(); ctx.fill(); }
    }
    ctx.restore();
    if (d > 0.4) {   // a short hazard stripe under the upper right bracket
      const x0 = w - 300, y0 = 126, sw = 228, sh = 12;
      ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, sw, sh); ctx.clip();
      ctx.fillStyle = css(C); ctx.fillRect(x0, y0, sw, sh);
      ctx.fillStyle = css(CY.black);
      for (let x = x0 - sh; x < x0 + sw; x += 22) { ctx.beginPath(); ctx.moveTo(x, y0 + sh); ctx.lineTo(x + sh, y0); ctx.lineTo(x + sh + 10, y0); ctx.lineTo(x + 10, y0 + sh); ctx.closePath(); ctx.fill(); }
      ctx.restore();
    }
    if (d > 0.45) {   // the lens: two rings about the centre, broken into arcs, the outer one graduated
      const cx = w / 2, cy = h / 2, R = Math.hypot(w, h) * 0.33, turn = rand(21) * Math.PI * 2;
      ctx.save(); ctx.strokeStyle = css(CY.cyan, 0.3 * d); ctx.lineWidth = 2;
      for (const [r, arcs] of [[R, [[0.1, 0.9], [1.2, 2.3], [2.6, 3.4], [3.9, 5.7]]], [R * 0.93, [[0.5, 1.6], [3.2, 4.6]]]]) for (const [a0, a1] of arcs) { ctx.beginPath(); ctx.arc(cx, cy, r, a0 + turn, a1 + turn); ctx.stroke(); }
      ctx.beginPath();
      for (let a = 0; a < 1.2; a += 0.04) { const c = Math.cos(a + turn + 2.6), s = Math.sin(a + turn + 2.6); ctx.moveTo(cx + c * R * 1.015, cy + s * R * 1.015); ctx.lineTo(cx + c * R * 1.04, cy + s * R * 1.04); }
      ctx.stroke(); ctx.restore();
    }
    if (p.sweep > 0) {   // the sweep: a line of light across the picture with the band it has just read above it.
      // Where it sits is left to chance, unless it was dragged (a scene object); its slider is how strong it is (0 hides it).
      const [, y] = objAt("sweep", w / 2, h * (0.2 + rand(31) * 0.6), ctx, "y"), k = p.sweep / 0.7, trail = ctx.createLinearGradient(0, y - 110, 0, y);
      trail.addColorStop(0, css(CY.cyan, 0)); trail.addColorStop(1, css(CY.cyan, Math.min(0.5, 0.11 * k)));
      ctx.fillStyle = trail; ctx.fillRect(0, y - 110, w, 110);
      ctx.fillStyle = css(CY.cyan, Math.min(1, 0.85 * k)); ctx.fillRect(0, y, w, 2);
      ctx.fillStyle = css(CY.white, Math.min(1, 0.9 * k)); ctx.fillRect(w * rand(32) * 0.7, y - 1, w * 0.12, 4);
    }
  },

  /**
   * Around the channel graphic: the scanner has locked on. A graduated ring, and a callout with
   * what it has read. Drawn in the graphic's own space (`half` are its half-extents), so it moves
   * and scales with the graphic.
   */
  subject(ctx, half, env, p) {
    if (p.decor <= 0.3) return;
    const r = Math.max(half.hw, half.hh) * 1.06, C = env.C, turn = rand(41) * 6;
    ctx.save(); ctx.lineCap = "butt";
    ctx.strokeStyle = css(CY.cyan, 0.85); ctx.lineWidth = 4;
    for (const [a0, a1] of [[0.2, 1.3], [1.9, 2.9], [3.5, 4.4], [5.0, 5.9]]) { ctx.beginPath(); ctx.arc(0, 0, r, a0 + turn, a1 + turn); ctx.stroke(); }
    ctx.lineWidth = 3; ctx.beginPath();
    for (let a = 0; a < 1.0; a += 0.07) { const c = Math.cos(a + turn + 1.35), s = Math.sin(a + turn + 1.35); ctx.moveTo(c * r * 1.03, s * r * 1.03); ctx.lineTo(c * r * 1.09, s * r * 1.09); }
    ctx.stroke();
    // the callout: a leader from the ring up and out to a label
    const ax = r * 0.72, ay = -r * 0.72, bx = ax + 60, by = ay - 60, total = env.o.profile.categories.length;
    ctx.strokeStyle = css(CY.white, 0.95); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(bx + 46, by); ctx.stroke();
    ctx.font = `700 34px ${fonts.mono}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const label = `[ ${(env.cat.code || "TARGET").toUpperCase()} ]`, lw = ctx.measureText(label).width + 28;
    ctx.fillStyle = css(CY.black, 0.82); ctx.fillRect(bx + 52, by - 34, lw, 76);
    ctx.fillStyle = css(CY.white); ctx.fillText(label, bx + 66, by - 2);
    ctx.font = `600 22px ${fonts.mono}, ${fonts.cn}`; ctx.fillStyle = css(CY.cyan);
    ctx.fillText(`ID ${pad2(env.o.catIndex + 1)}/${pad2(total)}  ${82 + Math.floor(rand(42) * 17)}%`, bx + 66, by + 28);
    ctx.restore();
  },

  sticker: {
    shape(ctx, path, fill, { shadow = true, lw = 7 } = {}, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 4; ctx.lineCap = "butt";
      if (shadow) echo(ctx, fast ? 0 : 6 * p.split, (col) => { ctx.beginPath(); path(ctx); ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.fill(); ctx.stroke(); });
      ctx.beginPath(); path(ctx); ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw * 0.8; ctx.strokeStyle = css(CY.black); ctx.stroke();
    },
    blob(ctx, paths, fill, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 4;
      echo(ctx, fast ? 0 : 6 * p.split, (col) => { for (const path of paths) { ctx.beginPath(); path(ctx); ctx.fillStyle = ctx.strokeStyle = col; ctx.lineWidth = 12; ctx.fill(); ctx.stroke(); } });
      for (const pass of [0, 1]) for (const path of paths) {   // outline of the union, then fills over the inner seams
        ctx.beginPath(); path(ctx);
        if (pass === 0) { ctx.fillStyle = ctx.strokeStyle = css(CY.black); ctx.lineWidth = 11; ctx.fill(); ctx.stroke(); }
        else { ctx.fillStyle = fill; ctx.fill(); }
      }
    },
    stroke(ctx, draw, color, lw = 30, p) {
      ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.miterLimit = 4;
      const line = (col, w) => { ctx.beginPath(); draw(ctx); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); };
      echo(ctx, fast ? 0 : 6 * p.split, (col) => line(col, lw + 10));
      line(css(CY.black), lw + 10); line(color, lw);
    },
    thin(ctx, draw, lw, color) { ctx.beginPath(); draw(ctx); ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.stroke(); },
    word(ctx, str, x, y, size, fill, p) {
      ctx.lineJoin = "miter"; ctx.miterLimit = 3;
      echo(ctx, fast ? 0 : size * 0.05 * p.split, (col) => { ctx.fillStyle = col; ctx.fillText(str, x, y); });
      ctx.lineWidth = size * 0.18; ctx.strokeStyle = css(CY.black); ctx.strokeText(str, x, y);
      ctx.fillStyle = fill; ctx.fillText(str, x, y);
    },
  },

  /** An uploaded image gets a hard cyan echo where the house style has an ink shadow. */
  image(ctx, C, unit, p) { ctx.shadowColor = css(CY.cyan); ctx.shadowBlur = 0; ctx.shadowOffsetX = -10 * unit * p.split; ctx.shadowOffsetY = 5 * unit * p.split; },

  post(ctx, w, h, C, p, unit = 1, hits = []) {
    // The colour split and the signal tear, over the whole picture: red pulled one way, green and
    // blue the other, and a few horizontal bands knocked sideways. They cost several whole-canvas
    // copies, so they are left out of the frames of a drag (see setFast).
    const sh = Math.round(1.7 * p.split * unit), cv = ctx.canvas;
    if ((sh >= 1 || p.tear > 0) && !fast && cv && typeof document !== "undefined") {
      const W = cv.width, H = cv.height;
      const part = (i, tint) => {   // the picture with only some of its colour channels left
        const c = SPLIT[i] || (SPLIT[i] = document.createElement("canvas"));
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        const x = c.getContext("2d");
        x.globalCompositeOperation = "copy"; x.drawImage(cv, 0, 0);
        x.globalCompositeOperation = "multiply"; x.fillStyle = tint; x.fillRect(0, 0, W, H);
        return c;
      };
      const red = part(0, "#ff0000"), rest = part(1, "#00ffff");
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "copy"; ctx.drawImage(red, sh, 0);
      ctx.globalCompositeOperation = "lighter";
      if (sh > 0) ctx.drawImage(red, 0, 0, 1, H, 0, 0, sh, H);     // the strips the shift leaves uncovered
      ctx.drawImage(rest, -sh, 0);
      if (sh > 0) ctx.drawImage(rest, W - 1, 0, 1, H, W - sh, 0, sh, H);
      // torn bands: the same two images again, inside a thin strip, pushed sideways. Where they fall
      // is random but tied to the profile's seed, so they hold still until the user shuffles them.
      const bands = Math.round(5 * Math.min(1.6, p.tear));
      // rows taken up by lettering, in canvas pixels: a tear through them makes them hard to read
      const kept = p.tearClear ? hits.filter((t) => LETTERING.includes(t.type)).map((t) => { const a = (t.r || 0) * Math.PI / 180, half = Math.abs(t.hw * Math.sin(a)) + Math.abs(t.hh * Math.cos(a)) + 10; return [(t.cy - half) * unit, (t.cy + half) * unit]; }) : [];
      const clear = (y, bh) => kept.every(([a, b]) => y + bh < a || y > b);
      for (let k = 0; k < bands; k++) {
        const bh = Math.round((5 + rand(k * 3.7 + 2) * 17) * unit), dx = Math.round((rand(k * 5.1 + 3) - 0.5) * 2 * 38 * unit * p.tear);
        let y = Math.round(rand(k * 7.3 + 1) * H);
        // a band that lands on lettering is thrown again, a fixed number of times, then given up
        for (let again = 1; again <= 16 && !clear(y, bh); again++) y = Math.round(rand(k * 7.3 + 1 + again * 13.7) * H);
        if (!clear(y, bh)) continue;
        ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, bh); ctx.clip();
        ctx.globalCompositeOperation = "copy"; ctx.drawImage(red, sh * 2 + dx, 0);
        ctx.globalCompositeOperation = "lighter"; ctx.drawImage(rest, -sh * 2 + dx, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    if (p.scan > 0) {
      ctx.fillStyle = css([0, 0, 0], 0.34 * p.scan);
      for (let y = 0; y < h; y += 6) ctx.fillRect(0, y, w, 2.4);
    }
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.5, w / 2, h / 2, Math.hypot(w, h) * 0.62);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, css(CY.black, 0.42));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  },

  prompt: `Hard-edged cyberpunk signage — the stickers and warning labels of a neon city — that reads at a glance:
- angular, engineered shapes: chamfered corners, straight cuts, notches and bevels rather than soft curves; a strong silhouette; no realism, no perspective, no fine detail;
- flat solid colour only — never gradients, textures or transparency;
- every shape automatically gets a black outline and a red and cyan colour echo behind it: do NOT draw outlines, echoes or shadows yourself;
- 2 to 3 colours per sticker: the main colour and black ("ink") as partners, with white or one small accent; black panels, bars and stripes inside a shape are welcome.`,
  solidPrompt: `Hard-surface cyberpunk hardware — devices, machines and vehicles from a neon city — that reads at a glance on a dark cover:
- built from a few boxes and cylinders with chamfered, engineered proportions; add small technical parts (vents, antennas, armour plates, cables as thin boxes) where they help; no realism, no fine detail;
- the renderer turns every face into dark glass and draws every edge as a line of light: do NOT try to draw shading, outlines or glow yourself;
- "white" and "dark" both come out as dark surfaces, so shape and edges carry the object; use "main" for the parts that should light up in solid colour, and marks in "main" for lit details (screens, lamps, indicator strips).`,
};
cyber.elementFx = [
  { key: "split", name: { zh: "色彩错位", en: "Colour split" }, for: FX_ALL, stage: "filter", reach: (B, k) => ({ l: 12 * k, r: 12 * k }),
    /** Red and cyan pulled apart sideways, fringing the layer's edges. */
    paint(x, B, a, E) { const d = (1.5 + 8 * a) * E.k; rePlate(x, B, [[[255, 0, 0], -d, 0], [[0, 255, 255], d, 0]]); } },
  { key: "tear", name: { zh: "信号撕裂", en: "Signal tear" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.2, r: B.w * 0.2 }),
    /** A few thick bands of the layer torn sideways, a red line along the top of each, a cyan one along its foot. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), n = 1 + Math.round(4 * a), cuts = [0];
      for (let i = 0; i < n; i++) cuts.push(clamp((i + 0.3 + E.R(i * 2.3 + 41) * 0.5) / n), clamp((i + 0.55 + E.R(i * 3.1 + 42) * 0.4) / n));
      cuts.push(1); cuts.sort((p, q) => p - q);
      const off = (i) => (i % 2 ? (E.R(i * 4.7 + 43) - 0.5) * B.w * 0.28 * (0.4 + a) : 0);
      cutBands(x, B, src, cuts, off);
      for (let i = 1; i < cuts.length - 1; i += 2) { const y0 = B.y0 + cuts[i] * B.h, y1 = B.y0 + cuts[i + 1] * B.h, dx = off(i); x.fillStyle = css(CY.red, 0.85); x.fillRect(B.x0 + dx, y0, B.w, Math.max(1, E.k)); x.fillStyle = css(CY.cyan, 0.85); x.fillRect(B.x0 + dx, y1 - Math.max(1, E.k), B.w, Math.max(1, E.k)); }
    } },
  { key: "glow", name: { zh: "线条光晕", en: "Line glow" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ l: 60 * k, t: 60 * k, r: 60 * k, b: 60 * k }),
    /** The neon halo of the channel colour round the layer: a tight bright one, a wide faint one. */
    paint(x, B, a, E) { const src = region(x, B, "fxA"), c = boost(E.C, 0.8), col = sat(c) < 0.2 ? CY.cyan : c; glowBehind(x, B, src, (3 + 8 * a) * E.k, Math.min(1, a * 2.5), col); glowBehind(x, B, src, (8 + 26 * a) * E.k, 0.8 * a, col); } },
  { key: "tint", name: { zh: "照片染色", en: "Photo tint" }, for: FX_PHOTO, stage: "filter",
    /** The photo pressed into the night and neon of the city: black, the channel colour, a white highlight. */
    paint: tonesFx((E) => [[0, CY.deep], [0.45, mix(boost(E.C, 0.8), CY.deep, 0.4)], [0.78, boost(E.C, 0.8)], [1, CY.white]]) },
];
// What five looks' own letterings do, as effects worked on any layer's pixels once it is painted: so they
// go with whatever text effect a text layer has, and on a sticker, a photo or a colour as well.
cyber.elementFx.push({ key: "sliced", name: { zh: "三段切片", en: "Three slices" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.h * 0.16, r: B.h * 0.16, t: B.h * 0.03, b: B.h * 0.03 }),
  /** The layer cut across in three bands — the top one slipped right, the bottom one left, a hairline of nothing between them — with a red and a cyan echo behind. */
  paint(x, B, a) {
    const src = region(x, B, "fxSlice"), slip = B.h * 0.08 * a, gap = B.h * 0.014 * a, d = B.h * 0.035 * a;
    cutBands(x, B, src, [0, 0.4, 0.66, 1], (i) => [slip, 0, -slip * 0.8][i]);
    if (gap > 0.3) for (const t of [0.4, 0.66]) x.clearRect(B.x0 - slip * 2, B.y0 + B.h * t - gap / 2, B.w + slip * 4, gap);
    const W = x.canvas.width, x0 = Math.max(0, Math.floor(B.x0 - slip * 1.2 - 2)), x1 = Math.min(W, Math.ceil(B.x1 + slip * 1.2 + 2)), P = { x0, y0: B.y0, w: x1 - x0, h: B.h }, cut = region(x, P, "fxSliceCut");
    x.save(); x.globalCompositeOperation = "destination-over"; x.globalAlpha = Math.min(1, a * 2.5);
    for (const [dx, dy, col] of [[-d, d * 0.35, CY.cyan], [d, -d * 0.35, CY.red]]) x.drawImage(shapeIn(cut, col, "fxSliceEcho"), P.x0 + dx, P.y0 + dy);
    x.restore();
  } });
