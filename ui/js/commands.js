// What each agent tool does (tools.js says what each takes and answers). makeCommands(api) is handed what app.js lets
// the commands reach (API, at the foot of app.js) and returns a function for each tool, (args, ctx) → its answer: a
// result (toResult) or a failure (toError, or a ToolError thrown). `args` have been checked against the tool's schema
// (checkCall) before; `ctx` is {progress(n, total, message), cancelled()}. A command that changes something runs inside
// one step of undo when its tool says so (agentStep in app.js, see agent.js); a read-only one never switches the
// window: it reads another channel's or profile's cover as it is kept (coverOf) and draws it with that profile. One that
// changes the cover goes where it is aimed first (aim: the window switched there, the layer named found and checked,
// before anything is touched), then does what the editor does for the same change: the same fields, the same touch().
// No DOM at the top: Node imports this file (the tests); a canvas is made only when a preview is drawn.
import { TOOLS, toResult, toError, ToolError, findProfile, findChannel, findSize, keyOf, letterKeysOf, boxesOf, sheetPlan, widthFor, idsSaid, nearNames, placeAt, placePatch } from "./tools.js";
import { LOOKS, LOOK_IDS, LOOK_TAGS, lookParams } from "./style.js";
import { EFFECTS, BENDS, effectUses, NO_COLUMNS } from "./textfx.js";
import { BEND_IDS, HEADLINES, LETTERED, isLayout, isRemovable, newLayer, duplicate, fillsCanvas, resetPlacement, keepTo, inSize } from "./layers.js";
import { STICKERS, GRAPHICS, userAssets, canTint, assetExists } from "./assets.js";
import { t } from "./i18n.js";
import { PLATFORMS } from "./platforms.js";
import { SIZE_PRESETS } from "./presets.js";
import { SURPRISE_LOCKS, sizeCaption, ratioText } from "./store.js";
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

export function makeCommands(api) {
  const { S } = api;
  const notYet = Object.assign(() => toError("unavailable", "not implemented yet"), { pending: true });   // a tool still to be done (the tests list them)
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
   * the window as it was. The tools that change the cover all start here; those to come (photos, the cut-out, the
   * weave, Surprise me, a project, a batch, an export) too.
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
        const found = S.systemFonts.filter((f) => has(f, args.fontQuery));
        out.fonts = { bundled: [...api.BUNDLED_FONTS], imported: [...S.importedFonts], system: found.slice(0, 200), systemMatched: found.length, systemTotal: S.systemFonts.length, latin: [...S.latinFonts] };
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
        } else {
          resetPlacement(L, scope, f.key, f.catId, f.group.map((g) => g.key));   // as Reset under the layer's properties
          if (scope === "all" && fillsCanvas(L)) L.t.all.s = 1;   // a photo filling the canvas fills it still
          else if (scope === "all" && L.type === "asset" && L.ref.kind === "sticker") L.t.all.s = 0.3;   // at the size a sticker is put on at (addAsset)
        }
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
      if (k === "asset") L = api.addAsset(ref, at, above);   // as its tile clicked (a sticker at 0.3)
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
  };
  for (const d of TOOLS) if (!commands[d.name]) commands[d.name] = notYet;
  return commands;
}
