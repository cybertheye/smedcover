// SmedCover UI. Two modes: Edit (cover content, assets, style + the layer stack) and Setup (brand,
// sizes, fonts). The cover is a collage of layers painted by render.js; persistence is in store.js.
import { fonts, clamp } from "./cel.js";
import { virtualSize , layoutValues, dragLayout, LAYOUT_LIMITS } from "./layout.js";
import { TIMING, layoutHandles, drawCover, sizeKey, hexToRgb, hitAt, hitsIn, paintAccent, handles, showsFrame, sceneHandleAt } from "./render.js";
import { csvToJobs } from "./csv.js";
import { t, setLang, getLang, detectLang } from "./i18n.js";
import { sampleProfile, starterProfile, SIZE_PRESETS } from "./presets.js";
import { useFont, ratioText } from "./store.js";
import { GRAPHICS, STICKERS, STICKER_GROUPS, userAssets, putUserAsset, putSpecAsset, assetIdFor, assetExists, assetName, canTint, drawAsset } from "./assets.js";
import { ACCENT_SHAPES, newLayer, isFree, isRemovable, fillsCanvas, isPickable, appliesTo, stepIndex, adjust, resetPlacement, insertAbove, moveLayer, duplicate, copyFreeLayers, clipBase, clipEnd, moveScene, resetScene, sceneOffsets, resolve as placeOf, reorderLayout } from "./layers.js";
import {
  carryFonts, native, invoke, files, uid, readJson, writeJson, loadProfiles, saveProfile, deleteProfile, loadAssetRecords, saveAssetRecord,
  deleteAssetRecord, usedUserAssets, normalizeFolders, normalizeProfile, normalizeCover, normalizeSettings, normalizeSize, exportName, sizeCaption,
} from "./store.js";

import { normalizeSpec, parseSpec, drawSpec } from "./spec.js";
import { EFFECTS, effectUses, warpCorners } from "./textfx.js";
import { onOutlines, outlinesPending, outlinesSettled } from "./outlines.js";
import { LOOKS, LOOK_IDS, setLook, lookParams, effectsFor, FX_TYPES, FX_TIMING } from "./style.js";
import { sizeOf, PIXELS } from "./photo.js";
import { PLATFORMS, RED_RATIOS, wanted, isRatio } from "./platforms.js";
import { checkCover, LIMITS as CHECK_LIMITS, boxOf, moveOut, titleContrast, titleLines as typedLines, lineUnits, luminance } from "./check.js";
import { VIEW, LIMITS, turn, gapFor, fitView, sheetUnder, labelRoom, drawStack } from "./stack3d.js";
import { IMAGE_PROVIDERS, IMAGE_DEFAULTS, MAX_STYLES, loadStyles, styleText, legacyStyles, userStyle, writeStyle, freeId, promptOf, normalizeImageAi, imageReady, imageEndpoint, buildImageRequest, readImageReply, refusedParam, imageCheck, readImageCheck, repaintPrompt, generatePrompt } from "./repaint.js";
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
  mode: "edit", tab: { edit: "cover", setup: "brand" },
  sel: "",                               // size key shown on the main canvas
  layerId: "title",                      // selected layer
  hist: [], histIdx: -1,
};
const cat = () => S.profile.categories.find((c) => c.id === S.cover.catId) || S.profile.categories[0];
const catIndex = () => Math.max(0, S.profile.categories.indexOf(cat()));
const selSize = () => S.profile.sizes.find((s) => sizeKey(s) === S.sel) || S.profile.sizes[0];
const sizeLabel = (s) => `${sizeCaption(s)} · ${s.w}×${s.h}`;      // full form, with pixels
const layer = (id = S.layerId) => S.cover.layers.find((l) => l.id === id) || null;
/** Geometry context of the size on the main canvas, as the layer maths wants it. */
const frame = () => { const s = selSize(), [vw, vh] = virtualSize(s.w, s.h); return { vw, vh, key: sizeKey(s), catId: cat().id }; };
function layerName(L) {
  if (isFree(L.type) && L.name) return L.name;   // the user's own name for a layer they added
  if (L.type === "asset") return assetExists(L.ref) ? assetName(L.ref, getLang()) : t("assets.missing");
  if (L.type === "text") return L.text.split("\n")[0].replace(/\*/g, "").slice(0, 16) || t("layer.text");
  if (L.type === "photo") return t(L.of || L.cut ? "layer.photoCut" : L.fill ? "layer.photoFill" : "layer.photo");
  if (L.type === "solid") return t("layer.solid");
  return t("layer." + L.type);
}

let toastTimer;
function toast(msg, sticky = false) {
  const n = $("toast");
  n.textContent = msg; n.classList.add("on");
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => n.classList.remove("on"), 3400);
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
function resetHistory() { S.hist = [snapshot()]; S.histIdx = 0; syncTop(); }
/** Adds the present state to the undo history, unless it is already its last entry. */
function commitHistory() {
  const snap = snapshot();
  if (snap === S.hist[S.histIdx]) return;
  S.hist = S.hist.slice(0, S.histIdx + 1);
  S.hist.push(snap);
  if (S.hist.length > 80) S.hist.splice(0, S.hist.length - 80);
  S.histIdx = S.hist.length - 1;
  syncTop();
}
/** Records history a moment after the last change, so a drag or a burst of typing is one step. */
function recordHistory() { later("hist", 500, commitHistory); }
async function timeTravel(step) {
  clearTimeout(timers.hist);
  commitHistory();   // a change still waiting to be recorded is a step of its own: undo goes back to before it
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
 * Call after any change. profile/cover: what to save; panel/side: rebuild the left tool panel /
 * the layer column; strip: rebuild the thumbnail strip (sizes changed).
 */
function touch({ profile = false, cover = false, panel = false, side = false, strip = false } = {}) {
  if (profile) persistProfile();
  if (cover) persistCover();
  if (strip) buildStrip();
  if (panel) renderPanel();
  if (side) renderSide();
  queueDraw();
  recordHistory();
  checkSoon();
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
  if (!native || !S.systemFonts.includes(family) || BUNDLED_FONTS.includes(family) || S.importedFonts.includes(family)) return null;
  if (!SYS_FACES.has(family)) SYS_FACES.set(family, invoke("font_faces", { family }).then(async ({ probe: text, weights }) => {
    if (!text || reachable(family, text)) return false;
    // every upright face at its own weight (a variable one over its range), so each weight of lettering
    // finds the face it did with the system font; the name as it is (WebKit keeps quotes as part of it)
    const faces = [];
    for (let n = 0; n < weights.length; n++) faces.push(await new FontFace(family, await invoke("font_data", { family, n }), { weight: weights[n] }).load());
    for (const f of faces) document.fonts.add(f);
    queueDraw();
    return true;
  }).catch(() => false));
  return SYS_FACES.get(family);
}
/** Sees that the system fonts the layers are set in are there for every canvas; resolves once they are. */
const ensureFonts = (layers) => Promise.all([...new Set(layers.map((L) => L.font).filter(Boolean))].map(ensureFont).filter(Boolean));

/** Everything that has to happen when S.profile / S.cover are replaced or restored. */
async function applyProfile() {
  setCover(normalizeCover(S.cover, S.profile));
  if (S.profile.oldFonts) { carryFonts(S.cover.layers, S.profile.oldFonts, S.profile.style.look); delete S.profile.oldFonts; persistProfile(); persistCover(); }   // an older profile's brand-wide fonts, moved onto the layers
  if (!S.profile.sizes.some((s) => sizeKey(s) === S.sel)) S.sel = sizeKey(S.profile.sizes[0]);
  if (!layer()) S.layerId = "title";
  await applyFonts();
  syncTop(); syncTabs(); renderPanel(); renderSide(); buildStrip(); syncToolbar(); queueDraw(); checkSoon();
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
 * work), and the size thumbnails wait; the full picture comes back a moment after the last step. Such a
 * setting can touch every layer, so the rest of the cover cannot be kept as a layer's own slider keeps it
 * (see holdLive).
 */
const DRAFT = { until: 0 };
const drafting = () => performance.now() < DRAFT.until;
function draftTouch(opts) { DRAFT.until = performance.now() + 250; later("undraft", 270, queueDraw); touch(opts); }
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
  paint(cv, size, Math.min(vw * 1.5, vw * k * (drafting() ? 1 : window.devicePixelRatio || 1)), S.cover, catIndex(), S.mode === "edit" ? S.layerId : null, S.mode === "edit" ? LIVE : null,
    S.mode === "edit" ? { picked: group().map((L) => L.id), sceneHandles: !S.settings.hideScene, spot: S.focus ? spotIds() : null } : {});
  const clear = !layer("bg").visible;
  stage.classList.toggle("alpha", clear); $("strip").classList.toggle("alpha", clear);
}
/**
 * Redraws the size thumbnails under the canvas, one per turn of the event loop, so the window keeps
 * answering between them (on a heavy cover each is a whole cover). Never while something is dragged:
 * a drag that paused long enough for them would be held up by them, and they by it, frame after frame.
 * A new round, or a drag, stops one that is under way.
 */
let thumbsRound = 0;
function drawThumbs() {
  if (LIVE || drafting()) return later("thumbs", 300, drawThumbs);   // after the drag
  const round = ++thumbsRound, sizes = [...S.profile.sizes];
  const next = () => {
    if (round !== thumbsRound || LIVE || !sizes.length) return;
    const size = sizes.shift(), cv = $("th-" + sizeKey(size));
    if (cv) paint(cv, size, virtualSize(size.w, size.h)[0] * 0.2);
    setTimeout(next, 0);
  };
  next();
}
let drawQueued = false;
function flushDraw() { if (!drawQueued) return; drawQueued = false; ensureFonts(S.cover.layers); drawMain(); thumbsRound++; later("thumbs", LIVE ? 400 : 140, drawThumbs); }
/** Redraws at most once per frame, however many input events arrive. `stale` false: only what is selected changed. */
function queueDraw(stale = true) {
  if (stale) V3.stale = true;
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(flushDraw);
  setTimeout(flushDraw, 150);   // animation frames pause while the window is hidden
}
new ResizeObserver(() => S.profile && queueDraw()).observe($("stage"));

$("strip").addEventListener("wheel", (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $("strip").scrollLeft += e.deltaY; } }, { passive: false });
function buildStrip() {
  $("strip").replaceChildren(...S.profile.sizes.map((size) => {
    const key = sizeKey(size);
    return el("figure", { class: key === S.sel ? "on" : "", onclick: () => selectSize(key) }, el("canvas", { id: "th-" + key }), el("figcaption", { title: sizeLabel(size) }, sizeCaption(size)));
  }));
}
function selectSize(key) {
  S.sel = key;
  [...$("strip").children].forEach((f, i) => f.classList.toggle("on", sizeKey(S.profile.sizes[i]) === key));
  syncToolbar(); renderSide(); queueDraw();
}
function syncToolbar() {
  const scope = (v) => el("button", { class: "btn" + (S.settings.scope === v ? " on" : ""), onclick: () => { S.settings.scope = v; persistSettings(); syncToolbar(); renderSide(); } }, t("scope." + v));
  $("toolbar").replaceChildren(...[el("span", { class: "name", title: sizeLabel(selSize()) }, sizeLabel(selSize())),
    S.mode === "edit" && el("div", { class: "grp" }, el("span", {}, t("props.scope")), el("div", { class: "seg" }, scope("all"), scope("size"))),
    S.mode === "edit" && el("span", { class: "help", title: t("cover.how"), onclick: (e) => showTip(e.currentTarget, t("cover.how")) }, el("span", { class: "info" }, "ⓘ"), t("cover.howShort"))].filter(Boolean));
}

// ---------- editing layers
function selectLayer(id) { if (S.layerId === id && !group().length) return; S.picked = []; S.layerId = id; renderSide(); queueDraw(false); }
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
  const gone = group().filter((L) => isFree(L.type));
  if (!gone.length) return;
  S.cover.layers = S.cover.layers.filter((L) => !gone.includes(L) && !(L.of && gone.some((g) => g.id === L.of)));   // a photo's linked cut-out goes with it
  S.picked = []; S.layerId = "bg";
  touch({ cover: true, side: true, panel: onCoverTab() });   // the photos listed in the Cover tab follow
}
/** While a slider of one layer is dragged, only that layer is repainted (as in a drag on the canvas); the whole cover once it stops. */
function holdLive(id) { goLive(id); later("live", 300, endLive); }
/**
 * Applies a placement edit to a layer in the current scope, then redraws. A linked cut-out's moves are
 * its photo's (the two move together); its size, angle and stretch are its own, changed about its subject.
 */
function edit(L, patch) {
  const A = owner(L);
  if (A === L) adjust(L, frame(), S.settings.scope, patch);
  else {
    const { ddx, ddy, ...own } = patch;
    if (ddx || ddy) adjust(A, frame(), S.settings.scope, { ddx, ddy });
    if (Object.keys(own).length) { adjust(L, frame(), S.settings.scope, own); aboutSubject(L, own); }
  }
  touch({ cover: true });
}
/**
 * Keeps a cut-out's subject where it is while the cut-out is scaled or turned: the centre of its frame
 * (the hit's px, py) is moved round the subject's (the hit's centre) by the same amount.
 */
function aboutSubject(L, { scale, rot }) {
  const h = $("cv")._hits && $("cv")._hits.find((x) => x.id === L.id);
  if (!h || h.px == null || (!scale && !rot)) return;
  let vx = h.px - h.cx, vy = h.py - h.cy;
  if (scale) { vx *= scale; vy *= scale; }
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
  if (!L || !isRemovable(L.type)) return;
  if (L.type === "photo") S.cover.layers = S.cover.layers.filter((l) => l.of !== L.id);   // a photo's linked cut-out goes with it (not the other way round)
  const i = S.cover.layers.indexOf(L);
  S.cover.layers.splice(i, 1);
  S.layerId = S.cover.layers[Math.max(1, i - 1)].id;
  touch({ cover: true, side: true, panel: onCoverTab() });
}
function duplicateLayer() {
  const L = layer(), c = L && !(L.type === "photo" && L.of) && duplicate(L);   // a linked cut-out is not copied: cut out the photo again
  if (!c) return;
  insertAbove(S.cover.layers, L.id, c); S.layerId = c.id;
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
  return hit ? layer(hit.id) : layer("bg");
}
{
  const cv = $("cv");
  const CURSOR = { rot: "crosshair", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" };
  /** The pointer in the selected layer's own rotated frame, plus the handle under it (if any). */
  function grip(e) {
    const L = layer(), hit = cv._hits && cv._hits.find((h) => h.id === S.layerId);
    if (group().length || !L || !hit || !showsFrame(hit) || L.locked || L.type === "bg" || FIXED.includes(L.type)) return null;
    const p = virtualPoint(e), a = (-hit.r * Math.PI) / 180, dx = p.x - hit.cx, dy = p.y - hit.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const handle = handles(hit, p.k).find((h) => Math.hypot(lx - h.lx, ly - h.ly) <= 11 * p.k);
    return { L, hit, p, lx, ly, handle: handle ? handle.id : null };
  }
  /** The handle of a look's scene object under the pointer, with the ground selected (see sceneHandleAt), or null. */
  function sceneGrip(e) {
    const L = layer();
    if (group().length || !L || L.type !== "bg" || !cv._virtual || S.settings.hideScene) return null;
    const p = virtualPoint(e);
    return sceneHandleAt(cv, p.x, p.y, p.k);
  }
  cv.addEventListener("pointermove", (e) => {
    if (e.buttons || S.mode !== "edit") return;
    const sh = sceneGrip(e);
    cv.title = sh ? `${sceneName(sh.key)} · ${t("scene.dragTip")}` : "";
    if (sh) { cv.style.cursor = "move"; return; }
    const g = grip(e);
    if (g && g.handle) { cv.style.cursor = CURSOR[g.handle]; return; }
    if (S.focus) { cv.style.cursor = focusTargets().length ? "move" : "not-allowed"; return; }
    const L = layerAt(e);
    cv.style.cursor = !L || L.type === "bg" ? "default" : fillsCanvas(L) ? "move" : "grab";
  });
  cv.addEventListener("dblclick", (e) => {   // a scene object's handle: back where the layout puts it
    const sh = S.mode === "edit" && sceneGrip(e);
    if (!sh) return;
    resetScene(S.cover, S.profile.style.look, sh.key, S.settings.scope, frame().key);
    touch({ cover: true, side: true });
  });
  cv.addEventListener("pointerdown", (e) => {
    if (S.mode !== "edit") return;
    const done = (moved) => () => { cv.onpointermove = null; endLive(); if (moved()) renderSide(); };
    // a handle of the layout itself (the diamonds): dragging it changes the template for every cover of this profile
    const at0 = virtualPoint(e), lh = !group().length && layoutHandles(cv, layer()).find((q) => Math.hypot(at0.x - q.x, at0.y - q.y) <= 13 * at0.k);
    if (lh && lh.id[0] === "w") {   // a corner of the perspective: the lettering's block is reshaped
      const L = layer(), b = cv._blocks[L.id], i = Number(lh.id.slice(1)), inv = b.m.inverse(), k = cv._blocks.k;
      const corner = [[0, 0], [1, 0], [1, 1], [0, 1]][i], grab = inv.transformPoint({ x: at0.x * k, y: at0.y * k });
      const start = warpCorners(L.warp, L.fxAmt ?? 1).map((p) => [...p]);
      const off = [grab.x - (b.box.x + (corner[0] + start[i][0]) * b.box.w), grab.y - (b.box.y + (corner[1] + start[i][1]) * b.box.h)];   // keep where in the handle it was grabbed
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m), q = inv.transformPoint({ x: p.x * k, y: p.y * k });
        const w = start.map((c) => [...c]);
        w[i] = [clamp((q.x - off[0] - b.box.x) / b.box.w - corner[0], -1.5, 1.5), clamp((q.y - off[1] - b.box.y) / b.box.h - corner[1], -1.5, 1.5)];
        L.warp = w; touch({ cover: true });
      };
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; renderSide(); };
      return;
    }
    if (lh) {
      const st = S.profile.style, tpl = st.template;
      let moved = false;
      cv.setPointerCapture(e.pointerId);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m), [vw, vh] = cv._virtual;
        st.layoutAdjust[tpl] = dragLayout(cv._layout, vw, vh, st.layoutAdjust[tpl] || {}, lh.id, p.x, p.y, cv._titleBox);
        moved = true; touch({ profile: true });
      };
      cv.onpointerup = cv.onpointercancel = () => { cv.onpointermove = null; if (moved && S.tab.edit === "style") renderPanel(); };
      return;
    }
    const sh = sceneGrip(e);
    if (sh) {   // a scene object of the look, with the ground selected: moved on this cover, for all sizes or this one
      const look = S.profile.style.look, f = frame(), [vw, vh] = cv._virtual;
      let last = at0, moved = false;
      cv.setPointerCapture(e.pointerId);
      // While dragged, only the ground and the frame (where the cyberpunk's sweep is) are repainted, the
      // layers between kept as images (see o.live in render.js) — what a look paints over it all (a light
      // leak, a lens flare) is painted every frame anyway — and in draft (see draftTouch): the ground is
      // most of a look's work, and it is the one thing that changes here
      goLive(["bg", "frame"]);
      cv.onpointermove = (m) => {
        const p = virtualPoint(m);
        moveScene(S.cover, look, sh.key, S.settings.scope, f.key, (p.x - last.x) / vw, (p.y - last.y) / vh);
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
    if (S.focus && group().length) return;   // a group is moved, not scaled
    const L = S.focus ? focusTargets()[0] : layerAt(e);
    if (!L || L.locked || FIXED.includes(L.type) || L.type === "bg") return;
    selectLayer(L.id);
    goLive(L.id); later("live", 300, endLive);
    edit(L, e.altKey ? { rot: e.deltaY > 0 ? 2 : -2 } : { scale: Math.exp(-e.deltaY * 0.0015) });
    later("side", 250, renderSide);
  }, { passive: false });
  $("stage").addEventListener("pointerdown", (e) => { if (e.target === $("stage") && S.mode === "edit" && S.cover && !S.focus) selectLayer("bg"); });
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

