// Unit tests for the DOM-free logic. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { blockLayout, virtualSize, layout, TEMPLATES } from "../ui/js/layout.js";
import { parseCsv, csvToJobs } from "../ui/js/csv.js";
import { useFont, normalizeProfile, normalizeCover, normalizeSettings, exportName, usedUserAssets, normalizeSize, ratioText, sizeCaption } from "../ui/js/store.js";
import { LETTERED, ACCENT_SHAPES, BOUND_TYPES, defaultLayers, normalizeLayers, newLayer, resolve, adjust, resetPlacement, insertAbove, moveLayer, duplicate, isPickable, appliesTo, stepIndex, clipBase, clipEnd, normalizeScene, sceneOffsets, moveScene, resetScene, reorderLayout, orderLayout, layoutOrder } from "../ui/js/layers.js";
import { sampleProfile, starterProfile, SIZE_PRESETS } from "../ui/js/presets.js";
import { platformsFor, RATIOS } from "../ui/js/platforms.js";

test("virtualSize keeps the five tuned canvases and normalises everything else", () => {
  assert.deepEqual(virtualSize(1920, 1080), [1920, 1080]);
  assert.deepEqual(virtualSize(1600, 1200), [1600, 1200]);
  assert.deepEqual(virtualSize(1200, 1200), [1200, 1200]);
  assert.deepEqual(virtualSize(1200, 1600), [1200, 1600]);
  assert.deepEqual(virtualSize(1080, 1920), [1080, 1920]);
  assert.deepEqual(virtualSize(1280, 720), [1920, 1080]);   // same aspect, same layout
  assert.deepEqual(virtualSize(3840, 2160), [1920, 1080]);
  assert.equal(virtualSize(900, 383)[1], 1080);              // ultra-wide keeps a 1080 short side
});

test("stack layout reproduces the hand-tuned values at the anchor ratios", () => {
  const near = (a, b, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  const cases = [
    [1920, 1080, { el: 720, er: 640, ax: 1420, ay: 790, s: 0.72, tb: 555 }],
    [1600, 1200, { el: 840, er: 770, ax: 1190, ay: 930, s: 0.8, tb: 680 }],
    [1200, 1200, { el: 830, er: 770, ax: 890, ay: 940, s: 0.7, tb: 690 }],
    [1200, 1600, { el: 1130, er: 1060, ax: 850, ay: 1250, s: 0.9, tb: 950 }],
    [1080, 1920, { el: 1380, er: 1310, ax: 810, ay: 1530, s: 0.9, tb: 1200 }],
  ];
  for (const [w, h, e] of cases) {
    const g = layout("stack", w, h);
    near(g.accent[0][1], e.el); near(g.accent[1][1], e.er);
    near(g.art.x, e.ax); near(g.art.y, e.ay); near(g.art.s, e.s, 0.005);
    near(g.title.y + g.title.h, e.tb);
  }
});

test("every template yields a sane layout across extreme aspect ratios", () => {
  for (const t of TEMPLATES) for (const [rw, rh] of [[900, 383], [1920, 1080], [1146, 717], [1080, 1080], [1080, 1350], [1080, 1920], [1000, 3000]]) {
    const [w, h] = virtualSize(rw, rh), g = layout(t, w, h);
    assert.ok(g.title.w > 200 && g.title.h >= 120, `${t} ${rw}x${rh} title box ${g.title.w}x${g.title.h}`);
    assert.ok(g.title.x >= 0 && g.title.x + g.title.w <= w && g.title.y + g.title.h <= h, `${t} ${rw}x${rh} title inside`);
    assert.ok(g.art.x > 0 && g.art.x < w && g.art.y > 0 && g.art.y < h && g.art.s > 0.2, `${t} ${rw}x${rh} art`);
    assert.ok(g.cat.maxW > 100, `${t} ${rw}x${rh} category width ${g.cat.maxW}`);
    assert.deepEqual([...g.accent[0], ...g.accent[1]], g.edge.line, `${t} ${rw}x${rh} accent starts with the edge`);
  }
});

test("parseCsv handles quotes, embedded commas and line breaks", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\n\n"say ""hi""",z\r\n'), [["a", "b"], ["x, y", "line1\nline2"], ['say "hi"', "z"]]);
});

test("csvToJobs reads with and without a header row", () => {
  assert.deepEqual(csvToJobs("类目,标题,角标\n日常,一台相机,EP.01\n教程,,x\n"), [{ category: "日常", title: "一台相机", tag: "EP.01", subtitle: "" }]);
  assert.deepEqual(csvToJobs("Title,Category\nHello,Vlog"), [{ category: "Vlog", title: "Hello", tag: "", subtitle: "" }]);
  assert.deepEqual(csvToJobs("频道,标题\n日常,你好"), [{ category: "日常", title: "你好", tag: "", subtitle: "" }]);
  assert.deepEqual(csvToJobs("channel,title\nVlog,Hi"), [{ category: "Vlog", title: "Hi", tag: "", subtitle: "" }]);
  assert.deepEqual(csvToJobs("Vlog,Hello,T1"), [{ category: "Vlog", title: "Hello", tag: "T1", subtitle: "" }]);
  assert.deepEqual(csvToJobs("Vlog,Hello,T1,Sub"), [{ category: "Vlog", title: "Hello", tag: "T1", subtitle: "Sub" }]);
  assert.deepEqual(csvToJobs("频道,标题,副标题\n日常,你好,三分钟看懂"), [{ category: "日常", title: "你好", tag: "", subtitle: "三分钟看懂" }]);
});

test("normalizeProfile repairs bad input and keeps good input", () => {
  const p = normalizeProfile({ categories: [{ id: "a", name: "A", color: "red", graphic: { type: "builtin", id: "gear" } }, { id: "a", name: "B", graphic: { kind: "bogus", id: "x" } }], style: { template: "nope" }, sizes: [{ w: 5, h: "x" }] });
  assert.equal(p.version, 2);
  assert.equal(p.categories.length, 2);
  assert.notEqual(p.categories[0].id, p.categories[1].id);
  assert.equal(p.categories[0].color, "#fcee0a");
  assert.deepEqual(p.categories[0].graphic, { kind: "graphic", id: "gear", labels: [], stamp: "" });   // v1 shape upgraded
  assert.deepEqual(p.categories[1].graphic, { kind: "none" });
  assert.equal(p.style.template, "stack");
  assert.deepEqual(p.sizes, [{ w: 64, h: 1080, label: "", name: "" }]);
  assert.deepEqual(p.design.layers.map((l) => l.id), BOUND_TYPES);
  assert.equal(normalizeProfile(null).categories.length, 1);
  const sample = normalizeProfile(sampleProfile("zh"));
  assert.equal(sample.categories.length, 5);
  assert.deepEqual(sample.categories[3].graphic.labels, ["问题", "拆分", "尝试", "结论"]);
  assert.equal(normalizeProfile(sampleProfile("en")).categories[4].graphic.stamp, "DONE");
  assert.equal(sample.sizes.length, 6);   // one for each ratio the platforms want
  assert.deepEqual(sample.sizes.map((z) => sizeCaption(z)), ["B站 / YouTube · 16:9", "B站 / 抖音 / 视频号 · 4:3", "抖音 / 小红书 / 视频号 · 3:4", "YouTube · 9:16", "公众号 · 1:1", "公众号 · 2.35:1"]);
  assert.equal(normalizeProfile(starterProfile("en", "ACME")).brand.name, "ACME");
  // the brand row shows no number until asked to; a logo is the id of an asset of the user's
  assert.deepEqual(sample.brand, { name: "PIXEL HARBOR", unit: "SERIES", counter: false, logo: "" });
  assert.deepEqual(normalizeProfile({ brand: { name: "X", counter: true, logo: "u1a/../b" } }).brand, { name: "X", unit: "CHANNEL", counter: true, logo: "u1ab" });
  assert.equal(normalizeProfile({ brand: { counter: "yes" } }).brand.counter, false);
  // a new design leaves out the channel name and graphic; a design read from a file keeps what it had
  assert.deepEqual(sample.design.layers.filter((l) => l.off).map((l) => l.type), ["graphic", "catname"]);
  assert.ok(sample.design.layers.filter((l) => l.off).every((l) => !l.visible));
  const kept = normalizeProfile({ design: { layers: sample.design.layers.map((l) => (l.off ? { ...l, off: false, visible: true } : l)) } });
  assert.equal(kept.design.layers.filter((l) => l.off).length, 0);
  assert.equal(normalizeProfile({ lean: true }).lean, true);
  assert.equal(normalizeProfile({ lean: 1 }).lean, undefined);
  assert.deepEqual(usedUserAssets(normalizeProfile({ brand: { logo: "u9" } }), null), ["u9"]);
});

test("normalizeCover starts from the profile's design and normalizeSettings clamps", () => {
  const p = normalizeProfile(sampleProfile("en"));
  p.design.layers.find((l) => l.id === "title").stroke = 1.5;
  const c = normalizeCover({ catId: "gone" }, p);
  assert.equal(c.catId, "shot");
  assert.equal(c.layers.find((l) => l.id === "title").stroke, 1.5);
  assert.notEqual(c.layers, p.design.layers);                       // a copy, not the same array
  const own = normalizeCover({ layers: [{ type: "title", stroke: 0.5 }] }, p);
  assert.equal(own.layers.find((l) => l.id === "title").stroke, 0.5);
  assert.deepEqual(normalizeSettings({ scale: 7, format: "gif", quality: 500, scope: "size" }), { lang: "", profileId: "", scale: 2, format: "png", quality: 100, nameTemplate: "{n}-{channel}_{title}_{size}", scope: "size", hideScene: false, cutEngine: "", cutProxy: "", channels: {}, columns: { left: 0, right: 0, setup: 0 }, recentFonts: [], recipes: {}, surprise: { locks: {}, odds: {} } });
  assert.deepEqual(normalizeSettings({ channels: { p1: "c1", "bad key!": "c2", p2: 7 } }).channels, { p1: "c1" });
  assert.deepEqual(normalizeSettings({ columns: { left: 410.4, right: -5, setup: "x" } }).columns, { left: 410, right: 0, setup: 0 });
  assert.deepEqual([normalizeSettings({ cutEngine: "birefnet" }).cutEngine, normalizeSettings({ cutEngine: "magic" }).cutEngine], ["birefnet", ""]);
  assert.deepEqual(normalizeSettings({ recentFonts: ["A", "A", "", 3, "B", "C", "D", "E", "F", "G"] }).recentFonts, ["A", "B", "C", "D", "E", "F"]);
  // what Surprise me keeps: only the locks it knows (set), and the chances the user set, each within 0 and 1, by name (what it no longer keeps, its old taste and recent looks, goes)
  assert.deepEqual(normalizeSettings({ surprise: { locks: { look: true, theme: false, colour: true, places: 1 }, recent: ["a", "b"], taste: { deco: { kept: 2 } },
    odds: { groups: { look: { deco: 0.5, neon: 2, "x y": 0.1, cel: "a" }, "no!": { a: 1 } }, chances: { rail: -1, textPlate: 0.4, "x y": 1 } } } }).surprise,
    { locks: { look: true }, odds: { groups: { look: { deco: 0.5, neon: 1 } }, chances: { rail: 0, textPlate: 0.4 } } });
  assert.deepEqual(normalizeSettings({}).surprise, { locks: {}, odds: {} });
  // the user's own Surprise me recipes: only each look's parts' chances, within 0 and 1, what is not a name dropped; what earlier versions kept by look of letterings, bends and the ground let go
  assert.deepEqual(normalizeSettings({ recipes: { deco: { family: "pop", own: 1.4, bend: -1, fx: { sticker: 12 }, params: { rain: 0.5, fog: 3, "x y": 1, gilt: "a" } }, "no!": { params: { a: 1 } }, cel: { own: 0.5 }, riso: { params: {} } } }).recipes,
    { deco: { params: { rain: 0.5, fog: 1 } } });
  assert.deepEqual(useFont(["A", "B", "C"], "B"), ["B", "A", "C"]);                 // the latest first, once
});

test("usedUserAssets finds uploads referenced by categories and layers", () => {
  const p = normalizeProfile({ categories: [{ id: "a", graphic: { kind: "user", id: "u1" } }], design: { layers: [{ type: "asset", ref: { kind: "user", id: "u2" } }, { type: "asset", ref: { kind: "sticker", id: "star" } }] } });
  const c = normalizeCover({ layers: [{ type: "asset", ref: { kind: "user", id: "u3" } }] }, p);
  assert.deepEqual(usedUserAssets(p, null).sort(), ["u1", "u2"]);
  assert.deepEqual(usedUserAssets(null, c), ["u3"]);
});

test("normalizeLayers keeps every bound layer once, the background at the bottom", () => {
  const ls = normalizeLayers([{ type: "bg" }, { type: "title" }, { type: "asset", id: "s1", ref: { kind: "sticker", id: "star" } }, { type: "title" }, { type: "asset" }, { type: "nope" }, { type: "text", id: "s1", text: "hi" }]);
  assert.equal(ls[0].id, "bg");
  assert.deepEqual(ls.filter((l) => BOUND_TYPES.includes(l.id)).map((l) => l.id).sort(), [...BOUND_TYPES].sort());
  assert.equal(ls.filter((l) => l.type === "title").length, 1);
  assert.equal(ls.filter((l) => l.type === "asset").length, 1);      // the asset without a reference is dropped
  assert.equal(new Set(ls.map((l) => l.id)).size, ls.length);        // the clashing id was replaced
  assert.deepEqual(normalizeLayers(null).map((l) => l.id), BOUND_TYPES);
  assert.deepEqual(defaultLayers().map((l) => l.id), BOUND_TYPES);
  assert.equal(ACCENT_SHAPES.length, 12);                             // the default plus eleven more
  assert.equal(normalizeLayers([{ type: "accent", shape: "wave" }]).find((l) => l.id === "accent").shape, "wave");
  assert.equal(normalizeLayers([{ type: "accent", shape: "bogus" }]).find((l) => l.id === "accent").shape, "slant");
});

test("layer placement: one edit maps to every size, per-size edits stay local", () => {
  const land = { vw: 1920, vh: 1080, key: "1920x1080" }, port = { vw: 1080, vh: 1920, key: "1080x1920" };
  const a = newLayer("asset", { ref: { kind: "sticker", id: "star" } });
  { const d = resolve(a, 1920, 1080, land.key); assert.ok(d.cx === 960 && Math.abs(d.cy - 453.6) < 1e-6 && d.s === 0.35 && d.r === 0, JSON.stringify(d)); }
  adjust(a, land, "all", { ddx: 192, ddy: -108, scale: 2, rot: 10 });           // +10% x, -10% y everywhere
  let r = resolve(a, 1080, 1920, port.key);
  assert.ok(Math.abs(r.cx - 648) < 1e-6 && Math.abs(r.cy - 614.4) < 1e-6 && Math.abs(r.s - 0.7) < 1e-9 && r.r === 10);
  adjust(a, port, "size", { ddx: 50, scale: 1.5, rot: -30 });                   // only the portrait size
  r = resolve(a, 1080, 1920, port.key);
  assert.ok(Math.abs(r.cx - 698) < 1e-6 && Math.abs(r.s - 1.05) < 1e-9 && r.r === -20);
  assert.ok(Math.abs(resolve(a, 1920, 1080, land.key).cx - 1152) < 1e-6);
  resetPlacement(a, "size", port.key);
  assert.ok(Math.abs(resolve(a, 1080, 1920, port.key).cx - 648) < 1e-6);
  resetPlacement(a, "all");
  { const d = resolve(a, 1920, 1080, land.key); assert.ok(d.cx === 960 && Math.abs(d.cy - 453.6) < 1e-6 && d.s === 0.35 && d.r === 0, JSON.stringify(d)); }
  // bound layers: offsets from the template; the category graphic is fine-tuned per category
  const g = newLayer("graphic");
  assert.deepEqual(resolve(g, 1920, 1080, land.key, "c1"), { dx: 0, dy: 0, s: 1, r: 0, kx: 1, ky: 1 });
  adjust(g, { ...land, catId: "c1" }, "size", { ddx: 40 });
  assert.equal(resolve(g, 1920, 1080, land.key, "c1").dx, 40);
  assert.equal(resolve(g, 1920, 1080, land.key, "c2").dx, 0);
  adjust(g, { ...land, catId: "c2" }, "all", { ddx: 192 });
  assert.ok(Math.abs(resolve(g, 1920, 1080, land.key, "c1").dx - 232) < 1e-6);
});

test("stretch: sides change one axis, everywhere or for one size", () => {
  const land = { vw: 1920, vh: 1080, key: "1920x1080" }, t = newLayer("title");
  adjust(t, land, "all", { kx: 1.5 });
  adjust(t, land, "size", { ky: 0.5, kx: 2 });
  assert.deepEqual([resolve(t, 1920, 1080, land.key).kx, resolve(t, 1920, 1080, land.key).ky], [3, 0.5]);
  assert.deepEqual([resolve(t, 1080, 1920, "1080x1920").kx, resolve(t, 1080, 1920, "1080x1920").ky], [1.5, 1]);
  const back = normalizeLayers([JSON.parse(JSON.stringify(t))]).find((l) => l.id === "title");
  assert.equal(back.t.all.kx, 1.5); assert.deepEqual(back.t.by[land.key], { dx: 0, dy: 0, s: 1, r: 0, kx: 2, ky: 0.5 });
  assert.equal(normalizeLayers([{ type: "title", t: { all: { x: 0.1 } } }]).find((l) => l.id === "title").t.all.kx, 1);   // older files
});

test("layer order: insert above the selection, the background never moves", () => {
  const ls = defaultLayers(), s = newLayer("asset", { ref: { kind: "sticker", id: "star" } });
  insertAbove(ls, "title", s);
  assert.equal(ls.indexOf(s), ls.findIndex((l) => l.id === "title") + 1);
  assert.equal(insertAbove(ls, "missing", newLayer("text")), ls[ls.length - 1]);
  assert.equal(moveLayer(ls, "bg", 5), false);
  assert.equal(moveLayer(ls, s.id, 0), true);
  assert.equal(ls[0].id, "bg"); assert.equal(ls[1], s);              // clamped just above the background
  const copy = duplicate(s);
  assert.notEqual(copy.id, s.id); assert.deepEqual(copy.ref, s.ref);
  assert.equal(duplicate(ls[0]), null);                              // bound layers cannot be duplicated
  assert.equal(isPickable(ls.find((l) => l.id === "frame")), false);    // pinned to the canvas corners
  assert.equal(isPickable(ls.find((l) => l.id === "accent")), true);    // the colour block can be dragged like the rest
  assert.equal(isPickable(s), true); s.locked = true; assert.equal(isPickable(s), false);
});

test("the sticker pack has 72 uniquely named stickers in known groups, twelve of them frames", async () => {
  globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => ({}) }) };
  const { STICKERS, STICKER_GROUPS } = await import("../ui/js/stickers.js");
  assert.equal(STICKERS.length, 72);
  assert.equal(STICKERS.filter((x) => x.group === "frame").length, 12);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 72);
  const groups = new Set(STICKER_GROUPS.map((g) => g.id));
  for (const s of STICKERS) { assert.ok(groups.has(s.group), s.id); assert.ok(s.name.zh && s.name.en && /^#[0-9a-f]{6}$/i.test(s.color), s.id); }
});

test("the graphic library has 20 uniquely named category graphics", async () => {
  const { GRAPHICS } = await import("../ui/js/assets.js");
  assert.equal(GRAPHICS.length, 20);
  assert.equal(new Set(GRAPHICS.map((g) => g.id)).size, 20);
  for (const g of GRAPHICS) assert.ok(g.name.zh && g.name.en && typeof g.draw === "function" && g.fit > 0, g.id);
});

test("every interface string has both languages", async () => {
  const { keys, t, setLang } = await import("../ui/js/i18n.js");
  globalThis.document = { ...globalThis.document, documentElement: {} };
  for (const lang of ["zh", "en"]) { setLang(lang); for (const k of keys()) assert.ok(t(k).trim().length > 0, `${lang} ${k}`); }
});

test("size captions: custom name first, then the platforms the ratio is for and the ratio, never pixels", () => {
  assert.equal(ratioText(1920, 1080), "16:9");
  assert.equal(ratioText(1200, 1600), "3:4");
  assert.equal(ratioText(1200, 1200), "1:1");
  assert.equal(ratioText(900, 383), "2.35:1");
  assert.equal(ratioText(1146, 717), "1.6:1");
  assert.equal(ratioText(1000, 1257), "1:1.26");
  assert.equal(sizeCaption(normalizeSize({ w: 1280, h: 720, label: "16:9 · YouTube", name: "  主站封面 " })), "主站封面");
  assert.equal(sizeCaption(normalizeSize({ w: 1280, h: 720, label: "16:9 · YouTube" })), "B站 / YouTube · 16:9");   // a platform's ratio: named after the platforms
  assert.equal(sizeCaption(normalizeSize({ w: 1440, h: 1080, label: "4:3" }), "en"), "Bilibili / Douyin / WeChat Channels · 4:3");
  assert.equal(sizeCaption(normalizeSize({ w: 900, h: 900 })), "公众号 · 1:1");
  assert.equal(sizeCaption(normalizeSize({ w: 1080, h: 1350, label: "4:5 · Instagram" })), "4:5 · Instagram");   // no platform's: what it came with
  assert.equal(sizeCaption(normalizeSize({ w: 1500, h: 500 })), "3:1");
  assert.deepEqual(platformsFor(1080, 1920), ["YouTube"]);                                // the portrait video's ratio
  assert.deepEqual(platformsFor(1200, 1600, "en"), ["Douyin", "RED", "WeChat Channels"]);
  assert.deepEqual(platformsFor(1146, 717), []);
  assert.deepEqual(SIZE_PRESETS.map((z) => ratioText(z.w, z.h)), Object.keys(RATIOS));     // one preset for each ratio a platform wants
  assert.equal(normalizeSize({ w: 100, h: 100, name: "x".repeat(99) }).name.length, 40);
  assert.equal(normalizeProfile({ sizes: [{ w: 800, h: 600, name: "Blog" }] }).sizes[0].name, "Blog");
});

test("exportName fills the template and strips unsafe characters", () => {
  const cat = { name: "街拍日记", code: "SHOT" };
  assert.equal(exportName("{n}-{category}_{title}_{size}", { index: 0, cat, title: "一台相机\n记录*真实*的一周", size: { w: 1920, h: 1080 }, scale: 2, ext: "png" }), "01-街拍日记_一台相机 记录真实的一周_1920x1080@2x.png");
  assert.equal(exportName("../{code}/{title}", { index: 2, cat, title: "a/b:c", size: { w: 1, h: 1 }, scale: 1, ext: "jpg" }), "..SHOTabc.jpg");
  assert.equal(exportName("", { index: 0, cat: { name: "", code: "" }, title: "", size: { w: 10, h: 20 }, scale: 1, ext: "webp" }), "01-cover_untitled_10x20.webp");
});

test("free layers can be kept to some categories", () => {
  const only = newLayer("text", { text: "x", cats: ["a"] }), every = newLayer("text", { text: "y" });
  assert.equal(appliesTo(only, "a"), true); assert.equal(appliesTo(only, "b"), false);
  assert.equal(appliesTo(every, "b"), true);
  // survives a round trip; bound layers never take the restriction
  const ls = normalizeLayers([...defaultLayers().map((l) => (l.id === "title" ? { ...l, cats: ["a"] } : l)), only, every], ["a", "b"]);
  assert.deepEqual(ls.find((l) => l.id === only.id).cats, ["a"]);
  assert.equal(ls.find((l) => l.id === "title").cats, undefined);
  assert.equal(ls.find((l) => l.id === every.id).cats, undefined);
  assert.deepEqual(duplicate(ls.find((l) => l.id === only.id)).cats, ["a"]);
  // removing its only category removes the layer; a layer shared with a surviving category stays
  const both = newLayer("text", { text: "z", cats: ["a", "b"] });
  const after = normalizeLayers([...ls, both], ["b"]);
  assert.equal(after.some((l) => l.id === only.id), false);
  assert.deepEqual(after.find((l) => l.id === both.id).cats, ["b"]);
  assert.equal(after.some((l) => l.id === every.id), true);
  // and the same through a cover when the profile loses the category
  const p = normalizeProfile({ categories: [{ id: "a" }, { id: "b" }] });
  const c = normalizeCover({ catId: "a", layers: [...defaultLayers(), only] }, p);
  assert.equal(c.layers.some((l) => l.id === only.id), true);
  p.categories.shift();
  assert.equal(normalizeCover(c, p).layers.some((l) => l.id === only.id), false);
});

test("moving a layer up or down steps over layers of other categories", () => {
  const a = newLayer("text", { cats: ["a"] }), b = newLayer("text", { cats: ["b"] }), c = newLayer("text");
  const ls = [newLayer("bg"), a, b, c];
  assert.equal(stepIndex(ls, a.id, 1, "a"), 3);       // passes b, which category a never sees
  assert.equal(stepIndex(ls, c.id, -1, "a"), 1);
  assert.equal(stepIndex(ls, c.id, 1, "a"), -1);      // already on top
  assert.equal(stepIndex(ls, a.id, -1, "a"), -1);     // nothing goes below the background
  assert.equal(stepIndex(ls, "bg", 1, "a"), -1);
});

// ---------- AI-generated assets
import { normalizeSpec, parseSpec, drawSpec, SPEC_LIMITS } from "../ui/js/spec.js";
import { normalizeAi, aiReady, endpoint, buildRequest, readReply, buildPrompt, retryMessage, EXAMPLES, SYSTEM_PROMPT, SOLID_EXAMPLES, solidPrompt } from "../ui/js/ai.js";
import { normalizeSolid, drawSolid, SOLID_LIMITS, DEFAULT_VIEW } from "../ui/js/solid.js";

/** A canvas context that accepts anything and counts what was called. */
function fakeCtx() {
  const calls = {};
  return new Proxy({ calls }, { get: (t, k) => (k in t ? t[k] : (...a) => { calls[k] = (calls[k] || 0) + 1; return { width: a.length }; }), set: () => true });
}

test("spec: the prompt's own examples are valid and can be drawn", () => {
  for (const e of EXAMPLES) {
    const { spec, error } = normalizeSpec(e.spec);
    assert.equal(error, undefined, `${e.ask}: ${error}`);
    assert.deepEqual(normalizeSpec(spec).spec, spec);                 // normalising is stable
    const ctx = fakeCtx(); drawSpec(ctx, spec, null);
    assert.ok(ctx.calls.fill > 0, e.ask);
    assert.equal(ctx.calls.save, ctx.calls.restore, e.ask);           // the context is left as it was found
    assert.ok(SYSTEM_PROMPT.includes(JSON.stringify(e.spec)));
  }
});

test("spec: defaults are filled in and numbers are kept in range", () => {
  const { spec } = normalizeSpec({ name: "Dot", ops: [{ op: "shape", path: { circle: [0, 0, 9999] }, fill: "main", lw: 99 }, { op: "text", text: " Hi ", fill: "white", size: 5000, rotate: 100 }] });
  assert.deepEqual(spec.name, { zh: "Dot", en: "Dot" });
  assert.match(spec.color, /^#[0-9a-f]{6}$/);
  assert.deepEqual(spec.ops[0], { op: "shape", path: { circle: [0, 0, 140] }, fill: "main", shadow: true, lw: 14 });
  assert.deepEqual(spec.ops[1], { op: "text", text: "Hi", size: 220, fill: "white", x: 0, y: 0, rotate: 7 });
  assert.equal(normalizeSpec({ ops: [{ op: "shape", path: { rrect: [0, 0, 40, 20, 99] }, fill: "red" }] }).spec.ops[0].path.rrect[4], 10);
});

test("spec: anything unexpected is refused, never executed or guessed", () => {
  const no = (raw, re) => { const r = normalizeSpec(raw); assert.equal(r.spec, undefined); assert.match(r.error, re); };
  no(null, /not an object/); no([], /not an object/); no({ ops: [] }, /ops/);
  no({ ops: [{ op: "eval", code: "alert(1)" }] }, /unknown op/);
  no({ ops: [{ op: "shape", path: { poly: [[0, 0], [1, 1]] }, fill: "main" }] }, /points/);
  no({ ops: [{ op: "shape", path: { circle: [0, 0, "9"] }, fill: "main" }] }, /not a number/);
  no({ ops: [{ op: "shape", path: { circle: [0, 0, 9] }, fill: "url(x)" }] }, /colour/);
  no({ ops: [{ op: "shape", path: { curve: [["L", 0, 0], ["L", 1, 1]] }, fill: "main" }] }, /"M"/);
  no({ ops: [{ op: "shape", path: { curve: [["M", 0, 0], ["Z"]] }, fill: "main" }] }, /bad segment/);
  no({ ops: [{ op: "text", text: "x".repeat(SPEC_LIMITS.text + 1), fill: "main" }] }, /characters/);
  no({ ops: Array(SPEC_LIMITS.ops + 1).fill({ op: "shape", path: { circle: [0, 0, 9] }, fill: "main" }) }, /more than/);
  no({ ops: [{ op: "shape", path: { circle: [0, 0, 9] }, fill: "main", move: [1] }] }, /move/);
  // colours: palette names, hex in either length, and a few names models tend to use
  const fills = ["Main", "black", "#FFF", "#12abEF", "purple"].map((fill) => normalizeSpec({ ops: [{ op: "shape", path: { circle: [0, 0, 9] }, fill }, { op: "shape", path: { circle: [0, 0, 5] }, fill: "main" }] }).spec.ops[0].fill);
  assert.deepEqual(fills, ["main", "ink", "#ffffff", "#12abef", "#8b5cf6"]);
  // extra keys on a valid op are simply dropped
  assert.equal("onload" in normalizeSpec({ ops: [{ op: "shape", path: { circle: [0, 0, 9] }, fill: "main", onload: "x" }] }).spec.ops[0], false);
});

test("spec: a sticker that never uses the main colour gets its dominant colour promoted", () => {
  const circle = (fill, r = 9) => ({ op: "shape", path: { circle: [0, 0, r] }, fill });
  const fills = (raw) => { const { spec } = normalizeSpec(raw); return [spec.color, ...spec.ops.map((o) => o.fill || o.color)]; };
  // the sticker's own colour, when it is actually used
  assert.deepEqual(fills({ color: "#3A86FF", ops: [circle("red"), circle("red"), circle("#3a86ff"), circle("white")] }), ["#3a86ff", "red", "red", "main", "white"]);
  assert.deepEqual(fills({ color: "#3a86ff", ops: [circle("blue"), circle("red")] }), ["#3a86ff", "main", "red"]);   // palette name for the same colour
  // otherwise the colour that fills the most shapes; thin lines weigh less; white and ink never count
  assert.deepEqual(fills({ color: "#123456", ops: [circle("ink"), circle("white"), circle("green"), { op: "detail", pts: [[0, 0], [1, 1]], color: "red" }, { op: "detail", pts: [[0, 0], [1, 1]], color: "red" }] }), ["#06d6a0", "ink", "white", "main", "red", "red"]);
  // already uses main, or has nothing but white and ink: left alone
  assert.deepEqual(fills({ color: "#ff0000", ops: [circle("main"), circle("red")] }), ["#ff0000", "main", "red"]);
  assert.deepEqual(fills({ color: "#ff0000", ops: [circle("white"), circle("ink")] }), ["#ff0000", "white", "ink"]);
});

test("spec: ellipses, arcs, turning and mirroring", () => {
  const { spec, error } = normalizeSpec({ ops: [
    { op: "shape", path: { ellipse: [-30, 10, 20, 999] }, fill: "main", mirror: true, turn: 720 },
    { op: "shape", path: { ellipse: [0, 0, 20, 10, 30] }, fill: "white" },
    { op: "detail", arc: [-8, 0, 8, 10, 170], mirror: "yes" },
    { op: "blob", paths: [{ circle: [-40, 0, 20] }], fill: "main", mirror: true },
  ] });
  assert.equal(error, undefined);
  assert.deepEqual(spec.ops[0], { op: "shape", path: { ellipse: [-30, 10, 20, 140, 0] }, fill: "main", shadow: true, lw: 7, turn: 360, mirror: true });
  assert.deepEqual(spec.ops[1].path, { ellipse: [0, 0, 20, 10, 30] });
  assert.deepEqual(spec.ops[2], { op: "detail", arc: [-8, 0, 8, 10, 170], color: "ink", lw: 6 });   // mirror must be exactly true
  assert.deepEqual(normalizeSpec(spec).spec, spec);
  assert.match(normalizeSpec({ ops: [{ op: "line", arc: [0, 0, 5], color: "main" }] }).error, /arc/);
  assert.match(normalizeSpec({ ops: [{ op: "shape", path: { ellipse: [0, 0, 5] }, fill: "main" }] }).error, /ellipse/);

  // what reaches the canvas: a mirrored shape is painted on both sides, reflected in geometry
  const seen = [];
  const ctx = new Proxy({}, { get: (t, k) => (...a) => { seen.push([k, ...a]); return {}; }, set: () => true });
  drawSpec(ctx, normalizeSpec({ ops: [{ op: "shape", path: { circle: [-30, 5, 10] }, fill: "main", shadow: false, mirror: true }] }).spec, null);
  assert.deepEqual(seen.filter((c) => c[0] === "arc").map((c) => c.slice(1, 4)), [[-30, 5, 10], [30, 5, 10]]);
  seen.length = 0;
  drawSpec(ctx, normalizeSpec({ ops: [{ op: "detail", arc: [-8, 0, 8, 10, 170], mirror: true, move: [5, 0], turn: 90 }] }).spec, null);
  assert.deepEqual(seen.filter((c) => c[0] === "translate").map((c) => c.slice(1)), [[5, 0], [-5, 0]]);
  const rot = seen.filter((c) => c[0] === "rotate").map((c) => c[1]);
  assert.ok(Math.abs(rot[0] - Math.PI / 2) < 1e-9 && Math.abs(rot[1] + Math.PI / 2) < 1e-9);
  const arcs = seen.filter((c) => c[0] === "arc");
  assert.deepEqual([arcs[1][1], arcs[1][6]], [8, true]);                 // reflected centre, drawn the other way round
  // a mirrored blob is one merged silhouette: both halves in every pass
  seen.length = 0;
  drawSpec(ctx, normalizeSpec({ ops: [{ op: "blob", paths: [{ circle: [-40, 0, 20] }], fill: "main", mirror: true }] }).spec, null);
  assert.deepEqual(seen.filter((c) => c[0] === "arc").map((c) => c[1]), [-40, 40, -40, 40, -40, 40]);
});

test("spec: found inside a chatty or fenced reply", () => {
  const json = JSON.stringify(EXAMPLES[0].spec);
  assert.equal(parseSpec(json).spec.name.en, "Heart");
  assert.equal(parseSpec("Here you go:\n```json\n" + json + "\n```\nEnjoy!").spec.name.en, "Heart");
  assert.match(parseSpec("sorry, I cannot").error, /no JSON/);
  assert.match(parseSpec("{ not json }").error, /not valid JSON/);
});

test("ai: settings are normalised and endpoints are joined for both styles", () => {
  assert.deepEqual(normalizeAi(null), { style: "openai", baseUrl: "", token: "", model: "", auth: "key", maxTokens: 4096, timeout: 300, proxy: "", notes: "", kind: "solid" });
  assert.deepEqual(["flat", "solid", "x"].map((kind) => normalizeAi({ kind }).kind), ["flat", "solid", "solid"]);
  assert.deepEqual([5, 99999, "x", 120].map((timeout) => normalizeAi({ timeout }).timeout), [30, 1800, 300, 120]);
  assert.equal(normalizeAi({ style: "x", maxTokens: 9e9 }).maxTokens, 64000);
  assert.equal(aiReady(normalizeAi({ baseUrl: "https://a.b/v1", model: "m" })), true);
  assert.equal(aiReady(normalizeAi({ baseUrl: "a.b/v1", model: "m" })), false);
  assert.equal(aiReady(normalizeAi({ baseUrl: "https://a.b/v1" })), false);
  const url = (style, baseUrl) => endpoint({ style, baseUrl });
  assert.equal(url("openai", "https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(url("openai", "http://localhost:11434/v1/"), "http://localhost:11434/v1/chat/completions");
  assert.equal(url("openai", "https://x.y/v1/chat/completions"), "https://x.y/v1/chat/completions");
  assert.equal(url("anthropic", "https://api.anthropic.com"), "https://api.anthropic.com/v1/messages");
  assert.equal(url("anthropic", "https://gw.example/anthropic/"), "https://gw.example/anthropic/v1/messages");
  assert.equal(url("anthropic", "https://api.anthropic.com/v1"), "https://api.anthropic.com/v1/messages");
  assert.equal(url("anthropic", "https://api.anthropic.com/v1/messages"), "https://api.anthropic.com/v1/messages");
});

test("ai: requests follow each API style", () => {
  const o = buildRequest(normalizeAi({ style: "openai", baseUrl: "https://a/v1", token: "sk-1", model: "m1" }), "SYS", "USR");
  assert.equal(o.headers.authorization, "Bearer sk-1");
  assert.deepEqual(o.body, { model: "m1", messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USR" }] });
  const a = buildRequest(normalizeAi({ style: "anthropic", baseUrl: "https://a", token: "k", model: "m2", maxTokens: 2000 }), "SYS", "USR");
  assert.equal(a.headers["x-api-key"], "k"); assert.equal(a.headers.authorization, undefined);
  assert.equal(a.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(a.body, { model: "m2", max_tokens: 2000, system: "SYS", messages: [{ role: "user", content: "USR" }] });
  const b = buildRequest(normalizeAi({ style: "anthropic", baseUrl: "https://a", token: "t", model: "m", auth: "bearer" }), "S", "U");
  assert.equal(b.headers.authorization, "Bearer t"); assert.equal(b.headers["x-api-key"], undefined);
  const none = buildRequest(normalizeAi({ style: "openai", baseUrl: "http://localhost/v1", model: "m" }), "S", "U");
  assert.equal(none.headers.authorization, undefined);               // local servers need no token
});

test("ai: replies and errors are read for each API style", () => {
  assert.deepEqual(readReply("openai", 200, JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] })), { text: "hi", truncated: false });
  assert.deepEqual(readReply("openai", 200, JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] } }] })), { text: "ab", truncated: false });
  assert.equal(readReply("openai", 200, JSON.stringify({ choices: [{ message: { content: "{" }, finish_reason: "length" }] })).truncated, true);
  assert.deepEqual(readReply("anthropic", 200, JSON.stringify({ content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "ok" }], stop_reason: "end_turn" })), { text: "ok", truncated: false });
  assert.equal(readReply("anthropic", 200, JSON.stringify({ content: [{ type: "text", text: "{" }], stop_reason: "max_tokens" })).truncated, true);
  assert.match(readReply("openai", 401, JSON.stringify({ error: { message: "bad key" } })).error, /HTTP 401: bad key/);
  assert.match(readReply("anthropic", 404, JSON.stringify({ type: "error", error: { type: "not_found_error", message: "model: nope" } })).error, /HTTP 404: model: nope/);
  assert.match(readReply("openai", 502, "<html>Bad gateway</html>").error, /HTTP 502: <html>/);
  assert.match(readReply("openai", 200, "<html>").error, /did not return JSON/);
  assert.match(readReply("openai", 200, JSON.stringify({ choices: [] })).error, /no text/);
});

