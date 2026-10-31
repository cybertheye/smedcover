# 在终端里用 SmedCover（`smedcover`）

[English](README_CLI.md) · 中文

`smedcover` 是 SmedCover 的命令行，让你在终端或脚本里出封面：把一个频道的封面写进一个文件，把每个频道的每个尺寸导出到一个文件夹，按
CSV 每行做一张封面，或者做 agent 能做的任何一次调用。这一页讲怎么安装、每个命令和参数、它输出什么、退出码、它和 App 之间一次运行怎么进行、
怎么写脚本，以及出问题时怎么办。应用的其他部分见 [README.zh-CN.md](README.zh-CN.md)，agent 接入（MCP）见
[README_MCP.zh-CN.md](README_MCP.zh-CN.md)，实现原理见 [ARCHITECTURE.zh-CN.md](ARCHITECTURE.zh-CN.md)（10.7 到 10.9）。

- [这是什么](#这是什么)
- [安装](#安装)
- [第一次运行](#第一次运行)
- [命令](#命令)
- [每个命令都接受的参数](#每个命令都接受的参数)
- [输出什么](#输出什么)
- [退出码和错误种类](#退出码和错误种类)
- [一次运行怎么进行](#一次运行怎么进行)
- [写脚本](#写脚本)
- [排查问题](#排查问题)

## 这是什么

- 它自己不画。每个命令就是 agent 用的那些工具（见[工具](README_MCP.zh-CN.md#工具)）的一两次调用，活由 SmedCover 来干，所以命令行出的封面
  就是窗口导出的那张。
- SmedCover 开着时，命令就在那个窗口里做：每一步你都看得到，和看 agent 做一样；每处改动都是窗口里的一步撤销。
- 没开时，命令会为这一次启动它：macOS 上不显示窗口（程序坞里也没有图标），Windows 和 Linux 上窗口会显示出来，但不抢焦点。最后一个用它的命令
  结束约 2 秒后，它先把该存的存好再退出，所以脚本里接连运行的命令共用一个 App。这期间你打开了它的窗口，它就归你了，不会退出。
- 不用打开「MCP 接口」开关，也不用它的令牌。每个 SmedCover 都在 127.0.0.1 上另开一个端口给命令行用，带自己的令牌，写在数据文件夹的
  `cli.json` 里（macOS 和 Linux 上只有你能读）。「设置 → Agent 接入」不统计命令行的调用。什么都不会离开这台电脑。
- 命令和 App 是同一个版本（`smedcover --version`）；命令大约 1.6 MB，不用另装别的东西。

## 安装

### 在哪里

每个安装包都把它装在 App 旁边：

| 系统 | 命令 |
|---|---|
| macOS | `SmedCover.app/Contents/MacOS/smedcover` |
| Windows | SmedCover 安装目录里的 `smedcover.exe` |
| Linux | `.deb` 和 `.rpm` 装到 `/usr/bin/smedcover` |

### 加进 PATH

要在终端里直接用 `smedcover`：打开「设置 → Agent 接入 → 命令行工具」，点「安装」。

- **macOS**：在 `/usr/local/bin/smedcover` 放一个指向 App 里那个命令的链接。系统会要管理员密码，除非你自己就能写 `/usr/local/bin`（Intel
  Mac 上装过 Homebrew 时就是这样）。这个名字已经指向另一份 SmedCover（旧版本，或者你挪过位置的 App）时，卡片会说出来，「改为指向这个 App」
  就改过来；如果是别的不属于 SmedCover 的东西，卡片也会说，但不会动它。「卸载」只删 SmedCover 的链接。App 挪了位置，要再装一次。直接从磁盘
  映像里、或者在下载的位置打开（系统这时会把它放到一个临时位置运行）时不安装：请先把 SmedCover 移到「应用程序」文件夹，从那里打开，再安装。
- **Windows**：把 `smedcover.exe` 复制到一个单独的文件夹 `%LOCALAPPDATA%\com.cyven.smedcover\bin`（旁边一个小文件 `app-path` 写着 App
  在哪里，命令靠它启动 App），再把这个文件夹加进你自己的 PATH（只对你这个账户，不改系统的）。之后新开的终端里就有 `smedcover`，已经开着的
  没有。PATH 里只有这个命令，没有 App 的其他程序。更新以后 SmedCover 启动时会重新复制一份。「卸载」把这个文件夹从 PATH 里拿掉并删除；卸载
  SmedCover 时（`.exe` 安装包）这个文件夹也会删掉（PATH 里留下的那一项指向不存在的文件夹，不影响什么）。
- **Linux**：`.deb` 和 `.rpm` 已经装进 PATH 了，不用再做什么。AppImage 里的命令在终端里用不了，要用请装安装包。

### 从源码构建

```bash
cargo build --release -p smedcover-cli      # target/release/smedcover
```

开发版的命令行是 `target/debug/smedcover`（`cargo build -p smedcover-cli`，或者直接 `cargo build`），旁边是 `npm run tauri dev` 生成的
App `target/debug/smedcover-app`；设置里的卡片会说它在哪里，不安装。`tauri build` 会自己把命令放进每个安装包（见[从源码运行和打包](README.zh-CN.md#从源码运行和打包)）。

### 会启动哪个 App

数据文件夹上没有 SmedCover 在运行时，命令按下面的顺序，用第一个给出的 App：

1. 环境变量 `SMEDCOVER_APP`，设了的话；
2. 命令旁边的 `app-path` 文件（Windows 上 PATH 里那份命令旁边就有）；
3. 命令旁边的 `smedcover-app`（命令是链接时顺着链接找：`/usr/local/bin/smedcover` 找到的是它指向的那个 App 里的）；
4. macOS 上，旁边没有时，`/Applications/SmedCover.app`。

`SMEDCOVER_APP` 或 `app-path` 写的文件不存在时，不会跳到下一个：命令说「在 … 找不到 SmedCover App。」（退出码 3）。

### 确认装好了

```bash
smedcover --version        # smedcover 0.5.0
smedcover profiles         # SmedCover 没开就先启动它，然后列出你的档案
```

SmedCover 得先设置过一次：命令启动的窗口里从不显示首次启动的欢迎页，所以还没走完欢迎页的 SmedCover 会让命令以退出码 3 结束，说「请先打开
SmedCover，完成首次设置，然后再试。」

## 第一次运行

```console
$ smedcover profiles
我的品牌  (id p1)  ← 当前
  风格：cinema，深色 · 导出文件夹：/Users/me/Covers
  频道：
    1. VLOG  （id c1，代号 V，#ff3366）  ← 当前
    2. 教程  （id c2，代号 T，#33aaff）
  尺寸（✓ 导出窗口里打开的）：
    1920x1080  YouTube 16:9  ✓  ← 当前
    1080x1920  Shorts  ✓
    1080x1080  Square

$ smedcover render VLOG --size 16:9 -o cover.png
/Users/me/cover.png

$ smedcover export --channels all --sizes all --out covers
Writing 01-VLOG_雨夜东京漫步_1080x1920.png (2 of 6).        ← 进度，原地刷新的一行
/Users/me/covers/01-VLOG_雨夜东京漫步_1920x1080.png
/Users/me/covers/01-VLOG_雨夜东京漫步_1080x1920.png
…
已写入 6 个文件：/Users/me/covers
```

频道可以用 id、名称、代号或从 1 开始的序号来指（上面的 `VLOG`、`c1`、`V` 和 `1` 是同一个频道）；尺寸可以用像素（`1920x1080`）、比例
（`16:9`）或名字。标着「当前」的档案是窗口里正显示的，命令不用 `--profile` 指定别的时，就在它上面做。

## 命令

| 命令 | 做什么 | 调用的工具 | 改不改封面 |
|---|---|---|---|
| [`profiles`](#profiles) | 列出档案，以及各自的频道和尺寸 | `get_context` | 不改 |
| [`render`](#render) | 把一个频道的封面按一个尺寸写进一个文件 | `export`（和 `get_context`） | 不改 |
| [`export`](#export) | 把封面导出到一个文件夹 | `export` | 不改 |
| [`batch`](#batch) | 按 CSV 每行做一张封面并导出 | `batch_covers` | 不改 |
| [`import`](#import) | 在 App 里打开一个工程文件 | `open_project` | 改 |
| [`tools`](#tools) | 列出工具 | `tools/list` | 不改 |
| [`call`](#call) | 用 JSON 参数调用任意工具 | 任意 | 看工具 |

每个命令的参数都在连 SmedCover 之前查过：命令写得不对（未知的参数、超出范围的值、不存在的文件），退出码是 2，什么都不启动。
`smedcover <命令> --help` 列出一个命令的参数。

`render`、`export` 和 `batch` 还接受：

| 参数 | 做什么 |
|---|---|
| `--profile 档案` | 档案，按 id 或名字（不给就是当前档案）。指定的不是当前档案时，窗口会切过去，和 agent 的调用一样，之后就停在那里。 |
| `--format 格式` | `png`、`jpg` 或 `jpeg`、`webp`（不给就按导出设置；JPEG 用导出设置里的质量） |
| `--scale 倍数` | 清晰度，尺寸像素的 1 到 4 倍（不给就按导出设置） |

### `profiles`

```bash
smedcover profiles
```

列出每个档案：它的风格、导出文件夹、频道（序号、名称、id、代号和颜色）和尺寸（每个尺寸写它的 key，就是 `--size-key` 接受的写法，导出窗口里
打开的带 ✓）。窗口里当前的档案、频道和尺寸标着 `← 当前`。`--json` 输出 `get_context` 的完整回答，另外还有导出设置、还能不能撤销，以及这个
SmedCover 能做什么（抠图、AI 配好没有）。

### `render`

```bash
smedcover render 频道 -o 文件 [--size 尺寸 | --size-key KEY] [--profile 档案] [--format 格式] [--scale 倍数]
```

把一个频道的封面按一个尺寸写进 `文件`，同名文件会被替换，然后输出它的路径。

| 参数 | 做什么 |
|---|---|
| `频道` | 频道：id、名称、代号或从 1 开始的序号 |
| `-o`、`--output 文件` | 要写的文件。它所在的文件夹必须已经存在。 |
| `--size 尺寸` | 尺寸：像素（`1920x1080`）、比例（`16:9`）或名字 |
| `--size-key KEY` | 按 key 指尺寸，写法和 `smedcover profiles` 列出的一样 |

- 不给尺寸时：档案是当前档案，就用画布上的尺寸；否则用这个档案在导出窗口里打开的第一个尺寸，再没有就用它的第一个尺寸。这样会多一次调用（先
  `get_context`，再 `export`）。
- 格式：给了 `--format` 用它，否则看文件的扩展名（`.png`、`.jpg`、`.jpeg`、`.webp`），再否则按导出设置。`--format` 和扩展名对不上
  （`--format png -o cover.jpg`）会被拒绝。
- 导出先写进文件旁边一个它自己的隐藏文件夹（`.smedcover-render-…`），再把封面从那里移到 `文件`；做完这个文件夹会删掉，第二次 Ctrl-C 时也会。
  所以 `文件` 所在的文件夹得是你能写的（否则退出码 2，「写不进 …」，这是连上 SmedCover 之后才查出来的）。

### `export`

```bash
smedcover export [--channels 列表] [--sizes 列表] [--out 目录] [--profile 档案] [--format 格式] [--scale 倍数]
```

和「导出」一样把封面导出到一个文件夹，每个文件的路径输出一行；之后在标准错误上说「已写入 n 个文件：目录」。

| 参数 | 做什么 |
|---|---|
| `--channels 列表` | 频道，按 id、名称、代号或序号，逗号隔开（最多 200 个），或者 `all`（不给就是当前频道） |
| `--sizes 列表` | 尺寸，按像素、比例或名字，逗号隔开（最多 80 个），或者 `all`（不给就是导出窗口里打开的） |
| `--out 目录` | 文件夹，不存在会新建（不给就是档案的导出文件夹） |

- 从不覆盖文件：重名的加编号。文件名按导出的文件名规则来（见[导出](README.zh-CN.md#导出)）。
- 档案还没有导出文件夹时，要给 `--out`。`--out` 指定的文件夹不会记到档案上。
- 导出不改封面。在窗口里不等了（调用进行时出现的小条上的「不等了」，20 秒后出现，或者按 Esc）时，命令以失败结束（退出码 1，种类
  `failed`）；到那时已经写好的文件留在文件夹里，但不会列出来。

### `batch`

```bash
smedcover batch 文件.csv [--sizes 列表] [--out 目录] [--profile 档案] [--format 格式] [--scale 倍数]
smedcover batch - < 文件.csv
```

按 CSV 每行做一张封面并导出，和[批量出图](README.zh-CN.md#批量出图)一样；输出的文件和 `export` 一样。

```csv
channel,title,tag,subtitle
VLOG,"雨夜*东京*漫步",EP.12,从涩谷走到新宿
教程,"第一行\n第二行",,
```

- 列依次是频道、标题、角标、副标题；表头行可有可无。频道可以写名称、代号或序号（`1` 或 `01`），不能写 id；没写频道的行用当前频道。有一行写了
  档案里没有的频道时，整批一个文件都不写（退出码 1），消息里会列出这个档案的频道。
- 和编辑器里一样，用 `*星号*` 标出强调的字，标题里用 `\n` 换行。
- 每张封面从它那个频道的封面出发，换上这一行的文字；窗口里的封面不会被改。
- `--sizes` 不给就是档案的每个尺寸（不只是导出窗口里打开的）；`--out` 和 `export` 的一样。
- `-` 从标准输入读 CSV。文字必须是 UTF-8（带 BOM 也行：Excel 的「CSV UTF-8」就是这样），最多 1,000,000 个字符：更长的请拆开。

### `import`

```bash
smedcover import 文件.smedcover.json [--as new|current]
```

打开一个工程文件（见[工程文件](README.zh-CN.md#工程文件)），进它自己的档案，窗口也切过去。这台电脑上没有它的档案时，`--as new`（默认）把它
导入成一个新档案，`--as current` 放进当前档案。输出它打开到哪个档案和频道（「新建的」或「原有的」），以及提醒（比如找不到某个字体）。在窗口里
撤销，就回到它替换掉的那张封面。

### `tools`

```bash
smedcover tools            # 每个工具的名字和用途，一行一个
smedcover tools --json     # 每个工具连同 inputSchema、outputSchema 和 annotations
```

### `call`

```bash
smedcover call 工具 [JSON] [--save-images 目录]
```

用一个 JSON 对象作参数调用任意工具（不给就是 `{}`；`-`：从标准输入读），输出它的回答：回答里的文字照印，JSON 分行排好。回答里的图片
（`render_preview`、`surprise`）用 `--save-images 目录` 保存（目录不存在会新建），文件名是 `工具-1.png`、`工具-2.png`……，从不覆盖文件；不给
时只描述一下（`［图片 1：image/png，812.4 KB；用 --save-images 目录 保存］`）。SmedCover 没有的工具，退出码 2。

```bash
smedcover call get_cover '{"channel": "VLOG"}'
smedcover call set_text '{"title": "雨夜*东京*漫步", "tag": "EP.12"}'
smedcover call set_look '{"look": "cinema", "theme": "dark"}'
smedcover call render_preview '{"size": "16:9"}' --save-images previews
smedcover call surprise '{"count": 4}' --save-images hands
smedcover call pick_hand '{"hand": 2}'
smedcover call undo
```

每个工具和它的参数见[工具](README_MCP.zh-CN.md#工具)，或者 `smedcover tools --json`。改封面的调用和 agent 的一样，是窗口里的一步撤销。

## 每个命令都接受的参数

放在命令前后都行（`smedcover --json profiles`、`smedcover profiles --json`）。

| 参数 | 做什么 |
|---|---|
| `--json` | 把结果按一份 JSON 输出（见[下面](#--json)） |
| `-q`、`--quiet` | 不输出进度和提示；结果和错误照样输出 |
| `--timeout 秒数` | 每一次调用等这么久就放弃（见[超时](#超时)） |
| `--data 目录` | 用另一个数据文件夹，而不是 App 自己的；为命令启动的 App 也用它 |
| `-V`、`--version` | 输出版本 |
| `-h`、`--help` | 输出帮助（`smedcover <命令> --help`：一个命令的） |

| 环境变量 | 做什么 |
|---|---|
| `SMEDCOVER_DATA` | 数据文件夹，同 `--data`（两个都给时 `--data` 为准） |
| `SMEDCOVER_APP` | 没有 App 在运行时启动哪个（见[会启动哪个 App](#会启动哪个-app)） |
| `SMEDCOVER_SELFTEST` | 自检目录（开发用）：它的 `data/` 就是数据文件夹，优先于 `--data` |
| `LC_ALL`、`LC_MESSAGES`、`LANG` | SmedCover 和系统都没给出语言时，按它们定语言（见[下面](#文字)） |

路径可以用 `~` 开头，相对路径按命令运行时所在的文件夹算：交给 SmedCover 的是完整路径。

## 输出什么

### 文字

- 结果写到标准输出：`render`、`export`、`batch` 一行一个路径，其他命令简短直白。文件名里有标题，空格也在里面（默认的规则是
  `{n}-{channel}_{title}_{size}`）：要整行读（`while IFS= read -r file`），或者从 `--json` 里取路径。
- 进度（*Writing …（3 of 12）*）写到标准错误：在终端里是原地刷新的一行，标准错误是文件或管道时，每变一次写一行。提示（「正在启动
  SmedCover…」「已写入 6 个文件：…」、和 App 版本不一致）和错误（`smedcover: <原因>`）也写到那里。`--quiet` 不输出进度和提示，错误照样输出。
- 命令说的语言跟 SmedCover 里设的一样，没设就跟系统：中文或英文。SmedCover 回答的话（工具的错误、进度）照它自己的原话。`--help` 是英文的。

### `--json`

不管发生什么，标准输出上都只有一份 JSON，供程序读：

| 命令 | `--json` 输出什么 |
|---|---|
| `profiles` | `get_context` 的回答：`{"profiles": [{id, name, look, theme, channels, sizes, exportDir}], "current": {profile, channel, size, …}, "export", "history", "can", "app"}` |
| `render` | `{"path", "channel", "size", "title"}` |
| `export`、`batch` | `{"dir", "files": [{"path", "channel", "title", "size"}]}`，被中途截断的还有 `"cancelled": true` |
| `import` | `{"profile": {"id", "name", "created"}, "channel", "warnings"}` |
| `tools` | 工具清单，每个是 `{"name", "description", "inputSchema", "outputSchema", "annotations", …}` |
| `call` | 工具的完整结果 `{"content": […], "structuredContent": …}`；保存了的图片，数据换成 `"saved": 路径` |

格式就是每个工具的 `outputSchema`（`smedcover tools --json`）。失败时输出

```json
{
  "error": {
    "kind": "busy",
    "message": "SmedCover is busy: …",
    "exit": 1
  }
}
```

SmedCover 回答导出被中途截断（`"cancelled": true`）时，输出它的结果（已经写好的文件），里面带着这个 `"error"`。唯一的例外：命令行根本读不懂（未知的参数、缺参数）时，只在标准错误上
输出用法提示，退出码 2。

## 退出码和错误种类

| 退出码 | 意思 |
|---|---|
| 0 | 完成 |
| 1 | SmedCover 回答了一个错误：没有这个频道、窗口正忙、导出失败或中途停下…… |
| 2 | 命令写得不对：未知的命令或参数、不接受的值、不存在的文件——这些在连 SmedCover 之前就查出来了，什么都没启动（不过 `--out` 指定的文件夹会先建好）；或者 SmedCover 没有这个工具（`call`） |
| 3 | 连不上或启动不了 SmedCover，或者它还要先设置：打开它一次，走完欢迎页 |
| 4 | 没有及时回答：`--timeout`，或者 SmedCover 自己为这个工具等的时间到了；这次调用已取消 |
| 130 | 被中断（Ctrl-C） |

`--json` 的 `error.kind` 说是哪一种，脚本要判断时看它，别看消息：

| 种类 | 退出码 | 意思 |
|---|---|---|
| `usage` | 2 | 命令写得不对 |
| `invalid_arguments` | 1 | SmedCover 不接受某个参数：没有这个频道、档案或尺寸 |
| `busy` | 1 | 你在窗口里手上有事（对话框、打字、拖动），一直没完，超过了调用肯等的时间 |
| `not_allowed`、`unavailable` | 1 | 这里不能做，或者现在做不了：没有可用的抠图引擎、这个 SmedCover 画不了的效果 |
| `failed`、`malformed`、`rpc` | 1 | 做失败了（消息里说原因）、你在窗口里点了「不等了」、窗口沉默超过了工具的时限，或者回答没法用 |
| `cancelled` | 1 | 导出被中途截断，结果里是已经写好的文件 |
| `too_many` | 1 | 手上已经有 16 个调用（agent 的也算） |
| `no_app`、`quit`、`no_data_folder` | 3 | 找不到要启动的 App，它没等就绪就退出了，或者这台电脑上没有它的数据文件夹 |
| `not_ready`、`unreachable`、`gone` | 3 | SmedCover 没有及时就绪、连不上，或者调用中途断开了 |
| `needs_setup` | 3 | SmedCover 停在首次启动的欢迎页 |
| `timeout` | 4 | 没有及时回答 |
| `interrupted` | 130 | Ctrl-C |

## 一次运行怎么进行

### SmedCover 开着时

命令找到在这个数据文件夹上运行的 App，在它的窗口里做：每处改动你都看着它发生，窗口会切到 `--profile` 指定的档案，`import` 和 `call` 的改动
可以撤销。你在窗口里手上有事时（对话框、打字、拖动、取色器），调用会等你：改的调用等 30 秒，读的调用等 10 秒，之后回答 `busy`（退出码 1）。
命令和 agent 可以同时用；它们的调用轮流来。

### SmedCover 没开时

命令启动它（「正在启动 SmedCover…」），最多等 30 秒让它就绪。做完后告诉 App，App 在最后一个用它的命令结束约 2 秒后退出，退出前把该存的
存好：接连运行的命令共用这一个 App，中间不用再启动。这期间把它的窗口叫出来（从访达、程序坞或开始菜单再打开 SmedCover，Windows 和 Linux 上
也可以点它的窗口），它就归你了：命令做完它也不退出，你的 agent 也能再连上它。在那之前连不上：命令启动的 App 不开 agent 的接口。

读命令输出的脚本（`$(smedcover …)`、`| jq`）只等命令本身，不会等它启动的 App。

### 超时

不给 `--timeout` 时，只要 SmedCover 还在做，就一直等：每次有进度后，等 SmedCover 自己为这个工具等的那么久（见
[超时、进度和取消](README_MCP.zh-CN.md#超时进度和取消)），再多 10 秒；总共不超过两小时。

| 命令 | 从上一次进度起等多久 |
|---|---|
| `profiles` | 30 秒 |
| `tools` | 30 秒，不管 `--timeout` 给多少 |
| `import` | 1 分钟 |
| `render`、`export`、`batch` | 30 分钟（导出每写一个文件报一次进度） |
| `call` | 看工具：读的 30 秒，改的 1 分钟，`render_preview` 和 `surprise` 2 分钟，`cut_out` 10 分钟，`export` 和 `batch_covers` 30 分钟 |

`--timeout 秒数` 是每次调用总共最多等多久（不给尺寸的 `render` 会调用两次）。超过就取消这次调用，退出码 4；已经改了的留着，是一步撤销。

### Ctrl-C

- 还没连上 SmedCover 时（命令在查参数、从标准输入读 CSV），按 Ctrl-C 马上结束。
- 连上之后，它取消正在进行的调用：导出在两个文件之间停下，已经改了的留着（一步撤销），为命令启动的 App 也放它走；然后命令以 130 结束。再按一次
  就马上结束。
- 为命令启动的 App 自己收不到终端的 Ctrl-C：它按上面说的方式退出。

### App 中途不在了

在会改动东西的调用发出之前连不上 SmedCover（比如它正好在退出），命令会再连一次它或新的 App。改动已经发出后就不会再试，SmedCover 正在做的
调用被切断时也不会：命令以失败结束（`unreachable` 或 `gone`，退出码 3），改动可能做了，也可能没做；继续之前先看看窗口，或者
`smedcover call get_cover`。

## 写脚本

```bash
# 每个频道的每个尺寸，路径存成一个列表
smedcover --json --quiet export --channels all --sizes all --out covers | jq -r '.files[].path' > covers.txt

# 每集一张封面，CSV 来自另一个程序
./episodes-to-csv | smedcover batch - --sizes 16:9,9:16 --out covers

# 先改文字，看一眼，再出文件
smedcover call set_text '{"channel": "VLOG", "title": "雨夜*东京*漫步", "tag": "EP.12"}'
smedcover call render_preview '{"channel": "VLOG", "size": "16:9"}' --save-images previews
smedcover render VLOG --size 16:9 -o ep12.png

# 窗口忙就再试；别的失败就停
for attempt in 1 2 3; do
  if result=$(smedcover --json --quiet render VLOG -o cover.png); then break; fi
  [ "$(jq -r '.error.kind' <<<"$result")" = busy ] || exit 1
  sleep 10
done
```

- `set -e` 和 `&&` 都照常起作用：每种失败都是非零的退出码。
- 要判断出了什么错，用 `--json` 看 `error.kind`，或者看退出码；别看消息，它跟着用户的语言变。
- 在 CI 里，或者在从没打开过 SmedCover 的机器上运行，命令会回答 `needs_setup`（退出码 3）：先设置一次，或者用 `--data` 指向一个从设置好的
  机器上复制来的数据文件夹。
- Windows 的 PowerShell 可能会吃掉 JSON 参数里的引号；改从标准输入给：

  ```powershell
  '{"title": "雨夜*东京*漫步"}' | smedcover call set_text -
  ```

## 排查问题

| 看到什么 | 原因和办法 |
|---|---|
| `smedcover: command not found` | 它不在 PATH 里：「设置 → Agent 接入 → 命令行工具」，点「安装」。Windows 上装好后要新开一个终端。Linux 上 AppImage 里的用不了：装 `.deb` 或 `.rpm`。 |
| 「在 … 找不到 SmedCover App。」 | 命令不在它的 App 旁边（挪过，或者复制到了别处）。从设置里再装一次，或者把 `SMEDCOVER_APP` 设成 App 的可执行文件（macOS 上是 `…/SmedCover.app/Contents/MacOS/smedcover-app`）。 |
| 「请先打开 SmedCover，完成首次设置，然后再试。」 | SmedCover 还没有档案。打开它，走完欢迎页。 |
| 「SmedCover 30 秒内没有就绪」 | 它启动了，但没有就绪。括号里有原因时，说的是 `cli.json` 为什么没被采用（别人也能读，或者不是你的：查一下数据文件夹的所有者）。想看 App 说了什么，就在数据文件夹（[在哪里](README.zh-CN.md#数据存在哪里)）里建一个 `logs` 文件夹：为命令启动的 App 会把输出写进那里的 `logs/cli-app.log`。 |
| 「SmedCover 没等就绪就退出了」 | 它启动不起来：从访达或开始菜单打开它看看原因，或者看 `logs/cli-app.log`（同上）。 |
| `SmedCover is busy: …`（退出码 1） | 你在窗口里手上有事（消息里说是哪件），一直没完，超过了调用肯等的时间。做完它，再运行一次命令。 |
| `SmedCover did not answer in time, so the call was given up; …`（退出码 4）、`… did not finish: nothing was heard from it for … s …`（退出码 1）、「SmedCover … 秒没有动静」（退出码 4） | 调用沉默的时间超过了工具的时限：SmedCover 自己的，或者命令的（再多 10 秒）。Windows 上窗口最小化会被放慢：让它留在屏幕上。已经改了的留着：继续之前先看看窗口。 |
| 「--timeout 的 … 秒内没有回答」（退出码 4） | 把 `--timeout` 调大，或者不给。 |
| 「--format png 和文件的扩展名对不上」 | `render` 按 `-o` 的扩展名定格式：去掉 `--format`，或者让两者一致。 |
| 「… 不是 UTF-8 文字」 | 把 CSV 另存为「CSV UTF-8」（Excel：另存为 → CSV UTF-8；Numbers：导出为 → CSV，Unicode UTF-8）。 |
| `No profile "…"; the profiles are: …`，或者（不给尺寸的 `render`）「没有档案「…」」 | `--profile` 要的是 id 或名字，照 `smedcover profiles` 列出的写。 |
| `The profile "…" has no export folder yet: pass dir …`（退出码 1） | 给 `--out`，或者在「导出」里给这个档案选一次文件夹。 |
| `The user stopped waiting for … after … s; the window is theirs again.`（退出码 1） | 有人在窗口里点了「不等了」（或者按了 Esc）。导出到那时写好的文件留在它的文件夹里。 |
| 「导出中途停下了。」（退出码 1） | SmedCover 把导出中途截断了。已经写好的文件会列出来。 |
| 「注意：运行中的 SmedCover 是 0.5.1，命令行是 0.5.0。」 | PATH 里的命令是另一份 SmedCover 的。macOS 上，在「设置 → Agent 接入 → 命令行工具」里点「改为指向这个 App」；Windows 上，更新后打开一次 SmedCover。 |
| 「SmedCover 没等回答就断开了」（退出码 3） | 调用中途 App 退出或被关掉了。改动可能做了，也可能没做：再运行之前先看看窗口。 |
| 「注意：SMEDCOVER_SELFTEST 指定了数据文件夹……」 | 这个终端里设了自检目录：`unset SMEDCOVER_SELFTEST` 之后 `--data` 才起作用。 |
