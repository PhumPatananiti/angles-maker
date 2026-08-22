# Scrutiny log

---

# Pass 1 — intent, alternatives, architecture

**Goal restated:** one clean PNG per geometry figure from a photo of a workbook page, named and
batched so they can be dropped into a Word quiz.

## Simpler alternatives (mandatory pass)

- **Cmd+Shift+4 twenty times.** This is the real competition, and it is free. Screenshot-cropping
  produces a *gray, shadowed, skewed* crop of the photo. So the tool's value is NOT the cropping —
  it is (a) shadow removal / whitening, (b) straightening, (c) batch naming q01…q20, (d) one zip.
  **Consequence: cleanup quality is the product; auto-detection is convenience.** If detection is
  mediocre the tool still wins, provided drawing a box by hand is fast. Detection must never block.
- **CamScanner / Notes scan first.** Already gives a whitened deskewed page. Implication: the tool
  must accept an already-clean scan without wrecking it — flatten must be near-idempotent.
- **Vision-LLM box detection.** More accurate, but needs an API key, network, and per-page cost for
  a teacher's offline task. Rejected for v1; box format stays plain so it could be added later.
- **Python + OpenCV script.** Fewer lines for me, but no hand-adjust UI and a dependency install for
  a non-developer. Rejected — the review UI is the load-bearing part.

## Findings

### B1 (blocker) Dark non-page background becomes a giant "figure"
Photo 1 shows the facing page and dark background at the left edge. After background flattening a
large dark region stays dark, binarizes as one huge component, and it is full of long runs — it will
seed as a figure. **Fix:** reject components with ink fill ratio > 0.35 inside their bbox (line art
is 2–10 % fill), and reject large components touching the image border.

### B2 (blocker) Disconnected figures split into pieces
Q17 is five separate parallel lines; Q14's zig-zag never touches the two parallel rays. Long-stroke
seeding gives one seed per stroke group. A single absorb threshold cannot both merge these and keep
the answer choices out. **Fix: two thresholds.** Generous seed↔seed merge (~2.5 × text height,
figure-to-figure only) and tight seed↔label absorb (~0.8 × text height, nearest-ink distance, only
for components with bbox diagonal ≤ 3.5 × text height, max 2 hops, and reject any absorption that
grows the box area by > 60 %). Otherwise "1. 205°" in the answer column gets swallowed.

### M1 (major) Export transform is an unnecessary bug surface
Re-cropping the original through an inverse rotation invites an off-by-center error, and the preview
would no longer be exactly what is exported. **Fix:** build one full-resolution deskewed canvas per
page, lazily, cache it, release it on page switch. Crops become plain integer rectangles and
what-you-see-is-what-you-export becomes literally true. Cost: ~48 MB for a 12 MP photo. Accept.

### M2 (major) Bleed-through from the reverse page is line art too
Visible on pages 2–4. Sauvola is contrast-adaptive and will binarize it. **Fix:** score each
component by mean ink darkness measured on the *flattened grayscale*, not on the mask, and reject
faint ones; additionally give the per-crop cleanup a black/white point pair that washes residual
ghosts out of kept crops.

### M3 (major) HEIC input will simply fail
iPhone photos are .HEIC; Chrome cannot decode them. **Fix:** catch the decode failure and say so,
with the one-line `sips` conversion command, instead of showing an empty canvas.

### m1 Deskew can pick a bad angle on a curled page
Bound to ±10°, require the profile peak to be prominent or skip rotation, and expose a manual
rotation slider per page.

### m2 Word inserts PNGs at 96 DPI → giant images
`canvas.toBlob` writes no pHYs chunk. Splice one in (300 DPI default) so Word places the figure at a
sane physical size. ~30 lines, reuses the CRC32 needed for the zip.

### m3 Ambiguity in the request: "1 png per 1 angles"
Read as one PNG per figure (per-single-angle crops would be useless in a quiz). Neutralised by
design rather than by asking: boxes are arbitrary, so a user who wants one angle draws one box.

**Verdict: rework** — B1 and B2 would make first contact with the user's own photos look broken.

---

