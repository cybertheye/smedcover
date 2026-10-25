// Unit tests for the agent tools: their definitions (tools.js), what ui/tools.json holds, the argument check, the
// helpers the commands find things by, and the answers' shapes. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOOLS, TOOL_BY, ERRORS, INSTRUCTIONS, FLAGS, toolsJson, toolsText, checkArgs, checkCall, toResult, toError, isError, ToolError, findSize, findChannel, findProfile, letterKeysOf, boxesOf, sheetPlan, widthFor, keyOf } from "../ui/js/tools.js";
import { SCOPES, FORMATS, SURPRISE_LOCKS, normalizeSize, normalizeProfile } from "../ui/js/store.js";
import { LOOK_IDS, LOOKS } from "../ui/js/style.js";
import { EFFECTS, BENDS } from "../ui/js/textfx.js";
import { BEND_IDS, WEAVE_WAYS } from "../ui/js/layers.js";
import { RULES } from "../ui/js/deal.js";
import { parseTitle } from "../ui/js/title.js";
import { lineCells, keysOf } from "../ui/js/ransom.js";

const READS = ["get_context", "get_cover", "list_options", "list_library", "render_preview"];
const LIVE = ["get_selection", "select_layer", "undo", "redo"];
/** Every schema inside `s` (itself first), with the path to it. */
function* schemas(s, path = "") {
  if (!s || typeof s !== "object") return;
  yield [s, path];
  for (const [k, v] of Object.entries(s.properties || {})) yield* schemas(v, `${path}.${k}`);
  if (s.items) yield* schemas(s.items, `${path}[]`);
  if (s.additionalProperties && typeof s.additionalProperties === "object") yield* schemas(s.additionalProperties, `${path}{}`);
  for (const a of s.anyOf || []) yield* schemas(a, `${path}|`);
}

