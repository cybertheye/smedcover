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
| **Cover** | Each channel of each profile has one: its title, corner tag and its own stack of layers. Switching channel or profile shows that one; none affects another, and each is saved as you go. |
| **Layer** | Each part of a cover. Layout layers (background, colour block, title, …) come with the layout and are on every cover; free layers are the stickers, images, photos and text you add. |

## The window

Three columns, with two modes at the top: **Edit** and **Setup**.

- **Left** — the tabs of the current mode.
  - Edit: **Cover**, **Style**, **Assets**
  - Setup: **Brand**, **Sizes & export**, **AI**
- **Centre** — the main canvas, and below it a thumbnail of every output size. Click one to show that size on the canvas.
- **Right** (Edit only) — the layer list and the selected layer's properties.
- **Top bar** — profile switcher, undo and redo, clear, SURPRISE ME (你看着办 in Chinese), export. *Clear* asks first, then takes every layer you added off this channel's cover, puts the layout layers back to the default design's places, effects and colours, and the scene objects to theirs; the title, subtitle and tag words and the style stay, and the photos are still in the bitmap assets. It is one step of undo.
- **Dialogs** — a click on the dimmed page outside a dialog cancels it (a press inside dragged out does not). Two stay: the first-run welcome, where a starting point must be chosen, and an export's progress, which only its own *Cancel* stops.

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
- The lines are set as a typesetter would set a Chinese title. Latin letters and digits beside Chinese (`2026`, `AI`, `iPhone`) come from a Latin font whose capitals stand a size smaller than the characters; they are set larger, to look as tall, and centred on them — by how much is measured on the font, so a Chinese font with matching Latin of its own is hardly touched. Chinese punctuation is squeezed as the Kaiming style has it: within a line 。？！ keep their full width and the other marks (，、；：, quotes, brackets) give up their blank side, about half their width (a comma keeps a little after it, so it stays with what it follows); an opening mark at the start of a line and a closing one at its end give up their blank, and of two marks in a row (？！, 。」) the blank between them goes. The lines are shorter, so the title can be set larger. (A title set in columns, as the woodblock look does, is set as before.)
- The **subtitle** is a smaller line under the title, lettered as the title is, typed under *Subtitle* (a new cover comes with a placeholder). It takes a line at the foot of the title's box: the title makes room for it and the two are centred there together, the subtitle about 0.4 of the title's size, and never as large as the title. Where it would set the title smaller than the feeds read well, the subtitle gets smaller first. Empty it, or untick it under *Layout parts*, to leave it out. In the woodblock look, with the title in columns, it is a column of its own left of the title's, a character lower.
- The corner tag is an optional short label such as `EP.03`.
- The title can also be changed in the properties of the *Title* layer, under *Text*: it is the same words; so can the subtitle, in the *Subtitle* layer's.

### Layout parts

*Layout parts* in the Cover tab lists what the layout brings, a row each, from the top down in the order they are stacked: the corner brackets, the title, the subtitle, the brand logo, the brand row, the corner tag, the channel name, the channel graphic, the colour block and its edge. Untick a row and that part is left out of this cover, and no longer listed with the layers (*Hide layout* leaves it alone too); tick it again and it is back, its place, colours and effects as they were. It is this channel's cover only, it stays through *Clear*, and it can be undone. A new cover leaves out the channel name and the channel graphic; tick them to bring them in (covers made before that and never touched, and the profile's default design, left them out once). The background is always there, at the bottom, so it is not listed.

Drag a row onto another to stack that part there: the layer list shows the new order at once, and it becomes the profile's default order too, which new channels' covers and *Clear* take from then on (the covers the other channels already have keep theirs). The layers you added go with the layout layer each lies directly above. It can be undone.

### Photos

Every photo is a *Photo* layer. Under *Add photos* in *Edit → Cover*:

