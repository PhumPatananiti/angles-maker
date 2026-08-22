# Angles Maker

Turn a photo of a workbook page into one clean PNG per figure, ready to paste into a Word quiz.

Point a phone at a page of geometry questions, drop the photo in, and get `q01.png`, `q02.png`, …
— each figure cropped out, straightened, and cleaned up so the paper is white and the lines are
black. Nothing is uploaded; all the work happens in the browser on your machine.

## Run it

Double-click **`dist/angles-maker.html`**. That is the whole app in one file — no install, no server,
no network.

To work on the source instead, serve the folder and open `index.html`:

```bash
python3 -m http.server 8753
```

Then rebuild the single file after any edit:

```bash
node tools/bundle.js
```

## Using it

1. **Add photos** — or drag them onto the window. JPG, PNG and WebP work.
   iPhone HEIC files do not; the app shows you the `sips` command to convert them.
2. **Check the boxes.** Figures are found automatically. Drag on the page to add one that was
   missed, drag a box to move it, drag its edges to resize, <kbd>⌫</kbd> to delete,
   <kbd>⌘Z</kbd> to undo, arrow keys to nudge.
3. **Set the output.** Clean grayscale (the default), pure black & white, or a transparent
   background. *Bolder lines* helps thin pencil strokes survive printing.
4. **Download** each figure, or all of them as a `.zip`.

Figures are numbered in reading order across every page you have loaded, so three photos of a
20-question exercise give you `q01`–`q20` in one archive. Rename any of them in the list.

Each PNG is written at 300 dpi, so a 900 px figure lands about 3 inches wide in Word instead of the
nine inches you would get from a plain screenshot.

### If a page comes out wrong

- **Bits of text are picked up as figures** — raise *Figure size*.
- **Small figures are missed** — lower *Figure size*.
- **The page is crooked** — nudge *Rotation*. Detection re-runs, and boxes you drew yourself move
  with the page instead of being left behind.
- **Nothing at all is found** — draw the boxes by hand. That path is meant to be used, not a
  fallback: cropping, cleaning and naming are most of the value.

## How it works

Analysis runs on a copy of the photo scaled to 1600 px; export always re-crops the original pixels.

1. Estimate the paper's illumination with a local maximum and divide it out — this is what removes
   the shadow and the grey.
2. Binarise with Sauvola plus an absolute darkness gate, which drops most of the bleed-through
   from the reverse side of the page.
3. Estimate skew from the projection profile of the ink, over ±10°.
4. Chain glyphs horizontally into lines of running text and take them out of play, so figure
   grouping cannot swallow a question or an answer column.
5. Classify what is left by shape — a long unbroken stroke, or a large sparse blob of line art —
   and grow each seed into its neighbouring labels.
6. Merge the pieces of a split figure, but never across a line of text.
7. Crop the full-resolution deskewed page, flatten and level that crop, and write a PNG with a
   `pHYs` resolution chunk.

`docs/PLAN.md` is the design; `docs/SCRUTINY.md` records three review passes and what each one
changed, including the two approaches that were thrown away.

## Tests

```bash
node test/run.js && node test/export.js
```

`test/run.js` builds synthetic workbook pages containing every case that has broken this code —
oblique transversals, figures made of disconnected strokes, an answer column two text-heights from
the figure, labels sitting on the strokes, bleed-through, a dark page edge, shadow and skew — and
asserts that each figure is found, fully contained, and free of neighbouring content. It writes
annotated pages to `test/out/` so failures can be looked at.

`test/export.js` checks the export path: paper comes out white, ink comes out black, the PNG really
carries 300 dpi, and the archive passes `unzip -t` and extracts byte-identical files.

## Layout

```
index.html            the app
css/app.css
js/core/util.js       crc32, geometry, name handling
js/core/image.js      grey, integral images, morphology, Sauvola, rotation, components
js/core/deskew.js     skew from the ink projection profile
js/core/detect.js     text lines, component classes, grouping, figure boxes
js/core/pipeline.js   one analysis entry point, shared by the app and the tests
js/core/clean.js      per-crop flatten and levels
js/core/pngmeta.js    pHYs resolution chunk
js/core/zip.js        stored-mode zip writer
js/core/synth.js      synthetic page, used for the demo and as the test fixture
js/app.js             UI, box editing, export
tools/bundle.js       inline everything into dist/angles-maker.html
```

Core modules are plain scripts that attach to a global `AM`, so the same files load from `file://`
in a browser and `require()` in Node — the tests exercise the code the app actually runs.
