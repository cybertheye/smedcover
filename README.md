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
| **Profile** | Everything about one brand: its name, channels, output sizes, template and a default design. You can keep several. |
| **Channel** | One content line within the brand, with its own name, colour and graphic. A cover takes its colour and graphic from its channel. |
| **Cover** | The one you are editing: its channel, title, corner tag and its own stack of layers. |
| **Layer** | Each part of a cover. Built-in layers (background, colour block, title, …) are on every cover; free layers are the stickers, images and text you add. |
| **Project** | The current cover saved to a file together with its profile and the assets it uses, so it can be reopened as it was. |

## The window

Three columns, with two modes at the top: **Edit** and **Setup**.

- **Left** — the tabs of the current mode.
  - Edit: **Cover**, **Style**, **Assets**
  - Setup: **Brand**, **Sizes & export**, **AI**
- **Centre** — the main canvas, and below it a thumbnail of every output size. Click one to show that size on the canvas.
- **Right** (Edit only) — the layer list and the selected layer's properties.
- **Top bar** — profile switcher, open and save project, undo and redo, SURPRISE ME, export. Those last two buttons dress to match the look of the current cover.

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
- Click the background once to select it, then drag the photo to move it; scroll to resize it.
- Select the Background layer on the right to set blur and dim.
- Once a photo is chosen, a thumbnail and its size appear below.

### Repainting the background photo with AI