test("every tool is defined in full: a snake_case name, a title, a description, an object schema closed to other arguments, its hints and what the page reads of it", () => {
  assert.equal(new Set(TOOLS.map((d) => d.name)).size, TOOLS.length, "names are unique");
  for (const d of TOOLS) {
    assert.match(d.name, /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, d.name);
    assert.ok(d.title && d.description.length > 60, `${d.name}: title and description`);
    assert.ok(!/(?<![\w$.])(confirm|alert|prompt)\(/.test(d.description), `${d.name}: no native dialog named`);
    const s = d.inputSchema;
    assert.equal(s.type, "object", d.name);
    assert.equal(s.additionalProperties, false, `${d.name}: no other arguments`);
    for (const k of ["anyOf", "oneOf", "allOf", "not", "$ref"]) assert.ok(!(k in s), `${d.name}: no ${k} at the top (the Claude API refuses one there)`);
    for (const [x, at] of schemas(s)) {
      if (x.type === "object" && x.properties) assert.equal(x.additionalProperties, false, `${d.name}${at}: an object with fields takes no others`);
      for (const k of x.required || []) assert.ok(x.properties && k in x.properties, `${d.name}${at}: required ${k} is a property`);
      if (x.enum) assert.ok(x.enum.length > 0 && new Set(x.enum).size === x.enum.length, `${d.name}${at}: enum`);
      if (x.minimum != null && x.maximum != null) assert.ok(x.minimum <= x.maximum, `${d.name}${at}: range`);
      if (x.pattern) new RegExp(x.pattern, "u");
      assert.ok(!("$ref" in x), `${d.name}${at}: inlined`);
    }
    for (const k of d.needs ? Object.values(d.needs).flat() : []) assert.ok(k in s.properties, `${d.name}: needs ${k}, an argument`);
    if (d.outputSchema) assert.equal(d.outputSchema.type, "object", `${d.name}: an answer is an object`);
    const a = d.annotations;
    for (const k of ["readOnlyHint", "idempotentHint", "openWorldHint"]) assert.equal(typeof a[k], "boolean", `${d.name}: ${k}`);
    if (!a.readOnlyHint) assert.equal(typeof a.destructiveHint, "boolean", `${d.name}: destructiveHint said, not left to MCP's default (true)`);
    assert.ok(["light", "strict"].includes(d.busy), d.name);
    assert.ok(Number.isInteger(d.timeoutMs) && d.timeoutMs >= 30000 && d.timeoutMs <= 7200000, d.name);
    assert.ok(d.hosts.length && d.hosts.every((h) => ["desktop", "server"].includes(h)), d.name);
    if (d.history) assert.ok(!a.readOnlyHint, `${d.name}: a step of undo changes something`);
  }
});

test("the tools are marked as the spec has them: reading, changing, writing files, the window", () => {
  for (const n of READS) assert.equal(TOOL_BY[n].annotations.readOnlyHint, true, n);
  for (const n of ["export", "batch_covers", "remove_layer"]) assert.equal(TOOL_BY[n].annotations.destructiveHint, true, n);
  for (const d of TOOLS) if (/^(set|add)_/.test(d.name)) assert.equal(d.annotations.destructiveHint, false, d.name);
  assert.equal(TOOL_BY.add_photo.annotations.openWorldHint, true);
  for (const n of LIVE) assert.deepEqual(TOOL_BY[n].hosts, ["desktop"], n);
  for (const d of TOOLS) if (!LIVE.includes(d.name)) assert.deepEqual(d.hosts, ["desktop", "server"], d.name);
  for (const d of TOOLS) assert.equal(d.busy, d.annotations.readOnlyHint ? "light" : "strict", `${d.name}: a change waits for Settings and the editor's windows (another selection shuts them)`);
  const timeout = (n) => TOOL_BY[n].timeoutMs;
  for (const n of [...READS.filter((n) => n !== "render_preview"), "get_selection"]) assert.equal(timeout(n), 30000, n);
  assert.equal(timeout("render_preview"), 120000); assert.equal(timeout("surprise"), 120000);
  assert.equal(timeout("cut_out"), 600000); assert.equal(timeout("export"), 1800000); assert.equal(timeout("batch_covers"), 1800000);
  for (const n of ["set_text", "place_layer", "undo", "select_layer", "weave"]) assert.equal(timeout(n), 60000, n);
  for (const n of ["export", "batch_covers", "undo", "redo", "select_layer", ...READS]) assert.equal(TOOL_BY[n].history, false, n);
  for (const n of ["set_text", "set_look", "set_layer_color", "remove_layer", "surprise", "apply_cover_json", "open_project"]) assert.equal(TOOL_BY[n].history, true, n);
  for (const n of ["set_layer_color", "set_text", "export", "undo", "redo", "get_selection", "select_layer"]) assert.ok(TOOL_BY[n], n);
});

test("the enums are the app's own constants", () => {
  const p = (tool) => TOOL_BY[tool].inputSchema.properties;
  assert.deepEqual(p("set_look").look.enum, LOOK_IDS);
  assert.deepEqual(p("set_layer_effect").effect.enum, Object.keys(EFFECTS));
  assert.deepEqual(BEND_IDS, Object.keys(BENDS));
  assert.deepEqual(p("set_layer_bend").bend.enum, ["none", ...BEND_IDS]);
  assert.deepEqual(p("surprise").locks.items.enum, SURPRISE_LOCKS);
  assert.equal(p("surprise").count.maximum, RULES.hands.count);
  assert.equal(p("pick_hand").hand.maximum, RULES.hands.count);
  assert.deepEqual(p("weave").by.enum, WEAVE_WAYS);
  for (const t of ["place_layer", "cut_out"]) assert.deepEqual(p(t).scope.enum, SCOPES, t);
  for (const t of ["export", "batch_covers"]) assert.deepEqual(p(t).format.enum, FORMATS, t);
});

test("ui/tools.json is what tools.js makes, and lists each tool with what the host reads of it", async () => {
  const text = await readFile(new URL("../ui/tools.json", import.meta.url), "utf8");
  assert.equal(text, toolsText(), "run npm run tools");
  const j = JSON.parse(text);
  assert.equal(j.format, 1);
  assert.equal(j.instructions, INSTRUCTIONS);
  assert.ok(/get_context/.test(j.instructions) && /undo/.test(j.instructions) && /render_preview/.test(j.instructions) && /export/.test(j.instructions));
  assert.deepEqual(j.tools.map((x) => x.name), TOOLS.map((d) => d.name));
  for (const x of j.tools) {
    assert.deepEqual(Object.keys(x).filter((k) => !["outputSchema"].includes(k)), ["name", "title", "description", "inputSchema", "annotations", "x-smedcover"], x.name);
    assert.deepEqual(x["x-smedcover"], { hosts: TOOL_BY[x.name].hosts, timeoutMs: TOOL_BY[x.name].timeoutMs });
    assert.ok(!("history" in x) && !("busy" in x) && !("needs" in x) && !("_meta" in x), `${x.name}: only what MCP and the host read`);
  }
  assert.deepEqual(toolsJson(), j);
});

test("checkArgs says in a sentence what is wrong with a call's arguments", () => {
  const s = (n) => TOOL_BY[n].inputSchema;
  assert.equal(checkArgs(s("get_context"), {}), null);
  assert.equal(checkArgs(s("get_context"), undefined), null);
  assert.match(checkArgs(s("get_context"), null), /must be an object/);
  assert.match(checkArgs(s("get_context"), { x: 1 }), /^Unknown argument "x" \(this tool takes: none\)/);
  assert.match(checkArgs(s("render_preview"), { colour: 1 }), /Unknown argument "colour" \(this tool takes: profile, channel, size, all, maxSide\)/);
  assert.equal(checkArgs(s("remove_layer"), {}), '"layer" is required.');
  assert.match(checkArgs(s("render_preview"), { maxSide: "big" }), /"maxSide" must be an integer, not a string/);
  assert.match(checkArgs(s("render_preview"), { maxSide: 512.5 }), /"maxSide" must be an integer, not a number/);
  assert.equal(checkArgs(s("render_preview"), { maxSide: 4000 }), '"maxSide" must be at most 2048 (got 4000).');
  assert.equal(checkArgs(s("render_preview"), { maxSide: 64 }), '"maxSide" must be at least 128 (got 64).');
  assert.equal(checkArgs(s("render_preview"), { maxSide: 512, all: true, channel: 2, size: "16:9" }), null);
  assert.match(checkArgs(s("render_preview"), { channel: true }), /"channel" must be a string or an integer/);
  assert.match(checkArgs(s("set_look"), { look: "nope" }), /^"look" must be one of: cel, cyber, .*; got "nope"\.$/);
  assert.equal(checkArgs(s("set_look"), { params: { split: 1.5, letters: "AB" } }), null);
  assert.match(checkArgs(s("set_look"), { params: { split: true } }), /"params.split" must be a number or a string/);
  // nested objects and lists
  assert.match(checkArgs(s("place_layer"), { layer: "title", move: { dx: 0.1, dz: 1 } }), /"move" has no field "dz" \(it takes: dx, dy\)/);
  assert.match(checkArgs(s("place_layer"), { layer: "title", move: { dx: 9 } }), /"move.dx" must be at most 3/);
  assert.equal(checkArgs(s("crop_photo"), { layer: "p", crop: { pts: [[0, 0], [1, 0], [0.5, 1]] } }), null);
  assert.match(checkArgs(s("crop_photo"), { layer: "p", crop: { pts: [[0, 0], [1, 0]] } }), /"crop.pts" must have at least 3 items/);
  assert.match(checkArgs(s("crop_photo"), { layer: "p", crop: { pts: [[0, 0], [1, 0], [0.5]] } }), /"crop.pts\[2\]" must have at least 2 items/);
  assert.match(checkArgs(s("weave"), { layer: "p", strokes: [{ front: true, r: 0.9, pts: [[0, 0]] }] }), /"strokes\[0\].r" must be at most 0.5/);
  assert.match(checkArgs(s("weave"), { layer: "p", strokes: [{ front: true, pts: [[0, 0]] }] }), /"strokes\[0\].r" is required/);
  assert.equal(checkArgs(s("weave"), { layer: "p", front: { title: "alternate", text1: ["0|A|1"] } }), null);
  assert.equal(checkArgs(s("weave"), { layer: "p", front: { title: "some" } }), '"front.title" must be "all" or "none" or "alternate", or a list; got "some".');
  assert.match(checkArgs(s("weave"), { layer: "p", front: { title: [1] } }), /"front.title\[0\]" must be a string/);   // the alternative of its type says what is wrong
  assert.match(checkArgs(s("surprise"), { locks: ["look", "look"] }), /"locks" lists "look" twice/);
  assert.match(checkArgs(s("surprise"), { locks: ["looks"] }), /"locks\[0\]" must be one of: look, theme/);
  // either "all" or a list
  assert.equal(checkArgs(s("export"), { sizes: "all", channels: [1, "vlog"] }), null);
  assert.equal(checkArgs(s("export"), { sizes: ["16:9", "1080x1920"] }), null);
  assert.match(checkArgs(s("export"), { sizes: "every" }), /"sizes" must be "all", or a list; got "every"/);
  assert.match(checkArgs(s("export"), { sizes: [] }), /"sizes" must have at least 1 item/);
  // a colour
  assert.equal(checkArgs(s("set_layer_color"), { layer: "title", ink: "#FFaa00", hi: "auto" }), null);
  assert.equal(checkArgs(s("set_layer_color"), { layer: "title", ink: "red" }), '"ink" must be "#rrggbb" or "auto"; got "red".');
  assert.equal(checkArgs(s("set_channel"), { channel: 1, color: "auto" }), '"color" must be "#rrggbb"; got "auto".');
  // exactly one of a source's ways
  assert.equal(checkArgs(s("add_photo"), { source: { url: "https://example.com/a.jpg" } }), null);
  assert.equal(checkArgs(s("add_photo"), { source: {} }), '"source" takes exactly one of: path, url, library, data.');
  assert.equal(checkArgs(s("add_photo"), { source: { url: "u", path: "/p" } }), '"source" takes exactly one of: path, url, library, data (it has url, path).');
  assert.match(checkArgs(s("add_photo"), { source: { file: "/p" } }), /"source" has no field "file"/);
  assert.match(checkArgs(s("set_text"), { title: "x".repeat(2001) }), /"title" must be at most 2000 characters long/);
});

test("checkCall checks what a tool needs beyond its schema: at least, exactly or at most one of some arguments", () => {
  assert.equal(checkCall(TOOL_BY.set_text, {}), "Give at least one of: title, subtitle, tag.");
  assert.equal(checkCall(TOOL_BY.set_text, { subtitle: "" }), null);
  assert.equal(checkCall(TOOL_BY.reorder_layer, { layer: "x" }), "Give exactly one of: to, above.");
  assert.equal(checkCall(TOOL_BY.reorder_layer, { layer: "x", to: "up", above: "title" }), "Give exactly one of: to, above (not to and above).");
  assert.equal(checkCall(TOOL_BY.reorder_layer, { layer: "x", to: "up" }), null);
  assert.equal(checkCall(TOOL_BY.batch_covers, { csv: "a,b", jobs: [{ channel: 1, title: "t" }] }), "Give exactly one of: jobs, csv (not jobs and csv).");
  assert.equal(checkCall(TOOL_BY.select_layer, { layer: "title", layers: ["tag"] }), "Give at most one of: layer, layers.");
  assert.equal(checkCall(TOOL_BY.select_layer, { size: "16:9" }), null);
  assert.equal(checkCall(TOOL_BY.open_project, { as: "new" }), "Give exactly one of: file, project.");
  assert.match(checkCall(TOOL_BY.set_text, { title: 3 }), /"title" must be a string/);   // the schema first
});

test("the answers have the shapes the host passes on: a CallToolResult, or an error with one of the codes", () => {
  assert.deepEqual(toResult({ structured: { a: 1 } }), { content: [{ type: "text", text: '{"a":1}' }], structuredContent: { a: 1 } });
  assert.deepEqual(toResult({ structured: { a: 1 }, images: ["iVBOR"], text: "Here it is." }), { content: [{ type: "text", text: "Here it is." }, { type: "image", data: "iVBOR", mimeType: "image/png" }], structuredContent: { a: 1 } });
  assert.deepEqual(toResult({ images: [{ data: "x", mimeType: "image/jpeg" }] }).content[1], { type: "image", data: "x", mimeType: "image/jpeg" });
  assert.ok(!("structuredContent" in toResult({ text: "ok" })));
  assert.deepEqual(toError("busy", "SmedCover is busy: a dialog is open."), { error: { code: "busy", message: "SmedCover is busy: a dialog is open." } });
  assert.equal(toError("whatever", "x").error.code, "failed");
  assert.deepEqual(ERRORS, ["unknown_tool", "invalid_arguments", "not_allowed", "busy", "unavailable", "failed"]);
  assert.ok(isError(toError("failed", "x")) && !isError(toResult({ structured: { error: "a field" } })));
  const e = new ToolError("not_allowed", "no");
  assert.ok(e instanceof Error); assert.equal(e.code, "not_allowed"); assert.equal(new ToolError("odd", "x").code, "failed");
});

test("sizes are found by their pixels, ratio or name; one that is several is refused", () => {
  const sizes = [{ w: 1920, h: 1080, name: "Main" }, { w: 1280, h: 720 }, { w: 1080, h: 1920 }, { w: 1200, h: 1600, label: "3:4 · RED" }, { w: 900, h: 383 }].map(normalizeSize);
  assert.equal(keyOf(findSize(sizes, "1080x1920")), "1080x1920");
  assert.equal(keyOf(findSize(sizes, " 1080 × 1920 ")), "1080x1920");
  assert.equal(keyOf(findSize(sizes, "9:16")), "1080x1920");
  assert.equal(keyOf(findSize(sizes, "2.35:1")), "900x383");
  assert.equal(keyOf(findSize(sizes, "main")), "1920x1080");
  assert.equal(keyOf(findSize(sizes, "3:4 · red")), "1200x1600");   // the label it came with
  assert.equal(keyOf(findSize(sizes, "抖音 / 小红书 / 视频号 · 3:4")), "1200x1600");   // its caption, in Chinese
  assert.equal(keyOf(findSize(sizes, "wechat article · 2.35:1")), "900x383");   // and in English
  assert.throws(() => findSize(sizes, "16:9"), (e) => e instanceof ToolError && e.code === "invalid_arguments" && /several of the profile's sizes \(1920x1080, 1280x720\)/.test(e.message));
  assert.throws(() => findSize(sizes, "640x480"), /no size "640x480"; its sizes are: 1920x1080 \(Main\), 1280x720, 1080x1920/);
  assert.throws(() => findSize(sizes, "1:0"), /no size/);
});

test("channels are found by id, name, code or number, and profiles by id or name", () => {
  const p = normalizeProfile({ id: "p1", name: "Studio", categories: [{ id: "a", name: "Vlog", code: "V" }, { id: "b", name: "Tech Talk", code: "TT" }, { id: "c", name: "", code: "" }] });
  const c = p.categories;
  assert.equal(findChannel(c, "b"), 1);
  assert.equal(findChannel(c, " tech talk "), 1);
  assert.equal(findChannel(c, "tt"), 1);
  assert.equal(findChannel(c, 3), 2);
  assert.equal(findChannel(c, "01"), 0);
  assert.throws(() => findChannel(c, "Music"), (e) => e.code === "invalid_arguments" && /No channel "Music" in this profile; its channels are: 1\. Vlog \(id a\), 2\. Tech Talk \(id b\), 3\. — \(id c\)\./.test(e.message));
  const q = normalizeProfile({ id: "p2", name: "studio" }), r = normalizeProfile({ id: "p3", name: "Other" });
  assert.equal(findProfile([p, r], "Studio"), p);
  assert.equal(findProfile([p, q, r], "p2"), q);
  assert.throws(() => findProfile([p, q, r], "STUDIO"), /Several profiles are called "STUDIO"; name one by id: p1, p2/);
  assert.throws(() => findProfile([p, r], "nope"), /No profile "nope"; the profiles are: Studio \(id p1\), Other \(id p3\)\./);
});

test("a lettering's letter keys are those the weave window offers: by line, the letter, its count; spaces left out", () => {
  const words = "Hello *world*\n你好 你";
  const expected = parseTitle(words).flatMap((runs, row) => { const cells = lineCells(runs); return keysOf(cells, row).filter((k, i) => !/^\s+$/.test(cells[i].ch)); });
  assert.deepEqual(letterKeysOf(words), expected);
  assert.deepEqual(letterKeysOf(words).slice(0, 5), ["0|H|1", "0|e|1", "0|l|1", "0|l|2", "0|o|1"]);
  assert.ok(letterKeysOf(words).includes("1|你|2"));
  assert.deepEqual(letterKeysOf(""), []);
});

/**
 * A stand-in for what app.js hands the commands (API): the sample profile with a cover on its second channel holding a
 * text layer and a sticker, a history of three steps at its second, and the window's state as plain fields.
 */
async function fakeApi() {
  const { sampleProfile } = await import("../ui/js/presets.js");
  const { normalizeCover, normalizeSettings } = await import("../ui/js/store.js");
  const { newLayer } = await import("../ui/js/layers.js");
  const p = normalizeProfile(sampleProfile("en")), other = normalizeProfile({ id: "two", name: "Second", categories: [{ id: "x", name: "Only" }] });
  const cover = normalizeCover({ catId: p.categories[1].id, title: "Hello *world*\nagain", subtitle: "Sub", tag: "EP.02" }, p);
  const text = newLayer("text", { text: "ON *A* PLATE", plate: true, plateInk: "#ffffff" }), sticker = newLayer("asset", { ref: { kind: "sticker", id: "burst" }, tint: true });
  cover.layers.splice(cover.layers.length - 1, 0, text, sticker);
  const S = { profiles: [p, other], profile: p, cover, covers: { [cover.catId]: cover }, settings: normalizeSettings({ exportSizes: { [p.id]: { "900x383": false } } }), hist: ["a", "b", "c"], histIdx: 1,
    library: [{ pid: "pic1", name: "Beach", kind: "upload", at: 1700000000000 }, { pid: "pic2", name: "", kind: "ai", at: 0 }], systemFonts: ["Helvetica", "PingFang SC", "Menlo"], importedFonts: ["My Font"],
    latinFonts: new Set(["Bebas Neue", "Helvetica"]), assetFolders: [], sel: "1920x1080", layerId: "title", picked: [], ai: {}, imageAi: {} };
  const travels = [], calls = [];
  const { adjust, insertAbove, moveLayer, stepIndex, duplicate, isRemovable } = await import("../ui/js/layers.js");
  const { virtualSize } = await import("../ui/js/layout.js");
  const frame = () => { const z = S.profile.sizes.find((s) => keyOf(s) === S.sel) || S.profile.sizes[0], [vw, vh] = virtualSize(z.w, z.h); return { vw, vh, key: keyOf(z), catId: S.cover.catId, group: [{ key: keyOf(z), vw, vh }] }; };
  // what changes the window, much as app.js does it, each call noted in `calls`
  const changes = {
    touch: (f) => calls.push(["touch", f]), toast: (m) => calls.push(["toast", m]),
    switchChannel: async (id) => { calls.push(["switchChannel", id]); S.cover = S.covers[id] || (S.covers[id] = normalizeCover({ catId: id }, S.profile)); S.layerId = "title"; },
    switchProfile: async (id) => { calls.push(["switchProfile", id]); S.profile = S.profiles.find((q) => q.id === id); S.covers = {}; const c = normalizeCover({ catId: S.profile.categories[0].id }, S.profile); S.covers[c.catId] = S.cover = c; },
    edit: (L, patch, scope) => { calls.push(["edit", L.id, patch, scope]); adjust(L, frame(), scope, patch); },
    addLayer: (L, above) => { calls.push(["addLayer", L.type, above]); insertAbove(S.cover.layers, above, L); S.layerId = L.id; return L; },
    addAsset: (ref, at, above) => { const L = newLayer("asset", { ref, tint: true }); if (at) { L.t.all.x = at.x; L.t.all.y = at.y; } if (ref.kind === "sticker") L.t.all.s = 0.3; return changes.addLayer(L, above); },
    removeLayer: (id) => { calls.push(["removeLayer", id]); S.cover.layers = S.cover.layers.filter((l) => l.id !== id && l.of !== id); S.layerId = "bg"; },
    duplicateLayer: (id) => { calls.push(["duplicateLayer", id]); const c = duplicate(S.cover.layers.find((l) => l.id === id)); insertAbove(S.cover.layers, id, c); S.layerId = c.id; return c; },
    shiftLayer: (dir, id) => { calls.push(["shiftLayer", dir, id]); const to = stepIndex(S.cover.layers, id, dir, S.cover.catId); return to > 0 && moveLayer(S.cover.layers, id, to); },
    restack: (id, to) => { calls.push(["restack", id, to]); return moveLayer(S.cover.layers, id, to); },
    selectSize: (k) => { calls.push(["selectSize", k]); S.sel = k; },
  };
  const api = {
    ...changes, frame, cat: () => S.profile.categories.find((c) => c.id === S.cover.catId), selSize: () => S.profile.sizes.find((z) => keyOf(z) === S.sel), sizeKeys: () => S.profile.sizes.map(keyOf),
    drawnNow: () => ({ _hits: [], _virtual: [frame().vw, frame().vh] }), inColumns: (L) => L.vertical === true, owner: (L) => L, passivesOf: () => [], fxSeedOf: () => 4242, alignedT: () => null, isRemovable,
    S, CAN: { cut: true, outlines: false, saveFiles: true }, HOST: "tauri", appVersion: async () => "0.3.1", BUNDLED_FONTS: ["Noto Sans SC", "Bebas Neue", "JetBrains Mono"],
    cutReady: () => true, cutEngine: () => "vision", catIndex: () => S.profile.categories.findIndex((c) => c.id === S.cover.catId), channelOf: (q) => q.categories[0].id,
    layerName: (L) => `name of ${L.id}`, copiable: (L) => L.type !== "bg" && L.type !== "frame", pickedIds: () => (S.picked.length > 1 ? [...S.picked] : S.layerId === "bg" ? [] : [S.layerId]),
    coverOf: async (q, catId) => (q === p && S.covers[catId]) || normalizeCover({ catId }, q), layer: (id) => S.cover.layers.find((l) => l.id === id) || null,
    commitPending: () => travels.push("commit"), timeTravel: async (d) => { travels.push(d); S.histIdx += d; },
    selectLayer: (id) => { S.layerId = id; S.picked = []; }, pickLayers: (ids) => { S.picked = ids; S.layerId = ids.at(-1); },
  };
  return { api, S, p, other, text, sticker, travels, calls, changes };
}

/** The tools still to be done: each answers unavailable. One done is taken off the list; one forgotten fails the test below. */
const PENDING = ["place_layer", "set_layer_effect", "set_layer_font", "set_layer_bend", "set_layer_color", "show_layer", "add_layer", "remove_layer", "reorder_layer", "add_photo", "crop_photo", "cut_out", "weave", "surprise", "pick_hand", "apply_cover_json", "open_project", "batch_covers", "export"];
test("every tool has a command; those not done yet are these, and answer that they are not, before touching anything", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const cmds = makeCommands(new Proxy({}, { get: () => () => {} }));
  assert.deepEqual(Object.keys(cmds).sort(), TOOLS.map((d) => d.name).sort());
  assert.deepEqual(TOOLS.filter((d) => cmds[d.name].pending).map((d) => d.name), PENDING, "the tools not done yet");
  assert.equal(TOOLS.length - PENDING.length, 12);
  for (const n of PENDING) assert.deepEqual(await cmds[n]({}), toError("unavailable", "not implemented yet"), n);
});

test("the read-only commands answer from the state as it is, and read another channel without switching to it", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, p, other, text, sticker } = await fakeApi(), cmds = makeCommands(api), was = JSON.stringify(S);
  const ctx = (await cmds.get_context({})).structuredContent;
  assert.deepEqual(ctx.app, { version: "0.3.1", host: "tauri" });
  assert.equal(ctx.can.live, true); assert.equal(ctx.can.cutReady, true); assert.equal(ctx.can.outlines, false);
  assert.deepEqual(ctx.profiles.map((x) => x.id), [p.id, "two"]);
  assert.deepEqual(ctx.profiles[0].channels.map((c) => c.id), p.categories.map((c) => c.id));
  assert.deepEqual(ctx.profiles[0].sizes.map((z) => z.key), p.sizes.map((z) => `${z.w}x${z.h}`));
  assert.deepEqual(ctx.profiles[0].sizes.map((z) => z.ticked), p.sizes.map((z) => `${z.w}x${z.h}` !== "900x383"));
  assert.equal(ctx.profiles[0].sizes[3].orient, "tall");
  assert.deepEqual(ctx.current, { profile: p.id, channel: S.cover.catId, size: "1920x1080", scope: S.settings.scope, layer: "title", layers: ["title"] });
  assert.deepEqual(ctx.history, { canUndo: true, canRedo: true });
  const cover = (await cmds.get_cover({ letters: true })).structuredContent;
  assert.equal(cover.channel, S.cover.catId); assert.equal(cover.title, "Hello *world*\nagain");
  assert.deepEqual(cover.layers.map((l) => l.id), S.cover.layers.map((l) => l.id), "bottom first, as the cover has them");
  const L = (id) => cover.layers.find((l) => l.id === id);
  assert.equal(L("title").kind, "layout"); assert.equal(L("title").removable, false); assert.equal(L("title").fx, "auto"); assert.equal(L("title").ink, "auto");
  assert.equal(L("graphic").included, false, "left out of the cover"); assert.ok(!("included" in L("bg")));
  assert.equal(L(text.id).kind, "free"); assert.equal(L(text.id).plate, true); assert.equal(L(text.id).plateInk, "#ffffff"); assert.equal(L(text.id).text, "ON *A* PLATE");
  assert.deepEqual(L(text.id).letterKeys, letterKeysOf("ON *A* PLATE"));
  assert.deepEqual(L("title").letterKeys, letterKeysOf("Hello *world*\nagain"));
  assert.deepEqual(L(sticker.id).ref, { kind: "sticker", id: "burst" }); assert.equal(L(sticker.id).tint, true);
  assert.deepEqual(L(sticker.id).place, sticker.t.all); assert.equal(L(sticker.id).sizes, "all");
  assert.ok(!("raw" in cover) && !("letterKeys" in (await cmds.get_cover({})).structuredContent.layers.find((l) => l.id === "title")));
  assert.deepEqual((await cmds.get_cover({ raw: true })).structuredContent.raw, JSON.parse(JSON.stringify(S.cover)));
  const first = (await cmds.get_cover({ channel: 1 })).structuredContent;   // another channel, one with no cover yet: a new one
  assert.equal(first.channel, p.categories[0].id); assert.equal(S.cover.catId, p.categories[1].id, "the window stays where it was");
  assert.equal((await cmds.get_cover({ profile: "Second" })).structuredContent.channel, "x");
  await assert.rejects(cmds.get_cover({ channel: "nope" }), /No channel "nope"/);
  const opts = (await cmds.list_options({ only: ["fonts", "effects"], fontQuery: "ping" })).structuredContent;
  assert.deepEqual(Object.keys(opts).sort(), ["effects", "fonts"]);
  assert.deepEqual(opts.fonts.system, ["PingFang SC"]); assert.equal(opts.fonts.systemTotal, 3); assert.deepEqual(opts.fonts.imported, ["My Font"]);
  assert.deepEqual(opts.effects.find((e) => e.id === "spiky"), { id: "spiky", name: "Spiky", zh: "刺边", kind: "outline", seeded: true, needsOutlines: true, available: false });
  const all = (await cmds.list_options({})).structuredContent;
  assert.deepEqual(all.looks.map((l) => l.id), LOOK_IDS);
  assert.ok(all.looks.find((l) => l.id === "cyber").params.some((d) => d.key === "split" && d.max === 2));
  assert.deepEqual(all.bends.map((b) => b.id), ["none", ...BEND_IDS]);
  assert.deepEqual(all.locks.map((l) => l.id), SURPRISE_LOCKS);
  assert.ok(all.platforms.find((x) => x.id === "bili").wide.includes("16:9"));
  const lib = (await cmds.list_library({ query: "beach" })).structuredContent;
  assert.deepEqual(lib.photos, [{ pid: "pic1", name: "Beach", kind: "upload", at: new Date(1700000000000).toISOString() }]);
  assert.equal((await cmds.list_library({ kind: "stickers", limit: 5 })).structuredContent.stickers.length, 5);
  assert.equal((await cmds.list_library({ kind: "stickers", limit: 5 })).structuredContent.more.stickers, 67);
  assert.equal(JSON.stringify(S), was, "nothing read was changed");
  assert.deepEqual((await cmds.get_selection({})).structuredContent, ctx.current);
  void other;
});