test("solid: the 3D prompt's own examples are valid and can be drawn", () => {
  for (const e of SOLID_EXAMPLES) {
    const { spec, error } = normalizeSpec(e.spec);                    // normalizeSpec recognises a solid by its kind
    assert.equal(error, undefined, `${e.ask}: ${error}`);
    assert.equal(spec.kind, "solid");
    assert.deepEqual(normalizeSpec(spec).spec, spec);
    assert.deepEqual(parseSpec("```json\n" + JSON.stringify(e.spec) + "\n```").spec, spec);
    const ctx = fakeCtx(); drawSpec(ctx, spec, "#00e5ff");
    assert.ok(ctx.calls.fill > spec.parts.length, e.ask);             // every part has several visible faces
    assert.equal(ctx.calls.save, ctx.calls.restore, e.ask);
    assert.ok(solidPrompt().includes(JSON.stringify(e.spec)));
  }
});

test("solid: defaults, clamping and refusals", () => {
  const { spec } = normalizeSolid({ name: "Box", parts: [{ box: [100, -50, 9999] }, { cyl: [50, 20], axis: "q", tip: 9999, sides: 99, tone: "black", at: [0, 0, 9999] }], marks: [{ circle: [0, 0, 10] }, { rect: [0, 0, 5, 5], fill: "red" }] });
  assert.deepEqual(spec.view, DEFAULT_VIEW);
  assert.deepEqual(spec.parts[0], { box: [100, 50, 480], at: [0, 0, 0], tone: "white" });
  assert.deepEqual(spec.parts[1], { cyl: [50, 20], axis: "y", tip: 240, sides: 28, at: [0, 0, 300], tone: "dark" });
  assert.deepEqual(spec.marks[0], { circle: [0, 0, 10], z: 0, line: 5 });   // a mark with neither fill nor line gets an outline
  assert.deepEqual(spec.marks[1], { rect: [0, 0, 5, 5], z: 0, fill: "red" });
  assert.equal(normalizeSpec({ parts: [{ box: [1, 2, 3] }] }).spec.kind, "solid");   // "parts" alone is enough to tell
  const no = (raw, re) => { const r = normalizeSolid(raw); assert.equal(r.spec, undefined); assert.match(r.error, re); };
  no({ kind: "solid" }, /parts: missing/); no({ parts: [{ sphere: [5] }] }, /needs box or cyl/);
  no({ parts: [{ box: [1, 2] }] }, /3 numbers/); no({ parts: [{ box: [1, 2, "3"] }] }, /not a number/);
  no({ parts: [{ box: [1, 2, 3], tone: "url(x)" }] }, /colour/); no({ parts: [{ box: [1, 2, 3] }], marks: [{ text: "hi" }] }, /rect, circle or path/);
  no({ parts: Array(SOLID_LIMITS.parts + 1).fill({ box: [1, 2, 3] }) }, /more than/);
  // any size is fitted to the same box: a tiny object and a huge one cover a similar area
  const reach = (k) => { const pts = []; const ctx = new Proxy({}, { get: (t, p) => (...a) => { if (p === "lineTo" || p === "moveTo") pts.push(a); return {}; }, set: () => true });
    drawSolid(ctx, normalizeSolid({ parts: [{ box: [40 * k, 40 * k, 40 * k] }] }).spec, null); return Math.max(...pts.flat().map(Math.abs)); };
  assert.ok(Math.abs(reach(1) - reach(10)) < reach(1) * 0.35, `${reach(1)} vs ${reach(10)}`);
});

test("ai: a retry sends the conversation so far, in both API styles", () => {
  const turns = [{ role: "user", content: "Request: x" }, { role: "assistant", content: "{bad" }, { role: "user", content: retryMessage("ops: missing") }];
  assert.match(turns[2].content, /cannot be used: ops: missing/);
  const o = buildRequest(normalizeAi({ style: "openai", baseUrl: "https://a/v1", model: "m" }), "SYS", turns);
  assert.deepEqual(o.body.messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  const a = buildRequest(normalizeAi({ style: "anthropic", baseUrl: "https://a", model: "m" }), "SYS", turns);
  assert.equal(a.body.system, "SYS"); assert.deepEqual(a.body.messages, turns);
});

test("ai: the prompt carries the style, the format and the user's notes", () => {
  const solid = buildPrompt("洗衣机", "", { kind: "solid" });
  for (const word of ['"kind":"solid"', '"box"', '"cyl"', "three flat tones", "y runs DOWN", "Request: a robot", "never write code"]) assert.ok(solid.system.includes(word), word);
  assert.notEqual(solid.system, buildPrompt("洗衣机").system);
  const p = buildPrompt("  一只猫  ");
  assert.equal(p.user, "Request: 一只猫");
  for (const word of ["flat colour", "ink outline", "-100 to 100", '"op":"shape"', '"op":"blob"', '"op":"line"', '"op":"detail"', '"op":"text"', "exactly one JSON object", "never write code", '"mirror": true', '"ellipse"', '"arc"', '"turn"', "do NOT draw outlines", "How to design a sticker", "Request: a cat"]) assert.ok(p.system.includes(word), word);
  assert.ok(!p.system.includes("Additional requirements"));
  assert.ok(buildPrompt("x", "always add a smile").system.endsWith("always add a smile"));
  assert.equal(buildPrompt("x", "", { style: "no-such-style" }).system, p.system);   // unknown styles fall back to the house style
});

// ---------- looks
import { LOOKS, LOOK_IDS, parseColour, role, lookParams, setLook, look, lookValues, styled, layerEffects, effectsFor, paintEffects, FX_STAGES, FX_TYPES } from "../ui/js/style.js";

test("looks: colours are read and classified by the job they do in the house style", () => {
  assert.deepEqual(parseColour("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColour("#07070C"), [7, 7, 12, 1]);
  assert.deepEqual(parseColour("rgba(10, 20,30,.5)"), [10, 20, 30, 0.5]);
  assert.equal(parseColour("url(#x)"), null); assert.equal(parseColour({}), null);
  const r = (c) => role(parseColour(c));
  assert.deepEqual(["#07070c", "#ffffff", "#cfd5e4", "#191926", "#3a3a4c", "#fcee0a", "#ff3b4f", "#00e5ff"].map(r), ["ink", "light", "mid", "dark", "dark", "colour", "colour", "colour"]);
});

test("looks: parameters default, clamp and are kept per look in a profile", () => {
  assert.deepEqual(lookParams("cel"), {});
  const d = lookParams("cyber");
  assert.deepEqual(Object.keys(d), LOOKS.cyber.params.map((p) => p.key));
  assert.equal(lookParams("cyber", { glow: 99, scan: "x" }).glow, 2);
  assert.equal(lookParams("cyber", { glow: 99, scan: "x" }).scan, d.scan);
  assert.equal("haze" in lookParams("cyber", { haze: 1 }), false);                    // values for sliders a look no longer has are dropped
  assert.deepEqual(lookParams("nope"), {});
  const p = normalizeProfile({ style: { look: "cyber", lookParams: { cyber: { glow: 0.5, bogus: 1 }, other: { x: 1 } } } });
  assert.equal(p.style.look, "cyber");
  assert.deepEqual(p.style.lookParams.cyber, { ...d, glow: 0.5 });
  assert.deepEqual(Object.keys(p.style.lookParams).sort(), LOOK_IDS.filter((id) => LOOKS[id].params.length).sort());   // every look with sliders, none unknown
  assert.equal(normalizeProfile({ style: { look: "vaporwave" } }).style.look, "cel");
  assert.deepEqual([undefined, 123456, -42.6, 5e9, "x"].map((lookSeed) => normalizeProfile({ style: { lookSeed } }).style.lookSeed), [7, 123456, 43, 0, 7]);
  assert.deepEqual(LOOK_IDS, ["cel", "cyber", "riso", "anime", "bluenote", "editorial", "songke", "vivid", "negative", "cinema", "cyano", "monofilm", "typo", "toon", "avant", "collage", "yellow", "pitch", "dots", "neon", "court", "velvet", "rave", "chrome", "netart", "verse", "glass", "jelly", "skies", "spectrum", "citypop", "construct", "deco"]);
  assert.equal(normalizeProfile({ style: { look: "brick" } }).style.look, "cel");   // a look that was withdrawn falls back to the house look
  assert.deepEqual(["bluetone", "redstreet", "ghibli", "gilded"].map((look) => normalizeProfile({ style: { look } }).style.look), ["cyano", "negative", "vivid", "glass"]);   // retired looks: the nearest one left
  for (const id of LOOK_IDS) { assert.ok(LOOKS[id].name.zh && LOOKS[id].name.en); for (const q of LOOKS[id].params) assert.ok(q.name.zh && q.name.en && (q.text ? typeof q.def === "string" && q.max > 0 : q.min <= q.def && q.def <= q.max), `${id}.${q.key}`); }
});

test("looks: the house look changes nothing, the cyberpunk look re-maps what is drawn", () => {
  const log = [];
  const ctx = { set fillStyle(v) { log.push(["fill=", v]); }, get fillStyle() { return "x"; }, set strokeStyle(v) { log.push(["stroke=", v]); }, get strokeStyle() { return "x"; },
    lineWidth: 6, globalAlpha: 1, stroke: () => log.push(["stroke"]), fill: () => log.push(["fill"]), fillRect: () => log.push(["fillRect"]), strokeRect: () => log.push(["strokeRect"]),
    fillText: () => log.push(["fillText"]), save() {}, restore() {} };
  setLook("cel");
  assert.equal(look().id, "cel"); assert.equal(styled(ctx, [252, 238, 10]), ctx);            // untouched
  setLook("cyber", { glow: 1 });
  assert.equal(lookValues().glow, 1);
  const c = styled(ctx, [252, 238, 10]);
  assert.notEqual(c, ctx);
  c.fillStyle = "#ffffff"; assert.match(log.at(-1)[1], /^rgba\(30,32,46/);                   // a white face becomes dark glass
  c.fillStyle = "#fcee0a"; assert.equal(log.at(-1)[1], "#fcee0a");                           // colour stays lit
  log.length = 0; c.strokeStyle = "#07070c"; c.stroke();
  assert.match(log[0][1], /^rgba\(252,238,10/);                                              // an ink edge takes the channel colour…
  assert.ok(log.filter((e) => e[0] === "stroke").length >= 3);                               // …and is drawn as a line of light: halo, line, core
  log.length = 0; c.strokeStyle = "#ff3b4f"; c.stroke();
  assert.equal(log.filter((e) => e[0] === "stroke").length, 1);                              // a coloured line is left alone
  log.length = 0; c.fillStyle = "#07070c"; c.fillText("A", 0, 0);
  assert.ok(log.some((e) => e[0] === "fill=" && /240,246,250/.test(e[1])));                  // ink lettering on an object turns pale
  assert.equal(styled(ctx, [252, 238, 10], true), ctx);                                      // the small cover parts stay ink on colour
  // the hooks a look may bring are all functions (or absent)
  for (const k of ["theme", "background", "runs", "wrap", "tag", "frame", "plate", "subject", "image", "post"]) assert.equal(typeof LOOKS.cyber[k], "function", k);
  assert.equal(LOOKS.cyber.seeded, true);
  for (const k of ["shape", "blob", "stroke", "thin", "word"]) assert.equal(typeof LOOKS.cyber.sticker[k], "function", k);
  assert.equal(LOOKS.cyber.oneTheme, true); assert.equal(LOOKS.cel.oneTheme, undefined);
  setLook("cel");
});

test("looks: what a look scatters at random follows the seed and holds still", () => {
  // the tear bands are the rectangles clipped in post(); record where they fall
  const bands = (seed, extra = {}, hits = []) => {
    const ys = [];
    const cv = { width: 800, height: 450 };
    const ctx = new Proxy({ canvas: cv }, { get: (t, k) => (k in t ? t[k] : k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (...a) => { if (k === "rect") ys.push(a[1]); return {}; }), set: () => true });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => ({}), set: () => true }) }) };
    try { setLook("cyber", { tear: 1.6, split: 1, ...extra }, seed); LOOKS.cyber.post(ctx, 800, 450, [252, 238, 10], lookValues(), 1, hits); } finally { delete globalThis.document; setLook("cel"); }
    return ys;
  };
  const a = bands(11), again = bands(11), b = bands(987654);
  assert.ok(a.length >= 3);
  assert.deepEqual(a, again);                                    // same seed: same places, so the export matches the preview
  assert.notDeepEqual(a, b);                                     // a new seed moves them
  for (const y of [...a, ...b]) assert.ok(y >= 0 && y <= 450);
  // lettering keeps its rows clear: a title across the middle, a rotated text layer lower down
  const words = [{ type: "title", cx: 400, cy: 200, hw: 300, hh: 70, r: 0 }, { type: "text", cx: 400, cy: 380, hw: 100, hh: 10, r: 90 }, { type: "graphic", cx: 600, cy: 60, hw: 60, hh: 60, r: 0 }];
  for (const seed of [1, 2, 3, 44, 555, 6666, 77777]) {
    const free = bands(seed, { tearClear: 0 }, words), kept = bands(seed, { tearClear: 1 }, words);
    assert.ok(free.some((y) => y >= 120), `seed ${seed}: nothing to avoid`);   // without the option some do cross
    for (const y of kept) assert.ok(y < 120, `seed ${seed}: a tear at ${y} crosses lettering`);   // rows 120–280 and 270–450 are taken, so only the top is free
    assert.ok(kept.length <= free.length);
  }
  assert.equal(lookParams("cyber").tearClear, 1);                // on by default
});

test("looks: the AI prompts take their style section from the look", () => {
  const flat = buildPrompt("x", "", { kind: "flat", style: "cyber" }).system, solid = buildPrompt("x", "", { kind: "solid", style: "cyber" }).system;
  assert.ok(flat.includes("cyberpunk") && flat.includes('"op":"shape"'));
  assert.ok(solid.includes("cyberpunk") && solid.includes('"kind":"solid"'));
  assert.ok(!buildPrompt("x", "", { kind: "flat" }).system.includes("cyberpunk"));
});

test("lettering layers may carry their own colour", () => {
  assert.deepEqual(LETTERED, ["title", "subtitle", "tag", "catname", "brand", "text"]);
  const ls = normalizeLayers([
    { type: "title", ink: "#FF00AA", hi: "#00ff00" }, { type: "tag", ink: "#123456", hi: "#00ff00" }, { type: "catname", ink: "red" }, { type: "brand", ink: "#abc" },
    { type: "accent", ink: "#ff0000" }, { type: "text", text: "x", ink: "#0000FF" }, { type: "asset", ref: { kind: "sticker", id: "star" }, ink: "#ff0000" },
  ]);
  const by = (type) => ls.find((l) => l.type === type);
  assert.equal(by("title").ink, "#ff00aa"); assert.equal(by("title").hi, "#00ff00");
  assert.equal(by("tag").ink, "#123456"); assert.equal(by("tag").hi, undefined);       // only headlines (title, text) have highlighted words
  assert.equal(by("catname").ink, undefined); assert.equal(by("brand").ink, undefined); // not six-digit hex: left automatic
  assert.equal(by("accent").ink, undefined);                                          // not lettering
  assert.equal(by("asset").ink, "#ff0000");                                           // a vector asset's colour of the user's
  assert.equal(by("text").ink, "#0000ff"); assert.equal(by("text").color, undefined);  // a text layer's own colour, as the title's
  assert.equal(duplicate(by("text")).ink, "#0000ff");
  assert.deepEqual(normalizeLayers(ls), ls);
  assert.deepEqual(LOOKS.cyber.params.map((q) => q.key).at(-1), "tearClear");            // the checkbox closes the list
});

test("looks: what a look paints on the ground lies on its base — its ground alone when asked for, and with every slider at nothing, nothing but the base", () => {
  // the Background's base (see PAINT.bg): the look's ground (`background` with `grid: false`), or nothing; then
  // its scene and its pattern (`ground: false`), which its sliders bring: all of them at their least, none of it
  const PAINTS = ["fill", "fillRect", "stroke", "strokeRect", "fillText", "strokeText", "drawImage", "putImageData"];
  const calls = () => { const n = {}; return [n, new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 50 }) : k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern" ? () => ({ addColorStop() {} }) : (...a) => { n[k] = (n[k] || 0) + 1; return {}; }), set: () => true })]; };
  const env = { w: 1920, h: 1080, C: [252, 238, 10], cat: { code: "VLOG", name: "Vlog" }, photo: null, o: { catIndex: 0, size: { w: 1920, h: 1080 }, profile: { brand: { name: "B" }, categories: [{}, {}] } } };
  const painted = (n) => PAINTS.filter((k) => n[k]).map((k) => `${k}×${n[k]}`);
  for (const id of LOOK_IDS.filter((k) => LOOKS[k].background)) for (const onDark of [true, false]) {
    const least = Object.fromEntries(LOOKS[id].params.filter((d) => !d.text).map((d) => [d.key, d.min]));
    let L = setLook(id, null, 3, onDark), [n, ctx] = calls();
    L.background(ctx, env, { grid: false }, lookValues());
    assert.ok(painted(n).length > 0, `${id} (${onDark ? "dark" : "light"}): its ground`);
    L = setLook(id, least, 3, onDark); [n, ctx] = calls();
    L.background(ctx, env, { grid: true, ground: false }, lookValues());
    assert.deepEqual(painted(n), [], `${id} (${onDark ? "dark" : "light"}): with every slider at its least, nothing on the base`);
  }
});

test("looks: every look is complete enough to draw and to brief the AI", () => {
  const calls = () => { const n = {}; return [n, new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 50 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (...a) => { n[k] = (n[k] || 0) + 1; return {}; }), set: () => true })]; };
  const env = { w: 1920, h: 1080, C: [252, 238, 10], cat: { code: "VLOG", name: "Vlog" }, photo: null, o: { catIndex: 0, size: { w: 1920, h: 1080 }, profile: { brand: { name: "B" }, categories: [{}, {}] } } };
  const pass = (fn) => { fn({ t: "Ab", hi: false }, 0); fn({ t: "cd", hi: true }, 60); };
  for (const id of LOOK_IDS.filter((k) => k !== "cel")) for (const onDark of [true, false]) {
    const L = setLook(id, null, 3, onDark), p = lookValues();
    assert.ok(L.prompt.length > 200 && L.solidPrompt.length > 200, id);
    assert.ok(buildPrompt("x", "", { kind: "flat", style: id }).system.includes(L.prompt), id);
    assert.equal(typeof L.theme({ field: "#000", text: "#fff" }, env.C, p).field, "string", id);
    let [n, ctx] = calls(); L.runs(ctx, pass, { fs: 100, d: 6, strokeAmt: 1, shadowAmt: 1, C: env.C, unit: 1 }, p); assert.ok(n.fillText >= 2, `${id}: lettering`);
    [n, ctx] = calls(); assert.equal(L.background(ctx, env, { grid: true }, p), true, id); assert.ok(n.fillRect >= 1, `${id}: background`);
    [n, ctx] = calls(); L.frame(ctx, env, p);
    if (L.post) { [n, ctx] = calls(); L.post(ctx, 1920, 1080, env.C, p, 1, []); }   // every hook is optional
    assert.equal(typeof L.accent.fill(env.C), "string", id);
    [n, ctx] = calls(); L.accent.edge(ctx, () => { n.run = (n.run || 0) + 1; }, 0, -1, env.C, p);
    if (L.sticker) for (const k of ["shape", "blob", "stroke", "thin", "word"]) assert.equal(typeof L.sticker[k], "function", `${id}.${k}`);
    if (L.sticker) { [n, ctx] = calls(); L.sticker.shape(ctx, (c) => c.rect(0, 0, 5, 5), "#ff3b4f", { shadow: true, lw: 7 }, p); assert.ok(n.fill >= 1, `${id}: sticker`); }
    if (L.wrap) { const seen = []; const raw = { set fillStyle(v) { seen.push(v); }, get fillStyle() { return "x"; }, lineWidth: 1 }; L.wrap(raw, env.C, p, false).fillStyle = "#07070c"; assert.equal(seen.length, 1, `${id}: wrap`); }
  }
  setLook("cel");
});

test("the summer illustration look: channel colours made vivid, greys kept, the street standing on the colour field's edge", () => {
  const V = LOOKS.vivid, rgbOf = (v) => parseColour(v).slice(0, 3), satOf = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b);
  assert.deepEqual(rgbOf(V.accent.fill([128, 128, 128])), [128, 128, 128]);                 // a grey stays grey
  const dull = [170, 130, 100], made = rgbOf(V.accent.fill(dull));
  assert.ok(satOf(made) > satOf(dull) + 0.15, "more saturated");
  assert.ok(made[0] > made[1] && made[1] > made[2], "the same hue: still an orange");
  // the houses stand on the top edge of the field (stack: the field is below, its edge slanted); their feet go behind it
  const pts = [];
  const ctx = new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "lineTo" || k === "moveTo" ? (x, y) => pts.push([x, y]) : () => ({})), set: () => true });
  const edge = (x) => 700 - (100 * x) / 1920;
  const G = { edge: { line: [0, 700, 1920, 600], nx: 0, ny: -1 } };
  setLook("vivid", { town: 0.3, clouds: 0, flags: 0 }, 5);   // the street, risen in full, and no tower yet
  V.background(ctx, { w: 1920, h: 1080, photo: null, G }, { grid: true }, lookValues());
  assert.ok(pts.length > 40);
  for (const [x, y] of pts) assert.ok(y < edge(x) + 1080 * 0.06 + 1, `a house below the field's edge at x ${x}`);
  assert.ok(pts.some(([x, y]) => y < edge(x) - 40), "they rise above it");
  assert.ok(pts.some(([x, y]) => y > edge(x) + 20), "and their feet are behind the field");
  // every slider brings its part in by degrees: the street rises, clouds are added one after another
  const highest = (town) => { pts.length = 0; setLook("vivid", { town, clouds: 0, flags: 0 }, 5); V.background(ctx, { w: 1920, h: 1080, photo: null, G }, { grid: true }, lookValues()); return Math.max(...pts.map(([x, y]) => edge(x) - y)); };
  const rise = [0.05, 0.15, 0.25, 0.3, 0.5].map(highest);
  for (let i = 1; i < rise.length; i++) assert.ok(rise[i] > rise[i - 1], `the street higher at each step: ${rise.join(", ")}`);
  let arcs = 0;
  const counting = new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "arc" ? () => arcs++ : () => ({})), set: () => true });
  const clouds = [0.1, 0.3, 0.5, 0.7, 0.85, 1].map((c) => { arcs = 0; setLook("vivid", { town: 0, clouds: c, flags: 0 }, 5); V.background(counting, { w: 1920, h: 1080, photo: null, G }, { grid: true }, lookValues()); return arcs; });
  for (let i = 1; i < clouds.length; i++) assert.ok(clouds[i] > clouds[i - 1], `more clouds at each step: ${clouds.join(", ")}`);
  assert.equal(V.name.zh, "夏日插画");
  assert.equal(normalizeProfile({ style: { look: "ghibli" } }).style.look, "vivid");   // its first name
  setLook("cel");
});

test("the poster looks: many settings each, their own grounds, flat layouts (all but the collage, on the slanted ones), and painting without a canvas does no harm", () => {
  const proxy = () => new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => ({})), set: () => true });
  for (const id of ["negative", "cinema", "cyano", "monofilm", "typo", "toon", "avant", "collage", "yellow", "pitch", "dots", "neon", "court", "velvet", "rave", "chrome", "netart", "verse", "glass", "jelly", "skies", "spectrum", "citypop", "construct", "deco"]) {
    const L = LOOKS[id];
    assert.ok(L.params.length >= 7, `${id}: ${L.params.length} settings`);
    assert.ok(L.name.zh && L.about.zh && L.prompt && L.solidPrompt && L.repaint("#ff0000"), id);
    for (const onDark of [true, false]) {
      setLook(id, null, 3, onDark);
      assert.match(L.theme({}, [40, 120, 220], lookValues()).field, /^rgba\(/);
      if (id !== "collage") assert.equal(L.layout("stack", 1920, 1080).template, "stack");
      const env = { w: 1920, h: 1080, C: [40, 120, 220], photo: null, cat: { code: "AB", name: "x" }, o: { profile: { brand: { name: "B" }, categories: [{}] }, catIndex: 0, size: { w: 1920, h: 1080 } }, G: (L.layout || LOOKS.bluenote.layout)("stack", 1920, 1080) };
      assert.equal(L.background(proxy(), env, { grid: true }, lookValues()), true);   // no canvas, no graphic: the parts that need one are left out
      L.post(proxy(), 1920, 1080, [40, 120, 220], lookValues(), 1, []);
    }
  }
  setLook("negative", { chan: 1 }, 7, false);   // the light ground is the red one
  assert.equal(LOOKS.negative.theme({}, [40, 120, 220], lookValues()).field, "rgba(40,120,220,1)");   // the channel colour in place of the red
  setLook("toon", null, 3, true);
  const night = parseColour(LOOKS.toon.theme({}, [252, 238, 10], lookValues()).field);
  assert.ok(night[2] > night[0] && (0.2126 * night[0] + 0.7152 * night[1] + 0.0722 * night[2]) / 255 < 0.15, "the animated poster's deep ground: a night blue, whatever the channel colour");
  setLook("toon", null, 3, false);
  const day = parseColour(LOOKS.toon.theme({}, [40, 120, 220], lookValues()).field);
  assert.ok(day[2] > day[0] + 80, "its bright ground: the channel colour, made more vivid");
  setLook("cinema", null, 3, true);
  const dusk = parseColour(LOOKS.cinema.theme({}, [230, 140, 40], lookValues()).field);
  assert.ok(dusk[0] > dusk[2] && (0.2126 * dusk[0] + 0.7152 * dusk[1] + 0.0722 * dusk[2]) / 255 < 0.3, "the cinema ground: a dark, muted version of the channel colour");
  setLook("cel");
});

test("a look's figure drawn from a graphic: each such look names its slider, and a profile keeps the graphic put in its place", () => {
  const arts = LOOK_IDS.filter((id) => LOOKS[id].art);
  assert.deepEqual(arts.sort(), ["avant", "chrome", "cinema", "citypop", "construct", "cyano", "deco", "dots", "glass", "jelly", "monofilm", "negative", "neon", "netart", "rave", "spectrum", "toon", "velvet", "verse", "yellow"]);
  for (const id of arts) { const d = LOOKS[id].params.find((q) => q.key === LOOKS[id].art); assert.ok(d && !d.text && !d.toggle && !d.needsPhoto, `${id}: the picker sits under a slider`); }
  const p = normalizeProfile({ style: { lookArt: { jelly: { kind: "sticker", id: "star" }, citypop: { kind: "user", id: "u9", extra: 1 }, deco: { kind: "bogus", id: "x" }, cel: { kind: "graphic", id: "gear" }, nope: { kind: "graphic", id: "gear" }, toon: { kind: "graphic" } } } });
  assert.deepEqual(p.style.lookArt, { jelly: { kind: "sticker", id: "star" }, citypop: { kind: "user", id: "u9" } });   // only looks with a figure, only real references
  assert.deepEqual(normalizeProfile({}).style.lookArt, {});
  assert.ok(usedUserAssets(p, null).includes("u9"), "an upload a figure is drawn from travels with the profile");
});

