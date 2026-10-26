// What each agent tool does (tools.js says what each takes and answers). makeCommands(api) is handed what app.js lets
// the commands reach (API, at the foot of app.js) and returns a function for each tool, (args, ctx) → its answer: a
// result (toResult) or a failure (toError, or a ToolError thrown). `args` have been checked against the tool's schema
// (checkCall) before; `ctx` is {progress(n, total, message), cancelled(), say(text)}: say, what the pill over the window
// says the step has got to. A command that changes something runs inside
// one step of undo when its tool says so (agentStep in app.js, see agent.js); a read-only one never switches the
// window: it reads another channel's or profile's cover as it is kept (coverOf) and draws it with that profile. One that
// changes the cover goes where it is aimed first (aim: the window switched there, the layer named found and checked,
// before anything is touched), then does what the editor does for the same change: the same fields, the same touch().
// No DOM at the top: Node imports this file (the tests); a canvas is made only when a preview is drawn.
import { toResult, ToolError, findProfile, findChannel, findSize, keyOf, letterKeysOf, boxesOf, sheetPlan, widthFor, idsSaid, nearNames, placeAt, placePatch, imageType, coverDiff } from "./tools.js";
import { LOOKS, LOOK_IDS, LOOK_TAGS, lookParams } from "./style.js";
import { EFFECTS, BENDS, effectUses, NO_COLUMNS } from "./textfx.js";
import { BEND_IDS, HEADLINES, LETTERED, isLayout, isRemovable, newLayer, duplicate, fillsCanvas, resetPlacement, keepTo, inSize, normalizeCrop, fitCrop, hasArea, canWeave, weavable, appliesTo, normalizeWeave } from "./layers.js";
import { STICKERS, GRAPHICS, userAssets, canTint, assetExists } from "./assets.js";
import { t } from "./i18n.js";
import { PLATFORMS } from "./platforms.js";
import { SIZE_PRESETS } from "./presets.js";
import { SURPRISE_LOCKS, sizeCaption, ratioText, channelIndex } from "./store.js";
import { csvToJobs } from "./csv.js";
import { RULES } from "./deal.js";
import { orientOf } from "./layout.js";
import { aiReady } from "./ai.js";
import { imageReady } from "./repaint.js";

