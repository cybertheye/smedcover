// Built-in starting points for a new profile. normalizeProfile() in store.js fills in the rest.

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

/** A neutral three-category profile in the given UI language. */
export function starterProfile(lang, brandName) {
  const zh = lang === "zh";
  return {
    name: brandName || (zh ? "我的品牌" : "My brand"),
    brand: { name: brandName || "MY CHANNEL", unit: "CHANNEL" },
    categories: [
      { id: "vlog", name: zh ? "日常" : "Vlog", sub: "DAILY VLOG", code: "VLOG", color: "#fcee0a", graphic: { kind: "graphic", id: "camera" } },
      { id: "tuto", name: zh ? "教程" : "Tutorials", sub: "HOW-TO", code: "TUTO", color: "#00e5ff", graphic: { kind: "graphic", id: "probe" } },
      { id: "proj", name: zh ? "作品" : "Projects", sub: "PROJECTS", code: "PROJ", color: "#2dff8f", graphic: { kind: "graphic", id: "gear" } },
    ],
  };
}

/** Output sizes offered in the export tab. `on` marks the ones a new profile starts with. */
export const SIZE_PRESETS = [
  { w: 1920, h: 1080, label: "16:9", on: true },
  { w: 1600, h: 1200, label: "4:3", on: true },
  { w: 1200, h: 1200, label: "1:1", on: true },
  { w: 1200, h: 1600, label: "3:4", on: true },
  { w: 1080, h: 1920, label: "9:16", on: true },
  { w: 1280, h: 720, label: "16:9 · YouTube" },
  { w: 1146, h: 717, label: "16:10 · Bilibili" },
  { w: 1242, h: 1660, label: "3:4 · 小红书 RED" },
  { w: 1080, h: 1350, label: "4:5 · Instagram" },
  { w: 1080, h: 1080, label: "1:1 · Instagram" },
  { w: 1600, h: 900, label: "16:9 · X" },
  { w: 900, h: 383, label: "2.35:1 · 公众号 WeChat" },
];
