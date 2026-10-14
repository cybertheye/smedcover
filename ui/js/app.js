// SmedCover UI. Two modes: Edit (cover content, assets, style + the layer stack) and Setup (brand,
// sizes, fonts). The cover is a collage of layers painted by render.js; persistence is in store.js.
import { fonts, clamp } from "./cel.js";
import { virtualSize , layoutValues, dragLayout, LAYOUT_LIMITS } from "./layout.js";
import { layoutHandles, drawCover, sizeKey, hexToRgb, hitAt, hitsIn, paintAccent, handles } from "./render.js";
import { csvToJobs } from "./csv.js";
import { t, setLang, getLang, detectLang } from "./i18n.js";
import { sampleProfile, starterProfile, SIZE_PRESETS } from "./presets.js";
import { useFont, ratioText } from "./store.js";
import { GRAPHICS, STICKERS, STICKER_GROUPS, userAssets, putUserAsset, putSpecAsset, assetIdFor, assetExists, assetName, canTint, drawAsset } from "./assets.js";
import { ACCENT_SHAPES, newLayer, isFree, isRemovable, fillsCanvas, isPickable, appliesTo, stepIndex, adjust, resetPlacement, writeKey, insertAbove, moveLayer, duplicate } from "./layers.js";
import {
  carryFonts, native, invoke, files, uid, readJson, writeJson, loadProfiles, saveProfile, deleteProfile, loadAssetRecords, saveAssetRecord,
  deleteAssetRecord, usedUserAssets, normalizeProfile, normalizeCover, normalizeSettings, normalizeSize, exportName, sizeCaption,
} from "./store.js";

