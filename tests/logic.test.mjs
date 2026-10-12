// Unit tests for the DOM-free logic. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { virtualSize, layout, TEMPLATES } from "../ui/js/layout.js";
import { parseCsv, csvToJobs } from "../ui/js/csv.js";
import { normalizeProfile, normalizeCover, normalizeSettings, exportName, usedUserAssets } from "../ui/js/store.js";
import { BOUND_TYPES, defaultLayers, normalizeLayers, newLayer, resolve, adjust, resetPlacement, insertAbove, moveLayer, duplicate, isPickable } from "../ui/js/layers.js";
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
  }
});

test("parseCsv handles quotes, embedded commas and line breaks", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","line1\nline2"\n\n"say ""hi""",z\r\n'), [["a", "b"], ["x, y", "line1\nline2"], ['say "hi"', "z"]]);
});

test("csvToJobs reads with and without a header row", () => {
  assert.deepEqual(csvToJobs("类目,标题,角标\n日常,一台相机,EP.01\n教程,,x\n"), [{ category: "日常", title: "一台相机", tag: "EP.01" }]);
  assert.deepEqual(csvToJobs("Title,Category\nHello,Vlog"), [{ category: "Vlog", title: "Hello", tag: "" }]);
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
  assert.deepEqual(p.sizes, [{ w: 64, h: 1080, label: "" }]);
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
  assert.deepEqual(normalizeSettings({ scale: 7, format: "gif", quality: 500, scope: "size" }), { lang: "", profileId: "", scale: 2, format: "png", quality: 100, nameTemplate: "{n}-{category}_{title}_{size}", scope: "size" });
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
  assert.deepEqual(resolve(g, 1920, 1080, land.key, "c1"), { dx: 0, dy: 0, s: 1, r: 0 });
  adjust(g, { ...land, catId: "c1" }, "size", { ddx: 40 });
  assert.equal(resolve(g, 1920, 1080, land.key, "c1").dx, 40);
  assert.equal(resolve(g, 1920, 1080, land.key, "c2").dx, 0);
  adjust(g, { ...land, catId: "c2" }, "all", { ddx: 192 });
  assert.ok(Math.abs(resolve(g, 1920, 1080, land.key, "c1").dx - 232) < 1e-6);
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
  assert.equal(isPickable(ls.find((l) => l.id === "accent")), false);
  assert.equal(isPickable(s), true); s.locked = true; assert.equal(isPickable(s), false);
});

test("the sticker pack has 50 uniquely named stickers in known groups", async () => {
  globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => ({}) }) };
  const { STICKERS, STICKER_GROUPS } = await import("../ui/js/stickers.js");
  assert.equal(STICKERS.length, 50);
  assert.equal(new Set(STICKERS.map((s) => s.id)).size, 50);
  const groups = new Set(STICKER_GROUPS.map((g) => g.id));
  for (const s of STICKERS) { assert.ok(groups.has(s.group), s.id); assert.ok(s.name.zh && s.name.en && /^#[0-9a-f]{6}$/i.test(s.color), s.id); }
});

test("every interface string has both languages", async () => {
  const { keys, t, setLang } = await import("../ui/js/i18n.js");
  globalThis.document = { ...globalThis.document, documentElement: {} };
  for (const lang of ["zh", "en"]) { setLang(lang); for (const k of keys()) assert.ok(t(k).trim().length > 0, `${lang} ${k}`); }
});

test("exportName fills the template and strips unsafe characters", () => {
  const cat = { name: "街拍日记", code: "SHOT" };
  assert.equal(exportName("{n}-{category}_{title}_{size}", { index: 0, cat, title: "一台相机\n记录*真实*的一周", size: { w: 1920, h: 1080 }, scale: 2, ext: "png" }), "01-街拍日记_一台相机 记录真实的一周_1920x1080@2x.png");
  assert.equal(exportName("../{code}/{title}", { index: 2, cat, title: "a/b:c", size: { w: 1, h: 1 }, scale: 1, ext: "jpg" }), "..SHOTabc.jpg");
  assert.equal(exportName("", { index: 0, cat: { name: "", code: "" }, title: "", size: { w: 10, h: 20 }, scale: 1, ext: "webp" }), "01-cover_untitled_10x20.webp");
});