// ---------- left panel, Edit mode
function coverTab() {
  const c = S.cover;
  return [
    el("div", {}, cap("cover.category"), el("div", { class: "chips" }, S.profile.categories.map((k) =>
      el("button", { class: k.id === c.catId ? "on" : "", style: `--c:${k.color}`, onclick: () => switchChannel(k.id) }, k.name || k.code || "—"))),
      el("div", { class: "hint" }, t("cover.channelHint")),
      el("button", { class: "btn", style: "margin-top:8px", onclick: copyDialog }, t("copy.open"))),
    el("div", {}, cap("cover.title"),
      el("textarea", { value: c.title, spellcheck: false, oninput: (e) => { c.title = e.target.value; touch({ cover: true }); if (S.layerId === "title") later("side", 700, renderSide); } }),
      el("div", { class: "hint" }, t("cover.titleHint"))),
    el("div", {}, cap("cover.tag"), textInput(c.tag, (v) => { c.tag = v; touch({ cover: true }); }, { placeholder: t("cover.tagPh") })),
    partsBox(),
    photoBox(),
  ];
}
/**
 * Cover → Layout parts: one card for each of the template's layers but the ground; one unticked is left
 * out of this cover (`off`, see layers.js): hidden, gone from the layer list. Ticked again, it is back as it was.
 */
function partsBox() {
  const list = S.cover.layers.filter((l) => !isFree(l.type) && l.type !== "subject" && l.type !== "bg").reverse();   // top first, as in the layer list
  const flip = (L) => {
    if (L.off) { delete L.off; L.visible = true; } else { L.off = true; L.visible = false; if (S.layerId === L.id) S.layerId = "bg"; }
    touch({ cover: true, side: true, panel: true });
  };
  return el("div", {}, el("div", { class: "lhead" }, cap("cover.parts"), info(t("cover.partsTip"))),
    el("div", { class: "fxcards slim" }, list.map((L) => el("button", { class: "fxcard" + (L.off ? "" : " on"), title: t(L.off ? "cover.partOff" : "cover.partOn"), onclick: () => flip(L) },
      el("b", {}, layerName(L)), el("span", {}, t("cover.part." + L.type))))),
    el("div", { class: "hint" }, t("cover.partsHint")));
}
/**
 * Cover → Photos: upload a photo or have one made by the image model, then every photo on this
 * channel's cover as a thumbnail, each with its AI repaint. Everything else about a photo is in its
 * layer's properties.
 */
function photoBox() {
  const here = S.cover.layers.filter((l) => l.type === "photo" && appliesTo(l, cat().id));
  const list = here.filter((l) => !l.of).flatMap((l) => [l, ...here.filter((x) => x.of === l.id)]);   // each photo, then its cut-out
  return el("div", { class: "box" }, cap("cover.photos"),
    photoAdders(true),
    el("div", { class: "hint" }, t("cover.photoHint")),
    list.map(photoItem));
}
/**
 * One photo of the cover: its thumbnail (a click selects its layer, the x that shows on it deletes
 * it), its AI repaint and another picture. A linked cut-out shows its photo's picture without its
 * background, and has neither: it follows its photo.
 */
function photoItem(L) {
  const rec = recordOf(L), im = rec && rec.img, open = REP.for === L.id, passive = !!L.of, tied = passive || passivesOf(L).length > 0;
  const mine = REP.of === L.id, label = open ? "rep.close" : mine && REP.busy ? "rep.running" : mine && REP.result ? "rep.ready" : "rep.title";
  const locked = passive ? t("link.passiveLocked", layerName(owner(L))) : null;
  return el("div", { class: "pitem" + (passive ? " passive" : "") + (L.id === S.layerId ? " on" : ""), dataset: { id: L.id }, style: tied ? `--link:${linkColour(L)}` : null },
    el("div", { class: "thumb", title: t("cover.photoSelect"), onclick: () => focusAllows(L.id) && selectLayer(L.id) },
      im ? el("img", { src: L.cut && rec.mask ? cutThumb(rec) : thumbOf(rec), alt: "" }) : el("div", { class: "hint err", style: "margin:0" }, t("props.photoMissing")),
      el("button", { class: "del", title: t(passivesOf(L).length ? "cover.removeLinked" : "cover.removePhoto"), onclick: (e) => { e.stopPropagation(); if (REP.for === L.id) REP.for = ""; removeLayer(L.id); renderPanel(); } }, "×"),
      el("span", {}, tied && el("span", { class: "chain", innerHTML: ICONS.chain }), layerName(L), im && ` · ${sizeOf(im)[0]} × ${sizeOf(im)[1]}`, rec && rec.original && ` · ${t("rep.isRepainted")}`,
        passive && ` · ${t("link.follows", layerName(owner(L)))}`)),
    el("div", { class: "row", style: "margin-top:6px" },
      el("button", { class: "btn" + (open || (mine && (REP.busy || REP.result)) ? " on" : ""), disabled: passive || !im || (REP.busy && !mine), title: locked,
        onclick: () => { REP.for = open ? "" : L.id; renderPanel(); } }, t(label)),   // a result waits for its photo until the next repaint
      el("button", { class: "btn", disabled: passive || (REP.busy && mine), title: locked, onclick: () => replacePhoto(L) }, t("cover.replacePhoto"))),
    open && im && !passive && repaintBox(L));
}
/**
 * The ways in of a photo — upload, AI generate and (in Cover → Add photos) from the bitmaps — and the
 * AI generation box when it is open. In Cover an upload goes on the cover; in Assets → Bitmaps
 * (`fromLibrary` false) only into the library.
 */
function photoAdders(fromLibrary) {
  return [
    el("div", { class: "row" + (fromLibrary ? " row3" : ""), style: "margin-top:0" },   // in Cover: from assets, upload, AI generate — one line
      fromLibrary && el("button", { class: "btn", title: t("lib.importHint"), onclick: libraryDialog }, t("lib.import")),
      el("button", { class: "btn", title: fromLibrary ? null : t("lib.uploadTip"), onclick: fromLibrary ? uploadPhotos : stockPhotos }, t("cover.upload")),
      el("button", { class: "btn" + (GEN.open ? " on" : ""), onclick: () => { GEN.open = !GEN.open; renderPanel(); } }, t("gen.open"))),
    GEN.open && genBox()];
}
/** Cover → Add photos → From assets: a picture of the bitmaps, chosen, goes on the cover. */
function libraryDialog() {
  const m = $("modal");
  m.replaceChildren(el("div", { class: "dlg", dataset: { kind: "library" } }, el("h2", {}, t("lib.importTitle")),
    el("div", { class: "hint", style: "margin:0;font-size:13px;opacity:.8" }, t("lib.importHint")),
    libraryTiles((pid) => { closeModal(); placePhoto(pid); }, () => { const d = $("modal").querySelector(".dlg"); if (!$("modal").hidden && d && d.dataset.kind === "library") libraryDialog(); }),
    el("button", { class: "btn wide", onclick: closeModal }, t("exp.cancel"))));
  m.hidden = false;
}
/** Asks for photos and keeps them in the bitmap library only (Assets → Bitmaps). */
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
/** Reads one picture's three files at once and puts it in the store; resolves true if it could be read. */
function readPhoto(pid) {
  if (S.photos.has(pid)) return Promise.resolve(true);
  if (!READING.has(pid)) {
    const read = (ext) => files.read(`photos/${pid}${ext}`).catch(() => "");
    READING.set(pid, Promise.all([read(""), read(".original"), read(".mask")])
      .then(([src, original, mask]) => (S.photos.has(pid) ? pid : putPhoto(src || "", { original: original || "", mask: mask || "", pid, save: false })))
      .then((id) => !!id).finally(() => READING.delete(pid)));
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
  const worker = async () => { while (next < todo.length) { const pid = todo[next++]; if (await readPhoto(pid)) { if (each) each(pid); } else missing.push(pid); } };
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
/** Removes the picture files that no cover of any profile shows and the bitmap library does not keep. */
async function prunePhotos() {
  const keep = new Set(S.library.map((e) => e.pid));
  for (const c of Object.values(S.covers)) for (const pid of pidsOf(c)) keep.add(pid);
  for (const p of S.profiles) for (const f of await files.list("covers/" + p.id).catch(() => [])) {
    const c = await readJson(`covers/${p.id}/${f}`).catch(() => null);
    for (const l of (c && Array.isArray(c.layers) && c.layers) || []) if (l && typeof l.pid === "string") keep.add(l.pid);
  }
  for (const f of await files.list("photos").catch(() => [])) if (!keep.has(f.replace(/\.(original|mask)$/, ""))) files.remove(`photos/${f}`).catch(() => null);
}

// ---------- covers: one for each channel of each profile
// Each channel of each profile has a cover of its own — title, tag and layers — in covers/<profile>/<channel>.json.
// A profile's covers are read when it becomes current (S.covers); a channel without one starts from the
// profile's design. What a profile shares among its channels is the profile's: style, sizes, brand.
const defaultTitle = () => (getLang() === "zh" ? "在这里写标题\n*一行*就是一行" : "Write your title\n*one line* each");
/**
 * Channel catId's cover from what was stored (null: a new one, from the profile's design), keeping only
 * the layers that are on that channel (before channels had covers of their own, a layer could be kept to some).
 */
function channelCover(raw, profile, catId) {
  const c = normalizeCover({ ...(raw || {}), catId }, profile);
  c.layers = c.layers.filter((l) => appliesTo(l, catId));
  for (const l of c.layers) delete l.cats;
  if (!raw) c.title = defaultTitle();
  return settleLinks(c);
}
/** This profile's cover of channel catId: the one read or made already, or a new one. */
const coverFor = (catId) => S.covers[catId] || (S.covers[catId] = channelCover(null, S.profile, catId));
/** Reads the covers a profile's channels have. */
async function loadCovers(profile) {
  const out = {};
  for (const c of profile.categories) { const raw = await readJson(coverPath(profile.id, c.id)).catch(() => null); if (raw) out[c.id] = channelCover(raw, profile, c.id); }
  if (profile.layerOrder !== 2) {   // the layout layers' default order changed: the design and covers still in the old one take the new, once
    reorderLayout(profile.design.layers);
    for (const [id, c] of Object.entries(out)) if (reorderLayout(c.layers)) await writeJson(coverPath(profile.id, id), c).catch(fail);
    profile.layerOrder = 2;
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
// Cover → Copy from another profile or channel: its free layers, settings and all, into this cover
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
  const free = COPY.src ? COPY.src.layers.filter((l) => isFree(l.type)) : [];
  const kinds = [["photo", "layers.kind.photo"], ["text", "layers.kind.text"], ["asset", "layers.kind.svg"], ["solid", "layers.kind.solid"]]
    .map(([type, key]) => [t(key), free.filter((l) => l.type === type).length]).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(" · ");
  const m = $("modal");
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("copy.title")),
    el("div", { class: "hint", style: "margin:0 0 12px;font-size:13px;opacity:.8" }, t("copy.hint")),
    cap("copy.profile"), select(S.profiles.map((x) => [x.id, x.name || "—"]), COPY.profile, (v) => pick("profile", v)),
    el("div", { style: "margin-top:12px" }, cap("copy.channel"),
      cats.length ? el("div", { class: "chips" }, cats.map((k) => el("button", { class: k.id === COPY.cat ? "on" : "", style: `--c:${k.color}`, onclick: () => pick("cat", k.id) }, k.name || k.code || "—")))
        : el("div", { class: "hint", style: "margin:0" }, t("copy.noChannel"))),
    COPY.cat && copyPreview(p),
    el("div", { class: "hint", style: "margin:0" }, !COPY.cat ? "" : !COPY.src ? t("copy.reading") : free.length ? t("copy.count", free.length, kinds) : t("copy.none")),
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
  return el("div", {}, box, el("div", { class: "hint", style: "margin:4px 0 0" }, `${size.label || ratioText(size.w, size.h)} · ${size.w} × ${size.h}`));
}
/** Copies the free layers of cover src (of profile p) into the cover on the canvas, as one undo step. */
async function copyInto(p, src) {
  await loadPhotos(pidsOf(src));
  clearTimeout(timers.hist); commitHistory();
  const { layers, copies } = copyFreeLayers(S.cover.layers, src.layers);
  if (!copies.length) return;
  setCover(channelCover({ ...S.cover, layers }, S.profile, S.cover.catId));   // checked as a cover read is
  const top = copies.at(-1).id;
  S.layerId = layer(top) ? top : "title"; S.picked = [];
  closeModal();
  const k = p.categories.find((c) => c.id === src.catId);
  toast(t("copy.done", copies.length, (p.id === S.profile.id ? "" : (p.name || "—") + " · ") + (k ? k.name || k.code : "—")));
  touch({ cover: true, panel: true, side: true });
}
/** The cover's background photo: the lowest photo layer that fills the canvas, on this channel. */
const mainPhoto = () => S.cover.layers.find((l) => fillsCanvas(l) && appliesTo(l, cat().id)) || null;
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
  if (REP.of === L.id && !REP.busy) Object.assign(REP, { of: "", result: null, error: "" });
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
  if (!S.photos.has(pid) && (await loadPhotos([pid])).length) { toast(t("msg.badFile")); return null; }
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
/** Tile for a colour-block shape: applies it to the colour-block layer instead of adding a layer. */
function shapeTile(shape) {
  const cv = el("canvas", { width: 132, height: 132 }), x = cv.getContext("2d"), L = layer("accent");
  x.fillStyle = "#0a0a12"; x.fillRect(0, 0, 132, 132);
  x.scale(0.22, 0.22);
  paintAccent(x, shape, { accent: [[0, 330], [600, 250], [600, 600], [0, 600]], edge: { nx: 0, ny: -1 } }, hexToRgb(cat().color));
  return el("div", { class: "tile", title: t("shape." + shape), style: L.shape === shape ? "border-color:var(--acc)" : "",
    onclick: () => { L.shape = shape; L.visible = true; S.layerId = "accent"; touch({ cover: true, panel: true, side: true }); } }, cv);
}
/** Assets: two panes — vector assets (made in code or by AI, shared by every profile) and the bitmap library. */
function assetsTab() {
  const pane = S.assetPane === "bitmap" ? "bitmap" : "vector", tab = (k) => el("button", { class: pane === k ? "on" : "", onclick: () => { S.assetPane = k; renderPanel(); $("panel").scrollTop = 0; } }, el("span", {}, t("assets.pane." + k)));   // the label dims, not the bars
  return [el("div", { class: "subtabs" }, tab("vector"), tab("bitmap")), ...(pane === "bitmap" ? bitmapPane() : vectorPane())];
}
function vectorPane() {
  const lang = getLang(), mine = [...userAssets.values()];
  return [
    aiSection(),
    mineSection(mine),
    el("div", {}, cap("assets.graphics"), el("div", { class: "tiles" }, GRAPHICS.map((g) => tile({ kind: "graphic", id: g.id })))),
    el("div", {}, cap("assets.shapes"), el("div", { class: "tiles" }, ACCENT_SHAPES.map(shapeTile)), el("div", { class: "hint" }, t("assets.shapesHint"))),
    STICKER_GROUPS.map((g) => el("div", {}, el("label", { class: "cap" }, g.name[lang]), el("div", { class: "tiles" }, STICKERS.filter((s) => s.group === g.id).map((s) => tile({ kind: "sticker", id: s.id }))))),
  ];
}
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
    onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = f.name; input.blur(); } },
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
// Two ways: Apple Vision (macOS 14+, built in) and BiRefNet (any system, a model downloaded in Setup →
// AI → Cut-out, run on this computer by ONNX Runtime; see src-tauri/src/matting.rs).
const isMac = /Mac/i.test(navigator.userAgent);
const canCut = () => native;
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
    const png = engine === "vision" ? await invoke("subject_mask", await photoBytes(img))
      : await invoke("subject_mask_onnx", await photoBytes(img, 2048), { headers: { "x-model": engine } });
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
/**
 * Cuts the subject out of photo layer L into a linked cut-out (see "linked photos"): above the title
 * (or above L, when L is higher), selected. When L has one already, its subject is found again
 * instead. Returns the cut-out, or null.
 */
async function cutOut(L) {
  if (!L || L.type !== "photo" || L.of || CUT.busy || !canCut()) return null;
  const had = passivesOf(L)[0];
  if (!(await ensureMask(L.pid, !!had))) return null;
  if (had) { touch({ cover: true, side: true, panel: true }); toast(t("cut.redone")); return had; }
  const c = newLayer("photo", { of: L.id, cut: true, own: true });
  c.t = alignedT(L);
  if (L.cats) c.cats = [...L.cats];
  const at = (id) => S.cover.layers.findIndex((l) => l.id === id);
  insertAbove(S.cover.layers, at(L.id) > at("title") ? L.id : "title", c);
  S.layerId = c.id; S.picked = [];
  touch({ cover: true, side: true, panel: true });
  toast(t("cut.made"));
  return c;
}

