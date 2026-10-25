// Unit tests for the agent tools: their definitions (tools.js), what ui/tools.json holds, the argument check, the
// helpers the commands find things by, and the answers' shapes. Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { TOOLS, TOOL_BY, ERRORS, INSTRUCTIONS, toolsJson, toolsText, checkArgs, checkCall, toResult, toError, isError, ToolError, findSize, findChannel, findProfile, letterKeysOf, boxesOf, sheetPlan, widthFor, keyOf } from "../ui/js/tools.js";
import { SCOPES, FORMATS, SURPRISE_LOCKS, normalizeSize, normalizeProfile } from "../ui/js/store.js";
import { LOOK_IDS } from "../ui/js/style.js";
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
  for (const d of TOOLS) assert.equal(d.busy, d.annotations.readOnlyHint || d.name === "select_layer" ? "light" : "strict", d.name);
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