test("select_layer selects as the user would, undo and redo go as far as the history does", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, text, travels } = await fakeApi(), cmds = makeCommands(api);
  assert.equal((await cmds.select_layer({ layer: text.id, size: "9:16" })).structuredContent.layer, text.id);
  assert.equal(S.sel, "1080x1920");
  assert.deepEqual((await cmds.select_layer({ layers: ["title", text.id] })).structuredContent.layers, ["title", text.id]);
  await assert.rejects(cmds.select_layer({ layer: "nope" }), (e) => e.code === "invalid_arguments" && /No layer "nope" on this cover; its layers are: bg, accent/.test(e.message));
  await assert.rejects(cmds.select_layer({ layers: ["bg", "title"] }), /"bg" cannot be selected with other layers/);
  const undo = (await cmds.undo({ steps: 5 })).structuredContent;
  assert.deepEqual(undo, { index: 0, steps: 1, canUndo: false, canRedo: true });
  assert.deepEqual(travels, ["commit", -1], "the pending change made a step first, then one step back: there was no other");
  assert.equal((await cmds.undo({})).content[0].text, "Nothing to undo.");
  assert.deepEqual((await cmds.redo({ steps: 2 })).structuredContent, { index: 2, steps: 2, canUndo: true, canRedo: false });
  // a call that is wrong changes nothing: the size named is not shown before the layers are found
  S.sel = "1920x1080";
  await assert.rejects(cmds.select_layer({ size: "9:16", layers: ["bg", "title"] }), /cannot be selected with other layers/);
  assert.equal(S.sel, "1920x1080");
});