// ---------- repainting a photo with an image model (see repaint.js)
// for: the photo layer whose repaint is open; result: {src, w, h} waiting to be used or dropped; test: the image model's connection check
// for: the photo layer whose repaint is open; of: the one the running repaint, or its result or error, belongs to
const REP = { for: "", of: "", busy: false, job: 0, since: 0, error: "", result: null, test: null, confirmDrop: null };
const onCoverTab = () => S.mode === "edit" && S.tab.edit === "cover";
const repBusyText = () => t("rep.busy", Math.max(0, Math.round((Date.now() - REP.since) / 1000)));
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
  return native
    ? await invoke("ai_request", { url: req.url, headers: Object.entries(req.headers), body, proxy: cfg.proxy || null, timeout: cfg.timeout, image, method })
        .catch((e) => { throw new Error(/timed out/i.test(String(e)) ? t("ai.timedOut", cfg.timeout) : String(e)); })
    : await fetch(req.url, { method, headers: req.headers, body: method === "GET" ? undefined : body, signal: AbortSignal.timeout(cfg.timeout * 1000) }).then(async (r) => ({ status: r.status, text: await r.text() }));
}
/** Checks the image service's key and model without making a picture: {ok, text}, ok being true, false or null (cannot tell). */
async function checkImageAi(cfg) {
  const ask = async (list) => { const a = await imageSend(cfg, imageCheck(cfg, list), false); return readImageCheck(cfg, a.status, a.text, list); };
  let r = await ask(false);
  if (r.again) r = await ask(true);
  return { ok: r.ok, text: t("img.check." + r.key, cfg.model) + (r.detail ? ` (${r.detail})` : "") };
}
/**
 * Sends a prompt, with a picture or without (`pic` null: a new picture is made), to the image model
 * and returns the picture that comes back: {src, w, h}. `shape` {w, h} is the shape to ask for when
 * it is not the picture's; asking for it also tells a Gemini model, which otherwise copies the picture's.
 */
