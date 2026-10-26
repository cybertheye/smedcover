# 待办

## 平台预览

**需求**：看封面在各平台信息流里的真实样子：手机上的实际显示宽度、平台盖在封面上的时长和播放量角标、卡片下面的标题和频道名、周围别的封面，判断字够不够大、会不会被挡、能不能跳出来。

**方案（讨论稿，未定）**

1. `platforms.js` 里每个平台加卡片布局数据：列数、间距、圆角、标题行数、角标的位置和内容（时长、播放量）。只模仿几何布局，用中性样式，不照搬平台的 logo 和界面细节。
2. 新模块 `preview.js` 用 DOM 搭一个预览视图：手机宽 390，每个平台一栏，按 `feed` 宽度乘屏幕倍数渲染该比例的封面，叠上 `zones` 角标，卡片下面是去掉星号的标题、频道名和虚拟数据；可切深色、浅色、放大；每张卡片标出封面标准检查的结果（字小、被角标挡）。
3. 周围的卡片：先用这个档案其他频道的封面或灰色占位，以后可以拖入竞品截图。
4. 先实测：`feed` 和 `zones` 现在是估计值，要用各平台信息流的手机截图量出真实的显示宽度和角标位置；量准后，现有的字号和遮挡检查也会更准。
5. 待定：先做哪几个平台；只做手机，还是也做 B站、YouTube 的电脑网页版。

## 让 agent 和命令行操作 SmedCover（MCP、CLI、服务器）

**场景**

1. 电脑上用图形界面编辑（已有）。
2. 终端里用命令行生成封面。
3. 电脑上的通用 agent 操作开着的 App，你看着它一步步改。
4. 服务器上没有界面：手机通过 Slack 等和同一台机器上的 agent 聊天，agent 加载的 skill 里写着 SmedCover 的 MCP 地址，由它出图。

**分工**

- 封面引擎只有一份：网页里的 `ui/js`。新加命令层 `ui/js/commands.js`：工具就是函数，改动都过 `normalizeCover` 校验，每一步一条撤销；工具定义（名字、说明、参数、分级）导出成 `ui/tools.json`。
- 干活的宿主两个：桌面 App；服务器程序 `smedcover serve`（无头 Chromium 打开同一份 `ui/`，`HOST === "server"`）。
- MCP 是宿主的 HTTP 入口，不是单独的程序：列出工具，把调用交给页面的命令层，把结果（JSON、PNG）换回 MCP 的格式。桌面：`http://127.0.0.1:25277/mcp`，设置里开关，默认不要令牌（和 Figma 一样），可以打开"要求令牌"；服务器：`/mcp`，一定要令牌。
- CLI：`smedcover` 的子命令，底下调 MCP 工具，自己不画；和 `serve` 是同一个可执行文件。
- stdio 桥（`smedcover mcp`）：只给只会 stdio 的客户端，以后再做。
- 代码都在这个仓库：`core/`（Rust 核心，从 `src-tauri/src/lib.rs` 拆出，App 和服务器共用）、`cli/`（`smedcover`）、`skill/`（skill 模板）。

**已定**

- 先做场景 3，再做 2、4。
- `update_layer` 拆成几个小工具（位置缩放旋转、字效、字体、变形、显示和透明度）。
- 排队：agent 的一步没做完时，你的操作等着；你正在拖动、输入或开着对话框时，agent 的调用等着。
- 桌面 MCP 默认端口 25277（可以改）。
- 桌面 MCP 默认不要令牌（和 Figma 一样）：只听 127.0.0.1，网页靠 Host 和 Origin 检查挡住；本机其他程序（包括别的账户、容器、虚拟机、沙盒 App）能连上，能让它按路径读图片和工程文件，这一点在设置页的提示里写明，电脑有别人用或跑着不信任的容器时请打开开关。App 页面自己发的请求带记号，接口拒收。设置里留"要求令牌"开关，默认关；打开后和原来一样，接入命令带令牌，Codex 从环境变量 `SMEDCOVER_TOKEN` 读。服务器版（`smedcover serve`）一定要令牌。
- 服务器上的字体：先用应用自带的免费字体（Noto Sans SC、Bebas Neue、JetBrains Mono），另给一个方便装字体的办法（`smedcover fonts add <文件>`，或 MCP 工具）。
- `check_cover` 第一版不做，`checkCover()` 的代码留着。
- 命令行要用 App 而 App 没开时：在后台起一个不显示窗口的 App（要先实测 Mac 上能不能画完）；不行就在运行期间弹出窗口，跑完关掉。

**任务**

0. 收尾：删 0.3.0 的草稿 release；清理旧分支和 worktree（已备份在 `.git/archive/branches-2026-10-25.bundle`）；提交 `PROGRESS.md`。
1. 地基：
   - 重构 `app.js`，把"做事"和"问用户"拆开（批量出图、打开工程文件、导出、加照片）。不改行为，用现有测试和自检验证。
   - 命令层和 `tools.json`：看、改、批量和导出三组。
   - 拆出 `core/`，App 改成依赖它。
