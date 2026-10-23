// the house look (cel): everything is drawn by the code's own defaults, and every look falls back to it
// One look (see style.js for the hooks a look may have, and looks/kit.js for what the looks share).
import { FX_ALL, dotsFx } from "./kit.js";

export const cel = {
  id: "cel",
  repaint: (c) => `a cel-animation background painting: every surface in flat colour with two or three hard-edged tones, crisp shadows, heavy dark ink outlines around shapes, screentone dots in the shade, simplified shapes and clean bright colours, with ${c} as the leading accent colour.`,
  about: { zh: "像动画赛璐珞片那样画：粗墨线、硬边投影、两三级明暗的平涂，暗部铺网点。频道主色铺成斜切的色块，标题是带墨线和偏移投影的粗字，素材像贴纸一样带白边。明快、有冲击力，远看也认得出——适合知识、测评、开箱、日常 vlog。", en: "Drawn like animation cels: heavy ink lines, hard-edged shadows, flat colour in two or three tones, screentone in the shade. The channel colour is a slanted block, the title heavy letters with an ink line and an offset shadow, stickers have white borders. Bright and punchy, readable from afar — for explainers, reviews, unboxings, everyday vlogs." },
  name: { zh: "赛璐珞", en: "Cel" },
  params: [],
};
cel.elementFx = [
  { key: "tone", name: { zh: "网点阴影", en: "Screentone shade" }, for: FX_ALL, stage: "over",
    /** Screentone dots of ink over the side turned from the light, as a cel's shading. */
    paint: dotsFx({ colour: () => [7, 7, 12], pitch: (E) => 7 * E.k, size: (p, a) => p * (0.1 + 0.26 * a), shade: true }) },
];
