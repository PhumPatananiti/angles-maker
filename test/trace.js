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

/* The quadrant test. Two crossing strokes make four angles; the page marks one
   of them with an arc. Offering a different one is not cosmetic — on this
   chapter's figures the four are two distinct values, so a label typed into the
   wrong quadrant states a relationship the question never made. */
console.log('\nchoosing the angle the page marks');
{
  const W = 300, H = 300, CX = 150, CY = 150;
  const draw = (g, x1, y1, x2, y2, thick) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 3);
    for (let i = 0; i <= n; i++) {
      const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
      for (let dy = -thick; dy <= thick; dy++) for (let dx = -thick; dx <= thick; dx++) {
        const px = Math.round(x + dx), py = Math.round(y + dy);
        if (px >= 0 && py >= 0 && px < W && py < H) g[py * W + px] = 0;
      }
    }
  };
  const arc = (g, from, to, r) => {
    for (let a = from; a <= to; a += 0.01) {
      const x = Math.round(CX + Math.cos(a) * r), y = Math.round(CY + Math.sin(a) * r);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && py >= 0 && px < W && py < H) g[py * W + px] = 0;
      }
    }
  };

  /* A horizontal stroke and one at 60 degrees, crossing at the centre. The four
     angles have bisectors roughly here: */
  const CASES = [
    { name: 'lower right', from: 0.25, to: 0.9 },
    { name: 'lower left',  from: 2.2,  to: 2.9 },
    { name: 'upper left',  from: -2.9, to: -2.2 },
    { name: 'upper right', from: -0.9, to: -0.25 }
  ];
  for (const c of CASES) {
    const g = new Uint8Array(W * H).fill(255);
    draw(g, 20, CY, W - 20, CY, 1);
    const ang = 60 * Math.PI / 180;
    draw(g, CX - Math.cos(ang) * 130, CY - Math.sin(ang) * 130,
            CX + Math.cos(ang) * 130, CY + Math.sin(ang) * 130, 1);
    arc(g, c.from, c.to, 34);
    const fig = AM.trace.traceFigure(g, W, H, {});
    const marked = fig && fig.angles.filter(a => a.fromArc);
    if (!marked || !marked.length) { check('arc in the ' + c.name + ' is found', false); continue; }
    const a = marked[0];
    const V = fig.points[a.vertex], F = fig.points[a.from], T = fig.points[a.to];
    const b1 = Math.atan2(F.y - V.y, F.x - V.x), b2 = Math.atan2(T.y - V.y, T.x - V.x);
    const bis = Math.atan2(Math.sin(b1) + Math.sin(b2), Math.cos(b1) + Math.cos(b2));
    const want = (c.from + c.to) / 2;
    let d = Math.abs(bis - want);
    while (d > Math.PI) d = Math.abs(d - Math.PI * 2);
    check('the angle offered is the one the arc marks (' + c.name + ')', d < 0.5,
          'bisector ' + (bis * 180 / Math.PI).toFixed(0) + '° against the arc at ' +
          (want * 180 / Math.PI).toFixed(0) + '°');
  }
}

/* Arrowheads say the stroke is a line, not a segment ending in a dot. */
console.log('\narrowheads');
{
  const W = 300, H = 160;
  const g = new Uint8Array(W * H).fill(255);
  for (let x = 30; x < W - 30; x++) for (let dy = -1; dy <= 1; dy++) g[(80 + dy) * W + x] = 0;
  const head = (tipX, dir) => {
    for (let i = 0; i < 14; i++) {
      for (let dy = -Math.round(i * 0.5); dy <= Math.round(i * 0.5); dy++) {
        const x = tipX + dir * i, y = 80 + dy;
        if (x >= 0 && x < W && y >= 0 && y < H) g[y * W + x] = 0;
      }
    }
  };
  head(30, 1); head(W - 30, -1);
  const fig = AM.trace.traceFigure(g, W, H, {});
  const line = fig && fig.lines[0];
  check('a stroke with heads at both ends becomes a line with arrows',
        !!line && line.kind === 'line' && line.arrows === 'both',
        line ? line.kind + '/' + line.arrows : 'no line found');
}

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
