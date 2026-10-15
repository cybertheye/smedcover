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
| **Layer** | Each part of a cover. Built-in layers (background, colour block, title, …) are on every cover; free layers are the stickers, images, photos and text you add. |
| **Project** | The current cover saved to a file together with its profile and the assets it uses, so it can be reopened as it was. |

## The window

Three columns, with two modes at the top: **Edit** and **Setup**.

- **Left** — the tabs of the current mode.
  - Edit: **Cover**, **Style**, **Assets**
  - Setup: **Brand**, **Sizes & export**, **AI**
- **Centre** — the main canvas, and below it a thumbnail of every output size. Click one to show that size on the canvas.
- **Right** (Edit only) — the layer list and the selected layer's properties.
- **Top bar** — profile switcher, open and save project, undo and redo, SURPRISE ME (你看着办 in Chinese), export.

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

### Photos

Every photo is a *Photo* layer. Under *Add photos* in *Edit → Cover*:

- **Upload photos** — several at once if you like. You can also drop photos onto the window; dropped on the canvas, a photo lands where you let go.
- **AI generate** — has an image model make a photo; see [Generating a photo with AI](#generating-a-photo-with-ai).

**A cover's first photo fills the canvas**, as its background, just above the Background layer. The ones after it sit on the cover like prints: move, scale, turn and re-order them, as many as you like, for collage. *Fill the canvas* in a photo's properties switches between the two. A photo filling the canvas is clicked once to select it, then dragged on the cover and scrolled to resize; once selected it drags even when you press on the colour block.

Below *Add photos* every photo on the cover is listed in layer order: a thumbnail, its size, and *AI repainted* on one that was; a cut-out is listed under its photo, its thumbnail without the background. Click a thumbnail to select its layer; the × on its corner (on hover) deletes the photo. Each photo has *AI repaint* and *Another photo*: another photo changes only the picture — placement, blur, dim, outline, name and the rest are kept — and a linked cut-out is cut out of the new picture again, its own settings kept. A cut-out cannot be replaced or repainted by itself (it shows its photo's picture).

Each photo's properties, top to bottom: remove the background, cut out the subject (into a new photo layer), fill the canvas, blur, dim, the look's treatment of photos (tint, duotone, black and white…; on by default), an outline (width and colour) and a shadow, then the opacity and *Reset placement* every layer has. To change the picture, use *Another photo* under it in *Add photos*. With the background removed the outline and shadow follow the subject; otherwise the photo's edge, like a print.

The Background layer itself is only the ground: light or dark, and the grid. It always stays at the bottom. Light or dark is set in the Background layer's properties (not in the Style tab); while a photo fills the canvas it covers the ground, and the lettering is set as on a dark one.

### Cutting out the subject

Select a photo: *Remove the background* and *Cut out subject* are in its *Cut-out* group. Cutting out is done on this computer — photos are not uploaded — in one of two ways, chosen under *Setup → AI → Cut-out*:

| Way | Systems | |
|---|---|---|
| Apple Vision | macOS 14 and later (the default on a Mac) | built in (the same "lift subject" the Photos app has), nothing to download, usually under a second |
| BiRefNet light / full | Windows, Linux, macOS (light is the default elsewhere) | an open model (MIT), downloaded on the same page before its first use: the ONNX Runtime library (Microsoft's own release, MIT, about 10–80 MB, once) and the model (light about 224 MB, full about 973 MB with finer edges). It runs on the CPU: a few to a dozen seconds a photo |

- A download shows its progress and can be cancelled; every file is checked against its SHA-256, and a broken or altered one is not kept. Models come from Hugging Face and the runtime from GitHub, through the proxy given there or else the environment's. *Open the models folder* shows the files; *Delete* (two clicks) removes one.
- With BiRefNet chosen but not downloaded, cutting out says so and offers *Download the model*.
- The subject goes into a new photo layer, *Cut-out subject*: the same picture with its background removed, lined up with the photo and placed just above the title, so it covers part of the title as on a magazine cover. The photo itself stays as it was.
- **Linked**: the cut-out is linked to its photo. The photo leads (active), the cut-out follows (passive); in the layer list both carry a chain and a leading / following mark in the same colour. They move and scale together — drag, scale or turn either and both go — while blur, dim, outline, shadow and opacity are each their own. Move the cut-out up or down in the layer list to decide what it stands in front of.
- Clicking the chain asks whether to end the link; then both are photo layers of their own, where they are. Putting the cut-out's background back ends the link too: it becomes a whole photo again, which can be cut out in turn (and linked anew).
- Deleting the cut-out leaves the photo; deleting the photo deletes its cut-out too. A photo has one linked cut-out: once it has one, the button reads *Cut out again* (to find the subject anew, after changing the way of cutting out, say).
- The cut-out shows its photo's picture: after an AI repaint of the photo is used, or the photo is replaced, it is cut out again by itself.
- *Remove the background* in the properties uses the same recognition: the layer itself keeps only its subject, without a new layer.
- The cut-out is kept with the photo in the session and in project files. A photo with no clear subject says so.

### Generating a photo with AI

*AI generate* under *Add photos* has an image model make a photo. Set one up first under *Setup → AI → Image model* (see [Setting up AI](#setting-up-ai)).

- Describe the photo you want; or *＋ Add a reference picture*, which goes along with the words — the words are then optional.
- It is made in the shape of the size on the canvas. The result is shown first; *Add to the cover* makes it a photo layer (as an upload: a cover's first photo fills it); *Try again* makes another.
- The app adds "no text or watermarks, no border" after the description, unless the description asks for text.
- Each picture is charged at the service's prices and usually takes tens of seconds.

### Repainting a photo with AI

Each photo under *Add photos* has its own *AI repaint*: open it to have an image model paint that photo again in another style. Set up an image model first under *Setup → AI* (see [Setting up AI](#setting-up-ai)).

The style comes from one of three places:

| Source | What it does |
|---|---|
| Follow the current look | Repaints in the cover's look (each look has its own repaint description), with the channel colour as accent; keeps the photo's composition, so the subject stays where and as big as it was and its placement on the cover still fits |
| Built-in styles | Styles that come with the app, one Markdown file each in `ui/repaint-styles/` (how to add one below); once selected, its description and source show below the menu. For now there is *8-bit pixel editorial*, which distils the photo into a sparse, abstract 8-bit pixel piece: a small cluster of coarse pixel blocks on a wide paper field, or a few broad pixel planes edge to edge. Adapted from [TwentyfiveBTea/8bit-pixel-art](https://github.com/TwentyfiveBTea/8bit-pixel-art) |
| My styles | Your own styles: Markdown files of the same kind as the built-in ones, kept in the `repaint-styles/` folder of the app data directory (see below). Rename, edit or delete them in the panel; changes are written back to the file as you type |

- *See the prompt* unfolds a built-in style's prompt; to change one inside the app, edit a copy made with *Copy into my styles*.

#### My styles

The last three entries of the style menu:

- **＋ New style…** — an empty style; fill in its name and prompt below.
- **⤓ Import a style file (.md)…** — a style file someone shared, or a skill's `SKILL.md`. A file that starts with `---` is kept word for word; one that does not gets a header named after the file.
- **Open the styles folder** — shows the folder in Finder (or Explorer). Put files in it or edit them in any editor; the app reads it again when its window comes back to the front.

The files have the same form as the built-in ones (the file name is the id, a header, then the prompt) but are read more leniently: a single `name:` is enough, and a file with no header or with other keys (such as a skill's `description:`) works too; `description` is shown as the style's description.

#### Adding or changing a built-in style (when building from source)

Each built-in style is a Markdown file in `ui/repaint-styles/`. For example, a new `watercolour.md`:

```markdown
---
name.zh: 水彩
name.en: Watercolour
about.zh: 松动的水彩，留白多，颜色取自照片
about.en: Loose watercolour, lots of white paper, colours from the photo
order: 20
credit: optional: where it comes from, and its licence
---

Repaint the attached photograph as a loose watercolour painting …
```

1. **The file name is the style's id**: lower-case letters, digits and hyphens only, e.g. `watercolour.md`. Users' settings remember it, so keep it once chosen; the names can change at any time.
2. **Between the two `---` lines is the header**, one `key: value` per line: `name.zh` and `name.en` are required and are what the menu shows; `about.zh` and `about.en` are optional and shown under the menu; `order` is optional and sets the place in the menu, low first, 100 by default; `credit` is optional and shown as *Source*. A misspelt key stops the build with an error.
3. **After the second `---` comes the prompt**; English works best. Anything in `<!-- -->` comments is not sent. The app adds "no text or watermarks, no border, keep the photo's shape" and the user's extra words after it; to keep the photo's composition, say so in the prompt.
4. **The list is written when building.** `npm run tauri build` / `tauri dev` scan the folder and write `index.json`; `npm run styles` does it by hand. `npm test` checks that the list matches the folder and that every file is well-formed.

- *Anything to add* is optional and goes after any source. Every source is followed by: no text or watermarks, no border, keep the photo's shape.
- The result is shown beside the original first; *Use this* replaces that photo (and its copies, such as the cut-out subject), and *Back to the original* is there afterwards. A new repaint always starts from the original, so repaints do not pile up.
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

The toolbar above the canvas is always one line: the current size (in a slot of its own, so nothing after it moves when you switch sizes), then *Applies to*, and at the right *ⓘ Canvas controls*, how the mouse and keys work. *Applies to* decides where your change lands:

- **All sizes** (default) — placement is stored relative to the canvas, so one adjustment maps to every size.
- **This size only** — fine-tunes just the size on screen.

In *This size only*, the channel graphic's placement is remembered per channel.

### Layers

- The list on the right runs front to back, top to bottom. Drag a row to re-order, or use ▲ ▼.
- The two icons on each row are show/hide and lock. Background and Corner brackets carry a 🔒: they are fixed layers.
- At the end of each row: what the layer is (photo, text "T", colour as a filled square, vector asset as a pen nib, bitmap asset); a linked photo also has a chain and a leading (solid dot) / following (dashed ring) mark, one colour per pair — click the chain to end the link; then whose it is — a gear for a built-in layer (every cover has it; it cannot be deleted), a person for a layer you added.
- Layers you added (photos, text, assets) are renamed by double-clicking their name (a single click selects, as anywhere on the row): Enter or clicking elsewhere keeps it, Esc does not, an empty name goes back to the automatic one.
- **＋ Text** adds a text layer; **＋ Colour** adds a colour layer: one block of colour, the canvas's size to begin with (in the channel colour), to shrink, stretch or turn into a ground, a band or a see-through wash. Clicking an item in Assets adds it. New layers go directly above the selected one.
- Position, size, stretch and rotation are set on the canvas with the mouse (see the table above).
- The properties come in groups: their names on the left (Text, Effect, Colour, Lines, Plate — or Cut-out, Place, Picture, Lines…), the controls on the right; after a rule at the bottom, the Layer group every layer has: opacity, *Reset placement*, channels. Explanations sit behind the ⓘ beside a group's name: hover it, or click it.
- Colours are small swatches: one marked *auto* follows the look and the channel colour; once you pick a colour, a × appears on its corner — click it to go back to automatic.
- The left and right columns are resized by dragging their edge with the canvas (left at least 300 px, right at least 260 px, the canvas keeps 360 px); double-click an edge for the default width. Widths are remembered.
- A vector asset (stickers, frames, channel graphics, AI assets) has *Colour*: its own colours, the channel colour, or a colour of your own.

What each layer allows:

| Layer | Move / resize | Hide | Re-order | Delete |
|---|---|---|---|---|
| Background | no | yes | no | no |
| Corner brackets | no | yes | yes | no |
| Colour block, channel graphic, brand row, title, corner tag, channel name | yes | yes | yes | no |
| Stickers, images, photos, text, colour (free layers) | yes | yes | yes | yes |

### SURPRISE ME: deal a new hand

**SURPRISE ME**, beside *Export* in the top bar, draws at random everything about how the current cover is drawn and laid out:

- the look, its sliders and its random placement
- the template, how much the colour block takes, the slant of its edge, whether the halves are swapped, dark or light ground
- the shape of the colour block, the grid
- the title's text effect, outline and shadow
- each text layer's plate, text effect, outline and shadow; whether a sticker follows the channel colour
- stickers, images and text you added are nudged, turned and resized a little

**Left alone**: the words of the title and tag, the current channel and every channel's colour, the photo layers' pictures, which layers exist (none added, none removed), custom lettering colours, locked layers.

Each deal is one step of undo, however fast you click. Deal again if you do not like it, or undo to the hand before.

### Title and text layers

Add a text layer with **＋ Text** on the right. The title and text layers are the same kind of thing with the same properties; a text layer only adds *Text*, its words (the title's are written in the Cover tab). Top to bottom:

| Property | Decides |
|---|---|
| Text | text layers only. One line is one line; words in `*asterisks*` take the highlight colour |
| Font | see the next section |
| Text effect | how the letters are drawn; see [Text effects](#text-effects) |
| Lettering colour, highlight colour | see [Lettering colours](#lettering-colours) |
| Outline, Shadow | how thick and how far; the one the current text effect does not draw is greyed out. Their colours are automatic: the outline is ink on a dark ground and white on a light one, on a plate the colour that stands against the lettering; in the shadow ordinary words take the highlight colour and highlighted words the lettering colour. A note under the sliders says so |
| Plate | sets the words on a block of colour; then *Plate colour*, the channel colour by default. On a plate, lettering colours left automatic take whichever reads against it |

Text layers of earlier versions are carried over: white becomes automatic, ink and custom colours become the lettering colour, the channel colour still follows the channel; on a plate, the old colour becomes the plate's colour, without an outline or a shadow, as before.

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

With *Tapered*, diamond handles appear at the corners of the lettering on the canvas: drag any of them to set the perspective freely (the whole block is reshaped to the new quad); *Reset the perspective* in the properties goes back to the default. Both the title and text layers have it.

Masked and outlined effects have a *Strength* slider. The *Outline* and *Shadow* sliders of the title and text layers can be moved only when the current effect draws an outline or a shadow: Plain, Plain upright and Underlined highlight have neither, Overprint only the shadow (how far its two colours sit apart); otherwise the slider is greyed out and says why.

Outlined effects read the font file to get each letter's outline: the first time a piece of text is used it shows as ordinary lettering for an instant and then changes; an export waits for the outlines before drawing. Bundled fonts, installed fonts and fonts you imported are supported.

### Lettering colours

Every layer made of words can be given its own colour. Select the layer and look in its properties:

| Layer | Colours you can set |
|---|---|
| Title, text layers | lettering colour, highlight colour (for words in `*asterisks*`), and on a plate the plate colour |
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

- **My assets** — assets made with AI generation and kept. Photos are uploaded under *Cover → Add photos*.
  - *＋ New folder* makes a folder and lets you name it; double-click a folder's name to rename it later. Drag an asset onto a folder to file it, onto *Unfiled* to take it out. ▾ / ▸ closes or opens a folder.
  - Deleting a folder takes two clicks on its ×; its assets are not deleted but go back to Unfiled. Folders are kept on this computer and do not travel with profile exports.
- **Channel graphics** — twenty cel-shaded graphics that follow the channel colour.
- **Stickers** — a free pack of 72; each in its own colours, the channel colour or one of your own. The first group is twelve *Frames*: square, rectangle, circle, triangle, diamond, pentagon, hexagon, octagon, star, parallelogram, trapezoid and semicircle — thin geometric outlines, empty in the middle, to go round a photo, a word or a face, their line drawn the current look's way.
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

*Photo duotone* and *Black-and-white photo* only do something when a photo fills the canvas.

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

Most of the interface detail is painted on the *Corner brackets* layer, so hiding that layer removes it at once; the lock-on ring around the channel graphic travels with the graphic. The colour split and the signal tear are paused while you drag a layer and return when you let go, to keep dragging smooth. Cyberpunk is dark only, so the light-or-dark choice in the Background layer's properties is hidden while it is selected.

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

#### Image model (photo repaint, AI-generated photos)

*Setup → AI* has two panes, *Text model (assets)* and *Image model (photo repaint)*; click one to see its settings. The text model only writes text; repainting and generating photos need an image model that returns pictures (and, for a repaint or a reference picture, takes one). The three services each have their own interface, and the app speaks each one's:

| Service | Default address (used when BASE_URL is empty) | Model name |
|---|---|---|
| OpenAI (gpt-image) | `https://api.openai.com/v1`, request to `/images/edits` with a picture, `/images/generations` from words alone | e.g. `gpt-image-2` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta`, request to `models/{model}:generateContent` | usually has `image` in its name; see Google AI Studio |
| Volcengine Ark Seedream | `https://ark.cn-beijing.volces.com/api/v3`, request to `/images/generations`; BytePlus ModelArk: `https://ark.ap-southeast.bytepluses.com/api/v3` | the model ID or endpoint ID from the Ark console |

- Token, model, timeout and proxy mean the same as above; the token is kept in `image-ai.json`.
- *Test connection* makes no picture and costs nothing: OpenAI and Gemini are asked about the model; Seedream is sent an empty prompt to see how it refuses (so only the key is confirmed; the model name is fully confirmed by the first repaint). Success shows in green, failure in red (the text model's test too).
- The output size follows the shape (a repaint the photo's, a new photo the canvas's): about 2.5 megapixels on OpenAI's newer models (the older gpt-image-1 has three fixed sizes), about 4 megapixels on Seedream; Gemini follows the photo sent when repainting and is asked for the nearest aspect ratio (such as 16:9) when generating.
- When repainting, the photo (scaled to 1536 px on its longer side) and the style description are sent to the address you entered; when generating, the description and any reference picture (also 1536 px at most).

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

Profiles, assets, settings, the current session and your own repaint styles (the `repaint-styles/` folder) are kept in the system's app data directory.
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

`.github/workflows/build.yml` builds installers on GitHub Actions (it has not been run yet): macOS for Apple silicon and for Intel, separately (`.dmg`, `.app.tar.gz`), Windows x64 (`.exe`, `.msi`), Linux x64 (`.deb`, `.rpm`, `.AppImage`).

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
| Built-in repaint style "8-bit pixel editorial" (`ui/repaint-styles/`) | adapted from [TwentyfiveBTea/8bit-pixel-art](https://github.com/TwentyfiveBTea/8bit-pixel-art), AGPL v3 |

In short: you may use, change and redistribute SmedCover, but if you distribute a modified version —
or let people use one over a network — you must make its source available under the same licence.
The built-in artwork may be reused elsewhere with credit; covers you make with SmedCover need no credit.

Copyright © 2026 cybertheye.
