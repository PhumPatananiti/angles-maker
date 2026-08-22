/* Angles Maker — the figure model, the solver, and the SVG it produces.
   The figures here are rebuilt from the workbook the tool was written for. */
const fs = require('fs');
const path = require('path');
require('../js/core/geometry.js');
require('../js/core/svg.js');
const G = AM.geometry;

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++; if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 0.05 : tol);

/* Question 1: two parallels cut by a transversal, co-interior angles. */
function transversal(angleValue) {
  const fig = {
    points: { A: { x: 0, y: 0, fixed: true }, B: { x: 12, y: 0, fixed: true },
              C: { x: 0, y: 7 }, D: { x: 12, y: 7 },
              E: { x: 4, y: 0, fixed: true }, F: { x: 8.5, y: 7 } },
    lines: [{ id: 'l1', a: 'A', b: 'B', kind: 'line', ticks: 1 },
            { id: 'l2', a: 'C', b: 'D', kind: 'line', ticks: 1 },
            { id: 't',  a: 'E', b: 'F', kind: 'line' }],
    constraints: [{ type: 'parallel', lines: ['l1', 'l2'] },
                  { type: 'angle', vertex: 'E', from: 'B', to: 'F', value: angleValue }],
    angles: [{ vertex: 'E', from: 'B', to: 'F', label: angleValue + '°' }]
  };
  return G.captureSigns(fig);
}

/* Question 3: a trapezoid, AB parallel to DC. */
function trapezoid(atB, atD) {
  const fig = {
    points: { A: { x: 1.5, y: 0, fixed: true }, B: { x: 5.5, y: 0, fixed: true },
              /* Only the base is pinned. Fixing three corners as well would
                 leave one free point for three constraints, and the solver
                 would quietly return a least-squares compromise instead. */
              C: { x: 9, y: 5 }, D: { x: 0, y: 5 } },
    lines: [{ id: 'ab', a: 'A', b: 'B', kind: 'segment', ticks: 1 },
            { id: 'bc', a: 'B', b: 'C', kind: 'segment' },
            { id: 'cd', a: 'C', b: 'D', kind: 'segment', ticks: 1 },
            { id: 'da', a: 'D', b: 'A', kind: 'segment' }],
    constraints: [{ type: 'parallel', lines: ['ab', 'cd'] },
                  { type: 'angle', vertex: 'B', from: 'A', to: 'C', value: atB },
                  { type: 'angle', vertex: 'D', from: 'C', to: 'A', value: atD }],
    angles: [{ vertex: 'B', from: 'A', to: 'C', label: atB + '°' },
             { vertex: 'D', from: 'C', to: 'A', label: atD + '°' },
             { vertex: 'A', from: 'D', to: 'B', label: 'x' },
             { vertex: 'C', from: 'B', to: 'D', label: 'y' }]
  };
  return G.captureSigns(fig);
}

/* Question 2: a right angle and a 65 degree angle between two parallels. */
function rightAngleCase() {
  const fig = {
    points: { A: { x: 0, y: 0, fixed: true }, B: { x: 11, y: 0, fixed: true },
              C: { x: 0, y: 6 }, D: { x: 11, y: 6 },
              P: { x: 3, y: 0 }, Q: { x: 3, y: 6, fixed: true },
              R: { x: 8, y: 0 }, S: { x: 5.5, y: 6, fixed: true } },
    lines: [{ id: 'l1', a: 'A', b: 'B', kind: 'line' }, { id: 'l2', a: 'C', b: 'D', kind: 'line' },
            { id: 'v', a: 'P', b: 'Q', kind: 'segment' }, { id: 'w', a: 'R', b: 'S', kind: 'segment' }],
    constraints: [{ type: 'parallel', lines: ['l1', 'l2'] },
                  { type: 'angle', vertex: 'Q', from: 'P', to: 'S', value: 90 },
                  { type: 'angle', vertex: 'S', from: 'Q', to: 'R', value: 65 },
                  { type: 'onLine', point: 'P', line: 'l1' }, { type: 'onLine', point: 'R', line: 'l1' }],
    angles: [{ vertex: 'Q', from: 'P', to: 'S', label: '' },
             { vertex: 'S', from: 'Q', to: 'R', label: '65°' }]
  };
  return G.captureSigns(fig);
}

console.log('solving figures rebuilt from the workbook');
const gallery = [];

{
  const fig = transversal(82);
  const r = G.solve(fig);
  const got = G.measure(fig, fig.angles[0]);
  check('transversal: solver converges', r.ok, 'residual ' + r.residual.toExponential(1) +
        ' in ' + r.iterations + ' iterations');
  check('transversal: angle is the value asked for', near(got, 82), got.toFixed(3) + '°');
  const d1 = Math.atan2(fig.points.B.y - fig.points.A.y, fig.points.B.x - fig.points.A.x);
  const d2 = Math.atan2(fig.points.D.y - fig.points.C.y, fig.points.D.x - fig.points.C.x);
  check('transversal: the lines stayed parallel', near(Math.sin(d2 - d1), 0, 1e-4),
        'sin of difference ' + Math.sin(d2 - d1).toExponential(1));
  gallery.push(['Q1 style — 82°', AM.svg.render(fig, { width: 340 })]);
}

