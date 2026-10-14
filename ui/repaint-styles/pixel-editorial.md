---
name.zh: 8-bit 像素编辑
name.en: 8-bit pixel editorial
about.zh: 把照片提炼成稀疏、抽象的 8-bit 像素画：大面积留白的纸面上一小簇粗像素块，或铺满画面的几块像素平面。不是像素滤镜，构图会重新安排。
about.en: Distils the photo into a sparse, abstract 8-bit pixel piece — a small cluster of coarse blocks on a wide paper field, or a few broad pixel planes edge to edge. Not a pixel filter; the composition is rearranged.
order: 10
credit: Adapted from "Abstract 8-bit Instagram Pixel Editorial" by TwentyfiveBTea — https://github.com/TwentyfiveBTea/8bit-pixel-art (AGPL-3.0)
---

<!-- Its "fuse" mode, condensed into a single instruction for an image model, with the 3:5 canvas
replaced by the photo's own shape. Comments like this one are not sent to the model. -->

Reinterpret the attached photo as one sparse, abstract 8-bit pixel editorial artwork. This is a distillation, not a pixel filter: the photo is information to analyse, not a surface to pixelate.

1. Read the photo first: the anchor subject or relationship that must stay recognisable; its one to three largest masses and their scale; one or two axes or gestures (a horizon, path, roofline, diagonal); its rhythm and asymmetry; its quiet, open side; its colour roles — one dominant, one dark structural, one light or neutral, one or two subject midtones, at most one small accent. If one subject clearly dominates, give it nearly all the detail and keep one to three cues that identify it. If none does, keep only the strongest spatial gesture or colour relationship; do not invent a focal object.

2. Choose a boundary mode. For a clear, isolatable subject (the default): a soft-edged cluster of coarse pixel blocks on an even, matte, near-uniform paper field — warm ivory, off-white, cool white, pale grey or pale blue, whichever separates best from the subject while keeping the photo's temperature. The cluster covers roughly 8–18% of the picture, stays at least 6% from every edge, sits where the subject sits in the photo rather than centred by habit, and its perimeter breaks up in stepped erosion, gaps and a few dissolving blocks — never a clean rectangle, a sticker outline or a straight shared baseline. For a continuous scene (sea and sky, a panoramic landscape, a corridor) with nothing to isolate: carry three or four broad pixel planes to every edge, keeping the photo's main directions.

3. Pixel marks: one primary family — flat coarse masses, stepped silhouettes, segmented bars or paths, stacked bands, irregular clusters of blocks, or simplified planes — and at most two supporting ones (short lines, isolated blocks, compact dots, one accent). Work as if on a logical grid of 32–64 pixels along the short edge, enlarged with hard nearest-neighbour edges: large crisp blocks, broad grouped values, contours partly lost. No one-pixel outlines, anti-aliasing, gradients, dithering, grain, regular grids, game interface or sprites.

4. The paper field stays truly empty: no sky, ground, texture, shadows, vignette, particles, border or colour swatches. Keep the photo's colours and the order of its lights and darks; add no colour it does not have. Never keep foreground, middle ground and background as three readable layers.

5. No photographic area, no pasted panel, no before/after or split layout, no invented objects.
