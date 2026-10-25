// What each agent tool does (tools.js says what each takes and answers). makeCommands(api) is handed what app.js lets
// the commands reach (API, at the foot of app.js) and returns a function for each tool, (args, ctx) → its answer: a
// result (toResult) or a failure (toError, or a ToolError thrown). `args` have been checked against the tool's schema
// (checkCall) before; `ctx` is {progress(n, total, message), cancelled()}. A command that changes something runs inside
// one step of undo when its tool says so (agentStep in app.js, see agent.js); a read-only one never switches the
// window: it reads another channel's or profile's cover as it is kept (coverOf) and draws it with that profile. One that
// changes the cover goes where it is aimed first (aim: the window switched there, the layer named found and checked,
// before anything is touched), then does what the editor does for the same change: the same fields, the same touch().
// No DOM at the top: Node imports this file (the tests); a canvas is made only when a preview is drawn.
import { TOOLS, toResult, toError, ToolError, findProfile, findChannel, findSize, keyOf, letterKeysOf, boxesOf, sheetPlan, widthFor, idsSaid } from "./tools.js";
import { LOOKS, LOOK_IDS, LOOK_TAGS, lookParams } from "./style.js";
import { EFFECTS, BENDS } from "./textfx.js";
import { BEND_IDS, HEADLINES, LETTERED, isLayout, isRemovable } from "./layers.js";
import { STICKERS, GRAPHICS, userAssets, canTint } from "./assets.js";
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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** A call the cover cannot take as it is (a layer of the wrong kind, a font not there…): what is wrong, for the agent. */
const refused = (message) => new ToolError("invalid_arguments", message);
/** A colour as the layers keep it: "#rrggbb" in small letters. */
const hex = (v) => v.toLowerCase();

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
      const want = new Set(args.only || OPTIONS), out = {};
      if (want.has("looks")) out.looks = LOOK_IDS.map((id) => {
        const L = LOOKS[id];
        return { id, name: L.name.en, zh: L.name.zh, kinds: LOOK_TAGS[id] || [], ...(L.oneTheme ? { oneTheme: true } : {}), ...(L.seeded ? { seeded: true } : {}), ...(L.about ? { about: L.about.en } : {}),
          params: L.params.map((d) => (d.text ? { key: d.key, name: d.name.en, text: true, maxLength: d.max, default: d.def }
            : { key: d.key, name: d.name.en, min: d.min, max: d.max, step: d.step, default: d.def, ...(d.toggle ? { toggle: true } : {}), ...(d.needsPhoto ? { needsPhoto: true } : {}) })),
          scene: Object.keys(L.scene || {}) };
      });
      if (want.has("effects")) out.effects = Object.entries(EFFECTS).map(([id, e]) => ({ id, name: e.name.en, zh: e.name.zh, kind: e.kind, seeded: !!e.seeded, needsOutlines: e.kind === "outline", available: api.CAN.outlines || e.kind !== "outline" }));
      if (want.has("bends")) out.bends = [{ id: "none", name: "None", zh: "无" }, ...BEND_IDS.map((id) => ({ id, name: BENDS[id].name.en, zh: BENDS[id].name.zh }))];
      if (want.has("fonts")) {
        const found = S.systemFonts.filter((f) => has(f, args.fontQuery));
        out.fonts = { bundled: [...api.BUNDLED_FONTS], imported: [...S.importedFonts], system: found.slice(0, 200), systemMatched: found.length, systemTotal: S.systemFonts.length, latin: [...S.latinFonts] };
      }
      if (want.has("platforms")) out.platforms = PLATFORMS.map((p) => ({ id: p.id, name: p.name.en, zh: p.name.zh, wide: [...new Set(p.covers({ orient: "h", red: "3:4" }).map((c) => c.ratio))], tall: [...new Set(p.covers({ orient: "v", red: "3:4" }).map((c) => c.ratio))] }));
      if (want.has("sizes")) out.sizes = SIZE_PRESETS.map((z) => ({ key: keyOf(z), w: z.w, h: z.h, ratio: ratioText(z.w, z.h), caption: sizeCaption(z, "en") }));
      if (want.has("locks")) out.locks = SURPRISE_LOCKS.map((id) => ({ id, keeps: LOCKS[id] || id }));
      return toResult({ structured: out });
    },
    list_library: async (args) => {
      const want = args.kind ? [args.kind] : ["photos", "stickers", "graphics", "mine"], most = args.limit ?? 100, q = args.query, out = {}, more = {};
      const keep = (k, all) => { out[k] = all.slice(0, most); if (all.length > most) more[k] = all.length - most; };
      if (want.includes("photos")) keep("photos", S.library.filter((e) => has(e.name, q) || has(e.kind, q)).map((e) => ({ pid: e.pid, name: e.name, kind: e.kind, at: e.at ? new Date(e.at).toISOString() : null })));
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
      const cap = Math.max(18, Math.min(44, Math.round(side * 0.028))), plan = sheetPlan(p.sizes, side, { cap, gap: Math.round(cap * 0.6) });
      const sheet = newCanvas(plan.width, plan.height), x = sheet.getContext("2d"), sizes = [];
      x.fillStyle = "#14141c"; x.fillRect(0, 0, sheet.width, sheet.height);
      for (const [i, z] of p.sizes.entries()) {
        const t = plan.tiles[i], cv = await api.renderReady(z, c, index, { profile: p, pixelW: t.w }), said = `${sizeCaption(z, "en")} · ${z.w}×${z.h}`;
        x.drawImage(cv, t.x, t.y, t.w, t.h); cv.width = cv.height = 0;
        x.fillStyle = "#e9e9f0"; x.font = `600 ${Math.round(cap * 0.52)}px -apple-system, "Helvetica Neue", Arial, sans-serif`; x.textBaseline = "middle";
        x.fillText(said, t.x, t.y + t.h + cap / 2, t.w);
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
  };
  for (const d of TOOLS) if (!commands[d.name]) commands[d.name] = notYet;
  return commands;
}