# Pass 2 — trace the pipeline with real numbers

Assumed input: iPhone photo ≈ 3024 × 4032. Analysis scale s = 1600/4032 ≈ 0.40.
Thai body text at analysis scale: glyph height ≈ 20 px, line pitch ≈ 45 px, stroke ≈ 2 px.
Geometry lines at analysis scale: 60–160 px long.

### B3 (blocker) The long-run discriminator does not survive contact with oblique lines
Plan v1 step 5 keeps ink in runs longer than T along H / V / both diagonals. Trace a transversal at
30° from horizontal, stroke thickness 2 px:
- horizontal run = t / sin 30° = **4 px**
- 45° diagonal run = t / sin 15° ≈ **8 px**
- vertical run = t / cos 30° ≈ 2 px

Text glyph stems are ~20 px. So the transversals in Q1, Q4, Q7, Q9–Q12 score *below* text. Four
directions only detect lines near 0/45/90/135°, and nearly every transversal on these pages is
oblique. Sampling 16 directions does not rescue it: worst-case deviation 5.6° still gives
t/sin 5.6° ≈ 20 px, exactly the text stem length. **The discriminator is wrong in principle.**

**Replacement — classify connected components by shape, and group text lines first:**

| class | test (in units of text height h) | meaning |
|---|---|---|
| `speck` | diag < 0.35 h | dust, dashes, dots — ignorable, absorbable |
| `glyph` | 0.35 ≤ height ≤ 1.9 h and width ≤ 6 h | a character |
| `textline` | height ≤ 1.9 h and width > 6 h | characters that merged during binarization |
| `rule` | one side ≤ 0.35 h and the other ≥ 2.5 h | a lone straight line — **figure seed** |
| `big` | height ≥ 2.2 h and width ≥ 2.2 h and fill ≤ 0.35 | connected line art — **figure seed** |

Orientation never enters. Checked against the real pages: Q4's three crossing lines are one CC with
fill ≈ 0.05 → `big`. Q17's five separate parallel lines are five `rule`s. A merged Thai text line is
`textline` (height gives it away, and fill ≈ 0.3 is irrelevant). The white-on-black chapter banner
and the dark page-edge band are `big` but fill ≈ 1 → rejected, which also closes **B1**.

### M4 (major) Text height is needed before the classifier, but is measured from it
Chicken-and-egg. Resolve by measuring after the first CC pass: 70th percentile of the heights of
components with 3 px ≤ height ≤ 0.05 × page height, clamped to [8, 60] at analysis scale, exposed as
a slider. Median is wrong here — Thai sara/tone marks are numerous and tiny and drag it down.

### M5 (major) Grouping by "nearest ink distance" is O(n²) and unnecessary
Do it with a dilation instead: dilate the mask by 0.6 h (separable max filter, O(n)), take connected
components of the dilated mask as *groups*, map raw components into groups. A group containing at
least one `rule` or `big` member is a figure; the box is the union of its members' boxes, minus any
`textline` member whose ink is more than 1.2 h from the seed ink. Then merge surviving figure groups
whose gap ≤ 3 h — this is the generous seed↔seed pass that fixes **B2** (Q14, Q17), while the tight
0.6 h dilation is what keeps the answer column out.

### M6 (major) Add an absolute darkness gate before Sauvola
Bleed-through from the reverse page (visible on pp. 186–188) is genuine line art and Sauvola is
contrast-adaptive, so it will happily binarize it. Requiring `flattened < 200` as well as the Sauvola
test removes most of it for one comparison per pixel.

### M7 (major) Cache exactly one full-resolution deskewed canvas
48 MB per 12 MP page. Five cached pages ≈ 240 MB and Safari starts killing tabs. Hold the `File`,
a small thumbnail, and the analysis mask; decode and deskew full-res on demand; release on page
switch and between pages during export-all.

### M8 (major) Rotation must move existing boxes
Boxes live in full-res deskewed coordinates. The manual rotation slider changes that space. On
change, rotate each box centre about the page centre by the delta and keep w/h. Without this, a
nudge to the angle silently drags every hand-drawn box off its figure.