test("the jelly machine's panel and circuit stay as they are whatever size the jelly figure is", () => {
  const rec = () => { const log = []; return [new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 10 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : (...a) => { log.push(k + a.map((v) => (typeof v === "number" ? v.toFixed(1) : "")).join()); return {}; }), set: () => true }), log]; };
  const L = LOOKS.jelly, env = { w: 1920, h: 1080, C: [40, 120, 220], photo: null, cat: { code: "AB", name: "x" }, o: { profile: { brand: { name: "B" }, categories: [{}] }, catIndex: 0, size: { w: 1920, h: 1080 } }, G: L.layout("stack", 1920, 1080) };
  const paint = (figure) => { setLook("jelly", { figure, speakers: 0, cables: 0, blobs: 0, lcd: 0 }, 3, true); const [ctx, log] = rec(); L.background(ctx, env, { grid: true }, lookValues()); return log; };
  const small = paint(0.1), large = paint(1);
  assert.ok(small.length > 100, "the panel, its print, circuit and knobs are drawn");
  assert.deepEqual(large, small);
  // its own slider sizes it: as it was at the default, larger and smaller either side
  const board = (b) => { setLook("jelly", { board: b, speakers: 0, cables: 0, blobs: 0, lcd: 0 }, 3, true); const [ctx, log] = rec(); L.background(ctx, env, { grid: true }, lookValues()); return log; };
  // at 0.5 the panel is where it always was: from where a jelly of the default size reaches (or the field's
  // margin) to the field's other margins; at 1 the whole field less its margins (the panel is the first path drawn)
  const panel = (log) => { const m = log.find((c) => c.startsWith("moveTo")).slice(6).split(",").map(Number), a = log.find((c) => c.startsWith("arcTo")).slice(5).split(",").map(Number); return { x0: m[0] - 1080 * 0.025, y0: m[1], x1: a[0], y1: a[3] }; };
  const all = panel(board(1)), mid = panel(board(0.5)), fw = all.x1 - all.x0 + 48, fh = all.y1 - all.y0 + 48;
  assert.ok(Math.abs(mid.x0 - Math.max(all.x0, all.x0 - 24 + fw * 0.64 - fh * (0.4 + 0.42 * 0.55))) < 0.2 && mid.x0 > all.x0 + 1, `${mid.x0} against ${all.x0}`);
  assert.deepEqual([mid.y0, mid.x1, mid.y1], [all.y0, all.x1, all.y1]);
  assert.notDeepEqual(board(0.1), board(0.5));
  assert.notDeepEqual(board(0.9), board(0.5));
});

test("the first five looks have many settings now, and paint without a canvas", () => {
  const proxy = () => new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (str) => ({ width: String(str).length * 50 }) : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} }) : () => ({})), set: () => true });
  const want = { riso: ["pitch", "shapes", "speckle", "streaks", "ghost"], anime: ["clouds", "dusk", "rays", "flare", "leak", "vignette"], bluenote: ["vinyl", "ring", "edges", "fade", "halftone"], editorial: ["numeral", "text", "quote", "gutter", "spot"], songke: ["text", "notes", "seals", "wear", "stain", "worm"] };
  for (const [id, keys] of Object.entries(want)) {
    const L = LOOKS[id], have = L.params.map((d) => d.key);
    assert.ok(L.params.length >= 8, `${id}: ${L.params.length} settings`);
    for (const k of keys) assert.ok(have.includes(k), `${id} has ${k}`);
    for (const onDark of [true, false]) {
      setLook(id, Object.fromEntries(keys.map((k) => [k, 1])), 3, onDark);   // everything at full
      const G = (L.layout || LOOKS.bluenote.layout)("stack", 1920, 1080);
      const env = { w: 1920, h: 1080, C: [40, 120, 220], photo: null, hasBrand: true, cat: { code: "AB", name: "x" }, cover: { title: "夏日出逃\n去*海边*", tag: "EP.07", layers: [{ type: "title", visible: true }] },
        o: { profile: { brand: { name: "B" }, categories: [{}] }, catIndex: 0, size: { w: 1920, h: 1080 } }, G };
      assert.equal(L.background(proxy(), env, { grid: true }, lookValues()), true);
      L.post(proxy(), 1920, 1080, [40, 120, 220], lookValues(), 1, []);
    }
  }
  setLook("cel");
});

test("recolouring by lightness: a tone table runs through its stops, and hard tones step between them", async () => {
  const { toneTable: _t } = await import("../ui/js/style.js").then((m) => ({ toneTable: m.__test && m.__test.toneTable }));
  assert.ok(_t, "toneTable is exported for testing");
  const lut = _t([[0, [0, 0, 0]], [0.5, [255, 0, 0]], [1, [255, 255, 255]]]);
  assert.deepEqual([...lut.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...lut.slice(255 * 3)], [255, 255, 255]);
  assert.ok(Math.abs(lut[64 * 3] - 128) <= 2 && lut[64 * 3 + 1] === 0, "a quarter of the way up: half way from the black stop to the red one");
  const hard = _t([[0, [0, 0, 0]], [1, [200, 200, 200]]], 1);
  assert.equal(hard[100 * 3], 0); assert.equal(hard[160 * 3], 200);   // fully hard: each step goes to the nearer stop
});

test("the yellow poster and the neon pop: the yellow can give way to the channel colour; the neon palette turns round the wheel", () => {
  setLook("yellow", null, 3, false);
  assert.equal(LOOKS.yellow.theme({}, [40, 120, 220], lookValues()).field, "rgba(255,206,0,1)");
  setLook("yellow", { chan: 1 }, 3, false);
  const blue = parseColour(LOOKS.yellow.theme({}, [40, 120, 220], lookValues()).field);
  assert.ok(blue[2] > blue[0] + 100, "the channel colour, made vivid, in place of the yellow");
  const hi = (C) => { const out = []; LOOKS.yellow.runs({ set fillStyle(v) { out.push(v); }, get fillStyle() { return ""; }, fillText() {}, transform() {} }, (fn) => fn({ t: "x", hi: true }, 0), { fs: 100, C, shadowAmt: 0 }); return out[0]; };
  setLook("yellow", { chan: 1 }, 3, false);
  assert.equal(hi([252, 238, 10]), "rgba(230,0,126,1)", "a yellow channel on its own yellow ground: the highlight goes magenta, never the ground's colour");
  setLook("neon", null, 3, true);
  const a = LOOKS.neon.theme({}, [40, 120, 220], lookValues()).titleFill;
  setLook("neon", { shift: 0.5 }, 3, true);
  assert.notEqual(LOOKS.neon.theme({}, [40, 120, 220], lookValues()).titleFill, a, "turning the hue changes the palette");
  setLook("cel");
});

test("the court, velvet, rave, chrome and net-art looks: their grounds, the team colour, the typed number", () => {
  setLook("court", null, 3, false);
  assert.equal(LOOKS.court.theme({}, [40, 120, 220], lookValues()).field, "rgba(236,234,228,1)");   // a worn white wall
  assert.equal(lookParams("court", { jersey: " 1234 " }).jersey, "123");
  setLook("velvet", null, 3, false);
  assert.equal(LOOKS.velvet.theme({}, [40, 120, 220], lookValues()).field, "rgba(98,112,218,1)");   // periwinkle
  setLook("rave", null, 3, true);
  assert.ok(LOOKS.rave.oneTheme, "the rave is a night look only");
  for (const onDark of [true, false]) {   // the chrome and net-art lettering stays just off the house ink, so the small parts' ink can be swapped on its own
    setLook("chrome", null, 3, onDark);
    const t = parseColour(LOOKS.chrome.theme({}, [40, 120, 220], lookValues()).text);
    assert.notEqual(role(t), "ink", `chrome on ${onDark ? "black" : "grey"}`);
  }
  setLook("netart", null, 3, false);
  assert.equal(LOOKS.netart.accent.fill([40, 120, 220]), "rgba(192,192,192,1)");   // a silver system panel
  setLook("cel");
});

test("the comic-verse, glass, jelly, anime-sky and spectral looks: many layers each, their grounds and colours", () => {
  for (const id of ["verse", "glass", "jelly", "skies", "spectrum"]) {
    const L = LOOKS[id];
    assert.ok(L.params.length >= 11, `${id}: ${L.params.length} settings`);
    assert.ok(L.seeded && typeof L.layout === "function", `${id}: seeded, with flat layouts of its own`);
  }
  setLook("verse", null, 3, false);
  assert.equal(LOOKS.verse.accent.fill([248, 244, 246]), "rgba(255,40,150,1)", "a channel colour lost on the paper gives way to magenta");
  assert.notEqual(LOOKS.verse.accent.fill([40, 120, 220]), "rgba(255,40,150,1)", "any other is kept, made vivid");
  for (const onDark of [true, false]) {   // the anime sky's lettering is white by day and at dusk
    setLook("skies", null, 3, onDark);
    assert.equal(LOOKS.skies.theme({}, [40, 120, 220], lookValues()).titleFill, "rgba(255,255,255,1)");
  }
  setLook("spectrum", null, 3, true);
  assert.equal(LOOKS.spectrum.theme({}, [40, 120, 220], lookValues()).field, "rgba(14,14,14,1)");   // black paper
  assert.ok(LOOKS.glass.params.every((d) => !d.needsPhoto), "the glass bends a photo with the same sliders");
  setLook("cel");
});

test("the city pop night and the constructivist poster: many layers each, their grounds, a red that turns to the channel colour by degrees; blocks and cel tones", async () => {
  for (const id of ["citypop", "construct"]) {
    const L = LOOKS[id];
    assert.ok(L.params.length >= 12 && L.seeded && typeof L.layout === "function", `${id}: ${L.params.length} settings, seeded, flat layouts of its own`);
    assert.ok(Object.keys(L.scene).length >= 4 && L.elementFx.length >= 3, `${id}: scene objects and effects`);
  }
  assert.ok(LOOKS.citypop.oneTheme, "the city pop is a night look only");
  setLook("citypop", { dusk: 0 }, 3, true);
  const night = parseColour(LOOKS.citypop.theme({}, [40, 120, 220], lookValues()).field);
  setLook("citypop", { dusk: 1 }, 3, true);
  const dusk = parseColour(LOOKS.citypop.theme({}, [40, 120, 220], lookValues()).field);
  assert.ok(night[2] > night[0] * 2 && dusk[0] > night[0] + 40, "a navy night, warming to a violet dusk");
  setLook("construct", null, 3, false);
  assert.equal(LOOKS.construct.theme({}, [40, 120, 220], lookValues()).field, "rgba(232,223,202,1)");   // cream paper
  assert.equal(LOOKS.construct.accent.fill([40, 120, 220]), "rgba(204,52,38,1)");   // the poster red
  const red = (chan) => { setLook("construct", { chan }, 3, false); return parseColour(LOOKS.construct.accent.fill([40, 120, 220])); };
  const [r0, r5, r1] = [0, 0.5, 1].map(red);
  assert.ok(r0[2] < r5[2] && r5[2] < r1[2] && r0[0] > r5[0] && r5[0] > r1[0], "the red turns to the channel colour by degrees");
  const { joinCells, celPixels } = (await import("../ui/js/style.js")).__test;
  const ok = (i, j) => (i * 7 + j * 3) % 5 !== 0, cols = 23, rows = 17, seen = new Uint8Array(cols * rows);
  for (const [i, j, w, h] of joinCells(cols, rows, ok, () => true, 4, 6, 1)) for (let b = 0; b < h; b++) for (let a = 0; a < w; a++) { assert.ok(ok(i + a, j + b)); seen[(j + b) * cols + i + a]++; }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) assert.equal(seen[j * cols + i], ok(i, j) ? 1 : 0, "every allowed cell in one block, no other");
  const ramp = (a) => { const d = new Uint8ClampedArray(256 * 4); for (let l = 0; l < 256; l++) d.set([l, l, l, l % 2 ? 255 : 128], l * 4); celPixels(d, a); return d; };
  const cel = ramp(1), at = (l) => [...cel.slice(l * 4, l * 4 + 3)];
  assert.ok(Math.abs(at(20)[1] - at(40)[1]) <= 1 && Math.abs(at(130)[1] - at(160)[1]) <= 1, "the lightness in flat steps");
  assert.ok(at(220)[1] - at(130)[1] > 60 && at(130)[1] - at(40)[1] > 40, "and the steps far apart");
  assert.ok(at(30)[2] > at(30)[0] + 30, "the shadows sunk toward a night teal");
  assert.ok([...Array(256).keys()].every((l) => cel[l * 4 + 3] === (l % 2 ? 255 : 128)), "alpha kept");
  assert.deepEqual([...ramp(0)].filter((_, i) => i % 4 === 1), [...Array(256).keys()], "at nothing, nothing changes");
  setLook("cel");
});

test("the dark deco: Gotham's night by default, a crimson sky and black and gold by degrees, the channel colour as floodlight; a photo painted into the night", async () => {
  const L = LOOKS.deco;
  assert.ok(L.params.length >= 12 && L.seeded && L.oneTheme && typeof L.layout === "function", `${L.params.length} settings, seeded, night only, flat layouts of its own`);
  assert.ok(Object.keys(L.scene).length >= 5 && L.elementFx.length >= 4, "scene objects and effects");
  assert.equal(L.layout("stack", 1920, 1080).cat.onAccent, false, "the channel name on the black base is set as on the field");
  const field = (p) => { setLook("deco", p, 3, true); return parseColour(L.theme({}, [40, 120, 220], lookValues()).field); };
  const [night, red, gilt] = [{}, { red: 1 }, { gilt: 1 }].map(field);
  assert.ok(night[2] > night[0] * 3 && night[2] > 40, "an ultramarine night");
  assert.ok(red[0] > red[2] * 2 && red[0] > night[0] + 40, "turned to Gotham's crimson sky");
  assert.ok(gilt[0] >= gilt[2] && Math.max(...gilt) < 30, "or to black and gold");
  const { dkPixels, dkSpot } = (await import("../ui/js/style.js")).__test;
  const hue = (c) => Math.atan2(Math.sqrt(3) * (c[1] - c[2]), 2 * c[0] - c[1] - c[2]);
  for (const c of [[214, 28, 42], [6, 214, 160], [255, 183, 3]]) assert.ok(Math.abs(hue(dkSpot(c)) - hue(c)) < 0.2, `the floodlight keeps the channel's hue: ${c}`);
  const navy = dkSpot([20, 30, 120]);
  assert.ok((0.2126 * navy[0] + 0.7152 * navy[1] + 0.0722 * navy[2]) / 255 > 0.3, "and a dark blue is made light enough to read as light on the night");
  const px = (cols, f = (d) => dkPixels(d, 1, 0)) => { const d = new Uint8ClampedArray(cols.flat()); f(d); return [...Array(cols.length).keys()].map((i) => [...d.slice(i * 4, i * 4 + 4)]); };
  const [black, grey, white, scarlet, amber] = px([[20, 20, 20, 255], [128, 128, 128, 200], [250, 250, 250, 255], [220, 30, 30, 255], [250, 180, 40, 255]]);
  assert.ok(Math.max(...black.slice(0, 3)) < 14, "the shadows crushed to black");
  assert.ok(grey[2] > grey[0] * 2 && grey[3] === 200, "a mid grey into the ultramarine, alpha kept");
  assert.ok(white[0] > 200 && white[2] > 200, "the lights pale");
  assert.ok(scarlet[0] > scarlet[2] * 2 && amber[0] > amber[2] * 2 && amber[1] > scarlet[1], "warm colours kept as crimson and gold, not turned blue");
  assert.deepEqual(px([[90, 140, 60, 255]], (d) => dkPixels(d, 0, 0)), [[90, 140, 60, 255]], "at nothing, nothing changes");
  const once = px([[128, 128, 128, 255]])[0], twice = px([once], (d) => dkPixels(d, 1, 0, true))[0];
  assert.ok(once.slice(0, 3).every((v, i) => Math.abs(v - twice[i]) < 40), "read by value, a picture already in the night is not crushed again");
  // the lettering: no black outline round it; the highlighted words glass of the channel's own hue, light enough to read as light on the night
  const lumOf = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
  for (const C of [[251, 86, 7], [255, 183, 3], [58, 134, 255], [168, 85, 247], [6, 214, 160], [20, 30, 120]]) {
    const fills = [], strokes = [];
    const ctx = new Proxy({ canvas: null }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: [...s].length * 40 }) : k === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => {}), set: (t, k, v) => { if (k === "fillStyle" && typeof v === "string") fills.push(v); if (k === "strokeStyle") strokes.push(v); t[k] = v; return true; } });
    setLook("deco", {}, 3, true);
    L.runs(ctx, (fn) => { fn({ t: "Ab", hi: false }, 0); fn({ t: "cd", hi: true }, 80); }, { fs: 100, strokeAmt: 1, shadowAmt: 1, C, unit: 1 }, lookValues());
    const glass = parseColour(fills.at(-1)).slice(0, 3);
    if (C[2] !== 120) assert.ok(Math.abs(hue(glass) - hue(C)) < 0.25, `the glass keeps the channel's hue: ${C} -> ${glass.map(Math.round)}`);
    assert.ok(lumOf(glass) > 0.3, `and is light: ${C} -> ${glass.map(Math.round)}`);
    assert.ok(!strokes.some((v) => { const c = parseColour(v); return c && lumOf(c) < 0.1; }), "no black outline");
  }
  setLook("cel");
});

test("look effects on a layer: kept clean, carried by the layer whatever the look, painted stage by stage", () => {
  const [tx] = normalizeLayers([{ type: "text", text: "x", lookFx: { "riso.dots": 0.5, "riso.dots:pitch": 0, "chrome.drips": 0, "chrome.drips:x": 1, "netart.sort": 7, "bad key": 1, "riso.shift": "0.3", "riso.ghost": null } }]).filter((l) => l.type === "text");
  assert.deepEqual(tx.lookFx, { "riso.dots": 0.5, "riso.dots:pitch": 0, "netart.sort": 1, "riso.shift": 0.3 }, "an effect at 0 goes, with its own settings; a strength is kept within 0–1; a malformed key is dropped");
  const kinds = normalizeLayers([{ type: "solid", color: "#ff0000", lookFx: { "riso.dots": 1 } }, { type: "title", lookFx: { "riso.dots": 1 } }, { type: "brand", lookFx: { "riso.dots": 1 } }]);
  assert.deepEqual(kinds.find((l) => l.type === "solid").lookFx, { "riso.dots": 1 }, "a solid may carry them already");
  assert.deepEqual(kinds.find((l) => l.type === "title").lookFx, { "riso.dots": 1 }, "the title too, as a text layer does");
  assert.equal(kinds.find((l) => l.type === "brand").lookFx, undefined, "the other layout layers do not");
  assert.equal(normalizeLayers([{ type: "text", text: "x", lookFx: { "riso.dots": 0 } }]).find((l) => l.type === "text").lookFx, undefined);
  // every look's effects: a stage, both names, the user's own layers (a photo-only one for photos alone), a painter; keys unique within the look
  for (const id of LOOK_IDS) {
    const list = LOOKS[id].elementFx || [];
    assert.ok(list.length >= 1, `${id} has effects`);
    assert.equal(new Set(list.map((e) => e.key)).size, list.length, `${id}: keys unique`);
    for (const e of list) assert.ok(e.name.zh && e.name.en && /^[a-zA-Z]+$/.test(e.key) && e.for.length && e.for.every((t) => FX_TYPES.includes(t))
      && FX_STAGES.includes(e.stage) && typeof e.paint === "function", `${id}.${e.key}`);
  }
  // what four looks' letterings did, and the net art's selection, as post effects for any layer; the underline is the menu's
  for (const id of ["cyber.sliced", "riso.overprint", "anime.keyline", "vivid.block", "netart.selected"]) {
    const [look, key] = id.split("."), e = LOOKS[look].elementFx.find((f) => f.key === key);
    assert.ok(e && e.for.length === 4 && FX_STAGES.includes(e.stage), id);
  }
  assert.ok(!LOOKS.editorial.elementFx.some((e) => e.key === "underline"));
  assert.ok(["riso", "chrome", "netart"].every((id) => LOOKS[id].elementFx.length >= 4), "the pilots");
  assert.deepEqual(FX_TYPES, ["text", "asset", "photo", "solid", "title", "subtitle"]);
  assert.ok(effectsFor("cyber", "photo").some((e) => e.key === "tint") && !effectsFor("cyber", "text").some((e) => e.key === "tint"), "a photo's own effect is offered on photos only");
  assert.equal(effectsFor("skies", "text").length, 0, "a look whose only effect is a photo's");
  // a layer's effects apply whatever look the cover is in, in stage order, only those that suit its type
  const L = { id: "l1", type: "text", lookFx: { "netart.sort": 0.5, "chrome.chrome": 1, "riso.dots": 0.4, "riso.dots:pitch": 0.9, "chrome.drips": 0.3, "gone.away": 1 } };
  for (const at of ["cel", "velvet", "riso"]) {
    setLook(at, null, 3, true);
    const fx = layerEffects(L);
    assert.deepEqual(fx.map((e) => e.id), ["chrome.chrome", "riso.dots", "netart.sort", "chrome.drips"], `under ${at}: fill, over, filter, behind; an effect of no look left out`);
    assert.deepEqual(fx[1].opt, { pitch: 0.9 });
  }
  assert.deepEqual(layerEffects({ ...L, type: "photo" }).map((e) => e.id), ["chrome.chrome", "riso.dots", "netart.sort", "chrome.drips"], "the same on a photo");
  assert.deepEqual(layerEffects({ id: "l3", type: "text", lookFx: { "cyber.tint": 1 } }), [], "a photo's own effect on a text layer is left out");
  assert.deepEqual(layerEffects({ id: "l3", type: "photo", lookFx: { "cyber.tint": 1 } }).map((e) => e.id), ["cyber.tint"]);
  assert.deepEqual(layerEffects({ id: "l2", type: "text" }), []);
  // without a canvas (the tests' stand-in) painting them does no harm
  paintEffects({ canvas: null }, { x0: 0, y0: 0, x1: 100, y1: 50, w: 100, h: 50 }, layerEffects(L), L, 1, [255, 0, 0]);
  setLook("cel");
});

test("a look's typed setting: the experimental type's giant letters, trimmed and cut to eight, the channel code when empty", () => {
  assert.equal(lookParams("typo", { letters: "  Hello " }).letters, "Hello");
  assert.equal(lookParams("typo", { letters: "TYPOGRAPHY" }).letters, "TYPOGRAP");
  assert.equal(lookParams("typo", { letters: 42 }).letters, "");
  assert.equal(lookParams("typo", {}).letters, "");
  assert.equal(lookParams("typo", { letters: "实验字体排版设计练习" }).letters, "实验字体排版设计");
});

test("the title's block can be measured before it is drawn, as drawTitle and drawTitleVertical will set it", async () => {
  const { titleBlock, titleBlockVertical } = await import("../ui/js/title.js");
  const ctx = { font: "", save() {}, restore() {}, measureText: (str) => ({ width: String(str).length * 50 }) };
  const b = titleBlock(ctx, "ab\n*cde*", { x: 80, y: 150, w: 1000, h: 400 }, "serif");   // widest 150 at size 100: the height decides, 172
  assert.deepEqual([b.x, Math.round(b.w), Math.round(b.h)], [80, 258, 399]);
  assert.ok(Math.abs(b.y - (150 + (400 - 2 * 172 * 1.16) / 2)) < 1e-9);
  assert.equal(titleBlock(ctx, "", { x: 0, y: 0, w: 100, h: 100 }, "serif"), null);
  const v = titleBlockVertical(ctx, "一二三\n四五", { x: 300, y: 150, w: 800, h: 700 }, "serif");   // the tallest column: 3 × 106 at size 100; the size: 220
  assert.deepEqual([v.x, v.y, Math.round(v.w), Math.round(v.h)], [300, 150, Math.round(2 * 220 * 1.32 - (220 * 1.32 - 220)), Math.round(3 * 106 * 2.2)]);
});

test("looks that are about arrangement bring flat-edged layouts", async () => {
  const { blockLayout } = await import("../ui/js/layout.js");
  for (const id of ["bluenote", "editorial"]) for (const [w, h] of [[1920, 1080], [1600, 1200], [1200, 1200], [1200, 1600], [1080, 1920], [2350, 1000]]) for (const t of ["stack", "split", "banner"]) {
    const g = LOOKS[id].layout(t, w, h), where = `${id} ${t} ${w}x${h}`;
    assert.equal(g.template, t, where);
    const [a, b] = g.accent;
    assert.ok(a[0] === b[0] || a[1] === b[1], `${where}: the dividing edge is not straight`);     // no slant
    assert.deepEqual(g.edge.line, [a[0], a[1], b[0], b[1]], where);
    for (const [x, y] of g.accent) assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, where);
    assert.ok(g.title.w > 200 && g.title.h >= 120 && g.title.x + g.title.w <= w, `${where}: title box ${JSON.stringify(g.title)}`);
    assert.ok(g.title.y + g.title.h <= (t === "split" ? h : a[1]), `${where}: the title runs into the band`);
    assert.ok(g.art.s >= 0.3 && g.art.s <= 1.05 && g.art.x > 0 && g.art.x < w && g.art.y > 0 && g.art.y < h, where);
    assert.ok(g.cat.maxW > 100 && g.cat.y > 0 && g.cat.y < h && g.tag.y > 0 && g.tag.y < h, where);
  }
  assert.ok(blockLayout("stack", 1920, 1080, { band: 0.5 }).accent[0][1] < blockLayout("stack", 1920, 1080, { band: 0.2 }).accent[0][1]);
  assert.equal(LOOKS.riso.layout, undefined);                    // the others keep the profile's slanted layouts
});

test("templates can be adjusted, and their halves swapped", async () => {
  const { layout, blockLayout, adjustLayout, layoutValues, dragLayout, LAYOUT_LIMITS } = await import("../ui/js/layout.js");
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
  for (const [w, h] of [[1920, 1080], [1200, 1200], [1080, 1920]]) for (const base of [(t) => layout(t, w, h), (t) => blockLayout(t, w, h, { band: 0.36, side: 0.38, strip: 0.15 })]) for (const t of ["stack", "split", "banner"]) {
    const G = base(t), where = `${t} ${w}x${h}`;
    // nothing asked for: the same geometry, plus the flags the renderer reads
    const same = adjustLayout(G, w, h, {});
    assert.deepEqual(same.accent, G.accent, where); assert.deepEqual(same.title, G.title, where);
    assert.equal(same.railOnAccent, t === "split"); assert.equal(same.brandOnAccent, false); assert.equal(same.flipped, false);
    assert.notEqual(same.accent, G.accent);                                    // a copy: the template is left alone
    // size and slant come back as set, flipped or not
    for (const flip of [false, true]) {
      const g = adjustLayout(G, w, h, { size: 0.4, slant: 0.05, flip }), v = layoutValues(g, w, h);
      assert.ok(near(v.size, 0.4) && near(v.slant, 0.05), `${where} flip=${flip}: ${JSON.stringify(v)}`);
      assert.deepEqual(g.edge.line, [...g.accent[0], ...g.accent[1]], where);
      for (const [x, y] of g.accent) assert.ok(x >= -1 && x <= w + 1 && y >= -1 && y <= h + 1, where);
      assert.ok(g.title.w >= 200 && g.title.h >= 120 * 0.3 && g.title.x >= 0 && g.title.x + g.title.w <= w + 1, `${where} flip=${flip}: title ${JSON.stringify(g.title)}`);
      assert.ok(g.art.x > 0 && g.art.x < w && g.cat.y > 0 && g.cat.y <= h && g.tag.y > 0 && g.tag.y < h, `${where} flip=${flip}`);
      assert.equal(g.flipped, flip); assert.equal(g.brandOnAccent, flip);
    }
    // swapped: the panel really is on the other side, and the title clear of it
    const f = adjustLayout(G, w, h, { flip: true });
    if (t === "split") { assert.ok(f.accent[0][0] < w / 2 && f.accent[2][0] === 0, where); assert.ok(f.title.x > Math.max(f.accent[0][0], f.accent[1][0]), where); assert.equal(f.railOnAccent, false); }
    else { assert.ok(f.accent[0][1] < h / 2 && f.accent[2][1] === 0, where); assert.ok(f.titleTop > Math.max(f.accent[0][1], f.accent[1][1]), where); assert.equal(f.title.y, f.titleTop); assert.equal(f.railOnAccent, true); }
    // a smaller title box
    const small = adjustLayout(G, w, h, { tw: 0.5, th: 0.5 });
    assert.ok(near(small.title.w, G.title.w * 0.5, 1) && near(small.title.h, G.title.h * 0.5, 1), where);
    // dragging: the middle moves the edge without changing its lean; an end changes the lean; both hold when flipped
    for (const flip of [false, true]) {
      const g = adjustLayout(G, w, h, { flip }), v0 = layoutValues(g, w, h), [x0, y0, x1, y1] = g.edge.line, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const moved = dragLayout(g, w, h, { flip }, "m", mx + 40, my + 40), ended = dragLayout(g, w, h, { flip }, "a", x0 + 30, y0 + 30);
      assert.ok(near(moved.slant, v0.slant, 1e-6) && !near(moved.size, v0.size, 1e-4), `${where} flip=${flip}: middle`);
      assert.ok(!near(ended.slant, v0.slant, 1e-4), `${where} flip=${flip}: end`);
      const again = adjustLayout(G, w, h, moved), [, , , ] = again.edge.line;
      const nm = t === "split" ? (again.edge.line[0] + again.edge.line[2]) / 2 - mx : (again.edge.line[1] + again.edge.line[3]) / 2 - my;
      assert.ok(near(nm, 40, 0.01), `${where} flip=${flip}: the edge followed the pointer by ${nm}`);
      assert.equal(moved.flip, flip || undefined || flip);
    }
    const far = dragLayout(same, w, h, {}, "m", -9999, -9999);
    assert.ok(far.size <= LAYOUT_LIMITS.size[1] && far.size >= LAYOUT_LIMITS.size[0], where);   // kept within limits
    const box = { x: 80, y: 150, w: 800, h: 400 };
    assert.ok(near(dragLayout(same, w, h, {}, "tw", 80 + 400, 0, box).tw, 0.5)); assert.ok(near(dragLayout(same, w, h, { th: 0.8 }, "th", 0, 150 + 200, box).th, 0.4));
  }
  // what a profile keeps: only real settings, within limits, per template
  const p = normalizeProfile({ style: { layoutAdjust: { stack: { size: 9, slant: "x", flip: true, junk: 1 }, split: {}, nope: { size: 0.3 } } } });
  assert.deepEqual(p.style.layoutAdjust, { stack: { size: 0.8, flip: true } });
  assert.deepEqual(normalizeProfile(null).style.layoutAdjust, {});
});

test("text effects: a layer may choose one, and every one can be painted", async () => {
  const { EFFECTS, paintRuns } = await import("../ui/js/textfx.js");
  const { parseFont, primeOutline, outline } = await import("../ui/js/outlines.js");
  const { TEXT_EFFECTS } = await import("../ui/js/layers.js");
  const retired = ["cyber", "riso", "anime", "vivid"];                          // looks' letterings once in the menu: their looks' post effects now
  assert.deepEqual(TEXT_EFFECTS.filter((id) => !retired.includes(id)), Object.keys(EFFECTS));   // what a layer may store is what can be painted, and the names of before
  assert.ok(retired.every((id) => !(id in EFFECTS)) && "editorial" in EFFECTS, "the menu keeps the typesetting effects and the underline");
  for (const e of Object.values(EFFECTS)) assert.ok(e.name.zh && e.name.en && ["passes", "mask", "outline", "letters"].includes(e.kind));
  // on a layer: kept when valid, dropped when not, and "auto" is the absence of a choice
  const ls = normalizeLayers([{ type: "title", fx: "extrude", fxAmt: 1.5 }, { type: "text", text: "x", fx: "nope", fxAmt: 99 }, { type: "tag", fx: "dots" }, { type: "text", text: "y", fx: "auto", fxAmt: 1 }]);
  const title = ls.find((l) => l.type === "title"), texts = ls.filter((l) => l.type === "text");
  assert.equal(title.fx, "extrude"); assert.equal(title.fxAmt, 1.5);
  assert.equal(texts[0].fx, undefined); assert.equal(texts[0].fxAmt, 2);
  assert.equal(ls.find((l) => l.type === "tag").fx, undefined);                 // only headlines take effects
  assert.equal(texts[1].fx, undefined); assert.equal(texts[1].fxAmt, undefined);
  // font strings as the canvas has them
  assert.deepEqual(parseFont('900 120px "Bebas Neue", "Noto Sans SC", sans-serif'), { weight: 900, families: ["Bebas Neue", "Noto Sans SC"] });
  assert.deepEqual(parseFont("italic bold 20px Georgia, serif"), { weight: 700, families: ["Georgia"] });
  assert.equal(outline("900 100px X", "abc"), false);                           // no native side here: not to be had
  // painting: a context that records, runs with one plain and one highlighted word
  const o = { fs: 100, d: 6, strokeAmt: 1, shadowAmt: 1, amt: 1, lineW: 300, seed: 1, unit: 1, C: [252, 238, 10], fillCss: "#ffffff", hiCss: "#fcee0a", inkCss: "#07070c", shadowCss: "#fcee0a", hiShadowCss: "#ffffff" };
  const recorder = () => { const n = {}; const ctx = new Proxy({ font: "900 100px X", lineWidth: 1, globalAlpha: 1 }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: [...s].length * 60 }) : (...a) => { n[k] = (n[k] || 0) + 1; return {}; }), set: (t, k, v) => { t[k] = v; return true; } }); return [n, ctx]; };
  const pass = (ctx) => (fn) => { fn({ t: "Ab", hi: false }, 0); fn({ t: "cd", hi: true }, 130); };
  for (const [id, e] of Object.entries(EFFECTS)) for (const lookId of ["cel", "cyber"]) {
    setLook(lookId);
    const [n, ctx] = recorder();
    paintRuns(ctx, pass(ctx), { ...o }, id);
    assert.ok((n.fillText || 0) >= 2 || (n.fill || 0) >= 1, `${id} under ${lookId}: nothing painted`);   // without a real canvas or outlines, mask and outline effects fall back to lettering
    assert.equal(n.save || 0, n.restore || 0, `${id} under ${lookId}: unbalanced save/restore`);
    void e;
  }
  setLook("cel");
  // with outlines to hand, an outline effect fills shapes instead of text, and bends them
  const square = (x) => ({ adv: 0.6, c: [[x, 0, x + 0.5, 0, x + 0.5, -0.7, x, -0.7]] });
  const pts = [];
  const ctx = new Proxy({ font: "900 100px X", lineWidth: 1, globalAlpha: 1 }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: [...s].length * 60 }) : (...a) => { if (k === "lineTo" || k === "moveTo") pts.push(a); return {}; }), set: (t, k, v) => { t[k] = v; return true; } });
  const { native } = await import("../ui/js/store.js");
  assert.equal(native, false);
  primeOutline("900 100px X", "Ab", [square(0), square(0)]); primeOutline("900 100px X", "cd", [square(0), square(0)]);
  void ctx; void pts;                                                           // (drawing them needs the native side; covered by the app's self-test)
  // an unknown effect is the automatic one, and so is a lettering the menu no longer offers
  for (const id of ["no-such-effect", ...retired]) {
    const [n1, c1] = recorder(), [n2, c2] = recorder();
    paintRuns(c1, pass(c1), { ...o }, id); paintRuns(c2, pass(c2), { ...o }, "auto");
    assert.deepEqual(n1, n2, id);
  }
  setLook("cel");
  // a text layer that chose one of those letterings takes its look's post effect; the title keeps the name;
  // the underline, a look effect for a day, is the menu's again
  const [tl, tx, tx2, tx3] = normalizeLayers([{ type: "title", fx: "cyber" }, { type: "text", id: "a", text: "x", fx: "riso", fxAmt: 1.4 }, { type: "text", id: "b", text: "y", fx: "vivid", lookFx: { "netart.selected": 0.5 } }, { type: "text", id: "c", text: "z", lookFx: { "editorial.underline": 0.4, "riso.dots": 0.5 } }]).filter((l) => l.type === "title" || l.type === "text");
  assert.equal(tl.fx, "cyber");
  assert.deepEqual([tx.fx, tx.fxAmt, tx.lookFx], [undefined, undefined, { "riso.overprint": 0.6 }]);
  assert.deepEqual([tx2.fx, tx2.lookFx], [undefined, { "netart.selected": 0.5, "vivid.block": 0.6 }]);   // post effects go together
  assert.deepEqual([tx3.fx, tx3.lookFx], ["editorial", { "riso.dots": 0.5 }]);
});