test("what a tool needs: a flag set to false asks for nothing, any other false says something", () => {
  assert.deepEqual(FLAGS, ["reset", "resetParams", "reshuffle", "off"]);
  assert.equal(checkCall(TOOL_BY.set_look, { resetParams: false }), "Give at least one of: look, params, theme, seed, resetParams.");
  assert.equal(checkCall(TOOL_BY.place_layer, { layer: "x", reset: false }), "Give at least one of: x, y, scale, rotate, stretchX, stretchY, move, scaleBy, rotateBy, reset.");
  assert.equal(checkCall(TOOL_BY.crop_photo, { layer: "x", crop: { x: 0, y: 0, w: 0.5, h: 0.5 }, reset: false }), null);
  for (const [tool, args] of [["show_layer", { visible: false }], ["show_layer", { locked: false }], ["show_layer", { included: false }], ["set_layer_color", { plate: false }], ["set_layer_color", { tint: false }]])
    assert.equal(checkCall(TOOL_BY[tool], { layer: "x", ...args }), null, `${tool} ${JSON.stringify(args)}: false says something`);
});

test("a change is checked whole before anything is touched: refused, the window stays where it was and nothing is changed", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, text, sticker, calls } = await fakeApi(), cmds = makeCommands(api), was = JSON.stringify(S);
  const refusals = [
    ["set_look", { look: "cyber", params: { nope: 1 } }, /Cyberpunk \(cyber\) has no setting "nope"; its settings are: split, tear/],
    ["set_look", { params: JSON.parse('{"__proto__": 1}') }, /"params.__proto__" is no look's setting/],
    ["set_look", { look: "cyber", params: { split: "x" } }, /"params.split" \(.*\) takes a number/],
    ["set_channel", { channel: "nope", name: "x" }, /No channel "nope"/],
    ["set_text", { title: "x", profile: "nobody" }, /No profile "nobody"/],
  ];
  for (const [tool, args, said] of refusals) await assert.rejects(cmds[tool](args), (e) => e instanceof ToolError && e.code === "invalid_arguments" && said.test(e.message), `${tool} ${JSON.stringify(args)}`);
  assert.deepEqual(calls, [], "nothing that changes anything was called: no switch, no edit, no touch");
  assert.equal(JSON.stringify(S), was, "the state as it was");
});