With a photo chosen, *AI repaint* below it has an image model paint the photo again in another style. Set up an image model first under *Setup → AI* (see [Setting up AI](#setting-up-ai)).

The style comes from one of three places:

| Source | What it does |
|---|---|
| Follow the current look | Repaints in the cover's look (each look has its own repaint description), with the channel colour as accent; keeps the photo's composition, so the subject stays where and as big as it was and its placement on the cover still fits |
| Built-in · 8-bit pixel editorial | Distils the photo into a sparse, abstract 8-bit pixel piece: a small cluster of coarse pixel blocks on a wide paper field, or a few broad pixel planes edge to edge. Adapted from [TwentyfiveBTea/8bit-pixel-art](https://github.com/TwentyfiveBTea/8bit-pixel-art) |
| My styles | Styles you keep, each with a name and a prompt, renamed, edited or deleted at any time and saved as you type. *＋ New style…* starts from nothing; with a built-in style selected, *Copy into my styles* gives you a copy to rename and edit. A whole style guide (such as a skill's `SKILL.md`) can be pasted in |

- *See the prompt* unfolds a built-in style's prompt. It lives in the code, in `REPAINT_PRESETS` in `ui/js/repaint.js`; to change it without touching code, edit a copy made with *Copy into my styles*.
- *Anything to add* is optional and goes after any source. Every source is followed by: no text or watermarks, no border, keep the photo's shape.
- The result is shown beside the original first; *Use this* replaces the background photo, and *Back to the original* is there afterwards. A new repaint always starts from the original, so repaints do not pile up.
- Both the repainted photo and the original are saved in project files.
- If the service answers that it does not take one of the optional settings sent (such as the size or the watermark), the app sends the request again without it.
- Each repaint is charged at the service's prices and usually takes tens of seconds.

### Collage: work directly on the canvas

| Action | Result |
|---|---|
| Click | Select the topmost layer |
| Drag | Move |
| Drag a corner | Resize |
| Drag a side | Stretch horizontally or vertically |
| Drag the top knob | Rotate |
| Drag a box on the background, the colour block or a locked layer | Select several: what lies wholly inside is selected; with Shift, added |
| Shift + click | Add an item to the selection, or take it out |
| Drag any item of a selection | Move them together; arrow keys nudge them together, Delete removes the ones you added |
| Scroll | Resize; with Alt, rotate |
| Arrow keys | Nudge by 1; with Shift, by 10 |
| Delete | Remove the selected free layer |
| Esc, or a click outside the canvas | Deselect |
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

### SURPRISE ME: deal a new hand

**SURPRISE ME**, beside *Export* in the top bar, draws at random everything about how the current cover is drawn and laid out:

- the look, its sliders and its random placement
- the template, how much the colour block takes, the slant of its edge, whether the halves are swapped, dark or light ground
- the shape of the colour block, the grid
- the title's text effect, outline and shadow
- each text layer's plate, colour and text effect; whether a sticker follows the channel colour
- stickers, images and text you added are nudged, turned and resized a little

**Left alone**: the words of the title and tag, the current channel and every channel's colour, the background photo, which layers exist (none added, none removed), custom lettering colours, locked layers.

Each deal is one step of undo, however fast you click. Deal again if you do not like it, or undo to the hand before.

### Text layers

Add one with **＋ Text** on the right. A text layer has three settings that do not depend on each other:

| Setting | Decides |
|---|---|
| Plate | whether the text sits on a block of colour |
| Colour | White, Channel colour, Ink, or Custom. With a plate this is the colour of the **plate**, and the lettering takes whichever colour reads against it |
| Text effect | how the letters are drawn; see the next section |

A layer set to *Channel colour* changes with the channel; a *Custom* colour stays as it is.

### Fonts

Every layer that carries words (title, corner tag, channel name, brand row, text layers) chooses its own font. Select the layer and look under *Font* in its properties:

- **Default** — the bundled face, following the current look (a serif under Woodblock book, say). New layers start here.
- **Recent** — the fonts used last, to reuse on other layers.
- **Built-in** — Noto Sans SC, Bebas Neue, JetBrains Mono; the same on every platform.
- **Imported** and **System fonts**.
- The last entry, **＋ Add a font file…** — pick a font file: it is stored in the app and used on this layer at once, and from then on every layer finds it under *Imported*.

A font marked *no Chinese* has no Chinese glyphs: choosing it changes Latin letters and digits only, and Chinese stays in the default face. To change the Chinese, pick a font without the mark (PingFang, Songti, Kaiti…). Imported fonts are not checked.

Imported fonts live in this computer's app data and do not travel with profile or project files; opened elsewhere, a font that is not there shows as "not on this computer" and the default is used.

### Text effects

The title and every text layer (with or without a plate) can be given a text effect of their own instead of following the look. Select the layer and choose under *Text effect* in its properties:

| Kind | Effects | Notes |
|---|---|---|
| Automatic | follows the look | The default: the current look's own lettering |
| Layered | outline and shadow, plain, sliced, overprint, double keyline, plain upright, underlined highlight | The looks' own letterings, usable under any look |
| Masked | halftone inside, stripes inside, inner shadow, worn, row shift | Change what is inside the letters |
| Outlined | extruded, arched, tapered, wave | Reshape the letters themselves |

Masked and outlined effects have a *Strength* slider. The title's *Outline* and *Shadow* sliders can be moved only when the current effect draws an outline or a shadow: Plain, Plain upright and Underlined highlight have neither, Overprint only the shadow (how far its two colours sit apart); otherwise the slider is greyed out and says why.

Outlined effects read the font file to get each letter's outline: the first time a piece of text is used it shows as ordinary lettering for an instant and then changes; an export waits for the outlines before drawing. Bundled fonts, installed fonts and fonts you imported are supported.

### Lettering colours

Every layer made of words can be given its own colour. Select the layer and look in its properties:

| Layer | Colours you can set |
|---|---|
| Title | lettering colour, and highlight colour (for words in `*asterisks*`) |
| Text layers | under *Colour*: White, Channel colour, Ink, or *Custom…* and a swatch to pick one |
| Corner tag, channel name, brand row | lettering colour |

Without one a layer shows *Automatic*: the colour comes from the current look and the channel colour, and follows when you switch either. Once set, the colour stays as it is; *Back to automatic* clears it.
The plates themselves (behind the tag, behind the channel's sub-name) are not included: they still follow the channel colour.

### Items for some channels only

Select a free layer and use **Channels** at the bottom of its properties:

- **All channels** (default) — the layer is on every channel's cover.
- Click a channel — the layer is only on that channel's covers. You can pick several.

A restricted layer shows a small dot in the list. On other channels it is neither shown nor exported.
Deleting a channel also deletes the layers that belonged only to it.

### Assets

- **My assets** — upload PNG, SVG, JPG or WebP; transparent PNGs look best.
- **Channel graphics** — twenty cel-shaded graphics that follow the channel colour.
- **Stickers** — a free pack of sixty; each can optionally follow the channel colour.
- **Colour block & edge** — twelve shapes; click one to reshape the colour block layer.

### Generating assets with AI

At the top of the Assets tab, pick a kind, type what you need ("a washing machine", "a trophy", "a ginger cat") and click **Generate**.

| Kind | Result | Best for |
|---|---|---|
| **3D object** (default) | An object built from boxes and cylinders, drawn like the built-in channel graphics: three tones, screentone, ink lines, a ground shadow | devices, machines, vehicles, buildings |
| **Flat sticker** | Flat colour with a heavy outline, drawn like the built-in stickers | animals, characters, food, symbols |

- The result is previewed twice: in its own colour, and following the current channel colour. If you like it, **Save to My assets** and use it like any other asset.
- **Reference picture** — below the text box you can attach a picture. The model first finds its main subject (ignoring the background, the table, the hand holding it, captions and watermarks), then draws that subject in the current look, solid or flat as chosen above. The text box can stay empty; write a word only to pick one thing out of several ("just the cup"). The picture is scaled down to 768 px on its longer side before it is sent. This needs a model that accepts image input; one that does not answers with an error, and the app says why.
- A generated asset is the same kind of thing as a built-in one: sharp at any size and usable as a channel's graphic.
- Once on the canvas it **follows the channel colour by default**, changing as you switch channels; untick *Use the channel colour* in the layer's properties to keep its own colour.
- The style comes from a prompt preset in the app; you only describe the subject.
- You first connect your own model service under *Setup → AI*, see below.
- While generating, the button shows the seconds waited and you can **Stop waiting** at any time. That only stops waiting: the request has been sent and your provider may still bill it.
- A model sometimes answers in a form the app cannot use. The app then tells the model what was wrong and **retries automatically, up to 3 times**; the button shows which attempt is running. Each retry is a new call and is billed separately. Connection errors, timeouts and cut-off replies are not retried.
- 3D objects are made of boxes and cylinders only — no spheres or curved surfaces — so round things (animals, fruit) come out blocky. Weaker models fail more often and build cruder shapes.

### Looks

**Look**, at the top of *Edit → Style*, decides how the whole cover is drawn. Switching it changes the background, the colour block, the title and other lettering, the channel graphics, the stickers and AI-generated assets together; content, placement and layers stay as they are, and you can switch back at any time. Under the menu, a note on the current look says what it looks like, what is particular to it and what it suits.

| Look | What you get |
|---|---|
| **Cel** (default) | heavy ink lines, hard shadows, flat colour, screentone |
| **Cyberpunk** | set in the interface of an optical implant starting up and scanning, after *Cyberpunk 2077*: solid chamfered panels with black lettering, slanted sliced headlines in the channel colour, a red and cyan colour split, signal tears, scanlines, lens rings and readouts; objects are dark hardware drawn in lines of light |

| **Risograph** | cream paper, two or three spot inks, coarse halftone, misregistration, paper grain; objects are paper white and blue ink |
| **90s animation** | a painted sky, cel colours a little grey and warm, a title with a double keyline, film grain, bloom, fade, dust and scratches |
| **Record sleeve** | large flat blocks of colour, tight sans-serif headlines with no outline or shadow, photos in one colour and black; flat layouts of its own; dark or light ground |
| **Editorial** | a serif headline, thick-and-thin rules, a hairline border, a folio, a huge quiet issue number, black-and-white photos; flat layouts of its own; dark or light ground |
| **Woodblock book** | a leaf from an old Chinese book: paper ground, a serif title set in vertical columns, the corner tag as a vermilion seal, a thick-and-thin border, ruled columns, a centre column with fishtails at the right edge; objects like woodcuts; flat layouts of its own |

The sliders of each look:

| Look | Sliders |
|---|---|
| Risograph | misregistration, halftone, paper grain |
| 90s animation | film grain, bloom, fade, dust and scratches; *Shuffle the random placement* rearranges clouds and dust |
| Record sleeve | photo duotone, rules and catalogue, paper grain |
| Editorial | rules and folio, black-and-white photo, paper grain |
| Woodblock book | column rules, age, paper grain, and a *Set the title vertically* checkbox; *Shuffle the random placement* rearranges the foxing |

**Layouts of their own** — the record sleeve and editorial looks do not use slanted panels. They read the three *Template* choices their own way: Stack is a level band, Split an upright side panel, Banner a slim strip, each in its own proportions. Switching to another look brings the usual layouts back.

*Photo duotone* and *Black-and-white photo* only do something when there is a background photo.

**The vertical title of the woodblock look** — each typed line is a column, read top to bottom, the first line on the right. CJK characters stand upright; a run of Latin letters or digits lies on its side, as is usual in vertical setting. A vertical title takes the full height of the page and stands clear of the seal in the lower left. Text effects do not apply to a vertical title; untick *Set the title vertically* for a horizontal one, and they apply again.

These five are first versions and will be refined one by one. The serif lettering of Editorial and Woodblock book uses fonts already on the computer by default (Songti SC on macOS, SimSun on Windows), so it differs from machine to machine. For a Kai or Fangsong face, or any other, select the title layer and choose under *Font* in its properties.

The cyberpunk look has eight sliders and a checkbox. Two of them sound alike: *Scanlines* are the fine horizontal lines covering the whole picture; the *Sweep line* is the single bright one.

| Slider | What it controls | Turning it up |
|---|---|---|
| Colour split | red and cyan pulled apart across the whole picture; the red and cyan "echo" behind the title, stickers and the tag follows it | more glitch; 0 gives a clean picture with no echo |
| Signal tear | a few horizontal bands pushed sideways | more bands, pushed further; 0 gives none |
| Scanlines | the dark horizontal lines across the picture | more old monitor; 0 is the sharpest picture |
| Interface detail | the interface of an optical implant starting up and scanning: lens rings, a sweep line, a start-up log up the right edge, a ruler up the left, a status line, signal meter, code block and hazard stripe along the bottom, a lock-on ring and readout around the channel graphic, the huge channel code in the background | more of them appear in turn; 0 leaves only the corner brackets |
| Sweep line | the single bright line across the picture and the band of light above it | brighter; **0 hides it** |
| Sweep position | how far down the picture the sweep sits | lower; **0 leaves it to chance** |
| Line glow | how far the lines of channel graphics and solids glow | brighter and softer; 0 gives clean thin lines |
| Photo tint | how far a background photo is pushed toward the channel colour and into the dark | a darker, more stylised photo; 0 keeps its own colours |
| Keep tears off lettering (checkbox, last) | no tear lands on the rows of the title, text layers, the tag, the channel name or the brand row | on by default; untick to let tears cross lettering |

**Random placement** — the tears, the sweep line and the lens rings fall at random but then stay put, so the export matches the preview and every size agrees. *Shuffle the random placement*, under the sliders, rolls again — when a tear lands across the title, say.

**Text layers** are drawn differently in this look too: without a plate, slanted sliced lettering in the channel colour with highlighted words black on a chamfered plate; with one, a chamfered label plate with a small tab on its left.

Most of the interface detail is painted on the *Corner brackets* layer, so hiding that layer removes it at once; the lock-on ring around the channel graphic travels with the graphic. The colour split and the signal tear are paused while you drag a layer and return when you let go, to keep dragging smooth. Cyberpunk is dark only, so the *Background* choice is hidden while it is selected.

Each look's values are saved separately in the profile, so switching away and back loses nothing. When generating assets with AI, the style section of the prompt follows the current look.

### Adjusting the template

With a template chosen under *Style*, *Adjust the template* below it changes it:

| Control | What it does |
|---|---|
| Band height (*Panel width* for Split) | how much of the picture the colour block takes |
| Edge slant | how far the dividing edge leans; 0 is level or upright |
| Swap | the band on top and the title below; or the panel on the left and the title on the right |

Or drag on the canvas: with *Colour block & edge* selected, the dividing edge has a diamond at each end and in the middle — the ends change its lean, the middle moves it; with *Title* selected, the dashed box has a diamond on its right and bottom sides: drag them to change the room the title may use, and its size is fitted automatically. That room is set on the canvas only.

Adjustments are stored as fractions of the picture, so they apply to every size; each of the three templates keeps its own, in the profile. After a swap the brand row sits on the colour block and turns to ink. If the colour block layer itself has been moved or turned, the diamonds on the edge are hidden; reset that layer's placement to get them back.

### Style and the default design

- Three templates — Stack, Split, Banner — on a dark or light background.
- **Set as default** stores the current layers, including items you added, as the profile's starting point for every new cover.

## Setup

- **Brand** — brand name, counter label, adding, removing and ordering channels; while you work on a channel (click any of its fields or change its colour) the canvas switches to that channel, so the change shows at once; create, duplicate, delete, import and export profiles.
- **Sizes & export** — tick preset sizes or add a custom width × height. A size can be given your own name, shown under its thumbnail.
- **AI** — connect your own model service for generating assets.

### Setting up AI

SmedCover ships no model and no account. You need a service that speaks one of the two API styles below: an official API, a third-party gateway or a local model.

| Field | Notes |
|---|---|
| API style | **OpenAI** (`/chat/completions`) or **Anthropic** (`/v1/messages`) |
| BASE_URL | The service address. OpenAI style usually ends in `/v1`, e.g. `https://api.openai.com/v1`; for Anthropic style the host is enough, e.g. `https://api.anthropic.com`. The full request address is shown under the field |
| AUTH_TOKEN | API key or token. Leave empty for a local model that needs none |
| MODEL | The model name, as given by your provider |
| Authentication (Anthropic only) | `x-api-key` for an official API key; `Authorization: Bearer` for a token issued by a gateway |
| Output limit (Anthropic only) | The required `max_tokens` parameter, 4096 by default. Raise it if you are told the reply was cut off |
| Timeout (seconds) | The longest to wait for a reply: 300 by default, 30 to 1800. Models that reason before answering are slow; raise it if you get a timeout |
| Proxy (optional) | e.g. `http://127.0.0.1:7890`; `socks5://` works too. When empty, the proxy in the system environment variables is used; addresses on this machine never go through a proxy |
| Additional requirements (optional) | Appended to the preset style prompt for every generation |

Click **Test connection** to check it works.

Privacy and cost:

- The token is stored in plain text in the app data directory on this computer (`ai.json`) and is never written into profile or project files.
- When generating, your description, the preset prompt and any reference picture you attached are sent to the address you entered; the app makes no other network requests.
- Usage is billed by your provider.

#### Image model (photo repaint)

*Setup → AI* has two panes, *Text model (assets)* and *Image model (photo repaint)*; click one to see its settings. The text model only writes text; repainting a photo needs an image model that takes a picture and returns one. The three services each have their own interface, and the app speaks each one's:

| Service | Default address (used when BASE_URL is empty) | Model name |
|---|---|---|
| OpenAI (gpt-image) | `https://api.openai.com/v1`, request to `/images/edits` | e.g. `gpt-image-2` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta`, request to `models/{model}:generateContent` | usually has `image` in its name; see Google AI Studio |
| Volcengine Ark Seedream | `https://ark.cn-beijing.volces.com/api/v3`, request to `/images/generations`; BytePlus ModelArk: `https://ark.ap-southeast.bytepluses.com/api/v3` | the model ID or endpoint ID from the Ark console |

- Token, model, timeout and proxy mean the same as above; the token is kept in `image-ai.json`.
- *Test connection* makes no picture and costs nothing: OpenAI and Gemini are asked about the model; Seedream is sent an empty prompt to see how it refuses (so only the key is confirmed; the model name is fully confirmed by the first repaint). Success shows in green, failure in red (the text model's test too).
- The output size follows the photo's shape: about 2.5 megapixels on OpenAI's newer models (the older gpt-image-1 has three fixed sizes), about 4 megapixels on Seedream, and Gemini follows the photo sent.
- When repainting, the photo (scaled to 1536 px on its longer side) and the style description are sent to the address you entered.

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

- [ ] AI generation: evaluate results with real models and tune the prompt accordingly; allow follow-up change requests on a result; keep the token in the system keychain.
- [ ] Refine the five new looks one by one; bundle a serif font.
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
| Built-in repaint style "8-bit pixel editorial" | adapted from [TwentyfiveBTea/8bit-pixel-art](https://github.com/TwentyfiveBTea/8bit-pixel-art), AGPL v3 |

In short: you may use, change and redistribute SmedCover, but if you distribute a modified version —
or let people use one over a network — you must make its source available under the same licence.
The built-in artwork may be reused elsewhere with credit; covers you make with SmedCover need no credit.

Copyright © 2026 cybertheye.