import { normalizeSpec, parseSpec, drawSpec } from "./spec.js";
import { EFFECTS, effectUses, warpCorners } from "./textfx.js";
import { onOutlines, outlinesPending, outlinesSettled } from "./outlines.js";
import { LOOKS, LOOK_IDS, setLook, lookParams } from "./style.js";
import { sizeOf } from "./photo.js";
import { IMAGE_PROVIDERS, IMAGE_DEFAULTS, MAX_STYLES, loadStyles, styleText, legacyStyles, userStyle, writeStyle, freeId, promptOf, normalizeImageAi, imageReady, imageEndpoint, buildImageRequest, readImageReply, refusedParam, imageCheck, readImageCheck, repaintPrompt } from "./repaint.js";
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
  photos: new Map(),                     // the photo store: pid -> {src, img, original, mask: {img, src} | null} (see putPhoto)
  imageAi: normalizeImageAi(null),       // the image model that repaints photos (image-ai.json)
  repaintStyles: [],                     // the built-in repaint styles: [{id, file, name}] (ui/repaint-styles/index.json)
  myStyles: [],                          // the user's own repaint styles, Markdown files in the app data folder repaint-styles/ (see userStyle)
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
  if (L.type === "asset") return assetExists(L.ref) ? assetName(L.ref, getLang()) : t("assets.missing");
  if (L.type === "text") return L.text.split("\n")[0].replace(/\*/g, "").slice(0, 16) || t("layer.text");
  if (L.type === "photo") return t(L.of ? "layer.photoCut" : L.fill ? "layer.photoFill" : "layer.photo");
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
const persistCover = () => later("cover", 400, () => writeJson("session.json", S.cover).catch(fail));
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
  const i = S.histIdx + step;
  if (i < 0 || i >= S.hist.length) return;
  S.histIdx = i;
  const { p, c } = JSON.parse(S.hist[i]);
  const profile = normalizeProfile(p);
  S.profiles[S.profiles.findIndex((x) => x.id === S.profile.id)] = profile;
  S.profile = profile;
  S.cover = normalizeCover(c, profile);
  await applyProfile();
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
/** Everything that has to happen when S.profile / S.cover are replaced or restored. */
async function applyProfile() {
  S.cover = normalizeCover(S.cover, S.profile);
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
const goLive = (ids) => {
  ids = [].concat(ids);
  for (const L of S.cover.layers) if (L.of && ids.includes(L.of)) ids.push(L.id);   // a photo's copies move with it
  const key = ids.join(" ");
  if (!LIVE || LIVE.key !== key) LIVE = { ids, key };
};
const endLive = () => { if (LIVE) { LIVE = null; queueDraw(); } };
function drawMain() {
  const stage = $("stage"), cv = $("cv"), size = selSize(), [vw, vh] = virtualSize(size.w, size.h);
  const k = Math.max(0.05, Math.min((stage.clientWidth - 36) / vw, (stage.clientHeight - 36) / vh));
  cv.style.width = Math.round(vw * k) + "px"; cv.style.height = Math.round(vh * k) + "px";
  document.documentElement.dataset.look = S.profile.style.look;   // the two main buttons dress to match the cover (see index.html)
  paint(cv, size, Math.min(vw * 1.5, vw * k * (window.devicePixelRatio || 1)), S.cover, catIndex(), S.mode === "edit" ? S.layerId : null, S.mode === "edit" ? LIVE : null,
    S.mode === "edit" ? { picked: group().map((L) => L.id) } : {});
  const clear = !layer("bg").visible;
  stage.classList.toggle("alpha", clear); $("strip").classList.toggle("alpha", clear);
}
function drawThumbs() {
  for (const size of S.profile.sizes) { const cv = $("th-" + sizeKey(size)); if (cv) paint(cv, size, virtualSize(size.w, size.h)[0] * 0.2); }
}
let drawQueued = false;
function flushDraw() { if (!drawQueued) return; drawQueued = false; drawMain(); later("thumbs", 140, drawThumbs); }
/** Redraws at most once per frame, however many input events arrive. */
function queueDraw() {
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
  $("toolbar").replaceChildren(...[el("span", { class: "name" }, sizeLabel(selSize())),
    S.mode === "edit" && el("div", { class: "grp" }, el("span", {}, t("props.scope")), el("div", { class: "seg" }, scope("all"), scope("size"))),
    S.mode === "edit" && el("span", { class: "hint" }, t("cover.how"))].filter(Boolean));
}

// ---------- editing layers
function selectLayer(id) { if (S.layerId === id && !group().length) return; S.picked = []; S.layerId = id; renderSide(); queueDraw(); }
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
  renderSide(); queueDraw();
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
function editAll(list, patch) { for (const L of list) adjust(L, frame(), S.settings.scope, patch); touch({ cover: true }); }
function removeGroup() {
  const gone = group().filter((L) => isFree(L.type));
  if (!gone.length) return;
  S.cover.layers = S.cover.layers.filter((L) => !gone.includes(L));
  S.picked = []; S.layerId = "bg";
  touch({ cover: true, side: true });
}
/** Applies a placement edit to a layer in the current scope, then redraws. */
function edit(L, patch) { adjust(L, frame(), S.settings.scope, patch); touch({ cover: true }); }
function addLayer(L) {
  insertAbove(S.cover.layers, S.layerId === "bg" ? "bg" : S.layerId, L);
  S.layerId = L.id;
  touch({ cover: true, side: true });
  return L;
}
function addAsset(ref, at) {
  const L = newLayer("asset", { ref, tint: ref.kind === "user" && canTint(ref) });   // generated stickers follow the channel colour from the start
  if (at) { L.t.all.x = at.x; L.t.all.y = at.y; }
  if (ref.kind === "sticker") L.t.all.s = 0.3;
  addLayer(L);
  toast(t("assets.added", assetName(ref, getLang())));
}
function removeLayer(id = S.layerId) {
  const L = layer(id);
  if (!L || !isRemovable(L.type)) return;
  if (L.type === "photo") S.cover.layers = S.cover.layers.filter((l) => l.of !== L.id);   // its copies show nothing without it
  const i = S.cover.layers.indexOf(L);
  S.cover.layers.splice(i, 1);
  S.layerId = S.cover.layers[Math.max(1, i - 1)].id;
  touch({ cover: true, side: true });
}
function duplicateLayer() {
  const L = layer(), c = L && duplicate(L);
  if (!c) return;
  insertAbove(S.cover.layers, L.id, c); S.layerId = c.id;
  touch({ cover: true, side: true });
}
function shiftLayer(dir) {
  const to = stepIndex(S.cover.layers, S.layerId, dir, cat().id);
  if (to > 0 && moveLayer(S.cover.layers, S.layerId, to)) touch({ cover: true, side: true });
}
/** Which categories a free layer belongs to: null = all of them, or a list of category ids. */
function setCats(L, cats) {
  if (cats) L.cats = cats; else delete L.cats;
  if (!appliesTo(L, cat().id)) toast(t("props.catsGone"));
  touch({ cover: true, side: true });
}
function catsControl(L) {
  const all = !L.cats;
  const chip = (label, on, color, fn) => el("button", { class: on ? "on" : "", style: color ? `--c:${color}` : "", onclick: fn }, label);
  return el("div", { style: "margin-top:12px" }, cap("props.cats"),
    el("div", { class: "chips small" },
      chip(t("props.catsAll"), all, "", () => setCats(L, null)),
      S.profile.categories.map((k) => chip(k.name || k.code || "—", !all && L.cats.includes(k.id), k.color, () => {
        if (all) return setCats(L, [k.id]);
        const next = L.cats.includes(k.id) ? L.cats.filter((x) => x !== k.id) : [...L.cats, k.id];
        if (next.length) setCats(L, next);          // the last one stays: a layer always belongs somewhere
      }))),
    el("div", { class: "hint" }, t(all ? "props.catsHintAll" : "props.catsHint")));
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
    if (group().length || !L || !hit || hit.fill || L.locked || L.type === "bg" || FIXED.includes(L.type)) return null;
    const p = virtualPoint(e), a = (-hit.r * Math.PI) / 180, dx = p.x - hit.cx, dy = p.y - hit.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const handle = handles(hit, p.k).find((h) => Math.hypot(lx - h.lx, ly - h.ly) <= 11 * p.k);
    return { L, hit, p, lx, ly, handle: handle ? handle.id : null };
  }
  cv.addEventListener("pointermove", (e) => {
    if (e.buttons || S.mode !== "edit") return;
    const g = grip(e);
    if (g && g.handle) { cv.style.cursor = CURSOR[g.handle]; return; }
    const L = layerAt(e);
    cv.style.cursor = !L || L.type === "bg" ? "default" : fillsCanvas(L) ? "move" : "grab";
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
    const L = layerAt(e);
    if (!L || L.locked || FIXED.includes(L.type) || L.type === "bg") return;
    selectLayer(L.id);
    goLive(L.id); later("live", 300, endLive);
    edit(L, e.altKey ? { rot: e.deltaY > 0 ? 2 : -2 } : { scale: Math.exp(-e.deltaY * 0.0015) });
    later("side", 250, renderSide);
  }, { passive: false });
  $("stage").addEventListener("pointerdown", (e) => { if (e.target === $("stage") && S.mode === "edit" && S.cover) selectLayer("bg"); });
  // assets dragged from the library land where they are dropped
  cv.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("application/x-smed-asset")) e.preventDefault(); });
  cv.addEventListener("drop", (e) => {
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
const px = (v) => String(Math.round(v)), times = (v) => v.toFixed(2) + "×", pct = (v) => Math.round(v * 100) + "%", deg = (v) => Math.round(v) + "°";

// ---------- left panel, Edit mode
function coverTab() {
  const c = S.cover;
  return [
    el("div", {}, cap("cover.category"), el("div", { class: "chips" }, S.profile.categories.map((k) =>
      el("button", { class: k.id === c.catId ? "on" : "", style: `--c:${k.color}`, onclick: () => { c.catId = k.id; touch({ cover: true, panel: true, side: true }); } }, k.name || k.code || "—")))),
    el("div", {}, cap("cover.title"),
      el("textarea", { value: c.title, spellcheck: false, oninput: (e) => { c.title = e.target.value; touch({ cover: true }); } }),
      el("div", { class: "hint" }, t("cover.titleHint"))),
    el("div", {}, cap("cover.tag"), textInput(c.tag, (v) => { c.tag = v; touch({ cover: true }); }, { placeholder: t("cover.tagPh") })),
    photoBox(),
  ];
}
/** Cover → photos: the background photo (with its cut-out and repaint) and photos added as layers. */
function photoBox() {
  const main = mainPhoto(), rec = recordOf(main), im = rec && rec.img;
  return el("div", { class: "box" }, cap("cover.photo"),
    el("div", { class: "row", style: "margin-top:0" },
      el("button", { class: "btn", onclick: async () => { const f = await pickFile("image/*"); if (f) setBackground(await readAs(f, "readAsDataURL")); } }, t(main ? "cover.replace" : "cover.pick")),
      el("button", { class: "btn", disabled: !main, onclick: () => setBackground("") }, t("cover.removePhoto"))),
    im && el("div", { class: "thumb" }, el("img", { src: rec.src, alt: "" }),
      el("span", {}, `${sizeOf(im)[0]} × ${sizeOf(im)[1]}`, rec.original && ` · ${t("rep.isRepainted")}`)),
    el("div", { class: "hint" }, t("cover.photoHint")),
    im && cutBox(),
    im && repaintBox(),
    el("button", { class: "btn wide", style: "margin-top:14px", onclick: addPhotoLayer }, t("cover.addPhoto")),
    el("div", { class: "hint" }, t("cover.addPhotoHint")));
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
/** Reads the session's pictures for these ids, and drops the files of any others. */
async function loadPhotos(pids) {
  for (const pid of pids) {
    if (S.photos.has(pid)) continue;
    const read = (ext) => files.read(`photos/${pid}${ext}`).catch(() => "");
    await putPhoto((await read("")) || "", { original: (await read(".original")) || "", mask: (await read(".mask")) || "", pid, save: false });
  }
  for (const f of await files.list("photos").catch(() => [])) if (!pids.has(f.replace(/\.(original|mask)$/, ""))) files.remove(`photos/${f}`).catch(() => null);
}
/** The cover's background photo: the lowest photo layer that fills the canvas, on this channel. */
const mainPhoto = () => S.cover.layers.find((l) => fillsCanvas(l) && appliesTo(l, cat().id)) || null;
/** The picture a photo layer shows: its own, or for a copy its original's. */
const recordOf = (L) => { const base = L && (L.of ? layer(L.of) : L); return (base && S.photos.get(base.pid)) || null; };
/** The copy of a photo that stands, cut out, in front of the title. */
const frontOf = (L) => (L ? S.cover.layers.find((l) => l.type === "photo" && l.of === L.id && l.cut) || null : null);

/** Sets the background photo from a data URL ("" removes it, with its copies). */
async function setBackground(src) {
  const main = mainPhoto();
  REP.result = null; REP.error = ""; CUT.error = "";
  if (!src) {
    if (main) { S.cover.layers = S.cover.layers.filter((l) => l !== main && l.of !== main.id); S.layerId = "bg"; }
    return touch({ cover: true, panel: true, side: true });
  }
  const pid = await putPhoto(src);
  if (!pid) return toast(t("msg.badFile"));
  let L = main;
  if (L) L.pid = pid;
  else { L = newLayer("photo", { pid, fill: true }); insertAbove(S.cover.layers, "bg", L); }
  S.layerId = L.id;
  touch({ cover: true, panel: true, side: true });
  if (frontOf(L) || S.cover.layers.some((l) => l.of === L.id && l.cut)) recut(pid);   // its cut-out copies need the new photo's subject
}
/** Adds a photo as a layer of its own, on the canvas like a print. */
async function addPhotoLayer() {
  const f = await pickFile("image/*");
  if (!f) return;
  const pid = await putPhoto(await readAs(f, "readAsDataURL"));
  if (!pid) return toast(t("msg.badFile"));
  addLayer(newLayer("photo", { pid }));
  toast(t("cover.photoAdded"));
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
  return cover;
}

function tile(ref, onRemove) {
  const cv = el("canvas", { width: 132, height: 132 });
  const x = cv.getContext("2d");
  x.translate(66, 66); x.scale(0.19, 0.19);
  drawAsset(x, ref, hexToRgb(cat().color), { tint: ref.kind === "graphic" });
  return el("div", { class: "tile", title: assetName(ref, getLang()), draggable: true, onclick: () => addAsset(ref),
    ondragstart: (e) => { e.dataTransfer.setData("application/x-smed-asset", JSON.stringify(ref)); e.dataTransfer.effectAllowed = "copy"; } },
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
function assetsTab() {
  const lang = getLang(), mine = [...userAssets.values()];
  return [
    el("button", { class: "btn solid wide", onclick: uploadAssets }, t("assets.upload")),
    el("div", { class: "hint", style: "margin:-6px 0 0" }, t("assets.hint")),
    aiSection(),
    el("div", {}, cap("assets.mine", ` · ${mine.length}`), mine.length
      ? el("div", { class: "tiles" }, mine.map((a) => tile({ kind: "user", id: a.id }, () => removeAsset(a.id))))
      : el("div", { class: "hint", style: "margin:0" }, t("assets.mineEmpty"))),
    el("div", {}, cap("assets.graphics"), el("div", { class: "tiles" }, GRAPHICS.map((g) => tile({ kind: "graphic", id: g.id })))),
    el("div", {}, cap("assets.shapes"), el("div", { class: "tiles" }, ACCENT_SHAPES.map(shapeTile)), el("div", { class: "hint" }, t("assets.shapesHint"))),
    STICKER_GROUPS.map((g) => el("div", {}, el("label", { class: "cap" }, g.name[lang]), el("div", { class: "tiles" }, STICKERS.filter((s) => s.group === g.id).map((s) => tile({ kind: "sticker", id: s.id }))))),
  ];
}
// ---------- AI-generated assets
// ---------- a photo's subject, cut out (Apple Vision, macOS 14+; see src-tauri/src/subject.rs)
const CUT = { busy: false, error: "" };
const canCut = () => native && /Mac/i.test(navigator.userAgent);
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
  if (rec.mask && !fresh) return true;
  Object.assign(CUT, { busy: true, error: "" }); if (onCoverTab()) renderPanel(); renderSide();
  const img = rec.img;
  try {
    const png = await invoke("subject_mask", await photoBytes(img));
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
 * Cuts the background photo's subject out and stands it in front of the title: a copy of the
 * photo layer, cut out, above the title (if there is none yet). Returns whether it worked.
 */
async function cutOut(fresh = false) {
  const main = mainPhoto();
  if (!main || CUT.busy || !canCut()) return false;
  if (!(await ensureMask(main.pid, fresh))) return false;
  let c = frontOf(main);
  if (!c) { c = newLayer("photo", { of: main.id, cut: true }); insertAbove(S.cover.layers, "title", c); }
  S.layerId = c.id;
  touch({ cover: true, side: true, panel: true });
  return true;
}
/** Takes the cut-out back: the copies standing in front go. */
function uncut() {
  const main = mainPhoto();
  if (!main) return;
  S.cover.layers = S.cover.layers.filter((l) => !(l.of === main.id && l.cut));
  if (!layer()) S.layerId = main.id;
  touch({ cover: true, side: true, panel: true });
  toast(t("cut.undone"));
}
function cutBox() {
  if (!canCut()) return el("div", { class: "hint" }, t("cut.onlyMac"));
  const has = !!frontOf(mainPhoto());
  return el("div", { class: "cut" },
    el("button", { class: "btn wide", style: "margin-top:10px", disabled: CUT.busy, onclick: () => cutOut(has) }, t(CUT.busy ? "cut.busy" : has ? "cut.again" : "cut.go")),
    has && el("button", { class: "btn wide", disabled: CUT.busy, onclick: uncut }, t("cut.undo")),
    CUT.error && el("div", { class: "hint err" }, CUT.error),
    el("div", { class: "hint" }, t(has ? "cut.done" : "cut.hint")));
}

// ---------- repainting the background photo with an image model (see repaint.js)
const REP = { busy: false, job: 0, since: 0, error: "", result: null, test: null, confirmDrop: null };   // test: the image model's connection check   // result: {src, w, h} waiting to be used or dropped
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
async function imageCall(cfg, prompt, pic) {
  const req = buildImageRequest(cfg, prompt, pic, pic.w, pic.h);
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
/** Repaints the background photo — always from the original, so repaints do not pile up on each other. */
async function repaintPhoto() {
  const cfg = S.imageAi;
  const rec = recordOf(mainPhoto());
  if (!rec || REP.busy) return;
  const mine = myStyle(), preset = builtIn();
  if (mine && !promptOf(mine.body)) return toast(t("rep.needCustom"));
  let text = mine ? promptOf(mine.body) : "";
  if (preset) { try { text = await styleText(preset); } catch (e) { REP.error = String(e.message); return renderPanel(); } }
  const job = ++REP.job, from = rec.original ? await loadImage(rec.original) : rec.img;
  const prompt = repaintPrompt({ source: mine || preset ? "text" : "look", look: S.profile.style.look, color: cat().color, text, notes: cfg.notes });
  Object.assign(REP, { busy: true, error: "", result: null, since: Date.now() });
  renderPanel();
  const tick = setInterval(() => { const b = document.getElementById("rep-go"); if (b && REP.busy) b.textContent = repBusyText(); }, 1000);
  let result = null, error = "";
  try { result = await imageCall(cfg, prompt, shrink(from || rec.img, 1536)); }
  catch (e) { error = String(e && e.message ? e.message : e); }
  clearInterval(tick);
  if (job !== REP.job) return;                       // cancelled meanwhile
  Object.assign(REP, { busy: false, result, error });
  if (onCoverTab()) renderPanel();
}
function cancelRepaint() { REP.job++; Object.assign(REP, { busy: false, error: "", result: null }); renderPanel(); }
/**
 * Puts another picture into a photo's record — a repaint, or back to the original — so every layer
 * showing it changes; its subject is cut out again for the layers that are cut.
 */
async function swapPicture(L, src, repainted) {
  const rec = recordOf(L), pid = L && (L.of ? layer(L.of) : L).pid, img = src ? await loadImage(src) : null;
  if (!rec || !img) return;
  if (repainted) rec.original = rec.original || rec.src; else rec.original = "";
  Object.assign(rec, { src, img, mask: null });
  REP.result = null;
  savePhoto(pid);
  touch({ cover: true, panel: true, side: true });
  recut(pid);
}
async function useRepaint() {
  const r = REP.result;
  if (!r) return;
  await swapPicture(mainPhoto(), r.src, true);
  toast(t("rep.used"));
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
function repaintBox() {
  const c = S.imageAi, lang = getLang();
  const set = (k, v, redraw = false) => { S.imageAi = normalizeImageAi({ ...S.imageAi, [k]: v }); persistImageAi(); if (redraw) renderPanel(); };
  /** Edits the selected style of the user's own and saves its file (typing must not rebuild the form). */
  const rename = (v) => { const st = myStyle(); if (!st) return; delete st.meta["name.zh"]; delete st.meta["name.en"]; st.meta.name = v; st.name = { zh: v, en: v }; saveMyStyle(st); };
  const rewrite = (v) => { const st = myStyle(); if (!st) return; st.body = v; st.prompt = promptOf(v); saveMyStyle(st); };
  const head = el("label", { class: "cap", style: "margin-top:14px" }, t("rep.title"));
  if (!imageReady(c)) {
    return el("div", { class: "rep" }, head, el("div", { class: "hint", style: "margin:0 0 10px" }, t("rep.needSetup")),
      el("button", { class: "btn wide", onclick: () => { S.tab.setup = "ai"; setMode("setup"); } }, t("rep.goSetup")));
  }
  const look = LOOKS[S.profile.style.look] || LOOKS.cel, r = REP.result;
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
  return el("div", { class: "rep" }, head,
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
    REP.error && el("div", { class: "hint err" }, t("msg.failed", REP.error)),
    r && [
      el("div", { class: "compare" },
        el("figure", {}, el("img", { src: recordOf(mainPhoto()).original || recordOf(mainPhoto()).src, alt: "" }), el("figcaption", {}, t("rep.before"))),
        el("figure", {}, el("img", { src: r.src, alt: "" }), el("figcaption", {}, `${t("rep.after")} · ${r.w} × ${r.h}`))),
      el("div", { class: "row" },
        el("button", { class: "btn solid", onclick: useRepaint }, t("rep.use")),
        el("button", { class: "btn", onclick: () => { REP.result = null; renderPanel(); } }, t("ai.discard")))],
    recordOf(mainPhoto()).original && el("button", { class: "btn wide", style: "margin-top:8px", disabled: REP.busy, onclick: () => swapPicture(mainPhoto(), recordOf(mainPhoto()).original, false) }, t("rep.restore")),
    el("div", { class: "hint" }, t("rep.hint", t("img.provider." + c.provider), c.model)));
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
  return [el("div", { class: "seg wide" }, tab("text"), tab("image")), ...(pane === "image" ? imageAiPane() : textAiPane())];
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
async function uploadAssets() {
  let bad = 0;
  for (const f of await pickFiles("image/png,image/svg+xml,image/webp,image/jpeg", true)) {
    if (!(await adoptAsset(f.name.replace(/\.[^.]+$/, ""), await readAs(f, "readAsDataURL")))) bad++;
  }
  if (bad) toast(t("msg.badFile"));
  renderPanel();
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
  const st = S.profile.style, tpl = st.template, adj = st.layoutAdjust[tpl] || {}, cv = $("cv");
  const now = cv._layout && cv._virtual ? layoutValues(cv._layout, cv._virtual[0], cv._virtual[1]) : { size: 0.3, slant: 0 };
  const set = (k, v) => { st.layoutAdjust[tpl] = { ...(st.layoutAdjust[tpl] || {}), [k]: v }; touch({ profile: true }); };
  const split = tpl === "split", changed = Object.keys(adj).length > 0;
  return el("div", { class: "box" }, cap("style.layout"),
    slider2(t(split ? "style.laySide" : "style.layBand"), LAYOUT_LIMITS.size[0], LAYOUT_LIMITS.size[1], 0.01, adj.size ?? now.size, (v) => set("size", v)),
    slider2(t("style.laySlant"), LAYOUT_LIMITS.slant[0], LAYOUT_LIMITS.slant[1], 0.005, adj.slant ?? now.slant, (v) => set("slant", v)),
    el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: !!adj.flip, onchange: (e) => { set("flip", e.target.checked); renderPanel(); } }), el("span", {}, t(split ? "style.layFlipSplit" : "style.layFlipStack"))),
    el("button", { class: "btn wide", style: "margin-top:10px", disabled: !changed, onclick: () => { delete st.layoutAdjust[tpl]; touch({ profile: true, panel: true }); } }, t("style.layReset")),
    el("div", { class: "hint" }, t("style.layHint")));
}
function styleTab() {
  const st = S.profile.style, set = (k, v) => { st[k] = v; touch({ profile: true }); };
  const L = LOOKS[st.look] || LOOKS.cel, vals = lookParams(st.look, st.lookParams[st.look]);
  const tune = (k, v) => { st.lookParams[st.look] = { ...vals, ...st.lookParams[st.look], [k]: v }; touch({ profile: true }); };
  return [
    el("div", { class: "box" }, cap("style.look"),
      select(LOOK_IDS.map((k) => [k, LOOKS[k].name[getLang()]]), st.look, (v) => { st.look = v; touch({ profile: true, panel: true, side: true, strip: true }); }),
      L.about && el("div", { class: "about" }, L.about[getLang()]),
      el("div", { class: "hint" }, t("style.lookHint")),
      L.params.map((d) => (d.toggle
        ? el("label", { class: "chk", style: "margin:10px 0 0" }, el("input", { type: "checkbox", checked: vals[d.key] > 0, onchange: (e) => tune(d.key, e.target.checked ? 1 : 0) }), el("span", {}, d.name[getLang()]))
        : d.needsPhoto && !recordOf(mainPhoto())
          ? el("div", { class: "sl off", style: "grid-template-columns:84px 1fr", title: t("style.needsPhoto") }, el("span", {}, d.name[getLang()]), el("span", { class: "why" }, t("style.needsPhoto")))   // nothing for it to act on yet
          : slider2(d.name[getLang()], d.min, d.max, d.step, vals[d.key], (v) => tune(d.key, v)))),
      L.seeded && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { st.lookSeed = Math.floor(Math.random() * 1000000); touch({ profile: true }); } }, t("style.shuffle")),
      L.seeded && el("div", { class: "hint" }, t("style.shuffleHint")),
      L.params.length > 0 && el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { delete st.lookParams[st.look]; touch({ profile: true, panel: true }); } }, t("style.lookReset"))),
    el("div", {}, cap("style.template"), select(["stack", "split", "banner"].map((k) => [k, t("tpl." + k)]), st.template, (v) => { st.template = v; touch({ profile: true }); later("laybox", 60, renderPanel); })),   // the controls below belong to the template: rebuild them once it has been drawn
    layoutBox(),
    !L.oneTheme && el("div", {}, cap("style.theme"), select([["dark", t("theme.dark")], ["light", t("theme.light")]], st.theme, (v) => set("theme", v))),
    check("style.imageShadow", st.imageShadow, (v) => set("imageShadow", v)),
    el("div", { class: "box" }, cap("style.design"),
      el("button", { class: "btn wide", onclick: () => { S.profile.design.layers = JSON.parse(JSON.stringify(S.cover.layers.filter((l) => l.type !== "photo"))); touch({ profile: true }); toast(t("style.designSaved")); } }, t("style.saveDesign")),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { S.cover.layers = keepPhotos(JSON.parse(JSON.stringify(S.profile.design.layers)), S.cover.layers); S.layerId = "title"; touch({ cover: true, side: true }); } }, t("style.loadDesign")),
      el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => { for (const L of S.cover.layers) if (!isFree(L.type)) resetPlacement(L, "all"); touch({ cover: true, side: true }); } }, t("style.resetAll")),
      el("div", { class: "hint" }, t("style.designHint"))),
  ];
}