test("a change does what the editor does, where it is aimed: the window switched there first, one touch, the answer as the schema says", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, p, text, sticker, calls } = await fakeApi(), cmds = makeCommands(api), film = S.cover.catId, used = JSON.stringify(S.settings.lookUse);
  const touched = () => calls.filter((c) => c[0] === "touch").map((c) => c[1]);
  // the words, on another channel: the window goes there first, and says so
  const words = (await cmds.set_text({ channel: 1, title: "New *one*", tag: "EP\n3" })).structuredContent;
  assert.deepEqual(calls.slice(0, 2).map((c) => c[0]), ["switchChannel", "toast"]);
  assert.equal(S.cover.catId, p.categories[0].id); assert.equal(S.cover.title, "New *one*");
  assert.deepEqual(words, { title: "New *one*", subtitle: S.cover.subtitle, tag: "EP 3", warnings: ["The tag is one line: its line breaks became spaces."] });
  assert.deepEqual(touched(), [{ cover: true, panel: true, side: true }]);
  // the look: clamped and said, not counted among the most used
  const look = (await cmds.set_look({ look: "cyber", params: { split: 9, tearClear: 0.4 }, seed: 12, theme: "light" })).structuredContent;
  assert.equal(S.profile.style.look, "cyber"); assert.equal(look.params.split, 2); assert.equal(look.params.tearClear, 1); assert.equal(look.seed, 12); assert.equal(S.profile.style.theme, "light");
  assert.deepEqual(look.warnings, ['"split" goes from 0 to 2: 2, not 9.', '"tearClear" is a switch: 1 (1 on, 0 off).', "Cyberpunk has one ground of its own: the theme shows in the profile's other looks."]);
  assert.equal(JSON.stringify(S.settings.lookUse), used);
  assert.equal((await cmds.set_look({ resetParams: true })).structuredContent.params.split, lookOf("cyber").split, "back to its own");
  // a channel: the window shows it, its colour as the profile keeps colours
  assert.deepEqual((await cmds.set_channel({ channel: "Film Stories", name: "Films", color: "#AABBCC" })).structuredContent, { id: film, name: "Films", sub: p.categories[1].sub, code: p.categories[1].code, color: "#aabbcc" });
  assert.equal(S.cover.catId, film);
  assert.ok(!calls.some((c) => c[0] === "switchProfile"), "never another profile");
});
/** Look `id`'s own settings. */
const lookOf = (id) => Object.fromEntries(LOOKS[id].params.map((d) => [d.key, d.def]));

