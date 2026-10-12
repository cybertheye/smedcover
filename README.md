# SmedCover

Branded cover images for video channels — a desktop app built with Tauri 2 and Rust.

Set up your brand once (name, categories, colours, graphics), then for every video just pick a
category and type the title. SmedCover renders the cover in every size you need at the same time.

> 中文说明见下方「中文」一节。

## Features

- **Two modes** — *Setup* for what you configure once (brand, categories, output sizes, export defaults, fonts) and *Edit* for what you do per video (cover, assets, style, layers).
- **Collage editing with layers** — every part of a cover is a layer: background, colour block, category graphic, brand row, title, tag, category name. Select and drag any of them; corner handles resize, side handles stretch, the top knob rotates; hide, lock, re-order and set opacity; add stickers, your own images and extra text on top. New items go in directly above the selected layer.
- **One collage, every size** — a layer's placement is stored relative to the canvas, so it maps to every output size at once. Switch to "This size only" to fine-tune a single size.
- **Asset library** — twenty cel-shaded category graphics that follow the category colour, a free pack of 50 stickers (badges, bubbles, arrows, marks, symbols, word stickers, everyday objects), eleven shapes for the colour block and its dividing edge, and your own uploads (PNG / SVG / JPG / WebP).
- **Profiles** — brand name, any number of categories with a colour and a graphic, plus a default design. Keep several, import and export them as JSON (uploaded assets travel with the file).
- **Three templates** — *Stack*, *Split*, *Banner*; dark or light. Any pixel size: presets for common platforms or custom width × height.
- **Title as the hero** — one typed line is one line on the cover; the size is fitted automatically. Wrap words in `*asterisks*` to colour them.
- **Background photo** with gaussian blur and dimming; hide the background layer to export with transparency.
- **Export** — PNG, JPEG or WebP at 1×–4×, one file or every size into a folder, file-name pattern, and CSV batch export.
- **Projects, undo/redo, keyboard shortcuts, English and Chinese UI.**

Fonts are bundled (Noto Sans SC, Bebas Neue, JetBrains Mono — SIL Open Font License), so covers look
the same on macOS, Windows and Linux. You can also pick any installed font or import a font file.

## Run it

Requires Rust, Node.js and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install        # installs the Tauri CLI only
npm run dev        # development window
npm run build      # installers in src-tauri/target/release/bundle/
npm test           # front-end unit tests
cd src-tauri && cargo test   # Rust unit tests
```

End-to-end check of the web view / Rust bridge — the built app exports a few covers in every format
into a folder, writes `report.json` there and quits (it does not touch your real app data):

```bash
SMEDCOVER_SELFTEST=/absolute/empty/folder src-tauri/target/release/bundle/macos/SmedCover.app/Contents/MacOS/smedcover
```

`.github/workflows/build.yml` builds installers for macOS, Windows and Linux on GitHub Actions.

## How it is put together

```
ui/                    static front end — plain ES modules, no bundler
  index.html           markup and styles
  js/app.js            UI: modes, tabs, canvas interaction, layer panel, export, undo
  js/render.js         drawCover(): walks the layer stack and paints one cover
  js/layers.js         layer model: placement across sizes, ordering (pure)
  js/layout.js         geometry for any aspect ratio and template (pure)
  js/assets.js         asset library: graphics, stickers, uploads
  js/stickers.js       the 50 built-in stickers, drawn in code
  js/cel.js            cel-shading kit and the first five category graphics
  js/graphics.js       fifteen more category graphics
  js/title.js          title parsing and fitting
  js/photo.js          background photo and cached gaussian blur
  js/store.js          data model, validation, persistence
  js/presets.js        starter profiles and size presets
  js/csv.js            CSV reader for batch export
  js/i18n.js           interface strings (zh / en)
  fonts/               bundled fonts and their licences
src-tauri/src/lib.rs   Rust side: sandboxed app-data store, PNG/JPEG/WebP export, system fonts
tests/                 unit tests for the DOM-free modules
```

Exports do not freeze the window: each cover is drawn, encoded to PNG asynchronously and sent to Rust
as raw bytes (no base64), where it is converted and written on a worker thread, two at a time, with a
progress bar and a cancel button.

All drawing happens in the web view. The Rust side only touches files: profiles, settings and the
current session live in the app data directory, and exports are written where you choose.

The front end also runs in a plain browser for development (`python3 -m http.server -d ui`); it then
stores data in `localStorage` and saves files as downloads.

## 中文

SmedCover 是一个给视频频道批量做封面的桌面应用。先把品牌设好（名称、类目、颜色、图形），之后每条视频
只要选类目、写标题，就能同时得到所有需要的尺寸。

- **两个入口**：「配置」放一次性设置（品牌与类目、尺寸与导出、字体），「编辑」放每条视频都要做的事（封面、资产、样式、图层）。
- **图层式拼贴**：封面上的每个部分都是图层，都可以选中拖动，拖四角缩放、拖四边拉伸、拖顶部圆点旋转，还能隐藏、锁定、调整层级和不透明度；还能叠加贴纸、自己的图片和额外文字，新素材加在当前选中图层的上方。
- **一处拼贴，所有尺寸**：图层位置按相对比例保存，自动映射到每个输出尺寸；切到「仅此尺寸」可以单独微调。
- **资产库**：20 个跟随类目主色的赛璐珞图形、50 个免费贴纸、11 种色块与分界线形状，以及自己上传的素材。
- **档案**：品牌名、任意数量的类目和一套默认设计；可保存多套并导入导出。
- **三套版式**、深浅两种底色、任意像素尺寸。
- **标题是主角**：输入的一行就是封面上的一行，字号自动适配；用 `*星号*` 标出强调色。
- **导出**：PNG / JPEG / WebP，1–4 倍清晰度，可按 CSV 表格批量出图。

运行方式见上方 “Run it”。
