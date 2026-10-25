// The agent shell: how a call from an agent (an MCP client, through the host: the desktop app's endpoint, one day a
// server's) is taken and answered. Calls are run one at a time, in the order they came (makeQueue); each first waits
// till the user is not in the middle of something (whenIdle over app.js's userBusy), telling the caller every few
// seconds that it waits; a call that changes something holds the window while it runs — the app takes no pointer, the
// keys, pastes and the wheel are swallowed (not replayed), and after a moment a pill of glass says what is being done
// (#agent in index.html) — and runs as one step of undo when its tool says so (agentStep in app.js). What each tool
// takes is checked first (checkCall in tools.js); what it does is commands.js's. A transport brings the calls and
// takes the answers (see serve below); the dev hook, globalThis.smedcoverAgent, runs the same dispatcher from the
// browser's console or a test. No DOM at the top: Node imports this file for makeQueue and whenIdle.
import { TOOL_BY, toolsJson, toolsText, checkCall, isError, ToolError } from "./tools.js";
import { t } from "./i18n.js";

/** What a call cancelled while it waited answers (nothing is sent for it: the host has let it go). */
export const CANCELLED = Object.freeze({ cancelled: true });
/**
 * One call at a time, in the order they came: push(id, run) runs `run` once those before it are done and resolves
 * with what it resolves with (rejects as it rejects); cancel(id) takes a call still waiting out of the queue — it
 * never runs, and its push resolves with CANCELLED at once — and answers whether it did (a call running is not
 * stopped). `running`: the id of the call running, or null; `waiting`: how many wait.
 */
export function makeQueue() {
  const waiting = new Map();
  let tail = Promise.resolve(), running = null;
  return {
    push(id, run) {
      return new Promise((resolve, reject) => {
        const job = { resolve, cancelled: false };
        waiting.set(id, job);
        tail = tail.then(async () => {
          if (job.cancelled) return;
          waiting.delete(id); running = id;
          try { resolve(await run()); } catch (e) { reject(e); } finally { running = null; }
        });
      });
    },
    cancel(id) {
      const job = waiting.get(id);
      if (!job) return false;
      job.cancelled = true; waiting.delete(id); job.resolve(CANCELLED);
      return true;
    },
    get running() { return running; },
    get waiting() { return waiting.size; },
  };
}

/** How long the user's hands must have been off the window before a call goes ahead, in ms. */
export const QUIET = 400;
/**
 * Resolves with null once nothing of the user's holds a call back — busy(strict) (userBusy in app.js) says nothing, and
 * no input came in the last QUIET ms (quietFor(): how long since the last) — or, after `timeoutMs` of waiting, with
 * what still holds it (a few words of English). While it waits it calls waiting(reason, ms) every `every` ms, which
 * tells the caller (whose timer each word from the page sets going again).
 */
export async function whenIdle(strict, timeoutMs, { busy = () => null, quietFor = () => Infinity, waiting = () => {}, now = () => performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), poll = 100, every = 5000 } = {}) {
  const t0 = now();
  let told = t0;
  for (;;) {
    const reason = busy(strict) || (quietFor() < QUIET ? "the user is working in the window" : null);
    if (!reason) return null;
    const at = now();
    if (at - t0 >= timeoutMs) return reason;
    if (at - told >= every) { told = at; waiting(reason, at - t0); }
    await sleep(poll);
  }
}
/** How long a call waits for the user before it answers busy: a change, and a read. */
const PATIENCE = { strict: 30000, light: 10000 };

// ---------- holding the window while a step runs
const STEP = { on: false, timer: 0 };
const INPUT = { at: -Infinity };   // when the user last pressed, let go, typed or turned the wheel (see whenIdle)
/** Whether an agent's change is under way: the window is held (app.js's drop handler leaves a drop alone then). */
export const stepping = () => STEP.on;
/**
 * The listeners that note the user's input and, while a step runs, swallow the keys, pastes and the wheel before
 * anything else sees them (capture phase on the window; a drop is left to app.js, which lets it go). A press on the
 * held window pulses the pill.
 */
function guard() {
  for (const type of ["pointerdown", "pointerup", "keydown", "input", "wheel"]) addEventListener(type, () => { if (!STEP.on) INPUT.at = performance.now(); }, { capture: true, passive: true });
  for (const type of ["keydown", "keypress", "paste", "wheel"]) addEventListener(type, (e) => { if (!STEP.on) return; if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true, passive: false });
  addEventListener("pointerdown", () => { if (STEP.on) pulse(); }, true);
}
const box = () => (globalThis.document ? document.getElementById("agent") : null);   // none in Node (the tests)
/** Holds the window for a step of tool `tool`: the overlay over it at once, its pill showing a moment later (a quick step shows none). */
function hold(tool) {
  STEP.on = true;
  const b = box();
  if (!b) return;
  const key = `agent.step.${tool}`, says = t(key), part = (tag, text = "") => Object.assign(document.createElement(tag), { textContent: text });
  b.querySelector(".pill").replaceChildren(part("i"), part("b", says === key ? t("agent.working") : says), part("small", t("agent.working")));
  b.classList.remove("on", "pulse"); b.hidden = false;
  document.body.classList.add("agent");
  clearTimeout(STEP.timer); STEP.timer = setTimeout(() => b.classList.add("on"), 150);
}
/** Lets the window go. */
function release() {
  STEP.on = false;
  clearTimeout(STEP.timer);
  const b = box();
  if (!b) return;
  b.classList.remove("on", "pulse"); b.hidden = true;
  document.body.classList.remove("agent");
}
/** A press on the held window: the pill shows at once, says to wait a moment, and pulses. */
function pulse() {
  const b = box();
  if (!b) return;
  const small = b.querySelector(".pill small");
  if (small) small.textContent = t("agent.wait");
  b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("on", "pulse");
}

