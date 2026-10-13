// The free sticker pack: 60 cel-style stickers drawn in code (no image files), so they stay sharp
// at any size and can follow the category colour.
//
// Every sticker draws inside a 200 x 200 box centred on the origin. `A` is its main colour
// (the category colour when the layer is tinted, otherwise the sticker's own default).
import { INK, fonts } from "./cel.js";

const WHITE = "#ffffff", RED = "#ff3b4f", YELLOW = "#ffd60a", ORANGE = "#ff8a00", BLUE = "#3a86ff", GREEN = "#06d6a0", PINK = "#ff5fa2";
const TAU = Math.PI * 2;

// ---------- path builders (each returns a function that adds a closed path to the context)
const poly = (pts) => (c) => { pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
const star = (n, R, r, rot = -Math.PI / 2) => (c) => {
  for (let i = 0; i < n * 2; i++) { const a = rot + (i * Math.PI) / n, q = i % 2 ? r : R; c[i ? "lineTo" : "moveTo"](Math.cos(a) * q, Math.sin(a) * q); }
  c.closePath();
};
const circle = (x, y, r) => (c) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); c.closePath(); };
const rrect = (x, y, w, h, r) => (c) => {
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
};
const curve = (fn) => (c) => { fn(c); c.closePath(); };

// ---------- painters
/** Filled shape with the house look: hard offset shadow, flat fill, heavy ink outline. */
function shape(ctx, path, fill, { shadow = true, lw = 7 } = {}) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (shadow) { ctx.save(); ctx.translate(7, 7); ctx.beginPath(); path(ctx); ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.fill(); ctx.stroke(); ctx.restore(); }
  ctx.beginPath(); path(ctx); ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = INK; ctx.stroke();
}
/** Several overlapping shapes merged into one silhouette (outline first, then fills hide the seams). */
function blob(ctx, paths, fill) {
  for (const pass of [0, 1, 2]) for (const p of paths) {
    ctx.save();
    if (pass === 0) ctx.translate(7, 7);
    ctx.beginPath(); p(ctx);
    if (pass < 2) { ctx.fillStyle = ctx.strokeStyle = INK; ctx.lineWidth = 14; ctx.lineJoin = "round"; ctx.fill(); ctx.stroke(); }
    else { ctx.fillStyle = fill; ctx.fill(); }
    ctx.restore();
  }
}
/** Thick inked stroke: an ink line with a coloured line on top. */
function stroke(ctx, draw, color, lw = 30) {
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  for (const [dx, col, w] of [[7, INK, lw + 14], [0, INK, lw + 14], [0, color, lw]]) {
    ctx.save(); ctx.translate(dx, dx); ctx.beginPath(); draw(ctx); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); ctx.restore();
  }
}
const pathLine = (pts) => (c) => pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
function thin(ctx, pts, lw = 6, color = INK) { ctx.beginPath(); pathLine(pts)(ctx); ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(); }
/** Heavy display lettering with an ink outline, centred on (x, y). */
function word(ctx, str, size, fill, x = 0, y = 0) {
  const cjk = /[⺀-鿿]/.test(str);
  ctx.font = cjk ? `900 ${size}px ${fonts.cn}` : `700 ${size}px ${fonts.en}, ${fonts.cn}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const yy = y + (cjk ? size * 0.02 : size * 0.06);
  ctx.lineWidth = size * 0.2; ctx.strokeStyle = INK; ctx.strokeText(str, x, yy);
  ctx.fillStyle = fill; ctx.fillText(str, x, yy);
}

// ---------- reusable silhouettes
const BURST = star(14, 96, 74), BOOM = star(9, 98, 54, -1.3), SEAL = circle(0, 0, 88);
const RIBBON = poly([[-98, -30], [98, -30], [76, 0], [98, 30], [-98, 30], [-76, 0]]);
const PLATE = rrect(-92, -46, 184, 92, 16);
const BUBBLE = curve((c) => {
  c.moveTo(-66, -72); c.arcTo(92, -72, 92, 40, 28); c.arcTo(92, 40, -18, 40, 28); c.lineTo(-18, 40); c.lineTo(-60, 86); c.lineTo(-50, 40);
  c.arcTo(-92, 40, -92, -72, 28); c.arcTo(-92, -72, 92, -72, 28);
});
const ARROW = poly([[-96, -24], [10, -24], [10, -64], [96, 0], [10, 64], [10, 24], [-96, 24]]);
const HEART = curve((c) => { c.moveTo(0, 82); c.bezierCurveTo(-118, 8, -74, -96, 0, -36); c.bezierCurveTo(74, -96, 118, 8, 0, 82); });
const FLAME = curve((c) => {
  c.moveTo(4, -98); c.bezierCurveTo(14, -52, 72, -30, 62, 32); c.bezierCurveTo(58, 72, 28, 96, 0, 96);
  c.bezierCurveTo(-34, 96, -64, 70, -64, 30); c.bezierCurveTo(-64, 0, -42, -10, -34, -46); c.bezierCurveTo(-14, -30, -6, -60, 4, -98);
});

const S = (id, zh, en, group, color, draw) => ({ id, name: { zh, en }, group, color, draw });

export const STICKER_GROUPS = [
  { id: "badge", name: { zh: "底牌与气泡", en: "Badges & bubbles" } },
  { id: "arrow", name: { zh: "箭头与标记", en: "Arrows & marks" } },
  { id: "symbol", name: { zh: "符号", en: "Symbols" } },
  { id: "word", name: { zh: "文字贴", en: "Word stickers" } },
  { id: "object", name: { zh: "日常物件", en: "Everyday objects" } },
];

export const STICKERS = [
  // ---- badges & bubbles: put a text layer on top
  S("burst", "爆炸星", "Starburst", "badge", YELLOW, (c, A) => shape(c, BURST, A)),
  S("boom", "尖角爆炸", "Boom", "badge", RED, (c, A) => { shape(c, BOOM, A); shape(c, star(9, 62, 34, -1.3), WHITE, { shadow: false, lw: 5 }); }),
  S("seal", "圆章", "Round seal", "badge", BLUE, (c, A) => { shape(c, SEAL, A); c.beginPath(); c.arc(0, 0, 70, 0, TAU); c.setLineDash([10, 9]); c.lineWidth = 5; c.strokeStyle = WHITE; c.stroke(); c.setLineDash([]); }),
  S("ribbon", "飘带", "Ribbon", "badge", RED, (c, A) => shape(c, RIBBON, A)),
  S("bubble", "对话气泡", "Speech bubble", "badge", WHITE, (c, A) => shape(c, BUBBLE, A)),
  S("thought", "想法气泡", "Thought bubble", "badge", WHITE, (c, A) => {
    blob(c, [circle(-40, -20, 46), circle(10, -40, 50), circle(52, -8, 40), circle(8, 10, 48), circle(-48, 12, 34)], A);
    shape(c, circle(-56, 62, 14), A); shape(c, circle(-80, 86, 8), A, { lw: 5 });
  }),
  S("shout", "喊话气泡", "Shout bubble", "badge", WHITE, (c, A) => shape(c, poly([[0, -96], [22, -62], [58, -84], [56, -44], [96, -36], [70, -6], [96, 28], [56, 34], [58, 74], [22, 54], [0, 92], [-22, 54], [-58, 76], [-56, 34], [-96, 28], [-70, -6], [-96, -36], [-56, -44], [-58, -84], [-22, -62]]), A)),
  S("tape", "胶带", "Tape", "badge", YELLOW, (c, A) => { shape(c, poly([[-96, -20], [-84, -8], [-96, 4], [-84, 16], [-94, 28], [94, 20], [84, 8], [96, -4], [84, -16], [94, -28]]), A, { lw: 5 }); thin(c, [[-50, -18], [-66, 22]], 4, "rgba(7,7,12,.25)"); thin(c, [[10, -22], [-6, 22]], 4, "rgba(7,7,12,.25)"); thin(c, [[66, -24], [50, 18]], 4, "rgba(7,7,12,.25)"); }),
  S("note", "便利贴", "Sticky note", "badge", YELLOW, (c, A) => { shape(c, poly([[-82, -82], [82, -82], [82, 46], [46, 82], [-82, 82]]), A); shape(c, poly([[82, 46], [46, 46], [46, 82]]), WHITE, { shadow: false }); }),
  S("pricetag", "价签", "Price tag", "badge", GREEN, (c, A) => { shape(c, poly([[-94, 0], [-42, -58], [94, -58], [94, 58], [-42, 58]]), A); shape(c, circle(-48, 0, 13), WHITE, { shadow: false, lw: 6 }); }),
  S("pill", "胶囊标签", "Pill label", "badge", BLUE, (c, A) => shape(c, rrect(-96, -42, 192, 84, 42), A)),
  S("shield", "盾牌徽章", "Shield", "badge", GREEN, (c, A) => {
    const sh = (k) => curve((x) => { x.moveTo(0, -94 * k); x.lineTo(78 * k, -66 * k); x.lineTo(78 * k, 4 * k); x.bezierCurveTo(78 * k, 52 * k, 36 * k, 82 * k, 0, 96 * k); x.bezierCurveTo(-36 * k, 82 * k, -78 * k, 52 * k, -78 * k, 4 * k); x.lineTo(-78 * k, -66 * k); });
    shape(c, sh(1), A); c.beginPath(); sh(0.8)(c); c.lineWidth = 5; c.strokeStyle = WHITE; c.stroke();
  }),

  // ---- arrows & marks
  S("arrow", "箭头", "Arrow", "arrow", RED, (c, A) => shape(c, ARROW, A)),
  S("arrow-curve", "弯箭头", "Curved arrow", "arrow", RED, (c, A) => { stroke(c, (x) => x.arc(-6, 40, 78, Math.PI * 1.02, Math.PI * 1.78), A, 30); shape(c, poly([[26, -70], [98, -38], [44, 12]]), A); }),
  S("arrow-down", "向下箭头", "Arrow down", "arrow", RED, (c, A) => { c.rotate(Math.PI / 2); shape(c, ARROW, A, { shadow: false }); }),
  S("arrow-both", "对比箭头", "Two-way arrow", "arrow", BLUE, (c, A) => shape(c, poly([[-98, 0], [-46, -52], [-46, -20], [46, -20], [46, -52], [98, 0], [46, 52], [46, 20], [-46, 20], [-46, 52]]), A)),
  S("ring", "圈重点", "Highlight ring", "arrow", RED, (c, A) => stroke(c, (x) => x.ellipse(0, 0, 88, 58, -0.12, 0.5, TAU + 0.15), A, 12)),
  S("underline", "下划线", "Underline", "arrow", RED, (c, A) => { stroke(c, (x) => { x.moveTo(-92, -4); x.quadraticCurveTo(-10, -38, 92, -18); }, A, 14); stroke(c, (x) => { x.moveTo(-60, 34); x.quadraticCurveTo(10, 12, 70, 22); }, A, 10); }),
  S("check", "对勾", "Check", "arrow", GREEN, (c, A) => stroke(c, pathLine([[-70, 6], [-24, 52], [72, -52]]), A, 30)),
  S("cross", "叉", "Cross", "arrow", RED, (c, A) => { stroke(c, pathLine([[-60, -60], [60, 60]]), A, 30); stroke(c, pathLine([[60, -60], [-60, 60]]), A, 30); }),
  S("arrow-up", "向上箭头", "Arrow up", "arrow", GREEN, (c, A) => { c.rotate(-Math.PI / 2); shape(c, ARROW, A, { shadow: false }); }),
  S("arrow-turn", "转折箭头", "Turn arrow", "arrow", RED, (c, A) => shape(c, poly([[-90, 30], [6, 30], [6, -30], [-30, -30], [28, -96], [86, -30], [50, -30], [50, 74], [-90, 74]]), A)),
  S("focus", "取景框", "Focus frame", "arrow", YELLOW, (c, A) => stroke(c, (x) => { for (const sx of [-1, 1]) for (const sy of [-1, 1]) { x.moveTo(sx * 88, sy * 26); x.lineTo(sx * 88, sy * 64); x.lineTo(sx * 48, sy * 64); } }, A, 12)),
  S("cursor", "鼠标指针", "Cursor", "arrow", WHITE, (c, A) => shape(c, poly([[-52, -92], [-52, 62], [-14, 28], [14, 90], [44, 76], [16, 16], [64, 16]]), A)),

  // ---- symbols
  S("star", "星星", "Star", "symbol", YELLOW, (c, A) => shape(c, star(5, 96, 42), A)),
  S("heart", "爱心", "Heart", "symbol", RED, (c, A) => { shape(c, HEART, A); thin(c, [[-46, -34], [-56, -14]], 9, "rgba(255,255,255,.75)"); }),
  S("bolt", "闪电", "Lightning", "symbol", YELLOW, (c, A) => shape(c, poly([[20, -98], [-60, 14], [-8, 14], [-28, 98], [62, -24], [8, -24], [36, -98]]), A)),
  S("fire", "火焰", "Fire", "symbol", ORANGE, (c, A) => { shape(c, FLAME, A); c.save(); c.translate(0, 38); c.scale(0.5, 0.56); shape(c, FLAME, YELLOW, { shadow: false, lw: 10 }); c.restore(); }),
  S("question", "问号", "Question mark", "symbol", YELLOW, (c, A) => word(c, "?", 210, A)),
  S("exclaim", "感叹号", "Exclamation mark", "symbol", RED, (c, A) => word(c, "!", 210, A)),
  S("plus", "加号", "Plus", "symbol", GREEN, (c, A) => shape(c, poly([[-26, -90], [26, -90], [26, -26], [90, -26], [90, 26], [26, 26], [26, 90], [-26, 90], [-26, 26], [-90, 26], [-90, -26], [-26, -26]]), A)),
  S("sparkle", "闪光", "Sparkles", "symbol", YELLOW, (c, A) => {
    for (const [x, y, r] of [[-22, 14, 74], [58, -56, 34], [62, 56, 24]]) { c.save(); c.translate(x, y); shape(c, star(4, r, r * 0.26), A, { lw: 6 }); c.restore(); }
  }),
  S("thumb", "点赞", "Thumbs up", "symbol", YELLOW, (c, A) => {
    shape(c, rrect(-92, -4, 46, 88, 8), WHITE);
    blob(c, [poly([[-36, -4], [-10, -92], [22, -86], [18, -4]]), rrect(-36, -8, 124, 92, 20)], A);
    thin(c, [[30, 22], [84, 22]], 5); thin(c, [[30, 48], [80, 48]], 5);
  }),
  S("crown", "皇冠", "Crown", "symbol", YELLOW, (c, A) => {
    shape(c, poly([[-90, 58], [-98, -44], [-46, 8], [0, -76], [46, 8], [98, -44], [90, 58]]), A);
    shape(c, rrect(-90, 52, 180, 26, 6), WHITE, { shadow: false });
    for (const x of [-98, 0, 98]) shape(c, circle(x, x ? -48 : -80, 12), RED, { shadow: false, lw: 5 });
  }),
  S("gem", "钻石", "Gem", "symbol", BLUE, (c, A) => {
    shape(c, poly([[-58, -72], [58, -72], [96, -22], [0, 92], [-96, -22]]), A);
    thin(c, [[-96, -22], [96, -22]], 5); thin(c, [[-58, -72], [-32, -22], [0, 92]], 5); thin(c, [[58, -72], [32, -22], [0, 92]], 5); thin(c, [[-32, -22], [0, -72], [32, -22]], 5);
  }),
  S("bell", "铃铛", "Bell", "symbol", YELLOW, (c, A) => {
    shape(c, circle(0, 74, 17), WHITE); shape(c, circle(0, -86, 12), A, { lw: 6 });
    blob(c, [circle(0, -26, 54), poly([[-54, -26], [54, -26], [74, 48], [-74, 48]]), rrect(-88, 36, 176, 24, 10)], A);
    thin(c, [[-62, 36], [62, 36]], 5);
  }),

  // ---- word stickers
  S("w-new", "NEW 新", "NEW", "word", RED, (c, A) => { shape(c, BURST, A); word(c, "NEW", 74, WHITE); }),
  S("w-hot", "HOT 热门", "HOT", "word", RED, (c, A) => { c.rotate(-0.1); shape(c, PLATE, A); word(c, "HOT", 92, WHITE); }),
  S("w-vs", "VS 对比", "VS", "word", BLUE, (c, A) => { shape(c, SEAL, A); word(c, "VS", 118, WHITE); }),
  S("w-top", "TOP 榜单", "TOP", "word", YELLOW, (c, A) => { shape(c, RIBBON, A); word(c, "TOP", 62, WHITE); }),
  S("w-free", "FREE 免费", "FREE", "word", GREEN, (c, A) => { c.rotate(0.08); shape(c, PLATE, A); word(c, "FREE", 84, WHITE); }),
  S("w-live", "LIVE 直播", "LIVE", "word", RED, (c, A) => { shape(c, PLATE, A); shape(c, circle(-60, 0, 13), WHITE, { shadow: false, lw: 5 }); word(c, "LIVE", 78, WHITE, 18); }),
  S("w-qa", "Q&A 问答", "Q&A", "word", YELLOW, (c, A) => { shape(c, BUBBLE, A); word(c, "Q&A", 76, WHITE, 0, -16); }),
  S("w-wow", "WOW 惊叹", "WOW", "word", ORANGE, (c, A) => { shape(c, BOOM, A); word(c, "WOW", 66, WHITE); }),
  S("w-must", "必看", "Must-see (必看)", "word", RED, (c, A) => { shape(c, SEAL, A); word(c, "必看", 78, WHITE); }),
  S("w-tips", "干货", "Solid tips (干货)", "word", YELLOW, (c, A) => { c.rotate(-0.06); shape(c, PLATE, A); word(c, "干货", 76, WHITE); }),
  S("w-sale", "SALE 促销", "SALE", "word", RED, (c, A) => { c.rotate(-0.08); shape(c, poly([[-96, 0], [-44, -54], [96, -54], [96, 54], [-44, 54]]), A); shape(c, circle(-52, 0, 11), WHITE, { shadow: false, lw: 5 }); word(c, "SALE", 72, WHITE, 26); }),
  S("w-howto", "教程", "Tutorial (教程)", "word", BLUE, (c, A) => { shape(c, RIBBON, A); word(c, "教程", 48, WHITE); }),

  // ---- everyday objects
  S("play", "播放键", "Play button", "object", RED, (c, A) => { shape(c, rrect(-94, -66, 188, 132, 34), A); shape(c, poly([[-22, -36], [42, 0], [-22, 36]]), WHITE, { shadow: false, lw: 6 }); }),
  S("clock", "时钟", "Clock", "object", BLUE, (c, A) => { shape(c, circle(0, 0, 90), A); shape(c, circle(0, 0, 68), WHITE, { shadow: false, lw: 6 }); thin(c, [[0, -44], [0, 0], [30, 18]], 10); for (let k = 0; k < 4; k++) { const a = (k * Math.PI) / 2; thin(c, [[Math.cos(a) * 54, Math.sin(a) * 54], [Math.cos(a) * 60, Math.sin(a) * 60]], 7); } }),
  S("calendar", "日历", "Calendar", "object", RED, (c, A) => {
    shape(c, rrect(-82, -72, 164, 154, 14), WHITE);
    c.save(); c.beginPath(); rrect(-82, -72, 164, 154, 14)(c); c.clip(); c.fillStyle = A; c.fillRect(-82, -72, 164, 48); c.restore();
    c.beginPath(); rrect(-82, -72, 164, 154, 14)(c); c.lineWidth = 7; c.strokeStyle = INK; c.stroke(); thin(c, [[-82, -24], [82, -24]], 6);
    for (const x of [-40, 40]) thin(c, [[x, -90], [x, -58]], 10);
    c.fillStyle = INK; for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) c.fillRect(-58 + k * 34, -4 + r * 28, 16, 14);
  }),
  S("pin", "定位", "Location pin", "object", RED, (c, A) => { shape(c, curve((x) => { x.moveTo(0, 96); x.bezierCurveTo(-78, 14, -70, -6, -70, -28); x.arc(0, -28, 70, Math.PI, 0); x.bezierCurveTo(70, -6, 78, 14, 0, 96); }), A); shape(c, circle(0, -28, 26), WHITE, { shadow: false, lw: 6 }); }),
  S("search", "放大镜", "Magnifier", "object", BLUE, (c, A) => { stroke(c, pathLine([[38, 38], [84, 84]]), A, 24); shape(c, circle(-16, -16, 70), A); shape(c, circle(-16, -16, 48), WHITE, { shadow: false, lw: 6 }); thin(c, [[-44, -22], [-32, -40]], 8, "rgba(7,7,12,.25)"); }),
  S("bulb", "灯泡", "Light bulb", "object", YELLOW, (c, A) => {
    for (const a of [-2.6, -2.0, -1.57, -1.14, -0.54]) thin(c, [[Math.cos(a) * 80, -26 + Math.sin(a) * 80], [Math.cos(a) * 98, -26 + Math.sin(a) * 98]], 9);
    shape(c, rrect(-26, 34, 52, 50, 8), WHITE); blob(c, [circle(0, -26, 60), poly([[-34, 20], [34, 20], [26, 44], [-26, 44]])], A);
    thin(c, [[-26, 54], [26, 54]], 5); thin(c, [[-26, 68], [26, 68]], 5);
  }),
  S("coffee", "咖啡", "Coffee", "object", ORANGE, (c, A) => {
    for (const x of [-30, 0, 30]) stroke(c, (p) => { p.moveTo(x, -62); p.quadraticCurveTo(x + 14, -76, x, -92); }, WHITE, 5);
    stroke(c, (p) => p.arc(56, 20, 26, -1.2, 1.3), WHITE, 10);
    shape(c, poly([[-70, -36], [56, -36], [42, 82], [-56, 82]]), WHITE); shape(c, poly([[-66, 0], [52, 0], [47, 42], [-61, 42]]), A, { shadow: false, lw: 6 });
  }),
  S("dumbbell", "哑铃", "Dumbbell", "object", BLUE, (c, A) => { shape(c, rrect(-62, -11, 124, 22, 6), WHITE); for (const s of [-1, 1]) { shape(c, rrect(s > 0 ? 44 : -72, -52, 28, 104, 9), A); shape(c, rrect(s > 0 ? 72 : -96, -34, 24, 68, 8), A); } }),
  S("music", "音符", "Music note", "object", PINK, (c, A) => { shape(c, poly([[-24, 52], [-24, -66], [80, -90], [80, 32], [60, 32], [60, -52], [-4, -38], [-4, 52]]), A); shape(c, circle(-46, 54, 30), A); shape(c, circle(40, 34, 30), A); }),
  S("laptop", "电脑", "Laptop", "object", BLUE, (c, A) => { shape(c, rrect(-78, -72, 156, 108, 10), A); shape(c, rrect(-62, -58, 124, 80, 4), WHITE, { shadow: false, lw: 5 }); shape(c, poly([[-98, 42], [98, 42], [82, 72], [-82, 72]]), WHITE); thin(c, [[-22, 58], [22, 58]], 6); }),
  S("coin", "金币", "Coin", "object", YELLOW, (c, A) => { shape(c, circle(0, 0, 90), A); c.beginPath(); c.arc(0, 0, 68, 0, TAU); c.lineWidth = 6; c.strokeStyle = INK; c.stroke(); word(c, "$", 104, WHITE); }),
  S("rocket", "火箭", "Rocket", "object", RED, (c, A) => {
    c.rotate(0.5);
    shape(c, poly([[-18, 50], [0, 100], [18, 50]]), ORANGE);
    for (const s of [-1, 1]) shape(c, poly([[s * 30, 8], [s * 72, 62], [s * 30, 52]]), A);
    shape(c, curve((x) => { x.moveTo(0, -100); x.bezierCurveTo(48, -62, 48, 8, 30, 52); x.lineTo(-30, 52); x.bezierCurveTo(-48, 8, -48, -62, 0, -100); }), WHITE);
    shape(c, circle(0, -30, 19), A, { shadow: false, lw: 6 });
  }),
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));
export const stickerById = (id) => BY_ID.get(id);
/** Draws a sticker centred on the origin in its 200-unit box. `tint` overrides the default colour. */
export function drawSticker(ctx, id, tint) {
  const s = BY_ID.get(id);
  if (!s) return;
  ctx.save();
  s.draw(ctx, tint || s.color);
  ctx.restore();
}