2. 场景 3（桌面 MCP）：App 里开 HTTP MCP；设置里开关，显示地址和连着的客户端，给一行可复制的接入命令；"要求令牌"开关（默认关）；页面接收调用；排队和"agent 正在操作"的提示；选中、撤销、重做工具。
3. 场景 2（CLI）：`batch`、`render`、`export`、`profiles`、`import`；App 没开时怎么启动；装进 PATH；打进安装包，CI 各平台构建。
4. 场景 4（服务器）：`smedcover serve`（`/invoke`、`/mcp`、令牌，只听 127.0.0.1，systemd）；无头 Chromium；字体和装字体；`open_project` 导入档案；`export` 返回文件路径；`add_photo` 收本机路径；skill 模板。
5. 以后：AI 生成类工具（花钱）；stdio 桥；手机布局、给人用的服务器网页、多用户登录。

**原则**：工具做"一件完整的事"，不开放底层文件读写；改动都过 `normalizeCover` 校验；桌面上每一步是一步可撤销的历史；能返回图片的就返回图片（MCP 的 image content），结构化结果带 outputSchema。

**工具（第一版，细节在实现时定）**

1. 看（只读）
   - `get_context`：档案列表，每个档案的频道（名称、颜色）和尺寸；当前档案和频道；能力（能否抠图、有没有配 AI、轮廓字效可不可用，即 `CAN`）。
   - `get_cover(channel)`：标题、副标题、角标，图层列表（id、类型、位置、字效、能不能删）。
   - `list_options`：合法取值。风格 `LOOK_IDS`；字效 `EFFECTS`（标出哪些要字形轮廓）；变形 `BENDS`；平台 `PLATFORMS`；尺寸预设 `SIZE_PRESETS`；可用字体。
   - `list_library`：位图库（上传、AI 生成、重绘）和素材。
   - `render_preview(channel, size?)`：返回 PNG；可选一次出所有尺寸的拼图。
2. 改
   - `set_text(channel, title?, subtitle?, tag?)`：`*强调*` 和换行照编辑器的写法。
   - `set_look(profile, look, params?)`、`set_channel(channel, color?, name?)`：风格是档案共用的，颜色是频道的。
   - 图层的小工具：`place_layer`（位置、缩放、旋转）、`set_layer_effect`（字效）、`set_layer_font`、`set_layer_bend`（变形）、`show_layer`（显示隐藏、透明度）。
   - `add_layer` / `remove_layer` / `reorder_layer`：文字、素材、照片、立体物件、版式图层的副本；版式自带的图层只能隐藏，底图和边框不能复制（`isRemovable`、`COPYABLE`）。
   - `add_photo(channel, source)`：本机路径、URL 或位图库里的图，放法同 `placePhoto`。
   - `crop_photo(channel, layer, crop | shape)`。
   - `cut_out(channel, layer)`：桌面用 Vision，Windows/Linux 和服务器用 ONNX。
   - `weave(channel, layer, by: "head" | "letters" | "brush", line?, front?, strokes?)`：笔迹按照片比例给（同 `normalizeWeave`）。
   - `surprise(channel, count?, locks?)`：抽 6 手，每手返回预览；`pick_hand(hand)` 把其中一手放到画布上。
   - `apply_cover_json(channel, cover)`：兜底，提交整张封面，返回被修正或丢掉的部分。
   - `open_project(file)`：打开工程文件（`.smedcover.json`，带档案、照片、素材和导入的字体），用来把电脑上做好的档案搬到服务器。
3. 批量和输出
   - `batch_covers(jobs | csv)`：格式同 CSV 导入（`csvToJobs`：频道、标题、角标、副标题）。
   - `export(channels, sizes?, dir?)`：导出 PNG，返回文件路径；服务器上另给下载链接。
4. 只在桌面实时模式里有：`get_selection` / `select_layer`、`undo` / `redo`。"agent 正在操作"的提示和排队由外壳做，不是工具。
5. 第二版：AI 生成（要配好 key，花钱）：`generate_image`、`repaint_photo`、`make_sticker`。
6. resources 和 prompts（`make_cover`：建封面 → 抽几手 → 看预览 → 修 → 导出）以后再加；skill 模板先写这套流程。

**不开放**：`app_read` / `app_write` 等文件命令、`reveal_data_dir`、`pick_folder`、`move_pointer`、自检命令、字体文件数据、`ai_request` / `fetch_image` 的原始转发。agent 操作的是封面，不是文件。

**分级**（工具注解 `readOnlyHint`、`destructiveHint`）：只读（第 1 组）；修改（第 2 组，可撤销）；有外部影响（AI 生成花钱、`export` 写文件、`remove_layer` 删除），客户端据此决定要不要先问。