async function imageCall(cfg, prompt, pic, shape = null) {
  const req = buildImageRequest(cfg, prompt, pic, (shape || pic).w, (shape || pic).h, { shape: !!shape });
  let reply = await imageSend(cfg, req);
  // a model that does not take one of the optional settings says so: ask again without it
  for (let k = 0, key; k < 3 && (key = refusedParam(reply.status, reply.text, req.body)); k++) { delete req.body[key]; reply = await imageSend(cfg, req); }
  const out = readImageReply(cfg.provider, reply.status, reply.text);
  if (out.error) throw new Error(out.error);
  // some services leave the picture at a link instead of sending it
  const img = out.image || (native
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
  if (preset) { try { text = await styleText(preset); } catch (e) { REP.error = String(e.message); return renderPanel(); } }
  const P = repTarget(), job = ++REP.job, from = rec.original ? await loadImage(rec.original) : rec.img;
  const prompt = repaintPrompt({ source: mine || preset ? "text" : "look", look: S.profile.style.look, color: cat().color, text, notes: cfg.notes });
  Object.assign(REP, { of: P.id, busy: true, error: "", result: null, since: Date.now() });
  renderPanel();
  const tick = setInterval(() => { const b = document.getElementById("rep-go"); if (b && REP.busy) b.textContent = repBusyText(); }, 1000);
  let result = null, error = "";
  try {
    result = await imageCall(cfg, prompt, shrink(from || rec.img, 1536));
    result.pid = await putPhoto(result.src, { original: rec.original || rec.src });   // a picture of its own, which remembers the one it was painted from
    keepPicture(result.pid, t("lib.repaintOf", layer(P.id) ? layerName(P) : ""), "repaint");
  }
  catch (e) { error = String(e && e.message ? e.message : e); }
  clearInterval(tick);
  if (job !== REP.job) return;                       // cancelled meanwhile
  Object.assign(REP, { busy: false, result, error });
  if (REP.for !== P.id && layer(P.id)) toast(t(error ? "rep.failedToast" : "rep.readyToast", layerName(P)));   // closed meanwhile: it waits under the photo's AI repaint
  if (onCoverTab()) renderPanel();
}
function cancelRepaint() { REP.job++; Object.assign(REP, { of: "", busy: false, error: "", result: null }); renderPanel(); }
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
  const names = (await files.list(MY_DIR).catch(() => [])).filter((f) => /^[a-z0-9][a-z0-9-]*\.md$/.test(f)).slice(0, MAX_STYLES);
  const out = [];
  for (const f of names) { const text = await files.read(`${MY_DIR}/${f}`).catch(() => null); if (text != null) out.push(userStyle(f, text)); }
  return out.sort((a, b) => a.order - b.order || a.name[getLang()].localeCompare(b.name[getLang()]));
}
/** Reads the folder again; redraws the panel if anything changed. */
async function refreshMyStyles() {
  const was = JSON.stringify(S.myStyles.map((s) => [s.id, s.meta, s.body]));
  S.myStyles = await loadMyStyles();
  if (JSON.stringify(S.myStyles.map((s) => [s.id, s.meta, s.body])) === was) return;
  if (S.imageAi.source.startsWith("my:") && !myStyle()) { S.imageAi.source = "look"; persistImageAi(); }   // its file is gone
  if (onCoverTab() && !(document.activeElement && document.activeElement.closest && document.activeElement.closest(".rep"))) renderPanel();
}
addEventListener("focus", () => { if (S.cover) refreshMyStyles(); });
const saveMyStyle = (st) => later("style-" + st.id, 400, () => files.write(`${MY_DIR}/${st.file}`, writeStyle(st.meta, st.body)).catch(fail));
/** Writes a new style file of the user's own and selects it. */
async function addStyle(meta, body) {
  if (S.myStyles.length >= MAX_STYLES) return toast(t("rep.tooMany", MAX_STYLES));
  const id = freeId(Date.now().toString(36), S.myStyles.map((s) => s.id));
  await files.write(`${MY_DIR}/${id}.md`, writeStyle(meta, body)).catch(fail);
  S.myStyles = await loadMyStyles();
  S.imageAi = normalizeImageAi({ ...S.imageAi, source: "my:" + id }); persistImageAi(); renderPanel();
}
/** Brings in a style file from elsewhere (one shared by someone, a skill's SKILL.md…), kept as it is. */
async function importStyle() {
  const f = await pickFile(".md,.markdown,.txt,text/markdown,text/plain");
  if (!f) return renderPanel();
  const text = await readAs(f, "readAsText");
  const id = freeId(f.name, S.myStyles.map((s) => s.id)), st = userStyle(id + ".md", text);
  if (!st.prompt) { toast(t("rep.importEmpty")); return renderPanel(); }
  // a file without a header gets one, named after the file; one with a header is kept word for word
  const out = /^\uFEFF?---\r?\n/.test(text) ? text : writeStyle({ name: f.name.replace(/\.[^.]+$/, "") }, text);
  await files.write(`${MY_DIR}/${id}.md`, out).catch(fail);
  S.myStyles = await loadMyStyles();
  S.imageAi = normalizeImageAi({ ...S.imageAi, source: "my:" + id }); persistImageAi(); renderPanel();
  toast(t("rep.imported", st.name[getLang()]));
}
/** Writes out the styles image-ai.json held before they were files, once. */
async function migrateStyles(raw) {
  const old = legacyStyles(raw);
  if (!old.length) return;
  const have = await files.list(MY_DIR).catch(() => []);
  for (const s of old) if (!have.includes(s.id + ".md")) await files.write(`${MY_DIR}/${s.id}.md`, writeStyle({ name: s.name }, s.prompt)).catch(fail);
  await writeJson("image-ai.json", S.imageAi).catch(fail);   // without them from now on
}
/** The AI repaint of photo layer P: where the style comes from, what to add, the result beside the original. */
function repaintBox(P) {
  const c = S.imageAi, lang = getLang(), rec = recordOf(P);
  const set = (k, v, redraw = false) => { S.imageAi = normalizeImageAi({ ...S.imageAi, [k]: v }); persistImageAi(); if (redraw) renderPanel(); };
  /** Edits the selected style of the user's own and saves its file (typing must not rebuild the form). */
  const rename = (v) => { const st = myStyle(); if (!st) return; delete st.meta["name.zh"]; delete st.meta["name.en"]; st.meta.name = v; st.name = { zh: v, en: v }; saveMyStyle(st); };
  const rewrite = (v) => { const st = myStyle(); if (!st) return; st.body = v; st.prompt = promptOf(v); saveMyStyle(st); };
  if (!imageReady(c)) {
    return el("div", { class: "rep" }, el("div", { class: "hint", style: "margin:0 0 10px" }, t("rep.needSetup")),
      el("button", { class: "btn wide", onclick: () => { S.tab.setup = "ai"; setMode("setup"); } }, t("rep.goSetup")));
  }
  const look = LOOKS[S.profile.style.look] || LOOKS.cel, ours = REP.of === P.id, r = ours ? REP.result : null;
  const sources = [["look", t("rep.src.look", look.name[lang])],
    { group: t("rep.src.preset"), items: S.repaintStyles.map((s) => ["preset:" + s.id, s.name[lang]]) },
    { group: t("rep.src.mine"), items: S.myStyles.map((s) => ["my:" + s.id, s.name[lang]]) },
    ["+new", t("rep.src.new")], ["+import", t("rep.src.import")], native && ["+folder", t("rep.src.folder")]].filter(Boolean);
  const command = (v) => {
    if (v === "+new") return addStyle({ name: t("rep.newName", S.myStyles.length + 1) }, "");
    if (v === "+import") return importStyle();
    if (v === "+folder") { invoke("reveal_data_dir", { dir: MY_DIR }).catch(fail); return renderPanel(); }   // the menu goes back to the style in use
    set("source", v, true);
  };
  const mine = myStyle(), preset = builtIn();
  /** Fills a <pre> with a built-in style's prompt the first time it is opened. */
  const peek = (e) => { const pre = e.currentTarget.querySelector("pre"); if (e.currentTarget.open && !pre.textContent) styleText(preset).then((x) => { pre.textContent = x; }, (err) => { pre.textContent = String(err.message); }); };
  return el("div", { class: "rep" },
    select(sources, c.source, command),
    preset && [
      preset.about && el("div", { class: "about" }, preset.about[lang]),
      preset.credit && el("div", { class: "hint" }, t("rep.credit", preset.credit)),
      el("details", { class: "peek", ontoggle: peek }, el("summary", {}, t("rep.peek")), el("pre", {})),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: async () => addStyle({ name: preset.name[lang] + t("rep.copySuffix"), ...(preset.credit ? { credit: preset.credit } : {}) }, await styleText(preset).catch(() => "")) }, t("rep.copy"))],
    mine && [
      mine.about && el("div", { class: "about" }, mine.about[lang]),
      mine.credit && el("div", { class: "hint" }, t("rep.credit", mine.credit)),
      el("div", { style: "margin-top:8px" }, textInput(mine.name[lang], rename, { placeholder: t("rep.namePh"), maxLength: 60, onchange: () => renderPanel() })),
      el("textarea", { value: mine.body, spellcheck: false, style: "height:160px;font-size:13px;margin-top:8px", placeholder: t("rep.customPh"), oninput: (e) => rewrite(e.target.value) }),
      el("div", { class: "hint" }, t("rep.customHint", `repaint-styles/${mine.file}`)),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: async () => {
        if (REP.confirmDrop !== mine.id) { REP.confirmDrop = mine.id; renderPanel(); return; }   // a second click confirms
        REP.confirmDrop = null;
        await files.remove(`${MY_DIR}/${mine.file}`).catch(fail);
        S.myStyles = await loadMyStyles(); S.imageAi = normalizeImageAi({ ...c, source: "look" }); persistImageAi(); renderPanel();
      } }, t(REP.confirmDrop === mine.id ? "rep.dropSure" : "rep.drop", mine.name[lang]))],
    el("div", { style: "margin-top:8px" }, textInput(c.notes, (v) => set("notes", v), { placeholder: t("rep.notesPh"), maxLength: 600, disabled: REP.busy })),
    el("button", { id: "rep-go", class: "btn solid wide", style: "margin-top:10px", disabled: REP.busy, onclick: repaintPhoto }, REP.busy ? repBusyText() : t(r ? "rep.again" : "rep.go")),
    REP.busy && el("button", { class: "btn wide", style: "margin-top:8px", onclick: cancelRepaint }, t("ai.cancel")),
    ours && REP.error && el("div", { class: "hint err" }, t("msg.failed", REP.error)),
    r && [
      el("div", { class: "compare one" },
        el("figure", {}, el("img", { src: r.src, alt: "" }), el("figcaption", {}, `${t("rep.after")} · ${r.w} × ${r.h}`))),
      el("div", { class: "row" },
        el("button", { class: "btn solid", onclick: useRepaint }, t("rep.use")),
        el("button", { class: "btn", onclick: () => { REP.result = null; renderPanel(); } }, t("ai.discard")))],
    rec.original && el("button", { class: "btn wide", style: "margin-top:8px", disabled: REP.busy, onclick: () => restoreOriginal(P) }, t("rep.restore")),
    el("div", { class: "hint" }, t("rep.hint", t("img.provider." + c.provider), c.model)));
}
// ---------- a photo made by the image model, from words and perhaps a reference picture
// ref: {mime, data, url, w, h} of the reference; result: {src, w, h} waiting to be added or dropped
const GEN = { open: false, busy: false, job: 0, since: 0, prompt: "", ref: null, error: "", result: null };
const genBusyText = () => t("gen.busy", Math.max(0, Math.round((Date.now() - GEN.since) / 1000)));
/** Makes a picture in the shape of the size on the canvas. */
async function generatePhoto() {
  const text = GEN.prompt.trim(), ref = GEN.ref, size = selSize();
  if ((!text && !ref) || GEN.busy) return;
  const job = ++GEN.job;
  Object.assign(GEN, { busy: true, error: "", result: null, since: Date.now() });
  renderPanel();
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
  if (onCoverTab() || onBitmapPane()) renderPanel();
}
function cancelGeneratePhoto() { GEN.job++; Object.assign(GEN, { busy: false, error: "", result: null }); renderPanel(); }
/** Takes a picture as the reference for the next one made: sent along, at most 1536 px on its longer side. */
async function pickGenRef() {
  const f = await pickFile("image/png,image/jpeg,image/webp");
  if (!f) return;
  const im = await loadImage(await readAs(f, "readAsDataURL"));
  if (!im) return toast(t("msg.badFile"));
  GEN.ref = shrink(im, 1536); renderPanel();
}
async function keepGeneratedPhoto() {
  const r = GEN.result;
  if (!r) return;
  GEN.result = null;
  if (!(await (r.pid ? placePhoto(r.pid) : addPhoto(r.src)))) renderPanel();
}
/** Cover → Photos → AI generate. */
function genBox() {
  const c = S.imageAi, r = GEN.result, size = selSize();
  if (!imageReady(c)) {
    return el("div", { class: "rep" }, el("div", { class: "hint", style: "margin:0 0 10px" }, t("gen.needSetup")),
      el("button", { class: "btn wide", onclick: () => { S.tab.setup = "ai"; S.aiPane = "image"; setMode("setup"); } }, t("rep.goSetup")));
  }
  return el("div", { class: "rep" },
    el("textarea", { value: GEN.prompt, spellcheck: false, maxLength: 2000, disabled: GEN.busy, style: "height:84px;font-size:14px", placeholder: t(GEN.ref ? "gen.phRef" : "gen.ph"), oninput: (e) => { GEN.prompt = e.target.value; } }),
    GEN.ref
      ? el("div", { class: "ref" }, el("img", { src: GEN.ref.url, alt: "" }), el("span", {}, t("gen.refOn")),
          el("button", { class: "btn", disabled: GEN.busy, onclick: () => { GEN.ref = null; renderPanel(); } }, t("ai.refRemove")))
      : el("button", { class: "btn wide", style: "margin-top:8px", disabled: GEN.busy, onclick: pickGenRef }, t("gen.refAdd")),
    el("button", { id: "gen-go", class: "btn solid wide", style: "margin-top:10px", disabled: GEN.busy, onclick: generatePhoto }, GEN.busy ? genBusyText() : t(r ? "gen.again" : "gen.go")),
    GEN.busy && el("button", { class: "btn wide", style: "margin-top:8px", onclick: cancelGeneratePhoto }, t("ai.cancel")),
    GEN.error && el("div", { class: "hint err" }, t("msg.failed", GEN.error)),
    r && [
      el("div", { class: "thumb" }, el("img", { src: r.src, alt: "" }), el("span", {}, `${r.w} × ${r.h}`)),
      el("div", { class: "row" },
        el("button", { class: "btn solid", onclick: keepGeneratedPhoto }, t("gen.keep")),
        el("button", { class: "btn", onclick: () => { GEN.result = null; renderPanel(); } }, t("ai.discard")))],
    el("div", { class: "hint" }, t("gen.hint", t("img.provider." + c.provider), c.model, sizeCaption(size))));
}
/** The image model's settings: Setup → AI → Image model. */
function imageAiPane() {
  const c = S.imageAi, d = IMAGE_DEFAULTS[c.provider];
  const ep = el("div", { class: "hint", style: "margin-top:-10px;word-break:break-all" }, t("ai.endpoint", imageEndpoint(c)));
  const testBtn = el("button", { class: "btn wide", disabled: !imageReady(c), onclick: () => test() }, t("ai.test"));
  const set = (k, v, redraw = false) => {
    S.imageAi = normalizeImageAi({ ...S.imageAi, [k]: v }); REP.test = null; persistImageAi();
    if (redraw) return renderPanel();
    ep.textContent = t("ai.endpoint", imageEndpoint(S.imageAi)); testBtn.disabled = !imageReady(S.imageAi);
  };
  const test = async () => {
    REP.test = { ok: null, text: t("ai.testing") }; renderPanel();
    try { REP.test = await checkImageAi(S.imageAi); } catch (e) { REP.test = { ok: false, text: t("msg.failed", String(e && e.message ? e.message : e)) }; }
    if (S.mode === "setup" && S.tab.setup === "ai") renderPanel();
  };
  const field = (key, k, props = {}) => el("div", {}, cap(key), textInput(c[k], (v) => set(k, v), props));
  return [
    el("div", { class: "hint", style: "margin:0" }, t("img.intro")),
    el("div", {}, cap("img.provider"), select(IMAGE_PROVIDERS.map((k) => [k, t("img.provider." + k)]), c.provider, (v) => set("provider", v, true))),
    field("ai.baseUrl", "baseUrl", { placeholder: d.baseUrl }), ep,
    field("ai.token", "token", { type: "password", placeholder: t("ai.tokenPh"), autocomplete: "off" }),
    field("ai.model", "model", { placeholder: t("img.modelPh", d.model) }),
    el("div", { class: "hint", style: "margin-top:-10px" }, t("img.modelHint." + c.provider)),
    el("div", {}, cap("ai.timeout"), el("input", { type: "number", min: 30, max: 1800, step: 30, value: c.timeout, onchange: (e) => set("timeout", e.target.value, true) })),
    field("ai.proxy", "proxy", { placeholder: "http://127.0.0.1:7890" }),
    testBtn,
    testLine(REP.test),
    el("div", { class: "hint" }, t("img.testHint")),
    el("div", { class: "hint" }, t("img.privacy")),
  ];
}
const AI = { target: "", busy: false, error: "", result: null, test: "", job: 0, since: 0, attempt: 1, image: null };   // image: {mime, data, url} of a reference picture
const AI_RETRIES = 3;                      // extra attempts when a reply does not follow the format
/** Sends one prompt to the configured endpoint and returns {text, truncated}. Throws with the provider's message. */
async function aiCall(cfg, system, user) {
  const req = buildRequest(cfg, system, user), body = JSON.stringify(req.body);
  const reply = native
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
const onAssetsTab = () => S.mode === "edit" && S.tab.edit === "assets";
async function generateAsset() {
  const target = AI.target.trim(), image = AI.image;
  if ((!target && !image) || AI.busy) return;   // a picture alone is enough to go on
  const job = ++AI.job;
  Object.assign(AI, { busy: true, error: "", result: null, since: Date.now(), attempt: 1 });
  renderPanel();
  const tick = setInterval(() => { const b = document.getElementById("ai-go"); if (b && AI.busy) b.textContent = aiBusyText(); }, 1000);
  let result = null, error = "";
  try { result = await requestSpec(S.ai, target, (n) => { if (job === AI.job) AI.attempt = n; }, () => job === AI.job, image); }
  catch (e) { error = String(e && e.message ? e.message : e); if (image && /^HTTP 4\d\d/.test(error)) error += " " + t("ai.noVision"); }
  clearInterval(tick);
  if (job !== AI.job) return;                       // cancelled meanwhile: the late answer is dropped
  Object.assign(AI, { busy: false, result, error });
  if (onAssetsTab()) renderPanel();
}
/** Stops waiting for the reply. The request itself cannot be recalled, so the provider may still bill it. */
function cancelGenerate() { AI.job++; Object.assign(AI, { busy: false, error: "", result: null }); renderPanel(); }
const aiBusyText = () => t("ai.busy", Math.max(0, Math.round((Date.now() - AI.since) / 1000))) + (AI.attempt > 1 ? t("ai.attempt", AI.attempt) : "");
async function keepGenerated() {
  const spec = AI.result;
  if (!spec) return;
  const a = putSpecAsset("a" + uid(), spec.name[getLang()], spec);
  await saveAssetRecord(a).catch(fail);
  AI.result = null;
  toast(t("ai.saved", a.name));
  renderPanel();
}
/**
 * Takes a picture as the reference for the next generation. It is scaled down to at most 768 px
 * and stored as JPEG: enough for a model to see what the thing is, and a fraction of the upload.
 */
async function pickReference() {
  const f = await pickFile("image/png,image/jpeg,image/webp");
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
  renderPanel();
}
function specPreview(spec, tint) {
  const cv = el("canvas", { width: 220, height: 220 }), x = cv.getContext("2d");
  x.translate(110, 110); x.scale(0.95, 0.95);
  drawSpec(x, spec, tint);
  return el("div", { class: "tile", style: "cursor:default" }, cv);
}
function aiSection() {
  if (!aiReady(S.ai)) {
    return el("div", { class: "box" }, cap("ai.title"), el("div", { class: "hint", style: "margin:0 0 10px" }, t("ai.needSetup")),
      el("button", { class: "btn wide", onclick: () => { S.tab.setup = "ai"; setMode("setup"); } }, t("ai.goSetup")));
  }
  const r = AI.result;
  const setKind = (k) => { S.ai = normalizeAi({ ...S.ai, kind: k }); persistAi(); renderPanel(); };
  return el("div", { class: "box" }, cap("ai.title"),
    el("div", { class: "seg", style: "margin-bottom:10px" }, AI_KINDS.map((k) => el("button", { class: "btn" + (S.ai.kind === k ? " on" : ""), style: "flex:1", disabled: AI.busy, title: t("ai.kindHint." + k), onclick: () => setKind(k) }, t("ai.kind." + k)))),
    textInput(AI.target, (v) => { AI.target = v; }, { placeholder: t(AI.image ? "ai.targetPhImage" : "ai.targetPh"), maxLength: 300, disabled: AI.busy, onkeydown: (e) => { if (e.key === "Enter") generateAsset(); } }),
    AI.image
      ? el("div", { class: "ref" }, el("img", { src: AI.image.url, alt: "" }), el("span", {}, t("ai.refOn")),
          el("button", { class: "btn", disabled: AI.busy, onclick: () => { AI.image = null; renderPanel(); } }, t("ai.refRemove")))
      : el("button", { class: "btn wide", style: "margin-top:8px", disabled: AI.busy, onclick: pickReference }, t("ai.refAdd")),
    el("button", { id: "ai-go", class: "btn solid wide", style: "margin-top:10px", disabled: AI.busy, onclick: generateAsset }, AI.busy ? aiBusyText() : t(r ? "ai.again" : "ai.generate")),
    AI.busy && el("button", { class: "btn wide", style: "margin-top:8px", onclick: cancelGenerate }, t("ai.cancel")),
    AI.error && el("div", { class: "hint err" }, t("msg.failed", AI.error)),
    r && [
      el("div", { class: "tiles", style: "grid-template-columns:1fr 1fr;margin-top:12px" }, specPreview(r, null), specPreview(r, cat().color)),
      el("div", { class: "hint" }, t("ai.previewHint", r.name[getLang()])),
      el("div", { class: "row" },
        el("button", { class: "btn solid", onclick: keepGenerated }, t("ai.keep")),
        el("button", { class: "btn", onclick: () => { AI.result = null; renderPanel(); } }, t("ai.discard"))),
    ],
    el("div", { class: "hint" }, t("ai.kindHint." + S.ai.kind) + " " + t("ai.hint", S.ai.model)));
}
/** A connection test's outcome, in green when it worked and red when it did not. */
const testLine = (r) => r && el("div", { class: `hint ${r.ok === true ? "ok" : r.ok === false ? "err" : ""}`, style: "margin-top:-8px;word-break:break-word" }, r.text);
/** Setup → AI: the text model (assets) and the image model (photo repaint), one pane at a time. */
function aiTab() {
  const pane = S.aiPane || "text", tab = (k) => el("button", { class: "btn" + (pane === k ? " on" : ""), onclick: () => { S.aiPane = k; renderPanel(); } }, t("ai.pane." + k));
  return [el("div", { class: "seg wide" }, tab("text"), tab("image"), tab("cut")), ...(pane === "image" ? imageAiPane() : pane === "cut" ? cutPane() : textAiPane())];
}
// ---------- Setup → AI → Cut-out: the way of cutting out, and the BiRefNet models
const CUTDL = { id: "", done: 0, total: 0, error: "", confirmDrop: "" };   // the download running, if any
const mb = (n) => Math.round(n / 1048576);
if (native && globalThis.__TAURI__.event) globalThis.__TAURI__.event.listen("cut-model-progress", (e) => {
  Object.assign(CUTDL, { done: e.payload.done, total: e.payload.total });
  const bar = document.getElementById("cutdl-" + e.payload.id);
  if (bar) bar.textContent = t("cutset.progress", Math.floor((100 * e.payload.done) / Math.max(1, e.payload.total)), mb(e.payload.done), mb(e.payload.total));
});
const onCutPane = () => S.mode === "setup" && S.tab.setup === "ai" && S.aiPane === "cut";
async function refreshCutModels() { S.cutModels = native ? await invoke("cut_models").catch(() => []) : []; }
async function downloadModel(id) {
  if (CUTDL.id) return;
  Object.assign(CUTDL, { id, done: 0, total: 0, error: "" }); renderPanel();
  try { await invoke("cut_model_download", { id, proxy: S.settings.cutProxy || null }); }
  catch (e) { const msg = String(e && e.message ? e.message : e); CUTDL.error = /cancelled/.test(msg) ? "" : t("msg.failed", msg); }
  CUTDL.id = ""; await refreshCutModels();
  if (S.cutModels.some((m) => m.id === id && m.have)) { CUT.needModel = false; CUT.error = ""; toast(t("cutset.done", t("cutset.engine." + id))); }
  if (onCutPane()) renderPanel();
}
async function dropModel(id) {
  if (CUTDL.confirmDrop !== id) { CUTDL.confirmDrop = id; return renderPanel(); }
  CUTDL.confirmDrop = "";
  await invoke("cut_model_delete", { id }).catch(fail);
  await refreshCutModels(); renderPanel();
}
function cutPane() {
  if (!native) return [el("div", { class: "hint", style: "margin:0" }, t("cutset.needsApp"))];
  const engines = [isMac && "vision", "birefnet-lite", "birefnet"].filter(Boolean), now = cutEngine();
  const setting = (k, v, redraw) => { S.settings[k] = v; persistSettings(); if (redraw) renderPanel(); };
  const row = (m) => {
    const busy = CUTDL.id === m.id;
    return el("div", { class: "cutmodel" },
      el("div", {}, el("b", {}, t("cutset.engine." + m.id)), el("div", { class: "hint", style: "margin:2px 0 0" }, busy ? el("span", { id: "cutdl-" + m.id }, t("cutset.starting")) : t(m.have ? "cutset.have" : "cutset.missing", mb(m.bytes)))),
      busy ? el("button", { class: "btn", onclick: () => invoke("cut_model_cancel").catch(fail) }, t("cutset.cancel"))
        : m.have ? el("button", { class: "btn", onclick: () => dropModel(m.id) }, t(CUTDL.confirmDrop === m.id ? "cutset.dropSure" : "cutset.drop"))
        : el("button", { class: "btn", disabled: !!CUTDL.id, onclick: () => downloadModel(m.id) }, t("cutset.download")));
  };
  return [
    el("div", { class: "hint", style: "margin:0" }, t("cutset.intro")),
    el("div", {}, cap("cutset.way"), select(engines.map((k) => [k, t("cutset.engine." + k)]), now, (v) => setting("cutEngine", v, true)),
      !cutReady(now) && el("div", { class: "hint err" }, t("cutset.wayMissing"))),
    el("div", {}, cap("cutset.models"), S.cutModels.map(row), CUTDL.error && el("div", { class: "hint err" }, CUTDL.error),
      el("div", { class: "hint" }, t("cutset.speed"))),
    el("div", {}, cap("cutset.proxy"), textInput(S.settings.cutProxy, (v) => setting("cutProxy", v.trim()), { placeholder: "http://127.0.0.1:7890" }), el("div", { class: "hint" }, t("cutset.proxyHint"))),
    el("button", { class: "btn wide", onclick: () => invoke("reveal_data_dir", { dir: "models" }).catch(fail) }, t("cutset.folder")),
    el("div", { class: "hint" }, t("cutset.licence")),
  ];
}
function textAiPane() {
  const c = S.ai, ph = AI_PLACEHOLDER[c.style];
  const where = () => (aiReady(S.ai) ? t("ai.endpoint", endpoint(S.ai)) : "");
  const ep = el("div", { class: "hint", style: "margin-top:-10px;word-break:break-all" }, where());
  const testBtn = el("button", { class: "btn wide", disabled: !aiReady(c), onclick: () => test() }, t("ai.test"));
  const set = (k, v, redraw = false) => {
    S.ai = normalizeAi({ ...S.ai, [k]: v }); AI.test = ""; persistAi();
    if (redraw) return renderPanel();
    ep.textContent = where(); testBtn.disabled = !aiReady(S.ai);       // typing must not rebuild the form
  };
  const field = (key, k, props = {}) => el("div", {}, cap(key), textInput(c[k], (v) => set(k, v), props));
  const test = async () => {
    AI.test = { ok: null, text: t("ai.testing") }; renderPanel();
    try { const out = await aiCall(S.ai, "Reply with the single word OK.", "ping"); AI.test = { ok: true, text: t("ai.testOk", out.text.trim().slice(0, 60)) }; }
    catch (e) { AI.test = { ok: false, text: t("msg.failed", String(e && e.message ? e.message : e)) }; }
    if (S.mode === "setup" && S.tab.setup === "ai") renderPanel();
  };
  return [
    el("div", { class: "hint", style: "margin:0" }, t("ai.intro")),
    el("div", {}, cap("ai.style"), select(AI_STYLES.map((k) => [k, t("ai.style." + k)]), c.style, (v) => set("style", v, true))),
    field("ai.baseUrl", "baseUrl", { placeholder: ph.baseUrl }),
    ep,
    field("ai.token", "token", { type: "password", placeholder: t("ai.tokenPh"), autocomplete: "off" }),
    field("ai.model", "model", { placeholder: t("ai.modelPh") }),
    c.style === "anthropic" && [
      el("div", {}, cap("ai.auth"), select([["key", t("ai.auth.key")], ["bearer", t("ai.auth.bearer")]], c.auth, (v) => set("auth", v))),
      el("div", {}, cap("ai.maxTokens"), el("input", { type: "number", min: 512, max: 64000, step: 256, value: c.maxTokens, onchange: (e) => set("maxTokens", e.target.value, true) })),
    ],
    el("div", {}, cap("ai.timeout"), el("input", { type: "number", min: 30, max: 1800, step: 30, value: c.timeout, onchange: (e) => set("timeout", e.target.value, true) }),
      el("div", { class: "hint" }, t("ai.timeoutHint"))),
    field("ai.proxy", "proxy", { placeholder: "http://127.0.0.1:7890" }),
    el("div", {}, cap("ai.notes"), el("textarea", { value: c.notes, spellcheck: false, style: "height:84px;font-size:14px", placeholder: t("ai.notesPh"), oninput: (e) => set("notes", e.target.value) })),
    testBtn,
    testLine(AI.test),
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

/** The sliders that adjust the current template: how much the colour panel takes, how its edge leans, the title's box, and which half goes first. */
function layoutBox() {
  const st = S.profile.style, tpl = st.template, adj = st.layoutAdjust[tpl] || {}, cv = flatCanvas();
  const now = cv._layout && cv._virtual ? layoutValues(cv._layout, cv._virtual[0], cv._virtual[1]) : { size: 0.3, slant: 0 };
  const set = (k, v) => { st.layoutAdjust[tpl] = { ...(st.layoutAdjust[tpl] || {}), [k]: v }; draftTouch({ profile: true }); };
  const split = tpl === "split", changed = Object.keys(adj).length > 0;
  // the template and its adjustments, one box (as the look and the default design have)
  return el("div", { class: "box" }, cap("style.template"),
    select(["stack", "split", "banner"].map((k) => [k, t("tpl." + k)]), st.template, (v) => { st.template = v; touch({ profile: true }); later("laybox", 60, renderPanel); }),   // the adjustments' sliders follow the template chosen
    el("div", { style: "margin-top:14px" }, cap("style.layout")),
    slider2(t(split ? "style.laySide" : "style.layBand"), LAYOUT_LIMITS.size[0], LAYOUT_LIMITS.size[1], 0.01, adj.size ?? now.size, (v) => set("size", v)),
    slider2(t("style.laySlant"), LAYOUT_LIMITS.slant[0], LAYOUT_LIMITS.slant[1], 0.005, adj.slant ?? now.slant, (v) => set("slant", v)),
    slider2(t("style.layTitleW"), LAYOUT_LIMITS.tw[0], LAYOUT_LIMITS.tw[1], 0.01, adj.tw ?? 1, (v) => set("tw", v)),
    slider2(t("style.layTitleH"), LAYOUT_LIMITS.th[0], LAYOUT_LIMITS.th[1], 0.01, adj.th ?? 1, (v) => set("th", v)),
    el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: !!adj.flip, onchange: (e) => { set("flip", e.target.checked); renderPanel(); } }), el("span", {}, t(split ? "style.layFlipSplit" : "style.layFlipStack"))),
    el("button", { class: "btn wide", style: "margin-top:10px", disabled: !changed, onclick: () => { delete st.layoutAdjust[tpl]; touch({ profile: true, panel: true }); } }, t("style.layReset")),
    el("div", { class: "hint" }, t("style.layHint")));
}
function styleTab() {
  const st = S.profile.style, set = (k, v) => { st[k] = v; touch({ profile: true }); };
  const L = LOOKS[st.look] || LOOKS.cel, vals = lookParams(st.look, st.lookParams[st.look]);
  const tune = (k, v) => { st.lookParams[st.look] = { ...vals, ...st.lookParams[st.look], [k]: v }; draftTouch({ profile: true }); };
  return [
    el("div", { class: "box" }, cap("style.look"),
      select(LOOK_IDS.map((k) => [k, LOOKS[k].name[getLang()]]), st.look, (v) => { st.look = v; touch({ profile: true, panel: true, side: true, strip: true }); }),
      L.about && el("div", { class: "about" }, L.about[getLang()]),
      el("div", { class: "hint" }, t("style.lookHint")),
      L.params.map((d) => (d.text
        ? el("div", { class: "sl", style: "grid-template-columns:84px 1fr" }, el("span", {}, d.name[getLang()]),
            textInput(vals[d.key], (v) => tune(d.key, v), { maxLength: d.max, placeholder: d.placeholder ? d.placeholder[getLang()] : "" }))
        : d.toggle
        ? el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: vals[d.key] > 0, onchange: (e) => tune(d.key, e.target.checked ? 1 : 0) }), el("span", {}, d.name[getLang()]))
        : d.needsPhoto && !recordOf(mainPhoto())
          ? el("div", { class: "sl off", style: "grid-template-columns:84px 1fr", title: t("style.needsPhoto") }, el("span", {}, d.name[getLang()]), el("span", { class: "why" }, t("style.needsPhoto")))   // nothing for it to act on yet
          : slider2(d.name[getLang()], d.min, d.max, d.step, vals[d.key], (v) => tune(d.key, v)))),
      L.seeded && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { st.lookSeed = Math.floor(Math.random() * 1000000); touch({ profile: true }); } }, t("style.shuffle")),
      L.seeded && el("div", { class: "hint" }, t("style.shuffleHint")),
      L.params.length > 0 && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { delete st.lookParams[st.look]; touch({ profile: true, panel: true }); } }, t("style.lookReset"))),
    layoutBox(),
    el("div", { class: "box" }, cap("style.design"),
      el("button", { class: "btn wide", onclick: () => { S.profile.design.layers = JSON.parse(JSON.stringify(S.cover.layers.filter((l) => l.type !== "photo"))); touch({ profile: true }); toast(t("style.designSaved")); } }, t("style.saveDesign")),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { S.cover.layers = keepPhotos(JSON.parse(JSON.stringify(S.profile.design.layers)), S.cover.layers); S.layerId = "title"; touch({ cover: true, side: true }); } }, t("style.loadDesign")),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { for (const L of S.cover.layers) if (!isFree(L.type)) resetPlacement(L, "all"); touch({ cover: true, side: true }); } }, t("style.resetAll")),
      el("div", { class: "hint" }, t("style.designHint"))),
  ];
}

