// The cut-out models as Settings → AI → Cut-out shows them: each one's state, a download's progress,
// an error's kind, and which way of cutting out is used. No DOM: the tests read these.

const MB = 1048576;
/** Bytes in whole MB, as the page shows sizes. */
export const mb = (n) => Math.round((Number(n) || 0) / MB);

/** The kinds a download's or an import's error starts with (core/src/cut/download.rs); anything else is "other". */
export const CUT_ERRORS = ["network", "proxy", "tls", "http", "checksum", "disk", "file", "busy"];

/**
 * A download's or an import's error: {kind, detail}, the detail what came after the kind (every source tried and how
 * it went); null for a cancel, which shows nothing.
 */
export function cutErr(e) {
  const text = String(e && typeof e === "object" && "message" in e ? e.message : e ?? "").trim();
  if (!text || /^cancelled\b/.test(text)) return null;
  const m = /^([a-z]+):\s*([\s\S]*)$/.exec(text);
  return m && CUT_ERRORS.includes(m[1]) ? { kind: m[1], detail: m[2].trim() } : { kind: "other", detail: text };
}

/**
 * What a model's row says (`m` an item of cut_models, `dl` the download or import under way, {id}):
 * busy; have; noRuntime (its file is there, brought in by hand, the runtime not); partial (some of what is missing
 * came already); missing; unknown (no state could be read). `mb` is what is still to come, `partMb` (when some of it
 * came: a download resumes it, Discard drops it) what of it is there.
 */
export function cutRow(m, dl = {}) {
  if (!m) return { state: "unknown" };
  if (dl.id && dl.id === m.id) return { state: "busy" };
  if (m.have) return { state: "have", mb: mb(m.bytes) };
  const need = Array.isArray(m.files) ? m.files.filter((f) => f.have < f.bytes) : [];
  const left = need.length ? need.reduce((a, f) => a + f.bytes, 0) : m.bytes;
  const part = m.partial > 0 ? { partMb: mb(m.partial) } : {};
  if (m.model && m.runtime === false) return { state: "noRuntime", mb: mb(left), ...part };
  if (m.partial > 0) return { state: "partial", mb: mb(left), ...part };
  return { state: "missing", mb: mb(m.bytes) };
}

/** A reason as short as a line can take: without its kind, at most `n` characters. */
const brief = (why, n = 80) => { const s = String(why || "").replace(/^[a-z]+:\s*/, ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/**
 * A download's progress (the event cut-model-progress) as the parts of its line, each [i18n key, ...arguments]: what
 * it is doing, then where it resumed and how it is connected. A payload without a phase (an older app's) gives the
 * plain percentage.
 */
export function cutProgress(p) {
  if (!p) return [];
  const pct = Math.min(100, Math.floor((100 * (p.done || 0)) / Math.max(1, p.total || 0)));
  const file = p.file === "runtime" ? "cutset.file.runtime" : "cutset.file.model";
  const out = [];
  switch (p.phase) {
    case undefined: case null: case "":
      return [["cutset.progress", pct, mb(p.done), mb(p.total)]];
    case "connecting":
      if (p.retry && p.retry.from !== p.retry.to) out.push(["cutset.phase.retrying", p.retry.from, brief(p.retry.why), p.retry.to]);
      else if (p.retry) out.push(["cutset.phase.again", p.retry.from, brief(p.retry.why)]);
      else out.push(["cutset.phase.connecting", p.source || ""]);
      break;
    case "checking": out.push(["cutset.phase.checking", pct]); break;
    case "downloading": out.push(["cutset.progressFrom", pct, mb(p.done), mb(p.total), { key: file }, p.source || ""]); break;
    case "verifying": out.push(["cutset.phase.verifying"]); break;
    case "unpacking": out.push(["cutset.phase.unpacking"]); break;
    case "importing": out.push(["cutset.phase.importing", pct, { key: file }]); break;
    default: out.push(["cutset.progress", pct, mb(p.done), mb(p.total)]);
  }
  if (p.phase === "downloading" && p.resumedFrom > 0) out.push(["cutset.resumed", mb(p.resumedFrom)]);
  if ((p.phase === "connecting" || p.phase === "downloading") && ["settings", "environment", "direct"].includes(p.via)) out.push(["cutset.via." + p.via, p.proxy || ""]);
  return out;
}

/** The parts of [cutProgress] as text, with `t` (i18n's): an argument {key} is itself translated. */
export const progressText = (parts, t) => parts.map(([key, ...args]) => t(key, ...args.map((a) => (a && typeof a === "object" && a.key ? t(a.key) : a)))).join(" · ");

/**
 * The way a photo's subject is cut out, from the one chosen in Settings (`chosen`: "vision", "birefnet-lite",
 * "birefnet" or "" for the system's own choice) and the models (cut_models). On a computer: as chosen, Vision only on
 * a Mac (else the light model), none chosen being Vision on a Mac and the light model elsewhere. On a server, never
 * Vision: the one chosen if it is there, else the light model if it is, else the full one, else the one chosen or
 * the light model (which then says it is missing).
 */
export function pickCutEngine(chosen, models = [], { mac = false, server = false } = {}) {
  if (!server) return chosen === "vision" ? (mac ? "vision" : "birefnet-lite") : chosen || (mac ? "vision" : "birefnet-lite");
  const have = (id) => models.some((m) => m && m.id === id && m.have);
  const own = chosen === "birefnet" || chosen === "birefnet-lite" ? chosen : "";
  return [own, "birefnet-lite", "birefnet"].find((id) => id && have(id)) || own || "birefnet-lite";
}

/** The files a download fetches, each once (both models share the runtime): {what, url, mirrors, bytes}, for downloading by hand. */
export function filesByHand(models = []) {
  const seen = new Map();
  for (const m of models) for (const f of (m && Array.isArray(m.files) ? m.files : [])) if (f && f.url && !seen.has(f.url)) seen.set(f.url, { what: f.what, id: f.what === "model" ? m.id : "runtime", url: f.url, mirrors: Array.isArray(f.mirrors) ? f.mirrors : [], bytes: f.bytes });
  return [...seen.values()].sort((a, b) => (a.what === "runtime" ? -1 : 0) - (b.what === "runtime" ? -1 : 0));
}

/** The sources a user may choose to download the models from: Automatic (Hugging Face, then its mirror), one alone. */
export const CUT_SOURCES = ["auto", "huggingface", "hf-mirror"];
