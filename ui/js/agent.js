// The agent shell: how a call from an agent (an MCP client, through the host: the desktop app's endpoint, one day a
// server's) is taken and answered. Calls are run one at a time, in the order they came (makeQueue), the caller told
// every few seconds while one waits behind another; each first waits till the user is not in the middle of something
// (whenIdle over app.js's userBusy), telling the caller so; a call that changes something holds the window while it
// runs — the app takes no pointer, the keys, pastes and the wheel are swallowed (not replayed), and after a moment a
// pill of glass says what is being done (#agent in index.html), with a way to stop waiting once it has gone on a while
// — and runs as one step of undo when its tool says so (agentStep in app.js). A call is let go of — answered, the
// window given back, the next call started, what it does later dropped — when nothing is heard from it for its
// timeout, when the host cancels it, or when the user stops waiting. What each tool takes is checked first (checkCall
// in tools.js); what it does is commands.js's. A transport brings the calls and takes the answers (see serve below);
// the dev hook, globalThis.smedcoverAgent, runs the same dispatcher from the browser's console or a test. No DOM at
// the top: Node imports this file for makeQueue, whenIdle and makeAgent.
import { TOOL_BY, toolsJson, toolsText, checkCall, isError, ToolError } from "./tools.js";
import { t } from "./i18n.js";

/** What a call cancelled while it waited answers (nothing is sent for it: the host has let it go). */
export const CANCELLED = Object.freeze({ cancelled: true });
/** How often a call waiting (behind another, or for the user) tells its caller so, in ms: each word sets the host's timer going again. */
export const EVERY = 5000;
/**
 * One call at a time, in the order they came: push(id, run, opts) runs `run(lease)` once those before it are done and
 * resolves with what it resolves with (rejects as it rejects). opts: `waiting(ms)`, told every `every` ms while it
 * waits behind others; `timeoutMs`, how long it may run without a word (lease.touch(), which sets the clock going
 * again) before it is let go, and `lapsed(why)`, what its push then resolves with (why: "timeout", or letGo's). A call
 * let go of is waited for no longer: the next one starts, `lease.gone` turns true, and what it resolves or rejects with
 * later is dropped. cancel(id) takes a call still waiting out of the queue — it never runs, and its push resolves with
 * CANCELLED at once — and answers whether it did; letGo(id, why) lets go of the call running, when it is `id`, and
 * answers whether it did. `running`: the id of the call running, or null; `waiting`: how many wait.
 */
export function makeQueue() {
  const waiting = new Map();
  let tail = Promise.resolve(), current = null;   // current: the call running, {id, letGo(why)}
  return {
    push(id, run, { timeoutMs = Infinity, lapsed = (why) => ({ lapsed: why }), waiting: told = null, every = EVERY } = {}) {
      return new Promise((resolve, reject) => {
        const t0 = performance.now();
        const job = { resolve, cancelled: false, ticker: told ? setInterval(() => { try { told(performance.now() - t0); } catch (e) { console.error(e); } }, every) : 0 };
        waiting.set(id, job);
        tail = tail.then(() => new Promise((next) => {
          clearInterval(job.ticker);
          if (job.cancelled) return next();
          waiting.delete(id);
          let done = false, timer = 0;
          const end = (fn) => {   // once: the queue goes on, then the push is answered
            if (done) return;
            done = true; clearTimeout(timer); current = null; next();
            try { fn(); } catch (e) { reject(e); }
          };
          const arm = () => { clearTimeout(timer); if (timeoutMs < Infinity) timer = setTimeout(() => end(() => resolve(lapsed("timeout"))), timeoutMs); };
          const lease = { get gone() { return done; }, touch: () => { if (!done) arm(); } };
          current = { id, letGo: (why) => end(() => resolve(lapsed(why))) };
          arm();
          new Promise((r) => r(run(lease))).then((v) => end(() => resolve(v)), (e) => end(() => reject(e)));
        }));
      });
    },
    cancel(id) {
      const job = waiting.get(id);
      if (!job) return false;
      job.cancelled = true; clearInterval(job.ticker); waiting.delete(id); job.resolve(CANCELLED);
      return true;
    },
    letGo(id, why = "let go") {
      if (!current || current.id !== id) return false;
      current.letGo(why);
      return true;
    },
    get running() { return current ? current.id : null; },
    get waiting() { return waiting.size; },
  };
}

/** How long the user's hands must have been off the window before a call goes ahead, in ms. */
export const QUIET = 400;
/**
 * Resolves with null once nothing of the user's holds a call back — busy(strict) (userBusy in app.js) says nothing, and
 * no input came in the last QUIET ms (quietFor(): how long since the last) — or, after `timeoutMs` of waiting, with
 * what still holds it (a few words of English), or, as soon as stopped() says so, with "stopped". While it waits it
 * calls waiting(reason, ms) every `every` ms, which tells the caller (whose timer each word from the page sets going
 * again).
 */
