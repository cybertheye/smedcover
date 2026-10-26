// The desktop app's side of the agents' endpoint in the page (ui/js/agent.js): the Tauri transport, played here with a
// stand-in Channel, invoke and window, and the lines Settings → Agents gives to set an agent up.
import test from "node:test";
import assert from "node:assert/strict";
import { tauriTransport, setupLines, maskToken, MCP, onMcpStatus, toolsHash } from "../ui/js/agent.js";

/** Tauri's Channel as the transport uses it: the page sets onmessage, Rust sends. */
class FakeChannel {
  constructor() { FakeChannel.last = this; this.onmessage = null; }
}
/** invoke, played: each command noted; mcp_attach fails its first `fails` times. */
function fakeInvoke(fails = 0) {
  const calls = [];
  let left = fails;
  const call = async (cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "mcp_attach") {
      if (left-- > 0) throw new Error("the host is not ready");
      return { epoch: calls.length, toolsMismatch: false, status: { state: "running", port: 25277 } };
    }
    return true;
  };
  return { calls, call, attaches: () => calls.filter(([cmd]) => cmd === "mcp_attach") };
}
const settle = (ms = 0) => new Promise((r) => setTimeout(r, ms));
/** Runs `fn` with console.error quiet (the transport says what failed). */
async function hushed(fn) {
  const was = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = was; }
}

test("the Tauri transport hands its channel over with the tools' hash, routes what comes through it, and answers by the commands", async () => {
  const inv = fakeInvoke(), win = new EventTarget(), heard = [], calls = [], cancels = [];
  const stop = onMcpStatus((s) => heard.push(s));
  const transport = tauriTransport({ Channel: FakeChannel, call: inv.call, win });
  transport.listen((c) => calls.push(c), (id) => cancels.push(id));
  const info = await transport.attached;
  assert.equal(info.epoch, 1);
  const [[cmd, args]] = inv.attaches();
  assert.equal(cmd, "mcp_attach");
  assert.equal(args.channel, FakeChannel.last, "the channel itself");
  assert.equal(args.toolsHash, await toolsHash());
  assert.match(args.toolsHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(heard.at(-1), { state: "running", port: 25277 }, "the attach's status told");
  const ch = FakeChannel.last;
  ch.onmessage({ kind: "call", id: 7, tool: "get_context", args: {}, timeoutMs: 30000 });
  ch.onmessage({ kind: "cancel", id: 7 });
  ch.onmessage({ kind: "status", status: { state: "off" } });
  ch.onmessage(null); ch.onmessage("nonsense"); ch.onmessage({ kind: "other" });
  assert.deepEqual(calls, [{ kind: "call", id: 7, tool: "get_context", args: {}, timeoutMs: 30000 }]);
  assert.deepEqual(cancels, [7]);
  assert.deepEqual(MCP.status, { state: "off" });
  assert.deepEqual(heard.at(-1), { state: "off" });
  transport.reply(7, { id: 7, ok: true, result: { content: [] } });
  transport.progress(7, { progress: 2, total: 5, message: "Drawing" });
  await settle();
  assert.deepEqual(inv.calls.slice(1), [
    ["mcp_reply", { reply: { id: 7, ok: true, result: { content: [] } } }],
    ["mcp_progress", { id: 7, progress: 2, total: 5, message: "Drawing" }],
  ]);
  stop();
});

test("a tools.json that cannot be hashed attaches with an empty hash", async () => {
  const inv = fakeInvoke();
  const transport = tauriTransport({ Channel: FakeChannel, call: inv.call, win: new EventTarget(), hash: async () => { throw new Error("no crypto"); } });
  await hushed(async () => { transport.listen(() => {}, () => {}); await transport.attached; });
  assert.equal(inv.attaches()[0][1].toolsHash, "");
});

test("an attach that fails is tried again a moment later, then each time the window comes back, till it works", async () => {
  // once: the second try works
  const once = fakeInvoke(1);
  const t1 = tauriTransport({ Channel: FakeChannel, call: once.call, win: new EventTarget(), retryMs: 5 });
  const info = await hushed(async () => { t1.listen(() => {}, () => {}); return t1.attached; });
  assert.ok(info && info.epoch, "attached on the second try");
  assert.equal(once.attaches().length, 2);
  // three times: `attached` says null after two, and the window coming back tries again — once per return, till it works
  const thrice = fakeInvoke(3), win = new EventTarget();
  const t2 = tauriTransport({ Channel: FakeChannel, call: thrice.call, win, retryMs: 5 });
  await hushed(async () => {
    t2.listen(() => {}, () => {});
    assert.equal(await t2.attached, null);
    assert.equal(thrice.attaches().length, 2);
    win.dispatchEvent(new Event("focus")); await settle(5);
    assert.equal(thrice.attaches().length, 3, "tried when the window came back");
    win.dispatchEvent(new Event("visibilitychange")); win.dispatchEvent(new Event("focus")); await settle(5);
    assert.equal(thrice.attaches().length, 4, "once for the return, not once per event");
    win.dispatchEvent(new Event("focus")); await settle(5);
    assert.equal(thrice.attaches().length, 4, "attached: no more tries");
  });
});

test("the lines that set an agent up: Claude Code's command, Codex's TOML and the mcpServers JSON, the token in each", () => {
  const url = "http://127.0.0.1:25277/mcp", token = "smc_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde".slice(0, 43);
  const [claude, codex, json] = setupLines(url, token);
  assert.deepEqual([claude.key, codex.key, json.key], ["mcp.claude", "mcp.codex", "mcp.json"]);
  assert.equal(claude.text, `claude mcp add --transport http --scope user smedcover ${url} --header "Authorization: Bearer ${token}"`);
  // Codex: one table, each line a key and a TOML value (a string, an inline table of strings, an integer)
  const lines = codex.text.split("\n");
  assert.equal(lines[0], "[mcp_servers.smedcover]");
  const values = Object.fromEntries(lines.slice(1).map((l) => { const m = /^([a-z_]+) = (.+)$/.exec(l); assert.ok(m, l); return [m[1], m[2]]; }));
  assert.deepEqual(Object.keys(values), ["url", "http_headers", "tool_timeout_sec"]);
  assert.equal(values.url, JSON.stringify(url));
  assert.equal(values.http_headers, `{ "Authorization" = "Bearer ${token}" }`);
  assert.ok(Number.isInteger(+values.tool_timeout_sec) && +values.tool_timeout_sec >= 1800, "as long as an export may take");
  assert.deepEqual(JSON.parse(json.text), { mcpServers: { smedcover: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } });
  // shown masked: the token's end alone, in every line
  const masked = maskToken(token);
  assert.equal(masked, "••••••••" + token.slice(-4));
  for (const { text } of setupLines(url, masked)) {
    assert.ok(!text.includes(token) && !text.includes(token.slice(4, 20)), "the token is not shown");
    assert.ok(text.includes(masked));
  }
  assert.doesNotThrow(() => JSON.parse(setupLines(url, masked)[2].text));
  assert.equal(maskToken(""), "");
});
