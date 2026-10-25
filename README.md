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

The cover, small and blurred, fills the window behind everything, and every panel is a pane of frosted glass over it, letting its colours through; when the cover changes (a new look, say), it fades into the new one. The window has no title bar of its own, on a Mac, Windows or Linux alike: its close, minimise and zoom buttons sit at the top bar's left end, three red, yellow and green circles, and the top bar moves the window (a double click on it zooms it).

- **Top bar** — the profile and the channel (a menu each), undo and redo (*Saved as you go*: there is nothing to save by hand), **SURPRISE ME** (你看着办 in Chinese) with its key, *Space*, on it, **Export** (its tip names its key, ⌘E), and **⋯**.
- **⋯** — what is seldom wanted, and what changes a whole cover or profile. Under *This cover*: *Set as the default design*, *Restore the default design* and *Empty this cover…*. Under *Profile* and its name: *Brand & channels* (with how many channels), *Sizes & export* (with how many sizes) and *AI*, each opening Settings at that page; the line under *AI* has the AI light (see [Settings](#settings)) and says in a word how the AI services stand: *Connected* or *Ready*, *Working…*, which one's last request failed, and what is not set up. *Switch profile* unfolds the other profiles, to switch to one. Under *Project file*: *Open project…* and *Save project*, each with its key at its end (see [Project files](#project-files)). Then *Frosted glass* on or off, and the *Language*. *Empty this cover…* asks first, then takes every layer you added off this channel's cover, puts the layout layers back to the default design's places, effects and colours, and the scene objects to theirs; the title, subtitle and tag words and the style stay, and the photos are still on the photo shelf. It is one step of undo.
- **Dock** — on the left, five buttons, each opening its sheet beside it, one at a time:
  - **Content** — the channel, and the cover's words: title, subtitle, corner tag. Longer notes sit behind ⓘ; *Copy from another channel…* is at its foot.
  - **Look** — a search field and chips over the cards, then every look as a card with this cover drawn in it; under the cards, the look's own settings and how Surprise me deals it. See [Looks](#looks).
  - **Layout** — your layout presets as cards, the colour block's edge, which layout parts show; *Hide every layout part* and *Reset the layout parts' places* at its foot. While it is open the canvas frames each layout part (see [Which parts show](#which-parts-show)).
  - **Assets** — *Text*, *Colour*, *Upload photos* and *AI generate*, a search field, then the photos on this cover, then the shelves: the photo shelf, stickers, channel graphics, my vector assets, AI stickers & graphics. See [Assets](#assets).
  - **Layers** — chips to show all the layers or some, the layer list; under it, the selected layer and what can be done to it. See [Layers](#layers).

  At the dock's foot, **?** shows *Canvas controls*: how the mouse and keys work on the canvas.
- **Centre** — the canvas. Under it a tray: the size shown, a thumbnail of every output size (click one to show that size on the canvas), and *Applies to*.
- **Bar over the canvas** — the selected layer's most used settings, on a bar over it: for lettering its font, then a round button showing its colours (the words' and, split across it, the highlighted words'), *Effect* (with the effect it has) and *Bend* on the title, subtitle and text layers, and *Vertical*; for a photo *Remove the background*, *Crop…*, *AI repaint* and *Replace photo…*; for an asset *Colour*, *Crop…* and *Weave*; for a colour layer *Colour*; for a photo with its background removed or a cut-out also *Weave*; for the colour block *Shape* and *Size & slant*; for the background *Ground*. Each opens its group of properties in a small popover under the bar (its button lit while it is open), or does what it says; *More…*, in a segment of its own at the end, opens the drawer. The bar goes while the canvas is dragged, with several layers selected, in 3D and in Settings.
- **Properties drawer** — on the right, everything about the selected layer. It is shut to begin with, and the canvas takes its room; it opens from *More…* on the bar, from the button under the layer list, or with a double-click on the canvas, and stays open or shut as you left it. ✕ at its head shuts it. In a narrow window (below about 1350 px wide) the open sheet makes way for the drawer, the dock staying; a dock button shuts the drawer and shows that sheet again. The windows that open over the sheet open over the drawer then.
- **Settings** — a window over the editor, opened from ⋯. See [Settings](#settings).
- **Frosted glass** — where the web view cannot blur, or with *Frosted glass* off in ⋯, the panes are plain and translucent instead. The glass changes only by your hand: if the canvas draws slowly while something is dragged, a note says so once, when you let go, with a button to make the panes plain.
- **Dialogs** — a click on the dimmed page outside a dialog cancels it (a press inside dragged out does not). Two stay: the first-run welcome, where a starting point must be chosen, and an export's progress, which only its own *Cancel* stops.
- **Keys** — written here as on a Mac, where ⌘E, ⌘S and ⌘O take ⌘ itself (Control and a letter still move the caret in a field); elsewhere Ctrl stands for ⌘. Space, ⌘E, ⌘S and ⌘O act once however long they are held (the arrows, ⌘Z and ⌘D repeat). **Space** deals, as *SURPRISE ME* does, while the editor is in front, with no field, slider, box or list holding the focus (one just clicked included), no dialog, menu, popover of the bar over the canvas, 3D view, drag on the canvas, letter, crop or weave window or weave brush in the way, and no deal under way; in Surprise me's window it deals again. A button or other control you have moved to with the keyboard (Tab) takes Space as ever, pressing it, and nothing is dealt. **⌘E** opens Export, shutting the ⋯ menu if it is open (not while typing, nor with a dialog or Surprise me's window open, nor in Settings); in the Export window it exports the sizes ticked. **⌘O** opens a project file and **⌘S** saves one, from the editor (not with a dialog or Surprise me's window open, nor in Settings); ⌘S works even while you type in a field, and saves what is typed. Neither ever opens the browser's or web view's own Save or Open. How the mouse and keys work on the canvas is under **?** at the foot of the dock, and in [Collage](#collage-work-directly-on-the-canvas) below.

## Quick start

1. On first launch, type a brand name and pick a starting point: three general channels, or a full example.
2. Open ⋯ at the top right, then *Brand & channels*, and make the channels your own: name, sub-name, code, colour, graphic.
3. Under *Sizes & export*, in the same window, switch on the output sizes you need.
4. Close Settings (✕ or Esc). In the *Content* sheet, pick a channel and type the title. Every size updates together.
5. Click **Export** in the top bar.

## Making a cover

### Title

- One line in the text box is one line on the cover. Text **never wraps**; longer or more lines mean smaller type.
- Words wrapped in `*asterisks*` take the channel colour.
- The lines are set as a typesetter would set a Chinese title. Latin letters and digits beside Chinese (`2026`, `AI`, `iPhone`) come from a Latin font whose capitals stand a size smaller than the characters; they are set larger, to look as tall, and centred on them — by how much is measured on the font, so a Chinese font with matching Latin of its own is hardly touched. Chinese punctuation is squeezed as the Kaiming style has it: within a line 。？！ keep their full width and the other marks (，、；：, quotes, brackets) give up their blank side, about half their width (a comma keeps a little after it, so it stays with what it follows); an opening mark at the start of a line and a closing one at its end give up their blank, and of two marks in a row (？！, 。」) the blank between them goes. The lines are shorter, so the title can be set larger. (A title set in columns has rules of its own: see *Vertical*, below.)
- The **subtitle** is a smaller line under the title, lettered as the title is, typed under *Subtitle* (a new cover comes with a placeholder). It takes a line at the foot of the title's box: the title makes room for it and the two are centred there together, the subtitle about 0.4 of the title's size, and never as large as the title. Where it would set the title smaller than the feeds read well, the subtitle gets smaller first. Empty it, or switch it off under *Layout → Which parts show*, to leave it out. With the title or the subtitle in columns it goes elsewhere: see *Vertical*.
- **Vertical** (竖排): every lettering layer — the title, the subtitle, your text, the corner tag, the channel name, the brand row, and copies of them — has a *Vertical* box in the Text group of its properties (and *Vertical* on its bar over the canvas). Ticked, it is set as a Song-dynasty printed book is: each typed line a column, read top to bottom, the columns from right to left. Chinese characters stand upright; a run of Latin letters or digits lies on its side (set larger beside Chinese, as in a line); 。，、 sit at the top right of their cell, ？！：； in its middle, and brackets, quotes, dashes and ellipses turn with the column. Then *Column rules* (界行线) may be ticked too: thin lines between the columns and at both sides of the block, faintly in the lettering's colour, as a printed book rules its columns.
  - The title's columns stand at the top left of its box, as large as fits: the longest column as high as the box, all of them as wide. With the subtitle in columns too, the subtitle is a column of its own left of the title's, smaller and a character lower, so it is read after it; with the title in columns and the subtitle in a line, the line goes under the columns; with the title in a line and the subtitle in columns, the subtitle stands right of the title, from its top. A text layer in columns is set at its usual size, about its centre.
  - The lettering is the same as in lines: the text effect, outline and shadow, the plate (under the whole block), the highlight styles and the look effects. A column is its line turned a quarter turn with the upright characters turned back; the light does not turn, so what a lettering throws off its letters (a shadow, depth, an echo, a plate's shadow) falls down and to the right as it does off a line, and a melting letter drips down the column.
 *Row shift* cannot be drawn in columns, and the look's own lettering stands in for it. In columns there is no bend: the Bend group gives a note in place of its menu, and the bend chosen comes back when the layer is set in lines again.
  - The corner tag, the channel name and the brand row are turned whole, plates and all, their Chinese characters upright: each hangs down from where its line was (or, near the foot of the cover, rises from there), at its end nearer the edge; the brand row leaves out its channel rail and number tag. Move it where you want it, as any layer.
  - Weaving and the ransom note's letters count a column as a line; a letter keeps its place in them whether the layer is set in columns or in lines. Surprise me never ticks or unticks *Vertical* or *Column rules* (nor does a layout preset carry them), and deals a layer in columns no bend. The cover standards measure a title in columns by the size of its characters.
  - The woodblock look's *Set the title vertically* is the look's default: while it is on, the title and the subtitle are in columns (their box shown ticked and greyed, saying so); turn it off and each follows its own box.
- The corner tag is an optional short label such as `EP.03`.
- The title can also be changed in the properties of the *Title* layer, under *Text*: it is the same words; so can the subtitle, in the *Subtitle* layer's.

### Which parts show

*Which parts show*, in the *Layout* sheet, lists what the layout brings, a button each with an eye, from the top down in the order they are stacked: the corner brackets, the title, the subtitle, the brand logo, the brand row, the corner tag, the channel name, the channel graphic, the colour block and its edge. Click one and that part is left out of this cover, and no longer listed with the layers (*Hide every layout part* leaves it alone too); click it again and it is back, its place, colours and effects as they were. It is this channel's cover only, it stays through *Empty this cover…*, and it can be undone. A new cover leaves out the channel name and the channel graphic; click them to bring them in (covers made before that and never touched, and the profile's default design, left them out once). The background is always there, at the bottom, so it is not listed.

The order they are stacked in is the layer list's: drag a row in the *Layers* sheet to change it. The new order is the profile's default order from then on: a new channel's cover and *Empty this cover…* stack the layout's parts so (the layers you added are not part of it). The cover and the default change together, one step of undo.

While the *Layout* sheet is open, the canvas frames every layout part drawn at the size shown — the title, subtitle, tag, brand row, channel name and graphic, logo and colour block, not the background (nor the corner brackets, a part hidden or one locked) — in a dashed line named as the layer list names it; the selected part keeps its own frame and handles instead. The frames follow every change, a drag, the window resized and the size shown, and go when another sheet, the 3D view, Settings or the drawer takes the sheet's place, or while the letter, crop or weave window is open or the weave's brush paints. A press anywhere inside a frame (its whole box, the colour block's too, regardless of its slanted edge) takes that part and drags it, as a press on the part does, so a part lying under another, or under a photo, is reached by its frame: where frames lie one in another, the smallest wins, unless what you press is smaller still (a sticker on the title, say) or is the layer already selected, which keeps the press.

### Photos

Every photo is a *Photo* layer. In the *Assets* sheet:

- **Upload photos** — several at once if you like. You can also drop photos onto the window; dropped on the canvas, a photo lands where you let go. (With the AI generate window open, a picture dropped is its reference picture instead.)
- **AI generate** — has an image model make a photo; see [Generating a photo with AI](#generating-a-photo-with-ai).
- **Photo shelf** — every photo you uploaded, had made or repainted stays on it: click one to add it, or drag it onto the canvas. See [Assets](#assets).

**A cover's first photo fills the canvas**, as its background, just above the Background layer. The ones after it sit on the cover like prints: move, scale, turn and re-order them, as many as you like, for collage. *Fill the canvas* in a photo's properties switches between the two. A photo filling the canvas is clicked once to select it, then dragged on the cover and scrolled to resize; once selected it drags even when you press on the colour block. Scaled down until it no longer covers the canvas, it shows its frame again, with the four corner handles to resize it (it is never turned or stretched).

Under *Photos on this cover*, below the four ways to add, every photo on the cover is listed in layer order: a thumbnail, its size, and *AI repainted* on one that was; a cut-out is listed under its photo, its thumbnail without the background. Click a thumbnail to select its layer; the × on its corner (on hover) deletes the photo. Each photo has *AI repaint* and *Replace photo…*, there and on its bar over the canvas: replacing a photo changes only the picture — placement, blur, dim, outline, name and the rest are kept — and a linked cut-out is cut out of the new picture again, its own settings kept. A cut-out cannot be replaced or repainted by itself (it shows its photo's picture).

Each photo's properties, top to bottom: remove the background, cut out the subject (into a new photo layer), on a cut-out how it weaves with the lettering (see *Cutting out the subject*), fill the canvas, *Crop…*, blur, dim, the look's treatment of photos (tint, duotone, black and white…; on by default), the outline's width, a shadow, the outline's colour, its style (*Solid*, *Torn paper*, *Dashed*) and the look effects (see *Look effects on your own layers*), then the opacity and *Reset placement* every layer has. To change the picture, use *Replace photo…*, on its bar or under it in *Photos on this cover*. *Remove the background* and *Crop…* are on its bar too; *More…* there opens the rest in the drawer. With the background removed the outline and shadow follow the subject; otherwise the photo's edge, like a print. With *Torn paper* the outline becomes a margin of paper torn by hand: a ragged edge (slow bites, smaller jags, loose fibres), a band of the paper's white core along it (plainest on coloured paper), and a soft shadow under it; the wider the outline, the more the tear wanders, but it never reaches into the photo. Each photo tears its own way and keeps it. With *Dashed* it becomes a line of evenly spaced dashes a little way out from the edge, like the line a sticker is cut along: the outer edge of the dashes where a solid outline's would be, the wider the outline the bolder and longer the dashes, each closed line round a whole number of them. Choosing either with no outline yet gives one of 16.

**Crop**: *Crop…* on a photo's bar, or in the *Place* group of its properties (*Adjust the crop…* once it is cropped), keeps only part of the picture. It opens a window over the sheet on the left, the canvas left in view: the whole picture, the part kept framed and the rest dimmed (with the background removed, the subject bright over the rest of the picture). Drag inside the frame to move it, its sides and corners to resize it, or outside it to draw a new one; hold Shift to keep the shape it has. The chips under the picture set a shape — *Any ratio*, *Its own shape*, 1:1, 4:3, 3:4, 16:9, 9:16 — and choosing one turns the frame to that shape, about as large as it was and about the same middle, within the picture (from the whole picture: the largest frame of that shape); under them, how many pixels are kept, of how many. The last chip, *Free*, crops to a shape of any outline instead: it starts with a point on each corner of the whole picture, joined by edges. Drag a point and only it moves, the points beside it staying where they are; press anywhere on an edge (the pointer turns into a plus, and a faint point shows where one would go) to add a point there, and drag it on at once; double-click a point, or click it and press Delete, to take it away (three always stay, and the shape always keeps some area: a point is not taken away, nor dragged, to leave it a line or a sliver); drag inside the shape to move it whole. Points stay within the picture, and what lies outside the shape is dimmed. The photo's frame is then the box round the shape, and only what lies inside the shape shows and is caught by the mouse. Choosing another chip crops to a rectangle again (*Any ratio*: the box round the shape). The canvas follows as you drag, and the part kept stays where it is on the cover: only it shows and is caught by the mouse, the outline (torn and dashed ones too) and the shadow go round it, and scaling or turning the photo goes about it. Nothing is lost: *No crop* brings back the whole picture, at any time. Esc, *Done* or ✕ closes the window, and so does selecting another layer. A photo filling the canvas cannot be cropped (the button says so: untick *Fill the canvas* first). A cut-out made from a cropped photo starts with the same crop. Assets (stickers, channel graphics, your own pictures) can be cropped the same way, with *Crop…* on their bar or in their properties.

The Background layer itself is the ground, always at the bottom. Its base is a *Grid*, the look's own ground, dark or light, with a grid drawn in the look's own way (cel's is its familiar grid); *Look's own*, that ground as the look first had it, with no grid on it (cel, which has no ground of its own, keeps the theme's field and its grid); or *See-through*, nothing at all (a PNG exports with a transparent background; a JPEG, which has none, gets a dark matte; the editor shows a checkerboard). What the look paints on it (the dark deco's skyline and moon, the anime sky's clouds…) lies over the base: with every slider of the look at nothing, the base is all there is. Light or dark is set in the Background layer's properties, under *Ground* (also on its bar; not in the *Look* sheet); while a photo fills the canvas it covers the ground, and the lettering is set as on a dark one.

### Cutting out the subject

Select a photo: *Remove the background* and *Cut out subject* are in its *Cut-out* group (*Remove the background* is on its bar over the canvas too). Cutting out is done on this computer — photos are not uploaded — in one of two ways, chosen under ⋯ → *AI* → *Cut-out*:

| Way | Systems | |
|---|---|---|
| Apple Vision | macOS 14 and later (the default on a Mac) | built in (the same "lift subject" the Photos app has), nothing to download, usually under a second |
| BiRefNet light / full | Windows, Linux, macOS (light is the default elsewhere) | an open model (MIT), downloaded on the same card before its first use: the ONNX Runtime library (Microsoft's own release, MIT, about 10–80 MB, once) and the model (light about 224 MB, full about 973 MB with finer edges). It runs on the CPU: a few to a dozen seconds a photo |

- A download shows its progress and can be cancelled; every file is checked against its SHA-256, and a broken or altered one is not kept. Models come from Hugging Face and the runtime from GitHub, through the proxy given there or else the environment's. *Open the models folder* shows the files; *Delete* (two clicks) removes one.
- With BiRefNet chosen but not downloaded, cutting out says so and offers *Get the model…*.
- The subject goes into a new photo layer, *Cut-out subject*: the same picture with its background removed, lined up with the photo and placed just above the title, so it covers part of the title as on a magazine cover. The photo itself stays as it was.
- **Linked**: the cut-out is linked to its photo. The photo leads (active), the cut-out follows (passive); in the layer list both carry a chain and a leading / following mark in the same colour. Only their place is shared: drag either and both move; size, angle and stretch, and blur, dim, outline, shadow and opacity, are each their own. The cut-out scales and turns about its subject, so the subject stays put; *Line up with the photo again*, in its Place group, puts it back exactly over its photo. Move the cut-out up or down in the layer list to decide what it stands in front of.
- **Soft edges**: a layer with its background removed, or a cut-out, has two sliders in its *Cut-out* group: *Soften in* fades the subject's edge inward (none of the background comes back); *Soften out* spreads the subject's own colours softly outward, like a glow. They can be used together.
- **Weave**: a cut-out can pass in front of and behind the lettering below it, as on a magazine cover where the head stands in front of the masthead and the masthead in front of the body. Tick *Weave with the lettering below* in its *Weave* group, then the lettering layers to weave with: the title, the subtitle, your text and copies of the title and subtitle, those below the cut-out (the title is ticked to begin with). *Automatic (head in front)*: the subject's head stays in front of the lettering and the rest of it goes behind; *Head down to* sets where the head ends, as a share of the subject's height from its top, turning and scaling with the photo. *Letter by letter*: *Choose letters…* opens a window over the sheet on the left with each woven layer's letters, line by line (lettering set in columns, a column a line): click a letter to put it in front of the subject (lit) or behind it; *All in front*, *All behind* and *Every other* do a whole layer at once. A letter in front comes forward whole, with its outline and shadow (in the ransom note, its whole scrap); a plate stays behind. The choices follow each letter by its line and which time it comes in that line, so typing a line above it, or the same letter earlier in its line, moves them. *Brush*, for finer weaving, such as letters passing behind an arm but in front of the body: *Paint…* turns the canvas into a place to paint on, with a small panel over the sheet on the left. Paint where the lettering is to come in front of the subject (*In front*), or take that back (*Behind*); holding Option (Alt) switches between them for a moment, and *Size* sets how wide the brush is. What is painted shows in the channel colour, deeper where it falls on the subject, and the ring under the pointer is as wide as the brush. Each stroke is one step of undo, *Clear all* takes them all away, and Esc or *Done* ends painting; while painting, the canvas does nothing else (nothing is selected or moved there). The strokes are kept in the photo's own proportions, so they follow the subject when it is moved, scaled or turned, and at every size; a crop leaves them where they were. Changing the way keeps what each way was set to. The lettering is painted once, below, and seen through the subject where it is in front, so no edge comes out darker; lettering made partly see-through lets through what lies beneath the subject there (its photo, or the ground); the canvas follows as the subject or the lettering is dragged. Lettering above the cut-out is simply in front of it. The letter window and the brush's panel close as the crop window does. Surprise me leaves the weave as it is, and the cut-out and the lettering it weaves with where they are; a copy of the cut-out keeps it, strokes and all.
- **Assets weave too**: a sticker, a graphic, an image you uploaded or a 3D object has the same *Weave* group (and *Weave* on its bar, as a cut-out has), and weaves the same three ways. It is see-through round itself already, so nothing needs cutting out, and it works in the browser too. *Automatic (top in front)* keeps the top of the asset in front of the lettering and the rest behind; *Top down to* sets where the top ends, as a share of the height of what the asset draws (a round graphic too: whatever lies above the line is in front). The line and the brush's strokes are kept in the asset's own box, so they follow it when it is moved, scaled, turned or stretched, and at every size. The lettering comes through all of the asset: its ink lines and shadow, its colour, and the look effects on it. Surprise me leaves a woven asset, and the lettering it weaves with, where they are.
- Clicking the chain asks whether to end the link; then both are photo layers of their own, where they are. Putting the cut-out's background back ends the link too: it becomes a whole photo again, which can be cut out in turn (and linked anew).
- Deleting the cut-out leaves the photo; deleting the photo deletes its cut-out too. A photo has one linked cut-out: once it has one, the button reads *Cut out again* (to find the subject anew, after changing the way of cutting out, say).
- The cut-out shows its photo's picture: after an AI repaint of the photo is used, or the photo is replaced, it is cut out again by itself.
- *Remove the background* in the properties uses the same recognition: the layer itself keeps only its subject, without a new layer.
- **For some sizes only**: both buttons follow *Applies to* under the canvas. With *All sizes* they do as above. With *This size only*, or *All wide / All square / All tall*: *Cut out subject* makes a cut-out shown at those sizes only, and says so ("Cut out, for 3:4 only", "for the tall sizes only"; a photo whose cut-out is not shown there yet has it shown there too); *Remove the background* leaves the photo as it is, and puts a copy of it with the background removed above it, shown at those sizes only, while the photo is no longer shown there; the other sizes do not change at all. What goes with the photo goes with the copy at those sizes: layers clipped to the photo are copied and clipped to the copy (the copy goes above them, so the photo keeps its own), and its cut-out is copied and linked to the copy, so there the cut-out follows the photo you see and moves with it (one shown at those sizes only is linked to the copy instead of copied). A cut-out or an asset woven with lettering so copied weaves with the copy too. A layout layer clipped to the photo (the title, say) stays where the layout has it and gets a copy of its own at those sizes. *Cut out subject* at a size the photo is not shown at, but such a copy is, cuts out of the copy. A line in the Cut-out group says which sizes they are for. *Shown at* in the Layer group changes it at any time.
- The cut-out is kept with the photo in the cover, and travels with a whole-profile export. A photo with no clear subject says so.

### Generating a photo with AI

*AI generate*, at the top of the *Assets* sheet, opens the AI generate window on its *Photo* tab, where an image model makes a photo. Set one up first under ⋯ → *AI* → *Image model* (see [Setting up AI](#setting-up-ai)); until then the window says so, with *Set up an image model*.

- Across the top of the window: its two tabs, *Photo* and *Stickers & graphics*, and what the tab makes.
- On the left, under *What you want*, describe the photo; or give it a picture to go by under *Reference picture (optional)*: drag one onto the window, or click *＋ Drag a picture in, or click here to choose one*. It goes along with the words, which are then optional. Under them the window names the service and model it goes to; then *Generate the photo*, the wide button at the foot.
- It is made in the shape of the size on the canvas (the top of the window says which). What comes back shows large on the right, on a checkerboard, with what it was made from and which try at those words it is (“vintage rangefinder” · try 2) at its top left and its pixels under it: *Add to the cover*, under it on the right, makes it a photo layer (as an upload: a cover's first photo fills it); *Discard*, at its top right corner, drops it. While the result shown was made from what the form holds, *Generate the photo* reads *Make another*, and makes it again; with a result shown it is no longer in the channel colour, *Add to the cover* is. Every picture made is kept on the photo shelf, added or not.
- **Made this session** — under the result, beside *Add to the cover*, a strip of small pictures, one row that scrolls, of what the tab made since the app was opened, newest first, twelve at most; it grows whether the window is open or not, and is not kept when the app closes. Click one to show it as the result again, its words and reference picture back in the form, with *Add to the cover* and *Discard* as before (*Discard* takes it out of the strip). Not while another is being made.
- It goes on with the window shut. When it is done a note at the foot of the window says so (with *See it*, to open it, when no other window is open); with the window open on its other tab, the *Photo* tab is marked instead.
- The app adds "no text or watermarks, no border" after the description, unless the description asks for text.
- Each picture is charged at the service's prices and usually takes tens of seconds.

### Repainting a photo with AI

Each photo has its own *AI repaint*, under it in *Photos on this cover* (in the *Assets* sheet) and on its bar over the canvas. It opens the AI repaint window, where an image model paints that photo again in another style, one photo at a time. Set up an image model first under ⋯ → *AI* (see [Setting up AI](#setting-up-ai)); until then the window says so, with *Set up an image model*.

On the left, the photo in a compare view as large as the window allows: the *Original* on the left, the repaint on the right, split by a line with a round ‹ › handle. Drag the handle, or press anywhere on the picture, to move the split left and right and compare; with the handle in focus the arrow keys move it too (Shift for bigger steps, Home and End to either side). With no repaint to show, a photo that already shows one is compared with its original; otherwise it is the original alone, with a word on how far the repaint has got. Under it, *Results this session*: each repaint of this photo since the app was opened, the one shown framed (click another to show it), and while one is being painted a tile counting its seconds; beside them what to do with the one shown. On the right, *Paint it as*: the style comes from one of three places:

| Source | What it does |
|---|---|
| Follow the current look | A card with a radio button. Repaints in the cover's look (each look has its own repaint description), with the channel colour as accent; keeps the photo's composition, so the subject stays where and as big as it was and its placement on the cover still fits |
| Built in | Styles that come with the app, one Markdown file each in `ui/repaint-styles/` (how to add one below), a card each, two to a row, with its name and three of its colours; the one chosen is framed in the accent colour. The first eight are shown (the first seven and the one chosen, if it is further down), *All ›* shows the rest; once selected, its description (three lines, all of it on hover) and source show below the cards. For now there is *8-bit pixel editorial*, which distils the photo into a sparse, abstract 8-bit pixel piece: a small cluster of coarse pixel blocks on a wide paper field, or a few broad pixel planes edge to edge. Adapted from [TwentyfiveBTea/8bit-pixel-art](https://github.com/TwentyfiveBTea/8bit-pixel-art) |
| My styles | Your own styles, a chip each: Markdown files of the same kind as the built-in ones, kept in the `repaint-styles/` folder of the app data directory (see below). Once selected, rename, edit or delete it below the chips (deleting takes two clicks); changes are written back to the file as you type |

- The list on the right scrolls when it is longer than the window; the service, the cost and *Repaint the photo* stay at its foot.
- *See the prompt* unfolds a built-in style's prompt; to change one inside the app, edit a copy made with *Copy into my styles (to rename and edit)*.

#### My styles

Beside *My styles*, and after your styles' chips:

- **＋ New style** — a new, empty style (*My style 1*, *My style 2*…); fill in its name and prompt below.
- **⤓ Import .md** — a style file someone shared, or a skill's `SKILL.md`. A file that starts with `---` is kept word for word; one that does not gets a header named after the file.
- **Open the styles folder**, beside *My styles* — shows the folder in Finder (or Explorer). Put files in it or edit them in any editor; the app reads it again when its window comes back to the front.

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
swatch: #3d6fa5 #e8a33d #f6f1e7
credit: optional: where it comes from, and its licence
---

Repaint the attached photograph as a loose watercolour painting …
```

1. **The file name is the style's id**: lower-case letters, digits and hyphens only, e.g. `watercolour.md`. Users' settings remember it, so keep it once chosen; the names can change at any time.
2. **Between the two `---` lines is the header**, one `key: value` per line: `name.zh` and `name.en` are required and are what the chips show; `about.zh` and `about.en` are optional and shown under the chips; `order` is optional and sets the place among them, low first, 100 by default; `swatch` is optional, one to four colours (`#rrggbb` or `#rgb`) shown on its card, three by custom; `credit` is optional and shown as *Source*. A misspelt key stops the build with an error.
3. **After the second `---` comes the prompt**; English works best. Anything in `<!-- -->` comments is not sent. The app adds "no text or watermarks, no border, keep the photo's shape" and the user's extra words after it; to keep the photo's composition, say so in the prompt.
4. **The list is written when building.** `npm run tauri build` / `tauri dev` scan the folder and write `index.json`; `npm run styles` does it by hand. `npm test` checks that the list matches the folder and that every file is well-formed.

- *Anything to add (optional)*, under the styles, goes after any source; then *Repaint the photo*, at the foot of the column. Every source is followed by: no text or watermarks, no border, keep the photo's shape.
- While it runs you can close the window and carry on; the photo's button in *Photos on this cover* says *Repainting…*, and another photo's *AI repaint* is greyed out until it is done (*Stop waiting*, beside the button, gives up on it). When it is done you are told, the button reads *AI repaint · result ready*, and opening it shows the result. A result shown stays in view while another is painted, to be compared meanwhile.
- The result is shown as it comes, over the original; *Use this* replaces that photo (and its copies, such as the cut-out subject), *Discard* takes it out of the results, *Try again* paints another, and *Back to the original* is there afterwards. The results stay under the view until the app is closed or another photo is repainted (every one is on the photo shelf too). A new repaint always starts from the original, so repaints do not pile up.
- The repaint is kept at the original's own width and height in pixels, so the two lie exactly over each other in the compare view and *Use this* changes the picture without moving or reframing it on the cover. The service is asked for the shape nearest the photo's that it paints; what comes back is then scaled and, where its shape differs, cut evenly to the photo's (kept as PNG if the photo is one, else as JPEG). OpenAI's newer models (gpt-image-2) and Seedream paint the photo's own shape, give or take a pixel; OpenAI's older ones (gpt-image-1, DALL·E) only square, 3:2 and 2:3, so a 16:9 photo loses a strip at the top and bottom of the repaint; Gemini paints the nearest of its own shapes (1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9).
- Both the repainted photo and the original are kept on this computer (both are on the photo shelf), and travel with a whole-profile export.
- If the service answers that it does not take one of the optional settings sent (such as the size or the watermark), the app sends the request again without it.
- Each repaint is charged at the service's prices and usually takes tens of seconds.

### Collage: work directly on the canvas

| Action | Result |
|---|---|
| Click | Select the topmost layer |
| Click inside a layout part's dashed frame, with the *Layout* sheet open | Select that part, even one under another layer (see [Which parts show](#which-parts-show)) |
| Double-click | Open the properties drawer |
| Drag | Move |
| Drag a corner | Resize |
| Drag a side | Stretch horizontally or vertically |
| Drag the top knob | Rotate |
| Drag a box on the background, the colour block or a locked layer | Select several: what lies wholly inside is selected; with Shift, added |
| Shift + click | Add an item to the selection, or take it out |
| Drag any item of a selection | Move them together; arrow keys nudge them together, Delete removes the ones you added |
| Scroll | Resize; with Alt, rotate |
| Arrow keys | Nudge by 1; with Shift, by 10 |
| Delete | Remove the selected layer you added (a free layer, or a copy of a layout layer); in the crop window cropping *Free*, the point picked instead, never the layer |
| Esc, or a click outside the canvas | Deselect |
| ⌘D (Ctrl+D elsewhere) | Duplicate the selected free layer, or copy the selected layout layer (all but Background and Corner brackets) |
| ⌘Z (Ctrl+Z elsewhere), with Shift to redo | Undo / redo |

Every layer except Background and Corner brackets can be moved, resized, stretched and rotated.

### One collage, every size

The tray under the canvas is one line where there is room (else *Applies to* goes under the thumbnails): the size shown, what it is called over its pixels (in a slot of its own, so nothing after it moves when you switch sizes); then a thumbnail of every size, named by its ratio (its name and pixels on hover), a click showing it on the canvas; and at its end *Applies to*. How the mouse and keys work is under **?** at the foot of the dock (*Canvas controls*). *Applies to* decides where your change lands:

- **All sizes** — placement is stored relative to the canvas, so one adjustment maps to every size.
- **Same orientation** (where every start begins) — the size on screen and every size facing the same way change together, the others not. The button is named after the group: *All wide* on a landscape size, *All square* on a square one, *All tall* on a portrait one; hover it for the sizes it reaches. Wider than 1.1 : 1 is wide (5:4 too), narrower than 0.91 : 1 tall (4:5 too), anything between square. A move goes as far across each canvas as it does across this one: a tenth of the width on 16:9 is a tenth on 4:3.
- **This size only** — fine-tunes just the size on screen.

Each time the app starts, *Applies to* is on *Same orientation*, whatever it was when you closed it (`settings.scope` in [your own defaults](#your-own-defaults-customjson) picks another: `all`, `orient` or `size`). In *This size only* and *Same orientation*, the channel graphic's placement is remembered per channel. *Applies to* also decides where a change of layout lands (see *Adjusting the template* below), where scene objects go, and what *Reset placement* resets.

### Layers

- The list, in the *Layers* sheet, runs front to back, top to bottom. Drag a row to re-order (the ⋮⋮ grip at its left, under the pointer and on the selected row, shows which can be dragged: every one but the Background's), or use *Bring forward* and *Send backward* under the list. A layout layer dragged to another place among the layout's parts makes that the profile's default order too, for new covers and *Empty this cover…* (see [Which parts show](#which-parts-show)); *Bring forward* and *Send backward* change this cover only. The layout layers stand by default, from the top: corner brackets, title, subtitle, brand logo, brand row, tag, channel name, channel graphic, colour block, background. An earlier profile or cover still in the old default order (never re-ordered by hand) is put into this one when opened, once; the layers you added go with the layout layer each lay directly above, so what was in front stays in front; one re-ordered by hand is left as it is.
- The chips over the list show *All* the layers, or some: *Mine* (the layers you added: photos, text, assets, colours and copies of layout layers) or *Layout* (the layout's own, the background among them), each with how many. While only some are listed a row cannot be dragged to a new place (a line says to show *All* for that); a selected layer the list leaves out stays selected, and is named under the list. The choice lasts until the app is closed.
- Each row starts with what the layer is (photo, text "T", colour as a filled square, vector asset as a pen nib, bitmap asset), then its name, and for the title, subtitle, tag and channel name the words it sets. After them: a linked photo's chain and leading (solid dot) / following (dashed ring) mark, one colour per pair — click the chain to end the link, the leading / following mark to go to the other layer of the pair; *Layout* on a layout layer (it comes with the layout and every cover has it; it cannot be deleted, but can be hidden); *Copy* on a copy of a layout layer.
- At the end of each row, show/hide and lock. They show under the pointer and on the selected row, and always on a layer hidden or locked. Background and Corner brackets carry a 🔒 instead: they are fixed layers.
- A row under the pointer is framed on the canvas.
- Under the list, the selected layer's name, then *Duplicate*, *Bring forward*, *Send backward*, *Delete*, and the button that opens or shuts the properties drawer.
- Layers you added (photos, text, assets, copies of layout layers) are renamed by double-clicking their name (a single click selects, as anywhere on the row): Enter or clicking elsewhere keeps it, Esc does not, an empty name goes back to the automatic one.
- **Clipping masks**: a layer you added (photo, text, asset, colour) can be clipped to the layer below it — *Clip to the layer below* in the *Layer* group of its properties — and then shows only within that layer's shape: a photo inside the title's or a text layer's letters, a colour laid over a silhouette. See *Clipping masks* below.
- **Scene objects**: with *Background* selected, the things a look paints in the background (the ball, the giant letters, the sun, the centre of the radiating lines…) show round handles to drag them by. See *Scene objects* below.
- **Text**, at the top of the *Assets* sheet, adds a text layer; **Colour** adds a colour layer: one block of colour, the canvas's size to begin with (in the channel colour), to shrink, stretch or turn into a ground, a band or a see-through wash. Clicking an item in the *Assets* sheet adds it. New layers go directly above the selected one.
- **Duplicate** (⌘D, or under the list, or at the foot of the drawer) copies the selected layer, a little down and to the right of it. A layout layer can be copied too, all but the background and the corner brackets: the copy, listed as *Title copy*, *Subtitle copy* and so on, shows what the layout's own shows (the title's words, the subtitle, the tag, the brand row, the logo, the channel name, the channel graphic, the colour block) in a style and a place of its own. It is yours, as a free layer is: delete it, rename it, copy it again. The layout's order, *Which parts show* and *Hide every layout part* pass it by (*Empty this cover…* takes it off, with the other layers you added). A copy of a part left out of the cover comes in; a copy of the subtitle still shows while the subtitle itself is left out, and a copy of the logo while the logo is hidden.
- Position, size, stretch and rotation are set on the canvas with the mouse (see the table above).
- **3D layers** — the first button at the top of the layer list (Esc to leave). It takes the cover apart where the canvas was: each layer becomes a sheet of its own, stacked from the bottom up and seen at an angle, each with its name beside it, so you can see what every layer holds and which lies over which. Drag to turn the view; scroll, or use *Spread*, to pull the sheets apart or together; *Reset view* puts the angle back. These are on a bar at the foot of the view, which says *3D layers* and ends with *Leave 3D* (Esc). Click a sheet to select its layer (its settings are in the drawer as ever; the transparent parts of a sheet let the click through to the ones below), double-click to select it and go back to the flat canvas. Pointing at a row of the list lights its sheet and dims the rest; a hidden layer is a faint sheet with a dashed edge. It is only for looking: settings changed in the drawer show at once, and a layer moved in the list slides to its new place, but moving or resizing on the canvas waits until you leave 3D. Opening it ends painting with the weave's brush (see *Weave*), which paints on the flat canvas; opening the brush leaves 3D in turn.
- **Hide every layout part** — a switch at the foot of the *Layout* sheet. It hides all the layout layers at once (background, colour block, title, subtitle, tag, channel name, brand row, brand logo, channel graphic, frame), leaving the photos, text, assets and colour layers you added, and the copies of layout layers; switched off, it brings back the ones that were showing (one you had hidden before stays hidden). It acts on this channel's cover and can be undone.
- **FOCUS** — the switch at the top right of the layer list (shortcut F, Esc to leave). While on, every other layer is dimmed on the canvas and greyed in the list, and none of them can be selected, on the canvas or in the list (a click says why); dragging and scrolling on the canvas (Option to turn) act on the selected layer whatever is under the pointer, and nothing else is moved. To work on another layer, turn FOCUS off first. The canvas gets a dashed frame and a tag naming the layer; a layer that cannot be moved (a fixed built-in or a locked one) is tagged so. With several layers selected, a drag moves them together.
- The properties, in the drawer on the right, come in groups (Text, Effect, Colour, Lines, Plate — or Cut-out, Place, Picture, Lines…). Each is a line with its name: click it to open its controls under it; shut, it says what the group is set to. The first is open to begin with, and each stays open or shut as you leave it. After a rule at the bottom, the Layer group every layer has: opacity, *Shown at* and *Reset placement* (a cut-out has none; its *Line up with the photo again* is in its Place group). Explanations sit behind the ⓘ beside a group's name: hover it, or click it.
- **Shown at some sizes only**: *Shown at*, in the Layer group, is a row of buttons, one for each of the profile's output sizes, named by its ratio (16:9, 4:3, 1:1, 3:4, 9:16…), all lit to begin with. A click takes the layer off that size, another puts it back; one stays lit at least. *All sizes*, *Wide*, *Square* and *Tall* underneath pick a group at once (they are not there when every size faces one way). At a size it is not shown at, the layer is as if left out: not in the export, the thumbnail or the 3D view, not to be clicked on the canvas; a layout layer's room (the subtitle's, say) goes to the others, and the title grows into it. Every layer but the background can be kept so, the subtitle out of 9:16 for one. In the layer list, a layer kept to some sizes has a label after its name, such as *Only 3:4*, *Only tall* or *Not 9:16*, and its row is greyed at a size it is not shown at. A layer clipped to one not shown at a size is not shown there either: its row is greyed there too, and in its *Shown at* those sizes are dashed, with a line saying why. A size added later shows only the layers shown at every size; a size removed leaves a layer shown at it alone *At no size*, to be lit again, and a layer shown everywhere but there is from then on shown at every size, a size added later included (at once, as after opening the app again; undone, every channel's layers are as they were). *Copy from another channel* keeps the sizes, those this profile has; from another profile, whose sizes may be other pixels of the same shape, a size this one does not have goes to its sizes of the same ratio (1920×1080 there is 1280×720 here), else to those facing the same way, and a layer that would be left at no size is shown at every size; a placement for one size goes the same way. Surprise me places your layers by the sizes they show at.
- Colours take a row each, as checkboxes do: the swatch, its name, then *Automatic* (following the look and the channel colour); once you pick a colour it reads *Back to automatic* — click it to return.
- The sheet and the drawer are resized by dragging their edge with the canvas (the sheet at least 280 px, the drawer at least 260 px, the canvas keeps 360 px; these and the default widths are in [your own defaults](#your-own-defaults-customjson)); double-click an edge for the default width. Widths are remembered.
- A vector asset (stickers, frames, channel graphics, AI assets) has *Colour*: its own colours, the channel colour, or a colour of your own.
- Every asset, vector or bitmap, has *Crop*: *Crop…* keeps only part of it, as with a photo, to a rectangle or a shape of any outline (*Free*; see *Photos*).
- Every asset has *Weave* too: it passes in front of and behind the lettering below it, as a cut-out does (see *Weave* under *Cutting out the subject*), in the browser as well.

What each layer allows:

| Layer | Move / resize | Hide | Re-order | Delete |
|---|---|---|---|---|
| Background | no | yes | no | no |
| Corner brackets | no | yes | yes | no |
| Colour block, channel graphic, brand row, title, corner tag, channel name | yes | yes | yes | no |
| Stickers, images, photos, text, colour (free layers) | yes | yes | yes | yes |
| Copies of layout layers | yes | yes | yes | yes |

### SURPRISE ME: deal a new hand

**SURPRISE ME**, beside *Export* in the top bar, or Space from the editor (see *Keys* under [The window](#the-window)), draws at random everything about how the current cover is drawn, the layout left as it is (unless layout presets have a chance in its chances, see *Layout presets* below):

- the look, as likely as its chance (see *Surprise me's chances*), its sliders and its random placement: each slider near the value the look was made with, and the parts a look leaves out by default (an airship, a giant silhouette, a laser) only now and then, two at most; now and then the look's scene objects a little off where the layout puts them
- dark or light ground, as likely as its chance, the same for every look (until you set it, kept away from a channel colour near black or very bright, near white or a light yellow, which would sink into a ground like it); the shape of the colour block
- the title's text effect, outline and shadow, and its bend: each as likely as its chance, the same for every look (see *Surprise me's chances*); by default the look's own lettering most of the time (the dark deco's lit lamps, cel's outline and shadow…), otherwise outlines, stickers, depth, worn type, torn or scissor-cut edges and the rest about as often as the looks' own combinations give them (the reshaped edges only in the desktop app), and bent now and then; until you set them, a long title (a line wider than 8 characters, or three lines) is bent less and less often given a sticker's rim or depth, so its type stays large, a short one bent a little more
- the subtitle lettered like the title half the time (by default), else mostly in the look's own
- each text layer's plate, text effect, outline and shadow; whether a sticker follows the channel colour
- the look effects of the layers you added (text, stickers, images, photos, colours): one or two, mostly the drawn look's, now and then another look's
- the photos, text, assets and colours you added get a new place, angle and size (copies of layout layers stay where they are): anywhere on the canvas, but wholly on it at every size, not a pixel off, and your text layers above the bottom 14% (above the badges on a landscape cover), but for a weave (a cut-out or an asset woven with lettering, and that lettering), which stays where it is so it still shows; where they leave the title and any cut-out subject uncovered, as far as they can (one that would still cover much of them is made a little smaller, to half its size at most); a photo takes its cut-out subject along, the subject still lying over it; one too big to fit is set straighter, then smaller
- text you moved or resized goes back where the rules put it: the title, subtitle, tag, channel name and brand row to where the profile's design has them, your own text layers to a new one's size before they are placed again
- the title goes to the top of the layers, over everything else (with whatever is clipped into it), so nothing dealt lies over it; only a subject cut out of a photo that stood over the title still does, as on a magazine cover, and so does an asset woven with the title

**Left alone**: the template, how much the colour block takes, the slant of its edge, whether the halves are swapped, each size's own layout, and where the layout layers stand (colour block, channel graphic, corner brackets; the words among them go back to the design, as above) — a hand dealt a layout preset has the preset's instead (but for a locked colour block, which keeps its layout); the words of the title, subtitle and tag, the current channel and every channel's colour, the photo layers' pictures, which layers exist (none added, none removed), custom lettering colours, locked layers, a woven cut-out or asset and the lettering it weaves with (see *Weave*), a photo or a colour filling the canvas.

It deals six hands at a time, each in a look of its own (unless fewer than six looks have a chance), and puts the first on the canvas. How likely each choice is, you set in Surprise me's chances (see below): the hands are not scored, and nothing is learnt from what you keep. The button reads *Dealing…* meanwhile.

Each deal is one step of undo, however fast you click. Deal again if you do not like it, or undo to the hand before.

It deals in a window over the whole app, the cover dimmed behind it. Each hand shows as it comes, as large as fits (in two, three or six columns, by the size's shape), drawn at the size shown, with its look and, under it, its ground (for a look with two), its title's lettering and its layout (the layout preset it was dealt in, or the template); then the first is marked *✓ On the canvas*, and it is the one on the canvas. Click another hand to put it on the canvas instead, its layout with it (still one step of undo). On the bar under the hands, *Leave alone next time*: the *Look* (and its sliders), the *Ground*, the *Lettering* (the title's, subtitle's and text layers'), the *Places* (every layer stays where it is, moved words too, and the layout stays the canvas's, whatever the layout presets' chances), the *Layout* (the canvas's layout in every hand, no layout preset dealt whatever their chances, as with *Keep the canvas's layout* at 100%; everything else is dealt as ever — with *Places* locked it shows locked too, and cannot be pressed); each is remembered for the next deal. Then *Chances*, which opens Surprise me's chances, *Deal again* (Space does it too) and *Done*. *Done*, or a click on the dim round the hands, closes the window and keeps the hand on the canvas. Esc, or *Undo the deal* at its top right corner, puts the cover back as it was before the window's first deal and closes the window (redo takes it again). While it is open, no other key reaches the cover but Space, undo and redo.

**How Surprise me deals this look**, folded under *Tune this look* in the *Look* sheet, sets how often each of the current look's optional parts comes in when the look is dealt (its switches, and the sliders off by default), each on its own, for every profile; *Restore this look's recipe* puts the built-in chances back, and *All the chances…* opens Surprise me's chances.

**Surprise me's chances**, opened by *Chances* in Surprise me's window (or *All the chances…* in the *Look* sheet), is a window of its own listing how likely each of Surprise me's choices is, for every look and every profile, kept on this computer. The looks are on the left, the groups of which one is dealt on the right, the switches under them:

- **Looks**: a card each, with this cover drawn in it, its name, its share and a row of dots. The leftmost dot is *Off* (never dealt); then each dot more makes the look twice as likely, each dot less half as likely, and every look stands on three to begin with. Click a dot, or use the arrow keys on the row (Home turns it off, End gives it every dot). A chance set before there were dots shows on the nearest dot and stays exactly as it was until you change it, so the hands are dealt as before; a key that leaves the dots where they are (at either end of the row) leaves the chance as it is too. The last look with a chance cannot be turned off: a note says one must keep a chance. The eight likeliest show until *n more looks ›* unfolds the rest (*Show fewer* folds them again); *All*, *More likely* and *Off* show every look, those above three dots, or those off; *Even out* puts every look back on three dots, *Restore* puts the looks' chances back.
- **A look's optional parts, when it is dealt**, under the looks: pick a look and set them, as under *How Surprise me deals this look* in the *Look* sheet (the same settings).
- **Groups of which one is dealt** (*One of each group is dealt · drag the white dividers*): each is one bar adding up to 100%, split into its options, each as wide as its chance and showing its name and share where they fit (hold the pointer over one to read them). Drag the white divider between two options to move share between those two alone, the others staying as they are; a divider clicked, or reached with Tab, moves with the arrow keys too (by one point, with Shift five; Home and End all the way). Where options at 0% leave several dividers together, the one dragged right is the rightmost and the one dragged left the leftmost, so an option at 0% can be given a share again. A long group shows its likeliest options and the others as one segment (*n others*: dragging its divider changes them together, each keeping its share of it) until *Show all n* unfolds it, every option then on the bar and named under it with its share. *Even out* gives every option the same; *Restore* puts the group back. The groups:
  - **Which layout**: *Keep the canvas's layout* and each preset you saved; to begin with the canvas's own has it all, as before, and a new preset starts at 0%. The presets themselves are made, edited, put on the canvas and deleted in the *Layout* sheet (*Go to Layout*, at the group's foot). See *Layout presets* below.
  - the *Ground* (dark or light), *The title's lettering* (the look's own, or each other lettering), *The title's bend* (none, or each bend), the *Colour block shape* (alike to begin with), how many *Look effects on other layers* a layer but the title and subtitle is given (none 45%, one 33%, two 22%), and whether each *comes from* the look dealt (60%) or another look. The lettering, the bend and the ground are the same for every look; to begin with they are what the looks' own combinations give on average, and the title's length and the channel colour still turn them as above; once you set one, it is dealt exactly as set. An option at 0% is never dealt.
- **Switches**, each on or off by a chance of its own, a slider each: the brand row's rail (80%); a plate under the channel name (75%), the subtitle (30%), a text layer (35%); an asset tinted the channel colour (50%); the scene objects moved a little (40%); the subtitle lettered like the title (50%); and, for a look that sets none of its own, a part off by default coming in (35%), a switch on by default staying on (75%), one off by default coming on (30%).

*Restore all* puts back the looks, the groups and the switches; each look's optional parts stay until restored there. *Done* closes the window (Surprise me's stays open, for another deal).

**Layout presets** are where things stand on a cover, at every size, and nothing else: where the title, subtitle, tag, channel name, brand row, channel graphic and colour block stand (*This size only* tuning included), which of them the layout has (a part unticked is hidden where the preset is applied or dealt; one may be ticked at some sizes only), and the colour block at each size — the side it lies on (a band along the bottom or the top, a panel on the right or the left), how much it takes and how its edge slants. Not the fonts, letterings, colours, the look, or which way words run. The block is kept for every size, for each orientation (wide, square, tall) and for single sizes: a size of the profile's that the preset does not name is drawn as the preset draws the sizes facing its way, else as it draws every size; a part stands there where the preset puts it at every size. The channel graphic stands where the preset puts it on every channel's cover (moved on one channel's cover before it was saved, it is saved where it stood there, for all of them). A hand dealt a preset has exactly its structure at each of the profile's sizes, and everything else is dealt as ever: the look, the ground, the block's shape and the letterings, your layers' places. A part you locked stays as it is, dealt or applied: where it stands and whether it is shown; the colour block locked keeps its layout as well (its side, size and slant at every size), the preset's block not put on. A part hidden by its eye is still in the layout: saved, it counts as shown; applied, it stays hidden. Presets are for every profile, kept on this computer, 24 at most. One saved before still applies as it did (a slim band, *Banner*, included), but for which way its words ran, which is let go; one saved before the colour block was a part leaves the block's place, and whether it is shown, as they are.

They are listed in the *Layout* sheet, under *My layout presets*, a card each: rename it where it is (Enter keeps it); *Apply to canvas* puts it on the cover (the colour block at each of the profile's sizes, for every cover of the profile, unless the colour block is locked; the parts' places and which are shown on this channel's cover, but for those locked; sizes of the preset's own that the profile has not are passed by; one step of undo); *Edit…* opens the layout editor; *Delete* asks first, and its chance goes alike to the options not at 0% (all at 0%: back to the canvas's own at 100%). Hold the pointer over a card and a moment later the canvas shows the cover laid out by that preset, as *Apply to canvas* would leave it; the card says *Previewing*, and a tag on the canvas says that *Apply to canvas* puts it on. It is only on the canvas, never saved nor a step of undo, and ends when the pointer leaves the cards or the sheet is drawn again (*Edit…* and *Delete* end it first).

Lay out a new one with *＋ New…*, beside *My layout presets*: to begin with, all seven parts in it (the channel graphic on the block), each orientation in its default layout (see *Default layouts* under [Adjusting the template](#adjusting-the-template): wide sizes side by side, tall ones stacked, square ones a banner). The **layout editor** (*Edit…*, or *＋ New…*) is a window of its own, with a canvas unrelated to the cover you are editing: the plainest look (*Cel*), no photos, none of your layers, placeholder words ("Your title here / second line", "Your subtitle goes here", "EP.01"), your brand row, the channel's name and graphic, and the colour block. In its head, *New layout preset* or *Edit layout preset* with the preset's name; *Applies to*: every size, those facing the size's way (what the editor opens on, so wide sizes and the others are laid out apart), or this one only; then *Cancel* and *Save*. Under the canvas, *This layout at each size*: the profile's sizes, then the preset's own, each drawn as the preset has it, a click taking the canvas there (*＋ Size*, a width and a height: dashed, with × to remove; applying and dealing use only the sizes the profile has). Drag a part to move it; drag a corner or scroll to resize, a side to stretch, the top knob to turn. The colour block has no template list or sliders: click it, then drag the diamond in the middle of its edge to make it bigger or smaller, an end's diamond to slant the edge, or the block itself up, down, left or right to move it to that side. Where *Applies to* reaches sizes facing other ways (*All sizes*, say), each block takes the change as its own: dragged to the side across, each goes to the side across from its own (a panel on the right to the left, a band along the bottom to the top); to a side beside, all go there; bigger, smaller or slanted, each by as much of its own block, not by a panel's share of the width put on a band. A size with a block of its own says so, and *Follow again* lets it go. On the left: *Parts in the layout*, a tick each (a tick lands as *Applies to* says; *some sizes* beside one ticked at some sizes only; the part selected, unticked at the size shown, is no longer selected, so the block's diamonds go with it), and *Reset its place* for the part selected. With the colour block selected, *Where the block lies at* the size shown has a button for each side, *Bottom*, *Top*, *Right* and *Left*, each doing what dragging the block to that side does, as far as *Applies to* reaches; then *Reset size and slant* (its template's default size and slant, on the side it is); its place is its side, so it has no *Reset its place*. Dragging the block still moves it. Only the preset changes there, never the cover on the canvas; *Save* keeps it, *Cancel* (or Esc, or a click outside) lets it go, asking first when something was changed; either goes back to the *Layout* sheet.

### Title and text layers

Add a text layer with **Text** at the top of the *Assets* sheet. The title, the subtitle and text layers are the same kind of thing with the same properties, look effects included (and clipping masks, but for the subtitle); the title's *Text* is the title in the *Content* sheet, the subtitle's the subtitle, so either can be changed. The title and subtitle are still layout layers: neither can be deleted, and each one's default place follows the layout. *Duplicate* makes a copy of either (see *Layers*): the same words, in a lettering and a place of its own. Top to bottom:

| Property | Decides |
|---|---|
| Text | One line is one line; words in `*asterisks*` take the highlight colour. The title's and subtitle's text are the ones in the *Content* sheet |
| Font | see the next section |
| Vertical, Column rules | set in columns, as a Song-dynasty printed book, and the columns ruled; see [Title](#title) |
| Text effect | how the letters are drawn; see [Text effects](#text-effects) |
| Lettering colour, highlight colour | see [Lettering colours](#lettering-colours) |
| Outline, Shadow | how thick and how far; the one the current text effect does not draw is greyed out. Their colours are automatic: the outline is ink on a dark ground and white on a light one, on a plate the colour that stands against the lettering; in the shadow ordinary words take the highlight colour and highlighted words the lettering colour. A note under the sliders says so |
| Plate | *On a plate* sets the words on a block of colour; then *Plate colour*, the channel colour by default. The plates are drawn in the look's way. On a plate, lettering colours left automatic take whichever reads against it |
| Highlight style | how the words marked with `*asterisks*` are marked besides their colour: *Colour only*; *Plates*, a plate under each of them (the words then in what reads on it); *Ring drawn round*, a quick loop round them as with a pen, a little wobbly, its ends passing each other; *Marker*, a highlighter's band through their lower half, slightly slanted, its edges uneven, its end cut on a slant; *Offset block*, a block of colour set off down and to the right behind them. Under a band or a block the words keep the lettering's colour, since they are partly on the ground. Then *Highlight style's colour*, the channel colour by default (ink or white when the whole plate is that colour already). Any of them goes with *On a plate*, any effect and any bend |

Text layers of earlier versions are carried over: white becomes automatic, ink and custom colours become the lettering colour, the channel colour still follows the channel; on a plate, the old colour becomes the plate's colour, without an outline or a shadow, as before.

### Fonts

Every layer that carries words (title, subtitle, corner tag, channel name, brand row, text layers) chooses its own font. Select the layer and choose in the *Text* group of its properties, or click its font's name on its bar over the canvas:

- **Default** — the bundled face, following the current look (a serif under Woodblock book, say). New layers start here.
- **Recent** — the fonts used last, to reuse on other layers.
- **Built-in** — Noto Sans SC, Bebas Neue, JetBrains Mono; the same on every platform.
- **Imported** and **System fonts**.
- The last entry, **＋ Add a font file…** — pick a font file: it is stored in the app and used on this layer at once, and from then on every layer finds it under *Imported*.

A font marked *no Chinese* has no Chinese glyphs: choosing it changes Latin letters and digits only, and Chinese stays in the default face. To change the Chinese, pick a font without the mark (PingFang, Songti, Kaiti…). Imported fonts are not checked.

Imported fonts live in this computer's app data. Exporting a profile packs the imported fonts it uses into the file, and importing it elsewhere installs them; a font that did not come along shows as "not on this computer" and the default is used.

### Text effects

The title, the subtitle and every text layer (with or without a plate) can be given a text effect of their own instead of following the look. Select the layer and open the *Effect* group of its properties, or *Effect* on its bar over the canvas. Each effect is a card showing the layer's first letter drawn in it, in the layer's font and colours as the cover's look letters it: *Auto · the look's* first, then the effect the layer has, then the others. On the bar's popover they are one row, six in sight: scroll it sideways (or turn the wheel over it) for the rest, or click the arrow at an end where there are more, the cards fading out under it. In the drawer they are three to a row, six of them until *See all 18 effects* unfolds the rest, *Show fewer* folding them. Hold the pointer over a card (*Hover to preview it on the canvas*) and a moment later the canvas shows the layer in that effect, only there and until the pointer leaves the cards or the cards are drawn again, as any change to the layer draws them (a tag on the canvas says which, and the bar over the canvas stays where it is meanwhile); click the card to put it on, one step of undo. A card's picture is drawn once it comes into sight, and kept while the letter, the colours and the look stay as they are.

| Kind | Effects | Notes |
|---|---|---|
| Automatic | follows the look | The default: the current look's own lettering |
| Layered | sticker, outline and shadow, plain, plain upright, underlined highlight, extruded | General letterings. Sticker: the letters run together on a thick white rim with a dark line round it and a hard shadow under it, as on variety shows' captions (the *Outline* slider sets the keyline round the letters, *Shadow* the shadow). The underlined highlight underlines the highlighted words; extruded gives the letters real depth, from each letter's outline |
| Masked | halftone inside, stripes inside, inner shadow, worn, row shift | Change what is inside the letters |
| Outlined | spiky, torn edge, scissor-cut, melting, puffed up, eaten away | Reshape the letters' own outlines (desktop app only). Spiky: thorns along every edge, outward, each of its own length and spacing, shorter into the holes. Torn edge: the edge wanders in and out, in long waves and fine teeth. Scissor-cut: curves become runs of straight cuts a little off the line, each letter laid down slightly askew. Melting: the undersides sag and run down in drips from the lowest of them. Puffed up: the letters grown all round, every corner rounded. Eaten away: pits bitten into the edges, and a fine grain along them. All but puffed up have *Reshuffle* |
| Letter by letter | ransom note | Each letter as if cut from another paper: a face, a scrap of paper, an ink, an angle and a size of its own, one letter of each line of three or more larger, on the channel colour (unless the letter before it is). *Reshuffle* deals every letter again; *Letter by letter…* opens a window to dress them one by one |

**Bend**, a group of its own under *Effect* (and *Bend* on the bar), bends the lettering, whichever it is — the look's own (Automatic), any effect above, plates and marks under highlighted words, the look effects of the next section laid over it: arched, arc down, on a circle, arched top, bulge, pinch, fisheye, rise, tapered, wave, flag, with *How far*. The line is painted as it would be and that picture is bent, so a dark deco title stays lit lamps and a chrome one chrome, arched; and it works in a plain browser too. The size follows the bent shape, so a bent title stays inside its box, clear of the brand row and the subtitle. Covers made before, whose title or text had one of these as its effect, open as *Outline and shadow*, bent the same way. Lettering set in columns is not bent (see *Vertical* under [Title](#title)).

With *Tapered*, diamond handles appear at the corners of the lettering on the canvas: drag any of them to set the perspective freely (the whole block is reshaped to the new quad); *Reset the perspective* in the properties goes back to the default. The title, subtitle and text layers all have it; with corners of its own a tapered title is the size it was, for you to place.

Every other bend can be reshaped by hand the same way: four diamond handles lie along the top of the lettering and four along its bottom, where the bend puts them. Drag one and the edge under it follows the pointer, the rest of the lettering smoothly with it (several lines move as one block); *How far* still applies, and *Reset the shape* goes back to the bend as it was. The size stays what the bend alone gives, and the plate and the selection take in where the handles went.

The bends, line by line: *Arched* lifts the middle of the line and *Arc down* lowers it; *On a circle* lays the line round a circle below it, the letters fanning out; *Arched top* keeps the baseline straight while the tops arch up toward the middle; *Bulge* makes the letters taller toward the middle and *Pinch* shorter; *Fisheye* enlarges the middle as a lens would, easing off toward the ends, which stay about where they were; *Rise* climbs to the right with the upright strokes kept upright; *Wave* runs a wave along the line and *Flag* waves it like a flag on a pole at its start, more the further from the pole. *How far* sets how far each goes.

Sliced, Overprint, Double keyline and Sunlit block were here once; they are their looks' post effects now (Three slices, Second-ink overprint, Two-tone outline, Sunlit block), under *Look effects* (next section), and go with any text effect. A text layer that chose one of them here before is given the matching post effect when opened; a title's earlier choice is painted as *Automatic*, and kept.

Masked effects, Extruded, the outlined effects and the ransom note have a *Strength* slider (for the outlined effects: how far each goes, how long the spikes are, how big the tears and drips; for the ransom note: how far its letters turn and shift, and how often a Latin letter changes case). The *Outline* and *Shadow* sliders of the title and text layers can be moved only when the current effect draws an outline or a shadow: Plain, Plain upright and some looks' letterings have neither; otherwise the slider is greyed out and says why.

Extruded and the outlined effects read the font file to get each letter's outline, so they need the desktop app; in a plain browser they show as ordinary lettering. The first time a piece of text is used it shows as ordinary lettering for an instant and then changes; an export waits for the outlines before drawing. Bundled fonts, installed fonts and fonts you imported are supported.

Each letter of an outlined effect is reshaped by a seed of its own: the letter, which of its kind on the line it is, the line, and the layer's own seed. So the same words come out the same every time, in the preview, the export and at every size. *Reshuffle*, under the effect, deals each letter other spikes, tears, cuts, drips or bites; until then it stays as it is. Puffed up has nothing to deal.

The ransom note dresses every letter and digit of the line; spaces, punctuation and emoji stay as the line sets them. Most letters sit on a scrap of paper (black, white, newsprint, kraft, the channel colour, the highlighted words' colour, a yellow) in an ink that reads on it; some are in the layer's own colours, with its outline and shadow, and a few are hollow, paper inside an ink rim. Neighbours never share a paper, nor a face unless only one has the letter. Each letter stays in the place and width the layer's font gives it, so the type size, the cover standards' size check, bends and highlighted words work as with any lettering, and the letters are the same at every size. The faces are the bundled fonts and the system fonts installed on the computer (on a Mac: Georgia, Didot, Impact, Futura, Rockwell, American Typewriter…, PingFang, Songti, Kaiti, Yuanti, Libian…; on Windows: Arial Black, Impact, Microsoft YaHei, SimSun, KaiTi…), so the same cover may show other faces on another computer; a face without a letter gives way to the next. System fonts that macOS downloads on demand (most of its Chinese ones) or that you installed are read from their files in the desktop app, at most four Chinese and four Latin; the first time, their letters show in a stand-in face for a moment. A stretch of another script (Arabic, Hebrew, Devanagari…) is set as the line sets it. In columns the letters are dressed as in a line, the Chinese ones upright on their scraps.

Besides scraps of paper, by chance a letter may stand in depth (laid back down and to the right, darker as it goes, its face in a paper colour), be cut from the cover's photo (on a white rim; only when the cover has a photo), sit on a scrap torn along a side or two (the paper's lighter fibres showing), or be taped down (a strip across the top or a corner).

*Letter by letter…*, under *Reshuffle* in the properties, opens a window over the sheet on the left for this layer's letters, the canvas left in view. At its top, the switches *Torn edges*, *Tape*, *In depth* and *From the photo* say whether each may come up by chance on this layer.

Below them is a strip of the layer's letters, one row a line, each shown as it is drawn (its face, paper and ink, its angle); a dot marks a letter dressed by hand, a square a locked one. Click a letter to dress it yourself: its *Kind* (on a scrap, no scrap, hollow, in depth, from the photo), *Face* (the faces installed that have the letter), *Paper* (or the *Front colour* of a letter in depth) and *Ink*, from the layer's papers and inks or any colour, *Size*, *Angle*, *Up or down*, *Case* (Latin), its scrap's *Edge* and *Tape*, and whether it is a *Hero* of its line (letters made heroes by hand are the line's only heroes; *No* keeps the chance hero off it). Whatever is left *By chance* still follows the dealing, and setting one thing changes nothing else of the letter but what follows from it (a kind's paper, a paper's ink). *Deal this one again* deals that letter alone anew; *Lock* keeps it exactly as it is when you *Reshuffle* the rest; *Back to chance* forgets what was set for it, and *Every letter back to chance* for all. A letter is known by its line, itself and how many times it came before in the line, so what was set for it is the same at every size and stays with it while words after it change (a line, or the same letter, added before it passes what was set on to another letter); every change is a step of undo. What was set is kept if you choose another effect, and comes back with the ransom note.

The window follows its layer: it is drawn again when the words, the colours or the letters change (an undo too). Esc, *Done* or ✕ closes it, and so does selecting another layer, choosing another effect for this one, or opening Settings or Surprise me.

### Look effects on your own layers

A look's material effects can be put on a layer you added — text, asset, photo or solid — and on the title, which takes the same effects as text. With the layer selected, its properties have a *Look effects* group in two parts:

- **This look**: the effects the current look opens to that kind of layer. Each is a slider; at 0 it is off. Some have settings of their own: the riso's *Halftone*, once on, shows *Halftone size* under it.
- **Borrow from other looks**: *Borrow from other looks…* opens a window showing each look with the effects it has, each in a dashed box; click the looks to borrow from (several at once) and confirm, and their names and sliders are put in below. Looks already borrowed come ticked; unticking one takes its effects off this layer. *Remove* after a look's name takes away every effect borrowed from it. Effects on the layer that are not the current look's are listed here too, under their own look.

*Clear* after a look's name sets that look's effects back to 0 and keeps the group; a borrowed look also has *Remove*, which takes the group away. At the foot, *Clear all look effects* sets every effect back to 0 and keeps the borrowed looks; *Remove all look effects* removes every borrowed look and sets this look's effects back to 0. With nothing to clear, the buttons are greyed out.

The effects stay with the layer: under another look they still apply, and move to *Borrow from other looks*. Each layer's random detail is its own, so every size, the preview and the export agree. *Surprise me* deals these layers new effects, mostly from the look it drew, now and then from another.

All 35 looks have effects. Those marked [photo] are offered on photo layers only; the rest suit text, asset, photo and solid layers alike. Look effects all work on a layer once it is painted, so on a text layer they go with any text effect. An effect that repaints the shape, such as a silhouette or chrome, follows the subject on a photo whose background was removed, and takes a plain photo as one block.

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
| Silent wasteland | painted in strokes [photo] (painted over in brush strokes of its own colours, broad where it is flat and fine where it has detail, along its edges), dry-brush edge (dragged once more through a dry brush, its edges breaking into hairs, its face streaked), lost in haze (sinking into the mist toward its foot), low sun behind (a red disc and its glow behind the layer, a bar of cloud across it), wasteland grade [photo] (into the painting's palette, its shadows lifted as haze lifts them) |
| Origami noir | folded facets (with the facet size: the layer cut into flat triangles of its own colours, each turned a little to or from the light, the same in the preview and the export; on lettering its neon tubes kept crisp), neon outline (a tube of the channel colour round the layer, glowing), blind light (slanted bars of lamplight across it), rain-night grade [photo] (the blacks crushed, teal and amber, a strong red kept) |

### Clipping masks

A layer you added (photo, text, asset, colour), and the title, can be clipped to the layer below it: select it and tick *Clip to the layer below* in the *Layer* group of its properties. It then shows only within the shape that layer paints, and is as see-through as it is:

- put a photo above the title or a text layer and tick it, and the photo is inside the letters;
- put a block of colour above a silhouette asset and tick it, and the silhouette takes the colour; move the colour to tint part of it only.

Several layers in a row can be clipped to the same layer, and show within it together. The layer below is their *base*: hiding it hides what is clipped to it (so does keeping it to some sizes, see *Shown at*), and dragging the base or a layer clipped to it repaints the group as one. With only the background below, the tick changes nothing (the background covers the canvas). In the layer list a clipped layer is indented, with "↓" before its name, and hovering it says what it is clipped to.

### Scene objects

Some of the things a look paints in the background can be dragged where you want them: select the *Background* layer, and handles show on them (white rings edged in black, to read on any ground). Drag a handle to move its object; double-click it to put the object back. While dragged, only the ground is repainted, in draft; the full picture follows when you let go.

- Positions are kept on this cover, per look: change the look and back, and they are where you left them; other covers are not touched.
- What is kept is an offset from where the layout puts the object (in proportion to the canvas), so it follows when the template or the size changes. As with layers, whether all sizes or this one change follows *Applies to*, under the canvas.
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
| Silent wasteland | low sun, megastructure, power poles, smoke plume, lone figure |
| Origami noir | neon letters, hover craft, light shafts, folded figure |

### Lettering colours

Every layer made of words can be given its own colour. Select the layer and look in its properties (or click the round colour button on its bar):

| Layer | Colours you can set |
|---|---|
| Title, subtitle, text layers | lettering colour, highlight colour (for words in `*asterisks*`), and on a plate the plate colour |
| Corner tag, channel name, brand row | lettering colour |

Without one a layer shows *Automatic*: the colour comes from the current look and the channel colour, and follows when either changes. Once set, the colour stays as it is; *Back to automatic* clears it.
The plates themselves (behind the tag, behind the channel's sub-name) are not included: they still follow the channel colour.

### Profiles and channels are independent

Each channel of each profile has a cover of its own: its title, tag, photos, text and every layer belong to it alone. What you change on channel A never shows up on channel B, and what you change in profile A never shows up in profile B.

- Click a channel in the *Content* sheet, or pick one from the channel menu in the top bar, to show that channel's cover. A channel opened for the first time starts a new cover: the profile's default design and a default title.
- Switch to another profile and back, and you are on the channel you left, its cover as it was.
- Covers are saved as you go; there is nothing to save by hand. Undo starts afresh when you switch channel or profile.
- What a profile's channels share is the profile itself: its look, output sizes, brand and default design.
- Assets, the photo shelf and the vector assets alike, are shared by every profile; see [Assets](#assets) below.
- **Copy from another channel…** — the link at the foot of the *Content* sheet. Pick a profile and a channel (the whole cover is shown below, at the size on the canvas), and everything but the layout layers on that cover (photos, text, assets, colour layers, cut-outs and their links, copies of layout layers included; the dialog counts them by kind, the copies as *Layout copies*) is copied into this cover with its settings. A cut-out or an asset woven with lettering weaves with the copies of it, and with this cover's own title and subtitle; what was painted with the weave's brush comes with it. Each item goes above the layout layer it was above there, so what is in front of what stays as it was; what this cover has stays, and the copy can be undone. From another profile, the sizes an item is shown at, and its placement for one size, go to this profile's sizes of the same ratio, else of the same orientation (see *Shown at some sizes only*).

Earlier versions kept one cover, whose layers could be kept to some channels. The first start after updating splits that cover among the current profile's channels: each layer goes to the channels it was on, and the title and tag are copied to every channel; the old file is kept as `session.migrated.json`. Photos uploaded before all appear on the photo shelf, in the *Assets* sheet.

### Assets

The *Assets* sheet holds everything that goes on a cover. At its top, four ways to add: **Text** (a text layer), **Colour** (a colour layer; see [Layers](#layers)), **Upload photos** and **AI generate** (see [Photos](#photos)). Under them, the search field (see *Searching* below), then *Photos on this cover*, when it has any. Then the shelves, each with its name and how many it holds; a long one shows its first two rows, *All n ›* the rest (*Show fewer* folds it again). Everything on them is shared by every profile and every channel. Vector assets are shown in the current look and the channel colour, and once on the canvas they follow the channel colour by default too (the layer's properties can give one its own colours or one of yours).

- **Photo shelf** — every photo you upload, every picture AI makes and every AI repaint is kept here by itself, its source marked on the thumbnail (Upload / AI made / AI repaint); importing a whole profile adds the photos in it too. *Upload to the shelf only…*, beside its name, uploads photos onto the shelf without putting them on the cover (several at once if you like).
  - Click one to add it to the current cover as a photo layer; drag it onto the canvas to put it where you let go. Added, it is listed under *Photos on this cover* like any other photo.
  - The × on a thumbnail's corner (on hover) takes it off the shelf; covers already using it keep it.
  - An AI repaint never changes the photo it started from: the result is a new picture, and the original stays on the shelf.
  - When the shelf holds pictures of more than one kind, chips over them show one kind alone: *All*, *Uploaded*, *Made by AI*, *Repainted*, each with how many.
- **Stickers** — a free pack of 72, in the channel colour by default, or in their own colours or one of yours. Shown whole, they are in groups; the first is twelve *Frames*: square, rectangle, circle, triangle, rounded rectangle, pentagon, hexagon, octagon, star, parallelogram, trapezoid and semicircle — thin geometric outlines, empty in the middle, to go round a photo, a word or a face, their line drawn the current look's way.
- **Channel graphics (in the channel colour)** — twenty cel-shaded graphics that follow the channel colour.
- **My vector assets** — assets made with AI and kept, whichever profile and channel they were made on.
  - *＋ New folder* makes a folder and lets you name it; double-click a folder's name to rename it later. Drag an asset onto a folder to file it, onto *Unfiled* to take it out. ▾ / ▸ closes or opens a folder.
  - Deleting a folder takes two clicks on its ×; its assets are not deleted but go back to Unfiled. Folders are kept on this computer and do not travel with profile exports.
- **AI stickers & graphics** — the last, opening the AI generate window on its *Stickers & graphics* tab; it says when one is being made, or waits for you there. See the next section.

**Searching**: type in *Search photos, stickers, graphics* and, while it holds words, the sheet shows what they find instead of the photos on this cover and the shelves, under each shelf's name: the photo shelf's pictures by their names and kinds (as the thumbnails and the chips name them, in either language), stickers by their names in either language and their groups', channel graphics by their names, and my vector assets by their names (an AI-made one's in either language) and their folders'. Every word typed must be found; capitals and full-width letters count as the others. Each tile is clicked, dragged or deleted as on its shelf; a line says when nothing matches. ✕ in the field, or Esc, empties it and the sheet is as it was (Esc in an empty field leaves it). A word being put together with an input method (pinyin, say) is never cut short: the sheet waits until it is done. The search, and the photo shelf's chip, last until the app is closed.

The colour block's twelve edge shapes (*Colour block & edge*) are in the *Layout* sheet: see [Templates and the default design](#templates-and-the-default-design).

### Generating assets with AI

*AI stickers & graphics*, at the foot of the *Assets* sheet, opens the AI generate window on its *Stickers & graphics* tab. On the left, type what you need under *What you want* ("a washing machine", "a trophy", "a ginger cat"), pick a kind under *Drawn as* (a card each, the one chosen framed in the channel colour), and click **Generate** (or press Enter), the wide button at the foot; above it the window names the service and model the words go to.

| Kind | Result | Best for |
|---|---|---|
| **3D object** (default) | An object built from boxes and cylinders, drawn like the built-in channel graphics: three tones, screentone, ink lines, a ground shadow | devices, machines, vehicles, buildings |
| **Flat sticker** | Flat colour with a heavy outline, drawn like the built-in stickers | animals, characters, food, symbols |

- The result shows large on the right, on a checkerboard, twice side by side: in its own colours, and in the current channel colour (its dot and name under it), with what it was made from and which try at those words it is. If you like it, **Save to My vector assets** and use it like any other asset, or **Add to the cover**, which saves it there too (both under it on the right); *Discard*, at its top right corner, drops it. While the result shown was made from what the form holds, **Generate** reads *Make another*, and makes it again.
- **Made this session** — under the result, as on the *Photo* tab: what this tab made since the app was opened, newest first, twelve at most, kept in memory only. Click one to show it again, its words and reference picture back in the form. One saved already says *In My vector assets* instead of saving it a second time, and *Add to the cover* puts on the one saved; *Discard* takes it out of the strip.
- **Reference picture (optional)** — under the kinds, drag a picture onto the window, or click *＋ Drag a picture in, or click here to choose one*, to attach one. The model first finds its main subject (ignoring the background, the table, the hand holding it, captions and watermarks), then draws that subject in the current look, solid or flat as chosen above. The text box can stay empty; write a word only to pick one thing out of several ("just the cup"). The picture is scaled down to 768 px on its longer side before it is sent. This needs a model that accepts image input; one that does not answers with an error, and the app says why.
- A generated asset is the same kind of thing as a built-in one: sharp at any size and usable as a channel's graphic.
- Once on the canvas it **follows the channel colour by default**, changing when the channel's colour is changed; choose *Its own colours* under *Colour* (in its properties, or on its bar) to keep its own colour.
- The style comes from a prompt preset in the app; you only describe the subject.
- You first connect your own model service under ⋯ → *AI* → *Text model*, see below; until then the window says so, with *Set up AI*.
- While generating, the button shows the seconds waited and you can **Stop waiting** at any time. That only stops waiting: the request has been sent and your provider may still bill it. It goes on with the window shut, and says when it is done, as a photo does (see [Generating a photo with AI](#generating-a-photo-with-ai)).
- A model sometimes answers in a form the app cannot use. The app then tells the model what was wrong and **retries automatically, up to 3 times**; the button shows which attempt is running. Each retry is a new call and is billed separately. Connection errors, timeouts and cut-off replies are not retried.
- 3D objects are made of boxes and cylinders only — no spheres or curved surfaces — so round things (animals, fruit) come out blocky. Weaker models fail more often and build cruder shapes.

### Looks

The look, chosen in the *Look* sheet, decides how the whole cover is drawn. Every look is a card there, with this cover drawn in it at the size shown (drawn one after another while the sheet is open and nothing is dragged, and again when what it shows changes); the one in use is marked *Current*. Hold the pointer over a card and a moment later the canvas shows that look, only there and only until the pointer leaves (a tag on the canvas says which); click the card to make it the profile's look. Switching it changes the background, the colour block, the title and other lettering, the channel graphics, the stickers and AI-generated assets together; content, placement and layers stay as they are, and you can switch back at any time. Under the cards, *Tune this look* holds the current look's sliders; the note on the look (what it looks like, what is particular to it and what it suits) is folded away under its heading: click the heading or the chevron at its end to open it, and again to shut it (it stays as you left it until the app is closed).

Above the cards, a search field (*Search: night, film, hand-drawn…*) finds looks by their names, by what each says of itself and by its kinds' names, all in either language; every word typed must be found, and capitals and full-width letters count as the others. The chips beside it show one kind of look — *All*, *Night*, *Illustration*, *Poster*, *Print*, *Experimental* (a look may be of more than one) — and, once there is one, *★ Most used*: the six looks this computer has put on most often, by clicking their cards or by keeping a hand of Surprise me dealt in another look. They only hide cards: the profile's own look is always shown, and comes first while they are at work; a card hidden is drawn once it shows; a line says when nothing matches. Esc empties the field, and in an empty field leaves it, as in the *Assets* sheet's search. What is typed and picked lasts until the app is closed.

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
| **Silent wasteland** | the quiet world after the end as digital concept painters paint it — flat strokes of a broad brush and a palette knife, nothing outlined, every edge lost in haze: a sky laid in long strokes from a dark top down to the glow along the horizon; a low sun, the one hot thing in the picture, reddening the air about it and laying a path of light on the ground; clouds of lilac and mauve in long layers lit from below, and a bank heaped by the sun; a colossal megastructure, ruined blocks in a few masses of their own heights and a dead forest with dark stands of conifers receding into the mist, each painted in the sky's own colour a shade darker, so the further they are the more they are lost; power poles running off to the horizon with sagging wires; a plume of smoke rising beside the sun, dense at its source and thinning into the sky, lit along its side toward the light; wet ground whose puddles hold the glow along the horizon; paper blown across it, dead grass along the foot; a tiny lone figure with a lamp. Dark is dusk in olive and teal under a blood-red sun, light a snowfield in fog, cold blue-white with an orange one; *Channel colour for the accent* turns the sun, the fire and the highlighted words to the channel colour by degrees. Everything is built of strokes, not drawn as shapes: the sky in broad overlapping strokes, the ruins in upright knife strokes rimmed by the sun, the puddles in level strokes broken by the ground, a few bright touches (sparks over the fire, the sun's glints in the water). The colour block is a wall in the foreground painted long ago in the channel colour, greyed toward the ground's earth and darker than the scene, laid in broad strokes with patches flaked to the concrete and grime run down it, the light catching its broken top edge and dead grass along it. The title is painted on a sign in condensed capitals, the paint a little uneven, chipped along its edges, a haze behind it so it reads over the scene; the highlighted words in the hot accent, glowing a little. A photo is painted over stroke by stroke in its own colours, with a flat brush whose strokes show: the broadest brush everywhere, finer ones only where the detail needs them (a face stays a face), each stroke running along the edges, mixed afresh a little lighter or darker, warmer or cooler, the lights put on last, the colours brought into the painting's palette, the shadows lifted as haze lifts them; on a photo filling the canvas, mist along its foot. Canvas texture and grain. Flat layouts of its own |
| **Origami noir** | a rain-soaked neo-noir night retold as faceted, low-poly flat illustration — every surface a hard-edged plane of one tone, as if folded from paper, the shadows crushed to near black, a teal world against amber lamplight and a few saturated accents: a sky in broad planes; a city of a few broad towers folded from paper, each a plane in light and a plane in shade (warmer the nearer the neon), the near ones with a chamfered corner catching the light and a fold across the face, crowned with a slant, a chamfer, a gable, setbacks to a mast with its red light or a spire, their lights a few clusters of offices lit late, a lone window here and there and now and then a slit up an edge, a few lamps glowing; deep haze and the city's glow between the rows; giant neon letters glowing through the mist (the channel's code, or up to eight letters of your own, cut at a word: dark glass, a tube of the channel colour round each letter and a cyan tube just inside it, each with a bright core, a gap here and there and a stretch burnt out; a CJK character a solid tube with a white-hot core; set across the skyline where there is room clear of the title, the subtitle, the tag and the graphic; where the room is narrow, stacked down a blade sign of dark glass framed by a tube, on a tower of its own; where there is none, left out); hard-edged shafts of light widening through the haze, rain in streaks, the wet street mirroring the lights in long streaks broken by the ripples into flat pieces, the neon running down it, a craft hovering on its beam; venetian-blind light, a folded-paper figure (the channel graphic folded as a sheet is, by straight creases from its middle, into a few broad planes in four tones, standing on the street or nearer on the wet street where it covers none of the words, the tag, the graphic or the neon, smaller if need be, left out where there is no room) and letterbox bars if you like. *Lamplight* turns the teal night by degrees to the amber and olive of a lit interior. The colour block is a slab of wet street, the city's lights streaking down it under a tube of the neon. The title is set in widely spaced capitals as a film's titles are, each letter folded across — paper white above the fold, a cool grey below — with a dark keyline (the outline slider) and a hard drop (the shadow slider); the highlighted words are neon tubes of the channel colour round a pale body (on the light ground, as a sign seen by day, letters of dark glass, a dark edge round them, the tube lit and its core white-hot). The corner tag is a slab with its corner folded over. A photo is cut into triangular facets — small ones on its strongest turns (an eye, a mouth), more along its edges, broad ones where it is flat, and more wherever a facet strays from what it covers, so a face keeps its eyes and its mouth; a cut-out from its own pixels alone, whole within its own edge — each the mean colour of what it covers, its lightness spread over the photo's own range and graded into the night (teal; amber where it was warm, a highlight on skin warm cream; red lips and a strong red kept; the darks kept apart, so dark hair keeps a few planes), darker away from a key light at the upper right; *Facet size* makes them coarser. The light ground is the same city on a pale teal morning of fog: the far towers lost in it, the near ones dark against it, a few lamps and the low sun warm. Flat layouts of its own |
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
| Jelly machine | jelly figure (the speakers, cables and display round it grow with it; the panel and its circuit stay as they are), circuit board, board size (the panel the circuit, print and knobs are on: as it was at 0.5, the whole open field at 1, smaller behind the jelly toward 0), speakers (pair by pair), cables, knobs and buttons, segment display, tiny print, jelly drops, depth of field, glow, grain, photo teal and orange |
| Anime skies | cumulus (mass by mass), fleecy clouds, sunlight, contrails, pole and wires (wire by wire), town, signs, sea, leaves, haze, photo clarity |
| Spectral engraving | stippled figure, stipple depth, spectral streams, drips, vortex, perspective lines, rainbow waves, colour blocks, engraved sky, paper, mat and frame, photo engraved |
| City pop night | cel figure, dusk, night clouds (more banks, one by one), stars, skyline (the towers rise), lit windows (more of them lit), neon (crowns, signboards, the sign), palms (up to three, each growing in turn), water (the waterline rises), laser lines, videotape, film grain, photo as cels |
| Constructivist | machine, finer blocks, diagonal wedges (one after another, each growing out of its corner), disc (a black disc and a ring follow), rays (each new one in a gap), steel truss (a far one past half way), bars and blocks, construction lines, small type, water, old paper, channel colour for the red (by degrees), photo in greys |
| Dark deco | the great tower (it grows taller), skyline (the rows rise), lit windows (more of them lit), floodlight (up the faces, then the crowns), searchlights (one beam after another), moon and stars, fog, crimson sky (by degrees), rain, airship, blade sign and its letters (empty: the channel's code), stepped proscenium, silhouette, gilt (by degrees to black and gold), halation, film grain, photo as night |
| Silent wasteland | low sun (it grows, its light spreads), drifting clouds (more layers, longer; a bank heaped by the sun), megastructure (it rises), ruined blocks (the rows rise, a near row comes in), dead forest (and dead grass along the foot), power poles (one after another), smoke plume (it rises), wet ground (more puddles, larger), scattered paper, lone figure, haze, channel colour for the accent (by degrees), canvas texture, grain, photo painted |
| Origami noir | towers (the rows rise), lit windows (more floors lit), haze, neon letters and their letters (empty: the channel's code), light shafts (one after another), rain, wet ground (the street rises), hover craft, blind light, folded figure, lamplight (by degrees to amber and olive), letterbox bars, film grain, facet size, photo in facets |

**Figure from** — twenty-one looks draw a figure from the channel graphic's shape: negative space, minimal film poster, cyanotype, monochrome film, animated film poster, avant-garde image, yellow poster, dot matrix, neon pop, velvet illustration, psychedelic rave, liquid chrome, glitch net art, comic-verse, patterned glass, jelly machine, spectral engraving, city pop night, constructivist, dark deco and origami noir. Under that figure's slider, *Figure from* shows what it is drawn from, the channel's graphic by default. Click it to draw the figure from another graphic — one of the library's, one of your assets, a sticker — or upload a picture (kept with your assets), or make it from a photo's cut-out subject: under *Cut-out subjects* are the photos of the photo shelf and of this cover, those cut out already shown cut out; one marked *Cut out* is cut out first when you click it, on this computer (as *Cut out subject* does). The subject, cropped to it, is kept with your assets and the figure takes its outline (and, in city pop night, its colours). Only the solid part is taken as the outline, so a PNG or SVG with a clear background, or a sticker, works best; an ordinary photo becomes a block. In the animated film poster it is the hero's every copy: the giant silhouette, the procession and the traveller on the road. The choice belongs to the look, for every cover of the profile; the channel graphic itself stays as it is. *Back to the channel's graphic*, or *Restore this look's defaults*, undoes it.

**Layouts of their own** — the record sleeve and editorial looks, and negative space, minimal film poster, cyanotype, monochrome film, experimental type, animated film poster, avant-garde image, yellow poster, pitch, dot matrix, neon pop, basketball poster, velvet illustration, psychedelic rave, liquid chrome, glitch net art, comic-verse, patterned glass, jelly machine, anime skies, spectral engraving, city pop night, constructivist, dark deco, silent wasteland and origami noir, do not use slanted panels. They read the three *Template* choices their own way: Stack is a level band, Split an upright side panel, Banner a slim strip, each in its own proportions. Switching to another look brings the usual layouts back.

The sliders named for the photo (*Photo duotone*, *Photo halftone*, *Black-and-white photo*, *Photo in spot colour*, *Photo vividness*, *Photo in red and black*, *Photo toning*, *Photo as cyanotype*, *Photo motion blur*, *Photo torn in strips*, *Photo posterized*, *Photo in neon*, *Hard tones*, *Photo's own colours*, *Photo as cels*, *Photo in greys*, *Photo as night*, *Photo painted*, *Photo in facets*, *Facet size* and the like) and *Hard black and white* only do something when there is a photo; *Photo inside the silhouette*, *Photo inside the letters*, *Photo collage* and *Photo torn in strips* act only on a photo that fills the canvas, as does the dot matrix's reading of a photo into dots, and so do the avant-garde image's smear, glow, blur, mosaic, glass and band (without a photo they work on the figure the channel graphic becomes). The patterned glass bends any photo with the same sliders as its painting; the patterned glass's brush strokes and the spectral engraving's streams, engraved sky and colour blocks come onto a photo only when it fills the canvas.

**The vertical title of the woodblock look** — each typed line is a column, read top to bottom, the first line on the right, set as any lettering set *Vertical* is (see [Title](#title)). In this look the title's columns take the full height of the page and stand clear of the seal in the lower left, and are lettered in its ink with vermilion highlights unless the title has a text effect of its own. *Set the title vertically* sets the title and the subtitle in columns for the look; untick it and each layer's own *Vertical* decides.

The Blue retro and Red street looks have been withdrawn: a profile that used one of them opens in Cyanotype or Negative space instead. Risograph and the looks after it are first versions and will be refined one by one. The serif lettering of Editorial and Woodblock book uses fonts already on the computer by default (Songti SC on macOS, SimSun on Windows), so it differs from machine to machine. For a Kai or Fangsong face, or any other, select the title layer and choose in the *Text* group of its properties.

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

Select *Colour block & edge* and open *Size & slant*, in the drawer or on its bar over the canvas (shut, its line says what the two are set to):

| Control | What it does |
|---|---|
| Band height (*Panel width* for Split) | how much of the picture the colour block takes |
| Edge slant | how far the dividing edge leans; 0 is level or upright |

A slider dragged is one step of undo. Or drag on the canvas: with *Colour block & edge* selected, the dividing edge has a diamond at each end and in the middle — the ends change its lean, the middle moves it; the sliders follow.

The *Layout* sheet's *Template* box is hidden for now, and with it the choice of template (Stack, Split, Banner), *Title box width* and *height*, the *Swap* of the two halves, *Restore this template's defaults* and *Wide split, tall stacked, square banner*. A size keeps what it is drawn in, title box and swap included. The template now changes with a layout preset (see *Layout presets*): *Apply to canvas* puts the preset's block at each size, and in the layout editor the block dragged toward another side, or that side's button, goes there (a band along the bottom or the top is Stack, a panel on the right or the left Split; Banner stays Banner, but nothing there makes it).

Adjustments are stored as fractions of the picture, so one setting suits every size; the default keeps one for each of the three templates, in the profile. After a swap the brand row sits on the colour block and turns to ink. If the colour block layer itself has been moved or turned, the diamonds on the edge are hidden; reset that layer's placement to get them back.

**Default layouts.** Each orientation has a layout of its own by default:

| Orientation | Template | Colour block | Band height / panel width | Edge slant | Title box width, height |
|---|---|---|---|---|---|
| Wide (16:9, 4:3, 2.35:1) | Split | on the right | 0.21 | 0.17 | 1, 1 |
| Tall (3:4, 9:16) | Stack | along the bottom | 0.14 | 0.08 | 1, 1 |
| Square (1:1) | Banner | along the bottom | 0.13 | 0 | 1, 1 |

- A new profile starts with them (the starter, the full example, *New* under *This profile*): its default layout is the one of the orientation most of its sizes face (wide), and the sizes facing the other ways have theirs as their own.
- A size added later in *Sizes & export* is drawn as the sizes facing its way are, when they all are drawn alike; else in its orientation's default.
- A new layout preset starts with them too.
- *Restore this template's defaults* gives the template its default values (Split the wide ones, Stack the tall ones, Banner the square ones; a template no orientation has by default, none), and so does a template chosen when the profile keeps no adjustments for it.
- The profiles you already have are drawn as they were.
- The numbers are in `defaults.json` (`layout.byOrient`); `custom.json` can change them (see [Your own defaults](#your-own-defaults-customjson)).

**Each size may have a layout of its own.** Ratios want different things: 16:9 and 4:3 suit a side-by-side layout, 9:16 and 3:4 a stacked one. The layout (the template and its adjustments) works as a layer's placement does: one for all sizes, and a size's own over it.

- The profile has a default layout, which every size shares. A size given a layout of its own is drawn in that one, and no longer follows the default.
- *Size & slant* changes what *Applies to*, under the canvas, reaches (its ⓘ says which sizes a change lands on). *All sizes* changes the default; *All wide / All square / All tall* gives every size facing that way the layout as it is now, as its own; *This size only* gives the size on screen its own.
- When the size on screen has its own layout, *Size & slant* says *This size has its own layout*, and *Follow again* lets it go, so the size follows the default once more. With *All sizes* the sliders then show and change the default, which this size does not follow. In the tray of sizes under the canvas, a size with its own layout has a small diamond after its ratio.
- Dragging the diamonds on the edge on the canvas follows *Applies to* as well, with one exception: with *All sizes* on a size that has its own layout, the drag changes that one, the layout you see under the pointer.
- *Wide split, tall stacked, square banner*, at the foot of the *Template* box (hidden for now): in one go, every size takes its orientation's default layout (above); the title, the tag and the rest follow the new layouts. Where the profile's default layout already is that of some sizes, they go on following it; else it becomes the one of the orientation most of the sizes face. The others are given theirs; any layout of their own the sizes had before is let go. It is one step of undo, and it only happens when you click it, so an older profile opens exactly as it looked.
- A size removed takes its own layout with it. Layout presets carry each size's colour block (see *Layout presets*); Surprise me changes no size's layout, unless it deals a preset.

### Templates and the default design

- Three templates — Stack, Split, Banner — on a dark or light background, put on by a layout preset (the *Layout* sheet's *Template* box is hidden for now: see [Adjusting the template](#adjusting-the-template)).
- **Colour block & edge**, in the *Layout* sheet: twelve shapes, six to a row; click one to reshape the colour block, for every size and template (or choose under *Shape* on the colour block's bar).
- **Set as the default design**, under *This cover* in the ⋯ menu, stores the current layers, including items you added (but not the photos), as the profile's starting point for every new cover. *Restore the default design*, beside it, puts this cover back to it; Undo brings it back.

## Settings

Settings is a window over the editor: ⋯ → *Brand & channels*, *Sizes & export* or *AI* opens it at that page. Its nav, on the left, shows the profile (its name and how many channels) and the three pages; under them, *This profile*: *New*, *Duplicate*, *Import…*, *Export…* and *Delete this profile…*. ✕ at its corner, Esc, or a click beside the window closes it.

- **Brand & channels** — the profile's name, the brand name, and the brand logo, shown at the right end of the brand row on every channel's cover (*Upload* a PNG with a transparent background or an SVG, then *Replace* or *Remove*; on the cover it is the *Brand logo* layer, to move, resize or hide; looks that print something in that corner move it aside). *Show the number in the brand row*, a switch (off by default), with its *Number prefix* (“SERIES 01 / 05”) and a *Preview* of the row. Then the channels, a card each, three to a row (two in a narrower window): colour, name, sub-name, code, and graphic, shown as a small picture and its name — *Change…* opens a window of pictures to pick from: the channel graphics, my vector assets and the stickers by group (or none). With two channels or more, each card has a ⋮⋮ grip at its left (*Drag ⋮⋮ to reorder*, the page's caption says): drag a card by it and it rises and follows the pointer, a place in its colour opening where it would go and the others making room, the page scrolling when the pointer nears its top or foot; let go and it moves there, one step of undo (the brand row's number follows), or press Esc to leave it where it was. A card's ⋯ moves it up or down too, or deletes it; *＋ Add channel* is the last card. The channel on the canvas is outlined in its colour and marked *On the canvas*; while you work on another (click any of its fields or change its colour) the canvas switches to that channel, so the change shows at once.
- **Sizes & export** — a row per size: a name of your own, its ratio, the platforms it is for, its pixels, and a switch to make covers at it (one at least). *＋ A size of your own* adds a width × height (64 to 8192). There is a preset for each ratio the platforms want, named after them: *Bilibili / YouTube · 16:9*, *Bilibili / Douyin / WeChat Channels · 4:3*, *Douyin / RED / WeChat Channels · 3:4*, *YouTube · 9:16*, *WeChat article · 1:1*, *WeChat article · 2.35:1*; a size of the same ratio, whatever its pixels, takes the same name, in the tray under the canvas and in Export (the thumbnails show only the ratio, such as 16:9; the name and the pixels on hover). A size can be given your own name instead. Under the sizes, the format, resolution and file names of [Export](#export), the folder exports are saved to (*Save to*, with *Change*), and the [batch export](#batch-export).
- **AI** — three cards on one page: the *Text model* (assets from a sentence), the *Image model* (repainted and generated photos) and the *Cut-out*. Each has its light at its head (below), and beside it the model, or the cut-out's way, when the light is green, else what the light means (*Not set up*, *Working…*, *Last request failed*); the *Cut-out* has *Open the models folder* there too.

**The AI lights.** Each AI service has a light: grey while it is not set up; green when it is and its last request or connection test did not fail; amber while a request is under way; red when the last one failed, until one goes through or its settings change. Green says *Connected* once a request has gone through with these settings, *Ready* until then. An image model's *Test connection* that finds the model missing from the service's list, or a service that lists no models, changes the light neither way: it is not a failure, nor proof that it works. Only the requests you make light it — stickers and graphics, repaints, generated photos, cut-outs and *Test connection* — none is made to light it, and it is kept for the session alone. The three show as one in the ⋯ menu under *AI* (amber while any works, red when any failed, naming it when it is one, grey when none is set up, else green, with what is not set up) and beside *AI* in Settings' nav, and each on its own card.

### Setting up AI

SmedCover ships no model and no account. You need a service that speaks one of the two API styles below: an official API, a third-party gateway or a local model. Its settings are on the *Text model* card, under ⋯ → *AI*:

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

Click **Test connection** to check it works; the card's light shows how it went.

Privacy and cost:

- The token is stored in plain text in the app data directory on this computer (`ai.json`) and is never written into profile files.
- When generating, your description, the preset prompt and any reference picture you attached are sent to the address you entered; the app makes no other network requests.
- Usage is billed by your provider.

#### Image model (photo repaint, AI-generated photos)

The *Image model* card, on the same page as the *Text model*, has settings of its own. The text model only writes text; repainting and generating photos need an image model that returns pictures (and, for a repaint or a reference picture, takes one). The three services each have their own interface, and the app speaks each one's:

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

- **Nothing under the badges.** On a landscape cover (16:9, 4:3) Bilibili and YouTube lay the duration and the play count over the bottom corners. The title, the corner tag, the channel name and the channel graphic stay above that strip: the channel name keeps its sub-name beside it, and a colour block too shallow to hold it there grows until it does. On every other cover the words (the title, the corner tag, the channel name) keep out of the bottom 14%, where the apps show plays and views on their cards.
- **A title that reads.** The title's box leaves room for two lines at 14 px or more as the narrowest feed shows that ratio (Douyin's grid shows a 3:4 cover about 128 px wide, YouTube's side list a 16:9 one about 168 px). Keep a line to 6–8 characters: the longer it is, the smaller it is set. With a subtitle the box leaves room for its line too, and where there is not room for both the subtitle gets smaller first.
- **Something to look at.** In the *Stack* template the channel graphic takes at least 12% of the cover, and the title and the channel name make room for it.
- **Room for what is there.** A part left out under *Which parts show* gives its room to the others: without the channel name the colour block along the foot slims down (to 16% of the height, the tag on its edge still above the badges) and the title grows into the room; without the channel graphic the title keeps its whole box, and the *Split* template's panel narrows to a band down the side (13% of a portrait cover's width, 25% of a 16:9 one's), widening the title's column.
- **Every part shown.** A new cover comes with the tag `EP.01`, so the corner tag shows from the start (covers made before that and never touched were given it once); type your own under *Content → Corner tag*, or empty it to leave the tag out. So does the subtitle, with a placeholder (*Write your subtitle here*), given once too to the covers not yet touched.

They hold for the template's own places: a layer you drag stays where you put it, and so does a colour block you resize or tilt with its *Size & slant*, or one of the default layouts (which set its size and slant). Their bands at the tall and square sizes are too slim to hold the channel name: with the name shown there, make the band deeper. With the channel graphic on, the *Split* template's title column is narrow at portrait sizes: there a line of more than 5 characters is set smaller than the feeds read well.

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

**Export**, in the top bar, or ⌘E from the editor, opens a window with this channel's cover at each of the profile's sizes, a row each with a tick, its picture, its name and its pixels. A click on a row, or on its tick, ticks or unticks it; over the rows the window says how many are chosen (*Sizes · 4 of 6 chosen*), beside the quick choices *All*, *Wide only* and *Tall only* (the square sizes go with the tall ones, as the layout that stacks the tall and the square sizes has them; the choice's tip lists the sizes). The quick choices show only when the profile has more than one size, and *Wide only* and *Tall only* only when it has both wide sizes and others. The ticks are remembered for each profile, so a size added later, or switched on again in Settings, starts ticked. *Export*, on a row under the pointer, saves that size alone, ticked or not. Under them:

- **Format** — PNG, JPEG (with quality) or WebP (lossless).
- **Resolution** — 1× to 4×.
- **File name pattern** — see below; an example of the name shows under it, with *Batch export…* beside it.
- **Save to** — the folder the exports go into, the home folder written as ~ (the whole of it on hover), with *Change* (*Choose* while there is none). It is kept for each profile: the first export asks for one (*not chosen yet: asked when you export*) and keeps it, and a single size saved through the save dialog keeps the folder it went into. From then on every export writes into it without asking, a row's own *Export* and *This size only* too. When nothing can be written into the folder (it is gone, moved or renamed, its disk is not connected, full or read-only, or you may not write there), a dialog says so (*Could not save into the folder*) and *Choose another folder…* sends the export there, and keeps it. A failure that is not the folder's (a picture that could not be made, a file name the system refuses) is reported as it is, and the folder kept. Where nothing can be saved to a folder (in a plain browser) the row is not shown and the files download.
- **This size only** exports the size on the canvas; the main button, **Export n** (with ⌘E on it), exports the sizes ticked, and is greyed while none is. ⌘E in the window does the same, even while you are typing the file name. It starts one export at a time: pressed again while one runs (a double-click, ⌘E again), it does nothing.
- **Names never collide** — where the pattern would give two files of one export the same name (a pattern without the size, say), capitals and small letters counting as one as the disk counts them, the later one gets the size after it (`_1080x1920`, unless the name has it already), then a number, so no file of the export writes over another. A file of the same name already in the folder, from an earlier export, is replaced.
- The format, resolution, file names and folder are the same settings as in ⋯ → *Sizes & export*.
- **Transparency** — set the Background layer's base to *See-through* (or hide the layer) and export PNG or WebP. JPEG has no transparency and is filled dark.
- A progress dialog is shown while exporting, and you can cancel at any time.

**The file name pattern** is shown as tags, here and in Settings → *Sizes & export*: each part of the name that changes is a chip, named in the interface's language — *Number*, *Channel*, *Code*, *Title*, *Size*, *Width*, *Height* — with × to take it out, and the text between them is typed where it stands, so the box reads as one line. Backspace at the start of a stretch of text takes out the chip before it, Delete at its end the one after, and the arrow keys step over a chip. ＋ at the end of the box adds a part where the caret last was (else at the end). After the pattern, in grey, is what every name gets besides: @2x at 2× (and so on) and the extension. A token typed out in full, such as `{title}`, becomes a chip. *Edit as text* shows the pattern as text, for those who would rather type it: `{n}` number, `{channel}`, `{code}`, `{title}`, `{size}`, `{w}` width, `{h}` height; *Edit as tags* goes back. The pattern is kept as the same text either way, so a pattern from before reads as it did (`{category}` as *Channel*).

### Batch export

In ⋯ → *Sizes & export*, at the foot of the page (or *Batch export…* in Export, beside the example of the file name): *Import CSV and export…* reads a CSV with one cover per row; each row is drawn from its own channel's cover (the current channel's when it names none that matches), with the row's words, and exported at every size the profile makes covers at (whatever is ticked in Export), into the profile's folder (*Save to*; asked for the first time).

```csv
channel,title,tag,subtitle
Vlog,"First line\n*second line*",EP.01,A line to go with it
Tutorials,Another title,,
```

- The channel column may hold a name, a code or a number. Rows that match nothing use the current channel.
- Use `\n` for a line break in a title.
- The header row is optional; without it the columns are channel, title, tag, subtitle.
- Each row has only its own subtitle: without the column, or with it empty, the cover has none.
- *Download CSV template*, beside it, gives a template.

## Where your data lives

Profiles, each channel's cover, assets, settings, your own repaint styles (the `repaint-styles/` folder) and your own defaults (`custom.json`, see below) are kept in the system's app data directory.
Exports are written only where you choose: each profile remembers the folder you chose for it (see *Save to* under [Export](#export)).

| System | Location |
|---|---|
| macOS | `~/Library/Application Support/com.cyven.smedcover/` |
| Windows | `%APPDATA%\com.cyven.smedcover\` |
| Linux | `~/.local/share/com.cyven.smedcover/` |

To move to another computer or share with someone, export the profile (*Export…*, under *This profile* in the Settings window's nav):

- *With each channel's cover and its photos* unticked: the brand settings only (channels, sizes, look, default design, and the assets and imported fonts they use) — to share as a template.
- Ticked: a whole backup of the profile, every channel's cover and the photos on them included — to move to another computer; it can be large.
- Importing always adds a new profile; a whole backup brings back every channel's cover, on the channel it was exported from.

### Your own defaults (`custom.json`)

The defaults the app starts from are in `defaults.json`, which comes with the app (`ui/defaults.json` in the source), by module:

| Module | What it holds |
|---|---|
| `settings` | what a setting is until you choose one: the language (`""` follows the system), the export's `scale`, `format`, `quality` and file names (`nameTemplate`), what *Applies to* is at every start (`scope`), the frosted `glass`, the `drawer` open, the cut-out's engine (`cutEngine`) |
| `profile` | what a new profile starts with: its ground, look and seed (`style`), its `sizes`, and the starter's name, brand and channels (`starter`; a name may be given in each language, `{ "zh": …, "en": … }`) |
| `layout` | the layout each orientation is given (`byOrient`: `wide`, `square`, `tall`, each a template and its adjustments) |
| `surprise` | Surprise me's chances (`odds`), under those you set in its chances window |
| `ui` | the side columns' least and first widths in px (`columns`), the room the canvas keeps (`centreMin`, `centreRoomy`), how slow dragging must be, in ms between frames, for the note on the glass (`glassSlowMs`) |

To change one, put a file named `custom.json` in the data folder (above, beside `settings.json`) with only what you want otherwise. It is laid over `defaults.json` key by key: what it names replaces the default, everything else stays. For example, JPEG at 85%, and a starter profile with two channels of your own:

```json
{
  "settings": { "format": "jpeg", "quality": 85 },
  "profile": {
    "starter": {
      "channels": [
        { "id": "game", "name": { "zh": "游戏", "en": "Games" }, "sub": "GAMES", "code": "GAME", "color": "#ff3366", "graphic": "gear" },
        { "id": "talk", "name": { "zh": "闲聊", "en": "Talk" }, "sub": "TALK", "code": "TALK", "color": "#00e5ff", "graphic": "camera" }
      ]
    }
  }
}
```

- It is read as the app starts: start it again after a change.
- A default is what something has until it is set. A setting you have chosen stays yours (it is in `settings.json`), and the profiles you have are left as they are; a new profile takes the defaults.
- A name the app does not know, or a value of the wrong kind (text where a number goes), is left out and the default kept; a number out of range is held to it. A list (the sizes, the channels) replaces the default's whole. A file that is not valid JSON is passed over and the app starts with its own defaults. Either way, a message at the foot of the window says so once.
- The app has no button for the data folder itself. *Open the models folder* (Settings → AI, the cut-out) and *Open the styles folder* (a photo's AI repaint, beside *My styles*) open folders inside it: `custom.json` goes one level up from either. A page in a plain browser has no data folder: it keeps everything in the browser's storage, `custom.json` under the key `smedcover:custom.json`.

### Project files

A project file (`.smedcover.json`) holds one cover: this channel's, with its profile, its channel, its photos, the vector assets and imported fonts it uses. *Save project* (⌘S), under *Project file* in the ⋯ menu, saves it (in a browser, downloads it); *Open project…* (⌘O) opens one. A project opens into its own profile and channel when this computer has that profile; when it has not, you are asked whether to import it as a new profile, opened as it was, or to put it into the current profile (on its channel, if this profile has it). The profile and channel it opens on are shown, with the sheet, the drawer, the bar and the sizes under the canvas as they now are, and Undo brings back the cover it replaced. Project files from before version 4 have no profile and open into the channel on the canvas. Where the app can neither save nor download files, *Project file* is not in the menu.

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

### Custom looks (after more built-in looks are added to Look)

Goal: users make looks of their own and import looks others made, and the Look sheet shows their sliders as it does now (the list of sliders is data already).

- [ ] **Look presets** (first, small): a JSON file — which built-in look, its slider values, its seed, and optionally its colours (paper, inks); exported, imported, shared, with that look's sliders in the panel. Variations of the existing looks only.
- [ ] **Declarative look files** (later, large): the ways of drawing the built-in looks share, taken apart into building blocks — ground (flat, gradient, halftone field, grid, noise), photo treatment (tint, duotone, black and white), title (fill, outline, offset shadow, two inks off register, glow), the stickers' outline and shadow, corner marks, finishing (grain, scan lines, vignette), the repaint and AI asset prompts — which a look file puts together as data, declaring its own sliders and binding them to the blocks' settings; the panel builds the sliders.
  - No code is run, so a file from someone else is safe to import; it is checked as AI assets are.
  - Try it on one or two built-in looks first (Risograph, Editorial) to see whether the format is enough, then move the others one by one.
  - A look editor could start from "save as" on an existing look; AI could write a look file from a sentence.
- Not planned: script plugins (a look as JavaScript) — that would run strangers' code in an app that can read and write files.
- Open: whether an imported look may name fonts, and whether the font files travel with it; whether the editor lives in Settings or in the Look sheet.

### Open the looks' material effects to the user's own layers

Goal: text, asset, photo and solid layers can each take a look's material effects — the riso's misregistration and patchy ink, the chrome's metal and drips, the net art's pixel sorting and dither — each layer with its own strengths. The layout layers (title, channel graphic, tag, channel name) do not: their look is designed by the look as a whole.

**Decided**

- Only the user's own layers; every effect off on a new layer; one set of effects per layer, not per size.
- A layer's effects come in two groups: *This look* lists the current look's; *Other looks* lets you borrow from another look, kept apart, so a borrowed effect shows as borrowed.
- *Surprise me* picks mostly from the look it drew, now and then from another.
- The lettering effects are brought home: Sliced, Overprint, Double keyline and Sunlit block become their looks' true post effects (Three slices, Second-ink overprint, Two-tone outline, Sunlit block), for any layer and with any text effect; the net art's Selected box likewise. The Underlined highlight has to know the highlighted words, so is lettering, and stays in the text effect menu. A text layer already using one of the four is given the matching post effect; a title's is drawn as *Automatic*, its setting kept.
- Pilots: riso, liquid chrome and glitch net art; then every look.

**How effects are sorted**: three questions, in order.

1. Does it **add something to the picture**? Something with content and a place of its own, belonging to no layer: the ball, the giant letters, the hills, the radiating lines. → a **scene object**; it stays in the background layer.
2. Does it imitate **the medium the whole picture shares**? The same sheet, the same reel of film, the same lens, the same screen: paper grain, film grain, vignette, creases and folds, sun fading, dust and scratches, scan lines, light leaks, lens flare. → the **finish**; not opened to single layers. A real print never has film grain in one spot only; laid layer by layer it looks dirty, and doubles the whole-picture one.
3. What remains changes **how one thing is drawn or printed**. It depends only on that thing's own shape and pixels, and moves and scales with it: misregistration, halftone, chrome, a fuzzy edge, pixel sorting, a silhouette, a glow, fluted glass, slicing. → a **material effect**, opened to layers.
   - Some are laid over the whole picture today: the riso's ghost and patchy ink, the basketball poster's screen-print wear, the cyberpunk colour split. By this test they are material too.
   - Once opened, the whole-picture one stays in the Look sheet, and a layer's own is laid on that layer only.

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
| Jelly machine | jelly [fill], glow [out], depth of field [px], photo teal and orange [px, photo] | jelly figure ★, circuit board, board size, speakers, cables, knobs and buttons, segment display ★, tiny print, jelly drops | grain |
| Anime skies | photo clarity [px, photo] | cumulus ★, fleecy clouds, sunlight ★, contrails ★, pole and wires ★, town, signs, sea, leaves ★, haze | — |
| City pop night | cel tones [px], neon glow [out], videotape [px] | cel figure ★, night clouds ★, stars, skyline and lit windows, neon crowns and signboards, neon sign ★, palms ★, water, laser lines | videotape, film grain (frame: screen corners and the play display) |
| Constructivist | built of blocks (with the block size) [fill], grey plates [px], diagonal wedge [out] | machine ★, diagonal wedges, disc ★, rays ★ (their centre), steel truss ★, bars and blocks, construction lines, small type, water | old paper (frame: a ruled border) |
| Dark deco | gilded [px], silhouette with rim light [fill], gold sunburst [out], night grade [px, photo] | the great tower ★, moon ★, searchlights ★, skyline and lit windows, floodlight, fog, crimson sky, rain, airship ★, blade sign ★, stepped proscenium, silhouette ★ | halation, film grain (frame: gold corner pieces) |
| Silent wasteland | painted in strokes [px, photo], dry-brush edge [px], lost in haze [over], low sun behind [out], wasteland grade [px, photo] | low sun ★, drifting clouds, megastructure ★, ruined blocks, dead forest and grass, power poles ★, smoke plume ★, wet ground, scattered paper, lone figure ★, haze | canvas texture, grain (frame: a brushed border) |
| Origami noir | folded facets (with the facet size) [fill], neon outline [out], blind light [over], rain-night grade [px, photo] | neon letters ★, hover craft ★, light shafts ★, towers and lit windows, haze, rain, wet ground, blind light, folded figure ★, letterbox bars | film grain (frame: fine corner brackets, a folded triangle in each) |
| Spectral engraving | stipple (with its depth) [fill], line engraving [fill], spectral streams [out], drips [out] | stippled figure ★, vortex ★, perspective lines ★ (their vanishing point), rainbow waves, colour blocks, engraved sky | paper (frame: mat and frame) |

The general typesetting effects belong to no look and stay in the lettering menu: Automatic (follows the look), Sticker, Outline and shadow, Plain, Plain upright, Halftone inside, Stripes inside, Inner shadow, Worn, Row shift, Extruded, Spiky, Torn edge, Scissor-cut, Melting, Puffed up, Eaten away, Ransom note; and the bends beside them: Arched, Arc down, On a circle, Arched top, Bulge, Pinch, Fisheye, Rise, Tapered, Wave, Flag.

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
