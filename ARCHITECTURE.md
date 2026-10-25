# SmedCover architecture

English · [中文](ARCHITECTURE.zh-CN.md)

For people who want to read or change the code. For how to use the app, see [README.md](README.md).

## 1. Overview

SmedCover is a Tauri 2 app in two halves:

- **The interface (`ui/`)** runs in the system web view and does all interaction and **all drawing**. Plain ES modules: no bundler, no framework, no runtime dependencies.
- **The Rust side** only touches files and the network: it reads and writes app data, converts and saves images, shows system dialogs, lists system fonts and sends the AI request for a generated asset. Its work is in `core/` (the crate `smedcover-core`, with neither Tauri nor a web view in it, so a server can share it); `src-tauri/` is the desktop app around it, its commands thin wrappers (10).

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
  subgraph Rust["Rust — core/ and src-tauri/"]
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
- **The Rust side is small**, and so is its reach: the app data directory is read and written by relative paths only, which cannot leave it (10.1), and outside it the interface writes where the user picked in a dialog. That last rests on the interface: an export folder, once picked, is kept for its profile in `custom.json` (`exportDirs`, see 3) and handed back on every export, and `write_image` checks only that it is an absolute folder (10.2).

## 2. Files

```
ui/
  index.html         markup and styles
  js/app.js          UI: state, the window (dock and sheets, the bar over the canvas, the properties drawer, Settings and the other windows), canvas interaction, export, undo
  js/render.js       drawCover(): walks the layers and paints one cover; selection and hit-testing
  js/layers.js       layer model: placement across sizes, ordering (pure)
  js/layout.js       geometry for any aspect ratio and template (pure)
  js/title.js        title parsing and fitting, in lines and in columns
  js/stack3d.js      the Layers sheet's 3D view: the stack's projection, fitting, labels and drawing (pure maths but for the drawing)
  js/platforms.js    the platforms covers are made for, as data: the ratios each wants, feed widths, what the apps lay over a cover; the sizes' names (platformsFor)
  js/check.js        the cover standards' rules, pure (the tests hold the layouts to them; meetStandards in layout.js)
  js/deal.js         Surprise me's rules, all in one place: every number it deals by (RULES), what suits each look (FAMILIES, RECIPES), the chances the user may set over them (oddsOf, rebalance; moveShare for the chances window's bars, DOTS, dotsOf and withDots for its dots), the layout preset a hand is dealt in (pickLayout), a hand dealt onto a cover (dealCover), pure
  js/textfx.js       text effects: layered, masked, outlined and letter by letter
  js/ransom.js       the ransom note: each letter in a face, on a paper, at an angle of its own
  js/outlines.js     cache of glyph outlines (fetched from the Rust side)
  js/photo.js        background photo and the cached gaussian blur
  js/assets.js       asset library: graphics, stickers, uploads
  js/cel.js          cel-shading kit and the first five channel graphics
  js/graphics.js     fifteen more channel graphics
  js/stickers.js     the 72 stickers (twelve of them frames), and the shared painters
  js/style.js        looks: the hooks a look may have, the registry (LOOKS), the kinds the Look sheet sorts them by (LOOK_CATEGORIES, LOOK_TAGS) and the API the app imports
  js/looks/kit.js    what the looks share: helpers, scene objects, the current look's state (setLook), effects' machinery
  js/looks/<id>.js   one file per look (cel, cyber, riso … wasteland, facet): its object, helpers and layer effects
  js/spec.js         stickers described as data: validation and interpreter (AI-generated assets)
  (core/src/cut/vision.rs: the photo's subject mask, from Vision)
  js/repaint.js      photo repaint: the three image services' requests and replies, repaint prompts, reading built-in styles
  repaint-styles/    built-in repaint styles, one `<id>.md` each (names and notes in a header), plus the generated list index.json
  js/solid.js        3D objects described as data: validation, drawn with the channel graphics' renderer
  js/ai.js           AI generation: settings, requests for both API styles, the preset prompt (pure)
  js/store.js        data model, validation, persistence
  js/presets.js      starter profiles (the starter's name, brand and channels from defaults.json) and size presets (one for each ratio a platform wants)
  js/defaults.js     the defaults: defaults.json read once, custom.json's modules but its settings laid over it (DEFAULTS, layOver)
  defaults.json      the app's defaults, by module: settings, profile, layout, surprise, ui
  js/csv.js          CSV reader for batch export (Settings → Sizes & export)
  js/i18n.js         interface strings (zh / en)
  js/tools.js        the agent tools (MCP) as data: names, descriptions, schemas, hints, what the page reads of each; the argument check, the answers' shapes, what the commands find things by (pure)
  js/commands.js     what each agent tool does, over the app's own functions (makeCommands(api))
  js/agent.js        the agent shell: one call at a time, waiting for the user, the window held during a step, a call that hangs let go of, the desktop's transport, the dev hook
  tools.json         the tools as the host's MCP endpoint lists them, written from tools.js (scripts/tools.mjs)
  fonts/             bundled fonts and their licences
core/src/            the Rust side's work, which a server can share (the crate smedcover-core): store, export, fonts, outlines, cut-out, AI requests, the MCP endpoint (10)
src-tauri/src/lib.rs the desktop app: the data folder, the commands (thin wrappers round core/), the dialogs, the self-test
src-tauri/src/mcp.rs the desktop's side of the agents' endpoint: turned on and off, the window's channel, the mcp_* commands (10.6)
tests/               unit tests for the DOM-free modules
```

`layers.js`, `layout.js`, the parsing half of `title.js`, `csv.js`, the validation half of
`store.js` and `tools.js` never touch the DOM, so Node can test them directly; nor do `commands.js` and
`agent.js` until a call runs.

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
  "style": { "template": "stack", "layoutAdjust": { "stack": { "size": 0.3 } }, "theme": "dark",
             "layoutBy": { "1920x1080": { "template": "split", "adjust": {} } },   // optional: sizes drawn in a layout of their own (see 5.2)
             "look": "cel", "lookParams": { "cyber": { "glow": 1.2 } }, "lookSeed": 7,
             "lookArt": { "jelly": { "kind": "sticker", "id": "star" } } },   // optional: what a look's figure is drawn from in the channel graphic's place
  "fonts": { "body": "", "display": "" },
  "sizes": [ { "w": 1920, "h": 1080, "label": "16:9", "name": "", "on": true } ],
  "design": { "layers": [ … ] }         // the default design: the layers a new cover starts with
}
```

**Cover** (`covers/<profile id>/<channel id>.json`, one for each channel of each profile)

```jsonc
{ "catId": "vlog", "title": "First line\n*second line*", "tag": "EP.01", "layers": [ … ],
  "scene": { "court": { "ball": { "all": [0.1, -0.05], "by": { "1080x1920": [0.02, 0] } } } } }   // optional: scene objects dragged (see 7.5)
```

`S.covers` holds the current profile's channel covers (keyed by channel id) and `S.cover` the one shown; both change only through `setCover()`. Switching profile reads the new one's covers (`loadCovers()`); switching channel (`switchChannel()`) commits the undo step first, then shows that channel's cover — made by `channelCover()` from the profile's design, with a default title, if it has none. Saving (`persistCover`) is debounced per profile and channel. The channel each profile was last on is kept in the settings' `channels` (`{profile id: channel id}`) and read by `channelOf()`. Deleting a profile deletes its `covers/<profile id>/`. *Copy from another channel* (`copyDialog`, `copyInto`) takes the source cover through `coverOf()` (the one in memory for the current profile, else the file, else a new one from the design), `copyPreview()` draws it whole with its own profile at the size on the canvas, and `layers.js`'s pure `copyFreeLayers(into, from)` copies the layers the user added to it (`isAdded`: free layers and copies of layout layers, see 4): deep copies under new ids, a passive layer's `of` turned to its photo's copy, a cut-out's or an asset's `weave` to the copies of the lettering it weaves with (a layout layer's id kept, as every cover has it; any other dropped); each copy goes above the nearest layout layer below it in the source, over the layers added there already, in the order they had. The dialog counts them by kind, the copies as *Layout copies*. From another profile, what the copies keep by size is put on this profile's sizes first (`acrossSizes()`, see 4.4). The cover is then checked by `channelCover()` as one read is, and the whole is one undo step.

Earlier data: there used to be one cover, `session.json`, shared by every channel, whose layers could be kept to some channels with `cats`. While the current profile has no channel covers yet, `migrateSession()` splits it: one copy per channel, `channelCover()` keeping only the layers on that channel and dropping `cats`, the title and tag copied to each; the old file is renamed `session.migrated.json`, and `session-photo*` is first turned into a photo layer by `upgradeCover`, then deleted.

**Settings** (`custom.json`, under `settings`, only what differs from the defaults: see below): language, current profile, the channel each profile was last on
(`channels`), export scale, format, JPEG quality, file name pattern (`nameTemplate`, the one string whether it is edited
as tags or as text, see 9.5), and by profile id the sizes the Export window has switched off (`exportSizes`:
`{profile id: {size key: false}}`, only those off, so a size not named — one added since — is on; a profile with
none off is not kept; `normalizeExportSizes`) and the folder its exports go into (`exportDirs`: `{profile id: path}`,
none until the first export picks one); adjustment scope (`scope`: `all`, `orient` or `size`, see 4.1; not kept: every start sets it to the defaults' own, `startScope()`); how many times
each look was made a profile's on this computer, by its card or by a hand of Surprise me kept (`lookUse`: whole counts,
only of looks there are and above 0 — the Look sheet's ★ Most used, 9.5); the looks liked there by the ♡ on their cards
(`lookLikes`: look ids, the latest liked first, each once, only of looks there are — its ♥ Liked); and the user's own
Surprise me chances of each look's optional parts (`recipes`: {look: {params}}, only what was changed, checked by `normalizeRecipes`; see `deal.js`),
and what Surprise me keeps (`surprise`: the parts to leave alone, `locks`, of `SURPRISE_LOCKS` — `look`, `theme`,
`lettering`, `places`, `layout`; the chances set in Surprise me's
chances, `odds`, only what was set; see `normalizeSurprise`), and the user's layout presets (`layouts`, below); and of
the window (9.5), whether its panes are frosted glass (`glass`), whether the properties drawer is open (`drawer`) and the
widths its columns were dragged to (`columns`). Deleting a profile (`profileActions.delete()`) drops its entries in
`exportSizes` and `exportDirs`.

**Defaults** (`ui/defaults.json`, shipped with the app; `custom.json` in the data folder, written by the app, never by
hand, laid out by the same modules): the defaults worth changing without touching the code, by module. `settings`: what `normalizeSettings()` falls
back to — the language (`""`, the system's), the export's resolution, format, JPEG quality and file names, the scope
(and, through `startScope()`, the one every start begins at),
the glass, the drawer, the cut-out's engine. `profile`: what a new profile starts with — its ground, look and seed
(`style`), its sizes (`sizes`; `SIZE_PRESETS` in `presets.js` stays the list Settings offers), and the starter's name,
brand and channels (`starter`, read by `starterProfile()`; a name given per language, `{zh, en}`). `layout`: the layout
each orientation is given by default (`byOrient`, see 5.2: what a new profile, a size added to one, a new layout preset
and a template's reset start from). `surprise`: the chances Surprise me deals by under the
user's own (`odds`, `RULES.odds` in `deal.js`, see 9.4). `ui`: the side columns' least and first widths (`columns`),
what the canvas keeps (`centreMin`, `centreRoomy`) and when dragging counts as slow with the glass (`glassSlowMs`; see
9.5). The 35 looks' own slider defaults stay in their files, as do Surprise me's other numbers (`RULES`).

`defaults.js` reads `defaults.json` once, as the module loads — `fetch()` beside itself in the page (the desktop app's
own protocol, a server's page and a plain browser alike, as the built-in repaint styles are read), the disk under Node
for the tests; a top-level `await` either way — into `SHIPPED` (frozen) and `DEFAULTS`, the one object every module
reads a default from when it needs it, never a copy taken as it loads. The first thing `start()` does is read
`custom.json` (`readCustom()`: `files.read`, so the data folder; in a plain browser, its storage under
`smedcover:custom.json`; on a server a failed read stops the start, as for the other files written over) and lay its
modules but `settings` over the defaults (`layOver(custom)`, in place), before anything else reads a default. It goes key by key, as deep as it goes: a value is taken only where `defaults.json` has that key and a
value of the same kind — a finite number, text, true or false, a list whose items are each of the kind of its first
(an object item keeping what that first has), an object gone into key by key; an object left empty there (Surprise me's
chances by look) takes any name with a number, text or true/false. Anything else is let go and the default kept, and
`layOver()` returns the paths of what it let go, said once in a toast when the window is up (`msg.customLeft`). The app
writes none of these modules (they are written back as read, `CUSTOM.rest`). Whether a value is within range is for
what reads it — `normalizeSettings()`, `normalizeProfile()`, `oddsOf()`, `orientDefault()`, `column()` — which holds it
there as it holds what the files hold. A default is what has not been set: a profile stays as it is.

The rest of the start reads side by side what does not wait on something read before it: the system's fonts are
listed (`list_system_fonts`, on a thread of the Rust side's own) and the outlines kept (6.2) read while `custom.json`,
the imported fonts, the assets, the styles, the profiles and the covers are, each set of files asked for at once and
kept in order (`loadProfiles()`, `loadAssetRecords()`, `loadCovers()`; a font is added to the page in order once they
are all read). The Rust side still reads them one after another (`app_read` is a command without `async`, run on its
main thread): what is saved is the wait between one request and the next. Nothing is tried on a canvas at the start: the ransom note's faces are found when it is first drawn (6.2).
`BOOT` notes when each step was over, for the self-test that times it (13).

`custom.json`'s `settings` are the user's settings themselves, not defaults: `layOver()` leaves them, so
`DEFAULTS.settings` stays as shipped. `readSettings(custom, legacy)` (`store.js`) gives `normalizeSettings()` of them,
`defaults.json`'s settings with the user's over them, `normalizeSettings()` staying the one place settings are checked.
`persistSettings()` (`app.js`, debounced; `writeCustom()`) writes `{ settings: settingsToKeep(S.settings), …the other
modules as read }`. `settingsToKeep()` keeps only the fields that differ from `normalizeSettings({})`: a value equal to
the default is not written, so a later change to `defaults.json` reaches whoever never changed it, and what has no
default is written once it holds something (the profile last open, `channels`, `columns`, `recentFonts`, `lookUse`,
`layouts`, `recipes`, `exportDirs`…); never `scope`, which every start sets to the defaults' (`startScope()`).
The file is marked `"by": "app"` (`CUSTOM_BY`, which `layOver()` passes over), which tells a `custom.json` the app wrote
from one written by hand. The user's values that have a default in another module stay under `settings` — Surprise me's chances (`surprise.odds`,
over `surprise.odds` of `defaults.json`) and the columns' widths (`columns`, over `ui.columns`): those modules are what
the chances window's reset and a column's double-click go back to, which laid over them the user's would become; and
`layOver()` keeps only the keys `defaults.json` has, which the layout presets' ids in `odds.groups.layout` are not.
Earlier versions kept the settings in `settings.json`: until a `custom.json` the app wrote is there (no file yet, or
one written by hand, as the previous version had it), `readSettings()` reads `settings.json` too, the hand-written
file's `settings` over it (`normalizeSettings({ ...settings.json, ...its settings })`), and the start's
`persistSettings()` writes `custom.json` from that, marked; `settings.json` is left where it is, no longer written nor,
once the mark is there, read. A `custom.json` that is not JSON, or not an object, is read as one the app wrote with no
settings, the defaults, and said once in a toast (`msg.customBad`); its text is kept (`CUSTOM.bad`) and
written to `custom.json.bad` before `custom.json` is next written, so it is never overwritten unseen.

**Layout presets** (`settings.layouts`, for every profile, as the chances are): where a cover's parts stand, without its
look, which Surprise me deals by its chance (see 9.4) and which can be put on the canvas as it is.

```jsonc
[{ "id": "k3j9x0ab", "name": "Poster",
   "template": "stack", "adjust": { "size": 0.38, "flip": true },          // the colour block: the default…
   "orient": { "wide": { "template": "split", "adjust": {} } },            // optional: …each orientation's own…
   "by": { "1080x1920": { "template": "stack", "adjust": { "slant": 0.1 } } },   // optional: …and single sizes' own
   "custom": ["1080x1350"],                                                // optional: sizes of its own, laid out in its editor
   "parts": { "title": { "t": { "all": { … }, "by": { "1080x1920": { … } } }, "shown": true, "vertical": false },   // vertical: each of COLUMN_PARTS (an earlier preset: none)
              "tag": { "t": { … }, "shown": true, "hide": ["1200x1600"] },   // optional: the sizes it is left out at
              "subtitle": { "t": { … }, "shown": false }, … },             // each of LAYOUT_PARTS (an earlier preset: no colour block or brand logo)
   "extras": [{ "id": "xk2p9", "kind": "text", "t": { … }, "shown": true, "vertical": false },   // optional: elements of the user's own
              { "id": "x7q1m", "kind": "vector", "t": { … }, "shown": true, "sticker": "burst" }] }]
```

Three things, at every size, and nothing else. Where each of the layout's parts it places stands (`LAYOUT_PARTS` in
`layers.js`: title, subtitle, tag, channel name, brand row, brand logo, channel graphic, and the colour block and its edge): its
placement `t`, for every size and per size (the graphic's by size alone, for every channel: see `plainPlaces()` below).
Which of them the layout has (`shown`: on the
cover, not left out, see `off` in 4), and the sizes it leaves one out at (`hide`; see `sizes` in 4.4). And the colour block
at each size — the side it lies on, how much it takes, how its edge leans: a template and its adjustments, `{ template,
adjust }`, as `layoutOf()` answers for a profile (see 5.2). The block is kept in three steps, a default (`template`,
`adjust`), each orientation's own (`orient`) and single sizes' own (`by`): `presetLayout(preset, key)` is a size's own, else
its orientation's, else the default, so a size of a profile that the preset never saw is drawn as the sizes facing its way
are (and its parts stand where `t.all` puts them). And which way the words of the title, subtitle, tag and channel name
run (`COLUMN_PARTS`): in columns or in a line, a part's `vertical` as the layer's (see 6.1.1). Not the fonts, letterings,
colours, the look, the brand row's `vertical`, nor any `rules` (the user's). A preset may keep sizes of its own (`custom`, size keys a profile may have),
laid out in its editor beside the profile's; a profile takes of a preset its own sizes alone. And besides its parts, up
to eight elements of the user's own (`extras`, made in its editor only), each of a kind of `EXTRA_KINDS` — `text`,
`solid`, `image`, `vector` — placed and shown as a part is (`t`, a free layer's placement by size keys alone; `shown`,
`hide`), a text one's words in columns or not (`vertical`), a vector one's built-in sticker (`sticker`, `EXTRA_STICKER`
"burst" to begin with).

`takeLayout(style, layers, keys, catId)` makes one from a profile's style and a cover's layers (of channel `catId`) at the
profile's sizes `keys`: the block's default is the profile's own template and its adjustments; an orientation whose sizes
are all drawn alike, and otherwise, has that as its own; else each size drawn otherwise has its own. Its parts come from
`takeParts(layers, keys, was, catId)`: a part counts as shown where the cover has it — not left out, at that size
(`inSize`) —, its eye open or shut (*Hide every layout part*, or a part hidden by hand, hides it from view, not from the layout), `hide`
naming the sizes of `keys` it is not at when it is at some, not shown when it is at none; each of `COLUMN_PARTS` its
`vertical`, true or false, as the layer has it; its places per size for `keys`
alone, the channel graphic's own for channel `catId` (`"<size>@<channel>"`) made the size's and every channel's own let go
(`plainPlaces()`), so the preset places it alike on any channel's cover. `putLayout(style, layers, preset, keys)` puts one
on them, at the profile's sizes `keys` alone: the block's default as the profile's template and its adjustments (none: the
template's own; the other templates' left as they are), each of those sizes the preset draws otherwise (by its own or its
orientation's) given that as its own in `layoutBy`, and no size its own besides; each part where it has it at those sizes
(`t.by` of other sizes left out), a part it shows coming in at the sizes it does not hide (`keepTo`; at none, left out) —
shown, when it was left out; hidden still, when its eye hid it —, one it does not show left out, one it has no entry for
left as it is; each of `COLUMN_PARTS` given its `vertical` when the preset says it (an earlier preset says nothing, and
leaves the layer's own). A part locked stays as it is (its place, whether and where it shows, which way it runs), dealt or applied; and the colour
block locked (`accent`) keeps the profile's block as well — its template, adjustments and `layoutBy` untouched —, where the
block lies being that part's place as much as its `t` is. Then the elements of the user's own, in order (`putLayout(…, env)`, `env` = `{ catId, vector, words, color }`; the app's
`presetEnv()`): `extrasOn()` gives each the next of the cover's layers of its kind, bottom first, on channel `catId`'s
cover — `text` a text layer, `solid` a colour not filling the canvas (`colourFills()`, a wash, as `dealPlaces()` has
it), `image` a photo neither filling the canvas (`fill`) nor a linked cut-out (`of`), `vector` an asset `env.vector(ref)`
calls a vector one (the app's: a sticker, a channel graphic, a sticker made as data, an uploaded SVG; by default the
first two) —, passing by the ids of `env.skip` (Surprise me's woven lettering, `wovenIds()`), and with it the layers
it is split into by size (`twins`: of a type, showing the same, kept to sizes apart, as `cutAt()` splits a photo),
which it places together, each kept to those of its sizes it was at, so a split stays split; each takes its `t` (per size only at `keys`), the sizes it shows at
(`keepTo`; at none, an empty `sizes`, there to be shown again) and a text one's `vertical`, a layer locked staying as it
is; one whose kind the cover has none left of adds one (`extraLayer()`: a text layer of `env.words`, a solid of
`env.color`, an asset of its sticker, tinted; no photo, a picture not being made up; nothing for one shown at none of
`keys`), put over the last of its kind (past what is clipped onto it) or else a colour over the colour block and words or
a sticker on top (`insertExtra()`). So the preset put again places the same layers and adds none; added, they are the
user's (`isAdded`). It returns the ids of the layers the elements place, which Surprise me leaves where they are (see 9.4). `setPresetLayout(preset, scope, key, fn)` is how the editor
changes the block (see 9.4): `fn(lay, at, here)` makes of a layout what it becomes, and each layout the scope reaches from
`key` — `size` the size's own, `orient` its orientation's own and each size's own facing that way, `all` the default and
every own one — gets it from what it had, told whose it is (`at`: a size key, an orientation, or null for the default)
and whether `key` is drawn in it (`here`); what then comes to what it would follow anyway is let go. Blocks reached need
not lie alike (wide sizes side by side, the others stacked), so the editor makes each change one's own (`layout.js`):
`sideLike(lay, from, to)`, a drag to the side across moving each block to the side across from its own (a mirror: the
wide panels to the left, the stacked bands to the top), a drag to a side beside moving each there; `scaleBlock(lay, own,
was, now, lean)`, a change of size or slant measured against the dragged block's size (`blockValues()`) and made in each
one's, so a panel a third wider makes a band a third deeper rather than giving it the panel's share of the width.
`takeExtras(layers, extras, keys, was)` takes the editor's elements back off its layers as `takeParts()` takes a part,
and `newExtra(kind, id, n)` is one as the editor adds it (near the middle, the n-th of its kind a little further on).
`newBlock()` is a new preset's block: each orientation in the layout it is given by default (`orientDefault()`, see
5.2: as shipped, wide Split, the preset's default, tall Stack and square Banner, each with its size and slant), an
orientation drawn as the default having no entry of its own; `newPreset()` is a new preset, that block and every part of `LAYOUT_PARTS`
shown at every size where the template puts it (the channel name and graphic too, which a new design leaves out), the
words of each of `COLUMN_PARTS` in a line.

`normalizeLayouts()` keeps 24 at most (`LAYOUTS`), their ids as they are (unique, never `keep`: Surprise me's chances
name them), names trimmed to 40 characters, `orient` and `by` as a profile keeps its `layoutBy` but by orientation and by
any size key (a preset is for every profile), `custom` as size keys between 64 and 8192, each once, 12 at most, each part
it has an entry for (shown unless it says not), its numbers within range, its per-size keys only size keys, `hide` only
size keys and only for a part shown, `vertical` only of `COLUMN_PARTS` and only true or false; `extras` in order, 8 at
most (`LAYOUTS.extras`), one of an unknown kind let go, an id kept unless missing, taken or a layout layer's, placed as a
free layer by size keys only, `vertical` only on a text one, `sticker` only on a vector one (an id; `EXTRA_STICKER` when
none), left out when there is none. A part it has no entry for is not made up: a preset made now carries all eight
(`takeParts()`, `newPreset()`), and one made before the colour block or the brand logo was a part carries none for it, which `putLayout()`
then leaves as it is (its move, whether it shows) — the editor shows it where the template puts it, switched on, and the
preset carries it once saved there. `vertical` is the field earlier presets kept only when true and that was let go for a
while; a preset kept since says nothing of it, which `putLayout()` takes as leaving the layer's own (the editor shows such
a part in a line, and the preset says so once saved there). What an earlier preset holds still applies as it did (a Banner block included, which the
editor offers no more but draws, and keeps slim when moved between top and bottom). Their chances are
`surprise.odds.groups.layout` ({keep, id: chance}); `normalizeSurprise(raw, ids)` keeps them only for the presets there
are, so a preset deleted takes its chance with it.

Other files: `assets/<id>.json` (My assets: images as data URLs, AI assets as specs; either may carry `folder`, the id of its folder), `asset-folders.json` (the folders of My assets, `[{id, name}]`, checked by `normalizeFolders`; an asset whose folder is gone counts as unfiled), `fonts/<name>.font` (imported
fonts), `photos/<pid>` (pictures, originals and masks; see 6.3), `photo-library.json` (the photo shelf, the bitmap library: `[{pid, name, kind, at}]`, `kind` being `upload`, `ai` or `repaint`, newest first, checked by `normalizeLibrary`), `ai.json` (AI connection settings including the token; never exported with
profiles or projects), `lookcards/<look>.json` (the Look sheet's card pictures, kept from one launch to the next: `{sig,
src}`, see 9.5) and `outlines.json` (the glyph outlines, kept likewise: see 6.2).

A **profile file** (`.smedprofile.json`, version 3): `{app, kind: "profile", version, profile, assets, fonts}`; a whole backup adds `covers` (`{channel id: cover}`), `photos` (`{pid: {src, original, mask}}`) and `channel` (the one it was on). `exportProfile()` writes it, `profileActions.import()` reads it: always a new profile (a new id, the same channel ids), its covers checked by `channelCover()` and written under `covers/<new id>/`, the pictures into the photo store and the library.

A **project file** (`.smedcover.json`, version 4; opened and saved from the ⋯ menu's *Project file*, or with ⌘O and ⌘S — Ctrl off the Mac, ⌘S even while typing — where the host can save or download a file, `CAN_PROJECT`): `{app, kind: "project", version, profileName, profile, catId, cover, photos, assets, fonts}`. Opening one (`projectActions.open()`, which picks the file and has `openProject(raw, ask)` open it, asking only through `ask`): with a profile of that id here, it goes to that profile and channel `catId`; without, `askProjectProfile()` asks whether to import it as a new profile or put it into the current one; version 3 and before have no `profile` and open on the channel on the canvas. `commitHistory()` runs first, so it can be undone.

Both carry the user's assets they use (`embedAssets`) and imported fonts (`embedFonts`: those a layer's `font` names that are in `S.importedFonts`; `adoptFonts` installs the ones this computer lacks, into `fonts/`).

## 4. The layer model (`layers.js`)

A cover is an array of layers, bottom first.

| Kind | Types | Notes |
|---|---|---|
| Layout layers (`bound` in the code) | `bg` `accent` `graphic` `catname` `tag` `brand` `logo` `subtitle` `title` `frame` (their default order, bottom first: `BOUND_TYPES`) | Exactly one of each on every cover. Their content comes from elsewhere (the title text, the channel's graphic, …). They cannot be deleted; the `id` is the type name. All but `bg` and `frame` can be copied (`COPYABLE`). |
| Free layers | `asset` `text` `photo` `solid` | Assets, text, photos and blocks of colour added by the user; can be deleted and duplicated. An asset may carry `ink` (a vector asset's colour of the user's, over its own and the channel's), `crop` and `weave` (as a photo's, see 6.3); a block carries `color` and is the canvas's size at scale 1. |
| Copies of layout layers | a type of `COPYABLE`, with `copy: true` | Made by duplicating a layout layer; the user's, as a free layer is: can be deleted, renamed and duplicated. |

`normalizeLayers()` repairs a layer list: it drops unknown layers, puts back missing layout layers,
keeps the background at the bottom and makes ids unique. A layer the user added (`isAdded()`: a free
layer or a copy) may carry `name`, the name the user gave it in the layer list (`layerName()` prefers it;
without one the name comes from the type and content, a copy's from its type: "Title copy",
`layer.copyOf`). The interface's buttons do not follow the cover's look.

**Copies of layout layers**: `duplicate()` copies a free layer, or a layout layer of `COPYABLE` as a copy
of it: a layer of the same type with `copy: true` and an id of its own (`normalizeLayer()` gives one that
reads a layout layer's id, or none, a new one, so a copy is never taken for the original; a layout
layer's `off` is not read on it, and `duplicate()` brings in a copy of a part left out). It shows what the
original shows — the title's words, the subtitle, the tag, the brand row, the logo, the channel name, the
channel graphic, the colour block — in a style and a place of its own, placed as layout layers are (an
offset from where the template puts the element, `resolve()`) and nudged by 0.03 when made. It is the
user's: `isAdded()` (free layers and copies) is what can be deleted (`isRemovable(layer)`, which takes the
layer now), renamed, carried by *Copy from another channel* and dropped by *Empty this cover*; `isLayout()` (a layout
type, not a copy) is what the layout's order (`layoutOrder()`, `orderLayout()`), *Which parts show*
(`partsBox()`), *Hide every layout part* (`layoutLayers()`) and *Reset the layout parts' places* go by. The layer list
marks a copy *Copy* after its name, as it marks the layout's own *Layout* (`layerKinds()`). Whatever looks for
the layout's own title, subtitle, logo or graphic looks by id (a layout layer's id is its type), not by
type: `subtitlePlan()`, `partsOf()`, `env.hasBrand` and `env.logo` in `render.js`, `titleLayer()`,
`graphicTop()` and `keepClear()` in `looks/kit.js`, `dealCover()` putting the title on top. A copy
of the subtitle shows where the subtitle goes while the subtitle itself is hidden or left out
(`subtitlePlan(…, hidden)`, the title making no room for it), and a copy of the logo where the logo goes
while the logo is hidden (`PAINT.logo` takes `logoBox()` itself).

The default order changed once (it was `bg accent graphic brand title tag catname frame`; files from before the
brand logo and the subtitle get `logo` and `subtitle` put in above `brand` as they are read, as any missing
layout layer is put back after the nearest one before it):
`reorderLayout()` puts a design or cover still in the old default order into the new one, each layer the
user added (a copy too) going with the layout layer it lay directly above. The app does it once per profile, in `loadCovers()`
(the profile then keeps `layerOrder: 2`), since someone may later put the old order back on purpose.
In the same way a new cover comes with the tag `EP.01`, and the covers made before that and never touched
(the placeholder title, no tag) are given it once (`tagged: true`), so a tag emptied later stays empty; and
a placeholder subtitle (`subbed: true`).

**Layout parts left out**: a layout layer but the ground may carry `off: true` (the Layout sheet's *Which parts
show*, `partsBox()`, a switch per part): it is then hidden, and the editor leaves it out of the layer list, the 3D view
and *Hide every layout part*; switched on again it is back, and shown (`visible`), even if its eye had hidden it before. *Empty this cover* keeps what the cover leaves out
and what it has. A new
design leaves out `DEFAULT_OFF` (the channel name and graphic): `normalizeLayers()` puts those in left out
when it puts back missing layout layers, which for a new profile is all of them; a profile's design and its
covers still on the placeholder title were made to leave them out once (`lean: true`, in `loadCovers()`).
The parts are stacked in the layer list's order: a row of the Layers sheet dropped on another goes directly above it
(`moveLayer()`). When that changes the order of the layout's own layers (`layoutOrder()`), the profile's design takes
the new order too (`orderLayout(S.profile.design.layers, order)` in `restack(id, to)`, which `layerRow()`'s drop
calls), so a new channel's cover and *Empty this cover* stack them so, as the old Layout parts list did; the cover and
the design are one undo step (one `touch()`). *Bring forward* and *Send backward* (`shiftLayer(dir, id)`, the selected
layer unless told) change this cover alone; *Duplicate* is `duplicateLayer(id)`, likewise. `orderLayout(layers, types)`
(bottom-first types, the ground first; each layer the user added going with the layout layer it lies directly above)
puts a whole cover or design in an order of types; `reorderLayout()` uses it for the old default order.

**The brand logo**: `brand.logo` in the profile is the id of an asset of the user's (uploaded in Settings →
Brand & channels or in the logo layer's properties, both `logoControls()`; so it travels with an exported profile: `usedUserAssets()` names it). The `logo` layer draws it at
the right end of the brand row (`logoBox()` in `render.js`: right-aligned `LOGO`-sized, centred on the row,
72 units in from the edge or a look's `logoInset`); the brand row's rail, or its number tag, stands to its
left, and a look's own things in that corner move aside (`besideLogo()` in `looks/kit.js`; `env.logo` is the box,
null when the layer is hidden or there is no logo). A `brand.logo` that is a picture's data URL rather than an id is drawn
as that picture (`pictureOf()`, decoding it once): the layout editor's stand-in logo (see 9.4). `brand.counter` (false by default) says whether the brand
row shows the channel's number after `brand.unit`, and the number tag on a colour panel.

**The subtitle**: its words are the cover's (`cover.subtitle`, beside `title` and `tag`); the `subtitle` layer
is a headline like the title (`HEADLINES`: its effect, colours, outline and shadow, plate, font, look
effects; no clipping mask). Before the layers are painted `subtitlePlan()` in `render.js` works out where it
goes (`env.sub`, null when it is hidden, left out or empty), in the faces the title is set in:
`subtitleFit()` in `title.js` sizes it from the title as it would be alone (`subtitleSize()` in `layout.js`:
0.4 of it, kept between `SUB.min` and `SUB.max` of the shorter side), and the title keeps `reserve` free
at the foot of its box (`drawTitle`'s and `titleBlock`'s `reserve`), the two centred together, the
subtitle a gap under the last line. Where the reserve would set the title below what reads in the feed
(`titleFloor()`), the subtitle is made smaller first, down to `SUB.min`; and it is never more than
`SUB.most` of the title as finally set. `ink` is the block its words fill. When the title or the subtitle
is set in columns (`columned()`, see 6.1.1) `subtitleColumns()` places it instead: both in columns, a column
left of the title's, a character lower, the title handed a narrower box (`titleBox`); the title in columns
and the subtitle in a line, the line under the columns, which keep `reserve` free; the title in a line and
the subtitle in columns, its columns right of the title's block, from its top, the title's box narrower by
them (`titleBox`). The title's columns stand in the look's own place for them (`columnBoxOf()`: the
woodblock book's `songBox()`, by the seal and down to the band), else in its box. Looks' backgrounds keep
clear of both (`titleArea()` in `looks/kit.js` takes the subtitle's `ink` in). A hidden subtitle is still placed
(`env.subHidden`, the title making no room for it), so the 3D view can show it.

**The title as lettering**: the title has what a text layer has. It may be clipped (below), and carry look
effects (`FX_TYPES` includes it; `effectsFor` and `layerEffects` offer it what a text layer is offered); its
properties edit `cover.title`, which the Content sheet edits too.

**Clipping masks**: a free layer (and the title) may carry `clip: true`, and then shows only within the shape of the
layer below. The layer it is clipped to is its *base*: the first layer down not itself clipped
(`clipBase()`), never the ground (which covers the canvas, so a clip onto it is none: -1);
`clipEnd(layers, i)` gives the last layer clipped onto layer i. Several in a row may share a base.

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
  - Layout layers (and their copies): `x`, `y` are an **offset** from where the template puts the element; 0 by default.
  - `s` is the overall size, `kx` / `ky` stretch horizontally / vertically, `r` is degrees.
- **`t.by` is per-size fine-tuning**, keyed by size (`"1920x1080"`), in virtual pixels, applied on top of `t.all`.
- **The channel graphic** can also be tuned per channel, under `"1920x1080@<channel id>"`, because graphics differ a lot in shape.

`resolve()` combines the two into the final placement: positions add, scales and stretches multiply,
angles add. `adjust()` is the single entry point for every edit: dragging, handles, the wheel and arrow
keys all express a change as a patch (the properties have no placement sliders, only *Reset placement*), which is written to `t.all` or `t.by` depending on
the current scope (`settings.scope`; every start begins at the one the defaults give, `settings.scope` in `defaults.json`,
`orient` as shipped, whatever it was when the app closed: `startScope()` in `store.js`, set in `start()`), which has three
choices:

- `all`: `t.all`, for every size.
- `size`: `t.by` of the size on the canvas.
- `orient`: `t.by` of every size facing the way that one does (its `group`, `[{key, vw, vh}]`, which `frame()` in
  the app hands over with the size), each moved as far across its own canvas as the patch moves across this one
  (`ddx · vw′ / vw`), scaled, stretched and turned alike. `orientOf(w, h)` in `layout.js` is what a size faces:
  `wide` above 1.1 : 1 (5:4 is), `tall` below 0.91 : 1 (4:5 is), else `square` (`ORIENTS`); the scope under the canvas names
  the middle choice after the group of the size shown (*All wide*, *All square*, *All tall*).

`resetPlacement()`, `moveScene()` and `resetScene()` take the same three, the group's size keys passed in, and so
does the layout (see 5.2). In scope `all`, `resetPlacement()` puts a layer back where it was put on: a layout part
where the layout puts it, a layer that was added in the middle at the scale it is put on at (`newLayer()`'s, a sticker
`STICKER_SCALE`, 0.3, as `addAsset()` puts one on), a photo filling the canvas filling it still (`s` 1) — the editor's
Reset under a layer's properties and an agent's `place_layer` reset alike (a linked cut-out, whose Reset the editor
hides, goes back over its photo there: `alignedT()`).

### 4.2 Lettering colours and headline layers

Layers made of words (`LETTERED`: `title`, `subtitle`, `tag`, `catname`, `brand`, `text`) may carry `ink`, their own
lettering colour, and all carry `vertical` and `rules`, set in columns and ruled (see 6.1.1). The title and text layers (`HEADLINES`) are one kind of thing: both may also carry
`hi` (the highlighted words' colour), `stroke` and `shadow` (outline and shadow strengths), `plate`
and `plateInk` (a plate and its colour), `hiPlate` and `hiPlateInk` (plates under the highlighted words
alone, drawn in the look's way and coloured by `headline()`, the words on them then in what reads
there; a look that boxes the highlighted words itself — cyberpunk, net art — is told so by `o.hiPlate`
and does not) — or instead `hiMark` (`HI_MARKS`: a ring drawn round them, a marker's band, an offset
block; `drawMark()` in `render.js`, under the letters or over them as the kind is, seeded per run so it
holds still; through a band or on a block the words keep the lettering's colour, and the looks are told
by `o.hiPlate` as under plates), `fx`, `fxAmt`, `fxSeed` (the seed *Reshuffle* deals, for a `seeded` effect, see 6.2), `bend`, `bendAmt`, `warp` and `reshape`; a text layer only adds `text`.
The user's own layers (text, asset, photo, solid) may also carry `lookFx`, look effects (see 7.4).
Without a colour the look and the channel colour decide; on a plate, an unset lettering colour is the
one that reads against the plate. `headline()` in `render.js` turns these rules into one set of
colours shared by the title and text layers, from which every look's lettering takes its colours; on a
plate it also hands the highlight as `hi` (RGB) to looks that colour letters themselves, so they do
not paint in the channel colour on a plate of the channel colour.

A text layer's earlier `color` (white, channel colour, ink, custom) is converted in
`normalizeLayer()`: white becomes automatic; ink and custom become `ink`; the channel colour stays
as `color: "accent"` until a colour (or automatic) is chosen; on a plate the old colour becomes
`plateInk`, and without `stroke` / `shadow` fields both are 0, as before.

### 4.3 Channels a layer belonged to, in earlier data

A free layer used to be able to carry `cats`, an array of channel ids, and then showed only on those
channels. Now that each channel has a cover of its own the field matters only when earlier data is
read: `normalizeLayers()` still checks it (removing channels that no longer exist, and a layer left
with none), and `channelCover()` keeps a channel's layers by `appliesTo(layer, catId)` and drops it.
A profile's default design may still hold it, and is treated the same way for a new channel cover.

### 4.4 Layers shown at some sizes only

Any layer but the ground may carry `sizes`, a list of size keys: it then shows only at those of the profile's sizes
(`inSize(layer, key)`), and at the others is as if left out. Without it a layer shows at every size; with an empty
list, at none.

- **Kept clean**: `normalizeLayer()` (through `normalizeLayers(raw, catIds, sizeKeys)`, which `normalizeCover()`
  and `normalizeProfile()` call with the profile's size keys) keeps size keys each once, only the profile's, in its
  order; a list of every one of them is none at all (so the layer shows at a size added later), and one left with
  none stays, empty: unlike a channel, a size gone does not take the layer with it. `keepTo(L, keys, all)` sets a
  list, every size being none. A size added or removed in Settings → Sizes & export (`toggle` in `sizesTab()`) keeps the lists of the
  design and of the cover shown to the sizes there are now at once, as reading them again would (`refitSizes(layers,
  all)`), both in that one step of undo; another channel's cover read so far is refitted when it is next shown
  (`coverFor()`), not written meanwhile, so the step undone leaves every channel as it was, and nothing waits for the
  app to be opened again.
- **From another profile**: *Copy from another channel* runs the copies through `channelCover()`, so they keep the
  sizes this profile has. A size key is exact pixels, though, so a layer kept to 1920x1080 in a profile whose 16:9 is
  1280x720 would be at no size: copied from another profile (and a project opened into the current profile, its
  cover's layers before they are read), `acrossSizes(layers, from, to)` first puts what each keeps by size on the
  sizes here that take the place of those there. `standsFor(key, from, to)` in `layout.js` says which: the size
  itself where that profile has it; else those it has, and this one has not, of the size's ratio; else, where there
  are none, those facing the size's way (`orientOf()`) of a ratio no size here has. A layer's list becomes the sizes
  standing for one in it (none of them: every size rather than none; an empty list stays one), and its `t.by` goes the
  same way, a move as far across each canvas (`virtualSize()`), a size that profile alone has dropped, a channel's own
  (`<size>@<channel>`) alike. `style.layoutBy` is not carried so: a profile imported brings its sizes with it, so its
  own layouts are keyed by them already.
- **Drawn**: `coverAt(cover, key)` in `render.js`, at the start of `paintCover()`, hides a layer not at this size on
  a shallow copy of the cover and leaves a layout layer out there (`off`), so whatever looks at which layers show
  needs nothing of its own: `partsOf()` (the room of a part left out goes to the others, see 5.2), the background
  photo and the theme, the brand row, the subtitle's plan, the lettering a cut-out weaves with, the ransom note's
  photo, the hits. Exports, thumbnails and Surprise me's quick drawings (`dealPlaces()` places a layer by the sizes
  it shows at, those it has hits at) follow. In the app, `mainPhoto()`, `letterPhoto()` and the 3D view's sheets
  (`here3d()`) ask the size on the canvas.
- **Edited**: the properties' Layer group has *Shown at* (`sizesControl()`): a button per size by its ratio, lit where
  the layer shows (the last lit stays), and every size or each orientation's at once. The layer list greys a row not
  at this size (`away`) and labels one with a list (`sizesNote()`, `sizesSaid()`: *Only 3:4*, *Only tall*, *Not
  9:16*, *At no size*; an orientation is named when the list is all of its sizes and more than one). A base hides what
  is clipped onto it (see *Clipping groups* in 6), so a layer clipped onto one not at this size is greyed too, its
  title saying why (*Clipped to Photo, which is not shown at this size*), and its *Shown at* dashes the sizes its base
  is not at, with a line under them (`sizes.base`).
- **Cut out at some sizes**: with the scope at one size or one orientation (see 4.1), *Cut out subject* gives the new
  linked cut-out the sizes `sizesFor(photo, keys, all)` (`cutSizes()`: those of the scope where the photo shows; where
  it shows at none, the scope's; `cutOut(L, keys)`, `cutSizes()` and `cutSource()` take the scope's keys unless given
  others), or puts the photo's cut-out there too when it has one kept elsewhere. Where the photo does not show at
  those sizes and a photo of its picture does — the copy *Remove the background* left there — the cut-out is
  that one's (`cutFrom(layers, photo, keys, all)`), not linked to a photo hidden there. *Remove the background* calls
  `cutAt(layers, photo, keys, all)`: where the photo shows at no other size it is cut itself; else `showApart()` shows
  it at those sizes through a copy of it (`duplicate()`, placed back exactly where it is), cut, the photo keeping the
  rest, and takes what goes with the photo along, so those sizes keep what they had and the others do not change at
  all. The copy goes in above the photo and what is clipped onto it: in between, it would become their base, and hide
  them at the other sizes, where it is hidden. What is clipped onto the photo is copied onto the copy; the photo's
  linked cut-out is copied and linked to the copy (`of`), so there the cut-out follows the photo that shows, dragging it
  moves that one, and Surprise me moves the two together (`dealPlaces()`); what is clipped onto the cut-out goes
  with its copy in turn. A layer shown at those sizes alone goes over whole rather than being copied (clipped onto the
  copy, or linked to it), and one shown at none of them stays. The originals are kept to the other sizes, but a
  layout layer (the title may be clipped): it is copied as a copy of it (`copy`) and left at every size, its room
  being the layout's, hidden at those sizes all the same, as its base is. A weave with lettering so copied follows:
  a cut-out or an asset at every size weaves with both (at each size one of them shows), a copy with the copy, an
  original with the original. Both say where (`toast`), and the Cut-out group says which sizes the scope reaches.

## 5. Layout (`layout.js`)

### 5.1 The virtual canvas

All geometry is computed on a "virtual canvas" whose short side is always 1080–1200 units, whatever
the real pixel size. `virtualSize(w, h)` gives it: 16:9 is 1920×1080, 4:3 is 1600×1200.

This lets type sizes, line weights and gaps be written as fixed numbers that keep their proportions
from 900×383 up to 8K. Drawing then needs one overall scale on the canvas.

### 5.2 Adjusting and swapping

A template's layout is not used directly: it first goes through `adjustLayout()`, which takes the
adjustments kept in the profile — how much the colour block takes (`size`), how far the dividing
edge leans (`slant`), the title box as fractions of what the template gives it (`tw`, `th`), and
whether the halves are swapped (`flip`). All are fractions of the picture, so one setting suits
every size. It serves both families of template, slanted and level, because it only reads and
rewrites the geometry of a finished layout and does not care how that layout was computed.

A swap is more than a mirror image: with the band on top, the brand row lands on it, the title's
box moves below it, and the channel name and tag are rearranged. The layout it returns therefore
carries a few flags (`brandOnAccent`, `railOnAccent`, `titleTop`, `flipped`) that drawing uses to
change colours and positions.

Then `meetStandards()` holds the result to the cover standards (docs/cover-check.zh-CN.md), whatever the
look; a colour block the user resized or tilted stays where they put it (so a drag of its handles is not
undone on the next frame), and so does one a default layout gives a size and slant (below): the bands of the tall and
square sizes' defaults, 14% and 13% of the height, are too slim to hold the channel name, which the words' foot then
keeps above them; there it is lettered in the channel's colour, outlined, as off the band (the `catname` painter in
`render.js`: a name that does not lie wholly on a colour block shown, both as placed, is lettered so by
`drawCategory()`; its plate stays as it is). On a cover the apps lay badges over (16:9, 4:3: `badged()`) nothing with words
in it, nor the graphic, reaches them (`FOOT` in `platforms.js`, 84% down): the channel name puts its
sub-name beside it and moves up, and a colour block too shallow to hold it there grows (taking the tag,
the graphic and the title's foot up with it). On every cover the words keep out of the bottom 14%, where the
apps show plays and views (`wordsFoot()`: the badges' line on a badged cover, else `WORDS_FOOT` in `platforms.js`,
86% down): the channel name, the tag and the title's box stay above it. The title's box keeps room for two lines at the type size
the narrowest feed showing that ratio needs (`feedOf()`; 14 px in the feed), the block giving way while it
still holds the name, and with a subtitle (`parts.subtitle`) room for its line too. On *Stack* with the block along the foot the graphic, the cover's picture until a photo comes, takes at least 12% of
the canvas (`ART_HALF`, half the box a graphic is drawn in); on a landscape cover it first slides right, and
what it would still cover gives way: the title's box (narrower, or on other covers shorter), the channel
name's width. The tag stays clear of the name, the title of the tag. It is told which of the parts that
take room the cover has (`partsOf()` in `render.js`: not left out, a graphic only for a channel that has
one, a subtitle and a tag only with words), and gives the room of one left out to the others: with no tag the
title gives way to none; with no channel name the block along the foot slims
down as far as the tag on its edge (if there is one) stays above the words' foot and the block keeps `BAND_MIN` (16%) of the height,
or on *Split* (or a swapped *Stack*) the tag drops to the name's place, the title's box growing either way;
with no graphic the title gives way to nothing, and *Split*'s panel narrows to `SIDE_BARE` of the width
(13% on a portrait cover to 25% on a 16:9 one), the title's column taking the room. A test runs every look,
template, ratio and swap through it, with every part and with the new cover's; another holds the new
cover's title box, with its subtitle, to A1.

The diamond handles on the canvas get their positions from `layoutHandles()`; while one is dragged,
`dragLayout()` turns the pointer position back into an adjustment. A swapped layout is first
converted to unswapped coordinates, so the handles follow the pointer either way.

**Each size's layout.** The template and its adjustments are one per profile (`style.template`, `style.layoutAdjust`
of it), which every size follows, unless a size has a layout of its own: `style.layoutBy` = `{ size key: { template,
adjust } }`, as a layer's `t.by` lies over `t.all`, except that it replaces rather than adds. `layoutOf(style, key)` in
`layout.js` is the one place that answers which `{ template, adjust }` a size is drawn in, and everything that lays a
cover out asks it: `paintCover()` (through `coverLayout(look, lay, w, h, parts)` in `render.js`, which is `L.layout`
or `layout()`, `adjustLayout()` and `meetStandards()` in a row, and which the colour block's sliders use too, to start
from the layout as it would be drawn at the size shown: with the parts the cover has there, `coverAt()`, a part kept
to other sizes left out), the canvas's diamonds, the colour block's *Size & slant*, layout presets
(`takeLayout()` takes the block at each of the profile's sizes, `putLayout()` puts it there, see 3), the caption of each hand in Surprise me's window (`handSays()`). Hence thumbnails, exports, the 3D view and the cover
standards follow it with nothing of their own. `ownLayout(style, key)` says whether a size has its own;
`setLayoutOf(style, keys, lay)` writes one: `keys` null, the profile's own (the template chosen, its adjustments,
the other templates' kept), else each size of `keys` as its own; `followLayout(style, key)` lets a size's own go
(`layoutBy` itself goes when it is empty, so a profile that never had one is saved as before).

The scope decides where a change of layout lands, as it does for a placement: `all` the profile's own, `orient` each
size facing the canvas's way (the layout the canvas's size is drawn in, as it is now, put on each), `size` the
canvas's size. The colour block's *Size & slant* (`blockSection()`, a group of its properties, so on its bar too) holds
the template itself, named for the block (*Block position*: *Band* `stack`, *Side panel* `split`, *Slim banner*
`banner`, `tpl.*` and their tips `tpl.*Tip`; one picked is one step of undo, and starts from the adjustments the
profile keeps for it, else its defaults, as the template box's list does), *Mirror* under it
(the `flip` adjustment, the template box's swap, a switch through `layoutAdjuster()`'s `set()`: a band or a slim
banner along the top, a panel on the left; its tip `props.blockFlipTip.<template>`; one step of undo), the template's two block sliders,
how much the block takes and how its edge leans, as scrub bars whose tick is what the template has by default
(`templateDefault()`; the template box's are `blockSliders()`, over `layoutAdjuster()`, which `templateControls()` builds on too) and *Block by orientation* (`byOrient()`, below), and lands where the Layout sheet's template box does
(`layoutScope()`): no buttons for the scope, its ⓘ saying which sizes it reaches and that it is switched under the
canvas; and, when the size shown has its own layout, *This size has its own layout* with *Follow again* (with `all`
the sliders then change the profile's own, which that size does not follow). A slider dragged draws the cover as a
draft (`draftTouch()`), one step of undo; a diamond let go on the canvas builds the drawer again, so the sliders follow.
The strip marks a size with its own layout (`markStrip()`). The template box itself (`layoutBox()`: the template, the
block's and the title box's sliders, the swap, the way back to the template's defaults, *Block by orientation*) is
hidden for now (`TEMPLATE_BOX` false in `app.js`, its code kept): what of it is still wanted is in *Size & slant*, and
a layout preset changes the template too. A diamond dragged on the canvas changes what the scope
says, but with `all` on a size with its own layout it changes that one: it is the one drawn under the pointer. A
template chosen for a size starts from the adjustments the profile keeps for that template. A size removed in Settings
takes its own with it; `normalizeProfile()` keeps `layoutBy` only for the profile's sizes, templates there are, and
adjustments through the same `normalizeAdjust()`.

**The default layouts.** Each orientation has a layout by default, `orientDefault(o)`, from `layout.byOrient` in
`defaults.json` (its template one there is, its adjustments through `normalizeAdjust()`): as shipped, wide Split with
the panel 0.21 of the width and the edge leaning 0.17, tall Stack with the band 0.14 of the height leaning 0.08, square
Banner 0.13 and level, the title's box 1 × 1 in each. `layoutByOrient(style, sizes)` lays every size out so, in place:
the profile's own layout stays where some sizes' default it is, else becomes the default of the orientation most of
`sizes` face (the first size's on a tie), so that what every size follows is drawn somewhere; each size it does not
draw so is given its default as its own, and every earlier `layoutBy` goes. `normalizeProfile()` does it for a
profile with no `style` at all, a new one (the starters, the full example: `starterProfile()`, `sampleProfile()`, the
welcome dialog and *New* under *This profile*); a profile that has a style is drawn as it was, and for it
`layoutByOrient()` is *Block by orientation* in the colour block's *Size & slant* (`byOrient()`), one step of undo.
A size added in Settings → Sizes & export (`toggle` in `sizesTab()`) goes through `layoutAdded(style, sizes, key)`:
drawn as the profile's other sizes facing its way are, where they are all drawn alike, else in its orientation's
default, as its own where that is not the profile's. A template's defaults, `templateDefault(template, o)`, are those
of the orientation whose default it is (`o`'s first): the Layout sheet's *Restore this template's defaults* puts them
back (and is off while they are what it has), a template chosen there with no adjustments kept for it starts from
them (`templateControls()`, the canvas's orientation first), and the preset editor's *Reset size and slant*
(`resetBlock()`) puts back their size and slant, its side and title's box kept (`blockDefault()`). The layout layers' places are offsets from where the
template puts each element, so a size drawn in another template takes its title, tag and the rest with it.

### 5.3 Templates

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

1. Work out the virtual size, set the canvas's real pixel size and scale the context once. Take the cover as it is at this size (`coverAt(cover, key)`): a layer kept to other sizes (`sizes`, see 4.4) is hidden on it, and a layout layer left out (`off`), on a shallow copy (the very cover when every layer shows at this size).
2. Build an environment: template geometry (in the layout this size is drawn in, see 5.2), channel colour, light or dark theme, background photo and so on.
3. Walk the layers bottom to top, skipping hidden ones and ones that do not belong to the current channel; get the placement from `resolve()` and call `PAINT[type]`.
4. Each painted layer leaves a hit record (centre, half-width, half-height, angle; for a layer cropped free, its shape too, `poly`) in `canvas._hits`.
5. If a selected layer is given, draw its outline and handles last.

Two helpers keep transforms consistent:

- **`placed()`** is for bound layers. Their paint function returns the rectangle it occupies; it is first run on a throw-away context to measure that rectangle, then painted for real, translated, rotated and scaled about the rectangle's centre. Scaling and rotation therefore always pivot on the content, and the result never depends on a previous frame.
- **`centred()`** is for assets and free text, which already draw around their own centre.

**Opacity**: a layer below 1 is painted onto a scratch canvas and blended in as a whole, so
overlapping strokes inside the layer do not show through each other.

**Clipping groups**: when `paintRange()` reaches a base with layers clipped onto it (`clipEnd()` beyond
itself), it paints the group on its own: the base on `clipGround` (with its own opacity and effects),
each clipped layer on `clipOne` and laid onto `clipGround` with `source-atop`, then the group onto the
canvas as one. A hidden base hides the whole group. A drag counts the group as moving together (see
9.3), so the kept runs never cut one apart.

**Scene objects**: before the ground is painted, `setScene()` hands the look this cover's offsets of its
objects at this size (`sceneOffsets()`); after, `scenePlaced()` gives where each was painted, of which
those the look declares in `scene` are kept in `canvas._scene` and drawn as round handles with the
background selected (`drawSceneHandles()`; `sceneHandleAt()` finds one). A drag frame that does not
repaint the ground keeps the last.

**Preview and export share this code.** The main canvas is painted at the size of its display area,
thumbnails smaller, exports at size × scale.

### 6.1 Title (`title.js`)

Titles never wrap. `parseTitle()` splits the text into lines and, at asterisks, into plain and
highlighted runs. The type size is the largest at which the longest line fits the width and all lines
fit the height. Outline and shadow are several passes: the offset shadow, the ink outline, then the
fill.

`setLine()` sets a line as a typesetter would set a CJK title, into pieces — the runs cut where the
script changes or a squeeze moves what follows — each with its place, width, scale and drop. In a block
with CJK in it, Latin letters, digits and ASCII signs are set larger, their capitals `LATIN_TO_HAN` (0.86)
of the ideographs' ink height, and moved to be centred on them; both heights are read off the font with
`measureText` (`metricsOf`, kept per font), so the factor is about 1.12 for Bebas Neue beside Noto Sans SC,
1.05 for Noto's own Latin and 1.25 for Songti's. CJK punctuation is squeezed in the Kaiming style: a
full-width mark is half ink and half blank, which half read from its ink (`markInk`); within a line 。？！
keep their width and the others give up their blank side to half an em, keeping as much as they have on
the ink side; at the line's start and end the outer blank goes; of two marks in a row at least half an
em between them goes, from each blank as it has. Each piece keeps the blank it gave up (`lt`, `rt`), so
the runs' extents (`runs`, and each piece's `run`) are where their lettering lies. Characters are taken as
one reads them (`Intl.Segmenter`: an accented letter, a keycap stay whole); full-width Latin is
CJK-sized already and left alone; the metrics are kept per font and per fonts loaded, so a font that
arrives late is measured again. `fitLines`, `drawTitle` and the free text layers measure and draw through
it, so the size fits the set line. `passOf()` is the `pass` handed to the lettering: a piece set larger
or lower is drawn while `fillText`, `strokeText` and `measureText` are wrapped on the canvas prototypes
to draw it in a font that much larger, that much lower (by the font's size, not a transform, so a
gradient across the run or an outline's width stays as it is), so every lettering — the looks' work
canvases and the bent lines' canvases included — sets it the same way without knowing; a lettering that
draws after the pass (the deco look) uses `inPiece()`; the outline effects, which draw paths, take the
piece's scale and drop themselves (`glyphShapes`). What marks a whole run — the plates under highlighted
words, the cyberpunk and negative looks' boxes, the collage's paper strips, the rave, chrome and
spectrum gradients — is drawn once a run (at its first piece, over `run`), not once a piece. Without real
metrics (the tests' stand-in contexts) a line is set as the canvas sets it. A column is set by
`setColumn()` (6.1.1).

### 6.1.1 Columns

Every lettered layer (`LETTERED`, copies too) carries `vertical` and `rules`, false unless true
(`normalizeLayer()`), kept in the design and the covers. `columned(L)` in `looks/kit.js` says whether a layer is
set in columns: its `vertical`, or for the title and the subtitle the look's own default (`columns(p)`: the
woodblock book's *Set the title vertically*), which a layer's `vertical` cannot turn off — while it is on the
properties show *Vertical* chosen and greyed, and the bar over the canvas its button (`columnsByLook()` in `app.js`). Surprise me deals neither:
`dealCover()` leaves them as they are (but for the `vertical` of the title, subtitle, tag and channel name, which a layout
preset it deals carries, see 3) and deals a layer in columns no bend, nor a lettering of `NO_COLUMNS`.

A column is set as a line turned a quarter turn clockwise, so it reads downward. `setColumn()` gives its
pieces as `setLine()` gives a line's, each with its place along the column: a character standing upright
(`standsUp()` in `textfx.js`: Han, kana, hangul, full-width forms and CJK punctuation but the brackets, quotes,
dashes and ellipses, emoji) a piece of its own centred in a cell `GAP` (1.06) ems long; a run of Latin letters,
digits and signs (a space inside it with it) one piece, `AIR` longer than it, set larger beside CJK as a line
sets it (`LATIN_TO_HAN`), moved across (`dy`) so its capitals' middle is the column's; a bracket, quote, dash
or ellipsis a piece a cell long, its ink's middle moved onto the column's; a space a third of an em. `mid` is
where the column's middle lies from the line's baseline: the middle of an em, the middle of 国's ink
(`emMiddle()`). The pieces' text is the line's, in order, so `letterCells()` gives a column the keys a line has
(`letterKey`), whichever way the layer is set: the ransom note's letters dressed by hand and a weave's letters
in front follow a letter from lines to columns and back.

`drawTitleVertical()` fits the columns into a box (`fitColumns()`: the longest as high as the box, all of them
as wide, `blockWidth()`: a pitch, `PITCH` 1.32 ems, a column, less the last one's air but for its rules), or
takes `st.fs` as it is (a text layer's 120, its block about its centre), and stands the block at the box's
top left; `titleBlockVertical()` measures it without drawing. In the block's turned frame it paints the plate,
then (`st.rules`) the rules (界行: a hairline at either side of every column, `st.fill` at 0.32 alpha), then each
column as `lineOf()` paints a line of `drawTitle()` — the highlighted runs' plates and marks, `paintRuns()`, the
marks over — with `frame.c` 0, the line translated so the column's middle falls where its em's does, under
`inColumn()`; `env.only` keeps it to some letters by `someLetters()`, a column counted as a line. Its box takes
in the plate and what the effect throws past the type (`effectReach`), and its `fs` is the size of its
characters, which the cover standards read (`typeSize()` in `check.js`). There is no bend: `bendOf()` gives
none for a layer in columns, `layoutHandles()` no handles, and the Bend group a note in its menu's place
(the bend is kept, for lines again).

`inColumn(ctx, run)` in `textfx.js` turns the upright characters back wherever they are drawn while `run`
runs: like `larger()`, it wraps `fillText` and `strokeText` on the canvas prototypes (and on ctx itself when it
is no canvas, a test's stand-in), and `columnText()` draws a string's stretches lying on their side as they
are and each upright character turned a quarter turn back about the middle of its em where it would stand
(its advance's middle, `emMid()`), 。，、 moved to the top right of their cell (their ink mirrored through the
em's middle, `markShift()`) and ？！：； to its middle across. So every lettering sets a column without knowing:
the looks' `runs()` and work canvases, the masks, the sticker's rims, the ransom note's letters and the
letters cut from the photo, the shapes `someLetters()` keeps letters by. Meanwhile `asColumn()` in `looks/kit.js`
keeps the looks' `upright()` from taking a slant out of a line that has none, and turns `fall(dx, dy)` on: the
light does not turn with the line, so every offset a lettering throws one way — the house shadow, the sticker's,
the looks' drop shadows, depths, long shadows, echoes and inks off register (`echo()`), the ransom note's
shadows and depth, the outline effects' shadows and Extruded's depth, the plates' shadows (`drawPlate()`, the
looks' `plate` and `tag`), the block mark — is given as the page has it, and `fall()` turns it back a quarter
turn in a column, so it falls down and to the right there as off a line. A canvas's own shadow
(`shadowOffsetX/Y`) is the page's already, as is anything offset in pixels (the inner shadow), and needs
nothing. The outline effects draw paths, not text: `glyphShapes()` gives each upright letter a `turn`
(`uprightTurn()`), applied after `SHAPED` has reshaped it, so a melting letter drips down the page; a letter
lying on its side gets a `lie` instead, by which a reshaping that runs down the page (`down`: melting) sees it
as the page has it, so it drips down the column too; the reshaped runs are kept apart from a line's
(`SHAPES`'s key).
 `NO_COLUMNS` is what a column cannot be lettered
with, `paintRuns()` painting the look's own lettering there instead: Row shift (`rows`), which cuts the
canvas into level rows, and a turned line has none.

The small parts — the corner tag (the look's `tag` too), the channel name, the brand row — are painted as
lines and turned whole (`turned()` in `render.js`, for `placed()`): turned a quarter turn about the line's
box under `inColumn()`, plates and rails with them; standing where the line stood, hanging from its top
unless that would reach into the foot the apps lay their counts over (`wordsFoot()`), when it rises from its
foot, at its left end or, in the right half of the canvas, its right, and kept on the canvas; the channel name
unslanted and lettered as off the band (it reaches off it), the brand row without its rail or number tag; with `rules`, a hairline at either side in its lettering's colour (`rulesOf()`).

### 6.2 Text effects (`textfx.js`, `outlines.js`)

The title, subtitle and text layers paint their letters through `paintRuns()`. The
effect is a property of the layer (`fx`); unset means "auto", which leaves it to the current look.
There are four kinds, differing in what they can change:

| Kind | How | What it can change |
|---|---|---|
| Layered | the same line painted several times in different colours and places | what is around the letters: outlines, shadows, echoes. Each look's own lettering (`runs()`) is of this kind |
| Masked | the letters are first painted alone on a spare canvas, which is worked on and then laid down | what is inside the letters: halftone, stripes, wear, an inner shadow, rows cut apart |
| Outlined | each letter's outline is fetched as points, and filled as shapes | the letterforms: extruded with real depth, or their edges reshaped (spiky, torn, scissor-cut, melting, puffed up, eaten away) |
| Letter by letter | each letter drawn on its own, in the place the line's font gives it | each letter's face, paper, ink and angle: the ransom note |

`EFFECTS`, what the Effect group offers (as cards, each the layer's first letter drawn in the effect: `fxCards()`, see 9.5), holds the typesetting effects and the editorial look's Underlined highlight, which has to know the highlighted words and so can only be lettering. Sticker (`sticker()`) is strokes alone — a shadow, a dark line, a white rim and a keyline, each a pass of thick round-joined strokes under the fill — so the rim runs the letters together and fills their small gaps without outlines. An effect may be counted with another group than its kind's (`menu`), which sets where its card comes (`FX_ORDER`, the groups in turn): Extruded, drawn from outlines, goes with the layered letterings it looks like, so the Outlined group holds the reshaped edges. An effect marked `seeded` draws its letters from the layer's `fxSeed`, which *Reshuffle* (shown under the effect for every seeded one) deals again: the ransom note and the reshaped edges but Puffed up. A look's lettering is what *auto* uses. Sliced, Overprint, Double keyline and Sunlit block were in the menu once; what they do is their looks' post effects now (see 7.4), for any layer: `layers.js` still knows the names (`TEXT_EFFECTS`), turns them into the matching post effect on a text layer (at 0.6), and keeps them on the title, painted as *auto*.

**Where outlines come from** — a web view cannot read the outlines in a font file, so the Rust side
supplies them. The `text_outline` command parses the font with `ttf-parser`, flattens curves to
polylines and returns each glyph's outline and advance in units of one em. Fonts are found by name:
bundled fonts (read from the app's own assets), fonts the user imported, then installed fonts.
Variable fonts are traced at the weight asked for, and a character missing from the first font is
taken from the next.

**Asynchrony and drawing** — fetching takes a moment and drawing cannot wait. `outline()` answers at
once from a cache; the first time it returns nothing, sends for the outline, and the effect falls
back to ordinary lettering. When the outline arrives the interface is told to redraw. For an export,
`renderReady()` waits for every request and draws again, so the exported image has the effect.

**Kept from one launch to the next** — an outline depends only on the font and the text, so what arrived is kept in
the data folder (`outlines.json`: `keepOutlines()` gives its text, `{v, sig, at: [[key, glyphs], …]}`, the one used
longest ago first; `keepOutlineFile()` in `app.js` writes it 4 s after the last to arrive). `start()` reads it beside
the other files and puts it in the cache (`keptOutlines()`) before anything is drawn, so the canvas, the look cards and
the 3D view draw with the outlines at once instead of sending for them all again and being drawn again as each comes.
The cache, in memory and on disk, keeps those used last, `OUTLINE_KEEP.max` (8 MB of JSON) at most: a busy cover in
all its looks took some 0.6 MB, and reading 8 MB adds about 40 ms to the start (the file is read while the system's
fonts are listed, and parsed once they are). Only in the desktop app: a server's page cannot tell one version of the
server from the next, and a plain browser has no outlines. An outline whose request failed (a server away for a
moment) is false in memory but not kept, and one that comes for a font let go since (`era`) is dropped. `sig` (`outlineSig()`) is the app's version, the list of fonts installed and the fonts imported with the length of
their files: any of them otherwise lets them all go, as an outline not to be had may be now, or another file be found
for a family; a font imported in the session lets go of its own at once (`forgetOutlines()`, and `app_write` —
`Core::write` in `core/src/lib.rs` — of the file found for it). `OUTLINE_KEEP.v` is
raised when the Rust side traces otherwise.

**Bends** are apart from the lettering: a headline's `bend` (one of `BENDS`; `bendAmt`, how far) goes
with any `fx`, the look's own lettering included. `drawTitle` (and the free text's painter) hands each line
to `bentLine()` with a function that paints it as it would be: on a canvas of its own, in the line's space,
with room round the line for what letterings throw round it (`P`, 0.75 of the type size), a little finer
than the canvas below (coarser while something is dragged). `meshWarp()` bends that picture: the source
cut into triangles about a ninth of the type size across, every pixel of the result read back through its
triangle to the source and sampled between four pixels weighted by their opacity (so no dark fringe), each
written once (so no seams), empty cells passed over. The result is kept (`BENT`, by everything that decides
the line's look: its runs, font, effect and colours, the look and its settings, the ground it is on and
the profile's seed, whether dragging, fonts loaded since) until 24 million pixels of them are, so moving or
turning a bent title, or redrawing for another layer, only lays it down; a line painted while an outline
effect's outlines were still on their way is not kept, so it is bent again when they arrive. The bends
hold still past the ends of the line (what a glow or a shadow throws there keeps the ends' bend), and only
cells with something in them decide how large the result is: a perspective dragged past its horizon gets
a coarser picture, never one too large to make. Because the lettering is painted first and bent after, whatever it does
bends with it — the looks' work canvases, glows, masks and the plates under highlighted words — and no
outlines are needed. `bendExtent()` gives how far a bent line reaches past its box (the image of the box's
edge); `fitLines()` sizes the title so the bent block fits its box, and `titleBlock()` reports that block
(the subtitle goes under it; looks keep clear of it). A layer read with one of the bends as its `fx` (they
were outline effects in the house lettering) is given `fx: "cel"` and that `bend`, so it looks as it did.

The bends (`WARP`) are each a map of a point of the line, made from the line's type size, width and
strength: *Arched* and *Arc down* move the middle up or down along a parabola, *On a circle* lays the line
round a circle below it (the angle from x, the radius from y, so the letters fan out), *Arched top* scales
only what is above the baseline, *Bulge* and *Pinch* scale the height about the letters' middle, more
toward the middle of the line, *Fisheye* scales about the middle of the line within an ellipse a little wider than the line, easing
off toward its rim (along every ray the points keep their order, so nothing folds over), *Rise* shears y by x, *Wave* and *Flag*
move y along a sine, the flag's growing from its start and swelling the letters as it goes. Long straight
edges of the outlines are what the bend's picture is cut finely enough for.

**Extrusion** really sweeps every edge of the outline back into a wall: walls are split into lit and
shaded by the way they face, each group is filled as one shape, then the back face and the front.

**Reshaped edges** (`SHAPED`: Spiky, Torn edge, Scissor-cut, Melting, Eaten away; and Puffed up) are outline
effects too, so they need the desktop app as Extruded does and are ordinary lettering until the outlines
come, and in a plain browser. `glyphShapes()` gives a run's outline letter by letter: each letter, its closed
polylines and where it stands on the line (`contours()` is all of them together, for Extruded). A letter's
`side` is the sign of the area (`areaOf()`) of its largest contour; a hole runs the other way. `weighOf()`
gives the side and the letter's weight `k`, 0.4 to 1: its strokes' mean width (twice the ink over the
outline's length) against a bold Latin letter's. Every effect goes by it — thorns, tears, cuts, drips, pits
and puffing are smaller on a Chinese character's many thin strokes, close together, so they are not run into
one another.
`walk(pts, step, side)` resamples a contour at a spacing (or at a gap drawn anew each time, from a function),
keeping the corners that turn by more than 40° where they are and evening the gaps out between them; each
point carries how far along it lies and a unit normal pointing away from the ink, so outward round the outer
contours and inward round the holes. `loopNoise()` is smooth noise that closes round a contour.
`SHAPED[id].shape(g, R, o)` builds a letter's new polylines: Spiky puts a thorn between every two points,
along their normals, at gaps and of lengths of their own (now and then a short one, half as long into the
holes), none longer than 0.45 of the way to the next ink along it (`inkTest()`, the letter filled nonzero),
so thorns from the two sides of a gap or a hole do not meet; Torn edge moves each point along its normal by long waves of noise and fine random teeth;
Scissor-cut resamples at longer, uneven gaps, moves each point a little off the line, and turns and lifts
the letter a little about its middle; Melting moves the points that face down further down (the sag), and
a few drips, mostly from the lowest undersides, pull the points within their width down by their length;
Eaten away pushes pits of noise into the ink, with a fine grain along the edge. `o.amt` (Strength) sets how
far each goes. A letter's random numbers `R` come from the letter, which of its kind on the line it is, the
line (`o.row`) and the layer's `fxSeed` (`o.fxSeed`, from `drawTitle()` and the free text's painter;
`seeded(hash(…))` from `ransom.js`), so the same words come out the same in the preview, the export and at
every size, and *Reshuffle* deals others. `reshapeRun()` keeps the reshaped runs (`SHAPES`, 120 at most) by
what made them, so a cover redrawn does not work them out again. `outlined()` paints them as the other
outline effects: the shadow, the keyline (mitred for Spiky and Scissor-cut, the effect's `join`, so the
points stay sharp; round for the rest) and the fill, nonzero, so the holes stay holes. Puffed up (its `r` also by the letter's weight) needs no new
outline: the outline is stroked `2r` wide with round joins under the fill, so the letters grow by `r` all
round with every corner rounded, the keyline and the shadow round the grown letters. Surprise me deals them
only in the desktop app (`can()`), from the pop family (Puffed up, Spiky, Melting) and the print family
(Torn edge, Scissor-cut, Eaten away), and the collage's own recipe (Scissor-cut, Torn edge), each with a seed of its own
(`letterFor()`).

**The ransom note** (`ransom.js`) takes the pieces of the line from `pass` and splits each into its
letters' cells, the letter's advance in the line's font (a piece set larger, `s`, as setLine set it), shared
out to the piece's width. `ransomPlan()`, pure, dresses each letter: its face from the pools by script, its
kind (on a scrap of paper 62%, in the layer's own lettering 18%, hollow 8%, in depth 8%, from the photo 4%;
a kind turned off, or a photo letter without a photo, is a scrap instead), its paper (`papersFor()`: the
channel colour, black, white, newsprint, kraft, the highlight's colour, a yellow — a neutral left out when
the channel colour is it, a colour when one near it is there), an ink that reads on it (4.5 : 1), a turn, a
lift, a size, and Latin letters a flip of case (`amt`, the layer's strength, scales the turn, the lift and the
flips). The random numbers come from the layer's seed (`o.ransom.salt`, from `ransomOf()` in `render.js`: its id
and its `fxSeed`, the number Reshuffle draws), the line
(`o.row`) and the letter with how many times it came before,
so a letter is dressed alike at every size; a letter that drew its neighbour's family draws again from the
others (unless no other has the letter), one that drew its paper takes the next. A stretch of a script other
than Latin, Greek, Cyrillic and CJK (joined, or right to left), from its first letter to its last, is one cell,
set as the line sets it. The
hero, one a line of three letters or more (in the highlighted words when there are some), is the letter whose
name hashes highest, so typing moves it only when the new letter outdraws it. `ransom()` draws each letter as
large as the line's capital (or 国) times its size, no wider than its cell (1.04 times, the hero 1.12),
centred where the line's letters are: every scrap first and every letter after, so no scrap hides a letter
beside it, the hero last of each. The plan is kept per line (`PLANS`, by its letters, seeds, strength and
colours); a canvas only measured on (`placed()`'s probe) gets the house lettering instead. Faces: `RANSOM_FACES` lists the bundled fonts and the
system fonts of macOS, Windows and Linux worth cutting from; `ransomFaces()` in `app.js` (called once the ransom note
is first drawn or asked what it waits for, `findRansomFaces()`: trying each face on a canvas loads it, a third of a
second that every start spent before) keeps those installed
(`list_system_fonts`; in a plain browser, those a canvas reaches) and passes `useRansomFaces()` the ones a
canvas outside the page cannot reach yet, at most `RANSOM_AWAY` (4) a script: `ensureFonts()` loads them
(`ensureFont()`) when a layer has the ransom note, and `ransomArrived()` ends their wait. Until then a letter
in one is drawn in the line's font, and `ransomEpoch()` in `bentLine()`'s key draws a bent line again when one
arrives. Whether a face has a letter is measured (`has()`: set in the face, the letter measures otherwise than
in the bundled reference alone, Noto Sans SC or JetBrains Mono); what was measured and planned is forgotten
when fonts load or are added to the page (`document.fonts.size`).

Besides the scrap (`tile`), the layer's own lettering (`bare`) and the hollow letter (`cut`), a letter may be
`deep` — the letter laid back down and to the right as a stack of copies, one a device pixel or so apart,
darker toward the back, its face in its paper's colour (no outlines needed, so it works in a browser too) —
or `photo`, cut from the cover's photo (`ransomOf()` in `render.js` gives the background photo, else the
lowest one shown): the letter drawn on a spare canvas at the canvas's resolution, the photo laid in with
`source-in` from a part the letter's `tear` seed picks, on a white rim. A scrap may have a torn `edge` (sides
picked by `tear` jagged in teeth of 0.035 of the type size, a larger jagged copy under it in the paper's
lighter fibre colour) and `tape` across its top or a corner, drawn in a third pass after the letters.
`o.ransom.off` (the layer's `ransomOff`) keeps `torn`, `tape`, `deep` or `photo` from coming by chance; a
photo letter needs a photo either way.

Letters dressed by hand are the layer's `letters` (`normalizeLetters()` in `layers.js`; kept, with `fxSeed`
and `ransomOff`, under another effect too), by `letterKey()`: line, letter, how many times it came before in
the line — the key its random name is made of, so an edit stays with its letter while words after it change
(a line, or the same letter, put in before it passes the edit on to another letter). In `ransomPlan()` each
of a letter's random values comes from a stream of its own (its name and the value's), so whatever is set
changes nothing else of it but what follows from it (a kind's paper, a paper's ink, a hero's size and angle),
and of the letters after it mostly the next one's face and paper, which keep clear of it (papers are told
apart by colour). Over the dealt values go the edits: a face, kind, paper (the ink then drawn anew
to read on it, unless set), ink, turn, lift, size, case, edge, tape; `hero` true makes the letters the line's
only heroes, false keeps the random hero off a letter; `salt` gives the letter a name of its own (*Deal this
one again*). `lock` is a snapshot the editor takes ({seed, face, paper, ink, hero}): the layer's seed of then,
which the letter's name keeps, and what its neighbours decided, so locking changes nothing and Reshuffle
leaves it as it was; the letter before it, which it cannot give way to, keeps clear of its face and paper. The edits are in the plan's cache key and, through `o`, in a bent line's. The editor
is a window over the sheet on the left (`#letterwin`, placed by `overLeft()`, so the canvas and the drawer stay in view; over the drawer where it has taken the sheet's place, see 9.5), opened by
*Letter by letter…* under *Reshuffle* (`lettersOpen()`; `S.letterWin` is the layer it is for). Its
`letterControls()` and `letterEditor()` in `app.js` show the letters with `ransomLetters()`, which plans
each line of the layer's words (`lineCells()` over `parseTitle()`, the cells drawing would make) with the
papers and channel colour the layer was last drawn with on the editor's canvas (`ransomShown()`, recorded
when `o.ransom.shown`); after every drawing, and whenever `renderSide()` runs, `lettersShow()` draws the window again
when what it shows changed — the words, the colours, the letters set by hand, or the layer object itself (an
undo puts another in its place) — not while a pointer is down in it or one of its inputs has the focus,
unless something in it was just chosen; so it follows words typed and colours changed. It closes the window
(`lettersClose()`) when the layer is gone, no longer selected or lettered otherwise, and when Settings opens
(`setMode()`); Esc, *Done* and × close it too. The crop and weave windows and the weave brush's panel (6.3) stand
in the same place: opening one closes the others, and Surprise me's window closes them all. A letter in depth is stacked from at most 8 copies while something
is dragged (`isFast()`); a letter cut from the photo is kept by photo (`PHOTO_LETTERS`, 48 a photo).

### 6.2.1 A perspective of one's own

The *Tapered* bend can carry the layer's own corners, `warp` (four `[dx, dy]` in block widths and heights). When the title or a text layer is painted, each line hands the bend where it sits in the block (`frame`: the line's origin, its slant, the block's rectangle); `perspective()` (`bendMap()`) takes the points into the block's space, maps them with the projective map of `squareToQuad` onto the new quad and back, so several lines bend as one block. The block's transform and rectangle are kept in `cv._blocks`, from which the editor draws the corner handles (`warpHandles`) and, while one is dragged, takes the pointer back into the block's space with the inverse transform.

Every other bend can be reshaped by its handles, `reshape` (eight `[dx, dy]` in block widths and heights: four along the block's top edge, then four along its bottom). They rest where the bend puts the block's edges — the top as the first line bends it, the bottom as the last does, and past the ends of a line shorter than the block level with its ends (`bendRest()`), kept in `cv._blocks` as `rest` — and `reshapeHandles` draws them moved by `reshape` (`reshaped()`). `reshapeField()` turns the offsets into an offset for any point of the block: along each edge a Catmull-Rom curve through its four (so the edge under a handle moves by exactly its offset and the other handles' points not at all), between the edges in proportion, past them as at them. `bendMap()` adds it, taken at where a point was before the bend, to where the bend puts it, so the bend keeps its character (a wave stays a wave) and dragging only adds to it. The size is what the bend alone gives (`fitLines` does not see `reshape`); the plate and the hit box take in the moved handles.

### 6.3 Photo layers and blur (`photo.js`, `PAINT.photo` in `render.js`)

A photo is a free layer of type `photo`. The layer keeps only the picture's id `pid`; the pictures are in the photo store `S.photos`: `pid → {src, img, original, mask}` (the picture, the one before an AI repaint, the subject mask). Each is a file in `photos/`; a project file (version 3) embeds them under `photos`. `loadPhotos()` reads only what is needed (the current cover's; the library's when the Assets sheet shows the photo shelf) and returns those it cannot find. At start `prunePhotos()` removes files nothing uses, keeping the library's pictures, those of the current profile's covers and those of every cover under `covers/`. Duplicating layers and undo never copy a picture.

Two ways to place one: `fill` covers the canvas and is placed as the separate background photo used to be (`t.all.x/y` an offset around 0.5, `s` a scale on top of covering, no turning); otherwise like a print, nominally 1000 units on its longer side, at the free layer's place, scale, angle and stretch. **Links**: with `of` naming another photo layer, the layer is the passive end of a link with that (active) photo — what *Cut out the subject* (`cutOut`) makes: `cut` on, showing the active photo's picture. Only its place is the active photo's: it is drawn at the centre of that photo's rectangle plus an offset of its own (its `t`'s x, y, fractions of the canvas); its size, angle and stretch are its own (its `t`'s s, r, kx, ky — the size counted as its photo's is: against the canvas covered for one that fills it, as a 1000-unit print otherwise), as are its blur, dim, outline, shadow and opacity. `alignedT()` gives the `t` that puts it exactly over its photo (on cutting out, and *Line up with the photo again*); passive layers of earlier files, which had no size of their own (no `own`), are set up aligned by `settleLinks` when read. A photo has at most one passive layer; cutting out again finds its subject anew. Moves (`ddx`/`ddy`) always go to the active layer (`owner()`; `editAll` and `goLive` map to it first), so dragging either end moves both; scaling, turning or stretching a passive layer changes only it, and `aboutSubject()` moves its frame's centre round the subject's by the same amount, so the subject stays put (the hit's `px`, `py` are the frame's centre). Deleting the active layer deletes its passive one (`removeLayer`, `removeGroup`), not the other way round. `unlink()` ends a link: still aligned, the passive layer takes the active one's `pid`, `t` and `fill`; moved or resized, it becomes a print where it is, at the size it is (from the hit's frame centre and size, `px`, `py`, `pw`, `ph`) — a photo of its own either way — ending the link and putting a passive layer's background back both go this way. `replacePhoto()` changes only the active layer's `pid`; the passive layer stays as it is and is cut out of the new picture again — simpler than deleting it, cutting out anew and restoring its settings, with the same result. `settleLinks()` drops passive layers whose active layer is gone (or is itself passive); `upgradeCover` also links back the previous version's independent cut-outs that were never moved (same `pid`, same `t`). On the canvas a cut-out is caught on the box round its mask (`maskBox`) rather than the whole photo; a cut layer may carry `feather`, an inward soft edge: the mask's alpha is blurred and only what was inside is kept (`feathered()`), so the edge fades inward and none of the background comes back. The alpha is read from the mask once (`alphaOf`), and only the part round the subject is worked on, on a copy made smaller the softer the edge (one channel, `blurChannel` in `photo.js`); results are kept per mask and amount, with a coarser one while a slider or the layer is dragged. It may also carry `spread`, an outward soft edge: the subject, once drawn, is blurred and put behind itself (`haloBehind()`), so its own colours fade outward. That blur runs on the GPU — the picture made smaller step by step through a few canvases and then larger again — so nothing is read back into script.

Adding: an upload (*Upload photos* at the head of the Assets sheet, `uploadPhotos()`) or a drop on the window (but not while AI generate is open, whose reference it is then, 9.5) goes through `addPhoto()` (into the photo store and the library), then, like a click on or a drop from the photo shelf and an AI picture added to the cover, through `placePhoto(pid, at)`: the picture is read first if it is not yet, and it goes above the selected layer (`addLayer(L, above)`, which `placePhoto()` passes its own `above` to: the selected layer unless told) like a print, the cover's first photo too (only the self-test passes `fill`, for one just above the Background layer), where it was dropped if dropped on the canvas (a drag from the shelf carries the type `application/x-smed-photo`, its data the `pid`). *Fill the canvas* switched on takes the photo down to the ground (`toGround()`: just above the Background layer and the photos filling the canvas there already, with what is clipped onto it; its cut-outs stay over it), unless it is clipped onto a layer itself (a photo filling the lettering), which stays in what it is clipped to. Under its ways to add (text, a colour, *Upload photos*, *AI generate*), the Assets sheet (`assetsSheet()`) lists this cover's photos (`coverPhotos()`: each photo, then the cut-outs linked to it, in layer order, rebuilt when a layer is deleted, duplicated or re-ordered), each with its AI repaint, which opens the repaint window (`repaintOpen()`, see 9.5), and *Replace photo…* (`replacePhoto()`); then the photo shelf, the library's pictures as tiles (`libraryTiles()`), whose own upload (`stockPhotos()`) puts pictures into the photo store and the library, not onto the cover. `REP.for` is the photo whose repaint window is open; `REP.of` the one the running repaint, or its results or error, belong to — `REP.made`, this session's results of that photo (`REP_MADE`, twelve, at most), and `REP.result`, the one of them shown: shut meanwhile, they wait for that photo until another photo is repainted, and while one runs no other photo's repaint opens. The cut-out and *Remove the background* are in the photo layer's properties (`photoControls()`), *Remove the background* on its bar over the canvas too.

Painting: the photo goes through the look's treatment of photos — the look's `background` hook is called with `env.photo` set to this picture and `drawPhoto` drawing it in its own frame — on the whole canvas (a look's washes must cover it), and then only the photo's rectangle is kept, or, with `cut`, only where the mask is opaque. A photo with no cut-out, outline or shadow is painted straight onto the canvas inside a rectangle clip, with no work canvas; the others are put together on work canvases. The outline and shadow come from the silhouette of the shape (the mask, or the photo's rectangle), made once at the photo's scale (at most 1024 px) and cached per shape, so a frame lays one image. With the style *Torn paper* (`torn`) the outline is `tornSheet()` instead, made at the same scale: an exact distance transform of the shape (`distanceField()`, after Felzenszwalb and Huttenlocher), then each pixel is paper if it is nearer the shape than the tear's radius there. The radius is a few layers of value noise: the slow bites and the jags along them in proportion to the outline's width, the small teeth and fibres at a fixed size in cover pixels (so the fibres are as fine on a large photo as on a small one), and it is kept between about 0.3 and 1.15 of the outline's width, so it never tears into the photo. Past the tear stands a fringe of loose fibres; inside it, a band of the paper's core (its colour mixed toward white) that runs wider and narrower, a very fine darker line within that, a faint tooth on the sheet, and the whole sheet throws a soft canvas shadow. The seed is the layer's id (`seedOf()`), so each photo tears its own way and keeps it. With the tear on, the shadow slider uses the torn shape too. Results are cached per shape, width and colour, as silhouettes are. With the style *Dashed* (`dash`; the one or the other) it is `dashedLine()`: the same distance transform, then the closed lines where the distance crosses the dashes' middle radius (`isolines()`, marching squares, the cells where two inside corners face each other decided by their middle, the lines chained so the inside is always on one side), smoothed and stroked with a dash pattern stretched so each closed line has a whole number of dashes; their weight about a third of the outline's width, the outer edge where a solid outline's would be. A copy makes no hit: clicks go through to what is under it.

**Crop**: a photo not filling the canvas, and an asset, may carry `crop: {x, y, w, h}`, the part of the picture
that shows, in fractions of it (`normalizeCrop()` in `layers.js`: at least 2% each way, within the picture,
rounded to 1e-4; the whole picture is no crop, and drops the field). Nothing is cut from the picture. The
photo's frame stays where it is, so the part kept does not move on the cover; only it is painted (the plain
photo's clip, and the work canvas's `destination-in`, kept to it) and caught: the hit box is the crop's, or
for a cut-out the box round its subject within the crop (`shownBox()`), with the frame's centre as `px`,
`py`. So the editor scales, stretches and turns a cropped layer, as it does a cut-out, about what shows of it:
`edit()` calls `aboutSubject()` for a cropped layer and for a photo cut out, not only for a passive one (a
stretch along the layer's own axes, turned as it is). The outline, the torn edge, the dashed line and the
shadow come from the part of the shape the crop keeps (`cropShape()`: the mask, or the plain rectangle, cut
to the crop on a canvas the crop's size, `at` where it starts, laid down from the crop's corner; a dozen kept
per shape, for copies of one photo cropped each its own way, so the caches by shape, `silhouette()`'s and the
tear's, still hold). A photo filling the canvas
ignores its crop (the brush's overlay too); a cut-out made from a cropped photo starts with the same crop (`cutOut`). An asset
(`PAINT.asset`) is clipped to its crop about the box `drawAsset()` gives it, which `assetHalf(ref)` in
`assets.js` gives without drawing, and caught on what is left.

A **free crop** is a shape of any outline: `crop: {x, y, w, h, pts}`, `pts` its corners in order round it ([u, v],
fractions of the picture, within it, rounded as a rectangle's are; 3 to 64 of them, `CROP_PTS`, the first kept, what
is not a pair of numbers dropped) and x, y, w, h the box round them (worked out again from them whenever it is read,
at least 2% each way, within the picture). So everything that reads a crop's box reads a free crop's as a
rectangle's: the frame, the hit's box and `px`, `py`, `shownBox()` (a cut-out's subject within it), the work canvases'
reach, `aboutSubject()`, a woven asset's box, the head line, Surprise me's room; only where a crop is painted and
caught does the shape count. With fewer than three corners it is read as the rectangle it carries, and the picture's
four corners in order round it are the whole picture, no crop. So is a shape with (almost) no area (`hasArea()`: less of
the picture than the smallest rectangle crop keeps, `CROP_AREA`, 2% by 2%, or less than 1% of the longer side of the box
round it, its area over that side; its corners on a line or on one point, or squeezed to a sliver along one, while a star
burst of thin spikes, a crescent or a thin L has enough), which would show nothing and leave a frame a sliver: rather the
whole picture, as its four corners are, than that box. `hasArea()` judges the corners as they are kept (within the
picture, to 1e-4), so a shape the window puts on a layer by it is never then read as no crop. Its area
is `polyArea()`, exact and even-odd as it is painted (taken in strips between the heights of its corners and of the
points where its edges cross: a bow-tie's two lobes both count, a shape gone round twice covers nothing). A rectangle has
no `pts` and is read, painted and caught as it ever was, to the pixel. Painted, the shape is traced (`tracePoly()`) where a rectangle is clipped or filled: the
plain photo's clip, the work canvas's `destination-in`, `cropShape()` (the shape cut to the box's canvas as before, then
kept to the corners with `destination-in`, so the outline, the tear, the dashes and the shadow go round the shape; its
key, `cropKey()`, takes the corners in, as the slide image's stamp does), an asset's clip about its box and the brush's
overlay; filled even-odd, as `inPoly()` counts, so a shape crossing itself shows the same everywhere. Its hit carries
`poly`, the corners on the canvas (through the hit's `pf`), and `hitAt()` catches it only within that, or as near its
outline as the box's margin (`edgePoint()`); the selection's frame and handles stay the box. Duplicating, undo, a copy
from another channel and a file read carry the corners as they carry the rest of a layer (`JSON`, `normalizeCrop()`).

The crop window (`#cropwin`: `cropOpen()`, `cropShow()`, `cropClose()`; `S.cropWin` is the layer it is for)
is opened by *Crop…* in a photo's Place group or an asset's Crop group (`cropButton()`: *Adjust the crop…*
once cropped; greyed out, with a tip, for a photo filling the canvas), or on the layer's bar over the canvas. It
stands over the sheet on the left as the letter window does and shows the whole picture (`cropSource()`: a photo's picture, a cut-out's subject bright
over the rest of it; an asset drawn in its colours on a canvas), the crop framed and the rest dimmed. A drag
inside moves the frame, on a side or a corner resizes it, outside draws a new one from there; Shift keeps the
shape the crop has. The maths is pure, in `layers.js`: `dragCrop(c, handle, dx, dy, ratio)` (a corner keeps
the shape about the corner across, a side about the middle of the side across; within the picture, 2% at
least each way), `drawnCrop(a, b, ratio)` (a frame drawn outside the old one, from where it was pressed
toward the pointer, any way, once the pointer has gone a few pixels, so a click changes nothing) and
`fitCrop(c, ratio)`, a crop of a shape as large as `c` (no larger than the picture
holds), as near the middle of `c` as it goes, for the shape chips (*Any ratio*, *Its own shape*, 1:1, 4:3, 3:4, 16:9, 9:16: in pixels,
turned into fractions of the picture). Each step goes onto the layer through `normalizeCrop()` (`setCrop()`) and is drawn
as a drag is (`holdLive()`); the window shows how many pixels are kept. *No crop* clears it. It closes on
Esc, *Done* or ×, when another layer is selected, when the photo comes to fill the canvas, and when Settings
opens. The picture stands 8 px in from the window's edges (`CROP_PAD`; less round a very thin one), so the handles on its edges show whole.

The last chip, *Free* (`CROP.ratio` "free"), crops to a shape. The window then draws its corners as round handles
(the one picked, `CROP.point`, in the channel colour) joined by its edges, what lies outside dimmed; it is in that way
whenever the layer's crop is free, and a rectangle crop turns it back to *Any ratio* (an undo may change either).
Chosen, it starts on the whole picture's four corners (`cropPoly()`: a rectangle's corners, the whole picture's for
none; no crop until one moves), and a free crop chosen again stays as it is. A press on a corner drags it alone, from
where the press began (`dragPoint(pts, i, dx, dy)`: within the picture, those joined to it where they were), and stops
where the shape last had area as it is kept (a place that would leave it none, `hasArea()`, is passed over, so the
corner waits there and goes on once the pointer is where the shape has some again); one within 7 px of an edge adds a
corner there and drags it on at once (`edgePoint(poly, x, y)`, the nearest point of the outline, in the window's pixels;
`addPoint(pts, i, p)`, after corner i); one inside the shape moves it whole (`movePoly()`, as far as its box stays within
the picture). Each step goes on only if the shape keeps area (the corner added, the shape moved, rounded as kept, too).
Over an edge the pointer is a plus, a faint corner with a plus is drawn where it would go and the picture's tooltip says
a click adds one; with 64 corners already none is offered there (no plus, the pointer not-allowed, the tooltip and a
press saying 64 at most). A second press on the same corner within 400 ms, not dragged between (`CROP.tap`), takes it
away, as Delete or Backspace takes the one picked (`cropDropPoint()`, `dropPoint()`): never below three corners, nor to
a shape with (almost) no area, a word saying which; while the window crops free the key never deletes the layer, a
corner picked or not.
*Any ratio* chosen on a free crop gives the box round it; another shape fits one about that box (`fitCrop()`). The
window shows the box's pixels and how many corners there are.

**Weave**: a cut-out, or an asset, may carry `weave: {with, by, line, front, strokes}` (`normalizeWeave()` in `layers.js`: at
most 24 layer ids and 400 letter keys a layer, `line` within 0.1–0.9, the brush's strokes as below; `by` "head",
"letters" or "brush" (`WEAVE_WAYS`), and each way's data kept whichever is chosen, so going back to one finds it
as it was; the ids are not looked up, a layer being read on its own, and a weave is kept on a photo no longer cut
out; `frontOf()` reads a layer's letters, never what an object has from its prototype, whatever a file names its
layers). What weaves is `canWeave()`: a photo cut out, and every asset — a sticker, a graphic, an image of the
user's, a 3D object —, which is see-through round what it draws already, so it needs no cutting out and weaves in a
plain browser too; its picture is the box `drawAsset()` draws it in (`assetHalf()`), its subject what it draws there.
A letter key is `row|letter|occurrence`
(`letterKey`), the letter whatever lies between the first bar and the last — a bar itself, or a stretch of
another script that `lineCells` sets whole, up to 200 characters — so the choices follow a letter by its line
and its count there: typing a line above, or the same letter earlier in its line, moves them, as it moves the
ransom note's letters dressed by hand. The lettering is never painted twice: it stays below
and the cut-out lets it through. Before a cut-out is painted, `paintRange` asks `wovenFront(i)` in `paintCover`
for what of its lettering comes in front: each layer it weaves with that lies below it, shows and is on this
channel (a clipped one kept to its base) is painted alone onto one canvas in the cover's own pixels, as a
clipping group's layers are, undimmed (FOCUS dims the lettering itself) and at full opacity (lettering half
see-through in front takes the subject's place there wholly, so the hole shows whatever lies between the
lettering and the cut-out: the cut-out's own photo under a linked cut-out, the ground under one of its own) —
all of it by `head` and by `brush`, by `letters` only its letters in front (`env.only`, a Set of letter keys, which
the title, subtitle and text painters read). The layer's look effects come with it: in letter mode one that paints
across the layer's whole box (a texture, a band) cuts through the subject there too.
It is worked out before the cut-out is painted because the layers' own work canvases (`scratch`, `fxScratch`)
serve for it. `PAINT.photo` then cuts it out of its whole composite (body, outline, torn edge, shadow) with
`destination-out` before laying it down (`letThrough`); by `head`, less what lies above the head line first:
`headLine(box, line)` of the way down the box round its subject (`shownBox()`, so a crop counts), cut in the
photo's own frame `F`, so the line turns, stretches and scales with the photo; by `brush`, kept to the brush's mask
first (see below), laid in the same frame with `destination-in`. The cut is `weaveCut()`, a cut-out's and an asset's
alike, told the frame, the picture in it and the box round its subject. `PAINT.asset` lets its lettering through the
same way: woven, it draws the asset on a work canvas (`sheet`) round what it draws, cuts the lettering out of all of
it there — its shadow and ink lines, its colour, the channel's or the user's — and lays it down; unwoven it draws
straight onto the canvas as ever. What an asset draws is measured once (`assetBox()`: drawn 256 px across its box with
half its box again round it each way, as a still cover draws it — a drag's frame leaves things out, the cyber look's
colour echo —, `opaqueBox()` over its alpha; kept per asset, colour, tint, look and the fonts there are, 64 of them):
`ink`, round all it draws, is what the work canvas holds, with `ASSET_GLOW_PX` (32) of the canvas's own pixels round
it for the glows the looks' sticker painters blur in pixels (the rave's, `shadowBlur` 20, the widest); `solid`, round what is opaque enough to count (above 64, as
`maskBox()` reads a mask), is its subject, which the head line is a share of — so a sticker's top, or the part of a
round graphic above the line, comes in front, in the box it is drawn in, turning, stretching and scaling with it. Its
hit carries `pf` as a photo's does, from that box. With look effects on the
cut-out (or an asset) the cut waits for them: `PAINT.photo` hands paintRange its cutter (`env.letThrough`, the way to let
lettering through in its frame; `PAINT.asset` its own), and the effects' image is kept (`FX_KEPT`; a woven asset's too,
by the asset it draws and the fonts there are, `fontState()`, as `wovenFront` keys its lettering) from before the cut, with the cutter,
so its key leaves the weave out and the lettering is let through each time the image is laid down; an image
made while nothing was dragged serves the frames of a drag (they would make a coarser one), and nothing is
kept for a layer repainted every frame (`moved`: those dragged and those that move with them). So dragging the
lettering over a cut-out with look effects, or the head line's slider, does not work its effects out again. The
woven canvas is kept on the editor's canvas only (`o.select` or `o.live`; a thumbnail, a hand of Surprise me or
an export makes its own and lets it go), per cut-out and canvas size (`WOVEN`, 16 M pixels in all), under a key
of what decides it — the canvas and size, the channel, the style and the look's values, the words, the
subtitle's place, the layout, each woven layer and where it is, the letters in front, the fonts — and while
something is dragged it is used again as long as the key holds, so a subject dragged does not paint its
lettering again; the head line and the strokes are not part of it, nor the way but for whether it is by letter
(they decide only the cut), so painting with the brush never paints the lettering again. Work canvases larger
than an editor's canvas (`BIG_PX`: the clipped layer's, the head line's, `someLetters`') are let go after use. A
costly photo's slide image (see the drag cache in 6.4) is kept from before the lettering is let through, which
is cut again each frame where it now is. In the drag cache a cut-out or an asset woven with a layer that moves moves too (it
is repainted with it), after the clipping groups have been taken in (so dragging the base of woven lettering
counts) and with its own group.

Weaving by the brush: `strokes`, [{front, r, pts}] in the order painted. A stroke in front adds to where the
lettering comes in front, one behind (`front` false) takes it away again, so painting behind over what was painted
in front erases it and painting in front again brings it back. The points are in the photo's own frame, fractions
of the picture's width and height (0 to 1 across it; -1–2 kept), the radius `r` a share of its longer side
(0.001–0.5): they follow the photo moved, scaled, stretched and turned, at every size, and a linked cut-out's own
size and angle, staying on what they were painted on. A crop keeps the picture where it is in its frame (see
*Crop*), so it changes nothing of them (painting outside it changes nothing that shows; uncropped, they are there);
a photo has no flip (its stretch is kept positive: a picture mirrored by one would take them with it); a picture
put in its place keeps them where they were, as fractions of it. An asset's are fractions of the box it is drawn in,
the radius a share of that box's longer side: they follow it moved, scaled, stretched and turned, at every size.
`normalizeWeave` keeps at most 300 strokes, 2000
points a stroke and 12000 in all (`WEAVE_MAX`, the first ones), each number to 4 decimals, drops a stroke with no
point and leaves `strokes` out when there are none. Where the picture is on a canvas is its hit's `pf`, the map
`photoMap(rect, at)` gives from its fractions to the canvas (the rectangle `PAINT.photo` frames it by, about the
frame's centre, stretched, turned and placed; a photo filling the canvas, its rectangle as it is); `onCanvas()`,
its inverse `photoPoint()` and `photoLong()` (the picture's longer side there, a stretch evened out: what a radius
is a share of) stand beside it, all pure. The mask is drawn in the photo's frame (`brushMask()` in `render.js`): a
canvas over the picture and a margin an eighth of it wide each way (`BRUSH_PAD`, for an outline or a shadow past
its edge), about the size the picture has on the canvas but never finer than the canvas (the picture's longer side no
longer than the canvas's: a photo larger shows only a part of itself; in steps of 256 px, 256 to 4096 on its longer side),
each stroke a round-capped, round-joined line, its first point a dab (a stroke of one point is one), `source-over`
in front and `destination-out` behind. It is kept per cut-out and size (`BRUSHED`, 16 M pixels in all; one larger
than `BIG_PX`, an export's, let go after use, but never the editor's canvas's, so a stroke over a big photo on a big
screen draws only its new points each frame) with the stroke objects it was drawn from and how many points of
each, and `brushToDo()` (pure) says what is left to draw: points added to the last stroke, strokes after it (only
the last stroke grows, while it is painted); anything else (an undo, *Clear all*, a stroke changed) is drawn anew. While
no stroke is in front (`brushesFront()`) `wovenFront` lets nothing through and paints no lettering.

Painting some letters only: `drawTitle` (`st.only`) and `drawFreeText` (`env.only`) find each line's letters with
`letterCells()` in `ransom.js` — the ransom note's cells (`lineCells`, keyed by `keysOf` as `letterKey` names
them), each its share of its piece, and `pen`, where its letter begins as the piece is set (the text before it
in the piece measured together, so kerned). `someLetters()` in `title.js` paints the line on a work canvas and
keeps of it what lies on those letters' shapes — drawn at their pens in the line's font, as large and as low as
their piece, grown by what the lettering throws round them (keyline, sticker rim, `effectReach`) and drawn
along their shadow, depth or drips — less the bodies of the letters behind and their shadows, those in front
whole: a letter in front comes forward whole and a neighbour behind stays there, which a clip by the letters'
shares along the line would not give (a letter's ink reaches past its share). Most looks letter upright on the
slanted line (`upright()` in `looks/kit.js`): while the line is painted, a `transform` taking the slant out is
noted on the work canvas, the shapes are grown both slanted and upright, and the bodies taken in the frame the
lettering was painted in. It works in the line's own space, so inside a bent line's `paint` it bends with the
letters (the bent line's key holds the letters). A line with none of them is left out, and so is the plate. The
ransom note is told the letters (`o.only`) and paints those alone, scrap and tape too; the plates and marks of
its highlighted words are kept to those letters' shares of the line (`clip`). Lettering in columns
(`drawTitleVertical`, see 6.1.1) goes the same way, a column counted as a line: it is a line turned, and the
letters' shapes are drawn under `inColumn()` as its letters are, grown and taken off along the shadow as the page has
it (`fall()`) and along the drips down the page, which is along the column (`columnNow()`), as the lettering throws them. Where the context is no canvas (a test double), a clip to the letters' shares stands in.

A cut-out's or an asset's *Weave* group (`weaveControls()` in `app.js`: on, which lettering below it — `weavable()` —,
the way, the head line; for an asset, in words of its own, `weaveT()`: *Automatic (top in front)*, *Top down to*) and
the weave window (`#weavewin`: `weaveOpen()`, `weaveShow()`, `weaveClose()`, `S.weaveWin`;
`weaveLetters()` lists each woven layer's letters by `lineCells` over `parseTitle`, keyed as drawing keys them,
each a toggle, with all in front, all behind and every other) stand as the crop window does; it closes as that
does, and when the cut-out is no longer woven by letter. Every change goes through `touch()`, so it is one undo
step and the canvas follows.

By the brush, *Paint…* (`brushOpen()`) opens its panel (`#brushwin`: `brushShow()`, `brushClose()`, `S.brushWin`
the cut-out painted on) where the weave window stands; it closes as that does, and when the cut-out is no longer
woven by the brush. It holds the brush's size (its width in the cover's units, `BRUSH.size`), *In front* or
*Behind* (`BRUSH.front`; Alt/Option held, the other), *Clear all* and *Done*. While it is open the canvas only paints:
`paintFlat` passes `o.brush`, so no frame or handles are drawn and `brushOverlay()` lays the area in front over the
canvas in the channel colour, faintly (15%) off the subject and about 35% on it (an asset's subject: what it draws,
drawn again in its box), from the same mask, at the same size, as the cut; a press goes to `brushDown()`, a move to
`brushRing()` (a ring under the pointer as wide as the
brush, dashed while it paints behind; Alt pressed or let go turns it), and the wheel, a double-click, a click
beside the canvas and every key but Esc (which leaves), undo and redo do nothing. A stroke: the press records any
step still waiting, turns the size into `r` by the hit's `pf` and `photoLong` (of the picture's size, `pictureSize()`: a
photo's, or the box an asset is drawn in), and adds the stroke to the layer's;
each place the pointer passes (its coalesced events, where there are) is taken into the picture by `photoPoint`,
and `brushNext()` (pure) gives the next point, the mean of the last three places once it lies a quarter of the
radius or more from the last point: a hand's jitter smoothed a little, no more points than the stroke needs. Let
go, the place it was let go at is added and the step recorded at once (`commitHistory()`), so each stroke is one
step of undo, and *Clear all* is one too. While a stroke is painted `LIVE` holds the cut-out alone (not its photo, as a
drag would), so each frame blits the rest, slides the cut-out's last image (see the drag cache in 6.4), cuts the
lettering through it with the mask drawn on since the frame before, and lays the overlay; the thumbnails wait for
the stroke's end. Strokes stop at the limits, with a word.

The Background layer (`PAINT.bg`) paints in three. Its base, `base`: "grid", the look's ground — its `background` hook with `photo: null` and `grid: false`, or the theme's colour — then the grid on it, `lookGrid()`: the look's own `gridLines(ctx, env, color)`, else lines every 60, in the look's grid colour for the ground it is on (`th.grid`); "look", the ground as it was before there were bases, no grid on it (where the look has no ground of its own, as cel, the theme's field and its grid all the same); or "clear", nothing (see-through: a PNG keeps it, a JPEG is flattened onto `MATTE` in `core/src/image.rs`, the editor shows a checkerboard behind the canvas). Then what the look paints on the base, its scene and pattern: `background` again, with `grid: true` and `ground: false`, which paints none of its ground. With all a look's sliders at their least that paints nothing (the test "what a look paints on the ground lies on its base"), so the base is all there is. A `background` called without `ground` paints its ground; with `grid: false` and no photo, only its ground. A photo's treatment is the same hook with the photo and `grid: false`: the photo and its tint, and for a photo filling the canvas the look's overlays on it. On a see-through base what is laid over a whole picture (a look's `post`: grain, a vignette, wear; the tints and colour fringes some looks lay over their scene) goes only where something is painted, as much as it is (`wherePainted()` in `looks/kit.js`), so what is see-through stays so. `BASE.lines` (render.js) turns the grid off, for comparing drawings without it. `grid` is always on for the Background layer (`normalizeLayer()` puts it back on a cover kept with it off). Light or dark (`style.theme`) is set in its properties (and on its bar over the canvas); the Look sheet does not have it. When looks and themes ask whether there is a background photo, they mean the lowest visible photo filling the canvas on this channel (`env.photo`).

Blur: canvas filters are not available in the macOS web view, so the gaussian blur is done in script — three box blurs approximate one gaussian, each a sliding window whose cost does not depend on the radius — on a reduced copy of the picture, cached by picture and amount (per picture).

Earlier data: `upgradeCover` turns the one photo kept beside the cover (the session's `session-photo*`, a version 2 project's `photo*` fields) into a background photo layer taking over the Background layer's place, blur and dim, and an earlier `subject` layer into its cut-out copy. A default design keeps no photo layers.

### 6.4 The cut-out (`core/src/cut/`: `vision.rs`, `onnx.rs`)

Two ways, chosen by the setting `cutEngine` (`cutEngine()`: Vision by default on a Mac, the light BiRefNet elsewhere); both return the same kind of mask.

**BiRefNet (`onnx.rs`, every system)**: `ort` is used with `load-dynamic`, so the runtime is not built in. When the user downloads a model (`cut_model_download`, progress sent as the event `cut-model-progress`, `cut_model_cancel` to stop), Microsoft's ONNX Runtime 1.23.2 package for the platform comes first (the last release with an Intel Mac build, hence `ort`'s API 23) and only the one library file is taken out of the .tgz / .zip; then the model (onnx-community's BiRefNet_lite / BiRefNet ONNX). Each file's SHA-256 is computed as it arrives, and it takes its place in the data folder's `models/` only when size and checksum match. Cutting out (`subject_mask_onnx`, the model id in the header `x-model`): `ort::init_from` loads the runtime the first time, the session is kept per model; the photo is scaled to 1024 × 1024 and normalised as ImageNet's, the last output map goes through a sigmoid and is scaled back to the photo's size, as the same alpha-only PNG. The interface sends photos of at most 2048 px.

**Apple Vision (`vision.rs`, macOS)**:

`subject_mask` hands the photo's bytes to Apple Vision's `VNGenerateForegroundInstanceMaskRequest` (macOS 14 on; the class is looked up at run time through objc2, so an older system reports that it needs macOS 14), takes `generateScaledMaskForImageForInstances` — a float mask the photo's size — and returns it as a PNG in which only the alpha matters. The interface draws the photo on a canvas and sends that as JPEG, so EXIF orientation is already applied and the mask matches the photo pixel for pixel. The mask lives on the picture's record; when the picture changes (an AI repaint, or back to the original) it is cleared and the layers that use it are cut out again.

The drag cache (`o.live`) cuts the layers into runs that move and runs that do not; each still run is painted once into an image, and each frame repaints only the moving runs. A dragged photo takes its copies with it, and a cut-out or an asset woven with a dragged layer is repainted with it; a photo with a cut-out, outline or shadow only slides its last image while it moves (let through again where its woven lettering is), and is painted properly when the drag ends.

### 6.5 Assets

- **Channel graphics** and **stickers** are all drawn in code — there are no image files — so they are sharp at any size and can take the channel colour. `cel.js` provides a cel-shading kit (flat tones, ink lines, pseudo-3D boxes and prisms); `graphics.js` adds more through `registerGraphics()`.
- **Uploads** are stored as data URLs in the app data directory and cached once decoded.
- `drawAsset()` is the single entry point and returns the asset's half-extents for hit-testing.
- `assetHalf(ref)` gives the same half-extents without drawing (null for an asset that is gone), for a cropped asset (see *Crop* in 6.3) and a woven one (see *Weave* in 6.3), whose box it is.

## 7. Looks (`style.js`, `looks/`)

Each look lives in a file of its own, `looks/<id>.js`: its object (the hooks below), its helpers and its layer
effects (`elementFx`). What more than one look uses is in `looks/kit.js`: colour and drawing helpers, scene objects,
the current look's module state and the effects' machinery; nothing there imports a look. `style.js` is the registry:
it imports every look, puts it in `LOOKS` (which kit.js holds, empty until then) in the menu's order, hands over the
house look (`houseLook(cel)`), and re-exports the API the rest of the app imports, so no other module changed. A
change inside one look's file touches no other look; a change to kit.js, render.js or photo.js may touch them all.

The **content** of a cover — layers, placements, sticker and solid specs, the title text — carries no
style information, so switching look is only a different way of drawing: every asset, AI-generated
ones included, is redrawn and no data changes.

A look is a set of **hooks**. Each is optional, and what a look leaves out is drawn the default
(cel) way, so a new look can start as one hook and grow.

| Hook | Responsible for |
|---|---|
| `theme` | colours of the field, the grid and plain text |
| `background` | the background layer: its ground (`grid: false`), what it paints on the base (`ground: false`), the photo and its tint |
| `accent` | the colour block: fill, screentone, how the dividing edge is drawn (given its points), and a surface of its own inside it (`body`, optional) |
| `leave` | optional: let go what the look keeps, as another look is chosen (`setLook()` calls it) |
| `runs` | lettering made of runs — the title, and free text in the headline look |
| `wrap` | returns a stand-in context that channel graphics, solids and the small cover parts (brand row, tag, channel name, brackets) draw on |
| `sticker` | the five painters of flat stickers: `shape`, `blob`, `stroke`, `thin`, `word` |
| `tag` | the corner tag |
| `frame` | the frame layer, and any interface detail the look wants along the edges |
| `plate` | the plate under the title or a text layer |
| `subject` | whatever is painted around the channel graphic and travels with it (a lock-on ring, say) |
| `seeded` | marks a look that places some things at random |
| `layout` | the geometry of a cover, for looks that are about arrangement; the result has the shape `layout()` in `layout.js` returns, and usually comes from `blockLayout()`, which gives level bands and upright panels |
| `columns` | true when the look sets the title and the subtitle in columns of itself (its default; see 6.1.1) |
| `columnBox` | where the title's columns stand, when the look has a place of its own for them (the woodblock book's `songBox()`) |
| `faces` | faces to use for the whole cover. The font table is shared, so `drawCover()` puts it back when it is done |
| `titleFont` | the title's font stack, for looks with typographic opinions (editorial's serif) |
| `oneTheme` | marks a look with a single ground, so the interface hides the light / dark choice |
| `image` | the shadow or glow of an uploaded image |
| `post` | an overlay painted over the finished cover, such as scanlines and a vignette |
| `params` | tunable numbers, shown as scrub bars in the Look sheet, under the looks' cards, ticked at `def` (one with `toggle: true` as a switch) |
| `prompt` / `solidPrompt` | the *Style* section of the AI prompts |

The current look is module state in `looks/kit.js`, set by `drawCover()` from the profile before it
draws; the interface also sets it before painting asset tiles.

### 7.1 The stand-in context: a new look without touching the drawing code

Each of the twenty channel graphics is dozens of lines of direct canvas calls. Rewriting them one by
one for several looks is not realistic, so they draw on a stand-in: `wrap` returns a `Proxy` that
forwards every canvas call and steps in at two points.

- **When a colour is set**, it first works out the job that colour does in the cel style (ink, light face, mid face, dark face, colour) and substitutes the current look's colour for that job. Cyberpunk turns the three faces into three shades of dark glass and leaves colours alone.
- **When a line is stroked**, an ink line is drawn as a line of light instead: a wide faint halo, the coloured line, a thin pale core.

So the drawing code of the channel graphics and of AI-generated solids is unchanged.

Cyberpunk leaves the small cover parts (brand row, channel name) alone: the look *is* solid panels
with black lettering, which is what the cel style's ink on colour already gives. Its difference comes
from elsewhere: the colour block is a solid panel, highlighted words in the title become black on a
chamfered plate, every hard ink shadow of the cel style becomes a red and cyan "echo", and the whole
picture finally gets a colour split and a signal tear.

The glow is made by stroking a line several times at different widths, not with canvas shadow blur.
Shadow blur is slow per line, and web views disagree about its extent: the same value came out far
blurrier in the app's web view than in Chrome. The title's glow is layered strokes too, so it looks
the same everywhere.

### 7.2 Tools the looks share

Most new looks keep the construction and change the materials, so a few tools are shared:

- `mapped(ctx, rules)` — a general stand-in context that swaps colours by the job they do (ink, light face, mid face, dark face, colour) and can scale every line width.
- `painters(options)` — builds the five sticker painters from an outline colour, a line-width factor and a way of drawing the shadow.
- `grain()`, `wash()` — grain, and laying a colour over everything; for paper and film and for tinting photos. Grain is multiplied in on paper and overlaid on film: overlay hardly shows on a light ground.
- A photo loses its colour through the `grey` argument of `drawPhoto()`, which computes a grey copy pixel by pixel and caches it. The canvas "saturation" blend mode is not used: it is not dependable across web views.
- The copies `photo.js` keeps of a photo — blurred, grey, worked on by the look (`treatedOf()`) — are worked out on canvases held in memory, and WebKit sends such a canvas to the graphics card again each time it is drawn: some milliseconds for a photo's copy, paid as often as a look draws its photo in a frame (the black-and-white film's motion trail and its pieces of collage draw it about a dozen times). A draft or a drag's frame (`setDraft()`, see 9.3) draws them from a copy kept on the card instead (`onCard()`), made once each time the copy is filled again; a still cover, the thumbnails and an export go on drawing the copies held in memory, so they come out exactly as before (WebKit resamples the two a hair differently). Nothing a draft paints is kept for a still cover: the image a layer's look effects are kept as (`FX_KEPT` in `render.js`) says how it was painted, and serves only a paint that draws no better (`fxServes()`) — the full picture painted as a slider is let go, on a canvas with the draft's own pixels (a screen of pixel ratio 1), had come back with the draft's. The copies on the card go as the drag or the draft ends (`dropCards()`, called by the first still frame of the main canvas): kept as long as the photo, a layer dragged on a Retina canvas held some 17 MB on the card for each, for nothing.

Looks with a light and a dark ground (record sleeve, editorial) learn which one is current from the fourth argument of `setLook()`.

**Summer illustration** (`vivid`) builds its picture from flat layers. The sky is one azure. A cumulus (`billow()`) is rows of circles of uneven size, with a ring of small ones on its edge so the outline breaks into many bumps; the light comes from the upper left and is laid on the whole cloud at once: periwinkle shade first, then every circle again, moved toward the light, in pale blue, and further still in white, so neighbouring circles merge into broad lit masses and each keeps a crescent of shade at its lower right; the outline, the flat base and some of the turns from light into shade are drawn in a fine indigo line. Clouds are kept below the brand row. A tower (`skyTower()`) is a coral-red cylinder in three hard planes (a lit strip, the body, the shaded side) with rings, two of them brass, a drum and a dome on top, and a brass pipe turning into it. The street (`skyline()`) is a row of houses of uneven size, each a flat colour with a shaded side and windows, some with a tall signboard or a red lantern. Pennants (`pennants()`) hang from a sagging quadratic curve. The horizon is the colour block's edge (`env.G.edge`, when the block is below): the houses stand on it with their feet behind the block, the clouds and towers behind the houses; with the block above or at the side the horizon is the foot of the picture. The channel colour is made vivid by `boost()` (hue kept, greys left alone). A photo is laid over itself once more in soft light, then a block of pure red in the "saturation" blend mode at about a third opacity (hue and lightness kept, saturation pushed up, greys untouched), then a warm orange in soft light. The "saturation" mode is undependable for taking colour out, as said above; for pushing it up, as here, it was tested in the app's web view and works. The look was called `ghibli` while it was made; profiles and layers that say so are read as `vivid`. Every slider works by degrees: the cumulus are a fixed set of clouds, each given a stretch of the slider over which it grows from small to its full size (`grow` in `mass()`), so the further the slider goes the more clouds there are; the street first rises as a row from behind the horizon (all the way by 0.3) and then grows taller; the towers neither appear nor vanish but rise from behind the horizon, the first between 0.3 and 0.7, the second between 0.65 and 1, their feet hidden by the colour block and the houses; the first string of pennants is drawn in over the first half, its flags growing from small to full, the second over the other half.

**The five poster looks** (negative space `negative`, minimal film poster `cinema`, cyanotype `cyano`, monochrome film `monofilm`, experimental type `typo`) share a few things. `env.graphic` (given by `render.js`) draws the channel graphic on any canvas, and `env.figure` the graphic the user put in its place for this look's figure (`style.lookArt[look]`, picked under the slider the look names as its `art`; null when there is none, or it has left the library; an upload picked there travels with an exported profile, as `usedUserAssets()` names it; so does a photo's cut-out subject picked there, which `subjectPng()` in `app.js` crops to the subject — read off the mask at a small size — and keeps with the user's assets, cutting the photo out first when it is not yet); `figureOf()` is the one a figure is drawn from. `graphicShape()` draws that (or the graphic it is given: the basketball poster's trail follows the channel graphic itself) once on a canvas 1200 px square and thresholds its alpha into a clean silhouette (the half-clear ground shadow left out), notes the extent of the solid part, and keeps it per look and graphic; `placeShape()` paints that silhouette in a colour at a given height, centre and angle (each silhouette keeps up to four colours). `openField()` works out, from the colour block's edge, the part of the picture the block leaves open; the silhouettes stand on its floor. With no filter to rely on, blurring is always `blurred()`: the shape is drawn far off the canvas and its canvas shadow (`shadowBlur` with the opposite `shadowOffset`) is cast back into place, so the shadow is the blurred shape. `workLike()` / `layDown()` are a work canvas the size of the current one and with its transform, for painting a whole thing first and laying it down at once (with an alpha or a mode, or after cutting holes in it); it takes the current font and alignment along, so lettering painted on it matches the widths measured outside. `crumpled()` makes crumpled paper (many half-clear triangles for facets, creases as light and dark pairs), laid on in soft light; `dotScreen()` is a halftone pattern; `greeked()` draws greeked text — lines of thin bars the length of words, for a poster's dense small print without inventing words; `vignette()` darkens the edges.

- **Negative space** paints the giant silhouette in a deeper shade of the ground (tone on tone), so the channel graphic in front of it is still what is read; the reversed split is a region of the other colour with a slanted edge that sweeps across the silhouette from the right as the slider goes up (through its middle at 0.5), and inside it the silhouette is painted in the ground's colour, reversed; highlighted words are reversed out of a bar of the other colour, so they read on the ground, the block and the silhouette alike. With *Channel colour for the red* ticked, every use of the red (`negSpot()`) takes the channel colour.
- **Minimal film poster** takes its ground from the channel colour, muted and darkened (dark) or lightened (light) (`cineGround()`); the backlight is two radial gradients where the silhouette's head is; the ridges are three lines of summed sines, the further the nearer the sky's colour. When a photo fills the canvas and *Photo inside the silhouette* is above 0, the ground (with its light and ridges) is painted again over the photo, the silhouette cut out of it with `destination-out`, and laid on at the slider's opacity: the photo shows only through the silhouette, a double exposure. Photo layers now pass `fill` when they call a look's `background`, to tell a photo filling the canvas from a print.
- **Cyanotype** paints the glowing photogram on a work canvas (a wide blurred halo, a narrow bright rim, the body half-clear) and lays it on at an opacity set by the slider, like a light behind the lettering; the airbrush is blurred ellipses with a fringe of fine dots; the uneven brushing is a few dark radial blotches and strokes brushed in from the edges. The block's halftone (`accent.tone`) reads the *Coarse halftone* slider too.
- **Monochrome film**: the motion ghost is a few blurred copies of the silhouette dragged to one side, fainter the further; the photo's motion blur is the same picture laid again a little to either side; the photo collage takes a few rectangles of the photo, redraws the photo a little off true inside each, keeps them clear of the title's box (`G.title`), and multiplies one in three with the channel colour. The folds are drawn in `post`: each dark on one side, light on the other.
- **Experimental type** does its title effects in `runs`. The cut: a number of slightly slanted lines, set by the slider, cut the line of lettering into bands, each knocked sideways; the echoes: the same line repeated above, fainter each time; the dissolving: the line is painted on a work canvas and read back, and from a point along it, more and more toward its end, small cells are erased and each thrown out as a dot of its colour, before the whole is laid back on the canvas (not during a drag). The giant letters are the first letters of the channel's code, each cut in two along a slant and the halves pulled apart along the cut.

**More settings for the first five looks.** Risograph, 90s animation, record sleeve, editorial and woodblock book each have eight to ten settings, every one changing its effect by degrees: a thing comes in over its own stretch of the slider (fading in, growing, sliding), and "more" adds more of it rather than the same thing a little larger. Tools for them: `wornTexture()`, `wear()` and `titleArea()` are in `looks/kit.js`, the rest in each look's own file:

- `wornTexture(w, h)` and `wear(ctx, w, h, colour, alpha, mode, mask, base)` — wear: soft blotches and clustered specks, white on clear at the canvas's size in units, kept per size and seed. Laid on in the paper's colour with `lighten`, it is where ink did not take or has rubbed off (bare paper stays bare); with `multiply`, grime. A `mask` (painted on a canvas of its own, so several shapes can make it) keeps it to a ring or the edges, and `base` adds an even rub there so the worn shape reads as a whole. Risograph's patchy ink, the record sleeve's ring and edge wear and the woodblock book's uneven printing are all this.
- `softBand()` (a band across the sheet, soft at its sides and uneven along it: the riso's roller streaks) and `ghosted()` (the whole print again, faintly, a little further on, laid with `darken` so bare paper stays bare: the riso's ghosting).
- `titleArea(ctx, env)` — where the title will stand, measured before it is drawn with `titleBlock()` from `title.js` (and `titleBlockVertical()` for a title in columns, in the box the title's painter takes: the subtitle's `titleBox`, or `columnBoxOf()`), so a background can keep its text clear of it. It takes the title layer's own font into account but not a move of the layer. `graphicTop(env, x0, x1)` gives the top of the channel graphic where it stands under a span, for the same purpose. `title.js` measures and draws with the same fitting (`fitLines()`, `fitColumns()`), so the two agree.
- Risograph: `risoShapes()` (a pink disc, slanted blue bars, a half disc in the channel ink, a pink ring, multiplied, each over its own stretch of the slider and kept to the open field); the halftone size sets `toneField()`'s pitch.
- 90s animation: the sky's three colours move toward violet, rose and amber with Dusk; the clouds are a count (each one fading in over its own step); `godRays()` are long wedges screened on from above the top edge; `lensFlare()` is a hot source with streaks and a line of ghosts (rings with a brighter rim, hexagons, a dot) through the middle; the light leak is a radial and a linear gradient screened on from one side; the vignette is the shared `vignette()`.
- Record sleeve: `record()` slides the disc out from the open field's far edge (grooves, two wedges of sheen, a label in the channel colour, greeked small print, the spindle hole); sun fade is three washes (screen, multiply, soft light); the photo halftone is two passes of `dotScreen()`.
- Editorial: `edColumns()` sets a large quotation mark in the channel colour and two columns of greeked body text right of the title (and the column rule) and above the channel graphic, filling paragraph by paragraph; the spot colour is a duotone, multiplied and screened, never the "color" blend mode; the gutter shadow is gradients at the two edges.
- Woodblock book: `songText()` fills the ruled columns the title leaves free, right to left: runs of large characters broken by commentary in two small lines side by side, the characters made up by `fauxGlyph()` (thin horizontals, heavier verticals, in two parts or one, as a Song face builds a character — not real characters); vermilion circles beside some characters and tiny side comments along the rules. `songSeals()` paints three collectors' seals (intaglio, relief, round) on a work canvas — the intaglio one's characters cut out with `destination-out` — and lays them on in multiply. `waterStains()` and `wormholes()` are drawn in `post`.

**A typed setting.** A parameter with `text: true` (and `max`, its length) is a text field instead of a scrub bar: `lookParams()` keeps a string, trimmed and cut to length; the Look sheet shows an input with the parameter's `placeholder`; *Surprise me* keeps what was typed. The experimental type look's *Their letters* is one (up to eight): the giant letters, or each channel's code when it is empty. Up to three keep the two staggered rows; a longer word is set in one line stepping down, its size the smaller of the usual and what lets the word, measured, fit its span.

**Withdrawn looks.** `RETIRED` in `store.js` maps a look that is gone to the nearest one left (`bluetone` → `cyano`, `redstreet` → `negative`, and `ghibli`, the summer look's first name, → `vivid`); any other unknown look falls back to `cel`.

**Animated film poster** (`toon`) and **avant-garde image** (`avant`) came after.

- **Animated film poster**: the bright ground is the channel colour made more vivid (`boost()`), the deep one a night blue barely tinted by it (`toonGround()`); lettering is ink or cream by the ground's lightness (`toonText()`), the colour block a deeper tone of the ground, the floor (`toonFloor()`). `toonPlace()` hangs the sun at the open field's far side, above where the channel graphic stands; `toonSun()` paints a halo, the disc with its sunset gradient and, clipped to it, bands of the ground across its lower half. `toonBurst()` fans wedges out from the sun, under one radial gradient; `toonBeam()` is a lamp hanging in from above and its wedge of light; `toonRoad()` a sine whose swing grows down the field, drawn as far as the slider says, with the graphic's silhouette at its end; `toonParade()` the silhouette standing on the floor, again and again, each smaller, fading in one by one; the giant silhouette is the shared `placeShape()`. Wear is the shared `wear()`, the margin an even-odd frame in `post`.
- **Avant-garde image** works on the picture as it stands in `background`, after the photo (filling the canvas) or the figure (`avFigure()`: the graphic's silhouette, mid grey, soft-edged): `snap()` copies the canvas, `inPixels()` draws in canvas pixels, `softCopy()` is a blur made by drawing down small in two steps. In order: `avSmear()` (fainter copies slid sideways), `avGlow()` (a soft copy screened, or lightened on the light ground), a sharp copy kept (`sharp`), `avFocus()` (the soft copy over everything, then the sharp copy again inside the frame of focus, with a hairline and corner ticks), `avGlass()` (flutes, each squeezing a slice 1.9 times its width into its own, shaded and lit by a gradient; the panel widens from the figure), `avMosaic()` (cells averaged from the sharp copy, each a step lighter or darker, a stepped edge, a few knocked aside; placed with `titleArea()` beside or under the title, held in by the room one way and still growing the other), `avBand()` (the sharp copy in a vertical band, multiplied by the channel colour and screened a little), and the fade. Lettering and everything above stays sharp because it is drawn after.

**Collage** (`collage`), **yellow poster** (`yellow`), **pitch** (`pitch`), **dot matrix** (`dots`) and **neon pop** (`neon`) came after, with a few more shared tools:

- `toneTable(stops, hard)` and `mapTones(ctx, lut, amt)` — a gradient map: each pixel by its lightness onto colour stops, `hard` pulling each step toward the nearer stop (posterizing), laid back within ctx's clip. Pitch's posterized photo and neon pop's photo are this. `hueTurn(c, deg)` turns a colour round the wheel.
- `sampled(ctx, x0, y0, cols, rows, cell, slot)` reads what the canvas holds over a grid of cells, averaged in two steps to one pixel a cell; `shapeCells()` reads the channel graphic's silhouette over the same grid. The dot matrix draws its dots from these with `dotGrid()` (batched by colour; rainbow toward the bottom; Smear stretches the dots into ellipses); `rgbFringe()` lays red and cyan copies a little apart with `lighten`.
- Collage: `tornPiece()` (a rectangle whose edges wander, a white fibre stroke, a soft shadow, `inside` for newsprint), `starburst()`, `barcode()`; `clPieces()` places the pieces round the channel graphic, each kind fading in piece by piece. A photo filling the canvas is torn into horizontal strips: each clipped to a ragged band and drawn from a snapshot slid sideways.
- Yellow poster: `ylRoom()` finds the room right of the title (or under it) for the black silhouette; the white letters (`ylWord()`, `ylLetters()`) may stand behind the title. The silhouette is reversed inside the letters by painting it in the ground's colour with `source-atop` on the letters' work canvas; a photo filling the canvas shows only inside the letters (the yellow laid over it with the letters cut out). The colour block is white, so the house ink of the small parts reads on it as on the yellow.
- Pitch: `pitchLines()` (a pitch's markings in metres, scaled up, turned and squashed), `goalNet()` (a mesh pushed out round where the ball struck), `stadiumBowl()`, `football()`; the ball goes just past the title's end (`titleArea()`).
- Neon pop: `neonSet()` makes the palette from the channel colour (deep, low, mid, hot = its complement turned 135°, pale), turned by Hue shift; the figure is the silhouette lit by a gradient on a work canvas, with a blurred and a solid copy of it a little off for the rim light.
- On a dark colour block the small parts' house ink would vanish: the dot matrix and neon pop map the plates' ink to white or pale, and keep their own lettering colour just off the house ink (a lightness over 0.05), so the brand line on the ground is not swapped with it.

**Basketball poster** (`court`), **velvet illustration** (`velvet`), **psychedelic rave** (`rave`), **liquid chrome** (`chrome`) and **glitch net art** (`netart`) came next, with a few more shared tools: `artPlace(env, S)` (where the channel graphic stands, as `placeShape()` takes it), `bevel()` (volume for a silhouette on a work canvas: copies moved down-right darken all but the upper-left rim, copies moved up-left lighten all but the lower-right one), `iridescent()` (a soap-film gradient) and `glassBubble()`.

- Basketball poster: `bbTeam()` is the channel colour made vivid, royal blue or gold where it would be lost; the varsity number is set on a work canvas, holed by a halftone with `destination-out`, its white and orange outlines added beneath with `destination-over`; `basketball()`, `courtPlan()` (a half court in metres through an isometric projection, with its stand and net) and `hoopFront()`; `bbSpot()` puts the number beside the title or, under a long one, the ball just below its last line and left of the graphic. Wear is `wear()` with `lighten` on the wall, `darken` on navy.
- Velvet: the figure is painted on a work canvas — the body colour, a check with `source-atop`, `bevel()`, a soft highlight — with a blurred halo of the body colour behind it for the fuzzy edge and a blurred ellipse for its shadow; the hills are bezier humps with a lit crest and a blurred copy beneath; grain is laid twice.
- Rave: `liquidBlob()` (a closed curve through wandering radii, iridescent, a blurred glow, highlight arcs), the eclipse halo (a blurred rim, then a black disc), a perspective grid to a vanishing point, an arch with plus marks; the figure is the silhouette filled with `iridescent()` and bevelled; `rgbFringe()` and a soft-copy glow at the end.
- Liquid chrome: `chromeFill()` is a gradient of light bands falling off softly and cut hard by dark ones, as a horizon reflects; drips start at the lowest covered cell of a column of `shapeCells()`; the holographic streak is `iridescent()` laid `source-atop` on the figure plus a screened ellipse trailing off it; glitch slices redraw bands of a snapshot shifted. Its lettering keeps to the light bands (no near-black stripe on black) and stays just off the house ink.
- Glitch net art: `osWindow()` (a bevelled dialog: title bar, close box, a warning, a progress bar or a checkerboard picture, a button), `cursorArrow()`, ASCII rows; the figure is dithered with a 4 × 4 ordered threshold (`bayer()`) over `shapeCells()`; pixel sorting stretches a one-pixel column of a snapshot into a streak, datamosh copies blocks a few cells off (some tinted, some flat colour), scan shift slides whole bands. Highlighted words get a navy selection box.

**Comic-verse** (`verse`), **patterned glass** (`glass`), **jelly machine** (`jelly`), **anime skies** (`skies`) and **spectral engraving** (`spectrum`) are the latest, with these shared tools: `brushwork()` (paints what is there over in short strokes of its own colours: a coarse layer everywhere, a finer one only where the lightness changes fast, each stroke across that change; both grids read with `sampled()` before either is painted), `dotPattern()` (a 45° dot tile as a fill, so a shade or a letter can be filled with Ben-Day dots), `keptLayer()` (see the anime skies) and `glassWarp()` (see below).

- Comic-verse: the figure is three work canvases — the ink line (the shape moved round a circle), the body, the shade (the shape less a copy moved toward the light, then dots and hatching with `source-atop`) and a lit rim; `vsTowers()` draws facades as quadrilaterals running to a vanishing point high above the field, windows batched by colour; `plateShift()` moves the red and blue channels exactly — each is multiplied out of the picture and its moved copy added back with `lighter` — so only edges fringe, on either ground.
- Patterned glass: `glassWarp()` reads the canvas once and writes it back bent. The height field is a squared distance to points scattered one per cell (a dimple per cell, each a small lens, with a seam where it meets the next) on a slow value-noise wobble, sampled on a coarse grid and interpolated; each pixel is read from down its slope, and the slope's angle to a light at the upper left gives each dimple a little relief, a glint and a dark line. The pattern is fixed to the cover and grows about its centre with *Pattern size*; while dragging, every other pixel is worked out.
- Jelly machine: the panel (`jlPanel()`) is sized by its own slider (`board`), not by the jelly: at 0.5 it reaches as far left as a jelly of the slider's default size would, toward 1 it grows to the whole open field, toward 0 it shrinks about its middle to 0.4 of that; so the jelly figure's slider leaves the panel, its circuit, print and knobs as they are (the speakers, cables and display round the jelly follow it). `circuit()` lays buses of parallel traces (`offsetLine()` mitres a polyline sideways) turning through 45°, pads, vias and chips; `speaker()`, `cable()` and `segDigit()` (a slanted seven-segment character, unlit segments faint); the machinery can be softened with `softCopy()` before the jelly — a radial body colour lit from inside, `bevel()`, bubbles and a highlight — is laid down a little clear.
- Anime skies: `cumulus()` paints the lobes' union in shade with a crisp outline, then the light and shade inside it — a deeper base, every big lobe again moved toward the sun in a broad soft gradient (brighter the higher it is), the small bumps lit together, the side away from the sun shaded — at a third of the size, laid on enlarged within the outline; `fleece()` gathers thousands of puffs into two paths, painted at a third of the size and laid on enlarged, which softens them as a blur would; the sun's rays are painted at a quarter. The sky and everything in it (rays, fleece, contrails, cumulus, haze) is one layer kept by `keptLayer()` — a canvas the size of the one drawn on, reused while a key of everything it depends on is unchanged, one per canvas size, none for an export's large canvas — so the sliders in front of it (sea glitter aside, the town, the pole, the leaves) repaint only themselves, and a slider of the sky repaints it at a fraction of its old cost; `skTown()`, `utilityPole()` (its wires come in one by one) and `foliage()` (its area grows evenly with its slider). The horizon rises above the town as *Sea* goes up.
- Spectral engraving: `stippleShape()` reads the silhouette with `shapeCells()`, blurs it broadly both ways, and sets a dot where a random number beats the tone — dark where the blurred shape, read toward the lower right, thins out, along the edge band, and a little toward the lower right; `spectrumStream()` runs threads to the edge, the upper ones turning up through nested rounded corners; a photo is engraved as level lines whose thickness and lift follow its tone.

**City pop night** (`citypop`) and **constructivist** (`construct`) came after them, sharing `reflectBelow()` (the picture above a line mirrored into thin strips below it, each slid sideways a little more toward the foot, over a fill of the water's colour so a slid strip shows water) and `keepClear()` (the boxes furniture keeps off: the title as it will be set, the corner tag, the channel graphic).

- City pop night: `cpCloud()` paints a bank lobe by lobe, the higher behind the lower, each clipped to itself — the lit colour, the body moved down over it (a crescent of light left on top), the deep colour moved further (a dark one beneath) — so the cel tones stay hard. `cpCity()` draws three rows of towers with their windows batched by colour, red lights, neon crowns and signboards; `neonTube()` strokes any path as a tube (two glows, the tube, a white core). The sky, stars, clouds and city are one layer kept by `keptLayer()`; the clouds' scene offset is part of its key, so dragging the sign, the palms or the figure repaints only those. `celPixels()` steps lightness through a table of four soft-edged levels, scales each pixel to its level (hue kept), strengthens its colour and pulls the shadows toward a night teal and the lights warm — used on a photo, on the figure (the channel graphic itself, drawn and stepped, then multiplied into the night's blue and cut back to its silhouette, a shadow crescent and a neon rim added as the shape less a moved copy of itself) and as a layer effect. `vhsTape()` lays a copy of the picture kept to red a little to the right and one kept to blue a little to the left, each with `lighten`, so only what they brighten shows; then scanlines, a band along the foot slid sideways with a spray of noise, a faint rolling line.
- Constructivist: `joinCells()` joins the cells of a grid into rectangles — each started cell grows right, then down, to a size of its own while the cells are allowed, free and alike — and `cnMachine()` paints them in greys chosen by a smooth value noise (`cnNoise()`) plus a light from the upper left, so the tones stay put as *Finer blocks* cuts the grid finer; a few blocks go to ink, paper or red, some get hairlines, slots or a rivet, and masts rise from the highest columns. The coverage comes from the channel graphic's silhouette (`shapeCells()`), or `cnShip()` without one. `cnRays()` sets rays round by the golden angle, so a new one falls in a gap; `cnWedges()` scales each wedge out of its own corner; `cnTruss()` steps its panels by the local depth, so the bays shorten toward the far end. The red is `cnRed()`: the poster red mixed toward the channel colour by *Channel colour for the red*.

**Dark deco** (`deco`) came next. It paints as the animated series painted Gotham, on black: the dark is the ground and only the light is laid on, so most of its painters lay light on dark rather than shade on light.

- The night, stars, moon, searchlights and the far and middle rows of the city (with the fog between them) are one layer kept by `keptLayer()`; the moon's and the searchlights' places are in its key, so dragging the tower, the airship, the sign or the silhouette repaints only those. `dkSky(gilt, red)` gives the four tones of the sky, mixed by *Gilt* toward black and gold and by *Crimson sky* toward Gotham's red; `dkSpot()` turns the channel colour into floodlight (its hue kept, made vivid, a dark blue lightened so it reads as light).
- `dkRow()` sets a row of towers in setbacks, a few far taller than the rest, each crowned one of four deco ways (a needle, stacked arches pricked with lit triangles, a mast and its red light, a stepped pyramid); its windows are batched by colour and lit a few floors at a time, as offices are; on the middle row the pilasters of some towers are floodlit from the foot of each tier, the tall ones' crowns washed too. `dkTower()` is the great tower: five tiers, gold windows between floodlit pilasters, a sunburst lamp on every setback throwing its light up the next, a needle and a beacon; it stands beside the title when there is room (`titleArea()`), and the moon beside it.
- `dkBeams()` adds its wedges with `lighter`, so beams brighten where they cross. `dkMoon()` lays long tapering bars of cloud over the disc, the moon catching their upper edge. `dkAirship()` is a hull lit by the moon above and the city's glow below and takes the first of a few places clear of the title, the tag, the graphic and the brand row (`keepClear()`).
- The colour block is a black base; its `edge()` makes everything with strokes along the edge: a glow of the floodlight, gold rules, a frieze (two dashed strokes, short bars by turns), and the lights reflected in the polished black, which are thick strokes dashed by an irregular pattern, so each dash is a streak across the base, whatever the block's shape.
- The title is set in `runs()`, letters as lamps: a soft dark round them so they stand off the searchlights, a stepped depth in the night's darkest blue, their glow (the letters' shadow, thrown from off the canvas and composited with `screen`, so it brightens what is behind rather than tinting it), a dark keyline, and the letters lit from within — filled near white, then the shadow of everything that is not them cast into them in amber (`litUp()`), only a little way in, so a Chinese character's strokes stay light. The highlighted words go the same way in the channel's colour, as neon (`dkGlass()`); *Gilt* turns the lamps gold (`dkLamp()`). Halation (`dkBloom()`, left out while dragging) is a soft copy of the canvas multiplied by itself twice, so only its brightest parts stay, laid on in screen.
- A photo is painted by `dkPixels()` through `drawPhotoAt()`'s treatment (kept, as city pop's is): its lightness through an S-curve with six soft steps (`DK_CURVE`) onto the night's ramp, warm, saturated colours kept as crimson and gold. As a layer effect on a photo the look has already graded, it reads the ramp by the brightest channel instead, so it is not crushed a second time.

**Silent wasteland** (`wasteland`) came next: the quiet world after the end as digital concept painters paint it, in flat strokes of a broad brush and a palette knife, nothing outlined, every edge lost in haze, one hot accent in a muted palette. Every part of its scene is painted in strokes, not drawn as shapes, so it shares a few painting tools:

- `wlStroke()` adds to the path a stroke of a loaded flat brush (its sides wavering, its head blunt, its tail running dry into two or three ragged fingers), `wlKnife()` a palette-knife stroke (a band with uneven edges, its far end cut square or aslant), `wlDab()` a blob through nine points at uneven distances, `wlTaper()` a stroke narrowing to its tip; `wlBatch()` gathers thousands of strokes by colour into a few dozen fills; `wlBreak()` mixes each stroke's colour afresh, a step lighter or darker and warmer or cooler (in steps, so they still batch), `wlStep()` lighter or darker only. `wlHairs()` lays a tile of brush hairs, lighter and darker streaks, onto a part's own paint (`source-atop`). `wlSoftly()` paints something at a fraction of the canvas's pixels and lays it on enlarged, as paint wet into wet: the megastructure and the far row a little soft, the wash under the clouds and the smoke's body, with crisp strokes over them.
- Every mass is built of strokes, not filled as a shape. The sky is broad, short strokes overlapping, more aslant the higher they lie, over a few soft masses, each stroke in the sky's colour a little higher or lower, so each one shows; the earth is level strokes, broad at the foot and thin toward the horizon, with the brush's hairs through them (the sky has none, which read as a smear), and on the snow broad shadows of a deep blue. The ruined blocks stand in a few masses of their own heights with rubble between (`wlRow()`, not one rhythm along the row): each block upright knife strokes side by side, square-topped or broken aslant, its colour broken over its face, a side plane toward the sun, floors and holes, a light now and then, its edge toward the sun rimmed with warm light. The megastructure is the same at its scale, its foot fading out on its own canvas so that dragged down it has no edge there; the dead forest has dark masses of conifers here and there, more on the snow, each a spire of short level strokes. A cloud layer is broad strokes heaped along it over a soft wash, lit along its underside. The plume is a soft, irregular mass about a slightly curving spine (`wlSpine()`): a core of wavering width, dense and dark at its source and thinning above, and many soft, see-through strokes laid along the rise about it (`wlBillows()`), their place across it wandering with a few slow waves of the seed, so its edges are broken and lost, never a run of round billows; its head opens a little and thins into the sky rather than spreading into a lid, and on a tall cover it leans less, clear of the title. All of it is painted soft (`wlSoftly()`), then lit by one broad gradient across it, light on its side toward the sun, shade by degrees on the other, warm at its foot from the fire, and its foot fades out into the haze (so dragged down onto the ground it has no edge there); a few broken strokes of its own colour go over it. Depth is the sky's own colour: `wlSkyAt()` gives the sky at a height and `wlTone()` what stands there at a depth (the near dark gone over to that sky; `wlDepthFill()` the same as a gradient, for the forest), so the megastructure (depth 0.82), the far row (0.66), the dead forest (0.5) and the near row (0.32) are lost the more the further they are; on the snow the depths are a fifth less, so what stands is darker against the fog. Mist (`wlMist()`) lies along their feet. The horizon stands a little higher or lower by the seed. A few bright touches: sparks over the fire, the sun's glints in the puddles below it, strokes of its light on the wet ground (`wlSunPath()`), the air about it painted in warm strokes (`wlSunAir()`, kept and moved with it), the figure's lamp.
- Each part is kept on its own by `wlKept()`: `keptLayer()`'s way, on a canvas covering only the part's box (a band for a row, the plume's billows as `wlPlumeBox()` finds them, the poles with their wires out past the nearest), keyed on everything it reads (the sun's place for the rims and the poles' light, the hot colour for the sun's air); `wlLay()` lays it down — moved by its scene object's offset (the megastructure, the plume, the poles, the sun's air), so a drag repaints nothing but the light. A part is kept for up to six canvas sizes, the least lately used let go first and never the largest (the editor's), and only for a canvas worth keeping (`wlKeeps()`): one on the page (the editor, the size thumbnails) or one its size (a draft's runs, painted off the page); an export's canvas paints its parts on a canvas of their box once and lets it go, and the work canvases sized for a canvas larger than any on the page (`wlLetGo()`: the soft passes, the water's, the lettering's) are let go after use. A look may now have `leave()`, which `setLook()` calls as another look is chosen; the wasteland's (`wlFreeAll()`) lets everything it keeps go. What is painted live each frame is what is cheap and what adds to what lies under it: the sun's glow and disc, the bars across it, the mist, the fire's glow, the figure, the wet ground. A slider repaints its own part and these, so every slider drags at nearly the full frame rate. The scene is laid out round the title (`wlPlan()`): the sun, the megastructure and the figure stand in the room the title leaves beside it, sizes go by the field's shorter side (a tall cover keeps its ground features in proportion and gains sky), the sun and the figure step down clear of the title where they would stand behind it (`below`), the nearest pole stands short of it, to the side of the corner tag (`keepClear()`'s box for it) and past the lone figure (its wires out past the edge, which would cross the figure, then left off), and on a see-through base the figure's reflection, like the puddles, goes only onto what is painted.
- The wet ground (`wlWater()`) mirrors the band of the picture just above the horizon into the puddles, stretched down over the ground (so a puddle near the foot holds the same glow as one by the horizon, as painters have it), softened at a third of the size and dimmed toward the foot. Each puddle (`wlPuddles()`) is a few level strokes laid together, so its edge is ragged; the reflection is broken by strokes of the ground across it, a pale lip here and there along its far edge, and glints where it lies below the sun. On a see-through base the air is left clear: the sun's glow and the mist go only onto what is painted (`source-atop`), and so do the puddles, which have no ground there to lie on.
- The colour block is a wall in the foreground painted long ago in the channel colour. `paintAccent()` (render.js) now calls a look's `accent.body(ctx, box, nx, ny, C, p)`, when it has one, inside the block's clip after its fill, and hands `accent.edge()` the edge's points besides `run`; the other looks have no `body` and ignore the points. `wlBlock()` greys the channel colour toward the ground's earth and brings its value into a narrow band (about 0.31 on the dusk, 0.36 on the snow): darker than the scene in front of it, light enough for the house ink. `wlBoard()` paints its surface (kept for its box, colour and ground): broad strokes along the edge, each mixed afresh; patches flaked to the concrete; grime run down from the top and splashed up at the foot; light from above, the foot in shade; the hairs. A tall side panel (split) is calmer — no flaked patches, less grime, its colour less broken — and lit along the edge toward the scene, in shade away from it. Its edge (`accent.edge`, along `wlAlong()`'s points, whatever the shape) is strokes reaching a little past it, the light on its lip, a shade under it, and dead grass standing along an edge facing the sky (drips under one facing down).
- A photo is painted over by `wlPaintPhoto()`, through `drawPhotoAt()`'s treatment, which now hands the treatment the copy's width and height and the picture it was made from besides its pixels (`fn(data, w, h, src)`; the other looks' treatments ignore them). After Hertzmann's painterly rendering: the picture is brought into the palette (`wlPixels()`: its lightness grouped into a few soft planes, lifted out of black as haze lifts it, onto the ramp, some of its own colour kept, more of a warm one); the broadest of five brushes lays strokes everywhere, then each finer one only in the cells where the painting so far is still far from the picture seen at that brush's scale, so flat parts keep broad strokes and detail gets fine ones (the finest only where the error is large: eyes, mouths, the darkest accents). Each stroke has a length of its own, two to four times its width, runs both ways along the edges from where it starts (`wlFlow()`: the structure tensor, smoothed; where the picture is flat, a slow drift turning between level and aslant) and is cut short where it would cross an edge seen at its own brush's scale (so a texture finer than the brush does not stop it), never shorter than a dab; its colour is the picture's there mixed afresh, a little lighter or darker, warmer or cooler, richer or greyer. Strokes are laid as a flat brush leaves them (`wlBrush()`: square ends a little aslant, crisp sides, a lighter or darker hair down some broad ones); a last pass lays short lighter strokes on the highlights (among the brightest and brighter than what is about them, so a flat bright sky gets none). The strokes are laid out once (`wlLayStrokes()`) on one analysis image (640 on the long side) made from `src` (the photo itself, drawn down to 1280 first when it is large, or its blurred copy), each cell of each brush with randoms of its own from the look's seed and where it is, and laid in an order drawn the same way: so the preview, a draft and an export place the same strokes, however large their copy, and differ by no more than the copies themselves (a mean of 0.2–0.6 levels). They are remembered for the photo, its ground and seed (`WL_STROKES`, by the copy's fillings for a blurred one), so an export or a paint at another size only paints them. The treatment's key is the ground and the seed alone: *Photo painted* fades the painted copy in over the photo as it is, so no slider paints it again. `treatedOf()` keeps the last three copies a look worked on for a picture (at preview size, and as many at export size), the least lately used refilled first, so one picture shown twice — a background at one blur and a print of it at another — is not painted again on every still paint; they go with the picture (a WeakMap). It also has a `quick` one (brought into the palette only): in a draft that would have the work done afresh each frame (the photo's blur dragged), `drawPhotoAt()` uses it until the drag is let go — a shared change, which no other look's treatment has. The *Painted in strokes* effect keeps its last results (up to eight and 16 MB, so the editor's and every size thumbnail's fit together) by a hash of the pixels it is given (with their size, the ground, the seed, the amount), so a look's slider let go, which has the layer's effects worked again (FX_KEPT keys them on the whole style), finds them there; a result for a canvas larger than any on the page that has shown the look (an export's), or for any canvas before one has (an export while the editor shows another look), is not kept.
- Lettering (`wlLetters()`) is painted on a sign: the letters' colour lightly streaked where the brush dragged (a tile of bristle streaks laid `source-atop`), their edges broken where the dry brush skipped (a band along every edge, `strokeText`, holding only a tile of short level skips, cut out of the letters), more skips inside along the stroke; behind them a soft haze of the other tone so they read over the scene. The accent is read only when a word is highlighted, so its slider leaves the rest of the lettering kept. On a thumbnail the canvas weave and the grain are finer and fainter, scaled with the canvas.

**Origami noir** (`facet`) came last: a rain-soaked neo-noir night retold as faceted flat illustration, every surface a plane of one tone, as if folded from paper.

- `fcDelaunay(P)` triangulates points (after Mapbox's Delaunator: swept outward from the middle, the hull kept as a ring with a hash to find where a new point sees it, each new triangle's edges flipped until no point lies inside another's circle), a millisecond or so for thousands of points. `fcEdges()` reads a picture once, at half its size (each 2 × 2 block's mean, so a photo's grain does not read as an edge), for how sharply its colour (and its alpha, so a cut-out's edge counts) turns there, keeps it at a quarter of its size too, and finds its darkest and lightest but for 2% each way. `fcFacets(d, w, h, size, unit, refine, cut)` cuts it into facets: corners first on its strongest turns in very small cells, read readily enough that a mouth's softer edge counts (an eye, a mouth: small facets of their own), then on its lesser edges in small cells, the sharper the likelier, then one a cell apart everywhere else (broad facets where it is flat; `size` sets the cell, as a share of `unit`); a ring just outside, bowed a little, closes it; each triangle is the mean colour of the pixels whose middles it holds, every other one each way (`fcRaster()`, `fcMeans()`). With `refine`, twice over, the facets that stray most from what they cover (read at a quarter of the size, so grain does not count) get a corner where they stray, and the picture is cut again. With `cut` (a cut-out's pixels) every pixel is read and every facet the subject reaches is whole, its colour the subject's alone, the rest left out: the cut-out's mask, which clips what is drawn after, makes its edge, so no thin facet across the edge leaves the subject partly see-through. The same picture and size give the same facets, as fractions of the picture.
- A photo is drawn as its facets, shapes rather than pixels: `drawPhotoAt()` in `photo.js` takes a treatment with `draw` beside `fn` — `fn(RGBA, w, h, cut)` worked out on a copy of the photo (the preview's blurred copy, for the preview and an export alike, so both draw the same facets), cut to a cut-out's own mask when it has one (`cut` then true), so the facets along its edge carry its colour and not the ground's — and `draw(ctx, model, x, y, w, h)` painting it, sharp at any size. `modelOf()` keeps, for each picture, the last three copies read (by blur, size and mask: a photo at two blurs, a background and its cut-out, each its own) and the last three models worked out of each. A still cover's facets are cut from a copy 1100 px long and refined; while a slider makes facets not cut yet (*Facet size* dragged) they are cut from one 720 px long, unrefined (`quickCap`), until it is let go. `fcPaint()` grades each facet (`fcGrade()`: its lightness spread most of the way over the photo's own range, through a curve that crushes the blacks but keeps the darks apart enough for dark hair or cloth to keep a few planes, and keeps the lights short of white, onto teal — olive by lamplight — or amber where it was warm — the lighter, the less colour it takes to read so, so a highlight on skin is warm cream, not a cold pale — or red, read by its strength, where it was red, lips among it), darkens it away from a key light at the upper right, turns it a little to or from the light by a fold of its own, lays a fog over it on the light ground, and fills the facets one path a colour, each edged a pixel wide in its own colour so no seam shows; facets all whole (a cut-out's, a photo's) lie on their mean colour, so where two meet nothing behind shows through (`fcFill()`). On a canvas worth keeping for, the facets are drawn once at its very pixels, as far as they reach (a cut-out's subject), and kept, so a frame that repaints the photo for the rain or the shafts over it lays them down in one go.
- The ground is the sky's gradient cut into broad planes a shade lighter or darker (four paths). `fcRow()` folds a row of a few broad towers from paper: each a box seen at a corner, its face and its side two planes, the one turned to the light (the neon's middle) lit and warmed the nearer it stands, the other in shade; the planes part the nearer the row, and the near ones get a chamfered corner and a fold across the face; crowns fold as roofs do — a slant, a chamfer, a gable, setbacks to a mast, a spire — each plane lit or in shade as it turns. Their lights sit on a grid of windows of the city's own scale: a few clusters of offices lit late, each in one light, a lone window here and there, now and then a slit up an edge, set on whole pixels (a pixel at least, two apart), so a small cover shows crisp dots rather than a shimmer; a deep band of haze lies between the rows. On the light ground the near towers stand dark against the fog and the far ones are lost in it. `fcWord()` makes the neon's word: in capitals, whole words while they fit in eight characters, else the first word's first eight; `fcLetters()` splits it into what is read as one character each (`Intl.Segmenter`: an emoji with its joiners, a letter with its accents), a space a wider gap; or, `down`, stacked one under another. `fcSignAt()` places it in the room there is, clear of the title and of its subtitle, each its own box so the room beside a short subtitle counts, the corner tag and the channel graphic (`fcKeep()`, from `titleOnly()` and `keepOthers()`, which `keepClear()` is made of too): across the skyline first, the tallest that fits at the first of a few heights just above the street, as near 0.66 across as the room lets it; where the room is narrow, stacked down a blade sign — when its letters so stand a fifth taller, or there is no room across — as near the right as it can be; with no room either way, no sign. Across the reviewer's 72 layouts (two titles, six templates, six sizes) 67 have a sign, 7 of them stacked, and none touches the words. `fcSign()` paints a letter as a sign: dark glass, and on a canvas the size of the word (`fcBox()`) a tube running just inside its outline — the letters filled, less a stroke in from their edge, kept within a wider stroke drawn on a second such canvas (laid on as `destination-in`; the strokes cannot be laid so letter by letter, as each would clear the others), its outer half lit by a stroke laid `source-atop` — with a gap here and there and a stretch burnt out; then the outline's tube in the rim's colour and its core, over strokes of its glow. A CJK character (or an emoji) is a solid tube: its strokes in the rim's colour, a white-hot core along their middles (the glyph less its edge, cut the same way); an emoji as it is. Stacked, the letters stand on a blade of dark glass framed by a tube, hung on a tower of its own (`fcHanger()`, folded as the others), the near towers kept below it; its halo an upright oval. On the light ground the glass is dark, a sign seen by day. The halo behind is painted whole, no edge where a rectangle cut it. The letters are set on whole pixels and kept as painted, so while they stay as they are — the towers or the street moving — they are laid down again in one go. The far row, the haze, the letters and the near row are one layer (`fcBack()`), the letters' place in its key. All of it stands on the street, whose line is set on whole pixels and left out of the key: in a draft that moves the street alone (*Wet ground*), the layer painted is laid down as much lower or higher. Every colour in that layer, and every facet's on the night, is mixed by the lamplight in a straight line, so in a draft in which the lamplight alone has moved both are kept at its two ends and mixed at its value (`fcMix()`: (1 − w) of one and w of the other added up with `lighter`, where laying one over the other laid the see-through haze twice). The wet street (`fcFloor()`) mirrors a band of what stands above it, drawn out downward three and a half times, in bands cut by the ripples, each slid a little aside; on the night the copy is multiplied by itself twice before it is screened on, so the haze sinks into the dark and only the lights streak down, and on the fog it is multiplied on. Streaks of the neon's tubes run down under each letter (under a blade, its frame's and its middle's), broken with the rest by gaps of bare street, filled with the street's own gradient so they show only where something is mirrored. The shafts (`fcShafts()`) and the blinds' light are flat wedges and bars laid on as they are: their light is near white, so screened on the night it would differ by a level or two, and a blend over so much of the picture is dearer. `fcFold()` folds the channel graphic as a sheet is for an origami base, by straight creases from a point a little above its middle into seven broad planes, every other one folded the other way, each in one of four tones by how it turns to the light; the figure stands on the street, or nearer on the wet street, at the first of its places that covers none of the words, the tag, the graphic or the neon, smaller if need be, to 0.4 of its size, and is left out where there is no room.
- What the look keeps lives in a store per canvas size (`fcStore()`): the city behind (`fcLayer()`), the facets of the last two photos drawn, the letters, the figure, a work canvas or two. Only a canvas on the page (the editor, a size's thumbnail) or one the size of one (a draft painted off the page) is kept for (`fcKeeps()`); an export, or another canvas off the page, is painted straight, and the work canvases a canvas larger than any on the page needed are let go as it is done (`fcLetGo()`). At most two large sizes (the editor's, and the one before as its window is resized) and eight small ones are kept, the least lately used let go, so a thumbnail never pushes the editor out and a resized window's every width does not stay. A still cover keeps its own picture alone (the lamplight's two ends and the spare canvases a facet-size drag reuses go as it is let go). `leave()` (`fcFreeAll()`) lets everything go as another look is chosen. With the sample cover and a cut-out, the editor at 2848 px wide keeps 35 MB; resized through 30 widths, with the thumbnails drawn between, 58 MB; after a 2× export 55 MB; after another look is chosen, nothing.
- The title is set in `runs()`: capitals spaced apart (the line drawn smaller so it keeps its measure, as the dark deco's), each glyph filled lit and then, clipped below a slanted fold of its own, filled again in shade; a soft dark behind them (`blurred()`, left out while dragging); the highlighted words neon — strokes of the rim's glow, a pale body, the rim's tube; on the light ground, as a sign seen by day, letters of dark glass, a dark edge round them, the tube lit and its core white-hot. The *Folded facets* effect cuts the layer on a copy at a size of its own (a share of its size in units, 720 px at most on its longer side), so the preview and an export cut the same facets, a long, low layer (a line of text) by its height, finer; on lettering its neon — its vivid, bright pixels, the tubes and their glow — is laid back on as painted (the effects learn a layer's kind from `paintEffects()`'s `E.type`), so the facets fill the letters and the tubes stay crisp.

### 7.3 Tuning the picture

Three levels, from light to deep:

1. **Sliders** — a look's `params`, saved in the profile under `style.lookParams[look]`; no code.
2. **Constants** — in `looks/cyber.js`, `CY` is the cyberpunk palette (field, black, three shades of glass, the red and cyan of the split, white); `echo()` sets the direction and distance of an echo; `tube()` the width and opacity of each layer of a line of light; `chamfer()` is the cut corner.
3. **Hooks** — change how a hook draws: the grid and the giant code in `background`, the interface detail in `frame`, the split, tear and scanlines in `post`, the layers of the lettering in `runs`.

To add a slider, add an entry to the look's `params` and read the value in a hook; the interface and
saving are automatic.

**Random, but holding still** — what a look places at random (the tears, the sweep line) takes its
values from `rand(k)`, which depends on `style.lookSeed` in the profile. While the seed stays the
same, every frame, every size, the preview and the export put things in the same relative places;
*Shuffle the random placement* simply picks another seed.

### 7.4 Look effects on a layer

A look's **material** effects — those that depend only on one thing's own shape and pixels, and move and scale with it (see the to-do list in the README for how effects are sorted) — can be put on a layer the user added.

- **Declared**: a look may have an `elementFx` list of `{ key, name, for, stage, sub?, paint(x, B, amt, E, opt) }`. `for` is the layer types it suits; `stage` its stage; `sub` its own settings (the halftone's size, say). Every look has a list; `FX_TYPES` is the layer types opened: text, asset, photo and solid. An effect for photos only has `for` set to `FX_PHOTO` (mostly a photo toning, `tonesFx` mapping lightness onto the look's colours); the rest `FX_ALL`.
- **Data**: kept on the layer, and staying with it: `L.lookFx = { "look.effect": amount, "look.effect:setting": value }`. It applies whatever look the cover has. `layers.js` keeps only keys of those two shapes, amounts within 0–1, and drops an effect at 0 with its settings.
- **Pipeline**: in `render.js`'s `paintRange`, a layer with effects on (`layerEffects(L)`) is painted on its own on the offscreen canvas, as one below full opacity is. `paintEffects()` then adds the effects within its box — `pixelBox()`: its hit's turned rectangle bounded, in canvas pixels — stage by stage: the fill replaced `fill` → texture `over` → pixels worked on `filter` → outside the outline `behind`. The layer is then composited as a whole.
- **Painters**: they work in the offscreen canvas's pixels and touch only box `B` (an effect outside the outline may paint beyond it). `E.k` is canvas pixels per unit; `E.R(n)` random numbers seeded by the layer's id, so a layer looks the same in every size, the preview and the export; `E.C` the channel colour. Helpers: `region()` copies what the box holds, `shapeIn()` turns a shape one colour, `slideBands()` slides bands sideways. The painters the looks share sit before the `elementFx` lists: `flatFx` (the layer one colour or fill), `tonesFx` (lightness onto colour stops), `eachPixel` (pixel by pixel, mixed in by the strength), `onLayer` (a texture on the layer's own pixels only), `dotsFx` / `halftoneOf` (halftones), `knockWorn` (worn knock-outs), `glowBehind` / `ringsBehind` (glows and rings behind), `trail` (smears), `rePlate` (colour plates moved or scaled), `cutBands` (bands slid sideways), `cellsOf` (read in square cells), `dripsBehind` (drips), `bevelFx` (lit edges), `softened` (softening by drawing down and up). The patterned glass shares `glassPixels()` with the whole-picture glass, its pattern fixed to the cover's origin, so a part worked on alone still lines up. An effect that appears from nothing, a glow or a ring, climbs in opacity over the low strengths first (`Math.min(1, a * 2.5)`, say), so it does not appear whole at the first step.
- **Speed**: a layer with effects is painted on a canvas held in memory (`willReadFrequently`), as are the effects' work canvases (`fxCanvas()`). In the app's web view a canvas lives on the graphics card by default, so reading pixels back, copying from it or drawing it onto itself each make a round trip; held in memory they are plain memory work, and only the box the effects reached (each says with `reach` how far past the layer's box it paints) is laid back. Drips read no pixels back: the layer is laid behind itself 1, 2, 4, 8… pixels lower, then cut into drops. A halftone (Blue Note's *Photo halftone*, Spectrum's dots) is tens of thousands of round dots, the same number at every size, and filled as paths on a canvas held in memory macOS's own drawing took some 60 µs a dot however they were batched: a photo filling the canvas took 3 to 15 s to draw, its size thumbnails, look cards and 3D sheets as long each (a profile whose cover had one opened on an empty window for seconds). `fillDots()` in `kit.js` works the dots out pixel by pixel instead — each dot's edge softened over a pixel, one smaller than a pixel shared out among the four round it, so a halftone too fine to show as dots gives the tone it would — and puts them on the canvas at once: 10 ms at a thumbnail's size, some 150 ms at the canvas's, the picture as it was. Laying many copies of the layer over one another is the same: an outline grown round it (`ringsBehind()`, the shape at 16 offsets on each ring: the two-tone keyline, the varsity outline, the sunlit block, the paper lift, comic colouring), a block's depth, a motion blur's 17 copies — on a canvas held in memory each copy is a pass over the whole box, and the keyline's 96 took 1.4 s round a layer filling the canvas. They are laid on a canvas of the graphics card's instead (`gpuCanvas()`; `onGpu()` takes the layer there once, `ringsBehind()` makes each colour's shape there once, `copiesBehind()` lays the copies and puts what they make behind the layer at once, read back once): about 7 to 13 times faster, the picture the same but for edge pixels the card rounds otherwise. These canvases are let go after a paint larger than an editor's canvas (`letGoGpu()`: an export's, up to 4 × its size, would keep some 130 MB each). Wasteland paints its strokes there too (`wlPaintPhoto()`: some 17,000, as many at every size, for *Painted in strokes* and for the look's own photo), laid out as before on canvases held in memory — the painting so far, read back after each brush, decides where the next strokes go, and the card's edges, a little different, would move them: a quarter faster, a look card's still some 0.3 s. A photo's effects are pixel work over the whole photo (a background photo on a Retina screen is millions of pixels), so `render.js` keeps their result in `FX_KEPT`, per layer and canvas size: while the layer (and the photo it copies), where it is, the picture and its mask, the canvas, the style and the channel colour stay the same, the kept result is laid down. About 16 million pixels are kept in all, the least recently used going first; a layer being dragged is not kept. The pixel loops (`tonesFx`, `eachPixel`) are written out, with no division per pixel. In the timing self-test, `FX_TIMING` records each effect's own time.
- **Letterings turned post effects**: Three slices (cyberpunk), Second-ink overprint (riso), Two-tone outline (90s animation), Sunlit block (summer illustration) and Selected (glitch net art) are those looks' ways of setting a title, done on pixels: bands cut and slipped with a red and cyan echo, an offset second ink, two outlines, navy depth with a warmer lower part, a box with the layer turned white. They are added at the end of the `elementFx` lists, `for` all four layer types.
- **Interface**: `lookFxSection()` in `app.js` shows *This look* and *Borrow from other looks*: the borrowed looks in the order they were added (`BORROWED`, kept in memory by layer id; a look with effects on is carried by the layer's own data). Each look's name has *Clear* (its effects back to 0, the group kept), a borrowed one also *Remove* (the group taken away), and under them *Borrow from other looks…*: `borrowDialog()` opens a window of the looks, each with its effects for this kind of layer in a dashed box, several to be ticked at once, those already borrowed ticked (unticking one takes its effects off); at the foot *Clear all look effects* (the borrowed looks kept) and *Remove all look effects* (taken away), greyed out with nothing to clear. *Surprise me* deals layers effects only from the look it drew.

### 7.5 Scene objects

The things a look paints in the background that may be dragged are named in its `scene: { key: {zh, en} }`. Their default place is not declared apart: it is where the painter puts each by the layout. A painter asks where an object goes through `objAt(key, x, y, ctx, axis)`: (x, y) plus this cover's offset for it (kept as fractions of the canvas, turned into ctx's own frame, right however ctx is turned or scaled), noting where on the canvas it went for its handle; `axis` "x" or "y" keeps it to that direction (a band across the picture, a beam from its top). `shift(key, x, y, ctx)` is its translating form, moving what is painted next as a whole, for an object of many parts (the overprinted shapes, a bank of cloud, a cascade of windows).

- **What hangs on what**: some objects are part of another and go with it: the negative-space poster moves the silhouette's place (`at`) first, and its beam, split and threads are reckoned from the moved place; the comic-verse focus lines and the animated poster's street lamp likewise. Their own offsets are added on top.
- **Caches**: an object painted into a kept layer (the anime skies' sky, `keptLayer()`) needs `sceneKey()` in the cache key; and on a hit the painter does not run, so the object would not be noted: such objects are placed outside the cache, on the main canvas (`moveOf()`), and moved by the difference inside it. Parts painted small (the clouds' shading, the rays) take ctx's transform, so the move carries over.
- **Handles on one spot**: two objects at one point (the comic figure and the centre of its focus lines, the jersey number and the ball) put one handle elsewhere (the figure's head, above the number) and take the difference back.
- **Data**: `cover.scene = { look: { object: { all: [dx, dy], by: { size: [dx, dy] } } } }`, checked by `normalizeScene()` (offsets within ±1.5 canvases, unmoved ones dropped). Like look effects, a part of the cover's data that is about a look.
- The cyberpunk's *Sweep position* slider is gone: the sweep's height is a drag now. *Surprise me* has a four-in-ten chance of moving each of the drawn look's objects a little (up to 6% of the canvas).

## 8. AI-generated assets (`ai.js`, `spec.js`)

### 8.1 Why the model returns data, not code

The built-in stickers are code, so the obvious idea is to have the model return drawing code too.
That was not done, for safety: the code would run in the web view, which can call commands that read
and write app data, save files and make network requests. Running code written by a remote model,
and steered by user input, would hand it all of that.

So the model returns a **sticker spec**: a JSON object listing drawing operations. It keeps every
benefit of the code form — drawn live, sharp at any size, able to follow the channel colour — while
nothing in it is ever executed.

```jsonc
{ "name": { "zh": "爱心", "en": "Heart" }, "color": "#ff3b4f",
  "ops": [
    { "op": "shape", "path": { "curve": [["M",0,82], ["C",-118,8,-74,-96,0,-36], ["C",74,-96,118,8,0,82]] }, "fill": "main" },
    { "op": "detail", "pts": [[-46,-34], [-56,-14]], "color": "white", "lw": 9 }
  ] }
```

- Same coordinate system as the built-in stickers: a 200×200 box centred on the origin.
- Five operations — `shape`, `blob`, `line`, `detail`, `text` — map directly onto the five painters in `stickers.js`; paths are polygon, circle, ellipse, rounded rectangle, star or curve, and a line may also be an arc.
- Any operation may carry `mirror`, which paints it a second time reflected left-to-right. The geometry is reflected, not the canvas, so shadows still fall to the lower right; a mirrored `blob` merges both halves into one silhouette.
- The colour `"main"` stands for the main colour, replaced by the channel colour when tinted.

**The style therefore does not depend on the model behaving: the interpreter guarantees it.** Heavy
ink lines, hard shadows and flat fills are added by the painters; the model only decides shapes and
colours.

### 8.2 Solid objects (`solid.js`)

There are two kinds of AI asset. Besides the flat sticker above there is the **solid**, the
counterpart of the built-in channel graphics:

```jsonc
{ "kind": "solid", "name": { "zh": "洗衣机", "en": "Washing machine" }, "color": "#00e5ff",
  "parts": [
    { "box": [300, 380, 260], "at": [0, 0, 0],    "tone": "white" },
    { "cyl": [110, 30], "axis": "z", "at": [0, 30, 145], "tone": "dark" }
  ],
  "marks": [ { "circle": [0, 30, 82], "z": 161, "fill": "shade", "line": 5 } ] }
```

- `parts` are boxes and cylinders, each with a centre and a tone (white, dark, main). They are turned into the same pieces the channel graphics use and handed to the same renderer, `drawPieces()`: sorted by depth, every face put into one of three tone bands by its orientation, screentone on the dark band, an ink line round every face.
- `marks` are flat details on the front of the object (circles, rectangles, lines), painted over all the pieces.
- The object is **scaled and centred automatically** from its projected extent, so the absolute size a model describes does not matter, only the proportions; the ground shadow is added from the same extent.
- When tinted, the main-toned parts, the screentone and the ground shadow all take the channel colour.

The renderer sorts whole parts, not pixels, so parts that pass deep through each other can come out
in the wrong order. The prompt therefore asks for parts that only touch or overlap slightly.

### 8.3 Validation

`normalizeSpec()` checks a reply item by item: operations must be on the list, numbers must be finite
and are clamped to their range, colours must be a palette name or a hex value, and the number of
operations, points and characters is capped. Anything unknown is refused rather than guessed at;
extra fields are dropped. If a model never used `"main"`, the colour it used most is promoted to the
main colour, so an asset can always follow the channel colour. `parseSpec()` finds the JSON inside a reply that may carry a code fence or
a polite sentence.

A spec that passes is stored as `assets/<id>.json` next to uploaded images. It is one of *My vector assets*
and travels with exported profiles and projects.

### 8.4 Requests and the prompt

`buildRequest()` produces the request for each API style:

| | OpenAI style | Anthropic style |
|---|---|---|
| URL | `{BASE_URL}/chat/completions` | `{BASE_URL}/v1/messages` |
| Authentication | `Authorization: Bearer` | `x-api-key`, or `Authorization: Bearer` |
| Other headers | none | `anthropic-version` |
| System prompt | a `system` message | the top-level `system` field |
| Length parameter | not sent | `max_tokens` (required) |

The OpenAI style deliberately sends no sampling or length parameters: models disagree on which they
accept, and one too many gets the request rejected. `readReply()` reads replies, error messages and
the "cut off" signal of both styles.

When a reply fails validation, `requestSpec()` sends the reply and the validation error back as the
next turns of the conversation so the model can correct it, up to three times. Connection errors
and cut-off replies are not retried: asking again would not change the outcome.

There are two preset prompts with the same structure: `systemPrompt(style)` for flat stickers and
`solidPrompt(style)` for solids. The former contains the style, the coordinate system, the colour
rules, the data format above, step-by-step guidance on designing a sticker, and six examples. Only
the *Style* section is taken from `STYLE_NOTES[style]`; the rest is style-neutral, so a new style
only adds one entry. The examples are themselves valid specs and the unit tests
validate each one, so the prompt and the interpreter cannot drift apart.

### 8.5 Photo repaint (`repaint.js`)

A repaint, and an AI-generated photo, is one fixed step, not an agent: the photo and a style description (a repaint), or a description and an optional reference picture (a new photo), go to an image model, a picture comes back. With no `image`, `buildImageRequest` asks for a new picture: OpenAI at `/images/generations`, Gemini with text alone, Seedream without `image`; a new photo is asked for in the canvas's shape, and Gemini is also given the nearest aspect ratio in `generationConfig.imageConfig.aspectRatio` (`geminiRatio`). `generatePrompt` writes its prompt. The three services each have their own interface; `buildImageRequest` builds each one's request and `readImageReply` finds the picture in each one's reply:

| Service | Request | The photo goes in | The result is in |
|---|---|---|---|
| OpenAI | `POST {base}/images/edits`, Bearer | `images: [{image_url: data URL}]`, `size` in the photo's shape (the older models: the nearest of their three) | `data[0].b64_json` |
| Gemini | `POST {base}/models/{model}:generateContent`, `x-goog-api-key` | `inlineData` in `contents[0].parts` | `inlineData` in `candidates[0].content.parts` |
| Seedream | `POST {base}/images/generations`, Bearer | `image: data URL`, `size: "WxH"`, `response_format: "b64_json"` | `data[0].b64_json`, or `url` (fetched by `fetch_image`) |

Built-in styles are Markdown files in `ui/repaint-styles/`: the file name is the id (what users' settings remember), a front-matter header between `---` lines gives the names, a description, the order, the colours on its card in the repaint window (`swatch`, read by `swatchOf`) and the source (`parseStyle` takes only the keys in `STYLE_KEYS` and reports any other), and the prompt follows. A bundled app cannot list a folder, so `scripts/repaint-styles.mjs` scans it before every build (`beforeBuildCommand`) and writes `index.json`; the interface reads the list at start and a style's file only when it is selected, opened or used (`styleText`, kept once read), with `<!-- -->` comments taken out.

`repaintPrompt` puts the prompt together: the style source (the current look's `repaint(colour)`, a built-in style's file, or the user's words), then "this is a cover background: no text or border, keep the shape", then any extra words. Following a look also asks to keep the composition, so the background layer's placement still fits; presets and custom text decide composition themselves. When the service refuses an optional setting (size, watermark…) with a 400, `refusedParam` finds its name in the message and the request goes again without it, at most three times. The connection test (`imageCheck` / `readImageCheck`) makes no picture: OpenAI and Gemini are asked about the model with a GET, Seedream is sent an empty prompt and its refusal read; `ai_request` can send a GET for this. The user's own styles are Markdown files of the same form in the app data folder `repaint-styles/` (`userStyle` reads them leniently — no header or unknown keys are fine, and unknown keys are kept, so `writeStyle` loses nothing), read again when the window comes back to the front; `reveal_data_dir` opens that folder in the file manager. The `styles` / `custom` that `image-ai.json` held earlier are written out as files once at start (`legacyStyles`). A repaint always starts from the original, kept as the picture record's `original` (`photos/<pid>.original` in the session, `photos.<pid>.original` in project files).

A repaint is kept at its original's own size, so the two lie exactly over each other in the repaint window's compare view and the photo's placement on the cover holds when it is used. `repaintSize` asks each service for the shape nearest the photo's that it paints: OpenAI's newer models and Seedream the photo's own (rounded), OpenAI's older ones the nearest of 1:1, 3:2 and 2:3 (by ratio, so either side of the midpoint cuts away as much); Gemini is told nothing and paints the nearest of its own shapes to the picture sent. `fitPicture()` (`app.js`) then draws what came back at the original's width and height, its middle in that shape (`coverCrop`), as PNG if the original is one and JPEG otherwise, before it goes into the photo store; a picture already that size is kept as it came.

### 8.6 The AI lights (`app.js`)

Each of the three services (`AI_SERVICES`: `text`, `image`, `cut`) has a light, worked out from what the requests the
user made did, and from nothing else: no request is sent to light it, and nothing of it is saved. `AI_LIGHT[k]` holds
how many of its requests are under way (`busy`) and the settings its last one failed with (`failed`) and the settings
one went through with (`worked`), each as `aiSig(k, cfg)`: how a request is sent — the text model's style, address,
token, model, authentication, output limit, timeout and proxy; the image model's service, address, token, model,
timeout and proxy; the cut-out's way — not what it asks for, so a new description or kind of sticker changes nothing.
`aiLight(k)` compares them with the settings in force, so what went before with other settings no longer counts, and
answers `off` (not set up: `aiSetUp()`, `aiReady()`, `imageReady()`, or `canCut()` with `cutReady()`), `busy`, `err` or
`ok`; `aiSays(k)` words it, green being *Connected* once a request went through with these settings and *Ready* till
then; `aiAll()` makes the three one (amber while any works, red when any failed — named when it is one — grey when none
is set up, else green, with those not set up named).

Every request goes through one wrapper, `aiTracked(k, cfg, run, failed)`: the light amber meanwhile (`busy` counted, so
two at once do not put it out early), then, if the settings it was sent with are still those in force, red or green by
`failed(out, err)` (by default: it threw) — `true` a failure, `false` a request that went through, `null` nothing learnt
either way, which leaves `failed` and `worked` as they were. The ways in are wrapped where they are made, so no caller can miss it:
`aiCall()` is `aiTracked("text", …)` round `aiAsk()` (the stickers and graphics, and *Test connection*'s ping);
`imageCall()` round `imageMake()` (repaints and generated photos); `checkImageAi()`, the image model's test, for which a
model missing from the service's list (`notListed`) or a service that lists none (`noList`) is `null`, neither a failure
nor proof that it works; and the cut-out in `ensureMask()`, counting a photo with no subject found as no failure. A
request sent with settings other than those in force, and every request of the self-test (`SELFTESTING`, against its
stand-in server and on its own photos), leaves the lights alone. Where it is shown, each place is an element marked `data-ai` (`AI_SHOW`: the cards' heads, `aiPill()`, the ⋯
menu's line under *AI* and the dot beside *AI* in Settings' nav), and `aiLightsSync()` builds those again, and nothing
else, as a request begins or ends, a setting is typed (the text and image panes' `set`) or a model has downloaded.

## 9. Interaction (`app.js`)

### 9.1 State and refresh

All state is in one object `S`: the current profile, cover, settings, mode, selected size and layer,
and the undo history.

After changing data, code calls `touch({ profile, cover, panel, side, strip })`, which marks what
needs saving, schedules a redraw, rebuilds a part of the window if asked — `panel` the sheet open on the left, or the
Settings page while Settings is open (`renderPanel()`); `side` the layer list, the properties drawer and the bar over
the canvas (`renderSide()`); `strip` the size thumbnails under the canvas (`buildStrip()`, for sizes added, gone or renamed: it keeps each size's
picture till it is drawn again, and shapes a new one as its size, so the tray never overflows for a moment with blank
300 × 150 canvases, its scrollbar making it taller and the canvas smaller) — and records undo history. Saving, redrawing and history are debounced, so a long drag does not write to disk
repeatedly. A change that leaves the Look sheet as it is still has its cards drawn again, half a second later, where
what they show has changed (`refreshLookCards()`, see 9.5).

There is no framework: each part is built with a small element helper, `el()`, and rebuilt whole
when needed. The properties (`.props`, in the drawer) are groups one under another, each made by `psec()`: a line — its
name on a button whose `::after` covers the whole line, an ⓘ from `info()` (a button too, whose click opens a bubble,
`showTip`), what it is set to (`writeSum()`, from `secSum()`) and a chevron — over its controls, one under another
(`.psec-b`). The controls are one family, each a row 34 px high (in `index.html` after `.psec`): `scrub()` a number, a
bar with its name and value inside, dragged anywhere along it by how far the pointer goes (a press alone changes
nothing), a tick at its default that a drag comes to rest on, a double-click typing the value in (`SHOWN`'s `text` and
`read`, `typedValue()`), and a range input under it for Tab, the arrow keys (Shift: ten steps) and a screen reader;
`switchRow()` (and `check()` over it) an on/off row ending in the app's switch, `.tog`; `segs()` a few ways side by side;
`picker()` a choice among many, opening its list with `openPicker()` (`.pklist`, on the page, following its field: the
arrows, Home, End and letters typed go through it, Enter or a click picks, Esc, Tab or a press elsewhere shuts it; the
keys it takes go no further, so its Esc neither shuts the bar's popover nor lets go of the layer); `swatch()` a colour's
row (the whole row opens the colour picker; *Automatic*, or the colour with the way back to it). A control told its
default (`def`) says when it is off it with the class `chg`: a scrub bar's value or a colour then in the channel colour
(`--acc-lite`), with ↺ (`RESET_ICON`, the `.rs` button) at the control's own right end, over it, the value making room
(every control runs to the right edge, under its group's chevron, which takes no clicks: turned, it would be drawn over
the line's button);
`secSum()` puts what is off its default first, and `writeSum()` marks the line with a dot. A control changed in place
(a bar dragged, a switch clicked) writes its group's line again itself (`resum()`), the group not built anew, and while
a bar is dragged (`body.scrubbing`) `renderSide()` waits for it to be let go. A popover of the bar over the canvas holds
a group's controls the same way. A button among them (and in their windows) shows what it does drawn before its name
(`ico()`, from `SHELL_ICONS`). `layerSection()` makes the Layer group
every layer has. Every other window takes the same family: Settings and Export (`segs()` for the format and the
resolution, `qualityBar()` for the JPEG's quality, a `.tog` switch for each size to export, the AI's API style and key
header as `segs()`, its timeouts and reply length as scrub bars of `SHOWN.sec` and `SHOWN.int`, the image service a
`picker()`, and the file names' ＋ opening `openPicker()`), the letter window (`letterEditor()`: a letter's size, angle
and lift as scrub bars, its kind, face, case, tape and hero as pickers, its edge as `segs()`, its paper and ink round
swatches; what may come up by chance a `.multi` row of buttons lit while on), the brush's panel, the Look sheet's
parameters (`.kcol`: `.trow` fields, `switchRow()`, scrub bars ticked at `def`), Surprise
me's chances (`oddsChance()`, a scrub bar of `SHOWN.chance` ticked at the rule's or the recipe's chance), the layout
editor's parts (`.lpart`, a switch each), the 3D view's *Spread* and *Copy from another channel*'s profile (a picker).
`scrub()` takes, besides, `done()` (once a change is made: a drag let go, a value typed, a key, ↺), and `back()` with
`own` and `backTip` where the way back is not to a value (a letter's size back to chance): ↺ then shows while the value
is the user's own and calls `back()`; its box's `_show(v)` shows a value changed elsewhere without calling `oninput`
(the 3D view's spread, by the wheel and *Reset view*); ↺ that builds its window anew leaves the focus on the bar of the
same name. A value typed in and left by a press elsewhere runs `done()` only once that press is over and its click has
landed (`afterPress()`, `PRESS`), and not at all if the click took the bar away, so no window is built anew under a
button being pressed (a chance typed, then *Done*; a letter's angle typed, then *Lock*). Fields, `.seg` and the small text buttons (`.tbtn`, `.linkbtn`: plain words, a light ground under the
pointer, `.danger` red) are styled once for the whole app. The only `select`s left are the top bar's profile and channel
lists, each ending in *＋ New…* and measured by a hidden copy of itself; the cut-out's engines are radio rows (each with
its own download or delete), drawn by the app.
The ⓘ is drawn (`INFO_ICON`), not the character, whose place in the line changes from font to font; `.info` sets its
middle at the middle of the letters beside it, in a line of text (`vertical-align`) or a row of boxes (centred, then
`top` for the line's middle being higher than the letters'). A caption with an ⓘ in a row is `capInfo()`, the row
(`.capi`) keeping the space under the caption so that no margin pulls the caption off the ⓘ's middle.

### 9.2 Working on the canvas

- The pointer position is converted to virtual coordinates and tested against `canvas._hits`, top first. The point is rotated back into each layer's own frame, so rotated layers are hit accurately. `layerAt()` takes the topmost layer that may be picked (`isPickable()`: shown, not locked, not the corner brackets), the selected one keeping the grab under anything at least as big; and while the layout's parts are framed on the canvas (`partsFramed()`, the Layout sheet in front, see *The layout's parts framed* in 9.5), a press inside a part's frame — its hit's whole box, as the frame is drawn, with no margin round it and the colour block's slanted outline (`poly`) set aside (`hitAt([{ ...h, poly: null }], …, 0)`) — takes that part, the smallest where frames lie one in another, unless what was hit is smaller still, or is the selected layer, whose grab stays its own: so a part under another layer, or under a photo filling the canvas, is reached by its frame, and a sticker set on the title still by itself.
- *Hide every layout part* (a switch at the foot of the Layout sheet, `toggleLayout()`) hides every layout layer on this channel's cover (`layoutLayers()`: the layout's own, `isLayout()`, neither free layers nor copies of layout layers) and remembers, in memory and per cover object, which of them were showing (`LAYOUT_HID`); while all are hidden the switch is on, and turned off it brings back just those, or all of them when there is no record (after a change of channel, say). It sets the layers' `visible`, so the eye icons agree and undo works.
- *3D layers* (`set3d()`, the state in `V3`, not saved) puts a canvas of its own (`#cv3d`) over the stage, the cover's canvas hidden and not painted under it. Each layer on this channel's cover is painted alone (`drawCover`'s `o.only`: shown even when hidden, kept to its base's shape when clipped onto one, the cover's main photo and theme still set by what is really shown, no look painted over it all) into a sheet in `V3.sheets`, with a small copy of its alpha (`maskOf()`) and the box of it anything is painted on (`inkBox()`). `stack3d.js` draws them as an axonometric stack — no perspective, so each sheet is one affine transform, drawn only within its box (a layer with little on it costs little), with plainer filtering while the stack moves (`fast`), and `sheetUnder()` maps a point back onto each sheet exactly, front to back, until a mask says the layer has something there. `drawMain()` hands over to `paint3d()`, which marks for painting again only the sheets that changed: none when only the selection did (`queueDraw(false)`, from `selectLayer` and `pickLayers`), the dragged ones and what is clipped with them while a layer's slider holds `LIVE`, the layers `queueDraw(true, ids)` names when something arrives (`V3.changed`, gathered by `moreChanged()` till the next paint), all of them for an edit (`ids` null). What arrives names what it touches: outlines, the sheets painted while one was on its way (`sh.waits`: `outlinesMissed()` counted before and after the sheet); a face read from its files (`ensureFont()`), the layers set in it (`setIn()`; every one when the title is, as the subtitle and the looks follow its lines); the ransom note's faces, its layers; the stage resized or a sheet seen larger, none (`[]`: only sheets painted under another key, another width, size or channel, go again). `paintedWith()` in `layers.js` adds what shows those layers too (their clipping group, a photo's cut-outs, a cut-out weaving with lettering among them); `sheetOrder()` puts them with those still waiting, so a sheet painted and not changed since keeps its picture and the view opening is no longer started over each time an outline comes. They are painted a few a frame (`paintSheets()`, about `SHEET_MS` each, the selected first, then from the top of the stack down), the stack drawn at once with those there are, so it opens without waiting for them all; and as wide as a sheet is seen with the stack open (`sheetNeeds()`, under `sheetCap()`), painted again only once the view has made that well off (turned face on, spread tight). Such a draw, the cover unchanged (`drawStale` false), leaves the size thumbnails and the window's ground alone; `draw3d()` composes the sheets, and `tick3d()` runs it per frame while something eases: opening out of the flat cover and folding back into it (`V3.k`; flat, the stack fits the box the canvas has, so the two meet), a sheet sliding to a new place in the stack (`V3.z`), the scale (held while the view is dragged, then eased to fit), *Reset view*. A pointer on a row of the list (`layerBox`'s pointermove, in the Layers sheet) dims the other sheets; the sheet under the pointer marks its row (`markRows()`). While it is open the bar over the canvas is away; opening Settings closes it at once (`close3d()`). Opening it closes the weave's brush (`brushClose()`), which
paints on the flat canvas, as opening the brush (`brushOpen()`) closes it.
- With FOCUS on (`S.focus`, not saved) the canvas is painted with `o.spot`, the ids `spotIds()` gives (the selection, with a linked photo's other half): every other layer is painted at `SPOT_DIM` of its opacity, a clipping group dimmed or not as a whole; the list greys their rows, and `focusAllows()` refuses to select them from the list, a photo's thumbnail, a link's mark or the 3D view, with a toast. On the canvas nothing is hit-tested: the selected layer's handles work as ever, any other press and drag goes to `focusDrag()`, and the wheel acts only on `focusTargets()` (the movable members of the selected group, or the selected layer; fixed and locked ones do not count); a click beside the canvas no longer ends the selection. `syncFocus()`, run by `renderSide()`, keeps the canvas's dashed frame and tag up to date.
- For the selected layer the handles are checked first: corners resize, sides stretch, the top knob rotates. A photo filling the canvas has a frame only once it no longer covers it (the hit's `covers`, see `showsFrame()`), and only the corners: it is never stretched or turned. Handle size is computed in screen pixels, so handles look the same at any zoom.
- Corner brackets and the Background layer are never dragged; a selected photo filling the canvas is dragged from anywhere on the ground (the background, the colour block, anything locked).
- While the weave's brush paints (`S.brushWin`, see *Weave* in 6.3) the canvas does nothing else: a press paints (`brushDown()`), a move shows the brush's ring, and nothing is hit-tested, selected, dragged, scaled with the wheel or reset with a double-click; of the keys only Esc and undo and redo act.
- With the background selected, a press on a scene object's handle (`sceneGrip()`) drags that object's offset on this cover (`moveScene()`, into `all` or `by` as the scope under the canvas says). While dragged, only the ground and the frame are repainted (`goLive(["bg", "frame"])` — the cyberpunk's sweep is in the frame layer; a light leak or lens flare, painted over everything, is repainted every frame anyway), the other layers kept as images, and in draft (`draftTouch()`): the ground is most of a look's work, and it is the one thing changing. A double-click resets it (`resetScene()`). Handles are white rings edged in black, not the channel colour, to read on any ground; *Hide the handles* (`S.settings.hideScene`) takes them off the canvas and stops them answering a drag. The background's properties have a *Scene objects* group (`sceneSection()`); clicking an object's name has `jumpToScene()` move the system pointer to its handle through Rust's `move_pointer`, and put a fading ring on the page over it (no repaint of the cover).

### 9.3 Redrawing one layer while dragging

While a layer is moved, resized or rotated, the others do not change. So when a drag starts,
`drawCover()` paints everything **under** the dragged layer into one image and everything **over** it
into another, and each frame then does three things: blit the first, repaint the dragged layer, blit
the second. The cache lives in the `o.live` object the interface passes in and is dropped when the
drag ends. Dragging on the canvas and the wheel go this way. Dragging a base or a layer clipped onto
it (see section 6) counts its whole clipping group as dragged, as the group is composited together.

Measured in the engine the app uses (1900 px wide): a full redraw takes about 18 ms in the cel look
and 44 ms in cyberpunk; dragging a layer takes 5–11 ms in either.

A look's costly whole-picture effects (the colour split, so far) are left out of drag frames, under
`setFast()`, and return in the frame after the drag.


The sheets' sliders — a look's own settings, the layout's proportions — are another matter: they may change every layer. While one is dragged (`draftTouch()`), the main canvas is painted as a **draft** (`o.draft`): at the screen's own pixels rather than the Retina ones (a quarter of them on a Retina screen), its photos drawn from their copies on the graphics card (see 7.2, `setDraft()` in `photo.js`), and the size thumbnails wait. The draft holds for as long as the pointer that went down on the slider (or on a scene object, 9.2) is down (`DRAFT.held`), and the full picture is painted as it is let go — `pointerup`, or the slider's `change` (`letGo()`) — not each time the hand rests a moment, which on a heavy look put a whole redraw in the way of the next step; stepped from the keyboard, a quarter of a second after the last step. Only the main button holds it (not a right click, nor a Control-click), and only for input from what it went down on (`DRAFT.from`): a release a context menu took held the next change made from the keyboard — a switch flipped with Space, a setting typed after Tab — for ever, the canvas a draft and the thumbnails waiting. A context menu, or the pointer moved with no button down, lets it go. A layer's own sliders keep using `holdLive()` above.

A look's own setting is read by only some of the layers, so while its slider is dragged (`o.draft` is then `{key}`, the setting) the rest are kept. The look's values note which of them are read (`noteReads()` and `readsInto()` in `looks/kit.js`: until the next `setLook()` the values are a Proxy over themselves, and `lookValues()` hands out the same, so every read is seen; a copy of them all, a cache's key, reads them all): for each layer as it is painted — a layer painted inside another (the lettering a cut-out weaves with) counts for that one too — and, apart, what is read before the layers (the theme, the layout). A painter can only paint otherwise for another value of a setting by reading it, so a layer that did not read `key` when it was last painted cannot have changed. The layers that did are repainted each frame as dragged ones are, with their clipping groups and what weaves with them; the others are kept as images in `o.draft`, runs of them painted once and laid down each frame, as `o.live` keeps them for this canvas, this cover at this size and the look's other values — the cover as given: as drawn at a size where a layer is kept to others it is a copy each time (`coverAt()`), and the runs were painted again every frame (the dark deco's sliders, the tag kept to another size, at 9–12 frames a second where they are 37–46). What only `post` reads (grain, say) keeps every layer. The first frame paints everything (nothing is noted yet), and so does each frame when the setting decides something before the layers (the deco look's *Crimson sky* and *Gilt* go into its theme). A still run above a repainted layer is painted on its own and laid over it, as `o.live`'s are, so a layer in it that does something with what is under it — lays itself on in multiply, screen or "lighter", copies the canvas for a glow or a second impression, works its pixels — does it to its run alone until the slider is let go. Measured against a draft that paints every layer, for every slider of every look over a photo (WebKit): the riso's *Overprinted shapes* up to 141 levels off on 3% of the pixels (its *Misregistration* 177 on a few), the cyberpunk's *Colour split* 242 on 1% (its *Photo tint* 136), five of the glitch net art's sliders 152–202 on 3.5%, four of the dark deco's 57–61 on 15% (its photo is laid on in "lighter" over the night its sliders change, its lettering's glows screened over that); every other slider at most 8 levels off, more than 3 levels on at most a quarter of a percent of the pixels (1–3 levels, not to be seen, on up to a quarter of them). Repainting such layers along with the ones repainted made those drafts exact, and was tried (each layer noted as it is painted, through the canvas's composite operation and its reads): it is not cheap. The photo filling the canvas washes itself in multiply or soft-light in almost every look, so it was repainted with the ground in every frame, and 70 of the 339 sliders lost more than 15% of their frames — the dark deco's three quarters of them, its lettering's glows being the costliest thing it paints. So such layers are kept, and the picture comes right as the slider is let go. A run kept also keeps the scene objects it placed, as it keeps its hits, so their handles stay while a slider or a layer is dragged; they went from the canvas when a repainted layer, or `post`, placed one of its own.

What a canvas is told to draw, the web view draws after, on the graphics card; a frame that comes late is waiting for it. So `queueDraw()` draws in the next animation frame and nowhere else while the page shows (a timer draws instead only while it is hidden, when frames stop, or should no frame come at all for a second): a draw on a timer as well, 150 ms after the input, piled more onto a card that was already behind, and the page — the knob of the slider being dragged with it — was shown less often still. The size thumbnails are drawn one a frame (`drawThumbs()`), not one per turn of the event loop: they went to the card all at once, and a slider taken again a moment after it was let go waited behind them.

Measured in the app's engine (WKWebView on macOS 26, a Retina screen, the sample cover with a 4000 × 3000 photo filling the canvas, each slider dragged for two thirds of a second at 60 steps a second; frames shown a second): the black-and-white film's sliders went from 3–9 (its *Black-and-white photo* 9, the frames up to a quarter of a second apart while the page's own thread sat idle: the card was drawing the grey copy from memory a dozen times a frame) to 58–62; avant-garde image from 16–18 to 54–60, cyanotype 15–18 to 47–61, liquid chrome 15–17 to 40–51, constructivist 23–36 to 47–60, dark deco 3–8 to 36–45 (its photo slider 22; *Crimson sky* 4 to 9, *Gilt* 8 as before), city pop night 9–16 to 17–55, comic-verse 10–13 to 17–48, dot matrix 14–21 to 19–52. Of every look, the first slider and the photo's were as fast or faster. The patterned glass stays at 7–8 for most of its sliders (13 for those only its ground reads, 33 for *Dark corners*) and the glitch net art at 13: their pixel work is script, on the ground and again on the photo, and most of their sliders reach both. A still cover, a thumbnail and an export are painted as before, pixel for pixel.

### 9.4 Undo

After each change (debounced by half a second) the profile and cover are serialised into one string
snapshot, pushed only if it differs from the last, up to 80 steps. Undo parses a snapshot back and
validates it again (`restoreSnap(snap)`: the profile and cover put back on the canvas and saved). Simple, at the
cost of a full copy per step — fine at the current data size. `HOLD.history` holds the debounced commit
(`recordHistory()`) back while a change of several parts is under way that is to be one step, whoever set it
committing once it is over. Once restored, `timeTravel()` writes that step's snapshot again from the state as restored: checking it
fills fields in and orders keys anew, and without that the next commit would take the difference for a
change and cut off the steps to redo (which is how *Redo* once stopped working). An agent's change is one step
too, made by `agentStep()` (see 11.1).

*Empty this cover…* (the ⋯ menu, `clearDialog()`): asked first, then the channel's cover is built anew from the
profile's default design with `channelCover()`, the layers it adds dropped (free ones and copies: only `isLayout()` ones stay), the title, subtitle and tag words kept;
history is committed before and after, so it is one step of undo.

*Dialogs*: a click on the dimmed `#modal` (pressed and let go there — a press dragged out of the dialog
does not count) cancels it: the dialog's own `m.onDismiss` if it waits on an answer (asking which profile
a project opens with: as its *Cancel*), else just closing. A `data-sticky` one does not answer: the
first-run welcome, an export's progress.

*Asking first*: what cannot be taken back is asked about with `askSure({title, body, go, danger})`, which resolves
true or false and is awaited before anything is done. It is a layer of its own, `#ask` (over `#modal`, `#menu` and
Settings, under the toast), so it asks over Settings, the layout editor or another dialog and leaves them as they were;
the confirm button is red (`danger`, the default) and the safe choice, *Cancel*, has the focus; Esc and a click beside it
(pressed and let go there) answer no, Tab goes between its two buttons, and the focus goes back where it was. The
browser's own `confirm()`, `alert()` and `prompt()` are not used: in the desktop app's web view (WKWebView) they do not
wait for the answer and come back true at once, so what they guarded was done behind the question (a profile deleted, a
preset gone, the layout editor's changes thrown away). A test in `tests/logic.test.mjs` fails if one appears in `ui/`.

*Surprise me* (`surprise()`, from its button or Space, see *Keys* in 9.5) deals `RULES.hands.count` hands, six (`dealHand()`), each in a look of its own while a look with a chance is left (those dealt so far in the run go in as `env.not`), shows each in its window as it comes, and puts the first on the canvas; nothing is measured or scored. Hands go back onto the objects there are (the style, each layer by id), a hand that throws is left out, and if none can be dealt the cover is put back. Each hand is dealt by `dealCover(style, cover, env)` in `deal.js`, which holds all of Surprise me's rules: `RULES`, every number it deals by (how many hands and how fast they show; `RULES.odds`, the chances the user may set, kept in `defaults.json`; the sliders, the scene objects, what the cover brings, the letterings; the lettered layers' outline and shadow; the look effects; the places of the user's layers), so a number changed there changes the hands; `FAMILIES` and `RECIPES`, what suits each look; and the order a hand is dealt in — the layout (the canvas's, or a layout preset of the user's), the look and its seed, its sliders, its scene objects, the ground, the words put back (unless where things stand is locked), the title on top, each layer's own choices and letterings, look effects. `app.js` keeps only what needs the cover drawn: `surprise()` (the window and the pace the hands show at), `dealHands()` (the run's hands dealt, each handed as it comes to a callback that shows it), `keepFirst()` (the first put on the canvas, a step of undo of its own, `SURPRISE.step`), `takeHand()` (another put there on that step, false once something has followed it; `dealTake()` is it for a hand clicked), `dealHand()` (`dealCover()`, then the user's layers placed by `dealPlaces()`, which reads `RULES.places`; the locks Surprise me's own unless given), the window (see 9.5), and the window and the sheet the chances are set in.

The chances, `RULES.odds` (`surprise.odds` in `defaults.json`, read from `DEFAULTS` each time, under the user's own in `settings.surprise.odds`; `oddsOf()` holds each between 0 and 1), are of two kinds. `groups`, of which one option is dealt, their chances adding up to 1 (`ODD_OPTIONS`): the look (every look alike unless set), the colour block's shape (likewise), how many look effects a layer but the title and subtitle is given (none, one, two), and whether each is the look dealt's or another look's; and, for every look alike, the title's lettering (`own`, the look's own, or another), its bend (`none`, or one) and the ground (dark, light) — left empty in `RULES.odds`, they are what the looks' recipes give on average over the looks (`builtInGroup()`). `chances`, switches each on by a chance of its own: the brand row's rail; the plates under the channel name, the subtitle, a text layer; an asset tinted; the scene objects moved; the subtitle lettered like the title; and what a look's optional parts default to (`extra`, `toggleOn`, `toggleOff`, for a look whose recipe sets none: `partChance()`). What the user sets in Surprise me's chances (`oddsDialog()` in `app.js`, a window of its own, opened from Surprise me's window and the Look sheet; see below) is kept in `settings.surprise.odds` ({groups, chances}, only what was set); `oddsOf()` lays it over `RULES.odds` — a group of the user's made to add up to 1, an option it leaves out (a look added since) at 0, one adding up to nothing left to the rule's; `set` says which groups are the user's — and the hand is dealt by that (`env.odds`). `pickLook()` draws the look by its chance: none of `env.not` while another with a chance is left, none at 0.

The window has two columns. On the left the looks, a card each (`oddsLooks()`): the cover drawn in that look (`oddsPics()`: the Look sheet's card picture, `LOOKCARDS.pics`, where it was drawn from the cover as it now is, else drawn one a frame and kept there for the sheet too; `ODDS_UI.round` stops a drawing that a newer one replaced), its name, its share and a row of dots. A look's chance is set by its dots, which stand for chances as they are kept rather than for a new number: `d` dots lit are `DOTS[d]` times an even share (one over the number of looks), `DOTS` being `[0, 0.25, 0.5, 1, 2, 4]` — the leftmost off, each more twice as likely — and `EVEN_DOTS` (3) each look's while the user has set none. `withDots(mine, id, d)` sets look `id` alone, every other look's chance left exactly as it was (each an even share, while none was set), and `oddsOf()` makes the group add up to 1 as ever, so the hands are dealt as before until a dot is clicked; `dotsOf(v)` shows a chance kept (one set on the sliders of before, say) on the nearest dot by ratio, one at least for any chance, without changing it. A dot is clicked, or the row (a `slider` for the keyboard) stepped by the arrow keys, Home and End; a key that leaves the
dots where they are (at an end of the row) changes nothing, so a chance between two dots stays as it is, and a change that
would leave no look with a chance is refused with a word (`setDots()`, `odds.lastLook`): a group of nothing would read as
unset and deal every look alike. The looks are folded to the likeliest eight until unfolded (`ODDS_UI.open` holding `look`), or filtered to those above `EVEN_DOTS` or those off (`ODDS_UI.filter`); under them, the optional parts of the look picked (`lookParts()`, as in the Look sheet). On the right, each group of which one is dealt is one bar (`oddsGroup()`) split into a segment an option, as wide as its chance, its name and share shown where they fit — measured once the bar is drawn (`fit()`, again by a `ResizeObserver` as the window is resized) — and in a tip. The white divider between two neighbours (a `separator` the keyboard can take: the arrows move it a point, five with Shift, Home and End all the way), or the divider nearest the pointer within 10 px (of several standing together, as options at 0% make them, the rightmost dragged right and the leftmost dragged left, so an option at 0% can be given a share again), moves share between those two alone, in half points: `moveShare(group, left, right, v)` gives `left` `v` of what the two have and `right` the rest, every other option left as it is. A long group (`fold`) shows its likeliest options and the rest as one segment, whose options keep their shares of it (alike when it had none) as `moveShare()` gives them their sum, until unfolded, when every option is on the bar and named under it. Under the bars the switches, each a scrub bar ticked at its default (`oddsChance()`). `rebalance()`, which moves the others alike as one option is set, is left for a layout preset deleted (`dropOption()`: its option set to 0, its share going to those that have one).

The layout is dealt first, by the group `layout`: `keep`, the canvas's own, and each layout preset by its id
(`ODD_OPTIONS.layout(layouts)`: the options come and go with the presets, `oddsOf(mine, layouts)` putting one made since
at 0 and letting go of one deleted; `RULES.odds.groups.layout` is `{keep: 1}`, so until the user sets the group a hand is
dealt in the canvas's layout, as before there were presets). `pickLayout()` draws one, and draws nothing while `keep` is
certain, so such a hand is dealt from the same random numbers as before. Dealt a preset (`env.layouts`, the presets),
`dealCover()` puts it on before anything else, at the profile's sizes alone (`putLayout()` with `env.sizes`, the profile's
size keys: the block at each, the parts' places there, which are on the cover and where; a size of the preset's own the
profile has not passes by; a part locked stays as it is, the colour block locked its layout too; its elements of the
user's own placing the cover's layers of their kind, or adding some, with `env.put`, the app's `presetEnv()`), and the
words it places stay where it put them rather than going back to the design's, as the layers its elements place do
(`placed`, which `dealCover()` returns and `dealPlaces(R, keep)` passes by); the rest of the hand — the look, the ground, the colour block's shape, the letterings, the user's layers' places
(`dealPlaces()`, on the template dealt) — is dealt on it as ever. With the places or the layout locked (`locks.places`,
`locks.layout`) the canvas's layout stays, whatever the chances: `pickLayout()` is not asked, as when `keep` is certain,
so such a hand is dealt from the same random numbers as one with `keep` at 100%. `dealCover()` returns which was dealt (`layout`: "keep" or the id), which the hand
keeps (its caption in the window names the preset); a hand is the whole style and the layers, so `putHand()`, and
`takeHand()` through it, put its template, adjustments and parts back with it, and the layers its elements added (a hand
with none has none).

The presets are made and seen at the top of the Layout sheet, two to a row, a card each (`presetCards()`; their chances are set in
the chances window, whose layout card points back here), after one for the canvas as it is (*Current*, outlined in
`--acc`). Each card's picture is the cover at the size on the canvas laid out by the preset as the hover preview lays it
out (`laidOut()`, below), so whatever a preset holds shows there; its canvas is kept from one drawing of the sheet to the
next (`PRESET_PICS`, by preset id, "" the canvas's) with what it was drawn from (`base`: the cover, the profile and
the size, worked out once a round for all of them; `own`: the preset and the width in pixels, the screen's own, twice
what is shown on a Retina one, once a round each); `refreshPresetPics()` draws those stale and in sight (an
`IntersectionObserver`) as a drag's frames are drawn (`o.fast` in `drawCover()`: the effects that cost whole-canvas
work left out, which at that size hardly show; the Glass look's picture takes 11 ms so, 75 in full), each when the
page is idle (`whenIdle()`: `requestIdleCallback`, or a short timer in a web view without it), more in one idle moment
while it has room, never while something is dragged (`LIVE`, `drafting()`): when the sheet is drawn, as a card comes into sight, and half a second after the last canvas drawing
(`flushDraw()`), so a change of the cover, the size or the profile, and outlines arrived, are followed. A preset's card,
clicked, puts it on the canvas as one step of undo (`applyLayout()`, `putLayout()`
again, at the profile's sizes, with `presetEnv()`: the parts locked stay, the block's layout too when the block is locked); its ⋯ menu (the
channel cards' `.chmenu`) renames it where it is (`renamePreset()`), edits it (`layoutEditor()`), opens its chance
(`oddsDialog(true, "layouts")`) or deletes it once asked (`deleteLayout()`: its chance goes to the others as `rebalance()` sets an option to 0, `dropOption()`; none of them
having any, the group goes and `keep` is certain again); *＋ New* opens the editor on a new one (`newPreset()`: every part
in it, where the template puts it), which is in the list once saved. A card under the pointer a moment shows the cover laid
out by its preset on the canvas (`hoverPreset()`, `PREVIEW.layout`, see *Previews from cards* in 9.5): `laidOut(p)` puts it on
copies of the profile's style, of the cover's layout parts and of the layers its elements of the user's own place
(`extrasOn()`), in a list of its own, which a layer an element adds joins and leaves with it — the other layers shared,
as nothing there changes them —
by `putLayout()` at the profile's sizes, as `applyLayout()` would, each time the canvas is drawn, so the preview follows
whatever changes meanwhile; the menu's *Edit…*, chance and *Delete* end it before they open their windows. *Save as layout*, a quiet underlined link in its own line
between the canvas and the tray under it, is hidden for now (`SAVE_AS_LAYOUT` false in `app.js`: the line stays empty and takes
no room; the code below is kept) (`#toolsub`, filled by `syncToolbar()` while the editor is in front and empty in Settings:
the stage, that line and the tray are each pinned to a row of their own of `#center`, so the stage keeps the row that grows;
its grey still 5:1 on its ground, white under the pointer), asks a name (`saveLayoutDialog()`) and
keeps the canvas's (`addLayout()`: `takeLayout()` at the profile's sizes, the graphic's places this channel's); the word that says so (`toast()` with a
button) opens the chances at the presets (`oddsDialog(true, "layouts")`).

The editor is a window of its own (in `#modal`; closed, it goes back to the Layout sheet) with a canvas of its own, unrelated to the cover being edited: layers of its
own (`defaultLayers()`, the corner brackets left out, each of `LAYOUT_PARTS` placed and shown as the preset
has it, `sizes` standing for `hide`; one it has no entry for as `newPreset()` has it; the graphic's places those of the
canvas's channel, through `plainPlaces()`), drawn by `drawCover()` with a profile made for it — the cel look on its dark ground,
no photos, the title, subtitle and tag in placeholder words (`layed.sample*`), the profile's brand row, the brand logo as a
stand-in whatever the profile has (`letterLogo()`: the word LOGO, held to the square's width by `textLength`, on a rounded square in the channel colour,
an SVG data URL as `brand.logo`, drawn once `pictureOf()` has it decoded), and the canvas's
channel (a camera for a channel with no graphic, so there is one to place), and the block at the size shown
(`presetLayout()`) as the style's template and adjustments. Its sizes are the profile's and the preset's own (`custom`,
added by width and height, 64 to 8192, 12 at most; one let go keeps what was set for it, for a profile that has it), one
drawn at a time, picked in the strip under the canvas, where the preset is drawn small at each of them (`paintThumbs`),
with *＋ Size* at its end. Beside the canvas, the parts (`.ls-side`) are as tall as the canvas and the strip under
it whichever part is selected (`contain: size`: what is in it never sizes it, so the window does not grow and shrink
from part to part): the list (`.ls-list`), the part selected's name and buttons, then its own settings (`.ls-opts`),
each as tall as it is while there is room, then the settings giving way first and the list after; each scrolls with
its thin bar always there, kept where it was when the side is built again, the list brought, once, to an element just added
or to the kinds to add as they open (`reveal`). Its head holds the preset's name, the scope (`all`, `orient` — the editor's sizes facing that
one's way, what it opens on, so the wide sizes and the others are laid out apart —, `size`), *Cancel* and *Save*.
The canvas is painted as a cover is, so what is caught and the block's diamonds are those of the size shown (`coverAt()`
leaves a part switched off there out). A part is moved, resized, stretched or turned as on the canvas (`handles()`,
`hitAt()`, `adjust()` with no channel, so a move of the graphic is the size's, for every channel; a drag keeps the rest in
`o.live`, and its end lets go of the canvas's move, up and cancel handlers). The colour block has neither the template's list nor its
sliders: selected, it is outlined without square handles (`o.handles` false) and shows the diamonds (`layoutHandles()`);
the middle one moves the edge (`dragLayout()`, the `size` it gives), an end leans it (`size` and `slant`), and the block
itself, dragged, goes to the side the drag leads toward once past about an eighth of the canvas's short side (`sideToward()`, `onSide()`:
along the foot Stack, on top Stack swapped, on the right Split, on the left Split swapped, its adjustments going with it; a
Banner keeps its slim band between top and bottom); each lands where the scope reaches through `setPresetLayout()`, from
the preset as the drag began, so a drag led back leaves it as it was: the side by `sideLike()`, the size and slant on the
layout drawn here as dragged, on any other by `scaleBlock()`, its own block read at a size drawn in it (`blockOf`: a
size's own at that size, an orientation's at the first size here facing that way, else `USUAL_SIZE`, the default at the
first size with none of its own), as drawn there with the parts shown at that size (`drawnBlock`, through
`coverLayout()`, as `draw` paints it). Sizes sharing a layout are each fitted to the parts they have, and one size kept
for all of them would snap them to one; so every other size a resize reaches is also given a block of its own, a share
of the one it showed, and none jumps. A size with a block of its own says so, with
*Follow again*. With the block selected, a button for each side (`SIDES` in `layout.js`: bottom, top, right, left, the one
it lies on at the size shown lit) does what a drag to that side does (`toSide()`: `sideLike()` from the side it lies on
here, through `reblock()` and `setPresetLayout()`, where the scope reaches); *Reset size and slant* (`resetBlock()`)
puts back its template's default size and slant (`blockDefault()`, see 5.2), on its side; the block has no *Reset its place*, its place being its side, set
by those buttons (any other part has, `reset()`, as `resetPlacement()` does, by the scope). The title, subtitle, tag or
channel name selected (`COLUMN_PARTS`) has a *Vertical* switch under it, the editor layer's `vertical`, drawn so on the
canvas and taken back by `takeParts()` (off where the preset says nothing of it). Left of the canvas each part's row (`.lpart`) ends in a switch that puts it in or out at the sizes the scope reaches,
the focus kept on it as the list is built again (*some sizes* beside one on at some only; a click on the name selects
it); the part selected, once not at the size shown (switched off there, or a size picked
where it is not), gives the selection to the first part that is (`keepSel`), so no frame, diamond or line about the
block's side is left over a part that is not drawn — and `layoutHandles()` gives none for a block left out (`off`, as
`coverAt()` has it at a size it is not on at). The width and height typed for *＋ Size* are kept while the head, the parts and the strip
are built again. Under the parts, the elements of the user's own (`E.extras`: `{ id, kind, sticker? }`, in order):
*＋ Add an element* (`E.picking`) offers `EXTRA_KINDS` as four buttons, and the one picked (`addExtra()`, while fewer
than `LAYOUTS.extras`) comes in as `newExtra()` has it, at every size, selected; each is drawn by a stand-in layer under
its id (`standIn`: `extraLayer()` with the editor's words, `layed.sampleText`, in the look's lettering, the channel colour,
and for a picture the photo `portrait`, `PORTRAIT`, an SVG of a grey head and shoulders decoded by `pictureOf()` into the
editor's own photos; put where `insertExtra()` would put a layer added to a cover), caught, moved, sized, switched and
reset as a part is (`ok`, `ids()`, `keepSel`; reset at every size puts back `newExtra()`'s place), named by its kind and
its number among those of its kind (`nameOf`), a text one with *Vertical* too, its ⓘ saying what it places on a cover
(`layed.extraHint.*`), let go of by its × or *Remove* (`dropExtra()`). *Save* takes the parts back off its layers
(`takeParts(layers, keys, was)`, which keeps the preset's places and hiding at another profile's sizes) and the elements
(`takeExtras()`, likewise); nothing touches the cover until a preset is put on it.

By the recipes, the looks fall into three families (`FAMILIES`: pop, print, light), each with the chance of the dark ground, of the title keeping the look's own lettering (`auto`), the other letterings that suit it by weight, and the chance and ways of a bend; `RECIPES` gives each look its family and what differs, the chance each part that is off by default comes on, and `tune()` for sliders that go together (rain brings mist in the dark deco). `tuneLook()` sets each slider within 0.3 of the range about its default, likeliest near it (off the very ends unless its default is there), and lets in at most `EXTRAS` (2) of the parts off by default; `letterFor()` deals a layer's lettering (the subtitle like the title by the odds' `subtitleLikeTitle`, never bent; an outline lettering only where outlines can be read; not the lettering named after the look, which is its own already). The families and the looks' own letterings, bends and dark ground are no longer dealt by look: `recipeOf()` takes the dark ground, the lettering (`own`, then `fx` by weight) and the bend (`bend`, then `bends`) from the odds' groups, the same for every look, and keeps of the look's recipe its optional parts and `tune()`. The user sets a look's optional parts, each on its own, in the Look sheet (`recipeBox()`, under the look's sliders) and in Surprise me's chances (`lookParts()`, the same in both); what they change is kept in `settings.recipes[look].params` and `baseRecipe()` lays it over the table's. While the user has not set a group (`odds.set`), the cover turns it (`coverContext()`, passed to `recipeOf()`): a long title — a line wider than 8 characters, or three lines — is bent at 0.3 of the chance and given a sticker's rim or depth half as often, a short one bent half as often again (0.5 at most); a channel colour near black (luminance under 0.05) makes the dark ground 0.6 as likely, a very bright one (over 0.6: near white, a light yellow) the dark ground likelier — none of this for a group the user set, which is dealt exactly as set. `dealPlaces()` takes, of a dozen places allowed, the one that covers the least of the title and the cut-out subjects (`overlap()`), and makes a layer that would still cover more than a quarter of one 0.85 as large and places it again, four times at most; a layer does not keep clear of the subjects it carries (its own, a cut-out itself, and its linked cut-outs, whose boxes go where it goes; a cut-out lying exactly over it is put back over it at its new size and angle, `alignedT()`), those carrying any are placed first, and one clipped into a layer below keeps clear of nothing. Each hand deals only how the cover is drawn: the look and its sliders, dark or light
ground, the colour block's shape, text effects, and the look effects of the user's layers
(mostly from the drawn look, now and then from another); whether lettering is set in columns and ruled is left alone
(`vertical`, `rules`: the user's, but as a layout preset dealt sets the parts' `vertical`; a layer in columns is dealt no bend, see 6.1.1), and so are the template, its
proportions, each size's own layout and where the layout layers stand (unless a layout preset is dealt, above, whose elements of the user's own also keep the layers they place where it puts them), but for the title, which goes to the top of the layers with whatever
is clipped into it (unless it is clipped onto another), below only the subjects cut out of photos that stood over it and the assets woven with it (`weave.with` holding the title), which go on passing in front of it and behind it. `dealPlaces()` gives the user's layers a new place, angle and size, a text layer above `wordsFoot()` (layout.js: the badges' line on a landscape cover, else the bottom 14%, `WORDS_FOOT` in platforms.js, which `meetStandards()` keeps the tag and the channel name above too):
each size is drawn small once to learn every layer's box, then for the new angle and size the range the
centre may take at each size (less a hair for outlines and shadows) is found, and a place drawn within
what all sizes allow; when nothing is allowed the layer is set straighter, then smaller. Layers locked,
filling the canvas, or cut-outs following their photo are left where they are, and so is a weave (`wovenIds()` in
`layers.js`: a cut-out or an asset woven with lettering below it, and that lettering), as a layer locked is, so the
weave still shows: neither is placed anew, a photo whose cut-out weaves stays with it, and the lettering does not go
back to the design either. Before that, words the user
moved or resized go back where the rules put them: the layout's lettered layers (`LETTERED`) to their
placement in the profile's design (`channelCover(null, …)`), the user's text layers to a new one's size with
no size of their own. While hands are dealt, a step waiting to be recorded (`recordHistory()`) waits too. `settings.surprise.locks`
(`SURPRISE_LOCKS` in `store.js`) leaves the look and its sliders, the ground, the letterings, every place
(and the layout with them) or the layout alone (`layout`: the canvas's, no preset dealt, everything else dealt as ever). The hands show in Surprise me's window as they come (`dealOpen()`, `dealShow()`: each drawn at
the size shown, with its look; `RULES.hands.pace`, 90 ms, the least between two, so they can be seen arriving);
the first, on the canvas, is marked (`dealKept()`), and `dealTake()` puts another there on the same step of undo
while nothing has followed (an undo or redo, which the window lets through, closes it). The window lies over the whole
of the app, the cover dimmed behind it (see 9.5); `body.dealing` keeps the page, and the window's own buttons, from
being worked while hands are dealt onto the cover.

### 9.5 The window

**Shell and glass.** A top bar over the columns (`.body`, a grid): the dock, the sheet open (`#left`, `#panel`), the
canvas (`#center`: the stage, and under it the tray — the size shown, `#toolbar`; every size's thumbnail, `#strip`; the
scope, `#scope`, its label and choices centred on the line as the size's name and pixels are, which wraps under the
sizes when there is no room beside them) and the properties drawer (`#right`, `#side`), whose column goes to the canvas while it is shut (`.nodrawer`). The sheet and the drawer are dragged wider by
their inner edges (`columns()`, kept in `settings.columns`; each column's least and first widths, `column()`, are
`ui.columns` in `defaults.json`), the canvas keeping `centreMin()` at the least (`ui.centreMin`, 360 px). Behind it all lies the
cover itself: `paintAmbient()` copies the main canvas, 48 pixels wide, into `#amb` a moment after each drawing
(`later("ambient", …)` in `flushDraw()`), and CSS blurs and darkens it to fill the window (`#ambient`). A new ground
fades in over 0.7 s: the ground as seen until then goes on a second canvas, `#amb0`, over the new one and fades out
(`AMB.fade`, an animation of its opacity), then is hidden, so the window has two blurred layers only while it fades; a
repaint during a fade starts from what is seen at that moment. A change too small to show through the blur
(`ambientMoved()`: the pixels apart by 2 in 255 on average, or less), or `prefers-reduced-motion`, is painted straight in. Every panel
over it is a pane of frosted glass (`.glass`: a translucent fill and `backdrop-filter`), so the window takes its colours
from the cover being made. The glass is not free: the web view blurs again what lies under a pane whenever that
changes, and while something is dragged that can cost frames. So where it cannot blur at all (`CAN_BLUR`), or the
user turned it off (*Frosted glass* in the ⋯ menu: `settings.glass`, `setGlass(on, true)`), `html.solid` makes every
pane a plain translucent colour. And `glassWatch()`, run in each frame the canvas is drawn in (`drawInFrame()`, which `queueDraw()` asks for), times the frames while something is
dragged by the pointer (`GLASS.down`, between a `pointerdown` and its `pointerup`; a slider held, `DRAFT.down`; a layer,
`LIVE` — keys held on a slider set `LIVE` too, but their gaps are the keys', so they are not counted): when the middle
gap of 90 passes `ui.glassSlowMs` in `defaults.json` (28 ms) with the glass on, it marks them slow (`GLASS.slow`), and that drag's `pointerup` shows a note
once on this computer (`settings.glassHint`) with a button that makes the panes plain; a drag that ends otherwise
(`pointercancel`, the window's `blur`, a pointer moving with no button down) forgets it. The glass never changes by itself: only the user's hand turns it off.

**The title bar.** In the desktop app the window has no title bar of its own, on any system. On macOS it is see-through
(`titleBarStyle: "Overlay"`, `hiddenTitle` and `trafficLightPosition` in `tauri.conf.json`), the system's buttons placed
in the top bar's left end (the top bar sits 12 px in and is 56 px tall, so its middle is 40 px down). On Windows and
Linux there is none (`"decorations": false` in `tauri.windows.conf.json` and `tauri.linux.conf.json`, Tauri's
platform files, merged over `tauri.conf.json`; their `app.windows` replaces the whole list, so it repeats the window's
other settings, and on Windows `"shadow": true` keeps its shadow and, on Windows 11, its rounded corners), and the page
draws the same three buttons in the same place (`#winbtns`): 12 px circles 20 px apart, in a Mac's red, yellow and
green, their ×, − and + shown while the pointer is over them, grey while another window is the one in use
(`onFocusChanged`). They call the window's `close()`, `minimize()` and `toggleMaximize()` (nothing in the app holds a
close back, so it closes as the system's button did), and a press on them leaves a field its focus, as a Mac's do.
The window's edges still resize it: Tauri's runtime does that for a window without decorations (`undecorated_resizing`
in tauri-runtime-wry), so the page has no edges of its own. `ownTitleBar()`, called from `start()` in the desktop app
(`HOST === "tauri"`), sets `html.ownbar`, which leaves the buttons room in the top bar and keeps Settings' window and
the dialogs (`#modal`) clear of them, and marks the top bar
`data-tauri-drag-region="deep"` (Tauri's own: the window moves from anywhere in it but its buttons and lists, a double
click zooms it) and `.app` a bare one (its margin). Settings, a dialog (`#modal`) and Surprise me's window cover both;
while one is open a strip along the window's top, `#winbar` (22 px, clear of Surprise me's Undo below it), moves the
window in their place; the drawn buttons stay over them all, as a Mac's do. Tauri's script stops the press there, so a press on the top bar (not on its buttons or lists),
the margin itself or the strip takes the focus from a field by hand, as a press on nothing would. In a narrow window the top bar's lists give way (`.app`'s one column is
`minmax(0,1fr)`, the lists' `min-width:0`) and below 1200 px *Saved as you go* goes, so ⋯ stays in the window. In full
screen the buttons are gone: a resize asks `isFullscreen()` and takes their room (and the drawn buttons) away, and on a
Mac asks again a second later, as the way out of full screen is over only after its animation. Moving the window needs
`core:window:allow-start-dragging`, the drawn buttons `core:window:allow-minimize`, `allow-toggle-maximize` and
`allow-close` (`capabilities/default.json`); `core:default` allows the double click's zoom.

**Narrow windows.** With the drawer open the canvas could be squeezed between two side columns; so where it would be
left narrower than `centreRoomy()` (`ui.centreRoomy` in `defaults.json`, 560 px), `columns()` sets `.tight` on `#body`: the sheet's column is hidden and the
drawer takes its place. It judges by the window's width alone, the side columns taken at their default widths, so that
a column's edge dragged never hides the sheet: a canvas left narrower by a hand is the hand's. `sheetHidden()` says whether it is so. The dock's
buttons, and the chances window's way to the Layout sheet, go through `showSheet(k)`, which shows the sheet, shutting the
drawer first when it stands in the sheet's place. Meanwhile no dock button is lit, and `onLookSheet()` and
`onStyleTab()` are false: the look cards are not drawn, and a change of size or scope does not rebuild a sheet not
shown (a `touch()` asking for the panel still does). When `columns()` flips it, it syncs the dock and, as the sheet
comes back, draws it again as things now are; and every time it runs (a resize, a column dragged, the drawer opened or
shut) it places any open letter, crop or weave window or brush panel again (`overLeft()`), the crop's picture drawn
anew to its width once the column has settled. A button pressed that is drawn anew keeps the keyboard's place:
`setDrawer()` gives the focus to the drawer's ✕ when it was in the sheet, to the sheet's dock button when it was in the
drawer; `showSheet()` to the dock's lit button. Below 1000 px wide (`STACKED`; the desktop app's window is never narrower than 1080) everything stands one under
another instead, the dock a row of buttons, and nothing is tight. Where scrollbars take room (Windows, Linux, a Mac set
to show them always), `start()` finds it out with a probe and sets `html.bars`, and every scrollbar is drawn thin, as
the sheets' are. A pane's bar is not cut to its rounded corners, so its track stops a little short of them at either
end (`::-webkit-scrollbar-track` margins: the sheets, the drawer and Settings' page always, the dialogs, the ⋯ menu,
the bar's popover and the letter, crop, weave and brush windows under `html.bars`), and the bar stays inside the pane.
A pane whose bar is always drawn so (`.scroll`: the sheets, the drawer, Settings' page; the Look sheet's cards; the
layout editor's list of parts and settings of the part selected) scrolls with `overflow-y: scroll`, not `auto` with `scrollbar-gutter:
stable`: WebKit keeps a gutter as wide as its own bar (17 px) until there is something to scroll, then draws this one
(10 px), so what was in it moved each time a group opened or shut. Always there, with nothing to scroll the bar shows
no thumb, its track clear; the pane's right padding is that much less, so its content stands as far from either edge.

**The top bar and ⋯.** `syncTop()` builds the bar: the profile and the channel (two menus, each ending, after an `<hr>`, in an entry that makes a new one, `NEW_ONE`: `newFromTop()` puts the list back on what is shown, makes it with `profileActions.new()` or `addChannel()` — what Settings' *New* and its card to add a channel do — and then `switchChannel()` to it, and opens Settings at *Brand & channels* with its name field focused and selected; `fitList()` keeps each list as wide as its widest name, which that longer entry would otherwise make it, and `stayOff()` keeps the arrow keys on a closed list, where they change the choice at once off the Mac, from stepping onto it), undo and redo, Surprise
me (its key, Space, in a `kbd` on it), Export (its tip naming ⌘E), and ⋯ (`MENU`, `renderMenu()`, placed under its button by `openMenu()`): what changes a whole cover (*Set
as the default design* and *Restore the default design*, `saveDesign()` and `loadDesign()`; *Empty this cover…*,
`clearDialog()`), the profile's three Settings pages, each saying what it holds (how many channels, how many sizes,
through `counted(key, n, …)`, which picks a string's `.one` form for one; every count whose wording changes for one
goes through it; *AI*'s line is the three AI lights as one, `AI_SHOW.menu`, see 8.6), the other
profiles to switch to (unfolded on asking, `MENU.profiles`), *Project file* (*Open project…* and *Save project*,
`projectActions`, each made by `keyed()` with its key in a `kbd` at its end and `aria-keyshortcuts`; left out where the
host can neither save nor download a file, `CAN_PROJECT`), *Agents* in the desktop app (Settings → Agents, saying
whether the endpoint is on and its port, `mcpSays()`), the glass and the language. A press beside it, or Esc,
shuts it. A key is written as `MOD_KEY` has it: ⌘ on a Mac, Ctrl+ elsewhere — and the app's own shortcuts (⌘E, ⌘S,
⌘O) are taken so too (`cmd`: the Meta key alone on a Mac, where Control and a letter move the caret in a field; Ctrl
elsewhere; neither with Shift or Alt).

**Keys.** One `keydown` listener on the window takes them, in this order: ⌘S and ⌘O never reach the browser's or web
view's own Save and Open (`preventDefault()` first, wherever they do nothing here); a question asked (`askSure()`) takes every key: Esc
is its no, Tab moves between its buttons and Enter presses the one with the focus, a key held from before answers nothing;
Esc shuts the ⋯ menu; with a dialog
open in `#modal`, Esc is its cancel (but in a field being typed in) and ⌘E is the Export window's main button
(`exportTicked()`, even from its file name), and no other key goes past it; ⌘S, and ⌘O but in a field, save or open a
project file from the editor while Surprise me's window is shut and no deal is under way — ⌘S even in a field, as what is
typed is on the cover already; Esc leaves Settings, then shuts the bar's popover; nothing further while a field has the
focus (a bar's range or a colour is none: undo, ⌘D and Esc still act, but its arrows, Home, End and Page keys are its own,
Space deals nothing, and Delete, Backspace and F reach the layer only from its own properties, the drawer or the bar's
popover, not from the Look sheet, the letter window or the 3D view); Space is left to a control the keyboard brought the focus to (a button or the like: `KEYFOCUS`, noted as the
focus arrives, from `focusin` when the element is `:focus-visible` then, and let go at any `pointerdown` — asked at the
key itself, `:focus-visible` would not tell, as browsers mark whatever has the focus so once a key is down, by the spec's own heuristic), so Space
presses it as ever, and nothing is dealt; nothing further while a deal is under way (`SURPRISE.busy`). With
Surprise me's window open only Esc (`dealUndo()`), Space (another deal) and undo and redo act; then the letter, crop
and weave windows' Esc and the brush's keys; undo and redo; then Space, which deals (`surprise()`) with the editor in
front and neither the ⋯ menu, the bar's popover (`FTB.pop`), the 3D view, a drag on the canvas (`LIVE`, `FTB.drag`) nor
the letter, crop or weave window in the way; and in the editor alone ⌘E (`exportDialog()`, the ⋯ menu shut first), ⌘D,
Esc (`selectNothing()`), F, Delete and the arrows, these two not while nothing is selected (`FTB.away`). Space dealing is taken from the button the mouse last pressed (`preventDefault()`), so a
deal is not made twice; a key held down (`e.repeat`) deals, opens, saves or exports once.

**The dock and the sheets.** `syncTabs()` fills the dock with a button a sheet (`TABS.edit`; the icons `SHELL_ICONS`,
drawn by `ico()`), one sheet open at a time (`S.tab.edit`, not saved; `showSheet()`): Content (`contentSheet()`: the channel and the
cover's words, the long notes behind an ⓘ, *Copy from another channel…* at its foot), Look (`lookSheet()`), Layout
(`layoutSheet()`: the layout presets, this size's template while `TEMPLATE_BOX` lets it show, the colour block's edge, which parts show; *Hide every
layout part* and *Reset the layout parts' places* at its foot), Assets (`assetsSheet()`: the ways to add, the search, this cover's
photos, then shelves showing their first two rows until *All*, `shelf()`, `SHELVES`) and Layers (`layersSheet()`).
`renderPanel()` builds the open sheet whole; each but Layers begins with its own heading (`sheetHead()`). Whether a change bears on it is asked of
what it shows, so it is built again only then: `onCoverTab()` (Content, Layout or Assets: the cover's words, parts and
photos), `onStyleTab()` (Look or Layout: the size shown and its layout), `onLookSheet()`, `onAssetsTab()` — the second
and third false while the sheet is hidden (above). The Layers
sheet holds `layerBox`, one element kept from one drawing to the next and filled by `renderSide()`, since the list
follows the layers rather than the sheet. It is the column's height (index.html: `#panel:has(>#layerbox)`), the list
scrolling on its own between the head and the bar at the foot, its place kept as the sheet is filled again (`.lyscroll`): as tall
as its rows, down to the Background at most, which stands under a line below it always in sight (`.lybase`); where rows go
on past an edge they fade out there (`listFades()`, kept up by a ResizeObserver as the window changes). The head: *Layers*, how
many layers the cover has, and *3D* (`set3d()`); then the chips and *FOCUS* with its key, F (`setFocus()`); then a row a
layer (`layerRow()`: a ⋮⋮ grip on a row that can be dragged, its place left
empty on one that cannot; a 36-px tile, `layerTile()` — the first letters of the words a lettering layer sets
(`LETTERING`, `initials()`), a small picture of a photo or bitmap (`tilePic()`, kept by picture), of the Background and
of the colour block (`layerPics()`: each painted alone by `drawCover`'s `o.only`, small, 300 ms after the cover, its
look or the size shown last changed, not at each rebuild), a colour layer's colour, an icon for the rest; the name in
bold over a grey line, `layerSub()`: the words it sets, the picture it is from, its colour, the block's edge, the look
the ground is painted in — or that it is not shown at this size; its chips, *Layout*, *Copy*, a linked photo's marks
(`layerKinds()`) and the sizes it is kept to (`sizesNote()`); the eye and the lock, shown under the pointer, on the
selected row, or when hidden or locked, the Background's padlock always), a row under the pointer framed on the canvas
(`hoverShow()`), and at the foot the selected layer with duplicate, up, down, hide or show (a group's layers together),
the drawer and delete (on a layout layer, disabled, saying to hide it). Chips over the list narrow it for the session (`LAYERS_UI.filter`, by
`LAYER_FILTERS`: every layer, those the user added, `isAdded()`, or the layout's own, `isLayout()`), the last two with how many;
while only some are listed no row is `draggable`, as where a row would land among those not listed cannot be shown, and a
line says so; the selection is not touched, so a selected layer the list leaves out is still named under it.

**Searching the Assets sheet.** `ASSETS_UI` holds, for the session, the words in the sheet's search field (`q`) and the
kind of picture the photo shelf shows alone (`kind`). While there are words, `assetsFound()` takes the place of
everything under the field: what they find on each shelf, under the shelf's name (`shelf()` with keys of their own, so
a shelf unfolded there is not unfolded on the sheet) — the library's pictures by their names and kinds, stickers by
their names in both languages and their groups', channel graphics by their names, the user's vector assets by their
names (an AI asset's in both languages, from its spec) and their folders' — each tile made as on its shelf, so it is
clicked, dragged or deleted the same way. `matches()` wants every word, compared `folded()` (NFKC, one case: full-width
letters and digits as half-width); a picture's kind is matched by every name the interface gives it, the thumbnail's
and the chip's, in both languages (`bothLangs()` in `i18n.js`). `assetSearch()` builds the sheet again 120 ms after the last key, not while an input
method is composing (it waits for `compositionend`), and `renderPanel()` gives the field back its focus and caret
(`heldField()`, `giveBack()`, as the AI windows do; the Look sheet's search too); ✕ or Esc empty it. Nor does any other
change build the sheet under a word being composed: `COMPOSING` is the field an input method is putting a word together
in (set at the window's `compositionstart`, let go at `compositionend` or when that field loses the focus), and while it
still has the focus and is in the sheet (or the Settings page), `renderPanel()` tries again 150 ms later. `photoShelf()` shows a chip a kind
(`LIBRARY_KINDS` that the library holds, when it holds more than one), `libraryTiles()` taking `only`, a test, for the
kind and for the search alike (`photoTiles()`).

**The looks as cards.** Each card of the Look sheet is the cover drawn in that look (`lookCards()`), a cover for every
look, so a card's picture is kept (`LOOKCARDS.pics`) with what it was drawn from (`sig`: the cover, the size, the style
but its look, the look's own settings; `lookBase()`, `lookOwn()`); those that are stale are drawn one a frame, the
profile's first, and not while anything is dragged (`drawLookCards()`), and after an edit only those whose `sig` changed
(`refreshLookCards()`). A card drawn while an outline was on its way, or a font of the cover's was being read from its
files (`fontsReading()`), is not done (`sig` ""), and is drawn again as they come. The pictures are kept from one launch
to the next (`lookpics.js`): a card done is written a moment later (`keepLookPics()`) to `lookcards/<look>.json`, a
300 px JPEG of 15–50 KB (a PNG where the cover is see-through; the writings one after another, `saving`) with `lookPicSig()`, a hash of what it was drawn from,
its pixels and the app's version and build (`appBuild()`: `ui_build` in `src-tauri/src/lib.rs`, a hash of `ui/` made by `build.rs`,
or under `tauri dev` of its files' names, sizes and times, made again at each load of the page; only in the desktop
app, as a server's page cannot tell one version of the server from the next); after the first frame `readLookPics()` reads them and puts
each on its card (`fromKept()`), done where the cover is as it was, a stand-in till drawn again where not. The cards'
first drawing waits for that reading (`LOOKPICS_WAIT`, 1 s at most), so from the second launch on the sheet shows its
cards at once and draws none. What every card is drawn from (`lookBase()`) counts the cover's pictures read and how
long each is, not how many the photo store holds (the library read in the background would change that), whether each
font of the layers is there, and the layout's defaults. A card under the pointer for 140 ms shows its look on the canvas (`hoverLook()`,
`PREVIEW.look`, see below). A click makes it the profile's (`pickLook()` in `app.js`, not `deal.js`'s) and counts it
(`countLook()`, into `settings.lookUse`), as `dealClose()` counts a hand of Surprise me kept in a look other than the
cover had before the window's first deal. A card is two buttons side by side, not one in the other: the look (`.lookpick`,
its picture and name, which previews and picks) and, over the right end of the name, its ♡ (`likeButton()`, `.lookheart`),
which likes the look or unlikes it (`likeLook()`: into `settings.lookLikes`, the latest first) and neither picks nor
previews it (it stops its click, and the pointer on it ends a preview).

Above the cards, `lookFinder()`: a search field and a chip for each kind of look (`LOOK_CATEGORIES`; what kind each
look is, one or more, `LOOK_TAGS` in `style.js`, which a test holds to every look and to a handful of looks a kind),
*★ Most used* once something is counted (`mostUsed()`: the `MOST_USED`, six, most counted), and *♥ Liked*, always
(`settings.lookLikes`, in its order: `sortLooks()` sets CSS `order` under it, the profile's own in its place; with nothing liked,
the line under the cards says how to like one, `noLooks()`; a look liked or unliked under it shows or hides at once,
`findLooks(true)`, where the cards are). `LOOK_UI` keeps what is
typed and picked for the session. `lookFilter()` is the test they make — the chip's kind, the most used or the liked, then every
word typed in the look's names, its `about` or its kinds' names, each in both languages (`bothLangs()`), compared
`folded()` as the Assets sheet's search compares them. They only hide cards
(`findLooks()` sets `hidden` on those it does not let through, without building the sheet again, so the field keeps
the keyboard): the profile's own look is never hidden, and comes first while they are at work (`.finding`, CSS
`order`), but under ♥ Liked, which holds only the looks liked (`ownAlways()`); `drawLookCards()` and `refreshLookCards()` pass a hidden card by, so it is drawn once it shows; a line says
when none is let through. Composing a word (pinyin, kana) changes nothing until it is done.

Under the cards, *Tune this look*: its heading (`tuneHead()`) keeps the look's `about` shut until a click on the line
or its chevron opens it (`TUNE_UI.about`, for the session; shown or hidden in place, the sheet not built again), then
the look's sliders.

**Previews from cards.** Three kinds of card show on the canvas what a click would do, a moment after the pointer comes
(140 ms): a look's (`hoverLook()`), a text effect's (`hoverFx()`) and a layout preset's (`hoverPreset()`). One object
holds what is previewed, `PREVIEW` — `look`, a look id; `fx`, `{id, fx, seed}` (the layer, the effect, the seed a
lettering dealt by one is drawn with); `layout`, `{id, name, p}` (the preset) — and `timer` and `wait`, the moment being
waited for and the kind it will show. `previewSoon(kind, v, ok)` waits the moment, asks `ok()` whether it still holds
(the sheet still shown, the layer still the one), then puts `v` in the place of whatever was previewed; `v` null puts
the canvas back at once. Only the main canvas's drawing takes it: `paintFlat()` paints `previewed()` — the cover laid out
by the preset (`laidOut()`), the profile in the look (`inLook()`), the layer in the effect, on copies, so nothing is saved,
recorded or undone, and the thumbnails and exports keep the cover's own. `previewTag()` says over the canvas which, and
how it is put on (a click on the card), and marks the preset's card *Previewing*.
`endPreview(...kinds)` ends a preview of the kinds given, and one waiting: `renderPanel()` ends the look's and the
preset's, as their cards are built anew, `renderBar()` the effect's, as its cards (in the drawer and the bar's popover)
are; `pickLook()` and `pickFx()` end theirs before putting theirs on.

**Text effects as cards.** The Effect group of a lettered layer's properties (`fxControl()`; the bend is a group of its
own further down, `bendControl()`, its list drawing each bend, `BEND_GLYPHS`) begins with `fxCards(L)`: Automatic, then the others in `FX_ORDER`, one order, so a card picked
stays where it was. Every card is built; in the drawer, three to a row, those past `FX_FOLDED` (six) but the layer's own
are hidden (`.folded`) until *See all* (`FX_UI.all`, for the session). In the bar's popover they are in pages of six side by side (`fxRow()`), each two
rows of three filled row by row (each card's place set by `fxCards()` as `--r` and `--c`, the grid as many columns as
whole pages take, `--cols`), one page in sight, the others scrolled to sideways; the layer's own card's page is shown on opening: `fxRowEnds()` marks the ends with more beyond them (as the row scrolls, and as
`FXROWS`, a `ResizeObserver`, sees the popover laid out or the window resized), where the cards fade out under an arrow
(a CSS mask) whose click glides the row on to the next page's start (`glide()`, eased over a few frames); the wheel turns the row
until its end, then scrolls the popover. Each card is the layer's first letter (`firstLetter()`, the highlights' marks left out;
a stand-in while it has none) drawn in that effect, in its face, colours and strengths, as the cover's look letters it.
A picture is keyed by all it is drawn from — the effect, the seed, the letter, the face, the colours, the strengths, the
look and its settings and seed, the ground, whether there is a photo, the channel colour — and drawn once into `FXPICS.pics`
(the 80 last kept), then copied onto every card that shows it, so the drawer and the bar's popover, both built anew at
each change, draw nothing again. It is drawn only when a card of it comes into sight (`FXPICS.seen`, an
`IntersectionObserver`), one a frame and not while anything is dragged (`drawFxPics()`); `paintFxPic()` draws, with
`drawCover()`'s `only`, a free text layer standing for the card's at the middle of a small cover (`FX_CARD`), the
cover's ground and main photo setting the scene, then reads whether the letter came out dark, to show it on a light
card. A face still being read from its files (`ensureFont()`), or an outline asked for (`outlinesSettled()`), has it
drawn again once there (`fxAgain()`). A lettering dealt by a seed is shown, previewed and put on with the layer's own
`fxSeed`, else one kept for the layer this session (`fxSeedOf()`, `FX_UI.seeds`), so two layers in it are not drawn alike
and what is put on is what was shown. A click (`pickFx()`) commits what went before as a step of its own, then sets
`fx`, one step of undo. `secSum()` sums the group by the card picked. While an effect is previewed `placeBar()` leaves the
bar and its popover where they are, or the card would move from under the pointer; the popover is wider for the cards
(`#fpop.wide`, a page of them), and kept within the window, scrolling, where it would run off its foot.

**The layout's parts framed.** While the Layout sheet is in front on the flat canvas (`partsFramed()`: in the editor,
the sheet not hidden by the drawer, not in 3D, not while the weave's brush paints nor while the letter, crop or weave
window stands over the sheet — opening and closing each places the frames again), `placeFrames()` frames each layout
part drawn at the size shown — of the canvas's hits, those `framable()`: a layout layer of the cover's own, not the
ground, shown and not locked (`isPickable()`, which leaves the corner brackets out), and with FOCUS on only those
worked on — in a dashed box over the stage, turned as the part is, named as the layer list names it (`layerName()`),
the name beside the frame's top, on the left where the right has no room, else inside. The selected parts are left to
their own frame and handles. The boxes (`FRAMES`, `#partframes`; one per part kept in `FRAMED`) are laid over the stage,
as the hover frame is, not painted on the cover, so the export never sees them; `flushDraw()` puts them in place after
every drawing, so they follow a drag, the window resized and the size shown, and `renderPanel()` and `close3d()` show
or hide them as the sheet changes. A press inside one goes through to the canvas, where `layerAt()` takes that part (9.2).

**The bar over the canvas.** The selected layer's most used settings stand on a bar of glass over it (`BAR`, `#ftb`, in
`#center`). `barItems(L)` says which, by the kind of layer — a lettering's font | its colours (`dot`: a round button,
split across for the words' and the highlighted words' colours, as its Colour group's swatches show them: `inksShown()`),
effect (`icon`: a wand) and bend, and columns | *More…*, in a segment of its own; a photo's
background, crop, AI repaint and another picture; an asset's colour and crop; a weave; a colour layer's colour; the
colour block's shape, and its size and slant; the ground — each a group of the properties (`sec`), shown in a popover under the bar (`POP`,
`#fpop`; `FTB.pop` the one open, its button a light pill, `.open`), controls of its own (`pop`: the font), or something
it does (`act`); *More…* opens the drawer. A group's popover holds the drawer's own controls for it, built afresh by `secOf()` (it runs `typeControls()`
and takes that group out), so the two never say different things and a control added to a group is on the bar too.
`renderBar()` builds it, from `renderSide()`, so it follows every change of the layer; the popover shuts on another
layer, Esc or a press beside it. A drag on the popover moves it (its pointerdown, the pointer held by it, so it is
taken for neither a drag on the canvas nor of the window) where it starts on a part that is no control (`popGrabs()`:
not a field, list, slider, button, card or anything clicked, nor inside a box that scrolls, nor on its scrollbar;
`cursor: grab` there, and a grip at its top edge, `#fpop::before`); `popTo()` puts it there, kept inside the window,
and keeps it in `FTB.at` while that popover is open, so `placeBar()` leaves it there through every change made in it;
shut, or another opened, it is in its own place again (`renderBar()` lets `FTB.at` go). `placeBar()` puts the bar above the layer, clear of its turning knob, else under it,
else inside its top (`onScreen()`: where the layer is drawn, from the canvas's hits), measured at the left edge so it
wraps only in a canvas narrower than it, and `flushDraw()` places it again
after every drawing. It is away while the pointer is down on the canvas (`FTB.drag`), while the layer is not drawn
there (hidden, or kept to other sizes: `onScreen()` gives nothing), in 3D, while the brush paints, with a group selected
and in Settings; and after a press on the stage beside the cover or Esc, which select nothing (`selectNothing()`: the
background, as `pickedIds()` counts it, its id kept in `FTB.away`), until a layer is chosen again: `selectLayer()`, the
background's too, lets `FTB.away` go, and so does `renderBar()` once another layer is selected by any other way.
Meanwhile the drawer and the layer list show the background as ever, and the arrows and Delete act on nothing.

**The drawer.** Everything about the selected layer is in the drawer on the right (`renderSide()`, into `#side`; with a
group selected, what can be done to the group), each group made by `psec()` (9.1). It is shut to begin with and kept as
it was left (`settings.drawer`): `setDrawer()` opens or shuts it (*More…* on the bar, the button under the layer list,
a double-click on the canvas), `columns()` gives its column to the canvas while it is shut (`.nodrawer`), and nothing is
built in it then; in a narrow window, open, it stands in the sheet's place (above). Its head (`drawerHead()`) is the
layer's tile (`layerTile()`, as its row in the list has it), its name, what kind of layer it is and at which sizes it
shows, then hide or show, duplicate and delete as the list's bar has them, and ✕. A lettering's groups come in the
order they are most often changed (`headlineControls()`): Text, Effect, Colour, Lines, Bend, then *Plate & highlights*
(`props.sec.platehi`: the plate, and the highlighted words' mark). A shut group says what it is set to, read off its
own controls by `secSum()` — the choices, the colours (or *Automatic*), the switches on, the scrub bars off their
defaults, how many sizes it shows at, what is off its default first — so a new control is summed without being told how. `SECS` keeps, by name, which groups were last opened or shut by hand; a group
never touched is open when it is the first of its layer's (`openSecs()`).

**Surprise me's window** (`#deal`, `dealOpen()`) lies over the whole of the app, the cover dimmed and blurred behind it
(`.deal-dim`): six hands are judged better large. `dealFit()` lays them out in two, three or six columns, whichever
draws them widest at the size's shape between the heading and the bar, and `DEAL.px` is how wide they are painted (540
px at most). Each says its look and, in a few words, its ground, its title's lettering and its layout (`handSays()`);
the one on the canvas is marked. A bar of glass under them holds the parts to leave alone (`SURPRISE_LOCKS`), the way to
the chances (`oddsDialog()`), *Deal again* (with its key, Space, which deals again from anywhere in the window) and
*Done*. A lock pressed has the row built again, each lock by its `data-lock`, and gives the focus back to it when it had
it; the layout's lock is held while the places are locked (shown locked, not to be pressed, its tip saying why), as
locked places keep the layout anyway. `DEAL.from` is the history's entry before the window's first
deal: *Undo the deal* at its corner, or Esc (`dealUndo()`), goes back to it with `timeTravel()`, so redo takes the deals
again; else it only closes the window. While it is open no key reaches what is under it but undo and redo, and opening
it shuts the letter, crop and weave windows, the brush's panel and the bar's popover. *Done*, or a click on the dim,
keeps the hand on the canvas (`dealClose()`, which counts the look of a hand kept for ★ Most used when it is not the
one the cover had before the first deal, `DEAL.from`, and nothing has been undone or redone since).

**Settings** (`#settings`) is a window over the editor. `setMode("setup")` shows it; `S.mode` is still what the rest
asks to know whether the editor is in front, so what goes with the editor follows: the bar over the canvas is away, the
3D view, the letter, crop and weave windows and the brush's panel close, and no key but Esc, undo and redo acts. Its nav
(`syncTabs()` again, into `#setnav`) shows the profile (its name, how many channels, their colours), its pages (`TABS.setup`:
`brandTab()`, `sizesTab()`, `aiTab()` and, in the desktop app (`CAN_AGENTS`), `agentsTab()`; `S.tab.setup`; beside *AI* the AI lights as one dot, `AI_SHOW.nav`, see 8.6; beside *Agents* the endpoint's light, `mcpLight()`) and the profile's actions (`profileActions`: new, duplicate,
import, export, delete); `renderPanel()` draws the page into `#setpanel`. On Brand & channels, with two channels or more,
each card has a grip (⋮⋮) that `chDrag()` takes: the card is lifted out of the grid's flow (`.lifted`) and follows the
pointer, which the grip captures, a place in its colour (`.chhole`) going before or after the card nearest the lifted
one's middle (in its row, by which side of that card's middle; one card a row, by height), the page scrolling near its
top or foot while the pointer stays there (a frame at a time); let go, the card is moved to the place's index by the
same `move(to)` the ⋯ menu's Up and Down call, one step of undo, the profile saved; Esc (taken before Settings can close
on it), a pointer lost, or the page drawn again under it, leaves it where it was. A press on the grip does not show
that channel on the canvas, as a press on the rest of the card does. On Sizes & export, the file names are `nameField()`
and the folder `saveToRow()`, as in the Export window (below); on AI, each card's head is `aiPill()`. On Agents (`agentsTab()`, the MCP endpoint
of 10.6), four cards: the switch that turns the endpoint on (`mcpSet()`, `mcp_set`), saying what it lets agents do, with
its state's pill (`mcpPill()`), the port (1024–65535, applied by its button or Enter) and the line under it (`mcpLine()`:
off, running at `http://127.0.0.1:<port>/mcp`, or why it could not start — another program has the port, the system keeps
it, or the system's own words); the token, hidden but for its last four characters, with *Show*, *Copy* and *New token*
(`newToken()`, which asks first through `askSure()`); the lines that set an agent up, ready to copy with the token in them
(`setupLines()`: Claude Code's `claude mcp add --transport http …`, Codex's `[mcp_servers.smedcover]` with `url` and
`http_headers`, an `mcpServers` JSON for other clients; `copyText()`), and the note that a proxy set in the agent's
environment must leave this computer out; and *Seen lately* (`mcpSeen()`: the clients of the last 10 minutes, the calls
running, the last call, a warning when `toolsMismatch`). The status is agent.js's `MCP`, read once with the token
(`agentsRead()`) and then as the host sends it: `agentsLive()` draws the pill, the line and what was seen again in place
(every 15 s too while the page shows, for the times), the light in the nav, and the ⋯ menu's *Agents* line says it
(`mcpSays()`). None of it is in `custom.json`: `mcp.json` is Rust's, read and set through the `mcp_*` commands. ✕, Esc or a press beside it shuts it. The ways
in from elsewhere open it at the card they mean: `SET_UI.at` names one to bring into view when the page is next drawn
(`text`, `image`, `cut` or `batch`: the card whose id is `"set-" + SET_UI.at`) — *Set up an image model* or *Set up AI* in the repaint and generate
windows, the cut-out's *Get the model…*, Export's *Batch export…* (the batch from a table lives in Sizes & export,
`batchFromCsv()`). `SET_UI.menu` is the channel card whose ⋯ (move, delete) is open on the Brand & channels page.

**The editor's windows.** Export, AI repaint, AI generate, the chances, a layout preset's editor and the small dialogs
take turns in `#modal` (*Dialogs* in 9.4), each a pane of glass. Export (`exportDialog()`, the top bar's button or ⌘E)
is a row a size: a switch (`.tog`), its picture copied from the tray's thumbnail, its name and pixels, and *Export* for it alone
(`exportOne()`). Whether a size is on is `ticked(z)`, from `settings.exportSizes` by profile, which keeps only the
sizes switched off, so a size added since is on; `setTicked(keys)` writes the profile's (letting go of sizes it no
longer has), and taking a size again in Settings clears its entry. A switch, a press on the row, or one of the quick
choices (every size, the wide ones only, the tall ones only — `orientOf()`, the square sizes with the tall; the last
two only when the profile has both) is shown where it is (`sync()`: the switches, how many
of how many, the choice they make, the main button), not by building the window again, so the keyboard keeps its place.
Then the format, resolution and file names with an example (and *Batch export…* beside it), the folder they go into
(`saveToRow()`), *This size only*, and the main button, *Export n* (`exportTicked()`: the sizes switched on, through
`exportMany()`), shut off while none is; while one it started runs (`exportingTicked`), another press — a double-click,
⌘E again — does nothing. The folder is the profile's (`exportDir()`, `settings.exportDirs`; none where the
host saves no files, `CAN.saveFiles`, and the files download): with none kept the first export asks
(`pickExportDir()`), and a single size saved through the save dialog keeps the folder it went into (`keepExportDir()`);
`writeJobs()` writes every job there, through `writeInto(dir, jobs)`, which writes them into one folder once and
asks nothing (`{n, paths, err}`); `runExport()` hands a failure to it instead of a toast, and any failure to write
into the folder — gone, moved, its disk away, no right to write, read-only, full: any error of the system's, or
`write_image`'s "not a folder" — has `askOtherDir()` say so and ask for another, which is kept, and write them all
there. Only what is not the folder's fault is reported as it is, the folder kept: a picture that could not be encoded, a
file name the system refuses, a body that came wrong (the messages `encode`, `invalid file name`, `expected a binary
body`: `NOT_THE_FOLDER`). `runExport()`, `nameFor()` and `framed()` take the format, resolution and
names (`out`), `renderFull()` and `renderReady()` the profile, the width in pixels and the resolution (`{profile, pixelW,
scale}`), and `runExport()` what shows its progress, in place of the settings' and the modal's. Within one export no two files get one name: `runExport()` keeps the names given, compared as the disk compares
them (NFC, one case: one file on APFS and NTFS), and one given already (a pattern without `{size}`, say) gets the size
after it as `_<w>x<h>` (not when the name has it already), then a number (`apart()`), so no file of the export writes over another. Only the files of one export are kept apart: one of the same name already in the folder, from an earlier export, is replaced (`write_image` writes with `fs::write`). The row shows the folder with the home
folder as ~ (`shortDir()`, but not `/Users/Shared` or `C:\Users\Public`), all of it on hover. The
batch from a table goes through `exportMany()` too, at every size of the profile, whatever is switched on: `batchJobs(rows)`
makes a cover for each row, on the channel the row names (`channelIndex()` in `store.js`: its name or code, the case
and the spaces round them aside, or its number, `2` or `02`), the one on the canvas where it names none here (counted,
and said after the export).

The file name pattern is `nameField()`, here and in Settings: the pattern, still the one string, cut at its tokens
(`NAME_TOKEN`, `{category}` read as `{channel}`) into stretches of text and chips. Each stretch is an input as wide as
what it holds (a hidden copy of its text sizes it), so the box reads as one line; a chip is named in the interface's
language (`exp.tok.*`) with × to take it out. What is typed is written into the pattern where that stretch stands; a
token typed out in full builds the box again with it as a chip, the caret after it; Backspace at a stretch's start and
Delete at its end take out the chip beside it, and the arrows step over one into the next stretch. ＋ opens the app's
list (`openPicker()`, with `refocus: false`: the caret's stretch takes the focus back) and adds a token (`NAME_TOKENS`) where the caret last was in a stretch,
else at the end. After the last stretch, in grey, what `exportName()` adds (the resolution's @2x, the extension). *Edit as text*
(`NAME_UI.text`, for the session) shows the pattern in one field instead. The example under it follows every change.

`repaintWin()` (for `REP.for`) and `genWin()`
(`GENWIN.tab`: a photo, or stickers and graphics) are built again whole as their state changes (`repRedraw()`,
`genRedraw()`), the field being typed in given back its focus and caret (`heldField()`, `giveBack()`); a repaint or a
generation goes on with its window shut, waits in it, and says when it is done — a toast (for a generation, with a way
to it), or a mark on its tab while the other tab is shown (`genDone()`, `GENWIN.dot`). What each tab made is kept for the
session (`GENWIN.made`: `{photo, art}`, newest first, `MADE_MAX`, twelve, at most): `madeNow()` puts a result first as
`generatePhoto()` or `generateAsset()` gets it, whether the window is open or not, with which try at those words it is
(`GENWIN.tries`), the words and the reference picture it was made from, and for a sticker, once kept, the asset it was kept
as (`kept`). `madeStrip()` shows them under the result, in one row that scrolls so the result's actions stay in view (a photo by
its picture, a sticker drawn small, `specThumb()`), and
`madeSays()` what the one shown was made from; a click (`showMade()`) makes one the result again and puts its words and
picture back in the form, so `goText()` names the button *Make another* while the result shown was made from what the
form holds; *Discard* (`dropMade()`) takes it out of the strip; `keepGenerated()` keeps a sticker in My vector assets
once, and puts the one kept on the cover when asked again. Nothing of it is saved. `genWin()` lays the window out as the
design board has it: across the top its name, the tabs and what the tab makes; on the left the form (`.gfields`, which
scrolls should a short window not hold it), the service and model it goes to (the text model's named from its address,
`aiService()`) and Generate, full width, the main button (in the accent) until a result is shown; on the right the result
on a checkerboard (`.gstage`, a sticker drawn large twice by `specPreview()`), `madeSays()` at its top left and Discard at
its top right, and under it the strip and the result's actions. A picture dropped on the window while it is open is the
open tab's reference picture (`genDropped()`, handed over by the window's drop handler, which then lights the form's drop
zone, `body.gdrop`, instead of showing the overlay for photos dropped on the cover). The letter, crop and weave windows
and the brush's panel stand over the sheet instead (`overLeft()`), so the canvas and the drawer stay in view while they
are used; over the drawer, where it has taken the sheet's place, which leaves the canvas in view.

The repaint window is laid out as its design board (`Repaint.dc.html`) has it. On the left a compare view, `.cmp` in
`.repstage`, a size container, so the view takes the most room there is in the photo's shape (`--ar`, from `100cqw` and
`100cqh`): the original, and over it the result shown, clipped from the split rightwards (`clip-path` by `--at`, which
is `REPWIN.at`, kept for the session); a press anywhere on the view, or the arrow keys on its round handle, move the
split (`repSplit()`), and nothing is built again meanwhile. With no result, a photo that shows a repaint is compared with
its original. Under it `REP.made` as thumbnails, the one shown framed, a tile counting the seconds while another is
painted (`#rep-tile`, kept up by the same timer as the button), then *Back to the original*, *Discard* (`dropResult()`),
*Try again* and *Use this*. On the right a column whose middle scrolls (`.repopts`, its scroll kept as the window is
built again): the current look as a card with a radio, the built-in styles as cards with their `swatch` (the first eight
until *All ›*, or the first seven and the one chosen), the user's own as chips with the selected one's editor, the note;
at its foot the service and its cost, and *Repaint the photo*.

## 10. The Rust side (`core/`, `src-tauri/`)

One Cargo workspace at the repository's root (`Cargo.toml`, one `Cargo.lock`, one `target/`), two crates:

- **`core/`, the crate `smedcover-core`**, does the work: the store (`store.rs`), exporting (`image.rs`), fonts and the outlines of lettering (`fonts.rs`, `outline.rs`), the cut-out (`cut/`), AI requests (`net.rs`), the files an agent names (`files.rs`), the MCP endpoint agents call (`mcp/`, 10.6) and where the app keeps its data (`paths.rs`). Neither Tauri nor a web view comes into it, so a server can use it as the app does. All of it but the endpoint, which runs on the host's Tokio runtime, is synchronous, and its errors are text (`Res<T>`, a `Result<T, String>`): the interface matches on them ("timed out", "unsupported:", "cancelled", "model not downloaded"). `Core` is the core of one data folder, which the host names (`Core::open(folder, bundled)`); the store, the fonts found by name and the cut-out's models go through it. The fonts that come with the interface reach it through `BundledFonts`: the app answers from its assets (`AssetFonts`), a server can from its `ui/` folder.
- **`src-tauri/`, the desktop app**: `setup` finds the data folder once (the app data directory, or a self-test's `data/`) and keeps its `Arc<Core>` as Tauri's state. Each command is a thin wrapper round the core, with the names, arguments, answers and errors it had; the slow ones wait on the blocking thread pool. What only a desktop app has stays here: the dialogs (`save_image`, `pick_folder`, `save_text`), `reveal_data_dir`, `move_pointer`, reading a binary request body (`frame_of`), the self-test's commands and `ui_build`; and its side of the agents' endpoint (`mcp.rs`, 10.6).

`cargo test` at the root tests the core alone (the workspace's default member), `cargo test --workspace` (`npm run test:rust`) the app as well; `tauri build` and `tauri dev` build the app from `src-tauri/`, into the root's `target/`.

### 10.1 Sandboxed store (`core/src/store.rs`)

`app_read`, `app_write`, `app_list` and `app_delete` take relative paths only. `resolve()` joins them
to the app data directory and refuses absolute paths and `..`, so the interface cannot reach files
outside it. Writes go to a temporary file that is then renamed, so quitting mid-write never leaves
half a file.

### 10.2 Export pipeline (`core/src/image.rs`)

```
canvas ──toBlob (async)──▶ PNG bytes ──binary frame──▶ Rust worker thread ──▶ PNG / JPEG / WebP file
```

1. The interface paints the cover on an off-screen canvas and encodes it to PNG with `toBlob`, **asynchronously**, so the window keeps responding.
2. The bytes go to Rust as Tauri's raw request body, **without base64**. The body is a small frame:

   ```
   [4-byte little-endian length][JSON metadata: folder, file name, format, quality][PNG bytes]
   ```

   The metadata travels in the body rather than in request headers because, in the real app, custom headers did not reach Rust.
3. `save_image` (with a save dialog) and `write_image` (into a folder already chosen: the profile's, `exportDirs`, picked once in a dialog — `pick_folder`, or the folder a file was saved into through `save_image`'s — and kept; it refuses a path that is not an absolute folder; a write into it that fails for the folder's sake — that, or any error of the system's — has the interface ask for another, 9.5) are async commands that run on a worker thread. PNG is written as is; JPEG is flattened onto a dark matte and encoded; WebP is encoded lossless. A file of the same name is written over, but with `fresh: true` in the metadata (an agent's exports, 11.1): then it is left alone and the cover goes under the first free name of `name-2.png`, `name-3.png`, … (`write_fresh()`, each name taken by making the file), and `write_image` answers the path it wrote.
4. The interface keeps at most two writes pending, and is already painting the next cover while it waits. A progress dialog shows the count; cancelling stops new work from being dispatched.

File names pass through `safe_name()`, which keeps only the last path component, so a name cannot be
used to write into another directory.

### 10.3 Glyph outlines (`core/src/fonts.rs`, `outline.rs`)

`text_outline`: see 6.2. A font file, once found by name, is cached in the `Core` of its data folder (an imported font is that folder's), and installed fonts are scanned once.

`font_faces` and `font_data` hand the web view a system family's files: the first says which upright faces there are (one per weight, a variable font's weight axis as a range) and gives a few characters the family has, the second hands over one face (a collection, `.ttc`, cut down to the face's table directory and the tables it points at: `single_face()`). WebKit sets a canvas that is not in the page (the effects' work canvases, an export, the measuring of the title) only in the fonts that came with the system: one the user installed, or one macOS downloads on demand (Kaiti, Xingkai, Weibei…), falls back to the default there, while the canvas on screen, drawn by WebKit's GPU process, shows it. So the editor (`ensureFont()` in `app.js`) tries every system font a layer is set in on such a canvas, with characters it has, before each draw and each export; one that is out of reach is loaded from its files, each face a `FontFace` under the family's own name at its own weight, so every weight of lettering finds the face it did with the system font. The self-test checks it with the first installed font it finds out of reach.

### 10.4 AI requests (`core/src/net.rs`)

`ai_request` sends the request the interface built (URL, headers, JSON body) and hands back the
status and body as they are — error replies included, so the interface can show the provider's own
message. It is sent from Rust to get around the cross-origin limits of a web view.

- The request waits for its reply on the blocking thread pool, off the interface thread and off the async runtime's workers.
- Only `http://` and `https://` are accepted and at most 4 MB of a reply is read; 64 MB of one carrying a picture (a photo repaint, `image: true`). The timeout comes from the settings, 300 seconds by default.
- Proxy: the one given in the settings wins; otherwise `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY` from the environment. **Addresses on this machine never go through the environment's proxy**, or a local model would be cut off by it.

`fetch_image` covers a repaint whose service answers with a link instead of the picture: it downloads it, checks that it is a picture (by `content-type`, else by its first bytes) and hands it over in base64.

### 10.5 Other commands (`src-tauri/src/lib.rs`)

`pick_folder`, `save_text` (profiles, projects, the CSV template), `list_system_fonts` (which
enumerates installed fonts with fontdb and says which can set Chinese: `fonts::list_system` in the core) and `reveal_data_dir` (shows a
folder of the data directory in the file manager — only inside the data directory), `move_pointer`
(takes the system pointer to a place in the window's content, in logical pixels: a scene object's
"take me to its handle"). `read_picture` and `read_project` (`core/src/files.rs`) read a file an agent names
(`add_photo`'s `source.path`, `open_project`'s `file`, 11.1) and nothing else: an absolute path to a regular file
(a link followed), a picture named and made as one (PNG, JPEG, WebP, GIF, HEIC/HEIF, AVIF by its first bytes; at
most 64 MB, handed over as bytes) or a `*.smedcover.json` in UTF-8 (at most 128 MB, a byte-order mark left out).
Both read only while an agent's call is under way (`agent_reads()`: the endpoint has one in hand,
`mcp::agent_call_in_flight()`) or in the self-test, which calls the tools itself; at any other time a page cannot read
a file it names.

### 10.6 Agents over MCP (`core/src/mcp/`)

The endpoint agents call the tools of 11.1 through, in the core so that the app and a server share it; the app's side of it is `src-tauri/src/mcp.rs` (last in this list), the page's Settings → Agents (9.5) and its transport (11.1).

- `tools.rs`: `ToolList::from_json(text, host)` reads `ui/tools.json` for one host (`desktop`, `server`). It refuses another format, a name that is malformed or used twice and an input schema that is not an object's, takes `x-smedcover` off each tool (its hosts; its `timeoutMs`, 120 s if it has none, two hours at most), and keeps the file's order and its SHA-256 (`hash()`), which the page's `toolsHash()` is compared with.
- `token.rs`, `config.rs`: the bearer token is `smc_` and 32 random bytes in base64url, a `Secret` that never prints itself (its `Debug` is `***`) and is compared in constant time. `mcp.json` in the data folder holds `{on, port, token}` (off, port 25277 and a new token to begin with); only Rust writes it, through a temporary file, readable by its owner alone on Unix; one that cannot be read as settings is put aside as `mcp.json.bad` and started over. `paths.rs` says where the desktop app keeps its data (`desktop_data_dir()`, as Tauri finds it), for a command line on the same computer.
- `bridge.rs`: each call goes to the page through a `PageBridge`. The `Dispatcher` both hosts use sends `{kind: "call", id, tool, args, client, timeoutMs}` down the `PageSink` of the page that attached (`attach(sink, toolsHash)`: the app's Tauri channel, a server's WebSocket), routes the page's answer and progress back by id, and sends `{kind: "cancel", id}` when the caller gives up. A call waits up to 30 s for a page that is on its way (`loading()`), and fails at once when none is; it is given up when the page is quiet for longer than the tool's timeout (each word of progress starts that again) and in any case after two hours, and fails when its page reloads or goes ("the change may or may not have been applied"); 16 at most are in hand. A result's image loses a `data:` prefix, structured content with no text is added as JSON text (and dropped when it is not an object), and more than 16 images or 48 MB are refused.
- `server.rs`: `McpServer::start(addr, runtime)` binds 127.0.0.1 there and then (`port_in_use`, `port_forbidden`, `bind_failed`; never another port; on Windows the port is the endpoint's alone) and serves `/mcp` and `/health` till `Running::stop`, which closes every connection. rmcp serves both eras of the protocol, without sessions: 2026-07-28 (`server/discover`; `_meta` and the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers on every request) and the `initialize` of 2025-03-26 to 2025-11-25. A `Host` or `Origin` that is not a loopback name is refused, and `/mcp` wants `Authorization: Bearer <token>`, taken off before rmcp sees the request. Bodies of up to 32 MiB are taken; headers must come within 10 s and bodies within 30 s, and of a refused request's body 64 KiB and 2 s at most are read. `Stats` keeps the clients seen in the last 10 minutes, the calls under way and the last call.

Answers are server-sent events, not JSON, so that a long call (an export waiting for the user) is not cut off by a client's wait for headers (Node's `fetch` gives up after 5 minutes); a keep-alive comment follows every 15 s. In the `initialize` era the headers go at once. In the 2026-07-28 era rmcp sends them only with the call's first message: a call that names a `progressToken` is told progress 0 at once, which sends them, but one without gets its headers with its result, and its client's own wait bounds it. Without sessions, a client of the older era cannot be told from its requests after `initialize`: its calls are taken to be the only such client seen lately on that revision, and its `notifications/cancelled` (which rmcp drops without a session) is acted on only when there is no doubt which call it means. `core/tests/mcp_http.rs` tries all of it over real HTTP, rmcp's own client in both eras among the rest; `cargo run -p smedcover-core --example mcp_echo` serves the test tools with a page that says back what it is asked.

- **The app's side**, `src-tauri/src/mcp.rs`. `McpHost`, Tauri's state, keeps the `Dispatcher`, the tools of the bundled `tools.json` (`asset_resolver()`, read for `Host::Desktop`; none, said on stderr, when it cannot be read), the `Stats`, the token the server reads at every request (`Arc<RwLock<Secret>>`) and, under one lock, `mcp.json` as saved with the `Running` endpoint started from it and the `BindError` of the last start; every save of `mcp.json` is made under that lock, and a `tokio` lock lets one switch run at a time while a stop is waited for. `setup` makes it before the window's page loads — `loading()` first, so calls wait for the page — and starts it if `on`; in self-test mode it stays off, but with `SMEDCOVER_SELFTEST_MCP=1` it starts on a free port with a new token (13), and with `SMEDCOVER_SELFTEST_STAY=1` it is as on the user's own data folder. The window's page reaches it through the Tauri `Channel` it hands over (`ChannelSink`: `Channel::send` queues a script for the web view and returns, and never calls back into the dispatcher). Commands: `mcp_status` (`{on, state: "off" | "running" | "error", port, url, error?: {code, message}, page, tools, toolsMismatch, clients, inFlight, lastCall}`, never the token); `mcp_set {on, port?}` (saved first, then started, stopped or moved; a port that cannot be had leaves it on but in error, `port_in_use`, `port_forbidden` or `bind_failed` with the system's words, and it is never moved to another port); `mcp_token {regenerate?}` (the token; a new one is saved and in force at once, the old one refused from its next request); `mcp_attach {channel, toolsHash}` (the `main` webview's alone: the page is ready, `toolsMismatch` when its hash is not the file's); `mcp_reply {reply}` (off the main thread: an answer may carry pictures of many megabytes) and `mcp_progress {id, progress, total?, message?}`. A page that starts loading in the main window (`on_page_load`, `Started`) detaches ("the window reloaded"): the calls it had fail, and the next page attaches anew; the window destroyed closes the dispatcher; the app's exit (`.build(ctx)?.run(…)`, `RunEvent::Exit`) stops the endpoint, its port free. Each change of the stats or of the endpoint goes to the page as `{kind: "status", status}`, four times a second at most (`Stats::changes()` and the host's own). While it runs, the window keeps drawing when it cannot be seen — an agent's chat window is often in front of it: the web view does not watch whether its window can be seen (`keep_drawing()`, the self-test's setting, 13), the main window's `backgroundThrottling` is `disabled` (`tauri.conf.json`; macOS 14 and later), and while a call is under way the app holds an `NSProcessInfo` activity (`beginActivityWithOptions:reason:`, user-initiated) so that App Nap does not slow it. `agent_call_in_flight(app)` says whether an agent's call is under way, for `read_picture` and `read_project` (10.5).

## 11. Hosts, what each can do, and the layout

The same interface runs in three places, its **host** (`HOST` in `store.js`), told apart as the page loads:

| `HOST` | how it is told | `invoke(cmd, args, options)` |
|---|---|---|
| `"tauri"` | `window.__TAURI__` is there: the desktop app (or one day an app on a phone) | Tauri's own |
| `"server"` | the page a SmedCover server sent sets `window.SMEDCOVER_SERVER = { api }` before the modules load | `httpInvoke()`: POST `<api>/invoke/<cmd>` |
| `"browser"` | neither: the page on its own | none: a rejected promise |

`httpInvoke()` sends the arguments as JSON, or a binary body (a photo's bytes) as it is with
`options.headers`, and reads JSON back (a JSON content type; empty, or 204, is null), else bytes (an
`ArrayBuffer`: a mask, a font), as Tauri hands them; an error answer is thrown as its text, as Tauri's are. The
commands that only read (`app_read`, `app_list`, the fonts, `text_outline`, `cut_models`) are asked again,
twice, after 0.4 s and 1.2 s, when the server cannot be reached or answers 502–504; a write never is. So the
commands above keep their names and their arguments whatever the host; a server answers them from its own data
folder, fonts and models. What it owes the page besides: to refuse the commands that are the app's alone
(`reveal_data_dir`, `pick_folder`, `save_image`, `save_text`, `move_pointer`, the self-test's), to let only its
user in, and to keep `ai_request` and `fetch_image` from being a relay for anyone.

A file or a folder that is not there is no failure, on any host: it reads as null, a folder as `[]`
(`store_read`, `store_list`), and a server must answer so too, never with 404 or an error, or a new data folder
could never be started from. On this computer a read fails only when something is wrong for good, and that is
taken for nothing stored. On a server a read can fail for a moment, and taking that for nothing stored would
write the defaults over what is there or clear things away. So there (`absent()` in `app.js`) a failed read at the
start of anything that would then be written or cleared (the settings, assets and their folders, the AI
settings, the user's styles, the profiles, the library, the covers, an old session's pictures) stops the start:
the page says so, and nothing is written over. The fonts are not among them: nothing is written for a font
missed. Later on: a picture whose file could not be read is not taken for gone, as one that is not there is
(`readPhoto()` resolves null, not false), and is asked for again a little later; switching profile changes
nothing until the other profile's covers are read, and a profile deleted is deleted only once another is shown;
the styles read again when the window comes back keep the ones there were. And
`prunePhotos()`, on any host, removes no picture when a cover could not be read, nor one that came in while it
read them.

What the interface offers goes by what the host can do, `CAN`, not by which host it is: `files` (the data
folder; else `localStorage`), `fonts` (installed fonts and their files), `outlines` (glyph outlines, the outline
text effects), `cut` (cutting a subject out), `relay` (AI requests past the browser's cross-origin rules) — all
three hosts but the plain page — and `saveFiles` (exports and files written where the user picks on this
computer; else downloads), `folders` (the system's folder dialogs and file manager), `pointer`
(`move_pointer`), `selftest`, the app's alone. `native` is `HOST === "tauri"`. Some offers follow from these:
`CAN_PROJECT` (project files, in the ⋯ menu and on ⌘O / ⌘S) is `saveFiles`, or a page that can download a file; the
export folder (`saveToRow()`, `exportDirs`) is shown only with `saveFiles`. A capability missing is said
where it would be used (the outline effects, the cut-out); the progress of a cut-out model's download comes
by Tauri's events, so only in the app for now.

The layout goes by the screen, not by the host: `arrange()` (`app.js`) sets `data-layout` on the body, "desk"
(the dock, the sheet, the canvas and the drawer side by side, or one under another in a window under 1000 px wide, see 9.5) or "phone" for a narrow touch screen (`(max-width: 760px) and (pointer: coarse)`), whose
own arrangement is to come under `body[data-layout="phone"]`; `?layout=phone` or `desk` in the address
chooses one, to work on it at a desk.

So the interface can still be developed from a static server (the `"browser"` host):

```bash
python3 -m http.server -d ui 4599
```

### 11.1 Agents: the tools, the commands, the shell

An agent — an MCP client such as Claude Code — drives SmedCover through tools, each a whole thing done to a cover
(set the words, place a layer, draw a preview, export), never a file read or written. Where the calls come in is the
host's (the desktop app's endpoint on 127.0.0.1, a server's `/mcp`: 10.6 and TODO.md); what answers them is the page, in
three modules.

`tools.js` defines every tool as data (`TOOLS`): its name, title and English description (written for the model:
what it does, what it answers, what it refuses), its input schema (JSON Schema, every object closed with
`additionalProperties: false`, the enums the app's own constants — `LOOK_IDS`, `EFFECTS`, `BEND_IDS`,
`SURPRISE_LOCKS`, `WEAVE_WAYS`, `SCOPES`, `FORMATS` — inlined, no `$ref`, and no `anyOf` at the top, which some clients
refuse), its output schema, MCP's hints (`readOnlyHint`; `destructiveHint` said where it is false too, MCP's default
being true; `idempotentHint`; `openWorldHint` for `add_photo`), and what only the page reads: `history` (run as one
step of undo), `busy` (what of the user's it waits for, `light` or `strict`), `hosts` (`desktop`, `server`: the
selection, undo and redo are the desktop window's alone), `timeoutMs` (how long the host waits without a word from
the page: half a minute to read, a minute to change, two to draw a preview or deal, ten to cut out, half an hour to
export) and `needs` (what a schema cannot say without a combinator: at least, exactly or at most one of some
arguments). `checkArgs(schema, args)` checks a call against the part of JSON Schema the tools use and says what is
wrong in a sentence for the model (`"maxSide" must be at most 2048 (got 4000).`, `Unknown argument "colour" (this tool
takes: …)`); a string's characters are counted only against a length limit, and no further than it needs, so a
picture of 40 MB in `add_photo`'s `source.data` is checked at once (it and `open_project`'s `project` take 24 Mi
characters at most; the descriptions send agents to a path or a link first). `checkCall(def, args)` adds `needs`, where a flag
set to false (`FLAGS`: `reset`, `resetParams`, `reshuffle`, `off`) counts as left out and any other false says
something (`visible: false`). `toResult({structured, images, text})` makes MCP's
`CallToolResult` (a text block, by default the structured answer as JSON; each PNG an image block;
`structuredContent`) and `toError(code, message)` a failure, `code` one of `unknown_tool`, `invalid_arguments`,
`not_allowed`, `busy`, `unavailable`, `failed` (the host makes a protocol error of the first, `isError` of the rest).
And the helpers the commands find things by: `findProfile()` (its id, then its name), `findChannel()` (its id, then as
a batch table names one, `channelIndex()` in `store.js`), `findSize()` (pixels, a ratio within 1%, a name or caption;
several matching is an error naming them), `letterKeysOf()` (the letter keys the weave window offers), `boxesOf()` (a
drawing's `_hits` as shares of the image), `sheetPlan()` (a contact sheet's tiles: below 24 px a tile, then smaller
captions and gaps, never past 1.5 × the side), `nearNames()` (the fonts near one asked for that is not there), `idsSaid()`
(a few ids for a message), `imageType()` (a picture's type by its first bytes, as `read_picture` tells it), `coverDiff()`
(what checking a cover given whole corrected, dropped and put back, and the photos and assets it names that are not
here), and `placeAt()` and `placePatch()` (below).

`scripts/tools.mjs` writes `ui/tools.json` from `toolsJson()` before every build (`beforeBuildCommand`, as the repaint
styles' `index.json` is written): `{format: 1, instructions, tools: [{name, title, description, inputSchema,
outputSchema?, annotations, "x-smedcover": {hosts, timeoutMs}}]}`, `instructions` a primer for the agent (profiles,
channels, sizes and layers; each change one step of undo in the user's open window; the usual order of calls). The
host lists the tools from that file, so it can answer before the page is up; `npm test` fails when the file and
`tools.js` disagree, and `toolsHash()` in `agent.js` is the file's SHA-256 (of `toolsText()`, the file to the byte),
by which the page says which list it answers to.

`commands.js` does what each tool says: `makeCommands(api)` returns a function for each, `(args, ctx) → answer`, over
`API` (at the foot of `app.js`, frozen): the state, and the app's own ways of reading, changing, drawing and writing it
— those the editor uses, so an agent's change is checked and drawn as the user's is. A read never switches the
window: another channel's or profile's cover is read as it is kept (`coverOf()`) and drawn in that profile's style
(`renderReady(size, cover, index, {profile, pixelW})`). `render_preview` draws a size with its longer side as asked
(`widthFor()`), waiting for fonts and outlines as an export does, and answers the PNG with where each layer landed;
with `all`, every size on one captioned sheet.

A change goes where it is aimed first, through the **mutation target**, `aim(args, {layer, types, what, unlocked,
check})` in `commands.js`: it finds the profile, channel and size the call names (those shown when left out) and the
layer by its id, reading that channel's cover as it is kept, and checks it all before anything is touched — the layer
there (else a few of the ids there are), of the types the tool works on, not locked where that matters, and whatever
the tool's `check(L, cover)` says of the other arguments (an `above`, an `of`). Only then does it switch the window as the
user would — `switchProfile()`, `switchChannel()` (each a new history, the change the first step of it), `selectSize()`
(no step) — with a toast saying where it went (`agent.switched`), and hand back `{p, index, catId, z, f, L, switched}`,
`f` being `frame()`. Every tool that changes the cover starts there, then does what the editor does for the same change:
the same fields, the same `touch()`, `edit(L, patch, scope)` for a place (the scope the call's, all by default),
`addLayer()`, `addAsset()`, `duplicateLayer()`, `removeLayer()`, `shiftLayer()` and `restack()` for the stack, without
counting a look among the most used or a font among the recent ones. What was clamped, or will not show, comes back in
`warnings`. `place_layer`'s arithmetic is `placeAt()` and `placePatch()` in `tools.js`: the placement at a size in the
tool's terms (a layer added: its centre; a layout part, a copy of one or a linked cut-out: its offset; the scale without
the canvas's height), and the patch `adjust()` applies in any scope to reach what is asked (`npm test` checks the round
trip in all three scopes); its size, turn and stretch go first (a cut-out or a crop about its subject, the canvas drawn
now with `drawnNow()`), then where it goes.

`add_photo` has its picture before anything is touched — a file read by the host (`read_picture`, 10.5), a link fetched
by it (`fetch_image`; the plain page fetches it itself), the library's by its pid, data as given (its type by its first
bytes) — then does what a photo uploaded does: `putPhoto()`, `keepPicture()`, `placePhoto(pid, at, fill, above)`.
`crop_photo` is the crop window (`setCrop()`: a rectangle, a shape, a ratio fitted about what was kept, Reset; a
rectangle needs all four sides). `cut_out` waits for a cut-out under way (`CUT.busy`), answers `unavailable` where no
engine is ready (`cutReady()`: the model not downloaded), and is Cut out subject at the sizes the scope asked reaches
(`cutOut(L, keys)`), a word to the caller every 5 s. `weave` is the weave's controls and its letter window
(`normalizeWeave()`): `front`'s keys only ever the ids of the layers it weaves with, `__proto__` and the like refused, a
first weave the title's as Weave switched on. `surprise` deals as Surprise me does, `SURPRISE.busy` set while it deals
(`dealHands()`, then `keepFirst()`: one step), its locks the call's alone and never kept, no look counted among the most
used (that is the window's Done); the hands are drawn 400 px on their longer side, each told to the caller as it comes,
and answered on one labelled sheet (`each`, or none); `pick_hand` is a hand clicked in that window (`takeHand()`), on the
same step, while `SURPRISE.step` is still the deal's — once anything followed it is refused, the agent told to deal
again. `apply_cover_json` checks the cover as one read from its file (`channelCover()`, then `setCover()`) and says what
that changed (`coverDiff()`); `open_project` is Open project (`openProject(raw, () => as)`), a file read by the host
(`read_project`). `export` and `batch_covers` write as the Export window and a CSV imported do (`batchJobs()`,
`writeInto()`; runExport's progress object tells the caller and the pill, `ctx.say()`), into `dir` or the profile's
folder — never asking for one, a `dir` given not kept — switching to the profile asked first (`nameFor()` reads the one
shown), and never over a file (`fresh`, 10.2); what a job names is found before anything is drawn or written, and a
cancel stops between two files, answering those written. Every tool is done: `npm test` fails on a command that is not.

`agent.js` is the shell. Calls run one at a time in the order they came (`makeQueue()`: a call cancelled while it
waits never runs), one waiting behind another telling the caller so every 5 s. Each is checked (`checkCall()`; a name
of `Object.prototype`'s is no tool), then waits till the user is in the middle of nothing (`whenIdle()` over
`userBusy()`: a press, a drag, a dialog, typing; for a change Settings, the editor's windows and an export under way
too) and their hands have been off the window for 400 ms, telling the caller every 5 s that it waits (a progress
message, which sets the host's timer going again), and answering `busy` after 30 s (10 s for a read). Input is noted
while a step runs too, and when the user pressed, typed or scrolled during one, the 400 ms run from its end: they get
in before the next change, which waits while they press. A call that changes something holds the window while it runs:
the menu, popovers and hover previews shut and a field left (`closeTransient()`), `#agent` over the window (above the
menu and dialogs, under a question, the title bar and the toast; `body.agent .app` takes no pointer, nor does the
toast's button, which would act mid-step), the keys, pastes and the wheel swallowed before anything sees them (by
listeners added for the step and removed after it) and a drop let go — not replayed: a step is short — and, after
150 ms, a pill of glass at the top saying what is being done (`agent.step.<tool>`), which a press pulses ("One
moment"); after 20 s it says the step is taking longer than usual and offers to stop waiting (its button, or Esc). One
whose tool has `history` runs inside `agentStep(fn)` (`app.js`): the change the user was making becomes a step of its
own first (`commitPending()`), `HOLD.history` keeps the debounced commit back, and the step is committed once — none
when nothing changed. Should it fail part-way, the snapshot taken after the opening commit is put back and the
history as it was, the steps to redo too (a step taken meanwhile, `keepFirst()`'s, let go; the 80 kept as they were); or, when a new
history began (`HIST.epoch`, which `resetHistory()` counts: the switch of channel or profile was done), the cover as it
was on arriving, the switch kept as the user's own is. A switch begun and not done — the profile, its covers or the cover
replaced, no new history yet — is undone first (the profile found by the snapshot's id, the covers `HIST.covers`), so
the profile is put back in its own place; the channel shown is the one remembered. The step put back is written again
as it now is, as `timeTravel()` does, or the closing commit would take the difference for a change and cut off redo.

A call running is let go of — answered `failed`, the window given back, the next call started — when nothing is heard
from it for its timeout (the call's `timeoutMs`, else its tool's; each word to the caller, its own progress or a wait,
sets it going again), a second after the host cancels it (it is told at once, `ctx.cancelled()`, which an export checks
between files, and answers as it likes if it ends within that second), or when the user stops waiting. It is not
stopped — a promise cannot be — but `ctx.cancelled()` turns true for it, and what it answers later is dropped (the
queue's `lease.gone`; `hold()`'s token, which `release()` must match, keeps it from letting go of a later step's
window). A change let go of ends its step there: the shell calls the `abandon()` that `agentStep(fn, ctl)` gave it,
which commits the step as it stands and lets the history go, so the user's changes from then on are steps of their
own; `HOLD.step`, the token of the step holding the history, alone lets it go, so the change settling at last — in the
middle of a later step or not — touches the history no more than a change of the user's would, and failing then it is
not put back over what the user has done since. The window is taken inside the call's `try`, so a throw in `closeTransient()` too is
answered and the window given back; `handle()` and `serve()` answer every call.

The dispatcher answers each call as the host is to be sent it: `{id, ok: true, result}` or `{id, ok: false, error:
{code, message}}`. A transport brings the calls and takes the answers (`serve(agent, {listen, reply, progress})`). The
desktop's, `tauriTransport()`, is a Tauri `Channel` handed to the endpoint with `mcp_attach {channel, toolsHash}` as
`startAgent()` runs (`agent.attached`, its promise): it brings `{kind: "call", …}` to the dispatcher, `{kind: "cancel",
id}` to its `cancel()`, and `{kind: "status", status}` to `MCP` (`onMcpStatus()` tells Settings → Agents, 9.5); answers go
back by `mcp_reply {reply}`, progress by `mcp_progress {id, progress, total?, message?}`. A reload makes a new page, which
attaches again (the host fails the calls the last one had). `globalThis.smedcoverAgent.call(name, args, {onProgress,
timeoutMs})` runs the same dispatcher from the console or a test in a plain page, `cancel(id)` cancels as a host would
(`last`: the id of the call made last; `tools()`: the list). `startAgent()` starts the shell at the end of `start()`, not
in self-test mode; there `SMEDCOVER_SELFTEST_AGENT=1` starts it in a step of its own (see 13), and
`SMEDCOVER_SELFTEST_STAY=1`, which runs no self-test, at the end of `start()` as usual.

## 12. Fonts

The three bundled fonts are loaded with `@font-face` and render the same on every platform. Imported
fonts are stored as data URLs under `fonts/` and registered with `FontFace` at start-up. The first
frame waits for the fonts, otherwise the title would be fitted using the wrong glyph widths.

## 13. Tests

| Level | Command | Covers |
|---|---|---|
| Front-end unit tests | `npm test` | layout, layer placement and order, channels, CSV, data validation (the export's sizes switched off and folders and the looks' use, by profile and look), the defaults and `custom.json` laid over them, the settings written to `custom.json` (only what differs, read back the same, from `settings.json` once), file name pattern, Surprise me's rules and chances (the bars' `moveShare()`, the dots' `dotsOf()` and `withDots()`, the layout locked), every look's kinds, size and naming of the asset packs, colour mapping and parameters of looks, validating and drawing sticker and solid specs, requests and replies in both API styles, the 3D view's projection, picking and labels, both languages present for every string, no native `confirm()`, `alert()` or `prompt()` in `ui/`; the agent tools (`agent.test.mjs`): every definition whole and marked as the spec has it, the enums the app's constants, `ui/tools.json` up to date, the argument check's verdicts and sentences (a 40 MB string checked at once, characters counted as JSON Schema counts them), finding profiles, channels and sizes, the answers' shapes, the read-only commands, selection, undo and redo over a stand-in `API`, every tool a command (none pending), the photo, cut-out, weave, Surprise me, project and file tools refusing what is wrong before anything is touched and doing what the editor does (`coverDiff()`, `imageType()`), `place_layer`'s arithmetic (`placeAt()`, `placePatch()`) through `adjust()` and `resolve()` in all three scopes, a change refused before anything is touched (no switch, no edit) and one done as the editor does it, aimed where it is told, the queue, `whenIdle()` and the dispatcher (a call that hangs let go of at its timeout, on a cancel and when the user stops waiting, the next one run, a late answer dropped, its step ended as it stood; those waiting told so; every call answered) |
| Rust unit tests | `cargo test --workspace` (`npm run test:rust`) | path sandbox, store round trip, frame parsing, encoding in the three formats, file name handling, an export never over a file (`fresh`), the files an agent names (`read_picture`, `read_project`: only pictures and projects, absolute, within their caps), requests against a local stand-in server, proxy rules, a face cut out of a font collection, traced outlines, fonts found by name (bundled, imported, imported again), the cut-out's models and packages; the MCP endpoint's tool list (the fixture's and `ui/tools.json`), token, `mcp.json` and dispatcher (on a paused clock), and, over HTTP on a free port (`core/tests/mcp_http.rs`), both eras of the protocol, rmcp's own client, the token, `Host` and `Origin`, progress, cancelling, bodies and stopping; the desktop's reading of its self-test's preview (`mcp.rs`) |
| End-to-end self-test | `SMEDCOVER_SELFTEST=<folder> <executable>` | the full export path between the real web view and Rust; with `SMEDCOVER_SELFTEST_AGENT=1` the agent tools, and with `SMEDCOVER_SELFTEST_MCP=1` too the app's own endpoint over HTTP (below) |

In self-test mode the app keeps its data in the given folder, exports a few covers in all three
formats and one more in every other look, writes `report.json` and quits. With `SMEDCOVER_SELFTEST_AI=<stand-in server URL>` it also
generates one asset in each API style and draws it on a cover. It catches problems that only show up in the real app, such
as the header issue above.

It also times every look effect (`fxTime` in `report.json`, with `FX_TIMING`), at its own defaults, alone on a layer as large as one gets — a print filling the canvas, a colour filling it, a large word, a large sticker — on a canvas as wide as the editor's on a laptop (1600 px; a large screen's is up to 2,880 px) and as a look card's (300 px). An effect is worked out again for every canvas a cover is drawn on (the size thumbnails, the look cards, the 3D view's sheets), so one whose work does not shrink with the canvas holds them all up, as Record sleeve's halftone did (5.9 s and 1.8 s). Past `FX_BUDGET.slow` (100 ms; 30 ms on a card's) it is timed again and listed (`slow`); past `FX_BUDGET.max` (4 s; 1 s, room for a slower Mac than the M-series one whose slowest took 1.4 s and 0.4 s) it is an error. One past `slow` on the card that takes there more than a quarter of what it does on the editor's canvas is listed as shrinking little (`shrinksLittle`). `SMEDCOVER_SELFTEST_LOOKS` narrows it too; each look is a step in `selftest-progress.txt` (`fxtime-<look>`).


With a real photo (`SMEDCOVER_SELFTEST_PHOTO=<file>`) it also cuts out its subject, sets it over the title and writes the cover woven by the head, by letter (in the house lettering, in one lettered upright, in the ransom note), with the lettering half see-through, by the brush (a band along the title's second line in front, then up to the subject's middle behind again), and once dragged (`weave-*.png`), with an error when a woven cover looks as the cover unwoven (or the brush's, as before part of it was painted behind), when a drag's frame lets the lettering through elsewhere than a still cover does, when the frames of the head line's slider do not follow it, or when dragging the title over the subject works out the subject's look effects again. With or without a photo, it also weaves a sticker set over the title the same way, by its top, by the brush and by letter, and drags it and the title (`weave-asset-*.png`), with an error when a woven cover looks as the cover unwoven, when the lettering comes in front where the sticker does not show (where the cover unwoven is as the cover without it, two pixels round it), or when a drag's frame lets it through elsewhere than a still cover does.

With `SMEDCOVER_SELFTEST_AGENT=1` it also starts the agent shell (11.1) — what holds a call back being `userBusy()`'s but the self-test itself — and calls the read-only tools, the selection, undo and redo through its dispatcher as an agent's calls come (`agentTest()`): `get_context` lists the profiles, channels and sizes there are, and what the window shows; `get_cover`'s layers are the cover's; `render_preview` decodes at the longer side asked (640, and a tall size 512 high, of another channel, the window not switching), and every size on one sheet; `select_layer` selects as asked; after a change made by hand, `undo` takes `S.histIdx` back past it and `redo` forward again; `agentStep()` makes a change one step, nothing no step, and puts back a change that fails, redo left as it was; an unknown tool, a wrong argument and a call refused (a crop of the title, a picture that is not there) answer as the host expects; and a call waits for a dialog. Then the tools that change the cover (`agentToolsTest()`), on the self-test cover: each change of the words, the look (a setting clamped and said), the channel's colour, a layer's place (at the size asked, which the window then shows), effect, font, bend, colours and showing, and adding, reordering and removing layers makes exactly one step, one that changes nothing none, and `undo` brings back the state before it and `redo` the change; refusals (`remove_layer` on the title, `place_layer` on the frame or bg, a font not there, a look's setting it has not, a copy of the frame, one aimed at another channel) answer `invalid_arguments` without a step or a switch; a call aimed at another channel switches the window there, its change the first step of the new history; and `agentStep()` keeps a switch done when what follows fails, undoes a switch of channel or of profile begun and not done, and keeps redo when a step taken meanwhile is let go; a step let go of is committed as it stood, and settling later it leaves a later step whole. The cover, the profile and the channel shown are put back as they were. Then the photo, cut-out, weave, Surprise me, project and file tools (`agentFilesTest()`): a picture the self-test draws and writes into its folder (`agent-photo.png`) put on from its file, again from the library as the background, and one as data; the print cropped to a rectangle and to a shape and back; the self-test photo cut out (`SMEDCOVER_SELFTEST_PHOTO`, an engine ready) and the cut-out — else a sticker — woven by its head and by letter, `__proto__` refused; Surprise me dealt with the look locked (its sheet decoded and written, `agent-surprise.png`; no look counted, the locks not kept) and another hand taken on its step, refused once the deal was undone; a cover applied whole (a setting out of range corrected, the tag put back, a picture not there said); a project written into the data folder opened as a new profile and into the current one; each change exactly one step, undone and redone. Two exports of the same sizes into `data/agent-export`, the second under fresh names — twice as many files, none written over — the folder not kept, and none with no folder; batches from jobs and from a CSV into `data/agent-batch`, one naming a channel the profile has not writing nothing, the covers unchanged. The profile the project made is removed and all put back as it was; the findings go under `agent.files`. Its previews are written into the folder (`agent-preview.png`, `agent-preview-tall.png`, `agent-sheet.png`) and its findings go under `agent` in `report.json`, any error among the report's.

With `SMEDCOVER_SELFTEST_MCP=1` as well, the app's own endpoint is started too, on a free port with a new token (`mcp.json` in the folder's `data/`, left off), and once the agent shell has attached its page, `mcpTest()` has Rust call it over real HTTP with that token, as a client would (`selftest_mcp` in `mcp.rs`): `initialize` of 2025-06-18 and `notifications/initialized`, `tools/list`, `get_context` and `render_preview` (480 px) carried out by the page, and a request with a wrong token. What came back goes under `mcp` in `report.json` (the tools listed, the context's profiles, the preview's bytes and size, each request's time, the wrong token's status, whether the client was seen), and it is an error when the tools are not the desktop's, the page's tools not those listed, the profiles not the window's, the preview not 480 px on its longer side as it says, the wrong token not refused (401), or the client not seen.

`SMEDCOVER_SELFTEST_STAY=1` runs no self-test: the app keeps its data in the folder's `data/` (a new folder starts with the sample profile, without the welcome) and is otherwise as it is on its own — the window stays open, the agent shell attaches, the endpoint starts when `mcp.json` there says it is on. It is the way to try something by hand on a data folder of its own, such as the endpoint from a terminal (`curl` against the port Settings → Agents shows, with its token), never touching the user's.

With `SMEDCOVER_SELFTEST_LOOKS=<look ids, comma-separated>` it goes through those looks only — their covers with and without a photo and with every slider at its far end, their layer effects, and their scene objects moved with the handles showing (the basketball poster's otherwise); the drag timing below then times only their scene objects too. Each step is noted in `selftest-progress.txt` in the data folder as it starts, so a run that stalls shows where. The stalls it used to have (every process idle, the web view waiting, at a different step each time) came from its window opening off screen — on another desktop, behind a full-screen app: WebKit stops drawing for a window that cannot be seen, so a canvas read back from the graphics card (an export, a PNG) never returns. In self-test mode the app therefore tells the web view not to watch whether its window can be seen (`_setWindowOcclusionDetectionEnabled:`, the setting WebKit's own tests use; `keep_drawing()` in `mcp.rs`, which `setup` calls, and the agents' endpoint while it runs, 10.6). The city pop and constructivist looks also recolour the photo itself, once, in memory (`treatedOf()` in `photo.js`) rather than reading the canvas back on every redraw.

With `SMEDCOVER_SELFTEST_PERF=1` it times how soon things show instead (`perfTest()`): when each step of `start()` was
over (`BOOT`, `booted()`, ms since the page began to load) and when the page began (`timeOrigin`, to time the window's
own opening from outside); the 3D view opened at once (every layer's sheet there, sheets painted: one each when nothing
starts it over), the Look sheet's cards (in sight shown, in sight and all drawn as they are to be, cards drawn), the 3D
view again, warm; `firstDraw`, what the start's first drawing of the canvas spent its time on (by layer, `TIMING`; pixels in script, `PIXELS`; look effects, `FX_TIMING`, switched on before it); then it writes the cards' pictures and the outlines, as a user's stay would, for the next start on
the same folder to find. With `SMEDCOVER_SELFTEST_PHOTO` the cover has that photo filling the canvas; the first start on
a folder makes the cover busy (ten more words reshaped by effects that need outlines, some in the first four installed fonts by name that a canvas outside the page cannot reach: tried one by one till they are found, for trying a font loads it, some 30 ms each — all 1,600 of a well-stocked Mac took 53 s).

With `SMEDCOVER_SELFTEST_DRAG=1` the self-test times editing instead: it reads the cover in the data folder (a copy of real app data can be put there) and, at a Retina screen's pixel ratio, times a whole redraw (first, and again with everything cached), the size thumbnails, dragging each text and photo layer across the canvas with pointer events (the first frames of each drag, and the frames after), stepping the sliders of the photos that cost most (dim, the soft edges, outline), the current look's own sliders (a whole redraw with each at 0, then each stepped as a drag steps it — a draft keeping the layers that did not read it, see 9.3 — and again as a draft that paints every layer), and, when the cover has look effects, each effect's own time. Each part is split into the layers that cost most (`TIMING` in `render.js`) and the time spent computing pixels in script, such as blurs (`PIXELS` in `photo.js`); both are off otherwise. A frame is waited for at most a second, as a covered window gets none.

## 14. Trade-offs and known limits

- **Layers are cached only while dragging.** Typing a title or moving a look slider still redraws everything, about 44 ms each time in cyberpunk. On a heavy cover at a Retina pixel ratio (19 layers, 7 photos) a whole redraw takes about 120 ms, nearly all of it drawing on the GPU and the look's effects over the whole canvas rather than script; the frames of a drag then take 17 ms, but its first frame or two, which paint the layers that stay still, take about 100 ms.
- **Drawing runs on the interface thread.** Painting a 4× cover briefly stalls the window. Conversion and writing are already on a worker thread.
- **No bundler.** Modules are loaded directly by the web view: simple, but nothing is minified or tree-shaken. At the current size start-up time is negligible.
- **Undo keeps full snapshots.** Simple and robust; it would need to become incremental if the data grows.
- **All thumbnails are redrawn every time.** With many sizes this is the main cost. So as not to hold the window up they are drawn one per turn of the event loop, a new round stopping one under way, and never during a drag (`LIVE`) — on a heavy cover a drag that paused would let them in, and the next frame of the drag would wait for them, frame after frame, a few hundred milliseconds each.
- **Bundled fonts are not subset.** They account for most of the installer.
- **Only run on macOS so far.** The Windows and Linux build configuration is written but not verified.

## 15. Where to start for common changes

| To… | Change |
|---|---|
| add a channel graphic | write the draw function in `graphics.js` and `registerGraphics()` it; `assets.js` needs nothing |
| add a sticker | `stickers.js` |
| add a colour block shape | `ACCENT_SHAPES` in `layers.js`, `paintAccent()` and `edgePoints()` in `render.js`, its tile in the Layout sheet (`SHAPE_ICONS` in `app.js`), a name in `i18n.js` |
| add a template | `TEMPLATES` and `layout()` in `layout.js`, a name in `i18n.js` |
| show the Layout sheet's template box again, or change the colour block's *Size & slant* (its *Block position*, *Mirror*, sliders and *Block by orientation*) | `TEMPLATE_BOX` and `layoutBox()`; `blockSection()`, `blockSliders()`, `layoutAdjuster()`, `layoutScope()` and `byOrient()` in `app.js`; `tpl.*` and `style.byOrient*` in `i18n.js` |
| add a property to a layer | `PROPS` and `normalizeLayer()` in `layers.js`, `PAINT` in `render.js`, `typeControls()` in `app.js` (`headlineControls()` for the title and text layers) |
| change the controls of the properties (a scrub bar, a switch, ways side by side, a choice among many, a colour), or the drawer's head | `scrub()` (`SHOWN`), `switchRow()` and `check()`, `segs()`, `picker()` and `openPicker()`, `swatch()`, `psec()`, `secSum()`, `drawerHead()` in `app.js`; `.psec`, `.bar`, `.rs`, `.swr`, `.tog`, `.pk`, `.pklist`, `.cb` and `#right .dhead` in `index.html` |
| add an export format | `encode()` in `core/src/image.rs`, `EXT` and the format pickers in `app.js` (`exportDialog()`, `sizesTab()`) |
| add a drawing operation for AI assets | validation and `drawSpec()` in `spec.js`, the prompt and examples in `ai.js` |
| add a kind of part to solids | validation and `pieces()` in `solid.js`, `solidPrompt()` and its examples in `ai.js` |
| change the shape a repaint is asked for, or how what comes back is fitted to its photo | `repaintSize()` and `coverCrop()` in `repaint.js`; `fitPicture()` in `app.js` |
| add a look | a file `looks/<id>.js` exporting the look's object (starting with a hook or two), imported and put in `LOOKS` in `style.js` |
| change how Surprise me deals | `RULES` (every number), `FAMILIES` and `RECIPES` (what suits each look) in `deal.js`; the chances as shipped, `surprise.odds` in `defaults.json` |
| add or change an agent tool | its definition in `TOOLS` (`tools.js`), then `npm run tools`; what it does in `makeCommands()` (`commands.js`), reaching the app through `API` at the foot of `app.js` — one that changes the cover starts with `aim()`, which checks what it names and brings the window there, then does what the editor does; for one that changes something, `agent.step.<tool>` in `i18n.js`; one done comes off `PENDING` in `agent.test.mjs` and into `agentToolsTest()` |
| change how the chances window shows and sets the chances | `DOTS`, `EVEN_DOTS`, `dotsOf()`, `withDots()` (the looks' dots) and `moveShare()` (a bar's divider) in `deal.js`; `oddsLooks()`, `oddsGroup()` and `oddsDialog()` in `app.js` |
| change how the AI generate window is laid out | `genWin()`, `madeStrip()`, `specPreview()` and `KIND_ICONS` in `app.js`; `.dlg.genw` and the rules after it in `index.html` |
| put a look in a kind, or add a kind | `LOOK_TAGS` and `LOOK_CATEGORIES` in `style.js`, a `look.cat.*` name in `i18n.js` (a test holds every look to a kind and every kind to a handful of looks) |
| change ★ Most used or ♥ Liked in the Look sheet | `mostUsed()`, `countLook()`, `likeButton()`, `likeLook()`, `sortLooks()`, `ownAlways()` and `lookFilter()` in `app.js`; what is kept, `lookUse` and `lookLikes` in `normalizeSettings()` (`store.js`) |
| add a card that previews on the canvas | a kind in `PREVIEW`, what it changes in `previewed()`, its words in `previewTag()`, `previewSoon()` on its cards and `endPreview()` where they are built anew (`app.js`) |
| add a token to the file names | `exportName()` in `store.js`; `NAME_TOKENS` and `NAME_TOKEN` in `app.js`; its chip's name `exp.tok.*` in `i18n.js` |
| add a keyboard shortcut | the window's `keydown` listener in `app.js`, above `start()` (its order decides what a dialog, a field or Surprise me's window lets through); `MOD_KEY` writes it |
| light another AI request | wrap it in `aiTracked()` with its service and settings (`app.js`, see 8.6) |
| change what a layout preset holds | `LAYOUT_PARTS`, `COLUMN_PARTS` (whose words a preset sets in a line or in columns), `takeParts()`, `takeLayout()`, `putLayout()`, `presetLayout()` and `setPresetLayout()` in `layers.js`, `normalizeLayouts()` in `store.js` |
| change the Layout sheet's preset cards: their pictures, when those are drawn, a card's ⋯ menu | `presetCards()`, `presetPic()`, `refreshPresetPics()` (`PRESET_PICS`), `renamePreset()`, `whenIdle()` and `laidOut()` in `app.js`; `o.fast` in `drawCover()` (`render.js`); `.preset` in `index.html` |
| change which layers a preset's elements of the user's own place, or what is added where there are none | `EXTRA_KINDS`, `takes`, `extrasOn()`, `extraLayer()` and `insertExtra()` in `layers.js`; `presetEnv()` in `app.js` (the channel, which assets are vector ones, the words and colour added) |
| change how an element of the user's own is drawn in the preset editor, or where it comes in | `standIn` in `layoutEditor()` and `PORTRAIT` in `app.js`; `newExtra()` in `layers.js` |
| change how the colour block is moved to a side in the preset editor | `sideToward()` and `onSide()` in `layout.js` |
| change how one block change lands on blocks that lie otherwise (every size) | `sideLike()`, `scaleBlock()` and `blockValues()` in `layout.js`; `blockOf` in `layoutEditor()` |
| change which sizes count as wide, square or tall, or each one's default layout (what a new profile, a size added, a new preset and *Block by orientation* give it) | `orientOf()`, `orientDefault()`, `layoutByOrient()`, `layoutAdded()` and `templateDefault()` in `layout.js`; `layout.byOrient` in `defaults.json` |
| change what a layer kept to some sizes is at the others | `coverAt()` in `render.js`; the list's labels `sizesNote()` in `app.js` |
| change what a row of the layer list shows (its tile, the grey line under its name, its chips) or the bar at the sheet's foot | `layerRow()`, `layerTile()` (the Background's and the colour block's pictures: `layerPics()`), `layerSub()`, `layerKinds()` and `renderSide()` in `app.js`; their look, `.layer` and `.selbar` in `index.html` |
| change what goes with a photo whose background is removed at some sizes | `showApart()` (and `cutAt()`, `cutFrom()`) in `layers.js` |
| change which sizes of another profile's a size takes the place of, when layers come from there | `standsFor()` in `layout.js`; `acrossSizes()` in `layers.js` |
| change how a free crop is kept, edited, painted or caught | `normalizeCrop()`, `CROP_AREA`, `hasArea()`, `polyArea()`, `cropPoly()`, `dragPoint()`, `addPoint()`, `dropPoint()`, `movePoly()`, `edgePoint()` and `inPoly()` in `layers.js`; `tracePoly()`, `cropShape()` and `hitAt()` in `render.js`; `cropShow()` and `cropDropPoint()` in `app.js` |
| put a setting on the bar over the canvas | `barItems()` in `app.js`: a group of the properties by its key (`sec`), controls of its own (`pop`) or an action (`act`); `dot`, `icon` and `sep` for how it looks |
| add a sheet to the dock | its function in `TABS.edit` and an icon in `SHELL_ICONS` (`app.js`); `dock.*` and its heading's `sheet.*` in `i18n.js` |
| add a page to Settings | its function in `TABS.setup` and an icon in the `icon` map inside `syncTabs()` (`app.js`); `tab.*` in `i18n.js` |
| change when the note on slow glass shows, or how the panes go plain | `glassWatch()`, `setGlass()` and `CAN_BLUR` in `app.js` (how slow, `ui.glassSlowMs` in `defaults.json`); `html.solid` in `index.html` |
| change how the ground behind the glass fades into a new cover | `paintAmbient()` and `ambientMoved()` in `app.js`; `#ambient` in `index.html` |
| move the window's buttons, or what moves the window | `trafficLightPosition` in `tauri.conf.json` (Mac); `ownTitleBar()` in `app.js`; `html.ownbar` and `#winbtns` (Windows, Linux) in `index.html` |
| change the window's size or other settings | `app.windows` in `tauri.conf.json`, and again in `tauri.windows.conf.json` and `tauri.linux.conf.json`, which replace that list whole |
| change when the drawer takes the sheet's place, or the columns stack | `centreRoomy()`, `STACKED` and `columns()` in `app.js` (the widths, `ui` in `defaults.json`); `.body.tight` and the `max-width: 1000px` rules in `index.html` |
| change a default: a setting's, a new profile's, each orientation's layout, Surprise me's chances, the window's numbers | `defaults.json`; for a key of its own, what reads it too (`normalizeSettings()` and `normalizeProfile()` in `store.js`, `starterProfile()` in `presets.js`, `orientDefault()` in `layout.js`, `RULES.odds` in `deal.js`, `column()` in `app.js`); how `custom.json` is laid over it, `layOver()` in `defaults.js` |
| keep another setting of the user's | a field in `normalizeSettings()` (`store.js`), the one place settings are checked, with its default in `defaults.json`'s `settings` if it has one; set it on `S.settings` and call `persistSettings()` (`app.js`), which writes it to `custom.json` where it differs from the default (`settingsToKeep()`) |
| add an interface string | `i18n.js`, in both languages; a test checks that both are present |
| ask before something that cannot be undone | `await askSure({title, body, go})` in `app.js` before acting (never the browser's `confirm()`, `alert()` or `prompt()`: a test keeps them out of `ui/`); `#ask` in `index.html` |
