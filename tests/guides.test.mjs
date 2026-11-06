// Unit tests for the layout guide over the canvas (ui/js/guides.js) and the settings that keep it. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { GUIDE_LIMITS, GUIDES_MOST, normalizeGuide, normalizeGuides, guideDefaults, newGuide, autoWidth, guideSpans, gridLines, snapTargets, snapAxis, paintGuides } from "../ui/js/guides.js";
import { normalizeSettings, settingsToKeep, readSettings } from "../ui/js/store.js";
import { DEFAULTS, SHIPPED, layOver } from "../ui/js/defaults.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const spans = (list, want) => { assert.equal(list.length, want.length, JSON.stringify(list)); list.forEach(([a, b], i) => { near(a, want[i][0], 1e-3); near(b, want[i][1], 1e-3); }); };

test("a new guide is six columns stretched across, a gutter of 20 and no margin, width worked out, in red at 10%", () => {
  assert.deepEqual(newGuide(), { kind: "columns", count: 6, align: "stretch", width: 100, margin: 0, gutter: 20, size: 10, color: "#FF0000", opacity: 0.1, shown: true });
  assert.deepEqual(SHIPPED.layout.guide, { kind: "columns", count: 6, align: "stretch", width: 100, margin: 0, gutter: 20, size: 10, color: "#FF0000", opacity: 0.1 }, "as defaults.json ships it");
  near(autoWidth(newGuide(), 1920), (1920 - 5 * 20) / 6);
});

test("a guide keeps every field within range, the default where one is missing or not of its kind", () => {
  assert.deepEqual(normalizeGuide({}), { ...newGuide() });
  assert.deepEqual(normalizeGuide(null), newGuide());
  const g = normalizeGuide({ kind: "rows", count: 99, align: "end", width: -5, margin: "12", gutter: 1e9, size: 0, color: "#00ff88", opacity: 3, shown: false });
  assert.deepEqual(g, { kind: "rows", count: GUIDE_LIMITS.count[1], align: "end", width: GUIDE_LIMITS.width[0], margin: 12, gutter: GUIDE_LIMITS.gutter[1], size: GUIDE_LIMITS.size[0], color: "#00FF88", opacity: 1, shown: false });
  const bad = normalizeGuide({ kind: "diagonal", count: "six", align: "middle", color: "red", opacity: "x", gutter: 7.6 });
  assert.deepEqual([bad.kind, bad.count, bad.align, bad.color, bad.opacity, bad.gutter], ["columns", 6, "stretch", "#FF0000", 0.1, 8]);
  assert.equal(normalizeGuide({ opacity: 0.333 }).opacity, 0.33);
});

test("the guide in the settings: off and none by default; on only with a guide; at most a few guides; kept in custom.json only once changed", async () => {
  assert.deepEqual(normalizeSettings({}).guide, { on: false, list: [] });
  assert.deepEqual(normalizeGuides({ on: true, list: [] }), { on: false, list: [] }, "on with nothing to show is off");
  assert.deepEqual(normalizeGuides({ on: "yes", list: [{}] }), { on: false, list: [newGuide()] });
  const many = normalizeGuides({ on: true, list: Array.from({ length: 20 }, (_, i) => ({ count: i + 1 })) });
  assert.equal(many.list.length, GUIDES_MOST);
  assert.deepEqual(many.list.map((g) => g.count), [1, 2, 3, 4, 5, 6, 7, 8]);
  const s = normalizeSettings({ guide: { on: true, list: [{ kind: "grid", size: 40 }] } });
  assert.deepEqual(s.guide, { on: true, list: [{ ...newGuide(), kind: "grid", size: 40 }] });
  assert.deepEqual(settingsToKeep(normalizeSettings({})).guide, undefined, "the default not written");
  const kept = settingsToKeep(s);
  assert.deepEqual(kept.guide, s.guide);
  assert.deepEqual((await readSettings({ by: "app", settings: kept }, async () => null)).guide, s.guide, "read back as it was");
});

