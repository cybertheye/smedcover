---
name.zh: 半调印刷艺术
name.en: Duotone Screen Print
about.zh: 这是一种以限墨双色、圆形半调网点、纸色留白与可控印刷误差为核心的编辑式印刷美学。融合复古杂志封面、丝网版画与 Riso 孔版印刷的视觉特征：通过网点大小和密度重建明暗，以主辅墨分工建立视觉层级，让纸张底色成为构图的一部分。整体大胆、克制、平面化，强调主体轮廓与构图秩序。复古感来自印刷逻辑，而不是泛黄、污渍或简单的颗粒滤镜。
about.en: A two-ink editorial print aesthetic built around circular halftone dots, paper-white negative space, and controlled print imperfections. It combines the visual language of retro editorial covers, screen printing, and Riso zines. Tonal depth is reconstructed through dot size and density, while primary and secondary inks establish a clear visual hierarchy. The result is bold, restrained, graphic, and compositionally clear. Its vintage character comes from the logic of printmaking—not from yellowing, stains, or generic grain filters.
order: 10
swatch: #1d3557 #de4030 #f1e9d8
credit: Adapted from "taxue-halftone" by taxueseek - https://github.com/taxueseek/taxue-halftone (MIT)
---

## 完整重绘提示词 | Full Re-rendering Prompt

请将输入图像重绘为高质量的**双色半调印刷艺术作品**，融合复古编辑设计、现代丝网版画与 Riso 孔版印刷的视觉语言。请将以下参数作为明确的画面设计规则执行。

### A. 主体与构图 | Subject & Composition

-   **主体保留：** 以原图为唯一主体和构图依据。尽可能保留人物身份、面部结构、发型、姿态、视角、物体轮廓、关键细节，以及主要对象之间的位置关系。
-   **重绘范围：** 只改变色彩组织、明暗表达、网点结构、材质和图形化程度；不要无故改变人物身份、物体数量、姿态或场景逻辑。
-   **构图：** 维持原图的视觉重心与主体比例。背景可以简化，但不得削弱主体识别度。
-   **主体行为：** 默认采用 `STILL`（主体形态稳定）；只允许背景、阴影或局部纹理向外扩散，不要让主体轮廓无目的地溶解。
-   **画面比例：** 默认沿用输入图像比例；如需封面构图，优先使用竖版 4:5 或 3:4，不要为了填满画面而裁掉关键主体。

### B. 纸张与留白 | Paper & Negative Space

-   **纸张底色：** 中性白或轻微暖白，默认 `#F2EFE7`。纸色必须参与画面构成，而不是被当作透明背景。
-   **留白比例：** 目标为画面面积的 **25–55%**，按主体复杂度灵活调整。留白应帮助主体呼吸，并形成明确的视觉层级。
-   **纸张质感：** 仅保留轻微、细腻、克制的纸张纤维或印刷表面质感。避免泛黄、污渍、破损边缘等过度做旧效果。
-   **背景处理：** 优先使用大块纸色与简洁色面；不要用无意义纹理填满背景。

### C. 限墨双色系统 | Two-Ink Color System

-   **墨色数量：** 严格以 **两种专色墨 + 纸张底色** 组织画面，不要随意引入第三种彩色墨。
-   **默认配色：**
    -   主墨：深蓝 `#173B63`，占主要有色区域约 **70–85%**，负责主体结构、暗部、主要轮廓和视觉重量。
    -   辅墨：陶土橙 `#D56B4A`，占主要有色区域约 **15–30%**，只负责局部高光、情绪强调、关键边缘或小面积对比。
    -   纸色：暖白 `#F2EFE7`，用于亮部、间隔与留白。
-   **配色纪律：** 主墨负责建立主体，辅墨只承担一个清晰的辅助职责。不要把两种颜色平均分配，也不要让辅助色到处出现。
-   **色彩对比：** 两种墨色应有明确色相差异与明度分工；避免两色过于接近，导致网点层次与主体轮廓混在一起。
-   **可替换方案：** 如果使用其他配色，仍然必须指定"主墨负责什么、辅墨负责什么、纸色负责什么"，不可只写"双色复古配色"。

### D. 半调网点与明暗 | Halftone & Tonal Structure

-   **核心机制：** 使用清晰可辨的圆形半调网点（`HALFTONE DOTS`）重建明暗，而不是在完成的图像上叠加均匀噪点。
-   **网点密度：** 暗部网点更密、更大或更集中；中间调通过网点大小与间距变化表达；亮部减少网点并露出纸张底色。
-   **网点尺度：** 默认采用中等偏粗、肉眼清晰可见的网点。网点必须能在最终画面尺寸下被识别，但不能粗到吞没面部、眼睛或关键物体细节。
-   **网点方向：** 主网点角度默认 **45°**，形成稳定的印刷节奏；避免多组网点角度互相干扰，除非明确追求套色干涉效果。
-   **形体优先：** 网点必须顺应脸部体积、衣物褶皱、物体曲面、光照方向和空间层次。先建立明暗与轮廓，再让网点呈现出来。
-   **局部变化：** 可以在背景、阴影边缘或非关键区域出现网点聚散、波纹或点阵扩散；这些变化必须服务于构图，不可随机破坏主体。

