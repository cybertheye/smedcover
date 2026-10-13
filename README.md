# SmedCover

English · [中文](README.zh-CN.md)

A desktop app for making branded cover images for your videos. Set up your brand once (name,
channels, colours, graphics); after that, for every video you pick a channel and type the title, and
get the cover in every size you need at the same time. Built with Tauri 2 and Rust for macOS,
Windows and Linux.

How it works inside: [ARCHITECTURE.md](ARCHITECTURE.md).

## Concepts

| Term | Meaning |
|---|---|
| **Profile** | Everything about one brand: its name, channels, output sizes, fonts, template and a default design. You can keep several. |
| **Channel** | One content line within the brand, with its own name, colour and graphic. A cover takes its colour and graphic from its channel. |
| **Cover** | The one you are editing: its channel, title, corner tag and its own stack of layers. |
| **Layer** | Each part of a cover. Built-in layers (background, colour block, title, …) are on every cover; free layers are the stickers, images and text you add. |
| **Project** | The current cover saved to a file together with its profile and the assets it uses, so it can be reopened as it was. |

## The window

Three columns, with two modes at the top: **Edit** and **Setup**.

- **Left** — the tabs of the current mode.
  - Edit: **Cover**, **Style**, **Assets**
  - Setup: **Brand**, **Sizes & export**, **Fonts**
- **Centre** — the main canvas, and below it a thumbnail of every output size. Click one to show that size on the canvas.
- **Right** (Edit only) — the layer list and the selected layer's properties.
- **Top bar** — profile switcher, open and save project, undo and redo, export.

## Quick start

1. On first launch, type a brand name and pick a starting point: three general channels, or a full example.
2. Under *Setup → Brand*, make the channels your own: name, sub-name, code, colour, graphic.
3. Under *Setup → Sizes & export*, tick the output sizes you need.
4. Back in *Edit → Cover*, pick a channel and type the title. Every size updates together.
5. Click **Export** in the top bar.

## Making a cover

### Title

- One line in the text box is one line on the cover. Text **never wraps**; longer or more lines mean smaller type.
- Words wrapped in `*asterisks*` take the channel colour.
- The corner tag is an optional short label such as `EP.03`.

### Background photo

- Choose a photo in the Cover tab, or drop one onto the window.
- Drag the photo to move it, scroll to resize it.
- Select the Background layer on the right to set blur and dim.

### Collage: work directly on the canvas

| Action | Result |
|---|---|
| Click | Select the topmost layer |
| Drag | Move |
| Drag a corner | Resize |
| Drag a side | Stretch horizontally or vertically |
| Drag the top knob | Rotate |
| Scroll | Resize; with Alt, rotate |
| Arrow keys | Nudge by 1; with Shift, by 10 |
| Delete | Remove the selected free layer |
| Esc | Deselect |
| Cmd/Ctrl + D | Duplicate the selected free layer |
| Cmd/Ctrl + Z, with Shift to redo | Undo / redo |
| Cmd/Ctrl + S | Save the project |

Every layer except Background and Corner brackets can be moved, resized, stretched and rotated.

### One collage, every size

*Applies to* in the toolbar decides where your change lands:

- **All sizes** (default) — placement is stored relative to the canvas, so one adjustment maps to every size.
- **This size only** — fine-tunes just the size on screen.

In *This size only*, the channel graphic's placement is remembered per channel.

### Layers

- The list on the right runs front to back, top to bottom. Drag a row to re-order, or use ▲ ▼.
- The two icons on each row are show/hide and lock. Background and Corner brackets carry a 🔒: they are fixed layers.
- **＋ Text** adds a text layer; clicking an item in Assets adds it. New layers go directly above the selected one.
- The properties panel sets position, size, stretch, rotation and opacity precisely, and resets placement.

What each layer allows:

| Layer | Move / resize | Hide | Re-order | Delete |
|---|---|---|---|---|
| Background | photo only | yes | no | no |
| Corner brackets | no | yes | yes | no |
| Colour block, channel graphic, brand row, title, corner tag, channel name | yes | yes | yes | no |
| Stickers, images, text (free layers) | yes | yes | yes | yes |

### Items for some channels only

Select a free layer and use **Channels** at the bottom of its properties:

- **All channels** (default) — the layer is on every channel's cover.
- Click a channel — the layer is only on that channel's covers. You can pick several.

A restricted layer shows a small dot in the list. On other channels it is neither shown nor exported.
Deleting a channel also deletes the layers that belonged only to it.

### Assets

- **My assets** — upload PNG, SVG, JPG or WebP; transparent PNGs look best.
- **Channel graphics** — twenty cel-shaded graphics that follow the channel colour.
- **Stickers** — a free pack of fifty; each can optionally follow the channel colour.
- **Colour block & edge** — eleven shapes; click one to reshape the colour block layer.

