// Unit tests for turning a picture in 3D (ui/js/tilt.js), and the layers that carry a turn. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { TILT, canTilt, tiltOf, normalizeTilt, setTilt, tiltMatrix, project, inv3, mul3, cornersOf, tiltHit, tiltSpan } from "../ui/js/tilt.js";
import { normalizeLayers, newLayer } from "../ui/js/layers.js";

/** One free layer as a cover's layers keep it. */
const normalizeLayer = (raw) => normalizeLayers([raw]).find((l) => l.id === raw.id);

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const at = (m, x, y) => project(m, x, y).slice(0, 2);

test("a turn keeps what it may turn and its numbers within bounds, the defaults left out", () => {
  assert.deepEqual(normalizeTilt({}), {});
  assert.deepEqual(normalizeTilt({ tiltX: 0, tiltY: 0, persp: TILT.persp }), {});
  assert.deepEqual(normalizeTilt({ tiltX: 30, tiltY: -12.34 }), { tiltX: 30, tiltY: -12.3 });
  assert.deepEqual(normalizeTilt({ tiltX: 200, tiltY: -200, persp: 3 }), { tiltX: TILT.most, tiltY: -TILT.most, persp: 1 });
  assert.deepEqual(normalizeTilt({ tiltX: "x", tiltY: null, persp: "" }), {});
  assert.deepEqual(normalizeTilt({ persp: 0 }), { persp: 0 });   // a perspective of its own stays while the card is flat
  const L = /** @type {any} */ ({ type: "photo", tiltX: 20 });
  assert.equal(setTilt(L, { tiltY: 15 }), true);
  assert.deepEqual([L.tiltX, L.tiltY], [20, 15]);
  assert.equal(setTilt(L, { tiltY: 15 }), false);
  setTilt(L, { tiltX: 0, tiltY: 0 });
  assert.ok(!("tiltX" in L) && !("tiltY" in L));
});

test("photos not filling the canvas, their cut-outs and assets turn; a flat one, or anything else, does not", () => {
  assert.equal(canTilt({ type: "photo" }), true);
  assert.equal(canTilt({ type: "photo", fill: true }), false);
  assert.equal(canTilt({ type: "photo", fill: true, of: "p1" }), true);   // a cut-out of a photo filling the canvas sits on it like a print
  assert.equal(canTilt({ type: "asset" }), true);
  assert.equal(canTilt({ type: "text" }), false);
  assert.equal(tiltOf({ type: "asset" }), null);
  assert.deepEqual(tiltOf({ type: "asset", tiltY: 30 }), { x: 0, y: 30, p: TILT.persp });
  assert.equal(tiltOf({ type: "photo", fill: true, tiltY: 30 }), null);   // kept, not shown
  assert.equal(tiltOf({ type: "text", tiltY: 30 }), null);
});

test("normalizeLayer keeps a photo's and an asset's turn, and nothing of it on other layers", () => {
  const p = normalizeLayer({ ...newLayer("photo", { pid: "abc" }), tiltX: 25, tiltY: -400, persp: 0.8 });
  assert.deepEqual([p.tiltX, p.tiltY, p.persp], [25, -TILT.most, 0.8]);
  const a = normalizeLayer({ ...newLayer("asset", { ref: { kind: "sticker", id: "star" } }), tiltY: 10 });
  assert.equal(a.tiltY, 10);
  assert.ok(!("persp" in a));
  const flat = normalizeLayer(newLayer("photo", { pid: "abc" }));
  assert.ok(!("tiltX" in flat) && !("tiltY" in flat) && !("persp" in flat));
  const t = normalizeLayer({ ...newLayer("text", { text: "hi" }), tiltX: 30 });
  assert.ok(!("tiltX" in t));
});

test("the turn's map: flat when not turned, its centre still, the side turned away smaller, a card scaled about its centre scaled alike", () => {
  const id = tiltMatrix(500, 300, 15, 0, 0, 0.5, 400);
  for (const [x, y] of [[0, 0], [700, 100], [420, 900]]) { const [u, v] = at(id, x, y); near(u, x); near(v, y); }
  const m = tiltMatrix(500, 300, 0, 0, 40, 0.5, 400);
  const [cx, cy] = at(m, 500, 300); near(cx, 500); near(cy, 300);
  // turned about its up axis, its right side going away: the right edge shorter than the left, and nearer the middle
  const h = (x) => at(m, x, 400)[1] - at(m, x, 200)[1];
  assert.ok(h(700) < h(300), `${h(700)} < ${h(300)}`);
  assert.ok(500 - at(m, 300, 300)[0] > at(m, 700, 300)[0] - 500);
  // its top going away: the top edge narrower than the bottom
  const t = tiltMatrix(500, 300, 0, 40, 0, 0.5, 400), w = (y) => at(t, 700, y)[0] - at(t, 300, y)[0];
  assert.ok(w(100) < w(500));
  // no perspective: a turn about the up axis only narrows it, the edges as tall as ever
  const o = tiltMatrix(500, 300, 0, 0, 60, 0, 400);
  near(at(o, 700, 300)[0], 500 + 200 * Math.cos(Math.PI / 3)); near(at(o, 700, 400)[1] - at(o, 700, 200)[1], 200);
  // a card twice the size, scaled about its centre, lands at twice the distance from it
  const big = tiltMatrix(500, 300, 20, 30, -25, 0.7, 800), small = tiltMatrix(500, 300, 20, 30, -25, 0.7, 400);
  const [bx, by] = at(big, 500 + 2 * 120, 300 + 2 * -80), [sx, sy] = at(small, 500 + 120, 300 - 80);
  near(bx - 500, 2 * (sx - 500), 1e-6); near(by - 300, 2 * (sy - 300), 1e-6);
});