test("a new guide follows defaults.json's layout.guide, and custom.json's over it, held to range", () => {
  try {
    layOver({ layout: { guide: { count: 12, gutter: 32, color: "#3366FF", opacity: 0.2 } } });
    assert.deepEqual(newGuide(), { ...normalizeGuide({}), count: 12, gutter: 32, color: "#3366FF", opacity: 0.2 });
    assert.equal(guideDefaults().count, 12);
    assert.deepEqual(DEFAULTS.layout.byOrient, SHIPPED.layout.byOrient, "the layouts beside it as shipped");
    layOver({ layout: { guide: { count: 500, kind: "spiral" } } });
    assert.deepEqual([newGuide().count, newGuide().kind], [GUIDE_LIMITS.count[1], "columns"]);
  } finally { layOver(null); }
  assert.equal(newGuide().count, 6);
});

test("columns stretched across: the margins at either side, the gutters between, the width shared; none where nothing is left", () => {
  const g = { ...newGuide() };
  const w = (1920 - 100) / 6;
  spans(guideSpans(g, 1920), Array.from({ length: 6 }, (_, i) => [i * (w + 20), i * (w + 20) + w]));
  const m = { ...g, margin: 60, count: 4, gutter: 30 }, mw = (1280 - 120 - 90) / 4;
  spans(guideSpans(m, 1280), [[60, 60 + mw], [90 + mw, 90 + 2 * mw], [120 + 2 * mw, 120 + 3 * mw], [150 + 3 * mw, 1220]]);
  assert.deepEqual(guideSpans({ ...g, margin: 900, gutter: 100 }, 1920), [], "no room left: no columns");
  spans(guideSpans({ ...g, count: 1 }, 1080), [[0, 1080]]);
});

test("columns of a width of their own: from the left by the offset, from the right, centred; the part on the cover of each", () => {
  const g = { ...newGuide(), align: "start", width: 100, margin: 40, count: 3, gutter: 20 };
  spans(guideSpans(g, 1000), [[40, 140], [160, 260], [280, 380]]);
  spans(guideSpans({ ...g, align: "end" }, 1000), [[620, 720], [740, 840], [860, 960]]);
  spans(guideSpans({ ...g, align: "center" }, 1000), [[330, 430], [450, 550], [570, 670]], "centred: the offset not used");
  spans(guideSpans({ ...g, count: 12 }, 1000), [[40, 140], [160, 260], [280, 380], [400, 500], [520, 620], [640, 740], [760, 860], [880, 980]], "those past the cover's edge left out");
  spans(guideSpans({ ...g, margin: 950, count: 2 }, 1000), [[950, 1000]], "cut at the cover's edge");
});

test("a grid's lines: every size pixels from the corner to the far edge", () => {
  assert.deepEqual(gridLines(10, 35), [0, 10, 20, 30]);
  assert.deepEqual(gridLines(10, 30), [0, 10, 20, 30]);
  assert.deepEqual(gridLines(0, 30), []);
  assert.equal(gridLines(2, 1e6).length, 5000, "a few thousand at most");
});

test("what a drag rests on: the columns' edges and middles across, rows' down, a grid's lines both ways, in the canvas's units; hidden guides give none", () => {
  const cols = { ...newGuide(), count: 2, gutter: 0 }, rows = { ...newGuide(), kind: "rows", count: 2, gutter: 0 }, grid = { ...newGuide(), kind: "grid", size: 500 };
  const t = snapTargets([cols, rows, grid, { ...grid, size: 7, shown: false }], 1000, 1000, 2, 0.5);
  assert.deepEqual(t.x.edge.sort((a, b) => a - b), [0, 0, 1000, 1000, 1000, 2000, 2000]);
  assert.deepEqual(t.x.mid, [500, 1500]);
  assert.deepEqual(t.y.edge.sort((a, b) => a - b), [0, 0, 250, 250, 250, 500, 500]);
  assert.deepEqual(t.y.mid, [125, 375]);
  assert.deepEqual(snapTargets([], 100, 100), { x: { edge: [], mid: [] }, y: { edge: [], mid: [] } });
  // a grid too fine to be drawn (cells under cellMin pixels of the cover) is not snapped to; columns are, whatever cellMin
  const fine = snapTargets([{ ...grid, size: 10 }, cols], 1000, 1000, 1, 1, 17);
  assert.deepEqual([fine.x.edge.length, fine.y.edge.length], [4, 0]);
  assert.equal(snapTargets([{ ...grid, size: 20 }], 100, 100, 1, 1, 17).x.edge.length, 6);
});