### E. 印刷关系与材质 | Print Interaction & Texture

-   **印刷机制：** 模拟丝网印刷或 Riso 孔版印刷的限墨逻辑。画面应像经过设计的印版，而不是数码照片加复古滤镜。
-   **叠印关系：** 默认采用克制的专色叠印（`OVERPRINT`）；两色相交时可产生少量混色或密度变化，但不要形成脏乱的综合色块。
-   **镂空关系：** 主体高亮、关键轮廓和部分留白可以使用纸色镂空（`KNOCKOUT`），确保形体清楚。
-   **套印偏差：** 允许极轻微的套印错位（`MISREGISTER`），仅用于强化真实印刷感；不要让偏差破坏面部、文字或关键边缘。
-   **印刷陷印：** 在需要避免纸缝的边缘，可采用轻微陷印（`TRAP`）的视觉效果；整体保持干净、可控。
-   **材质原则：** 印刷感主要来自网点、专色、叠印和纸色关系。不要依赖随机颗粒、划痕、污渍或泛黄来制造"复古感"。

### F. 视觉层级与图形语言 | Hierarchy & Graphic Language

-   **层级顺序：** 主体识别度 ＞ 明暗结构 ＞ 网点表现 ＞ 色彩设计 ＞装饰细节。
-   **画面音量：** 默认图像主导、文字辅助；若用户没有明确要求，**不要添加文字、标题、边框、图标、标志或原图不存在的装饰物**。
-   **形状控制：** 保留清楚的主体外轮廓。高对比色块用于强调关键结构，而不是把所有细节都变成同等强度的图形。
-   **风格目标：** 大胆、克制、平面化、结构清晰，具有编辑设计的视觉秩序；避免过度复杂、过度装饰或廉价的滤镜感。

### G. 负面约束 | Negative Constraints

避免：普通照片滤镜、均匀覆盖的噪点、过细到不可辨识的网点、随机波点装饰、主体轮廓模糊、面部结构变形、身份改变、姿态改变、随意增加物体、无规律渐变、第三种以上彩色墨、两色平均分配、过度做旧、泛黄污渍、严重套印错位、塑料质感、廉价漫画化、过多装饰、背景细节抢夺主体注意力。

**最终目标：** 让观者一眼看出这是一张由限墨、纸色、专色关系和半调网点共同构成的印刷艺术作品；网点不仅是装饰，而是承担明暗转换与形体塑造的功能。

<!-- 以下是可替换的风格预设（第一部分已用预设 A 的配色）、速查表、总结和使用建议，给人看，不发给模型。

------------------------------------------------------------------------

## 2. 可替换风格预设 \| Swappable Style Presets

使用时，保留上方完整提示词，只替换"风格预设"段落中的颜色、网点和构图倾向。

### Preset A --- 复古编辑印刷 \| Retro Editorial Print

-   主墨：深蓝 `#173B63`
-   辅墨：陶土橙 `#D56B4A`
-   网点：中等偏粗的圆形半调网点，清楚表达摄影式明暗。
-   构图：主体突出、背景简洁、留白明确，具有杂志封面或编辑海报的秩序。
-   气质：大胆、成熟、克制；复古来自印刷逻辑，不来自污渍与泛黄。

**English style note:** A bold editorial print aesthetic with deep blue
and terracotta-orange spot inks, visible circular halftone dots, strong
subject hierarchy, restrained negative space, and clean magazine-cover
composition.

### Preset B --- 点阵解构 \| Dot-Dissolve / Halftone Deconstruction

-   主墨：深紫 `#4B2A78`
-   辅墨：鲜红 `#E4475B`
-   网点：更粗、更醒目的圆点；允许局部密度波动、同心波纹和点阵扩散。
-   主体行为：主体核心保持可辨识，边缘或背景局部向点阵转化。
-   构图：将解构集中在一至两个区域，其他区域保持清楚与安静。
-   约束：不要让波纹和扩散均匀铺满整张图，也不要破坏主体关键特征。

**English style note:** A graphic deconstruction style using bold purple
and red inks, oversized circular halftone dots, selective ripple
patterns, and controlled dot-dissolution. Keep the subject recognizable
while allowing limited areas to fragment into rhythmic dot fields.

### Preset C --- Riso 孔版小册 \| Riso Zine Print

-   主墨：深绿 `#245B45`
-   辅墨：紫色 `#7A4A91`
-   网点：可见但不喧宾夺主，保留少量油墨颗粒与轻微套印偏差。
-   构图：大面积纸白、简单色块、主体可以相对小一些，呈现独立出版物或艺术小册的气质。
-   约束：不要用大量噪点冒充油墨质感；套印偏差必须轻微且可控。

