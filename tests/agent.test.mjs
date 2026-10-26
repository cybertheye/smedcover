// Unit tests for the agent tools: their definitions (tools.js), what ui/tools.json holds, the argument check, the
// helpers the commands find things by, and the answers' shapes. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOOLS, TOOL_BY, ERRORS, INSTRUCTIONS, FLAGS, toolsJson, toolsText, checkArgs, checkCall, toResult, toError, isError, ToolError, findSize, findChannel, findProfile, letterKeysOf, boxesOf, sheetPlan, widthFor, keyOf, placeAt, placePatch, nearNames, idsSaid, imageType, coverDiff } from "../ui/js/tools.js";
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

test("checkArgs counts a string's characters only against a length limit, and without spreading it: a 40 MB picture is checked at once", () => {
  const big = "A".repeat(40 * 1024 * 1024), s = TOOL_BY.add_photo.inputSchema, cap = s.properties.source.properties.data.maxLength;
  assert.equal(cap, 24 * 1024 * 1024, "a picture inline: 24 Mi characters at most");
  assert.equal(TOOL_BY.open_project.inputSchema.properties.project.maxLength, cap, "and a project's text");
  const within = "A".repeat(20 * 1024 * 1024);
  let t0 = performance.now();
  assert.equal(checkArgs(s, { source: { data: within } }), null);
  assert.ok(performance.now() - t0 < 50, `within the limit in UTF-16 units: not counted (${Math.round(performance.now() - t0)} ms)`);
  assert.equal(checkArgs(s, { source: { data: big } }), `"source.data" must be at most ${cap} characters long (it has ${big.length}).`);
  assert.match(checkArgs(TOOL_BY.open_project.inputSchema, { project: big }), /"project" must be at most 25165824 characters long/);
  assert.equal(checkArgs(TOOL_BY.open_project.inputSchema, { project: { kind: "project" } }), null, "an object has no length");
  t0 = performance.now();
  assert.equal(checkArgs({ type: "string", maxLength: 50 * 1024 * 1024 }, big), null);
  assert.equal(checkArgs({ type: "string", maxLength: 1000 }, big), '"arguments" must be at most 1000 characters long (it has more than 2000).');
  assert.equal(checkArgs({ type: "string", maxLength: 30 * 1024 * 1024 }, big), `"arguments" must be at most ${30 * 1024 * 1024} characters long (it has ${40 * 1024 * 1024}).`);
  assert.equal(checkArgs({ type: "string", minLength: 3 }, big), null);
  assert.match(checkArgs(TOOL_BY.set_look.inputSchema, { look: big }), /^"look" must be one of: .*; got "A{56}…\.$/, "not made JSON of for each look");
  assert.ok(performance.now() - t0 < 1500, `with limits: counted no further than needed (${Math.round(performance.now() - t0)} ms)`);
  // characters, as JSON Schema counts them: an astral one (two UTF-16 units) is one
  const astral = "😀👍🏽𝒳🎉";   // 5 code points, 10 units
  assert.equal(astral.length, 10); assert.equal([...astral].length, 5);
  assert.equal(checkArgs({ type: "string", maxLength: 5 }, astral), null);
  assert.equal(checkArgs({ type: "string", maxLength: 4 }, astral), '"arguments" must be at most 4 characters long (it has 5).');
  assert.equal(checkArgs({ type: "string", minLength: 5 }, astral), null);
  assert.equal(checkArgs({ type: "string", minLength: 6 }, astral), '"arguments" must be at least 6 characters long.');
  assert.equal(checkArgs({ type: "string", minLength: 2, maxLength: 2 }, "\ud83d"), '"arguments" must be at least 2 characters long.', "a lone surrogate is one");
  assert.equal(checkArgs({ type: "string", maxLength: 1 }, "\ud83d\ud83d"), '"arguments" must be at most 1 characters long (it has 2).');
  assert.equal(checkArgs({ type: "string", minLength: 1 }, ""), '"arguments" must be at least 1 characters long.');
  assert.match(checkArgs(TOOL_BY.set_text.inputSchema, { tag: "😀".repeat(201) }), /"tag" must be at most 200 characters long \(it has 201\)/);
  assert.equal(checkArgs(TOOL_BY.set_text.inputSchema, { tag: "😀".repeat(200) }), null);
  // a long list is checked for repeats in one pass
  t0 = performance.now();
  assert.match(checkArgs({ type: "array", uniqueItems: true }, [...Array.from({ length: 200000 }, (_, i) => `x${i}`), "x7"]), /lists "x7" twice/);
  assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
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

test("every tool has a command, and every command is a tool's: none answers that it is not done yet", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const cmds = makeCommands(new Proxy({}, { get: () => () => {} }));
  assert.deepEqual(Object.keys(cmds).sort(), TOOLS.map((d) => d.name).sort());
  for (const d of TOOLS) assert.equal(typeof cmds[d.name], "function", d.name);
  assert.ok(TOOLS.every((d) => !cmds[d.name].pending), "nothing pending");
  const src = await readFile(new URL("../ui/js/commands.js", import.meta.url), "utf8");
  assert.ok(!/not implemented yet|notYet/.test(src), "no stand-in left");
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
  assert.deepEqual(opts.fonts.latin, ["Bebas Neue"], "latin: of those listed (Helvetica, filtered out, is not)");
  { // a well-stocked computer: 700 installed, most without Chinese; the answer lists 200 of them, and latin no more than it lists
    const keep = [S.systemFonts, S.latinFonts];
    S.systemFonts = Array.from({ length: 700 }, (_, i) => `Installed Family Number ${String(i).padStart(3, "0")}`); S.latinFonts = new Set([...S.systemFonts.slice(0, 650), "Bebas Neue"]);
    const many = (await cmds.list_options({})).structuredContent, fonts = many.fonts;
    assert.deepEqual([fonts.system.length, fonts.systemMatched, fonts.systemTotal], [200, 700, 700]);
    assert.ok(fonts.latin.every((f) => fonts.system.includes(f) || fonts.bundled.includes(f)) && fonts.latin.length === 201, `${fonts.latin.length} latin`);
    assert.ok(JSON.stringify(fonts).length < 16000, `the fonts are ${JSON.stringify(fonts).length} characters`);
    assert.ok(JSON.stringify(many).length < 24000, `list_options is ${JSON.stringify(many).length} characters`);
    [S.systemFonts, S.latinFonts] = keep;
  }
  assert.deepEqual(opts.effects.find((e) => e.id === "spiky"), { id: "spiky", name: "Spiky", kind: "outline", seeded: true, needsOutlines: true, available: false });
  // every look in a line, its settings only when it is asked for alone: the whole answer a few thousand tokens, not sixteen
  const all = (await cmds.list_options({})).structuredContent, size = JSON.stringify(all).length;
  assert.deepEqual(all.looks.map((l) => l.id), LOOK_IDS);
  assert.ok(size < 24000, `list_options is ${size} characters`);
  assert.ok(all.looks.every((l) => !("params" in l) && !("scene" in l) && !("zh" in l) && l.about && !l.about.includes("\n") && l.about.length < 200), "a look in a line");
  assert.equal(all.looks.find((l) => l.id === "cel").about, "Drawn like animation cels — for explainers, reviews, unboxings, everyday vlogs.");
  assert.ok(!/[一-鿿]/.test(JSON.stringify({ ...all, fonts: null })), "no Chinese names (the fonts are their own)");
  const cyber = (await cmds.list_options({ look: "cyber" })).structuredContent;
  assert.deepEqual(Object.keys(cyber), ["looks"], "a look alone: the looks alone");
  assert.equal(cyber.looks.length, 1); assert.ok(cyber.looks[0].params.some((d) => d.key === "split" && d.max === 2)); assert.equal(cyber.looks[0].about, LOOKS.cyber.about.en);
  assert.deepEqual(Object.keys((await cmds.list_options({ look: "cel", only: ["looks", "bends"] })).structuredContent).sort(), ["bends", "looks"]);
  assert.deepEqual(all.bends.map((b) => b.id), ["none", ...BEND_IDS]);
  assert.deepEqual(all.locks.map((l) => l.id), SURPRISE_LOCKS);
  assert.ok(all.platforms.find((x) => x.id === "bili").wide.includes("16:9"));
  const lib = (await cmds.list_library({ query: "beach" })).structuredContent;
  assert.deepEqual(lib.photos, [{ pid: "pic1", name: "Beach", kind: "upload", at: new Date(1700000000000).toISOString() }]);
  S.library.push({ pid: "far", name: "Far future", kind: "upload", at: 9e15 });   // past what a date can be
  assert.deepEqual((await cmds.list_library({ query: "future" })).structuredContent.photos, [{ pid: "far", name: "Far future", kind: "upload", at: null }]);
  S.library.pop();
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

test("place_layer's arithmetic: what is asked is reached through adjust and resolve, in every scope, for a layer added and a layout part", async () => {
  const { newLayer, adjust } = await import("../ui/js/layers.js");
  const { virtualSize } = await import("../ui/js/layout.js");
  const at = (key) => { const [w, h] = key.split("x").map(Number), [vw, vh] = virtualSize(w, h); return { vw, vh, key }; };
  const here = at("1920x1080"), other = at("1600x1200"), fr = { ...here, catId: "c1", group: [here, other] }, there = { ...other, catId: "c1" };
  const asks = [{ x: 0.3, y: 0.7, scale: 0.8, rotate: -12, stretchX: 1.5, stretchY: 0.9 }, { move: { dx: 0.05, dy: -0.1 }, scaleBy: 1.25, rotateBy: 30 }, { x: -0.2 }, { scale: 2 }];
  for (const type of ["text", "photo", "title", "graphic"]) for (const scope of ["all", "orient", "size"]) for (const ask of asks) {
    const L = newLayer(type);
    L.t.by["1920x1080"] = { dx: 12, dy: -8, s: 1.1, r: 3, kx: 1, ky: 1.2 };   // tuned at this size already
    const was = placeAt(L, fr), far = placeAt(L, there), { patch, want } = placePatch(L, fr, ask);
    adjust(L, fr, scope, patch);
    const now = placeAt(L, fr), then = placeAt(L, there), name = `${type} ${scope} ${JSON.stringify(ask)}`;
    for (const [k, v] of Object.entries(want)) assert.ok(Math.abs(now[k] - v) < 1e-9, `${name}: ${k} ${now[k]} ≠ ${v}`);
    if (ask.move) { assert.ok(Math.abs(want.x - (was.x + 0.05)) < 1e-12 && Math.abs(want.s - was.s * 1.25) < 1e-12 && Math.abs(want.r - (was.r + 30)) < 1e-12, `${name}: relative to where it was`); }
    for (const k of ["x", "y", "s", "r", "kx", "ky"]) if (!(k in want)) assert.ok(Math.abs(now[k] - was[k]) < 1e-9, `${name}: ${k} left as it was`);
    // the size facing another way: moved as far across its own canvas by "all" and "orient", left alone by "size"
    if (scope === "size") assert.deepEqual(then, far, `${name}: another size untouched`);
    else if ("x" in want) assert.ok(Math.abs(then.x - far.x - (now.x - was.x)) < 1e-9, `${name}: another size moved as far`);
  }
  const L = newLayer("text");
  assert.deepEqual(placePatch(L, fr, { x: 0.5, scale: placeAt(L, fr).s }).patch, {}, "asked where it is: nothing to do");
  assert.deepEqual(placeAt(L, fr), { x: 0.5, y: 0.42, s: 0.35, r: 0, kx: 1, ky: 1 }, "a layer added: its centre, its scale without the canvas's height");
});

test("near names for a font not there, ids said for a message; set_layer_font takes vertical alone", () => {
  assert.deepEqual(nearNames("Helvetic", ["Menlo", "Helvetica Neue", "Helvetica"]), ["Helvetica", "Helvetica Neue"]);
  assert.deepEqual(nearNames("pingfang", ["PingFang TC", "Menlo", "PingFang SC"]), ["PingFang TC", "PingFang SC"]);
  assert.deepEqual(nearNames("Menol", ["Arial", "Menlo", "Monaco"]), ["Menlo"]);
  assert.deepEqual(nearNames("", ["Menlo"]), []);
  assert.equal(idsSaid(["a", "b", "c"], 2), "a, b … and 1 more");
  assert.equal(idsSaid(["a", "b"]), "a, b");
  assert.equal(checkCall(TOOL_BY.set_layer_font, { layer: "x", vertical: false }), null);
  assert.equal(checkCall(TOOL_BY.set_layer_font, { layer: "x" }), "Give at least one of: font, vertical.");
});

test("a change is checked whole before anything is touched: refused, the window stays where it was and nothing is changed", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, text, sticker, calls } = await fakeApi(), cmds = makeCommands(api), was = JSON.stringify(S);
  const refusals = [
    ["remove_layer", { layer: "title" }, /"title" is one of the layout's own parts: it cannot be removed/],
    ["remove_layer", { layer: "bg", channel: 1 }, /bg is the ground: it cannot be removed/],
    ["place_layer", { layer: "frame", x: 0.5 }, /The frame follows the template/],
    ["place_layer", { layer: "bg", scale: 2, channel: 1 }, /bg is the ground: it is not placed/],
    ["place_layer", { layer: text.id, x: 0.2, move: { dx: 0.1 } }, /Give "x" or "move.dx", not both/],
    ["place_layer", { layer: text.id, reset: true, scale: 2 }, /"reset" goes alone/],
    ["place_layer", { layer: "nope", x: 0.2, channel: 1 }, /No layer "nope" on this cover; its layers are: bg, accent, .* \(get_cover lists them\)/],
    ["place_layer", { layer: "title", x: 0.2, size: "5:1" }, /The profile has no size "5:1"/],
    ["set_layer_font", { layer: "title", font: "Helvetic", channel: 1 }, /No font "Helvetic" here; near it: Helvetica/],
    ["set_layer_font", { layer: "accent", font: "Menlo" }, /"accent" is a layer of type accent, not a lettering layer/],
    ["set_look", { look: "cyber", params: { nope: 1 } }, /Cyberpunk \(cyber\) has no setting "nope"; its settings are: split, tear/],
    ["set_look", { params: JSON.parse('{"__proto__": 1}') }, /"params.__proto__" is no look's setting/],
    ["set_look", { look: "cyber", params: { split: "x" } }, /"params.split" \(.*\) takes a number/],
    ["set_layer_effect", { layer: "title", amount: 1.5 }, /The look's own lettering has no strength to set/],
    ["set_layer_effect", { layer: "title", reshuffle: true }, /deals nothing at random/],
    ["set_layer_effect", { layer: "tag", effect: "plain" }, /"tag" is a layer of type tag, not a headline/],
    ["set_layer_bend", { layer: "title", bend: "none", amount: 1 }, /with bend "none" there is none/],
    ["set_layer_color", { layer: "title", color: "#ff0000" }, /"color" is for a solid layer; "title" is a layer of type title/],
    ["set_layer_color", { layer: "tag", hi: "#ff0000" }, /"hi" is for a headline/],
    ["set_layer_color", { layer: "title", tint: true }, /"tint" is for a vector asset/],
    ["show_layer", { layer: text.id, included: false }, /"included" is for the layout's own parts/],
    ["show_layer", { layer: "graphic", visible: true }, /"graphic" is left out of this cover: bring it back with included: true/],
    ["show_layer", { layer: "bg", opacity: 0.5 }, /bg has no opacity/],
    ["show_layer", { layer: "frame", locked: true }, /frame is never placed by hand/],
    ["show_layer", { layer: "title", sizes: ["5:1"] }, /no size "5:1"/],
    ["add_layer", { kind: "copy", of: "frame" }, /"frame" cannot be copied: the frame is one of a kind/],
    ["add_layer", { kind: "copy" }, /needs "of"/],
    ["add_layer", { kind: "asset", asset: { kind: "sticker", id: "nope" } }, /No sticker "nope"/],
    ["add_layer", { kind: "text", color: "#ffffff" }, /"color" is for kind "solid", not "text"/],
    ["add_layer", { kind: "solid", above: "nope", channel: 1 }, /No layer "nope"/],
    ["reorder_layer", { layer: "bg", to: "top" }, /bg stays at the bottom/],
    ["reorder_layer", { layer: sticker.id, above: sticker.id }, /cannot go above itself/],
    ["set_channel", { channel: "nope", name: "x" }, /No channel "nope"/],
    ["set_text", { title: "x", profile: "nobody" }, /No profile "nobody"/],
  ];
  for (const [tool, args, said] of refusals) await assert.rejects(cmds[tool](args), (e) => e instanceof ToolError && e.code === "invalid_arguments" && said.test(e.message), `${tool} ${JSON.stringify(args)}`);
  await assert.rejects(cmds.set_layer_effect({ layer: "title", effect: "spiky", channel: 1 }), (e) => e.code === "unavailable" && /outlines, which this host cannot read/.test(e.message), "an outline effect where there are none");
  text.locked = true;
  await assert.rejects(cmds.place_layer({ layer: text.id, x: 0.1 }), /is locked in place/);
  text.locked = false;
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
  // a place: at the size asked, which the window then shows, in the scope asked
  calls.length = 0;
  const placed = (await cmds.place_layer({ layer: text.id, x: 0.25, y: 0.75, scale: 0.5, rotate: 10, size: "9:16", scope: "size" })).structuredContent;
  assert.equal(S.sel, "1080x1920"); assert.equal(placed.size, "1080x1920");
  assert.deepEqual(placed.place, { x: 0.25, y: 0.75, s: 0.5, r: 10, kx: 1, ky: 1 });
  assert.deepEqual(text.t.all, { x: 0.5, y: 0.42, s: 0.35, r: 0, kx: 1, ky: 1 }, "scope size: the other sizes as they were");
  assert.deepEqual(calls.filter((c) => c[0] === "edit").map((c) => c[3]), ["size", "size"], "its size and turn, then where it goes");
  await cmds.place_layer({ layer: text.id, reset: true, scope: "size" });
  assert.ok(!text.t.by["1080x1920"], "put back at that size");
  const far = (await cmds.place_layer({ layer: text.id, scale: 20, scaleBy: undefined, x: 3 })).structuredContent;
  assert.deepEqual([far.place.x, far.place.s], [3, 20]);
  const beyond = (await cmds.place_layer({ layer: text.id, move: { dx: 1 } })).structuredContent;
  assert.equal(beyond.place.x, 3); assert.match(beyond.warnings[0], /"x" came to 3, not 4: as far as it goes/);
  // a text effect, as its card: a seeded one takes the seed its card is drawn with
  const title = S.cover.layers.find((l) => l.id === "title");
  assert.equal((await cmds.set_layer_effect({ layer: "title", effect: "ransom", amount: 1.4 })).structuredContent.layer.fx, "ransom");
  assert.equal(title.fxSeed, 4242); assert.equal(title.fxAmt, 1.4);
  await cmds.set_layer_effect({ layer: "title", amount: 1, reshuffle: true });
  assert.ok(!("fxAmt" in title) && title.fxSeed !== 4242, "the strength back to its own, the letters dealt again");
  // a font, matched with the case aside, not among the recent fonts; columns
  const recent = JSON.stringify(S.settings.recentFonts);
  const font = (await cmds.set_layer_font({ layer: "title", font: "helvetica" })).structuredContent;
  assert.equal(title.font, "Helvetica"); assert.match(font.warnings[0], /has no Chinese/); assert.equal(JSON.stringify(S.settings.recentFonts), recent);
  await cmds.set_layer_font({ layer: "title", vertical: true });
  assert.equal(title.font, "Helvetica"); assert.equal(title.vertical, true);
  // lines asked for where the look sets the title in columns of itself (the editor greys Lines and Columns out there): done, and said
  const lookWas = S.profile.style.look, columnsWas = api.inColumns;
  S.profile.style.look = "songke"; api.inColumns = (L) => L.type === "title" || L.vertical === true;
  const lines = (await cmds.set_layer_font({ layer: "title", vertical: false })).structuredContent;
  assert.equal(title.vertical, false);
  assert.ok(lines.warnings.some((w) => /look sets the title and the subtitle in columns itself \(its setting "vertical"\).*set_look with params \{"vertical": 0\}/.test(w)), JSON.stringify(lines.warnings));
  S.profile.style.look = lookWas; api.inColumns = columnsWas; title.vertical = true;
  // a bend takes away a perspective dragged by hand; in columns it is kept for later, and said
  title.reshape = [[0.1, 0]];
  const bent = (await cmds.set_layer_bend({ layer: "title", bend: "arc", amount: 1.5 })).structuredContent;
  assert.deepEqual([title.bend, title.bendAmt, "reshape" in title], ["arc", 1.5, false]); assert.match(bent.warnings[0], /set in columns/);
  await cmds.set_layer_bend({ layer: "title", bend: "none" });
  assert.ok(!("bend" in title) && !("bendAmt" in title));
  // colours, each where the layer has it
  const tx = (await cmds.set_layer_color({ layer: text.id, ink: "#FF0000", plateInk: "auto", hi: "#00ff00" })).structuredContent.layer;
  assert.deepEqual([text.ink, text.hi, "plateInk" in text, tx.ink], ["#ff0000", "#00ff00", false, "#ff0000"]);
  await cmds.set_layer_color({ layer: sticker.id, tint: false });
  assert.equal(sticker.tint, false);
  await cmds.set_layer_color({ layer: sticker.id, tint: true });
  await cmds.set_layer_color({ layer: sticker.id, ink: "#00AA00" });
  assert.deepEqual([sticker.ink, sticker.tint], ["#00aa00", false], "a colour of its own, as Colour → Custom: not the channel's");
  await cmds.set_layer_color({ layer: sticker.id, ink: "auto" });
  assert.deepEqual(["ink" in sticker, sticker.tint], [false, false], "its own colours again");
  const plate = (await cmds.set_layer_color({ layer: "title", plateInk: "#123456" })).structuredContent;
  assert.match(plate.warnings[0], /once there is a plate/);
  // shown, left out, kept to some sizes
  const graphic = S.cover.layers.find((l) => l.id === "graphic");
  await cmds.show_layer({ layer: "graphic", included: true });
  assert.ok(!graphic.off && graphic.visible);
  await cmds.show_layer({ layer: text.id, opacity: 0.5, locked: true, sizes: ["16:9", "1:1", "1920x1080"] });
  assert.deepEqual([text.o, text.locked, text.sizes], [0.5, true, ["1920x1080", "1200x1200"]]);
  await cmds.show_layer({ layer: text.id, sizes: "all", locked: false });
  assert.ok(!("sizes" in text) && !text.locked);
  // added: on top by default, a copy just above what it copies
  const top = (await cmds.add_layer({ kind: "text", text: "Hi", at: { x: 0.2, y: 0.3 }, scale: 0.5 })).structuredContent.layer;
  assert.equal(S.cover.layers.at(-1).id, top.id); assert.deepEqual([top.place.x, top.place.y, top.place.s], [0.2, 0.3, 0.5]); assert.equal(S.layerId, top.id);
  const st = (await cmds.add_layer({ kind: "asset", asset: { kind: "sticker", id: "burst" }, above: "title" })).structuredContent.layer;
  assert.equal(S.cover.layers.findIndex((l) => l.id === st.id), S.cover.layers.findIndex((l) => l.id === "title") + 1); assert.equal(st.place.s, 0.3);
  const stuck = S.cover.layers.find((l) => l.id === st.id);
  stuck.t.all = { ...stuck.t.all, x: 0.9, s: 2 };
  await cmds.place_layer({ layer: st.id, reset: true });
  assert.deepEqual([stuck.t.all.x, stuck.t.all.s], [0.5, 0.3], "put back in the middle, at the size a sticker is put on at");
  { // a photo filling the canvas fills it still, as the editor's Reset leaves it (resetPlacement)
    const { newLayer } = await import("../ui/js/layers.js"), ground = newLayer("photo", { pid: "pic1", fill: true });
    S.cover.layers.splice(1, 0, ground); ground.t.all = { ...ground.t.all, x: 0.7, s: 1.6 };
    await cmds.place_layer({ layer: ground.id, reset: true });
    assert.deepEqual([ground.t.all.x, ground.t.all.y, ground.t.all.s, ground.fill], [0.5, 0.5, 1, true]);
    S.cover.layers.splice(1, 1);
  }
  const cp = (await cmds.add_layer({ kind: "copy", of: "subtitle" })).structuredContent.layer;
  assert.equal(cp.kind, "copy"); assert.ok(calls.some((c) => c[0] === "duplicateLayer" && c[1] === "subtitle"));
  // a copy of a layer tuned at the size on the canvas, put where it is asked: there too, its tunings of place left behind
  const sub = S.cover.layers.find((l) => l.id === "subtitle"), r4 = (v) => Math.round(v * 1e4) / 1e4;
  sub.t.by[S.sel] = { dx: 300, dy: 40, s: 1.6, r: 5, kx: 1, ky: 1 };
  const there = (await cmds.add_layer({ kind: "copy", of: "subtitle", at: { x: 0.1, y: -0.05 }, scale: 0.8 })).structuredContent.layer;
  const copied = S.cover.layers.find((l) => l.id === there.id), at = placeAt(copied, api.frame());
  assert.deepEqual([at.x, at.y, at.s, at.r].map(r4), [0.1, -0.05, 0.8, 5], "where it was asked, at the size it was tuned at too; its turn kept");
  delete sub.t.by[S.sel];
  const solid = (await cmds.add_layer({ kind: "solid" })).structuredContent.layer;
  assert.equal(solid.color, "#aabbcc", "the channel colour");
  // the stack
  assert.equal((await cmds.reorder_layer({ layer: top.id, to: "bottom" })).structuredContent.index, 1);
  const r = (await cmds.reorder_layer({ layer: top.id, above: "title" })).structuredContent;
  assert.equal(r.layers[r.index - 1], "title");
  const up = (await cmds.reorder_layer({ layer: solid.id, to: "up" })).structuredContent;
  assert.deepEqual(up.warnings, [`"${solid.id}" is there already.`], "the top already");
  // removed
  assert.deepEqual((await cmds.remove_layer({ layer: top.id })).structuredContent, { removed: [top.id] });
  assert.ok(!S.cover.layers.some((l) => l.id === top.id));
  assert.ok(!calls.some((c) => c[0] === "switchProfile"), "never another profile");
});
/** Look `id`'s own settings. */
const lookOf = (id) => Object.fromEntries(LOOKS[id].params.map((d) => [d.key, d.def]));

/** A 1×1 PNG, in base64, and its bytes. */
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = Uint8Array.from(Buffer.from(PNG_B64, "base64"));
/**
 * fakeApi() with what the photo, cut-out, weave, Surprise me, project and file tools reach, much as app.js does it,
 * each call noted in `calls`; `project`, the project read_project reads.
 */
async function fakeFull() {
  const f = await fakeApi(), { api, S, calls } = f;
  const { newLayer, insertAbove, normalizeCrop } = await import("../ui/js/layers.js");
  const { normalizeCover, channelIndex } = await import("../ui/js/store.js");
  const project = { app: "smedcover", kind: "project", version: 4, profile: { id: "far", name: "Far away", categories: [{ id: "f1", name: "Far channel" }] }, catId: "f1", cover: { title: "From afar" } };
  S.photos = new Map([["pic1", { src: "data:image/png;base64," + PNG_B64 }]]);
  S.settings.surprise.locks = { theme: true };
  let n = 0;
  Object.assign(api, {
    CAN: { ...api.CAN, files: true, relay: true },
    invoke: async (cmd, a) => {
      calls.push(["invoke", cmd, a]);
      if (cmd === "read_picture") return a.path.endsWith(".png") ? PNG.buffer.slice(0) : Promise.reject("not a picture file: " + a.path);
      if (cmd === "fetch_image") return { mime: "image/png", data: PNG_B64 };
      if (cmd === "read_project") return a.path.endsWith(".smedcover.json") ? JSON.stringify(project) : Promise.reject("not a project file: " + a.path);
      throw new Error(`no command ${cmd}`);
    },
    readAs: async (blob) => `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
    putPhoto: async (src, { save = true } = {}) => { calls.push(["putPhoto", src.slice(0, 22), save]); if (!src.startsWith("data:image/png")) return null; const pid = `new${++n}`; S.photos.set(pid, { src }); if (save) calls.push(["savePhoto", pid]); return pid; },
    savePhoto: (pid) => calls.push(["savePhoto", pid]),
    keepPicture: (pid, name, kind) => { calls.push(["keepPicture", pid, name, kind]); S.library.unshift({ pid, name, kind, at: 1 }); },
    placePhoto: async (pid, at, fill, above) => {   // a background as toGround puts one: above bg and the photos filling the canvas there already
      calls.push(["placePhoto", pid, at, fill, above]);
      const L = newLayer("photo", { pid, ...(fill ? { fill: true } : {}) }), ls = S.cover.layers;
      if (at) { L.t.all.x = at.x; L.t.all.y = at.y; }
      if (fill) { let i = 1; while (i < ls.length && ls[i].type === "photo" && ls[i].fill && !ls[i].of) i++; ls.splice(i, 0, L); } else insertAbove(ls, above ?? S.layerId, L);
      S.layerId = L.id; return L;
    },
    canCrop: (L) => L.type === "asset" || (L.type === "photo" && !L.fill), pictureSize: (L) => (L.type === "photo" ? [1000, 500] : [600, 600]),
    setCrop: (L, c) => { const k = normalizeCrop(c); if (JSON.stringify(k) === JSON.stringify(L.crop || null)) return false; if (k) L.crop = k; else delete L.crop; calls.push(["setCrop", L.id]); return true; },
    CUT: { busy: false, error: "" }, scopeKeys: (scope, key) => (scope === "size" ? [key] : null),
    cutOut: async (L, keys) => { calls.push(["cutOut", L.id, keys]); const c = newLayer("photo", { of: L.id, cut: true }); if (keys) c.sizes = keys; insertAbove(S.cover.layers, "title", c); return c; },
    weaveClose: () => calls.push(["weaveClose"]), brushClose: () => calls.push(["brushClose"]),
    SURPRISE: { busy: false, step: null },
    dealHands: async (o) => { calls.push(["dealHands", { count: o.count, locks: o.locks, px: o.px, busy: api.SURPRISE.busy }]); return Array.from({ length: o.count }, (_, i) => ({ style: { look: LOOK_IDS[i], theme: "dark" }, layers: [], layout: "keep" })); },
    keepFirst: (hands) => { calls.push(["keepFirst", hands[0].style.look]); S.histIdx++; api.SURPRISE.step = { idx: S.histIdx }; },
    takeHand: (h) => { calls.push(["takeHand", h.style.look]); return true; },
    handSays: (h) => `says ${h.style.look}`,
    channelCover: (raw, prof, catId) => normalizeCover({ ...raw, catId }, prof),
    setCover: (c) => { calls.push(["setCover", c.catId]); S.cover = S.covers[c.catId] = c; },
    loadPhotos: async (pids) => pids.filter((pid) => !S.photos.has(pid)),
    pidsOf: (c) => new Set(c.layers.filter((l) => l.type === "photo" && l.pid).map((l) => l.pid)),
    openProject: async (raw, ask) => {
      const how = raw.profile && !S.profiles.some((q) => q.id === raw.profile.id) ? await ask(raw.profile.name) : null;
      calls.push(["openProject", how]);
      if (how === "new") { const q = normalizeProfile(raw.profile); S.profiles.push(q); S.profile = q; S.covers = {}; S.cover = S.covers.f1 = normalizeCover({ catId: "f1", title: raw.cover.title }, q); }
      else S.cover.title = raw.cover.title;
      return { profile: S.profile, catId: S.cover.catId };
    },
    coverFor: (id) => S.covers[id] || (S.covers[id] = normalizeCover({ catId: id }, S.profile)),
    batchJobs: (rows) => ({ unknown: 0, jobs: rows.map((r) => {   // as batchJobs in app.js
      let index = Number.isInteger(r.index) ? r.index : channelIndex(r.category, S.profile.categories);
      if (index < 0) index = api.catIndex();
      return { index, cover: { ...api.coverFor(S.profile.categories[index].id), title: r.title, tag: r.tag, subtitle: r.subtitle } };
    }) }),
    writeInto: async (dir, jobs, opts) => {
      calls.push(["writeInto", dir, jobs.length, opts.fresh, opts.out]);
      const pr = opts.progress(jobs.length), done = [];
      for (const [i, job] of jobs.entries()) { if (pr.cancelled) break; pr.set(i, `f${i}.png`); done.push({ name: `f${i}.png`, path: `${dir}/f${i}-2.png`, job }); pr.set(i + 1); }
      pr.close();
      return { n: done.length, paths: done, err: null };
    },
  });
  return { ...f, project };
}

test("the photo, cut-out, weave, Surprise me, project and file tools refuse what is wrong before anything is touched", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, text, sticker, calls } = await fakeFull(), cmds = makeCommands(api), was = JSON.stringify(S, (k, v) => (v instanceof Map ? [...v.keys()] : v));
  const d = "/tmp/out";
  const refusals = [
    ["add_photo", { source: { library: "nope" } }, /No picture "nope" in the library/],
    ["add_photo", { source: { data: PNG_B64 }, fill: true, at: { x: 0.5, y: 0.5 } }, /"at" is for a print/],
    ["add_photo", { source: { data: PNG_B64 }, fill: true, above: "title" }, /"above" is for a print/],
    ["add_photo", { source: { data: Buffer.from("hello, world, this is text").toString("base64") } }, /holds no PNG, JPEG, WebP, GIF, HEIC or AVIF picture/],
    ["add_photo", { source: { data: "data:text/plain;base64,aGk=" } }, /a data: URL of no picture/],
    ["add_photo", { source: { data: "not base64 at all!" } }, /must be a picture in base64/],
    ["add_photo", { source: { url: "ftp://example.com/a.png" } }, /"source.url" must be an http\(s\) link/],
    ["add_photo", { source: { path: "/tmp/notes.txt" } }, /"source.path": not a picture file/],
    ["add_photo", { source: { library: "pic1" }, above: "nope" }, /No layer "nope"/],
    ["add_photo", { source: { data: PNG_B64 }, above: "nope" }, /No layer "nope"/],   // decoded first, then let go of again
    ["add_photo", { source: { path: "/tmp/a.png" }, channel: "nope" }, /No channel "nope"/],
    ["add_photo", { source: { data: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }, channel: "nope" }, /could not be read here/],   // not decoded: refused before the channel is even looked for
    ["crop_photo", { layer: sticker.id, crop: { x: 0, y: 0 } }, /takes x, y, w and h, all four \(this one has x, y\)/],
    ["crop_photo", { layer: sticker.id, crop: { x: 0, y: 0, w: 0.5, h: 0.5, pts: [[0, 0], [1, 0], [1, 1]] } }, /a rectangle \(x, y, w, h\) or a shape \(pts\), not both/],
    ["crop_photo", { layer: sticker.id, crop: { pts: [[0, 0], [0.5, 0.5], [1, 1]] } }, /no area/],
    ["crop_photo", { layer: "title", reset: true }, /"title" is a layer of type title, not a photo or an asset/],
    ["cut_out", { layer: "title" }, /not a photo/],
    ["weave", { layer: text.id, by: "head" }, /a layer of type text: weave takes a cut-out \(cut_out makes one\) or an asset/],
    ["weave", { layer: sticker.id, front: JSON.parse('{"__proto__": "all"}') }, /"front.__proto__" is no layer's id/],
    ["weave", { layer: sticker.id, front: { constructor: "all" } }, /"front.constructor" is no layer's id/],
    ["weave", { layer: sticker.id, with: ["tag"] }, /"tag" is not a lettering layer below .*; those it can weave with: .*title/],
    ["weave", { layer: sticker.id, front: { title: ["9|Z|9"] } }, /"front.title": "9\|Z\|9" is not one of title's letters/],
    ["weave", { layer: sticker.id, front: { subtitle: "all" } }, /"subtitle" is not among the layers it weaves with \(title\)/],
    ["weave", { layer: sticker.id, off: true, by: "head" }, /"off" goes alone/],
    ["pick_hand", { hand: 1 }, /There is no surprise to take a hand of/],
    ["open_project", { project: "{not json" }, /The project is not JSON/],
    ["open_project", { project: { kind: "profile" } }, /That is no SmedCover project/],
    ["open_project", { file: "/tmp/a.json" }, /^"file": not a project file: \/tmp\/a\.json\.$/],
    ["export", { dir: "relative/out" }, /"dir" must be an absolute folder/],
    ["export", {}, /has no export folder yet: pass dir/],
    ["export", { dir: d, sizes: ["5:1"] }, /The profile has no size "5:1"/],
    ["export", { dir: d, channels: ["nope"] }, /No channel "nope"/],
    ["export", { dir: d, profile: "nobody" }, /No profile "nobody"/],
    ["batch_covers", { csv: "Nope,Hello\nFilm Stories,Hi\nMissing,Bye", dir: d }, /names channels .* does not have: "Nope", "Missing"; its channels are: 1\. .*Nothing was written\./],
    ["batch_covers", { jobs: [{ channel: "Film Stories", title: "a" }, { channel: "nope", title: "x" }], dir: d }, /No channel "nope"/],
    ["batch_covers", { csv: "a", dir: d }, /The CSV has no row with a title/],
  ];
  for (const [tool, args, said] of refusals) await assert.rejects(cmds[tool](args), (e) => e instanceof ToolError && e.code === "invalid_arguments" && said.test(e.message), `${tool} ${JSON.stringify(args)}`);
  // what the host cannot do: unavailable
  const cannot = [
    [{ ...api.CAN, cut: false }, "cut_out", { layer: "title" }, /cannot cut a subject out/],
    [{ ...api.CAN, saveFiles: false }, "export", { dir: d }, /writes no files/],
    [{ ...api.CAN, saveFiles: false }, "batch_covers", { csv: "1,a", dir: d }, /writes no files/],
    [{ ...api.CAN, files: false }, "add_photo", { source: { path: "/tmp/a.png" } }, /reads no files of this computer/],
    [{ ...api.CAN, files: false }, "open_project", { file: "/tmp/a.smedcover.json" }, /reads no files of this computer/],
  ];
  const can = api.CAN;
  for (const [c, tool, args, said] of cannot) { api.CAN = c; await assert.rejects(cmds[tool](args), (e) => e.code === "unavailable" && said.test(e.message), tool); }
  api.CAN = can;
  api.cutReady = () => false; api.cutEngine = () => "birefnet-lite";
  await assert.rejects(cmds.cut_out({ layer: "title" }), (e) => e.code === "unavailable" && /model \(birefnet-lite\) is not downloaded: the user can download it in Settings/.test(e.message));
  // a picture decoded to be checked before anything is touched (putPhoto, save: false) is let go of again: the state below
  assert.ok(calls.filter((c) => c[0] === "putPhoto").every((c) => c[2] === false), "a picture only decoded, never written");
  assert.deepEqual(calls.filter((c) => c[0] !== "invoke" && c[0] !== "putPhoto"), [], "nothing that changes anything was called: no switch, no picture stored, nothing written");
  assert.equal(JSON.stringify(S, (k, v) => (v instanceof Map ? [...v.keys()] : v)), was, "the state as it was");
});

test("the photo tools do what the editor does: a picture from a file, a link, the library or data put on as a print or the background, cropped, cut out and woven", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { letterKeysOf: keys } = await import("../ui/js/tools.js");
  const { api, S, sticker, calls } = await fakeFull(), cmds = makeCommands(api), ctx = { progress: () => {}, cancelled: () => false, say: () => {} };
  // data: stored, kept in the library under the name given, a print above the selected layer
  const one = (await cmds.add_photo({ source: { data: PNG_B64 }, name: "Dot", at: { x: 0.3, y: 0.6 } }, ctx)).structuredContent;
  assert.equal(one.pid, "new1"); assert.equal(one.layer.type, "photo"); assert.deepEqual([one.layer.place.x, one.layer.place.y], [0.3, 0.6]);
  assert.deepEqual(calls.filter((c) => c[0] === "keepPicture"), [["keepPicture", "new1", "Dot", "upload"]]);
  assert.deepEqual(calls.filter((c) => ["putPhoto", "savePhoto", "switchChannel", "placePhoto"].includes(c[0])).map((c) => c[0]), ["putPhoto", "savePhoto", "placePhoto"], "decoded first, written once it is to be put on");
  assert.deepEqual(calls.find((c) => c[0] === "placePhoto"), ["placePhoto", "new1", { x: 0.3, y: 0.6 }, false, undefined], "above the selected layer: placePhoto's own default");
  // a file: read by the host, named after it; a link: fetched by the host; the library: placed again, not kept twice
  const two = (await cmds.add_photo({ source: { path: "/Users/me/Pictures/Holiday 2.png" }, above: "top" }, ctx)).structuredContent;
  assert.ok(calls.some((c) => c[0] === "invoke" && c[1] === "read_picture" && c[2].path === "/Users/me/Pictures/Holiday 2.png"));
  assert.ok(S.library.some((e) => e.pid === two.pid && e.name === "Holiday 2"));
  assert.equal(S.cover.layers.at(-1).id, two.layer.id, "above the topmost");
  S.imageAi = { proxy: "http://127.0.0.1:7890" };
  const three = (await cmds.add_photo({ source: { url: "https://example.com/pics/sun%20set.png?x=1" } }, ctx)).structuredContent;
  assert.deepEqual(calls.find((c) => c[1] === "fetch_image")[2], { url: "https://example.com/pics/sun%20set.png?x=1", proxy: "http://127.0.0.1:7890", timeout: 120, known: true }, "through the image AI's proxy, only a picture the photo store takes");
  assert.ok(S.library.some((e) => e.pid === three.pid && e.name === "sun set"));
  S.imageAi = {};
  { // what the host refuses the link for is the agent's to put right; the network's failing is not
    const invoke = api.invoke;
    for (const [said, code] of [["not a picture: the link leads to no PNG, JPEG, WebP, GIF, HEIC or AVIF image (it says image/svg+xml)", "invalid_arguments"], ["picture too big: the reply at https://example.com/a.png is more than 64 MB", "invalid_arguments"], ["connection refused", "failed"]]) {
      api.invoke = async (cmd, a) => (cmd === "fetch_image" ? Promise.reject(said) : invoke(cmd, a));
      await assert.rejects(cmds.add_photo({ source: { url: "https://example.com/a.png" } }, ctx), (e) => e.code === code && e.message.includes(said), said);
    }
    api.invoke = invoke;
  }
  const kept = S.library.length;
  const four = (await cmds.add_photo({ source: { library: "pic1" }, fill: true }, ctx)).structuredContent;
  assert.equal(four.pid, "pic1"); assert.equal(four.layer.fill, true); assert.equal(S.library.length, kept, "not kept twice");
  const five = (await cmds.add_photo({ source: { library: "pic1" }, fill: true }, ctx)).structuredContent;
  assert.ok(S.cover.layers.findIndex((l) => l.id === five.layer.id) > S.cover.layers.findIndex((l) => l.id === four.layer.id), "a second background over the first, as Fill the canvas puts it");
  S.cover.layers = S.cover.layers.filter((l) => l.id !== five.layer.id);
  await assert.rejects(cmds.add_photo({ source: { data: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" } }, ctx), /could not be read here/);
  // crop: a rectangle kept within the picture, a shape, a ratio of the picture's shape, the whole picture again
  const P = S.cover.layers.find((l) => l.id === one.layer.id);
  const rect = (await cmds.crop_photo({ layer: P.id, crop: { x: 0.6, y: 0.1, w: 0.6, h: 0.5 } })).structuredContent;
  assert.deepEqual(rect.crop, { x: 0.6, y: 0.1, w: 0.4, h: 0.5 }); assert.match(rect.warnings[0], /kept within the picture/);
  const free = (await cmds.crop_photo({ layer: P.id, crop: { pts: [[0.1, 0.1], [0.9, 0.2], [0.5, 0.9]] } })).structuredContent;
  assert.deepEqual(free.crop.pts, [[0.1, 0.1], [0.9, 0.2], [0.5, 0.9]]);
  const wide = (await cmds.crop_photo({ layer: P.id, ratio: "16:9" })).structuredContent.crop;
  assert.ok(Math.abs((wide.w * 1000) / (wide.h * 500) - 16 / 9) < 2e-3, "16:9 on the picture (1000×500)");
  assert.equal((await cmds.crop_photo({ layer: P.id, reset: true })).structuredContent.crop, null);
  assert.match((await cmds.crop_photo({ layer: P.id, reset: true })).structuredContent.warnings[0], /was not cropped/);
  await assert.rejects(cmds.crop_photo({ layer: four.layer.id, reset: true }), /fills the canvas: it is not cropped/);
  // cut out: the sizes the scope asked reaches; a cut-out itself is refused
  const cut = (await cmds.cut_out({ layer: P.id, size: "9:16", scope: "size" }, ctx)).structuredContent;
  assert.deepEqual(cut.sizes, ["1080x1920"]); assert.deepEqual(calls.filter((c) => c[0] === "cutOut").at(-1), ["cutOut", P.id, ["1080x1920"]]);
  assert.deepEqual((await cmds.cut_out({ layer: P.id }, ctx)).structuredContent.sizes, "all");
  await assert.rejects(cmds.cut_out({ layer: cut.cutout }, ctx), /is a cut-out: cut out its photo/);
  // a cut-out the user is making is waited for
  api.CUT.busy = true; setTimeout(() => { api.CUT.busy = false; }, 250);
  const t0 = performance.now();
  await cmds.cut_out({ layer: P.id }, ctx);
  assert.ok(performance.now() - t0 >= 200, "waited for the cut-out under way");
  // weave: the first time as Weave switched on (the title, its head), then letter by letter, then off
  const head = (await cmds.weave({ layer: sticker.id, line: 0.45 })).structuredContent.weave;
  assert.deepEqual([head.with, head.by, head.line], [["title"], "head", 0.45]);
  const letters = (await cmds.weave({ layer: sticker.id, by: "letters", with: ["title", "subtitle"], front: { title: "alternate", subtitle: ["0|S|1"] } })).structuredContent;
  const all = keys(S.cover.title);
  assert.deepEqual(letters.weave.front, { title: all.filter((_, i) => i % 2 === 0), subtitle: ["0|S|1"] }); assert.equal(letters.weave.line, 0.45, "the head's line kept for going back to it");
  const fewer = (await cmds.weave({ layer: sticker.id, with: ["subtitle"] })).structuredContent.weave;
  assert.deepEqual([fewer.with, Object.keys(fewer.front)], [["subtitle"], ["subtitle"]], "the letters of a layer no longer woven with go with it");
  const brush = (await cmds.weave({ layer: sticker.id, strokes: [{ front: true, r: 0.05, pts: [[0.5, 0.2], [0.6, 0.25]] }] })).structuredContent;
  assert.match(brush.warnings[0], /What the brush paints shows when by is "brush" \(it is "letters"\): kept for then/);
  assert.deepEqual(brush.weave.strokes, [{ front: true, r: 0.05, pts: [[0.5, 0.2], [0.6, 0.25]] }]);
  assert.equal((await cmds.weave({ layer: sticker.id, off: true })).structuredContent.weave, null);
  assert.ok(!("weave" in sticker));
  assert.match((await cmds.weave({ layer: sticker.id, off: true })).structuredContent.warnings[0], /was not woven/);
});

test("Surprise me deals as the window does, its locks this call's alone, and pick_hand takes another hand on the same step till the cover changes", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, calls } = await fakeFull(), cmds = makeCommands(api), told = [];
  const ctx = { progress: (n, total, message) => told.push(message), cancelled: () => false, say: () => {} };
  const dealt = (await cmds.surprise({ count: 3, locks: ["look", "layout"], images: "none" }, ctx)).structuredContent;
  assert.deepEqual(dealt.hands.map((h) => [h.hand, h.look, h.says]), LOOK_IDS.slice(0, 3).map((id, i) => [i + 1, id, `says ${id}`]));
  assert.equal(dealt.kept, 1); assert.deepEqual(dealt.locks, ["look", "layout"]);
  const deal = calls.find((c) => c[0] === "dealHands")[1];
  assert.deepEqual(deal.locks, { look: true, layout: true }); assert.equal(deal.busy, true, "SURPRISE.busy while dealing"); assert.equal(deal.px, 400, "a hand 400 px on its longer side");
  assert.equal(api.SURPRISE.busy, false); assert.deepEqual(S.settings.surprise.locks, { theme: true }, "the user's locks as they were");
  assert.deepEqual(calls.find((c) => c[0] === "keepFirst"), ["keepFirst", LOOK_IDS[0]]);
  assert.deepEqual((await cmds.pick_hand({ hand: 3 })).structuredContent, { kept: 3, look: LOOK_IDS[2], lookName: LOOKS[LOOK_IDS[2]].name.en });
  await assert.rejects(cmds.pick_hand({ hand: 5 }), /dealt 3 hands: pick 1 to 3/);
  S.histIdx++;   // a change made since: the hands are past taking
  await assert.rejects(cmds.pick_hand({ hand: 2 }), /changed since the last surprise.*Deal again with surprise/);
  // with no locks given, Surprise me's own
  await cmds.surprise({ images: "none" }, ctx);
  assert.deepEqual(calls.filter((c) => c[0] === "dealHands").at(-1)[1].locks, { theme: true });
  assert.equal(calls.filter((c) => c[0] === "dealHands").at(-1)[1].count, RULES.hands.count);
});

test("apply_cover_json checks the cover as one read from its file and says what it corrected, dropped and put back, and what it names that is not here", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, calls } = await fakeFull(), cmds = makeCommands(api);
  const raw = JSON.parse(JSON.stringify(S.cover));
  raw.title = "Applied"; raw.mood = "odd";
  raw.layers = raw.layers.filter((l) => l.id !== "tag");   // a layout part left out
  raw.layers.find((l) => l.id === "title").o = 7;   // out of range
  raw.layers.find((l) => l.id === "title").wobble = true;   // no such field
  raw.layers.push({ type: "photo", id: "ph1", pid: "gone" }, { type: "asset", id: "as1", ref: { kind: "sticker", id: "nope" } }, { type: "martian", id: "m1" });
  const said = (await cmds.apply_cover_json({ cover: raw })).structuredContent;
  assert.equal(S.cover.title, "Applied"); assert.ok(calls.some((c) => c[0] === "setCover"));
  assert.ok(said.corrected.includes("layers.title.o"), JSON.stringify(said));
  assert.ok(said.dropped.includes("mood") && said.dropped.includes("layers.title.wobble") && said.dropped.includes("layers.m1"), JSON.stringify(said.dropped));
  assert.ok(said.restored.includes("layers.tag"));
  assert.deepEqual(said.missingPhotos, ["gone"]); assert.deepEqual(said.missingAssets, ["sticker:nope"]);
});

test("open_project opens a project from a file or given whole, as a new profile or into the current one, and says which", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, calls, project } = await fakeFull(), cmds = makeCommands(api);
  const into = (await cmds.open_project({ project: JSON.stringify(project), as: "current" })).structuredContent;
  assert.deepEqual(calls.filter((c) => c[0] === "openProject").at(-1), ["openProject", "current"]);
  assert.equal(into.profile.created, false); assert.equal(S.cover.title, "From afar");
  const made = (await cmds.open_project({ file: "/Users/me/Far.smedcover.json" })).structuredContent;
  assert.ok(calls.some((c) => c[1] === "read_project" && c[2].path === "/Users/me/Far.smedcover.json"));
  assert.deepEqual(made, { profile: { id: "far", name: "Far away", created: true }, channel: "f1" });
  const again = (await cmds.open_project({ project, as: "current" })).structuredContent;
  assert.equal(again.profile.created, false); assert.match(again.warnings[0], /Its profile, "Far away", is here: it opened there/);
});

test("export and batch_covers write as the Export window and a CSV do, into the folder given or the profile's, never over a file", async () => {
  const { makeCommands } = await import("../ui/js/commands.js");
  const { api, S, p, calls } = await fakeFull(), cmds = makeCommands(api), says = [];
  const ctx = { progress: () => {}, cancelled: () => false, say: (s) => says.push(s) };
  const ex = (await cmds.export({ dir: "/out", format: "jpeg", scale: 1 }, ctx)).structuredContent;
  const w = calls.filter((c) => c[0] === "writeInto").at(-1);
  const ticked = p.sizes.filter((z) => keyOf(z) !== "900x383");
  assert.deepEqual([w[1], w[2], w[3], w[4].format, w[4].scale], ["/out", ticked.length, true, "jpeg", 1], "the sizes ticked, fresh: never over a file");
  assert.deepEqual(ex.files.map((f) => [f.channel, f.size]), ticked.map((z) => [S.cover.catId, keyOf(z)]));
  assert.equal(ex.files[0].path, "/out/f0-2.png", "the path written, as the host answers it"); assert.equal(ex.dir, "/out"); assert.ok(says.length > 0, "the pill says how far it has got");
  assert.equal(S.settings.exportDirs[p.id], undefined, "the folder given is not kept");
  S.settings.exportDirs[p.id] = "/kept";
  const everything = (await cmds.export({ channels: "all", sizes: "all" }, ctx)).structuredContent;
  assert.equal(everything.dir, "/kept"); assert.equal(everything.files.length, p.categories.length * p.sizes.length);
  const two = (await cmds.export({ channels: [1, "Film Stories", 1], sizes: ["16:9", "1920x1080"] }, ctx)).structuredContent;
  assert.deepEqual(two.files.map((f) => f.channel), [p.categories[0].id, p.categories[1].id], "each channel and size once");
  // cancelled part-way: what was written, and said so
  let left = 2;
  const half = (await cmds.export({ sizes: "all" }, { ...ctx, cancelled: () => left-- <= 0 })).structuredContent;
  assert.equal(half.cancelled, true); assert.ok(half.files.length < p.sizes.length);
  // a batch: each job its channel's cover with its words, every size by default; a CSV row without a channel, the one shown
  const shown = S.cover.catId, title = S.cover.title;
  const batch = (await cmds.batch_covers({ jobs: [{ channel: 1, title: "One" }, { channel: "Film Stories", title: "Two", tag: "T" }], dir: "/b" }, ctx)).structuredContent;
  assert.deepEqual(batch.files.map((f) => [f.channel, f.title]), [...p.sizes.map(() => [p.categories[0].id, "One"]), ...p.sizes.map(() => [p.categories[1].id, "Two"])]);
  const csv = (await cmds.batch_covers({ csv: "channel,title,tag\n,Here,\n2,Second,EP", sizes: ["16:9"], dir: "/b" }, ctx)).structuredContent;
  assert.deepEqual(csv.files.map((f) => [f.channel, f.title]), [[shown, "Here"], [p.categories[1].id, "Second"]]);
  assert.equal(S.cover.title, title, "the covers in the window are not changed");
});

test("imageType tells a picture by its first bytes, as the host's read_picture does", () => {
  const b = (s, more = []) => Uint8Array.from([...Buffer.from(s, "latin1"), ...more]);
  assert.equal(imageType(PNG), "image/png");
  assert.equal(imageType(PNG.buffer), "image/png", "an ArrayBuffer too");
  assert.equal(imageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageType(b("GIF89a")), "image/gif");
  assert.equal(imageType(b("RIFF\x24\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(imageType(b("\0\0\0\x18ftypheic")), "image/heic");
  assert.equal(imageType(b("\0\0\0\x18ftypmif1")), "image/heif");
  assert.equal(imageType(b("\0\0\0\x1cftypavif")), "image/avif");
  assert.equal(imageType(b("\0\0\0\x18ftypisom")), null, "a video");
  assert.equal(imageType(b("%PDF-1.7")), null);
  assert.equal(imageType(new Uint8Array()), null);
});

test("coverDiff says what checking a cover given whole corrected, dropped and put back", async () => {
  const { normalizeCover } = await import("../ui/js/store.js");
  const { sampleProfile } = await import("../ui/js/presets.js");
  const p = normalizeProfile(sampleProfile("en")), base = normalizeCover({ catId: p.categories[0].id, title: "T" }, p);
  const same = JSON.parse(JSON.stringify(base));
  assert.deepEqual(coverDiff(same, normalizeCover(JSON.parse(JSON.stringify(same)), p)), { corrected: [], dropped: [], restored: [], missingPhotos: [], missingAssets: [] }, "a cover as kept: nothing to say");
  const raw = JSON.parse(JSON.stringify(base));
  raw.title = 42; raw.extra = 1;
  raw.layers.reverse();   // bg on top: put back at the bottom
  raw.layers = raw.layers.filter((l) => l.id !== "subtitle");
  raw.layers.push("junk", { type: "text", text: "no id" });
  const fixed = normalizeCover(JSON.parse(JSON.stringify(raw)), p), d = coverDiff(raw, fixed, { hasPhoto: () => false });
  assert.ok(d.corrected.includes("title") && d.corrected.includes("layers"), JSON.stringify(d));
  assert.ok(d.dropped.includes("extra") && d.dropped.includes(`layers[${raw.layers.length - 2}]`) && d.dropped.includes(`layers[${raw.layers.length - 1}]`), JSON.stringify(d.dropped));
  assert.ok(d.restored.includes("layers.subtitle"));
  assert.deepEqual(coverDiff({ layers: "nope" }, base).corrected, ["layers"]);
});

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const never = () => new Promise(() => {});

test("the queue lets go of a call that says nothing for its timeout: the next one runs, what it answers later is dropped", async () => {
  const { makeQueue } = await import("../ui/js/agent.js");
  const q = makeQueue(), log = [];
  let late = null;
  const hung = q.push("hung", async (lease) => { log.push("hung+"); await never(); return lease; }, { timeoutMs: 40, lapsed: (why) => `let go: ${why}` });
  const slow = q.push("slow", async (lease) => { late = lease; log.push("slow+"); await sleep(120); log.push("slow-"); return "slow, too late"; }, { timeoutMs: 40, lapsed: (why) => `let go: ${why}` });
  const after = q.push("after", async () => { log.push("after+"); return "after"; });
  const talks = q.push("talks", async (lease) => { for (let i = 0; i < 6; i++) { await sleep(25); lease.touch(); } return "done"; }, { timeoutMs: 100, lapsed: () => "let go" });
  assert.equal(await hung, "let go: timeout");
  assert.equal(await slow, "let go: timeout", "answered at its timeout, not when it ends");
  assert.equal(late.gone, true);
  assert.equal(await after, "after");
  assert.equal(await talks, "done", "each word sets the clock going again: 150 ms of work, never 100 without a word");
  assert.equal(q.running, null);
  await sleep(120);
  assert.deepEqual(log, ["hung+", "slow+", "after+", "slow-"], "the slow call's end came after the queue had gone on, and was dropped");
  // a failure after being let go is dropped too, not thrown at anyone
  const failsLate = q.push("x", async () => { await sleep(30); throw new Error("late"); }, { timeoutMs: 10, lapsed: () => "gone" });
  assert.equal(await failsLate, "gone");
  await sleep(40);
});

test("the queue: a call waiting is cancelled (it never runs), the call running is let go of; those waiting are told every so often", async () => {
  const { makeQueue, CANCELLED } = await import("../ui/js/agent.js");
  const q = makeQueue(), told = [];
  const a = q.push("a", () => never(), { lapsed: (why) => `a: ${why}` });
  const b = q.push("b", async () => "b ran", { waiting: (ms) => told.push(["b", ms]), every: 20 });
  const c = q.push("c", async () => "c ran", { waiting: (ms) => told.push(["c", ms]), every: 20 });
  await sleep(110);
  assert.equal(q.running, "a"); assert.equal(q.waiting, 2);
  assert.ok(told.filter(([n]) => n === "b").length >= 2 && told.filter(([n]) => n === "c").length >= 2, `each waiting call told so, every 20 ms (${told.length})`);
  assert.ok(told.every(([, ms]) => ms >= 15));
  assert.equal(q.cancel("a"), false, "the call running is not taken out of the queue…");
  assert.equal(q.letGo("b", "x"), false, "…nor let go of under another's id");
  assert.equal(q.cancel("c"), true);
  assert.equal(await c, CANCELLED);
  assert.equal(q.letGo("a", "cancelled"), true, "…but let go of");
  assert.equal(await a, "a: cancelled");
  assert.equal(await b, "b ran", "the next one runs");
  const n = told.length;
  await sleep(50);
  assert.equal(told.length, n, "nothing told once a call runs or is cancelled");
});

test("the dispatcher lets go of a call that hangs: answered failed at its timeout, the window given back, the next call runs, a late failure not put back, its step ended as it stands", async () => {
  const { makeAgent, stepping } = await import("../ui/js/agent.js");
  const log = [];
  let held = null;
  const commands = Object.fromEntries(TOOLS.map((d) => [d.name, async () => toResult({ structured: { ok: d.name } })]));
  commands.undo = async () => { held = stepping(); return never(); };   // e.g. undo → timeTravel → applyFonts, waiting for good
  commands.set_look = async (args, ctx) => { await sleep(60); log.push(`set_look cancelled: ${ctx.cancelled()}`); throw new Error("half done"); };
  commands.set_text = async (args, ctx) => { for (let i = 0; i < 6; i++) { await sleep(30); ctx.progress(i + 1, 6); } return toResult({ structured: { words: true } }); };
  const step = async (fn, ctl) => { log.push("step in"); ctl.abandon = () => log.push("abandoned"); try { return await fn(); } catch (e) { log.push("put back"); throw e; } finally { log.push("step out"); } };
  const agent = makeAgent({ commands, step, quietFor: () => Infinity, every: 20 });
  const progress = [];
  const hung = agent.handle({ id: 1, tool: "undo", args: {}, timeoutMs: 50 }), next = agent.handle({ id: 2, tool: "get_context", args: {} }, { progress: (p) => progress.push(p) });
  const r = await hung;
  assert.equal(held, true, "the window was held while it ran");
  assert.equal(r.ok, false); assert.equal(r.error.code, "failed");
  assert.match(r.error.message, /^undo did not finish: nothing was heard from it for 0 s, so it was let go and the window given back to the user\. It may still finish later: check with get_cover/);
  assert.equal(stepping(), false, "the window is the user's again");
  assert.equal((await next).ok, true, "the call behind it runs");
  assert.ok(progress.some((p) => p.message === "Waiting for an earlier call to finish."), "and was told it waited");
  // a step that fails after being let go: not put back over what the user has done since, its step ended when it was let go of (abandon)
  const s = await agent.handle({ id: 3, tool: "set_look", args: { look: "cyber" }, timeoutMs: 30 });
  assert.match(s.error.message, /^set_look did not finish/);
  const warn = console.warn;
  console.warn = () => {};
  try { await sleep(60); } finally { console.warn = warn; }
  assert.deepEqual(log, ["step in", "abandoned", "set_look cancelled: true", "step out"]);
  // a call that keeps saying how far it has got is never let go of, however long it takes
  const words = [], w = await agent.handle({ id: 4, tool: "set_text", args: { title: "x" }, timeoutMs: 100 }, { progress: (p) => words.push(p) });
  assert.equal(w.ok, true);
  assert.deepEqual(words.map((p) => p.progress), [1, 2, 3, 4, 5, 6], "180 ms of work, never 100 without a word");
});

test("the dispatcher: a call the host cancels while it runs is let go of after a moment, the window given back; one waiting never runs", async () => {
  const { makeAgent, stepping, CANCELLED } = await import("../ui/js/agent.js");
  let ran = [];
  const commands = Object.fromEntries(TOOLS.map((d) => [d.name, async () => { ran.push(d.name); return toResult({ structured: {} }); }]));
  commands.redo = () => never();
  commands.export = async (args, ctx) => { while (!ctx.cancelled()) await sleep(5); return toResult({ text: "Stopped after 2 files." }); };   // checks between files
  const agent = makeAgent({ commands, quietFor: () => Infinity, grace: 30 });
  const running = agent.handle({ id: "r", tool: "redo", args: {} }), queued = agent.handle({ id: "q", tool: "get_cover", args: {} }), after = agent.handle({ id: "n", tool: "get_context", args: {} });
  await sleep(10);
  assert.equal(stepping(), true);
  assert.equal(agent.cancel("q"), true, "a call waiting: taken out");
  assert.equal(agent.cancel("r"), false, "a call running: told, and let go of after the grace");
  const t0 = performance.now(), r = await running;
  assert.ok(performance.now() - t0 >= 15, "not before the grace");
  assert.deepEqual(r.error, { code: "failed", message: "redo was cancelled before it finished; the window is the user's again. It may still finish later: check with get_cover before going on." });
  assert.equal(stepping(), false);
  assert.equal(await queued, CANCELLED);
  assert.equal((await after).ok, true);
  assert.deepEqual(ran, ["get_context"], "the cancelled call never ran");
  // one that heeds ctx.cancelled() ends by itself within the grace, and answers as it does
  const ex = agent.handle({ id: "e", tool: "export", args: {} });
  await sleep(10);
  agent.cancel("e");
  assert.deepEqual((await ex).result.content, [{ type: "text", text: "Stopped after 2 files." }]);
  // cancelled while it waits for the user: it stops waiting and never runs
  ran = [];
  const shy = makeAgent({ commands, busy: () => "a dialog is open", quietFor: () => Infinity, grace: 10 });
  const waits = shy.handle({ id: "w", tool: "set_text", args: { title: "x" } });
  await sleep(20);
  shy.cancel("w");
  assert.equal((await waits).error.message, "set_text was cancelled before it finished.", "it had not begun: no window to give back");
  await sleep(150);
  assert.deepEqual(ran, []);
});

test("the dispatcher always answers: a name of Object.prototype is no tool, a throw while the window is taken still answers and gives it back", async () => {
  const { makeAgent, stepping, serve } = await import("../ui/js/agent.js");
  const commands = Object.fromEntries(TOOLS.map((d) => [d.name, async () => toResult({ structured: {} })]));
  const agent = makeAgent({ commands, quietFor: () => Infinity });
  for (const tool of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf", 7, null, undefined]) {
    const r = await agent.handle({ id: "p", tool, args: {} });
    assert.equal(r.error.code, "unknown_tool", String(tool));
  }
  const odd = makeAgent({ commands: { ...commands, toString: async () => toResult({}) }, quietFor: () => Infinity });
  assert.equal((await odd.handle({ id: "o", tool: "toString" })).error.code, "unknown_tool", "a command that is no tool is not run");
  assert.equal((await agent.handle(null)).ok, false, "no call at all is answered too");
  const said = console.error;
  console.error = () => {};
  try {
    const broken = makeAgent({ commands, quietFor: () => Infinity, closeTransient: () => { throw new Error("a popover would not shut"); } });
    assert.deepEqual((await broken.handle({ id: "b", tool: "set_look", args: { look: "cyber" } })).error, { code: "failed", message: "set_look failed: a popover would not shut" });
    assert.equal(stepping(), false, "the window given back");
    assert.equal((await broken.handle({ id: "c", tool: "get_context", args: {} })).ok, true, "and the next call runs");
    const busy = makeAgent({ commands, quietFor: () => Infinity, busy: () => { throw new Error("busy broke"); } });
    assert.deepEqual((await busy.handle({ id: "d", tool: "get_context", args: {} })).error, { code: "failed", message: "get_context failed: busy broke" });
    // serve answers each call, whatever the dispatcher does
    const replies = [];
    let onCall;
    serve({ handle: (call) => (call.tool === "x" ? Promise.reject(new Error("lost")) : Promise.resolve({ id: call.id, ok: true })) }, { listen: (c) => { onCall = c; }, reply: (id, r) => replies.push(r), progress: () => {} });
    onCall({ id: 1, tool: "x" }); onCall({ id: 2, tool: "y" });
    await sleep(5);
    assert.deepEqual(replies.sort((a, b) => a.id - b.id), [{ id: 1, ok: false, error: { code: "failed", message: "The call failed: lost" } }, { id: 2, ok: true }]);
  } finally { console.error = said; }
});

test("every tool that changes something says in both languages what it is doing, for the pill over the window", async () => {
  const { keys } = await import("../ui/js/i18n.js");
  const have = new Set(keys());
  for (const d of TOOLS) if (!d.annotations.readOnlyHint) assert.ok(have.has(`agent.step.${d.name}`), d.name);
  for (const k of ["agent.working", "agent.wait", "agent.switched", "agent.exporting", "agent.slow", "agent.stop", "agent.stopTip"]) assert.ok(have.has(k), k);
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
  // as many sizes as a profile keeps, of every shape: smaller than 24 px, then with smaller captions, never past the square
  const many = Array.from({ length: 80 }, (_, i) => [{ w: 8192, h: 64 }, { w: 64, h: 8192 }, { w: 1920, h: 1080 }, { w: 1080, h: 1920 }, { w: 900, h: 383 }][i % 5]);
  for (const side of [128, 300, 1024]) for (const [gap, cap] of [[16, 30], [11, 18]]) {
    const plan = sheetPlan(many, side, { gap, cap }), most = Math.round(side * 1.5);
    assert.equal(plan.tiles.length, many.length);
    assert.ok(plan.width <= most && plan.height <= most, `${side}: ${plan.width}×${plan.height} within ${most}`);
    assert.ok(plan.tiles.every((t) => t.x >= 0 && t.y >= 0 && t.x + t.w <= plan.width && t.y + t.h + plan.cap <= plan.height && t.h === plan.tile), `${side}: on the sheet`);
    for (let i = 1; i < plan.tiles.length; i++) { const a = plan.tiles[i - 1], b = plan.tiles[i]; assert.ok(b.y > a.y || b.x >= a.x + a.w, "no two overlap"); }
    assert.ok(plan.cap <= cap && plan.gap <= gap);
  }
  const fine = sheetPlan(sizes, 1024, { gap: 11, cap: 18 });
  assert.deepEqual([fine.gap, fine.cap], [11, 18], "a few sizes keep their captions");
});