// ---------- left panel, Setup mode
/** A small picture of graphic `ref` (null: none) in the channel colour `colour`, `px` across. */
function graphicThumb(ref, colour, px) {
  const cv = el("canvas", { width: px * 2, height: px * 2, style: `width:${px}px;height:${px}px` });
  if (ref && assetExists(ref)) { const x = cv.getContext("2d"); x.translate(px, px); x.scale((px * 2) / 700, (px * 2) / 700); useLook(); drawAsset(x, ref, hexToRgb(colour), { tint: ref.kind === "graphic" || canTint(ref) }); }
  return cv;
}
/** A channel's graphic, picked by its picture: channel graphics, my vector assets, the stickers by group, or none. */
function graphicPicker(c, done) {
  const lang = getLang(), m = $("modal"), cur = c.graphic.kind === "none" ? "none" : `${c.graphic.kind}:${c.graphic.id}`;
  const pick = (ref, label) => el("div", { class: "tile" + ((ref ? `${ref.kind}:${ref.id}` : "none") === cur ? " on" : ""), title: label, onclick: () => { closeModal(); done(ref); } },
    ref ? graphicThumb(ref, c.color, 66) : el("span", { class: "none" }, t("cat.none")));
  const group = (title, refs) => (refs.length ? el("div", {}, el("label", { class: "cap" }, title), el("div", { class: "tiles" }, refs.map(([ref, label]) => pick(ref, label)))) : null);
  m.replaceChildren(el("div", { class: "dlg wide" }, el("h2", {}, t("cat.pickTitle")),
    el("div", { class: "tiles" }, pick(null, t("cat.none"))),
    group(t("cat.groupGraphics"), GRAPHICS.map((g) => [{ kind: "graphic", id: g.id }, g.name[lang]])),
    group(t("cat.groupMine"), [...userAssets.values()].map((a) => [{ kind: "user", id: a.id }, a.name])),
    STICKER_GROUPS.map((g) => group(`${t("cat.groupStickers")} · ${g.name[lang]}`, STICKERS.filter((s) => s.group === g.id).map((s) => [{ kind: "sticker", id: s.id }, s.name[lang]]))),
    el("div", { class: "acts" }, el("button", { class: "btn", onclick: closeModal }, t("lookfx.cancel")))));
  m.hidden = false;
}
function brandTab() {
  const P = S.profile, lang = getLang(), struct = () => touch({ profile: true, cover: true, panel: true, side: true });
  const card = (c, i) => {
    const lib = c.graphic.kind === "graphic" && GRAPHICS.find((g) => g.id === c.graphic.id);
    // working on a channel shows that channel on the canvas
    const show = () => { if (S.cover.catId !== c.id) switchChannel(c.id); };
    return el("div", { class: "card", style: `--c:${c.color}`, onfocusin: show, onpointerdown: show, oninput: show },
      el("div", { class: "head" },
        el("input", { type: "color", value: c.color, title: t("cat.color"), oninput: (e) => { c.color = e.target.value; e.target.closest(".card").style.setProperty("--c", c.color); document.documentElement.style.setProperty("--acc", c.color); touch({ profile: true }); } }),
        textInput(c.name, (v) => { c.name = v; touch({ profile: true }); }, { placeholder: t("cat.name") })),
      el("div", { class: "two" },
        textInput(c.sub, (v) => { c.sub = v; touch({ profile: true }); }, { placeholder: t("cat.sub") }),
        textInput(c.code, (v) => { c.code = v; touch({ profile: true }); }, { placeholder: t("cat.code") })),
      el("button", { class: "gpick", title: t("cat.pickTip"), onclick: () => graphicPicker(c, (ref) => { c.graphic = ref ? { kind: ref.kind, id: ref.id, labels: [], stamp: "" } : { kind: "none" }; struct(); }) },
        graphicThumb(c.graphic.kind === "none" ? null : c.graphic, c.color, 44), el("span", {}, c.graphic.kind === "none" ? t("cat.none") : assetExists(c.graphic) ? assetName(c.graphic, lang) : t("assets.missing")), el("span", { class: "more" }, t("cat.pick"))),
      lib && lib.labels && textInput((c.graphic.labels || []).join("，"), (v) => { c.graphic.labels = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 4); touch({ profile: true }); }, { placeholder: t("cat.labels") }),
      lib && lib.stamp && textInput(c.graphic.stamp || "", (v) => { c.graphic.stamp = v; touch({ profile: true }); }, { placeholder: t("cat.stamp") }),
      el("div", { class: "acts" },
        el("button", { class: "btn", disabled: i === 0, onclick: () => { P.categories.splice(i - 1, 0, P.categories.splice(i, 1)[0]); struct(); } }, t("cat.up")),
        el("button", { class: "btn", disabled: i === P.categories.length - 1, onclick: () => { P.categories.splice(i + 1, 0, P.categories.splice(i, 1)[0]); struct(); } }, t("cat.down")),
        el("button", { class: "btn", onclick: () => {
          if (P.categories.length < 2) return toast(t("msg.lastCategory"));
          const [gone] = P.categories.splice(i, 1);
          delete S.covers[gone.id]; files.remove(coverPath(P.id, gone.id)).catch(() => null);   // its cover goes with it
          if (S.cover.catId === gone.id) { S.settings.channels[P.id] = P.categories[0].id; persistSettings(); setCover(coverFor(P.categories[0].id)); loadPhotos(pidsOf(S.cover)).then(() => queueDraw()); }
          else setCover(normalizeCover(S.cover, P));
          struct();
        } }, t("cat.remove"))));
  };
  const act = (key) => el("button", { class: "btn", onclick: profileActions[key] }, t("prof." + key));
  return [
    el("div", { class: "box" }, cap("prof.manage"), el("div", { class: "acts", style: "justify-content:flex-start" }, ["new", "duplicate", "delete", "import", "export"].map(act))),
    el("div", {}, cap("brand.profileName"), textInput(P.name, (v) => { P.name = v; touch({ profile: true }); later("top", 600, syncTop); })),
    el("div", {}, cap("brand.name"), textInput(P.brand.name, (v) => { P.brand.name = v; touch({ profile: true }); })),
    el("div", {}, cap("brand.unit"), textInput(P.brand.unit, (v) => { P.brand.unit = v; touch({ profile: true }); }), el("div", { class: "hint" }, t("brand.unitHint"))),
    el("div", {}, cap("brand.categories"), el("div", { style: "display:grid;gap:10px" }, P.categories.map(card),
      el("button", { class: "btn wide", onclick: () => {
        const palette = ["#ffb703", "#fb5607", "#3a86ff", "#a855f7", "#06d6a0", "#ff5fa2"];
        P.categories.push({ id: uid(), name: t("cat.new"), sub: "", code: "", color: palette[P.categories.length % palette.length], graphic: { kind: "graphic", id: GRAPHICS[P.categories.length % GRAPHICS.length].id, labels: [], stamp: "" } });
        struct();
      } }, t("brand.add")))),
  ];
}
function sizesTab() {
  const P = S.profile, se = S.settings;
  const has = (s) => P.sizes.some((x) => sizeKey(x) === sizeKey(s));
  const toggle = (s, on) => {
    if (on && !has(s)) P.sizes.push({ w: s.w, h: s.h, label: s.label || "", name: "" });
    if (!on) { if (P.sizes.length < 2) return renderPanel(); P.sizes = P.sizes.filter((x) => sizeKey(x) !== sizeKey(s)); }
    if (!P.sizes.some((x) => sizeKey(x) === S.sel)) S.sel = sizeKey(P.sizes[0]);
    syncToolbar(); touch({ profile: true, strip: true, panel: true });
  };
  const custom = P.sizes.filter((s) => !SIZE_PRESETS.some((p) => sizeKey(p) === sizeKey(s)));
  const row = (s) => el("label", { class: "chk" }, el("input", { type: "checkbox", checked: has(s), onchange: (e) => toggle(s, e.target.checked) }), s.label || t("exp.custom"), el("span", {}, `${s.w}×${s.h}`));
  const cw = el("input", { type: "number", min: 64, max: 8192, placeholder: "W", value: 1280 }), chh = el("input", { type: "number", min: 64, max: 8192, placeholder: "H", value: 720 });
  const setting = (k, v, panel = false) => { se[k] = v; persistSettings(); if (panel) renderPanel(); };
  return [
    el("div", { class: "box sizes" }, cap("exp.sizes"), SIZE_PRESETS.map(row), custom.map(row),
      el("div", { class: "row3", style: "margin-top:12px" }, cw, chh,
        el("button", { class: "btn", style: "padding:10px", onclick: () => toggle(normalizeSize({ w: cw.value, h: chh.value, label: "" }), true) }, t("exp.addSize")))),
    el("div", { class: "box" }, cap("exp.names"),
      P.sizes.map((s) => el("div", { class: "nm-row" }, el("span", {}, `${s.w}×${s.h}`),
        textInput(s.name, (v) => { s.name = v.trim().slice(0, 40); persistProfile(); recordHistory(); later("strip", 250, () => { buildStrip(); syncToolbar(); queueDraw(); }); }, { placeholder: s.label || ratioText(s.w, s.h), maxLength: 40 }))),
      el("div", { class: "hint" }, t("exp.namesHint"))),
    el("div", {}, cap("exp.scale"), select([1, 2, 3, 4].map((n) => [String(n), `${n}x`]), String(se.scale), (v) => setting("scale", Number(v)))),
    el("div", {}, cap("exp.format"), select([["png", "PNG"], ["jpeg", "JPEG"], ["webp", "WebP"]], se.format, (v) => setting("format", v, true)),
      se.format === "jpeg" && slider("exp.quality", 40, 100, 1, se.quality, px, (v) => setting("quality", v)),
      se.format === "webp" && el("div", { class: "hint" }, t("exp.webpNote")),
      el("div", { class: "hint" }, t("exp.transparentHint"))),
    el("div", {}, cap("exp.name"), textInput(se.nameTemplate, (v) => setting("nameTemplate", v)), el("div", { class: "hint" }, t("exp.nameHint"))),
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

// ---------- right column: layers and the selected layer's properties
let dragId = null;
function layerRow(L) {
  const icon = (glyph, off, title, fn) => el("button", { class: "ic" + (off ? " off" : ""), title, onclick: (e) => { e.stopPropagation(); fn(); touch({ cover: true, side: true }); } }, glyph);
  const on = L.id === S.layerId || group().includes(L);
  const free = isFree(L.type) || L.type === "subject", base = clipBase(S.cover.layers, S.cover.layers.indexOf(L));
  const off = S.focus && S.mode === "edit" && !spotIds().includes(L.id);   // FOCUS is on another layer
  return el("div", { class: `layer${on ? " on" : ""}${L.visible ? "" : " hidden"}${base >= 0 ? " clip" : ""}${off ? " dim" : ""}`, title: off ? t("focus.locked") : base >= 0 ? t("layers.clipped", layerName(S.cover.layers[base])) : null, dataset: { id: L.id }, draggable: L.type !== "bg",
    onclick: (e) => focusAllows(L.id) && (e.shiftKey ? togglePick(L.id) : selectLayer(L.id)),
    ondragstart: (e) => { dragId = L.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", L.id); },
    ondragend: () => { dragId = null; },
    ondragover: (e) => { if (dragId && dragId !== L.id) { e.preventDefault(); e.currentTarget.classList.add("over"); } },
    ondragleave: (e) => e.currentTarget.classList.remove("over"),
    ondrop: (e) => {   // dropping on a row puts the dragged layer directly above it
      e.preventDefault(); e.stopPropagation();
      const id = dragId; dragId = null;
      if (!id) return;
      const from = S.cover.layers.findIndex((l) => l.id === id), to = S.cover.layers.indexOf(L);
      if (moveLayer(S.cover.layers, id, from < to ? to : to + 1)) touch({ cover: true, side: true, panel: onCoverTab() }); else renderSide();
    } },
    icon(L.visible ? "◉" : "○", !L.visible, t("layers.show"), () => { L.visible = !L.visible; }),
    PINNED.includes(L.type) ? el("span", { class: "ic pin", title: t("layers.pinned." + L.type) }, "🔒")
      : icon(L.locked ? "▣" : "□", !L.locked, t("layers.lock"), () => { L.locked = !L.locked; }),
    el("span", { class: "nm", title: free ? t("layers.rename") : null, onclick: free ? (e) => nameClick(e, L) : null }, layerName(L),
      L.cats && el("span", { class: "only", style: `--c:${cat().color}`, title: t("layers.only", L.cats.map((id) => { const k = S.profile.categories.find((c) => c.id === id); return k ? k.name || k.code : ""; }).filter(Boolean).join(" · ")) })),
    el("span", { class: "kinds" }, layerKinds(L)));
}
/** A layer's icons: a linked photo's chain and leading / following mark, what it is (photo, text, vector or bitmap asset), then whose it is (a layout layer, or added by the user). */
function layerKinds(L) {
  const icon = (name, tip) => el("span", { class: "kind " + name, title: tip, innerHTML: ICONS[name] });
  const free = isFree(L.type) || L.type === "subject";
  let what = null;
  if (L.type === "photo" || L.type === "subject") what = icon("photo", t("layers.kind.photo"));
  else if (L.type === "text") what = icon("text", t("layers.kind.text"));
  else if (L.type === "solid") what = icon("solid", t("layers.kind.solid"));
  else if (L.type === "asset") {
    const a = L.ref.kind === "user" && userAssets.get(L.ref.id), raster = a && !a.spec && !/^data:image\/svg/.test(a.src || "");
    what = raster ? icon("photo", t("layers.kind.image")) : icon("svg", t("layers.kind.svg"));
  }
  const link = [];
  if (L.type === "photo" && (L.of || passivesOf(L).length)) {   // a linked photo: the chain (a click offers to end the link) and which end it is
    const passive = !!L.of, colour = linkColour(L), other = passive ? layerName(owner(L)) : passivesOf(L).map(layerName).join(" · ");
    link.push(el("span", { class: "kind chain", style: `color:${colour}`, title: t("link.chainTip", other), innerHTML: ICONS.chain, onclick: (e) => { e.stopPropagation(); askUnlink(L); } }),
      el("span", { class: "kind role", style: `color:${colour}`, title: t(passive ? "link.passiveTip" : "link.activeTip", other), innerHTML: ICONS[passive ? "passive" : "active"],
        onclick: (e) => { e.stopPropagation(); const to = passive ? owner(L) : passivesOf(L)[0]; if (to && to !== L) goToLayer(to.id); } }));
  }
  return [...link, what, free ? icon("user", t("layers.kind.user")) : icon("layout", t("layers.kind.layout"))];   // a link's marks first, then what the layer is
}
/** Selects layer id and brings its row into view (it may be far up or down the list). */
function goToLayer(id) {
  if (!focusAllows(id)) return false;
  selectLayer(id);
  const row = document.querySelector(`#side .layer[data-id="${CSS.escape(id)}"]`);
  if (row) { row.scrollIntoView({ block: "nearest" }); row.classList.add("flash"); setTimeout(() => row.classList.remove("flash"), 700); }
  return true;
}
/** 14-px line icons for the layer list, in the text colour. */
const ICONS = Object.fromEntries(Object.entries({
  layout: '<rect x="2" y="2" width="12" height="12" rx="1.2"/><path d="M2 6.2h12M6.6 6.2V14"/>',   // a page laid out in panels: a layout layer
  user: '<circle cx="8" cy="5.2" r="2.7"/><path d="M2.6 14.5c.6-3 2.7-4.6 5.4-4.6s4.8 1.6 5.4 4.6"/>',
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
  if (S.focus && !spotIds().includes(L.id)) return;   // the row says why  const now = Date.now(), second = !e.shiftKey && lastNameClick.id === L.id && now - lastNameClick.at < 450;
  lastNameClick = second ? { id: "", at: 0 } : { id: L.id, at: now };
  if (!second) return;   // the row selects it
  e.stopPropagation();
  renameLayer(L.id);
}
/** Turns a layer's name in the list into a field: Enter or leaving it keeps the new name, Esc does not; an empty name goes back to the automatic one. */
function renameLayer(id) {
  const L = layer(id), row = $("side").querySelector(`.layer[data-id="${CSS.escape(id)}"]`);
  if (!L || !row) return;
  const auto = layerName({ ...L, name: "" }), was = layerName(L);
  const input = el("input", { type: "text", class: "rename", value: was, maxLength: 60, spellcheck: false,
    onclick: (e) => e.stopPropagation(), onpointerdown: (e) => e.stopPropagation(),
    onkeydown: (e) => { e.stopPropagation(); if (e.key === "Enter") input.blur(); if (e.key === "Escape") { input.value = was; input.blur(); } },
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
// Laid out as a two-column grid: a short name on the left for each group of settings, its controls on
// the right; the names line up whatever their length. Explanations sit behind an ⓘ (hover, or click to
// read it as a toast); only warnings are written out.
/** An ⓘ that shows `text` on hover, and in a bubble beside it when clicked. */
const info = (text) => el("span", { class: "info", title: text, onclick: (e) => { e.stopPropagation(); showTip(e.currentTarget, text); } }, "ⓘ");
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
 * One group of properties: its name (and an ⓘ with `tip`), then its controls. The name is centred on
 * the group's first row; `at` "top" puts it level with the top of a text box, "first" with the first
 * line of a paragraph.
 */
const psec = (nameKey, kids, tip = "", at = "") => el("div", { class: "psec" }, el("div", { class: "psec-h" + (at ? " " + at : "") }, t(nameKey), tip && info(tip)), el("div", { class: "psec-b" }, kids));
/** Put a layer back where it was placed by default. */
function placementControls(L) {
  const f = frame();
  return el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { resetPlacement(L, S.settings.scope, f.key, f.catId); touch({ cover: true, side: true }); } }, `${t("props.reset")} · ${t("scope." + S.settings.scope)}`);
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
/**
 * The text effect of a headline layer, how strong it is, and the perspective's own corners: {kids, tip}.
 */
function fxControl(L) {
  const set = (k, v, side) => { if (v === undefined) delete L[k]; else L[k] = v; touch({ cover: true, side }); };
  const kinds = { passes: t("fx.kind.passes"), mask: t("fx.kind.mask"), outline: t("fx.kind.outline") };
  const groups = ["passes", "mask", "outline"].map((kind) => ({ group: kinds[kind], items: Object.entries(EFFECTS).filter(([, e]) => e.kind === kind).map(([id, e]) => [id, e.name[getLang()]]) }));
  const fx = EFFECTS[L.fx] ? L.fx : "auto", kind = EFFECTS[fx].kind;   // an effect no longer in the menu (a look's lettering of before) is shown as automatic
  return {
    kids: [
      select(groups, fx, (v) => set("fx", v === "auto" ? undefined : v, true)),
      fx !== "auto" && kind !== "passes" && !(fx === "taper" && L.warp) && slider("props.fxAmt", 0, 2, 0.05, L.fxAmt ?? 1, times, (v) => { holdLive(L.id); set("fxAmt", v === 1 ? undefined : v, false); }),
      fx === "taper" && L.warp && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => set("warp", undefined, true) }, t("fx.warpReset")),
    ],
    tip: [fx === "taper" && t("fx.warpHint"), kind === "outline" && !native && t("fx.needsApp")].filter(Boolean).join(" "),
  };
}
/** White or ink, whichever reads on colour "#rrggbb". */
const readsOn = (hex) => { const c = hexToRgb(hex); return c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114 < 128 ? "#ffffff" : "#07070c"; };
/** The title and text layers alike: words, effect, colours, lines, plate. */
function headlineControls(L, set) {
  const light = S.profile.style.theme === "light" && !recordOf(mainPhoto()) && !(LOOKS[S.profile.style.look] || LOOKS.cel).oneTheme;
  const fx = fxControl(L);
  return [
    psec("props.sec.text", [
      L.type === "text" && el("textarea", { value: L.text, spellcheck: false, style: "height:64px;margin-bottom:8px", oninput: (e) => { L.text = e.target.value; touch({ cover: true }); later("side", 700, renderSide); } }),
      // the title's words are the cover's, also in Cover → Title, which follows
      L.type === "title" && el("textarea", { value: S.cover.title, spellcheck: false, style: "height:64px;margin-bottom:8px", oninput: (e) => { S.cover.title = e.target.value; touch({ cover: true }); later("panel", 700, () => onCoverTab() && renderPanel()); } }),
      fontControl(L, true)], t("props.textHint"), "top"),
    psec("props.sec.effect", fx.kids, fx.tip),
    psec("props.sec.color", [
      swatch(L, "ink", "props.sw.text", L.plate ? "#ffffff" : light ? "#07070c" : "#ffffff"),
      swatch(L, "hi", "props.sw.hi", L.hiPlate ? readsOn(L.hiPlateInk || cat().color) : cat().color),   // on plates of their own the words take what reads there
      L.plate && swatch(L, "plateInk", "props.sw.plate", cat().color),
      L.hiPlate && swatch(L, "hiPlateInk", "props.sw.hiPlate", cat().color)], t("props.inkAutoHint")),
    psec("props.sec.lines", titleLines(L, set), t(L.plate ? "props.linesOnPlate" : "props.linesNoPlate")),
    psec("props.sec.plate", [check("props.plateAdd", L.plate, (v) => set("plate", v, true)), check("props.hiPlateAdd", !!L.hiPlate, (v) => set("hiPlate", v || undefined, true))]),
  ];
}
/** The properties of a photo layer. */
function photoControls(L, set) {
  const base = L.of ? layer(L.of) : L, rec = recordOf(L), pid = base && base.pid, linked = passivesOf(L);
  const cut = async (on) => {
    if (L.of && !on) { unlink(L); L.cut = false; touch({ cover: true, side: true, panel: onCoverTab() }); return toast(t("link.restored")); }   // a whole photo again, of its own
    if (on && !(await ensureMask(pid))) return renderSide();
    L.cut = on; touch({ cover: true, side: true, panel: onCoverTab() });
  };
  const unlinkBtn = (L.of || linked.length > 0) && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => askUnlink(L) }, t("link.unlink"));
  return [
    !rec && el("div", { class: "hint err", style: "margin:0 0 10px" }, t("props.photoMissing")),
    psec("props.sec.cut", [
      canCut()
        ? el("div", { class: L.of ? "" : "row", style: "margin-top:0" },
            el("button", { class: "btn" + (L.of ? " wide" : ""), disabled: CUT.busy, onclick: () => cut(!L.cut) }, t(CUT.busy ? "cut.busy" : L.cut ? "props.uncut" : "props.cut")),
            !L.of && el("button", { class: "btn", disabled: CUT.busy, title: t(linked.length ? "cut.againTip" : "cut.go"), onclick: () => cutOut(L) }, t(linked.length ? "cut.again" : "cut.goShort")))
        : el("div", { class: "hint", style: "margin:0" }, t("cutset.needsApp")),
      L.cut && slider("props.feather", 0, 40, 1, L.feather, px, (v) => { holdLive(L.id); set("feather", v); }),
      L.cut && slider("props.spread", 0, 40, 1, L.spread, px, (v) => { holdLive(L.id); set("spread", v); }),
      CUT.error && el("div", { class: "hint err" }, CUT.error),
    CUT.needModel && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { S.tab.setup = "ai"; S.aiPane = "cut"; setMode("setup"); } }, t("cut.goModel"))], t("cut.tip", t("cutset.engine." + cutEngine()))),
    L.of
      ? psec("props.sec.place", [el("div", { class: "hint", style: "margin:0" }, t("link.follows2", base ? layerName(base) : "—")),
          base && el("button", { class: "btn wide", style: "margin-top:8px", title: t("link.realignTip"), onclick: () => { L.t = alignedT(base); touch({ cover: true, side: true }); } }, t("link.realign")),
          unlinkBtn], t("link.passiveMore"), "first")
      : psec("props.sec.place", [check("props.fill", L.fill, (v) => { set("fill", v, true); if (v) { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 1 }; L.t.by = {}; } else { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 0.6 }; } touch({ cover: true, side: true, panel: true }); }),
          linked.length > 0 && el("div", { class: "hint" }, t("link.leads", linked.map(layerName).join(" · "))), unlinkBtn],
          t(L.fill ? "props.fillHint" : "props.printHint")),
    psec("props.sec.picture", [
      slider("props.blur", 0, 80, 1, L.blur, px, (v) => { holdLive(L.id); set("blur", v); }),
      slider("props.dim", 0, 0.9, 0.01, L.dim, pct, (v) => { holdLive(L.id); set("dim", v); }),
      check("props.treat", L.treat, (v) => set("treat", v))], t("props.treatTip")),
    psec("props.sec.lines", [
      slider("props.outline", 0, 40, 1, L.outline, px, (v) => { holdLive(L.id); set("outline", v); }),
      slider("props.subjectShadow", 0, 1, 0.05, L.shadow, pct, (v) => { holdLive(L.id); set("shadow", v); }),
      swatch(L, "ink", "props.sw.outline", "#ffffff"),
      check("props.torn", L.torn, (v) => { L.torn = v; if (v && !(L.outline > 0)) L.outline = 16; touch({ cover: true, side: true }); })], t("props.photoLinesTip")),   // with no outline yet, one to see the tear on
  ];
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
  const font = () => psec("props.sec.text", fontControl(L, true), L.type === "brand" ? "" : t("props.boundHint"));
  const ink = (shown) => psec("props.sec.color", swatch(L, "ink", "props.sw.text", shown), t("props.inkAutoHint"));
  switch (L.type) {
    case "bg": {
      const oneTheme = (LOOKS[S.profile.style.look] || LOOKS.cel).oneTheme, covered = S.profile.style.theme === "light" && recordOf(mainPhoto());
      return psec("props.sec.ground", [
        !oneTheme && select([["dark", t("theme.dark")], ["light", t("theme.light")]], S.profile.style.theme, (v) => { S.profile.style.theme = v; touch({ profile: true, side: true }); }),
        check("props.grid", L.grid, (v) => set("grid", v))], [t("props.bgHint"), covered && t("props.lightUnderPhoto")].filter(Boolean).join(" "));
    }
    case "photo": return photoControls(L, set);
    case "accent": return psec("props.sec.shape", select(ACCENT_SHAPES.map((k) => [k, t("shape." + k)]), L.shape, (v) => set("shape", v, false)));
    case "brand": return [font(), ink("#ffffff"), psec("props.sec.show", check("props.rail", L.rail, (v) => set("rail", v)))];
    case "title": case "text": return headlineControls(L, set);
    case "tag": return [font(), ink("#07070c")];
    case "catname": return [psec("props.sec.show", [check("props.showName", L.showName, (v) => set("showName", v)), check("props.plate", L.plate, (v) => set("plate", v))]), font(), ink("#07070c")];
    case "graphic": return el("div", { class: "hint", style: "margin:0;grid-column:1/-1" }, t("props.graphicHint"));
    case "asset": return canTint(L.ref) ? assetColour(L) : null;
    case "solid": return psec("props.sec.color", swatch(L, "color", "props.sw.color", cat().color, false));
  }
  return null;
}
/** The name of the current look's scene object `key`. */
const sceneName = (key) => { const s = (LOOKS[S.profile.style.look] || LOOKS.cel).scene; return (s && s[key] && s[key][getLang()]) || key; };
/**
 * With the ground selected: the current look's scene objects the user may drag on the canvas, each with a
 * button putting it back where the layout puts it (on this cover; for all sizes or this one, as the
 * toolbar's scope says), and one for them all.
 */
