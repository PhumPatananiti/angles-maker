/* Angles Maker — the tracer against real pages.
   The fixtures are screenshots of the app itself, so each one contains the
   exact crop the tracer was given. Cut that panel out and it becomes a test
   over real pixels instead of over figures I drew myself. */
const fs = require('fs');
const path = require('path');
['util', 'image', 'deskew', 'detect', 'geometry', 'svg', 'trace']
  .forEach(m => require('../js/core/' + m + '.js'));
const png = require('./png.js');

const DIR = path.join(__dirname, '..', 'samples');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

/* The card is pure white; the page behind it is not quite. That one step of
   grey locates the panel without hard-coding coordinates — but a single probe
   row is no good, because the drawing itself breaks the run into fragments.
   Take the edges that recur across many rows instead. */
function findCard(img) {
  const { width: W, height: H, gray } = img;
  const light = v => v >= 250;
  const starts = new Map(), ends = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (let y = Math.round(H * 0.30); y < Math.round(H * 0.95); y += 2) {
    let run = -1;
    for (let x = 0; x <= Math.round(W * 0.52); x++) {
      const on = x <= W * 0.52 && light(gray[y * W + x]);
      if (on && run < 0) run = x;
      if ((!on || x === Math.round(W * 0.52)) && run >= 0) {
        if (x - run >= 150) { bump(starts, run); bump(ends, x); }
        run = -1;
      }
    }
  }
  const mode = m => {
    let best = null, n = -1;
    for (const [k, v] of m) if (v > n) { n = v; best = k; }
    return best === null ? null : { at: best, votes: n };
  };
  const a = mode(starts), b = mode(ends);
  if (!a || !b || b.at - a.at < W * 0.15) return null;
  const x0 = a.at, x1 = b.at;
  /* A column just inside the left edge misses the drawing, so the vertical
     extent of the card reads cleanly there. */
  const probeX = x0 + 6;
  let y0 = -1, y1 = -1, run = -1;
  for (let y = 0; y <= H; y++) {
    const on = y < H && light(gray[y * W + probeX]);
    if (on && run < 0) run = y;
    if ((!on || y === H) && run >= 0) {
      if (y - run > y1 - y0) { y0 = run; y1 = y; }
      run = -1;
    }
  }
  if (y0 < 0 || y1 - y0 < H * 0.15) return null;
  return { x0, y0, x1, y1 };
}

/* Inside the card, the drawing — skipping the caption band at the top. */
function figureCrop(img, card, o) {
  const { width: W, gray } = img;
  const top = card.y0 + Math.round((card.y1 - card.y0) * 0.10);
  let ax = 1e9, ay = 1e9, bx = -1, by = -1;
  for (let y = top; y <= card.y1; y++) {
    for (let x = card.x0; x <= card.x1; x++) {
      if (gray[y * W + x] < 128) {
        if (x < ax) ax = x; if (y < ay) ay = y;
        if (x > bx) bx = x; if (y > by) by = y;
      }
    }
  }
  if (bx < 0) return null;
  const pad = 14;
  ax = Math.max(card.x0, ax - pad); ay = Math.max(top, ay - pad);
  bx = Math.min(card.x1, bx + pad); by = Math.min(card.y1, by + pad);
  const w = bx - ax + 1, h = by - ay + 1;
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = gray[(ay + y) * W + (ax + x)];
  return { gray: g, width: w, height: h };
}

/* What the tracer currently recovers from each page, checked by eye against
   the original beside it in test/out/samples.html. This is a regression guard,
   not a claim of perfection: where I could count the strokes in the book with
   confidence the expectation is exact, and the rest are held to what they do
   now so a change cannot quietly make them worse. Tolerance of one absorbs a
   stroke that sits right on the length threshold. */
const BASELINE = {
  'sample-01': { lines: 3, exact: true },   'sample-02': { lines: 5 },
  'sample-03': { lines: 4 },                'sample-04': { lines: 3 },
  'sample-05': { lines: 3, exact: true },   'sample-06': { lines: 4, exact: true },
  'sample-07': { lines: 5 },                'sample-08': { lines: 4 },
  'sample-09': { lines: 5 },                'sample-10': { lines: 4 },
  'sample-11': { lines: 4 },                'sample-12': { lines: 4 },
  'sample-13': { lines: 6 },                'sample-14': { lines: 7 },
  'sample-15': { lines: 4 },                'sample-16': { lines: 4 },
  'sample-17': { lines: 7 },                'sample-18': { lines: 6 },
  'sample-19': { lines: 8 },                'sample-20': { lines: 8 }
};
let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++; if (!ok) failures++;
  if (!ok) console.log('  FAIL  ' + name + (detail ? '   ' + detail : ''));
};

