// The platforms covers are made for, as data: which covers each wants and how it shows them. The layouts
// (meetStandards in layout.js), the cover standards (check.js) and the sizes' names (platformsFor) read it;
// a platform that changes only needs this file changed.
//
// The ratios each platform wants were checked on a phone, uploading a video (2026-10-19). `feed` (how
// wide the cover shows in the app's feed on a phone about 390 points wide, in CSS pixels) and `zones`
// (what the app lays over the cover — the duration, the play count — as fractions of the cover) are
// estimates still to be measured; a `feed` of null means its words are not read there (a small square
// beside an article's own title).

/** The covers' ratios, by name: [w, h], and the pixels to export at. */
export const RATIOS = {
  "16:9": { w: 16, h: 9, px: [1920, 1080] },
  "4:3": { w: 4, h: 3, px: [1440, 1080] },
  "3:4": { w: 3, h: 4, px: [1080, 1440] },
  "9:16": { w: 9, h: 16, px: [1080, 1920] },
  "1:1": { w: 1, h: 1, px: [1080, 1080] },
  "2.35:1": { w: 2.35, h: 1, px: [900, 383] },
};
/** Where the badges the apps lay over a landscape cover's foot begin, as a share of its height: the words and the graphic stay above it (see meetStandards in layout.js). */
export const FOOT = 0.84;
// what the apps lay over a cover, estimated: the bottom corners of a video card
const BILI_ZONES = [{ x0: 0.78, y0: FOOT, x1: 1, y1: 1, what: "duration" }, { x0: 0, y0: FOOT, x1: 0.5, y1: 1, what: "plays" }];
const YT_ZONES = [{ x0: 0.82, y0: 0.85, x1: 1, y1: 1, what: "duration" }];

/**
 * The platforms. covers(o) gives the covers one wants, o = { orient: "h" | "v" (the video), red: the
 * ratio chosen for 小红书 }: [{ ratio, feed, zones, px }].
 */
export const PLATFORMS = [
  { id: "bili", name: { zh: "B站", en: "Bilibili" },
    covers: () => [{ ratio: "16:9", feed: 175, zones: BILI_ZONES }, { ratio: "4:3", feed: 175, zones: BILI_ZONES }] },
  { id: "youtube", name: { zh: "YouTube", en: "YouTube" },
    covers: (o) => (o.orient === "v" ? [{ ratio: "9:16", feed: 130, zones: [] }] : [{ ratio: "16:9", feed: 168, zones: YT_ZONES, px: [1280, 720] }]) },
  { id: "douyin", name: { zh: "抖音", en: "Douyin" },
    covers: () => [{ ratio: "4:3", feed: 175, zones: [] }, { ratio: "3:4", feed: 128, zones: [] }] },
  { id: "red", name: { zh: "小红书", en: "RED" },
    covers: (o) => [{ ratio: RED_RATIOS.includes(o.red) ? o.red : "3:4", feed: 185, zones: [] }] },
  { id: "channels", name: { zh: "视频号", en: "WeChat Channels" },
    covers: (o) => (o.orient === "v" ? [{ ratio: "3:4", feed: 128, zones: [] }] : [{ ratio: "3:4", feed: 128, zones: [] }, { ratio: "4:3", feed: 175, zones: [] }]) },
  { id: "mp", name: { zh: "公众号", en: "WeChat article" },
    covers: () => [{ ratio: "2.35:1", feed: 360, zones: [] }, { ratio: "1:1", feed: null, zones: [] }] },
];
export const PLATFORM_IDS = PLATFORMS.map((p) => p.id);
/** The ratios 小红书 lets a video's cover have. */
export const RED_RATIOS = ["3:4", "4:3", "1:1"];

/** Whether a size of w × h pixels is of ratio `name`. */
export const isRatio = (w, h, name) => Math.abs(w / h - RATIOS[name].w / RATIOS[name].h) < 0.01;
/** The name of the ratio a size of w × h pixels is of ("16:9"), or null when it is none of RATIOS. */
export const ratioOf = (w, h) => Object.keys(RATIOS).find((r) => isRatio(w, h, r)) || null;
/**
 * The platforms a cover of w × h pixels is for, by name in `lang` ("zh" | "en"), in the order of PLATFORMS:
 * those that want its ratio for a landscape video, or for a portrait one when no landscape video wants it
 * (9:16, YouTube's), 小红书 with its default ratio. Empty when no platform wants the ratio.
 */
export function platformsFor(w, h, lang = "zh") {
  const r = ratioOf(w, h);
  if (!r) return [];
  const by = (orient) => PLATFORMS.filter((p) => p.covers({ orient, red: "3:4" }).some((c) => c.ratio === r));
  const list = by("h").length ? by("h") : by("v");
  return list.map((p) => p.name[lang] || p.name.zh);
}
/**
 * Every cover the chosen platforms want, by ratio: [{ ratio, uses: [{ platform, feed, zones }] }], in the
 * order of RATIOS. o: { platforms: [ids], orient, red }.
 */
export function wanted(o) {
  const by = new Map();
  for (const p of PLATFORMS) {
    if (!(o.platforms || []).includes(p.id)) continue;
    for (const c of p.covers(o)) {
      if (!by.has(c.ratio)) by.set(c.ratio, []);
      by.get(c.ratio).push({ platform: p.id, feed: c.feed, zones: c.zones, px: c.px || RATIOS[c.ratio].px });
    }
  }
  return Object.keys(RATIOS).filter((r) => by.has(r)).map((ratio) => ({ ratio, uses: by.get(ratio) }));
}