{
  /* The re-mix case: same figure, a different number, no other change. */
  const fig = transversal(82);
  G.solve(fig);
  fig.constraints[1].value = 55;
  fig.angles[0].label = '55°';
  const r = G.solve(fig);
  const got = G.measure(fig, fig.angles[0]);
  check('re-mix: changing the value moves the drawing', r.ok && near(got, 55),
        'now measures ' + got.toFixed(3) + '°');
  const d1 = Math.atan2(fig.points.B.y - fig.points.A.y, fig.points.B.x - fig.points.A.x);
  const d2 = Math.atan2(fig.points.D.y - fig.points.C.y, fig.points.D.x - fig.points.C.x);
  check('re-mix: parallel survives the change', near(Math.sin(d2 - d1), 0, 1e-4));
  gallery.push(['same figure re-mixed to 55°', AM.svg.render(fig, { width: 340 })]);
}

{
  const fig = trapezoid(145, 60);
  const r = G.solve(fig);
  const atB = G.measure(fig, fig.angles[0]), atD = G.measure(fig, fig.angles[1]);
  check('trapezoid: both given angles hold at once', r.ok && near(atB, 145) && near(atD, 60),
        'B ' + atB.toFixed(2) + '°, D ' + atD.toFixed(2) + '°');
  const x = G.measure(fig, fig.angles[2]), y = G.measure(fig, fig.angles[3]);
  /* Co-interior angles between the parallel sides must supplement. */
  check('trapezoid: x and D supplement, as the parallel sides require', near(x + atD, 180, 0.2),
        'x = ' + x.toFixed(2) + '°, x + D = ' + (x + atD).toFixed(2) + '°');
  check('trapezoid: interior angles sum to 360', near(atB + atD + x + y, 360, 0.3),
        (atB + atD + x + y).toFixed(2) + '°');
  /* The workbook asks for x - y on this figure and offers 85° as an option.
     The reconstruction has to arrive at the same number the book does. */
  check('trapezoid: reproduces the workbook answer, x - y = 85',
        near(x - y, 85, 0.3), 'x = ' + x.toFixed(1) + '°, y = ' + y.toFixed(1) +
        '°, x - y = ' + (x - y).toFixed(2) + '°');
  gallery.push(['Q3 style — trapezoid, x and y derived', AM.svg.render(fig, { width: 340 })]);
}

{
  const fig = rightAngleCase();
  const r = G.solve(fig);
  const right = G.measure(fig, fig.angles[0]), sixtyfive = G.measure(fig, fig.angles[1]);
  check('right angle case: both constraints hold', r.ok && near(right, 90) && near(sixtyfive, 65),
        right.toFixed(2) + '° and ' + sixtyfive.toFixed(2) + '°');
  const svg = AM.svg.render(fig);
  check('a 90° angle is drawn as a square, not an arc', svg.includes('L') && !/A30 30 0 0 [01] /.test(svg.split('\n').find(l => l.includes('M') && l.includes('L')) || ''));
  gallery.push(['Q2 style — right angle drawn as a square', svg]);
}

{
  const svg = gallery[0][1];
  check('svg carries a viewBox and no external references',
        /viewBox="0 0 \d+ \d+"/.test(svg) && !/href|xlink|<image/.test(svg));
  check('parallel marks are drawn', (svg.match(/fill="none" stroke/g) || []).length >= 2);

  /* A line must reach the edges of the drawing, not stop at the two points that
     happen to define it — that is what distinguishes it from a segment, and a
     clipping error shows up here as a stub a few pixels long. */
  const lines = svg.split('\n').filter(l => l.startsWith('<line')).map(l => {
    /* Match the attributes by name: a bare number regex also picks up the "1"
       and "2" inside x1/y2 and the digits of the colour. */
    const m = l.match(/x1="(-?[\d.]+)" y1="(-?[\d.]+)" x2="(-?[\d.]+)" y2="(-?[\d.]+)"/);
    return m ? Math.hypot(m[3] - m[1], m[4] - m[2]) : 0;
  });
  const longest = Math.max.apply(null, lines);
  check('lines extend across the drawing, not just between their points',
        lines.filter(L => L > longest * 0.5).length >= 3,
        'lengths ' + lines.map(L => Math.round(L)).join(', ') + ' in a 340px box');
}

const html = '<!doctype html><meta charset="utf-8"><title>figures</title>' +
  '<body style="font:14px -apple-system;background:#f6f6f4;padding:20px">' +
  gallery.map(([t, s]) => '<figure style="background:#fff;border:1px solid #ddd;border-radius:8px;' +
    'padding:10px;margin:0 0 16px;display:inline-block;vertical-align:top;margin-right:16px">' +
    s + '<figcaption style="color:#666;margin-top:6px">' + t + '</figcaption></figure>').join('');
fs.writeFileSync(path.join(OUT, 'figures.html'), html);
gallery.forEach(([t, s], i) => fs.writeFileSync(path.join(OUT, 'figure-' + (i + 1) + '.svg'), s));
console.log('\nwrote test/out/figures.html');
console.log(failures ? failures + ' of ' + checks + ' checks FAILED' : 'all ' + checks + ' checks passed');
process.exit(failures ? 1 : 0);