**English style note:** An independent-publishing Riso-zine aesthetic
with forest-green and violet spot inks, generous paper-white space,
restrained halftone texture, subtle ink grain, and slight registration
shifts.

### Preset D --- 高反差版画 \| High-Contrast Relief Print

-   主墨：近黑深蓝 `#182633`
-   辅墨：暖橙 `#D76A43`
-   网点：与大面积硬边色块、简洁刻线结合；优先建立强烈明暗结构。
-   构图：轮廓明确、形状简化、视觉冲击强，保留主体可识别性。
-   约束：不要把所有区域都处理成黑色剪影；关键面部或物体结构必须保留。

**English style note:** A high-contrast relief-print look combining
near-black navy, warm orange, bold silhouettes, simplified shapes, and
selective halftone shading. Preserve defining features rather than
flattening everything into an unreadable silhouette.

------------------------------------------------------------------------

## 3. 参数速查表 \| Parameter Quick Reference

  ------------------------------------------------------------------------------
  参数轴                  默认值                  作用
  ----------------------- ----------------------- ------------------------------
  纸张底色 / Paper        `#F2EFE7` 暖白          参与亮部与留白，不是透明背景

  主墨 / Primary ink      `#173B63` 深蓝          主体、暗部、主要轮廓

  辅墨 / Secondary ink    `#D56B4A` 陶土橙        单一强调职责

  墨色数量 / Ink count    两种专色 + 纸色         保持限墨系统

  主墨占比 / Primary      有色区域约 70--85%      建立主视觉重量
  share

  辅墨占比 / Secondary    有色区域约 15--30%      局部强调，不平均分配
  share

  留白 / Negative space   25--55%                 控制画面呼吸与层级

  网点类型 / Dot type     圆形半调网点            负责明暗转换与形体塑造

  网点尺度 / Dot scale    中等偏粗、清晰可见      避免太细或吞没细节

  网点角度 / Dot angle    45°                     建立稳定印刷节奏

  双色关系 / Ink          克制叠印 + 关键处镂空   兼顾印刷感与可读性
  interaction

  套印偏差 /              极轻微                  增加真实感，不破坏轮廓
  Misregistration

  主体行为 / Subject      `STILL`                 主体稳定，局部背景可解构
  behavior

  字图关系 / Type-image   图像主导，默认无文字    避免擅自增加标题与装饰
  balance

  做旧程度 / Distressing  低                      质感来自印刷机制，而非污渍
  ------------------------------------------------------------------------------

> 这些数值是可复用的起始参数，不是所有图像都必须机械遵循的硬性比例。主体复杂、背景繁杂或最终输出尺寸较小时，应优先保证识别度与网点可读性。

------------------------------------------------------------------------

## 4. 风格中英文总结 \| Style Summary in Chinese & English

### 中文总结

这是一种以**限墨双色、圆形半调网点、纸色留白和可控印刷误差**为核心的编辑式印刷美学。它融合复古杂志封面、丝网版画与
Riso
孔版印刷的视觉特征：用网点密度和大小重建明暗，用主辅墨分工建立视觉层级，让纸张底色成为画面的一部分。整体大胆、克制、平面化，强调主体轮廓与构图秩序。它的"复古感"来自真实的印刷逻辑，而不是泛黄、污渍或简单叠加颗粒滤镜。

### English Summary

A **two-ink editorial print aesthetic** built around circular halftone
dots, paper-white negative space, and controlled print imperfections. It
combines the visual language of retro editorial covers, screen printing,
and Riso zines. Tonal depth is reconstructed through dot size and
density; primary and secondary inks have distinct roles; and the paper
color becomes an active part of the composition. The result is bold,
restrained, graphic, and compositionally clear. Its vintage character
comes from the logic of printmaking---not from yellowing, stains, or a
generic grain filter.

### 一句话版本 \| One-line Version

**中文：**
用限墨双色和结构化半调网点重建明暗，让纸色参与构图，呈现大胆克制、具有真实印刷逻辑的编辑式版画美学。

**English:** Rebuild tonal depth with two spot inks and structured
halftone dots, using the paper itself as part of the composition for a
bold, restrained editorial print aesthetic.

------------------------------------------------------------------------

## 5. 使用建议 \| Usage Notes

1.  先用完整提示词，确保主体保留与印刷机制正确。
2.  再选择一个风格预设，不要一次混合所有风格。
3.  如果网点太弱，强调：`clearly visible circular halftone dots, tonal values formed by dot size and density`。
4.  如果画面太脏，强调：`clean paper, restrained ink texture, no distressed grunge, no random noise`。
5.  如果主体被破坏，强调：`preserve identity, facial structure, silhouette, pose, and original composition`。
6.  若模型容易擅自加字，明确加入：`no text, no typography, no logo, no border, no additional objects`。
-->