Coordinate mapping check: rotated extent is `|w cosθ| + |h sinθ|`, which is linear in scale, and both
scales rotate about their own centre — so `box_fullres = box_analysis / s` exactly. Worth a unit test.

### m4 The clip-art icons in the page header will be detected as a figure
True on p. 186 and p. 188. Line art, low fill, big. Accept it — one click to delete — rather than
adding a "top 6 % of page" rule that would eat a legitimate first figure.

### m5 Dotted rule under the header: verified harmless
Each dash is ~8 × 2 px → `speck`; dashes never reach `rule` because width < 2.5 h.

---

# Pass 3 — verification, failure modes, delivery

Re-traced the revised pipeline looking for remaining holes.

### M9 (major) The test suite as planned would pass while missing every real failure
Plan v1 says "synthetic pages with 3 figures". That fixture would have passed even with the broken
B3 discriminator, because a fixture drawn by the same author tends to use horizontal and 45° lines.
The suite must contain, explicitly, the cases that broke:
1. transversals at 20°, 35°, 62° (would have failed B3),
2. a figure of five disconnected parallel lines (B2),
3. an answer-choice column 2.5 h to the right of a figure (must stay out of the box),
4. labels `A`, `82°`, `x + 50°` sitting on the strokes (must be inside the box),
5. bleed-through ghost figure at ~25 % contrast (must be rejected — M6),
6. a dark band down one edge standing in for the facing page (must be rejected — B1),
7. shadow gradient + 3° skew over the whole page.
Assertions: exact figure count, IoU ≥ 0.6 per ground-truth figure, and zero overlap with the choice
column. Anything less is a test that agrees with me instead of checking me.

### M10 (major) Claimed outputs nobody would verify by eye
Two artefacts are easy to get subtly wrong and impossible to eyeball:
- **the zip** — hand-rolled STORE writer. Verify by writing one in Node and running `unzip -t`.
- **the pHYs chunk** — verify by re-parsing the emitted PNG bytes and checking the DPI actually
  round-trips, not by trusting the splice.

### m6 Word ergonomics, decided
`canvas.toBlob` emits no pHYs, so Word assumes 96 DPI and inserts a 900 px figure 9.4 inches wide.
Default to 300 DPI + an output-width preset so figures land at a consistent, sane size. Add an
optional 1 px dilate ("bolder lines") — these are thin ballpoint-weight strokes and they wash out
when printed small.

### m7 Inputs that will simply fail
- **HEIC**: iPhone default, Chrome cannot decode. Catch and print `sips -s format jpeg in.HEIC --out out.jpg`.
- **PDF**: not an image, say so plainly.
Neither should render a blank canvas with no explanation.

### m8 Empty-result screen
If detection returns nothing the app must say "no figures found — drag a box yourself", not show a
bare page. Detection is convenience (Pass 1); the app must stay useful when it fails.

### m9 Filenames from user labels go into a zip
Sanitise: strip `/`, `\`, control characters, leading dots; cap length; de-duplicate collisions.

### Simpler-alternative pass, repeated on the revised design
The pipeline grew (flatten → gate → Sauvola → CC → classify → dilate-group → merge → reject). Is
there a cheaper design that keeps 90 % of the value?
- **Drop auto-detection, ship crop + clean + batch-name only.** Genuinely viable — Pass 1 established
  the cleanup is the value. But detection is ~250 lines on top of infrastructure the cleanup already
  needs (flatten, binarize are shared), and 20 questions per page × several pages is exactly where
  hand-drawing 60 boxes gets tedious. Keep it, but the build order is: crop+clean+export first,
  detection last, so a failure in detection cannot sink the deliverable.
- **Drop deskew.** No — the photos are visibly rotated 2–5°, and a tilted figure in a quiz looks
  broken. Cheap to keep since the projection profile is already computed.
- **Drop the zip.** Keep it; 60 individual browser downloads is a worse experience than one file.

## Verdict: fix-then-ship
Blockers B1–B3 are all in detection and all now have concrete fixes. Build order changed so the
value-carrying path (clean crop → PNG → zip) is finished and verified before detection is attempted.
