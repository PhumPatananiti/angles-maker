/* Angles Maker — regression suite.
   Every case here is one that broke an earlier version of the design. */
const fs = require('fs');
const path = require('path');
require('../js/core/util.js');
require('../js/core/image.js');
require('../js/core/deskew.js');
require('../js/core/detect.js');
require('../js/core/synth.js');
require('../js/core/pipeline.js');
const png = require('./png.js');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0, checks = 0;
function check(name, ok, detail) {
  checks++;
  if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
}
function section(t) { console.log('\n' + t); }

/* Map a ground-truth box from the ORIGINAL (pre-skew) page into deskewed
   analysis space. Two centre rotations compose into one by the sum of their
   angles, so a page skewed by t and deskewed by -t is a pure translation and
   the box is never inflated by taking axis-aligned bounds of a rotation. */
function mapBox(box, scale, rad, srcW, srcH, dstW, dstH) {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const pts = [[box.x, box.y], [box.x + box.w, box.y],
               [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .map(([px, py]) => {
      const dx = px * scale - srcW / 2, dy = py * scale - srcH / 2;
      return { x: cos * dx - sin * dy + dstW / 2, y: sin * dx + cos * dy + dstH / 2 };
    });
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys),
           w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function runCase(name, pageOpts, expect) {
  section(name);
  const page = AM.synth.makePage(pageOpts);
  const t0 = Date.now();
  const res = AM.pipeline.analyzePage(page.rgba, page.width, page.height, {});
  const ms = Date.now() - t0;
  const d = res.deskewed;

  const net = page.skewRadians + res.skew.radians;
  const srcW = page.sourceWidth * res.scale, srcH = page.sourceHeight * res.scale;
  const truth = page.truthSource.map(b => mapBox(b, res.scale, net, srcW, srcH, d.width, d.height));
  const choices = page.choiceSource.map(b => mapBox(b, res.scale, net, srcW, srcH, d.width, d.height));

  console.log('  text height ' + res.textHeight + 'px, skew ' + res.skew.degrees.toFixed(2) +
              ' deg (prominence ' + res.skew.prominence.toFixed(2) + '), ' +
              res.boxes.length + ' boxes, ' + res.rejected.length + ' rejected, ' + ms + 'ms');

  check('finds exactly ' + expect.count + ' figures', res.boxes.length === expect.count,
        'got ' + res.boxes.length);

  if (pageOpts.skewDegrees) {
    check('skew corrected to within 0.6 deg',
          Math.abs(res.skew.degrees + pageOpts.skewDegrees) < 0.6,
          'applied ' + res.skew.degrees.toFixed(2) + ' for a page skewed ' + pageOpts.skewDegrees);
  }

  truth.forEach((t, i) => {
    let best = null, bestIou = 0;
    for (const b of res.boxes) {
      const iou = AM.util.intersectionOverUnion(t, b);
      if (iou > bestIou) { bestIou = iou; best = b; }
    }
    const contained = best && best.x <= t.x + 3 && best.y <= t.y + 3 &&
                      best.x + best.w >= t.x + t.w - 3 && best.y + best.h >= t.y + t.h - 3;
    /* Cropping off part of a diagram is the failure a reader notices, so
       containment is asserted separately from overlap. */
    check('figure ' + (i + 1) + ' fully inside its box', !!contained,
          best ? 'box ' + Math.round(best.w) + 'x' + Math.round(best.h) +
                 ' vs ink ' + Math.round(t.w) + 'x' + Math.round(t.h) : 'no box');
    /* Area ratio rather than IoU: what matters is that the crop did not take in
       a neighbouring line of text. Swallowing one puts this well above 2. */
    const ratio = best ? (best.w * best.h) / (t.w * t.h) : Infinity;
    check('figure ' + (i + 1) + ' box holds no neighbouring content', ratio <= 2.0,
          'box area / ink area = ' + ratio.toFixed(2) + ', IoU ' + bestIou.toFixed(2));
  });

  let bleed = 0;
  for (const b of res.boxes) for (const c of choices) {
    const iw = Math.min(b.x + b.w, c.x + c.w) - Math.max(b.x, c.x);
    const ih = Math.min(b.y + b.h, c.y + c.h) - Math.max(b.y, c.y);
    if (iw > 0 && ih > 0) bleed += iw * ih / (c.w * c.h);
  }
  check('answer column stays out of every box', bleed < 0.15, 'overlap score ' + bleed.toFixed(2));

  /* Padding that crosses into a line of running text puts the tops of glyphs
     along the bottom edge of the exported figure. */
  let textBleed = 0;
  for (const b of res.boxes) for (const t of res.textRects || []) {
    const iw = Math.min(b.x + b.w, t.x + t.w) - Math.max(b.x, t.x);
    const ih = Math.min(b.y + b.h, t.y + t.h) - Math.max(b.y, t.y);
    if (iw > 0 && ih > 0) textBleed = Math.max(textBleed, iw * ih / (t.w * t.h));
  }
  check('no box reaches into a line of running text', textBleed < 0.02,
        'worst overlap ' + (textBleed * 100).toFixed(1) + '% of a text line');

  const rgba = png.fromGray(d.flat, d.width, d.height);
  truth.forEach(t => png.drawBox(rgba, d.width, d.height, t, [120, 200, 120], 2));
  choices.forEach(c => png.drawBox(rgba, d.width, d.height, c, [200, 200, 120], 1));
  res.rejected.forEach(r => png.drawBox(rgba, d.width, d.height, r.rect, [160, 160, 255], 1));
  res.boxes.forEach(b => png.drawBox(rgba, d.width, d.height, b, [230, 40, 40], 3));
  const file = path.join(OUT, name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.png');
  fs.writeFileSync(file, png.encodeRGBA(rgba, d.width, d.height));
  console.log('  wrote ' + path.relative(process.cwd(), file));
  return res;
}

runCase('photo page', { seed: 7, skewDegrees: 3 }, { count: 4 });
runCase('clean scan', { seed: 11, skewDegrees: 0, shadow: false, noise: 2, darkEdge: false }, { count: 4 });
runCase('heavy shadow and skew', { seed: 23, skewDegrees: -5, noise: 9 }, { count: 4 });
/* A page whose pixels outnumber the analysis width, so the whole downscale path
   runs. Tight leading at this scale is what broke vertical text chaining. */
runCase('large photo, tight leading',
        { seed: 7, skewDegrees: 3, width: 2000, height: 2600, textHeight: 38 }, { count: 4 });

section('export coordinate mapping');
{
  /* The app detects on a downscaled page and exports by cropping the
     full-resolution deskewed page at box / scale. Test that identity on its own
     terms, with markers at known positions, so image noise cannot flatter or
     libel the geometry. */
  const W = 1200, H = 1600, rad = 0.06;
  const marks = [[200, 300], [900, 1400], [600, 800], [1100, 120]];
  const gray = new Uint8Array(W * H).fill(255);
  for (const [mx, my] of marks) {
    for (let y = my - 4; y <= my + 4; y++) for (let x = mx - 4; x <= mx + 4; x++) gray[y * W + x] = 0;
  }
  const ds = AM.image.downscaleGray(gray, W, H, 800);
  const scale = ds.width / W;
  const small = AM.image.rotateGray(ds.data, ds.width, ds.height, rad, 255);
  const full = AM.image.rotateGray(gray, W, H, rad, 255);

  const centroidNear = (buf, w, h, cx, cy, r) => {
    let sx = 0, sy = 0, n = 0;
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) {
        const v = 255 - buf[y * w + x];
        if (v > 128) { sx += x * v; sy += y * v; n += v; }
      }
    }
    return n ? { x: sx / n, y: sy / n } : null;
  };
  const fwd = (px, py, w, h, dw, dh) => {
    const dx = px - w / 2, dy = py - h / 2;
    return { x: Math.cos(rad) * dx - Math.sin(rad) * dy + dw / 2,
             y: Math.sin(rad) * dx + Math.cos(rad) * dy + dh / 2 };
  };

  let worst = 0;
  for (const [mx, my] of marks) {
    const pf = fwd(mx, my, W, H, full.width, full.height);
    const ps = fwd(mx * scale, my * scale, ds.width, ds.height, small.width, small.height);
    const cf = centroidNear(full.data, full.width, full.height, Math.round(pf.x), Math.round(pf.y), 14);
    const cs = centroidNear(small.data, small.width, small.height, Math.round(ps.x), Math.round(ps.y), 12);
    if (!cf || !cs) { worst = Infinity; break; }
    /* This is exactly what boxToFullRes does, in reverse. */
    worst = Math.max(worst, Math.hypot(cf.x * scale - cs.x, cf.y * scale - cs.y));
  }
  check('a point maps between scales by scale alone (within 1.5px)', worst < 1.5,
        'worst offset ' + worst.toFixed(2) + 'px at analysis scale');

  const b = { x: 100, y: 120, w: 200, h: 90 };
  const f = AM.pipeline.boxToFullRes(b, 0.5);
  check('boxToFullRes divides by scale', f.x === 200 && f.y === 240 && f.w === 400 && f.h === 180,
        JSON.stringify(f));
}

section('bleed-through rejection');
{
  const page = AM.synth.makePage({ seed: 5, skewDegrees: 0, shadow: false, ghost: true, darkEdge: false });
  const res = AM.pipeline.analyzePage(page.rgba, page.width, page.height, {});
  const ghostReject = res.rejected.some(r => /faint/.test(r.reason));
  check('faint reverse-side figure is rejected or never seeded',
        res.boxes.length === 4, 'boxes ' + res.boxes.length +
        (ghostReject ? ', explicitly rejected as faint' : ''));
}

console.log('\n' + (failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed'));
process.exit(failures ? 1 : 0);
