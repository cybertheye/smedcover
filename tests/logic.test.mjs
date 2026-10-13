// Unit tests for the DOM-free logic. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { blockLayout, virtualSize, layout, TEMPLATES } from "../ui/js/layout.js";
import { parseCsv, csvToJobs } from "../ui/js/csv.js";
import { normalizeProfile, normalizeCover, normalizeSettings, exportName, usedUserAssets, normalizeSize, ratioText, sizeCaption } from "../ui/js/store.js";
import { LETTERED, ACCENT_SHAPES, BOUND_TYPES, defaultLayers, normalizeLayers, newLayer, resolve, adjust, resetPlacement, insertAbove, moveLayer, duplicate, isPickable, appliesTo, stepIndex } from "../ui/js/layers.js";
import { sampleProfile, starterProfile } from "../ui/js/presets.js";

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
  assert.equal(sample.sizes.length, 5);
  assert.equal(normalizeProfile(starterProfile("en", "ACME")).brand.name, "ACME");
});

test("normalizeCover starts from the profile's design and normalizeSettings clamps", () => {
  const p = normalizeProfile(sampleProfile("en"));
  p.design.layers.find((l) => l.id === "title").align = "center";
  const c = normalizeCover({ catId: "gone" }, p);
  assert.equal(c.catId, "shot");
  assert.equal(c.layers.find((l) => l.id === "title").align, "center");
  assert.notEqual(c.layers, p.design.layers);                       // a copy, not the same array
  const own = normalizeCover({ layers: [{ type: "title", align: "left" }] }, p);
  assert.equal(own.layers.find((l) => l.id === "title").align, "left");
  assert.deepEqual(normalizeSettings({ scale: 7, format: "gif", quality: 500, scope: "size" }), { lang: "", profileId: "", scale: 2, format: "png", quality: 100, nameTemplate: "{n}-{channel}_{title}_{size}", scope: "size" });
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

test("the sticker pack has 60 uniquely named stickers in known groups", async () => {
  globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => ({}) }) };
  const { STICKERS, STICKER_GROUPS } = await import("../ui/js/stickers.js");
  assert.equal(STICKERS.length, 60);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 60);
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

test("size captions: custom name first, then ratio and use, never pixels", () => {
  assert.equal(ratioText(1920, 1080), "16:9");
  assert.equal(ratioText(1200, 1600), "3:4");
  assert.equal(ratioText(1200, 1200), "1:1");
  assert.equal(ratioText(900, 383), "2.35:1");
  assert.equal(ratioText(1146, 717), "1.6:1");
  assert.equal(ratioText(1000, 1257), "1:1.26");
  assert.equal(sizeCaption(normalizeSize({ w: 1280, h: 720, label: "16:9 · YouTube", name: "  主站封面 " })), "主站封面");
  assert.equal(sizeCaption(normalizeSize({ w: 1280, h: 720, label: "16:9 · YouTube" })), "16:9 · YouTube");
  assert.equal(sizeCaption(normalizeSize({ w: 1500, h: 500 })), "3:1");
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
import { LOOKS, LOOK_IDS, parseColour, role, lookParams, setLook, look, lookValues, styled } from "../ui/js/style.js";

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
  assert.deepEqual(LOOK_IDS, ["cel", "cyber", "riso", "anime", "bluenote", "editorial"]);
  assert.equal(normalizeProfile({ style: { look: "brick" } }).style.look, "cel");   // a look that was withdrawn falls back to the house look
  for (const id of LOOK_IDS) { assert.ok(LOOKS[id].name.zh && LOOKS[id].name.en); for (const q of LOOKS[id].params) assert.ok(q.name.zh && q.name.en && q.min <= q.def && q.def <= q.max); }
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
  for (const k of ["theme", "background", "runs", "wrap", "tag", "frame", "freeText", "subject", "image", "post"]) assert.equal(typeof LOOKS.cyber[k], "function", k);
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
  assert.equal(by("tag").ink, "#123456"); assert.equal(by("tag").hi, undefined);       // only the title has highlighted words
  assert.equal(by("catname").ink, undefined); assert.equal(by("brand").ink, undefined); // not six-digit hex: left automatic
  assert.equal(by("accent").ink, undefined); assert.equal(by("asset").ink, undefined);   // not lettering
  assert.equal(by("text").ink, "#0000ff");
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
