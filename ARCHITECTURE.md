# SmedCover architecture

English · [中文](ARCHITECTURE.zh-CN.md)

For people who want to read or change the code. For how to use the app, see [README.md](README.md).

## 1. Overview

SmedCover is a Tauri 2 app in two halves:

- **The interface (`ui/`)** runs in the system web view and does all interaction and **all drawing**. Plain ES modules: no bundler, no framework, no runtime dependencies.
- **The Rust shell (`src-tauri/`)** only touches files: it reads and writes app data, converts and saves images, shows system dialogs and lists system fonts.

```mermaid
flowchart LR
  subgraph WebView["Web view — ui/"]
    app["app.js<br/>state, interaction, panels"]
    render["render.js<br/>paints layer by layer"]
    model["layers.js · layout.js · title.js<br/>pure maths"]
    assets["assets.js · cel.js · graphics.js · stickers.js<br/>assets drawn in code"]
    store["store.js<br/>data model and validation"]
    app --> render --> model
    render --> assets
    app --> store
  end
  subgraph Rust["Rust — src-tauri/"]
    fs["sandboxed store<br/>app_read / write / list / delete"]
    enc["convert and save images<br/>save_image / write_image"]
    misc["dialogs, system fonts, self-test"]
  end
  store -- "invoke (JSON text)" --> fs
  app -- "invoke (binary frame)" --> enc
  app --> misc
```

Why it is split this way:

- **What you see is what you export.** Preview and export run the same drawing code; only the pixel count differs.
- **The drawing code runs in a plain browser**, so development and automated checks do not need the desktop app.
- **The Rust side is small**, and so is its reach: the interface never gets an arbitrary file path. It can read and write the app data directory, and the places the user picks in a dialog.

## 2. Files

```
ui/
  index.html         markup and styles
  js/app.js          UI: state, the two modes, tabs, canvas interaction, layer panel, export, undo
  js/render.js       drawCover(): walks the layers and paints one cover; selection and hit-testing
  js/layers.js       layer model: placement across sizes, ordering, channels (pure)
  js/layout.js       geometry for any aspect ratio and template (pure)
  js/title.js        title parsing and fitting
  js/photo.js        background photo and the cached gaussian blur
  js/assets.js       asset library: graphics, stickers, uploads
  js/cel.js          cel-shading kit and the first five channel graphics
  js/graphics.js     fifteen more channel graphics
  js/stickers.js     the sixty stickers
  js/store.js        data model, validation, persistence
  js/presets.js      starter profiles and size presets
  js/csv.js          CSV reader for batch export
  js/i18n.js         interface strings (zh / en)
  fonts/             bundled fonts and their licences
src-tauri/src/lib.rs all of the Rust side
tests/               unit tests for the DOM-free modules
```

`layers.js`, `layout.js`, the parsing half of `title.js`, `csv.js` and the validation half of
`store.js` never touch the DOM, so Node can test them directly.

## 3. Data model

Three pieces of data, all plain JSON. Everything read from disk goes through the `normalize*`
functions in `store.js`: a missing or invalid field falls back to its default, so old files and
hand-edited files cannot crash the app.

**Profile** (`profiles/<id>.json`)

```jsonc
{
  "id": "…", "name": "…",
  "brand": { "name": "PIXEL HARBOR", "unit": "CHANNEL" },
  "categories": [                       // called "channels" in the UI; the field name is kept for old files
    { "id": "vlog", "name": "Vlog", "sub": "DAILY VLOG", "code": "VLOG", "color": "#fcee0a",
      "graphic": { "kind": "graphic", "id": "camera", "labels": [], "stamp": "" } }
  ],
  "style": { "template": "stack", "theme": "dark", "imageShadow": true },
  "fonts": { "body": "", "display": "" },
  "sizes": [ { "w": 1920, "h": 1080, "label": "16:9", "name": "", "on": true } ],
  "design": { "layers": [ … ] }         // the default design: the layers a new cover starts with
}
```