export async function whenIdle(strict, timeoutMs, { busy = () => null, quietFor = () => Infinity, waiting = () => {}, stopped = () => false, now = () => performance.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), poll = 100, every = EVERY } = {}) {
  const t0 = now();
  let told = t0;
  for (;;) {
    if (stopped()) return "stopped";
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
/** How long a call the host cancels has to end by itself (it is told: ctx.cancelled()) before it is let go, in ms. */
export const GRACE = 1000;
/** How long a step holds the window before its pill offers to stop waiting for it, in ms. */
export const STOP_AFTER = 20000;

// ---------- holding the window while a step runs
/** The step holding the window: `by` (hold's token, null when none), since when, and the pill's timers. */
const STEP = { by: null, since: 0, timer: 0, late: 0, listening: false };
const INPUT = { at: -Infinity };   // when the user last pressed, let go, typed or turned the wheel (see whenIdle), a step held or not
/** Whether an agent's change is under way: the window is held (app.js's drop handler leaves a drop alone then). */
export const stepping = () => !!STEP.by;
const hasDom = () => typeof addEventListener === "function" && !!globalThis.document;   // none in Node (the tests)
const box = () => (globalThis.document ? document.getElementById("agent") : null);
/** The listeners that note the user's input, all the time (capture phase on the window, before those hold() adds). */
function guard() {
  for (const type of ["pointerdown", "pointerup", "keydown", "input", "wheel"]) addEventListener(type, () => { INPUT.at = performance.now(); }, { capture: true, passive: true });
}
/** A key, a paste or the wheel while a step holds the window: swallowed before anything else sees it — but Esc, once the pill offers it, stops waiting. */
function swallow(e) {
  if (e.type === "keydown" && e.key === "Escape" && STEP.by && STEP.by.offered) STEP.by.stop();
  if (e.cancelable) e.preventDefault();
  e.stopImmediatePropagation();
}
/** A press on the held window (not on the pill's button) pulses the pill. */
const pressed = (e) => { if (!(e.target && e.target.closest && e.target.closest("#agent .stop"))) pulse(); };
/** What hold() listens to while a step runs, and release() lets go of (a drop is left to app.js, which lets it go). */
const HELD = [...["keydown", "keypress", "paste", "wheel"].map((type) => [type, swallow, { capture: true, passive: false }]), ["pointerdown", pressed, { capture: true }]];
function listen(on) {
  if (STEP.listening === on || !hasDom()) return;
  STEP.listening = on;
  for (const [type, fn, opts] of HELD) (on ? addEventListener : removeEventListener)(type, fn, opts);
}
/** A hold on the window, for hold() and release(): `stop`, what stopping waiting for it does (the pill's button, Esc). */
const holding = (stop = () => {}) => ({ stop, offered: false });
/**
 * Holds the window for a step of tool `tool` (`token`: holding()'s): the overlay over it at once, its pill showing a
 * moment later (a quick step shows none) and, after `after` ms, offering to stop waiting.
 */
function hold(token, tool, after = STOP_AFTER) {
  STEP.by = token; STEP.since = performance.now();
  clearTimeout(STEP.timer); clearTimeout(STEP.late);
  listen(true);
  const b = box();
  if (!b) return;
  const key = `agent.step.${tool}`, says = t(key), part = (tag, text = "") => Object.assign(document.createElement(tag), { textContent: text });
  b.querySelector(".pill").replaceChildren(part("i"), part("b", says === key ? t("agent.working") : says), part("small", t("agent.working")));
  b.classList.remove("on", "pulse", "late"); b.hidden = false;
  document.body.classList.add("agent");
  STEP.timer = setTimeout(() => b.classList.add("on"), 150);
  STEP.late = setTimeout(() => offerStop(token), after);
}
/** The step has gone on a while: the pill says so and offers to stop waiting for it. */
function offerStop(token) {
  const b = box(), pill = b && b.querySelector(".pill");
  if (STEP.by !== token || !pill) return;
  token.offered = true;
  const small = pill.querySelector("small"), button = Object.assign(document.createElement("button"), { type: "button", className: "stop", textContent: t("agent.stop"), title: t("agent.stopTip") });
  if (small) small.textContent = t("agent.slow");
  button.onclick = () => token.stop();
  pill.append(button);
  b.classList.add("on", "late");
}
/**
 * Lets the window go, when `token` is the hold on it (a call let go of earlier releases nothing when it ends at last).
 * Had the user pressed, typed or scrolled while it was held, the quiet gap (QUIET) runs from now: they get a moment
 * before the next call.
 */
function release(token) {
  if (!token || STEP.by !== token) return;
  if (INPUT.at >= STEP.since) INPUT.at = performance.now();
  STEP.by = null;
  clearTimeout(STEP.timer); clearTimeout(STEP.late);
  listen(false);
  const b = box();
  if (!b) return;
  b.classList.remove("on", "pulse", "late"); b.hidden = true;
  document.body.classList.remove("agent");
}
/** A press on the held window: the pill shows at once, says to wait a moment (unless it already offers to stop), and pulses. */
function pulse() {
  const b = box();
  if (!b) return;
  const small = b.querySelector(".pill small");
  if (small && !(STEP.by && STEP.by.offered)) small.textContent = t("agent.wait");
  b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("on", "pulse");
}

// ---------- the dispatcher
/**
 * The agent over what app.js gives it: `commands` (makeCommands' tools), `busy` (userBusy), `step` (agentStep(fn,
 * ctl): fn run as one step of undo; ctl.abandon(), which it sets, ends that step as it stands when the call is let go
 * of), `closeTransient` (the menu, popovers and hover previews shut, a field left), `host` ("desktop" or "server": the
 * tools offered there). handle(call, {progress}) takes a call {id, tool, args, timeoutMs?} and
 * resolves with the reply the host is sent — {id, ok: true, result} (a CallToolResult), {id, ok: false, error: {code,
 * message}} — or CANCELLED; it never rejects. `progress(p)` is told {progress, total?, message?} while it waits or
 * works. A call running is let go of (answered failed, the window given back, the queue going on; what it does later is
 * dropped, a failure then not put back: the window has been the user's since) when nothing is heard from it for
 * `timeoutMs` (the call's, else its tool's; each word to the caller sets it going again), `grace` ms after the host
 * cancels it, or when the user stops waiting (the pill's button, after `stopAfter` ms). A call waiting, behind another
 * or for the user, says so every `every` ms. cancel(id): a call waiting never runs (true); one running is told (its
 * ctx.cancelled(), which an export checks between files) and let go of.
 */
export function makeAgent({ commands, busy = () => null, step = (fn) => fn(), closeTransient = () => {}, host = "desktop", quietFor = () => performance.now() - INPUT.at, grace = GRACE, stopAfter = STOP_AFTER, every = EVERY }) {
  const queue = makeQueue(), stop = new Set();
  const fail = (id, code, message) => ({ id, ok: false, error: { code, message } });
  /** The tool called `name`, when there is one and a command for it (not one of Object.prototype's names). */
  const toolOf = (name) => (typeof name === "string" && Object.hasOwn(TOOL_BY, name) && Object.hasOwn(commands, name) ? TOOL_BY[name] : null);
  /** What a call let go of is answered (why: "timeout", "cancelled", "stopped"), `ms` its timeout, `held` whether its change had begun (the window held since `t0`). */
  function letGoSays(name, why, ms, held, t0) {
    const s = (v) => `${Math.round(v / 1000)} s`, after = held ? " It may still finish later: check with get_cover before going on." : "";
    if (why === "stopped") return `The user stopped waiting for ${name} after ${s(performance.now() - t0)}; the window is theirs again.${after}`;
    if (why === "cancelled") return `${name} was cancelled before it finished${held ? "; the window is the user's again" : ""}.${after}`;
    return `${name} did not finish: nothing was heard from it for ${s(ms)}, so it was let go${held ? " and the window given back to the user" : ""}.${after}`;
  }
  async function run(call, def, me, tell) {
    const { id } = call, args = call.args ?? {}, gone = () => me.lease.gone || stop.has(id);
    if (!def) return fail(id, "unknown_tool", `Unknown tool: ${String(call.tool).slice(0, 80)}`);
    const bad = checkCall(def, args);
    if (bad) return fail(id, "invalid_arguments", bad);
    if (!def.hosts.includes(host)) return fail(id, "not_allowed", `${def.name} works only in SmedCover's desktop window, where the user watches.`);
    const said = await whenIdle(def.busy === "strict", PATIENCE[def.busy], { busy, quietFor, every, stopped: gone, waiting: (reason) => tell({ progress: ++me.n, message: `Waiting for the user: ${reason}.` }) });
    if (gone()) return fail(id, "failed", `${def.name} was cancelled before it started.`);
    if (said) return fail(id, "busy", `SmedCover is busy: ${said}. Try again shortly.`);
    const changes = !def.annotations.readOnlyHint, base = me.n;
    const ctx = { progress: (progress, total, message) => tell({ progress: base + progress, ...(total == null ? {} : { total: base + total }), ...(message ? { message } : {}) }), cancelled: gone };
    try {
      if (changes) { me.t0 = performance.now(); me.held = holding(() => queue.letGo(id, "stopped")); hold(me.held, def.name, stopAfter); closeTransient(); }
      const go = async () => {
        try {
          const r = await commands[def.name](args, ctx);
          if (isError(r)) throw new ToolError(r.error.code, r.error.message);
          return r;
        } catch (e) {
          if (!me.lease.gone) throw e;
          console.warn(`[agent] ${def.name} failed after it was let go of; what it changed is kept:`, e);   // not put back over what the user has done since
          return null;
        }
      };
      return { id, ok: true, result: await (def.history ? step(go, me.step) : go()) };
    } catch (e) {
      if (e instanceof ToolError) return fail(id, e.code, e.message);
      console.error(e);
      return fail(id, "failed", `${def.name} failed: ${(e && e.message) || e}`);
    } finally {
      release(me.held);
      stop.delete(id);
    }
  }
  function handle(call, { progress = () => {} } = {}) {
    const c = call && typeof call === "object" ? call : {}, { id = null, tool } = c, def = toolOf(tool), name = def ? def.name : String(tool);
    const ms = Number.isFinite(c.timeoutMs) && c.timeoutMs > 0 ? c.timeoutMs : def ? def.timeoutMs : 30000;
    const me = { n: 0, lease: null, held: null, step: {}, t0: performance.now() };   // step: what agentStep gives the shell to end it with (abandon)
    const tell = (p) => {   // a word to the caller; it sets the call's timeout going again
      if (me.lease && me.lease.gone) return;
      if (me.lease) me.lease.touch();
      try { progress(p); } catch (e) { console.error(e); }
    };
    const lapsed = (why) => { if (me.step.abandon) me.step.abandon(); release(me.held); stop.delete(id); return fail(id, "failed", letGoSays(name, why, ms, !!me.held, me.t0)); };
    const waiting = () => tell({ progress: ++me.n, message: "Waiting for an earlier call to finish." });
    return queue.push(id, (lease) => { me.lease = lease; return run({ ...c, id }, def, me, tell); }, { timeoutMs: ms, lapsed, waiting, every })
      .catch((e) => { console.error(e); release(me.held); return fail(id, "failed", `${name} failed: ${(e && e.message) || e}`); });
  }
  return {
    handle,
    cancel: (id) => {
      if (queue.cancel(id)) return true;
      if (queue.running === id) { stop.add(id); setTimeout(() => queue.letGo(id, "cancelled"), grace); }
      return false;
    },
    queue,
  };
}

// ---------- transports: how calls reach the page and replies leave it
/**
 * Serves `agent` through a transport {listen(onCall, onCancel), reply(id, reply), progress(id, p)}: listen() starts
 * it, handing each call {id, tool, args, client?, timeoutMs?} to onCall and each cancel's id to onCancel; reply()
 * answers call `id` with what the dispatcher resolved with — a failure, should anything go wrong on the way; progress()
 * keeps its caller waiting. A call cancelled while it waited is not answered.
 */
export function serve(agent, transport) {
  const send = (id, r) => { try { transport.reply(id, r); } catch (e) { console.error(e); } };
  transport.listen(
    (call) => {
      const id = call && typeof call === "object" ? call.id ?? null : null;
      new Promise((r) => r(agent.handle(call, { progress: (p) => transport.progress(id, p) })))
        .then((r) => { if (r !== CANCELLED) send(id, r); }, (e) => { console.error(e); send(id, { id, ok: false, error: { code: "failed", message: `The call failed: ${(e && e.message) || e}` } }); });
    },
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
 * The dev hook, globalThis.smedcoverAgent: call(name, args, {onProgress, timeoutMs}) runs a tool through the same
 * dispatcher a host's calls go through (timeoutMs as a host would give it), and resolves with its reply; cancel(id)
 * cancels one as the host would (`last`: the id of the call made last); tools() is ui/tools.json's list. For the
 * browser's console and for tests in a plain page.
 */
function devHook(agent) {
  let next = 0;
  globalThis.smedcoverAgent = Object.freeze({
    call: (name, args = {}, { onProgress, timeoutMs } = {}) => agent.handle({ id: `dev-${++next}`, tool: name, args, ...(timeoutMs ? { timeoutMs } : {}) }, { progress: onProgress || ((p) => console.debug("[agent]", name, p)) }),
    cancel: (id) => agent.cancel(id),
    get last() { return `dev-${next}`; },
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
