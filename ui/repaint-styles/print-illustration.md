---
name.zh: 复古编辑印刷插画
name.en: Tactile vintage editorial print illustration
about.zh: 将照片转化为有呼吸感的复古编辑印刷插画，位于摄影与抽象图形之间。保留主体身份、关键关系、氛围、方向与长宽比；用不规则色块、粗糙油墨、干刷、纸张纹理和轻微套印偏差重建画面，而非简单叠加滤镜
about.en: Turn a photograph into a tactile vintage editorial print illustration positioned between photography and abstract graphic art. Preserve subject identity, key relationships, atmosphere, orientation, and aspect ratio; rebuild the image with irregular color fields, rough ink, dry-brush marks, paper grain, and subtle print misregistration instead of applying a generic filter.
order: 10
swatch: #2e4a5a #d9793b #eadfc6
credit: Adapted from "ai-editorial-print-studio" by liuzihe849-png - https://github.com/liuzihe849-png/ai-editorial-print-studio (MIT License)
---

## 完整重绘提示词 | Full Re-rendering Prompt

请将输入图像重绘为一张**手工感复古编辑印刷插画**，融合日本档案印刷、Riso 孔版印刷、20 世纪中叶编辑插画与博物馆标本页的视觉语言。画面应介于真实照片与抽象符号之间：保留足够的现实细节来辨认主体，同时用有机轮廓、不规则色块、粗糙油墨、干刷痕迹和纸张留白重新组织图像。

### A. 图像类别与分析 | Image Class & Analysis

先根据可见内容选择一个主类别：`FOOD / BEVERAGE`、`LANDSCAPE / ARCHITECTURE`、`PORTRAIT` 或 `PRODUCT`。只根据图像中实际可见的内容判断，不要根据文件名猜测，也不要凭空添加地点、品牌、人物身份或事实。

### B. 原图保留 | Preserve the Source

-   严格保留原图方向与长宽比；不要强制裁成正方形。
-   保留主体身份、数量、轮廓、姿态、关键结构、物体之间的空间关系和原图氛围。
-   改变的是媒介与视觉组织方式，不是场景本身。
-   不要把完整矩形照片贴在纸张上；让插画以自然、不规则的印刷边缘融入纸面。
-   不要过度抽象成无法辨认的图标，也不要保留成几乎没有变化的写实照片。

### C. 纸张与留白参数 | Paper & Negative Space

-   **纸张底色：** 暖白、米白或柔和档案纸色，建议 `#F1EEE5`–`#F7F4EC`。
-   **整体留白：** 默认目标约为画布的 **50–65%**；按主体类别应用下方更具体的比例。
-   **留白分布：** 纸色应围绕插画主体分布，而不是只在一侧留下窄边。采用不对称、松弛、有呼吸感的版面。
-   **纸张纹理：** 细微可见的纸纤维、印刷颗粒和吸墨质感。纸面应温和干净，避免泛黄、污渍、破损纸边。
-   **边缘：** 使用有机、不规则、局部断裂或松散的印刷轮廓；避免矩形照片边框或模板化徽章轮廓。

### D. 色彩系统 | Color System

-   使用克制的专色调色板：暖白纸色加 **2–4 个主要印刷色层**。不要机械地让每张图使用完全相同的配色。
-   优先提取原图的色彩关系，再压缩成低饱和、略带灰度、适合印刷的颜色。保留主体原有冷暖关系，不要把所有颜色强行统一成滤镜色。
-   可选色彩包括深蓝、墨绿、砖红、赭橙、灰紫、炭黑等。颜色彼此协调，并保留清晰主次。
-   通过不规则色块、局部叠色、露纸和油墨浓淡表达体积；不要用平滑数码渐变替代印刷层次。
-   避免霓虹色、高饱和数码色、塑料般光泽和过度鲜艳的商业插画配色。

### E. 印刷媒介与笔触 | Print Medium & Mark-Making

-   **主要媒介：** 手工 Riso 孔版印刷、档案印刷插画、复古编辑版画。
-   **色块：** 用不规则、松散、略带手工误差的色面简化真实表面。保留关键材质特征，但不要逐像素复制照片纹理。
-   **油墨：** 可见粗糙油墨、局部浓淡变化、轻微漏印、边缘吸墨与色层覆盖。
-   **干刷：** 在合适区域加入柔和干刷痕迹、断续边缘和未完全覆盖的笔触；不要全图均匀撒布白色破洞或碎屑。
-   **套印偏差：** 允许轻微、局部、可控的色层错位；关键面部、标签和产品轮廓必须清楚。
-   **纹理密度：** 纹理随主体与材质变化，有疏有密。不要用统一 AI 噪点覆盖全图。
-   **写实程度：** 采用观察式编辑插画的中间地带：保留辨识所需的结构和材质信息，同时明显简化摄影细节；既不照片级写实，也不极简到只剩抽象色块。

