# 待办

## 平台预览

**需求**：看封面在各平台信息流里的真实样子：手机上的实际显示宽度、平台盖在封面上的时长和播放量角标、卡片下面的标题和频道名、周围别的封面，判断字够不够大、会不会被挡、能不能跳出来。

**方案（讨论稿，未定）**

1. `platforms.js` 里每个平台加卡片布局数据：列数、间距、圆角、标题行数、角标的位置和内容（时长、播放量）。只模仿几何布局，用中性样式，不照搬平台的 logo 和界面细节。
2. 新模块 `preview.js` 用 DOM 搭一个预览视图：手机宽 390，每个平台一栏，按 `feed` 宽度乘屏幕倍数渲染该比例的封面，叠上 `zones` 角标，卡片下面是去掉星号的标题、频道名和虚拟数据；可切深色、浅色、放大；每张卡片标出封面标准检查的结果（字小、被角标挡）。
3. 周围的卡片：先用这个档案其他频道的封面或灰色占位，以后可以拖入竞品截图。
4. 先实测：`feed` 和 `zones` 现在是估计值，要用各平台信息流的手机截图量出真实的显示宽度和角标位置；量准后，现有的字号和遮挡检查也会更准。
5. 待定：先做哪几个平台；只做手机，还是也做 B站、YouTube 的电脑网页版。

## MCP server：让 agent 操作 SmedCover

**需求**：agent 能做封面。两种用法：自己部署的服务器上，由那里的 agent 出图（`smedcover mcp`，stdio；或服务端的 `/mcp`）；桌面上开着 SmedCover，你和 agent 对话、它在界面上一步步改（应用在 127.0.0.1 上开 MCP，带令牌）。两种用同一套工具定义，执行都在网页里的命令层。

**原则**：工具做"一件完整的事"，不开放底层文件读写；改动都过 `normalizeCover` 校验；桌面上每一步是一步可撤销的历史；能返回图片的就返回图片（MCP 的 image content），结构化结果带 outputSchema。

**工具（讨论稿，未定）**

1. 看（只读）
   - `get_context`：档案列表，每个档案的频道（名称、颜色）和尺寸；当前档案和频道；能力（能否抠图、有没有配 AI、轮廓字效可不可用，即 `CAN`）。
   - `get_cover(channel)`：标题、副标题、角标，图层列表（id、类型、位置、字效、能不能删）。
   - `list_options`：合法取值。风格 `LOOK_IDS`；字效 `EFFECTS`（标出哪些要字形轮廓）；变形 `BENDS`；平台 `PLATFORMS`；尺寸预设 `SIZE_PRESETS`；可用字体；重绘风格。
   - `list_library`：位图库（上传、AI 生成、重绘）和素材。
   - `render_preview(channel, size?)`：返回 PNG；可选一次出所有尺寸的拼图。
   - `check_cover(channel)`：`checkCover` 的结果，每条带等级（红/黄）、图层、实际值和要求值、涉及的平台。A1 标题在信息流里的字号；A2 标题太长；B1 对比度；C1 主体图太小；D1 被平台角标挡住；E1 平台要的比例没有尺寸。
2. 改
   - `set_text(channel, title?, subtitle?, tag?)`：`*强调*` 和换行照编辑器的写法。
   - `set_style(profile, look?, …)`、`set_channel(channel, color?, name?)`：风格是档案共用的，颜色是频道的。
   - `update_layer(channel, layer, props)`：位置、缩放、旋转、字效、字体、变形、显示隐藏、透明度。
   - `add_layer` / `remove_layer` / `move_layer`：文字、素材、照片、立体物件、版式图层的副本；版式自带的图层只能隐藏，底图和边框不能复制（`isRemovable`、`COPYABLE`）。
   - `add_photo(channel, source)`：服务器上的路径、URL 或位图库里的图，放法同 `placePhoto`。
   - `crop_photo(channel, layer, crop | shape)`。
   - `cut_out(channel, layer)`：桌面用 Vision，服务器用 ONNX。
   - `weave(channel, layer, by: "head" | "letters" | "brush", line?, front?, strokes?)`：笔迹按照片比例给（同 `normalizeWeave`）。
   - `surprise(channel, count?, locks?)`：抽 6 手，每手返回预览；`pick_hand(hand)` 把其中一手放到画布上。
   - `apply_cover_json(channel, cover)`：兜底，提交整张封面，返回被修正或丢掉的部分。
3. AI 生成（要配好 key，花钱）
   - `generate_image(prompt, reference?)`：文生图，进位图库（`generatePrompt`）。
   - `repaint_photo(channel, layer, style?, notes?)`：重绘（openai / gemini / seedream），返回前后对比，采用或放弃。
   - `make_sticker(prompt, kind: "flat" | "solid")`：贴纸或立体物件，进素材（`ai.js` 的 `buildPrompt`）。
4. 批量和输出
   - `batch_covers(jobs | csv)`：格式同 CSV 导入（`csvToJobs`：频道、标题、角标、副标题）。
   - `export(channels, sizes?)`：导出 PNG，返回路径；服务器上另给下载链接。
5. 只在桌面实时模式里有：`get_selection` / `select_layer`、`undo` / `redo`。"AI 正在操作"的提示和排队由外壳做，不是工具。
6. resources：`smedcover://profiles`、`smedcover://cover/{profile}/{channel}`、`smedcover://options`、`smedcover://rules`（规则说明、各平台的遮挡区域）。prompts：`make_cover`（建封面 → 抽几手 → 检查 → 修 → 导出）、`covers_from_csv`。

**不开放**：`app_read` / `app_write` 等文件命令、`reveal_data_dir`、`pick_folder`、`move_pointer`、自检命令、字体文件数据、`ai_request` / `fetch_image` 的原始转发。agent 操作的是封面，不是文件。

**分级**（工具注解 `readOnlyHint`、`destructiveHint`）：只读（第 1 组）；修改（第 2 组，可撤销）；有外部影响（AI 生成花钱、`export` 写文件、`remove_layer` 删除），客户端据此决定要不要先问。

**待定**：`update_layer` 用一个通用补丁，还是拆成移动、字效、字体等小工具（倾向拆：schema 清楚，模型不容易填错）；第一版先做 1、2、4（不花钱，"改 → 看 → 检查 → 导出"能闭环），AI 生成放第二版。