function sceneSection(L) {
  const scene = L.type === "bg" && (LOOKS[S.profile.style.look] || LOOKS.cel).scene;
  if (!scene) return null;
  const look = S.profile.style.look, f = frame(), off = sceneOffsets(S.cover, look, f.key), scope = S.settings.scope;
  const isMoved = (k) => !!off[k] && (Math.abs(off[k][0]) > 1e-4 || Math.abs(off[k][1]) > 1e-4);
  const reset = (k) => { resetScene(S.cover, look, k, scope, f.key); touch({ cover: true, side: true }); };
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
  if (native && !S.settings.hideScene) invoke("move_pointer", { x, y }).catch(() => null);
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
 * Surprise me's places for the user's own layers: each anywhere on the canvas, at a new angle and size,
 * but wholly on it at every size — not a pixel off. A layer locked, filling the canvas (a background photo,
 * a colour block as large as the canvas) or following its photo (a cut-out) is left where it is. Each
 * layer's box at each size comes from a quick drawing; a layer too big for some size is set straighter,
 * then smaller, until it fits.
 */
function dealPlaces(between, round) {
  const fills = (L) => fillsCanvas(L) || (L.type === "solid" && L.t.all.s >= 0.98 && !L.t.all.r);
  const movers = S.cover.layers.filter((L) => isFree(L.type) && L.visible && !L.locked && !L.of && !fills(L));
  if (!movers.length) return;
  const boxes = S.profile.sizes.filter((s) => s.on !== false).map((size) => {
    const cv = document.createElement("canvas"), key = sizeKey(size);
    drawCover(cv, { profile: S.profile, catIndex: catIndex(), size, pixelW: 240, cover: S.cover, photos: S.photos });
    return { key, w: cv._virtual[0], h: cv._virtual[1], hits: cv._hits || [] };
  });
  for (const L of movers) {
    const a = L.t.all, per = boxes.map((b) => ({ ...b, hit: b.hits.find((x) => x.id === L.id) })).filter((b) => b.hit);
    if (!per.length) continue;
    let s = clamp(a.s * between(0.8, 1.25), 0.05, 2.5), r = round(between(-12, 12), 1);
    for (let tries = 0; tries < 40; tries++) {
      // where the centre may go at each size, as fractions of the canvas, with this size and angle: the box
      // upright (turned by the size's own extra angle too), less a hair for outlines and shadows
      let lo = [-Infinity, -Infinity], hi = [Infinity, Infinity];
      for (const p of per) {
        const at = placeOf(L, p.w, p.h, p.key, cat().id), dx = at.cx - a.x * p.w, dy = at.cy - a.y * p.h, k = s / a.s;
        const t = ((r + (at.r - a.r)) * Math.PI) / 180, hw = p.hit.hw * k, hh = p.hit.hh * k, m = Math.min(p.w, p.h) * 0.015;
        const ex = Math.abs(hw * Math.cos(t)) + Math.abs(hh * Math.sin(t)) + m, ey = Math.abs(hw * Math.sin(t)) + Math.abs(hh * Math.cos(t)) + m;
        lo = [Math.max(lo[0], (ex - dx) / p.w), Math.max(lo[1], (ey - dy) / p.h)]; hi = [Math.min(hi[0], (p.w - ex - dx) / p.w), Math.min(hi[1], (p.h - ey - dy) / p.h)];
      }
      if (lo[0] <= hi[0] && lo[1] <= hi[1]) { a.x = between(lo[0], hi[0]); a.y = between(lo[1], hi[1]); a.r = r; a.s = s; break; }
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
      (isFree(L.type) || L.type === "title") && clipControl(L),
      !fixed && !copy && placementControls(L),   // a cut-out's (back over its photo) is with its placement
      ], fixed ? t("props.fixedHint") : "")];
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
const layoutLayers = () => S.cover.layers.filter((l) => !isFree(l.type) && l.type !== "subject" && !l.off && appliesTo(l, cat().id));
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
  const side = $("side"), y = side.scrollTop, L = layer(), free = L && isFree(L.type), here = S.cover.layers.filter((l) => appliesTo(l, cat().id) && !l.off);
  // keep typing in the text box alive across rebuilds
  const typing = document.activeElement && side.contains(document.activeElement) && (document.activeElement.tagName === "TEXTAREA" || document.activeElement.classList.contains("rename"));
  if (typing) return;
  const i = L ? here.indexOf(L) : -1, many = group();
  side.replaceChildren(
    el("div", {}, el("div", { class: "lhead" }, cap("layers.title"),
        el("div", { class: "lbtns" }, el("button", { class: "focusbtn v3btn" + (V3.to ? " on" : ""), title: t("v3.tip"), onclick: () => set3d(!V3.to), innerHTML: `${ICONS.stack}<span>${t("v3.label")}</span>` }),
          (() => { const off = layoutLayers().every((l) => !l.visible); return el("button", { class: "focusbtn" + (off ? " on" : ""), title: t("layout.tip"), onclick: toggleLayout }, t(off ? "layout.show" : "layout.hide")); })(),
          el("button", { class: "focusbtn" + (S.focus ? " on" : ""), title: t("focus.tip"), onclick: () => setFocus(!S.focus) }, t("focus.label")))),
      el("div", { class: "layers" }, [...here].reverse().map(layerRow)),
      el("div", { class: "acts", style: "margin-top:10px;justify-content:flex-start" },
        el("button", { class: "btn", onclick: () => addLayer(newLayer("text", { text: t("layer.newText") })) }, t("layers.addText")),
        el("button", { class: "btn", onclick: () => addLayer(newLayer("solid", { color: cat().color })) }, t("layers.addSolid")),
        el("button", { class: "btn", disabled: !free || many.length > 0 || !!(L.type === "photo" && L.of), onclick: duplicateLayer }, t("layers.dup")),
        el("button", { class: "btn", disabled: many.length ? !many.some((x) => isFree(x.type)) : !(L && isRemovable(L.type)), onclick: () => (many.length ? removeGroup() : removeLayer()) }, t("layers.del")),
        el("button", { class: "btn", title: t("layers.up"), disabled: many.length > 0 || i < 1 || i >= here.length - 1, onclick: () => shiftLayer(1) }, "▲"),
        el("button", { class: "btn", title: t("layers.down"), disabled: many.length > 0 || i <= 1, onclick: () => shiftLayer(-1) }, "▼"))),
    many.length ? el("div", { class: "box" }, el("label", { class: "cap" }, t("props.group", many.length)),
      el("div", { class: "hint", style: "margin-top:0" }, many.map(layerName).join(" · ")),
      many.some((x) => x.locked) && el("div", { class: "hint" }, t("props.groupLocked")),
      el("div", { class: "hint" }, t("props.groupHint")),
      el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => focusAllows("bg") && selectLayer("bg") }, t("props.groupEnd")))
    : L ? el("div", { class: "box" }, el("label", { class: "cap" }, `${t("props.title")} · ${layerName(L)}`),
      el("div", { class: "props" }, typeControls(L), sceneSection(L), lookFxSection(L), layerSection(L)))
      : el("div", { class: "hint" }, t("layers.none")));
  side.scrollTop = y;
  // the selected layer's photo, in Cover → Add photos, is framed in the channel colour (without rebuilding that panel)
  for (const item of document.querySelectorAll("#panel .pitem")) item.classList.toggle("on", item.dataset.id === S.layerId);
  syncFocus(); markRows();
}