// ---------- the dispatcher
/**
 * The agent over what app.js gives it: `commands` (makeCommands' tools), `busy` (userBusy), `step` (agentStep: fn run
 * as one step of undo), `closeTransient` (the menu, popovers and hover previews shut, a field left), `host` ("desktop"
 * or "server": the tools offered there). handle(call, {progress}) takes a call {id, tool, args} and resolves with the
 * reply the host is sent — {id, ok: true, result} (a CallToolResult), {id, ok: false, error: {code, message}} — or
 * CANCELLED; `progress(p)` is told {progress, total?, message?} while it waits or works. cancel(id): a call waiting
 * never runs (true); one running is told (its ctx.cancelled(), which an export checks between files) and goes on.
 */
export function makeAgent({ commands, busy = () => null, step = (fn) => fn(), closeTransient = () => {}, host = "desktop", quietFor = () => performance.now() - INPUT.at }) {
  const queue = makeQueue(), stop = new Set();
  const fail = (id, code, message) => ({ id, ok: false, error: { code, message } });
  async function run(call, tell) {
    const { id } = call, def = TOOL_BY[call.tool], args = call.args ?? {};
    if (!def || !commands[def.name]) return fail(id, "unknown_tool", `Unknown tool: ${call.tool}`);
    const bad = checkCall(def, args);
    if (bad) return fail(id, "invalid_arguments", bad);
    if (!def.hosts.includes(host)) return fail(id, "not_allowed", `${def.name} works only in SmedCover's desktop window, where the user watches.`);
    let n = 0;
    const said = await whenIdle(def.busy === "strict", PATIENCE[def.busy], { busy, quietFor, waiting: (reason) => tell({ progress: ++n, message: `Waiting for the user: ${reason}.` }) });
    if (said) return fail(id, "busy", `SmedCover is busy: ${said}. Try again shortly.`);
    const changes = !def.annotations.readOnlyHint, ctx = { progress: (progress, total, message) => tell({ progress: n + progress, ...(total == null ? {} : { total: n + total }), ...(message ? { message } : {}) }), cancelled: () => stop.has(id) };
    if (changes) { hold(def.name); closeTransient(); }
    try {
      const go = async () => { const r = await commands[def.name](args, ctx); if (isError(r)) throw new ToolError(r.error.code, r.error.message); return r; };
      return { id, ok: true, result: await (def.history ? step(go) : go()) };
    } catch (e) {
      if (e instanceof ToolError) return fail(id, e.code, e.message);
      console.error(e);
      return fail(id, "failed", `${def.name} failed: ${(e && e.message) || e}`);
    } finally {
      if (changes) release();
      stop.delete(id);
    }
  }
  return {
    handle: (call, { progress = () => {} } = {}) => queue.push(call.id, () => run(call, progress)),
    cancel: (id) => { if (queue.cancel(id)) return true; if (queue.running === id) stop.add(id); return false; },
    queue,
  };
}

// ---------- transports: how calls reach the page and replies leave it
/**
 * Serves `agent` through a transport {listen(onCall, onCancel), reply(id, reply), progress(id, p)}: listen() starts
 * it, handing each call {id, tool, args, client?, timeoutMs?} to onCall and each cancel's id to onCancel; reply()
 * answers call `id` with what the dispatcher resolved with; progress() keeps its caller waiting. A call cancelled while
 * it waited is not answered.
 */
export function serve(agent, transport) {
  transport.listen(
    (call) => agent.handle(call, { progress: (p) => transport.progress(call.id, p) }).then((r) => { if (r !== CANCELLED) transport.reply(call.id, r); }),
    (id) => agent.cancel(id));
}
// TAURI TRANSPORT — to be written with the Rust side (agent-rust-design §4–§5; not there yet): once start() is done,
// invoke("mcp_attach", {channel: new __TAURI__.core.Channel(), toolsHash: await toolsHash()}); the channel's messages
// are {kind: "call", id, tool, args, client, timeoutMs} → onCall, {kind: "cancel", id} → onCancel, {kind: "status",
// status} → the Settings page; reply(id, r) = invoke("mcp_reply", {reply: r}), progress(id, p) = invoke("mcp_progress",
// {id, ...p}). Then serve(agent, tauriTransport()) in startAgent, under HOST === "tauri".

/** SHA-256 of ui/tools.json as built (toolsText), in hex: the list this page answers to, for the host to compare with the file it serves. */
export async function toolsHash() {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(toolsText())));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/**
 * The dev hook, globalThis.smedcoverAgent: call(name, args, {onProgress}) runs a tool through the same dispatcher a
 * host's calls go through, and resolves with its reply; tools() is ui/tools.json's list. For the browser's console
 * and for tests in a plain page.
 */
function devHook(agent) {
  let next = 0;
  globalThis.smedcoverAgent = Object.freeze({
    call: (name, args = {}, { onProgress } = {}) => agent.handle({ id: `dev-${++next}`, tool: name, args }, { progress: onProgress || ((p) => console.debug("[agent]", name, p)) }),
    tools: () => toolsJson(),
  });
}
/** Starts the agent shell over what app.js gives it (see makeAgent): the window's guards, the dev hook, and the host's transport. Returns the agent. */
export function startAgent(opts) {
  const agent = makeAgent(opts);
  guard();
  devHook(agent);
  return agent;
}
