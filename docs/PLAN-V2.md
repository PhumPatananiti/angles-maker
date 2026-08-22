# Angles Maker v2 — from cropping to reconstruction

## What changes
v1 extracts a figure as pixels. Pixels cannot be edited, so "fully customizable" means every
figure must become structured data, edited as data, and rendered on the way out.

    photo / PDF ──► detect figures (v1 pipeline, unchanged)
                      └─► crop, deskew, whiten          ← still the pre-processor
                            └─► read one crop  ──► figure JSON      (Gemini 3.6 Flash)
                                  └─► solve + render ──► editor ──► SVG ──► Word

The v1 detector is not thrown away. Handing a vision model twenty clean, deskewed, single-figure
crops is far more reliable than asking it to parse a whole photographed page, and it keeps the
thumbnail-selection step that already exists.

## The model
A figure is points, lines through them, and constraints. Points are the only degrees of freedom.

```json
{ "points": { "E": { "x": 0.34, "y": 0.51 } },
  "lines":  [ { "id": "l1", "a": "A", "b": "B", "kind": "line", "arrows": "both", "ticks": 1 } ],
  "constraints": [ { "type": "parallel", "lines": ["l1", "l2"] },
                   { "type": "angle", "vertex": "E", "from": "A", "to": "C", "value": 82 } ],
  "angles": [ { "vertex": "E", "from": "A", "to": "C", "label": "82°" } ] }
```

## Why a solver, and why a small one
"Change 82° to 75° and have the figure follow" is a constraint problem. A general solver is
overkill and a hand-rolled special case per figure shape is unmaintainable, so: points are the
variables, constraints produce residuals, and Gauss-Newton with damping minimises them, seeded from
the positions the vision model reported. Seeding matters — of the many configurations satisfying
the constraints, a local solver returns the one nearest the original, which is the one meant.

This covers both shapes in the chapter with the same code: transversals across parallels (angles are
differences of line directions) and polygons (angles follow from vertex positions).

## Verification is part of the product, not polish
A vision model will read 82° as 32°, or miss which pair of lines carries the parallel marks. A wrong
figure in a maths quiz is worse than no figure and the error is invisible once the crop is gone. So
the editor always shows the original crop beside the reconstruction, and a figure stays flagged
until a human accepts it.

## Decisions taken
- **Editing lives in the webapp, not in Word.** A label saying 82° and a line drawn at 82° are one
  claim; Word treats them as two unrelated objects and will happily let them disagree.
- **SVG out.** Crisp at any size, and Word 2016+ can convert it to editable shapes on demand.
- **Gemini 3.6 Flash**, not 2.5 Flash — 2.5 retires 16 Oct 2026 and is already returning
  "no longer available" for some callers.
- **The API key is the user's own, held in their browser.** The site is public; a key on the server
  would let any visitor spend it.
- **PDFs are checked for real vector content first.** When a PDF holds actual line art, the exact
  coordinates are already there and no model needs to guess at them.