### F. 场景关联装饰 | Scene-Linked Ornaments

如确有必要，加入 **2–5 个**安静、次要、与原图直接相关的辅助标记。装饰必须从可见元素中提取，不得套用通用几何图形模板。

-   山脉与地形：少量等高线、山脊线或地形层叠。
-   森林与植物：稀疏的植物学纹理、枝叶轮廓。
-   水面与湖泊：轻柔涟漪、水平水纹。
-   城市与建筑：建筑结构线、窗格节奏或屋顶轮廓。
-   食物与饮品：器皿轮廓、食材形态、液面或蒸汽线条。
-   人像：从服装纹理、姿态轮廓或场景提取线索。
-   产品：从产品结构、材料或用途提取线索。

如果画面本身已经足够丰富，可以不加装饰。不得凭空创造地点、品牌、人物或事实。

### G. 按类别执行构图参数 | Class-Specific Composition

#### 食物、咖啡与饮品 | Food, Coffee & Beverage

-   主体与容器组成完整视觉组，占画布 **35–45%**。
-   保留 **55–65% 连续、干净的暖白纸色留白**。
-   保留食物、容器、配料、杯口和液面等关键关系；不要拆成互不关联的图标。
-   可使用少量细线、圆点、小矩形或柔和曲线作为辅助，但必须克制并与原图内容相符。
-   避免过度写实的食材纹理、油亮高光、3D 渲染或拥挤的餐饮广告风。

#### 风景与建筑 | Landscape & Architecture

-   插画场景占画布约 **35–50%**，纸色空间约 **50–65%**。
-   使用不规则有机轮廓、自然断裂边缘和局部溶解；绝不把场景装进完整矩形框。
-   纸色围绕主体分布，采用不对称构图和松散视觉重心。
-   山脊、云层、树线、水纹、道路或建筑结构可自然延伸出主体边缘，但必须来自原图内容。
-   保留空间深度与最具辨识度的关系，避免旅游海报模板或全幅写实风景照片。

#### 人像 | Portrait

-   人物占画布约 **40–45%**，保留充分纸色空间。
-   严格保留身份、脸部结构、表情、发型、身体比例、姿态、服装关系与原图取景。
-   将肤色简化为有层次的印刷色面，但保留原图肤色的冷暖与明暗关系。
-   暖白纸色只能作为背景，不能漂白、覆盖或取代皮肤；避免肤色变灰、过曝或与背景混为一体。
-   使用克制的脸部平面、发丝块面和服装纹理，不要添加夸张卡通轮廓。

#### 产品 | Product

-   完整产品占画布约 **30–40%**，保留充足纸色空间。
-   保留产品轮廓、结构比例、材质差异、关键零件和可见标签信息。
-   不得改动型号、品牌标志或结构细节；若文字无法准确复现，不要擅自生成新文字。
-   用不规则印刷色面和细微材质笔触表现材料，不要做成光滑 3D 产品渲染。
-   辅助图形必须与产品真实结构、材质或用途有关。

<!-- 不发给模型：封面的标题和小字由文字图层负责，画面里不要文字。

### H. 编辑档案排版 | Editorial Archive Typography

-   只有用户需要封面或档案式版面时才加入文字；若要求纯插画，不添加文字。
-   可使用右上角小型档案编号 `NO. 017`，以及左下角日期和简短英文标题。
-   标题从可见内容中提炼，简短、诗意、克制；不得编造地点、品牌、人物身份或产品信息。
-   用户提供的文字必须原样保留。不要生成伪文字、乱码或无意义字母。
-   文字是次要信息，不能压过主体。避免粗重标题、过多文字块和模板化海报版式。
-->

### I. 视觉层级与最终效果 | Hierarchy & Finish

优先级：**主体辨识度与关系 ＞ 原图氛围 ＞ 构图与留白 ＞ 印刷媒介感 ＞辅助装饰与文字**。画面应像经过艺术指导的手工印刷作品：自然、不完全规则、温和、富有呼吸感。保留少量结构和材质细节，让画面仍然有观察所得的真实感。印刷感必须进入色块、边缘、笔触、叠色与纸张关系，而不是仅在写实照片上覆盖纸纹。不要把画面压缩成匿名扁平图标，也不要让所有区域具有同样密度的纹理。

### J. 负面约束 | Negative Constraints

避免：强制正方形裁切、改变原图方向或长宽比、矩形照片贴纸感、主体过大、留白不足、改变人物身份或产品结构、肤色漂白、过度写实、细节堆积、过度极简、模板化装饰、无关几何图形、随机白色碎洞、均匀 AI 噪点、过度干刷、严重套印错位、平滑数码渐变、3D 渲染、光亮塑料材质、干净矢量插画感、卡通描边、霓虹色、高饱和数码色、虚构地点或品牌、乱码文字、无关标题。