test("a card turned on the canvas tips about its own axes", () => {
  // turned a quarter on the canvas, a turn about its up axis moves its corners as a turn about its across axis would one not turned
  const a = tiltMatrix(0, 0, 90, 0, 35, 0.5, 200), b = tiltMatrix(0, 0, 0, -35, 0, 0.5, 200);
  for (const [x, y] of [[50, 80], [-70, 20]]) {
    const [u, v] = at(a, x, y), [p, q] = at(b, x, y);   // the same point, seen in the same canvas
    near(u, p, 1e-9); near(v, q, 1e-9);
  }
});

test("inv3 undoes a turn", () => {
  const m = tiltMatrix(320, 180, 12, 33, -21, 0.9, 300), back = inv3(m), one = mul3(m, back);
  for (let i = 0; i < 9; i++) near(one[i] / one[8], [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-9);
  const [x, y] = at(m, 400, 100), [u, v] = at(back, x, y);
  near(u, 400, 1e-6); near(v, 100, 1e-6);
});

test("tiltHit: the box round the card as it shows, in its own turn, caught within its outline; flat, as it was", () => {
  const hit = { cx: 500, cy: 300, hw: 200, hh: 100, r: 0, px: 500, py: 300, pf: [1, 0, 0, 1, 0, 0] };
  const same = tiltHit(hit, tiltMatrix(500, 300, 0, 0, 0, 0.5, 400));
  near(same.cx, 500); near(same.cy, 300); near(same.hw, 200); near(same.hh, 100);
  assert.equal(same.poly.length, 4);
  const m = tiltMatrix(500, 300, 0, 0, 50, 0.6, 400), t = tiltHit(hit, m);
  assert.ok(t.hw < 200, "narrower");
  assert.ok(t.hh > 100, "its near side taller than it was");
  assert.ok(t.cx < 500, "the near side, to the left, larger");
  assert.equal(t.px, 500);
  assert.ok(!("pf" in t), "the weave's brush does not paint on it");
  // turned on the canvas, the box stays square to it: a half turn shows the same box, the corners round it
  const r = tiltHit({ ...hit, r: 180 }, tiltMatrix(500, 300, 180, 0, 50, 0.6, 400));
  near(r.hw, t.hw, 1e-6); near(r.hh, t.hh, 1e-6);
  // a free crop's outline is what it turns
  const poly = [[400, 250], [600, 250], [500, 380]], pt = tiltHit({ ...hit, poly }, m);
  assert.equal(pt.poly.length, 3);
  pt.poly.forEach(([x, y], i) => { const [u, v] = at(m, ...poly[i]); near(x, u); near(y, v); });
});

test("tiltSpan paints what the turn brings into view, and only that", () => {
  const view = { x0: 0, y0: 0, x1: 1000, y1: 600 };
  // a card wholly on the canvas: all of it, landing round where it shows
  const card = { x0: 300, y0: 200, x1: 700, y1: 400 }, m = tiltMatrix(500, 300, 0, 0, 40, 0.5, 400);
  const s = tiltSpan(card, m, view);
  assert.deepEqual(s.from, card);
  const lands = cornersOf({ cx: 500, cy: 300, hw: 200, hh: 100, r: 0 }).map(([x, y]) => at(m, x, y));
  for (const [x, y] of lands) assert.ok(x >= s.to.x0 - 1e-6 && x <= s.to.x1 + 1e-6 && y >= s.to.y0 - 1e-6 && y <= s.to.y1 + 1e-6);
  // a card reaching far past the canvas, its right side turned away: what lay past the right edge comes into view
  const wide = { x0: -200, y0: -200, x1: 1800, y1: 800 }, w = tiltMatrix(800, 300, 0, 0, 50, 0.6, 2000);
  const ws = tiltSpan(wide, w, view);
  assert.ok(ws.from.x1 > 1000, "past the canvas's right edge");
  assert.ok(ws.from.x1 <= 1800 && ws.from.x0 >= -200);
  // it lands up to the canvas's right edge; its left edge, turned toward the eye but narrowed more than it grows, inside the left one
  assert.equal(ws.to.x1, 1000); assert.equal(ws.to.y0, 0); assert.equal(ws.to.y1, 600);
  near(ws.to.x0, 800 - (1000 * Math.cos((50 * Math.PI) / 180)) / (1 - (1000 * Math.sin((50 * Math.PI) / 180) * 0.6) / (1.5 * 2000)), 1e-6);
  // off the canvas: nothing
  assert.deepEqual(tiltSpan({ x0: 2000, y0: 2000, x1: 2100, y1: 2100 }, tiltMatrix(2050, 2050, 0, 20, 20, 0.5, 100), view), { from: null, to: null });
});