test("the queue runs one call at a time, in order; a call cancelled while it waits never runs", async () => {
  const { makeQueue, CANCELLED } = await import("../ui/js/agent.js");
  const q = makeQueue(), log = [];
  let open = 0, most = 0;
  const job = (name, ms, fail = false) => async () => { open++; most = Math.max(most, open); log.push(`${name}+`); await new Promise((r) => setTimeout(r, ms)); log.push(`${name}-`); open--; if (fail) throw new Error(name); return name; };
  const a = q.push(1, job("a", 30)), b = q.push(2, job("b", 5, true)), c = q.push(3, job("c", 1)), d = q.push(4, job("d", 1));
  assert.equal(q.waiting, 4);
  assert.equal(q.cancel(3), true);
  assert.equal(q.cancel(3), false, "once");
  assert.equal(await c, CANCELLED, "answered at once");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(q.running, 1);
  assert.equal(q.cancel(1), false, "a call running is not stopped");
  assert.equal(await a, "a");
  await assert.rejects(b, /b/);
  assert.equal(await d, "d", "a failure before it does not hold it up");
  assert.deepEqual(log, ["a+", "a-", "b+", "b-", "d+", "d-"]);
  assert.equal(most, 1);
  assert.equal(q.running, null); assert.equal(q.waiting, 0);
});