const files = fs.readdirSync(DIR).filter(f => /\.(png|jpg|jpeg)$/i.test(f)).sort();
console.log('samples: ' + files.length + ' file(s)\n');

const rows = [];
let traced = 0, failed = 0;
files.forEach((f, i) => {
  let img;
  try { img = png.decode(fs.readFileSync(path.join(DIR, f))); }
  catch (e) { console.log('  SKIP  ' + f + ' — ' + e.message); return; }
  const card = findCard(img);
  if (!card) { console.log('  SKIP  ' + f + ' — no panel found'); return; }
  const crop = figureCrop(img, card);
  if (!crop) { console.log('  SKIP  ' + f + ' — panel is empty'); return; }

  const t0 = Date.now();
  let fig = null, err = '';
  try { fig = AM.trace.traceFigure(crop.gray, crop.width, crop.height, {}); }
  catch (e) { err = e.message; }
  const ms = Date.now() - t0;

  const name = 'sample-' + String(i + 1).padStart(2, '0');
  fs.writeFileSync(path.join(OUT, name + '.png'),
    png.encodeRGBA(png.fromGray(crop.gray, crop.width, crop.height), crop.width, crop.height));

  if (!fig) {
    failed++;
    console.log('  ' + name + '  ' + crop.width + 'x' + crop.height + '  NOTHING TRACED ' + err);
    rows.push({ name, crop: name + '.png', svg: '', note: 'ไม่พบเส้น' });
    return;
  }
  traced++;
  const want = BASELINE[name];
  if (want) {
    const slack = want.exact ? 0 : 1;
    check(name + ' recovers ' + want.lines + ' strokes' + (want.exact ? ' exactly' : ' (±1)'),
          Math.abs(fig.lines.length - want.lines) <= slack,
          'got ' + fig.lines.length);
  }
  check(name + ' solves without tearing itself apart',
        (AM.geometry.solve(fig).residual || 0) < 1e-2);
  check(name + ' stays quick', ms < 250, ms + 'ms');
  const pairs = fig.constraints.filter(c => c.type === 'parallel').length;
  const arrows = fig.lines.filter(l => l.arrows && l.arrows !== 'none').length;
  const arced = fig.angles.filter(a => a.fromArc).length;
  console.log('  ' + name + '  ' + String(crop.width + 'x' + crop.height).padEnd(9) +
              ' lines ' + String(fig.lines.length).padStart(2) +
              ' | points ' + String(Object.keys(fig.points).length).padStart(2) +
              ' | angles ' + String(fig.angles.length).padStart(2) +
              ' (' + arced + ' from arcs)' +
              ' | parallel ' + pairs + ' | arrowed ' + arrows + ' | ' + ms + 'ms');
  rows.push({ name, crop: name + '.png', svg: AM.svg.render(fig, { width: 300 }),
    note: fig.lines.length + ' เส้น · ' + fig.angles.length + ' มุม (' + arced + ' จากส่วนโค้ง) · ' +
          pairs + ' คู่ขนาน · ' + arrows + ' เส้นมีหัวลูกศร' });
});

const html = '<!doctype html><meta charset="utf-8"><title>samples</title>' +
  '<style>svg,img{max-width:100%;height:auto;display:block}</style>' +
  '<body style="font:11px -apple-system;background:#f6f6f4;padding:10px;margin:0">' +
  '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">' +
  rows.map(r => '<div style="background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px">' +
    '<b>' + r.name.replace('sample-', '') + '</b> <span style="color:#777">' + r.note + '</span>' +
    '<div style="display:flex;gap:4px;align-items:flex-start;margin-top:4px">' +
    '<div style="width:49%"><img src="' + r.crop + '" style="border:1px solid #eee"></div>' +
    '<div style="width:49%">' + r.svg + '</div>' +
    '</div></div>').join('') + '</div>';
fs.writeFileSync(path.join(OUT, 'samples.html'), html);
console.log('\ntraced ' + traced + ', nothing found in ' + failed);
console.log('wrote test/out/samples.html');
check('every page yields a figure', failed === 0, failed + ' produced nothing');
console.log(failures ? '\n' + failures + ' of ' + checks + ' checks FAILED'
                     : '\nall ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
