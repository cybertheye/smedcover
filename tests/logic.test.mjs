// Unit tests for the DOM-free logic. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { blockLayout, virtualSize, layout, TEMPLATES } from "../ui/js/layout.js";
import { parseCsv, csvToJobs } from "../ui/js/csv.js";
import { useFont, normalizeProfile, normalizeCover, normalizeSettings, exportName, usedUserAssets, normalizeSize, ratioText, sizeCaption } from "../ui/js/store.js";
import { LETTERED, ACCENT_SHAPES, BOUND_TYPES, defaultLayers, normalizeLayers, newLayer, resolve, adjust, resetPlacement, insertAbove, moveLayer, duplicate, isPickable, appliesTo, stepIndex, clipBase, clipEnd, normalizeScene, sceneOffsets, moveScene, resetScene, reorderLayout } from "../ui/js/layers.js";
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
  assert.deepEqual(csvToJobs("类目,标题,角标\n日常,一台相机,EP.01\n教程,,x\n"), [{ category: "日常", title: "一台相机", tag: "EP.01" }]);
  assert.deepEqual(csvToJobs("Title,Category\nHello,Vlog"), [{ category: "Vlog", title: "Hello", tag: "" }]);
  assert.deepEqual(csvToJobs("频道,标题\n日常,你好"), [{ category: "日常", title: "你好", tag: "" }]);
  assert.deepEqual(csvToJobs("channel,title\nVlog,Hi"), [{ category: "Vlog", title: "Hi", tag: "" }]);
  assert.deepEqual(csvToJobs("Vlog,Hello,T1"), [{ category: "Vlog", title: "Hello", tag: "T1" }]);
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
  // the brand row shows no number until asked to
  assert.deepEqual(sample.brand, { name: "PIXEL HARBOR", unit: "SERIES", counter: false });
  assert.deepEqual(normalizeProfile({ brand: { name: "X", counter: true } }).brand, { name: "X", unit: "CHANNEL", counter: true });
  assert.equal(normalizeProfile({ brand: { counter: "yes" } }).brand.counter, false);
  // a new design leaves out the channel name and graphic; a design read from a file keeps what it had
  assert.deepEqual(sample.design.layers.filter((l) => l.off).map((l) => l.type), ["graphic", "catname"]);
  assert.ok(sample.design.layers.filter((l) => l.off).every((l) => !l.visible));
  const kept = normalizeProfile({ design: { layers: sample.design.layers.map((l) => (l.off ? { ...l, off: false, visible: true } : l)) } });
  assert.equal(kept.design.layers.filter((l) => l.off).length, 0);
  assert.equal(normalizeProfile({ lean: true }).lean, true);
  assert.equal(normalizeProfile({ lean: 1 }).lean, undefined);
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
  assert.deepEqual(normalizeSettings({ scale: 7, format: "gif", quality: 500, scope: "size" }), { lang: "", profileId: "", scale: 2, format: "png", quality: 100, nameTemplate: "{n}-{channel}_{title}_{size}", scope: "size", hideScene: false, cutEngine: "", cutProxy: "", channels: {}, columns: { left: 0, right: 0, setup: 0 }, recentFonts: [] });
  assert.deepEqual(normalizeSettings({ channels: { p1: "c1", "bad key!": "c2", p2: 7 } }).channels, { p1: "c1" });
  assert.deepEqual(normalizeSettings({ columns: { left: 410.4, right: -5, setup: "x" } }).columns, { left: 410, right: 0, setup: 0 });
  assert.deepEqual([normalizeSettings({ cutEngine: "birefnet" }).cutEngine, normalizeSettings({ cutEngine: "magic" }).cutEngine], ["birefnet", ""]);
  assert.deepEqual(normalizeSettings({ recentFonts: ["A", "A", "", 3, "B", "C", "D", "E", "F", "G"] }).recentFonts, ["A", "B", "C", "D", "E", "F"]);
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
  assert.deepEqual(LETTERED, ["title", "tag", "catname", "brand", "text"]);
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
  assert.deepEqual(FX_TYPES, ["text", "asset", "photo", "solid", "title"]);
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
  for (const e of Object.values(EFFECTS)) assert.ok(e.name.zh && e.name.en && ["passes", "mask", "outline"].includes(e.kind));
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
  assert.ok(isRemovable("subject") && isRemovable("text") && !isRemovable("title") && !isRemovable("bg"));
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
  assert.deepEqual(BOUND_TYPES, ["bg", "accent", "graphic", "catname", "tag", "brand", "title", "frame"]);   // in the list from the top: brackets, title, brand row, tag, channel name, graphic, block, ground
  const L = (type, id = type) => ({ type, id });   // (the list from the top reads: brackets, title, brand row, tag, channel name, graphic, block, ground)
  const old = [L("bg"), L("accent"), L("graphic"), L("brand"), L("title"), L("text", "w"), L("tag"), L("text", "x"), L("catname"), L("frame"), L("solid", "y")];
  assert.equal(reorderLayout(old), true);
  assert.deepEqual(old.map((l) => l.id), ["bg", "accent", "graphic", "catname", "tag", "x", "brand", "title", "w", "frame", "y"]);   // each added layer over the layout layer it was over
  const mine = [L("bg"), L("accent"), L("title"), L("graphic"), L("brand"), L("tag"), L("catname"), L("frame")];   // re-ordered by hand: left alone
  assert.equal(reorderLayout(mine), false);
  assert.deepEqual(mine.map((l) => l.id), ["bg", "accent", "title", "graphic", "brand", "tag", "catname", "frame"]);
  assert.equal(reorderLayout(old), false);                                                // once in the new order, nothing to do
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
  assert.ok(isFree("solid") && isRemovable("solid"));
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

test("every look's layout meets the cover standards: nothing under the apps' badges, a graphic to look at, room for a title that reads", async () => {
  const { meetStandards, adjustLayout, feedOf, badged, ART_HALF } = await import("../ui/js/layout.js");
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
    assert.ok(g.title.y + g.title.h <= foot, `${where}: the title's box reaches ${g.title.y + g.title.h}`);
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

test("a profile remembers its untouched covers were given the default tag, so it happens once", () => {
  assert.equal(normalizeProfile({ ...sampleProfile("en"), tagged: true }).tagged, true);
  assert.equal(normalizeProfile(sampleProfile("en")).tagged, undefined);
  assert.equal(normalizeProfile({ ...sampleProfile("en"), tagged: "yes" }).tagged, undefined);
});