test("a drag comes to rest where an edge or the centre nears a line, the nearest of them; out of reach it is left as it is", () => {
  const t = { edge: [0, 300, 320, 640], mid: [150, 470] };
  // a box 100 wide at 100…200, moved by 195: its left edge 295, 5 from 300
  assert.deepEqual(snapAxis(100, 200, 195, t, 6), { d: 200, at: 300 });
  // moved by 112: its right edge 312, 8 from 320 and 12 from 300; its centre 262, out of reach: left as it is with a reach of 6
  assert.deepEqual(snapAxis(100, 200, 112, t, 6), { d: 112, at: null });
  assert.deepEqual(snapAxis(100, 200, 112, t, 10), { d: 120, at: 320 });
  // its centre to a column's middle: moved by 318, the centre 468, 2 from 470 (its left edge 418, nothing near)
  assert.deepEqual(snapAxis(100, 200, 318, t, 6), { d: 320, at: 470 });
  // the nearest wins: the left edge 4 from 300 and the right edge 1 from 640
  assert.deepEqual(snapAxis(0, 347, 296, { edge: [300, 644], mid: [] }, 6), { d: 297, at: 644 });
  assert.deepEqual(snapAxis(0, 10, 50, { edge: [], mid: [] }, 6), { d: 50, at: null });
});

/** A 2D context that keeps the rectangles it is told to fill, with the colour each was filled in. */
function recorder() {
  const rects = [];
  return { rects, fillStyle: "", clearRect() { rects.length = 0; }, fillRect(x, y, w, h) { rects.push([this.fillStyle, x, y, w, h]); } };
}

test("the guide painted: columns and rows as bands in whole device pixels, a grid as lines one pixel wide, too fine a grid left out, the line a drag rests on at full strength", () => {
  const c = recorder();
  paintGuides(c, [{ ...newGuide(), count: 2, gutter: 20 }], 1000, 500, 500, 250);
  assert.deepEqual(c.rects, [["rgba(255,0,0,0.1)", 0, 0, 245, 250], ["rgba(255,0,0,0.1)", 255, 0, 245, 250]]);
  paintGuides(c, [{ ...newGuide(), kind: "rows", count: 1, margin: 100, color: "#0000FF", opacity: 0.5 }], 1000, 500, 500, 250);
  assert.deepEqual(c.rects, [["rgba(0,0,255,0.5)", 0, 50, 500, 150]]);
  paintGuides(c, [{ ...newGuide(), kind: "grid", size: 250 }], 1000, 500, 500, 250);
  assert.deepEqual(c.rects.map((r) => r.slice(1)), [[0, 0, 1, 250], [125, 0, 1, 250], [250, 0, 1, 250], [375, 0, 1, 250], [499, 0, 1, 250], [0, 0, 500, 1], [0, 125, 500, 1], [0, 249, 500, 1]]);
  paintGuides(c, [{ ...newGuide(), kind: "grid", size: 4 }], 1000, 500, 500, 250);
  assert.deepEqual(c.rects, [], "a cell of 2 pixels of the screen: not painted");
  paintGuides(c, [{ ...newGuide(), kind: "grid", size: 8 }], 16, 16, 16, 16, null, 2);
  assert.equal(c.rects.length, 6, "on a screen of 2 device pixels to one, a cell of 8 of them is 4 of the screen: painted");
  paintGuides(c, [{ ...newGuide(), kind: "grid", size: 6 }], 18, 18, 18, 18, null, 2);
  assert.deepEqual(c.rects, [], "and one of 6 is 3: not painted");
  paintGuides(c, [{ ...newGuide(), shown: false }], 1000, 500, 500, 250, { x: [500], y: [] });
  assert.deepEqual(c.rects, [], "nothing shown, no line either");
  paintGuides(c, [{ ...newGuide(), count: 1, color: "#00FF00" }], 1000, 500, 1000, 500, { x: [300], y: [250] }, 2);
  assert.deepEqual(c.rects, [["rgba(0,255,0,0.1)", 0, 0, 1000, 500], ["rgba(0,255,0,0.9)", 299, 0, 2, 500], ["rgba(0,255,0,0.9)", 0, 249, 1000, 2]]);
});
