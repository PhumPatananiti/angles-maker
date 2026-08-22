/* Angles Maker — recovering geometry from pixels, with no model involved.
   The fixtures are drawn by synth.js, so the answer is known exactly. */
const fs = require('fs');
const path = require('path');
['util', 'image', 'deskew', 'detect', 'geometry', 'svg', 'synth', 'trace']
  .forEach(m => require('../js/core/' + m + '.js'));
const png = require('./png.js');

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++; if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};

const page = AM.synth.makePage({ seed: 11, skewDegrees: 0, shadow: false, noise: 0,
                                 darkEdge: false, ghost: false, choices: false, header: false });
const gray = AM.image.toGray(page.rgba, page.width, page.height);
function crop(t) {
  const x0 = Math.round(t.x), y0 = Math.round(t.y);
  const w = Math.round(t.w), h = Math.round(t.h);
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = gray[(y0 + y) * page.width + (x0 + x)];
  return { g, w, h };
}

/* What synth.js actually draws, in the order it draws them. */
const EXPECT = [
  { name: 'two parallels cut by a transversal', lines: 3, parallelPairs: 1, minAngles: 2 },
  { name: 'triangle with an inner parallel segment', lines: 4, parallelPairs: 1, minAngles: 3 },
  { name: 'five separate parallel lines', lines: 5, parallelPairs: 4, minAngles: 0 },
  { name: 'zig-zag between two rays', lines: 5, parallelPairs: 1, minAngles: 0 }
];

const gallery = [];
page.truth.forEach((t, i) => {
  const e = EXPECT[i];
  console.log('\n' + e.name);
  const c = crop(t);
  const t0 = Date.now();
  const fig = AM.trace.traceFigure(c.g, c.w, c.h, {});
  const ms = Date.now() - t0;
  if (!fig) { check('a figure is recovered at all', false); return; }

  const pairs = fig.constraints.filter(x => x.type === 'parallel').length;
  console.log('  ' + c.w + 'x' + c.h + ', ' + ms + 'ms, ' + Object.keys(fig.points).length + ' points');
  check('finds ' + e.lines + ' strokes', fig.lines.length === e.lines, 'found ' + fig.lines.length);
  check('groups ' + e.parallelPairs + ' parallel pair(s)', pairs === e.parallelPairs, 'found ' + pairs);
  check('offers at least ' + e.minAngles + ' angle(s) to fill in', fig.angles.length >= e.minAngles,
        fig.angles.length + ' offered');
  check('every line refers to points that exist',
        fig.lines.every(l => fig.points[l.a] && fig.points[l.b] && l.a !== l.b));
  check('it is fast enough to feel instant', ms < 400, ms + 'ms');

  /* The recovered figure must survive its own solver, or editing it later
     would tear it apart. */
  const r = AM.geometry.solve(fig);
  check('the recovered figure solves', r.ok || r.residual < 1e-3,
        'residual ' + r.residual.toExponential(1));

  const rgba = png.fromGray(c.g, c.w, c.h);
  fs.writeFileSync(path.join(OUT, 'trace-' + (i + 1) + '-source.png'), png.encodeRGBA(rgba, c.w, c.h));
  gallery.push([e.name + ' — ' + fig.lines.length + ' strokes, ' + pairs + ' parallel pair(s)',
                'trace-' + (i + 1) + '-source.png', AM.svg.render(fig, { width: 300 })]);
});

const html = '<!doctype html><meta charset="utf-8"><title>traced</title>' +
  '<body style="font:14px -apple-system;background:#f6f6f4;padding:20px">' +
  gallery.map(([t, src, svg]) =>
    '<div style="background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:14px">' +
    '<div style="color:#666;margin-bottom:8px">' + t + '</div>' +
    '<div style="display:flex;gap:16px;align-items:flex-start">' +
    '<img src="' + src + '" style="max-width:320px;border:1px solid #eee">' + svg + '</div></div>').join('');
fs.writeFileSync(path.join(OUT, 'traced.html'), html);
console.log('\nwrote test/out/traced.html');
console.log(failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