**Cover** (`session.json`, the current session)

```jsonc
{ "catId": "vlog", "title": "First line\n*second line*", "tag": "EP.01", "layers": [ … ] }
```

**Settings** (`settings.json`): language, current profile, export scale, format, JPEG quality, file
name pattern, adjustment scope.

Other files: `assets/<id>.json` (uploaded assets, as data URLs), `fonts/<name>.font` (imported
fonts), `session-photo` (the current background photo).

A **project file** bundles the cover, its profile and the uploads it uses into one JSON, so it opens
unchanged on another computer.

## 4. The layer model (`layers.js`)

A cover is an array of layers, bottom first.

| Kind | Types | Notes |
|---|---|---|
| Bound layers | `bg` `accent` `graphic` `brand` `title` `tag` `catname` `frame` | Exactly one of each on every cover. Their content comes from elsewhere (the title text, the channel's graphic, …). They cannot be deleted; the `id` is the type name. |
| Free layers | `asset` `text` | Assets and text added by the user; can be deleted and duplicated. |

`normalizeLayers()` repairs a layer list: it drops unknown layers, puts back missing bound layers,
keeps the background at the bottom and makes ids unique.

### 4.1 Placement: one collage mapped to every size

Every layer has a `t`:

```jsonc
"t": {
  "all": { "x": 0.5, "y": 0.42, "s": 0.35, "r": 0, "kx": 1, "ky": 1 },
  "by":  { "1920x1080": { "dx": 0, "dy": -40, "s": 1.1, "r": 0, "kx": 1, "ky": 1 } }
}
```

- **`t.all` applies to every size.** Position is stored as a **fraction of the canvas**, so one value lands in a consistent place from 16:9 to 9:16.
  - Free layers: `x`, `y` are the position of the centre.
  - Bound layers: `x`, `y` are an **offset** from where the template puts the element; 0 by default.
  - `s` is the overall size, `kx` / `ky` stretch horizontally / vertically, `r` is degrees.
- **`t.by` is per-size fine-tuning**, keyed by size (`"1920x1080"`), in virtual pixels, applied on top of `t.all`.
- **The channel graphic** can also be tuned per channel, under `"1920x1080@<channel id>"`, because graphics differ a lot in shape.

`resolve()` combines the two into the final placement: positions add, scales and stretches multiply,
angles add. `adjust()` is the single entry point for every edit: dragging, handles, the wheel, arrow
keys and sliders all express a change as a patch, which is written to `t.all` or `t.by` depending on
the current scope.

### 4.2 Channels a layer belongs to

A free layer may carry `cats`, an array of channel ids. Without it the layer belongs to every
channel; with it, only to those listed. `appliesTo(layer, catId)` is the one place that decides, and
drawing, the layer list and re-ordering all use it. Validation removes ids of channels that no longer
exist, and a layer left with none is removed.

## 5. Layout (`layout.js`)

### 5.1 The virtual canvas

All geometry is computed on a "virtual canvas" whose short side is always 1080–1200 units, whatever
the real pixel size. `virtualSize(w, h)` gives it: 16:9 is 1920×1080, 4:3 is 1600×1200.

This lets type sizes, line weights and gaps be written as fixed numbers that keep their proportions
from 900×383 up to 8K. Drawing then needs one overall scale on the canvas.

### 5.2 Templates

`layout(template, w, h)` returns all the geometry of a cover: the colour block polygon, the dividing
edge, the title box, the corner tag position, the channel name position, and the graphic's centre and
size.

- **Stack** has five hand-tuned anchors, for 9:16, 3:4, 1:1, 4:3 and 16:9. Other ratios are interpolated linearly between neighbouring anchors on the logarithm of the aspect ratio, so any size gets a sensible layout.
- **Banner** reuses the stack structure with the strip squeezed thin.
- **Split** is computed separately; its colour block is a slanted panel on the right.

Convention: the **first two points of the colour block polygon are the dividing edge**. All twelve
shapes of the colour block are generated from that edge.

## 6. Drawing (`render.js`)

`drawCover(canvas, options)` paints one cover:

1. Work out the virtual size, set the canvas's real pixel size and scale the context once.
2. Build an environment: template geometry, channel colour, light or dark theme, background photo and so on.
3. Walk the layers bottom to top, skipping hidden ones and ones that do not belong to the current channel; get the placement from `resolve()` and call `PAINT[type]`.
4. Each painted layer leaves a hit record (centre, half-width, half-height, angle) in `canvas._hits`.
5. If a selected layer is given, draw its outline and handles last.

Two helpers keep transforms consistent:

- **`placed()`** is for bound layers. Their paint function returns the rectangle it occupies; it is first run on a throw-away context to measure that rectangle, then painted for real, translated, rotated and scaled about the rectangle's centre. Scaling and rotation therefore always pivot on the content, and the result never depends on a previous frame.
- **`centred()`** is for assets and free text, which already draw around their own centre.

**Opacity**: a layer below 1 is painted onto a scratch canvas and blended in as a whole, so
overlapping strokes inside the layer do not show through each other.

**Preview and export share this code.** The main canvas is painted at the size of its display area,
thumbnails smaller, exports at size × scale.

### 6.1 Title (`title.js`)

Titles never wrap. `parseTitle()` splits the text into lines and, at asterisks, into plain and
highlighted runs. The type size is the largest at which the longest line fits the width and all lines
fit the height. Outline and shadow are several passes: the offset shadow, the ink outline, then the
fill.

### 6.2 Background photo and blur (`photo.js`)

Canvas filters are not available in the macOS web view, so the gaussian blur is done in script:
**three box blurs approximate one gaussian blur**, each box blur using a sliding window so its cost
does not depend on the radius.

The blur is applied to a reduced working copy of the photo and cached by photo and blur amount. After
that, moving or scaling the photo, or editing any other layer, costs a single image draw. Exports
recompute it from a higher-resolution copy.

### 6.3 Assets

- **Channel graphics** and **stickers** are all drawn in code — there are no image files — so they are sharp at any size and can take the channel colour. `cel.js` provides a cel-shading kit (flat tones, ink lines, pseudo-3D boxes and prisms); `graphics.js` adds more through `registerGraphics()`.
- **Uploads** are stored as data URLs in the app data directory and cached once decoded.
- `drawAsset()` is the single entry point and returns the asset's half-extents for hit-testing.

## 7. Interaction (`app.js`)

### 7.1 State and refresh

All state is in one object `S`: the current profile, cover, settings, mode, selected size and layer,
and the undo history.

After changing data, code calls `touch({ profile, cover, panel, side, strip })`, which marks what
needs saving, schedules a redraw, rebuilds a column of the interface if asked, and records undo
history. Saving, redrawing and history are debounced, so a long drag does not write to disk
repeatedly.

There is no framework: each column is built with a small element helper, `el()`, and rebuilt whole
when needed.

### 7.2 Working on the canvas

- The pointer position is converted to virtual coordinates and tested against `canvas._hits`, top first. The point is rotated back into each layer's own frame, so rotated layers are hit accurately.
- For the selected layer the handles are checked first: corners resize, sides stretch, the top knob rotates. Handle size is computed in screen pixels, so handles look the same at any zoom.
- Corner brackets are never hit; the background can be dragged only when it holds a photo.

### 7.3 Undo

After each change (debounced by half a second) the profile and cover are serialised into one string
snapshot, pushed only if it differs from the last, up to 80 steps. Undo parses a snapshot back and
validates it again. Simple, at the cost of a full copy per step — fine at the current data size.

## 8. The Rust side (`src-tauri/src/lib.rs`)

### 8.1 Sandboxed store

`app_read`, `app_write`, `app_list` and `app_delete` take relative paths only. `resolve()` joins them
to the app data directory and refuses absolute paths and `..`, so the interface cannot reach files
outside it. Writes go to a temporary file that is then renamed, so quitting mid-write never leaves
half a file.

### 8.2 Export pipeline

```
canvas ──toBlob (async)──▶ PNG bytes ──binary frame──▶ Rust worker thread ──▶ PNG / JPEG / WebP file
```

1. The interface paints the cover on an off-screen canvas and encodes it to PNG with `toBlob`, **asynchronously**, so the window keeps responding.
2. The bytes go to Rust as Tauri's raw request body, **without base64**. The body is a small frame:

   ```
   [4-byte little-endian length][JSON metadata: folder, file name, format, quality][PNG bytes]
   ```

   The metadata travels in the body rather than in request headers because, in the real app, custom headers did not reach Rust.
3. `save_image` (with a save dialog) and `write_image` (into a folder already chosen) are async commands that run on a worker thread. PNG is written as is; JPEG is flattened onto a dark matte and encoded; WebP is encoded lossless.
4. The interface keeps at most two writes pending, and is already painting the next cover while it waits. A progress dialog shows the count; cancelling stops new work from being dispatched.

File names pass through `safe_name()`, which keeps only the last path component, so a name cannot be
used to write into another directory.

### 8.3 Other commands

`pick_folder`, `save_text` (profiles, projects, the CSV template) and `list_system_fonts` (which
enumerates installed fonts with fontdb).

## 9. Browser fallback

The `files` object in `store.js` has two implementations: with Tauri it calls the commands above;
without it, it falls back to `localStorage`, and exports become browser downloads. So the interface
can be developed from a static server:

```bash
python3 -m http.server -d ui 4599
```

## 10. Fonts

The three bundled fonts are loaded with `@font-face` and render the same on every platform. Imported
fonts are stored as data URLs under `fonts/` and registered with `FontFace` at start-up. The first
frame waits for the fonts, otherwise the title would be fitted using the wrong glyph widths.

## 11. Tests

| Level | Command | Covers |
|---|---|---|
| Front-end unit tests | `npm test` | layout, layer placement and order, channels, CSV, data validation, file name pattern, size and naming of the asset packs, both languages present for every string |
| Rust unit tests | `cd src-tauri && cargo test` | path sandbox, store round trip, frame parsing, encoding in the three formats, file name handling |
| End-to-end self-test | `SMEDCOVER_SELFTEST=<folder> <executable>` | the full export path between the real web view and Rust |

In self-test mode the app keeps its data in the given folder, exports a few covers in all three
formats, writes `report.json` and quits. It catches problems that only show up in the real app, such
as the header issue above.

## 12. Trade-offs and known limits

- **Drawing runs on the interface thread.** Painting a 4× cover briefly stalls the window. Conversion and writing are already on a worker thread.
- **No bundler.** Modules are loaded directly by the web view: simple, but nothing is minified or tree-shaken. At the current size start-up time is negligible.
- **Undo keeps full snapshots.** Simple and robust; it would need to become incremental if the data grows.
- **All thumbnails are redrawn every time.** With many sizes this is the main cost.
- **Bundled fonts are not subset.** They account for most of the installer.
- **Only run on macOS so far.** The Windows and Linux build configuration is written but not verified.

## 13. Where to start for common changes

| To… | Change |
|---|---|
| add a channel graphic | write the draw function in `graphics.js` and `registerGraphics()` it; `assets.js` needs nothing |
| add a sticker | `stickers.js` |
| add a colour block shape | `ACCENT_SHAPES` in `layers.js`, `paintAccent()` and `edgePoints()` in `render.js`, a name in `i18n.js` |
| add a template | `TEMPLATES` and `layout()` in `layout.js`, a name in `i18n.js` |
| add a property to a layer | `PROPS` and `normalizeLayer()` in `layers.js`, `PAINT` in `render.js`, `typeControls()` in `app.js` |
| add an export format | `encode()` in `lib.rs`, `EXT` and the format picker in `app.js` |
| add an interface string | `i18n.js`, in both languages; a test checks that both are present |