test("the ransom note: each letter dressed its own way, the same wherever the line is drawn", async () => {
  const { ransomPlan, papersFor, contrast } = await import("../ui/js/ransom.js");
  const { letterFor } = await import("../ui/js/deal.js");
  const face = (family) => ({ family, weight: 700, often: 1, italic: false });
  const pools = { latin: ["A", "B", "C", "D"].map(face), cjk: ["甲", "乙", "丙"].map(face) };
  const C = [214, 40, 57], papers = papersFor({ C, hiCss: "#fcee0a" });
  const cells = (text, hi = () => false) => [...text].map((ch, i) => ({ ch, hi: hi(i) }));
  const plan = (text, more = {}) => ransomPlan(cells(text, more.hi), pools, { salt: "title:7", row: 1, papers, C, ...more });
  // the channel colour and the highlight's among the papers, none two alike
  assert.ok(papers.some((p) => p.rgb.join() === C.join()) && papers.some((p) => p.css === "#fcee0a"));
  assert.ok(papers.every((p, i) => papers.every((q, j) => i === j || Math.hypot(p.rgb[0] - q.rgb[0], p.rgb[1] - q.rgb[1], p.rgb[2] - q.rgb[2]) >= 30)));
  assert.equal(papersFor({ C: [252, 191, 0] }).filter((p) => p.rgb[2] < 100 && p.rgb[0] > 200).length, 1, "one yellow, the channel's");
  assert.equal(papersFor({ C: [255, 255, 255] }).filter((p) => p.light && p.rgb.every((v) => v > 240)).length, 1, "a white channel colour is the white paper");
  const text = "SPIDER MAN, peter parker! 你看着办就这么定";
  const p = plan(text);
  assert.deepEqual(plan(text), p, "the same letters, the same dress");
  [...text].forEach((ch, i) => { if (!/[\p{L}\p{N}]/u.test(ch)) assert.equal(p[i], null, `${JSON.stringify(ch)} is set as the line sets it`); });
  // neighbours never share a face nor a paper; ink reads on its paper; Chinese faces for Chinese
  const dressed = p.map((d, i) => d && { ...d, i }).filter(Boolean);
  for (let k = 1; k < dressed.length; k++) {
    const a = dressed[k - 1], b = dressed[k];
    assert.notEqual(a.face.family, b.face.family, `${text[a.i]}${text[b.i]}: one face`);
    if (["tile", "cut", "deep"].includes(a.kind) && ["tile", "cut", "deep"].includes(b.kind)) assert.notEqual(a.paper, b.paper, `${text[a.i]}${text[b.i]}: one paper`);
  }
  for (const d of dressed) {
    assert.ok(/[\p{Script=Han}]/u.test(text[d.i]) === pools.cjk.includes(d.face), text[d.i]);
    if (d.kind === "tile") assert.ok(contrast(d.paper.rgb, [0, 2, 4].map((k) => parseInt(d.ink.slice(1 + k, 3 + k), 16))) >= 4.5, `${text[d.i]} reads on its paper`);
    if (d.kind === "cut") assert.ok(d.paper.light, "a hollow letter on a light paper");
    assert.ok(d.kind !== "photo", "no photo letters without a photo");
    if (d.ch !== text[d.i]) assert.ok(/[a-z]/i.test(text[d.i]) && d.ch.toLowerCase() === text[d.i].toLowerCase(), "only Latin letters change case");
    assert.ok(Math.abs(d.turn) <= 9 && Math.abs(d.lift) <= 0.06);
  }
  assert.ok(dressed.some((d) => d.ch !== text[d.i]), "some letters change case");
  assert.ok(new Set(dressed.map((d) => d.face.family)).size >= 5 && new Set(dressed.map((d) => d.kind)).size >= 3);
  // one hero a line, on the channel colour, among the highlighted letters when there are some
  assert.equal(dressed.filter((d) => d.hero).length, 1);
  const marked = plan("SPIDER MAN", { hi: (i) => i >= 7 }), hero = marked.findIndex((d) => d && d.hero);
  assert.ok(hero >= 7 && marked[hero].kind === "tile", "the hero in the highlighted word");
  assert.equal(plan("AB").filter((d) => d && d.hero).length, 0, "no hero for two letters");
  // standing still: no turn, no shift, every letter in its case
  assert.ok(plan(text, { amt: 0 }).every((d, i) => !d || (d.turn === 0 && d.lift === 0 && d.ch === text[i])));
  // a face without the letter gives way; another seed, other dress; a letter typed leaves those before it be
  const without = plan(text, { has: (f, ch) => !(f.family === "A" && /[sS]/.test(ch)) });
  assert.ok(without.every((d, i) => !d || !/[sS]/.test(text[i]) || d.face.family !== "A"));
  assert.notDeepEqual(ransomPlan(cells(text), pools, { salt: "title:8", row: 1, papers, C }), p);
  const typed = plan("SPIDER MANX"), before = plan("SPIDER MAN");
  assert.deepEqual(typed.slice(0, 10).map((d) => d && !d.hero && d), before.map((d, i) => d && !d.hero && !typed[i].hero && d), "the letters before stay as they were");
  // two weights of one family are still one face to a neighbour
  const weights = { latin: [face("A"), { ...face("A"), weight: 300 }, face("B"), { ...face("B"), weight: 300 }, face("C")], cjk: [face("甲"), { ...face("甲"), weight: 300 }, face("乙")] };
  for (const salt of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    const w = ransomPlan(cells(text), weights, { salt, row: 2, papers, C }).filter(Boolean);
    for (let k = 1; k < w.length; k++) assert.notEqual(w[k - 1].face.family, w[k].face.family, `${salt}: neighbours in one family`);
  }
  // painted: every scrap and every letter, the canvas as it was; a piece in another script whole, as the line sets it
  const { ransom } = await import("../ui/js/ransom.js");
  const calls = [], rec = new Proxy({ font: "900 100px X", lineWidth: 1 }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (str) => ({ width: [...str].length * 60 }) : (...args) => { calls.push([k, ...args]); return {}; }), set: (t, k, v) => { t[k] = v; return true; } });
  ransom(rec, (fn) => { fn({ t: "Ab", hi: false, w: 120 }, 0); fn({ t: "مرحبا", hi: false, w: 300 }, 130); fn({ t: "cd", hi: true, w: 120 }, 440); }, { fs: 100, d: 6, strokeAmt: 1, amt: 1, row: 0, ransom: { id: "t", salt: "t:0", off: ["tape"] }, C: [252, 238, 10], fillCss: "#ffffff", hiCss: "#fcee0a", inkCss: "#07070c", shadowCss: "#fcee0a", hiShadowCss: "#ffffff" });
  const n = (k) => calls.filter((c) => c[0] === k).length, texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.equal(n("save"), n("restore"));
  for (const ch of "Abcd") assert.ok(texts.some((t) => t.toLowerCase() === ch.toLowerCase()), `${ch} painted`);
  assert.ok(texts.includes("مرحبا") && !texts.includes("م"), "Arabic set whole");
  const lastFill = calls.map((c) => c[0]).lastIndexOf("fill"), firstText = calls.findIndex((c) => c[0] === "fillText" && /^[abcd]$/i.test(c[1]));
  assert.ok(lastFill < 0 || lastFill < firstText, "every scrap before any letter");
  calls.length = 0;
  ransom(rec, (fn) => { fn({ t: "SPIDER مرحبا بك ok", hi: false, w: 900 }, 0); fn({ t: "你看スーパー", hi: true, w: 360 }, 900); }, { fs: 100, d: 0, strokeAmt: 0, amt: 1, row: 0, ransom: { id: "t", salt: "t:0" }, C: [252, 238, 10], fillCss: "#ffffff", hiCss: "#fcee0a", inkCss: "#07070c", shadowCss: "#fcee0a", hiShadowCss: "#ffffff" });
  const set = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
  assert.ok(set.includes("مرحبا بك") && ["S", "P", "O", "K", "你", "看", "ス", "パ"].every((ch) => set.some((t) => t.toUpperCase() === ch)), "only the stretch of Arabic whole: " + set.join(" "));
  // dressed by hand: what was set wins, the ink then reads on the paper chosen; a hero chosen is the only one
  const { letterKey } = await import("../ui/js/ransom.js");
  const S1 = letterKey(1, "S", 1), P1 = letterKey(1, "P", 1), D1 = letterKey(1, "D", 1);
  const byHand = plan(text, { edits: { [S1]: { face: { family: "C", weight: 300 }, kind: "tile", paper: "#123456", turn: -30, size: 1.4, case: "lower" }, [P1]: { hero: true } } });
  assert.deepEqual([byHand[0].face.family, byHand[0].face.weight, byHand[0].kind, byHand[0].paper.css, byHand[0].turn, byHand[0].size, byHand[0].ch, byHand[0].edited], ["C", 300, "tile", "#123456", -30, 1.4, "s", true]);
  assert.ok(contrast([0x12, 0x34, 0x56], [0, 2, 4].map((k) => parseInt(byHand[0].ink.slice(1 + k, 3 + k), 16))) >= 4.5, "the ink reads on the paper chosen");
  assert.deepEqual(byHand.filter((d) => d && d.hero).map((d) => d.key), [P1]);
  assert.equal(byHand[1].size, 1.2);
  // locked: Reshuffle deals the others anew, not it; dealt again on its own: it alone changes
  const keep = (salt, edits) => ransomPlan(cells(text), pools, { salt, row: 1, papers, C, edits });
  // locked as the editor locks it (the seed of now, and what its neighbours decided): nothing changes then, nor when Reshuffle deals the rest
  const bare = (d) => d && { ...d, locked: false, edited: false }, at = [...text].indexOf("D"), open = keep("title:7", null), o7 = open[at];
  const lockD = { [D1]: { lock: { seed: 7, face: { family: o7.face.family, weight: o7.face.weight }, paper: o7.paper.css, ink: o7.ink, hero: o7.hero } } };
  const was = keep("title:7", lockD), now = keep("title:8", lockD);
  assert.deepEqual(was.map(bare), open.map(bare), "locking changes nothing");
  assert.deepEqual(bare(now[at]), bare(was[at]), "a locked letter keeps its dress");
  assert.ok(now[at].locked && !was.some((d, i) => d && i !== at && d.locked));
  for (let k = 0; k < 40; k++) {   // a locked hero too, whatever falls before it
    const line = cells("SPIDER MAN"), o = ransomPlan(line, pools, { salt: `x:${k}`, row: 0, papers, C }), h = o.findIndex((d) => d && d.hero), d = o[h];
    const lk = { [d.key]: { lock: { seed: k, face: { family: d.face.family, weight: d.face.weight }, paper: d.paper.css, ink: d.ink, hero: true } } };
    assert.deepEqual(bare(ransomPlan(line, pools, { salt: `x:${k + 100}`, row: 0, papers, C, edits: lk })[h]), bare(d), `locked hero ${k}`);
  }
  // the letter before a locked one keeps clear of it, whatever Reshuffle deals it
  for (let k = 0; k < 60; k++) {
    const line = cells("SPIDERMAN"), o = ransomPlan(line, pools, { salt: `y:${k}`, row: 0, papers, C }), d = o[4];
    const lk = { [d.key]: { lock: { seed: k, face: { family: d.face.family, weight: d.face.weight }, paper: d.paper.css, ink: d.ink, hero: d.hero } } };
    const n = ransomPlan(line, pools, { salt: `y:${k + 500}`, row: 0, papers, C, edits: lk }), b = n[3];
    assert.notEqual(b.face.family, n[4].face.family, `${k}: the face of the locked letter after it`);
    if (["tile", "cut", "deep"].includes(b.kind) && ["tile", "cut", "deep"].includes(n[4].kind)) assert.notEqual(b.paper.css, n[4].paper.css, `${k}: its paper`);
  }
  // one value set by hand changes nothing else of the letter, and of the next letter only its face and paper
  const fixed = ["kind", "turn", "lift", "size", "corners", "ch", "edge", "tape", "tear", "hero"], pick = (d, ks) => d && Object.fromEntries(ks.map((k) => [k, d[k]]));
  for (const [i, patch] of [[0, { face: { family: "B", weight: 700 } }], [2, { paper: "#151515" }], [4, { hero: false }], [3, { kind: "deep" }]]) {
    const k0 = letterKey(1, text[i], 1), base = plan(text), got = plan(text, { edits: { [k0]: patch } });
    const same = Object.keys(patch).includes("hero") ? ["corners", "ch", "edge", "tape", "tear", "lift"] : fixed.filter((f) => !Object.keys(patch).includes(f));
    assert.deepEqual(pick(got[i], same), pick(base[i], same), `${text[i]} ${JSON.stringify(patch)}: the letter's other values`);
    assert.deepEqual(pick(got[i + 1], fixed), pick(base[i + 1], fixed), `${text[i]} ${JSON.stringify(patch)}: the next letter`);
    if (patch.paper && ["tile", "cut", "deep"].includes(got[i + 1].kind)) assert.notEqual(got[i + 1].paper.css, "#151515", "the next letter keeps clear of a paper set by hand");
  }
  assert.notDeepEqual(now.slice(0, at).map(bare), was.slice(0, at).map(bare), "the others are dealt anew");
  const again = keep("title:7", { [D1]: { salt: 5 } });
  assert.notDeepEqual(bare(again[at]), bare(open[at]), "the letter dealt again changes");
  assert.deepEqual(again.slice(0, at).map(bare), open.slice(0, at).map(bare), "and the letters before it do not");
  // the extras: none of those turned off come by chance; letters from the photo only when there is one
  const long = "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG 天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏";
  const lots = (more) => ["a", "b", "c", "d", "e", "f"].flatMap((salt) => ransomPlan(cells(long), pools, { salt, row: 0, papers, C, ...more }).filter(Boolean));
  const all = lots({ photo: true });
  for (const k of ["deep", "photo"]) assert.ok(all.some((d) => d.kind === k), k);
  assert.ok(all.some((d) => d.edge === "torn") && all.some((d) => d.tape === 1) && all.some((d) => d.tape === 2));
  const none = lots({ photo: true, off: ["torn", "tape", "deep", "photo"] });
  assert.ok(none.every((d) => !["deep", "photo"].includes(d.kind) && d.edge === "cut" && d.tape === 0), "turned off");
  assert.ok(ransomPlan(cells("AB"), pools, { edits: { [letterKey(0, "A", 1)]: { kind: "photo" } } })[0].kind !== "photo", "no photo letter by hand without a photo");
  // painted with every kind, torn edges and tape: the canvas as it was
  calls.length = 0;
  const every = Object.fromEntries(["tile", "bare", "cut", "deep", "photo"].map((k, i) => [letterKey(0, "ABCDE"[i], 1), { kind: k, edge: "torn", tape: 1 + (i % 2) }]));
  ransom(rec, (fn) => fn({ t: "ABCDE", hi: false, w: 500 }, 0), { fs: 100, d: 6, strokeAmt: 1, amt: 1, row: 0, ransom: { id: "t", salt: "t:0", edits: every, photo: null }, C: [252, 238, 10], fillCss: "#ffffff", hiCss: "#fcee0a", inkCss: "#07070c", shadowCss: "#fcee0a", hiShadowCss: "#ffffff" });
  assert.equal(n("save"), n("restore"));
  for (const ch of "ABCDE") assert.ok(calls.some((c) => c[0] === "fillText" && c[1].toUpperCase() === ch), `${ch} painted`);
  // Surprise me deals its letters with it; a layer keeps them, and only for it
  let seed = 3;
  const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const { oddsOf } = await import("../ui/js/deal.js"), odds = oddsOf({ groups: { letters: { ransom: 1 } } });
  const got = Array.from({ length: 400 }, () => letterFor("collage", "title", R, () => true, null, { odds })).filter((x) => x.fx === "ransom");
  assert.ok(got.length === 400 && got.every((x) => Number.isInteger(x.fxSeed) && x.fxSeed > 0 && x.fxAmt > 0), "the ransom note dealt, with letters of its own");
  const [a, b] = normalizeLayers([{ type: "title", fx: "ransom", fxSeed: 42 }, { type: "text", id: "t", text: "x", fx: "plain", fxSeed: 42 }]).filter((l) => l.type === "title" || l.type === "text");
  assert.deepEqual([a.fx, a.fxSeed, b.fxSeed], ["ransom", 42, 42], "kept under another effect too, for when the ransom note comes back");
  assert.equal(normalizeLayers([{ type: "title", fx: "ransom", fxSeed: 1.5 }]).find((l) => l.type === "title").fxSeed, undefined);
  // and the letters dressed by hand, the extras turned off: only what is valid (whatever the effect)
  const [kept, other] = normalizeLayers([
    { type: "title", fx: "ransom", ransomOff: ["tape", "nope", "photo"], letters: { "0|S|1": { kind: "deep", paper: "#FF0000", turn: 99, lock: { seed: 3, paper: "#ABCDEF", hero: false, face: { family: '""' } }, face: { family: 'Geo"rgia', weight: 750 }, junk: 1 }, "bad key": { kind: "tile" }, "1|你|2": { size: 3, hero: true, tape: 5 }, "2|a|1": { kind: "nope" }, "3|b|1": { lock: 4 } } },
    { type: "text", id: "t2", text: "x", fx: "plain", letters: { "0|x|1": { kind: "tile" } }, ransomOff: ["tape"] },
  ]).filter((l) => l.type === "title" || l.type === "text");
  assert.deepEqual(kept.letters, { "0|S|1": { face: { family: "Georgia", weight: 750 }, kind: "deep", paper: "#ff0000", turn: 45, lock: { seed: 3, paper: "#abcdef", hero: false } }, "1|你|2": { size: 1.6, hero: true } });
  assert.deepEqual(kept.ransomOff, ["tape", "photo"]);
  assert.deepEqual([other.letters, other.ransomOff], [{ "0|x|1": { kind: "tile" } }, ["tape"]]);
  const many = Object.fromEntries([...Array.from({ length: 400 }, (_, i) => [`bad${i}`, { kind: "tile" }]), ["0|q|1", { kind: "cut" }]]);
  assert.deepEqual(normalizeLayers([{ type: "title", letters: many }]).find((l) => l.type === "title").letters, { "0|q|1": { kind: "cut" } }, "the invalid do not use up the room");
});

test("text layers are headlines like the title; older layers carried over", () => {
  const one = (raw) => normalizeLayers([{ type: "text", text: "x", ...raw }]).find((l) => l.type === "text");
  const fresh = newLayer("text", { text: "x" }), title = newLayer("title");
  assert.deepEqual([fresh.plate, fresh.stroke, fresh.shadow, fresh.fx, "color" in fresh, "look" in fresh], [false, 1, 1, undefined, false, false]);
  assert.deepEqual([title.plate, title.stroke, title.shadow], [false, 1, 1]);
  // both take the same colours: lettering, highlighted words, plate
  for (const type of ["title", "text"]) {
    const L = normalizeLayers([{ type, text: "x", ink: "#112233", hi: "#445566", plateInk: "#778899", plate: true, stroke: 0.5, shadow: 2 }]).find((l) => l.type === type);
    assert.deepEqual([L.ink, L.hi, L.plateInk, L.plate, L.stroke, L.shadow], ["#112233", "#445566", "#778899", true, 0.5, 2], type);
  }
  // the three old looks: a headline follows the look as before; plain text and plates keep plain lettering
  assert.deepEqual([one({ look: "title" }).plate, one({ look: "title" }).fx], [false, undefined]);
  assert.deepEqual([one({ look: "plain" }).plate, one({ look: "plain" }).fx], [false, "plain"]);
  assert.deepEqual([one({ look: "plate" }).plate, one({ look: "plate" }).fx], [true, "plain"]);
  assert.equal(one({ look: "plate", fx: "dots" }).fx, "dots");                 // an effect already chosen stays
  assert.equal("look" in one({ look: "plate" }), false);
  // a plate of before had no outline or shadow
  assert.deepEqual([one({ plate: true }).stroke, one({ plate: true }).shadow, one({}).stroke], [0, 0, 1]);
  // the one colour of before: white is automatic, ink and custom are the lettering's own colour, the channel colour stays as such
  const col = (raw) => { const L = one(raw); return [L.ink, L.plateInk, L.color]; };
  assert.deepEqual(col({ color: "white" }), [undefined, undefined, undefined]);
  assert.deepEqual(col({ color: "ink" }), ["#07070c", undefined, undefined]);
  assert.deepEqual(col({ color: "custom", ink: "#112233" }), ["#112233", undefined, undefined]);
  assert.deepEqual(col({ color: "accent", ink: "#112233" }), ["#112233", undefined, undefined]);   // a custom colour beside a named one won
  assert.deepEqual(col({ color: "custom" }), [undefined, undefined, undefined]);
  assert.deepEqual(col({ color: "accent" }), [undefined, undefined, "accent"]);
  assert.deepEqual(col({ color: "purple" }), [undefined, undefined, undefined]);
  // …on a plate it was the plate's colour
  assert.deepEqual(col({ plate: true, color: "white" }), [undefined, "#ffffff", undefined]);
  assert.deepEqual(col({ plate: true, color: "accent" }), [undefined, undefined, undefined]);
  assert.deepEqual(col({ plate: true, color: "custom", ink: "#445566" }), [undefined, "#445566", undefined]);
  // settled: normalising again changes nothing
  for (const raw of [{ look: "plate", color: "accent", ink: "#112233" }, { plate: true, color: "custom", ink: "#445566", fx: "wave", fxAmt: 0.5 }, { color: "accent" }, { color: "ink" }, {}]) { const L = one(raw); assert.deepEqual(one(L), L); }
});

test("vertical titles: columns from the right, sideways Latin, sized to fit", async () => {
  const { drawTitleVertical } = await import("../ui/js/title.js");
  const made = () => { const calls = []; let depth = 0, turned = false; const ctx = new Proxy({ font: "" }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: [...s].length * 55 }) : (...a) => { if (k === "save") depth++; if (k === "restore") { depth--; if (depth === 1) turned = false; } if (k === "rotate") turned = true; if (k === "fillText") calls.push({ t: a[0], x: a[1], y: a[2], turned, fill: t.fillStyle }); return {}; }), set: (t, k, v) => { t[k] = v; return true; } }); return [ctx, calls]; };
  const box = { x: 100, y: 200, w: 900, h: 600 }, st = { font: "serif", fill: "ink", hi: "red", maxFs: 300 };
  const [ctx, calls] = made();
  const r = drawTitleVertical(ctx, "霓虹城市\n*夜跑* VLOG", box, st);
  const first = calls.filter((c) => "霓虹城市".includes(c.t)), second = calls.filter((c) => "夜跑".includes(c.t));
  assert.equal(first.length, 4); assert.equal(second.length, 2);
  assert.ok(first.every((c) => c.x === first[0].x) && second.every((c) => c.x === second[0].x));   // each line is one column
  assert.ok(second[0].x < first[0].x);                                                          // the first column is on the right
  assert.deepEqual(first.map((c) => c.y).slice().sort((a, b) => a - b), first.map((c) => c.y));  // and reads downward
  assert.ok(first.every((c) => c.fill === "ink" && !c.turned) && second.every((c) => c.fill === "red"));
  const latin = calls.find((c) => c.t === "VLOG");
  assert.ok(latin && latin.turned);                                                             // a Latin run lies on its side, as one piece
  assert.ok(r.x === box.x && r.y === box.y && r.w <= box.w + 1 && r.h <= box.h + 1, JSON.stringify(r));
  // a long column is made to fit the height; many columns, the width
  const tall = drawTitleVertical(made()[0], "一二三四五六七八九十一二三四五六七八九十", box, st), wide = drawTitleVertical(made()[0], Array(12).fill("字").join("\n"), box, st);
  assert.ok(tall.h <= box.h + 1 && wide.w <= box.w + 1);
  assert.equal(drawTitleVertical(made()[0], "  ", box, st), null);
  // the woodblock look sets its title this way unless told otherwise
  setLook("songke"); assert.equal(lookValues().vertical, 1);
  const env = (tag) => ({ h: 1080, cover: { tag }, G: LOOKS.songke.layout("stack", 1920, 1080) });
  const [c2, k2] = made(); const set = LOOKS.songke.titleSet(c2, "夜跑", box, {}, env(""), lookValues());
  assert.ok(set && k2.length === 2);
  assert.ok(set.h > 0 && set.y + set.h <= env("").G.accent[0][1], "the columns stop above the band");
  const [c3, k3] = made(); LOOKS.songke.titleSet(c3, "夜跑", box, {}, env("EP.07"), lookValues());
  assert.ok(k3[0].x > k2[0].x, "with a seal in the corner, the title stands clear of it");
  assert.equal(LOOKS.songke.titleSet(made()[0], "夜跑", box, {}, env(""), { ...lookValues(), vertical: 0 }), null);
  // the whole page in the serif, and the shared font table put back afterwards
  const { fonts } = await import("../ui/js/cel.js");
  assert.deepEqual(LOOKS.songke.faces(fonts), { cn: fonts.serif, en: fonts.serif });
  setLook("cel");

});

test("fonts belong to lettering layers; what older profiles chose is carried onto them", async () => {
  const { carryFonts } = await import("../ui/js/store.js");
  const ls = normalizeLayers([{ type: "title", font: '  Kaiti SC  ' }, { type: "tag", font: 'Bad"; } <x>' }, { type: "accent", font: "X" }, { type: "text", text: "a", font: "" }, { type: "text", text: "b", font: "Bebas Neue" }]);
  const by = (t) => ls.filter((l) => l.type === t);
  assert.equal(by("title")[0].font, "Kaiti SC");
  assert.equal(by("tag")[0].font, "Bad  x");                              // nothing that could break out of a font string
  assert.equal(by("accent")[0].font, undefined);                           // not lettering
  assert.deepEqual(by("text").map((l) => l.font), [undefined, "Bebas Neue"]);
  assert.equal(duplicate(by("text")[1]).font, "Bebas Neue");
  assert.equal(newLayer("text").font, undefined);                          // a new layer starts in the bundled face
  // an older profile: its fonts go to the layers that have none, and are then gone from the profile
  const old = normalizeProfile({ fonts: { body: "A Body", display: "A Display", serif: "A Serif" }, design: { layers: [{ type: "title" }, { type: "tag", font: "Own" }, { type: "text", text: "t" }] } });
  const d = (t) => old.design.layers.find((l) => l.type === t).font;
  assert.deepEqual([d("title"), d("catname"), d("text"), d("tag"), d("brand"), d("accent")], ["A Body", "A Body", "A Body", "Own", "A Display", undefined]);
  assert.equal("fonts" in old, false); assert.deepEqual(old.oldFonts, { body: "A Body", display: "A Display", serif: "A Serif" });
  // the serif went to the title only where a serif look was in use
  assert.equal(normalizeProfile({ style: { look: "songke" }, fonts: { body: "A Body", serif: "A Serif" } }).design.layers.find((l) => l.type === "title").font, "A Serif");
  assert.equal(normalizeProfile({ style: { look: "songke" }, fonts: { serif: "A Serif" } }).design.layers.find((l) => l.type === "catname").font, undefined);
  // a profile with nothing chosen carries nothing
  const plain = normalizeProfile({ fonts: { body: "", display: "" } });
  assert.equal("oldFonts" in plain, false); assert.ok(plain.design.layers.every((l) => !l.font));
  // the open cover gets the same treatment, once
  const cover = normalizeCover({ layers: [{ type: "title" }, { type: "text", text: "x", font: "Mine" }] }, old);
  carryFonts(cover.layers, old.oldFonts, "cel");
  assert.equal(cover.layers.find((l) => l.type === "title").font, "A Body"); assert.equal(cover.layers.find((l) => l.type === "text").font, "Mine");
  assert.equal(carryFonts([{ type: "title" }], null, "cel")[0].font, undefined);
});

test("ai: a reference picture travels in the form each API style wants", async () => {
  const { withImage, buildPrompt: bp, buildRequest: br, normalizeAi: na } = await import("../ui/js/ai.js");
  const image = { mime: "image/jpeg", data: "QUJD" };
  const withPic = bp("just the cat", "", { kind: "flat", image: true }), noWords = bp("", "", { kind: "solid", image: true });
  assert.ok(withPic.user.includes('wanted: "just the cat"') && withPic.user.includes("flat sticker") && withPic.user.includes("Find the subject"));
  assert.ok(noWords.user.includes("Decide what the picture is of") && noWords.user.includes("boxes and cylinders") && noWords.user.includes("not the scene"));
  assert.equal(bp("a cat").user, "Request: a cat");                                   // without a picture, as before
  assert.equal(withPic.system, bp("just the cat").system);                             // the style prompt is the same either way
  const o = br(na({ style: "openai", baseUrl: "https://a/v1", model: "m" }), "SYS", [{ role: "user", content: withImage("openai", "T", image) }]);
  assert.deepEqual(o.body.messages[1].content, [{ type: "text", text: "T" }, { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } }]);
  const a = br(na({ style: "anthropic", baseUrl: "https://a", model: "m" }), "SYS", [{ role: "user", content: withImage("anthropic", "T", image) }]);
  assert.deepEqual(a.body.messages[0].content, [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }, { type: "text", text: "T" }]);
  assert.equal(a.body.system, "SYS");
});

test("a selection rectangle takes every layer whose turned box lies wholly inside it", async () => {
  const { hitsIn } = await import("../ui/js/render.js");
  const hits = [
    { id: "bg", type: "bg", cx: 400, cy: 225, hw: 400, hh: 225, r: 0 },
    { id: "a", type: "asset", cx: 100, cy: 100, hw: 20, hh: 20, r: 0 },
    { id: "b", type: "asset", cx: 300, cy: 100, hw: 50, hh: 5, r: 90 },   // turned upright: reaches y 50…150
    { id: "c", type: "text", cx: 600, cy: 400, hw: 30, hh: 10, r: 0 },
  ];
  const ids = (m) => hitsIn(hits, m, (h) => h.type !== "bg").map((h) => h.id);
  assert.deepEqual(ids({ x0: 70, y0: 40, x1: 310, y1: 160 }), ["a", "b"]);  // drawn either way round
  assert.deepEqual(ids({ x1: 70, y1: 40, x0: 310, y0: 160 }), ["a", "b"]);
  assert.deepEqual(ids({ x0: 70, y0: 40, x1: 310, y1: 140 }), ["a"]);        // b turned upright reaches y 150: only partly inside
  assert.deepEqual(ids({ x0: 90, y0: 90, x1: 110, y1: 110 }), []);           // inside a, not round it
  assert.deepEqual(ids({ x0: 0, y0: 0, x1: 800, y1: 450 }), ["a", "b", "c"]);
});

test("the title's outline and shadow are offered only where the text effect draws them", async () => {
  const { effectUses } = await import("../ui/js/textfx.js");
  try {
    setLook("cel");
    assert.deepEqual(effectUses(), { id: "cel", stroke: true, shadow: true });
    assert.deepEqual(effectUses("bluenote"), { id: "bluenote", stroke: false, shadow: false });
    assert.deepEqual(effectUses("riso"), { id: "cel", stroke: true, shadow: true });          // no longer in the menu: automatic
    assert.equal(effectUses("worn").stroke, true);                            // mask effects keep the house keyline
    setLook("editorial");
    assert.deepEqual(effectUses("auto"), { id: "editorial", stroke: false, shadow: false });
    assert.equal(effectUses("cel").stroke, true);
    setLook("songke");
    assert.equal(effectUses().shadow, false);
    for (const id of LOOK_IDS) assert.ok(LOOKS[id].about && LOOKS[id].about.zh && LOOKS[id].about.en, id);   // every look says what it is
  } finally { setLook("cel"); }
});