// ---------- the layers in 3D
// The 3D button over the layer list takes the cover apart: each layer painted on its own (o.only in
// drawCover) is a sheet, and the sheets are stacked bottom to top and seen at an angle (stack3d.js), so
// someone new to layers can see what each holds and which lies over which. It opens out of the flat
// cover and folds back into it. A drag turns the view, the wheel spreads the sheets, a click selects a
// layer (its settings show as ever), a double-click selects it and goes back to the flat canvas. Changes
// made in the panel show at once; a sheet moved in the list slides to its new place.
const OPEN_MS = 420, MASK_PX = 160;
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const here3d = () => S.cover.layers.filter((l) => appliesTo(l, cat().id) && !l.off);
/** Opens the 3D view out of the cover, or folds it back. */
function set3d(on) {
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
  markRows(); syncFocus();
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
  $("side").addEventListener("pointermove", (e) => { if (V3.on) peek3d((e.target.closest && e.target.closest(".layers .layer") || {}).dataset?.id || ""); });
  $("side").addEventListener("pointerleave", () => peek3d(""));
}
function sync3dHud() {
  $("v3hud").replaceChildren(
    el("span", { class: "v3tip", title: t("v3.tip") }, t("v3.hint")),
    el("label", { class: "v3sl" }, t("v3.spread"), el("input", { type: "range", min: LIMITS.spread[0], max: LIMITS.spread[1], step: 0.05, value: V3.spread,
      oninput: (e) => { V3.aim = null; V3.spread = Number(e.target.value); tick3d(); } })),
    el("button", { class: "focusbtn", onclick: () => { V3.aim = { ...VIEW }; tick3d(); } }, t("v3.reset")),
    el("button", { class: "focusbtn on", onclick: () => set3d(false) }, t("v3.exit")));
}
function peek3d(id) { if (V3.on && V3.peek !== id) { V3.peek = id; tick3d(); } }
/** The row of the sheet under the pointer is marked in the list. */
function markRows() {
  for (const row of document.querySelectorAll("#side .layers .layer")) row.classList.toggle("peek", V3.on && row.dataset.id === V3.hover);
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

// ---------- the cover check (体检, in the top bar right of Clear)
// Each size the chosen platforms want is painted small and read back — where each layer lies, the title
// alone and what is under it — and check.js says, rule by rule, what will not read, not stand out or be
// covered there (docs/cover-check.zh-CN.md). Settings' `check` holds the platforms, whether the video is
// landscape or portrait, and 小红书's ratio. A fix is one step of undo; placement is changed only at the
// size the issue is about. The count on the button follows a moment after the last change.
const CHECK = { issues: null, open: false, job: 0 };
const CHECK_PX = 320;   // how wide each size is painted for the check
const pause = () => new Promise((r) => setTimeout(r, 0));
const sizeByKey = (key) => S.profile.sizes.find((s) => sizeKey(s) === key) || null;
const frameOf = (size) => { const [vw, vh] = virtualSize(size.w, size.h); return { vw, vh, key: sizeKey(size), catId: cat().id }; };
const shownHere = (L) => !!L && L.visible && !L.off && appliesTo(L, cat().id);
/** What size `size` of the cover paints, for checkCover (see check.js); bg: the luminance behind the title, on average. `contrast` false: where things are only. */
function seenOf(size, contrast0 = true) {
  const [vw] = virtualSize(size.w, size.h), k = CHECK_PX / vw;
  const paintOne = (extra) => {
    const cv = document.createElement("canvas");
    cv.getContext("2d", { willReadFrequently: true });
    drawCover(cv, { profile: S.profile, catIndex: catIndex(), size, pixelW: CHECK_PX, cover: S.cover, photos: S.photos, ...extra });
    return cv;
  };
  const cv = paintOne({}), hits = cv._hits || [], T = layer("title"), th = shownHere(T) ? hits.find((h) => h.id === "title") || null : null;
  let contrast = null, bg = null;
  if (th && contrast0) {   // the title alone, and what lies under it, over the title's box
    const i = S.cover.layers.indexOf(T), a = paintOne({ only: i }), b = paintOne({ below: i }), box = boxOf(th);
    const x0 = Math.max(0, Math.floor(box.x0 * k)), y0 = Math.max(0, Math.floor(box.y0 * k)), x1 = Math.min(a.width, Math.ceil(box.x1 * k)), y1 = Math.min(a.height, Math.ceil(box.y1 * k));
    if (x1 > x0 && y1 > y0) {
      const under = b.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data;
      contrast = titleContrast(a.getContext("2d").getImageData(x0, y0, x1 - x0, y1 - y0).data, under);
      let sum = 0;
      for (let j = 0; j < under.length; j += 4) sum += luminance(under[j], under[j + 1], under[j + 2]);
      bg = sum / (under.length / 4);
    }
  }
  const pictures = [], parts = th ? [{ id: "title", hit: th }] : [];
  let unknown = false;
  for (const h of hits) {
    const L = layer(h.id);
    if (!shownHere(L)) continue;
    if (L.type === "photo" && L.fill && !L.cut) { if (!passivesOf(L).length) unknown = true; continue; }   // a background photo: its subject cannot be measured, unless cut out
    if (["graphic", "asset", "photo", "subject"].includes(L.type)) pictures.push({ id: L.id, hit: h });
    if (L.type === "text" || L.type === "subject" || (L.type === "photo" && (L.cut || L.of))) parts.push({ id: L.id, hit: h });
  }
  return { title: th && { id: "title", hit: th }, contrast, bg, pictures, unknown, parts };
}
/** Checks the cover for the platforms chosen: CHECK.issues, or null with none chosen. `slow`: a size per turn of the event loop, given up when something newer comes. */
async function runCheck(slow = false) {
  const c = S.settings.check, job = ++CHECK.job;
  if (!S.cover || !c.platforms.length) return (CHECK.issues = null);
  const seen = {};
  for (const { ratio } of wanted(c)) {
    const s = S.profile.sizes.find((x) => isRatio(x.w, x.h, ratio));
    if (!s || seen[sizeKey(s)]) continue;
    if (slow) { await pause(); if (job !== CHECK.job) return null; }
    seen[sizeKey(s)] = seenOf(s);
  }
  const sizes = S.profile.sizes.map((s) => { const [vw, vh] = virtualSize(s.w, s.h); return { key: sizeKey(s), w: s.w, h: s.h, vw, vh }; });
  return (CHECK.issues = checkCover({ title: shownHere(layer("title")) ? S.cover.title : "", sizes, seen, ...c }));
}
/** The count on the button, a moment after the last change: never while something is dragged. */
function checkSoon() {
  if (!S.settings.check.platforms.length) return;
  later("check", 1500, async () => {
    if (LIVE || drafting() || CHECK.open) return CHECK.open ? null : checkSoon();
    if (await runCheck(true)) syncTop();
  });
}
function checkButton() {
  const list = CHECK.issues, red = list ? list.filter((i) => i.level === "red").length : 0, yellow = list ? list.length - red : 0;
  const mark = !list ? "" : red ? String(red) : yellow ? String(yellow) : "✓";
  return el("button", { class: "btn checkbtn", title: t("check.tip"), onclick: checkDialog }, t("check.open"), mark && el("i", { class: red ? "red" : yellow ? "yellow" : "ok" }, mark));
}
async function checkDialog() {
  CHECK.open = true;
  await runCheck();
  renderCheck();
  $("modal").hidden = false;
}
function closeCheck() { CHECK.open = false; closeModal(); syncTop(); }
const platformName = (id) => { const p = PLATFORMS.find((x) => x.id === id); return p ? p.name[getLang()] : id; };
const sizeName = (key) => { const s = sizeByKey(key); return s ? sizeCaption(s) : key; };
/** An issue in words. */
function issueText(i) {
  const names = i.platforms.map(platformName).join("、"), pct = (v) => Math.round(v * 100);
  switch (i.rule) {
    case "A1": { const longest = Math.max(1, ...typedLines(S.cover.title).map(lineUnits)); return t("check.msg.A1", names, i.value.toFixed(1), Math.max(2, Math.floor((longest * i.value) / i.need))); }
    case "A2": return t("check.msg.A2", i.what, Math.ceil(i.value));
    case "B1": return t("check.msg.B1", i.value.toFixed(1));
    case "C1": return t("check.msg.C1", layer(i.layer) ? layerName(layer(i.layer)) : "—", pct(i.value));
    case "D1": return t("check.msg.D1", layer(i.layer) ? layerName(layer(i.layer)) : "—", pct(i.value), names, t("check.zone." + i.what));
    case "E1": return t("check.msg.E1", names, i.ratio);
  }
  return i.rule;
}
function renderCheck() {
  const c = S.settings.check, lang = getLang(), m = $("modal"), list = CHECK.issues || [];
  const again = async () => { persistSettings(); await runCheck(); renderCheck(); syncTop(); };
  const chip = (p) => el("button", { class: c.platforms.includes(p.id) ? "on" : "", onclick: () => { c.platforms = c.platforms.includes(p.id) ? c.platforms.filter((x) => x !== p.id) : [...c.platforms, p.id]; again(); } }, p.name[lang]);
  const seg = (key, opts) => el("div", { class: "seg" }, opts.map(([v, label]) => el("button", { class: "btn" + (c[key] === v ? " on" : ""), onclick: () => { c[key] = v; again(); } }, label)));
  const red = list.filter((i) => i.level === "red").length, fixable = list.filter((i) => FIXES[i.rule]);
  const row = (i) => el("div", { class: "issue " + i.level }, el("span", { class: "dot" }),
    el("div", {}, el("b", {}, issueText(i)), el("div", { class: "hint" }, [i.size && sizeName(i.size), t("check.why." + i.rule)].filter(Boolean).join(" · "))),
    el("div", { class: "acts" }, (i.size || i.layer) && el("button", { class: "btn", onclick: () => locateIssue(i) }, t("check.locate")),
      FIXES[i.rule] && el("button", { class: "btn solid", onclick: () => applyFixes([i]) }, t("check.fix"))));
  m.replaceChildren(el("div", { class: "dlg wide check" },
    el("h2", {}, t("check.title")),
    el("div", { class: "hint", style: "margin:0" }, t("check.intro")),
    el("div", {}, cap("check.platforms"), el("div", { class: "chips" }, PLATFORMS.map(chip))),
    c.platforms.length > 0 && el("div", { class: "check-opts" }, el("div", {}, cap("check.orient"), seg("orient", [["h", t("check.orient.h")], ["v", t("check.orient.v")]])),
      c.platforms.includes("red") && el("div", {}, cap("check.red"), seg("red", RED_RATIOS.map((r) => [r, r])))),
    !c.platforms.length ? el("div", { class: "hint" }, t("check.pick"))
      : el("div", {}, el("div", { class: "check-sum " + (red ? "red" : list.length ? "yellow" : "ok") }, list.length ? t("check.sum", red, list.length - red) : t("check.pass")),
        el("div", { class: "issues" }, list.map(row))),
    el("div", { class: "acts" }, fixable.length > 0 && el("button", { class: "btn", onclick: () => applyFixes(fixable) }, t("check.fixAll", fixable.length)),
      el("button", { class: "btn solid", onclick: closeCheck }, t("check.close")))));
  m.onDismiss = closeCheck;
}
/** Shows where an issue is: its size on the canvas, its layer selected. */
function locateIssue(i) {
  closeCheck();
  if (i.size && sizeByKey(i.size)) selectSize(i.size);
  if (i.layer && layer(i.layer) && shownHere(layer(i.layer))) goToLayer(i.layer);
}
/** Moves layer L back inside the canvas at `size` (it may have grown past an edge), by that size alone. */
function keepInside(L, size, margin = 0.03) {
  const f = frameOf(size), seen = seenOf(size, false), h = [...seen.pictures, ...seen.parts].find((x) => x.id === L.id);
  if (!h) return;
  const b = boxOf(h.hit), mx = f.vw * margin, my = f.vh * margin;
  const dx = b.x0 < mx ? mx - b.x0 : b.x1 > f.vw - mx ? f.vw - mx - b.x1 : 0, dy = b.y0 < my ? my - b.y0 : b.y1 > f.vh - my ? f.vh - my - b.y1 : 0;
  if (dx || dy) adjust(L, f, "size", { ddx: dx, ddy: dy });
}
/** Makes layer L at `size` `want` times bigger, at most as big as the canvas (less a margin) allows. False when it cannot grow. */
function growAt(L, size, hit, want) {
  const f = frameOf(size), b = boxOf(hit), room = Math.min((f.vw * 0.94) / (b.x1 - b.x0), (f.vh * 0.9) / (b.y1 - b.y0)), k = Math.min(room, want);
  if (k <= 1.005) return false;
  adjust(L, f, "size", { scale: k });
  keepInside(L, size);
  return true;
}
/** The fixes, by rule: each changes the cover and returns false when it could do nothing. */
const FIXES = {
  A1: (i) => { const size = sizeByKey(i.size), seen = size && seenOf(size, false); return !!(seen && seen.title) && growAt(layer("title"), size, seen.title.hit, (i.need / i.value) * 1.03); },
  C1: (i) => { const size = sizeByKey(i.size), L = layer(i.layer), p = size && L && seenOf(size, false).pictures.find((x) => x.id === L.id); return !!p && growAt(L, size, p.hit, Math.sqrt(i.need / i.value) * 1.03); },
  D1: (i) => {
    const size = sizeByKey(i.size), L = layer(i.layer), p = size && L && seenOf(size, false).parts.find((x) => x.id === L.id);
    if (!p) return false;
    const f = frameOf(size), mv = moveOut(boxOf(p.hit), i.zone, f.vw, f.vh);
    if (!mv) return false;
    adjust(L, f, "size", { ddx: mv.dx, ddy: mv.dy });
    return true;
  },
  // the title against what is behind it: a heavier outline, a darker photo, a plate, then black or white letters — each tried until it reads
  B1: (i) => {
    const size = sizeByKey(i.size), L = layer("title"), ok = () => { const c = seenOf(size).contrast; return c != null && c >= CHECK_LIMITS.contrast.ok; };
    if (!size || !L) return false;
    const P = mainPhoto(), steps = [
      () => { if (!effectUses(L.fx).stroke || (L.stroke ?? 1) >= 1.6) return false; L.stroke = 1.6; return true; },
      () => { if (!P || (P.dim || 0) >= 0.5) return false; P.dim = Math.min(0.5, (P.dim || 0) + 0.15); return true; },
      () => { if (!P || (P.dim || 0) >= 0.5) return false; P.dim = Math.min(0.5, (P.dim || 0) + 0.15); return true; },
      () => { if (L.plate) return false; L.plate = true; return true; },
      () => { const bg = seenOf(size).bg, ink = bg != null && bg > 0.18 ? "#07070c" : "#ffffff"; if (L.ink === ink) return false; L.ink = ink; delete L.color; return true; },
    ];
    let did = false;
    for (const step of steps) { if (!step()) continue; did = true; if (ok()) break; }
    return did;
  },
  E1: (i) => {
    const [w, h] = i.what, preset = SIZE_PRESETS.find((p) => p.w === w && p.h === h);
    if (S.profile.sizes.some((s) => s.w === w && s.h === h)) return false;
    S.profile.sizes.push({ w, h, label: preset ? preset.label : i.ratio, name: "" });
    return true;
  },
};
/** Applies the fixes of these issues as one step of undo, then checks again. */
async function applyFixes(list) {
  clearTimeout(timers.hist); commitHistory();
  let done = 0;
  for (const i of list) if (FIXES[i.rule] && FIXES[i.rule](i) !== false) done++;
  touch({ cover: true, profile: true, side: true, strip: list.some((i) => i.rule === "E1") });
  commitHistory();
  toast(t(done ? "check.fixed" : "check.notFixed"));
  await runCheck(); renderCheck(); syncTop();
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
 * save(bytes, name) does the writing; returns how many were written.
 */
async function runExport(jobs, save) {
  const prog = progress(jobs.length), pending = new Set();
  let done = 0, failed = null;
  try {
    for (const job of jobs) {
      if (prog.cancelled || failed) break;
      const name = nameFor(job.size, job.cover, job.index);
      prog.set(done, name);
      await nextPaint();
      const cv = await renderReady(job.size, job.cover, job.index);
      const task = (native ? toPng(cv).then((bytes) => { cv.width = cv.height = 0; return save(bytes, name); }) : browserSaveCanvas(cv, name))
        .then(() => { done++; prog.set(done); }, (e) => { failed = failed || e; })
        .finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= 2) await Promise.race(pending);
    }
    await Promise.all(pending);
  } finally { prog.close(); }
  if (failed) { fail(failed); return -1; }
  if (prog.cancelled) toast(t("msg.cancelled", done, jobs.length));
  return done;
}
async function exportOne(size) {
  const job = { cover: S.cover, index: catIndex(), size };
  if (!native) return void (await runExport([job]));
  let saved = null;
  const n = await runExport([job], async (bytes, name) => { saved = await invoke("save_image", framed(bytes, { name })); });
  if (n === 1 && saved) toast(t("msg.saved", saved));
}
/** Writes every selected size of every cover ([{cover, index}]) into one folder the user picks. */
async function exportMany(covers) {
  let dir = null;
  try { if (native) { dir = await invoke("pick_folder"); if (!dir) return; } } catch (e) { return fail(e); }
  const jobs = covers.flatMap((c) => S.profile.sizes.map((size) => ({ ...c, size })));
  const n = await runExport(jobs, (bytes, name) => invoke("write_image", framed(bytes, { dir, name })));
  if (n === jobs.length) toast(t("msg.savedN", n, dir || "Downloads"));
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
    return { index, cover: { ...coverFor(S.profile.categories[index].id), title: r.title, tag: r.tag } };   // that channel's own cover, with the row's words
  });
  for (const j of jobs) await loadPhotos(pidsOf(j.cover));
  await exportMany(jobs);
  if (unknown) setTimeout(() => toast(t("msg.batchUnknown", unknown)), 3600);
}
function csvTemplate() {
  const zh = getLang() === "zh", c = S.profile.categories;
  const lines = [zh ? "频道,标题,角标" : "channel,title,tag", `${c[0].name},"${zh ? "第一行\\n*第二行*" : "First line\\n*second line*"}",EP.01`, `${(c[1] || c[0]).name},${zh ? "另一个标题" : "Another title"},`];
  saveText("smedcover-batch.csv", "\uFEFF" + lines.join("\n") + "\n");
}
async function saveText(name, text) {
  if (!native) return browserSave(name, "data:text/plain;charset=utf-8," + encodeURIComponent(text));
  try { const p = await invoke("save_text", { name, text }); if (p) toast(t("msg.saved", p)); } catch (e) { fail(e); }
}
function closeModal() { const m = $("modal"); m.hidden = true; m.replaceChildren(); m.onDismiss = null; delete m.dataset.sticky; }
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
function exportDialog() {
  const m = $("modal"), se = S.settings;
  m.replaceChildren(el("div", { class: "dlg" }, el("h2", {}, t("exp.dialog")),
    el("div", { class: "hint", style: "margin:0" }, t("exp.summary", se.format.toUpperCase(), se.scale)),
    el("div", { class: "dl" }, S.profile.sizes.map((s) => el("button", { class: "btn wide", onclick: () => exportOne(s) }, `${t("exp.one")} ${sizeLabel(s)}`)),
      el("button", { class: "btn solid wide", onclick: () => exportMany([{ cover: S.cover, index: catIndex() }]) }, `${t("exp.all")} (${S.profile.sizes.length})`)),
    el("div", { class: "box" }, cap("exp.batch"), el("div", { class: "hint", style: "margin:0 0 12px" }, t("exp.batchHint")),
      el("button", { class: "btn wide", onclick: batchFromCsv }, t("exp.csv")),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: csvTemplate }, t("exp.csvTemplate"))),
    el("button", { class: "btn wide", onclick: closeModal }, t("close"))));
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
  S.profile = S.profiles.find((p) => p.id === id) || S.profiles[0];
  S.settings.profileId = S.profile.id;
  S.covers = await loadCovers(S.profile);
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
    S.profiles = S.profiles.filter((p) => p !== gone);
    await deleteProfile(gone).catch(fail);
    for (const f of await files.list("covers/" + gone.id).catch(() => [])) await files.remove(`covers/${gone.id}/${f}`).catch(() => null);   // its covers go with it
    await switchProfile(S.profiles[0].id);
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
      let profile = S.profile, catId = S.cover.catId;
      const theirs = raw.profile && typeof raw.profile === "object" ? raw.profile : null;
      const here = theirs && S.profiles.find((p) => p.id === theirs.id);
      if (here) profile = here;
      else if (theirs) {
        const how = await askProjectProfile(theirs.name || raw.profileName || "—");
        if (!how) return;
        if (how === "new") { await adoptFonts(raw.fonts); profile = await addProfile(theirs, false); }
      }
      if (profile.categories.some((c) => c.id === raw.catId)) catId = raw.catId;
      else if (profile !== S.profile) catId = channelOf(profile);
      await adoptEmbedded(raw.assets);
      await adoptFonts(raw.fonts);
      await adoptPhotos(raw.photos, "lib.fromProject");
      if (profile !== S.profile) await switchProfile(profile.id);
      if (catId !== S.cover.catId) await switchChannel(catId);
      clearTimeout(timers.hist); commitHistory();
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

