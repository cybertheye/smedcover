// Built-in starting points for a new profile. normalizeProfile() in store.js fills in the rest.
import { DEFAULTS } from "./defaults.js";

/**
 * A fuller, made-up five-category channel that shows off every built-in graphic, the cube labels
 * and the stamp. Purely illustrative — the brand and categories are fictional.
 */
export function sampleProfile(lang) {
  const zh = lang === "zh";
  const builtin = (id, extra = {}) => ({ kind: "graphic", id, ...extra });
  return {
    name: "Pixel Harbor",
    brand: { name: "PIXEL HARBOR", unit: "SERIES" },
    categories: [
      { id: "shot", name: zh ? "街拍日记" : "Street Diary", sub: "STREET DIARY", code: "SHOT", color: "#ffb703", graphic: builtin("camera") },
      { id: "film", name: zh ? "胶片故事" : "Film Stories", sub: "FILM STORIES", code: "FILM", color: "#fb5607", graphic: builtin("print") },
      { id: "test", name: zh ? "器材测评" : "Gear Review", sub: "GEAR REVIEW", code: "TEST", color: "#3a86ff", graphic: builtin("probe") },
      { id: "brkd", name: zh ? "思路拆解" : "Breakdown", sub: "BREAKDOWN", code: "BRKD", color: "#a855f7", graphic: builtin("cubes", { labels: zh ? ["问题", "拆分", "尝试", "结论"] : ["Ask", "Split", "Try", "Result"] }) },
      { id: "make", name: zh ? "动手做" : "Maker Log", sub: "MAKER LOG", code: "MAKE", color: "#06d6a0", graphic: builtin("gear", { stamp: "DONE" }) },
    ],
  };
}

/**
 * A neutral profile in the given UI language: its name, brand and channels as defaults.json has them (profile.starter,
 * the user's custom.json over it, see defaults.js) — as shipped, three channels. A name given for each language
 * ({zh, en}) is the one in `lang`, else the other.
 */
export function starterProfile(lang, brandName) {
  const D = DEFAULTS.profile.starter, said = (v) => (typeof v === "string" ? v : (v && (v[lang] || v.en || v.zh)) || "");
  return {
    name: brandName || said(D.name) || (lang === "zh" ? "我的品牌" : "My brand"),
    brand: { name: brandName || said(D.brand.name) || "MY CHANNEL", unit: said(D.brand.unit) || "CHANNEL" },
    categories: D.channels.map((c) => ({ id: c.id, name: said(c.name), sub: c.sub, code: c.code, color: c.color, graphic: c.graphic ? { kind: "graphic", id: c.graphic } : { kind: "none" } })),
  };
}

/**
 * Output sizes offered in Setup → Sizes: one for each ratio the platforms want (RATIOS in platforms.js,
 * in its order), named after them as they are shown (sizeCaption in store.js). The ones a new profile
 * starts with are in defaults.json (profile.sizes). Sizes a profile has from the presets there were
 * before are kept, as its own.
 */
export const SIZE_PRESETS = [
  { w: 1920, h: 1080 },   // B站, YouTube
  { w: 1600, h: 1200 },   // B站, 抖音, 视频号
  { w: 1200, h: 1600 },   // 抖音, 小红书, 视频号
  { w: 1080, h: 1920 },   // YouTube, a portrait video
  { w: 1200, h: 1200 },   // 公众号
  { w: 900, h: 383 },     // 公众号
];