/** What each of Surprise me's locks leaves alone, for list_options. */
const LOCKS = { look: "the look and its settings", theme: "the dark or light ground", lettering: "the letterings: text effects and bends", places: "where things stand (the layout too)", layout: "the layout: no layout preset dealt" };
/** The groups list_options answers with, when not told which. */
const OPTIONS = ["looks", "effects", "bends", "fonts", "platforms", "sizes", "locks"];
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const has = (s, q) => !q || String(s || "").toLowerCase().includes(String(q).trim().toLowerCase());
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A time kept as milliseconds (a picture's in the library), as ISO 8601; null for none, or one no date can be (past ±8.64e15). */
const when = (ms) => { const d = new Date(ms); return ms && Number.isFinite(d.getTime()) ? d.toISOString() : null; };
/**
 * A look's description in a line, for list_options: what it is drawn like (up to its first colon or semicolon) and what
 * it is for (its "— for …" at the end), "Drawn like animation cels — for explainers, reviews, unboxings, everyday vlogs."
 */
function inALine(about) {
  const s = String(about).trim(), head = s.split(/[:;]/)[0].replace(/[.\s]+$/, ""), tail = / — (for [^.—]+)/.exec(s);
  return tail && !head.includes(tail[1]) ? `${head} — ${tail[1]}.` : `${head}.`;
}
/** A call the cover cannot take as it is (a layer of the wrong kind, a font not there…): what is wrong, for the agent. */
const refused = (message) => new ToolError("invalid_arguments", message);
/** A colour as the layers keep it: "#rrggbb" in small letters. */
const hex = (v) => v.toLowerCase();
/** The types of layer each colour of set_layer_color is for, said for the agent when it is given to another. */
const COLOURED = {
  ink: [[...LETTERED, "photo", "asset"], "a lettering layer, a photo (its outline) or a vector asset"],
  hi: [HEADLINES, "a headline (the title, the subtitle or a text layer)"], plateInk: [HEADLINES, "a headline"], hiPlateInk: [HEADLINES, "a headline"],
  plate: [[...HEADLINES, "catname"], "a headline or the channel name"], tint: [["asset"], "a vector asset"], color: [["solid"], "a solid layer"],
};
/** The layers a lettering tool works on, said for the agent. */
const SAID = { headline: "a headline (the title, the subtitle or a text layer)", lettering: "a lettering layer (title, subtitle, tag, catname, brand or text)" };
/** The whole picture, as a crop (none). */
const WHOLE = { x: 0, y: 0, w: 1, h: 1 };
/** A ratio said "w:h", as a number. */
const ratioOf = (s) => { const [w, h] = s.split(":").map(Number); return w / h; };
/** How long Surprise me's hands are drawn for the agent, on their longer side, and how many a row of its sheet has. */
const HAND = { side: 400, cols: 3 };
/** The names no object takes from an agent as its own key (they reach the prototype). */
const ODD_KEYS = ["__proto__", "constructor", "prototype"];
/** A path an agent gives as a folder: absolute, on any system (the host checks it is a folder). */
const ABSOLUTE = /^(\/|[A-Za-z]:[\\/]|\\\\)/;
/** What a file a host reads for an agent says when it is not one it reads (read_picture, read_project in core/src/files.rs), or a link it fetches when it is not a picture it takes (fetch_image's known): the agent's to put right. */
const NOT_READ = /^(not an absolute path|no such file|not a file|not a picture|not a project file|not UTF-8|picture too big|project too big)/;
/** The most a picture an agent names may weigh, read or fetched (PICTURE_MAX in core/src/files.rs, AI_MAX_IMAGE_REPLY in net.rs). */
const PICTURE_MAX = 64 * 1024 * 1024;
/** A call's ctx when none is given (a test calling a command itself): nothing told, never cancelled. */
const HUSHED = Object.freeze({ progress() {}, cancelled: () => false, say() {} });
/** What a failure says, from an Error or the text a host's command rejects with. */
const why = (e) => String((e && e.message) || e);
/**
 * A call's ctx with its progress always rising, as MCP has it: the host passes a word on only when its progress is more
 * than the last one's, its message dropped with it otherwise. `n` as given while that is more, else a thousandth above
 * the last (a file begun before the one before it is written, say); none given (a tick, see ticking), the next whole
 * number. Each call has its own (makeCommands wraps every command), so ticks after a wait go on from it.
 */
export function rising(ctx) {
  let last = 0;
  return { ...ctx, progress(n, total, message) { last = n == null ? Math.floor(last) + 1 : Math.max(n, Math.round(last * 1000 + 1) / 1000); ctx.progress(last, total, message); } };
}

export function makeCommands(api) {
  const { S } = api;
  /**
   * The profile, channel and cover a call names (args.profile, args.channel), else those the window shows; for another
   * profile, the channel it was last on. {p, index, catId}.
   */
  const target = (args) => {
    const p = args.profile !== undefined ? findProfile(S.profiles, args.profile) : S.profile;
    const index = args.channel !== undefined ? findChannel(p.categories, args.channel)
      : p === S.profile ? api.catIndex() : Math.max(0, p.categories.findIndex((c) => c.id === api.channelOf(p)));
    return { p, index, catId: p.categories[index].id };
  };
  /** The size a call names (args.size) of profile p, else the one on the canvas (another profile's: the one of that size, else its first). */
  const sizeIn = (p, args) => (args.size !== undefined ? findSize(p.sizes, args.size) : p.sizes.find((z) => keyOf(z) === S.sel) || p.sizes[0]);
  /** The words a lettering layer of cover c shows. */
  const wordsOf = (L, c) => (L.type === "title" ? c.title : L.type === "subtitle" ? c.subtitle : L.text || "");
  /** Layer L of cover c as get_cover lists it: what every layer has, then what its type has. */
  function layerOut(L, c, letters = false) {
    const o = { id: L.id, type: L.type, kind: isLayout(L) ? "layout" : L.copy ? "copy" : "free", name: api.layerName(L), visible: L.visible, opacity: L.o, locked: L.locked };
    if (isLayout(L) && L.type !== "bg") o.included = !L.off;
    Object.assign(o, { removable: isRemovable(L), copyable: api.copiable(L), place: { ...L.t.all }, tunedAt: Object.keys(L.t.by || {}), sizes: L.sizes ? [...L.sizes] : "all" });
    if (L.clip) o.clip = true;
    if (L.type === "text") o.text = L.text;
    if (LETTERED.includes(L.type)) Object.assign(o, { font: L.font || "", ink: L.ink || "auto", vertical: !!L.vertical });
    if (HEADLINES.includes(L.type)) {
      Object.assign(o, { hi: L.hi || "auto", plate: !!L.plate, plateInk: L.plateInk || "auto", hiPlateInk: L.hiPlateInk || "auto", hiMark: L.hiPlate ? "plate" : L.hiMark || "none",
        fx: L.fx || "auto", fxAmt: L.fxAmt ?? 1, outline: L.stroke ?? 1, shadow: L.shadow ?? 1, bend: L.bend || "none", bendAmt: L.bendAmt ?? 1 });
    }
    if (L.type === "catname") o.plate = !!L.plate;
    if (L.type === "photo") Object.assign(o, { pid: L.pid, fill: !!L.fill, cut: !!L.cut, ...(L.of ? { of: L.of } : {}), ink: L.ink || "auto" });
    if (L.type === "asset") Object.assign(o, { ref: { ...L.ref }, tint: !!L.tint, ...(canTint(L.ref) ? { ink: L.ink || "auto" } : {}) });
    if (L.type === "solid") o.color = L.color;
    if (L.crop) o.crop = copy(L.crop);
    if (L.weave) o.weave = copy(L.weave);
    if (letters && HEADLINES.includes(L.type)) o.letterKeys = letterKeysOf(wordsOf(L, c));
    return o;
  }
  /** What the window shows and has selected. */
  const selection = () => ({ profile: S.profile.id, channel: S.cover.catId, size: S.sel, scope: S.settings.scope, layer: S.layerId, layers: api.pickedIds() });
  /** Layer `id` of the cover on the canvas; a ToolError naming those there are when it has none. */
  const layerHere = (id) => api.layer(id) || (() => { throw new ToolError("invalid_arguments", `No layer "${id}" on this cover; its layers are: ${S.cover.layers.map((l) => l.id).join(", ")}.`); })();
  /** Where the history is. */
  const where = (steps) => ({ index: S.histIdx, ...(steps === undefined ? {} : { steps }), canUndo: S.histIdx > 0, canRedo: S.histIdx < S.hist.length - 1 });
  /** Undo (dir -1) or redo (1) `steps` times, as far as the history goes. */
  const travel = (dir) => async (args) => {
    api.commitPending();   // the user's change still waiting to be recorded is a step of its own: undo goes back to before it
    let moved = 0;
    for (const want = args.steps ?? 1; moved < want; moved++) {
      const i = S.histIdx + dir;
      if (i < 0 || i >= S.hist.length) break;
      await api.timeTravel(dir);
    }
    return toResult({ structured: where(moved), text: moved ? undefined : `Nothing to ${dir < 0 ? "undo" : "redo"}.` });
  };
  const newCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

  // ---------- changing: where a change goes, and what it answers
  /** Layer `id` of cover c; a ToolError naming some of those it has when it has none. */
  const layerOf = (c, id) => c.layers.find((l) => l.id === id) || (() => { throw refused(`No layer "${id}" on this cover; its layers are: ${idsSaid(c.layers.map((l) => l.id))} (get_cover lists them).`); })();
  /**
   * The mutation target: where a tool that changes something acts, the window brought there first. Resolves the
   * profile, channel and size `args` names (args.profile, args.channel, args.size; those shown when left out, another
   * profile on the channel it was last on) and, with `layer` (an id: args.layer unless told; null for none), that layer
   * of the channel's cover, read as it is kept (coverOf) and checked before anything is touched: one of `types` (else
   * refused as not `what`), not locked with `unlocked`, and whatever check(L, c) says (L that layer or null, c that
   * cover: a sentence refuses, null lets it be; it may check other ids of args against c). Only then is the window
   * switched as the user switches it — switchProfile, switchChannel (each a new history, as the user's own switch:
   * agentStep makes the change the first step of it), selectSize (no step) — a toast saying where it went. Resolves
   * with {p, index, catId, z, f, L, switched}: the profile, the channel's index and id, the size on the canvas, frame()
   * (its virtual canvas and the sizes facing its way), the layer on the cover now shown, whether the window switched.
   * Throws a ToolError (invalid_arguments) for a profile, channel, size or layer that is not there or is refused, with
   * the window as it was. The tools that change the cover all start here, and those that export one (the names and the
   * drawing go by the profile on the canvas: nameFor); open_project goes where its project says.
   */
  async function aim(args, { layer = args.layer, types = null, what = "", unlocked = false, check = null } = {}) {
    const { p, index, catId } = target(args), z = args.size !== undefined ? findSize(p.sizes, args.size) : null;
    const c = layer != null || check ? await api.coverOf(p, catId) : null, L0 = layer != null ? layerOf(c, layer) : null;
    if (L0 && types && !types.includes(L0.type)) throw refused(`"${L0.id}" is a layer of type ${L0.type}, not ${what}.`);
    if (L0 && unlocked && L0.locked) throw refused(`"${L0.id}" is locked in place: unlock it first (show_layer with locked: false).`);
    const no = check && check(L0, c);
    if (no) throw refused(no);
    const switched = p !== S.profile || S.cover.catId !== catId;
    if (p !== S.profile) await api.switchProfile(p.id);
    if (S.cover.catId !== catId) await api.switchChannel(catId);
    if (switched) { const k = api.cat(); api.toast(t("agent.switched", S.profile.name, k.name || k.code || "—")); }
    if (z && keyOf(z) !== S.sel) api.selectSize(keyOf(z));
    const L = L0 && api.layer(L0.id);
    if (L0 && !L) throw new ToolError("failed", `"${L0.id}" was not on the cover once the window had switched to it.`);
    return { p: S.profile, index: api.catIndex(), catId, z: api.selSize(), f: api.frame(), L, switched };
  }
  /** What a tool that changed layer L answers: the layer as get_cover lists it, and what was clamped or will not show (warnings), when anything was. */
  const layerDone = (L, warnings = []) => toResult({ structured: { layer: layerOut(L, S.cover), ...(warnings.length ? { warnings } : {}) } });
  /** Layer L's id and those of the layers linked to it (a photo's cut-outs). */
  const withLinked = (L) => [L.id, ...(L.type === "photo" && !L.of ? api.passivesOf(L).map((l) => l.id) : [])];
  /** The id of the layer `above` names on cover c ("top": its topmost), checked; for add_layer and reorder_layer. */
  const aboveOf = (c, above) => (above === "top" ? c.layers.at(-1).id : layerOf(c, above).id);
  /** The fonts a layer can be set in: the bundled ones, those imported and those installed. */
  const fontsHere = () => [...new Set([...api.BUNDLED_FONTS, ...S.importedFonts, ...S.systemFonts])];

  // ---------- what the slower tools share
  /** Tells the caller every 5 s that `message` is still under way (each word sets the host's timer going again), till the function it returns is called. */
  const ticking = (ctx, message) => { const id = setInterval(() => ctx.progress(undefined, undefined, message), 5000); return () => clearInterval(id); };   // the next whole number (rising)
  /** Resolves once while() is false, telling the caller every 5 s; at most `most` ms (then a ToolError busy), and no longer once the call is cancelled. */
  async function waitWhile(cond, ctx, message, most = 300000) {
    if (!cond()) return;
    const stop = ticking(ctx, message), t0 = performance.now();
    try {
      while (cond() && !ctx.cancelled()) {
        if (performance.now() - t0 > most) throw new ToolError("busy", `${message} It is taking long: try again later.`);
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally { stop(); }
  }
  /** The last thing of a path or a link's path, without its extension: a picture's name in the library. */
  const nameIn = (s) => { const last = String(s).split(/[?#]/)[0].split(/[\\/]/).filter(Boolean).pop() || ""; let n = last; try { n = decodeURIComponent(last); } catch (e) { void e; } return n.replace(/\.[^.]*$/, "").slice(0, 60); };
  /**
   * The picture add_photo's source names, as a data: URL, and a name for it — read, fetched or checked, nothing of the
   * cover touched: `path` read by the host (read_picture), `url` fetched by it past the browser's rules (fetch_image;
   * on the plain page, fetched by the page), `data` as given (base64 alone: its type told by its first bytes).
   */
  async function pictureFrom(how, value, ctx) {
    if (how === "path") {
      if (!api.CAN.files) throw new ToolError("unavailable", "This host reads no files of this computer: give the picture as url, library or data.");
      const stop = ticking(ctx, "Reading the picture.");
      try {
        const bytes = new Uint8Array(await api.invoke("read_picture", { path: value }));
        return { src: await api.readAs(new Blob([bytes], { type: imageType(bytes) || "image/png" }), "readAsDataURL"), name: nameIn(value), type: imageType(bytes) };
      } catch (e) { throw NOT_READ.test(why(e)) ? refused(`"source.path": ${why(e)}.`) : new ToolError("failed", `The picture could not be read: ${why(e)}`); }
      finally { stop(); }
    }
    if (how === "url") {
      if (!/^https?:\/\/[^\s]+$/i.test(value.trim())) throw refused(`"source.url" must be an http(s) link; got ${JSON.stringify(value.slice(0, 80))}.`);
      // only a picture the photo store takes, by its first bytes (known), at most PICTURE_MAX, through the proxy the
      // image AI's own pictures at a link are fetched through (its settings'; else the environment's)
      const url = value.trim(), stop = ticking(ctx, "Fetching the picture.");
      try {
        const name = nameIn(new URL(url).pathname);
        if (api.CAN.relay) { const { mime, data } = await api.invoke("fetch_image", { url, proxy: (S.imageAi && S.imageAi.proxy) || null, timeout: 120, known: true }); return { src: `data:${mime};base64,${data}`, name, type: mime }; }
        const r = await fetch(url);
        if (!r.ok) throw new Error(`the server answered ${r.status}`);
        const blob = await r.blob(), type = imageType(await blob.slice(0, 16).arrayBuffer());
        if (blob.size > PICTURE_MAX) throw new Error(`picture too big: the reply at ${url} is more than ${PICTURE_MAX / 1048576} MB`);
        if (!type) throw new Error("not a picture: the link leads to no PNG, JPEG, WebP, GIF, HEIC or AVIF image");
        return { src: await api.readAs(blob.slice(0, blob.size, type), "readAsDataURL"), name, type };
      } catch (e) { throw NOT_READ.test(why(e)) ? refused(`"source.url": ${why(e)}.`) : new ToolError("failed", `The picture at ${url} could not be fetched: ${why(e)}.`); }
      finally { stop(); }
    }
    // data: a data: URL as it is, or base64 alone, its type told by its first bytes
    const d = value.trim(), url = /^data:(image\/[\w.+-]+)(;[^,]*)?;base64,/i.exec(d);
    if (/^data:/i.test(d) && !url) throw refused('"source.data" is a data: URL of no picture in base64 ("data:image/png;base64,…").');
    const b64 = url ? d.slice(url[0].length) : d.replace(/\s+/g, "");
    if (!b64 || /[^A-Za-z0-9+/=\s]/.test(b64.slice(0, 4096))) throw refused('"source.data" must be a picture in base64, or a data: URL.');
    let head;
    try { head = Uint8Array.from(atob(b64.replace(/\s+/g, "").slice(0, 24)), (c) => c.charCodeAt(0)); } catch (e) { throw refused('"source.data" is not base64.'); }
    const type = imageType(head);
    if (!type) throw refused('"source.data" holds no PNG, JPEG, WebP, GIF, HEIC or AVIF picture.');
    return { src: url ? d : `data:${type};base64,${b64}`, name: "", type };
  }
  /** The last Surprise me an agent dealt: its hands, and the step of undo it made (SURPRISE.step), which pick_hand takes another hand on. */
  let dealt = null;
  /** Hand canvases `cvs` on one sheet, `HAND.cols` a row, each labelled under it "1 · Cel" (the one on the canvas marked so). */
  function handSheet(cvs, hands, kept) {
    const gap = 16, cap = 30, w = Math.max(...cvs.map((cv) => cv.width)), h = Math.max(...cvs.map((cv) => cv.height)), cols = Math.min(HAND.cols, cvs.length), rows = Math.ceil(cvs.length / cols);
    const sheet = newCanvas(gap + cols * (w + gap), gap + rows * (h + cap + gap)), x = sheet.getContext("2d");
    x.fillStyle = "#14141c"; x.fillRect(0, 0, sheet.width, sheet.height);
    cvs.forEach((cv, i) => {
      const left = gap + (i % cols) * (w + gap), top = gap + Math.floor(i / cols) * (h + cap + gap), lk = LOOKS[hands[i].style.look];
      x.drawImage(cv, left, top);
      if (i === kept) { x.strokeStyle = "#ffffff"; x.lineWidth = 3; x.strokeRect(left - 1.5, top - 1.5, cv.width + 3, cv.height + 3); }
      x.fillStyle = "#e9e9f0"; x.font = '600 17px -apple-system, "Helvetica Neue", Arial, sans-serif'; x.textBaseline = "middle";
      x.fillText(`${i + 1} · ${lk ? lk.name.en : hands[i].style.look}${i === kept ? " (on the canvas)" : ""}`, left, top + h + cap / 2, w);
    });
    return sheet;
  }
  /** A hand as surprise and pick_hand answer it: its number from 1, its look, its layout ("keep", or a preset's id), a few words. */
  const handOut = (h, i) => ({ hand: i + 1, look: h.style.look, lookName: (LOOKS[h.style.look] || { name: { en: h.style.look } }).name.en, layout: h.layout, says: api.handSays(h) });
  /** The folder an export of profile p goes into: `dir` as given (absolute), else the profile's own; a ToolError when the host writes no files or there is none. */
  function folderFor(p, dir) {
    if (!api.CAN.saveFiles) throw new ToolError("unavailable", "This host writes no files (the desktop app does): render_preview shows a cover instead.");
    if (dir !== undefined) { if (!ABSOLUTE.test(dir.trim())) throw refused(`"dir" must be an absolute folder; got ${JSON.stringify(dir)}.`); return dir.trim(); }
    const kept = S.settings.exportDirs[p.id];
    if (!kept) throw refused(`The profile "${p.name}" has no export folder yet: pass dir (an absolute folder).`);
    return kept;
  }
  /** The sizes of profile p an export or a batch makes: those `sizes` names ("all": every one), else `fallback`'s. */
  const sizesFor = (p, sizes, fallback) => (sizes === "all" ? [...p.sizes] : sizes ? [...new Set(sizes.map((z) => findSize(p.sizes, z)))] : fallback());
  /**
   * Writes export jobs ([{cover, index, size}], the profile's on the canvas) into `dir` as the Export window does —
   * named by the name pattern (nameFor, with `out`), at `out`'s format and scale — but never over a file (writeInto's
   * fresh), the caller told how far it has got and the pill over the window too; cancelled between files. Answers the
   * folder and each file written.
   */
  async function writeOut(jobs, dir, args, ctx) {
    const total = jobs.length, out = { format: args.format ?? S.settings.format, scale: args.scale ?? S.settings.scale, quality: S.settings.quality };
    let begun = 0;   // the files begun: up to two are written while the next is drawn, so `done` lags behind them
    const progress = () => ({
      get cancelled() { return ctx.cancelled(); },
      set: (done, name) => {   // done files written; a name, the file begun (its progress just above done's: rising)
        if (name) begun++;
        ctx.progress(done, total, name ? `Writing ${name} (${begun} of ${total}).` : `${done} of ${total} written.`);
        ctx.say(t("agent.exporting", Math.min(Math.max(begun, 1), total), total));
      },
      close: () => {},
    });
    const { n, paths, err } = await api.writeInto(dir, jobs, { out, progress, fresh: true });
    const files = paths.map(({ path, job }) => ({ path, channel: S.profile.categories[job.index].id, title: job.cover.title, size: keyOf(job.size) }));
    if (err) {
      if (!files.length && /^not a folder/i.test(why(err))) throw refused(`"dir" is no folder here: ${dir}.`);
      throw new ToolError("failed", `${files.length ? `${files.length} of ${total} files were written into ${dir} (${files.map((f) => f.path).join(", ")}), then` : `Nothing was written into ${dir}:`} ${why(err)}`);
    }
    return toResult({ structured: { dir, files, ...(n < total ? { cancelled: true } : {}) } });
  }

  const commands = {
    get_context: async () => {
      const lang = "en", se = S.settings;
      return toResult({ structured: {
        app: { version: await api.appVersion(), host: api.HOST },
        can: { cut: api.CAN.cut, cutReady: api.CAN.cut && api.cutReady(), cutEngine: api.cutEngine(), outlines: api.CAN.outlines, textAi: aiReady(S.ai), imageAi: imageReady(S.imageAi), saveFiles: api.CAN.saveFiles, live: api.HOST === "tauri" },
        profiles: S.profiles.map((p) => ({
          id: p.id, name: p.name, brand: p.brand.name, look: p.style.look, theme: p.style.theme,
          channels: p.categories.map((c) => ({ id: c.id, name: c.name, sub: c.sub, code: c.code, color: c.color })),
          sizes: p.sizes.map((z) => ({ key: keyOf(z), w: z.w, h: z.h, name: z.name, caption: sizeCaption(z, lang), orient: orientOf(z.w, z.h), ticked: (se.exportSizes[p.id] || {})[keyOf(z)] !== false })),
          exportDir: (api.CAN.saveFiles && se.exportDirs[p.id]) || "",
        })),
        current: selection(),
        export: { format: se.format, scale: se.scale, quality: se.quality, nameTemplate: se.nameTemplate },
        history: { canUndo: S.histIdx > 0, canRedo: S.histIdx < S.hist.length - 1 },
      } });
    },
    get_cover: async (args) => {
      const { p, catId } = target(args), c = await api.coverOf(p, catId);
      return toResult({ structured: { profile: p.id, channel: catId, title: c.title, subtitle: c.subtitle, tag: c.tag, look: p.style.look, theme: p.style.theme,
        layers: c.layers.map((L) => layerOut(L, c, !!args.letters)), ...(args.raw ? { raw: copy(c) } : {}) } });
    },
    list_options: async (args) => {
      const want = new Set(args.only || (args.look ? ["looks"] : OPTIONS)), out = {};
      // every look in a line (some 9 KB for them all); one asked for, all of it: what it is, its settings, its scene objects
      if (want.has("looks")) out.looks = (args.look ? [args.look] : LOOK_IDS).map((id) => {
        const L = LOOKS[id], brief = { id, name: L.name.en, kinds: LOOK_TAGS[id] || [], ...(L.oneTheme ? { oneTheme: true } : {}), ...(L.seeded ? { seeded: true } : {}), ...(L.about ? { about: args.look ? L.about.en : inALine(L.about.en) } : {}) };
        if (!args.look) return brief;
        return { ...brief,
          params: L.params.map((d) => (d.text ? { key: d.key, name: d.name.en, text: true, maxLength: d.max, default: d.def }
            : { key: d.key, name: d.name.en, min: d.min, max: d.max, step: d.step, default: d.def, ...(d.toggle ? { toggle: true } : {}), ...(d.needsPhoto ? { needsPhoto: true } : {}) })),
          scene: Object.keys(L.scene || {}) };
      });
      if (want.has("effects")) out.effects = Object.entries(EFFECTS).map(([id, e]) => ({ id, name: e.name.en, kind: e.kind, seeded: !!e.seeded, needsOutlines: e.kind === "outline", available: api.CAN.outlines || e.kind !== "outline" }));
      if (want.has("bends")) out.bends = [{ id: "none", name: "None" }, ...BEND_IDS.map((id) => ({ id, name: BENDS[id].name.en }))];
      if (want.has("fonts")) {
        // latin: of the fonts this answer lists, those that cannot set Chinese (of all 700 installed, some 13 KB more)
        const found = S.systemFonts.filter((f) => has(f, args.fontQuery)), system = found.slice(0, 200), bundled = [...api.BUNDLED_FONTS], imported = [...S.importedFonts];
        out.fonts = { bundled, imported, system, systemMatched: found.length, systemTotal: S.systemFonts.length, latin: [...new Set([...bundled, ...imported, ...system])].filter((f) => S.latinFonts.has(f)) };
      }
      if (want.has("platforms")) out.platforms = PLATFORMS.map((p) => ({ id: p.id, name: p.name.en, wide: [...new Set(p.covers({ orient: "h", red: "3:4" }).map((c) => c.ratio))], tall: [...new Set(p.covers({ orient: "v", red: "3:4" }).map((c) => c.ratio))] }));
      if (want.has("sizes")) out.sizes = SIZE_PRESETS.map((z) => ({ key: keyOf(z), w: z.w, h: z.h, ratio: ratioText(z.w, z.h), caption: sizeCaption(z, "en") }));
      if (want.has("locks")) out.locks = SURPRISE_LOCKS.map((id) => ({ id, keeps: LOCKS[id] || id }));
      return toResult({ structured: out });
    },
    list_library: async (args) => {
      const want = args.kind ? [args.kind] : ["photos", "stickers", "graphics", "mine"], most = args.limit ?? 100, q = args.query, out = {}, more = {};
      const keep = (k, all) => { out[k] = all.slice(0, most); if (all.length > most) more[k] = all.length - most; };
      if (want.includes("photos")) keep("photos", S.library.filter((e) => has(e.name, q) || has(e.kind, q)).map((e) => ({ pid: e.pid, name: e.name, kind: e.kind, at: when(e.at) })));
      if (want.includes("stickers")) keep("stickers", STICKERS.filter((s) => has(s.name.en, q) || has(s.name.zh, q) || has(s.id, q)).map((s) => ({ id: s.id, name: s.name.en, zh: s.name.zh, group: s.group })));
      if (want.includes("graphics")) keep("graphics", GRAPHICS.filter((g) => has(g.name.en, q) || has(g.name.zh, q) || has(g.id, q)).map((g) => ({ id: g.id, name: g.name.en, zh: g.name.zh })));
      if (want.includes("mine")) {
        const folders = new Map(S.assetFolders.map((f) => [f.id, f.name]));
        keep("mine", [...userAssets.values()].filter((a) => has(a.name, q)).map((a) => ({ id: a.id, name: a.name, kind: a.spec ? "ai" : "image", tintable: canTint({ kind: "user", id: a.id }), ...(a.folder ? { folder: folders.get(a.folder) || a.folder } : {}) })));
      }
      return toResult({ structured: { ...out, ...(Object.keys(more).length ? { more } : {}) } });
    },
    render_preview: async (args) => {
      const { p, index, catId } = target(args), c = await api.coverOf(p, catId), side = args.maxSide ?? 1024;
      await api.loadPhotos([...api.pidsOf(c)]);
      const pending = () => ({ fonts: !!api.fontsReading(c.layers), outlines: api.outlinesPending() > 0 });   // outlinesPending: how many are on their way
      if (!args.all) {
        const z = sizeIn(p, args), cv = await api.renderReady(z, c, index, { profile: p, pixelW: widthFor(z, side) });
        const data = await api.pngBase64(cv), { width, height } = cv, boxes = boxesOf(cv._hits, cv._virtual || [z.w, z.h]);
        cv.width = cv.height = 0;
        return toResult({ structured: { sizes: [{ key: keyOf(z), caption: sizeCaption(z, "en"), x: 0, y: 0, w: width, h: height }], width, height, boxes, pending: pending() }, images: [data] });
      }
      // every size on one sheet, each at one height, captioned under it
      const want = Math.max(18, Math.min(44, Math.round(side * 0.028))), plan = sheetPlan(p.sizes, side, { cap: want, gap: Math.round(want * 0.6) }), cap = plan.cap;
      const sheet = newCanvas(plan.width, plan.height), x = sheet.getContext("2d"), sizes = [];
      x.fillStyle = "#14141c"; x.fillRect(0, 0, sheet.width, sheet.height);
      for (const [i, z] of p.sizes.entries()) {
        const t = plan.tiles[i], cv = await api.renderReady(z, c, index, { profile: p, pixelW: t.w }), said = `${sizeCaption(z, "en")} · ${z.w}×${z.h}`;
        x.drawImage(cv, t.x, t.y, t.w, t.h); cv.width = cv.height = 0;
        if (cap >= 10) {   // a sheet of so many sizes that their captions were made too small to read has none
          x.fillStyle = "#e9e9f0"; x.font = `600 ${Math.round(cap * 0.52)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textBaseline = "middle";
          x.fillText(said, t.x, t.y + t.h + cap / 2, t.w);
        }
        sizes.push({ key: keyOf(z), caption: sizeCaption(z, "en"), x: t.x, y: t.y, w: t.w, h: t.h });
      }
      const data = await api.pngBase64(sheet), { width, height } = sheet;
      sheet.width = sheet.height = 0;
      return toResult({ structured: { sizes, width, height, boxes: [], pending: pending() }, images: [data] });
    },
    get_selection: async () => toResult({ structured: selection() }),
    select_layer: async (args) => {
      // everything named found first, then shown: a call that is wrong changes nothing
      const k = args.size !== undefined ? keyOf(findSize(S.profile.sizes, args.size)) : null, one = args.layer !== undefined ? layerHere(args.layer) : null;
      const list = args.layers ? args.layers.map(layerHere) : null, odd = list && list.find((L) => L.type === "bg" || L.type === "frame");
      if (odd && list.length > 1) throw new ToolError("invalid_arguments", `"${odd.id}" cannot be selected with other layers.`);
      if (k && k !== S.sel) api.selectSize(k);
      if (one) api.selectLayer(one.id);
      if (list) api.pickLayers(list.map((L) => L.id));
      return toResult({ structured: selection() });
    },
    undo: travel(-1),
    redo: travel(1),

    // ---- the words, the look, a channel
    set_text: async (args) => {
      await aim(args);
      const c = S.cover, warnings = [];
      for (const k of ["title", "subtitle", "tag"]) {
        if (args[k] === undefined) continue;
        let v = args[k].replace(/\r\n?/g, "\n");
        if (k === "tag" && v.includes("\n")) { v = v.replace(/\s*\n\s*/g, " "); warnings.push("The tag is one line: its line breaks became spaces."); }
        c[k] = v;   // as Cover → Title, Subtitle and Tag
      }
      api.touch({ cover: true, panel: true, side: true });   // the sheet and the layer's properties show them
      return toResult({ structured: { title: c.title, subtitle: c.subtitle, tag: c.tag, ...(warnings.length ? { warnings } : {}) } });
    },
    set_look: async (args) => {
      const { p } = target(args), id = args.look ?? p.style.look, lk = LOOKS[id], defs = new Map(lk.params.map((d) => [d.key, d]));
      for (const [k, v] of Object.entries(args.params || {})) {   // against the look it is to have, before anything is touched; only its own keys are ever copied
        if (["__proto__", "constructor", "prototype"].includes(k)) throw refused(`"params.${k}" is no look's setting.`);
        const d = defs.get(k);
        if (!d) throw refused(`${lk.name.en} (${id}) has no setting "${k}"; its settings are: ${[...defs.keys()].join(", ") || "none"}.`);
        if (d.text ? typeof v !== "string" : typeof v !== "number") throw refused(`"params.${k}" (${d.name.en}) takes ${d.text ? "text" : "a number"}, not ${JSON.stringify(v)}.`);
      }
      await aim(args);   // the profile: its look is every channel's
      const st = S.profile.style, warnings = [];
      if (st.look !== id) st.look = id;   // as a look's card clicked (pickLook), not counted among the most used (countLook)
      if (args.resetParams && ((st.lookArt && st.lookArt[id]) || !same(lookParams(id, st.lookParams[id]), lookParams(id, {})))) { delete st.lookParams[id]; if (st.lookArt) delete st.lookArt[id]; }   // as Restore under its settings
      if (args.params) {
        const vals = lookParams(id, st.lookParams[id]), next = { ...vals };
        for (const [k, v] of Object.entries(args.params)) {
          const d = defs.get(k), w = d.text ? lookParams(id, { [k]: v })[k] : d.toggle ? (v > 0 ? 1 : 0) : clamp(v, d.min, d.max);
          if (w !== v) warnings.push(d.text ? `"${k}" keeps ${d.max} characters at most, without the spaces round them: "${w}".` : d.toggle ? `"${k}" is a switch: ${w} (1 on, 0 off).` : `"${k}" goes from ${d.min} to ${d.max}: ${w}, not ${v}.`);
          next[k] = w;
        }
        if (!same(next, vals)) st.lookParams[id] = { ...vals, ...st.lookParams[id], ...next };   // as its settings tuned
      }
      if (args.theme !== undefined) { st.theme = args.theme; if (lk.oneTheme) warnings.push(`${lk.name.en} has one ground of its own: the theme shows in the profile's other looks.`); }   // as Dark and Light under the ground
      if (args.seed !== undefined) { st.lookSeed = args.seed; if (!lk.seeded) warnings.push(`${lk.name.en} scatters nothing at random: the seed shows in the looks that do.`); }   // as Shuffle
      api.touch({ profile: true, panel: true, side: true });
      return toResult({ structured: { look: id, theme: st.theme, seed: st.lookSeed, params: lookParams(id, st.lookParams[id]), ...(warnings.length ? { warnings } : {}) } });
    },
    set_channel: async (args) => {
      const { p, index } = await aim(args), c = p.categories[index];   // the window shows the channel worked on, as its card in Settings does
      for (const k of ["name", "sub", "code"]) if (args[k] !== undefined) c[k] = args[k];
      if (args.color !== undefined) c.color = hex(args.color);
      api.touch({ profile: true, panel: true, side: true });   // the window's accent follows the channel colour (renderPanel)
      return toResult({ structured: { id: c.id, name: c.name, sub: c.sub, code: c.code, color: c.color } });
    },

    // ---- a layer's place and looks
    place_layer: async (args) => {
      const turns = ["rotate", "rotateBy", "stretchX", "stretchY"].some((k) => args[k] !== undefined), moves = args.x !== undefined || args.y !== undefined;
      const both = [["x", "move.dx", args.x, args.move && args.move.dx], ["y", "move.dy", args.y, args.move && args.move.dy], ["scale", "scaleBy", args.scale, args.scaleBy], ["rotate", "rotateBy", args.rotate, args.rotateBy]].find((q) => q[2] !== undefined && q[3] !== undefined);
      if (both) throw refused(`Give "${both[0]}" or "${both[1]}", not both.`);
      if (args.reset && Object.keys(args).some((k) => ["x", "y", "scale", "rotate", "stretchX", "stretchY", "move", "scaleBy", "rotateBy"].includes(k))) throw refused('"reset" goes alone: it puts the layer back where the layout puts it.');
      const { L, f } = await aim(args, { unlocked: true, check: (L) => (L.type === "bg" ? "bg is the ground: it is not placed (a look's scene objects are dragged on the canvas)."
        : L.type === "frame" ? "The frame follows the template: it is not placed by hand."
        : fillsCanvas(L) && turns ? `"${L.id}" fills the canvas: it is moved and scaled, not turned or stretched.`
        : L.of && moves ? `"${L.id}" is a cut-out linked to photo "${L.of}" and goes where it goes: place that, or move both with "move".` : null) });
      const scope = args.scope ?? "all", warnings = [];
      if (args.reset) {
        if (L.of) {   // a cut-out back over its photo, as Realign does: at every size
          L.t = api.alignedT(api.owner(L));
          if (scope !== "all") warnings.push(`"${L.id}" is a linked cut-out: it went back over its photo at every size, whatever the scope.`);
        } else resetPlacement(L, scope, f.key, f.catId, f.group.map((g) => g.key));   // as Reset under the layer's properties: a photo filling the canvas fills it still, a sticker at the scale it is put on at
        api.touch({ cover: true, side: true });
      } else {
        if (L.crop || (L.type === "photo" && L.cut)) api.drawnNow();   // scaled and turned about what shows of it, as it is drawn now
        // its size, turn and stretch first (a cut-out's or a crop's about its subject), then where it goes, as the canvas's handles and a drag do
        for (const part of [{ scale: args.scale, scaleBy: args.scaleBy, rotate: args.rotate, rotateBy: args.rotateBy, stretchX: args.stretchX, stretchY: args.stretchY }, { x: args.x, y: args.y, move: args.move }]) {
          const { patch, want } = placePatch(L, f, part), said = { x: "x", y: "y", s: "scale", r: "rotate", kx: "stretchX", ky: "stretchY" };
          if (L.of) { delete want.x; delete want.y; }   // a linked cut-out's moves are its photo's
          if (Object.keys(patch).length) api.edit(L, patch, scope);
          const now = placeAt(L, f);
          for (const [k, v] of Object.entries(want)) if (Math.abs(now[k] - v) > 1e-6) warnings.push(`"${said[k]}" came to ${r4(now[k])}, not ${r4(v)}: as far as it goes${scope === "all" ? "" : ` at the sizes scope "${scope}" reaches`}.`);
        }
        api.touch({ cover: true, side: true });   // as a drag let go of, or a nudge of the arrow keys: the layer list and the drawer follow
      }
      const cv = api.drawnNow(), box = boxesOf(cv._hits, cv._virtual || [f.vw, f.vh]).find((b) => b.id === L.id) || null;
      if (!box) warnings.push(`"${L.id}" is not drawn at ${f.key} (hidden, left out, or kept to other sizes).`);
      const at = placeAt(L, f);
      return toResult({ structured: { size: f.key, place: { x: r4(at.x), y: r4(at.y), s: r4(at.s), r: r4(at.r), kx: r4(at.kx), ky: r4(at.ky) }, box, ...(warnings.length ? { warnings } : {}) } });
    },
    set_layer_effect: async (args) => {
      const { L } = await aim(args, { types: HEADLINES, what: SAID.headline, check: (L) => {
        const was = EFFECTS[L.fx] ? L.fx : "auto", fx = args.effect ?? was, e = EFFECTS[fx], named = fx === "auto" ? "The look's own lettering" : e.name.en;
        if (fx !== was && e.kind === "outline" && !api.CAN.outlines) throw new ToolError("unavailable", `${e.name.en} is drawn from the letters' outlines, which this host cannot read (the desktop app can).`);
        if (args.amount !== undefined && (fx === "auto" || e.kind === "passes")) return `${named} has no strength to set ("amount" is for the masked, outlined and letter-by-letter effects).`;
        if (args.reshuffle && !e.seeded) return `${named} deals nothing at random: there is nothing to reshuffle.`;
        return null;
      } });
      const warnings = [], was = EFFECTS[L.fx] ? L.fx : "auto";
      if (args.effect !== undefined && args.effect !== was) {   // as an effect's card clicked (pickFx)
        if (EFFECTS[args.effect].seeded && !L.fxSeed) L.fxSeed = api.fxSeedOf(L);   // the seed its card is drawn with: the layer's own from now on
        if (args.effect === "auto") delete L.fx; else L.fx = args.effect;
      }
      if (args.amount !== undefined) { if (args.amount === 1) delete L.fxAmt; else L.fxAmt = args.amount; }   // as its Strength
      if (args.reshuffle) { let n; do n = 1 + Math.floor(Math.random() * 999998); while (n === L.fxSeed); L.fxSeed = n; }   // as Reshuffle
      const use = effectUses(L.fx), named = (EFFECTS[use.id] || LOOKS[use.id] || { name: { en: use.id } }).name.en;
      for (const [k, key] of [["outline", "stroke"], ["shadow", "shadow"]]) if (args[k] !== undefined) { L[key] = args[k]; if (!use[key]) warnings.push(`${named} draws no ${k}: it is kept for an effect that does.`); }   // as Outline and Shadow
      if (L.fx && NO_COLUMNS.includes(L.fx) && api.inColumns(L)) warnings.push(`${EFFECTS[L.fx].name.en} is not drawn in columns: set in columns, the layer shows the look's own lettering.`);
      api.touch({ cover: true, side: true });
      return layerDone(L, warnings);
    },
    set_layer_font: async (args) => {
      const want = args.font === undefined ? undefined : args.font.trim(), all = fontsHere(), font = want ? all.find((f) => f.toLowerCase() === want.toLowerCase()) : want;
      if (want && !font) { const near = nearNames(want, all); throw refused(`No font "${want}" here${near.length ? `; near it: ${near.join(", ")}` : ""} (list_options with fontQuery lists the installed ones).`); }
      const { L } = await aim(args, { types: LETTERED, what: SAID.lettering }), warnings = [];
      if (font) L.font = font; else if (font === "") delete L.font;   // as the font menu (fontControl), but not put among the recent fonts
      if (args.vertical !== undefined) L.vertical = args.vertical;   // as Lines and Columns
      if (args.vertical === false && api.inColumns(L)) {   // the look sets it in columns of itself, where the editor greys Lines and Columns out (props.verticalByLook)
        const lk = LOOKS[S.profile.style.look] || LOOKS.cel, key = (lk.params.find((d) => d.key === "vertical") || {}).key;
        warnings.push(`The ${lk.name.en} look sets the title and the subtitle in columns itself${key ? ` (its setting "${key}")` : ""}: they stay in columns till that is turned off${key ? ` (set_look with params {"${key}": 0})` : ""}.`);
      }
      if (L.font && S.latinFonts.has(L.font)) warnings.push(`${L.font} has no Chinese: Chinese words are set in another face.`);
      api.touch({ cover: true, side: true });
      return layerDone(L, warnings);
    },
    set_layer_bend: async (args) => {
      if (args.bend === "none" && args.amount !== undefined) throw refused('"amount" is how far a bend goes: with bend "none" there is none.');
      const { L } = await aim(args, { types: HEADLINES, what: SAID.headline }), warnings = [];
      if (args.bend === "none") { delete L.bend; delete L.bendAmt; } else L.bend = args.bend;   // as the bend menu (bendControl), which takes a perspective or a shape dragged by hand away
      delete L.warp; delete L.reshape;
      if (args.amount !== undefined) { if (args.amount === 1) delete L.bendAmt; else L.bendAmt = args.amount; }
      if (L.bend && api.inColumns(L)) warnings.push("The layer is set in columns, where nothing is bent: the bend is kept for when it is in lines again.");
      api.touch({ cover: true, side: true });
      return layerDone(L, warnings);
    },
    set_layer_color: async (args) => {
      const given = Object.keys(COLOURED).filter((k) => args[k] !== undefined);
      const { L } = await aim(args, { check: (L) => {
        const odd = given.find((k) => !COLOURED[k][0].includes(L.type));
        if (odd) return `"${odd}" is for ${COLOURED[odd][1]}; "${L.id}" is a layer of type ${L.type}.`;
        if (L.type === "asset" && (args.ink !== undefined || args.tint !== undefined) && !canTint(L.ref)) return `"${L.id}" is a picture in colours of its own: only a vector asset takes a colour.`;
        if (L.type === "asset" && L.ref.kind === "graphic" && args.tint === false) return "A channel graphic is always one colour: the channel's, or its ink.";
        return null;
      } });
      const warnings = [];
      if (args.plate !== undefined) L.plate = args.plate;   // Plate under the words
      for (const k of ["ink", "hi", "plateInk", "hiPlateInk"]) {   // as each swatch: a colour, or back to automatic (↺)
        if (args[k] === undefined) continue;
        if (args[k] === "auto") delete L[k]; else L[k] = hex(args[k]);
        if (k === "ink" && L.type !== "asset" && L.type !== "photo") delete L.color;   // a text layer of before no longer in the channel colour
        if (k === "ink" && L.type === "asset" && args.ink !== "auto" && L.ref.kind !== "graphic") L.tint = false;   // as Colour → Custom (assetColour): not the channel's
      }
      if (args.tint !== undefined && L.ref.kind !== "graphic") L.tint = args.tint;   // its own colours, or the channel's (assetColour)
      if (args.color !== undefined) L.color = hex(args.color);
      if (args.plateInk !== undefined && args.plateInk !== "auto" && !L.plate) warnings.push("The plate's colour shows once there is a plate (plate: true).");
      if (args.hiPlateInk !== undefined && args.hiPlateInk !== "auto" && !L.hiPlate && !L.hiMark) warnings.push("The highlights' colour shows once the highlighted words have plates or a mark of their own (the layer's properties).");
      if (L.type === "asset" && args.tint !== undefined && L.ink) warnings.push(`Its ink (${L.ink}) wins over the channel colour: set ink to "auto" for the tint to show.`);
      if (L.type === "photo" && args.ink !== undefined && !(L.outline > 0)) warnings.push("A photo's ink is its outline's colour: it shows once it has an outline.");
      api.touch({ cover: true, side: true });
      return layerDone(L, warnings);
    },
    show_layer: async (args) => {
      const p = target(args).p, keys = args.sizes === undefined || args.sizes === "all" ? null : args.sizes.map((z) => keyOf(findSize(p.sizes, z)));
      const { L } = await aim(args, { check: (L) => (args.included !== undefined && !(isLayout(L) && L.type !== "bg") ? `"included" is for the layout's own parts but bg; "${L.id}" ${isLayout(L) ? "is the ground" : "was added: hide it, or remove it with remove_layer"}.`
        : args.visible === true && L.off && args.included !== true ? `"${L.id}" is left out of this cover: bring it back with included: true.`
        : args.opacity !== undefined && L.type === "bg" ? "bg has no opacity: hide it (visible: false) for a clear ground."
        : args.locked !== undefined && (L.type === "bg" || L.type === "frame") ? `${L.id} is never placed by hand: there is nothing to lock.`
        : args.sizes !== undefined && L.type === "bg" ? "bg shows at every size." : null) });
      const all = api.sizeKeys(), warnings = [];
      if (args.included === true && L.off) { delete L.off; L.visible = true; }   // as its switch under Layout → Parts (partsBox)
      if (args.included === false && !L.off) { L.off = true; L.visible = false; if (S.layerId === L.id) S.layerId = "bg"; }
      if (args.visible !== undefined && !L.off) L.visible = args.visible;   // the eye in its row
      if (args.opacity !== undefined) L.o = args.opacity;   // Opacity under its properties
      if (args.locked !== undefined) L.locked = args.locked;   // the padlock in its row
      if (args.sizes !== undefined) keepTo(L, keys || all, all);   // the sizes it shows at, under its properties
      if (!inSize(L, S.sel) && L.visible) warnings.push(`It is not shown at ${S.sel}, the size on the canvas.`);
      api.touch({ cover: true, side: true, panel: true });
      return layerDone(L, warnings);
    },

    // ---- the stack
    add_layer: async (args) => {
      const k = args.kind, only = { text: "text", color: "solid", asset: "asset", of: "copy" };
      const odd = Object.keys(only).find((a) => args[a] !== undefined && only[a] !== k);
      if (odd) throw refused(`"${odd}" is for kind "${only[odd]}", not "${k}".`);
      if (k === "asset" && !args.asset) throw refused('kind "asset" needs "asset": {kind, id}, from list_library.');
      if (k === "copy" && args.of === undefined) throw refused('kind "copy" needs "of": the id of the layer to copy.');
      const ref = k === "asset" ? { kind: args.asset.kind, id: args.asset.id } : null;
      if (ref && !assetExists(ref)) throw refused(`No ${ref.kind} "${ref.id}" (list_library lists them).`);
      let above;
      const { L: src } = await aim(args, { layer: k === "copy" ? args.of : null, check: (L, c) => {
        if (k === "copy" && !api.copiable(L)) return `"${L.id}" cannot be copied: ${L.type === "bg" ? "the ground is one of a kind" : L.type === "frame" ? "the frame is one of a kind" : "a linked cut-out is made by cutting its photo out again"}.`;
        above = args.above === undefined ? (k === "copy" ? undefined : aboveOf(c, "top")) : aboveOf(c, args.above);   // a copy goes just above what it copies, unless told
        return null;
      } });
      const at = args.at ? { x: args.at.x, y: args.at.y } : null;
      let L;
      if (k === "asset") L = api.addAsset(ref, at, above);   // as its tile clicked (a sticker at STICKER_SCALE)
      else if (k === "copy" && above === undefined) L = api.duplicateLayer(src.id);   // as Duplicate: just above what it copies, over what is clipped onto it
      else api.addLayer(L = k === "text" ? newLayer("text", { text: (args.text ?? t("layer.newText")).replace(/\r\n?/g, "\n") }) : k === "solid" ? newLayer("solid", { color: hex(args.color ?? api.cat().color) }) : duplicate(src), above);   // as Assets → Text and Colour
      const placed = (at && k !== "asset") || args.scale !== undefined;
      if (at && k !== "asset") { L.t.all.x = at.x; L.t.all.y = at.y; }
      if (args.scale !== undefined) L.t.all.s = args.scale;
      // at every size, as place_layer in scope all puts it: a copy's tunings at some sizes (its original's) give way where at and scale say
      if (placed) for (const b of Object.values(L.t.by)) { if (at) { b.dx = 0; b.dy = 0; } if (args.scale !== undefined) b.s = 1; }
      if (placed) api.touch({ cover: true, side: true });
      return toResult({ structured: { layer: layerOut(L, S.cover) } });
    },
    remove_layer: async (args) => {
      const { L } = await aim(args, { check: (L) => (isRemovable(L) ? null : L.type === "bg" ? "bg is the ground: it cannot be removed (hide it with show_layer for a clear ground)."
        : `"${L.id}" is one of the layout's own parts: it cannot be removed. Hide it (show_layer, visible: false) or leave it out of the cover (included: false).`) });
      const gone = withLinked(L);
      api.removeLayer(L.id);   // as its ✕ and Delete: a photo takes its linked cut-outs with it
      return toResult({ structured: { removed: gone } });
    },
    reorder_layer: async (args) => {
      const { L } = await aim(args, { check: (L, c) => (L.type === "bg" ? "bg stays at the bottom." : args.above !== undefined && aboveOf(c, args.above) === L.id ? "A layer cannot go above itself." : null) });
      const list = S.cover.layers, from = list.indexOf(L), warnings = [];
      let moved;
      if (args.to === "up" || args.to === "down") moved = api.shiftLayer(args.to === "up" ? 1 : -1, L.id);   // as ▲ and ▼ by the layer list: past the next layer of this cover
      else {
        const i = args.to === "top" ? list.length - 1 : args.to === "bottom" ? 1 : list.findIndex((l) => l.id === aboveOf(S.cover, args.above)), to = args.above === undefined ? i : from < i ? i : i + 1;
        moved = to !== from && api.restack(L.id, to);   // as a row dropped on another in the layer list: the layout's parts so in the design too
      }
      if (!moved) warnings.push(`"${L.id}" is there already.`);
      return toResult({ structured: { index: S.cover.layers.indexOf(L), layers: S.cover.layers.map((l) => l.id), ...(warnings.length ? { warnings } : {}) } });
    },

    // ---- photos, the cut-out, the weave
    add_photo: async (args, ctx = HUSHED) => {
      const how = Object.keys(args.source)[0], value = args.source[how];
      if (args.fill && args.at) throw refused('"at" is for a print: a photo that fills the canvas fills it.');
      if (args.fill && args.above !== undefined) throw refused('"above" is for a print: a photo that fills the canvas goes down to the ground as the background, above bg and the photos filling the canvas there already.');
      const kept = how === "library" ? S.library.find((e) => e.pid === value.trim()) : null;
      if (how === "library" && !kept) throw refused(`No picture "${value}" in the library (list_library lists its photos).`);
      const pic = kept ? null : await pictureFrom(how, value, ctx);   // read, fetched or checked before anything is touched
      // decoded too, into the photo store but not written (putPhoto, save: false): a picture the web view cannot read
      // (HEIC off macOS, base64 broken past its start) is refused with the window where it was, and nothing kept
      const fresh = pic ? await api.putPhoto(pic.src, { save: false }) : null;
      if (pic && !fresh) throw refused(`The picture could not be read here${/hei[cf]|avif/.test(pic.type || "") ? ` (${pic.type.slice(6).toUpperCase()} is read where the system reads it: on macOS)` : ""}.`);
      let above;
      try { await aim(args, { check: (L, c) => { above = args.above === undefined ? undefined : aboveOf(c, args.above); return null; } }); }
      catch (e) { if (fresh) S.photos.delete(fresh); throw e; }   // refused, or the switch failed: the picture let go of again, no orphan left
      const pid = kept ? kept.pid : fresh;
      if (fresh) { api.savePhoto(fresh); api.keepPicture(fresh, args.name ?? pic.name, "upload"); }   // as a photo uploaded (uploadPhotos → addPhoto): its files written, and into the bitmap library
      const L = await api.placePhoto(pid, args.at ? { x: args.at.x, y: args.at.y } : null, !!args.fill, above);   // as a photo placed: a print above `above` (the selected layer), or the background where Fill the canvas takes it (toGround)
      if (!L) throw new ToolError("failed", `The picture "${pid}" could not be read from the photo store.`);
      return toResult({ structured: { layer: layerOut(L, S.cover), pid } });
    },
    crop_photo: async (args) => {
      const c = args.crop, edges = c ? ["x", "y", "w", "h"].filter((k) => c[k] !== undefined) : [];
      if (c && c.pts && edges.length) throw refused('"crop" is a rectangle (x, y, w, h) or a shape (pts), not both.');
      if (c && !c.pts && edges.length !== 4) throw refused(`A rectangle takes x, y, w and h, all four (this one has ${edges.join(", ") || "none"}); a free shape takes pts.`);
      if (c && c.pts && !hasArea(c.pts)) throw refused("The shape has (almost) no area: its corners lie on a line or close together. Give at least three corners round the part to keep.");
      const { L } = await aim(args, { types: ["photo", "asset"], what: "a photo or an asset", check: (L) => (fillsCanvas(L) ? `"${L.id}" fills the canvas: it is not cropped (its crop window does not open for it).`
        : L.type === "asset" && !assetExists(L.ref) ? `"${L.id}" shows an asset no longer in the library: there is nothing to crop.` : null) });
      const size = api.canCrop(L) && api.pictureSize(L);
      if (!size) throw new ToolError("failed", `"${L.id}"'s picture is not here: there is nothing to crop.`);
      // as the crop window: a rectangle or a shape put on, a ratio chosen (fitted about what was kept), Reset
      const warnings = [], want = args.reset ? null : args.ratio ? fitCrop(L.crop || WHOLE, args.ratio === "photo" ? 1 : (ratioOf(args.ratio) * size[1]) / size[0]) : c.pts ? { pts: c.pts } : { x: c.x, y: c.y, w: c.w, h: c.h };
      const n = normalizeCrop(want);
      if (c && !c.pts && n && ["x", "y", "w", "h"].some((k) => Math.abs(n[k] - c[k]) > 1e-4)) warnings.push(`The crop was kept within the picture: x ${n.x}, y ${n.y}, w ${n.w}, h ${n.h}.`);
      if (c && !n) warnings.push(`The ${c.pts ? "shape" : "rectangle"} is the whole picture: no crop.`);
      if (!api.setCrop(L, want)) warnings.push(L.crop ? "It was cropped so already." : "It was not cropped.");
      return toResult({ structured: { crop: L.crop ? copy(L.crop) : null, ...(warnings.length ? { warnings } : {}) } });
    },
    cut_out: async (args, ctx = HUSHED) => {
      if (!api.CAN.cut) throw new ToolError("unavailable", "This host cannot cut a subject out (the desktop app can).");
      if (!api.cutReady()) throw new ToolError("unavailable", `The cut-out's model (${api.cutEngine()}) is not downloaded: the user can download it in Settings → AI → Cut-out (or choose Vision there, on macOS 14 and later).`);
      await waitWhile(() => api.CUT.busy, ctx, "Waiting for the cut-out under way to finish.");   // one the user began
      if (ctx.cancelled()) throw new ToolError("failed", "cut_out was cancelled before it began.");
      const { L, z } = await aim(args, { types: ["photo"], what: "a photo", check: (L) => (L.of ? `"${L.id}" is a cut-out: cut out its photo, "${L.of}", instead (its subject is found again).` : null) });
      const scope = args.scope ?? "all", keys = scope === "all" ? null : api.scopeKeys(scope, keyOf(z)), stop = ticking(ctx, "Cutting out the subject.");
      let cut;
      try { cut = await api.cutOut(L, keys); } finally { stop(); }   // as Cut out subject, at the sizes the scope asked reaches
      if (!cut) throw new ToolError(api.CUT.needModel ? "unavailable" : "failed", `The subject could not be cut out${api.CUT.error ? `: ${api.CUT.error}` : "."}`);
      return toResult({ structured: { cutout: cut.id, sizes: cut.sizes ? [...cut.sizes] : "all" } });
    },
    weave: async (args) => {
      for (const k of Object.keys(args.front || {})) if (ODD_KEYS.includes(k)) throw refused(`"front.${k}" is no layer's id.`);
      if (args.off && ["by", "with", "line", "front", "strokes"].some((k) => args[k] !== undefined)) throw refused('"off" goes alone: it unweaves the layer.');
      let next = null;
      const { L } = await aim(args, { check: (L, c) => {
        if (!canWeave(L)) return `"${L.id}" is ${L.type === "photo" ? "a photo that is not cut out" : `a layer of type ${L.type}`}: weave takes a cut-out (cut_out makes one) or an asset.`;
        if (args.off) return null;
        // the weave as asked, from the one it has or, the first time, as Weave switched on: with the title (else the lettering nearest below), its head in front
        const below = weavable(c.layers, c.layers.indexOf(L)).filter((l) => appliesTo(l, c.catId) && !l.off), ids = below.map((l) => l.id);
        const first = below.find((l) => l.id === "title") || below.at(-1), w = L.weave || { with: first ? [first.id] : [], by: "head", line: 0.3, front: {} };
        const mine = args.with ?? w.with.filter((id) => ids.includes(id)), odd = mine.find((id) => !ids.includes(id));
        if (odd) return `"${odd}" is not a lettering layer below "${L.id}" on this cover${ids.length ? `; those it can weave with: ${ids.join(", ")}` : ": there is none (reorder_layer puts it above the title)"}.`;
        const front = Object.fromEntries(Object.entries(w.front || {}).filter(([id]) => mine.includes(id)));   // a layer no longer woven with takes its letters in front with it
        for (const [id, v] of Object.entries(args.front || {})) {   // only the ids of the layers it weaves with are ever keys (__proto__ and the like refused above)
          if (!mine.includes(id)) return `"front.${id}": "${id}" is not among the layers it weaves with (${mine.join(", ") || "none"}): add it to "with".`;
          const letters = letterKeysOf(wordsOf(below.find((l) => l.id === id), c));
          const keys = v === "all" ? letters : v === "none" ? [] : v === "alternate" ? letters.filter((_, i) => i % 2 === 0) : [...new Set(v)];   // as All in front, All behind, Every other one, or the letters clicked
          const bad = keys.find((k) => !letters.includes(k));
          if (bad) return `"front.${id}": "${bad}" is not one of ${id}'s letters (get_cover with letters: true lists their keys: ${idsSaid(letters, 8) || "none"}).`;
          if (keys.length) front[id] = keys; else delete front[id];
        }
        next = normalizeWeave({ ...w, with: mine, front, ...(args.by ? { by: args.by } : {}), ...(args.line !== undefined ? { line: args.line } : {}), ...(args.strokes ? { strokes: args.strokes } : {}) });
        return null;
      } });
      const warnings = [];
      if (args.off) { if (!L.weave) warnings.push(`"${L.id}" was not woven.`); delete L.weave; }   // as Weave switched off
      else {
        L.weave = next;
        const w = next, kept = (what, way) => warnings.push(`${what} shows when by is "${way}" (it is "${w.by}"): kept for then.`);
        if (!w.with.length) warnings.push("It weaves with no lettering: nothing comes in front of it or goes behind (with names the layers).");
        if (args.front && w.by !== "letters") kept("Which letters are in front", "letters");
        if (args.line !== undefined && w.by !== "head") kept("Where the head ends", "head");
        if (args.strokes && w.by !== "brush") kept("What the brush paints", "brush");
        if (w.by === "letters" && w.with.length && !Object.keys(w.front).length) warnings.push("No letter is in front yet: front says which.");
        if (w.by === "brush" && w.with.length && !(w.strokes || []).some((s) => s.front)) warnings.push("No brush stroke brings the lettering in front yet: strokes says where.");
      }
      if (S.weaveWin) api.weaveClose();
      if (S.brushWin) api.brushClose();
      api.touch({ cover: true, side: true });
      return toResult({ structured: { weave: L.weave ? copy(L.weave) : null, ...(warnings.length ? { warnings } : {}) } });
    },

    // ---- Surprise me
    surprise: async (args, ctx = HUSHED) => {
      await aim(args);
      const count = args.count ?? RULES.hands.count, locks = args.locks ? Object.fromEntries(args.locks.map((k) => [k, true])) : { ...S.settings.surprise.locks };   // this call's alone, never kept (Surprise me's own when not told)
      const z = api.selSize(), cvs = [];
      api.SURPRISE.busy = true;   // as Surprise me deals: nothing recorded meanwhile, and the user's calls wait
      let hands;
      try {
        hands = await api.dealHands({ count, locks, shown: z, px: Math.round(widthFor(z, HAND.side)), each: async (i, h, cv) => {
          cvs[i] = cv;
          ctx.progress(i + 1, count, `Dealt hand ${i + 1} of ${count}: ${(LOOKS[h.style.look] || { name: { en: h.style.look } }).name.en}.`);
          await new Promise((r) => setTimeout(r, 0));   // the window keeps answering between two
        } });
        if (!hands.length) throw new ToolError("failed", "No hand could be dealt.");
        api.keepFirst(hands);   // the first on the canvas, one step of undo, which pick_hand takes another hand on (not counted among the most used: that is the window's Done)
      } finally { api.SURPRISE.busy = false; }
      dealt = { hands, step: api.SURPRISE.step };
      const images = [], want = args.images ?? "sheet";
      try {
        if (want === "each") for (const cv of cvs) images.push(await api.pngBase64(cv));
        if (want === "sheet") { const sheet = handSheet(cvs, hands, 0); images.push(await api.pngBase64(sheet)); sheet.width = sheet.height = 0; }
      } finally { for (const cv of cvs) cv.width = cv.height = 0; }
      return toResult({ structured: { hands: hands.map(handOut), kept: 1, locks: SURPRISE_LOCKS.filter((k) => locks[k]) }, images });
    },
    pick_hand: async (args) => {
      const live = !!dealt && !!dealt.step && api.SURPRISE.step === dealt.step && S.histIdx === dealt.step.idx;
      if (!live) throw refused(dealt ? "The cover has changed since the last surprise, or it was undone: its hands are past taking. Deal again with surprise." : "There is no surprise to take a hand of: deal with surprise first.");
      if (args.hand > dealt.hands.length) throw refused(`The last surprise dealt ${dealt.hands.length} hand${dealt.hands.length === 1 ? "" : "s"}: pick 1 to ${dealt.hands.length}.`);
      const h = dealt.hands[args.hand - 1];
      if (!api.takeHand(h)) throw refused("The cover has changed since the last surprise: its hands are past taking. Deal again with surprise.");   // as a hand clicked in Surprise me's window: the same step
      const o = handOut(h, args.hand - 1);
      return toResult({ structured: { kept: args.hand, look: o.look, lookName: o.lookName } });
    },

    // ---- a cover or a project given whole
    apply_cover_json: async (args) => {
      const { catId } = await aim(args);
      const fixed = api.channelCover(copy(args.cover), S.profile, catId);   // checked as a cover read from its file is
      const gone = new Set(await api.loadPhotos([...api.pidsOf(fixed)]));
      const answer = coverDiff(args.cover, fixed, { hasPhoto: (pid) => S.photos.has(pid) && !gone.has(pid), hasAsset: assetExists });
      api.setCover(fixed);
      if (!api.layer(S.layerId)) S.layerId = "title";
      S.picked = [];
      api.touch({ cover: true, panel: true, side: true, strip: true });
      return toResult({ structured: answer });
    },
    open_project: async (args, ctx = HUSHED) => {
      let raw = args.project;
      if (args.file !== undefined) {
        if (!api.CAN.files) throw new ToolError("unavailable", "This host reads no files of this computer: give the project itself (project).");
        const stop = ticking(ctx, "Reading the project.");
        try { raw = await api.invoke("read_project", { path: args.file }); }
        catch (e) { throw NOT_READ.test(why(e)) ? refused(`"file": ${why(e)}.`) : new ToolError("failed", `The project could not be read: ${why(e)}`); }
        finally { stop(); }
      }
      if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch (e) { throw refused(`The project is not JSON: ${why(e)}.`); } }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.kind !== "project" || !raw.cover || typeof raw.cover !== "object") throw refused('That is no SmedCover project: a project is what the app saves as a .smedcover.json ({"kind": "project", "cover": {…}, "profile": {…}, …}).');
      const as = args.as ?? "new", had = new Set(S.profiles.map((p) => p.id)), theirs = raw.profile && typeof raw.profile === "object" ? raw.profile : null, warnings = [];
      if (args.as !== undefined && (!theirs || had.has(theirs.id))) warnings.push(theirs ? `Its profile, "${theirs.name || theirs.id}", is here: it opened there ("as" is for a project whose profile is not).` : "It is a project from before profiles went with them: it opened into the channel on the canvas.");
      // as Open project, its question answered by `as`; the caller told as each picture is taken in, and every 5 s (a big project's take a while)
      const stop = ticking(ctx, "Opening the project.");
      let got;
      try { got = await api.openProject(raw, () => as, { each: (done, total) => ctx.progress(undefined, undefined, `Took in picture ${done} of ${total} of the project.`) }); }
      finally { stop(); }
      if (!got) throw new ToolError("failed", "The project was not opened.");
      const k = api.cat();
      api.toast(t("proj.opened", S.profile.name, k.name || k.code || "—"));
      return toResult({ structured: { profile: { id: S.profile.id, name: S.profile.name, created: !had.has(S.profile.id) }, channel: S.cover.catId, ...(warnings.length ? { warnings } : {}) } });
    },

    // ---- files
    batch_covers: async (args, ctx = HUSHED) => {
      const { p } = target(args), dir = folderFor(p, args.dir), sizes = sizesFor(p, args.sizes, () => [...p.sizes]);
      let rows;   // everything they name found before anything is drawn or written
      if (args.jobs) rows = args.jobs.map((j) => ({ index: findChannel(p.categories, j.channel), title: j.title, tag: j.tag ?? "", subtitle: j.subtitle ?? "" }));
      else {
        rows = csvToJobs(args.csv);
        const unknown = [...new Set(rows.filter((r) => r.category && channelIndex(r.category, p.categories) < 0).map((r) => r.category))];
        if (!rows.length) throw refused("The CSV has no row with a title (its columns: channel, title, tag, subtitle; a header row is optional).");
        if (unknown.length) throw refused(`The CSV names channels "${p.name}" does not have: ${unknown.map((c) => JSON.stringify(c)).join(", ")}; its channels are: ${p.categories.map((c, n) => `${n + 1}. ${c.name || c.code || "—"}`).join(", ")}. Nothing was written.`);
      }
      await aim(args);   // the names and the drawing go by the profile on the canvas (nameFor): the window goes to it; its covers are not changed
      const jobs = [];
      for (const j of api.batchJobs(rows).jobs) {   // each its channel's own cover with the row's words, as a CSV imported makes them (a row without a channel: the one shown)
        await api.loadPhotos([...api.pidsOf(j.cover)]);
        for (const size of sizes) jobs.push({ ...j, size });
      }
      return writeOut(jobs, dir, args, ctx);
    },
    export: async (args, ctx = HUSHED) => {
      const { p, index: shown } = target(args), dir = folderFor(p, args.dir);
      const indexes = args.channels === "all" ? p.categories.map((_, i) => i) : args.channels ? [...new Set(args.channels.map((c) => findChannel(p.categories, c)))] : [shown];
      const ticked = (z) => (S.settings.exportSizes[p.id] || {})[keyOf(z)] !== false;   // as the Export window has it (ticked in app.js), for the profile asked
      const sizes = sizesFor(p, args.sizes, () => p.sizes.filter(ticked));
      if (!sizes.length) throw refused(`No size of "${p.name}" is ticked in the Export window: pass sizes ("all", or some of ${p.sizes.map(keyOf).join(", ")}).`);
      await aim(args);   // the names and the drawing go by the profile on the canvas (nameFor): the window goes to it first
      const jobs = [];
      for (const index of indexes) {
        const id = S.profile.categories[index].id, cover = id === S.cover.catId ? S.cover : api.coverFor(id);
        await api.loadPhotos([...api.pidsOf(cover)]);
        for (const size of sizes) jobs.push({ cover, index, size });
      }
      return writeOut(jobs, dir, args, ctx);
    },
  };
  // each call's word of progress above its last, whoever sends it (a wait, a tick, a file, a hand): rising
  for (const [name, run] of Object.entries(commands)) commands[name] = (args, ctx = HUSHED) => run(args, rising(ctx));
  return commands;
}