// ---------- chrome
function setMode(mode) {
  S.mode = mode;
  if (mode !== "edit" && V3.on) close3d();   // the layer column is not there in Setup
  columns();   // the left column has a width of its own in Setup (and the handles' words follow the language)
  $("body").classList.toggle("setup", mode === "setup");
  syncTop(); syncTabs(); renderPanel(); renderSide(); syncToolbar(); queueDraw();
}
/**
 * SURPRISE ME: deals a new hand of everything about how the cover looks and is laid out — the look
 * and its settings, the template and its proportions, the colour block's shape, text effects, the
 * small switches on each layer, and where added items sit. What the cover *says* is left alone:
 * the title and tag, the channel and its colour, the photo, and which layers exist.
 * One step of undo brings the previous hand back.
 */
function surprise() {
  const R = Math.random, pick = (a) => a[Math.floor(R() * a.length)], between = (a, b) => a + R() * (b - a), chance = (p) => R() < p;
  const round = (v, step) => Math.round(v / step) * step, st = S.profile.style;
  commitHistory();   // whatever was being edited becomes a step of its own, so each hand is exactly one undo
  // the look, tuned somewhere in the middle of each slider's range (the extremes are rarely the best of a look)
  st.look = pick(LOOK_IDS); st.lookSeed = Math.floor(R() * 1000000);
  const tuned = {};
  for (const d of LOOKS[st.look].params) tuned[d.key] = d.text ? (st.lookParams[st.look] || {})[d.key] ?? d.def : d.toggle ? (chance(0.7) ? 1 : 0) : round(between(d.min + (d.max - d.min) * 0.12, d.min + (d.max - d.min) * 0.8), d.step);   // words typed in are kept
  if (Object.keys(tuned).length) st.lookParams[st.look] = tuned;
  // its scene objects: where the layout puts them, or now and then a little off it
  if (S.cover.scene) delete S.cover.scene[st.look];
  if (chance(0.4)) for (const key of Object.keys(LOOKS[st.look].scene || {})) moveScene(S.cover, st.look, key, "all", frame().key, round(between(-0.06, 0.06), 0.005), round(between(-0.05, 0.05), 0.005));
  st.theme = chance(0.7) ? "dark" : "light";
  // the layout is left as it is — the template, its proportions, where the layout layers stand — and
  // every layer's own choices are dealt
  const effects = Object.keys(EFFECTS).filter((id) => id !== "auto" && (native || EFFECTS[id].kind !== "outline"));
  const dealFx = (L, auto) => { delete L.fx; delete L.fxAmt; if (!chance(auto)) { L.fx = pick(effects); if (EFFECTS[L.fx].kind !== "passes") L.fxAmt = round(between(0.6, 1.5), 0.05); } };
  for (const L of S.cover.layers) {
    switch (L.type) {
      case "bg": L.grid = chance(0.75); break;
      case "accent": L.shape = pick(ACCENT_SHAPES); break;
      case "brand": L.rail = chance(0.8); break;
      case "catname": L.plate = chance(0.75); break;
      case "title": L.stroke = round(between(0.6, 1.4), 0.05); L.shadow = round(between(0.5, 1.5), 0.05); dealFx(L, 0.45); break;
      case "text": L.plate = chance(0.35); L.stroke = round(between(0.6, 1.4), 0.05); L.shadow = round(between(0.5, 1.5), 0.05); dealFx(L, 0.4); break;
      case "asset": if (canTint(L.ref) && L.ref.kind !== "graphic") L.tint = chance(0.5); break;
    }
    if (FX_TYPES.includes(L.type) && L.type !== "title") {   // look effects: one or two, mostly the look just drawn's, now and then another look's (the title keeps the user's)
      delete L.lookFx;
      if (chance(0.55)) {
        const fx = {}, others = LOOK_IDS.filter((k) => k !== st.look && effectsFor(k, L.type).length);
        for (let n = chance(0.4) ? 2 : 1; n > 0; n--) {
          const from = effectsFor(st.look, L.type).length && chance(0.6) ? st.look : others.length ? pick(others) : null, list = from ? effectsFor(from, L.type).filter((e) => !(`${from}.${e.key}` in fx)) : [];
          if (!list.length) continue;
          const e = pick(list);
          fx[`${from}.${e.key}`] = round(between(0.35, 0.85), 0.05);
          for (const s of e.sub || []) fx[`${from}.${e.key}:${s.key}`] = round(between(0.2, 0.8), 0.05);
        }
        if (Object.keys(fx).length) L.lookFx = fx;
      }
    }
  }
  dealPlaces(between, round);
  touch({ profile: true, cover: true, panel: true, side: true, strip: true });
  commitHistory();
  toast(t("msg.surprise", LOOKS[st.look].name[getLang()], t("tpl." + st.template).split(/[：:]/)[0]));
}
/**
 * Asks, then empties this channel's cover: every layer the user added goes, the layout layers return to
 * the profile's default design (places, effects, colours), the scene objects to where the layout puts
 * them; the title, the tag and the style stay. One step of undo.
 */
function clearDialog() {
  const m = $("modal");
  const go = () => {
    closeModal(); clearTimeout(timers.hist); commitHistory();
    const fresh = channelCover({ catId: S.cover.catId, title: S.cover.title, tag: S.cover.tag }, S.profile, S.cover.catId);
    fresh.layers = fresh.layers.filter((l) => !isFree(l.type));   // the design's own added layers go too: empty is empty
    for (const l of fresh.layers) if (layer(l.id) && layer(l.id).off) { l.off = true; l.visible = false; }   // what this cover leaves out stays out
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
function syncTop() {
  if (!S.profile) return;
  const b = (key, onclick, props = {}) => el("button", { class: "btn", onclick, ...props }, t(key));
  const mode = (m) => el("button", { class: "btn" + (S.mode === m ? " on" : ""), onclick: () => setMode(m) }, t("mode." + m));
  $("top").replaceChildren(
    el("h1", {}, "SMEDCOVER"),
    el("div", { class: "seg big" }, mode("edit"), mode("setup")),
    el("div", { class: "grp" }, el("span", {}, t("top.profile")),
      el("select", { onchange: (e) => switchProfile(e.target.value) }, S.profiles.map((p) => el("option", { value: p.id, selected: p.id === S.profile.id }, p.name)))),
    // project files (projectActions: open, save, reset) have no place in the top bar for now; the code stays
    el("div", { class: "grp" }, b("top.undo", () => timeTravel(-1), { disabled: S.histIdx <= 0 }), b("top.redo", () => timeTravel(1), { disabled: S.histIdx >= S.hist.length - 1 }),
      b("top.clear", clearDialog, { title: t("top.clearTip") }), checkButton()),
    el("div", { class: "spacer" }),
    el("button", { class: "btn solid cta", style: "margin-right:10px", title: t("top.surpriseHint"), onclick: surprise }, t("top.surprise")),
    el("button", { class: "btn solid cta", onclick: exportDialog }, t("top.export")),
    el("select", { title: t("lang"), onchange: (e) => { S.settings.lang = e.target.value; setLang(e.target.value); persistSettings(); setMode(S.mode); buildStrip(); } },
      [["zh", "中文"], ["en", "English"]].map(([v, l]) => el("option", { value: v, selected: v === getLang() }, l))));
  document.body.dataset.drop = t("msg.dropHere");
}
const TABS = { edit: { cover: coverTab, style: styleTab, assets: assetsTab }, setup: { brand: brandTab, sizes: sizesTab, ai: aiTab } };
function syncTabs() {
  $("tabs").replaceChildren(...Object.keys(TABS[S.mode]).map((k) => el("button", { class: k === S.tab[S.mode] ? "on" : "", onclick: () => { S.tab[S.mode] = k; syncTabs(); renderPanel(); $("panel").scrollTop = 0; } }, t("tab." + k))));
}
/** Makes the profile's look current, for anything drawn outside a cover (asset tiles, previews). */
const useLook = () => setLook(S.profile.style.look, S.profile.style.lookParams[S.profile.style.look], S.profile.style.lookSeed, !!recordOf(mainPhoto()) || S.profile.style.theme !== "light");
function renderPanel() {
  if (!S.cover) return;
  useLook();
  const panel = $("panel"), y = panel.scrollTop;
  document.documentElement.style.setProperty("--acc", cat().color);
  panel.replaceChildren(...TABS[S.mode][S.tab[S.mode]]().flat(Infinity).filter(Boolean));
  panel.scrollTop = y;
}

function welcome() {
  return new Promise((resolve) => {
    const modal = $("modal"), name = textInput("", () => null, { placeholder: "MY CHANNEL" });
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
const COLUMNS = { left: { min: 300, def: 372 }, right: { min: 260, def: 320 }, setup: { min: 340, def: 420 } };
const CENTRE_MIN = 360;   // what the canvas keeps at the least
/** Sets the columns' widths from the settings (0 = default), each kept between its least and what leaves the canvas room. */
function columns() {
  const b = $("body"), w = innerWidth, c = S.settings.columns;
  const fit = (k, other) => Math.round(clamp(c[k] || COLUMNS[k].def, COLUMNS[k].min, Math.max(COLUMNS[k].min, w - CENTRE_MIN - other)));
  const left = fit("left", c.right || COLUMNS.right.def), right = fit("right", left);
  b.style.setProperty("--lw", left + "px"); b.style.setProperty("--rw", right + "px"); b.style.setProperty("--sw", fit("setup", 0) + "px");
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
    handle.onpointerup = handle.onpointercancel = () => { handle.onpointermove = null; handle.classList.remove("on"); S.settings.columns[key] = Math.round($(id).getBoundingClientRect().width); persistSettings(); };
  });
}

// ---------- window-level events
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; document.body.classList.add("drop"); });
addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove("drop"); } });
addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener("drop", async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("drop");
  // dropped photos become photo layers: the first of a cover fills it; the others land where they were dropped
  const cv = $("cv"), b = cv.getBoundingClientRect(), over = S.mode === "edit" && e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom;
  const at = over ? { x: clamp((e.clientX - b.left) / b.width, 0, 1), y: clamp((e.clientY - b.top) / b.height, 0, 1) } : null;
  for (const f of [...e.dataTransfer.files].filter((x) => x.type.startsWith("image/"))) await addPhoto(await readAs(f, "readAsDataURL"), at, f.name.replace(/\.[^.]+$/, ""));
});
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (typing || !S.cover) return;
  if (mod && key === "z") { e.preventDefault(); return timeTravel(e.shiftKey ? 1 : -1); }
  if (S.mode !== "edit") return;
  const L = layer();
  if (mod && key === "d") { e.preventDefault(); return group().length ? null : duplicateLayer(); }
  if (key === "escape") return V3.to ? set3d(false) : S.focus ? setFocus(false) : selectLayer("bg");
  if (key === "f" && !mod && !e.altKey) { e.preventDefault(); return setFocus(!S.focus); }
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
onOutlines(() => queueDraw());   // an outline that was sent for has arrived: draw again, this time with it
async function start() {
  S.settings = normalizeSettings(await readJson("settings.json").catch(() => null));
  setLang(S.settings.lang || detectLang());
  for (const name of await files.list("fonts").catch(() => [])) {
    if (name.endsWith(".font")) { const src = await files.read("fonts/" + name).catch(() => null); if (src) await registerFont(name.slice(0, -5), src); }
  }
  for (const a of await loadAssetRecords().catch(() => [])) {
    let entry = null;
    if (a.spec) { const r = normalizeSpec(a.spec); if (r.spec) entry = putSpecAsset(a.id, a.name, r.spec); } else entry = await putUserAsset(a.id, a.name, a.src);
    if (entry && a.folder) entry.folder = a.folder;
  }
  S.assetFolders = normalizeFolders(await readJson("asset-folders.json").catch(() => null));
  S.ai = normalizeAi(await readJson("ai.json").catch(() => null));
  const rawImageAi = await readJson("image-ai.json").catch(() => null);
  S.imageAi = normalizeImageAi(rawImageAi);
  await migrateStyles(rawImageAi);
  S.repaintStyles = await loadStyles();
  S.myStyles = await loadMyStyles();
  if ((S.imageAi.source.startsWith("preset:") && !builtIn()) || (S.imageAi.source.startsWith("my:") && !myStyle())) S.imageAi.source = "look";   // a style that is no longer there
  columns();
  await refreshCutModels();
  if (native) {
    const found = await invoke("list_system_fonts").catch(() => []);
    S.systemFonts = found.map((f) => f.name);
    for (const f of found) if (!f.cjk) S.latinFonts.add(f.name);
  }
  S.profiles = await loadProfiles().catch(() => []);
  const selftest = native ? await invoke("selftest_dir").catch(() => null) : null;
  if (!S.profiles.length) await addProfile(selftest ? sampleProfile("en") : await welcome(), false);
  S.profile = S.profiles.find((p) => p.id === S.settings.profileId) || S.profiles[0];
  S.settings.profileId = S.profile.id; persistSettings();
  S.library = normalizeLibrary(await readJson("photo-library.json").catch(() => null));
  if (!(await readJson("photo-library.json").catch(() => null))) await libraryFromFiles();
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
  const photo = (await files.read("session-photo").catch(() => "")) || "";
  if (photo) {
    const read = (f) => files.read(f).catch(() => "").then((v) => v || "");
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
  if (onBitmapPane()) renderPanel();
}
/** The first time the library is opened: the pictures already there (uploaded before it existed) go in it. */
async function libraryFromFiles() {
  const pids = [...new Set((await files.list("photos").catch(() => [])).map((f) => f.replace(/\.(original|mask)$/, "")))];
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
    show();
  });
}
/** Assets → Bitmaps: the library's pictures, to click or drag onto the cover. */
function bitmapPane() {
  return [
    el("div", { class: "box" }, cap("lib.add"), photoAdders(false)),
    el("div", {}, cap("lib.all", ` · ${S.library.length}`),
      el("div", { class: "hint", style: "margin:0 0 10px" }, t("lib.hint")),
      libraryTiles((pid) => placePhoto(pid), () => { if (onBitmapPane()) renderPanel(); }, true))];
}
const onBitmapPane = () => S.mode === "edit" && S.tab.edit === "assets" && S.assetPane === "bitmap";
/**
 * The library's pictures as tiles, newest first: a click hands the picture to `pick`; they can be dragged
 * onto the canvas, and with `removable` taken out of the library. Pictures not read yet are read, then
 * `redraw` is called.
 */
function libraryTiles(pick, redraw, removable = false) {
  LIB.redraw = redraw;
  readLibrary();
  const shown = S.library.filter((e) => S.photos.has(e.pid)), waiting = S.library.some((e) => !S.photos.has(e.pid));
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
async function selfTest(dir) {
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
    const titleLayer = layer("title"), keep = S.cover.title;
    S.cover.title = "文字效果 *FX*\nText *effects*";
    for (const id of Object.keys(EFFECTS).filter((k) => k !== "auto")) {
      titleLayer.fx = id; await step(`fx-${id}`);
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex());
      report.effects.push({ id, kind: EFFECTS[id].kind, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `fx-${id}.png` })) });
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
    // the perspective with corners of its own, dragged far: the lettering follows the quad
    titleLayer.fx = "taper"; titleLayer.warp = [[0, 0], [-0.05, 0.35], [0.08, -0.1], [0.04, 0]];
    report.effects.push({ id: "taper-own", path: await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "fx-taper-own.png" })) });
    delete titleLayer.warp;
    delete titleLayer.fx; S.cover.title = keep;
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
    for (const d of own.filter((q) => !q.needsPhoto)) {
      const times = [];
      for (let i = 1; i <= 7; i++) { st.lookParams[st.look] = { ...kept, [d.key]: clamp(d.def + (i % 2 ? 0.05 : -0.05), d.min, d.max) }; draftTouch({ profile: true }); const t = performance.now(); await frame(); if (i > 1) times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      report.look.stepping[d.key] = Math.round(times[3]);
    }
    if (kept) st.lookParams[st.look] = kept; else delete st.lookParams[st.look];
    touch({ profile: true });
  }
  await invoke("selftest_done", { report: JSON.stringify(report, null, 2) }).catch(() => null);
}
// test hook: lets automated checks drive the app without the UI
window.__smedcover = { S, drawCover, renderFull, nameFor, touch, addAsset, addLayer, newLayer, selectLayer, selectSize, setMode, layer };
start().catch((e) => { console.error(e); fail(e); });