- **Upload photos** — several at once if you like. You can also drop photos onto the window; dropped on the canvas, a photo lands where you let go.
- **AI generate** — has an image model make a photo; see [Generating a photo with AI](#generating-a-photo-with-ai).
- **From assets** — choose one from Bitmaps. Every photo you uploaded, had made or repainted stays under *Assets → Bitmaps*, where you can also click one or drag it onto the canvas. See [Assets](#assets).

**A cover's first photo fills the canvas**, as its background, just above the Background layer. The ones after it sit on the cover like prints: move, scale, turn and re-order them, as many as you like, for collage. *Fill the canvas* in a photo's properties switches between the two. A photo filling the canvas is clicked once to select it, then dragged on the cover and scrolled to resize; once selected it drags even when you press on the colour block. Scaled down until it no longer covers the canvas, it shows its frame again, with the four corner handles to resize it (it is never turned or stretched).

Below *Add photos* every photo on the cover is listed in layer order: a thumbnail, its size, and *AI repainted* on one that was; a cut-out is listed under its photo, its thumbnail without the background. Click a thumbnail to select its layer; the × on its corner (on hover) deletes the photo. Each photo has *AI repaint* and *Another photo*: another photo changes only the picture — placement, blur, dim, outline, name and the rest are kept — and a linked cut-out is cut out of the new picture again, its own settings kept. A cut-out cannot be replaced or repainted by itself (it shows its photo's picture).

Each photo's properties, top to bottom: remove the background, cut out the subject (into a new photo layer), fill the canvas, blur, dim, the look's treatment of photos (tint, duotone, black and white…; on by default), the outline's width, a shadow, the outline's colour, its style (*Solid*, *Torn paper*, *Dashed*) and the look effects (see *Look effects on your own layers*), then the opacity and *Reset placement* every layer has. To change the picture, use *Another photo* under it in *Add photos*. With the background removed the outline and shadow follow the subject; otherwise the photo's edge, like a print. With *Torn paper* the outline becomes a margin of paper torn by hand: a ragged edge (slow bites, smaller jags, loose fibres), a band of the paper's white core along it (plainest on coloured paper), and a soft shadow under it; the wider the outline, the more the tear wanders, but it never reaches into the photo. Each photo tears its own way and keeps it. With *Dashed* it becomes a line of evenly spaced dashes a little way out from the edge, like the line a sticker is cut along: the outer edge of the dashes where a solid outline's would be, the wider the outline the bolder and longer the dashes, each closed line round a whole number of them. Choosing either with no outline yet gives one of 16.

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
- **Linked**: the cut-out is linked to its photo. The photo leads (active), the cut-out follows (passive); in the layer list both carry a chain and a leading / following mark in the same colour. Only their place is shared: drag either and both move; size, angle and stretch, and blur, dim, outline, shadow and opacity, are each their own. The cut-out scales and turns about its subject, so the subject stays put; *Line up with the photo again*, in its Place group, puts it back exactly over its photo. Move the cut-out up or down in the layer list to decide what it stands in front of.
- **Soft edges**: a layer with its background removed, or a cut-out, has two sliders in its *Cut-out* group: *Soften in* fades the subject's edge inward (none of the background comes back); *Soften out* spreads the subject's own colours softly outward, like a glow. They can be used together.
- Clicking the chain asks whether to end the link; then both are photo layers of their own, where they are. Putting the cut-out's background back ends the link too: it becomes a whole photo again, which can be cut out in turn (and linked anew).
- Deleting the cut-out leaves the photo; deleting the photo deletes its cut-out too. A photo has one linked cut-out: once it has one, the button reads *Cut out again* (to find the subject anew, after changing the way of cutting out, say).
- The cut-out shows its photo's picture: after an AI repaint of the photo is used, or the photo is replaced, it is cut out again by itself.
- *Remove the background* in the properties uses the same recognition: the layer itself keeps only its subject, without a new layer.
- The cut-out is kept with the photo in the cover, and travels with a whole-profile export. A photo with no clear subject says so.

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
- While it runs you can close *AI repaint* and carry on; its button says *Repainting…*. When it is done you are told, the button reads *AI repaint · result ready*, and opening it shows the result, which stays until the next repaint.
- The result is shown first, as a preview; *Use this* replaces that photo (and its copies, such as the cut-out subject), and *Back to the original* is there afterwards. A new repaint always starts from the original, so repaints do not pile up.
- Both the repainted photo and the original are kept on this computer (both are in Bitmaps), and travel with a whole-profile export.
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

Every layer except Background and Corner brackets can be moved, resized, stretched and rotated.

### One collage, every size

The toolbar above the canvas is always one line: the current size (in a slot of its own, so nothing after it moves when you switch sizes), then *Applies to*, and at the right *ⓘ Canvas controls*, how the mouse and keys work. *Applies to* decides where your change lands:

- **All sizes** (default) — placement is stored relative to the canvas, so one adjustment maps to every size.
- **This size only** — fine-tunes just the size on screen.

In *This size only*, the channel graphic's placement is remembered per channel.

### Layers

- The list on the right runs front to back, top to bottom. Drag a row to re-order, or use ▲ ▼. The layout layers stand by default, from the top: corner brackets, title, subtitle, brand logo, brand row, tag, channel name, channel graphic, colour block, background (*Layout parts* in the Cover tab changes this default order). An earlier profile or cover still in the old default order (never re-ordered by hand) is put into this one when opened, once; the layers you added go with the layout layer each lay directly above, so what was in front stays in front; one re-ordered by hand is left as it is.
- The two icons on each row are show/hide and lock. Background and Corner brackets carry a 🔒: they are fixed layers.
- At the end of each row: what the layer is (photo, text "T", colour as a filled square, vector asset as a pen nib, bitmap asset); a linked photo has a chain and a leading (solid dot) / following (dashed ring) mark before its photo icon, one colour per pair — click the chain to end the link, the leading / following mark to go to the other layer of the pair; then whose it is — the layout icon (a page in panels) for a layout layer (it comes with the layout and every cover has it; it cannot be deleted, but can be hidden), a person for a layer you added.
- Layers you added (photos, text, assets) are renamed by double-clicking their name (a single click selects, as anywhere on the row): Enter or clicking elsewhere keeps it, Esc does not, an empty name goes back to the automatic one.
- **Clipping masks**: a layer you added (photo, text, asset, colour) can be clipped to the layer below it — *Clip to the layer below* in the *Layer* group of its properties — and then shows only within that layer's shape: a photo inside the title's or a text layer's letters, a colour laid over a silhouette. See *Clipping masks* below.
- **Scene objects**: with *Background* selected, the things a look paints in the background (the ball, the giant letters, the sun, the centre of the radiating lines…) show round handles to drag them by. See *Scene objects* below.
- **＋ Text** adds a text layer; **＋ Colour** adds a colour layer: one block of colour, the canvas's size to begin with (in the channel colour), to shrink, stretch or turn into a ground, a band or a see-through wash. Clicking an item in Assets adds it. New layers go directly above the selected one.
- Position, size, stretch and rotation are set on the canvas with the mouse (see the table above).
- **3D** — the first button at the top of the layer list (Esc to leave). It takes the cover apart where the canvas was: each layer becomes a sheet of its own, stacked from the bottom up and seen at an angle, each with its name beside it, so you can see what every layer holds and which lies over which. Drag to turn the view; scroll, or use *Spread*, to pull the sheets apart or together; *Reset view* puts the angle back. Click a sheet to select its layer (its settings show on the right as ever; the transparent parts of a sheet let the click through to the ones below), double-click to select it and go back to the flat canvas. Pointing at a row of the list lights its sheet and dims the rest; a hidden layer is a faint sheet with a dashed edge. It is only for looking: settings changed on the right show at once, and a layer moved in the list slides to its new place, but moving or resizing on the canvas waits until you leave 3D.
- **Hide layout** — the button left of FOCUS at the top of the layer list. It hides all the layout layers at once (background, colour block, title, subtitle, tag, channel name, brand row, brand logo, channel graphic, frame), leaving the photos, text, assets and colour layers you added; it then reads *Show layout*, which brings back the ones that were showing (one you had hidden before stays hidden). It acts on this channel's cover and can be undone.
- **FOCUS** — the switch at the top right of the layer list (shortcut F, Esc to leave). While on, every other layer is dimmed on the canvas and greyed in the list, and none of them can be selected, on the canvas or in the list (a click says why); dragging and scrolling on the canvas (Option to turn) act on the selected layer whatever is under the pointer, and nothing else is moved. To work on another layer, turn FOCUS off first. The canvas gets a dashed frame and a tag naming the layer; a layer that cannot be moved (a fixed built-in or a locked one) is tagged so. With several layers selected, a drag moves them together.
- The properties come in groups: their names on the left (Text, Effect, Colour, Lines, Plate — or Cut-out, Place, Picture, Lines…), the controls on the right; after a rule at the bottom, the Layer group every layer has: opacity and *Reset placement* (a cut-out has none; its *Line up with the photo again* is in its Place group). Explanations sit behind the ⓘ beside a group's name: hover it, or click it.
- Colours take a row each, as checkboxes do: the swatch, its name, then *Automatic* (following the look and the channel colour); once you pick a colour it reads *Back to automatic* — click it to return.
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

**SURPRISE ME**, beside *Export* in the top bar, draws at random everything about how the current cover is drawn, the layout left as it is:

- the look, its sliders and its random placement; now and then the look's scene objects a little off where the layout puts them
- dark or light ground, the shape of the colour block, the grid
- the title's text effect, outline and shadow
- each text layer's plate, text effect, outline and shadow; whether a sticker follows the channel colour
- the look effects of the layers you added (text, stickers, images, photos, colours): one or two, mostly the drawn look's, now and then another look's
- the layers you added get a new place, angle and size: anywhere on the canvas, but wholly on it at every size, not a pixel off; one too big to fit is set straighter, then smaller

**Left alone**: the template, how much the colour block takes, the slant of its edge, whether the halves are swapped, and where the layout layers stand (title, colour block, channel graphic, tag, channel name, brand row, corner brackets); the words of the title, subtitle and tag, the current channel and every channel's colour, the photo layers' pictures, which layers exist (none added, none removed), custom lettering colours, locked layers, a photo or a colour filling the canvas.

Each deal is one step of undo, however fast you click. Deal again if you do not like it, or undo to the hand before.

### Title and text layers

Add a text layer with **＋ Text** on the right. The title, the subtitle and text layers are the same kind of thing with the same properties, look effects included (and clipping masks, but for the subtitle); the title's *Text* is the title in the Cover tab, the subtitle's the subtitle, so either can be changed. The title and subtitle are still layout layers: it cannot be deleted or duplicated, and its default place follows the layout. Top to bottom:

| Property | Decides |
|---|---|
| Text | One line is one line; words in `*asterisks*` take the highlight colour. The title's and subtitle's text are the ones in the Cover tab |
| Font | see the next section |
| Text effect | how the letters are drawn; see [Text effects](#text-effects) |
| Lettering colour, highlight colour | see [Lettering colours](#lettering-colours) |
| Outline, Shadow | how thick and how far; the one the current text effect does not draw is greyed out. Their colours are automatic: the outline is ink on a dark ground and white on a light one, on a plate the colour that stands against the lettering; in the shadow ordinary words take the highlight colour and highlighted words the lettering colour. A note under the sliders says so |
| Plate | *On a plate* sets the words on a block of colour; then *Plate colour*, the channel colour by default. The plates are drawn in the look's way. On a plate, lettering colours left automatic take whichever reads against it |
| Highlight style | how the words marked with `*asterisks*` are marked besides their colour: *Colour only*; *Plates*, a plate under each of them (the words then in what reads on it); *Ring drawn round*, a quick loop round them as with a pen, a little wobbly, its ends passing each other; *Marker*, a highlighter's band through their lower half, slightly slanted, its edges uneven, its end cut on a slant; *Offset block*, a block of colour set off down and to the right behind them. Under a band or a block the words keep the lettering's colour, since they are partly on the ground. Then *Highlight style's colour*, the channel colour by default (ink or white when the whole plate is that colour already). Any of them goes with *On a plate*, any effect and any bend |

Text layers of earlier versions are carried over: white becomes automatic, ink and custom colours become the lettering colour, the channel colour still follows the channel; on a plate, the old colour becomes the plate's colour, without an outline or a shadow, as before.

### Fonts

Every layer that carries words (title, subtitle, corner tag, channel name, brand row, text layers) chooses its own font. Select the layer and look under *Font* in its properties:

- **Default** — the bundled face, following the current look (a serif under Woodblock book, say). New layers start here.
- **Recent** — the fonts used last, to reuse on other layers.
- **Built-in** — Noto Sans SC, Bebas Neue, JetBrains Mono; the same on every platform.
- **Imported** and **System fonts**.
- The last entry, **＋ Add a font file…** — pick a font file: it is stored in the app and used on this layer at once, and from then on every layer finds it under *Imported*.

A font marked *no Chinese* has no Chinese glyphs: choosing it changes Latin letters and digits only, and Chinese stays in the default face. To change the Chinese, pick a font without the mark (PingFang, Songti, Kaiti…). Imported fonts are not checked.

Imported fonts live in this computer's app data. Exporting a profile packs the imported fonts it uses into the file, and importing it elsewhere installs them; a font that did not come along shows as "not on this computer" and the default is used.

### Text effects

The title, the subtitle and every text layer (with or without a plate) can be given a text effect of their own instead of following the look. Select the layer and choose under *Text effect* in its properties:

| Kind | Effects | Notes |
|---|---|---|
| Automatic | follows the look | The default: the current look's own lettering |
| Layered | sticker, outline and shadow, plain, plain upright, underlined highlight, extruded | General letterings. Sticker: the letters run together on a thick white rim with a dark line round it and a hard shadow under it, as on variety shows' captions (the *Outline* slider sets the keyline round the letters, *Shadow* the shadow). The underlined highlight underlines the highlighted words; extruded gives the letters real depth, from each letter's outline |
| Masked | halftone inside, stripes inside, inner shadow, worn, row shift | Change what is inside the letters |

Under it, **Bend** bends the lettering, whichever it is — the look's own (Automatic), any effect above, plates and marks under highlighted words, the look effects of the next section laid over it: arched, arc down, on a circle, arched top, bulge, pinch, fisheye, rise, tapered, wave, flag, with *How far*. The line is painted as it would be and that picture is bent, so a dark deco title stays lit lamps and a chrome one chrome, arched; and it works in a plain browser too. The size follows the bent shape, so a bent title stays inside its box, clear of the brand row and the subtitle. Covers made before, whose title or text had one of these as its effect, open as *Outline and shadow*, bent the same way.

With *Tapered*, diamond handles appear at the corners of the lettering on the canvas: drag any of them to set the perspective freely (the whole block is reshaped to the new quad); *Reset the perspective* in the properties goes back to the default. The title, subtitle and text layers all have it; with corners of its own a tapered title is the size it was, for you to place.

Every other bend can be reshaped by hand the same way: four diamond handles lie along the top of the lettering and four along its bottom, where the bend puts them. Drag one and the edge under it follows the pointer, the rest of the lettering smoothly with it (several lines move as one block); *How far* still applies, and *Reset the shape* goes back to the bend as it was. The size stays what the bend alone gives, and the plate and the selection take in where the handles went.

The bends, line by line: *Arched* lifts the middle of the line and *Arc down* lowers it; *On a circle* lays the line round a circle below it, the letters fanning out; *Arched top* keeps the baseline straight while the tops arch up toward the middle; *Bulge* makes the letters taller toward the middle and *Pinch* shorter; *Fisheye* enlarges the middle as a lens would, easing off toward the ends, which stay about where they were; *Rise* climbs to the right with the upright strokes kept upright; *Wave* runs a wave along the line and *Flag* waves it like a flag on a pole at its start, more the further from the pole. *How far* sets how far each goes.

Sliced, Overprint, Double keyline and Sunlit block were here once; they are their looks' post effects now (Three slices, Second-ink overprint, Two-tone outline, Sunlit block), under *Look effects* (next section), and go with any text effect. A text layer that chose one of them here before is given the matching post effect when opened; a title's earlier choice is painted as *Automatic*, and kept.

Masked effects and Extruded have a *Strength* slider. The *Outline* and *Shadow* sliders of the title and text layers can be moved only when the current effect draws an outline or a shadow: Plain, Plain upright and some looks' letterings have neither; otherwise the slider is greyed out and says why.

Extruded reads the font file to get each letter's outline: the first time a piece of text is used it shows as ordinary lettering for an instant and then changes; an export waits for the outlines before drawing. Bundled fonts, installed fonts and fonts you imported are supported.

### Look effects on your own layers

A look's material effects can be put on a layer you added — text, asset, photo or solid — and on the title, which takes the same effects as text. With the layer selected, its properties have a *Look effects* group in two parts:

- **This look**: the effects the current look opens to that kind of layer. Each is a slider; at 0 it is off. Some have settings of their own: the riso's *Halftone*, once on, shows *Halftone size* under it.
- **Borrow from other looks**: *Borrow from other looks…* opens a window showing each look with the effects it has, each in a dashed box; click the looks to borrow from (several at once) and confirm, and their names and sliders are put in below. Looks already borrowed come ticked; unticking one takes its effects off this layer. *Remove* after a look's name takes away every effect borrowed from it. Effects on the layer that are not the current look's are listed here too, under their own look.

*Clear* after a look's name sets that look's effects back to 0 and keeps the group; a borrowed look also has *Remove*, which takes the group away. At the foot, *Clear all look effects* sets every effect back to 0 and keeps the borrowed looks; *Remove all look effects* removes every borrowed look and sets this look's effects back to 0. With nothing to clear, the buttons are greyed out.

The effects stay with the layer: under another look they still apply, and move to *Borrow from other looks*. Each layer's random detail is its own, so every size, the preview and the export agree. *Surprise me* deals these layers new effects, but only ever from the look it drew, so a hand stays of one look.

All 33 looks have effects. Those marked [photo] are offered on photo layers only; the rest suit text, asset, photo and solid layers alike. Look effects all work on a layer once it is painted, so on a text layer they go with any text effect. An effect that repaints the shape, such as a silhouette or chrome, follows the subject on a photo whose background was removed, and takes a plain photo as one block.

| Look | Effects |
|---|---|
| Cel | screentone shade |
| Cyberpunk | colour split, signal tear, line glow, photo tint [photo], three slices (cut in three bands, slipped apart with hairlines between, a red and cyan echo behind) |
| Riso | misregistration, halftone (with its size), patchy ink, roller streaks, ghosting, second-ink overprint (a pink second impression off to the lower right) |
| 90s animation | photo warmed [photo], two-tone outline (an ink line at the edge, a cream one outside, a soft shadow) |
| Record sleeve | photo duotone [photo], photo halftone [photo] |
| Editorial | black-and-white photo [photo], photo in spot colour [photo] |
| Woodblock book | uneven printing, seal-red ink |
| Summer illustration | photo vividness [photo], sunlit block (navy depth and outline, the lower part warmer) |
| Negative space | red-and-black silhouette, screen-print texture, photo in red and black [photo] |
| Minimal film poster | silhouette, back light, photo toning [photo] |
| Cyanotype | glowing white figure, airbrush haze, coarse halftone, photo as cyanotype [photo] |
| Monochrome film | motion ghost, black-and-white photo [photo], photo motion blur [photo], photo collage [photo] |
| Experimental type | slice, echo, particle scatter, dry brush, hard black and white [photo] |
| Animated film poster | silhouette, sunburst, screen-print wear, photo in one colour [photo] |
| Avant-garde image | motion smear, glow, out of focus with a frame of focus, pixel mosaic, fluted glass, colour band, fade out, black-and-white photo [photo] |
| Collage | paper lift, tape, halftone patch, black-and-white photo [photo], photo torn in strips [photo] |
| Yellow poster | black silhouette, black-and-white photo [photo] |
| Pitch | halftone, photo posterized [photo] |
| Dot matrix | read into dots (with their spacing), rainbow, motion smear, colour split, glow |
| Neon pop | neon gradient map, hard tones, rim light, back light, halftone shadow |
| Basketball poster | varsity outline, halftone knock-out, spray drips, speed trails, screen-print wear, photo in two colours [photo] |
| Velvet illustration | velvet, check, volume, fuzzy edge, soft shadow, photo in velvet colours [photo] |
| Psychedelic rave | holographic sheen, eclipse halo, colour fringe, photo in neon heat [photo] |
| Liquid chrome | chrome, holographic streak, drips, glitch slices, black-and-white photo [photo] |
| Glitch net art | dither, pixel sorting, datamosh, scan shift, selected (turned white on a navy box, with a colour fringe) |
| Comic-verse | comic colouring, halftone, hatching, off-register, dimension glitch, photo as comic [photo] |
| Patterned glass | patterned glass (with pattern size, glints and dark lines), brush strokes, frost |
| Jelly machine | jelly, glow, depth of field, photo teal and orange [photo] |
| Anime skies | photo clarity [photo] |
| Spectral engraving | stipple (with its depth), line engraving, spectral streams, drips |
| City pop night | cel tones (lightness in four flat steps, the shadows sunk toward a night teal), neon glow, videotape (the red smeared right and the blue left, a band slid sideways, scanlines) |
| Constructivist | built of blocks (with the block size: rectangles of grey, ink, paper and red, joined from the layer's own tones), grey plates, diagonal wedge |
| Dark deco | gilded (polished gold with a dark band across it, as metal reflects a horizon), silhouette with rim light (black, a rim of the channel colour and one of moonlight), gold sunburst (rays fanning out from behind the layer), night grade [photo] (the ultramarine night, warm colours kept as crimson and gold) |

### Clipping masks

A layer you added (photo, text, asset, colour), and the title, can be clipped to the layer below it: select it and tick *Clip to the layer below* in the *Layer* group of its properties. It then shows only within the shape that layer paints, and is as see-through as it is:

- put a photo above the title or a text layer and tick it, and the photo is inside the letters;
- put a block of colour above a silhouette asset and tick it, and the silhouette takes the colour; move the colour to tint part of it only.

Several layers in a row can be clipped to the same layer, and show within it together. The layer below is their *base*: hiding it hides what is clipped to it, and dragging the base or a layer clipped to it repaints the group as one. With only the background below, the tick changes nothing (the background covers the canvas). In the layer list a clipped layer is indented, with "↓" before its name, and hovering it says what it is clipped to.

### Scene objects

Some of the things a look paints in the background can be dragged where you want them: select the *Background* layer, and handles show on them (white rings edged in black, to read on any ground). Drag a handle to move its object; double-click it to put the object back. While dragged, only the ground is repainted, in draft; the full picture follows when you let go.

- Positions are kept on this cover, per look: change the look and back, and they are where you left them; other covers are not touched.
- What is kept is an offset from where the layout puts the object (in proportion to the canvas), so it follows when the template or the size changes. As with layers, whether all sizes or this one change follows the scope at the top.
- The background's properties have a *Scene objects* group listing the current look's draggable objects, each with *Reset*, and *Reset them all* at the foot. Click an object's name and the pointer jumps to its handle, which rings once; *Hide the handles* takes them off the canvas (and dragging with them), and is remembered.
- Things that hang on another object go with it: the negative-space poster's beam and threads with its giant silhouette, the patterned glass's figure with its window, the spectral engraving's vortex and lines with its figure; they can still be dragged on their own too.
- Some move one way only: the cyberpunk sweep up and down, the negative-space spotlight from side to side.
- An object has a handle only when it is painted: one whose slider is at 0 shows none. Cel and Cyanotype have no draggable objects.

Each look's draggable objects:

| Look | Objects |
|---|---|
| Cyberpunk | sweep line |
| Riso | overprinted shapes |
| 90s animation | clouds, light rays, light leak, lens flare |
| Record sleeve | the record |
| Editorial | issue numeral, quotation mark |
| Woodblock book | three collectors' seals (white square, red square, round) |
| Summer illustration | cumulus, towers |
| Negative space | giant silhouette, spotlight beam |
| Minimal film poster | silhouette |
| Monochrome film | haze |
| Experimental type | giant letters, centre of the radiating lines |
| Animated film poster | sun and sunburst, giant silhouette, street-lamp beam |
| Avant-garde image | figure |
| Collage | colour disc, starburst, marker scribble |
| Yellow poster | giant letters, beam |
| Pitch | ball |
| Dot matrix | dot figure |
| Neon pop | figure |
| Basketball poster | jersey number, ball, half court, hoop |
| Velvet illustration | plush figure |
| Psychedelic rave | holographic figure, liquid chrome |
| Liquid chrome | chrome figure, wireframe |
| Glitch net art | dithered figure, dialog windows, colour bars, cursors |
| Comic-verse | comic figure, centre of the focus lines, caption box, sound effect |
| Patterned glass | window and its light, figure at the window, flowers |
| Jelly machine | jelly figure, segment display |
| Anime skies | sunlight, cumulonimbus, contrails, pole and wires, leaves |
| Spectral engraving | stippled figure, vortex, vanishing point of the lines |
| City pop night | cel figure, neon sign, palms, night clouds |
| Constructivist | machine, disc, centre of the rays, steel truss |
| Dark deco | the great tower, moon, searchlights, airship, blade sign, silhouette |

### Lettering colours

Every layer made of words can be given its own colour. Select the layer and look in its properties:

| Layer | Colours you can set |
|---|---|
| Title, subtitle, text layers | lettering colour, highlight colour (for words in `*asterisks*`), and on a plate the plate colour |
| Corner tag, channel name, brand row | lettering colour |

Without one a layer shows *Automatic*: the colour comes from the current look and the channel colour, and follows when either changes. Once set, the colour stays as it is; *Back to automatic* clears it.
The plates themselves (behind the tag, behind the channel's sub-name) are not included: they still follow the channel colour.

### Profiles and channels are independent

Each channel of each profile has a cover of its own: its title, tag, photos, text and every layer belong to it alone. What you change on channel A never shows up on channel B, and what you change in profile A never shows up in profile B.

- Click a channel under *Cover* to show that channel's cover. A channel opened for the first time starts a new cover: the profile's default design and a default title.
- Switch to another profile and back, and you are on the channel you left, its cover as it was.
- Covers are saved as you go; there is nothing to save by hand. Undo starts afresh when you switch channel or profile.
- What a profile's channels share is the profile itself: its look, output sizes, brand and default design.
- Assets, vector and bitmap, are shared by every profile; see [Assets](#assets) below.
- **Copy from another channel** — the button under the channels in *Cover*. Pick a profile and a channel (the whole cover is shown below, at the size on the canvas), and everything but the layout layers on that cover (photos, text, assets, colour layers, cut-outs and their links included) is copied into this cover with its settings. Each item goes above the layout layer it was above there, so what is in front of what stays as it was; what this cover has stays, and the copy can be undone.

Earlier versions kept one cover, whose layers could be kept to some channels. The first start after updating splits that cover among the current profile's channels: each layer goes to the channels it was on, and the title and tag are copied to every channel; the old file is kept as `session.migrated.json`. Photos uploaded before all appear under *Assets → Bitmaps*.

### Assets

A switch at the top of the Assets tab, | Vector assets | Bitmaps | (the chosen one in white between bars in the channel colour), picks one of two panes: **Vector assets** and **Bitmaps**. Both are shared by every profile and every channel. Vector assets are shown in the current look and the channel colour, and once on the canvas they follow the channel colour by default too (the layer's properties can give one its own colours or one of yours).

**Vector assets**

- **My vector assets** — assets made with *Generate vector assets with AI* and kept, whichever profile and channel they were made on.
  - *＋ New folder* makes a folder and lets you name it; double-click a folder's name to rename it later. Drag an asset onto a folder to file it, onto *Unfiled* to take it out. ▾ / ▸ closes or opens a folder.
  - Deleting a folder takes two clicks on its ×; its assets are not deleted but go back to Unfiled. Folders are kept on this computer and do not travel with profile exports.
- **Channel graphics** — twenty cel-shaded graphics that follow the channel colour.
- **Stickers** — a free pack of 72, in the channel colour by default, or in their own colours or one of yours. The first group is twelve *Frames*: square, rectangle, circle, triangle, rounded rectangle, pentagon, hexagon, octagon, star, parallelogram, trapezoid and semicircle — thin geometric outlines, empty in the middle, to go round a photo, a word or a face, their line drawn the current look's way.
- **Colour block & edge** — twelve shapes; click one to reshape the colour block layer.

**Bitmaps**

At the top, in *Add bitmaps*, are *Upload photos* and *AI generate*: photos uploaded here are only kept in Bitmaps, not put on the cover (several at once if you like); AI generate works as in *Cover → Add photos* — the picture is kept here when made, and goes on the cover only with *Add to the cover*. Every photo you upload, every picture AI makes and every AI repaint is kept here by itself, its source marked on the thumbnail (Upload / AI made / AI repaint); importing a whole profile adds the photos in it too.

- Click one to add it to the current cover as a photo layer; drag it onto the canvas to put it where you let go. Added, it is listed under *Cover → Add photos* like any other photo.
- The × on a thumbnail's corner (on hover) takes it out of Bitmaps; covers already using it keep it.
- An AI repaint never changes the photo it started from: the result is a new picture, and the original stays in Bitmaps.

### Generating assets with AI

At the top of the Assets tab, pick a kind, type what you need ("a washing machine", "a trophy", "a ginger cat") and click **Generate**.

| Kind | Result | Best for |
|---|---|---|
| **3D object** (default) | An object built from boxes and cylinders, drawn like the built-in channel graphics: three tones, screentone, ink lines, a ground shadow | devices, machines, vehicles, buildings |
| **Flat sticker** | Flat colour with a heavy outline, drawn like the built-in stickers | animals, characters, food, symbols |

- The result is previewed twice: in its own colour, and following the current channel colour. If you like it, **Save to My vector assets** and use it like any other asset.
- **Reference picture** — below the text box you can attach a picture. The model first finds its main subject (ignoring the background, the table, the hand holding it, captions and watermarks), then draws that subject in the current look, solid or flat as chosen above. The text box can stay empty; write a word only to pick one thing out of several ("just the cup"). The picture is scaled down to 768 px on its longer side before it is sent. This needs a model that accepts image input; one that does not answers with an error, and the app says why.
- A generated asset is the same kind of thing as a built-in one: sharp at any size and usable as a channel's graphic.
- Once on the canvas it **follows the channel colour by default**, changing when the channel's colour is changed; untick *Use the channel colour* in the layer's properties to keep its own colour.
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
| **Risograph** | cream paper, two or three spot inks, coarse halftone, misregistration, paper grain; big overprinted shapes if you like, and the machine's own marks: patchy ink, roller streaks, ghosting; objects are paper white and blue ink |
| **90s animation** | a painted sky (as cloudy as you like, or turned to dusk) with beams of light through it, cel colours a little grey and warm, a title with a double keyline; then a hand-drawn lens flare, a light leak, film grain, bloom, fade, dust and scratches and a vignette |
| **Record sleeve** | large flat blocks of colour, tight sans-serif headlines with no outline or shadow, photos in one colour and black through a coarse screen; the record (its label in the channel colour) can slide out of the sleeve; a sleeve's years: ring wear, worn edges, sun fade; flat layouts of its own; dark or light ground |
| **Editorial** | a serif headline, thick-and-thin rules, a hairline border, a folio, a huge quiet issue number, a large quotation mark in the channel colour and two columns of body text (set to the right of the title and above the channel graphic), a gutter shadow; photos in black and white or in the channel colour as a spot ink; flat layouts of its own; dark or light ground |
| **Woodblock book** | a leaf from an old Chinese book: paper ground, a serif title set in vertical columns, the corner tag as a vermilion seal, a thick-and-thin border, ruled columns, a centre column with fishtails at the right edge; the columns can hold the page's text — large characters and commentary in double small lines (clear of the title and the channel graphic) — with vermilion circles and side comments, and collectors' seals; the years: uneven printing, water stains, wormholes, foxing; objects like woodcuts; flat layouts of its own |
| **Summer illustration** | a summer's day as a saturated animated illustration: one strong azure sky; huge billowing cumulus in three hard-edged planes (white, pale blue, periwinkle) outlined in fine indigo; coral-red towers with brass pipes and a skyline of signboards and lanterns standing on the colour block's edge (which becomes the ground in front); strings of pennants. The title is white over warm yellow with an indigo keyline and a solid block shadow; the corner tag is a cream pill; a cream postcard border is optional; photos are made more vivid and warmer |
| **Negative space** | the red-and-black poster of Saul Bass and the Polish school: red, black and off-white; the channel graphic made into a huge silhouette in a deeper shade of the ground, cropped by the edge; a reversed split sweeping in from the side, in which the silhouette turns sharp and negative; a spotlight beam and taut threads if wanted; highlighted words reversed out of a bar; a few lines of credits, the roughness of a screen print. Red or black ground, and the channel colour can stand in for the red; flat layouts of its own |
| **Minimal film poster** | the minimal movie poster: a quiet colour drawn from the channel's; the channel graphic as a dark silhouette standing in it, a soft light behind, ridges fading back in layers; crumpled paper, fade, vignette and grain; a serif title (a soft shadow on the dark ground, a halo of light on the light one); a credits block; with a photo filling the canvas, the photo can go inside the silhouette as a double exposure; flat layouts of its own |
| **Cyanotype** | the cyanotype and the blue-printed zine: Prussian blue brushed on unevenly, the channel graphic left as a glowing white photogram, airbrushed haze, a coarse halftone, sparkles, hairline frames and small numbers; a serif title with a blue glow; the channel colour as a second ink (highlighted words, the tag's square). Deep blue or off-white paper; flat layouts of its own |
| **Monochrome film** | a magazine made of black-and-white stills: haze and out-of-focus lights, the channel graphic as a grey figure trailing a motion blur, photos smeared by motion and cut into fragments set back off true (one in the channel colour), folds, dust, columns of small print; a serif title with a soft out-of-focus glow; the channel colour the only colour (highlighted words, the tag). Black or pale paper; flat layouts of its own |
| **Experimental type** | the Swiss and experimental typographic poster, the type itself the picture: the title cut along slants and knocked out of line, echoed in fading layers above, dissolving into dots at the end of each line; a burst of hairlines, dry-brush strokes, giant letters cut across, a hairline grid with small markers; one colour only, the channel's, on the block. Black on white or white on black; flat layouts of its own |
| **Animated film poster** | the alternative poster for an animated film: one strong colour (on the bright ground the channel colour made more vivid, on the deep one a night blue); a big striped setting sun over where the channel graphic stands, a sunburst and stars behind; if you like, its huge silhouette in front of the sun, a lamp's beam, a procession of the same figure growing smaller, a winding road with a tiny traveller; bold condensed capitals with a shadow a little off; screen-print wear, a white margin and credits; flat layouts of its own |
| **Avant-garde image** | today's design-studio and fashion poster: a black-and-white photo (without one, the channel graphic as a soft grey figure) worked on as in the computer — motion smear, glow, out of focus with one sharp frame of focus, a patch of large pixels (set where the title leaves room), fluted glass, a band where the clear picture comes through in the channel colour, a fade; hairline grid, dot markers and interface-like labels; a big tight grotesque, the channel colour the only accent. A light grey or a black ground; flat layouts of its own |
| **Collage** | a mixed-media paper collage: a big disc of the channel colour, pieces of coloured paper torn by hand (a white fibre edge), strips of newsprint, halftone patches, a starburst, a marker scribble, held down with tape, a ticket stub and a barcode, every piece lifting a little; the title pasted on paper labels, highlighted words on labels of the channel colour; photos in black and white, one filling the canvas torn into strips set back off true. Cream or black paper; the usual slanted layouts, the colour block with a white paper edge |
| **Yellow poster** | the one bright yellow of theatre and film festivals: huge white letters (typed in, or the channel's code; with a photo, the photo shows inside them), a black silhouette in the room beside the title, turning yellow where it crosses the letters; a beam, crossing stripes, a flock of small silhouettes if you like; tight black type, highlighted words in the channel colour (magenta where that is too close to the yellow); a white band at the foot. The channel colour can take the yellow's place; flat layouts of its own |
| **Pitch** | the football poster: a pitch mown in stripes, its lines seen from above at an angle, the net bulging, a full stadium bowl, floodlights, the classic ball shaded in halftone (set just past the title's end), a crowd in silhouette; photos posterized the seventies way. Green with white lines, or canary yellow with green ones; flat layouts of its own |
| **Dot matrix** | everything made of dots of light on black: the channel graphic (or the photo) read into a grid of dots, larger where brighter; a rolling surface of dots, rainbow at the lower edges, motion smear, a red-and-cyan fringe, a glow, columns of digits and stars. Black only; flat layouts of its own |
| **Neon pop** | the neon noir pop illustration: the picture mapped by lightness onto a few flat neon tones (night shadows, the channel colour, its hot complement, a pale highlight), the figure in silhouette with a hot rim light and a light behind, a diagonal plane, bars down the side, halftone shadows and print grain; the whole palette can be turned round the colour wheel. A night-dark or a hot ground; flat layouts of its own |
| **Basketball poster** | a varsity number (team colour through a halftone, a white gap, an orange outline; typed in if you like) with the ball, seams and halftone shading, sitting in it (under a long title, the ball goes just below it); a half court in isometric plan with its stand, a dotted hoop, spray drips and speed trails behind the channel graphic if you like; screen-print wear and a worn wall. The team colour is the channel's; a worn white wall or navy; flat layouts of its own, the colour block a hardwood floor |
| **Velvet illustration** | soft flocked 3D illustration: a periwinkle sky, acid-green velvet hills, the channel graphic as a big plush object with volume and a fuzzy edge (in the channel colour, checked if you like), a soft shadow; a dusk gradient, stars and a glow if you like, heavy fine grain over everything. Periwinkle or night; flat layouts of its own, the colour block a green velvet lawn |
| **Psychedelic rave** | club and festival posters: a deep violet night, liquid iridescent chrome, the channel graphic in a holographic sheen with an eclipse halo; nebulae, a neon synthwave grid, an arch lined with plus marks, glass bubbles, orbits and a colour fringe if you like; the title glows in the channel colour, highlighted words in a holographic sheen. Night only; flat layouts of its own |
| **Liquid chrome** | the dark Y2K cyber poster: the channel graphic as liquid metal (hard horizon bands and specular streaks) melting into drips, a holographic streak across it; a wireframe sphere and grid, RGB glitch slices, glass bubbles, HUD frames and status lines, outlined letters if you like; chrome lettering, highlighted words holographic. Black or cool grey; flat layouts of its own |
| **Glitch net art** | net-art and glitch posters: dialog windows of an old operating system piling up, pixel sorting, datamosh, garbled characters, transparency checks, colour bars, cursors, scan shift; the channel graphic dithered into black pixels; highlighted words selected, white in a navy box. White or black; flat layouts of its own, the colour block a silver system panel |
| **Comic-verse** | an animated film printed like a comic book: the channel graphic in flat colour with an ink line, its shade in Ben-Day dots and hatching; towers seen from the street, focus lines, neon scribbles, a yellow caption box, a sound effect, glitch bars, and the red and blue plates out of register over everything; lettering with a magenta halftone drop and a cyan plate, highlighted words yellow. A photo is pressed into comic colours. Paper white or violet night; flat layouts of its own, the colour block the channel colour in halftone |
| **Patterned glass** | an oil painting seen through hammered glass: a room in warm light, a window, someone standing against it, flowers in the channel colour, painted in loose strokes, then bent by a pane of little lens-like dimples that catch glints and dark lines; frost and dark corners if you like; a serif title with a soft glow. A photo is seen through the same glass. Silver or night; flat layouts of its own, the colour block a pane of frosted glass |
| **Jelly machine** | the clear jelly creatures of designer-toy posters set into a machine: the channel graphic as glossy translucent jelly with bubbles, a circuit board's traces and chips, speakers, cables, knobs, an amber seven-segment display, columns of tiny print and jelly drops; the machinery out of focus and the glow spilling over if you like. A photo is graded teal and orange. Steel grey or night; flat layouts of its own |
| **Anime skies** | the painted skies and streets of today's anime films: cobalt down to a pale horizon, towering sunlit cumulus, rows of fleecy altocumulus, contrails, a utility pole and its wires, crowded rooftops with tanks, aerials and signs, the sea, sun rays, haze and leaves. Light is a summer day, dark is dusk with the windows lit. A photo is made clearer and more vivid. Flat layouts of its own |
| **City pop night** | the city by night on the anime videotapes of the late 80s and early 90s: a navy night or a violet dusk, clouds painted as cels (each lobe with a lit crescent on top and a dark one beneath), three rows of towers with their windows lit and red lights on their tops, neon crowns and signboards, a neon sign by the road with a looping script word, palms, the lights doubled in black water in sliding strips, stars, laser lines; the channel graphic as a figure painted on a cel (its tones stepped, a hard shadow, a rim of neon in the channel colour); the tape's colour smear, scanlines and head-switching noise along the foot. The title is graded from cream to pink, with a hard pink step and a navy drop. A photo is painted in four flat cel tones. Night only; flat layouts of its own |
| **Constructivist** | the Soviet avant-garde poster as illustrators take it up today: cream paper gone a little brown; the channel graphic built again as a machine out of rectangles of grey, ink, bare paper and one red, masts rising from its top (without a graphic, a ship in tiers); great diagonal wedges, a disc, rays from a vanishing point, a steel truss in perspective, bars and blocks, construction lines and dot grids, small type set as furniture, still water; the red can be turned by degrees to the channel colour. Upright condensed capitals over a copy printed a little off in red. A photo is pressed into a few greys, with the wedges and the disc printed over it. Cream or black paper; flat layouts of its own |
| **Dark deco** | the Art Deco city by night as the 90s animated series painted Gotham, on black paper — the dark is the ground and only the light is laid on: an ultramarine night, a great stepped tower with a sunburst lamp on every setback and its pilasters floodlit from below, rows of towers crowned with needles, stacked arches and masts, gold windows lit a few floors at a time, searchlights crossing, long bars of cloud across the moon, lavender fog between the rows; an airship sweeping its own light, a neon blade sign spelling the channel's code, a stepped proscenium, a backlit silhouette and noir rain if you like. *Crimson sky* turns it to Gotham's red sky with the towers black against it, *Gilt* to black and gold. The floodlight, the highlighted words and the channel name take the channel colour; the colour block is a black marble base with a gold frieze and the lights reflected in it. The title is set as the lit lettering of a theatre front: tall capitals spaced apart, each a lamp: tungsten white at heart, an amber rim where the light meets its edge, a warm glow thrown round it, a fine dark keyline (the outline slider) and a shade of the night behind (the shadow slider); the highlighted words are neon, glass in the channel's hue toned into the night, white-hot down the middle and glowing in their colour. The channel name is set in the same upright capitals, glowing glass on the black base; the corner tag a theatre marquee with lit bulbs, its capitals in the same lamplight. A photo is painted into the ultramarine night with its blacks crushed, its warm colours kept as crimson and gold, the searchlights crossing over it. Night only; flat layouts of its own |
| **Spectral engraving** | a black-and-white stipple print bleeding a rainbow: the channel graphic in stipple, dense where it turns from the light; threads of the spectrum streaming to the edge and turning up at a right angle, or dripping down; a spectral vortex, lines running to the horizon, rainbow waves, blocks of coloured lines, an engraved sky, a mat and a wooden frame; ink lettering on a stack of spectrum-coloured copies. A photo is engraved in level lines. Cream or black paper; flat layouts of its own |

The sliders of each look:

| Look | Sliders |
|---|---|
| Risograph | misregistration, halftone, halftone size, overprinted shapes (one after another: a pink disc, slanted blue bars, a half disc in the channel ink, a pink ring), patchy ink (bare paper in blotches and specks through the solids), roller streaks, ghosting (the whole print again, faintly, further down), paper grain; *Shuffle the random placement* rearranges the shapes and the blotches |
| 90s animation | clouds (more of them, one by one), dusk (the sky to violet, rose and amber, the clouds lit from below), light rays, lens flare, light leak (red-orange, burnt in from one side), bloom, fade, dust and scratches (the further it goes, the plainer: more and larger specks, hairs and long scratches, and at full a print that has plainly been run many times), film grain, vignette; *Shuffle the random placement* rearranges clouds, rays, flare and dust |
| Record sleeve | record sliding out (from hidden at 0 to well out), rules and catalogue, ring wear, worn edges, sun fade, paper grain, photo duotone, photo halftone; *Shuffle the random placement* moves the ring and the wear |
| Editorial | rules and folio, issue number, body columns (filling paragraph by paragraph from the top), quotation mark, gutter shadow, paper grain, black-and-white photo, photo in spot colour; *Shuffle the random placement* rearranges the paragraphs |
| Woodblock book | column rules (printing darker from 0, the centre column at the right coming in with them, whole at 0.6), text and notes (character by character, right to left, top to bottom), vermilion marks, collectors' seals (three, pressed one after another), uneven printing, age, water stains, wormholes, paper grain, and a *Set the title vertically* checkbox; *Shuffle the random placement* rearranges the text, seals, stains, wormholes and foxing |
| Summer illustration | cumulus (more clouds the further it goes: first a great mass on each side, then one after another further off), town and towers (the street rises from behind the horizon, then grows taller; a tower rises from 0.3, a second from 0.65), pennants (the first string grows in over the first half, the second over the other), postcard border, paper grain, photo vividness; *Shuffle the random placement* rearranges clouds, towers, houses and pennants |
| Negative space | giant silhouette, reversed split (it sweeps across the silhouette from the side: the further, the more of it is reversed), spotlight beam, taut threads, screen-print texture, credits, photo in red and black, and a *Channel colour for the red* checkbox; *Shuffle the random placement* moves and turns the silhouette and the threads |
| Minimal film poster | silhouette, backlight, receding ridges, crumpled paper, fade, vignette, credits, grain, photo inside the silhouette, photo toning; *Shuffle the random placement* reshapes the ridges and the paper |
| Cyanotype | glowing photogram, airbrush, uneven brushing, coarse halftone (the block's too), sparkles, hairlines and numbers, grain, photo as cyanotype; *Shuffle the random placement* rearranges the haze, brush marks and sparkles |
| Monochrome film | haze and light, motion ghost, folds, small print, dust and scratches, film grain, photo collage, photo motion blur, black-and-white photo; *Shuffle the random placement* rearranges the lights, the collage and the dust |
| Experimental type | title cut and shifted, title echoes, title dissolving, burst of lines, dry brush, giant letters, their letters (a field: up to eight characters, letters or Chinese; empty, each channel's code. Up to three stand in two staggered rows; more run in one line stepping a little down, set smaller to fit, so the word reads left to right), hairline grid, paper grain, hard black and white; *Shuffle the random placement* rearranges the burst, the brush strokes and the giant letters |
| Animated film poster | setting sun (its size), sunset colours (cream to amber and coral), sun stripes, sunburst, giant silhouette, lamp beam, procession (one by one, smaller as they go), winding road (drawn further the higher it goes, the traveller always at its end), stars, screen-print wear, white margin, credits, photo in one colour; *Shuffle the random placement* rearranges the burst, the stars, the road and the beam's side |
| Avant-garde image | figure, motion smear, glow, out of focus, frame of focus (with the blur; larger as it goes), pixel mosaic, fluted glass (spreading from the figure until it covers the whole picture), colour band, fade, grid and labels, grain, black-and-white photo; *Shuffle the random placement* |
| Collage | disc of colour, torn paper, newsprint strips, halftone patches, starburst, marker scribble (drawn further as it goes), paper lift, tape, ticket and barcode, paper texture, black-and-white photo, photo torn in strips; pieces, strips, patches and tape come in one by one; *Shuffle the random placement* rearranges them |
| Yellow poster | giant letters, their letters (a field: up to eight characters), black silhouette, flock (one by one), beam of light, crossing stripes (pair by pair), small print, paper grain, *Serif letters* and *The channel colour in place of the yellow* checkboxes, black-and-white photo, photo inside the letters |
| Pitch | mown stripes, pitch lines (arcs and dashes past half way), goal net (bulging more as it goes), stadium bowl (wider as it goes), floodlights, ball (its size), crowd (one by one), halftone, match details, crumpled paper, grain, photo posterized |
| Dot matrix | figure in dots, dot spacing, surface of dots, rainbow, motion smear, colour fringe, glow, columns of digits, stars, grain, photo's own colours |
| Neon pop | figure, rim light, backlight, diagonal plane (sweeping wider), side bars (one by one), hue shift, halftone shadows, bloom, print grain, vignette, photo in neon, hard tones (0 a smooth gradient, 1 hard steps) |
| Basketball poster | jersey number, the number (a field: up to three characters; empty, the channel's place), ball, half court (lines first, then fills and the stand rising), hoop, spray drips, speed trails, halftone, screen-print wear, worn wall, grain, photo in two colours |
| Velvet illustration | plush figure, volume, fuzzy edge, check, velvet hills (one by one), shadow, dusk gradient, stars (one by one), glow, velvet grain, vignette, photo in velvet colours |
| Psychedelic rave | holographic figure, liquid chrome (blob by blob), eclipse halo, nebula, neon grid, arch, bubbles, orbits, colour fringe, glow, grain, photo in neon heat |
| Liquid chrome | chrome figure, drips, holographic streak, wireframe, glitch slices, HUD frames, bubbles, outlined letters, creased paper, grain, black-and-white photo |
| Glitch net art | dithered figure, dialog windows (one by one), pixel sorting, datamosh, garbled characters, transparency checks, colour bars, cursors, scan shift, grain, photo dithered |
| Comic-verse | comic figure, towers from below (tower by tower), focus lines, halftone, hatching, off-register, dimension glitch, neon scribbles, caption box, sound effect, grain, photo as comic |
| Patterned glass | figure at the window, window light, warm light, flowers (bloom by bloom), brush strokes, ripple, pattern size, glints, dark lines, frost, dark corners |
| Jelly machine | jelly figure, circuit board, speakers (pair by pair), cables, knobs and buttons, segment display, tiny print, jelly drops, depth of field, glow, grain, photo teal and orange |
| Anime skies | cumulus (mass by mass), fleecy clouds, sunlight, contrails, pole and wires (wire by wire), town, signs, sea, leaves, haze, photo clarity |
| Spectral engraving | stippled figure, stipple depth, spectral streams, drips, vortex, perspective lines, rainbow waves, colour blocks, engraved sky, paper, mat and frame, photo engraved |
| City pop night | cel figure, dusk, night clouds (more banks, one by one), stars, skyline (the towers rise), lit windows (more of them lit), neon (crowns, signboards, the sign), palms (up to three, each growing in turn), water (the waterline rises), laser lines, videotape, film grain, photo as cels |
| Constructivist | machine, finer blocks, diagonal wedges (one after another, each growing out of its corner), disc (a black disc and a ring follow), rays (each new one in a gap), steel truss (a far one past half way), bars and blocks, construction lines, small type, water, old paper, channel colour for the red (by degrees), photo in greys |
| Dark deco | the great tower (it grows taller), skyline (the rows rise), lit windows (more of them lit), floodlight (up the faces, then the crowns), searchlights (one beam after another), moon and stars, fog, crimson sky (by degrees), rain, airship, blade sign and its letters (empty: the channel's code), stepped proscenium, silhouette, gilt (by degrees to black and gold), halation, film grain, photo as night |

**Figure from** — twenty looks draw a figure from the channel graphic's shape: negative space, minimal film poster, cyanotype, monochrome film, animated film poster, avant-garde image, yellow poster, dot matrix, neon pop, velvet illustration, psychedelic rave, liquid chrome, glitch net art, comic-verse, patterned glass, jelly machine, spectral engraving, city pop night, constructivist and dark deco. Under that figure's slider, *Figure from* shows what it is drawn from, the channel's graphic by default. Click it to draw the figure from another graphic — one of the library's, one of your assets, a sticker — or upload a picture (kept with your assets), or make it from a photo's cut-out subject: under *Cut-out subjects* are the photos of the bitmap library and of this cover, those cut out already shown cut out; one marked *Cut out* is cut out first when you click it, on this computer (as *Cut out subject* does). The subject, cropped to it, is kept with your assets and the figure takes its outline (and, in city pop night, its colours). Only the solid part is taken as the outline, so a PNG or SVG with a clear background, or a sticker, works best; an ordinary photo becomes a block. In the animated film poster it is the hero's every copy: the giant silhouette, the procession and the traveller on the road. The choice belongs to the look, for every cover of the profile; the channel graphic itself stays as it is. *Back to the channel's graphic*, or *Restore this look's defaults*, undoes it.

**Layouts of their own** — the record sleeve and editorial looks, and negative space, minimal film poster, cyanotype, monochrome film, experimental type, animated film poster, avant-garde image, yellow poster, pitch, dot matrix, neon pop, basketball poster, velvet illustration, psychedelic rave, liquid chrome, glitch net art, comic-verse, patterned glass, jelly machine, anime skies, spectral engraving, city pop night, constructivist and dark deco, do not use slanted panels. They read the three *Template* choices their own way: Stack is a level band, Split an upright side panel, Banner a slim strip, each in its own proportions. Switching to another look brings the usual layouts back.

The sliders named for the photo (*Photo duotone*, *Photo halftone*, *Black-and-white photo*, *Photo in spot colour*, *Photo vividness*, *Photo in red and black*, *Photo toning*, *Photo as cyanotype*, *Photo motion blur*, *Photo torn in strips*, *Photo posterized*, *Photo in neon*, *Hard tones*, *Photo's own colours*, *Photo as cels*, *Photo in greys*, *Photo as night* and the like) and *Hard black and white* only do something when there is a photo; *Photo inside the silhouette*, *Photo inside the letters*, *Photo collage* and *Photo torn in strips* act only on a photo that fills the canvas, as does the dot matrix's reading of a photo into dots, and so do the avant-garde image's smear, glow, blur, mosaic, glass and band (without a photo they work on the figure the channel graphic becomes). The patterned glass bends any photo with the same sliders as its painting; the patterned glass's brush strokes and the spectral engraving's streams, engraved sky and colour blocks come onto a photo only when it fills the canvas.

**The vertical title of the woodblock look** — each typed line is a column, read top to bottom, the first line on the right. CJK characters stand upright; a run of Latin letters or digits lies on its side, as is usual in vertical setting. A vertical title takes the full height of the page and stands clear of the seal in the lower left. Text effects do not apply to a vertical title; untick *Set the title vertically* for a horizontal one, and they apply again.

The Blue retro and Red street looks have been withdrawn: a profile that used one of them opens in Cyanotype or Negative space instead. Risograph and the looks after it are first versions and will be refined one by one. The serif lettering of Editorial and Woodblock book uses fonts already on the computer by default (Songti SC on macOS, SimSun on Windows), so it differs from machine to machine. For a Kai or Fangsong face, or any other, select the title layer and choose under *Font* in its properties.

The cyberpunk look has eight sliders and a checkbox. Two of them sound alike: *Scanlines* are the fine horizontal lines covering the whole picture; the *Sweep line* is the single bright one.

| Slider | What it controls | Turning it up |
|---|---|---|
| Colour split | red and cyan pulled apart across the whole picture; the red and cyan "echo" behind the title, stickers and the tag follows it | more glitch; 0 gives a clean picture with no echo |
| Signal tear | a few horizontal bands pushed sideways | more bands, pushed further; 0 gives none |
| Scanlines | the dark horizontal lines across the picture | more old monitor; 0 is the sharpest picture |
| Interface detail | the interface of an optical implant starting up and scanning: lens rings, a sweep line, a start-up log up the right edge, a ruler up the left, a status line, signal meter, code block and hazard stripe along the bottom, a lock-on ring and readout around the channel graphic, the huge channel code in the background | more of them appear in turn; 0 leaves only the corner brackets |
| Sweep line | the single bright line across the picture and the band of light above it; it sits at a height left to chance, and can be dragged up or down on the canvas with the background selected (the *Sweep position* slider of before is a drag now) | brighter; **0 hides it** |
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
| Title box width, height | the room the title has (30–100% of what the template gives it); its size is fitted so every line just fits, so a narrower or lower box makes smaller letters |
| Swap | the band on top and the title below; or the panel on the left and the title on the right |

Or drag on the canvas: with *Colour block & edge* selected, the dividing edge has a diamond at each end and in the middle — the ends change its lean, the middle moves it. The title box is set with the sliders above only.

Adjustments are stored as fractions of the picture, so they apply to every size; each of the three templates keeps its own, in the profile. After a swap the brand row sits on the colour block and turns to ink. If the colour block layer itself has been moved or turned, the diamonds on the edge are hidden; reset that layer's placement to get them back.

### Style and the default design

- Three templates — Stack, Split, Banner — on a dark or light background.
- **Set as default** stores the current layers, including items you added, as the profile's starting point for every new cover.

## Setup

- **Brand** — brand name; the brand logo, shown at the right end of the brand row on every channel's cover (upload a PNG with a transparent background or an SVG; on the cover it is the *Brand logo* layer, to move, resize or hide; looks that print something in that corner move it aside); whether the brand row shows the channel's number (*Show the number in the brand row*, off by default) and its label (“SERIES 01 / 05”); adding, removing and ordering channels; while you work on a channel (click any of its fields or change its colour) the canvas switches to that channel, so the change shows at once; a channel's graphic shows as a small picture and its name — click it for a window of pictures to pick from: the channel graphics, my vector assets and the stickers by group (or none); create, duplicate, delete, import and export profiles.
- **Sizes & export** — tick preset sizes or add a custom width × height. There is a preset for each ratio the platforms want, named after them: *Bilibili / YouTube · 16:9*, *Bilibili / Douyin / WeChat Channels · 4:3*, *Douyin / RED / WeChat Channels · 3:4*, *YouTube · 9:16*, *WeChat article · 1:1*, *WeChat article · 2.35:1*; a size of the same ratio, whatever its pixels, takes the same name, over the canvas and in the export dialog (the thumbnails under the canvas show only the pixels, the name on hover). A size can be given your own name instead.
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

- The token is stored in plain text in the app data directory on this computer (`ai.json`) and is never written into profile files.
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

## Cover standards

The layouts keep to a few rules, so a cover reads in the apps' feeds as it comes, in every look and size:

- **Nothing under the badges.** On a landscape cover (16:9, 4:3) Bilibili and YouTube lay the duration and the play count over the bottom corners. The title, the corner tag, the channel name and the channel graphic stay above that strip: the channel name keeps its sub-name beside it, and a colour block too shallow to hold it there grows until it does.
- **A title that reads.** The title's box leaves room for two lines at 14 px or more as the narrowest feed shows that ratio (Douyin's grid shows a 3:4 cover about 128 px wide, YouTube's side list a 16:9 one about 168 px). Keep a line to 6–8 characters: the longer it is, the smaller it is set. With a subtitle the box leaves room for its line too, and where there is not room for both the subtitle gets smaller first.
- **Something to look at.** In the *Stack* template the channel graphic takes at least 12% of the cover, and the title and the channel name make room for it.
- **Room for what is there.** A part left out under *Layout parts* gives its room to the others: without the channel name the colour block along the foot slims down (to 16% of the height, the tag on its edge still above the badges) and the title grows into the room; without the channel graphic the title keeps its whole box, and the *Split* template's panel narrows to a band down the side (13% of a portrait cover's width, 25% of a 16:9 one's), widening the title's column.
- **Every part shown.** A new cover comes with the tag `EP.01`, so the corner tag shows from the start (covers made before that and never touched were given it once); type your own under *Cover → Corner tag*, or empty it to leave the tag out. So does the subtitle, with a placeholder (*Write your subtitle here*), given once too to the covers not yet touched.

They hold for the template's own places: a layer you drag stays where you put it, and so does a colour block you resize or tilt under *Style → Layout*. With the channel graphic on, the *Split* template's title column is narrow at portrait sizes: there a line of more than 5 characters is set smaller than the feeds read well.

The covers each platform wants (checked on a phone):

| Platform | Covers |
|---|---|
| Bilibili | 16:9 and 4:3 |
| YouTube | landscape video 16:9; portrait video 9:16 |
| Douyin | 4:3 and 3:4 |
| RED | one of 4:3, 3:4, 1:1 |
| WeChat Channels | portrait video 3:4; landscape video 3:4 and 4:3 |
| WeChat articles | 2.35:1 and 1:1 |

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
channel,title,tag,subtitle
Vlog,"First line\n*second line*",EP.01,A line to go with it
Tutorials,Another title,,
```

- The channel column may hold a name, a code or a number. Rows that match nothing use the current channel.
- Use `\n` for a line break in a title.
- The header row is optional; without it the columns are channel, title, tag, subtitle.
- Each row has only its own subtitle: without the column, or with it empty, the cover has none.
- A template can be downloaded from the app.

## Where your data lives

Profiles, each channel's cover, assets, settings and your own repaint styles (the `repaint-styles/` folder) are kept in the system's app data directory.
Exports are written only where you choose.

| System | Location |
|---|---|
| macOS | `~/Library/Application Support/com.cyven.smedcover/` |
| Windows | `%APPDATA%\com.cyven.smedcover\` |
| Linux | `~/.local/share/com.cyven.smedcover/` |

To move to another computer or share with someone, export the profile (*Setup → Profile → Export profile*):

- *With each channel's cover and its photos* unticked: the brand settings only (channels, sizes, look, default design, and the assets and imported fonts they use) — to share as a template.
- Ticked: a whole backup of the profile, every channel's cover and the photos on them included — to move to another computer; it can be large.
- Importing always adds a new profile; a whole backup brings back every channel's cover, on the channel it was exported from.

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

To go through some looks only (the self-test makes several covers in each, so all of them take minutes), name them: `SMEDCOVER_SELFTEST_LOOKS=citypop,construct`.

`.github/workflows/build.yml` builds installers on GitHub Actions (it has not been run yet): macOS for Apple silicon and for Intel, separately (`.dmg`, `.app.tar.gz`), Windows x64 (`.exe`, `.msi`), Linux x64 (`.deb`, `.rpm`, `.AppImage`).

## To do

### Layered files for Illustrator / Affinity

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

### Custom looks (after more built-in looks are added to Style)

Goal: users make looks of their own and import looks others made, and the Style tab shows their sliders as it does now (the list of sliders is data already).

- [ ] **Look presets** (first, small): a JSON file — which built-in look, its slider values, its seed, and optionally its colours (paper, inks); exported, imported, shared, with that look's sliders in the panel. Variations of the existing looks only.
- [ ] **Declarative look files** (later, large): the ways of drawing the built-in looks share, taken apart into building blocks — ground (flat, gradient, halftone field, grid, noise), photo treatment (tint, duotone, black and white), title (fill, outline, offset shadow, two inks off register, glow), the stickers' outline and shadow, corner marks, finishing (grain, scan lines, vignette), the repaint and AI asset prompts — which a look file puts together as data, declaring its own sliders and binding them to the blocks' settings; the panel builds the sliders.
  - No code is run, so a file from someone else is safe to import; it is checked as AI assets are.
  - Try it on one or two built-in looks first (Risograph, Editorial) to see whether the format is enough, then move the others one by one.
  - A look editor could start from "save as" on an existing look; AI could write a look file from a sentence.
- Not planned: script plugins (a look as JavaScript) — that would run strangers' code in an app that can read and write files.
- Open: whether an imported look may name fonts, and whether the font files travel with it; whether the editor lives in Setup or in Style.

### Open the looks' material effects to the user's own layers

Goal: text, asset, photo and solid layers can each take a look's material effects — the riso's misregistration and patchy ink, the chrome's metal and drips, the net art's pixel sorting and dither — each layer with its own strengths. The layout layers (title, channel graphic, tag, channel name) do not: their look is designed by the look as a whole.

**Decided**

- Only the user's own layers; every effect off on a new layer; one set of effects per layer, not per size.
- A layer's effects come in two groups: *This look* lists the current look's; *Other looks* lets you borrow from another look, kept apart, so a borrowed effect shows as borrowed.
- *Surprise me* picks only from the current look, so the result stays of one look.
- The lettering effects are brought home: Sliced, Overprint, Double keyline and Sunlit block become their looks' true post effects (Three slices, Second-ink overprint, Two-tone outline, Sunlit block), for any layer and with any text effect; the net art's Selected box likewise. The Underlined highlight has to know the highlighted words, so is lettering, and stays in the text effect menu. A text layer already using one of the four is given the matching post effect; a title's is drawn as *Automatic*, its setting kept.
- Pilots: riso, liquid chrome and glitch net art; then every look.

**How effects are sorted**: three questions, in order.

1. Does it **add something to the picture**? Something with content and a place of its own, belonging to no layer: the ball, the giant letters, the hills, the radiating lines. → a **scene object**; it stays in the background layer.
2. Does it imitate **the medium the whole picture shares**? The same sheet, the same reel of film, the same lens, the same screen: paper grain, film grain, vignette, creases and folds, sun fading, dust and scratches, scan lines, light leaks, lens flare. → the **finish**; not opened to single layers. A real print never has film grain in one spot only; laid layer by layer it looks dirty, and doubles the whole-picture one.
3. What remains changes **how one thing is drawn or printed**. It depends only on that thing's own shape and pixels, and moves and scales with it: misregistration, halftone, chrome, a fuzzy edge, pixel sorting, a silhouette, a glow, fluted glass, slicing. → a **material effect**, opened to layers.
   - Some are laid over the whole picture today: the riso's ghost and patchy ink, the basketball poster's screen-print wear, the cyberpunk colour split. By this test they are material too.
   - Once opened, the whole-picture one stays in the Style panel, and a layer's own is laid on that layer only.

A last kind is **a relation between layers**: one layer's shape decides where another shows, as in the minimal film poster's *Photo inside the silhouette* or the yellow poster's *Photo inside the letters*. That is a mask, belonging to no look, and suits a *clipping mask* that every look can use.

**Each look's material effects**

Stages: [fill] replaces the colour inside the outline; [over] lays texture inside it; [px] works on the pixels; [out] paints outside the outline; [text] is for text only.

Layers: "photo" marks an effect for photo layers only; the others suit text, asset, photo and solid layers alike. A [fill] effect on a photo only makes sense on a cut-out.

★ marks a scene object worth making draggable.

| Look | Material effects (opened to layers) | Scene objects | Finish |
|---|---|---|---|
| Cel | screentone shade [over] | grid | — |
| Cyberpunk | colour split [px], signal tear [px], line glow [out], photo tint [px, photo], Sliced [text] | interface decor, scan band ★ | scan lines |
| Riso | misregistration [px], halftone (with its pitch) [over], patchy ink [over], roller streaks [over], ghost [px], Overprint [text] | overprinted shapes ★ | paper grain |
| 90s animation | photo warmed [px, photo], Double keyline [text] | clouds ★, dusk, light rays ★ | bloom, fade, light leak ★, lens flare ★, dust and scratches, film grain, vignette |
| Record sleeve | photo duotone [px, photo], photo halftone [px, photo] | the record showing ★, rules and catalogue numbers | ring wear, edge wear, sun fading, paper grain |
| Editorial | black-and-white photo [px, photo], photo in spot colour [px, photo], Underlined highlight [text] | rules and running heads, issue numeral ★, text columns, quotation marks ★ | gutter shadow, paper grain |
| Woodblock | uneven printing [over], seal-red ink [fill] | column rules, text and notes, red annotations, collector's seals ★ | wormholes, water stains, ageing, paper grain |
| Summer illustration | photo vividness [px, photo], Sunlit block [text] | cumulus ★, town and towers ★, pennants | paper grain (frame: postcard border) |
| Negative space | red-and-black silhouette [fill], screen-print texture [over], photo in red and black [px, photo] | giant silhouette ★, negative split, spotlight beam ★, threads, credits | — |
| Minimal film poster | silhouette [fill], back light [out], photo toning [px, photo] | silhouette ★, layered hills, credits | creased paper, fade, vignette, grain |
| Cyanotype | glowing white figure [fill], airbrush haze [out], coarse halftone [over], photo as cyanotype [px, photo] | starlight, rules and numbers | uneven brushing, grain |
| Monochrome film | motion ghost [px], black-and-white photo [px, photo], photo motion blur [px, photo], photo collage [px, photo] | haze and flare ★, editorial small print | fold, dust and scratches, film grain |
| Experimental type | slice [px], echo [out], particle scatter [px], dry brush [over], hard black and white [px, photo] | giant letters ★, radiating lines ★ (their centre), hairline grid | paper grain |
| Animated film poster | silhouette [fill], sunburst [out], screen-print wear [over], photo in one colour [px, photo] | sun ★, sunset gradient, sunset stripes, sunburst ★, giant silhouette ★, street-lamp beam ★, procession, winding road, stars | white poster border (frame) |
| Avant-garde image | motion smear [px], glow [out], out of focus with a frame of focus [px], pixel mosaic [px], fluted glass [px], colour band [px], fade out [over], black-and-white photo [px, photo] | figure ★, grid and labels | grain |
| Collage | paper lift [out], tape [over], halftone patch [over], black-and-white photo [px, photo], photo torn in strips [px, photo] | colour disc ★, torn pieces, newsprint strips, starburst ★, marker scribble ★, ticket and barcode | paper texture |
| Yellow poster | black silhouette [fill], black-and-white photo [px, photo] | giant letters ★, flock, beam ★, crossed stripes, small print | paper grain |
| Pitch | halftone [over], photo posterized [px, photo] | mowing stripes, pitch lines, goal net, stands, floodlights, ball ★, crowd, match details | creased paper, grain |
| Dot matrix | read into dots (with their pitch) [fill], rainbow [px], motion smear [px], colour split [px], glow [out] | dot figure ★, rolling surface of dots, digit columns, stars | grain |
| Neon pop | neon gradient map [px], hard tones [px], rim light [out], back light [out], halftone shadow [over] | figure ★, diagonal plane, side bars | bloom, print grain, vignette |
| Basketball poster | varsity outline [out], halftone knock-out [over], spray drips [out], speed trails [out], screen-print wear [over], photo in two colours [px, photo] | jersey number ★, ball ★, half court ★, hoop ★ | worn wall, grain |
| Velvet illustration | velvet [fill], check [over], volume [over], fuzzy edge [out], soft shadow [out], photo in velvet colours [px, photo] | plush figure ★, velvet hills, dusk gradient, stars | glow, velvet grain, vignette |
| Psychedelic rave | holographic sheen [fill], eclipse halo [out], colour fringe [px], photo in neon heat [px, photo] | holographic figure ★, liquid chrome ★, nebula, neon grid, arch, bubbles, orbits | bloom, grain |
| Liquid chrome | chrome [fill], holographic streak [over], drips [out], glitch slices [px], black-and-white photo [px, photo] | chrome figure ★, wireframe ★, HUD frames, bubbles, outlined letters | creased paper, grain |
| Glitch net art | dither [fill], pixel sorting [px], datamosh [px], scan shift [px], Selected [text] | dithered figure ★, dialog windows ★, garbled characters, transparency checks, colour bars ★, cursors ★ | grain |
| Comic-verse | comic colouring [fill], halftone [over], hatching [over], off-register [px], dimension glitch [px], photo as comic [px, photo] | comic figure ★, towers from below, focus lines ★ (their centre), neon scribbles, caption box ★, sound effect ★ | grain |
| Patterned glass | patterned glass (ripple, pattern size, glints, dark lines) [px], brush strokes [px], frost [px] | figure at the window ★, window light ★, warm light, flowers ★ | dark corners |
| Jelly machine | jelly [fill], glow [out], depth of field [px], photo teal and orange [px, photo] | jelly figure ★, circuit board, speakers, cables, knobs and buttons, segment display ★, tiny print, jelly drops | grain |
| Anime skies | photo clarity [px, photo] | cumulus ★, fleecy clouds, sunlight ★, contrails ★, pole and wires ★, town, signs, sea, leaves ★, haze | — |
| City pop night | cel tones [px], neon glow [out], videotape [px] | cel figure ★, night clouds ★, stars, skyline and lit windows, neon crowns and signboards, neon sign ★, palms ★, water, laser lines | videotape, film grain (frame: screen corners and the play display) |
| Constructivist | built of blocks (with the block size) [fill], grey plates [px], diagonal wedge [out] | machine ★, diagonal wedges, disc ★, rays ★ (their centre), steel truss ★, bars and blocks, construction lines, small type, water | old paper (frame: a ruled border) |
| Dark deco | gilded [px], silhouette with rim light [fill], gold sunburst [out], night grade [px, photo] | the great tower ★, moon ★, searchlights ★, skyline and lit windows, floodlight, fog, crimson sky, rain, airship ★, blade sign ★, stepped proscenium, silhouette ★ | halation, film grain (frame: gold corner pieces) |
| Spectral engraving | stipple (with its depth) [fill], line engraving [fill], spectral streams [out], drips [out] | stippled figure ★, vortex ★, perspective lines ★ (their vanishing point), rainbow waves, colour blocks, engraved sky | paper (frame: mat and frame) |

The general typesetting effects belong to no look and stay in the lettering menu: Automatic (follows the look), Sticker, Outline and shadow, Plain, Plain upright, Halftone inside, Stripes inside, Inner shadow, Worn, Row shift, Extruded; and the bends beside them: Arched, Arc down, On a circle, Arched top, Bulge, Pinch, Fisheye, Rise, Tapered, Wave, Flag.

**Implementation**

- [x] Each look declares its material effects, `elementFx`: a name, the layer types it suits, a stage and a painter. The framework runs the stages in a fixed order: replacing the fill `fill` → laying texture `over` → working on pixels `filter` → outside the outline `behind`.
- [x] Settings live on the layer and stay with it: `L.lookFx = { "fromLook.effect": amount, "fromLook.effect:sub": value }`. They apply under any look; the interface sorts them into *This look* and *Borrow from other looks* by the look they come from.
- [x] Pipeline: the per-layer offscreen pass already used for opacity below 1, with the stages applied there before compositing. The offscreen canvas is only the layer's box; it is degraded while dragging, and its result cached by its settings. Randomness is seeded by the layer's id, so every size, the preview and the export agree.
- [x] Interface: *This look* and *Borrow from other looks* groups of sliders in the layer's properties, 0 by default; a borrowed look can be removed on its own, and one button clears them all.
- [ ] In stages:
  1. ~~The framework and the pilots: riso, liquid chrome and glitch net art, on text and asset layers.~~ Done.
  2. ~~Every look, and the photo and solid layers.~~ Done.
  3. ~~The lettering effects brought home.~~ Done.
  4. ~~A general clipping mask.~~ Done.
  5. ~~Draggable scene objects (next item).~~ Done.
- Note: this records look-specific settings in the cover's data, which changes the rule that a cover's content never mentions a look.

### Draggable scene objects in the background

Goal: the scene objects marked ★ above — the ball, the giant letters, the centre of the radiating lines, the sun, the cumulus — can be dragged where you want them on the canvas.

- [x] Each look declares its draggable objects (`scene`): their names; the default position is not declared apart, but is where the drawing puts each by the layout.
- [x] Positions live on the cover, per look, as offsets from the default position (in proportion to the canvas), so they follow when the layout or the size changes. As with the user's own layers, there is one position for all sizes and a per-size adjustment.
- [x] With the *Background* layer selected, small handles show on the draggable objects: drag to move, double-click to reset; *Surprise me* may shuffle them too.
- [x] Sliders a look had for a position (the cyberpunk's *Sweep position*) became dragging.

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
| Built-in repaint styles (`ui/repaint-styles/`) | each adapted from an open-licensed skill: the `credit` line of each file names its source, author and licence (MIT or AGPL v3) |

In short: you may use, change and redistribute SmedCover, but if you distribute a modified version —
or let people use one over a network — you must make its source available under the same licence.
The built-in artwork may be reused elsewhere with credit; covers you make with SmedCover need no credit.

Copyright © 2026 cybertheye.
