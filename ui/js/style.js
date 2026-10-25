// Looks: how a cover is rendered. The *content* of a cover — layers, placements, sticker and
// solid specs, title text — never mentions a look, so switching look re-renders everything,
// built-in and generated assets included, without touching the data.
//
// A look is a set of hooks. Every hook is optional: what a look leaves out is drawn the house
// (cel) way, so a new look can start as a single hook and grow.
//
//   theme(base, C, p)            colours of the field, grid and plain text
//   background(ctx, env, L, p)   paints the background layer; return true if handled. Called twice (see PAINT.bg in
//                                render.js): with L.grid false for the look's ground alone (its colour, sky, paper…),
//                                then with L.grid true and L.ground false for what stands on it, its scene and pattern,
//                                which its sliders bring in: all of them at their least, nothing. A photo is painted
//                                through it too (env.photo, L.ground left out: the ground is painted)
//   gridLines(ctx, env, color)   the grid laid on the ground when the Background's base is "grid", in the look's own
//                                manner, in `color` (the theme's grid colour); else lines every 60
//   accent                       how the colour block is painted: { fill(C), tone, edge(ctx, run, nx, ny, C, p, pts),
//                                body?(ctx, box, nx, ny, C, p) — a surface of its own, painted inside the block }
//   leave()                      optional: lets go what the look keeps (its work canvases, its caches), as setLook()
//                                passes to another look
//   runs(ctx, pass, o, p)        paints lettering made of runs (the title, free text): pass(fn) calls
//                                fn(run, x) for every run of the current line; o has the sizes and colours
//   wrap(ctx, C, p)              returns the context that graphics, solids and the small cover parts
//                                (brand row, tag, channel name, brackets) draw on — a look can re-map
//                                their colours and line work here without changing their drawing code
//   sticker                      painters for flat stickers: { shape, blob, stroke, thin, word }
//   tag(ctx, str, x, y, fs, C, p) paints the corner tag and returns its box
//   frame(ctx, env, p)           paints the frame layer (corner brackets and any interface detail)
//   plate(ctx, x, y, w, h, colour, fs, p)  paints the plate under a text layer
//   subject(ctx, half, env, p)   painted around the channel graphic, in its own space
//   seeded                       true when the look scatters things at random (the user can shuffle them)
//   repaint(colour)              how a background photo is repainted in this look (see repaint.js), the channel colour as "#rrggbb"
//   about: {zh, en}              what the look looks like and what it suits, shown under the look menu
//   titleFont(fonts)             the font stack of the title, when the look sets its own
//   faces(fonts)                 font stacks to use in place of the profile's for the whole cover: { cn?, en?, mono? }
//   columns(p)                   true when the look sets the title and the subtitle in columns of itself (see columned)
//   columnBox(ctx, env, box)     where the title's columns stand, when the look has a place of its own for them
//   layout(template, w, h)       the geometry of a cover, for looks that are about arrangement (see layout.js)
//   image(ctx, C, unit, p)       prepares the context for an uploaded image (its shadow or glow)
//   post(ctx, w, h, C, p, unit, hits)  painted over the finished cover (scanlines, vignette); `unit` is
//                                canvas pixels per virtual unit, `hits` where each layer ended up
//   params                       … an entry with toggle: true is shown as a switch (0 or 1)
//   params                       tunable numbers shown as scrub bars: [{ key, min, max, step, def, name: {zh, en} }];
//                                needsPhoto: true marks one that only acts on a background photo
//   prompt / solidPrompt         the "Style" section of the AI prompts for this look (see ai.js)
//   scene: { key: {zh, en} }     the scene objects the user may drag on the canvas (the ball, the giant
//                                letters, the centre of the radiating lines…): its painters place each
//                                through objAt(key, x, y, ctx), which moves it by the cover's offset
//   art                          the key of the slider whose figure is drawn from a graphic's shape (a giant
//                                silhouette, a jelly): the channel graphic, or the one the user put in its
//                                place for this look (style.lookArt), picked under that slider
//
// The current look is module state (in looks/kit.js), set by drawCover() from the profile before anything is drawn.
//
// Each look lives in a file of its own, looks/<id>.js, and what the looks share in looks/kit.js; this file puts every
// look in the registry (LOOKS, in the order the menu shows them) and is the one the rest of the app imports from.