test("repaint: each image service gets the photo in its own form, and its reply is read", async () => {
  const R = await import("../ui/js/repaint.js");
  const pic = { mime: "image/jpeg", data: "QUJD" };
  const cfg = (provider, extra = {}) => R.normalizeImageAi({ provider, token: "k", model: "m", ...extra });
  // addresses: the service's own when empty; a full path is taken as it is
  assert.equal(R.imageEndpoint(cfg("openai")), "https://api.openai.com/v1/images/edits");
  assert.equal(R.imageEndpoint(cfg("openai", { baseUrl: "https://relay.example/v1/" })), "https://relay.example/v1/images/edits");
  assert.equal(R.imageEndpoint(cfg("gemini", { model: "gemini-x-image" })), "https://generativelanguage.googleapis.com/v1beta/models/gemini-x-image:generateContent");
  assert.equal(R.imageEndpoint(cfg("seedream", { baseUrl: "https://ark.ap-southeast.bytepluses.com/api/v3" })), "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations");
  assert.ok(R.imageReady(cfg("openai")) && !R.imageReady(cfg("openai", { token: "" })) && !R.imageReady(cfg("gemini", { baseUrl: "ftp://x" })));
  // request bodies
  const o = R.buildImageRequest(cfg("openai", { model: "gpt-image-2" }), "P", pic, 1600, 900);
  assert.deepEqual(o.body.images, [{ image_url: "data:image/jpeg;base64,QUJD" }]);
  assert.equal(o.headers.authorization, "Bearer k");
  const [W, H] = o.body.size.split("x").map(Number);
  assert.ok(W % 16 === 0 && H % 16 === 0 && Math.abs(W / H - 16 / 9) < 0.02 && W <= 3840, o.body.size);   // the photo's shape
  assert.equal(R.buildImageRequest(cfg("openai", { model: "gpt-image-1" }), "P", pic, 1600, 900).body.size, "1536x1024");   // older models: standard sizes only
  const g = R.buildImageRequest(cfg("gemini"), "P", pic, 1600, 900);
  assert.equal(g.headers["x-goog-api-key"], "k");
  assert.deepEqual(g.body.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: "QUJD" } });
  const s = R.buildImageRequest(cfg("seedream"), "P", pic, 900, 1600);
  assert.equal(s.body.image, "data:image/jpeg;base64,QUJD");
  assert.equal(s.body.response_format, "b64_json");
  const [sw, sh] = s.body.size.split("x").map(Number);
  assert.ok(sw * sh >= 2560 * 1440 && sw * sh <= 4624220 && sw < sh, s.body.size);   // inside every Seedream model's range
  assert.equal(g.body.generationConfig.imageConfig, undefined);   // a repaint keeps the photo's shape by itself
  // a new picture: without a photo each service is asked to make one, in the shape wanted
  const o2 = R.buildImageRequest(cfg("openai", { baseUrl: "https://relay.example/v1/images/edits" }), "P", null, 1280, 720);
  assert.equal(o2.url, "https://relay.example/v1/images/generations");
  assert.ok(!("images" in o2.body) && o2.body.prompt === "P" && /^\d+x\d+$/.test(o2.body.size));
  const g2 = R.buildImageRequest(cfg("gemini"), "P", null, 1280, 720);
  assert.deepEqual(g2.body.contents[0].parts, [{ text: "P" }]);
  assert.equal(g2.body.generationConfig.imageConfig.aspectRatio, "16:9");
  assert.equal(R.buildImageRequest(cfg("gemini"), "P", pic, 1080, 1920, { shape: true }).body.generationConfig.imageConfig.aspectRatio, "9:16");   // a reference, and the canvas's shape
  const s2 = R.buildImageRequest(cfg("seedream"), "P", null, 1280, 720);
  assert.ok(!("image" in s2.body) && s2.url.endsWith("/images/generations"));
  assert.deepEqual(["1:1", "4:5", "21:9", "3:4"].map((r) => R.geminiRatio(...r.split(":").map(Number))), ["1:1", "4:5", "21:9", "3:4"]);
  assert.deepEqual([R.geminiRatio(1000, 1480), R.geminiRatio(1000, 1380)], ["2:3", "3:4"]);
  assert.match(R.generatePrompt({ text: "a lighthouse" }), /^Make a picture: a lighthouse\n\n.*no text/s);
  assert.match(R.generatePrompt({ reference: true }), /attached reference image, keeping its subject/);
  assert.match(R.generatePrompt({ text: "in winter", reference: true }), /attached reference image: in winter/);
  // replies
  assert.deepEqual(R.readImageReply("openai", 200, '{"data":[{"b64_json":"iVBORw0K"}]}'), { image: { mime: "image/png", data: "iVBORw0K" } });
  assert.deepEqual(R.readImageReply("seedream", 200, '{"data":[{"url":"https://x/y.png"}]}'), { url: "https://x/y.png" });
  assert.deepEqual(R.readImageReply("gemini", 200, '{"candidates":[{"content":{"parts":[{"text":"hi"},{"inlineData":{"mimeType":"image/jpeg","data":"/9j/"}}]}}]}'), { image: { mime: "image/jpeg", data: "/9j/" } });
  assert.match(R.readImageReply("gemini", 200, '{"candidates":[{"finishReason":"SAFETY","content":{"parts":[{"text":"cannot"}]}}]}').error, /SAFETY.*cannot/);
  assert.match(R.readImageReply("openai", 400, '{"error":{"message":"bad size"}}').error, /^HTTP 400: bad size/);
  assert.match(R.readImageReply("seedream", 502, "<html>gateway</html>").error, /^HTTP 502/);
});

test("repaint: the prompt follows the look, a preset or the user's own words, and always asks for a clean background", async () => {
  const { repaintPrompt } = await import("../ui/js/repaint.js");
  const look = repaintPrompt({ source: "look", look: "riso", color: "#ff3355", notes: "darker sky" });
  assert.ok(look.includes("risograph") && look.includes("#ff3355") && look.includes("Keep the photograph's composition") && look.endsWith("Also: darker sky"));
  for (const id of LOOK_IDS) assert.ok(repaintPrompt({ source: "look", look: id }).length > 200, id);   // every look can repaint
  const own = repaintPrompt({ source: "text", text: "  watercolour  " });
  assert.ok(!own.includes("Keep the photograph's composition"));   // a style of its own sets its own composition
  assert.ok(own.startsWith("watercolour\n\n") && own.includes("no text"));
});

test("repaint: a refused optional setting is named, the connection check reads each service's answer, styles are kept", async () => {
  const R = await import("../ui/js/repaint.js");
  const body = { model: "m", prompt: "p", size: "1x1", watermark: false, sequential_image_generation: "disabled" };
  assert.equal(R.refusedParam(400, "The parameter `sequential_image_generation` specified in the request are not valid: the parameter `sequential_image_generation` is not supported by the current model. Request id: x", body), "sequential_image_generation");
  assert.equal(R.refusedParam(400, '{"error":{"message":"Unknown parameter: \'size\'."}}', body), "size");
  assert.equal(R.refusedParam(400, "The parameter `prompt` is required", body), null);       // not optional: nothing to drop
  assert.equal(R.refusedParam(400, "The parameter `n` is not supported", body), null);        // not in this request
  assert.equal(R.refusedParam(401, "The parameter `size` is invalid", body), null);
  const cfg = (provider) => R.normalizeImageAi({ provider, token: "k", model: "m" });
  assert.deepEqual(R.imageCheck(cfg("openai")), { method: "GET", url: "https://api.openai.com/v1/models/m", headers: { authorization: "Bearer k" } });
  assert.equal(R.imageCheck(cfg("openai"), true).url, "https://api.openai.com/v1/models");
  assert.equal(R.imageCheck(cfg("gemini")).url, "https://generativelanguage.googleapis.com/v1beta/models/m");
  assert.equal(R.imageCheck(cfg("seedream")).body.prompt, "");
  assert.equal(R.readImageCheck(cfg("openai"), 200, '{"id":"m"}').ok, true);
  assert.deepEqual(R.readImageCheck(cfg("openai"), 404, "not found"), { again: true });
  assert.equal(R.readImageCheck(cfg("openai"), 200, '{"data":[{"id":"x"}]}', true).key, "notListed");
  assert.equal(R.readImageCheck(cfg("openai"), 401, '{"error":{"message":"Incorrect API key"}}').key, "auth");
  assert.equal(R.readImageCheck(cfg("gemini"), 400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').key, "auth");
  assert.equal(R.readImageCheck(cfg("gemini"), 404, '{"error":{"message":"models/m is not found"}}').key, "model");
  assert.equal(R.readImageCheck(cfg("seedream"), 400, '{"error":{"message":"missing the `prompt` parameter"}}').key, "okSeedream");
  assert.equal(R.readImageCheck(cfg("seedream"), 404, '{"error":{"code":"InvalidEndpointOrModel.NotFound","message":"The model or endpoint m does not exist"}}').key, "model");
  assert.equal(R.readImageCheck(cfg("seedream"), 401, '{"error":{"code":"AuthenticationError"}}').key, "auth");
  // the user's styles left image-ai.json for files; what it held is handed over once
  assert.deepEqual(R.legacyStyles({ source: "custom", custom: "watercolour" }), [{ id: "custom", name: "自定义", prompt: "watercolour" }]);
  assert.deepEqual(R.legacyStyles({ styles: [{ id: "MV7q", name: "A", prompt: "x" }, { id: "b", name: "", prompt: "y" }, { id: "mv7q", prompt: "dup" }] }), [{ id: "mv7q", name: "A", prompt: "x" }, { id: "b", name: "b", prompt: "y" }]);
  assert.equal(R.normalizeImageAi({ source: "custom", custom: "watercolour" }).source, "my:custom");
  assert.ok(!("styles" in R.normalizeImageAi({ styles: [{ id: "a", prompt: "x" }] })));
  assert.equal(R.normalizeImageAi({ source: "my:mv7qzwb3" }).source, "my:mv7qzwb3");
  assert.equal(R.normalizeImageAi({ source: "my:../x" }).source, "look");
  assert.equal(R.normalizeImageAi({ source: "pixel" }).source, "preset:pixel-editorial");                  // the 8-bit style's earlier names
  assert.equal(R.normalizeImageAi({ source: "preset:8-bit-pixel-editorial" }).source, "preset:pixel-editorial");
  assert.equal(R.normalizeImageAi({ source: "preset:watercolour" }).source, "preset:watercolour");
  assert.equal(R.normalizeImageAi({ source: "preset:../x" }).source, "look");
});

test("repaint: built-in styles are Markdown files with a header, named by their id, listed in index.json", async () => {
  const fs = await import("node:fs");
  const { styleIndex, parseStyle } = await import("../ui/js/repaint.js");
  const good = "---\nname.zh: 水彩\nname.en: Watercolour\n# a note\nabout.zh: 松动的水彩\norder: 5\n---\n\n<!-- credit -->\nPaint it in watercolour.\n";
  assert.deepEqual(parseStyle(good), { meta: { "name.zh": "水彩", "name.en": "Watercolour", "about.zh": "松动的水彩", order: "5" }, body: "<!-- credit -->\nPaint it in watercolour.\n", prompt: "Paint it in watercolour.", errors: [] });
  assert.equal(parseStyle("\uFEFF---\r\nname.zh: a\r\nname.en: b\r\n---\r\nX").prompt, "X");   // a BOM and Windows line ends
  assert.deepEqual(parseStyle("just a prompt").errors, ['no header: the file must start with a "---" line']);
  assert.deepEqual(parseStyle("---\nname.zh: a\nnmae.en: b\n---\nX").errors, ["unknown key: nmae.en"]);   // a typo is caught (and the key kept)
  const files = { "watercolour.md": good, "ink-wash.md": good.replace("order: 5", "order: 1").replace("Watercolour", "Ink wash"), "Bad Name.md": good,
    "no-names.md": "---\nname.zh: 只有中文\n---\nX", "empty.md": "---\nname.zh: 空\nname.en: Empty\n---\n<!-- only a comment -->", "late.md": "---\nname.zh: 后\nname.en: Late\n---\nX" };
  const { styles, errors } = styleIndex(Object.keys(files), (f) => files[f]);
  assert.deepEqual(styles.map((x) => x.id), ["ink-wash", "watercolour", "late"]);   // by order (default 100), then id
  assert.deepEqual(styles[1], { id: "watercolour", file: "watercolour.md", order: 5, name: { zh: "水彩", en: "Watercolour" }, about: { zh: "松动的水彩", en: "松动的水彩" } });
  assert.equal(errors.length, 3);   // a file name that is not an id, a missing English name, nothing but a comment
  assert.deepEqual(styleIndex(["one.md"], () => "---\nname: 单名\n---\nX").styles[0].name, { zh: "单名", en: "单名" });   // one name serves both
  // every file in the folder is in the list, readable, and has a prompt
  const dir = new URL("../ui/repaint-styles/", import.meta.url), list = JSON.parse(fs.readFileSync(new URL("index.json", dir), "utf8"));
  assert.deepEqual(list.map((x) => x.file).sort(), fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort());
  const pixel = parseStyle(fs.readFileSync(new URL("pixel-editorial.md", dir), "utf8"));
  assert.deepEqual(pixel.errors, []);
  assert.ok(pixel.prompt.startsWith("Reinterpret the attached photo") && pixel.prompt.length === 2538 && !pixel.prompt.includes("TwentyfiveBTea"));   // unchanged; the credit stays in the header
});

test("repaint: the user's own styles are files of the same form, read leniently and written back whole", async () => {
  const { userStyle, writeStyle, parseStyle, freeId } = await import("../ui/js/repaint.js");
  // a file written by hand or brought in: no header, or a skill's own header, is fine
  const bare = userStyle("ink.md", "Paint it in ink.\n");
  assert.deepEqual([bare.id, bare.name, bare.prompt, bare.order], ["ink", { zh: "ink", en: "ink" }, "Paint it in ink.", 100]);
  const skill = userStyle("pixel-art.md", "---\nname: pixel-art\ndescription: Make pixel art\nlicense: MIT\n---\n# Pixel art\nUse coarse blocks.");
  assert.deepEqual([skill.name.en, skill.about.zh, skill.prompt], ["pixel-art", "Make pixel art", "# Pixel art\nUse coarse blocks."]);
  // written back: the header keeps every key, known ones first, and the body keeps its comments
  const text = writeStyle({ ...skill.meta, order: 3 }, "<!-- mine -->\nUse coarse blocks.");
  assert.equal(text, "---\nname: pixel-art\ndescription: Make pixel art\norder: 3\nlicense: MIT\n---\n\n<!-- mine -->\nUse coarse blocks.\n");
  const back = parseStyle(text);
  assert.deepEqual([back.meta.license, back.prompt, back.body], ["MIT", "Use coarse blocks.", "<!-- mine -->\nUse coarse blocks.\n"]);
  assert.equal(writeStyle({ name: "a\nb" }, "x").split("\n")[1], "name: a b");   // a name cannot break the header
  // ids for files brought in
  assert.equal(freeId("Pixel Art!.md", []), "pixel-art");
  assert.equal(freeId("pixel-art.md", ["pixel-art", "pixel-art-2"]), "pixel-art-3");
  assert.equal(freeId("水彩.md", []), "style");
  assert.equal(freeId("SKILL.md", ["skill"]), "skill-2");
});

test("layers: the subject layer is optional, at most one, removable, and keeps its settings", async () => {
  const { normalizeLayers, isRemovable, newLayer } = await import("../ui/js/layers.js");
  const base = normalizeLayers([]);
  assert.ok(!base.some((l) => l.type === "subject"));                       // not part of a new cover
  const raw = [...base.slice(0, 5), { type: "subject", outline: 99, shadow: 0.5, follow: true, ink: "#FF0000", t: {} }, { type: "subject" }, ...base.slice(5)];
  const out = normalizeLayers(raw), subs = out.filter((l) => l.type === "subject");
  assert.equal(subs.length, 1);                                              // a second one is dropped
  assert.deepEqual([subs[0].id, subs[0].outline, subs[0].shadow, subs[0].follow, subs[0].ink], ["subject", 60, 0.5, true, "#ff0000"]);
  assert.equal(out.indexOf(subs[0]), 5);                                     // where it was put
  assert.ok(isRemovable({ type: "subject" }) && isRemovable({ type: "text" }) && !isRemovable({ type: "title" }) && !isRemovable({ type: "bg" }));
  assert.deepEqual([newLayer("subject").outline, newLayer("subject").ink], [0, undefined]);
});

test("text effects: the perspective maps the block's corners where they were dragged", async () => {
  const { squareToQuad, warpCorners } = await import("../ui/js/textfx.js");
  const q = [[10, 20], [110, 0], [130, 90], [0, 70]], map = squareToQuad(q);
  [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([u, v], i) => { const [x, y] = map(u, v); assert.ok(Math.abs(x - q[i][0]) < 1e-9 && Math.abs(y - q[i][1]) < 1e-9, `corner ${i}`); });
  const flat = squareToQuad([[0, 0], [100, 0], [100, 50], [0, 50]]);
  assert.deepEqual(flat(0.5, 0.5), [50, 25]);                                 // an unmoved block stays as it is
  assert.deepEqual(warpCorners(null, 1)[0], [0, 0]);                          // without its own corners: the plain taper
  assert.ok(warpCorners(null, 1)[1][1] > 0 && warpCorners(null, 1)[2][1] < 0);
  const own = [[0, 0], [0.1, 0.2], [0, 0], [-0.1, 0]];
  assert.equal(warpCorners(own), own);
  const { normalizeLayers } = await import("../ui/js/layers.js");
  const out = normalizeLayers([{ type: "title", fx: "taper", warp: [[0, 0], [9, -9], [0, "0.5"], [0, 0]] }, { type: "text", text: "x", warp: [[0, 0]] }]);
  assert.deepEqual(out.find((l) => l.type === "title").warp, [[0, 0], [1.5, -1.5], [0, 0.5], [0, 0]]);   // held within reach
  assert.equal(out.find((l) => l.type === "text").warp, undefined);                                     // not four corners: dropped
});

test("layers: photo layers keep their picture id, mode and treatment; a design keeps none", async () => {
  const { normalizeLayers, newLayer, fillsCanvas, isFree } = await import("../ui/js/layers.js");
  const out = normalizeLayers([
    { type: "photo", pid: "pAB12", fill: true, blur: 200, dim: 0.5, treat: false, t: { all: { x: 0.6, y: 0.5, s: 1.2 } } },
    { type: "photo", of: "lx1", cut: true, outline: 7, ink: "#00FF00" },
    { type: "photo", pid: "../../etc", fill: false },
    { type: "photo" },                                                              // no picture: dropped
  ]).filter((l) => l.type === "photo");
  assert.equal(out.length, 3);
  assert.deepEqual([out[0].pid, out[0].fill, out[0].blur, out[0].dim, out[0].treat, out[0].t.all.x], ["pAB12", true, 80, 0.5, false, 0.6]);
  assert.deepEqual([out[1].of, out[1].cut, out[1].outline, out[1].ink, out[1].treat], ["lx1", true, 7, "#00ff00", true]);
  assert.equal(out[2].pid, "etc");                                               // only an id's own characters
  assert.ok(fillsCanvas(out[0]) && !fillsCanvas(out[1]) && !fillsCanvas(out[2]) && isFree("photo"));
  assert.deepEqual([newLayer("photo", { pid: "a", fill: true }).t.all.s, newLayer("photo", { pid: "a" }).t.all.s], [1, 0.6]);
  const { normalizeProfile } = await import("../ui/js/store.js");
  const p = normalizeProfile({ name: "x", design: { layers: [{ type: "photo", pid: "a", fill: true }, { type: "subject" }] } });
  assert.ok(!p.design.layers.some((l) => l.type === "photo" || l.type === "subject"));
});

test("asset folders: ids cleaned and unique, names kept short, anything else dropped", async () => {
  const { normalizeFolders } = await import("../ui/js/store.js");
  assert.deepEqual(normalizeFolders([{ id: "fa", name: "品牌" }, { id: "fa", name: "again" }, { id: "f b!", name: "" }, { name: "no id" }, null, "x"]), [{ id: "fa", name: "品牌" }, { id: "fb", name: "fb" }]);
  assert.deepEqual(normalizeFolders(null), []);
  assert.equal(normalizeFolders([{ id: "f1", name: "x".repeat(99) }])[0].name.length, 40);
});

test("plates under highlighted words: the title and text layers alike, with a colour of their own", () => {
  const ls = normalizeLayers([{ type: "title", hiPlate: true, hiPlateInk: "#FF3366" }, { type: "text", id: "a", text: "x *y*", hiPlate: true }, { type: "text", id: "b", text: "z", hiPlate: "yes", hiPlateInk: "red" }, { type: "tag", hiPlate: true }]);
  const one = (f) => ls.find(f);
  assert.deepEqual([one((l) => l.type === "title").hiPlate, one((l) => l.type === "title").hiPlateInk], [true, "#ff3366"]);
  assert.equal(one((l) => l.id === "a").hiPlate, true);
  assert.deepEqual([one((l) => l.id === "b").hiPlate, one((l) => l.id === "b").hiPlateInk], [undefined, undefined]);   // only a real true, a real colour
  assert.equal(one((l) => l.type === "tag").hiPlate, undefined);                 // headlines only
});

test("the layout layers' default order, and a design or cover still in the old one put into it, added layers keeping their slots", () => {
  assert.deepEqual(BOUND_TYPES, ["bg", "accent", "graphic", "catname", "tag", "brand", "logo", "subtitle", "title", "frame"]);   // in the list from the top: brackets, title, subtitle, brand logo, brand row, tag, channel name, graphic, block, ground
  const L = (type, id = type) => ({ type, id });
  // a file from before the logo and the subtitle gets them as it is read: above the brand row, under the title
  assert.deepEqual(normalizeLayers([L("bg"), L("accent"), L("graphic"), L("brand"), L("title"), L("tag"), L("catname"), L("frame")]).map((l) => l.id), ["bg", "accent", "graphic", "brand", "logo", "subtitle", "title", "tag", "catname", "frame"]);
  assert.equal(normalizeLayers([L("bg"), L("title")]).find((l) => l.type === "logo").off, undefined);   // put back as it was: on
  assert.equal(normalizeLayers([L("bg"), L("title")]).find((l) => l.type === "subtitle").off, undefined);   // the subtitle too: on
  const old = [L("bg"), L("accent"), L("graphic"), L("brand"), L("logo"), L("subtitle"), L("title"), L("text", "w"), L("tag"), L("text", "x"), L("catname"), L("frame"), L("solid", "y")];
  assert.equal(reorderLayout(old), true);
  assert.deepEqual(old.map((l) => l.id), ["bg", "accent", "graphic", "catname", "tag", "x", "brand", "logo", "subtitle", "title", "w", "frame", "y"]);   // each added layer over the layout layer it was over
  const mine = [L("bg"), L("accent"), L("title"), L("graphic"), L("brand"), L("logo"), L("subtitle"), L("tag"), L("catname"), L("frame")];   // re-ordered by hand: left alone
  assert.equal(reorderLayout(mine), false);
  assert.deepEqual(mine.map((l) => l.id), ["bg", "accent", "title", "graphic", "brand", "logo", "subtitle", "tag", "catname", "frame"]);
  assert.equal(reorderLayout(old), false);                                                // once in the new order, nothing to do
  // Cover → Layout parts puts them in any order, the added layers going with theirs
  const order = ["bg", "accent", "graphic", "catname", "brand", "logo", "subtitle", "title", "tag", "frame"];
  assert.equal(orderLayout(old, order), true);
  assert.deepEqual(old.map((l) => l.id), ["bg", "accent", "graphic", "catname", "brand", "logo", "subtitle", "title", "w", "tag", "x", "frame", "y"]);
  assert.deepEqual(layoutOrder(old), order);
  assert.equal(orderLayout(old, order), false);                                           // already so
  assert.equal(orderLayout(old, order.slice(1).concat("bg")), false);                     // the ground stays at the bottom
  assert.equal(orderLayout(old, order.slice(0, -1)), false);                              // every layout layer, or nothing moves
  assert.deepEqual(layoutOrder(old), order);
});

test("clipping masks: a free layer clipped shows within the nearest unclipped layer below; never the ground", () => {
  const kept = normalizeLayers([{ type: "solid", id: "s", clip: true }, { type: "tag", clip: true }, { type: "solid", id: "u", clip: "yes" }]);
  assert.equal(kept.find((l) => l.id === "s").clip, true);
  assert.equal(kept.find((l) => l.type === "tag").clip, undefined);               // only the user's own layers are clipped
  assert.equal(kept.find((l) => l.id === "u").clip, undefined);                   // and only by a real true
  const ls = [{ type: "bg", id: "bg" }, { type: "title", id: "title" }, { type: "photo", id: "p", clip: true }, { type: "solid", id: "s", clip: true }, { type: "text", id: "t" }];
  const at = (id) => ls.findIndex((l) => l.id === id), title = at("title");
  assert.deepEqual([clipBase(ls, at("p")), clipBase(ls, at("s")), clipBase(ls, at("t"))], [title, title, -1]);   // two clipped onto the same base
  assert.equal(clipEnd(ls, title), at("s"));
  assert.equal(clipEnd(ls, at("t")), at("t"));                                    // nothing clipped onto it
  const ground = [{ type: "bg", id: "bg" }, { type: "solid", id: "a", clip: true }];
  assert.deepEqual([clipBase(ground, 1), clipEnd(ground, 0)], [-1, 0]);           // clipped onto the ground: no clip at all
});

test("scene objects: each look names its own; a cover keeps where they were dragged, per look, for all sizes and per size", () => {
  for (const id of LOOK_IDS) {
    const scene = LOOKS[id].scene;
    if (id === "cel" || id === "cyano") { assert.equal(scene, undefined, id); continue; }   // nothing of theirs is worth dragging (see the to-do list)
    assert.ok(scene && Object.keys(scene).length >= 1, `${id} has scene objects`);
    for (const [k, n] of Object.entries(scene)) assert.ok(/^[a-zA-Z]+$/.test(k) && n.zh && n.en, `${id}.${k}`);
  }
  assert.ok(!LOOKS.cyber.params.some((d) => d.key === "sweepAt"), "the sweep's position slider is a drag now");
  const c = {};
  moveScene(c, "court", "ball", "all", "1920x1080", 0.1, -0.05);
  moveScene(c, "court", "ball", "size", "1080x1920", 0.02, 0);
  assert.deepEqual(sceneOffsets(c, "court", "1920x1080"), { ball: [0.1, -0.05] });
  assert.deepEqual(sceneOffsets(c, "court", "1080x1920").ball.map((v) => +v.toFixed(3)), [0.12, -0.05]);   // the size's own on top of all sizes'
  assert.deepEqual(sceneOffsets(c, "pitch", "1920x1080"), {});                   // another look's objects are where they were
  resetScene(c, "court", "ball", "size", "1080x1920");
  assert.deepEqual(c.scene, { court: { ball: { all: [0.1, -0.05] } } });
  resetScene(c, "court", null, "all");
  assert.deepEqual(c.scene, {});
  // as stored: offsets kept within limits, unmoved objects and anything malformed dropped
  assert.deepEqual(normalizeScene({ court: { ball: { all: [9, 0], by: { "1920x1080": [0, 0.2], bad: [1, 1] } }, hoop: { all: [0, 0] } }, BAD: { x: { all: [1, 1] } }, pitch: "no" }),
    { court: { ball: { all: [1.5, 0], by: { "1920x1080": [0, 0.2] } } } });
  const P = normalizeProfile({});
  assert.equal("scene" in normalizeCover({ title: "x" }, P), false);
  assert.deepEqual(normalizeCover({ title: "x", scene: { court: { ball: { all: [0.1, 0] } } } }, P).scene, { court: { ball: { all: [0.1, 0] } } });
});

test("solid colour layers: the canvas's size at scale 1, one colour, free like any added layer", async () => {
  const { isFree, isRemovable } = await import("../ui/js/layers.js");
  const L = newLayer("solid", { color: "#123456" });
  assert.deepEqual([L.t.all.x, L.t.all.y, L.t.all.s], [0.5, 0.5, 1]);
  assert.ok(isFree("solid") && isRemovable({ type: "solid" }));
  const one = (raw) => normalizeLayers([{ type: "solid", ...raw }]).find((l) => l.type === "solid");
  assert.equal(one({ color: "#ABCDEF" }).color, "#abcdef");
  assert.equal(one({ color: "red" }).color, "#ffd60a");
  assert.deepEqual(one(L), L);
  assert.equal(resolve(L, 1920, 1080, "1920x1080").s, 1);   // drawn as 1920/1 x 1080/1 units: the whole canvas
});

test("copying another cover's free layers: new ids, links kept, each above the built-in layer it was above", async () => {
  const { copyFreeLayers } = await import("../ui/js/layers.js");
  const into = normalizeLayers([{ type: "bg" }, { type: "photo", id: "mine", pid: "p0" }, { type: "accent" }, { type: "title" }, { type: "text", id: "t0", text: "here" }]);
  const from = normalizeLayers([{ type: "bg" }, { type: "photo", id: "a", pid: "p1", fill: true, blur: 4 }, { type: "accent" }, { type: "title" },
    { type: "photo", id: "b", of: "a", cut: true, own: true, feather: 6 }, { type: "text", id: "c", text: "hi", ink: "#ff0000" }, { type: "frame" }, { type: "asset", id: "d", ref: { kind: "sticker", id: "star" } }]);
  const { layers, copies } = copyFreeLayers(into, from);
  assert.equal(copies.length, 4);
  assert.ok(copies.every((c) => !into.some((l) => l.id === c.id) && !["a", "b", "c", "d"].includes(c.id)), "new ids");
  const [a, b, c, d] = copies;
  assert.equal(b.of, a.id, "the cut-out follows the copy of its photo");
  assert.deepEqual([a.blur, a.fill, b.feather, c.ink, c.text], [4, true, 6, "#ff0000", "hi"], "settings kept");
  const order = layers.map((l) => (copies.includes(l) ? "copy:" + from.find((f) => f.type === l.type && (l.type !== "photo" || !!f.of === !!l.of)).id : l.id));
  const pos = (id) => order.indexOf(id);
  assert.ok(pos("bg") < pos("mine") && pos("mine") < pos("copy:a") && pos("copy:a") < pos("accent"), "the photo: above the background, over this cover's own photo");
  assert.ok(pos("title") < pos("copy:b") && pos("copy:b") < pos("copy:c") && pos("copy:c") < pos("frame"), "the cut-out and text: above the title (the top layout layer but the brackets), in their order");
  assert.ok(pos("frame") < pos("t0") && pos("t0") < pos("copy:d"), "the sticker: above the frame, over this cover's text there");
  assert.equal(layers.length, into.length + 4);
  assert.deepEqual(into.map((l) => l.id), normalizeLayers([{ type: "bg" }, { type: "photo", id: "mine", pid: "p0" }, { type: "accent" }, { type: "title" }, { type: "text", id: "t0", text: "here" }]).map((l) => l.id), "the list given is left as it was");
  assert.equal(copyFreeLayers(into, defaultLayers()).copies.length, 0);
});

test("the soft-edge blur of one channel: spreads a step symmetrically, keeps a constant, clamps at the edges", async () => {
  const { blurChannel } = await import("../ui/js/photo.js");
  const w = 41, h = 9, a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = x < 20 ? 1 : 0;   // a step at x = 20
  blurChannel(a, w, h, 3);
  const row = (y) => Array.from(a.slice(y * w, y * w + w));
  assert.ok(Math.abs(row(4)[0] - 1) < 1e-6 && Math.abs(row(4)[40]) < 1e-6, "far from the step: unchanged (edges clamped, not faded)");
  assert.ok(Math.abs(row(4)[19] + row(4)[20] - 1) < 0.02, "the step's two sides mirror each other");
  assert.ok(row(4)[17] > row(4)[19] && row(4)[19] > row(4)[21], "it falls across the step");
  assert.deepEqual(row(0).map((v) => v.toFixed(4)), row(8).map((v) => v.toFixed(4)), "rows alike stay alike (the vertical pass keeps them)");
});

test("a photo filling the canvas shows its frame, corners only, once it no longer covers the canvas", async () => {
  const { showsFrame, handles } = await import("../ui/js/render.js");
  const ids = (hit) => handles(hit, 1).map((h) => h.id).sort().join(" ");
  assert.equal(showsFrame({ type: "bg", cx: 960, cy: 540, hw: 960, hh: 540, r: 0 }), false);
  assert.equal(showsFrame({ type: "photo", cx: 960, cy: 540, hw: 960, hh: 540, r: 0, fill: true, covers: true }), false);   // its frame is off the canvas
  const small = { type: "photo", cx: 1500, cy: 200, hw: 280, hh: 160, r: 0, fill: true, covers: false };   // scrolled smaller and moved aside
  assert.equal(showsFrame(small), true);
  assert.equal(ids(small), "ne nw se sw", "scaled only: no sides to stretch, no knob to turn");
  const print = { type: "photo", cx: 960, cy: 540, hw: 300, hh: 170, r: 0 };
  assert.equal(showsFrame(print), true);
  assert.equal(ids(print), "e n ne nw rot s se sw w");
});

test("the 3D view of the layers: flat it is the canvas, apart every sheet fits and maps back", async () => {
  const { VIEW, turn, gapFor, fitView, sheetAt, toSheet, corners, anchorOf, sheetUnder } = await import("../ui/js/stack3d.js");
  const box = { x: 18, y: 18, w: 1000, h: 700 }, near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
  // flat: every sheet on the one below, placed exactly as the canvas is in the stage (so the view opens out of the cover)
  const flat = fitView(turn(0, 0), 1920, 1080, 0, 0, box), k = Math.min(1000 / 1920, 700 / 1080);
  near(flat.s, k);
  const m0 = sheetAt(flat, 0);
  near(m0.a, k); near(m0.d, k); near(m0.b, 0); near(m0.c, 0);
  near(m0.e, 18 + (1000 - 1920 * k) / 2); near(m0.f, 18 + (700 - 1080 * k) / 2);
  // apart: the corners of the bottom and top sheets lie within the box, and points map back onto their sheet
  const n = 12, gap = gapFor(n, 1080, 1), z1 = (n - 1) * gap, V = fitView(turn(VIEW.yaw, VIEW.pitch), 1920, 1080, 0, z1, box);
  for (const z of [0, z1]) for (const p of corners(sheetAt(V, z), 1920, 1080)) {
    assert.ok(p.x >= box.x - 1e-6 && p.x <= box.x + box.w + 1e-6 && p.y >= box.y - 1e-6 && p.y <= box.y + box.h + 1e-6, `${p.x}, ${p.y} outside`);
  }
  for (const [yaw, pitch, z] of [[-30, 58, 0], [45, 20, 500], [-80, 80, z1]]) {
    const W = fitView(turn(yaw, pitch), 1080, 1920, 0, z1, box), m = sheetAt(W, z), q = toSheet(m, m.a * 300 + m.c * 1500 + m.e, m.b * 300 + m.d * 1500 + m.f);
    near(q.x, 300, 1e-6); near(q.y, 1500, 1e-6);
  }
  assert.ok(sheetAt(V, z1).f < sheetAt(V, 0).f, "a higher sheet is higher on the screen");
  // the labels' anchor: the same corner of every sheet, straight above each other
  const a0 = anchorOf(sheetAt(V, 0), 1920, 1080), a1 = anchorOf(sheetAt(V, z1), 1920, 1080);
  near(a0.x, a1.x);
  assert.ok(a0.x >= Math.max(...corners(sheetAt(V, 0), 1920, 1080).map((p) => p.x)) - 1e-6);
  // what is under the pointer: the front-most sheet that has something there, seen through where it has nothing
  const sheets = [{ id: "bg", z: 0 }, { id: "sticker", z: gap }, { id: "title", z: 2 * gap }];
  const m = sheetAt(V, gap), mid = { x: m.a * 960 + m.c * 540 + m.e, y: m.b * 960 + m.d * 540 + m.f };   // the middle of the sticker's sheet
  // the background everywhere, the sticker in the middle, the title along the top
  const paint = { bg: () => true, sticker: (fx, fy) => Math.abs(fx - 0.5) < 0.1 && Math.abs(fy - 0.5) < 0.1, title: (fx, fy) => fy < 0.2 };
  const solid = (sh, fx, fy) => paint[sh.id](fx, fy), on = (z, x, y) => { const q = sheetAt(V, z); return [q.a * x + q.c * y + q.e, q.b * x + q.d * y + q.f]; };
  assert.equal(sheetUnder(V, sheets, mid.x, mid.y, solid).id, "sticker", "the title's sheet is over it, but has nothing there");
  assert.equal(sheetUnder(V, sheets, ...on(2 * gap, 960, 100), solid).id, "title");
  assert.equal(sheetUnder(V, sheets, ...on(0, 100, 1000), solid).id, "bg");
  assert.equal(sheetUnder(V, sheets, -500, -500, () => true), null);
});

test("the 3D view's labels move apart only as far as they must, and stay in bounds", async () => {
  const { spreadLabels } = await import("../ui/js/stack3d.js");
  assert.deepEqual(spreadLabels([100, 200, 300], 20, 0, 500), [100, 200, 300], "room enough: left where they are");
  const ys = spreadLabels([300, 290, 305, 310], 20, 0, 500), sorted = [...ys].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 20 - 1e-9, "no two overlap");
  assert.ok(ys[1] < ys[0] && ys[0] < ys[2] && ys[2] < ys[3], "in the order they wanted");
  const low = spreadLabels([495, 498, 499], 20, 0, 500);
  assert.ok(Math.max(...low) <= 490 && Math.min(...low) >= 10, "pushed up off the bottom");
});

test("the title is lettered like a text layer: the same look effects, a clipping mask", async () => {
  const { effectsFor: fxFor } = await import("../ui/js/style.js");
  for (const id of LOOK_IDS) assert.deepEqual(fxFor(id, "title").map((e) => e.key), fxFor(id, "text").map((e) => e.key), `${id}: the title takes what text takes`);
  const ls = normalizeLayers([{ type: "bg" }, { type: "accent" }, { type: "title", clip: true }, { type: "brand", clip: true }]);
  assert.equal(ls.find((l) => l.type === "title").clip, true, "the title may be clipped onto the layer below");
  assert.equal(ls.find((l) => l.type === "brand").clip, undefined, "the other layout layers may not");
});

test("a layout part may be left out of a cover: hidden, never the ground, never a layer of the user's", () => {
  const ls = normalizeLayers([{ type: "graphic", off: true, visible: true }, { type: "bg", off: true }, { type: "text", text: "x", off: true }]);
  const of = (type) => ls.find((l) => l.type === type);
  assert.equal(of("graphic").off, true); assert.equal(of("graphic").visible, false, "a part left out is hidden");
  assert.equal(of("bg").off, undefined, "the ground is never left out");
  assert.equal(of("text").off, undefined, "a layer of the user's is deleted, not left out");
});

test("the platforms' covers: the ratios each wants, by the video's orientation and RED's choice", async () => {
  const { wanted, isRatio, PLATFORM_IDS } = await import("../ui/js/platforms.js");
  const ratios = (o) => wanted({ orient: "h", red: "3:4", ...o }).map((w) => w.ratio);
  assert.deepEqual(ratios({ platforms: ["bili"] }), ["16:9", "4:3"]);
  assert.deepEqual(ratios({ platforms: ["youtube"] }), ["16:9"]);
  assert.deepEqual(ratios({ platforms: ["youtube"], orient: "v" }), ["9:16"]);
  assert.deepEqual(ratios({ platforms: ["douyin"] }), ["4:3", "3:4"]);
  assert.deepEqual(ratios({ platforms: ["red"], red: "1:1" }), ["1:1"]);
  assert.deepEqual(ratios({ platforms: ["channels"], orient: "v" }), ["3:4"]);
  assert.deepEqual(ratios({ platforms: ["channels"] }), ["4:3", "3:4"]);
  assert.deepEqual(ratios({ platforms: ["mp"] }), ["1:1", "2.35:1"]);
  assert.deepEqual(ratios({ platforms: PLATFORM_IDS }), ["16:9", "4:3", "3:4", "1:1", "2.35:1"], "all six, a landscape video, RED at 3:4: five ratios");
  assert.ok(isRatio(1600, 1200, "4:3") && isRatio(900, 383, "2.35:1") && !isRatio(1146, 717, "16:9"));
});

test("the cover standards: type size in the feed, contrast, a picture big enough, the apps' badges, sizes missing", async () => {
  const { checkCover, titleContrast, contrastRatio, luminance, lineUnits, moveOut, boxOf } = await import("../ui/js/check.js");
  assert.equal(lineUnits("封面Ab"), 3);
  assert.ok(Math.abs(contrastRatio(luminance(255, 255, 255), luminance(0, 0, 0)) - 21) < 1e-9);
  // a title's pixels against what is behind them: white on white fails, white with a black outline on white reads
  const px = (n, rgba) => { const a = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) a.set(rgba, i * 4); return a; };
  assert.ok(titleContrast(px(100, [255, 255, 255, 255]), px(100, [240, 240, 240, 255])) < 1.2);
  const outlined = px(100, [255, 255, 255, 255]); for (let i = 0; i < 40; i++) outlined.set([0, 0, 0, 255], i * 4);
  assert.ok(titleContrast(outlined, px(100, [240, 240, 240, 255])) > 10);
  assert.equal(titleContrast(px(100, [255, 255, 255, 0]), px(100, [0, 0, 0, 255])), null, "nothing solid: nothing to say");
  const sizes = [{ key: "1920x1080", w: 1920, h: 1080, vw: 1920, vh: 1080 }];
  const big = { cx: 700, cy: 350, hw: 600, hh: 210, r: 0 };   // two lines in 420 px: a type size of about 181, 16.5 px in a 175 px feed
  const seen = (o) => ({ "1920x1080": { title: { id: "title", hit: big }, contrast: 6, pictures: [{ id: "graphic", hit: { cx: 1400, cy: 600, hw: 300, hh: 250, r: 0 } }], unknown: false, parts: [{ id: "title", hit: big }], ...o } });
  const rules = (o, extra = {}) => checkCover({ title: "封面标题\n*第二行*", sizes, seen: seen(o), platforms: ["bili"], orient: "h", red: "3:4", ...extra }).map((i) => `${i.rule}:${i.level}`);
  assert.deepEqual(rules({}), ["E1:red"], "B站 also wants 4:3, which this profile lacks; the 16:9 cover itself is fine");
  // A1: 240 px of block for two lines is a type size of about 103; at 175 px of feed out of 1920, 9.4 px
  assert.ok(rules({ title: { id: "title", hit: { cx: 600, cy: 300, hw: 500, hh: 120, r: 0 } } }).includes("A1:red"));
  assert.ok(rules({ title: { id: "title", hit: { cx: 600, cy: 300, hw: 500, hh: 150, r: 0 } } }).includes("A1:yellow"));
  assert.ok(rules({ contrast: 2.5 }).includes("B1:yellow") && rules({ contrast: 1.5 }).includes("B1:red"));
  assert.ok(rules({ pictures: [{ id: "graphic", hit: { cx: 1400, cy: 600, hw: 150, hh: 120, r: 0 } }] }).includes("C1:yellow"));
  assert.ok(!rules({ unknown: true, pictures: [] }).some((r) => r.startsWith("C1")), "a background photo's subject is not measured");
  const corner = { parts: [{ id: "t1", hit: { cx: 1750, cy: 1000, hw: 150, hh: 60, r: 0 } }] };
  assert.ok(rules(corner).includes("D1:red"), "words in B站's duration corner");
  assert.ok(rules({}, { title: "这是一个非常非常长的封面标题哦" }).includes("A2:yellow"));
  // moving out of a corner: the least way, still on the canvas
  const mv = moveOut(boxOf({ cx: 1750, cy: 1000, hw: 150, hh: 60, r: 0 }), { x0: 1497.6, y0: 907.2, x1: 1920, y1: 1080 }, 1920, 1080);
  assert.ok(mv && mv.dy < 0 && mv.dx === 0 && 1000 + mv.dy + 60 <= 907.2);
});