test("whenIdle waits while the user is busy or has just touched the window, telling the caller every few seconds, and gives up with the reason", async () => {
  const { whenIdle, QUIET } = await import("../ui/js/agent.js");
  let clock = 0, reasons = ["a dialog is open", "a dialog is open", null], told = [];
  const env = { now: () => clock, sleep: async (ms) => { clock += ms; }, waiting: (r, ms) => told.push([r, ms]) };
  assert.equal(await whenIdle(false, 1000, { ...env, busy: () => reasons.shift() ?? null }), null);
  assert.equal(clock, 200, "polled every 100 ms");
  clock = 0; told = [];
  const strict = [];
  assert.equal(await whenIdle(true, 12000, { ...env, busy: (s) => { strict.push(s); return "Settings is open"; } }), "Settings is open");
  assert.ok(clock >= 12000 && strict.every((s) => s === true));
  assert.deepEqual(told.map(([r, ms]) => [r, ms]), [["Settings is open", 5000], ["Settings is open", 10000]]);
  clock = 0;
  let last = -100;   // input 100 ms before: waits till QUIET has passed
  assert.equal(await whenIdle(false, 5000, { ...env, quietFor: () => clock - last }), null);
  assert.equal(clock, QUIET - 100);
});

test("the dispatcher checks a call, waits for the user, holds the window and makes one step of a change, and answers each way the host expects", async () => {
  const { makeAgent, CANCELLED } = await import("../ui/js/agent.js");
  const seen = [], steps = [];
  let busyFor = 0;
  const commands = Object.fromEntries(TOOLS.map((d) => [d.name, async (args) => { seen.push([d.name, args]); return toResult({ structured: { ok: d.name } }); }]));
  commands.set_text = async () => toError("unavailable", "not implemented yet");
  commands.undo = async () => { throw new ToolError("invalid_arguments", "nothing to undo"); };
  commands.redo = async () => { throw new Error("boom"); };
  const agent = makeAgent({ commands, busy: () => (busyFor-- > 0 ? "a dialog is open" : null), step: async (fn) => { steps.push("in"); try { return await fn(); } finally { steps.push("out"); } }, quietFor: () => Infinity, host: "server" });
  const call = (tool, args, progress) => agent.handle({ id: tool, tool, args }, { progress });
  assert.deepEqual(await call("nope", {}), { id: "nope", ok: false, error: { code: "unknown_tool", message: "Unknown tool: nope" } });
  assert.deepEqual(await call("render_preview", { maxSide: 1 }), { id: "render_preview", ok: false, error: { code: "invalid_arguments", message: '"maxSide" must be at least 128 (got 1).' } });
  assert.equal((await call("get_selection", {})).error.code, "not_allowed", "a live tool, on a server");
  const got = await call("get_cover", { channel: 2 });
  assert.deepEqual(got, { id: "get_cover", ok: true, result: toResult({ structured: { ok: "get_cover" } }) });
  assert.deepEqual(seen.at(-1), ["get_cover", { channel: 2 }]);
  assert.deepEqual(steps, [], "a read is no step");
  await call("set_look", { look: "cyber" });
  assert.deepEqual(steps, ["in", "out"], "a change is one step");
  assert.deepEqual(await call("set_text", { title: "x" }), { id: "set_text", ok: false, error: { code: "unavailable", message: "not implemented yet" } });
  assert.deepEqual((await call("export", {})).ok, true);
  assert.deepEqual(steps, ["in", "out", "in", "out"], "export makes no step");
  const agentDesk = makeAgent({ commands, quietFor: () => Infinity });
  assert.deepEqual((await agentDesk.handle({ id: 1, tool: "undo", args: {} })).error, { code: "invalid_arguments", message: "nothing to undo" });
  const said = console.error;
  console.error = () => {};   // the dispatcher logs what it did not expect
  try { assert.deepEqual((await agentDesk.handle({ id: 2, tool: "redo", args: {} })).error, { code: "failed", message: "redo failed: boom" }); } finally { console.error = said; }
  // waits while the user is busy, and says so
  busyFor = 3;
  const progress = [];
  assert.equal((await call("list_options", {}, (p) => progress.push(p))).ok, true);
  // cancelled while waiting behind another: never runs, nothing answered
  busyFor = 2;
  const first = call("get_context", {}), second = agent.handle({ id: "later", tool: "list_library", args: {} });
  assert.equal(agent.cancel("later"), true);
  assert.equal(await second, CANCELLED);
  assert.equal((await first).ok, true);
  assert.ok(!seen.some(([n]) => n === "list_library"));
});

