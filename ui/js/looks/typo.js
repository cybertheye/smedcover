// experimental type: the poster made of lettering
// Swiss and experimental typographic posters: a white sheet and black type, the type itself the
// picture — cut along a slant and knocked out of line, echoed in fading layers, dissolving into dots;
// a burst of hairlines, dry-brush strokes behind, giant letters cut across, a hairline grid with small
// markers. One colour only, the channel's, on the block.
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, FX_PHOTO, TAU, canPaint, clamp, css, cutBands, dark, every, fall, fast, grain, gridPath, gridPen, inkAs, layDown, mapped, mix, objAt, openField, pad2, painters, rand, region, shapeIn, shift, tonesFx, trail, upright, workLike } from "./kit.js";
import { fonts, spaced, spacedW } from "../cel.js";
import { blockLayout } from "../layout.js";

const TY = { paper: [244, 243, 240], ink: [14, 14, 14], night: [14, 14, 14] };
const tyGround = () => (dark ? TY.night : TY.paper), tyInk = () => (dark ? TY.paper : TY.ink);
export const typo = {
  id: "typo",
  repaint: (c) => `a high-contrast black-and-white photograph for a Swiss typographic poster: crisp, graphic, deep blacks and clean whites, little mid-tone, generous empty space; still the same picture, no colour, no text.`,
  about: { zh: "实验字体：瑞士和实验派的文字海报——白纸黑字，文字本身就是画面：沿斜线切开错位、一层层向上叠出残影、从一侧消散成粒子；放射的细线、干笔刷痕、被斜线切开的巨型字母、带小圆点标记的细线网格；整张只有一种颜色，就是频道色的色块。可选白底黑字或黑底白字。理性、锋利、有设计感——适合设计、展览、讲座、音乐节、科技与观点类内容。", en: "Experimental type: Swiss and experimental typographic posters — black type on a white sheet, the type itself the picture: cut along a slant and knocked out of line, echoed in fading layers, dissolving into dots at one end; a burst of hairlines, dry-brush strokes, giant letters cut across, a hairline grid with small markers; one colour only, the channel's, on the block. Black on white or white on black. Rational, sharp, designed — for design, exhibitions, talks, festivals, tech and opinion." },
  name: { zh: "实验字体", en: "Experimental type" },
  seeded: true,
  scene: { letters: { zh: "巨型字母", en: "Giant letters" }, burst: { zh: "放射细线中心", en: "Centre of the radiating lines" } },
  params: [
    { key: "slice", min: 0, max: 1, step: 0.05, def: 0.5, name: { zh: "标题切割错位", en: "Title cut and shifted" } },
    { key: "echo", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "标题层叠残影", en: "Title echoes" } },
    { key: "scatter", min: 0, max: 1, step: 0.05, def: 0.35, name: { zh: "标题粒子消散", en: "Title dissolving" } },
    { key: "burst", min: 0, max: 1, step: 0.05, def: 0.25, name: { zh: "放射细线", en: "Burst of lines" } },
    { key: "brush", min: 0, max: 1, step: 0.05, def: 0.3, name: { zh: "干笔刷痕", en: "Dry brush" } },
    { key: "giant", min: 0, max: 1, step: 0.05, def: 0.45, name: { zh: "巨型字母", en: "Giant letters" } },
    { key: "letters", text: true, max: 8, def: "", name: { zh: "字母内容", en: "Their letters" }, placeholder: { zh: "留空：用频道代号", en: "Empty: the channel's code" } },
    { key: "grid", min: 0, max: 1, step: 0.05, def: 0.6, name: { zh: "细线网格", en: "Hairline grid" } },
    { key: "grain", min: 0, max: 1, step: 0.05, def: 0.15, name: { zh: "纸张颗粒", en: "Paper grain" } },
    { key: "mono", needsPhoto: true, min: 0, max: 1, step: 0.05, def: 1, name: { zh: "黑白高反差", en: "Hard black and white" } },
  ],
  titleFont: (f) => `${f.en}, ${f.cn}`,
  layout: (template, w, h) => blockLayout(template, w, h, { band: 0.18, side: 0.28, strip: 0.1 }),
  theme: (base) => ({ ...base, field: css(tyGround()), text: css(tyInk()), dim: css(tyInk(), 0.55), titleFill: css(tyInk()), titleInk: css(tyGround()), grid: () => css(tyInk(), 0.1) }),
  /** The sheet, a burst of hairlines, dry-brush strokes, giant letters cut across. A photo goes hard black and white. */
  background(ctx, env, L, p) {
    const { w, h } = env, u = Math.min(w, h), ground = tyGround(), ink = tyInk(), F = openField(env);
    if (L.ground !== false) { ctx.fillStyle = css(ground); ctx.fillRect(0, 0, w, h); }
    if (env.photo) {
      env.drawPhoto(p.mono);
      if (p.mono > 0) { ctx.save(); ctx.globalCompositeOperation = "soft-light"; ctx.globalAlpha = p.mono; env.drawPhoto(1); env.drawPhoto(1); ctx.restore(); }
      return true;
    }
    if (!L.grid) return true;
    if (p.giant > 0) {   // the letters typed in, or the channel's code: huge, each cut along a slant and the halves pulled apart
      // up to three stand in two staggered rows, as they always did; a longer word runs in one line, stepping a
      // little down, spread wider and set no larger than lets it fit, so it still reads left to right
      const word = [...((p.letters || env.cat.code || env.cat.name || "A").toUpperCase())].filter((c) => c.trim()).slice(0, 8), n = word.length, line = n > 3, more = clamp((n - 3) / 5);
      const fw = F.x1 - F.x0, fh = F.y1 - F.y0, span = 0.42 + 0.26 * more;
      ctx.save(); ctx.font = `400 100px ${fonts.serif}`;
      shift("letters", F.x0 + fw * (0.3 - 0.06 * more + span * 0.5), F.y0 + fh * 0.72, ctx);   // a scene object: the letters move as one
      const wide = word.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) / 100;   // the word's width at size 1
      const fs = Math.min(fh * (0.5 + 0.35 * p.giant), line ? (fw * span * 1.15) / Math.max(0.1, wide) : Infinity);
      ctx.font = `400 ${fs}px ${fonts.serif}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = css(mix(ground, ink, 0.12 + 0.75 * p.giant));
      word.forEach((ch, i) => {
        const cx = F.x0 + fw * (0.3 - 0.06 * more + span * ((i + 0.5) / n)), cy = F.y0 + fh * (line ? 0.6 + (0.2 * i) / (n - 1) : 0.62 + (i % 2) * 0.26), a = 0.5 + rand(i + 360) * 0.6, gap = fs * 0.05 * p.giant;
        for (const side of [-1, 1]) {   // the halves either side of the cut, moved apart along it
          ctx.save(); ctx.beginPath(); const nx = Math.cos(a), ny = Math.sin(a), R = fs * 2;
          ctx.moveTo(cx - nx * R, cy - ny * R); ctx.lineTo(cx + nx * R, cy + ny * R); ctx.lineTo(cx + nx * R - side * ny * R, cy + ny * R + side * nx * R); ctx.lineTo(cx - nx * R - side * ny * R, cy - ny * R + side * nx * R); ctx.closePath(); ctx.clip();
          ctx.fillText(ch, cx + side * nx * gap, cy + fs * 0.34 + side * ny * gap); ctx.restore();
        }
        ctx.strokeStyle = css(ink, 0.6); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * fs * 0.6, cy - Math.sin(a) * fs * 0.6); ctx.lineTo(cx + Math.cos(a) * fs * 0.6, cy + Math.sin(a) * fs * 0.6); ctx.stroke();
      });
      ctx.restore();
    }
    if (p.burst > 0) {   // tapering hairlines from a point, of every length
      const [bx, by] = objAt("burst", F.x0 + (F.x1 - F.x0) * 0.62, F.y0 + (F.y1 - F.y0) * 0.55, ctx), n = Math.round(40 + 260 * p.burst), R = Math.hypot(w, h);   // their centre: a scene object
      ctx.fillStyle = css(ink, 0.9);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (rand(i * 1.3 + 370) - 0.5) * 0.04, r0 = u * (0.03 + Math.pow(rand(i * 2.9 + 371), 2) * 0.35), r1 = r0 + R * (0.1 + rand(i * 4.1 + 372) * 0.9) * (0.4 + 0.6 * p.burst), wd = 0.4 + rand(i * 5.3 + 373) * 2.6;
        const c = Math.cos(a), s = Math.sin(a);
        ctx.beginPath(); ctx.moveTo(bx + c * r0, by + s * r0); ctx.lineTo(bx + c * r1 - s * wd, by + s * r1 + c * wd); ctx.lineTo(bx + c * r1 + s * wd, by + s * r1 - c * wd); ctx.closePath(); ctx.fill();
      }
    }
    if (p.brush > 0) {   // dry-brush strokes across the field: many thin bristle lines, ragged at both ends
      const n = Math.round(2 + 6 * p.brush), col = mix(ground, ink, 0.55);
      for (let k = 0; k < n; k++) {
        const y = F.y0 + (F.y1 - F.y0) * (0.12 + (k + rand(k + 380) * 0.6) / (n + 0.6) * 0.8), x0 = F.x0 + (F.x1 - F.x0) * (0.02 + rand(k * 2.3 + 381) * 0.2), x1 = F.x1 - (F.x1 - F.x0) * (0.02 + rand(k * 3.1 + 382) * 0.25), bh = u * (0.03 + rand(k * 4.7 + 383) * 0.04), tilt = (rand(k * 5.9 + 384) - 0.5) * bh * 1.5;
        for (let j = 0; j < 46; j++) {
          const t = j / 45, yy = y + (t - 0.5) * bh, s0 = x0 + rand(k * 31 + j * 0.7 + 385) * (x1 - x0) * 0.08, s1 = x1 - rand(k * 37 + j * 0.9 + 386) * (x1 - x0) * 0.1;
          ctx.strokeStyle = css(col, (0.15 + rand(k * 41 + j * 1.1 + 387) * 0.6) * p.brush); ctx.lineWidth = 0.6 + rand(k * 43 + j * 1.3 + 388) * 2.4;
          ctx.beginPath(); ctx.moveTo(s0, yy); ctx.bezierCurveTo(s0 + (s1 - s0) * 0.33, yy + tilt, s0 + (s1 - s0) * 0.66, yy - tilt * 0.6, s1, yy + tilt * 0.3); ctx.stroke();
        }
      }
    }
    return true;
  },
  /** The Swiss grid: twelve columns with their gutters, eight fields down, a marker where the fields meet the gutters. */
  gridLines(ctx, env, color) {
    const { w, h } = env, m = 60, g = 20, cw = (w - 2 * m - 11 * g) / 12, fh = (h - 2 * m) / 8, xs = [], ys = every(m, h - m + 1, fh);
    for (let i = 0; i < 12; i++) xs.push(m + i * (cw + g), m + i * (cw + g) + cw);
    gridPen(ctx, color);
    ctx.globalAlpha = 0.6; gridPath(ctx, xs, [], 0, m, 0, h - m);
    ctx.globalAlpha = 1; gridPath(ctx, [], ys, m, 0, w - m, 0);
    ctx.beginPath(); for (let i = 1; i < 12; i++) for (const y of ys) { const x = m + i * (cw + g) - g / 2; ctx.moveTo(x + 4, y); ctx.arc(x, y, 4, 0, TAU); } ctx.fill();
    ctx.restore();
  },
  accent: { fill: (C) => css(C), tone: () => "rgba(0,0,0,0)", toneScale: 0, edge() {} },   // the one colour, flat
  /**
   * The title as the picture: echoes stacked above it, fading (the echo slider); the letters cut along
   * slanted lines and each band knocked sideways (the cut slider); and the end of the line dissolving
   * into dots (the dissolve slider) — the letters painted on a work canvas, eaten away cell by cell
   * toward the end, each cell thrown out as a dot.
   */
  runs(ctx, pass, o, p) {
    upright(ctx);
    const fs = o.fs, ink = o.fill || tyInk(), hi = o.hi || o.C || ink;
    let right = 0;
    pass((a, x) => { right = Math.max(right, x + ctx.measureText(a.t).width); });
    const paint = (c, dx, dy, alpha = 1) => pass((a, x) => { c.globalAlpha = alpha; c.fillStyle = css(a.hi ? hi : ink); c.fillText(a.t, x + dx, dy); });
    const cuts = p.slice > 0 ? Math.round(1 + 3 * p.slice) : 0, slope = -0.06, L0 = -fs, L1 = right + fs;
    const lines = Array.from({ length: cuts }, (_, k) => -fs * 0.82 + fs * 0.86 * ((k + 0.5 + (rand(k * 3.7 + 390) - 0.5) * 0.5) / cuts));
    const letters = (c) => {
      if (p.echo > 0) for (let i = Math.round(1 + 4 * p.echo); i >= 1; i--) paint(c, ...fall(0, -i * fs * 0.11 * (0.5 + p.echo)), (0.32 * p.echo) / i);   // up the page, in a column too
      if (!cuts) return paint(c, 0, 0);
      for (let k = 0; k <= cuts; k++) {   // band k lies between cut k-1 and cut k
        const top = k ? lines[k - 1] : -fs * 3, bot = k < cuts ? lines[k] : fs * 3, shift = (k % 2 ? 1 : -1) * fs * (0.03 + 0.09 * p.slice) * (0.6 + rand(k * 5.1 + 391) * 0.8);
        c.save(); c.beginPath(); c.moveTo(L0, top + slope * L0); c.lineTo(L1, top + slope * L1); c.lineTo(L1, bot + slope * L1); c.lineTo(L0, bot + slope * L0); c.closePath(); c.clip();
        paint(c, shift, 0); c.restore();
      }
    };
    if (!(p.scatter > 0) || fast || !canPaint(ctx)) { letters(ctx); ctx.globalAlpha = 1; return; }
    const x = workLike(ctx, "typo");
    letters(x); x.globalAlpha = 1;
    const m = ctx.getTransform(), corners = [[-fs * 0.2, -fs * 1.6], [right + fs * 0.3, -fs * 1.6], [-fs * 0.2, fs * 0.45], [right + fs * 0.3, fs * 0.45]].map(([a, b]) => [m.a * a + m.c * b + m.e, m.b * a + m.d * b + m.f]);
    const X0 = Math.max(0, Math.floor(Math.min(...corners.map((q) => q[0])))), Y0 = Math.max(0, Math.floor(Math.min(...corners.map((q) => q[1]))));
    const X1 = Math.min(x.canvas.width, Math.ceil(Math.max(...corners.map((q) => q[0])))), Y1 = Math.min(x.canvas.height, Math.ceil(Math.max(...corners.map((q) => q[1]))));
    if (X1 - X0 > 4 && Y1 - Y0 > 4) {
      const W = X1 - X0, H = Y1 - Y0, img = x.getImageData(X0, Y0, W, H).data, k = Math.hypot(m.a, m.b), cell = Math.max(3, Math.round(fs * 0.03 * k)), start = 1 - 0.8 * p.scatter, dots = [];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      for (let gy = 0; gy < H; gy += cell) for (let gx = 0; gx < W; gx += cell) {
        const i = ((gy + (cell >> 1)) * W + gx + (cell >> 1)) * 4;
        if (i >= img.length || img[i + 3] < 110) continue;
        const t = gx / W, f = clamp((t - start) / (1 - start + 1e-6));
        const r = rand(gx * 0.173 + gy * 7.31 + 400);
        if (r >= f * f * 1.1) continue;
        x.clearRect(X0 + gx, Y0 + gy, cell, cell);
        const thrown = rand(gx * 0.31 + gy * 3.7 + 401);
        dots.push([X0 + gx + cell / 2 + thrown * f * W * 0.18, Y0 + gy + cell / 2 + (rand(gx * 0.57 + gy * 1.9 + 402) - 0.5) * f * H * 0.9, cell * (0.18 + rand(gx + gy * 0.3 + 403) * 0.32), `rgba(${img[i]},${img[i + 1]},${img[i + 2]},${img[i + 3] / 255})`]);
      }
      for (const [dx, dy, r, col] of dots) { x.fillStyle = col; x.beginPath(); x.arc(dx, dy, r, 0, TAU); x.fill(); }
      x.restore();
    }
    layDown(ctx, x);
  },
  wrap: (ctx, C, p, plates) => mapped(ctx, plates
    ? { fill: { ink: tyInk() }, stroke: { ink: tyInk() } }
    : { fill: { ink: tyInk(), light: tyGround(), mid: mix(tyGround(), tyInk(), 0.2), dark: tyInk(), colour: () => C }, stroke: { ink: tyInk(), light: tyGround() }, line: 0.45 }),
  sticker: painters({ line: null, shadow: null, tone: (fill) => inkAs(tyInk())(fill) }),
  /** The corner tag: lettering reversed out of a black bar. */
  tag(ctx, str, x, y, fs, C, p, ink) {
    const f = fs * 0.72;
    ctx.font = `700 ${f}px ${fonts.en}, ${fonts.cn}`; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    const w = spacedW(ctx, str, 3) + f * 0.8, h = f * 1.2, top = y + (fs * 1.34 - h);
    ctx.fillStyle = css(tyInk()); ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ink || css(tyGround()); spaced(ctx, str, x + f * 0.4, top + h * 0.5 + f * 0.36, 3);
    return { x: x - 4, y: top - 4, w: w + 8, h: h + 8 };
  },
  /** The frame layer: a hairline grid — a long rule across, a few verticals, small circles where they cross, a cross mark, small figures. */
  frame(ctx, env, p) {
    const a = p.grid;
    if (a <= 0) return;
    const { w, h } = env, ink = tyInk(), i = env.o.catIndex, F = openField(env);
    ctx.save(); ctx.strokeStyle = css(ink, 0.75 * a); ctx.fillStyle = css(ink, 0.85 * a); ctx.lineWidth = 1;
    const ys = [F.y0 + (F.y1 - F.y0) * 0.36], xs = [0.18, 0.47, 0.83].map((t) => F.x0 + (F.x1 - F.x0) * t);
    if (a > 0.5) ys.push(F.y0 + (F.y1 - F.y0) * 0.78);
    for (const y of ys) { ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(w - 40, y); ctx.stroke(); }
    xs.forEach((x, k) => { ctx.beginPath(); ctx.moveTo(x, 40 + k * 30); ctx.lineTo(x, h - 40); ctx.stroke(); for (const y of ys) { ctx.beginPath(); ctx.arc(x, y, 4 + 3 * a, 0, TAU); (k + i) % 2 ? ctx.fill() : ctx.stroke(); } });
    ctx.lineWidth = 3; const cx = xs[1], cy = 64; ctx.beginPath(); ctx.moveTo(cx - 9, cy - 9); ctx.lineTo(cx + 9, cy + 9); ctx.moveTo(cx + 9, cy - 9); ctx.lineTo(cx - 9, cy + 9); ctx.stroke();
    ctx.font = `600 14px ${fonts.mono}, ${fonts.cn}`; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    spaced(ctx, `${pad2(i + 1)}.${pad2(env.o.profile.categories.length)}`, xs[0] + 10, ys[0] - 10, 3);
    ctx.textAlign = "right"; ctx.fillText((env.cat.code || "").toUpperCase(), xs[2] - 10, ys[0] - 10);
    ctx.save(); ctx.translate(xs[2] + 22, h * 0.6); ctx.rotate(-Math.PI / 2); ctx.textAlign = "left"; spaced(ctx, (env.o.profile.brand.name || "").toUpperCase(), 0, 0, 4); ctx.restore();
    ctx.restore();
  },
  image(ctx, C, unit) { ctx.shadowColor = "rgba(0,0,0,0)"; },
  post(ctx, w, h, C, p, unit = 1) { grain(ctx, p.grain * 0.8, unit, !dark); },
  prompt: `Stickers for a Swiss typographic poster — strict, graphic and economical — that read at a glance:
- simple geometric or typographic shapes: arrows, circles, crosses, brackets, a single bold letter or numeral, an asterisk, a hand pointing; no realism, no perspective, no detail;
- flat colour only: black ("ink"), white ("white") and at most a small part in the main colour;
- the app draws no outline and no shadow: do NOT draw outlines or shadows yourself.`,
  solidPrompt: `Objects as a Swiss poster would show them: a few boxes and cylinders in exact, rational proportions — a speaker, a chair, a lamp, a book; no realism, no fine detail.
- the renderer paints faces white, grey and black with a hairline: do NOT try to draw shading or outlines yourself;
- "white" is the paper, "dark" is black, and "main" is the channel colour — one part only.`,
};
typo.elementFx = [
  { key: "slice", name: { zh: "切割错位", en: "Slice" }, for: FX_ALL, stage: "filter", reach: (B) => ({ l: B.w * 0.12, r: B.w * 0.12 }),
    /** The layer cut across into bands, every other one slid the other way. */
    paint(x, B, a, E) {
      const n = 2 + Math.round(4 * a), cuts = Array.from({ length: n + 1 }, (_, i) => (i === 0 ? 0 : i === n ? 1 : clamp((i + (E.R(i * 1.9 + 71) - 0.5) * 0.5) / n))), d = B.w * 0.05 * (0.3 + a);
      cutBands(x, B, region(x, B, "fxA"), cuts, (i) => (i % 2 ? d : -d * 0.6));
    } },
  { key: "echo", name: { zh: "层叠残影", en: "Echo" }, for: FX_ALL, stage: "behind", reach: (B, k) => ({ r: 40 * k, b: 40 * k }),
    /** Copies of the layer's shape stacked down and to the right behind it, each fainter. */
    paint(x, B, a, E) { const s = shapeIn(region(x, B, "fxA"), dark ? [236, 234, 230] : TY.ink, "fxEc"), n = 2 + Math.round(3 * a), d = (3 + 4 * a) * E.k; trail(x, B, s, n, d, d, 0.55 + 0.3 * a, "destination-over"); } },
  { key: "scatter", name: { zh: "粒子消散", en: "Particle scatter" }, for: FX_ALL, stage: "filter", reach: (B) => ({ t: B.h * 0.2, r: B.w * 0.4, b: B.h * 0.2 }),
    /** The layer's right side breaking up into square particles drifting off to the right. */
    paint(x, B, a, E) {
      const src = region(x, B, "fxA"), cs = Math.max(3, Math.round(Math.min(B.w, B.h) * 0.06)), cols = Math.ceil(B.w / cs), rows = Math.ceil(B.h / cs), from = 1 - 0.75 * a;
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const u = i / cols, q = j * cols + i;
        if (u < from || E.R(q * 1.3 + 81) > (u - from) / (1 - from + 1e-6) * 1.4) continue;
        const sx = i * cs, sy = j * cs, f = (u - from) / (1 - from + 1e-6), s = cs * (1 - 0.5 * f * E.R(q * 2.1 + 82));
        x.clearRect(B.x0 + sx, B.y0 + sy, cs, cs);
        x.drawImage(src, sx, sy, cs, cs, B.x0 + sx + f * B.w * 0.35 * E.R(q * 2.9 + 83), B.y0 + sy + (E.R(q * 3.7 + 84) - 0.5) * cs * 4 * f, s, s);
      }
    } },
  { key: "brush", name: { zh: "干笔刷痕", en: "Dry brush" }, for: FX_ALL, stage: "over",
    /** Streaks where a dry brush skipped across the layer. */
    paint(x, B, a, E) {
      x.save(); x.beginPath(); x.rect(B.x0, B.y0, B.w, B.h); x.clip(); x.globalCompositeOperation = "destination-out"; x.lineCap = "round";
      for (let k = 0, n = Math.round(10 + 60 * a); k < n; k++) { const y = B.y0 + B.h * E.R(k * 1.7 + 91), x0 = B.x0 + B.w * E.R(k * 2.3 + 92) * 0.8, len = B.w * (0.1 + E.R(k * 3.1 + 93) * 0.5); x.globalAlpha = 0.5 + 0.5 * E.R(k + 94); x.lineWidth = (0.6 + E.R(k * 4.1 + 95) * 1.8) * E.k; x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + len, y + (E.R(k * 5.3 + 96) - 0.5) * 3 * E.k); x.stroke(); }
      x.restore();
    } },
  { key: "hard", name: { zh: "黑白高反差", en: "Hard black and white" }, for: FX_PHOTO, stage: "filter",
    /** The photo in black and white, all but thresholded. */
    paint: tonesFx(() => [[0, [0, 0, 0]], [0.5, [128, 128, 128]], [1, [255, 255, 255]]], 0.85) },
];