test("Surprise me's recipes: every look has one, naming only letterings, bends and sliders there are; sliders tuned about their defaults", async () => {
  const { RECIPES, FAMILIES, EXTRAS, recipeOf, tuneLook, letterFor, weighted } = await import("../ui/js/deal.js");
  const { EFFECTS, BENDS } = await import("../ui/js/textfx.js");
  const seeded = (a) => () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };   // mulberry32
  assert.deepEqual(Object.keys(RECIPES).sort(), [...LOOK_IDS].sort());
  for (const [id, r] of Object.entries(RECIPES)) {
    assert.ok(FAMILIES[r.family], id);
    const q = recipeOf(id), keys = LOOKS[id].params.map((d) => d.key);
    for (const k of Object.keys(q.fx)) assert.ok(EFFECTS[k] && k !== "auto", `${id}: lettering ${k}`);
    for (const k of Object.keys(q.bends)) assert.ok(BENDS[k] && k !== "taper", `${id}: bend ${k}`);
    for (const [k, v] of Object.entries(q.params)) {
      const d = LOOKS[id].params.find((x) => x.key === k);
      assert.ok(d && !d.text, `${id}: slider ${k}`);
      assert.ok(typeof v === "number" && v >= 0 && v <= 1 && (d.toggle || d.def <= d.min), `${id}.${k}: the chance of a part that is off by default`);
    }
    for (const k of ["own", "bend", "dark"]) assert.ok(q[k] >= 0 && q[k] <= 1, `${id}: ${k} is a chance`);
    assert.ok(Object.keys(q.params).every((k) => keys.includes(k)));
  }
  // tuned: within each slider, on its steps, about its default (a default at an end reached too); what is
  // off by default mostly left off, a few such parts at most
  const R = seeded(7), coupled = ["anime.rays", "citypop.stars", "deco.fog"];
  for (const id of LOOK_IDS) {
    const sums = {}, on = {}, N = 300, extra = LOOKS[id].params.filter((d) => !d.text && !d.toggle && d.def <= d.min);
    for (let i = 0; i < N; i++) {
      const p = tuneLook(id, R);
      assert.ok(extra.filter((d) => p[d.key] > d.min).length <= EXTRAS, `${id}: no more than ${EXTRAS} of its optional parts`);
      for (const d of LOOKS[id].params) {
        if (d.text) { assert.ok(!(d.key in p), `${id}.${d.key}: typed words are the caller's`); continue; }
        const v = p[d.key];
        assert.ok(v >= d.min && v <= d.max && Math.abs(v / (d.step || 0.05) - Math.round(v / (d.step || 0.05))) < 1e-6, `${id}.${d.key} = ${v}`);
        sums[d.key] = (sums[d.key] || 0) + v; on[d.key] = (on[d.key] || 0) + (v > d.min ? 1 : 0);
      }
    }
    for (const d of LOOKS[id].params) {
      if (d.text || d.toggle) continue;
      const span = d.max - d.min, mean = sums[d.key] / N;
      if (d.def > d.min && !coupled.includes(`${id}.${d.key}`)) assert.ok(Math.abs(mean - d.def) < span * 0.08, `${id}.${d.key}: ${mean.toFixed(2)} about ${d.def}`);
      if (d.def <= d.min) assert.ok(on[d.key] / N < 0.6, `${id}.${d.key}: on in ${on[d.key]} of ${N}`);
    }
  }
  // letterings, for every look alike (oddsOf): by default what the looks' recipes give on average; set, as set, the
  // dark deco too; nothing that cannot be drawn; never the lettering named after the look (its own already); the subtitle never bent
  const { oddsOf } = await import("../ui/js/deal.js"), base = oddsOf().groups;
  assert.ok(base.letters.own > 0.6 && base.letters.own < 0.95 && base.bend.none > 0.7 && base.bend.none < 1 && base.ground.dark > 0.3 && base.ground.dark < 0.8, JSON.stringify([base.letters.own, base.bend.none, base.ground.dark]));
  const share = (id, role, test, odds, n = 2000) => { let k = 0; for (let i = 0; i < n; i++) if (test(letterFor(id, role, R, (f) => f !== "extrude", null, { odds }))) k++; return k / n; };
  const set = oddsOf({ groups: { letters: { ransom: 1 }, bend: { arc: 1 } } });
  assert.equal(share("deco", "title", (o) => o.fx === "ransom" && o.bend === "arc", set), 1, "set for every look: the dark deco too");
  assert.equal(share("court", "title", (o) => o.fx === "extrude", oddsOf({ groups: { letters: { extrude: 1, own: 1 } } })), 0, "an outline lettering left out where outlines cannot be read");
  assert.equal(share("editorial", "title", (o) => o.fx === "editorial", oddsOf({ groups: { letters: { editorial: 1 } } })), 0, "the lettering named after the look is its own, not dealt as another");
  assert.equal(share("rave", "subtitle", (o) => o.bend, set), 0);
  const t = { fx: "worn", fxAmt: 1.2 };
  const same = (() => { let k = 0; for (let i = 0; i < 2000; i++) if (letterFor("cel", "subtitle", R, () => true, t).fx === "worn") k++; return k / 2000; })();
  assert.ok(same > 0.4 && same < 0.65, `the subtitle lettered like the title about half the time (${same})`);
  assert.equal(weighted({ a: 0, b: 0 }, R), null);
  assert.equal(weighted({ a: 0, b: 2 }, R), "b");
});

test("Surprise me turns the chances to the cover while they are the rules': a long title bent less and kept large, a channel colour kept off a ground like it; set, as set", async () => {
  const { coverContext, recipeOf, oddsOf, baseRecipe } = await import("../ui/js/deal.js");
  assert.deepEqual(coverContext("封面标题\n*第二行*", [252, 238, 10]).long, false);
  assert.equal(coverContext("这是一个非常非常长的封面标题哦", null).long, true, "a line wider than 8 characters");
  assert.equal(coverContext("一\n二\n三", null).long, true, "three lines");
  assert.equal(coverContext("短题\nAI", null).short, true);
  assert.ok(coverContext("x", [0, 0, 0]).lum < 0.01 && coverContext("x", [255, 255, 255]).lum > 0.99);
  const plain = recipeOf("verse"), long = recipeOf("verse", { long: true }), short = recipeOf("verse", { short: true });
  assert.ok(Math.abs(long.bend - plain.bend * 0.3) < 1e-9 && long.fx.sticker === plain.fx.sticker / 2 && long.fx.extrude === plain.fx.extrude / 2 && long.fx.cel === plain.fx.cel);
  assert.ok(short.bend > plain.bend && short.bend <= 0.5);
  assert.ok(recipeOf("neon", { lum: 0.01 }).dark < recipeOf("neon").dark && recipeOf("riso", { lum: 0.9 }).dark > recipeOf("riso").dark && recipeOf("riso", { lum: 0.3 }).dark === recipeOf("riso").dark);
  // the same for every look: the ground, the lettering and the bend are not the look's own
  assert.deepEqual(["dark", "own", "bend"].map((k) => recipeOf("deco")[k]), ["dark", "own", "bend"].map((k) => recipeOf("cel")[k]));
  // set by the user: dealt as set, whatever the title and the channel colour
  const odds = oddsOf({ groups: { bend: { arc: 1 }, letters: { sticker: 1 }, ground: { dark: 0.3, light: 0.7 } } });
  for (const ctx of [{ long: true }, { short: true }, { lum: 0.01 }, { lum: 0.9 }]) {
    const q = recipeOf("verse", { ...ctx, odds });
    assert.deepEqual([q.bend, q.bends, q.fx, q.own, q.dark], [1, { arc: 1 }, { sticker: 1 }, 0, 0.3], JSON.stringify(ctx));
  }
  // a look's optional parts: the user's over the table's
  const b = baseRecipe("deco", { params: { rain: 1 } });
  assert.deepEqual([b.params.rain, b.params.airship], [1, 0.25]);
  // the look for a hand: as likely as its chance, none dealt already in the run while another with a chance is left, none at 0
  const { pickLook } = await import("../ui/js/deal.js");
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), ids = ["a", "b", "c", "d"], got = { a: 0, b: 0, c: 0, d: 0 };
  for (let i = 0; i < 4000; i++) got[pickLook(ids, rand, { a: 0.4, b: 0.3, c: 0.3, d: 0 }, ["a"])]++;
  assert.deepEqual([got.a, got.d], [0, 0], "a look dealt already in the run waits, one at 0 never comes");
  assert.ok(Math.abs(got.b / got.c - 1) < 0.15, JSON.stringify(got));
  for (let i = 0; i < 40; i++) assert.equal(pickLook(ids, rand, { a: 0.5, b: 0.5, c: 0, d: 0 }, ["a", "b"]) === "c", false, "with every look with a chance dealt, those come again, not one at 0");
});

test("Surprise me's chances: the rule's, the user's over them; a group adds up to 1, moving one moves the rest alike", async () => {
  const { oddsOf, rebalance, RULES, ODD_OPTIONS } = await import("../ui/js/deal.js");
  const { LOOK_IDS } = await import("../ui/js/style.js");
  const near = (a, b) => Math.abs(a - b) < 1e-9, sum = (g) => Object.values(g).reduce((s, v) => s + v, 0);
  const base = oddsOf();
  for (const [g, list] of Object.entries(ODD_OPTIONS)) { assert.deepEqual(Object.keys(base.groups[g]).sort(), [...list()].sort(), g); assert.ok(near(sum(base.groups[g]), 1), g); }
  assert.ok(LOOK_IDS.every((k) => near(base.groups.look[k], 1 / LOOK_IDS.length)), "every look alike to begin with");
  assert.deepEqual(base.chances, RULES.odds.chances);
  // the user's: a group of theirs made to add up to 1 (an option they left out at 0), one adding up to nothing left to the rule's; their chances kept within 0 and 1
  const mine = oddsOf({ groups: { look: { deco: 3, neon: 1 }, lookFx: { none: 0, one: 0, two: 0 } }, chances: { rail: 1.5, catnamePlate: 0.1, nosuch: 1 } });
  assert.deepEqual([mine.groups.look.deco, mine.groups.look.neon, mine.groups.look.cel], [0.75, 0.25, 0]);
  assert.deepEqual(mine.groups.lookFx, base.groups.lookFx);
  assert.deepEqual([mine.chances.rail, mine.chances.catnamePlate, "nosuch" in mine.chances], [1, 0.1, false]);
  // one set, the others alike the other way, none below 0
  const g = rebalance({ a: 0.25, b: 0.25, c: 0.25, d: 0.25 }, "a", 0.55);
  assert.ok(near(g.a, 0.55) && near(g.b, 0.15) && near(g.c, 0.15) && near(g.d, 0.15) && near(sum(g), 1), JSON.stringify(g));
  const h = rebalance({ a: 0.5, b: 0.45, c: 0.05 }, "a", 0.8);   // c has only 0.05 to give: b gives the rest
  assert.ok(near(h.a, 0.8) && near(h.c, 0) && near(h.b, 0.2) && near(sum(h), 1), JSON.stringify(h));
  const up = rebalance({ a: 1, b: 0, c: 0 }, "a", 0.4);
  assert.ok(near(up.b, 0.3) && near(up.c, 0.3), "what one gives up the others share alike (when none has a chance, all of them)");
  const kept = rebalance({ a: 1 / 3, b: 1 / 3, c: 1 / 3, d: 0, e: 0 }, "a", 0.3);
  assert.ok(kept.d === 0 && kept.e === 0 && near(kept.b, 0.35) && near(kept.c, 0.35), "an option set to 0 stays at 0: " + JSON.stringify(kept));
  // set all the way up in one go, the rest are none at all, not crumbs that would still be dealt
  const all = rebalance(oddsOf().groups.look, "neon", 1);
  assert.ok(LOOK_IDS.every((k) => k === "neon" || all[k] === 0), "no crumbs");
  const { pickLook } = await import("../ui/js/deal.js");
  const crumbs = Object.fromEntries(LOOK_IDS.map((k) => [k, k === "neon" ? 1 : 2e-17]));
  for (let i = 0; i < 6; i++) assert.equal(pickLook(LOOK_IDS, Math.random, crumbs, LOOK_IDS.filter((k) => k !== "cel")), "neon", "a crumb is no chance");
  assert.equal(oddsOf({ groups: { look: crumbs } }).groups.look.cel, 0);
  assert.deepEqual(rebalance({ a: 0.5, b: 0.5 }, "a", 2), { a: 1, b: 0 });
  assert.deepEqual(rebalance({ only: 1 }, "only", 0.3), { only: 1 });
});

test("Surprise me deals a hand by the rules in deal.js: what is locked stays, the words go back, the title on top; RULES decides", async () => {
  const { dealCover, RULES } = await import("../ui/js/deal.js");
  const { LOOK_IDS } = await import("../ui/js/style.js");
  let seed = 11;
  const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const fresh = () => {
    const p = normalizeProfile(sampleProfile("en")), c = normalizeCover({}, p);
    const text = newLayer("text", { text: "hi" }); text.t.all = { ...text.t.all, s: 1.7 }; text.t.by = { "1920x1080": { dx: 9, dy: 0, s: 1, r: 0, kx: 1, ky: 1 } };
    c.layers.push(text);
    c.layers.find((l) => l.id === "title").t.all.s = 2.2;   // the title moved and enlarged by hand
    return { p, c, text, design: new Map(p.design.layers.map((l) => [l.id, l])) };
  };
  const env = (design, more = {}) => ({ R, locks: {}, recipes: {}, rgb: [252, 191, 0], design, sizeKey: "1920x1080", ...more });
  // a free hand: a look, its ground, the title put back and on top, the text layer at a new one's size
  for (let k = 0; k < 20; k++) {
    const { p, c, text, design } = fresh();
    dealCover(p.style, c, env(design));
    assert.ok(LOOK_IDS.includes(p.style.look) && ["dark", "light"].includes(p.style.theme));
    assert.deepEqual(c.layers.find((l) => l.id === "title").t, design.get("title").t, "the title goes back where the design has it");
    assert.equal(c.layers[c.layers.length - 1].type, "title", "the title on top");
    assert.deepEqual([text.t.all.s, text.t.by], [newLayer("text").t.all.s, {}], "a text layer at a new one's size, of no size of its own");
  }
  // locked: the look and its sliders, the ground, the letterings, where things stand
  {
    const { p, c, design } = fresh(), title = c.layers.find((l) => l.id === "title");
    p.style.look = "deco"; p.style.theme = "light"; title.fx = "worn"; const before = JSON.stringify([p.style.lookParams, title.t]);
    dealCover(p.style, c, env(design, { locks: { look: true, theme: true, lettering: true, places: true } }));
    assert.deepEqual([p.style.look, p.style.theme, title.fx, JSON.stringify([p.style.lookParams, title.t])], ["deco", "light", "worn", before]);
  }
  // the looks dealt already in the run wait their turn
  {
    const not = LOOK_IDS.slice(0, 5);
    for (let k = 0; k < 30; k++) { const { p, c, design } = fresh(); dealCover(p.style, c, env(design, { not })); assert.ok(!not.includes(p.style.look)); }
  }
  // the chances are the user's (oddsOf), else RULES': changed there, the hands follow
  const was = RULES.odds.chances.rail;
  try {
    for (const rail of [0, 1]) { RULES.odds.chances.rail = rail; const { p, c, design } = fresh(); dealCover(p.style, c, env(design)); assert.equal(c.layers.find((l) => l.type === "brand").rail, !!rail); }
  } finally { RULES.odds.chances.rail = was; }
  const { oddsOf } = await import("../ui/js/deal.js");
  for (let k = 0; k < 10; k++) {
    const { p, c, design } = fresh();
    dealCover(p.style, c, env(design, { odds: oddsOf({ groups: { look: { neon: 1 }, accent: { wave: 1 } }, chances: { rail: 0 } }) }));
    assert.deepEqual([p.style.look, c.layers.find((l) => l.type === "accent").shape, c.layers.find((l) => l.type === "brand").rail], ["neon", "wave", false]);
  }
});

test("the ground always has its look's backdrop: a cover kept with it off has it back", () => {
  const p = normalizeProfile(sampleProfile("en")), c = normalizeCover({}, p);
  c.layers.find((l) => l.type === "bg").grid = false;
  assert.equal(normalizeCover(JSON.parse(JSON.stringify(c)), p).layers.find((l) => l.type === "bg").grid, true);
});

test("every look's layout meets the cover standards: nothing under the apps' badges, a graphic to look at, room for a title that reads", async () => {
  const { meetStandards, adjustLayout, feedOf, badged, wordsFoot, ART_HALF } = await import("../ui/js/layout.js");
  const { FOOT } = await import("../ui/js/platforms.js");
  const { LIMITS } = await import("../ui/js/check.js");
  for (const id of LOOK_IDS) for (const t of TEMPLATES) for (const [rw, rh] of [[1920, 1080], [1440, 1080], [1080, 1080], [1080, 1440], [1080, 1920], [900, 383]]) for (const flip of [false, true]) {
    const [w, h] = virtualSize(rw, rh), base = LOOKS[id].layout ? LOOKS[id].layout(t, w, h) : layout(t, w, h);
    const g = meetStandards(adjustLayout(base, w, h, { flip }), w, h, { flip }), where = `${id} ${t}${flip ? " flipped" : ""} ${rw}x${rh}`;
    const foot = badged(w, h) ? FOOT * h : h, R = ART_HALF * g.art.s;
    assert.ok(g.art.y - R >= -1 && g.art.x - R >= -1 && g.art.x + R <= w + 1, `${where}: the graphic leaves the canvas`);
    // a colour block the user moved or tilted stays where they put it
    if (!flip) for (const a of [{ size: 0.2 }, { slant: 0.05 }]) assert.deepEqual(meetStandards(adjustLayout(base, w, h, a), w, h, a).accent, adjustLayout(base, w, h, a).accent, `${where} ${JSON.stringify(a)}`);
    const cat = { top: g.cat.y - g.cat.fs * 0.95, foot: g.cat.y + (g.cat.inline ? g.cat.fs * 0.17 : 80) }, tagFoot = g.tag.y + g.tag.fs * 1.34;
    // D1: the words and the graphic above the badges (on a landscape cover), inside the canvas
    assert.ok(cat.foot <= foot && tagFoot <= foot && g.art.y + R <= foot, `${where}: name ${cat.foot}, tag ${tagFoot}, graphic ${g.art.y + R} below ${foot}`);
    // the words out of the bottom 14% on every cover, where the apps show plays and views (above the badges on a landscape one)
    assert.ok(cat.foot <= wordsFoot(w, h) + 0.5 && tagFoot <= wordsFoot(w, h) + 0.5 && wordsFoot(w, h) <= h * 0.86, `${where}: name ${cat.foot}, tag ${tagFoot} below ${wordsFoot(w, h)}`);
    assert.ok(g.title.y + g.title.h <= wordsFoot(w, h) + 0.5, `${where}: the title's box reaches ${g.title.y + g.title.h}`);
    // a cover without a tag: the title keeps the room the tag would take, still above the words' foot (shorter
    // only where, now reaching the graphic, it stops 40 above it as the graphic asks)
    const bare = meetStandards(adjustLayout(base, w, h, { flip }), w, h, { flip }, { tag: false }), bareArt = bare.art.y - ART_HALF * bare.art.s - 40;
    assert.ok(bare.title.y + bare.title.h <= wordsFoot(w, h) + 0.5 && (bare.title.h >= g.title.h || Math.abs(bare.title.y + bare.title.h - bareArt) < 0.5), `${where}: without a tag, the title's box ${bare.title.h} (${g.title.h} with one)`);
    // the tag clear of the channel name, the title clear of the tag
    if (g.tag.y < g.cat.y) assert.ok(tagFoot <= cat.top, `${where}: the tag runs into the channel name`);
    if (g.tag.y > g.title.y) assert.ok(g.title.y + g.title.h <= g.tag.y, `${where}: the title runs into the tag`);
    if (t === "split" || flip) continue;
    // the channel name on the colour block that holds it
    const [A, B] = g.accent, edge = (x) => A[1] + ((B[1] - A[1]) * (x - A[0])) / (B[0] - A[0]);
    assert.ok(Math.max(edge(g.cat.x), edge(g.cat.x + Math.min(g.cat.maxW, w / 2))) <= cat.top, `${where}: the channel name is not on the block`);
    if (t !== "stack") continue;
    // C1: the graphic a big enough share of the canvas, clear of the title's box and of the channel name
    assert.ok((2 * R) ** 2 >= LIMITS.picture * w * h, `${where}: the graphic takes ${((2 * R) ** 2 / (w * h)).toFixed(3)}`);
    const art = { x0: g.art.x - R, y0: g.art.y - R, x1: g.art.x + R, y1: g.art.y + R };
    const meets = (x0, y0, x1, y1) => x0 < art.x1 && x1 > art.x0 && y0 < art.y1 && y1 > art.y0;
    assert.ok(!meets(g.title.x, g.title.y, g.title.x + g.title.w, g.title.y + g.title.h), `${where}: the graphic covers the title's box`);
    assert.ok(!meets(g.cat.x, cat.top, g.cat.x + g.cat.maxW, cat.foot), `${where}: the graphic covers the channel name`);
    // A1: two lines of title at the type size the narrowest feed needs
    const feed = feedOf(w, h);
    if (feed) assert.ok(g.title.h >= 2 * 1.16 * LIMITS.font.ok * (w / feed), `${where}: the title's box is ${Math.round(g.title.h)} high`);
  }
  assert.equal(feedOf(1920, 1080), 168); assert.equal(feedOf(1080, 1440), 128); assert.equal(feedOf(900, 383), 360);
  assert.equal(feedOf(1080, 1350), null);                          // 4:5: no platform here wants it
  assert.ok(badged(1920, 1080) && badged(1600, 1200) && !badged(1200, 1600) && !badged(2538, 1080));   // the article cover has no badges
});