### Style and the default design

- Three templates — Stack, Split, Banner — on a dark or light background.
- **Set as default** stores the current layers, including items you added, as the profile's starting point for every new cover.

## Setup

- **Brand** — brand name, counter label, adding, removing and ordering channels; create, duplicate, delete, import and export profiles.
- **Sizes & export** — tick preset sizes or add a custom width × height. A size can be given your own name, shown under its thumbnail.
- **Fonts** — Noto Sans SC, Bebas Neue and JetBrains Mono are bundled, so covers look the same on every platform. You can also use an installed font or import a font file.

## Export

- **Format** — PNG, JPEG (with quality) or WebP (lossless).
- **Resolution** — 1× to 4×.
- **Scope** — the current size, or every size into a folder.
- **Transparency** — hide the Background layer and export PNG or WebP. JPEG has no transparency and is filled dark.
- **File name pattern** — `{n}` number, `{channel}`, `{code}`, `{title}`, `{size}`, `{w}`, `{h}`.
- A progress dialog is shown while exporting, and you can cancel at any time.

### Batch export

Import a CSV with one cover per row; every row is exported with the current layers in all selected sizes.

```csv
channel,title,tag
Vlog,"First line\n*second line*",EP.01
Tutorials,Another title,
```

- The channel column may hold a name, a code or a number. Rows that match nothing use the current channel.
- Use `\n` for a line break in a title.
- The header row is optional; without it the columns are channel, title, tag.
- A template can be downloaded from the app.

## Where your data lives

Profiles, assets, settings and the current session are kept in the system's app data directory.
Exports are written only where you choose.

| System | Location |
|---|---|
| macOS | `~/Library/Application Support/com.cyven.smedcover/` |
| Windows | `%APPDATA%\com.cyven.smedcover\` |
| Linux | `~/.local/share/com.cyven.smedcover/` |

To move to another computer or share with someone: export the profile (JSON; uploaded assets travel
with it) or save a project file.

## Run and build from source

Requires Rust, Node.js and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install                          # installs the Tauri CLI only
npm run dev                          # development window; press Cmd/Ctrl+R after editing the UI
npm run build                        # release installers in src-tauri/target/release/bundle/
npm run tauri -- build --debug       # debug build; right-click in the window for the web inspector
npm test                             # front-end unit tests
cd src-tauri && cargo test           # Rust unit tests
```

JPEG and WebP export is much slower in a debug build; judge speed with a release build.

End-to-end self-test: the app exports a few covers through the real pipeline, writes `report.json`
and quits, without touching your real data.

```bash
SMEDCOVER_SELFTEST=/absolute/empty/folder src-tauri/target/release/bundle/macos/SmedCover.app/Contents/MacOS/smedcover
```

`.github/workflows/build.yml` builds installers for macOS, Windows and Linux on GitHub Actions (it has not been run yet).

## To do

### Project files for Illustrator / Affinity

Goal: once a cover is made in SmedCover, take it — with its layers — into your own workflow for
masks, text effects and heavier image work. The native formats of those apps (`.ai`, `.afdesign`)
are not public, so the plan is to export open formats that both can read.

- [ ] **Layered PSD** (first)
  - One `.psd` per size, one layer per layer, keeping names, order, visibility and opacity.
  - Resolution follows the export scale; it looks exactly like the exported image.
  - Open question: include the original photo as a hidden layer, so blur can be redone.
  - Open question: split the title into text, outline and shadow layers in a group, so effects can be swapped.
- [ ] **Hybrid SVG** (second)
  - Layers become groups; title, corner tag, text layers, colour block and corner brackets are vector, the photo and cel graphics are embedded images.
  - Text either stays editable (the same font must be installed) or keeps its exact look (converted to shapes).
- [ ] Check the results in Illustrator and Affinity: layer names, grouping, transparency, text.

### Other

- [ ] A low-resolution preview of the blurred photo for smoother dragging.
- [ ] Redraw thumbnails only when needed, to cut the cost of many sizes.
- [ ] Subset the bundled fonts to shrink the installer.
- [ ] Try the app on Windows and Linux, and get the GitHub Actions build running.

## Licences

| What | Licence |
|---|---|
| The program (all source code) | [GNU AGPL v3 or later](LICENSE) |
| Built-in artwork: channel graphics, stickers, colour block shapes | [CC BY 4.0](LICENSE-ASSETS.md) |
| Bundled fonts: Noto Sans SC, Bebas Neue, JetBrains Mono | SIL Open Font License, texts in `ui/fonts/` |

In short: you may use, change and redistribute SmedCover, but if you distribute a modified version —
or let people use one over a network — you must make its source available under the same licence.
The built-in artwork may be reused elsewhere with credit; covers you make with SmedCover need no credit.

Copyright © 2026 cybertheye.