// ---------- left panel, Setup mode
function brandTab() {
  const P = S.profile, lang = getLang(), struct = () => touch({ profile: true, cover: true, panel: true, side: true });
  const refValue = (g) => (g.kind === "none" ? "none" : `${g.kind}:${g.id}`);
  const options = [["none", t("cat.none")],
    { group: t("cat.groupGraphics"), items: GRAPHICS.map((g) => ["graphic:" + g.id, g.name[lang]]) },
    { group: t("cat.groupMine"), items: [...userAssets.values()].map((a) => ["user:" + a.id, a.name]) },
    { group: t("cat.groupStickers"), items: STICKERS.map((s) => ["sticker:" + s.id, s.name[lang]]) }];
  const card = (c, i) => {
    const lib = c.graphic.kind === "graphic" && GRAPHICS.find((g) => g.id === c.graphic.id);
    // working on a channel shows that channel on the canvas
    const show = () => { if (S.cover.catId !== c.id) { S.cover.catId = c.id; document.documentElement.style.setProperty("--acc", c.color); touch({ cover: true, strip: true }); } };
    return el("div", { class: "card", style: `--c:${c.color}`, onfocusin: show, onpointerdown: show, oninput: show },
      el("div", { class: "head" },
        el("input", { type: "color", value: c.color, title: t("cat.color"), oninput: (e) => { c.color = e.target.value; e.target.closest(".card").style.setProperty("--c", c.color); document.documentElement.style.setProperty("--acc", c.color); touch({ profile: true }); } }),
        textInput(c.name, (v) => { c.name = v; touch({ profile: true }); }, { placeholder: t("cat.name") })),
      el("div", { class: "two" },
        textInput(c.sub, (v) => { c.sub = v; touch({ profile: true }); }, { placeholder: t("cat.sub") }),
        textInput(c.code, (v) => { c.code = v; touch({ profile: true }); }, { placeholder: t("cat.code") })),
      select(options, refValue(c.graphic), (v) => {
        const [kind, ...rest] = v.split(":");
        c.graphic = kind === "none" ? { kind: "none" } : { kind, id: rest.join(":"), labels: [], stamp: "" };
        struct();
      }),
      lib && lib.labels && textInput((c.graphic.labels || []).join("，"), (v) => { c.graphic.labels = v.split(/[,，]/).map((x) => x.trim()).filter(Boolean).slice(0, 4); touch({ profile: true }); }, { placeholder: t("cat.labels") }),
      lib && lib.stamp && textInput(c.graphic.stamp || "", (v) => { c.graphic.stamp = v; touch({ profile: true }); }, { placeholder: t("cat.stamp") }),
      el("div", { class: "acts" },
        el("button", { class: "btn", disabled: i === 0, onclick: () => { P.categories.splice(i - 1, 0, P.categories.splice(i, 1)[0]); struct(); } }, t("cat.up")),
        el("button", { class: "btn", disabled: i === P.categories.length - 1, onclick: () => { P.categories.splice(i + 1, 0, P.categories.splice(i, 1)[0]); struct(); } }, t("cat.down")),
        el("button", { class: "btn", onclick: () => {
          if (P.categories.length < 2) return toast(t("msg.lastCategory"));
          P.categories.splice(i, 1);
          S.cover = normalizeCover(S.cover, P); struct();
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
function fontControl(L) {
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
  return el("div", { style: "margin-top:10px" }, cap("props.font"), select(options, L.font || "", async (v) => {
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
  return el("div", { class: `layer${on ? " on" : ""}${L.visible ? "" : " hidden"}`, draggable: L.type !== "bg", onclick: (e) => (e.shiftKey ? togglePick(L.id) : selectLayer(L.id)),
    ondragstart: (e) => { dragId = L.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", L.id); },
    ondragend: () => { dragId = null; },
    ondragover: (e) => { if (dragId && dragId !== L.id) { e.preventDefault(); e.currentTarget.classList.add("over"); } },
    ondragleave: (e) => e.currentTarget.classList.remove("over"),
    ondrop: (e) => {   // dropping on a row puts the dragged layer directly above it
      e.preventDefault(); e.stopPropagation();
      const id = dragId; dragId = null;
      if (!id) return;
      const from = S.cover.layers.findIndex((l) => l.id === id), to = S.cover.layers.indexOf(L);
      if (moveLayer(S.cover.layers, id, from < to ? to : to + 1)) touch({ cover: true, side: true }); else renderSide();
    } },
    icon(L.visible ? "◉" : "○", !L.visible, t("layers.show"), () => { L.visible = !L.visible; }),
    PINNED.includes(L.type) ? el("span", { class: "ic pin", title: t("layers.pinned." + L.type) }, "🔒")
      : icon(L.locked ? "▣" : "□", !L.locked, t("layers.lock"), () => { L.locked = !L.locked; }),
    el("span", { class: "nm" }, layerName(L), isFree(L.type) && el("span", { class: "ty" }, L.type === "text" ? "T" : L.type === "photo" ? "▣" : "+"),
      L.cats && el("span", { class: "only", style: `--c:${cat().color}`, title: t("layers.only", L.cats.map((id) => { const k = S.profile.categories.find((c) => c.id === id); return k ? k.name || k.code : ""; }).filter(Boolean).join(" · ")) })));
}
function placementControls(L) {
  if (L.type === "photo" && L.of) return null;   // a copy goes where its original goes
  if (FIXED.includes(L.type)) return el("div", { class: "hint", style: "margin:0" }, t("props.fixedHint"));
  if (L.type === "bg") return null;
  const f = frame(), all = S.settings.scope === "all", fills = fillsCanvas(L), free = isFree(L.type) && !fills, noRot = fills;   // a photo filling the canvas is placed like a background: moved and scaled
  const b = { dx: 0, dy: 0, s: 1, r: 0, kx: 1, ky: 1, ...L.t.by[writeKey(L, f.key, f.catId)] };
  const hold = () => { goLive(L.id); later("live", 300, endLive); };   // a slider being dragged moves one layer, like a drag on the canvas
  const setAll = (k, v) => { hold(); L.t.all[k] = v; touch({ cover: true }); };
  const setBy = (k, v) => { hold(); L.t.by[writeKey(L, f.key, f.catId)] = { ...b, ...L.t.by[writeKey(L, f.key, f.catId)], [k]: v }; touch({ cover: true }); };
  const lo = free ? 0 : fills ? -0.5 : -1, hi = free ? 1 : fills ? 1.5 : 1;
  return [
    all ? [
      slider("props.x", lo, hi, 0.002, L.t.all.x, pct, (v) => setAll("x", v)),
      slider("props.y", lo, hi, 0.002, L.t.all.y, pct, (v) => setAll("y", v)),
      slider("props.s", free ? 0.03 : 0.2, free ? 2.5 : 4, 0.01, L.t.all.s, times, (v) => setAll("s", v)),
      !noRot && [slider("props.kx", 0.2, 4, 0.01, L.t.all.kx, times, (v) => setAll("kx", v)), slider("props.ky", 0.2, 4, 0.01, L.t.all.ky, times, (v) => setAll("ky", v)),
        slider("props.r", -180, 180, 1, L.t.all.r, deg, (v) => setAll("r", v))],
    ] : [
      slider("props.x", -1500, 1500, 2, b.dx, px, (v) => setBy("dx", v)),
      slider("props.y", -1500, 1500, 2, b.dy, px, (v) => setBy("dy", v)),
      slider("props.s", 0.2, 4, 0.01, b.s, times, (v) => setBy("s", v)),
      !noRot && [slider("props.kx", 0.2, 4, 0.01, b.kx, times, (v) => setBy("kx", v)), slider("props.ky", 0.2, 4, 0.01, b.ky, times, (v) => setBy("ky", v)),
        slider("props.r", -180, 180, 1, b.r, deg, (v) => setBy("r", v))],
    ],
    el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => { resetPlacement(L, S.settings.scope, f.key, f.catId); touch({ cover: true, side: true }); } }, `${t("props.reset")} · ${t("scope." + S.settings.scope)}`),
  ];
}
/** The text effect of a headline layer, and how strong it is. */
/**
 * The title's outline and shadow sliders. Not every text effect draws them (the flat looks' plain
 * lettering has neither): a slider the effect would ignore is shown greyed, with the reason.
 */
function titleLines(L, set) {
  const use = effectUses(L.fx), name = (EFFECTS[use.id] || LOOKS[use.id]).name[getLang()];
  const line = (k, key) => (use[k]
    ? slider(key, 0, 2, 0.05, L[k], times, (v) => set(k, v))
    : el("div", { class: "sl off", style: "grid-template-columns:84px 1fr", title: t("props.fxIgnores", name) }, el("span", {}, t(key)), el("span", { class: "why" }, t("props.fxIgnores", name))));
  return [line("stroke", "props.stroke"), line("shadow", "props.shadow")];
}
function fxControl(L, first = false) {
  const set = (k, v, side) => { if (v === undefined) delete L[k]; else L[k] = v; touch({ cover: true, side }); };
  const kinds = { passes: t("fx.kind.passes"), mask: t("fx.kind.mask"), outline: t("fx.kind.outline") };
  const groups = ["passes", "mask", "outline"].map((kind) => ({ group: kinds[kind], items: Object.entries(EFFECTS).filter(([, e]) => e.kind === kind).map(([id, e]) => [id, e.name[getLang()]]) }));
  const fx = L.fx || "auto", kind = EFFECTS[fx].kind;
  return [
    el("div", { style: first ? "" : "margin-top:10px" }, cap("props.fx"), select(groups, fx, (v) => set("fx", v === "auto" ? undefined : v, true))),
    fx !== "auto" && kind !== "passes" && !(fx === "taper" && L.warp) && slider("props.fxAmt", 0, 2, 0.05, L.fxAmt ?? 1, times, (v) => set("fxAmt", v === 1 ? undefined : v, false)),
    fx === "taper" && el("div", { class: "hint" }, t("fx.warpHint")),
    fx === "taper" && L.warp && el("button", { class: "btn wide", style: "margin-top:8px", onclick: () => set("warp", undefined, true) }, t("fx.warpReset")),
    kind === "outline" && !native && el("div", { class: "hint" }, t("fx.needsApp")),
  ];
}
/**
 * A colour for a layer's lettering: a swatch to pick one, and a button back to "automatic", where
 * the layer takes whatever the current look gives it. `shown` is the swatch's colour while automatic.
 */
function inkControl(L, key, labelKey, shown) {
  const own = !!L[key];
  return el("div", { class: "ink" }, el("span", {}, t(labelKey)),
    el("input", { type: "color", value: L[key] || shown, oninput: (e) => { L[key] = e.target.value; touch({ cover: true }); later("side", 600, renderSide); } }),
    el("button", { class: "btn", disabled: !own, title: t("props.inkAutoHint"), onclick: () => { delete L[key]; touch({ cover: true, side: true }); } }, t(own ? "props.inkAuto" : "props.inkIsAuto")));
}
/** The properties of a photo layer. */
function photoControls(L, set) {
  const base = L.of ? layer(L.of) : L, rec = recordOf(L), pid = base && base.pid;
  const replace = async () => {
    const f = await pickFile("image/*");
    if (!f) return;
    const id = await putPhoto(await readAs(f, "readAsDataURL"));
    if (!id) return toast(t("msg.badFile"));
    L.pid = id; touch({ cover: true, side: true, panel: true });
    if (S.cover.layers.some((l) => l.cut && (l === L || l.of === L.id))) ensureMask(id);
  };
  const cut = async (on) => { if (on && !(await ensureMask(pid))) return renderSide(); set("cut", on, true); };
  return [
    !rec && el("div", { class: "hint err", style: "margin-top:0" }, t("props.photoMissing")),
    L.of ? el("div", { class: "hint", style: "margin-top:0" }, t("props.copyHint", base ? layerName(base) : "—"))
      : [check("props.fill", L.fill, (v) => { set("fill", v, true); if (v) { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 1 }; L.t.by = {}; } else { L.t.all = { ...L.t.all, x: 0.5, y: 0.5, s: 0.6 }; } touch({ cover: true, side: true, panel: true }); }),
         el("button", { class: "btn wide", style: "margin-top:8px", onclick: replace }, t("props.replacePhoto"))],
    slider("props.blur", 0, 80, 1, L.blur, px, (v) => set("blur", v)),
    slider("props.dim", 0, 0.9, 0.01, L.dim, pct, (v) => set("dim", v)),
    check("props.treat", L.treat, (v) => set("treat", v)),
    canCut()
      ? el("button", { class: "btn wide", style: "margin-top:10px", disabled: CUT.busy, onclick: () => cut(!L.cut) }, t(CUT.busy ? "cut.busy" : L.cut ? "props.uncut" : "props.cut"))
      : el("div", { class: "hint" }, t("cut.onlyMac")),
    L.cut && CUT.error && el("div", { class: "hint err" }, CUT.error),
    slider("props.outline", 0, 40, 1, L.outline, px, (v) => set("outline", v)),
    inkControl(L, "ink", "props.outlineInk", "#ffffff"),
    slider("props.subjectShadow", 0, 1, 0.05, L.shadow, pct, (v) => set("shadow", v)),
    el("div", { class: "hint" }, t(L.of ? "props.copyMore" : L.fill ? "props.fillHint" : "props.printHint")),
  ];
}
function typeControls(L) {
  const set = (k, v, side = false) => { L[k] = v; touch({ cover: true, side }); };
  switch (L.type) {
    case "bg": return [
      !(LOOKS[S.profile.style.look] || LOOKS.cel).oneTheme && select([["dark", t("theme.dark")], ["light", t("theme.light")]], S.profile.style.theme, (v) => { S.profile.style.theme = v; touch({ profile: true }); }),
      check("props.grid", L.grid, (v) => set("grid", v)),
      el("div", { class: "hint" }, t("props.bgHint")),
    ];
    case "photo": return photoControls(L, set);
    case "accent": return el("div", { style: "margin-bottom:10px" }, select(ACCENT_SHAPES.map((k) => [k, `${t("props.shape")} · ${t("shape." + k)}`]), L.shape, (v) => set("shape", v, false)), null);
    case "brand": return [check("props.rail", L.rail, (v) => set("rail", v)), fontControl(L), inkControl(L, "ink", "props.ink", "#ffffff")];
    case "title": return [
      fxControl(L, true),
      ...titleLines(L, set),
      fontControl(L),
      inkControl(L, "ink", "props.ink", "#ffffff"), inkControl(L, "hi", "props.inkHi", cat().color),
      el("div", { class: "hint" }, t("props.boundHint")),
    ];
    case "tag": return [fontControl(L), inkControl(L, "ink", "props.ink", "#07070c"), el("div", { class: "hint" }, t("props.boundHint"))];
    case "catname": return [check("props.showName", L.showName, (v) => set("showName", v)), check("props.plate", L.plate, (v) => set("plate", v)), fontControl(L), inkControl(L, "ink", "props.ink", "#07070c")];
    case "graphic": return el("div", { class: "hint", style: "margin:0" }, t("props.graphicHint"));
    case "asset": return canTint(L.ref) && L.ref.kind !== "graphic" ? check("props.tint", L.tint, (v) => set("tint", v)) : null;
    case "text": return [
      fxControl(L, true),
      el("div", { style: "margin-top:10px" }, cap("props.text")), el("textarea", { value: L.text, spellcheck: false, style: "height:72px", oninput: (e) => { L.text = e.target.value; touch({ cover: true }); later("side", 700, renderSide); } }),
      fontControl(L),
      check("props.plateOn", L.plate, (v) => set("plate", v, true)),
      el("div", { style: "margin-top:8px" }, select(["white", "accent", "ink", "custom"].map((k) => [k, `${t(L.plate ? "props.plateColor" : "props.color")} · ${t("color." + k)}`]), L.color,
        (v) => { L.color = v; if (v === "custom") L.ink = L.ink || cat().color; else delete L.ink; touch({ cover: true, side: true }); })),
      L.color === "custom" && el("div", { class: "ink" }, el("span", {}, t("props.inkCustom")),
        el("input", { type: "color", value: L.ink || "#ffffff", oninput: (e) => { L.ink = e.target.value; touch({ cover: true }); } }), el("span", {})),
    ];
  }
  return null;
}
function renderSide() {
  if (!S.cover) return;
  if (layer() && !appliesTo(layer(), cat().id)) S.layerId = "bg";   // the selected layer is not on this category's cover
  const side = $("side"), y = side.scrollTop, L = layer(), free = L && isFree(L.type), here = S.cover.layers.filter((l) => appliesTo(l, cat().id));
  // keep typing in the text box alive across rebuilds
  const typing = document.activeElement && side.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA";
  if (typing) return;
  const i = L ? here.indexOf(L) : -1, many = group();
  side.replaceChildren(
    el("div", {}, cap("layers.title"),
      el("div", { class: "layers" }, [...here].reverse().map(layerRow)),
      el("div", { class: "acts", style: "margin-top:10px;justify-content:flex-start" },
        el("button", { class: "btn", onclick: () => addLayer(newLayer("text", { text: t("layer.newText") })) }, t("layers.addText")),
        el("button", { class: "btn", disabled: !free || many.length > 0, onclick: duplicateLayer }, t("layers.dup")),
        el("button", { class: "btn", disabled: many.length ? !many.some((x) => isFree(x.type)) : !(L && isRemovable(L.type)), onclick: () => (many.length ? removeGroup() : removeLayer()) }, t("layers.del")),
        el("button", { class: "btn", title: t("layers.up"), disabled: many.length > 0 || i < 1 || i >= here.length - 1, onclick: () => shiftLayer(1) }, "▲"),
        el("button", { class: "btn", title: t("layers.down"), disabled: many.length > 0 || i <= 1, onclick: () => shiftLayer(-1) }, "▼"))),
    many.length ? el("div", { class: "box" }, el("label", { class: "cap" }, t("props.group", many.length)),
      el("div", { class: "hint", style: "margin-top:0" }, many.map(layerName).join(" · ")),
      many.some((x) => x.locked) && el("div", { class: "hint" }, t("props.groupLocked")),
      el("div", { class: "hint" }, t("props.groupHint")),
      el("button", { class: "btn wide", style: "margin-top:10px", onclick: () => selectLayer("bg") }, t("props.groupEnd")))
    : L ? el("div", { class: "box" }, el("label", { class: "cap" }, `${t("props.title")} · ${layerName(L)}`),
      typeControls(L), placementControls(L),
      L.type !== "bg" && slider("props.o", 0, 1, 0.01, L.o, pct, (v) => { goLive(L.id); later("live", 300, endLive); L.o = v; touch({ cover: true }); }),
      free && catsControl(L))
      : el("div", { class: "hint" }, t("layers.none")));
  side.scrollTop = y;
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
    return { index, cover: { ...S.cover, catId: S.profile.categories[index].id, title: r.title, tag: r.tag } };
  });
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
function closeModal() { const m = $("modal"); m.hidden = true; m.replaceChildren(); }
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
async function switchProfile(id) {
  S.profile = S.profiles.find((p) => p.id === id) || S.profiles[0];
  S.settings.profileId = S.profile.id; persistSettings();
  S.cover = normalizeCover({ catId: S.cover && S.cover.catId, title: S.cover && S.cover.title, tag: S.cover && S.cover.tag }, S.profile);   // the new profile's own design
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
    await switchProfile(S.profiles[0].id);
  },
  async import() {
    const f = await pickFile(".json,application/json");
    if (!f) return;
    try {
      const raw = JSON.parse(await readAs(f, "readAsText"));
      if (!raw || typeof raw !== "object") throw 0;
      await adoptEmbedded(raw.assets);
      await addProfile(raw.profile || raw);
    } catch (e) { toast(t("msg.badFile")); }
  },
  export: () => saveText(`${S.profile.name || "profile"}.smedprofile.json`,
    JSON.stringify({ app: "smedcover", kind: "profile", version: 2, profile: S.profile, assets: embedAssets(usedUserAssets(S.profile, null)) }, null, 2)),
};
/** A new layer list with the photo layers of `old` put back, each above the layer it was above (or the background). */
function keepPhotos(layers, old) {
  old.forEach((L, i) => { if (L.type !== "photo") return; const below = old[i - 1]; insertAbove(layers, below && layers.some((l) => l.id === below.id) ? below.id : "bg", L); });
  return layers;
}
/** The pictures a cover's photo layers show, for a project file: {pid: {src, original, mask}}. */
function embedPhotos(cover) {
  const out = {};
  for (const pid of pidsOf(cover)) { const r = S.photos.get(pid); if (r) out[pid] = { src: r.src, original: r.original || null, mask: r.mask ? r.mask.src : null }; }
  return out;
}
const projectActions = {
  async open() {
    const f = await pickFile(".json,application/json");
    if (!f) return;
    try {
      const raw = JSON.parse(await readAs(f, "readAsText"));
      if (!raw || raw.kind !== "project") throw 0;
      await adoptEmbedded(raw.assets);
      const pic = (v) => (typeof v === "string" && v.startsWith("data:image/") ? v : "");
      const cover = normalizeCover(raw.cover, S.profile);
      for (const [pid, p] of Object.entries(raw.photos && typeof raw.photos === "object" ? raw.photos : {})) {
        if (/^[\w-]{1,40}$/.test(pid) && p && pic(p.src)) await putPhoto(pic(p.src), { original: pic(p.original), mask: pic(p.mask), pid });
      }
      S.cover = await upgradeCover(cover, { src: pic(raw.photo), original: pic(raw.photoOriginal), mask: pic(raw.photoMask) });   // version 2 kept one photo beside the cover
      S.layerId = "title";
      touch({ cover: true, panel: true, side: true });
    } catch (e) { toast(t("msg.badFile")); }
  },
  save: () => saveText(`${(S.cover.title.split("\n")[0] || "cover").replace(/[*\\/:?"<>|]+/g, "").slice(0, 24) || "cover"}.smedcover.json`,
    JSON.stringify({ app: "smedcover", kind: "project", version: 3, profileName: S.profile.name, cover: S.cover, photos: embedPhotos(S.cover), assets: embedAssets(usedUserAssets(null, S.cover)) })),
  reset() { S.cover = normalizeCover({ catId: S.cover.catId }, S.profile); S.layerId = "title"; touch({ cover: true, panel: true, side: true }); },
};

// ---------- chrome
function setMode(mode) {
  S.mode = mode;
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
  for (const d of LOOKS[st.look].params) tuned[d.key] = d.toggle ? (chance(0.7) ? 1 : 0) : d.key === "sweepAt" ? 0 : round(between(d.min + (d.max - d.min) * 0.12, d.min + (d.max - d.min) * 0.8), d.step);
  if (Object.keys(tuned).length) st.lookParams[st.look] = tuned;
  st.theme = chance(0.7) ? "dark" : "light";
  // the template and its proportions
  st.template = pick(["stack", "stack", "split", "split", "banner"]);
  const adj = { size: round(st.template === "banner" ? between(0.12, 0.22) : between(0.24, 0.5), 0.01), slant: chance(0.35) ? 0 : round(between(-0.12, 0.12), 0.005) };
  if (chance(0.3)) adj.flip = true;
  st.layoutAdjust[st.template] = adj;
  // every layer's own choices
  const effects = Object.keys(EFFECTS).filter((id) => id !== "auto" && (native || EFFECTS[id].kind !== "outline"));
  const dealFx = (L, auto) => { delete L.fx; delete L.fxAmt; if (!chance(auto)) { L.fx = pick(effects); if (EFFECTS[L.fx].kind !== "passes") L.fxAmt = round(between(0.6, 1.5), 0.05); } };
  for (const L of S.cover.layers) {
    switch (L.type) {
      case "bg": L.grid = chance(0.75); break;
      case "accent": L.shape = pick(ACCENT_SHAPES); break;
      case "brand": L.rail = chance(0.8); break;
      case "catname": L.plate = chance(0.75); break;
      case "title": L.stroke = round(between(0.6, 1.4), 0.05); L.shadow = round(between(0.5, 1.5), 0.05); dealFx(L, 0.45); break;
      case "text": L.plate = chance(0.4); if (L.color !== "custom") L.color = pick(["white", "accent", "ink"]); dealFx(L, 0.4); break;
      case "asset": if (canTint(L.ref) && L.ref.kind !== "graphic") L.tint = chance(0.5); break;
    }
    if (isFree(L.type) && !L.locked) {   // added items shuffle about a little: nudged, turned, resized
      const a = L.t.all;
      a.x = clamp(a.x + between(-0.07, 0.07), 0.06, 0.94); a.y = clamp(a.y + between(-0.07, 0.07), 0.08, 0.92);
      a.r = round(between(-12, 12), 1); a.s = clamp(a.s * between(0.8, 1.25), 0.05, 2.5);
    }
  }
  touch({ profile: true, cover: true, panel: true, side: true, strip: true });
  commitHistory();
  toast(t("msg.surprise", LOOKS[st.look].name[getLang()], t("tpl." + st.template).split(/[：:]/)[0]));
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
    el("div", { class: "grp" }, el("span", {}, t("top.project")), b("top.open", projectActions.open), b("top.save", projectActions.save), b("top.reset", projectActions.reset)),
    el("div", { class: "grp" }, b("top.undo", () => timeTravel(-1), { disabled: S.histIdx <= 0 }), b("top.redo", () => timeTravel(1), { disabled: S.histIdx >= S.hist.length - 1 })),
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
    modal.hidden = false;
    name.focus();
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
  const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/"));
  if (f) setBackground(await readAs(f, "readAsDataURL"));
});
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (mod && key === "s") { e.preventDefault(); return projectActions.save(); }
  if (typing || !S.cover) return;
  if (mod && key === "z") { e.preventDefault(); return timeTravel(e.shiftKey ? 1 : -1); }
  if (S.mode !== "edit") return;
  const L = layer();
  if (mod && key === "d") { e.preventDefault(); return group().length ? null : duplicateLayer(); }
  if (key === "escape") return selectLayer("bg");
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
    if (a.spec) { const r = normalizeSpec(a.spec); if (r.spec) putSpecAsset(a.id, a.name, r.spec); } else await putUserAsset(a.id, a.name, a.src);
  }
  S.ai = normalizeAi(await readJson("ai.json").catch(() => null));
  const rawImageAi = await readJson("image-ai.json").catch(() => null);
  S.imageAi = normalizeImageAi(rawImageAi);
  await migrateStyles(rawImageAi);
  S.repaintStyles = await loadStyles();
  S.myStyles = await loadMyStyles();
  if ((S.imageAi.source.startsWith("preset:") && !builtIn()) || (S.imageAi.source.startsWith("my:") && !myStyle())) S.imageAi.source = "look";   // a style that is no longer there
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
  S.cover = normalizeCover(await readJson("session.json").catch(() => null), S.profile);
  if (!S.cover.title) S.cover.title = getLang() === "zh" ? "在这里写标题\n*一行*就是一行" : "Write your title\n*one line* each";
  await loadPhotos(pidsOf(S.cover));
  const legacy = (await files.read("session-photo").catch(() => "")) || "";   // before photos were layers the session kept one
  if (legacy) {
    const read = (f) => files.read(f).catch(() => "").then((v) => v || "");
    S.cover = await upgradeCover(S.cover, { src: legacy, original: await read("session-photo-original"), mask: await read("session-photo-mask") });
    const main = S.cover.layers.find((l) => fillsCanvas(l));
    // the old files go only once the new ones and the upgraded cover are on disk
    if (main && S.photos.has(main.pid)) {
      await savePhoto(main.pid);
      await writeJson("session.json", S.cover).catch(fail);
      for (const f of ["session-photo", "session-photo-original", "session-photo-mask"]) await files.remove(f).catch(() => null);
    }
    touch({ cover: true });
  } else S.cover = await upgradeCover(S.cover, null);
  await applyProfile();
  resetHistory();
  if (selftest) selfTest(selftest);
}
/** SMEDCOVER_SELFTEST mode: export real covers in every format through the normal path, report, quit. */
async function selfTest(dir) {
  const report = { ok: false, files: [], errors: [] };
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
        await setBackground(real);
        const ok = await cutOut(), main = mainPhoto(), rec = recordOf(main), m = rec && rec.mask && rec.mask.img, front = frontOf(main);
        const at = (id) => S.cover.layers.findIndex((l) => l.id === id);
        report.subject = { ok, ms: Math.round(performance.now() - t0), photo: sizeOf(rec.img), mask: m ? sizeOf(m) : null, aboveTitle: !!front && at(front.id) === at("title") + 1, error: CUT.error };
        if (ok) {
          front.outline = 8; front.shadow = 0.6; main.blur = 12;
          S.cover.title = "*Subject* in front\nof the title";
          // a second photo, as a print: turned, outlined, and one more with its background removed
          const print = newLayer("photo", { pid: main.pid, outline: 10, shadow: 0.7 }); print.t.all = { ...print.t.all, x: 0.78, y: 0.3, s: 0.32, r: -8 };
          const sticker = newLayer("photo", { pid: main.pid, cut: true, outline: 6 }); sticker.t.all = { ...sticker.t.all, x: 0.86, y: 0.72, s: 0.4, r: 6 };
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
        S.cover = normalizeCover(JSON.parse(keep), S.profile);
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
    S.cover.title = "Self test\n*binary* export"; S.cover.tag = "EP.01";
    for (const format of ["png", "jpeg", "webp"]) {
      S.settings.format = format;
      const t0 = performance.now();
      const jobs = S.profile.sizes.slice(0, 2).map((size) => ({ cover: S.cover, index: catIndex(), size }));
      const n = await runExport(jobs, async (bytes, name) => { report.files.push({ path: await invoke("write_image", framed(bytes, { dir, name })), pngBytes: bytes.length }); });
      report[format + "_ms"] = Math.round(performance.now() - t0);
      if (n !== jobs.length) report.errors.push(`${format}: ${n}/${jobs.length} — ${$("toast").textContent}`);
    }
    // one cover in every other look, so each is exercised in the real web view
    S.settings.format = "png"; report.looks = [];
    const keepLayers = JSON.stringify(S.cover.layers), snap = document.createElement("canvas");   // a stand-in photograph: colours, light and dark, some detail
    snap.width = 1200; snap.height = 800;
    const sx = snap.getContext("2d"), sky = sx.createLinearGradient(0, 0, 1200, 800);
    sky.addColorStop(0, "#f2b45a"); sky.addColorStop(0.5, "#d9486e"); sky.addColorStop(1, "#1f4fa8");
    sx.fillStyle = sky; sx.fillRect(0, 0, 1200, 800);
    for (let k = 0; k < 14; k++) { sx.fillStyle = ["#fff7d6", "#1b1b2a", "#2dd4a4"][k % 3]; sx.fillRect(40 + k * 82, 300 + ((k * 137) % 260), 56, 500); }
    const shot = await putPhoto(snap.toDataURL("image/jpeg", 0.9));
    const plain = S.cover.layers.filter((l) => !fillsCanvas(l)), withShot = [plain[0], newLayer("photo", { pid: shot, fill: true }), ...plain.slice(1)];
    for (const id of LOOK_IDS.filter((k) => k !== "cel")) for (const withPhoto of [false, true]) {
      S.profile.style.look = id; S.cover.layers = withPhoto ? withShot : plain;
      const cv = renderFull(S.profile.sizes[0], S.cover, catIndex()), name = `look-${id}${withPhoto ? "-photo" : ""}.png`;
      report.looks.push({ id, photo: withPhoto, path: await invoke("write_image", framed(await toPng(cv), { dir, name })) });
    }
    S.profile.style.look = "cel"; S.cover.layers = JSON.parse(keepLayers);
    // every text effect once, in the house look: the ones that reshape letters need outlines from the native side
    report.effects = [];
    const titleLayer = layer("title"), keep = S.cover.title;
    S.cover.title = "文字效果 *FX*\nText *effects*";
    for (const id of Object.keys(EFFECTS).filter((k) => k !== "auto")) {
      titleLayer.fx = id;
      const cv = await renderReady(S.profile.sizes[0], S.cover, catIndex());
      report.effects.push({ id, kind: EFFECTS[id].kind, path: await invoke("write_image", framed(await toPng(cv), { dir, name: `fx-${id}.png` })) });
    }
    // the perspective with corners of its own, dragged far: the lettering follows the quad
    titleLayer.fx = "taper"; titleLayer.warp = [[0, 0], [-0.05, 0.35], [0.08, -0.1], [0.04, 0]];
    report.effects.push({ id: "taper-own", path: await invoke("write_image", framed(await toPng(await renderReady(S.profile.sizes[0], S.cover, catIndex())), { dir, name: "fx-taper-own.png" })) });
    delete titleLayer.warp;
    delete titleLayer.fx; S.cover.title = keep;
    report.outline = await invoke("text_outline", { text: "A夜", families: ["Bebas Neue", "Noto Sans SC"], weight: 900 }).then((o) => ({ missing: o.missing, glyphs: o.glyphs.length, contours: o.glyphs.map((g) => g.c.length) }), (e) => ({ error: String(e) }));
    if (!report.outline.glyphs || report.outline.missing) report.errors.push("outline: the native side could not trace bundled fonts");
    if (report.ai && !report.ai.every((r) => r.stored && r.drawn)) report.errors.push("ai: a generated asset was not stored or drawn");
    report.ok = !report.errors.length;
  } catch (e) { report.errors.push(String(e && e.message ? e.message : e)); }
  await invoke("selftest_done", { report: JSON.stringify(report, null, 2) }).catch(() => null);
}
// test hook: lets automated checks drive the app without the UI
window.__smedcover = { S, drawCover, renderFull, nameFor, touch, addAsset, addLayer, newLayer, selectLayer, selectSize, setMode, layer };
start().catch((e) => { console.error(e); fail(e); });