test("a layout gives the room of the parts a cover leaves out to the others, still to the standards", async () => {
  const { meetStandards, adjustLayout, badged, BAND_MIN, SIDE_BARE } = await import("../ui/js/layout.js");
  const { FOOT } = await import("../ui/js/platforms.js");
  const bare = { catname: false, graphic: false };   // a new cover: no channel name, no graphic
  for (const parts of [bare, { catname: false, graphic: true }, { catname: true, graphic: false }])
  for (const id of LOOK_IDS) for (const t of TEMPLATES) for (const [rw, rh] of [[1920, 1080], [1440, 1080], [1080, 1080], [1080, 1440], [1080, 1920], [900, 383]]) for (const flip of [false, true]) {
    const [w, h] = virtualSize(rw, rh), base = LOOKS[id].layout ? LOOKS[id].layout(t, w, h) : layout(t, w, h), a = { flip }, where = `${id} ${t}${flip ? " flipped" : ""} ${rw}x${rh} ${JSON.stringify(parts)}`;
    const full = meetStandards(adjustLayout(base, w, h, a), w, h, a), g = meetStandards(adjustLayout(base, w, h, a), w, h, a, parts);
    const foot = badged(w, h) ? FOOT * h : h, tagFoot = g.tag.y + g.tag.fs * 1.34;
    assert.ok(tagFoot <= foot && g.title.y + g.title.h <= foot, `${where}: tag ${tagFoot}, title ${g.title.y + g.title.h} below ${foot}`);
    if (g.tag.y > g.title.y) assert.ok(g.title.y + g.title.h <= g.tag.y, `${where}: the title runs into the tag`);
    // the title's box no smaller than with every part on; with the graphic still there it may come out
    // narrower but taller, holding two lines of 6 characters no smaller
    const box = `${where}: the title's box ${Math.round(g.title.w)}×${Math.round(g.title.h)}, with every part ${Math.round(full.title.w)}×${Math.round(full.title.h)}`, two = (G) => Math.min(G.title.w / 6, G.title.h / 2.32);
    if (!parts.graphic) assert.ok(g.title.w >= full.title.w - 0.5 && g.title.h >= full.title.h - 0.5, box);
    else assert.ok(two(g) >= two(full) - 0.5, box);
    if (flip) continue;
    if (t === "split" && parts.graphic) continue;
    if (t === "split") {   // the panel narrowed to a band down the side
      const mid = (g.accent[0][0] + g.accent[1][0]) / 2, side = SIDE_BARE[0] + (SIDE_BARE[1] - SIDE_BARE[0]) * Math.min(1, Math.max(0, (w / h - 0.75) / (16 / 9 - 0.75)));
      assert.ok(mid >= Math.min(w * (1 - side), (full.accent[0][0] + full.accent[1][0]) / 2) - 1, `${where}: the panel begins at ${Math.round(mid)}`);
      continue;
    }
    if (parts.catname) continue;
    // the block along the foot no higher than the template's own, nor slimmer than BAND_MIN where that was not already
    const low = (G) => Math.max(G.edge.line[1], G.edge.line[3]), own = adjustLayout(base, w, h, a);
    assert.ok(low(g) >= low(own) - 0.5, `${where}: the block grew`);
    assert.ok(h - low(g) >= Math.min(BAND_MIN * h, h - low(own)) - 1, `${where}: the block is ${Math.round(h - low(g))} high`);
  }
  // a block the user moved stays where they put it, parts or none
  const [w, h] = virtualSize(1920, 1080), base = layout("stack", w, h);
  assert.deepEqual(meetStandards(adjustLayout(base, w, h, { size: 0.3 }), w, h, { size: 0.3 }, bare).accent, adjustLayout(base, w, h, { size: 0.3 }).accent);
  assert.deepEqual(meetStandards(adjustLayout(layout("split", w, h), w, h, { size: 0.4 }), w, h, { size: 0.4 }, bare).accent, adjustLayout(layout("split", w, h), w, h, { size: 0.4 }).accent);
});

test("the brand logo stands at the right end of the brand row, as large as LOGO lets it; and which parts that take room a cover has", async () => {
  const { logoBox, LOGO, partsOf } = await import("../ui/js/render.js");
  const { userAssets } = await import("../ui/js/assets.js");
  userAssets.set("lg", { id: "lg", name: "lg", src: "data:image/png;base64,", img: { naturalWidth: 400, naturalHeight: 100 } });
  const P = { brand: { logo: "lg" } }, b = logoBox(P, 1920);
  assert.equal(Math.round(b.x + b.w), 1920 - 72);                                   // right-aligned with the rail's end
  assert.equal(Math.round(b.h), LOGO.h); assert.equal(Math.round(b.y + b.h / 2), LOGO.mid);
  assert.ok(logoBox(P, 1080).w <= 1080 * LOGO.share + 0.01);                       // a wide one kept to a share of a narrow canvas
  const inset = logoBox(P, 1920, 128);
  assert.equal(Math.round(inset.x + inset.w), 1920 - 128);                          // a look may want it further in
  assert.equal(logoBox({ brand: { logo: "" } }, 1920), null);
  assert.equal(logoBox({ brand: { logo: "gone" } }, 1920), null);                   // its asset deleted: nothing, no error
  userAssets.delete("lg");
  const cover = (offs, subtitle = "", tag = "") => ({ subtitle, tag, layers: ["catname", "graphic", "subtitle", "tag"].map((type) => ({ id: type, type, ...(offs.includes(type) ? { off: true } : {}) })) });
  assert.deepEqual(partsOf(cover([], "A line", "EP.1"), { graphic: { kind: "graphic", id: "camera" } }), { catname: true, graphic: true, subtitle: true, tag: true });
  assert.deepEqual(partsOf(cover(["catname", "graphic", "subtitle", "tag"], "A line", "EP.1"), { graphic: { kind: "graphic", id: "camera" } }), { catname: false, graphic: false, subtitle: false, tag: false });
  assert.deepEqual(partsOf(cover([]), { graphic: { kind: "none" } }), { catname: true, graphic: false, subtitle: false, tag: false });   // a channel without a graphic; a subtitle and a tag with no words
});

test("a profile remembers its untouched covers were given the default tag, so it happens once", () => {
  assert.equal(normalizeProfile({ ...sampleProfile("en"), tagged: true }).tagged, true);
  assert.equal(normalizeProfile(sampleProfile("en")).tagged, undefined);
  assert.equal(normalizeProfile({ ...sampleProfile("en"), tagged: "yes" }).tagged, undefined);
});

test("the subtitle: under the title, smaller, the title making room; giving way first when the title would no longer read", async () => {
  const { titleBlock, subtitleFit } = await import("../ui/js/title.js");
  const { SUB, subtitleSize, titleFloor, meetStandards, adjustLayout, feedOf } = await import("../ui/js/layout.js");
  const ctx = { font: "", save() {}, restore() {}, measureText: (str) => ({ width: String(str).length * 50 }) };
  const box = { x: 100, y: 100, w: 1400, h: 500 }, title = "在这里写标题\n*一行*就是一行";
  const alone = titleBlock(ctx, title, box, "serif"), s = subtitleFit(ctx, title, "在这里写副标题", box, "serif", 1920, 1080);
  const block = titleBlock(ctx, title, box, "serif", 340, s.reserve);
  assert.ok(s.fs <= subtitleSize(alone.fs, 1920, 1080) + 1e-9 && s.fs >= 1080 * SUB.min - 1e-9 && s.fs < block.fs, "smaller than the title");
  assert.ok(Math.abs(s.box.y - (block.y + block.h + s.fs * SUB.gap)) < 1e-9 && s.box.x === box.x && s.box.w === box.w, "a gap under the title's last line");
  assert.ok(Math.abs((block.y - box.y) - (box.y + box.h - (s.box.y + s.box.h))) < 1, "the two centred in the box together");
  assert.ok(block.fs <= alone.fs && block.fs >= Math.min(alone.fs, titleFloor(1920, 1080)) - 1, "the title smaller only as far as it still reads");
  assert.equal(subtitleFit(ctx, title, "  ", box, "serif", 1920, 1080), null);   // no words: no subtitle
  const only = subtitleFit(ctx, "", "副标题", box, "serif", 1920, 1080);             // no title: centred in its box
  assert.ok(only.reserve === 0 && Math.abs(only.box.y + only.box.h / 2 - (box.y + box.h / 2)) < 1e-9);
  // a box too low for both: the subtitle at its smallest, the title what is left
  const low = { ...box, h: 260 }, t = subtitleFit(ctx, title, "副标题", low, "serif", 1920, 1080);
  assert.ok(Math.abs(t.fs - 1080 * SUB.min) < 1e-9);
  // never as large as the title, however small a long line sets it
  const long = "这是一个特别特别特别特别特别特别长的一行标题", narrow = { x: 84, y: 150, w: 912, h: 600 }, n = subtitleFit(ctx, long, "副标题", narrow, "serif", 1080, 1920);
  assert.ok(n.fs <= titleBlock(ctx, long, narrow, "serif", 340, n.reserve).fs * SUB.most + 1e-9, `subtitle ${n.fs}`);
  // what its words fill: their own width, not the box's (looks keep clear of that)
  assert.ok(Math.abs(s.ink.w - (7 * 50 * Math.floor(s.fs)) / 100) < 1e-9 && s.ink.w < s.box.w && s.ink.x === s.box.x);   // set at a whole size, as drawTitle sets it
  // the woodblock look, title in columns: the subtitle a column left of the title's, set at the size it was planned at, smaller
  const { titleBlockVertical } = await import("../ui/js/title.js");
  const [sw, sh] = virtualSize(1200, 1600), env = { w: sw, h: sh, G: layout("stack", sw, sh), cover: { tag: "", layers: [{ type: "title", visible: true }] } };
  const tb = { x: env.G.title.x, y: 150, w: env.G.title.w, h: env.G.title.h + env.G.title.y - 150 };
  const v = LOOKS.songke.subtitleFit(ctx, "在这里写标题\n一行就是一行", "在这里写副标题", tb, env, { vertical: 1 }), vt = titleBlockVertical(ctx, "在这里写标题\n一行就是一行", v.titleBox, "serif", 900, 300);
  assert.ok(v.vertical && Math.abs(titleBlockVertical(ctx, "在这里写副标题", v.box, "serif", 700, v.fs).fs - Math.floor(v.fs)) <= 1, "drawn at its planned size");
  assert.ok(v.fs < vt.fs && v.ink.x + v.ink.w <= vt.x - v.fs * 0.5 && v.ink.x >= tb.x - 1, "left of the title's columns, inside the box");
  assert.equal(LOOKS.songke.subtitleFit(ctx, "a", "b", tb, env, { vertical: 0 }), null);   // a horizontal title: the usual place
  // the layouts leave the title's box room for two lines that read, and the subtitle under them, on a new cover
  const parts = { catname: false, graphic: false, subtitle: true };
  for (const id of LOOK_IDS) for (const tp of TEMPLATES) for (const [rw, rh] of [[1920, 1080], [1440, 1080], [1080, 1080], [1080, 1440], [1080, 1920], [900, 383]]) {
    const [w, h] = virtualSize(rw, rh), base = LOOKS[id].layout ? LOOKS[id].layout(tp, w, h) : layout(tp, w, h), g = meetStandards(adjustLayout(base, w, h, {}), w, h, {}, parts), fsA = titleFloor(w, h);
    if (feedOf(w, h)) assert.ok(g.title.h >= 2 * 1.16 * fsA + subtitleSize(fsA, w, h) * (1.16 + SUB.gap) - 0.5, `${id} ${tp} ${rw}x${rh}: the title's box is ${Math.round(g.title.h)} high`);
  }
  // the words are the cover's, a profile remembers its untouched covers were given the placeholder once
  const P = normalizeProfile(sampleProfile("zh"));
  assert.equal(normalizeCover({ subtitle: "三分钟看懂" }, P).subtitle, "三分钟看懂");
  assert.equal(normalizeCover({}, P).subtitle, "");
  assert.equal(normalizeProfile({ ...sampleProfile("en"), subbed: true }).subbed, true);
  assert.equal(normalizeProfile({ ...sampleProfile("en"), subbed: 1 }).subbed, undefined);
  // the layer: lettered like the title, on in a new design
  const [sub] = normalizeLayers([{ type: "subtitle", fx: "dots", fxAmt: 1.4, bend: "bulge", bendAmt: 1.3, font: "Kaiti", ink: "#FF0000", hi: "#00ff00", plate: true }]).filter((l) => l.type === "subtitle");
  assert.deepEqual([sub.fx, sub.fxAmt, sub.bend, sub.bendAmt, sub.font, sub.ink, sub.hi, sub.plate], ["dots", 1.4, "bulge", 1.3, "Kaiti", "#ff0000", "#00ff00", true]);
  assert.ok(defaultLayers().find((l) => l.type === "subtitle").visible);
});

test("the text warps: each bends the line without tearing it, the way its name says", async () => {
  const { WARP } = await import("../ui/js/textfx.js");
  const o = { fs: 100, amt: 1, lineW: 600 }, at = (id, p, oo = o) => WARP[id](oo)(p);
  const line = []; for (let x = 0; x <= 600; x += 25) for (const y of [-90, -36, 0, 20]) line.push([x, y]);
  for (const id of Object.keys(WARP)) {
    for (const p of line) assert.ok(at(id, p).every(Number.isFinite), `${id}: ${p}`);
    // nearby points stay nearby: nothing torn
    for (const [x, y] of line) { const a = at(id, [x, y]), b = at(id, [x + 1, y]); assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 4, `${id} tears at ${x}, ${y}`); }
  }
  const height = (id, x) => at(id, [x, 0])[1] - at(id, [x, -90])[1];       // how tall a letter stands at x
  assert.ok(at("arcLow", [300, 0])[1] > at("arcLow", [0, 0])[1], "arc down: the middle lower");
  assert.ok(at("arc", [300, 0])[1] < at("arc", [0, 0])[1], "arched: the middle higher");
  assert.ok(height("bulge", 300) > height("bulge", 0) + 20, "bulge: taller in the middle");
  assert.ok(height("pinch", 300) < height("pinch", 0) - 20, "pinch: shorter in the middle");
  assert.ok(at("shell", [300, 0])[1] === 0 && at("shell", [0, 0])[1] === 0 && height("shell", 300) > height("shell", 0) + 20, "arched top: the baseline straight, the tops arching");
  assert.ok(at("rise", [600, 0])[1] < at("rise", [0, 0])[1] - 20 && at("rise", [300, -90])[0] === 300, "rise: climbing, strokes upright");
  const fan = (x) => { const top = at("circle", [x, -90]), foot = at("circle", [x, 0]); return Math.atan2(top[0] - foot[0], foot[1] - top[1]); };
  assert.ok(fan(0) < -0.1 && fan(600) > 0.1 && Math.abs(fan(300)) < 1e-9, "on a circle: the letters fan out");
  assert.ok(Math.hypot(...at("circle", [300, 0]).map((v, i) => v - [300, 0][i])) < 30, "on a circle: the middle stays about where it was");
  assert.ok(height("fisheye", 300) > height("fisheye", 0) + 20 && Math.abs(at("fisheye", [0, 0])[0]) < 15, "fisheye: larger in the middle, the ends about where they were");
  // nothing folds over, nor is squeezed thin: the map keeps its orientation and stretches everything by more than half
  for (let x = 0; x <= 600; x += 3) for (let y = -100; y <= 30; y += 3) {
    const f = WARP.fisheye(o), e = 0.5, p = f([x, y]), px = f([x + e, y]), py = f([x, y + e]);
    assert.ok(((px[0] - p[0]) * (py[1] - p[1]) - (px[1] - p[1]) * (py[0] - p[0])) / (e * e) > 0, `fisheye folds at ${x}, ${y}`);
    assert.ok((px[0] - p[0]) / e > 0.6, `fisheye squeezes at ${x}, ${y}`);
  }
  const swing = (id, from, to) => { let lo = Infinity, hi = -Infinity; for (let x = from; x <= to; x += 5) { const y = at(id, [x, -36])[1]; lo = Math.min(lo, y); hi = Math.max(hi, y); } return hi - lo; };
  assert.ok(swing("flag", 360, 600) > swing("flag", 0, 240) * 1.5, "flag: waving more away from the pole");
  // at no strength, the bends that scale with it leave the line as it is
  for (const id of ["arc", "arcLow", "shell", "bulge", "pinch", "fisheye", "rise", "taper", "wave", "flag"]) for (const p of line) {
    const q = at(id, p, { ...o, amt: 0 }); assert.ok(Math.abs(q[0] - p[0]) < 1e-9 && Math.abs(q[1] - p[1]) < 1e-9, `${id} at 0 moves ${p}`);
  }
});

test("a photo's outline may be dashed: a line of evenly spaced dashes round the shape, a little way out", async () => {
  const { isolines } = await import("../ui/js/render.js");
  const grid = (w, h, f) => { const F = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) F[y * w + x] = f(x, y); return F; };
  // a disc: one closed line, round, at its radius
  const disc = isolines(grid(60, 60, (x, y) => Math.hypot(x - 30, y - 30) - 20), 60, 60);
  assert.equal(disc.length, 1);
  assert.ok(disc[0].every(([x, y]) => Math.abs(Math.hypot(x - 30, y - 30) - 20) < 0.1));
  // two discs apart: two lines; a ring: its outer edge and its hole
  assert.equal(isolines(grid(80, 40, (x, y) => Math.min(Math.hypot(x - 20, y - 20), Math.hypot(x - 60, y - 20)) - 10), 80, 40).length, 2);
  assert.equal(isolines(grid(60, 60, (x, y) => Math.abs(Math.hypot(x - 30, y - 30) - 15) - 5), 60, 60).length, 2);
  // a closed line goes round once, the inside always on the same side
  const d = disc[0], area = d.reduce((s, p, i) => { const q = d[(i + 1) % d.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  assert.ok(Math.abs(Math.abs(area) - Math.PI * 400) < 10);
  // on a photo layer: torn or dashed, not both
  const [a, b, c] = normalizeLayers([{ type: "photo", id: "a", pid: "p", dash: true }, { type: "photo", id: "b", pid: "p", dash: true, torn: true }, { type: "photo", id: "c", pid: "p", dash: "yes" }]).filter((l) => l.type === "photo");
  assert.deepEqual([a.dash, b.dash, b.torn, c.dash], [true, false, true, false]);
});

test("a bend goes with any lettering: painted as it is, then the picture bent, the size fitting what the bent lines reach", async () => {
  const { BENDS, EFFECTS, WARP, meshWarp, bendExtent } = await import("../ui/js/textfx.js");
  const { BEND_IDS } = await import("../ui/js/layers.js");
  const { titleBlock, subtitleFit } = await import("../ui/js/title.js");
  assert.deepEqual(Object.keys(BENDS), BEND_IDS);
  assert.deepEqual(Object.keys(BENDS).sort(), Object.keys(WARP).sort());          // each a map
  assert.ok(BEND_IDS.every((id) => !(id in EFFECTS)), "no bend is a lettering of its own any more");
  // read from a file: a bend of before (an effect, in the house lettering) is that lettering bent
  const [a, b, c, d] = normalizeLayers([
    { type: "title", fx: "arc", fxAmt: 1.4 },
    { type: "text", id: "t1", text: "x", fx: "taper", warp: [[0, 0], [0, 0.2], [0, -0.2], [0, 0]] },
    { type: "text", id: "t2", text: "y", fx: "dots", fxAmt: 0.8, bend: "wave", bendAmt: 1, warp: [[0, 0], [0, 0.2], [0, -0.2], [0, 0]] },
    { type: "subtitle", bend: "nope", bendAmt: 9 },
  ]).filter((l) => ["title", "text", "subtitle"].includes(l.type));
  assert.deepEqual([a.fx, a.fxAmt, a.bend, a.bendAmt], ["cel", undefined, "arc", 1.4]);
  assert.deepEqual([b.fx, b.bend, b.warp.length], ["cel", "taper", 4]);                          // its own corners kept
  assert.deepEqual([c.fx, c.fxAmt, c.bend, c.bendAmt, c.warp], ["dots", 0.8, "wave", undefined, undefined]);   // corners only for the perspective
  assert.deepEqual([d.bend, d.bendAmt], [undefined, undefined]);
  // the picture bent: as it was under no bend, moved under a move, and an edge half seen keeps its colour
  const w = 40, h = 20, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 4; y < 16; y++) for (let x = 8; x < 32; x++) { const q = (y * w + x) * 4; px[q] = 255; px[q + 3] = x === 8 ? 128 : 255; }
  const rect = { x: -5, y: -5, w: 20, h: 10 }, same = meshWarp({ data: px, width: w, height: h }, rect, 2, (p) => p, 8);
  assert.deepEqual([same.width, same.height, same.rect], [w, h, rect]);
  assert.ok(px.every((v, i) => v === same.data[i]), "no bend, the same picture");
  const moved = meshWarp({ data: px, width: w, height: h }, rect, 2, ([x, y]) => [x + 3, y - 1], 8);
  assert.deepEqual(moved.rect, { x: -2, y: -6, w: 20, h: 10 });
  const half = meshWarp({ data: px, width: w, height: h }, rect, 2, ([x, y]) => [x * 1.3, y], 8);   // stretched: the edge sampled between pixels
  for (let i = 0; i < half.data.length; i += 4) if (half.data[i + 3] > 0) assert.ok(half.data[i] === 255 && half.data[i + 1] === 0, "no dark fringe");
  // how far a bend reaches past the line's box, and the title fitting it
  const e = bendExtent("arc", 1, 600, 100);
  assert.ok(e.up > 10 && e.down > 5 && e.left === 0 && e.right === 0);
  assert.deepEqual(bendExtent("rise", 0, 600, 100), { up: 0, down: 0, left: 0, right: 0 });
  const ctx = { font: "", save() {}, restore() {}, measureText: (str) => ({ width: String(str).length * 50 }) };
  const box = { x: 100, y: 100, w: 1200, h: 400 }, title = "在这里写标题\n一行就是一行";
  for (const id of BEND_IDS.filter((x) => x !== "taper")) {
    const flat = titleBlock(ctx, title, box, "serif"), bent = titleBlock(ctx, title, box, "serif", 340, 0, { id, amt: 1.6 });
    assert.ok(bent.fs <= flat.fs && bent.x >= box.x - 1e-9 && bent.y >= box.y - 1e-9 && bent.x + bent.w <= box.x + box.w + 1e-9 && bent.y + bent.h <= box.y + box.h + 1e-9, `${id}: the bent title leaves its box`);
  }
  const own = titleBlock(ctx, title, box, "serif", 340, 0, { id: "taper", amt: 1, own: true });
  assert.equal(own.fs, titleBlock(ctx, title, box, "serif").fs);                    // a perspective of the layer's own: the user places it
  // the subtitle under what the bent title reaches
  const sb = subtitleFit(ctx, title, "副标题", box, "serif", 1920, 1080, 340, { id: "arc", amt: 1.6 }), tb = titleBlock(ctx, title, box, "serif", 340, sb.reserve, { id: "arc", amt: 1.6 });
  assert.ok(sb.box.y >= tb.y + tb.h - 1e-9);
  // a wide line over a short one: what the wide one's ends reach below counts, not only the last line's
  const wide = titleBlock(ctx, "一二三四五六七八九十".repeat(4) + "\n短", box, "serif", 340, 0, { id: "circle", amt: 2 }), k = wide.fs / 100;
  const e0 = bendExtent("circle", 2, 2000, 100), e1 = bendExtent("circle", 2, 50, 100);
  assert.ok(e0.down - 116 > e1.down, "the case: the first line's ends hang past the last line");
  assert.ok(Math.abs(wide.h / k - (2 * 116 + Math.max(e0.up, e1.up - 116) + Math.max(e0.down - 116, e1.down))) < 1e-6);
});

test("highlighted words may be marked as well as coloured: plates, or a ring, a marker's band, an offset block", async () => {
  const { HI_MARKS } = await import("../ui/js/layers.js");
  assert.deepEqual(HI_MARKS, ["circle", "marker", "block"]);
  const [t, s, a, b, c] = normalizeLayers([
    { type: "title", hiMark: "circle" },
    { type: "subtitle", hiMark: "marker", hiPlateInk: "#FF0000" },
    { type: "text", id: "a", text: "x", hiMark: "block" },
    { type: "text", id: "b", text: "y", hiPlate: true, hiMark: "circle" },   // plates win: one mark at a time
    { type: "text", id: "c", text: "z", hiMark: "glow" },
  ]).filter((l) => ["title", "subtitle", "text"].includes(l.type));
  assert.deepEqual([t.hiMark, s.hiMark, s.hiPlateInk, a.hiMark], ["circle", "marker", "#ff0000", "block"]);
  assert.deepEqual([b.hiPlate, b.hiMark, c.hiMark], [true, undefined, undefined]);
});

test("a line set as a typesetter would: Latin beside CJK as tall, CJK punctuation squeezed (Kaiming style)", async () => {
  const { setLine, passOf, hasCJK, parseTitle } = await import("../ui/js/title.js");
  // a font at 100px: ideographs 100 wide, 82 up and 9 down; Latin 50 wide, capitals 70 up; the marks' ink as Noto Sans SC has it
  const INK = { "，": [17.7, 42.6], "。": [2.6, 36], "「": [63.5, 97.5], "」": [2.5, 36.5], "？": [3.2, 47.6], "！": [14.8, 35.2], "“": [59.4, 98.2], "”": [1.8, 40.6] };
  const ctx = {
    font: "900 100px Test", measureText(t) {
      const one = [...t], width = one.reduce((s, ch) => s + (/[　-鿿＀-￯“”]/.test(ch) ? 100 : 50), 0);
      if (one.length === 1 && INK[t]) return { width, actualBoundingBoxLeft: -INK[t][0], actualBoundingBoxRight: INK[t][1], actualBoundingBoxAscent: 30, actualBoundingBoxDescent: 10 };
      return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: t === "H" ? 70 : 82, actualBoundingBoxDescent: t === "H" ? 0 : 9 };
    },
  };
  const set = (title) => { const lines = parseTitle(title); return setLine(ctx, lines[0], hasCJK(lines)); };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  // Latin beside CJK: capitals 0.86 of the ideographs' ink height, centred on them; the runs kept for what goes under them
  const ai = set("*AI*国"), s = (0.86 * 91) / 70;
  assert.deepEqual(ai.pieces.map((p) => p.t), ["AI", "国"]);
  assert.ok(near(ai.pieces[0].s, s) && near(ai.pieces[0].dy, (s * 70 - 73) / 2) && near(ai.pieces[1].x, 100 * s) && near(ai.width, 100 * s + 100));
  assert.deepEqual(ai.runs.map((r) => r.hi), [true, false]);
  assert.equal(set("AI GO").pieces[0].s, 1, "no CJK in the title: Latin as it is");
  // an opening mark first and a closing one last give up their blank
  const quoted = set("「重磅」");
  assert.ok(near(quoted.pieces[0].x, -(63.5 - 6)) && near(quoted.width, 400 - 57.5 - 57.5));
  // two marks in a row: half an em between them goes; a sentence's end keeps its width within the line
  const both = set("真的吗？！太");
  const bang = both.pieces.find((p) => p.t.startsWith("！"));
  assert.ok(bang && near(bang.x, 400 - 50), "？！ closer by half an em");
  assert.ok(near(both.width, 600 - 50), "！ within the line: full width");
  // a comma within the line is set half, keeping as much blank after it as before
  const comma = set("秘密，都");
  const du = comma.pieces.find((p) => p.t === "都");
  assert.ok(near(du.x, 300 - (57.4 - 17.7)));
  // what is drawn under a whole run (a plate, a mark) lies over its lettering, not the blank given up
  const opened = set("*「重磅」*消息");
  assert.ok(near(opened.runs[0].x0, 0) && near(opened.runs[0].x1, opened.pieces.find((p) => p.t === "消息").x), JSON.stringify(opened.runs));
  const closed = set("*重磅，*消息"), xiao = closed.pieces.find((p) => p.t === "消息");
  assert.ok(near(closed.runs[0].x1, xiao.x) && closed.pieces.every((p) => p.run === closed.runs[p.ri]));
  const split = set("*AI时代*来了");   // a run cut where the script changes: its pieces share the run's extent, the first one marking it
  assert.deepEqual(split.pieces.map((p) => [p.t, p.first]), [["AI", true], ["时代", false], ["来了", true]]);
  assert.ok(split.pieces[0].run === split.pieces[1].run && near(split.runs[0].x0, 0) && near(split.runs[0].x1, split.pieces[2].x));
  // full-width Latin is CJK-sized already; a keycap or an accented letter stays whole
  assert.equal(set("ＡＩ国").pieces.length, 1);
  assert.deepEqual(set("1\uFE0F\u20E3国").pieces.map((p) => p.t), ["1\uFE0F\u20E3", "国"]);
  // pass hands the pieces over at their places
  const seen = []; passOf(comma)((p, x) => seen.push([p.t, x]));
  assert.deepEqual(seen.map((v) => v[0]), comma.pieces.map((p) => p.t));
  // without real metrics (a test double), as the canvas sets it: one piece a run
  const plain = setLine({ font: "x", measureText: (t) => ({ width: [...t].length * 50 }) }, parseTitle("「重磅」*AI*")[0], true);
  assert.deepEqual([plain.pieces.length, plain.width], [2, 300]);
});

test("sticker lettering: a hard shadow, a dark line, a white rim and a keyline under the letters, strokes alone", async () => {
  const { paintRuns, EFFECTS } = await import("../ui/js/textfx.js");
  const { INK } = await import("../ui/js/style.js");
  assert.equal(EFFECTS.sticker.kind, "passes");
  const [L] = normalizeLayers([{ type: "text", id: "s", text: "x", fx: "sticker" }]).filter((l) => l.type === "text");
  assert.equal(L.fx, "sticker");
  const calls = [], ctx = { lineWidth: 1, save() {}, restore() {}, strokeText(t, x, y) { calls.push(["stroke", this.strokeStyle, this.lineWidth, x, y]); }, fillText(t, x, y) { calls.push(["fill", this.fillStyle, x, y]); } };
  paintRuns(ctx, (fn) => fn({ t: "AB", hi: false }, 0), { fs: 100, d: 6, strokeAmt: 1, fillCss: "#fff", inkCss: "#000", shadowCss: "#fc0", hiCss: "#f00", hiShadowCss: "#a00" }, "sticker");
  const strokes = calls.filter((c) => c[0] === "stroke");
  assert.deepEqual(strokes.map((c) => c[1]), ["#fc0", INK, "#ffffff", "#000"]);                   // from the bottom up
  assert.ok(strokes[0][2] === strokes[1][2] && strokes[1][2] > strokes[2][2] && strokes[2][2] > strokes[3][2]);
  assert.ok(strokes[0][3] > 0 && strokes[0][4] > 0 && strokes.slice(1).every((c) => c[3] === 0 && c[4] === 0));   // only the shadow is moved
  assert.deepEqual(calls.at(-1), ["fill", "#fff", 0, 0]);                                              // the letters on top
});

test("every bend can be reshaped by its handles: the edge under a handle goes where it was dragged, the rest smoothly", async () => {
  const { bendMap, bendRest, reshapeField, reshaped, WARP } = await import("../ui/js/textfx.js");
  const box = { x: 40, y: 20, w: 600, h: 120 };
  // nothing dragged, nothing moved; one handle dragged: the edge there by as much, the other handles not at all
  const none = reshapeField(Array.from({ length: 8 }, () => [0, 0]), box);
  assert.deepEqual(none(300, 50), [0, 0]);
  const d = Array.from({ length: 8 }, () => [0, 0]); d[1] = [0.05, -0.5];
  const one = reshapeField(d, box);
  const near = (a, b, e = 1e-9) => Math.abs(a[0] - b[0]) < e && Math.abs(a[1] - b[1]) < e;
  assert.ok(near(one(box.x + box.w / 3, box.y), [30, -60]));
  for (const i of [0, 2, 3]) assert.ok(near(one(box.x + (i * box.w) / 3, box.y), [0, 0]), `top handle ${i} stays`);
  for (let i = 0; i < 4; i++) assert.ok(near(one(box.x + (i * box.w) / 3, box.y + box.h), [0, 0]), `bottom handle ${i} stays`);
  assert.ok(near(one(box.x + box.w / 3, box.y + box.h / 2), [15, -30]));                    // between the edges, in proportion
  assert.ok(Math.abs(one(box.x + box.w * 0.85, box.y)[1]) < 60 * 0.1, "the far end hardly stirs");
  // a line of a block, slanted, bent and reshaped: its top-edge points land on the handles
  const fs = 100, c = -0.08, line = { ox: box.x + 4, oy: box.y + 92, lineW: box.w - 8 }, bend = { id: "arc", amt: 1.2 };
  const rest = bendRest(bend, fs, c, box, line, line), dd = Array.from({ length: 8 }, (_, i) => [0.02 * i, -0.1 * (i % 3)]), at = reshaped(rest, dd, box);
  const map = bendMap("arc", { fs, amt: 1.2, lineW: line.lineW, frame: { ox: line.ox, oy: line.oy, c, box }, reshape: dd }), plain = WARP.arc({ fs, amt: 1.2, lineW: line.lineW });
  for (let i = 0; i < 4; i++) {
    const Y = box.y, y = Y - line.oy, x = box.x + (i * box.w) / 3 - line.ox - c * y, [x2, y2] = map([x, y]);
    assert.ok(near([line.ox + x2 + c * y2, line.oy + y2], at[i], 1e-6), `top handle ${i}`);
    const [px, py] = plain([x, y]);
    assert.ok(near([line.ox + px + c * py, line.oy + py], rest[i], 1e-6), `rest ${i}`);
  }
  // the perspective keeps its four corners; a reshape is kept for any other bend, and only when something was dragged
  const [a, b, e] = normalizeLayers([
    { type: "text", id: "r1", text: "x", bend: "wave", reshape: dd },
    { type: "text", id: "r2", text: "y", bend: "taper", reshape: dd },
    { type: "text", id: "r3", text: "z", bend: "arc", reshape: Array.from({ length: 8 }, () => [0, 0]) },
  ]).filter((l) => l.type === "text");
  assert.deepEqual([a.reshape.length, b.reshape, e.reshape], [8, undefined, undefined]);
});

