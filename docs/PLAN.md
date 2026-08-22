# Angles Maker — plan

## Goal (one sentence)
Turn a photo of a textbook page into one clean PNG per geometry figure, ready to paste into a Word quiz.

## Users / workflow
Teacher photographs a page of a Thai maths workbook (บทที่ 13 เส้นขนาน). Each numbered question has
one line-art figure. They want each figure as its own image file, cropped, straightened, cleaned of
paper shadow, named `q01.png`, `q02.png`, … so it can be dropped into a Word quiz next to retyped text.

## Non-goals (v1)
- Understanding the geometry (no OCR of angle values, no re-drawing as vector).
- Solving the questions.
- Extracting the Thai question text.

## Shape of the tool
Static local web app. No server, no upload, no network. Open `index.html`, drag photos in, get PNGs.
Reasons: zero install for a non-developer; photos never leave the machine; Canvas gives decode +
resample + PNG encode for free.

## Pipeline
Analysis runs on a downscaled copy (long side ≤ 1600 px). Export always re-crops the ORIGINAL
full-resolution pixels.

1. **Decode** — File → Image → canvas → ImageData. Keep original.
2. **Flatten illumination** — estimate paper background (downsample → local max → blur → upsample),
   divide. Removes shadow, vignette, gray paper.
3. **Binarize** — Sauvola local threshold via integral images → ink mask.
4. **Deskew** — projection-profile score over −10°…+10°, 0.25° steps, on a small copy. Rotate.
5. **Long-stroke mask** — keep ink pixels in runs longer than T along H / V / both diagonals.
   Geometry lines are long; Thai glyph strokes are not. This is the core figure/text discriminator.
6. **Seed → grow** — dilate long-stroke mask, connected components = figure seeds. Absorb nearby
   short components (labels `A`, `82°`, `x + 50°`, arrowheads) within ~1.2 × text height.
   Refuse to absorb long components (question sentences, choice lines).
7. **Reject** — drop seeds that are too small, too faint (bleed-through from the reverse page is
   line-art too, but light), or absurd aspect.
8. **Order** — reading order, top→bottom / left→right.
9. **Review UI** — boxes drawn over the deskewed page. Move / resize / add / delete / rename / undo.
10. **Export** — re-crop original through the inverse deskew transform, flatten + level the crop,
    pad, optional transparent background / pure B&W / 2× supersample, `canvas.toBlob` → PNG.
11. **Download** — per figure, or all as a .zip (STORE method, hand-rolled writer).

## Files
```
index.html            UI shell
css/app.css
js/core/util.js       namespace, math, crc32
js/core/image.js      gray, integral, box blur, background flatten, Sauvola, morphology
js/core/deskew.js
js/core/detect.js     runs, connected components, seed+grow, reject, order
js/core/clean.js      per-crop cleanup (buffer in, buffer out)
js/core/synth.js      synthetic textbook page generator (demo + test fixture)
js/core/zip.js
js/app.js             DOM, canvas, box editing, export
test/png.js           PNG encoder for node output
test/run.js           headless tests against synthetic pages
tools/bundle.js       inline everything → dist/angles-maker.html (single file, works from file://)
```
Core modules are classic scripts attaching to a global `AM` namespace, so they load from `file://`
in the browser AND `require()` cleanly in Node for tests. No build step required to use the app.

## Testing
- Node: generate synthetic pages (text lines + 3 figures + shadow + skew + faint bleed-through),
  assert figure count and IoU ≥ 0.6 against ground truth, assert no text block is returned.
- Browser: serve the folder, open with `?demo=1`, screenshot, confirm boxes land on the figures.

## Risks
- Auto-detect is heuristic; real photos vary. Mitigation: the editor is first-class, not a fallback.
- Perspective (page curl) is not corrected, only rotation.


---

## As built

Three review passes changed the design before any of it was written; `docs/SCRUTINY.md` has the
detail. What differs from the plan above:

- **The figure/text discriminator is component shape, not stroke run-length** (pass 2, B3). Runs
  along fixed directions cannot see an oblique line, and nearly every transversal in this workbook
  is oblique.
- **Lines of running text are found and removed before figures are grouped** (found while testing).
  Excluding components already shaped like a text line is not enough — a line of Thai text is
  hundreds of separate glyph components, and grouping swallows them one at a time.
- **Merging is blocked across a line of text** (found while testing). Any gap threshold generous
  enough to rejoin the five separate lines of a ladder figure also welds two questions together.
- **Marks above and below a line are attached to it individually**, rather than by dilating
  vertically (found while testing) — a vertical dilation that catches Thai vowel and tone marks also
  merges neighbouring lines wherever the leading is tight.
- **Solid fills are never line art** (pass 1, B1), which is what keeps the chapter banner and the
  dark surround beyond the page edge out of the results.
- **One full-resolution deskewed canvas is cached, never several** (pass 1, M7).
- **Padding stops short of a text line**, so glyph tops do not appear along the edge of a figure.
- **PNGs carry a pHYs chunk** (pass 3, m6) so Word places them at a sensible size.

Detection is heuristic and the editor is first-class, per the conclusion of pass 1: the cleanup,
naming and batching are the value; detection is convenience.