test("every tool that changes something says in both languages what it is doing, for the pill over the window", async () => {
  const { keys } = await import("../ui/js/i18n.js");
  const have = new Set(keys());
  for (const d of TOOLS) if (!d.annotations.readOnlyHint) assert.ok(have.has(`agent.step.${d.name}`), d.name);
  for (const k of ["agent.working", "agent.wait", "agent.switched", "agent.exporting"]) assert.ok(have.has(k), k);
  for (const k of have) if (k.startsWith("agent.step.")) assert.ok(TOOL_BY[k.slice(11)] && !TOOL_BY[k.slice(11)].annotations.readOnlyHint, `${k}: a tool that changes something`);
});

test("render helpers: the width for a longer side, the layers' boxes as shares of the image, a contact sheet's plan", () => {
  assert.equal(widthFor({ w: 1920, h: 1080 }, 1024), 1024);
  assert.equal(Math.round((widthFor({ w: 1080, h: 1920 }, 1024) * 1920) / 1080), 1024);   // drawCover's height from it
  const boxes = boxesOf([{ id: "bg", type: "bg", cx: 960, cy: 540, hw: 960, hh: 540 }, { id: "title", type: "title", cx: 480, cy: 270, hw: 192, hh: 54, r: -4.04 }, { id: "title", type: "title", cx: 1, cy: 1, hw: 1, hh: 1 }, { type: "x", cx: 0, cy: 0, hw: 1, hh: 1 }], [1920, 1080]);
  assert.deepEqual(boxes, [{ id: "title", x: 0.25, y: 0.25, w: 0.2, h: 0.1, r: -4 }]);
  const sizes = [{ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, { w: 1200, h: 1200 }, { w: 1200, h: 1600 }, { w: 900, h: 383 }, { w: 1600, h: 1200 }];
  for (const side of [128, 512, 1024, 2048]) {
    const plan = sheetPlan(sizes, side);
    assert.equal(plan.tiles.length, sizes.length);
    assert.ok(plan.width <= side * 1.5 && plan.height <= side * 1.5, `${side}: within the square`);
    plan.tiles.forEach((t, i) => { assert.equal(t.h, plan.tile); assert.ok(Math.abs(t.w / t.h - sizes[i].w / sizes[i].h) < 0.05); assert.ok(t.x + t.w <= plan.width && t.y + t.h <= plan.height); });
    for (let i = 1; i < plan.tiles.length; i++) { const a = plan.tiles[i - 1], b = plan.tiles[i]; assert.ok(b.y > a.y || b.x >= a.x + a.w, "no two overlap"); }
  }
  assert.ok(sheetPlan([{ w: 1920, h: 1080 }], 1024).tile >= 400, "one size alone is drawn large");
});