test("a bend keeps to the picture it is given: nothing thrown far past the line, a folded perspective not made huge", async () => {
  const { meshWarp, bendMap, convexWarp } = await import("../ui/js/textfx.js");
  // the picture as bentLine makes it: the line with room round it, all of it inked (a glow filling the room)
  const shot = (o, k) => {
    const P = o.fs * 0.75, rect = { x: -P, y: -o.fs * 1.25 - P, w: o.lineW + 2 * P, h: o.fs * 1.7 + 2 * P }, w = Math.ceil(rect.w * k), h = Math.ceil(rect.h * k), px = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    return { src: { data: px, width: w, height: h }, rect };
  };
  // a line as short as "I": past its ends a bend keeps the ends' shape rather than flipping or flinging the room round it
  for (const id of ["arc", "arcLow", "shell", "bulge", "pinch", "taper", "circle"]) {
    const o = { fs: 120, lineW: 36, amt: 2 }, { src, rect } = shot(o, 1), out = meshWarp(src, rect, 1, bendMap(id, o), 13);
    assert.ok(out.height <= src.height * 2 && out.width <= src.width * 3, `${id}: ${out.width}×${out.height} from ${src.width}×${src.height}`);
  }
  // corners dragged until the block folds over: the result made coarser, never too large to make
  const o = { fs: 150, lineW: 800, amt: 1, warp: [[0, 0], [0, 0], [0, 0], [0.9, -0.5]], frame: { ox: 0, oy: 0, c: 0, box: { x: 0, y: -138, w: 800, h: 176 } } };
  const { src, rect } = shot(o, 0.5), out = meshWarp(src, rect, 0.5, bendMap("taper", o), 8);
  assert.ok(out.width <= 8192 && out.height <= 8192 && out.width * out.height <= 24e6, `${out.width}×${out.height}`);
  // and dragging a corner stops before it folds
  assert.ok(convexWarp([[0, 0], [0, 0.4], [0, -0.4], [0, 0]]) && convexWarp([[0, 0], [-0.05, 0.35], [0.08, -0.1], [0.04, 0]]));
  assert.ok(!convexWarp([[0, 0], [0, 0.48], [0, -0.48], [0, 0]]), "an edge shrunk to about a point");
  assert.ok(!convexWarp(o.warp) && !convexWarp([[0, 1.5], [0, 0], [0, 0], [0, 0]]) && !convexWarp([[0, 0], [0, 0.5], [0, -0.5], [0, 0]]));
});

test("a layout layer but the ground and the corner brackets can be copied: a layer of its type, the user's, which the layout's order, parts and lookups pass by", async () => {
  const { COPYABLE, isAdded, isLayout, isRemovable, layoutOrder, orderLayout, copyFreeLayers } = await import("../ui/js/layers.js");
  const { partsOf } = await import("../ui/js/render.js");
  const { dealCover } = await import("../ui/js/deal.js");
  assert.deepEqual(COPYABLE, BOUND_TYPES.filter((t) => t !== "bg" && t !== "frame"));
  const ls = normalizeLayers(defaultLayers()), by = (id) => ls.find((l) => l.id === id);
  assert.equal(duplicate(by("bg")), null);
  assert.equal(duplicate(by("frame")), null);
  Object.assign(by("title"), { stroke: 1.6, fx: "ransom", fxSeed: 7 }); by("title").t.all.x = 0.1;
  const c = duplicate(by("title"));
  assert.ok(c.copy && c.type === "title" && c.id !== "title" && c.stroke === 1.6 && c.fx === "ransom" && c.fxSeed === 7, "the same type and style, an id of its own");
  assert.ok(Math.abs(c.t.all.x - 0.13) < 1e-9 && Math.abs(c.t.all.y - 0.03) < 1e-9, "placed as the layout layers are, nudged");
  const g = duplicate(by("graphic"));   // left out of a new design (DEFAULT_OFF): its copy comes in
  assert.ok(g.copy && !g.off && g.visible);
  assert.ok(isAdded(c) && isRemovable(c) && !isLayout(c) && isLayout(by("title")) && !isAdded(by("title")) && !isRemovable(by("title")));
  assert.ok(duplicate(c).copy && duplicate(c).id !== c.id, "a copy copied again");
  ls.splice(ls.indexOf(by("title")) + 1, 0, c); ls.push(g);
  assert.deepEqual(layoutOrder(ls), BOUND_TYPES, "the layout's order passes copies by");
  // re-ordered, a copy goes with the layout layer it lies over, as an added layer does
  assert.ok(orderLayout(ls, ["bg", "title", ...BOUND_TYPES.filter((t) => t !== "bg" && t !== "title")]));
  assert.deepEqual(ls.slice(1, 3).map((l) => l.id), ["title", c.id]);
  // read back: kept under its id; one claiming a layout layer's id, or left out, or of the ground, is read as a copy, in, or not a copy
  const back = normalizeLayers(JSON.parse(JSON.stringify([...ls, { ...c, id: "title", off: true }, { type: "bg", copy: true }])));
  const copies = back.filter((l) => l.copy);
  assert.equal(copies.length, 3);
  assert.ok(copies.some((l) => l.id === c.id) && copies.every((l) => !BOUND_TYPES.includes(l.id) && !l.off));
  assert.equal(back.filter((l) => l.id === "title" && !l.copy).length, 1, "the title is still the title");
  assert.equal(back.filter((l) => l.type === "bg").length, 1);
  // which parts take room: the layout's own, not a copy's
  const parts = (layers) => partsOf({ subtitle: "", tag: "EP.1", layers }, { graphic: { kind: "graphic", id: "camera" } });
  const off = normalizeLayers(defaultLayers()), tag = off.find((l) => l.id === "tag");
  tag.off = true; tag.visible = false;
  const tagCopy = duplicate(tag); off.push(tagCopy);
  assert.equal(parts(off).tag, false);
  // copied to another cover with the layers the user added, over the layout layer it lay over there
  const { layers: into, copies: made } = copyFreeLayers(normalizeLayers(defaultLayers()), ls);
  assert.deepEqual(made.map((l) => [l.type, !!l.copy]), [["title", true], ["graphic", true]]);
  assert.ok(into[into.findIndex((l) => l.id === "title") + 1] === made[0] && made.every((l) => l.id !== c.id && l.id !== g.id));
  // Surprise me leaves a copy where it is, and keeps the title over everything (not the copy)
  const p = normalizeProfile(sampleProfile("en")), cover = normalizeCover({}, p), design = new Map(p.design.layers.map((l) => [l.id, l]));
  const tc = duplicate(cover.layers.find((l) => l.id === "title")); tc.t.all.y = 0.4;
  cover.layers.push(tc);
  let seed = 3;
  dealCover(p.style, cover, { R: () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648), locks: {}, recipes: {}, rgb: [252, 191, 0], design, sizeKey: "1920x1080" });
  assert.equal(tc.t.all.y, 0.4);
  assert.equal(cover.layers.at(-1).id, "title");
});

test("a photo may be cropped: kept within the picture, dragged by its sides and corners at a shape of its own or free, fitted to a shape", async () => {
  const { normalizeCrop, dragCrop, drawnCrop, fitCrop } = await import("../ui/js/layers.js");
  const near = (a, b) => ["x", "y", "w", "h"].every((k) => Math.abs(a[k] - b[k]) < 1e-6);
  // read: within the picture, at least 2% each way, rounded; the whole picture is no crop
  assert.equal(normalizeCrop(null), null);
  assert.equal(normalizeCrop({ x: 0, y: 0, w: 1, h: 1 }), null);
  assert.deepEqual(normalizeCrop({ x: 0.25, y: 0.1, w: 0.5249999999999999, h: 0.7 }), { x: 0.25, y: 0.1, w: 0.525, h: 0.7 });
  assert.deepEqual(normalizeCrop({ x: 0.9, y: -1, w: 0.5, h: 0 }), { x: 0.9, y: 0, w: 0.1, h: 0.02 });
  assert.deepEqual(normalizeCrop({ x: "a", y: 0.5, w: 2, h: 0.5 }), { x: 0, y: 0.5, w: 1, h: 0.5 });
  const L = normalizeLayers([{ type: "photo", pid: "p1", crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }, { type: "photo", pid: "p2", crop: { x: 0, y: 0, w: 1, h: 1 } }]).filter((l) => l.type === "photo");
  assert.deepEqual([L[0].crop, "crop" in L[1]], [{ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, false]);
  // dragged: moved within the picture; a side or a corner, free
  const c = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
  assert.ok(near(dragCrop(c, "move", 0.1, -0.05), { x: 0.3, y: 0.15, w: 0.4, h: 0.4 }));
  assert.ok(near(dragCrop(c, "move", 0.9, -0.9), { x: 0.6, y: 0, w: 0.4, h: 0.4 }), "stops at the picture's edge");
  assert.ok(near(dragCrop(c, "w", -0.1, 0.3), { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }));
  assert.ok(near(dragCrop(c, "se", 0.1, 0.2), { x: 0.2, y: 0.2, w: 0.5, h: 0.6 }));
  assert.ok(near(dragCrop(c, "nw", 0.5, 0.5), { x: 0.58, y: 0.58, w: 0.02, h: 0.02 }), "never smaller than 2%");
  assert.ok(near(dragCrop(c, "e", 0.9, 0), { x: 0.2, y: 0.2, w: 0.8, h: 0.4 }), "nor out of the picture");
  // at a shape: a corner keeps it from the corner across, a side about the middle of the side across
  for (const [h, dx, dy] of [["se", 0.2, 0.05], ["nw", -0.1, -0.15], ["ne", 0.3, 0.3], ["sw", -0.05, 0.1], ["e", 0.15, 0], ["n", 0, -0.12], ["s", 0, 0.3], ["w", -0.3, 0]]) {
    for (const ratio of [1, 0.5625, 2]) {
      const d = dragCrop(c, h, dx, dy, ratio);
      assert.ok(Math.abs(d.w / d.h - ratio) < 1e-9, `${h} keeps ${ratio}`);
      assert.ok(d.x >= -1e-9 && d.y >= -1e-9 && d.x + d.w <= 1 + 1e-9 && d.y + d.h <= 1 + 1e-9, `${h} at ${ratio} stays within the picture`);
      if (h === "se") assert.ok(near({ x: d.x, y: d.y, w: 0, h: 0 }, { x: 0.2, y: 0.2, w: 0, h: 0 }), "the corner across stays put");
      if (h === "e") assert.ok(Math.abs(d.y + d.h / 2 - 0.4) < 1e-9 && Math.abs(d.x - 0.2) < 1e-9, "about the middle, the side across put");
    }
  }
  // drawn anew outside the frame: from where it was pressed toward the pointer, any way, within the picture
  assert.ok(near(drawnCrop({ x: 0.5, y: 0.5 }, { x: 0.2, y: 0.1 }), { x: 0.2, y: 0.1, w: 0.3, h: 0.4 }), "up and to the left too");
  assert.ok(near(drawnCrop({ x: 0.5, y: 0.5 }, { x: 0.9, y: 0.6 }, 2), { x: 0.5, y: 0.5, w: 0.4, h: 0.2 }));
  const out = drawnCrop({ x: 0.8, y: 0.8 }, { x: 1.5, y: 0.9 }, 1);
  assert.ok(Math.abs(out.w / out.h - 1) < 1e-9 && out.x + out.w <= 1 + 1e-9 && out.y + out.h <= 1 + 1e-9, "at its shape, stopped by the picture's edge");
  // fitted to a shape: as large as the crop was (no larger than the picture holds), about its middle, within the picture
  assert.ok(near(fitCrop(c, 1), c), "already of that shape");
  const half = fitCrop(c, 0.5);
  assert.ok(Math.abs(half.w * half.h - 0.16) < 1e-9 && Math.abs(half.w / half.h - 0.5) < 1e-9 && Math.abs(half.x + half.w / 2 - 0.4) < 1e-9 && Math.abs(half.y + half.h / 2 - 0.4) < 1e-9);
  const edge = fitCrop({ x: 0.7, y: 0.1, w: 0.3, h: 0.2 }, 2);
  assert.ok(Math.abs(edge.w / edge.h - 2) < 1e-9 && Math.abs(edge.x + edge.w - 1) < 1e-9 && edge.y >= 0, "kept within the picture");
  assert.ok(near(fitCrop({ x: 0, y: 0, w: 1, h: 1 }, 1), { x: 0, y: 0, w: 1, h: 1 }) && near(fitCrop({ x: 0, y: 0, w: 1, h: 1 }, 0.75), { x: 0.125, y: 0, w: 0.75, h: 1 }), "from the whole picture: the largest of that shape");
});

test("reshaped edges: points along each outline, corners kept, normals away from the ink; each letter's edge its own, the same every time", async () => {
  const { walk, areaOf, weighOf, SHAPED, EFFECTS, effectReach } = await import("../ui/js/textfx.js");
  const { hash, seeded } = await import("../ui/js/ransom.js");
  // a letter: a square 100 wide with a square hole, as fonts have them (the hole running the other way)
  const outer = [[0, 0], [100, 0], [100, -100], [0, -100]], hole = [[30, -30], [30, -70], [70, -70], [70, -30]];
  const side = Math.sign(areaOf(outer));
  assert.equal(Math.sign(areaOf(hole)), -side);
  const w = walk(outer, 10, side);
  assert.ok(Math.abs(w.len - 400) < 1e-9 && w.length === 40);
  for (const [x, y] of outer) assert.ok(w.some((p) => p.x === x && p.y === y), `corner ${x},${y} kept`);
  const inside = (x, y) => x > 0 && x < 100 && y < 0 && y > -100;
  assert.ok(w.every((p) => Math.abs(Math.hypot(p.nx, p.ny) - 1) < 1e-9 && !inside(p.x + p.nx * 5, p.y + p.ny * 5)), "outward round the outer edge");
  const wh = walk(hole, 5, side);
  assert.ok(wh.every((p) => { const x = p.x + p.nx * 3, y = p.y + p.ny * 3; return x > 30 && x < 70 && y < -30 && y > -70; }), "into the hole round a hole");
  assert.equal(walk([[0, 0], [1, 1]], 1, 1), null);
  // every reshaping effect: seeded, so the same letter comes out the same, another seed otherwise; numbers all
  // a letter's weight: its strokes' mean width against a bold Latin letter's, 0.4 to 1
  const weight = weighOf([outer, hole], 100);
  assert.deepEqual(weight, { side, k: 1 });   // strokes 30 wide: heavy
  const thin = [[0, 0], [100, 0], [100, -4], [0, -4]];
  assert.equal(weighOf([thin], 100).k, 0.4);   // a hairline: as light as it goes
  assert.equal(weighOf([thin.slice().reverse()], 100).side, -Math.sign(areaOf(thin)));
  const g = { ch: "A", shapes: [outer, hole], x0: 0, x1: 100, ...weight }, o = { fs: 100, amt: 1, row: 0 };
  const R = (n) => seeded(hash(`0|0|A|${n}`));
  const flat = (shapes) => shapes.flat(2);
  for (const id of Object.keys(SHAPED)) {
    assert.ok(EFFECTS[id] && EFFECTS[id].kind === "outline" && EFFECTS[id].seeded, `${id} is an outline effect Reshuffle deals again`);
    const a = SHAPED[id].shape(g, R(1), o), b = SHAPED[id].shape(g, R(1), o), c = SHAPED[id].shape(g, R(2), o);
    assert.equal(a.length, 2, `${id}: an outline for each`);
    assert.deepEqual(a, b, `${id}: the same every time`);
    assert.notDeepEqual(a, c, `${id}: another for another seed`);
    assert.ok(flat(a).every(Number.isFinite), `${id}: numbers`);
    assert.ok(a.every((pts) => pts.length >= 3), `${id}: closed shapes`);
    const none = SHAPED[id].shape(g, R(1), { ...o, amt: 0 });
    if (id !== "cut") assert.ok(flat(none).every((v) => v >= -100 - 1e-6 && v <= 100 + 1e-6) && none[0].every(([x, y]) => x >= -1e-6 && x <= 100 + 1e-6 && y <= 1e-6 && y >= -100 - 1e-6), `${id}: at no strength, the letter as it was`);
  }
  const xs = (shapes) => shapes[0].map((p) => p[0]), ys = (shapes) => shapes[0].map((p) => p[1]);
  const spiky = SHAPED.spiky.shape(g, R(1), o);
  assert.ok(Math.min(...xs(spiky)) < -5 && Math.max(...xs(spiky)) > 105 && Math.min(...ys(spiky)) < -105, "spikes out of every side");
  // into the hole, 40 across: never more than about half the way over it, so spikes from facing sides do not meet
  assert.ok(spiky[1].every(([x, y]) => x >= 30 - 1e-6 && x <= 70 + 1e-6 && y <= -30 + 1e-6 && y >= -70 - 1e-6), "the hole's spikes stay in the hole");
  assert.ok(spiky[1].every(([x, y]) => Math.min(x - 30, 70 - x, -30 - y, y + 70) <= 40 * 0.45 + 1e-6), "and short of its middle");
  const eroded = SHAPED.eroded.shape(g, R(1), o);
  assert.ok(eroded[0].every(([x, y]) => x >= -1e-6 && x <= 100 + 1e-6 && y <= 1e-6 && y >= -100 - 1e-6) && eroded[0].some(([x, y]) => inside(x, y)), "bitten into, never out");
  const melt = SHAPED.melt.shape(g, R(1), o);
  assert.ok(Math.max(...ys(melt)) > 10 && Math.min(...ys(melt)) >= -100 - 1e-6, "running down below its foot, the top as it was");
  // how far past the type they reach, for the box the lettering is caught by: drips below only, none for the rest
  assert.deepEqual(effectReach("eroded"), { x: 0, up: 0, down: 0 });
  assert.deepEqual(effectReach("plain"), { x: 0, up: 0, down: 0 });
  assert.ok(effectReach("melt", 2).down > effectReach("melt").down && effectReach("melt").up === 0 && effectReach("spiky").up > 0);
  assert.ok(Math.max(...ys(melt)) <= effectReach("melt").down * 100 + 1e-6 && Math.max(...xs(spiky)) - 100 <= effectReach("spiky").x * 100 + 1e-6, "and no further");
  const torn = SHAPED.torn.shape(g, R(1), o);
  assert.ok(torn[0].some(([x, y]) => inside(x, y)) && torn[0].some(([x, y]) => !inside(x, y) && (x < -0.5 || x > 100.5 || y > 0.5 || y < -100.5)), "in and out");
});

test("weaving: a cut-out keeps which lettering it weaves with, how, where its head ends and the letters in front, cleaned and bounded", async () => {
  const { normalizeWeave, normalizeLetters, headLine, weavable, frontOf } = await import("../ui/js/layers.js");
  const photo = (weave, more = {}) => normalizeLayers([{ type: "photo", id: "cut", pid: "p1", cut: true, weave, ...more }]).find((l) => l.id === "cut");
  // read as written, the letters in front only of the layers it weaves with, each key once
  const w = photo({ with: ["title", "t<1>", "title", "", 7], by: "letters", line: 0.45, front: { title: ["0|W|1", "0|W|1", "1|穿|1", "bad", "0||1", 3], t1: ["2|a|10"], gone: ["0|x|1"] } }).weave;
  assert.deepEqual(w, { with: ["title", "t1"], by: "letters", line: 0.45, front: { title: ["0|W|1", "1|穿|1"], t1: ["2|a|10"] } });
  // the way is the head unless letters; the line within 0.1–0.9, 0.3 when missing
  assert.deepEqual(photo({}).weave, { with: [], by: "head", line: 0.3, front: {} });
  assert.deepEqual([photo({ by: "brush", line: 2 }).weave.by, photo({ line: 2 }).weave.line, photo({ line: -1 }).weave.line, photo({ line: "x" }).weave.line], ["head", 0.9, 0.1, 0.3]);
  for (const bad of [null, "head", 3, ["title"]]) assert.equal("weave" in photo(bad), false, `no weave from ${JSON.stringify(bad)}`);
  assert.equal(normalizeWeave(undefined), null);
  // bounded: 24 layers, 400 letters each
  const many = photo({ with: Array.from({ length: 40 }, (_, i) => "l" + i), front: { l0: Array.from({ length: 900 }, (_, i) => `0|a|${i + 1}`) } }).weave;
  assert.deepEqual([many.with.length, many.front.l0.length], [24, 400]);
  // a front named like an object's own keys stays data
  const odd = photo({ with: ["__proto__"], front: JSON.parse('{"__proto__": ["0|a|1"]}') }).weave;
  assert.deepEqual([Object.getPrototypeOf(odd.front) === Object.prototype, Object.keys(odd.front)], [true, ["__proto__"]]);
  // a letter's key names it between its first bar and its last: a bar itself, or a stretch of another script set whole, is one
  const hindi = "0|नमस्ते दुनिया|1", long = `0|${"क".repeat(201)}|1`;
  assert.deepEqual(photo({ with: ["t"], by: "letters", front: { t: ["0|||1", hindi, long, "x|a|1"] } }).weave.front, { t: ["0|||1", hindi] });
  assert.deepEqual(Object.keys(normalizeLetters({ "1|A|2": { kind: "tile" }, "0|||1": { kind: "bare" }, "A|1": { kind: "tile" } })), ["1|A|2", "0|||1"], "the ransom note's keys alike");
  // a layer's letters in front are its own list: never what an object has from its prototype
  assert.deepEqual([frontOf(w, "title"), frontOf(w, "constructor"), frontOf(w, "toString"), frontOf(null, "title"), frontOf({ front: { a: "x" } }, "a")], [["0|W|1", "1|穿|1"], [], [], [], []]);
  // kept on a photo no longer cut out, for when it is again; the references are not looked up
  assert.deepEqual(photo({ with: ["nowhere"] }, { cut: false }).weave.with, ["nowhere"]);
  // the head ends `line` of the way down the subject's box, a fraction of the photo, the line kept within bounds
  assert.ok(Math.abs(headLine({ y0: 0.2, y1: 0.8 }, 0.3) - 0.38) < 1e-9);
  assert.ok(Math.abs(headLine({ y0: 0, y1: 1 }, 5) - 0.9) < 1e-9 && Math.abs(headLine({ y0: 0.5, y1: 0.5 }, 0.3) - 0.5) < 1e-9);
  // what it may weave with: the headline layers below it
  const layers = normalizeLayers([{ type: "bg" }, { type: "text", id: "a", text: "x" }, { type: "photo", id: "p", pid: "p1" }, { type: "title" }, { type: "photo", id: "c", pid: "p1", cut: true }, { type: "text", id: "b", text: "y" }]);
  assert.deepEqual(weavable(layers, layers.findIndex((l) => l.id === "c")).map((l) => l.id), ["subtitle", "a", "title"]);   // the missing subtitle put back above the ground
  assert.deepEqual(weavable(layers, 0), []);
});

test("weaving: the letters chosen are found along their line, repeated letters apart, CJK and Latin mixed, a run of them one span", async () => {
  const { letterSpans, letterCells, keysOf, lineCells, letterKey } = await import("../ui/js/ransom.js");
  const width = { A: 60, B: 40, " ": 20, 你: 100, 好: 100 }, measure = (t) => [...t].reduce((s, ch) => s + (width[ch] ?? 50), 0);
  // the pieces as setLine sets them: Latin set larger beside CJK (s), each piece as wide as it was set
  const pieces = [{ t: "ABA ", x: 0, w: 216, s: 1.2 }, { t: "你好", x: 216, w: 200, s: 1 }, { t: "B", x: 416, w: 48, s: 1.2 }];
  const keys = keysOf(lineCells(pieces), 2);
  assert.deepEqual(keys, ["2|A|1", "2|B|1", "2|A|2", "2| |1", "2|你|1", "2|好|1", "2|B|2"], "each letter by how many times it came before in the line");
  const near = (a, b) => assert.ok(a.length === b.length && a.every((s, i) => Math.abs(s[0] - b[i][0]) < 1e-6 && Math.abs(s[1] - b[i][1]) < 1e-6), JSON.stringify(a) + " vs " + JSON.stringify(b));
  // each cell its share of its piece: A 72, B 48, A 72, the space 24
  near(letterSpans(pieces, measure, 2, new Set([letterKey(2, "A", 2)])), [[120, 192]]);
  near(letterSpans(pieces, measure, 2, new Set(["2|A|1"])), [[0, 72]]);
  near(letterSpans(pieces, measure, 2, new Set(["2|B|1", "2|A|2", "2|你|1"])), [[72, 192], [216, 316]], "side by side one span; the space between leaves a gap");
  near(letterSpans(pieces, measure, 2, new Set(["2|好|1", "2|B|2"])), [[316, 464]], "across pieces too");
  // the line's ends reach out past it; another line's keys find nothing
  near(letterSpans(pieces, measure, 2, new Set(["2|A|1", "2|B|2"]), 30), [[-30, 72], [416, 494]]);
  assert.deepEqual(letterSpans(pieces, measure, 1, new Set(["2|A|1"])), []);
  // where each letter begins as its piece is set: the letters before it in the piece measured together (kerned), set as large
  const kerned = (t) => measure(t) - (t.includes("AB") ? 10 : 0), pens = letterCells(pieces, kerned, 2).map((c) => c.pen);
  assert.deepEqual(pens.map((p) => Math.round(p * 1e6) / 1e6), [0, 72, 108, 180, 216, 316, 416], "after AB, 10 units kerned away, at its size");
});

test("weaving: only the letters in front are painted — a line kept to them (where there is no canvas, clipped to their shares), a line without them left out, the plate left behind; vertical lettering by column", async () => {
  const { drawTitle, drawTitleVertical } = await import("../ui/js/title.js");
  const recorder = () => { const calls = []; return [calls, new Proxy({ font: "900 100px X", lineWidth: 1 }, { get: (t, k) => (k in t ? t[k] : k === "measureText" ? (s) => ({ width: [...s].length * 60 }) : (...a) => { calls.push([k, ...a]); return {}; }), set: (t, k, v) => { t[k] = v; return true; } })]; };
  const box = { x: 0, y: 0, w: 4000, h: 1000 }, st = (only) => ({ font: "X", maxFs: 100, fx: "plain", fill: "#fff", hi: "#ff0", stroke: 1, shadowAmt: 1, skew: 0, plate: () => plated.push(1), only });
  let plated = [];
  const [all, a] = recorder();
  drawTitle(a, "AB CD\nEF", box, { dx: 0, dy: 0, s: 1 }, st(null));
  assert.deepEqual([all.filter((c) => c[0] === "fillText").map((c) => c[1]), all.some((c) => c[0] === "clip"), plated.length], [["AB CD", "EF"], false, 1], "unwoven: every line, no clip, the plate");
  plated = [];
  const [some, b] = recorder();
  drawTitle(b, "AB CD\nEF", box, { dx: 0, dy: 0, s: 1 }, st(new Set(["0|B|1", "0|C|1"])));
  assert.deepEqual(some.filter((c) => c[0] === "fillText").map((c) => c[1]), ["AB CD"], "the second line has none of them");
  const rects = some.filter((c) => c[0] === "rect").map((c) => [c[1], c[1] + c[3]]);
  assert.deepEqual(rects, [[60, 120], [180, 240]], "B, then C: the space between is not theirs");
  assert.ok(some.findIndex((c) => c[0] === "clip") < some.findIndex((c) => c[0] === "fillText") && plated.length === 0, "kept to them before the line is painted; no plate");
  // the ransom note paints its chosen letters itself: the plates under its highlighted words are kept to those letters
  const [rn, r] = recorder();
  drawTitle(r, "AB *CD*", box, { dx: 0, dy: 0, s: 1 }, { ...st(new Set(["0|C|1"])), fx: "ransom", hiPlate: (x, y, w, h, fs, on) => on.fillRect(x, y, w, h) });
  const at = (k) => rn.findIndex((c) => c[0] === k);
  assert.ok(at("clip") >= 0 && at("clip") < at("fillRect") && rn.filter((c) => c[0] === "rect").every((c) => c[1] === 180 && c[1] + c[3] === 240), "kept to C before its plate");
  // a column of vertical lettering counts as a line; a sideways run is painted when any of its letters is chosen
  const [col, v] = recorder();
  drawTitleVertical(v, "你好AB\n世界", box, { font: "X", fill: "#fff", hi: "#ff0", maxFs: 100, only: new Set(["0|好|1", "0|B|1", "1|世|1"]) });
  assert.deepEqual(col.filter((c) => c[0] === "fillText").map((c) => c[1]), ["好", "AB", "世"]);
});

test("weaving: copied from another channel, a cut-out weaves with the copies of its lettering, the layout's own, and lets the rest go", async () => {
  const { copyFreeLayers } = await import("../ui/js/layers.js");
  const into = normalizeLayers([{ type: "bg" }, { type: "title" }]);
  const from = normalizeLayers([{ type: "bg" }, { type: "photo", id: "a", pid: "p1", fill: true }, { type: "text", id: "t1", text: "hi" }, { type: "title" }, { type: "subtitle", copy: true, id: "s2" },
    { type: "photo", id: "b", of: "a", cut: true, weave: { with: ["title", "t1", "s2", "gone"], by: "letters", front: { title: ["0|A|1"], t1: ["0|h|1"], s2: ["0|x|1"], gone: ["0|y|1"] } } }]);
  const { copies } = copyFreeLayers(into, from), id = (old) => copies[from.filter((l) => l.type === "photo" || l.id === "t1" || l.id === "s2").findIndex((l) => l.id === old)].id;
  const cut = copies.find((c) => c.of);
  assert.equal(cut.of, id("a"));
  assert.deepEqual(cut.weave, { with: ["title", id("t1"), id("s2")], by: "letters", line: 0.3, front: { title: ["0|A|1"], [id("t1")]: ["0|h|1"], [id("s2")]: ["0|x|1"] } });
  assert.deepEqual(from.find((l) => l.id === "b").weave.with, ["title", "t1", "s2", "gone"], "the cover copied from is left as it was");
});

test("the host: the app answers the native commands itself, a SmedCover server over HTTP, a plain page not at all; what each can do follows", async () => {
  const here = await import("../ui/js/store.js");
  assert.deepEqual([here.HOST, here.native, here.CAN.files, here.CAN.outlines, here.CAN.saveFiles], ["browser", false, false, false, false]);
  await assert.rejects(here.invoke("app_read", { path: "x" }), /no native side/);
  // a page a server sent: the commands over HTTP, the data folder and outlines there, nothing written on this computer
  globalThis.SMEDCOVER_SERVER = { api: "/x/api" };
  try {
    const srv = await import("../ui/js/store.js?server");
    assert.deepEqual([srv.HOST, srv.native, srv.CAN.files, srv.CAN.fonts, srv.CAN.outlines, srv.CAN.cut, srv.CAN.relay, srv.CAN.saveFiles, srv.CAN.folders, srv.CAN.selftest],
      ["server", false, true, true, true, true, true, false, false, false]);
    const was = globalThis.fetch, asked = [];
    globalThis.fetch = async (url, init) => { asked.push([url, init.body]); return { ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => '"saved"' }; };
    try { assert.equal(await srv.files.read("settings.json"), "saved"); } finally { globalThis.fetch = was; }
    assert.deepEqual(asked, [["/x/api/invoke/app_read", '{"path":"settings.json"}']], "the files through the server's commands");
  } finally { delete globalThis.SMEDCOVER_SERVER; }
  // the request: JSON arguments, or bytes as they are with the headers given; the answer: JSON, bytes, nothing, or an error's text thrown
  const { httpInvoke } = here, sent = [];
  const answer = (status, type, body) => async (url, init) => { sent.push([url, init]); return { ok: status < 400, status, headers: { get: () => type }, json: async () => JSON.parse(body), text: async () => body, arrayBuffer: async () => new TextEncoder().encode(body).buffer }; };
  assert.deepEqual(await httpInvoke({ api: "/api" }, "app_list", { dir: "covers" }, {}, answer(200, "application/json", '["a.json"]')), ["a.json"]);
  assert.deepEqual([sent[0][0], sent[0][1].method, sent[0][1].headers["content-type"], sent[0][1].body], ["/api/invoke/app_list", "POST", "application/json", '{"dir":"covers"}']);
  const bytes = new Uint8Array([1, 2, 3]), got = await httpInvoke(null, "subject_mask_onnx", bytes, { headers: { "x-model": "birefnet" } }, answer(200, "application/octet-stream", "PNG"));
  assert.ok(got instanceof ArrayBuffer && new TextDecoder().decode(got) === "PNG");
  assert.deepEqual([sent[1][0], sent[1][1].body, sent[1][1].headers["x-model"], sent[1][1].headers["content-type"]], ["/api/invoke/subject_mask_onnx", bytes, "birefnet", "application/octet-stream"]);
  assert.equal(await httpInvoke({}, "app_write", { path: "p", data: "d" }, {}, answer(204, "", "")), null);
  await assert.rejects(httpInvoke({}, "app_read", { path: "../x" }, {}, answer(400, "text/plain", "path outside the data folder")), (e) => e === "path outside the data folder");
  assert.equal(await httpInvoke({}, "app_write", { path: "p", data: "d" }, {}, answer(200, "application/json", "")), null, "an empty answer is nothing");
  assert.ok((await httpInvoke({}, "subject_mask_onnx", bytes, {}, answer(200, "image/png", "PNG"))) instanceof ArrayBuffer, "a picture comes back as bytes, whatever its type");
  // a read is asked again when the server cannot be reached or is briefly away; a write is not
  const flaky = (fails) => { let n = 0; return async (url, init) => { n++; if (n <= fails) { if (fails === 9) return { ok: false, status: 503, headers: { get: () => "text/plain" }, text: async () => "away" }; throw new TypeError("Failed to fetch"); } return answer(200, "application/json", '"there"')(url, init); }; };
  const naps = [], nap = async (ms) => { naps.push(ms); };
  assert.equal(await httpInvoke({}, "app_read", { path: "p" }, {}, flaky(2), nap), "there");
  assert.deepEqual(naps, [400, 1200]);
  await assert.rejects(httpInvoke({}, "app_read", { path: "p" }, {}, flaky(3), nap), /app_read: Failed to fetch/, "not for ever");
  await assert.rejects(httpInvoke({}, "app_read", { path: "p" }, {}, flaky(9), nap), (e) => e === "away", "a 503 asked again, then given up");
  naps.length = 0;
  await assert.rejects(httpInvoke({}, "app_write", { path: "p", data: "d" }, {}, flaky(1), nap), /app_write: Failed to fetch/);
  assert.deepEqual(naps, [], "a write is never sent twice");
});