import { INK, LOOKS, css, houseLook, hueTurn, toneTable } from "./looks/kit.js";
import { cel } from "./looks/cel.js";
import { cyber } from "./looks/cyber.js";
import { riso } from "./looks/riso.js";
import { anime } from "./looks/anime.js";
import { bluenote } from "./looks/bluenote.js";
import { editorial } from "./looks/editorial.js";
import { songke } from "./looks/songke.js";
import { vivid } from "./looks/vivid.js";
import { negative } from "./looks/negative.js";
import { cinema } from "./looks/cinema.js";
import { cyano } from "./looks/cyano.js";
import { monofilm } from "./looks/monofilm.js";
import { typo } from "./looks/typo.js";
import { toon } from "./looks/toon.js";
import { avant } from "./looks/avant.js";
import { collage } from "./looks/collage.js";
import { yellow } from "./looks/yellow.js";
import { pitch } from "./looks/pitch.js";
import { dots } from "./looks/dots.js";
import { neon } from "./looks/neon.js";
import { court } from "./looks/court.js";
import { velvet } from "./looks/velvet.js";
import { rave } from "./looks/rave.js";
import { chrome } from "./looks/chrome.js";
import { netart } from "./looks/netart.js";
import { verse } from "./looks/verse.js";
import { glass } from "./looks/glass.js";
import { jelly } from "./looks/jelly.js";
import { skies } from "./looks/skies.js";
import { spectrum } from "./looks/spectrum.js";
import { citypop, celPixels } from "./looks/citypop.js";
import { construct, joinCells } from "./looks/construct.js";
import { deco, dkPixels, dkSpot } from "./looks/deco.js";
import { wasteland, wlBlock, wlHot, wlMemory, wlPixels } from "./looks/wasteland.js";
import { facet, fcDelaunay, fcFacets, fcFreeAll, fcGrade, fcLetters, fcMemory, fcRim, fcSignAt, fcTones, fcWord } from "./looks/facet.js";

Object.assign(LOOKS, { cel, cyber, riso, anime, bluenote, editorial, songke, vivid, negative, cinema, cyano, monofilm, typo, toon, avant, collage, yellow, pitch, dots, neon, court, velvet, rave, chrome, netart, verse, glass, jelly, skies, spectrum, citypop, construct, deco, wasteland, facet });
houseLook(cel);

export { FX_STAGES, FX_TIMING, FX_TYPES, INK, LOOKS, asColumn, columnBoxOf, columned, css, effectsFor, fall, isFast, layerEffects, look, lookParams, lookState, lookValues, noteReads, paintEffects, parseColour, readsInto, role, scenePlaced, setFast, setLook, setScene, styled, wherePainted } from "./looks/kit.js";

export const LOOK_IDS = Object.keys(LOOKS);
/** The kinds of look the Look sheet's chips sort them by (see lookSheet in app.js), in the order the chips show. */
export const LOOK_CATEGORIES = ["night", "illustration", "poster", "print", "experimental"];
/**
 * What kind each look is, one or more of LOOK_CATEGORIES, as its name and what it says of itself (`about`) have it:
 * a city or a club by night; drawn or painted; after a kind of poster; after a way of printing; and what is about
 * the medium itself, the type, the glitch, the pixels. Every look has at least one.
 */
export const LOOK_TAGS = {
  cel: ["illustration"], cyber: ["night", "experimental"], riso: ["print"], anime: ["illustration"], bluenote: ["print"],
  editorial: ["print"], songke: ["print"], vivid: ["illustration"], negative: ["poster"], cinema: ["poster"], cyano: ["print"],
  monofilm: ["print"], typo: ["poster", "experimental"], toon: ["poster"], avant: ["poster", "experimental"], collage: ["experimental"],
  yellow: ["poster"], pitch: ["poster"], dots: ["night", "experimental"], neon: ["night", "illustration"], court: ["poster"],
  velvet: ["illustration"], rave: ["night", "poster"], chrome: ["experimental"], netart: ["experimental"], verse: ["illustration"],
  glass: ["illustration"], jelly: ["illustration"], skies: ["illustration"], spectrum: ["print", "experimental"],
  citypop: ["night", "illustration"], construct: ["poster"], deco: ["night", "illustration"], wasteland: ["illustration"],
  facet: ["night", "illustration"],
};
/** Internals the tests reach for. */
export const __test = { toneTable, hueTurn, joinCells, celPixels, dkPixels, dkSpot, wlPixels, wlHot, wlBlock, wlMemory, fcDelaunay, fcFacets, fcGrade, fcRim, fcTones, fcLetters, fcWord, fcSignAt, fcMemory, fcFreeAll };
