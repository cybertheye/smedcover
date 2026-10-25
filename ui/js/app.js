// SmedCover UI. Two modes: Edit (cover content, assets, style + the layer stack) and Setup (brand,
// sizes, fonts). The cover is a collage of layers painted by render.js; persistence is in store.js.
import { fonts, clamp } from "./cel.js";
import { virtualSize, layoutValues, dragLayout, LAYOUT_LIMITS, wordsFoot, ORIENTS, orientOf, orientOfKey, layoutOf, ownLayout, setLayoutOf, followLayout, layoutByOrient, SIDES, sideOf, sideToward, sideLike, scaleBlock, sizeOfKey, templateDefault, blockDefault, layoutAdded, sameLayout } from "./layout.js";
import { TIMING, layoutHandles, drawCover, sizeKey, hexToRgb, hitAt, hitsIn, handles, showsFrame, sceneHandleAt, coverLayout, partsOf, coverAt } from "./render.js";
import { csvToJobs } from "./csv.js";
import { t, setLang, getLang, detectLang, bothLangs } from "./i18n.js";
import { sampleProfile, starterProfile, SIZE_PRESETS } from "./presets.js";
import { useFont, startScope } from "./store.js";
import { platformsFor } from "./platforms.js";
import { boxOf, overlap } from "./check.js";
import { baseRecipe, RULES, dealCover, oddsOf, moveShare, dropOption, partChance, ODD_OPTIONS, DOTS, EVEN_DOTS, dotsOf, withDots } from "./deal.js";
import { GRAPHICS, STICKERS, STICKER_GROUPS, userAssets, putUserAsset, putSpecAsset, assetIdFor, assetExists, assetName, canTint, drawAsset, assetHalf } from "./assets.js";
import { ACCENT_SHAPES, LETTERED, HEADLINES, newLayer, isFree, isAdded, isLayout, isRemovable, COPYABLE, fillsCanvas, isPickable, appliesTo, inSize, keepTo, sizesFor, cutAt, stepIndex, adjust, resetPlacement, insertAbove, moveLayer, duplicate, copyFreeLayers, clipBase, clipEnd, moveScene, resetScene, sceneOffsets, resolve as placeOf, reorderLayout, orderLayout, layoutOrder, DEFAULT_OFF, normalizeCrop, dragCrop, drawnCrop, fitCrop, cropPoly, dragPoint, addPoint, dropPoint, movePoly, edgePoint, inPoly, hasArea, CROP_PTS, weavable, frontOf, LAYOUT_PARTS, takeLayout, takeParts, putLayout, presetLayout, setPresetLayout, newPreset, plainPlaces, defaultLayers, WEAVE_WAYS, WEAVE_MAX, BRUSH_R, strokePoints, photoPoint, photoLong, brushNext, canWeave, wovenIds, refitSizes, acrossSizes, cutFrom } from "./layers.js";
import {
  carryFonts, HOST, CAN, invoke, files, uid, readJson, writeJson, loadProfiles, saveProfile, deleteProfile, loadAssetRecords, saveAssetRecord,
  deleteAssetRecord, usedUserAssets, normalizeFolders, normalizeProfile, normalizeCover, normalizeSettings, normalizeSize, exportName, sizeCaption, ratioText,
  normalizeRecipes, SURPRISE_LOCKS, normalizeLayouts, LAYOUTS,
} from "./store.js";
import { DEFAULTS, layOver } from "./defaults.js";

import { normalizeSpec, parseSpec, drawSpec } from "./spec.js";
import { EFFECTS, BENDS, effectUses, warpCorners, convexWarp, NO_COLUMNS } from "./textfx.js";
import { onOutlines, outlinesPending, outlinesSettled } from "./outlines.js";
import { RANSOM_FACES, useRansomFaces, ransomPending, ransomArrived, ransomPools, ransomLetters, ransomShown, papersFor, faceFont, faceHas, inksFor, cased, isCJK, EXTRAS, lineCells, keysOf } from "./ransom.js";
import { parseTitle } from "./title.js";
import { LOOKS, LOOK_IDS, LOOK_TAGS, LOOK_CATEGORIES, setLook, lookParams, effectsFor, FX_TYPES, FX_TIMING } from "./style.js";
import { sizeOf, PIXELS, dropCards } from "./photo.js";
import { VIEW, LIMITS, turn, gapFor, fitView, sheetUnder, labelRoom, drawStack } from "./stack3d.js";
import { IMAGE_PROVIDERS, IMAGE_DEFAULTS, MAX_STYLES, loadStyles, styleText, legacyStyles, userStyle, writeStyle, freeId, promptOf, normalizeImageAi, imageReady, imageEndpoint, buildImageRequest, readImageReply, refusedParam, imageCheck, readImageCheck, repaintPrompt, generatePrompt, coverCrop } from "./repaint.js";
import { AI_STYLES, AI_KINDS, AI_PLACEHOLDER, normalizeAi, aiReady, endpoint, buildRequest, readReply, buildPrompt, retryMessage, withImage } from "./ai.js";

const $ = (id) => document.getElementById(id);
const EXT = { png: "png", jpeg: "jpg", webp: "webp" };
const FIXED = ["frame"];                  // layers that cannot be moved: the frame follows the template
const PINNED = ["bg", "frame"];          // shown with a padlock in the layer list: always there, never placed by hand

/** Tiny element builder: el("div", {class:"x", onclick}, child, "text"). */
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k === "dataset") Object.assign(e.dataset, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

// ---------- state
const S = {
  settings: normalizeSettings(null),
  profiles: [], profile: null, cover: null,
  covers: {},                            // the current profile's covers, one per channel: {channelId: cover} (S.cover is the one shown)
  library: [],                           // the bitmap library: [{pid, name, kind, at}], every picture uploaded, made or repainted (photo-library.json)
  photos: new Map(),                     // the photo store: pid -> {src, img, original, mask: {img, src} | null} (see putPhoto)
  imageAi: normalizeImageAi(null),       // the image model that repaints photos (image-ai.json)
  repaintStyles: [],                     // the built-in repaint styles: [{id, file, name}] (ui/repaint-styles/index.json)
  myStyles: [],                          // the user's own repaint styles, Markdown files in the app data folder repaint-styles/ (see userStyle)
  assetFolders: [],                      // the folders "My assets" are filed in: [{id, name}] (asset-folders.json; each asset's `folder`)
  cutModels: [],                         // the BiRefNet models and whether each is downloaded: [{id, bytes, have}] (cut_models)
  picked: [],                                       // a group selection: the ids of the layers in it (see group())
  importedFonts: [], systemFonts: [], latinFonts: new Set(["Bebas Neue", "JetBrains Mono"]),   // latinFonts: those that cannot set Chinese
  mode: "edit", tab: { edit: "content", setup: "brand" },
  sel: "",                               // size key shown on the main canvas
  layerId: "title",                      // selected layer
  hist: [], histIdx: -1,
};
const cat = () => S.profile.categories.find((c) => c.id === S.cover.catId) || S.profile.categories[0];
const catIndex = () => Math.max(0, S.profile.categories.indexOf(cat()));
const selSize = () => S.profile.sizes.find((s) => sizeKey(s) === S.sel) || S.profile.sizes[0];
const caption = (s) => sizeCaption(s, getLang());                   // what a size is called: its name, or the platforms it is for and its ratio
const sizeLabel = (s) => `${caption(s)} · ${s.w}×${s.h}`;           // full form, with pixels
const layer = (id = S.layerId) => S.cover.layers.find((l) => l.id === id) || null;
/** The profile's sizes facing the way the size keyed `key` does (see orientOf in layout.js), that one among them, in the profile's order. */
const sameWay = (key = S.sel) => S.profile.sizes.filter((z) => orientOf(z.w, z.h) === orientOfKey(key));
/**
 * Geometry context of the size on the main canvas, as the layer maths wants it; `group`, the sizes facing its way
 * with their virtual canvases (what the scope's middle choice reaches, see adjust in layers.js).
 */
const frame = () => {
  const s = selSize(), [vw, vh] = virtualSize(s.w, s.h), key = sizeKey(s);
  return { vw, vh, key, catId: cat().id, group: sameWay(key).map((z) => { const [w, h] = virtualSize(z.w, z.h); return { key: sizeKey(z), vw: w, vh: h }; }) };
};
/** The scopes a change of place or layout may have, from the widest: every size, those facing the size's way, the size alone (S.settings.scope). */
const SCOPES = ["all", "orient", "size"];
/** What scope `v` is called on the size keyed `key`: the middle one names the sizes it reaches ("All tall"). */
const scopeName = (v, key = S.sel) => t(v === "orient" ? "scope.orient." + orientOfKey(key) : "scope." + v);
/** The size keys a change in `scope` reaches by size from the size keyed `key` — those facing its way, or it alone — or null for every size. */
const scopeKeys = (scope = S.settings.scope, key = S.sel) => (scope === "orient" ? sameWay(key).map(sizeKey) : scope === "size" ? [key] : null);
/** The profile's size keys, in its order. */
const sizeKeys = () => S.profile.sizes.map(sizeKey);
/**
 * Sizes `keys` said in the words of string `key`: its "Group" form with the orientation's name when they are every size
 * facing one way and more than one ("仅竖版", "Only tall"), else with their ratios ("仅 3:4 · 9:16"); `more`, what the
 * string says after them ({1}…).
 */
function sizesSaid(key, keys, ...more) {
  const o = ORIENTS.find((x) => { const g = S.profile.sizes.filter((z) => orientOf(z.w, z.h) === x).map(sizeKey); return g.length > 1 && g.length === keys.length && g.every((k) => keys.includes(k)); });
  return o ? t(key + "Group", t("orient." + o), ...more) : t(key, S.profile.sizes.filter((z) => keys.includes(sizeKey(z))).map((z) => ratioText(z.w, z.h)).join(" · "), ...more);
}
/** What layer L's sizes (see `sizes` in layers.js) come to, for its row in the layer list: "Only 3:4", "Only tall", "Not 9:16", "At no size"; "" when it shows at every size. */
function sizesNote(L) {
  if (!L.sizes) return "";
  const all = sizeKeys(), on = all.filter((k) => inSize(L, k)), off = all.filter((k) => !on.includes(k));
  return !on.length ? t("sizes.none") : !off.length ? "" : on.length <= off.length ? sizesSaid("sizes.only", on) : sizesSaid("sizes.not", off);
}
function layerName(L) {
  if (isAdded(L) && L.name) return L.name;   // the user's own name for a layer they added
  if (L.copy) return t("layer.copyOf", t("layer." + L.type));
  if (L.type === "asset") return assetExists(L.ref) ? assetName(L.ref, getLang()) : t("assets.missing");
  if (L.type === "text") return L.text.split("\n")[0].replace(/\*/g, "").slice(0, 16) || t("layer.text");
  if (L.type === "photo") return t(L.of || L.cut ? "layer.photoCut" : L.fill ? "layer.photoFill" : "layer.photo");
  if (L.type === "solid") return t("layer.solid");
  return t("layer." + L.type);
}

let toastTimer;
/** A word at the foot of the window for a moment (`sticky`: until the next one); `act` ({label, run}): a button on it that takes it further. */
function toast(msg, sticky = false, act = null) {
  const n = $("toast");
  n.replaceChildren(msg, ...(act ? [el("button", { onclick: () => { n.classList.remove("on"); act.run(); } }, act.label)] : []));
  n.classList.toggle("act", !!act); n.classList.add("on");
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => n.classList.remove("on"), act ? 6000 : 3400);
}
const fail = (e) => toast(t("msg.failed", e && e.message ? e.message : String(e)));

/** Opens the system file picker and resolves with the chosen files (empty when cancelled). */
function pickFiles(accept, multiple = false) {
  return new Promise((resolve) => {
    const f = $("file");
    f.accept = accept; f.multiple = multiple; f.value = "";
    f.onchange = () => resolve([...f.files]);
    f.click();
  });
}
const pickFile = async (accept) => (await pickFiles(accept))[0] || null;
const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r[how](file); });
const loadImage = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });

// ---------- persistence (debounced) and undo history
const timers = {};
const later = (key, ms, fn) => { clearTimeout(timers[key]); timers[key] = setTimeout(fn, ms); };
/** The layer list, kept from one drawing of the Layers sheet to the next (renderSide fills it, the sheet shows it). */
const layerBox = el("div", { id: "layerbox", style: "display:grid;gap:14px" });
const persistProfile = () => later("profile", 400, () => saveProfile(S.profile).catch(fail));
/** Where a cover is kept: one file for each channel of each profile. */
const coverPath = (profileId, catId) => `covers/${profileId}/${catId}.json`;
/** Saves the cover on the canvas, to its own file (the one it is, even if another is shown by the time it is written). */
const persistCover = () => { const c = S.cover, id = S.profile.id; later(`cover:${id}:${c.catId}`, 400, () => writeJson(coverPath(id, c.catId), c).catch(fail)); };
/** Makes `c` the cover on the canvas, and the one kept for its channel. */
const setCover = (c) => { S.cover = c; S.covers[c.catId] = c; return c; };
const persistAi = () => later("ai", 400, () => writeJson("ai.json", S.ai).catch(fail));
const persistImageAi = () => later("imageAi", 400, () => writeJson("image-ai.json", S.imageAi).catch(fail));
const persistSettings = () => later("settings", 400, () => writeJson("settings.json", S.settings).catch(fail));

const snapshot = () => JSON.stringify({ p: S.profile, c: S.cover });
function resetHistory() { S.hist = [snapshot()]; S.histIdx = 0; SURPRISE.step = null; dealClose(); syncTop(); }
/** Adds the present state to the undo history, unless it is already its last entry (`always`: even then). */
function commitHistory(always = false) {
  const snap = snapshot();
  if (!always && snap === S.hist[S.histIdx]) return;
  if (SURPRISE.step && S.histIdx === SURPRISE.step.idx) { SURPRISE.step = null; dealClose(); }   // edited on: the hands are past taking
  S.hist = S.hist.slice(0, S.histIdx + 1);
  S.hist.push(snap);
  if (S.hist.length > 80) S.hist.splice(0, S.hist.length - 80);
  S.histIdx = S.hist.length - 1;
  syncTop();
}
/** Records history a moment after the last change, so a drag or a burst of typing is one step. */
function recordHistory() { later("hist", 500, () => (SURPRISE.busy ? recordHistory() : commitHistory())); }   // not while Surprise me deals hands onto the cover
async function timeTravel(step) {
  clearTimeout(timers.hist);
  commitHistory();   // a change still waiting to be recorded is a step of its own: undo goes back to before it
  SURPRISE.step = null; dealClose();
  const i = S.histIdx + step;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  const { p, c } = JSON.parse(S.hist[i]);
  const profile = normalizeProfile(p);
  S.profiles[S.profiles.findIndex((x) => x.id === S.profile.id)] = profile;
  S.profile = profile;
  setCover(normalizeCover(c, profile));
  await applyProfile();
  // the step as it now is: reading it back may write it a little differently (fields filled in, keys in
  // another order), and the next commit would take that for a change and cut off the steps to redo
  S.hist[i] = snapshot();
  syncTop();
  persistProfile(); persistCover();
}

/**
 * Call after any change. profile/cover: what to save; panel/side: rebuild the open sheet (or Settings' page) /
 * the layer list and the drawer; strip: rebuild the thumbnails under the canvas (sizes changed).
 */
function touch({ profile = false, cover = false, panel = false, side = false, strip = false } = {}) {
  if (!panel && onLookSheet()) later("lookcards", 500, refreshLookCards);   // the looks' cards follow what was changed elsewhere
  if (profile) persistProfile();
  if (cover) persistCover();
  if (strip) buildStrip();
  if (panel) renderPanel();
  if (side) renderSide();
  queueDraw();
  recordHistory();
}

// ---------- fonts and the profile
const quoted = (name) => `"${String(name).replace(/["\\]/g, "")}"`;
/** Loads the bundled faces, so the first cover is fitted with the right letter widths. */
async function applyFonts() {
  await Promise.all([`900 40px ${fonts.cn}`, `700 40px ${fonts.en}`, `600 20px ${fonts.mono}`].map((spec) => document.fonts.load(spec, "封面Aa01").catch(() => null)));
}
async function registerFont(family, dataUrl) {
  try {
    const face = new FontFace(family, `url(${dataUrl})`);
    await face.load();
    document.fonts.add(face);
    if (!S.importedFonts.includes(family)) S.importedFonts.push(family);
    return true;
  } catch (e) { return false; }
}
/**
 * WebKit sets a canvas that is not in the page (the effects' work canvases, an export, the title's
 * measuring) only in the fonts that came with the system: one the user installed, or one macOS
 * downloads on demand (楷体, 行楷…), falls back to the default there while the canvas on screen shows
 * it. So a system font a layer is set in is tried on such a canvas, with characters it has, and one
 * that is not there is read from its files (font_faces, font_data in lib.rs) and added to the page,
 * where every canvas finds it. Per family: a promise of whether it was added.
 */
const SYS_FACES = new Map();
let probe = null;
/** Whether a canvas outside the page sets `text` in `family` (it measures otherwise than the fallbacks alone). */
function reachable(family, text = "封面Aa01") {
  const x = (probe = probe || document.createElement("canvas").getContext("2d"));
  const width = (stack) => { x.font = `900 40px ${stack}`; return x.measureText(text).width; };
  return ["monospace", "serif"].some((g) => width(`${quoted(family)}, ${g}`) !== width(g));
}
function ensureFont(family) {
  if (!CAN.fonts || !S.systemFonts.includes(family) || BUNDLED_FONTS.includes(family) || S.importedFonts.includes(family)) return null;
  if (!SYS_FACES.has(family)) SYS_FACES.set(family, invoke("font_faces", { family }).then(async ({ probe: text, weights }) => {
    if (!text || reachable(family, text)) return false;
    // every upright face at its own weight (a variable one over its range), so each weight of lettering
    // finds the face it did with the system font; the name as it is (WebKit keeps quotes as part of it)
    const faces = [];
    for (let n = 0; n < weights.length; n++) faces.push(await new FontFace(family, await invoke("font_data", { family, n }), { weight: weights[n] }).load());
    for (const f of faces) document.fonts.add(f);
    queueDraw();
    return true;
  }).catch(() => false).then((added) => { if (ransomArrived(family)) queueDraw(); return added; }));   // there, or not to be had: the ransom note waits no more (see ransomFaces)
  return SYS_FACES.get(family);
}
/** Sees that the system fonts the layers are set in are there for every canvas (and the ransom note's faces, when a layer is lettered so); resolves once they are. */
const ensureFonts = (layers) => Promise.all([...new Set([...layers.map((L) => L.font), ...(layers.some((L) => L.fx === "ransom") ? ransomPending() : [])].filter(Boolean))].map(ensureFont).filter(Boolean));
/** How many system fonts of each script the ransom note loads from their files at most (see ransomFaces). */
const RANSOM_AWAY = 4;
/**
 * The faces the ransom note cuts its letters from (ransom.js): the bundled fonts and the system fonts it
 * knows that are installed (in a plain browser, those a canvas can set). Those a canvas outside the page
 * does not reach (see ensureFont) are loaded from their files when a layer is lettered so: only the first
 * few of each script, for a Chinese font is large.
 */
function ransomFaces() {
  const here = new Set(BUNDLED_FONTS), away = [];
  for (const script of ["latin", "cjk"]) {
    let n = 0;
    for (const [family] of RANSOM_FACES[script]) {
      if (here.has(family) || (CAN.fonts ? !S.systemFonts.includes(family) : !reachable(family))) continue;
      if (CAN.fonts && !reachable(family)) { if (n >= RANSOM_AWAY) continue; n++; away.push(family); }
      here.add(family);
    }
  }
  useRansomFaces((f) => here.has(f), away);
}

/** Everything that has to happen when S.profile / S.cover are replaced or restored. */
async function applyProfile() {
  setCover(normalizeCover(S.cover, S.profile));
  if (S.profile.oldFonts) { carryFonts(S.cover.layers, S.profile.oldFonts, S.profile.style.look); delete S.profile.oldFonts; persistProfile(); persistCover(); }   // an older profile's brand-wide fonts, moved onto the layers
  if (!S.profile.sizes.some((s) => sizeKey(s) === S.sel)) S.sel = sizeKey(S.profile.sizes[0]);
  if (!layer()) S.layerId = "title";
  await applyFonts();
  syncTop(); syncTabs(); renderPanel(); renderSide(); buildStrip(); syncToolbar(); queueDraw();
}

// ---------- drawing: the main canvas every frame, the thumbnails a little later
function paint(cv, size, pixelW, cover = S.cover, index = catIndex(), select = null, live = null, extra = {}) {
  drawCover(cv, { profile: S.profile, catIndex: index, size, pixelW, cover, photos: S.photos, select, live, ...extra });
}
// While a layer is dragged on the canvas, the rest of the cover is painted once and reused (see drawCover).
let LIVE = null;
/**
 * While a slider of the left panel is dragged — a look's own setting, the layout's proportions — the
 * cover is painted as a draft, at the screen's own pixels rather than the Retina ones (a quarter of the
 * work), its photos drawn from their copies on the graphics card (see setDraft in photo.js), and the size
 * thumbnails wait. The full picture comes back as the slider is let go (`held`: the pointer is still down),
 * or, stepped from the keyboard, a moment after the last step: not each time the hand rests a moment, which
 * on a heavy look put a whole redraw in the way of the next step. Such a setting can touch every layer, so
 * the rest of the cover cannot simply be kept as a layer's own slider keeps it (see holdLive); but a look's
 * own setting (`key`) is read by only some of them, and those that did not read it are kept while it is
 * dragged (`kept`: o.draft in render.js). `down`: the slider (or the canvas) the main button went down on,
 * till it is let go; `from`: where the last input came from. A draft is held only for input from what was
 * pressed: a press whose release never came (a context menu took it) held the next change made from the
 * keyboard — a look's switch flipped with Space, a setting typed after Tab — for ever, the canvas a draft
 * and the thumbnails waiting; the pointer moved over the page with no button down lets it go.
 */
const DRAFT = { until: 0, held: false, down: null, from: null, key: null, kept: null };
/** A layout preset's editor while it is open (layoutEditor): `redraw` draws its canvas again (when outlines or fonts arrive). */
const LAYED = { redraw: null };
const drafting = () => DRAFT.held || performance.now() < DRAFT.until;
function draftTouch(opts, key = null) { DRAFT.until = performance.now() + 250; DRAFT.held = !!DRAFT.down && DRAFT.from === DRAFT.down; DRAFT.key = key; later("undraft", 270, () => DRAFT.held || queueDraw()); touch(opts); }
/** The pointer let go (or the window left, a context menu opened, a slider's `change`, which comes as its knob is let go): a draft held till then is painted in full. */
function letGo() { DRAFT.down = null; if (DRAFT.held) { DRAFT.held = false; DRAFT.until = 0; queueDraw(); } }
addEventListener("pointerdown", (e) => { DRAFT.down = e.button === 0 && !e.ctrlKey && (e.target.type === "range" || e.target.id === "cv") ? e.target : null; }, true);   // a slider's knob, or a scene object on the canvas; not a right click (a Control-click on a Mac)
for (const type of ["input", "change", "click", "keydown"]) addEventListener(type, (e) => { DRAFT.from = e.target; }, true);
addEventListener("pointermove", (e) => { DRAFT.from = e.target; if (DRAFT.down && !(e.buttons & 1)) letGo(); }, true);   // moved with no button down: the release was missed
addEventListener("pointerup", letGo, true); addEventListener("pointercancel", letGo, true); addEventListener("contextmenu", letGo, true); addEventListener("blur", letGo);
addEventListener("change", (e) => { if (e.target.type === "range") letGo(); }, true);
const goLive = (ids) => {
  ids = [...new Set([].concat(ids).map((id) => (layer(id) ? owner(layer(id)).id : id)))];   // a linked cut-out moves with its photo
  for (const L of S.cover.layers) if (L.of && ids.includes(L.of)) ids.push(L.id);   // a photo's copies move with it
  const key = ids.join(" ");
  if (!LIVE || LIVE.key !== key) LIVE = { ids, key };
};
const endLive = () => { if (LIVE) { LIVE = null; queueDraw(); } };
/**
 * The layer panel's 3D view (see the section "the layers in 3D"): the cover taken apart, its layers
 * stacked as sheets. Only for looking, and not saved.
 */
const V3 = {
  on: false,                              // shown, opening or closing
  k: 0, from: 0, to: 0, t0: 0,            // how far apart (0: flat, the cover as on the canvas; 1: apart), eased from `from` to `to` since t0
  yaw: VIEW.yaw, pitch: VIEW.pitch, spread: VIEW.spread, aim: null,   // the view; aim: the view it is easing back to (Reset view)
  s: 0,                                   // the scale shown: eased towards the one that fits, and held while the view is dragged
  z: new Map(),                           // layer id -> its place in the stack as shown, easing towards where it is now
  sheets: new Map(),                      // layer id -> {cv, mask, key}: the layer painted on its own
  stale: true,                            // the layers have changed since they were painted
  hover: "", peek: "",                    // the sheet under the pointer; the layer whose row in the list it is on
  drag: false, raf: 0, view: null, shown: [],   // the view and the sheets last drawn, to find what is under the pointer
};
function drawMain() {
  if (V3.on) return paint3d();   // the canvas waits under the 3D view
  paintFlat();
}
/**
 * The cover's canvas, brought up to date first if the 3D view has kept it waiting: what is known of the
 * cover as painted — where each layer is, the template's geometry — is read from it.
 */
const flatCanvas = () => { if (V3.on) paintFlat(); return $("cv"); };
function paintFlat() {
  const stage = $("stage"), cv = $("cv"), size = selSize(), [vw, vh] = virtualSize(size.w, size.h);
  const k = Math.max(0.05, Math.min((stage.clientWidth - 36) / vw, (stage.clientHeight - 36) / vh));
  cv.style.width = Math.round(vw * k) + "px"; cv.style.height = Math.round(vh * k) + "px";
  const draft = drafting(), keyed = draft && DRAFT.key;
  if (!keyed) DRAFT.kept = null; else if (!DRAFT.kept || DRAFT.kept.key !== keyed) DRAFT.kept = { key: keyed };   // a look's setting dragged (see o.draft)
  if (!draft && !LIVE) dropCards();   // painted still: the drag or the draft is over, and the photos' copies on the graphics card can go
  const shown = previewed();   // a look, a text effect or a layout preset previewed from its card, on this canvas only (see PREVIEW)
  paint(cv, size, Math.min(vw * 1.5, vw * k * (draft ? 1 : window.devicePixelRatio || 1)), shown.cover, catIndex(), S.mode === "edit" ? S.layerId : null, S.mode === "edit" ? LIVE : null,
    { draft: DRAFT.kept || draft, ...(S.mode === "edit" ? { picked: group().map((L) => L.id), sceneHandles: !S.settings.hideScene, spot: S.focus ? spotIds() : null, brush: S.brushWin } : {}),
      ...(shown.profile !== S.profile ? { profile: shown.profile } : {}) });
  const clear = !layer("bg").visible;
  stage.classList.toggle("alpha", clear); $("strip").classList.toggle("alpha", clear);
}
/**
 * Redraws the size thumbnails under the canvas, one a frame, so the window keeps answering between them
 * (on a heavy cover each is a whole cover): what a canvas is told to draw, the web view draws after, on
 * the graphics card, and thumbnails drawn one per turn of the event loop all went ahead at once — the
 * slider let go a moment before, taken again, waited behind them all. Never while something is dragged:
 * a drag that paused long enough for them would be held up by them, and they by it, frame after frame.
 * A new round, or a drag, stops one that is under way.
 */
let thumbsRound = 0;
function drawThumbs() {
  if (LIVE || drafting()) return later("thumbs", 300, drawThumbs);   // after the drag
  const round = ++thumbsRound, sizes = [...S.profile.sizes];
  const next = () => {
    if (round !== thumbsRound || LIVE || drafting() || !sizes.length) return;
    const size = sizes.shift(), cv = $("th-" + sizeKey(size));
    if (cv) { paint(cv, size, virtualSize(size.w, size.h)[0] * 0.2); cv.dataset.painted = "1"; }
    requestAnimationFrame(next);
  };
  next();
}
let drawQueued = false;
function flushDraw() {
  if (!drawQueued) return;
  drawQueued = false; ensureFonts(S.cover.layers); drawMain(); placeBar(); markStrip(); thumbsRound++; later("thumbs", LIVE ? 400 : 140, drawThumbs); later("ambient", 350, paintAmbient);
  placeFrames();   // the layout's parts framed, where the Layout sheet is open
  if (S.letterWin) later("letters", 200, lettersShow);   // the ransom note's letters as now drawn (words typed, colours changed)
  if (S.weaveWin) later("weave", 200, weaveShow);   // the woven letters as now typed
  if (LAYED.redraw) later("layed", 80, LAYED.redraw);   // a layout preset's editor, with what arrived since (outlines, fonts)
  if (onLayoutSheet()) later("presetpics", 500, refreshPresetPics);   // the preset cards' pictures follow the cover, the size and the profile (outlines arrived too), a moment after the last change
}
/**
 * Redraws at most once per frame, however many input events arrive. `stale` false: only what is selected
 * changed. Animation frames pause while the window is hidden, so then a timer draws instead; not while it
 * shows, where a frame that is late is late because the last is still being drawn (the graphics card is
 * behind), and a draw on a timer only piled more on: the page, the knob of the slider being dragged with
 * it, was shown less often still. Only should no frame come at all for a second (a web view that stopped
 * giving them without saying it is hidden) does a timer draw, as nothing would be drawn again otherwise.
 */
let framesRun = 0;
const drawInFrame = (now) => { framesRun++; glassWatch(now); flushDraw(); };
function queueDraw(stale = true) {
  if (stale) V3.stale = true;
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(drawInFrame);
  if (document.hidden) setTimeout(flushDraw, 150);
  else { const ran = framesRun; setTimeout(() => framesRun === ran && flushDraw(), 1000); }
}
document.addEventListener("visibilitychange", () => { if (document.hidden) flushDraw(); });   // hidden with a draw waiting
new ResizeObserver(() => S.profile && queueDraw()).observe($("stage"));

$("strip").addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $("strip").scrollLeft += e.deltaY; } }, { passive: false });
/**
 * The tray's thumbnails anew (a size added or gone, a name changed). A size's picture already there is kept till
 * drawThumbs draws it again, and a new one is shaped as its size from the first: an empty canvas is 300 × 150, and
 * a strip of those, wider than the pictures, overflowed till they were drawn, its scrollbar making the tray taller
 * and the canvas over it smaller for a moment.
 */
function buildStrip() {
  $("strip").replaceChildren(...S.profile.sizes.map((size) => {
    const key = sizeKey(size), [w, h] = virtualSize(size.w, size.h);
    const cv = $("th-" + key) || el("canvas", { id: "th-" + key, width: Math.round(w * 0.2), height: Math.round(h * 0.2) });
    return el("figure", { class: key === S.sel ? "on" : "", onclick: () => selectSize(key) }, cv,
      el("figcaption", { title: sizeLabel(size) }, ratioText(size.w, size.h), el("span", { class: "own", title: t("style.ownMark") }, "◆")));   // the ratio alone (what it is called and its pixels show on hover and over the canvas), marked when the size has a layout of its own
  }));
  markStrip();
}
/** Marks the sizes in the strip that are drawn in a layout of their own (see layoutOf in layout.js). */
function markStrip() {
  [...$("strip").children].forEach((f, i) => { const z = S.profile.sizes[i]; f.classList.toggle("own", !!z && ownLayout(S.profile.style, sizeKey(z))); });
}
function selectSize(key) {
  S.sel = key;
  [...$("strip").children].forEach((f, i) => f.classList.toggle("on", sizeKey(S.profile.sizes[i]) === key));
  syncToolbar(); renderSide(); queueDraw();
  if (onStyleTab()) renderPanel();   // the template box is the size's: its layout, its own or the profile's, and the sizes facing its way
}
/** Whether the open sheet shows the look or the layout, which a change of size or of a layout drawn anew bears on. */
const onStyleTab = () => S.mode === "edit" && !sheetHidden() && (S.tab.edit === "look" || S.tab.edit === "layout");
/** Sets the scope a change of place or layout has (see SCOPES); the tray under the canvas and the properties say it. */
function setScope(v) {
  S.settings.scope = v; persistSettings(); syncToolbar(); renderSide();
  if (onStyleTab()) renderPanel();
}
/** The scope's three choices, as one segmented control: the tray's, under the canvas. */
const scopeSeg = () => el("div", { class: "seg" }, SCOPES.map((v) => el("button", { class: "btn" + (S.settings.scope === v ? " on" : ""), title: v === "orient" ? t("scope.orientTip", sameWay().map((z) => ratioText(z.w, z.h)).join(" · ")) : null, onclick: () => setScope(v) }, scopeName(v))));
/** Whether Save as layout shows under the canvas: hidden for now, presets made in the Layout sheet (＋ New…); saveLayoutDialog and addLayout stay. */
const SAVE_AS_LAYOUT = false;
/**
 * The tray under the canvas: the size shown (#toolbar) and the scope (#scope). Over the tray, in a line of its own and
 * quietly (a link, not a button: it is seldom wanted), Save as layout — the canvas's layout as a preset Surprise me may
 * deal — while SAVE_AS_LAYOUT lets it show.
 */
function syncToolbar() {
  const size = selSize(), edit = S.mode === "edit";   // what it is called over its pixels, in two lines: names after the platforms can be long
  $("toolbar").replaceChildren(el("span", { class: "name", title: sizeLabel(size) }, el("b", {}, caption(size)), el("small", {}, `${size.w}×${size.h}`)));
  $("scope").replaceChildren(...(edit ? [el("span", {}, t("props.scope")), scopeSeg()] : []));
  $("toolsub").replaceChildren(...(edit && SAVE_AS_LAYOUT ? [el("button", { class: "quiet", title: t("layouts.saveTip"), onclick: saveLayoutDialog }, t("layouts.save"))] : []));
}

// ---------- editing layers
function selectLayer(id) {
  const back = FTB.away; FTB.away = "";   // a layer chosen, the background too: its bar shows again (see selectNothing)
  if (S.layerId === id && !group().length) { if (back) placeBar(); return; }
  S.picked = []; S.layerId = id; renderSide(); queueDraw(false);
}
/**
 * Selects nothing: the background, as pickedIds counts it, with the bar over the canvas and its popover put away until
 * a layer is chosen again (selectLayer), so nothing stands over the cover; the arrows nudge nothing meanwhile. A press
 * on the stage beside the cover, or Esc.
 */
function selectNothing() { selectLayer("bg"); FTB.away = "bg"; FTB.pop = ""; renderBar(); }
/**
 * The layers of the group selection on this channel's cover, or [] when there is none. A group holds
 * while the selected layer is one of its members: selecting anything else by any route ends it.
 */
function group() {
  if (S.picked.length < 2 || !S.picked.includes(S.layerId)) return [];
  const list = S.picked.map((id) => layer(id)).filter((L) => L && appliesTo(L, cat().id));
  return list.length > 1 ? list : [];
}
/** What is selected now, as a list of ids: the group, or the one selected layer (the background counts as nothing). */
const pickedIds = () => (group().length ? group().map((L) => L.id) : S.layerId && S.layerId !== "bg" ? [S.layerId] : []);
/** Selects these layers together; one is an ordinary selection, none selects the background. The last is the topmost. */
function pickLayers(ids) {
  if (ids.length < 2) return selectLayer(ids[0] || "bg");
  S.picked = ids; S.layerId = ids[ids.length - 1];
  renderSide(); queueDraw(false);
}
/** Adds a layer to the selection, or takes it out (shift-click). */
function togglePick(id) {
  const L = layer(id);
  if (!L || L.type === "bg" || FIXED.includes(L.type)) return;
  const now = pickedIds();
  pickLayers(now.includes(id) ? now.filter((x) => x !== id) : [...now, id]);
}
/** The members of a group that can be moved. */
const movers = (list) => list.filter((L) => !L.locked && !FIXED.includes(L.type));
/** Applies the same placement edit to several layers, then redraws once. */
function editAll(list, patch) { for (const L of new Set(list.map(owner))) adjust(L, frame(), S.settings.scope, patch); touch({ cover: true }); }
function removeGroup() {
  const gone = group().filter(isAdded);
  if (!gone.length) return;
  S.cover.layers = S.cover.layers.filter((L) => !gone.includes(L) && !(L.of && gone.some((g) => g.id === L.of)));   // a photo's linked cut-out goes with it
  S.picked = []; S.layerId = "bg";
  touch({ cover: true, side: true, panel: onCoverTab() });   // the photos listed in the Assets sheet follow
}
/** While a slider of one layer is dragged, only that layer is repainted (as in a drag on the canvas); the whole cover once it stops. */
function holdLive(id) { goLive(id); later("live", 300, endLive); }
/**
 * Applies a placement edit to a layer in the current scope, then redraws. A linked cut-out's moves are
 * its photo's (the two move together); its size, angle and stretch are its own, changed about its subject.
 * A photo cut out, or a photo or an asset cropped, is scaled and turned about what shows of it.
 */
function edit(L, patch) {
  const A = owner(L);
  if (A === L) { adjust(L, frame(), S.settings.scope, patch); if (L.crop || (L.type === "photo" && L.cut)) aboutSubject(L, patch); }
  else {
    const { ddx, ddy, ...own } = patch;
    if (ddx || ddy) adjust(A, frame(), S.settings.scope, { ddx, ddy });
    if (Object.keys(own).length) { adjust(L, frame(), S.settings.scope, own); aboutSubject(L, own); }
  }
  touch({ cover: true });
}
/**
 * Keeps a cut-out's subject (a cropped layer's part kept) where it is while it is scaled, stretched or turned:
 * the centre of its frame (the hit's px, py) is moved round the subject's (the hit's centre) by the same amount.
 */
function aboutSubject(L, { scale, rot, kx, ky }) {
  const h = $("cv")._hits && $("cv")._hits.find((x) => x.id === L.id);
  if (!h || h.px == null || (!scale && !rot && !kx && !ky)) return;
  let vx = h.px - h.cx, vy = h.py - h.cy;
  if (scale) { vx *= scale; vy *= scale; }
  if (kx || ky) {   // along the layer's own axes, turned as it is
    const a = ((h.r || 0) * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a), lx = (vx * c + vy * n) * (kx || 1), ly = (-vx * n + vy * c) * (ky || 1);
    vx = lx * c - ly * n; vy = lx * n + ly * c;
  }
  if (rot) { const a = (rot * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a); [vx, vy] = [vx * c - vy * n, vx * n + vy * c]; }
  adjust(L, frame(), S.settings.scope, { ddx: h.cx + vx - h.px, ddy: h.cy + vy - h.py });
  h.px = h.cx + vx; h.py = h.cy + vy;   // until the cover is drawn again
}
function addLayer(L) {
  insertAbove(S.cover.layers, S.layerId === "bg" ? "bg" : S.layerId, L);
  S.layerId = L.id;
  touch({ cover: true, side: true });
  return L;
}
function addAsset(ref, at) {
  const L = newLayer("asset", { ref, tint: canTint(ref) });   // a vector asset follows the channel colour from the start, as its tile shows
  if (at) { L.t.all.x = at.x; L.t.all.y = at.y; }
  if (ref.kind === "sticker") L.t.all.s = 0.3;
  addLayer(L);
  toast(t("assets.added", assetName(ref, getLang())));
}
function removeLayer(id = S.layerId) {
  const L = layer(id);
  if (!L || !isRemovable(L)) return;
  if (L.type === "photo") S.cover.layers = S.cover.layers.filter((l) => l.of !== L.id);   // a photo's linked cut-out goes with it (not the other way round)
  const i = S.cover.layers.indexOf(L);
  S.cover.layers.splice(i, 1);
  S.layerId = S.cover.layers[Math.max(1, i - 1)].id;
  touch({ cover: true, side: true, panel: onCoverTab() });
}
/** Whether a layer can be copied: one the user added, or a layout layer but the ground and the corner brackets (a linked cut-out is not: cut out the photo again). */
const copiable = (L) => !!L && (isFree(L.type) || COPYABLE.includes(L.type)) && !(L.type === "photo" && L.of);
function duplicateLayer() {
  const L = layer(), c = copiable(L) && duplicate(L);
  if (!c) return;
  insertAbove(S.cover.layers, S.cover.layers[clipEnd(S.cover.layers, S.cover.layers.indexOf(L))].id, c); S.layerId = c.id;   // over what is clipped onto it, which stays its
  touch({ cover: true, side: true, panel: onCoverTab() });
}
function shiftLayer(dir) {
  const to = stepIndex(S.cover.layers, S.layerId, dir, cat().id);
  if (to > 0 && moveLayer(S.cover.layers, S.layerId, to)) touch({ cover: true, side: true, panel: onCoverTab() });
}
// pointer on the main canvas: click selects the topmost layer under it, drag moves, wheel resizes
function virtualPoint(e) {
  const cv = $("cv"), b = cv.getBoundingClientRect(), k = cv._virtual[0] / b.width;
  return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k, k };
}
function layerAt(e) {
  const cv = $("cv");
  if (!cv._hits) return null;
  const p = virtualPoint(e), ok = (h) => { const L = layer(h.id); return h.type !== "bg" && L && isPickable(L); };
  // the selected layer keeps the grab even when something sits on top of it
  // the topmost layer wins, except that the selected layer keeps the grab under anything at least as big
  // (so a sticker placed over the title stays reachable, and so does a small layer sitting on a big selected one)
  const top = hitAt(cv._hits, p.x, p.y, ok), sel = cv._hits.find((h) => h.id === S.layerId && ok(h));
  const mine = sel && hitAt([sel], p.x, p.y), area = (h) => h.hw * h.hh;
  const hit = mine && (!top || top.id === mine.id || area(top) >= area(mine)) ? mine : top;
  // with the layout's parts framed (see placeFrames), a press inside a frame takes that part — the smallest, where frames
  // lie one in another — unless what is hit is smaller still (a sticker on the title): so a part lying under another,
  // or under a picture, is reached by its frame
  // its frame is its box, as drawn: for the colour block, the slanted edge aside; and a press on the selected layer stays its own
  const part = partsFramed() && cv._hits.filter((h) => framable(h) && hitAt([{ ...h, poly: null }], p.x, p.y, ok, 0)).sort((a, b) => area(a) - area(b))[0];
  const pick = part && !(mine && hit === mine) && (!hit || area(hit) > area(part)) ? part : hit;
  return pick ? layer(pick.id) : layer("bg");
}
/** The pointer over a selected layer's handles (see handles in render.js): on the canvas, and in a layout preset's editor. */
const CURSOR = { rot: "crosshair", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
{
  const cv = $("cv");
  /** The pointer in the selected layer's own rotated frame, plus the handle under it (if any). */
  function grip(e) {
    const L = layer(), hit = cv._hits && cv._hits.find((h) => h.id === S.layerId);
    if (group().length || !L || !hit || !showsFrame(hit) || L.locked || L.type === "bg" || FIXED.includes(L.type)) return null;
    const p = virtualPoint(e), a = (-hit.r * Math.PI) / 180, dx = p.x - hit.cx, dy = p.y - hit.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const near = handles(hit, p.k).map((h) => ({ id: h.id, d: Math.hypot(lx - h.lx, ly - h.ly) })).filter((h) => h.d <= 11 * p.k).sort((a, b) => a.d - b.d)[0];
    return { L, hit, p, lx, ly, handle: near ? near.id : null, d: near ? near.d : Infinity };
  }
  /**
   * The diamond under the pointer (a handle of the layout, or of the selected lettering's bend), or null;
   * where one lies by a square of the selection's frame, the nearer of the two is the one taken. A layer not shown at
   * the size on the canvas has none (none is drawn for it: see coverAt in render.js).
   */
  function diamond(e) {
    if (group().length || !layer() || !inSize(layer(), S.sel)) return null;
    const p = virtualPoint(e), g = grip(e);
    const lh = layoutHandles(cv, layer()).map((q) => ({ ...q, d: Math.hypot(p.x - q.x, p.y - q.y) })).filter((q) => q.d <= 13 * p.k).sort((a, b) => a.d - b.d)[0];
    return lh && !(g && g.handle && g.d < lh.d) ? lh : null;
  }
  /** The handle of a look's scene object under the pointer, with the ground selected (see sceneHandleAt), or null. */
  function sceneGrip(e) {
    const L = layer();
    if (group().length || !L || L.type !== "bg" || !cv._virtual || S.settings.hideScene) return null;
    const p = virtualPoint(e);
    return sceneHandleAt(cv, p.x, p.y, p.k);
  }
  cv.addEventListener("pointermove", (e) => {
    if (S.brushWin && S.mode === "edit") { brushRing(e); cv.style.cursor = "crosshair"; cv.title = ""; return; }   // painting with the weave's brush: its ring, nothing else
    if (e.buttons || S.mode !== "edit") return;
    const sh = sceneGrip(e);
    cv.title = sh ? `${sceneName(sh.key)} · ${t("scene.dragTip")}` : "";
    if (sh) { cv.style.cursor = "move"; return; }
    if (diamond(e)) { cv.style.cursor = "pointer"; return; }
    const g = grip(e);
    if (g && g.handle) { cv.style.cursor = CURSOR[g.handle]; return; }
    if (S.focus) { cv.style.cursor = focusTargets().length ? "move" : "not-allowed"; return; }
    const L = layerAt(e);
    cv.style.cursor = !L || L.type === "bg" ? "default" : fillsCanvas(L) ? "move" : "grab";
  });
  cv.addEventListener("pointerleave", () => { const ring = $("brushring"); if (ring && !BRUSH.stroke) ring.hidden = true; });
  cv.addEventListener("dblclick", (e) => {   // a scene object's handle: back where the layout puts it; anything else: its properties, in the drawer
    const sh = S.mode === "edit" && !S.brushWin && sceneGrip(e);
    if (!sh) { if (S.mode === "edit" && !S.brushWin && !group().length && !S.settings.drawer) setDrawer(true); return; }
    resetScene(S.cover, S.profile.style.look, sh.key, S.settings.scope, frame().key, scopeKeys());
    touch({ cover: true, side: true });
  });
  cv.addEventListener("pointerdown", (e) => {
    if (S.mode !== "edit") return;
    if (S.brushWin) return brushDown(e);   // the weave's brush: the canvas only paints
    const done = (moved) => () => { cv.onpointermove = null; endLive(); if (moved()) renderSide(); };
    // a handle of the layout itself (the diamonds): dragging it changes the template for every cover of this profile
    const at0 = virtualPoint(e), lh = diamond(e);
    if (lh && lh.id[0] === "w") {   // a corner of the perspective: the lettering's block is reshaped
      const L = layer(), b = cv._blocks[L.id], i = Number(lh.id.slice(1)), inv = b.m.inverse(), k = cv._blocks.k;
      const corner = [[0, 0], [1, 0], [1, 1], [0, 1]][i], grab = inv.transformPoint({ x: at0.x * k, y: at0.y * k });
      const start = warpCorners(L.warp, L.bendAmt ?? 1).map((p) => [...p]);
      const off = [grab.x - (b.box.x + (corner[0] + start[i][0]) * b.box.w), grab.y - (b.box.y + (corner[1] + start[i][1]) * b.box.h)];   // keep where in the handle it was grabbed
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m), q = inv.transformPoint({ x: p.x * k, y: p.y * k });
        const w = start.map((c) => [...c]);
        w[i] = [clamp((q.x - off[0] - b.box.x) / b.box.w - corner[0], -1.5, 1.5), clamp((q.y - off[1] - b.box.y) / b.box.h - corner[1], -1.5, 1.5)];
        if (!convexWarp(w) && convexWarp(start)) return;   // the corner stops where the block would fold over (one folded before is free to be unfolded)
        L.warp = w; touch({ cover: true });
      };
      goLive(L.id);   // the other layers kept as they are while it is dragged
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; endLive(); renderSide(); };
      return;
    }
    if (lh && lh.id[0] === "e") {   // a handle of any other bend: the edge under it follows the pointer, the rest of the lettering smoothly with it
      const L = layer(), b = cv._blocks[L.id], i = Number(lh.id.slice(1)), inv = b.m.inverse(), k = cv._blocks.k;
      const start = L.reshape ? L.reshape.map((p) => [...p]) : Array.from({ length: 8 }, () => [0, 0]), grab = inv.transformPoint({ x: at0.x * k, y: at0.y * k });
      const off = [grab.x - (b.rest[i][0] + start[i][0] * b.box.w), grab.y - (b.rest[i][1] + start[i][1] * b.box.h)];   // keep where in the handle it was grabbed
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m), q = inv.transformPoint({ x: p.x * k, y: p.y * k }), d = start.map((c) => [...c]);
        d[i] = [clamp((q.x - off[0] - b.rest[i][0]) / b.box.w, -1.5, 1.5), clamp((q.y - off[1] - b.rest[i][1]) / b.box.h, -1.5, 1.5)];
        L.reshape = d; touch({ cover: true });
      };
      goLive(L.id);
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; endLive(); if (L.reshape && L.reshape.every((p) => !p[0] && !p[1])) { delete L.reshape; touch({ cover: true }); } renderSide(); };
      return;
    }
    if (lh) {
      // the layout this size is drawn in, changed where the scope under the canvas says: the profile's (every size without a
      // layout of its own follows it), each size facing this one's way, or this size alone; on a size with a layout of
      // its own, "every size" changes that one, the one drawn under the pointer (the Layout sheet says it is the size's own)
      const st = S.profile.style, key = frame().key, keys = scopeKeys() || (ownLayout(st, key) ? [key] : null);
      let moved = false;
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m), [vw, vh] = cv._virtual, lay = layoutOf(st, key);
        setLayoutOf(st, keys, { template: lay.template, adjust: dragLayout(cv._layout, vw, vh, lay.adjust, lh.id, p.x, p.y, cv._titleBox) });
        moved = true; touch({ profile: true });
      };
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; if (moved) { if (onStyleTab()) renderPanel(); renderSide(); } };   // the colour block's sliders (blockSection) too
      return;
    }
    const sh = sceneGrip(e);
    if (sh) {   // a scene object of the look, with the ground selected: moved on this cover, for all sizes, those facing this one's way, or this one
      const look = S.profile.style.look, f = frame(), [vw, vh] = cv._virtual, keys = scopeKeys();
      let last = at0, moved = false;
      cv.setPointerCapture(e.pointerId);
      // While dragged, only the ground and the frame (where the cyberpunk's sweep is) are repainted, the
      // layers between kept as images (see o.live in render.js) — what a look paints over it all (a light
      // leak, a lens flare) is painted every frame anyway — and in draft (see draftTouch): the ground is
      // most of a look's work, and it is the one thing that changes here
      goLive(["bg", "frame"]);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m);
        moveScene(S.cover, look, sh.key, S.settings.scope, f.key, (p.x - last.x) / vw, (p.y - last.y) / vh, keys || [f.key]);
        last = p; moved = true; draftTouch({ cover: true });
      };
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; endLive(); if (moved) renderSide(); };
      return;
    }
    const g = grip(e);
    if (g && g.handle) {   // a handle of the selected layer: corners resize, sides stretch, the knob rotates
      const { L, hit, handle } = g, min = 6 * g.p.k;
      let moved = false, prev = { ang: Math.atan2(g.p.y - hit.cy, g.p.x - hit.cx), dist: Math.max(min, Math.hypot(g.lx, g.ly)), lx: Math.max(min, Math.abs(g.lx)), ly: Math.max(min, Math.abs(g.ly)) };
      cv.setPointerCapture(e.pointerId);
      goLive(L.id);
      cv.onpointermove = (m) => {
        const q = grip(m);
        if (!q) return;
        const now = { ang: Math.atan2(q.p.y - hit.cy, q.p.x - hit.cx), dist: Math.max(min, Math.hypot(q.lx, q.ly)), lx: Math.max(min, Math.abs(q.lx)), ly: Math.max(min, Math.abs(q.ly)) };
        moved = true;
        if (handle === "rot") { let d = ((now.ang - prev.ang) * 180) / Math.PI; d = ((d + 540) % 360) - 180; edit(L, { rot: m.shiftKey ? Math.round(d) : d }); }
        else if (handle.length === 2) edit(L, { scale: now.dist / prev.dist });
        else if (handle === "e" || handle === "w") edit(L, { kx: now.lx / prev.lx });
        else edit(L, { ky: now.ly / prev.ly });
        prev = now;
      };
      cv.onpointerup = cv.onpointercancel = done(() => moved);
      return;
    }
    if (S.focus) return focusDrag(e);
    let L = layerAt(e);
    if (!L) return;
    const many = group(), sel = layer();
    if (e.shiftKey && L.type !== "bg") return togglePick(L.id);   // shift-click: into the selection, or out of it
    // a selected photo that fills the canvas is dragged from anywhere on the ground, even where the colour block lies over it
    if (!e.shiftKey && !many.length && sel && fillsCanvas(sel) && !sel.locked && (L === sel || L.type === "bg" || L.type === "accent" || L.locked)) L = sel;
    // On the ground — the background, the colour block, anything locked — a drag draws a rectangle
    // round what to select, and a click selects what was clicked. Ground moves only once it is the
    // selected layer (the photo, or the colour block); something locked never does.
    const ground = L.type === "bg" || L.type === "accent" || L.locked || fillsCanvas(L);
    if (ground && (L !== sel || many.length || e.shiftKey || L.locked || L.type === "bg")) return marquee(e, L);
    if (many.some((x) => x.id === L.id)) return dragGroup(e, many, L);
    selectLayer(L.id);
    if (L.locked || L.type === "bg") return;
    let last = virtualPoint(e), moved = false;
    cv.setPointerCapture(e.pointerId);
    goLive(L.id);
    cv.onpointermove = (m) => { const p = virtualPoint(m); moved = true; edit(L, { ddx: p.x - last.x, ddy: p.y - last.y }); last = p; };
    cv.onpointerup = cv.onpointercancel = done(() => moved);
  });
  // The selection rectangle is a box laid over the canvas, not drawn on it: the cover is not
  // repainted while it is dragged (with a look's effects a repaint can take tens of milliseconds).
  const band = document.body.appendChild(el("div", { id: "marquee", hidden: true }));
  /** Draws a selection rectangle; what lies wholly inside it is selected when the button is let go. Shift adds to the selection. */
  function marquee(e, under) {
    const start = virtualPoint(e), keep = e.shiftKey ? pickedIds() : [], cx = e.clientX, cy = e.clientY, r = cv.getBoundingClientRect();
    const ok = (h) => { const L = layer(h.id); return h.type !== "bg" && L && isPickable(L) && !FIXED.includes(L.type); };
    let box = null;
    cv.setPointerCapture(e.pointerId);
    cv.onpointermove = (m) => {
      const p = virtualPoint(m);
      if (!box && Math.hypot(p.x - start.x, p.y - start.y) < 5 * p.k) return;   // a click is not a rectangle
      box = { x0: start.x, y0: start.y, x1: p.x, y1: p.y };
      const mx = clamp(m.clientX, r.left, r.right), my = clamp(m.clientY, r.top, r.bottom);
      Object.assign(band.style, { left: Math.min(cx, mx) + "px", top: Math.min(cy, my) + "px", width: Math.abs(mx - cx) + "px", height: Math.abs(my - cy) + "px" });
      band.hidden = false;
    };
    cv.onpointerup = cv.onpointercancel = () => {
      cv.onpointermove = null; band.hidden = true;
      if (!box) return e.shiftKey ? null : selectLayer(under.id);
      pickLayers([...new Set([...keep, ...hitsIn(cv._hits, box, ok).map((h) => h.id)])]);
    };
  }
  /** FOCUS: a drag anywhere on the canvas moves the selected layer (or group) and nothing else; a click selects nothing. */
  function focusDrag(e) {
    const list = focusTargets();
    if (!list.length) return;
    let last = virtualPoint(e), moved = false;
    cv.setPointerCapture(e.pointerId);
    goLive(list.map((x) => x.id));
    cv.onpointermove = (m) => {
      const p = virtualPoint(m), d = { ddx: p.x - last.x, ddy: p.y - last.y };
      moved = true; last = p;
      if (group().length) editAll(list, d); else edit(list[0], d);
    };
    cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; endLive(); if (moved) renderSide(); };
  }
  /** Drags every movable member of the group together; a click without a drag selects just the one clicked. */
  function dragGroup(e, many, L) {
    const list = movers(many);
    let last = virtualPoint(e), moved = false;
    cv.setPointerCapture(e.pointerId);
    if (list.length) goLive(list.map((x) => x.id));
    cv.onpointermove = (m) => { if (!list.length) return; const p = virtualPoint(m); moved = true; editAll(list, { ddx: p.x - last.x, ddy: p.y - last.y }); last = p; };
    cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; endLive(); if (moved) renderSide(); else selectLayer(L.id); };
  }
  cv.addEventListener("wheel", (e) => {
    if (S.mode !== "edit") return;
    e.preventDefault();
    if (S.brushWin) return;   // the canvas only paints
    if (S.focus && group().length) return;   // a group is moved, not scaled
    const L = S.focus ? focusTargets()[0] : layerAt(e);
    if (!L || L.locked || FIXED.includes(L.type) || L.type === "bg") return;
    selectLayer(L.id);
    goLive(L.id); later("live", 300, endLive);
    edit(L, e.altKey ? { rot: e.deltaY > 0 ? 2 : -2 } : { scale: Math.exp(-e.deltaY * 0.0015) });
    later("side", 250, renderSide);
  }, { passive: false });
  $("stage").addEventListener("pointerdown", (e) => { if (e.target === $("stage") && S.mode === "edit" && S.cover && !S.focus && !S.brushWin) selectNothing(); });
  // assets dragged from the library land where they are dropped
  cv.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("application/x-smed-asset") || e.dataTransfer.types.includes("application/x-smed-photo")) e.preventDefault(); });
  cv.addEventListener("drop", (e) => {
    const pid = e.dataTransfer.getData("application/x-smed-photo");
    if (pid) {   // a picture from the bitmap library: a photo layer, where it is dropped
      e.preventDefault(); e.stopPropagation();
      const p = virtualPoint(e), [vw, vh] = cv._virtual;
      return placePhoto(pid, { x: clamp(p.x / vw, 0, 1), y: clamp(p.y / vh, 0, 1) });
    }
    const raw = e.dataTransfer.getData("application/x-smed-asset");
    if (!raw) return;
    e.preventDefault(); e.stopPropagation();
    const p = virtualPoint(e), [vw, vh] = cv._virtual;
    addAsset(JSON.parse(raw), { x: clamp(p.x / vw, 0, 1), y: clamp(p.y / vh, 0, 1) });
  });
}

// ---------- small form helpers
const cap = (key, extra = "") => el("label", { class: "cap" }, t(key) + extra);
function textInput(value, oninput, props = {}) { return el("input", { type: "text", value, spellcheck: false, oninput: (e) => oninput(e.target.value), ...props }); }
/** A slider with a ready-made label (looks name their own parameters). */
function slider2(label, min, max, step, value, oninput) {
  const out = el("output", {}, value.toFixed(2));
  return el("div", { class: "sl", style: "grid-template-columns:84px 1fr 44px" }, el("span", {}, label),
    el("input", { type: "range", min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = v.toFixed(2); oninput(v); } }), out);
}
function slider(labelKey, min, max, step, value, fmt, oninput) {
  const out = el("output", {}, fmt(value));
  return el("div", { class: "sl" }, el("span", {}, t(labelKey)),
    el("input", { type: "range", min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = fmt(v); oninput(v); } }), out);
}
function check(labelKey, checked, onchange) {
  return el("label", { class: "chk" }, el("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }), t(labelKey));
}
function select(options, value, onchange) {   // options: [[value, label]] or {group, items}
  const opt = ([v, l]) => el("option", { value: v, selected: v === value }, l);
  return el("select", { onchange: (e) => onchange(e.target.value) }, options.map((o) => (Array.isArray(o) ? opt(o) : o.items.length ? el("optgroup", { label: o.group }, o.items.map(opt)) : null)));
}
const px = (v) => String(Math.round(v)), times = (v) => v.toFixed(2) + "×", pct = (v) => Math.round(v * 100) + "%";

// ---------- the sheets (S.mode "edit")
/** A sheet's heading: what it is for, in a word, and a line under it. */
const sheetHead = (title, sub) => el("div", { class: "sheet-h" }, el("b", {}, title), sub && el("div", { class: "hint", style: "margin:0" }, sub));
/** A field's caption with its longer explanation behind an ⓘ beside it. */
const capInfo = (key, tip) => el("div", { class: "capi" }, cap(key), info(tip));
/** Content: the channel, and the cover's words — its title, subtitle and tag; copying another channel's at its foot. */
function contentSheet() {
  const c = S.cover;
  return [
    sheetHead(t("sheet.content"), t("sheet.contentSub")),
    el("div", {}, capInfo("cover.category", t("cover.channelHint")), el("div", { class: "chips" }, S.profile.categories.map((k) =>
      el("button", { class: k.id === c.catId ? "on" : "", style: `--c:${k.color}`, onclick: () => switchChannel(k.id) }, k.name || k.code || "—")))),
    el("div", {}, cap("cover.title"),
      el("textarea", { value: c.title, spellcheck: false, oninput: (e) => { c.title = e.target.value; touch({ cover: true }); if (S.layerId === "title") later("side", 700, renderSide); } }),
      el("div", { class: "hint" }, t("cover.titleHint"))),
    el("div", {}, capInfo("cover.subtitle", t("cover.subtitleHint")), textInput(c.subtitle, (v) => { c.subtitle = v; touch({ cover: true }); if (S.layerId === "subtitle") later("side", 700, renderSide); }, { placeholder: t("cover.subtitlePh") })),
    el("div", {}, cap("cover.tag"), textInput(c.tag, (v) => { c.tag = v; touch({ cover: true }); }, { placeholder: t("cover.tagPh") })),
    el("div", { class: "sheet-foot" }, el("button", { class: "linkbtn", onclick: copyDialog }, t("copy.open"))),
  ];
}
/**
 * Layout → which parts show: one switch for each of the template's layers but the ground, top first as in the layer
 * list. One switched off is left out of this cover (`off`, see layers.js): hidden, gone from the layer list; on again,
 * it is back as it was. The order they are stacked in is the layer list's (Layers), where a row dragged makes the new
 * order the profile's default too.
 */
function partsBox() {
  const list = S.cover.layers.filter((l) => isLayout(l) && l.type !== "bg").reverse();   // top first, as in the layer list
  const flip = (L) => {
    if (L.off) { delete L.off; L.visible = true; } else { L.off = true; L.visible = false; if (S.layerId === L.id) S.layerId = "bg"; }
    touch({ cover: true, side: true, panel: true });
  };
  const chip = (L) => el("button", { class: "part" + (L.off ? " off" : ""), "aria-pressed": String(!L.off), title: `${layerName(L)} · ${t("cover.part." + L.type)}`, onclick: () => flip(L) },
    el("span", { class: "eye", innerHTML: L.off ? EYE_OFF : EYE_ON }), el("span", {}, layerName(L)));
  return el("div", {}, capInfo("cover.parts", t("cover.partsTip")), el("div", { class: "parts" }, list.map(chip)), el("div", { class: "hint" }, t("cover.partsHint")));
}
const EYE_ON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/></svg>';
/**
 * Assets → the photos on this cover: each a thumbnail (a click selects its layer, the × on it deletes it) with its AI
 * repaint and another picture; nothing when it has none. Everything else about a photo is in its layer's properties.
 */
function coverPhotos() {
  const here = S.cover.layers.filter((l) => l.type === "photo" && appliesTo(l, cat().id));
  const list = here.filter((l) => !l.of).flatMap((l) => [l, ...here.filter((x) => x.of === l.id)]);   // each photo, then its cut-out
  return list.length ? el("div", {}, capInfo("cover.photosHere", t("cover.photoHint")), list.map(photoItem)) : null;
}
/**
 * One photo of the cover: its thumbnail (a click selects its layer, the x that shows on it deletes
 * it), its AI repaint and another picture. A linked cut-out shows its photo's picture without its
 * background, and has neither: it follows its photo.
 */
function photoItem(L) {
  const rec = recordOf(L), im = rec && rec.img, passive = !!L.of, tied = passive || passivesOf(L).length > 0;
  const mine = REP.of === L.id, label = mine && REP.busy ? "rep.running" : mine && REP.result ? "rep.ready" : "rep.title";
  const locked = passive ? t("link.passiveLocked", layerName(owner(L))) : null;
  return el("div", { class: "pitem" + (passive ? " passive" : "") + (L.id === S.layerId ? " on" : ""), dataset: { id: L.id }, style: tied ? `--link:${linkColour(L)}` : null },
    el("div", { class: "thumb", title: t("cover.photoSelect"), onclick: () => focusAllows(L.id) && selectLayer(L.id) },
      im ? el("img", { src: L.cut && rec.mask ? cutThumb(rec) : thumbOf(rec), alt: "" }) : el("div", { class: "hint err", style: "margin:0" }, t("props.photoMissing")),
      el("button", { class: "del", title: t(passivesOf(L).length ? "cover.removeLinked" : "cover.removePhoto"), onclick: (e) => { e.stopPropagation(); removeLayer(L.id); renderPanel(); } }, "×"),
      el("span", {}, tied && el("span", { class: "chain", innerHTML: ICONS.chain }), layerName(L), im && ` · ${sizeOf(im)[0]} × ${sizeOf(im)[1]}`, rec && rec.original && ` · ${t("rep.isRepainted")}`,
        passive && ` · ${t("link.follows", layerName(owner(L)))}`)),
    el("div", { class: "row", style: "margin-top:6px" },
      el("button", { class: "btn" + (mine && (REP.busy || REP.result) ? " on" : ""), disabled: passive || !im || (REP.busy && !mine), title: locked, onclick: () => repaintOpen(L) }, t(label)),   // a result waits for its photo until the next repaint
      el("button", { class: "btn", disabled: passive || (REP.busy && mine), title: locked, onclick: () => replacePhoto(L) }, t("cover.replacePhoto"))));
}
/** Asks for photos and keeps them in the bitmap library only (the photo shelf in the Assets sheet). */
async function stockPhotos() {
  let n = 0;
  for (const f of await pickFiles("image/*", true)) {
    const pid = await putPhoto(await readAs(f, "readAsDataURL"));
    if (!pid) { toast(t("msg.badFile")); continue; }
    keepPicture(pid, f.name.replace(/\.[^.]+$/, ""), "upload"); n++;
  }
  if (n) toast(t("lib.stocked", n));
}
/** Asks for photos and adds each as a layer (see addPhoto). */
async function uploadPhotos() {
  for (const f of await pickFiles("image/*", true)) await addPhoto(await readAs(f, "readAsDataURL"), null, f.name.replace(/\.[^.]+$/, ""));
}

// ---------- the photo store: pictures for photo layers, kept apart from the layers so a cover stays small
/**
 * Adds a picture to the store and returns its id (null if it cannot be read). A record is
 * {src, img, original, mask}: the picture (data URL, decoded), the one it was repainted from, and
 * its subject mask ({img, src}, alpha). In the session each is a file in photos/.
 */
async function putPhoto(src, { original = "", mask = "", pid = "", save = true } = {}) {
  const img = src ? await loadImage(src) : null;
  if (!img) return null;
  const id = pid || "p" + uid(), rec = { src, img, original, mask: null };
  const m = mask ? await loadImage(mask) : null;
  if (m) rec.mask = { img: m, src: mask };
  S.photos.set(id, rec);
  if (save) savePhoto(id);
  return id;
}
/** Writes a picture's files; resolves when they are written (an upgrade waits for that before removing the old ones). */
function savePhoto(pid) {
  const r = S.photos.get(pid);
  if (!r) return Promise.resolve();
  return Promise.all([
    files.write(`photos/${pid}`, r.src), files.write(`photos/${pid}.original`, r.original || ""), files.write(`photos/${pid}.mask`, r.mask ? r.mask.src : ""),
  ]).catch(fail);
}
const pidsOf = (cover) => new Set(cover.layers.filter((l) => l.type === "photo" && l.pid).map((l) => l.pid));
const READING = new Map();   // pid -> the reading of its files under way, so two callers share one
/**
 * Reads one picture's three files at once and puts it in the store; resolves true if it could be read, false if
 * it is not there, null if a file could not be read (on a server, for a moment): it may be there all the same.
 */
function readPhoto(pid) {
  if (S.photos.has(pid)) return Promise.resolve(true);
  if (!READING.has(pid)) {
    const read = (ext) => files.read(`photos/${pid}${ext}`);
    READING.set(pid, Promise.all([read(""), read(".original"), read(".mask")]).then(
      async ([src, original, mask]) => S.photos.has(pid) || !!(await putPhoto(src || "", { original: original || "", mask: mask || "", pid, save: false })),
      () => null).finally(() => READING.delete(pid)));
  }
  return READING.get(pid);
}
/**
 * Reads these pictures from their files, those not read yet, three at a time (a picture's files are a
 * few megabytes of text each: read one after another, sixteen of them kept the library blank for
 * seconds). `each(pid)` is called as each one comes in. Returns the ids that could not be read.
 */
async function loadPhotos(pids, each = null) {
  const missing = [], todo = [...new Set(pids)].filter((pid) => !S.photos.has(pid));
  let next = 0;
  const worker = async () => { while (next < todo.length) { const pid = todo[next++], got = await readPhoto(pid); if (got) { if (each) each(pid); } else if (got === false) missing.push(pid); } };
  await Promise.all(Array.from({ length: Math.min(3, todo.length) }, worker));
  return missing;
}
/** A small copy of a picture for a tile, made once and kept with it: a grid of full-size photos is slow to draw. */
function thumbOf(rec) {
  if (!rec.thumb) {
    const w = rec.img.naturalWidth, h = rec.img.naturalHeight, k = Math.min(1, 320 / Math.max(w, h)), c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(rec.img, 0, 0, c.width, c.height);
    rec.thumb = c.toDataURL("image/png");   // png: a picture may be transparent
  }
  return rec.thumb;
}
/**
 * Removes the picture files that no cover of any profile shows and the bitmap library does not keep — none at all
 * when a cover could not be read: it may show some.
 */
async function prunePhotos() {
  let sure = true;
  const unsure = (v) => () => { sure = false; return v; };
  const keep = new Set(S.library.map((e) => e.pid));
  for (const c of Object.values(S.covers)) for (const pid of pidsOf(c)) keep.add(pid);
  for (const p of S.profiles) for (const f of await files.list("covers/" + p.id).catch(unsure([]))) {
    const c = await readJson(`covers/${p.id}/${f}`).catch(unsure(null));
    for (const l of (c && Array.isArray(c.layers) && c.layers) || []) if (l && typeof l.pid === "string") keep.add(l.pid);
  }
  if (!sure) return;
  const kept = (pid) => keep.has(pid) || S.photos.has(pid) || S.library.some((e) => e.pid === pid);   // and a picture that came while the covers were read
  for (const f of await files.list("photos").catch(() => [])) if (!kept(f.replace(/\.(original|mask)$/, ""))) files.remove(`photos/${f}`).catch(() => null);
}

// ---------- covers: one for each channel of each profile
// Each channel of each profile has a cover of its own — title, tag and layers — in covers/<profile>/<channel>.json.
// A profile's covers are read when it becomes current (S.covers); a channel without one starts from the
// profile's design. What a profile shares among its channels is the profile's: style, sizes, brand.
const defaultTitle = () => (getLang() === "zh" ? "在这里写标题\n*一行*就是一行" : "Write your title\n*one line* each");
/** The tag a new cover comes with, so the layout shows every part from the start. */
const DEFAULT_TAG = "EP.01";
/** The subtitle a new cover comes with, likewise (in the language of the interface). */
const defaultSubtitle = () => (getLang() === "zh" ? "在这里写副标题" : "Write your subtitle here");
/** Whether a title is still one of the placeholders a new cover comes with (in either language). */
const placeholderTitle = (title) => ["在这里写标题\n*一行*就是一行", "Write your title\n*one line* each"].includes(title);
/**
 * Channel catId's cover from what was stored (null: a new one, from the profile's design, with the
 * placeholder title and subtitle and the default tag), keeping only the layers that are on that channel
 * (before channels had covers of their own, a layer could be kept to some).
 */
function channelCover(raw, profile, catId) {
  const c = normalizeCover({ ...(raw || {}), catId }, profile);
  c.layers = c.layers.filter((l) => appliesTo(l, catId));
  for (const l of c.layers) delete l.cats;
  if (!raw) { c.title = defaultTitle(); c.subtitle = defaultSubtitle(); c.tag = DEFAULT_TAG; }
  return settleLinks(c);
}
/**
 * This profile's cover of channel catId: the one read or made already, or a new one. One read already has the sizes its
 * layers show at kept to the profile's now (refitSizes), as reading it again would: a size added or removed while
 * another channel was shown refits it here (see sizesTab), not before, so that change undone leaves it as it was.
 */
const coverFor = (catId) => {
  const c = S.covers[catId];
  if (c) { refitSizes(c.layers, sizeKeys()); return c; }
  return (S.covers[catId] = channelCover(null, S.profile, catId));
};
/** Reads the covers a profile's channels have. */
async function loadCovers(profile) {
  const out = {};
  for (const c of profile.categories) { const raw = await readJson(coverPath(profile.id, c.id)).catch(absent(null)); if (raw) out[c.id] = channelCover(raw, profile, c.id); }
  if (profile.layerOrder !== 2) {   // the layout layers' default order changed: the design and covers still in the old one take the new, once
    reorderLayout(profile.design.layers);
    for (const [id, c] of Object.entries(out)) if (reorderLayout(c.layers)) await writeJson(coverPath(profile.id, id), c).catch(fail);
    profile.layerOrder = 2;
    await saveProfile(profile).catch(fail);
  }
  if (!profile.tagged) {   // new covers come with a tag: those made before and not yet touched (the placeholder title, no tag) take it too, once
    for (const [id, c] of Object.entries(out)) if (!c.tag && placeholderTitle(c.title)) { c.tag = DEFAULT_TAG; await writeJson(coverPath(profile.id, id), c).catch(fail); }
    profile.tagged = true;
    await saveProfile(profile).catch(fail);
  }
  if (!profile.lean) {   // a new design leaves out the channel name and graphic (DEFAULT_OFF): the design, and the covers not yet touched (the placeholder title), leave them out too, once
    const leave = (layers) => layers.filter((l) => DEFAULT_OFF.includes(l.type) && !l.off).map((l) => { l.off = true; l.visible = false; return l; }).length > 0;
    leave(profile.design.layers);
    for (const [id, c] of Object.entries(out)) if (placeholderTitle(c.title) && leave(c.layers)) await writeJson(coverPath(profile.id, id), c).catch(fail);
    profile.lean = true;
    await saveProfile(profile).catch(fail);
  }
  if (!profile.subbed) {   // new covers come with a subtitle: those not yet touched (the placeholder title, no subtitle) take it too, once
    for (const [id, c] of Object.entries(out)) if (!c.subtitle && placeholderTitle(c.title)) { c.subtitle = c.title.startsWith("Write") ? "Write your subtitle here" : "在这里写副标题"; await writeJson(coverPath(profile.id, id), c).catch(fail); }
    profile.subbed = true;
    await saveProfile(profile).catch(fail);
  }
  return out;
}
/** The channel a profile shows: the one it was last on, else its first. */
const channelOf = (profile) => { const want = S.settings.channels[profile.id]; return profile.categories.some((c) => c.id === want) ? want : profile.categories[0].id; };
/** Shows channel catId's own cover; the one left is kept as it was. */
async function switchChannel(catId) {
  if (!S.profile.categories.some((c) => c.id === catId) || S.cover.catId === catId) return;
  clearTimeout(timers.hist); commitHistory();
  setCover(coverFor(catId));
  S.settings.channels[S.profile.id] = catId; persistSettings();
  await loadPhotos(pidsOf(S.cover));
  S.layerId = "title"; S.picked = []; REP.for = "";
  document.documentElement.style.setProperty("--acc", cat().color);
  persistCover(); resetHistory();
  touch({ panel: true, side: true, strip: true });
}
/** Channel catId's cover of profile p as it is now: the one in memory for the current profile, else as stored (or new). */
async function coverOf(p, catId) {
  if (p.id === S.profile.id && S.covers[catId]) return S.covers[catId];
  return channelCover(await readJson(coverPath(p.id, catId)).catch(() => null), p, catId);
}
// Cover → Copy from another profile or channel: the layers added to it (free ones, copies of layout ones), settings and all, into this cover
const COPY = { profile: "", cat: "", src: null, job: 0 };
function copyDialog() {
  if (!S.profiles.some((p) => p.id === COPY.profile)) COPY.profile = S.profile.id;
  const p = S.profiles.find((x) => x.id === COPY.profile), cats = p.categories.filter((c) => !(p.id === S.profile.id && c.id === S.cover.catId));
  if (!cats.some((c) => c.id === COPY.cat)) { COPY.cat = cats.length ? cats[0].id : ""; COPY.src = null; }
  const pick = (k, v) => { COPY[k] = v; COPY.src = null; copyDialog(); };
  if (!COPY.src && COPY.cat) {   // read the chosen cover, then show what it has
    const job = ++COPY.job;
    coverOf(p, COPY.cat).then(async (c) => { await loadPhotos(pidsOf(c)); if (job === COPY.job && !$("modal").hidden) { COPY.src = c; copyDialog(); } });
  }
  const free = COPY.src ? COPY.src.layers.filter(isAdded) : [];
  const kinds = [["photo", "layers.kind.photo"], ["text", "layers.kind.text"], ["asset", "layers.kind.svg"], ["solid", "layers.kind.solid"], ["copy", "layers.kind.copies"]]
    .map(([type, key]) => [t(key), free.filter((l) => (type === "copy" ? l.copy : l.type === type)).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" · ");
  const m = $("modal");
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("copy.title")),
    el("div", { class: "hint", style: "margin:0 0 12px;font-size:13px;opacity:.8" }, t("copy.hint")),
    cap("copy.profile"), select(S.profiles.map((x) => [x.id, x.name || "—"]), COPY.profile, (v) => pick("profile", v)),
    el("div", { style: "margin-top:12px" }, cap("copy.channel"),
      cats.length ? el("div", { class: "chips" }, cats.map((k) => el("button", { class: k.id === COPY.cat ? "on" : "", style: `--c:${k.color}`, onclick: () => pick("cat", k.id) }, k.name || k.code || "—")))
        : el("div", { class: "hint", style: "margin:0" }, t("copy.noChannel"))),
    COPY.cat && copyPreview(p),
    el("div", { class: "hint", style: "margin:0" }, !COPY.cat ? "" : !COPY.src ? t("copy.reading") : free.length ? counted("copy.count", free.length, kinds) : t("copy.none")),
    el("button", { class: "btn solid wide", disabled: !free.length, onclick: () => copyInto(p, COPY.src) }, t("copy.go")),
    el("button", { class: "btn wide", onclick: closeModal }, t("exp.cancel"))));
  m.hidden = false;
}
/** The cover chosen to copy from, whole, in its own profile's look, at the size on the canvas. */
function copyPreview(p) {
  const size = selSize(), [vw, vh] = virtualSize(size.w, size.h), src = COPY.src;
  const box = el("div", { class: "cpv", style: `aspect-ratio:${vw} / ${vh}` }, !src && el("span", {}, t("copy.reading")));
  if (src) {
    const cv = box.appendChild(el("canvas", {})), index = Math.max(0, p.categories.findIndex((c) => c.id === src.catId));
    const draw = () => drawCover(cv, { profile: p, catIndex: index, size, pixelW: Math.min(vw, 480 * (window.devicePixelRatio || 1)), cover: src, photos: S.photos });
    draw();
    if (outlinesPending()) outlinesSettled().then(() => { if (COPY.src === src && cv.isConnected) draw(); });   // lettering effects that wait for outlines
  }
  return el("div", {}, box, el("div", { class: "hint", style: "margin:4px 0 0" }, sizeLabel(size)));
}
/**
 * Copies the free layers of cover src (of profile p) into the cover on the canvas, as one undo step. From another
 * profile, what they keep by size goes to the sizes of this one that take the place of p's (see acrossSizes in
 * layers.js): a size key is exact pixels, and its 16:9 may be 1280x720 here and 1920x1080 there.
 */
async function copyInto(p, src) {
  await loadPhotos(pidsOf(src));
  clearTimeout(timers.hist); commitHistory();
  const { layers, copies } = copyFreeLayers(S.cover.layers, src.layers);
  if (!copies.length) return;
  if (p.id !== S.profile.id) acrossSizes(copies, p.sizes.map(sizeKey), sizeKeys());
  setCover(channelCover({ ...S.cover, layers }, S.profile, S.cover.catId));   // checked as a cover read is
  const top = copies.at(-1).id;
  S.layerId = layer(top) ? top : "title"; S.picked = [];
  closeModal();
  const k = p.categories.find((c) => c.id === src.catId);
  toast(counted("copy.done", copies.length, (p.id === S.profile.id ? "" : (p.name || "—") + " · ") + (k ? k.name || k.code : "—")));
  touch({ cover: true, panel: true, side: true });
}
/** The cover's background photo: the lowest photo layer that fills the canvas, on this channel, at the size on the canvas (see `sizes` in layers.js). */
const mainPhoto = () => S.cover.layers.find((l) => fillsCanvas(l) && appliesTo(l, cat().id) && inSize(l, S.sel)) || null;
/** The picture a photo layer shows: its own, or for a copy its original's. */
const recordOf = (L) => { const base = L && (L.of ? layer(L.of) : L); return (base && S.photos.get(base.pid)) || null; };

// ---------- linked photos
// Cutting out a photo's subject makes a passive layer linked to it (`of`): the subject, in the photo's
// place, moved and scaled with it (an edit of either changes the photo's placement); its blur, dim,
// outline and shadow its own. Every other photo is active; an active photo has at most one passive.
// Deleting the passive leaves the photo; deleting the photo takes the passive with it. A passive whose
// background is put back, or whose link is ended, becomes a photo of its own, where it is.
/** The layer whose placement a layer uses: a linked cut-out's photo, else the layer itself. */
const owner = (L) => (L && L.type === "photo" && L.of && layer(L.of)) || L;
/** The linked cut-outs of photo layer L. */
const passivesOf = (L) => (L && L.type === "photo" && !L.of ? S.cover.layers.filter((l) => l.type === "photo" && l.of === L.id) : []);
const LINK_COLOURS = ["#ff5fa2", "#3a86ff", "#06d6a0", "#ffd60a", "#ff8a00", "#a855f7"];
/** The colour that marks a link, the same on both of its layers. */
function linkColour(L) {
  const linked = S.cover.layers.filter((l) => l.type === "photo" && !l.of && passivesOf(l).length);
  return LINK_COLOURS[Math.max(0, linked.indexOf(owner(L))) % LINK_COLOURS.length];
}
/**
 * A cut-out's placement that puts it exactly over photo A: no offset of its own, A's size (and for a
 * print A's angle and stretch), size by size.
 */
function alignedT(A) {
  const one = (e, all) => ({ ...(A.fill ? { s: e.s, r: 0, kx: 1, ky: 1 } : e), ...(all ? { x: 0, y: 0 } : { dx: 0, dy: 0 }) });
  return { all: one(A.t.all, true), by: Object.fromEntries(Object.entries(A.t.by).map(([k, e]) => [k, one(e, false)])) };
}
/** Ends a link: cut-out P becomes a photo of its own where it is now (the same picture and channels). */
function unlink(P) {
  const A = layer(P.of);
  if (A) {
    const cv = flatCanvas(), h = cv._hits && cv._hits.find((x) => x.id === P.id), [vw, vh] = cv._virtual || [1920, 1080];
    if (JSON.stringify(P.t) === JSON.stringify(alignedT(A)) || !h || h.px == null) { P.t = JSON.parse(JSON.stringify(A.t)); P.fill = A.fill; }   // still over its photo: placed as the photo is
    else {   // moved off it, or resized: a print where it is, at the size it is
      const a = P.t.all;
      P.t = { all: { x: h.px / vw, y: h.py / vh, s: Math.max(h.pw, h.ph) / ((1000 * Math.min(vw, vh)) / 1080), r: h.r, kx: a.kx, ky: a.ky }, by: {} };
      P.fill = false;
    }
    P.pid = A.pid;
    if (A.cats) P.cats = [...A.cats]; else delete P.cats;
  }
  P.of = ""; delete P.own;
}
/** Asks before ending the link of photo L (either end of it). */
function askUnlink(L) {
  const pass = L.of ? [L] : passivesOf(L), A = owner(L);
  if (!pass.length) return;
  const m = $("modal");
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("link.askTitle")),
    el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("link.askBody", pass.map(layerName).join(" · "), layerName(A))),
    el("button", { class: "btn solid wide", onclick: () => { for (const P of pass) unlink(P); closeModal(); touch({ cover: true, side: true, panel: onCoverTab() }); toast(t("link.done")); } }, t("link.unlink")),
    el("button", { class: "btn wide", onclick: closeModal }, t("link.keep"))));
  m.hidden = false;
}
/**
 * Drops linked cut-outs whose photo is gone, or is itself a cut-out (a link is one step), and gives the
 * cut-outs of earlier files — which took their photo's size as well as its place — a placement of their own, aligned.
 */
function settleLinks(cover) {
  const actives = new Map(cover.layers.filter((l) => l.type === "photo" && !l.of).map((l) => [l.id, l]));
  cover.layers = cover.layers.filter((l) => !(l.type === "photo" && l.of && !actives.has(l.of)));
  for (const l of cover.layers) if (l.type === "photo" && l.of && !l.own) { l.t = alignedT(actives.get(l.of)); l.own = true; }
  return cover;
}
/** A picture with its background removed, small, for the photo list. Kept per mask. */
const CUT_THUMBS = new WeakMap();
function cutThumb(rec) {
  if (!CUT_THUMBS.has(rec.mask)) {
    const [w, h] = sizeOf(rec.img), k = Math.min(1, 480 / Math.max(w, h)), c = el("canvas", { width: Math.round(w * k), height: Math.round(h * k) }), x = c.getContext("2d");
    x.drawImage(rec.img, 0, 0, c.width, c.height); x.globalCompositeOperation = "destination-in"; x.drawImage(rec.mask.img, 0, 0, c.width, c.height);
    CUT_THUMBS.set(rec.mask, c.toDataURL("image/png"));
  }
  return CUT_THUMBS.get(rec.mask);
}
/**
 * Puts another picture into photo layer L, keeping everything else about it (placement, effects,
 * name). A linked cut-out shows the new picture too — it is the same layer, with its own settings —
 * and is cut out of it again. Not for a cut-out itself: it shows its photo's picture.
 */
async function replacePhoto(L) {
  if (!L || L.type !== "photo" || L.of) return;
  const f = await pickFile("image/*");
  if (!f) return;
  const pid = await putPhoto(await readAs(f, "readAsDataURL"));
  if (!pid) return toast(t("msg.badFile"));
  keepPicture(pid, f.name.replace(/\.[^.]+$/, ""), "upload");
  L.pid = pid;
  if (REP.of === L.id && !REP.busy) Object.assign(REP, { of: "", made: [], result: null, error: "" });
  touch({ cover: true, side: true, panel: true });
  toast(t("cover.replaced"));
  if ((L.cut || passivesOf(L).some((p) => p.cut)) && canCut()) await ensureMask(pid);
}

/**
 * Adds a picture (a data URL) as a photo layer and selects it. The first photo of a cover fills the
 * canvas, as its background, just above the ground; the ones after it sit on the cover like prints,
 * above the selected layer — at `at` ({x, y}, fractions of the canvas) when given. Returns the layer.
 */
async function addPhoto(src, at = null, name = "") {
  const pid = await putPhoto(src);
  if (!pid) { toast(t("msg.badFile")); return null; }
  keepPicture(pid, name, "upload");
  return placePhoto(pid, at);
}
/** Puts a picture of the photo store on the cover as a photo layer, by addPhoto's rules (from the bitmap library, too). */
async function placePhoto(pid, at = null) {
  if (!S.photos.has(pid)) await loadPhotos([pid]);
  if (!S.photos.has(pid)) { toast(t("msg.badFile")); return null; }
  if (!mainPhoto()) {
    const L = insertAbove(S.cover.layers, "bg", newLayer("photo", { pid, fill: true }));
    S.layerId = L.id; S.picked = [];
    touch({ cover: true, panel: true, side: true });
    toast(t("cover.photoFilled"));
    return L;
  }
  const L = newLayer("photo", { pid });
  if (at) { L.t.all.x = at.x; L.t.all.y = at.y; }
  addLayer(L); renderPanel();
  toast(t("cover.photoAdded"));
  return L;
}
/**
 * Turns a cover of an earlier version into this one: the background photo kept beside the cover
 * (`legacy` {src, original, mask}) becomes a photo layer filling the canvas, taking the background
 * layer's place, blur and dim; a subject layer becomes that photo's cut-out copy.
 */
async function upgradeCover(cover, legacy) {
  const bg = cover.layers.find((l) => l.id === "bg");
  let main = cover.layers.find((l) => fillsCanvas(l));
  if (!main && legacy && legacy.src) {
    const pid = await putPhoto(legacy.src, { original: legacy.original || "", mask: legacy.mask || "" });
    if (pid) {
      main = newLayer("photo", { pid, fill: true, blur: bg.blur || 0, dim: bg.dim || 0 });
      main.t = { all: { ...bg.t.all, x: 0.5 + bg.t.all.x, y: 0.5 + bg.t.all.y }, by: JSON.parse(JSON.stringify(bg.t.by)) };
      cover.layers.splice(cover.layers.indexOf(bg) + 1, 0, main);
    }
  }
  if (bg) { bg.blur = 0; bg.dim = 0; bg.t = { all: { x: 0, y: 0, s: 1, r: 0, kx: 1, ky: 1 }, by: {} }; }
  cover.layers = cover.layers.flatMap((l) => {
    if (l.type !== "subject") return [l];
    if (!main) return [];
    const c = newLayer("photo", { of: main.id, cut: true, outline: l.outline || 0, shadow: l.shadow || 0, blur: l.follow ? main.blur : 0, dim: l.follow ? main.dim : 0 });
    if (l.ink) c.ink = l.ink;
    c.visible = l.visible; c.o = l.o;
    return [c];
  });
  // a cut-out made before links, still where its photo is, is linked to it
  for (const l of cover.layers) {
    if (l.type !== "photo" || !l.cut || l.of || !l.pid) continue;
    const b = cover.layers.find((x) => x !== l && x.type === "photo" && !x.of && !x.cut && x.pid === l.pid && x.fill === l.fill && JSON.stringify(x.t) === JSON.stringify(l.t) && !cover.layers.some((y) => y.of === x.id));
    if (b) l.of = b.id;
  }
  return settleLinks(cover);
}

function tile(ref, onRemove) {
  const cv = el("canvas", { width: 132, height: 132 });
  const x = cv.getContext("2d");
  x.translate(66, 66); x.scale(0.19, 0.19);
  useLook();   // as on this profile's covers (another profile's preview may have drawn last)
  drawAsset(x, ref, hexToRgb(cat().color), { tint: ref.kind === "graphic" || canTint(ref) });
  return el("div", { class: "tile", title: assetName(ref, getLang()), draggable: true, onclick: () => addAsset(ref),
    ondragstart: (e) => { DRAGGED_ASSET = ref; e.dataTransfer.setData("application/x-smed-asset", JSON.stringify(ref)); e.dataTransfer.effectAllowed = "copyMove"; },
    ondragend: () => { DRAGGED_ASSET = null; } },
    cv, onRemove && el("button", { class: "x", title: t("assets.remove"), onclick: (e) => { e.stopPropagation(); onRemove(); } }, "×"));
}
/**
 * The colour block's edges as the Layout sheet's tiles draw them, in a 40×28 box: the block below its edge, filled with
 * the tile's colour (grey, the one in use in the accent) rather than the channel's, so the row reads as a set of shapes.
 */
const SHAPE_ICONS = {
  slant: '<path d="M0 20 L40 9 V28 H0Z"/>',
  flat: '<path d="M0 15 H40 V28 H0Z"/>',
  reverse: '<path d="M0 9 L40 20 V28 H0Z"/>',
  zigzag: '<path d="M0 16 L5 11 L10 16 L15 11 L20 16 L25 11 L30 16 L35 11 L40 16 V28 H0Z"/>',
  wave: '<path d="M0 15 Q5 9 10 15 T20 15 T30 15 T40 15 V28 H0Z"/>',
  steps: '<path d="M0 16 H6 V11 H12 V16 H18 V11 H24 V16 H30 V11 H36 V16 H40 V28 H0Z"/>',
  torn: '<path d="M0 15 L4 12 L7 16 L11 13 L14 17 L18 12 L22 15 L25 12 L29 16 L33 13 L36 16 L40 13 V28 H0Z"/>',
  chevron: '<path d="M0 11 L20 19 L40 11 V28 H0Z"/>',
  scallop: '<path d="M0 14 A5 5 0 0 0 10 14 A5 5 0 0 0 20 14 A5 5 0 0 0 30 14 A5 5 0 0 0 40 14 V28 H0Z"/>',
  double: '<path d="M0 11 H40 V14 H0Z M0 18 H40 V28 H0Z"/>',
  stripes: '<path d="M0 15 H40 V28 H0Z"/><path d="M-2 28 L6 15 M6 28 L14 15 M14 28 L22 15 M22 28 L30 15 M30 28 L38 15 M38 28 L46 15" fill="none" stroke="#15151c" stroke-width="3"/>',
  arc: '<path d="M0 21 Q20 5 40 21 V28 H0Z"/>',
};
/** Tile for a colour-block shape: applies it to the colour-block layer instead of adding a layer. */
function shapeTile(shape) {
  const L = layer("accent"), on = L.shape === shape;
  return el("button", { class: "shp" + (on ? " on" : ""), title: t("shape." + shape), "aria-label": t("shape." + shape), "aria-pressed": String(on),
    innerHTML: `<svg viewBox="0 0 40 28" preserveAspectRatio="none" fill="currentColor" aria-hidden="true">${SHAPE_ICONS[shape]}</svg>`,
    onclick: () => { L.shape = shape; L.visible = true; S.layerId = "accent"; touch({ cover: true, panel: true, side: true }); } });
}
/** Assets: two panes — vector assets (made in code or by AI, shared by every profile) and the bitmap library. */
/** The colour block's edge, one shape for every size and layout (in the Layout sheet). */
const shapesSection = () => el("div", {}, capInfo("assets.shapes", t("assets.shapesHint")), el("div", { class: "tiles shapes" }, ACCENT_SHAPES.map(shapeTile)));
/** Which shelves of the Assets sheet show all they hold (the others, their first rows). */
const SHELVES = new Set();
/**
 * A shelf of the Assets sheet: its name and how many, then its first two rows of tiles (eight), or all of them once
 * "All" is clicked. `tiles` gives the tiles: `few` the first eight, else every one (laid out as `all` would).
 */
function shelf(key, title, count, tiles, extra = null, tip = "") {
  const open = SHELVES.has(key), more = count > 8;
  return el("div", { class: "shelf" },
    el("div", { class: "shelf-h" }, el("span", { class: "cap", style: "margin:0" }, title, el("span", { class: "n" }, ` · ${count}`)), tip && info(tip), extra,
      more && el("button", { class: "linkbtn", onclick: () => { if (open) SHELVES.delete(key); else SHELVES.add(key); renderPanel(); } }, t(open ? "shelf.less" : "shelf.all", count))),
    tiles(!open && more));
}
/**
 * The Assets sheet's state for this session only: `q` the words its search field holds (while there are any, the sheet
 * shows what they find instead of its shelves), `kind` the kind of picture the photo shelf shows alone ("" every kind).
 */
const ASSETS_UI = { q: "", kind: "" };
/**
 * Assets: everything that goes on a cover. Ways to add — text, a colour, a photo uploaded or made by AI — then the
 * search, the photos on this cover, and shelves: the photos kept (the bitmap library), stickers, channel graphics, my
 * vector assets (in folders), and a sticker made by AI from a sentence. While the search has words in it, what they
 * find takes the place of everything under it (assetsFound()).
 */
function assetsSheet() {
  const lang = getLang(), mine = [...userAssets.values()], stickers = STICKERS.map((s) => ({ kind: "sticker", id: s.id })), q = ASSETS_UI.q.trim();
  const add = (label, icon, onclick, on = false) => el("button", { class: "quick" + (on ? " on" : ""), onclick }, icon, el("span", {}, label));
  return [
    sheetHead(t("sheet.assets"), t("sheet.assetsSub")),
    el("div", { class: "quicks" },
      add(t("add.text"), ico("content", 20), () => addLayer(newLayer("text", { text: t("layer.newText") }))),
      add(t("add.solid"), el("span", { class: "sw-chip", style: `background:${cat().color}` }), () => addLayer(newLayer("solid", { color: cat().color }))),
      add(t("cover.upload"), ico("upload", 20), uploadPhotos),
      add(t("gen.open"), ico("spark", 20), () => genWin("photo"), GEN.busy || AI.busy)),
    el("div", { class: "hint", style: "margin:-6px 0 0" }, t("add.dropHint")),
    assetSearch(),
    q ? assetsFound(q) : [
      coverPhotos(),
      photoShelf(),
      shelf("stickers", t("shelf.stickers"), stickers.length, (few) => few
        ? el("div", { class: "tiles" }, stickers.slice(0, 8).map((ref) => tile(ref)))
        : el("div", { class: "shelf-groups" }, STICKER_GROUPS.map((g) => el("div", {}, el("div", { class: "hint", style: "margin:0 0 6px" }, g.name[lang]), el("div", { class: "tiles" }, STICKERS.filter((s) => s.group === g.id).map((s) => tile({ kind: "sticker", id: s.id }))))))),
      shelf("graphics", t("shelf.graphics"), GRAPHICS.length, (few) => el("div", { class: "tiles" }, (few ? GRAPHICS.slice(0, 8) : GRAPHICS).map((g) => tile({ kind: "graphic", id: g.id })))),
      mineSection(mine),
      aiSection(),
    ],
  ];
}
/**
 * The Assets sheet's search field. What is typed builds the sheet again a moment after the last key (renderPanel gives
 * the field back its focus and caret, see heldField), not while an input method is still composing a word; ✕ or Esc
 * empties it, and the sheet is as it was.
 */
function assetSearch() {
  const find = (v) => { ASSETS_UI.q = v; later("asearch", 120, () => { if (onAssetsTab()) renderPanel(); }); };
  const clear = () => { clearTimeout(timers.asearch); ASSETS_UI.q = ""; renderPanel(); };
  return el("div", { class: "asearch" }, ico("search", 16),
    el("input", { type: "text", value: ASSETS_UI.q, placeholder: t("shelf.search"), "aria-label": t("shelf.search"), maxLength: 60, spellcheck: false, autocomplete: "off", dataset: { k: "asearch" },
      oninput: (e) => { if (!e.isComposing) find(e.target.value); }, oncompositionend: (e) => find(e.target.value),
      onkeydown: (e) => { if (e.key !== "Escape" || e.isComposing) return; e.stopPropagation(); if (e.target.value) { e.target.value = ""; clear(); } else e.target.blur(); } }),
    ASSETS_UI.q && el("button", { class: "clr", title: t("shelf.searchClear"), "aria-label": t("shelf.searchClear"),
      onclick: () => { clear(); const f = $("panel").querySelector('[data-k="asearch"]'); if (f) f.focus(); } }, "✕"));
}
/** The text of `s` as the search compares it: one case, full-width letters and digits as half-width ones. */
const folded = (s) => String(s || "").normalize("NFKC").toLowerCase();
/** Whether every word of `q` is found in one of the texts given (strings, or lists of them). */
function matches(q, ...texts) {
  const hay = folded(texts.flat().join("\n"));
  return folded(q).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
/**
 * What the Assets sheet's search finds, under the names of the shelves it is on, each tile doing what it does there: the
 * photo shelf's pictures by their names (and kinds), stickers and channel graphics by their names in either language
 * (a sticker by its group's, too), my vector assets by their names — an AI-made one's in either language — and their
 * folders'. Nothing found: a line saying so.
 */
function assetsFound(q) {
  const folder = new Map(S.assetFolders.map((f) => [f.id, f.name])), group = new Map(STICKER_GROUPS.map((g) => [g.id, g.name]));
  const photos = new Set(S.library.filter((e) => matches(q, e.name, bothLangs("lib.kind." + e.kind), bothLangs("lib.chip." + e.kind).map((w) => w.replace("{0}", "")))).map((e) => e.pid));
  const stickers = STICKERS.filter((s) => matches(q, s.name.zh, s.name.en, Object.values(group.get(s.group) || {})));
  const graphics = GRAPHICS.filter((g) => matches(q, g.name.zh, g.name.en));
  const mine = [...userAssets.values()].filter((a) => matches(q, a.name, Object.values((a.spec && a.spec.name) || {}), folder.get(a.folder) || ""));
  const grid = (list, few, make) => el("div", { class: "tiles" }, (few ? list.slice(0, 8) : list).map(make));
  const found = [
    photos.size > 0 && shelf("q:photos", t("shelf.photos"), photos.size, (few) => photoTiles((e) => photos.has(e.pid), few)),
    stickers.length > 0 && shelf("q:stickers", t("shelf.stickers"), stickers.length, (few) => grid(stickers, few, (s) => tile({ kind: "sticker", id: s.id }))),
    graphics.length > 0 && shelf("q:graphics", t("shelf.graphics"), graphics.length, (few) => grid(graphics, few, (g) => tile({ kind: "graphic", id: g.id }))),
    mine.length > 0 && shelf("q:mine", t("assets.mine"), mine.length, (few) => grid(mine, few, (a) => tile({ kind: "user", id: a.id }, () => removeAsset(a.id)))),
  ].filter(Boolean);
  return found.length ? found : el("div", { class: "hint", style: "margin:0" }, t("shelf.searchNone", q));
}
/**
 * The photo shelf: the bitmap library's pictures; where it holds pictures of more than one kind (uploaded, made by AI,
 * repainted), a chip a kind above them shows that kind alone (ASSETS_UI.kind).
 */
function photoShelf() {
  const kinds = LIBRARY_KINDS.filter((k) => S.library.some((e) => e.kind === k)), kind = kinds.length > 1 && kinds.includes(ASSETS_UI.kind) ? ASSETS_UI.kind : "";
  const only = kind ? (e) => e.kind === kind : null, n = (k) => (k ? S.library.filter((e) => e.kind === k).length : S.library.length);
  const chip = (k) => el("button", { class: k === kind ? "on" : "", onclick: () => { ASSETS_UI.kind = k; renderPanel(); } }, t("lib.chip." + (k || "all"), n(k)));
  return shelf("photos", t("shelf.photos"), n(kind),
    (few) => [kinds.length > 1 && el("div", { class: "chips small" }, chip(""), kinds.map(chip)), photoTiles(only, few)],
    el("button", { class: "linkbtn", title: t("lib.uploadTip"), onclick: stockPhotos }, t("lib.stock")), t("lib.hint"));
}
/** The photo shelf's tiles (those of the pictures `only` keeps, if given), the first eight with `few`. */
function photoTiles(only, few) {
  const all = libraryTiles((pid) => placePhoto(pid), () => { if (onAssetsTab()) renderPanel(); }, true, only);
  if (few && all.classList.contains("tiles")) [...all.children].slice(8).forEach((n) => n.remove());
  return all;
}
/** Layers: the list, kept in layerBox (see renderSide). */
const layersSheet = () => [layerBox];
// ---------- My assets, in folders
// Each asset may carry `folder`, the id of a folder in S.assetFolders; one whose folder is gone is
// simply unfiled. A tile is filed by dragging it onto a folder (or onto "Unfiled" to take it out).
let DRAGGED_ASSET = null;                                  // the tile being dragged, while it is: {kind, id}
const FOLDERS = { closed: new Set(), confirmDrop: "" };    // folders shown shut; the folder whose delete awaits a second click
const persistFolders = () => writeJson("asset-folders.json", S.assetFolders).catch(fail);
function mineSection(mine) {
  const known = new Set(S.assetFolders.map((f) => f.id)), loose = mine.filter((a) => !known.has(a.folder));
  const tiles = (list) => el("div", { class: "tiles" }, list.map((a) => tile({ kind: "user", id: a.id }, () => removeAsset(a.id))));
  return el("div", {},
    el("div", { class: "mine-head" }, cap("assets.mine", ` · ${mine.length}`), el("button", { class: "btn", onclick: addFolder }, t("assets.newFolder"))),
    S.assetFolders.length > 0 && el("div", { class: "hint", style: "margin:0 0 8px" }, t("assets.folderHint")),
    S.assetFolders.map((f) => folderBox(f, mine.filter((a) => a.folder === f.id), tiles)),
    dropTarget(el("div", { class: "loose" },
      S.assetFolders.length > 0 && el("div", { class: "fhead plain" }, el("span", { class: "fname" }, t("assets.loose")), el("span", { class: "fcount" }, String(loose.length))),
      loose.length ? tiles(loose) : el("div", { class: "hint", style: "margin:0" }, t(mine.length ? "assets.looseEmpty" : "assets.mineEmpty"))), ""));
}
/** One folder: its head (open or shut, the name — double-click to rename —, how many, delete) and its tiles. */
function folderBox(f, items, tiles) {
  const open = !FOLDERS.closed.has(f.id), sure = FOLDERS.confirmDrop === f.id;
  return dropTarget(el("div", { class: "folder", dataset: { id: f.id } },
    el("div", { class: "fhead" },
      el("button", { class: "caret", title: t(open ? "assets.folderShut" : "assets.folderOpen"), onclick: () => { if (open) FOLDERS.closed.add(f.id); else FOLDERS.closed.delete(f.id); renderPanel(); } }, open ? "▾" : "▸"),
      el("span", { class: "fname", title: t("assets.folderRename"), ondblclick: () => renameFolder(f.id) }, f.name),
      el("span", { class: "fcount" }, String(items.length)),
      el("button", { class: "btn", title: t("assets.folderDrop"), onclick: () => dropFolder(f.id) }, sure ? t("assets.folderDropSure") : "×")),
    open && (items.length ? tiles(items) : el("div", { class: "hint", style: "margin:0;padding:4px 10px 10px" }, t("assets.folderEmpty")))), f.id);
}
/** Lets a dragged asset of the user's be dropped on `node`, filing it in folder `folder` ("" = unfiled). */
function dropTarget(node, folder) {
  const mine = () => DRAGGED_ASSET && DRAGGED_ASSET.kind === "user";
  node.addEventListener("dragover", (e) => { if (mine()) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; node.classList.add("over"); } });
  node.addEventListener("dragleave", (e) => { if (!node.contains(e.relatedTarget)) node.classList.remove("over"); });
  node.addEventListener("drop", (e) => {
    if (!mine()) return;
    e.preventDefault(); e.stopPropagation();
    const a = userAssets.get(DRAGGED_ASSET.id);
    DRAGGED_ASSET = null;
    if (!a || (a.folder || "") === folder) return renderPanel();
    if (folder) { a.folder = folder; FOLDERS.closed.delete(folder); } else delete a.folder;
    saveAssetRecord(a).catch(fail);
    renderPanel();
  });
  return node;
}
function addFolder() {
  const f = { id: "f" + uid(), name: t("assets.folderName", S.assetFolders.length + 1) };
  S.assetFolders.push(f); persistFolders(); renderPanel();
  renameFolder(f.id);
}
/** Turns a folder's name into a field: Enter or leaving it keeps the name, Esc does not. */
function renameFolder(id) {
  const f = S.assetFolders.find((x) => x.id === id), name = $("panel").querySelector(`.folder[data-id="${CSS.escape(id)}"] .fname`);
  if (!f || !name) return;
  const input = el("input", { type: "text", class: "rename", value: f.name, maxLength: 40, spellcheck: false,
    onkeydown: (e) => { if (projectKey(e)) { input.blur(); return; } e.stopPropagation(); if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = f.name; input.blur(); } },   // ⌘S/⌘O on to the window's keys, the name kept first
    onblur: () => { const v = input.value.trim(); if (v && v !== f.name) { f.name = v; persistFolders(); } renderPanel(); } });
  name.replaceWith(input); input.focus(); input.select();
}
/** Deletes a folder on the second click; its assets stay, unfiled. */
async function dropFolder(id) {
  if (FOLDERS.confirmDrop !== id) { FOLDERS.confirmDrop = id; return renderPanel(); }
  FOLDERS.confirmDrop = "";
  S.assetFolders = S.assetFolders.filter((f) => f.id !== id); persistFolders();
  for (const a of userAssets.values()) if (a.folder === id) { delete a.folder; await saveAssetRecord(a).catch(fail); }
  renderPanel();
}

// ---------- AI-generated assets
// ---------- a photo's subject, cut out (Apple Vision, macOS 14+; see src-tauri/src/subject.rs)
const CUT = { busy: false, error: "" };
// Two ways: Apple Vision (macOS 14+, built in) and BiRefNet (any system, a model downloaded in Settings →
// AI → Cut-out, run on this computer by ONNX Runtime; see src-tauri/src/matting.rs).
const isMac = HOST === "tauri" && /Mac/i.test(navigator.userAgent);   // Vision is this computer's; a server's own is not known yet
const canCut = () => CAN.cut;
/** The way of cutting out in use: the one chosen, else Vision on a Mac and the light BiRefNet elsewhere. */
const cutEngine = () => { const e = S.settings.cutEngine; return e === "vision" ? (isMac ? "vision" : "birefnet-lite") : e || (isMac ? "vision" : "birefnet-lite"); };
/** Whether the model a BiRefNet way needs is downloaded. */
const cutReady = (engine = cutEngine()) => engine === "vision" || S.cutModels.some((m) => m.id === engine && m.have);
/** The photo as JPEG bytes, upright, no bigger than `max` on its longer side. */
async function photoBytes(im, max = 4096) {
  const [w, h] = sizeOf(im), k = Math.min(1, max / Math.max(w, h)), cv = document.createElement("canvas");
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(im, 0, 0, cv.width, cv.height);
  return new Uint8Array(await (await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.95))).arrayBuffer());
}
/** Makes the subject mask of a picture in the store (again, with `fresh`). Returns whether there is one; why not goes to CUT.error. */
async function ensureMask(pid, fresh = false) {
  const rec = S.photos.get(pid);
  if (!rec || !canCut()) return false;
  const engine = cutEngine();
  if (rec.mask && !fresh) return true;
  if (!cutReady(engine)) { Object.assign(CUT, { error: t("cut.needModel", t("cutset.engine." + engine)), needModel: true }); renderSide(); return false; }
  Object.assign(CUT, { busy: true, error: "", needModel: false }); if (onCoverTab()) renderPanel(); renderSide();
  const img = rec.img;
  try {
    const png = await aiTracked("cut", engine, async () => (engine === "vision" ? invoke("subject_mask", await photoBytes(img))
      : invoke("subject_mask_onnx", await photoBytes(img, 2048), { headers: { "x-model": engine } })), (out, err) => !!err && !/no subject/i.test(String(err && err.message ? err.message : err)));   // a photo with no subject found is no fault of the cut-out's
    if (rec.img !== img) return false;   // the picture changed meanwhile
    const src = await readAs(new Blob([png], { type: "image/png" }), "readAsDataURL"), m = await loadImage(src);
    rec.mask = m ? { img: m, src } : null;
    savePhoto(pid);
    return !!rec.mask;
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    CUT.error = /no subject/i.test(msg) ? t("cut.none") : /^unsupported/i.test(msg) ? t("cut.unsupported") : t("msg.failed", msg);
    return false;
  } finally { CUT.busy = false; touch({ cover: true, side: true }); if (onCoverTab()) renderPanel(); }
}
/** A picture changed (a new one, a repaint): the layers cut from it get its new subject. */
async function recut(pid) { if (S.cover.layers.some((l) => l.type === "photo" && l.cut && recordOf(l) === S.photos.get(pid))) await ensureMask(pid, true); }
/** The sizes a cut-out of photo L made now is for: where L shows among those the scope under the canvas reaches (see sizesFor in layers.js). */
const cutSizes = (L) => sizesFor(L, scopeKeys(), sizeKeys());
/**
 * The photo Cut out subject cuts photo L's subject out of: L, or where L does not show at the sizes the scope at the
 * top reaches, the photo of its picture that does — the copy Remove the background left there (see cutFrom in layers.js).
 */
const cutSource = (L) => cutFrom(S.cover.layers, L, scopeKeys(), sizeKeys());
/**
 * Cuts the subject out of photo layer L into a linked cut-out (see "linked photos"): above the title
 * (or above L, when L is higher), selected. When L has one already, its subject is found again
 * instead. With the scope at one size or one orientation, the cut-out shows only there (see `sizes` in layers.js), and
 * says so; one L has already that does not show there yet is put there too. Where L does not show there and the copy
 * Remove the background left there does, the cut-out is that copy's (cutSource). Returns the cut-out, or null.
 */
async function cutOut(L) {
  if (!L || L.type !== "photo" || L.of || CUT.busy || !canCut()) return null;
  L = cutSource(L);
  const had = passivesOf(L)[0], all = sizeKeys(), want = cutSizes(L);
  if (had && !want.every((k) => inSize(had, k))) {   // the photo's cut-out is kept to other sizes: it shows at these too
    keepTo(had, [...all.filter((k) => inSize(had, k)), ...want], all);
    S.layerId = had.id; S.picked = [];
    touch({ cover: true, side: true, panel: true });
    toast(had.sizes ? sizesSaid("cut.alsoIn", had.sizes) : t("cut.everywhere"));
    return had;
  }
  if (!(await ensureMask(L.pid, !!had))) return null;
  if (had) { touch({ cover: true, side: true, panel: true }); toast(t("cut.redone")); return had; }
  const c = newLayer("photo", { of: L.id, cut: true, own: true });
  c.t = alignedT(L);
  if (L.crop && !L.fill) c.crop = normalizeCrop(L.crop);   // of what the photo keeps (a copy: a free crop's corners its own)
  if (L.cats) c.cats = [...L.cats];
  keepTo(c, want, all);
  const at = (id) => S.cover.layers.findIndex((l) => l.id === id);
  insertAbove(S.cover.layers, at(L.id) > at("title") ? L.id : "title", c);
  S.layerId = c.id; S.picked = [];
  touch({ cover: true, side: true, panel: true });
  toast(c.sizes ? sizesSaid("cut.madeOnly", c.sizes) : t("cut.made"));
  return c;
}
/**
 * Removes the background of photo L (its `cut`) where the scope under the canvas reaches (see cutAt in layers.js): for every
 * size, or where L shows at those sizes alone, L itself is cut; else a copy of it, cut, shows at those sizes right
 * above it, selected, and L no longer does there, the other sizes as they were.
 */
function cutWhere(L) {
  const keys = scopeKeys(), c = cutAt(S.cover.layers, L, keys, sizeKeys());
  if (c) { S.layerId = c.id; S.picked = []; toast(sizesSaid("cut.bgOnly", c.sizes)); }
  else if (!L.cut) toast(sizesSaid("cut.notThere", keys));   // it shows at none of them
}

// ---------- repainting a photo with an image model (see repaint.js)
// for: the photo layer whose repaint is open; of: the one the running repaint, or its results or error, belong to;
// made: what this session's repaints of it brought back, oldest first, at most REP_MADE ({src, w, h, pid, as}: the
// picture, its size, its place in the photo store, the name of what it was painted as, {zh, en}); result: the one of
// them shown, waiting to be used or dropped; test: the image model's connection check
const REP = { for: "", of: "", busy: false, job: 0, since: 0, error: "", made: [], result: null, test: null, confirmDrop: null };
const REP_MADE = 12;
/** Whether the open sheet shows the cover's own things — its words, its layout parts, its photos — which follow its layers. */
const onCoverTab = () => S.mode === "edit" && !sheetHidden() && ["content", "layout", "assets"].includes(S.tab.edit);
const repSecs = () => Math.max(0, Math.round((Date.now() - REP.since) / 1000));
const repBusyText = () => t("rep.busy", repSecs());
/** A copy of a picture no longer than `max` on its longer side, as JPEG: {mime, data, url, w, h}. */
function shrink(im, max, q = 0.9) {
  const W = im.naturalWidth || im.width, H = im.naturalHeight || im.height;   // an Image, or a canvas
  const k = Math.min(1, max / Math.max(W, H)), cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(W * k)); cv.height = Math.max(1, Math.round(H * k));
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, cv.width, cv.height);   // JPEG has no transparency
  x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", q);
  return { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url, w: cv.width, h: cv.height };
}
/** Sends a photo and a prompt to the image model and returns the new picture: {src, w, h}. */
/** Sends one request to the image service: {status, text}. `method` "GET" sends no body. */
async function imageSend(cfg, req, image = true) {
  const body = req.body ? JSON.stringify(req.body) : "", method = req.method || "POST";
  return CAN.relay
    ? await invoke("ai_request", { url: req.url, headers: Object.entries(req.headers), body, proxy: cfg.proxy || null, timeout: cfg.timeout, image, method })
        .catch((e) => { throw new Error(/timed out/i.test(String(e)) ? t("ai.timedOut", cfg.timeout) : String(e)); })
    : await fetch(req.url, { method, headers: req.headers, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(cfg.timeout * 1000) }).then(async (r) => ({ status: r.status, text: await r.text() }));
}
/** Checks the image service's key and model without making a picture: {ok, text}, ok being true, false or null (cannot tell). */
async function checkImageAi(cfg) {
  const ask = async (list) => { const a = await imageSend(cfg, imageCheck(cfg, list), false); return readImageCheck(cfg, a.status, a.text, list); };
  return aiTracked("image", cfg, async () => {   // its light: red when it failed; "cannot tell" is no failure
    let r = await ask(false);
    if (r.again) r = await ask(true);
    return { ok: r.ok, key: r.key, text: t("img.check." + r.key, cfg.model) + (r.detail ? ` (${r.detail})` : "") };
  }, (r, err) => (err ? true : r.key === "notListed" || r.key === "noList" ? null : r.ok === false));
}
/**
 * Sends a prompt, with a picture or without (`pic` null: a new picture is made), to the image model
 * and returns the picture that comes back: {src, w, h}. `shape` {w, h} is the shape to ask for when
 * it is not the picture's; asking for it also tells a Gemini model, which otherwise copies the picture's. Its light
 * (aiTracked) is amber meanwhile, and red should it fail.
 */
function imageCall(cfg, prompt, pic, shape = null) { return aiTracked("image", cfg, () => imageMake(cfg, prompt, pic, shape)); }
async function imageMake(cfg, prompt, pic, shape) {
  const req = buildImageRequest(cfg, prompt, pic, (shape || pic).w, (shape || pic).h, { shape: !!shape });
  let reply = await imageSend(cfg, req);
  // a model that does not take one of the optional settings says so: ask again without it
  for (let k = 0, key; k < 3 && (key = refusedParam(reply.status, reply.text, req.body)); k++) { delete req.body[key]; reply = await imageSend(cfg, req); }
  const out = readImageReply(cfg.provider, reply.status, reply.text);
  if (out.error) throw new Error(out.error);
  // some services leave the picture at a link instead of sending it
  const img = out.image || (CAN.relay
    ? await invoke("fetch_image", { url: out.url, proxy: cfg.proxy || null, timeout: cfg.timeout })
    : await fetch(out.url).then((r) => r.blob()).then(async (b) => { const u = await readAs(b, "readAsDataURL"); return { mime: b.type || "image/png", data: u.slice(u.indexOf(",") + 1) }; }));
  const src = `data:${img.mime};base64,${img.data}`, im = await loadImage(src);
  if (!im) throw new Error(t("rep.badImage"));
  return { src, w: im.naturalWidth, h: im.naturalHeight };
}
/** The photo layer whose repaint is open, or null. */
const repTarget = () => { const L = REP.for && layer(REP.for); return L && L.type === "photo" && !L.of ? L : null; };
/** Repaints the photo of the open repaint — always from the original, so repaints do not pile up on each other. */
async function repaintPhoto() {
  const cfg = S.imageAi;
  const rec = recordOf(repTarget());
  if (!rec || REP.busy) return;
  const mine = myStyle(), preset = builtIn();
  if (mine && !promptOf(mine.body)) return toast(t("rep.needCustom"));
  let text = mine ? promptOf(mine.body) : "";
  if (preset) { try { text = await styleText(preset); } catch (e) { REP.error = String(e.message); return repRedraw(); } }
  const P = repTarget(), job = ++REP.job, from = (rec.original ? await loadImage(rec.original) : null) || rec.img, as = repStyleName();
  const prompt = repaintPrompt({ source: mine || preset ? "text" : "look", look: S.profile.style.look, color: cat().color, text, notes: cfg.notes });
  if (REP.of !== P.id) Object.assign(REP, { made: [], result: null });   // another photo's results (they stay in the library)
  Object.assign(REP, { of: P.id, busy: true, error: "", since: Date.now() });   // the result shown stays, to be compared meanwhile
  repRedraw();
  const tick = setInterval(() => {
    if (!REP.busy) return;
    const b = document.getElementById("rep-go"), tile = document.getElementById("rep-tile");
    if (b) b.textContent = repBusyText();
    if (tile) tile.textContent = t("rep.tile", repSecs());
  }, 1000);
  let result = null, error = "";
  try {
    // kept at the size of the photo it was painted from, cut to its shape where the service paints another: so it lies
    // exactly over it in the compare view, and takes its place on the cover without moving
    result = { ...(await fitPicture(await imageCall(cfg, prompt, shrink(from, 1536)), ...sizeOf(from), rec.original || rec.src)), as };
    result.pid = await putPhoto(result.src, { original: rec.original || rec.src });   // a picture of its own, which remembers the one it was painted from
    keepPicture(result.pid, t("lib.repaintOf", layer(P.id) ? layerName(P) : ""), "repaint");
  }
  catch (e) { error = String(e && e.message ? e.message : e); }
  clearInterval(tick);
  if (job !== REP.job) return;                       // cancelled meanwhile
  Object.assign(REP, { busy: false, error });
  if (result) Object.assign(REP, { made: [...REP.made, result].slice(-REP_MADE), result });   // shown at once
  if (REP.for !== P.id && layer(P.id)) toast(t(error ? "rep.failedToast" : "rep.readyToast", layerName(P)));   // closed meanwhile: it waits in the photo's AI repaint
  repRedraw();
}
/**
 * Picture `out` ({src, w, h}) made W × H: the middle of it in that shape (coverCrop), scaled — as PNG when `like`, the
 * picture it stands for, is one, else as JPEG. As it is when it is that size already.
 */
async function fitPicture(out, W, H, like) {
  if (out.w === W && out.h === H) return out;
  const im = await loadImage(out.src);
  if (!im) throw new Error(t("rep.badImage"));
  const c = coverCrop(out.w, out.h, W, H), cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  x.imageSmoothingQuality = "high";
  x.drawImage(im, c.x, c.y, c.w, c.h, 0, 0, W, H);
  const src = /^data:image\/png/.test(like) ? cv.toDataURL("image/png") : cv.toDataURL("image/jpeg", 0.92);
  return src.length > 32 ? { src, w: W, h: H } : out;   // a canvas too big to read back: the picture as it came
}
/** Stops waiting for the repaint under way; this session's results stay. */
function cancelRepaint() { REP.job++; Object.assign(REP, { busy: false, error: "" }); repRedraw(); }
/** Drops the result shown from this session's (it stays in the library); the newest of the others is shown instead. */
function dropResult() { REP.made = REP.made.filter((x) => x !== REP.result); REP.result = REP.made[REP.made.length - 1] || null; repRedraw(); }
/**
 * Puts another picture into a photo's record — a repaint, or back to the original — so every layer
 * showing it changes; its subject is cut out again for the layers that are cut.
 */
/**
 * Shows another picture of the store in photo layer L (and its linked cut-out): a repaint, or the one it
 * was painted from. The pictures themselves are not changed — another cover, or the library, may show them.
 */
async function usePicture(L, pid) {
  const A = L && owner(L);
  if (!A || !pid) return;
  A.pid = pid; REP.result = null;
  touch({ cover: true, panel: true, side: true });
  repRedraw();
  recut(pid);
}
async function useRepaint() {
  const r = REP.result;
  if (!r) return;
  await usePicture(repTarget(), r.pid || (await putPhoto(r.src, { original: recordOf(repTarget()).src })));
  toast(t("rep.used"));
}
/** Back to the picture a repaint was painted from: the one in the store with that picture, else a new one. */
async function restoreOriginal(L) {
  const rec = recordOf(L);
  if (!rec || !rec.original) return;
  const known = [...S.photos.entries()].find(([, r]) => r.src === rec.original && !r.original);
  await usePicture(L, known ? known[0] : await putPhoto(rec.original));
}
/** The built-in style the repaint uses now, or null. */
const builtIn = () => (S.imageAi.source.startsWith("preset:") ? S.repaintStyles.find((s) => "preset:" + s.id === S.imageAi.source) || null : null);
/** The user's own style the repaint uses now, or null. */
const myStyle = () => (S.imageAi.source.startsWith("my:") ? S.myStyles.find((s) => "my:" + s.id === S.imageAi.source) || null : null);

// The user's own styles are files: <app data>/repaint-styles/<id>.md, in the same form as the
// built-in ones (a header, then the prompt). The app writes them as they are edited, and reads
// the folder again whenever its window comes back to the front, so files added or changed in
// another editor show up.
const MY_DIR = "repaint-styles";
async function loadMyStyles() {
  const names = (await files.list(MY_DIR).catch(absent([]))).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/.test(f)).slice(0, MAX_STYLES);
  const out = [];
  for (const f of names) { const text = await files.read(`${MY_DIR}/${f}`).catch(absent(null)); if (text != null) out.push(userStyle(f, text)); }
  return out.sort((a, b) => a.order - b.order || a.name[getLang()].localeCompare(b.name[getLang()]));
}
/** Reads the folder again; redraws the panel if anything changed (nothing, when it could not be read just now). */
async function refreshMyStyles() {
  const was = JSON.stringify(S.myStyles.map((s) => [s.id, s.meta, s.body]));
  const mine = await loadMyStyles().catch(() => null);   // a style taken for gone would be unselected
  if (!mine) return;
  S.myStyles = mine;
  if (JSON.stringify(S.myStyles.map((s) => [s.id, s.meta, s.body])) === was) return;
  if (S.imageAi.source.startsWith("my:") && !myStyle()) { S.imageAi.source = "look"; persistImageAi(); }   // its file is gone
  if (!(document.activeElement && document.activeElement.closest && document.activeElement.closest(".repw"))) repRedraw();
}
addEventListener("focus", () => { if (S.cover) refreshMyStyles(); });
const saveMyStyle = (st) => later("style-" + st.id, 400, () => files.write(`${MY_DIR}/${st.file}`, writeStyle(st.meta, st.body)).catch(fail));
/** Writes a new style file of the user's own and selects it. */
async function addStyle(meta, body) {
  if (S.myStyles.length >= MAX_STYLES) return toast(t("rep.tooMany", MAX_STYLES));
  const id = freeId(Date.now().toString(36), S.myStyles.map((s) => s.id));
  await files.write(`${MY_DIR}/${id}.md`, writeStyle(meta, body)).catch(fail);
  await rereadMyStyles([...S.myStyles, userStyle(id + ".md", writeStyle(meta, body))]);
  S.imageAi = normalizeImageAi({ ...S.imageAi, source: "my:" + id }); persistImageAi(); repRedraw();
}
/** Reads the folder again after a change to it; when it cannot be read just now (on a server), says so and takes `was` for what is there. */
async function rereadMyStyles(was) {
  S.myStyles = await loadMyStyles().catch((e) => { fail(e); return was; });
}
/** Brings in a style file from elsewhere (one shared by someone, a skill's SKILL.md…), kept as it is. */
async function importStyle() {
  const f = await pickFile(".md,.markdown,.txt,text/markdown,text/plain");
  if (!f) return repRedraw();
  const text = await readAs(f, "readAsText");
  const id = freeId(f.name, S.myStyles.map((s) => s.id)), st = userStyle(id + ".md", text);
  if (!st.prompt) { toast(t("rep.importEmpty")); return repRedraw(); }
  // a file without a header gets one, named after the file; one with a header is kept word for word
  const out = /^\uFEFF?---\r?\n/.test(text) ? text : writeStyle({ name: f.name.replace(/\.[^.]+$/, "") }, text);
  await files.write(`${MY_DIR}/${id}.md`, out).catch(fail);
  await rereadMyStyles([...S.myStyles, userStyle(id + ".md", out)]);
  S.imageAi = normalizeImageAi({ ...S.imageAi, source: "my:" + id }); persistImageAi(); repRedraw();
  toast(t("rep.imported", st.name[getLang()]));
}
/** Writes out the styles image-ai.json held before they were files, once. */
async function migrateStyles(raw) {
  const old = legacyStyles(raw);
  if (!old.length) return;
  const have = await files.list(MY_DIR).catch(absent([]));
  for (const s of old) if (!have.includes(s.id + ".md")) await files.write(`${MY_DIR}/${s.id}.md`, writeStyle({ name: s.name }, s.prompt)).catch(fail);
  await writeJson("image-ai.json", S.imageAi).catch(fail);   // without them from now on
}
/**
 * The AI repaint of a photo, in a window of its own. On the left, the photo in a compare view: the original, and over it
 * from the split rightwards the result shown (or, with none, the repaint the photo shows if it is one), the split
 * dragged by its round handle or anywhere on the view (REPWIN.at); under it this session's results (REP.made, the one
 * shown framed, a tile counting the seconds while another is painted), Back to the original, Discard, Try again and Use
 * this. On the right what it is painted as — the current look, a built-in style (a card each, with its colours; what it
 * is and its prompt under the cards once chosen), or one of the user's own (files, edited here under their chips) — a
 * note to add, the service and what it costs, and Repaint. REP.for: the photo layer whose window is open. A repaint goes
 * on with the window shut, and waits in it for the photo.
 */
const REPWIN = { all: false, at: 0.5 };   // every built-in style listed, or the first few; where the compare view is split, 0 to 1
/** Opens the AI repaint of photo layer L; not while another photo's repaint is under way (one at a time). */
function repaintOpen(L) {
  if (REP.busy && REP.of !== L.id) return toast(t("rep.busyOther", layer(REP.of) ? layerName(layer(REP.of)) : ""));
  REP.for = L.id; repaintWin();
}
/** What the repaint is painted as now — the user's style, a built-in one, or the current look — by name: {zh, en}. */
const repStyleName = () => (myStyle() || builtIn() || LOOKS[S.profile.style.look] || LOOKS.cel).name;
/** Draws the repaint window again if it is open, and the photos listed in Assets (their repaint's state). */
function repRedraw() {
  if ($("modal").querySelector(".dlg.repw")) repaintWin();
  if (onCoverTab()) renderPanel();
  renderBar();   // a photo's AI repaint there is off while another's runs
}
function repClose() { REP.for = ""; closeModal(); if (onCoverTab()) renderPanel(); }
/** The compare view's split at `at` (0 to 1): the result shown from there rightwards, the line and the handle on it. */
function repSplit(view, at) {
  REPWIN.at = clamp(at, 0, 1);
  view.style.setProperty("--at", REPWIN.at);
  const knob = view.querySelector(".knob");
  if (knob) knob.setAttribute("aria-valuenow", String(Math.round(REPWIN.at * 100)));
}
function repaintWin() {
  const P = repTarget(), m = $("modal"), held = heldField(m), list = m.querySelector(".repw .repopts"), top = list ? list.scrollTop : 0;
  if (!P) return repClose();
  const c = S.imageAi, lang = getLang(), rec = recordOf(P), im = rec && rec.img, ours = REP.of === P.id, r = ours ? REP.result : null, busy = ours && REP.busy;
  const set = (k, v, redraw = false) => { S.imageAi = normalizeImageAi({ ...S.imageAi, [k]: v }); persistImageAi(); if (redraw) repaintWin(); };
  /** Edits the selected style of the user's own and saves its file (typing must not rebuild the window). */
  const rename = (v) => { const st = myStyle(); if (!st) return; delete st.meta["name.zh"]; delete st.meta["name.en"]; st.meta.name = v; st.name = { zh: v, en: v }; saveMyStyle(st); };
  const rewrite = (v) => { const st = myStyle(); if (!st) return; st.body = v; st.prompt = promptOf(v); saveMyStyle(st); };
  const close = el("button", { class: "x", title: t("close"), onclick: repClose }, "✕");
  m.onDismiss = repClose;
  if (!imageReady(c)) {
    m.replaceChildren(el("div", { class: "dlg repw small" }, el("div", { class: "xhead" }, el("div", {}, el("h2", {}, t("rep.title")), el("div", { class: "hint" }, `${layerName(P)} · ${t("rep.sub")}`)), close),
      el("div", { class: "hint", style: "margin:0" }, t("rep.needSetup")),
      el("button", { class: "btn solid", onclick: () => { repClose(); S.tab.setup = "ai"; SET_UI.at = "image"; setMode("setup"); } }, t("rep.goSetup"))));
    m.hidden = false;
    return;
  }
  const look = LOOKS[S.profile.style.look] || LOOKS.cel, mine = myStyle(), preset = builtIn();
  // the compare view: the original, and over it from the split rightwards the result shown, or else the repaint in use
  const before = rec && (rec.original || rec.src), after = r ? r.src : rec && rec.original ? rec.src : "", afterName = r ? t("rep.result", r.as[lang]) : t("rep.isRepainted");
  const [w, h] = im ? sizeOf(im) : [3, 2];   // the photo's shape (a repaint has its original's size), checked as the original loads
  const knob = after && el("span", { class: "knob", role: "slider", tabindex: 0, "aria-label": t("rep.compare"), title: t("rep.compare"), "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": Math.round(REPWIN.at * 100),
    onkeydown: (e) => {
      const k = e.key.toLowerCase(), by = e.shiftKey ? 0.2 : 0.05, to = { arrowleft: REPWIN.at - by, arrowright: REPWIN.at + by, home: 0, end: 1 }[k];
      if (to === undefined) return;
      e.preventDefault(); repSplit(e.currentTarget.parentElement, to);
    } }, "‹ ›");
  /** The split follows the pointer pressed on the view for as long as it is held. */
  const drag = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    const view = e.currentTarget, follow = (ev) => { const b = view.getBoundingClientRect(); repSplit(view, (ev.clientX - b.left) / b.width); };
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    follow(e);
    view.onpointermove = follow;
    view.onpointerup = view.onpointercancel = () => { view.onpointermove = null; };
  };
  const view = im ? el("div", { class: "cmp" + (after ? " two" : ""), style: `--ar:${w / h};--at:${REPWIN.at}`, onpointerdown: after ? drag : null },
    el("img", { src: before, alt: t("rep.before"), draggable: false, onload: (e) => e.currentTarget.parentElement.style.setProperty("--ar", e.currentTarget.naturalWidth / e.currentTarget.naturalHeight) }),
    after && el("div", { class: "after" }, el("img", { src: after, alt: afterName, draggable: false })),
    el("span", { class: "vlabel" }, t("rep.before")),
    after && [el("span", { class: "vlabel r" }, afterName), el("i", { class: "cut" }), knob],
    !after && el("span", { class: "cmp-wait" + (busy ? " busy" : "") }, t(busy ? "rep.running" : "rep.empty")),
    ours && REP.error && el("div", { class: "cmp-err" }, t("msg.failed", REP.error)))
    : el("div", { class: "hint err" }, t("props.photoMissing"));
  // this session's results, the one shown framed, and a tile while another is painted
  const made = ours ? REP.made : [];
  const strip = (made.length > 0 || busy) && el("div", { class: "repmade" }, el("span", { class: "cap" }, t("rep.made")),
    el("div", { class: "repthumbs" },
      made.map((x) => el("button", { class: "repthumb" + (x === r ? " on" : ""), title: t("rep.result", x.as[lang]), "aria-pressed": String(x === r), onclick: () => { REP.result = x; repRedraw(); } }, el("img", { src: x.src, alt: "" }))),
      busy && el("span", { id: "rep-tile", class: "repthumb wait" }, t("rep.tile", repSecs()))));
  // what to paint it as: the current look, a built-in style (the first eight, or the first seven and the one chosen, until All), one of the user's own
  const card = (v, kids, title = null, kind = "") => el("button", { class: `rcard${kind}${c.source === v ? " on" : ""}`, title, "aria-pressed": String(c.source === v), disabled: REP.busy, onclick: () => set("source", v, true) }, kids);
  const chip = (v, label) => el("button", { class: "rchip" + (c.source === v ? " on" : ""), "aria-pressed": String(c.source === v), disabled: REP.busy, onclick: () => set("source", v, true) }, label);
  const all = S.repaintStyles, at = preset ? all.indexOf(preset) : -1;
  const presets = REPWIN.all || all.length <= 8 ? all : at >= 8 ? [...all.slice(0, 7), preset] : all.slice(0, 8);
  /** Fills a <pre> with a built-in style's prompt the first time it is opened. */
  const peek = (e) => { const pre = e.currentTarget.querySelector("pre"); if (e.currentTarget.open && !pre.textContent) styleText(preset).then((x) => { pre.textContent = x; }, (err) => { pre.textContent = String(err.message); }); };
  m.replaceChildren(el("div", { class: "dlg repw" }, el("div", { class: "repbody" },
    el("div", { class: "repview" },
      el("div", { class: "rephead" }, el("h2", {}, t("rep.title")), el("span", {}, layerName(P)), el("span", {}, t("rep.sub"))),
      el("div", { class: "repstage" }, view),
      el("div", { class: "repfoot" }, strip, el("span", { class: "grow" }),
        el("div", { class: "repacts" },
          rec && rec.original && el("button", { class: "linkbtn", disabled: REP.busy, onclick: () => restoreOriginal(P) }, t("rep.restore")),
          r && [el("button", { class: "btn quiet", onclick: dropResult }, t("ai.discard")),
            el("button", { class: "btn", disabled: REP.busy, onclick: repaintPhoto }, t("rep.again")),
            el("button", { class: "btn solid", onclick: useRepaint }, t("rep.use"))]))),
    el("div", { class: "repside" }, close,
      el("div", { class: "reptitle" }, t("rep.as")),
      el("div", { class: "repopts" },
        card("look", [el("i", { class: "radio" }), el("b", {}, t("rep.src.look", look.name[lang]))], null, " follow"),
        el("div", { class: "cap" }, el("span", {}, t("rep.src.presetN", all.length)),
          all.length > 8 && el("button", { class: "linkbtn", onclick: () => { REPWIN.all = !REPWIN.all; repaintWin(); } }, t(REPWIN.all ? "odds.fold" : "rep.allPresets"))),
        el("div", { class: "rcards" }, presets.map((st) => card("preset:" + st.id, [el("b", {}, st.name[lang]), st.swatch && el("span", { class: "sw3" }, st.swatch.map((x) => el("i", { style: `background:${x}` })))], st.about && st.about[lang]))),
        preset && el("div", { class: "rdetail" },
          preset.about && el("div", { class: "about", title: preset.about[lang] }, preset.about[lang]),
          preset.credit && el("div", { class: "hint" }, t("rep.credit", preset.credit)),
          el("details", { class: "peek", ontoggle: peek }, el("summary", {}, t("rep.peek")), el("pre", {})),
          el("button", { class: "linkbtn", onclick: async () => addStyle({ name: preset.name[lang] + t("rep.copySuffix"), ...(preset.credit ? { credit: preset.credit } : {}) }, await styleText(preset).catch(() => "")) }, t("rep.copy"))),
        el("div", { class: "cap" }, el("span", {}, t("rep.src.mine")), CAN.folders && el("button", { class: "linkbtn", onclick: () => invoke("reveal_data_dir", { dir: MY_DIR }).catch(fail) }, t("rep.src.folder"))),
        el("div", { class: "rchips" }, S.myStyles.map((st) => chip("my:" + st.id, st.name[lang])),
          el("button", { class: "rchip add", disabled: REP.busy, onclick: () => addStyle({ name: t("rep.newName", S.myStyles.length + 1) }, "") }, t("rep.src.new")),
          el("button", { class: "rchip add", disabled: REP.busy, onclick: importStyle }, t("rep.src.import"))),
        mine && el("div", { class: "rdetail" },
          mine.about && el("div", { class: "about", title: mine.about[lang] }, mine.about[lang]),
          mine.credit && el("div", { class: "hint" }, t("rep.credit", mine.credit)),
          textInput(mine.name[lang], rename, { placeholder: t("rep.namePh"), maxLength: 60, onchange: () => repaintWin(), dataset: { k: "stname" } }),
          el("textarea", { value: mine.body, spellcheck: false, style: "height:140px;font-size:13px", placeholder: t("rep.customPh"), dataset: { k: "stbody" }, oninput: (e) => rewrite(e.target.value) }),
          el("div", { class: "hint" }, t("rep.customHint", `repaint-styles/${mine.file}`)),
          el("button", { class: "linkbtn danger", onclick: async () => {
            if (REP.confirmDrop !== mine.id) { REP.confirmDrop = mine.id; repaintWin(); return; }   // a second click confirms
            REP.confirmDrop = null;
            await files.remove(`${MY_DIR}/${mine.file}`).catch(fail);
            await rereadMyStyles(S.myStyles.filter((s) => s.id !== mine.id)); S.imageAi = normalizeImageAi({ ...c, source: "look" }); persistImageAi(); repaintWin();
          } }, t(REP.confirmDrop === mine.id ? "rep.dropSure" : "rep.drop", mine.name[lang]))),
        el("div", {}, el("div", { class: "cap" }, t("rep.notes")),
          textInput(c.notes, (v) => set("notes", v), { placeholder: t("rep.notesPh"), maxLength: 600, disabled: REP.busy, dataset: { k: "notes" } }))),
      el("div", { class: "hint" }, t("rep.hint", t("img.provider." + c.provider), c.model)),
      el("div", { class: "repgo" },
        busy && el("button", { class: "btn", onclick: cancelRepaint }, t("ai.cancel")),
        el("button", { id: "rep-go", class: "btn cta glassy go", disabled: REP.busy || !im, onclick: repaintPhoto }, busy ? repBusyText() : t("rep.go")))))));
  m.hidden = false;
  const opts = m.querySelector(".repopts");
  if (opts) opts.scrollTop = top;   // where the list was scrolled to, as the window is built again
  giveBack(m, held);
}
// ---------- a photo made by the image model, from words and perhaps a reference picture
// ref: {mime, data, url, w, h} of the reference; result: {src, w, h} waiting to be added or dropped
const GEN = { busy: false, job: 0, since: 0, prompt: "", ref: null, error: "", result: null };
const genBusyText = () => t("gen.busy", Math.max(0, Math.round((Date.now() - GEN.since) / 1000)));
/** Makes a picture in the shape of the size on the canvas. */
async function generatePhoto() {
  const text = GEN.prompt.trim(), ref = GEN.ref, size = selSize();
  if ((!text && !ref) || GEN.busy) return;
  const job = ++GEN.job;
  Object.assign(GEN, { busy: true, error: "", result: null, since: Date.now() });
  genRedraw();
  const tick = setInterval(() => { const b = document.getElementById("gen-go"); if (b && GEN.busy) b.textContent = genBusyText(); }, 1000);
  let result = null, error = "";
  try {
    result = await imageCall(S.imageAi, generatePrompt({ text, reference: !!ref }), ref, { w: size.w, h: size.h });
    result.pid = await putPhoto(result.src);   // kept in the bitmap library whether or not it is added to the cover
    keepPicture(result.pid, text || t("lib.kind.ai"), "ai");
  }
  catch (e) { error = String(e && e.message ? e.message : e); }
  clearInterval(tick);
  if (job !== GEN.job) return;                       // cancelled meanwhile
  Object.assign(GEN, { busy: false, result, error });
  if (result) madeNow("photo", result, text, ref);
  genDone("photo", error);
  genRedraw();
}
function cancelGeneratePhoto() { GEN.job++; Object.assign(GEN, { busy: false, error: "", result: null }); genRedraw(); }
/** Takes a picture as the reference for the next one made, `f` (one dropped) or one picked: sent along, at most 1536 px on its longer side. */
async function pickGenRef(f = null) {
  f = f || await pickFile("image/png,image/jpeg,image/webp");
  if (!f) return;
  const im = await loadImage(await readAs(f, "readAsDataURL"));
  if (!im) return toast(t("msg.badFile"));
  GEN.ref = shrink(im, 1536); genRedraw();
}
async function keepGeneratedPhoto() {
  const r = GEN.result;
  if (!r) return;
  GEN.result = null;
  if (await (r.pid ? placePhoto(r.pid) : addPhoto(r.src))) { closeModal(); if (onAssetsTab()) renderPanel(); } else genRedraw();
}
// ---------- AI generate, in a window of its own: a photo (the image model) or a sticker or graphic (the text model)
/**
 * The window's state: the tab shown ("photo" or "art"); the tabs with something done since they were last shown; and
 * what each tab made this session, in memory only, newest first, MADE_MAX at most (`made`: {r, prompt, ref, n, kept},
 * the result, the words and the reference picture it was made from, which try at those words it was, and for a sticker
 * the asset it was kept as), with the tries at each tab's words counted (`tries`).
 */
const GENWIN = { tab: "photo", dot: new Set(), made: { photo: [], art: [] }, tries: { photo: new Map(), art: new Map() } };
const MADE_MAX = 12;
/** Result `r`, just made on tab `tab` from `prompt` and `ref`: first in the window's strip, with which try at those words it is. */
function madeNow(tab, r, prompt, ref) {
  const words = prompt.trim(), n = (GENWIN.tries[tab].get(words) || 0) + 1;
  GENWIN.tries[tab].set(words, n);
  GENWIN.made[tab] = [{ r, prompt: words, ref, n }, ...GENWIN.made[tab]].slice(0, MADE_MAX);
}
/** The strip's entry for result `r` of tab `tab`, while it is there. */
const madeOf = (tab, r) => (r && GENWIN.made[tab].find((x) => x.r === r)) || null;
/** What entry `x` was made from and which try it was: 「the words」 · try 2. */
const madeSays = (x) => { const w = x.prompt.replace(/\s+/g, " "); return x.prompt ? t("gen.madeFrom", w.length > 40 ? w.slice(0, 39) + "…" : w, x.n) : t("gen.madeFromRef", x.n); };
/** Shows entry `x` of the strip as the result again, its words and reference picture back in the form, so that Make another makes it again. */
function showMade(tab, x) {
  if (tab === "photo") Object.assign(GEN, { result: x.r, prompt: x.prompt, ref: x.ref, error: "" });
  else Object.assign(AI, { result: x.r, target: x.prompt, image: x.ref, error: "" });
  genWin();
}
/** Discards the result shown on tab `tab`, and takes it out of the strip. */
function dropMade(tab) {
  const r = tab === "photo" ? GEN.result : AI.result;
  GENWIN.made[tab] = GENWIN.made[tab].filter((x) => x.r !== r);
  if (tab === "photo") GEN.result = null; else AI.result = null;
  genWin();
}
/** The words of tab `tab`'s Generate: Make another while the result shown was made from what the form holds. */
function goText(tab) {
  const photo = tab === "photo", x = madeOf(tab, photo ? GEN.result : AI.result);
  return t(x && x.prompt === (photo ? GEN.prompt : AI.target).trim() && x.ref === (photo ? GEN.ref : AI.image) ? "gen.another" : photo ? "gen.go" : "ai.generate");
}
/** The strip of what tab `tab` made this session, `shown` marked: a click shows one as the result again (not while another is being made). */
function madeStrip(tab, shown, busy) {
  const list = GENWIN.made[tab];
  return list.length > 0 && el("div", { class: "gmade" }, el("span", { class: "cap" }, t("gen.made")),
    el("div", { class: "gthumbs" }, list.map((x) => {
      const rec = tab === "photo" && x.r.pid && S.photos.get(x.r.pid), says = madeSays(x);
      return el("button", { class: "gthumb" + (x === shown ? " on" : ""), disabled: busy, title: says, "aria-label": says, onclick: () => showMade(tab, x) },
        tab === "photo" ? el("img", { src: rec ? thumbOf(rec) : x.r.src, alt: "" }) : specThumb(x.r));
    })));
}
/** A sticker or graphic made by AI, small, in its own colours: a thumbnail of the strip. */
function specThumb(spec) {
  const cv = el("canvas", { width: 144, height: 108 }), c = cv.getContext("2d");
  c.translate(72, 54); c.scale(0.48, 0.48); drawSpec(c, spec, null);
  return cv;
}
const genOpen = () => !!$("modal").querySelector(".dlg.genw");
/** Draws the AI generate window again if it is open, and the Assets sheet (what is under way there). */
const genRedraw = () => { if (genOpen()) genWin(); if (onAssetsTab()) renderPanel(); };
/**
 * A generation on tab `tab` is done: shown at once when that tab is open; marked on its tab when the other one is; else
 * a toast, with a way to it when no other window is open (it would take that window's place).
 */
function genDone(tab, error) {
  if (genOpen()) { if (GENWIN.tab !== tab) GENWIN.dot.add(tab); return; }
  const free = $("modal").hidden;
  toast(t(`gen.${error ? "failed" : "ready"}.${tab}`), false, free ? { label: t("gen.see"), run: () => { if ($("modal").hidden) genWin(tab); } } : null);
}
/** The text field being typed in inside `box` (one with a data-k), to give it back its focus and caret once `box` is built again. */
function heldField(box) { const a = document.activeElement; return a && box.contains(a) && a.dataset && a.dataset.k ? { k: a.dataset.k, s: a.selectionStart, e: a.selectionEnd } : null; }
function giveBack(box, h) { const f = h && box.querySelector(`[data-k="${h.k}"]`); if (!f) return; f.focus(); try { f.setSelectionRange(h.s, h.e); } catch (e) { /* not a text field */ } }
/** Who the text model's requests go to, by its address: Anthropic or OpenAI for their own, else the host (a gateway, a local model). */
function aiService(cfg) {
  let host = "";
  try { host = new URL(cfg.baseUrl).host; } catch (e) { /* no address yet */ }
  return /(^|\.)anthropic\.com$/i.test(host) ? "Anthropic" : /(^|\.)openai\.com$/i.test(host) ? "OpenAI" : host || t("ai.styleShort." + cfg.style);
}
/** A picture dropped on the window while AI generate is open: the open tab's reference picture (not while it is making one). */
function genDropped(files) {
  const f = [...files].find((x) => x.type.startsWith("image/")), photo = GENWIN.tab === "photo";
  if (!f || (photo ? GEN.busy || !imageReady(S.imageAi) : AI.busy || !aiReady(S.ai))) return;
  (photo ? pickGenRef : pickReference)(f);
}
/** The marks of the two kinds a sticker is drawn as: a box built in three dimensions, and a flat sticker's starburst. */
const KIND_ICONS = {
  solid: '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/></svg>',
  flat: '<svg viewBox="0 0 40 40" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" aria-hidden="true"><path d="M20 4l4 9 9-4-3 10 9 3-9 4 4 9-10-3-4 9-4-9-10 3 4-9-9-4 9-3-3-10 9 4Z"/></svg>',
};
/**
 * AI generate: across the top its name, the two tabs and what the tab makes. On the left what to make — the words, for
 * a sticker the kind it is drawn as, a picture to go by (picked, or dropped on the window) — then which service and
 * model it goes to and Generate, the window's main button until there is a result. On the right, on a checkerboard,
 * what came back, saying what it was made from and which try it was, with Discard at its corner: a photo, or a sticker
 * twice, in its own colours and in the channel's. Under it the strip of what the tab made this session, to show one
 * again, and the result's actions: add it to the cover (a sticker kept in My vector assets too), or keep a sticker
 * only. A generation goes on with the window shut and waits in it; a toast says when it is done.
 */
function genWin(tab = GENWIN.tab) {
  GENWIN.tab = tab; GENWIN.dot.delete(tab);
  const m = $("modal"), photo = tab === "photo", size = selSize(), held = heldField(m), ch = cat();
  const ready = photo ? imageReady(S.imageAi) : aiReady(S.ai), busy = photo ? GEN.busy : AI.busy;
  const r = ready ? (photo ? GEN.result : AI.result) : null, shown = madeOf(tab, r), error = photo ? GEN.error : AI.error;
  const head = el("div", { class: "xhead ghead" },
    el("h2", {}, t("gen.title")),
    el("div", { class: "seg" }, ["photo", "art"].map((k) => el("button", { class: "btn" + (k === tab ? " on" : "") + (GENWIN.dot.has(k) ? " dot" : ""), onclick: () => genWin(k) }, t("gen.tab." + k)))),
    el("span", { class: "gsub" }, photo ? t("gen.photoSub", caption(size)) : t("gen.artSub")),
    el("button", { class: "x", title: t("close"), "aria-label": t("close"), onclick: closeModal }, "✕"));
  const field = (key, ...kids) => el("div", {}, el("div", { class: "cap" }, t(key)), ...kids);
  const refZone = (ref, onPick, onRemove, refOn) => field("gen.ref", ref
    ? el("div", { class: "gref" }, el("img", { src: ref.url, alt: "" }), el("span", {}, refOn), el("button", { class: "linkbtn", disabled: busy, onclick: onRemove }, t("ai.refRemove")))
    : el("button", { class: "gref empty", disabled: busy, onclick: () => onPick() }, t("gen.refAddLong")));
  // Generate, full width: the main button (in the accent) until a result is shown, whose Add to the cover is then;
  // while it waits it counts the seconds, Stop waiting beside it
  const go = (id, run, cancel, text) => el("div", { class: "ggo" },
    el("button", { id, class: "btn go " + (r ? "cta glassy" : "solid"), disabled: busy, onclick: run }, text),
    busy && el("button", { class: "btn", onclick: cancel }, t("ai.cancel")));
  let form, stage, acts = null;
  if (!ready) {
    form = el("div", { class: "gsetup" }, el("p", {}, t(photo ? "gen.needSetup" : "ai.needSetup")),
      el("button", { class: "btn solid", onclick: () => { closeModal(); S.tab.setup = "ai"; SET_UI.at = photo ? "image" : "text"; setMode("setup"); } }, t(photo ? "rep.goSetup" : "ai.goSetup")));
  } else if (photo) {
    const c = S.imageAi;
    form = [el("div", { class: "gfields" },
        field("gen.what", el("textarea", { class: "tall", value: GEN.prompt, spellcheck: false, maxLength: 2000, disabled: busy, dataset: { k: "gprompt" }, placeholder: t(GEN.ref ? "gen.phRef" : "gen.ph"),
          oninput: (e) => { GEN.prompt = e.target.value; const b = $("gen-go"); if (b && !GEN.busy) b.textContent = goText("photo"); } })),
        refZone(GEN.ref, pickGenRef, () => { GEN.ref = null; genWin(); }, t("gen.refOn"))),
      el("div", { class: "gnote" }, t("gen.hint", t("img.provider." + c.provider), c.model)),
      go("gen-go", generatePhoto, cancelGeneratePhoto, busy ? genBusyText() : goText("photo"))];
    stage = r && el("figure", { class: "gpic" }, el("img", { src: r.src, alt: "" }), el("figcaption", {}, `${r.w} × ${r.h}`));
    acts = r && el("button", { class: "btn solid", onclick: keepGeneratedPhoto }, t("gen.keep"));
  } else {
    const kept = !!(shown && shown.kept && userAssets.has(shown.kept)), setKind = (k) => { S.ai = normalizeAi({ ...S.ai, kind: k }); persistAi(); genWin(); };
    form = [el("div", { class: "gfields" },
        field("gen.what", el("textarea", { value: AI.target, spellcheck: false, maxLength: 300, disabled: busy, dataset: { k: "atarget" }, placeholder: t(AI.image ? "ai.targetPhImage" : "ai.targetPh"),
          oninput: (e) => { AI.target = e.target.value; const b = $("ai-go"); if (b && !AI.busy) b.textContent = goText("art"); }, onkeydown: (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateAsset(); } } })),
        field("gen.kind", el("div", { class: "gkinds" }, AI_KINDS.map((k) => el("button", { class: "gkind" + (S.ai.kind === k ? " on" : ""), "aria-pressed": String(S.ai.kind === k), disabled: busy, onclick: () => setKind(k) },
          el("span", { class: "ico", innerHTML: KIND_ICONS[k] }), el("b", {}, t("ai.kind." + k)), el("small", {}, t("ai.kindHint." + k)))))),
        refZone(AI.image, pickReference, () => { AI.image = null; genWin(); }, t("ai.refOn"))),
      el("div", { class: "gnote" }, t("ai.hint", aiService(S.ai), S.ai.model)),
      go("ai-go", generateAsset, cancelGenerate, busy ? aiBusyText() : goText("art"))];
    const name = r && r.name[getLang()];   // what it is called, and kept as: said on hover
    stage = r && [el("figure", { title: name }, specPreview(r, null), el("figcaption", {}, t("gen.ownColour"))),
      el("figure", { title: name }, specPreview(r, ch.color),el("figcaption", {}, t("gen.channelColour"), el("i", { class: "gdot", style: `background:${ch.color}` }), ch.name || ch.code))];
    acts = r && [el("button", { class: "btn", disabled: kept, onclick: () => keepGenerated() }, t(kept ? "gen.kept" : "ai.keep")), el("button", { class: "btn solid", onclick: () => keepGenerated(true) }, t("gen.place"))];
  }
  const view = el("div", { class: "gstage" + (r && !photo ? " two" : "") },
    stage || el("div", { class: "gempty" + (busy ? " busy" : "") }, !ready ? t("gen.notReady") : busy ? t("gen.working") : error ? el("span", { class: "err" }, t("msg.failed", error)) : t(photo ? "gen.emptyPhoto" : "gen.emptyArt")),
    shown && el("span", { class: "gsays" }, madeSays(shown)),
    r && el("button", { class: "btn gdiscard", onclick: () => dropMade(tab) }, t("ai.discard")));
  const strip = ready && madeStrip(tab, shown, busy);
  m.replaceChildren(el("div", { class: "dlg genw" }, head,
    el("div", { class: "genbody" }, el("div", { class: "gform" }, form),
      el("div", { class: "gresult" }, view, (strip || acts) && el("div", { class: "gfoot" }, strip, acts && el("div", { class: "gacts" }, acts))))));
  m.hidden = false; m.onDismiss = closeModal;
  giveBack(m, held);
}
/** The image model's settings: Settings → AI → Image model. */
function imageAiPane() {
  const c = S.imageAi, d = IMAGE_DEFAULTS[c.provider];
  const ep = el("div", { class: "hint", style: "word-break:break-all" }, t("ai.endpoint", imageEndpoint(c)));
  const testBtn = el("button", { class: "btn", disabled: !imageReady(c), onclick: () => test() }, t("ai.test"));
  const set = (k, v, redraw = false) => {
    S.imageAi = normalizeImageAi({ ...S.imageAi, [k]: v }); REP.test = null; persistImageAi(); aiLightsSync();
    if (redraw) return renderPanel();
    ep.textContent = t("ai.endpoint", imageEndpoint(S.imageAi)); testBtn.disabled = !imageReady(S.imageAi);
  };
  const test = async () => {
    REP.test = { ok: null, text: t("ai.testing") }; renderPanel();
    try { REP.test = await checkImageAi(S.imageAi); } catch (e) { REP.test = { ok: false, text: t("msg.failed", String(e && e.message ? e.message : e)) }; }
    refreshAiPage();
  };
  const field = (key, k, props = {}, under = null) => el("div", {}, cap(key), textInput(c[k], (v) => set(k, v), props), under);
  return [
    el("div", {}, cap("img.provider"), select(IMAGE_PROVIDERS.map((k) => [k, t("img.provider." + k)]), c.provider, (v) => set("provider", v, true))),
    field("ai.baseUrl", "baseUrl", { placeholder: d.baseUrl }, ep),
    field("ai.token", "token", { type: "password", placeholder: t("ai.tokenPh"), autocomplete: "off" }),
    field("ai.model", "model", { placeholder: t("img.modelPh", d.model) }, el("div", { class: "hint" }, t("img.modelHint." + c.provider))),
    el("div", {}, cap("ai.timeout"), el("input", { type: "number", min: 30, max: 1800, step: 30, value: c.timeout, onchange: (e) => set("timeout", e.target.value, true) })),
    field("ai.proxy", "proxy", { placeholder: "http://127.0.0.1:7890" }),
    el("div", { class: "aifoot" }, testBtn, testLine(REP.test), info(t("img.testHint"))),
    el("div", { class: "hint" }, t("img.privacy")),
  ];
}
const AI = { target: "", busy: false, error: "", result: null, test: "", job: 0, since: 0, attempt: 1, image: null };   // image: {mime, data, url} of a reference picture
const AI_RETRIES = 3;                      // extra attempts when a reply does not follow the format
/** Sends one prompt to the configured endpoint and returns {text, truncated}. Throws with the provider's message. Its light (aiTracked) is amber meanwhile, and red should it fail. */
function aiCall(cfg, system, user) { return aiTracked("text", cfg, () => aiAsk(cfg, system, user)); }
async function aiAsk(cfg, system, user) {
  const req = buildRequest(cfg, system, user), body = JSON.stringify(req.body);
  const reply = CAN.relay
    ? await invoke("ai_request", { url: req.url, headers: Object.entries(req.headers), body, proxy: cfg.proxy || null, timeout: cfg.timeout })
        .catch((e) => { throw new Error(/timed out/i.test(String(e)) ? t("ai.timedOut", cfg.timeout) : String(e)); })
    : await fetch(req.url, { method: "POST", headers: req.headers, body, signal: AbortSignal.timeout(cfg.timeout * 1000) }).then(async (r) => ({ status: r.status, text: await r.text() }));
  const out = readReply(cfg.style, reply.status, reply.text);
  if (out.error) throw new Error(out.error);
  return out;
}
/**
 * Asks the model for an asset of `target` and returns the validated spec. A reply that does not
 * follow the format is sent back with what was wrong, up to AI_RETRIES times; connection errors
 * and cut-off replies are not retried, since asking again would not help.
 * `onAttempt(n)` is told which attempt is running; `stillWanted()` lets the caller give up.
 */
async function requestSpec(cfg, target, onAttempt = () => null, stillWanted = () => true, image = null) {
  const { system, user } = buildPrompt(target, cfg.notes, { kind: cfg.kind, style: S.profile.style.look, image: !!image });
  const turns = [{ role: "user", content: image ? withImage(cfg.style, user, image) : user }];
  for (let attempt = 1; ; attempt++) {
    onAttempt(attempt);
    const out = await aiCall(cfg, system, turns), r = parseSpec(out.text);
    if (!r.error) return r.spec;
    if (out.truncated) throw new Error(t("ai.truncated"));
    if (attempt > AI_RETRIES || !stillWanted()) throw new Error(t("ai.badSpec", r.error, attempt));
    turns.push({ role: "assistant", content: out.text.slice(0, 12000) }, { role: "user", content: retryMessage(r.error) });
  }
}
const onAssetsTab = () => S.mode === "edit" && !sheetHidden() && S.tab.edit === "assets";
async function generateAsset() {
  const target = AI.target.trim(), image = AI.image;
  if ((!target && !image) || AI.busy) return;   // a picture alone is enough to go on
  const job = ++AI.job;
  Object.assign(AI, { busy: true, error: "", result: null, since: Date.now(), attempt: 1 });
  genRedraw();
  const tick = setInterval(() => { const b = document.getElementById("ai-go"); if (b && AI.busy) b.textContent = aiBusyText(); }, 1000);
  let result = null, error = "";
  try { result = await requestSpec(S.ai, target, (n) => { if (job === AI.job) AI.attempt = n; }, () => job === AI.job, image); }
  catch (e) { error = String(e && e.message ? e.message : e); if (image && /^HTTP 4\d\d/.test(error)) error += " " + t("ai.noVision"); }
  clearInterval(tick);
  if (job !== AI.job) return;                       // cancelled meanwhile: the late answer is dropped
  Object.assign(AI, { busy: false, result, error });
  if (result) madeNow("art", result, target, image);
  genDone("art", error);
  genRedraw();
}
/** Stops waiting for the reply. The request itself cannot be recalled, so the provider may still bill it. */
function cancelGenerate() { AI.job++; Object.assign(AI, { busy: false, error: "", result: null }); genRedraw(); }
const aiBusyText = () => t("ai.busy", Math.max(0, Math.round((Date.now() - AI.since) / 1000))) + (AI.attempt > 1 ? t("ai.attempt", AI.attempt) : "");
/**
 * Keeps the asset made in My vector assets; `place`: and puts it on the cover. One kept already (shown again from the
 * window's strip of what was made) is not kept a second time: that one is put on the cover.
 */
async function keepGenerated(place = false) {
  const spec = AI.result, m = madeOf("art", spec);
  if (!spec) return;
  let a = m && m.kept && userAssets.get(m.kept);
  if (!a) {
    a = putSpecAsset("a" + uid(), spec.name[getLang()], spec);
    await saveAssetRecord(a).catch(fail);
    if (m) m.kept = a.id;
  }
  AI.result = null;
  if (place) { closeModal(); addAsset({ kind: "user", id: a.id }); if (onAssetsTab()) renderPanel(); return; }
  toast(t("ai.saved", a.name));
  genRedraw();
}
/**
 * Takes a picture as the reference for the next generation, `f` (one dropped) or one picked. It is scaled down to at
 * most 768 px and stored as JPEG: enough for a model to see what the thing is, and a fraction of the upload.
 */
async function pickReference(f = null) {
  f = f || await pickFile("image/png,image/jpeg,image/webp");
  if (!f) return;
  const im = await loadImage(await readAs(f, "readAsDataURL"));
  if (!im) return toast(t("msg.badFile"));
  const k = Math.min(1, 768 / Math.max(im.naturalWidth, im.naturalHeight)), cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(im.naturalWidth * k)); cv.height = Math.max(1, Math.round(im.naturalHeight * k));
  const x = cv.getContext("2d");
  x.fillStyle = "#ffffff"; x.fillRect(0, 0, cv.width, cv.height);   // JPEG has no transparency: a cut-out goes on white
  x.imageSmoothingQuality = "high"; x.drawImage(im, 0, 0, cv.width, cv.height);
  const url = cv.toDataURL("image/jpeg", 0.85);
  AI.image = { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1), url };
  genRedraw();
}
/** A sticker or graphic made by AI, large on AI generate's checkerboard (at twice its size, for a sharp picture): in its own colours, or in `tint`. */
function specPreview(spec, tint) {
  const cv = el("canvas", { width: 600, height: 460 }), x = cv.getContext("2d");
  x.translate(300, 230); x.scale(2.1, 2.1);
  drawSpec(x, spec, tint);
  return cv;
}
/** Assets → AI stickers: the way to AI generate's sticker tab (with what is under way there). */
function aiSection() {
  return el("button", { class: "scard aientry", onclick: () => genWin("art") },
    el("span", { class: "grow" }, el("b", {}, t("ai.title")), el("small", {}, AI.busy ? t("gen.working") : AI.result ? t("gen.waiting") : t("ai.card.textSub"))), el("span", { class: "more" }, t("gen.openShort")));
}
/** A connection test's outcome, in green when it worked and red when it did not. */
const testLine = (r) => r && el("div", { class: `hint ${r.ok === true ? "ok" : r.ok === false ? "err" : ""}`, style: "margin-top:-8px;word-break:break-word" }, r.text);
// ---------- the AI services' lights: grey, not set up; green, set up and its last request or connection test did not
// fail; amber, a request under way; red, its last request or test failed, until one goes through or its settings
// change. Lit by the requests the user makes, none made to light it; kept for this session only, nothing saved. Shown
// in the ⋯ menu's AI (all three as one), beside AI in Settings' nav, and on each card's head in Settings → AI.
const AI_SERVICES = ["text", "image", "cut"];
/** For each service: how many of its requests are under way; the settings (aiSig) its last one failed with, and those one went through with. */
const AI_LIGHT = Object.fromEntries(AI_SERVICES.map((k) => [k, { busy: 0, failed: "", worked: "" }]));
/**
 * The settings a request of service k is sent by (cfg, else those in force), as a string to compare: how it is sent,
 * not what is asked for (the text model's notes and kind, the image model's style and notes); the cut-out's way.
 */
function aiSig(k, cfg) {
  if (k === "cut") return cfg || cutEngine();
  const c = cfg || (k === "text" ? S.ai : S.imageAi);
  return JSON.stringify(k === "text" ? [c.style, c.baseUrl, c.token, c.model, c.auth, c.maxTokens, c.timeout, c.proxy] : [c.provider, c.baseUrl, c.token, c.model, c.timeout, c.proxy]);
}
const aiSetUp = (k) => (k === "text" ? aiReady(S.ai) : k === "image" ? imageReady(S.imageAi) : canCut() && cutReady());
/** Service k's light: "off", "busy", "err" or "ok". What went before with other settings than these no longer counts. */
function aiLight(k) {
  const L = AI_LIGHT[k], sig = aiSig(k);
  if (L.failed !== sig) L.failed = "";
  if (L.worked !== sig) L.worked = "";
  return !aiSetUp(k) ? "off" : L.busy ? "busy" : L.failed ? "err" : "ok";
}
/** What service k's light says: green is Connected once a request went through with these settings, Ready till then. */
function aiSays(k) {
  const s = aiLight(k);
  return t(s === "ok" ? (AI_LIGHT[k].worked ? "ai.light.ok" : "ai.light.ready") : "ai.light." + s);
}
/** The three lights as one, {s, say}: amber while any works, red when any failed (naming it, when one), green when any is set up (naming those not), else grey. */
function aiAll() {
  const s = Object.fromEntries(AI_SERVICES.map((k) => [k, aiLight(k)])), of = (v) => AI_SERVICES.filter((k) => s[k] === v);
  const names = (ks) => ks.map((k) => t("ai.card." + k)).join(t("ai.light.and")), bad = of("err"), off = of("off");
  if (of("busy").length) return { s: "busy", say: t("ai.light.busy") };
  if (bad.length) return { s: "err", say: bad.length === 1 ? t("ai.light.errOf", names(bad)) : t("ai.light.err") };
  if (off.length === AI_SERVICES.length) return { s: "off", say: t("ai.light.off") };
  const said = t(AI_SERVICES.some((k) => s[k] === "ok" && AI_LIGHT[k].worked) ? "ai.light.ok" : "ai.light.ready");
  return { s: "ok", say: off.length ? `${said} · ${t("ai.light.notSetOf", names(off))}` : said };
}
const aiDot = (s, say = null) => el("i", { class: "aidot " + s, title: say, role: say ? "img" : null, "aria-label": say, "aria-hidden": say ? null : "true" });
/** A card's head in Settings → AI: its light, and the model (the cut-out's way) when green, else what the light says. */
function aiPill(k) {
  const s = aiLight(k), say = aiSays(k);
  const what = k === "text" ? S.ai.model : k === "image" ? S.imageAi.model || IMAGE_DEFAULTS[S.imageAi.provider].model : t("cutset.engine." + cutEngine()).split(/[（(]/)[0].trim();
  return el("span", { class: "state " + s, "data-ai": k, title: s === "ok" ? `${say} · ${what}` : null }, aiDot(s), el("span", {}, s === "ok" ? what : s === "off" ? t("ai.notSet") : say));
}
/** Each place a light is shown, built again by aiLightsSync. */
const AI_SHOW = {
  text: () => aiPill("text"), image: () => aiPill("image"), cut: () => aiPill("cut"),
  menu: () => { const a = aiAll(); return el("span", { class: "light", "data-ai": "menu" }, aiDot(a.s), el("span", {}, a.say)); },
  nav: () => { const a = aiAll(); return el("span", { class: "light", "data-ai": "nav" }, aiDot(a.s, a.say)); },
};
/** The lights shown, drawn again as they now are (a request begun or ended, a setting typed in), and nothing else. */
function aiLightsSync() { for (const n of document.querySelectorAll("[data-ai]")) n.replaceWith(AI_SHOW[n.dataset.ai]()); }
/**
 * Runs `run`, a request of service k sent with settings cfg, its light amber meanwhile; then, if those are still the
 * settings in force, lit by how it went: `failed(out, err)` says whether it failed (by default, when it threw). A
 * request sent with other settings than the user's (the self-test's) leaves the light alone.
 */
async function aiTracked(k, cfg, run, failed = (out, err) => !!err) {
  const sig = aiSig(k, cfg), L = AI_LIGHT[k];
  if (sig !== aiSig(k) || SELFTESTING) return run();   // a request with other settings, or the self-test's, says nothing of the user's
  let out, err = null;
  L.busy++; aiLightsSync();
  try { return (out = await run()); }
  catch (e) { err = e; throw e; }
  finally {
    L.busy--;
    const verdict = aiSig(k) === sig ? failed(out, err) : null;   // null: nothing learnt either way
    if (verdict === true) L.failed = sig; else if (verdict === false) { L.failed = ""; L.worked = sig; }
    aiLightsSync();
  }
}
/**
 * Settings → AI, a card each: the text model (assets from a sentence), the image model (photos repainted or made) and
 * the cut-out (done on this computer), each head with its light, saying the model it is set to (the cut-out's way)
 * or what the light means.
 */
function aiTab() {
  const card = (k, tip, kids, aside) => el("section", { class: "scard aicard", id: "set-" + k },
    el("div", { class: "aih" }, el("div", { class: "grow" }, el("b", {}, t("ai.card." + k)), el("small", {}, t("ai.card." + k + "Sub"))), tip && info(tip), aside),
    el("div", { class: "aib" }, kids));
  return [
    el("div", { class: "sh" }, el("b", {}, t("tab.ai")), el("span", {}, t("ai.pageSub"))),
    card("text", t("ai.intro"), textAiPane(), aiPill("text")),
    card("image", t("img.intro"), imageAiPane(), aiPill("image")),
    card("cut", t("cutset.intro"), cutPane(), [aiPill("cut"), CAN.cut && CAN.folders && el("button", { class: "linkbtn", onclick: () => invoke("reveal_data_dir", { dir: "models" }).catch(fail) }, t("cutset.folder"))]),
  ];
}
// ---------- Settings → AI → Cut-out: the way of cutting out, and the BiRefNet models
const CUTDL = { id: "", done: 0, total: 0, error: "", confirmDrop: "" };   // the download running, if any
const mb = (n) => Math.round(n / 1048576);
if (HOST === "tauri" && globalThis.__TAURI__.event) globalThis.__TAURI__.event.listen("cut-model-progress", (e) => {
  Object.assign(CUTDL, { done: e.payload.done, total: e.payload.total });
  const bar = document.getElementById("cutdl-" + e.payload.id);
  if (bar) bar.textContent = t("cutset.progress", Math.floor((100 * e.payload.done) / Math.max(1, e.payload.total)), mb(e.payload.done), mb(e.payload.total));
});
/** Draws Settings → AI again once something there finished (a test, a download), but not under a field being typed in: once it is left. */
function refreshAiPage() {
  if (!(S.mode === "setup" && S.tab.setup === "ai")) return;
  const a = document.activeElement;
  if (a && $("setpanel").contains(a) && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" && !/^(radio|checkbox|range)$/.test(a.type))) return later("aipage", 600, refreshAiPage);
  renderPanel();
}
async function refreshCutModels() { S.cutModels = CAN.cut ? await invoke("cut_models").catch(() => []) : []; }
async function downloadModel(id) {
  if (CUTDL.id) return;
  Object.assign(CUTDL, { id, done: 0, total: 0, error: "" }); renderPanel();
  try { await invoke("cut_model_download", { id, proxy: S.settings.cutProxy || null }); }
  catch (e) { const msg = String(e && e.message ? e.message : e); CUTDL.error = /cancelled/.test(msg) ? "" : t("msg.failed", msg); }
  CUTDL.id = ""; await refreshCutModels(); aiLightsSync();
  if (S.cutModels.some((m) => m.id === id && m.have)) { CUT.needModel = false; CUT.error = ""; toast(t("cutset.done", t("cutset.engine." + id))); }
  refreshAiPage();
}
async function dropModel(id) {
  if (CUTDL.confirmDrop !== id) { CUTDL.confirmDrop = id; return renderPanel(); }
  CUTDL.confirmDrop = "";
  await invoke("cut_model_delete", { id }).catch(fail);
  await refreshCutModels(); renderPanel();
}
function cutPane() {
  if (!CAN.cut) return [el("div", { class: "hint", style: "margin:0" }, t("cutset.needsApp"))];
  const engines = [isMac && "vision", "birefnet-lite", "birefnet"].filter(Boolean), now = cutEngine();
  const setting = (k, v, redraw) => { S.settings[k] = v; persistSettings(); if (redraw) renderPanel(); };
  const row = (k) => {
    const m = S.cutModels.find((x) => x.id === k), busy = !!m && CUTDL.id === k;
    return el("div", { class: "cutrow" + (now === k ? " on" : "") },
      el("label", {}, el("input", { type: "radio", name: "cutway", checked: now === k, onchange: () => setting("cutEngine", k, true) }),
        el("span", {}, el("b", {}, t("cutset.engine." + k)),
          el("small", { id: busy ? "cutdl-" + k : null }, k === "vision" ? t("cutset.builtIn") : busy ? t("cutset.starting") : !m ? t("cutset.unknown") : t(m.have ? "cutset.have" : "cutset.missing", mb(m.bytes))))),
      k !== "vision" && (busy ? el("button", { class: "btn", onclick: () => invoke("cut_model_cancel").catch(fail) }, t("cutset.cancel"))
        : m && m.have ? el("button", { class: "linkbtn", onclick: () => dropModel(k) }, t(CUTDL.confirmDrop === k ? "cutset.dropSure" : "cutset.drop"))
        : el("button", { class: "btn", disabled: !!CUTDL.id, onclick: () => downloadModel(k) }, t("cutset.download"))));
  };
  return [
    el("div", { class: "cutrows" }, engines.map(row)),
    !cutReady(now) && el("div", { class: "hint err" }, t("cutset.wayMissing")),
    CUTDL.error && el("div", { class: "hint err" }, CUTDL.error),
    el("div", { class: "hint" }, t("cutset.speed")),
    el("div", {}, el("label", { class: "cap" }, t("cutset.proxy"), " ", info(t("cutset.proxyHint"))), textInput(S.settings.cutProxy, (v) => setting("cutProxy", v.trim()), { placeholder: "http://127.0.0.1:7890" })),
    el("div", { class: "hint" }, t("cutset.licence")),
  ];
}
function textAiPane() {
  const c = S.ai, ph = AI_PLACEHOLDER[c.style];
  const where = () => (aiReady(S.ai) ? t("ai.endpoint", endpoint(S.ai)) : "");
  const ep = el("div", { class: "hint", style: "word-break:break-all" }, where());
  const testBtn = el("button", { class: "btn", disabled: !aiReady(c), onclick: () => test() }, t("ai.test"));
  const set = (k, v, redraw = false) => {
    S.ai = normalizeAi({ ...S.ai, [k]: v }); AI.test = ""; persistAi(); aiLightsSync();
    if (redraw) return renderPanel();
    ep.textContent = where(); testBtn.disabled = !aiReady(S.ai);       // typing must not rebuild the form
  };
  const field = (key, k, props = {}, under = null) => el("div", {}, cap(key), textInput(c[k], (v) => set(k, v), props), under);
  const test = async () => {
    AI.test = { ok: null, text: t("ai.testing") }; renderPanel();
    try { const out = await aiCall(S.ai, "Reply with the single word OK.", "ping"); AI.test = { ok: true, text: t("ai.testOk", out.text.trim().slice(0, 60)) }; }
    catch (e) { AI.test = { ok: false, text: t("msg.failed", String(e && e.message ? e.message : e)) }; }
    refreshAiPage();
  };
  return [
    el("div", {}, cap("ai.style"), el("div", { class: "seg" }, AI_STYLES.map((k) => el("button", { class: "btn" + (c.style === k ? " on" : ""), title: t("ai.style." + k), onclick: () => set("style", k, true) }, t("ai.styleShort." + k))))),
    field("ai.baseUrl", "baseUrl", { placeholder: ph.baseUrl }, ep),
    field("ai.token", "token", { type: "password", placeholder: t("ai.tokenPh"), autocomplete: "off" }),
    field("ai.model", "model", { placeholder: t("ai.modelPh") }),
    c.style === "anthropic" && [
      el("div", {}, cap("ai.auth"), select([["key", t("ai.auth.key")], ["bearer", t("ai.auth.bearer")]], c.auth, (v) => set("auth", v))),
      el("div", {}, cap("ai.maxTokens"), el("input", { type: "number", min: 512, max: 64000, step: 256, value: c.maxTokens, onchange: (e) => set("maxTokens", e.target.value, true) })),
    ],
    el("div", {}, el("label", { class: "cap" }, t("ai.timeout"), " ", info(t("ai.timeoutHint"))), el("input", { type: "number", min: 30, max: 1800, step: 30, value: c.timeout, onchange: (e) => set("timeout", e.target.value, true) })),
    field("ai.proxy", "proxy", { placeholder: "http://127.0.0.1:7890" }),
    el("div", { class: "wide" }, cap("ai.notes"), el("textarea", { value: c.notes, spellcheck: false, style: "height:84px;font-size:14px", placeholder: t("ai.notesPh"), oninput: (e) => set("notes", e.target.value) })),
    el("div", { class: "aifoot" }, testBtn, testLine(AI.test)),
    el("div", { class: "hint" }, t("ai.privacy")),
  ];
}

/** Stores an image in the library (memory + disk). Returns its id, or null if unreadable. */
async function adoptAsset(name, src, id = assetIdFor(src)) {
  if (userAssets.has(id)) return id;
  const a = await putUserAsset(id, name, src);
  if (!a) return null;
  await saveAssetRecord(a).catch(fail);
  return id;
}
function removeAsset(id) {
  const inUse = [...S.profiles.flatMap((p) => usedUserAssets(p, null)), ...usedUserAssets(null, S.cover)].includes(id);
  if (inUse && !confirm(t("msg.assetInUse"))) return;
  userAssets.delete(id);
  deleteAssetRecord(id).catch(fail);
  touch({ panel: true, side: true });
}

/**
 * The template and its adjustments on style `st`, the profile's, in the Layout sheet (a layout preset's editor has none:
 * its colour block is dragged, see layoutEditor): the template, how much the colour panel takes, how its edge leans,
 * the title's box, which half goes first, and the way back to the template's defaults (templateDefault in layout.js).
 * `at` ({w, h, parts}): the size shown, in virtual units, and which parts that take room its cover has (see partsOf in
 * render.js), where the block's sliders start from (the layout as it would be drawn there).
 * `to`: what they change — null, the style's own template and adjustments, which every size without a layout of its own
 * follows; else {key, keys}, the layout size `key` is drawn in, put on each size of `keys` as their own (see layoutOf
 * and setLayoutOf in layout.js; a template chosen there starts from the adjustments the style keeps for it, else from
 * its defaults).
 * `changed(again)` after each change: `again`, the controls are to be built anew (another template's, the swap
 * named the other way); else a slider is on its way.
 */
function templateControls(st, at, changed, to = null) {
  const a = layoutAdjuster(st, at, changed, to), { tpl, adj, put, set } = a;
  const split = tpl === "split", byDefault = templateDefault(tpl, orientOfKey(S.sel));   // what the template has by default (the canvas's orientation's, where that is its)
  return [
    select(["stack", "split", "banner"].map((k) => [k, t("tpl." + k)]), tpl, (v) => put(v, (st.layoutAdjust || {})[v] || templateDefault(v, orientOfKey(S.sel)), true)),   // the adjustments' sliders follow the template chosen (none kept for it: its defaults)
    el("div", { style: "margin-top:14px" }, cap("style.layout")),
    blockSliders(a),
    slider2(t("style.layTitleW"), LAYOUT_LIMITS.tw[0], LAYOUT_LIMITS.tw[1], 0.01, adj.tw ?? 1, (v) => set("tw", v)),
    slider2(t("style.layTitleH"), LAYOUT_LIMITS.th[0], LAYOUT_LIMITS.th[1], 0.01, adj.th ?? 1, (v) => set("th", v)),
    el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: !!adj.flip, onchange: (e) => set("flip", e.target.checked, true) }), el("span", {}, t(split ? "style.layFlipSplit" : "style.layFlipStack"))),
    el("button", { class: "btn wide", style: "margin-top:10px", disabled: sameLayout({ template: tpl, adjust: adj }, { template: tpl, adjust: byDefault }), onclick: () => put(tpl, byDefault, true) }, t("style.layReset")),
  ];
}
/**
 * What templateControls changes, for the colour block's own sliders too (blockSection): the template and adjustments
 * `to` reaches (`tpl`, `adj`), where the block is drawn with them at `at` (`now`: {size, slant}, see layoutValues), and
 * the way to change them — put(template, adjust, again) puts a layout there; set(key, value, again) one adjustment.
 */
function layoutAdjuster(st, at, changed, to = null) {
  const lay = () => (to ? layoutOf(st, to.key) : { template: st.template, adjust: (st.layoutAdjust || {})[st.template] || {} });
  const { template: tpl, adjust: adj } = lay();
  const now = at ? layoutValues(coverLayout(LOOKS[st.look] || LOOKS.cel, { template: tpl, adjust: adj }, at.w, at.h, at.parts), at.w, at.h) : { size: 0.3, slant: 0 };
  const put = (template, adjust, again) => { setLayoutOf(st, to && to.keys, { template, adjust }); changed(again); };
  const set = (k, v, again = false) => {
    const a = { ...lay().adjust };
    // the block's height and lean go together: one set alone would put the other back to the template's,
    // undoing what the standards made of it (see meetStandards), so the first takes the other as it is now
    if ((k === "size" || k === "slant") && a.size == null && a.slant == null) Object.assign(a, { size: now.size, slant: now.slant });
    put(tpl, { ...a, [k]: v }, again);
  };
  return { tpl, adj, now, put, set };
}
/** The colour block's two sliders, of layoutAdjuster's `a`: how much of the canvas it takes (the panel's width for Split, the band's height else), and how its edge leans. */
const blockSliders = (a) => [
  slider2(t(a.tpl === "split" ? "style.laySide" : "style.layBand"), LAYOUT_LIMITS.size[0], LAYOUT_LIMITS.size[1], 0.01, a.adj.size ?? a.now.size, (v) => a.set("size", v)),
  slider2(t("style.laySlant"), LAYOUT_LIMITS.slant[0], LAYOUT_LIMITS.slant[1], 0.005, a.adj.slant ?? a.now.slant, (v) => a.set("slant", v)),
];
/**
 * The size on the canvas as templateControls wants it: its virtual canvas, and which parts that take room the cover has
 * there — as it is drawn there (coverAt in render.js), a part kept to other sizes left out, so the sliders start from
 * the layout on the canvas.
 */
const shownAt = () => { const z = selSize(), [w, h] = virtualSize(z.w, z.h); return { w, h, parts: partsOf(coverAt(S.cover, S.sel), cat()) }; };
/**
 * The Layout sheet's template and its adjustments, one box, changed where the scope under the canvas says: the
 * profile's, which every size without a layout of its own follows; each size facing the canvas's way, as their own; or
 * the canvas's size alone. A size with a layout of its own
 * says so, with the way back to following the profile's (the strip under the canvas marks such sizes); "Wide split,
 * tall stacked, square banner" lays every size out in its orientation's default layout at once.
 */
function layoutBox() {
  const st = S.profile.style, at = layoutScope(() => touch({ profile: true, panel: true }));
  return el("div", { class: "box" }, capInfo("style.template", t("style.layHint")),
    el("div", { class: "hint", style: "margin:0 0 10px" }, at.says, " ", t("style.scopeWhere")),
    at.own,
    templateControls(st, shownAt(), (again) => { if (!again) return draftTouch({ profile: true }); touch({ profile: true }); later("laybox", 60, renderPanel); }, at.to),
    el("button", { class: "btn wide", style: "margin-top:8px", title: t("style.byOrientTip"), onclick: byOrient }, t("style.byOrient")));
}
/**
 * Where a change of the layout lands, as the scope under the canvas says (see layoutBox): `to`, what templateControls
 * and layoutAdjuster take (null: the profile's own); `says`, which sizes, in a sentence; `own`, while the size on the
 * canvas has a layout of its own, a line saying so with Follow again, after which `followed()` is called.
 */
function layoutScope(followed) {
  const st = S.profile.style, key = S.sel, keys = scopeKeys(), z = selSize();
  const reach = keys ? keys.map((k) => { const s = S.profile.sizes.find((x) => sizeKey(x) === k); return s ? ratioText(s.w, s.h) : k; }).join(" · ") : "";
  return { to: keys && { key, keys }, says: t("style.layTo." + S.settings.scope, reach),
    own: ownLayout(st, key) && el("div", { class: "layown" }, el("span", {}, t(keys ? "style.own" : "style.ownAll", ratioText(z.w, z.h))),
      el("button", { class: "linkbtn", title: t("style.followTip"), onclick: () => { followLayout(st, key); followed(); } }, t("style.follow"))) };
}
/**
 * The colour block's properties: where it lies (Block position: a band along the foot, a panel at the side or a slim
 * banner — the template), how much of the canvas it takes and how its edge leans (the template's own sliders,
 * blockSliders), changed where the scope under the canvas says, as the Layout sheet's template box changes them
 * (layoutScope); a position picked is one step of undo, a slider dragged draws the cover as a draft (draftTouch), one
 * step of undo. Then Block by orientation (byOrient), every size at once.
 */
function blockSection() {
  const st = S.profile.style, at = layoutScope(() => touch({ profile: true, side: true }));
  const a = layoutAdjuster(st, shownAt(), (again) => (again ? touch({ profile: true, side: true }) : draftTouch({ profile: true })), at.to);
  // a position picked: its own step of undo, the sliders following it (from what the style keeps for it, else its defaults), as templateControls's list does
  const place = (v) => { if (v === a.tpl) return; clearTimeout(timers.hist); commitHistory(); a.put(v, (st.layoutAdjust || {})[v] || templateDefault(v, orientOfKey(S.sel)), true); commitHistory(); };
  return psec("props.sec.block", [
    el("div", {}, cap("props.blockAt"), el("div", { class: "seg wide blockat" }, ["stack", "split", "banner"].map((k) =>
      el("button", { class: "btn" + (a.tpl === k ? " on" : ""), title: t("tpl." + k + "Tip"), "aria-pressed": String(a.tpl === k), onclick: () => place(k) }, t("tpl." + k))))),
    blockSliders(a), at.own,
    el("div", {}, el("button", { class: "btn wide", title: t("style.byOrientTip"), onclick: byOrient }, t("style.byOrient")), el("div", { class: "hint" }, t("style.byOrientHint"))),
  ], `${t("props.blockHint")} ${at.says} ${t("style.scopeWhere")}`);
}
/** Block by orientation ("wide a side panel, tall a band, square a slim banner"): every size in its orientation's default layout (layoutByOrient in layout.js); one step of undo. */
function byOrient() {
  clearTimeout(timers.hist); commitHistory();
  layoutByOrient(S.profile.style, S.profile.sizes);
  touch({ profile: true, panel: true, side: true });
  commitHistory();   // its own step
  toast(t("style.byOrientDone"));
}
/**
 * Under the slider of the look's figure (see `art` in style.js): what the figure is drawn from — the
 * channel's graphic, or a graphic picked or uploaded in its place for this look — and the way back.
 */
function lookArtRow() {
  const look = S.profile.style.look, c = cat(), ref = (S.profile.style.lookArt || {})[look], own = !!ref && assetExists(ref), channel = c.graphic.kind === "none" ? null : c.graphic;
  // the profile as it is when the pick is made (an undo while the picker is open puts another in its place)
  const set = (r) => { const arts = (S.profile.style.lookArt = S.profile.style.lookArt || {}); if (r) arts[look] = { kind: r.kind, id: r.id }; else delete arts[look]; touch({ profile: true, panel: true }); };
  const picker = () => graphicPicker(own ? ref : null, c.color, set, { title: t("style.artPick"), first: { label: t(channel ? "style.artChannel" : "style.artNone"), ref: channel, cap: t("style.artDefault") }, upload: true, hint: t("style.artHint"), subjects: true });
  return [
    el("div", { class: "sl", style: "grid-template-columns:84px 1fr" }, el("span", {}, t("style.art")),
      el("button", { class: "gpick", style: "padding:2px 8px 2px 2px;font-size:13px;min-width:0", title: t("style.artTip"), onclick: picker },
        graphicThumb(own ? ref : channel, c.color, 28), el("span", {}, own ? assetName(ref, getLang()) : t(channel ? "style.artChannel" : "style.artNone")), el("span", { class: "more" }, t("cat.pick")))),
    ref && el("div", { class: "artback" }, el("button", { class: "linkbtn", onclick: () => set(null) }, t("style.artBack"))),
  ];
}
// ---------- Surprise me's chances, seen and set by hand: in their own window (from Surprise me's, and the Look sheet), and for the current look under its sliders
const chancePct = (v) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;   // a chance as the panel shows it
/**
 * A group of Surprise me's chances of which one option is dealt, adding up to 100%, as one bar split into a segment
 * an option, as wide as its chance, with its name and share on it where they fit (and under the pointer). The white
 * divider between two neighbours, dragged or moved by the arrow keys once it has the focus, moves share from one to the
 * other, the rest staying as they are (moveShare in deal.js). Above the bar its name (an ⓘ with `tip`), Even out and
 * Restore (`reset()`, when given: the rule's back). `group`: {option: chance}; `names`: [[option, label]];
 * `save(group)` keeps it as it now is. A long group (`fold`: how many it shows) shows its likeliest options, then the
 * rest as one segment, their sum, until unfolded (ODDS_UI.open, by `key`): every option on the bar then, the likeliest
 * still first, and each named under it with its share. `foot`: more under it; `id`: its own.
 */
function oddsGroup(title, names, group, save, opts = {}) {
  const { tip = "", reset = null, key = "", fold = 0, foot = null, id = null } = opts;
  let now = { ...group };
  const long = fold > 0 && names.length > fold + 1, open = long && ODDS_UI.open.has(key), named = new Map(names);
  const top = long ? [...names].sort((x, y) => (now[y[0]] || 0) - (now[x[0]] || 0)).slice(0, fold) : names, rest = names.filter((n) => !top.includes(n));
  const keys = [...top, ...(open ? rest : [])].map(([k]) => [k]).concat(long && !open ? [rest.map(([k]) => k)] : []);
  const share = (p, g = now) => p.keys.reduce((s, k) => s + (g[k] || 0), 0);
  const parts = keys.map((ks, i) => {
    const name = ks.length > 1 ? t("odds.rest", ks.length) : named.get(ks[0]), tone = ks.length > 1 ? "t4" : ["t1", "t3", "t2"][i % 3], b = el("b", {}, name), em = el("em", {}), out = el("em", {});
    return { keys: ks, name, b, em, out, seg: el("span", { class: "oseg " + tone }, el("span", {}, b, em)), item: open && el("span", {}, el("i", { class: tone }), name, out) };
  });
  const cuts = parts.slice(1).map((p, j) => el("i", { class: "ocut", role: "separator", tabindex: 0, "aria-orientation": "vertical", "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": t("odds.cut", parts[j].name, p.name), onkeydown: (e) => step(e, j) }));
  // what a segment's words need, measured once the bar is drawn: each segment then shows its name and share, its name or
  // its share alone, or neither, as its width allows
  let room = null;
  const fit = () => {
    const W = bar.clientWidth;
    if (!W) return;
    if (!room) {
      for (const p of parts) { p.seg.classList.remove("n", "p", "x"); p.em.textContent = "88.8%"; }
      room = parts.map((p) => [p.b.offsetWidth, p.em.offsetWidth]);
      for (const p of parts) p.em.textContent = chancePct(share(p));
    }
    parts.forEach((p, i) => {
      const w = share(p) * W - 18, [b, em] = room[i], c = b + em + 6 <= w ? "" : b <= w ? "n" : em <= w ? "p" : "x";   // 18: the padding; 6: the gap
      p.seg.classList.remove("n", "p", "x"); if (c) p.seg.classList.add(c);
    });
  };
  const show = () => {
    let at = 0;
    parts.forEach((p, i) => {
      const v = share(p), pct = chancePct(v);
      p.seg.style.width = `${v * 100}%`; p.em.textContent = pct; p.out.textContent = pct; p.seg.title = `${p.name} · ${pct}`;
      if (i) {
        const c = cuts[i - 1], was = parts[i - 1];
        c.style.left = `${at * 100}%`; c.setAttribute("aria-valuenow", String(Math.round(at * 100)));
        c.setAttribute("aria-valuetext", `${was.name} ${chancePct(share(was))} · ${p.name} ${pct}`);
      }
      at += v;
    });
    fit();
  };
  const set = (j, v, from = now) => { now = moveShare(from, parts[j].keys, parts[j + 1].keys, v); show(); save(now); };
  // a divider with the focus: the arrows move it by a point (Shift: five), Home and End all the way
  const step = (e, j) => {
    const a = share(parts[j]), d = e.shiftKey ? 0.05 : 0.01, k = e.key;
    const v = k === "ArrowLeft" || k === "ArrowDown" ? a - d : k === "ArrowRight" || k === "ArrowUp" ? a + d : k === "Home" ? 0 : k === "End" ? a + share(parts[j + 1]) : null;
    if (v == null) return;
    e.preventDefault(); set(j, v);
  };
  // a divider dragged: the one under the pointer; where several stand together (options at 0% between them), the
  // rightmost when it is dragged right, the leftmost when left — so an option at 0% can be given a share again
  let drag = null;
  const grab = (e) => {
    if (e.button !== 0 || !cuts.length) return;
    const r = bar.getBoundingClientRect(), x = e.clientX - r.left, at = [];
    parts.reduce((s, p, i) => { if (i) at.push(s * r.width); return s + share(p); }, 0);
    const best = at.reduce((b, a, j) => (Math.abs(a - x) < Math.abs(at[b] - x) ? j : b), 0);
    if (Math.abs(at[best] - x) > 10) return;
    e.preventDefault();
    const by = at.map((a, j) => j).filter((j) => Math.abs(at[j] - at[best]) < 0.5);
    drag = { by, j: by.length === 1 ? by[0] : null, x: e.clientX, r, from: { ...now } };
    if (drag.j != null) cuts[drag.j].focus({ preventScroll: true });
    bar.setPointerCapture(e.pointerId);
  };
  const move = (e) => {
    if (!drag) return;
    if (drag.j == null) {
      if (Math.abs(e.clientX - drag.x) < 2) return;
      drag.j = e.clientX > drag.x ? Math.max(...drag.by) : Math.min(...drag.by);
      cuts[drag.j].focus({ preventScroll: true });
    }
    const j = drag.j, from = drag.from, start = parts.slice(0, j).reduce((s, p) => s + share(p, from), 0), most = share(parts[j], from) + share(parts[j + 1], from);
    set(j, Math.min(most, Math.max(0, Math.round(((e.clientX - drag.r.left) / drag.r.width - start) * 200) / 200)), from);   // in half points
  };
  const bar = el("div", { class: "obar", onpointerdown: grab, onpointermove: move, onpointerup: () => (drag = null), onpointercancel: () => (drag = null) },
    el("div", { class: "osegs" }, parts.map((p) => p.seg)), cuts);
  const again = (unfold) => {
    if (unfold) ODDS_UI.open.add(key); else ODDS_UI.open.delete(key);
    const next = oddsGroup(title, names, now, save, opts);
    box.replaceWith(next);
    if (!unfold) next.scrollIntoView({ block: "nearest" });   // folded: the group, not what was under it
  };
  const box = el("div", { class: "ogrp", id },
    el("div", { class: "ogl" }, el("b", {}, title), tip && info(tip), el("span", { class: "grow" }),
      long && el("button", { class: "linkbtn", onclick: () => again(!open) }, open ? t("odds.fold") : t("odds.unfold", names.length)),
      el("button", { class: "linkbtn", onclick: () => { now = Object.fromEntries(names.map(([k]) => [k, 1 / names.length])); show(); save(now); } }, t("odds.evenBar")),
      reset && el("button", { class: "linkbtn", onclick: reset }, t("odds.defaultBar"))),
    bar,
    open && el("div", { class: "olegend" }, parts.map((p) => p.item)),
    foot);
  show();
  new ResizeObserver(fit).observe(bar);   // drawn, and the window resized
  return box;
}
/** A switch of Surprise me's, on by a chance of its own: a slider from 0 to 100%. `done()`, when given, once it is let go of. */
function oddsChance(label, v, save, done = null) {
  const out = el("output", {}, chancePct(v));
  return el("div", { class: "sl", style: "grid-template-columns:112px 1fr 48px" }, el("span", { title: label }, label),
    el("input", { type: "range", min: 0, max: 100, step: 1, value: v * 100, oninput: (e) => { const x = Number(e.target.value) / 100; out.textContent = chancePct(x); save(x); }, onchange: done }), out);
}
/**
 * Surprise me's chances for look `look`'s optional parts (switches, sliders off by default), each on its own: its
 * recipe's (deal.js), the user's over them (S.settings.recipes, for every profile); Restore puts the table's back.
 * In the Look sheet and in Surprise me's chances (oddsDialog). `redraw()`: what to draw again after a restore.
 */
function lookParts(look, redraw = renderPanel) {
  const L = LOOKS[look] || LOOKS.cel, lang = getLang(), mine = () => S.settings.recipes[look] || {}, r = baseRecipe(look, mine());
  const keep = (patch) => { S.settings.recipes = normalizeRecipes({ ...S.settings.recipes, [look]: { ...mine(), ...patch } }); persistSettings(); };
  const extras = L.params.filter((d) => !d.text && (d.toggle || d.def <= d.min)), odds = oddsOf(S.settings.surprise.odds);
  return [
    extras.length ? extras.map((d) => oddsChance(d.name[lang], partChance(d, r, odds), (v) => keep({ params: { ...(mine().params || {}), [d.key]: v } })))
      : el("div", { class: "hint", style: "margin:0" }, t("odds.noParts")),
    extras.length > 0 && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { delete S.settings.recipes[look]; persistSettings(); redraw(); } }, t("recipe.reset")),
  ];
}
const RECIPE_UI = { open: false };   // whether the Look sheet's box is unfolded
/** The current look's Surprise me chances in the Look sheet, folded away under its sliders: its optional parts (lookParts), and the way to the rest (oddsDialog). */
function recipeBox() {
  return el("details", { class: "box recipe", open: RECIPE_UI.open, ontoggle: (e) => (RECIPE_UI.open = e.target.open) },
    el("summary", { class: "cap" }, t("recipe.title")),
    el("div", { class: "hint", style: "margin:0 0 4px" }, t("recipe.hint")),
    lookParts(S.profile.style.look),
    el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => oddsDialog() }, t("odds.open")));
}
const ODDS_UI = { look: null, open: new Set(), filter: "all", round: 0 };   // the look whose parts the chances window shows (null: the profile's), the groups unfolded ("look": the looks), the looks shown; round: the looks' pictures' drawing (a newer one stops an older)
/**
 * The looks in Surprise me's chances window, a card each: the cover drawn in it (oddsPics), its name, its share and a
 * row of dots — the leftmost off, each more twice as likely (DOTS in deal.js). A dot clicked, or the arrow keys on the
 * row, sets that look's chance alone (withDots); one kept between two dots shows on the nearer (dotsOf) and stays as
 * it is till then. Every look, those set above an even share or those off (ODDS_UI.filter); all of them folded to the
 * likeliest eight until unfolded. `put(group)` keeps the looks' group, `reset()` the rule's back.
 */
function oddsLooks(sv, layouts, put, reset, again) {
  const lang = getLang(), N = DOTS.length - 1, mine = () => (sv.odds.groups || {}).look || {}, odds = () => oddsOf(sv.odds, layouts);
  const dots = (k, o = odds()) => (o.set.look ? dotsOf(mine()[k] || 0) : EVEN_DOTS);
  const count = (f, o = odds()) => LOOK_IDS.filter((k) => (f === "more" ? dots(k, o) > EVEN_DOTS : f === "off" ? !dots(k, o) : true)).length;
  const f = ODDS_UI.filter, unfolded = ODDS_UI.open.has("look"), o0 = odds();
  const list = f === "all" ? (unfolded ? LOOK_IDS : [...LOOK_IDS].sort((a, b) => o0.groups.look[b] - o0.groups.look[a]).slice(0, 8)) : LOOK_IDS.filter((k) => (f === "more" ? dots(k, o0) > EVEN_DOTS : !dots(k, o0)));
  const cards = new Map(), seg = new Map();
  const show = () => {
    const o = odds();
    for (const [k, c] of cards) {
      const d = dots(k, o), pct = d ? chancePct(o.groups.look[k]) : t("odds.off");
      c.box.classList.toggle("off", !d); c.pct.textContent = pct;
      [...c.row.children].forEach((i, n) => i.classList.toggle("on", n ? n <= d : !d));
      c.row.setAttribute("aria-valuenow", String(d)); c.row.setAttribute("aria-valuetext", d ? `${d}/${N} · ${pct}` : pct);
    }
    for (const [k, b] of seg) b.textContent = t("odds.filter." + k, count(k, o));
  };
  const setDots = (k, d) => {
    const next = withDots(mine(), k, Math.min(N, Math.max(0, d)), LOOK_IDS);
    if (!LOOK_IDS.some((id) => next[id] > 1e-9)) return toast(t("odds.lastLook"));   // none left: a group of none would deal every look alike
    put(next); show();
  };
  const card = (k) => {
    const name = LOOKS[k].name[lang], pct = el("span", { class: "pct" });
    const row = el("div", { class: "odots", role: "slider", tabindex: 0, "aria-label": t("odds.dotsOf", name), "aria-valuemin": 0, "aria-valuemax": N,
      onclick: (e) => { const d = e.target.dataset && e.target.dataset.d; if (d != null) setDots(k, Number(d)); },
      onkeydown: (e) => {
        const d = dots(k), to = { ArrowRight: d + 1, ArrowUp: d + 1, ArrowLeft: d - 1, ArrowDown: d - 1, Home: 0, End: N }[e.key];
        if (to == null) return;
        e.preventDefault(); if (Math.min(N, Math.max(0, to)) !== d) setDots(k, to);   // at an end already: a chance between dots stays as it is
      } },
      DOTS.map((_, d) => el("i", { dataset: { d }, title: d ? "" : t("odds.offTip") })));
    const box = el("div", { class: "olook", title: LOOKS[k].about ? LOOKS[k].about[lang] : name }, el("canvas", { class: "lookpic", width: 300, height: 169 }), el("div", { class: "ln" }, el("span", { title: name }, name), pct), row);
    cards.set(k, { box, pct, row });
    return box;
  };
  const filters = el("div", { class: "seg" }, ["all", "more", "off"].map((k) => { const b = el("button", { class: "btn" + (f === k ? " on" : ""), onclick: () => { ODDS_UI.filter = k; again(); } }); seg.set(k, b); return b; }));
  const out = [
    el("div", { class: "ocap" }, el("span", {}, t("odds.looksCap", LOOK_IDS.length), " ", info(t("odds.lookHint"))), el("span", {}, t("odds.lookShort", RULES.hands.count))),
    el("div", { class: "otools" }, filters, el("span", { class: "grow" }),
      el("button", { class: "linkbtn", onclick: () => { put(Object.fromEntries(LOOK_IDS.map((k) => [k, 1 / LOOK_IDS.length]))); show(); } }, t("odds.even")),
      el("button", { class: "linkbtn", onclick: reset }, t("odds.default"))),
    el("div", { class: "olooks" }, list.map(card), !list.length && el("div", { class: "hint" }, t("odds.none"))),
    f === "all" && el("button", { class: "linkbtn ofold", onclick: () => { if (unfolded) ODDS_UI.open.delete("look"); else ODDS_UI.open.add("look"); again(); } }, unfolded ? t("odds.fold") : t("odds.moreLooks", LOOK_IDS.length - list.length)),
  ];
  show();
  oddsPics([...cards].map(([k, c]) => [k, c.box.querySelector("canvas")]));
  return out;
}
/**
 * The looks' pictures in the chances window: the Look sheet's (LOOKCARDS) where they are drawn from the cover as it now
 * is, else drawn now, one a frame while the window is open, and kept there for the sheet too. `list`: [[look, canvas]].
 */
function oddsPics(list) {
  const base = lookBase(), round = ++ODDS_UI.round, wait = [];
  const copy = (pic, cv) => { cv.width = pic.cv.width; cv.height = pic.cv.height; cv.getContext("2d").drawImage(pic.cv, 0, 0); };
  for (const [id, cv] of list) { const pic = LOOKCARDS.pics.get(id); if (pic && pic.sig === base + lookOwn(id)) copy(pic, cv); else wait.push([id, cv]); }
  const next = () => {
    if (round !== ODDS_UI.round || !wait.length || !wait[0][1].isConnected) return;   // drawn anew, or the window shut
    const [id, cv] = wait.shift();
    let pic = LOOKCARDS.pics.get(id);
    if (!pic) { pic = { cv: el("canvas", { class: "lookpic", width: 300, height: 169 }), sig: "", want: "" }; LOOKCARDS.pics.set(id, pic); }
    pic.want = base + lookOwn(id);
    try { paint(pic.cv, selSize(), 300, S.cover, catIndex(), null, null, { profile: inLook(id) }); if (!outlinesPending()) pic.sig = pic.want; copy(pic, cv); }
    catch (e) { console.error(e); }   // one look failing leaves the others to be drawn
    finally { useLook(); }
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}
/**
 * Surprise me's chances, in a window of their own (from Surprise me's window, and the Look sheet): every chance it
 * deals by (RULES.odds and the looks' recipes, deal.js), the user's over them, kept in the settings for every
 * profile. On the left the looks, each with its dots (oddsLooks), and the optional parts of the look picked; on the
 * right the groups of which one is dealt, each a bar adding up to 100% (oddsGroup): which layout a hand is dealt in
 * (the canvas's, or one of the user's presets, with the way to the presets in the Layout sheet), the ground, the
 * title's lettering and bend, the colour block's shape, how many look effects and whose — the long ones folded —;
 * then the switches, each with a chance of its own. `at`: "layouts", opened at the layouts.
 */
function oddsDialog(fresh = true, at = "") {
  if (fresh) Object.assign(ODDS_UI, { look: null, filter: "all", open: new Set() });   // opened anew: the parts of the profile's look, every look, the long groups folded
  LAYED.redraw = null;   // back from a layout preset's editor, if it was open
  const m = $("modal"), sv = S.settings.surprise, layouts = S.settings.layouts, odds = oddsOf(sv.odds, layouts), lang = getLang(), was = m.querySelector(".dlg.odds"), y = was ? was.scrollTop : 0;
  const again = () => oddsDialog(false);
  const done = () => { closeModal(); renderPanel(); };   // the Look sheet's parts show what was set here
  const setGroup = (g, v) => { sv.odds = { ...sv.odds, groups: { ...(sv.odds.groups || {}), [g]: v } }; persistSettings(); };
  const dropGroup = (g) => { const groups = { ...(sv.odds.groups || {}) }; delete groups[g]; sv.odds = { ...sv.odds, groups }; persistSettings(); again(); };
  const setChance = (k, v) => { sv.odds = { ...sv.odds, chances: { ...(sv.odds.chances || {}), [k]: v } }; persistSettings(); };
  const group = (g, names, more = {}) => oddsGroup(t("odds." + g), names, odds.groups[g], (v) => setGroup(g, v), { key: g, reset: () => dropGroup(g), ...more });
  const look = ODDS_UI.look && LOOKS[ODDS_UI.look] ? ODDS_UI.look : S.profile.style.look;
  const dlg = el("div", { class: "dlg odds" },
    el("div", { class: "head" },
      el("div", { class: "ttl" }, el("h2", {}, t("odds.title")), el("div", { class: "hint" }, t("odds.sub", RULES.hands.count), " ", info(t("odds.hint")))),
      el("button", { class: "linkbtn", title: t("odds.reset"), onclick: () => { if (!confirm(t("odds.resetSure"))) return; sv.odds = {}; persistSettings(); again(); } }, t("odds.resetAll")),
      el("button", { class: "btn solid", onclick: done }, t("odds.done"))),
    el("div", { class: "ocols" },
      el("div", { class: "ocol" },
        oddsLooks(sv, layouts, (v) => setGroup("look", v), () => dropGroup("look"), again),
        el("div", { class: "ocard" }, el("div", { class: "ocard-h" }, el("b", {}, t("odds.byLook")), info(t("odds.byLookHint")), el("span", { class: "grow" }),
            select(LOOK_IDS.map((k) => [k, LOOKS[k].name[lang]]), look, (v) => { ODDS_UI.look = v; again(); })),
          el("div", { class: "orows" }, lookParts(look, again)))),
      el("div", { class: "ocol" },
        el("div", { class: "ocap" }, el("span", {}, t("odds.barsCap")), el("span", {}, t("odds.barsSum"))),
        group("layout", [["keep", t("odds.layout.keep")], ...layouts.map((p, i) => [p.id, layoutName(p, i)])], { id: "odds-layouts", tip: `${t("odds.layoutHint")} ${t("odds.layoutsHint")}`, fold: 4,
          foot: el("div", { class: "ofoot" }, el("span", { class: "hint" }, t("odds.presetsWhere")),
            el("button", { class: "linkbtn", onclick: () => { closeModal(); if (!SURPRISE.busy) dealClose(); showSheet("layout"); } }, t("odds.presetsGo"))) }),
        group("ground", [["dark", t("theme.dark")], ["light", t("theme.light")]], { tip: t("odds.groundHint") }),
        group("letters", ODD_OPTIONS.letters().map((k) => [k, k === "own" ? t("odds.ownLetters") : EFFECTS[k].name[lang]]), { tip: t("odds.lettersHint"), fold: 3 }),
        group("bend", ODD_OPTIONS.bend().map((k) => [k, k === "none" ? t("odds.noBend") : BENDS[k].name[lang]]), { tip: t("odds.bendHint"), fold: 3 }),
        group("accent", ODD_OPTIONS.accent().map((k) => [k, t("shape." + k)]), { fold: 3 }),
        group("lookFx", ODD_OPTIONS.lookFx().map((k) => [k, t("odds.lookFx." + k)]), { tip: t("odds.lookFxHint") }),
        group("lookFxFrom", ODD_OPTIONS.lookFxFrom().map((k) => [k, t("odds.lookFxFrom." + k)])),
        el("div", { class: "ocap" }, el("span", {}, t("odds.chances"), " · ", t("odds.chancesShort"), " ", info(t("odds.chancesHint")))),
        el("div", { class: "orows two" }, Object.keys(RULES.odds.chances).map((k) => oddsChance(t("odds.c." + k), odds.chances[k], (v) => setChance(k, v), again))))));   // let go of: the look's parts follow
  m.replaceChildren(dlg);
  m.hidden = false; m.onDismiss = done;
  dlg.scrollTop = y;
  if (at === "layouts") {   // the layouts' card just under the window's head, lit for a moment
    const box = $("odds-layouts");
    dlg.scrollTop += box.getBoundingClientRect().top - dlg.querySelector(".head").getBoundingClientRect().bottom - 10;
    box.classList.add("ping");
  }
}
// ---------- layout presets: where a cover's parts stand, for Surprise me to deal by its chance (see takeLayout in layers.js)
/** What a layout preset is called in the interface: its name, else "Layout n" by its place in the list. */
const layoutName = (p, i) => p.name || t("layouts.defaultName", i + 1);
/** A name for the next layout preset: "Layout n", the first n from the count on that no preset has. */
function nextLayoutName() {
  let n = S.settings.layouts.length + 1;
  while (S.settings.layouts.some((p) => p.name === t("layouts.defaultName", n))) n++;
  return t("layouts.defaultName", n);
}
/** An id for a new layout preset: none of the others', never the canvas's own ("keep"). */
function newLayoutId() {
  let id;
  do id = uid(); while (id === "keep" || S.settings.layouts.some((p) => p.id === id));
  return id;
}
/**
 * A new layout preset, `name`, from the canvas as it is (takeLayout), at each of the profile's sizes: where the title,
 * subtitle, tag, channel name, brand row, channel graphic (where this channel has it, for every channel) and colour
 * block stand, which of them the cover has (and where), and the block's layout. Kept for every profile; returns it.
 */
function addLayout(name) {
  const p = normalizeLayouts([{ ...takeLayout(S.profile.style, S.cover.layers, sizeKeys(), S.cover.catId), id: newLayoutId(), name }])[0];
  S.settings.layouts = [...S.settings.layouts, p]; persistSettings();
  return p;
}
/**
 * Under the canvas, Save as layout (hidden for now: SAVE_AS_LAYOUT): asks for a name ("Layout n" to begin with), then keeps the canvas's layout as a new
 * preset (addLayout); the word that says so leads on to its chances.
 */
function saveLayoutDialog() {
  if (SURPRISE.busy) return;
  if (S.settings.layouts.length >= LAYOUTS.most) return toast(t("layouts.full", LAYOUTS.most));
  const m = $("modal"), input = el("input", { type: "text", value: nextLayoutName(), maxLength: LAYOUTS.name, spellcheck: false, onkeydown: (e) => { if (e.key === "Enter") go(); } });
  const go = () => {
    const p = addLayout(input.value.trim() || nextLayoutName());
    closeModal();
    toast(t("layouts.saved", p.name), false, { label: t("layouts.savedGo"), run: () => oddsDialog(true, "layouts") });
  };
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("layouts.saveTitle")),
    el("div", { class: "hint", style: "margin:0" }, t("layouts.saveBody")),
    el("div", {}, cap("layouts.name"), input),
    el("button", { class: "btn solid wide", onclick: go }, t("layouts.saveGo")),
    el("button", { class: "btn wide", onclick: closeModal }, t("exp.cancel"))));
  m.hidden = false;
  input.focus(); input.select();
}
/**
 * Puts layout preset `p` (the i-th) on the canvas, at the profile's sizes (those of the preset's own pass by): the
 * colour block's layout at each, for every cover of the profile (unless this cover's block is locked), and this cover's
 * layout parts but those locked (putLayout); one step of undo.
 */
function applyLayout(p, i) {
  closeModal();
  clearTimeout(timers.hist); commitHistory();
  putLayout(S.profile.style, S.cover.layers, p, sizeKeys());
  S.picked = [];
  if (layer() && layer().off) S.layerId = "bg";   // the part selected is left out now
  touch({ profile: true, cover: true, panel: true, side: true, strip: true });
  commitHistory();   // its own step (and the hands of a deal are past taking)
  toast(t("layouts.applied", layoutName(p, i)));
}
/** Deletes layout preset `p` (the i-th), once asked: its chance goes to the others as when set to 0 (dropOption), or, when none has any, the canvas's own is certain again. */
function deleteLayout(p, i, again) {
  if (!confirm(t("layouts.deleteSure", layoutName(p, i)))) return;
  const sv = S.settings.surprise, groups = { ...(sv.odds.groups || {}) };
  if (groups.layout) { const g = dropOption(oddsOf(sv.odds, S.settings.layouts).groups.layout, p.id); if (g) groups.layout = g; else delete groups.layout; }
  sv.odds = { ...sv.odds, groups };
  S.settings.layouts = S.settings.layouts.filter((x) => x.id !== p.id);
  persistSettings(); again();
}
/** A usual size facing each way, where the layout editor sees how big a block kept for that orientation is when it has no size facing so (see blockOf in layoutEditor). */
const USUAL_SIZE = { wide: "1920x1080", square: "1200x1200", tall: "1080x1920" };
/**
 * A layout preset's editor, a window from the Layout sheet's preset cards, on a canvas of its own: not the cover being edited
 * but the plainest there is — the cel look on its dark ground, no photos, none of the user's layers, neither the logo
 * nor the corner brackets — with nothing on it but what a preset places (LAYOUT_PARTS): the title, subtitle and tag in
 * words of the editor's own (layed.sample*), the profile's brand row, the channel's name and graphic (the channel on
 * the canvas; a camera when it has no graphic, so there is something to place), and the colour block and its edge. It
 * is drawn at one size at a time, picked above it from the profile's sizes and the preset's own (`custom`, added there
 * by width and height), and each change lands where the scope beside them says: every size, those facing that size's
 * way (what it opens on: the wide sizes and the others are laid out apart from the start), that size alone. A part is
 * dragged to move it, by a corner to resize it (a side stretches it, the knob turns it), or the wheel resizes it (with
 * Option, turns it); the channel graphic's places are the size's own, not the channel's, so the preset puts it there on
 * every channel's cover. The colour block has no template to pick nor sliders: selected, its diamonds move its edge
 * (the middle one: how much it takes) or lean it (an end; dragLayout in layout.js), and the block itself, dragged
 * toward another side, goes there (sideToward in layout.js; setPresetLayout in layers.js lands either where the scope
 * reaches), as it does by that side's button beside the canvas. Where that reaches blocks that do not lie alike (wide
 * sizes side by side, the others stacked), each takes the
 * change as its own: dragged across, each goes to the side across from its own, dragged to a side beside, each goes
 * there (sideLike); made bigger or leaned, each by as much of its own block (scaleBlock). Beside it: the preset's name;
 * its parts, each ticked where the layout has it (unticked, it is left out where the preset is put, see putLayout), at
 * the sizes the scope reaches — a part unticked at the size shown no longer selected, so no handle is left over where
 * it is not —; and the part selected, put back where the template puts it (the block: its size and slant, or its
 * place). A part an earlier preset has no entry for
 * (the colour block, before it was one) is shown where the template puts it, ticked, and is the preset's once saved.
 * `fresh`: a new preset, in the list once saved. Save keeps it; Cancel, Escape or a click beside the window leave it as
 * it was (asked first when something was changed). Both close it. Nothing here touches the cover.
 */
function layoutEditor(p, i, fresh = false) {
  const m = $("modal"), c = cat(), none = new Map();
  // the block, worked on as the preset keeps it (setPresetLayout); the parts, on layers of the editor's own
  const E = { p: { template: p.template, adjust: { ...p.adjust }, ...(p.orient ? { orient: copyOf(p.orient) } : {}), ...(p.by ? { by: copyOf(p.by) } : {}) },
    custom: [...(p.custom || [])], key: S.sel, scope: "orient", sel: "title", live: null, dirty: false, adding: false, addW: "", addH: "" };
  // the sizes it is laid out at: the profile's, then its own (one the profile has too is the profile's)
  const sizes = () => [...S.profile.sizes.map((z) => ({ ...z, key: sizeKey(z) })),
    ...E.custom.filter((k) => !S.profile.sizes.some((z) => sizeKey(z) === k)).map((k) => { const [w, h] = k.split("x").map(Number); return { w, h, key: k, custom: true }; })];
  const keys = () => sizes().map((z) => z.key);
  const size = () => sizes().find((z) => z.key === E.key) || sizes()[0];
  const layers = defaultLayers(), part = (id) => layers.find((l) => l.id === id);
  // the sizes a part shows at, of these; and put to show at `at` (none: left out)
  const shownHere = (L) => (L.off ? [] : keys().filter((k) => inSize(L, k)));
  const showAt = (L, at) => { if (at.length) { delete L.off; L.visible = true; keepTo(L, at, keys()); } else { L.off = true; L.visible = false; } };
  for (const L of layers) if (L.type !== "bg" && !LAYOUT_PARTS.includes(L.id)) { L.off = true; L.visible = false; }   // the logo, the corner brackets: no preset's
  for (const id of LAYOUT_PARTS) {   // one it has no entry for as a new preset has it; the graphic's places this channel's, for every channel
    const q = p.parts[id] || { t: newLayer(id).t, shown: true }, L = part(id);
    L.t = id === "graphic" ? plainPlaces(copyOf(q.t), c.id) : copyOf(q.t);
    showAt(L, q.shown ? keys().filter((k) => !(q.hide || []).includes(k)) : []);
  }
  // the part selected one at the size shown: else the first there is (the title when there is none)
  const keepSel = () => { if (!shownHere(part(E.sel)).includes(size().key)) E.sel = LAYOUT_PARTS.find((id) => shownHere(part(id)).includes(size().key)) || "title"; };
  keepSel();
  // what it is drawn with: words of its own, the profile's brand, the channel's name and graphic; the cel look on its
  // dark ground, the block as the preset has it at the size
  const words = { catId: c.id, title: t("layed.sampleTitle"), subtitle: t("layed.sampleSub"), tag: t("layed.sampleTag") };
  const channel = { ...c, name: c.name || t("layed.sampleChannel"), graphic: c.graphic && c.graphic.kind !== "none" ? c.graphic : { kind: "graphic", id: "camera", labels: [], stamp: "" } };
  const profileAt = (key) => {
    const lay = presetLayout(E.p, key);
    return { ...S.profile, brand: { ...S.profile.brand, name: S.profile.brand.name || t("layed.sampleBrand"), logo: "" }, categories: S.profile.categories.map((x) => (x.id === c.id ? channel : x)),
      style: { template: lay.template, layoutAdjust: { [lay.template]: { ...lay.adjust } }, theme: "dark", look: "cel", lookParams: {}, lookSeed: 7, lookArt: {} } };
  };
  // the size shown as the layer maths wants it, its group the sizes here facing its way, and no channel (a move of the
  // graphic is the size's, for every channel's cover); what a change reaches
  const geo = () => {
    const z = size(), [vw, vh] = virtualSize(z.w, z.h), group = sizes().filter((x) => orientOf(x.w, x.h) === orientOf(z.w, z.h)).map((x) => { const [w, h] = virtualSize(x.w, x.h); return { key: x.key, vw: w, vh: h }; });
    return { vw, vh, key: z.key, catId: null, group };
  };
  const reach = () => (E.scope === "all" ? keys() : E.scope === "orient" ? geo().group.map((x) => x.key) : [size().key]);
  const cv = el("canvas"), stage = el("div", { class: "ls-stage" }, cv), side = el("div", { class: "ls-side" }), top = el("div", { class: "ls-top" }), strip = el("div", { class: "ls-strip" });
  // each size's look of the preset, under the canvas: a canvas each, kept while the strip is built again and painted a moment after a change
  const thumbs = new Map(), thumbOf = (key) => { if (!thumbs.has(key)) thumbs.set(key, el("canvas")); return thumbs.get(key); };
  const paintThumbs = () => { for (const z of sizes()) { const tc = thumbOf(z.key); if (tc.isConnected) drawCover(tc, { profile: profileAt(z.key), catIndex: catIndex(), size: z, pixelW: 220, cover: { ...words, layers }, photos: none }); } };
  const name = el("input", { type: "text", value: p.name, placeholder: layoutName(p, i), maxLength: LAYOUTS.name, spellcheck: false, oninput: () => (E.dirty = true) });
  // fitted to the room there is, at the screen's pixels; painted as a cover is, so the block and its diamonds are those
  // of this size (a part kept to other sizes left out of it, see coverAt in render.js)
  const draw = () => {
    if (!cv.isConnected) return;
    const z = size(), [vw, vh] = virtualSize(z.w, z.h), room = stage.getBoundingClientRect();
    const k = Math.max(0.05, Math.min((room.width - 16) / vw, (room.height - 16) / vh));
    cv.style.width = Math.round(vw * k) + "px"; cv.style.height = Math.round(vh * k) + "px";
    drawCover(cv, { profile: profileAt(z.key), catIndex: catIndex(), size: z, pixelW: Math.min(vw * 1.5, vw * k * (window.devicePixelRatio || 1)), cover: { ...words, layers }, photos: none,
      select: E.sel, live: E.live, handles: E.sel !== "accent" });
    if (!E.live) later("layed-thumbs", 250, paintThumbs);
  };
  let queued = false;
  const redraw = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); };
  // the pointer in the canvas's virtual units; the selected part's handle under it (the block has none, but its
  // diamonds); the part under it (the selected one keeps the grab under anything at least as big, as on the canvas —
  // but the block, which holds most of what lies on it)
  const at = (e) => { const b = cv.getBoundingClientRect(), k = cv._virtual[0] / b.width; return { x: (e.clientX - b.left) * k, y: (e.clientY - b.top) * k, k }; };
  const ok = (h) => LAYOUT_PARTS.includes(h.id);
  const grip = (e) => {
    const hit = E.sel !== "accent" && cv._hits && cv._hits.find((h) => h.id === E.sel);
    if (!hit || !showsFrame(hit)) return null;
    const q = at(e), a = (-hit.r * Math.PI) / 180, dx = q.x - hit.cx, dy = q.y - hit.cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const near = handles(hit, q.k).map((h) => ({ id: h.id, d: Math.hypot(lx - h.lx, ly - h.ly) })).filter((h) => h.d <= 11 * q.k).sort((a, b) => a.d - b.d)[0];
    return { hit, q, lx, ly, handle: near ? near.id : null };
  };
  const diamond = (e) => {
    if (E.sel !== "accent" || !cv._layout || !shownHere(part("accent")).includes(size().key)) return null;   // a block left out here has no edge
    const q = at(e);
    return layoutHandles(cv, part("accent")).map((h) => ({ ...h, d: Math.hypot(q.x - h.x, q.y - h.y) })).filter((h) => h.d <= 13 * q.k).sort((a, b) => a.d - b.d)[0] || null;
  };
  const partAt = (e) => {
    if (!cv._hits) return null;
    const q = at(e), top = hitAt(cv._hits, q.x, q.y, ok), sel = E.sel !== "accent" && cv._hits.find((h) => h.id === E.sel && ok(h)), mine = sel && hitAt([sel], q.x, q.y), area = (h) => h.hw * h.hh;
    const hit = mine && (!top || top.id === mine.id || area(top) >= area(mine)) ? mine : top;
    return hit ? hit.id : null;
  };
  const edit = (patch) => { adjust(part(E.sel), geo(), E.scope, patch); E.dirty = true; redraw(); };
  // the block changed where the scope says, from what it was as the drag began (so a drag led back leaves it as it was)
  const reblock = (was, fn) => { E.p = copyOf(was); if (fn) { setPresetLayout(E.p, E.scope, size().key, fn); E.dirty = true; } redraw(); };
  // how big and how leaning the block of a layout of preset `q` is (`where`: whose, see setPresetLayout), seen at a size
  // drawn in it: a size's own at that size; an orientation's at the first size here facing that way, else a usual
  // one; the default at the first size here that has no other, else the one shown — as it is drawn there, with the
  // parts shown at that size (coverLayout, as draw paints it), not the template's alone, so a block resized at one size
  // does not make another jump
  const blockOf = (q, lay, where) => {
    const ks = keys(), k = where && sizeOfKey(where) ? where : where ? ks.find((x) => orientOfKey(x) === where) || USUAL_SIZE[where]
      : ks.find((x) => !(q.by && q.by[x]) && !(q.orient && q.orient[orientOfKey(x)])) || size().key;
    return drawnBlock(lay, k);
  };
  // the block of layout `lay` as it is drawn at size `k`, with the parts shown there (meetStandards fits it to them)
  const drawnBlock = (lay, k) => {
    const [w, h] = virtualSize(...sizeOfKey(k));
    return layoutValues(coverLayout(LOOKS.cel, lay, w, h, partsOf(coverAt({ ...words, layers }, k), channel)), w, h);
  };
  const pick = (id) => { if (E.sel !== id) { E.sel = id; build(); } };
  const end = () => { cv.onpointermove = cv.onpointerup = cv.onpointercancel = null; E.live = null; build(); redraw(); };
  cv.addEventListener("pointermove", (e) => {
    if (e.buttons || !cv._hits) return;
    const g = grip(e), id = partAt(e);
    cv.style.cursor = diamond(e) ? "pointer" : g && g.handle ? CURSOR[g.handle] : id === "accent" && E.sel === "accent" ? "move" : id ? "grab" : "default";
  });
  cv.addEventListener("pointerdown", (e) => {
    if (!cv._hits) return;
    const lh = diamond(e);
    if (lh) {   // the block's edge: by its middle it moves (how much the block takes), by an end it leans, the other end staying
      // the block drawn here gets what is dragged; any other the scope reaches, as much of its own (scaleBlock)
      const was = copyOf(E.p), key = size().key, [vw, vh] = cv._virtual, from = layoutValues(cv._layout, vw, vh), lean = lh.id !== "m";
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (mv) => {
        const q = at(mv), a = dragLayout(cv._layout, vw, vh, presetLayout(E.p, key).adjust, lh.id, q.x, q.y, cv._titleBox);
        const to = lean ? { size: a.size, slant: a.slant } : { size: a.size }, now = { size: a.size, slant: lean ? a.slant : from.slant };
        if (Math.abs(now.size - from.size) < 0.002 && Math.abs(now.slant - from.slant) < 0.002) return reblock(was, null);   // led back to where it began: as it was, nothing pinned
        reblock(was, (lay, where, here) => (here ? { template: lay.template, adjust: { ...lay.adjust, ...to } } : scaleBlock(lay, blockOf(was, lay, where), from, now, lean)));
        // and every other size it reaches, from the block drawn there: sizes sharing a layout are drawn each its own
        // (fitted to the parts each has) and one size kept for all of them would snap them to one; so each is given its
        // own, a share of what it showed, and none jumps
        for (const k of reach()) if (k !== key) { const lay = presetLayout(was, k); setPresetLayout(E.p, "size", k, () => scaleBlock(lay, drawnBlock(lay, k), from, now, lean)); }
      };
      cv.onpointerup = cv.onpointercancel = end;
      return;
    }
    const g = grip(e);
    if (g && g.handle) {   // the selected part's handle: corners resize, sides stretch, the knob turns
      const { hit, handle } = g, min = 6 * g.q.k, of = (q) => ({ ang: Math.atan2(q.q.y - hit.cy, q.q.x - hit.cx), dist: Math.max(min, Math.hypot(q.lx, q.ly)), lx: Math.max(min, Math.abs(q.lx)), ly: Math.max(min, Math.abs(q.ly)) });
      let prev = of(g);
      cv.setPointerCapture(e.pointerId); E.live = { ids: [E.sel], key: E.sel };
      cv.onpointermove = (mv) => {
        const q = grip(mv);
        if (!q) return;
        const now = of(q);
        if (handle === "rot") { let d = ((now.ang - prev.ang) * 180) / Math.PI; d = ((d + 540) % 360) - 180; edit({ rot: mv.shiftKey ? Math.round(d) : d }); }
        else if (handle.length === 2) edit({ scale: now.dist / prev.dist });
        else if (handle === "e" || handle === "w") edit({ kx: now.lx / prev.lx });
        else edit({ ky: now.ly / prev.ly });
        prev = now;
      };
      cv.onpointerup = cv.onpointercancel = end;
      return;
    }
    const id = partAt(e);
    if (!id) return;
    pick(id);
    cv.setPointerCapture(e.pointerId);
    if (id === "accent") {   // the block itself, toward another side: it goes there, and each the scope reaches alike (sideLike)
      const was = copyOf(E.p), from = at(e), first = sideOf(presetLayout(E.p, size().key)), min = 0.12 * Math.min(...cv._virtual);
      let now = first;
      cv.onpointermove = (mv) => {
        const q = at(mv), to = sideToward(q.x - from.x, q.y - from.y, min) || first;
        if (to !== now) { now = to; reblock(was, to === first ? null : (lay) => sideLike(lay, first, to)); }
      };
      cv.onpointerup = cv.onpointercancel = end;
      return redraw();
    }
    let last = at(e);
    E.live = { ids: [id], key: id };
    cv.onpointermove = (mv) => { const q = at(mv); edit({ ddx: q.x - last.x, ddy: q.y - last.y }); last = q; };
    cv.onpointerup = cv.onpointercancel = end;
    redraw();
  });
  cv.addEventListener("wheel", (e) => {
    e.preventDefault();
    const id = partAt(e);
    if (!id || id === "accent") return;   // the block is sized by its edge
    pick(id);
    if (!E.live || E.live.key !== id) E.live = { ids: [id], key: id };
    later("layedLive", 300, () => { E.live = null; redraw(); });
    edit(e.altKey ? { rot: e.deltaY > 0 ? 2 : -2 } : { scale: Math.exp(-e.deltaY * 0.0015) });
  }, { passive: false });
  // a size of the preset's own, added by its width and height (one there is already is picked), or let go of; a part
  // shows at one added as at any size it is not hidden at
  const addSize = (w, h) => {
    if (![w, h].every((n) => Number.isInteger(n) && n >= 64 && n <= 8192)) return toast(t("layed.badSize"));
    const key = `${w}x${h}`;
    if (!keys().includes(key)) {
      if (E.custom.length >= LAYOUTS.custom) return toast(t("layed.manySizes", LAYOUTS.custom));
      const was = LAYOUT_PARTS.map((id) => [part(id), shownHere(part(id))]);
      E.custom.push(key);
      for (const [L, on] of was) if (on.length) showAt(L, [...on, key]);
      E.dirty = true;
    }
    E.key = key; E.adding = false; E.addW = E.addH = ""; keepSel(); build(); redraw();
  };
  const dropSize = (key) => {
    const was = LAYOUT_PARTS.map((id) => [part(id), shownHere(part(id))]);
    E.custom = E.custom.filter((k) => k !== key);
    for (const [L, on] of was) if (on.length) showAt(L, on.filter((k) => k !== key));
    if (E.key === key) { E.key = keys()[0]; keepSel(); }
    E.dirty = true; build(); redraw();
  };
  // a part ticked or not at the sizes the scope reaches; ticked, it is the one selected; unticked here, it is no longer
  // (the block's diamonds and what is said of its side go with it)
  const tick = (L, on) => {
    const r = reach(), now = shownHere(L);
    showAt(L, on ? keys().filter((k) => now.includes(k) || r.includes(k)) : now.filter((k) => !r.includes(k)));
    if (on) E.sel = L.id; else keepSel();
    E.dirty = true; build(); redraw();
  };
  // the size shown follows its orientation's block again, or the preset's; the part selected put back where the
  // template puts it; the block's size and slant (how much it takes, how it leans) as its template gives them, its
  // side kept; the block to side `to`, as when it is dragged there (each the scope reaches alike, sideLike) — each where
  // the scope reaches
  const follow = () => { const by = { ...E.p.by }; delete by[size().key]; if (Object.keys(by).length) E.p.by = by; else delete E.p.by; E.dirty = true; build(); redraw(); };
  const reset = () => { const g = geo(); resetPlacement(part(E.sel), E.scope, g.key, g.catId, g.group.map((x) => x.key)); E.dirty = true; build(); redraw(); };
  const resetBlock = () => {
    setPresetLayout(E.p, E.scope, geo().key, (lay, at) => blockDefault(lay, at && (ORIENTS.includes(at) ? at : orientOfKey(at))));
    E.dirty = true; build(); redraw();
  };
  const toSide = (to) => { const first = sideOf(presetLayout(E.p, size().key)); if (to !== first) { reblock(copyOf(E.p), (lay) => sideLike(lay, first, to)); build(); } };
  // above the canvas: the sizes (and one to add), and what a change reaches; beside it, the parts and the one selected
  const build = () => {
    const z = size(), all = keys(), block = E.sel === "accent";
    // what is typed kept while the side is built again (a part ticked, a size picked), until a size is added
    const num = (k, hint) => el("input", { type: "number", class: "ls-num", min: 64, max: 8192, step: 1, placeholder: hint, value: E[k], oninput: (e) => (E[k] = e.target.value),
      onkeydown: (e) => { if (e.key === "Enter") add(); if (e.key === "Escape") { e.stopPropagation(); E.adding = false; build(); } } });
    const wIn = num("addW", "1080"), hIn = num("addH", "1350"), add = () => addSize(Number(wIn.value), Number(hIn.value));
    top.replaceChildren(el("div", { class: "grp" }, el("span", {}, t("props.scope")), el("div", { class: "seg" }, SCOPES.map((v) => el("button", { class: "btn" + (E.scope === v ? " on" : ""),
      title: v === "orient" ? t("scope.orientTip", sizes().filter((x) => geo().group.some((g) => g.key === x.key)).map((x) => ratioText(x.w, x.h)).join(" · ")) : null, onclick: () => { E.scope = v; build(); } }, scopeName(v, z.key))))));
    strip.replaceChildren(el("div", { class: "ls-cap" }, el("b", {}, t("layed.strip")), el("small", {}, t("layed.stripSub"))),
      el("div", { class: "ls-sizes" },
        sizes().map((x) => el("span", { class: "ls-size" + (x.custom ? " custom" : "") + (x.key === z.key ? " on" : "") },
          el("button", { class: "ls-thumb", title: x.custom ? t("layed.customTip", `${x.w}×${x.h}`) : sizeLabel(x), onclick: () => { E.key = x.key; keepSel(); build(); redraw(); } },
            el("span", { class: "tbox" }, thumbOf(x.key)), el("span", {}, ratioText(x.w, x.h))),
          x.custom && el("button", { class: "drop", title: t("layed.dropSize"), onclick: () => dropSize(x.key) }, "×"))),
        E.adding ? el("span", { class: "ls-add" }, wIn, "×", hIn, el("button", { class: "btn", onclick: add }, t("layed.addGo")), el("button", { class: "linkbtn", onclick: () => { E.adding = false; build(); } }, t("layed.cancel")))
          : el("button", { class: "ls-plus", title: t("layed.addTip"), onclick: () => { E.adding = true; build(); } }, t("layed.add"))));
    later("layed-thumbs", 60, paintThumbs);
    if (E.adding) wIn.focus();
    // a part's row: ticked where the layout has it at this size, and said so when that is some sizes only; its name,
    // clicked, selects it (one here)
    const row = (id) => {
      const P = part(id), on = shownHere(P), here = on.includes(z.key);
      return el("div", { class: "chk" + (id === E.sel ? " on" : "") },
        el("input", { type: "checkbox", checked: here, onchange: (e) => tick(P, e.target.checked) }),
        el("span", { onclick: () => { if (here) { pick(id); redraw(); } } }, t("layer." + id)),
        on.length > 0 && on.length < all.length && el("small", { class: "some", title: t("layed.someTip", sizes().filter((x) => on.includes(x.key)).map((x) => ratioText(x.w, x.h)).join(" · ")) }, t("layed.some")));
    };
    side.replaceChildren(...[
      el("div", {}, cap("layed.parts"), el("div", { class: "parts" }, LAYOUT_PARTS.map(row)), el("div", { class: "hint", style: "margin:6px 0 0" }, t("layed.partsHint"))),
      el("div", { class: "ls-picked" }, el("span", {}, t("layed.picked", t("layer." + E.sel))),
        !block && el("button", { class: "btn", title: t("layed.resetTip"), onclick: reset }, t("layed.reset"))),
      // the block: the side it lies on at this size, a button each (as a drag toward that side); its size and slant put back
      block && el("div", { class: "ls-block" },
        el("div", {}, el("label", { class: "cap" }, t("layed.side", ratioText(z.w, z.h))),
          el("div", { class: "seg" }, SIDES.map((v) => {
            const on = sideOf(presetLayout(E.p, z.key)) === v;
            return el("button", { class: "btn" + (on ? " on" : ""), "aria-pressed": String(on), title: on ? null : t("layed.sideTip"), onclick: () => toSide(v) }, t("layed.side." + v));
          }))),
        E.p.by && E.p.by[z.key] && el("div", { class: "layown" }, el("span", {}, t("style.own")), el("button", { class: "linkbtn", title: t("layed.followTip"), onclick: follow }, t("style.follow"))),
        el("div", { class: "acts" }, el("button", { class: "btn", title: t("layed.blockResetTip"), onclick: resetBlock }, t("layed.blockReset"))),   // its place is its side, the buttons above
        el("div", { class: "hint", style: "margin:0" }, t("layed.blockHint")))].filter(Boolean));
  };
  const back = () => { LAYED.redraw = null; closeModal(); if (S.mode === "edit" && S.tab.edit === "layout") renderPanel(); };   // back to the Layout sheet, where the presets are
  const cancel = () => { if (E.dirty && !confirm(t("layed.discard"))) return; back(); };
  const save = () => {
    const kept = normalizeLayouts([{ ...E.p, custom: E.custom, parts: takeParts(layers, keys(), p.parts, c.id), id: p.id, name: name.value }])[0];
    S.settings.layouts = fresh ? [...S.settings.layouts, kept] : S.settings.layouts.map((x) => (x.id === p.id ? kept : x)); persistSettings();
    back();
  };
  build();
  m.replaceChildren(el("div", { class: "dlg layed" },
    el("div", { class: "lehead" },
      el("div", { class: "ttl" }, el("div", {}, el("h2", {}, t(fresh ? "layed.newTitle" : "layed.editTitle")), name), el("div", { class: "hint" }, t("layed.sub"), " ", info(t("layed.hint")))),
      top,
      el("div", { class: "acts" }, el("button", { class: "btn", onclick: cancel }, t("layed.cancel")), el("button", { class: "btn solid", onclick: save }, t("layed.save")))),
    el("div", { class: "ls-body" }, side, el("div", { class: "ls-main" }, stage, strip))));
  m.hidden = false; m.onDismiss = cancel;
  LAYED.redraw = redraw;
  redraw();
}
/** Whether Tune this look, in the Look sheet, shows the look's description: shut until its heading is clicked, for the session. */
const TUNE_UI = { about: false };
/** Tune this look's heading: the look's name and an ⓘ, and while the look has a description, a chevron; a click on the line opens or shuts it. */
function tuneHead(L) {
  const fold = (e) => {
    TUNE_UI.about = !TUNE_UI.about;
    const box = e.currentTarget.closest(".box"), b = box.querySelector(".fold");
    box.querySelector(".about").hidden = !TUNE_UI.about;
    b.setAttribute("aria-expanded", String(TUNE_UI.about)); b.title = t(TUNE_UI.about ? "look.aboutHide" : "look.aboutShow");
  };
  return el("div", { class: "tunehead" + (L.about ? " folds" : ""), onclick: L.about && fold }, el("b", {}, t("look.tune", L.name[getLang()]), " ", info(t("style.lookHint"))),   // the ⓘ in the line, after the name's last word when it wraps
    L.about && el("button", { class: "fold", "aria-expanded": String(TUNE_UI.about), title: t(TUNE_UI.about ? "look.aboutHide" : "look.aboutShow") }, el("span", { class: "chev" })));
}
/** Look: every look as a card, the cover drawn in it; under the cards, this look's settings and how Surprise me matches it. */
function lookSheet() {
  const st = S.profile.style;
  const L = LOOKS[st.look] || LOOKS.cel, vals = lookParams(st.look, st.lookParams[st.look]);
  const tune = (k, v) => { st.lookParams[st.look] = { ...vals, ...st.lookParams[st.look], [k]: v }; draftTouch({ profile: true }, k); };
  return [
    sheetHead(t("sheet.look"), t("sheet.lookSub")),
    lookFinder(),
    lookCards(),
    el("div", { class: "box" }, tuneHead(L),
      L.about && el("div", { class: "about", hidden: !TUNE_UI.about }, L.about[getLang()]),
      L.params.map((d) => [d.text
        ? el("div", { class: "sl", style: "grid-template-columns:84px 1fr" }, el("span", {}, d.name[getLang()]),
            textInput(vals[d.key], (v) => tune(d.key, v), { maxLength: d.max, placeholder: d.placeholder ? d.placeholder[getLang()] : "" }))
        : d.toggle
        ? el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: vals[d.key] > 0, onchange: (e) => tune(d.key, e.target.checked ? 1 : 0) }), el("span", {}, d.name[getLang()]))
        : d.needsPhoto && !recordOf(mainPhoto())
          ? el("div", { class: "sl off", style: "grid-template-columns:84px 1fr", title: t("style.needsPhoto") }, el("span", {}, d.name[getLang()]), el("span", { class: "why" }, t("style.needsPhoto")))   // nothing for it to act on yet
          : slider2(d.name[getLang()], d.min, d.max, d.step, vals[d.key], (v) => tune(d.key, v)),
        d.key === L.art && lookArtRow()]),
      L.seeded && el("button", { class: "btn wide", style: "margin-top:10px", title: t("style.shuffleHint"), onclick: () => { st.lookSeed = Math.floor(Math.random() * 1000000); touch({ profile: true }); } }, t("style.shuffle")),
      L.params.length > 0 && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { delete st.lookParams[st.look]; if (st.lookArt) delete st.lookArt[st.look]; touch({ profile: true, panel: true }); } }, t("style.lookReset"))),
    recipeBox(),
  ];
}
// ---------- Look: the looks as cards, each the cover drawn in it
/**
 * What the canvas shows instead of the cover as it is while a card is under the pointer, a moment after it came
 * (null: none): `look`, the look of a look card; `fx`, a text effect's card, {id, fx, seed} (the layer, the effect,
 * the seed a lettering dealt by one is drawn with); `layout`, a layout preset's card, {id, name, p} (the preset, the
 * cover laid out by it at each drawing, see laidOut). Only the drawing takes it (paint, through previewed()): the profile
 * and the cover keep their own, so nothing of it is saved or undone; a click on the card (a preset's picture or name)
 * puts it on. `timer`: the moment being waited, for `wait` (the kind it will show).
 */
const PREVIEW = { look: null, fx: null, layout: null, timer: 0, wait: "" };
/** The profile as drawn in look `id` (a copy: the profile's own style untouched). */
const inLook = (id) => ({ ...S.profile, style: { ...S.profile.style, look: id } });
/** The profile and the cover the canvas is painted from: S's own, or copies as a card under the pointer has them (see PREVIEW). */
function previewed() {
  let profile = S.profile, cover = S.cover;
  if (PREVIEW.layout) ({ profile, cover } = laidOut(PREVIEW.layout.p));
  if (PREVIEW.look) profile = inLook(PREVIEW.look);
  const f = PREVIEW.fx;
  if (f) cover = { ...cover, layers: cover.layers.map((l) => (l.id === f.id ? { ...l, fx: f.fx === "auto" ? undefined : f.fx, fxSeed: l.fxSeed || f.seed || undefined } : l)) };
  return { profile, cover };
}
/**
 * A card under the pointer: what it shows (`v`, of PREVIEW's `kind`) is on the canvas 140 ms later, if `ok()` still
 * says so then, in the place of whatever was previewed till then; v null: the canvas as it is, at once.
 */
function previewSoon(kind, v, ok = () => true) {
  clearTimeout(PREVIEW.timer); PREVIEW.timer = 0; PREVIEW.wait = "";
  const clear = () => { const was = PREVIEW.look || PREVIEW.fx || PREVIEW.layout; PREVIEW.look = PREVIEW.fx = PREVIEW.layout = null; return !!was; };
  if (!v) { if (clear()) { previewTag(); queueDraw(); } return; }
  PREVIEW.wait = kind;
  PREVIEW.timer = setTimeout(() => { PREVIEW.timer = 0; PREVIEW.wait = ""; if (!ok()) return; clear(); PREVIEW[kind] = v; previewTag(); queueDraw(); }, 140);
}
/** Ends a preview of the kinds given, and one waiting to be (its cards drawn anew, or one clicked): the canvas as it is. */
function endPreview(...kinds) {
  if (kinds.includes(PREVIEW.wait)) { clearTimeout(PREVIEW.timer); PREVIEW.timer = 0; PREVIEW.wait = ""; }
  if (kinds.some((k) => PREVIEW[k])) { for (const k of kinds) PREVIEW[k] = null; previewTag(); queueDraw(); }
}
/**
 * Each look's card picture, kept from one drawing of the sheet to the next: {cv, sig, want} by look id, where `sig`
 * is what it was drawn from (the cover, the size, the style but its look, the look's own settings) and `want` what it
 * is to be drawn from. `queue`: the looks waiting to be drawn anew, the profile's first; `round`, the drawing's turn
 * (a newer one stops an older); `scroll`, where the cards were scrolled to.
 */
const LOOKCARDS = { pics: new Map(), queue: [], round: 0, scroll: null };
const onLookSheet = () => S.mode === "edit" && !sheetHidden() && S.tab.edit === "look";
const lookBase = () => { const st = S.profile.style; return JSON.stringify([S.sel, S.cover.catId, S.cover.title, S.cover.subtitle, S.cover.tag, S.cover.layers, S.cover.scene, S.profile.brand, S.profile.categories, S.photos.size, { ...st, look: 0, lookParams: 0, lookArt: 0 }]); };
const lookOwn = (id) => { const st = S.profile.style; return JSON.stringify([st.lookParams[id], (st.lookArt || {})[id]]); };
/** The cards in sight drawn anew where what they show has changed since (an edit while the Look sheet is open, outlines arrived). */
function refreshLookCards() {
  if (!onLookSheet()) return;
  const base = lookBase(), look = S.profile.style.look, stale = [];
  for (const [id, pic] of LOOKCARDS.pics) { if (!pic.cv.isConnected || pic.cv.parentNode.hidden) continue; pic.want = base + lookOwn(id); if (pic.sig !== pic.want) stale.push(id); }   // a card the search hides waits till it shows
  if (!stale.length) return;
  LOOKCARDS.queue = stale.includes(look) ? [look, ...stale.filter((x) => x !== look)] : stale;
  drawLookCards(++LOOKCARDS.round);
}
function lookCards() {
  const st = S.profile.style, lang = getLang(), stale = [], shown = lookFilter();
  const base = lookBase();
  const card = (id) => {
    let pic = LOOKCARDS.pics.get(id);
    if (!pic) { pic = { cv: el("canvas", { class: "lookpic", width: 300, height: 169 }), sig: "", want: "" }; LOOKCARDS.pics.set(id, pic); }
    pic.want = base + lookOwn(id);
    if (pic.sig !== pic.want) stale.push(id);
    const on = id === st.look;
    return el("div", { class: "lookcard" + (on ? " on" : ""), dataset: { id }, hidden: !on && !shown(id) },
      el("button", { class: "lookpick", "aria-pressed": String(on), title: LOOKS[id].about ? LOOKS[id].about[lang] : LOOKS[id].name[lang], onpointerenter: () => hoverLook(id), onclick: () => pickLook(id) },
        pic.cv, el("span", { class: "nm" }, LOOKS[id].name[lang]), on && el("span", { class: "badge" }, t("look.current"))),
      likeButton(id));
  };
  const grid = el("div", { class: "lookgrid" + (lookFinding() ? " finding" : ""), onpointerleave: () => hoverLook(null), onscroll: (e) => { LOOKCARDS.scroll = e.currentTarget.scrollTop; } }, LOOK_IDS.map(card));
  sortLooks(grid);
  requestAnimationFrame(() => {   // where it was; the first time, at the profile's look
    if (LOOKCARDS.scroll != null) grid.scrollTop = LOOKCARDS.scroll;
    else { const on = grid.querySelector(".on"); if (on) grid.scrollTop = on.offsetTop - grid.offsetTop - 8; }
  });
  LOOKCARDS.queue = stale.includes(st.look) ? [st.look, ...stale.filter((x) => x !== st.look)] : stale;
  drawLookCards(++LOOKCARDS.round);
  return [grid, el("div", { class: "hint lookgrid-none", hidden: !lookFinding() || LOOK_IDS.some(shown) }, noLooks())];
}
/** The line under the cards when none is let through: under ♥ Liked with nothing liked yet, how to like one. */
const noLooks = () => t(LOOK_UI.tag === "liked" && !S.settings.lookLikes.length ? "look.likedNone" : "look.none");
/**
 * A look card's ♡, at the right end of its name: a click adds the look to ♥ Liked, or takes it out, without putting
 * it on or previewing it (the card's own button does that: the ♡ lies beside it, not in it).
 */
function likeButton(id) {
  const b = el("button", { class: "lookheart", onpointerenter: () => hoverLook(null), onclick: (e) => { e.stopPropagation(); likeLook(id); markLike(b, id); } }, ico("heart", 16));
  markLike(b, id);
  return b;
}
/** The ♡ as filled or not, and what it says it will do. */
function markLike(b, id) {
  const on = S.settings.lookLikes.includes(id), say = t(on ? "look.unlike" : "look.like");
  b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", say); b.title = say;
}
/** Likes look `id` (the latest liked first), or unlikes it if it was; under ♥ Liked, the cards follow at once. */
function likeLook(id) {
  const likes = S.settings.lookLikes, was = likes.includes(id);
  S.settings.lookLikes = was ? likes.filter((x) => x !== id) : [id, ...likes];
  persistSettings();
  if (LOOK_UI.tag === "liked") findLooks(true);
}
/**
 * Under ♥ Liked, the cards the latest liked first, after the profile's own (first while the search or a chip is at
 * work, liked or not: .lookgrid.finding); CSS order, the cards themselves left in place. Elsewhere, as LOOK_IDS has them.
 */
function sortLooks(grid) {
  const likes = LOOK_UI.tag === "liked" ? S.settings.lookLikes : [], look = S.profile.style.look;
  for (const card of grid.children) { const i = card.dataset.id === look ? -1 : likes.indexOf(card.dataset.id); card.style.order = i < 0 ? "" : String(i); }
}
/**
 * The Look sheet's search and chip, for this session: `q` the words typed, `tag` the chip picked ("" every look, a kind
 * of LOOK_CATEGORIES, "used", those this computer has used most, or "liked", those liked on it). They only hide cards:
 * the profile's own look is never hidden, and while they are at work it comes first.
 */
const LOOK_UI = { q: "", tag: "" };
/** How many looks ★ Most used shows at most. */
const MOST_USED = 6;
/** The looks this computer has made a profile's most often (S.settings.lookUse), the most first; none while nothing is counted. */
const mostUsed = () => Object.entries(S.settings.lookUse).filter(([id, n]) => LOOKS[id] && n > 0).sort((a, b) => b[1] - a[1]).slice(0, MOST_USED).map(([id]) => id);
/** Counts look `id` as made a profile's once more, by its card or a hand of Surprise me kept. */
function countLook(id) { S.settings.lookUse[id] = (S.settings.lookUse[id] || 0) + 1; persistSettings(); }
const lookFinding = () => !!(LOOK_UI.q.trim() || LOOK_UI.tag);
/**
 * Whether a look is among those the search and the chip let through, as a test by look id: the chip's kind (LOOK_TAGS),
 * or among the most used or the liked; every word typed found in its name, in either language, in what it says of
 * itself, or in the names of its kinds.
 */
function lookFilter() {
  const among = LOOK_UI.tag === "used" ? mostUsed() : LOOK_UI.tag === "liked" ? S.settings.lookLikes : null, words = folded(LOOK_UI.q).split(/\s+/).filter(Boolean);
  return (id) => {
    if (among ? !among.includes(id) : LOOK_UI.tag && !LOOK_TAGS[id].includes(LOOK_UI.tag)) return false;
    if (!words.length) return true;
    const L = LOOKS[id], text = folded([L.name.zh, L.name.en, L.about && L.about.zh, L.about && L.about.en, ...LOOK_TAGS[id].flatMap((k) => bothLangs("look.cat." + k))].join(" "));
    return words.every((w) => text.includes(w));
  };
}
/** Above the look cards: a search field and a chip for each kind of look (★ Most used once something is counted), then ♥ Liked. */
function lookFinder() {
  const used = mostUsed().length > 0;
  if (LOOK_UI.tag === "used" && !used) LOOK_UI.tag = "";
  const chips = el("div", { class: "rchips lookchips", role: "tablist", "aria-label": t("look.cats") },
    [["", t("look.cat.all")], ...LOOK_CATEGORIES.map((k) => [k, t("look.cat." + k)]), used && ["used", t("look.cat.used")], ["liked", [ico("heart", 13), t("look.cat.liked")]]].filter(Boolean).map(([k, label]) =>
      el("button", { class: "rchip" + (LOOK_UI.tag === k ? " on" : ""), role: "tab", "aria-selected": String(LOOK_UI.tag === k), title: k === "used" ? t("look.cat.usedTip") : k === "liked" ? t("look.cat.likedTip") : null,
        onclick: () => { LOOK_UI.tag = k; for (const b of chips.children) { const on = b.dataset.k === k; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); } findLooks(); }, dataset: { k } }, label)));
  const find = (e) => { if (e.isComposing) return; LOOK_UI.q = e.target.value; findLooks(); };   // not while a word is being composed (pinyin, kana)
  return el("div", { class: "lookfind" },
    el("label", { class: "lookfind-q" }, ico("search", 16),
      el("input", { type: "text", value: LOOK_UI.q, placeholder: t("look.searchPh"), "aria-label": t("look.search"), spellcheck: false, autocomplete: "off", dataset: { k: "lookq" },
        oninput: find, oncompositionend: find,
        onkeydown: (e) => { if (e.key !== "Escape" || e.isComposing) return; e.stopPropagation(); if (e.target.value) { e.target.value = ""; LOOK_UI.q = ""; findLooks(); } else e.target.blur(); } })),   // Esc empties it first, then leaves it, as the Assets search's does
    chips);
}
/**
 * The search or the chip changed: the cards it lets through shown (the profile's own always), in ♥ Liked's order
 * there, the rest hidden, those shown drawn if stale; the line saying none is left when so. Scrolled to the top, but
 * not with `stay` (a look liked or unliked under ♥ Liked: the cards follow where they are).
 */
function findLooks(stay = false) {
  const grid = $("panel").querySelector(".lookgrid"), none = $("panel").querySelector(".lookgrid-none");
  if (!grid) return;
  const shown = lookFilter(), look = S.profile.style.look;
  let any = false;
  for (const card of grid.children) { const on = shown(card.dataset.id); card.hidden = !on && card.dataset.id !== look; any = any || on; }
  grid.classList.toggle("finding", lookFinding());
  sortLooks(grid);
  if (none) { none.hidden = !lookFinding() || any; none.textContent = noLooks(); }
  if (!stay) { grid.scrollTop = 0; LOOKCARDS.scroll = 0; hoverLook(null); }
  refreshLookCards();
}
/** Draws the cards waiting, one a frame, while the Look sheet is open; not while something is dragged (as the size thumbnails wait), nor one the search hides (drawn when it shows: refreshLookCards). */
function drawLookCards(round) {
  const next = () => {
    if (round !== LOOKCARDS.round || !onLookSheet()) return;
    if (LIVE || drafting()) return setTimeout(next, 300);
    let id;
    do id = LOOKCARDS.queue.shift(); while (id && LOOKCARDS.pics.get(id) && LOOKCARDS.pics.get(id).cv.parentNode.hidden);
    if (!id) return;
    const pic = LOOKCARDS.pics.get(id);
    if (pic) {
      try { paint(pic.cv, selSize(), 300, S.cover, catIndex(), null, null, { profile: inLook(id) }); if (!outlinesPending()) pic.sig = pic.want; }   // waiting for outlines: drawn again once they come
      catch (e) { console.error(e); pic.sig = pic.want; }   // one look failing leaves the others to be drawn
      finally { useLook(); }
    }
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}
/** A card under the pointer: the canvas shows its look a moment later; none (or the profile's own): the canvas as it is. */
function hoverLook(id) {
  previewSoon("look", id === S.profile.style.look ? null : id, onLookSheet);
}
/** A card clicked: its look is the profile's. */
function pickLook(id) {
  endPreview("look");
  const st = S.profile.style;
  if (st.look === id) return;
  st.look = id; countLook(id); touch({ profile: true, panel: true, side: true });   // the sizes are as they were: the thumbnails are drawn again in the look, not built anew
}
/** Over the canvas while a look, a text effect or a layout preset is previewed: which, and how it is put on; the preset's card says so too. */
function previewTag() {
  let tag = $("pvtag");
  if (!tag) { tag = el("div", { id: "pvtag" }); $("stage").append(tag); }
  const lang = getLang(), f = PREVIEW.fx, lay = PREVIEW.layout;
  tag.hidden = !PREVIEW.look && !f && !lay;
  if (PREVIEW.look) tag.textContent = t("look.previewing", LOOKS[PREVIEW.look].name[lang]);
  else if (f) tag.textContent = t("fx.previewing", f.fx === "auto" ? t("fx.cardAuto") : EFFECTS[f.fx].name[lang]);
  else if (lay) tag.textContent = t("layouts.previewing", lay.name);
  for (const c of document.querySelectorAll("#panel .preset")) c.classList.toggle("previewing", !!lay && c.dataset.id === lay.id);
}
/**
 * Whether the Layout sheet shows the template box (layoutBox): hidden for now, the colour block's position (the
 * template), size and slant and Block by orientation in its own properties (blockSection); layoutBox and
 * templateControls stay.
 */
const TEMPLATE_BOX = false;
/** Layout: the layout presets, the template at this size (while TEMPLATE_BOX), the colour block's edge, which parts show, and all the layout hidden or put back in place. */
function layoutSheet() {
  const off = layoutLayers().every((l) => !l.visible);
  return [
    sheetHead(t("sheet.layout"), t("sheet.layoutSub")),
    presetCards(),
    TEMPLATE_BOX && layoutBox(),
    shapesSection(),
    partsBox(),
    el("div", { class: "sheet-foot" },
      el("div", { class: "togrow", title: t("layout.tip") },
        el("div", { style: "flex:1;min-width:0" }, el("div", { style: "font-weight:700" }, t("layout.hideAll")), el("div", { class: "hint", style: "margin:2px 0 0" }, t("layout.hideAllSub"))),
        el("button", { class: "tog" + (off ? " on" : ""), role: "switch", "aria-checked": String(off), "aria-label": t("layout.hideAll"), onclick: () => { toggleLayout(); renderPanel(); } })),
      el("button", { class: "linkbtn", onclick: resetPlaces }, t("style.resetAll"))),
  ];
}
/**
 * Layout → the layout presets, two to a row, each a card: this cover laid out by it (presetPic), its name, and a word
 * while the canvas previews it; first the canvas as it is, marked Current. A preset's card under the pointer is
 * previewed on the canvas (hoverPreset) and says over its picture that a click puts it on (applyLayout); its ⋯ renames
 * it where it is, edits it in the preset's editor (layoutEditor), sets its chance in Surprise me (oddsDialog), or
 * deletes it. ＋ New lays one out in the editor from the start (each orientation in its default layout, every part in
 * it: see newPreset in layers.js), kept once saved there. Surprise me deals them by their chances.
 */
function presetCards() {
  const list = S.settings.layouts;
  for (const [id, pic] of PRESET_PICS.pics) if (id && !list.some((p) => p.id === id)) { PRESET_PICS.io.unobserve(pic.cv); PRESET_PICS.pics.delete(id); }   // a preset deleted
  const now = el("div", { class: "preset now", title: t("layouts.nowTip"), onpointerenter: () => hoverPreset(null) },
    el("div", { class: "pthumb" }, presetPic("", null).cv),
    el("div", { class: "pcap" }, el("span", { class: "nm" }, t("layouts.now")), el("span", { class: "pv" }, t("layouts.current"))));
  const card = (p, i) => {
    const put = () => applyLayout(p, i), name = el("span", { class: "nm" }, layoutName(p, i));
    const menu = el("div", { class: "chmenu", role: "menu", hidden: true },
      el("button", { role: "menuitem", onclick: () => { shut(); renamePreset(name, p, i); } }, t("layouts.rename")),
      el("button", { role: "menuitem", onclick: () => { shut(); endPreview("layout"); layoutEditor(p, i); } }, t("layouts.edit")),
      el("button", { role: "menuitem", onclick: () => { shut(); endPreview("layout"); oddsDialog(true, "layouts"); } }, t("layouts.odds")),
      el("button", { role: "menuitem", class: "danger", onclick: () => { shut(); endPreview("layout"); deleteLayout(p, i, renderPanel); } }, t("layouts.delete")));
    const more = el("button", { class: "more", title: t("layouts.more"), "aria-label": t("layouts.more"), "aria-haspopup": "menu", "aria-expanded": "false",
      onclick: () => { const open = menu.hidden; shutPresetMenus(); menu.hidden = !open; more.setAttribute("aria-expanded", String(open)); } }, "⋯");
    const shut = () => { menu.hidden = true; more.setAttribute("aria-expanded", "false"); };
    return el("div", { class: "preset" + (PREVIEW.layout && PREVIEW.layout.id === p.id ? " previewing" : ""), dataset: { id: p.id }, onpointerenter: () => hoverPreset(p, i) },
      el("button", { class: "pthumb", title: t("layouts.applyTip"), "aria-label": `${layoutName(p, i)} · ${t("layouts.apply")}`, onclick: put }, presetPic(p.id, p).cv, el("span", { class: "go" }, el("span", {}, t("layouts.apply")))),
      el("div", { class: "pcap", onclick: (e) => { if (e.target.tagName !== "INPUT") put(); } }, name, el("span", { class: "pv" }, t("layouts.previewingCard"))),
      more, menu);
  };
  requestAnimationFrame(refreshPresetPics);   // the pictures in sight drawn where stale, once the cards are in the page
  return el("div", {},
    el("div", { class: "lhead", style: "margin-bottom:8px" }, capInfo("layouts.list", t("layouts.about")),
      el("button", { class: "linkbtn", disabled: list.length >= LAYOUTS.most, title: t("layouts.newTip"),
        onclick: () => layoutEditor(normalizeLayouts([{ ...newPreset(), id: newLayoutId(), name: nextLayoutName() }])[0], list.length, true) }, t("layouts.new"))),
    el("div", { class: "presets", onpointerleave: () => hoverPreset(null) }, now, list.map(card)),
    !list.length && el("div", { class: "hint presets-none" }, t("layouts.none")));
}
/** Shuts the preset cards' ⋯ menus. */
function shutPresetMenus() {
  for (const m of document.querySelectorAll(".preset .chmenu")) m.hidden = true;
  for (const b of document.querySelectorAll(".preset .more[aria-expanded=true]")) b.setAttribute("aria-expanded", "false");
}
// a press anywhere but on a preset card's ⋯ or its menu shuts the menu
addEventListener("pointerdown", (e) => { if (!(e.target.closest && e.target.closest(".preset .chmenu, .preset .more"))) shutPresetMenus(); }, true);
/** Renames preset `p` (the i-th) where its card shows its name (`name`): a field in its place, Enter (or leaving it) keeps what is typed, Escape the name as it was. */
function renamePreset(name, p, i) {
  let gone = false;
  const back = (keep) => {
    if (gone) return;
    gone = true;
    if (keep) { p.name = input.value.trim().slice(0, LAYOUTS.name); persistSettings(); }
    name.textContent = layoutName(p, i);
    input.replaceWith(name);
  };
  const input = el("input", { type: "text", value: p.name, placeholder: layoutName(p, i), maxLength: LAYOUTS.name, spellcheck: false, title: t("layouts.renameTip"),
    onkeydown: (e) => { if (e.isComposing) return; if (e.key === "Enter") back(true); if (e.key === "Escape") { e.stopPropagation(); back(false); } },
    onblur: () => back(true) });
  name.replaceWith(input);
  input.focus(); input.select();
}
/**
 * Each layout preset card's picture, kept from one drawing of the Layout sheet to the next: {cv, p, sig, seen} by preset
 * id ("" the canvas as it is), where `sig` is what it was drawn from (the cover, the profile, the size and the preset)
 * and `seen` whether its card is in sight (`io`). Drawn one a frame, those in sight that are stale, a moment after a
 * change; not while something is dragged. `round`: the drawing's turn (a newer one stops an older).
 */
const PRESET_PICS = { pics: new Map(), round: 0, io: null };
const onLayoutSheet = () => S.mode === "edit" && !sheetHidden() && S.tab.edit === "layout";
/** The card picture of preset `p` (null: the canvas as it is), keyed `id`: its canvas kept, watched for being in sight. */
function presetPic(id, p) {
  let pic = PRESET_PICS.pics.get(id);
  if (!pic) {
    pic = { cv: el("canvas", { width: 300, height: 169 }), p, sig: "", seen: false };
    PRESET_PICS.pics.set(id, pic);
    PRESET_PICS.io = PRESET_PICS.io || new IntersectionObserver((seen) => {
      for (const e of seen) { const x = [...PRESET_PICS.pics.values()].find((q) => q.cv === e.target); if (x) x.seen = e.isIntersecting; }
      if (seen.some((e) => e.isIntersecting)) refreshPresetPics();
    });
    PRESET_PICS.io.observe(pic.cv);
  }
  pic.p = p;
  return pic;
}
/** What the preset cards' pictures are drawn from but the preset: the cover, the profile, the size on the canvas. */
const presetBase = () => JSON.stringify([S.sel, S.cover.catId, S.cover.title, S.cover.subtitle, S.cover.tag, S.cover.layers, S.cover.scene, S.profile.brand, S.profile.categories, S.profile.sizes, S.profile.style, S.photos.size]);
/**
 * Draws the preset cards' pictures that are stale and in sight while the Layout sheet is open, as many a frame as fit in
 * a few milliseconds (one at least): the cover at the size on the canvas, laid out by the preset as the canvas previews
 * it (laidOut), twice as many pixels across as it is shown. Not while something is dragged (as the size thumbnails wait).
 */
function refreshPresetPics() {
  if (!onLayoutSheet()) return;
  const round = ++PRESET_PICS.round, base = presetBase(), z = selSize(), drawn = new Set();   // drawn: once a round (one waiting for outlines is drawn again once they come, see flushDraw)
  let px = 0;   // the pictures' width in pixels, the same for every card: measured once the cards are laid out
  const sigOf = (pic) => {
    if (!px) { const box = pic.cv.parentNode; px = Math.round(2 * Math.min((box && box.clientWidth) || 150, (((box && box.clientHeight) || 84) * z.w) / z.h)); }
    return `${base}|${px}|${pic.p ? JSON.stringify(pic.p) : ""}`;
  };
  const next = () => {
    if (round !== PRESET_PICS.round || !onLayoutSheet()) return;
    if (LIVE || drafting()) return setTimeout(next, 300);
    const start = performance.now();
    let pic;
    while ((pic = [...PRESET_PICS.pics.values()].find((x) => x.seen && x.cv.isConnected && !drawn.has(x) && x.sig !== sigOf(x)))) {
      const sig = sigOf(pic), { profile, cover } = pic.p ? laidOut(pic.p) : { profile: S.profile, cover: S.cover };
      drawn.add(pic);
      try { paint(pic.cv, z, px, cover, catIndex(), null, null, { profile }); pic.sig = outlinesPending() ? "" : sig; }   // waiting for outlines: drawn again once they come
      catch (e) { console.error(e); pic.sig = sig; }   // one failing leaves the others to be drawn
      finally { useLook(); }
      if (performance.now() - start > 8) return requestAnimationFrame(next);   // the rest in the frames to come
    }
  };
  requestAnimationFrame(next);
}
/** A preset's card under the pointer: the canvas shows the cover laid out by it a moment later (PREVIEW.layout); none: as it is. */
function hoverPreset(p, i) {
  if (!p) return previewSoon("layout", null);
  previewSoon("layout", { id: p.id, name: layoutName(p, i), p }, () => S.mode === "edit" && !sheetHidden() && S.tab.edit === "layout" && S.settings.layouts.includes(p));
}
/** The profile and the cover as applyLayout would leave them with preset `p` put on, at the profile's sizes: copies, made as the canvas is drawn, so they follow whatever changes meanwhile. */
function laidOut(p) {
  const style = copyOf(S.profile.style), layers = S.cover.layers.map((l) => (LAYOUT_PARTS.includes(l.id) ? copyOf(l) : l));
  putLayout(style, layers, p, sizeKeys());
  return { profile: { ...S.profile, style }, cover: { ...S.cover, layers } };
}
/** The default design (the ⋯ menu): the cover's layers but its photos kept as the profile's start, or taken back from it. */
function saveDesign() { S.profile.design.layers = JSON.parse(JSON.stringify(S.cover.layers.filter((l) => l.type !== "photo"))); touch({ profile: true }); toast(t("style.designSaved")); }
function loadDesign() { S.cover.layers = keepPhotos(JSON.parse(JSON.stringify(S.profile.design.layers)), S.cover.layers); S.layerId = "title"; touch({ cover: true, side: true, panel: onCoverTab() }); }
function resetPlaces() { for (const L of S.cover.layers) if (isLayout(L)) resetPlacement(L, "all"); touch({ cover: true, side: true }); }

// ---------- Settings' pages (S.mode "setup")
/** A small picture of graphic `ref` (null: none) in the channel colour `colour`, `px` across. */
function graphicThumb(ref, colour, px) {
  const cv = el("canvas", { width: px * 2, height: px * 2, style: `width:${px}px;height:${px}px` });
  if (ref && assetExists(ref)) { const x = cv.getContext("2d"); x.translate(px, px); x.scale((px * 2) / 700, (px * 2) / 700); useLook(); drawAsset(x, ref, hexToRgb(colour), { tint: ref.kind === "graphic" || canTint(ref) }); }
  return cv;
}
/**
 * A graphic picked by its picture: channel graphics, my vector assets, the stickers by group, or the first
 * tile (none, done(null)). `cur`: the one picked now (null: the first). opts: `title`; `first` {label, ref,
 * cap}, the first tile (by default "No graphic"), showing `ref`'s picture under the caption `cap`; `upload`,
 * a button to upload a picture (kept with my assets) and pick it, with `hint` under it; `subjects`, the
 * photos' cut-out subjects (see subjectTiles).
 */
function graphicPicker(cur, colour, done, opts = {}) {
  const lang = getLang(), m = $("modal"), on = cur ? `${cur.kind}:${cur.id}` : "none", first = opts.first || { label: t("cat.none") };
  const pick = (ref, label, as = ref) => el("div", { class: "tile" + ((as ? `${as.kind}:${as.id}` : "none") === on ? " on" : ""), title: label, onclick: () => { closeModal(); done(as); } },
    ref ? graphicThumb(ref, colour, 66) : el("span", { class: "none" }, label));
  const group = (title, refs) => (refs.length ? el("div", {}, el("label", { class: "cap" }, title), el("div", { class: "tiles" }, refs.map(([ref, label]) => pick(ref, label)))) : null);
  const upload = async () => {
    const id = await adoptImage(await pickFile("image/png,image/webp,image/svg+xml,image/jpeg"));
    if (id === undefined) return;
    if (!id) return toast(t("msg.badFile"));
    closeModal(); done({ kind: "user", id });
  };
  m.replaceChildren(el("div", { class: "dlg wide" }, el("h2", {}, opts.title || t("cat.pickTitle")),
    first.cap && el("label", { class: "cap" }, first.cap),
    el("div", { class: "tiles" }, pick(first.ref && assetExists(first.ref) ? first.ref : null, first.label, null)),
    opts.upload && el("div", { style: "margin:10px 0 4px" }, el("button", { class: "btn", onclick: upload }, t("style.artUpload")), opts.hint && el("div", { class: "hint" }, opts.hint)),
    opts.subjects && el("div", {}, el("label", { class: "cap" }, t("style.artSubjects")), el("div", { class: "hint", style: "margin:0 0 8px" }, t(canCut() ? "style.artSubjectsHint" : "style.artSubjectsHintCut")),
      subjectTiles((ref) => { closeModal(); done(ref); })),
    group(t("cat.groupGraphics"), GRAPHICS.map((g) => [{ kind: "graphic", id: g.id }, g.name[lang]])),
    group(t("cat.groupMine"), [...userAssets.values()].map((a) => [{ kind: "user", id: a.id }, a.name])),
    STICKER_GROUPS.map((g) => group(`${t("cat.groupStickers")} · ${g.name[lang]}`, STICKERS.filter((s) => s.group === g.id).map((s) => [{ kind: "sticker", id: s.id }, s.name[lang]]))),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: closeModal }, t("lookfx.cancel")))));
  m.hidden = false;
}
/**
 * The figure picker's cut-out subjects: the pictures of the bitmap library and of this cover whose subject
 * is cut out, shown cut out; in the app the others too, marked, which are cut out when clicked. A click
 * keeps the subject, cropped to it, with my assets and picks that. Filled again as the library's pictures
 * come in.
 */
function subjectTiles(done) {
  const box = el("div", {});
  const fill = () => {
    const pids = [...new Set([...S.library.map((e) => e.pid), ...pidsOf(S.cover)])].filter((pid) => S.photos.has(pid) && (S.photos.get(pid).mask || canCut()));
    box.replaceChildren(pids.length
      ? el("div", { class: "tiles" }, pids.map((pid) => {
          const rec = S.photos.get(pid), cut = !!rec.mask;
          return el("div", { class: "tile ptile", title: t(cut ? "style.artSubjectTip" : "style.artCutTip"), onclick: (e) => {
              const badge = !rec.mask && !CUT.busy && e.currentTarget.querySelector(".kind");
              if (badge) badge.textContent = t("cut.busy");   // until it is cut out, or not
              pickSubject(pid, done, () => box.isConnected).then(() => box.isConnected && fill());
            } },
            el("img", { src: cut ? cutThumb(rec) : thumbOf(rec), alt: "", draggable: false, style: cut ? "object-fit:contain" : "" }), !cut && el("span", { class: "kind" }, t("style.artCut")));
        }))
      : el("div", { class: "hint", style: "margin:0" }, t(canCut() ? "style.artNoPhotos" : "style.artNoSubjects")));
  };
  LIB.redraw = fill; readLibrary(); fill();
  return box;
}
/**
 * Picks picture `pid`'s subject (cutting it out first when it is not yet): kept with my assets, done({kind:
 * "user", id}). `open()`: whether the picker is still there; when a cut ends after it was closed (or another
 * pick made), the mask is kept and nothing else happens.
 */
async function pickSubject(pid, done, open = () => true) {
  const rec = S.photos.get(pid);
  if (!rec) return;
  if (!rec.mask) {
    if (CUT.busy) return;   // one cut at a time; the subjects cut out already can still be picked meanwhile
    toast(t("cut.busy"));
    const ok = await ensureMask(pid);
    if (!open()) return;
    if (!ok) return toast(CUT.error || t("cut.none"));
  }
  const src = subjectPng(rec);
  if (!src) return toast(t("cut.none"));
  const named = S.library.find((e) => e.pid === pid), id = await adoptAsset((named && named.name) || t("style.artSubjectName"), src);
  if (!open()) return;
  if (!id) return toast(t("msg.badFile"));
  done({ kind: "user", id });
}
/** A picture's subject alone (its mask applied), cropped to it, no longer than `max` on its longer side: a PNG data URL, or null when the mask holds nothing. */
function subjectPng(rec, max = 1100) {
  const [W, H] = sizeOf(rec.img), M = rec.mask.img, [mW, mH] = sizeOf(M);
  // where the subject is, read off the mask at a small size
  const k0 = Math.min(1, 256 / Math.max(mW, mH)), sw = Math.max(1, Math.round(mW * k0)), sh = Math.max(1, Math.round(mH * k0)), c = el("canvas", { width: sw, height: sh }), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(M, 0, 0, sw, sh);
  const a = x.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let i = 3, q = 0; i < a.length; i += 4, q++) if (a[i] > 24) { const px = q % sw, py = (q / sw) | 0; if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; }
  if (x1 < 0) return null;
  // that box, a cell wider each side, on the picture and on the mask
  const bx = Math.max(0, ((x0 - 1) / sw) * W), by = Math.max(0, ((y0 - 1) / sh) * H), bw = Math.min(W, ((x1 + 2) / sw) * W) - bx, bh = Math.min(H, ((y1 + 2) / sh) * H) - by;
  const k = Math.min(1, max / Math.max(bw, bh)), out = el("canvas", { width: Math.max(1, Math.round(bw * k)), height: Math.max(1, Math.round(bh * k)) }), o = out.getContext("2d");
  o.imageSmoothingQuality = "high";
  o.drawImage(rec.img, bx, by, bw, bh, 0, 0, out.width, out.height);
  o.globalCompositeOperation = "destination-in";
  o.drawImage(M, (bx / W) * mW, (by / H) * mH, (bw / W) * mW, (bh / H) * mH, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
/**
 * An SVG with a width and a height on it: one with only a viewBox (or nothing) has no size of its own, and
 * the web view then may not draw it at all. Its viewBox's proportions, the long side 600; else a square.
 */
function sizedSvg(text) {
  const tag = (/<svg\b[^>]*>/i.exec(text) || [])[0];
  if (!tag || (/\swidth\s*=/i.test(tag) && /\sheight\s*=/i.test(tag))) return text;
  const vb = /viewBox\s*=\s*["']\s*[-\d.eE]+[\s,]+[-\d.eE]+[\s,]+([\d.eE]+)[\s,]+([\d.eE]+)/i.exec(tag), vw = vb ? Number(vb[1]) : 1, vh = vb ? Number(vb[2]) : 1;
  const k = 600 / Math.max(vw, vh) || 600, w = Math.round(vw * k) || 600, h = Math.round(vh * k) || 600;
  return text.replace(tag, tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "").replace(/<svg\b/i, `<svg width="${w}" height="${h}"`));
}
/** Keeps a picked image file with the user's assets (an SVG given a size): its id, null when it cannot be read, undefined when none was picked. */
async function adoptImage(f, name = "asset") {
  if (!f) return undefined;
  const svg = /svg/i.test(f.type) || /\.svg$/i.test(f.name);
  const src = svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg(await readAs(f, "readAsText")))}` : await readAs(f, "readAsDataURL");
  return adoptAsset(f.name.replace(/\.[^.]+$/, "").slice(0, 60) || name, src);
}
/** Uploads a picture as the profile's brand logo: kept with the user's assets (so it travels with an exported profile), shown on this cover. */
async function uploadLogo() {
  const id = await adoptImage(await pickFile("image/png,image/jpeg,image/webp,image/svg+xml"), "logo");
  if (id === undefined) return;
  if (!id) return toast(t("msg.badFile"));
  S.profile.brand.logo = id;
  const L = layer("logo");
  if (L) { delete L.off; L.visible = true; }   // uploading one is wanting it on the cover
  touch({ profile: true, cover: true, panel: true, side: true });
}
/** The settings window's state: `at`, a card of the page to bring into view when it is next drawn ("batch", "image", "cut"); `menu`, the channel whose ⋯ is open. */
const SET_UI = { at: "", menu: "" };
/** The profile's logo: its picture (or a place for one), Upload or Replace, Remove. In Settings → Brand, and the logo layer's properties. */
function logoControls() {
  const P = S.profile, a = P.brand.logo && userAssets.get(P.brand.logo);
  return el("div", { class: "logo-row" },
    el("span", { class: "lthumb" + (a ? "" : " none") }, a ? graphicThumb({ kind: "user", id: a.id }, cat().color, 40) : "＋"),
    el("button", { class: "btn", onclick: uploadLogo }, t(a ? "brand.logoSwap" : "brand.logoUp")),
    a ? el("button", { class: "linkbtn", onclick: () => { P.brand.logo = ""; touch({ profile: true, panel: true, side: true }); } }, t("brand.logoDrop")) : el("small", {}, t("brand.logoKind")));
}
/** What the brand row's number says on this channel's cover, as drawn (see the brand row in render.js). */
const counterText = (P) => [P.brand.unit, P.categories.length > 1 ? `${String(catIndex() + 1).padStart(2, "0")} / ${String(P.categories.length).padStart(2, "0")}` : ""].filter(Boolean).join(" ");
/** The brand row's preview: the brand's name, this channel's code on its colour, the number. */
const brandPreview = (P) => [P.brand.name, cat().code && el("i", { style: `background:${cat().color};color:${inkOn(cat().color)}` }, cat().code), el("b", {}, counterText(P))];
/**
 * Settings → Brand: the profile's name, the brand's name and logo, the number on the brand row (with a preview); then
 * the channels, a card each — its grip to drag it among the others (chDrag), colour, name, sub-name, code, graphic, ⋯
 * to move or delete it — the one on the canvas marked, a click on any showing it there; a card to add one.
 */
function brandTab() {
  const P = S.profile, lang = getLang(), struct = () => touch({ profile: true, cover: true, panel: true, side: true });
  const field = (key, sub, kid) => el("div", { class: "fld" }, el("div", { class: "cap" }, t(key), sub && el("small", {}, sub)), kid);
  const pin = (key, kid) => el("label", { class: "pin" }, el("span", {}, t(key)), kid);   // an input with its name inside
  const card = (c, i) => {
    const lib = c.graphic.kind === "graphic" && GRAPHICS.find((g) => g.id === c.graphic.id), here = S.cover.catId === c.id, open = SET_UI.menu === c.id;
    // working on a channel shows that channel on the canvas
    const show = (e) => { if (!e.target.closest(".more, .chmenu, .grip") && S.cover.catId !== c.id) switchChannel(c.id); };   // not its ⋯ and menu, nor its grip: a re-render would take the click, or the drag
    const move = (to) => { P.categories.splice(to, 0, P.categories.splice(i, 1)[0]); SET_UI.menu = ""; struct(); };   // to place `to`: the ⋯ menu's Up and Down, and the card dragged by its grip
    const remove = () => {
      SET_UI.menu = "";
      if (P.categories.length < 2) { renderPanel(); return toast(t("msg.lastCategory")); }
      const [gone] = P.categories.splice(i, 1);
      delete S.covers[gone.id]; files.remove(coverPath(P.id, gone.id)).catch(() => null);   // its cover goes with it
      if (S.cover.catId === gone.id) { S.settings.channels[P.id] = P.categories[0].id; persistSettings(); setCover(coverFor(P.categories[0].id)); loadPhotos(pidsOf(S.cover)).then(() => queueDraw()); }
      else setCover(normalizeCover(S.cover, P));
      struct();
    };
    return el("div", { class: "chcard" + (here ? " here" : ""), style: `--c:${c.color}`, onfocusin: show, onpointerdown: show, oninput: show },
      el("div", { class: "chrow" },
        P.categories.length > 1 && el("span", { class: "grip", title: t("cat.drag"), "aria-hidden": "true", onpointerdown: (e) => chDrag(e, move) }, "⋮⋮"),   // the ⋯ menu's Up and Down do it from the keyboard
        el("label", { class: "swc", title: t("cat.color") }, el("input", { type: "color", value: c.color, oninput: (e) => { c.color = e.target.value; e.target.closest(".chcard").style.setProperty("--c", c.color); document.documentElement.style.setProperty("--acc", c.color); touch({ profile: true }); } })),
        textInput(c.name, (v) => { c.name = v; touch({ profile: true }); }, { placeholder: t("cat.name"), class: "chname" }),
        el("button", { class: "more", title: t("cat.more"), "aria-expanded": String(open), onclick: () => { SET_UI.menu = open ? "" : c.id; renderPanel(); } }, "⋯")),
      open && el("div", { class: "chmenu" },
        el("button", { disabled: i === 0, onclick: () => move(i - 1) }, t("cat.up")),
        el("button", { disabled: i === P.categories.length - 1, onclick: () => move(i + 1) }, t("cat.down")),
        el("button", { class: "danger", onclick: remove }, t("cat.remove"))),
      el("div", { class: "two" },
        pin("cat.subShort", textInput(c.sub, (v) => { c.sub = v; touch({ profile: true }); })),
        pin("cat.code", textInput(c.code, (v) => { c.code = v; touch({ profile: true }); }))),
      el("button", { class: "gpick", title: t("cat.pickTip"), onclick: () => graphicPicker(c.graphic.kind === "none" ? null : c.graphic, c.color, (ref) => { c.graphic = ref ? { kind: ref.kind, id: ref.id, labels: [], stamp: "" } : { kind: "none" }; struct(); }) },
        graphicThumb(c.graphic.kind === "none" ? null : c.graphic, c.color, 32), el("span", {}, c.graphic.kind === "none" ? t("cat.none") : assetExists(c.graphic) ? assetName(c.graphic, lang) : t("assets.missing")), el("span", { class: "more" }, t("cat.pick"))),
      lib && lib.labels && textInput((c.graphic.labels || []).join("，"), (v) => { c.graphic.labels = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 4); touch({ profile: true }); }, { placeholder: t("cat.labels") }),
      lib && lib.stamp && textInput(c.graphic.stamp || "", (v) => { c.graphic.stamp = v; touch({ profile: true }); }, { placeholder: t("cat.stamp") }),
      here && el("span", { class: "pill" }, t("brand.onCanvas")));
  };
  const preview = el("span", { class: "pv" }, brandPreview(P)), redo = () => preview.replaceChildren(...brandPreview(P).filter(Boolean));
  return [
    el("div", { class: "sh" }, el("b", {}, t("tab.brand")), el("span", {}, t("brand.pageSub"))),
    el("div", { class: "fields3" },
      field("brand.profileName", "", textInput(P.name, (v) => { P.name = v; touch({ profile: true }); later("top", 600, () => { syncTop(); syncTabs(); }); })),
      field("brand.name", t("brand.nameSub"), textInput(P.brand.name, (v) => { P.brand.name = v; touch({ profile: true }); redo(); })),
      field("brand.logo", t("brand.logoSub"), logoControls())),
    el("div", { class: "scard counter" },
      el("button", { class: "tog" + (P.brand.counter ? " on" : ""), role: "switch", "aria-checked": String(!!P.brand.counter), "aria-label": t("brand.counter"), onclick: () => { P.brand.counter = !P.brand.counter; touch({ profile: true, panel: true }); } }),
      el("div", { class: "grow" }, el("b", {}, t("brand.counter"), " ", info(t("brand.unitHint"))), el("small", {}, t("brand.counterSub"))),
      el("span", { class: "lab" }, t("brand.unit")),
      textInput(P.brand.unit, (v) => { P.brand.unit = v; touch({ profile: true }); redo(); }, { disabled: !P.brand.counter, class: "unit" }),
      P.brand.counter && [el("span", { class: "lab" }, t("brand.preview")), preview]),
    el("div", { class: "cap" }, t("brand.channelsN", P.categories.length), el("small", {}, [P.categories.length > 1 && t("brand.channelsDrag"), t("brand.channelsSub")].filter(Boolean).join(" · "))),
    el("div", { class: "chgrid" }, P.categories.map(card),
      el("button", { class: "chadd", onclick: () => {
        const palette = ["#ffb703", "#fb5607", "#3a86ff", "#a855f7", "#06d6a0", "#ff5fa2"];
        P.categories.push({ id: uid(), name: t("cat.new"), sub: "", code: "", color: palette[P.categories.length % palette.length], graphic: { kind: "graphic", id: GRAPHICS[P.categories.length % GRAPHICS.length].id, labels: [], stamp: "" } });
        struct();
      } }, el("b", {}, t("brand.add")), el("small", {}, t("brand.addSub")))),
  ];
}
/**
 * A channel card dragged by its grip (e, the press on it) in Settings → Brand & channels: the card rises and follows
 * the pointer, a place in its colour opens where it would go, before or after the card nearest its middle, and the
 * others make room; let go, it moves there as the ⋯ menu's Up and Down move it (`move(to)`, its place among the
 * others: one step of undo, the profile saved). The page scrolls when the pointer nears its top or foot. Esc, or the
 * press taken away (the page drawn again meanwhile), leaves it where it was.
 */
function chDrag(e, move) {
  if (e.button !== 0 || !e.isPrimary) return;
  e.preventDefault();   // no text chosen, no field left
  const grip = e.currentTarget, card = grip.closest(".chcard"), grid = card.parentElement, page = grid.closest(".scroll");
  grip.setPointerCapture(e.pointerId);   // first: should it fail, nothing has changed
  const others = () => [...grid.children].filter((n) => n.classList.contains("chcard") && n !== card);
  const from = [...grid.children].filter((n) => n.classList.contains("chcard")).indexOf(card), r = card.getBoundingClientRect();
  const grab = { x: e.clientX - r.left, y: e.clientY - r.top };
  let x = e.clientX, y = e.clientY, frame = 0, done = false;
  const hole = el("div", { class: "chhole", style: `--c:${card.style.getPropertyValue("--c")};min-height:${Math.round(r.height)}px` });
  card.before(hole);
  card.classList.add("lifted"); card.style.width = r.width + "px";
  document.body.classList.add("chdrag");
  const place = () => {   // the card kept over the grid, under the pointer; the place goes where the card's middle is
    const g = grid.getBoundingClientRect();
    const left = clamp(x - grab.x - g.left, 0, Math.max(0, g.width - r.width)), top = clamp(y - grab.y - g.top, -r.height / 2, Math.max(0, g.height - r.height / 2));
    card.style.left = left + "px"; card.style.top = top + "px";
    const cx = g.left + left + r.width / 2, cy = g.top + top + r.height / 2;
    let near = null, best = Infinity;
    for (const o of others()) {
      const b = o.getBoundingClientRect(), d = Math.hypot(Math.max(b.left - cx, 0, cx - b.right), Math.max(b.top - cy, 0, cy - b.bottom));
      if (d < best) { best = d; near = { o, b }; }
    }
    if (!near) return;
    // after it when lower than it; in its row, when right of its middle (one card a row, a narrow window: lower than its middle)
    const across = getComputedStyle(grid).gridTemplateColumns.split(" ").length > 1;
    const after = !across ? cy > near.b.top + near.b.height / 2 : cy > near.b.bottom || (cy >= near.b.top && cx > near.b.left + near.b.width / 2);
    let at = after ? near.o.nextElementSibling : near.o;
    if (at === card) at = card.nextElementSibling;   // the card itself takes no place while it is up
    if (at !== hole && at !== hole.nextElementSibling && !(at === card.nextElementSibling && hole.nextElementSibling === card)) grid.insertBefore(hole, at);
  };
  const tick = () => {   // near the page's top or foot, it scrolls, the place following
    if (!card.isConnected) return end(false);   // the page drawn again under it
    const p = page && page.getBoundingClientRect(), edge = 56;
    const by = !p ? 0 : y < p.top + edge ? -Math.ceil((p.top + edge - y) / 4) : y > p.bottom - edge ? Math.ceil((y - p.bottom + edge) / 4) : 0;
    if (by) { const was = page.scrollTop; page.scrollTop += by; if (page.scrollTop !== was) place(); }
    frame = requestAnimationFrame(tick);
  };
  const end = (keep) => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame); removeEventListener("keydown", esc, true);
    grip.onpointermove = grip.onpointerup = grip.onpointercancel = grip.onlostpointercapture = null;
    const to = [...grid.children].filter((n) => n === hole || (n.classList.contains("chcard") && n !== card)).indexOf(hole);
    hole.remove(); card.classList.remove("lifted"); card.style.left = card.style.top = card.style.width = "";
    document.body.classList.remove("chdrag");
    if (keep && to >= 0 && to !== from && card.isConnected) move(to);
  };
  const esc = (k) => { if (k.key === "Escape") { k.preventDefault(); k.stopPropagation(); end(false); } };   // before Settings takes it to close
  addEventListener("keydown", esc, true);
  grip.onpointermove = (m) => { x = m.clientX; y = m.clientY; place(); };
  grip.onpointerup = () => end(true);
  grip.onpointercancel = grip.onlostpointercapture = () => end(false);
  place(); frame = requestAnimationFrame(tick);
}
// a press anywhere but on a channel's ⋯ menu shuts it
addEventListener("pointerdown", (e) => {   // the page is not drawn again: the press goes on to what it is on
  if (!SET_UI.menu || (e.target.closest && e.target.closest(".chmenu, .chcard .more"))) return;
  SET_UI.menu = "";
  for (const m of document.querySelectorAll(".chcard .chmenu")) m.remove();
  for (const b of document.querySelectorAll(".chcard .more[aria-expanded=true]")) b.setAttribute("aria-expanded", "false");
}, true);
/**
 * Settings → Sizes & export: every size there is (the presets, then the user's own), each a row — a name of the user's
 * own, its ratio, the platforms it is for, its pixels, a switch to make covers at it (one at least); a size of one's
 * own to add; the format and the resolution, the file names with an example, the folder they go into; and the batch
 * export from a table.
 */
function sizesTab() {
  const P = S.profile, se = S.settings, lang = getLang();
  const has = (s) => P.sizes.some((x) => sizeKey(x) === sizeKey(s));
  const toggle = (s, on) => {
    if (on && !has(s)) {
      P.sizes.push({ w: s.w, h: s.h, label: s.label || "", name: "" });
      layoutAdded(P.style, P.sizes, sizeKey(s));   // drawn as the sizes facing its way are, else in its orientation's default layout
      const off = se.exportSizes[P.id];   // a size taken again starts ticked in the Export window, as a new one does
      if (off && sizeKey(s) in off) { delete off[sizeKey(s)]; persistSettings(); }
    }
    if (!on) { if (P.sizes.length < 2) { toast(t("exp.lastSize")); return renderPanel(); } P.sizes = P.sizes.filter((x) => sizeKey(x) !== sizeKey(s)); followLayout(P.style, sizeKey(s)); }   // its layout of its own goes with it
    if (!P.sizes.some((x) => sizeKey(x) === S.sel)) S.sel = sizeKey(P.sizes[0]);
    // the sizes a layer shows at (see `sizes` in layers.js) kept to those now, as they are when read again: on the design
    // and the cover shown, both in this one step of undo; another channel's when it is next shown (coverFor), so undone
    // before then, it is as it was, nothing of it written meanwhile
    refitSizes(P.design.layers, sizeKeys());
    refitSizes(S.cover.layers, sizeKeys());
    syncToolbar(); touch({ profile: true, cover: true, strip: true, panel: true, side: true });
  };
  const custom = P.sizes.filter((s) => !SIZE_PRESETS.some((p) => sizeKey(p) === sizeKey(s)));
  const row = (s) => {
    const mine = P.sizes.find((x) => sizeKey(x) === sizeKey(s)), on = !!mine, plats = platformsFor(s.w, s.h, lang).join(" · ") || s.label || t("exp.custom");
    return el("div", { class: "szrow" + (on ? " on" : "") },
      textInput(mine ? mine.name : "", (v) => { mine.name = v.trim().slice(0, 40); persistProfile(); recordHistory(); later("strip", 250, () => { buildStrip(); syncToolbar(); queueDraw(); }); },
        { placeholder: on ? t("exp.namePh") : "", disabled: !on, maxLength: 40, title: t("exp.namesHint") }),
      el("span", { class: "ratio" }, ratioText(s.w, s.h)),
      el("span", { class: "plats", title: plats }, plats),
      el("span", { class: "px" }, `${s.w} × ${s.h}`),
      el("button", { class: "tog" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": sizeLabel(s), onclick: () => toggle(s, !on) }));
  };
  const cw = el("input", { type: "number", min: 64, max: 8192, value: 1280 }), chh = el("input", { type: "number", min: 64, max: 8192, value: 720 });
  const setting = (k, v, panel = false) => { se[k] = v; persistSettings(); if (panel) renderPanel(); };
  const seg = (k, opts) => el("div", { class: "seg" }, opts.map(([v, l]) => el("button", { class: "btn" + (se[k] === v ? " on" : ""), onclick: () => setting(k, v, true) }, l)));
  const example = el("div", { class: "hint" }, t("exp.example", nameFor(selSize(), S.cover, catIndex())));
  return [
    el("div", { class: "sh" }, el("b", {}, t("tab.sizes")), el("span", {}, t("exp.pageSub"))),
    el("div", { class: "cap" }, t("exp.sizesN", P.sizes.length), el("small", {}, t("exp.sizesSub"))),
    el("div", { class: "szlist" }, SIZE_PRESETS.map(row), custom.map(row)),
    el("div", { class: "scard addsize" }, el("div", { class: "grow" }, el("b", {}, t("exp.customAdd")), el("small", {}, t("exp.customSub"))),
      el("label", { class: "pin" }, el("span", {}, t("exp.w")), cw), el("span", {}, "×"), el("label", { class: "pin" }, el("span", {}, t("exp.h")), chh),
      el("button", { class: "btn", onclick: () => toggle(normalizeSize({ w: cw.value, h: chh.value, label: "" }), true) }, t("exp.addSize"))),
    el("div", { class: "fields3" },
      el("div", { class: "fld" }, el("div", { class: "cap" }, t("exp.format")), seg("format", [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]])),
      el("div", { class: "fld" }, el("div", { class: "cap" }, t("exp.scale")), seg("scale", [1, 2, 3, 4].map((n) => [n, `${n}×`]))),
      el("div", { class: "fld" }, se.format === "jpeg" && slider("exp.quality", 40, 100, 1, se.quality, px, (v) => setting("quality", v)), se.format === "webp" && el("div", { class: "hint" }, t("exp.webpNote")))),
    el("div", { class: "hint" }, t("exp.transparentHint")),
    el("div", { class: "fld" }, nameField(example), example),
    saveToRow(),
    el("div", { class: "scard batch", id: "set-batch" }, el("div", { class: "grow" }, el("b", {}, t("exp.batch"), " ", info(t("exp.batchHint"))), el("small", {}, t("exp.batchSub"))),
      el("button", { class: "btn", onclick: csvTemplate }, t("exp.csvTemplate")),
      el("button", { class: "btn solid", onclick: batchFromCsv }, t("exp.csv"))),
  ];
}
/** Adds a font file to the app: every layer can use it from then on. Returns its family name, or null. */
async function importFont() {
  const f = await pickFile(".ttf,.otf,.woff,.woff2");
  if (!f) return null;
  const family = f.name.replace(/\.[^.]+$/, "").replace(/[^\w\u4e00-\u9fff -]+/g, " ").trim() || "Imported font";
  const src = await readAs(f, "readAsDataURL");
  if (!(await registerFont(family, src))) { toast(t("msg.badFile")); return null; }
  await files.write(`fonts/${family}.font`, src).catch(fail);
  toast(t("msg.fontAdded", family));
  return family;
}
const BUNDLED_FONTS = ["Noto Sans SC", "Bebas Neue", "JetBrains Mono"];
/** The font of a lettering layer: the look's own, a bundled one, one added earlier, an installed one — or a file to add now. */
/** The font menu of a lettering layer; `bare` leaves out its caption (inside a group of the properties). */
function fontControl(L, bare = false) {
  const set = (v) => {
    if (v) { L.font = v; S.settings.recentFonts = useFont(S.settings.recentFonts, v); persistSettings(); } else delete L.font;
    touch({ cover: true, side: true });
  };
  const have = [...BUNDLED_FONTS, ...S.importedFonts, ...S.systemFonts];
  const item = (f) => [f, S.latinFonts.has(f) ? `${f} · ${t("font.latin")}` : f];
  // A recently used font is listed twice, so the menu shows it under "Recent" only when it is not the one in use.
  const recent = S.settings.recentFonts.filter((f) => have.includes(f) && f !== L.font);
  const options = [["", t("font.auto")], { group: t("font.recent"), items: recent.map((f) => ["~" + f, item(f)[1]]) },
    { group: t("font.bundled"), items: BUNDLED_FONTS.map(item) },
    { group: t("font.imported"), items: S.importedFonts.map(item) },
    { group: t("font.system"), items: S.systemFonts.map(item) }, ["+", t("font.add")]];
  if (L.font && !have.includes(L.font)) options.splice(1, 0, [L.font, `${L.font} · ${t("font.missing")}`]);   // set on another computer
  return el("div", { title: t("props.font") }, !bare && cap("props.font"), select(options, L.font || "", async (v) => {
    if (v !== "+") return set(v.replace(/^~/, ""));
    const family = await importFont();
    if (family) set(family); else renderSide();   // nothing chosen: put the menu back where it was
  }), L.font && S.latinFonts.has(L.font) && el("div", { class: "hint" }, t("font.latinHint")));
}

// ---------- the Layers sheet's list, and the selected layer's properties in the drawer
let dragId = null;
/**
 * Which of the cover's layers the Layers sheet lists, for the session (the chips over the list): all of them, those the
 * user added (isAdded: the free ones, and copies of layout layers), or the layout's own (isLayout, the ground among
 * them). While only some are listed, a row is not dragged to re-order: where it would land among those not listed
 * cannot be shown. A selected layer the list leaves out stays selected, named under the list.
 */
const LAYERS_UI = { filter: "all" };
const LAYER_FILTERS = { all: () => true, mine: isAdded, layout: isLayout };
function layerRow(L) {
  // the eye and the lock: shown under the pointer and on the selected row, and always when `keep` (not as they start)
  const icon = (svg, keep, title, fn) => el("button", { class: "ic" + (keep ? " keep" : ""), title, innerHTML: svg, onclick: (e) => { e.stopPropagation(); fn(); touch({ cover: true, side: true }); } });
  const on = L.id === S.layerId || group().includes(L);
  const free = isRemovable(L), base = clipBase(S.cover.layers, S.cover.layers.indexOf(L));
  const off = S.focus && S.mode === "edit" && !spotIds().includes(L.id);   // FOCUS is on another layer
  // kept to other sizes (see `sizes` in layers.js), or clipped onto a layer that is (a base hides what is clipped onto it): greyed, and said why
  const own = !inSize(L, S.sel), under = base >= 0 && !inSize(S.cover.layers[base], S.sel), away = own || under, note = sizesNote(L);
  const grip = L.type !== "bg" && LAYERS_UI.filter === "all";   // whether it can be dragged (as `draggable` below)
  return el("div", { class: `layer${on ? " on" : ""}${L.visible ? "" : " hidden"}${base >= 0 ? " clip" : ""}${off ? " dim" : ""}${away ? " away" : ""}`, title: off ? t("focus.locked") : own ? t("sizes.awayTip", note) : under ? t("sizes.awayBase", layerName(S.cover.layers[base])) : base >= 0 ? t("layers.clipped", layerName(S.cover.layers[base])) : null, dataset: { id: L.id }, draggable: L.type !== "bg" && LAYERS_UI.filter === "all",
    onclick: (e) => focusAllows(L.id) && (e.shiftKey ? togglePick(L.id) : selectLayer(L.id)),
    ondragstart: (e) => { dragId = L.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", L.id); },
    ondragend: () => { dragId = null; },
    onpointerenter: () => hoverShow(L.id), onpointerleave: hoverHide,
    ondragover: (e) => { if (dragId && dragId !== L.id) { e.preventDefault(); e.currentTarget.classList.add("over"); } },
    ondragleave: (e) => e.currentTarget.classList.remove("over"),
    ondrop: (e) => {   // dropping on a row puts the dragged layer directly above it
      e.preventDefault(); e.stopPropagation();
      const id = dragId; dragId = null;
      if (!id) return;
      const from = S.cover.layers.findIndex((l) => l.id === id), to = S.cover.layers.indexOf(L), was = layoutOrder(S.cover.layers).join();
      if (!moveLayer(S.cover.layers, id, from < to ? to : to + 1)) return renderSide();
      // the layout's parts now stacked otherwise: the profile's design takes their order too, so new covers and Empty
      // this cover have it (the layers the user added stay where they are in it); with the cover, one step of undo
      const order = layoutOrder(S.cover.layers), design = order.join() !== was && orderLayout(S.profile.design.layers, order);
      touch({ cover: true, profile: design, side: true, panel: onCoverTab() });
    } },
    // a row that can be dragged says so by the grip at its head (under the pointer and on the selected row); one that cannot keeps the place empty
    el("span", { class: "grip", title: grip ? t("layers.drag") : null, "aria-hidden": "true" }, grip ? "⋮⋮" : ""),
    layerWhat(L),
    el("span", { class: "nm", title: free ? t("layers.rename") : null, onclick: free ? (e) => nameClick(e, L) : null }, layerName(L),
      L.cats && el("span", { class: "only", style: `--c:${cat().color}`, title: t("layers.only", L.cats.map((id) => { const k = S.profile.categories.find((c) => c.id === id); return k ? k.name || k.code : ""; }).filter(Boolean).join(" · ")) }),
      layerSub(L) && el("span", { class: "words" }, layerSub(L))),
    el("span", { class: "kinds" }, note && el("span", { class: "sizes", title: t("sizes.tip") }, note), layerKinds(L)),
    icon(L.visible ? ICONS.eye : ICONS.eyeOff, !L.visible, t("layers.show"), () => { L.visible = !L.visible; }),
    PINNED.includes(L.type) ? el("span", { class: "ic pin", title: t("layers.pinned." + L.type), innerHTML: ICONS.lock })
      : icon(L.locked ? ICONS.lock : ICONS.unlock, !!L.locked, t("layers.lock"), () => { L.locked = !L.locked; }));
}
/** The cover's words a lettering layer of the layout sets, after its name in the list ("" for any other). */
function layerSub(L) {
  const words = { title: S.cover.title, subtitle: S.cover.subtitle, tag: S.cover.tag, catname: cat().name }[L.type];
  return (words || "").replace(/\*/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
}
/** A layer's icon at the head of its row: what it is — a photo, words, a colour, a vector or a bitmap. */
function layerWhat(L) {
  const icon = (name, tip) => el("span", { class: "what", title: tip, innerHTML: ICONS[name] });
  if (L.type === "asset") {
    const a = L.ref.kind === "user" && userAssets.get(L.ref.id), raster = a && !a.spec && !/^data:image\/svg/.test(a.src || "");
    return raster ? icon("photo", t("layers.kind.image")) : icon("svg", t("layers.kind.svg"));
  }
  if (L.type === "photo" || L.type === "subject") return icon("photo", t("layers.kind.photo"));
  if (L.type === "logo") return icon("photo", t("layer.logo"));
  if (["text", "title", "subtitle", "tag", "catname", "brand"].includes(L.type)) return icon("text", t("layers.kind.text"));
  if (L.type === "solid" || L.type === "bg") return icon("solid", t(L.type === "bg" ? "layer.bg" : "layers.kind.solid"));
  return icon("svg", t("layer." + L.type));
}
/** A layer's marks after its name: a linked photo's chain and leading / following mark; Layout on the template's own (but the ground, always there). */
function layerKinds(L) {
  const link = [];
  if (L.type === "photo" && (L.of || passivesOf(L).length)) {   // a linked photo: the chain (a click offers to end the link) and which end it is
    const passive = !!L.of, colour = linkColour(L), other = passive ? layerName(owner(L)) : passivesOf(L).map(layerName).join(" · ");
    link.push(el("span", { class: "kind chain", style: `color:${colour}`, title: t("link.chainTip", other), innerHTML: ICONS.chain, onclick: (e) => { e.stopPropagation(); askUnlink(L); } }),
      el("span", { class: "kind role", style: `color:${colour}`, title: t(passive ? "link.passiveTip" : "link.activeTip", other), innerHTML: ICONS[passive ? "passive" : "active"],
        onclick: (e) => { e.stopPropagation(); const to = passive ? owner(L) : passivesOf(L)[0]; if (to && to !== L) goToLayer(to.id); } }));
  }
  const layout = !isRemovable(L) && L.type !== "bg";
  return [...link, layout && el("span", { class: "badge", title: t("layers.kind.layout") }, t("layers.badge.layout")),
    L.copy && el("span", { class: "badge", title: t("layers.kind.copy", t("layer." + L.type)) }, t("layers.badge.copy"))];
}
/** Selects layer id and brings its row into view (it may be far up or down the list). */
function goToLayer(id) {
  if (!focusAllows(id)) return false;
  selectLayer(id);
  const row = layerBox.querySelector(`.layer[data-id="${CSS.escape(id)}"]`);
  if (row) { row.scrollIntoView({ block: "nearest" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 700); }
  return true;
}
/** 14-px line icons for the layer list, in the text colour. */
const ICONS = Object.fromEntries(Object.entries({
  eye: '<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
  eyeOff: '<path d="M2 2l12 12"/><path d="M6.6 3.7A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-2 2.6M4.3 4.9C2.5 6.1 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1.1 0 2.1-.3 3-.8"/>',
  lock: '<rect x="3.5" y="7" width="9" height="7" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
  dup: '<rect x="5.5" y="5.5" width="8.5" height="8.5" rx="1.2"/><path d="M10.5 5.5V3.2c0-.7-.5-1.2-1.2-1.2H3.2C2.5 2 2 2.5 2 3.2v6.1c0 .7.5 1.2 1.2 1.2h2.3"/>',
  up: '<path d="M8 13.5v-11M3.8 6.7 8 2.5l4.2 4.2"/>',
  down: '<path d="M8 2.5v11M3.8 9.3 8 13.5l4.2-4.2"/>',
  trash: '<path d="M2.5 4.2h11M6.2 4.2V2.5h3.6v1.7M3.9 4.2l.7 9.3h6.8l.7-9.3"/>',
  props: '<path d="M2 4h6.5M12.5 4H14M2 8h1.5M7.5 8H14M2 12h8.5"/><circle cx="10.5" cy="4" r="1.6"/><circle cx="5.5" cy="8" r="1.6"/><circle cx="12.5" cy="12" r="1.6"/>',
  unlock: '<rect x="3.5" y="7" width="9" height="7" rx="1.2"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>',
  photo: '<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 11.5l4-4 3 3 2-2 4 4"/><circle cx="11" cy="5.8" r="1.1"/>',
  text: '<path d="M3 3.5h10M8 3.5v10M6 13.5h4"/>',
  solid: '<rect x="2.5" y="2.5" width="11" height="11" rx="1" fill="currentColor" fill-opacity=".45"/>',
  chain: '<path d="M6.6 9.4l2.8-2.8"/><path d="M7.4 4.4l1.2-1.2a2.7 2.7 0 0 1 3.8 3.8l-1.2 1.2"/><path d="M8.6 11.6l-1.2 1.2a2.7 2.7 0 0 1-3.8-3.8l1.2-1.2"/>',
  active: '<circle cx="8" cy="8" r="5.6"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/>',
  passive: '<circle cx="8" cy="8" r="5.6" stroke-dasharray="2.2 1.8"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/>',
  svg: '<path d="M8 1.8l4.6 5.4L8 14.2 3.4 7.2z"/><path d="M8 1.8v6.4"/><circle cx="8" cy="9.2" r="1.1"/>',
  stack: '<path d="M8 1.8l6 3-6 3-6-3z"/><path d="M2 8.1l6 3 6-3"/><path d="M2 11.2l6 3 6-3"/>',   // sheets one over another: the 3D view
}).map(([k, d]) => [k, `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`]));
/**
 * A click on a name selects the layer like a click anywhere on its row; a second one soon after, on
 * the same name, renames it. Counted here rather than with dblclick: the first click rebuilds the
 * list, and a dblclick does not survive its target being replaced.
 */
let lastNameClick = { id: "", at: 0 };
function nameClick(e, L) {
  if (S.focus && !spotIds().includes(L.id)) return;   // the row says why
  const now = Date.now(), second = !e.shiftKey && lastNameClick.id === L.id && now - lastNameClick.at < 450;
  lastNameClick = second ? { id: "", at: 0 } : { id: L.id, at: now };
  if (!second) return;   // the row selects it
  e.stopPropagation();
  renameLayer(L.id);
}
/** Turns a layer's name in the list into a field: Enter or leaving it keeps the new name, Esc does not; an empty name goes back to the automatic one. */
function renameLayer(id) {
  const L = layer(id), row = layerBox.querySelector(`.layer[data-id="${CSS.escape(id)}"]`);
  if (!L || !row) return;
  const auto = layerName({ ...L, name: "" }), was = layerName(L);
  const input = el("input", { type: "text", class: "rename", value: was, maxLength: 60, spellcheck: false,
    onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation(),
    onkeydown: (e) => { if (projectKey(e)) { input.blur(); return; } e.stopPropagation(); if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = was; input.blur(); } },   // ⌘S/⌘O on to the window's keys, the name kept first
    onblur: () => {
      const v = input.value.trim();
      if (v !== was) { if (v && v !== auto) L.name = v; else delete L.name; }
      touch({ cover: true, side: true, panel: onCoverTab() });
    } });
  row.draggable = false;
  row.querySelector(".nm").replaceWith(input);
  input.focus(); input.select();
}
/** Where a layer is placed is set on the canvas (drag, the handles, the wheel); here it can be put back. */
// ---------- the properties of the selected layer
// In the drawer on the right, each group of settings a line that opens to its controls (see psec), what it is set to
// said on the line while it is shut; the most used of them on the bar over the canvas too (see barItems). Explanations
// sit behind an ⓘ (hover, or click to read it as a toast); only warnings are written out.
/** The ⓘ, drawn rather than the character, whose place in the line would change from font to font (see .info in index.html). */
const INFO_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5"/><path d="M12 7.6h.01"/></svg>';
/** An ⓘ that shows `text` on hover, and in a bubble beside it when clicked. */
const info = (text) => el("span", { class: "info", title: text, innerHTML: INFO_ICON, onclick: (e) => { e.stopPropagation(); showTip(e.currentTarget, text); } });
/** A bubble with `text` by element `at` (wrapped, unlike a toast); the next click anywhere closes it. */
function showTip(at, text) {
  const tip = $("tip") || document.body.appendChild(el("div", { id: "tip", hidden: true }));
  tip.textContent = text; tip.hidden = false;
  const r = at.getBoundingClientRect(), w = Math.min(320, innerWidth - 24);
  tip.style.width = w + "px";
  tip.style.left = clamp(r.left - 12, 12, innerWidth - w - 12) + "px";
  const below = r.bottom + 8, h = tip.offsetHeight;
  tip.style.top = (below + h > innerHeight - 12 ? Math.max(12, r.top - h - 8) : below) + "px";
  setTimeout(() => addEventListener("pointerdown", () => { tip.hidden = true; }, { once: true }), 0);
}
/**
 * Which groups of properties are open, by name, as last opened or shut by hand; one never touched is open when it
 * is the first of its layer's (see openSecs).
 */
const SECS = new Map();
/**
 * One group of properties: a line with its name (and an ⓘ with `tip`), what it is set to while shut (see secSum)
 * and a chevron, a click on it opening or shutting it; then its controls.
 */
const psec = (nameKey, kids, tip = "") => el("div", { class: "psec", dataset: { key: nameKey } },
  el("div", { class: "psec-h", onclick: (e) => { const g = e.currentTarget.parentElement, open = !g.classList.contains("open"); SECS.set(nameKey, open); g.classList.toggle("open", open); g.querySelector(".sum").textContent = secSum(g); } },
    el("span", {}, t(nameKey)), tip && info(tip), el("span", { class: "sum" }), el("span", { class: "chev" })),
  el("div", { class: "psec-b" }, kids));
/**
 * What a group of properties is set to, in a few words: its menus' choices, its colours (or Automatic), the boxes
 * ticked, its sliders moved off either end, how many sizes it shows at; Off when nothing is ticked in a group of
 * boxes alone. Read off its controls, so a group says it without being told.
 */
function secSum(g) {
  const bits = [];
  let boxes = 0;
  for (const n of g.querySelector(".psec-b").querySelectorAll("select, .fxtile.on, .sw, .seg .btn.on, .sizes-row, input[type=checkbox], .sl:not(.off)")) {
    if (n.tagName === "SELECT") bits.push(n.selectedOptions[0] ? n.selectedOptions[0].textContent : "");
    else if (n.classList.contains("fxtile")) bits.push(n.dataset.name);   // the text effect's card picked
    else if (n.classList.contains("sw")) bits.push(n.querySelector(".auto") ? t("props.inkIsAuto") : n.querySelector("input").value.toUpperCase());
    else if (n.classList.contains("sizes-row")) { const on = n.querySelectorAll(".btn.on").length, all = n.children.length; if (all > 1) bits.push(on === all ? t("props.sum.allSizes") : t("props.sum.sizes", on, all)); }
    else if (n.type === "checkbox") { boxes++; if (n.checked && !n.disabled) bits.push(n.parentElement.textContent); }
    else if (n.classList.contains("sl")) {   // a slider at either end, or at 1× (a strength or a bend as it comes), says nothing
      const r = n.querySelector("input[type=range]"), v = n.children[2].textContent;
      if (r && r.value !== r.min && r.value !== r.max && v !== times(1)) bits.push(`${n.children[0].textContent} ${v}`);
    }
    else bits.push(n.textContent);
  }
  const said = [...new Set(bits.map((b) => b.trim()).filter(Boolean))];   // two colours both automatic: Automatic, once
  return said.length ? said.slice(0, 3).join(" · ") : boxes ? t("props.sum.off") : "";
}
/** Opens the groups of properties in `box` as last left (the first open, untouched) and writes what each shut one is set to. */
function openSecs(box) {
  [...box.querySelectorAll(".psec")].forEach((g, i) => {
    const k = g.dataset.key;
    g.classList.toggle("open", SECS.has(k) ? SECS.get(k) : i === 0);
    g.querySelector(".sum").textContent = secSum(g);
  });
}
/** Put a layer back where it was placed by default. */
function placementControls(L) {
  const f = frame();
  return el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { resetPlacement(L, S.settings.scope, f.key, f.catId, f.group.map((g) => g.key)); touch({ cover: true, side: true }); } }, `${t("props.reset")} · ${scopeName(S.settings.scope)}`);
}
/**
 * A colour of a layer, a row of its own as a checkbox is: the swatch (click to choose), its name, and —
 * with `auto`, where the layer may also have none and take what the look gives it — "automatic" while it
 * has none, or a link back to automatic once it has one. `shown` is the swatch's colour while automatic.
 */
function swatch(L, key, labelKey, shown, auto = true) {
  // a text layer of before may still be in the channel colour (color "accent"): choosing a colour, or automatic, ends that
  const old = key === "ink" && L.color === "accent", own = !!L[key] || old;
  const put = (v) => { holdLive(L.id); if (v) L[key] = v; else delete L[key]; if (key === "ink") delete L.color; touch({ cover: true }); };
  return el("div", { class: "sw" },
    el("input", { type: "color", title: labelKey ? t(labelKey) : null, value: L[key] || (old ? cat().color : shown), oninput: (e) => { put(e.target.value); later("side", 600, renderSide); } }),
    labelKey && el("span", { class: "nm" }, t(labelKey)),
    auto && (own ? el("button", { class: "linkbtn", title: t("props.inkAutoHint"), onclick: () => { put(""); renderSide(); } }, t("props.inkAuto"))
      : el("span", { class: "auto", title: t("props.inkAutoHint") }, t("props.inkIsAuto"))));
}
/**
 * A headline's outline and shadow sliders. Not every text effect draws them (the flat looks' plain
 * lettering has neither): a slider the effect would ignore is shown greyed, with the reason.
 */
function titleLines(L, set0) {
  const set = (k, v) => { holdLive(L.id); set0(k, v); };
  const use = effectUses(L.fx), name = (EFFECTS[use.id] || LOOKS[use.id]).name[getLang()];
  const line = (k, key) => (use[k]
    ? slider(key, 0, 2, 0.05, L[k], times, (v) => set(k, v))
    : el("div", { class: "sl off", title: t("props.fxIgnores", name) }, el("span", {}, t(key)), el("span", { class: "why" }, t("props.fxIgnores", name))));
  return [line("stroke", "props.stroke"), line("shadow", "props.shadow")];
}
/** The text effect of a headline layer and how strong it is: {kids, tip}. */
function fxControl(L) {
  const set = (k, v, side) => { if (v === undefined) delete L[k]; else L[k] = v; touch({ cover: true, side }); };
  const fx = EFFECTS[L.fx] ? L.fx : "auto", kind = EFFECTS[fx].kind;   // an effect no longer in the menu (a look's lettering of before) is shown as automatic
  const cols = inColumns(L);
  return {
    kids: [
      fxCards(L),
      fx !== "auto" && kind !== "passes" && slider("props.fxAmt", 0, 2, 0.05, L.fxAmt ?? 1, times, (v) => { holdLive(L.id); set("fxAmt", v === 1 ? undefined : v, false); }),
      // the ransom note's letters dealt again: another face, paper, ink and angle for each (a reshaped edge: other spikes,
      // tears, cuts, drips, bites); and the ransom note's one by one, in a window of their own
      EFFECTS[fx].seeded && el("button", { class: "btn wide", style: "margin-top:8px", title: t(fx === "ransom" ? "fx.reshuffleTip" : "fx.reshuffleEdgeTip"), onclick: () => { let n; do n = 1 + Math.floor(Math.random() * 999998); while (n === L.fxSeed); set("fxSeed", n, false); } }, t("fx.reshuffle")),
      fx === "ransom" && el("button", { class: "btn wide letters-btn", style: "margin-top:8px", title: t("letters.openTip"), onclick: () => lettersOpen(L) }, t("letters.open")),
    ],
    tip: [fx === "ransom" && t("fx.ransomHint"), EFFECTS[fx].kind === "outline" && fx !== "extrude" && t("fx.shapedHint"), kind === "outline" && !CAN.outlines && t("fx.needsApp"), cols && NO_COLUMNS.includes(fx) && t("fx.noColumns")].filter(Boolean).join(" "),
  };
}
/**
 * The bend of a headline layer, how far it goes, and the reset of the perspective's own corners or of the shape
 * reshaped by its handles: {kids, tip}. The bend goes with any effect; set in columns there is none (the one it has
 * is kept, for when it is in lines again), and a note says so.
 */
function bendControl(L) {
  const set = (k, v, side) => { if (v === undefined) delete L[k]; else L[k] = v; touch({ cover: true, side }); };
  if (inColumns(L)) return { kids: [el("div", { class: "hint" }, t("fx.bendColumns"))], tip: "" };
  return {
    kids: [
      select([["", t("bend.none")], ...Object.entries(BENDS).map(([id, b]) => [id, b.name[getLang()]])], L.bend || "", (v) => { if (v) L.bend = v; else { delete L.bend; delete L.bendAmt; } delete L.warp; delete L.reshape; touch({ cover: true, side: true }); }),
      L.bend && !(L.bend === "taper" && L.warp) && slider("props.bendAmt", 0, 2, 0.05, L.bendAmt ?? 1, times, (v) => { holdLive(L.id); set("bendAmt", v === 1 ? undefined : v, false); }),
      L.bend === "taper" && L.warp && el("button", { class: "btn wide", onclick: () => set("warp", undefined, true) }, t("fx.warpReset")),
      L.bend && L.bend !== "taper" && L.reshape && el("button", { class: "btn wide", onclick: () => set("reshape", undefined, true) }, t("fx.reshapeReset")),
    ],
    tip: L.bend ? `${t("fx.bendHint")} ${t(L.bend === "taper" ? "fx.warpHint" : "fx.reshapeHint")}` : t("fx.bendHint"),
  };
}
// ---------- the text effects as cards, each the layer's first letter drawn in it
/**
 * The effect cards for this session: `all`, every effect shown in the drawer (else the first FX_FOLDED); `seeds`, by
 * layer id, the seed a lettering dealt by one is shown and put on with for a layer with none of its own yet (each its
 * own, so two layers in it are not drawn alike).
 */
const FX_UI = { all: false, seeds: new Map() };
/** The effects in the order of their cards: Automatic, then by kind as the menu had them (layered, masked, outlined, letter by letter). */
const FX_ORDER = ["passes", "mask", "outline", "letters"].flatMap((k) => Object.keys(EFFECTS).filter((id) => (EFFECTS[id].menu || EFFECTS[id].kind) === k));
/** How many cards the drawer shows until See all (Automatic, the layer's own and the first of the others); the popover as many in sight, two rows of three. */
const FX_FOLDED = 6;
/** What a card's letter is drawn on: a cover of this size, its letter a free text layer of this scale at its centre. */
const FX_CARD = { w: 200, h: 100, s: 7.5 };
const fxSeedOf = (L) => {
  if (L.fxSeed) return L.fxSeed;
  if (!FX_UI.seeds.has(L.id)) FX_UI.seeds.set(L.id, 1 + Math.floor(Math.random() * 999998));
  return FX_UI.seeds.get(L.id);
};
/** The first letter of the words headline layer L sets (the marks of its highlights left out), or a stand-in while it has none. */
function firstLetter(L) {
  const words = L.type === "title" ? S.cover.title : L.type === "subtitle" ? S.cover.subtitle : L.text;
  for (const line of parseTitle(words)) for (const run of line) { const ch = [...run.t].find((c) => c.trim()); if (ch) return ch; }
  return t("fx.sample");
}
/**
 * The text effects of headline layer L as cards, in the Effect group of the drawer and so in its popover on the bar:
 * Automatic first, then the layer's own, then the others. In the drawer three to a row, up to FX_FOLDED, See all
 * unfolding the rest; in the popover in pages of FX_FOLDED side by side, each two rows of three filled row by row (a
 * card's row and column in it, --r and --c), one page in sight and the others scrolled to sideways (see fxRow). Each is
 * the layer's first letter in that effect, in its face and colours, as the cover's look letters it; under the pointer a
 * moment it shows on the canvas (PREVIEW.fx), a click puts it on.
 */
function fxCards(L) {
  const lang = getLang(), st = S.profile.style, cur = EFFECTS[L.fx] ? L.fx : "auto";
  const order = ["auto", ...FX_ORDER.filter((id) => id !== "auto")];   // one order, so a card picked stays where it was
  // what a picture is drawn from but its effect: the letter, the layer's face, colours and strengths, the look as the cover has it, the channel colour
  const from = [firstLetter(L), L.font || "", L.ink || "", L.hi || "", L.stroke ?? 1, L.shadow ?? 1, L.fxAmt ?? 1, st.look, st.lookParams[st.look] || null, st.lookSeed, st.theme, !!recordOf(mainPhoto()), cat().color];
  const kinds = { passes: t("fx.kind.passes"), mask: t("fx.kind.mask"), outline: t("fx.kind.outline"), letters: t("fx.kind.letters") };
  for (const w of FXPICS.watched) if (!w.isConnected) { FXPICS.seen.unobserve(w); FXPICS.watched.delete(w); }   // the cards of a drawing before the last, never seen
  const card = (id, i) => {
    const e = EFFECTS[id], seed = e.seeded ? fxSeedOf(L) : 0, c = el("canvas", { width: FX_CARD.w, height: FX_CARD.h }), j = i % FX_FOLDED, across = FX_FOLDED / 2;
    // past FX_FOLDED, until See all: not shown in the drawer (the popover's pages show them), so their pictures wait to be scrolled to
    const b = el("button", { class: "fxtile" + (id === cur ? " on" : "") + (i >= FX_FOLDED && id !== cur && !FX_UI.all ? " folded" : ""), "aria-pressed": String(id === cur), dataset: { name: e.name[lang] },
      style: `--r:${1 + Math.floor(j / across)};--c:${1 + Math.floor(i / FX_FOLDED) * across + (j % across)}`,   // where it stands in its page of the popover
      title: id === "auto" ? e.name[lang] : `${e.name[lang]} · ${kinds[e.menu || e.kind]}`, onpointerenter: () => hoverFx(L, id), onclick: () => pickFx(L, id) },
      c, el("span", {}, id === "auto" ? t("fx.cardAuto").split(" · ").map((w, i) => [i ? " · " : "", el("i", {}, w)]) : e.name[lang]));   // Automatic's two halves, each whole on its line
    fxPic(JSON.stringify([id, seed, ...from]), { id, seed, ch: from[0], L }, c, b);
    return b;
  };
  return el("div", { class: "fxdeck" },
    el("div", { class: "fxhint" }, t("fx.cardsHint")),
    fxRow(el("div", { class: "fxgrid", style: `--cols:${Math.ceil(order.length / FX_FOLDED) * (FX_FOLDED / 2)}`, onpointerleave: () => hoverFx(L, null) }, order.map(card)), L),   // whole pages, the last one too
    el("button", { class: "btn wide seeall", onclick: () => { FX_UI.all = !FX_UI.all; renderSide(); } }, FX_UI.all ? t("fx.seeFewer") : t("fx.seeAll", FX_ORDER.length - 1)));
}
/** Watches the effect rows' size (a popover laid out, the window resized), to say again at which ends there is more. */
const FXROWS = new ResizeObserver((seen) => { for (const e of seen) fxRowEnds(e.target.parentElement); });
/**
 * The cards in `grid` as the bar's popover shows them, in pages of six side by side scrolled sideways: an arrow at
 * either end where there is more that way, the cards there fading out under it, a click on it gliding the cards on to
 * the next page; the wheel turns them too, until their end, then scrolls the popover as before. In the drawer the cards
 * stay three to a row and the arrows are not shown.
 */
function fxRow(grid, L) {
  const page = () => grid.clientWidth + (parseFloat(getComputedStyle(grid).columnGap) || 0);   // a page's width and the gap after it, from one page's start to the next's
  const arrow = (dir) => el("button", { class: "fxarrow " + (dir < 0 ? "l" : "r"), tabindex: -1, title: t(dir < 0 ? "fx.prev" : "fx.next"), "aria-label": t(dir < 0 ? "fx.prev" : "fx.next"),
    innerHTML: `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${dir < 0 ? "M10 3 5 8l5 5" : "m6 3 5 5-5 5"}"/></svg>`,
    onclick: () => { const w = page(), at = grid._to ?? grid.scrollLeft; glide(grid, (Math.round(at / w) + dir) * w - at); } });   // to the next page's start
  grid.addEventListener("scroll", () => { FX_UI.left = { id: L.id, x: grid.scrollLeft }; fxRowEnds(grid.parentElement); }, { passive: true });
  requestAnimationFrame(() => {   // where it was scrolled to for this layer (a card picked draws the popover anew), else with the layer's own card in sight
    if (!grid.isConnected) return;
    const on = grid.querySelector(".fxtile.on");
    if (FX_UI.left && FX_UI.left.id === L.id) grid.scrollLeft = FX_UI.left.x;
    else if (on) grid.scrollLeft = Math.floor([...grid.children].indexOf(on) / FX_FOLDED) * page();   // its page
    fxRowEnds(grid.parentElement);
  });
  grid.addEventListener("wheel", (e) => {
    const max = grid.scrollWidth - grid.clientWidth, to = grid._to ?? grid.scrollLeft;
    if (max < 1 || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || (e.deltaY < 0 ? to <= 0 : to >= max)) return;   // sideways already, or at its end: as the wheel goes
    e.preventDefault();
    glide(grid, e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY);   // a wheel counted in lines, or in pixels
  }, { passive: false });
  FXROWS.observe(grid);
  return el("div", { class: "fxrow" }, grid, arrow(-1), arrow(1));
}
/** Says which ends of effect row `row` have more beyond them (`l`, `r`), for its arrows and fades. */
function fxRowEnds(row) {
  const g = row && row.firstElementChild;
  if (!g || !g.isConnected) return;
  const max = g.scrollWidth - g.clientWidth;
  row.classList.toggle("l", max >= 1 && g.scrollLeft > 1);
  row.classList.toggle("r", max >= 1 && g.scrollLeft < max - 1);
}
/** Scrolls `box` sideways by dx, easing in over a few frames; another turn of the wheel meanwhile goes on from where it is headed. */
function glide(box, dx) {
  const max = box.scrollWidth - box.clientWidth;
  box._to = clamp((box._to ?? box.scrollLeft) + dx, 0, Math.max(0, max));
  if (box._gliding) return;
  box._gliding = true;
  const step = () => {
    const d = box._to - box.scrollLeft;
    if (Math.abs(d) < 1 || !box.isConnected) { if (box.isConnected) box.scrollLeft = box._to; box._gliding = false; box._to = undefined; return; }
    const was = box.scrollLeft;
    box.scrollLeft += Math.sign(d) * Math.max(1, Math.abs(d) * 0.22);
    if (box.scrollLeft === was) { box._gliding = false; box._to = undefined; return; }   // held where it is (its end)
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/**
 * The effect cards' pictures, by what each is drawn from (see fxCards): {key, cv, of, done, faced, light, shows} — its
 * key, a small canvas with the letter drawn on it, the layer drawn (a free text layer standing for the card's),
 * whether it is drawn as it is to stay (no outline it asked for still on its way, its faces read: `faced`), whether its
 * letter is dark (so shown on a light ground), and the cards waiting for it ([canvas, card], the last few made: the
 * drawer's and the popover's are built anew at each change, and the popover's even when it shows another group, so
 * those of before are let go). Each is drawn once and copied onto every card that shows it, so the
 * drawer and the bar's popover, built anew at each change, draw nothing again; and only once a card of it comes in
 * sight (`seen`): not in a group shut, nor scrolled away below See all. `queue`: those waiting to be drawn, one a
 * frame; `on`, whether that is under way; `watched`, the card canvases waiting to be seen; `read`, the faces known
 * to be read from their files (see ensureFont), which no picture waits for.
 */
const FXPICS = { pics: new Map(), queue: [], on: false, watched: new Set(), read: new Set(),
  seen: new IntersectionObserver((seen) => {
    for (const e of seen) {
      if (!e.isIntersecting) continue;
      FXPICS.seen.unobserve(e.target); FXPICS.watched.delete(e.target);
      const key = e.target.dataset.fx;
      if (FXPICS.pics.has(key) && !FXPICS.queue.includes(key)) FXPICS.queue.push(key);
    }
    drawFxPics();
  }) };
/** Shows the picture keyed `key` on card canvas `c` (of card `b`): at once when drawn, else once it is (drawn one a frame, once the card is in sight). */
function fxPic(key, job, c, b) {
  let pic = FXPICS.pics.get(key);
  if (!pic) {
    const cv = el("canvas");
    cv.getContext("2d", { willReadFrequently: true });   // its letter's colour is read off it
    const L = job.L, of = { ...newLayer("text"), id: "fxcard", text: job.ch, font: L.font, ink: L.ink, hi: L.hi, stroke: L.stroke ?? 1, shadow: L.shadow ?? 1, fxAmt: L.fxAmt,
      fx: job.id === "auto" ? undefined : job.id, fxSeed: job.seed || undefined, t: { all: { x: 0.5, y: 0.5, s: FX_CARD.s, r: 0, kx: 1, ky: 1 }, by: {} } };
    pic = { key, cv, of, done: false, faced: false, light: false, shows: [] };
    FXPICS.pics.set(key, pic);
    if (FXPICS.pics.size > 80) FXPICS.pics.delete(FXPICS.pics.keys().next().value);   // the oldest: another text, colour or look since
  }
  pic.shows.push([c, b]);
  if (pic.shows.length > 6) pic.shows.splice(0, pic.shows.length - 6);
  if (pic.done) return showFxPic(pic);
  c.dataset.fx = key; FXPICS.watched.add(c); FXPICS.seen.observe(c);
}
/** Draws the pictures waiting, one a frame, those of cards still shown; not while something is dragged. */
function drawFxPics() {
  if (FXPICS.on) return;
  FXPICS.on = true;
  const next = () => {
    if (LIVE || drafting()) return setTimeout(next, 300);
    let key, pic = null;
    while ((key = FXPICS.queue.shift())) {
      pic = FXPICS.pics.get(key);
      if (pic) pic.shows = pic.shows.filter(([c]) => c.isConnected);
      if (pic && pic.shows.length) break;
    }
    if (!key) { FXPICS.on = false; return; }
    try { paintFxPic(pic); showFxPic(pic); }
    catch (e) { console.error(e); pic.done = true; pic.shows = []; }   // a picture failing leaves its cards blank, and the others to be drawn
    requestAnimationFrame(next);
  };
  requestAnimationFrame(next);
}
/** Picture `pic` drawn again once what it waits for is here (an outline it asked for, a face being read). */
function fxAgain(pic, ready) {
  ready.then(() => { if (FXPICS.pics.get(pic.key) === pic && !FXPICS.queue.includes(pic.key)) FXPICS.queue.push(pic.key); drawFxPics(); });
}
/** Paints picture `pic`: its letter alone, as the cover would paint it at the card's size, the cover's ground and main photo setting the scene (its look, its theme). */
function paintFxPic(pic) {
  // its face, or the ransom note's, still being read from their files: drawn now in what stands in, and again once read
  const faces = pic.faced ? [] : [...new Set([pic.of.font, ...(pic.of.fx === "ransom" ? ransomPending() : [])].filter((f) => f && !FXPICS.read.has(f)))]
    .map((f) => { const job = ensureFont(f); return job && job.then(() => FXPICS.read.add(f)); }).filter(Boolean);
  if (faces.length) fxAgain(pic, Promise.all(faces).then(() => { pic.faced = true; }));
  else pic.faced = true;
  const main = mainPhoto(), layers = [S.cover.layers[0], main && recordOf(main) ? main : null, pic.of].filter(Boolean);
  try { drawCover(pic.cv, { profile: S.profile, catIndex: catIndex(), size: FX_CARD, pixelW: FX_CARD.w, cover: { ...S.cover, layers }, photos: S.photos, only: layers.length - 1 }); }
  catch (e) { console.error(e); }   // a lettering failing leaves the card blank, and the others
  finally { useLook(); }
  pic.done = pic.faced && !outlinesPending();
  if (pic.faced && !pic.done) fxAgain(pic, outlinesSettled());   // drawn again with the outlines it asked for
  const d = pic.cv.getContext("2d").getImageData(0, 0, pic.cv.width, pic.cv.height).data;
  let sum = 0, a = 0;
  for (let i = 0; i < d.length; i += 16) { sum += d[i + 3] * (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); a += d[i + 3]; }   // every fourth pixel, by how much of it is painted
  pic.light = a > 0 && sum / a < 96;
}
/** Copies picture `pic` onto the cards waiting for it, each on a light ground when its letter is dark. */
function showFxPic(pic) {
  for (const [c, b] of pic.shows) {
    const g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height); g.drawImage(pic.cv, 0, 0, c.width, c.height);
    b.classList.toggle("light", pic.light);
  }
  if (pic.done) pic.shows = [];
}
/** An effect's card under the pointer: the canvas shows layer L in it a moment later; none (or the one it has): as it is. */
function hoverFx(L, id) {
  const cur = EFFECTS[L.fx] ? L.fx : "auto";
  if (id === "ransom") ensureFonts([{ fx: id }]);   // the ransom note's faces, read for the canvas too (they draw it again as they come)
  previewSoon("fx", id && id !== cur ? { id: L.id, fx: id, seed: EFFECTS[id].seeded ? fxSeedOf(L) : 0 } : null, () => S.mode === "edit" && layer(L.id) === L);
}
/** An effect's card clicked: layer L has it, one step of undo. */
function pickFx(L, id) {
  endPreview("fx");
  if (id === (EFFECTS[L.fx] ? L.fx : "auto")) return;
  clearTimeout(timers.hist); commitHistory();   // what was done before is a step of its own
  if (EFFECTS[id].seeded && !L.fxSeed) L.fxSeed = fxSeedOf(L);   // a lettering dealt by a seed: the layer's own from now on, as previewed (two layers in it are not drawn alike)
  if (id === "auto") delete L.fx; else L.fx = id;
  touch({ cover: true, side: true });
}
/** Whether the cover's look sets lettering layer L in columns of itself (its `columns`: the woodblock book's Set the title vertically, for the title and the subtitle), as columned() in style.js has it. */
const columnsByLook = (L) => {
  const lk = LOOKS[S.profile.style.look] || LOOKS.cel;
  return (L.type === "title" || L.type === "subtitle") && !!lk.columns && !!lk.columns(lookParams(lk.id, (S.profile.style.lookParams || {})[lk.id]));
};
/** Whether lettering layer L is set in columns: as the user set it (`vertical`), or as the look does of itself. */
const inColumns = (L) => L.vertical === true || columnsByLook(L);
/**
 * Setting lettering layer L in columns, as a Song edition is (竖排, `vertical`), and once it is, ruling them (界行线,
 * `rules`): both kept with the layer, structure that Surprise me leaves alone. Set so by the look itself, the box is
 * ticked and greyed, saying where that is changed.
 */
function columnControls(L) {
  const byLook = !L.vertical && columnsByLook(L), lk = LOOKS[S.profile.style.look] || LOOKS.cel;
  return [
    el("label", { class: "chk", title: t("props.verticalTip") }, el("input", { type: "checkbox", checked: L.vertical || byLook, disabled: byLook, onchange: (e) => { L.vertical = e.target.checked; touch({ cover: true, side: true }); } }), t("props.vertical")),
    byLook && el("div", { class: "hint" }, t("props.verticalByLook", lk.name[getLang()])),
    (L.vertical || byLook) && el("label", { class: "chk", title: t("props.rulesTip") }, el("input", { type: "checkbox", checked: !!L.rules, onchange: (e) => { L.rules = e.target.checked; touch({ cover: true }); } }), t("props.rules")),
  ];
}
/** The words a headline layer sets: the title's and the subtitle's are the cover's. */
const wordsOf = (L) => (L.type === "title" ? S.cover.title : L.type === "subtitle" ? S.cover.subtitle : L.text || "");
/** Whether the cover has a photo shown that the ransom note may cut letters from (see ransomOf in render.js). */
const letterPhoto = () => S.cover.layers.some((l) => l.type === "photo" && !l.of && !l.cut && l.visible && appliesTo(l, cat().id) && inSize(l, S.sel) && recordOf(l)?.img);
/** What the ransom note's letters in the panel show: when it is the same, they are not drawn again. */
const lettersNow = (L) => JSON.stringify([wordsOf(L), L.letters, L.fxSeed, L.fxAmt, L.ransomOff, letterPhoto(), drawnWith(L).papers.map((p) => p.css), S.letterSel, getLang()]);
let letterHeld = false;   // a pointer is down in the letters' controls (WebKit does not focus a slider dragged)
addEventListener("pointerup", () => { letterHeld = false; }, true);
addEventListener("pointercancel", () => { letterHeld = false; }, true);
// ---------- the ransom note's letters one by one, in a window over the sheet (the canvas and the layer's
// properties stay in view; over the drawer where it has taken the sheet's place); it stays open while the cover is worked on, for the layer it was opened
// for (S.letterWin), and closes when another layer is selected or the layer is lettered otherwise
/** Places a floating window over the left column (over the drawer where it has taken the sheet's place: see columns()), as wide as it allows (460 at most), as tall as the window. */
function overLeft(box) {
  const r = $(sheetHidden() ? "right" : "left").getBoundingClientRect(), top = Math.max(8, r.top + 8), w = Math.min(Math.max(280, r.width - 16), 460, innerWidth - 16);
  Object.assign(box.style, { left: `${Math.max(8, Math.min(r.left + 8, innerWidth - w - 8))}px`, top: `${top}px`, width: `${w}px`, maxHeight: `${Math.max(240, Math.min(r.bottom - 8, innerHeight - 8) - top)}px` });
}
/** Opens the letter window for layer L. */
function lettersOpen(L) {
  const win = $("letterwin") || document.body.appendChild(el("div", { id: "letterwin", role: "dialog", "aria-label": t("props.sec.letters"), onpointerdown: () => { letterHeld = true; } }));
  cropClose(); weaveClose(); brushClose(); if ($("deal") && !$("deal").hidden) dealClose();   // the windows over the left column stand where this one does; Surprise me's covers it
  overLeft(win);
  S.letterWin = L.id; win.hidden = false; placeFrames();
  lettersShow(true);
}
function lettersClose() { const win = $("letterwin"); if (win) win.hidden = true; S.letterWin = null; placeFrames(); }
/**
 * The letter window drawn (again) for its layer as it is now: closed when the layer is gone, lettered
 * otherwise, or no longer selected. Unless `now` (something in it was chosen), not while one of its controls
 * is in use, nor when nothing it shows changed — its words, colours, letters set by hand, or the layer
 * itself (an undo puts another object in its place).
 */
function lettersShow(now = false) {
  const win = $("letterwin"), L = S.letterWin ? layer(S.letterWin) : null, at = document.activeElement;
  if (!win || win.hidden) return;
  if (!L || L.fx !== "ransom" || S.layerId !== L.id || S.mode !== "edit") return lettersClose();
  const box = $("letters-box");
  if (!now && box && box._layer === L && box.dataset.now === lettersNow(L)) return;
  if (!now && (letterHeld || (at && win.contains(at) && /^(INPUT|SELECT)$/.test(at.tagName)))) return later("letters", 400, lettersShow);
  const inner = el("div", { id: "letters-box", "data-now": lettersNow(L) }, letterControls(L));
  inner._layer = L;
  win.replaceChildren(
    el("div", { class: "head" }, el("b", {}, `${t("props.sec.letters")} · ${layerName(L)}`), el("button", { class: "x", title: t("deal.close"), onclick: lettersClose }, "✕")),
    inner,
    el("div", { class: "hint" }, t("letters.hint")),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: lettersClose }, t("deal.done"))));
}
/**
 * The ransom note letter by letter (ransom.js): the extras the layer lets in; a strip of its letters as they
 * are drawn, one row a line; and for the one picked (S.letterSel) its kind, face, paper, ink, size, angle,
 * lift, case, whether it is the hero, its scrap's edge and tape, set in `letters` by its key; dealt again on
 * its own, locked against Reshuffle (it keeps the layer's seed of now, and its face, paper, ink and whether it
 * is the hero, which its neighbours decided), or given back to chance.
 */
function letterControls(L) {
  const photo = letterPhoto(), rows = ransomLetters(parseTitle(wordsOf(L)), { id: L.id, salt: `${L.id}:${L.fxSeed || 0}`, edits: L.letters || null, off: L.ransomOff || null, photo }, L.fxAmt ?? 1, drawnWith(L));
  const put = (key, patch, show = true) => {
    const all = { ...(L.letters || {}) }, e = { ...(all[key] || {}), ...patch };
    for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
    if (Object.keys(e).length) all[key] = e; else delete all[key];
    if (Object.keys(all).length) L.letters = all; else delete L.letters;
    touch({ cover: true });
    if (show) lettersShow(true);
  };
  const sel = S.letterSel && S.letterSel.id === L.id ? S.letterSel.key : null;
  let picked = null;
  // the strip: each letter as it is drawn (its face, paper, ink, kind and angle), a mark on those dressed by hand or locked
  const strip = el("div", { id: "letters", class: "letters" }, rows.map(({ row, cells, plan }) => el("div", { class: "lrow" }, cells.map((c, i) => {
    const p = plan[i];
    if (!p) return el("span", { class: /^\s+$/.test(c.ch) ? "lgap" : "lmark" }, c.ch.trim());
    if (p.key === sel) picked = { row, c, p };
    return el("button", {
      class: `lt k-${p.kind}` + (p.key === sel ? " on" : "") + (p.locked ? " locked" : p.edited ? " edited" : "") + (p.hero ? " hero" : ""),
      style: `--p:${p.paper.css};--i:${p.ink};${p.face ? `font:${faceFont(p.face, 17)};` : ""}transform:rotate(${p.turn.toFixed(1)}deg)`,
      title: [p.face ? p.face.family : "", t(`letters.kind.${p.kind}`), p.locked ? t("letters.locked") : ""].filter(Boolean).join(" · "),
      onclick: () => { S.letterSel = p.key === sel ? null : { id: L.id, key: p.key }; lettersShow(true); },
    }, p.ch);
  }))));
  const extras = el("div", { class: "chips small", style: "margin-bottom:10px" }, EXTRAS.map((k) => {
    const on = !(L.ransomOff || []).includes(k);
    return el("button", { class: on ? "on" : "", title: t(k === "photo" && !photo ? "letters.extra.photoNone" : `letters.extra.${k}Tip`), onclick: () => {
      const off = new Set(L.ransomOff || []);
      if (on) off.add(k); else off.delete(k);
      if (off.size) L.ransomOff = EXTRAS.filter((x) => off.has(x)); else delete L.ransomOff;
      touch({ cover: true }); lettersShow(true);
    } }, t(`letters.extra.${k}`));
  }));
  return [
    cap("letters.extras"), extras,
    strip,
    picked ? letterEditor(L, picked, put, photo) : el("div", { class: "hint", style: "margin:6px 0 0" }, t("letters.pick")),
    L.letters && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { delete L.letters; touch({ cover: true }); lettersShow(true); } }, t("letters.resetAll")),
  ];
}
/** The controls of one letter of the ransom note: {row, c (its cell), p (how it is dressed now)}; `put(key, patch)` sets what was chosen. */
function letterEditor(L, { row, c, p }, put, photo) {
  const e = (L.letters && L.letters[p.key]) || {}, key = p.key, live = (patch) => { holdLive(L.id); put(key, patch, false); };
  /** A value back to chance: what was set, and what a lock keeps of it. */
  const loose = (field) => { const lock = e.lock && { ...e.lock }; if (lock) delete lock[field]; put(key, { [field]: undefined, ...(lock ? { lock } : {}) }); };
  const settled = (row) => { row.querySelector("input").addEventListener("change", () => lettersShow(true)); return row; };   // a slider let go: the strip and the controls show it
  const pools = ransomPools(), faces = (isCJK(c.ch) ? pools.cjk : pools.latin).filter((f) => faceHas(f, c.ch));
  const faceId = (f) => `${f.family}|${f.weight}|${f.italic ? 1 : 0}`;
  // a colour of the letter's: by chance, one of `list`, or any
  const colours = (field, list, now) => el("div", { class: "lcol" },
    el("button", { class: "lsw auto" + (e[field] || (e.lock && e.lock[field]) ? "" : " on"), title: t("letters.random"), onclick: () => loose(field) }, "?"),
    list.map((x) => el("button", { class: "lsw" + (e[field] && now === x.css ? " on" : ""), style: `background:${x.css}`, title: x.css, onclick: () => put(key, { [field]: x.css }) })),
    el("input", { type: "color", value: now, oninput: (ev) => { live({ [field]: ev.target.value }); later("letters", 600, lettersShow); } }));
  const shown = drawnWith(L), papered = ["tile", "cut", "deep"].includes(p.kind);
  return el("div", { class: "ledit" },
    el("div", { class: "lhead" }, el("b", {}, `「${p.ch}」`), el("span", {}, t("letters.line", row + 1))),
    el("div", { class: "row", style: "margin-top:6px" },
      el("button", { class: "btn", title: t("letters.oneTip"), onclick: () => { let n; do n = 1 + Math.floor(Math.random() * 999998); while (n === e.salt); put(key, { salt: n }); } }, t("letters.one")),
      el("button", { class: "btn" + (p.locked ? " on" : ""), title: t("letters.lockTip"), onclick: () => put(key, { lock: p.locked ? undefined : { seed: L.fxSeed || 0, ...(p.face ? { face: { family: p.face.family, weight: p.face.weight, ...(p.face.italic ? { italic: true } : {}) } } : {}), paper: p.paper.css, ink: p.ink, hero: p.hero } }) }, t(p.locked ? "letters.unlock" : "letters.lock")),
      el("button", { class: "btn", disabled: !L.letters || !L.letters[key], onclick: () => put(key, Object.fromEntries(Object.keys(e).map((k) => [k, undefined]))) }, t("letters.reset"))),
    el("div", { class: "lgrid" },
      el("span", {}, t("letters.kind")),
      select([["", t("letters.random")], ...["tile", "bare", "cut", "deep", ...(photo ? ["photo"] : [])].map((k) => [k, t(`letters.kind.${k}`)])], e.kind || "", (v) => put(key, { kind: v || undefined })),
      el("span", {}, t("letters.face")),
      select([["", t("letters.randomNow", p.face ? p.face.family : "—")], ...faces.map((f) => [faceId(f), `${f.family} ${f.weight}${f.italic ? " italic" : ""}`])], e.face ? faceId({ italic: false, ...e.face }) : "", (v) => {
        if (!v) return loose("face");
        const [family, weight, italic] = v.split("|");
        put(key, { face: { family, weight: Number(weight), ...(italic === "1" ? { italic: true } : {}) } });
      }),
      papered && el("span", {}, t(p.kind === "deep" ? "letters.front" : "letters.paper")), papered && colours("paper", shown.papers, p.paper.css),
      p.kind === "tile" && el("span", {}, t("letters.ink")), p.kind === "tile" && colours("ink", inksFor(shown.C), p.ink)),
    settled(slider("letters.size", 0.5, 1.6, 0.02, p.size, times, (v) => live({ size: v }))),
    settled(slider("letters.turn", -45, 45, 1, p.turn, (v) => `${Math.round(v)}°`, (v) => live({ turn: v }))),
    settled(slider("letters.lift", -0.5, 0.5, 0.01, p.lift, (v) => v.toFixed(2), (v) => live({ lift: v }))),
    el("div", { class: "lgrid" },
      !isCJK(c.ch) && cased(c.ch) && el("span", {}, t("letters.case")),
      !isCJK(c.ch) && cased(c.ch) && select([["", t("letters.random")], ["typed", t("letters.case.typed")], ["upper", t("letters.case.upper")], ["lower", t("letters.case.lower")]], e.case || "", (v) => put(key, { case: v || undefined })),
      p.kind === "tile" && el("span", {}, t("letters.edge")),
      p.kind === "tile" && select([["", t("letters.random")], ["cut", t("letters.edge.cut")], ["torn", t("letters.edge.torn")]], e.edge || "", (v) => put(key, { edge: v || undefined })),
      p.kind === "tile" && el("span", {}, t("letters.tape")),
      p.kind === "tile" && select([["", t("letters.random")], ["0", t("letters.tape.0")], ["1", t("letters.tape.1")], ["2", t("letters.tape.2")]], e.tape == null ? "" : String(e.tape), (v) => put(key, { tape: v === "" ? undefined : Number(v) }))),
    el("div", { class: "lgrid" }, el("span", {}, t("letters.hero")),
      select([["", t(p.hero ? "letters.hero.chanceYes" : "letters.hero.chanceNo")], ["yes", t("letters.hero.yes")], ["no", t("letters.hero.no")]], e.hero === true ? "yes" : e.hero === false ? "no" : "", (v) => (v ? put(key, { hero: v === "yes" }) : loose("hero")))));
}
/** The papers and channel colour a layer's letters were last drawn with (see ransomShown), or those of the channel colour before they were drawn. */
const drawnWith = (L) => ransomShown(L.id) || { papers: papersFor({ C: hexToRgb(cat().color) }), C: hexToRgb(cat().color) };
/** White or ink, whichever reads on colour "#rrggbb". */
const readsOn = (hex) => { const c = hexToRgb(hex); return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 < 128 ? "#ffffff" : "#07070c"; };
/**
 * The colours lettering layer L is shown in by the swatches of its Colour group while they are automatic, standing for
 * what the look gives it: {ink} (its words), and for the title, subtitle and text also {hi, mark} (the highlighted
 * words; the plates and marks under them).
 */
function inksShown(L) {
  const light = S.profile.style.theme === "light" && !recordOf(mainPhoto()) && !(LOOKS[S.profile.style.look] || LOOKS.cel).oneTheme;
  if (!HEADLINES.includes(L.type)) return { ink: L.type === "brand" && !light ? "#ffffff" : "#07070c" };   // the brand row in the ground's lettering colour
  // the plates' and marks' own colour when left automatic: the channel colour, or on a plate of that colour ink or white
  const mark = L.plate && (!L.plateInk || L.plateInk.toLowerCase() === cat().color.toLowerCase()) ? readsOn(cat().color) : cat().color;
  // on plates of their own the words take what reads there; through a band or on a block set off, the lettering's colour
  return { ink: L.plate ? readsOn(L.plateInk || cat().color) : light ? "#07070c" : "#ffffff", mark,
    hi: L.hiPlate ? readsOn(L.hiPlateInk || mark) : L.hiMark && L.hiMark !== "circle" ? (L.ink || (L.plate ? readsOn(L.plateInk || cat().color) : light ? "#07070c" : "#ffffff")) : cat().color };
}
/** The title, subtitle and text layers alike: words, effect, bend, colours, lines, plate. */
function headlineControls(L, set) {
  const fx = fxControl(L), bend = bendControl(L), shown = inksShown(L);
  return [
    psec("props.sec.text", [
      L.type === "text" && el("textarea", { value: L.text, spellcheck: false, style: "height:64px;margin-bottom:8px", oninput: (e) => { L.text = e.target.value; touch({ cover: true }); later("side", 700, renderSide); } }),
      // the title's words are the cover's, also in Cover → Title, which follows
      L.type === "title" && el("textarea", { value: S.cover.title, spellcheck: false, style: "height:64px;margin-bottom:8px", oninput: (e) => { S.cover.title = e.target.value; touch({ cover: true }); later("panel", 700, () => onCoverTab() && renderPanel()); } }),
      // so are the subtitle's, in Cover → Subtitle
      L.type === "subtitle" && el("div", { style: "margin-bottom:8px" }, textInput(S.cover.subtitle, (v) => { S.cover.subtitle = v; touch({ cover: true }); later("panel", 700, () => onCoverTab() && renderPanel()); }, { placeholder: t("cover.subtitlePh") })),
      fontControl(L, true), ...columnControls(L)], t("props.textHint")),
    psec("props.sec.effect", fx.kids, fx.tip),
    psec("props.bend", bend.kids, bend.tip),
    psec("props.sec.color", [
      swatch(L, "ink", "props.sw.text", shown.ink),
      swatch(L, "hi", "props.sw.hi", shown.hi),
      L.plate && swatch(L, "plateInk", "props.sw.plate", cat().color),
      (L.hiPlate || L.hiMark) && swatch(L, "hiPlateInk", "props.sw.hiPlate", shown.mark)], t("props.inkAutoHint")),
    psec("props.sec.lines", titleLines(L, set), t(L.plate ? "props.linesOnPlate" : "props.linesNoPlate")),
    psec("props.sec.plate", [check("props.plateAdd", L.plate, (v) => set("plate", v, true))]),
    // how the highlighted words are marked, besides their colour: plates under them, or a mark of them
    psec("props.sec.hi", [select([["", t("hi.none")], ["plate", t("hi.plate")], ["circle", t("hi.circle")], ["marker", t("hi.marker")], ["block", t("hi.block")]], L.hiPlate ? "plate" : L.hiMark || "",
      (v) => { delete L.hiPlate; delete L.hiMark; if (v === "plate") L.hiPlate = true; else if (v) L.hiMark = v; touch({ cover: true, side: true }); })], t("hi.hint")),
  ];
}
/** Removes the background of photo layer L (on), or puts it back: a linked cut-out is made a whole photo again, of its own. */
async function cutPhoto(L, on) {
  const base = L.of ? layer(L.of) : L;
  if (L.of && !on) { unlink(L); L.cut = false; touch({ cover: true, side: true, panel: onCoverTab() }); return toast(t("link.restored")); }
  if (on && !(await ensureMask(base && base.pid))) return renderSide();
  if (on && !L.of) cutWhere(L); else L.cut = on;   // where the scope reaches: at one size or orientation, a copy cut out there
  touch({ cover: true, side: true, panel: onCoverTab() });
}
/** The properties of a photo layer. */
function photoControls(L, set) {
  const base = L.of ? layer(L.of) : L, rec = recordOf(L), linked = passivesOf(L);
  const cut = (on) => cutPhoto(L, on);
  const from = !L.of && cutSource(L), had = from && passivesOf(from)[0];   // what Cut out subject cuts out of (see cutOut)
  const redo = !!had && cutSizes(from).every((k) => inSize(had, k)), keys = !L.of && scopeKeys();   // its cut-out is found again; else made, or put where the scope reaches too
  const unlinkBtn = (L.of || linked.length > 0) && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => askUnlink(L) }, t("link.unlink"));
  const cropBtn = cropButton(L);
  return [
    !rec && el("div", { class: "hint err", style: "margin:0 0 10px" }, t("props.photoMissing")),
    psec("props.sec.cut", [
      canCut()
        ? el("div", { class: L.of ? "" : "row", style: "margin-top:0" },
            el("button", { class: "btn" + (L.of ? " wide" : ""), disabled: CUT.busy, onclick: () => cut(!L.cut) }, t(CUT.busy ? "cut.busy" : L.cut ? "props.uncut" : "props.cut")),
            !L.of && el("button", { class: "btn", disabled: CUT.busy, title: t(redo ? "cut.againTip" : "cut.go"), onclick: () => cutOut(L) }, t(redo ? "cut.again" : "cut.goShort")))
        : el("div", { class: "hint", style: "margin:0" }, t("cutset.needsApp")),
      canCut() && keys && el("div", { class: "hint" }, sizesSaid("cut.scopeHint", keys)),   // the scope under the canvas keeps both to some sizes
      L.cut && slider("props.feather", 0, 40, 1, L.feather, px, (v) => { holdLive(L.id); set("feather", v); }),
      L.cut && slider("props.spread", 0, 40, 1, L.spread, px, (v) => { holdLive(L.id); set("spread", v); }),
      CUT.error && el("div", { class: "hint err" }, CUT.error),
    CUT.needModel && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { S.tab.setup = "ai"; SET_UI.at = "cut"; setMode("setup"); } }, t("cut.goModel"))], t("cut.tip", t("cutset.engine." + cutEngine()))),
    canWeave(L) && weaveControls(L),
    L.of
      ? psec("props.sec.place", [el("div", { class: "hint", style: "margin:0" }, t("link.follows2", base ? layerName(base) : "—")),
          base && el("button", { class: "btn wide", style: "margin-top:8px", title: t("link.realignTip"), onclick: () => { L.t = alignedT(base); touch({ cover: true, side: true }); } }, t("link.realign")),
          cropBtn, unlinkBtn], t("link.passiveMore"))
      : psec("props.sec.place", [check("props.fill", L.fill, (v) => { set("fill", v, true); if (v) { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 1 }; L.t.by = {}; } else { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 0.6 }; } touch({ cover: true, side: true, panel: true }); }),
          linked.length > 0 && el("div", { class: "hint" }, t("link.leads", linked.map(layerName).join(" · "))), cropBtn, unlinkBtn],
          t(L.fill ? "props.fillHint" : "props.printHint")),
    psec("props.sec.picture", [
      slider("props.blur", 0, 80, 1, L.blur, px, (v) => { holdLive(L.id); set("blur", v); }),
      slider("props.dim", 0, 0.9, 0.01, L.dim, pct, (v) => { holdLive(L.id); set("dim", v); }),
      check("props.treat", L.treat, (v) => set("treat", v))], t("props.treatTip")),
    psec("props.sec.lines", [
      slider("props.outline", 0, 40, 1, L.outline, px, (v) => { holdLive(L.id); set("outline", v); }),
      slider("props.subjectShadow", 0, 1, 0.05, L.shadow, pct, (v) => { holdLive(L.id); set("shadow", v); }),
      swatch(L, "ink", "props.sw.outline", "#ffffff"),
      el("div", { style: "margin-top:12px" }, cap("props.edge"), el("div", { class: "seg wide" }, ["solid", "torn", "dash"].map((k) => {
        const now = L.torn ? "torn" : L.dash ? "dash" : "solid";
        return el("button", { class: "btn" + (now === k ? " on" : ""), onclick: () => { L.torn = k === "torn"; L.dash = k === "dash"; if (k !== "solid" && !(L.outline > 0)) L.outline = 16; touch({ cover: true, side: true, panel: true }); } }, t("props.edge." + k));   // with no outline yet, one to see it on
      })))], t("props.photoLinesTip")),
  ];
}

/** The lettering layers below cut-out L (or asset L) on this cover (those it may weave with), top first, as the layer list has them. */
const weavableOf = (L) => weavable(S.cover.layers, S.cover.layers.indexOf(L)).filter((l) => appliesTo(l, cat().id) && !l.off).reverse();
/** Those of them that cut-out L weaves with (see `weave` in layers.js). */
const wovenOf = (L) => (L.weave ? weavableOf(L).filter((l) => L.weave.with.includes(l.id)) : []);
/** Weaving's words for what weaves, string `key`: a cut-out has a subject, a head and a photo; an asset is itself, with a top and a box of its own (`key`.asset). */
const weaveT = (L, key) => t(L && L.type === "asset" ? key + ".asset" : key);
/**
 * Weaving a cut-out, or an asset (see canWeave), with the lettering below it (`weave`, see layers.js): on or off —
 * on, it weaves with the title (or the lettering nearest below it), its head in front; the lettering layers below
 * it, each ticked to weave with; the way: its head (an asset's top) in front and the rest behind, down to the line
 * set, the letters chosen in front, chosen in a window of their own (weaveOpen), or where it is painted so on the
 * canvas (brushOpen). A way chosen keeps the others' data, for going back to them.
 */
function weaveControls(L) {
  const w = L.weave, below = weavableOf(L);
  const put = (patch) => { L.weave = { ...L.weave, ...patch }; touch({ cover: true, side: true }); if (S.weaveWin) weaveShow(true); if (S.brushWin) brushShow(true); };
  const on = (v) => {
    if (!v) { delete L.weave; weaveClose(); brushClose(); return touch({ cover: true, side: true }); }
    const first = below.find((l) => l.id === "title") || below[0];
    L.weave = { with: first ? [first.id] : [], by: "head", line: 0.3, front: {} };
    touch({ cover: true, side: true });
  };
  const tick = (l, yes) => {   // a layer woven with, or no longer (its letters in front go with it); as the weave is now (the window may have changed it)
    const now = L.weave, front = Object.fromEntries(Object.entries(now.front || {}).filter(([id]) => yes || id !== l.id));
    put({ with: yes ? [...now.with.filter((id) => id !== l.id), l.id] : now.with.filter((id) => id !== l.id), front });
  };
  if (!w && !below.length) return psec("props.sec.weave", el("div", { class: "hint", style: "margin:0" }, t("weave.none")), weaveT(L, "weave.tip"));
  return psec("props.sec.weave", [
    check("weave.on", !!w, on),
    w && !below.length && el("div", { class: "hint" }, t("weave.none")),
    w && below.length > 0 && el("div", { class: "weave-with" }, below.map((l) => el("label", { class: "chk" }, el("input", { type: "checkbox", checked: w.with.includes(l.id), onchange: (e) => tick(l, e.target.checked) }), layerName(l)))),
    w && el("div", { style: "margin-top:10px" }, select(WEAVE_WAYS.map((k) => [k, k === "head" ? weaveT(L, "weave.by.head") : t("weave.by." + k)]), w.by, (v) => put({ by: v }))),
    w && w.by === "head" && slider(L.type === "asset" ? "weave.line.asset" : "weave.line", 0.1, 0.9, 0.01, w.line, pct, (v) => { holdLive(L.id); L.weave = { ...L.weave, line: v }; touch({ cover: true }); }),
    w && w.by === "letters" && el("button", { class: "btn wide", style: "margin-top:8px", disabled: !wovenOf(L).length, onclick: () => weaveOpen(L) }, t("weave.choose")),
    w && w.by === "brush" && el("button", { class: "btn wide", style: "margin-top:8px", disabled: !wovenOf(L).length, onclick: () => brushOpen(L) }, t("weave.paint")),
  ], weaveT(L, "weave.tip"));
}

// The weave window (S.weaveWin, the id of a cut-out, or an asset, woven letter by letter): for each layer it weaves
// with, its letters line by line (a column of vertical lettering counting as a line), each in front of the subject
// or behind it at a click, and all of them at once, or every other one. It stands over the left column as the letter
// and crop windows do, one of them closing the others, and closes as they do: Esc, ×, Done, another layer
// selected, Setup, or the cut-out no longer woven letter by letter.
function weaveOpen(L) {
  const win = $("weavewin") || document.body.appendChild(el("div", { id: "weavewin", role: "dialog", "aria-label": t("weave.title") }));
  lettersClose(); cropClose(); brushClose(); if ($("deal") && !$("deal").hidden) dealClose();   // the windows over the left column stand where this one does; Surprise me's covers it
  overLeft(win);
  S.weaveWin = L.id; win.hidden = false; placeFrames();
  weaveShow(true);
}
function weaveClose() { const win = $("weavewin"); if (win) win.hidden = true; S.weaveWin = null; placeFrames(); }
/** What the weave window shows of cut-out L: when it is the same, it is not drawn again. */
const weaveNow = (L) => JSON.stringify([L.weave, wovenOf(L).map((l) => [l.id, wordsOf(l)]), getLang()]);
/** The weave window drawn (again) for its cut-out as it is now, or closed (see above); unless `now`, only when what it shows changed. */
function weaveShow(now = false) {
  const win = $("weavewin"), L = S.weaveWin ? layer(S.weaveWin) : null;
  if (!win || win.hidden) return;
  if (!L || !canWeave(L) || !L.weave || L.weave.by !== "letters" || S.layerId !== L.id || S.mode !== "edit") return weaveClose();
  const box = $("weave-box");
  if (!now && box && box._layer === L && box.dataset.now === weaveNow(L)) return;
  const inner = el("div", { id: "weave-box", "data-now": weaveNow(L) }, weaveLetters(L));
  inner._layer = L;
  win.replaceChildren(
    el("div", { class: "head" }, el("b", {}, `${t("weave.title")} · ${layerName(L)}`), el("button", { class: "x", title: t("deal.close"), onclick: weaveClose }, "✕")),
    el("div", { class: "wkey" }, el("span", {}, el("span", { class: "wl on" }, "A"), " ", weaveT(L, "weave.inFront")), el("span", {}, el("span", { class: "wl" }, "A"), " ", weaveT(L, "weave.behind"))),
    inner,
    el("div", { class: "hint" }, weaveT(L, "weave.hint")),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: weaveClose }, t("deal.done"))));
}
/** Each layer cut-out (or asset) L weaves with: its name, all its letters in front or behind at once, and its letters line by line, each to click. */
function weaveLetters(L) {
  const layers = wovenOf(L);
  if (!layers.length) return el("div", { class: "hint" }, t("weave.noLayers"));
  return layers.map((l) => {
    const rows = parseTitle(wordsOf(l)).map((runs, row) => { const cells = lineCells(runs); return { cells, keys: keysOf(cells, row) }; });
    const letters = rows.flatMap(({ cells, keys }) => keys.filter((k, i) => !/^\s+$/.test(cells[i].ch))), front = new Set(frontOf(L.weave, l.id));
    const set = (keys) => {   // this layer's letters in front, the others' as they are (an object built anew: an id is only ever data)
      const all = Object.fromEntries(Object.entries(L.weave.front || {}).filter(([id]) => id !== l.id).concat(keys.length ? [[l.id, keys]] : []));
      L.weave = { ...L.weave, front: all }; touch({ cover: true }); weaveShow(true);
    };
    return el("div", { class: "wlayer" },
      el("div", { class: "whead" }, el("b", {}, layerName(l)),
        el("div", { class: "chips small" }, [["weave.allFront", () => set(letters)], ["weave.allBehind", () => set([])], ["weave.alternate", () => set(letters.filter((_, i) => i % 2 === 0))]].map(([k, fn]) => el("button", { onclick: fn, disabled: !letters.length }, t(k))))),
      letters.length ? el("div", { class: "letters" }, rows.map(({ cells, keys }) => el("div", { class: "lrow" }, cells.map((c, i) => {
        if (/^\s+$/.test(c.ch)) return el("span", { class: "lgap" });
        const on = front.has(keys[i]);
        return el("button", { class: "wl" + (on ? " on" : ""), title: weaveT(L, on ? "weave.inFront" : "weave.behind"), onclick: () => set(on ? [...front].filter((k) => k !== keys[i]) : [...front, keys[i]]) }, c.ch);
      })))) : el("div", { class: "hint" }, t("weave.noWords")));
  });
}

// ---------- the weave's brush: painted on the canvas, where the lettering comes in front of a cut-out and where it
// stays behind (`strokes`, see normalizeWeave in layers.js). S.brushWin is the cut-out painted on; its panel
// (#brushwin) stands over the left column as the weave and crop windows do, one of them closing the others, and
// closes as they do (Esc, ×, Done, another layer selected, Setup, the cut-out no longer woven by the brush). While
// it is open the canvas only paints: nothing there is selected, moved, scaled or turned, and of the keys only Esc and
// undo do anything. A stroke is kept in the photo's own frame, its radius a share of the photo's longer side, so it
// stays on what it was painted on whatever is done with the photo, at every size; on an asset, in the box it is drawn
// in, as its head is measured (see PAINT.asset in render.js). While it is painted only the cut-out is painted again
// each frame, the rest of the cover kept as images (LIVE, see drawCover), and its brush mask is only drawn on (see
// brushMask in render.js); let go, it is one step of undo.
/** The brush: how wide it paints, in the cover's own units (as the canvas's handles are); in front or behind; the stroke being painted and how to end it; where the pointer last was over the canvas. */
const BRUSH = { size: 80, front: true, stroke: null, end: null, at: null };
function brushOpen(L) {
  const win = $("brushwin") || document.body.appendChild(el("div", { id: "brushwin", role: "dialog", "aria-label": t("brush.title") }));
  lettersClose(); cropClose(); weaveClose(); if ($("deal") && !$("deal").hidden) dealClose();   // the windows over the left column stand where this one does; Surprise me's covers it
  if (V3.on) close3d();   // it paints on the flat canvas
  overLeft(win);
  S.brushWin = L.id; win.hidden = false;
  brushShow(true); queueDraw(false);
}
function brushClose() {
  const win = $("brushwin"), ring = $("brushring");
  if (win) win.hidden = true;
  if (BRUSH.end) BRUSH.end();   // a stroke being painted ends where it is
  if (ring) ring.hidden = true;
  if (!S.brushWin) return;
  S.brushWin = null; $("cv").style.cursor = "";
  queueDraw(false);   // without the painted area over it
}
/** What the brush panel shows of cut-out L: when it is the same, it is not drawn again. */
const brushNow = (L) => JSON.stringify([(L.weave.strokes || []).length, BRUSH.front, getLang()]);
/** The brush panel drawn (again) for its cut-out as it is now, or closed (see above); unless `now`, only when what it shows changed. */
function brushShow(now = false) {
  const win = $("brushwin"), L = S.brushWin ? layer(S.brushWin) : null;
  if (!win || win.hidden) return;
  if (!L || !canWeave(L) || !L.weave || L.weave.by !== "brush" || S.layerId !== L.id || S.mode !== "edit" || group().length) return brushClose();
  const box = $("brush-box");
  if (!now && box && box._layer === L && box.dataset.now === brushNow(L)) return;
  const way = (front) => el("button", { class: "btn" + (BRUSH.front === front ? " on" : ""), title: weaveT(L, front ? "brush.frontTip" : "brush.behindTip"), onclick: () => { BRUSH.front = front; brushShow(true); } }, t(front ? "brush.front" : "brush.behind"));
  const inner = el("div", { id: "brush-box", "data-now": brushNow(L) },
    slider("brush.size", 6, 400, 1, BRUSH.size, px, (v) => { BRUSH.size = v; }),
    el("div", { class: "seg wide", style: "margin-top:10px" }, way(true), way(false)));
  inner._layer = L;
  win.replaceChildren(
    el("div", { class: "head" }, el("b", {}, `${t("brush.title")} · ${layerName(L)}`), el("button", { class: "x", title: t("deal.close"), onclick: brushClose }, "✕")),
    inner,
    el("div", { class: "hint" }, weaveT(L, "brush.hint")),
    el("div", { class: "acts" },
      el("button", { class: "btn", disabled: !(L.weave.strokes || []).length, onclick: () => brushClear(L) }, t("brush.clear")),
      el("button", { class: "btn", onclick: brushClose }, t("deal.done"))));
}
/** Takes every stroke away: one step of undo, as a stroke is. */
function brushClear(L) {
  clearTimeout(timers.hist); commitHistory();   // a change still waiting to be recorded is a step of its own
  const { strokes, ...rest } = L.weave;
  L.weave = rest;
  touch({ cover: true }); clearTimeout(timers.hist); commitHistory();
  brushShow(true);
}
/** The size of what woven layer L is painted on with the brush, [w, h]: a cut-out's picture, the box an asset is drawn in; null when it has none. */
function pictureSize(L) {
  if (L.type === "asset") { const half = assetHalf(L.ref); return half ? [2 * half.hw, 2 * half.hh] : null; }
  const rec = recordOf(L);
  return rec && rec.img ? sizeOf(rec.img) : null;
}
/**
 * A stroke of the brush, from where the pointer is pressed on the canvas to where it is let go: into the cut-out's
 * (or the asset's) strokes, each place the pointer passes taken into the photo's frame by the map its hit carries
 * (`pf`), smoothed a little (brushNext), a point at least a quarter of the radius from the last; in front, or behind
 * with Alt/Option held (or the other way round when the panel says behind). Within the strokes' limits (WEAVE_MAX),
 * with a word when they are reached.
 */
function brushDown(e) {
  const cv = $("cv"), L = layer(S.brushWin), hit = L && cv._hits && cv._hits.find((h) => h.id === L.id), size = L && pictureSize(L);
  if (e.button !== 0 || BRUSH.stroke || !hit || !hit.pf || !size || !L.weave) return;
  const w = L.weave, used = strokePoints(w);
  if ((w.strokes || []).length >= WEAVE_MAX.strokes || used >= WEAVE_MAX.total) return toast(t("brush.full"));
  const [nw, nh] = size, m = hit.pf, room = Math.min(WEAVE_MAX.points, WEAVE_MAX.total - used), aspect = nw / nh;
  const fix = (q) => q && q.map((v) => Math.round(clamp(v, -1, 2) * 1e4) / 1e4);   // as normalizeWeave keeps it
  const at = (ev) => { const p = virtualPoint(ev); return fix(photoPoint(m, p.x, p.y)); };
  const r = Math.round(clamp(BRUSH.size / 2 / photoLong(m, nw, nh), BRUSH_R[0], BRUSH_R[1]) * 1e4) / 1e4, gap = r / 4;
  const first = at(e);
  if (!first) return;
  clearTimeout(timers.hist); commitHistory();   // a change still waiting to be recorded is a step of its own
  const st = { front: BRUSH.front !== e.altKey, r, pts: [first] }, recent = [first];
  let full = false;
  const add = (p) => { if (!p) return; if (st.pts.length < room) st.pts.push(p); else if (!full) { full = true; toast(t("brush.full")); } };
  (w.strokes = w.strokes || []).push(st);
  BRUSH.stroke = st;
  LIVE = { ids: [L.id], key: "brush" };   // only the cut-out is painted again, the rest of the cover kept as it is
  cv.onpointermove = (mv) => {
    const all = mv.getCoalescedEvents ? mv.getCoalescedEvents() : [];
    for (const ev of all.length ? all : [mv]) {   // every place the pointer was since the last event
      const p = at(ev);
      if (!p) continue;
      recent.push(p); if (recent.length > 3) recent.shift();
      add(fix(brushNext(st.pts, recent, gap, aspect)));
    }
    queueDraw();
  };
  const end = (up) => {
    cv.onpointermove = cv.onpointerup = cv.onpointercancel = null; BRUSH.stroke = BRUSH.end = null;
    const p = up && up.type === "pointerup" && at(up);
    if (p) add(fix(brushNext(st.pts, [p], gap / 4, aspect)));   // it ends where the pointer was let go
    persistCover(); commitHistory();   // the stroke: one step of undo
    endLive(); brushShow(true);
  };
  cv.onpointerup = cv.onpointercancel = end;
  BRUSH.end = () => end(null);
  queueDraw();
  cv.setPointerCapture(e.pointerId);
}
/** The brush's ring under the pointer over the canvas: as wide as it paints, dashed while it takes the lettering behind. */
function brushRing(e) {
  const cv = $("cv"), ring = $("brushring") || document.body.appendChild(el("div", { id: "brushring" }));
  if (!S.brushWin || !cv._virtual) { ring.hidden = true; return; }
  const b = cv.getBoundingClientRect(), d = Math.max(4, (BRUSH.size * b.width) / cv._virtual[0]), front = BRUSH.stroke ? BRUSH.stroke.front : BRUSH.front !== !!e.altKey;
  BRUSH.at = { clientX: e.clientX, clientY: e.clientY };
  Object.assign(ring.style, { left: `${e.clientX - d / 2}px`, top: `${e.clientY - d / 2}px`, width: `${d}px`, height: `${d}px` });
  ring.classList.toggle("behind", !front); ring.hidden = false;
}
// Alt/Option pressed or let go over the canvas: the ring shows the way the next stroke will go
for (const type of ["keydown", "keyup"]) addEventListener(type, (e) => { if (e.key === "Alt" && S.brushWin && BRUSH.at && !BRUSH.stroke) brushRing({ ...BRUSH.at, altKey: e.altKey }); });

// The crop window (S.cropWin, the id of a photo or an asset layer): the whole picture, what the layer keeps of it
// (`crop`, see layers.js) framed, the rest dimmed; the frame dragged by its inside, sides and corners, or drawn
// anew outside it, at a shape of the user's or of any ratio. Or cropped free, to a shape of any outline: its corners
// round handles joined by its edges, each dragged alone, the shape by its inside, a corner added where an edge is
// pressed (and dragged on at once) and taken away by a double-click or Delete. It stands over the left column, as the
// letter window does, and closes when another layer is selected, or the photo comes to fill the canvas.
const CROP = { ratio: null, point: null, tap: null };   // the shape kept: null any ratio, "photo" the picture's own, width / height, or "free" any outline; `point`, the free crop's corner picked (Delete takes it away); `tap`, the last press on one ({i, t}: a second soon after takes it away)
const CROP_RATIOS = [[null, "crop.anyRatio"], ["photo", "crop.photo"], [1, "1:1"], [4 / 3, "4:3"], [3 / 4, "3:4"], [16 / 9, "16:9"], [9 / 16, "9:16"], ["free", "crop.free"]];
const WHOLE = { x: 0, y: 0, w: 1, h: 1 }, CROP_PAD = 8;   // CROP_PAD: the window's margin round the picture, in CSS pixels
function cropOpen(L) {
  const win = $("cropwin") || document.body.appendChild(el("div", { id: "cropwin", role: "dialog", "aria-label": t("crop.title") }));
  lettersClose(); weaveClose(); brushClose(); if ($("deal") && !$("deal").hidden) dealClose();   // the windows over the left column stand where this one does; Surprise me's covers it
  overLeft(win);
  S.cropWin = L.id; win.hidden = false; CROP.point = CROP.tap = null; placeFrames();
  cropShow(true);
}
function cropClose() { const win = $("cropwin"); if (win) win.hidden = true; S.cropWin = null; placeFrames(); }
/**
 * The whole of what layer L shows, for the crop window: {im, nw, nh, mask} — a photo's picture (and the mask of its
 * subject when it is cut out), an asset drawn in its colours; null when there is nothing to crop (a photo filling
 * the canvas, an asset gone from the library).
 */
const canCrop = (L) => !!L && (L.type === "photo" ? !!recordOf(L)?.img && !(L.fill && !L.of) : L.type === "asset" && !!assetHalf(L.ref));
function cropSource(L) {
  if (!canCrop(L)) return null;
  if (L.type === "photo") { const rec = recordOf(L), im = rec.img; return { im, nw: im.naturalWidth || im.width, nh: im.naturalHeight || im.height, mask: L.cut && rec.mask && rec.mask.img }; }
  const half = assetHalf(L.ref);
  const f = Math.min(2, 1200 / (2 * Math.max(half.hw, half.hh))), im = el("canvas", { width: Math.round(2 * half.hw * f), height: Math.round(2 * half.hh * f) }), g = im.getContext("2d");
  g.translate(im.width / 2, im.height / 2); g.scale(f, f);
  drawAsset(g, L.ref, L.ink ? hexToRgb(L.ink) : hexToRgb(cat().color), { tint: L.tint || !!L.ink });
  return { im, nw: im.width, nh: im.height, mask: null };
}
/** The button opening the crop window for L, in its properties. */
function cropButton(L) {
  const no = !canCrop(L), fills = L.type === "photo" && L.fill && !L.of;
  return el("button", { class: "btn wide", style: "margin-top:8px", disabled: no, title: t(fills ? "crop.fillTip" : "crop.openTip"), onclick: () => cropOpen(L) }, t(L.crop && !no ? "crop.edit" : "crop.open"));
}
/** Crop c (see normalizeCrop; none for the whole picture) put on layer L and drawn as a drag is; whether it changed anything. */
function setCrop(L, c) {
  const n = normalizeCrop(c);
  if (JSON.stringify(n) === JSON.stringify(L.crop || null)) return false;
  if (n) L.crop = n; else delete L.crop;
  holdLive(L.id); touch({ cover: true });
  return true;
}
/**
 * The free crop's corner picked in the crop window taken away (a double-click on it, Delete, Backspace), its two
 * neighbours joined; never below three corners, nor to a shape with (almost) no area (see dropPoint: a word says
 * which). Whether the window crops free: a key pressed then takes a corner away, or none, and never deletes the
 * layer instead.
 */
function cropDropPoint() {
  const L = S.cropWin && layer(S.cropWin);
  if (!L || CROP.ratio !== "free") return false;
  if (CROP.point == null) return true;
  const pts = cropPoly(L.crop), less = dropPoint(pts, CROP.point);
  if (less === pts) { toast(t(pts.length <= 3 ? "crop.least" : "crop.flat")); return true; }
  setCrop(L, { pts: less }); CROP.point = CROP.tap = null;
  cropShow(true);
  return true;
}
/** The crop window drawn (again) for its layer as it is now, or closed (see above); unless `now`, only when the layer or its crop changed (an undo). */
function cropShow(now = false) {
  const win = $("cropwin"), L = S.cropWin ? layer(S.cropWin) : null;
  if (!win || win.hidden) return;
  if (!L || S.layerId !== L.id || S.mode !== "edit") return cropClose();
  const stage = $("crop-stage");
  if (!now && stage && stage._layer === L && JSON.stringify(stage._crop) === JSON.stringify(L.crop || null)) return;
  const src = cropSource(L);
  if (!src) return cropClose();
  // the window crops as the layer is cropped: free when it is so, a rectangle when it is one (an undo may turn it)
  if (L.crop && L.crop.pts) CROP.ratio = "free"; else if (L.crop && CROP.ratio === "free") CROP.ratio = null;
  const free = CROP.ratio === "free";
  if (!free || CROP.point >= cropPoly(L.crop).length) CROP.point = null;
  const { im, nw, nh, mask } = src;
  const cv = el("canvas", { id: "crop-stage", style: `width:100%;display:block;touch-action:none;cursor:${free ? "default" : "crosshair"}` });
  cv._layer = L; cv._crop = L.crop || null;
  const shape = (r) => (r === "photo" ? 1 : r ? (r * nh) / nw : null);   // a shape as dragCrop wants it: in fractions of the picture
  const size = $("crop-size") || el("div", { id: "crop-size", class: "hint" });
  const put = (c) => { if (setCrop(L, c)) cv._crop = L.crop || null; };
  // the picture fitted to the window, the frame (or the free crop's shape) over it; drawn again as it is dragged
  let k = 1, ox = 0, oy = 0, still = null, hover = null;   // hover: where a corner would go on the edge under the pointer
  const onStage = ([u, v]) => [ox + u * nw * k, oy + v * nh * k];
  const draw = () => {
    const w = cv.clientWidth || 400, h = Math.min(360, Math.round((w * nh) / nw)), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + "px"; }
    const pad = Math.min(CROP_PAD, h / 4);   // a margin round it, for the handles on its edges (less round a very thin picture)
    k = Math.min((w - 2 * pad) / nw, (h - 2 * pad) / nh); ox = (w - nw * k) / 2; oy = (h - nh * k) / 2;
    const g = cv.getContext("2d"), c = L.crop || WHOLE, X = ox + c.x * nw * k, Y = oy + c.y * nh * k, W = c.w * nw * k, H = c.h * nh * k;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    if (mask) {   // cut out: the subject bright over the rest of the picture
      if (!still) { still = Object.assign(document.createElement("canvas"), { width: nw, height: nh }); const s = still.getContext("2d"); s.drawImage(im, 0, 0); s.globalCompositeOperation = "destination-in"; s.drawImage(mask, 0, 0, nw, nh); }
      g.globalAlpha = 0.35; g.drawImage(im, ox, oy, nw * k, nh * k); g.globalAlpha = 1; g.drawImage(still, ox, oy, nw * k, nh * k);
    } else g.drawImage(im, ox, oy, nw * k, nh * k);
    if (free) {   // the shape: what lies outside it dimmed, its edges, its corners as round handles (the one picked in the channel colour)
      const P = cropPoly(L.crop).map(onStage), trace = () => { P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); };
      g.fillStyle = "rgba(7,7,12,.6)"; g.beginPath(); g.rect(ox, oy, nw * k, nh * k); trace(); g.fill("evenodd");
      g.beginPath(); trace(); g.lineJoin = "round"; g.strokeStyle = "#07070c"; g.lineWidth = 3; g.stroke(); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.stroke();
      if (hover) {   // a press here adds a corner: a faint one, with a plus
        g.beginPath(); g.arc(hover.px, hover.py, 6, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.55)"; g.fill(); g.strokeStyle = "#07070c"; g.lineWidth = 1; g.stroke();
        g.beginPath(); g.moveTo(hover.px - 3, hover.py); g.lineTo(hover.px + 3, hover.py); g.moveTo(hover.px, hover.py - 3); g.lineTo(hover.px, hover.py + 3); g.lineWidth = 1.5; g.stroke();
      }
      P.forEach(([x, y], i) => {
        const on = i === CROP.point;
        g.beginPath(); g.arc(x, y, on ? 6.5 : 5, 0, Math.PI * 2); g.fillStyle = on ? cat().color : "#fff"; g.fill(); g.strokeStyle = "#07070c"; g.lineWidth = on ? 2 : 1.5; g.stroke();
      });
    } else {
      g.fillStyle = "rgba(7,7,12,.6)"; g.beginPath(); g.rect(ox, oy, nw * k, nh * k); g.rect(X, Y, W, H); g.fill("evenodd");
      g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 1; g.beginPath();
      for (const f of [1 / 3, 2 / 3]) { g.moveTo(X + W * f, Y); g.lineTo(X + W * f, Y + H); g.moveTo(X, Y + H * f); g.lineTo(X + W, Y + H * f); }
      g.stroke();
      g.strokeStyle = "#07070c"; g.lineWidth = 3; g.strokeRect(X, Y, W, H); g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.strokeRect(X, Y, W, H);
      for (const [hx, hy] of grips(X, Y, W, H)) { g.fillStyle = "#fff"; g.fillRect(hx - 4, hy - 4, 8, 8); g.strokeStyle = "#07070c"; g.lineWidth = 1; g.strokeRect(hx - 4, hy - 4, 8, 8); }
    }
    size.textContent = t("crop.size", Math.round(c.w * nw), Math.round(c.h * nh), nw, nh) + (free ? ` · ${t("crop.points", cropPoly(L.crop).length)}` : "");
  };
  const grips = (X, Y, W, H) => [[X, Y, "nw"], [X + W / 2, Y, "n"], [X + W, Y, "ne"], [X + W, Y + H / 2, "e"], [X + W, Y + H, "se"], [X + W / 2, Y + H, "s"], [X, Y + H, "sw"], [X, Y + H / 2, "w"]];
  const at = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left - ox) / (nw * k), y: (e.clientY - r.top - oy) / (nh * k), px: e.clientX - r.left, py: e.clientY - r.top }; };
  const grabbed = (p) => {   // a corner, then a side along its length, then the inside
    const c = L.crop || WHOLE, X = ox + c.x * nw * k, Y = oy + c.y * nh * k, W = c.w * nw * k, H = c.h * nh * k, near = (a, b) => Math.abs(a - b) <= 8;
    const g = grips(X, Y, W, H).find(([hx, hy, n]) => n.length === 2 && near(p.px, hx) && near(p.py, hy));
    if (g) return g[2];
    const across = p.px > X - 8 && p.px < X + W + 8, down = p.py > Y - 8 && p.py < Y + H + 8;
    const side = (down && near(p.px, X) && "w") || (down && near(p.px, X + W) && "e") || (across && near(p.py, Y) && "n") || (across && near(p.py, Y + H) && "s");
    return side || (p.px > X && p.px < X + W && p.py > Y && p.py < Y + H ? "move" : null);
  };
  // a corner ({point}), then an edge ({edge, at}: where a corner would go on it; `full` with 64 corners already), then the inside ({move})
  const grabbedFree = (p) => {
    const P = cropPoly(L.crop).map(onStage), d = P.map(([x, y]) => Math.hypot(p.px - x, p.py - y)), i = d.indexOf(Math.min(...d));
    if (d[i] <= 9) return { point: i };
    const e = edgePoint(P, p.px, p.py);
    if (e.d <= 7) return { edge: e.i, at: [(e.x - ox) / (nw * k), (e.y - oy) / (nh * k)], px: e.x, py: e.y, full: P.length >= CROP_PTS };
    return inPoly(P, p.px, p.py) ? { move: true } : null;
  };
  cv.onpointermove = (e) => {
    if (cv._drag) return;
    if (!free) { const g = grabbed(at(e)); cv.style.cursor = !g ? "crosshair" : g === "move" ? "move" : `${g}-resize`; return; }
    const g = grabbedFree(at(e)), was = hover, edge = g && g.edge != null;
    hover = edge && !g.full ? g : null;   // with 64 corners an edge offers none: it says so instead
    cv.style.cursor = !g ? "default" : g.point != null ? "grab" : edge ? (g.full ? "not-allowed" : "copy") : "move";
    cv.title = edge ? (g.full ? t("crop.most", CROP_PTS) : t("crop.addPoint")) : "";
    if (was || hover) draw();
  };
  cv.onpointerleave = () => { if (hover && !cv._drag) { hover = null; draw(); } };
  cv.onpointerdown = (e) => {
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    if (free) {   // a corner dragged alone, one added on the edge pressed and dragged on at once, or the whole shape moved
      const from = at(e), g = grabbedFree(from), stamp = performance.now();
      let pts = cropPoly(L.crop), i = null;
      if (!g) { CROP.point = CROP.tap = null; return draw(); }
      if (g.edge != null) {
        const more = addPoint(pts, g.edge, g.at);
        if (more === pts) return toast(t("crop.most", CROP_PTS));
        if (!hasArea(more)) return;   // rounded as it is kept, a corner on the edge of a shape with only just enough could tip it
        pts = more; i = g.edge + 1; CROP.tap = null;
        put({ pts });
      } else if (g.point != null) {
        i = g.point;
        if (CROP.tap && CROP.tap.i === i && stamp - CROP.tap.t < 400) { CROP.point = i; cropDropPoint(); return; }   // a double-click on a corner: it goes
        CROP.tap = { i, t: stamp };
      }
      CROP.point = i; hover = null; cv._drag = true; cv.title = "";
      if (i != null) cv.style.cursor = "grabbing";
      cv.onpointermove = (m) => {
        const p = at(m), dx = p.x - from.x, dy = p.y - from.y;
        if (Math.hypot(p.px - from.px, p.py - from.py) > 3) CROP.tap = null;   // dragged: not the first click of a double-click
        const next = i == null ? movePoly(pts, dx, dy) : dragPoint(pts, i, dx, dy);
        if (hasArea(next)) put({ pts: next });   // a corner, or the shape, stops where the shape last had area as it is kept (see hasArea)
        draw();
      };
      cv.onpointerup = cv.onpointercancel = () => { cv._drag = false; cropShow(true); };
      return draw();
    }
    let last = at(e);
    const handle = grabbed(last), from = { x: Math.min(1, Math.max(0, last.x)), y: Math.min(1, Math.max(0, last.y)), px: last.px, py: last.py };
    const keep = (L.crop || WHOLE).w / (L.crop || WHOLE).h;   // Shift keeps the shape it has
    cv._drag = true;
    cv.onpointermove = (m) => {
      const p = at(m), r = m.shiftKey ? keep : shape(CROP.ratio);
      if (handle) put(dragCrop(L.crop || WHOLE, handle, p.x - last.x, p.y - last.y, handle === "move" ? null : r));
      else if (Math.hypot(p.px - from.px, p.py - from.py) > 4) put(drawnCrop(from, p, r));   // outside the frame: a new one, from where it was pressed (a click alone changes nothing)
      last = p; draw();
    };
    cv.onpointerup = cv.onpointercancel = () => { cv._drag = false; cropShow(true); };
  };
  // a shape chosen: free starts from the whole picture's four corners (a free crop stays as it is); any ratio, from a
  // free crop, is the box round it; any other shape is fitted about what was kept
  const chip = ([r, label]) => el("button", { class: CROP.ratio === r ? "on" : "", onclick: () => {
    const was = L.crop;
    CROP.ratio = r; CROP.point = CROP.tap = null;
    if (r === "free") { if (!(was && was.pts)) put(null); }
    else if (r) put(fitCrop(was || WHOLE, shape(r)));
    else if (was && was.pts) put({ x: was.x, y: was.y, w: was.w, h: was.h });
    cropShow(true);
  } }, label.includes(":") ? label : t(label));
  win.replaceChildren(
    el("div", { class: "head" }, el("b", {}, `${t("crop.title")} · ${layerName(L)}`), el("button", { class: "x", title: t("deal.close"), onclick: cropClose }, "✕")),
    cv,
    el("div", { class: "chips small" }, CROP_RATIOS.map(chip)),
    size,
    el("div", { class: "hint" }, t(free ? "crop.hintFree" : "crop.hint")),
    el("div", { class: "acts" }, el("button", { class: "btn", disabled: !L.crop, onclick: () => { put(WHOLE); cropShow(true); } }, t("crop.reset")), el("button", { class: "btn", onclick: cropClose }, t("deal.done"))));
  requestAnimationFrame(draw);
}
/**
 * The colour of a vector asset: its own colours, the channel colour, or one of the user's
 * (`ink`, which wins). A channel graphic always takes a single colour: the channel's, or the user's.
 */
function assetColour(L) {
  const graphic = L.ref.kind === "graphic", mode = L.ink ? "custom" : graphic || L.tint ? "channel" : "own";
  const choose = (v) => {
    if (v === "custom") L.ink = L.ink || cat().color; else delete L.ink;
    if (!graphic) L.tint = v === "channel";
    touch({ cover: true, side: true });
  };
  return psec("props.sec.color", [
    select([!graphic && ["own", t("props.assetOwn")], ["channel", t("props.assetChannel")], ["custom", t("props.assetCustom")]].filter(Boolean), mode, choose),
    mode === "custom" && swatch(L, "ink", "props.sw.color", cat().color, false)]);
}
function typeControls(L) {
  const set = (k, v, side = false) => { L[k] = v; touch({ cover: true, side }); };
  const font = () => psec("props.sec.text", [fontControl(L, true), ...columnControls(L)], [L.type === "brand" ? "" : t(L.type === "catname" ? "props.catnameHint" : "props.boundHint"), L.type === "brand" && L.vertical ? t("props.verticalBrand") : ""].filter(Boolean).join(" "));
  const ink = () => psec("props.sec.color", swatch(L, "ink", "props.sw.text", inksShown(L).ink), t("props.inkAutoHint"));
  switch (L.type) {
    case "bg": {
      const oneTheme = (LOOKS[S.profile.style.look] || LOOKS.cel).oneTheme, covered = S.profile.style.theme === "light" && recordOf(mainPhoto());
      return psec("props.sec.ground", [
        select([["grid", t("bg.base.grid")], ["look", t("bg.base.look")], ["clear", t("bg.base.clear")]], L.base, (v) => set("base", v)),
        oneTheme ? el("div", { class: "hint", style: "margin:0" }, t("props.oneTheme")) : select([["dark", t("theme.dark")], ["light", t("theme.light")]], S.profile.style.theme, (v) => { S.profile.style.theme = v; touch({ profile: true, side: true }); })], [t("props.bgHint"), covered && t("props.lightUnderPhoto")].filter(Boolean).join(" "));
    }
    case "photo": return photoControls(L, set);
    case "accent": return [psec("props.sec.shape", select(ACCENT_SHAPES.map((k) => [k, t("shape." + k)]), L.shape, (v) => set("shape", v, false))), blockSection()];
    case "brand": return [font(), ink(), psec("props.sec.show", check("props.rail", L.rail, (v) => set("rail", v)))];
    case "logo": return psec("props.sec.logo", logoControls(), t("props.logoHint"));
    case "title": case "subtitle": case "text": return headlineControls(L, set);
    case "tag": return [font(), ink()];
    case "catname": return [psec("props.sec.show", [check("props.showName", L.showName, (v) => set("showName", v)), check("props.plate", L.plate, (v) => set("plate", v))]), font(), ink()];
    case "graphic": return el("div", { class: "hint", style: "margin:0;grid-column:1/-1" }, t("props.graphicHint"));
    case "asset": return [canTint(L.ref) && assetColour(L), psec("crop.title", cropButton(L), t("crop.openTip")), weaveControls(L)];
    case "solid": return psec("props.sec.color", swatch(L, "color", "props.sw.color", cat().color, false));
  }
  return null;
}
/** The name of the current look's scene object `key`. */
const sceneName = (key) => { const s = (LOOKS[S.profile.style.look] || LOOKS.cel).scene; return (s && s[key] && s[key][getLang()]) || key; };
/**
 * With the ground selected: the current look's scene objects the user may drag on the canvas, each with a
 * button putting it back where the layout puts it (on this cover; for all sizes, those facing this one's way or
 * this one, as the scope under the canvas says), and one for them all.
 */
function sceneSection(L) {
  const scene = L.type === "bg" && (LOOKS[S.profile.style.look] || LOOKS.cel).scene;
  if (!scene) return null;
  const look = S.profile.style.look, f = frame(), off = sceneOffsets(S.cover, look, f.key), scope = S.settings.scope;
  const isMoved = (k) => !!off[k] && (Math.abs(off[k][0]) > 1e-4 || Math.abs(off[k][1]) > 1e-4);
  const reset = (k) => { resetScene(S.cover, look, k, scope, f.key, scopeKeys() || [f.key]); touch({ cover: true, side: true }); };
  return [el("div", { class: "psep" }), psec("props.sec.scene", [
    check("scene.hide", S.settings.hideScene, (v) => { S.settings.hideScene = v; persistSettings(); queueDraw(); renderSide(); }),
    ...Object.keys(scene).map((k) => el("div", { class: "fxs" },
      el("span", { class: "jump", title: t("scene.jumpTip"), onclick: () => jumpToScene(k) }, sceneName(k)),
      el("div", { class: "fxa" }, el("button", { class: "linkbtn", disabled: !isMoved(k), onclick: () => reset(k) }, t("scene.reset"))))),
    el("button", { class: "btn wide", disabled: !Object.keys(scene).some(isMoved), onclick: () => reset(null) }, t("scene.resetAll")),
  ], t("scene.hint"))];
}
/**
 * Shows where scene object `key` is: takes the pointer to its handle (in the app) and rings it once. An
 * object not painted (its slider at 0) has no place to show.
 */
function jumpToScene(key) {
  if (V3.on) close3d();   // its handle is on the flat canvas
  const cv = $("cv"), q = (cv._scene || []).find((s) => s.key === key);
  if (!q || !cv._virtual) return toast(t("scene.notShown", sceneName(key)));
  const r = cv.getBoundingClientRect(), k = cv._virtual[0] / r.width, x = r.left + q.x / k, y = r.top + q.y / k;
  if (CAN.pointer && !S.settings.hideScene) invoke("move_pointer", { x, y }).catch(() => null);
  const ring = el("div", { class: "scene-ping", style: `left:${x}px;top:${y}px` });   // a ring on the page over the canvas: no redraw of the cover
  document.body.append(ring);
  setTimeout(() => ring.remove(), 1000);
}
/** The looks a layer borrows from, in the order they were added (by layer id; those with effects on are kept with the layer itself). */
const BORROWED = new Map();
/**
 * The look effects a layer carries (see layerEffects in style.js): the current look's, then the looks it
 * borrows from — each its name, buttons to remove it (a borrowed one) and to clear it, and its sliders —
 * and below them a menu of the looks it could still borrow from, then buttons to clear every effect and to
 * remove them all. An effect's own settings show under it once it is on.
 */
function lookFxSection(L) {
  if (!FX_TYPES.includes(L.type)) return null;
  const here = S.profile.style.look, lang = getLang(), fx = L.lookFx || {}, name = (id) => (LOOKS[id] || LOOKS.cel).name[lang];
  const put = (id, v) => {
    holdLive(L.id);
    const o = { ...(L.lookFx || {}) };
    if (id.includes(":") || v > 0) o[id] = v;
    else { delete o[id]; for (const k of Object.keys(o)) if (k.startsWith(id + ":")) delete o[k]; }
    if (Object.keys(o).some((k) => !k.includes(":"))) L.lookFx = o; else delete L.lookFx;
    touch({ cover: true });
  };
  const rows = (look) => effectsFor(look, L.type).flatMap((e) => {
    const id = `${look}.${e.key}`, on = fx[id] > 0;
    return [slider2(e.name[lang], 0, 1, 0.05, fx[id] || 0, (v) => { put(id, v); if ((v > 0) !== on) later("side", 400, renderSide); }),
      ...(on ? (e.sub || []).map((s) => slider2("· " + s.name[lang], 0, 1, 0.05, fx[`${id}:${s.key}`] ?? s.def, (v) => put(`${id}:${s.key}`, v))) : [])];
  });
  // the borrowed looks: those added here, in order, then any with effects on the layer not among them (from before, or brought from another look)
  const lent = [...new Set(Object.keys(fx).filter((k) => !k.includes(":")).map((k) => k.split(".")[0]))];
  const list = [...new Set([...(BORROWED.get(L.id) || []), ...lent])].filter((k) => k !== here && LOOKS[k] && effectsFor(k, L.type).length);
  BORROWED.set(L.id, list);
  const left = LOOK_IDS.filter((k) => k !== here && !list.includes(k) && effectsFor(k, L.type).length);
  // clearing sets a look's effects back to 0 and keeps its group; removing a borrowed look takes the group away too
  const clear = (look) => {
    const o = { ...(L.lookFx || {}) };
    for (const k of Object.keys(o)) if (k.startsWith(look + ".")) delete o[k];
    if (Object.keys(o).length) L.lookFx = o; else delete L.lookFx;
  };
  const remove = (look) => { clear(look); BORROWED.set(L.id, list.filter((k) => k !== look)); touch({ cover: true, side: true }); };
  const has = (look) => Object.keys(fx).some((k) => !k.includes(":") && k.startsWith(look + ".")), any = Object.keys(fx).some((k) => !k.includes(":"));
  const link = (label, hint, off, onclick) => el("button", { class: "linkbtn", title: hint, disabled: off, onclick }, label);
  const head = (look, borrowed) => el("div", { class: "fxs" }, borrowed ? el("span", {}, name(look)) : el("span", { class: "fxt" }, t("lookfx.here", name(look))), el("div", { class: "fxa" },
    borrowed && link(t("lookfx.remove"), t("lookfx.removeHint", name(look)), false, () => remove(look)),
    effectsFor(look, L.type).length > 0 && link(t("lookfx.clearOne"), t("lookfx.clearOneHint", name(look)), !has(look), () => { clear(look); touch({ cover: true, side: true }); })));
  return [el("div", { class: "psep" }), psec("props.sec.lookFx", [
    head(here, false),
    effectsFor(here, L.type).length ? rows(here) : el("div", { class: "hint", style: "margin:0" }, t("lookfx.none", name(here))),
    (list.length > 0 || left.length > 0) && el("div", { class: "fxh" }, t("lookfx.others")),
    list.flatMap((k) => [head(k, true), ...rows(k)]),
    (list.length > 0 || left.length > 0) && el("button", { class: "btn wide", onclick: () => borrowDialog(L, here, list) }, t("lookfx.borrowBtn")),
    el("button", { class: "btn wide", title: t("lookfx.clearHint"), disabled: !any, onclick: () => { delete L.lookFx; touch({ cover: true, side: true }); } }, t("lookfx.clear")),
    el("button", { class: "btn wide", title: t("lookfx.removeAllHint"), disabled: !any && !list.length, onclick: () => { delete L.lookFx; BORROWED.delete(L.id); touch({ cover: true, side: true }); } }, t("lookfx.removeAll")),
  ], t("lookfx.hint"))];
}
/**
 * The looks a layer may borrow effects from, to pick from: each look, with the effects it has for this kind
 * of layer, in a dashed box; several at once. Those it borrows already come ticked — unticking one takes
 * its effects off the layer.
 */
function borrowDialog(L, here, list) {
  const lang = getLang(), pool = LOOK_IDS.filter((k) => k !== here && effectsFor(k, L.type).length), chosen = new Set(list), m = $("modal");
  const ok = el("button", { class: "btn solid", onclick: () => {
    const gone = list.filter((k) => !chosen.has(k));
    if (gone.length && L.lookFx) {
      const o = { ...L.lookFx };
      for (const k of Object.keys(o)) if (gone.includes(k.split(".")[0])) delete o[k];
      if (Object.keys(o).length) L.lookFx = o; else delete L.lookFx;
    }
    BORROWED.set(L.id, [...list.filter((k) => chosen.has(k)), ...pool.filter((k) => chosen.has(k) && !list.includes(k))]);   // the ones of before keep their place, the new ones after them
    closeModal(); touch({ cover: true, side: true });
  } });
  const sync = () => { ok.textContent = t("lookfx.borrowOk", chosen.size); };
  const card = (k) => {
    const c = el("button", { class: "fxcard" + (chosen.has(k) ? " on" : ""), onclick: () => { if (chosen.has(k)) chosen.delete(k); else chosen.add(k); c.classList.toggle("on", chosen.has(k)); sync(); } },
      el("b", {}, LOOKS[k].name[lang]),
      el("ul", {}, effectsFor(k, L.type).map((e) => el("li", {}, e.name[lang] + (e.sub ? ` · ${e.sub.map((s) => s.name[lang]).join("、")}` : "")))));
    return c;
  };
  m.replaceChildren(el("div", { class: "dlg wide" }, el("h2", {}, t("lookfx.others")), el("div", { class: "hint", style: "margin:0" }, t("lookfx.borrowHint")),
    el("div", { class: "fxcards" }, pool.map(card)),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: closeModal }, t("lookfx.cancel")), ok)));
  sync(); m.hidden = false;
}
/**
 * Surprise me's places for the user's own layers (its numbers are RULES.places in deal.js): each anywhere on the canvas, at a new angle and size,
 * but wholly on it at every size — not a pixel off — and words above the foot where the apps show their
 * counts (wordsFoot in layout.js); and, of the places allowed, one that leaves the title and the subjects
 * cut out of photos uncovered, or as little covered as a dozen tries find — a layer that would still cover
 * more than a quarter of one is made a little smaller and placed again, down to about half its size. A photo
 * takes its subject along (a cut-out over it is put back over it), and is placed before the rest. A layer locked, filling the canvas
 * (a background photo, a colour block as large as the canvas) or following its photo (a cut-out) is left
 * where it is; so is a weave, as a layer locked is (see wovenIds in layers.js): a cut-out or an asset woven with
 * lettering, the lettering it weaves with (a text layer), and a photo whose cut-out weaves, which it would take
 * along. Each layer's box at each size comes from a quick drawing; a layer too big for some size is
 * set straighter, then smaller, until it fits.
 */
function dealPlaces(R) {
  const P = RULES.places, between = (a, b) => a + R() * (b - a), round = (v, step) => Math.round(v / step) * step;
  const fills = (L) => fillsCanvas(L) || (L.type === "solid" && L.t.all.s >= 0.98 && !L.t.all.r), woven = wovenIds(S.cover.layers);
  const movers = S.cover.layers.filter((L) => isFree(L.type) && L.visible && !L.locked && !L.of && !fills(L) && !woven.has(L.id) && !passivesOf(L).some((p) => woven.has(p.id)));
  if (!movers.length) return;
  const boxes = S.profile.sizes.filter((s) => s.on !== false).map((size) => {
    const cv = document.createElement("canvas"), key = sizeKey(size);
    drawCover(cv, { profile: S.profile, catIndex: catIndex(), size, pixelW: 240, cover: S.cover, photos: S.photos });
    return { key, w: cv._virtual[0], h: cv._virtual[1], hits: cv._hits || [] };
  });
  const cut = new Set(S.cover.layers.filter((l) => l.type === "photo" && l.cut).map((l) => l.id));
  for (const b of boxes) b.keep = b.hits.filter((x) => x.type === "title" || cut.has(x.id)).map((x) => ({ id: x.id, ...boxOf(x) }));   // what is better left uncovered
  // the subjects a layer takes with it: its own, a cut-out itself, and those of its linked cut-outs; such layers go first,
  // so the rest keep clear of where they land
  const carried = (L) => [L, ...passivesOf(L)].filter((l) => cut.has(l.id)).map((l) => l.id);
  movers.sort((p, q) => carried(q).length - carried(p).length);
  for (const L of movers) {
    // not what it carries; nothing, clipped into a layer below (it shows only where that one does)
    const clipped = clipBase(S.cover.layers, S.cover.layers.indexOf(L)) >= 0;
    const a = L.t.all, mine = carried(L), per = boxes.map((b) => ({ ...b, hit: b.hits.find((x) => x.id === L.id), keep: clipped ? [] : b.keep.filter((k) => !mine.includes(k.id)) })).filter((b) => b.hit);
    if (!per.length) continue;
    const x0 = a.x, y0 = a.y, s0 = a.s, r0 = a.r, aligned = passivesOf(L).filter((P) => JSON.stringify(P.t) === JSON.stringify(alignedT(L)));
    let s = clamp(a.s * between(P.scale[0], P.scale[1]), P.size[0], P.size[1]), r = round(between(-P.turn, P.turn), 1), smaller = P.shrinks;
    for (let tries = 0; tries < 40; tries++) {
      // where the centre may go at each size, as fractions of the canvas, with this size and angle: the box
      // upright (turned by the size's own extra angle too), less a hair for outlines and shadows
      let lo = [-Infinity, -Infinity], hi = [Infinity, Infinity];
      const fit = [];   // at each size: the place's offset, the box's offset from it and half extents
      for (const p of per) {
        const at = placeOf(L, p.w, p.h, p.key, cat().id), dx = at.cx - a.x * p.w, dy = at.cy - a.y * p.h, k = s / a.s;
        const t = ((r + (at.r - a.r)) * Math.PI) / 180, hw = p.hit.hw * k, hh = p.hit.hh * k, m = Math.min(p.w, p.h) * P.margin;
        const ex = Math.abs(hw * Math.cos(t)) + Math.abs(hh * Math.sin(t)) + m, ey = Math.abs(hw * Math.sin(t)) + Math.abs(hh * Math.cos(t)) + m, foot = L.type === "text" ? wordsFoot(p.w, p.h) : p.h;
        // the box off the place's centre (a cut-out's is round its subject), turned and sized with it
        const turn = ((r - a.r) * Math.PI) / 180, u = p.hit.cx - at.cx, v = p.hit.cy - at.cy, bx = (u * Math.cos(turn) - v * Math.sin(turn)) * k, by = (u * Math.sin(turn) + v * Math.cos(turn)) * k;
        lo = [Math.max(lo[0], (ex - dx - bx) / p.w), Math.max(lo[1], (ey - dy - by) / p.h)]; hi = [Math.min(hi[0], (p.w - ex - dx - bx) / p.w), Math.min(hi[1], (foot - ey - dy - by) / p.h)];
        fit.push({ p, dx, dy, bx, by, ex, ey });
      }
      if (lo[0] <= hi[0] && lo[1] <= hi[1]) {
        // how much of the title and the cut-out subjects a centre at (x, y) would cover, the worst size
        const covers = (x, y) => Math.max(0, ...fit.map(({ p, dx, dy, bx, by, ex, ey }) => { const cx = x * p.w + dx + bx, cy = y * p.h + dy + by, me = { x0: cx - ex, y0: cy - ey, x1: cx + ex, y1: cy + ey }; return Math.max(0, ...p.keep.map((k) => overlap(k, me))); }));
        let best = null;
        for (let n = 0; n < P.tries && !(best && best.c === 0); n++) { const x = between(lo[0], hi[0]), y = between(lo[1], hi[1]), c = covers(x, y); if (!best || c < best.c) best = { x, y, c }; }
        if (best.c > P.cover && smaller-- > 0) { s *= P.shrink; continue; }   // nowhere it leaves them mostly clear: a little smaller, and again (to about half)
        a.x = best.x; a.y = best.y; a.r = r; a.s = s;
        for (const P of aligned) P.t = alignedT(L);   // a cut-out that lay over it still does, at its new size and angle
        // and the subjects it carries are where it put them: its own and those of the cut-outs over it turned and
        // sized about its centre with it; a cut-out moved off it (its size and angle its own) only carried along
        const k = s / s0, turn = ((r - r0) * Math.PI) / 180, cs = Math.cos(turn), sn = Math.sin(turn), follow = new Set([L.id, ...aligned.map((P) => P.id)]);
        for (const { p, dx, dy } of fit) {
          const ox = x0 * p.w + dx, oy = y0 * p.h + dy, nx = best.x * p.w + dx, ny = best.y * p.h + dy;
          for (const kb of boxes.find((b) => b.key === p.key).keep) if (mine.includes(kb.id)) {
            const f = follow.has(kb.id), u = (kb.x0 + kb.x1) / 2 - ox, v = (kb.y0 + kb.y1) / 2 - oy, hw = ((kb.x1 - kb.x0) / 2) * (f ? k : 1), hh = ((kb.y1 - kb.y0) / 2) * (f ? k : 1);
            const cx = nx + (f ? (u * cs - v * sn) * k : u), cy = ny + (f ? (u * sn + v * cs) * k : v);
            Object.assign(kb, { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh });
          }
        }
        break;
      }
      if (r) r = Math.abs(r) < 1 ? 0 : r / 2; else s *= 0.9;   // too big here: straighter first, then smaller
    }
  }
}
/** What every layer has, after a rule: opacity, and putting the placement back. */
function layerSection(L) {
  if (L.type === "bg") return null;
  const fixed = FIXED.includes(L.type), copy = L.type === "photo" && L.of;
  return [el("div", { class: "psep" }),
    psec("props.sec.layer", [
      slider("props.o", 0, 1, 0.01, L.o, pct, (v) => { holdLive(L.id); L.o = v; touch({ cover: true }); }),
      sizesControl(L),
      (isFree(L.type) || L.type === "title") && clipControl(L),
      !fixed && !copy && placementControls(L),   // a cut-out's (back over its photo) is with its placement
      ], fixed ? t("props.fixedHint") : "")];
}
/**
 * The sizes layer L shows at (see `sizes` in layers.js): a button for each of the profile's sizes, by its ratio, lit
 * where it shows, a click putting it there or taking it away (the last one lit stays: a layer at no size is one hidden);
 * with sizes facing more than one way, every size and each orientation's at once underneath. Clipped onto a layer kept
 * to other sizes, it does not show where that one does not either (a base hides what is clipped onto it): those sizes'
 * buttons are greyed, and a line says so.
 */
function sizesControl(L) {
  const all = sizeKeys(), lit = all.filter((k) => inSize(L, k)), list = S.cover.layers, b = clipBase(list, list.indexOf(L));
  const base = b >= 0 ? list[b] : null, gone = base ? all.filter((k) => !inSize(base, k)) : [];
  const keep = (keys) => { keepTo(L, keys, all); touch({ cover: true, side: true, panel: onCoverTab() }); };
  const groups = ORIENTS.map((o) => [o, S.profile.sizes.filter((z) => orientOf(z.w, z.h) === o).map(sizeKey)]).filter(([, g]) => g.length);
  const same = (keys) => keys.length === lit.length && keys.every((k) => lit.includes(k));
  return el("div", { class: "sizes-ctl" }, el("div", { class: "cap" }, t("sizes.cap"), info(t("sizes.tip"))),
    el("div", { class: "sizes-row" }, S.profile.sizes.map((z) => {
      const k = sizeKey(z), on = lit.includes(k), under = gone.includes(k);
      return el("button", { class: "btn" + (on ? " on" : "") + (under ? " away" : "") + (k === S.sel ? " here" : ""), title: under ? t("sizes.baseTip", sizeLabel(z), layerName(base)) : sizeLabel(z), disabled: on && lit.length === 1, onclick: () => keep(on ? lit.filter((x) => x !== k) : [...lit, k]) }, ratioText(z.w, z.h));
    })),
    gone.length > 0 && el("div", { class: "hint", style: "margin:6px 0 0" }, sizesSaid("sizes.base", gone, layerName(base))),
    groups.length > 1 && el("div", { class: "sizes-picks" },
      el("button", { class: "linkbtn" + (same(all) ? " on" : ""), onclick: () => keep(all) }, t("sizes.every")),
      groups.map(([o, g]) => el("button", { class: "linkbtn" + (same(g) ? " on" : ""), title: g.map((k) => { const z = S.profile.sizes.find((x) => sizeKey(x) === k); return ratioText(z.w, z.h); }).join(" · "), onclick: () => keep(g) }, t("sizes.pick." + o)))));
}
/** A free layer's clipping mask: shown only within the shape of the layer below it (see clipBase in layers.js). */
function clipControl(L) {
  const list = S.cover.layers, i = list.indexOf(L);
  let j = i - 1;
  while (j >= 0 && list[j].clip) j--;   // the base it has, or would have
  const base = j >= 0 && list[j].type !== "bg" ? list[j] : null;
  return [el("label", { class: "chk" }, el("input", { type: "checkbox", checked: !!L.clip, disabled: !L.clip && !base,
      onchange: (e) => { if (e.target.checked) L.clip = true; else delete L.clip; touch({ cover: true, side: true }); } }), t("props.clip")),
    el("div", { class: "hint", style: "margin:2px 0 6px" }, base ? t(L.clip ? "props.clipOn" : "props.clipOff", layerName(base)) : t("props.clipNone"))];
}
/** What FOCUS acts on: the selected group's movable layers, or the selected layer if it can be moved. */
function focusTargets() {
  const many = group(), L = layer();
  if (many.length) return movers(many);
  return L && !L.locked && L.type !== "bg" && !FIXED.includes(L.type) ? [L] : [];
}
/** Turns FOCUS on or off. */
function setFocus(on) { S.focus = on; renderSide(); queueDraw(false); }
/** FOCUS: the layers it is on — the selected one, or the group — with a linked photo's other half: kept bright on the canvas, the only ones that can be selected. */
function spotIds() {
  const ids = new Set();
  for (const L of group().length ? group() : layer() ? [layer()] : []) {
    const o = owner(L);
    ids.add(L.id); ids.add(o.id);
    for (const p of passivesOf(o)) ids.add(p.id);
  }
  return [...ids];
}
/** Whether layer id may be selected now: with FOCUS on, only what it is on; anything else is refused, with a word on why. */
function focusAllows(id) {
  if (!S.focus || S.mode !== "edit" || spotIds().includes(id)) return true;
  toast(t("focus.locked"));
  return false;
}
/** The layout layers on the cover on the canvas (the ones the template brings, marked with the layout icon). */
const layoutLayers = () => S.cover.layers.filter((l) => isLayout(l) && !l.off && appliesTo(l, cat().id));
let LAYOUT_HID = null;   // { cover, ids }: the template's layers that were showing when "Hide layout" hid them
/**
 * Hide layout / Show layout: hides every one of the template's layers at once, leaving what the user
 * added; showing them again brings back the ones that were showing (one hidden before stays hidden).
 */
function toggleLayout() {
  const sys = layoutLayers(), mine = LAYOUT_HID && LAYOUT_HID.cover === S.cover ? LAYOUT_HID.ids : [];
  if (sys.every((l) => !l.visible)) {
    const back = mine.length ? mine : sys.map((l) => l.id);
    for (const l of sys) if (back.includes(l.id)) l.visible = true;
    LAYOUT_HID = null;
  } else {
    LAYOUT_HID = { cover: S.cover, ids: [...new Set([...mine, ...sys.filter((l) => l.visible).map((l) => l.id)])] };
    for (const l of sys) l.visible = false;
  }
  touch({ cover: true, side: true });
}
/** The canvas's FOCUS frame and tag: which layer the canvas is acting on. */
function syncFocus() {
  const stage = $("stage"), tag = $("focustag") || stage.appendChild(el("div", { id: "focustag" })), on = !!S.focus && S.mode === "edit" && !V3.on;   // a boolean: toggle(…, undefined) would flip it
  stage.classList.toggle("focus", on);
  tag.hidden = !on;
  if (!on) return;
  const many = group(), L = layer(), free = focusTargets().length > 0;
  tag.textContent = t(free ? "focus.tag" : "focus.tagFixed", many.length ? t("props.group", many.length) : L ? layerName(L) : "—");
  tag.classList.toggle("off", !free);
}
function renderSide() {
  if (!S.cover) return;
  if (layer() && (!appliesTo(layer(), cat().id) || layer().off)) S.layerId = "bg";   // the selected layer is not on this category's cover, or left out of it
  if (S.letterWin) lettersShow();   // the letter window follows its layer, or closes
  if (S.cropWin) cropShow();   // and the crop window
  if (S.weaveWin) weaveShow();   // and the weave window
  if (S.brushWin) brushShow();   // and the brush's panel
  const side = $("side"), y = side.scrollTop, L = layer(), here = S.cover.layers.filter((l) => appliesTo(l, cat().id) && !l.off);
  // keep typing in the text box alive across rebuilds
  const typing = document.activeElement && [side, layerBox, POP].some((b) => b.contains(document.activeElement)) && (document.activeElement.tagName === "TEXTAREA" || document.activeElement.classList.contains("rename"));
  if (typing) return;
  const i = L ? here.indexOf(L) : -1, many = group();
  const ib = (svg, title, off, onclick, on = false) => el("button", { class: "ib" + (on ? " on" : ""), title, disabled: off, innerHTML: svg, onclick });
  // the chips over the list (see LAYERS_UI): every layer, those the user added and the layout's own, each with how many
  const fk = LAYERS_UI.filter, listed = here.filter(LAYER_FILTERS[fk]);
  const chip = (k) => el("button", { class: "btn" + (fk === k ? " on" : ""), "aria-pressed": String(fk === k), title: k === "all" ? null : t(`layers.filter.${k}Tip`),
    onclick: () => { if (LAYERS_UI.filter !== k) { LAYERS_UI.filter = k; renderSide(); } } }, k === "all" ? t("layers.filter.all") : t("layers.filter." + k, here.filter(LAYER_FILTERS[k]).length));
  layerBox.replaceChildren(   // the list, in the Layers sheet, and under it the selected layer and what can be done to it
    el("div", {}, el("div", { class: "lhead" }, cap("layers.title"),
        el("div", { class: "lbtns" }, el("button", { class: "focusbtn v3btn" + (V3.to ? " on" : ""), title: t("v3.tip"), onclick: () => set3d(!V3.to), innerHTML: `${ICONS.stack}<span>${t("v3.label")}</span>` }),
          el("button", { class: "focusbtn" + (S.focus ? " on" : ""), title: t("focus.tip"), onclick: () => setFocus(!S.focus) }, t("focus.label")))),
      el("div", { class: "lfilter" }, el("div", { class: "seg" }, Object.keys(LAYER_FILTERS).map(chip)),
        fk !== "all" && el("div", { class: "hint" }, t(listed.length ? "layers.filter.reorder" : "layers.filter.none"))),
      el("div", { class: "layers" }, [...listed].reverse().map(layerRow)),
      el("div", { class: "selbar" },
        el("span", {}, many.length ? t("props.group", many.length) : L ? [t("layers.selected"), el("b", {}, layerName(L))] : t("layers.none")),
        ib(ICONS.dup, t("layers.dup"), !copiable(L) || many.length > 0, duplicateLayer),
        ib(ICONS.up, t("layers.up"), many.length > 0 || i < 1 || i >= here.length - 1, () => shiftLayer(1)),
        ib(ICONS.down, t("layers.down"), many.length > 0 || i <= 1, () => shiftLayer(-1)),
        ib(ICONS.trash, t("layers.del"), many.length ? !many.some(isAdded) : !(L && isRemovable(L)), () => (many.length ? removeGroup() : removeLayer())),
        ib(ICONS.props, t(S.settings.drawer ? "drawer.close" : "drawer.open"), false, () => setDrawer(!S.settings.drawer), S.settings.drawer))));
  // what is selected, in the drawer on the right (nothing is built while it is shut)
  side.replaceChildren(...(!S.settings.drawer ? [] : [
    el("div", { class: "dhead" }, el("div", {}, el("small", {}, t("drawer.title")), el("b", {}, many.length ? t("props.group", many.length) : L ? layerName(L) : "—")),
      el("button", { class: "x", title: t("drawer.close"), onclick: () => setDrawer(false) }, "✕")),
    many.length ? el("div", { class: "box" }, el("div", { class: "hint", style: "margin-top:0" }, many.map(layerName).join(" · ")),
      many.some((x) => x.locked) && el("div", { class: "hint" }, t("props.groupLocked")),
      el("div", { class: "hint" }, t("props.groupHint")),
      el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => focusAllows("bg") && selectLayer("bg") }, t("props.groupEnd")))
    : L ? [el("div", { class: "props" }, typeControls(L), sceneSection(L), lookFxSection(L), layerSection(L)),
        L.type !== "bg" && el("div", { class: "dfoot" },
          copiable(L) && el("button", { class: "linkbtn", onclick: duplicateLayer }, t("drawer.dup")),
          el("button", { class: "linkbtn", onclick: () => { L.visible = !L.visible; touch({ cover: true, side: true }); } }, t(L.visible ? "drawer.hide" : "drawer.show")))]
      : el("div", { class: "hint" }, t("layers.none"))]).flat().filter(Boolean));
  openSecs(side);
  side.scrollTop = y;
  // the selected layer's photo, in Assets → the cover's photos, is framed in the channel colour (without rebuilding that panel)
  for (const item of document.querySelectorAll("#panel .pitem")) item.classList.toggle("on", item.dataset.id === S.layerId);
  syncFocus(); markRows(); renderBar();
}
/** Opens or shuts the drawer of the selected layer's properties on the right (kept in the settings); shut, the canvas takes its column. */
function setDrawer(on) {
  const fromSheet = $("left").contains(document.activeElement), fromDrawer = $("right").contains(document.activeElement);
  S.settings.drawer = on; persistSettings();
  columns(); renderSide();
  // the button pressed gone, rebuilt with the sheet or with the drawer: to the drawer's ✕, or the sheet's own dock button
  const to = on && fromSheet ? $("side").querySelector(".dhead button") : !on && fromDrawer ? $("dock").querySelector("button.on") : null;
  if (to) to.focus({ preventScroll: true });
}

// ---------- the bar over the canvas
// The selected layer's most used settings on a bar of glass over it on the canvas: above it, clear of its turning
// handle; under it, or inside its top, where there is no room. Each is a button that opens a popover under the bar
// holding the same controls as its group in the drawer, or does what it says; More… opens the drawer. The popover
// can be moved out of the way of what it changes, by a drag on any part of it that is no control (see popGrabs). The
// bar goes while anything is dragged, in 3D, in Settings and with a group selected. A row of the layer list under the
// pointer is framed on the canvas (see hoverShow).
const BAR = el("div", { id: "ftb", class: "glass", hidden: true }), POP = el("div", { id: "fpop", class: "glass", hidden: true }), HOVER = el("div", { id: "hoverbox", hidden: true });
$("center").append(BAR, POP, HOVER);
// the item whose popover is open, the layer it is of, whether the canvas is being dragged, and where the popover was
// moved to while it is open ({key, x, y} in #center's pixels, or null: in its own place under the bar); `away`, while
// nothing is selected, the layer standing for nothing (the background: see selectNothing), its bar put away, else ""
const FTB = { pop: "", of: "", drag: false, at: null, away: "" };
// gone while the pointer is down on the canvas (a layer moved, turned or resized), back where it then is when it is let go
$("cv").addEventListener("pointerdown", () => { FTB.drag = true; placeBar(); }, true);
for (const type of ["pointerup", "pointercancel"]) addEventListener(type, () => { if (FTB.drag) { FTB.drag = false; placeBar(); } }, true);
/** What the effect a headline has is called (Auto when it has none of its own). */
const fxLabel = (L) => (EFFECTS[L.fx] && L.fx !== "auto" ? EFFECTS[L.fx].name[getLang()] : t("bar.fxAuto"));
/**
 * The bar's buttons for layer L: {key, label, title?, aa? (a font's mark before it), chip? (a colour before it), dot?
 * (the colours it is in, as a round button of its own, no label), icon? (a SHELL_ICONS key before it), sep? (a line
 * before it), on?, off?, and sec (the key of the group of properties the popover shows) or pop (the popover's controls)
 * or act (what a click does)}. A lettering's: its font | its colours, effect, bend, columns | More….
 */
function barItems(L) {
  const T = L.type, items = [], sec = (key, label, more = {}) => ({ key, sec: key, label, ...more });
  if (LETTERED.includes(T)) {
    items.push({ key: "font", aa: true, label: L.font || t("bar.fontAuto"), title: t("props.font"), pop: () => [fontControl(L, true)] });
    // what its words and (the title, subtitle and text) its highlighted words are in, as the Colour group's swatches show them
    const shown = inksShown(L), ink = L.ink || (L.color === "accent" ? cat().color : shown.ink);
    items.push(sec("props.sec.color", "", { title: t("bar.color"), sep: true, dot: HEADLINES.includes(T) ? [ink, L.hi || shown.hi] : [ink] }));
    if (HEADLINES.includes(T)) items.push(sec("props.sec.effect", t("bar.effect", fxLabel(L)), { icon: "wand" }), sec("props.bend", t("props.bend"), { off: inColumns(L) }));
    const byLook = columnsByLook(L);
    items.push({ key: "vertical", label: t("props.vertical"), title: t(byLook ? "props.verticalByLook" : "props.verticalTip", (LOOKS[S.profile.style.look] || LOOKS.cel).name[getLang()]), on: inColumns(L), off: byLook,
      act: () => { L.vertical = !L.vertical; touch({ cover: true, side: true }); } });
  }
  if (T === "photo") {
    if (canCut()) items.push({ key: "cut", label: t(CUT.busy ? "cut.busy" : L.cut ? "props.uncut" : "props.cut"), off: CUT.busy, act: () => cutPhoto(L, !L.cut) });
    items.push({ key: "crop", label: t(L.crop && canCrop(L) ? "crop.edit" : "crop.open"), off: !canCrop(L), title: t(L.fill && !L.of ? "crop.fillTip" : "crop.openTip"), act: () => cropOpen(L) });
    if (!L.of) items.push({ key: "repaint", label: t("rep.title"), off: !(recordOf(L) || {}).img || (REP.busy && REP.of !== L.id), act: () => repaintOpen(L) },
      { key: "replace", label: t("cover.replacePhoto"), off: REP.busy && REP.of === L.id, act: () => replacePhoto(L) });
  }
  if (T === "asset") {
    if (canTint(L.ref)) items.push(sec("props.sec.color", t("bar.color"), { chip: L.ink || null }));
    items.push({ key: "crop", label: t(L.crop && canCrop(L) ? "crop.edit" : "crop.open"), off: !canCrop(L), title: t("crop.openTip"), act: () => cropOpen(L) });
  }
  if (canWeave(L)) items.push(sec("props.sec.weave", t("props.sec.weave"), { on: !!L.weave }));
  if (T === "solid") items.push(sec("props.sec.color", t("bar.color"), { chip: L.color || cat().color }));
  if (T === "accent") items.push(sec("props.sec.shape", t("props.sec.shape")), sec("props.sec.block", t("props.sec.block")));
  if (T === "bg") items.push(sec("props.sec.ground", t("props.sec.ground")));
  items.push({ key: "more", label: t("bar.more"), title: t(S.settings.drawer ? "drawer.close" : "drawer.open"), on: S.settings.drawer, act: () => setDrawer(!S.settings.drawer) });
  return items;
}
/** Group `key` of layer L's properties, built afresh as the drawer has it (its controls and its tip), or null. */
function secOf(L, key) {
  const g = [typeControls(L)].flat(Infinity).find((n) => n && n.dataset && n.dataset.key === key);
  return g ? { kids: [...g.querySelector(".psec-b").childNodes], tip: (g.querySelector(".psec-h .info") || {}).title || "" } : null;
}
/** Builds the bar for the selected layer, and its popover if one is open (it shuts on another layer), then puts them in place. */
function renderBar() {
  endPreview("fx");   // the effect cards drawn anew (here and in the drawer), or gone
  const L = layer(), on = S.mode === "edit" && !!L && !group().length;
  if (FTB.away !== (L && L.id)) FTB.away = "";   // another layer selected, by whatever way: its bar shows
  if (!on || FTB.of !== (L && L.id)) FTB.pop = "";
  FTB.of = L ? L.id : "";
  const items = on ? barItems(L) : [];
  // the button whose popover is open a light pill (one set on, as Vertical, only lit); More… a segment of its own
  BAR.replaceChildren(...items.flatMap((it, i) => [(it.key === "more" || it.sep) && i > 0 && el("span", { class: "sep" }),
    el("button", { class: [FTB.pop === it.key ? "open" : it.on && "on", it.dot && "dotbtn", it.key === "more" && "more"].filter(Boolean).join(" "), title: it.title || null, "aria-label": it.dot ? it.title : null,
      "aria-expanded": it.act ? null : String(FTB.pop === it.key), disabled: !!it.off, dataset: { key: it.key },
      onclick: () => { if (it.act) { FTB.pop = ""; renderBar(); it.act(); } else { FTB.pop = FTB.pop === it.key ? "" : it.key; renderBar(); } } },
      it.aa && el("span", { class: "aa" }, "Aa"), it.icon && ico(it.icon, 16), it.chip && el("span", { class: "chip", style: `background:${it.chip}` }),
      it.dot ? el("span", { class: "dot", style: `background:${it.dot.length > 1 ? `linear-gradient(135deg, ${it.dot[0]} 50%, ${it.dot[1]} 50%)` : it.dot[0]}` }) : el("span", {}, it.label))]).filter(Boolean));
  const it = items.find((x) => x.key === FTB.pop && !x.act);
  const sec = it && it.sec && secOf(L, it.sec), kids = it ? (it.pop ? it.pop() : sec && sec.kids) : null;
  if (!kids) FTB.pop = "";
  if (FTB.at && FTB.at.key !== FTB.pop) FTB.at = null;   // shut, or another opened: in its own place again the next time
  POP.replaceChildren(...(kids ? [el("div", { class: "fpop-h" }, it.sec ? t(it.sec) : it.title || it.label, sec && sec.tip && info(sec.tip)), el("div", { class: "psec open" }, el("div", { class: "psec-b" }, kids))] : []));
  POP.classList.toggle("wide", !!kids && it.sec === "props.sec.effect");   // the effects' cards, a page of six in sight
  placeBar();
}
/** Where layer id is drawn on the canvas, in #center's pixels: {cx, cy, hw, hh, r} (its centre, half sizes, turn), or null when it is not drawn here. */
function onScreen(id) {
  const cv = $("cv"), L = layer(id), h = L && L.type === "bg" && cv._virtual ? { cx: cv._virtual[0] / 2, cy: cv._virtual[1] / 2, hw: cv._virtual[0] / 2, hh: cv._virtual[1] / 2, r: 0 } : cv._hits && cv._hits.find((x) => x.id === id);
  if (!h || !cv._virtual) return null;
  const r = cv.getBoundingClientRect(), c = $("center").getBoundingClientRect(), k = r.width / cv._virtual[0];
  return { cx: r.left - c.left + h.cx * k, cy: r.top - c.top + h.cy * k, hw: h.hw * k, hh: h.hh * k, r: h.r || 0, fill: !!h.fill };
}
/** Puts the bar over the selected layer and its popover under the bar; hides them while they would be in the way. */
function placeBar() {
  if (PREVIEW.fx && !BAR.hidden) return;   // an effect previewed from its card: the bar and its popover stay, or the card would move from under the pointer
  const L = layer(), box = S.mode === "edit" && L && L.id !== FTB.away && BAR.childElementCount && !V3.on && !FTB.drag && !S.brushWin && onScreen(L.id);
  BAR.hidden = !box; POP.hidden = !box || !POP.childElementCount;
  if (!box) return;
  const stage = $("stage"), top = stage.offsetTop, bottom = top + stage.offsetHeight, wide = $("center").clientWidth;
  const a = (box.r * Math.PI) / 180, ex = Math.abs(box.hw * Math.cos(a)) + Math.abs(box.hh * Math.sin(a)), ey = Math.abs(box.hw * Math.sin(a)) + Math.abs(box.hh * Math.cos(a));
  BAR.style.left = "0px";   // measured at the left, so its width is its own and not what room it had where it last stood (it wraps only in a canvas narrower than it)
  const turns = L.type !== "bg" && !FIXED.includes(L.type) && !box.fill, bw = BAR.offsetWidth, bh = BAR.offsetHeight;
  let y = box.cy - ey - (turns ? 54 : 12) - bh;   // above, clear of the turning handle
  if (y < top + 6) y = box.cy + ey + 14;   // under
  if (y + bh > bottom - 6) y = Math.max(top + 6, box.cy - ey + 8);   // inside its top
  const x = Math.max(6, Math.min(box.cx - bw / 2, wide - bw - 6));
  BAR.style.left = x + "px"; BAR.style.top = y + "px";
  if (POP.hidden) return;
  if (FTB.at) return popTo(FTB.at.x, FTB.at.y);   // where it was moved to, through every change made in it
  POP.style.maxHeight = "";
  const b = BAR.querySelector(`button[data-key="${CSS.escape(FTB.pop)}"]`), pw = POP.offsetWidth, ph = POP.offsetHeight;
  const px = Math.max(6, Math.min(x + (b ? b.offsetLeft : 0), wide - pw - 6)), under = y + bh + 8, below = under + ph <= bottom - 6 || y - ph - 8 < top;
  POP.style.left = px + "px"; POP.style.top = (below ? under : y - ph - 8) + "px";
  if (below && under + ph > $("center").clientHeight - 6) POP.style.maxHeight = Math.max(140, $("center").clientHeight - 6 - under) + "px";   // under, kept in the window (a tall one, the effects' cards, scrolls)
}
/** Frames layer id on the canvas while its row in the list is under the pointer. */
function hoverShow(id) {
  const box = S.mode === "edit" && !V3.on && onScreen(id);
  HOVER.hidden = !box;
  if (!box) return;
  Object.assign(HOVER.style, { left: box.cx - box.hw + "px", top: box.cy - box.hh + "px", width: box.hw * 2 + "px", height: box.hh * 2 + "px", transform: `rotate(${box.r}deg)` });
}
const hoverHide = () => { HOVER.hidden = true; };
// While the Layout sheet is shown, each layout part drawn on the canvas (but the ground) is framed with a dashed line
// and named as the layer list names it, so what each one takes is seen; the selected one keeps its own frame and
// handles. A press inside a frame takes that part, even one lying under another (see layerAt). Boxes laid over the
// stage, as the hover frame is, not drawn on the cover: put in place again after each drawing (flushDraw), so they
// follow a drag, the window resized and the size shown.
const FRAMES = el("div", { id: "partframes", hidden: true }), FRAMED = new Map();   // FRAMED: layer id -> its frame and its name's tag
$("center").append(FRAMES);
/** Whether the layout's parts are framed now: the Layout sheet shown (not hidden by the drawer in a narrow window), on the flat canvas. */
const partsFramed = () => S.mode === "edit" && S.tab.edit === "layout" && !sheetHidden() && !V3.on && !S.brushWin && !S.letterWin && !S.cropWin && !S.weaveWin && !!S.cover;
/** Whether hit h is of a part that is framed and taken by its frame: a layout layer of the cover's own but the ground, shown and not locked. */
const framable = (h) => { const L = layer(h.id); return !!L && h.type !== "bg" && isLayout(L) && isPickable(L); };
/** Frames the layout's parts on the stage (see partsFramed), each but those selected; with FOCUS, only those worked on. */
function placeFrames() {
  const cv = $("cv"), sel = new Set(pickedIds()), spot = S.focus ? spotIds() : null;
  const parts = partsFramed() && cv._hits && cv._virtual ? cv._hits.filter((h) => framable(h) && !sel.has(h.id) && (!spot || spot.includes(h.id))) : [];
  FRAMES.hidden = !parts.length;
  if (!parts.length) return;
  const stage = $("stage"), r = cv.getBoundingClientRect(), c = $("center").getBoundingClientRect(), k = r.width / cv._virtual[0], W = stage.offsetWidth;
  Object.assign(FRAMES.style, { left: stage.offsetLeft + "px", top: stage.offsetTop + "px", width: W + "px", height: stage.offsetHeight + "px" });
  const ox = r.left - c.left - stage.offsetLeft, oy = r.top - c.top - stage.offsetTop;
  const each = parts.map((h) => {
    if (!FRAMED.has(h.id)) FRAMED.set(h.id, { box: el("div", { class: "pframe" }), tag: el("span", { class: "ptag" }) });
    const f = FRAMED.get(h.id), name = layerName(layer(h.id)), x = ox + h.cx * k, y = oy + h.cy * k, hw = h.hw * k + 2, hh = h.hh * k + 2;
    if (f.tag.textContent !== name) f.tag.textContent = name;
    Object.assign(f.box.style, { left: x - hw + "px", top: y - hh + "px", width: hw * 2 + "px", height: hh * 2 + "px", transform: h.r ? `rotate(${h.r}deg)` : "" });
    const a = ((h.r || 0) * Math.PI) / 180;   // how far it reaches across and down, turned as it is
    return { f, x, y, ex: Math.abs(hw * Math.cos(a)) + Math.abs(hh * Math.sin(a)), ey: Math.abs(hw * Math.sin(a)) + Math.abs(hh * Math.cos(a)) };
  });
  const ids = parts.map((h) => h.id).join(" ");
  if (FRAMES.dataset.ids !== ids) { FRAMES.dataset.ids = ids; FRAMES.replaceChildren(...each.flatMap((p) => [p.f.box, p.f.tag])); }
  // each name beside its frame's top, on the right; on the left where the stage has no room for it there; else inside the frame's top
  for (const p of each) p.w = p.f.tag.offsetWidth;
  for (const { f, x, y, ex, ey, w } of each) {
    const right = x + ex + 6, left = x - ex - 6 - w, inside = right + w > W - 4 && left < 4;
    f.tag.style.left = (inside ? x - ex + 4 : right + w <= W - 4 ? right : left) + "px";
    f.tag.style.top = Math.max(2, y - ey + (inside ? 4 : 0)) + "px";
  }
}
addEventListener("pointerdown", (e) => {   // a click away from the bar and its popover shuts the popover
  if (!FTB.pop || BAR.contains(e.target) || POP.contains(e.target) || (e.target.closest && e.target.closest("#tip"))) return;
  FTB.pop = ""; renderBar();
}, true);
/**
 * Whether a press on the bar's popover moves it: one on a part of it that is no control — its head, its grip, the
 * room around its controls, their captions — and not inside a box that scrolls (the effects' cards) nor on its own
 * scrollbar. A press on a field, a list, a slider, a button, a card or anything else clicked is that control's own.
 */
function popGrabs(e) {
  const r = POP.getBoundingClientRect();
  if (e.clientX - r.left - POP.clientLeft >= POP.clientWidth || e.clientY - r.top - POP.clientTop >= POP.clientHeight) return false;   // its scrollbar
  for (let n = e.target; n && n !== POP; n = n.parentElement) {
    if (n.matches("input,select,textarea,button,a[href],[role],[tabindex],[contenteditable]") || (n.tagName === "LABEL" && n.control) || n.onclick || n.onpointerdown) return false;
    const c = getComputedStyle(n);
    if ((/auto|scroll/.test(c.overflowX) && n.scrollWidth > n.clientWidth) || (/auto|scroll/.test(c.overflowY) && n.scrollHeight > n.clientHeight)) return false;
  }
  return true;
}
/** Puts the bar's popover at x, y (in #center's pixels) where it was moved to, all of it kept inside the window, and remembers it there while it is open. */
function popTo(x, y) {
  const c = $("center").getBoundingClientRect();
  POP.style.maxHeight = "";   // all of it shown, though it was cut short under the bar
  x = clamp(x, 6 - c.left, innerWidth - c.left - POP.offsetWidth - 6); y = clamp(y, 6 - c.top, innerHeight - c.top - POP.offsetHeight - 6);
  POP.style.left = x + "px"; POP.style.top = y + "px";
  FTB.at = { key: FTB.pop, x, y };
}
// the popover dragged by the pointer, held by it (so not taken for a drag on the canvas, nor of the window)
POP.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !popGrabs(e)) return;
  e.preventDefault();
  const dx = POP.offsetLeft - e.clientX, dy = POP.offsetTop - e.clientY, end = () => { POP.onpointermove = POP.onpointerup = POP.onpointercancel = null; document.body.classList.remove("popdrag"); };
  POP.setPointerCapture(e.pointerId);
  document.body.classList.add("popdrag");   // no text selected meanwhile
  POP.onpointermove = (m) => popTo(dx + m.clientX, dy + m.clientY);
  POP.onpointerup = POP.onpointercancel = end;
});

// ---------- the layers in 3D
// The 3D button over the layer list takes the cover apart: each layer painted on its own (o.only in
// drawCover) is a sheet, and the sheets are stacked bottom to top and seen at an angle (stack3d.js), so
// someone new to layers can see what each holds and which lies over which. It opens out of the flat
// cover and folds back into it. A drag turns the view, the wheel spreads the sheets, a click selects a
// layer (its settings show as ever), a double-click selects it and goes back to the flat canvas. Changes
// made in the panel show at once; a sheet moved in the list slides to its new place.
const OPEN_MS = 420, MASK_PX = 160;
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const here3d = () => S.cover.layers.filter((l) => appliesTo(l, cat().id) && !l.off && inSize(l, S.sel));   // what the cover at this size has (see `sizes` in layers.js)
/** Opens the 3D view out of the cover, or folds it back. */
function set3d(on) {
  if (on) brushClose();   // the brush paints on the flat canvas (and its opening closes this)
  if (on && !V3.on) {
    stage3d();
    Object.assign(V3, { on: true, stale: true, s: 0, aim: null });
    V3.z.clear();
    $("stage").classList.add("v3");
    sync3dHud();
  }
  if (!V3.on) return;
  Object.assign(V3, { from: V3.k, to: on ? 1 : 0, t0: performance.now(), hover: "", peek: "", drag: false });
  $("stage").classList.toggle("v3open", on);
  renderSide(); queueDraw(false); tick3d();
}
/** Takes the 3D view away at once (and the memory its sheets held); the canvas is painted first, so nothing flashes. */
function close3d() {
  Object.assign(V3, { on: false, k: 0, from: 0, to: 0, hover: "", peek: "", drag: false });
  V3.sheets.clear(); V3.z.clear(); V3.shown = []; V3.view = null;
  if (S.mode === "edit") drawMain();
  $("stage").classList.remove("v3", "v3open");
  markRows(); syncFocus(); placeBar(); placeFrames();
}
/** The 3D view's canvas and its bar of controls, put in the stage once. */
function stage3d() {
  if ($("cv3d")) return;
  const c = el("canvas", { id: "cv3d" }), stage = $("stage");
  stage.append(c, el("div", { id: "v3hud" }));
  const point = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const under = (e) => (V3.view && V3.k > 0.99 ? sheetUnder(V3.view, V3.shown, ...point(e), solid) : null);
  const hover = (e) => {
    const sh = e && !V3.drag ? under(e) : null, id = sh ? sh.id : "";
    c.style.cursor = V3.drag ? "grabbing" : id ? "pointer" : "grab";
    if (id !== V3.hover) { V3.hover = id; markRows(); tick3d(); }
  };
  c.addEventListener("pointermove", (e) => { if (!e.buttons) hover(e); });
  c.addEventListener("pointerleave", () => { if (!V3.drag) hover(null); });
  c.addEventListener("pointerdown", (e) => {
    if (V3.to !== 1 || e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, yaw0 = V3.yaw, pitch0 = V3.pitch;
    let moved = false;
    c.setPointerCapture(e.pointerId);
    c.onpointermove = (m) => {   // a drag turns the stack: across spins it, up and down tips it
      if (!moved && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return;
      if (!moved) { moved = true; V3.drag = true; V3.aim = null; hover(m); }
      V3.yaw = clamp(yaw0 - (m.clientX - x0) * 0.3, ...LIMITS.yaw);
      V3.pitch = clamp(pitch0 - (m.clientY - y0) * 0.3, ...LIMITS.pitch);
      tick3d();
    };
    c.onpointerup = c.onpointercancel = (u) => {
      c.onpointermove = c.onpointerup = c.onpointercancel = null; V3.drag = false;
      if (!moved) { const sh = under(u); if (sh) goToLayer(sh.id); }
      hover(u); tick3d();
    };
  });
  c.addEventListener("dblclick", (e) => { const sh = under(e); if (sh && goToLayer(sh.id)) set3d(false); });
  c.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (V3.to !== 1) return;
    V3.aim = null;
    V3.spread = clamp(V3.spread * Math.exp(-e.deltaY * 0.002), ...LIMITS.spread);
    const r = $("v3hud").querySelector("input");
    if (r) r.value = V3.spread;
    tick3d();
  }, { passive: false });
  // the list and the stack point at each other: the pointer on a row lights its sheet and dims the rest
  layerBox.addEventListener("pointermove", (e) => { if (V3.on) peek3d((e.target.closest && e.target.closest(".layers .layer") || {}).dataset?.id || ""); });
  layerBox.addEventListener("pointerleave", () => peek3d(""));
}
function sync3dHud() {
  $("v3hud").replaceChildren(
    el("b", {}, t("v3.label")),
    el("span", { class: "v3tip", title: t("v3.tip") }, t("v3.hint")),
    el("label", { class: "v3sl" }, t("v3.spread"), el("input", { type: "range", min: LIMITS.spread[0], max: LIMITS.spread[1], step: 0.05, value: V3.spread,
      oninput: (e) => { V3.aim = null; V3.spread = Number(e.target.value); tick3d(); } })),
    el("button", { class: "focusbtn", onclick: () => { V3.aim = { ...VIEW }; tick3d(); } }, t("v3.reset")),
    el("button", { class: "focusbtn on", onclick: () => set3d(false) }, t("v3.exit"), el("kbd", {}, "Esc")));
}
function peek3d(id) { if (V3.on && V3.peek !== id) { V3.peek = id; tick3d(); } }
/** The row of the sheet under the pointer is marked in the list. */
function markRows() {
  for (const row of layerBox.querySelectorAll(".layers .layer")) row.classList.toggle("peek", V3.on && row.dataset.id === V3.hover);
}
/** Whether the layer of sheet `sh` has anything at (fx, fy) across the cover: its painted alpha, a cell either way of it. */
function solid(sh, fx, fy) {
  const m = (V3.sheets.get(sh.id) || {}).mask;
  if (!m) return false;
  const x = Math.floor(fx * m.w), y = Math.floor(fy * m.h);
  for (let j = Math.max(0, y - 1); j <= Math.min(m.h - 1, y + 1); j++) for (let i = Math.max(0, x - 1); i <= Math.min(m.w - 1, x + 1); i++) if (m.a[j * m.w + i] > 12) return true;
  return false;
}
let maskCanvas = null;
/** A small copy of a sheet's alpha, read back once when it is painted, so finding what is under the pointer reads no pixels. */
function maskOf(cv) {
  const k = Math.min(1, MASK_PX / Math.max(cv.width, cv.height)), w = Math.max(1, Math.round(cv.width * k)), h = Math.max(1, Math.round(cv.height * k));
  if (!maskCanvas) { maskCanvas = document.createElement("canvas"); maskCanvas.getContext("2d", { willReadFrequently: true }); }
  maskCanvas.width = w; maskCanvas.height = h;
  const x = maskCanvas.getContext("2d");
  x.drawImage(cv, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  return { w, h, a };
}
/**
 * drawMain() while the 3D view is up: paints again the layers that changed, each on its own — while one
 * is being changed (see holdLive) just it, and what is clipped with it — then draws the stack.
 */
function paint3d() {
  const c = $("cv3d"), stage = $("stage"), dpr = window.devicePixelRatio || 1, W = stage.clientWidth, H = stage.clientHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const size = selSize(), [vw, vh] = virtualSize(size.w, size.h), list = here3d();
  // a sheet is seen smaller than the canvas: about this many pixels across is plenty
  const pw = Math.round(Math.min(vw * 1.5, (Math.max(W, H) * 0.6 * (drafting() ? 1 : Math.min(2, dpr)) * vw) / Math.max(vw, vh)));
  const key = `${pw}|${sizeKey(size)}|${catIndex()}`;
  for (const id of V3.sheets.keys()) if (!list.some((l) => l.id === id)) V3.sheets.delete(id);
  if (V3.stale) {
    let only = null;
    if (LIVE) {   // the layers being changed, and every layer clipped together with one of them
      only = new Set();
      for (const id of LIVE.ids) {
        const i = S.cover.layers.findIndex((l) => l.id === id);
        if (i < 0) continue;
        const b = clipBase(S.cover.layers, i), from = b >= 0 ? b : i;   // its group: the base it is clipped onto, or itself, and what is clipped onto that
        only.add(id);
        for (let j = from; j <= clipEnd(S.cover.layers, from); j++) only.add(S.cover.layers[j].id);
      }
    }
    for (const L of list) {
      const sh = V3.sheets.get(L.id) || { cv: document.createElement("canvas") };
      if (only && !only.has(L.id) && sh.key === key) continue;
      drawCover(sh.cv, { profile: S.profile, catIndex: catIndex(), size, pixelW: pw, cover: S.cover, photos: S.photos, only: S.cover.layers.indexOf(L) });
      sh.mask = maskOf(sh.cv); sh.key = key;
      V3.sheets.set(L.id, sh);
    }
    V3.stale = false;
  }
  draw3d();
}
/** Draws the stack as it stands now; true while something is still easing and wants another frame. */
function draw3d() {
  const c = $("cv3d");
  if (!V3.on || !c || !S.cover) return false;
  const now = performance.now(), p = Math.min(1, (now - V3.t0) / OPEN_MS), opening = p < 1;
  V3.k = V3.from + (V3.to - V3.from) * ease(p);
  if (!opening && V3.to === 0) { close3d(); return false; }
  let more = opening;
  if (V3.aim) {   // Reset view: back to where it opened
    for (const q of ["yaw", "pitch", "spread"]) V3[q] += (V3.aim[q] - V3[q]) * 0.2;
    if (["yaw", "pitch", "spread"].every((q) => Math.abs(V3.aim[q] - V3[q]) < 0.01)) { Object.assign(V3, V3.aim); V3.aim = null; }
    else more = true;
    const r = $("v3hud").querySelector("input");
    if (r) r.value = V3.spread;
  }
  const stage = $("stage"), W = stage.clientWidth, H = stage.clientHeight, dpr = window.devicePixelRatio || 1, ctx = c.getContext("2d");
  const size = selSize(), [vw, vh] = virtualSize(size.w, size.h), list = here3d(), k = V3.k, deco = k * k;
  // each sheet's place eases towards where the layer is now, so one moved in the list is seen to move
  list.forEach((L, i) => {
    const z = V3.z.has(L.id) ? V3.z.get(L.id) : i, to = Math.abs(i - z) < 0.01 ? i : z + (i - z) * 0.22;
    V3.z.set(L.id, to);
    if (to !== i) more = true;
  });
  for (const id of V3.z.keys()) if (!list.some((l) => l.id === id)) V3.z.delete(id);
  const gap = gapFor(list.length, vh, V3.spread) * k, picked = group().length ? group().map((L) => L.id) : [S.layerId];
  // a layer is not seen when it is hidden, or clipped onto a base that is (see paintRange in render.js)
  const baseOf = (L) => S.cover.layers[clipBase(S.cover.layers, S.cover.layers.indexOf(L))] || null;
  const seen = (L) => L.visible && !(baseOf(L) && !baseOf(L).visible);
  const label = (L) => layerName(L) + (!L.visible ? t("v3.hidden") : seen(L) ? "" : t("v3.baseHidden"));
  const room = labelRoom(ctx, list.map(label)) * k, T = turn(V3.yaw * k, V3.pitch * k);
  // flat (k = 0), the box is the canvas's own place in the stage, so the stack opens out of the cover and folds back into it
  const V = fitView(T, vw, vh, 0, Math.max(0, list.length - 1) * gap, { x: 18, y: 18, w: Math.max(40, W - 36 - room), h: Math.max(40, H - 36 - 56 * k) });
  if (!V3.s || opening) V3.s = V.s;
  else if (V3.drag) V3.s = Math.min(V3.s, V.s);   // held while turned, so what is under the pointer stays under it
  else if (Math.abs(V.s - V3.s) > V.s * 0.002) { V3.s += (V.s - V3.s) * 0.25; more = true; }
  else V3.s = V.s;
  V.s = V3.s;
  V3.view = V;
  V3.shown = list.map((L) => {
    const sh = V3.sheets.get(L.id);
    return { id: L.id, img: sh && sh.cv, z: V3.z.get(L.id) * gap, alpha: seen(L) ? 1 : 0.35 * deco, hidden: !seen(L), label: label(L),
      dim: !!V3.peek && V3.peek !== L.id, mark: picked.includes(L.id) ? "sel" : L.id === V3.hover || L.id === V3.peek ? "hover" : "" };
  });
  drawStack(ctx, { dpr, W, H: H - 56 * k, V, sheets: V3.shown, deco, acc: cat().color, room });   // the labels clear of the bar at the foot
  return more;
}
/** Draws the stack on the next frame, and on until it settles. */
function tick3d() {
  if (V3.raf || !V3.on) return;
  V3.raf = requestAnimationFrame(() => { V3.raf = 0; if (draw3d()) tick3d(); });
}

// ---------- export
function renderFull(size, cover, index) {
  const cv = document.createElement("canvas");
  paint(cv, size, size.w * S.settings.scale, cover, index);
  return cv;
}
/**
 * renderFull() for an export: effects that reshape letters need the letters' outlines, which are
 * fetched in the background. If drawing the cover asked for any, wait for them and draw it again.
 */
async function renderReady(size, cover, index) {
  await ensureFonts(cover.layers);
  let cv = renderFull(size, cover, index);
  for (let round = 0; round < 3 && outlinesPending(); round++) { await outlinesSettled(); cv = renderFull(size, cover, index); }
  return cv;
}
const nameFor = (size, cover, index) => exportName(S.settings.nameTemplate, { index, cat: S.profile.categories[index], title: cover.title, size, scale: S.settings.scale, ext: EXT[S.settings.format] });
/** PNG bytes of a canvas. Encoding is asynchronous, so the window keeps responding meanwhile. */
const toPng = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("could not encode the image"))), "image/png"));
/** Body of a binary export call: [u32 LE length][JSON metadata][PNG bytes] (see parse_frame in lib.rs). */
function framed(png, extra) {
  const meta = new TextEncoder().encode(JSON.stringify({ dir: "", ...extra, format: S.settings.format, quality: S.settings.quality }));
  const out = new Uint8Array(4 + meta.length + png.length);
  new DataView(out.buffer).setUint32(0, meta.length, true);
  out.set(meta, 4); out.set(png, 4 + meta.length);
  return out;
}
/** Resolves once the browser has had a chance to paint (or shortly after, when the window is hidden). */
const nextPaint = () => new Promise((r) => { requestAnimationFrame(() => setTimeout(r, 0)); setTimeout(r, 80); });
function browserSave(name, href) { const a = el("a", { href, download: name }); document.body.append(a); a.click(); a.remove(); }
function browserSaveCanvas(cv, name) {   // plain-browser fallback: the browser encodes; a dark matte under JPEG
  const { format, quality } = S.settings;
  let src = cv;
  if (format === "jpeg") { src = el("canvas", { width: cv.width, height: cv.height }); const x = src.getContext("2d"); x.fillStyle = "#0a0a12"; x.fillRect(0, 0, src.width, src.height); x.drawImage(cv, 0, 0); }
  return new Promise((res) => src.toBlob((b) => { const url = URL.createObjectURL(b); browserSave(name, url); setTimeout(() => URL.revokeObjectURL(url), 4000); res(); }, "image/" + format, quality / 100));
}

/** Modal progress for exports: a bar, a counter, the current file and a cancel button. */
function progress(total) {
  const m = $("modal"), bar = el("div", { class: "bar" }, el("i")), count = el("div", { class: "count" }), file = el("div", { class: "hint", style: "margin:0;min-height:1.7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" });
  const state = { cancelled: false };
  const cancel = el("button", { class: "btn wide", onclick: () => { state.cancelled = true; cancel.disabled = true; } }, t("exp.cancel"));
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("exp.dialog")), count, bar, file, total > 1 && cancel));
  m.dataset.sticky = "1";   // under way: only its own cancel stops it
  m.hidden = false;
  state.set = (done, name) => { count.textContent = t("msg.batch", Math.min(done + 1, total), total); bar.firstChild.style.width = (done / total) * 100 + "%"; if (name) file.textContent = name; };
  state.close = closeModal;
  state.set(0, "");
  return state;
}
/**
 * Exports jobs ([{cover, index, size}]) one after another without freezing the window: each cover is
 * drawn, encoded to PNG off the main thread and handed to Rust as raw bytes, where it is converted
 * and written on a worker thread (up to two at a time) while the next cover is already being drawn.
 * save(bytes, name) does the writing; returns how many were written, or -1 when one could not be, which onFail (a
 * toast, unless told) is told.
 */
async function runExport(jobs, save, onFail = fail) {
  const prog = progress(jobs.length), pending = new Set(), used = new Set();
  // a name already given in this export (a pattern without the size, or the channel, say) gets the size (as w×h), then a
  // number; told apart as the disk tells them, regardless of case (one file on APFS and NTFS)
  const key = (n) => n.normalize("NFC").toLowerCase();
  const apart = (name, z) => {
    const dot = name.lastIndexOf("."), ext = dot > 0 ? name.slice(dot) : "", wh = `${z.w}x${z.h}`;
    const base = (dot > 0 ? name.slice(0, dot) : name) + (name.includes(wh) ? "" : `_${wh}`);
    let out = name, n = 2;
    if (used.has(key(out))) out = base + ext;
    while (used.has(key(out))) out = `${base}-${n++}${ext}`;
    used.add(key(out)); return out;
  };
  let done = 0, failed = null;
  try {
    for (const job of jobs) {
      if (prog.cancelled || failed) break;
      const name = apart(nameFor(job.size, job.cover, job.index), job.size);
      prog.set(done, name);
      await nextPaint();
      const cv = await renderReady(job.size, job.cover, job.index);
      const task = (CAN.saveFiles ? toPng(cv).then((bytes) => { cv.width = cv.height = 0; return save(bytes, name); }) : browserSaveCanvas(cv, name))
        .then(() => { done++; prog.set(done); }, (e) => { failed = failed || e; })
        .finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= 2) await Promise.race(pending);
    }
    await Promise.all(pending);
  } finally { prog.close(); }
  if (failed) { onFail(failed); return -1; }
  if (prog.cancelled) toast(t("msg.cancelled", done, jobs.length));
  return done;
}
/** The folder the profile's exports are written into (settings.exportDirs); "" while none is kept, or where the host writes no files. */
const exportDir = () => (CAN.saveFiles && S.settings.exportDirs[S.profile.id]) || "";
const keepExportDir = (dir) => { S.settings.exportDirs[S.profile.id] = dir; persistSettings(); };
/** A folder as it is shown: the home folder as ~. */
const shortDir = (dir) => dir.replace(/^(\/Users\/(?!Shared(?:\/|$))[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\(?!Public(?:\\|$))[^\\]+)(?=[\\/]|$)/, "~");
/** Asks for the folder to export into and keeps it for the profile; resolves with it, or null when none was chosen. */
async function pickExportDir() {
  try { const dir = await invoke("pick_folder"); if (dir) keepExportDir(dir); return dir || null; } catch (e) { fail(e); return null; }
}
/** Writing into `dir` failed (it is gone, its disk away, or it cannot be written into): says so and asks for another; resolves with it, or null. */
function askOtherDir(dir, err) {
  return new Promise((done) => {
    const m = $("modal"), pick = (again) => async () => { closeModal(); done(again ? await pickExportDir() : null); };
    m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("exp.dirFailTitle")),
      el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("exp.dirFailBody", shortDir(dir), err && err.message ? err.message : String(err))),
      el("button", { class: "btn solid wide", onclick: pick(true) }, t("exp.dirOther")),
      el("button", { class: "btn wide", onclick: pick(false) }, t("exp.cancel"))));
    m.onDismiss = pick(false);   // a click outside is its cancel
    m.hidden = false;
  });
}
/**
 * Writes jobs into the profile's export folder, asking for one when none is kept yet; where writing there fails, says
 * so and asks for another, and writes them all there. Resolves with how many were written, where, and the last file's
 * path ({n, dir, last}), or null when no folder was chosen.
 */
async function writeJobs(jobs) {
  let dir = exportDir() || (await pickExportDir());
  while (dir) {
    let err = null, last = "";
    const n = await runExport(jobs, async (bytes, name) => { last = await invoke("write_image", framed(bytes, { dir, name })); }, (e) => { err = e; });
    if (!err) return { n, dir, last };
    if (/encode|invalid file name|expected a binary body/i.test(String((err && err.message) || err))) { fail(err); return null; }   // a picture not encoded, a name the system refuses: not the folder's fault
    dir = await askOtherDir(dir, err);
  }
  return null;
}
/** One size of this channel's cover: into the profile's folder; with none kept yet, where the user says, and its folder kept. */
async function exportOne(size) {
  const job = { cover: S.cover, index: catIndex(), size };
  if (!CAN.saveFiles) return void (await runExport([job]));
  if (exportDir()) { const r = await writeJobs([job]); if (r && r.n === 1) toast(t("msg.saved", r.last)); return; }
  let saved = null;
  const n = await runExport([job], async (bytes, name) => { saved = await invoke("save_image", framed(bytes, { name })); });
  if (n !== 1 || !saved) return;
  toast(t("msg.saved", saved));
  const dir = saved.replace(/[\\/][^\\/]*$/, "");
  if (dir && dir !== saved) keepExportDir(dir);
}
/** Writes every cover ([{cover, index}]) at each of `sizes` (the profile's, unless told) into the profile's folder (writeJobs), or downloads them. */
async function exportMany(covers, sizes = S.profile.sizes) {
  const jobs = covers.flatMap((c) => sizes.map((size) => ({ ...c, size })));
  if (!CAN.saveFiles) { const n = await runExport(jobs); if (n === jobs.length) toast(counted("msg.savedN", n, t("msg.downloads"))); return; }
  const r = await writeJobs(jobs);
  if (r && r.n === jobs.length) toast(counted("msg.savedN", r.n, r.dir));
}
/** Where exports go, in the Export window and Settings: the profile's folder (all of it on hover) and the way to change it; nothing where the host writes no files (they download). */
function saveToRow() {
  if (!CAN.saveFiles) return null;
  const row = el("div", { class: "xdir" });
  const fill = () => {
    const dir = exportDir();
    row.replaceChildren(el("span", {}, t("exp.saveTo")), el("b", { class: dir ? "" : "none", title: dir }, dir ? shortDir(dir) : t("exp.dirNone")),
      el("button", { class: "linkbtn", onclick: async () => { if (await pickExportDir()) fill(); } }, t(dir ? "exp.dirChange" : "exp.dirPick")));
  };
  fill();
  return row;
}
/** The tokens a file name pattern may hold (see exportName in store.js), as ＋ offers them; {category} is {channel}'s older name. */
const NAME_TOKENS = ["channel", "n", "code", "title", "size", "w", "h"];
const NAME_TOKEN = /\{(n|channel|category|code|title|size|w|h)\}/g;
const NAME_UI = { text: false };   // whether the file name pattern is edited as text rather than as tags
/**
 * The file name pattern (settings.nameTemplate) as tags, in the Export window and Settings → Sizes & export: each token a
 * chip with its name in the interface's language and × to take it out; the text between them typed where it stands, each
 * stretch an input as wide as what it holds, so the box reads as one line (Backspace at a stretch's start takes out the
 * token before it, Delete at its end the one after, the arrows step over a chip); ＋ to add a token where the caret last
 * was, else at the end; and in grey what exportName adds after it (the resolution, the extension). For those who would
 * rather type, the pattern as text (NAME_UI.text). The pattern stays the string it was, a token as it was written; a
 * token typed in full becomes a chip. `example` is told the name the pattern now makes.
 */
function nameField(example) {
  const se = S.settings, wrap = el("div", { class: "nfield" });
  let at = -1;   // where in the pattern ＋ adds a token: the caret's last place in a stretch of text
  const save = (v) => { se.nameTemplate = v; persistSettings(); example.textContent = t("exp.example", nameFor(selSize(), S.cover, catIndex())); };
  const build = (focus = -1) => {
    const cap = el("div", { class: "cap ncap" }, t("exp.name"), info(t("exp.nameHint")),
      el("button", { class: "linkbtn", onclick: () => { NAME_UI.text = !NAME_UI.text; build(NAME_UI.text ? 0 : se.nameTemplate.length); } }, t(NAME_UI.text ? "exp.asTags" : "exp.asText")));
    if (NAME_UI.text) {
      const inp = textInput(se.nameTemplate, save);
      wrap.replaceChildren(cap, inp);
      if (focus >= 0) inp.focus();
      return;
    }
    const s = se.nameTemplate, texts = [], toks = [], starts = [];   // the stretches of text, the tokens between them, where each stretch starts
    let from = 0;
    for (const m of s.matchAll(NAME_TOKEN)) { starts.push(from); texts.push(s.slice(from, m.index)); toks.push({ k: m[1] === "category" ? "channel" : m[1], raw: m[0] }); from = m.index + m[0].length; }
    starts.push(from); texts.push(s.slice(from));
    const redo = (v, caret) => { save(v); build(caret); };
    const slot = (i) => {
      const mirror = el("span", {}, texts[i]), inp = el("input", { type: "text", size: 1, value: texts[i], spellcheck: false, "aria-label": t("exp.nameText") });   // as narrow as can be: its copy, mirror, gives it its width
      const caret = () => starts[i] + inp.selectionStart;
      const mark = () => { at = caret(); };
      inp.addEventListener("input", () => {
        mirror.textContent = inp.value;
        const now = se.nameTemplate, v = now.slice(0, starts[i]) + inp.value + now.slice(starts[i] + texts[i].length);
        if (inp.value.search(NAME_TOKEN) >= 0) return redo(v, caret());   // a token typed out: its chip
        texts[i] = inp.value; save(v); at = caret();
        for (let j = i + 1; j < starts.length; j++) starts[j] = starts[j - 1] + texts[j - 1].length + toks[j - 1].raw.length;
      });
      inp.addEventListener("keyup", mark); inp.addEventListener("click", mark); inp.addEventListener("focus", mark);
      inp.addEventListener("keydown", (e) => {
        const c = inp.selectionStart, none = c === inp.selectionEnd, end = inp.value.length;
        const v = se.nameTemplate, step = (j, to) => { const x = slots[j]; x.focus(); const p = to < 0 ? x.value.length : to; x.setSelectionRange(p, p); };
        if (e.key === "Backspace" && none && c === 0 && i > 0) { e.preventDefault(); const a = starts[i] - toks[i - 1].raw.length; redo(v.slice(0, a) + v.slice(starts[i]), a); }
        else if (e.key === "Delete" && none && c === end && i < toks.length) { e.preventDefault(); const a = starts[i] + end; redo(v.slice(0, a) + v.slice(a + toks[i].raw.length), a); }
        else if (e.key === "ArrowLeft" && none && c === 0 && i > 0) { e.preventDefault(); step(i - 1, -1); }
        else if (e.key === "ArrowRight" && none && c === end && i < toks.length) { e.preventDefault(); step(i + 1, 0); }
      });
      return { inp, el: el("span", { class: "nslot" }, mirror, inp) };
    };
    const made = texts.map((_, i) => slot(i)), slots = made.map((x) => x.inp);
    const chip = (tk, i) => el("span", { class: "ntok", title: tk.raw }, t("exp.tok." + tk.k),
      el("button", { class: "nx", title: t("exp.tokOut", t("exp.tok." + tk.k)), "aria-label": t("exp.tokOut", t("exp.tok." + tk.k)),
        onclick: () => { const v = se.nameTemplate, a = starts[i] + texts[i].length; redo(v.slice(0, a) + v.slice(a + tk.raw.length), a); } }, "×"));
    const plus = el("label", { class: "nplus", title: t("exp.tokAdd") }, "＋",
      el("select", { "aria-label": t("exp.tokAdd"), onchange: (e) => { const v = se.nameTemplate, a = at >= 0 && at <= v.length ? at : v.length, raw = `{${e.target.value}}`; redo(v.slice(0, a) + raw + v.slice(a), a + raw.length); } },
        el("option", { value: "", selected: true, disabled: true, hidden: true }, "＋"),
        NAME_TOKENS.map((k) => el("option", { value: k }, `${t("exp.tok." + k)}　{${k}}`))));
    const box = el("div", { class: "nbox", onclick: (e) => { if (e.target === box) step0(); } },
      made.map((x, i) => [x.el, toks[i] && chip(toks[i], i)]),
      el("span", { class: "ntail" }, (se.scale > 1 ? "@" + se.scale + "x" : "") + "." + EXT[se.format]), plus);
    const step0 = () => { const x = slots[slots.length - 1]; x.focus(); x.setSelectionRange(x.value.length, x.value.length); };
    wrap.replaceChildren(cap, box);
    if (focus < 0) return;
    let i = 0;
    while (i < starts.length - 1 && focus > starts[i] + texts[i].length) i++;
    const c = Math.max(0, Math.min(texts[i].length, focus - starts[i]));
    slots[i].focus(); slots[i].setSelectionRange(c, c); at = starts[i] + c;
  };
  build();
  return wrap;
}
async function batchFromCsv() {
  const f = await pickFile(".csv,.tsv,.txt,text/csv");
  if (!f) return;
  const rows = csvToJobs(await readAs(f, "readAsText"));
  if (!rows.length) return toast(t("msg.batchEmpty"));
  const norm = (s) => String(s).trim().toLowerCase();
  let unknown = 0;
  const jobs = rows.map((r) => {
    const key = norm(r.category);
    let index = S.profile.categories.findIndex((c, i) => key && (norm(c.name) === key || norm(c.code) === key || String(i + 1) === key || String(i + 1).padStart(2, "0") === key));
    if (index < 0) { index = catIndex(); if (key) unknown++; }
    return { index, cover: { ...coverFor(S.profile.categories[index].id), title: r.title, tag: r.tag, subtitle: r.subtitle } };   // that channel's own cover, with the row's words (no subtitle but the row's own)
  });
  for (const j of jobs) await loadPhotos(pidsOf(j.cover));
  await exportMany(jobs);
  if (unknown) setTimeout(() => toast(counted("msg.batchUnknown", unknown)), 3600);
}
function csvTemplate() {
  const zh = getLang() === "zh", c = S.profile.categories;
  const lines = [zh ? "频道,标题,角标,副标题" : "channel,title,tag,subtitle", `${c[0].name},"${zh ? "第一行\\n*第二行*" : "First line\\n*second line*"}",EP.01,${zh ? "一句话补充标题" : "A line to go with it"}`, `${(c[1] || c[0]).name},${zh ? "另一个标题" : "Another title"},,`];
  saveText("smedcover-batch.csv", "\uFEFF" + lines.join("\n") + "\n");
}
async function saveText(name, text) {
  if (!CAN.saveFiles) return browserSave(name, "data:text/plain;charset=utf-8," + encodeURIComponent(text));
  try { const p = await invoke("save_text", { name, text }); if (p) toast(t("msg.saved", p)); } catch (e) { fail(e); }
}
function closeModal() { const m = $("modal"); m.hidden = true; m.replaceChildren(); m.onDismiss = null; delete m.dataset.sticky; LAYED.redraw = null; }
// A click on the dimmed page round a dialog dismisses it, as its cancel would (m.onDismiss, when a dialog
// waits on an answer; else just closing it) — a press that began inside the dialog and ended outside does
// not. A dialog that must be answered (the first-run welcome) or is under way (an export's progress) is
// sticky and stays.
{
  const m = $("modal");
  let fromBackdrop = false;
  m.addEventListener("pointerdown", (e) => { fromBackdrop = e.target === m; });
  m.addEventListener("click", (e) => { if (fromBackdrop && e.target === m && !m.dataset.sticky) (m.onDismiss || closeModal)(); });
}
/** Whether the Export window ticks size z (settings.exportSizes keeps, by profile, the sizes left unticked: one not named is ticked). */
const ticked = (z) => (S.settings.exportSizes[S.profile.id] || {})[sizeKey(z)] !== false;
/** Ticks the profile's sizes keyed `keys` in the Export window and unticks the others (a size the profile no longer has is let go). */
function setTicked(keys) {
  const off = sizeKeys().filter((k) => !keys.includes(k)), all = S.settings.exportSizes;
  if (off.length) all[S.profile.id] = Object.fromEntries(off.map((k) => [k, false])); else delete all[S.profile.id];
  persistSettings();
}
/** The Export window's main button: this channel's cover at the sizes ticked, into one folder. */
let exportingTicked = false;   // an export of the ticked sizes under way: a second press (a double-click, ⌘E again) waits for it
function exportTicked() {
  const sizes = S.profile.sizes.filter(ticked);
  if (!sizes.length || exportingTicked) return;
  exportingTicked = true;
  exportMany([{ cover: S.cover, index: catIndex() }], sizes).finally(() => { exportingTicked = false; });
}
/**
 * Export: this channel's cover at every size of the profile, each a row with a tick (whether the main button exports
 * it), its picture (the tray's), what it is called and its pixels, and Export for it alone; over them how many are
 * ticked and the quick choices (every size, the wide ones only, the tall ones only — the square ones go with the tall,
 * as the layout that stacks the tall and the square has them); the format, the resolution and the file names (the
 * same settings as Settings → Sizes & export), an example of the name; then the folder they go into, Only this size,
 * and the sizes ticked (⌘E, Ctrl+E off the Mac, here as in the editor). A tick changed is shown where it is, not by
 * building the window again, so the keyboard keeps its place.
 */
function exportDialog() {
  const m = $("modal"), se = S.settings, sizes = S.profile.sizes, c = cat();
  const set = (k, v) => { se[k] = v; persistSettings(); exportDialog(); };
  const wide = sizes.filter((z) => orientOf(z.w, z.h) === "wide"), tall = sizes.filter((z) => orientOf(z.w, z.h) !== "wide");
  const lit = () => sizes.filter(ticked).map(sizeKey);
  const flip = (k) => { const on = lit(); setTicked(on.includes(k) ? on.filter((x) => x !== k) : [...on, k]); sync(); };
  const ratios = (list) => list.map((z) => ratioText(z.w, z.h)).join(" · ");
  const picks = [["exp.pickAll", sizes, ""], ["exp.pickWide", wide, "exp.pickWideTip"], ["exp.pickTall", tall, "exp.pickTallTip"]]
    .filter(([, list], i) => sizes.length > 1 && (i === 0 || (wide.length && tall.length)))
    .map(([key, list, tip]) => ({ list, b: el("button", { class: "linkbtn", title: tip ? t(tip, ratios(list)) : ratios(list), onclick: () => { setTicked(list.map(sizeKey)); sync(); } }, t(key)) }));
  const seg = (k, opts) => el("div", { class: "seg" }, opts.map(([v, l]) => el("button", { class: "btn" + (se[k] === v ? " on" : ""), onclick: () => set(k, v) }, l)));
  const thumb = (z) => {   // the tray's, once painted; else painted here
    const cv = el("canvas"), src = $("th-" + sizeKey(z));
    if (src && src.dataset.painted) { cv.width = src.width; cv.height = src.height; cv.getContext("2d").drawImage(src, 0, 0); } else paint(cv, z, virtualSize(z.w, z.h)[0] * 0.2);
    return cv;
  };
  const rows = sizes.map((z) => {   // a press on the row ticks it too, but on its own Export
    const k = sizeKey(z), tick = el("button", { class: "xtick", role: "checkbox", "aria-label": sizeLabel(z), onclick: () => flip(k) });
    return { k, tick, row: el("div", { class: "xrow" + (k === S.sel ? " here" : ""), onclick: (e) => { if (!e.target.closest("button")) flip(k); } },
      tick,
      el("span", { class: "xthumb" }, thumb(z)),
      el("span", { class: "xname" }, el("b", { title: sizeLabel(z) }, caption(z)), el("small", {}, `${z.w}×${z.h}`)),
      el("button", { class: "linkbtn", title: t("exp.oneTip", sizeLabel(z)), onclick: () => exportOne(z) }, t("exp.one"))) };
  });
  const count = el("span", { class: "xcount" }), goSays = el("span"), go = el("button", { class: "btn solid", onclick: exportTicked }, ico("download", 18), goSays, el("kbd", {}, MOD_KEY + "E"));
  const sync = () => {   // the ticks, how many, the quick choice they make (dimmed), the main button
    const on = lit(), same = (list) => list.length === on.length && list.every((z) => on.includes(sizeKey(z)));
    for (const r of rows) { const yes = on.includes(r.k); r.row.classList.toggle("off", !yes); r.tick.setAttribute("aria-checked", String(yes)); r.tick.textContent = yes ? "✓" : ""; }
    count.textContent = t("exp.chosen", on.length, sizes.length);
    for (const p of picks) p.b.classList.toggle("on", same(p.list));
    goSays.textContent = t("exp.goN", on.length);
    go.disabled = !on.length; go.title = on.length ? "" : t("exp.noneTip");
  };
  sync();
  const example = el("div", { class: "hint" }, t("exp.example", nameFor(selSize(), S.cover, catIndex())));
  m.replaceChildren(el("div", { class: "dlg xp" },
    el("div", { class: "xhead" }, el("div", {}, el("h2", {}, t("exp.title")), el("div", { class: "hint" }, [c.name || c.code, S.cover.tag, (LOOKS[S.profile.style.look] || LOOKS.cel).name[getLang()]].filter(Boolean).join(" · "))),
      el("button", { class: "x", title: t("close"), onclick: closeModal }, "✕")),
    el("div", { class: "xcap" }, el("span", {}, el("b", {}, t("exp.sizes")), " ", count), el("span", { class: "xpicks" }, picks.map((p) => p.b))),
    el("div", { class: "xsizes" }, rows.map((r) => r.row)),
    el("div", { class: "xopts" },
      el("div", {}, el("div", { class: "cap" }, t("exp.format")), seg("format", [["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]])),
      el("div", {}, el("div", { class: "cap" }, t("exp.scale")), seg("scale", [1, 2, 3, 4].map((n) => [n, `${n}×`]))),
      el("div", { class: "grow" }, nameField(example))),
    se.format === "jpeg" && slider("exp.quality", 40, 100, 1, se.quality, px, (v) => { se.quality = v; persistSettings(); }),
    el("div", { class: "xex" }, example,
      el("button", { class: "linkbtn", title: t("exp.batchHint"), onclick: () => { closeModal(); S.tab.setup = "sizes"; SET_UI.at = "batch"; setMode("setup"); } }, t("exp.batchGo"))),
    el("div", { class: "xfoot" },
      saveToRow() || el("span", { class: "grow" }),
      el("button", { class: "btn", onclick: () => exportOne(selSize()) }, t("exp.onlyHere")),
      go)));
  m.hidden = false;
}

// ---------- profiles and projects (uploaded assets travel inside the exported files)
const embedAssets = (ids) => ids.map((id) => userAssets.get(id)).filter(Boolean).map(({ id, name, src, spec }) => (spec ? { id, name, spec } : { id, name, src }));
async function adoptEmbedded(list) {
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a.id !== "string") continue;
    if (typeof a.src === "string") await adoptAsset(a.name, a.src, a.id);
    else if (a.spec && !userAssets.has(a.id)) { const r = normalizeSpec(a.spec); if (r.spec) await saveAssetRecord(putSpecAsset(a.id, a.name, r.spec)).catch(fail); }
  }
}
/** The imported fonts that lettering layers in `layerLists` use, for an export: [{name, src}]. */
async function embedFonts(layerLists) {
  const names = new Set(layerLists.flat().map((L) => L.font).filter((f) => f && S.importedFonts.includes(f)));
  const out = [];
  for (const name of names) { const src = await files.read(`fonts/${name}.font`).catch(() => null); if (src) out.push({ name, src }); }
  return out;
}
/** Adds the fonts a file brought that this computer does not have yet. */
async function adoptFonts(list) {
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f.name !== "string" || typeof f.src !== "string" || !/^data:[\w/+.-]*;base64,/.test(f.src)) continue;
    const name = f.name.replace(/[^\w\u4e00-\u9fff -]+/g, " ").trim().slice(0, 80);
    if (!name || S.importedFonts.includes(name)) continue;
    if (await registerFont(name, f.src)) await files.write(`fonts/${name}.font`, f.src).catch(fail);
  }
}
/** Puts the pictures a file brought into the photo store (keeping their ids) and the bitmap library. */
async function adoptPhotos(photos, nameKey) {
  const pic = (v) => (typeof v === "string" && v.startsWith("data:image/") ? v : "");
  for (const [pid, p] of Object.entries(photos && typeof photos === "object" ? photos : {})) {
    if (/^[\w-]{1,40}$/.test(pid) && p && pic(p.src) && (await putPhoto(pic(p.src), { original: pic(p.original), mask: pic(p.mask), pid }))) keepPicture(pid, t(nameKey), "upload");
  }
}
/** Shows another profile, on the channel it was last on, with its own covers as they were left. */
async function switchProfile(id) {
  const profile = S.profiles.find((p) => p.id === id) || S.profiles[0];
  const covers = await loadCovers(profile);   // first: when they cannot be read, the profile shown stays
  S.profile = profile; S.settings.profileId = profile.id; S.covers = covers;
  const catId = channelOf(S.profile);
  S.settings.channels[S.profile.id] = catId; persistSettings();
  setCover(coverFor(catId));
  await loadPhotos(pidsOf(S.cover));
  S.layerId = "title"; S.picked = []; REP.for = "";
  await applyProfile(); resetHistory(); persistCover();
}
async function addProfile(raw, activate = true) {
  const p = normalizeProfile({ ...raw, id: uid() });
  S.profiles.push(p);
  await saveProfile(p).catch(fail);
  if (activate) await switchProfile(p.id);
  return p;
}
const profileActions = {
  new: () => addProfile(starterProfile(getLang(), "")),
  duplicate: () => addProfile({ ...JSON.parse(JSON.stringify(S.profile)), name: `${S.profile.name} ${t("msg.copy")}` }),
  async delete() {
    if (S.profiles.length < 2) return toast(t("msg.lastProfile"));
    if (!confirm(t("msg.confirmDelete", S.profile.name))) return;
    const gone = S.profile;
    await switchProfile(S.profiles.find((p) => p !== gone).id);   // first: when the other one cannot be shown, nothing is deleted
    S.profiles = S.profiles.filter((p) => p !== gone);
    await deleteProfile(gone).catch(fail);
    delete S.settings.exportSizes[gone.id]; delete S.settings.exportDirs[gone.id]; persistSettings();
    for (const f of await files.list("covers/" + gone.id).catch(() => [])) await files.remove(`covers/${gone.id}/${f}`).catch(() => null);   // its covers go with it
    syncTop(); renderPanel();
  },
  /** A profile file: a new profile (its own id), with the covers of its channels if the file has them. */
  async import() {
    const f = await pickFile(".json,application/json");
    if (!f) return;
    try {
      const raw = JSON.parse(await readAs(f, "readAsText"));
      if (!raw || typeof raw !== "object") throw 0;
      await adoptEmbedded(raw.assets);
      await adoptFonts(raw.fonts);
      const p = await addProfile(raw.profile || raw, false), covers = raw.covers && typeof raw.covers === "object" ? raw.covers : null;
      if (covers) {   // version 3 with covers: a whole profile, moved or backed up
        await adoptPhotos(raw.photos, "lib.fromProfile");
        for (const c of p.categories) if (covers[c.id] && typeof covers[c.id] === "object") await writeJson(coverPath(p.id, c.id), await upgradeCover(channelCover(covers[c.id], p, c.id), null)).catch(fail);
        if (p.categories.some((c) => c.id === raw.channel)) S.settings.channels[p.id] = raw.channel;
      }
      await switchProfile(p.id);
      toast(t(covers ? "prof.importedAll" : "prof.imported", p.name));
    } catch (e) { toast(t("msg.badFile")); }
  },
  export: () => profileExportDialog(),
};
const PROF = { withCovers: false };
/** Exporting a profile: its settings to share as a template, or with every channel's cover to move it whole. */
function profileExportDialog() {
  const m = $("modal");
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("prof.exportTitle")),
    el("label", { class: "chk", style: "margin:0" }, el("input", { type: "checkbox", checked: PROF.withCovers, onchange: (e) => { PROF.withCovers = e.target.checked; } }), el("span", {}, t("prof.withCovers"))),
    el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("prof.withCoversHint")),
    el("button", { class: "btn solid wide", onclick: () => { closeModal(); exportProfile(PROF.withCovers); } }, t("prof.exportGo")),
    el("button", { class: "btn wide", onclick: closeModal }, t("exp.cancel"))));
  m.hidden = false;
}
/**
 * Writes the profile file. Always: the profile, the vector assets and imported fonts it uses. With
 * covers (version 3): every channel's cover kept so far, the pictures they show, and the channel it is on.
 */
async function exportProfile(withCovers) {
  const covers = withCovers ? Object.fromEntries(Object.entries(S.covers).filter(([id]) => S.profile.categories.some((c) => c.id === id))) : null;
  const list = covers ? Object.values(covers) : [];
  const ids = new Set([...usedUserAssets(S.profile, null), ...list.flatMap((c) => usedUserAssets(null, c))]);
  const file = { app: "smedcover", kind: "profile", version: 3, profile: S.profile, assets: embedAssets([...ids]),
    fonts: await embedFonts([S.profile.design.layers, ...list.map((c) => c.layers)]),
    ...(covers ? { covers, channel: S.cover.catId, photos: embedPhotos(list) } : {}) };
  saveText(`${S.profile.name || "profile"}${covers ? ".all" : ""}.smedprofile.json`, JSON.stringify(file, null, covers ? 0 : 2));
}
/** A new layer list with the photo layers of `old` put back, each above the layer it was above (or the background). */
function keepPhotos(layers, old) {
  old.forEach((L, i) => { if (L.type !== "photo") return; const below = old[i - 1]; insertAbove(layers, below && layers.some((l) => l.id === below.id) ? below.id : "bg", L); });
  return layers;
}
/** Asks how to open a project whose profile this computer does not have: "new", "current", or null (not at all). */
function askProjectProfile(name) {
  return new Promise((done) => {
    const m = $("modal"), pick = (v) => () => { closeModal(); done(v); };
    m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("proj.askTitle")),
      el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("proj.askBody", name)),
      el("button", { class: "btn solid wide", onclick: pick("new") }, t("proj.asNew", name)),
      el("button", { class: "btn wide", onclick: pick("current") }, t("proj.asCurrent", S.profile.name)),
      el("button", { class: "btn wide", onclick: pick(null) }, t("exp.cancel"))));
    m.onDismiss = pick(null);   // a click outside is its cancel
    m.hidden = false;
  });
}
/** The pictures the photo layers of `covers` show, for a file: {pid: {src, original, mask}}. */
function embedPhotos(covers) {
  const out = {};
  for (const pid of new Set(covers.flatMap((c) => [...pidsOf(c)]))) { const r = S.photos.get(pid); if (r) out[pid] = { src: r.src, original: r.original || null, mask: r.mask ? r.mask.src : null }; }
  return out;
}
const projectActions = {
  /**
   * A project file opens into its own profile and channel: the profile here with its id, else — asked —
   * as a new profile, or into the current one (on its channel if this profile has it). Files before
   * version 4 have no profile: they open into the channel on the canvas. Undo brings back the cover it replaced.
   */
  async open() {
    const f = await pickFile(".json,application/json");
    if (!f) return;
    let raw;
    try { raw = JSON.parse(await readAs(f, "readAsText")); if (!raw || raw.kind !== "project" || !raw.cover) throw 0; } catch (e) { return toast(t("msg.badFile")); }
    try {
      let profile = S.profile, catId = S.cover.catId, across = null;   // across: the sizes of the profile the cover was made in, opened into another
      const theirs = raw.profile && typeof raw.profile === "object" ? raw.profile : null;
      const here = theirs && S.profiles.find((p) => p.id === theirs.id);
      if (here) profile = here;
      else if (theirs) {
        const how = await askProjectProfile(theirs.name || raw.profileName || "—");
        if (!how) return;
        if (how === "new") { await adoptFonts(raw.fonts); profile = await addProfile(theirs, false); }
        else across = normalizeProfile(theirs).sizes.map(sizeKey);
      }
      if (profile.categories.some((c) => c.id === raw.catId)) catId = raw.catId;
      else if (profile !== S.profile) catId = channelOf(profile);
      await adoptEmbedded(raw.assets);
      await adoptFonts(raw.fonts);
      await adoptPhotos(raw.photos, "lib.fromProject");
      if (profile !== S.profile) await switchProfile(profile.id);
      if (catId !== S.cover.catId) await switchChannel(catId);
      clearTimeout(timers.hist); commitHistory();
      if (across && Array.isArray(raw.cover.layers)) acrossSizes(raw.cover.layers, across, sizeKeys());   // what its layers keep by size, on this profile's sizes (as Copy from another channel puts it)
      const pic = (v) => (typeof v === "string" && v.startsWith("data:image/") ? v : "");
      const opened = await upgradeCover(normalizeCover(raw.cover, S.profile), { src: pic(raw.photo), original: pic(raw.photoOriginal), mask: pic(raw.photoMask) });   // version 2 kept one photo beside the cover
      setCover(channelCover(opened, S.profile, catId));
      await loadPhotos(pidsOf(S.cover));
      S.layerId = "title"; S.picked = [];
      touch({ cover: true, panel: true, side: true, strip: true });
      toast(t("proj.opened", S.profile.name, cat().name || cat().code || "—"));
    } catch (e) { fail(e); }
  },
  /** Version 4: the cover with its profile and channel, the pictures, vector assets and imported fonts it uses. */
  async save() {
    const fonts = await embedFonts([S.cover.layers, S.profile.design.layers]);
    saveText(`${(S.cover.title.split("\n")[0] || "cover").replace(/[*\\/:?"<>|]+/g, "").slice(0, 24) || "cover"}.smedcover.json`,
      JSON.stringify({ app: "smedcover", kind: "project", version: 4, profileName: S.profile.name, profile: S.profile, catId: S.cover.catId, cover: S.cover,
        photos: embedPhotos([S.cover]), assets: embedAssets(usedUserAssets(S.profile, S.cover)), fonts }));
  },
  reset() { setCover(channelCover(null, S.profile, S.cover.catId)); S.layerId = "title"; touch({ cover: true, panel: true, side: true }); },
};
/**
 * Whether project files can be had here (the ⋯ menu's Project file, ⌘O and ⌘S): saved through the app's dialog, else
 * downloaded, which a page that cannot download cannot do; every host opens one with the file picker.
 */
const CAN_PROJECT = CAN.saveFiles || "download" in HTMLAnchorElement.prototype;
/** How a shortcut's key is written: ⌘ on a Mac, Ctrl+ elsewhere. */
const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";
/** Whether key event e is ⌘S or ⌘O (Ctrl off the Mac): let through by the fields that keep every other key to themselves. */
const projectKey = (e) => (MOD_KEY === "⌘" ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && /^[so]$/i.test(e.key);

// ---------- chrome
function setMode(mode) {
  S.mode = mode;
  if (mode !== "edit" && V3.on) close3d();   // Settings lies over the canvas
  columns();   // the handles' words follow the language
  $("settings").hidden = mode !== "setup";
  closeMenu();
  if (mode !== "edit") { lettersClose(); cropClose(); weaveClose(); brushClose(); }
  syncTop(); syncTabs(); renderPanel(); renderSide(); syncToolbar(); queueDraw();
}
/**
 * One hand of Surprise me, dealt onto the cover and the profile's style as they are: everything but where
 * the user's own layers go by dealCover (deal.js, where all the rules are) — the layout among it, the canvas's or
 * one of the user's layout presets — then those places by dealPlaces, on the layout dealt. `design`: the layers of
 * the profile's design by id, where moved words go back to (but for a preset's); `not`: the looks dealt already in
 * this run. Returns the layout dealt: "keep", or the preset's id.
 */
function dealHand(design = new Map(channelCover(null, S.profile, S.cover.catId).layers.map((l) => [l.id, l])), not = []) {
  const R = Math.random, sv = S.settings.surprise, layouts = S.settings.layouts;
  const { layout } = dealCover(S.profile.style, S.cover, { R, locks: sv.locks, odds: oddsOf(sv.odds, layouts), layouts, not, recipes: S.settings.recipes, rgb: hexToRgb(cat().color), design, sizeKey: frame().key, sizes: sizeKeys(), can: (k) => CAN.outlines || EFFECTS[k].kind !== "outline", canTint });
  if (!sv.locks.places) dealPlaces(R);
  return layout;
}
/** Surprise me's run (how many hands, how fast they show: RULES.hands in deal.js). done: when the last run ended; step: the step of undo it made ({idx}) while nothing has followed it. */
const SURPRISE = { busy: false, done: 0, step: null };
const copyOf = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
/** The cover as Surprise me deals it — the style, the layers, the scene objects' places — copied. */
const handNow = () => ({ style: copyOf(S.profile.style), layers: copyOf(S.cover.layers), scene: copyOf(S.cover.scene) });
/**
 * Hand h put back onto the objects there are — the style, each layer by its id — so whatever holds one
 * (a panel, a cut-out under way) still holds the cover's.
 */
function putHand(h) {
  const into = (o, v) => { for (const k of Object.keys(o)) if (!(k in v)) delete o[k]; Object.assign(o, copyOf(v)); };
  into(S.profile.style, h.style);
  const had = new Map(S.cover.layers.map((l) => [l.id, l]));
  S.cover.layers = h.layers.map((v) => { const L = had.get(v.id); if (!L) return copyOf(v); into(L, v); return L; });
  if (h.scene) S.cover.scene = copyOf(h.scene); else delete S.cover.scene;
}
/**
 * SURPRISE ME: deals RULES.hands.count hands (dealHand), each in a look of its own while there are looks left,
 * by the chances set in Surprise me's chances window (oddsOf in deal.js), each shown in Surprise me's window as it
 * comes; then puts the first on the canvas. Another may be taken instead with a click (dealTake). One step of
 * undo brings the previous cover back.
 */
async function surprise(e) {
  if (SURPRISE.busy || (e && e.timeStamp < SURPRISE.done)) return;   // a click from while the last one held the window up
  SURPRISE.busy = true;
  document.body.classList.add("dealing");   // nothing else to be done to the cover while hands are dealt onto it
  let before = null;
  try {
    syncTop();
    const first = !$("deal") || $("deal").hidden;   // not Deal again in the window
    dealOpen();
    await nextPaint();   // the button and the window show it is at work before the window is held up
    clearTimeout(timers.hist); commitHistory();   // whatever was being edited becomes a step of its own, so each hand is exactly one undo
    if (first) DEAL.from = S.hist[S.histIdx];   // the cover before this window's deals, for Undo the deal
    SURPRISE.step = null;
    before = handNow();
    const design = new Map(channelCover(null, S.profile, S.cover.catId).layers.map((l) => [l.id, l])), hands = [], dealt = [], shown = selSize(), t0 = performance.now(), H = RULES.hands;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let shownAt = 0;
    for (let i = 0; i < H.count; i++) {
      if (i) putHand(before);
      try {
        const layout = dealHand(design, dealt);
        const cv = el("canvas");
        drawCover(cv, { profile: S.profile, catIndex: catIndex(), size: shown, pixelW: DEAL.px, cover: S.cover, photos: S.photos });
        dealt.push(S.profile.style.look);
        hands.push({ ...handNow(), layout });   // its structure is in the style and the layers it keeps (putHand puts both back)
        // the hand shows before the next is dealt, and long enough after the last to be seen coming
        const since = performance.now() - shownAt;
        if (since < H.pace) await wait(H.pace - since);
        dealShow(hands.length - 1, hands[hands.length - 1], cv);
        shownAt = performance.now(); await nextPaint();
      } catch (e) { console.error(e); }   // a hand that cannot be drawn is left out
    }
    if (!hands.length) throw new Error(t("deal.none"));
    await wait(H.pace * 2);   // a moment with every hand in view, then the first on the canvas, and marked
    putHand(hands[0]);
    SURPRISE.last = { kept: 0, ms: Math.round(performance.now() - t0), hands: hands.map((h) => ({ look: h.style.look, layout: h.layout, template: layoutOf(h.style, sizeKey(shown)).template })) };   // for the self-test
    touch({ profile: true, cover: true, panel: true, side: true, strip: true });
    commitHistory(true);   // a step of its own even if the hand is the cover as it was: another hand taken, or the deal undone, leaves the step before it alone
    SURPRISE.step = { idx: S.histIdx };
    dealKept(0);
  } catch (err) {
    if (before) { putHand(before); S.hist[S.histIdx] = snapshot(); touch({ panel: true, side: true }); }   // the cover as it was, and no step of undo for it
    dealClose();
    fail(err);
  } finally {
    await nextPaint();   // still at work until the hand is on the screen: clicks made before then are let go (see `done`)
    SURPRISE.busy = false; SURPRISE.done = performance.now();
    document.body.classList.remove("dealing"); syncTop();
  }
}
// ---------- Surprise me's window, over the whole window, the cover dimmed behind it: the hands as they are dealt, as
// large as fit to judge them by, the one on the canvas marked, another put there with a click; under them, on a bar
// of glass, the parts to leave alone next time, the way to the chances, Deal again and Done. Esc (Undo the run) puts
// the cover back as it was before the run; Done, or a click on the dim around, keeps the hand on the canvas.
const DEAL = { hands: [], kept: -1, px: 360, from: null };   // kept: the hand on the canvas; px: how wide a hand is drawn; from: the history's entry before the window's first deal
/** Opens Surprise me's window (or empties it for a new run): a place for each hand to come. */
function dealOpen() {
  const box = $("deal") || document.body.appendChild(el("div", { id: "deal", role: "dialog", "aria-label": t("deal.title") }));
  const z = selSize(), locks = S.settings.surprise.locks;
  DEAL.hands = []; DEAL.kept = -1;
  lettersClose(); cropClose(); weaveClose(); brushClose();   // the letter, crop, weave and brush windows would be under it
  if (FTB.pop) { FTB.pop = ""; renderBar(); }
  box.style.setProperty("--ar", `${z.w} / ${z.h}`);
  // a lock pressed: the row drawn again, Places locked holding the layout locked too (shown so, and not to be pressed)
  const lock = (k) => {
    const held = k === "layout" && !!locks.places, on = held || !!locks[k];
    return el("button", { class: "lock" + (on ? " on" : ""), title: t(held ? "deal.lock.layoutByPlaces" : `deal.lock.${k}Tip`), disabled: held, dataset: { lock: k },
      onclick: (e) => {
        const had = document.activeElement === e.currentTarget, row = e.currentTarget.parentNode;
        if (locks[k]) delete locks[k]; else locks[k] = true;
        persistSettings(); row.replaceChildren(...SURPRISE_LOCKS.map(lock));
        if (had) row.querySelector(`[data-lock="${k}"]`).focus();
      } },
      el("span", { class: "ico", innerHTML: ICONS[on ? "lock" : "unlock"] }), t(`deal.lock.${k}`));
  };
  box.replaceChildren(
    el("div", { class: "deal-dim", onclick: dealClose }),
    el("div", { class: "deal-head" }, el("h2", {}, t("deal.title")), el("div", { id: "deal-what" }, t("deal.dealing"))),
    el("button", { class: "deal-undo glass", title: t("deal.undoTip"), onclick: dealUndo }, el("kbd", {}, "Esc"), t("deal.undo")),
    el("div", { class: "hands", id: "deal-hands" }, Array.from({ length: RULES.hands.count }, () => el("figure", { class: "slot" }, el("div", { class: "blank" }), el("figcaption", {})))),
    el("div", { class: "deal-bar glass" },
      el("div", { class: "locks" }, el("small", {}, t("deal.locks")), el("div", {}, SURPRISE_LOCKS.map(lock))),
      el("span", { class: "grow" }),
      el("button", { class: "linkbtn", title: t("deal.odds"), onclick: () => oddsDialog() }, t("deal.oddsGo")),
      el("button", { class: "btn again", onclick: surprise }, ico("spark", 18), t("deal.again"), el("kbd", {}, t("top.space"))),
      el("button", { class: "btn solid done", onclick: dealClose }, t("deal.done"))));
  box.hidden = false;
  dealFit();
}
/** Lays the hands out as large as they fit between the heading and the bar: in 2, 3 or 6 columns, whichever gives the widest. */
function dealFit() {
  const list = $("deal-hands");
  if (!list) return;
  const z = selSize(), n = RULES.hands.count, gap = 18, cap = 52, W = Math.min(innerWidth - 96, 1280), H = Math.max(200, innerHeight - 300);   // 300: the heading, the bar and the margins
  let best = null;
  for (const cols of [2, 3, 6]) {
    const rows = Math.ceil(n / cols), w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows - cap) * (z.w / z.h));
    if (!best || w > best.w) best = { cols, w };
  }
  list.style.gridTemplateColumns = `repeat(${best.cols}, ${Math.floor(best.w)}px)`;
  DEAL.px = Math.round(Math.min(540, best.w * Math.min(1.5, devicePixelRatio || 1)));   // sharp enough, and six of them drawn in a second
}
addEventListener("resize", () => { if ($("deal") && !$("deal").hidden) dealFit(); });
/** A hand in a few words: its ground (for a look with two), its title's lettering, its layout (the preset's name, or the template's at the size shown). */
function handSays(h) {
  const lang = getLang(), lk = LOOKS[h.style.look] || LOOKS.cel, title = h.layers.find((l) => l.id === "title");
  const fx = title && title.fx && title.fx !== "auto" && EFFECTS[title.fx] ? EFFECTS[title.fx].name[lang] : t("odds.ownLetters");
  const n = S.settings.layouts.findIndex((p) => p.id === h.layout);
  const lay = n >= 0 ? layoutName(S.settings.layouts[n], n) : t("tpl." + layoutOf(h.style, S.sel).template);
  return [!lk.oneTheme && t("deal.ground." + h.style.theme), fx, lay].filter(Boolean).join(" · ");
}
/** Hand i, just dealt, in its place: its drawing at the size shown, its look, and what it is in a few words. */
function dealShow(i, h, cv) {
  const slot = $("deal-hands") && $("deal-hands").children[i];
  if (!slot) return;
  DEAL.hands[i] = h;
  const says = handSays(h);
  slot.replaceChildren(cv || el("div", { class: "blank" }), el("span", { class: "on" }, t("deal.onCanvas")),
    el("figcaption", {}, el("b", {}, LOOKS[h.style.look].name[getLang()]), el("span", { title: says }, says)));
  slot.className = "hand"; slot.onclick = () => dealTake(i);
  $("deal-what").textContent = t("deal.dealt", i + 1);
}
/** The hands all dealt: the places left empty go, hand k (on the canvas) is marked. */
function dealKept(k) {
  const list = $("deal-hands");
  if (!list) return;
  for (const f of [...list.querySelectorAll("figure.slot")]) f.remove();
  DEAL.kept = k; dealMark();
}
function dealMark() {
  [...$("deal-hands").children].forEach((f, i) => f.classList.toggle("kept", i === DEAL.kept));
  $("deal-what").textContent = counted("deal.sub", DEAL.hands.filter(Boolean).length);
}
/** Puts hand i on the canvas instead, while nothing has followed the run: still one step of undo. */
function dealTake(i) {
  if (SURPRISE.busy || i === DEAL.kept || !DEAL.hands[i]) return;
  clearTimeout(timers.hist); commitHistory();   // an edit made since is a step of its own, and the hands are past taking
  if (!SURPRISE.step || S.histIdx !== SURPRISE.step.idx) return dealClose();
  putHand(DEAL.hands[i]); DEAL.kept = i;
  touch({ profile: true, cover: true, panel: true, side: true, strip: true });
  S.hist[S.histIdx] = snapshot();
  dealMark();
}
/**
 * Undo the deal: the cover as it was before the window's first deal (back through its steps of undo, which redo takes
 * again), and the window closed; only closed should that step be gone from the history, or the cover edited since.
 */
function dealUndo() {
  if (SURPRISE.busy) return;
  const at = DEAL.from == null ? -1 : S.hist.lastIndexOf(DEAL.from, S.histIdx);
  if (SURPRISE.step && S.histIdx === SURPRISE.step.idx && at >= 0) timeTravel(at - S.histIdx); else dealClose();
}
/** Closes Surprise me's window, keeping the hand on the canvas; a hand kept in a look other than the cover had before the window's first deal counts as that look picked (★ Most used). */
function dealClose() {
  const box = $("deal");
  if (box && !box.hidden && DEAL.kept >= 0 && SURPRISE.step && S.histIdx === SURPRISE.step.idx && DEAL.from && JSON.parse(DEAL.from).p.style.look !== S.profile.style.look) countLook(S.profile.style.look);
  if (box) box.hidden = true;
}
/**
 * Asks, then empties this channel's cover: every layer the user added goes, the layout layers return to
 * the profile's default design (places, effects, colours), the scene objects to where the layout puts
 * them; the title, the tag and the style stay. One step of undo.
 */
function clearDialog() {
  const m = $("modal");
  const go = () => {
    closeModal(); clearTimeout(timers.hist); commitHistory(); SURPRISE.step = null;
    const fresh = channelCover({ catId: S.cover.catId, title: S.cover.title, subtitle: S.cover.subtitle, tag: S.cover.tag }, S.profile, S.cover.catId);
    fresh.layers = fresh.layers.filter(isLayout);   // the design's own added layers go too: empty is empty
    for (const l of fresh.layers) {   // the parts this cover has, and those it leaves out, stay as they are
      const now = layer(l.id);
      if (now && now.off) { l.off = true; l.visible = false; } else if (now && l.off) { delete l.off; l.visible = true; }
    }
    setCover(fresh); S.layerId = "title"; S.picked = [];
    touch({ cover: true, side: true, panel: onCoverTab() });
    commitHistory(); toast(t("top.cleared"));
  };
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("top.clearTitle")),
    el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("top.clearBody")),
    el("button", { class: "btn solid wide", onclick: go }, t("top.clearGo")),
    el("button", { class: "btn wide", onclick: closeModal }, t("exp.cancel"))));
  m.hidden = false;
}
/** The shell's icons, 24 units across (the dock, the top bar, the menu, the bar over the canvas). */
const SHELL_ICONS = {
  content: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  look: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.6 17 3 12 3Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="12" cy="7.5" r="1"/><circle cx="16.5" cy="10.5" r="1"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14 21 11"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  sizes: '<rect x="2.5" y="5" width="13" height="9" rx="1.5"/><rect x="11" y="9" width="10.5" height="12" rx="1.5"/>',
  assets: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><path d="M12 17h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  wand: '<path d="m5 19 9-9"/><path d="M15 4v2M19 8h2M18.5 5.5 20 4M13 6l3 3"/>',   // a text effect, on the bar over the canvas
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 7.5 2.9C19.5 15.4 12 20 12 20Z"/>',   // a look liked, in the Look sheet (filled by CSS where it is)
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
};
const ico = (k, px = 20) => el("span", { class: "ico", style: `display:inline-grid;width:${px}px;height:${px}px`, innerHTML: `<svg viewBox="0 0 24 24" width="${px}" height="${px}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SHELL_ICONS[k]}</svg>` });
/**
 * The top bar: the profile and the channel; undo and redo; Surprise me, Export, and the ⋯ menu (the cover's
 * default design and Clear, the profile's settings, project files, the glass, the language).
 */
function syncTop() {
  if (!S.profile) return;
  const step = (key, icon, by, off) => el("button", { class: "ibtn", title: t(key), "aria-label": t(key), disabled: off, onclick: () => timeTravel(by) }, ico(icon, 18));
  $("top").replaceChildren(
    el("h1", {}, "SMEDCOVER"),
    el("div", { class: "sep" }),
    el("div", { class: "crumb" },
      el("select", { title: t("top.profile"), onchange: (e) => switchProfile(e.target.value).catch((err) => { fail(err); syncTop(); }) }, S.profiles.map((p) => el("option", { value: p.id, selected: p.id === S.profile.id }, p.name))),
      el("span", {}, "/"), el("span", { class: "dot" }),
      S.cover && el("select", { title: t("top.channel"), onchange: (e) => switchChannel(e.target.value) }, S.profile.categories.map((k) => el("option", { value: k.id, selected: k.id === S.cover.catId }, k.name || k.code || "—")))),
    el("div", { class: "spacer" }),
    el("div", { class: "grp" }, step("top.undo", "undo", -1, S.histIdx <= 0), step("top.redo", "redo", 1, S.histIdx >= S.hist.length - 1), el("span", {}, t("top.saved"))),
    el("div", { class: "spacer" }),
    el("button", { class: "btn cta glassy deal-btn", title: t("top.surpriseHint"), disabled: SURPRISE.busy, onclick: surprise }, ico("spark", 18), t(SURPRISE.busy ? "top.surpriseBusy" : "top.surprise"), el("kbd", {}, t("top.space"))),
    el("button", { class: "btn cta solid", title: t("top.exportTip", MOD_KEY + "E"), onclick: exportDialog }, ico("download", 18), t("top.export")),
    el("button", { class: "ibtn" + (MENU.open ? " on" : ""), id: "morebtn", title: t("top.more"), "aria-label": t("top.more"), "aria-haspopup": "menu", "aria-expanded": String(MENU.open), onclick: toggleMenu }, ico("more", 18)));
  for (const b of document.querySelectorAll("#winbtns button")) b.setAttribute("aria-label", b.title = t("top.win." + b.className));   // drawn on Windows and Linux (ownTitleBar)
  document.body.dataset.drop = t("msg.dropHere");
  if (MENU.open) renderMenu();
}
// ---------- the ⋯ menu
const MENU = { open: false, profiles: false };
/** String `key` with a count: `key`.one for one ("1 channel"), else `key` ("5 channels"). */
const counted = (key, n, ...more) => t(n === 1 ? key + ".one" : key, n, ...more);   // profiles: the other profiles listed, to switch to
function toggleMenu() { if (MENU.open) closeMenu(); else openMenu(); }
function openMenu() {
  MENU.open = true; MENU.profiles = false; renderMenu();
  const m = $("menu"), b = $("morebtn").getBoundingClientRect();
  Object.assign(m.style, { top: `${b.bottom + 8}px`, right: `${Math.max(8, innerWidth - b.right)}px` });
  m.hidden = false; $("morebtn").classList.add("on"); $("morebtn").setAttribute("aria-expanded", "true");
}
function closeMenu() {
  MENU.open = false; $("menu").hidden = true;
  const b = $("morebtn"); if (b) { b.classList.remove("on"); b.setAttribute("aria-expanded", "false"); }
}
function renderMenu() {
  const go = (fn) => () => { closeMenu(); fn(); };
  const item = (label, sub, fn, cls = "") => el("button", { class: "mi " + cls, role: "menuitem", onclick: go(fn) }, el("span", { class: "mt" }, el("span", {}, label), sub && el("small", {}, sub)));
  const page = (k, sub) => item(t("tab." + k), sub, () => { S.tab.setup = k; setMode("setup"); });
  const keyed = (label, k, fn) => el("button", { class: "mi", role: "menuitem", "aria-keyshortcuts": (MOD_KEY === "⌘" ? "Meta+" : "Control+") + k, onclick: go(() => fn().catch(fail)) },
    el("span", { class: "mt" }, el("span", {}, label)), el("kbd", { class: "sc" }, MOD_KEY + k));   // its shortcut at its end
  const on = glassOn(), others = S.profiles.filter((p) => p !== S.profile);
  $("menu").replaceChildren(...[
    el("div", { class: "mg" }, t("menu.cover")),
    item(t("style.saveDesign"), t("menu.saveDesignSub"), saveDesign),
    item(t("style.loadDesign"), t("menu.loadDesignSub"), loadDesign),
    item(t("menu.clear"), t("top.clearTip"), clearDialog, "danger"),
    el("div", { class: "sep" }),
    el("div", { class: "mg" }, t("menu.profile", S.profile.name)),
    page("brand", counted("menu.channels", S.profile.categories.length)), page("sizes", counted("menu.sizes", S.profile.sizes.length)), page("ai", AI_SHOW.menu()),
    others.length > 0 && el("button", { class: "mi", role: "menuitem", "aria-expanded": String(!!MENU.profiles), onclick: () => { MENU.profiles = !MENU.profiles; renderMenu(); } },
      el("span", { class: "mt" }, el("span", {}, t("menu.switch"))), el("span", { class: "chev" + (MENU.profiles ? " open" : "") })),
    MENU.profiles && others.map((p) => el("button", { class: "mi sub", role: "menuitem", onclick: go(() => switchProfile(p.id).catch((err) => { fail(err); syncTop(); })) },
      el("span", { class: "mt" }, el("span", {}, p.name), el("small", {}, counted("menu.channels", p.categories.length))))),
    CAN_PROJECT && [el("div", { class: "sep" }), el("div", { class: "mg" }, t("proj.group")),
      keyed(t("proj.open"), "O", projectActions.open), keyed(t("proj.save"), "S", projectActions.save)],
    el("div", { class: "sep" }),
    el("div", { class: "row", title: CAN_BLUR ? t("menu.glassTip") : null }, el("span", {}, t("menu.glass")),
      el("button", { class: "tog" + (on ? " on" : ""), role: "switch", "aria-checked": String(on), "aria-label": t("menu.glass"), disabled: !CAN_BLUR, onclick: () => { setGlass(!on, true); renderMenu(); } })),
    el("div", { class: "row" }, el("span", {}, t("langName")),
      el("div", { class: "seg" }, [["zh", "中文"], ["en", "English"]].map(([v, l]) => el("button", { class: "btn" + (v === getLang() ? " on" : ""),
        onclick: go(() => { S.settings.lang = v; setLang(v); persistSettings(); setMode(S.mode); buildStrip(); }) }, l)))),
    el("div", { class: "foot" }, t("menu.foot"))].flat().filter(Boolean));
}
addEventListener("pointerdown", (e) => { if (MENU.open && !$("menu").contains(e.target) && !(e.target.closest && e.target.closest("#morebtn"))) closeMenu(); });
// Settings closes by its ✕, Esc, or a click beside its window
$("setclose").onclick = () => setMode("edit");
$("settings").addEventListener("pointerdown", (e) => { if (e.target === $("settings")) setMode("edit"); });
// ---------- the glass: frosted panes over the blurred cover, or plain ones, as the user chooses in the ⋯ menu
const CAN_BLUR = !!(globalThis.CSS && (CSS.supports("backdrop-filter", "blur(2px)") || CSS.supports("-webkit-backdrop-filter", "blur(2px)")));
const glassOn = () => CAN_BLUR && S.settings.glass !== false;
/** Frosts the panes, or makes them plain; `byHand`, the user's choice (the menu), kept. */
function setGlass(on, byHand = false) {
  if (byHand) { S.settings.glass = on; persistSettings(); }
  document.documentElement.classList.toggle("solid", !(on && CAN_BLUR));
}
/**
 * Watches the frames while something is dragged by the pointer — a slider held, a layer moved on the canvas — when
 * the canvas is drawn in one frame after another (typing, or keys held on a slider, draw as often as keys come, which
 * says nothing of the frames). Should they come slowly with the glass on, a note offers plain panes when that drag is
 * let go, with a button to make them so; only once on this computer (settings.glassHint). A drag that ends otherwise
 * (cancelled, the window left) says nothing. The glass itself changes only by the user's hand.
 */
const GLASS = { last: 0, gaps: [], slow: false, down: false };
function glassWatch(now) {
  const dragging = GLASS.down && !!(DRAFT.down || LIVE), gap = GLASS.last ? now - GLASS.last : 0;
  GLASS.last = dragging ? now : 0;
  if (!dragging || !gap || gap > 250 || GLASS.slow || S.settings.glassHint || !glassOn()) return;   // gap > 250: not one frame after another
  GLASS.gaps.push(gap);
  if (GLASS.gaps.length < 90) return;
  GLASS.slow = GLASS.gaps.sort((a, b) => a - b)[45] > DEFAULTS.ui.glassSlowMs; GLASS.gaps = [];   // slow: half the frames further apart than that, in ms (ui.glassSlowMs in defaults.json)
}
addEventListener("pointerdown", () => { GLASS.down = true; }, true);
addEventListener("pointerup", () => {
  const slow = GLASS.slow; GLASS.down = GLASS.slow = false;
  if (!slow || S.settings.glassHint || !glassOn()) return;
  S.settings.glassHint = true; persistSettings();
  toast(t("ui.glassSlow"), false, { label: t("ui.glassPlain"), run: () => { setGlass(false, true); if (MENU.open) renderMenu(); } });
}, true);
for (const k of ["pointercancel", "blur"]) addEventListener(k, () => { GLASS.down = GLASS.slow = false; GLASS.gaps = []; });
addEventListener("pointermove", (e) => { if (GLASS.down && !(e.buttons & 1)) GLASS.down = GLASS.slow = false; }, true);   // the release was missed (the window moved, a list's popup): nothing to say
/**
 * In the desktop app the window has no title bar of its own: on a Mac it is see-through (titleBarStyle "Overlay" in
 * tauri.conf.json) and the window's close, minimise and zoom buttons float over the top bar's left end; on Windows and
 * Linux there is none ("decorations": false in tauri.windows.conf.json and tauri.linux.conf.json), and the page draws
 * the same three buttons there (#winbtns), in a Mac's colours, grey while another window is the one in use, their
 * signs shown while the pointer is over them. html.ownbar leaves them room. The top bar (all but its buttons and lists)
 * and the window's margin move the window, and a double click there zooms it, as a title bar's would
 * (data-tauri-drag-region, Tauri's own); while Settings, a dialog or Surprise me's window covers them, a strip along
 * the window's top (#winbar) does. A press there still takes the focus from a field, as a press on nothing would. In
 * full screen the buttons are gone, and so is their room (on a Mac asked again once the way out of it has ended).
 */
function ownTitleBar() {
  const top = $("top"), app = document.querySelector(".app"), bar = document.body.appendChild(el("div", { id: "winbar" })), html = document.documentElement;
  top.dataset.tauriDragRegion = "deep"; app.dataset.tauriDragRegion = ""; bar.dataset.tauriDragRegion = "";   // .app: its margin only, not what is in it
  for (const n of [top, app, bar]) n.addEventListener("pointerdown", (e) => { if (n === top ? !e.target.closest("button,select") : e.target === n) document.activeElement?.blur?.(); });   // .app: its margin, not the editor in it
  const win = globalThis.__TAURI__.window.getCurrentWindow(), room = () => win.isFullscreen().then((full) => html.classList.toggle("ownbar", !full)).catch(() => {});
  win.isDecorated().then((framed) => {
    if (framed) return;   // a Mac's own buttons, over the see-through title bar
    const sign = { close: "M3 3l4 4M7 3l-4 4", min: "M2.5 5h5", zoom: "M5 2.5v5M2.5 5h5" };
    const button = (k, act) => el("button", { class: k, tabindex: "-1", onmousedown: (e) => e.preventDefault(), onclick: () => win[act]().catch(fail) },   // a field keeps its focus, as with a Mac's
      el("span", { innerHTML: `<svg viewBox="0 0 10 10" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" aria-hidden="true"><path d="${sign[k]}"/></svg>` }));
    const box = document.body.appendChild(el("div", { id: "winbtns" }, button("close", "close"), button("min", "minimize"), button("zoom", "toggleMaximize")));
    box.dataset.tauriDragRegion = "";   // between the buttons, as on the top bar under them
    const used = (on) => box.classList.toggle("idle", !on);
    win.isFocused().then(used).catch(() => {}); win.onFocusChanged(({ payload }) => used(payload)).catch(() => {});
  }).catch(() => {});
  html.classList.add("ownbar");
  addEventListener("resize", () => { later("ownbar", 150, room); if (isMac) later("ownbar-out", 1000, room); });
}
/**
 * The page's ground (#ambient): the cover as last drawn, tiny — CSS blurs it — so the glass takes its colours. A new
 * ground fades in: the ground as seen until now goes on a second canvas (#amb0) over the new one and fades out over
 * 0.7 s, then is hidden, so the window has two blurred layers only while it fades. A change too small to show through
 * the blur, or a wish for less motion (prefers-reduced-motion), is painted straight in.
 */
const AMB = { fade: null };   // the old ground's fade, while it runs
const ambCtx = (c) => c.getContext("2d");   // accelerated, as the cover's canvas is: reading back 48 pixels across (ambientMoved) is cheap, reading back the cover would not be
function paintAmbient() {
  const src = $("cv"), dst = $("amb"), old = $("amb0");
  if (!src.width || !src.height) return;
  const h = Math.max(1, Math.round((48 * src.height) / src.width)), left = AMB.fade ? +getComputedStyle(old).opacity : 0;
  AMB.fade?.cancel(); AMB.fade = null; old.hidden = true;
  if (old.height !== dst.height) { const was = el("canvas", { width: 48, height: old.height }); ambCtx(was).drawImage(old, 0, 0); old.height = dst.height; ambCtx(old).drawImage(was, 0, 0, 48, old.height); }   // a new shape mid-fade: what is left of it kept
  const o = ambCtx(old);
  o.globalCompositeOperation = "destination-in"; o.fillStyle = `rgba(0,0,0,${left})`; o.fillRect(0, 0, 48, old.height);   // what is left of the ground before
  o.globalCompositeOperation = "destination-over"; o.drawImage(dst, 0, 0); o.globalCompositeOperation = "source-over";   // over the one it was fading into
  if (dst.height !== h) dst.height = h;
  const x = ambCtx(dst); x.clearRect(0, 0, 48, h); x.drawImage(src, 0, 0, 48, h);   // cleared: a see-through cover leaves nothing of the last behind
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !ambientMoved(old, dst)) return;
  old.hidden = false;
  const fade = AMB.fade = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, easing: "ease-in-out", fill: "forwards" });   // gone until hidden
  fade.onfinish = () => { if (AMB.fade === fade) { old.hidden = true; fade.cancel(); AMB.fade = null; } };
}
/** Whether ground `b` looks other than ground `a` through the blur: their pixels apart by more than 2 in 255 on average. */
function ambientMoved(a, b) {
  if (a.height !== b.height) return true;
  try {
    const p = ambCtx(a).getImageData(0, 0, 48, a.height).data, q = ambCtx(b).getImageData(0, 0, 48, b.height).data;
    let d = 0; for (let i = 0; i < p.length; i++) d += Math.abs(p[i] - q[i]);
    return d / p.length > 2;
  } catch { return true; }
}
const TABS = { edit: { content: contentSheet, look: lookSheet, layout: layoutSheet, assets: assetsSheet, layers: layersSheet }, setup: { brand: brandTab, sizes: sizesTab, ai: aiTab } };
/** The dock's buttons, one per sheet, each opening its sheet; in Settings, its pages down the window's left. */
function syncTabs() {
  if (S.mode === "setup") {
    const P = S.profile, act = (key) => el("button", { class: "btn" + (key === "delete" ? " danger" : ""), onclick: () => Promise.resolve(profileActions[key]()).catch((e) => { fail(e); syncTop(); renderPanel(); }) }, t("prof.nav." + key));
    const dots = `conic-gradient(${P.categories.map((c, i) => `${c.color} ${(i * 100) / P.categories.length}% ${((i + 1) * 100) / P.categories.length}%`).join(",")})`;
    const icon = { brand: el("span", { class: "dots", style: `background:${dots}` }), sizes: ico("sizes", 18), ai: ico("spark", 18) };
    $("setclose").title = t("set.close"); $("setclose").setAttribute("aria-label", t("set.close"));
    $("setnav").replaceChildren(el("div", { class: "cap" }, t("set.title")),
      el("div", { class: "who" }, el("span", { class: "av", style: `background:${cat().color};color:${inkOn(cat().color)}` }, [...(P.name || "?").trim()][0] || "?"),
        el("span", {}, el("b", {}, P.name), el("small", {}, counted("set.profileSub", P.categories.length)))),
      ...Object.keys(TABS.setup).map((k) => el("button", { class: "sni" + (k === S.tab.setup ? " on" : ""), onclick: () => { S.tab.setup = k; syncTabs(); renderPanel(); $("setpanel").scrollTop = 0; } }, icon[k], t("tab." + k), k === "ai" && AI_SHOW.nav())),
      el("div", { class: "grow" }),
      el("div", { class: "cap" }, t("set.thisProfile")),
      el("div", { class: "pacts" }, act("new"), act("duplicate"), act("import"), act("export")), act("delete"));
    return;
  }
  const shown = (k) => k === S.tab.edit && !sheetHidden();
  $("dock").replaceChildren(...Object.keys(TABS.edit).map((k) => el("button", { class: shown(k) ? "on" : "", "aria-pressed": String(shown(k)), onclick: () => showSheet(k) }, ico(k, 22), t("dock." + k))),
    el("button", { class: "help", title: t("cover.how"), "aria-label": t("cover.howShort"), onclick: (e) => showTip(e.currentTarget, t("cover.how")) }, ico("help", 20)));
}
/** Shows sheet `k` in the left column, the drawer shut where it had taken the sheet's place. */
function showSheet(k) {
  const fromDock = $("dock").contains(document.activeElement);
  S.tab.edit = k;
  if (sheetHidden()) setDrawer(false);   // which draws the sheet as it comes back (columns())
  else { syncTabs(); renderPanel(); }
  $("panel").scrollTop = 0;
  const b = fromDock && $("dock").querySelector("button.on");   // the dock drawn anew: the key's place kept on the button pressed
  if (b) b.focus({ preventScroll: true });
}
/** Makes the profile's look current, for anything drawn outside a cover (asset tiles, previews). */
const useLook = () => setLook(S.profile.style.look, S.profile.style.lookParams[S.profile.style.look], S.profile.style.lookSeed, !!recordOf(mainPhoto()) || S.profile.style.theme !== "light");
/** Ink that reads on the channel colour: dark on a light one, white on a dark one (the Export button, the sheet's accents). */
const inkOn = (hex) => { const [r, g, b] = hexToRgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#15151c" : "#ffffff"; };
let COMPOSING = null;   // the field an input method is putting a word together in (see renderPanel); none once the word is done or the field left
addEventListener("compositionstart", (e) => { COMPOSING = e.target; }, true);
addEventListener("compositionend", () => { COMPOSING = null; }, true);
addEventListener("focusout", (e) => { if (e.target === COMPOSING) COMPOSING = null; }, true);
// the control the keyboard brought the focus to (Tab, arrows), known as the focus comes: a click's focus is not it (see the keydown listener's Space)
let KEYFOCUS = null;
addEventListener("focusin", (e) => { KEYFOCUS = e.target instanceof Element && e.target.matches(":focus-visible") ? e.target : null; }, true);
addEventListener("pointerdown", () => { KEYFOCUS = null; }, true);
function renderPanel() {
  if (!S.cover) return;
  if (COMPOSING && COMPOSING === document.activeElement && $(S.mode === "setup" ? "setpanel" : "panel").contains(COMPOSING)) return later("panel-ime", 150, renderPanel);   // an input method mid-word in it: once the word is done
  endPreview("look", "layout");   // their cards drawn anew
  useLook();
  const panel = $(S.mode === "setup" ? "setpanel" : "panel"), y = panel.scrollTop, held = heldField(panel);
  document.documentElement.style.setProperty("--acc", cat().color);
  document.documentElement.style.setProperty("--acc-ink", inkOn(cat().color));
  panel.replaceChildren(...TABS[S.mode][S.tab[S.mode]]().flat(Infinity).filter(Boolean));
  giveBack(panel, held);   // a field being typed in (the Assets sheet's search) keeps its focus and caret
  panel.scrollTop = y;
  if (S.mode === "setup") syncTabs();   // the nav's profile: its name, channels and colours, as the page now has them
  const at = S.mode === "setup" && SET_UI.at && document.getElementById("set-" + SET_UI.at);   // a card of the page asked for (see SET_UI)
  if (at) { SET_UI.at = ""; at.scrollIntoView({ block: "start" }); }
  placeFrames();   // the layout's parts framed with the Layout sheet shown, and no longer with another
}

function welcome() {
  return new Promise((resolve) => {
    const modal = $("modal"), name = textInput("", () => null, { placeholder: t("welcome.namePh") });
    const go = (sample) => { closeModal(); resolve(sample ? sampleProfile(getLang()) : starterProfile(getLang(), name.value.trim())); };
    modal.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("welcome.title")), el("div", {}, t("welcome.body")),
      el("div", {}, cap("welcome.brand"), name),
      el("button", { class: "btn solid wide", onclick: () => go(false) }, t("welcome.starter")),
      el("button", { class: "btn wide", onclick: () => go(true) }, t("welcome.sample"))));
    modal.dataset.sticky = "1";   // there is no profile yet: one of the two must be chosen
    modal.hidden = false;
    name.focus();
  });
}

// ---------- the side columns: their inner edges are dragged to make them wider or narrower
/**
 * The arrangement the screen calls for, on the body as `data-layout`: "desk", the columns side by side, or "phone", a narrow
 * touch screen, which is to have an arrangement of its own (its styles go under body[data-layout="phone"]). It goes
 * by the screen, not by the host: a phone opening a SmedCover server's page, or an app on a phone, alike. `?layout=`
 * phone or desk in the page's address chooses one, to work on it at a desk.
 */
const PHONE = matchMedia("(max-width: 760px) and (pointer: coarse)"), FORCED = new URLSearchParams(location.search).get("layout");
const layoutKind = () => (FORCED === "phone" || FORCED === "desk" ? FORCED : PHONE.matches ? "phone" : "desk");
function arrange() { document.body.dataset.layout = layoutKind(); }
PHONE.addEventListener("change", () => { arrange(); if (S.profile) columns(); });
arrange();
/** A side column's least width and its width at first, in px (ui.columns in defaults.json): left and right while editing, left in Setup. */
const column = (k) => { const c = DEFAULTS.ui.columns[k], min = clamp(c.min, 160, 900); return { min, def: clamp(c.width, min, 900) }; };
const centreMin = () => clamp(DEFAULTS.ui.centreMin, 0, 2000);   // what the canvas keeps at the least
const centreRoomy = () => clamp(DEFAULTS.ui.centreRoomy, 0, 4000);   // less, with the drawer open and the sheet and the drawer as wide as they are at first, and the drawer takes the sheet's place
const STACKED = matchMedia("(max-width: 1000px)");   // the window too narrow for columns: everything one under another (index.html)
const sheetHidden = () => $("body").classList.contains("tight");   // the drawer in the sheet's place (columns())
/** Sets the columns' widths from the settings (0 = default), each kept between its least and what leaves the canvas room. */
function columns() {
  const b = $("body"), open = !!S.settings.drawer, w = innerWidth - (open ? 136 : 124), c = S.settings.columns;   // 136: the dock (76), the three gaps between the columns (two with the drawer shut; with it in the sheet's place too, the drawer then 12 short of its most) and the page's margins
  const fit = (k, other) => { const C = column(k); return Math.round(clamp(c[k] || C.def, C.min, Math.max(C.min, w - centreMin() - other))); };
  const left = fit("left", open ? c.right || column("right").def : 0), was = sheetHidden();
  // by the window's width alone (the columns at their widths at first), so that a column's edge dragged never hides the sheet: a canvas left narrower by a hand is the hand's
  const tight = open && !STACKED.matches && w - column("left").def - column("right").def < centreRoomy();
  const right = tight ? fit("right", 0) : fit("right", left);
  b.classList.toggle("nodrawer", !open); b.classList.toggle("tight", tight);
  b.style.setProperty("--lw", left + "px"); b.style.setProperty("--rw", right + "px"); b.style.setProperty("--sw", fit("setup", 0) + "px");
  if (tight !== was && S.mode === "edit" && S.cover) { syncTabs(); if (!tight) renderPanel(); }   // the sheet back: drawn as things now are
  for (const id of ["letterwin", "cropwin", "weavewin", "brushwin"]) {   // the windows over the column, where it now is; the crop's picture drawn to its new width once it settles
    const win = $(id), was = win && win.style.width;
    if (win && !win.hidden) { overLeft(win); if (id === "cropwin" && win.style.width !== was) later("cropfit", 150, () => cropShow(true)); }
  }
  for (const h of document.querySelectorAll(".split")) h.title = t("ui.split");
}
addEventListener("resize", () => S.profile && columns());
for (const [side, id] of [["left", "left"], ["right", "right"]]) {
  const handle = el("div", { class: "split" });
  $(id).append(handle);
  handle.addEventListener("dblclick", () => { S.settings.columns[S.mode === "setup" && side === "left" ? "setup" : side] = 0; persistSettings(); columns(); });
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); handle.setPointerCapture(e.pointerId); handle.classList.add("on");
    const key = S.mode === "setup" && side === "left" ? "setup" : side, aside = $(id).getBoundingClientRect();
    handle.onpointermove = (m) => { S.settings.columns[key] = Math.round(side === "left" ? m.clientX - aside.left : aside.right - m.clientX); columns(); };
    handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; handle.classList.remove("on"); const wd = Math.round($(id).getBoundingClientRect().width); if (wd) S.settings.columns[key] = wd; persistSettings(); columns(); };
  });
}

// ---------- window-level events
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
// (with AI generate open, a picture is its reference instead: its drop zone lights up, body.gdrop)
addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add(genOpen() ? "gdrop" : "drop"); });
addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drop", "gdrop"); } });
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("drop", "gdrop");
  if (genOpen()) return genDropped(e.dataTransfer.files);
  if (SURPRISE.busy) return;   // hands are being dealt onto the cover
  // dropped photos become photo layers: the first of a cover fills it; the others land where they were dropped
  const cv = $("cv"), b = cv.getBoundingClientRect(), over = S.mode === "edit" && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const at = over ? { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) } : null;
  for (const f of [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/"))) await addPhoto(await readAs(f, "readAsDataURL"), at, f.name.replace(/\.[^.]+$/, ""));
});
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  // the app's own shortcuts (⌘E, ⌘S, ⌘O): ⌘ on a Mac, where Control and a letter move the caret in a field; Ctrl elsewhere
  const cmd = (MOD_KEY === "⌘" ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey;
  const a = document.activeElement, typing = /^(INPUT|TEXTAREA|SELECT)$/.test(a && a.tagName);
  if (cmd && (key === "s" || key === "o")) e.preventDefault();   // never the browser's own Save or Open, wherever they do nothing here
  if (key === "escape" && MENU.open) return closeMenu();
  const m = $("modal");   // a dialog open: Escape is its cancel (but in a text being typed), and no key reaches what lies under it
  if (!m.hidden) {
    if (cmd && key === "e" && m.querySelector(":scope > .dlg.xp")) { e.preventDefault(); if (!e.repeat) exportTicked(); return; }   // the Export window: its sizes ticked, even from its file name; a key held is one press
    if (key === "escape" && !m.dataset.sticky && !(typing && !/^(range|checkbox|radio)$/.test(a.type))) (m.onDismiss || closeModal)();
    return;
  }
  // a project file, from the editor, Surprise me's window not over it: ⌘S even while typing in a field (what is typed is on the cover already)
  const projKey = cmd && (key === "s" || (key === "o" && !typing));
  if (projKey && CAN_PROJECT && S.mode === "edit" && S.cover && !SURPRISE.busy && !($("deal") && !$("deal").hidden)) { if (e.repeat) return; closeMenu(); return (key === "s" ? projectActions.save() : projectActions.open()).catch(fail); }
  if (key === "escape" && S.mode === "setup" && !(typing && !/^(range|checkbox|radio|select-one)$/.test(a.type))) return setMode("edit");
  if (key === "escape" && FTB.pop) { FTB.pop = ""; return renderBar(); }   // the bar's popover first
  if (typing) return;
  if (key === " " && a && a === KEYFOCUS && a.matches("button,[role=button],[role=checkbox],[role=switch],[role=slider],[role=separator],[role=tab],summary,a[href]")) return;   // the keyboard brought to a control: Space is its own
  if (!S.cover || SURPRISE.busy) return;
  if ($("deal") && !$("deal").hidden) {   // Surprise me's window over the cover: Esc undoes the deal, Space deals again, undo and redo work, no other key reaches the cover
    if (key === "escape") return dealUndo();
    if (key === " " && !mod && !e.altKey) { e.preventDefault(); if (!e.repeat) surprise(e); return; }   // not the button with the focus pressed as well
    if (mod && key === "z") { e.preventDefault(); return timeTravel(e.shiftKey ? 1 : -1); }
    return;
  }
  if (key === "escape" && S.letterWin) return lettersClose();
  if (key === "escape" && S.cropWin) return cropClose();
  if ((key === "delete" || key === "backspace") && S.cropWin && S.mode === "edit" && cropDropPoint()) return e.preventDefault();   // a free crop's corner picked, not the layer
  if (key === "escape" && S.weaveWin) return weaveClose();
  if (S.brushWin && S.mode === "edit") {   // painting with the weave's brush: Esc leaves it, undo and redo go a stroke at a time, no other key acts
    if (key === "escape") return brushClose();
    if (mod && key === "z" && !BRUSH.stroke) { e.preventDefault(); return timeTravel(e.shiftKey ? 1 : -1); }
    return;
  }
  if (mod && key === "z") { e.preventDefault(); return timeTravel(e.shiftKey ? 1 : -1); }
  // Space deals, as Surprise me's button does, with the editor in front: not in the 3D view, nor while something is dragged
  // on the canvas or a window stands over the sheet (the menu, the letter, crop and weave windows); not the button with
  // the focus pressed as well
  if (key === " " && !mod && !e.altKey && S.mode === "edit" && !MENU.open && !FTB.pop && !V3.on && !LIVE && !FTB.drag && !S.letterWin && !S.cropWin && !S.weaveWin) { e.preventDefault(); if (!e.repeat) surprise(e); return; }
  if (S.mode !== "edit") return;
  if (cmd && key === "e") { e.preventDefault(); if (e.repeat) return; closeMenu(); return exportDialog(); }
  const L = layer();
  if (mod && key === "d") { e.preventDefault(); return group().length ? null : duplicateLayer(); }
  if (key === "escape") return V3.to ? set3d(false) : S.focus ? setFocus(false) : selectNothing();
  if (key === "f" && !mod && !e.altKey) { e.preventDefault(); return setFocus(!S.focus); }
  if (FTB.away && FTB.away === S.layerId) return;   // nothing selected (a press beside the cover, or Esc): nothing to nudge or remove
  const many = group(), step0 = e.shiftKey ? 10 : 1, nudge = { arrowleft: [-step0, 0], arrowright: [step0, 0], arrowup: [0, -step0], arrowdown: [0, step0] }[key];
  if (many.length) {   // a group: delete and the arrows act on all of it
    if (key === "delete" || key === "backspace") { e.preventDefault(); return removeGroup(); }
    if (nudge) { e.preventDefault(); editAll(movers(many), { ddx: nudge[0], ddy: nudge[1] }); }
    return;
  }
  if (!L) return;
  if (key === "delete" || key === "backspace") { e.preventDefault(); return removeLayer(); }
  const step = e.shiftKey ? 10 : 1, move = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
  if (move && !L.locked && !FIXED.includes(L.type)) { e.preventDefault(); edit(L, { ddx: move[0], ddy: move[1] }); later("side", 250, renderSide); }
});

// ---------- start
onOutlines(() => { queueDraw(); later("lookcards", 300, refreshLookCards); });   // an outline that was sent for has arrived: draw again, this time with it
/**
 * What a failed read of something that, taken for not there, would be written over or cleared away stands for. A
 * file that is not there is no failure (it reads as null, a folder as []); where the data is on this computer (the
 * app's folder, this browser's storage) a failure is rare and lasting, and is taken for nothing stored, v. On a
 * server a read may fail for a moment (the network, the server starting again): the start stops instead, to be
 * tried again, and nothing is written over.
 */
const absent = (v) => (e) => { if (HOST === "server") throw e; return v; };
/**
 * custom.json, the user's own defaults, in the data folder (see defaults.js), laid over the app's before anything reads
 * them. Never written by the app: one that cannot be read is none. Returns what to tell the user of it once the window
 * is up — a file that is not JSON (the app's own defaults used), values it has that were let go — or null.
 */
async function customDefaults() {
  const text = await files.read("custom.json").catch(() => null);
  let raw = null;
  try { raw = text ? JSON.parse(text.replace(/^\uFEFF/, "")) : null; } catch (e) { layOver(null); return () => toast(t("msg.customBad", e.message)); }
  const left = layOver(raw);
  return left.length ? () => toast(counted("msg.customLeft", left.length, left.slice(0, 4).join(", ") + (left.length > 4 ? "…" : ""))) : null;
}
async function start() {
  const custom = await customDefaults();
  S.settings = normalizeSettings(await readJson("settings.json").catch(absent(null)));
  S.settings.scope = startScope();   // Applies to starts where the defaults say (All wide / square / tall), whatever it was at the close
  setGlass(glassOn());
  const probe = document.body.appendChild(el("div", { style: "position:absolute;top:-99px;width:60px;height:60px;overflow:scroll" }));
  document.documentElement.classList.toggle("bars", probe.offsetWidth > probe.clientWidth); probe.remove();   // scrollbars that take room: drawn thin (index.html)
  if (HOST === "tauri") ownTitleBar();
  setLang(S.settings.lang || detectLang());
  for (const name of await files.list("fonts").catch(() => [])) {   // nothing is written for a font missed
    if (name.endsWith(".font")) { const src = await files.read("fonts/" + name).catch(() => null); if (src) await registerFont(name.slice(0, -5), src); }
  }
  for (const a of await loadAssetRecords().catch(absent([]))) {
    let entry = null;
    if (a.spec) { const r = normalizeSpec(a.spec); if (r.spec) entry = putSpecAsset(a.id, a.name, r.spec); } else entry = await putUserAsset(a.id, a.name, a.src);
    if (entry && a.folder) entry.folder = a.folder;
  }
  S.assetFolders = normalizeFolders(await readJson("asset-folders.json").catch(absent(null)));
  S.ai = normalizeAi(await readJson("ai.json").catch(absent(null)));
  const rawImageAi = await readJson("image-ai.json").catch(absent(null));
  S.imageAi = normalizeImageAi(rawImageAi);
  await migrateStyles(rawImageAi);
  S.repaintStyles = await loadStyles();
  S.myStyles = await loadMyStyles();
  if ((S.imageAi.source.startsWith("preset:") && !builtIn()) || (S.imageAi.source.startsWith("my:") && !myStyle())) S.imageAi.source = "look";   // a style that is no longer there
  columns();
  await refreshCutModels();
  if (CAN.fonts) {
    const found = await invoke("list_system_fonts").catch(() => []);
    S.systemFonts = found.map((f) => f.name);
    for (const f of found) if (!f.cjk) S.latinFonts.add(f.name);
  }
  ransomFaces();
  S.profiles = await loadProfiles().catch(absent([]));
  const selftest = CAN.selftest ? await invoke("selftest_dir").catch(() => null) : null;
  if (!S.profiles.length) await addProfile(selftest ? sampleProfile("en") : await welcome(), false);
  S.profile = S.profiles.find((p) => p.id === S.settings.profileId) || S.profiles[0];
  S.settings.profileId = S.profile.id;   // written with the channel below, once the covers are read
  const library = await readJson("photo-library.json").catch(absent(null));
  S.library = normalizeLibrary(library);
  if (!library) await libraryFromFiles();
  S.covers = await loadCovers(S.profile);
  await migrateSession();
  const catId = channelOf(S.profile);
  S.settings.channels[S.profile.id] = catId; persistSettings();
  setCover(coverFor(catId));
  await loadPhotos(pidsOf(S.cover));
  persistCover();
  prunePhotos();
  await applyProfile();
  resetHistory();
  if (custom) custom();   // what was wrong with custom.json
  if (selftest) selfTest(selftest);
  else setTimeout(readLibrary, 1500);   // once the window is up: read the bitmap library in the background, ready for when it is opened
}
/**
 * Before each channel had a cover of its own the app kept one cover (session.json) for every channel of
 * whichever profile was current — and before that, its photo beside it (session-photo). That cover
 * becomes the current profile's channels' covers, each with the layers that were on it; the old file is
 * kept as session.migrated.json.
 */
async function migrateSession() {
  const raw = await readJson("session.json").catch(() => null);
  if (!raw || Object.keys(S.covers).length) return;
  let old = normalizeCover(raw, S.profile);
  if (!old.title) old.title = defaultTitle();
  await loadPhotos(pidsOf(old));
  const photo = (await files.read("session-photo").catch(absent(""))) || "";   // its files are removed below
  if (photo) {
    const read = (f) => files.read(f).catch(absent("")).then((v) => v || "");
    old = await upgradeCover(old, { src: photo, original: await read("session-photo-original"), mask: await read("session-photo-mask") });
    for (const pid of pidsOf(old)) await savePhoto(pid);
  } else old = await upgradeCover(old, null);
  for (const c of S.profile.categories) {
    const cover = channelCover(JSON.parse(JSON.stringify(old)), S.profile, c.id);
    S.covers[c.id] = cover;
    await writeJson(coverPath(S.profile.id, c.id), cover).catch(fail);
  }
  S.settings.channels[S.profile.id] = old.catId;
  await files.write("session.migrated.json", JSON.stringify(raw)).catch(fail);
  await files.remove("session.json").catch(() => null);
  for (const f of ["session-photo", "session-photo-original", "session-photo-mask"]) await files.remove(f).catch(() => null);
}

// ---------- the bitmap library: every picture uploaded, made by AI or repainted, kept for use again
// photo-library.json lists them, newest first: [{pid, name, kind: "upload" | "ai" | "repaint", at}]; the
// pictures are in the photo store's files. Shared by every profile and channel.
const LIBRARY_KINDS = ["upload", "ai", "repaint"];
function normalizeLibrary(raw) {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).filter((e) => e && typeof e.pid === "string" && /^[\w-]{1,40}$/.test(e.pid) && !seen.has(e.pid) && seen.add(e.pid))
    .map((e) => ({ pid: e.pid, name: typeof e.name === "string" ? e.name.slice(0, 60) : "", kind: LIBRARY_KINDS.includes(e.kind) ? e.kind : "upload", at: Number(e.at) || 0 }));
}
const persistLibrary = () => later("library", 400, () => writeJson("photo-library.json", S.library).catch(fail));
/** Adds a picture of the photo store to the library (once). */
function keepPicture(pid, name, kind) {
  if (!pid || S.library.some((e) => e.pid === pid)) return;
  S.library.unshift({ pid, name: String(name || "").slice(0, 60), kind, at: Date.now() });
  persistLibrary();
  if (onAssetsTab()) renderPanel();
}
/** The first time the library is opened: the pictures already there (uploaded before it existed) go in it. */
async function libraryFromFiles() {
  const pids = [...new Set((await files.list("photos").catch(absent([]))).map((f) => f.replace(/\.(original|mask)$/, "")))];
  S.library = pids.map((pid) => ({ pid, name: "", kind: "upload", at: 0 }));
  persistLibrary();
}
/** Takes a picture out of the library; covers that use it keep it. */
function dropPicture(pid) {
  S.library = S.library.filter((e) => e.pid !== pid); persistLibrary();
  toast(t("lib.removed")); renderPanel();
}
const LIB = { tried: new Set(), redraw: null, soon: 0 };   // pictures already asked for; how to redraw the view of the library open now
/**
 * Reads the library's pictures not read yet, the view of it that is open redrawn as they come in (at
 * most every 150 ms), so the first ones show while the rest are still being read. Run once shortly
 * after start-up too, so the library is usually ready before it is first opened.
 */
function readLibrary() {
  const todo = S.library.filter((e) => !S.photos.has(e.pid) && !LIB.tried.has(e.pid));
  if (!todo.length) return;
  for (const e of todo) LIB.tried.add(e.pid);
  const show = () => { if (!LIB.soon) LIB.soon = setTimeout(() => { LIB.soon = 0; if (LIB.redraw) LIB.redraw(); }, 150); };
  loadPhotos(todo.map((e) => e.pid), show).then((missing) => {
    if (missing.length) { S.library = S.library.filter((e) => !missing.includes(e.pid)); persistLibrary(); }   // their files are gone
    // could not be read just now: asked for again when the library is next drawn after a pause (drawing it asks at once)
    const again = todo.filter((e) => !S.photos.has(e.pid) && !missing.includes(e.pid)).map((e) => e.pid);
    if (again.length) setTimeout(() => { for (const pid of again) LIB.tried.delete(pid); }, 15000);
    show();
  });
}
/** Assets → Bitmaps: the library's pictures, to click or drag onto the cover. */
/**
 * The library's pictures as tiles, newest first: a click hands the picture to `pick`; they can be dragged
 * onto the canvas, and with `removable` taken out of the library. Pictures not read yet are read, then
 * `redraw` is called. With `only`, the pictures it keeps alone (the search, a kind of picture).
 */
function libraryTiles(pick, redraw, removable = false, only = null) {
  LIB.redraw = redraw;
  readLibrary();
  const list = only ? S.library.filter(only) : S.library;
  const shown = list.filter((e) => S.photos.has(e.pid)), waiting = list.some((e) => !S.photos.has(e.pid));
  return shown.length ? el("div", { class: "tiles" }, shown.map((e) => {
    const rec = S.photos.get(e.pid), name = e.name || t("lib.kind." + e.kind);
    return el("div", { class: "tile ptile", title: `${name} · ${t("lib.kind." + e.kind)}`, draggable: true, onclick: () => pick(e.pid),
      ondragstart: (ev) => { ev.dataTransfer.setData("application/x-smed-photo", e.pid); ev.dataTransfer.effectAllowed = "copy"; } },
      el("img", { src: thumbOf(rec), alt: "", draggable: false }), el("span", { class: "kind" }, t("lib.kind." + e.kind)),
      removable && el("button", { class: "x", title: t("lib.remove"), onclick: (ev) => { ev.stopPropagation(); dropPicture(e.pid); } }, "×"));
  })) : el("div", { class: "hint" }, t(waiting ? "lib.loading" : "lib.empty"));
}

/** The looks the self-test goes through: those named in SMEDCOVER_SELFTEST_LOOKS (the new ones, say), or all of them. */
async function testedLooks() {
  const named = await invoke("selftest_looks").catch(() => null), want = named ? named.split(",").map((x) => x.trim()) : null;
  return want ? LOOK_IDS.filter((k) => want.includes(k)) : LOOK_IDS;
}
/** SMEDCOVER_SELFTEST mode: export real covers in every format through the normal path, report, quit. */
let SELFTESTING = false;   // the self-test running: its requests and cut-outs leave the AI lights alone (aiTracked)
async function selfTest(dir) {
  SELFTESTING = true;
  if (await invoke("selftest_drag").catch(() => false)) return dragTest().catch((e) => invoke("selftest_done", { report: JSON.stringify({ error: String((e && e.stack) || e) }) }));
  const report = { ok: false, files: [], errors: [] }, looks = await testedLooks();
  report.lookIds = looks.length === LOOK_IDS.length ? "all" : looks;
  // Each step is noted in selftest-progress.txt (in the data folder) as it starts, so a run that stalls
  // (every process idle, the web view waiting on something that never returns) shows where.
  const steps = [], step = (s) => { steps.push(`${Math.round(performance.now())} ${s}`); return files.write("selftest-progress.txt", steps.join("\n")).catch(() => null); };
  const cjk = (f) => S.systemFonts.includes(f) ? !S.latinFonts.has(f) : null;   // which installed fonts can set Chinese
  report.fonts = { system: S.systemFonts.length, latin: [...S.latinFonts].filter((f) => S.systemFonts.includes(f)).length, cjk: Object.fromEntries(["PingFang SC", "Songti SC", "Helvetica", "Cochin", "BM Hanna Pro", "Menlo"].map((f) => [f, cjk(f)])) };
  try {
    const aiUrl = await invoke("selftest_ai").catch(() => null);
    if (aiUrl) {   // both API styles against a stand-in endpoint: request, reply, validation, storage, drawing
      report.ai = [];
      for (const style of AI_STYLES) {
        const cfg = normalizeAi({ style, baseUrl: aiUrl + (style === "openai" ? "/v1" : ""), token: "selftest-token", model: "selftest-model" });
        const spec = await requestSpec({ ...cfg, kind: style === "openai" ? "solid" : "flat" }, "a star");
        const a = putSpecAsset("a" + uid(), spec.name.en, spec);
        await saveAssetRecord(a);
        addAsset({ kind: "user", id: a.id });
        const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
        report.ai.push({ style, name: a.name, kind: spec.kind || "flat", pieces: (spec.ops || spec.parts).length, stored: !!(await readJson(`assets/${a.id}.json`))?.spec, drawn: cv._hits.some((h) => h.id === S.layerId) });
      }
      // the same again with a reference picture attached (a small generated one)
      const pic = document.createElement("canvas"); pic.width = pic.height = 64;
      const px = pic.getContext("2d"); px.fillStyle = "#3a86ff"; px.fillRect(0, 0, 64, 64); px.fillStyle = "#ffd60a"; px.beginPath(); px.arc(32, 32, 20, 0, 7); px.fill();
      const url = pic.toDataURL("image/jpeg", 0.8), image = { mime: "image/jpeg", data: url.slice(url.indexOf(",") + 1) };
      report.aiImage = [];
      for (const style of AI_STYLES) {
        const cfg = normalizeAi({ style, baseUrl: aiUrl + (style === "openai" ? "/v1" : ""), token: "selftest-token", model: "selftest-model" });
        const spec = await requestSpec(cfg, "", () => null, () => true, image);
        report.aiImage.push({ style, name: spec.name.en, bytes: image.data.length });
      }
      // repainting a photo through each image service's own form (one of them answering with a link)
      // the subject cut-out on a real photo, when one is given (SMEDCOVER_SELFTEST_PHOTO)
      const real = await invoke("selftest_photo").catch(() => null);
      if (real) {
        const keep = JSON.stringify(S.cover), t0 = performance.now();
        S.cover.layers = S.cover.layers.filter((l) => l.type !== "photo");   // so the photo added is the cover's first, and fills it
        const main = await addPhoto(real), filled = !!main && main.fill && S.cover.layers.indexOf(main) === 1;
        const front = await cutOut(main), ok = !!front, rec = recordOf(main), m = rec && rec.mask && rec.mask.img;
        const at = (id) => S.cover.layers.findIndex((l) => l.id === id);
        report.subject = { filled, kept: S.cover.layers.includes(main) && !main.cut, linked: !!front && front.of === main.id, selected: !!front && S.layerId === front.id, ok, ms: Math.round(performance.now() - t0), photo: sizeOf(rec.img), mask: m ? sizeOf(m) : null, aboveTitle: !!front && at(front.id) === at("title") + 1, error: CUT.error };
        if (ok) {
          front.outline = 8; front.shadow = 0.6; main.blur = 12;
          S.cover.title = "*Subject* in front\nof the title";
          // a second photo, as a print: turned, outlined, and one more with its background removed and soft edges
          const print = newLayer("photo", { pid: main.pid, outline: 10, shadow: 0.7 }); print.t.all = { ...print.t.all, x: 0.78, y: 0.3, s: 0.32, r: -8 };
          const sticker = newLayer("photo", { pid: main.pid, cut: true, outline: 6, feather: 6, spread: 14 }); sticker.t.all = { ...sticker.t.all, x: 0.86, y: 0.72, s: 0.4, r: 6 };
          S.cover.layers.splice(at("frame"), 0, print, sticker);
          for (const look of ["cel", "cyber"]) {
            S.profile.style.look = look;
            const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
            report.subject[look] = await invoke("write_image", framed(await toPng(cv), { dir, name: `subject-${look}.png` }));
          }
          S.profile.style.look = "cel";
          // an earlier cover with its photo kept beside it, and a subject layer: read as photo layers
          const old = normalizeCover({ catId: S.cover.catId, layers: [...JSON.parse(JSON.stringify(normalizeCover({}, S.profile).layers)), { type: "subject", outline: 5 }] }, S.profile);
          old.layers.find((l) => l.id === "bg").blur = 7;
          const up = await upgradeCover(old, { src: real, mask: rec.mask.src });
          const fill = up.layers.find((l) => l.type === "photo" && l.fill), copy = up.layers.find((l) => l.type === "photo" && l.of);
          report.upgrade = { fill: !!fill && fill.blur === 7 && up.layers.indexOf(fill) === 1, copy: !!copy && copy.of === fill.id && copy.cut && copy.outline === 5, subjectLeft: up.layers.some((l) => l.type === "subject") };
        }
        // the same photo cut out by BiRefNet, when a folder of downloaded models is given (SMEDCOVER_SELFTEST_MODELS)
        if (await invoke("selftest_models").catch(() => false)) {
          await refreshCutModels();
          const was = S.settings.cutEngine; S.settings.cutEngine = "birefnet-lite";
          setCover(normalizeCover(JSON.parse(keep), S.profile));
          S.cover.layers = S.cover.layers.filter((l) => l.type !== "photo");
          const p = await addPhoto(real), t1 = performance.now(), cut = await cutOut(p), r = recordOf(p);
          report.birefnet = { ok: !!cut, ms: Math.round(performance.now() - t1), mask: r && r.mask ? sizeOf(r.mask.img) : null, error: CUT.error };
          if (cut) { cut.outline = 8; p.blur = 10; S.cover.title = "*BiRefNet* cut-out\nin front"; report.birefnet.path = await invoke("write_image", framed(await toPng(renderFull(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "subject-birefnet.png" })); }
          S.settings.cutEngine = was;
        }
        setCover(normalizeCover(JSON.parse(keep), S.profile));
      }
      report.repaint = [];
      // a style of the user's own goes to a file and comes back the same
      await files.write("repaint-styles/selftest.md", writeStyle({ name: "自测 Self test", order: 5 }, "<!-- note -->\nPaint it."));
      const own = (await loadMyStyles()).find((x) => x.id === "selftest");
      report.myStyle = own ? { name: own.name.zh, prompt: own.prompt, order: own.order } : null;
      await files.remove("repaint-styles/selftest.md");
      report.repaintStyles = await Promise.all(S.repaintStyles.map(async (st) => ({ id: st.id, chars: (await styleText(st)).length })));   // every built-in style can be read from the bundle
      const photo = shrink(pic, 64);
      for (const [provider, base, model] of [["openai", "/v1", "gpt-image-2"], ["gemini", "/v1beta", "m"], ["seedream", "/api/v3", "m"], ["seedream", "/api/v3", "url"]]) {
        const cfg = normalizeImageAi({ provider, baseUrl: aiUrl + base, token: "selftest-token", model });
        const out = await imageCall(cfg, provider === "gemini" ? repaintPrompt({ source: "text", text: await styleText(S.repaintStyles[0]) }) : repaintPrompt({ source: "look", look: "cyber" }), photo);
        report.repaint.push({ provider, model, w: out.w, h: out.h });
      }
      // a new photo from words alone, and from words and a reference picture, in the shape of the canvas
      report.generate = [];
      for (const [provider, base] of [["openai", "/v1"], ["gemini", "/v1beta"], ["seedream", "/api/v3"]]) for (const ref of [null, photo]) {
        const out = await imageCall(normalizeImageAi({ provider, baseUrl: aiUrl + base, token: "t", model: "m" }), generatePrompt({ text: "a lighthouse at dusk", reference: !!ref }), ref, { w: 1280, h: 720 });
        report.generate.push({ provider, reference: !!ref, w: out.w, h: out.h });
      }
      // a model that refuses an optional setting: asked again without it
      const strict = await imageCall(normalizeImageAi({ provider: "seedream", baseUrl: aiUrl + "/api/v3", token: "t", model: "strict" }), "p", photo);
      report.repaint.push({ provider: "seedream", model: "strict", w: strict.w, h: strict.h });
      // the connection check of each service, which makes no picture
      report.imageCheck = [];
      for (const [provider, base] of [["openai", "/v1"], ["gemini", "/v1beta"], ["seedream", "/api/v3"]]) {
        const r = await checkImageAi(normalizeImageAi({ provider, baseUrl: aiUrl + base, token: "t", model: "m" }));
        report.imageCheck.push({ provider, ok: r.ok, text: r.text });
      }
      try { await aiCall(normalizeAi({ style: "openai", baseUrl: aiUrl + "/fail", model: "m" }), "s", "u"); report.errors.push("ai: an error reply was not reported"); }
      catch (e) { report.aiError = String(e.message); }
    }
    // each channel's cover is its own: what is set on one stays there, and comes back when it is shown again
    {
      const [a, b] = S.profile.categories.map((c) => c.id), home = S.cover.catId;
      if (b) {
        await switchChannel(a); S.cover.title = "Channel A"; S.cover.tag = "A"; S.cover.layers.push(newLayer("text", { text: "only on A" }));
        await switchChannel(b); const fresh = S.cover.title !== "Channel A" && !S.cover.layers.some((l) => l.text === "only on A");
        S.cover.title = "Channel B";
        await switchChannel(a); const kept = S.cover.title === "Channel A" && S.cover.tag === "A" && S.cover.layers.some((l) => l.text === "only on A");
        await new Promise((r) => setTimeout(r, 600));   // the debounced writes
        const onDisk = (await readJson(coverPath(S.profile.id, b)))?.title === "Channel B";
        report.channels = { fresh, kept, onDisk };
        if (!(fresh && kept && onDisk)) report.errors.push("covers: channels are not independent");
        S.cover.layers = S.cover.layers.filter((l) => l.text !== "only on A");
        await switchChannel(home);
      }
    }
    S.cover.title = "Self test\n*binary* export"; S.cover.tag = "EP.01";
    for (const format of ["png", "jpeg", "webp"]) {
      S.settings.format = format; await step(`export ${format}`);
      const t0 = performance.now();
      const jobs = S.profile.sizes.slice(0, 2).map((size) => ({ cover: S.cover, index: catIndex(), size }));
      const n = await runExport(jobs, async (bytes, name) => { report.files.push({ path: await invoke("write_image", framed(bytes, { dir, name })), pngBytes: bytes.length }); });
      report[format + "_ms"] = Math.round(performance.now() - t0);
      if (n !== jobs.length) report.errors.push(`${format}: ${n}/${jobs.length} — ${$("toast").textContent}`);
    }
    // one cover in every other look (or in each look named for the test), so each is exercised in the real web view
    S.settings.format = "png"; report.looks = [];
    const keepLayers = JSON.stringify(S.cover.layers), snap = document.createElement("canvas");   // a stand-in photograph: colours, light and dark, some detail
    snap.width = 1200; snap.height = 800;
    const sx = snap.getContext("2d"), sky = sx.createLinearGradient(0, 0, 1200, 800);
    sky.addColorStop(0, "#f2b45a"); sky.addColorStop(0.5, "#d9486e"); sky.addColorStop(1, "#1f4fa8");
    sx.fillStyle = sky; sx.fillRect(0, 0, 1200, 800);
    for (let k = 0; k < 14; k++) { sx.fillStyle = ["#fff7d6", "#1b1b2a", "#2dd4a4"][k % 3]; sx.fillRect(40 + k * 82, 300 + ((k * 137) % 260), 56, 500); }
    const shot = await putPhoto(snap.toDataURL("image/jpeg", 0.9));
    const plain = S.cover.layers.filter((l) => !fillsCanvas(l)), withShot = [plain[0], newLayer("photo", { pid: shot, fill: true }), ...plain.slice(1)];
    for (const id of looks.filter((k) => k !== "cel")) for (const withPhoto of [false, true]) {
      S.profile.style.look = id; S.cover.layers = withPhoto ? withShot : plain;
      const name = `look-${id}${withPhoto ? "-photo" : ""}.png`;
      await step(`${name}: drawing`); const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
      await step(`${name}: encoding`); const png = await toPng(cv);
      await step(`${name}: writing`); report.looks.push({ id, photo: withPhoto, path: await invoke("write_image", framed(png, { dir, name })) });
    }
    // and each look with every setting at its far end, so every effect is drawn in the real web view
    const keepParams = JSON.stringify(S.profile.style.lookParams);
    for (const id of looks.filter((k) => LOOKS[k].params.length)) for (const withPhoto of [false, true]) {
      S.profile.style.look = id; S.cover.layers = withPhoto ? withShot : plain;
      S.profile.style.lookParams[id] = Object.fromEntries(LOOKS[id].params.map((d) => [d.key, d.text ? "AB" : d.max]));
      const name = `look-${id}-full${withPhoto ? "-photo" : ""}.png`;
      await step(`${name}: drawing`); const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
      await step(`${name}: encoding`); const png = await toPng(cv);
      await step(`${name}: writing`); report.looks.push({ id, full: true, photo: withPhoto, path: await invoke("write_image", framed(png, { dir, name })) });
    }
    S.profile.style.lookParams = JSON.parse(keepParams);
    S.profile.style.look = "cel"; S.cover.layers = JSON.parse(keepLayers);
    // every text effect once, in the house look: the ones that reshape letters need outlines from the native side
    report.effects = [];
    const titleLayer = layer("title"), keep = S.cover.title, ransomAway = ransomPending();   // the ransom note's faces still to be read from their files
    let ransomMs = 0;
    S.cover.title = "文字效果 *FX*\nText *effects*";
    for (const id of Object.keys(EFFECTS).filter((k) => k !== "auto")) {
      titleLayer.fx = id; await step(`fx-${id}`);
      const t0 = performance.now(), cv = await renderReady(S.profile.sizes[0], S.cover, catIndex());
      if (id === "ransom") ransomMs = Math.round(performance.now() - t0);   // its faces read from their files first
      report.effects.push({ id, kind: EFFECTS[id].kind, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `fx-${id}.png` })) });
    }
    // the ransom note: the faces found here, those read from their files first, and Reshuffle dealing other letters
    {
      const fxTitle = S.cover.title;
      titleLayer.fx = "ransom"; S.cover.title = "SPIDER *MAN*\npeter parker 你看着办";
      await step("fx-ransom-letters");
      const t0 = performance.now(), a = await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), ms = Math.round(performance.now() - t0);
      titleLayer.fxSeed = 777;
      const b = await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex()));
      const pools = ransomPools();
      report.ransom = { pools: { latin: pools.latin.map((f) => f.family), cjk: pools.cjk.map((f) => f.family) }, away: ransomAway, still: ransomPending(), firstMs: ransomMs, ms, reshuffled: a.length !== b.length || a.some((v, i) => v !== b[i]),
        paths: [await invoke("write_image", framed(a, { dir, name: "fx-ransom-letters.png" })), await invoke("write_image", framed(b, { dir, name: "fx-ransom-reshuffled.png" }))] };
      if (!report.ransom.reshuffled) report.errors.push("ransom: Reshuffle drew the same letters");
      report.ransom.unreached = ransomAway.filter((f) => !reachable(f));   // read from their files, every canvas has them now
      if (report.ransom.still.length || report.ransom.unreached.length) report.errors.push(`ransom: faces not to be had: ${[...report.ransom.still, ...report.ransom.unreached].join(", ")}`);
      // every kind, torn edges and tape, set by hand (letters cut from the photo, when the cover has one)
      titleLayer.letters = { "0|S|1": { kind: "deep" }, "0|P|1": { kind: "photo" }, "0|I|1": { kind: "tile", edge: "torn", tape: 1 }, "0|D|1": { kind: "cut" }, "0|E|1": { kind: "tile", edge: "torn" }, "0|M|1": { kind: "photo" }, "1|你|1": { kind: "photo" }, "1|看|1": { kind: "tile", edge: "torn", tape: 2 }, "1|着|1": { kind: "deep" } };
      const had = new Set(S.cover.layers.map((l) => l.id)), pic = await invoke("selftest_photo").catch(() => null);
      if (pic && !letterPhoto()) await addPhoto(pic);
      report.ransom.edited = { photo: letterPhoto(), path: await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "fx-ransom-edited.png" })) };
      S.cover.layers = S.cover.layers.filter((l) => had.has(l.id));   // the photo added goes again
      delete titleLayer.letters; delete titleLayer.fxSeed; S.cover.title = fxTitle;
    }
    // the reshaped edges: the same letters every time the cover is drawn, others after Reshuffle; spikes in a bend too
    {
      const fxTitle = S.cover.title, draw = async () => toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
      S.cover.title = "SPIKY *刺边*\nmelting 融化";
      report.shaped = [];
      for (const id of Object.keys(EFFECTS).filter((k) => EFFECTS[k].kind === "outline" && EFFECTS[k].seeded)) {
        titleLayer.fx = id; delete titleLayer.fxSeed; await step(`shaped-${id}`);
        const a = await draw(), again = await draw();
        titleLayer.fxSeed = 4242;
        const b = await draw(), got = { id, same: same(a, again), reshuffled: !same(a, b) };
        got.path = await invoke("write_image", framed(b, { dir, name: `shaped-${id}.png` }));
        report.shaped.push(got);
        if (!got.same) report.errors.push(`${id}: drawn twice, not the same`);
        if (!got.reshuffled) report.errors.push(`${id}: Reshuffle drew the same`);
      }
      Object.assign(titleLayer, { fx: "spiky", fxAmt: 1.8, bend: "arc" });
      report.shaped.push({ id: "spiky-bent", path: await invoke("write_image", framed(await draw(), { dir, name: "shaped-spiky-bent.png" })) });
      for (const k of ["fx", "fxAmt", "fxSeed", "bend"]) delete titleLayer[k];
      S.cover.title = fxTitle;
    }
    // a layout layer copied, in a lettering and a place of its own; a photo cropped, with a torn edge and a shadow, and one cropped free; a sticker cropped, and one cropped free
    {
      const had = new Set(S.cover.layers.map((l) => l.id)), cp = duplicate(titleLayer), pic = await invoke("selftest_photo").catch(() => null);
      Object.assign(cp, { fx: "puffy", ink: "#ff3366" }); cp.t.all.y += 0.38;
      insertAbove(S.cover.layers, "title", cp);
      const ph = pic ? newLayer("photo", { pid: await putPhoto(pic), crop: { x: 0.2, y: 0.1, w: 0.5, h: 0.6 }, outline: 12, torn: true, shadow: 0.5 }) : null;
      if (ph) { ph.t.all = { ...ph.t.all, x: 0.78, y: 0.42, s: 0.55 }; S.cover.layers.push(ph); }
      const pp = ph ? newLayer("photo", { pid: ph.pid, crop: normalizeCrop({ pts: [[0.3, 0.05], [0.85, 0.2], [0.6, 0.55], [0.75, 0.95], [0.2, 0.8]] }), outline: 10, torn: true, shadow: 0.6 }) : null;   // and one cropped free
      if (pp) { pp.t.all = { ...pp.t.all, x: 0.6, y: 0.7, s: 0.4 }; S.cover.layers.push(pp); }
      const sk = newLayer("asset", { ref: { kind: "sticker", id: "burst" }, tint: true, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } });
      sk.t.all = { ...sk.t.all, x: 0.2, y: 0.78, s: 0.45 }; S.cover.layers.push(sk);
      const fr = newLayer("asset", { ref: { kind: "sticker", id: "burst" }, tint: true, crop: normalizeCrop({ pts: [[0.5, 0], [1, 0.6], [0.7, 1], [0.1, 0.8]] }) });   // and one cropped free
      fr.t.all = { ...fr.t.all, x: 0.42, y: 0.78, s: 0.45 }; S.cover.layers.push(fr);
      await step("copies and crops");
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex()), ids = [cp.id, ph && ph.id, pp && pp.id, sk.id, fr.id].filter(Boolean);
      report.copies = { photo: !!ph, hits: ids.map((id) => !!cv._hits.find((h) => h.id === id)), path: await invoke("write_image", framed(await toPng(cv), { dir, name: "copy-crop.png" })) };
      if (report.copies.hits.some((h) => !h)) report.errors.push("copies and crops: a layer not caught on the canvas");
      S.cover.layers = S.cover.layers.filter((l) => had.has(l.id));
    }
    // weaving: the real photo's subject cut out and set over the title, its head in front of the lettering and its
    // body behind it; then every other letter in front, in the house lettering, in one lettered upright and in the
    // ransom note; each woven cover must differ from the unwoven one. The lettering half see-through, woven. By the
    // brush, a band along the title's second line in front, then up to the subject's middle behind again: each must
    // differ. A drag: the subject slid, the lettering let through where it is (as a still cover has it); the head
    // line's slider dragged, the frames following it; the title dragged over the subject with a look effect on it,
    // the effect not worked out again.
    {
      const pic = canCut() && (await invoke("selftest_photo").catch(() => null));
      if (pic) {
        await step("weave");
        const keep = JSON.stringify({ layers: S.cover.layers, title: S.cover.title }), keepSel = S.layerId, size = S.profile.sizes[0], [vw, vh] = virtualSize(size.w, size.h);
        S.cover.title = "WEAVE *穿插*\nIN FRONT 前后";
        S.cover.layers = S.cover.layers.filter((l) => l.type !== "photo");
        const ph = await addPhoto(pic), front = ph && (await cutOut(ph));
        report.weave = { cut: !!front, error: CUT.error };
        if (front) {
          ph.blur = 10; ph.dim = 0.3; front.outline = 6;
          // the subject twice the title's height, its head over the title's first line, a little right of its middle
          const hitsOf = () => renderFull(size, S.cover, catIndex())._hits;
          let hs = hitsOf(), T = hs.find((x) => x.id === "title"), F = hs.find((x) => x.id === front.id);
          front.t.all.s *= (T.hh * 2) / F.hh;
          hs = hitsOf(); T = hs.find((x) => x.id === "title"); F = hs.find((x) => x.id === front.id);
          front.t.all.x += (T.cx + T.hw * 0.15 - F.cx) / vw; front.t.all.y += (T.cy - T.hh - F.hh * 0.1 - (F.cy - F.hh)) / vh;
          const shot = async (name) => { const cv = await renderReady(size, S.cover, catIndex()); return { cv, path: await invoke("write_image", framed(await toPng(cv), { dir, name })) }; };
          /** How many pixels (every seventh) of two canvases of one size differ noticeably. */
          const apart = (a, b) => { const x = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, y = b.getContext("2d").getImageData(0, 0, b.width, b.height).data; let n = 0; for (let i = 0; i < x.length; i += 28) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 40) n++; return n; };
          const off = await shot("weave-off.png");
          front.weave = { with: ["title"], by: "head", line: 0.3, front: {} };
          const head = await shot("weave-head.png");
          const keys = parseTitle(S.cover.title).flatMap((runs, row) => { const cells = lineCells(runs); return keysOf(cells, row).filter((k, i) => !/^\s+$/.test(cells[i].ch)); });
          front.weave = { ...front.weave, by: "letters", front: { title: keys.filter((_, i) => i % 2 === 0) } };
          const letters = await shot("weave-letters.png");
          const title = layer("title");
          title.fx = "ransom"; delete front.weave;
          const ransomOff = await shot("weave-ransom-off.png");
          front.weave = { with: ["title"], by: "letters", line: 0.3, front: { title: keys.filter((_, i) => i % 2 === 0) } };
          const ransom = await shot("weave-ransom.png");
          title.fx = "bluenote"; delete front.weave;   // a lettering painted upright on the slanted line
          const uprightOff = await shot("weave-upright-off.png");
          front.weave = { with: ["title"], by: "letters", line: 0.3, front: { title: keys.filter((_, i) => i % 2 === 0) } };
          const upright = await shot("weave-upright.png");
          delete title.fx; front.weave.by = "head"; title.o = 0.5;
          const faint = await shot("weave-faint.png");
          title.o = 1;
          // the brush: a band painted in front along the title's second line, in the photo's own frame; then, up to the
          // middle of the subject, painted behind again
          const headWeave = front.weave, hb = hitsOf(), H = hb.find((x) => x.id === front.id), T2 = hb.find((x) => x.id === "title"), [pw, ph2] = sizeOf(recordOf(front).img);
          const y2 = T2.cy + T2.hh * 0.5, br = Math.round(((T2.hh * 0.4) / photoLong(H.pf, pw, ph2)) * 1e4) / 1e4, at = (x) => photoPoint(H.pf, x, y2).map((v) => Math.round(v * 1e4) / 1e4);
          front.weave = { ...headWeave, by: "brush", strokes: [{ front: true, r: br, pts: [at(T2.cx - T2.hw), at(T2.cx + T2.hw)] }] };
          const brush = await shot("weave-brush.png");
          front.weave.strokes.push({ front: false, r: Math.round(br * 1.2 * 1e4) / 1e4, pts: [at(T2.cx - T2.hw), at(H.cx)] });   // to the middle of the subject
          const brushErased = await shot("weave-brush-erased.png");
          front.weave = headWeave;
          const snap = (c) => { const x = Object.assign(document.createElement("canvas"), { width: c.width, height: c.height }); x.getContext("2d").drawImage(c, 0, 0); return x; };
          // a drag of the subject: the first frame keeps it to slide, the next slides it and lets the lettering through again
          const cv = document.createElement("canvas"), live = { ids: [front.id] }, frameAt = () => paint(cv, size, size.w * S.settings.scale, S.cover, catIndex(), null, live);
          frameAt(); front.t.all.x -= 0.05; frameAt();
          const dragged = { cv: snap(cv), path: await invoke("write_image", framed(await toPng(cv), { dir, name: "weave-drag.png" })) }, still = renderFull(size, S.cover, catIndex());
          // the head line's slider dragged (the subject repainted each step, its lettering kept): each step where it is set
          front.weave.line = 0.3; frameAt(); const line3 = snap(cv); front.weave.line = 0.7; frameAt();
          const lineMoved = apart(line3, cv), lineStill = (front.weave.line = 0.3, frameAt(), apart(line3, cv));
          // a look effect on the subject, the title dragged over it: the effect's image is kept, only let through anew
          const look = S.profile.style.look, e = effectsFor(look, "photo")[0];
          if (e) {
            front.lookFx = { [`${look}.${e.key}`]: 0.6 };
            Object.assign(FX_TIMING, { on: true, ms: {} }); renderFull(size, S.cover, catIndex()); const cold = Object.keys(FX_TIMING.ms).length;
            const tl = layer("title"), drag = { ids: ["title"] }, dc = document.createElement("canvas"), x0 = tl.t.all.x;
            FX_TIMING.ms = {};
            for (let n = 0; n < 4; n++) { tl.t.all.x = x0 + 0.01 * n; paint(dc, size, size.w * S.settings.scale, S.cover, catIndex(), null, drag); }
            FX_TIMING.on = false;
            report.weave.effects = { effect: `${look}.${e.key}`, workedOut: cold, againWhileDragged: Object.keys(FX_TIMING.ms).length, path: await invoke("write_image", framed(await toPng(dc), { dir, name: "weave-fx-drag.png" })) };
            if (!cold || report.weave.effects.againWhileDragged) report.errors.push("weave: dragging the lettering works out the woven subject's look effects again");
            tl.t.all.x = x0; delete front.lookFx;
          }
          report.weave = { ...report.weave, off: off.path, head: head.path, letters: letters.path, ransomOff: ransomOff.path, ransom: ransom.path, upright: upright.path, faint: faint.path, brush: brush.path, brushErased: brushErased.path, drag: dragged.path,
            changed: { head: apart(off.cv, head.cv), letters: apart(off.cv, letters.cv), headLetters: apart(head.cv, letters.cv), ransom: apart(ransomOff.cv, ransom.cv), upright: apart(uprightOff.cv, upright.cv),
              faint: apart(head.cv, faint.cv), brush: apart(off.cv, brush.cv), brushErased: apart(brush.cv, brushErased.cv), brushLeft: apart(off.cv, brushErased.cv), dragFromStill: apart(dragged.cv, still), lineMoved, lineStill } };
          const ch = report.weave.changed;
          if (!ch.head) report.errors.push("weave: the head in front looks as the cover unwoven");
          if (!ch.brush || !ch.brushErased || !ch.brushLeft) report.errors.push("weave: painted in front with the brush, the cover looks as unwoven, or as before part of it was painted behind again");
          if (!ch.letters || !ch.headLetters) report.errors.push("weave: the letters in front look as the cover unwoven, or as the head in front");
          if (!ch.ransom || !ch.upright) report.errors.push("weave: the letters in front of the ransom note, or of an upright lettering, look as the cover unwoven");
          if (!lineMoved || lineStill > lineMoved * 0.05) report.errors.push("weave: the head line's slider dragged, the frames do not follow it");
          // a drag's frame is drawn coarser here and there (see isFast), never let through elsewhere than a still cover is
          if (ch.dragFromStill > ch.head * 0.2) report.errors.push(`weave: dragged, the subject lets its lettering through elsewhere than a still cover does (${ch.dragFromStill} pixels apart)`);
        }
        const k = JSON.parse(keep); S.cover.layers = k.layers; S.cover.title = k.title; S.layerId = keepSel;
      }
    }
    // weaving an asset, which needs no photo and no cutting out: a sticker set over the title, its top in front of the
    // lettering and the rest behind; a band along the title's second line painted in front, in the box it is drawn in;
    // every other letter in front. Each must differ from the cover unwoven, and only where the sticker is; a drag of the
    // sticker, and one of the title, frame by frame as a still cover has it (`weave-asset-*.png`).
    {
      await step("weave an asset");
      const keep = JSON.stringify({ layers: S.cover.layers, title: S.cover.title }), size = S.profile.sizes[0], [vw, vh] = virtualSize(size.w, size.h);
      S.cover.title = "WEAVE *穿插*\nIN FRONT 前后";
      S.cover.layers = S.cover.layers.filter((l) => l.type !== "photo" && l.type !== "asset");
      const sk = newLayer("asset", { ref: { kind: "sticker", id: "burst" }, tint: true });
      insertAbove(S.cover.layers, "title", sk);
      // as tall as one and a half lines of the title, its top above the title's, a little right of the title's middle
      const hitsOf = () => renderFull(size, S.cover, catIndex())._hits;
      let hs = hitsOf(), T = hs.find((x) => x.id === "title"), K = hs.find((x) => x.id === sk.id);
      sk.t.all.s *= (T.hh * 1.5) / K.hh;
      hs = hitsOf(); T = hs.find((x) => x.id === "title"); K = hs.find((x) => x.id === sk.id);
      sk.t.all.x += (T.cx + T.hw * 0.1 - K.cx) / vw; sk.t.all.y += (T.cy - T.hh * 1.3 + K.hh - K.cy) / vh;
      const shot = async (name) => { const cv = await renderReady(size, S.cover, catIndex()); return { cv, path: await invoke("write_image", framed(await toPng(cv), { dir, name })) }; };
      // where the sticker shows on the cover unwoven — its rim, its shadow and all, which reach past its box, and what
      // the look lays over it all: where the cover unwoven differs from the cover without it. Lettering let through
      // shows as the cover without the sticker does, so it can change nothing anywhere else
      let shown = null, bare = null;
      /** Whether the sticker shows at pixel (x, y) of a canvas w × h, or within two pixels of it. */
      const onSticker = (x, y, w, h) => {
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const u = x + dx, v = y + dy, o = (v * w + u) * 4;
          if (u >= 0 && v >= 0 && u < w && v < h && Math.abs(shown[o] - bare[o]) + Math.abs(shown[o + 1] - bare[o + 1]) + Math.abs(shown[o + 2] - bare[o + 2]) + Math.abs(shown[o + 3] - bare[o + 3]) > 8) return true;
        }
        return false;
      };
      /** How many pixels (every seventh) of two canvases of one size differ noticeably, and how many of those lie where the sticker does not show. */
      const apart = (a, b) => {
        const x = a.getContext("2d").getImageData(0, 0, a.width, a.height).data, y = b.getContext("2d").getImageData(0, 0, b.width, b.height).data, w = a.width;
        let n = 0, off = 0;
        for (let i = 0; i < x.length; i += 28) if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 40) { n++; const p = i / 4; if (shown && !onSticker(p % w, Math.floor(p / w), w, a.height)) off++; }
        return [n, off];
      };
      const off = await shot("weave-asset-off.png");
      { sk.visible = false; const c = await renderReady(size, S.cover, catIndex()); sk.visible = true; bare = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; shown = off.cv.getContext("2d").getImageData(0, 0, c.width, c.height).data; }
      sk.weave = { with: ["title"], by: "head", line: 0.4, front: {} };
      const head = await shot("weave-asset-head.png"), H = head.cv._hits.find((x) => x.id === sk.id), T2 = head.cv._hits.find((x) => x.id === "title");
      const y2 = T2.cy + T2.hh * 0.5, br = Math.round(((T2.hh * 0.35) / photoLong(H.pf, 1, 1)) * 1e4) / 1e4, at = (x) => photoPoint(H.pf, x, y2).map((v) => Math.round(v * 1e4) / 1e4);
      sk.weave = { ...sk.weave, by: "brush", strokes: [{ front: true, r: br, pts: [at(T2.cx - T2.hw), at(T2.cx + T2.hw)] }] };
      const brush = await shot("weave-asset-brush.png");
      const keys = parseTitle(S.cover.title).flatMap((runs, row) => { const cells = lineCells(runs); return keysOf(cells, row).filter((k, i) => !/^\s+$/.test(cells[i].ch)); });
      sk.weave = { ...sk.weave, by: "letters", front: { title: keys.filter((_, i) => i % 2 === 0) } };
      const letters = await shot("weave-asset-letters.png");
      sk.weave.by = "head";
      // drags, on a canvas of the cover's size: the sticker moved, then the title, each frame against a still cover
      const frames = (ids, move) => {
        const cv = document.createElement("canvas"), live = { ids }, at2 = () => paint(cv, size, size.w * S.settings.scale, S.cover, catIndex(), null, live);
        at2(); move(); at2();
        return cv;
      };
      const x0 = sk.t.all.x, dragged = frames([sk.id], () => { sk.t.all.x = x0 - 0.04; }), still = renderFull(size, S.cover, catIndex());
      sk.t.all.x = x0;
      const tl = layer("title"), tx = tl.t.all.x, titleDragged = frames(["title"], () => { tl.t.all.x = tx + 0.02; }), titleStill = renderFull(size, S.cover, catIndex());
      tl.t.all.x = tx;
      const ch = { head: apart(off.cv, head.cv), brush: apart(off.cv, brush.cv), headBrush: apart(head.cv, brush.cv), letters: apart(off.cv, letters.cv), dragFromStill: apart(dragged, still)[0], titleDragFromStill: apart(titleDragged, titleStill)[0] };
      report.weaveAsset = { off: off.path, head: head.path, brush: brush.path, letters: letters.path, changed: ch };
      if (!ch.head[0] || !ch.brush[0] || !ch.headBrush[0] || !ch.letters[0]) report.errors.push("weave an asset: woven by its top, by the brush or by letter, the cover looks as unwoven, or the brush's as the top's");
      if (ch.head[1] || ch.brush[1] || ch.letters[1]) report.errors.push("weave an asset: the lettering comes in front where the sticker does not show");
      if (ch.dragFromStill > ch.head[0] * 0.2 || ch.titleDragFromStill > ch.head[0] * 0.2) report.errors.push(`weave an asset: dragged, it lets its lettering through elsewhere than a still cover does (${ch.dragFromStill}, ${ch.titleDragFromStill} pixels apart)`);
      const k = JSON.parse(keep); S.cover.layers = k.layers; S.cover.title = k.title;
    }
    // the title and a text layer as headlines on plates, the text with its own colour, an outline and plates under its highlighted words
    {
      const keepTitle = S.cover.title;
      S.cover.title = "Plates *for* all\nheadlines";
      titleLayer.plate = true; titleLayer.fx = "plain";
      const tx = newLayer("text", { text: "NEW *text*", plate: false, ink: "#ffd60a", hiPlate: true, stroke: 1.5 }); tx.t.all = { ...tx.t.all, x: 0.72, y: 0.82, s: 0.4 };
      const tp = newLayer("text", { text: "ON A *PLATE*", plate: true, plateInk: "#ffffff" }); tp.t.all = { ...tp.t.all, x: 0.72, y: 0.62, s: 0.3, r: -4 };
      S.cover.layers.push(tx, tp);
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex());
      report.headlines = { path: await invoke("write_image", framed(await toPng(cv), { dir, name: "headlines.png" })), hits: ["title", tx.id, tp.id].map((id) => !!cv._hits.find((h) => h.id === id)) };
      S.cover.title = keepTitle; S.cover.layers = S.cover.layers.filter((l) => l !== tx && l !== tp); titleLayer.plate = false;
    }
    // each way of marking the highlighted words, on the title (bent too, for the ring) and on a text layer, with Latin and punctuation set beside CJK
    {
      const keepTitle = S.cover.title;
      S.cover.title = "「重磅」*2026* 为什么\n*AI* 无法取代审美？";
      report.hiMarks = [];
      for (const kind of ["plate", "circle", "marker", "block"]) {
        delete titleLayer.fx; delete titleLayer.hiPlate; delete titleLayer.hiMark;
        if (kind === "plate") titleLayer.hiPlate = true; else titleLayer.hiMark = kind;
        if (kind === "circle") titleLayer.bend = "arc";
        const tx = newLayer("text", { text: "标记*重点*", ...(kind === "plate" ? { hiPlate: true } : { hiMark: kind }) }); tx.t.all = { ...tx.t.all, x: 0.75, y: 0.8, s: 0.4 };
        S.cover.layers.push(tx);
        const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex());
        report.hiMarks.push({ kind, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `hi-${kind}.png` })), hits: ["title", tx.id].map((id) => !!cv._hits.find((h) => h.id === id)) });
        S.cover.layers = S.cover.layers.filter((l) => l !== tx);
        delete titleLayer.bend;
      }
      delete titleLayer.hiPlate; delete titleLayer.hiMark;
      S.cover.title = keepTitle;
    }
    // the looks' effects on the user's own layers: every look that has some, all of them at full on a
    // text layer, a sticker, a solid and a print of the last picture taken in; then, under a look
    // of none, effects borrowed from other looks
    report.layerFx = [];
    {
      const keepLook = S.profile.style.look, tx = newLayer("text", { text: "LAYER *效果*" }), sk = newLayer("asset", { ref: { kind: "sticker", id: "burst" }, tint: true });
      const so = newLayer("solid", { color: "#2a9df4" }), pid = [...S.photos.keys()].at(-1), pr = pid ? newLayer("photo", { pid, outline: 6 }) : null;
      tx.t.all = { ...tx.t.all, x: 0.64, y: 0.62, s: 0.9 }; sk.t.all = { ...sk.t.all, x: 0.86, y: 0.68, s: 0.45 }; so.t.all = { ...so.t.all, x: 0.5, y: 0.86, s: 0.2 };
      if (pr) pr.t.all = { ...pr.t.all, x: 0.22, y: 0.3, s: 0.3, r: -4 };
      const ours = [tx, sk, so, ...(pr ? [pr] : [])];
      S.cover.layers.push(...ours);
      const shoot = async (name, look) => {
        S.profile.style.look = look; await step(`layerfx-${name}`);
        const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
        report.layerFx.push({ name, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `layerfx-${name}.png` })), hits: ours.map((L) => !!cv._hits.find((h) => h.id === L.id)) });
      };
      for (const id of looks.filter((k) => (LOOKS[k].elementFx || []).length)) {
        for (const L of ours) L.lookFx = Object.fromEntries(effectsFor(id, L.type).map((e) => [`${id}.${e.key}`, 1]));
        await shoot(id, id);
      }
      for (const L of ours) L.lookFx = {};
      tx.lookFx = { "chrome.chrome": 1, "chrome.drips": 0.8, "riso.shift": 0.6, "cyber.sliced": 0.5 }; sk.lookFx = { "netart.dither": 0.7, "netart.sort": 0.8, "riso.dots": 0.6, "riso.dots:pitch": 1 };
      so.lookFx = { "velvet.check": 0.8, "court.varsity": 0.7 }; if (pr) pr.lookFx = { "cyano.duo": 1, "toon.burst": 0.5 };
      await shoot("borrowed", "velvet");
      S.profile.style.look = keepLook; S.cover.layers = S.cover.layers.filter((l) => !ours.includes(l));
    }
    // each look's figure drawn from a sticker in the channel graphic's place (style.lookArt), with no photo
    // filling the canvas: the picture must change
    report.figureArt = [];
    {
      const st = S.profile.style, arts = (st.lookArt = st.lookArt || {}), keepLook = st.look, fills = S.cover.layers.filter(fillsCanvas), shown = fills.map((l) => l.visible);
      const sig = (cv) => { const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) | 0; return h; };
      fills.forEach((l) => (l.visible = false));
      for (const id of looks.filter((k) => LOOKS[k].art)) {
        const keepParams = st.lookParams[id], keepArt = arts[id];
        st.look = id; st.lookParams[id] = { ...(keepParams || {}), [LOOKS[id].art]: 0.7 }; delete arts[id];
        await step(`figure-${id}`);
        const before = sig(renderFull(S.profile.sizes[0], S.cover, catIndex()));
        arts[id] = { kind: "sticker", id: "burst" };
        const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
        report.figureArt.push({ look: id, changed: sig(cv) !== before, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `figure-${id}.png` })) });
        if (keepParams) st.lookParams[id] = keepParams; else delete st.lookParams[id];
        if (keepArt) arts[id] = keepArt; else delete arts[id];
      }
      fills.forEach((l, i) => (l.visible = shown[i])); st.look = keepLook;
      // a photo's cut-out subject as the jelly's figure (Figure from → Cut-out subjects), when a real photo is
      // given (SMEDCOVER_SELFTEST_PHOTO): cut out on this computer, kept with my assets, the jelly made of it
      const real = canCut() && (await invoke("selftest_photo").catch(() => null)), pid = real && (await putPhoto(real));
      if (pid) {
        await step("figure from a cut-out subject");
        let got = null; await pickSubject(pid, (ref) => (got = ref));
        const a = got && userAssets.get(got.id), keepArt = arts.jelly;
        fills.forEach((l) => (l.visible = false)); st.look = "jelly"; delete arts.jelly;
        const before = sig(renderFull(S.profile.sizes[0], S.cover, catIndex()));
        if (got) arts.jelly = got;
        const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
        report.subjectFigure = { mask: !!S.photos.get(pid).mask, asset: !!a, size: a && a.img ? sizeOf(a.img) : null, photo: sizeOf(S.photos.get(pid).img), changed: sig(cv) !== before, error: CUT.error,
          path: await invoke("write_image", framed(await toPng(cv), { dir, name: "subject-figure-jelly.png" })), subject: a ? await invoke("write_image", framed(new Uint8Array(await (await fetch(a.src)).arrayBuffer()), { dir, name: "subject-figure-asset.png" })).catch((e) => String(e)) : null };
        if (keepArt) arts.jelly = keepArt; else delete arts.jelly;
        fills.forEach((l, i) => (l.visible = shown[i])); st.look = keepLook;
      }
    }
    // Surprise me: six hands dealt, each in a look of its own, the first kept; the cover put back after
    report.surprise = [];
    {
      const keep = JSON.stringify({ style: S.profile.style, layers: S.cover.layers, scene: S.cover.scene });
      for (let i = 0; i < 4; i++) {
        await step(`surprise ${i + 1}`); SURPRISE.last = null; await surprise(); await new Promise((r) => setTimeout(r, 0));
        const L = SURPRISE.last;
        report.surprise.push(L ? { ms: L.ms, kept: L.hands[L.kept], looks: L.hands.map((h) => h.look), distinct: new Set(L.hands.map((h) => h.look)).size } : { error: "no hand kept" });
      }
      const k = JSON.parse(keep); S.profile.style = k.style; S.cover.layers = k.layers; if (k.scene) S.cover.scene = k.scene; else delete S.cover.scene;
      touch({ profile: true, cover: true, panel: true, side: true });
    }
    // Surprise me on a cover with a print of the real photo under the title, its subject cut out over the title, and
    // the photo clipped into the title: the subject still over the title and over its photo, the picture still in the letters
    {
      const real = canCut() && (await invoke("selftest_photo").catch(() => null)), pid = real && (await putPhoto(real));
      if (pid) {
        await step("surprise with a cut-out");
        const keep = JSON.stringify({ style: S.profile.style, layers: S.cover.layers, scene: S.cover.scene }), keepSel = S.layerId, at = (id) => S.cover.layers.findIndex((l) => l.id === id);
        const ph = newLayer("photo", { pid });
        ph.t.all = { ...ph.t.all, x: 0.7, y: 0.45, s: 0.6 };
        S.cover.layers.splice(at("title"), 0, ph);
        const front = await cutOut(ph), inside = newLayer("photo", { pid, clip: true });
        S.cover.layers.splice(at("title") + 1, 0, inside);
        report.surpriseCut = [];
        for (let i = 0; i < 4; i++) {
          // the last time with the cut-out moved off its photo and made smaller: its size its own from then on
          const off = i === 3 && front && layer(front.id), ownS = off && (off.t.all = { ...off.t.all, x: -0.25, s: off.t.all.s * 0.8 }).s;
          SURPRISE.last = null; await surprise(); await new Promise((r) => setTimeout(r, 0));
          const P = layer(ph.id), F = front && layer(front.id), ti = at("title"), cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
          const box = (id) => { const h = cv._hits.find((x) => x.id === id); return h && boxOf(h); }, subject = F && box(F.id);
          const covered = subject ? Math.max(0, ...S.cover.layers.filter((l) => isFree(l.type) && l !== P && l !== F && l.id !== inside.id).map((l) => box(l.id)).filter(Boolean).map((b) => overlap(subject, b))) : null;
          report.surpriseCut.push({ kept: !!SURPRISE.last, overTitle: !!F && at(F.id) > ti, onlyThoseOver: S.cover.layers.slice(ti + 1).every((l) => l.clip || (l.type === "photo" && l.cut)),
            aligned: !!F && !!P && JSON.stringify(F.t) === JSON.stringify(alignedT(P)), ...(off ? { ownSize: F.t.all.s === ownS } : {}), covered: covered == null ? null : Math.round(covered * 100) / 100,
            inLetters: at(inside.id) === ti + 1 && !!layer(inside.id).clip, scale: P && P.t.all.s,
            path: await invoke("write_image", framed(await toPng(cv), { dir, name: `surprise-cut-${i + 1}.png` })) });
        }
        const k = JSON.parse(keep); S.profile.style = k.style; S.cover.layers = k.layers; if (k.scene) S.cover.scene = k.scene; else delete S.cover.scene;
        S.layerId = keepSel;
        touch({ profile: true, cover: true, panel: true, side: true });
      }
    }
    // clipping masks: a solid clipped to the title (its letters in the solid's colour), and a print of the
    // last picture taken in clipped to a text layer (the picture inside the letters)
    {
      const so = newLayer("solid", { color: "#ff3366", clip: true }), tx = newLayer("text", { text: "CLIP" }), pid = [...S.photos.keys()].at(-1), pr = pid ? newLayer("photo", { pid, clip: true }) : null;
      so.t.all = { ...so.t.all, x: 0.35, y: 0.4, s: 0.5 }; tx.t.all = { ...tx.t.all, x: 0.7, y: 0.72, s: 1.4 };
      if (pr) pr.t.all = { ...pr.t.all, x: 0.7, y: 0.72, s: 0.7 };
      const ours = [so, tx, ...(pr ? [pr] : [])];
      S.cover.layers.splice(S.cover.layers.findIndex((l) => l.type === "title") + 1, 0, so); S.cover.layers.push(tx, ...(pr ? [pr] : []));
      const cv = renderFull(S.profile.sizes[0], S.cover, catIndex());
      report.clip = { path: await invoke("write_image", framed(await toPng(cv), { dir, name: "clip.png" })), hits: ours.map((L) => !!cv._hits.find((h) => h.id === L.id)) };
      S.cover.layers = S.cover.layers.filter((l) => !ours.includes(l));
    }
    // the looks' scene objects, each moved, the ground selected so their handles show: the basketball
    // poster's, or those of each look named for the test (the sliders of the same name turned up, so they show)
    report.scene = [];
    for (const look of looks === LOOK_IDS ? ["court"] : looks.filter((k) => LOOKS[k].scene)) {
      const keepLook = S.profile.style.look, keepScene = S.cover.scene, keepSel = S.layerId, keepParams = S.profile.style.lookParams[look], keys = Object.keys(LOOKS[look].scene);
      S.profile.style.look = look; await step(`scene-${look}`);
      S.profile.style.lookParams[look] = { ...(keepParams || {}), ...(look === "court" ? { ball: 0.7, number: 0.6, court: 0.7, hoop: 0.7 } : Object.fromEntries(LOOKS[look].params.filter((d) => keys.includes(d.key)).map((d) => [d.key, Math.max(d.def, 0.6)]))) };
      for (const k of keys) moveScene(S.cover, look, k, "all", frame().key, -0.1, 0.08);
      const cv = document.createElement("canvas");
      drawCover(cv, { profile: S.profile, catIndex: catIndex(), size: S.profile.sizes[0], pixelW: 1600, cover: S.cover, photos: S.photos, select: "bg" });
      report.scene.push({ look, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `scene-${look}.png` })), handles: (cv._scene || []).map((q) => q.key).sort(), declared: keys.sort() });
      S.profile.style.look = keepLook; S.profile.style.lookParams[look] = keepParams; S.layerId = keepSel;
      if (keepScene) S.cover.scene = keepScene; else delete S.cover.scene;
    }
    // every bend, with the look's own lettering (automatic): the lettering is painted as it is and bent
    report.bends = [];
    delete titleLayer.fx;
    for (const id of Object.keys(BENDS)) {
      titleLayer.bend = id; await step(`bend-${id}`);
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex()), hit = cv._hits.find((h) => h.id === "title");
      report.bends.push({ id, hit: !!hit, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `bend-${id}.png` })) });
      if (!hit) report.errors.push(`bend ${id}: the title was not painted`);
    }
    // a bend over another look's lettering, over a masked effect, and over an extrusion (its outlines arrive after the first paint)
    for (const [look, fx, id] of [["deco", null, "arc"], ["chrome", null, "circle"], [S.profile.style.look, "dots", "flag"], [S.profile.style.look, "extrude", "arc"]]) {
      if (!LOOKS[look]) continue;
      const keepLook = S.profile.style.look; S.profile.style.look = look;
      if (fx) titleLayer.fx = fx; else delete titleLayer.fx;
      titleLayer.bend = id; await step(`bend-${look}-${id}`);
      report.bends.push({ id: `${look}-${fx || "auto"}-${id}`, path: await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: `bend-${look}-${fx || "auto"}-${id}.png` })) });
      S.profile.style.look = keepLook;
    }
    delete titleLayer.fx;
    // the perspective with corners of its own, dragged far: the lettering follows the quad
    titleLayer.bend = "taper"; titleLayer.warp = [[0, 0], [-0.05, 0.35], [0.08, -0.1], [0.04, 0]];
    report.bends.push({ id: "taper-own", path: await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "bend-taper-own.png" })) });
    delete titleLayer.warp;
    // any other bend reshaped by its handles: the top's right end raised, the bottom's middle pulled down
    titleLayer.bend = "arc"; titleLayer.reshape = [[0, 0], [0, 0], [0.05, -0.25], [0.1, -0.4], [0, 0], [0, 0.2], [0, 0.2], [0.1, 0]];
    {
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex()), hit = cv._hits.find((h) => h.id === "title");
      report.bends.push({ id: "arc-reshaped", hit: !!hit, path: await invoke("write_image", framed(await toPng(cv), { dir, name: "bend-arc-reshaped.png" })) });
      if (!hit) report.errors.push("bend arc reshaped: the title was not painted");
    }
    delete titleLayer.reshape; delete titleLayer.bend;
    S.cover.title = keep;
    report.outline = await invoke("text_outline", { text: "A夜", families: ["Bebas Neue", "Noto Sans SC"], weight: 900 }).then((o) => ({ missing: o.missing, glyphs: o.glyphs.length, contours: o.glyphs.map((g) => g.c.length) }), (e) => ({ error: String(e) }));
    if (!report.outline.glyphs || report.outline.missing) report.errors.push("outline: the native side could not trace bundled fonts");
    // a font a canvas outside the page cannot reach (one the user installed, one macOS downloads): once
    // ensured, it can — and the title painted with a look effect, on such a canvas, is set in it
    const away = [];
    for (const f of S.systemFonts.filter((f) => !BUNDLED_FONTS.includes(f) && !reachable(f))) {   // tried with the usual characters, then with ones each has
      const info = await invoke("font_faces", { family: f }).catch(() => null);
      if (info && info.probe && !reachable(f, info.probe)) away.push({ family: f, probe: info.probe, faces: info.weights.length });
      if (away.length >= 3) break;
    }
    report.sysFonts = { away };
    if (away.length) {
      const { family: font, probe: text } = away[0];
      await ensureFont(font);
      report.sysFonts.reached = reachable(font, text);
      if (!report.sysFonts.reached) report.errors.push(`fonts: ${font} is still out of reach of a canvas outside the page`);
      const was = { font: titleLayer.font, lookFx: titleLayer.lookFx };
      titleLayer.font = font; titleLayer.lookFx = { "riso.shift": 0.6 };
      report.sysFonts.path = await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "font-system-fx.png" }));
      if (was.font) titleLayer.font = was.font; else delete titleLayer.font;
      if (was.lookFx) titleLayer.lookFx = was.lookFx; else delete titleLayer.lookFx;
    }
    if (report.ai && !report.ai.every((r) => r.stored && r.drawn)) report.errors.push("ai: a generated asset was not stored or drawn");
    report.ok = !report.errors.length;
  } catch (e) { report.errors.push(String(e && e.message ? e.message : e)); }
  await invoke("selftest_done", { report: JSON.stringify(report, null, 2) }).catch(() => null);
}
/**
 * SMEDCOVER_SELFTEST_DRAG: measures how smooth editing is on the cover in the data folder, at a Retina
 * screen's pixel ratio, as a hand would work: a whole redraw (first, and again with everything cached),
 * dragging each text and photo layer with pointer events, the size thumbnails, and dragging the sliders of
 * the photos that cost most. Each part is split into time spent by layer and time spent computing pixels
 * in script (blurs, masks — what a faster language could speed up) as against drawing on canvases.
 */
async function dragTest() {
  Object.defineProperty(window, "devicePixelRatio", { get: () => 2 });   // as on a Retina screen, whatever screen the test window opens on
  const cv = $("cv"), report = { dpr: devicePixelRatio, look: S.profile.style.look, layers: S.cover.layers.length };
  cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {};
  // the next frame — or a second, as a window that is covered gets no frames and the test would wait for ever
  const frame = () => new Promise((r) => { requestAnimationFrame(() => r()); setTimeout(r, 1000); });
  const flush = () => cv.getContext("2d").getImageData(0, 0, 1, 1);   // wait for the drawing to be done, not only queued
  const name = (id) => layerName(layer(id) || { type: id });
  const begin = () => { Object.assign(TIMING, { on: true, ms: {}, rebuilt: 0 }); Object.assign(PIXELS, { on: true, ms: {} }); };
  const end = (n = 1) => {
    TIMING.on = PIXELS.on = false;
    const r = (o) => Object.fromEntries(Object.entries(o).filter(([, ms]) => ms / n >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, ms]) => [k, Math.round(ms / n)]));
    return { byLayer: r(Object.fromEntries(Object.entries(TIMING.ms).map(([id, ms]) => [name(id), ms]))), pixelsInScript: r(PIXELS.ms) };
  };
  // 1. a whole redraw: the first (nothing cached yet), then again
  begin(); let t0 = performance.now(); drawMain(); flush();
  report.redrawFirst = { ms: Math.round(performance.now() - t0), canvas: [cv.width, cv.height], ...end() };
  begin(); t0 = performance.now(); for (let i = 0; i < 3; i++) { drawMain(); flush(); }
  report.redrawCached = { ms: Math.round((performance.now() - t0) / 3), ...end(3) };
  // the same, each look effect timed on its own (the drawing finished before and after it, so slower overall)
  if (S.cover.layers.some((l) => l.lookFx)) {
    Object.assign(FX_TIMING, { on: true, ms: {} }); for (let i = 0; i < 3; i++) { drawMain(); flush(); } FX_TIMING.on = false;
    report.lookFxEach = Object.fromEntries(Object.entries(FX_TIMING.ms).map(([id, ms]) => [id, Math.round(ms / 3)]));
  }
  // 2. the size thumbnails, all of them, as after an edit
  begin(); t0 = performance.now();
  for (const size of S.profile.sizes) { const th = $("th-" + sizeKey(size)); if (th) { paint(th, size, virtualSize(size.w, size.h)[0] * 0.2); th.getContext("2d").getImageData(0, 0, 1, 1); } }
  report.thumbnails = { sizes: S.profile.sizes.length, ms: Math.round(performance.now() - t0), ...end() };
  await new Promise((r) => setTimeout(r, 1500));
  // 3. dragging each layer: the first frame (the still layers painted once) and the frames after it
  report.drags = [];
  for (const L of S.cover.layers.filter((l) => (l.type === "text" || l.type === "photo" || l.type === "title") && l.visible && appliesTo(l, cat().id))) {
    queueDraw(); await frame(); await frame();
    const h = cv._hits.find((x) => x.id === L.id);
    if (!h) continue;
    const b = cv.getBoundingClientRect(), k = b.width / cv._virtual[0];
    let x = b.left + h.cx * k, y = b.top + h.cy * k;
    if (L.fill) { selectLayer(L.id); await frame(); }
    cv.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, button: 0, pointerId: 1, bubbles: true }));
    const times = []; let last = performance.now(), firstFrame = null;
    begin();
    for (let i = 0; i < 40; i++) {
      x += 3; if (cv.onpointermove) cv.onpointermove(new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1 }));
      await frame(); const now = performance.now(); times.push(Math.round(now - last)); last = now;
      if (i === 0) { firstFrame = end(); begin(); }
    }
    const rest = end(39);
    if (cv.onpointerup) cv.onpointerup(new PointerEvent("pointerup", { clientX: x, clientY: y }));
    await new Promise((r) => setTimeout(r, 900));
    const s = [...times].sort((a, b) => a - b);
    report.drags.push({ layer: name(L.id), first: times.slice(0, 3), median: s[20], firstFrame, perFrameAfter: rest });
  }
  // 3b. dragging each look's first scene object, the ground selected (the ground and the frame repainted, in draft)
  report.sceneDrags = [];
  {
    const keepLook = S.profile.style.look, keepScene = JSON.stringify(S.cover.scene || null), keepSel = S.layerId;
    selectLayer("bg");
    for (const look of (await testedLooks()).filter((id) => LOOKS[id].scene)) {
      S.profile.style.look = look; queueDraw(); await frame(); await frame();
      const q = (cv._scene || [])[0];
      if (!q) { report.sceneDrags.push({ look, object: null }); continue; }
      const b = cv.getBoundingClientRect(), k = b.width / cv._virtual[0];
      let x = b.left + q.x * k; const y = b.top + q.y * k;
      cv.dispatchEvent(new PointerEvent("pointerdown", { clientX: x, clientY: y, buttons: 1, button: 0, pointerId: 1, bubbles: true }));
      const times = []; let last = performance.now();
      for (let i = 0; i < 20; i++) {
        x += 3; if (cv.onpointermove) cv.onpointermove(new PointerEvent("pointermove", { clientX: x, clientY: y, buttons: 1 }));
        await frame(); const now = performance.now(); times.push(Math.round(now - last)); last = now;
      }
      if (cv.onpointerup) cv.onpointerup(new PointerEvent("pointerup", { clientX: x, clientY: y }));
      const s = [...times].sort((a, b) => a - b);
      report.sceneDrags.push({ look, object: q.key, first: times[0], median: s[10] });
      await new Promise((r) => setTimeout(r, 400));
    }
    S.profile.style.look = keepLook; S.cover.scene = JSON.parse(keepScene); if (!S.cover.scene) delete S.cover.scene; selectLayer(keepSel); queueDraw();
  }
  // 4. the sliders of the photos that cost most to paint: each step repaints that photo
  report.sliders = [];
  for (const L of S.cover.layers.filter((l) => l.type === "photo" && l.visible && appliesTo(l, cat().id) && (l.cut || l.outline > 0 || l.shadow > 0))) {
    for (const key of ["dim", ...(L.cut ? ["feather", "spread"] : []), ...(L.outline > 0 ? ["outline"] : [])]) {
      const was = L[key], times = [];
      begin();
      for (let i = 1; i <= 12; i++) {
        holdLive(L.id); L[key] = key === "dim" ? 0.01 * i : Math.max(0, was + (i % 2 ? 1 : -1) * Math.ceil(i / 2));
        touch({ cover: true }); const t = performance.now(); await frame(); times.push(performance.now() - t);
      }
      const parts = end(12);
      L[key] = was; touch({ cover: true }); await new Promise((r) => setTimeout(r, 500));
      times.sort((a, b) => a - b);
      report.sliders.push({ layer: name(L.id), slider: key, median: Math.round(times[6]), worst: Math.round(times[11]), ...parts });
    }
  }
  // 5. the look's own sliders: a whole redraw with each one at 0 (what that part costs to paint), then
  // each stepped as a drag steps it — a profile change, then the next frame
  const st = S.profile.style, own = (LOOKS[st.look] || LOOKS.cel).params.filter((d) => !d.text), kept = st.lookParams[st.look];
  if (own.length) {
    const redraw = (vals) => { st.lookParams[st.look] = vals; const ts = []; for (let i = 0; i < 3; i++) { const t = performance.now(); drawMain(); flush(); ts.push(performance.now() - t); } return ts.sort((a, b) => a - b)[1]; };
    const all = redraw({ ...kept });
    report.look = { look: st.look, redraw: Math.round(all), allAtZero: Math.round(redraw(Object.fromEntries(own.map((d) => [d.key, 0])))), savedAtZero: {} };
    for (const d of own) report.look.savedAtZero[d.key] = Math.round(all - redraw({ ...kept, [d.key]: 0 }));
    report.look.stepping = {};
    { // the first slider stepped at the full resolution too, as before drafts: what a draft saves
      const d = own.find((q) => !q.needsPhoto), times = [];
      for (let i = 1; i <= 7; i++) { st.lookParams[st.look] = { ...kept, [d.key]: clamp(d.def + (i % 2 ? 0.05 : -0.05), d.min, d.max) }; DRAFT.until = 0; touch({ profile: true }); const t = performance.now(); await frame(); if (i > 1) times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      report.look.steppingFull = { [d.key]: Math.round(times[3]) };
    }
    // each stepped as its slider steps it, a draft that keeps the layers that did not read it (see o.draft in
    // render.js), and as a draft that paints every layer each step (as the layout's sliders are): what keeping them saves
    const stepped = async (d, key) => {
      const times = [];
      for (let i = 1; i <= 7; i++) { st.lookParams[st.look] = { ...kept, [d.key]: clamp(d.def + (i % 2 ? 0.05 : -0.05), d.min, d.max) }; draftTouch({ profile: true }, key); const t = performance.now(); await frame(); if (i > 1) times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      return Math.round(times[3]);
    };
    report.look.steppingEveryLayer = {};
    for (const d of own.filter((q) => !q.needsPhoto)) {
      report.look.stepping[d.key] = await stepped(d, d.key);
      report.look.steppingEveryLayer[d.key] = await stepped(d, null);
    }
    if (kept) st.lookParams[st.look] = kept; else delete st.lookParams[st.look];
    touch({ profile: true });
  }
  await invoke("selftest_done", { report: JSON.stringify(report, null, 2) }).catch(() => null);
}
// test hook: lets automated checks drive the app without the UI
window.__smedcover = { S, drawCover, renderFull, nameFor, touch, addAsset, addLayer, newLayer, selectLayer, selectSize, setMode, layer, surprise, SURPRISE, brushOpen, brushClose };
start().catch((e) => {
  console.error(e);
  if (HOST !== "server") return fail(e);
  setLang(S.settings.lang || detectLang());   // the settings may be what could not be read
  toast(t("msg.serverAway", String(e)), true);
});