**最终目标：** 生成一张保留原图辨识关系、拥有自然纸色留白、手工印刷痕迹和场景关联细节的复古编辑插画。画面介于摄影与抽象图形之间，而不是滤镜化照片、模板化海报或纯抽象图标。

<!-- 以下是给人看的总结、速查表和使用建议，不发给模型。

------------------------------------------------------------------------

## 3. 风格中英文总结 \| Style Summary in Chinese & English

### 中文总结

这是一种**观察式复古编辑印刷插画**，融合日本档案印刷、Riso
孔版和中世纪编辑设计。它不依赖机械、均匀的半调网点，而强调不规则色块、粗糙油墨、干刷痕迹、轻微套印偏差、有机断裂边缘与连续纸色留白。画面保留主体身份、场景关系和关键材质信息，同时主动简化摄影细节。构图根据食物、风景、建筑、人像或产品分别控制主体比例；装饰必须来自原图可见元素，不能套用模板。整体温和、松弛、克制，介于真实照片与抽象符号之间。

### English Summary

An **observational vintage editorial print illustration** inspired by
Japanese archival prints, Riso printing, and mid-century editorial
graphics. Rather than relying on mechanically uniform halftone dots, it
emphasizes irregular color fields, rough ink, dry-brush marks, subtle
misregistration, organic broken edges, and generous continuous
paper-white space. It preserves subject identity, scene relationships,
and essential material cues while deliberately simplifying photographic
detail. Composition is tailored to food, landscapes, architecture,
portraits, or products, with subject scale controlled by category.
Decorative marks must come from visible source elements rather than a
reusable template. The overall mood is tactile, relaxed, restrained, and
balanced between photography and abstraction.

### 一句话版本 \| One-line Version

**中文：**
以不规则印刷色块、粗糙油墨、干刷与纸色留白，将照片重绘成介于真实与抽象之间的手工复古编辑插画。

**English:** Reimagine photographs as handmade vintage editorial
illustrations through irregular ink fields, rough print texture,
dry-brush marks, and generous paper-white space---balanced between
realism and abstraction.

------------------------------------------------------------------------

## 4. 参数速查表 \| Parameter Quick Reference

  ----------------------------------------------------------------------------------------------------
  参数                    默认值 / 规则                                        用途
  ----------------------- ---------------------------------------------------- -----------------------
  原图比例 / Aspect ratio 严格沿用输入图像方向与比例                           避免强制裁切

  纸张 / Paper            暖白 `#F1EEE5`--`#F7F4EC`                            建立档案纸质感

  调色板 / Palette        纸色 + 2--4 个克制印刷色层                           保留原图冷暖关系

  整体留白 / Negative     默认约 50--65%，按类别调整                           形成呼吸感
  space

  食物与饮品 / Food &     主体 35--45%；留白 55--65%                           保持轻盈版面
  beverage

  风景与建筑 / Landscape  场景 35--50%；纸色 50--65%                           避免矩形贴纸感
  & architecture

  人像 / Portrait         人物约 40--45%                                       保留身份并控制比例

  产品 / Product          产品约 30--40%                                       让结构与轮廓清晰

  边缘 / Edges            有机、不规则、局部断裂                               让图像融入纸面

  印刷纹理 / Texture      粗糙油墨、干刷、细微纸纹                             将媒介感融入图像

  套印偏差 /              轻微、局部、可控                                     增强手工印刷感
  Misregistration

  装饰 / Ornaments        需要时 2--5 个安静的场景关联标记                     避免模板化

  写实程度 / Realism      观察式中间地带                                       不过度写实或抽象

  文字 / Typography       可选档案编号、日期、短英文标题                       用户未要求时不添加

  禁止项 / Avoid          矩形照片贴纸、模板装饰、均匀噪点、3D、霓虹、高饱和   保持印刷插画感
  ----------------------------------------------------------------------------------------------------

------------------------------------------------------------------------

## 5. 使用建议 \| Usage Notes

1.  先识别图像类别，只选择一个主类别规则，不要混合互相冲突的构图参数。
2.  明确主体类别、可见元素和原图比例，再使用完整提示词。
3.  如果输出过于写实，强调：`simplify photographic detail into irregular printed color fields, visible rough ink, dry-brush marks, and organic broken edges`。
4.  如果输出过于抽象，强调：`preserve recognizable identity, source composition, key material cues, and spatial relationships`。
5.  如果输出像矩形照片贴在纸上，强调：`organic irregular silhouette, natural border breaking, no rectangular photo frame`。
6.  如果留白不足，明确写出对应类别的主体比例与连续纸色留白目标。
7.  如果装饰太多，强调：`only source-linked ornaments, no generic geometric decoration template`。
8.  如果人像肤色被漂白，强调：`preserve the source skin-tone family and facial-plane contrast; paper white must not replace skin tones`。
-->
